# Deployment & operations runbook

## Environments

| Environment | Branch | URL | Deploy trigger | Data |
| --- | --- | --- | --- | --- |
| dev | any | localhost | `make up` | Seeded fixtures |
| staging | `develop` | staging-api.maitai.internal | Automatic on merge | Production-like SAP snapshot, anonymised |
| production | `main` (tagged) | api.maitai.internal | Manual approval gate | Live |

Each environment has its own MySQL instance, Redis, S3 bucket and **separate JWT signing
keys**. A token minted in staging is worthless in production by construction.

## Required secrets

Set as GitHub Actions environment secrets, never committed. `backend/.env.example` lists the
full set with descriptions.

| Secret | Notes |
| --- | --- |
| `DJANGO_SECRET_KEY` | Distinct per environment |
| `FIELD_ENCRYPTION_KEY` | Fernet key for PII at rest. **Losing this makes Aadhaar/PAN/bank columns unreadable.** Back it up in the secret manager, not here. |
| `DATABASE_URL` | `mysql://user:pass@host:3306/maitai?charset=utf8mb4` |
| `DATABASE_REPLICA_URL` | Read replica for dashboard queries |
| `REDIS_URL` | Cache, OTP store, Celery broker |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_STORAGE_BUCKET_NAME` | Object storage for photos and payment screenshots |
| `SMS_GATEWAY_API_KEY` / `SMS_GATEWAY_SENDER_ID` | MSG91 or Twilio |
| `INDENT_EASY_BASE_URL` / `INDENT_EASY_API_KEY` / `INDENT_EASY_WEBHOOK_SECRET` | Integration + inbound HMAC verification |
| `SENTRY_DSN` | Error tracking |

## Deploy sequence

Every production deploy runs in this order. The migration step is separate and precedes the
app rollout so a failing migration never leaves half the fleet on new code.

```
1. Build       multi-stage Docker image, non-root user, tagged with the git SHA
2. Scan        Trivy image scan + pip-audit; fails the deploy on HIGH/CRITICAL
3. Migrate     one-off job: python manage.py migrate --noinput
4. Deploy      rolling update, maxUnavailable=0, readiness gated on /api/v1/health/ready/
5. Smoke       health check + one synthetic AI-event flow end to end
6. Rollback    automatic if step 5 fails — see below
```

### Migration discipline

Migrations must be **backward compatible with the currently running release**, because during
a rolling update both versions serve traffic simultaneously.

- Adding a column: nullable or with a default. Never `NOT NULL` without a default in one step.
- Removing a column: two releases. Release N stops writing it; release N+1 drops it.
- Renaming: never rename. Add the new column, backfill, switch reads, drop the old one later.
- Large backfills on 105k+ row tables run as a Celery job, not inside the migration.

### Rollback

```bash
kubectl rollout undo deployment/maitai-api -n production      # app rollback, ~30s
```

Application rollback is safe and fast. **Data rollback is not** — if a migration has already
run, rolling back application code to a version that does not understand the new schema can
break. This is exactly why migrations must be backward compatible; with that discipline held,
`rollout undo` alone is always sufficient.

If a migration itself must be reverted, restore from the pre-deploy snapshot taken in step 3
and treat it as an incident.

## Health checks

| Endpoint | Checks | Used by |
| --- | --- | --- |
| `/api/v1/health/` | Process is alive | Kubernetes liveness probe |
| `/api/v1/health/ready/` | MySQL, Redis and object storage reachable | Readiness probe, deploy gate |

Readiness failing takes a pod out of rotation without killing it, so a brief Redis blip
degrades capacity rather than causing a crash loop.

## Monitoring & alerting

| Signal | Threshold | Action |
| --- | --- | --- |
| API 5xx rate | > 1% over 5 min | Page |
| API P95 latency | > 800 ms writes / 400 ms reads (SRS §7) | Investigate |
| Celery queue depth | > 1000 or growing 10 min straight | Investigate worker health |
| Failed OTP sends | > 5% of attempts | Check gateway credentials/balance |
| Indent Easy sync failures | Any 3 consecutive | Check integration; reconciliation job should catch up |
| MySQL replica lag | > 30 s | Dashboards will read stale; consider failing reads to primary |
| Disk on object storage | > 80% | Review lifecycle archival policy |

Sentry captures errors; Prometheus/Grafana holds metrics; uptime alerting covers the API and
Celery queue depth.

## Backups

- MySQL: daily automated snapshot, 30-day retention, plus binlog for point-in-time recovery.
- Object storage: versioning enabled, lifecycle-archived after the retention period confirmed
  by the business (SRS §18.2 open item 5).
- **Restore drills quarterly.** A backup that has never been restored is a hypothesis.

## Go-live checklist (SRS §12 Day 30)

- [ ] Full regression suite green on staging
- [ ] Load test at 200 concurrent Maits meets the §7 latency targets
- [ ] RBAC matrix manually verified for all five roles
- [ ] PII masking verified on every serializer returning Aadhaar/PAN/bank fields
- [ ] Rate limits confirmed active on OTP endpoints
- [ ] Indent Easy webhook HMAC verified with the real shared secret
- [ ] `FIELD_ENCRYPTION_KEY` backed up in the secret manager, restore tested
- [ ] Database backup taken and a restore drill completed
- [ ] Sentry, Prometheus and uptime alerting receiving data from production
- [ ] Swagger/Redoc published and reachable
- [ ] Play Store internal track build distributed to pilot Maits
- [ ] Hypercare rota agreed and monitoring dashboard live
- [ ] Rollback procedure walked through by whoever is on call
