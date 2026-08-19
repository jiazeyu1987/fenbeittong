import { api } from './api.js';

const queryInput = document.querySelector('#logQueryInput');
const statusSelect = document.querySelector('#logStatusSelect');
const actionSelect = document.querySelector('#logActionSelect');
const startDate = document.querySelector('#logStartDate');
const endDate = document.querySelector('#logEndDate');
const tableBody = document.querySelector('#logTableBody');
const summary = document.querySelector('#logQuerySummary');
let operationLogs = [];

document.querySelector('#queryLogsButton').addEventListener('click', renderLogs);
document.querySelector('#refreshLogCenterButton').addEventListener('click', refreshLogs);
document.querySelector('#resetLogsButton').addEventListener('click', () => {
  queryInput.value = '';
  statusSelect.value = '';
  actionSelect.value = '';
  startDate.value = '';
  endDate.value = '';
  renderLogs();
});
queryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') renderLogs();
});

await refreshLogs();

async function refreshLogs() {
  try {
    operationLogs = await api.listLogs(200);
    const actions = [...new Set(operationLogs.map((log) => log.action).filter(Boolean))].sort();
    actionSelect.innerHTML = '<option value="">全部操作</option>' + actions
      .map((action) => `<option value="${escapeHtml(action)}">${escapeHtml(logLabel(action))}</option>`)
      .join('');
    renderLogs();
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="5" class="log-error">日志读取失败：${escapeHtml(error.message)}</td></tr>`;
    summary.textContent = '读取失败';
  }
}

function renderLogs() {
  const keyword = queryInput.value.trim().toLocaleLowerCase('zh-CN');
  const start = startDate.value ? new Date(`${startDate.value}T00:00:00`).getTime() : -Infinity;
  const end = endDate.value ? new Date(`${endDate.value}T23:59:59.999`).getTime() : Infinity;
  const filtered = operationLogs.filter((log) => {
    const timestamp = new Date(log.createdAt).getTime();
    if (statusSelect.value && log.status !== statusSelect.value) return false;
    if (actionSelect.value && log.action !== actionSelect.value) return false;
    if (timestamp < start || timestamp > end) return false;
    if (!keyword) return true;
    return [log.action, logLabel(log.action), log.status, JSON.stringify(log.detail || {})]
      .some((value) => String(value).toLocaleLowerCase('zh-CN').includes(keyword));
  });
  summary.textContent = `共读取 ${operationLogs.length} 条，当前查询 ${filtered.length} 条 · ${new Date().toLocaleString('zh-CN')}`;
  tableBody.innerHTML = filtered.length === 0
    ? '<tr><td colspan="5">没有符合查询条件的日志。</td></tr>'
    : filtered.map((log) => `
      <tr>
        <td>${escapeHtml(formatTime(log.createdAt))}</td>
        <td><span class="log-status ${log.status === 'FAILED' ? 'failed' : 'success'}">${log.status === 'FAILED' ? '失败' : '成功'}</span></td>
        <td><code>${escapeHtml(log.action)}</code></td>
        <td>${escapeHtml(logLabel(log.action))}</td>
        <td><pre>${escapeHtml(formatDetail(log.detail))}</pre></td>
      </tr>
    `).join('');
}

function logLabel(action) {
  return ({
    CONFIG_SAVE: '保存配置', SOURCE_SYNC: '同步来源单据', SOURCE_SYNC_BATCH: '批量同步来源单据',
    SYNC_START: '开始同步', SYNC_FINISH: '同步完成', SYNC_ERROR: '同步失败',
    EXPENSE_REIMBURSEMENT_PREPARE: '生成费用报销单', ERP_EXPENSE_REIMBURSEMENT_SAVE: '保存费用报销单',
    KINGDEE_ACCOUNT_SELECT: '切换ERP账号', INTEGRATION_SELECTION_SAVE: '保存连接配置',
    SCHEDULER_RUN_START: '定时任务开始', SCHEDULER_RUN_FINISH: '定时任务完成',
    SCHEDULER_RUN_ERROR: '定时任务失败', SCHEDULER_DISABLED: '定时任务关闭'
  })[action] || action || '-';
}

function formatDetail(detail) {
  if (!detail || Object.keys(detail).length === 0) return '-';
  return JSON.stringify(detail, null, 2);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
