# Summary

<!-- What changed and, more importantly, why. The diff already says what. -->

Closes #

## Workstream

- [ ] Backend
- [ ] Mobile
- [ ] Admin web
- [ ] Infra / CI
- [ ] Docs

## How this was tested

<!-- Commands run, cases covered, devices used. "It works" is not a test plan. -->

## Screenshots / recording

<!-- Required for any UI change. -->

## Risk checklist

- [ ] **Migrations** — none, or: backward compatible with the running release
      ([why that matters](../docs/DEPLOYMENT.md#migration-discipline))
- [ ] **API contract** — unchanged, or: `docs/API_CONTRACT.md` and `backend/openapi.yaml`
      updated in this PR
- [ ] **Inventory / payments** — untouched, or: concurrency case added to the test suite
- [ ] **PII** — no Aadhaar, PAN or bank value newly logged, returned unmasked, or stored
      unencrypted
- [ ] **Permissions** — every new endpoint declares an explicit permission class
- [ ] **Secrets** — nothing committed; new config added to `backend/.env.example`
- [ ] **Data files** — no `.xlsx`, `.csv` or `.sql` in the diff

## Rollout notes

<!-- Anything the deployer needs: new env vars, a backfill job, an ordering constraint,
     a feature flag. Write "none" if there is genuinely nothing. -->
