# External Platform Integration Readiness

## Scope

Fenbeitong production OpenAPI and Kingdee GL_VOUCHER save integration readiness for the local voucher workbench.

## Status Matrix

| Platform | Environment | Status | Evidence |
| --- | --- | --- | --- |
| Fenbeitong OpenAPI | Production | CONFIRMED | App-key auth obtained a token and browser sync pulled 5 real detail-backed reimbursement documents with `mockReplacement=false`. |
| Kingdee GL_VOUCHER Save | Test account set | BLOCKED | Local config is still `KINGDEE_MODE=mock`; `KINGDEE_SAVE_URL` and auth header are not configured. |

## Credentials And Secrets

- Fenbeitong credentials are present only in local `.env`; no token, app key, password, or auth header value is recorded in this document.
- Kingdee real write credentials are not configured in the local workbench.

## Domains

- Fenbeitong production API domain: `https://openapi.fenbeitong.com`.
- Local frontend verification URL: `http://127.0.0.1:5173/`.
- Local backend verification URL: `http://127.0.0.1:3001`.
- Kingdee real save URL: MISSING in local config.

## Approval

- Fenbeitong production app-key access: CONFIRMED for token, list, and detail pull in this local environment.
- Kingdee test-account write approval: user indicated the test account can be written to, but the local workbench is not configured for real Kingdee Save in this E2E run.

## Verification

- Fenbeitong real browser E2E: PASS, evidence in `E:\ProjectPackage\fenbeitong\doc\tasks\20260714-real-data-e2e-validation\runtime\real-data-e2e-api-verification-1784017369173.json`.
- Row-level voucher workflow through configured ERP adapter: PASS, final API query returned `ERP_PUSHED`.
- Full real Kingdee write: NOT VERIFIED, because the configured ERP adapter is mock.

## Blockers And Launch Impact

- Production or test-account Kingdee save cannot be claimed until `KINGDEE_MODE=real`, `KINGDEE_SAVE_URL`, and required auth/session configuration are supplied and a saved GL_VOUCHER is queried back from Kingdee.
