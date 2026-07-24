import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onlineBillPostingDateForTest,
  replaySavedExpenseReimbursementForTest,
  requiredOriginalBillNumberForTest,
  resolveOnlineOrderPurposeForTest,
  targetExistingExpenseReimbursementForTest
} from '../src/services/expense-reimbursement-workflow.js';

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
    /multiple original bills/
  );
});

test('online monthly group uses the real posting date immediately after its bill cycle', () => {
  assert.equal(
    onlineBillPostingDateForTest([{
      fixedJson: JSON.stringify({
        data: {
          bill_no: '0013808520260601',
          bill_cycle: '2026/05/01-2026/05/31'
        }
      })
    }]),
    '2026-06-01'
  );
});

test('online monthly group prefers an explicit Fenbeitong bill date', () => {
  assert.equal(
    onlineBillPostingDateForTest([{
      fixedJson: JSON.stringify({
        data: {
          bill_date: '2026/06/02 00:00:00',
          bill_cycle: '2026/05/01-2026/05/31'
        }
      })
    }]),
    '2026-06-02'
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
