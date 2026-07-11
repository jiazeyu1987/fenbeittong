import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  assert.match(html, /同步分贝通/);
  assert.match(html, /预览金蝶凭证/);
  assert.match(html, /生成本地准备记录/);
  assert.match(html, /推送到 ERP/);
  assert.match(html, /分贝通金蝶凭证集成工作台/);
  assert.match(html, /金蝶凭证写入字段/);
  assert.match(html, /分贝通来源字段/);
  assert.match(html, /本地处理字段/);
  assert.match(html, /操作日志/);
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
  assert.match(api, /fenbeitong-voucher\/sync/);
  assert.match(api, /fenbeitong-voucher\/push-erp/);
  assert.match(api, /operations\/logs/);
});
