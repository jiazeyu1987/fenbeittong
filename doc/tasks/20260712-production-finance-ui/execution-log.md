# Execution Log

BDD: Batch mock reimbursement sync -> Given Fenbeitong access token is not available and mock mode is enabled When finance syncs Fenbeitong documents Then the system returns 100 voucher-mappable reimbursement documents.

BDD: Sort finance source ledger -> Given the source ledger contains multiple reimbursement documents When finance clicks source number, amount, or update time headers Then the visible ledger toggles sorting by that field.

BDD: Multi-select source documents -> Given the source ledger contains multiple reimbursement documents When finance checks row boxes or the header checkbox Then the system preserves multiple selected rows for batch actions.

RED: `npm run test:contract` -> FAIL, mock Fenbeitong pull returned 1 document instead of 100.

RED: `npm run test:frontend` -> FAIL, the page had no select-all checkbox and no sortable column controls.

GREEN: `npm run test:e2e` -> PASS, 1/1 tests passed.

GREEN: `npm run test:contract` -> PASS, 7/7 tests passed.

GREEN: `npm run test:frontend` -> PASS, 8/8 tests passed.

GREEN: `npm run test:backend` -> PASS, 15/15 tests passed.

GREEN: `npm run build` -> PASS, dist created.
