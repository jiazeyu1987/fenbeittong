import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  for (const id of [
    'financeWorkbenchHeader',
    'ledgerToolbar',
    'sourceSearchInput',
    'queryLedgerButton',
    'importButton',
    'exportButton',
    'resetButton',
    'columnSettingsButton',
    'paginationSummary',
    'pageSizeSelect',
    'currentPageButton',
    'gotoPageInput',
    'financeQueuePanel',
    'financeReviewPanel',
    'exceptionCount',
    'draftCount',
    'riskCount',
    'financeReviewSummary',
    'sourceQueueFilters',
    'environmentWarning',
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
    'mockReplacement',
    'sourceQueueBody',
    'configValidationList',
    'saveConfirmPanel',
    'saveConfirmSummary',
    'saveRiskNotice',
    'voucherValidationList',
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

test('frontend is centered on a finance source document list', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /报销单列表/);
  assert.match(html, /报销单号/);
  assert.match(html, /单据状态/);
  assert.match(html, /来源单号/);
  assert.match(html, /报销人/);
  assert.match(html, /费用类型/);
  assert.match(html, /接口来源/);
  assert.match(html, /第三方导入/);
  assert.doesNotMatch(html, /Fenbeitong Kingdee Voucher Integration/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.match(app, /renderFinanceReview/);
  assert.match(app, /financeReviewSummary/);
});

test('frontend uses fullscreen ledger table layout', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  assert.match(html, /class="ledger-shell"/);
  assert.match(html, /id="ledgerToolbar"/);
  assert.match(html, /placeholder="请输入报销单号"/);
  assert.match(html, /第三方导入/);
  assert.match(html, /导出/);
  assert.match(html, /显示字段/);
  assert.match(html, /Total/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.doesNotMatch(html, /财务处理概览/);
  assert.doesNotMatch(html, /建议下一步/);
});

test('frontend source is productized rather than a raw debug console', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /<details id="technicalDetails"/);
  assert.match(app, /renderVoucherPreview/);
  assert.match(app, /renderSourceQueue/);
  assert.match(app, /renderConfigValidation/);
  assert.match(app, /renderVoucherValidation/);
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
  assert.match(html, /报销单列表/);
  assert.match(html, /凭证生成工作台/);
  assert.match(html, /保存ERP草稿/);
  assert.match(app, /失败步骤/);
  assert.match(app, /错误编码/);
  assert.match(html, /报销单列表/);
  assert.match(html, /第三方导入/);
  assert.match(html, /显示字段/);
  assert.match(app, /预览已失效/);
});

test('frontend visible copy is production finance copy', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  const bannedHtmlCopy = [
    /老师/,
    /学生/,
    /开发者/,
    /教学/,
    /mock JSON/i,
    /固定 JSON/i,
    /接口调试/,
    /验证命令/,
    /IntRuoyi/,
    /127\.0\.0\.1/
  ];
  for (const pattern of bannedHtmlCopy) {
    assert.doesNotMatch(html, pattern);
  }
  for (const pattern of [/老师/, /学生/, /开发者/, /mock 保存/i, /mock 数据/i, /mock替代/i]) {
    assert.doesNotMatch(app, pattern);
  }
  assert.match(html, /单据状态/);
  assert.match(html, /报销人/);
  assert.match(html, /金额/);
  assert.match(html, /接口来源/);
  assert.match(html, /更新时间/);
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
