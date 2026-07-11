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
