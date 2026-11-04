# =======================================================================================
# Remove the Mait AI Windows services installed by install-services.ps1.
#
# Removes MaitAI-Django, MaitAI-Caddy (if present) and the Cloudflared tunnel service.
# After this, go back to running the app via start_all.ps1 / start-https.ps1 (terminal tabs).
#
# RUN AS ADMINISTRATOR.
#   .\infra\services\uninstall-services.ps1
# =======================================================================================

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Error "Run this in an elevated PowerShell (Run as administrator)."
    exit 1
}

function Resolve-Nssm {
    $cmd = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    if ($cmd) { return $cmd }
    Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
$nssm = Resolve-Nssm

foreach ($svc in @('MaitAI-Django', 'MaitAI-Caddy')) {
    if (Get-Service -Name $svc -ErrorAction SilentlyContinue) {
        Write-Host "Removing $svc..." -ForegroundColor Cyan
        if ($nssm) {
            & $nssm stop $svc 2>$null | Out-Null
            & $nssm remove $svc confirm 2>$null | Out-Null
        } else {
            Stop-Service $svc -Force -ErrorAction SilentlyContinue
            sc.exe delete $svc | Out-Null
        }
    }
}

# The Cloudflare tunnel service, registered by cloudflared itself.
if (Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue) {
    Write-Host "Removing the Cloudflare tunnel service..." -ForegroundColor Cyan
    $cfExe = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cfExe) { $cfExe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
    if (Test-Path $cfExe) { & $cfExe service uninstall 2>$null | Out-Null }
    else { Stop-Service 'Cloudflared' -Force -ErrorAction SilentlyContinue; sc.exe delete 'Cloudflared' | Out-Null }
}

Write-Host "Done. Mait AI services removed." -ForegroundColor Green
