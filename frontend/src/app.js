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

const statusBadge = document.querySelector('#statusBadge');
const resultOutput = document.querySelector('#resultOutput');
const sourceIdInput = document.querySelector('#sourceIdInput');
const recordsTable = document.querySelector('#recordsTable');
const logsList = document.querySelector('#logsList');

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
  show(template);
}

async function saveConfig() {
  show(await api.saveConfig(readConfig()));
  await refreshLogs();
}

async function syncFenbeitong() {
  const result = await api.syncFenbeitong();
  const firstRecord = result.records[0];
  if (firstRecord) {
    sourceIdInput.value = firstRecord.sourceId;
  }
  show(result);
  await refreshAll();
}

async function runSchedulerOnce() {
  const result = await api.runSchedulerOnce();
  const firstRecord = result.sync.records[0];
  if (firstRecord) {
    sourceIdInput.value = firstRecord.sourceId;
  }
  show(result);
  await refreshAll();
}

async function preview() {
  show(await api.preview(buildVoucherRequest()));
}

async function prepare() {
  const record = await api.prepare(buildVoucherRequest());
  sourceIdInput.value = record.sourceId;
  show(record);
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
  show(record);
  await refreshAll();
}

async function queryProcess() {
  show(await api.getProcess(requiredSourceId()));
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
    recordsTable.innerHTML = '<tr><td colspan="5">暂无记录</td></tr>';
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
      <strong>${escapeHtml(log.action)}</strong>
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
  document.querySelector('#mockReplacement').textContent = mockReplacement ? '启用' : '关闭';
  document.querySelector('#mockReason').textContent = batch?.mockReason || (mockReplacement ? '外部依赖未全部就绪' : '真实接口模式');
  document.querySelector('#schedulerEnabled').textContent = status.scheduler.enabled ? '启用' : '关闭';
  document.querySelector('#schedulerDetail').textContent = schedulerSummary(status.scheduler);
}

function schedulerSummary(scheduler) {
  const interval = `${scheduler.intervalSeconds}s`;
  const pushMode = scheduler.autoPushErp ? '自动推送 ERP' : '仅同步';
  const lastRun = scheduler.lastRunAt ? `最近 ${scheduler.lastRunAt}` : '尚未运行';
  return `${interval} · ${pushMode} · ${lastRun}`;
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

function stageName(stage) {
  const names = {
    PREPARED: '已准备',
    ERP_PUSHED: '已推送 ERP',
    SYNCED: '已同步'
  };
  return names[stage] || stage || '-';
}

function show(value) {
  resultOutput.textContent = JSON.stringify(value, null, 2);
}

function run(fn) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      show({ error: error.message });
    }
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
