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

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
let stateCache = null;
const DEFAULT_INTEGRATION_SELECTION = {
  tenantKey: 'puhui',
  kingdeeAccountKey: 'current',
  kingdeeAcctIdKey: DEFAULT_KINGDEE_ACCT_ID_KEY,
  updatedAt: ''
};

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

export function savePreparedRecord(preview) {
  const state = loadState();
  const previous = state.voucherRecords[preview.sourceId] || {};
  const record = {
    ...previous,
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
    createTime: previous.createTime || now(),
    updateTime: now()
  };
  state.voucherRecords[record.sourceId] = record;
  persistState(state);
  recordOperation('VOUCHER_PREPARE', 'SUCCESS', { sourceId: record.sourceId });
  return structuredClone(record);
}

export function saveSyncedDocument(document, batchId = '', options = {}) {
  const sourceId = document?.data?.reimb_id;
  if (!sourceId) {
    throw new Error('synced Fenbeitong document is missing data.reimb_id');
  }
  const state = loadState();
  const previous = state.syncedDocuments[sourceId] || {};
  const record = {
    ...previous,
    sourceSystem: 'FENBEITONG',
    sourceType: 'REIMBURSEMENT',
    sourceId,
    sourceCode: document.data.reimb_code,
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
  persistState(state);
  recordOperation('SOURCE_SYNC', 'SUCCESS', {
    sourceId,
    batchId,
    sourceMode: record.sourceMode,
    mockReplacement: record.mockReplacement,
    mockReason: record.mockReason
  });
  return structuredClone(record);
}

export function findSyncedDocument(sourceId) {
  const state = loadState();
  const record = state.syncedDocuments[sourceId];
  return record ? structuredClone(record) : null;
}

export function listSyncedDocuments() {
  const state = loadState();
  return Object.values(state.syncedDocuments)
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime))
    .map((record) => structuredClone(record));
}

export function findPreparedRecord(sourceId) {
  const state = loadState();
  const record = state.voucherRecords[sourceId];
  return record ? structuredClone(record) : null;
}

export function listProcessRecords() {
  const state = loadState();
  return Object.values(state.voucherRecords)
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime))
    .map((record) => structuredClone(record));
}

export function markPushedToErp(sourceId, erpResult) {
  const state = loadState();
  const record = state.voucherRecords[sourceId];
  if (!record) {
    throw new Error(`prepared record is missing for ${sourceId}`);
  }
  if (!isRealKingdeeSaveResult(erpResult)) {
    throw new Error('real Kingdee save result is required before marking ERP push success');
  }
  if (record.processStage === 'ERP_PUSHED' || record.erpFid || record.erpNumber) {
    throw new Error(`voucher for ${sourceId} already pushed to ERP`);
  }
  const nextRecord = {
    ...record,
    processStatus: 30,
    processStage: 'ERP_PUSHED',
    erpFid: erpResult.erpFid,
    erpNumber: erpResult.erpNumber,
    erpDocumentStatus: erpResult.documentStatus,
    simulatedErp: Boolean(erpResult.simulated),
    erpMode: erpResult.mode || (erpResult.simulated ? 'mock' : 'real'),
    erpMockReplacement: Boolean(erpResult.mockReplacement),
    erpMockReason: erpResult.mockReason || '',
    erpRawResponse: erpResult.rawResponse ? JSON.stringify(erpResult.rawResponse) : '',
    updateTime: now()
  };
  state.voucherRecords[sourceId] = nextRecord;
  persistState(state);
  recordOperation('ERP_PUSH', 'SUCCESS', {
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
  const vouchers = Object.values(state.voucherRecords);
  const realPushedVouchers = vouchers.filter(isRealPushedRecord);
  const synced = Object.values(state.syncedDocuments);
  const batches = Object.values(state.syncBatches).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return {
    counts: {
      syncedDocuments: synced.length,
      preparedVouchers: vouchers.filter((item) => item.processStage === 'PREPARED').length,
      pushedVouchers: realPushedVouchers.length,
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
    kingdeeAccountKey: rawState.integrationSelection?.kingdeeAccountKey
      || previousKingdee.selectedAccountKey
      || DEFAULT_INTEGRATION_SELECTION.kingdeeAccountKey,
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

function isRealPushedRecord(record) {
  return Boolean(
    record.processStage === 'ERP_PUSHED'
    && record.erpMode === 'real'
    && record.simulatedErp === false
    && record.erpFid
    && record.erpNumber
  );
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
