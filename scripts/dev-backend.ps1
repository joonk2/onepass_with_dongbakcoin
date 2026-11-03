$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $repositoryRoot '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw 'Repository root .env file was not found.'
}

$databaseLines = @(
    Get-Content -LiteralPath $envFile |
        Where-Object { $_ -match '^\s*DATABASE_URL\s*=' }
)
if ($databaseLines.Count -ne 1) {
    throw 'Root .env must contain exactly one DATABASE_URL entry.'
}
if ($databaseLines[0] -notmatch '^\s*DATABASE_URL\s*=\s*(.*?)\s*$') {
    throw 'DATABASE_URL in root .env is malformed.'
}

$databaseUrl = $Matches[1].Trim()
if (
    ($databaseUrl.StartsWith('"') -and $databaseUrl.EndsWith('"')) -or
    ($databaseUrl.StartsWith("'") -and $databaseUrl.EndsWith("'"))
) {
    $databaseUrl = $databaseUrl.Substring(1, $databaseUrl.Length - 2)
}

if ($databaseUrl -notmatch '^postgres(?:ql)?://[^/\s]+/.+') {
    throw 'DATABASE_URL must be a PostgreSQL connection URL.'
}

$python = Join-Path $repositoryRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw 'Repository Python environment was not found at .venv.'
}

$env:DATABASE_URL = $databaseUrl
Write-Host 'Loaded DATABASE_URL for the local FastAPI process only. The value is not displayed.'

Push-Location (Join-Path $repositoryRoot 'backend\fastapi')
try {
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
