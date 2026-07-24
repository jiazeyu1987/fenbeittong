# Fenbeitong → Kingdee Expense Reimbursement

This branch synchronizes both Fenbeitong offline reimbursements and online monthly enterprise-bill rows, then saves them directly to Kingdee's **费用报销单列表**.

Target contract:

- FormId: `ER_ExpReimbursement`
- Organization: `886`
- Bill type: `FYBXD001_SYS`
- Applicant/contact unit: mapped Kingdee employee
- Request/expense department: mapped Kingdee department
- Detail entity: `FEntity`, one row per offline expense or online bill-order row
- Transport subcategories `CI00801/02/04/05` map to Kingdee expense item `CI008`
- Offline tax/excluding-tax values come from split fields; online values come only from the bill's reference deductible/non-deductible fields
- Blank cells in the approved mapping stay blank; the integration does not insert “未提供” placeholders or calculate missing online tax fields

The workflow does not create `GL_VOUCHER` documents and does not query vouchers. After saving, it reads the returned `ER_ExpReimbursement` document only to verify the save target.

## Run

```powershell
npm run dev:backend
npm run dev:frontend
```

Open `http://127.0.0.1:5173`.

## Verify

```powershell
npm run verify
```

Real ERP save requires local Kingdee credentials and `KINGDEE_MODE=real`. Credentials remain in `.env` and must not be committed.

Fenbeitong offline reimbursements and online settlement bills use the same tenant App ID, App Key, and access token. Online rows are pulled only through the settlement-entry bill list and bill-detail APIs. Reimbursement-linked orders and ordinary travel-order list/detail APIs are never used as online accounting data. The original Fenbeitong `bill_no` is retained unchanged, and only detail rows that actually contain an enterprise-payment amount are synchronized.

See [docs/api-contract.md](docs/api-contract.md) for endpoints and payload behavior.
