export async function runBatchOperation(
  items,
  operation,
  onProgress = () => {},
  options = {}
) {
  const concurrency = Math.max(
    1,
    Math.min(items.length || 1, Number(options.concurrency) || 1)
  );
  const outcomes = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  let successCount = 0;
  let failureCount = 0;

  async function worker() {
    while (true) {
      if (typeof options.waitUntilResumed === 'function') {
        await options.waitUntilResumed();
      }
      if (nextIndex >= items.length) break;
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      let progressError;
      try {
        outcomes[index] = { success: true, value: await operation(item) };
        successCount += 1;
      } catch (error) {
        outcomes[index] = { success: false, item, error };
        progressError = error;
        failureCount += 1;
      }
      completed += 1;
      onProgress({
        completed,
        total: items.length,
        successCount,
        failureCount,
        item,
        error: progressError
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    successes: outcomes.filter((outcome) => outcome?.success)
      .map((outcome) => outcome.value),
    failures: outcomes.filter((outcome) => outcome && !outcome.success)
      .map(({ item, error }) => ({ item, error }))
  };
}

export function formatBatchFailureDetails(failures) {
  return failures.map((failure, index) => {
    const record = failure.item || failure;
    const error = failure.error || failure;
    const requester = [
      record.requesterName,
      record.requesterCode ? `（${record.requesterCode}）` : ''
    ].join('').trim();
    const sourceCode = String(
      record.sourceCode || record.reimbursementCode || record.sourceId || '未知单据'
    ).trim();
    const code = String(error.code || 'REQUEST_FAILED').trim();
    const codeLabel = localizedFailureCode(code);
    const message = normalizedFailureMessage(error.message || code);
    const identity = requester ? `${requester}｜${sourceCode}` : sourceCode;
    return `${index + 1}. ${identity}｜${codeLabel}：${message}`;
  }).join('\n');
}

function normalizedFailureMessage(value) {
  const lines = String(value || '未知错误')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const message = [...new Set(lines)].join('；') || '未知错误';
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return '无法连接本地后台服务，当前单据尚未确认保存。';
  }
  if (/operation not permitted,\s*rename/i.test(message)) {
    return '本地状态文件被其他程序短暂占用，ERP中的单据可能已经保存；程序会自动重试写入确认状态。';
  }
  return message
    .replace(
      /^Kingdee expense reimbursement save failed:\s*/i,
      '金蝶费用报销单保存失败：'
    )
    .replace(/^process record is missing for /i, '未找到本地处理记录：');
}

function localizedFailureCode(code) {
  return {
    LOCAL_BACKEND_UNREACHABLE: '本地后台连接中断',
    LOCAL_BACKEND_INVALID_RESPONSE: '本地后台返回异常',
    ERP_SAVE_NOT_CONFIRMED: 'ERP保存结果未确认',
    KINGDEE_NETWORK_FAILED: '金蝶网络连接失败',
    KINGDEE_SAVE_FAILED: '金蝶保存失败',
    KINGDEE_EMPLOYEE_MAPPING_MISSING: '金蝶员工资料未建档',
    KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE: '申请日期早于费用管理启用日期',
    EPERM: '本地状态文件被占用',
    EBUSY: '本地状态文件被占用',
    EACCES: '本地状态文件访问受限',
    REQUEST_FAILED: '请求失败'
  }[code] || code;
}

export function isMissingKingdeeEmployee(error) {
  return error?.code === 'KINGDEE_EMPLOYEE_MAPPING_MISSING';
}

export function isSkippableKingdeeBusinessRule(error) {
  if ([
    'KINGDEE_EMPLOYEE_MAPPING_MISSING',
    'KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE'
  ].includes(error?.code)) return true;
  return false;
}

export function isConfirmedErpSave(record) {
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

export function expenseReimbursementSelectionKey(record) {
  if (
    record?.sourceType === 'OFFLINE_REIMBURSEMENT'
    && (record.localCsvImport || record.sourceMode === 'local-csv')
  ) {
    const billNumber = String(record.sourceCode || record.sourceId || '').trim();
    return `OFFLINE-BILL:${record.tenantKey || 'local-csv'}:${billNumber}`;
  }
  if (record?.sourceType !== 'ONLINE_MONTHLY_BILL') {
    return `SOURCE:${record?.sourceId || ''}`;
  }
  const requester = String(record.requesterCode || record.requesterName || '').trim();
  const billNumber = String(record.sourceCode || record.sourceId || '').trim();
  return `ONLINE-BILL:${record.tenantKey || 'puhui'}:${requester}:${billNumber}`;
}
