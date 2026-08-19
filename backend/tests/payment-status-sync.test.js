import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPaymentBills } from '../src/services/payment-status-sync.js';

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
  assert.equal(result.erpPaymentDate, '2026-06-05');
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
