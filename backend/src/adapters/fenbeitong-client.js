import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAppConfig, getRootDir, validateFenbeitongConfig } from '../config.js';
import { dependencyError } from '../errors.js';

export async function pullFenbeitongReimbursements() {
  const config = getAppConfig().fenbeitong;
  if (config.mode === 'mock') {
    const fixedJson = readFileSync(
      resolve(getRootDir(), 'mock-data/fenbeitong-reimbursement-valid.json'),
      'utf8'
    );
    const baseDocument = JSON.parse(fixedJson);
    return {
      mode: 'mock',
      mockReplacement: true,
      mockReason: 'Fenbeitong access token is not available yet',
      documents: buildMockReimbursements(baseDocument, 100)
    };
  }

  validateFenbeitongConfig();
  const url = new URL(config.pullPath, config.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': config.accessToken
    },
    body: JSON.stringify({})
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
  if (Array.isArray(body.data)) {
    return {
      mode: 'real',
      mockReplacement: false,
      mockReason: '',
      documents: body.data.map((item) => ({ code: '0', msg: body.msg || '', data: item }))
    };
  }
  if (body.data && typeof body.data === 'object') {
    return {
      mode: 'real',
      mockReplacement: false,
      mockReason: '',
      documents: [body]
    };
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong response data must be an object or array');
}

function buildMockReimbursements(baseDocument, count) {
  const requesters = [
    ['PL0189', '陈彩灵', 'BM000330', '华东区'],
    ['PL0313', '陈杰', 'BM000339', '中部地区'],
    ['PL0187', '陈英凤', 'BM000321', '南四区'],
    ['X011', '顾硕', 'BM000341', '华东地区'],
    ['X015', '颜建鑫', 'BM000341', '华东地区'],
    ['PL0219', '马魏峰', 'BM000337', '华南地区'],
    ['X005', '魏玉川', 'BM000340', '山河地区'],
    ['A202011', '李妹', 'BM000330', '组装']
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
