# Task: Production Finance UI - Batch Mock Ledger Selection

## Goal

Make the finance ledger usable before external tokens/examples are ready: sync about 100 mock Fenbeitong reimbursement documents, sort by time/amount/source number, and select multiple rows with checkboxes.

## Milestones

- [x] Add BDD/TDD coverage for mock data volume, sort controls, and multi-select checkbox controls.
- [x] Expand Fenbeitong mock pull data to 100 voucher-mappable reimbursement documents.
- [x] Replace the row select button with checkbox selection and support selecting multiple rows.
- [x] Add sortable source number, amount, and time columns.
- [x] Update E2E flow for the larger mock data set.
- [x] Add browser E2E verification for each finance toolbar button.
- [x] Run backend, frontend, contract, E2E, and build verification.

## Expected Verification

- `npm run test:e2e`
- `npm run test:e2e:ui`
- `npm run test:contract`
- `npm run test:frontend`
- `npm run test:backend`
- `npm run build`

## Current Status

completed
