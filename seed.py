"""Fictional demo data (inspired by the screenshots). Never overwrites an existing account or password.
Usage: python seed.py   (Docker: docker compose exec app python seed.py)"""
import app
from app import db, hash_pw
DEMO_PW = "Demo-12345"
EMPLOYEES = (("marco@example.com", "Marco Demo"), ("kavi@example.com", "Kavi Demo"))

def run():
    app.init(); out = []
    with db() as c:
        admins = [r["email"] for r in c.execute("SELECT email FROM users WHERE role='admin' ORDER BY id")]
        if admins:
            out.append("Manager account(s) already exist: " + ", ".join(admins) + " - passwords NOT changed. Sign in with ADMIN_EMAIL / ADMIN_PASSWORD from your .env.")
        else:
            c.execute("INSERT INTO users(email,name,role,pw) VALUES('manager@example.com','Manager','admin',?)", (hash_pw(DEMO_PW),))
            out.append(f"Manager created: manager@example.com / {DEMO_PW}")
        for em, nm in EMPLOYEES:
            if c.execute("SELECT 1 FROM users WHERE email=?", (em,)).fetchone():
                out.append(f"{em}: already exists, left untouched (password unchanged, no data added)"); continue
            uid = c.execute("INSERT INTO users(email,name,role,pw) VALUES(?,?,'employee',?) RETURNING id", (em, nm, hash_pw(DEMO_PW))).fetchone()["id"]
            tid = c.execute("INSERT INTO trackers(owner_id,client,work_package,start_date,end_date) VALUES(?,?,?,?,?) RETURNING id", (uid, "Alstom", "TCMS WorkPackage : VTE peer Review German Range", "2026-09-21", "2027-03-31")).fetchone()["id"]
            wk39 = c.execute("SELECT id FROM periods WHERE iso_year=2026 AND iso_week=39 AND month_key='2026-09'").fetchone()["id"]
            for i, (d, done, prog, days) in enumerate([("KoM, study the checklist", 1, 100, 500), ("Review documents SwDS Vs ADL1, SwRS, SwSC", 0, 50, 3500), ("Tool installation (include CB evn setup)", 1, 100, 1000)], 1):
                aid = c.execute("INSERT INTO activities(tracker_id,pos,affected,details,status,progress) VALUES(?,?,?,?,?,?) RETURNING id", (tid, i, "All GR", d, "Completed" if done else "WIP", prog)).fetchone()["id"]
                c.execute("INSERT INTO entries VALUES(?,?,?)", (aid, wk39, days))
            out.append(f"Employee created: {em} / {DEMO_PW}")
    return out

if __name__ == "__main__":
    print("\n".join(run()))
