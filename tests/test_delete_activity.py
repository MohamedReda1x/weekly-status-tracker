# Uses the fixtures of test_app.py (env / world / cell / save). Run with a SEPARATE test database (TEST_DATABASE_URL).
from test_app import env, world, cell, save, RNG  # noqa: F401  (pytest fixtures)
from fastapi.testclient import TestClient

def tracker(cl, tid): return cl.get(f"/api/trackers/{tid}?{RNG}").json()

def test_delete_empty_activity_and_history(world):
    w = world; a, ta = w["a"], w["ta"]; a1, a2 = w["act"](a, ta), w["act"](a, ta)
    assert {x["id"]: x["has_data"] for x in tracker(a, ta)["activities"]} == {a1: False, a2: False}
    assert a.delete(f"/api/activities/{a1}").status_code == 200
    ids = [x["id"] for x in tracker(a, ta)["activities"]]; assert ids == [a2]
    h = a.get(f"/api/trackers/{ta}/history?activity_id={a1}").json()["items"]
    assert any("deleted" in x["what"] for x in h)                                  # the deletion stays traceable
    assert a.delete(f"/api/activities/{a1}").status_code == 404                      # already gone
    p = w["period"](2026, 40, "2026-10"); assert save(a, ta, [cell(a1, p["id"], "1")]).status_code == 404   # cannot save days on a deleted activity

def test_activity_with_days_cannot_be_deleted_but_can_be_archived(world):
    w = world; a, ta = w["a"], w["ta"]; a1 = w["act"](a, ta); p = w["period"](2026, 40, "2026-10")
    assert save(a, ta, [cell(a1, p["id"], "1,5")]).status_code == 200
    r = a.delete(f"/api/activities/{a1}"); assert r.status_code == 409 and r.json()["detail"]["code"] == "has_entries"
    d = tracker(a, ta); assert [x["has_data"] for x in d["activities"]] == [True] and d["month_totals"]["2026-10"] == 1500   # nothing lost
    # data in a period that is NOT in the displayed range still blocks the deletion
    far = a.get(f"/api/trackers/{ta}?from=2026-07-01&to=2026-07-31").json(); assert far["activities"][0]["has_data"] is True
    assert a.post(f"/api/activities/{a1}/archive", json={"archived": True}).status_code == 200
    assert a.delete(f"/api/activities/{a1}").status_code == 409                       # archived with days: still protected
    assert tracker(a, ta)["month_totals"]["2026-10"] == 1500
    # once the days are cleared on a restored activity it becomes deletable again
    a.post(f"/api/activities/{a1}/archive", json={"archived": False}); assert save(a, ta, [cell(a1, p["id"], "0", 1500)]).status_code == 200
    assert a.delete(f"/api/activities/{a1}").status_code == 200

def test_archived_empty_activity_can_be_deleted(world):
    w = world; a, ta = w["a"], w["ta"]; a1 = w["act"](a, ta)
    a.post(f"/api/activities/{a1}/archive", json={"archived": True}); assert a.delete(f"/api/activities/{a1}").status_code == 200

def test_delete_permissions(world):
    w = world; a, b, adm, ta = w["a"], w["b"], w["adm"], w["ta"]; a1, a2 = w["act"](a, ta), w["act"](a, ta)
    assert b.delete(f"/api/activities/{a1}").status_code == 404                      # another employee: same answer as "does not exist"
    assert TestClient(w["app"].app).delete(f"/api/activities/{a1}").status_code == 401
    assert [x["id"] for x in tracker(a, ta)["activities"]] == [a1, a2]
    assert adm.delete(f"/api/activities/{a2}").status_code == 200                    # manager may delete (attributed in history)
    h = a.get(f"/api/trackers/{ta}/history?activity_id={a2}").json()["items"]; assert h[0]["author_role"] == "admin" and "deleted" in h[0]["what"]
    assert a.delete(f"/api/activities/{a1}").status_code == 200
