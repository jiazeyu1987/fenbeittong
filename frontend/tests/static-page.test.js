import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  for (const id of [
    'environmentWarning',
    'businessSteps',
    'nextActionText',
    'primaryActionButton',
    'actionBlockReason',
    'syncBatchSummary',
    'loadTemplateButton',
    'saveConfigButton',
    'syncButton',
    'runSchedulerButton',
    'previewButton',
    'prepareButton',
    'pushErpButton',
    'schedulerEnabled',
    'schedulerDetail',
    'selfCheckList',
    'mockReplacement',
    'sourceQueueBody',
    'configValidationList',
    'saveConfirmPanel',
    'saveConfirmSummary',
    'saveRiskNotice',
    'voucherValidationList',
    'teacherAcceptanceList',
    'developerValidationPanel',
    'voucherPreviewBody',
    'previewDebitTotal',
    'previewCreditTotal',
    'previewLineCount',
    'resultSummary',
    'technicalDetails',
    'recordsTable',
    'logsList'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
});

test('frontend source is productized rather than a raw debug console', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /<details id="technicalDetails"/);
  assert.match(app, /renderVoucherPreview/);
  assert.match(app, /renderSelfCheck/);
  assert.match(app, /renderSourceQueue/);
  assert.match(app, /renderConfigValidation/);
  assert.match(app, /renderVoucherValidation/);
  assert.match(app, /renderTeacherAcceptance/);
  assert.match(app, /buildSourceSummary/);
  assert.match(app, /actionBlockReason/);
  assert.match(app, /renderSaveConfirmation/);
  assert.match(app, /showError/);
  assert.match(app, /draftOnlyWarning/);
});

test('frontend visible copy remains readable Chinese without mojibake', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  for (const text of [html, app]) {
    assert.doesNotMatch(text, /鍒|閫|铦|鏆|璐|绋|棰|寰|姝|俙|榻|€\?|鈧|缁|妫|瀵|濮/);
  }
  assert.match(html, /待处理单据队列/);
  assert.match(html, /老师验收清单/);
  assert.match(html, /Mock 保存 ERP 草稿/);
  assert.match(app, /失败步骤/);
  assert.match(app, /预览已失效/);
});

test('frontend api points only to local mock backend', () => {
  const api = readFileSync('frontend/src/api.js', 'utf8');
  assert.match(api, /127\.0\.0\.1:3001/);
  assert.doesNotMatch(api, /openpf\.fenbeitong\.com/);
  assert.doesNotMatch(api, new RegExp(['k3', 'cloud'].join('')));
});

test('frontend api exposes formal product workflow endpoints', () => {
  const api = readFileSync('frontend/src/api.js', 'utf8');
  const contract = readFileSync('docs/api-contract.md', 'utf8');
  assert.match(api, /system\/status/);
  assert.match(api, /api\/ready/);
  assert.match(api, /scheduler\/status/);
  assert.match(api, /scheduler\/run-once/);
  assert.match(api, /fenbeitong-voucher\/sync/);
  assert.match(api, /fenbeitong-voucher\/synced-documents/);
  assert.match(contract, /GET `\/api\/fenbeitong-voucher\/synced-documents`/);
  assert.match(api, /fenbeitong-voucher\/push-erp/);
  assert.match(api, /operations\/logs/);
});
