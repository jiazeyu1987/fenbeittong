# Fenbeitong Kingdee Voucher Collaboration Kit

This is a standalone teaching and collaboration project for developing the Fenbeitong-to-Kingdee voucher workflow without sharing the full `IntRuoyi` codebase.

## What This Project Does

- Runs the formal workflow: sync Fenbeitong, transform data, preview voucher payload, prepare local records, and push to ERP.
- Keeps mock behavior isolated behind Fenbeitong and Kingdee adapters.
- Persists local state to `runtime-data/state.json`.
- Shows dependency readiness, dashboard counts, process records, and operation logs.
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
- `FENBEITONG_MODE=real`: requires `FENBEITONG_BASE_URL`, `FENBEITONG_ACCESS_TOKEN`, and `FENBEITONG_PULL_PATH`.
- `KINGDEE_MODE=mock`: simulates ERP save response.
- `KINGDEE_MODE=real`: requires `KINGDEE_SAVE_URL` and optional auth header values.

## Safety Boundaries

- No real Fenbeitong token.
- No real Kingdee credentials.
- No external database connection in the teaching kit; local state is stored under `runtime-data/`.
- No Submit, Audit, posting, or approval behavior.
- Mock Kingdee save is only a local simulation and is not evidence of real ERP save success.
