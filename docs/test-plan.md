# Test Plan

- Validate FormId, required header fields and `FEntity` fields.
- Validate employee/department/expense-item mappings and tax/location extraction.
- Assert Save and View both use `ER_ExpReimbursement`.
- Assert payload has no general-ledger voucher fields.
- Verify duplicate blocking and FID-based retry update.
- Verify frontend labels, preview, single/batch save, filtering, pagination and export.
- Run `npm run verify` before delivery.
