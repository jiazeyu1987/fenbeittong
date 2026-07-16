# API Contract

Base URL in local development: `http://127.0.0.1:3001`.

## GET `/api/health`

Returns service status.

## GET `/api/ready`

Returns dependency readiness. Mock mode is ready only because it is explicitly configured; real mode fails readiness when required configuration is missing.

## GET `/api/system/status`

Returns product mode, dependency readiness, local state path, latest sync batch, dashboard counts, scheduler state, sanitized configuration, and saved `integrationSelection`.

## GET `/api/system/config-summary`

Returns sanitized configuration only. Fenbeitong reports `credentialStore: "sqlite"`, the default tenant key, list override keys, tenant store path, saved integration selection, and tenant public fields. It never returns tokens, app keys, passwords, cookies, or authorization header values.

Kingdee account summaries include only `key`, `label`, and boolean configured flags. Kingdee acctID summaries include only `key`, `label`, and configured flags. Usernames, passwords, and raw acctID values are never returned.

## GET `/api/integration-settings`

Returns the saved dropdown selection and sanitized options for all three selectors:

```json
{
  "selection": {
    "tenantKey": "puhui",
    "kingdeeAccountKey": "current",
    "kingdeeAcctIdKey": "puhui-6977227150362f",
    "updatedAt": ""
  },
  "tenants": [],
  "kingdeeAccounts": [],
  "kingdeeAcctIds": []
}
```

## PUT `/api/integration-settings`

Persists the selected Fenbeitong company, ERP login account, and Kingdee acctID key in `runtime-data/state.json`. Unknown tenant, account, or acctID keys fail fast and do not modify the previous saved selection.

```json
{
  "tenantKey": "puhui",
  "kingdeeAccountKey": "current",
  "kingdeeAcctIdKey": "puhui-6977227150362f"
}
```

## GET `/api/kingdee/accounts`

Returns the current ERP account selection and sanitized account list used by legacy clients.

## PUT `/api/kingdee/account-selection`

Stores the selected ERP account key through the unified integration selection state for backward compatibility. New frontend code uses `/api/integration-settings`. Unknown account keys fail fast and do not fall back to another account.

```json
{ "accountKey": "jia-zeyu" }
```

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

Runs one scheduler cycle immediately. When `SCHEDULER_AUTO_PUSH_ERP=false`, it only syncs source documents. When `SCHEDULER_AUTO_PUSH_ERP=true`, it also pushes synced records to Kingdee and fails fast if voucher mapping config is missing.

## GET `/api/fenbeitong-voucher/config/mock-template`

Returns a non-secret mock configuration and fixed source JSON.

## GET `/api/fenbeitong-voucher/tenants`

Returns public Fenbeitong tenant records from SQLite. Secret fields are always omitted.

## PUT `/api/fenbeitong-voucher/tenants/:tenantKey`

Creates or updates one Fenbeitong tenant in SQLite. This is where company-specific `appId`, `appKey`, cached `accessToken`, token expiry, refresh interval, API paths, and list payload are stored. The response is sanitized and does not echo secrets.

## PUT `/api/fenbeitong-voucher/config`

Stores local voucher mapping configuration.

## POST `/api/fenbeitong-voucher/preview`

Builds a GL_VOUCHER payload from fixed JSON or a synced source record. Response includes `sourceId`, `debitTotal`, `creditTotal`, `balanced`, voucher lines, source summary, and `payload`.

## POST `/api/fenbeitong-voucher/prepare`

Creates a local prepared process record. This does not call Kingdee.

## POST `/api/fenbeitong-voucher/sync`

Runs the Fenbeitong adapter. Request body accepts optional `{ "tenantKey": "puhui" | "yingtai" }`; missing `tenantKey` uses the saved `integrationSelection.tenantKey`. `yingtai` fails fast with waiting-development behavior and never falls back to Puhui credentials.

In `FENBEITONG_MODE=mock`, it loads the fixed JSON fixture. In `real` mode, the selected tenant is read from SQLite. `authMode=access-token` uses the stored access token directly; `authMode=app-key` posts tenant `appId/appKey` as JSON to the tenant `authPath`, stores the returned token and expiry in SQLite, and reuses it until the tenant-specific refresh interval expires.

## GET `/api/fenbeitong-voucher/synced-documents`

Returns the local queue of synced Fenbeitong source documents. Records include source id, source code, source mode, mock replacement marker, batch id, process stage, fixed JSON and timestamps.

## POST `/api/fenbeitong-voucher/push-erp`

Runs the Kingdee adapter. In `KINGDEE_MODE=mock`, ERP save fails fast and does not simulate a saved voucher. In `real` mode, missing real interface configuration fails fast.

Real Kingdee mode uses K3Cloud WebAPI session login. The backend posts `acctID`, `username`, `password`, and `lcid` to `KINGDEE_AUTH_PATH`, extracts the returned `Set-Cookie`, and then posts a JSON wrapper `{ "formid": "GL_VOUCHER", "data": "<payload-json>" }` to `KINGDEE_SAVE_PATH`. After Save succeeds, the backend calls `KINGDEE_VIEW_PATH` for the returned id before marking the local process as `ERP_PUSHED`.

Request bodies may include `kingdeeAccountKey` and `kingdeeAcctIdKey`. When either is omitted, the backend uses the saved integration selection. `kingdeeAccountKey` selects only username/password; `kingdeeAcctIdKey` selects only the Kingdee data-center acctID. Duplicate pushes for an already saved source id are rejected before any Kingdee login call.

## GET `/api/fenbeitong-voucher/process`

Returns all local voucher process records.

## GET `/api/fenbeitong-voucher/process/:sourceId`

Returns a local process record.

## GET `/api/operations/logs`

Returns local operation logs for sync, prepare, push, scheduler, and configuration actions. Secret-like fields are redacted before persistence.
