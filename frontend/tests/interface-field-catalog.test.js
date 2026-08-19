import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterInterfaceFieldCatalog, interfaceFieldCatalog } from '../src/interface-field-catalog.js';

test('interface field catalog includes complete online and offline mappings', () => {
  assert.ok(interfaceFieldCatalog.filter((row) => row.sourceType === '线下').length >= 25);
  assert.ok(interfaceFieldCatalog.filter((row) => row.sourceType === '线上').length >= 20);
  assert.ok(interfaceFieldCatalog.some((row) => row.erpField.includes('FLOCNOTAXAMOUNT')));
  assert.ok(interfaceFieldCatalog.some((row) => row.erpField.includes('FProposerID')));
  for (const sourceType of ['线上', '线下']) {
    assert.ok(interfaceFieldCatalog.some((row) => row.sourceType === sourceType && row.erpField === 'BankBranchT'));
    assert.ok(interfaceFieldCatalog.some((row) => row.sourceType === sourceType && row.erpField === 'BankAccountNameT'));
    assert.ok(interfaceFieldCatalog.some((row) => row.sourceType === sourceType && row.erpField === 'BankAccountT'));
    assert.ok(interfaceFieldCatalog.some((row) => row.sourceType === sourceType && row.erpField === 'FPaySettlleTypeID'));
  }
});

test('interface field catalog can be queried by source type and keyword', () => {
  const results = filterInterfaceFieldCatalog(interfaceFieldCatalog, '线上', '税额');
  assert.ok(results.length > 0);
  assert.ok(results.every((row) => row.sourceType === '线上'));
});
