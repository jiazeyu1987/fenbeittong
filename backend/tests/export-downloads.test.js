import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCsvDownload } from '../src/export-downloads.js';

test('writes a CSV export directly to the configured local download directory', (t) => {
  const downloadDirectory = mkdtempSync(join(tmpdir(), 'fenbeitong-export-'));
  const previousDirectory = process.env.EXPORT_DOWNLOAD_DIR;
  process.env.EXPORT_DOWNLOAD_DIR = downloadDirectory;
  t.after(() => {
    restoreExportDirectory(previousDirectory);
    rmSync(downloadDirectory, { recursive: true, force: true });
  });

  const created = createCsvDownload({
    filename: '报销单列表-2026-07-24.csv',
    content: '\uFEFF"来源单号"\n"=""0013808520260601"""'
  });

  assert.equal(created.filename, '报销单列表-2026-07-24.csv');
  assert.equal(existsSync(created.localPath), true);
  assert.match(readFileSync(created.localPath, 'utf8'), /0013808520260601/);
});

test('sanitizes the filename and avoids overwriting an existing export', (t) => {
  const downloadDirectory = mkdtempSync(join(tmpdir(), 'fenbeitong-export-'));
  const previousDirectory = process.env.EXPORT_DOWNLOAD_DIR;
  process.env.EXPORT_DOWNLOAD_DIR = downloadDirectory;
  t.after(() => {
    restoreExportDirectory(previousDirectory);
    rmSync(downloadDirectory, { recursive: true, force: true });
  });

  const first = createCsvDownload({ filename: '../bad:name', content: 'first' });
  const second = createCsvDownload({ filename: '../bad:name', content: 'second' });

  assert.equal(first.filename, '..-bad-name.csv');
  assert.equal(second.filename, '..-bad-name (1).csv');
  assert.equal(readFileSync(first.localPath, 'utf8'), 'first');
  assert.equal(readFileSync(second.localPath, 'utf8'), 'second');
});

function restoreExportDirectory(previousDirectory) {
  if (previousDirectory === undefined) {
    delete process.env.EXPORT_DOWNLOAD_DIR;
  } else {
    process.env.EXPORT_DOWNLOAD_DIR = previousDirectory;
  }
}
