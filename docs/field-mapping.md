# Field Mapping

## Header

| Fenbeitong | Kingdee-style payload |
|---|---|
| `data.reimb_id` | source id and idempotency key |
| `data.reimb_code` | source code |
| `voucherDate` | `Model.Date`, `Model.BUSDATE` |
| `year` | `Model.YEAR` |
| `period` | `Model.PERIOD` |
| `accountBookNumber` | `Model.AccountBookID.Number` |
| `voucherGroupNumber` | `Model.VOUCHERGROUPID.Number` |

## Lines

| Source | Rule |
|---|---|
| expense category code | Maps to debit account; current test-account smoke mapping uses `6111` because `6601.*` requires unresolved auxiliary dimensions through OpenAPI |
| invoice deductible tax | Creates tax debit line when split tax is true |
| payment amount | Creates credit line |
| currency code | Maps through `currencyNumbers` |
| user / department | Optional `FDetailID` dimensions; disabled in the default smoke mapping until the ERP auxiliary-dimension save shape is confirmed |

## Balance Rule

The generated voucher must satisfy:

```text
sum(FDEBIT) == sum(FCREDIT)
```
