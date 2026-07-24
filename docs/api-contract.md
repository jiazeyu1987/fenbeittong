# API Contract

Local base URL: `http://127.0.0.1:3001`.

The integration target is Kingdee expense reimbursement form `ER_ExpReimbursement`. It does not create or query general-ledger vouchers.

## System and configuration

- `GET /api/health` — liveness.
- `GET /api/ready` — dependency readiness.
- `GET /api/system/status` — modes, sanitized configuration, scheduler and counts.
- `GET /api/integration-settings` — saved Fenbeitong tenant, ERP account and acctID selections.
- `PUT /api/integration-settings` — validates and saves those selections.
- `GET /api/scheduler/status` — scheduler state.
- `POST /api/scheduler/run-once` — synchronizes once and optionally saves expense reimbursements when auto-save is enabled.

## Fenbeitong expense reimbursement workflow

- `GET /api/fenbeitong-expense-reimbursement/config/mock-template`
- `PUT /api/fenbeitong-expense-reimbursement/config`
- `GET /api/fenbeitong-expense-reimbursement/tenants`
- `PUT /api/fenbeitong-expense-reimbursement/tenants/:tenantKey`
- `POST /api/fenbeitong-expense-reimbursement/sync`
- `GET /api/fenbeitong-expense-reimbursement/synced-documents`
- `POST /api/fenbeitong-expense-reimbursement/preview`
- `POST /api/fenbeitong-expense-reimbursement/prepare`
- `POST /api/fenbeitong-expense-reimbursement/save-erp`
- `GET /api/fenbeitong-expense-reimbursement/process`
- `GET /api/fenbeitong-expense-reimbursement/process/:sourceId`

`preview` accepts either `fixedJson` or `sourceId`, plus `documentDate`, selected Kingdee account keys and mapping configuration. It returns `documentSummary`, `expenseEntries`, source/tax summaries, an idempotency key, content hash and the K3Cloud Save payload.

`sync` combines two source kinds through one Fenbeitong access token: `OFFLINE_REIMBURSEMENT` from reimbursement list/detail `expenses`, and `ONLINE_MONTHLY_BILL` only from the settlement-entry bill list and bill-detail APIs. Reimbursement-detail `orders` references and ordinary order list/detail APIs are not online accounting sources. The original bill number becomes `bill_no`, with `source_origin: "SETTLEMENT_POSTING"` and the bill period as `settlement_month`.

The online settlement sequence is bill list first, then bill details for every returned `bill_no`. Token-header bill endpoints use JSON and the same `access-token` header. Legacy bill endpoints are also supported when a tenant has an official `sign_key`, using the documented form-encoded signature. The enterprise-paid amount is read from the bill detail (`company_price`, with compatible aliases); rows with no enterprise-payment field are skipped. Business lines such as express and value-added service remain independent bill rows.

`save-erp` logs in to K3Cloud, switches to the organization in `FOrgID`, then posts:

```json
{
  "formid": "ER_ExpReimbursement",
  "data": "<expense-reimbursement-payload-json>"
}
```

After Save succeeds, the backend calls the configured View service with the same `ER_ExpReimbursement` FormId and validates organization, applicant employee, request department, bill type and total amount before recording `ERP_EXPENSE_REIMBURSEMENT_SAVED`.

Already-saved source records are blocked unless `forceRetry=true`. A retry updates the existing expense reimbursement through `Model.FID`; it never uses a voucher primary key.

## Logs

`GET /api/operations/logs` returns sanitized sync, prepare, save, retry, scheduler and configuration events. Secret-like fields are redacted before persistence.
