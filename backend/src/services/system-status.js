import { getAppConfig, getSanitizedConfigSummary } from '../config.js';
import { getDashboardSummary } from '../repository.js';
import { getFenbeitongTenant, getTenantStorePath, listFenbeitongTenants } from '../tenant-store.js';
import { getSchedulerStatus } from './scheduler.js';

export function getSystemStatus() {
  const config = getAppConfig();
  const defaultTenant = getFenbeitongTenant(config.fenbeitong.defaultTenantKey);
  const sanitizedConfig = getSanitizedConfigSummary();
  sanitizedConfig.fenbeitong.tenants = listFenbeitongTenants();
  sanitizedConfig.fenbeitong.tenantStorePath = getTenantStorePath();
  return {
    productName: 'Fenbeitong Kingdee Voucher Integration',
    mode: {
      fenbeitong: config.fenbeitong.mode,
      kingdee: config.kingdee.mode
    },
    readiness: {
      fenbeitong: fenbeitongReadiness(config.fenbeitong.mode, defaultTenant),
      kingdee: kingdeeReadiness(config.kingdee)
    },
    summary: getDashboardSummary(),
    config: sanitizedConfig,
    scheduler: getSchedulerStatus()
  };
}

export function getReadinessStatus() {
  const status = getSystemStatus();
  return {
    ready: status.readiness.fenbeitong.ready && status.readiness.kingdee.ready,
    dependencies: status.readiness,
    mode: status.mode
  };
}

function fenbeitongReadiness(mode, tenant) {
  if (mode === 'mock') {
    return {
      ready: true,
      message: 'mock mode enabled',
      missing: []
    };
  }
  const fields = [
    ['tenant', tenant],
    ['tenant.baseUrl', tenant?.baseUrl],
    ['tenant.pullPath', tenant?.pullPath],
    ['tenant.detailPath', tenant?.detailPath]
  ];
  if (tenant?.status === 'waiting_development') {
    fields.push(['tenant.credentials', '']);
  } else if (tenant?.authMode === 'access-token') {
    fields.push(['tenant.accessToken', tenant?.credentialsConfigured]);
  } else {
    fields.push(['tenant.appCredentials', tenant?.credentialsConfigured]);
    fields.push(['tenant.authPath', tenant?.authPath]);
  }
  return readiness(mode, fields);
}

function kingdeeReadiness(config) {
  if (config.mode !== 'real') {
    return {
      ready: false,
      message: 'real Kingdee save required',
      missing: ['KINGDEE_MODE=real']
    };
  }
  return readiness(config.mode, [
    ['KINGDEE_BASE_URL', config.baseUrl],
    ['KINGDEE_ACCT_ID', config.acctId],
    ['KINGDEE_USERNAME', config.username],
    ['KINGDEE_PASSWORD', config.password],
    ['KINGDEE_AUTH_PATH', config.authPath],
    ['KINGDEE_SAVE_PATH', config.savePath],
    ['KINGDEE_VIEW_PATH', config.viewPath]
  ]);
}

function readiness(mode, fields) {
  if (mode === 'mock') {
    return {
      ready: true,
      message: 'mock mode enabled',
      missing: []
    };
  }
  const missing = fields.filter(([, value]) => !value).map(([name]) => name);
  return {
    ready: missing.length === 0,
    message: missing.length === 0 ? 'real mode configured' : `missing ${missing.join(', ')}`,
    missing
  };
}
