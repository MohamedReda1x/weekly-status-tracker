# Update V3 -> V4 (Windows, no Docker)

Folder: `C:\Users\HP\Downloads\weekly-status-tracker-v3\wsr`. Accounts, passwords, entries and comments are kept. Do NOT run `seed.py`.
No new Python or npm dependency is required (`requirements.txt` and `package.json` are unchanged); `start-local.ps1` still runs the install/build steps and stops on any error.

## Manifest (paths relative to `wsr`)
Added: `UPDATE_V4.md`, `frontend/src/Accounts.jsx`, `frontend/src/BL.jsx`, `frontend/src/Grid.jsx`, `frontend/src/Panels.jsx`, `frontend/src/ui.jsx`, `migrations/versions/0002_comment_scopes_history_links.py`, `migrations/versions/0003_password_change_and_optional_client.py`, `scripts/db-backup.ps1`, `scripts/db-restore.ps1`, `scripts/localdb-common.ps1`
Modified: `.env.example`, `README.md`, `app.py`, `export_xlsx.py`, `start-local.ps1`, `frontend/src/App.jsx`, `frontend/src/style.css`, `frontend/src/util.js`, `frontend/tests/ui.test.jsx`, `tests/test_app.py`
Deleted: none. (Your `.env` is untouched; `DEFAULT_CLIENT` in it is simply ignored now.)

## 1. Update
```powershell
# adapt the zip path if needed
$wsr = "C:\Users\HP\Downloads\weekly-status-tracker-v3\wsr"
$zip = "C:\Users\HP\Downloads\weekly-status-tracker-v4-update.zip"
$tmp = Join-Path $env:TEMP "wsr_v4_update"
Set-Location $wsr

# 1. STOP the app (Ctrl+C in the window running start-local.ps1), then:
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp
$src = Join-Path $tmp "wsr"

# 2. install ONLY the new backup scripts first, then back up the database (V3 data) -- stop here if it fails
Copy-Item "$src\scripts\common.ps1","$src\scripts\localdb-common.ps1","$src\scripts\db-backup.ps1","$src\scripts\db-restore.ps1" -Destination "$wsr\scripts" -Force
.\scripts\db-backup.ps1 -Out "backups\before_v4.dump" -PgBin "C:\Program Files\PostgreSQL\16\bin"
if ($LASTEXITCODE -ne 0) { throw "Backup failed - do not continue" }

# 3. copy of the current code (rollback), without heavy folders. robocopy exit codes 0-7 mean success.
robocopy $wsr "$wsr\..\wsr_before_v4" /E /XD node_modules .venv dist backups __pycache__ /XF .env /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "Code copy failed - do not continue" }

# 4. copy the updated files (same relative paths)
Copy-Item -Path "$src\*" -Destination $wsr -Recurse -Force

# 5. dependencies + frontend build + migrations (0002, 0003) + start; stops at the first error
.\start-local.ps1
```
If PostgreSQL's `bin` folder is in your PATH you can omit `-PgBin`. Migrations are applied by `start-local.ps1`; to apply them without starting: `.\start-local.ps1 -SetupOnly`.
The first sign-in after the update behaves as before (nobody is forced to change a password). Open http://127.0.0.1:8000, then press Ctrl+F5 once to drop the old cached page.

## 2. Backup / restore (local PostgreSQL, PowerShell 5.1 or 7)
```powershell
.\scripts\db-backup.ps1 -PgBin "C:\Program Files\PostgreSQL\16\bin"          # backups\tracker_YYYYMMDD_HHMMSS.dump (verified)
.\scripts\db-restore.ps1 -File backups\tracker_XXXX.dump -PgBin "C:\Program Files\PostgreSQL\16\bin"   # APP MUST BE STOPPED; type RESTORE
```
pg_dump/pg_restore write and read the file themselves (no binary pipe). Restore refuses missing/invalid/corrupted files and a running app, takes a safety copy (`backups\pre-restore_*.dump`), restores in one transaction and only then says "Restore completed".

## 3. Rollback
Stop the app first (Ctrl+C).

**A. Go back to V3 code and keep the data entered since the update**
```powershell
Set-Location "C:\Users\HP\Downloads\weekly-status-tracker-v3\wsr"
.\.venv\Scripts\python.exe -m alembic downgrade 0001      # run BEFORE removing the V4 files; reverts 0003 then 0002
if ($LASTEXITCODE -ne 0) { throw "Downgrade failed - stop here and use rollback B" }
robocopy "$PWD\..\wsr_before_v4" $PWD /E /XD node_modules .venv dist backups /XF .env /NFL /NDL /NJH /NJS
Remove-Item migrations\versions\0002_*.py, migrations\versions\0003_*.py, frontend\src\Accounts.jsx, frontend\src\BL.jsx, frontend\src\Grid.jsx, frontend\src\Panels.jsx, frontend\src\ui.jsx, UPDATE_V4.md -ErrorAction SilentlyContinue
.\start-local.ps1
```
Downgrade effects: temporary-password flags and per-comment multi-week scopes are dropped (each comment keeps its first week for V3); history rows keep their text. Tracker `client` values are kept (empty ones become empty text).

**B. Full return to the state before the update (data entered after the update is lost)**
```powershell
Set-Location "C:\Users\HP\Downloads\weekly-status-tracker-v3\wsr"
.\scripts\db-restore.ps1 -File backups\before_v4.dump -PgBin "C:\Program Files\PostgreSQL\16\bin"
robocopy "$PWD\..\wsr_before_v4" $PWD /E /XD node_modules .venv dist backups /XF .env /NFL /NDL /NJH /NJS
Remove-Item migrations\versions\0002_*.py, migrations\versions\0003_*.py, frontend\src\Accounts.jsx, frontend\src\BL.jsx, frontend\src\Grid.jsx, frontend\src\Panels.jsx, frontend\src\ui.jsx, UPDATE_V4.md -ErrorAction SilentlyContinue
.\start-local.ps1
```
(The restore also resets the Alembic version stored in the dump to V3's `0001`.)
