<#
.SYNOPSIS
    Runs a development server in a loop, restarting it whenever it exits.

.DESCRIPTION
    `dev-start.ps1` starts each server once. That is right for a morning at the desk and
    wrong for a machine that is showing the product to somebody: the moment the network
    drops, or Windows reclaims memory, whatever died stays dead and the first anybody knows
    of it is a screen full of errors on a colleague's handset.

    This is the same servers under a supervisor. A process that exits is reported with the
    time and its exit code, and started again a moment later. Nothing here diagnoses *why*
    it went - the loop does not need to know, which is the point.

    What actually goes, and when:

      tunnel   ngrok. The one that genuinely follows the network. Its agent reconnects on
               its own after a blip, so this loop is for the case where the agent itself is
               gone. The URL is reserved to the account, so a restarted tunnel comes back on
               the same address and the preview build in `mobile/eas.json` keeps working.

      backend  Django. Bound to 0.0.0.0, so it does *not* care about the internet - a
               dropped Wi-Fi leaves it serving happily. It goes for other reasons: the host
               running short of memory, or a terminal being closed.

      portal   The static server on 8080. Only needed for working on the portal itself;
               through the tunnel the portal is served by Django on 8000, which is the whole
               reason one tunnel covers the office and the handsets both.

    Each role wants its own window. Run with no role to open all three.

    Safe to re-run. Whatever is already up is left alone, and only the gap is started -
    which is the normal case, because the three do not die together: the tunnel and the
    portal sit in their own windows for hours while the API is reclaimed for memory. A
    second window for a role already running cannot bind the port, or claim a reserved
    address one agent already holds, so it would only fail and scroll.

.PARAMETER Role
    backend, portal, tunnel, or omitted for one window each.

.PARAMETER Force
    Start the role even when it looks like it is already running.

.EXAMPLE
    .\scripts\dev-keepalive.ps1
    .\scripts\dev-keepalive.ps1 -Role backend
#>

[CmdletBinding()]
param(
    [ValidateSet('backend', 'portal', 'tunnel')]
    [string]$Role,

    # The reserved ngrok address. Overridable so this is not the one file that has to be
    # edited when the account's URL changes; the default is the one docs/HANDOVER.md names.
    [string]$TunnelUrl = 'https://diary-flattery-hurray.ngrok-free.dev',

    # Seconds between an exit and the next attempt. Long enough that a server failing to
    # bind at all scrolls at a readable pace rather than filling the window.
    [int]$RestartDelaySeconds = 3,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Test-Listening {
    param([int]$Port)
    # SilentlyContinue rather than a try: no connection on the port is the ordinary answer
    # here, not an error, and the script-wide 'Stop' would otherwise make it terminating.
    $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-RoleRunning {
    param([string]$Name, [string]$Url)

    switch ($Name) {
        'backend' { return (Test-Listening 8000) }
        'portal'  { return (Test-Listening 8080) }
        'tunnel'  {
            # Ask the agent's own API rather than looking for an ngrok.exe, because the
            # question is not whether an agent exists but whether one is serving *this*
            # reserved address. An agent up on somebody else's tunnel is a different fault,
            # and one this should not quietly treat as success.
            try {
                $agent = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3
            } catch {
                return $false
            }
            return [bool]($agent.tunnels | Where-Object { $_.public_url -eq $Url })
        }
    }
    return $false
}

if (-not $Role) {
    Write-Host 'Opening a supervised window for each server ...' -ForegroundColor Cyan
    foreach ($each in @('backend', 'portal', 'tunnel')) {
        if (-not $Force -and (Test-RoleRunning -Name $each -Url $TunnelUrl)) {
            Write-Host "  $each is already up - left alone." -ForegroundColor DarkGray
            continue
        }
        Start-Process powershell -ArgumentList @(
            '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-Role', $each, '-TunnelUrl', $TunnelUrl
        )
        Write-Host "  $each starting in its own window." -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host "Portal   http://127.0.0.1:8080/   (and $TunnelUrl for the office)" -ForegroundColor Green
    Write-Host "API      http://127.0.0.1:8000/api/v1/   (and $TunnelUrl/api/v1/ for handsets)" -ForegroundColor Green
    Write-Host "Tunnel   $TunnelUrl  ->  127.0.0.1:8000" -ForegroundColor Green
    Write-Host '         Reserved to the account, so a restarted tunnel returns on the same' -ForegroundColor DarkGray
    Write-Host '         address and mobile/eas.json stays correct.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'Expo is not started here - it belongs in your own window:' -ForegroundColor Yellow
    Write-Host '    cd mobile; npx expo start -c' -ForegroundColor Yellow
    return
}

# What each role is, in one place: the working directory, the executable, and its arguments.
# Held as an argument array rather than a command string so a path with a space in it does
# not need quoting rules that differ per role.
$roles = @{
    backend = @{
        Directory = Join-Path $repo 'backend'
        File      = 'python'
        # --noreload on purpose. Django's autoreloader is a parent process watching a child,
        # and this loop can only wait on the parent: kill the pair badly and the child is
        # orphaned still holding :8000, so the restart cannot bind and the supervisor spins
        # against a port taken by the server it is trying to replace. One process is what can
        # actually be supervised, and nobody is editing code on a machine left running a demo.
        Arguments = @('manage.py', 'runserver', '0.0.0.0:8000', '--noreload')
        Says      = 'API on http://0.0.0.0:8000'
    }
    portal  = @{
        Directory = Join-Path $repo 'admin-web'
        File      = 'python'
        Arguments = @('-m', 'http.server', '8080', '--bind', '127.0.0.1')
        Says      = 'Admin portal on http://127.0.0.1:8080'
    }
    tunnel  = @{
        Directory = $repo
        File      = 'ngrok'
        Arguments = @('http', '8000', "--url=$TunnelUrl", '--log=stdout')
        Says      = "Tunnel $TunnelUrl -> :8000"
    }
}

$plan = $roles[$Role]

# Fail on the thing the operator can fix, rather than in a restart loop that reports the
# same missing file every three seconds until somebody reads it.
if ($Role -ne 'tunnel' -and -not (Test-Path (Join-Path $repo 'backend\.env'))) {
    Write-Error "backend\.env is missing. Copy backend\.env.example to backend\.env and fill it in."
}
if (-not (Get-Command $plan.File -ErrorAction SilentlyContinue)) {
    Write-Error "$($plan.File) is not on PATH, so the $Role cannot be started."
}

if (-not $Force -and (Test-RoleRunning -Name $Role -Url $TunnelUrl)) {
    Write-Host "$Role is already up - nothing to do. Pass -Force to supervise a second one anyway." -ForegroundColor Yellow
    return
}

$Host.UI.RawUI.WindowTitle = "mait-ai $Role"
Write-Host "$($plan.Says) - supervised, Ctrl+C to stop." -ForegroundColor Cyan

$attempt = 0
while ($true) {
    $attempt = $attempt + 1
    $startedAt = Get-Date
    Write-Host ("[{0}] starting {1} (attempt {2})" -f $startedAt.ToString('HH:mm:ss'), $Role, $attempt) -ForegroundColor DarkGray

    # -Wait rather than a job: the child's own output belongs in this window, which is what
    # makes a supervised server no harder to read than an unsupervised one. Ctrl+C reaches
    # the child and ends the loop with it.
    $process = Start-Process -FilePath $plan.File -ArgumentList $plan.Arguments `
        -WorkingDirectory $plan.Directory -NoNewWindow -PassThru -Wait

    $ran = [int]((Get-Date) - $startedAt).TotalSeconds
    Write-Host ("[{0}] {1} exited with {2} after {3}s - restarting in {4}s" -f `
        (Get-Date).ToString('HH:mm:ss'), $Role, $process.ExitCode, $ran, $RestartDelaySeconds) -ForegroundColor Yellow

    Start-Sleep -Seconds $RestartDelaySeconds
}
