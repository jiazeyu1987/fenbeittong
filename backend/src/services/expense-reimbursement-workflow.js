import { pullFenbeitongReimbursements } from '../adapters/fenbeitong-client.js';
import {
  deleteKingdeeExpenseReimbursement,
  findKingdeeEmployeeNumberByName,
  findKingdeeOtherContactUnitByName,
  getKingdeeEmployeeBankDetails,
  saveKingdeeExpenseReimbursement,
  validateExpensePaymentBankFields,
  viewKingdeeExpenseReimbursement,
  updateKingdeeExpenseReimbursementContactUnit,
  updateKingdeeExpenseReimbursementSourceType
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
  getKingdeeAcctIdSelection,
  isRealPushedRecord,
  saveFenbeitongRequesterCatalog,
  listSyncedDocuments,
  recordOperation,
  restoreErpPushAfterRetryFailure,
  preservePaymentBankVerificationFailure,
  savePreparedRecord,
  saveSyncedDocuments,
  markPushedToErp
} from '../repository.js';

const REQUIRED_KINGDEE_ACCOUNT_KEY = 'current';
const ONLINE_CONTACT_UNIT_NAME = '北京分贝通科技有限公司';
const erpSaveInFlight = new Map();

export async function syncFenbeitongDocuments(options = {}) {
  const tenantKey = options.tenantKey || getIntegrationSelection().tenantKey;
  const batch = createSyncBatch({
    sourceMode: getAppConfig().fenbeitong.mode,
    tenantKey
  });
  try {
    const result = await pullFenbeitongReimbursements({ tenantKey });
    const employeeBankDetailsByRequester = await loadEmployeeBankDetailsForDocuments(result.documents);
    const records = saveSyncedDocuments(result.documents, batch.batchId, {
      sourceMode: result.mode,
      mockReplacement: result.mockReplacement,
      mockReason: result.mockReason,
      tenantKey: result.tenantKey,
      employeeBankDetailsByRequester
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

export function saveExpenseReimbursementToErp(input) {
  const lockKey = requiredText(input.sourceId, 'sourceId');
  const running = erpSaveInFlight.get(lockKey);
  if (running) return running;
  const task = saveExpenseReimbursementToErpUnlocked(input).finally(() => {
    if (erpSaveInFlight.get(lockKey) === task) {
      erpSaveInFlight.delete(lockKey);
    }
  });
  erpSaveInFlight.set(lockKey, task);
  return task;
}

async function loadEmployeeBankDetailsForDocuments(documents) {
  if (getAppConfig().kingdee.mode !== 'real') return {};
  const requesters = new Map();
  for (const source of Array.isArray(documents) ? documents : []) {
    try {
      const document = parseFenbeitongDetail(
        typeof source === 'string' ? source : JSON.stringify(source)
      );
      const key = String(document.userCode || document.userName || '').trim();
      if (key && !requesters.has(key)) requesters.set(key, document);
    } catch {
      // Keep source synchronization available when one malformed document
      // cannot contribute to the employee-bank catalog.
    }
  }
  const output = {};
  const entries = [...requesters.values()];
  for (let index = 0; index < entries.length; index += 5) {
    await Promise.all(entries.slice(index, index + 5).map(async (document) => {
      try {
        const employeeNumber = await findKingdeeEmployeeNumberByName(document.userName, {
          orgNumber: '886'
        });
        if (!employeeNumber) return;
        const details = await getKingdeeEmployeeBankDetails(employeeNumber, {
          orgNumber: '886'
        });
        const value = {
          ...details,
          employeeNumber
        };
        if (document.userCode) output[document.userCode] = value;
        if (document.userName) output[document.userName] = value;
      } catch {
        // Bank details improve the interface and save payload but must not
        // prevent the core Fenbeitong source synchronization from completing.
      }
    }));
  }
  return output;
}

async function saveExpenseReimbursementToErpUnlocked(input) {
  const sourceId = requiredText(input.sourceId, 'sourceId');
  const requestedAccountKey = input.kingdeeAccountKey || REQUIRED_KINGDEE_ACCOUNT_KEY;
  if (requestedAccountKey !== REQUIRED_KINGDEE_ACCOUNT_KEY) {
    throw new Error('Kingdee expense reimbursement integration is restricted to int');
  }
  const resolvedInput = resolveInput(input);
  const preview = await buildPreviewWithResolvedEmployee(resolvedInput);
  const kingdeeAcctIdKey = input.kingdeeAcctIdKey || getKingdeeAcctIdSelection();
  const associatedRecords = [...new Map((preview.sourceIds || [sourceId])
    .map((item) => findPreparedRecord(item))
    .filter(Boolean)
    .map((record) => [record.sourceId, record])).values()];
  const savedRecords = associatedRecords.filter((record) =>
    isRealPushedRecord(record) && record.kingdeeAcctIdKey === kingdeeAcctIdKey);
  if (savedRecords.length > 1) {
    throw new Error(`当前来源单据组已有 ${savedRecords.length} 张逐单费用报销单，已停止合并以避免重复；请先在金蝶中处理旧暂存单。`);
  }
  const candidateRecord = savedRecords[0]
    || findPreparedRecord(preview.sourceId)
    || findPreparedRecord(sourceId);
  const existingRecord = candidateRecord?.kingdeeAcctIdKey === kingdeeAcctIdKey
    ? candidateRecord
    : null;
  const migratingExistingBill = Boolean(
    isRealPushedRecord(existingRecord) && existingRecord.sourceId !== preview.sourceId
  );
  const pendingBankVerification = existingRecord?.lastErpRetryErrorCode === 'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH'
    && Boolean(existingRecord.erpFid && existingRecord.erpNumber);
  const forceRetry = Boolean(pendingBankVerification || (
    isRealPushedRecord(existingRecord) && (input.forceRetry || migratingExistingBill)
  ));
  if (isRealPushedRecord(existingRecord) && !forceRetry) {
    const replay = replaySavedExpenseReimbursement(existingRecord, preview);
    if (replay) {
      if (String(preview.payload?.Model?.FRequestType) === '1') {
        const view = await viewKingdeeExpenseReimbursement(existingRecord.erpFid, {
          accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
          acctIdKey: kingdeeAcctIdKey,
          orgNumber: preview.documentSummary?.orgNumber || '886'
        });
        validateExpensePaymentBankFields(preview.payload, view);
      }
      // A historical document may already be marked as saved locally even
      // though the source-type field was introduced later.  Do not let the
      // idempotent fast path bypass that required ERP field: fill it only when
      // ERP is blank, then read it back in the adapter before reporting saved.
      await updateKingdeeExpenseReimbursementSourceType(
        existingRecord.erpFid,
        preview.payload?.Model?.F_ora_Text_qtr,
        {
          accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
          acctIdKey: kingdeeAcctIdKey
        }
      );
      if (
        preview.sourceKind === 'ONLINE_MONTHLY_BILL'
        && getAppConfig().kingdee.mode === 'real'
      ) {
        await updateKingdeeExpenseReimbursementContactUnit(
          existingRecord.erpFid,
          {
            type: preview.documentSummary?.contactUnitType,
            number: preview.documentSummary?.contactUnitNumber,
            name: preview.documentSummary?.contactUnitName
          },
          {
            accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
            acctIdKey: kingdeeAcctIdKey,
            orgNumber: preview.documentSummary?.orgNumber || '886'
          }
        );
      }
      return replay;
    }
    throw new Error(
      `费用报销单 ${preview.sourceId} 已保存到 ERP，但当前内容已经变化；请使用“重新保存费用报销单”更新原单，系统不会重复新建。`
    );
  }
  try {
    const replaceOnlineDraft = shouldReplaceOnlineDraft(
      forceRetry,
      preview,
      existingRecord
    );
    if (forceRetry && !replaceOnlineDraft) {
      targetExistingExpenseReimbursement(preview.payload, existingRecord);
    }
    savePreparedRecord(preview, {
      forceRetry,
      kingdeeAcctIdKey,
      previousRecord: migratingExistingBill ? existingRecord : undefined
    });
    const erpResult = await saveKingdeeExpenseReimbursement(preview.payload, {
      accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
      acctIdKey: input.kingdeeAcctIdKey,
      // A previous ERP save can succeed before the local process record is
      // persisted (for example, when the local state file is temporarily
      // locked).  In that orphaned-state case there is no existingRecord, but
      // an explicit retry must still be allowed to update the same bill number
      // instead of leaving the UI permanently out of sync with Kingdee.
      allowExistingBillOverwrite: forceRetry || Boolean(input.forceRetry)
    });
    if (replaceOnlineDraft) {
      try {
        await deleteKingdeeExpenseReimbursement(existingRecord.erpFid, {
          accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
          acctIdKey: input.kingdeeAcctIdKey
        });
      } catch (error) {
        if (isAlreadyDeletedKingdeeDraft(error)) {
          return markPushedToErp(preview.sourceId, erpResult, {
            kingdeeAcctIdKey,
            replacesSourceId: migratingExistingBill ? existingRecord.sourceId : ''
          });
        }
        await deleteKingdeeExpenseReimbursement(erpResult.erpFid, {
          accountKey: REQUIRED_KINGDEE_ACCOUNT_KEY,
          acctIdKey: input.kingdeeAcctIdKey
        }).catch(() => {});
        throw error;
      }
    }
    return markPushedToErp(preview.sourceId, erpResult, {
      kingdeeAcctIdKey,
      replacesSourceId: migratingExistingBill ? existingRecord.sourceId : ''
    });
  } catch (error) {
    if (error.code === 'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH' && error.detail?.savedResult) {
      preservePaymentBankVerificationFailure(preview.sourceId, error);
      throw error;
    }
    if (migratingExistingBill) {
      discardPreparedRecord(preview.sourceId);
    } else if (forceRetry && isRealPushedRecord(existingRecord)) {
      restoreErpPushAfterRetryFailure(preview.sourceId, existingRecord, error);
    }
    throw error;
  }
}

function isAlreadyDeletedKingdeeDraft(error) {
  return error?.code === 'KINGDEE_VIEW_FAILED'
    && /不存在|deleted/i.test(String(error.message || ''));
}

export function isAlreadyDeletedKingdeeDraftForTest(error) {
  return isAlreadyDeletedKingdeeDraft(error);
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
  if (isLocalCsvOfflineRecord(synced)) {
    return buildLocalCsvOfflineGroupInput(input, synced, listSyncedDocuments());
  }
  if (synced) {
    return {
      ...input,
      fixedJson: input.fixedJson || synced.fixedJson,
      // The synchronized source number is authoritative.  It must not be
      // replaced by an embedded detail value or a locally generated suffix.
      sourceCodeValue: requiredText(synced.sourceCode, 'synchronized source document number'),
      // Always overwrite a caller-provided/missing value with the exact
      // synchronized Fenbeitong interface label. This applies equally to
      // initial saves, force updates and automatic save recovery.
      sourceTypeValue: synchronizedSourceTypeValue(synced)
    };
  }
  if (input.fixedJson) {
    assertVerifiedOnlineSettlement(input.fixedJson);
    return input;
  }
  if (!sourceId) requiredText(input.sourceId, 'sourceId');
  throw new Error(`synced Fenbeitong document is missing for ${sourceId}`);
}

function buildOnlineMonthlyGroupInput(input, selected) {
  const month = sourceMonthKey(selected.settlementMonth);
  const requesterKey = String(selected.requesterCode || selected.requesterName || '').trim();
  const selectedBillNumber = onlineOriginalBillNumber(selected);
  if (!month || !requesterKey || !selectedBillNumber) {
    return { ...input, fixedJson: selected.fixedJson };
  }
  const tenantKey = selected.tenantKey || getIntegrationSelection().tenantKey || 'puhui';
  const syncedDocuments = listSyncedDocuments();
  const records = syncedDocuments
    .filter((record) => record.sourceType === 'ONLINE_MONTHLY_BILL')
    .filter((record) => (record.tenantKey || 'puhui') === tenantKey)
    .filter((record) => onlineOriginalBillNumber(record) === selectedBillNumber)
    .filter((record) => sameRequester(record, selected))
    .sort((left, right) => {
      const byDate = String(left.paymentDate || '').localeCompare(String(right.paymentDate || ''));
      return byDate || String(left.sourceId).localeCompare(String(right.sourceId));
    });
  if (records.length === 0) return { ...input, fixedJson: selected.fixedJson };

  const applicationPurposes = buildApplicationPurposeIndex(syncedDocuments, tenantKey);
  const orders = records.map((record) => sourceOnlineOrder(record, applicationPurposes));
  const groupBillNo = requiredOriginalBillNumber(orders);
  const groupId = `ONLINE-BILL:${tenantKey}:${requesterKey}:${groupBillNo}`;
  const latestDate = records.map((record) => record.paymentDate || record.applicationDate)
    .filter(Boolean).sort().at(-1);
  const billDate = onlineBillPostingDate(records);
  return {
    ...input,
    sourceId: groupId,
    sourceIds: records.map((record) => record.sourceId),
    sourceCodeValue: groupBillNo,
    sourceTypeValue: synchronizedSourceTypeValue(selected),
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

function synchronizedSourceTypeValue(record) {
  const synchronizedLabel = [record?.sourceKindName, record?.sourceForm]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ');
  if (synchronizedLabel) return synchronizedLabel;
  if (record?.sourceType === 'OFFLINE_REIMBURSEMENT') return '线下报销 · 费用明细';
  if (record?.sourceType === 'ONLINE_MONTHLY_BILL') return '线上月结 · 企业账单';
  return '';
}

export function synchronizedSourceTypeValueForTest(record) {
  return synchronizedSourceTypeValue(record);
}

function requiredOriginalBillNumber(orders) {
  const billNumbers = [...new Set(orders
    .map((order) => String(order?.bill_no || '').trim())
    .filter(Boolean))];
  if (billNumbers.length === 0) {
    throw new Error('分贝通线上订单缺少原始账单编号');
  }
  if (billNumbers.length > 1) {
    throw new Error(`分贝通线上订单错误地混入多个原始账单：${billNumbers.join('、')}`);
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
    const cycleStartDate = firstDayOfBillCycle(data.bill_cycle);
    const explicitDate = normalizedDate(
      data.bill_date
      || data.billing_date
      || data.account_date
      || data.bookkeeping_date
    );
    const postingDate = cycleStartDate
      || explicitDate
      || firstDayOfSettlementMonth(data.settlement_month || data.end_month || data.start_month);
    if (postingDate) dates.add(postingDate);
  }
  if (dates.size > 1) {
    throw new Error(`分贝通线上账单组内存在多个申请日期：${[...dates].join('、')}`);
  }
  return [...dates][0] || '';
}

function firstDayOfBillCycle(value) {
  const matches = [...String(value || '').matchAll(/(20\d{2})[/-](\d{2})[/-](\d{2})/g)];
  const start = matches.at(0);
  if (!start) return '';
  const date = new Date(Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3])));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function onlineOriginalBillNumber(record) {
  const direct = String(record?.sourceCode || '').trim();
  if (direct) return direct;
  try {
    return String(JSON.parse(record?.fixedJson || '{}')?.data?.bill_no || '').trim();
  } catch {
    return '';
  }
}

export function onlineOriginalBillNumberForTest(record) {
  return onlineOriginalBillNumber(record);
}

function shouldReplaceOnlineDraft(forceRetry, preview, existingRecord) {
  const targetBillNumber = String(preview?.payload?.Model?.FBillNo || '').trim();
  const existingBillNumber = String(existingRecord?.erpNumber || '').trim();
  return Boolean(
    forceRetry
    && preview?.sourceKind === 'ONLINE_MONTHLY_BILL'
    && ['A', 'Z'].includes(String(existingRecord?.erpDocumentStatus || ''))
    && targetBillNumber
    && targetBillNumber !== existingBillNumber
  );
}

export function shouldReplaceOnlineDraftForTest(forceRetry, preview, existingRecord) {
  return shouldReplaceOnlineDraft(forceRetry, preview, existingRecord);
}

function firstDayOfSettlementMonth(value) {
  const match = /^(20\d{2})[-/]?(\d{2})/.exec(String(value || '').trim());
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
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

function isLocalCsvOfflineRecord(record) {
  return Boolean(
    record?.sourceType === 'OFFLINE_REIMBURSEMENT'
    && (record.localCsvImport || record.sourceMode === 'local-csv')
  );
}

function buildLocalCsvOfflineGroupInput(input, selected, syncedDocuments) {
  const tenantKey = selected.tenantKey || 'local-csv';
  const sourceCode = requiredText(selected.sourceCode, 'synchronized source document number');
  const records = syncedDocuments
    .filter(isLocalCsvOfflineRecord)
    .filter((record) => (record.tenantKey || 'local-csv') === tenantKey)
    .filter((record) => String(record.sourceCode || '').trim() === sourceCode)
    .sort((left, right) => (
      Number(left.originalCsvRowNumber || 0) - Number(right.originalCsvRowNumber || 0)
      || String(left.sourceId).localeCompare(String(right.sourceId))
    ));
  if (records.length === 0) return { ...input, fixedJson: selected.fixedJson };

  const requesterNames = new Set(records.map((record) => String(record.requesterName || '').trim()).filter(Boolean));
  if (requesterNames.size !== 1) {
    throw new Error(`线下来源单号 ${sourceCode} 对应多个报销人，已停止合并：${[...requesterNames].join('、')}`);
  }
  const sourceData = records.map((record) => {
    try {
      return JSON.parse(record.fixedJson || '{}')?.data;
    } catch {
      throw new Error(`线下来源数据不是有效 JSON：${record.sourceId}`);
    }
  });
  if (sourceData.some((data) => !data || !Array.isArray(data.expenses) || data.expenses.length === 0)) {
    throw new Error(`线下来源单号 ${sourceCode} 存在缺少费用明细的数据，已停止合并`);
  }
  const first = sourceData[0];
  const groupId = `OFFLINE-BILL:${tenantKey}:${sourceCode}`;
  const expenses = sourceData.flatMap((data) => data.expenses);
  const totalAmount = roundMoney(sourceData.reduce((sum, data) => sum + Number(data.total_amount || 0), 0));
  const paymentAmount = roundMoney(sourceData.reduce((sum, data) => sum + Number(data.payment_amount ?? data.total_amount ?? 0), 0));
  return {
    ...input,
    sourceId: groupId,
    sourceIds: records.map((record) => record.sourceId),
    sourceCodeValue: sourceCode,
    sourceTypeValue: synchronizedSourceTypeValue(selected),
    documentDate: selected.applicationDate || input.documentDate,
    fixedJson: JSON.stringify({
      code: 0,
      msg: 'success',
      data: {
        ...first,
        reimb_id: groupId,
        reimb_code: sourceCode,
        reimb_third_id: groupId,
        total_amount: totalAmount,
        payment_amount: paymentAmount,
        expenses
      }
    })
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function buildLocalCsvOfflineGroupInputForTest(input, selected, syncedDocuments) {
  return buildLocalCsvOfflineGroupInput(input, selected, syncedDocuments);
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
  const document = parseFenbeitongDetail(input.fixedJson);
  if (getAppConfig().kingdee.mode === 'real') {
    const orgNumber = input.config?.expenseReimbursementOrgNumber || '886';
    let onlineContactUnit;
    if (document.sourceKind === 'ONLINE_MONTHLY_BILL') {
      const matched = await findKingdeeOtherContactUnitByName(ONLINE_CONTACT_UNIT_NAME, {
        accountKey: input.kingdeeAccountKey,
        acctIdKey: input.kingdeeAcctIdKey,
        orgNumber
      });
      if (!matched || matched.useOrgNumber !== orgNumber) {
        const error = new Error(
          `金蝶组织 ${orgNumber} 尚未分配往来单位“${ONLINE_CONTACT_UNIT_NAME}”，已停止保存，避免写入同编号的错误单位。请管理员分配后重试。`
        );
        error.code = 'KINGDEE_ONLINE_CONTACT_UNIT_NOT_ALLOCATED';
        throw error;
      }
      onlineContactUnit = {
        type: 'FIN_OTHERS',
        number: matched.number,
        name: matched.name
      };
    }
    // Employee numbers are account-set specific. Always resolve the employee
    // from the selected live account set so mappings copied from an older
    // account set cannot silently target the wrong staff record.
    const employeeNumber = await findKingdeeEmployeeNumberByName(document.userName, {
      accountKey: input.kingdeeAccountKey,
      acctIdKey: input.kingdeeAcctIdKey,
      orgNumber: input.config?.expenseReimbursementOrgNumber || '886'
    });
    if (employeeNumber) {
      const employeeBankDetails = await getKingdeeEmployeeBankDetails(employeeNumber, {
        accountKey: input.kingdeeAccountKey,
        acctIdKey: input.kingdeeAcctIdKey,
        orgNumber: input.config?.expenseReimbursementOrgNumber || '886'
      });
      return buildExpenseReimbursementPreview({
        ...input,
        onlineContactUnit,
        employeeBankDetails,
        config: {
          ...(input.config || {}),
          disableRequiredEmployeeNumberMappings: true,
          employeeDetailNumberMappings: {
            ...(input.config?.employeeDetailNumberMappings || {}),
            [document.userCode]: employeeNumber,
            [document.userName]: employeeNumber
          }
        }
      });
    }
    // Remove stale configured values and let the mapper raise the standard
    // missing-employee error used by the batch business-skip workflow.
    const employeeMappings = {
      ...(input.config?.employeeDetailNumberMappings || {})
    };
    delete employeeMappings[document.userCode];
    delete employeeMappings[document.userName];
    return buildExpenseReimbursementPreview({
      ...input,
      onlineContactUnit,
      config: {
        ...(input.config || {}),
        disableRequiredEmployeeNumberMappings: true,
        employeeDetailNumberMappings: employeeMappings
      }
    });
  }

  try {
    return buildExpenseReimbursementPreview(input);
  } catch (error) {
    if (error.code !== 'KINGDEE_EMPLOYEE_MAPPING_MISSING') throw error;
    const employeeNumber = await findKingdeeEmployeeNumberByName(document.userName, {
      accountKey: input.kingdeeAccountKey,
      acctIdKey: input.kingdeeAcctIdKey,
      orgNumber: input.config?.expenseReimbursementOrgNumber || '886'
    });
    if (!employeeNumber) throw error;
    const employeeBankDetails = await getKingdeeEmployeeBankDetails(employeeNumber, {
      accountKey: input.kingdeeAccountKey,
      acctIdKey: input.kingdeeAcctIdKey,
      orgNumber: input.config?.expenseReimbursementOrgNumber || '886'
    });
    return buildExpenseReimbursementPreview({
      ...input,
      employeeBankDetails,
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
