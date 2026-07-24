import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCsvCell } from '../src/csv-export.js';

test('CSV export preserves long source numbers as Excel text', () => {
  assert.equal(
    encodeCsvCell('0013808520260601', { excelText: true }),
    '"=""0013808520260601"""'
  );
});

test('CSV export still escapes ordinary cell content', () => {
  assert.equal(encodeCsvCell('A, "quoted" value'), '"A, ""quoted"" value"');
});
