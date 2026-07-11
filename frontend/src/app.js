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
  lastPreview: null,
  preparedSourceIds: new Set(),
  pushedSourceIds: new Set()
};

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const resultSummary = document.querySelector('#resultSummary');
const sourceIdInput = document.querySelector('#sourceIdInput');
const recordsTable = document.querySelector('#recordsTable');
const logsList = document.querySelector('#logsList');
const voucherPreviewBody = document.querySelector('#voucherPreviewBody');
const sourceQueueBody = document.querySelector('#sourceQueueBody');
const saveConfirmPanel = document.querySelector('#saveConfirmPanel');
const saveConfirmSummary = document.querySelector('#saveConfirmSummary');
const saveRiskNotice = document.querySelector('#saveRiskNotice');

controls.loadTemplate.addEventListener('click', run(loadTemplate));
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
sourceQueueBody.addEventListener('click', run(selectQueuedDocument));
sourceIdInput.addEventListener('input', () => {
  state.lastPreview = null;
  renderSaveConfirmation(null);
  renderActionState();
});

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
  show(template, '已载入标准配置，请保存配置后开始同步。');
}

async function saveConfig() {
  const saved = await api.saveConfig(readConfig());
  state.configSaved = true;
  renderConfigValidation();
  show(saved, '配置已保存，可以立即同步分贝通数据。');
  await refreshAll();
}

async function syncFenbeitong() {
  const result = await api.syncFenbeitong();
  selectFirstRecord(result.records);
  state.lastPreview = null;
  renderSaveConfirmation(null);
  show(result, `同步完成，新增或更新 ${result.records.length} 张来源单据。`);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  selectFirstRecord(result.sync.records);
  state.lastPreview = null;
  renderSaveConfirmation(null);
  show(result, `定时任务已手动运行，本次同步 ${result.sync.records.length} 张来源单据。`);
  await refreshAll();
}

async function preview() {
  const result = await api.preview(buildVoucherRequest());
  state.lastPreview = result;
  renderVoucherPreview(result);
  renderSaveConfirmation(result);
  show(result, buildPreviewSummary(result));
  await refreshAll();
}

async function prepare() {
  const record = await api.prepare(buildVoucherRequest());
  sourceIdInput.value = record.sourceId;
  state.preparedSourceIds.add(record.sourceId);
  show(record, '已生成待保存凭证。本地记录已保留幂等键和内容哈希。');
  await refreshAll();
}

async function pushErp() {
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
  state.pushedSourceIds = new Set(records.filter((record) => record.processStage === 'ERP_PUSHED').map((record) => record.sourceId));
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
  if (logs.length === 0) {
    logsList.textContent = '暂无日志';
    return;
  }
  logsList.innerHTML = logs.slice(0, 8).map((log) => `
    <div class="log-item">
      <strong>${escapeHtml(logLabel(log.action))}</strong>
      <span>${escapeHtml(log.status)} · ${escapeHtml(log.createdAt)}</span>
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
    throw new Error('当前没有可执行的主操作，请先检查配置和来源单据。');
  }
}

async function selectQueuedDocument(event) {
  const button = event.target.closest('button[data-source-id]');
  if (!button) {
    return;
  }
  const sourceId = button.dataset.sourceId;
  const record = state.syncedDocuments.find((item) => item.sourceId === sourceId);
  if (!record) {
    throw new Error(`待处理单据不存在：${sourceId}`);
  }
  sourceIdInput.value = sourceId;
  fields.mockFixedJson.value = record.fixedJson || fields.mockFixedJson.value;
  state.lastPreview = null;
  renderSaveConfirmation(null);
  renderSourceQueue(state.syncedDocuments);
  renderActionState();
  show(record, `已选择来源单据 ${sourceId}，下一步请预览凭证。`);
}

function renderStatus(status) {
  document.querySelector('#fenbeitongMode').textContent = status.mode.fenbeitong.toUpperCase();
  document.querySelector('#kingdeeMode').textContent = status.mode.kingdee.toUpperCase();
  document.querySelector('#fenbeitongReady').textContent = status.readiness.fenbeitong.message;
  document.querySelector('#kingdeeReady').textContent = status.readiness.kingdee.message;
  document.querySelector('#syncedCount').textContent = status.summary.counts.syncedDocuments;
  document.querySelector('#pushedCount').textContent = status.summary.counts.pushedVouchers;
  const batch = status.summary.latestBatch;
  const mockReplacement = Boolean(batch?.mockReplacement || status.mode.kingdee === 'mock' || status.mode.fenbeitong === 'mock');
  document.querySelector('#mockReplacement').textContent = mockReplacement ? '开启' : '关闭';
  document.querySelector('#mockReason').textContent = batch?.mockReason || (mockReplacement ? '外部依赖未全部就绪' : '真实接口模式');
  document.querySelector('#schedulerEnabled').textContent = status.scheduler.enabled ? '开启' : '关闭';
  document.querySelector('#schedulerDetail').textContent = schedulerSummary(status.scheduler);
  document.querySelector('#environmentWarning').textContent = environmentWarning(status);
  document.querySelector('#syncBatchSummary').textContent = syncBatchSummary(batch);
  renderNextAction(status);
  renderSelfCheck(status);
  renderConfigValidation();
}

function renderNextAction(status) {
  const sourceId = sourceIdInput.value.trim();
  const prepared = state.preparedSourceIds.has(sourceId) || status.summary.counts.preparedVouchers > 0;
  const pushed = state.pushedSourceIds.has(sourceId) || status.summary.counts.pushedVouchers > 0;
  let text = '请先保存配置，确保账簿、凭证字、期间、科目和核算维度可用。';
  if (pushed) {
    text = '已有 ERP 暂存结果，下一步由财务在金蝶中人工审核。';
  } else if (prepared && state.lastPreview?.balanced) {
    text = '已生成待保存凭证，确认保存前信息后可保存为 ERP 暂存凭证。';
  } else if (state.lastPreview?.balanced) {
    text = '凭证已预览且借贷平衡，下一步生成待保存凭证。';
  } else if (sourceId) {
    text = '已选择来源单据，下一步预览凭证并确认借贷平衡。';
  } else if (status.summary.counts.syncedDocuments > 0) {
    text = '已有待处理单据，请先在队列中选择一张单据。';
  } else if (state.configSaved) {
    text = '配置已保存，下一步立即同步分贝通数据。';
  }
  document.querySelector('#nextActionText').textContent = text;
}

function renderActionState() {
  const sourceId = sourceIdInput.value.trim();
  const hasSource = Boolean(sourceId || fields.mockFixedJson.value.trim());
  const prepared = sourceId ? state.preparedSourceIds.has(sourceId) : false;
  const pushed = sourceId ? state.pushedSourceIds.has(sourceId) : false;
  controls.preview.disabled = !hasSource;
  controls.prepare.disabled = !state.lastPreview?.balanced;
  controls.pushErp.disabled = !state.lastPreview?.balanced || !sourceId || pushed;

  let action = 'save-config';
  let label = '保存配置';
  let disabled = false;
  if (state.configSaved && state.syncedDocuments.length === 0) {
    action = 'sync';
    label = '立即同步分贝通数据';
  } else if (state.configSaved && !sourceId) {
    action = 'preview';
    label = '先选择待处理单据';
    disabled = true;
  } else if (state.configSaved && !state.lastPreview?.balanced) {
    action = 'preview';
    label = '预览凭证';
  } else if (state.configSaved && !prepared) {
    action = 'prepare';
    label = '生成待保存凭证';
  } else if (state.configSaved && !pushed) {
    action = 'push';
    label = state.currentStatus?.mode.kingdee === 'real' ? '保存凭证到金蝶测试账套' : '模拟保存到 ERP';
  } else if (pushed) {
    action = 'done';
    label = '已保存，等待财务人工审核';
    disabled = true;
  }
  controls.primaryAction.dataset.action = action;
  controls.primaryAction.textContent = label;
  controls.primaryAction.disabled = disabled;
}

function renderSelfCheck(status) {
  const checks = [
    ['配置可用', state.configSaved],
    ['mock 数据可同步', status.summary.counts.syncedDocuments > 0],
    ['凭证可预览', Boolean(state.lastPreview?.balanced)],
    ['ERP mock 保存可验证', status.summary.counts.pushedVouchers > 0],
    ['真实模式缺失配置会失败提示', status.config.fenbeitong.accessTokenConfigured === false]
  ];
  document.querySelector('#selfCheckList').innerHTML = checks.map(([label, ok]) =>
    `<li class="${ok ? 'ok' : 'pending'}">${escapeHtml(label)}：${ok ? '通过' : '待验证'}</li>`
  ).join('');
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
  if (records.length === 0) {
    sourceQueueBody.innerHTML = '<tr><td colspan="7">暂无待处理单据，请先同步分贝通数据。</td></tr>';
    return;
  }
  const selected = sourceIdInput.value.trim();
  sourceQueueBody.innerHTML = records.map((record) => `
    <tr class="${record.sourceId === selected ? 'selected' : ''}">
      <td><button class="secondary row-action" data-source-id="${escapeHtml(record.sourceId)}">${record.sourceId === selected ? '已选择' : '选择'}</button></td>
      <td>${escapeHtml(record.sourceId)}</td>
      <td>${escapeHtml(record.sourceCode || '')}</td>
      <td>${escapeHtml(record.batchId || '-')}</td>
      <td>${escapeHtml(stageName(record.processStage))}</td>
      <td>${escapeHtml(record.mockReplacement ? `${record.sourceMode} / mock替代` : record.sourceMode)}</td>
      <td>${escapeHtml(record.updateTime || '')}</td>
    </tr>
  `).join('');
}

function renderVoucherPreview(preview) {
  document.querySelector('#previewBalanced').textContent = preview.balanced ? '是' : '否';
  document.querySelector('#previewDebitTotal').textContent = formatMoney(preview.debitTotal);
  document.querySelector('#previewCreditTotal').textContent = formatMoney(preview.creditTotal);
  document.querySelector('#previewLineCount').textContent = preview.financialSummary.lineCount;
  document.querySelector('#previewTaxTotal').textContent = formatMoney(preview.financialSummary.deductibleTaxAmount);
  voucherPreviewBody.innerHTML = preview.voucherLines.map((line) => `
    <tr>
      <td>${escapeHtml(line.explanation)}</td>
      <td>${escapeHtml(line.accountNumber)}</td>
      <td>${escapeHtml(line.accountName || '-')}</td>
      <td>${escapeHtml(line.detailText || '-')}</td>
      <td>${formatMoney(line.debit)}</td>
      <td>${formatMoney(line.credit)}</td>
    </tr>
  `).join('');
}

function renderSaveConfirmation(preview) {
  if (!preview) {
    saveConfirmPanel.hidden = true;
    saveConfirmSummary.textContent = '请先预览凭证。';
    return;
  }
  saveConfirmPanel.hidden = false;
  saveConfirmSummary.textContent = [
    `来源单据 ${preview.sourceCode}`,
    `账簿 ${fields.accountBookNumber.value}`,
    `凭证字 ${fields.voucherGroupNumber.value}`,
    `${fields.mockYear.value} 年 ${fields.mockPeriod.value} 期`,
    `借方 ${formatMoney(preview.debitTotal)}`,
    `贷方 ${formatMoney(preview.creditTotal)}`,
    `${preview.financialSummary.lineCount} 条分录`
  ].join('；');
  saveRiskNotice.textContent = state.currentStatus?.mode.kingdee === 'real'
    ? '将写入金蝶测试账套并只保存为暂存凭证，不提交、不审核、不过账。'
    : '当前为 ERP mock 保存，只验证请求结构和处理闭环，不会写入真实金蝶。';
}

function schedulerSummary(scheduler) {
  const interval = `${scheduler.intervalSeconds}s`;
  const pushMode = scheduler.autoPushErp ? '自动推送 ERP' : '仅同步';
  const lastRun = scheduler.lastRunAt ? `最近 ${scheduler.lastRunAt}` : '尚未运行';
  return `${interval} · ${pushMode} · ${lastRun}`;
}

function syncBatchSummary(batch) {
  if (!batch) {
    return '尚未产生同步批次。';
  }
  const mockText = batch.mockReplacement ? `mock 替代：${batch.mockReason || '外部依赖未就绪'}` : '真实来源';
  return `最近批次 ${batch.batchId}：${batch.status}，成功 ${batch.successCount}/${batch.totalCount}，失败 ${batch.failCount}，${mockText}。重复单据按来源 ID 和内容哈希幂等更新。`;
}

function environmentWarning(status) {
  const fenbeitong = status.mode.fenbeitong.toUpperCase();
  const kingdee = status.mode.kingdee.toUpperCase();
  if (status.mode.kingdee === 'mock') {
    return `当前分贝通 ${fenbeitong}，金蝶 ${kingdee}。点击保存到 ERP 只会模拟保存，不会写入真实金蝶。`;
  }
  return `当前分贝通 ${fenbeitong}，金蝶 ${kingdee}。保存动作会写入配置的测试账套，请先确认凭证预览。`;
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

function readConfig() {
  return {
    accountBookNumber: fields.accountBookNumber.value,
    voucherGroupNumber: fields.voucherGroupNumber.value,
    templateErpFid: fields.templateErpFid.value,
    currencyNumbers: parseJson(fields.currencyNumbers.value, '币别映射'),
    categoryAccountNumbers: parseJson(fields.categoryAccountNumbers.value, '费用科目映射'),
    departmentDetailField: 'FDETAILID__FFLEX5',
    employeeDetailField: 'FDETAILID__FFLEX7',
    creditAccountNumber: '1002.01',
    creditDetailNumbers: parseJson(fields.creditDetailNumbers.value, '贷方核算维度'),
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
    throw new Error('请先同步分贝通并选择待处理单据，或保留固定 JSON mock 数据。');
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

function parseJson(text, label) {
  try {
    const value = JSON.parse(text || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('not object');
    }
    return value;
  } catch {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
}

function requiredSourceId() {
  const sourceId = sourceIdInput.value.trim();
  if (!sourceId) {
    throw new Error('请先同步分贝通并选择待处理单据。');
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
    sourceIdInput.value = firstRecord.sourceId;
  }
}

function buildPreviewSummary(preview) {
  return `凭证预览完成：借方 ${formatMoney(preview.debitTotal)}，贷方 ${formatMoney(preview.creditTotal)}，分录 ${preview.financialSummary.lineCount} 条，状态为未审核草稿。`;
}

function draftOnlyWarning(record) {
  if (record.erpMockReplacement) {
    return '模拟保存完成，不是真实 ERP 凭证。真实保存前仍需金蝶 GL_VOUCHER 示例验证。';
  }
  return '已保存为 ERP 暂存凭证，未审核 / 未过账 / 需人工审核。';
}

function stageName(stage) {
  const names = {
    PREPARED: '已生成待保存凭证',
    ERP_PUSHED: '已保存草稿',
    SYNCED: '已同步'
  };
  return names[stage] || stage || '-';
}

function logLabel(action) {
  const labels = {
    CONFIG_SAVE: '保存配置',
    SOURCE_SYNC: '同步来源单据',
    SYNC_START: '开始同步',
    SYNC_FINISH: '同步完成',
    VOUCHER_PREPARE: '生成待保存凭证',
    ERP_PUSH: '保存到 ERP',
    SCHEDULER_RUN_START: '定时任务开始',
    SCHEDULER_RUN_FINISH: '定时任务完成',
    SCHEDULER_DISABLED: '定时任务关闭'
  };
  return labels[action] || action;
}

function show(value, summary = '') {
  resultOutput.textContent = JSON.stringify(value, null, 2);
  resultSummary.textContent = summary || summarizeValue(value);
}

function showError(step, error) {
  show({ error: error.message, step }, `失败步骤：${step}；原因：${error.message}；下一步：按提示补齐配置或重新选择单据后再试。`);
}

function summarizeValue(value) {
  if (value?.error) {
    return `操作失败：${value.error}`;
  }
  if (value?.sourceCode) {
    return `处理完成：${value.sourceCode}`;
  }
  return '操作完成，技术详情已更新。';
}

function run(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (error) {
      showError(fn.name || '操作', error);
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
