import { api } from './api.js';

import {
  expenseReimbursementSelectionKey,
  formatBatchFailureDetails,
  isConfirmedErpSave,
  isMissingKingdeeEmployee,
  isSkippableKingdeeBusinessRule,
  runBatchOperation
} from './batch-operation.js';

import { encodeCsvCell } from './csv-export.js';
import { summarizeExpenseInvoices } from './invoice-fields.js';
import { calculatePagination, visiblePageNumbers } from './pagination.js';
import { formatFieldMapping, parseFieldMapping } from './field-mapping.js';
import { saveCsvToDesktop } from './desktop-export.js';
import { filterInterfaceFieldCatalog, interfaceFieldCatalog } from './interface-field-catalog.js';

const ERP_BATCH_CONCURRENCY = 3;

const fields = {
  mockDocumentDate: document.querySelector('#mockDocumentDate'),
  mockYear: document.querySelector('#mockYear'),
  mockPeriod: document.querySelector('#mockPeriod'),
  expenseItemNumberMappings: document.querySelector('#expenseItemNumberMappings'),
  employeeDetailNumberMappings: document.querySelector('#employeeDetailNumberMappings'),
  departmentDetailNumberMappings: document.querySelector('#departmentDetailNumberMappings'),
  organizationNumberMappings: document.querySelector('#organizationNumberMappings'),
  currencyNumbers: document.querySelector('#currencyNumbers'),
  mockFixedJson: document.querySelector('#mockFixedJson')
};

const controls = {
  primaryAction: document.querySelector('#primaryActionButton'),
  syncFenbeitong: document.querySelector('#syncFenbeitongButton'),
  generateVoucher: document.querySelector('#generateVoucherButton'),
  saveErp: document.querySelector('#saveErpButton'),
  resaveErp: document.querySelector('#resaveErpButton'),
  viewVoucher: document.querySelector('#viewVoucherButton'),
  syncPaymentStatus: document.querySelector('#syncPaymentStatusButton'),
  exportLedger: document.querySelector('#exportButton'),
  queryLedger: document.querySelector('#queryLedgerButton'),
  resetLedger: document.querySelector('#resetButton'),
  columnSettings: document.querySelector('#columnSettingsButton'),
  fieldMapping: document.querySelector('#fieldMappingButton'),
  closeFieldMapping: document.querySelector('#closeFieldMappingButton'),
  resetFieldMapping: document.querySelector('#resetFieldMappingButton'),
  saveFieldMapping: document.querySelector('#saveFieldMappingButton'),
  refreshLogs: document.querySelector('#refreshLogsButton'),
  loadTemplate: document.querySelector('#loadTemplateButton'),
  saveConfig: document.querySelector('#saveConfigButton'),
  sync: document.querySelector('#syncButton'),
  runScheduler: document.querySelector('#runSchedulerButton'),
  preview: document.querySelector('#previewButton'),
  prepare: document.querySelector('#prepareButton'),
  pushErp: document.querySelector('#pushErpButton'),
  query: document.querySelector('#queryButton'),
  refresh: document.querySelector('#refreshButton'),
  listRecords: document.querySelector('#listRecordsButton')
};

const state = {
  configSaved: false,
  currentStatus: null,
  currentIntegrationSettings: null,
  selectedTenantKey: 'puhui',
  selectedKingdeeAccountKey: 'current',
  selectedKingdeeAcctIdKey: '',
  selectionDirty: false,
  syncedDocuments: [],
  requesterCatalog: [],
  selectedSourceIds: new Set(),
  visibleColumnKeys: new Set(['status', 'sourceType', 'documentType', 'sourceCode', 'applicationDate', 'time', 'requester', 'employeeOpenBank', 'employeeAccountName', 'employeeBankAccount', 'departmentAttributionAmount', 'splitTaxAmount', 'splitExcludingTaxAmount', 'expenseCategories', 'businessLine', 'reason', 'expenseDepartment', 'department', 'erpPaymentBillType', 'erpBankProcessingStatus', 'erpPaymentDate', 'startLocation', 'arrivalLocation', 'trafficType', 'purpose', 'expenseOrganization', 'paymentAmount', 'invoiceType', 'invoiceCode', 'invoiceNumber', 'invoiceIssueDate', 'sellerName', 'buyerName', 'invoiceTaxAmount', 'invoiceExcludingTaxAmount', 'invoiceTotalAmount', 'requestOrganization', 'requestPaymentAmount', 'sourceDocumentStatus', 'interfaceSource']),
  sortField: 'time',
  sortDirection: 'desc',
  lastPreview: null,
  previewSignature: '',
  previewInvalidReason: '',
  preparedSourceIds: new Set(),
  pushedSourceIds: new Set(),
  batchSaveRunning: false,
  batchSavePaused: false,
  batchSaveResumeWaiters: [],
  failedErpSaveRecords: [],
  erpTemplateDefaults: null,
  ledgerPage: 1,
  ledgerPageSize: 20
};

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const resultSummary = document.querySelector('#resultSummary');
const sourceIdInput = document.querySelector('#sourceIdInput');
const searchFieldSelect = document.querySelector('#searchFieldSelect');
const matchModeSelect = document.querySelector('#matchModeSelect');
const sourceSearchInput = document.querySelector('#sourceSearchInput');
const saveStatusFilterSelect = document.querySelector('#saveStatusFilterSelect');
const requesterFilterSelect = document.querySelector('#requesterFilterSelect');
const sourceTypeFilterSelect = document.querySelector('#sourceTypeFilterSelect');
const dateFilterSelect = document.querySelector('#dateFilterSelect');
const paginationSummary = document.querySelector('#paginationSummary');
const pageSizeSelect = document.querySelector('#pageSizeSelect');
const previousPageButton = document.querySelector('#previousPageButton');
const nextPageButton = document.querySelector('#nextPageButton');
const paginationPageButtons = document.querySelector('#paginationPageButtons');
const gotoPageInput = document.querySelector('#gotoPageInput');
const gotoPageButton = document.querySelector('#gotoPageButton');
const companySelect = document.querySelector('#companySelect');
const tenantStatusText = document.querySelector('#tenantStatusText');
const kingdeeAccountSelect = document.querySelector('#kingdeeAccountSelect');
const kingdeeAccountStatusText = document.querySelector('#kingdeeAccountStatusText');
const kingdeeAcctIdSelect = document.querySelector('#kingdeeAcctIdSelect');
const kingdeeAcctIdStatusText = document.querySelector('#kingdeeAcctIdStatusText');
const recordsTable = document.querySelector('#recordsTable');
const logsList = document.querySelector('#logsList');
const logsUpdatedAt = document.querySelector('#logsUpdatedAt');
const voucherPreviewBody = document.querySelector('#voucherPreviewBody');
const sourceQueueBody = document.querySelector('#sourceQueueBody');
const sourceQueueTotals = document.querySelector('#sourceQueueTotals');
const selectAllRowsCheckbox = document.querySelector('#selectAllRowsCheckbox');
const financeQueuePanel = document.querySelector('#financeQueuePanel');
const columnSettingsPanel = document.querySelector('#columnSettingsPanel');
const fieldMappingPanel = document.querySelector('#fieldMappingPanel');
const fieldMappingStatus = document.querySelector('#fieldMappingStatus');
const interfaceFieldSourceFilter = document.querySelector('#interfaceFieldSourceFilter');
const interfaceFieldQuery = document.querySelector('#interfaceFieldQuery');
const interfaceFieldCount = document.querySelector('#interfaceFieldCount');
const interfaceFieldMappingBody = document.querySelector('#interfaceFieldMappingBody');
const saveConfirmPanel = document.querySelector('#saveConfirmPanel');
const saveConfirmSummary = document.querySelector('#saveConfirmSummary');
const saveRiskNotice = document.querySelector('#saveRiskNotice');
const actionBlockReason = document.querySelector('#actionBlockReason');
const voucherValidationList = document.querySelector('#voucherValidationList');
const previewHashSummary = document.querySelector('#previewHashSummary');
const financeReviewSummary = document.querySelector('#financeReviewSummary');
const operationFeedback = document.querySelector('#operationFeedback');
const operationFeedbackMessage = document.querySelector('#operationFeedbackMessage');
const batchProgress = document.querySelector('#batchProgress');
const batchProgressText = document.querySelector('#batchProgressText');
const batchProgressPercent = document.querySelector('#batchProgressPercent');
const batchProgressFill = document.querySelector('#batchProgressFill');
const pauseSaveButton = document.querySelector('#pauseSaveButton');
const retryFailedSaveButton = document.querySelector('#retryFailedSaveButton');

controls.loadTemplate.addEventListener('click', run(loadTemplate));
controls.syncFenbeitong.addEventListener('click', run(syncFenbeitong));
controls.generateVoucher.addEventListener('click', run(generateExpenseReimbursementsFromLedger));
controls.saveErp.addEventListener('click', run(pushSelectedToErp));
controls.resaveErp.addEventListener('click', run(resaveSelectedToErp));
controls.viewVoucher.addEventListener('click', run(queryProcess));
controls.syncPaymentStatus.addEventListener('click', run(syncPaymentStatusesToFenbeitong));
controls.queryLedger.addEventListener('click', () => {
  clearLedgerSelection('查询条件已变更，请重新选择当前结果中的单据。');
  state.ledgerPage = 1;
  renderSourceQueue(state.syncedDocuments);
});
controls.resetLedger.addEventListener('click', () => {
  sourceSearchInput.value = '';
  searchFieldSelect.value = 'sourceCode';
  matchModeSelect.value = 'contains';
  saveStatusFilterSelect.value = '';
  requesterFilterSelect.value = '';
  sourceTypeFilterSelect.value = '';
  dateFilterSelect.value = '';
  clearLedgerSelection('筛选条件已重置，请重新选择待处理单据。');
  state.ledgerPage = 1;
  renderSourceQueue(state.syncedDocuments);
});
controls.exportLedger.addEventListener('click', run(exportLedgerCsv));
controls.columnSettings.addEventListener('click', toggleColumnSettings);
controls.fieldMapping.addEventListener('click', toggleFieldMappingPanel);
controls.closeFieldMapping.addEventListener('click', closeFieldMappingPanel);
controls.resetFieldMapping.addEventListener('click', run(resetFieldMappings));
controls.saveFieldMapping.addEventListener('click', run(saveFieldMappings));
controls.refreshLogs.addEventListener('click', run(refreshLogs));
pauseSaveButton?.addEventListener('click', toggleBatchSavePause);
retryFailedSaveButton?.addEventListener('click', run(retryFailedErpSaves));
controls.saveConfig.addEventListener('click', run(saveConfig));
controls.sync.addEventListener('click', run(syncFenbeitong));
controls.runScheduler.addEventListener('click', run(runSchedulerOnce));
controls.preview.addEventListener('click', run(preview));
controls.prepare.addEventListener('click', run(prepare));
controls.pushErp.addEventListener('click', run(pushErp));
controls.query.addEventListener('click', run(queryProcess));
controls.refresh.addEventListener('click', run(refreshAll));
controls.listRecords.addEventListener('click', run(refreshRecords));
controls.primaryAction.addEventListener('click', run(runPrimaryAction));
interfaceFieldSourceFilter.addEventListener('change', renderInterfaceFieldMappings);
interfaceFieldQuery.addEventListener('input', renderInterfaceFieldMappings);
companySelect.addEventListener('change', () => {
  state.selectedTenantKey = companySelect.value;
  markIntegrationSelectionDirty();
  renderTenantState();
  renderActionState();
  if (isSelectedTenantWaiting()) {
    show({ tenantKey: state.selectedTenantKey, status: 'waiting_development' }, '接口等待开发中');
  }
});
kingdeeAccountSelect.addEventListener('change', () => {
  state.selectedKingdeeAccountKey = kingdeeAccountSelect.value;
  markIntegrationSelectionDirty();
  renderKingdeeAccountState();
  renderActionState();
});
kingdeeAcctIdSelect.addEventListener('change', () => {
  state.selectedKingdeeAcctIdKey = kingdeeAcctIdSelect.value;
  markIntegrationSelectionDirty();
  renderKingdeeAcctIdState();
  renderActionState();
});
sourceQueueBody.addEventListener('change', run(toggleQueuedDocument));
sourceQueueBody.addEventListener('click', run(generateExpenseReimbursementFromRow));
selectAllRowsCheckbox.addEventListener('change', () => toggleAllFilteredDocuments(selectAllRowsCheckbox.checked));
pageSizeSelect.addEventListener('change', () => {
  state.ledgerPageSize = Number(pageSizeSelect.value);
  state.ledgerPage = 1;
  renderSourceQueue(state.syncedDocuments);
});
previousPageButton.addEventListener('click', () => goToLedgerPage(state.ledgerPage - 1));
nextPageButton.addEventListener('click', () => goToLedgerPage(state.ledgerPage + 1));
paginationPageButtons.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (button) goToLedgerPage(Number(button.dataset.page));
});
gotoPageInput.addEventListener('change', jumpToRequestedLedgerPage);
gotoPageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    jumpToRequestedLedgerPage();
  }
});
gotoPageButton.addEventListener('click', jumpToRequestedLedgerPage);
columnSettingsPanel.addEventListener('change', run(updateVisibleColumn));
financeQueuePanel.addEventListener('click', (event) => {
  const sortButton = event.target.closest('button[data-sort-field]');
  if (!sortButton) {
    return;
  }
  setLedgerSort(sortButton.dataset.sortField);
});
sourceSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    clearLedgerSelection('查询条件已变更，请重新选择当前结果中的单据。');
    state.ledgerPage = 1;
    renderSourceQueue(state.syncedDocuments);
  }
});
for (const filterSelect of [saveStatusFilterSelect, requesterFilterSelect, sourceTypeFilterSelect, dateFilterSelect]) {
  filterSelect.addEventListener('change', () => {
    clearLedgerSelection('筛选条件已变更，请重新选择当前结果中的单据。');
    state.ledgerPage = 1;
    renderSourceQueue(state.syncedDocuments);
  });
}
sourceIdInput.addEventListener('input', () => {
  invalidatePreview('预览已失效：来源单据已变更，请重新预览费用报销单。');
  renderActionState();
});
for (const field of Object.values(fields)) {
  field.addEventListener('input', () => {
    invalidatePreview('预览已失效：费用报销单关键字段已变更，请重新预览。');
    renderActionState();
  });
}

setupResizableTables();
renderInterfaceFieldMappings();

run(async () => {
  await api.health();
  statusBadge.textContent = '后端已连接';
  statusBadge.classList.add('ok');
  await loadCurrentConfig();
  await refreshLogs();
  await refreshAll({ includeLogs: false });
})();

function setupResizableTables() {
  const installHandles = (root = document) => {
    const headers = root.querySelectorAll?.('table th:not([data-resize-ready])') || [];
    for (const header of headers) {
      header.dataset.resizeReady = 'true';
      header.closest('table')?.classList.add('resizable-table');
      const handle = document.createElement('span');
      handle.className = 'column-resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.title = '左右拖动调整列宽；双击自动适应列宽和行高';
      handle.addEventListener('pointerdown', (event) => startColumnResize(event, header));
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        autoFitTableColumn(header);
      });
      header.append(handle);
    }
  };
  installHandles();
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) installHandles(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function startColumnResize(event, header) {
  event.preventDefault();
  event.stopPropagation();
  const table = header.closest('table');
  const headerRow = header.parentElement;
  if (!table || !headerRow) return;
  freezeTableHeaderWidths(headerRow);
  const startX = event.clientX;
  const startWidth = header.getBoundingClientRect().width;
  const startTableWidth = table.getBoundingClientRect().width;
  const minimumTableWidth = table.parentElement?.clientWidth || 0;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  document.body.classList.add('table-column-resizing');
  header.classList.add('is-resizing');
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', (moveEvent) => {
    const width = Math.max(60, startWidth + moveEvent.clientX - startX);
    const delta = width - startWidth;
    header.style.width = `${width}px`;
    header.style.minWidth = `${width}px`;
    table.style.width = `${Math.max(minimumTableWidth, startTableWidth + delta)}px`;
    table.style.minWidth = table.style.width;
    resetTableRowHeights(table);
  }, options);
  window.addEventListener('pointerup', () => {
    controller.abort();
    document.body.classList.remove('table-column-resizing');
    header.classList.remove('is-resizing');
  }, { ...options, once: true });
}

function autoFitTableColumn(header) {
  const table = header.closest('table');
  const headerRow = header.parentElement;
  if (!table || !headerRow) return;
  const columnIndex = [...headerRow.children].indexOf(header);
  const cells = [...table.rows]
    .map((row) => row.cells[columnIndex])
    .filter((cell) => cell && !cell.hidden);
  let contentWidth = 60;
  for (const cell of cells) {
    const previous = {
      width: cell.style.width,
      minWidth: cell.style.minWidth,
      maxWidth: cell.style.maxWidth,
      whiteSpace: cell.style.whiteSpace
    };
    cell.style.width = 'auto';
    cell.style.minWidth = '0';
    cell.style.maxWidth = 'none';
    cell.style.whiteSpace = 'nowrap';
    contentWidth = Math.max(contentWidth, cell.scrollWidth + 4);
    Object.assign(cell.style, previous);
  }
  const currentWidth = header.getBoundingClientRect().width;
  const currentTableWidth = table.getBoundingClientRect().width;
  const minimumTableWidth = table.parentElement?.clientWidth || 0;
  freezeTableHeaderWidths(headerRow);
  const fittedWidth = Math.min(1600, Math.ceil(contentWidth));
  header.style.width = `${fittedWidth}px`;
  header.style.minWidth = `${fittedWidth}px`;
  table.style.width = `${Math.max(minimumTableWidth, currentTableWidth + fittedWidth - currentWidth)}px`;
  table.style.minWidth = table.style.width;
  resetTableRowHeights(table);
}

function freezeTableHeaderWidths(headerRow) {
  for (const cell of [...headerRow.children].filter((item) => !item.hidden)) {
    const width = cell.getBoundingClientRect().width;
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
  }
}

function resetTableRowHeights(table) {
  for (const row of table.rows) {
    row.style.height = 'auto';
    for (const cell of row.cells) cell.style.height = 'auto';
  }
}

async function loadTemplate() {
  const template = await api.getMockTemplate();
  applyTemplate(template);
  state.configSaved = false;
  renderConfigValidation();
  renderActionState();
  show(template, '已加载默认费用报销单参数，请保存配置后开始同步。');
}

async function loadCurrentConfig() {
  const template = await api.getMockTemplate();
  try {
    const saved = await api.getConfig();
    applyTemplate({ ...template, ...saved });
    state.configSaved = true;
    fieldMappingStatus.textContent = '已载入当前生效的字段对应关系。';
  } catch {
    applyTemplate(template);
    state.configSaved = false;
    fieldMappingStatus.textContent = '尚无已保存配置，当前显示默认字段对应关系。';
  }
  renderConfigValidation();
  renderActionState();
}

async function resetFieldMappings() {
  const template = await api.getMockTemplate();
  applyTemplate(template);
  state.configSaved = false;
  fieldMappingStatus.textContent = '已恢复默认映射，点击“保存字段对应关系”后才会生效。';
  renderConfigValidation();
  renderActionState();
}

async function saveFieldMappings() {
  await saveConfig();
  fieldMappingStatus.textContent = `字段对应关系已保存并生效 · ${new Date().toLocaleString('zh-CN')}`;
}

async function saveConfig() {
  const savedSettings = await api.saveIntegrationSettings({
    tenantKey: state.selectedTenantKey,
    kingdeeAccountKey: state.selectedKingdeeAccountKey,
    kingdeeAcctIdKey: state.selectedKingdeeAcctIdKey
  });
  const saved = await api.saveConfig(readConfig());
  state.erpTemplateDefaults = { ...state.erpTemplateDefaults, ...structuredClone(saved) };
  state.configSaved = true;
  state.selectionDirty = false;
  state.currentIntegrationSettings = savedSettings;
  renderConfigValidation();
  show(saved, '配置已保存，可以立即同步分贝通数据。');
  await refreshAll();
}

async function syncFenbeitong() {
  if (isSelectedTenantWaiting()) {
    show({ tenantKey: state.selectedTenantKey, status: 'waiting_development' }, '接口等待开发中');
    return;
  }
  const result = await api.syncFenbeitong({ tenantKey: state.selectedTenantKey });
  selectFirstRecord(result.records);
  invalidatePreview('预览已失效：同步结果已变更，请重新预览费用报销单。');
  show(result, `同步完成，新增或更新 ${result.records.length} 张来源单据。`);
  await refreshAll();
}

async function syncPaymentStatusesToFenbeitong() {
  showOperationFeedback('正在核对金蝶付款单并回传分贝通付款状态，请勿关闭页面。');
  const response = await api.runPaymentStatusSync();
  const result = response.result;
  const summary = [
    `已回传 ${result.syncedCount} 张`,
    `已付款无需重复处理 ${result.alreadyPaidCount} 张`,
    `安全跳过 ${result.skippedCount} 张`,
    `失败 ${result.failedCount} 张`
  ].join('；');
  show(result, `付款状态同步完成：${summary}。`);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  selectFirstRecord(result.sync.records);
  invalidatePreview('预览已失效：同步结果已变更，请重新预览费用报销单。');
  show(result, `定时任务已手动运行，本次同步 ${result.sync.records.length} 张来源单据。`);
  await refreshAll();
}

async function preview() {
  const request = buildExpenseReimbursementRequest();
  const signature = requestSignature(request);
  const result = await api.preview(request);
  state.lastPreview = result;
  state.previewSignature = signature;
  state.previewInvalidReason = '';
  renderVoucherPreview(result);
  renderSaveConfirmation(result);
  renderVoucherValidation(result);
  renderPreviewHashSummary(result);
  show(result, buildPreviewSummary(result));
  await refreshAll();
}

async function prepare() {
  const request = buildExpenseReimbursementRequest();
  const result = await api.preview(request);
  state.lastPreview = result;
  state.previewSignature = requestSignature(request);
  state.previewInvalidReason = '';
  const record = await api.prepare(request);
  sourceIdInput.value = record.sourceId;
  addProcessSourceIds(state.preparedSourceIds, record);
  show(record, '已生成待保存费用报销单。本地记录已保留幂等键和内容哈希。');
  await refreshAll();
}

async function generateExpenseReimbursementsFromLedger() {
  const records = uniqueExpenseReimbursementRecords(selectedLedgerRecords());
  if (records.length === 0) {
    const sourceId = requiredSourceId();
    const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
    if (!record) throw new Error(`待处理单据不存在：${sourceId}`);
    records.push(record);
  }
  const alreadySaved = records.filter((record) => state.pushedSourceIds.has(record.sourceId));
  if (alreadySaved.length > 0) {
    throw new Error(`以下单据已保存到金蝶，请使用“重新保存费用报销单”：${alreadySaved.map(displaySourceCode).join('、')}`);
  }
  const prepared = [];
  for (const record of records) {
    prepared.push(await generateExpenseReimbursementForRecord(record));
  }
  show({ count: prepared.length, records: prepared }, `已按员工和月份生成 ${prepared.length} 张待保存费用报销单，所有订单均作为明细行，尚未写入金蝶。`);
  await refreshAll();
}

async function generateExpenseReimbursementFromRow(event) {
  const button = event.target.closest('button.row-generate-expense-reimbursement');
  if (!button) return;
  event.preventDefault();
  const sourceId = button.dataset.sourceId;
  const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
  if (!record) throw new Error(`待处理单据不存在：${sourceId}`);
  if (state.pushedSourceIds.has(sourceId)) {
    throw new Error('该费用报销单已保存到金蝶，请使用“重新保存费用报销单”。');
  }
  const preparedRecord = await generateExpenseReimbursementForRecord(record);
  show({ count: 1, record: preparedRecord }, '已生成待保存费用报销单，尚未写入金蝶。');
  await refreshAll();
}

async function saveExpenseReimbursementRowToErp(record, options = {}) {
  setActiveSourceRecord(record, false);
  const forceRetry = Boolean(options.forceRetry);
  const requestStartedAt = Date.now();
  let saved;
  try {
    saved = await api.saveErp(buildExpenseReimbursementRequestForRecord(record, {
      forceRetry
    }));
  } catch (error) {
    if (error?.code !== 'LOCAL_BACKEND_UNREACHABLE') throw error;
    const recovered = await confirmErpSaveAfterConnectionFailure(
      record.sourceId,
      forceRetry ? requestStartedAt : 0
    );
    if (isConfirmedErpSave(recovered)
      && isProcessUpdatedAfter(recovered, forceRetry ? requestStartedAt : 0)) {
      saved = recovered;
    } else {
      const confirmationError = new Error(
        recovered
          ? '本地后台连接曾中断；核对后该单据仍停留在“已生成待保存”状态，ERP没有返回保存成功。'
          : '无法连接本地后台服务，也未能确认该单据是否已保存到ERP；为防止重复保存，请恢复连接后重新查询。'
      );
      confirmationError.code = recovered
        ? 'ERP_SAVE_NOT_CONFIRMED'
        : 'LOCAL_BACKEND_UNREACHABLE';
      throw confirmationError;
    }
  }
  const confirmed = isConfirmedErpSave(saved)
    ? saved
    : await api.getProcess(saved.sourceId);
  if (!isConfirmedErpSave(confirmed)) {
    throw new Error(`费用报销单保存后本地状态未确认成功：${record.sourceId}`);
  }
  addProcessSourceIds(state.pushedSourceIds, confirmed);
  deleteProcessSourceIds(state.preparedSourceIds, confirmed);
  return {
    ...confirmed,
    idempotentReplay: Boolean(saved.idempotentReplay)
  };
}

async function generateExpenseReimbursementForRecord(record) {
  setActiveSourceRecord(record, false);
  const request = buildExpenseReimbursementRequestForRecord(record);
  const previewResult = await api.preview(request);
  const preparedRecord = await api.prepare(request);
  state.lastPreview = previewResult;
  state.previewSignature = requestSignature(request);
  state.previewInvalidReason = '';
  addProcessSourceIds(state.preparedSourceIds, preparedRecord);
  return preparedRecord;
}

async function pushSelectedToErp() {
  const records = uniqueExpenseReimbursementRecords(selectedLedgerRecords());
  if (records.length === 0) {
    await pushErp();
    return;
  }
  startBatchProgress(records.length, '保存费用报销单');
  const batch = await runBatchOperation(
    records,
    saveExpenseReimbursementRowToErp,
    (progress) => updateBatchProgress(progress, '保存费用报销单'),
    {
      concurrency: ERP_BATCH_CONCURRENCY,
      waitUntilResumed: waitUntilBatchSaveResumed
    }
  );
  const pushed = batch.successes;
  const skipped = batch.failures
    .filter(({ error }) => isSkippableKingdeeBusinessRule(error))
    .map(({ item: record, error }) => ({
      sourceId: record.sourceId,
      sourceCode: displaySourceCode(record),
      requesterCode: record.requesterCode || '',
      requesterName: record.requesterName || '',
      code: error.code,
      reason: businessRuleSkipReason(error),
      message: error.message
    }));
  const failures = batch.failures
    .filter(({ error }) => !isSkippableKingdeeBusinessRule(error))
    .map(({ item: record, error }) => ({
    sourceId: record.sourceId,
    sourceCode: displaySourceCode(record),
    requesterCode: record.requesterCode || '',
    requesterName: record.requesterName || '',
    code: error.code || 'ERP_SAVE_FAILED',
    message: error.message
  }));
  if (failures.length > 0) {
    setFailedErpSaveRecords(batch.failures.filter(({ error }) => (
      !isSkippableKingdeeBusinessRule(error)
    )));
    const failedPeople = [...new Set(failures.map((failure) =>
      `${failure.requesterName || failure.sourceCode}${failure.requesterCode ? `（${failure.requesterCode}）` : ''}`
    ))].join('、');
    const failureReasons = summarizeBatchFailureReasons(failures);
    const skippedReasons = summarizeBatchSkippedReasons(skipped);
    show({
      error: `有 ${failures.length} 张费用报销单未能保存`,
      code: 'BATCH_PARTIAL_FAILURE',
      successCount: pushed.length,
      failedCount: failures.length,
      skippedCount: skipped.length,
      records: pushed,
      skipped,
      failures
    }, `批量处理结束：已保存 ${pushed.length} 张，业务跳过 ${skipped.length} 张，未保存 ${failures.length} 张。失败原因汇总：${failureReasons}。${skipped.length ? `跳过原因：${skippedReasons}。` : ''}失败人员：${failedPeople}；其他单据已继续处理。\n失败明细：\n${formatBatchFailureDetails(failures)}`);
    finishBatchProgress(records.length, pushed.length, failures.length, true, skipped.length);
    await refreshAll();
    return;
  }
  if (skipped.length > 0) {
    setFailedErpSaveRecords([]);
    const skippedReasons = summarizeBatchSkippedReasons(skipped);
    show({
      successCount: pushed.length,
      skippedCount: skipped.length,
      records: pushed,
      skipped
    }, `批量处理结束：已保存 ${pushed.length} 张，自动跳过 ${skipped.length} 张。跳过原因：${skippedReasons}。`);
    finishBatchProgress(records.length, pushed.length, 0, false, skipped.length);
    await refreshAll();
    return;
  }
  const message = pushed.every((record) => record.idempotentReplay)
    ? '所选费用报销单已经保存到金蝶，无需重复保存。'
    : `全部 ${pushed.length} 张费用报销单保存成功`;
  show({ count: pushed.length, records: pushed }, message);
  setFailedErpSaveRecords([]);
  finishBatchProgress(records.length, pushed.length, 0, false);
  await refreshAll();
}

async function resaveSelectedToErp() {
  let records = uniqueExpenseReimbursementRecords(selectedLedgerRecords());
  if (records.length === 0) {
    const sourceId = sourceIdInput.value.trim();
    const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
    if (record) {
      records = [record];
    }
  }
  if (records.length === 0) {
    throw new Error('请先选择需要保存或重新保存至ERP的单据。');
  }
  const initiallySavedSourceIds = new Set(records
    .filter((record) => state.pushedSourceIds.has(record.sourceId))
    .map((record) => record.sourceId));
  const initiallyUnsavedCount = records.length - initiallySavedSourceIds.size;
  startBatchProgress(records.length, '保存/重新保存费用报销单');
  const batch = await runBatchOperation(
    records,
    (record) => saveExpenseReimbursementRowToErp(record, {
      forceRetry: initiallySavedSourceIds.has(record.sourceId)
    }),
    (progress) => updateBatchProgress(progress, '保存/重新保存费用报销单'),
    {
      concurrency: ERP_BATCH_CONCURRENCY,
      waitUntilResumed: waitUntilBatchSaveResumed
    }
  );
  const skippedFailures = batch.failures
    .filter(({ error }) => isSkippableKingdeeBusinessRule(error));
  const actualFailures = batch.failures
    .filter(({ error }) => !isSkippableKingdeeBusinessRule(error));
  const failedNewCount = actualFailures
    .filter(({ item }) => !initiallySavedSourceIds.has(item.sourceId)).length;
  const skippedNewCount = skippedFailures
    .filter(({ item }) => !initiallySavedSourceIds.has(item.sourceId)).length;
  const failedResaveCount = actualFailures.length - failedNewCount;
  const skippedResaveCount = skippedFailures.length - skippedNewCount;
  const savedNewCount = initiallyUnsavedCount - failedNewCount - skippedNewCount;
  const resavedCount = initiallySavedSourceIds.size - failedResaveCount - skippedResaveCount;
  if (actualFailures.length > 0) {
    setFailedErpSaveRecords(actualFailures);
    const failures = actualFailures.map(({ item: record, error }) => ({
      sourceId: record.sourceId,
      sourceCode: displaySourceCode(record),
      requesterCode: record.requesterCode || '',
      requesterName: record.requesterName || '',
      code: error.code || 'ERP_RESAVE_FAILED',
      message: error.message
    }));
    const skipped = skippedFailures.map(({ item: record, error }) => ({
      sourceId: record.sourceId,
      sourceCode: displaySourceCode(record),
      requesterCode: record.requesterCode || '',
      requesterName: record.requesterName || '',
      code: error.code,
      reason: businessRuleSkipReason(error),
      message: error.message
    }));
    show({
      error: `有 ${failures.length} 张费用报销单未能保存或重新保存`,
      code: 'BATCH_RESAVE_PARTIAL_FAILURE',
      successCount: batch.successes.length,
      savedNewCount,
      resavedCount,
      failedCount: failures.length,
      skippedCount: skipped.length,
      records: batch.successes,
      skipped,
      failures
    }, `批量保存结束：首次保存 ${savedNewCount} 张，重新保存 ${resavedCount} 张，业务跳过 ${skipped.length} 张，未保存 ${failures.length} 张。未全部完成，不显示保存成功。\n失败明细：\n${formatBatchFailureDetails(failures)}`);
    finishBatchProgress(records.length, batch.successes.length, failures.length, true, skipped.length);
    await refreshAll();
    return;
  }
  if (skippedFailures.length > 0) {
    setFailedErpSaveRecords([]);
    show({
      successCount: batch.successes.length,
      savedNewCount,
      resavedCount,
      skippedCount: skippedFailures.length,
      records: batch.successes
    }, `批量处理完成：首次保存 ${savedNewCount} 张，重新保存 ${resavedCount} 张，自动跳过 ${skippedFailures.length} 张。`);
    finishBatchProgress(records.length, batch.successes.length, 0, false, skippedFailures.length);
    await refreshAll();
    return;
  }
  show(
    {
      count: batch.successes.length,
      savedNewCount,
      resavedCount,
      records: batch.successes
    },
    `全部处理成功：首次保存 ${savedNewCount} 张，重新保存 ${resavedCount} 张`
  );
  setFailedErpSaveRecords([]);
  finishBatchProgress(records.length, batch.successes.length, 0, false);
  await refreshAll();
}

async function retryFailedErpSaves() {
  const records = uniqueExpenseReimbursementRecords(state.failedErpSaveRecords
    .map((failed) => state.syncedDocuments.find((record) => (
      record.sourceId === failed.sourceId
    )) || failed));
  if (records.length === 0) {
    throw new Error('当前没有可重试的失败单据。');
  }
  startBatchProgress(records.length, '重试失败单据');
  const batch = await runBatchOperation(
    records,
    (record) => saveExpenseReimbursementRowToErp(record, {
      forceRetry: state.pushedSourceIds.has(record.sourceId)
    }),
    (progress) => updateBatchProgress(progress, '重试失败单据'),
    {
      concurrency: ERP_BATCH_CONCURRENCY,
      waitUntilResumed: waitUntilBatchSaveResumed
    }
  );
  const skippedFailures = batch.failures
    .filter(({ error }) => isSkippableKingdeeBusinessRule(error));
  const actualFailures = batch.failures
    .filter(({ error }) => !isSkippableKingdeeBusinessRule(error));
  setFailedErpSaveRecords(actualFailures);
  if (actualFailures.length > 0) {
    const failures = actualFailures.map(({ item: record, error }) => ({
      sourceId: record.sourceId,
      sourceCode: displaySourceCode(record),
      requesterCode: record.requesterCode || '',
      requesterName: record.requesterName || '',
      code: error.code || 'ERP_RETRY_FAILED',
      message: error.message
    }));
    show({
      error: `重试后仍有 ${failures.length} 张未保存`,
      code: 'BATCH_RETRY_PARTIAL_FAILURE',
      successCount: batch.successes.length,
      failedCount: failures.length,
      records: batch.successes,
      failures
    }, `失败单据重试结束：成功 ${batch.successes.length} 张，仍失败 ${failures.length} 张。可再次点击“重试失败单据”。\n失败明细：\n${formatBatchFailureDetails(failures)}`);
    finishBatchProgress(records.length, batch.successes.length, failures.length, true, skippedFailures.length);
    await refreshAll();
    return;
  }
  if (skippedFailures.length > 0) {
    show({
      successCount: batch.successes.length,
      skippedCount: skippedFailures.length,
      records: batch.successes
    }, `失败单据重试完成：成功 ${batch.successes.length} 张，自动跳过 ${skippedFailures.length} 张。`);
    finishBatchProgress(records.length, batch.successes.length, 0, false, skippedFailures.length);
    await refreshAll();
    return;
  }
  show({ count: batch.successes.length, records: batch.successes }, `本次 ${batch.successes.length} 张失败单据已全部重试保存成功`);
  finishBatchProgress(records.length, batch.successes.length, 0, false);
  await refreshAll();
}

async function pushErp() {
  const sourceId = requiredSourceId();
  const sourceRecord = state.syncedDocuments.find((record) => record.sourceId === sourceId);
  if (!sourceRecord) throw new Error(`待处理单据不存在：${sourceId}`);
  let saved;
  try {
    saved = await api.saveErp(buildExpenseReimbursementRequestForRecord(sourceRecord));
  } catch (error) {
    if (!isSkippableKingdeeBusinessRule(error)) throw error;
    show({
      successCount: 0,
      skippedCount: 1,
      skipped: [{
        sourceId: sourceRecord.sourceId,
        sourceCode: displaySourceCode(sourceRecord),
        requesterCode: sourceRecord.requesterCode || '',
        requesterName: sourceRecord.requesterName || '',
        code: error.code,
        reason: businessRuleSkipReason(error),
        message: error.message
      }]
    }, `已按业务规则跳过：${businessRuleSkipReason(error)}。`);
    return;
  }
  const record = isConfirmedErpSave(saved)
    ? saved
    : await api.getProcess(saved.sourceId);
  if (!isConfirmedErpSave(record)) {
    throw new Error(`费用报销单保存后本地状态未确认成功：${sourceId}`);
  }
  addProcessSourceIds(state.pushedSourceIds, record);
  deleteProcessSourceIds(state.preparedSourceIds, record);
  show(record, saved.idempotentReplay
    ? '该费用报销单已经保存到金蝶，无需重复保存。'
    : '保存成功');
  await refreshAll();
}

async function queryProcess() {
  const sourceId = requiredSourceId();
  if (state.preparedSourceIds.has(sourceId) || state.pushedSourceIds.has(sourceId)) {
    show(await api.getProcess(sourceId), '已读取费用报销单本地处理记录。');
    return;
  }
  show({ sourceId }, '该来源单据尚未生成费用报销单，请先点击“生成费用报销单”。');
}

async function refreshAll(options = {}) {
  const [settings, status, documents, requesters] = await Promise.all([
    api.integrationSettings(),
    api.systemStatus(),
    api.listSyncedDocuments(),
    api.listFenbeitongRequesters(state.selectedTenantKey)
  ]);
  state.currentIntegrationSettings = settings;
  state.currentStatus = status;
  state.syncedDocuments = documents;
  state.requesterCatalog = requesters;
  renderLedgerFilterOptions(documents, requesters);
  renderStatus(status, settings);
  renderSourceQueue(documents);
  await refreshRecords();
  if (options.includeLogs !== false) await refreshLogs();
  renderActionState();
}

async function updateKingdeeAccountSelection() {
  state.selectedKingdeeAccountKey = kingdeeAccountSelect.value;
  markIntegrationSelectionDirty();
  renderKingdeeAccountState();
  show({ kingdeeAccountKey: state.selectedKingdeeAccountKey }, '配置未保存');
}

async function refreshRecords() {
  const records = await api.listProcessRecords();
  const selectedAcctIdRecords = records.filter((record) =>
    record.kingdeeAcctIdKey === state.selectedKingdeeAcctIdKey);
  state.preparedSourceIds = new Set(selectedAcctIdRecords
    .filter((record) => record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED')
    .flatMap(processSourceIds));
  state.pushedSourceIds = new Set(selectedAcctIdRecords
    .filter(isRealPushedRecord)
    .flatMap(processSourceIds));
  renderSourceQueue(state.syncedDocuments);
  if (records.length === 0) {
    recordsTable.innerHTML = '<tr><td colspan="5">暂无记录，请先同步分贝通数据。</td></tr>';
    return;
  }
  recordsTable.innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.sourceId)}</td>
      <td>${escapeHtml(record.sourceCode || '')}</td>
      <td>${escapeHtml(stageName(record.processStage))}</td>
      <td>${escapeHtml(record.erpFid || '-')}</td>
      <td>${escapeHtml(record.updateTime || '')}</td>
    </tr>
  `).join('');
}

async function refreshLogs() {
  const logs = await api.listLogs();
  logsList.innerHTML = logs.length === 0
    ? '暂无日志'
    : logs.slice(0, 20).map((log) => `
      <div class="log-item">
        <span class="log-status ${log.status === 'FAILED' ? 'failed' : 'success'}">${log.status === 'FAILED' ? '失败' : '成功'}</span>
        <span class="log-main">
          <strong>${escapeHtml(logLabel(log.action))}</strong>
          <small>${escapeHtml(logDetailSummary(log.detail))}</small>
        </span>
        <time>${escapeHtml(formatLogTime(log.createdAt))}</time>
      </div>
    `).join('');
  logsUpdatedAt.textContent = `已自动读取最新 ${Math.min(logs.length, 20)} 条 · 刷新时间 ${new Date().toLocaleString('zh-CN')}`;
}

async function runPrimaryAction() {
  const action = controls.primaryAction.dataset.action;
  if (action === 'save-config') return saveConfig();
  if (action === 'sync') return syncFenbeitong();
  if (action === 'preview') return preview();
  if (action === 'prepare') return prepare();
  if (action === 'push') return pushErp();
  throw new Error('当前没有可执行的主操作，请先检查配置和来源单据。');
}

async function toggleQueuedDocument(event) {
  const checkbox = event.target.closest('input[data-source-id]');
  if (!checkbox) return;
  const sourceId = checkbox.dataset.sourceId;
  const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
  if (!record) throw new Error(`待处理单据不存在：${sourceId}`);
  if (checkbox.checked) {
    state.selectedSourceIds.add(sourceId);
    setActiveSourceRecord(record, true);
  } else {
    state.selectedSourceIds.delete(sourceId);
    const nextRecord = state.syncedDocuments.find((item) => state.selectedSourceIds.has(item.sourceId));
    if (nextRecord) {
      setActiveSourceRecord(nextRecord, true);
    } else {
      sourceIdInput.value = '';
      invalidatePreview('预览已失效：已取消选择来源单据，请重新选择后预览费用报销单。');
    }
  }
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
  show({ selectedCount: state.selectedSourceIds.size, lastSelected: record }, `已选择 ${state.selectedSourceIds.size} 张来源单据。`);
}

function toggleAllFilteredDocuments(checked) {
  const filteredRecords = filterLedgerRecords(state.syncedDocuments)
    .filter((record) => !isLegacyUnverified(record));
  for (const record of filteredRecords) {
    if (checked) {
      state.selectedSourceIds.add(record.sourceId);
    } else {
      state.selectedSourceIds.delete(record.sourceId);
    }
  }
  const firstSelected = state.syncedDocuments.find((record) => state.selectedSourceIds.has(record.sourceId));
  if (firstSelected) {
    setActiveSourceRecord(firstSelected, true);
  } else {
    sourceIdInput.value = '';
    invalidatePreview('预览已失效：已取消选择来源单据，请重新选择后预览费用报销单。');
  }
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
  show(
    { selectedCount: state.selectedSourceIds.size },
    checked
      ? `已全选当前筛选结果，共 ${filteredRecords.length} 张来源单据。`
      : '已取消当前筛选结果的全部选择。'
  );
}

function selectedLedgerRecords() {
  const filteredSourceIds = new Set(
    filterLedgerRecords(state.syncedDocuments).map((record) => record.sourceId)
  );
  return [...state.selectedSourceIds]
    .map((sourceId) => state.syncedDocuments.find((record) => record.sourceId === sourceId))
    .filter((record) => record && filteredSourceIds.has(record.sourceId) && !isLegacyUnverified(record));
}

function clearLedgerSelection(reason) {
  if (state.selectedSourceIds.size === 0 && !sourceIdInput.value) return;
  state.selectedSourceIds.clear();
  sourceIdInput.value = '';
  invalidatePreview(reason);
  renderActionState();
}

function uniqueExpenseReimbursementRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = expenseReimbursementGroupKey(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()];
}

function expenseReimbursementGroupKey(record) {
  return expenseReimbursementSelectionKey(record);
}

function processSourceIds(record) {
  return Array.isArray(record?.sourceIds) && record.sourceIds.length > 0
    ? record.sourceIds
    : [record?.sourceId].filter(Boolean);
}

function addProcessSourceIds(target, record) {
  for (const sourceId of processSourceIds(record)) target.add(sourceId);
}

function deleteProcessSourceIds(target, record) {
  for (const sourceId of processSourceIds(record)) target.delete(sourceId);
}

function setActiveSourceRecord(record, invalidate) {
  const timing = expenseReimbursementTimingForRecord(record);
  sourceIdInput.value = record.sourceId;
  fields.mockFixedJson.value = record.fixedJson || fields.mockFixedJson.value;
  fields.mockDocumentDate.value = timing.documentDate;
  fields.mockYear.value = timing.year;
  fields.mockPeriod.value = timing.period;
  if (invalidate) {
    invalidatePreview('预览已失效：已切换来源单据，请重新预览费用报销单。');
  }
}

function renderSelectAllState(filteredRecords) {
  const selectableRecords = filteredRecords.filter((record) => !isLegacyUnverified(record));
  const selectedCount = selectableRecords.filter((record) => state.selectedSourceIds.has(record.sourceId)).length;
  selectAllRowsCheckbox.checked = selectableRecords.length > 0 && selectedCount === selectableRecords.length;
  selectAllRowsCheckbox.indeterminate = selectedCount > 0 && selectedCount < selectableRecords.length;
  selectAllRowsCheckbox.disabled = selectableRecords.length === 0;
}

function renderStatus(status, settings = null) {
  if (!state.selectionDirty) {
    applyIntegrationSelection(settings?.selection || status.config?.integrationSelection || {});
  }
  renderTenantOptions(settings?.tenants || status.config?.fenbeitong?.tenants || []);
  renderKingdeeAccountOptions({
    ...(status.config?.kingdee || {}),
    accounts: settings?.kingdeeAccounts || status.config?.kingdee?.accounts || [],
    acctIds: settings?.kingdeeAcctIds || status.config?.kingdee?.acctIds || []
  });
  renderKingdeeAcctIdOptions({
    ...(status.config?.kingdee || {}),
    acctIds: settings?.kingdeeAcctIds || status.config?.kingdee?.acctIds || []
  });
  renderTenantState();
  renderKingdeeAccountState();
  renderKingdeeAcctIdState();
  document.querySelector('#fenbeitongMode').textContent = status.mode.fenbeitong === 'real' ? '已启用' : '待启用';
  document.querySelector('#kingdeeMode').textContent = status.mode.kingdee === 'real' ? '已启用' : '待启用';
  document.querySelector('#fenbeitongReady').textContent = readinessText(status.readiness.fenbeitong);
  document.querySelector('#kingdeeReady').textContent = readinessText(status.readiness.kingdee);
  document.querySelector('#syncedCount').textContent = status.summary.counts.syncedDocuments;
  document.querySelector('#pushedCount').textContent = status.summary.counts.savedExpenseReimbursements;
  document.querySelector('#draftCount').textContent = status.summary.counts.savedExpenseReimbursements;
  document.querySelector('#exceptionCount').textContent = status.summary.latestBatch?.failCount || 0;
  document.querySelector('#riskCount').textContent = status.summary.counts.savedExpenseReimbursements;
  document.querySelector('#mockReplacement').textContent = status.mode.fenbeitong === 'mock' || status.mode.kingdee === 'mock' ? '未启用' : '已启用';
  document.querySelector('#mockReason').textContent = interfaceReason(status.summary.latestBatch?.mockReason, status.mode.fenbeitong === 'mock');
  document.querySelector('#schedulerEnabled').textContent = status.scheduler.enabled ? '开启' : '关闭';
  document.querySelector('#schedulerDetail').textContent = schedulerSummary(status.scheduler);
  document.querySelector('#environmentWarning').textContent = environmentWarning(status);
  document.querySelector('#syncBatchSummary').textContent = syncBatchSummary(status.summary.latestBatch);
  renderNextAction(status);
  renderConfigValidation();
  renderFinanceReview(state.lastPreview);
}

function renderNextAction(status) {
  const sourceId = sourceIdInput.value.trim();
  const prepared = state.preparedSourceIds.has(sourceId) || status.summary.counts.preparedExpenseReimbursements > 0;
  const pushed = state.pushedSourceIds.has(sourceId) || status.summary.counts.savedExpenseReimbursements > 0;
  let text = '请先保存配置，确保组织、员工、部门、费用项目和币别映射可用。';
  if (pushed) text = '已有费用报销单暂存结果，下一步由财务在金蝶中人工审核。';
  else if (prepared && state.lastPreview) text = '已生成待保存费用报销单，可直接保存到金蝶。';
  else if (state.lastPreview) text = '费用报销单已预览，下一步可直接保存到金蝶。';
  else if (sourceId) text = '已选择来源单据，下一步生成费用报销单并保存到金蝶。';
  else if (status.summary.counts.syncedDocuments > 0) text = '已有待处理单据，请先在列表中选择单据。';
  else if (state.configSaved) text = '配置已保存，下一步同步分贝通数据。';
  document.querySelector('#nextActionText').textContent = text;
}

function renderActionState() {
  const sourceId = sourceIdInput.value.trim();
  const hasSelection = state.selectedSourceIds.size > 0;
  const hasSource = Boolean(hasSelection || sourceId || fields.mockFixedJson.value.trim());
  const pushed = sourceId ? state.pushedSourceIds.has(sourceId) : false;
  const hasPushedSelection = selectedLedgerRecords()
    .some((record) => state.pushedSourceIds.has(record.sourceId));
  const viewSourceId = sourceId || selectedLedgerRecords()[0]?.sourceId || '';
  const canViewVoucher = state.preparedSourceIds.has(viewSourceId)
    || state.pushedSourceIds.has(viewSourceId);
  const tenantWaiting = isSelectedTenantWaiting();
  controls.syncFenbeitong.disabled = tenantWaiting;
  controls.sync.disabled = tenantWaiting;
  controls.generateVoucher.disabled = !hasSource;
  controls.saveErp.disabled = !hasSource || pushed;
  controls.resaveErp.disabled = !hasPushedSelection && !pushed;
  controls.viewVoucher.disabled = !canViewVoucher;
  controls.viewVoucher.title = canViewVoucher ? '' : '请先生成费用报销单';
  controls.preview.disabled = !hasSource;
  controls.prepare.disabled = !hasSource;
  controls.pushErp.disabled = !hasSource || pushed;
  controls.primaryAction.dataset.action = !state.configSaved ? 'save-config' : state.syncedDocuments.length === 0 ? 'sync' : 'push';
  controls.primaryAction.textContent = !state.configSaved ? '保存配置' : state.syncedDocuments.length === 0 ? '立即同步分贝通数据' : '保存费用报销单';
  controls.primaryAction.disabled = tenantWaiting && controls.primaryAction.dataset.action === 'sync';
  actionBlockReason.textContent = getActionBlockReason({ sourceId, pushed });
}

function getActionBlockReason({ sourceId, pushed }) {
  if (isSelectedTenantWaiting()) return '瑛泰接口等待开发中。';
  if (!state.configSaved) return '未满足原因：请先保存配置。';
  if (state.syncedDocuments.length === 0) return '未满足原因：请先同步分贝通单据。';
  if (!sourceId && state.selectedSourceIds.size === 0) return '未满足原因：请先选择待处理单据。';
  if (pushed) return '该单据已保存，下一步由财务人工审核。';
  return '当前可生成费用报销单并保存到金蝶费用报销单列表。';
}

function renderTenantOptions(tenants) {
  if (!Array.isArray(tenants) || tenants.length === 0) {
    return;
  }
  const currentKey = state.selectedTenantKey;
  companySelect.innerHTML = tenants.map((tenant) =>
    `<option value="${escapeHtml(tenant.key)}">${escapeHtml(tenantDisplayName(tenant))}</option>`
  ).join('');
  state.selectedTenantKey = tenants.some((tenant) => tenant.key === currentKey) ? currentKey : 'puhui';
  companySelect.value = state.selectedTenantKey;
}

function renderKingdeeAccountOptions(kingdeeConfig) {
  const accounts = Array.isArray(kingdeeConfig.accounts)
    ? kingdeeConfig.accounts.filter((account) => account.key === 'current')
    : [];
  if (accounts.length === 0) {
    return;
  }
  state.selectedKingdeeAccountKey = 'current';
  kingdeeAccountSelect.innerHTML = accounts.map((account) => {
    const suffix = account.configured ? '' : '（未配置）';
    return `<option value="${escapeHtml(account.key)}" ${account.configured ? '' : 'disabled'}>${escapeHtml(account.label)}${suffix}</option>`;
  }).join('');
  kingdeeAccountSelect.value = state.selectedKingdeeAccountKey;
}

function renderKingdeeAcctIdOptions(kingdeeConfig) {
  const acctIds = Array.isArray(kingdeeConfig.acctIds) ? kingdeeConfig.acctIds : [];
  if (acctIds.length === 0) {
    return;
  }
  const currentKey = state.selectedKingdeeAcctIdKey || kingdeeConfig.selectedAcctIdKey || acctIds[0].key;
  state.selectedKingdeeAcctIdKey = acctIds.some((acctId) => acctId.key === currentKey)
    ? currentKey
    : acctIds.some((acctId) => acctId.key === kingdeeConfig.selectedAcctIdKey)
      ? kingdeeConfig.selectedAcctIdKey
      : acctIds[0].key;
  kingdeeAcctIdSelect.innerHTML = acctIds.map((acctId) => {
    const suffix = acctId.configured ? '' : '（未配置）';
    return `<option value="${escapeHtml(acctId.key)}" ${acctId.configured ? '' : 'disabled'}>${escapeHtml(acctId.label)}${suffix}</option>`;
  }).join('');
  kingdeeAcctIdSelect.value = state.selectedKingdeeAcctIdKey;
}

function renderTenantState() {
  companySelect.value = state.selectedTenantKey;
  const waiting = isSelectedTenantWaiting();
  const name = companySelect.options[companySelect.selectedIndex]?.textContent || state.selectedTenantKey;
  const tenant = state.currentIntegrationSettings?.tenants?.find((item) => item.key === state.selectedTenantKey);
  const appReady = Boolean(tenant?.credentialsConfigured);
  tenantStatusText.textContent = waiting
    ? '接口等待开发中'
    : appReady
      ? `${name}统一接口已启用（线下报销 + 线上结算订单）`
      : `${name}待配置App ID/Key`;
  tenantStatusText.classList.toggle('waiting', waiting || !appReady);
}

function renderKingdeeAccountState() {
  kingdeeAccountSelect.value = state.selectedKingdeeAccountKey;
  const accounts = state.currentStatus?.config?.kingdee?.accounts || [];
  const account = accounts.find((item) => item.key === state.selectedKingdeeAccountKey);
  const configured = Boolean(account?.configured);
  kingdeeAccountStatusText.textContent = configured ? 'ERP账号已配置' : 'ERP账号缺少登录信息';
  kingdeeAccountStatusText.classList.toggle('waiting', !configured);
}

function renderKingdeeAcctIdState() {
  kingdeeAcctIdSelect.value = state.selectedKingdeeAcctIdKey;
  const acctIds = state.currentStatus?.config?.kingdee?.acctIds || [];
  const acctId = acctIds.find((item) => item.key === state.selectedKingdeeAcctIdKey);
  const configured = Boolean(acctId?.configured);
  kingdeeAcctIdStatusText.textContent = configured ? 'acctID已配置' : 'acctID缺少配置';
  kingdeeAcctIdStatusText.classList.toggle('waiting', !configured);
}

function applyIntegrationSelection(selection) {
  if (selection.tenantKey) state.selectedTenantKey = selection.tenantKey;
  state.selectedKingdeeAccountKey = 'current';
  if (selection.kingdeeAcctIdKey) state.selectedKingdeeAcctIdKey = selection.kingdeeAcctIdKey;
}

function markIntegrationSelectionDirty() {
  state.selectionDirty = true;
  state.configSaved = false;
  showOperationFeedback('配置未保存');
}

function tenantDisplayName(tenant) {
  if (tenant.key === 'puhui') return '璞慧';
  if (tenant.key === 'yingtai') return '瑛泰';
  return tenant.name || tenant.key;
}

function isSelectedTenantWaiting() {
  return state.selectedTenantKey === 'yingtai';
}

function renderConfigValidation() {
  const checks = [
    ['目标组织', Boolean(state.erpTemplateDefaults?.expenseReimbursementOrgNumber), '写入费用报销单申请组织和费用承担组织'],
    ['单据日期', Boolean(fields.mockDocumentDate.value), '写入费用报销单日期'],
    ['费用项目映射', hasFieldMapping(fields.expenseItemNumberMappings.value), '分贝通费用类型映射到金蝶费用项目'],
    ['员工映射', hasFieldMapping(fields.employeeDetailNumberMappings.value), '报销人映射到金蝶员工'],
    ['部门映射', hasFieldMapping(fields.departmentDetailNumberMappings.value), '费用归属映射到金蝶部门'],
    ['币别映射', hasFieldMapping(fields.currencyNumbers.value), '分贝通币别映射到 ERP 币别']
  ];
  document.querySelector('#configValidationList').innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}：${ok ? '通过' : '待补齐'}，${escapeHtml(detail)}</li>`
  ).join('');
}

function renderSourceQueue(records) {
  const visibleRecords = sortLedgerRecords(filterLedgerRecords(records));
  const pagination = calculatePagination(visibleRecords.length, state.ledgerPageSize, state.ledgerPage);
  state.ledgerPage = pagination.currentPage;
  const pageRecords = visibleRecords.slice(pagination.startIndex, pagination.endIndex);
  renderPagination(pagination);
  renderSelectAllState(visibleRecords);
  renderLedgerTotals(visibleRecords);
  if (visibleRecords.length === 0) {
    sourceQueueBody.innerHTML = `<tr><td colspan="${ledgerTableColumnCount()}">暂无符合条件的报销单，请调整查询条件或先同步分贝通。</td></tr>`;
    renderColumnVisibility();
    renderFinanceReview(state.lastPreview);
    return;
  }
  sourceQueueBody.innerHTML = pageRecords.map((record) => {
    const summary = buildSourceSummary(record);
    const legacyUnverified = isLegacyUnverified(record);
    const selected = state.selectedSourceIds.has(record.sourceId);
    const prepared = state.preparedSourceIds.has(record.sourceId);
    const pushed = state.pushedSourceIds.has(record.sourceId);
    const actionText = prepared ? '重新生成' : '生成费用报销单';
    return `
      <tr class="${selected ? 'selected' : ''}">
        <td><input class="row-checkbox" type="checkbox" data-source-id="${escapeHtml(record.sourceId)}" aria-label="选择 ${escapeHtml(displaySourceCode(record))}" ${selected ? 'checked' : ''} ${legacyUnverified ? 'disabled' : ''} /></td>
        ${renderLedgerCell('status', `<span class="status-tag">${escapeHtml(queueStatus(record))}</span>`)}
        ${renderLedgerCell('sourceType', escapeHtml(`${summary.sourceKindName}${summary.sourceForm ? ` · ${summary.sourceForm}` : ''}`))}
        ${renderLedgerCell('documentType', escapeHtml(summary.documentType))}
        ${renderLedgerCell('sourceCode', escapeHtml(displaySourceCode(record)))}
        ${renderLedgerCell('applicationDate', escapeHtml(summary.applicationDate || ''))}
        ${renderLedgerCell('time', escapeHtml(summary.paymentDate || ''))}
        ${renderLedgerCell('requester', escapeHtml(displayRequester(record, summary.requester)))}
        ${renderLedgerCell('employeeOpenBank', escapeHtml(summary.employeeOpenBank))}
        ${renderLedgerCell('employeeAccountName', escapeHtml(summary.employeeAccountName))}
        ${renderLedgerCell('employeeBankAccount', escapeHtml(summary.employeeBankAccount))}
        ${renderLedgerCell('departmentAttributionAmount', formatMoney(summary.departmentAttributionAmount), 'amount')}
        ${renderLedgerCell('splitTaxAmount', formatSplitMoney(summary, 'splitTaxAmount'), 'amount')}
        ${renderLedgerCell('splitExcludingTaxAmount', formatSplitMoney(summary, 'splitExcludingTaxAmount'), 'amount')}
        ${renderLedgerCell('expenseCategories', escapeHtml(displayExpenseCategories(record, summary.expenseCategories)))}
        ${renderLedgerCell('businessLine', escapeHtml(summary.businessLine))}
        ${renderLedgerCell('reason', escapeHtml(summary.reason))}
        ${renderLedgerCell('expenseDepartment', escapeHtml(summary.expenseDepartment))}
        ${renderLedgerCell('department', escapeHtml(summary.department))}
        ${renderLedgerCell('erpPaymentBillType', escapeHtml(summary.erpPaymentBillType))}
        ${renderLedgerCell('erpBankProcessingStatus', escapeHtml(summary.erpBankProcessingStatus))}
        ${renderLedgerCell('erpPaymentDate', escapeHtml(summary.erpPaymentDate))}
        ${renderLedgerCell('startLocation', escapeHtml(summary.startLocation))}
        ${renderLedgerCell('arrivalLocation', escapeHtml(summary.arrivalLocation))}
        ${renderLedgerCell('trafficType', escapeHtml(summary.trafficType))}
        ${renderLedgerCell('purpose', escapeHtml(summary.purpose))}
        ${renderLedgerCell('expenseOrganization', escapeHtml(summary.expenseOrganization))}
        ${renderLedgerCell('paymentAmount', formatOptionalMoney(summary.paymentAmount), 'amount')}
        ${renderLedgerCell('invoiceType', escapeHtml(summary.invoiceType))}
        ${renderLedgerCell('invoiceCode', escapeHtml(summary.invoiceCode))}
        ${renderLedgerCell('invoiceNumber', escapeHtml(summary.invoiceNumber))}
        ${renderLedgerCell('invoiceIssueDate', escapeHtml(summary.invoiceIssueDate))}
        ${renderLedgerCell('sellerName', escapeHtml(summary.sellerName))}
        ${renderLedgerCell('buyerName', escapeHtml(summary.buyerName))}
        ${renderLedgerCell('invoiceTaxAmount', formatOptionalMoney(summary.invoiceTaxAmount), 'amount')}
        ${renderLedgerCell('invoiceExcludingTaxAmount', formatOptionalMoney(summary.invoiceExcludingTaxAmount), 'amount')}
        ${renderLedgerCell('invoiceTotalAmount', formatOptionalMoney(summary.invoiceTotalAmount), 'amount')}
        ${renderLedgerCell('requestOrganization', escapeHtml(summary.requestOrganization))}
        ${renderLedgerCell('requestPaymentAmount', formatOptionalMoney(summary.requestPaymentAmount), 'amount')}
        ${renderLedgerCell('sourceDocumentStatus', escapeHtml(summary.sourceDocumentStatus))}
        ${renderLedgerCell('interfaceSource', escapeHtml(legacyUnverified ? '历史数据待核验' : record.mockReplacement ? '接口未启用' : '正式接口'))}
        <td data-column-key="operationPanel" class="operation-panel-cell">
          <button class="row-action row-generate-expense-reimbursement" type="button" data-source-id="${escapeHtml(record.sourceId)}" aria-label="为 ${escapeHtml(displaySourceCode(record))} ${legacyUnverified ? '禁止保存' : pushed ? '已保存费用报销单' : '生成待保存费用报销单'}" ${legacyUnverified || pushed ? 'disabled' : ''}>${legacyUnverified ? '禁止保存' : pushed ? '已保存' : actionText}</button>
        </td>
      </tr>
    `;
  }).join('');
  renderColumnVisibility();
  renderFinanceReview(state.lastPreview);
}

function renderPagination(pagination) {
  paginationSummary.textContent = `Total ${pagination.totalItems} · Page ${pagination.currentPage}/${pagination.totalPages}`;
  pageSizeSelect.value = String(pagination.pageSize);
  gotoPageInput.value = String(pagination.currentPage);
  gotoPageInput.max = String(pagination.totalPages);
  previousPageButton.disabled = pagination.currentPage <= 1;
  nextPageButton.disabled = pagination.currentPage >= pagination.totalPages;
  paginationPageButtons.innerHTML = visiblePageNumbers(
    pagination.currentPage,
    pagination.totalPages
  ).map((page) => `
    <button ${page === pagination.currentPage ? 'id="currentPageButton"' : ''} class="page-button ${page === pagination.currentPage ? 'active' : ''}" type="button" data-page="${page}">${page}</button>
  `).join('');
}

function goToLedgerPage(page) {
  state.ledgerPage = Number.isFinite(page) ? page : 1;
  renderSourceQueue(state.syncedDocuments);
}

function jumpToRequestedLedgerPage() {
  goToLedgerPage(Number(gotoPageInput.value));
  gotoPageInput.focus();
  gotoPageInput.select();
}

function currentLedgerPageRecords() {
  const records = sortLedgerRecords(filterLedgerRecords(state.syncedDocuments));
  const pagination = calculatePagination(records.length, state.ledgerPageSize, state.ledgerPage);
  return records.slice(pagination.startIndex, pagination.endIndex);
}

function filterLedgerRecords(records) {
  const keyword = sourceSearchInput.value.trim().toLowerCase();
  return expandLedgerRecords(records).filter((record) => {
    const summary = buildSourceSummary(record);
    const savedToErp = state.pushedSourceIds.has(record.sourceId);
    if (saveStatusFilterSelect.value === 'saved' && !savedToErp) {
      return false;
    }
    if (saveStatusFilterSelect.value === 'unsaved' && savedToErp) {
      return false;
    }
    if (requesterFilterSelect.value && displayRequester(record, summary.requester) !== requesterFilterSelect.value) {
      return false;
    }
    if (sourceTypeFilterSelect.value && record.sourceType !== sourceTypeFilterSelect.value) {
      return false;
    }
    if (dateFilterSelect.value && dateOnly(summary.paymentDate) !== dateFilterSelect.value) {
      return false;
    }
    return !keyword
      || matchesLedgerQuery(ledgerSearchValue(record, summary, searchFieldSelect.value), keyword, matchModeSelect.value);
  });
}

function renderLedgerFilterOptions(records, requesterCatalog = []) {
  records = expandLedgerRecords(records);
  const selectedRequester = requesterFilterSelect.value;
  const selectedSourceType = sourceTypeFilterSelect.value;
  const selectedDate = dateFilterSelect.value;
  const catalogNames = requesterCatalog
    .map((requester) => String(requester?.name || '').trim())
    .filter(Boolean);
  const requesters = [...new Set((catalogNames.length > 0 ? catalogNames : records.map((record) => {
    const summary = buildSourceSummary(record);
    return displayRequester(record, summary.requester);
  })).filter((value) => value && value !== '-'))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const sourceTypes = new Map([
    ['OFFLINE_REIMBURSEMENT', '线下报销 · 费用明细'],
    ['ONLINE_MONTHLY_BILL', '线上月结 · 月度账单']
  ]);
  const dates = new Set();
  for (const record of records) {
    const summary = buildSourceSummary(record);
    if (!sourceTypes.has(record.sourceType)) {
      sourceTypes.set(
        record.sourceType,
        `${summary.sourceKindName}${summary.sourceForm ? ` · ${summary.sourceForm}` : ''}`
      );
    }
    if (summary.paymentDate) dates.add(dateOnly(summary.paymentDate));
  }
  requesterFilterSelect.innerHTML = [
    '<option value="">全部报销人</option>',
    ...requesters.map((requester) => `<option value="${escapeHtml(requester)}">${escapeHtml(requester)}</option>`)
  ].join('');
  sourceTypeFilterSelect.innerHTML = [
    '<option value="">全部来源类型</option>',
    ...[...sourceTypes.entries()]
      .filter(([value]) => value)
      .sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'))
      .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
  ].join('');
  dateFilterSelect.innerHTML = [
    '<option value="">全部日期</option>',
    ...[...dates]
      .sort((left, right) => right.localeCompare(left))
      .map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`)
  ].join('');
  requesterFilterSelect.value = requesters.includes(selectedRequester) ? selectedRequester : '';
  sourceTypeFilterSelect.value = sourceTypes.has(selectedSourceType) ? selectedSourceType : '';
  dateFilterSelect.value = dates.has(selectedDate) ? selectedDate : '';
}

function renderLedgerTotals(records) {
  const amountKeys = new Set([
    'splitTaxAmount',
    'splitExcludingTaxAmount',
    'departmentAttributionAmount',
    'invoiceTaxAmount',
    'invoiceExcludingTaxAmount',
    'invoiceTotalAmount',
    'requestPaymentAmount',
    'paymentAmount'
  ]);
  const totals = Object.fromEntries([...amountKeys].map((key) => [key, 0]));
  let taxMappingComplete = true;
  for (const record of records) {
    const summary = buildSourceSummary(record);
    taxMappingComplete = taxMappingComplete && summary.taxMappingComplete !== false;
    for (const key of amountKeys) {
      const amount = Number(summary[key]);
      if (Number.isFinite(amount)) totals[key] += amount;
    }
  }
  const cells = ledgerColumnDefinitions().map((column) => {
    const unresolvedSplitTotal = !taxMappingComplete
      && (column.key === 'splitTaxAmount' || column.key === 'splitExcludingTaxAmount');
    const content = unresolvedSplitTotal
      ? ''
      : amountKeys.has(column.key)
        ? formatMoney(roundMoney(totals[column.key]))
        : '';
    return renderLedgerCell(column.key, content, amountKeys.has(column.key) ? 'amount' : '');
  }).join('');
  sourceQueueTotals.innerHTML = `
    <tr class="ledger-total-row">
      <td class="ledger-total-label">合计（${records.length}条）</td>
      ${cells}
      <td data-column-key="operationPanel"></td>
    </tr>
  `;
}

function ledgerSearchValue(record, summary, field) {
  if (field === 'requester') return displayRequester(record, summary.requester);
  if (field === 'department') return summary.department;
  if (field === 'status') return queueStatus(record);
  if (field === 'sourceType') return `${summary.sourceKindName} ${summary.sourceForm}`;
  return displaySourceCode(record);
}

function matchesLedgerQuery(value, keyword, mode) {
  const normalizedValue = String(value || '').toLowerCase();
  if (mode === 'equals') return normalizedValue === keyword;
  if (mode === 'notEquals') return normalizedValue !== keyword;
  return normalizedValue.includes(keyword);
}

function sortLedgerRecords(records) {
  return [...records].sort((left, right) => {
    const leftValue = ledgerSortValue(left, state.sortField);
    const rightValue = ledgerSortValue(right, state.sortField);
    const direction = state.sortDirection === 'asc' ? 1 : -1;
    if (leftValue > rightValue) return direction;
    if (leftValue < rightValue) return -direction;
    return String(displaySourceCode(left)).localeCompare(String(displaySourceCode(right)), 'zh-CN');
  });
}

function ledgerSortValue(record, field) {
  const summary = buildSourceSummary(record);
  if (field === 'splitTaxAmount') return Number(summary.splitTaxAmount || 0);
  if (field === 'splitExcludingTaxAmount') return Number(summary.splitExcludingTaxAmount || 0);
  if (field === 'departmentAttributionAmount') return Number(summary.departmentAttributionAmount || 0);
  if (field === 'sourceCode') return String(displaySourceCode(record) || '');
  if (field === 'applicationDate') return Date.parse(summary.applicationDate || '') || 0;
  return Date.parse(summary.paymentDate || '') || 0;
}

function setLedgerSort(field) {
  if (state.sortField === field) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  else {
    state.sortField = field;
    state.sortDirection = field === 'time' ? 'desc' : 'asc';
  }
  renderSourceQueue(state.syncedDocuments);
}

function visibleLedgerColumns() {
  return ['閫夋嫨', ...ledgerColumnDefinitions().filter((column) => state.visibleColumnKeys.has(column.key)).map((column) => column.label)];
}

function ledgerTableColumnCount() {
  return visibleLedgerColumns().length + 1;
}

function renderLedgerCell(key, content, className = '') {
  if (!state.visibleColumnKeys.has(key)) return '';
  return `<td data-column-key="${key}" class="${className}">${content}</td>`;
}

function ledgerColumnDefinitions() {
  return [
    { key: 'status', label: '处理状态' },
    { key: 'sourceType', label: '来源类型' },
    { key: 'documentType', label: '单据类型' },
    { key: 'sourceCode', label: '来源单号' },
    { key: 'applicationDate', label: '申请日期' },
    { key: 'time', label: '费用发生日期' },
    { key: 'requester', label: '报销人' },
    { key: 'employeeOpenBank', label: '开户银行' },
    { key: 'employeeAccountName', label: '账户名称' },
    { key: 'employeeBankAccount', label: '银行账号' },
    { key: 'departmentAttributionAmount', label: '报销金额' },
    { key: 'splitTaxAmount', label: '税额' },
    { key: 'splitExcludingTaxAmount', label: '不含税金额' },
    { key: 'expenseCategories', label: '费用类型' },
    { key: 'businessLine', label: '业务线' },
    { key: 'reason', label: '事由' },
    { key: 'expenseDepartment', label: '费用承担部门' },
    { key: 'department', label: '部门' },
    { key: 'erpPaymentBillType', label: 'ERP付款单类型' },
    { key: 'erpBankProcessingStatus', label: '银行处理状态' },
    { key: 'erpPaymentDate', label: '付款时间' },
    { key: 'startLocation', label: '出发地' },
    { key: 'arrivalLocation', label: '目的地' },
    { key: 'trafficType', label: '交通类型' },
    { key: 'purpose', label: '用途' },
    { key: 'expenseOrganization', label: '费用承担组织' },
    { key: 'paymentAmount', label: '付款金额' },
    { key: 'invoiceType', label: '发票类型' },
    { key: 'invoiceCode', label: '发票代码' },
    { key: 'invoiceNumber', label: '发票号码' },
    { key: 'invoiceIssueDate', label: '开票日期' },
    { key: 'sellerName', label: '销售方名称' },
    { key: 'buyerName', label: '购买方名称' },
    { key: 'invoiceTaxAmount', label: '发票税额' },
    { key: 'invoiceExcludingTaxAmount', label: '不计税金额' },
    { key: 'invoiceTotalAmount', label: '价税合计' },
    { key: 'requestOrganization', label: '申请组织' },
    { key: 'requestPaymentAmount', label: '申请退/付款金额' },
    { key: 'sourceDocumentStatus', label: '单据状态' },
    { key: 'interfaceSource', label: '接口来源' }
  ];
}

function visibleColumnKeys() {
  return [...state.visibleColumnKeys];
}

function toggleColumnSettings() {
  columnSettingsPanel.hidden = !columnSettingsPanel.hidden;
}

function toggleFieldMappingPanel() {
  fieldMappingPanel.hidden = !fieldMappingPanel.hidden;
  if (!fieldMappingPanel.hidden) {
    columnSettingsPanel.hidden = true;
    fieldMappingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function closeFieldMappingPanel() {
  fieldMappingPanel.hidden = true;
}

function renderInterfaceFieldMappings() {
  const rows = filterInterfaceFieldCatalog(
    interfaceFieldCatalog,
    interfaceFieldSourceFilter.value,
    interfaceFieldQuery.value
  );
  interfaceFieldCount.textContent = `${rows.length}项`;
  interfaceFieldMappingBody.innerHTML = rows.map((item) => `
    <tr>
      <td><span class="source-type-tag ${item.sourceType === '线上' ? 'online' : 'offline'}">${escapeHtml(item.sourceType)}</span></td>
      <td><code>${escapeHtml(item.sourceField)}</code></td>
      <td>${escapeHtml(item.normalizedField)}</td>
      <td><code>${escapeHtml(item.erpField)}</code></td>
      <td>${escapeHtml(item.rule)}</td>
    </tr>
  `).join('');
}

function updateVisibleColumn(event) {
  const checkbox = event.target.closest('input[data-column-toggle]');
  if (!checkbox) return;
  const key = checkbox.dataset.columnToggle;
  if (checkbox.checked) state.visibleColumnKeys.add(key);
  else state.visibleColumnKeys.delete(key);
  if (state.visibleColumnKeys.size === 0) {
    state.visibleColumnKeys.add(key);
    checkbox.checked = true;
    throw new Error('至少保留一个显示字段。');
  }
  renderSourceQueue(state.syncedDocuments);
}

function renderColumnVisibility() {
  for (const definition of ledgerColumnDefinitions()) {
    const visible = state.visibleColumnKeys.has(definition.key);
    document.querySelectorAll(`[data-column-key="${definition.key}"]`).forEach((element) => {
      element.hidden = !visible;
    });
  }
  columnSettingsPanel.querySelectorAll('input[data-column-toggle]').forEach((checkbox) => {
    checkbox.checked = state.visibleColumnKeys.has(checkbox.dataset.columnToggle);
  });
}

async function exportLedgerCsv() {
  const rows = sortLedgerRecords(filterLedgerRecords(state.syncedDocuments));
  const definitions = ledgerColumnDefinitions().filter((column) => state.visibleColumnKeys.has(column.key));
  const header = definitions.map((column) => column.label);
  const csvRows = [
    header,
    ...rows.map((record) => {
      const summary = buildSourceSummary(record);
      const values = {
        status: queueStatus(record),
        sourceType: `${summary.sourceKindName}${summary.sourceForm ? ` · ${summary.sourceForm}` : ''}`,
        sourceCode: displaySourceCode(record),
        documentType: summary.documentType,
        reason: summary.reason,
        requester: displayRequester(record, summary.requester),
        employeeOpenBank: summary.employeeOpenBank,
        employeeAccountName: summary.employeeAccountName,
        employeeBankAccount: summary.employeeBankAccount,
        department: summary.department,
        expenseCategories: displayExpenseCategories(record, summary.expenseCategories),
        startLocation: summary.startLocation,
        arrivalLocation: summary.arrivalLocation,
        trafficType: summary.trafficType,
        purpose: summary.purpose,
        expenseDepartment: summary.expenseDepartment,
        splitTaxAmount: formatSplitMoney(summary, 'splitTaxAmount'),
        splitExcludingTaxAmount: formatSplitMoney(summary, 'splitExcludingTaxAmount'),
        departmentAttributionAmount: formatMoney(summary.departmentAttributionAmount),
        invoiceType: summary.invoiceType,
        invoiceCode: summary.invoiceCode,
        invoiceNumber: summary.invoiceNumber,
        invoiceIssueDate: summary.invoiceIssueDate,
        sellerName: summary.sellerName,
        buyerName: summary.buyerName,
        invoiceTaxAmount: formatOptionalMoney(summary.invoiceTaxAmount),
        invoiceExcludingTaxAmount: formatOptionalMoney(summary.invoiceExcludingTaxAmount),
        invoiceTotalAmount: formatOptionalMoney(summary.invoiceTotalAmount),
        requestOrganization: summary.requestOrganization,
        requestPaymentAmount: formatOptionalMoney(summary.requestPaymentAmount),
        sourceDocumentStatus: summary.sourceDocumentStatus,
        expenseOrganization: summary.expenseOrganization,
        paymentAmount: formatOptionalMoney(summary.paymentAmount),
        businessLine: summary.businessLine,
        interfaceSource: record.mockReplacement ? '接口未启用' : '正式接口',
        applicationDate: summary.applicationDate || '',
        time: summary.paymentDate || ''
      };
      return definitions.map((definition) => values[definition.key]);
    })
  ];
  const csv = csvRows.map((row, rowIndex) => row.map((value, columnIndex) => (
    encodeCsvCell(value, {
      excelText: rowIndex > 0 && definitions[columnIndex].key === 'sourceCode'
    })
  )).join(',')).join('\n');
  const filename = `报销单列表-${new Date().toISOString().slice(0, 10)}.csv`;
  const content = `\uFEFF${csv}`;
  let exported;
  try {
    exported = await saveCsvToDesktop({ filename, content });
  } catch (error) {
    if (error?.name === 'AbortError') {
      show({ cancelled: true }, '已取消导出。');
      return;
    }
    throw error;
  }
  if (!exported) exported = await api.createCsvExport({ filename, content });
  show(
    { count: rows.length, ...exported },
    `已导出 ${rows.length} 条报销单列表数据，文件位置：${exported.localPath}`
  );
}

function renderVoucherPreview(preview) {
  renderFinanceReview(preview);
  document.querySelector('#previewBalanced').textContent = '已校验';
  document.querySelector('#previewDebitTotal').textContent = formatMoney(preview.totalAmount);
  document.querySelector('#previewCreditTotal').textContent = formatMoney(preview.excludingTaxAmount);
  document.querySelector('#previewLineCount').textContent = preview.documentSummary.entryCount;
  document.querySelector('#previewTaxTotal').textContent = formatMoney(preview.taxAmount);
  voucherPreviewBody.innerHTML = `
    <table class="review-detail-table">
      <thead><tr><th>业务线</th><th>预订/退票/下单日期时间</th><th>申请人</th><th>申请部门</th><th>费用承担组织</th><th>出发地</th><th>目的地</th><th>交通类型</th><th>报销日期</th><th>企业支付金额</th><th>事由</th><th>费用承担部门</th><th>费用类别</th><th>用途</th><th>税额</th><th>不含税金额</th></tr></thead>
      <tbody>${preview.expenseEntries.map((entry) => `
        <tr>
          <td>${escapeHtml(entry.businessLine)}</td>
          <td>${escapeHtml(entry.expenseDateTime)}</td>
          <td>${escapeHtml(preview.sourceSummary.requester)}</td>
          <td>${escapeHtml(preview.sourceSummary.department)}</td>
          <td>${escapeHtml(preview.sourceSummary.expenseOrganization)}</td>
          <td>${escapeHtml(entry.startLocation)}</td>
          <td>${escapeHtml(entry.arrivalLocation)}</td>
          <td>${escapeHtml(entry.trafficType)}</td>
          <td>${escapeHtml(entry.expenseDate)}</td>
          <td class="amount">${formatMoney(entry.amount)}</td>
          <td>${escapeHtml(entry.sourceReason)}</td>
          <td>${escapeHtml(entry.expenseDepartmentName || entry.departmentNumber)}</td>
          <td>${escapeHtml(`${entry.expenseItemNumber} ${entry.expenseItemName}`)}</td>
          <td>${escapeHtml(entry.purpose)}</td>
          <td class="amount">${formatMoney(entry.taxAmount)}</td>
          <td class="amount">${formatMoney(entry.excludingTaxAmount)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
}

function renderFinanceReview(preview) {
  if (!financeReviewSummary) return;
  const selectedSourceId = sourceIdInput.value.trim();
  const selectedRecord = state.syncedDocuments.find((record) => record.sourceId === selectedSourceId);
  if (preview) {
    const summary = preview.sourceSummary || {};
    financeReviewSummary.innerHTML = `
      <dl>
        <div><dt>来源单号</dt><dd>${escapeHtml(selectedRecord ? displaySourceCode(selectedRecord) : preview.sourceCode || '-')}</dd></div>
        <div><dt>报销人</dt><dd>${escapeHtml(selectedRecord ? displayRequester(selectedRecord, summary.requester) : summary.requester || '-')}</dd></div>
        <div><dt>部门</dt><dd>${escapeHtml(summary.department || '-')}</dd></div>
        <div><dt>金蝶单据</dt><dd>${escapeHtml(preview.documentSummary.formName)}（${escapeHtml(preview.documentSummary.formId)}）</dd></div>
        <div><dt>员工 / 部门</dt><dd>${escapeHtml(`${preview.documentSummary.employeeNumber} / ${preview.documentSummary.departmentNumber}`)}</dd></div>
        <div><dt>报销金额</dt><dd>${formatMoney(preview.totalAmount)}（税额 ${formatMoney(preview.taxAmount)}）</dd></div>
      </dl>
    `;
    return;
  }
  if (selectedRecord) {
    const summary = buildSourceSummary(selectedRecord);
    financeReviewSummary.innerHTML = `
      <dl>
        <div><dt>来源单号</dt><dd>${escapeHtml(displaySourceCode(selectedRecord))}</dd></div>
        <div><dt>报销人</dt><dd>${escapeHtml(displayRequester(selectedRecord, summary.requester))}</dd></div>
        <div><dt>部门</dt><dd>${escapeHtml(summary.department)}</dd></div>
        <div><dt>可抵扣税额</dt><dd>${formatSplitMoney(summary, 'splitTaxAmount')}</dd></div>
        <div><dt>未税金额</dt><dd>${formatSplitMoney(summary, 'splitExcludingTaxAmount')}</dd></div>
        <div><dt>费用归属部门金额</dt><dd>${formatMoney(summary.departmentAttributionAmount)}</dd></div>
      </dl>
    `;
    return;
  }
  financeReviewSummary.textContent = '请先从报销单列表选择一张单据。';
}

function renderVoucherValidation(preview) {
  const checks = preview ? [
    ['目标单据', preview.documentSummary.formId === 'ER_ExpReimbursement', '费用报销单列表'],
    ['员工映射', Boolean(preview.documentSummary.employeeNumber), `将写入 ${preview.documentSummary.employeeNumber}`],
    ['部门映射', Boolean(preview.documentSummary.departmentNumber), `将写入 ${preview.documentSummary.departmentNumber}`],
    ['费用项目映射', preview.expenseEntries.every((entry) => Boolean(entry.expenseItemNumber)), '每条明细都有费用项目编码'],
    ['金额校验', preview.totalAmount > 0, `报销金额 ${formatMoney(preview.totalAmount)}`]
  ] : [
    ['费用报销单预览', false, '请先选择单据并生成费用报销单']
  ];
  voucherValidationList.innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}：${ok ? '通过' : '待验证'}，${escapeHtml(detail)}</li>`
  ).join('');
}

function renderPreviewHashSummary(preview) {
  if (state.previewInvalidReason) {
    previewHashSummary.textContent = state.previewInvalidReason;
  } else if (!preview) {
    previewHashSummary.textContent = '尚未生成费用报销单预览。';
  } else {
    previewHashSummary.textContent = `当前预览内容哈希：${preview.contentHash}`;
  }
}

function renderSaveConfirmation(preview) {
  saveConfirmPanel.hidden = !preview;
  saveConfirmSummary.textContent = preview
    ? `来源单据 ${preview.sourceCode}，报销金额 ${formatMoney(preview.totalAmount)}，明细 ${preview.documentSummary.entryCount} 条`
    : '请先预览费用报销单。';
  saveRiskNotice.textContent = '费用报销单只保存为金蝶暂存，不提交、不审核。';
}

function schedulerSummary(scheduler) {
  const lastRun = scheduler.lastRunAt ? `最近 ${scheduler.lastRunAt}` : '尚未运行';
  return `${scheduler.intervalSeconds}s · ${scheduler.autoPushErp ? '自动推送ERP' : '仅同步'} · ${lastRun}`;
}

function syncBatchSummary(batch) {
  if (!batch) return '尚未产生同步批次。';
  const interfaceText = batch.mockReplacement ? `接口状态：${interfaceReason(batch.mockReason, true)}` : '真实接口';
  return `最近批次 ${batch.batchId}，${batch.status}，成功 ${batch.successCount}/${batch.totalCount}，失败 ${batch.failCount}，${interfaceText}。`;
}

function interfaceReason(reason, replacementEnabled) {
  if (!replacementEnabled) return '真实接口已启用';
  const normalized = String(reason || '').toLowerCase();
  if (normalized.includes('fenbeitong') || normalized.includes('access token')) return '分贝通授权未配置';
  if (normalized.includes('kingdee') || normalized.includes('erp')) return 'ERP接口未启用';
  return reason ? String(reason) : '外部接口未全部启用';
}

function displaySourceCode(record) {
  return record?.sourceCode || record?.sourceId || '-';
}

function displayRequester(record, requester) {
  return requester || '-';
}

function displayExpenseCategories(record, categories) {
  return String(categories || '-')
    .replaceAll('Travel', '差旅费')
    .replaceAll('Office', '办公费');
}

function environmentWarning(status) {
  if (status.mode.kingdee === 'mock') return '当前外部ERP接口未启用，保存动作不会写入正式ERP。';
  return '当前外部接口已启用，保存动作会写入金蝶费用报销单列表，请先确认预览。';
}

function readinessText(readiness) {
  if (readiness.ready) return '连接参数完整';
  return readiness.missing.length > 0 ? `缺少 ${readiness.missing.length} 项配置` : '待确认';
}

function applyTemplate(template) {
  state.erpTemplateDefaults = structuredClone(template);
  fields.mockDocumentDate.value = template.mockDocumentDate;
  fields.mockYear.value = template.mockYear;
  fields.mockPeriod.value = template.mockPeriod;
  fields.expenseItemNumberMappings.value = formatFieldMapping(template.expenseItemNumberMappings);
  fields.employeeDetailNumberMappings.value = formatFieldMapping(template.employeeDetailNumberMappings);
  fields.departmentDetailNumberMappings.value = formatFieldMapping(template.departmentDetailNumberMappings);
  fields.organizationNumberMappings.value = formatFieldMapping(template.organizationNumberMappings);
  fields.currencyNumbers.value = formatFieldMapping(template.currencyNumbers);
  fields.mockFixedJson.value = template.mockFixedJson;
}

function invalidatePreview(reason) {
  state.lastPreview = null;
  state.previewSignature = '';
  state.previewInvalidReason = reason;
  renderSaveConfirmation(null);
  renderVoucherValidation(null);
  renderPreviewHashSummary(null);
  renderFinanceReview(null);
}

function isPreviewFresh() {
  if (!state.lastPreview || !state.previewSignature) return false;
  try {
    return requestSignature(buildExpenseReimbursementRequest()) === state.previewSignature;
  } catch {
    return false;
  }
}

function requestSignature(request) {
  return JSON.stringify(request);
}

function buildSourceSummary(record) {
  try {
    const parsed = JSON.parse(record.fixedJson || '{}');
    const data = parsed.data || {};
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const splitAmounts = fenbeitongSplitAmounts(expenses);
    const isOfflineReimbursement = record.sourceType === 'OFFLINE_REIMBURSEMENT'
      || data.source_kind !== 'ONLINE_MONTHLY_BILL';
    const departmentAttributionAmount = Number(record.departmentAttributionAmount
      ?? record.totalAmount
      ?? splitAmounts.departmentAttributionAmount);
    const splitTaxAmount = isOfflineReimbursement
      ? splitAmounts.splitTaxAmount
      : Number(record.splitTaxAmount ?? splitAmounts.splitTaxAmount);
    const splitExcludingTaxAmount = isOfflineReimbursement
      ? splitAmounts.splitExcludingTaxAmount
      : Number(record.splitExcludingTaxAmount ?? (departmentAttributionAmount - splitTaxAmount));
    const documentTaxMappingComplete = isOfflineReimbursement
      ? splitAmounts.taxMappingComplete
      : record.taxMappingComplete !== false;
    const expense = record.ledgerExpense;
    const taxMappingComplete = expense
      ? expense.taxMappingComplete
      : documentTaxMappingComplete;
    return {
      sourceKindName: record.sourceKindName || (record.sourceType === 'ONLINE_MONTHLY_BILL' ? '线上月结' : '线下报销'),
      sourceForm: record.sourceForm || (record.sourceType === 'ONLINE_MONTHLY_BILL' ? '企业账单' : '费用明细'),
      documentType: record.documentType || '',
      erpPaymentBillType: record.erpPaymentBillType || '',
      erpBankProcessingStatus: record.erpBankProcessingStatus || '',
      erpPaymentDate: record.erpPaymentDate || '',
      reason: record.reason || '',
      requester: record.requesterName || record.requesterCode || data.submitter?.name || data.proposer?.name || data.user?.name || '-',
      employeeOpenBank: record.employeeOpenBank || '',
      employeeAccountName: record.employeeAccountName || '',
      employeeBankAccount: record.employeeBankAccount || '',
      department: record.departmentName || record.departmentCode || data.submitter?.department_name || data.proposer?.department_name || data.user?.department_name || '-',
      expenseCategories: expense?.categoryName || record.expenseTypes || expenses.map((expense) => expense.cost_category?.name || expense.cost_category?.code || '未分类').join(' / ') || '-',
      startLocation: expense?.startLocation ?? record.startLocation ?? '',
      arrivalLocation: expense?.arrivalLocation ?? record.arrivalLocation ?? '',
      trafficType: record.sourceType === 'ONLINE_MONTHLY_BILL' ? record.trafficType || '' : '',
      purpose: expense?.purpose ?? record.purpose ?? '',
      expenseDepartment: expense?.expenseDepartment ?? record.expenseDepartment ?? '',
      totalAmount: expense?.departmentAttributionAmount ?? departmentAttributionAmount,
      splitTaxAmount: taxMappingComplete
        ? (expense ? expense.splitTaxAmount : splitTaxAmount)
        : null,
      splitExcludingTaxAmount: taxMappingComplete
        ? (expense ? expense.splitExcludingTaxAmount : splitExcludingTaxAmount)
        : null,
      taxMappingComplete,
      documentTaxMappingComplete,
      departmentAttributionAmount: expense ? expense.departmentAttributionAmount : departmentAttributionAmount,
      invoiceType: expense?.invoiceType || '',
      invoiceCode: expense?.invoiceCode || '',
      invoiceNumber: expense?.invoiceNumber || '',
      invoiceIssueDate: expense?.invoiceIssueDate || '',
      sellerName: expense?.sellerName || '',
      buyerName: expense?.buyerName || '',
      invoiceTaxAmount: expense?.invoiceTaxAmount ?? null,
      invoiceExcludingTaxAmount: expense?.invoiceExcludingTaxAmount ?? null,
      invoiceTotalAmount: expense?.invoiceTotalAmount ?? null,
      requestOrganization: record.requestOrganizationName || record.requestOrganizationCode || '',
      requestPaymentAmount: record.requestPaymentAmount,
      sourceDocumentStatus: record.sourceDocumentStatus || '',
      expenseOrganization: record.expenseOrganizationName || record.expenseOrganizationCode || '',
      paymentAmount: record.paymentAmount,
      businessLine: record.businessLine || '',
      applicationDate: sourceApplicationDate(record, data),
      paymentDate: expense
        ? expense.expenseDate
        : record.sourceType === 'ONLINE_MONTHLY_BILL'
          ? record.expenseDateTime || record.paymentDate || ''
          : record.paymentDate || dateOnly(data.payment_time || data.pay_time || data.payment_date || data.reimburse_time || '')
    };
  } catch {
    return { sourceKindName: '', sourceForm: '', documentType: '', erpPaymentBillType: '', erpBankProcessingStatus: '', erpPaymentDate: '', reason: '', requester: '-', employeeOpenBank: '', employeeAccountName: '', employeeBankAccount: '', department: '-', expenseCategories: 'JSON解析失败', startLocation: '', arrivalLocation: '', trafficType: '', purpose: '', expenseDepartment: '', totalAmount: 0, splitTaxAmount: null, splitExcludingTaxAmount: null, taxMappingComplete: false, documentTaxMappingComplete: false, departmentAttributionAmount: 0, invoiceType: '', invoiceCode: '', invoiceNumber: '', invoiceIssueDate: '', sellerName: '', buyerName: '', invoiceTaxAmount: null, invoiceExcludingTaxAmount: null, invoiceTotalAmount: null, requestOrganization: '', requestPaymentAmount: null, sourceDocumentStatus: '', expenseOrganization: '', paymentAmount: null, businessLine: '', applicationDate: '', paymentDate: '' };
  }
}

function summarizeBatchFailureReasons(failures) {
  const reasons = new Map();
  for (const failure of failures) {
    const message = String(failure.message || failure.code || '未知错误').trim();
    reasons.set(message, (reasons.get(message) || 0) + 1);
  }
  return [...reasons.entries()]
    .map(([message, count]) => `${count} 张：${message}`)
    .join('；');
}

function summarizeBatchSkippedReasons(skipped) {
  const reasons = new Map();
  for (const record of skipped) {
    const reason = String(record.reason || '业务规则跳过').trim();
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return [...reasons.entries()]
    .map(([reason, count]) => `${count} 张：${reason}`)
    .join('；');
}

function businessRuleSkipReason(error) {
  if (isMissingKingdeeEmployee(error)) return '金蝶员工资料未建档';
  if (error?.code === 'KINGDEE_SAVE_LINE_MISMATCH') {
    return 'ERP已保存单据与当前接口明细不一致，已跳过';
  }
  if (error?.code === 'KINGDEE_SAVE_FAILED' && ['开户银行', '账户名称', '银行账号'].every((field) => (
    String(error?.message || '').includes(field)
  ))) {
    return '员工银行资料未配置完整，已跳过';
  }
  if (error?.code === 'KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE') {
    const enableDate = error?.detail?.enableDate;
    return `申请日期早于金蝶组织费用管理启用日期${enableDate ? ` ${enableDate}` : ''}（保留分贝通申请日期）`;
  }
  return error?.message || '业务规则跳过';
}

function expandLedgerRecords(records) {
  return records.flatMap((record) => {
    if (record.sourceType !== 'OFFLINE_REIMBURSEMENT' || record.ledgerExpense) return [record];
    try {
      const data = JSON.parse(record.fixedJson || '{}').data || {};
      const expenses = (Array.isArray(data.expenses) ? data.expenses : [])
        .filter((expense) => expense.cost_category?.code || expense.cost_category?.name);
      if (expenses.length === 0) return [];
      return expenses.map((expense, index) => ({
        ...record,
        ledgerRowId: `${record.sourceId}:${expense.id || index + 1}`,
        ledgerExpense: sourceLedgerExpense(expense)
      }));
    } catch {
      return [record];
    }
  });
}

function sourceLedgerExpense(expense) {
  const customFields = new Map((Array.isArray(expense.cost_custom_fields) ? expense.cost_custom_fields : [])
    .map((field) => [String(field.field_code || ''), field.detail]));
  const departmentAttributionAmount = expenseDepartmentAttributionAmount(expense);
  const split = expenseSplitAmounts(expense);
  const invoiceSummary = summarizeExpenseInvoices(expense);
  return {
    id: String(expense.id || ''),
    categoryName: expense.cost_category?.name || expense.cost_category?.code || '',
    categoryCode: expense.cost_category?.code || '',
    purpose: String(customFields.get('expense_category_desc') || expense.reason || ''),
    expenseDate: dateOnly(customFields.get('date_of_expense')),
    splitTaxAmount: split.resolved ? split.taxAmount : null,
    splitExcludingTaxAmount: split.resolved ? split.excludingTaxAmount : null,
    taxMappingComplete: split.resolved,
    departmentAttributionAmount,
    startLocation: sourceLocationName(customFields.get('start_location')),
    arrivalLocation: sourceLocationName(customFields.get('arrival_location')),
    expenseDepartment: sourceExpenseDepartment(expense),
    ...invoiceSummary
  };
}

async function confirmErpSaveAfterConnectionFailure(sourceId, minimumUpdateTime = 0) {
  let lastRecord = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    try {
      lastRecord = await api.getProcess(sourceId);
      if (isConfirmedErpSave(lastRecord)
        && isProcessUpdatedAfter(lastRecord, minimumUpdateTime)) {
        return lastRecord;
      }
    } catch (error) {
      if (!['LOCAL_BACKEND_UNREACHABLE', 'HTTP_404'].includes(error?.code)) {
        throw error;
      }
    }
  }
  return lastRecord;
}

function isProcessUpdatedAfter(record, minimumUpdateTime) {
  if (!minimumUpdateTime) return true;
  const updateTime = Date.parse(record?.updateTime || '');
  return Number.isFinite(updateTime) && updateTime >= minimumUpdateTime;
}

function sourceLocationName(value) {
  if (!Array.isArray(value)) return '';
  return String(value.at(-1)?.name || '');
}

function sourceExpenseDepartment(expense) {
  const names = (Array.isArray(expense?.cost_attributions) ? expense.cost_attributions : [])
    .filter((attribution) => Number(attribution?.type) === 1)
    .flatMap((attribution) => Array.isArray(attribution?.details) ? attribution.details : [])
    .map((detail) => String(detail?.name || detail?.code || '').trim())
    .filter(Boolean);
  return [...new Set(names)].join(' / ');
}

function fenbeitongSplitAmounts(expenses) {
  let splitTaxAmount = 0;
  let splitExcludingTaxAmount = 0;
  let departmentAttributionAmount = 0;
  let taxMappingComplete = true;
  for (const expense of Array.isArray(expenses) ? expenses : []) {
    const departmentAmount = expenseDepartmentAttributionAmount(expense);
    departmentAttributionAmount += departmentAmount;
    const split = expenseSplitAmounts(expense);
    taxMappingComplete = taxMappingComplete && split.resolved;
    if (split.resolved) {
      splitTaxAmount += split.taxAmount;
      splitExcludingTaxAmount += split.excludingTaxAmount;
    }
  }
  splitTaxAmount = roundMoney(splitTaxAmount);
  splitExcludingTaxAmount = roundMoney(splitExcludingTaxAmount);
  departmentAttributionAmount = roundMoney(departmentAttributionAmount);
  return {
    splitTaxAmount: taxMappingComplete ? splitTaxAmount : null,
    splitExcludingTaxAmount: taxMappingComplete ? splitExcludingTaxAmount : null,
    departmentAttributionAmount,
    taxMappingComplete
  };
}

function expenseDepartmentAttributionAmount(expense) {
  const amounts = (Array.isArray(expense?.cost_attributions) ? expense.cost_attributions : [])
    .filter((attribution) => Number(attribution?.type) === 1)
    .flatMap((attribution) => Array.isArray(attribution?.details) ? attribution.details : [])
    .map((detail) => Number(detail?.amount))
    .filter(Number.isFinite);
  return roundMoney(amounts.length > 0
    ? amounts.reduce((sum, value) => sum + value, 0)
    : Number(expense?.total_amount || 0));
}

function expenseSplitAmounts(expense) {
  return directExpenseSplitAmounts(expense);
}

function invoiceSplitAmounts(invoice) {
  const total = Number(invoice?.total_amount || 0);
  const used = Number(invoice?.used_amount ?? invoice?.standard_trade_amt);
  if (!Number.isFinite(total) || !Number.isFinite(used)
    || roundMoney(total) <= 0 || roundMoney(used) !== roundMoney(total)) {
    return unresolvedSplit();
  }
  const taxAmount = explicitAmount(invoice?.tax_amount);
  const excludingTaxAmount = explicitAmount(invoice?.exclude_tax_amount);
  if (taxAmount === null || excludingTaxAmount === null
    || roundMoney(taxAmount + excludingTaxAmount) !== roundMoney(used)) {
    return unresolvedSplit();
  }
  return { taxAmount, excludingTaxAmount, resolved: true };
}

function directExpenseSplitAmounts(expense) {
  const fields = Array.isArray(expense?.cost_custom_fields) ? expense.cost_custom_fields : [];
  const taxAmount = explicitCustomAmount(
    fields,
    ['\u53ef\u62b5\u6263\u7a0e\u989d'],
    ['deductible_tax']
  );
  const excludingTaxAmount = explicitCustomAmount(
    fields,
    ['\u672a\u7a0e\u91d1\u989d'],
    ['untaxed_amount']
  );
  if (taxAmount === null || excludingTaxAmount === null) {
    return unresolvedSplit();
  }
  return { taxAmount, excludingTaxAmount, resolved: true };
}

function explicitCustomAmount(fields, exactTitles, exactCodes) {
  const field = fields.find((item) => {
    const title = String(item?.title || item?.name || '').trim();
    const code = String(item?.field_code || '').trim();
    return exactTitles.includes(title) || exactCodes.includes(code);
  });
  return explicitAmount(field?.detail);
}

function explicitAmount(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const amount = Number(rawValue);
  return Number.isFinite(amount) ? roundMoney(amount) : null;
}

function unresolvedSplit() {
  return { taxAmount: null, excludingTaxAmount: null, resolved: false };
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function departmentAttributionTotal(expenses) {
  return (Array.isArray(expenses) ? expenses : []).reduce((total, expense) => {
    const amounts = (Array.isArray(expense?.cost_attributions) ? expense.cost_attributions : [])
      .filter((attribution) => Number(attribution?.type) === 1)
      .flatMap((attribution) => Array.isArray(attribution?.details) ? attribution.details : [])
      .map((detail) => Number(detail?.amount))
      .filter(Number.isFinite);
    const amount = amounts.length > 0
      ? amounts.reduce((sum, value) => sum + value, 0)
      : Number(expense?.total_amount || 0);
    return total + amount;
  }, 0);
}

function dateOnly(value) {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value || '').trim());
  if (!matched) return '';
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

function sourceApplicationDate(record, data) {
  if (record.sourceType === 'ONLINE_MONTHLY_BILL' || data.source_kind === 'ONLINE_MONTHLY_BILL') {
    const cycleDates = [...String(data.bill_cycle || '').matchAll(
      /(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/g
    )];
    const cycleStart = cycleDates.at(0);
    if (cycleStart) {
      const date = new Date(Date.UTC(
        Number(cycleStart[1]),
        Number(cycleStart[2]) - 1,
        Number(cycleStart[3])
      ));
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
    const explicit = dateOnly(
      data.bill_date
      || data.billing_date
      || data.account_date
      || data.bookkeeping_date
    );
    if (explicit) return explicit;
    const month = /^(20\d{2})[-/]?(\d{2})/.exec(String(
      data.settlement_month || data.end_month || data.start_month || record.settlementMonth || ''
    ).trim());
    if (month) {
      const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
    return record.applicationDate || '';
  }
  return dateOnly(
    data.submit_time
    || data.reimburse_time
    || data.create_time
    || data.apply_time
  ) || record.applicationDate || '';
}

function queueStatus(record) {
  if (isLegacyUnverified(record)) return '来源待核验';
  const sourceId = record.sourceId;
  if (state.pushedSourceIds.has(sourceId)) return '已保存ERP';
  if (state.preparedSourceIds.has(sourceId)) return '已生成';
  if (state.lastPreview?.sourceId === sourceId) return '已预览';
  return stageName(record.processStage);
}

function isLegacyUnverified(record) {
  return record?.sourceType === 'ONLINE_LEGACY_UNVERIFIED';
}

function isRealPushedRecord(record) {
  return Boolean(
    record
    && record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED'
    && record.targetFormId === 'ER_ExpReimbursement'
    && record.erpMode === 'real'
    && record.simulatedErp === false
    && record.erpFid
    && record.erpNumber
  );
}

function readConfig() {
  const defaults = requiredTemplateDefaults();
  return {
    expenseReimbursementOrgNumber: defaults.expenseReimbursementOrgNumber,
    expenseReimbursementBillTypeNumber: defaults.expenseReimbursementBillTypeNumber,
    expenseReimbursementSettlementTypeNumber: defaults.expenseReimbursementSettlementTypeNumber,
    expenseItemNumberMappings: parseFieldMapping(fields.expenseItemNumberMappings.value, '费用类型映射'),
    organizationNumberMappings: parseFieldMapping(fields.organizationNumberMappings.value, '组织映射'),
    currencyNumbers: parseFieldMapping(fields.currencyNumbers.value, '币别映射'),
    departmentDetailNumberMappings: parseFieldMapping(fields.departmentDetailNumberMappings.value, '部门映射'),
    employeeDetailNumberMappings: parseFieldMapping(fields.employeeDetailNumberMappings.value, '员工映射'),
    exchangeRateTypeNumber: defaults.exchangeRateTypeNumber,
    exchangeRate: defaults.exchangeRate
  };
}

function requiredTemplateDefaults() {
  if (!state.erpTemplateDefaults) {
    throw new Error('请先加载默认费用报销单参数。');
  }
  return state.erpTemplateDefaults;
}

function cloneObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('默认费用报销单参数缺少映射配置。');
  }
  return structuredClone(value);
}

function buildExpenseReimbursementRequest() {
  const fixedJson = fields.mockFixedJson.value.trim();
  const sourceId = sourceIdInput.value.trim();
  if (!fixedJson && !sourceId) throw new Error('请先同步分贝通并选择待处理单据，或保留来源数据样例。');
  const sourceRecord = state.syncedDocuments.find((record) => record.sourceId === sourceId);
  const timing = sourceRecord ? expenseReimbursementTimingForRecord(sourceRecord) : {
    documentDate: fields.mockDocumentDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value)
  };
  return {
    fixedJson: fixedJson || undefined,
    sourceId: sourceId || undefined,
    documentDate: timing.documentDate,
    kingdeeAccountKey: state.selectedKingdeeAccountKey,
    kingdeeAcctIdKey: state.selectedKingdeeAcctIdKey,
    config: readConfig()
  };
}

function buildExpenseReimbursementRequestForRecord(record, options = {}) {
  const timing = expenseReimbursementTimingForRecord(record);
  return {
    fixedJson: record.fixedJson || undefined,
    sourceId: record.sourceId,
    documentDate: timing.documentDate,
    kingdeeAccountKey: state.selectedKingdeeAccountKey,
    kingdeeAcctIdKey: state.selectedKingdeeAcctIdKey,
    forceRetry: Boolean(options.forceRetry),
    config: readConfig()
  };
}

function expenseReimbursementTimingForRecord(record) {
  const applicationDate = String(buildSourceSummary(record).applicationDate || '').trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(applicationDate);
  if (!matched) {
    throw new Error(`单据申请日期无效，不能生成费用报销单：${record?.sourceCode || record?.sourceId || '-'}`);
  }
  return {
    documentDate: applicationDate,
    year: Number(matched[1]),
    period: Number(matched[2])
  };
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('not object');
    return value;
  } catch {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
}

function requiredSourceId() {
  const sourceId = sourceIdInput.value.trim();
  if (!sourceId) throw new Error('请先同步分贝通并选择待处理单据。');
  return sourceId;
}

function isJsonObject(text) {
  try {
    const value = JSON.parse(text || '{}');
    return Boolean(value && !Array.isArray(value) && typeof value === 'object');
  } catch {
    return false;
  }
}

function selectFirstRecord(records) {
  const firstRecord = records[0];
  if (firstRecord) {
    state.selectedSourceIds = new Set([firstRecord.sourceId]);
    setActiveSourceRecord(firstRecord, false);
  }
}

function buildPreviewSummary(preview) {
  return `费用报销单预览完成：报销金额 ${formatMoney(preview.totalAmount)}，税额 ${formatMoney(preview.taxAmount)}，明细 ${preview.documentSummary.entryCount} 条，状态为暂存。`;
}

function draftOnlyWarning(record) {
  if (record.erpMockReplacement) return '处理结果已保存。外部ERP接口启用前，不写入金蝶费用报销单。';
  return '已保存为金蝶暂存费用报销单，未提交、未审核，需人工审核。';
}

function stageName(stage) {
  const names = {
    EXPENSE_REIMBURSEMENT_PREPARED: '已生成待保存费用报销单',
    ERP_EXPENSE_REIMBURSEMENT_SAVED: '费用报销单已暂存',
    SYNCED: '已同步',
    UNVERIFIED_SOURCE: '来源待核验'
  };
  return names[stage] || stage || '-';
}

function logLabel(action) {
  const labels = {
    CONFIG_SAVE: '保存配置',
    SOURCE_SYNC: '同步来源单据',
    SYNC_START: '开始同步',
    SYNC_FINISH: '同步完成',
    EXPENSE_REIMBURSEMENT_PREPARE: '生成待保存费用报销单',
    ERP_EXPENSE_REIMBURSEMENT_SAVE: '保存费用报销单',
    SCHEDULER_RUN_START: '定时任务开始',
    SCHEDULER_RUN_FINISH: '定时任务完成',
    SCHEDULER_DISABLED: '定时任务关闭'
  };
  return labels[action] || action;
}

function logDetailSummary(detail) {
  if (!detail || typeof detail !== 'object') return '操作已记录';
  const preferred = [
    detail.sourceCode,
    detail.sourceId,
    detail.batchId,
    detail.message,
    detail.tenantKey,
    detail.kingdeeAcctIdKey
  ].filter(Boolean);
  if (preferred.length > 0) return preferred.join(' · ');
  const keys = Object.keys(detail);
  return keys.length > 0 ? `记录字段：${keys.slice(0, 4).join('、')}` : '操作已记录';
}

function formatLogTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN');
}

function hasFieldMapping(value) {
  try {
    return Object.keys(parseFieldMapping(value)).length > 0;
  } catch {
    return false;
  }
}

function show(value, summary = '') {
  const message = summary || summarizeValue(value);
  resultOutput.textContent = JSON.stringify(value, null, 2);
  resultSummary.textContent = message;
  showOperationFeedback(message, Boolean(value?.error));
}

function showOperationFeedback(message, isError = false) {
  if (!operationFeedback) return;
  if (operationFeedbackMessage) {
    operationFeedbackMessage.textContent = message;
  } else {
    operationFeedback.textContent = message;
  }
  operationFeedback.hidden = false;
  operationFeedback.classList.toggle('error', isError);
  if (batchProgress) batchProgress.hidden = true;
}

function startBatchProgress(total, action) {
  resumeBatchSave();
  state.batchSaveRunning = true;
  if (retryFailedSaveButton) retryFailedSaveButton.disabled = true;
  if (pauseSaveButton) {
    pauseSaveButton.hidden = false;
    pauseSaveButton.disabled = false;
    pauseSaveButton.textContent = '暂停保存';
    pauseSaveButton.setAttribute('aria-pressed', 'false');
  }
  showOperationFeedback(`${action}进行中，请勿关闭或刷新页面。`);
  updateBatchProgress({
    completed: 0,
    total,
    successCount: 0,
    failureCount: 0
  }, action);
}

function setFailedErpSaveRecords(failures) {
  state.failedErpSaveRecords = (Array.isArray(failures) ? failures : [])
    .map((failure) => failure?.item || failure)
    .filter((record) => record?.sourceId);
  if (!retryFailedSaveButton) return;
  const count = state.failedErpSaveRecords.length;
  retryFailedSaveButton.hidden = count === 0;
  retryFailedSaveButton.disabled = count === 0 || state.batchSaveRunning;
  retryFailedSaveButton.textContent = count > 0
    ? `重试失败单据（${count}）`
    : '重试失败单据';
}

function updateBatchProgress(progress, action) {
  if (!operationFeedback || !batchProgress) return;
  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.min(total, Math.max(0, Number(progress.completed) || 0));
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  operationFeedback.hidden = false;
  operationFeedback.classList.toggle('error', Boolean(progress.failureCount));
  if (progress.error && operationFeedbackMessage) {
    operationFeedbackMessage.textContent = `${action}进行中，请勿关闭或刷新页面。\n最近失败：\n${formatBatchFailureDetails([{
      item: progress.item,
      error: progress.error
    }])}`;
  }
  batchProgress.hidden = false;
  batchProgress.setAttribute('aria-valuenow', String(percent));
  const stateText = state.batchSavePaused ? '已暂停' : action;
  batchProgressText.textContent = `${stateText}：${completed}/${total}；已保存 ${progress.successCount || 0}；未保存 ${progress.failureCount || 0}`;
  batchProgressPercent.textContent = `${percent}%`;
  batchProgressFill.style.width = `${percent}%`;
}

function finishBatchProgress(total, successCount, failureCount, isError, skippedCount = 0) {
  if (!operationFeedback || !batchProgress) return;
  operationFeedback.hidden = false;
  operationFeedback.classList.toggle('error', Boolean(isError));
  batchProgress.hidden = false;
  batchProgress.setAttribute('aria-valuenow', '100');
  batchProgressText.textContent = `处理完成：${total}/${total}；已保存 ${successCount}；已跳过 ${skippedCount}；未保存 ${failureCount}`;
  batchProgressPercent.textContent = '100%';
  batchProgressFill.style.width = '100%';
  state.batchSaveRunning = false;
  resumeBatchSave();
  if (pauseSaveButton) {
    pauseSaveButton.hidden = true;
    pauseSaveButton.disabled = true;
  }
  if (retryFailedSaveButton && state.failedErpSaveRecords.length > 0) {
    retryFailedSaveButton.hidden = false;
    retryFailedSaveButton.disabled = false;
  }
}

function waitUntilBatchSaveResumed() {
  if (!state.batchSavePaused) return Promise.resolve();
  return new Promise((resolve) => state.batchSaveResumeWaiters.push(resolve));
}

function resumeBatchSave() {
  state.batchSavePaused = false;
  const waiters = state.batchSaveResumeWaiters.splice(0);
  for (const resolve of waiters) resolve();
}

function toggleBatchSavePause() {
  if (!state.batchSaveRunning || !pauseSaveButton) return;
  if (state.batchSavePaused) {
    resumeBatchSave();
    pauseSaveButton.textContent = '暂停保存';
    pauseSaveButton.setAttribute('aria-pressed', 'false');
    if (batchProgressText) {
      batchProgressText.textContent = batchProgressText.textContent.replace(/^已暂停/, '继续保存');
    }
    return;
  }
  state.batchSavePaused = true;
  pauseSaveButton.textContent = '继续保存';
  pauseSaveButton.setAttribute('aria-pressed', 'true');
  if (batchProgressText) {
    batchProgressText.textContent = batchProgressText.textContent.replace(/^[^：]+/, '已暂停');
  }
}

function showError(step, error) {
  show({ error: error.message, code: error.code || 'FRONTEND_ERROR', detail: error.detail || {}, step }, `失败步骤：${step}；错误编码：${error.code || 'FRONTEND_ERROR'}；原因：${error.message}`);
}

function operationStepName(fn) {
  const names = {
    generateExpenseReimbursementsFromLedger: '生成费用报销单',
    generateExpenseReimbursementFromRow: '生成费用报销单',
    pushSelectedToErp: '保存费用报销单',
    resaveSelectedToErp: '保存/更新费用报销单',
    pushErp: '保存费用报销单',
    syncFenbeitong: '同步分贝通',
    saveConfig: '保存配置',
    preview: '预览费用报销单',
    prepare: '生成待保存费用报销单',
    queryProcess: '查看费用报销单'
  };
  return names[fn.name] || fn.name || '操作';
}

function summarizeValue(value) {
  if (value?.error) return `操作失败：${value.error}`;
  if (value?.sourceCode) return `处理完成：${value.sourceCode}`;
  return '操作完成，技术详情已更新。';
}

function run(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      showError(operationStepName(fn), error);
    } finally {
      renderActionState();
    }
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSplitMoney(summary, field) {
  return summary.taxMappingComplete === false ? '' : formatMoney(summary[field]);
}

function formatOptionalMoney(value) {
  return value === null || value === undefined || value === '' ? '' : formatMoney(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
