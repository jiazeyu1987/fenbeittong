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
      baseUrl: process.env.FENBEITONG_BASE_URL || '',
      accessToken: process.env.FENBEITONG_ACCESS_TOKEN || '',
      pullPath: process.env.FENBEITONG_PULL_PATH || '/reimbursements/pull'
    },
    kingdee: {
      mode: readMode('KINGDEE_MODE'),
      saveUrl: process.env.KINGDEE_SAVE_URL || '',
      authHeaderName: process.env.KINGDEE_AUTH_HEADER_NAME || '',
      authHeaderValue: process.env.KINGDEE_AUTH_HEADER_VALUE || ''
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
  if (!config.accessToken) missing.push('FENBEITONG_ACCESS_TOKEN');
  if (!config.pullPath) missing.push('FENBEITONG_PULL_PATH');
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
      baseUrlConfigured: Boolean(config.fenbeitong.baseUrl),
      accessTokenConfigured: Boolean(config.fenbeitong.accessToken),
      pullPathConfigured: Boolean(config.fenbeitong.pullPath)
    },
    kingdee: {
      mode: config.kingdee.mode,
      saveUrlConfigured: Boolean(config.kingdee.saveUrl),
      authHeaderConfigured: Boolean(config.kingdee.authHeaderName && config.kingdee.authHeaderValue)
    }
  };
}

export function getRootDir() {
  return root;
}

function readMode(name) {
  const mode = (process.env[name] || 'mock').trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'real') {
    throw new Error(`${name} must be mock or real`);
  }
  return mode;
}
