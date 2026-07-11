import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  for (const id of [
    'financeWorkbenchHeader',
    'ledgerToolbar',
    'searchFieldSelect',
    'matchModeSelect',
    'sourceSearchInput',
    'queryLedgerButton',
    'selectAllRowsCheckbox',
    'syncFenbeitongButton',
    'generateVoucherButton',
    'saveErpButton',
    'viewVoucherButton',
    'exportButton',
    'resetButton',
    'columnSettingsButton',
    'columnSettingsPanel',
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
  assert.match(html, /&#x62A5;&#x9500;&#x5355;&#x53F7;/);
  assert.match(html, /&#x5355;&#x636E;&#x72B6;&#x6001;/);
  assert.match(html, /&#x540C;&#x6B65;&#x5206;&#x8D1D;&#x901A;/);
  assert.match(html, /&#x751F;&#x6210;&#x51ED;&#x8BC1;/);
  assert.match(html, /&#x4FDD;&#x5B58;&#x81F3;ERP/);
  assert.match(html, /&#x67E5;&#x770B;&#x51ED;&#x8BC1;/);
  assert.doesNotMatch(html, /Fenbeitong Kingdee Voucher Integration/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.match(app, /renderFinanceReview/);
  assert.match(app, /financeReviewSummary/);
  assert.match(app, /selectedSourceIds/);
  assert.match(app, /sortLedgerRecords/);
  assert.match(app, /toggleQueuedDocument/);
  assert.match(app, /matchesLedgerQuery/);
  assert.match(app, /toggleColumnSettings/);
  assert.match(app, /visibleColumnKeys/);
});

test('frontend uses fullscreen ledger table layout', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(html, /class="ledger-shell"/);
  assert.match(html, /id="ledgerToolbar"/);
  assert.match(html, /&#x8BF7;&#x8F93;&#x5165;&#x62A5;&#x9500;&#x5355;&#x53F7;/);
  assert.match(html, /&#x540C;&#x6B65;&#x5206;&#x8D1D;&#x901A;/);
  assert.match(html, /&#x751F;&#x6210;&#x51ED;&#x8BC1;/);
  assert.match(html, /&#x4FDD;&#x5B58;&#x81F3;ERP/);
  assert.match(html, /&#x67E5;&#x770B;&#x51ED;&#x8BC1;/);
  assert.match(html, /&#x5BFC;&#x51FA;/);
  assert.match(html, /&#x663E;&#x793A;&#x5B57;&#x6BB5;/);
  assert.match(html, /Total/);
  assert.match(html, /data-sort-field="sourceCode"/);
  assert.match(html, /data-sort-field="amount"/);
  assert.match(html, /data-sort-field="time"/);
  assert.match(html, /id="selectAllRowsCheckbox"/);
  assert.match(html, /data-column-toggle="amount"/);
  assert.match(html, /data-column-toggle="requester"/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.doesNotMatch(html, /&#x7B2C;&#x4E09;&#x65B9;&#x5BFC;&#x5165;/);
  assert.match(css, /\.ledger-toolbar \.primary-action\s*{[^}]*width:\s*auto;/s);
  assert.match(css, /\.ledger-toolbar button,[\s\S]*?height:\s*32px;/);
  assert.match(css, /\.ledger-toolbar button,[\s\S]*?white-space:\s*nowrap;/);
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

test('frontend visible copy remains readable and not corrupted', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.doesNotMatch(html, /\?\?\?\?\?/);
  assert.doesNotMatch(html, /\uFFFD/);
  assert.match(html, /&#x540C;&#x6B65;&#x5206;&#x8D1D;&#x901A;/);
  assert.match(html, /&#x751F;&#x6210;&#x51ED;&#x8BC1;/);
  assert.match(html, /&#x4FDD;&#x5B58;&#x81F3;ERP/);
  assert.match(html, /&#x67E5;&#x770B;&#x51ED;&#x8BC1;/);
  assert.match(app, /generateVoucherFromLedger/);
  assert.match(app, /controls.saveErp/);
});

test('frontend visible copy is production finance copy', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  for (const pattern of [/mock JSON/i, /IntRuoyi/, /127\.0\.0\.1/, /&#x7B2C;&#x4E09;&#x65B9;&#x5BFC;&#x5165;/]) {
    assert.doesNotMatch(html, pattern);
  }
  for (const pattern of [/mock 保存/i, /mock 数据/i, /mock替代/i]) {
    assert.doesNotMatch(app, pattern);
  }
  assert.match(html, /&#x5355;&#x636E;&#x72B6;&#x6001;/);
  assert.match(html, /&#x62A5;&#x9500;&#x4EBA;/);
  assert.match(html, /&#x90E8;&#x95E8;/);
  assert.match(html, /接口来源/);
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
  assert.match(contract, /fenbeitong-voucher\/synced-documents/);
  assert.match(api, /fenbeitong-voucher\/push-erp/);
  assert.match(api, /operations\/logs/);
});
