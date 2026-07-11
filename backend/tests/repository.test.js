import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildVoucherPreview } from '../src/voucher-mapper.js';
import { findPreparedRecord, resetRepository, savePreparedRecord } from '../src/repository.js';

test('prepare stores a local prepared record without ERP identifiers', () => {
  resetRepository();
  const template = buildMockTemplate();
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  const record = savePreparedRecord(preview);
  assert.equal(record.processStatus, 15);
  assert.equal(record.processStage, 'PREPARED');
  assert.equal(record.erpDocumentStatus, 'Z');
  assert.equal(record.erpFid, undefined);
  assert.ok(findPreparedRecord('MOCK-REIMB-001'));
});
