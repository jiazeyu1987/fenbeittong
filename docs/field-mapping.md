# Field Mapping

## Header

| Fenbeitong | Kingdee-style payload |
|---|---|
| `data.reimb_id` | source id and idempotency key |
| `data.reimb_code` | source code |
| `voucherDate` | `Model.FDate`, `Model.FBUSDATE` |
| `year` | `Model.FYEAR` |
| `period` | `Model.FPERIOD` |
| `accountBookNumber` | `Model.FAccountBookID.FNumber` |
| `voucherGroupNumber` | `Model.FVOUCHERGROUPID.FNumber` |

## Lines

| Source | Rule |
|---|---|
| expense category code | Maps to debit account |
| invoice deductible tax | Creates tax debit line when split tax is true |
| payment amount | Creates credit line |
| currency code | Maps through `currencyNumbers` |
| user / department | Included in `FDetailID` dimensions |

## Balance Rule

The generated voucher must satisfy:

```text
sum(FDEBIT) == sum(FCREDIT)
```

