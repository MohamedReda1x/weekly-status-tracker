<#
.SYNOPSIS  Restores a backup made by backup.ps1. REPLACES ALL CURRENT DATA. Windows PowerShell 5.1 and PowerShell 7.
.EXAMPLE   .\scripts\restore.ps1 -File backups\tracker_20260930_020000.dump
.NOTES     -Force skips the typed confirmation (automation only). A safety backup of the current data is always taken first.
#>
param([Parameter(Mandatory = $true)][string]$File, [switch]$Force, [int]$HealthTimeoutSec = 90)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "common.ps1")
Set-Location $root
$File = Resolve-ProjectPath $File $root
$tmp = "/tmp/tracker_restore.dump"

# 1. validate the file BEFORE touching anything
$problem = Test-DumpFile $File
if ($problem) { Fail "Invalid backup: $problem" }
Invoke-Docker @("compose", "exec", "-T", "db", "pg_isready", "-U", "tracker", "-d", "tracker")
Invoke-Docker @("compose", "cp", $File, "db:$tmp")
& docker compose exec -T db sh -c "pg_restore --list $tmp > /dev/null"
if ($LASTEXITCODE -ne 0) { & docker compose exec -T db rm -f $tmp; Fail "Backup is corrupted or unreadable (pg_restore --list failed). Nothing was changed." }

# 2. explicit confirmation
if (-not $Force) {
    Write-Host "This will REPLACE ALL CURRENT DATA with: $File" -ForegroundColor Yellow
    $answer = Read-Host "Type RESTORE to continue"
    if ($answer -cne "RESTORE") { & docker compose exec -T db rm -f $tmp; Fail "Cancelled. Nothing was changed." }
}

# 3. safety backup of the current data; abort if it fails
$safety = Join-Path $root ("backups\pre-restore_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
& (Join-Path $PSScriptRoot "backup.ps1") -Out $safety
if ($LASTEXITCODE -ne 0) { Fail "Safety backup failed - restore aborted, nothing was changed." }

# 4. stop the app, restore in ONE transaction (all-or-nothing), ALWAYS restart the app
$restored = $false
& docker compose stop app
if ($LASTEXITCODE -ne 0) { Fail "Could not stop the app - restore aborted, nothing was changed." }
try {
    & docker compose exec -T db pg_restore -U tracker -d tracker --single-transaction --clean --if-exists --no-owner $tmp
    if ($LASTEXITCODE -eq 0) { $restored = $true }
} finally {
    & docker compose exec -T db rm -f $tmp
    & docker compose start app
    if ($LASTEXITCODE -ne 0) { Write-Host "WARNING: the app could not be restarted. Run: docker compose up -d" -ForegroundColor Yellow }
}
if (-not $restored) { Fail "pg_restore failed. The restore was rolled back (your previous data is intact). Safety copy: $safety" }

# 5. only announce success when the app is healthy again (migrations run at container start)
$healthy = $false; $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
while (-not $healthy -and (Get-Date) -lt $deadline) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000/api/health" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $healthy = $true } } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { Fail "Data restored, but the app is not healthy yet. Check: docker compose logs app. Safety copy: $safety" 2 }
Write-Host "Restore completed from $File. Previous data saved in $safety" -ForegroundColor Green
exit 0
