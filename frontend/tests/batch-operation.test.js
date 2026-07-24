import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseReimbursementSelectionKey,
  isMissingKingdeeEmployee,
  runBatchOperation
} from '../src/batch-operation.js';

test('batch operation continues after one item fails', async () => {
  const attempted = [];
  const result = await runBatchOperation(['A', 'B', 'C'], async (item) => {
    attempted.push(item);
    if (item === 'B') {
      const error = new Error('employee mapping missing');
      error.code = 'KINGDEE_EMPLOYEE_MAPPING_MISSING';
      throw error;
    }
    return `${item}-saved`;
  });

  assert.deepEqual(attempted, ['A', 'B', 'C']);
  assert.deepEqual(result.successes, ['A-saved', 'C-saved']);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].item, 'B');
  assert.equal(result.failures[0].error.code, 'KINGDEE_EMPLOYEE_MAPPING_MISSING');
  assert.equal(isMissingKingdeeEmployee(result.failures[0].error), true);
  assert.equal(isMissingKingdeeEmployee(new Error('network failed')), false);
});

test('online monthly selection key uses settlement month instead of individual payment dates', () => {
  const common = {
    sourceType: 'ONLINE_MONTHLY_BILL',
    tenantKey: 'puhui',
    requesterCode: 'X003',
    settlementMonth: '202606'
  };

  assert.equal(
    expenseReimbursementSelectionKey({ ...common, paymentDate: '2026-06-01' }),
    expenseReimbursementSelectionKey({ ...common, paymentDate: '2026-07-01' })
  );
  assert.equal(
    expenseReimbursementSelectionKey(common),
    'ONLINE-MONTH:puhui:X003:2026-06'
  );
});
