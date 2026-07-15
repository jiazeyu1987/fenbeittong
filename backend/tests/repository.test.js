import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildVoucherPreview } from '../src/voucher-mapper.js';
import {
  findPreparedRecord,
  findSyncedDocument,
  clearStateCacheForTest,
  getDashboardSummary,
  listOperationLogs,
  listProcessRecords,
  markPushedToErp,
  recordOperation,
  resetRepository,
  savePreparedRecord,
  saveSyncedDocument
} from '../src/repository.js';

const previousAppDataDir = process.env.APP_DATA_DIR;

before(() => {
  process.env.APP_DATA_DIR = 'runtime-data/backend-repository-test';
  resetRepository();
});

after(() => {
  resetRepository();
  if (previousAppDataDir === undefined) {
    delete process.env.APP_DATA_DIR;
  } else {
    process.env.APP_DATA_DIR = previousAppDataDir;
  }
});

test('prepare stores a local prepared record without ERP identifiers', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  const record = savePreparedRecord(preview);
  assert.equal(record.processStatus, 15);
  assert.equal(record.processStage, 'PREPARED');
  assert.equal(record.erpDocumentStatus, 'Z');
  assert.equal(record.erpFid, undefined);
  assert.ok(findPreparedRecord('MOCK-REIMB-001'));
});

test('sync stores a Fenbeitong source record before ERP push', () => {
  resetRepository();
  const template = buildMockTemplate();
  const synced = saveSyncedDocument(JSON.parse(template.mockFixedJson));

  assert.equal(synced.processStatus, 10);
  assert.equal(synced.processStage, 'SYNCED');
  assert.equal(findSyncedDocument('MOCK-REIMB-001').sourceCode, 'MOCK-BX-001');
  assert.equal(findPreparedRecord('MOCK-REIMB-001'), null);
});

test('ERP push marks prepared record with real ERP identifiers', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  savePreparedRecord(preview);

  const pushed = markPushedToErp('MOCK-REIMB-001', {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '100033',
    erpNumber: '23',
    documentStatus: 'Z'
  });

  assert.equal(pushed.processStatus, 30);
  assert.equal(pushed.processStage, 'ERP_PUSHED');
  assert.equal(pushed.erpFid, '100033');
  assert.equal(pushed.simulatedErp, false);
  assert.equal(pushed.erpMode, 'real');
});

test('ERP push rejects simulated Kingdee save results', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  savePreparedRecord(preview);

  assert.throws(() => markPushedToErp('MOCK-REIMB-001', {
    simulated: true,
    mode: 'mock',
    mockReplacement: true,
    erpFid: 'MOCK-KINGDEE-FID',
    erpNumber: 'MOCK-KINGDEE-NUMBER',
    documentStatus: 'Z'
  }), /real Kingdee save result is required/);
});

test('duplicate ERP push for the same source is blocked', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  savePreparedRecord(preview);
  markPushedToErp('MOCK-REIMB-001', {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '100033',
    erpNumber: '23',
    documentStatus: 'Z'
  });

  assert.throws(() => markPushedToErp('MOCK-REIMB-001', {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '100034',
    erpNumber: '24',
    documentStatus: 'Z'
  }), /already pushed to ERP/);
});

test('local repository persists dashboard state and operation logs', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  saveSyncedDocument(JSON.parse(template.mockFixedJson), 'BATCH-TEST');
  savePreparedRecord(preview);

  const summary = getDashboardSummary();
  assert.equal(summary.counts.syncedDocuments, 1);
  assert.equal(summary.counts.preparedVouchers, 1);
  assert.equal(listProcessRecords().length, 1);
  assert.ok(listOperationLogs().some((log) => log.action === 'SOURCE_SYNC'));
});

test('local repository reloads persisted state after cache reset', () => {
  resetRepository();
  const template = buildMockTemplate();
  saveSyncedDocument(JSON.parse(template.mockFixedJson), 'BATCH-PERSIST', {
    sourceMode: 'mock',
    mockReplacement: true,
    mockReason: 'test mock data'
  });

  clearStateCacheForTest();
  assert.equal(findSyncedDocument('MOCK-REIMB-001').sourceCode, 'MOCK-BX-001');
  assert.equal(getDashboardSummary().counts.syncedDocuments, 1);
});

test('operation logs redact secret-like detail fields', () => {
  resetRepository();
  const secret = ['should', 'not', 'be', 'visible'].join('-');
  recordOperation('SECURITY_TEST', 'SUCCESS', {
    accessToken: secret,
    nested: { password: secret },
    safeField: 'visible'
  });

  const log = listOperationLogs()[0];
  assert.equal(log.detail.accessToken, '[REDACTED]');
  assert.equal(log.detail.nested.password, '[REDACTED]');
  assert.equal(log.detail.safeField, 'visible');
});
