export async function runBatchOperation(items, operation) {
  const successes = [];
  const failures = [];
  for (const item of items) {
    try {
      successes.push(await operation(item));
    } catch (error) {
      failures.push({ item, error });
    }
  }
  return { successes, failures };
}

export function isMissingKingdeeEmployee(error) {
  return error?.code === 'KINGDEE_EMPLOYEE_MAPPING_MISSING';
}

export function expenseReimbursementSelectionKey(record) {
  if (record?.sourceType !== 'ONLINE_MONTHLY_BILL') {
    return `SOURCE:${record?.sourceId || ''}`;
  }
  const month = normalizedMonth(
    record.settlementMonth
    || record.paymentDate
    || record.applicationDate
  );
  const requester = String(record.requesterCode || record.requesterName || '').trim();
  return `ONLINE-MONTH:${record.tenantKey || 'puhui'}:${requester}:${month}`;
}

function normalizedMonth(value) {
  const match = /^(20\d{2})[-/]?(0[1-9]|1[0-2])/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2]}` : '';
}
