const INTERNAL_PROCESS_RECORD_FIELDS = new Set([
  'expenseReimbursementPayload',
  'erpRawResponse',
  'previousErpPushes'
]);

export function processRecordResponse(record) {
  if (!record || typeof record !== 'object') return record;

  const response = {};
  for (const [key, value] of Object.entries(record)) {
    if (!INTERNAL_PROCESS_RECORD_FIELDS.has(key)) {
      response[key] = value;
    }
  }
  response.previousErpPushCount = Array.isArray(record.previousErpPushes)
    ? record.previousErpPushes.length
    : 0;
  return response;
}

export function processRecordListResponse(records) {
  return records.map(processRecordResponse);
}
