# Frontend Feature Evidence

## Feature Goal

Finance users can work from a full-screen reimbursement ledger with mock data until external Fenbeitong and Kingdee credentials/examples are available.

## Acceptance

- The mock Fenbeitong pull produces 100 reimbursement documents.
- The ledger has checkbox row selection and header select-all.
- The ledger can sort by source number, amount, and update time.
- Existing preview, prepare, ERP push, query, and export paths remain available.

## Non-Goals

- No new real Fenbeitong API integration without the pending access token.
- No forced Kingdee GL_VOUCHER save example while the ERP sample remains unresolved.

## Owned Files

- `frontend/src/index.html`
- `frontend/src/app.js`
- `frontend/src/styles.css`
- `frontend/tests/static-page.test.js`
- `backend/src/adapters/fenbeitong-client.js`
- `tests/contract/api-contract.test.js`
- `e2e/fenbeitong-voucher-flow.test.js`

## API Contracts And Data States

- `pullFenbeitongReimbursements()` in mock mode returns 100 documents.
- Each mock document has unique `reimb_id`, `reimb_code`, amount, and timestamp values.
- Existing preview, prepare, push, process, and synced-documents endpoints are unchanged.

## BDD Scenarios

BDD: Batch mock reimbursement sync -> Given Fenbeitong access token is not available and mock mode is enabled When finance syncs Fenbeitong documents Then the system returns 100 voucher-mappable reimbursement documents.

BDD: Sort finance source ledger -> Given the source ledger contains multiple reimbursement documents When finance clicks source number, amount, or update time headers Then the visible ledger toggles sorting by that field.

BDD: Multi-select source documents -> Given the source ledger contains multiple reimbursement documents When finance checks row boxes or the header checkbox Then the system preserves multiple selected rows for batch actions.

## Verification

RED: `npm run test:contract` -> FAIL, mock Fenbeitong pull returned 1 document instead of 100.

RED: `npm run test:frontend` -> FAIL, the page had no select-all checkbox and no sortable column controls.

GREEN: `npm run test:e2e` -> PASS, 1/1 tests passed.

GREEN: `npm run test:contract` -> PASS, 7/7 tests passed.

GREEN: `npm run test:frontend` -> PASS, 8/8 tests passed.

GREEN: `npm run test:backend` -> PASS, 15/15 tests passed.

GREEN: `npm run build` -> PASS, dist created.

- Empty state remains in the ledger table.
- Error handling continues through existing `run()` and API error paths.
- Accessibility: row and header checkboxes include `aria-label`; sort controls are buttons.

## Blockers

- Real Fenbeitong access token is still pending.
- Kingdee GL_VOUCHER save sample remains externally unresolved.
