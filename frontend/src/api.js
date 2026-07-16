const baseUrl = 'http://127.0.0.1:3001';

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    const error = new Error(body.error?.message || `request failed: ${response.status}`);
    error.code = body.error?.code || `HTTP_${response.status}`;
    error.detail = body.error?.detail || {};
    throw error;
  }
  return body.data;
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
  getMockTemplate: () => request('/api/fenbeitong-voucher/config/mock-template'),
  saveConfig: (data) => request('/api/fenbeitong-voucher/config', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  syncFenbeitong: (data = {}) => request('/api/fenbeitong-voucher/sync', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  listSyncedDocuments: () => request('/api/fenbeitong-voucher/synced-documents'),
  preview: (data) => request('/api/fenbeitong-voucher/preview', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  prepare: (data) => request('/api/fenbeitong-voucher/prepare', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  pushErp: (data) => request('/api/fenbeitong-voucher/push-erp', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  listProcessRecords: () => request('/api/fenbeitong-voucher/process'),
  getProcess: (sourceId) => request(`/api/fenbeitong-voucher/process/${encodeURIComponent(sourceId)}`),
  listLogs: () => request('/api/operations/logs')
};
