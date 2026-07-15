import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingConfigError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
let envLoaded = false;

export function loadLocalEnv() {
  if (envLoaded) {
    return;
  }
  envLoaded = true;
  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index <= 0) {
      throw new Error(`invalid .env line: ${line}`);
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!Object.hasOwn(process.env, key)) {
      process.env[key] = value;
    }
  }
}

export function getAppConfig() {
  loadLocalEnv();
  return {
    appDataDir: process.env.APP_DATA_DIR || process.env.DATA_DIR || 'runtime-data',
    fenbeitong: {
      mode: readMode('FENBEITONG_MODE'),
      defaultTenantKey: process.env.FENBEITONG_TENANT_KEY || 'puhui',
      credentialStore: 'sqlite',
      listPayloadOverrides: buildFenbeitongListPayload()
    },
    kingdee: {
      mode: readMode('KINGDEE_MODE'),
      baseUrl: process.env.KINGDEE_BASE_URL || '',
      acctId: process.env.KINGDEE_ACCT_ID || '',
      username: process.env.KINGDEE_USERNAME || '',
      password: process.env.KINGDEE_PASSWORD || '',
      lcid: process.env.KINGDEE_LCID || '2052',
      authPath: process.env.KINGDEE_AUTH_PATH
        || 'Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc',
      savePath: process.env.KINGDEE_SAVE_PATH
        || 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc',
      viewPath: process.env.KINGDEE_VIEW_PATH
        || 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc'
    },
    scheduler: {
      enabled: readBoolean('SCHEDULER_ENABLED', false),
      intervalSeconds: readPositiveInteger('SCHEDULER_INTERVAL_SECONDS', 3600),
      autoPushErp: readBoolean('SCHEDULER_AUTO_PUSH_ERP', false)
    }
  };
}

export function validateFenbeitongConfig(tenant) {
  const config = getAppConfig().fenbeitong;
  if (config.mode === 'mock') {
    return;
  }
  const missing = [];
  if (!tenant) missing.push('FENBEITONG_TENANT');
  if (tenant && !tenant.baseUrl) missing.push('tenant.baseUrl');
  if (tenant && !tenant.pullPath) missing.push('tenant.pullPath');
  if (tenant && !tenant.detailPath) missing.push('tenant.detailPath');
  if (tenant?.authMode === 'access-token' && !tenant.accessToken) {
    missing.push('tenant.accessToken');
  }
  if (tenant?.authMode === 'app-key') {
    if (!tenant.appId) missing.push('tenant.appId');
    if (!tenant.appKey) missing.push('tenant.appKey');
    if (!tenant.authPath) missing.push('tenant.authPath');
  }
  if (missing.length > 0) {
    throw missingConfigError('Fenbeitong', missing);
  }
}

export function validateKingdeeConfig() {
  const config = getAppConfig().kingdee;
  if (config.mode === 'mock') {
    return;
  }
  const missing = [];
  if (!config.baseUrl) missing.push('KINGDEE_BASE_URL');
  if (!config.acctId) missing.push('KINGDEE_ACCT_ID');
  if (!config.username) missing.push('KINGDEE_USERNAME');
  if (!config.password) missing.push('KINGDEE_PASSWORD');
  if (!config.authPath) missing.push('KINGDEE_AUTH_PATH');
  if (!config.savePath) missing.push('KINGDEE_SAVE_PATH');
  if (!config.viewPath) missing.push('KINGDEE_VIEW_PATH');
  if (missing.length > 0) {
    throw missingConfigError('Kingdee', missing);
  }
}

export function getSanitizedConfigSummary() {
  const config = getAppConfig();
  return {
    appDataDir: config.appDataDir,
    fenbeitong: {
      mode: config.fenbeitong.mode,
      credentialStore: config.fenbeitong.credentialStore,
      defaultTenantKey: config.fenbeitong.defaultTenantKey,
      listPayloadOverrideKeys: Object.keys(config.fenbeitong.listPayloadOverrides).sort()
    },
    kingdee: {
      mode: config.kingdee.mode,
      baseUrlConfigured: Boolean(config.kingdee.baseUrl),
      acctIdConfigured: Boolean(config.kingdee.acctId),
      usernameConfigured: Boolean(config.kingdee.username),
      passwordConfigured: Boolean(config.kingdee.password),
      authPathConfigured: Boolean(config.kingdee.authPath),
      savePathConfigured: Boolean(config.kingdee.savePath),
      viewPathConfigured: Boolean(config.kingdee.viewPath)
    },
    scheduler: {
      enabled: config.scheduler.enabled,
      intervalSeconds: config.scheduler.intervalSeconds,
      autoPushErp: config.scheduler.autoPushErp
    }
  };
}

export function getRootDir() {
  return root;
}

function buildFenbeitongListPayload() {
  const payload = {};
  const pageIndex = readOptionalPositiveInteger('FENBEITONG_REIMBURSEMENT_PAGE_INDEX');
  if (pageIndex !== undefined) {
    payload.page_index = pageIndex;
  }
  const pageSize = readOptionalPositiveInteger('FENBEITONG_REIMBURSEMENT_PAGE_SIZE');
  if (pageSize !== undefined) {
    payload.page_size = pageSize;
  }
  const applyState = readOptionalInteger('FENBEITONG_REIMBURSEMENT_APPLY_STATE');
  if (applyState !== undefined) {
    payload.apply_state = applyState;
  }
  const paymentState = readOptionalInteger('FENBEITONG_REIMBURSEMENT_PAYMENT_STATE');
  if (paymentState !== undefined) {
    payload.payment_state = paymentState;
  }
  return payload;
}

function readOptionalInteger(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function readOptionalPositiveInteger(name) {
  const value = readOptionalInteger(name);
  if (value === undefined) {
    return undefined;
  }
  if (value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readMode(name) {
  const mode = (process.env[name] || 'mock').trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error(`${name} must be mock or real`);
  }
  return mode;
}

function readBoolean(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function readPositiveInteger(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
