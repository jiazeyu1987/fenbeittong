# QA Test Suite Evidence

## Scope

Finance toolbar browser E2E validation for the Fenbeitong reimbursement to Kingdee voucher workbench.

## Requirement-To-Test Matrix

- Sync Fenbeitong button -> `e2e-ui/toolbar-controls.test.js` verifies 100 rows appear.
- Query field, match mode, and query button -> verifies requester contains, equals, and not-equals filters change totals.
- Reset button -> verifies query field, match mode, keyword, and result count reset.
- Sortable source number and amount headers -> verifies first visible row changes after sorting.
- Display fields button -> verifies requester column can be hidden and shown.
- Row checkbox and select-all checkbox -> verifies multiple rows and all rows can be selected.
- Generate voucher button -> verifies two selected rows produce two process records.
- Save to ERP button -> verifies two selected rows become `ERP_PUSHED`.
- View voucher button -> verifies the selected process record is displayed.
- Export button -> verifies a CSV download is produced.

## Test Types

- Browser E2E: Playwright Chromium through the real frontend and backend.
- API E2E: Existing workflow coverage remains in `e2e/fenbeitong-voucher-flow.test.js`.
- Contract, frontend static, backend, and build checks remain part of suite-level verification.

## Test Data And Fixtures

- Mock Fenbeitong mode generates 100 reimbursement records.
- Local repository state is reset at the start of the browser E2E test.
- Kingdee save remains mock ERP draft save by explicit project constraint.

## RED Evidence

- `npm run test:frontend` previously failed when toolbar controls lacked executable IDs and behavior.
- New browser E2E coverage was added to prevent button-only UI regressions.

## GREEN Evidence

- `npm run test:e2e:ui` -> PASS, 1/1 browser E2E test passed.
- `npm run test:e2e` -> PASS, 1/1 API E2E test passed.
- `npm run test:frontend` -> PASS, 8/8 frontend tests passed.
- `npm run test:contract` -> PASS, 7/7 contract tests passed.
- `npm run test:backend` -> PASS, 15/15 backend tests passed.
- `npm run build` -> PASS, `dist` created.
- `npm run verify` -> PASS, full local verification chain passed with browser toolbar E2E included.

## Failed, Skipped, Flaky, Or Blocked Tests

- No skipped tests are planned.
- Real Fenbeitong token and real Kingdee GL_VOUCHER save examples remain external blockers and are not production-readiness evidence.

## CI Impact And Release Recommendation

- Add `npm run test:e2e:ui` to local verification for finance toolbar changes.
- Release recommendation is conditional on passing browser E2E, existing E2E, contract, frontend, backend, and build checks.
