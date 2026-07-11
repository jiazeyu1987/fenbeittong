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
  syncedDocuments: [],
  selectedSourceIds: new Set(),
  visibleColumnKeys: new Set(['status', 'sourceCode', 'requester', 'department', 'expenseCategories', 'amount', 'interfaceSource', 'time']),
  sortField: 'time',
  sortDirection: 'desc',
  lastPreview: null,
  previewSignature: '',
  previewInvalidReason: '',
  preparedSourceIds: new Set(),
  pushedSourceIds: new Set()
};

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const resultSummary = document.querySelector('#resultSummary');
const sourceIdInput = document.querySelector('#sourceIdInput');
const searchFieldSelect = document.querySelector('#searchFieldSelect');
const matchModeSelect = document.querySelector('#matchModeSelect');
const sourceSearchInput = document.querySelector('#sourceSearchInput');
const paginationSummary = document.querySelector('#paginationSummary');
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
sourceQueueBody.addEventListener('change', run(toggleQueuedDocument));
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
  invalidatePreview('棰勮宸插け鏁堬細鏉ユ簮鍗曟嵁宸插彉鍖栵紝璇烽噸鏂伴瑙堝嚟璇併€?);
  renderActionState();
});
for (const field of Object.values(fields)) {
  field.addEventListener('input', () => {
    invalidatePreview('棰勮宸插け鏁堬細鍑瘉鍏抽敭瀛楁宸插彉鍖栵紝璇烽噸鏂伴瑙堝嚟璇併€?);
    renderActionState();
  });
}

run(async () => {
  await api.health();
  statusBadge.textContent = '鍚庣宸茶繛鎺?;
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
  show(template, '宸茶浇鍏ラ粯璁ゅ嚟璇佸弬鏁帮紝璇蜂繚瀛橀厤缃悗寮€濮嬪悓姝ャ€?);
}

async function saveConfig() {
  const saved = await api.saveConfig(readConfig());
  state.configSaved = true;
  renderConfigValidation();
  show(saved, '閰嶇疆宸蹭繚瀛橈紝鍙互绔嬪嵆鍚屾鍒嗚礉閫氭暟鎹€?);
  await refreshAll();
}

async function syncFenbeitong() {
  const result = await api.syncFenbeitong();
  selectFirstRecord(result.records);
  invalidatePreview('棰勮宸插け鏁堬細鍚屾缁撴灉宸插彉鍖栵紝璇烽噸鏂伴瑙堝嚟璇併€?);
  show(result, `鍚屾瀹屾垚锛屾柊澧炴垨鏇存柊 ${result.records.length} 寮犳潵婧愬崟鎹€俙);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  selectFirstRecord(result.sync.records);
  invalidatePreview('棰勮宸插け鏁堬細鍚屾缁撴灉宸插彉鍖栵紝璇烽噸鏂伴瑙堝嚟璇併€?);
  show(result, `瀹氭椂浠诲姟宸叉墜鍔ㄨ繍琛岋紝鏈鍚屾 ${result.sync.records.length} 寮犳潵婧愬崟鎹€俙);
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
  ensurePreviewFresh();
  const record = await api.prepare(buildVoucherRequest());
  sourceIdInput.value = record.sourceId;
  state.preparedSourceIds.add(record.sourceId);
  show(record, '宸茬敓鎴愬緟淇濆瓨鍑瘉銆傛湰鍦拌褰曞凡淇濈暀骞傜瓑閿拰鍐呭鍝堝笇銆?);
  await refreshAll();
}

async function generateVoucherFromLedger() {
  const records = selectedLedgerRecords();
  if (records.length === 0) {
    await preview();
    await prepare();
    return;
  }
  const prepared = [];
  for (const record of records) {
    setActiveSourceRecord(record, false);
    const request = buildVoucherRequestForRecord(record);
    const previewResult = await api.preview(request);
    const preparedRecord = await api.prepare(request);
    state.lastPreview = previewResult;
    state.previewSignature = requestSignature(request);
    state.previewInvalidReason = '';
    state.preparedSourceIds.add(preparedRecord.sourceId);
    prepared.push(preparedRecord);
  }
  show({ count: prepared.length, records: prepared }, `宸茬敓鎴?${prepared.length} 寮犲緟淇濆瓨鍑瘉銆俙);
  await refreshAll();
}

async function pushSelectedToErp() {
  const records = selectedLedgerRecords();
  if (records.length === 0) {
    await pushErp();
    return;
  }
  const pushed = [];
  for (const record of records) {
    setActiveSourceRecord(record, false);
    const saved = await api.pushErp({
      sourceId: record.sourceId,
      voucherDate: fields.mockVoucherDate.value,
      year: Number(fields.mockYear.value),
      period: Number(fields.mockPeriod.value),
      config: readConfig()
    });
    state.pushedSourceIds.add(saved.sourceId);
    pushed.push(saved);
  }
  show({ count: pushed.length, records: pushed }, `宸蹭繚瀛?${pushed.length} 寮燛RP鑽夌鍑瘉锛岀瓑寰呰储鍔′汉宸ュ鏍搞€俙);
  await refreshAll();
}

async function pushErp() {
  ensurePreviewFresh();
  const sourceId = requiredSourceId();
  const record = await api.pushErp({
    sourceId,
    voucherDate: fields.mockVoucherDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value),
    config: readConfig()
  });
  state.pushedSourceIds.add(record.sourceId);
  show(record, draftOnlyWarning(record));
  await refreshAll();
}

async function queryProcess() {
  show(await api.getProcess(requiredSourceId()), '宸叉煡璇㈠埌鏈湴澶勭悊璁板綍銆?);
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
  state.pushedSourceIds = new Set(records.filter((record) => record.processStage === 'ERP_PUSHED').map((record) => record.sourceId));
  renderSourceQueue(state.syncedDocuments);
  if (records.length === 0) {
    recordsTable.innerHTML = '<tr><td colspan="5">鏆傛棤璁板綍锛岃鍏堝悓姝ュ垎璐濋€氭暟鎹€?/td></tr>';
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
  if (logs.length === 0) {
    logsList.textContent = '鏆傛棤鏃ュ織';
    return;
  }
  logsList.innerHTML = logs.slice(0, 8).map((log) => `
    <div class="log-item">
      <strong>${escapeHtml(logLabel(log.action))}</strong>
      <span>${escapeHtml(log.status)} 路 ${escapeHtml(log.createdAt)}</span>
    </div>
  `).join('');
}

async function runPrimaryAction() {
  const action = controls.primaryAction.dataset.action;
  if (action === 'save-config') {
    await saveConfig();
  } else if (action === 'sync') {
    await syncFenbeitong();
  } else if (action === 'preview') {
    await preview();
  } else if (action === 'prepare') {
    await prepare();
  } else if (action === 'push') {
    await pushErp();
  } else {
    throw new Error('褰撳墠娌℃湁鍙墽琛岀殑涓绘搷浣滐紝璇峰厛妫€鏌ラ厤缃拰鏉ユ簮鍗曟嵁銆?);
  }
}

async function toggleQueuedDocument(event) {
  const checkbox = event.target.closest('input[data-source-id]');
  if (!checkbox) {
    return;
  }
  const sourceId = checkbox.dataset.sourceId;
  const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
  if (!record) {
    throw new Error(`寰呭鐞嗗崟鎹笉瀛樺湪锛?{sourceId}`);
  }
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
      invalidatePreview('棰勮宸插け鏁堬細宸插彇娑堥€夋嫨鏉ユ簮鍗曟嵁锛岃閲嶆柊閫夋嫨鍚庨瑙堝嚟璇併€?);
    }
  }
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
  show({ selectedCount: state.selectedSourceIds.size, lastSelected: record }, `宸查€夋嫨 ${state.selectedSourceIds.size} 寮犳潵婧愬崟鎹€俙);
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
    invalidatePreview('棰勮宸插け鏁堬細宸插彇娑堥€夋嫨鏉ユ簮鍗曟嵁锛岃閲嶆柊閫夋嫨鍚庨瑙堝嚟璇併€?);
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
    invalidatePreview('棰勮宸插け鏁堬細宸插垏鎹㈡潵婧愬崟鎹紝璇烽噸鏂伴瑙堝嚟璇併€?);
  }
}

function renderSelectAllState(visibleRecords) {
  if (!selectAllRowsCheckbox) {
    return;
  }
  const selectedCount = visibleRecords.filter((record) => state.selectedSourceIds.has(record.sourceId)).length;
  selectAllRowsCheckbox.checked = visibleRecords.length > 0 && selectedCount === visibleRecords.length;
  selectAllRowsCheckbox.indeterminate = selectedCount > 0 && selectedCount < visibleRecords.length;
}

function renderStatus(status) {
  document.querySelector('#fenbeitongMode').textContent = status.mode.fenbeitong === 'real' ? '宸插惎鐢? : '寰呭惎鐢?;
  document.querySelector('#kingdeeMode').textContent = status.mode.kingdee === 'real' ? '宸插惎鐢? : '寰呭惎鐢?;
  document.querySelector('#fenbeitongReady').textContent = readinessText(status.readiness.fenbeitong);
  document.querySelector('#kingdeeReady').textContent = readinessText(status.readiness.kingdee);
  document.querySelector('#syncedCount').textContent = status.summary.counts.syncedDocuments;
  document.querySelector('#pushedCount').textContent = status.summary.counts.pushedVouchers;
  document.querySelector('#draftCount').textContent = status.summary.counts.pushedVouchers;
  document.querySelector('#exceptionCount').textContent = status.summary.latestBatch?.failCount || 0;
  document.querySelector('#riskCount').textContent = status.summary.counts.pushedVouchers;
  const batch = status.summary.latestBatch;
  const mockReplacement = Boolean(batch?.mockReplacement || status.mode.kingdee === 'mock' || status.mode.fenbeitong === 'mock');
  document.querySelector('#mockReplacement').textContent = mockReplacement ? '鏈惎鐢? : '宸插惎鐢?;
  document.querySelector('#mockReason').textContent = interfaceReason(batch?.mockReason, mockReplacement);
  document.querySelector('#schedulerEnabled').textContent = status.scheduler.enabled ? '寮€鍚? : '鍏抽棴';
  document.querySelector('#schedulerDetail').textContent = schedulerSummary(status.scheduler);
  document.querySelector('#environmentWarning').textContent = environmentWarning(status);
  document.querySelector('#syncBatchSummary').textContent = syncBatchSummary(batch);
  renderNextAction(status);
  renderConfigValidation();
  renderFinanceReview(state.lastPreview);
}

function renderNextAction(status) {
  const sourceId = sourceIdInput.value.trim();
  const prepared = state.preparedSourceIds.has(sourceId) || status.summary.counts.preparedVouchers > 0;
  const pushed = state.pushedSourceIds.has(sourceId) || status.summary.counts.pushedVouchers > 0;
  let text = '璇峰厛淇濆瓨閰嶇疆锛岀‘淇濊处绨裤€佸嚟璇佸瓧銆佹湡闂淬€佺鐩拰鏍哥畻缁村害鍙敤銆?;
  if (pushed) {
    text = '宸叉湁 ERP 鏆傚瓨缁撴灉锛屼笅涓€姝ョ敱璐㈠姟鍦ㄩ噾铦朵腑浜哄伐瀹℃牳銆?;
  } else if (prepared && state.lastPreview?.balanced) {
    text = '宸茬敓鎴愬緟淇濆瓨鍑瘉锛岀‘璁や繚瀛樺墠淇℃伅鍚庡彲淇濆瓨涓?ERP 鏆傚瓨鍑瘉銆?;
  } else if (state.lastPreview?.balanced) {
    text = '鍑瘉宸查瑙堜笖鍊熻捶骞宠　锛屼笅涓€姝ョ敓鎴愬緟淇濆瓨鍑瘉銆?;
  } else if (sourceId) {
    text = '宸查€夋嫨鏉ユ簮鍗曟嵁锛屼笅涓€姝ラ瑙堝嚟璇佸苟纭鍊熻捶骞宠　銆?;
  } else if (status.summary.counts.syncedDocuments > 0) {
    text = '宸叉湁寰呭鐞嗗崟鎹紝璇峰厛鍦ㄩ槦鍒椾腑閫夋嫨涓€寮犲崟鎹€?;
  } else if (state.configSaved) {
    text = '閰嶇疆宸蹭繚瀛橈紝涓嬩竴姝ョ珛鍗冲悓姝ュ垎璐濋€氭暟鎹€?;
  }
  document.querySelector('#nextActionText').textContent = text;
}

function renderActionState() {
  const sourceId = sourceIdInput.value.trim();
  const hasSelection = state.selectedSourceIds.size > 0;
  const hasSource = Boolean(hasSelection || sourceId || fields.mockFixedJson.value.trim());
  const prepared = sourceId ? state.preparedSourceIds.has(sourceId) : false;
  const pushed = sourceId ? state.pushedSourceIds.has(sourceId) : false;
  const previewFresh = isPreviewFresh();
  controls.generateVoucher.disabled = !hasSource;
  controls.saveErp.disabled = !state.lastPreview?.balanced || !previewFresh || !sourceId || pushed;
  controls.viewVoucher.disabled = !sourceId && !hasSelection;
  controls.preview.disabled = !hasSource;
  controls.prepare.disabled = !state.lastPreview?.balanced || !previewFresh;
  controls.pushErp.disabled = !state.lastPreview?.balanced || !previewFresh || !sourceId || pushed;
  const reason = getActionBlockReason({ sourceId, prepared, pushed });

  let action = 'save-config';
  let label = '淇濆瓨閰嶇疆';
  let disabled = false;
  if (state.configSaved && state.syncedDocuments.length === 0) {
    action = 'sync';
    label = '绔嬪嵆鍚屾鍒嗚礉閫氭暟鎹?;
  } else if (state.configSaved && !sourceId) {
    action = 'preview';
    label = '鍏堥€夋嫨寰呭鐞嗗崟鎹?;
    disabled = true;
  } else if (state.configSaved && (!state.lastPreview?.balanced || !previewFresh)) {
    action = 'preview';
    label = state.previewInvalidReason ? '閲嶆柊棰勮鍑瘉' : '棰勮鍑瘉';
  } else if (state.configSaved && !prepared) {
    action = 'prepare';
    label = '鐢熸垚寰呬繚瀛樺嚟璇?;
  } else if (state.configSaved && !pushed) {
    action = 'push';
    label = '淇濆瓨ERP鑽夌';
  } else if (pushed) {
    action = 'done';
    label = '宸蹭繚瀛橈紝绛夊緟璐㈠姟浜哄伐瀹℃牳';
    disabled = true;
  }
  controls.primaryAction.dataset.action = action;
  controls.primaryAction.textContent = label;
  controls.primaryAction.disabled = disabled;
  actionBlockReason.textContent = reason;
}

function getActionBlockReason({ sourceId, prepared, pushed }) {
  if (!state.configSaved) {
    return '鏈弧瓒冲師鍥狅細璇峰厛淇濆瓨閰嶇疆锛岀‘淇濊处绨裤€佸嚟璇佸瓧銆佺鐩拰鏍哥畻缁村害鍙敤銆?;
  }
  if (state.syncedDocuments.length === 0) {
    return '鏈弧瓒冲師鍥狅細杩樻病鏈夊悓姝ュ埌鍒嗚礉閫氬崟鎹紝璇峰厛鎵ц鍚屾銆?;
  }
  if (!sourceId) {
    return '鏈弧瓒冲師鍥狅細璇峰厛鍦ㄥ緟澶勭悊鍗曟嵁闃熷垪涓€夋嫨涓€寮犲崟鎹€?;
  }
  if (state.previewInvalidReason) {
    return state.previewInvalidReason;
  }
  if (!state.lastPreview?.balanced) {
    return '鏈弧瓒冲師鍥狅細璇峰厛棰勮鍑瘉锛屽苟纭鍊熻捶骞宠　銆佺◣棰濆拰绉戠洰鏄犲皠銆?;
  }
  if (!prepared) {
    return '褰撳墠鍙敓鎴愬緟淇濆瓨鍑瘉锛涚郴缁熷皢淇濈暀骞傜瓑閿拰鍐呭鍝堝笇锛岄伩鍏嶉噸澶嶅叆璐︺€?;
  }
  if (!pushed) {
    return state.currentStatus?.mode.kingdee === 'real'
      ? '褰撳墠鍙繚瀛樺埌閲戣澏娴嬭瘯璐﹀锛涘彧淇濆瓨鏆傚瓨鍑瘉锛屼笉鎻愪氦銆佷笉瀹℃牳銆佷笉杩囪处銆?
      : '褰撳墠澶栭儴ERP鎺ュ彛鏈惎鐢紝绯荤粺浠呬繚瀛樻湰鍦板鐞嗙粨鏋滐紝涓嶅啓鍏ユ寮廍RP銆?;
  }
  return '璇ュ崟鎹凡淇濆瓨锛屼笅涓€姝ョ敱璐㈠姟鍦ㄩ噾铦朵腑浜哄伐瀹℃牳銆?;
}

function renderConfigValidation() {
  const checks = [
    ['璐︾翱缂栫爜', Boolean(fields.accountBookNumber.value.trim()), '鍐欏叆 GL_VOUCHER 鐨?FAccountBookID'],
    ['鍑瘉瀛楃紪鐮?, Boolean(fields.voucherGroupNumber.value.trim()), '鍐欏叆 GL_VOUCHER 鐨?FVOUCHERGROUPID'],
    ['鍑瘉鏃ユ湡鍜屾湡闂?, Boolean(fields.mockVoucherDate.value && fields.mockYear.value && fields.mockPeriod.value), '鍐欏叆鏃ユ湡銆佸勾搴﹀拰鏈熼棿'],
    ['璐圭敤绉戠洰鏄犲皠', isJsonObject(fields.categoryAccountNumbers.value), '鍒嗚礉閫氳垂鐢ㄧ被鍨嬫槧灏勫埌鍊熸柟绉戠洰'],
    ['甯佸埆鏄犲皠', isJsonObject(fields.currencyNumbers.value), '鍒嗚礉閫氬竵鍒槧灏勫埌 ERP 甯佸埆'],
    ['璐锋柟鏍哥畻缁村害', isJsonObject(fields.creditDetailNumbers.value), '瀵规柟绉戠洰鏍哥畻缁村害']
  ];
  document.querySelector('#configValidationList').innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}锛?{ok ? '閫氳繃' : '寰呰ˉ榻?}锛?{escapeHtml(detail)}</li>`
  ).join('');
}

function renderSourceQueue(records) {
  const visibleRecords = sortLedgerRecords(filterLedgerRecords(records));
  if (paginationSummary) {
    paginationSummary.textContent = `Total ${visibleRecords.length}`;
  }
  renderSelectAllState(visibleRecords);
  if (visibleRecords.length === 0) {
    sourceQueueBody.innerHTML = `<tr><td colspan="${visibleLedgerColumns().length}">暂无符合条件的报销单，请调整查询条件或先同步分贝通。</td></tr>`;
    renderColumnVisibility();
    renderFinanceReview(state.lastPreview);
    return;
  }
  sourceQueueBody.innerHTML = visibleRecords.map((record) => {
    const summary = buildSourceSummary(record);
    const selected = state.selectedSourceIds.has(record.sourceId);
    return `
    <tr class="${selected ? 'selected' : ''}">
      <td><input class="row-checkbox" type="checkbox" data-source-id="${escapeHtml(record.sourceId)}" aria-label="閫夋嫨 ${escapeHtml(displaySourceCode(record))}" ${selected ? 'checked' : ''} /></td>
      ${renderLedgerCell('status', `<span class="status-tag">${escapeHtml(queueStatus(record))}</span>`)}
      ${renderLedgerCell('sourceCode', escapeHtml(displaySourceCode(record)))}
      ${renderLedgerCell('requester', escapeHtml(displayRequester(record, summary.requester)))}
      ${renderLedgerCell('department', escapeHtml(summary.department))}
      ${renderLedgerCell('expenseCategories', escapeHtml(displayExpenseCategories(record, summary.expenseCategories)))}
      ${renderLedgerCell('amount', formatMoney(summary.totalAmount), 'amount')}
      ${renderLedgerCell('interfaceSource', escapeHtml(record.mockReplacement ? '接口未启用' : '正式接口'))}
      ${renderLedgerCell('time', escapeHtml(summary.createTime || record.updateTime || ''))}
    </tr>
  `;
  }).join('');
  renderColumnVisibility();
  renderFinanceReview(state.lastPreview);
}

function filterLedgerRecords(records) {
  const keyword = sourceSearchInput.value.trim().toLowerCase();
  if (!keyword) {
    return records;
  }
  return records.filter((record) => {
    const summary = buildSourceSummary(record);
    return matchesLedgerQuery(
      ledgerSearchValue(record, summary, searchFieldSelect.value),
      keyword,
      matchModeSelect.value
    );
  });
}

function ledgerSearchValue(record, summary, field) {
  if (field === 'requester') {
    return displayRequester(record, summary.requester);
  }
  if (field === 'department') {
    return summary.department;
  }
  if (field === 'status') {
    return queueStatus(record);
  }
  return displaySourceCode(record);
}

function matchesLedgerQuery(value, keyword, mode) {
  const normalizedValue = String(value || '').toLowerCase();
  if (mode === 'equals') {
    return normalizedValue === keyword;
  }
  if (mode === 'notEquals') {
    return normalizedValue !== keyword;
  }
  return normalizedValue.includes(keyword);
}

function sortLedgerRecords(records) {
  return [...records].sort((left, right) => {
    const leftValue = ledgerSortValue(left, state.sortField);
    const rightValue = ledgerSortValue(right, state.sortField);
    const direction = state.sortDirection === 'asc' ? 1 : -1;
    if (leftValue > rightValue) {
      return direction;
    }
    if (leftValue < rightValue) {
      return -direction;
    }
    return String(displaySourceCode(left)).localeCompare(String(displaySourceCode(right)), 'zh-CN');
  });
}

function ledgerSortValue(record, field) {
  const summary = buildSourceSummary(record);
  if (field === 'amount') {
    return Number(summary.totalAmount || 0);
  }
  if (field === 'sourceCode') {
    return String(displaySourceCode(record) || '');
  }
  return Date.parse(summary.createTime || record.updateTime || '') || 0;
}

function setLedgerSort(field) {
  if (state.sortField === field) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortField = field;
    state.sortDirection = field === 'time' ? 'desc' : 'asc';
  }
  renderSourceQueue(state.syncedDocuments);
}

function visibleLedgerColumns() {
  return ['操作', ...ledgerColumnDefinitions()
    .filter((column) => state.visibleColumnKeys.has(column.key))
    .map((column) => column.label)];
}

function renderLedgerCell(key, content, className = '') {
  if (!state.visibleColumnKeys.has(key)) {
    return '';
  }
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
  if (!checkbox) {
    return;
  }
  const key = checkbox.dataset.columnToggle;
  if (checkbox.checked) {
    state.visibleColumnKeys.add(key);
  } else {
    state.visibleColumnKeys.delete(key);
  }
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
        record.mockReplacement ? '鎺ュ彛鏈惎鐢? : '姝ｅ紡鎺ュ彛',
        summary.createTime || record.updateTime || ''
      ];
    })
  ];
  const csv = csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `鎶ラ攢鍗曞垪琛?${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  show({ count: rows.length }, `宸插鍑?${rows.length} 鏉℃姤閿€鍗曞垪琛ㄦ暟鎹€俙);
}

function renderVoucherPreview(preview) {
  renderFinanceReview(preview);
  document.querySelector('#previewBalanced').textContent = preview.balanced ? '鏄? : '鍚?;
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
  if (!financeReviewSummary) {
    return;
  }
  const selectedSourceId = sourceIdInput.value.trim();
  const selectedRecord = state.syncedDocuments.find((record) => record.sourceId === selectedSourceId);

  if (preview) {
    const summary = preview.sourceSummary || {};
    financeReviewSummary.innerHTML = `
      <dl>
        <div><dt>鏉ユ簮鍗曞彿</dt><dd>${escapeHtml(selectedRecord ? displaySourceCode(selectedRecord) : preview.sourceCode || '-')}</dd></div>
        <div><dt>鎶ラ攢浜?/dt><dd>${escapeHtml(selectedRecord ? displayRequester(selectedRecord, summary.requester) : summary.requester || '-')}</dd></div>
        <div><dt>閮ㄩ棬</dt><dd>${escapeHtml(summary.department || '-')}</dd></div>
        <div><dt>鏈熼棿</dt><dd>${escapeHtml(`${preview.financialSummary.year} 骞?${preview.financialSummary.period} 鏈焋)}</dd></div>
        <div><dt>鍊熻捶骞宠　</dt><dd>${preview.balanced ? '鏄? : '鍚?}锛屽€熸柟 ${formatMoney(preview.debitTotal)} / 璐锋柟 ${formatMoney(preview.creditTotal)}</dd></div>
        <div><dt>绋庨</dt><dd>鍙姷鎵ｇ◣棰?${formatMoney(preview.taxSummary?.deductibleTaxAmount || 0)}</dd></div>
        <div><dt>鑽夌瑙勫垯</dt><dd>鍙繚瀛橀噾铦舵殏瀛樺嚟璇侊紝涓嶆彁浜ゃ€佷笉瀹℃牳銆佷笉杩囪处銆?/dd></div>
      </dl>
    `;
    return;
  }

  if (selectedRecord) {
    const summary = buildSourceSummary(selectedRecord);
    financeReviewSummary.innerHTML = `
      <dl>
        <div><dt>鏉ユ簮鍗曞彿</dt><dd>${escapeHtml(displaySourceCode(selectedRecord))}</dd></div>
        <div><dt>鎶ラ攢浜?/dt><dd>${escapeHtml(displayRequester(selectedRecord, summary.requester))}</dd></div>
        <div><dt>閮ㄩ棬</dt><dd>${escapeHtml(summary.department)}</dd></div>
        <div><dt>璐圭敤绫诲瀷</dt><dd>${escapeHtml(displayExpenseCategories(selectedRecord, summary.expenseCategories))}</dd></div>
        <div><dt>鎶ラ攢閲戦</dt><dd>${formatMoney(summary.totalAmount)}</dd></div>
        <div><dt>涓嬩竴姝?/dt><dd>鐐瑰嚮棰勮鍑瘉锛岀‘璁ょ鐩€佽緟鍔╂牳绠椼€佺◣棰濆拰鍊熻捶骞宠　銆?/dd></div>
      </dl>
    `;
    return;
  }

  financeReviewSummary.textContent = '璇峰厛浠庢姤閿€鍗曞垪琛ㄩ€夋嫨涓€寮犲崟鎹€?;
}

function renderVoucherValidation(preview) {
  const checks = preview ? [
    ['璐︾翱缂栫爜', Boolean(preview.financialSummary.accountBookNumber), `灏嗗啓鍏?${preview.financialSummary.accountBookNumber}`],
    ['鍑瘉瀛楃紪鐮?, Boolean(preview.financialSummary.voucherGroupNumber), `灏嗗啓鍏?${preview.financialSummary.voucherGroupNumber}`],
    ['浼氳鏈熼棿', Boolean(preview.financialSummary.year && preview.financialSummary.period), `${preview.financialSummary.year} 骞?${preview.financialSummary.period} 鏈焋],
    ['鍊熻捶骞宠　', preview.balanced, `鍊熸柟 ${formatMoney(preview.debitTotal)} / 璐锋柟 ${formatMoney(preview.creditTotal)}`],
    ['绋庨鎷嗗垎', Number(preview.taxSummary?.deductibleTaxAmount || 0) >= 0, `鍙姷鎵ｇ◣棰?${formatMoney(preview.taxSummary?.deductibleTaxAmount || 0)}`],
    ['绉戠洰鏄犲皠', preview.voucherLines.every((line) => Boolean(line.accountNumber)), '姣忔潯鍒嗗綍閮芥湁绉戠洰缂栫爜']
  ] : [
    ['鍑瘉棰勮', false, '璇峰厛閫夋嫨鍗曟嵁骞剁偣鍑婚瑙堝嚟璇?]
  ];
  voucherValidationList.innerHTML = checks.map(([label, ok, detail]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}锛?{ok ? '閫氳繃' : '寰呴獙璇?}锛?{escapeHtml(detail)}</li>`
  ).join('');
}

function renderPreviewHashSummary(preview) {
  if (!previewHashSummary) {
    return;
  }
  if (state.previewInvalidReason) {
    previewHashSummary.textContent = state.previewInvalidReason;
    return;
  }
  if (!preview) {
    previewHashSummary.textContent = '灏氭湭鐢熸垚鍑瘉棰勮銆?;
    return;
  }
  previewHashSummary.textContent = `褰撳墠棰勮鍐呭鍝堝笇锛?{preview.contentHash}锛涘叧閿瓧娈靛彉鍖栧悗蹇呴』閲嶆柊棰勮銆俙;
}

function renderSaveConfirmation(preview) {
  if (!preview) {
    saveConfirmPanel.hidden = true;
    saveConfirmSummary.textContent = '璇峰厛棰勮鍑瘉銆?;
    return;
  }
  saveConfirmPanel.hidden = false;
  saveConfirmSummary.textContent = [
    `鏉ユ簮鍗曟嵁 ${preview.sourceCode}`,
    `鎶ラ攢浜?${preview.sourceSummary?.requester || '-'}`,
    `閮ㄩ棬 ${preview.sourceSummary?.department || '-'}`,
    `璐︾翱 ${fields.accountBookNumber.value}`,
    `鍑瘉瀛?${fields.voucherGroupNumber.value}`,
    `${fields.mockYear.value} 骞?${fields.mockPeriod.value} 鏈焋,
    `鍊熸柟 ${formatMoney(preview.debitTotal)}`,
    `璐锋柟 ${formatMoney(preview.creditTotal)}`,
    `鍙姷鎵ｇ◣棰?${formatMoney(preview.taxSummary?.deductibleTaxAmount || 0)}`,
    `${preview.financialSummary.lineCount} 鏉″垎褰昤
  ].join('锛?);
  saveRiskNotice.textContent = state.currentStatus?.mode.kingdee === 'real'
    ? '灏嗗啓鍏ラ噾铦舵祴璇曡处濂楀苟鍙繚瀛樹负鏆傚瓨鍑瘉锛屼笉鎻愪氦銆佷笉瀹℃牳銆佷笉杩囪处銆?
    : '褰撳墠澶栭儴ERP鎺ュ彛鏈惎鐢紝绯荤粺浠呬繚瀛樻湰鍦板鐞嗙粨鏋滐紝涓嶅啓鍏ユ寮廍RP銆?;
}

function schedulerSummary(scheduler) {
  const interval = `${scheduler.intervalSeconds}s`;
  const pushMode = scheduler.autoPushErp ? '鑷姩鎺ㄩ€?ERP' : '浠呭悓姝?;
  const lastRun = scheduler.lastRunAt ? `鏈€杩?${scheduler.lastRunAt}` : '灏氭湭杩愯';
  return `${interval} 路 ${pushMode} 路 ${lastRun}`;
}

function syncBatchSummary(batch) {
  if (!batch) {
    return '灏氭湭浜х敓鍚屾鎵规銆?;
  }
  const interfaceText = batch.mockReplacement ? `鎺ュ彛鐘舵€侊細${interfaceReason(batch.mockReason, true)}` : '鐪熷疄鎺ュ彛';
  return `鏈€杩戞壒娆?${batch.batchId}锛?{batch.status}锛屾垚鍔?${batch.successCount}/${batch.totalCount}锛屽け璐?${batch.failCount}锛?{interfaceText}銆傞噸澶嶅崟鎹寜鏉ユ簮 ID 鍜屽唴瀹瑰搱甯屽箓绛夋洿鏂般€俙;
}

function interfaceReason(reason, replacementEnabled) {
  if (!replacementEnabled) {
    return '鐪熷疄鎺ュ彛宸插惎鐢?;
  }
  const normalized = String(reason || '').toLowerCase();
  if (normalized.includes('fenbeitong') || normalized.includes('access token')) {
    return '鍒嗚礉閫氭巿鏉冩湭閰嶇疆';
  }
  if (normalized.includes('kingdee') || normalized.includes('erp')) {
    return 'ERP鎺ュ彛鏈惎鐢?;
  }
  return reason ? String(reason) : '澶栭儴鎺ュ彛鏈叏閮ㄥ惎鐢?;
}

function displaySourceCode(record) {
  return record?.sourceCode || record?.sourceId || '-';
}

function displayRequester(record, requester) {
  return requester || '-';
}

function displayExpenseCategories(record, categories) {
  return String(categories || '-')
    .replaceAll('Travel', '宸梾璐?)
    .replaceAll('Office', '鍔炲叕璐?)
    .replaceAll(' / ', ' / ');
}

function environmentWarning(status) {
  if (status.mode.kingdee === 'mock') {
    return '褰撳墠澶栭儴ERP鎺ュ彛鏈惎鐢紝淇濆瓨鍔ㄤ綔浠呰褰曞鐞嗙粨鏋滐紝涓嶅啓鍏ユ寮廍RP銆?;
  }
  return '褰撳墠澶栭儴鎺ュ彛宸插惎鐢紝淇濆瓨鍔ㄤ綔浼氬啓鍏ラ厤缃殑ERP璐﹀锛岃鍏堢‘璁ゅ嚟璇侀瑙堛€?;
}

function readinessText(readiness) {
  if (readiness.ready) {
    return '杩炴帴鍙傛暟瀹屾暣';
  }
  return readiness.missing.length > 0 ? `缂哄皯 ${readiness.missing.length} 椤归厤缃甡 : '寰呯‘璁?;
}

function applyTemplate(template) {
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
  if (!state.lastPreview) {
    renderPreviewHashSummary(null);
    renderFinanceReview(null);
    return;
  }
  state.lastPreview = null;
  state.previewSignature = '';
  state.previewInvalidReason = reason;
  renderSaveConfirmation(null);
  renderVoucherValidation(null);
  renderPreviewHashSummary(null);
  renderFinanceReview(null);
}

function ensurePreviewFresh() {
  if (!state.lastPreview || !isPreviewFresh()) {
    throw new Error('棰勮宸插け鏁堬紝璇烽噸鏂伴瑙堝嚟璇併€?);
  }
}

function isPreviewFresh() {
  if (!state.lastPreview || !state.previewSignature) {
    return false;
  }
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
      expenseCategories: expenses.map((expense) => expense.cost_category?.name || expense.cost_category?.code || '鏈垎绫?).join(' / ') || '-',
      totalAmount: Number(data.total_amount || 0),
      createTime: data.create_time || data.reimb_time || ''
    };
  } catch {
    return {
      requester: '-',
      department: '-',
      expenseCategories: 'JSON 瑙ｆ瀽澶辫触',
      totalAmount: 0
    };
  }
}

function queueStatus(record) {
  const sourceId = record.sourceId;
  if (state.pushedSourceIds.has(sourceId)) {
    return '宸蹭繚瀛楨RP';
  }
  if (state.preparedSourceIds.has(sourceId)) {
    return '宸茬敓鎴?;
  }
  if (state.lastPreview?.sourceId === sourceId) {
    return '宸查瑙?;
  }
  return stageName(record.processStage);
}

function readConfig() {
  return {
    accountBookNumber: fields.accountBookNumber.value,
    voucherGroupNumber: fields.voucherGroupNumber.value,
    templateErpFid: fields.templateErpFid.value,
    currencyNumbers: parseJson(fields.currencyNumbers.value, '甯佸埆鏄犲皠'),
    categoryAccountNumbers: parseJson(fields.categoryAccountNumbers.value, '璐圭敤绉戠洰鏄犲皠'),
    departmentDetailField: 'FDETAILID__FFLEX5',
    employeeDetailField: 'FDETAILID__FFLEX7',
    creditAccountNumber: '1002.01',
    creditDetailNumbers: parseJson(fields.creditDetailNumbers.value, '璐锋柟鏍哥畻缁村害'),
    exchangeRateTypeNumber: 'HLTX01_SYS',
    exchangeRate: 1,
    splitDeductibleTax: true,
    taxAccountNumber: '2221.01.01.05'
  };
}

function buildVoucherRequest() {
  const fixedJson = fields.mockFixedJson.value.trim();
  const sourceId = sourceIdInput.value.trim();
  if (!fixedJson && !sourceId) {
    throw new Error('璇峰厛鍚屾鍒嗚礉閫氬苟閫夋嫨寰呭鐞嗗崟鎹紝鎴栦繚鐣欐潵婧愭暟鎹牱渚嬨€?);
  }
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
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('not object');
    }
    return value;
  } catch {
    throw new Error(`${label} 蹇呴』鏄?JSON 瀵硅薄`);
  }
}

function requiredSourceId() {
  const sourceId = sourceIdInput.value.trim();
  if (!sourceId) {
    throw new Error('璇峰厛鍚屾鍒嗚礉閫氬苟閫夋嫨寰呭鐞嗗崟鎹€?);
  }
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
  return `鍑瘉棰勮瀹屾垚锛氬€熸柟 ${formatMoney(preview.debitTotal)}锛岃捶鏂?${formatMoney(preview.creditTotal)}锛屽垎褰?${preview.financialSummary.lineCount} 鏉★紝鐘舵€佷负鏈鏍歌崏绋裤€俙;
}

function draftOnlyWarning(record) {
  if (record.erpMockReplacement) {
    return '澶勭悊缁撴灉宸蹭繚瀛樸€傚閮‥RP鎺ュ彛鍚敤鍓嶏紝涓嶅啓鍏ユ寮廍RP鍑瘉銆?;
  }
  return '宸蹭繚瀛樹负 ERP 鏆傚瓨鍑瘉锛屾湭瀹℃牳 / 鏈繃璐?/ 闇€浜哄伐瀹℃牳銆?;
}

function stageName(stage) {
  const names = {
    PREPARED: '宸茬敓鎴愬緟淇濆瓨鍑瘉',
    ERP_PUSHED: '宸蹭繚瀛樿崏绋?,
    SYNCED: '宸插悓姝?
  };
  return names[stage] || stage || '-';
}

function logLabel(action) {
  const labels = {
    CONFIG_SAVE: '淇濆瓨閰嶇疆',
    SOURCE_SYNC: '鍚屾鏉ユ簮鍗曟嵁',
    SYNC_START: '寮€濮嬪悓姝?,
    SYNC_FINISH: '鍚屾瀹屾垚',
    VOUCHER_PREPARE: '鐢熸垚寰呬繚瀛樺嚟璇?,
    ERP_PUSH: '淇濆瓨鍒?ERP',
    SCHEDULER_RUN_START: '瀹氭椂浠诲姟寮€濮?,
    SCHEDULER_RUN_FINISH: '瀹氭椂浠诲姟瀹屾垚',
    SCHEDULER_DISABLED: '瀹氭椂浠诲姟鍏抽棴'
  };
  return labels[action] || action;
}

function show(value, summary = '') {
  resultOutput.textContent = JSON.stringify(value, null, 2);
  resultSummary.textContent = summary || summarizeValue(value);
}

function showError(step, error) {
  show({
    error: error.message,
    code: error.code || 'FRONTEND_ERROR',
    detail: error.detail || {},
    step
  }, `澶辫触姝ラ锛?{step}锛涢敊璇紪鐮侊細${error.code || 'FRONTEND_ERROR'}锛涘師鍥狅細${error.message}锛涜鏍规嵁閿欒鏄庣粏淇閰嶇疆鎴栨潵婧愬崟鎹悗閲嶈瘯銆俙);
}

function summarizeValue(value) {
  if (value?.error) {
    return `鎿嶄綔澶辫触锛?{value.error}`;
  }
  if (value?.sourceCode) {
    return `澶勭悊瀹屾垚锛?{value.sourceCode}`;
  }
  return '鎿嶄綔瀹屾垚锛屾妧鏈鎯呭凡鏇存柊銆?;
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
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
