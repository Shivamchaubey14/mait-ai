# Running Mait AI as Windows services (auto-restart on reboot and crash)

By default Mait AI runs as terminal tabs (`start_all.ps1` → `start-https.ps1`). Those stop when
the window closes or the server is logged off, and nothing restarts them after a crash. These
scripts register Mait AI as **Windows services** instead, so it starts on boot and restarts on
crash, with no one logged in.

## Services created

| Service | What it runs | Wrapper |
|---|---|---|
| `MaitAI-Django` | Django via **waitress** on `127.0.0.1:8010` (dev settings) | NSSM |
| `Cloudflared` | the **Cloudflare Tunnel** (443 path) — `-Edge cloudflare` | cloudflared's own installer |
| `MaitAI-Caddy` | the **Caddy** TLS edge on `:8001` (interim path) — `-Edge caddy` | NSSM |

`MaitAI-Django` is always installed; pick the edge that matches how phones reach the server.

## Prerequisites

- **NSSM** (wraps waitress/Caddy): `winget install NSSM.NSSM`
- For the Cloudflare edge: `cloudflared` installed and `infra/cloudflared/config.yml` filled in
  and verified (see `infra/cloudflared/README.md`).
- Run the scripts in an **elevated** PowerShell (Run as administrator).

## Install

```powershell
# Target state: Django (waitress) + Cloudflare tunnel on 443
.\infra\services\install-services.ps1

# Interim, while still on :8001: Django (waitress) + Caddy
.\infra\services\install-services.ps1 -Edge caddy

# Django only (run the edge yourself)
.\infra\services\install-services.ps1 -Edge none
```

The install is idempotent — re-running replaces the services.

## Important: don't run both

A service and the matching `start_all.ps1` / `start-https.ps1` tab both bind the same port and
will fight. Once services are installed, **remove Mait AI from the interactive launcher** (or just
don't start that tab). The other systems (Easy Indent, KSTS) are unaffected — they keep their own
launchers.

## Manage

```powershell
Get-Service MaitAI-*, Cloudflared          # status
Restart-Service MaitAI-Django              # bounce Django after a code change or settings edit
Get-Content infra\services\logs\django.err.log -Tail 50   # logs
```

Logs rotate at 10 MB in `infra/services/logs/`.

## Remove

```powershell
.\infra\services\uninstall-services.ps1
```

## Notes / still open

- **MySQL and Redis** must be running for the app to work. They are normally their own Windows
  services and start on boot already; if the Django service ever starts before them it simply
  errors on the first requests and recovers once they are up. To make the ordering strict you can
  add a dependency, e.g. `nssm set MaitAI-Django DependOnService <MySQLServiceName>`.
- These services run Django on **dev** settings on purpose (the field deployment relies on Django
  serving the portal and `/media`, which only happens under `DEBUG`). Moving to production settings
  is a larger, separate change (env, `collectstatic`, a real media/static story).
