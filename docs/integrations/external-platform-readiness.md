# External Platform Integration Readiness

## Scope

Fenbeitong production OpenAPI and Kingdee `ER_ExpReimbursement` save integration readiness.

## Status Matrix

| Platform | Environment | Status | Evidence |
| --- | --- | --- | --- |
| Fenbeitong OpenAPI | Production | CONFIRMED | App-key auth obtained a token and browser sync pulled 5 real detail-backed reimbursement documents with `mockReplacement=false`. |
| Kingdee expense reimbursement Save | Test account set | IMPLEMENTED, PENDING LIVE WRITE VERIFICATION | Adapter uses K3Cloud `ValidateUser`, dynamic-form `Save` and `View` with `formid=ER_ExpReimbursement`; local `.env` must hold credentials. |

## Credentials And Secrets

- Fenbeitong company credentials are stored in the local SQLite tenant store under `runtime-data/`; no token, app key, password, or auth header value is recorded in this document.
- Kingdee real write credentials belong in the ignored local `.env` file; no account id, password, cookie, token, or full credential payload is recorded in this document.

## Domains

- Fenbeitong production API domain: `https://openapi.fenbeitong.com`.
- Local frontend verification URL: `http://127.0.0.1:5173/`.
- Local backend verification URL: `http://127.0.0.1:3001`.
- Kingdee K3Cloud base URL: configured locally through `KINGDEE_BASE_URL` when real mode is enabled.

## Approval

- Fenbeitong production app-key access: CONFIRMED for token, list, and detail pull in this local environment.
- Kingdee test-account write approval: user indicated the test account can be written to, but the local workbench is not configured for real Kingdee Save in this E2E run.

## Verification

- Fenbeitong real browser E2E: PASS, evidence in `E:\ProjectPackage\fenbeitong\doc\tasks\20260714-real-data-e2e-validation\runtime\real-data-e2e-api-verification-1784017369173.json`.
- Row-level expense reimbursement workflow through configured ERP adapter: PASS, final local state returned `ERP_EXPENSE_REIMBURSEMENT_SAVED`.
- Kingdee adapter unit verification: PASS, `npm run test:backend` covers login, session reuse, expense reimbursement Save and View verification.
- Full live Kingdee write: PENDING explicit authorization for a real expense reimbursement write.

## Blockers And Launch Impact

- Production or test-account Kingdee save cannot be claimed complete until an authorized `ER_ExpReimbursement` is saved and verified in the target organization.
