import {
  getFenbeitongReimbursementPaymentDetail,
  markFenbeitongReimbursementsPaid
} from '../adapters/fenbeitong-client.js';
import { queryKingdeeExpensePaymentBills } from '../adapters/kingdee-client.js';
import { getAppConfig } from '../config.js';
import { normalizePaymentTimestamp } from '../payment-timestamp.js';
import {
  getIntegrationSelection,
  isRealPushedRecord,
  listProcessRecords,
  listSyncedDocuments,
  markPaymentStatusSyncBatch,
  recordOperation
} from '../repository.js';

const BANK_SUCCESS_CODE = 'C';
const PAYMENT_STATE_PENDING = 0;
const PAYMENT_STATE_PAID = 1;
const PAYMENT_STATE_PROCESSING = 2;
const PAYMENT_STATE_NOT_REQUIRED = 3;

export async function previewPaymentStatusSync(options = {}) {
  return inspectPaymentStatus(options);
}

async function inspectPaymentStatus(options, persistErpDetails = false) {
  const settings = getIntegrationSelection();
  const tenantKey = options.tenantKey || settings.tenantKey;
  const acctIdKey = options.acctIdKey || settings.kingdeeAcctIdKey;
  const configuredOrg = options.orgNumber || getAppConfig().paymentStatusSync.orgNumber;
  const sourceIds = new Set(listSyncedDocuments()
    .filter((record) => (record.tenantKey || 'puhui') === tenantKey)
    .map((record) => record.sourceId));
  const recordsByOrg = new Map();
  for (const record of listProcessRecords()) {
    if (!isRealPushedRecord(record) || record.kingdeeAcctIdKey !== acctIdKey) continue;
    const orgNumber = String(configuredOrg || paymentOrganization(record)).trim();
    if (!recordsByOrg.has(orgNumber)) recordsByOrg.set(orgNumber, []);
    recordsByOrg.get(orgNumber).push(record);
  }
  const matches = [];
  const orgNumbers = [];
  let paymentBillCount = 0;
  const belongsToTenant = (record) => (record.sourceIds || [record.sourceId]).some((id) => sourceIds.has(id));
  for (const [orgNumber, records] of recordsByOrg) {
    const tenantRecords = records.filter(belongsToTenant);
    if (tenantRecords.length === 0) continue;
    if (!orgNumber) {
      matches.push(...tenantRecords.map((record) =>
        baseResult(record, 'INVALID_ERP_PAYLOAD', '费用报销单缺少金蝶付款组织，已跳过。')));
      continue;
    }
    orgNumbers.push(orgNumber);
    const bills = await queryKingdeeExpensePaymentBills({
      accountKey: options.accountKey || settings.kingdeeAccountKey,
      acctIdKey,
      orgNumber,
      limit: options.limit || 10000,
      requireComplete: true
    });
    paymentBillCount += bills.length;
    matches.push(...matchPaymentBills(records, bills).filter(belongsToTenant));
  }
  if (persistErpDetails) persistMatches(matches);
  const candidates = matches.filter((item) => (
    item.status === 'MATCHED'
    && item.sourceType === 'OFFLINE_REIMBURSEMENT'
    && item.erpBankProcessingStatusCode === BANK_SUCCESS_CODE
    && item.erpPaymentDate
  ));
  const details = await mapWithConcurrency(candidates, 8, (item) => readPaymentDetail(item, tenantKey));
  const detailsBySourceId = new Map(details.map((item) => [item.sourceId, item]));
  const results = matches.map((item) => {
    if (item.status !== 'MATCHED') return item;
    if (item.erpBankProcessingStatusCode !== BANK_SUCCESS_CODE || !item.erpPaymentDate) {
      return {
        ...item,
        status: 'ERP_PAYMENT_NOT_CONFIRMED',
        message: item.erpBankProcessingStatusCode !== BANK_SUCCESS_CODE
          ? '金蝶付款单尚未确认银行交易成功，暂不回传。'
          : '金蝶付款单缺少实际付款交易时间，请同步银行交易时间后再回传。'
      };
    }
    if (item.sourceType !== 'OFFLINE_REIMBURSEMENT') {
      return {
        ...item,
        status: 'ERP_PAYMENT_MATCHED_DISPLAY_ONLY',
        message: '已匹配金蝶付款单；线上月结仅展示ERP付款信息，不回传员工报销付款状态。'
      };
    }
    const { detail, error } = detailsBySourceId.get(item.sourceId);
    if (error) return paymentResult(item, detail, 'FAILED', `分贝通回传前查询失败：${error}`);
    if (detail.paymentState === PAYMENT_STATE_PAID) {
      if (normalizePaymentTimestamp(detail.paymentTime) !== item.erpPaymentDate) {
        return paymentTimeMismatch(item, detail);
      }
      return paymentResult(item, detail, 'ALREADY_PAID', '分贝通已显示已付款，无需重复回传。');
    }
    if (![PAYMENT_STATE_PENDING, PAYMENT_STATE_PROCESSING].includes(detail.paymentState)) {
      return paymentResult(
        item,
        detail,
        'UNSUPPORTED_FENBEITONG_STATE',
        `分贝通付款状态无法更新为已付款，已跳过（状态值：${Number.isFinite(detail.paymentState) ? detail.paymentState : '空'}）。`
      );
    }
    return paymentResult(item, detail, 'READY_TO_MARK_PAID', '金蝶银行交易成功，等待回传分贝通已付款。');
  });
  return summarize(results, { tenantKey, orgNumber: orgNumbers.join(','), paymentBillCount });
}

export async function syncPaymentStatuses(options = {}) {
  const preview = await inspectPaymentStatus(options, options.dryRun !== true);
  if (options.dryRun === true) return { ...preview, dryRun: true };
  const ready = preview.items.filter((item) => item.status === 'READY_TO_MARK_PAID');
  let updateResult = { succeeded: [], failed: [], unconfirmed: [] };
  if (ready.length > 0) {
    updateResult = await markFenbeitongReimbursementsPaid(
      ready.map((item) => ({
        code: item.sourceCode,
        paymentTime: item.erpPaymentDate
      })),
      { tenantKey: preview.tenantKey }
    );
  }
  const failures = new Map(updateResult.failed.map((item) => [item.code, item.message]));
  const unconfirmed = new Map(updateResult.unconfirmed.map((item) => [item.code, item.message]));
  const accepted = new Set(updateResult.succeeded);
  const verification = await mapWithConcurrency(
    ready.filter((item) => accepted.has(item.sourceCode) || unconfirmed.has(item.sourceCode)),
    8,
    (item) => readPaymentDetail(item, preview.tenantKey)
  );
  const verifiedBySourceId = new Map(verification.map((item) => [item.sourceId, item]));
  const finalItems = preview.items.map((item) => {
    if (item.status !== 'READY_TO_MARK_PAID') return item;
    const rejectedMessage = failures.get(item.sourceCode);
    if (rejectedMessage) {
      return { ...item, status: 'FAILED', message: rejectedMessage };
    }
    const { detail, error } = verifiedBySourceId.get(item.sourceId) || {};
    if (detail?.paymentState !== PAYMENT_STATE_PAID) {
      const reason = error || '分贝通未回读到已付款状态';
      const writeError = unconfirmed.get(item.sourceCode);
      return paymentResult(item, detail, 'FAILED', `${writeError ? `${writeError} ` : ''}付款回读未通过：${reason}。`);
    }
    if (normalizePaymentTimestamp(detail.paymentTime) !== item.erpPaymentDate) {
      return paymentTimeMismatch(item, detail);
    }
    return paymentResult(item, detail, 'SYNCED', '已回传分贝通，付款状态已核验为已付款。');
  });
  persistMatches(finalItems);
  const result = summarize(finalItems, {
    tenantKey: preview.tenantKey,
    orgNumber: preview.orgNumber,
    paymentBillCount: preview.paymentBillCount
  });
  recordOperation('ERP_PAYMENT_STATUS_SYNC_FINISH', result.failedCount > 0 ? 'FAILED' : 'SUCCESS', {
    totalCount: result.totalCount,
    syncedCount: result.syncedCount,
    alreadyPaidCount: result.alreadyPaidCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount
  });
  return result;
}

async function readPaymentDetail(item, tenantKey) {
  try {
    const detail = await getFenbeitongReimbursementPaymentDetail(item.sourceCode, { tenantKey });
    if (detail.code !== item.sourceCode) {
      return { sourceId: item.sourceId, error: '分贝通详情返回的报销单号与请求不一致' };
    }
    return { sourceId: item.sourceId, detail };
  } catch (error) {
    const requestErrors = ['FENBEITONG_HTTP_FAILED', 'FENBEITONG_NETWORK_FAILED', 'FENBEITONG_RESPONSE_FAILED'];
    if (!requestErrors.includes(error.code)) throw error;
    return { sourceId: item.sourceId, error: error.message };
  }
}

function paymentTimeMismatch(item, detail) {
  return paymentResult(item, detail, 'FAILED',
    `分贝通已付款，但付款交易时间不一致：金蝶 ${item.erpPaymentDate}，分贝通 ${detail.paymentTime || '空'}。`);
}

function paymentOrganization(record) {
  try {
    const model = JSON.parse(record.expenseReimbursementPayload || '{}').Model || {};
    return referenceNumber(model.FPayOrgId) || referenceNumber(model.FOrgID);
  } catch {
    return '';
  }
}

function persistMatches(items) {
  const updates = items.filter((item) => item.erpPaymentBillId || item.status === 'AMBIGUOUS_ERP_PAYMENT_MATCH').map((item) => ({
    sourceId: item.sourceId,
    patch: repositoryPatch(item)
  }));
  if (updates.length > 0) markPaymentStatusSyncBatch(updates);
}

export function matchPaymentBills(records, paymentBills) {
  const directClaims = new Map();
  const fallbackBills = paymentBills.filter((bill) => {
    const entries = bill.entries || [];
    const references = [bill.sourceBillNumber, bill.thirdPartyBillNumber,
      ...(bill.sourceBillNumbers || []), ...entries.map((entry) => entry.sourceBillNumber)];
    const referenceText = [...references, bill.remark, ...entries.map((entry) => entry.remark)];
    const found = new Set(referenceText.flatMap((value) => billReferences(value)));
    const owners = records.filter((record) => [record.sourceCode, record.erpNumber]
      .some((number) => number && found.has(String(number).trim())));
    if (owners.length) directClaims.set(bill, owners);
    return owners.length === 0 && references.every((value) => billReferences(value).length === 0);
  });
  const plans = records.map((record) => {
    let model;
    try {
      model = JSON.parse(record.expenseReimbursementPayload || '{}').Model || {};
    } catch {
      return { error: baseResult(record, 'INVALID_ERP_PAYLOAD', '本地ERP费用报销单数据无法解析，已跳过。') };
    }
    const employeeNumber = referenceNumber(model.FProposerID);
    const reimbursementAmount = roundMoney(model.FReqAmountSum);
    const reimbursementDate = dateOnly(model.FDate);
    if (!employeeNumber || !Number.isFinite(reimbursementAmount) || !reimbursementDate) {
      return { error: baseResult(record, 'INVALID_ERP_PAYLOAD', 'ERP费用报销单缺少员工编号、报销金额或日期，已跳过。') };
    }
    const direct = [...directClaims].filter(([, owners]) => owners.includes(record)).map(([bill]) => bill);
    const candidates = direct.length > 0 ? direct : fallbackBills.filter((bill) => (
      bill.employeeNumber === employeeNumber
      && moneyEquals(effectivePaidAmount(bill), reimbursementAmount)
      && dateOnly(bill.paymentTime || bill.businessDate) >= reimbursementDate
    ));
    return { record, candidates, employeeNumber, reimbursementAmount, reimbursementDate };
  });
  const fallbackClaims = new Map();
  for (const { candidates = [] } of plans) {
    for (const bill of candidates) {
      if (!directClaims.has(bill)) fallbackClaims.set(bill, (fallbackClaims.get(bill) || 0) + 1);
    }
  }
  return plans.map(({ error, record, candidates, employeeNumber, reimbursementAmount, reimbursementDate }) => {
    if (error) return error;
    if (candidates.length === 0) {
      return baseResult(record, 'NO_ERP_PAYMENT_MATCH', '金蝶没有找到对应的费用报销付款单。');
    }
    const bill = candidates[0];
    if (candidates.length > 1 || (directClaims.get(bill)?.length || fallbackClaims.get(bill)) > 1) {
      return {
        ...baseResult(record, 'AMBIGUOUS_ERP_PAYMENT_MATCH', '金蝶付款单与费用报销单无法唯一对应，已跳过。'),
        candidatePaymentBillNumbers: candidates.map((bill) => bill.billNumber)
      };
    }
    return {
      ...baseResult(record, 'MATCHED', ''),
      employeeNumber,
      reimbursementAmount,
      reimbursementDate,
      erpPaymentBillId: bill.id,
      erpPaymentBillNumber: bill.billNumber,
      erpPaymentBillType: bill.billTypeName,
      erpPaymentBillTypeNumber: bill.billTypeNumber,
      erpBankProcessingStatus: bill.bankStatusName,
      erpBankProcessingStatusCode: bill.bankStatusCode,
      erpPaymentDate: normalizePaymentTimestamp(bill.paymentTime),
      erpPaidAmount: effectivePaidAmount(bill)
    };
  });
}

function billReferences(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '0') return [];
  return [...new Set((text.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) || []).concat(text))].filter((token) => token !== '-');
}

function baseResult(record, status, message) {
  return {
    sourceId: record.sourceId,
    sourceIds: Array.isArray(record.sourceIds) ? [...record.sourceIds] : [record.sourceId],
    sourceType: String(record.sourceType || ''),
    sourceCode: String(record.sourceCode || '').trim(),
    requesterName: String(record.requesterName || ''),
    requesterCode: String(record.requesterCode || ''),
    erpExpenseReimbursementNumber: String(record.erpNumber || ''),
    status,
    message
  };
}

function paymentResult(item, detail, status, message) {
  return {
    ...item,
    status,
    message,
    fenbeitongPaymentState: paymentStateName(detail),
    fenbeitongPaymentStateCode: detail?.paymentState,
    fenbeitongPaymentTime: detail?.paymentTime || ''
  };
}

function repositoryPatch(item) {
  return {
    erpPaymentBillType: item.erpPaymentBillType,
    erpPaymentBillNumber: item.erpPaymentBillNumber,
    erpPaymentDate: item.erpPaymentDate,
    erpBankProcessingStatus: item.erpBankProcessingStatus,
    erpBankProcessingStatusCode: item.erpBankProcessingStatusCode,
    fenbeitongPaymentState: item.fenbeitongPaymentState,
    reversePaymentSyncStatus: item.status,
    reversePaymentSyncMessage: item.message,
    reversePaymentSyncedAt: new Date().toISOString()
  };
}

function summarize(items, context) {
  return {
    ...context,
    generatedAt: new Date().toISOString(),
    totalCount: items.length,
    readyCount: items.filter((item) => item.status === 'READY_TO_MARK_PAID').length,
    syncedCount: items.filter((item) => item.status === 'SYNCED').length,
    alreadyPaidCount: items.filter((item) => item.status === 'ALREADY_PAID').length,
    displayOnlyCount: items.filter((item) => item.status === 'ERP_PAYMENT_MATCHED_DISPLAY_ONLY').length,
    failedCount: items.filter((item) => item.status === 'FAILED').length,
    skippedCount: items.filter((item) => [
      'NO_ERP_PAYMENT_MATCH',
      'AMBIGUOUS_ERP_PAYMENT_MATCH',
      'INVALID_ERP_PAYLOAD',
      'UNSUPPORTED_FENBEITONG_STATE',
      'ERP_PAYMENT_NOT_CONFIRMED',
      'ERP_PAYMENT_MATCHED_DISPLAY_ONLY'
    ].includes(item.status)).length,
    items
  };
}

function paymentStateName(detail) {
  if (detail?.paymentState === PAYMENT_STATE_PAID) return '已付款';
  if (detail?.paymentState === PAYMENT_STATE_PENDING) return '待付款';
  if (detail?.paymentState === PAYMENT_STATE_PROCESSING) return '付款中';
  if (detail?.paymentState === PAYMENT_STATE_NOT_REQUIRED) return '无需付款';
  return detail?.paymentStateName || (Number.isFinite(detail?.paymentState) ? String(detail.paymentState) : '');
}

function effectivePaidAmount(bill) {
  const entryAmount = roundMoney(bill.entryPaymentAmount);
  return entryAmount !== 0 ? entryAmount : roundMoney(bill.paidAmount);
}

function referenceNumber(reference) {
  return String(reference?.FStaffNumber || reference?.FNumber || '').trim();
}

function dateOnly(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}

function roundMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : NaN;
}

function moneyEquals(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.005;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}

export const paymentStatusConstantsForTest = {
  BANK_SUCCESS_CODE,
  PAYMENT_STATE_PENDING,
  PAYMENT_STATE_PAID
};
