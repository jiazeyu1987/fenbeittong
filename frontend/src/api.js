// API requests always use the current site's reverse proxy.  Keeping a
// hard-coded development backend here made a page served on port 5173 call
// the obsolete port 3001 even when its proxy correctly targeted port 3101.
const baseUrl = '';

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await fetch(baseUrl + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      break;
    } catch (cause) {
      if (attempt < attempts) {
        await delay(attempt * 500);
        continue;
      }
      throw localBackendConnectionError(cause);
    }
  }
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    const error = new Error('本地后台返回了无法识别的数据，当前操作结果尚未确认。');
    error.code = 'LOCAL_BACKEND_INVALID_RESPONSE';
    error.detail = { cause: String(cause?.message || cause || '') };
    throw error;
  }
  if (!response.ok || body.success === false) {
    const code = body.error?.code || `HTTP_${response.status}`;
    const error = new Error(localizedErrorMessage(
      code,
      body.error?.message || `请求失败，HTTP 状态码 ${response.status}`
    ));
    error.code = code;
    error.detail = body.error?.detail || {};
    throw error;
  }
  return body.data;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localBackendConnectionError(cause) {
  const error = new Error(
    '无法连接本地后台服务，当前单据尚未确认保存；程序会继续核对处理结果。'
  );
  error.code = 'LOCAL_BACKEND_UNREACHABLE';
  error.detail = { cause: String(cause?.message || cause || '') };
  return error;
}

function localizedErrorMessage(code, message) {
  const source = String(message || '').trim();
  if (/failed to fetch|networkerror|network request failed/i.test(source)) {
    return '无法连接本地后台服务，当前单据尚未确认保存。';
  }
  if (/^Kingdee expense reimbursement save failed:/i.test(source)) {
    return source.replace(
      /^Kingdee expense reimbursement save failed:\s*/i,
      '金蝶费用报销单保存失败：'
    );
  }
  if (/^Kingdee expense reimbursement/i.test(source)) {
    return source.replace(/^Kingdee expense reimbursement/i, '金蝶费用报销单');
  }
  if (/^process record is missing for /i.test(source)) {
    return source.replace(/^process record is missing for /i, '未找到本地处理记录：');
  }
  if (code === 'KINGDEE_NETWORK_FAILED') {
    return `无法连接金蝶服务：${source}`;
  }
  return source || '请求失败，后台没有返回具体原因。';
}

export const api = {
  health: () => request('/api/health'),
  ready: () => request('/api/ready'),
  systemStatus: () => request('/api/system/status'),
  integrationSettings: () => request('/api/integration-settings'),
  saveIntegrationSettings: (data) => request('/api/integration-settings', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  saveFenbeitongTenant: (tenantKey, data) => request(`/api/fenbeitong-expense-reimbursement/tenants/${encodeURIComponent(tenantKey)}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  listKingdeeAccounts: () => request('/api/kingdee/accounts'),
  selectKingdeeAccount: (data) => request('/api/kingdee/account-selection', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  schedulerStatus: () => request('/api/scheduler/status'),
  runSchedulerOnce: () => request('/api/scheduler/run-once', {
    method: 'POST',
    body: JSON.stringify({})
  }),
  getMockTemplate: () => request('/api/fenbeitong-expense-reimbursement/config/mock-template'),
  getConfig: () => request('/api/fenbeitong-expense-reimbursement/config'),
  saveConfig: (data) => request('/api/fenbeitong-expense-reimbursement/config', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  syncFenbeitong: (data = {}) => request('/api/fenbeitong-expense-reimbursement/sync', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  paymentStatusSyncStatus: () => request('/api/payment-status-sync/status'),
  previewPaymentStatusSync: (tenantKey) => request(`/api/payment-status-sync/preview?tenantKey=${encodeURIComponent(tenantKey || '')}`),
  runPaymentStatusSync: () => request('/api/payment-status-sync/run', {
    method: 'POST',
    body: JSON.stringify({})
  }),
  listSyncedDocuments: () => request('/api/fenbeitong-expense-reimbursement/synced-documents'),
  listFenbeitongRequesters: (tenantKey) => request(`/api/fenbeitong-expense-reimbursement/requesters?tenantKey=${encodeURIComponent(tenantKey)}`),
  preview: (data) => request('/api/fenbeitong-expense-reimbursement/preview', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  prepare: (data) => request('/api/fenbeitong-expense-reimbursement/prepare', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  saveErp: (data) => request('/api/fenbeitong-expense-reimbursement/save-erp', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  listProcessRecords: () => request('/api/fenbeitong-expense-reimbursement/process'),
  getProcess: (sourceId) => request(`/api/fenbeitong-expense-reimbursement/process/${encodeURIComponent(sourceId)}`),
  createCsvExport: (data) => request('/api/exports', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  listLogs: (limit = 50) => request(`/api/operations/logs?limit=${encodeURIComponent(limit)}`)
};
