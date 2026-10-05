import os, re, io, secrets, hashlib, json, time, uuid, urllib.request, urllib.error
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager
from threading import Lock
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
import psycopg
from psycopg.rows import dict_row

ROOT = os.path.dirname(os.path.abspath(__file__))
E = lambda k, d="": os.getenv(k, d)
app = FastAPI(title="Weekly Process Status Report", docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def security_headers(req: Request, call_next):
    response = await call_next(req)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if req.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    if E("COOKIE_SECURE") == "true":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response

def validate_production_config():
    if E("COOKIE_SECURE") != "true":
        return
    if not E("APP_URL").startswith("https://"):
        raise RuntimeError("COOKIE_SECURE=true requires APP_URL starting with https://")
    password = E("ADMIN_PASSWORD")
    if password in ("ChangeMe-12345", "Demo-12345") or len(password) < 12:
        raise RuntimeError("COOKIE_SECURE=true requires a non-default ADMIN_PASSWORD of at least 12 characters")

class Conn:
    """Thin wrapper: keeps '?' placeholders, autocommit connection, dict rows. Explicit BEGIN/COMMIT in save()."""
    def __init__(self, raw): self.raw = raw
    def execute(self, sql, params=()): return self.raw.execute(sql.replace("?", "%s"), params)

@contextmanager
def db():
    raw = psycopg.connect(E("DATABASE_URL", "postgresql://tracker:tracker@localhost:5432/tracker"), autocommit=True, row_factory=dict_row)
    try: yield Conn(raw)
    finally: raw.close()

sv = lambda x: f"{x:g}" if isinstance(x, float) else str(x)
now = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()

def hash_pw(p):
    s = secrets.token_bytes(16)
    return s.hex() + "$" + hashlib.scrypt(p.encode(), salt=s, n=2**14, r=8, p=1).hex()
def check_pw(p, stored):
    try: s, h = stored.split("$")
    except Exception: return False
    return secrets.compare_digest(hashlib.scrypt(p.encode(), salt=bytes.fromhex(s), n=2**14, r=8, p=1).hex(), h)

def parse_days(v):
    """Accepts '0,5' or '0.75'. Returns thousandths of a day (exact int). Raises ValueError."""
    if v is None or str(v).strip() == "": return 0
    s = str(v).strip()
    if "," in s and "." in s: raise ValueError("Use either a comma or a point as decimal separator")
    if not re.fullmatch(r"\d+([.,]\d+)?", s): raise ValueError(f"'{s}' is not a valid number")
    try: d = Decimal(s.replace(",", "."))
    except InvalidOperation: raise ValueError(f"'{s}' is not a valid number")
    if not d.is_finite() or d < 0: raise ValueError("Days must be a positive number")
    if d != d.quantize(Decimal("0.001")): raise ValueError("At most 3 decimals are allowed")
    if d > 1000: raise ValueError("Value too large")
    return int(d * 1000)

def gen_periods(c, y0=2026, y1=None):
    """One period per (ISO week, month) over Mon-Fri days; capacity = weekdays in that part.
    Idempotent: run at every startup, extends the calendar to (current year + 2). Year-aligned windows never split a period (months split them anyway)."""
    y1 = y1 or date.today().year + 2
    if not (2000 <= y0 <= y1 <= 2100): raise HTTPException(422, "Period out of supported range (2000-2100)")
    groups, d = {}, date(y0, 1, 1)
    while d <= date(y1, 12, 31):
        if d.weekday() < 5:
            iy, iw, _ = d.isocalendar()
            groups.setdefault((iy, iw, d.strftime("%Y-%m")), []).append(d)
        d += timedelta(1)
    for (iy, iw, mk), ds in groups.items():
        c.execute("INSERT INTO periods(p_start,p_end,month_key,iso_year,iso_week,capacity) VALUES(?,?,?,?,?,?) ON CONFLICT (p_start) DO NOTHING",
                  (ds[0].isoformat(), ds[-1].isoformat(), mk, iy, iw, len(ds)))

def ensure_periods(c, d_from, d_to):
    """On-demand calendar: guarantees periods exist for any requested range (no fixed horizon). Idempotent."""
    y0, y1 = d_from.year, d_to.year
    n = c.execute("SELECT count(DISTINCT left(p_start,4)) AS n FROM periods WHERE left(p_start,4) BETWEEN ? AND ?", (str(y0), str(y1))).fetchone()["n"]
    if n < y1 - y0 + 1: gen_periods(c, y0, y1)

def init():
    with db() as c:
        gen_periods(c)
        if not c.execute("SELECT 1 FROM users").fetchone() and E("ADMIN_EMAIL") and E("ADMIN_PASSWORD"):
            c.execute("INSERT INTO users(email,name,role,pw) VALUES(?,?,?,?)",
                      (E("ADMIN_EMAIL").lower(), "Manager", "admin", hash_pw(E("ADMIN_PASSWORD"))))
@app.get("/api/health")
def health():
    try:
        with db() as c: c.execute("SELECT 1")
    except Exception: raise HTTPException(503, "Database unavailable")
    return {"ok": True}

@app.on_event("startup")
def _startup():
    validate_production_config()
    init()  # schema comes from Alembic (alembic upgrade head)

# ---------- auth ----------
def cur_user(req: Request):
    sid = req.cookies.get("sid")
    if not sid: raise HTTPException(401, "Please sign in")
    with db() as c:
        r = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.h=? AND s.exp>? AND u.active=1", (sha(sid), time.time())).fetchone()
    if not r: raise HTTPException(401, "Session expired, please sign in again")
    if r["must_change_password"] and req.url.path not in ("/api/me", "/api/logout", "/api/change-password"):
        raise HTTPException(403, {"message": "You must choose a new password first.", "code": "password_change_required"})
    return dict(r)
def admin_only(req):
    u = cur_user(req)
    if u["role"] != "admin": raise HTTPException(403, "Administrator access required")
    return u

FAILS = {}
IP_ATTEMPTS = {}
IP_ATTEMPTS_LOCK = Lock()
IP_LOGIN_LIMIT = 20
LOGIN_WINDOW = 900

def limit_login_ip(req: Request):
    ip = req.client.host if req.client else "unknown"
    stamp = time.monotonic()
    with IP_ATTEMPTS_LOCK:
        for key in list(IP_ATTEMPTS):
            recent = [t for t in IP_ATTEMPTS[key] if t > stamp - LOGIN_WINDOW]
            if recent:
                IP_ATTEMPTS[key] = recent
            else:
                del IP_ATTEMPTS[key]
        attempts = IP_ATTEMPTS.get(ip, [])
        if len(attempts) >= IP_LOGIN_LIMIT:
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
        IP_ATTEMPTS[ip] = attempts + [stamp]

class Login(BaseModel): email: str; password: str
@app.post("/api/login")
def login(b: Login, resp: Response, req: Request):
    limit_login_ip(req)
    k = b.email.lower().strip(); f = [t for t in FAILS.get(k, []) if t > time.time() - 900]
    if len(f) >= 5: raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (k,)).fetchone()
        if not u or not u["pw"] or not u["active"] or not check_pw(b.password, u["pw"]):
            FAILS[k] = f + [time.time()]; raise HTTPException(401, "Invalid email or password")
        sid = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (sha(sid), u["id"], time.time() + 8 * 3600))
    FAILS.pop(k, None)
    resp.set_cookie("sid", sid, httponly=True, samesite="lax", secure=E("COOKIE_SECURE") == "true", max_age=8 * 3600)
    return {"ok": True, "must_change_password": bool(u["must_change_password"])}
@app.post("/api/logout")
def logout(req: Request, resp: Response):
    sid = req.cookies.get("sid")
    if sid:
        with db() as c: c.execute("DELETE FROM sessions WHERE h=?", (sha(sid),))
    resp.delete_cookie("sid"); return {"ok": True}
@app.get("/api/me")
def me(req: Request):
    u = cur_user(req)
    with db() as c: t = c.execute("SELECT id FROM trackers WHERE owner_id=?", (u["id"],)).fetchone()
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "tracker_id": t["id"] if t else None, "must_change_password": bool(u["must_change_password"]),
            "email_test_mode": E("EMAIL_MODE", "console") != "resend"}

def send_mail(c, user, kind):
    """Creates a one-time token, builds the link from APP_URL and sends (or stores in test mode). Never raises."""
    days = 7 if kind == "invite" else 0
    tok = secrets.token_urlsafe(32)
    c.execute("INSERT INTO tokens VALUES(?,?,?,?,0)", (sha(tok), user["id"], kind, time.time() + (7 * 86400 if kind == "invite" else 3600)))
    link = f"{E('APP_URL', 'http://localhost:8000').rstrip('/')}/#/set-password/{tok}"
    if kind == "invite":
        subj, body = "Your Weekly Tracker account", f"Hello {user['name']},\n\nAn account was created for you. Choose your password here (valid 7 days):\n{link}\n"
    else:
        subj, body = "Reset your Weekly Tracker password", f"Hello {user['name']},\n\nChoose a new password here (valid 1 hour):\n{link}\n\nIf you did not ask for this, ignore this email."
    status, err = "sent", None
    if E("EMAIL_MODE", "console") == "resend":
        try:
            req = urllib.request.Request("https://api.resend.com/emails", method="POST",
                data=json.dumps({"from": E("MAIL_FROM"), "to": [user["email"]], "subject": subj, "text": body}).encode(),
                headers={"Authorization": "Bearer " + E("RESEND_API_KEY"), "Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
        except Exception as ex: status, err = "failed", f"{type(ex).__name__}: {ex}"
    else: status = "test (not sent)"; print(f"[EMAIL TEST MODE] to={user['email']} link={link}")
    c.execute("INSERT INTO emails(user_id,to_addr,subject,body,status,error,created) VALUES(?,?,?,?,?,?,?)",
              (user["id"], user["email"], subj, body, status, err, now()))
    return status, err

class Email(BaseModel): email: str
@app.post("/api/forgot")
def forgot(b: Email):
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE email=? AND active=1", (b.email.lower().strip(),)).fetchone()
        if u: send_mail(c, dict(u), "reset")
    return {"ok": True}
class SetPw(BaseModel): token: str; password: str
@app.post("/api/set-password")
def set_password(b: SetPw):
    if len(b.password) < 8: raise HTTPException(422, "Password must contain at least 8 characters")
    with db() as c:
        t = c.execute("SELECT * FROM tokens WHERE h=? AND used=0 AND exp>?", (sha(b.token), time.time())).fetchone()
        if not t: raise HTTPException(400, "This link is invalid or has expired. Ask for a new one.")
        c.execute("UPDATE users SET pw=?, must_change_password=0 WHERE id=?", (hash_pw(b.password), t["user_id"]))
        c.execute("UPDATE tokens SET used=1 WHERE user_id=?", (t["user_id"],)); c.execute("DELETE FROM sessions WHERE user_id=?", (t["user_id"],))
    return {"ok": True}

class ChangePw(BaseModel): current: str; new: str
@app.post("/api/change-password")
def change_password(b: ChangePw, req: Request):
    u = cur_user(req)
    if not check_pw(b.current, u["pw"] or ""): raise HTTPException(422, "Current password is incorrect")
    if len(b.new) < 8: raise HTTPException(422, "Password must contain at least 8 characters")
    if b.new == b.current: raise HTTPException(422, "Choose a password different from the temporary one")
    with db() as c:
        c.execute("UPDATE users SET pw=?, must_change_password=0 WHERE id=?", (hash_pw(b.new), u["id"]))
        c.execute("UPDATE tokens SET used=1 WHERE user_id=?", (u["id"],)); c.execute("DELETE FROM sessions WHERE user_id=? AND h<>?", (u["id"], sha(req.cookies.get("sid"))))
    return {"ok": True}

# ---------- accounts (admin) ----------
class NewUser(BaseModel): email: str; name: str; mode: str = "invite"; temp_password: str | None = None
@app.post("/api/users")
def create_user(b: NewUser, req: Request):
    admin_only(req); em = b.email.lower().strip()
    if "@" not in em or not b.name.strip(): raise HTTPException(422, "A name and a valid email are required")
    with db() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (em,)).fetchone(): raise HTTPException(409, "This email is already used")
        uid = c.execute("INSERT INTO users(email,name,role) VALUES(?,?,'employee') RETURNING id", (em, b.name.strip())).fetchone()["id"]
        c.execute("INSERT INTO trackers(owner_id,start_date) VALUES(?,?)", (uid, date.today().isoformat()))
        if b.mode == "temp_password":  # no email: the admin hands the temporary password over; only its hash is stored
            check_temp(b.temp_password)
            c.execute("UPDATE users SET pw=?, must_change_password=1 WHERE id=?", (hash_pw(b.temp_password), uid)); st, err = "none (temporary password)", None
        else: st, err = send_mail(c, {"id": uid, "email": em, "name": b.name.strip()}, "invite")
    return {"id": uid, "email_status": st, "email_error": err}
def check_temp(p):
    if not p or len(p) < 8: raise HTTPException(422, "Temporary password must contain at least 8 characters")
class TempPw(BaseModel): password: str
@app.post("/api/users/{uid}/temp-password")
def temp_password(uid: int, b: TempPw, req: Request):
    me_ = admin_only(req); check_temp(b.password)
    if uid == me_["id"]: raise HTTPException(422, "Use 'Change password' for your own account")
    with db() as c:
        if not c.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone(): raise HTTPException(404, "Not found")
        c.execute("UPDATE users SET pw=?, must_change_password=1 WHERE id=?", (hash_pw(b.password), uid))
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,)); c.execute("UPDATE tokens SET used=1 WHERE user_id=? AND used=0", (uid,))  # old sessions and pending links die
    return {"ok": True}
@app.get("/api/users")
def list_users(req: Request):
    admin_only(req)
    with db() as c:
        return [dict(r) for r in c.execute("""SELECT u.id,u.email,u.name,u.role,u.active,(u.pw IS NOT NULL) has_password,u.must_change_password,t.id tracker_id,
          (SELECT status FROM emails e WHERE e.user_id=u.id ORDER BY e.id DESC LIMIT 1) last_email FROM users u LEFT JOIN trackers t ON t.owner_id=u.id ORDER BY u.name""")]
@app.post("/api/users/{uid}/resend")
def resend(uid: int, req: Request):
    admin_only(req)
    with db() as c:
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u: raise HTTPException(404, "Not found")
        st, err = send_mail(c, dict(u), "reset" if u["pw"] else "invite")
    return {"email_status": st, "email_error": err}
class Active(BaseModel): active: bool
@app.post("/api/users/{uid}/active")
def set_active(uid: int, b: Active, req: Request):
    me_ = admin_only(req)
    if uid == me_["id"]: raise HTTPException(422, "You cannot deactivate your own account")
    with db() as c:
        c.execute("UPDATE users SET active=? WHERE id=?", (int(b.active), uid)); c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    return {"ok": True}
@app.get("/api/emails")
def emails(req: Request):
    admin_only(req)
    with db() as c: return [dict(r) for r in c.execute("SELECT * FROM emails ORDER BY id DESC LIMIT 30")]

# ---------- tracker ----------
PSEL = 'id, p_start AS start, p_end AS "end", month_key, iso_year, iso_week, capacity'
def get_tracker(c, tid, u, lock=False):
    t = c.execute("SELECT * FROM trackers WHERE id=?" + (" FOR UPDATE" if lock else ""), (tid,)).fetchone()
    if not t or (u["role"] != "admin" and t["owner_id"] != u["id"]): raise HTTPException(404, "Tracker not found")
    return dict(t)

def pdate(v, what):
    try: return date.fromisoformat(v)
    except Exception: raise HTTPException(422, f"Invalid {what} date (use YYYY-MM-DD)")
def month_range(d): 
    nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1); return d.replace(day=1), nxt - timedelta(days=1)

def resolve_range(c, t, frm, to, max_days=800):
    """The consulted period is independent from the mission dates. Default = current month."""
    if not frm and not to: f, l = month_range(date.today())
    else:
        f, l = pdate(frm, "from"), pdate(to, "to")
        if l < f: raise HTTPException(422, "'to' must not be before 'from'")
        if (l - f).days > max_days: raise HTTPException(422, f"Range too large (max {max_days} days)")
    ensure_periods(c, f, l); return f, l

def tracker_data(c, t, frm=None, to=None, max_days=800):
    tid = t["id"]; f, l = resolve_range(c, t, frm, to, max_days)
    periods = [dict(p) for p in c.execute(f"SELECT {PSEL} FROM periods WHERE p_end>=? AND p_start<=? ORDER BY p_start", (f.isoformat(), l.isoformat()))]
    pm = {p["id"]: p for p in periods}; ids = list(pm)
    acts = [dict(a) for a in c.execute("SELECT * FROM activities WHERE tracker_id=? ORDER BY archived,pos,id", (tid,))]
    entries, col, bl = {}, {}, {}
    for r in c.execute("SELECT e.* FROM entries e JOIN activities a ON a.id=e.activity_id WHERE a.tracker_id=? AND e.period_id = ANY(?)", (tid, ids)):
        entries.setdefault(r["activity_id"], {})[r["period_id"]] = r["milli"]; p = pm[r["period_id"]]
        col[r["period_id"]] = col.get(r["period_id"], 0) + r["milli"]  # archived activities are INCLUDED on purpose: archiving never erases work done
        bl.setdefault(r["activity_id"], {}); bl[r["activity_id"]][p["month_key"]] = bl[r["activity_id"]].get(p["month_key"], 0) + r["milli"]
    months = {}
    for p in periods: months[p["month_key"]] = months.get(p["month_key"], 0) + col.get(p["id"], 0)
    complete = {}
    for mk in months: a, b = month_range(date(int(mk[:4]), int(mk[5:]), 1)); complete[mk] = f <= a and l >= b
    info = {}
    for r in c.execute("SELECT * FROM info WHERE tracker_id=? AND period_id = ANY(?)", (tid, ids)): info.setdefault(r["period_id"], {})[r["kind"]] = r["milli"]
    b = c.execute("""SELECT MIN(p.p_start) AS first, MAX(p.p_end) AS last, COALESCE(SUM(e.milli),0) AS total FROM entries e JOIN activities a ON a.id=e.activity_id
                     JOIN periods p ON p.id=e.period_id WHERE a.tracker_id=?""", (tid,)).fetchone()
    owner = c.execute("SELECT id,name,email FROM users WHERE id=?", (t["owner_id"],)).fetchone()
    used = {r["activity_id"] for r in c.execute("SELECT DISTINCT e.activity_id FROM entries e JOIN activities a ON a.id=e.activity_id WHERE a.tracker_id=?", (tid,))}
    for a in acts: a["has_data"] = a["id"] in used   # any period, visible or not: only activities WITHOUT saved days can be deleted
    return {"tracker": t, "owner": dict(owner), "periods": periods, "activities": acts, "entries": entries, "info": info, "col_totals": col,
            "month_totals": months, "month_complete": complete, "bl": bl, "range": {"from": f.isoformat(), "to": l.isoformat()},
            "bounds": {"first": b["first"], "last": b["last"], "all_total": int(b["total"])}}

@app.get("/api/trackers/{tid}")
def read_tracker(tid: int, req: Request, frm: str | None = Query(None, alias="from"), to: str | None = None):
    u = cur_user(req)
    with db() as c: return tracker_data(c, get_tracker(c, tid, u), frm, to)

def all_comments(c, tid):
    rows = [dict(r) for r in c.execute("SELECT c.id,c.created,c.text,c.author_id,u.name AS author FROM comments c JOIN users u ON u.id=c.author_id WHERE c.tracker_id=? ORDER BY c.id", (tid,))]
    sc = {}
    for r in c.execute("SELECT s.* FROM comment_scopes s JOIN comments c ON c.id=s.comment_id WHERE c.tracker_id=? ORDER BY iso_year,iso_week", (tid,)): sc.setdefault(r["comment_id"], []).append([r["iso_year"], r["iso_week"]])
    for r in rows: r["scopes"] = sc.get(r["id"], [])
    return rows

@app.get("/api/trackers/{tid}/export.xlsx")
def export(tid: int, req: Request, scope: str = "view", frm: str | None = Query(None, alias="from"), to: str | None = None):
    u = cur_user(req)
    with db() as c:
        t = get_tracker(c, tid, u)
        if scope == "all":
            b = c.execute("SELECT MIN(p.p_start) AS first, MAX(p.p_end) AS last FROM entries e JOIN activities a ON a.id=e.activity_id JOIN periods p ON p.id=e.period_id WHERE a.tracker_id=?", (tid,)).fetchone()
            starts = [pdate(t["start_date"], "start")] + ([pdate(b["first"], "")] if b["first"] else [])
            ends = [date.today()] + ([pdate(t["end_date"], "end")] if t["end_date"] else []) + ([pdate(b["last"], "")] if b["last"] else [])
            frm, to = month_range(min(starts))[0].isoformat(), month_range(max(ends))[1].isoformat()
        elif scope not in ("view", "range"): raise HTTPException(422, "Unknown export scope")
        d = tracker_data(c, t, frm, to, max_days=7300)
        weeks = {(p["iso_year"], p["iso_week"]) for p in d["periods"]}
        d["comments"] = [r for r in all_comments(c, tid) if not r["scopes"] or any(tuple(x) in weeks for x in r["scopes"])]  # all comments of the scope + general ones, never paginated
    from export_xlsx import build
    d = {**d, "entries": {int(k): {int(p): v for p, v in e.items()} for k, e in d["entries"].items()}, "info": {int(k): v for k, v in d["info"].items()},
         "col_totals": {int(k): v for k, v in d["col_totals"].items()}, "bl": {int(k): v for k, v in d["bl"].items()}}
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", d["owner"]["name"])
    return Response(build(d), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f'attachment; filename="Weekly_Status_{name}.xlsx"'})

def page(limit, offset): return max(1, min(limit, 200)), max(0, offset)
@app.get("/api/trackers/{tid}/comments")
def comments(tid: int, req: Request, limit: int = 25, offset: int = 0, week: str | None = None, author_id: int | None = None, q: str | None = None):
    u = cur_user(req); limit, offset = page(limit, offset); w, args = ["c.tracker_id=?"], [tid]
    with db() as c:
        get_tracker(c, tid, u)
        if author_id: w.append("c.author_id=?"); args.append(author_id)
        if q: w.append("c.text ILIKE ?"); args.append("%" + q + "%")
        if week == "general": w.append("NOT EXISTS (SELECT 1 FROM comment_scopes s WHERE s.comment_id=c.id)")
        elif week:
            try: y, k = [int(x) for x in week.split("-")]
            except Exception: raise HTTPException(422, "week must look like 2026-39 or 'general'")
            w.append("EXISTS (SELECT 1 FROM comment_scopes s WHERE s.comment_id=c.id AND s.iso_year=? AND s.iso_week=?)"); args += [y, k]
        where = " AND ".join(w)
        total = c.execute(f"SELECT count(*) AS n FROM comments c WHERE {where}", args).fetchone()["n"]
        rows = [dict(r) for r in c.execute(f"SELECT c.id,c.created,c.text,c.author_id,u.name AS author FROM comments c JOIN users u ON u.id=c.author_id WHERE {where} ORDER BY c.id DESC LIMIT ? OFFSET ?", args + [limit, offset])]
        sc = {}
        for r in c.execute("SELECT * FROM comment_scopes WHERE comment_id = ANY(?) ORDER BY iso_year,iso_week", ([r["id"] for r in rows],)): sc.setdefault(r["comment_id"], []).append([r["iso_year"], r["iso_week"]])
        for r in rows: r["scopes"] = sc.get(r["id"], [])
        authors = [dict(r) for r in c.execute("SELECT DISTINCT u.id,u.name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.tracker_id=? ORDER BY u.name", (tid,))]
    return {"items": rows, "total": total, "limit": limit, "offset": offset, "authors": authors}

@app.get("/api/trackers/{tid}/history")
def history(tid: int, req: Request, limit: int = 25, offset: int = 0, week: str | None = None, month: str | None = None, author_id: int | None = None,
            activity_id: int | None = None, date_from: str | None = None, date_to: str | None = None):
    u = cur_user(req); limit, offset = page(limit, offset); w, args = ["h.tracker_id=?"], [tid]
    with db() as c:
        get_tracker(c, tid, u)
        if author_id: w.append("h.author_id=?"); args.append(author_id)
        if activity_id: w.append("h.activity_id=?"); args.append(activity_id)
        if month: w.append("p.month_key=?"); args.append(month)
        if week:
            try: y, k = [int(x) for x in week.split("-")]
            except Exception: raise HTTPException(422, "week must look like 2026-39")
            w.append("p.iso_year=? AND p.iso_week=?"); args += [y, k]
        if date_from: w.append("h.at >= ?"); args.append(date_from)
        if date_to: w.append("h.at < ?"); args.append((pdate(date_to, "to") + timedelta(1)).isoformat())
        where = " AND ".join(w); frm = "FROM history h JOIN users u ON u.id=h.author_id LEFT JOIN periods p ON p.id=h.period_id"
        total = c.execute(f"SELECT count(*) AS n {frm} WHERE {where}", args).fetchone()["n"]
        rows = [dict(r) for r in c.execute(f"SELECT h.id,h.batch,h.at,h.what,h.old,h.new,h.author_id,h.activity_id,h.period_id,u.name AS author,u.role AS author_role,p.iso_year,p.iso_week,p.month_key {frm} WHERE {where} ORDER BY h.id DESC LIMIT ? OFFSET ?", args + [limit, offset])]
        authors = [dict(r) for r in c.execute("SELECT DISTINCT u.id,u.name FROM history h JOIN users u ON u.id=h.author_id WHERE h.tracker_id=? ORDER BY u.name", (tid,))]
    return {"items": rows, "total": total, "limit": limit, "offset": offset, "authors": authors}

class Meta(BaseModel): work_package: str = ""; start_date: str; end_date: str | None = None
@app.put("/api/trackers/{tid}")
def update_meta(tid: int, b: Meta, req: Request):
    u = admin_only(req); s = pdate(b.start_date, "start"); e = pdate(b.end_date, "end") if b.end_date else None
    if e and e < s: raise HTTPException(422, "End date must be after start date")
    with db() as c:  # mission dates never delete data: entries outside them stay stored and visible
        get_tracker(c, tid, u)
        c.execute("UPDATE trackers SET work_package=?,start_date=?,end_date=? WHERE id=?", (b.work_package, s.isoformat(), e.isoformat() if e else None, tid))
    return {"ok": True}

HIST = "INSERT INTO history(batch,tracker_id,author_id,at,what,old,new,activity_id,period_id) VALUES(?,?,?,?,?,?,?,?,?)"
@app.post("/api/trackers/{tid}/activities")
def add_activity(tid: int, req: Request):
    u = cur_user(req)
    with db() as c:
        get_tracker(c, tid, u); n = c.execute("SELECT COALESCE(MAX(pos),0)+1 AS n FROM activities WHERE tracker_id=?", (tid,)).fetchone()["n"]
        aid = c.execute("INSERT INTO activities(tracker_id,pos) VALUES(?,?) RETURNING id", (tid, n)).fetchone()["id"]
        c.execute(HIST, (uuid.uuid4().hex, tid, u["id"], now(), f"Activity #{aid} added", "", "", aid, None))
    return {"id": aid}
class Arch(BaseModel): archived: bool
@app.post("/api/activities/{aid}/archive")
def archive(aid: int, b: Arch, req: Request):
    u = cur_user(req)
    with db() as c:
        a = c.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
        if not a: raise HTTPException(404, "Not found")
        get_tracker(c, a["tracker_id"], u)
        c.execute("UPDATE activities SET archived=? WHERE id=?", (int(b.archived), aid))
        c.execute(HIST, (uuid.uuid4().hex, a["tracker_id"], u["id"], now(), f"Activity '{a['details'] or aid}' " + ("archived" if b.archived else "restored"), "", "", aid, None))
    return {"ok": True}

@app.delete("/api/activities/{aid}")
def delete_activity(aid: int, req: Request):
    """Permanent deletion is only allowed for activities with NO saved days (e.g. added by mistake). Otherwise: archive (days stay in all totals)."""
    u = cur_user(req)
    with db() as c:
        a = c.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
        if not a: raise HTTPException(404, "Not found")
        c.execute("BEGIN")
        try:
            get_tracker(c, a["tracker_id"], u, lock=True)   # same lock as save(): no day can be saved while we check
            if not c.execute("SELECT 1 FROM activities WHERE id=?", (aid,)).fetchone(): raise HTTPException(404, "Not found")
            if c.execute("SELECT 1 FROM entries WHERE activity_id=? LIMIT 1", (aid,)).fetchone():
                raise HTTPException(409, {"message": "This activity has days entered, so it cannot be deleted. Archive it instead: archiving keeps its days in all totals.", "code": "has_entries"})
            c.execute("DELETE FROM activities WHERE id=?", (aid,))
            c.execute(HIST, (uuid.uuid4().hex, a["tracker_id"], u["id"], now(), f"Activity '{a['details'] or aid}' deleted (no days entered)", "", "", aid, None))
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK"); raise
    return {"ok": True}

FIELDS = {"affected", "details", "deliverables", "estimation", "status", "progress"}
WEEK = re.compile(r"^(\d{4})-(\d{1,2})$")
class Save(BaseModel): changes: list[dict]; comment: str | None = None; weeks: list[str] | None = None; general: bool = False
@app.post("/api/trackers/{tid}/save")
def save(tid: int, b: Save, req: Request):
    u = cur_user(req); batch = uuid.uuid4().hex
    with db() as c:
        c.execute("BEGIN")
        try:
            t = get_tracker(c, tid, u, lock=True)  # 404 for anyone but owner/admin; row lock serialises concurrent saves of one tracker
            pm = {p["id"]: p for p in c.execute(f"SELECT {PSEL} FROM periods")}
            start = date.fromisoformat(t["start_date"]); mend = date.fromisoformat(t["end_date"]) if t["end_date"] else None
            conflicts, touched, log, wk = [], set(), [], set()
            for ch in b.changes:
                kind = ch.get("type")
                if kind == "cell":
                    a = c.execute("SELECT * FROM activities WHERE id=? AND tracker_id=?", (ch.get("activity_id"), tid)).fetchone()
                    p = pm.get(ch.get("period_id"))
                    if not a or not p: raise HTTPException(404, "Unknown activity or period")
                    if a["archived"]: raise HTTPException(422, "Archived activities are read-only. Restore the activity to edit it.")
                    try: new = parse_days(ch.get("new"))
                    except ValueError as ex: raise HTTPException(422, f"{p['month_key']} WK{p['iso_week']}: {ex}")
                    r = c.execute("SELECT milli FROM entries WHERE activity_id=? AND period_id=?", (a["id"], p["id"])).fetchone(); curv = r["milli"] if r else 0
                    if curv != int(ch.get("old", 0)): conflicts.append({"key": f"c:{a['id']}:{p['id']}", "current": curv}); continue
                    ps, pe = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
                    if new and not curv and (pe < start or (mend and ps > mend)): raise HTTPException(422, f"WK{p['iso_week']} ({p['month_key']}) is outside the mission dates. Change the mission dates first.")
                    if new: c.execute("INSERT INTO entries VALUES(?,?,?) ON CONFLICT (activity_id,period_id) DO UPDATE SET milli=EXCLUDED.milli", (a["id"], p["id"], new))
                    else: c.execute("DELETE FROM entries WHERE activity_id=? AND period_id=?", (a["id"], p["id"]))
                    touched.add(p["id"]); wk.add((p["iso_year"], p["iso_week"])); log.append((f"'{a['details'] or a['id']}' · WK{p['iso_week']} ({p['month_key']})", curv / 1000, new / 1000, a["id"], p["id"]))
                elif kind == "info":
                    p = pm.get(ch.get("period_id")); k = ch.get("kind")
                    if not p or k not in ("leave", "ph"): raise HTTPException(404, "Unknown period")
                    try: new = parse_days(ch.get("new"))
                    except ValueError as ex: raise HTTPException(422, str(ex))
                    r = c.execute("SELECT milli FROM info WHERE tracker_id=? AND period_id=? AND kind=?", (tid, p["id"], k)).fetchone(); curv = r["milli"] if r else 0
                    if curv != int(ch.get("old", 0)): conflicts.append({"key": f"i:{k}:{p['id']}", "current": curv}); continue
                    c.execute("DELETE FROM info WHERE tracker_id=? AND period_id=? AND kind=?", (tid, p["id"], k))
                    if new: c.execute("INSERT INTO info VALUES(?,?,?,?)", (tid, p["id"], k, new))
                    wk.add((p["iso_year"], p["iso_week"])); log.append((f"{'Leave' if k == 'leave' else 'PH holidays'} · WK{p['iso_week']} ({p['month_key']})", curv / 1000, new / 1000, None, p["id"]))
                elif kind == "field":
                    a = c.execute("SELECT * FROM activities WHERE id=? AND tracker_id=?", (ch.get("activity_id"), tid)).fetchone(); f = ch.get("field")
                    if not a or f not in FIELDS: raise HTTPException(404, "Unknown activity or field")
                    new = str(ch.get("new", "")).strip()
                    if f == "progress":
                        if not new.isdigit() or int(new) > 100: raise HTTPException(422, "Progress must be a whole number between 0 and 100")
                        new = int(new)
                    if f == "status" and new not in ("Completed", "WIP"): raise HTTPException(422, "Status must be Completed or WIP")
                    if str(a[f]) != str(ch.get("old", "")): conflicts.append({"key": f"f:{a['id']}:{f}", "current": a[f]}); continue
                    c.execute(f"UPDATE activities SET {f}=? WHERE id=?", (new, a["id"])); log.append((f"'{a['details'] or a['id']}' · {f}", a[f], new, a["id"], None))
                else: raise HTTPException(422, "Unknown change type")
            if conflicts: raise HTTPException(409, {"message": "Some values were changed by someone else since you loaded the page.", "conflicts": conflicts})
            bad = []
            for pid in touched:  # capacity is checked on the COLUMN total (all activities, archived included), after applying changes
                tot = c.execute("SELECT COALESCE(SUM(e.milli),0) AS v FROM entries e JOIN activities a ON a.id=e.activity_id WHERE a.tracker_id=? AND e.period_id=?", (tid, pid)).fetchone()["v"]
                if tot > pm[pid]["capacity"] * 1000: bad.append(f"{pm[pid]['month_key']} WK{pm[pid]['iso_week']}: {tot/1000:g} days entered, only {pm[pid]['capacity']} available")
            if bad: raise HTTPException(422, {"message": "Capacity exceeded — " + "; ".join(bad), "capacity": bad})
            for w_, o, n, aid, pid in log: c.execute(HIST, (batch, tid, u["id"], now(), w_, sv(o), sv(n), aid, pid))
            txt = (b.comment or "").strip()
            if txt:
                scopes = set() if b.general else set(wk)  # automatic: every ISO week touched by the batch; explicit weeks can be added; none -> general comment
                if not b.general:
                    for x in (b.weeks or [])[:60]:
                        m = WEEK.match(x or "")
                        if not m or not 1 <= int(m.group(2)) <= 53: raise HTTPException(422, f"Invalid week '{x}' (expected 2026-39)")
                        scopes.add((int(m.group(1)), int(m.group(2))))
                first = sorted(scopes)[0] if scopes else (None, None)
                cid = c.execute("INSERT INTO comments(tracker_id,author_id,iso_year,iso_week,text,created,batch) VALUES(?,?,?,?,?,?,?) RETURNING id", (tid, u["id"], first[0], first[1], txt[:4000], now(), batch)).fetchone()["id"]
                for y, k in scopes: c.execute("INSERT INTO comment_scopes VALUES(?,?,?)", (cid, y, k))
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK"); raise
    return {"ok": True, "changes": len(log)}

from fastapi.staticfiles import StaticFiles
STATIC = E("STATIC_DIR", os.path.join(ROOT, "static"))
@app.get("/")
def index(): return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})
if os.path.isdir(os.path.join(STATIC, "assets")): app.mount("/assets", StaticFiles(directory=os.path.join(STATIC, "assets")), name="assets")
