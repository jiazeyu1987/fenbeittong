import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAlreadyDeletedKingdeeDraftForTest,
  onlineOriginalBillNumberForTest,
  onlineBillPostingDateForTest,
  replaySavedExpenseReimbursementForTest,
  requiredOriginalBillNumberForTest,
  resolveOnlineOrderPurposeForTest,
  shouldReplaceOnlineDraftForTest,
  synchronizedSourceTypeValueForTest,
  targetExistingExpenseReimbursementForTest
} from '../src/services/expense-reimbursement-workflow.js';

test('ERP source type uses the exact synchronized label for online and offline records', () => {
  assert.equal(synchronizedSourceTypeValueForTest({
    sourceKindName: '线下报销',
    sourceForm: '费用明细'
  }), '线下报销 · 费用明细');
  assert.equal(synchronizedSourceTypeValueForTest({
    sourceKindName: '线上月结',
    sourceForm: '企业账单'
  }), '线上月结 · 企业账单');
  assert.equal(synchronizedSourceTypeValueForTest({
    sourceType: 'OFFLINE_REIMBURSEMENT'
  }), '线下报销 · 费用明细');
  assert.equal(synchronizedSourceTypeValueForTest({
    sourceType: 'ONLINE_MONTHLY_BILL'
  }), '线上月结 · 企业账单');
});

test('cross-month online bills remain separate even in the same settlement month', () => {
  assert.equal(onlineOriginalBillNumberForTest({
    sourceCode: '0013808520260420',
    settlementMonth: '202604'
  }), '0013808520260420');
  assert.equal(onlineOriginalBillNumberForTest({
    sourceCode: '0013808520260501',
    settlementMonth: '202604'
  }), '0013808520260501');
});

test('a missing previous ERP draft does not roll back the verified replacement', () => {
  assert.equal(isAlreadyDeletedKingdeeDraftForTest({
    code: 'KINGDEE_VIEW_FAILED',
    message: '您要读取的数据在系统中不存在,可能已经被删除'
  }), true);
  assert.equal(isAlreadyDeletedKingdeeDraftForTest({
    code: 'KINGDEE_NETWORK_FAILED',
    message: 'network unavailable'
  }), false);
});

test('an online monthly draft retry uses verified replacement instead of mutating its organization', () => {
  assert.equal(shouldReplaceOnlineDraftForTest(true, {
    sourceKind: 'ONLINE_MONTHLY_BILL',
    payload: { Model: { FBillNo: '0013808520260701-X003' } }
  }, {
    erpDocumentStatus: 'A',
    erpNumber: 'FYBX20260731000001'
  }), true);
  assert.equal(shouldReplaceOnlineDraftForTest(true, {
    sourceKind: 'ONLINE_MONTHLY_BILL',
    payload: { Model: { FBillNo: '0013808520260701-X003' } }
  }, {
    erpDocumentStatus: 'C',
    erpNumber: 'FYBX20260731000001'
  }), false);
  assert.equal(shouldReplaceOnlineDraftForTest(true, {
    sourceKind: 'ONLINE_MONTHLY_BILL',
    payload: { Model: { FBillNo: '0013808520260701-X003' } }
  }, {
    erpDocumentStatus: 'A',
    erpNumber: '0013808520260701-X003'
  }), false);
});

test('an unchanged repeated ERP save returns the existing record idempotently', () => {
  const existing = {
    sourceId: 'ONLINE-MONTH:puhui:X003:202606',
    sourceIds: ['SOURCE-B', 'SOURCE-A'],
    contentHash: 'same-content',
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    targetFormId: 'ER_ExpReimbursement',
    erpMode: 'real',
    simulatedErp: false,
    erpFid: '127410',
    erpNumber: 'FYBX20260724000005'
  };

  const replay = replaySavedExpenseReimbursementForTest(existing, {
    sourceId: 'ONLINE-MONTH:puhui:X003:202606',
    sourceIds: ['SOURCE-A', 'SOURCE-B'],
    contentHash: 'same-content'
  });

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.erpFid, '127410');
  assert.equal(replay.erpNumber, 'FYBX20260724000005');
});

test('a changed repeated ERP save still requires the explicit resave action', () => {
  assert.equal(replaySavedExpenseReimbursementForTest({
    sourceId: 'ONLINE-MONTH:puhui:X003:202606',
    sourceIds: ['SOURCE-A'],
    contentHash: 'old-content',
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    targetFormId: 'ER_ExpReimbursement',
    erpMode: 'real',
    simulatedErp: false,
    erpFid: '127410',
    erpNumber: 'FYBX20260724000005'
  }, {
    sourceId: 'ONLINE-MONTH:puhui:X003:202606',
    sourceIds: ['SOURCE-A'],
    contentHash: 'new-content'
  }), null);
});

test('ERP retry updates the existing expense reimbursement FID', () => {
  const payload = { Model: { FID: 0 } };
  targetExistingExpenseReimbursementForTest(payload, {
    erpFid: '127500',
    erpNumber: 'FYBX20260723000001'
  });
  assert.equal(payload.Model.FID, 127500);
  assert.equal(payload.Model.FBillNo, 'FYBX20260723000001');
  assert.equal('FVOUCHERID' in payload.Model, false);
});

test('ERP retry stops when the expense reimbursement FID is invalid', () => {
  assert.throws(
    () => targetExistingExpenseReimbursementForTest({ Model: { FID: 0 } }, { erpFid: '' }),
    /stopped to avoid creating a duplicate/
  );
});

test('online monthly group uses the original Fenbeitong bill number', () => {
  assert.equal(
    requiredOriginalBillNumberForTest([
      { bill_no: '0013808520260701' },
      { bill_no: '0013808520260701' }
    ]),
    '0013808520260701'
  );
});

test('online monthly group refuses to combine different original bills', () => {
  assert.throws(
    () => requiredOriginalBillNumberForTest([
      { bill_no: '0013808520260601' },
      { bill_no: '0013808520260701' }
    ]),
    /混入多个原始账单/
  );
});

test('online monthly group uses the first day of its bill cycle', () => {
  assert.equal(
    onlineBillPostingDateForTest([{
      fixedJson: JSON.stringify({
        data: {
          bill_no: '0013808520260601',
          bill_cycle: '2026/05/01-2026/05/31'
        }
      })
    }]),
    '2026-05-01'
  );
});

test('online monthly group prefers its bill cycle start over an explicit bill date', () => {
  assert.equal(
    onlineBillPostingDateForTest([{
      fixedJson: JSON.stringify({
        data: {
          bill_date: '2026/06/02 00:00:00',
          bill_cycle: '2026/05/01-2026/05/31'
        }
      })
    }]),
    '2026-05-01'
  );
});

test('online monthly group derives the first day from settlement month', () => {
  assert.equal(
    onlineBillPostingDateForTest([{
      fixedJson: JSON.stringify({
        data: {
          settlement_month: '202605'
        }
      })
    }]),
    '2026-05-01'
  );
});

test('online order purpose comes from its linked Fenbeitong application reason', () => {
  const records = [{
    sourceType: 'REIMBURSEMENT',
    tenantKey: 'puhui',
    fixedJson: JSON.stringify({
      data: {
        custom_controls: [{
          field_code: 'relation_apply',
          detail: [{
            meaning_no: 'B1IELSQAT26053100002',
            apply_reason: '商务洽谈'
          }]
        }]
      }
    })
  }];

  assert.equal(
    resolveOnlineOrderPurposeForTest({
      saas: { apply_id: 'B1IELSQAT26053100002' }
    }, records),
    '商务洽谈'
  );
});

test('online order purpose stays blank when Fenbeitong has no application reason', () => {
  assert.equal(
    resolveOnlineOrderPurposeForTest({ saas: { apply_id: 'UNKNOWN' } }, []),
    ''
  );
});
