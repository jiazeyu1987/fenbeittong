import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_KINGDEE_ACCT_ID_KEY,
  getAppConfig,
  getRootDir,
  resolveKingdeeAccount,
  resolveKingdeeAcctId,
  sanitizeKingdeeAccount,
  sanitizeKingdeeAcctId
} from './config.js';
import { listFenbeitongTenants } from './tenant-store.js';
import { parseFenbeitongDetail } from './fenbeitong-detail.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
let stateCache = null;
const DEFAULT_INTEGRATION_SELECTION = {
  tenantKey: 'puhui',
  kingdeeAccountKey: 'current',
  kingdeeAcctIdKey: DEFAULT_KINGDEE_ACCT_ID_KEY,
  updatedAt: ''
};
const REQUIRED_KINGDEE_CREATOR_ACCOUNT_KEY = 'current';

export function saveConfig(nextConfig) {
  const state = loadState();
  state.config = structuredClone(nextConfig);
  persistState(state);
  recordOperation('CONFIG_SAVE', 'SUCCESS', { keys: Object.keys(nextConfig || {}) });
  return getConfig();
}

export function getConfig() {
  const state = loadState();
  return state.config ? structuredClone(state.config) : null;
}

export function getKingdeeAccountSelection() {
  return getIntegrationSelection().kingdeeAccountKey;
}

export function saveKingdeeAccountSelection(accountKey) {
  const config = getAppConfig().kingdee;
  const account = resolveKingdeeAccount(config, requiredText(accountKey, 'accountKey'));
  const current = getIntegrationSelection();
  saveIntegrationSelection({
    tenantKey: current.tenantKey,
    kingdeeAccountKey: account.key,
    kingdeeAcctIdKey: current.kingdeeAcctIdKey
  });
  recordOperation('KINGDEE_ACCOUNT_SELECT', 'SUCCESS', {
    accountKey: account.key,
    accountLabel: account.label
  });
  return {
    selectedAccountKey: account.key,
    selectedAccount: sanitizeKingdeeAccount(account),
    accounts: config.accounts.map(sanitizeKingdeeAccount)
  };
}

export function getKingdeeAcctIdSelection() {
  return getIntegrationSelection().kingdeeAcctIdKey;
}

export function getIntegrationSelection() {
  const state = loadState();
  return structuredClone(state.integrationSelection);
}

export function getIntegrationSettings() {
  const config = getAppConfig().kingdee;
  const selection = getIntegrationSelection();
  return {
    selection,
    tenants: listFenbeitongTenants(),
    kingdeeAccounts: config.accounts.map(sanitizeKingdeeAccount),
    kingdeeAcctIds: config.acctIds.map(sanitizeKingdeeAcctId)
  };
}

export function saveIntegrationSelection(input) {
  const nextSelection = validateIntegrationSelection(input);
  const state = loadState();
  const saved = {
    ...nextSelection,
    updatedAt: now()
  };
  state.integrationSelection = saved;
  state.kingdee = {
    ...state.kingdee,
    selectedAccountKey: saved.kingdeeAccountKey,
    selectedAcctIdKey: saved.kingdeeAcctIdKey
  };
  persistState(state);
  recordOperation('INTEGRATION_SELECTION_SAVE', 'SUCCESS', {
    tenantKey: saved.tenantKey,
    kingdeeAccountKey: saved.kingdeeAccountKey,
    kingdeeAcctIdKey: saved.kingdeeAcctIdKey
  });
  return {
    ...getIntegrationSettings(),
    ...saved
  };
}

export function createSyncBatch({ sourceMode, mockReplacement = false, mockReason = '', tenantKey = 'puhui' }) {
  const state = loadState();
  const batch = {
    batchId: nextId('BATCH'),
    sourceSystem: 'FENBEITONG',
    tenantKey,
    sourceMode,
    mockReplacement,
    mockReason,
    status: 'RUNNING',
    totalCount: 0,
    successCount: 0,
    failCount: 0,
    message: '',
    startedAt: now(),
    finishedAt: ''
  };
  state.syncBatches[batch.batchId] = batch;
  persistState(state);
  recordOperation('SYNC_START', 'SUCCESS', { batchId: batch.batchId, tenantKey, sourceMode, mockReplacement, mockReason });
  return structuredClone(batch);
}

export function finishSyncBatch(batchId, patch) {
  const state = loadState();
  const batch = state.syncBatches[batchId];
  if (!batch) {
    throw new Error(`sync batch is missing for ${batchId}`);
  }
  const nextBatch = {
    ...batch,
    ...patch,
    finishedAt: now()
  };
  state.syncBatches[batchId] = nextBatch;
  persistState(state);
  recordOperation('SYNC_FINISH', nextBatch.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED', {
    batchId,
    totalCount: nextBatch.totalCount,
    successCount: nextBatch.successCount,
    failCount: nextBatch.failCount,
    message: nextBatch.message
  });
  return structuredClone(nextBatch);
}

export function savePreparedRecord(preview, options = {}) {
  const state = loadState();
  const stored = state.voucherRecords[preview.sourceId] || {};
  const suppliedPrevious = options.previousRecord?.targetFormId === 'ER_ExpReimbursement'
    ? options.previousRecord
    : null;
  const previous = suppliedPrevious || (stored.targetFormId === 'ER_ExpReimbursement' ? stored : {});
  const forceRetry = Boolean(options.forceRetry && isRealPushedRecord(previous));
  const record = {
    ...previous,
    sourceSystem: 'FENBEITONG',
    sourceType: preview.sourceKind || 'OFFLINE_REIMBURSEMENT',
    sourceId: preview.sourceId,
    sourceIds: Array.isArray(preview.sourceIds) && preview.sourceIds.length > 0
      ? [...new Set(preview.sourceIds)]
      : [preview.sourceId],
    sourceCode: preview.sourceCode,
    idempotencyKey: preview.idempotencyKey,
    contentHash: preview.contentHash,
    processStatus: 15,
    processStage: 'EXPENSE_REIMBURSEMENT_PREPARED',
    targetFormId: 'ER_ExpReimbursement',
    marker: preview.marker,
    erpDocumentStatus: 'Z',
    erpFid: forceRetry ? '' : previous.erpFid,
    erpNumber: forceRetry ? '' : previous.erpNumber,
    erpMode: forceRetry ? '' : previous.erpMode,
    erpRawResponse: forceRetry ? '' : previous.erpRawResponse,
    previousErpPushes: forceRetry
      ? [...(previous.previousErpPushes || []), previousErpPushesEntry(previous)]
      : previous.previousErpPushes,
    expenseReimbursementPayload: JSON.stringify(preview.payload),
    createTime: previous.createTime || now(),
    updateTime: now()
  };
  state.voucherRecords[record.sourceId] = record;
  persistState(state);
  if (forceRetry) {
    recordOperation('ERP_EXPENSE_REIMBURSEMENT_RETRY_PREPARE', 'SUCCESS', {
      sourceId: record.sourceId,
      previousErpFid: previous.erpFid,
      previousErpNumber: previous.erpNumber
    });
  }
  recordOperation('EXPENSE_REIMBURSEMENT_PREPARE', 'SUCCESS', { sourceId: record.sourceId });
  return structuredClone(record);
}

export function saveSyncedDocument(document, batchId = '', options = {}) {
  const state = loadState();
  const record = buildSyncedRecord(state, document, batchId, options);
  persistState(state);
  recordOperation('SOURCE_SYNC', 'SUCCESS', {
    sourceId: record.sourceId,
    batchId,
    sourceMode: record.sourceMode,
    mockReplacement: record.mockReplacement,
    mockReason: record.mockReason
  });
  return structuredClone(record);
}

export function saveSyncedDocuments(documents, batchId = '', options = {}) {
  const state = loadState();
  const records = documents.map((document) => buildSyncedRecord(state, document, batchId, options));
  const removedStaleOnlineCount = pruneStaleOnlineDocuments(state, records, options);
  persistState(state);
  recordOperation('SOURCE_SYNC_BATCH', 'SUCCESS', {
    batchId,
    count: records.length,
    removedStaleOnlineCount,
    sourceMode: options.sourceMode || 'mock',
    mockReplacement: Boolean(options.mockReplacement),
    mockReason: options.mockReason || ''
  });
  return structuredClone(records);
}

function pruneStaleOnlineDocuments(state, incomingRecords, options) {
  if (options.sourceMode !== 'real') return 0;
  const onlineRecords = incomingRecords.filter((record) => record.sourceType === 'ONLINE_MONTHLY_BILL');
  const tenantKey = options.tenantKey || 'puhui';
  const incomingIds = new Set(onlineRecords.map((record) => record.sourceId));
  let removedCount = 0;
  for (const [sourceId, record] of Object.entries(state.syncedDocuments)) {
    if (
      record.sourceMode === 'real'
      && record.tenantKey === tenantKey
      && record.sourceType === 'ONLINE_MONTHLY_BILL'
      && !incomingIds.has(sourceId)
    ) {
      delete state.syncedDocuments[sourceId];
      removedCount += 1;
    }
  }
  return removedCount;
}

function buildSyncedRecord(state, document, batchId, options) {
  const normalized = normalizeSyncedDocument(document);
  const expenseDetails = summarizeExpenseDetails(normalized);
  const sourceId = normalized.reimbursementId;
  const previous = state.syncedDocuments[sourceId] || {};
  const record = {
    ...previous,
    sourceSystem: 'FENBEITONG',
    sourceType: normalized.sourceKind,
    sourceKindName: normalized.sourceKindName,
    sourceHeader: normalized.sourceHeader,
    sourceForm: normalized.sourceForm,
    sourceId,
    sourceCode: normalized.reimbursementCode,
    documentType: normalized.documentType,
    reason: normalized.reason,
    applicationDate: normalized.applicationDate,
    paymentDate: normalized.applicationDate,
    settlementMonth: normalized.settlementMonth || '',
    totalAmount: normalized.totalAmount,
    reimbursementAmount: normalized.totalAmount,
    requestPaymentAmount: normalized.requestPaymentAmount,
    paymentAmount: normalized.paymentAmount,
    splitTaxAmount: normalized.splitTaxAmount,
    splitExcludingTaxAmount: normalized.splitExcludingTaxAmount,
    departmentAttributionAmount: normalized.departmentAttributionAmount,
    requesterName: normalized.userName,
    requesterCode: normalized.userCode,
    departmentName: normalized.departmentName,
    departmentCode: normalized.departmentCode,
    requestOrganizationName: normalized.requestOrganizationName,
    requestOrganizationCode: normalized.requestOrganizationCode,
    expenseOrganizationName: normalized.expenseOrganizationName,
    expenseOrganizationCode: normalized.expenseOrganizationCode,
    sourceDocumentStatus: normalized.sourceDocumentStatus,
    businessLine: normalized.businessLine,
    startLocation: expenseDetails.startLocation,
    arrivalLocation: expenseDetails.arrivalLocation,
    trafficType: expenseDetails.trafficType,
    purpose: expenseDetails.purpose,
    expenseDepartment: expenseDetails.expenseDepartment,
    taxMappingComplete: normalized.taxMappingComplete,
    expenseTypes: normalized.expenseTypes || [...new Set(normalized.expenses.map((expense) => expense.categoryName || expense.categoryCode).filter(Boolean))].join(' / '),
    batchId,
    tenantKey: options.tenantKey || 'puhui',
    sourceMode: options.sourceMode || 'mock',
    mockReplacement: Boolean(options.mockReplacement),
    mockReason: options.mockReason || '',
    processStatus: 10,
    processStage: 'SYNCED',
    fixedJson: JSON.stringify(document),
    createTime: previous.createTime || now(),
    updateTime: now()
  };
  state.syncedDocuments[sourceId] = record;
  return record;
}

function summarizeExpenseDetails(document) {
  const expenses = Array.isArray(document.expenses) ? document.expenses : [];
  return {
    startLocation: joinUnique(expenses.map((expense) => expense.startLocation)),
    arrivalLocation: joinUnique(expenses.map((expense) => expense.arrivalLocation)),
    trafficType: document.sourceKind === 'ONLINE_MONTHLY_BILL'
      ? joinUnique(expenses.map((expense) => expense.trafficType))
      : '',
    purpose: joinUnique(expenses.map((expense) => expense.purpose)),
    expenseDepartment: joinUnique(expenses.map((expense) => (
      expense.attributionDepartmentName || expense.attributionDepartmentCode
    )))
  };
}

function joinUnique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].join(' / ');
}

function normalizeSyncedDocument(document) {
  const data = document?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('synced Fenbeitong document is missing data');
  }
  if (data.source_kind === 'ONLINE_MONTHLY_BILL' || (Array.isArray(data.expenses) && data.expenses.length > 0)) {
    return parseFenbeitongDetail(JSON.stringify(document));
  }
  const legacy = mapFenbeitongSyncFields(data);
  const person = firstObject(data.submitter, data.proposer, data.user);
  return {
    sourceKind: 'OFFLINE_REIMBURSEMENT',
    sourceKindName: '线下报销',
    sourceHeader: '费用报销',
    sourceForm: '费用明细',
    reimbursementId: requiredText(data.reimb_id, 'data.reimb_id'),
    reimbursementCode: legacy.sourceCode,
    documentType: firstText(data.reimburse_type?.name, data.reimburse_type, data.type),
    reason: firstText(data.apply_reason, data.apply_remark),
    applicationDate: dateOnly(firstText(data.submit_time, data.create_time, data.apply_time, data.payment_time)),
    totalAmount: legacy.totalAmount,
    departmentAttributionAmount: legacy.departmentAttributionAmount,
    requestPaymentAmount: legacy.departmentAttributionAmount,
    paymentAmount: numericAmount(data.payment_amount ?? legacy.departmentAttributionAmount),
    splitTaxAmount: legacy.splitTaxAmount,
    splitExcludingTaxAmount: legacy.splitExcludingTaxAmount,
    userName: legacy.requesterName,
    userCode: legacy.requesterCode,
    departmentName: legacy.departmentName,
    departmentCode: legacy.departmentCode,
    requestOrganizationName: firstText(data.company_entity_name, data.company_name),
    requestOrganizationCode: firstText(data.company_entity_code, data.company_code),
    expenseOrganizationName: firstText(data.company_entity_name, data.company_name),
    expenseOrganizationCode: firstText(data.company_entity_code, data.company_code),
    sourceDocumentStatus: firstText(data.apply_state_name, data.apply_state, data.payment_state_name, data.payment_state),
    businessLine: '',
    taxMappingComplete: false,
    expenses: [],
    expenseTypes: legacy.expenseTypes,
    person
  };
}

function mapFenbeitongSyncFields(data) {
  const submitter = firstObject(
    data.submitter,
    data.submit_user,
    data.submitter_user,
    data.proposer,
    data.user
  );
  const expenseTypes = [...new Set((Array.isArray(data.expenses) ? data.expenses : [])
    .map((expense) => firstText(
      expense.cost_category?.name,
      expense.cost_category?.code,
      expense.expense_type?.name,
      expense.expense_type?.code
    ))
    .filter(Boolean))];
  const splitAmounts = fenbeitongSplitAmounts(data);
  const fallbackAmount = numericAmount(data.payment_amount ?? data.total_amount ?? 0);
  const departmentAttributionAmount = splitAmounts.departmentAttributionAmount || fallbackAmount;
  return {
    sourceCode: requiredText(data.reimb_code, 'data.reimb_code'),
    paymentDate: dateOnly(data.payment_time),
    totalAmount: numericAmount(data.total_amount ?? departmentAttributionAmount),
    splitTaxAmount: splitAmounts.splitTaxAmount,
    splitExcludingTaxAmount: splitAmounts.departmentAttributionAmount > 0
      ? splitAmounts.splitExcludingTaxAmount
      : fallbackAmount,
    departmentAttributionAmount,
    requesterName: firstText(
      data.submitter_name,
      data.submit_user_name,
      submitter.name,
      submitter.user_name,
      submitter.employee_name,
      submitter.code
    ),
    requesterCode: firstText(
      data.submitter_code,
      data.submit_user_code,
      submitter.code,
      submitter.user_code,
      submitter.employee_code
    ),
    departmentName: firstText(
      submitter.department_name,
      submitter.department?.name,
      data.department_name
    ),
    departmentCode: firstText(
      submitter.department_code,
      submitter.department?.code,
      data.department_code
    ),
    expenseTypes: expenseTypes.join(' / ')
      || (Array.isArray(data.orders) && data.orders.length > 0 ? '订单费用' : '')
  };
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
}

function firstText(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim());
  return value === undefined ? '' : String(value).trim();
}

function numericAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error('synced Fenbeitong document has invalid department attribution amount');
  }
  return Math.round(amount * 100) / 100;
}

function departmentAttributionTotal(data) {
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  return Math.round(expenses.reduce((total, expense) => {
    const attributed = expenseDepartmentAttributionAmount(expense);
    return total + (attributed ?? numericAmount(expense.total_amount));
  }, 0) * 100) / 100;
}

function fenbeitongSplitAmounts(data) {
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  let splitTaxAmount = 0;
  let departmentAttributionAmount = 0;
  for (const expense of expenses) {
    const departmentAmount = expenseDepartmentAttributionAmount(expense)
      ?? numericAmount(expense.total_amount);
    departmentAttributionAmount += departmentAmount;
    const invoiceTax = (Array.isArray(expense?.invoices) ? expense.invoices : [])
      .reduce((total, invoice) => total + invoiceSplitTaxAmount(invoice), 0);
    splitTaxAmount += Math.min(departmentAmount, Math.max(0, invoiceTax));
  }
  splitTaxAmount = Math.round(splitTaxAmount * 100) / 100;
  departmentAttributionAmount = Math.round(departmentAttributionAmount * 100) / 100;
  return {
    splitTaxAmount,
    splitExcludingTaxAmount: Math.round((departmentAttributionAmount - splitTaxAmount) * 100) / 100,
    departmentAttributionAmount
  };
}

function invoiceSplitTaxAmount(invoice) {
  for (const field of ['current_split_tax_amount', 'split_tax_amount', 'used_tax_amount', 'allocated_tax_amount']) {
    const explicit = Number(invoice?.[field]);
    if (Number.isFinite(explicit)) return Math.round(explicit * 100) / 100;
  }
  const legacyDeductible = Number(invoice?.deductible_tax_amount);
  if (Number.isFinite(legacyDeductible)) return Math.round(legacyDeductible * 100) / 100;
  const tax = Number(invoice?.tax_amount);
  if (!Number.isFinite(tax) || tax <= 0) return 0;
  const total = Number(invoice?.total_amount);
  const used = Number(invoice?.used_amount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0) {
    return Math.round((tax * Math.min(used, total) / total) * 100) / 100;
  }
  return Math.round(tax * 100) / 100;
}

function expenseDepartmentAttributionAmount(expense) {
  let found = false;
  let total = 0;
  for (const attribution of Array.isArray(expense?.cost_attributions) ? expense.cost_attributions : []) {
    if (Number(attribution?.type) !== 1) continue;
    for (const detail of Array.isArray(attribution?.details) ? attribution.details : []) {
      const amount = Number(detail?.amount);
      if (!Number.isFinite(amount)) continue;
      found = true;
      total += amount;
    }
  }
  return found ? Math.round(total * 100) / 100 : null;
}

function dateOnly(value) {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value || '').trim());
  if (!matched) return '';
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

export function findSyncedDocument(sourceId) {
  const state = loadState();
  const record = state.syncedDocuments[sourceId];
  if (!record || !isVisibleSyncedDocument(record)) return null;
  return structuredClone(record);
}

export function listSyncedDocuments() {
  const state = loadState();
  return Object.values(state.syncedDocuments)
    .filter(isVisibleSyncedDocument)
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime))
    .map((record) => structuredClone(record));
}

export function hasFenbeitongPaymentTime(document) {
  return Boolean(dateOnly(document?.data?.payment_time));
}

export function removeUnpaidSyncedDocuments() {
  const state = loadState();
  const removedSourceIds = Object.values(state.syncedDocuments)
    .filter((record) => record.sourceMode === 'real' && !recordHasFenbeitongPaymentTime(record))
    .map((record) => record.sourceId);
  for (const sourceId of removedSourceIds) {
    delete state.syncedDocuments[sourceId];
  }
  if (removedSourceIds.length > 0) {
    persistState(state);
    recordOperation('SOURCE_UNPAID_PRUNE', 'SUCCESS', {
      removedCount: removedSourceIds.length,
      sourceIds: removedSourceIds
    });
  }
  return removedSourceIds.length;
}

function isVisibleSyncedDocument(record) {
  if (getAppConfig().fenbeitong.mode !== 'real') return true;
  if (record.sourceMode !== 'real') return false;
  if (record.sourceType !== 'ONLINE_MONTHLY_BILL') return true;
  return recordHasVerifiedSettlementOrigin(record);
}

function recordHasVerifiedSettlementOrigin(record) {
  try {
    const data = JSON.parse(record.fixedJson || '{}')?.data;
    const billState = Number(data?.bill_state);
    const businessLine = String(data?.order?.business_line_name || record.businessLine || '').trim();
    const settlementMonth = String(data?.settlement_month || '').replace(/[^0-9]/g, '').slice(0, 6);
    const cycleMonth = settlementCycleMonth(data?.bill_cycle);
    return data?.source_origin === 'SETTLEMENT_POSTING'
      && ['BUSINESS_BILL_LIST_AND_DETAIL', 'SETTLEMENT_BILL_DETAIL_V2'].includes(data?.source_contract)
      && [1, 2, 3, 4].includes(billState)
      && Boolean(businessLine)
      && Boolean(cycleMonth)
      && settlementMonth === cycleMonth;
  } catch {
    return false;
  }
}

function settlementCycleMonth(value) {
  const match = /(20\d{2})[-/]?(0[1-9]|1[0-2])/.exec(String(value || ''));
  return match ? `${match[1]}${match[2]}` : '';
}

function recordHasFenbeitongPaymentTime(record) {
  try {
    return hasFenbeitongPaymentTime(JSON.parse(record.fixedJson || '{}'));
  } catch {
    return false;
  }
}

export function findPreparedRecord(sourceId) {
  const state = loadState();
  const record = state.voucherRecords[sourceId] || Object.values(state.voucherRecords)
    .find((item) => Array.isArray(item.sourceIds) && item.sourceIds.includes(sourceId));
  return record?.targetFormId === 'ER_ExpReimbursement' ? structuredClone(record) : null;
}

export function listProcessRecords() {
  const state = loadState();
  return Object.values(state.voucherRecords)
    .filter((record) => record.targetFormId === 'ER_ExpReimbursement')
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime))
    .map((record) => structuredClone(record));
}

export function markPushedToErp(sourceId, erpResult, options = {}) {
  const state = loadState();
  const record = state.voucherRecords[sourceId];
  if (!record) {
    throw new Error(`prepared record is missing for ${sourceId}`);
  }
  if (!isRealKingdeeSaveResult(erpResult)) {
    throw new Error('real Kingdee save result is required before marking ERP push success');
  }
  if (record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED' || record.erpFid || record.erpNumber) {
    if (
      String(record.erpFid) === String(erpResult.erpFid)
      && String(record.erpNumber) === String(erpResult.erpNumber)
    ) {
      return {
        ...structuredClone(record),
        idempotentReplay: true
      };
    }
    throw new Error(`expense reimbursement for ${sourceId} is already saved to ERP`);
  }
  const nextRecord = {
    ...record,
    processStatus: 30,
    processStage: 'ERP_EXPENSE_REIMBURSEMENT_SAVED',
    erpFid: erpResult.erpFid,
    erpNumber: erpResult.erpNumber,
    erpDocumentStatus: erpResult.documentStatus,
    simulatedErp: Boolean(erpResult.simulated),
    erpMode: erpResult.mode || (erpResult.simulated ? 'mock' : 'real'),
    erpMockReplacement: Boolean(erpResult.mockReplacement),
    erpMockReason: erpResult.mockReason || '',
    erpRawResponse: erpResult.rawResponse ? JSON.stringify(erpResult.rawResponse) : '',
    lastErpRetryErrorCode: '',
    lastErpRetryErrorMessage: '',
    lastErpRetryErrorAt: '',
    updateTime: now()
  };
  state.voucherRecords[sourceId] = nextRecord;
  if (options.replacesSourceId && options.replacesSourceId !== sourceId) {
    delete state.voucherRecords[options.replacesSourceId];
  }
  persistState(state);
  recordOperation('ERP_EXPENSE_REIMBURSEMENT_SAVE', 'SUCCESS', {
    sourceId,
    simulated: Boolean(erpResult.simulated),
    erpMode: nextRecord.erpMode,
    mockReplacement: nextRecord.erpMockReplacement,
    mockReason: nextRecord.erpMockReason,
    erpFid: erpResult.erpFid,
    erpNumber: erpResult.erpNumber
  });
  return structuredClone(nextRecord);
}

export function restoreErpPushAfterRetryFailure(sourceId, previousRecord, error) {
  if (!isRealPushedRecord(previousRecord)) {
    throw new Error(`real ERP push is required before restoring failed retry for ${sourceId}`);
  }
  const state = loadState();
  const nextRecord = {
    ...structuredClone(previousRecord),
    lastErpRetryErrorCode: String(error?.code || 'REQUEST_FAILED'),
    lastErpRetryErrorMessage: String(error?.message || 'ERP retry failed'),
    lastErpRetryErrorAt: now(),
    updateTime: now()
  };
  state.voucherRecords[sourceId] = nextRecord;
  persistState(state);
  recordOperation('ERP_EXPENSE_REIMBURSEMENT_RETRY', 'FAILED', {
    sourceId,
    erpFid: nextRecord.erpFid,
    erpNumber: nextRecord.erpNumber,
    code: nextRecord.lastErpRetryErrorCode,
    message: nextRecord.lastErpRetryErrorMessage
  });
  return structuredClone(nextRecord);
}

export function discardPreparedRecord(sourceId) {
  const state = loadState();
  const record = state.voucherRecords[sourceId];
  if (!record || record.processStage !== 'EXPENSE_REIMBURSEMENT_PREPARED') return false;
  delete state.voucherRecords[sourceId];
  persistState(state);
  return true;
}

export function recordOperation(action, status, detail = {}) {
  const state = loadState();
  const entry = {
    id: nextId('LOG'),
    action,
    status,
    detail: sanitizeDetail(detail),
    createdAt: now()
  };
  state.operationLogs.unshift(entry);
  state.operationLogs = state.operationLogs.slice(0, 200);
  persistState(state);
  return structuredClone(entry);
}

export function clearStateCacheForTest() {
  stateCache = null;
}

export function listOperationLogs(limit = 50) {
  const state = loadState();
  return state.operationLogs.slice(0, limit).map((entry) => structuredClone(entry));
}

export function getDashboardSummary() {
  const state = loadState();
  const reimbursements = Object.values(state.voucherRecords)
    .filter((item) => item.targetFormId === 'ER_ExpReimbursement');
  const realSavedReimbursements = reimbursements.filter(isRealPushedRecord);
  const synced = Object.values(state.syncedDocuments).filter(isVisibleSyncedDocument);
  const batches = Object.values(state.syncBatches).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return {
    counts: {
      syncedDocuments: synced.length,
      preparedExpenseReimbursements: reimbursements.filter((item) => (
        item.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED'
      )).length,
      savedExpenseReimbursements: realSavedReimbursements.length,
      failedBatches: batches.filter((item) => item.status === 'FAILED').length,
      operationLogs: state.operationLogs.length
    },
    latestBatch: batches[0] || null,
    stateFile: getStateFile()
  };
}

export function resetRepository() {
  stateCache = defaultState();
  const file = getStateFile();
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
  persistState(stateCache);
}

function loadState() {
  if (stateCache) {
    return stateCache;
  }
  const file = getStateFile();
  if (!existsSync(file)) {
    stateCache = defaultState();
    persistState(stateCache);
    return stateCache;
  }
  try {
    stateCache = normalizeState(JSON.parse(readFileSync(file, 'utf8')));
    return stateCache;
  } catch (error) {
    throw new Error(`failed to load local state: ${error.message}`);
  }
}

function persistState(state) {
  const file = getStateFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

function getStateFile() {
  const dataDir = getAppConfig().appDataDir;
  return resolve(root, dataDir, 'state.json');
}

function defaultState() {
  return {
    config: null,
    integrationSelection: structuredClone(DEFAULT_INTEGRATION_SELECTION),
    kingdee: {
      selectedAccountKey: '',
      selectedAcctIdKey: ''
    },
    syncedDocuments: {},
    voucherRecords: {},
    syncBatches: {},
    operationLogs: []
  };
}

function normalizeState(rawState = {}) {
  const state = {
    ...defaultState(),
    ...rawState
  };
  const previousKingdee = rawState.kingdee || {};
  state.kingdee = {
    ...defaultState().kingdee,
    ...previousKingdee
  };
  state.integrationSelection = {
    ...DEFAULT_INTEGRATION_SELECTION,
    ...(rawState.integrationSelection || {}),
    kingdeeAccountKey: REQUIRED_KINGDEE_CREATOR_ACCOUNT_KEY,
    kingdeeAcctIdKey: rawState.integrationSelection?.kingdeeAcctIdKey
      || previousKingdee.selectedAcctIdKey
      || DEFAULT_INTEGRATION_SELECTION.kingdeeAcctIdKey
  };
  state.kingdee.selectedAccountKey = state.integrationSelection.kingdeeAccountKey;
  state.kingdee.selectedAcctIdKey = state.integrationSelection.kingdeeAcctIdKey;
  return state;
}

function validateIntegrationSelection(input = {}) {
  const tenantKey = requiredText(input.tenantKey, 'tenantKey');
  const kingdeeAccountKey = requiredText(input.kingdeeAccountKey, 'kingdeeAccountKey');
  const kingdeeAcctIdKey = requiredText(input.kingdeeAcctIdKey, 'kingdeeAcctIdKey');
  if (!listFenbeitongTenants().some((tenant) => tenant.key === tenantKey)) {
    throw new Error(`Fenbeitong tenant ${tenantKey} is not configured`);
  }
  if (kingdeeAccountKey !== REQUIRED_KINGDEE_CREATOR_ACCOUNT_KEY) {
    throw new Error('Kingdee expense reimbursement integration is restricted to int');
  }
  const kingdeeConfig = getAppConfig().kingdee;
  resolveKingdeeAccount(kingdeeConfig, kingdeeAccountKey);
  resolveKingdeeAcctId(kingdeeConfig, kingdeeAcctIdKey);
  return {
    tenantKey,
    kingdeeAccountKey,
    kingdeeAcctIdKey
  };
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function isRealKingdeeSaveResult(erpResult) {
  return Boolean(
    erpResult
    && erpResult.mode === 'real'
    && erpResult.simulated === false
    && erpResult.mockReplacement === false
    && erpResult.erpFid
    && erpResult.erpNumber
  );
}

export function isRealPushedRecord(record) {
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

function previousErpPushesEntry(record) {
  return {
    erpFid: record.erpFid,
    erpNumber: record.erpNumber,
    erpDocumentStatus: record.erpDocumentStatus,
    erpRawResponse: record.erpRawResponse,
    replacedAt: now()
  };
}

function nextId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function sanitizeDetail(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetail(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|password|secret|authorization|authHeaderValue/i.test(key)) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = sanitizeDetail(item);
    }
  }
  return safe;
}
