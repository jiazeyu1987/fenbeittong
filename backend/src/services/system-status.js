import {
  getAppConfig,
  getSanitizedConfigSummary,
  resolveKingdeeAccount,
  resolveKingdeeAcctId,
  sanitizeKingdeeAccount,
  sanitizeKingdeeAcctId
} from '../config.js';
import { getDashboardSummary, getIntegrationSelection } from '../repository.js';
import { getFenbeitongTenant, getTenantStorePath, listFenbeitongTenants } from '../tenant-store.js';
import { getSchedulerStatus } from './scheduler.js';

export function getSystemStatus() {
  const config = getAppConfig();
  const integrationSelection = getIntegrationSelection();
  const defaultTenant = getFenbeitongTenant(integrationSelection.tenantKey);
  const sanitizedConfig = getSanitizedConfigSummary();
  const selectedKingdeeAccount = resolveKingdeeAccount(config.kingdee, integrationSelection.kingdeeAccountKey);
  const selectedKingdeeAcctId = resolveKingdeeAcctId(config.kingdee, integrationSelection.kingdeeAcctIdKey);
  sanitizedConfig.integrationSelection = integrationSelection;
  sanitizedConfig.fenbeitong.tenants = listFenbeitongTenants();
  sanitizedConfig.fenbeitong.tenantStorePath = getTenantStorePath();
  sanitizedConfig.kingdee.selectedAccountKey = selectedKingdeeAccount.key;
  sanitizedConfig.kingdee.selectedAccount = sanitizeKingdeeAccount(selectedKingdeeAccount);
  sanitizedConfig.kingdee.selectedAcctIdKey = selectedKingdeeAcctId.key;
  sanitizedConfig.kingdee.selectedAcctId = sanitizeKingdeeAcctId(selectedKingdeeAcctId);
  return {
    productName: 'Fenbeitong Kingdee Voucher Integration',
    mode: {
      fenbeitong: config.fenbeitong.mode,
      kingdee: config.kingdee.mode
    },
    readiness: {
      fenbeitong: fenbeitongReadiness(config.fenbeitong.mode, defaultTenant),
      kingdee: kingdeeReadiness(config.kingdee, selectedKingdeeAccount, selectedKingdeeAcctId)
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

function kingdeeReadiness(config, account, acctId) {
  if (config.mode !== 'real') {
    return {
      ready: false,
      message: 'real Kingdee save required',
      missing: ['KINGDEE_MODE=real']
    };
  }
  return readiness(config.mode, [
    ['KINGDEE_BASE_URL', config.baseUrl],
    ['KINGDEE_ACCOUNT.acctId', acctId?.acctId],
    ['KINGDEE_ACCOUNT.username', account?.username],
    ['KINGDEE_ACCOUNT.password', account?.password],
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
