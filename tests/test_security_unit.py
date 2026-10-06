"""Security tests with mocked SQL; no database or migrations."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
import app


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"COOKIE_SECURE": "false"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.connect = patch.object(app.psycopg, "connect",
                                    side_effect=AssertionError("Real database access forbidden"))
        self.connect.start()
        self.addCleanup(self.connect.stop)
        app.FAILS.clear()
        app.IP_ATTEMPTS.clear()
        self.addCleanup(app.FAILS.clear)
        self.addCleanup(app.IP_ATTEMPTS.clear)
        self.sql = MagicMock()
        self.sql.execute.return_value.fetchone.return_value = None
        self.db = patch.object(app, "db")
        self.db.start().return_value.__enter__.return_value = self.sql
        self.addCleanup(self.db.stop)
        self.client = TestClient(app.app)  # No lifespan: init() is not called.
        self.addCleanup(self.client.close)

    def attempt(self, email, **kwargs):
        return self.client.post("/api/login", json={"email": email, "password": "wrong"}, **kwargs)

    def test_ip_limit_across_emails_and_expiry(self):
        with patch.object(app.time, "monotonic", return_value=1000):
            for i in range(app.IP_LOGIN_LIMIT):
                self.assertEqual(self.attempt(f"u{i}@example.org").status_code, 401)
            calls = self.sql.execute.call_count
            blocked = self.attempt("another@example.org")
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers["Cache-Control"], "no-store")
            self.assertEqual(self.sql.execute.call_count, calls)
        with patch.object(app.time, "monotonic", return_value=1901):
            self.assertEqual(self.attempt("fresh@example.org").status_code, 401)

    def test_email_limit_is_preserved(self):
        for _ in range(5):
            self.assertEqual(self.attempt("same@example.org").status_code, 401)
        self.assertEqual(self.attempt("same@example.org").status_code, 429)

    def test_ips_are_independent_and_header_cannot_bypass(self):
        app.IP_ATTEMPTS["testclient"] = [app.time.monotonic()] * app.IP_LOGIN_LIMIT
        self.assertEqual(self.attempt("a@example.org",
                         headers={"X-Forwarded-For": "198.51.100.1"}).status_code, 429)
        req = Request({"type": "http", "client": ("198.51.100.2", 1234)})
        app.limit_login_ip(req)
        self.assertEqual(len(app.IP_ATTEMPTS["198.51.100.2"]), 1)

    def test_concurrent_ip_limit(self):
        req = Request({"type": "http", "client": ("198.51.100.3", 1234)})
        def attempt(_):
            try:
                app.limit_login_ip(req)
                return 200
            except HTTPException as error:
                return error.status_code
        with ThreadPoolExecutor(max_workers=8) as pool:
            codes = list(pool.map(attempt, range(40)))
        self.assertEqual(codes.count(200), app.IP_LOGIN_LIMIT)
        self.assertEqual(codes.count(429), 40 - app.IP_LOGIN_LIMIT)

    def test_security_headers_and_disabled_docs(self):
        self.assertIsNone(app.app.docs_url)
        self.assertIsNone(app.app.redoc_url)
        self.assertIsNone(app.app.openapi_url)
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertEqual(response.headers["Referrer-Policy"], "same-origin")
            self.assertNotIn("Strict-Transport-Security", response.headers)
            self.assertNotIn("Cache-Control", response.headers)
        with patch.dict(os.environ, {"COOKIE_SECURE": "true"}):
            response = self.client.get("/api/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["Strict-Transport-Security"], "max-age=31536000")
        with patch.object(app, "db", side_effect=RuntimeError("offline")):
            response = self.client.get("/api/health")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_secure_startup_validation_precedes_init(self):
        with patch.object(app, "init") as init:
            for url, password in (
                ("http://example.org", "Long-unique-password"),
                ("", "Long-unique-password"),
                ("https://example.org", "ChangeMe-12345"),
                ("https://example.org", "Demo-12345"),
                ("https://example.org", "short"),
            ):
                with self.subTest(url=url, password=password):
                    with patch.dict(os.environ, {"COOKIE_SECURE": "true",
                                    "APP_URL": url, "ADMIN_PASSWORD": password}):
                        with self.assertRaises(RuntimeError):
                            with TestClient(app.app):
                                pass
            init.assert_not_called()
            with patch.dict(os.environ, {"COOKIE_SECURE": "true",
                            "APP_URL": "https://example.org",
                            "ADMIN_PASSWORD": "Long-unique-password"}):
                with TestClient(app.app):
                    pass
            init.assert_called_once()
            init.reset_mock()
            with patch.dict(os.environ, {"COOKIE_SECURE": "false",
                            "APP_URL": "http://localhost:8000", "ADMIN_PASSWORD": ""}):
                app._startup()
            init.assert_called_once()



    def test_new_entries_outside_mission_dates(self):
        for start, end, month, week in (
            ("2026-09-07", "2026-09-11", "2026-09", 37),
            ("2026-12-07", "2026-12-11", "2026-12", 50),
        ):
            with self.subTest(period=start):
                period = dict(id=1, start=start, end=end, month_key=month,
                              iso_year=2026, iso_week=week, capacity=5)
                def execute(sql, params=()):
                    result = MagicMock()
                    if sql.startswith("SELECT id, p_start"):
                        result.__iter__.return_value = iter([period])
                    elif sql.startswith("SELECT * FROM activities"):
                        result.fetchone.return_value = dict(id=7, archived=0, details="Review")
                    elif sql.startswith("SELECT milli"):
                        result.fetchone.return_value = None
                    elif sql.startswith("SELECT COALESCE(SUM"):
                        result.fetchone.return_value = {"v": 1000}
                    return result
                self.sql.execute.side_effect = execute
                with patch.object(app, "cur_user", return_value={"id": 1}), patch.object(
                    app, "get_tracker", return_value={"start_date": "2026-11-01", "end_date": "2026-11-30"}
                ):
                    result = app.save(1, app.Save(changes=[dict(type="cell", activity_id=7,
                                      period_id=1, old=0, new="1")]), Request({"type": "http"}))
                self.assertEqual(result, {"ok": True, "changes": 1})
                statements = [call.args[0] for call in self.sql.execute.call_args_list]
                self.assertIn("COMMIT", statements)
                self.assertTrue(any(sql.startswith("INSERT INTO entries") for sql in statements))

if __name__ == "__main__":
    unittest.main()
