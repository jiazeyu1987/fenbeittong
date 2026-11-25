import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadLocalEnv } from '../src/config.js';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildExpenseReimbursementPreview } from '../src/expense-reimbursement-mapper.js';
import {
  clearStateCacheForTest,
  findSyncedDocument,
  markPushedToErp,
  savePreparedRecord,
  saveSyncedDocument
} from '../src/repository.js';
import { matchPaymentBills, previewPaymentStatusSync, syncPaymentStatuses } from '../src/services/payment-status-sync.js';
import { resetTenantStoreForTest, saveFenbeitongTenantCredentials } from '../src/tenant-store.js';

test('matches a payment bill only by exact employee, amount and forward date', () => {
  const [result] = matchPaymentBills([
    processRecord({ sourceCode: 'B1IELSHBX26052500001', employeeNumber: 'X002', amount: 1577, date: '2026-05-25' })
  ], [
    paymentBill({ id: '1', billNumber: 'FKD001', employeeNumber: 'X002', amount: 1577, date: '2026-06-05' }),
    paymentBill({ id: '2', billNumber: 'FKD002', employeeNumber: 'X003', amount: 1577, date: '2026-06-05' }),
    paymentBill({ id: '3', billNumber: 'FKD003', employeeNumber: 'X002', amount: 1576.99, date: '2026-06-05' }),
    paymentBill({ id: '4', billNumber: 'FKD004', employeeNumber: 'X002', amount: 1577, date: '2026-05-24' })
  ]);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.erpPaymentBillNumber, 'FKD001');
  assert.equal(result.erpPaymentDate, '2026-06-05 10:15:30');
  assert.equal(result.erpPaymentBillType, '费用报销付款单');
  assert.equal(result.erpBankProcessingStatus, '银行交易成功');
});

test('does not update when more than one ERP payment bill can match', () => {
  const record = processRecord({ employeeNumber: 'X012', amount: 100, date: '2026-06-01' });
  const results = matchPaymentBills([record], [
    paymentBill({ id: '1', billNumber: 'FKD001', employeeNumber: 'X012', amount: 100, date: '2026-06-05' }),
    paymentBill({ id: '2', billNumber: 'FKD002', employeeNumber: 'X012', amount: 100, date: '2026-06-06' })
  ]);
  assert.equal(results[0].status, 'AMBIGUOUS_ERP_PAYMENT_MATCH');
  assert.deepEqual(results[0].candidatePaymentBillNumbers, ['FKD001', 'FKD002']);
});

test('prefers an explicit source number over an amount-only candidate', () => {
  const record = processRecord({
    sourceCode: 'B1IELSHBX26070100002',
    employeeNumber: 'X012',
    amount: 100,
    date: '2026-07-01'
  });
  const results = matchPaymentBills([record], [
    paymentBill({ id: '1', billNumber: 'FKD001', employeeNumber: 'X012', amount: 100, date: '2026-07-02' }),
    paymentBill({ id: '2', billNumber: 'FKD002', employeeNumber: 'X099', amount: 999, date: '2026-07-02', sourceBillNumber: record.sourceCode })
  ]);
  assert.equal(results[0].status, 'MATCHED');
  assert.equal(results[0].erpPaymentBillNumber, 'FKD002');
});

test('reserves explicit ERP payment associations and rejects shared fallback matches', () => {
  const first = processRecord({ sourceCode: 'REIMB-001', employeeNumber: 'X012', amount: 100, date: '2026-06-01' });
  const second = processRecord({ sourceCode: 'REIMB-0010', employeeNumber: 'X012', amount: 100, date: '2026-06-02' });
  const bill = paymentBill({ id: '1', billNumber: 'FKD001', employeeNumber: 'X012', amount: 100, date: '2026-06-05' });
  const states = (records, payment) => matchPaymentBills(records, [payment]).map((result) => result.status);

  assert.deepEqual(states([first, second], { ...bill, sourceBillNumber: second.sourceCode }), ['NO_ERP_PAYMENT_MATCH', 'MATCHED']);
  assert.deepEqual(states([first], { ...bill, sourceBillNumber: 'EXTERNAL-001' }), ['NO_ERP_PAYMENT_MATCH']);
  assert.deepEqual(states([first, second], bill), ['AMBIGUOUS_ERP_PAYMENT_MATCH', 'AMBIGUOUS_ERP_PAYMENT_MATCH']);
  assert.deepEqual(states([first, second], {
    ...bill, sourceBillNumber: first.sourceCode, entries: [{ sourceBillNumber: second.sourceCode }]
  }), ['AMBIGUOUS_ERP_PAYMENT_MATCH', 'AMBIGUOUS_ERP_PAYMENT_MATCH']);
});

test('reads the bill payment organization and stores ERP payment details before Fenbeitong access', async () => {
  loadLocalEnv();
  const dataDir = mkdtempSync(join(tmpdir(), 'fenbeitong-payment-sync-'));
  const env = {
    APP_DATA_DIR: dataDir, FENBEITONG_MODE: 'mock', KINGDEE_MODE: 'real',
    KINGDEE_BASE_URL: 'http://kingdee.test', KINGDEE_ACCT_ID: 'test-account',
    KINGDEE_USERNAME: 'test-user', KINGDEE_PASSWORD: 'test-password',
    PAYMENT_STATUS_SYNC_ORG_NUMBER: ''
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  let bankStatus = 'A';
  const paymentDate = '2026-11-06';
  let transactionTime = '';
  Object.assign(process.env, env);
  clearStateCacheForTest();
  try {
    const config = buildMockTemplate();
    saveSyncedDocument(JSON.parse(config.mockFixedJson));
    const preview = buildExpenseReimbursementPreview({ config, fixedJson: config.mockFixedJson });
    preview.payload.Model.FPayOrgId = { FNumber: '901' };
    savePreparedRecord(preview);
    markPushedToErp(preview.sourceId, {
      mode: 'real', simulated: false, mockReplacement: false,
      erpFid: '1', erpNumber: preview.sourceCode, documentStatus: 'Z'
    });
    globalThis.fetch = async (url, options) => {
      const path = String(url);
      assert.match(path, /^http:\/\/kingdee\.test\//);
      if (path.includes('ValidateUser')) {
        return Response.json({ LoginResultType: 1 }, { headers: { 'Set-Cookie': 'session=test' } });
      }
      if (path.includes('SwitchOrg')) {
        const { OrgNumber } = JSON.parse(new URLSearchParams(options.body).get('data'));
        assert.equal(OrgNumber, '901');
        return Response.json({ Result: { ResponseStatus: { IsSuccess: true } } });
      }
      const query = JSON.parse(JSON.parse(options.body).data);
      assert.equal(query.FilterString, "FPAYORGID.FNumber = '901'");
      return Response.json([[2, 'FKD001', 'SGBXD', '费用报销付款单', paymentDate,
        'PH022', '', 228, 228, '', preview.sourceCode, '', bankStatus, '处理中', '', 228, '', transactionTime, '']]);
    };
    const pending = await syncPaymentStatuses();
    assert.equal(pending.items[0].status, 'ERP_PAYMENT_NOT_CONFIRMED');
    assert.equal(findSyncedDocument(preview.sourceId).erpBankProcessingStatus, '处理中');

    bankStatus = 'C';
    await assert.rejects(syncPaymentStatuses({ limit: 1, dryRun: true }), { code: 'KINGDEE_PAYMENT_QUERY_TRUNCATED' });
    const missingTime = await syncPaymentStatuses();
    assert.equal(missingTime.items[0].status, 'ERP_PAYMENT_NOT_CONFIRMED');
    assert.match(missingTime.items[0].message, /缺少实际付款交易时间/);
    assert.equal(findSyncedDocument(preview.sourceId).erpPaymentDate, '');

    transactionTime = `${paymentDate}T10:15:30`;
    await assert.rejects(syncPaymentStatuses(), { code: 'FENBEITONG_REAL_MODE_REQUIRED' });
    const persisted = findSyncedDocument(preview.sourceId);
    assert.equal(persisted.erpPaymentBillType, '费用报销付款单');
    assert.equal(persisted.erpBankProcessingStatus, '银行交易成功');
    assert.equal(persisted.erpPaymentDate, '2026-11-06 10:15:30');
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    clearStateCacheForTest();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('verifies the exact ERP transaction time and retains results across interrupted batches', async () => {
  loadLocalEnv();
  const tempRoot = resolve(tmpdir());
  const dataDir = mkdtempSync(join(tempRoot, 'fenbeitong-payment-review-'));
  const env = {
    APP_DATA_DIR: dataDir, FENBEITONG_MODE: 'real', FENBEITONG_TENANT_KEY: 'puhui', KINGDEE_MODE: 'real',
    KINGDEE_BASE_URL: 'http://kingdee.test', KINGDEE_ACCT_ID: 'test-account',
    KINGDEE_USERNAME: 'test-user', KINGDEE_PASSWORD: 'test-password', PAYMENT_STATUS_SYNC_ORG_NUMBER: ''
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const date = '2026-11-06';
  const cases = [
    { code: 'FIRST', expected: 'SYNCED' },
    { code: 'LOST-RESPONSE', expected: 'SYNCED', httpStatus: 503 },
    { code: 'WRITE-UNCONFIRMED', expected: 'FAILED', httpStatus: 503, readState: 0 },
    { code: 'FROM-PROCESSING', expected: 'SYNCED', initialState: 2 },
    { code: 'STILL-PROCESSING', expected: 'FAILED', readState: 2 },
    { code: 'DIFFERENT-TIME', expected: 'FAILED', wrongTime: true },
    { code: 'DETAIL-HTTP-FAILED', expected: 'FAILED', readError: true },
    { code: 'WRONG-DOCUMENT', expected: 'FAILED', wrongDocument: true },
    { code: 'MISSING-TIME', expected: 'ERP_PAYMENT_NOT_CONFIRMED', missingTime: true },
    { code: 'LAST', expected: 'SYNCED' }
  ];
  const requests = [];
  Object.assign(process.env, env);
  clearStateCacheForTest();
  try {
    saveFenbeitongTenantCredentials({
      key: 'puhui', name: 'Test', baseUrl: 'https://fenbeitong.test', authMode: 'access-token', accessToken: 'test-token'
    });
    const config = buildMockTemplate();
    const bills = cases.map((testCase, index) => {
      const doc = JSON.parse(config.mockFixedJson);
      doc.data.reimb_id = `REIMB-ID-${index}`;
      doc.data.reimb_code = testCase.code;
      saveSyncedDocument(doc, '', { sourceMode: 'real', tenantKey: 'puhui' });
      const preview = buildExpenseReimbursementPreview({ config, fixedJson: JSON.stringify(doc) });
      savePreparedRecord(preview);
      markPushedToErp(preview.sourceId, {
        mode: 'real', simulated: false, mockReplacement: false, erpFid: String(index + 1), erpNumber: testCase.code
      });
      testCase.sourceId = preview.sourceId;
      testCase.time = `${date} 10:00:${String(index).padStart(2, '0')}`;
      return [index + 1, `FKD-${index}`, 'SGBXD', '费用报销付款单', date, 'PH022', '', 228, 228, '', '', '',
        'C', '', '', 228, '', '', testCase.missingTime ? null : testCase.time, testCase.code, 1];
    });
    globalThis.fetch = async (url, options) => {
      const { hostname, pathname } = new URL(url);
      if (hostname === 'kingdee.test') {
        if (pathname.includes('ValidateUser')) return Response.json({ LoginResultType: 1 }, { headers: { 'Set-Cookie': 'session=test' } });
        if (pathname.includes('SwitchOrg')) return Response.json({ Result: { ResponseStatus: { IsSuccess: true } } });
        assert.match(pathname, /ExecuteBillQuery/);
        return Response.json(bills);
      }
      assert.equal(hostname, 'fenbeitong.test');
      assert.equal(options.headers['access-token'], 'test-token');
      const payload = JSON.parse(options.body);
      if (pathname.endsWith('/update_state')) {
        const [{ code }] = payload.reimbursements;
        const testCase = cases.find((item) => item.code === code);
        assert.deepEqual(payload, { reimbursements: [{ code }], pay_status: '1', payment_date: testCase.time });
        requests.push(code);
        return Response.json({ code: 0 }, { status: testCase.httpStatus || 200 });
      }
      assert.equal(pathname, '/openapi/reimbursement/v2/detail');
      const testCase = cases.find((item) => item.code === payload.reimb_code);
      const written = requests.includes(testCase.code);
      if (written && testCase.readError) return Response.json({ code: -9999 }, { status: 400 });
      return Response.json({ code: 0, data: {
        reimb_code: testCase.wrongDocument ? 'OTHER-DOCUMENT' : testCase.code,
        payment_state: written ? testCase.readState ?? 1 : testCase.initialState ?? 0,
        payment_time: written && testCase.wrongTime ? `${date} 08:00:00` : testCase.time,
        payment_records: [{ pay_time: testCase.time }]
      } });
    };

    const options = { tenantKey: 'puhui' };
    const preview = await previewPaymentStatusSync(options);
    assert.equal(preview.readyCount, 8);
    assert.equal(requests.length, 0);

    const result = await syncPaymentStatuses(options);
    assert.equal(result.totalCount, cases.length);
    const items = new Map(result.items.map((item) => [item.sourceCode, item]));
    for (const testCase of cases) {
      assert.equal(items.get(testCase.code).status, testCase.expected, testCase.code);
      assert.equal(findSyncedDocument(testCase.sourceId).reversePaymentSyncStatus, testCase.expected, testCase.code);
    }
    assert.equal(requests.filter((code) => code === 'LOST-RESPONSE').length, 1);
    assert.equal(requests.filter((code) => code === 'WRITE-UNCONFIRMED').length, 1);
    assert.ok(requests.includes('LAST'));
    assert.ok(!requests.includes('MISSING-TIME') && !requests.includes('WRONG-DOCUMENT'));
    assert.equal(items.get('STILL-PROCESSING').fenbeitongPaymentState, '付款中');
    assert.match(items.get('DIFFERENT-TIME').message, /交易时间不一致/);

    const repeated = await syncPaymentStatuses(options);
    assert.equal(repeated.items.find((item) => item.sourceCode === 'FIRST').status, 'ALREADY_PAID');
    assert.equal(repeated.items.find((item) => item.sourceCode === 'DIFFERENT-TIME').status, 'FAILED');
    assert.equal(requests.filter((code) => code === 'FIRST').length, 1);
    assert.equal(requests.filter((code) => code === 'DIFFERENT-TIME').length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    resetTenantStoreForTest();
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    clearStateCacheForTest();
    assert.equal(dirname(resolve(dataDir)), tempRoot);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function processRecord({
  sourceCode = 'B1IELSHBX26060100001',
  sourceType = 'OFFLINE_REIMBURSEMENT',
  employeeNumber,
  amount,
  date
}) {
  return {
    sourceId: `ID-${sourceCode}`,
    sourceType,
    sourceCode,
    erpNumber: sourceCode,
    expenseReimbursementPayload: JSON.stringify({
      Model: {
        FProposerID: { FStaffNumber: employeeNumber },
        FReqAmountSum: amount,
        FDate: date
      }
    })
  };
}

function paymentBill({
  id,
  billNumber,
  employeeNumber,
  amount,
  date,
  sourceBillNumber = ''
}) {
  return {
    id,
    billNumber,
    billTypeNumber: 'SGBXD',
    billTypeName: '费用报销付款单',
    employeeNumber,
    businessDate: date,
    paymentTime: `${date} 10:15:30`,
    paidAmount: amount,
    entryPaymentAmount: amount,
    sourceBillNumber,
    thirdPartyBillNumber: '',
    remark: '',
    bankStatusCode: 'C',
    bankStatusName: '银行交易成功',
    entries: []
  };
}
