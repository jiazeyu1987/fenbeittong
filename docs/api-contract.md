# API Contract

Base URL in local development: `http://127.0.0.1:3001`.

## GET `/api/health`

Returns service status.

## GET `/api/fenbeitong-voucher/config/mock-template`

Returns a non-secret mock configuration and fixed source JSON.

## PUT `/api/fenbeitong-voucher/config`

Stores local mock configuration in memory.

## POST `/api/fenbeitong-voucher/preview`

Request:

```json
{
  "fixedJson": "{}",
  "voucherDate": "2026-07-11",
  "year": 2026,
  "period": 7,
  "config": {}
}
```

Response includes `sourceId`, `debitTotal`, `creditTotal`, `balanced`, and `payload`.

## POST `/api/fenbeitong-voucher/prepare`

Creates a local prepared process record. This does not call real Kingdee.

## GET `/api/fenbeitong-voucher/process/:sourceId`

Returns a local process record.

## POST `/api/mock/fenbeitong/reimbursements/pull`

Returns the fixed mock reimbursement detail.

## POST `/api/mock/kingdee/voucher/save`

Local simulation only. It must never be treated as real ERP success.

