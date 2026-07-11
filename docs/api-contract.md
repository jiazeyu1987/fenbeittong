# API Contract

Base URL in local development: `http://127.0.0.1:3001`.

## GET `/api/health`

Returns service status.

## GET `/api/ready`

Returns dependency readiness. Mock mode is ready only because it is explicitly configured; real mode fails readiness when required configuration is missing.

## GET `/api/system/status`

Returns product mode, dependency readiness, local state path, latest sync batch, dashboard counts, and scheduler state.

## GET `/api/system/config-summary`

Returns sanitized configuration booleans only. It never returns tokens, passwords, or authorization header values.

## GET `/api/scheduler/status`

Returns scheduler status:

```json
{
  "enabled": false,
  "intervalSeconds": 3600,
  "autoPushErp": false,
  "running": false,
  "lastRunAt": "",
  "lastSuccessAt": "",
  "lastErrorAt": "",
  "lastError": "",
  "lastBatchId": "",
  "runCount": 0
}
```

## POST `/api/scheduler/run-once`

Runs one scheduler cycle immediately. This uses the configured Fenbeitong adapter. When `SCHEDULER_AUTO_PUSH_ERP=false`, it only syncs source documents. When `SCHEDULER_AUTO_PUSH_ERP=true`, it also pushes synced records to Kingdee and fails fast if voucher mapping config is missing.

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

## POST `/api/fenbeitong-voucher/sync`

Runs the Fenbeitong adapter. In `FENBEITONG_MODE=mock`, it loads the fixed JSON fixture. In `real` mode, missing real interface configuration fails fast.

## GET `/api/fenbeitong-voucher/synced-documents`

Returns the local queue of synced Fenbeitong source documents. Records include source id, source code, source mode, mock replacement marker, batch id, process stage, fixed JSON and timestamps. This endpoint is used by the frontend queue before voucher preview.

## POST `/api/fenbeitong-voucher/push-erp`

Runs the Kingdee adapter. In `KINGDEE_MODE=mock`, it simulates a saved draft voucher. In `real` mode, missing real interface configuration fails fast.

## GET `/api/fenbeitong-voucher/process`

Returns all local voucher process records.

## GET `/api/fenbeitong-voucher/process/:sourceId`

Returns a local process record.

## GET `/api/operations/logs`

Returns local operation logs for sync, prepare, push, scheduler, and config actions.
