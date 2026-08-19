import assert from 'node:assert/strict';
import test from 'node:test';

import {
  processRecordListResponse,
  processRecordResponse
} from '../src/process-record-response.js';

test('process record API response omits large internal ERP fields', () => {
  const record = {
    sourceId: 'SOURCE-1',
    sourceIds: ['SOURCE-1', 'SOURCE-2'],
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    erpFid: '10001',
    erpNumber: 'FYBX0001',
    expenseReimbursementPayload: '{"Model":{"large":"payload"}}',
    erpRawResponse: '{"Result":{"large":"response"}}',
    previousErpPushes: [{ erpFid: '9999' }, { erpFid: '10000' }]
  };

  assert.deepEqual(processRecordResponse(record), {
    sourceId: 'SOURCE-1',
    sourceIds: ['SOURCE-1', 'SOURCE-2'],
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    erpFid: '10001',
    erpNumber: 'FYBX0001',
    previousErpPushCount: 2
  });
  assert.equal(record.expenseReimbursementPayload, '{"Model":{"large":"payload"}}');
});

test('process record list API response sanitizes every record', () => {
  const result = processRecordListResponse([
    { sourceId: 'ONE', previousErpPushes: [] },
    { sourceId: 'TWO', erpRawResponse: 'large' }
  ]);

  assert.deepEqual(result, [
    { sourceId: 'ONE', previousErpPushCount: 0 },
    { sourceId: 'TWO', previousErpPushCount: 0 }
  ]);
});
