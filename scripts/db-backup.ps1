<#
.SYNOPSIS  Backup of the LOCAL PostgreSQL database (no Docker). pg_dump writes the file itself: no binary pipe. PS 5.1 and 7.
.EXAMPLE   .\scripts\db-backup.ps1
.EXAMPLE   .\scripts\db-backup.ps1 -Out D:\safe\tracker.dump -Keep 14 -PgBin "C:\Program Files\PostgreSQL\16\bin"
#>
param([string]$Out = "", [int]$Keep = 0, [string]$PgBin = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "common.ps1"); . (Join-Path $PSScriptRoot "localdb-common.ps1")
Read-DotEnv $root
$d = Get-DbParts $env:DATABASE_URL
if (-not $Out) { $Out = "backups\tracker_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss") }
$Out = Resolve-ProjectPath $Out $root
$pgdump = Find-PgTool "pg_dump" $PgBin; $pgrestore = Find-PgTool "pg_restore" $PgBin
try {
    $dir = Split-Path -Parent $Out; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $env:PGPASSWORD = $d.Password
    & $pgdump -h $d.Host -p $d.Port -U $d.User -Fc -f $Out $d.Db
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit code $LASTEXITCODE)" }
    & $pgrestore --list $Out | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "the dump cannot be read back (pg_restore --list failed)" }
    $problem = Test-DumpFile $Out; if ($problem) { throw "Backup file check failed: $problem" }
    if ($Keep -gt 0) { Get-ChildItem -Path $dir -Filter "tracker_*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force }
    $size = [math]::Round((Get-Item $Out).Length / 1KB)
    Write-BackupLog $root "OK $Out ($size KB)"
    Write-Host "Backup written and verified: $Out ($size KB)" -ForegroundColor Green; exit 0
} catch {
    if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue }
    Write-BackupLog $root ("FAILED " + $_.Exception.Message); Fail ("Backup failed: " + $_.Exception.Message)
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
