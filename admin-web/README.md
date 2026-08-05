# Admin web portal

Back-office portal for SAP master-data upload, user and MPP management, inventory oversight
and dashboards (SRS §6.1, §6.7, §6.8).

Plain HTML, CSS and JavaScript with jQuery and AJAX, per SRS §4. No build step, no framework.
That is a deliberate constraint, not an oversight — keep it that way unless an ADR says
otherwise.

## Running it

The portal is static files served by Nginx, calling the same API as the mobile app:

```bash
make up          # from the repo root
```

Then open http://localhost:8080/. Nginx proxies `/api/` to the Django container, so the
browser sees one origin and CORS never enters the picture locally.

## Vendor scripts

`assets/vendor/` is not populated yet. Download the pinned versions once:

- `jquery-3.7.1.min.js`
- `chart-4.4.4.min.js`

They are served locally rather than from a CDN on purpose. This portal renders member PII,
and any third-party script on the page can read everything the page can — a CDN compromise
would be a data breach, not an outage.

## Structure

```
admin-web/
├── index.html            dashboard
├── login.html            password login (Admin)
├── uploads.html          SAP master upload + history
├── ai-events.html        event list, filters, export
├── assets/
│   ├── css/tokens.css    design tokens — the only place colours live
│   ├── css/main.css      base styles and components
│   ├── js/api.js         API client: auth, refresh, RFC-7807 errors
│   └── vendor/           pinned jQuery and Chart.js
└── cypress/              E2E specs
```

## Conventions

**Colours come from tokens.** CI fails the build on a hex literal anywhere outside
`tokens.css` (`.github/workflows/admin-web-ci.yml`). Use `var(--color-*)`. A palette change
should be one edit, not a grep across forty files.

**All API access goes through `MaitAI.api`.** A stray `$.ajax` in a page skips token refresh,
error normalisation and the redirect-to-login path.

**Tokens live in `sessionStorage`, not `localStorage`.** Back-office machines are shared; a
token that survives closing the browser is a token the next person can use.

**PII stays masked.** The API returns Aadhaar, PAN and bank values masked by default. Do not
build a view that requests the unmasked variant unless the task genuinely requires it — that
endpoint is restricted and every read is audit-logged.

## Testing

```bash
npm run lint
npm run format:check
npm run validate:html
npm run test:e2e         # Cypress — upload flow, dashboard render, export
```
