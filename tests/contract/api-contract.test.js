import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../../backend/src/mock-template.js';
import { buildVoucherPreview } from '../../backend/src/voucher-mapper.js';
import { getSystemStatus } from '../../backend/src/services/system-status.js';
import { resetRepository } from '../../backend/src/repository.js';
import { validateFenbeitongConfig } from '../../backend/src/config.js';
import {
  clearFenbeitongTokenCacheForTest,
  pullFenbeitongReimbursements
} from '../../backend/src/adapters/fenbeitong-client.js';
import { getSchedulerStatus, runSchedulerOnce, stopSchedulerForTest } from '../../backend/src/services/scheduler.js';
import {
  getFenbeitongTenant,
  resetTenantStoreForTest,
  saveFenbeitongTenantCredentials
} from '../../backend/src/tenant-store.js';

test('mock template contains required fields and no real token', () => {
  const template = buildMockTemplate();
  assert.equal(template.accountBookNumber, '908');
  assert.equal(template.voucherGroupNumber, 'PZZ9');
  assert.equal(template.templateErpFid, '780047');
  assert.equal(template.categoryAccountNumbers.TRAVEL, '6111');
  assert.equal(template.categoryAccountNumbers.CI007, '6111');
  assert.equal(template.departmentDetailField, '');
  assert.equal(template.employeeDetailField, '');
  assert.equal(template.creditAccountNumber, '1001.01');
  assert.equal(template.splitDeductibleTax, false);
  assert.equal(template.erpTemplateModel.AccountBookID.Number, '908');
  assert.equal(template.erpTemplateModel.VOUCHERGROUPID.Number, 'PZZ9');
  assert.equal(template.fenbeitongAccessToken, '');
  assert.match(template.mockFixedJson, /MOCK-REIMB-001/);
});

test('preview response keeps stable contract fields', () => {
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  for (const field of ['sourceId', 'sourceCode', 'idempotencyKey', 'contentHash', 'debitTotal', 'creditTotal', 'balanced', 'payload']) {
    assert.ok(Object.hasOwn(preview, field), `${field} should exist`);
  }
  assert.ok(Array.isArray(preview.voucherLines));
  assert.ok(preview.voucherLines.length > 0);
  assert.ok(Array.isArray(preview.sourceSummary.expenseCategories));
  assert.equal(preview.sourceSummary.requester, 'Mock User');
  assert.equal(preview.taxSummary.deductibleTaxAmount, 0);
  assert.equal(preview.voucherLines[0].sourceExpenseId, 'EXP-001');
  assert.match(preview.voucherLines[0].mappingRule, /category TRAVEL/);
  assert.equal(preview.financialSummary.documentStatusName, 'Saved draft only; not submitted, audited, or posted');
  assert.equal(preview.financialSummary.lineCount, preview.voucherLines.length);
});

test('voucher payload writes only Kingdee GL_VOUCHER fields', () => {
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  assert.ok(Object.hasOwn(preview.payload.Model, 'AccountBookID'));
  assert.ok(Object.hasOwn(preview.payload.Model, 'VOUCHERGROUPID'));
  assert.ok(Object.hasOwn(preview.payload.Model, 'FEntity'));
  assert.equal(Object.hasOwn(preview.payload.Model, 'FAccountBookID'), false);
  assert.equal(Object.hasOwn(preview.payload.Model, 'FVOUCHERGROUPID'), false);
  assert.equal(preview.payload.Model.AccountBookID.Number, '908');
  assert.equal(preview.payload.Model.VOUCHERGROUPID.Number, 'PZZ9');
  assert.equal(preview.payload.Model.FEntity[0].FEXCHANGERATETYPE.FNumber, 'HLTX01_SYS');
  assert.equal(preview.payload.Model.FEntity[0].FAMOUNTFOR, 108);
  assert.equal(preview.payload.Model.FEntity[0].FDC, '1');
  assert.equal(preview.payload.Model.FEntity[0].FACCOUNTID.FNumber, '6111');
  assert.deepEqual(preview.payload.Model.FEntity[0].FDetailID, {});
  assert.equal(preview.payload.Model.FEntity.at(-1).FACCOUNTID.FNumber, '1001.01');
  assert.equal(Object.hasOwn(preview.payload.Model, 'reimb_id'), false);
  assert.equal(Object.hasOwn(preview.payload.Model.FEntity[0], 'cost_category'), false);
});

test('system status exposes mode and readiness for formal workflow', () => {
  const restore = forceMockFenbeitongEnv();
  try {
    resetRepository();
    const status = getSystemStatus();
    assert.equal(status.mode.fenbeitong, 'mock');
    assert.equal(status.mode.kingdee, 'mock');
    assert.equal(status.readiness.fenbeitong.ready, true);
    assert.equal(status.readiness.kingdee.ready, false);
    assert.deepEqual(status.readiness.kingdee.missing, ['KINGDEE_MODE=real']);
    assert.equal(status.scheduler.enabled, false);
    assert.equal(status.scheduler.autoPushErp, false);
    assert.ok(Object.hasOwn(status.summary.counts, 'syncedDocuments'));
    assert.ok(Object.hasOwn(status.summary.counts, 'operationLogs'));
    assert.equal(status.config.fenbeitong.credentialStore, 'sqlite');
    assert.deepEqual(status.config.fenbeitong.tenants.map((tenant) => tenant.key), ['puhui', 'yingtai']);
    assert.equal(status.config.fenbeitong.tenants.find((tenant) => tenant.key === 'puhui').name, '璞慧');
    assert.equal(status.config.fenbeitong.tenants.find((tenant) => tenant.key === 'yingtai').status, 'waiting_development');
    assert.equal(Object.hasOwn(status.config.fenbeitong.tenants[0], 'appKey'), false);
    assert.equal(Object.hasOwn(status.config.fenbeitong.tenants[0], 'accessToken'), false);
  } finally {
    restore();
  }
});

test('scheduler is explicit and can run one sync with mock replacement', async () => {
  const restore = forceMockFenbeitongEnv();
  try {
    resetRepository();
    stopSchedulerForTest();
    const initialStatus = getSchedulerStatus();
    assert.equal(initialStatus.enabled, false);
    assert.equal(initialStatus.running, false);

    const result = await runSchedulerOnce('contract-test');
    assert.equal(result.sync.batch.status, 'SUCCESS');
    assert.equal(result.sync.batch.mockReplacement, true);
    assert.equal(result.sync.records[0].processStage, 'SYNCED');
    assert.equal(getSchedulerStatus().runCount, 1);
  } finally {
    restore();
  }
});

test('mock Fenbeitong pull returns finance-sized sortable reimbursement ledger', async () => {
  const restore = forceMockFenbeitongEnv();
  try {
    const result = await pullFenbeitongReimbursements();
    assert.equal(result.mode, 'mock');
    assert.equal(result.mockReplacement, true);
    assert.equal(result.documents.length, 100);

    const sourceIds = result.documents.map((document) => document.data.reimb_id);
    const sourceCodes = result.documents.map((document) => document.data.reimb_code);
    const amounts = result.documents.map((document) => Number(document.data.total_amount));
    const times = result.documents.map((document) => document.data.create_time);

    assert.equal(new Set(sourceIds).size, 100);
    assert.equal(new Set(sourceCodes).size, 100);
    assert.ok(new Set(amounts).size > 20);
    assert.ok(new Set(times).size > 20);
  } finally {
    restore();
  }
});

test('real Fenbeitong mode fails fast when SQLite tenant is missing', () => {
  const previous = snapshotFenbeitongEnv();
  process.env.FENBEITONG_MODE = 'real';

  assert.throws(() => validateFenbeitongConfig(null), /FENBEITONG_TENANT/);

  restoreFenbeitongEnv(previous);
});

test('real Fenbeitong app-key mode requires SQLite app credentials', () => {
  const previous = snapshotFenbeitongEnv();
  process.env.FENBEITONG_MODE = 'real';
  const tenant = {
    key: 'puhui',
    name: '璞慧',
    status: 'ready',
    authMode: 'app-key',
    baseUrl: 'https://openapi.example.test',
    authPath: '/openapi/auth/getToken',
    pullPath: '/openapi/reimbursement/v1/list',
    detailPath: '/openapi/reimbursement/v2/detail',
    appId: '',
    appKey: ''
  };

  assert.throws(
    () => validateFenbeitongConfig(tenant),
    /tenant\.appId, tenant\.appKey/
  );

  restoreFenbeitongEnv(previous);
});

test('real Fenbeitong app-key mode obtains token from official getToken endpoint before reimbursement pull', async () => {
  const previousEnv = forceRealFenbeitongEnv('runtime-data/contract-token');
  const previousFetch = globalThis.fetch;
  const calls = [];
  seedPuhuiTenant();
  clearFenbeitongTokenCacheForTest();

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/openapi/auth/getToken')) {
      assert.equal(Object.hasOwn(options.headers, 'appId'), false);
      assert.equal(Object.hasOwn(options.headers, 'appKey'), false);
      assert.deepEqual(JSON.parse(options.body), {
        app_id: 'app-id-for-test',
        app_key: 'app-key-for-test'
      });
      return jsonResponse({ code: 0, data: 'issued-access-token' });
    }
    assert.equal(options.headers['access-token'], 'issued-access-token');
    if (String(url).endsWith('/openapi/reimbursement/v1/list')) {
      assert.deepEqual(JSON.parse(options.body), { page_index: 1, page_size: 20 });
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          reimbursements: [
            {
              id: 'REAL-REIMB-001',
              proposer_name: 'Real User',
              total_amount: '100.00'
            }
          ]
        }
      });
    }
    assert.deepEqual(JSON.parse(options.body), { reimb_code: 'REAL-REIMB-001' });
    return jsonResponse({
      code: 0,
      msg: 'success',
      data: {
        reimb_id: 'REAL-REIMB-001',
        reimb_code: 'REAL-REIMB-001',
        currency_code: 'CNY',
        total_amount: '100.00',
        payment_amount: '100.00',
        proposer_name: 'Real User',
        expenses: [
          {
            id: 'EXP-001',
            cost_category: { code: 'TRAVEL', name: 'Travel' },
            total_amount: '100.00',
            invoices: []
          }
        ]
      }
    });
  };

  const result = await pullFenbeitongReimbursements();

  assert.equal(result.mode, 'real');
  assert.equal(result.mockReplacement, false);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].data.reimb_id, 'REAL-REIMB-001');
  assert.equal(result.documents[0].data.reimb_code, 'REAL-REIMB-001');
  assert.equal(result.documents[0].data.proposer_name, 'Real User');
  assert.equal(calls.length, 3);

  globalThis.fetch = previousFetch;
  resetTenantStoreForTest();
  restoreFenbeitongEnv(previousEnv);
});

test('real Fenbeitong app-key mode pulls reimbursement detail after list summary', async () => {
  const previousEnv = forceRealFenbeitongEnv('runtime-data/contract-detail');
  const previousFetch = globalThis.fetch;
  const calls = [];
  seedPuhuiTenant();
  clearFenbeitongTokenCacheForTest();
  process.env.FENBEITONG_REIMBURSEMENT_APPLY_STATE = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAYMENT_STATE = '1';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_INDEX = '1';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_SIZE = '5';

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/openapi/auth/getToken')) {
      return jsonResponse({ code: 0, data: 'issued-access-token' });
    }
    if (String(url).endsWith('/openapi/reimbursement/v1/list')) {
      assert.deepEqual(JSON.parse(options.body), {
        page_index: 1,
        page_size: 5,
        payment_state: 1
      });
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          reimbursements: [
            {
              id: 'REAL-CODE-001',
              proposer_name: 'List User',
              total_amount: '100.00'
            }
          ]
        }
      });
    }
    assert.equal(options.headers['access-token'], 'issued-access-token');
    assert.deepEqual(JSON.parse(options.body), { reimb_code: 'REAL-CODE-001' });
    return jsonResponse({
      code: 0,
      msg: 'success',
      data: {
        reimb_id: 'REAL-ID-001',
        reimb_code: 'REAL-CODE-001',
        currency_code: 'CNY',
        total_amount: '100.00',
        payment_amount: '100.00',
        apply_reason: 'Real reimbursement',
        user: {
          code: 'PL0189',
          name: 'Real User',
          department_code: 'BM000330',
          department_name: 'East'
        },
        expenses: [
          {
            id: 'EXP-001',
            cost_category: { code: 'TRAVEL', name: 'Travel' },
            total_amount: '100.00',
            reason: 'Travel expense',
            invoices: []
          }
        ]
      }
    });
  };

  const result = await pullFenbeitongReimbursements();

  assert.equal(result.mode, 'real');
  assert.equal(result.mockReplacement, false);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].data.reimb_id, 'REAL-ID-001');
  assert.equal(result.documents[0].data.reimb_code, 'REAL-CODE-001');
  assert.equal(result.documents[0].data.expenses[0].cost_category.code, 'TRAVEL');
  assert.equal(calls.length, 3);

  globalThis.fetch = previousFetch;
  resetTenantStoreForTest();
  restoreFenbeitongEnv(previousEnv);
});

test('real Fenbeitong app-key mode reuses Puhui access token within two hours', async () => {
  const previousEnv = forceRealFenbeitongEnv('runtime-data/contract-cache');
  const previousFetch = globalThis.fetch;
  const calls = [];
  seedPuhuiTenant({ appId: 'puhui-app-id', appKey: 'puhui-app-key' });
  clearFenbeitongTokenCacheForTest();

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/openapi/auth/getToken')) {
      return jsonResponse({ code: 0, data: 'cached-access-token' });
    }
    if (String(url).endsWith('/openapi/reimbursement/v1/list')) {
      assert.equal(options.headers['access-token'], 'cached-access-token');
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: { reimbursements: [{ id: 'REAL-CODE-CACHE' }] }
      });
    }
    return jsonResponse({
      code: 0,
      msg: 'success',
      data: {
        reimb_id: 'REAL-ID-CACHE',
        reimb_code: 'REAL-CODE-CACHE',
        currency_code: 'CNY',
        total_amount: '100.00',
        payment_amount: '100.00',
        expenses: [
          {
            id: 'EXP-CACHE',
            cost_category: { code: 'TRAVEL', name: 'Travel' },
            total_amount: '100.00',
            invoices: []
          }
        ]
      }
    });
  };

  await pullFenbeitongReimbursements({ tenantKey: 'puhui' });
  await pullFenbeitongReimbursements({ tenantKey: 'puhui' });

  assert.equal(calls.filter((call) => call.url.endsWith('/openapi/auth/getToken')).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/openapi/reimbursement/v1/list')).length, 2);
  assert.equal(Date.parse(getFenbeitongTenant('puhui', { includeSecrets: true }).tokenExpiresAt) > Date.now(), true);

  globalThis.fetch = previousFetch;
  resetTenantStoreForTest();
  restoreFenbeitongEnv(previousEnv);
});

test('Yingtai tenant fails fast without falling back to Puhui credentials', async () => {
  const previousEnv = forceRealFenbeitongEnv('runtime-data/contract-yingtai');
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;
  seedPuhuiTenant({ appId: 'puhui-app-id', appKey: 'puhui-app-key' });
  globalThis.fetch = async () => {
    fetchCalled = true;
    return jsonResponse({ code: 0, data: 'should-not-be-used' });
  };

  await assert.rejects(
    () => pullFenbeitongReimbursements({ tenantKey: 'yingtai' }),
    /瑛泰接口等待开发中/
  );
  assert.equal(fetchCalled, false);

  globalThis.fetch = previousFetch;
  resetTenantStoreForTest();
  restoreFenbeitongEnv(previousEnv);
});

test('real Fenbeitong detail failure does not return mock reimbursement data', async () => {
  const previousEnv = forceRealFenbeitongEnv('runtime-data/contract-detail-failure');
  const previousFetch = globalThis.fetch;
  seedPuhuiTenant();
  clearFenbeitongTokenCacheForTest();

  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/openapi/auth/getToken')) {
      return jsonResponse({ code: 0, data: 'issued-access-token' });
    }
    if (String(url).endsWith('/openapi/reimbursement/v1/list')) {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: { reimbursements: [{ id: 'REAL-CODE-FAIL' }] }
      });
    }
    return jsonResponse({ code: -9999, msg: 'detail rejected' });
  };

  await assert.rejects(
    () => pullFenbeitongReimbursements(),
    /Fenbeitong response failed: code=-9999, msg=detail rejected/
  );

  globalThis.fetch = previousFetch;
  resetTenantStoreForTest();
  restoreFenbeitongEnv(previousEnv);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function snapshotFenbeitongEnv() {
  return {
    APP_DATA_DIR: process.env.APP_DATA_DIR,
    FENBEITONG_MODE: process.env.FENBEITONG_MODE,
    FENBEITONG_REIMBURSEMENT_APPLY_STATE: process.env.FENBEITONG_REIMBURSEMENT_APPLY_STATE,
    FENBEITONG_REIMBURSEMENT_PAYMENT_STATE: process.env.FENBEITONG_REIMBURSEMENT_PAYMENT_STATE,
    FENBEITONG_REIMBURSEMENT_PAGE_INDEX: process.env.FENBEITONG_REIMBURSEMENT_PAGE_INDEX,
    FENBEITONG_REIMBURSEMENT_PAGE_SIZE: process.env.FENBEITONG_REIMBURSEMENT_PAGE_SIZE
  };
}

function restoreFenbeitongEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    restoreEnv(name, value);
  }
}

function forceMockFenbeitongEnv() {
  const previous = {
    ...snapshotFenbeitongEnv(),
    KINGDEE_MODE: process.env.KINGDEE_MODE
  };
  process.env.APP_DATA_DIR = 'runtime-data/contract-mock';
  process.env.FENBEITONG_MODE = 'mock';
  process.env.FENBEITONG_REIMBURSEMENT_APPLY_STATE = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAYMENT_STATE = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_INDEX = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_SIZE = '';
  process.env.KINGDEE_MODE = 'mock';
  resetTenantStoreForTest();
  return () => {
    resetTenantStoreForTest();
    restoreFenbeitongEnv(previous);
  };
}

function forceRealFenbeitongEnv(dataDir) {
  const previous = snapshotFenbeitongEnv();
  process.env.APP_DATA_DIR = dataDir;
  process.env.FENBEITONG_MODE = 'real';
  process.env.FENBEITONG_REIMBURSEMENT_APPLY_STATE = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAYMENT_STATE = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_INDEX = '';
  process.env.FENBEITONG_REIMBURSEMENT_PAGE_SIZE = '';
  resetTenantStoreForTest();
  return previous;
}

function seedPuhuiTenant(overrides = {}) {
  saveFenbeitongTenantCredentials({
    key: 'puhui',
    name: '璞慧',
    status: 'ready',
    authMode: 'app-key',
    baseUrl: 'https://openapi.example.test',
    authPath: '/openapi/auth/getToken',
    pullPath: '/openapi/reimbursement/v1/list',
    detailPath: '/openapi/reimbursement/v2/detail',
    appId: 'app-id-for-test',
    appKey: 'app-key-for-test',
    refreshIntervalSeconds: 7200,
    listPayload: { page_index: 1, page_size: 20 },
    ...overrides
  });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
