import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('release configuration template works without fixture files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fenbeitong-config-'));
  try {
    const modulePath = join(directory, 'template.mjs');
    copyFileSync(new URL('../backend/src/mock-template.js', import.meta.url), modulePath);
    const { buildConfigTemplate, buildMockTemplate } = await import(pathToFileURL(modulePath));
    const template = buildConfigTemplate();
    assert.equal(template.mockFixedJson, '');
    assert.equal(template.expenseReimbursementBillTypeNumber, 'FYBXD001_SYS');
    assert.equal(template.expenseItemNumberMappings.CI00802, 'CI008');
    assert.throws(buildMockTemplate, { code: 'ENOENT' });
    const frontend = readFileSync(new URL('../frontend/src/app.js', import.meta.url), 'utf8');
    assert.doesNotMatch(frontend, /api\.getMockTemplate\(/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
