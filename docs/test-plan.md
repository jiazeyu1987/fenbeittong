# Test Plan

## Backend

- Valid source creates balanced voucher preview.
- Missing reimbursement id fails.
- Non-positive amount fails.
- Expense total mismatch fails.
- Missing mapping fails.
- Prepare creates a local record and does not call real Kingdee.

## Frontend

- Static page contains expected controls.
- API module exposes required calls.
- Empty JSON input is rejected before prepare.

## Contract

- All required endpoints exist.
- Mock template contains no access token.
- Preview response includes source id, totals, balance status, and payload.

## E2E

- Start backend.
- Start frontend.
- Load frontend HTML.
- Call mock template.
- Call preview.
- Call prepare.
- Query prepared record.

