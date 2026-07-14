import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { getAppConfig, getRootDir } from './config.js';

let currentDb = null;
let currentDbPath = '';

export function listFenbeitongTenants(options = {}) {
  const rows = getDatabase().prepare(`
    SELECT *
    FROM fenbeitong_tenants
    ORDER BY display_order ASC, tenant_key ASC
  `).all();
  return rows.map((row) => mapTenant(row, options));
}

export function getFenbeitongTenant(key, options = {}) {
  const row = getDatabase().prepare(`
    SELECT *
    FROM fenbeitong_tenants
    WHERE tenant_key = ?
  `).get(requiredText(key, 'tenantKey'));
  if (!row) {
    return null;
  }
  return mapTenant(row, options);
}

export function saveFenbeitongTenantCredentials(input) {
  const now = new Date().toISOString();
  const previous = getFenbeitongTenant(input.key, { includeSecrets: true }) || {};
  const tenant = {
    key: requiredText(input.key, 'key'),
    name: requiredText(input.name || previous.name, 'name'),
    status: input.status || previous.status || 'ready',
    authMode: input.authMode || previous.authMode || 'app-key',
    baseUrl: input.baseUrl ?? previous.baseUrl ?? 'https://openapi.fenbeitong.com',
    authPath: input.authPath ?? previous.authPath ?? '/openapi/auth/getToken',
    pullPath: input.pullPath ?? previous.pullPath ?? '/openapi/reimbursement/v1/list',
    detailPath: input.detailPath ?? previous.detailPath ?? '/openapi/reimbursement/v2/detail',
    appId: input.appId ?? previous.appId ?? '',
    appKey: input.appKey ?? previous.appKey ?? '',
    accessToken: input.accessToken ?? previous.accessToken ?? '',
    tokenExpiresAt: input.tokenExpiresAt ?? previous.tokenExpiresAt ?? '',
    refreshIntervalSeconds: positiveInteger(input.refreshIntervalSeconds ?? previous.refreshIntervalSeconds ?? 7200, 'refreshIntervalSeconds'),
    listPayloadJson: JSON.stringify(input.listPayload ?? previous.listPayload ?? { page_index: 1, page_size: 20 }),
    displayOrder: positiveInteger(input.displayOrder ?? previous.displayOrder ?? 100, 'displayOrder')
  };
  validateTenantStatus(tenant.status);
  validateAuthMode(tenant.authMode);
  getDatabase().prepare(`
    INSERT INTO fenbeitong_tenants (
      tenant_key, name, status, auth_mode, base_url, auth_path, pull_path, detail_path,
      app_id, app_key, access_token, token_expires_at, refresh_interval_seconds,
      list_payload_json, display_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_key) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      auth_mode = excluded.auth_mode,
      base_url = excluded.base_url,
      auth_path = excluded.auth_path,
      pull_path = excluded.pull_path,
      detail_path = excluded.detail_path,
      app_id = excluded.app_id,
      app_key = excluded.app_key,
      access_token = excluded.access_token,
      token_expires_at = excluded.token_expires_at,
      refresh_interval_seconds = excluded.refresh_interval_seconds,
      list_payload_json = excluded.list_payload_json,
      display_order = excluded.display_order,
      updated_at = excluded.updated_at
  `).run(
    tenant.key,
    tenant.name,
    tenant.status,
    tenant.authMode,
    tenant.baseUrl,
    tenant.authPath,
    tenant.pullPath,
    tenant.detailPath,
    tenant.appId,
    tenant.appKey,
    tenant.accessToken,
    tenant.tokenExpiresAt,
    tenant.refreshIntervalSeconds,
    tenant.listPayloadJson,
    tenant.displayOrder,
    previous.createdAt || now,
    now
  );
  return getFenbeitongTenant(tenant.key);
}

export function updateFenbeitongTenantToken(key, token) {
  getDatabase().prepare(`
    UPDATE fenbeitong_tenants
    SET access_token = ?, token_expires_at = ?, updated_at = ?
    WHERE tenant_key = ?
  `).run(
    requiredText(token.accessToken, 'accessToken'),
    requiredText(token.expiresAt, 'expiresAt'),
    new Date().toISOString(),
    requiredText(key, 'tenantKey')
  );
  return getFenbeitongTenant(key);
}

export function getTenantStorePath() {
  return resolve(getRootDir(), getAppConfig().appDataDir, 'fenbeitong-tenants.sqlite');
}

export function resetTenantStoreForTest() {
  closeCurrentDatabase();
  const dbPath = getTenantStorePath();
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
}

function getDatabase() {
  const dbPath = getTenantStorePath();
  if (currentDb && currentDbPath === dbPath) {
    return currentDb;
  }
  closeCurrentDatabase();
  mkdirSync(dirname(dbPath), { recursive: true });
  currentDb = new DatabaseSync(dbPath);
  currentDbPath = dbPath;
  currentDb.exec('PRAGMA journal_mode = WAL');
  currentDb.exec('PRAGMA foreign_keys = ON');
  migrate(currentDb);
  seedTenants(currentDb);
  return currentDb;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fenbeitong_tenants (
      tenant_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ready', 'waiting_development', 'disabled')),
      auth_mode TEXT NOT NULL CHECK(auth_mode IN ('app-key', 'access-token')),
      base_url TEXT NOT NULL,
      auth_path TEXT NOT NULL,
      pull_path TEXT NOT NULL,
      detail_path TEXT NOT NULL,
      app_id TEXT NOT NULL DEFAULT '',
      app_key TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      refresh_interval_seconds INTEGER NOT NULL DEFAULT 7200 CHECK(refresh_interval_seconds > 0),
      list_payload_json TEXT NOT NULL DEFAULT '{"page_index":1,"page_size":20}',
      display_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fenbeitong_tenants_status
      ON fenbeitong_tenants(status);
  `);
}

function seedTenants(db) {
  const now = new Date().toISOString();
  const seed = db.prepare(`
    INSERT INTO fenbeitong_tenants (
      tenant_key, name, status, auth_mode, base_url, auth_path, pull_path, detail_path,
      refresh_interval_seconds, list_payload_json, display_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_key) DO NOTHING
  `);
  seed.run(
    'puhui',
    '璞慧',
    'ready',
    'app-key',
    'https://openapi.fenbeitong.com',
    '/openapi/auth/getToken',
    '/openapi/reimbursement/v1/list',
    '/openapi/reimbursement/v2/detail',
    7200,
    JSON.stringify({ page_index: 1, page_size: 20 }),
    10,
    now,
    now
  );
  seed.run(
    'yingtai',
    '瑛泰',
    'waiting_development',
    'app-key',
    'https://openapi.fenbeitong.com',
    '/openapi/auth/getToken',
    '/openapi/reimbursement/v1/list',
    '/openapi/reimbursement/v2/detail',
    7200,
    JSON.stringify({ page_index: 1, page_size: 20 }),
    20,
    now,
    now
  );
}

function mapTenant(row, options = {}) {
  const tenant = {
    key: row.tenant_key,
    name: row.name,
    status: row.status,
    authMode: row.auth_mode,
    baseUrl: row.base_url,
    authPath: row.auth_path,
    pullPath: row.pull_path,
    detailPath: row.detail_path,
    refreshIntervalSeconds: row.refresh_interval_seconds,
    tokenExpiresAt: row.token_expires_at,
    listPayload: parseListPayload(row.list_payload_json),
    displayOrder: row.display_order,
    credentialsConfigured: row.auth_mode === 'access-token'
      ? Boolean(row.access_token)
      : Boolean(row.app_id && row.app_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (options.includeSecrets) {
    tenant.appId = row.app_id;
    tenant.appKey = row.app_key;
    tenant.accessToken = row.access_token;
  }
  return tenant;
}

function parseListPayload(text) {
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('not object');
    }
    return value;
  } catch (error) {
    throw new Error(`invalid Fenbeitong tenant list payload JSON: ${error.message}`);
  }
}

function closeCurrentDatabase() {
  if (currentDb) {
    currentDb.close();
    currentDb = null;
    currentDbPath = '';
  }
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
}

function validateTenantStatus(status) {
  if (!['ready', 'waiting_development', 'disabled'].includes(status)) {
    throw new Error('status must be ready, waiting_development, or disabled');
  }
}

function validateAuthMode(authMode) {
  if (!['app-key', 'access-token'].includes(authMode)) {
    throw new Error('authMode must be app-key or access-token');
  }
}
