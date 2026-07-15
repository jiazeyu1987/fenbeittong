import { api } from './api.js';

const fields = {
  accountBookNumber: document.querySelector('#accountBookNumber'),
  voucherGroupNumber: document.querySelector('#voucherGroupNumber'),
  templateErpFid: document.querySelector('#templateErpFid'),
  mockVoucherDate: document.querySelector('#mockVoucherDate'),
  mockYear: document.querySelector('#mockYear'),
  mockPeriod: document.querySelector('#mockPeriod'),
  currencyNumbers: document.querySelector('#currencyNumbers'),
  categoryAccountNumbers: document.querySelector('#categoryAccountNumbers'),
  creditDetailNumbers: document.querySelector('#creditDetailNumbers'),
  mockFixedJson: document.querySelector('#mockFixedJson')
};

const controls = {
  primaryAction: document.querySelector('#primaryActionButton'),
  syncFenbeitong: document.querySelector('#syncFenbeitongButton'),
  generateVoucher: document.querySelector('#generateVoucherButton'),
  saveErp: document.querySelector('#saveErpButton'),
  viewVoucher: document.querySelector('#viewVoucherButton'),
  exportLedger: document.querySelector('#exportButton'),
  queryLedger: document.querySelector('#queryLedgerButton'),
  resetLedger: document.querySelector('#resetButton'),
  columnSettings: document.querySelector('#columnSettingsButton'),
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
  selectedTenantKey: 'puhui',
  syncedDocuments: [],
  selectedSourceIds: new Set(),
  visibleColumnKeys: new Set(['status', 'sourceCode', 'requester', 'department', 'expenseCategories', 'amount', 'interfaceSource', 'time']),
  sortField: 'time',
  sortDirection: 'desc',
  lastPreview: null,
  previewSignature: '',
  previewInvalidReason: '',
  preparedSourceIds: new Set(),
  pushedSourceIds: new Set(),
  erpTemplateModel: null,
  erpTemplateDefaults: null
};

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const resultSummary = document.querySelector('#resultSummary');
const sourceIdInput = document.querySelector('#sourceIdInput');
const searchFieldSelect = document.querySelector('#searchFieldSelect');
const matchModeSelect = document.querySelector('#matchModeSelect');
const sourceSearchInput = document.querySelector('#sourceSearchInput');
const paginationSummary = document.querySelector('#paginationSummary');
const companySelect = document.querySelector('#companySelect');
const tenantStatusText = document.querySelector('#tenantStatusText');
const recordsTable = document.querySelector('#recordsTable');
const logsList = document.querySelector('#logsList');
const voucherPreviewBody = document.querySelector('#voucherPreviewBody');
const sourceQueueBody = document.querySelector('#sourceQueueBody');
const selectAllRowsCheckbox = document.querySelector('#selectAllRowsCheckbox');
const financeQueuePanel = document.querySelector('#financeQueuePanel');
const columnSettingsPanel = document.querySelector('#columnSettingsPanel');
const saveConfirmPanel = document.querySelector('#saveConfirmPanel');
const saveConfirmSummary = document.querySelector('#saveConfirmSummary');
const saveRiskNotice = document.querySelector('#saveRiskNotice');
const actionBlockReason = document.querySelector('#actionBlockReason');
const voucherValidationList = document.querySelector('#voucherValidationList');
const previewHashSummary = document.querySelector('#previewHashSummary');
const financeReviewSummary = document.querySelector('#financeReviewSummary');
const operationFeedback = document.querySelector('#operationFeedback');

controls.loadTemplate.addEventListener('click', run(loadTemplate));
controls.syncFenbeitong.addEventListener('click', run(syncFenbeitong));
controls.generateVoucher.addEventListener('click', run(generateVoucherFromLedger));
controls.saveErp.addEventListener('click', run(pushSelectedToErp));
controls.viewVoucher.addEventListener('click', run(queryProcess));
controls.queryLedger.addEventListener('click', () => renderSourceQueue(state.syncedDocuments));
controls.resetLedger.addEventListener('click', () => {
  sourceSearchInput.value = '';
  searchFieldSelect.value = 'sourceCode';
  matchModeSelect.value = 'contains';
  renderSourceQueue(state.syncedDocuments);
});
controls.exportLedger.addEventListener('click', exportLedgerCsv);
controls.columnSettings.addEventListener('click', toggleColumnSettings);
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
companySelect.addEventListener('change', () => {
  state.selectedTenantKey = companySelect.value;
  renderTenantState();
  renderActionState();
  if (isSelectedTenantWaiting()) {
    show({ tenantKey: state.selectedTenantKey, status: 'waiting_development' }, '接口等待开发中');
  }
});
sourceQueueBody.addEventListener('change', run(toggleQueuedDocument));
sourceQueueBody.addEventListener('click', run(generateVoucherFromRow));
selectAllRowsCheckbox.addEventListener('change', () => toggleAllVisibleDocuments(selectAllRowsCheckbox.checked));
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
    renderSourceQueue(state.syncedDocuments);
  }
});
sourceIdInput.addEventListener('input', () => {
  invalidatePreview('预览已失效：来源单据已变更，请重新预览凭证。');
  renderActionState();
});
for (const field of Object.values(fields)) {
  field.addEventListener('input', () => {
    invalidatePreview('预览已失效：凭证关键字段已变更，请重新预览凭证。');
    renderActionState();
  });
}

run(async () => {
  await api.health();
  statusBadge.textContent = '后端已连接';
  statusBadge.classList.add('ok');
  await loadTemplate();
  await refreshAll();
})();

async function loadTemplate() {
  const template = await api.getMockTemplate();
  applyTemplate(template);
  state.configSaved = false;
  renderConfigValidation();
  renderActionState();
  show(template, '已加载默认凭证参数，请保存配置后开始同步。');
}

async function saveConfig() {
  const saved = await api.saveConfig(readConfig());
  state.configSaved = true;
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
  invalidatePreview('预览已失效：同步结果已变更，请重新预览凭证。');
  show(result, `同步完成，新增或更新 ${result.records.length} 张来源单据。`);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  selectFirstRecord(result.sync.records);
  invalidatePreview('预览已失效：同步结果已变更，请重新预览凭证。');
  show(result, `定时任务已手动运行，本次同步 ${result.sync.records.length} 张来源单据。`);
  await refreshAll();
}

async function preview() {
  const request = buildVoucherRequest();
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
  const request = buildVoucherRequest();
  const result = await api.preview(request);
  state.lastPreview = result;
  state.previewSignature = requestSignature(request);
  state.previewInvalidReason = '';
  const record = await api.prepare(request);
  sourceIdInput.value = record.sourceId;
  state.preparedSourceIds.add(record.sourceId);
  show(record, '已生成待保存凭证。本地记录已保留幂等键和内容哈希。');
  await refreshAll();
}

async function generateVoucherFromLedger() {
  const records = selectedLedgerRecords();
  if (records.length === 0) {
    await pushErp();
    return;
  }
  const pushed = [];
  for (const record of records) {
    pushed.push(await saveRowVoucherToErp(record));
  }
  show({ count: pushed.length, records: pushed }, '保存成功');
  await refreshAll();
}

async function generateVoucherFromRow(event) {
  const button = event.target.closest('button.row-generate-voucher');
  if (!button) return;
  event.preventDefault();
  const sourceId = button.dataset.sourceId;
  const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
  if (!record) throw new Error(`待处理单据不存在：${sourceId}`);
  const savedRecord = await saveRowVoucherToErp(record);
  show({ count: 1, record: savedRecord }, '保存成功');
  await refreshAll();
}

async function saveRowVoucherToErp(record) {
  setActiveSourceRecord(record, false);
  const saved = await api.pushErp(buildVoucherRequestForRecord(record));
  const queried = await api.getProcess(saved.sourceId);
  if (!queried || queried.processStage !== 'ERP_PUSHED') {
    throw new Error(`ERP保存后查询未确认成功：${record.sourceId}`);
  }
  state.pushedSourceIds.add(queried.sourceId);
  state.preparedSourceIds.delete(queried.sourceId);
  return queried;
}

async function generateVoucherForRecord(record) {
  setActiveSourceRecord(record, false);
  const request = buildVoucherRequestForRecord(record);
  const previewResult = await api.preview(request);
  const preparedRecord = await api.prepare(request);
  state.lastPreview = previewResult;
  state.previewSignature = requestSignature(request);
  state.previewInvalidReason = '';
  state.preparedSourceIds.add(preparedRecord.sourceId);
  return preparedRecord;
}

async function pushSelectedToErp() {
  const records = selectedLedgerRecords();
  if (records.length === 0) {
    await pushErp();
    return;
  }
  const pushed = [];
  for (const record of records) {
    pushed.push(await saveRowVoucherToErp(record));
  }
  show({ count: pushed.length, records: pushed }, '保存成功');
  await refreshAll();
}

async function pushErp() {
  const sourceId = requiredSourceId();
  const saved = await api.pushErp({
    sourceId,
    voucherDate: fields.mockVoucherDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value),
    config: readConfig()
  });
  const record = await api.getProcess(saved.sourceId);
  if (!record || record.processStage !== 'ERP_PUSHED') {
    throw new Error(`ERP保存后查询未确认成功：${sourceId}`);
  }
  state.pushedSourceIds.add(record.sourceId);
  state.preparedSourceIds.delete(record.sourceId);
  show(record, '保存成功');
  await refreshAll();
}

async function queryProcess() {
  show(await api.getProcess(requiredSourceId()), '已查询到本地处理记录。');
}

async function refreshAll() {
  const [status, documents] = await Promise.all([
    api.systemStatus(),
    api.listSyncedDocuments()
  ]);
  state.currentStatus = status;
  state.syncedDocuments = documents;
  renderStatus(status);
  renderSourceQueue(documents);
  await refreshRecords();
  await refreshLogs();
  renderActionState();
}

async function refreshRecords() {
  const records = await api.listProcessRecords();
  state.preparedSourceIds = new Set(records.filter((record) => record.processStage === 'PREPARED').map((record) => record.sourceId));
  state.pushedSourceIds = new Set(records.filter(isRealPushedRecord).map((record) => record.sourceId));
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
    : logs.slice(0, 8).map((log) => `
      <div class="log-item">
        <strong>${escapeHtml(logLabel(log.action))}</strong>
        <span>${escapeHtml(log.status)} 路 ${escapeHtml(log.createdAt)}</span>
      </div>
    `).join('');
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
      invalidatePreview('预览已失效：已取消选择来源单据，请重新选择后预览凭证。');
    }
  }
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
  show({ selectedCount: state.selectedSourceIds.size, lastSelected: record }, `已选择 ${state.selectedSourceIds.size} 张来源单据。`);
}

function toggleAllVisibleDocuments(checked) {
  const visibleRecords = sortLedgerRecords(filterLedgerRecords(state.syncedDocuments));
  for (const record of visibleRecords) {
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
    invalidatePreview('预览已失效：已取消选择来源单据，请重新选择后预览凭证。');
  }
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
}

function selectedLedgerRecords() {
  return [...state.selectedSourceIds]
    .map((sourceId) => state.syncedDocuments.find((record) => record.sourceId === sourceId))
    .filter(Boolean);
}

function setActiveSourceRecord(record, invalidate) {
  sourceIdInput.value = record.sourceId;
  fields.mockFixedJson.value = record.fixedJson || fields.mockFixedJson.value;
  if (invalidate) {
    invalidatePreview('预览已失效：已切换来源单据，请重新预览凭证。');
  }
}

function renderSelectAllState(visibleRecords) {
  const selectedCount = visibleRecords.filter((record) => state.selectedSourceIds.has(record.sourceId)).length;
  selectAllRowsCheckbox.checked = visibleRecords.length > 0 && selectedCount === visibleRecords.length;
  selectAllRowsCheckbox.indeterminate = selectedCount > 0 && selectedCount < visibleRecords.length;
}

function renderStatus(status) {
  renderTenantOptions(status.config?.fenbeitong?.tenants || []);
  renderTenantState();
  document.querySelector('#fenbeitongMode').textContent = status.mode.fenbeitong === 'real' ? '已启用' : '待启用';
  document.querySelector('#kingdeeMode').textContent = status.mode.kingdee === 'real' ? '已启用' : '待启用';
  document.querySelector('#fenbeitongReady').textContent = readinessText(status.readiness.fenbeitong);
  document.querySelector('#kingdeeReady').textContent = readinessText(status.readiness.kingdee);
  document.querySelector('#syncedCount').textContent = status.summary.counts.syncedDocuments;
  document.querySelector('#pushedCount').textContent = status.summary.counts.pushedVouchers;
  document.querySelector('#draftCount').textContent = status.summary.counts.pushedVouchers;
  document.querySelector('#exceptionCount').textContent = status.summary.latestBatch?.failCount || 0;
  document.querySelector('#riskCount').textContent = status.summary.counts.pushedVouchers;
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
  const prepared = state.preparedSourceIds.has(sourceId) || status.summary.counts.preparedVouchers > 0;
  const pushed = state.pushedSourceIds.has(sourceId) || status.summary.counts.pushedVouchers > 0;
  let text = '请先保存配置，确保账簿、凭证字、期间、科目和核算维度可用。';
  if (pushed) text = '已有 ERP 暂存结果，下一步由财务在金蝶中人工审核。';
  else if (prepared && state.lastPreview?.balanced) text = '已生成待保存凭证，可保存为 ERP 草稿。';
  else if (state.lastPreview?.balanced) text = '凭证已预览且借贷平衡，下一步可直接保存至 ERP。';
  else if (sourceId) text = '已选择来源单据，下一步生成凭证并保存至 ERP。';
  else if (status.summary.counts.syncedDocuments > 0) text = '已有待处理单据，请先在列表中选择单据。';
  else if (state.configSaved) text = '配置已保存，下一步同步分贝通数据。';
  document.querySelector('#nextActionText').textContent = text;
}

function renderActionState() {
  const sourceId = sourceIdInput.value.trim();
  const hasSelection = state.selectedSourceIds.size > 0;
  const hasSource = Boolean(hasSelection || sourceId || fields.mockFixedJson.value.trim());
  const pushed = sourceId ? state.pushedSourceIds.has(sourceId) : false;
  const tenantWaiting = isSelectedTenantWaiting();
  controls.syncFenbeitong.disabled = tenantWaiting;
  controls.sync.disabled = tenantWaiting;
  controls.generateVoucher.disabled = !hasSource;
  controls.saveErp.disabled = !hasSource || pushed;
  controls.viewVoucher.disabled = !sourceId && !hasSelection;
  controls.preview.disabled = !hasSource;
  controls.prepare.disabled = !hasSource;
  controls.pushErp.disabled = !hasSource || pushed;
  controls.primaryAction.dataset.action = !state.configSaved ? 'save-config' : state.syncedDocuments.length === 0 ? 'sync' : 'push';
  controls.primaryAction.textContent = !state.configSaved ? '保存配置' : state.syncedDocuments.length === 0 ? '立即同步分贝通数据' : '保存至ERP';
  controls.primaryAction.disabled = tenantWaiting && controls.primaryAction.dataset.action === 'sync';
  actionBlockReason.textContent = getActionBlockReason({ sourceId, pushed });
}

function getActionBlockReason({ sourceId, pushed }) {
  if (isSelectedTenantWaiting()) return '瑛泰接口等待开发中。';
  if (!state.configSaved) return '未满足原因：请先保存配置。';
  if (state.syncedDocuments.length === 0) return '未满足原因：请先同步分贝通单据。';
  if (!sourceId && state.selectedSourceIds.size === 0) return '未满足原因：请先选择待处理单据。';
  if (pushed) return '该单据已保存，下一步由财务人工审核。';
  return '当前可生成凭证并保存 ERP 草稿。';
}

function renderTenantOptions(tenants) {
  if (!Array.isArray(tenants) || tenants.length === 0) {
    return;
  }
  const currentKey = state.selectedTenantKey;
  companySelect.innerHTML = tenants.map((tenant) =>
    `<option value="${escapeHtml(tenant.key)}">${escapeHtml(tenant.name)}</option>`
  ).join('');
  state.selectedTenantKey = tenants.some((tenant) => tenant.key === currentKey) ? currentKey : 'puhui';
  companySelect.value = state.selectedTenantKey;
}

function renderTenantState() {
  companySelect.value = state.selectedTenantKey;
  const waiting = isSelectedTenantWaiting();
  const name = companySelect.options[companySelect.selectedIndex]?.textContent || state.selectedTenantKey;
  tenantStatusText.textContent = waiting ? '接口等待开发中' : `${name}接口已启用`;
  tenantStatusText.classList.toggle('waiting', waiting);
}

function isSelectedTenantWaiting() {
  return state.selectedTenantKey === 'yingtai';
}

function renderConfigValidation() {
  const checks = [
    ['账簿编码', Boolean(fields.accountBookNumber.value.trim()), '写入 GL_VOUCHER 的 FAccountBookID'],
    ['凭证字编码', Boolean(fields.voucherGroupNumber.value.trim()), '写入 GL_VOUCHER 的 FVOUCHERGROUPID'],
    ['凭证日期和期间', Boolean(fields.mockVoucherDate.value && fields.mockYear.value && fields.mockPeriod.value), '写入日期、年度和期间'],
    ['费用科目映射', isJsonObject(fields.categoryAccountNumbers.value), '分贝通费用类型映射到借方科目'],
    ['币别映射', isJsonObject(fields.currencyNumbers.value), '分贝通币别映射到 ERP 币别'],
    ['贷方核算维度', isJsonObject(fields.creditDetailNumbers.value), '对方科目核算维度']
  ];
  document.querySelector('#configValidationList').innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}：${ok ? '通过' : '待补齐'}，${escapeHtml(detail)}</li>`
  ).join('');
}

function renderSourceQueue(records) {
  const visibleRecords = sortLedgerRecords(filterLedgerRecords(records));
  if (paginationSummary) paginationSummary.textContent = `Total ${visibleRecords.length}`;
  renderSelectAllState(visibleRecords);
  if (visibleRecords.length === 0) {
    sourceQueueBody.innerHTML = `<tr><td colspan="${ledgerTableColumnCount()}">暂无符合条件的报销单，请调整查询条件或先同步分贝通。</td></tr>`;
    renderColumnVisibility();
    renderFinanceReview(state.lastPreview);
    return;
  }
  sourceQueueBody.innerHTML = visibleRecords.map((record) => {
    const summary = buildSourceSummary(record);
    const selected = state.selectedSourceIds.has(record.sourceId);
    const prepared = state.preparedSourceIds.has(record.sourceId);
    const pushed = state.pushedSourceIds.has(record.sourceId);
    const actionText = pushed ? '已保存ERP' : prepared ? '重新生成' : '生成凭证';
    const disabled = pushed ? 'disabled' : '';
    return `
      <tr class="${selected ? 'selected' : ''}">
        <td><input class="row-checkbox" type="checkbox" data-source-id="${escapeHtml(record.sourceId)}" aria-label="选择 ${escapeHtml(displaySourceCode(record))}" ${selected ? 'checked' : ''} /></td>
        ${renderLedgerCell('status', `<span class="status-tag">${escapeHtml(queueStatus(record))}</span>`)}
        ${renderLedgerCell('sourceCode', escapeHtml(displaySourceCode(record)))}
        ${renderLedgerCell('requester', escapeHtml(displayRequester(record, summary.requester)))}
        ${renderLedgerCell('department', escapeHtml(summary.department))}
        ${renderLedgerCell('expenseCategories', escapeHtml(displayExpenseCategories(record, summary.expenseCategories)))}
        ${renderLedgerCell('amount', formatMoney(summary.totalAmount), 'amount')}
        ${renderLedgerCell('interfaceSource', escapeHtml(record.mockReplacement ? '接口未启用' : '正式接口'))}
        ${renderLedgerCell('time', escapeHtml(summary.createTime || record.updateTime || ''))}
        <td data-column-key="operationPanel" class="operation-panel-cell">
          <button class="row-action row-generate-voucher" type="button" data-source-id="${escapeHtml(record.sourceId)}" aria-label="为 ${escapeHtml(displaySourceCode(record))} 生成并保存至ERP" ${disabled}>${actionText}</button>
        </td>
      </tr>
    `;
  }).join('');
  renderColumnVisibility();
  renderFinanceReview(state.lastPreview);
}

function filterLedgerRecords(records) {
  const keyword = sourceSearchInput.value.trim().toLowerCase();
  if (!keyword) return records;
  return records.filter((record) => {
    const summary = buildSourceSummary(record);
    return matchesLedgerQuery(ledgerSearchValue(record, summary, searchFieldSelect.value), keyword, matchModeSelect.value);
  });
}

function ledgerSearchValue(record, summary, field) {
  if (field === 'requester') return displayRequester(record, summary.requester);
  if (field === 'department') return summary.department;
  if (field === 'status') return queueStatus(record);
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
  if (field === 'amount') return Number(summary.totalAmount || 0);
  if (field === 'sourceCode') return String(displaySourceCode(record) || '');
  return Date.parse(summary.createTime || record.updateTime || '') || 0;
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
    { key: 'status', label: '单据状态' },
    { key: 'sourceCode', label: '来源单号' },
    { key: 'requester', label: '报销人' },
    { key: 'department', label: '部门' },
    { key: 'expenseCategories', label: '费用类型' },
    { key: 'amount', label: '金额' },
    { key: 'interfaceSource', label: '接口来源' },
    { key: 'time', label: '更新时间' }
  ];
}

function visibleColumnKeys() {
  return [...state.visibleColumnKeys];
}

function toggleColumnSettings() {
  columnSettingsPanel.hidden = !columnSettingsPanel.hidden;
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

function exportLedgerCsv() {
  const rows = sortLedgerRecords(filterLedgerRecords(state.syncedDocuments));
  const header = visibleLedgerColumns().slice(1);
  const csvRows = [
    header,
    ...rows.map((record) => {
      const summary = buildSourceSummary(record);
      return [
        queueStatus(record),
        displaySourceCode(record),
        displayRequester(record, summary.requester),
        summary.department,
        displayExpenseCategories(record, summary.expenseCategories),
        formatMoney(summary.totalAmount),
        record.mockReplacement ? '接口未启用' : '正式接口',
        summary.createTime || record.updateTime || ''
      ];
    })
  ];
  const csv = csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `报销单列表-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  show({ count: rows.length }, `已导出 ${rows.length} 条报销单列表数据。`);
}

function renderVoucherPreview(preview) {
  renderFinanceReview(preview);
  document.querySelector('#previewBalanced').textContent = preview.balanced ? '是' : '否';
  document.querySelector('#previewDebitTotal').textContent = formatMoney(preview.debitTotal);
  document.querySelector('#previewCreditTotal').textContent = formatMoney(preview.creditTotal);
  document.querySelector('#previewLineCount').textContent = preview.financialSummary.lineCount;
  document.querySelector('#previewTaxTotal').textContent = formatMoney(preview.financialSummary.deductibleTaxAmount);
  voucherPreviewBody.innerHTML = preview.voucherLines.map((line) => `
    <tr>
      <td>${escapeHtml(line.explanation)}</td>
      <td>${escapeHtml(line.sourceExpenseId || '-')}</td>
      <td>${escapeHtml(line.accountNumber)}</td>
      <td>${escapeHtml(line.accountName || '-')}</td>
      <td>${escapeHtml(line.detailText || '-')}</td>
      <td>${escapeHtml(line.mappingRule || '-')}</td>
      <td class="amount">${formatMoney(line.debit)}</td>
      <td class="amount">${formatMoney(line.credit)}</td>
    </tr>
  `).join('');
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
        <div><dt>借贷平衡</dt><dd>${preview.balanced ? '是' : '否'}，借方 ${formatMoney(preview.debitTotal)} / 贷方 ${formatMoney(preview.creditTotal)}</dd></div>
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
        <div><dt>报销金额</dt><dd>${formatMoney(summary.totalAmount)}</dd></div>
      </dl>
    `;
    return;
  }
  financeReviewSummary.textContent = '请先从报销单列表选择一张单据。';
}

function renderVoucherValidation(preview) {
  const checks = preview ? [
    ['账簿编码', Boolean(preview.financialSummary.accountBookNumber), `将写入 ${preview.financialSummary.accountBookNumber}`],
    ['凭证字编码', Boolean(preview.financialSummary.voucherGroupNumber), `将写入 ${preview.financialSummary.voucherGroupNumber}`],
    ['借贷平衡', preview.balanced, `借方 ${formatMoney(preview.debitTotal)} / 贷方 ${formatMoney(preview.creditTotal)}`],
    ['科目映射', preview.voucherLines.every((line) => Boolean(line.accountNumber)), '每条分录都有科目编码']
  ] : [
    ['凭证预览', false, '请先选择单据并生成凭证']
  ];
  voucherValidationList.innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}：${ok ? '通过' : '待验证'}，${escapeHtml(detail)}</li>`
  ).join('');
}

function renderPreviewHashSummary(preview) {
  if (state.previewInvalidReason) {
    previewHashSummary.textContent = state.previewInvalidReason;
  } else if (!preview) {
    previewHashSummary.textContent = '尚未生成凭证预览。';
  } else {
    previewHashSummary.textContent = `当前预览内容哈希：${preview.contentHash}`;
  }
}

function renderSaveConfirmation(preview) {
  saveConfirmPanel.hidden = !preview;
  saveConfirmSummary.textContent = preview
    ? `来源单据 ${preview.sourceCode}，借方 ${formatMoney(preview.debitTotal)}，贷方 ${formatMoney(preview.creditTotal)}`
    : '请先预览凭证。';
  saveRiskNotice.textContent = '凭证只保存为金蝶暂存，不提交、不审核、不过账。';
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
  return '当前外部接口已启用，保存动作会写入配置的ERP账套，请先确认凭证预览。';
}

function readinessText(readiness) {
  if (readiness.ready) return '连接参数完整';
  return readiness.missing.length > 0 ? `缺少 ${readiness.missing.length} 项配置` : '待确认';
}

function applyTemplate(template) {
  state.erpTemplateDefaults = structuredClone(template);
  state.erpTemplateModel = template.erpTemplateModel || null;
  fields.accountBookNumber.value = template.accountBookNumber;
  fields.voucherGroupNumber.value = template.voucherGroupNumber;
  fields.templateErpFid.value = template.templateErpFid;
  fields.mockVoucherDate.value = template.mockVoucherDate;
  fields.mockYear.value = template.mockYear;
  fields.mockPeriod.value = template.mockPeriod;
  fields.currencyNumbers.value = JSON.stringify(template.currencyNumbers, null, 2);
  fields.categoryAccountNumbers.value = JSON.stringify(template.categoryAccountNumbers, null, 2);
  fields.creditDetailNumbers.value = JSON.stringify(template.creditDetailNumbers, null, 2);
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
    return requestSignature(buildVoucherRequest()) === state.previewSignature;
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
    return {
      requester: data.user?.name || data.user?.code || '-',
      department: data.user?.department_name || data.user?.department_code || '-',
      expenseCategories: expenses.map((expense) => expense.cost_category?.name || expense.cost_category?.code || '未分类').join(' / ') || '-',
      totalAmount: Number(data.total_amount || 0),
      createTime: data.create_time || data.reimb_time || ''
    };
  } catch {
    return { requester: '-', department: '-', expenseCategories: 'JSON解析失败', totalAmount: 0, createTime: '' };
  }
}

function queueStatus(record) {
  const sourceId = record.sourceId;
  if (state.pushedSourceIds.has(sourceId)) return '已保存ERP';
  if (state.preparedSourceIds.has(sourceId)) return '已生成';
  if (state.lastPreview?.sourceId === sourceId) return '已预览';
  return stageName(record.processStage);
}

function isRealPushedRecord(record) {
  return Boolean(
    record.processStage === 'ERP_PUSHED'
    && record.erpMode === 'real'
    && record.simulatedErp === false
    && record.erpFid
    && record.erpNumber
  );
}

function readConfig() {
  const defaults = requiredTemplateDefaults();
  return {
    accountBookNumber: fields.accountBookNumber.value,
    voucherGroupNumber: fields.voucherGroupNumber.value,
    templateErpFid: fields.templateErpFid.value,
    currencyNumbers: parseJson(fields.currencyNumbers.value, '币别映射'),
    categoryAccountNumbers: parseJson(fields.categoryAccountNumbers.value, '费用科目映射'),
    departmentDetailField: defaults.departmentDetailField,
    employeeDetailField: defaults.employeeDetailField,
    departmentDetailNumberMappings: cloneObject(defaults.departmentDetailNumberMappings),
    employeeDetailNumberMappings: cloneObject(defaults.employeeDetailNumberMappings),
    detailIdMappings: cloneObject(defaults.detailIdMappings),
    creditAccountNumber: defaults.creditAccountNumber,
    creditDetailNumbers: parseJson(fields.creditDetailNumbers.value, '贷方核算维度'),
    exchangeRateTypeNumber: defaults.exchangeRateTypeNumber,
    exchangeRate: defaults.exchangeRate,
    splitDeductibleTax: defaults.splitDeductibleTax,
    taxAccountNumber: defaults.taxAccountNumber,
    erpTemplateModel: state.erpTemplateModel
  };
}

function requiredTemplateDefaults() {
  if (!state.erpTemplateDefaults) {
    throw new Error('请先加载默认凭证参数。');
  }
  return state.erpTemplateDefaults;
}

function cloneObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('默认凭证参数缺少核算维度映射。');
  }
  return structuredClone(value);
}

function buildVoucherRequest() {
  const fixedJson = fields.mockFixedJson.value.trim();
  const sourceId = sourceIdInput.value.trim();
  if (!fixedJson && !sourceId) throw new Error('请先同步分贝通并选择待处理单据，或保留来源数据样例。');
  return {
    fixedJson: fixedJson || undefined,
    sourceId: sourceId || undefined,
    voucherDate: fields.mockVoucherDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value),
    config: readConfig()
  };
}

function buildVoucherRequestForRecord(record) {
  return {
    fixedJson: record.fixedJson || undefined,
    sourceId: record.sourceId,
    voucherDate: fields.mockVoucherDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value),
    config: readConfig()
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
  return `凭证预览完成：借方 ${formatMoney(preview.debitTotal)}，贷方 ${formatMoney(preview.creditTotal)}，分录 ${preview.financialSummary.lineCount} 条，状态为未审核草稿。`;
}

function draftOnlyWarning(record) {
  if (record.erpMockReplacement) return '处理结果已保存。外部ERP接口启用前，不写入正式ERP凭证。';
  return '已保存为 ERP 暂存凭证，未审核、未过账，需人工审核。';
}

function stageName(stage) {
  const names = { PREPARED: '已生成待保存凭证', ERP_PUSHED: '已保存草稿', SYNCED: '已同步' };
  return names[stage] || stage || '-';
}

function logLabel(action) {
  const labels = {
    CONFIG_SAVE: '保存配置',
    SOURCE_SYNC: '同步来源单据',
    SYNC_START: '开始同步',
    SYNC_FINISH: '同步完成',
    VOUCHER_PREPARE: '生成待保存凭证',
    ERP_PUSH: '保存到ERP',
    SCHEDULER_RUN_START: '定时任务开始',
    SCHEDULER_RUN_FINISH: '定时任务完成',
    SCHEDULER_DISABLED: '定时任务关闭'
  };
  return labels[action] || action;
}

function show(value, summary = '') {
  const message = summary || summarizeValue(value);
  resultOutput.textContent = JSON.stringify(value, null, 2);
  resultSummary.textContent = message;
  showOperationFeedback(message, Boolean(value?.error));
}

function showOperationFeedback(message, isError = false) {
  if (!operationFeedback) return;
  operationFeedback.textContent = message;
  operationFeedback.hidden = false;
  operationFeedback.classList.toggle('error', isError);
}

function showError(step, error) {
  show({ error: error.message, code: error.code || 'FRONTEND_ERROR', detail: error.detail || {}, step }, `失败步骤：${step}；错误编码：${error.code || 'FRONTEND_ERROR'}；原因：${error.message}`);
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
      showError(fn.name || '鎿嶄綔', error);
    } finally {
      renderActionState();
    }
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

