import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockTemplate } from './mock-template.js';
import { buildVoucherPreview } from './voucher-mapper.js';
import { findPreparedRecord, getConfig, saveConfig, savePreparedRecord } from './repository.js';
import { readJson, sendError, sendJson } from './http-utils.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export async function handleApi(request, response) {
  if (request.method === 'OPTIONS') {
    return sendJson(response, 204, {});
  }

  const url = new URL(request.url, 'http://localhost');
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { success: true, status: 'ok' });
    }
    if (request.method === 'GET' && url.pathname === '/api/fenbeitong-voucher/config/mock-template') {
      return sendJson(response, 200, { success: true, data: buildMockTemplate() });
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
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/preview') {
      return sendJson(response, 200, { success: true, data: buildVoucherPreview(await readJson(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/fenbeitong-voucher/prepare') {
      const preview = buildVoucherPreview(await readJson(request));
      return sendJson(response, 200, { success: true, data: savePreparedRecord(preview) });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/fenbeitong-voucher/process/')) {
      const sourceId = decodeURIComponent(url.pathname.split('/').pop());
      const record = findPreparedRecord(sourceId);
      if (!record) {
        throw new Error(`process record is missing for ${sourceId}`);
      }
      return sendJson(response, 200, { success: true, data: record });
    }
    if (request.method === 'POST' && url.pathname === '/api/mock/fenbeitong/reimbursements/pull') {
      const fixedJson = readFileSync(resolve(root, 'mock-data/fenbeitong-reimbursement-valid.json'), 'utf8');
      return sendJson(response, 200, { success: true, data: JSON.parse(fixedJson) });
    }
    if (request.method === 'POST' && url.pathname === '/api/mock/kingdee/voucher/save') {
      return sendJson(response, 200, {
        success: true,
        data: {
          simulated: true,
          erpFid: 'MOCK-KINGDEE-FID',
          erpNumber: 'MOCK-KINGDEE-NUMBER',
          documentStatus: 'Z'
        }
      });
    }
    return sendJson(response, 404, { success: false, error: { message: 'not found' } });
  } catch (error) {
    return sendError(response, error);
  }
}
