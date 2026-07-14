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
    if (!process.env[key]) {
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
      authMode: readFenbeitongAuthMode(),
      baseUrl: process.env.FENBEITONG_BASE_URL || '',
      accessToken: process.env.FENBEITONG_ACCESS_TOKEN || '',
      appId: process.env.FENBEITONG_APP_ID || '',
      appKey: process.env.FENBEITONG_APP_KEY || '',
      authPath: process.env.FENBEITONG_AUTH_PATH || '/openapi/auth/getToken',
      pullPath: process.env.FENBEITONG_PULL_PATH || '/openapi/reimbursement/v1/list',
      detailPath: process.env.FENBEITONG_DETAIL_PATH || '/openapi/reimbursement/v2/detail',
      listPayload: buildFenbeitongListPayload()
    },
    kingdee: {
      mode: readMode('KINGDEE_MODE'),
      saveUrl: process.env.KINGDEE_SAVE_URL || '',
      authHeaderName: process.env.KINGDEE_AUTH_HEADER_NAME || '',
      authHeaderValue: process.env.KINGDEE_AUTH_HEADER_VALUE || ''
    },
    scheduler: {
      enabled: readBoolean('SCHEDULER_ENABLED', false),
      intervalSeconds: readPositiveInteger('SCHEDULER_INTERVAL_SECONDS', 3600),
      autoPushErp: readBoolean('SCHEDULER_AUTO_PUSH_ERP', false)
    }
  };
}

export function validateFenbeitongConfig() {
  const config = getAppConfig().fenbeitong;
  if (config.mode === 'mock') {
    return;
  }
  const missing = [];
  if (!config.baseUrl) missing.push('FENBEITONG_BASE_URL');
  if (config.authMode === 'access-token' && !config.accessToken) {
    missing.push('FENBEITONG_ACCESS_TOKEN');
  }
  if (config.authMode === 'app-key') {
    if (!config.appId) missing.push('FENBEITONG_APP_ID');
    if (!config.appKey) missing.push('FENBEITONG_APP_KEY');
  }
  if (!config.pullPath) missing.push('FENBEITONG_PULL_PATH');
  if (!config.detailPath) missing.push('FENBEITONG_DETAIL_PATH');
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
  if (!config.saveUrl) missing.push('KINGDEE_SAVE_URL');
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
      authMode: config.fenbeitong.authMode,
      baseUrlConfigured: Boolean(config.fenbeitong.baseUrl),
      accessTokenConfigured: Boolean(config.fenbeitong.accessToken),
      appIdConfigured: Boolean(config.fenbeitong.appId),
      appKeyConfigured: Boolean(config.fenbeitong.appKey),
      authPathConfigured: Boolean(config.fenbeitong.authPath),
      pullPathConfigured: Boolean(config.fenbeitong.pullPath),
      detailPathConfigured: Boolean(config.fenbeitong.detailPath),
      listPayloadKeys: Object.keys(config.fenbeitong.listPayload).sort()
    },
    kingdee: {
      mode: config.kingdee.mode,
      saveUrlConfigured: Boolean(config.kingdee.saveUrl),
      authHeaderConfigured: Boolean(config.kingdee.authHeaderName && config.kingdee.authHeaderValue)
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
  const payload = {
    page_index: readPositiveInteger('FENBEITONG_REIMBURSEMENT_PAGE_INDEX', 1),
    page_size: readPositiveInteger('FENBEITONG_REIMBURSEMENT_PAGE_SIZE', 20)
  };
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

function readMode(name) {
  const mode = (process.env[name] || 'mock').trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error(`${name} must be mock or real`);
  }
  return mode;
}

function readFenbeitongAuthMode() {
  const mode = (process.env.FENBEITONG_AUTH_MODE || 'access-token').trim().toLowerCase();
  if (mode !== 'access-token' && mode !== 'app-key') {
    throw new Error('FENBEITONG_AUTH_MODE must be access-token or app-key');
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
