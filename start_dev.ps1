# =======================================================================================
# Run Mait AI for DEVELOPMENT on this PC — one Windows Terminal window, three tabs.
#
#   Tab 1  Mait Dev API     Django runserver on 0.0.0.0:8000 (reloads on save)
#   Tab 2  Mait Dev Portal  admin-web static-served on 127.0.0.1:8080 (refresh to see edits)
#   Tab 3  Mait Dev Expo    Expo packager on :8081 — scan the QR with Expo Go (SDK 54)
#
# The live product runs on the other server now; this is only for making changes and seeing
# them on a phone. Expo Go follows the packager to this PC's LAN address, so the phone talks to
# the API in tab 1 — mobile\server.json is NOT used by Expo Go and must not be pointed here
# (installed APKs read it).
#
# Usage:   powershell -ExecutionPolicy Bypass -File .\start_dev.ps1
#          powershell -ExecutionPolicy Bypass -File .\start_dev.ps1 -LanIp 192.168.71.160
# Stop:    close the tabs, or Ctrl+C in each.
# =======================================================================================

param(
    # The address the phone reaches this PC on. Detected from the default route when omitted —
    # this machine also has Hyper-V adapters, and Expo left to itself can pick one of those.
    [string]$LanIp = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- Settings -------------------------------------------------------------------------
$ApiPort    = 8000
$PortalPort = 8080
$ExpoPort   = 8081
$WindowName = 'MaitDev'

$py      = Join-Path $root 'backend\.venv\Scripts\python.exe'
$backend = Join-Path $root 'backend'
$portal  = Join-Path $root 'admin-web'
$mobile  = Join-Path $root 'mobile'

# --- Preconditions --------------------------------------------------------------------
if (-not (Test-Path $py)) {
    Write-Error "venv not found at $py. Create it: python -m venv backend\.venv; backend\.venv\Scripts\python -m pip install -r backend\requirements\dev.txt"
    exit 1
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
    Write-Error "backend\.env is missing. Copy backend\.env.example to backend\.env and fill it in."
    exit 1
}
if (-not (Test-Path (Join-Path $mobile 'node_modules'))) {
    Write-Error "mobile\node_modules is missing. Run: cd mobile; npm install"
    exit 1
}
if (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) {
    Write-Error "Windows Terminal (wt.exe) not found. Install it: winget install Microsoft.WindowsTerminal"
    exit 1
}

# A second runserver binds without complaint while the old one keeps answering, so say so up
# front rather than leave a stale server to be found by its old behaviour.
foreach ($port in @($ApiPort, $PortalPort, $ExpoPort)) {
    $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($busy) {
        $proc = (Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host "WARNING: port $port is already in use by $proc (PID $($busy.OwningProcess)). Stop it first: Stop-Process -Id $($busy.OwningProcess)" -ForegroundColor Red
    }
}

# --- LAN address for the phone ----------------------------------------------------------
if (-not $LanIp) {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
             Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
    if ($route) {
        $LanIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
                  Select-Object -First 1).IPAddress
    }
}
if (-not $LanIp) {
    Write-Error "Could not detect this PC's LAN address. Pass it: .\start_dev.ps1 -LanIp <address>"
    exit 1
}

# --- OTP mode banner (backend\.env is the source of truth) -------------------------------
$otpProvider = 'console'
foreach ($line in Get-Content (Join-Path $backend '.env')) {
    if ($line -match '^\s*SMS_GATEWAY_PROVIDER\s*=\s*(.+?)\s*$') { $otpProvider = $Matches[1] }
}
if ($otpProvider -eq 'console') {
    Write-Host "OTP mode : console -- codes print in the 'Mait Dev API' tab, no SMS." -ForegroundColor Yellow
} else {
    Write-Host "OTP mode : live SMS via $otpProvider -- every dev sign-in sends a real text." -ForegroundColor Yellow
    Write-Host "           Set SMS_GATEWAY_PROVIDER=console in backend\.env, or use an account with the fixed login code." -ForegroundColor Yellow
}

# --- Tabs -----------------------------------------------------------------------------
# cmd /k rather than powershell: wt.exe treats `;` as its own tab separator, and cmd needs none.
# NOTE: no space before `&&` — `set X=val && ...` captures the space into the value.
$apiCmd    = "`"$py`" manage.py runserver 0.0.0.0:$ApiPort"
$portalCmd = "`"$py`" -m http.server $PortalPort --bind 127.0.0.1"
$expoCmd   = "set REACT_NATIVE_PACKAGER_HOSTNAME=$LanIp&& npx expo start -c --port $ExpoPort"

$apiTab    = "new-tab -d `"$backend`" --title `"Mait Dev API  [:$ApiPort]`" cmd /k $apiCmd"
$portalTab = "new-tab -d `"$portal`" --title `"Mait Dev Portal  [:$PortalPort]`" cmd /k $portalCmd"
$expoTab   = "new-tab -d `"$mobile`" --title `"Mait Dev Expo  [:$ExpoPort]`" cmd /k `"$expoCmd`""

Start-Process wt.exe -ArgumentList "-w $WindowName $apiTab ; $portalTab ; $expoTab"

Write-Host ""
Write-Host "Started the API, portal and Expo as tabs in the '$WindowName' window." -ForegroundColor Green
Write-Host "  Admin portal : http://127.0.0.1:$PortalPort/   (also http://127.0.0.1:$ApiPort/)" -ForegroundColor Green
Write-Host "  API          : http://127.0.0.1:$ApiPort/api/v1/   docs at /api/docs/" -ForegroundColor Green
Write-Host "  Phone        : Expo Go on the same Wi-Fi, scan the QR in the Expo tab" -ForegroundColor Green
Write-Host "                 the app will call http://${LanIp}:$ApiPort/api/v1" -ForegroundColor Green
