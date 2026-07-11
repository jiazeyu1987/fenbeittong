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

const state = {
  configSaved: false,
  lastPreview: null
};

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const resultSummary = document.querySelector('#resultSummary');
const sourceIdInput = document.querySelector('#sourceIdInput');
const recordsTable = document.querySelector('#recordsTable');
const logsList = document.querySelector('#logsList');
const voucherPreviewBody = document.querySelector('#voucherPreviewBody');

document.querySelector('#loadTemplateButton').addEventListener('click', run(loadTemplate));
document.querySelector('#saveConfigButton').addEventListener('click', run(saveConfig));
document.querySelector('#syncButton').addEventListener('click', run(syncFenbeitong));
document.querySelector('#runSchedulerButton').addEventListener('click', run(runSchedulerOnce));
document.querySelector('#previewButton').addEventListener('click', run(preview));
document.querySelector('#prepareButton').addEventListener('click', run(prepare));
document.querySelector('#pushErpButton').addEventListener('click', run(pushErp));
document.querySelector('#queryButton').addEventListener('click', run(queryProcess));
document.querySelector('#refreshButton').addEventListener('click', run(refreshAll));
document.querySelector('#listRecordsButton').addEventListener('click', run(refreshRecords));

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
  show(template, '已载入标准配置，请保存配置后开始同步。');
}

async function saveConfig() {
  const saved = await api.saveConfig(readConfig());
  state.configSaved = true;
  show(saved, '配置已保存，可以立即同步分贝通数据。');
  await refreshAll();
}

async function syncFenbeitong() {
  const result = await api.syncFenbeitong();
  const firstRecord = result.records[0];
  if (firstRecord) {
    sourceIdInput.value = firstRecord.sourceId;
  }
  show(result, `同步完成，新增或更新 ${result.records.length} 张来源单据。`);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  const firstRecord = result.sync.records[0];
  if (firstRecord) {
    sourceIdInput.value = firstRecord.sourceId;
  }
  show(result, `定时任务已手动运行，本次同步 ${result.sync.records.length} 张来源单据。`);
  await refreshAll();
}

async function preview() {
  const result = await api.preview(buildVoucherRequest());
  state.lastPreview = result;
  renderVoucherPreview(result);
  show(result, buildPreviewSummary(result));
  await refreshAll();
}

async function prepare() {
  const record = await api.prepare(buildVoucherRequest());
  sourceIdInput.value = record.sourceId;
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
  show(record, draftOnlyWarning(record));
  await refreshAll();
}

async function queryProcess() {
  show(await api.getProcess(requiredSourceId()), '已查询到本地处理记录。');
}

async function refreshAll() {
  const status = await api.systemStatus();
  renderStatus(status);
  await refreshRecords();
  await refreshLogs();
}

async function refreshRecords() {
  const records = await api.listProcessRecords();
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
  renderNextAction(status);
  renderSelfCheck(status);
}

function renderNextAction(status) {
  const prepared = status.summary.counts.preparedVouchers;
  const synced = status.summary.counts.syncedDocuments;
  const pushed = status.summary.counts.pushedVouchers;
  let text = '当前未同步分贝通数据，建议先点击立即同步分贝通数据。';
  if (pushed > 0) {
    text = '已有 ERP 暂存结果，下一步由财务在金蝶中人工审核。';
  } else if (prepared > 0) {
    text = '已有待保存凭证，确认后可保存为 ERP 暂存凭证。';
  } else if (synced > 0) {
    text = '已有来源单据，建议预览凭证并确认借贷平衡。';
  }
  document.querySelector('#nextActionText').textContent = text;
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

function schedulerSummary(scheduler) {
  const interval = `${scheduler.intervalSeconds}s`;
  const pushMode = scheduler.autoPushErp ? '自动推送 ERP' : '仅同步';
  const lastRun = scheduler.lastRunAt ? `最近 ${scheduler.lastRunAt}` : '尚未运行';
  return `${interval} · ${pushMode} · ${lastRun}`;
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
    throw new Error('请先同步分贝通，或保留固定 JSON mock 数据');
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
    throw new Error('请先同步分贝通，或输入来源 ID');
  }
  return sourceId;
}

function buildPreviewSummary(preview) {
  return `凭证预览完成：借方 ${formatMoney(preview.debitTotal)}，贷方 ${formatMoney(preview.creditTotal)}，分录 ${preview.financialSummary.lineCount} 条，状态为未审核草稿。`;
}

function draftOnlyWarning(record) {
  if (record.erpMockReplacement) {
    return '模拟保存，不是真实 ERP 凭证。真实保存前仍需金蝶 GL_VOUCHER 示例验证。';
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
  return async () => {
    try {
      await fn();
    } catch (error) {
      show({ error: error.message }, `操作失败：${error.message}`);
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
