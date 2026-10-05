<#
.SYNOPSIS  Backup of the PostgreSQL database (Docker Compose). Windows PowerShell 5.1 and PowerShell 7.
.EXAMPLE   .\scripts\backup.ps1
.EXAMPLE   .\scripts\backup.ps1 -Out D:\safe\tracker.dump -Keep 14
#>
param([string]$Out = "", [int]$Keep = 0)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "common.ps1")
Set-Location $root
if (-not $Out) { $Out = "backups\tracker_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss") }
$Out = Resolve-ProjectPath $Out $root
$tmp = "/tmp/tracker_backup.dump"
try {
    $dir = Split-Path -Parent $Out
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    # 1. dump INSIDE the container (no binary data ever goes through a PowerShell pipe)
    Invoke-Docker @("compose", "exec", "-T", "db", "pg_dump", "-U", "tracker", "-Fc", "-f", $tmp, "tracker")
    # 2. the archive must be readable by pg_restore
    Invoke-Docker @("compose", "exec", "-T", "db", "sh", "-c", "pg_restore --list $tmp > /dev/null")
    # 3. copy it out
    Invoke-Docker @("compose", "cp", "db:$tmp", $Out)
    Invoke-Docker @("compose", "exec", "-T", "db", "rm", "-f", $tmp)
    $problem = Test-DumpFile $Out
    if ($problem) { throw "Backup file check failed: $problem" }
    if ($Keep -gt 0) {
        Get-ChildItem -Path $dir -Filter "tracker_*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force
    }
    $size = [math]::Round((Get-Item $Out).Length / 1KB)
    Write-BackupLog $root "OK $Out ($size KB)"
    Write-Host "Backup written and verified: $Out ($size KB)" -ForegroundColor Green
    exit 0
} catch {
    if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue }
    Write-BackupLog $root ("FAILED " + $_.Exception.Message)
    Fail ("Backup failed: " + $_.Exception.Message)
}
