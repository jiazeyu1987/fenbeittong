import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('frontend page exposes expected workflow controls', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  for (const id of [
    'financeWorkbenchHeader',
    'ledgerToolbar',
    'companySelect',
    'kingdeeAccountSelect',
    'kingdeeAcctIdSelect',
    'kingdeeAccountStatusText',
    'kingdeeAcctIdStatusText',
    'tenantStatusText',
    'searchFieldSelect',
    'matchModeSelect',
    'sourceSearchInput',
    'requesterFilterSelect',
    'sourceTypeFilterSelect',
    'dateFilterSelect',
    'queryLedgerButton',
    'selectAllRowsCheckbox',
    'syncFenbeitongButton',
    'generateVoucherButton',
    'saveErpButton',
    'resaveErpButton',
    'viewVoucherButton',
    'exportButton',
    'resetButton',
    'columnSettingsButton',
    'columnSettingsPanel',
    'paginationSummary',
    'pageSizeSelect',
    'previousPageButton',
    'paginationPageButtons',
    'currentPageButton',
    'nextPageButton',
    'gotoPageInput',
    'gotoPageButton',
    'financeQueuePanel',
    'financeReviewPanel',
    'exceptionCount',
    'draftCount',
    'riskCount',
    'financeReviewSummary',
    'sourceQueueFilters',
    'environmentWarning',
    'operationFeedback',
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
    'sourceQueueTotals',
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
  assert.match(html, /璞慧/);
  assert.match(html, /瑛泰/);
  assert.match(html, /ERP账号/);
  assert.match(html, /acctID/);
  assert.match(app, /selectedTenantKey/);
  assert.match(app, /selectedKingdeeAccountKey/);
  assert.match(app, /selectedKingdeeAcctIdKey/);
  assert.match(app, /kingdeeAccountKey: state\.selectedKingdeeAccountKey/);
  assert.match(app, /kingdeeAcctIdKey: state\.selectedKingdeeAcctIdKey/);
  assert.match(app, /api\.saveIntegrationSettings/);
  assert.match(app, /接口等待开发中/);
  assert.match(app, /syncFenbeitong\(\{ tenantKey: state\.selectedTenantKey \}\)/);
  assert.match(html, /生成费用报销单/);
  assert.match(html, /保存费用报销单/);
  assert.match(html, /查看费用报销单/);
  assert.match(html, /data-column-key="operationPanel"/);
  assert.match(html, /&#x64CD;&#x4F5C;&#x9762;&#x677F;/);
  assert.doesNotMatch(html, /Fenbeitong Kingdee Voucher Integration/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.match(app, /renderFinanceReview/);
  assert.match(app, /financeReviewSummary/);
  assert.match(app, /selectedSourceIds/);
  assert.match(app, /toggleAllFilteredDocuments/);
  assert.match(app, /已全选当前筛选结果/);
  assert.match(app, /sortLedgerRecords/);
  assert.match(app, /toggleQueuedDocument/);
  assert.match(app, /matchesLedgerQuery/);
  assert.match(app, /toggleColumnSettings/);
  assert.match(app, /visibleColumnKeys/);
  assert.match(app, /generateExpenseReimbursementFromRow/);
  assert.match(app, /row-generate-expense-reimbursement/);
  assert.match(app, /showOperationFeedback/);
  assert.match(app, /saveExpenseReimbursementRowToErp/);
  assert.match(app, /resaveSelectedToErp/);
  assert.match(app, /重新保存至ERP成功/);
  assert.match(app, /已经保存到金蝶，无需重复保存/);
  assert.doesNotMatch(app, /options\.forceRetry \|\| state\.pushedSourceIds/);
  assert.match(app, /async function generateExpenseReimbursementsFromLedger\(\)[\s\S]*generateExpenseReimbursementForRecord\(record\)/);
  assert.match(app, /BATCH_PARTIAL_FAILURE/);
  assert.match(app, /其他单据已继续处理/);
  assert.match(app, /isMissingKingdeeEmployee/);
  assert.match(app, /已跳过.*金蝶未建档人员/);
  assert.match(app, /controls\.primaryAction\.dataset\.action[\s\S]*'push'/);
  assert.match(app, /api\.saveErp/);
  assert.match(app, /api\.getProcess/);
  assert.match(app, /api\.createCsvExport/);
  assert.doesNotMatch(app, /URL\.createObjectURL/);
  assert.doesNotMatch(app, /new Blob/);
  assert.doesNotMatch(app, /link\.click\(\)/);
  assert.match(app, /exported\.localPath/);
  assert.match(app, /保存成功/);
});

test('frontend uses fullscreen ledger table layout', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(html, /class="ledger-shell"/);
  assert.match(html, /id="ledgerToolbar"/);
  assert.match(html, /&#x8BF7;&#x8F93;&#x5165;&#x62A5;&#x9500;&#x5355;&#x53F7;/);
  assert.match(html, /&#x540C;&#x6B65;&#x5206;&#x8D1D;&#x901A;/);
  assert.match(html, /生成费用报销单/);
  assert.match(html, /保存费用报销单/);
  assert.match(html, /查看费用报销单/);
  assert.match(html, /&#x5BFC;&#x51FA;/);
  assert.match(html, /&#x663E;&#x793A;&#x5B57;&#x6BB5;/);
  assert.match(html, /Total/);
  assert.match(html, /data-sort-field="sourceCode"/);
  assert.match(html, /data-sort-field="splitTaxAmount"/);
  assert.match(html, /data-sort-field="splitExcludingTaxAmount"/);
  assert.match(html, /data-sort-field="departmentAttributionAmount"/);
  assert.match(html, /data-sort-field="time"/);
  assert.match(html, /data-column-key="operationPanel"/);
  assert.match(html, /id="selectAllRowsCheckbox"/);
  assert.match(html, /data-column-toggle="splitTaxAmount"/);
  assert.match(html, /data-column-toggle="splitExcludingTaxAmount"/);
  assert.match(html, /data-column-toggle="departmentAttributionAmount"/);
  assert.match(html, /data-column-toggle="requester"/);
  assert.doesNotMatch(html, /class="metric-grid"/);
  assert.doesNotMatch(html, /&#x7B2C;&#x4E09;&#x65B9;&#x5BFC;&#x5165;/);
  assert.match(css, /\.ledger-toolbar \.primary-action\s*{[^}]*width:\s*auto;/s);
  assert.match(css, /\.ledger-toolbar button,[\s\S]*?height:\s*32px;/);
  assert.match(css, /\.ledger-toolbar button,[\s\S]*?white-space:\s*nowrap;/);
});

test('row operation actions use compact text-button styling', () => {
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(css, /\.operation-panel-cell\s*{[^}]*min-width:\s*88px;/s);
  assert.match(css, /\.row-action\s*{[^}]*padding:\s*0 2px;/s);
  assert.match(css, /\.row-action\s*{[^}]*height:\s*auto;/s);
  assert.match(css, /\.row-generate-expense-reimbursement\s*{[^}]*min-width:\s*auto;/s);
  assert.match(css, /\.row-generate-expense-reimbursement\s*{[^}]*border:\s*0;/s);
  assert.match(css, /\.row-generate-expense-reimbursement\s*{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(css, /\.row-generate-expense-reimbursement\s*{[^}]*min-width:\s*\d+px;/s);
});

test('long expense type text wraps inside the ledger cell', () => {
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(css, /\.ledger-table td\[data-column-key="expenseCategories"\]\s*{[^}]*white-space:\s*normal;/s);
  assert.match(css, /\.ledger-table td\[data-column-key="expenseCategories"\]\s*{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.ledger-table td\[data-column-key="expenseCategories"\]\s*{[^}]*word-break:\s*break-word;/s);
});

test('pagination exposes explicit page jump by button and Enter key', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /id="gotoPageInput"/);
  assert.match(html, /id="gotoPageButton"[^>]*>跳转<\/button>/);
  assert.match(app, /gotoPageButton\.addEventListener\('click', jumpToRequestedLedgerPage\)/);
  assert.match(app, /event\.key === 'Enter'[\s\S]*jumpToRequestedLedgerPage\(\)/);
  assert.match(app, /function jumpToRequestedLedgerPage\(\)/);
});

test('ledger supports requester/source filters and filtered amount totals', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(html, /id="requesterFilterSelect"[\s\S]*全部报销人/);
  assert.match(html, /id="sourceTypeFilterSelect"[\s\S]*全部来源类型/);
  assert.match(html, /id="dateFilterSelect"[\s\S]*全部日期/);
  assert.match(html, /id="sourceQueueTotals"/);
  assert.match(app, /function renderLedgerFilterOptions\(records,\s*requesterCatalog/);
  assert.match(app, /function renderLedgerTotals\(records\)/);
  assert.match(app, /requesterFilterSelect\.value/);
  assert.match(app, /sourceTypeFilterSelect\.value/);
  assert.match(app, /dateFilterSelect\.value/);
  assert.match(app, /summary\.paymentDate !== dateFilterSelect\.value/);
  assert.match(app, /filterSelect\.addEventListener\('change',[\s\S]*clearLedgerSelection/);
  assert.match(app, /function clearLedgerSelection\(reason\)/);
  assert.match(app, /filteredSourceIds\.has\(record\.sourceId\)/);
  for (const key of [
    'splitTaxAmount',
    'splitExcludingTaxAmount',
    'departmentAttributionAmount',
    'requestPaymentAmount',
    'paymentAmount'
  ]) {
    assert.match(app, new RegExp(`'${key}'`));
  }
  assert.match(css, /\.ledger-table \.ledger-total-row td\s*{[^}]*position:\s*sticky;/s);
});

test('view action is enabled only after a source document has a process record', () => {
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(app, /async function queryProcess\(\)/);
  assert.match(app, /state\.preparedSourceIds\.has\(sourceId\) \|\| state\.pushedSourceIds\.has\(sourceId\)/);
  assert.match(app, /该来源单据尚未生成费用报销单，请先点击“生成费用报销单”/);
  assert.match(app, /const canViewVoucher = state\.preparedSourceIds\.has\(viewSourceId\)/);
  assert.match(app, /controls\.viewVoucher\.disabled = !canViewVoucher/);
});

test('all rendered tables expose draggable column resize handles', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  const css = readFileSync('frontend/src/styles.css', 'utf8');
  assert.match(html, /<thead><tr><th>来源ID<\/th>/);
  assert.match(app, /setupResizableTables\(\)/);
  assert.match(app, /column-resize-handle/);
  assert.match(app, /startColumnResize/);
  assert.match(app, /autoFitTableColumn/);
  assert.match(app, /resetTableRowHeights/);
  assert.match(app, /dblclick/);
  assert.match(app, /双击自动适应列宽和行高/);
  assert.match(app, /MutationObserver/);
  assert.match(css, /\.column-resize-handle\s*{/);
  assert.match(css, /cursor:\s*col-resize/);
  assert.match(css, /#voucherPreviewBody,[\s\S]*#technicalDetails\s*{[\s\S]*overflow-x:\s*auto/);
});

test('Fenbeitong columns use canonical synchronized business fields', () => {
  const html = readFileSync('frontend/src/index.html', 'utf8');
  const app = readFileSync('frontend/src/app.js', 'utf8');
  assert.match(html, /data-column-key="sourceCode"[^>]*>[\s\S]*?来源单号/);
  assert.match(html, /data-column-key="requester">报销人/);
  assert.match(html, /data-column-key="expenseCategories">费用类型/);
  assert.match(html, /data-column-key="startLocation">出发地/);
  assert.match(html, /data-column-key="arrivalLocation">目的地/);
  assert.match(html, /data-column-key="trafficType">交通类型/);
  assert.match(html, /data-column-key="purpose">用途/);
  assert.match(html, /data-column-key="expenseDepartment">费用承担部门/);
  assert.match(html, /data-column-key="splitTaxAmount"[^>]*>[\s\S]*?税额/);
  assert.match(html, /data-column-key="splitExcludingTaxAmount"[^>]*>[\s\S]*?不含税金额/);
  assert.match(html, /data-column-key="departmentAttributionAmount"[^>]*>[\s\S]*?报销金额/);
  assert.match(html, /title="对应分贝通本次拆分税额"/);
  assert.match(html, /title="对应分贝通本次拆分不含税金额"/);
  assert.match(html, /title="对应分贝通费用归属部门金额"/);
  assert.match(html, /data-column-key="time"[^>]*>[\s\S]*?日期/);
  assert.doesNotMatch(html, /更新时间/);
  assert.match(app, /record\.paymentDate/);
  assert.match(app, /record\.totalAmount/);
  assert.match(app, /record\.splitTaxAmount/);
  assert.match(app, /record\.splitExcludingTaxAmount/);
  assert.match(app, /record\.departmentAttributionAmount/);
  assert.match(app, /record\.requesterName/);
  assert.match(app, /record\.expenseTypes/);
  assert.match(app, /record\.startLocation/);
  assert.match(app, /record\.arrivalLocation/);
  assert.match(app, /record\.trafficType/);
  assert.match(app, /record\.purpose/);
  assert.match(app, /record\.expenseDepartment/);
  assert.match(app, /function expenseReimbursementTimingForRecord\(record\)/);
  assert.match(app, /documentDate: paymentDate/);
  assert.match(app, /period: Number\(matched\[2\]\)/);
  assert.match(app, /buildExpenseReimbursementRequestForRecord\(sourceRecord\)/);
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
  assert.match(html, /生成费用报销单/);
  assert.match(html, /保存费用报销单/);
  assert.match(html, /查看费用报销单/);
  assert.match(app, /generateExpenseReimbursementsFromLedger/);
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
  assert.match(api, /127\.0\.0\.1:3101/);
  assert.match(api, /location\?\.port === '5273'/);
  assert.doesNotMatch(api, /openpf\.fenbeitong\.com/);
  assert.doesNotMatch(api, new RegExp(['k3', 'cloud'].join('')));
});

test('frontend api exposes formal product workflow endpoints', () => {
  const api = readFileSync('frontend/src/api.js', 'utf8');
  const contract = readFileSync('docs/api-contract.md', 'utf8');
  assert.match(api, /system\/status/);
  assert.match(api, /integration-settings/);
  assert.match(api, /api\/ready/);
  assert.match(api, /scheduler\/status/);
  assert.match(api, /scheduler\/run-once/);
  assert.match(api, /fenbeitong-expense-reimbursement\/sync/);
  assert.match(api, /fenbeitong-expense-reimbursement\/synced-documents/);
  assert.match(contract, /fenbeitong-expense-reimbursement\/synced-documents/);
  assert.match(api, /fenbeitong-expense-reimbursement\/save-erp/);
  assert.match(api, /operations\/logs/);
});
