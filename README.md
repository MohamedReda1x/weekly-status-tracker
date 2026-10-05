# Weekly Process Status Report (V3)

FastAPI + PostgreSQL 16 + Alembic + React (Vite). UI in English. One container serves API and UI.

## Launch on Windows (PowerShell) - Docker Desktop must be running
```powershell
cd path\to\wsr
Copy-Item .env.example .env        # edit: POSTGRES_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
docker compose ps                  # app should become "healthy"
docker compose exec app python seed.py    # OPTIONAL fictional demo data
```
Open http://localhost:8000.

### Which login works?
* **Manager:** `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env` (created automatically at first start). Nothing else is promised.
* `seed.py` **never overwrites or resets a password**. It only creates `marco@example.com` and `kavi@example.com` (password `Demo-12345`) if they do not exist yet, and it prints exactly what it did. Only when the database has no manager at all does it create `manager@example.com / Demo-12345`.
* Stop: `docker compose down` (data stays in the `pgdata` volume; `down -v` DELETES it). Logs: `docker compose logs app`.
* Without Docker: `.\start-local.ps1` (Python 3.10+, Node 20+, reachable PostgreSQL in `DATABASE_URL`).

## Backup and restore (Windows PowerShell 5.1 and PowerShell 7)
```powershell
.\scripts\backup.ps1                                      # -> backups\tracker_YYYYMMDD_HHMMSS.dump
.\scripts\restore.ps1 -File backups\tracker_XXXX.dump      # asks you to type RESTORE
```
The dump is created inside the container and copied with `docker compose cp` (no binary data through PowerShell pipes). `backup.ps1` verifies the archive (`pg_restore --list` + header) and deletes partial files on failure. `restore.ps1` refuses missing/invalid/corrupted files, asks for explicit confirmation, takes a safety backup (`backups\pre-restore_*.dump`) first, stops the app, restores in ONE transaction (all-or-nothing), always restarts the app, waits for `/api/health`, and only then prints "Restore completed" (exit code 0). Any failure prints `ERROR:` and exits non-zero. Copy the `backups` folder off the machine regularly.

### Daily automatic backup (Windows Task Scheduler)
```powershell
.\scripts\register-backup-task.ps1 -Time 02:00 -Keep 14     # daily, keeps the 14 newest dumps
Start-ScheduledTask -TaskName WeeklyTracker-DB-Backup          # test it now
Get-Content backups\backup.log -Tail 5                         # OK / FAILED history
.\scripts\register-backup-task.ps1 -Unregister                # remove
```
The task runs as you, only while you are logged on and Docker Desktop is running. "Last Run Result" 0 = success.

## Emails
`EMAIL_MODE=console`: nothing is sent; links are in Accounts > Outbox. `EMAIL_MODE=resend`: set `RESEND_API_KEY` + `MAIL_FROM` (verified domain). Links use `APP_URL`. A failed send is shown in red with "Resend invitation".

## Production (HTTPS)
TLS reverse proxy in front (Caddy/nginx/cloud platform), `APP_URL=https://...`, `COOKIE_SECURE=true` (session cookie is always HttpOnly + SameSite=Lax; `Secure` only with this flag, so keep `false` for http://localhost), strong secrets, `pgdata` volume kept, daily backups. The container trusts `X-Forwarded-*` headers. The calendar of weeks is generated automatically up to (current year + 2).

## Tests
```powershell
.\.venv\Scripts\python.exe -m pytest -q tests     # needs a PostgreSQL; TEST_DATABASE_URL (default ...localhost:5432/tracker_test) schema is WIPED
cd frontend; $env:UI_BASE="http://127.0.0.1:8000"; npm test    # jsdom UI test against a running instance on an EMPTY database (admin boss@x.com / Admin-pass-1)
```

## Still to check on your side
Real `docker compose up --build`, Windows PowerShell 5.1, Chrome/Edge/Firefox rendering, HTTPS cookie behind your proxy, real Resend key, Task Scheduler registration.

## V4 changes (summary)
* **Period navigation**: month / quarter / whole mission / date range, Previous - Today - Next, month picker, any past or future period (the calendar is generated on demand). The consulted period is a browser-side choice: it never changes what an employee or another manager sees, and mission dates never delete data.
* **Comments** can be linked to several ISO weeks (detected automatically when saving) or be general. Comments and history are paginated server-side with filters.
* **Excel export** without leaving the page (displayed period, date range or whole tracker; every comment of the scope is included).
* **Accounts**: invitation or temporary password (forced change at first sign-in), show/hide password fields. The Client field is gone ("Estimation").
* **Without Docker**: `.\start-local.ps1` (stops at the first error), `.\scripts\db-backup.ps1`, `.\scripts\db-restore.ps1`. See `UPDATE_V4.md` for the update and rollback procedure.
