import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingConfigError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const DEFAULT_KINGDEE_ACCOUNT_KEY = 'current';
export const DEFAULT_KINGDEE_ACCT_ID_KEY = 'puhui-6977227150362f';
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
  const kingdee = buildKingdeeConfig();
  return {
    appDataDir: process.env.APP_DATA_DIR || process.env.DATA_DIR || 'runtime-data',
    fenbeitong: {
      mode: readMode('FENBEITONG_MODE'),
      defaultTenantKey: process.env.FENBEITONG_TENANT_KEY || 'puhui',
      credentialStore: 'sqlite',
      listPayloadOverrides: buildFenbeitongListPayload()
    },
    kingdee,
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

export function validateKingdeeConfig(accountKey, acctIdKey) {
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode === 'mock') {
    return;
  }
  const missing = [];
  if (!config.baseUrl) missing.push('KINGDEE_BASE_URL');
  if (!config.acctId) missing.push('KINGDEE_ACCOUNT.acctId');
  if (!config.username) missing.push('KINGDEE_ACCOUNT.username');
  if (!config.password) missing.push('KINGDEE_ACCOUNT.password');
  if (!config.authPath) missing.push('KINGDEE_AUTH_PATH');
  if (!config.savePath) missing.push('KINGDEE_SAVE_PATH');
  if (!config.viewPath) missing.push('KINGDEE_VIEW_PATH');
  if (missing.length > 0) {
    throw missingConfigError('Kingdee', missing);
  }
}

export function getEffectiveKingdeeConfig(accountKey, acctIdKey) {
  const config = getAppConfig().kingdee;
  if (config.mode === 'mock') {
    return config;
  }
  const selectedAccount = resolveKingdeeAccount(config, accountKey || config.selectedAccountKey);
  const selectedAcctId = resolveKingdeeAcctId(config, acctIdKey || config.selectedAcctIdKey);
  return {
    ...config,
    accountKey: selectedAccount.key,
    accountLabel: selectedAccount.label,
    acctIdKey: selectedAcctId.key,
    acctIdLabel: selectedAcctId.label,
    acctId: selectedAcctId.acctId,
    username: selectedAccount.username,
    password: selectedAccount.password
  };
}

export function resolveKingdeeAccount(config, accountKey) {
  const key = (accountKey || config.selectedAccountKey || DEFAULT_KINGDEE_ACCOUNT_KEY).trim();
  const account = config.accounts.find((item) => item.key === key);
  if (!account) {
    throw new Error(`Kingdee ERP account ${key} is not configured`);
  }
  return account;
}

export function resolveKingdeeAcctId(config, acctIdKey) {
  const key = (acctIdKey || config.selectedAcctIdKey || DEFAULT_KINGDEE_ACCT_ID_KEY).trim();
  const acctId = config.acctIds.find((item) => item.key === key);
  if (!acctId) {
    throw new Error(`Kingdee acctID ${key} is not configured`);
  }
  return acctId;
}

export function sanitizeKingdeeAccount(account) {
  return {
    key: account.key,
    label: account.label,
    usernameConfigured: Boolean(account.username),
    passwordConfigured: Boolean(account.password),
    configured: Boolean(account.username && account.password)
  };
}

export function sanitizeKingdeeAcctId(acctId) {
  return {
    key: acctId.key,
    label: acctId.label,
    acctIdConfigured: Boolean(acctId.acctId),
    configured: Boolean(acctId.acctId)
  };
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
      selectedAccountKey: config.kingdee.selectedAccountKey,
      selectedAcctIdKey: config.kingdee.selectedAcctIdKey,
      accounts: config.kingdee.accounts.map(sanitizeKingdeeAccount),
      acctIds: config.kingdee.acctIds.map(sanitizeKingdeeAcctId),
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

function buildKingdeeConfig() {
  const kingdee = {
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
  };
  kingdee.selectedAccountKey = process.env.KINGDEE_ACCOUNT_KEY || DEFAULT_KINGDEE_ACCOUNT_KEY;
  kingdee.selectedAcctIdKey = process.env.KINGDEE_ACCT_ID_KEY || DEFAULT_KINGDEE_ACCT_ID_KEY;
  kingdee.accounts = buildKingdeeAccounts(kingdee);
  kingdee.acctIds = buildKingdeeAcctIds(kingdee);
  return kingdee;
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

function buildKingdeeAccounts(kingdee) {
  const accounts = [
    {
      key: DEFAULT_KINGDEE_ACCOUNT_KEY,
      label: process.env.KINGDEE_ACCOUNT_CURRENT_LABEL || 'int',
      username: kingdee.username,
      password: kingdee.password
    }
  ];
  const jiaZeyuEnabled = readOptionalBoolean('KINGDEE_ACCOUNT_JIAZEYU_ENABLED')
    || Boolean(
      process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID
      || process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME
      || process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD
    );
  if (jiaZeyuEnabled) {
    accounts.push({
      key: 'jia-zeyu',
      label: process.env.KINGDEE_ACCOUNT_JIAZEYU_LABEL || '\u8d3e\u6cfd\u5b87',
      username: process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME || '',
      password: process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD || ''
    });
  }
  return accounts;
}

function buildKingdeeAcctIds(kingdee) {
  const acctIds = [
    {
      key: process.env.KINGDEE_ACCT_ID_KEY || DEFAULT_KINGDEE_ACCT_ID_KEY,
      label: process.env.KINGDEE_ACCT_ID_LABEL || DEFAULT_KINGDEE_ACCT_ID_KEY,
      acctId: kingdee.acctId
    }
  ];
  const legacyJiaAcctId = process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID || '';
  if (legacyJiaAcctId && legacyJiaAcctId !== kingdee.acctId) {
    acctIds.push({
      key: process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID_KEY || `jia-zeyu-${legacyJiaAcctId}`,
      label: process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID_LABEL || `Jia Zeyu ${legacyJiaAcctId}`,
      acctId: legacyJiaAcctId
    });
  }
  return uniqueByKey(acctIds);
}

function uniqueByKey(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.key)) {
      return false;
    }
    seen.add(item.key);
    return true;
  });
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

function readOptionalBoolean(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return false;
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
