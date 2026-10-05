# Helpers for the NON-Docker PostgreSQL scripts (Windows PowerShell 5.1 and PowerShell 7). Dot-source after common.ps1.
function Read-DotEnv([string]$Root) {
    $f = Join-Path $Root ".env"; if (-not (Test-Path $f)) { Fail ".env not found in $Root" }
    Get-Content $f | Where-Object { $_ -match '^\s*[^#=\s]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), "Process") }
    if (-not $env:DATABASE_URL) { Fail "DATABASE_URL is missing in .env" }
}
function Get-DbParts([string]$Url) {
    try { $u = [System.Uri]($Url -replace '^postgresql\+psycopg', 'postgresql') } catch { Fail "DATABASE_URL is not a valid URL" }
    $ui = $u.UserInfo.Split(':', 2)
    $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
    return @{ Host = $u.Host; Port = $port; User = [System.Uri]::UnescapeDataString($ui[0]); Password = $(if ($ui.Count -gt 1) { [System.Uri]::UnescapeDataString($ui[1]) } else { "" }); Db = $u.AbsolutePath.TrimStart('/') }
}
function Find-PgTool([string]$Name, [string]$PgBin) {
    if ($PgBin) { foreach ($n in @("$Name.exe", $Name)) { $p = Join-Path $PgBin $n; if (Test-Path $p) { return $p } }; Fail "$Name not found in -PgBin '$PgBin'" }
    $c = Get-Command $Name -ErrorAction SilentlyContinue; if ($c) { return $c.Source }
    foreach ($d in (Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) { $p = Join-Path $d.FullName "bin\$Name.exe"; if (Test-Path $p) { return $p } }
    Fail "$Name not found. Add PostgreSQL's bin folder to PATH or pass -PgBin 'C:\Program Files\PostgreSQL\16\bin'"
}
