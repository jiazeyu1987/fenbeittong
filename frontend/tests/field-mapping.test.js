import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFieldMapping, parseFieldMapping } from '../src/field-mapping.js';

test('field mappings round-trip through the editable line format', () => {
  const mapping = { X020: 'PL0145', '销售部': 'BM000006' };
  assert.deepEqual(parseFieldMapping(formatFieldMapping(mapping)), mapping);
});

test('field mapping parser supports comments, blank lines and arrow separators', () => {
  assert.deepEqual(parseFieldMapping('# 员工映射\n\nX002 => PL0147'), { X002: 'PL0147' });
});

test('field mapping parser identifies the invalid line number', () => {
  assert.throws(
    () => parseFieldMapping('X002 = PL0147\n错误行', '员工映射'),
    /员工映射第 2 行格式错误/
  );
});
