<#
.SYNOPSIS
    Starts the API and the admin portal for local development.

.DESCRIPTION
    The no-Docker path: runs Django against a local MySQL and serves the admin portal as
    static files. Use `make up` instead if you want the full stack (Redis, Celery worker
    and beat, Flower) in containers.

    Starts the Expo dev server too, so the mobile app can be opened in Expo Go.

    The API binds 0.0.0.0 rather than 127.0.0.1 on purpose: a phone cannot reach the
    loopback address, because that address is the phone itself.

.EXAMPLE
    .\scripts\dev-start.ps1
#>

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# Fail early with a useful message rather than letting Django raise on first query.
$envFile = Join-Path $repo 'backend\.env'
if (-not (Test-Path $envFile)) {
    Write-Error "backend\.env is missing. Copy backend\.env.example to backend\.env and fill it in."
}

Write-Host 'Starting the API on http://127.0.0.1:8000 ...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$repo\backend'; python manage.py runserver 127.0.0.1:8000"
)

Write-Host 'Starting the admin portal on http://127.0.0.1:8080 ...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$repo\admin-web'; python -m http.server 8080 --bind 127.0.0.1"
)

Write-Host 'Starting the Expo dev server ...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$repo\mobile'; npx expo start -c"
)

# Shown so the value the phone will actually use is visible, rather than left to be
# discovered when requests silently fail from the device.
$lan = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress

Write-Host ''
Write-Host "Mobile API base  http://${lan}:8000/api/v1" -ForegroundColor Yellow
Write-Host 'Scan the Expo QR code with Expo Go, on the same network.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Swagger UI    http://127.0.0.1:8000/api/docs/' -ForegroundColor Green
Write-Host 'Redoc         http://127.0.0.1:8000/api/redoc/' -ForegroundColor Green
Write-Host 'Django admin  http://127.0.0.1:8000/admin/' -ForegroundColor Green
Write-Host 'Admin portal  http://127.0.0.1:8080/' -ForegroundColor Green
Write-Host ''
Write-Host 'Sign in with the superuser created by: python manage.py createsuperuser'
