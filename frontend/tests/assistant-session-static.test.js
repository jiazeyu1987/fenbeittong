import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('frontend carries the assistant session on every API request', () => {
  const source = readFileSync('frontend/src/api.js', 'utf8');
  assert.match(source, /assistantSession/);
  assert.match(source, /sessionStorage\.setItem\('fenbeitongAssistantSession'/);
  assert.match(source, /x-fenbeitong-assistant-session/);
  assert.match(source, /assistantSession:\s*\(\)\s*=>\s*request\('\/api\/assistant\/session'\)/);
});

test('workbench propagates the assistant session to log-center links opened in a new tab', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const source = readFileSync('frontend/src/api.js', 'utf8');
  assert.match(html, /data-assistant-session-link/);
  assert.match(source, /querySelectorAll\('a\[data-assistant-session-link\]'\)/);
  assert.match(source, /searchParams\.set\('assistantSession', assistantSession\)/);
});

test('frontend hides controls that require permissions absent from the session', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const source = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /data-required-permission="erp:fenbeitong-voucher:query"/);
  assert.match(html, /data-required-permission="erp:fenbeitong-voucher:query"/);
  assert.match(source, /assistantPermissions/);
  assert.match(source, /applyAssistantPermissions/);
  assert.match(source, /api\.assistantSession\(\)/);
});

test('all business and configuration controls use the single tab permission', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const button = html.match(/<button\b[^>]*\bid="syncFenbeitongButton"[^>]*>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /\bhidden\b|data-required-permission/);
  assert.doesNotMatch(html, /erp:fenbeitong-voucher:(?:save|config)/);
  for (const id of ['fieldMappingButton', 'generateVoucherButton', 'saveErpButton', 'resaveErpButton', 'syncPaymentStatusButton']) {
    const protectedButton = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(protectedButton);
    assert.match(protectedButton, /data-required-permission="erp:fenbeitong-voucher:query"/);
    assert.match(protectedButton, /\bhidden\b/);
  }
});
