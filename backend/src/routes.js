import { buildMockTemplate } from './mock-template.js';
import { readJson, sendError, sendJson } from './http-utils.js';
import { AppError } from './errors.js';
import { createCsvDownload } from './export-downloads.js';
import { getSchedulerStatus, runSchedulerOnce } from './services/scheduler.js';
import {
  getPaymentStatusSchedulerStatus,
  runPaymentStatusSyncOnce
} from './services/payment-status-scheduler.js';
import { previewPaymentStatusSync } from './services/payment-status-sync.js';
import { getReadinessStatus, getSystemStatus } from './services/system-status.js';
import {
  prepareExpenseReimbursement,
  previewExpenseReimbursement,
  saveExpenseReimbursementToErp,
  syncFenbeitongDocuments
} from './services/expense-reimbursement-workflow.js';
import { listFenbeitongTenants, saveFenbeitongTenantCredentials } from './tenant-store.js';
import {
  findPreparedRecord,
  getConfig,
  getKingdeeAccountSelection,
  getIntegrationSettings,
  listFenbeitongRequesterCatalog,
  listOperationLogs,
  listProcessRecords,
  listSyncedDocuments,
  saveConfig,
  saveIntegrationSelection,
  saveKingdeeAccountSelection
} from './repository.js';
import { getAppConfig, resolveKingdeeAccount, sanitizeKingdeeAccount } from './config.js';
import {
  processRecordListResponse,
  processRecordResponse
} from './process-record-response.js';

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
    if (request.method === 'POST' && url.pathname === '/api/exports') {
      return sendJson(response, 201, {
        success: true,
        data: createCsvDownload(await readJson(request))
      });
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
    if (request.method === 'GET' && url.pathname === '/api/payment-status-sync/status') {
      return sendJson(response, 200, { success: true, data: getPaymentStatusSchedulerStatus() });
    }
    if (request.method === 'GET' && url.pathname === '/api/payment-status-sync/preview') {
      return sendJson(response, 200, { success: true, data: await previewPaymentStatusSync({
        tenantKey: url.searchParams.get('tenantKey') || undefined,
        orgNumber: url.searchParams.get('orgNumber') || undefined
      }) });
    }
    if (request.method === 'POST' && url.pathname === '/api/payment-status-sync/run') {
      return sendJson(response, 200, { success: true, data: await runPaymentStatusSyncOnce('manual') });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/config/mock-template') {
      return sendJson(response, 200, { success: true, data: buildMockTemplate() });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/tenants') {
      return sendJson(response, 200, { success: true, data: listFenbeitongTenants() });
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/api/fenbeitong-expense-reimbursement/tenants/')) {
      const tenantKey = decodeURIComponent(url.pathname.split('/').pop());
      return sendJson(response, 200, {
        success: true,
        data: saveFenbeitongTenantCredentials({
          ...(await readJson(request)),
          key: tenantKey
        })
      });
    }
    if (request.method === 'PUT' && url.pathname === '/api/fenbeitong-expense-reimbursement/config') {
      return sendJson(response, 200, { success: true, data: saveConfig(await readJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/config') {
      const current = getConfig();
      if (!current) {
        throw new Error('configuration is missing');
      }
      return sendJson(response, 200, { success: true, data: current });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-expense-reimbursement/sync') {
      return sendJson(response, 200, { success: true, data: await syncFenbeitongDocuments(await readJson(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/synced-documents') {
      return sendJson(response, 200, { success: true, data: listSyncedDocuments() });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/requesters') {
      const tenantKey = url.searchParams.get('tenantKey') || getIntegrationSelection().tenantKey;
      return sendJson(response, 200, { success: true, data: listFenbeitongRequesterCatalog(tenantKey) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-expense-reimbursement/preview') {
      return sendJson(response, 200, { success: true, data: await previewExpenseReimbursement(await readJson(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-expense-reimbursement/prepare') {
      const record = await prepareExpenseReimbursement(await readJson(request));
      return sendJson(response, 200, { success: true, data: processRecordResponse(record) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-expense-reimbursement/save-erp') {
      const record = await saveExpenseReimbursementToErp(await readJson(request));
      return sendJson(response, 200, { success: true, data: processRecordResponse(record) });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-expense-reimbursement/process') {
      return sendJson(response, 200, {
        success: true,
        data: processRecordListResponse(listProcessRecords())
      });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/fenbeitong-expense-reimbursement/process/')) {
      const sourceId = decodeURIComponent(url.pathname.split('/').pop());
      const record = findPreparedRecord(sourceId);
      if (!record) {
        throw new Error(`process record is missing for ${sourceId}`);
      }
      return sendJson(response, 200, { success: true, data: processRecordResponse(record) });
    }
    if (request.method === 'GET' && url.pathname === '/api/operations/logs') {
      const requestedLimit = Number(url.searchParams.get('limit') || 50);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(200, Math.max(1, Math.trunc(requestedLimit)))
        : 50;
      return sendJson(response, 200, { success: true, data: listOperationLogs(limit) });
    }
    return sendJson(response, 404, { success: false, error: { message: 'not found' } });
  } catch (error) {
    return sendError(response, error);
  }
}
