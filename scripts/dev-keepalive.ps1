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

.PARAMETER Role
    backend, portal, tunnel, or omitted for one window each.

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
    [string]$TunnelUrl = 'https://apolonia-unvouchsafed-joy.ngrok-free.dev',

    # Seconds between an exit and the next attempt. Long enough that a server failing to
    # bind at all scrolls at a readable pace rather than filling the window.
    [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if (-not $Role) {
    Write-Host 'Opening a supervised window for each server ...' -ForegroundColor Cyan
    foreach ($each in @('backend', 'portal', 'tunnel')) {
        Start-Process powershell -ArgumentList @(
            '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-Role', $each, '-TunnelUrl', $TunnelUrl
        )
    }
    Write-Host ''
    Write-Host "Portal   http://127.0.0.1:8080/   (and $TunnelUrl for the office)" -ForegroundColor Green
    Write-Host "API      http://127.0.0.1:8000/api/v1/   (and $TunnelUrl/api/v1/ for handsets)" -ForegroundColor Green
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
