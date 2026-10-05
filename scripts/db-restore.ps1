<#
.SYNOPSIS  Restores a backup into the LOCAL PostgreSQL database. REPLACES ALL CURRENT DATA. Stop the app first. PS 5.1 and 7.
.EXAMPLE   .\scripts\db-restore.ps1 -File backups\tracker_20261001_020000.dump
#>
param([Parameter(Mandatory = $true)][string]$File, [switch]$Force, [string]$PgBin = "", [string]$AppUrl = "http://127.0.0.1:8000")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "common.ps1"); . (Join-Path $PSScriptRoot "localdb-common.ps1")
Read-DotEnv $root
$d = Get-DbParts $env:DATABASE_URL; $File = Resolve-ProjectPath $File $root
$pgrestore = Find-PgTool "pg_restore" $PgBin; $pgisready = Find-PgTool "pg_isready" $PgBin
# 1. validate before touching anything
$problem = Test-DumpFile $File; if ($problem) { Fail "Invalid backup: $problem" }
& $pgrestore --list $File | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Backup is corrupted or unreadable. Nothing was changed." }
& $pgisready -h $d.Host -p $d.Port -U $d.User | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL is not reachable at $($d.Host):$($d.Port). Nothing was changed." }
# 2. the app must be stopped (otherwise it keeps writing while we replace the data)
$running = $false
try { $r = Invoke-WebRequest -UseBasicParsing -Uri "$AppUrl/api/health" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $running = $true } } catch { }
if ($running) { Fail "The application is still running at $AppUrl. Stop it first (Ctrl+C in the start-local window), then run this again." }
# 3. explicit confirmation
if (-not $Force) {
    Write-Host "This will REPLACE ALL CURRENT DATA of database '$($d.Db)' with: $File" -ForegroundColor Yellow
    if ((Read-Host "Type RESTORE to continue") -cne "RESTORE") { Fail "Cancelled. Nothing was changed." }
}
# 4. safety backup, abort if it fails
$safety = Join-Path $root ("backups\pre-restore_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
& (Join-Path $PSScriptRoot "db-backup.ps1") -Out $safety -PgBin $PgBin
if ($LASTEXITCODE -ne 0) { Fail "Safety backup failed - restore aborted, nothing was changed." }
# 5. restore in ONE transaction (all-or-nothing)
try {
    $env:PGPASSWORD = $d.Password
    & $pgrestore -h $d.Host -p $d.Port -U $d.User -d $d.Db --single-transaction --clean --if-exists --no-owner $File
    if ($LASTEXITCODE -ne 0) { Fail "pg_restore failed. The restore was rolled back (previous data intact). Safety copy: $safety" }
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
Write-Host "Restore completed from $File. Previous data saved in $safety." -ForegroundColor Green
Write-Host "Start the app again with .\start-local.ps1 (pending migrations are applied automatically)."
exit 0
