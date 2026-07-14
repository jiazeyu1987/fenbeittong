import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildVoucherPreview, parseFenbeitongDetail } from '../src/voucher-mapper.js';

const template = buildMockTemplate();

test('valid fixed JSON creates a balanced voucher preview', () => {
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  assert.equal(preview.sourceId, 'MOCK-REIMB-001');
  assert.equal(preview.debitTotal, 228);
  assert.equal(preview.creditTotal, 228);
  assert.equal(preview.balanced, true);
  assert.equal(preview.payload.Model.DocumentStatus, 'Z');
});

test('missing reimbursement id fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-missing-field.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /data\.reimb_id/);
});

test('expense total mismatch fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-unbalanced.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /expense total/);
});

test('real paid amount detail can voucher when expenses match payment amount', () => {
  const config = structuredClone(template);
  config.categoryAccountNumbers.CI007 = '6601.10';
  const preview = buildVoucherPreview({
    fixedJson: JSON.stringify({
      code: 0,
      data: {
        reimb_id: 'REAL-ID-CI007',
        reimb_code: 'REAL-CODE-CI007',
        currency_code: 'CNY',
        total_amount: 3243.74,
        payment_amount: 186.38,
        apply_reason: 'Real paid reimbursement',
        user: {},
        expenses: [
          {
            id: 'REAL-EXP-CI007',
            cost_category: { code: 'CI007', name: '通讯费-个人' },
            total_amount: 186.38,
            invoices: []
          }
        ]
      }
    }),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  });

  assert.equal(preview.debitTotal, 186.38);
  assert.equal(preview.creditTotal, 186.38);
  assert.equal(preview.payload.Model.FEntity[0].FACCOUNTID.FNumber, '6601.10');
});

test('missing category account mapping fails before payload generation', () => {
  const config = structuredClone(template);
  delete config.categoryAccountNumbers.TRAVEL;
  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  }), /category account mapping is missing/);
});

test('voucher date must match accounting year and period', () => {
  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: '2026-08-01',
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /voucherDate .* does not match year\/period/);
});

test('invoice tax anomalies fail before voucher payload generation', () => {
  const root = JSON.parse(template.mockFixedJson);
  root.data.expenses[0].invoices[0].tax_amount = 1;
  root.data.expenses[0].invoices[0].deductible_tax_amount = 2;
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /deductible tax amount .* must not exceed tax amount/);
});

test('duplicate invoice ids fail fast', () => {
  const root = JSON.parse(template.mockFixedJson);
  const duplicate = structuredClone(root.data.expenses[0].invoices[0]);
  root.data.expenses[0].invoices.push(duplicate);
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /duplicate invoice id/);
});

test('required detail dimensions fail fast for expense lines', () => {
  const root = JSON.parse(template.mockFixedJson);
  root.data.user.department_code = '';
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: { ...template, departmentDetailField: 'FDETAILID__FFLEX5' }
  }), /department detail dimension is required/);
});

test('missing ERP template model fails before Kingdee save payload generation', () => {
  const config = structuredClone(template);
  config.templateErpFid = 'UNCONFIRMED-TEMPLATE';
  delete config.erpTemplateModel;

  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  }), /erpTemplateModel is required/);
});
