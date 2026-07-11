import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../../backend/src/mock-template.js';
import { buildVoucherPreview } from '../../backend/src/voucher-mapper.js';

test('mock template contains required fields and no real token', () => {
  const template = buildMockTemplate();
  assert.equal(template.accountBookNumber, '011');
  assert.equal(template.voucherGroupNumber, 'PZZ8');
  assert.equal(template.fenbeitongAccessToken, '');
  assert.match(template.mockFixedJson, /MOCK-REIMB-001/);
});

test('preview response keeps stable contract fields', () => {
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  for (const field of ['sourceId', 'sourceCode', 'idempotencyKey', 'contentHash', 'debitTotal', 'creditTotal', 'balanced', 'payload']) {
    assert.ok(Object.hasOwn(preview, field), `${field} should exist`);
  }
});
