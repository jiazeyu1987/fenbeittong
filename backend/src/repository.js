const records = new Map();
let config = null;

export function saveConfig(nextConfig) {
  config = structuredClone(nextConfig);
  return getConfig();
}

export function getConfig() {
  return config ? structuredClone(config) : null;
}

export function savePreparedRecord(preview) {
  const record = {
    sourceSystem: 'FENBEITONG',
    sourceType: 'REIMBURSEMENT',
    sourceId: preview.sourceId,
    sourceCode: preview.sourceCode,
    idempotencyKey: preview.idempotencyKey,
    contentHash: preview.contentHash,
    processStatus: 15,
    processStage: 'PREPARED',
    marker: preview.marker,
    erpDocumentStatus: 'Z',
    voucherPayload: JSON.stringify(preview.payload),
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString()
  };
  records.set(record.sourceId, record);
  return structuredClone(record);
}

export function findPreparedRecord(sourceId) {
  const record = records.get(sourceId);
  return record ? structuredClone(record) : null;
}

export function resetRepository() {
  records.clear();
  config = null;
}
