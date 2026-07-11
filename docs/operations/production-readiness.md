# Production Readiness

## Production Boundary

The application runs the production workflow even when external dependencies are missing:

- Fenbeitong sync uses an explicit adapter mode.
- Kingdee voucher save uses an explicit adapter mode.
- Mock data is allowed only when `FENBEITONG_MODE=mock` or `KINGDEE_MODE=mock`.
- Real mode fails fast when required configuration is missing.

## Mock Replacement Policy

Mock replacement is visible in API responses, local records, sync batches, operation logs, and the workbench UI.

## Operational Checks

- `GET /api/health`: process is alive.
- `GET /api/ready`: dependencies are ready for the configured mode.
- `GET /api/system/status`: dashboard counts, latest batch, dependency mode, and sanitized config summary.
- `GET /api/operations/logs`: local audit trail without secrets.

## Data Storage

Local state is stored in `runtime-data/state.json` for this standalone teaching project. The directory is ignored by Git and can be replaced by a real database later without changing the workflow contract.

## Current External Blockers

- Fenbeitong access token is not available yet.
- Kingdee `GL_VOUCHER` real save sample is not confirmed yet.
