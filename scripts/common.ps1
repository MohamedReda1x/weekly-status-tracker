# Shared helpers (dot-sourced by backup.ps1 / restore.ps1). Works in Windows PowerShell 5.1 and PowerShell 7.
function Fail([string]$Message, [int]$Code = 1) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit $Code }

# Runs "docker <args>" and aborts on a non-zero exit code. stderr is NOT redirected (avoids 5.1 NativeCommandError).
function Invoke-Docker([string[]]$DockerArgs) {
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) { Fail ("docker " + ($DockerArgs -join ' ') + " failed (exit code $LASTEXITCODE)") }
}

# A pg_dump custom-format archive starts with the ASCII bytes "PGDMP".
function Test-DumpFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "file not found: $Path" }
    $len = (Get-Item -LiteralPath $Path).Length
    if ($len -lt 100) { return "file is empty or too small ($len bytes)" }
    $fs = [System.IO.File]::OpenRead($Path)
    try { $buf = New-Object byte[] 5; [void]$fs.Read($buf, 0, 5) } finally { $fs.Dispose() }
    if ([System.Text.Encoding]::ASCII.GetString($buf) -ne "PGDMP") { return "not a PostgreSQL custom-format dump (missing PGDMP header)" }
    return $null
}

function Resolve-ProjectPath([string]$Path, [string]$Root) {
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return [System.IO.Path]::GetFullPath((Join-Path $Root $Path))
}

function Write-BackupLog([string]$Root, [string]$Line) {
    $dir = Join-Path $Root "backups"; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    Add-Content -Path (Join-Path $dir "backup.log") -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Line)
}
