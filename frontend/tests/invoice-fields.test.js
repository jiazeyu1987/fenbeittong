import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeExpenseInvoices } from '../src/invoice-fields.js';

test('maps invoice headers from exact Fenbeitong invoice fields', () => {
  const summary = summarizeExpenseInvoices({
    invoices: [{
      id: 'INV-1',
      type: 10130,
      code: '0123456789',
      number: '9876543210',
      issued_time: '2026-06-18',
      seller_name: '销售方公司',
      seller_tax_code: 'SELLER-TAX-ID',
      buyer_name: '购买方公司',
      buyer_tax_code: 'BUYER-TAX-ID',
      tax_amount: 1.01,
      exclude_tax_amount: 99.99,
      total_amount: 101
    }],
    cost_custom_fields: [{
      field_code: 'invoice_info',
      detail: {
        invoiceList: [{
          fbInvId: 'INV-1',
          invTypeName: '电子发票（增值税普通发票）'
        }]
      }
    }]
  });

  assert.deepEqual(summary, {
    invoiceType: '电子发票（增值税普通发票）',
    invoiceCode: '0123456789',
    invoiceNumber: '9876543210',
    invoiceIssueDate: '2026-06-18',
    sellerName: '销售方公司',
    buyerName: '购买方公司',
    invoiceTaxAmount: 1.01,
    invoiceExcludingTaxAmount: 99.99,
    invoiceTotalAmount: 101
  });
});

test('leaves exact invoice amounts empty when Fenbeitong does not return them', () => {
  const summary = summarizeExpenseInvoices({
    invoices: [{ id: 'INV-EMPTY', total_amount: 123.86 }]
  });

  assert.equal(summary.invoiceTaxAmount, null);
  assert.equal(summary.invoiceExcludingTaxAmount, null);
  assert.equal(summary.invoiceTotalAmount, 123.86);
});

test('aggregates only complete exact invoice amount fields', () => {
  const summary = summarizeExpenseInvoices({
    invoices: [
      { id: 'INV-1', tax_amount: 1.01, exclude_tax_amount: 99.99, total_amount: 101 },
      { id: 'INV-2', tax_amount: 2.02, total_amount: 20 }
    ]
  });

  assert.equal(summary.invoiceTaxAmount, 3.03);
  assert.equal(summary.invoiceExcludingTaxAmount, null);
  assert.equal(summary.invoiceTotalAmount, 121);
});
