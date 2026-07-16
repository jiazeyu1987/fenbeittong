# Fenbeitong Kingdee Voucher Collaboration Kit

This is a standalone teaching and collaboration project for developing the Fenbeitong-to-Kingdee voucher workflow without sharing the full `IntRuoyi` codebase.

## What This Project Does

- Runs the formal workflow: sync Fenbeitong, transform data, preview voucher payload, prepare local records, and push to ERP.
- Keeps mock behavior isolated behind Fenbeitong and Kingdee adapters.
- Persists local state to `runtime-data/state.json`.
- Shows dependency readiness, dashboard counts, process records, and operation logs.
- Exposes an explicit scheduler for timed Fenbeitong sync plus a manual "run once" path.
- Provides backend, frontend, contract tests, and E2E smoke tests.
- Uses only mock data by default. Real Fenbeitong credentials are stored in the local SQLite tenant store, not environment variables.

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

Copy `.env.example` to `.env` when local mode, default tenant, scheduler, or Kingdee connection configuration is needed.

- `FENBEITONG_MODE=mock`: loads fixed local JSON.
- `FENBEITONG_MODE=real`: loads the selected company from `runtime-data/fenbeitong-tenants.sqlite`. Each company can have its own `baseUrl`, endpoint paths, `appId`, `appKey`, cached `accessToken`, token expiry, refresh interval, and list payload.
- `FENBEITONG_TENANT_KEY=puhui`: defaults the Fenbeitong tenant to Puhui. The frontend also shows `璞慧` and `瑛泰`; `瑛泰` is intentionally blocked with `接口等待开发中` until credentials and interface rules are supplied.
- Optional list filter overrides remain available through `FENBEITONG_REIMBURSEMENT_APPLY_STATE`, `FENBEITONG_REIMBURSEMENT_PAYMENT_STATE`, `FENBEITONG_REIMBURSEMENT_PAGE_INDEX`, and `FENBEITONG_REIMBURSEMENT_PAGE_SIZE`.
- `KINGDEE_MODE=mock`: blocks ERP save; it is not allowed to return a fake saved voucher.
- `KINGDEE_MODE=real`: logs in to K3Cloud with `KINGDEE_BASE_URL`, `KINGDEE_ACCT_ID`, `KINGDEE_USERNAME`, `KINGDEE_PASSWORD`, and `KINGDEE_LCID`, then posts `formid=GL_VOUCHER` and `data=<payload>` to the configured Save service with the returned session cookie. The verified working target account set is `KINGDEE_ACCT_ID=6977227150362f`; the voucher template targets accounting organization `886` and voucher group `PZZ9`. Secrets stay in local `.env` and must not be committed.
- Optional ERP login accounts are configured with `KINGDEE_ACCOUNT_*` variables. The frontend ERP account dropdown switches between the current account and the Jia Zeyu account; the backend saves only the selected account key and never returns passwords.

Fenbeitong tenant credentials are written through `PUT /api/fenbeitong-voucher/tenants/:tenantKey`. Example payload:

```json
{
  "name": "璞慧",
  "status": "ready",
  "authMode": "app-key",
  "baseUrl": "https://openapi.fenbeitong.com",
  "authPath": "/openapi/auth/getToken",
  "pullPath": "/openapi/reimbursement/v1/list",
  "detailPath": "/openapi/reimbursement/v2/detail",
  "appId": "<company-app-id>",
  "appKey": "<company-app-key>",
  "refreshIntervalSeconds": 7200,
  "listPayload": { "page_index": 1, "page_size": 20 }
}
```

## Scheduler

The scheduler is off by default and must be enabled explicitly.

- `SCHEDULER_ENABLED=false`: no background timer starts.
- `SCHEDULER_INTERVAL_SECONDS=3600`: interval used when the scheduler is enabled.
- `SCHEDULER_AUTO_PUSH_ERP=false`: default behavior only syncs Fenbeitong data. Set to `true` only after voucher mapping config is saved and ERP save behavior is verified.

Manual scheduler testing is available through the frontend button "运行一次定时同步" and `POST /api/scheduler/run-once`.

## Safety Boundaries

- No committed real Fenbeitong token, app id, or app key.
- No real Kingdee credentials.
- Real Fenbeitong sync stores detail responses, not list summaries, so voucher generation has expense lines.
- No external database connection in the teaching kit; local state is stored under `runtime-data/`.
- No Submit, Audit, posting, or approval behavior.
- Kingdee save success requires `KINGDEE_MODE=real`, a real Save response, and a follow-up View query.
