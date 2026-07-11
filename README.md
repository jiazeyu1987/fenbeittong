# Fenbeitong Kingdee Voucher Collaboration Kit

This is a standalone teaching and collaboration project for developing the Fenbeitong-to-Kingdee voucher workflow without sharing the full `IntRuoyi` codebase.

## What This Project Does

- Loads fixed mock Fenbeitong reimbursement JSON.
- Converts it into a Kingdee-style voucher draft payload.
- Lets a student preview and prepare local voucher records.
- Provides backend, frontend, contract tests, and E2E smoke tests.
- Uses only mock data and local files. It never calls real Fenbeitong or real Kingdee.

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

## Safety Boundaries

- No real Fenbeitong token.
- No real Kingdee credentials.
- No real database connection.
- No Submit, Audit, posting, or approval behavior.
- Mock Kingdee save is only a local simulation and is not evidence of real ERP save success.

