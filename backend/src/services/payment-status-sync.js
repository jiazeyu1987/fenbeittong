import {
  getFenbeitongReimbursementPaymentDetail,
  markFenbeitongReimbursementsPaid
} from '../adapters/fenbeitong-client.js';
import { queryKingdeeSuccessfulExpensePaymentBills } from '../adapters/kingdee-client.js';
import {
  getIntegrationSettings,
  isRealPushedRecord,
  listProcessRecords,
  markPaymentStatusSyncBatch,
  recordOperation
} from '../repository.js';

const BANK_SUCCESS_CODE = 'C';
const PAYMENT_STATE_PENDING = 0;
const PAYMENT_STATE_PAID = 1;

export async function previewPaymentStatusSync(options = {}) {
  const settings = getIntegrationSettings();
  const tenantKey = options.tenantKey || settings.tenantKey;
  const orgNumber = String(options.orgNumber || '892');
  const records = listProcessRecords().filter(isRealPushedRecord);
  const paymentBills = await queryKingdeeSuccessfulExpensePaymentBills({
    accountKey: options.accountKey || settings.kingdeeAccountKey,
    acctIdKey: options.acctIdKey || settings.kingdeeAcctIdKey,
    orgNumber,
    limit: options.limit || 10000
  });
  const matches = matchPaymentBills(records, paymentBills);
  const candidates = matches.filter((item) => (
    item.status === 'MATCHED'
    && item.sourceType === 'OFFLINE_REIMBURSEMENT'
  ));
  const details = await mapWithConcurrency(candidates, 8, async (item) => ({
    sourceId: item.sourceId,
    detail: await getFenbeitongReimbursementPaymentDetail(item.sourceCode, { tenantKey })
  }));
  const detailsBySourceId = new Map(details.map((item) => [item.sourceId, item.detail]));
  const results = matches.map((item) => {
    if (item.status !== 'MATCHED') return item;
    if (item.sourceType !== 'OFFLINE_REIMBURSEMENT') {
      return {
        ...item,
        status: 'ERP_PAYMENT_MATCHED_DISPLAY_ONLY',
        message: '已匹配金蝶付款单；线上月结仅展示ERP付款信息，不回传员工报销付款状态。'
      };
    }
    const detail = detailsBySourceId.get(item.sourceId);
    if (isPaidDetail(detail)) {
      return paymentResult(item, detail, 'ALREADY_PAID', '分贝通已显示已付款，无需重复回传。');
    }
    if (detail?.paymentState !== PAYMENT_STATE_PENDING) {
      return paymentResult(
        item,
        detail,
        'UNSUPPORTED_FENBEITONG_STATE',
        `分贝通付款状态不是待付款，已跳过（状态值：${Number.isFinite(detail?.paymentState) ? detail.paymentState : '空'}）。`
      );
    }
    return paymentResult(item, detail, 'READY_TO_MARK_PAID', '金蝶银行交易成功，等待回传分贝通已付款。');
  });
  return summarize(results, { tenantKey, orgNumber, paymentBillCount: paymentBills.length });
}

export async function syncPaymentStatuses(options = {}) {
  const preview = await previewPaymentStatusSync(options);
  if (options.dryRun === true) return { ...preview, dryRun: true };
  const ready = preview.items.filter((item) => item.status === 'READY_TO_MARK_PAID');
  let updateResult = { requested: 0, succeeded: [], failed: [] };
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
  const accepted = new Set(updateResult.succeeded);
  const verification = await mapWithConcurrency(
    ready.filter((item) => accepted.has(item.sourceCode)),
    8,
    async (item) => ({
      sourceId: item.sourceId,
      detail: await getFenbeitongReimbursementPaymentDetail(item.sourceCode, {
        tenantKey: preview.tenantKey
      })
    })
  );
  const verifiedBySourceId = new Map(verification.map((item) => [item.sourceId, item.detail]));
  const finalItems = preview.items.map((item) => {
    if (item.status !== 'READY_TO_MARK_PAID') return item;
    const rejectedMessage = failures.get(item.sourceCode);
    if (rejectedMessage) {
      return { ...item, status: 'FAILED', message: rejectedMessage };
    }
    const detail = verifiedBySourceId.get(item.sourceId);
    if (!accepted.has(item.sourceCode) || !isPaidDetail(detail)) {
      return {
        ...item,
        status: 'FAILED',
        message: '分贝通接口未确认付款状态已变更，未标记为同步成功。'
      };
    }
    if (dateOnly(detail?.paymentTime) !== dateOnly(item.erpPaymentDate)) {
      return {
        ...paymentResult(item, detail, 'FAILED', ''),
        message: `分贝通付款时间与ERP付款单业务日期不一致：ERP ${dateOnly(item.erpPaymentDate) || '空'}，分贝通 ${dateOnly(detail?.paymentTime) || '空'}。`
      };
    }
    return paymentResult(item, detail, 'SYNCED', '已回传分贝通，付款状态已核验为已付款。');
  });
  markPaymentStatusSyncBatch(finalItems.map((item) => ({
    sourceId: item.sourceId,
    patch: repositoryPatch(item)
  })));
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

export function matchPaymentBills(records, paymentBills) {
  return records.map((record) => {
    const sourceCode = String(record.sourceCode || '').trim();
    let model;
    try {
      model = JSON.parse(record.expenseReimbursementPayload || '{}').Model || {};
    } catch {
      return baseResult(record, 'INVALID_ERP_PAYLOAD', '本地ERP费用报销单数据无法解析，已跳过。');
    }
    const employeeNumber = referenceNumber(model.FProposerID);
    const reimbursementAmount = roundMoney(model.FReqAmountSum);
    const reimbursementDate = dateOnly(model.FDate);
    if (!employeeNumber || !Number.isFinite(reimbursementAmount) || !reimbursementDate) {
      return baseResult(record, 'INVALID_ERP_PAYLOAD', 'ERP费用报销单缺少员工编号、报销金额或日期，已跳过。');
    }
    const direct = paymentBills.filter((bill) => [
      bill.sourceBillNumber,
      bill.thirdPartyBillNumber,
      bill.remark,
      bill.entries?.map((entry) => entry.remark).join(' ')
    ].some((value) => [sourceCode, record.erpNumber].some((number) => (
      number && String(value || '').includes(number)
    ))));
    const candidates = direct.length > 0 ? direct : paymentBills.filter((bill) => (
      bill.employeeNumber === employeeNumber
      && moneyEquals(effectivePaidAmount(bill), reimbursementAmount)
      && dateOnly(bill.businessDate) >= reimbursementDate
    ));
    if (candidates.length === 0) {
      return baseResult(record, 'NO_ERP_PAYMENT_MATCH', '金蝶没有找到员工、金额和日期均一致且银行交易成功的付款单。');
    }
    if (candidates.length > 1) {
      return {
        ...baseResult(record, 'AMBIGUOUS_ERP_PAYMENT_MATCH', '金蝶找到多张可能的付款单，无法唯一确认，已跳过。'),
        candidatePaymentBillNumbers: candidates.map((bill) => bill.billNumber)
      };
    }
    const bill = candidates[0];
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
      erpPaymentDate: bill.businessDate,
      erpPaidAmount: effectivePaidAmount(bill)
    };
  });
}

function baseResult(record, status, message) {
  return {
    sourceId: record.sourceId,
    sourceIds: Array.isArray(record.sourceIds) ? [...record.sourceIds] : [record.sourceId],
    sourceType: String(record.sourceType || ''),
    sourceCode: String(record.sourceCode || ''),
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
      'ERP_PAYMENT_MATCHED_DISPLAY_ONLY'
    ].includes(item.status)).length,
    items
  };
}

function isPaidDetail(detail) {
  return detail?.paymentState === PAYMENT_STATE_PAID
    || Boolean(String(detail?.paymentTime || '').trim())
    || (Array.isArray(detail?.paymentRecords) && detail.paymentRecords.length > 0);
}

function paymentStateName(detail) {
  if (isPaidDetail(detail)) return '已付款';
  if (detail?.paymentState === PAYMENT_STATE_PENDING) return '待付款';
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
