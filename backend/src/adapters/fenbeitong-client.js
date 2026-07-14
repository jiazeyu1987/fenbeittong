import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAppConfig, getRootDir, validateFenbeitongConfig } from '../config.js';
import { dependencyError } from '../errors.js';
import {
  getFenbeitongTenant,
  updateFenbeitongTenantToken
} from '../tenant-store.js';

export function clearFenbeitongTokenCacheForTest() {
  const tenant = getFenbeitongTenant('puhui', { includeSecrets: true });
  if (!tenant) {
    return;
  }
  updateFenbeitongTenantToken('puhui', {
    accessToken: 'cleared-for-test',
    expiresAt: '1970-01-01T00:00:00.000Z'
  });
}

export async function pullFenbeitongReimbursements(options = {}) {
  const config = getAppConfig().fenbeitong;
  const tenant = resolveTenant(config.defaultTenantKey, options.tenantKey);
  if (config.mode === 'mock') {
    const fixedJson = readFileSync(
      resolve(getRootDir(), 'mock-data/fenbeitong-reimbursement-valid.json'),
      'utf8'
    );
    const baseDocument = JSON.parse(fixedJson);
    return {
      mode: 'mock',
      tenantKey: tenant.key,
      mockReplacement: true,
      mockReason: 'Fenbeitong real interface is not enabled for this run',
      documents: buildMockReimbursements(baseDocument, 100)
    };
  }

  validateFenbeitongConfig(tenant);
  const accessToken = await resolveAccessToken(tenant);
  const listPayload = {
    ...tenant.listPayload,
    ...config.listPayloadOverrides
  };
  const listBody = await postFenbeitongApi(tenant, tenant.pullPath, accessToken, listPayload);
  const summaries = extractReimbursementSummaries(listBody);
  const documents = [];
  for (const summary of summaries) {
    const detailPayload = buildDetailRequestPayload(summary);
    const detailBody = await postFenbeitongApi(tenant, tenant.detailPath, accessToken, detailPayload);
    documents.push(validateDetailDocument(detailBody));
  }
  return {
    mode: 'real',
    tenantKey: tenant.key,
    mockReplacement: false,
    mockReason: '',
    documents
  };
}

function resolveTenant(defaultTenantKey, tenantKey) {
  const key = tenantKey || defaultTenantKey || 'puhui';
  const tenant = getFenbeitongTenant(key, { includeSecrets: true });
  if (!tenant) {
    throw dependencyError('FENBEITONG_TENANT_UNKNOWN', `Fenbeitong tenant is not configured: ${key}`);
  }
  if (tenant.status === 'waiting_development') {
    throw dependencyError('FENBEITONG_TENANT_WAITING_DEVELOPMENT', `${tenant.name}接口等待开发中`);
  }
  if (tenant.status === 'disabled') {
    throw dependencyError('FENBEITONG_TENANT_DISABLED', `${tenant.name}接口已停用`);
  }
  return tenant;
}

async function resolveAccessToken(tenant) {
  if (tenant.authMode === 'access-token') {
    return tenant.accessToken;
  }
  if (tenant.accessToken && Date.parse(tenant.tokenExpiresAt || '') > Date.now()) {
    return tenant.accessToken;
  }
  const url = new URL(tenant.authPath, tenant.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: tenant.appId,
      app_key: tenant.appKey
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('FENBEITONG_AUTH_HTTP_FAILED', `Fenbeitong auth failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  if (String(body.code) !== '0') {
    throw dependencyError('FENBEITONG_AUTH_RESPONSE_FAILED', `Fenbeitong auth failed: code=${body.code}, msg=${body.msg || ''}`, {
      code: body.code,
      msg: body.msg || ''
    });
  }
  const token = typeof body.data === 'string' ? body.data : '';
  if (!token) {
    throw dependencyError('FENBEITONG_AUTH_TOKEN_MISSING', 'Fenbeitong auth response did not include data token string');
  }
  updateFenbeitongTenantToken(tenant.key, {
    accessToken: token,
    expiresAt: new Date(Date.now() + tenant.refreshIntervalSeconds * 1000).toISOString()
  });
  return token;
}

async function postFenbeitongApi(tenant, path, accessToken, payload) {
  const url = new URL(path, tenant.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': accessToken
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('FENBEITONG_HTTP_FAILED', `Fenbeitong request failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  if (String(body.code) !== '0') {
    throw dependencyError('FENBEITONG_RESPONSE_FAILED', `Fenbeitong response failed: code=${body.code}, msg=${body.msg || ''}`, {
      code: body.code,
      msg: body.msg || ''
    });
  }
  return body;
}

function extractReimbursementSummaries(body) {
  if (Array.isArray(body.data)) {
    return body.data.flatMap((item) => (
      Array.isArray(item?.reimbursements) ? item.reimbursements : [item]
    ));
  }
  if (Array.isArray(body.data?.reimbursements)) {
    return body.data.reimbursements;
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement list response must include data.reimbursements');
}

function buildDetailRequestPayload(summary) {
  if (summary?.reimb_id) {
    return { reimb_id: summary.reimb_id };
  }
  if (summary?.reimb_code) {
    return { reimb_code: summary.reimb_code };
  }
  if (summary?.reimburse_code) {
    return { reimb_code: summary.reimburse_code };
  }
  if (summary?.id) {
    return { reimb_code: summary.id };
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement list item is missing reimb_id or reimb_code');
}

function validateDetailDocument(body) {
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail response data must be an object');
  }
  if (!body.data.reimb_id) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail is missing data.reimb_id');
  }
  if (!body.data.reimb_code) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail is missing data.reimb_code');
  }
  if (!Array.isArray(body.data.expenses) || body.data.expenses.length === 0) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail is missing data.expenses');
  }
  return {
    ...body,
    data: body.data
  };
}

function buildMockReimbursements(baseDocument, count) {
  const requesters = [
    ['PL0189', '陈彩灵', 'BM000330', '华东区'],
    ['PL0313', '陈杰', 'BM000339', '中部地区'],
    ['PL0187', '陈英凤', 'BM000321', '南四区'],
    ['X011', '顾硕', 'BM000341', '华东地区'],
    ['X015', '颜建鑫', 'BM000341', '华东地区'],
    ['PL0219', '马巍峰', 'BM000337', '华南地区'],
    ['X005', '魏玉川', 'BM000340', '山河地区'],
    ['A202011', '李姝', 'BM000330', '组装']
  ];
  const categories = [
    ['TRAVEL', '差旅费'],
    ['OFFICE', '办公费']
  ];

  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const document = structuredClone(baseDocument);
    const requester = requesters[index % requesters.length];
    const primaryCategory = categories[index % categories.length];
    const secondaryCategory = categories[(index + 1) % categories.length];
    const primaryAmount = 80 + ((index * 37) % 900) + (index % 4) * 0.25;
    const secondaryAmount = 60 + ((index * 29) % 700) + (index % 3) * 0.5;
    const taxAmount = Number((primaryAmount * 0.06).toFixed(2));
    const totalAmount = Number((primaryAmount + secondaryAmount).toFixed(2));
    const created = new Date(Date.UTC(2026, 6, 1 + (index % 11), 1 + (index % 9), (index * 7) % 60, 0));

    document.trace_id = `trace-mock-reimbursement-${pad(sequence)}`;
    document.request_id = `request-mock-reimbursement-${pad(sequence)}`;
    document.data.reimb_id = `MOCK-REIMB-${pad(sequence)}`;
    document.data.reimb_code = `MOCK-BX-${pad(sequence)}`;
    document.data.reimb_third_id = `MOCK-THIRD-${pad(sequence)}`;
    document.data.user = {
      id: `USER-${pad(sequence)}`,
      code: requester[0],
      name: requester[1],
      department_code: requester[2],
      department_name: requester[3]
    };
    document.data.total_amount = totalAmount.toFixed(2);
    document.data.payment_amount = totalAmount.toFixed(2);
    document.data.apply_reason = `${requester[1]}${sequence}号报销`;
    document.data.create_time = formatMockTime(created);
    document.data.expense_number = 2;
    document.data.expenses = [
      {
        id: `EXP-${pad(sequence)}-01`,
        cost_category: { code: primaryCategory[0], name: primaryCategory[1] },
        total_amount: primaryAmount.toFixed(2),
        reason: `${primaryCategory[1]}报销`,
        invoices: [
          {
            id: `INV-${pad(sequence)}-01`,
            total_amount: primaryAmount.toFixed(2),
            tax_amount: taxAmount.toFixed(2),
            deductible_tax_amount: taxAmount.toFixed(2)
          }
        ]
      },
      {
        id: `EXP-${pad(sequence)}-02`,
        cost_category: { code: secondaryCategory[0], name: secondaryCategory[1] },
        total_amount: secondaryAmount.toFixed(2),
        reason: `${secondaryCategory[1]}报销`,
        invoices: []
      }
    ];
    return document;
  });
}

function pad(value) {
  return String(value).padStart(3, '0');
}

function formatMockTime(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}:${String(local.getUTCSeconds()).padStart(2, '0')}`;
}
