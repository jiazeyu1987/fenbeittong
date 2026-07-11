const baseUrl = 'http://127.0.0.1:3001';

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(body.error?.message || `request failed: ${response.status}`);
  }
  return body.data;
}

export const api = {
  health: () => request('/api/health'),
  getMockTemplate: () => request('/api/fenbeitong-voucher/config/mock-template'),
  saveConfig: (data) => request('/api/fenbeitong-voucher/config', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  preview: (data) => request('/api/fenbeitong-voucher/preview', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  prepare: (data) => request('/api/fenbeitong-voucher/prepare', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  getProcess: (sourceId) => request(`/api/fenbeitong-voucher/process/${encodeURIComponent(sourceId)}`)
};
