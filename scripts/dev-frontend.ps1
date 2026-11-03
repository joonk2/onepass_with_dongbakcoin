param(
    [ValidateSet('local', 'render')]
    [string]$Backend = 'render'
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$backendUrl = 'http://127.0.0.1:8000/api/v1'
if ($Backend -eq 'render') {
    $envFile = Join-Path $repositoryRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        throw 'Repository root .env file was not found.'
    }

    $backendLines = @(
        Get-Content -LiteralPath $envFile |
            Where-Object { $_ -match '^\s*BACKEND_URL\s*=' }
    )
    if ($backendLines.Count -ne 1) {
        throw 'Root .env must contain exactly one BACKEND_URL entry.'
    }
    if ($backendLines[0] -notmatch '^\s*BACKEND_URL\s*=\s*(.*?)\s*$') {
        throw 'BACKEND_URL in root .env is malformed.'
    }

    $backendUrl = $Matches[1].Trim()
    if (
        ($backendUrl.StartsWith('"') -and $backendUrl.EndsWith('"')) -or
        ($backendUrl.StartsWith("'") -and $backendUrl.EndsWith("'"))
    ) {
        $backendUrl = $backendUrl.Substring(1, $backendUrl.Length - 2)
    }
}

$parsedUrl = $null
if (-not [Uri]::TryCreate($backendUrl, [UriKind]::Absolute, [ref]$parsedUrl)) {
    throw 'BACKEND_URL must be an absolute URL.'
}
$isLoopback = $parsedUrl.Host -in @('localhost', '127.0.0.1')
if (
    (($parsedUrl.Scheme -ne 'https') -and
        -not (($parsedUrl.Scheme -eq 'http') -and $isLoopback)) -or
    $parsedUrl.UserInfo -or
    $parsedUrl.Query -or
    $parsedUrl.Fragment -or
    $parsedUrl.AbsolutePath.TrimEnd('/') -notin @('', '/api/v1')
) {
    throw 'BACKEND_URL must use HTTPS and point to a trusted API origin.'
}

$env:BACKEND_URL = $backendUrl.TrimEnd('/')
if ($parsedUrl.AbsolutePath.TrimEnd('/') -eq '') {
    $env:BACKEND_URL += '/api/v1'
}
Write-Host "Using the $Backend FastAPI backend. Only BACKEND_URL is passed to Next.js."

Push-Location (Join-Path $repositoryRoot 'frontend')
try {
    & (Join-Path $repositoryRoot 'frontend\node_modules\.bin\next.cmd') dev --hostname 127.0.0.1
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
