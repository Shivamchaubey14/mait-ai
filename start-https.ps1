# =======================================================================================
# Run Mait AI over HTTPS with the real domain name.
#
#   Public  -> https://mait-ai.shwetdharamilk.com:8001/         (portal)
#              https://mait-ai.shwetdharamilk.com:8001/api/v1/   (API, docs at /api/docs/)
#
# Three processes, as tabs in the shared "Shwetdhara" Windows Terminal window:
#
#   phone / browser ──https──▶  :8001  Caddy (TLS, wildcard *.shwetdharamilk.com)
#                                        │ reverse_proxy
#                                        ▼
#                               127.0.0.1:8010  Django (plain HTTP, loopback only)
#   phone (Expo Go) ──Metro QR──▶ Expo dev server, configured to use the HTTPS API above
#
# Django runs on 127.0.0.1:8010, not 8000: on this machine the Easy Indent app owns 8000.
# Only Caddy reaches Django, and Caddy terminates TLS, so the app is reachable ONLY as
# https and only through the domain (the cert is for *.shwetdharamilk.com).
#
# Requires Caddy (winget install CaddyServer.Caddy) and the certificates already copied to
# infra\caddy\certs\ (fullchain.crt + wildcard.shwetdharamilk.com.key). See docs/HANDOVER.md.
#
# Usage:   powershell -ExecutionPolicy Bypass -File .\start-https.ps1
# Stop:    close the two tabs it opens, or Ctrl+C in each.
# =======================================================================================

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- Settings -------------------------------------------------------------------------
$Domain       = 'mait-ai.shwetdharamilk.com'   # the public host on the wildcard cert
$PublicIp     = '139.167.46.118'               # office public IP (FortiGate forwards 8001 here)
$HttpsPort    = 8001                            # public HTTPS port (FortiGate forwards this)
$DjangoPort   = 8010                            # internal loopback port for Django
$WindowName   = 'Shwetdhara'                    # shared Windows Terminal window

# Which host Caddy answers on (Caddyfile's MAIT_SITE).
#   ":$HttpsPort"        -> answers on the port for ANY host, so it works over the public IP
#                           NOW, before the subdomain's DNS exists. The wildcard cert is still
#                           served, so https://<ip>:8001 shows a name-mismatch warning you
#                           click through. This is the interim setting.
#   "$Domain`:$HttpsPort" -> answers only for the subdomain, with a fully trusted (no-warning)
#                           certificate. Switch to this line once mait-ai.shwetdharamilk.com
#                           resolves to $PublicIp in DNS. Nothing else changes.
$BindSite = "$Domain`:$HttpsPort"

$py       = Join-Path $root 'backend\.venv\Scripts\python.exe'
$backend  = Join-Path $root 'backend'
$mobile   = Join-Path $root 'mobile'
$caddyDir = Join-Path $root 'infra\caddy'

# --- Preconditions --------------------------------------------------------------------
if (-not (Test-Path $py)) {
    Write-Error "venv not found at $py. Create it: python -m venv backend\.venv; backend\.venv\Scripts\python -m pip install -r backend\requirements\dev.txt"
    exit 1
}

if (-not (Test-Path (Join-Path $mobile 'node_modules\.bin\expo.cmd'))) {
    Write-Error "Expo dependencies not found in $mobile. Run npm install from the mobile directory."
    exit 1
}

# Resolve caddy: PATH first (after a shell restart), else the winget install location.
$caddyExe = (Get-Command caddy -ErrorAction SilentlyContinue).Source
if (-not $caddyExe) {
    $caddyExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter caddy.exe -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
}
if (-not $caddyExe) {
    Write-Error "Caddy not found. Install it:  winget install CaddyServer.Caddy  (then open a new window)."
    exit 1
}

$cert = Join-Path $caddyDir 'certs\fullchain.crt'
$key  = Join-Path $caddyDir 'certs\wildcard.shwetdharamilk.com.key'
if (-not ((Test-Path $cert) -and (Test-Path $key))) {
    Write-Error "Certificate or key missing in $caddyDir\certs\. Copy them from the HTTPS kit (see docs/HANDOVER.md)."
    exit 1
}

Write-Host "Caddy    : $caddyExe"
Write-Host "Bind     : $BindSite  (upstream 127.0.0.1:$DjangoPort)"
if ($BindSite -like ':*') {
    Write-Host "Public   : https://$PublicIp`:$HttpsPort/  (portal + /api/v1/) — over the forwarded IP" -ForegroundColor Yellow
    Write-Host "           Browser shows a cert name-mismatch warning until the subdomain DNS is live." -ForegroundColor DarkYellow
} else {
    Write-Host "Public   : https://$Domain`:$HttpsPort/  (portal + /api/v1/) — trusted cert" -ForegroundColor Yellow
}
Write-Host "Internal : Django on 127.0.0.1:$DjangoPort (loopback only)"

# --- OTP mode banner ------------------------------------------------------------------
# Read straight from backend\.env (the one file Django loads), so what is printed here is what
# sign-ins will actually do rather than a guess. Commented lines (starting with #) are ignored,
# so a disabled provider line is not mistaken for the live one.
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
    Write-Host "           To go back to real SMS: in backend\.env set DEV_FIXED_OTP_NUMBERS=9999999999" -ForegroundColor DarkYellow
    Write-Host "           and SMS_GATEWAY_PROVIDER=smsfortius, then run start_all again." -ForegroundColor DarkYellow
} elseif ($otpProvider -eq 'smsfortius') {
    Write-Host "OTP mode : live SMS via smsfortius (real six-digit codes)." -ForegroundColor Green
} else {
    Write-Host "OTP mode : console ($otpProvider) -- codes print in the Mait Django tab, no SMS." -ForegroundColor Yellow
}

# --- Tabs -----------------------------------------------------------------------------
# Tab 1: Django (loopback only, no autoreload for a stable single process).
$apiTab = "new-tab --title `"Mait Django  [127.0.0.1:$DjangoPort]`" cmd /k `"cd /d $backend && $py manage.py runserver 127.0.0.1:$DjangoPort --noreload`""

# Tab 2: Caddy — run FROM infra\caddy so the relative cert/log paths in the Caddyfile
# resolve. MAIT_SITE picks the bind host (see $BindSite above); MAIT_UPSTREAM points it at
# our Django port. Both override the Caddyfile defaults.
$caddyCmd = "cd /d $caddyDir && set MAIT_SITE=$BindSite && set MAIT_UPSTREAM=127.0.0.1:$DjangoPort && `"$caddyExe`" run"
$caddyTab = "new-tab --title `"Mait Caddy  [:$HttpsPort https]`" cmd /k `"$caddyCmd`""

# Tab 3: Expo. An explicit API URL is essential here: without it Expo Go follows the
# packager host to port 8000, which belongs to Easy Indent on this machine, not Mait AI.
$apiUrl = "https://$Domain`:$HttpsPort/api/v1"
$expoCmd = "cd /d $mobile && set EXPO_PUBLIC_API_URL=$apiUrl && npm.cmd start -- --lan"
$expoTab = "new-tab --title `"Mait Mobile  [Expo]`" cmd /k `"$expoCmd`""

Start-Process wt.exe -ArgumentList "-w $WindowName $apiTab ; $caddyTab ; $expoTab"

Write-Host ""
Write-Host "Started Django, Caddy, and Expo as tabs in the '$WindowName' Windows Terminal window."
Write-Host "Mobile: scan the QR code in the Mait Mobile tab with Expo Go; API: $apiUrl" -ForegroundColor Yellow
if ($BindSite -like ':*') {
    Write-Host "Verify on this machine (-k accepts the IP name-mismatch, connection is still TLS):"
    Write-Host "  curl.exe -k https://127.0.0.1:$HttpsPort/api/v1/health/"
} else {
    Write-Host "Verify on this machine (forces the domain to resolve locally):"
    Write-Host "  curl.exe --resolve $Domain`:$HttpsPort`:127.0.0.1 https://$Domain`:$HttpsPort/api/v1/health/"
}
