# =======================================================================================
# Install Mait AI as Windows services, so it survives a reboot and restarts if it crashes.
#
# Two (or three) services:
#   * MaitAI-Django   -- Django served by waitress on 127.0.0.1:8010 (always)
#   * the edge, one of:
#       -Edge cloudflare  -> the Cloudflare Tunnel (443 path; the target). Uses cloudflared's
#                            own service installer.
#       -Edge caddy       -> Caddy on :8001 (the interim path). Wrapped with NSSM.
#       -Edge none        -> Django only; run the edge however you like.
#     Default is 'cloudflare'.
#
# waitress and Caddy are plain executables, not service binaries, so they are wrapped with NSSM
# (the Non-Sucking Service Manager) -- the standard Windows way to run an exe as an auto-restarting
# service. cloudflared registers itself.
#
# RUN AS ADMINISTRATOR. Prerequisites:
#   * NSSM:        winget install NSSM.NSSM            (needed for Django, and for -Edge caddy)
#   * cloudflared: already installed; needed for -Edge cloudflare, and its config.yml filled in
#                  (see infra\cloudflared\README.md)
#
# Usage (elevated PowerShell):
#   .\infra\services\install-services.ps1                 # Django + Cloudflare tunnel
#   .\infra\services\install-services.ps1 -Edge caddy     # Django + Caddy :8001 (interim)
#   .\infra\services\install-services.ps1 -Edge none      # Django only
# Remove them with infra\services\uninstall-services.ps1.
# =======================================================================================

param(
    [ValidateSet('cloudflare', 'caddy', 'none')]
    [string]$Edge = 'cloudflare',
    [int]$DjangoPort = 8010,
    [int]$Threads = 12
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # ...\infra\services -> repo root

# --- Must be elevated -----------------------------------------------------------------
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Error "Run this in an elevated PowerShell (Run as administrator). Creating services needs it."
    exit 1
}

$backend  = Join-Path $root 'backend'
$waitress = Join-Path $root 'backend\.venv\Scripts\waitress-serve.exe'
$logsDir  = Join-Path $root 'infra\services\logs'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (-not (Test-Path $waitress)) {
    Write-Error "waitress not found at $waitress. Run: backend\.venv\Scripts\python.exe -m pip install -r backend\requirements\dev.txt"
    exit 1
}

# --- Locate NSSM (needed for Django, and for the Caddy edge) ---------------------------
function Resolve-Nssm {
    $cmd = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    if ($cmd) { return $cmd }
    $hit = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
           Where-Object { $_.FullName -match '\\win64\\' } | Select-Object -First 1 -ExpandProperty FullName
    if (-not $hit) {
        $hit = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
               Select-Object -First 1 -ExpandProperty FullName
    }
    return $hit
}

$nssm = Resolve-Nssm
if (-not $nssm) {
    Write-Error "NSSM not found. Install it:  winget install NSSM.NSSM   (then open a new elevated window). It wraps waitress/Caddy as auto-restarting services."
    exit 1
}
Write-Host "NSSM     : $nssm"

# --- Service 1: MaitAI-Django (waitress) ----------------------------------------------
$svc = 'MaitAI-Django'
Write-Host "Installing $svc (waitress on 127.0.0.1:$DjangoPort)..." -ForegroundColor Cyan

# Remove a previous copy so this is idempotent.
& $nssm stop $svc 2>$null | Out-Null
& $nssm remove $svc confirm 2>$null | Out-Null

$djArgs = "--listen=127.0.0.1:$DjangoPort --threads=$Threads config.wsgi:application"
& $nssm install $svc $waitress $djArgs
& $nssm set $svc AppDirectory $backend
# wsgi.py defaults to production settings, under which Django stops serving the portal and /media
# (both gated on DEBUG). The field server runs dev settings, so pin them here too.
& $nssm set $svc AppEnvironmentExtra "DJANGO_SETTINGS_MODULE=config.settings.dev"
& $nssm set $svc DisplayName "Mait AI - Django (waitress)"
& $nssm set $svc Description "Mait AI backend served by waitress on 127.0.0.1:$DjangoPort (dev settings)."
& $nssm set $svc Start SERVICE_AUTO_START
# Restart on crash: wait 3s, and if it is dying faster than every 90s treat it as a crash loop
# and back off rather than hammering.
& $nssm set $svc AppExit Default Restart
& $nssm set $svc AppRestartDelay 3000
& $nssm set $svc AppThrottle 90000
& $nssm set $svc AppStdout (Join-Path $logsDir 'django.out.log')
& $nssm set $svc AppStderr (Join-Path $logsDir 'django.err.log')
& $nssm set $svc AppRotateFiles 1
& $nssm set $svc AppRotateBytes 10485760
& $nssm start $svc
Write-Host "  $svc installed and started." -ForegroundColor Green

# --- Service 2: the edge --------------------------------------------------------------
if ($Edge -eq 'cloudflare') {
    $cfConfig = Join-Path $root 'infra\cloudflared\config.yml'
    $cfExe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cfExe) { $cfExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
    if (-not (Test-Path $cfExe)) {
        Write-Error "cloudflared not found. Install it: winget install --id Cloudflare.cloudflared"
        exit 1
    }
    if (-not (Test-Path $cfConfig)) {
        Write-Error "Tunnel config not found at $cfConfig. Do the setup in infra\cloudflared\README.md first."
        exit 1
    }
    if (Select-String -Path $cfConfig -Pattern 'PUT-TUNNEL-UUID-HERE' -Quiet) {
        Write-Error "infra\cloudflared\config.yml still has placeholders. Finish the tunnel setup (README) before installing it as a service, or use -Edge caddy for the interim :8001 path."
        exit 1
    }
    Write-Host "Installing the Cloudflare tunnel service..." -ForegroundColor Cyan
    # cloudflared registers its own Windows service (named 'Cloudflared') bound to this config.
    & $cfExe service uninstall 2>$null | Out-Null
    & $cfExe --config $cfConfig service install
    Start-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue
    Write-Host "  Cloudflare tunnel installed. Verify: curl.exe https://mait-ai.shwetdharamilk.com/api/v1/health/" -ForegroundColor Green
}
elseif ($Edge -eq 'caddy') {
    $caddyDir = Join-Path $root 'infra\caddy'
    $caddyExe = (Get-Command caddy -ErrorAction SilentlyContinue).Source
    if (-not $caddyExe) {
        $caddyExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter caddy.exe -ErrorAction SilentlyContinue |
                    Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $caddyExe) {
        Write-Error "Caddy not found. Install it: winget install CaddyServer.Caddy"
        exit 1
    }
    $svcC = 'MaitAI-Caddy'
    Write-Host "Installing $svcC (TLS edge on :8001 -> 127.0.0.1:$DjangoPort)..." -ForegroundColor Cyan
    & $nssm stop $svcC 2>$null | Out-Null
    & $nssm remove $svcC confirm 2>$null | Out-Null
    # Run FROM infra\caddy so the relative cert/log paths in the Caddyfile resolve, and pass the
    # same MAIT_* the launcher uses.
    & $nssm install $svcC $caddyExe "run"
    & $nssm set $svcC AppDirectory $caddyDir
    & $nssm set $svcC AppEnvironmentExtra "MAIT_SITE=mait-ai.shwetdharamilk.com:8001" "MAIT_UPSTREAM=127.0.0.1:$DjangoPort"
    & $nssm set $svcC DisplayName "Mait AI - Caddy (HTTPS :8001)"
    & $nssm set $svcC Description "Mait AI TLS edge on :8001, reverse-proxying to Django."
    & $nssm set $svcC Start SERVICE_AUTO_START
    & $nssm set $svcC AppExit Default Restart
    & $nssm set $svcC AppRestartDelay 3000
    & $nssm set $svcC AppThrottle 90000
    & $nssm set $svcC AppStdout (Join-Path $logsDir 'caddy.out.log')
    & $nssm set $svcC AppStderr (Join-Path $logsDir 'caddy.err.log')
    & $nssm start $svcC
    Write-Host "  $svcC installed and started." -ForegroundColor Green
}
else {
    Write-Host "Edge: none -- Django service only." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Services auto-start on boot and restart on crash." -ForegroundColor Green
Write-Host "Check:   Get-Service MaitAI-* , Cloudflared" -ForegroundColor Yellow
Write-Host "Logs:    $logsDir" -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: these services replace the matching tabs in start_all.ps1 / start-https.ps1 --" -ForegroundColor DarkYellow
Write-Host "      do not run both, or two processes fight for the same port." -ForegroundColor DarkYellow
