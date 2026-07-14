# Fenbeitong Kingdee Voucher Collaboration Kit

This is a standalone teaching and collaboration project for developing the Fenbeitong-to-Kingdee voucher workflow without sharing the full `IntRuoyi` codebase.

## What This Project Does

- Runs the formal workflow: sync Fenbeitong, transform data, preview voucher payload, prepare local records, and push to ERP.
- Keeps mock behavior isolated behind Fenbeitong and Kingdee adapters.
- Persists local state to `runtime-data/state.json`.
- Shows dependency readiness, dashboard counts, process records, and operation logs.
- Exposes an explicit scheduler for timed Fenbeitong sync plus a manual "run once" path.
- Provides backend, frontend, contract tests, and E2E smoke tests.
- Uses only mock data by default. Real interfaces can be enabled later through `.env` without changing the workflow code.

## Quick Start

```bash
npm install
npm run dev:backend
npm run dev:frontend
```

Open:

- Frontend: `http://127.0.0.1:5173`
- Backend health: `http://127.0.0.1:3001/api/health`

## Verification

```bash
npm run verify
```

Teacher review should require `npm run verify` to pass before accepting student changes.

## Adapter Modes

Copy `.env.example` to `.env` when local configuration is needed.

- `FENBEITONG_MODE=mock`: loads fixed local JSON.
- `FENBEITONG_MODE=real` with `FENBEITONG_AUTH_MODE=access-token`: requires `FENBEITONG_BASE_URL`, `FENBEITONG_ACCESS_TOKEN`, `FENBEITONG_PULL_PATH`, and `FENBEITONG_DETAIL_PATH`.
- `FENBEITONG_MODE=real` with `FENBEITONG_AUTH_MODE=app-key`: requires `FENBEITONG_BASE_URL`, `FENBEITONG_APP_ID`, `FENBEITONG_APP_KEY`, `FENBEITONG_PULL_PATH`, and `FENBEITONG_DETAIL_PATH`; it defaults token acquisition to `/openapi/auth/getToken`, list pull to `/openapi/reimbursement/v1/list`, and detail pull to `/openapi/reimbursement/v2/detail`. The acquired token is cached for 7200 seconds before refresh. Optional list filters are `FENBEITONG_REIMBURSEMENT_APPLY_STATE`, `FENBEITONG_REIMBURSEMENT_PAYMENT_STATE`, `FENBEITONG_REIMBURSEMENT_PAGE_INDEX`, and `FENBEITONG_REIMBURSEMENT_PAGE_SIZE`.
- `FENBEITONG_TENANT_KEY=puhui`: defaults the Fenbeitong tenant to Puhui. The frontend also shows `璞慧` and `瑛泰`; `瑛泰` is intentionally blocked with `接口等待开发中` until credentials and interface rules are supplied.
- `KINGDEE_MODE=mock`: simulates ERP save response.
- `KINGDEE_MODE=real`: requires `KINGDEE_SAVE_URL` and optional auth header values.

## Scheduler

The scheduler is off by default and must be enabled explicitly.

- `SCHEDULER_ENABLED=false`: no background timer starts.
- `SCHEDULER_INTERVAL_SECONDS=3600`: interval used when the scheduler is enabled.
- `SCHEDULER_AUTO_PUSH_ERP=false`: default behavior only syncs Fenbeitong data. Set to `true` only after voucher mapping config is saved and ERP save behavior is verified.

Manual scheduler testing is available through the frontend button "运行一次定时同步" and `POST /api/scheduler/run-once`.

## Safety Boundaries

- No real Fenbeitong token.
- No real Kingdee credentials.
- Real Fenbeitong sync stores detail responses, not list summaries, so voucher generation has expense lines.
- No external database connection in the teaching kit; local state is stored under `runtime-data/`.
- No Submit, Audit, posting, or approval behavior.
- Mock Kingdee save is only a local simulation and is not evidence of real ERP save success.
