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
  assert.equal(preview.payload.Model.FDocumentStatus, 'Z');
});

test('missing reimbursement id fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-missing-field.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /data\.reimb_id/);
});

test('expense total mismatch fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-unbalanced.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /expense total/);
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
    config: template
  }), /department detail dimension is required/);
});
