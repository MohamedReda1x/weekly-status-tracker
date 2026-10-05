<#
.SYNOPSIS  Local start without Docker: .venv + dependencies + frontend build + migrations + server. Stops at the first failure.
.EXAMPLE   .\start-local.ps1
.EXAMPLE   .\start-local.ps1 -SkipFrontend      # reuse the existing frontend\dist
.EXAMPLE   .\start-local.ps1 -SetupOnly         # do everything except starting the server
#>
param([switch]$SkipFrontend, [switch]$SetupOnly)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Fail([string]$m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
function Step([string]$Name, [scriptblock]$Cmd) {
    Write-Host "==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Cmd
    if ($LASTEXITCODE -ne 0) { Fail "$Name failed (exit code $LASTEXITCODE). Nothing was started." }
}
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Fail "Created .env from .env.example - edit it (DATABASE_URL, ADMIN_PASSWORD...) and run again." }
Get-Content .env | Where-Object { $_ -match '^\s*[^#=\s]+=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), "Process")
}
if (-not $env:DATABASE_URL) { Fail "DATABASE_URL is missing in .env" }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Step "Create .venv" { python -m venv .venv } }
if (-not (Test-Path $py)) { Fail ".venv could not be created (is Python on PATH?)" }
Step "Install Python dependencies" { & $py -m pip install -q -r requirements.txt }
if (-not $SkipFrontend) {
    Push-Location frontend
    try { Step "npm install" { npm install --no-audit --no-fund }; Step "Build frontend" { npm run build } } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $PSScriptRoot "frontend\dist\index.html"))) { Fail "frontend\dist is missing - run without -SkipFrontend" }
$env:STATIC_DIR = Join-Path $PSScriptRoot "frontend\dist"
Step "Apply database migrations" { & $py -m alembic upgrade head }
if ($SetupOnly) { Write-Host "Setup finished. Start with: .\start-local.ps1 -SkipFrontend" -ForegroundColor Green; exit 0 }
Write-Host "==> Starting on http://127.0.0.1:8000 (Ctrl+C to stop)" -ForegroundColor Green
& $py -m uvicorn app:app --host 127.0.0.1 --port 8000
if ($LASTEXITCODE -ne 0) { Fail "The server stopped with exit code $LASTEXITCODE" }
