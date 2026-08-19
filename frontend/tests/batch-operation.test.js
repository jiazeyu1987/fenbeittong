import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseReimbursementSelectionKey,
  formatBatchFailureDetails,
  isConfirmedErpSave,
  isMissingKingdeeEmployee,
  isSkippableKingdeeBusinessRule,
  runBatchOperation
} from '../src/batch-operation.js';

test('accepts the verified save response without requiring an immediate follow-up query', () => {
  assert.equal(isConfirmedErpSave({
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    targetFormId: 'ER_ExpReimbursement',
    erpMode: 'real',
    simulatedErp: false,
    erpFid: '127649',
    erpNumber: 'FYBX20260730000087'
  }), true);
  assert.equal(isConfirmedErpSave({
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    targetFormId: 'ER_ExpReimbursement',
    erpMode: 'real',
    simulatedErp: true,
    erpFid: '127649',
    erpNumber: 'FYBX20260730000087'
  }), false);
});

test('batch operation continues after one item fails', async () => {
  const attempted = [];
  const progress = [];
  const result = await runBatchOperation(['A', 'B', 'C'], async (item) => {
    attempted.push(item);
    if (item === 'B') {
      const error = new Error('employee mapping missing');
      error.code = 'KINGDEE_EMPLOYEE_MAPPING_MISSING';
      throw error;
    }
    return `${item}-saved`;
  }, (event) => progress.push(event));

  assert.deepEqual(attempted, ['A', 'B', 'C']);
  assert.deepEqual(result.successes, ['A-saved', 'C-saved']);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].item, 'B');
  assert.equal(result.failures[0].error.code, 'KINGDEE_EMPLOYEE_MAPPING_MISSING');
  assert.equal(isMissingKingdeeEmployee(result.failures[0].error), true);
  assert.equal(isMissingKingdeeEmployee(new Error('network failed')), false);
  assert.equal(isSkippableKingdeeBusinessRule(result.failures[0].error), true);
  assert.equal(isSkippableKingdeeBusinessRule({
    code: 'KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE'
  }), true);
  assert.equal(isSkippableKingdeeBusinessRule({
    code: 'KINGDEE_SAVE_LINE_MISMATCH'
  }), false);
  assert.equal(isSkippableKingdeeBusinessRule({
    code: 'KINGDEE_SAVE_FAILED',
    message: '【开户银行】字段必录；【账户名称】字段必录；【银行账号】字段必录'
  }), false);
  assert.equal(isSkippableKingdeeBusinessRule({
    code: 'KINGDEE_SAVE_FAILED',
    message: '【开户银行】字段必录'
  }), false);
  assert.equal(isSkippableKingdeeBusinessRule(new Error('network failed')), false);
  assert.deepEqual(progress.map((event) => ({
    completed: event.completed,
    total: event.total,
    successCount: event.successCount,
    failureCount: event.failureCount
  })), [
    { completed: 1, total: 3, successCount: 1, failureCount: 0 },
    { completed: 2, total: 3, successCount: 1, failureCount: 1 },
    { completed: 3, total: 3, successCount: 2, failureCount: 1 }
  ]);
  assert.equal(progress[1].error.code, 'KINGDEE_EMPLOYEE_MAPPING_MISSING');
});

test('batch operation uses bounded concurrency and preserves result order', async () => {
  let active = 0;
  let peakActive = 0;
  const progress = [];
  const result = await runBatchOperation(
    ['A', 'B', 'C', 'D', 'E'],
    async (item) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((resolve) => setTimeout(resolve, item === 'A' ? 15 : 5));
      active -= 1;
      return `${item}-saved`;
    },
    (event) => progress.push(event),
    { concurrency: 3 }
  );

  assert.equal(peakActive, 3);
  assert.deepEqual(result.successes, [
    'A-saved',
    'B-saved',
    'C-saved',
    'D-saved',
    'E-saved'
  ]);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(progress.map((event) => event.completed), [1, 2, 3, 4, 5]);
});

test('online monthly selection key uses the original bill number', () => {
  const common = {
    sourceType: 'ONLINE_MONTHLY_BILL',
    tenantKey: 'puhui',
    requesterCode: 'X003',
    settlementMonth: '202604',
    sourceCode: '0013808520260420'
  };

  assert.equal(
    expenseReimbursementSelectionKey({ ...common, paymentDate: '2026-06-01' }),
    expenseReimbursementSelectionKey({ ...common, paymentDate: '2026-07-01' })
  );
  assert.equal(
    expenseReimbursementSelectionKey(common),
    'ONLINE-BILL:puhui:X003:0013808520260420'
  );
  assert.notEqual(
    expenseReimbursementSelectionKey(common),
    expenseReimbursementSelectionKey({
      ...common,
      sourceCode: '0013808520260501'
    })
  );
});

test('formats every batch failure with person, source, code, and reason', () => {
  assert.equal(formatBatchFailureDetails([
    {
      requesterName: '朱海',
      requesterCode: 'X024',
      sourceCode: 'BILL-001',
      code: 'KINGDEE_SAVE_FAILED',
      message: '申请组织缺失\n申请组织缺失'
    },
    {
      requesterName: '尹正能',
      sourceId: 'SOURCE-002',
      message: '请求超时'
    }
  ]), [
    '1. 朱海（X024）｜BILL-001｜金蝶保存失败：申请组织缺失',
    '2. 尹正能｜SOURCE-002｜请求失败：请求超时'
  ].join('\n'));
});

test('translates browser fetch failures into a Chinese reason', () => {
  assert.equal(formatBatchFailureDetails([
    {
      requesterName: '刘昊',
      requesterCode: 'X012',
      sourceCode: 'B1IELSHBX26070100002',
      code: 'REQUEST_FAILED',
      message: 'Failed to fetch'
    }
  ]), '1. 刘昊（X012）｜B1IELSHBX26070100002｜请求失败：无法连接本地后台服务，当前单据尚未确认保存。');
});

test('translates a transient Windows state-file lock into a Chinese reason', () => {
  assert.equal(formatBatchFailureDetails([
    {
      requesterName: '顾颁',
      requesterCode: 'X011',
      sourceCode: 'B1IELSHBX26071900003',
      code: 'EPERM',
      message: "EPERM: operation not permitted, rename 'state.tmp' -> 'state.json'"
    }
  ]), '1. 顾颁（X011）｜B1IELSHBX26071900003｜本地状态文件被占用：本地状态文件被其他程序短暂占用，ERP中的单据可能已经保存；程序会自动重试写入确认状态。');
});
