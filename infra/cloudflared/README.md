# Cloudflare Tunnel — getting the app onto port 443

This moves the mobile API from `https://mait-ai.shwetdharamilk.com:8001` (a non-standard port
that many carriers/WiFi block) onto `https://mait-ai.shwetdharamilk.com` on the standard HTTPS
port **443**, which nothing blocks. It needs **no FortiGate change** — the tunnel is an outbound
connection from this server to Cloudflare.

## Why we had to do this

A share of Maits saw **"Mait AI is not answering"** on the login screen. That banner means the
handset could not open a connection to the server at all (a network-level failure, not a server
error and not a timeout). The cause was the `:8001` port: it works on networks that allow it and
fails on networks that don't, which is exactly the "only a few people" pattern. Moving to 443
removes the blocked port from the path.

## One-time setup (on the office server)

Prerequisite: the DNS zone **shwetdharamilk.com must be on Cloudflare** (free plan). If it isn't
yet, add the domain in the Cloudflare dashboard and point the registrar's nameservers at the two
Cloudflare gives you. (If moving the whole zone isn't possible, see "If you can't move the zone"
below.)

1. **Install cloudflared**

   ```powershell
   winget install --id Cloudflare.cloudflared
   ```

2. **Authorise this machine to the zone** (opens a browser; pick shwetdharamilk.com)

   ```powershell
   cloudflared tunnel login
   ```

3. **Create the tunnel** (prints a UUID and writes a credentials JSON into `%USERPROFILE%\.cloudflared\`)

   ```powershell
   cloudflared tunnel create mait-ai
   ```

4. **Point the hostname at the tunnel** (creates the proxied CNAME in DNS)

   ```powershell
   cloudflared tunnel route dns mait-ai mait-ai.shwetdharamilk.com
   ```

5. **Fill in `config.yml`** (next to this file): put the UUID from step 3 into both `tunnel:` and
   the `credentials-file:` path. Confirm the ingress `service:` port matches the port Django runs
   on here (**8010** on this machine; 8000 on a clean server).

6. **SSL mode:** in the Cloudflare dashboard, SSL/TLS → Overview, set **Full**. (Not "Full
   (strict)" — the origin here is plain HTTP behind the tunnel, which is fine; the tunnel itself
   is encrypted.)

## Running it

Django must be running on its loopback port first (the Mait Django tab from `start-https.ps1`, or
the Django tab opened by `start-cloudflare.ps1`). Then:

```powershell
cloudflared tunnel --config infra\cloudflared\config.yml run mait-ai
```

`..\..\start-cloudflare.ps1` starts Django **and** the tunnel together in the usual terminal
window. To keep it up across reboots, install it as a Windows service once:

```powershell
cloudflared --config infra\cloudflared\config.yml service install
```

## Verify before cutover

```powershell
# The app, through Cloudflare on 443 (no :8001):
curl.exe https://mait-ai.shwetdharamilk.com/api/v1/health/
```

Expect `200`. Open the admin portal at `https://mait-ai.shwetdharamilk.com/` too.

## Cutover — move the installed handsets (do this LAST, only after the check above passes)

Installed APKs find the server by reading **`mobile/server.json`** on the `develop` branch and
moving to whatever address it names **once that address's `/health/` answers 200**. So the switch
is a one-line change that is safe to push: a handset will not move to an address that isn't
answering, and a handset currently stuck on the blocked `:8001` will jump to 443 on its next
attempt and recover on its own.

1. Confirm `mobile/server.json` reads:
   ```json
   { "api_url": "https://mait-ai.shwetdharamilk.com/api/v1" }
   ```
2. Commit and **push to `develop`** (that is the file the apps read, raw, from GitHub).
3. `mobile/eas.json` has also been updated so the **next build** starts on 443 directly. Existing
   installs don't need a rebuild — they migrate via step 2.

Order matters: stand up and verify the tunnel **first**, then push `server.json`. Pushing it
before the tunnel answers does no harm (handsets stay on `:8001`), it just doesn't help anyone
until the tunnel is up.

## If you can't move the zone to Cloudflare

A tunnel's `route dns` needs the zone on Cloudflare. If that's genuinely not possible, the
fallback that still reaches 443 is to have the FortiGate forward **443** for this subdomain to
Caddy on 8001 — but that is a firewall change on the shared public IP, which is the thing the
`:8001` arrangement existed to avoid. The tunnel is preferred precisely because it needs no
inbound port.

## What did NOT change

- The `:8001` / Caddy path (`infra/caddy/Caddyfile`, `start-https.ps1`) still works and is left
  in place as a fallback during migration.
- No backend change was needed: the field server runs dev settings with `ALLOWED_HOSTS=["*"]` and
  already trusts `X-Forwarded-Proto`, so media URLs come out as `https://…/media/…` on 443.
- The dev server is still Django's `runserver`. Under heavy concurrent sign-in load that can also
  drop connections; running it behind a real WSGI server (waitress) with auto-restart is a
  separate, still-recommended hardening step.
