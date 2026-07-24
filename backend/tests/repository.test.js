import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildExpenseReimbursementPreview } from '../src/expense-reimbursement-mapper.js';

const buildVoucherPreview = ({ voucherDate, ...input }) => buildExpenseReimbursementPreview({
  ...input,
  documentDate: voucherDate
});
import {
  findPreparedRecord,
  findSyncedDocument,
  clearStateCacheForTest,
  getIntegrationSelection,
  getIntegrationSettings,
  getKingdeeAccountSelection,
  getKingdeeAcctIdSelection,
  getDashboardSummary,
  listFenbeitongRequesterCatalog,
  listSyncedDocuments,
  listOperationLogs,
  listProcessRecords,
  isRealPushedRecord,
  hasFenbeitongPaymentTime,
  markPushedToErp,
  recordOperation,
  resetRepository,
  restoreErpPushAfterRetryFailure,
  saveFenbeitongRequesterCatalog,
  savePreparedRecord,
  saveIntegrationSelection,
  saveSyncedDocument,
  saveSyncedDocuments
} from '../src/repository.js';

test('a source without a prepared record is not treated as pushed to ERP', () => {
  assert.equal(isRealPushedRecord(null), false);
  assert.equal(isRealPushedRecord(undefined), false);
});

const previousAppDataDir = process.env.APP_DATA_DIR;
const previousFenbeitongMode = process.env.FENBEITONG_MODE;
const previousKingdeeEnv = {
  KINGDEE_ACCT_ID: process.env.KINGDEE_ACCT_ID,
  KINGDEE_ACCT_ID_KEY: process.env.KINGDEE_ACCT_ID_KEY,
  KINGDEE_ACCT_ID_LABEL: process.env.KINGDEE_ACCT_ID_LABEL,
  KINGDEE_USERNAME: process.env.KINGDEE_USERNAME,
  KINGDEE_PASSWORD: process.env.KINGDEE_PASSWORD,
  KINGDEE_ACCOUNT_CURRENT_LABEL: process.env.KINGDEE_ACCOUNT_CURRENT_LABEL,
  KINGDEE_ACCOUNT_JIAZEYU_ENABLED: process.env.KINGDEE_ACCOUNT_JIAZEYU_ENABLED,
  KINGDEE_ACCOUNT_JIAZEYU_LABEL: process.env.KINGDEE_ACCOUNT_JIAZEYU_LABEL,
  KINGDEE_ACCOUNT_JIAZEYU_USERNAME: process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME,
  KINGDEE_ACCOUNT_JIAZEYU_PASSWORD: process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD
};

before(() => {
  process.env.APP_DATA_DIR = 'runtime-data/backend-repository-test';
  process.env.FENBEITONG_MODE = 'mock';
  process.env.KINGDEE_ACCT_ID = '6977227150362f';
  process.env.KINGDEE_ACCT_ID_KEY = 'puhui-6977227150362f';
  process.env.KINGDEE_ACCT_ID_LABEL = 'Puhui 6977227150362f';
  process.env.KINGDEE_USERNAME = 'int-user';
  process.env.KINGDEE_PASSWORD = 'test-password';
  process.env.KINGDEE_ACCOUNT_CURRENT_LABEL = 'int';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_ENABLED = 'true';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_LABEL = 'Jia Zeyu';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME = 'jia-user';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD = 'test-password';
  resetRepository();
});

after(() => {
  resetRepository();
  if (previousAppDataDir === undefined) {
    delete process.env.APP_DATA_DIR;
  } else {
    process.env.APP_DATA_DIR = previousAppDataDir;
  }
  if (previousFenbeitongMode === undefined) {
    delete process.env.FENBEITONG_MODE;
  } else {
    process.env.FENBEITONG_MODE = previousFenbeitongMode;
  }
  for (const [name, value] of Object.entries(previousKingdeeEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test('prepare stores a local prepared record without ERP identifiers', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  const record = savePreparedRecord(preview);
  assert.equal(record.processStatus, 15);
  assert.equal(record.processStage, 'EXPENSE_REIMBURSEMENT_PREPARED');
  assert.equal(record.erpDocumentStatus, 'Z');
  assert.equal(record.erpFid, undefined);
  assert.ok(findPreparedRecord('MOCK-REIMB-001'));
});

test('one monthly prepared record is associated with every source order', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  preview.sourceId = 'ONLINE-MONTH:puhui:X001:202607';
  preview.sourceIds = ['ORDER-SOURCE-1', 'ORDER-SOURCE-2'];
  preview.sourceCode = 'FBT202607X001';

  const record = savePreparedRecord(preview);
  assert.deepEqual(record.sourceIds, ['ORDER-SOURCE-1', 'ORDER-SOURCE-2']);
  assert.equal(findPreparedRecord('ORDER-SOURCE-1').sourceId, preview.sourceId);
  assert.equal(findPreparedRecord('ORDER-SOURCE-2').sourceId, preview.sourceId);
});

test('sync stores a Fenbeitong source record before ERP push', () => {
  resetRepository();
  const template = buildMockTemplate();
  const synced = saveSyncedDocument(JSON.parse(template.mockFixedJson));

  assert.equal(synced.processStatus, 10);
  assert.equal(synced.processStage, 'SYNCED');
  assert.equal(synced.sourceCode, 'MOCK-BX-001');
  assert.equal(synced.paymentDate, '2026-07-11');
  assert.equal(synced.totalAmount, 228);
  assert.equal(synced.splitTaxAmount, 6.11);
  assert.equal(synced.splitExcludingTaxAmount, 221.89);
  assert.equal(synced.departmentAttributionAmount, 228);
  assert.equal(synced.requesterName, '吴立珠');
  assert.equal(synced.expenseTypes, 'Travel / Office');
  assert.equal(synced.startLocation, '');
  assert.equal(synced.arrivalLocation, '');
  assert.equal(synced.trafficType, '');
  assert.equal(synced.purpose, 'Mock travel expense / Mock office expense');
  assert.equal(findSyncedDocument('MOCK-REIMB-001').sourceCode, 'MOCK-BX-001');
  assert.equal(findPreparedRecord('MOCK-REIMB-001'), null);
});

test('sync stores the five ERP detail columns for an online bill', () => {
  resetRepository();
  const document = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  const synced = saveSyncedDocument(document);

  assert.equal(synced.startLocation, '上海市');
  assert.equal(synced.arrivalLocation, '苏州市');
  assert.equal(synced.trafficType, '用车');
  assert.equal(synced.purpose, '商务洽谈');
  assert.equal(synced.expenseDepartment, '技术部');
});

test('sync maps Fenbeitong payment, amount, submitter, expense type, and reimbursement number', () => {
  resetRepository();
  const document = JSON.parse(buildMockTemplate().mockFixedJson);
  document.data.reimb_code = 'FBT-REIMB-20260717';
  document.data.payment_time = '2026/07/16 18:20:30';
  document.data.total_amount = '228.00';
  document.data.payment_amount = '999.00';
  document.data.expenses[0].cost_attributions = [{
    type: 1,
    details: [{ amount: 66.38 }]
  }];
  document.data.expenses[1].cost_attributions = [{
    type: 1,
    details: [{ amount: 120 }]
  }];
  document.data.submitter = {
    code: 'SUBMIT-001',
    name: '提交人甲',
    department_code: 'DEPT-001',
    department_name: '财务部'
  };
  document.data.user = { code: 'OTHER', name: '不应采用' };
  document.data.expenses[0].cost_category = { code: 'TRAVEL', name: '差旅费' };
  document.data.expenses[1].cost_category = { code: 'OFFICE', name: '办公费' };

  const synced = saveSyncedDocument(document);

  assert.equal(synced.sourceCode, 'FBT-REIMB-20260717');
  assert.equal(synced.paymentDate, '2026-07-11');
  assert.equal(synced.totalAmount, 228);
  assert.equal(synced.splitTaxAmount, 6.11);
  assert.equal(synced.splitExcludingTaxAmount, 221.89);
  assert.equal(synced.departmentAttributionAmount, 186.38);
  assert.equal(synced.requesterName, '提交人甲');
  assert.equal(synced.requesterCode, 'SUBMIT-001');
  assert.equal(synced.departmentName, '财务部');
  assert.equal(synced.expenseTypes, '差旅费 / 办公费');
});

test('real Fenbeitong mode hides previously synchronized mock documents', () => {
  resetRepository();
  saveSyncedDocument(JSON.parse(buildMockTemplate().mockFixedJson), '', { sourceMode: 'mock' });
  process.env.FENBEITONG_MODE = 'real';
  try {
    assert.equal(listSyncedDocuments().length, 0);
    assert.equal(getDashboardSummary().counts.syncedDocuments, 0);
  } finally {
    process.env.FENBEITONG_MODE = 'mock';
  }
});

test('real Fenbeitong mode hides online documents not verified as settlement bill detail', () => {
  resetRepository();
  const unverified = {
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      group_id: 'LEGACY-ONLINE-ID',
      group_bill_no: 'LEGACY-ONLINE-CODE',
      bill_no: 'BILL-202606',
      settlement_month: '2026-06',
      order: {
        order_id: 'ORDER-LEGACY-1',
        order_category: 3,
        order_create_time: '2026-06-01 08:00:00',
        employee_name: '测试人员',
        business_line_name: '用车',
        repayment_total_amount: 100,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: 100
      }
    }
  };
  saveSyncedDocument(unverified, '', { sourceMode: 'real' });

  const verified = structuredClone(unverified);
  verified.data.group_id = 'SETTLEMENT-ONLINE-ID';
  verified.data.group_bill_no = 'SETTLEMENT-ONLINE-CODE';
  verified.data.source_origin = 'SETTLEMENT_POSTING';
  verified.data.source_contract = 'SETTLEMENT_BILL_DETAIL_V2';
  verified.data.bill_cycle = '2026/06/01-2026/06/30';
  verified.data.bill_state = 4;
  saveSyncedDocument(verified, '', { sourceMode: 'real' });

  const unissued = structuredClone(verified);
  unissued.data.group_id = 'UNISSUED-ONLINE-ID';
  unissued.data.group_bill_no = 'UNISSUED-ONLINE-CODE';
  unissued.data.bill_state = 5;
  saveSyncedDocument(unissued, '', { sourceMode: 'real' });

  const emptyBusinessLine = structuredClone(verified);
  emptyBusinessLine.data.group_id = 'EMPTY-LINE-ONLINE-ID';
  emptyBusinessLine.data.group_bill_no = 'EMPTY-LINE-ONLINE-CODE';
  emptyBusinessLine.data.order.business_line_name = '';
  saveSyncedDocument(emptyBusinessLine, '', { sourceMode: 'real' });

  process.env.FENBEITONG_MODE = 'real';
  try {
    assert.equal(findSyncedDocument('LEGACY-ONLINE-ID'), null);
    assert.equal(findSyncedDocument('UNISSUED-ONLINE-ID'), null);
    assert.equal(findSyncedDocument('EMPTY-LINE-ONLINE-ID'), null);
    assert.deepEqual(
      listSyncedDocuments().map((record) => record.sourceId),
      ['SETTLEMENT-ONLINE-ID']
    );
  } finally {
    process.env.FENBEITONG_MODE = 'mock';
  }
});

test('real full sync removes every stale online row not returned by issued bills', () => {
  resetRepository();
  const onlineDocument = (id, billNumber, orderId, amount) => ({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      source_origin: 'SETTLEMENT_POSTING',
      source_contract: 'BUSINESS_BILL_LIST_AND_DETAIL',
      group_id: id,
      group_bill_no: billNumber,
      bill_no: billNumber,
      bill_cycle: '2026/06/01-2026/06/30',
      bill_state: 4,
      settlement_month: '202606',
      order: {
        order_id: orderId,
        order_category: 3,
        order_create_time: '2026-06-01 08:00:00',
        employee_name: '测试人员',
        business_line_name: '用车',
        repayment_total_amount: amount,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: amount
      }
    }
  });
  const options = { sourceMode: 'real', tenantKey: 'puhui' };
  saveSyncedDocuments([
    onlineDocument('OLD-CURRENT-BILL', 'BILL-CURRENT', 'ORDER-OLD', 10),
    onlineDocument('OTHER-BILL', 'BILL-OTHER', 'ORDER-OTHER', 20)
  ], 'BATCH-1', options);

  saveSyncedDocuments([
    onlineDocument('NEW-CURRENT-BILL', 'BILL-CURRENT', 'ORDER-NEW', 30)
  ], 'BATCH-2', options);

  assert.equal(findSyncedDocument('OLD-CURRENT-BILL'), null);
  assert.equal(findSyncedDocument('NEW-CURRENT-BILL').reimbursementAmount, 30);
  assert.equal(findSyncedDocument('OTHER-BILL'), null);
});

test('real full sync removes stale offline rows that no longer pass source filters', () => {
  resetRepository();
  const offlineDocument = (id, code) => {
    const document = JSON.parse(buildMockTemplate().mockFixedJson);
    document.data.reimb_id = id;
    document.data.reimb_code = code;
    document.data.apply_state = 4;
    return document;
  };
  const options = { sourceMode: 'real', tenantKey: 'puhui' };

  saveSyncedDocuments([
    offlineDocument('OFFLINE-KEEP', 'OFFLINE-KEEP-CODE'),
    offlineDocument('OFFLINE-STALE', 'OFFLINE-STALE-CODE')
  ], 'BATCH-1', options);

  saveSyncedDocuments([
    offlineDocument('OFFLINE-KEEP', 'OFFLINE-KEEP-CODE')
  ], 'BATCH-2', options);

  assert.equal(findSyncedDocument('OFFLINE-STALE'), null);
  assert.equal(findSyncedDocument('OFFLINE-KEEP').sourceCode, 'OFFLINE-KEEP-CODE');
});

test('requester catalog keeps the complete employee reimbursement proposer list', () => {
  resetRepository();

  saveFenbeitongRequesterCatalog([
    { name: 'Employee C', code: 'C' },
    { name: 'Employee A', code: 'A' },
    { name: 'Employee B', code: 'B' },
    { name: 'Employee A', code: 'DUPLICATE' }
  ], 'puhui');

  assert.deepEqual(listFenbeitongRequesterCatalog('puhui'), [
    { name: 'Employee A', code: 'A' },
    { name: 'Employee B', code: 'B' },
    { name: 'Employee C', code: 'C' }
  ]);
});

test('sync accepts real Fenbeitong order-only reimbursement fields', () => {
  resetRepository();
  const document = JSON.parse(buildMockTemplate().mockFixedJson);
  document.data.reimb_id = 'REAL-ORDER-ONLY-ID';
  document.data.reimb_code = 'REAL-ORDER-ONLY-CODE';
  document.data.payment_time = '2026-07-16 11:46:26';
  document.data.expenses = [];
  document.data.orders = [{ id: 'ORDER-1', type: '3' }];

  const synced = saveSyncedDocument(document, '', { sourceMode: 'real' });

  assert.equal(synced.paymentDate, '2026-07-11');
  assert.equal(synced.expenseTypes, '订单费用');
  assert.equal(synced.sourceCode, 'REAL-ORDER-ONLY-CODE');
});

test('real sync uses submit date and accepts reimbursement without payment_time', () => {
  resetRepository();
  const document = JSON.parse(buildMockTemplate().mockFixedJson);
  document.data.reimb_id = 'REAL-UNPAID-ID';
  document.data.reimb_code = 'REAL-UNPAID-CODE';
  document.data.reimburse_time = '2026-07-16 11:46:26';
  delete document.data.payment_time;

  assert.equal(hasFenbeitongPaymentTime(document), false);
  const synced = saveSyncedDocument(document, '', { sourceMode: 'real' });
  assert.equal(synced.paymentDate, '2026-07-11');
  assert.equal(findSyncedDocument('REAL-UNPAID-ID').sourceCode, 'REAL-UNPAID-CODE');
});

test('sync keeps real reimbursement even when detail has no expense lines', () => {
  resetRepository();
  const document = JSON.parse(buildMockTemplate().mockFixedJson);
  document.data.reimb_id = 'REAL-NO-LINES-ID';
  document.data.reimb_code = 'REAL-NO-LINES-CODE';
  document.data.expenses = [];
  document.data.orders = [];

  const synced = saveSyncedDocument(document, '', { sourceMode: 'real' });

  assert.equal(synced.expenseTypes, '');
  assert.equal(synced.totalAmount, 228);
});

test('ERP push marks prepared record with real ERP identifiers', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
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
  assert.equal(pushed.processStage, 'ERP_EXPENSE_REIMBURSEMENT_SAVED');
  assert.equal(pushed.erpFid, '100033');
  assert.equal(pushed.simulatedErp, false);
  assert.equal(pushed.erpMode, 'real');
});

test('ERP push rejects simulated Kingdee save results', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
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
    voucherDate: template.mockDocumentDate,
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
  }), /already saved to ERP/);
});

test('repeated ERP confirmation with the same FID and number is idempotent', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
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

  const replay = markPushedToErp('MOCK-REIMB-001', {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '100033',
    erpNumber: '23',
    documentStatus: 'Z'
  });

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.erpFid, '100033');
  assert.equal(replay.erpNumber, '23');
});

test('failed forced regeneration restores the previous ERP voucher', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
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
    documentStatus: 'A'
  });

  const retry = savePreparedRecord(preview, { forceRetry: true });
  assert.equal(retry.erpFid, '');
  assert.equal(retry.previousErpPushes.at(-1).erpFid, '100033');

  const restored = restoreErpPushAfterRetryFailure('MOCK-REIMB-001', pushed, {
    code: 'KINGDEE_SAVE_FAILED',
    message: 'retry rejected'
  });
  assert.equal(restored.processStage, 'ERP_EXPENSE_REIMBURSEMENT_SAVED');
  assert.equal(restored.erpFid, '100033');
  assert.equal(restored.lastErpRetryErrorCode, 'KINGDEE_SAVE_FAILED');
});

test('monthly save replaces one earlier per-order process record without leaving a duplicate', () => {
  resetRepository();
  const template = buildMockTemplate();
  const oldPreview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
    config: template
  });
  oldPreview.sourceId = 'ORDER-SOURCE-1';
  oldPreview.sourceIds = ['ORDER-SOURCE-1'];
  savePreparedRecord(oldPreview);
  const oldSaved = markPushedToErp('ORDER-SOURCE-1', {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '127392',
    erpNumber: '0013808500000000',
    documentStatus: 'Z'
  });

  const monthlyPreview = {
    ...oldPreview,
    sourceId: 'ONLINE-MONTH:puhui:X001:202607',
    sourceIds: ['ORDER-SOURCE-1', 'ORDER-SOURCE-2'],
    sourceCode: 'FBT202607X001'
  };
  savePreparedRecord(monthlyPreview, { forceRetry: true, previousRecord: oldSaved });
  const monthlySaved = markPushedToErp(monthlyPreview.sourceId, {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    erpFid: '127392',
    erpNumber: 'FBT202607X001',
    documentStatus: 'Z'
  }, { replacesSourceId: oldSaved.sourceId });

  assert.equal(listProcessRecords().length, 1);
  assert.equal(monthlySaved.sourceId, monthlyPreview.sourceId);
  assert.equal(findPreparedRecord('ORDER-SOURCE-1').sourceId, monthlyPreview.sourceId);
  assert.equal(findPreparedRecord('ORDER-SOURCE-2').sourceId, monthlyPreview.sourceId);
});

test('local repository persists dashboard state and operation logs', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockDocumentDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });
  saveSyncedDocument(JSON.parse(template.mockFixedJson), 'BATCH-TEST');
  savePreparedRecord(preview);

  const summary = getDashboardSummary();
  assert.equal(summary.counts.syncedDocuments, 1);
  assert.equal(summary.counts.preparedExpenseReimbursements, 1);
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

test('integration selections persist tenant and acctID with ERP creator locked to int', () => {
  resetRepository();

  const saved = saveIntegrationSelection({
    tenantKey: 'yingtai',
    kingdeeAccountKey: 'current',
    kingdeeAcctIdKey: 'puhui-6977227150362f'
  });
  clearStateCacheForTest();

  assert.deepEqual(getIntegrationSelection(), {
    tenantKey: 'yingtai',
    kingdeeAccountKey: 'current',
    kingdeeAcctIdKey: 'puhui-6977227150362f',
    updatedAt: saved.updatedAt
  });
  assert.equal(getKingdeeAccountSelection(), 'current');
  assert.equal(getKingdeeAcctIdSelection(), 'puhui-6977227150362f');

  const settings = getIntegrationSettings();
  assert.equal(settings.selection.tenantKey, 'yingtai');
  assert.equal(settings.selection.kingdeeAccountKey, 'current');
  assert.equal(settings.selection.kingdeeAcctIdKey, 'puhui-6977227150362f');
  assert.equal(settings.tenants.some((tenant) => tenant.key === 'puhui'), true);
  assert.equal(settings.kingdeeAccounts.some((account) => account.key === 'jia-zeyu'), true);
  assert.equal(settings.kingdeeAcctIds.some((acctId) => acctId.key === 'puhui-6977227150362f'), true);
  assert.equal(JSON.stringify(settings).includes('test-password'), false);
});

test('invalid integration selection is rejected without modifying previous settings', () => {
  resetRepository();
  const before = getIntegrationSelection();

  assert.throws(
    () => saveIntegrationSelection({
      tenantKey: 'missing-tenant',
      kingdeeAccountKey: 'current',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    }),
    /Fenbeitong tenant missing-tenant is not configured/
  );
  assert.deepEqual(getIntegrationSelection(), before);

  assert.throws(
    () => saveIntegrationSelection({
      tenantKey: 'puhui',
      kingdeeAccountKey: 'jia-zeyu',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    }),
    /Kingdee expense reimbursement integration is restricted to int/
  );
  assert.deepEqual(getIntegrationSelection(), before);

  assert.throws(
    () => saveIntegrationSelection({
      tenantKey: 'puhui',
      kingdeeAccountKey: 'missing-account',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    }),
    /Kingdee expense reimbursement integration is restricted to int/
  );
  assert.deepEqual(getIntegrationSelection(), before);

  assert.throws(
    () => saveIntegrationSelection({
      tenantKey: 'puhui',
      kingdeeAccountKey: 'current',
      kingdeeAcctIdKey: 'missing-acct-id'
    }),
    /Kingdee acctID missing-acct-id is not configured/
  );
  assert.deepEqual(getIntegrationSelection(), before);
});
