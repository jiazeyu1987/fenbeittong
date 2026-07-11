import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  for (const id of [
    'loadTemplateButton',
    'saveConfigButton',
    'syncButton',
    'runSchedulerButton',
    'previewButton',
    'prepareButton',
    'pushErpButton',
    'schedulerEnabled',
    'schedulerDetail',
    'mockReplacement',
    'recordsTable',
    'logsList'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
});

test('frontend api points only to local mock backend', () => {
  const api = readFileSync('frontend/src/api.js', 'utf8');
  assert.match(api, /127\.0\.0\.1:3001/);
  assert.doesNotMatch(api, /openpf\.fenbeitong\.com/);
  assert.doesNotMatch(api, new RegExp(['k3', 'cloud'].join('')));
});

test('frontend api exposes formal product workflow endpoints', () => {
  const api = readFileSync('frontend/src/api.js', 'utf8');
  assert.match(api, /system\/status/);
  assert.match(api, /api\/ready/);
  assert.match(api, /scheduler\/status/);
  assert.match(api, /scheduler\/run-once/);
  assert.match(api, /fenbeitong-voucher\/sync/);
  assert.match(api, /fenbeitong-voucher\/push-erp/);
  assert.match(api, /operations\/logs/);
});
