import { buildMockTemplate } from './mock-template.js';
import { readJson, sendError, sendJson } from './http-utils.js';
import { getSchedulerStatus, runSchedulerOnce } from './services/scheduler.js';
import { getReadinessStatus, getSystemStatus } from './services/system-status.js';
import { prepareVoucher, previewVoucher, pushVoucherToErp, syncFenbeitongDocuments } from './services/voucher-workflow.js';
import { listFenbeitongTenants, saveFenbeitongTenantCredentials } from './tenant-store.js';
import {
  findPreparedRecord,
  getConfig,
  getKingdeeAccountSelection,
  getIntegrationSettings,
  listOperationLogs,
  listProcessRecords,
  listSyncedDocuments,
  saveConfig,
  saveIntegrationSelection,
  saveKingdeeAccountSelection
} from './repository.js';
import { getAppConfig, resolveKingdeeAccount, sanitizeKingdeeAccount } from './config.js';

export async function handleApi(request, response) {
  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, {});
  }

  const url = new URL(request.url, 'http://localhost');
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { success: true, status: 'ok' });
    }
    if (request.method === 'GET' && url.pathname === '/api/ready') {
      const readiness = getReadinessStatus();
      return sendJson(response, readiness.ready ? 200 : 503, { success: readiness.ready, data: readiness });
    }
    if (request.method === 'GET' && url.pathname === '/api/system/status') {
      return sendJson(response, 200, { success: true, data: getSystemStatus() });
    }
    if (request.method === 'GET' && url.pathname === '/api/system/config-summary') {
      return sendJson(response, 200, { success: true, data: getSystemStatus().config });
    }
    if (request.method === 'GET' && url.pathname === '/api/kingdee/accounts') {
      const config = getAppConfig().kingdee;
      const selectedAccount = resolveKingdeeAccount(config, getKingdeeAccountSelection());
      return sendJson(response, 200, {
        success: true,
        data: {
          selectedAccountKey: selectedAccount.key,
          selectedAccount: sanitizeKingdeeAccount(selectedAccount),
          accounts: config.accounts.map(sanitizeKingdeeAccount)
        }
      });
    }
    if (request.method === 'PUT' && url.pathname === '/api/kingdee/account-selection') {
      return sendJson(response, 200, {
        success: true,
        data: saveKingdeeAccountSelection((await readJson(request)).accountKey)
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/integration-settings') {
      return sendJson(response, 200, { success: true, data: getIntegrationSettings() });
    }
    if (request.method === 'PUT' && url.pathname === '/api/integration-settings') {
      return sendJson(response, 200, {
        success: true,
        data: saveIntegrationSelection(await readJson(request))
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/scheduler/status') {
      return sendJson(response, 200, { success: true, data: getSchedulerStatus() });
    }
    if (request.method === 'POST' && url.pathname === '/api/scheduler/run-once') {
      return sendJson(response, 200, { success: true, data: await runSchedulerOnce('manual') });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/config/mock-template') {
      return sendJson(response, 200, { success: true, data: buildMockTemplate() });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/tenants') {
      return sendJson(response, 200, { success: true, data: listFenbeitongTenants() });
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/api/fenbeitong-voucher/tenants/')) {
      const tenantKey = decodeURIComponent(url.pathname.split('/').pop());
      return sendJson(response, 200, {
        success: true,
        data: saveFenbeitongTenantCredentials({
          ...(await readJson(request)),
          key: tenantKey
        })
      });
    }
    if (request.method === 'PUT' && url.pathname === '/api/fenbeitong-voucher/config') {
      return sendJson(response, 200, { success: true, data: saveConfig(await readJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/config') {
      const current = getConfig();
      if (!current) {
        throw new Error('configuration is missing');
      }
      return sendJson(response, 200, { success: true, data: current });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/sync') {
      return sendJson(response, 200, { success: true, data: await syncFenbeitongDocuments(await readJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/synced-documents') {
      return sendJson(response, 200, { success: true, data: listSyncedDocuments() });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/preview') {
      return sendJson(response, 200, { success: true, data: previewVoucher(await readJson(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/prepare') {
      return sendJson(response, 200, { success: true, data: prepareVoucher(await readJson(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/push-erp') {
      return sendJson(response, 200, { success: true, data: await pushVoucherToErp(await readJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/process') {
      return sendJson(response, 200, { success: true, data: listProcessRecords() });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/fenbeitong-voucher/process/')) {
      const sourceId = decodeURIComponent(url.pathname.split('/').pop());
      const record = findPreparedRecord(sourceId);
      if (!record) {
        throw new Error(`process record is missing for ${sourceId}`);
      }
      return sendJson(response, 200, { success: true, data: record });
    }
    if (request.method === 'GET' && url.pathname === '/api/operations/logs') {
      return sendJson(response, 200, { success: true, data: listOperationLogs() });
    }
    return sendJson(response, 404, { success: false, error: { message: 'not found' } });
  } catch (error) {
    return sendError(response, error);
  }
}
