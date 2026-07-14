import { pullFenbeitongReimbursements } from '../adapters/fenbeitong-client.js';
import { saveKingdeeVoucher } from '../adapters/kingdee-client.js';
import { getAppConfig } from '../config.js';
import { buildVoucherPreview } from '../voucher-mapper.js';
import {
  createSyncBatch,
  findSyncedDocument,
  finishSyncBatch,
  recordOperation,
  savePreparedRecord,
  saveSyncedDocument,
  markPushedToErp
} from '../repository.js';

export async function syncFenbeitongDocuments(options = {}) {
  const batch = createSyncBatch({
    sourceMode: getAppConfig().fenbeitong.mode,
    tenantKey: options.tenantKey || getAppConfig().fenbeitong.defaultTenantKey
  });
  try {
    const result = await pullFenbeitongReimbursements({ tenantKey: options.tenantKey });
    const records = result.documents.map((document) => saveSyncedDocument(document, batch.batchId, {
      sourceMode: result.mode,
      mockReplacement: result.mockReplacement,
      mockReason: result.mockReason,
      tenantKey: result.tenantKey
    }));
    const finishedBatch = finishSyncBatch(batch.batchId, {
      status: 'SUCCESS',
      sourceMode: result.mode,
      mockReplacement: result.mockReplacement,
      mockReason: result.mockReason,
      tenantKey: result.tenantKey,
      totalCount: result.documents.length,
      successCount: records.length,
      failCount: 0,
      message: ''
    });
    return { batch: finishedBatch, records };
  } catch (error) {
    finishSyncBatch(batch.batchId, {
      status: 'FAILED',
      totalCount: 0,
      successCount: 0,
      failCount: 1,
      message: error.message
    });
    recordOperation('SYNC_ERROR', 'FAILED', { batchId: batch.batchId, message: error.message });
    throw error;
  }
}

export function previewVoucher(input) {
  return buildVoucherPreview(resolveVoucherInput(input));
}

export function prepareVoucher(input) {
  const preview = previewVoucher(input);
  return savePreparedRecord(preview);
}

export async function pushVoucherToErp(input) {
  const sourceId = requiredText(input.sourceId, 'sourceId');
  const preview = previewVoucher(input);
  savePreparedRecord(preview);
  const erpResult = await saveKingdeeVoucher(preview.payload);
  return markPushedToErp(sourceId, erpResult);
}

function resolveVoucherInput(input) {
  if (input.fixedJson) {
    return input;
  }
  const sourceId = requiredText(input.sourceId, 'sourceId');
  const synced = findSyncedDocument(sourceId);
  if (!synced) {
    throw new Error(`synced Fenbeitong document is missing for ${sourceId}`);
  }
  return {
    ...input,
    fixedJson: synced.fixedJson
  };
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}
