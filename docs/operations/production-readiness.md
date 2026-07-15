# Production Readiness

## Production Boundary

The application runs the production workflow even when external dependencies are missing:

- Fenbeitong sync uses an explicit adapter mode.
- Kingdee voucher save uses an explicit adapter mode.
- Timed synchronization uses an explicit scheduler mode and does not start unless `SCHEDULER_ENABLED=true`.
- Fenbeitong mock data is allowed only when `FENBEITONG_MODE=mock`; Kingdee mock mode is not allowed to produce ERP save success.
- Real mode fails fast when required configuration is missing.

## Mock Replacement Policy

Mock replacement is visible in API responses, local records, sync batches, operation logs, and the workbench UI.

## Operational Checks

- `GET /api/health`: process is alive.
- `GET /api/ready`: dependencies are ready for the configured mode.
- `GET /api/system/status`: dashboard counts, latest batch, dependency mode, and sanitized config summary.
- `GET /api/scheduler/status`: scheduler enabled flag, interval, auto-push mode, last run, last error, and run count.
- `POST /api/scheduler/run-once`: manual scheduler cycle for testing the active sync path.
- `GET /api/operations/logs`: local audit trail without secrets.

## Scheduler Policy

- Default mode is disabled to avoid surprise background writes.
- Manual run is available for validation before enabling timed execution.
- Auto-push to ERP is disabled by default. It should only be enabled after real `GL_VOUCHER` save behavior is confirmed in the test account set.
- Scheduler errors are written to operation logs and surfaced in scheduler status.

## Data Storage

Local state is stored in `runtime-data/state.json`. Fenbeitong company credentials, cached tokens, token expiry, refresh intervals, endpoint paths, and per-company list payloads are stored in `runtime-data/fenbeitong-tenants.sqlite`. The directory is ignored by Git.

## Current External Blockers

- Additional Fenbeitong companies remain blocked until their SQLite tenant credentials are configured.
- Current test-account smoke mapping saves debit lines to `6111` and credit lines to `1001.01`, verified by real Save plus View. Final finance-grade `6601.*` expense mapping remains blocked until the ERP auxiliary-dimension OpenAPI shape is confirmed.
