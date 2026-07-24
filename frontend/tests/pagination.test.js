import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePagination, visiblePageNumbers } from '../src/pagination.js';

test('pagination calculates page slices and clamps invalid pages', () => {
  assert.deepEqual(calculatePagination(20, 20, 1), {
    totalItems: 20,
    pageSize: 20,
    totalPages: 1,
    currentPage: 1,
    startIndex: 0,
    endIndex: 20
  });
  assert.deepEqual(calculatePagination(101, 20, 99), {
    totalItems: 101,
    pageSize: 20,
    totalPages: 6,
    currentPage: 6,
    startIndex: 100,
    endIndex: 101
  });
});

test('pagination returns a moving five-page window', () => {
  assert.deepEqual(visiblePageNumbers(1, 8), [1, 2, 3, 4, 5]);
  assert.deepEqual(visiblePageNumbers(4, 8), [2, 3, 4, 5, 6]);
  assert.deepEqual(visiblePageNumbers(8, 8), [4, 5, 6, 7, 8]);
});
