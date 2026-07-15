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
- Generate voucher button -> verifies selected rows push to ERP and become `ERP_PUSHED`.
- Save to ERP button -> verifies selected rows become `ERP_PUSHED`.
- View voucher button -> verifies the selected process record is displayed.
- Export button -> verifies a CSV download is produced.

## Test Types

- Browser E2E: Playwright Chromium through the real frontend and backend.
- API E2E: Existing workflow coverage remains in `e2e/fenbeitong-voucher-flow.test.js`.
- Contract, frontend static, backend, and build checks remain part of suite-level verification.

## Test Data And Fixtures

- Mock Fenbeitong mode generates 100 reimbursement records.
- Local repository state is reset at the start of the browser E2E test.
- Kingdee save requires real mode; mock ERP save is rejected and cannot be counted as success.
- Current Kingdee test-account smoke mapping uses debit `6111` and credit `1001.01`.

## RED Evidence

- `npm run test:frontend` previously failed when toolbar controls lacked executable IDs and behavior.
- `npm run test:e2e:ui` previously failed when toolbar and row actions stopped at local prepared records.
- Live Kingdee Save failed for `6601.*` expense accounts until the default smoke mapping was changed to the account pair accepted by the current test account set.

## GREEN Evidence

- `npm run test:backend` -> PASS, 26/26 backend tests passed.
- `npm run test:frontend` -> PASS, 10/10 frontend tests passed.
- `npm run test:contract` -> PASS, 13/13 contract tests passed.
- `npm run test:e2e:ui` -> PASS, 1/1 browser E2E test passed.
- `npm run test:e2e` -> PASS, 1/1 API E2E test passed.
- `npm run lint` -> PASS, 49 files checked.
- `npm run format` -> PASS, 49 files checked.
- `npm run build` -> PASS, `dist` created.

## Real Data E2E Evidence

- Scope: browser-driven real Fenbeitong sync plus row-level voucher generation/save through the configured Kingdee adapter.
- GREEN: Playwright clicked row `Generate Voucher` for real source `B1IELSHBX26061600003`.
- GREEN: Kingdee Save returned real FID `780438` and voucher number `627296`; follow-up View/query reached `ERP_PUSHED`.
- Evidence: `E:\ProjectPackage\fenbeitong\doc\tasks\20260715-kingdee-real-save\runtime\live-real-after-fix-20260715072042.json`.

## Blockers

- Finance-grade `6601.*` expense account mapping remains blocked until Kingdee auxiliary-dimension Save shape is confirmed for the current test account set.
- Additional Fenbeitong companies require SQLite tenant credentials before real sync.

## CI Impact And Release Recommendation

- Keep `npm run test:e2e:ui` in local verification for finance toolbar changes.
- Release recommendation is conditional on passing browser E2E, API E2E, contract, frontend, backend, lint, format, and build checks.
