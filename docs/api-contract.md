# API Contract

Base URL in local development: `http://127.0.0.1:3001`.

## GET `/api/health`

Returns service status.

## GET `/api/ready`

Returns dependency readiness. Mock mode is ready only because it is explicitly configured; real mode fails readiness when required configuration is missing.

## GET `/api/system/status`

Returns product mode, dependency readiness, local state path, latest sync batch, dashboard counts, and scheduler state.

## GET `/api/system/config-summary`

Returns sanitized configuration only. Fenbeitong reports `credentialStore: "sqlite"`, the default tenant key, list override keys, tenant store path, and a tenant list with public fields such as `key`, `name`, `status`, `authMode`, endpoint paths, `credentialsConfigured`, token expiry, refresh interval, and display order. It never returns tokens, app keys, passwords, or authorization header values.

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

## GET `/api/fenbeitong-voucher/tenants`

Returns public Fenbeitong tenant records from SQLite. The response includes `璞慧` and `瑛泰`; secret fields are always omitted.

## PUT `/api/fenbeitong-voucher/tenants/:tenantKey`

Creates or updates one Fenbeitong tenant in SQLite. This is where company-specific `appId`, `appKey`, cached `accessToken`, token expiry, refresh interval, API paths, and list payload are stored. The response is sanitized and does not echo secrets.

```json
{
  "name": "璞慧",
  "status": "ready",
  "authMode": "app-key",
  "baseUrl": "https://openapi.fenbeitong.com",
  "authPath": "/openapi/auth/getToken",
  "pullPath": "/openapi/reimbursement/v1/list",
  "detailPath": "/openapi/reimbursement/v2/detail",
  "appId": "<company-app-id>",
  "appKey": "<company-app-key>",
  "refreshIntervalSeconds": 7200,
  "listPayload": { "page_index": 1, "page_size": 20 }
}
```

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

Runs the Fenbeitong adapter. Request body accepts optional `{ "tenantKey": "puhui" | "yingtai" }`; missing `tenantKey` defaults to `puhui`. `yingtai` fails fast with `瑛泰接口等待开发中` and never falls back to Puhui credentials. In `FENBEITONG_MODE=mock`, it loads the fixed JSON fixture. In `real` mode, the selected tenant is read from SQLite. `authMode=access-token` uses the stored access token directly; `authMode=app-key` posts the tenant `appId/appKey` as JSON to the tenant `authPath`, stores the returned token and expiry in SQLite, and reuses it until the tenant-specific refresh interval expires. The adapter then calls the tenant list endpoint and reimbursement detail endpoint for each returned item before queue persistence; missing tenant configuration or missing detail expense lines fails fast.

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
