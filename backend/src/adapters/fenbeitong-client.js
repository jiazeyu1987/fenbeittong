import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getAppConfig, getRootDir, validateFenbeitongConfig } from '../config.js';
import { dependencyError } from '../errors.js';
import {
  getFenbeitongTenant,
  updateFenbeitongTenantToken
} from '../tenant-store.js';

export function clearFenbeitongTokenCacheForTest() {
  const tenant = getFenbeitongTenant('puhui', { includeSecrets: true });
  if (!tenant) {
    return;
  }
  updateFenbeitongTenantToken('puhui', {
    accessToken: 'cleared-for-test',
    expiresAt: '1970-01-01T00:00:00.000Z'
  });
}

export async function pullFenbeitongReimbursements(options = {}) {
  const config = getAppConfig().fenbeitong;
  const tenant = resolveTenant(config.defaultTenantKey, options.tenantKey);
  if (config.mode === 'mock') {
    const fixedJson = readFileSync(
      resolve(getRootDir(), 'mock-data/fenbeitong-reimbursement-valid.json'),
      'utf8'
    );
    const baseDocument = JSON.parse(fixedJson);
    const onlineDocument = JSON.parse(readFileSync(
      resolve(getRootDir(), 'mock-data/fenbeitong-online-bill-valid.json'),
      'utf8'
    ));
    return {
      mode: 'mock',
      tenantKey: tenant.key,
      mockReplacement: true,
      mockReason: 'Fenbeitong real interface is not enabled for this run',
      documents: config.offlineOnly
        ? buildMockReimbursements(baseDocument, 100)
        : [...buildMockReimbursements(baseDocument, 100), onlineDocument],
      sourceWarnings: []
    };
  }

  validateFenbeitongConfig(tenant);
  const accessToken = await resolveAccessToken(tenant);
  const listPayload = {
    ...tenant.listPayload,
    ...config.listPayloadOverrides
  };
  const summaries = await pullAllReimbursementSummaries(tenant, accessToken, listPayload);
  const offlineDocuments = await mapWithConcurrency(summaries, 16, async (summary) => {
    const detailPayload = buildDetailRequestPayload(summary);
    const detailBody = await postFenbeitongApi(tenant, tenant.detailPath, accessToken, detailPayload);
    return validateDetailDocument(detailBody);
  });
  const documents = offlineDocuments.filter(hasOfflineExpenseType);
  if (config.offlineOnly) {
    return {
      mode: 'real',
      tenantKey: tenant.key,
      mockReplacement: false,
      mockReason: '',
      documents,
      sourceWarnings: []
    };
  }
  const onlineResult = await pullSettlementBillDocuments(tenant, accessToken);
  documents.push(...onlineResult.documents);
  return {
    mode: 'real',
    tenantKey: tenant.key,
    mockReplacement: false,
    mockReason: '',
    documents,
    sourceWarnings: onlineResult.warnings
  };
}

async function pullSettlementBillDocuments(tenant, accessToken) {
  const range = billMonthRange(tenant.billMonthsBack);
  const bills = await pullAllSettlementBills(tenant, accessToken, range);
  const detailPath = settlementBillDetailPath(tenant.billDetailPath);
  const results = await mapWithConcurrency(bills, 4, async (bill) => {
    const rows = await pullAllSettlementBillRows(tenant, accessToken, detailPath, bill);
    const sourceDetailIds = settlementSourceDetailIds(rows);
    return rows.flatMap((row, index) => {
      const document = buildSettlementBillDocument(bill, row, index, sourceDetailIds[index]);
      return document ? [document] : [];
    });
  });
  const documents = results.flat();
  const warnings = [];
  if (documents.length === 0 && bills.length > 0) {
    warnings.push('分贝通结算入账账单中没有包含企业支付金额的明细');
  }
  return { documents, warnings };
}

async function pullAllSettlementBills(tenant, accessToken, range) {
  const billsByNumber = new Map();
  for (const state of ISSUED_SETTLEMENT_BILL_STATES) {
    let pageIndex = 1;
    let totalPages = 1;
    do {
      const body = await postFenbeitongBillApi(
        tenant,
        tenant.billNumberPath,
        accessToken,
        {
          start_time: range.startMonth,
          end_time: range.endMonth,
          state,
          page_index: pageIndex,
          page_size: 100
        }
      );
      const rows = settlementBillList(body);
      for (const bill of rows) {
        const billNumber = settlementBillNumber(bill);
        if (!billNumber || !isIssuedSettlementBill(bill) || !settlementBillMonth(bill)) continue;
        billsByNumber.set(billNumber, bill);
      }
      totalPages = settlementTotalPages(body, pageIndex);
      pageIndex += 1;
    } while (pageIndex <= totalPages);
  }
  return [...billsByNumber.values()];
}

async function pullAllSettlementBillRows(tenant, accessToken, detailPath, bill) {
  const rows = [];
  const billNumber = settlementBillNumber(bill);
  let pageIndex = 1;
  let totalPages = 1;
  do {
    const body = await postFenbeitongBillApi(tenant, detailPath, accessToken, {
      bill_code: billNumber,
      page_index: pageIndex,
      page_size: 100
    });
    rows.push(...settlementBillRows(body));
    totalPages = settlementTotalPages(body, pageIndex);
    pageIndex += 1;
  } while (pageIndex <= totalPages);
  return rows;
}

function settlementBillList(body) {
  for (const value of [
    body.data?.list,
    body.data?.bill_list,
    body.data?.bills,
    body.data?.dto_list,
    body.data
  ]) {
    if (Array.isArray(value)) return value;
  }
  throw dependencyError(
    'FENBEITONG_BILL_INVALID_RESPONSE',
    'Fenbeitong settlement bill list response must include data.list'
  );
}

function settlementBillRows(body) {
  for (const value of [
    body.data?.details,
    body.data?.dto_list,
    body.data?.list,
    body.data?.order_list,
    body.data?.orders,
    body.data
  ]) {
    if (Array.isArray(value)) return value;
  }
  throw dependencyError(
    'FENBEITONG_BILL_INVALID_RESPONSE',
    'Fenbeitong settlement bill detail response must include data.dto_list'
  );
}

function settlementTotalPages(body, currentPage) {
  const pageInfo = body.data?.page_info || body.data?.pageInfo || {};
  const totalCount = Number(body.data?.count ?? body.data?.total_count ?? pageInfo.total_size);
  const pageSize = Number(body.data?.page_size ?? pageInfo.page_size);
  const explicit = Number(
    body.data?.total_pages
    ?? body.data?.total_page
    ?? pageInfo.total_pages
    ?? pageInfo.total_page
  );
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(currentPage, explicit);
  if (Number.isFinite(totalCount) && Number.isFinite(pageSize) && pageSize > 0) {
    return Math.max(currentPage, Math.ceil(totalCount / pageSize));
  }
  return currentPage;
}

function settlementBillDetailPath(path) {
  return firstOrderText(path, '/openapi/bill/business/v1/detail');
}

function buildSettlementBillDocument(bill, row, rowIndex, resolvedSourceDetailId = '') {
  const amount = settlementEnterprisePaymentAmount(row);
  if (amount === null) return null;
  const referenceSplit = settlementReferenceSplit(row, amount);
  // A zero-net settlement line can still be a real change/refund transaction:
  // Fenbeitong represents it with signed deductible and non-deductible amounts
  // that offset to zero. Keep those rows, but continue to ignore linked helper
  // rows whose enterprise payment and authoritative split fields are all zero.
  if (
    amount === 0
    && referenceSplit.deductible === 0
    && referenceSplit.nonDeductible === 0
  ) return null;
  const billNumber = settlementBillNumber(bill);
  const settlementMonth = settlementBillMonth(bill);
  const businessLine = settlementBusinessLine(row);
  // A settlement detail without a resolvable business line is not a valid
  // expense row. Keep the source empty instead of inventing a category.
  if (!settlementMonth || !businessLine) return null;
  const categoryType = settlementBusinessLineCode(row, businessLine);
  const thirdFields = row.third_fields_json && typeof row.third_fields_json === 'object'
    ? row.third_fields_json
    : {};
  const expenseDepartmentName = settlementExpenseDepartmentName(row);
  const booker = settlementBooker(row, thirdFields);
  const orderId = firstOrderText(
    row.order_id,
    row.source_order_id,
    row.root_order_id,
    `${billNumber}:${rowIndex + 1}`
  );
  const sourceDetailId = resolvedSourceDetailId || settlementSourceDetailId(row, orderId, rowIndex);
  return {
    code: '0',
    msg: 'success',
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      source_origin: 'SETTLEMENT_POSTING',
      source_contract: 'BUSINESS_BILL_LIST_AND_DETAIL',
      bill_no: billNumber,
      bill_cycle: firstOrderText(bill.bill_cycle, bill.cycle),
      start_month: firstOrderText(bill.start_time, bill.start_month),
      end_month: firstOrderText(bill.end_time, bill.end_month),
      settlement_month: settlementMonth,
      bill_state: bill.state ?? bill.bill_state,
      currency_code: firstOrderText(row.currency_code, 'CNY'),
      order: {
        ...row,
        order_category: categoryType || row.order_category,
        business_line_name: businessLine,
        order_id: orderId,
        source_order_id: firstOrderText(row.root_order_id, row.source_order_id, orderId),
        source_detail_id: sourceDetailId,
        order_create_time: firstOrderText(row.order_create_time, row.start_time, row.end_time),
        employee_name: booker.name,
        third_employee_id: booker.employeeCode,
        department_name: booker.departmentName,
        third_department_id: booker.departmentCode,
        booker_department_name: expenseDepartmentName,
        booker_department_code: firstOrderText(
          thirdFields.settleOrder_thirdExtFieldsJson_costAttributionDeptId,
          row.cost_attribution_department_code
        ),
        repayment_total_amount: amount,
        reference_deductible_total_amount: referenceSplit.deductible,
        reference_non_deductible_amount: referenceSplit.nonDeductible,
        expense_category_code: firstOrderText(row.expense_category_code, row.cost_category_code),
        expense_category_name: firstOrderText(row.expense_category_name, row.cost_category),
        reason: firstOrderText(row.reason, row.public_payment_reason),
        purpose: firstOrderText(row.purpose, row.public_payment_use),
        traffic_type: firstOrderText(row.traffic_type, row.order_category_type),
        departure_name: firstOrderText(row.start_city_name, row.departure_name, row.departure_city),
        from_station_name: firstOrderText(row.start_address_name, row.start_adress_name, row.from_station_name),
        arrival_name: firstOrderText(row.end_city_name, row.arrival_name, row.arrival_city),
        to_station_name: firstOrderText(row.end_address_name, row.end_adress_name, row.to_station_name),
        reimbursement_date_time: firstOrderText(row.order_create_time, row.start_time, row.end_time)
      }
    }
  };
}

function settlementReferenceSplit(row, totalAmount) {
  const deductible = finiteOrderNumberOrNull(
    row.deductible_total_amount,
    row.reference_deductible_total_amount,
    row.reference_deductible_amount
  );
  const nonDeductible = finiteOrderNumberOrNull(
    row.un_deductible_total_amount,
    row.reference_non_deductible_amount,
    row.reference_nondeductible_amount
  );
  if (deductible !== null) {
    return {
      deductible,
      nonDeductible: nonDeductible ?? roundOrderMoney(totalAmount - deductible)
    };
  }
  if (nonDeductible !== null) {
    return {
      deductible: roundOrderMoney(totalAmount - nonDeductible),
      nonDeductible
    };
  }
  // These fields are intentionally absent when the enterprise-paid portion is
  // fully non-deductible. The *_par_price fields use the whole ticket/order
  // amount (including personal payment), so they must never be used here.
  return { deductible: 0, nonDeductible: totalAmount };
}

export function settlementSourceDetailIdsForTest(rows) {
  return settlementSourceDetailIds(rows);
}

function settlementSourceDetailIds(rows) {
  const baseIds = rows.map((row, index) => {
    const orderId = firstOrderText(
      row.order_id,
      row.source_order_id,
      row.root_order_id,
      `ROW-${index + 1}`
    );
    return settlementSourceDetailId(row, orderId, index);
  });
  const counts = new Map();
  for (const value of baseIds) counts.set(value, (counts.get(value) || 0) + 1);
  const resolved = baseIds.map((baseId, index) => {
    if (counts.get(baseId) === 1) return baseId;
    const row = rows[index];
    const discriminator = firstOrderText(
      row.ticket_id,
      row.detail_id,
      row.id,
      `ROW-${index + 1}`
    );
    return `${baseId}:${discriminator}`;
  });
  const resolvedCounts = new Map();
  for (const value of resolved) resolvedCounts.set(value, (resolvedCounts.get(value) || 0) + 1);
  return resolved.map((value, index) => (
    resolvedCounts.get(value) === 1 ? value : `${value}:ROW-${index + 1}`
  ));
}

function validEmployeeCode(value) {
  const text = firstOrderText(value);
  return /^(?:--?|null|undefined|未知|无)$/i.test(text) ? '' : text;
}

function settlementBooker(row, thirdFields) {
  return {
    // Only the booking/order/dining person may become the ERP applicant.
    // user/passenger/rider/actual-user/sender fields are deliberately excluded.
    name: firstOrderText(
      row.booker_name,
      row.order_user_name,
      row.orderer_name,
      row.diner_name,
      row.payer_name
    ),
    employeeCode: firstOrderText(
      validEmployeeCode(row.booker_code),
      validEmployeeCode(row.order_user_code),
      validEmployeeCode(row.orderer_code),
      validEmployeeCode(row.diner_code),
      validEmployeeCode(row.payer_code),
      validEmployeeCode(thirdFields.settleOrder_thirdExtFieldsJson_bookerUserId)
    ),
    departmentName: firstOrderText(
      row.booker_dept,
      row.order_user_dept,
      row.orderer_dept,
      row.diner_dept,
      row.payer_dept
    ),
    departmentCode: firstOrderText(
      row.booker_department_code,
      row.order_user_department_code,
      row.orderer_department_code,
      row.diner_department_code,
      row.payer_department_code,
      thirdFields.settleOrder_thirdExtFieldsJson_bookerDeptId
    )
  };
}

function settlementSourceDetailId(row, orderId, rowIndex) {
  const ticketNumber = firstOrderText(row.ticket_number, row.ticket_no);
  if (!ticketNumber) return `${orderId}:${rowIndex + 1}`;
  const rootOrderId = firstOrderText(row.root_order_id, row.source_order_id);
  if (rootOrderId && rootOrderId !== orderId) {
    return `${ticketNumber}:${orderId}`;
  }
  return ticketNumber;
}

function settlementBillNumber(bill) {
  return firstOrderText(
    bill.code,
    bill.bill_no,
    bill.bill_number,
    bill.bill_id
  );
}

const ISSUED_SETTLEMENT_BILL_STATES = Object.freeze([1, 2, 3, 4]);

function isIssuedSettlementBill(bill) {
  return ISSUED_SETTLEMENT_BILL_STATES.includes(Number(bill?.state ?? bill?.bill_state));
}

function settlementBillMonth(bill) {
  // bill_cycle is the accounting period shown in “结算入账 → 已出账单”.
  // start_time/end_time can be the month in which the bill was issued, so they
  // must not be used to guess the accounting period.
  return monthText(firstOrderText(bill?.bill_cycle, bill?.cycle));
}

function settlementEnterprisePaymentAmount(row) {
  for (const value of [
    row.company_price,
    row.company_pay_price,
    row.enterprise_payment_amount,
    row.company_payment_amount
  ]) {
    if (value === undefined || value === null || value === '') continue;
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      throw dependencyError(
        'FENBEITONG_BILL_INVALID_RESPONSE',
        'Fenbeitong settlement bill enterprise payment amount must be numeric'
      );
    }
    return roundOrderMoney(amount);
  }
  return null;
}

function settlementBusinessLine(row) {
  return firstOrderText(
    row.business_line_name,
    row.business_line,
    typeof row.order_category === 'string' && !/^\d+$/.test(row.order_category.trim())
      ? row.order_category
      : '',
    TRAVEL_ORDER_BUSINESS_LINE[Number(row.order_category)]
  );
}

function settlementBusinessLineCode(row, businessLine) {
  const numeric = Number(row.order_category);
  if (Number.isFinite(numeric)) return numeric;
  return SETTLEMENT_BUSINESS_LINE_CODE[businessLine] || 0;
}

function settlementExpenseDepartmentName(row) {
  const raw = firstOrderText(
    row.expense_department_name,
    row.cost_attribution_department_name,
    row.cost_attribution_name1,
    row.old_cost_attribution_name1
  );
  return raw.replace(/^<|>$/g, '').replace(/[:：]\s*-?\d+(?:\.\d+)?%$/, '').trim();
}

async function postFenbeitongBillApi(tenant, path, accessToken, data) {
  if (!tenant.billSignKey) {
    try {
      return await postFenbeitongApi(
        { ...tenant, baseUrl: tenant.baseUrl },
        path,
        accessToken,
        data
      );
    } catch (error) {
      const message = String(error?.detail?.msg || error?.message || '');
      if (error?.code === 'FENBEITONG_RESPONSE_FAILED' && /签名|\[sign\]/i.test(message)) {
        throw dependencyError(
          'FENBEITONG_BILL_ENDPOINT_AUTH_MISMATCH',
          '当前配置的结算账单接口路径实际要求签名，不是现有 access-token 请求头接口；请改为分贝通提供的 Token 版结算账单列表/明细路径。程序不会再用普通订单详情冒充结算入账数据。',
          { path, upstreamMessage: message }
        );
      }
      throw error;
    }
  }
  const timestamp = String(Date.now());
  const jsonData = JSON.stringify(data);
  const sign = createHash('md5')
    .update(`timestamp=${timestamp}&data=${jsonData}&sign_key=${tenant.billSignKey}`, 'utf8')
    .digest('hex');
  const response = await fetch(new URL(path, tenant.billBaseUrl || tenant.baseUrl), {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      access_token: accessToken,
      timestamp,
      sign,
      data: jsonData
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'FENBEITONG_BILL_HTTP_FAILED',
      `Fenbeitong settlement bill request failed: HTTP ${response.status}`,
      { status: response.status }
    );
  }
  if (String(body.code) !== '0') {
    throw dependencyError(
      'FENBEITONG_BILL_RESPONSE_FAILED',
      `Fenbeitong settlement bill response failed: code=${body.code}, msg=${body.msg || ''}`,
      { code: body.code, msg: body.msg || '' }
    );
  }
  return body;
}

async function pullLinkedSettlementOrderDocuments(tenant, accessToken, reimbursementDocuments) {
  const range = billMonthRange(tenant.billMonthsBack);
  const references = uniqueLinkedOrderReferences(reimbursementDocuments);
  const tasks = references
    .filter((reference) => {
      const sourceDate = travelOrderDate(reference.id);
      return !sourceDate || sourceDate >= range.startDate;
    })
    .flatMap(buildLinkedOrderDetailTask);
  const results = await mapWithConcurrency(tasks, 16, async (task) => {
    try {
      const body = await postFenbeitongApi(tenant, task.path, accessToken, task.payload);
      const document = buildOnlineTravelOrderDocument(task, body);
      if (!document) return { skipped: true };
      const month = document.data.settlement_month;
      if (month < range.startMonth || month > range.endMonth) return { skipped: true };
      return { document };
    } catch (error) {
      return { error };
    }
  });
  const documents = results.flatMap((result) => result.document ? [result.document] : []);
  const detailFailureCount = results.filter((result) => result.error).length;
  const warnings = [];
  if (detailFailureCount > 0) {
    warnings.push(`分贝通有 ${detailFailureCount} 条关联订单未返回详情，已跳过；其余数据同步成功`);
  }
  return { documents, warnings };
}

function uniqueLinkedOrderReferences(reimbursementDocuments) {
  const references = new Map();
  for (const document of reimbursementDocuments) {
    for (const order of Array.isArray(document?.data?.orders) ? document.data.orders : []) {
      const id = firstOrderText(order?.id, order?.order_id);
      const type = Number(order?.type ?? order?.category_type);
      const ticketId = firstOrderText(order?.ticket_id);
      if (!id || !Number.isFinite(type)) continue;
      references.set(`${type}:${id}:${ticketId}`, { id, type, ticketId });
    }
  }
  return [...references.values()];
}

function buildLinkedOrderDetailTask(reference) {
  const kind = TRAVEL_ORDER_DETAIL_KIND[reference.type];
  if (!kind) return [];
  if ((reference.type === 7 || reference.type === 15) && !reference.ticketId) return [];
  const summary = {
    order_id: reference.id,
    order_type: 1,
    category_type: reference.type
  };
  const payload = {
    order_id: reference.id,
    order_type: 1,
    category_type: reference.type,
    ...(reference.ticketId ? { ticket_id: reference.ticketId } : {})
  };
  return [{
    summary,
    payload,
    path: `/openapi/order/${kind}/v1/detail`
  }];
}

const TRAVEL_ORDER_LIST_PATH = '/openapi/order/travel/v1/list';
const TRAVEL_ORDER_DETAIL_KIND = Object.freeze({
  3: 'taxi',
  7: 'air',
  11: 'hotel',
  15: 'train',
  60: 'dinner',
  131: 'express'
});
const SETTLEMENT_BUSINESS_LINE_CODE = Object.freeze({
  用车: 3,
  机票: 7,
  酒店: 11,
  火车: 15,
  采购: 20,
  口碑用餐: 30,
  国际机票: 40,
  外卖: 50,
  用餐: 60,
  增值服务: 99,
  货运: 125,
  虚拟卡: 126,
  闪送: 130,
  快递: 131,
  其他订单: 134,
  租车: 912
});
const TRAVEL_ORDER_BUSINESS_LINE = Object.freeze({
  3: '用车',
  5: '采购',
  7: '机票',
  11: '酒店',
  15: '火车',
  50: '外卖',
  60: '用餐',
  99: '服务',
  125: '货运',
  131: '快递',
  134: '其他订单',
  912: '租车',
  913: '增值服务'
});

async function pullOnlineTravelOrderDocuments(tenant, accessToken) {
  const summaries = await pullAllTravelOrderSummaries(tenant, accessToken);
  const range = billMonthRange(tenant.billMonthsBack);
  const recentSummaries = summaries.filter((summary) => {
    const sourceDate = travelOrderDate(summary.order_id);
    return !sourceDate || sourceDate >= range.startDate;
  });
  const ticketResult = await pullTravelTicketIndex(tenant, accessToken, range, recentSummaries);
  const tasks = [];
  let unsupportedSummaryCount = 0;
  for (const summary of recentSummaries) {
    const detailTasks = buildTravelOrderDetailTasks(summary, ticketResult.ticketIdsByOrder);
    if (detailTasks.length === 0) unsupportedSummaryCount += 1;
    else tasks.push(...detailTasks);
  }
  const results = await mapWithConcurrency(tasks, 32, async (task) => {
    try {
      const body = await postFenbeitongApi(tenant, task.path, accessToken, task.payload);
      const document = buildOnlineTravelOrderDocument(task, body);
      return document ? { document } : { skipped: true };
    } catch (error) {
      return { error };
    }
  });
  const documents = results.flatMap((result) => result.document ? [result.document] : []);
  const detailFailureCount = results.filter((result) => result.error).length;
  const nonPayableCount = results.filter((result) => result.skipped).length;
  const warnings = [...ticketResult.warnings];
  if (unsupportedSummaryCount > 0) warnings.push(`线上订单有 ${unsupportedSummaryCount} 条缺少详情标识，已跳过`);
  if (detailFailureCount > 0) warnings.push(`线上订单有 ${detailFailureCount} 条详情未取得，已跳过`);
  if (nonPayableCount > 0) warnings.push(`线上订单有 ${nonPayableCount} 条企业应付金额不大于 0，已跳过`);
  return { documents, warnings };
}

async function pullTravelTicketIndex(tenant, accessToken, range, summaries) {
  const ticketIdsByOrder = new Map();
  const warnings = [];
  const requiredKinds = [
    ...(summaries.some((summary) => Number(summary.category_type) === 7) ? ['air'] : []),
    ...(summaries.some((summary) => Number(summary.category_type) === 15) ? ['train'] : [])
  ];
  for (const kind of requiredKinds) {
    try {
      const rows = await pullAllCategoryOrders(tenant, accessToken, kind, range);
      for (const row of rows) {
        const orderId = firstOrderText(row.id, row.order_id);
        const ticketId = firstOrderText(row.ticket_id);
        if (!orderId || !ticketId) continue;
        const ticketIds = ticketIdsByOrder.get(orderId) || [];
        if (!ticketIds.includes(ticketId)) ticketIds.push(ticketId);
        ticketIdsByOrder.set(orderId, ticketIds);
      }
    } catch {
      warnings.push(`线上${kind === 'air' ? '机票' : '火车票'}列表未取得，相关订单可能被跳过`);
    }
  }
  return { ticketIdsByOrder, warnings };
}

async function pullAllCategoryOrders(tenant, accessToken, kind, range) {
  const records = [];
  for (const window of categoryOrderDateWindows(range)) {
    let pageIndex = 1;
    let totalPages = 1;
    do {
      const body = await postFenbeitongApi(tenant, `/openapi/order/${kind}/v1/list`, accessToken, {
        create_start_time: dateText(window.startDate),
        create_end_time: dateText(window.endDate),
        page_index: pageIndex,
        page_size: 500
      });
      if (!Array.isArray(body.data?.orders)) {
        throw dependencyError('FENBEITONG_ORDER_INVALID_RESPONSE', `Fenbeitong ${kind} order response must include data.orders`);
      }
      records.push(...body.data.orders);
      totalPages = Math.max(pageIndex, Number(body.data.total_pages || pageIndex));
      pageIndex += 1;
    } while (pageIndex <= totalPages);
  }
  return records;
}

function categoryOrderDateWindows(range) {
  const windows = [];
  let startDate = new Date(range.startDate);
  while (startDate <= range.endDate) {
    const endOfMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    const endDate = endOfMonth < range.endDate ? endOfMonth : new Date(range.endDate);
    windows.push({ startDate: new Date(startDate), endDate });
    startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
  }
  return windows;
}

async function pullAllTravelOrderSummaries(tenant, accessToken) {
  const records = [];
  let pageIndex = 1;
  let totalPages = 1;
  let expUuid = '';
  do {
    const body = await postFenbeitongApi(tenant, TRAVEL_ORDER_LIST_PATH, accessToken, {
      page_index: pageIndex,
      page_size: 500,
      time_interval: 10,
      ...(expUuid ? { exp_uuid: expUuid } : {})
    });
    if (!Array.isArray(body.data?.order_list)) {
      throw dependencyError('FENBEITONG_ORDER_INVALID_RESPONSE', 'Fenbeitong travel order response must include data.order_list');
    }
    records.push(...body.data.order_list);
    expUuid = String(body.data.exp_uuid || expUuid);
    totalPages = Math.max(pageIndex, Number(body.data.total_pages || pageIndex));
    pageIndex += 1;
  } while (pageIndex <= totalPages);
  return records;
}

function buildTravelOrderDetailTasks(summary, ticketIdsByOrder = new Map()) {
  const categoryType = Number(summary?.category_type);
  const kind = TRAVEL_ORDER_DETAIL_KIND[categoryType];
  if (!kind) return [];
  const basePayload = {
    order_id: requiredOrderText(summary.order_id, 'travel order order_id'),
    order_type: Number(summary.order_type || 1),
    category_type: categoryType
  };
  const summaryTicketInfos = categoryType === 7
    ? summary.air_infos
    : categoryType === 15 ? summary.train_infos : null;
  if (categoryType === 7 || categoryType === 15) {
    const ticketIds = [
      ...(Array.isArray(summaryTicketInfos) ? summaryTicketInfos.map((info) => info?.ticket_id) : []),
      ...(ticketIdsByOrder.get(String(summary.order_id)) || [])
    ].filter(Boolean);
    if (ticketIds.length === 0) return [];
    return [...new Set(ticketIds.map(String))].map((ticketId) => ({
      summary,
      path: `/openapi/order/${kind}/v1/detail`,
      payload: { ...basePayload, ticket_id: ticketId }
    }));
  }
  return [{ summary, path: `/openapi/order/${kind}/v1/detail`, payload: basePayload }];
}

function buildOnlineTravelOrderDocument(task, body) {
  const detail = body.data || {};
  const summary = task.summary;
  const order = detail.order && typeof detail.order === 'object' ? detail.order : detail;
  const payer = detail.payer && typeof detail.payer === 'object' ? detail.payer : {};
  const bookerValue = detail.booker ?? detail.order_user ?? detail.orderer ?? detail.diner ?? payer;
  const booker = bookerValue && typeof bookerValue === 'object' && !Array.isArray(bookerValue)
    ? bookerValue
    : payer;
  const saasRows = Array.isArray(detail.saas) ? detail.saas : detail.saas ? [detail.saas] : [];
  const saas = saasRows[0] || {};
  const trip = detail.trip && typeof detail.trip === 'object' ? detail.trip : {};
  const price = detail.price && typeof detail.price === 'object' ? detail.price : {};
  const amount = onlineOrderCorporateAmount(detail, price);
  if (!Number.isFinite(amount) || amount === 0) return null;
  const categoryType = Number(summary.category_type);
  const orderId = String(order.id || detail.order_id || summary.order_id);
  const createdAt = firstOrderText(order.create_time, order.origin_create_time, detail.order_create_time);
  const billNumber = firstOrderText(order.bill_code, detail.bill_no);
  const settlementMonth = monthText(billNumber);
  if (!billNumber || !settlementMonth) return null;
  const costCategory = saas.cost_category && typeof saas.cost_category === 'object' ? saas.cost_category : {};
  const department = onlineOrderDepartment(saas, booker, payer);
  const companyName = firstOrderText(booker.company_name, payer.company_name, onlineOrderCompanyControl(saas));
  const businessLine = firstOrderText(detail.business_line_name, TRAVEL_ORDER_BUSINESS_LINE[categoryType]);
  return {
    code: '0',
    msg: 'success',
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      source_origin: 'SETTLEMENT_POSTING',
      bill_no: billNumber,
      settlement_month: settlementMonth,
      currency_code: firstOrderText(detail.currency_code, 'CNY'),
      order: {
        ...detail,
        order_category: categoryType,
        order_id: orderId,
        source_order_id: String(summary.order_id),
        source_detail_id: firstOrderText(task.payload.ticket_id, orderId),
        order_create_time: createdAt,
        employee_name: firstOrderText(booker.name, payer.name),
        third_employee_id: firstOrderText(
          validEmployeeCode(booker.code),
          validEmployeeCode(payer.code),
          validEmployeeCode(booker.third_id),
          validEmployeeCode(payer.third_id)
        ),
        department_name: department.name,
        third_department_id: department.code,
        booker_department_name: department.name,
        booker_department_code: department.code,
        custom_field1: companyName,
        repayment_total_amount: amount,
        reference_deductible_total_amount: finiteOrderNumberOrNull(
          detail.reference_deductible_total_amount,
          detail.reference_deductible_amount
        ),
        reference_non_deductible_amount: finiteOrderNumberOrNull(
          detail.reference_non_deductible_amount,
          detail.reference_nondeductible_amount
        ),
        business_line_name: businessLine,
        expense_category_code: firstOrderText(costCategory.custom_code, costCategory.code),
        expense_category_name: firstOrderText(costCategory.name, businessLine),
        reason: firstOrderText(saas.order_reason, saas.order_remark, detail.reason, businessLine),
        pickup_city_name: firstOrderText(trip.start_city_name, trip.city_name),
        return_city_name: firstOrderText(trip.end_city_name),
        departure_name: firstOrderText(trip.start_city_name),
        arrival_name: firstOrderText(trip.end_city_name, trip.city_name),
        from_station_name: firstOrderText(trip.start_station, trip.start_location, trip.start_address),
        to_station_name: firstOrderText(trip.end_station, trip.end_location, trip.end_address)
      }
    }
  };
}

export function buildOnlineTravelOrderDocumentForTest(task, body) {
  return buildOnlineTravelOrderDocument(task, body);
}

function onlineOrderCorporateAmount(detail, price) {
  const direct = Number(detail.repayment_total_amount);
  if (Number.isFinite(direct)) return roundOrderMoney(direct);
  if (price.corporate_surplus !== undefined && price.corporate_surplus !== null && price.corporate_surplus !== '') {
    return roundOrderMoney(Number(price.corporate_surplus));
  }
  for (const value of [price.amount_company, price.corporate, price.order]) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return roundOrderMoney(amount);
  }
  return NaN;
}

function onlineOrderDepartment(saas, user, payer) {
  for (const attribution of Array.isArray(saas.cost_attributions) ? saas.cost_attributions : []) {
    if (Number(attribution?.type) !== 1) continue;
    const detail = (Array.isArray(attribution.details) ? attribution.details : []).find((item) => item?.name || item?.code);
    if (detail) return { code: firstOrderText(detail.code), name: firstOrderText(detail.name) };
  }
  return {
    code: firstOrderText(user.third_dept_id, user.department_id, payer.third_dept_id, payer.department_id),
    name: firstOrderText(user.department_name, payer.department_name)
  };
}

function onlineOrderCompanyControl(saas) {
  const controls = Array.isArray(saas.custom_controls) ? saas.custom_controls : [];
  const control = controls.find((item) => /公司主体|申请组织|自定义字段1/.test(String(item?.title || '')));
  return control?.detail;
}

function finiteOrderNumberOrNull(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return roundOrderMoney(amount);
  }
  return null;
}

function travelOrderDate(orderId) {
  const text = String(orderId || '');
  if (/^[0-9a-f]{24}$/i.test(text)) {
    const date = new Date(Number.parseInt(text.slice(0, 8), 16) * 1000);
    if (Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 2020 && date.getUTCFullYear() <= 2100) return date;
  }
  const compact = /^[A-Z]+(\d{2})(\d{2})(\d{2})/.exec(text);
  if (!compact) return null;
  return new Date(Date.UTC(2000 + Number(compact[1]), Number(compact[2]) - 1, Number(compact[3])));
}

function monthText(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const matched = /(20\d{2})[-/]?(0[1-9]|1[0-2])/.exec(String(value || ''));
  return matched ? `${matched[1]}${matched[2]}` : '';
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function billMonthRange(monthsBack = 2) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - Math.max(1, Number(monthsBack)) + 1, 1);
  return {
    startDate: start,
    endDate: end,
    startMonth: `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}`,
    endMonth: `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}`
  };
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function firstOrderText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function requiredOrderText(value, fieldName) {
  const text = firstOrderText(value);
  if (!text) {
    throw dependencyError('FENBEITONG_ORDER_INVALID_RESPONSE', `Fenbeitong order is missing ${fieldName}`);
  }
  return text;
}

function roundOrderMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function pullAllReimbursementSummaries(tenant, accessToken, listPayload) {
  const summaries = [];
  let pageIndex = Number(listPayload.page_index || 1);
  let totalPages = pageIndex;
  do {
    const listBody = await postFenbeitongApi(tenant, tenant.pullPath, accessToken, {
      ...listPayload,
      page_index: pageIndex
    });
    summaries.push(...extractReimbursementSummaries(listBody));
    totalPages = Math.max(pageIndex, Number(listBody.data?.total_pages || pageIndex));
    pageIndex += 1;
  } while (pageIndex <= totalPages);
  return summaries;
}

function resolveTenant(defaultTenantKey, tenantKey) {
  const key = tenantKey || defaultTenantKey || 'puhui';
  const tenant = getFenbeitongTenant(key, { includeSecrets: true });
  if (!tenant) {
    throw dependencyError('FENBEITONG_TENANT_UNKNOWN', `Fenbeitong tenant is not configured: ${key}`);
  }
  if (tenant.status === 'waiting_development') {
    throw dependencyError('FENBEITONG_TENANT_WAITING_DEVELOPMENT', `${tenant.name}接口等待开发中`);
  }
  if (tenant.status === 'disabled') {
    throw dependencyError('FENBEITONG_TENANT_DISABLED', `${tenant.name}接口已停用`);
  }
  return tenant;
}

async function resolveAccessToken(tenant) {
  if (tenant.authMode === 'access-token') {
    return tenant.accessToken;
  }
  if (tenant.accessToken && Date.parse(tenant.tokenExpiresAt || '') > Date.now()) {
    return tenant.accessToken;
  }
  const url = new URL(tenant.authPath, tenant.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: tenant.appId,
      app_key: tenant.appKey
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('FENBEITONG_AUTH_HTTP_FAILED', `Fenbeitong auth failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  if (String(body.code) !== '0') {
    throw dependencyError('FENBEITONG_AUTH_RESPONSE_FAILED', `Fenbeitong auth failed: code=${body.code}, msg=${body.msg || ''}`, {
      code: body.code,
      msg: body.msg || ''
    });
  }
  const token = typeof body.data === 'string' ? body.data : '';
  if (!token) {
    throw dependencyError('FENBEITONG_AUTH_TOKEN_MISSING', 'Fenbeitong auth response did not include data token string');
  }
  updateFenbeitongTenantToken(tenant.key, {
    accessToken: token,
    expiresAt: new Date(Date.now() + tenant.refreshIntervalSeconds * 1000).toISOString()
  });
  return token;
}

async function postFenbeitongApi(tenant, path, accessToken, payload) {
  const url = new URL(path, tenant.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/json',
      'access-token': accessToken
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('FENBEITONG_HTTP_FAILED', `Fenbeitong request failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  if (String(body.code) !== '0') {
    throw dependencyError('FENBEITONG_RESPONSE_FAILED', `Fenbeitong response failed: code=${body.code}, msg=${body.msg || ''}`, {
      code: body.code,
      msg: body.msg || ''
    });
  }
  return body;
}

function extractReimbursementSummaries(body) {
  if (Array.isArray(body.data)) {
    return body.data.flatMap((item) => (
      Array.isArray(item?.reimbursements) ? item.reimbursements : [item]
    ));
  }
  if (Array.isArray(body.data?.reimbursements)) {
    return body.data.reimbursements;
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement list response must include data.reimbursements');
}

function buildDetailRequestPayload(summary) {
  if (summary?.reimb_id) {
    return { reimb_id: summary.reimb_id };
  }
  if (summary?.reimb_code) {
    return { reimb_code: summary.reimb_code };
  }
  if (summary?.reimburse_code) {
    return { reimb_code: summary.reimburse_code };
  }
  if (summary?.id) {
    return { reimb_code: summary.id };
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement list item is missing reimb_id or reimb_code');
}

function validateDetailDocument(body) {
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail response data must be an object');
  }
  if (!body.data.reimb_id) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail is missing data.reimb_id');
  }
  if (!body.data.reimb_code) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail is missing data.reimb_code');
  }
  if (!Array.isArray(body.data.expenses)) {
    throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong reimbursement detail data.expenses must be an array');
  }
  return {
    ...body,
    data: body.data
  };
}

function hasOfflineExpenseType(document) {
  const expenses = Array.isArray(document?.data?.expenses)
    ? document.data.expenses
    : [];
  return expenses.some((expense) => [
    expense?.cost_category?.name,
    expense?.cost_category?.code,
    expense?.expense_type?.name,
    expense?.expense_type?.code
  ].some((value) => String(value || '').trim()));
}

export function hasOfflineExpenseTypeForTest(document) {
  return hasOfflineExpenseType(document);
}

function buildMockReimbursements(baseDocument, count) {
  const requesters = [
    ['PH022', '吴立珠', 'BM000006', '销售部'],
    ['PH025', '周佳丽', 'BM000006', '销售部']
  ];
  const categories = [
    ['TRAVEL', '差旅费'],
    ['OFFICE', '办公费']
  ];

  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const document = structuredClone(baseDocument);
    const requester = requesters[index % requesters.length];
    const primaryCategory = categories[index % categories.length];
    const secondaryCategory = categories[(index + 1) % categories.length];
    const primaryAmount = 80 + ((index * 37) % 900) + (index % 4) * 0.25;
    const secondaryAmount = 60 + ((index * 29) % 700) + (index % 3) * 0.5;
    const taxAmount = Number((primaryAmount * 0.06).toFixed(2));
    const totalAmount = Number((primaryAmount + secondaryAmount).toFixed(2));
    const created = new Date(Date.UTC(2026, 6, 1 + (index % 11), 1 + (index % 9), (index * 7) % 60, 0));

    document.trace_id = `trace-mock-reimbursement-${pad(sequence)}`;
    document.request_id = `request-mock-reimbursement-${pad(sequence)}`;
    document.data.reimb_id = `MOCK-REIMB-${pad(sequence)}`;
    document.data.reimb_code = `MOCK-BX-${pad(sequence)}`;
    document.data.reimb_third_id = `MOCK-THIRD-${pad(sequence)}`;
    document.data.user = {
      id: `USER-${pad(sequence)}`,
      code: requester[0],
      name: requester[1],
      department_code: requester[2],
      department_name: requester[3]
    };
    document.data.total_amount = totalAmount.toFixed(2);
    document.data.payment_amount = totalAmount.toFixed(2);
    document.data.apply_reason = `${requester[1]}${sequence}号报销`;
    document.data.create_time = formatMockTime(created);
    document.data.payment_time = formatMockTime(created);
    document.data.expense_number = 2;
    document.data.expenses = [
      {
        id: `EXP-${pad(sequence)}-01`,
        cost_category: { code: primaryCategory[0], name: primaryCategory[1] },
        total_amount: primaryAmount.toFixed(2),
        reason: `${primaryCategory[1]}报销`,
        invoices: [
          {
            id: `INV-${pad(sequence)}-01`,
            total_amount: primaryAmount.toFixed(2),
            tax_amount: taxAmount.toFixed(2),
            deductible_tax_amount: taxAmount.toFixed(2)
          }
        ]
      },
      {
        id: `EXP-${pad(sequence)}-02`,
        cost_category: { code: secondaryCategory[0], name: secondaryCategory[1] },
        total_amount: secondaryAmount.toFixed(2),
        reason: `${secondaryCategory[1]}报销`,
        invoices: []
      }
    ];
    return document;
  });
}

function pad(value) {
  return String(value).padStart(3, '0');
}

function formatMockTime(date) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')} ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}:${String(local.getUTCSeconds()).padStart(2, '0')}`;
}
