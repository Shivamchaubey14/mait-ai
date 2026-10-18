# =======================================================================================
# Run Mait AI on the LAN (API + admin portal), bound to all interfaces so it is reachable
# at this machine's IP. Dev settings — see backend/.env.
#
#   API    -> http://<this-ip>:8001/api/v1/   (Swagger at /api/docs/)
#   Portal -> http://<this-ip>:9000/
#
# Usage:   powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
# Stop:    close the two windows it opens, or Ctrl+C in each.
# =======================================================================================

$ErrorActionPreference = 'Stop'
$root   = $PSScriptRoot
$py     = Join-Path $root 'backend\.venv\Scripts\python.exe'
$apiPort    = 8001
$portalPort = 9000

if (-not (Test-Path $py)) {
    Write-Error "venv not found at $py. Create it: python -m venv backend\.venv; backend\.venv\Scripts\python -m pip install -r backend\requirements\dev.txt"
    exit 1
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
       Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "Machine IP: $ip"
Write-Host "API    -> http://$ip`:$apiPort/api/v1/  (docs: /api/docs/)"
Write-Host "Portal -> http://$ip`:$portalPort/"

# All services share a single Windows Terminal window named "Shwetdhara".
# -w <name> attaches these tabs to that window if it already exists (e.g.
# opened by the Easy Indent / KSTS launchers) or creates it, so Mait AI
# opens as TABS in one window instead of two separate console windows.
$WindowName = "Shwetdhara"
$backend    = Join-Path $root 'backend'
$adminWeb   = Join-Path $root 'admin-web'

# Tab 1: API (Django dev server, no autoreload for a stable single process)
$apiTab = "new-tab --title `"Mait API  [:$apiPort]`" cmd /k `"cd /d $backend && $py manage.py runserver 0.0.0.0:$apiPort --noreload`""

# Tab 2: Admin portal (static files)
$portalTab = "new-tab --title `"Mait Portal  [:$portalPort]`" cmd /k `"cd /d $adminWeb && $py -m http.server $portalPort --bind 0.0.0.0`""

Start-Process wt.exe -ArgumentList "-w $WindowName $apiTab ; $portalTab"

Write-Host "Both servers started as tabs in the '$WindowName' Windows Terminal window."
