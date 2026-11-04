# =======================================================================================
# Run Mait AI on port 443 via a Cloudflare Tunnel.
#
#   phone / browser ──https:443──▶  Cloudflare edge
#                                        │  tunnel (outbound from this PC — no inbound port)
#                                        ▼
#                               cloudflared (this PC)
#                                        │
#                                        ▼
#                               127.0.0.1:8010  Django (plain HTTP, loopback only)
#
# This replaces the :8001 path (start-https.ps1 / Caddy) for the mobile app. Phones reach the
# API on https://mait-ai.shwetdharamilk.com (no port), which no carrier blocks.
#
# FIRST TIME: do the one-time setup in infra\cloudflared\README.md (install cloudflared, log in,
# create the tunnel, route DNS, fill in infra\cloudflared\config.yml). This script only RUNS it.
#
# Usage:   powershell -ExecutionPolicy Bypass -File .\start-cloudflare.ps1
# Stop:    close the two tabs it opens, or Ctrl+C in each.
# =======================================================================================

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- Settings -------------------------------------------------------------------------
$Domain      = 'mait-ai.shwetdharamilk.com'   # the public host, now on 443 via Cloudflare
$DjangoPort  = 8010                            # internal loopback port for Django (8000 is taken here)
$TunnelName  = 'mait-ai'                        # `cloudflared tunnel create mait-ai`
$WindowName  = 'Shwetdhara'                     # shared Windows Terminal window

$py       = Join-Path $root 'backend\.venv\Scripts\python.exe'
$waitress = Join-Path $root 'backend\.venv\Scripts\waitress-serve.exe'
$backend  = Join-Path $root 'backend'
$cfConfig = Join-Path $root 'infra\cloudflared\config.yml'

# --- Preconditions --------------------------------------------------------------------
if (-not (Test-Path $py)) {
    Write-Error "venv not found at $py. Create it: python -m venv backend\.venv; backend\.venv\Scripts\python -m pip install -r backend\requirements\dev.txt"
    exit 1
}

if (-not (Test-Path $waitress)) {
    Write-Error "waitress not installed. Run: $py -m pip install -r backend\requirements\dev.txt  (it serves Django here instead of the dev runserver)."
    exit 1
}

if (-not (Test-Path $cfConfig)) {
    Write-Error "Tunnel config not found at $cfConfig. Do the one-time setup in infra\cloudflared\README.md first."
    exit 1
}

# Resolve cloudflared: PATH first, else the winget install location.
$cfExe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cfExe) {
    $cfExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue |
             Select-Object -First 1 -ExpandProperty FullName
}
if (-not $cfExe) {
    Write-Error "cloudflared not found. Install it:  winget install --id Cloudflare.cloudflared  (then open a new window)."
    exit 1
}

# The config still carries the placeholder if setup was not finished — catch it with a clear message.
if (Select-String -Path $cfConfig -Pattern 'PUT-TUNNEL-UUID-HERE' -Quiet) {
    Write-Error "infra\cloudflared\config.yml still has placeholders. Fill in the tunnel UUID and credentials-file path (see the README)."
    exit 1
}

Write-Host "cloudflared : $cfExe"
Write-Host "Tunnel      : $TunnelName  (config $cfConfig)"
Write-Host "Public      : https://$Domain/  (portal + /api/v1/) -- port 443, via Cloudflare" -ForegroundColor Yellow
Write-Host "Internal    : Django on 127.0.0.1:$DjangoPort (loopback only)"

# --- OTP mode banner (same source of truth as start-https.ps1: backend\.env) ----------
$otpProvider = 'console'
$otpFixed = ''
$envFile = Join-Path $backend '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*SMS_GATEWAY_PROVIDER\s*=\s*(.+?)\s*$') { $otpProvider = $Matches[1] }
        if ($line -match '^\s*DEV_FIXED_OTP_NUMBERS\s*=\s*(.+?)\s*$') { $otpFixed = $Matches[1] }
    }
}
if ($otpFixed -eq '*') {
    Write-Host "OTP mode : FIXED 123456 for ALL numbers (no SMS sent) -- temporary demo/outage mode." -ForegroundColor Yellow
} elseif ($otpProvider -eq 'smsfortius') {
    Write-Host "OTP mode : live SMS via smsfortius (real six-digit codes)." -ForegroundColor Green
} else {
    Write-Host "OTP mode : console ($otpProvider) -- codes print in the Mait Django tab, no SMS." -ForegroundColor Yellow
}

# --- Tabs -----------------------------------------------------------------------------
# Tab 1: Django, served by waitress (loopback only). waitress rather than `runserver`: a real
# connection queue and a thread pool, so concurrent sign-ins are handled rather than dropped.
# Pinned to dev settings — wsgi.py defaults to production, under which Django stops serving the
# portal and /media (both gated on DEBUG).
# NOTE: no space before `&&` on purpose — `set X=val && ...` captures the space into the value, so
# Django would try to import "config.settings.dev " (trailing space) and fail to start.
$django = "set DJANGO_SETTINGS_MODULE=config.settings.dev&& $waitress --listen=127.0.0.1:$DjangoPort --threads=12 config.wsgi:application"
$apiTab = "new-tab --title `"Mait Django  [127.0.0.1:$DjangoPort waitress]`" cmd /k `"cd /d $backend && $django`""

# Tab 2: cloudflared — the tunnel to Cloudflare's edge.
$cfCmd  = "`"$cfExe`" tunnel --config `"$cfConfig`" run $TunnelName"
$cfTab  = "new-tab --title `"Mait Cloudflare  [:443]`" cmd /k `"$cfCmd`""

Start-Process wt.exe -ArgumentList "-w $WindowName $apiTab ; $cfTab"

Write-Host ""
Write-Host "Started Django and the Cloudflare tunnel as tabs in the '$WindowName' window."
Write-Host "Verify from anywhere:  curl.exe https://$Domain/api/v1/health/   (expect 200)" -ForegroundColor Yellow
Write-Host "Once that passes, push mobile\server.json to develop so installed apps move to 443." -ForegroundColor Yellow
