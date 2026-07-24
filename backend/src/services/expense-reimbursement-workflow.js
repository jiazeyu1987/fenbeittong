import { pullFenbeitongReimbursements } from '../adapters/fenbeitong-client.js';
import {
  findKingdeeEmployeeNumberByName,
  saveKingdeeExpenseReimbursement
} from '../adapters/kingdee-client.js';
import { getAppConfig } from '../config.js';
import { buildExpenseReimbursementPreview } from '../expense-reimbursement-mapper.js';
import { parseFenbeitongDetail } from '../fenbeitong-detail.js';
import {
  createSyncBatch,
  discardPreparedRecord,
  findPreparedRecord,
  findSyncedDocument,
  finishSyncBatch,
  getIntegrationSelection,
  isRealPushedRecord,
  saveFenbeitongRequesterCatalog,
  listSyncedDocuments,
  recordOperation,
  restoreErpPushAfterRetryFailure,
  savePreparedRecord,
  saveSyncedDocuments,
  markPushedToErp
} from '../repository.js';

const REQUIRED_KINGDEE_ACCOUNT_KEY = 'current';

export async function syncFenbeitongDocuments(options = {}) {
  const tenantKey = options.tenantKey || getIntegrationSelection().tenantKey;
  const batch = createSyncBatch({
    sourceMode: getAppConfig().fenbeitong.mode,
    tenantKey
  });
  try {
    const result = await pullFenbeitongReimbursements({ tenantKey });
    const records = saveSyncedDocuments(result.documents, batch.batchId, {
      sourceMode: result.mode,
      mockReplacement: result.mockReplacement,
      mockReason: result.mockReason,
      tenantKey: result.tenantKey
    });
    const requesters = saveFenbeitongRequesterCatalog(result.requesters, result.tenantKey);
    const finishedBatch = finishSyncBatch(batch.batchId, {
      status: 'SUCCESS',
      sourceMode: result.mode,
      mockReplacement: result.mockReplacement,
      mockReason: result.mockReason,
      tenantKey: result.tenantKey,
      totalCount: result.documents.length,
      successCount: records.length,
      failCount: 0,
      message: (result.sourceWarnings || []).join('；')
    });
    return { batch: finishedBatch, records, requesters };
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

export async function previewExpenseReimbursement(input) {
  return buildPreviewWithResolvedEmployee(resolveInput(input));
}

export async function prepareExpenseReimbursement(input) {
  return savePreparedRecord(await previewExpenseReimbursement(input));
}

export async function saveExpenseReimbursementToErp(input) {
  const sourceId = requiredText(input.sourceId, 'sourceId');
  const requestedAccountKey = input.kingdeeAccountKey || REQUIRED_KINGDEE_ACCOUNT_KEY;
  if (requestedAccountKey !== REQUIRED_KINGDEE_ACCOUNT_KEY) {
    throw new Error('Kingdee expense reimbursement integration is restricted to int');
  }
  const resolvedInput = resolveInput(input);
  const preview = await buildPreviewWithResolvedEmployee(resolvedInput);
  const associatedRecords = [...new Map((preview.sourceIds || [sourceId])
    .map((item) => findPreparedRecord(item))
    .filter(Boolean)
    .map((record) => [record.sourceId, record])).values()];
  const savedRecords = associatedRecords.filter(isRealPushedRecord);
  if (savedRecords.length > 1) {
    throw new Error(`同一员工同月已有 ${savedRecords.length} 张逐单费用报销单，已停止合并以避免重复；请先在金蝶中处理旧暂存单。`);
  }
  const existingRecord = savedRecords[0] || findPreparedRecord(preview.sourceId) || findPreparedRecord(sourceId);
  const migratingExistingBill = Boolean(
    isRealPushedRecord(existingRecord) && existingRecord.sourceId !== preview.sourceId
  );
  const forceRetry = Boolean(
    isRealPushedRecord(existingRecord) && (input.forceRetry || migratingExistingBill)
  );
  if (isRealPushedRecord(existingRecord) && !forceRetry) {
    const replay = replaySavedExpenseReimbursement(existingRecord, preview);
    if (replay) return replay;
    throw new Error(
      `费用报销单 ${preview.sourceId} 已保存到 ERP，但当前内容已经变化；请使用“重新保存费用报销单”更新原单，系统不会重复新建。`
    );
  }
  try {
    if (forceRetry) targetExistingExpenseReimbursement(preview.payload, existingRecord);
    savePreparedRecord(preview, {
      forceRetry,
      previousRecord: migratingExistingBill ? existingRecord : undefined
    });
    const erpResult = await saveKingdeeExpenseReimbursement(preview.payload, {
      accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
      acctIdKey: input.kingdeeAcctIdKey
    });
    return markPushedToErp(preview.sourceId, erpResult, {
      replacesSourceId: migratingExistingBill ? existingRecord.sourceId : ''
    });
  } catch (error) {
    if (migratingExistingBill) {
      discardPreparedRecord(preview.sourceId);
    } else if (forceRetry) {
      restoreErpPushAfterRetryFailure(preview.sourceId, existingRecord, error);
    }
    throw error;
  }
}

function targetExistingExpenseReimbursement(payload, existingRecord) {
  const erpFid = Number(existingRecord?.erpFid);
  if (!Number.isSafeInteger(erpFid) || erpFid <= 0) {
    throw new Error('existing Kingdee expense reimbursement FID is invalid; retry update was stopped to avoid creating a duplicate');
  }
  if (!payload?.Model || typeof payload.Model !== 'object') {
    throw new Error('Kingdee expense reimbursement payload Model is missing');
  }
  payload.Model.FID = erpFid;
  const erpNumber = String(existingRecord?.erpNumber || '').trim();
  if (erpNumber) payload.Model.FBillNo = erpNumber;
}

export function targetExistingExpenseReimbursementForTest(payload, existingRecord) {
  targetExistingExpenseReimbursement(payload, existingRecord);
  return payload;
}

function replaySavedExpenseReimbursement(existingRecord, preview) {
  if (!isRealPushedRecord(existingRecord)) return null;
  if (existingRecord.contentHash !== preview.contentHash) return null;
  const existingSourceIds = normalizedSourceIds(existingRecord);
  const previewSourceIds = normalizedSourceIds(preview);
  if (
    existingSourceIds.length !== previewSourceIds.length
    || existingSourceIds.some((value, index) => value !== previewSourceIds[index])
  ) return null;
  return {
    ...structuredClone(existingRecord),
    idempotentReplay: true
  };
}

function normalizedSourceIds(value) {
  return [...new Set(
    (Array.isArray(value?.sourceIds) && value.sourceIds.length > 0
      ? value.sourceIds
      : [value?.sourceId])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )].sort();
}

export function replaySavedExpenseReimbursementForTest(existingRecord, preview) {
  return replaySavedExpenseReimbursement(existingRecord, preview);
}

function resolveInput(input) {
  const sourceId = String(input.sourceId || '').trim();
  const synced = sourceId ? findSyncedDocument(sourceId) : null;
  if (synced?.sourceType === 'ONLINE_MONTHLY_BILL') {
    return buildOnlineMonthlyGroupInput(input, synced);
  }
  if (input.fixedJson) {
    assertVerifiedOnlineSettlement(input.fixedJson);
    return input;
  }
  if (!sourceId) requiredText(input.sourceId, 'sourceId');
  if (!synced) throw new Error(`synced Fenbeitong document is missing for ${sourceId}`);
  return { ...input, fixedJson: synced.fixedJson };
}

function buildOnlineMonthlyGroupInput(input, selected) {
  const month = sourceMonthKey(selected.settlementMonth);
  const requesterKey = String(selected.requesterCode || selected.requesterName || '').trim();
  if (!month || !requesterKey) return { ...input, fixedJson: selected.fixedJson };
  const tenantKey = selected.tenantKey || getIntegrationSelection().tenantKey || 'puhui';
  const syncedDocuments = listSyncedDocuments();
  const records = syncedDocuments
    .filter((record) => record.sourceType === 'ONLINE_MONTHLY_BILL')
    .filter((record) => (record.tenantKey || 'puhui') === tenantKey)
    .filter((record) => sourceMonthKey(record.settlementMonth) === month)
    .filter((record) => sameRequester(record, selected))
    .sort((left, right) => {
      const byDate = String(left.paymentDate || '').localeCompare(String(right.paymentDate || ''));
      return byDate || String(left.sourceId).localeCompare(String(right.sourceId));
    });
  if (records.length === 0) return { ...input, fixedJson: selected.fixedJson };

  const compactMonth = month.replace('-', '');
  const groupId = `ONLINE-MONTH:${tenantKey}:${requesterKey}:${compactMonth}`;
  const applicationPurposes = buildApplicationPurposeIndex(syncedDocuments, tenantKey);
  const orders = records.map((record) => sourceOnlineOrder(record, applicationPurposes));
  const groupBillNo = requiredOriginalBillNumber(orders);
  const latestDate = records.map((record) => record.paymentDate || record.applicationDate)
    .filter(Boolean).sort().at(-1);
  const billDate = onlineBillPostingDate(records);
  return {
    ...input,
    sourceId: groupId,
    sourceIds: records.map((record) => record.sourceId),
    documentDate: billDate || latestDate || input.documentDate,
    fixedJson: JSON.stringify({
      code: 0,
      msg: 'success',
      data: {
        source_kind: 'ONLINE_MONTHLY_BILL',
        group_id: groupId,
        group_bill_no: groupBillNo,
        bill_no: groupBillNo,
        bill_date: billDate,
        settlement_month: month,
        orders
      }
    })
  };
}

function requiredOriginalBillNumber(orders) {
  const billNumbers = [...new Set(orders
    .map((order) => String(order?.bill_no || '').trim())
    .filter(Boolean))];
  if (billNumbers.length === 0) {
    throw new Error('Fenbeitong online orders do not contain an original bill number');
  }
  if (billNumbers.length > 1) {
    throw new Error(`Fenbeitong online orders belong to multiple original bills: ${billNumbers.join(', ')}`);
  }
  return billNumbers[0];
}

export function requiredOriginalBillNumberForTest(orders) {
  return requiredOriginalBillNumber(orders);
}

function onlineBillPostingDate(records) {
  const dates = new Set();
  for (const record of records) {
    let data;
    try {
      data = JSON.parse(record.fixedJson || '{}')?.data || {};
    } catch {
      continue;
    }
    const explicitDate = normalizedDate(
      data.bill_date
      || data.billing_date
      || data.account_date
      || data.bookkeeping_date
    );
    const postingDate = explicitDate || dayAfterBillCycle(data.bill_cycle);
    if (postingDate) dates.add(postingDate);
  }
  if (dates.size > 1) {
    throw new Error(`Fenbeitong online monthly group contains multiple bill dates: ${[...dates].join(', ')}`);
  }
  return [...dates][0] || '';
}

function dayAfterBillCycle(value) {
  const matches = [...String(value || '').matchAll(/(20\d{2})[/-](\d{2})[/-](\d{2})/g)];
  const end = matches.at(-1);
  if (!end) return '';
  const date = new Date(Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3])));
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizedDate(value) {
  const match = /^(20\d{2})[-/](\d{2})[-/](\d{2})/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function onlineBillPostingDateForTest(records) {
  return onlineBillPostingDate(records);
}

function assertVerifiedOnlineSettlement(fixedJson) {
  let data;
  try {
    data = JSON.parse(fixedJson)?.data;
  } catch {
    return;
  }
  if (data?.source_kind !== 'ONLINE_MONTHLY_BILL') return;
  if (
    data.source_origin !== 'SETTLEMENT_POSTING'
    || !['BUSINESS_BILL_LIST_AND_DETAIL', 'SETTLEMENT_BILL_DETAIL_V2'].includes(data.source_contract)
    || !data.settlement_month
  ) {
    throw new Error('线上数据不是来自分贝通“结算入账”的已核实企业账单，已禁止生成或保存到 ERP');
  }
}

function sourceOnlineOrder(record, applicationPurposes = new Map()) {
  let root;
  try {
    root = JSON.parse(record.fixedJson || '{}');
  } catch {
    throw new Error(`线上订单来源数据不是有效 JSON：${record.sourceId}`);
  }
  const data = root.data || {};
  const order = data.order && typeof data.order === 'object' ? data.order : data;
  const purpose = resolveOnlineOrderPurpose(order, applicationPurposes);
  return {
    ...order,
    purpose,
    source_detail_id: order.source_detail_id || order.ticket_id || record.sourceId,
    bill_no: order.bill_no || data.bill_no || record.sourceCode
  };
}

function buildApplicationPurposeIndex(records, tenantKey = '') {
  const index = new Map();
  for (const record of records) {
    if (record.sourceType === 'ONLINE_MONTHLY_BILL') continue;
    if (tenantKey && (record.tenantKey || 'puhui') !== tenantKey) continue;
    if (!String(record.fixedJson || '').includes('apply_reason')) continue;
    let root;
    try {
      root = JSON.parse(record.fixedJson);
    } catch {
      continue;
    }
    collectApplicationPurposes(root, index);
  }
  return index;
}

function collectApplicationPurposes(value, index) {
  if (!value || typeof value !== 'object') return;
  const purpose = String(value.apply_reason || '').trim();
  if (purpose) {
    for (const applicationId of [value.meaning_no, value.bill_no, value.apply_id]) {
      const key = String(applicationId || '').trim();
      if (key) index.set(key, purpose);
    }
  }
  for (const child of Object.values(value)) collectApplicationPurposes(child, index);
}

function resolveOnlineOrderPurpose(order, applicationPurposes) {
  const explicitPurpose = [
    order.purpose,
    order.travel_approval_reason,
    order.travel_apply_reason,
    order.trip_approval_reason,
    order.journey_approval_reason,
    order.business_purpose
  ].map((value) => String(value || '').trim()).find(Boolean);
  if (explicitPurpose) return explicitPurpose;

  const saasEntries = Array.isArray(order.saas) ? order.saas : [order.saas];
  for (const entry of saasEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const embeddedPurpose = String(entry.apply_reason || '').trim();
    if (embeddedPurpose) return embeddedPurpose;
    const applicationId = String(entry.apply_id || '').trim();
    if (applicationId && applicationPurposes.has(applicationId)) {
      return applicationPurposes.get(applicationId);
    }
  }
  return '';
}

export function resolveOnlineOrderPurposeForTest(order, records) {
  return resolveOnlineOrderPurpose(order, buildApplicationPurposeIndex(records));
}

function sameRequester(left, right) {
  const leftCode = String(left.requesterCode || '').trim();
  const rightCode = String(right.requesterCode || '').trim();
  if (leftCode && rightCode) return leftCode === rightCode;
  return String(left.requesterName || '').trim() === String(right.requesterName || '').trim();
}

function sourceMonthKey(value) {
  const matched = /^(\d{4})-(\d{2})/.exec(String(value || '').trim());
  return matched ? `${matched[1]}-${matched[2]}` : '';
}

export function resolveExpenseReimbursementInputForTest(input) {
  return resolveInput(input);
}

async function buildPreviewWithResolvedEmployee(input) {
  try {
    return buildExpenseReimbursementPreview(input);
  } catch (error) {
    if (error.code !== 'KINGDEE_EMPLOYEE_MAPPING_MISSING') throw error;
    const document = parseFenbeitongDetail(input.fixedJson);
    const employeeNumber = await findKingdeeEmployeeNumberByName(document.userName, {
      accountKey: input.kingdeeAccountKey,
      acctIdKey: input.kingdeeAcctIdKey,
      orgNumber: input.config?.expenseReimbursementOrgNumber || '886'
    });
    if (!employeeNumber) throw error;
    return buildExpenseReimbursementPreview({
      ...input,
      config: {
        ...(input.config || {}),
        employeeDetailNumberMappings: {
          ...(input.config?.employeeDetailNumberMappings || {}),
          [document.userCode]: employeeNumber,
          [document.userName]: employeeNumber
        }
      }
    });
  }
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
