import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../../backend/src/mock-template.js';
import { buildVoucherPreview } from '../../backend/src/voucher-mapper.js';
import { getSystemStatus } from '../../backend/src/services/system-status.js';
import { resetRepository } from '../../backend/src/repository.js';
import { validateFenbeitongConfig } from '../../backend/src/config.js';
import { pullFenbeitongReimbursements } from '../../backend/src/adapters/fenbeitong-client.js';
import { getSchedulerStatus, runSchedulerOnce, stopSchedulerForTest } from '../../backend/src/services/scheduler.js';

test('mock template contains required fields and no real token', () => {
  const template = buildMockTemplate();
  assert.equal(template.accountBookNumber, '011');
  assert.equal(template.voucherGroupNumber, 'PZZ8');
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
  assert.equal(preview.taxSummary.deductibleTaxAmount, 6.11);
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

  assert.ok(Object.hasOwn(preview.payload.Model, 'FAccountBookID'));
  assert.ok(Object.hasOwn(preview.payload.Model, 'FVOUCHERGROUPID'));
  assert.ok(Object.hasOwn(preview.payload.Model, 'FEntity'));
  assert.equal(Object.hasOwn(preview.payload.Model, 'reimb_id'), false);
  assert.equal(Object.hasOwn(preview.payload.Model.FEntity[0], 'cost_category'), false);
});

test('system status exposes mode and readiness for formal workflow', () => {
  resetRepository();
  const status = getSystemStatus();
  assert.equal(status.mode.fenbeitong, 'mock');
  assert.equal(status.mode.kingdee, 'mock');
  assert.equal(status.readiness.fenbeitong.ready, true);
  assert.equal(status.readiness.kingdee.ready, true);
  assert.equal(status.scheduler.enabled, false);
  assert.equal(status.scheduler.autoPushErp, false);
  assert.ok(Object.hasOwn(status.summary.counts, 'syncedDocuments'));
  assert.ok(Object.hasOwn(status.summary.counts, 'operationLogs'));
  assert.equal(status.config.fenbeitong.accessTokenConfigured, false);
});

test('scheduler is explicit and can run one sync with mock replacement', async () => {
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
});

test('mock Fenbeitong pull returns finance-sized sortable reimbursement ledger', async () => {
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
});

test('real Fenbeitong mode fails fast when required config is missing', () => {
  const previousMode = process.env.FENBEITONG_MODE;
  const previousUrl = process.env.FENBEITONG_BASE_URL;
  const previousToken = process.env.FENBEITONG_ACCESS_TOKEN;
  process.env.FENBEITONG_MODE = 'real';
  process.env.FENBEITONG_BASE_URL = '';
  process.env.FENBEITONG_ACCESS_TOKEN = '';

  assert.throws(() => validateFenbeitongConfig(), /FENBEITONG_BASE_URL/);

  restoreEnv('FENBEITONG_MODE', previousMode);
  restoreEnv('FENBEITONG_BASE_URL', previousUrl);
  restoreEnv('FENBEITONG_ACCESS_TOKEN', previousToken);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
