import os, pytest, psycopg
from fastapi.testclient import TestClient
from alembic import command
from alembic.config import Config
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RNG = "from=2026-08-01&to=2027-01-31"

@pytest.fixture()
def env(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL", "postgresql://tracker:tracker@localhost:5432/tracker_test")
    with psycopg.connect(url, autocommit=True) as k: k.execute("DROP SCHEMA public CASCADE"); k.execute("CREATE SCHEMA public")
    monkeypatch.setenv("DATABASE_URL", url); monkeypatch.setenv("COOKIE_SECURE", "false")
    command.upgrade(Config(os.path.join(ROOT, "alembic.ini")), "head")  # real migrations, not create_all
    monkeypatch.setenv("ADMIN_EMAIL", "boss@x.com"); monkeypatch.setenv("ADMIN_PASSWORD", "Admin-pass-1")
    monkeypatch.setenv("APP_URL", "https://tracker.example.org"); monkeypatch.setenv("EMAIL_MODE", "console")
    import app; app.init(); app.FAILS.clear(); app.IP_ATTEMPTS.clear()
    return app

def client(app, email, pw):
    c = TestClient(app.app); r = c.post("/api/login", json={"email": email, "password": pw}); assert r.status_code == 200, r.text; return c

def make_user(app, adm, email, name):
    r = adm.post("/api/users", json={"email": email, "name": name}); assert r.status_code == 200, r.text
    tok = adm.get("/api/emails").json()[0]["body"].split("/set-password/")[1].split()[0]
    assert TestClient(app.app).post("/api/set-password", json={"token": tok, "password": "Employee-pw-1"}).status_code == 200
    return client(app, email, "Employee-pw-1")

@pytest.fixture()
def world(env):
    app = env; adm = client(app, "boss@x.com", "Admin-pass-1")
    a = make_user(app, adm, "a@gmail.com", "Alice"); b = make_user(app, adm, "b@outlook.com", "Bob")
    ta, tb = a.get("/api/me").json()["tracker_id"], b.get("/api/me").json()["tracker_id"]
    adm.put(f"/api/trackers/{ta}", json={"client": "Acme", "start_date": "2026-09-01"})
    def period(iy, iw, mk):
        return next(p for p in adm.get(f"/api/trackers/{ta}?{RNG}").json()["periods"] if (p["iso_year"], p["iso_week"], p["month_key"]) == (iy, iw, mk))
    def act(cl, tid):
        return cl.post(f"/api/trackers/{tid}/activities").json()["id"]
    return dict(app=app, adm=adm, a=a, b=b, ta=ta, tb=tb, period=period, act=act)

def cell(aid, pid, new, old=0): return {"type": "cell", "activity_id": aid, "period_id": pid, "old": old, "new": new}
def save(cl, tid, ch, **kw): return cl.post(f"/api/trackers/{tid}/save", json={"changes": ch, **kw})

def test_isolation(world):
    w = world; a1 = w["act"](w["a"], w["ta"])
    assert w["b"].get(f"/api/trackers/{w['ta']}?{RNG}").status_code == 404
    assert save(w["b"], w["ta"], []).status_code == 404
    p = w["period"](2026, 40, "2026-09")
    assert save(w["b"], w["tb"], [cell(a1, p["id"], "1")]).status_code == 404  # another tracker's activity
    assert w["b"].post(f"/api/activities/{a1}/archive", json={"archived": True}).status_code == 404
    assert w["b"].get("/api/users").status_code == 403 and w["b"].post("/api/users", json={"email": "z@z.com", "name": "Z"}).status_code == 403
    assert TestClient(w["app"].app).get(f"/api/trackers/{w['ta']}?{RNG}").status_code == 401
    assert w["adm"].get(f"/api/trackers/{w['ta']}?{RNG}").status_code == 200

def test_shared_week_capacity_and_sums(world):
    w = world; a1, a2 = w["act"](w["a"], w["ta"]), w["act"](w["a"], w["ta"])
    sep, octo = w["period"](2026, 40, "2026-09"), w["period"](2026, 40, "2026-10")
    assert (sep["capacity"], octo["capacity"]) == (3, 2) and sep["id"] != octo["id"]
    assert w["period"](2026, 36, "2026-09")["capacity"] == 4
    with w["app"].db() as c: assert c.execute("SELECT capacity FROM periods WHERE iso_year=2026 AND iso_week=36 AND month_key='2026-08'").fetchone()["capacity"] == 1  # Mon 31 Aug
    assert save(w["a"], w["ta"], [cell(a1, sep["id"], "2"), cell(a2, sep["id"], "1"), cell(a1, octo["id"], "1"), cell(a2, octo["id"], "0,75")]).status_code == 200  # exactly capacity in Sept
    d = w["a"].get(f"/api/trackers/{w['ta']}?{RNG}").json()
    assert d["col_totals"][str(sep["id"])] == 3000 and d["col_totals"][str(octo["id"])] == 1750
    assert d["month_totals"]["2026-09"] == 3000 and d["month_totals"]["2026-10"] == 1750
    r = save(w["a"], w["ta"], [cell(a2, sep["id"], "1,25", 1000)])  # column total 3.25 > 3 even though each cell is small
    assert r.status_code == 422 and "capacity" in r.json()["detail"]["message"].lower()
    assert w["a"].get(f"/api/trackers/{w['ta']}?{RNG}").json()["col_totals"][str(sep["id"])] == 3000  # nothing partially applied

def test_bl_equals_monthwise_and_archive_keeps_days(world):
    w = world; a1, a2 = w["act"](w["a"], w["ta"]), w["act"](w["a"], w["ta"])
    p1, p2 = w["period"](2026, 38, "2026-09"), w["period"](2026, 39, "2026-09")
    save(w["a"], w["ta"], [cell(a1, p1["id"], "1.5"), cell(a1, p2["id"], "0.5"), cell(a2, p2["id"], "3,5")])
    assert w["a"].post(f"/api/activities/{a1}/archive", json={"archived": True}).status_code == 200
    d = w["a"].get(f"/api/trackers/{w['ta']}?{RNG}").json()
    assert d["month_totals"]["2026-09"] == 5500 and d["col_totals"][str(p2["id"])] == 4000
    assert sum(d["bl"][k].get("2026-09", 0) for k in d["bl"]) == d["month_totals"]["2026-09"]
    assert save(w["a"], w["ta"], [cell(a1, p1["id"], "2", 1500)]).status_code == 422  # archived = read-only

def test_decimals(env):
    from app import parse_days as pd
    assert (pd("0,5"), pd("0.75"), pd("1,25"), pd("5,875"), pd(""), pd("3")) == (500, 750, 1250, 5875, 0, 3000)
    for bad in ("1,2,3", "1.234,5", "abc", "-1", "0.0001", "1e2"):
        with pytest.raises(ValueError): pd(bad)
    assert pd("0.1") + pd("0.2") == pd("0.3")  # exact, no float drift

def test_capacity_boundary_decimal(world):
    w = world; a1 = w["act"](w["a"], w["ta"]); p = w["period"](2026, 40, "2026-09")
    assert save(w["a"], w["ta"], [cell(a1, p["id"], "3,001")]).status_code == 422
    assert save(w["a"], w["ta"], [cell(a1, p["id"], "3.000")]).status_code == 200
    assert save(w["a"], w["ta"], [cell(a1, p["id"], "1,2,3", 3000)]).status_code == 422

def test_conflicts_and_attribution(world):
    w = world; a1 = w["act"](w["a"], w["ta"]); p, q = w["period"](2026, 38, "2026-09"), w["period"](2026, 39, "2026-09")
    assert save(w["a"], w["ta"], [cell(a1, p["id"], "1")]).status_code == 200
    r = save(w["adm"], w["ta"], [cell(a1, p["id"], "2", 0)])  # admin still thinks the cell is empty
    assert r.status_code == 409 and r.json()["detail"]["conflicts"][0]["current"] == 1000
    assert save(w["adm"], w["ta"], [cell(a1, q["id"], "1")], comment="Manager fix").status_code == 200  # different cell: fine
    d = w["a"].get(f"/api/trackers/{w['ta']}?{RNG}").json()
    assert d["entries"][str(a1)][str(p["id"])] == 1000 and d["entries"][str(a1)][str(q["id"])] == 1000
    cm = w["a"].get(f"/api/trackers/{w['ta']}/comments").json()["items"]; hs = w["a"].get(f"/api/trackers/{w['ta']}/history").json()["items"]
    assert cm[0]["author"] == "Manager" and cm[0]["scopes"] == [[2026, 39]] and any(h["author_role"] == "admin" for h in hs)  # scope auto-detected from the touched cell

def test_optional_comment_and_field_validation(world):
    w = world; a1 = w["act"](w["a"], w["ta"])
    assert save(w["a"], w["ta"], [{"type": "field", "activity_id": a1, "field": "details", "old": "", "new": "Review"}]).status_code == 200
    assert w["a"].get(f"/api/trackers/{w['ta']}/comments").json()["total"] == 0
    assert save(w["a"], w["ta"], [{"type": "field", "activity_id": a1, "field": "progress", "old": 0, "new": "150"}]).status_code == 422
    assert save(w["a"], w["ta"], [{"type": "field", "activity_id": a1, "field": "status", "old": "WIP", "new": "Done"}]).status_code == 422

def test_persistence_across_connections(world):
    w = world; a1 = w["act"](w["a"], w["ta"]); p = w["period"](2026, 39, "2026-09")
    save(w["a"], w["ta"], [cell(a1, p["id"], "0.5")]); save(w["a"], w["ta"], [], comment="Week39 – done", weeks=["2026-39"])
    import importlib; importlib.reload(w["app"])  # simulate a restart: new process state, same DB file
    c = client(w["app"], "a@gmail.com", "Employee-pw-1"); d = c.get(f"/api/trackers/{w['ta']}?{RNG}").json()
    assert d["entries"][str(a1)][str(p["id"])] == 500 and c.get(f"/api/trackers/{w['ta']}/comments").json()["items"][0]["text"] == "Week39 – done"

def test_email_link_failure_and_retry(world, monkeypatch):
    w = world; app = w["app"]
    body = w["adm"].get("/api/emails").json()[0]["body"]; assert "https://tracker.example.org/#/set-password/" in body
    monkeypatch.setenv("EMAIL_MODE", "resend"); monkeypatch.setenv("RESEND_API_KEY", "bad")
    monkeypatch.setattr(app.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("network down")))
    r = w["adm"].post("/api/users", json={"email": "c@yahoo.fr", "name": "Chloé"}); assert r.status_code == 200 and r.json()["email_status"] == "failed"
    uid = r.json()["id"]; assert [u for u in w["adm"].get("/api/users").json() if u["id"] == uid][0]["last_email"] == "failed"
    monkeypatch.setattr(app.urllib.request, "urlopen", lambda *a, **k: None)
    assert w["adm"].post(f"/api/users/{uid}/resend").json()["email_status"] == "sent"

def test_token_single_use_and_login_throttle(world):
    w = world; app = w["app"]
    w["adm"].post("/api/users", json={"email": "d@x.com", "name": "D"}); tok = w["adm"].get("/api/emails").json()[0]["body"].split("/set-password/")[1].split()[0]
    c = TestClient(app.app)
    assert c.post("/api/set-password", json={"token": tok, "password": "short"}).status_code == 422
    assert c.post("/api/set-password", json={"token": tok, "password": "Longenough-1"}).status_code == 200
    assert c.post("/api/set-password", json={"token": tok, "password": "Longenough-2"}).status_code == 400
    codes = [c.post("/api/login", json={"email": "d@x.com", "password": "wrong"}).status_code for _ in range(6)]
    assert codes[-1] == 429

def test_cookie_flags_local_and_https(world, monkeypatch):
    def sc(secure):
        monkeypatch.setenv("COOKIE_SECURE", secure); r = TestClient(world["app"].app).post("/api/login", json={"email": "boss@x.com", "password": "Admin-pass-1"})
        return r.headers["set-cookie"].lower()
    local, https = sc("false"), sc("true")
    assert "httponly" in local and "samesite=lax" in local and "secure" not in local
    assert "httponly" in https and "samesite=lax" in https and "secure" in https

def test_excel_export_matches_app(world):
    import io; from openpyxl import load_workbook
    w = world; a1, a2 = w["act"](w["a"], w["ta"]), w["act"](w["a"], w["ta"]); s40, o40, s39 = w["period"](2026, 40, "2026-09"), w["period"](2026, 40, "2026-10"), w["period"](2026, 39, "2026-09")
    assert save(w["a"], w["ta"], [{"type": "field", "activity_id": a1, "field": "details", "old": "", "new": "Review SwDS"}, cell(a1, s39["id"], "0,5"), cell(a2, s39["id"], "3.5"), cell(a1, s40["id"], "2"), cell(a1, o40["id"], "1,25"),
        {"type": "info", "kind": "leave", "period_id": s40["id"], "old": 0, "new": "1"}], comment="Week39 – Review in progress").status_code == 200
    w["a"].post(f"/api/activities/{a2}/archive", json={"archived": True})
    r = w["a"].get(f"/api/trackers/{w['ta']}/export.xlsx?scope=range&{RNG}"); assert r.status_code == 200 and "Weekly_Status_Alice" in r.headers["content-disposition"]
    assert w["b"].get(f"/api/trackers/{w['ta']}/export.xlsx?scope=range&{RNG}").status_code == 404
    wb = load_workbook(io.BytesIO(r.content)); ws = wb["Weekly Status"]; d = w["a"].get(f"/api/trackers/{w['ta']}?{RNG}").json()
    rows = {str(ws.cell(r_, 1).value): r_ for r_ in range(1, ws.max_row + 1) if ws.cell(r_, 1).value}
    for p in d["periods"]:
        c_ = 7 + d["periods"].index(p); assert ws.cell(10, c_).value == f"WEEK{p['iso_week']}" and ws.cell(11, c_).value.startswith(str(p["capacity"]))
        assert (ws.cell(rows["Actual days spent on activity / week :"], c_).value or 0) == d["col_totals"].get(str(p["id"]), 0) / 1000
    assert ws.cell(rows["Review SwDS"], 7 + d["periods"].index(s39 and next(p for p in d["periods"] if p["id"] == s39["id"]))).value == 0.5
    bl = wb["Monthly BL"]; last = {bl.cell(r_, 1).value: [bl.cell(r_, c).value for c in range(3, bl.max_column + 1)] for r_ in range(1, bl.max_row + 1)}
    ms = sorted(d["month_totals"]); assert last["Monthwise (in days)"] == [d["month_totals"][m] / 1000 for m in ms] and last["Total BL"] == last["Monthwise (in days)"]
    assert any("archived" in str(bl.cell(r_, 1).value) for r_ in range(1, bl.max_row + 1))  # archived days still counted
    assert wb["Summary report"]["D2"].value == "Week39 – Review in progress" and wb["Summary report"]["C2"].value == "WEEK39/2026, WEEK40/2026" and "Weekly Status" in wb.sheetnames

def test_seed_never_overwrites_existing_accounts(env):
    import seed
    c = TestClient(env.app); out = seed.run()
    assert any("passwords NOT changed" in l and "boss@x.com" in l for l in out) and not any("manager@example.com /" in l for l in out)
    assert TestClient(env.app).post("/api/login", json={"email": "boss@x.com", "password": "Admin-pass-1"}).status_code == 200  # admin password untouched
    assert TestClient(env.app).post("/api/login", json={"email": "manager@example.com", "password": "Demo-12345"}).status_code == 401  # no fake demo manager
    assert TestClient(env.app).post("/api/login", json={"email": "marco@example.com", "password": "Demo-12345"}).status_code == 200
    with env.db() as k: k.execute("UPDATE users SET pw=? WHERE email='marco@example.com'", (env.hash_pw("Changed-by-user-1"),))
    out2 = seed.run(); assert sum("left untouched" in l for l in out2) == 2
    assert TestClient(env.app).post("/api/login", json={"email": "marco@example.com", "password": "Changed-by-user-1"}).status_code == 200  # still the user's password

def test_seed_creates_demo_manager_only_when_no_admin(env, monkeypatch):
    import seed
    monkeypatch.delenv("ADMIN_EMAIL"); monkeypatch.delenv("ADMIN_PASSWORD")
    with env.db() as k: k.execute("DELETE FROM users")
    out = seed.run(); assert out[0] == "Manager created: manager@example.com / Demo-12345"
    assert TestClient(env.app).post("/api/login", json={"email": "manager@example.com", "password": "Demo-12345"}).status_code == 200

def test_health_and_calendar_extension(env):
    assert TestClient(env.app).get("/api/health").json() == {"ok": True}
    with env.db() as k:
        n0 = k.execute("SELECT count(*) AS n FROM periods").fetchone()["n"]; env.gen_periods(k); assert k.execute("SELECT count(*) AS n FROM periods").fetchone()["n"] == n0  # idempotent
        env.gen_periods(k, y1=2031)
        assert k.execute("SELECT count(*) AS n FROM periods WHERE iso_year=2031").fetchone()["n"] > 50
        assert k.execute("SELECT capacity FROM periods WHERE p_start='2026-12-28'").fetchone()["capacity"] == 4  # WK53: Mon-Thu in Dec
        assert k.execute("SELECT capacity FROM periods WHERE p_start='2027-01-01'").fetchone()["capacity"] == 1  # WK53: Fri 1 Jan 2027

# ======================= V4 =======================
def login_pw(app, email, pw): return TestClient(app.app), None

def test_migrations_preserve_v3_data(monkeypatch):
    import app as appmod
    url = os.getenv("TEST_DATABASE_URL", "postgresql://tracker:tracker@localhost:5432/tracker_test"); monkeypatch.setenv("DATABASE_URL", url)
    with psycopg.connect(url, autocommit=True) as k: k.execute("DROP SCHEMA public CASCADE"); k.execute("CREATE SCHEMA public")
    cfg = Config(os.path.join(ROOT, "alembic.ini")); command.upgrade(cfg, "0001")   # a V3 database
    with psycopg.connect(url, autocommit=True) as k:
        pw = appmod.hash_pw("Old-pass-123")
        k.execute("INSERT INTO users(email,name,role,pw) VALUES('boss@x.com','Boss','admin',%s),('e@x.com','Emp','employee',%s)", (pw, pw))
        k.execute("INSERT INTO trackers(owner_id,client,start_date) VALUES(2,'Alstom','2026-09-01')")
        appmod.gen_periods(appmod.Conn(psycopg.connect(url, autocommit=True, row_factory=psycopg.rows.dict_row)), 2026, 2026)
        k.execute("INSERT INTO activities(tracker_id,pos,details) VALUES(1,1,'Review')")
        pid = k.execute("SELECT id FROM periods WHERE iso_year=2026 AND iso_week=40 AND month_key='2026-10'").fetchone()[0]
        k.execute("INSERT INTO entries VALUES(1,%s,1500)", (pid,))
        k.execute("INSERT INTO comments(tracker_id,author_id,iso_year,iso_week,text,created) VALUES(1,2,2026,39,'Week39 – old comment','2026-09-28T10:00:00')")
        k.execute("INSERT INTO history(batch,tracker_id,author_id,at,what,old,new) VALUES('b',1,2,'2026-09-28T10:00:00',%s,'0','1.5')", ("'Review' · WK40 (2026-10)",))
    command.upgrade(cfg, "head")
    with psycopg.connect(url, autocommit=True) as k:
        assert k.execute("SELECT count(*) FROM users").fetchone()[0] == 2 and k.execute("SELECT milli FROM entries").fetchone()[0] == 1500
        assert k.execute("SELECT must_change_password FROM users WHERE id=1").fetchone()[0] == 0
        assert k.execute("SELECT client FROM trackers").fetchone()[0] == "Alstom"                                   # legacy value kept
        assert k.execute("SELECT iso_year,iso_week FROM comment_scopes WHERE comment_id=1").fetchone() == (2026, 39)  # old comment keeps its week
        assert k.execute("SELECT text FROM comments").fetchone()[0] == "Week39 – old comment"
        assert k.execute("SELECT period_id FROM history").fetchone()[0] == pid                                       # backfilled from the old text
        k.execute("INSERT INTO trackers(owner_id,start_date) VALUES(1,'2026-09-01')")                                # client no longer mandatory
    appmod.init()
    assert TestClient(appmod.app).post("/api/login", json={"email": "boss@x.com", "password": "Old-pass-123"}).status_code == 200  # passwords untouched
    command.downgrade(cfg, "0001"); command.upgrade(cfg, "head")   # reversible

def test_period_navigation_is_independent_and_lossless(world):
    w = world; adm, a, ta = w["adm"], w["a"], w["ta"]
    a1 = w["act"](a, ta); p = w["period"](2026, 40, "2026-10"); assert save(a, ta, [cell(a1, p["id"], "1.5")]).status_code == 200
    cur = adm.get(f"/api/trackers/{ta}").json()                       # default view = current month, whatever the mission dates are
    today = __import__("datetime").date.today(); assert cur["range"]["from"] == today.replace(day=1).isoformat()
    q = adm.get(f"/api/trackers/{ta}?from=2026-07-01&to=2026-09-30").json()   # quarter
    assert [pp["month_key"] for pp in q["periods"] if pp["month_key"] == "2026-07"] and q["month_complete"]["2026-07"] is True
    partial = adm.get(f"/api/trackers/{ta}?from=2026-09-28&to=2026-10-02").json()
    assert partial["month_complete"] == {"2026-09": False, "2026-10": False}
    assert adm.get(f"/api/trackers/{ta}?from=2018-01-01&to=2018-03-31").json()["periods"][0]["start"].startswith("2018")   # old periods generated on demand, no horizon
    assert adm.get(f"/api/trackers/{ta}?from=2045-01-01&to=2045-01-31").status_code == 200
    assert adm.get(f"/api/trackers/{ta}?from=2026-10-05&to=2026-10-01").status_code == 422 and adm.get(f"/api/trackers/{ta}?from=2000-01-01&to=2020-01-01").status_code == 422
    # employee view is not influenced by what the manager looked at
    assert a.get(f"/api/trackers/{ta}").json()["range"] == cur["range"]
    # mission dates change: nothing deleted, old entries still readable and editable
    assert adm.put(f"/api/trackers/{ta}", json={"work_package": "WP", "start_date": "2026-11-01", "end_date": "2026-12-31"}).status_code == 200
    d = adm.get(f"/api/trackers/{ta}?{RNG}").json(); assert d["entries"][str(a1)][str(p["id"])] == 1500 and d["bounds"]["all_total"] == 1500
    assert save(a, ta, [cell(a1, p["id"], "1", 1500)]).status_code == 200                       # outside mission but already has data: correction allowed
    other = w["period"](2026, 38, "2026-09"); assert save(a, ta, [cell(a1, other["id"], "1")]).status_code == 200   # retroactive entry allowed even outside mission dates
    assert adm.put(f"/api/trackers/{ta}", json={"work_package": "WP", "start_date": "2026-09-01"}).status_code == 200   # no end date: continues automatically, no client needed
    mar = next(p for p in adm.get(f"/api/trackers/{ta}?from=2027-03-01&to=2027-03-31").json()["periods"] if p["iso_week"] == 10)
    assert save(a, ta, [cell(a1, mar["id"], "1")]).status_code == 200

def test_multi_week_comments_and_pagination(world):
    w = world; a, ta = w["a"], w["ta"]; a1 = w["act"](a, ta)
    s39, s40, o40 = w["period"](2026, 39, "2026-09"), w["period"](2026, 40, "2026-09"), w["period"](2026, 40, "2026-10")
    assert save(a, ta, [cell(a1, s39["id"], "1"), cell(a1, s40["id"], "1"), cell(a1, o40["id"], "1")], comment="Two weeks done").status_code == 200
    items = a.get(f"/api/trackers/{ta}/comments").json()["items"]; assert items[0]["scopes"] == [[2026, 39], [2026, 40]]   # WK40 listed once (two month parts)
    assert save(a, ta, [{"type": "field", "activity_id": a1, "field": "details", "old": "", "new": "Text only"}], comment="Renamed").status_code == 200
    assert a.get(f"/api/trackers/{ta}/comments?week=general").json()["total"] == 1
    assert save(a, ta, [], comment="Weeks 41-43", weeks=["2026-41", "2026-42", "2026-43"]).status_code == 200
    assert save(a, ta, [], comment="Overall", general=True).status_code == 200
    assert save(a, ta, [], comment="bad", weeks=["2026-99"]).status_code == 422 and save(a, ta, [], comment="bad", weeks=["x"]).status_code == 422
    assert a.get(f"/api/trackers/{ta}/comments?week=2026-42").json()["total"] == 1 and a.get(f"/api/trackers/{ta}/comments?week=2026-39").json()["total"] == 1
    with w["app"].db() as k:   # 230 comments > the old 200 limit, 350 history rows > the old 300 limit
        uid = k.execute("SELECT owner_id FROM trackers WHERE id=?", (ta,)).fetchone()["owner_id"]
        for i in range(230): k.execute("INSERT INTO comments(tracker_id,author_id,text,created) VALUES(?,?,?,?)", (ta, uid, f"bulk {i}", "2026-01-01T00:00:00"))
        for i in range(350): k.execute("INSERT INTO history(batch,tracker_id,author_id,at,what,old,new,activity_id) VALUES('x',?,?,?,?,?,?,?)", (ta, uid, "2026-01-01T00:00:00", f"bulk {i}", "0", "1", a1))
    tot = a.get(f"/api/trackers/{ta}/comments?limit=100").json()["total"]; seen, off = [], 0
    while True:
        r = a.get(f"/api/trackers/{ta}/comments?limit=100&offset={off}").json(); seen += [x["id"] for x in r["items"]]; off += 100
        if off >= r["total"]: break
    assert tot == len(seen) == len(set(seen)) >= 234
    h = a.get(f"/api/trackers/{ta}/history?limit=200").json(); assert h["total"] >= 355 and len(h["items"]) == 200 and a.get(f"/api/trackers/{ta}/history?limit=200&offset=200").json()["items"]
    assert a.get(f"/api/trackers/{ta}/history?activity_id={a1}&limit=1").json()["total"] >= 350
    assert a.get(f"/api/trackers/{ta}/history?week=2026-40").json()["total"] == 2 and a.get(f"/api/trackers/{ta}/history?month=2026-10").json()["total"] == 1
    assert a.get(f"/api/trackers/{ta}/history?author_id=999").json()["total"] == 0 and a.get(f"/api/trackers/{ta}/comments?q=Overall").json()["total"] == 1
    assert w["b"].get(f"/api/trackers/{ta}/comments").status_code == 404 and w["b"].get(f"/api/trackers/{ta}/history").status_code == 404

def test_export_scopes_and_all_comments(world):
    import io; from openpyxl import load_workbook
    w = world; a, ta = w["a"], w["ta"]; a1 = w["act"](a, ta)
    s39, o40, n45 = w["period"](2026, 39, "2026-09"), w["period"](2026, 40, "2026-10"), w["period"](2026, 46, "2026-11")
    assert save(a, ta, [cell(a1, s39["id"], "2"), cell(a1, o40["id"], "1,25"), cell(a1, n45["id"], "0.75")], comment="three months").status_code == 200
    with w["app"].db() as k:
        uid = k.execute("SELECT owner_id FROM trackers WHERE id=?", (ta,)).fetchone()["owner_id"]
        for i in range(260): k.execute("INSERT INTO comments(tracker_id,author_id,text,created) VALUES(?,?,?,?)", (ta, uid, f"general {i}", "2026-01-01T00:00:00"))
    def get(q): r = a.get(f"/api/trackers/{ta}/export.xlsx?{q}"); assert r.status_code == 200, r.text; return load_workbook(io.BytesIO(r.content))
    ws = get("scope=view&from=2026-09-01&to=2026-09-30")["Weekly Status"]
    vals = [c.value for row in ws.iter_rows() for c in row if c.value is not None]; assert "Estimation" in vals and not any("Alstom" in str(v) for v in vals) and "Sep-26" in vals and "Oct-26" not in vals
    wb = get("scope=range&from=2026-09-01&to=2026-11-30"); sm = wb["Summary report"]
    assert sm.max_row == 1 + 261 and any(c.value == "WEEK39/2026, WEEK40/2026, WEEK46/2026" for row in sm.iter_rows() for c in row)   # ALL comments (>200) + the multi-week scope
    bl = wb["Monthly BL"]; last = {bl.cell(r_, 1).value: [bl.cell(r_, c).value for c in range(3, bl.max_column + 1)] for r_ in range(1, bl.max_row + 1)}
    assert last["Total BL"] == last["Monthwise (in days)"] == [2.0, 1.25, 0.75]
    allx = get("scope=all"); b2 = allx["Monthly BL"]; assert sum(c.value for c in b2[b2.max_row] if isinstance(c.value, (int, float))) >= 4.0
    assert a.get(f"/api/trackers/{ta}/export.xlsx?scope=range&from=2026-09-28&to=2026-10-02").status_code == 200   # partial months flagged with *
    ws3 = load_workbook(io.BytesIO(a.get(f"/api/trackers/{ta}/export.xlsx?scope=range&from=2026-09-28&to=2026-10-02").content))["Weekly Status"]
    assert any("*" in str(c.value) for row in ws3.iter_rows() for c in row if c.value)
    assert a.get(f"/api/trackers/{ta}/export.xlsx?scope=nope").status_code == 422 and a.get(f"/api/trackers/{ta}/export.xlsx?scope=range&from=2000-01-01&to=2030-01-01").status_code == 422

def test_temporary_passwords(world):
    w = world; app, adm = w["app"], w["adm"]
    r = adm.post("/api/users", json={"email": "t@x.com", "name": "Temp", "mode": "temp_password", "temp_password": "Temp-pass-1"}); assert r.status_code == 200 and r.json()["email_status"].startswith("none")
    assert adm.post("/api/users", json={"email": "t2@x.com", "name": "T2", "mode": "temp_password", "temp_password": "short"}).status_code == 422
    assert not any(m["to_addr"] == "t@x.com" for m in adm.get("/api/emails").json())                      # no email for this account
    c = TestClient(app.app); assert c.post("/api/login", json={"email": "t@x.com", "password": "Temp-pass-1"}).json()["must_change_password"] is True
    tid = c.get("/api/me").json()["tracker_id"]; assert c.get(f"/api/trackers/{tid}").status_code == 403 and c.get(f"/api/trackers/{tid}").json()["detail"]["code"] == "password_change_required"
    c2 = TestClient(app.app); c2.post("/api/login", json={"email": "t@x.com", "password": "Temp-pass-1"})   # a second session
    assert c.post("/api/change-password", json={"current": "wrong", "new": "New-pass-123"}).status_code == 422
    assert c.post("/api/change-password", json={"current": "Temp-pass-1", "new": "Temp-pass-1"}).status_code == 422
    assert c.post("/api/change-password", json={"current": "Temp-pass-1", "new": "New-pass-123"}).status_code == 200
    assert c.get(f"/api/trackers/{tid}").status_code == 200 and c2.get("/api/me").status_code == 401        # other sessions revoked
    assert TestClient(app.app).post("/api/login", json={"email": "t@x.com", "password": "Temp-pass-1"}).status_code == 401
    # admin sets a new temporary password on an existing account (Alice already activated by invitation)
    old = w["a"]; uid = [u for u in adm.get("/api/users").json() if u["email"] == "a@gmail.com"][0]["id"]
    adm.post(f"/api/users/{uid}/resend"); pending_link = adm.get("/api/emails").json()[0]["body"].split("/set-password/")[1].split()[0]
    assert w["b"].post(f"/api/users/{uid}/temp-password", json={"password": "Whatever-123"}).status_code == 403
    assert adm.post(f"/api/users/{uid}/temp-password", json={"password": "Admin-set-123"}).status_code == 200
    assert old.get("/api/me").status_code == 401                                                                # old sessions revoked
    assert TestClient(app.app).post("/api/set-password", json={"token": pending_link, "password": "Hijack-1234"}).status_code == 400   # pending link now useless
    assert TestClient(app.app).post("/api/login", json={"email": "a@gmail.com", "password": "Employee-pw-1"}).status_code == 401
    assert TestClient(app.app).post("/api/login", json={"email": "a@gmail.com", "password": "Admin-set-123"}).json()["must_change_password"] is True
    assert adm.post(f"/api/users/{[u for u in adm.get('/api/users').json() if u['email'] == 'boss@x.com'][0]['id']}/temp-password", json={"password": "Self-pass-123"}).status_code == 422
    with w["app"].db() as k:   # only hashes are stored; no plaintext anywhere in the database
        dump = " ".join(str(v) for tb in ("users", "emails", "history", "comments", "tokens", "sessions") for r_ in k.execute(f"SELECT * FROM {tb}").fetchall() for v in r_.values())
    assert all(p not in dump for p in ("Temp-pass-1", "New-pass-123", "Admin-set-123", "Employee-pw-1"))
    # invitation flow still works
    make_user(app, adm, "inv@x.com", "Inv")

def test_client_field_not_required(world):
    w = world
    with w["app"].db() as k: assert k.execute("SELECT client FROM trackers WHERE id=?", (w["tb"],)).fetchone()["client"] is None   # new accounts have no client
    assert w["adm"].put(f"/api/trackers/{w['tb']}", json={"work_package": "X", "start_date": "2026-09-01"}).status_code == 200
