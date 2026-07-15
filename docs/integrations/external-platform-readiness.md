# External Platform Integration Readiness

## Scope

Fenbeitong production OpenAPI and Kingdee GL_VOUCHER save integration readiness for the local voucher workbench.

## Status Matrix

| Platform | Environment | Status | Evidence |
| --- | --- | --- | --- |
| Fenbeitong OpenAPI | Production | CONFIRMED | App-key auth obtained a token and browser sync pulled 5 real detail-backed reimbursement documents with `mockReplacement=false`. |
| Kingdee GL_VOUCHER Save | Test account set | IMPLEMENTED, PENDING LIVE VERIFICATION | Adapter now uses K3Cloud `ValidateUser` session login and dynamic-form `Save` with `formid=GL_VOUCHER`; local `.env` must hold credentials and live save must still be verified by querying the saved voucher. |

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
- Row-level voucher workflow through configured ERP adapter: PASS, final API query returned `ERP_PUSHED`.
- Kingdee adapter unit verification: PASS, `npm run test:backend` covers K3Cloud login, session cookie reuse, and GL_VOUCHER Save form submission.
- Full live Kingdee write: PENDING, because a saved GL_VOUCHER must still be queried back from the test account set after local credentials are enabled.

## Blockers And Launch Impact

- Production or test-account Kingdee save cannot be claimed complete until `KINGDEE_MODE=real`, required K3Cloud login configuration is supplied locally, and a saved GL_VOUCHER is queried back from Kingdee.
