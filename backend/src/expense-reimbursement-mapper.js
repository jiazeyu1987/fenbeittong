import { createHash } from 'node:crypto';
import { parseFenbeitongDetail } from './fenbeitong-detail.js';

const KINGDEE_EXPENSE_ITEM_NUMBERS = Object.freeze({
  TRAVEL: 'CI011',
  OFFICE: 'CI032',
  CI007: 'CI007',
  CI008: 'CI008',
  CI00801: 'CI008',
  CI00802: 'CI008',
  CI00803: 'CI008',
  CI00804: 'CI008',
  CI00805: 'CI008',
  CI009: 'CI009',
  CI010: 'CI010',
  CI012: 'CI012',
  CI013: 'CI013',
  CI014: 'CI014',
  CI016: 'CI016',
  CI017: 'CI017',
  CI019: 'CI019',
  CI020: 'CI020',
  CI021: 'CI021'
});

const REQUIRED_EMPLOYEE_NUMBERS = Object.freeze({
  PH022: 'PH022',
  PH025: 'PH025',
  X002: 'PL0147',
  X012: 'PL0223',
  X018: 'PL0198',
  X020: 'PL0145',
  X025: 'PL0098',
  X026: 'PL0205',
  X029: 'PL0221',
  X040: '0000000000001',
  '栗大志': 'PL0147',
  '刘昊': 'PL0223',
  '蒋丹': 'PL0198',
  '杜明': 'PL0145',
  '王俊': 'PL0098',
  '孙天一': 'PL0205',
  '刘俊霞': 'PL0221',
  '李雄': '0000000000001'
});

const REQUIRED_DEPARTMENT_NUMBERS = Object.freeze({
  '6463471272514': 'BM000006',
  '3867759050639': 'BM000006',
  '销售部': 'BM000006'
});

export function buildExpenseReimbursementPreview(input) {
  const config = input.config || {};
  const document = parseFenbeitongDetail(input.fixedJson);
  const documentDate = requiredDate(document.applicationDate || input.documentDate, 'documentDate');
  if (!document.taxMappingComplete) {
    throw new Error(`分贝通${document.sourceKindName}缺少图片要求的税额或不含税金额字段，已停止生成，未使用推算值`);
  }
  const employeeNumber = resolveEmployeeNumber(config, document);
  const departmentNumber = resolveDepartmentNumber(config, document);
  const requestOrgNumber = resolveOrganizationNumber(config, document.requestOrganizationCode, document.requestOrganizationName);
  const expenseOrgNumber = resolveOrganizationNumber(config, document.expenseOrganizationCode, document.expenseOrganizationName);
  const currencyNumber = requiredText(
    config.currencyNumbers?.[document.currencyCode],
    `currencyNumbers.${document.currencyCode}`
  );
  const exchangeTypeNumber = requiredText(config.exchangeRateTypeNumber, 'exchangeRateTypeNumber');
  const exchangeRate = numeric(config.exchangeRate ?? 1, 'exchangeRate');
  // Fenbeitong exports both empty reconciliation helpers and real zero-net
  // change-order rows. Keep a zero-net row when its signed tax split carries
  // accounting meaning (for example -0.03 deductible + 0.03 non-deductible),
  // and discard only rows whose gross amount and both split amounts are zero.
  const mappedExpenses = kingdeeCompatibleExpenses(
    document.expenses.filter((expense) => (
      round(expense.amount) !== 0
      || round(expense.splitTaxAmount) !== 0
      || round(expense.splitExcludingTaxAmount) !== 0
    ))
  );
  const entries = mappedExpenses.map((expense) => buildExpenseEntry({
    config,
    document,
    documentDate,
    departmentNumber: resolveExpenseDepartmentNumber(config, expense),
    currencyNumber,
    exchangeRate,
    expense
  }));
  const totalAmount = round(entries.reduce(
    (sum, entry) => sum + entry.FExpenseAmount + entry.FTaxAmt,
    0
  ));
  const taxAmount = round(entries.reduce((sum, entry) => sum + entry.FTaxAmt, 0));
  const excludingTaxAmount = round(entries.reduce((sum, entry) => sum + entry.FTaxSubmitAmt, 0));
  const hasMissingOnlineLocation = document.sourceKind === 'ONLINE_MONTHLY_BILL'
    && entries.some((entry) => !entry.F_PAEZ_Text || !entry.F_ora_Text);
  if (totalAmount !== document.totalAmount) {
    throw new Error(`expense reimbursement total ${totalAmount.toFixed(2)} does not match source ${document.totalAmount.toFixed(2)}`);
  }

  const payload = {
    NeedUpDateFields: [],
    NeedReturnFields: [],
    IsDeleteEntry: 'true',
    SubSystemId: '',
    IsVerifyBaseDataField: 'true',
    IsEntryBatchFill: 'true',
    // Fenbeitong legitimately leaves route fields blank for meals, hotels and
    // value-added services.  The Kingdee form currently marks those custom
    // fields as globally required.  Keep the source blanks intact and disable
    // only Kingdee's generic operation validation for affected online bills;
    // all source, amount and base-data validations above still run.
    ValidateFlag: hasMissingOnlineLocation ? 'false' : 'true',
    NumberSearch: 'true',
    IsAutoAdjustField: 'false',
    InterationFlags: '',
    IgnoreInterationFlag: '',
    IsControlPrecision: 'false',
    ValidateRepeatJson: 'false',
    Model: {
      FID: 0,
      // A single Fenbeitong enterprise bill is split into one reimbursement
      // per employee/month, so its original bill number cannot be used as the
      // unique Kingdee document number for every employee.  Blank tells
      // Kingdee to allocate its configured number.  The original bill number
      // remains in FCausa and the process/source metadata below.
      FBillNo: document.sourceKind === 'ONLINE_MONTHLY_BILL'
        ? ''
        : document.reimbursementCode,
      FDocumentStatus: 'Z',
      // ER_ExpReimbursement.FProposerID references the employee's staff record.
      // Unlike ordinary base-data fields, Kingdee exposes its number as
      // FStaffNumber (confirmed from the form's View response).
      FProposerID: staffReference(employeeNumber),
      FRequestDeptID: numberReference(departmentNumber),
      FExpenseDeptID: numberReference(departmentNumber),
      FExchangeRate: exchangeRate,
      FCurrencyID: numberReference(currencyNumber),
      FExchangeTypeID: numberReference(exchangeTypeNumber),
      FOrgID: numberReference(requestOrgNumber),
      FDate: documentDate,
      FExpenseOrgId: numberReference(expenseOrgNumber),
      FLocCurrencyID: numberReference(currencyNumber),
      FPayOrgId: numberReference(expenseOrgNumber),
      FCONTACTUNITTYPE: 'BD_Empinfo',
      FCONTACTUNIT: numberReference(employeeNumber),
      FBillTypeID: numberReference(config.expenseReimbursementBillTypeNumber || 'FYBXD001_SYS'),
      FRequestType: '0',
      FCombinedPay: false,
      FExpAmountSum: totalAmount,
      FLocExpAmountSum: totalAmount,
      FReqAmountSum: document.requestPaymentAmount ?? 0,
      FLocReqAmountSum: document.requestPaymentAmount ?? 0,
      FReqReimbAmountSum: totalAmount,
      FReqPayReFoundAmountSum: document.requestPaymentAmount ?? 0,
      FCausa: reimbursementReason(document),
      FPaySettlleTypeID: numberReference(config.expenseReimbursementSettlementTypeNumber || '10'),
      FRealPay: false,
      FBUSINESSTYPE: '1',
      FMultiPayee: false,
      FEntity: entries
    }
  };
  const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const expenseEntries = entries.map((entry, index) => ({
    sourceExpenseId: mappedExpenses[index].sourceExpenseId || mappedExpenses[index].id,
    sourceInvoiceId: mappedExpenses[index].sourceInvoiceId || '',
    sourceCategoryCode: mappedExpenses[index].categoryCode,
    sourceCategoryName: mappedExpenses[index].categoryName,
    expenseItemNumber: entry.FExpID.FNumber,
    expenseItemName: expenseItemName(entry.FExpID.FNumber, mappedExpenses[index].categoryName),
    reason: entry.FRemark,
    sourceReason: mappedExpenses[index].sourceReason || mappedExpenses[index].reason || '',
    expenseDate: entry.F_PAEZ_Date,
    expenseDateTime: mappedExpenses[index].expenseDateTime || '',
    startLocation: entry.F_PAEZ_Text,
    arrivalLocation: entry.F_ora_Text,
    trafficType: entry.F_PAEZ_Text1,
    purpose: entry.FRemark,
    businessLine: entry.F_ora_Text_83g,
    departmentNumber: entry.FExpenseDeptEntryID?.FNumber || '',
    expenseDepartmentName: mappedExpenses[index].attributionDepartmentName || '',
    employeeNumber,
    amount: round(mappedExpenses[index].amount),
    excludingTaxAmount: entry.FTaxSubmitAmt,
    taxAmount: entry.FTaxAmt,
    taxRate: entry.FTaxRate
  }));

  return {
    sourceId: document.reimbursementId,
    sourceIds: Array.isArray(input.sourceIds) && input.sourceIds.length > 0
      ? [...new Set(input.sourceIds.map((value) => String(value).trim()).filter(Boolean))]
      : [document.reimbursementId],
    sourceCode: document.reimbursementCode,
    sourceKind: document.sourceKind,
    sourceKindName: document.sourceKindName,
    sourceHeader: document.sourceHeader,
    sourceForm: document.sourceForm,
    marker: `FBT-${document.reimbursementCode}`,
    idempotencyKey: `FENBEITONG:EXPENSE_REIMBURSEMENT:${document.reimbursementId}`,
    contentHash,
    totalAmount,
    taxAmount,
    excludingTaxAmount,
    sourceSummary: {
      sourceId: document.reimbursementId,
      sourceCode: document.reimbursementCode,
      sourceKind: document.sourceKind,
      sourceKindName: document.sourceKindName,
      sourceHeader: document.sourceHeader,
      sourceForm: document.sourceForm,
      documentType: document.documentType,
      requester: document.userName,
      requesterCode: document.userCode,
      employeeNumber,
      department: document.departmentName,
      departmentCode: document.departmentCode,
      departmentNumber,
      reason: document.reason,
      applicationDate: document.applicationDate,
      requestOrganization: document.requestOrganizationName || document.requestOrganizationCode,
      requestOrgNumber,
      reimbursementAmount: totalAmount,
      requestPaymentAmount: document.requestPaymentAmount,
      sourceDocumentStatus: document.sourceDocumentStatus,
      expenseOrganization: document.expenseOrganizationName || document.expenseOrganizationCode,
      expenseOrgNumber,
      paymentAmount: document.paymentAmount,
      businessLine: document.businessLine,
      currencyCode: document.currencyCode,
      totalAmount,
      expenseCount: expenseEntries.length,
      invoiceCount: document.expenses.reduce((sum, expense) => sum + expense.invoiceCount, 0)
    },
    taxSummary: {
      grossAmount: totalAmount,
      excludingTaxAmount,
      taxAmount
    },
    expenseEntries,
    documentSummary: {
      formId: 'ER_ExpReimbursement',
      formName: '费用报销单',
      orgNumber: requestOrgNumber,
      requestOrgNumber,
      expenseOrgNumber,
      billTypeNumber: config.expenseReimbursementBillTypeNumber || 'FYBXD001_SYS',
      employeeNumber,
      departmentNumber,
      documentDate,
      totalAmount,
      entryCount: expenseEntries.length,
      documentStatus: 'Z',
      documentStatusName: '暂存；不提交、不审核'
    },
    payload
  };
}

function kingdeeCompatibleExpenses(expenses) {
  const merged = expenses.map((expense) => ({ ...expense }));
  const removed = new Set();
  const pendingRefunds = new Set(merged
    .map((expense, index) => round(expense.amount) < 0 ? index : -1)
    .filter((index) => index >= 0));

  // Prefer an explicit Fenbeitong ticket reference when it identifies one
  // positive line. This keeps the common one-ticket refund case as one line.
  for (const index of [...pendingRefunds]) {
    const refund = merged[index];
    const targetId = String(refund.refundTargetId || '').trim();
    if (!targetId) continue;
    const targets = positiveExpenseIndices(merged, removed)
      .filter((targetIndex) => expenseReferenceIds(merged[targetIndex]).has(targetId))
      .filter((targetIndex) => sameExpenseCategory(merged[targetIndex], refund));
    if (targets.length !== 1) continue;
    consolidateExpenseRows(merged, targets, [index], removed);
    pendingRefunds.delete(index);
  }

  // Fenbeitong dining/service refunds and multi-passenger train refunds use
  // root_order_id rather than root_ticket_id. Net every related row of the
  // same expense category as one Kingdee-compatible positive detail.
  const relatedRefundGroups = new Map();
  for (const index of pendingRefunds) {
    const refund = merged[index];
    const relationOrderId = String(refund.relationOrderId || '').trim();
    if (!relationOrderId) continue;
    const key = `${refund.categoryCode || ''}\u0000${relationOrderId}`;
    const indices = relatedRefundGroups.get(key) || [];
    indices.push(index);
    relatedRefundGroups.set(key, indices);
  }
  for (const refundIndices of relatedRefundGroups.values()) {
    const refund = merged[refundIndices[0]];
    const relationOrderId = String(refund.relationOrderId || '').trim();
    const targets = positiveExpenseIndices(merged, removed)
      .filter((targetIndex) => sameExpenseCategory(merged[targetIndex], refund))
      .filter((targetIndex) => (
        String(merged[targetIndex].relationOrderId || '').trim() === relationOrderId
        || String(merged[targetIndex].orderId || '').trim() === relationOrderId
      ));
    if (
      targets.length === 0
      || combinedExpenseAmount(merged, [...targets, ...refundIndices]) < 0
    ) continue;
    consolidateExpenseRows(merged, targets, refundIndices, removed);
    for (const index of refundIndices) pendingRefunds.delete(index);
  }

  // A refund can legitimately arrive in a later settlement bill than its
  // original order. Kingdee does not accept negative expense rows, so offset
  // such a refund against current positive rows of the same category,
  // preferring the same expense-bearing department.
  for (const refundIndex of [...pendingRefunds]) {
    const refund = merged[refundIndex];
    const sameDepartment = positiveExpenseIndices(merged, removed)
      .filter((targetIndex) => sameExpenseCategory(merged[targetIndex], refund))
      .filter((targetIndex) => sameExpenseDepartment(merged[targetIndex], refund));
    const categoryTargets = sameDepartment.length > 0
      ? sameDepartment
      : positiveExpenseIndices(merged, removed)
        .filter((targetIndex) => sameExpenseCategory(merged[targetIndex], refund));
    const targets = smallestCoveringPositiveRows(merged, categoryTargets, -round(refund.amount));
    if (targets.length === 0) {
      const targetId = String(refund.refundTargetId || refund.relationOrderId || '').trim();
      throw new Error(`金蝶不允许负费用明细，且分贝通退款 ${refund.id} 未找到对应原订单或可冲抵的同类订单 ${targetId || '-'}，已停止保存`);
    }
    consolidateExpenseRows(merged, targets, [refundIndex], removed);
    pendingRefunds.delete(refundIndex);
  }

  return merged.filter((expense, index) => !removed.has(index));
}

function positiveExpenseIndices(expenses, removed) {
  return expenses
    .map((expense, index) => ({ expense, index }))
    .filter(({ expense, index }) => !removed.has(index) && round(expense.amount) > 0)
    .map(({ index }) => index);
}

function expenseReferenceIds(expense) {
  return new Set([
    expense.id,
    expense.orderId,
    expense.relationOrderId,
    expense.ticketNumber
  ].map((value) => String(value || '').trim()).filter(Boolean));
}

function sameExpenseCategory(left, right) {
  return String(left.categoryCode || '').trim() === String(right.categoryCode || '').trim();
}

function sameExpenseDepartment(left, right) {
  const leftDepartment = String(
    left.attributionDepartmentCode || left.attributionDepartmentName || ''
  ).trim();
  const rightDepartment = String(
    right.attributionDepartmentCode || right.attributionDepartmentName || ''
  ).trim();
  return Boolean(leftDepartment && rightDepartment && leftDepartment === rightDepartment);
}

function combinedExpenseAmount(expenses, indices) {
  return round(indices.reduce((sum, index) => sum + round(expenses[index].amount), 0));
}

function smallestCoveringPositiveRows(expenses, indices, requiredAmount) {
  const sorted = [...indices].sort((left, right) => (
    round(expenses[right].amount) - round(expenses[left].amount)
  ));
  const single = sorted
    .filter((index) => round(expenses[index].amount) >= requiredAmount)
    .sort((left, right) => (
      round(expenses[left].amount) - round(expenses[right].amount)
    ))[0];
  if (single !== undefined) return [single];
  const selected = [];
  let total = 0;
  for (const index of sorted) {
    selected.push(index);
    total = round(total + round(expenses[index].amount));
    if (total >= requiredAmount) return selected;
  }
  return [];
}

function consolidateExpenseRows(expenses, targetIndices, refundIndices, removed) {
  const activeTargets = targetIndices.filter((index) => !removed.has(index));
  const activeRefunds = refundIndices.filter((index) => !removed.has(index));
  const indices = [...new Set([...activeTargets, ...activeRefunds])];
  if (activeTargets.length === 0 || activeRefunds.length === 0) return;
  const amount = round(indices.reduce((sum, index) => sum + expenses[index].amount, 0));
  const taxAmount = round(indices.reduce(
    (sum, index) => sum + expenses[index].splitTaxAmount,
    0
  ));
  const excludingTaxAmount = round(indices.reduce(
    (sum, index) => sum + expenses[index].splitExcludingTaxAmount,
    0
  ));
  if (amount < 0 || round(taxAmount + excludingTaxAmount) !== amount) {
    const refundIds = activeRefunds.map((index) => expenses[index].id).join(', ');
    throw new Error(`分贝通退款 ${refundIds} 合并后金额或税额无效，已停止保存`);
  }
  for (const index of indices) removed.add(index);
  if (amount === 0) return;
  const targetIndex = activeTargets[0];
  const target = expenses[targetIndex];
  expenses[targetIndex] = {
    ...target,
    amount,
    departmentAttributionAmount: amount,
    splitTaxAmount: taxAmount,
    splitExcludingTaxAmount: excludingTaxAmount,
    taxAmount,
    deductibleTaxAmount: taxAmount,
    mergedRefundIds: [
      ...(target.mergedRefundIds || []),
      ...activeRefunds.map((index) => expenses[index].id)
    ]
  };
  removed.delete(targetIndex);
}

function buildExpenseEntry({ config, document, documentDate, departmentNumber, currencyNumber, exchangeRate, expense }) {
  const expenseItemNumber = KINGDEE_EXPENSE_ITEM_NUMBERS[expense.categoryCode]
    || config.expenseItemNumberMappings?.[expense.categoryCode];
  if (!expenseItemNumber) {
    throw new Error(`金蝶费用项目映射缺失：${expense.categoryCode}/${expense.categoryName}`);
  }
  const amount = round(expense.amount);
  const requestAmount = document.requestPaymentAmount === null ? 0 : round(expense.departmentAttributionAmount);
  const taxAmount = round(expense.splitTaxAmount);
  const excludingTaxAmount = round(expense.splitExcludingTaxAmount);
  if (round(taxAmount + excludingTaxAmount) !== amount) {
    throw new Error(`expense split tax and excluding-tax amounts do not match gross amount: ${expense.id}`);
  }
  return {
    FExpID: numberReference(expenseItemNumber),
    // Kingdee only renders tax and net-of-tax columns for VAT invoice rows.
    // Fenbeitong invoice-backed expenses therefore use the VAT mode even
    // when an exempt/zero-rate invoice has a zero tax amount.
    FInvoiceType: expense.invoiceCount > 0 || expense.taxSplitProvided ? '1' : '0',
    // Kingdee treats the editable expense amount fields as net-of-tax and
    // adds FTaxAmt during form calculation. Sending the source gross amount
    // here would add tax twice after Save.
    FExpenseAmount: excludingTaxAmount,
    FTaxRate: excludingTaxAmount !== 0 ? round(taxAmount / excludingTaxAmount * 100) : 0,
    FTaxAmt: taxAmount,
    FTaxSubmitAmt: excludingTaxAmount,
    FExpSubmitAmount: amount,
    FRequestAmount: requestAmount,
    FReqSubmitAmount: requestAmount,
    FLocExpSubmitAmount: amount,
    FLocReqSubmitAmount: requestAmount,
    FPayedAmount: document.sourceKind === 'ONLINE_MONTHLY_BILL' ? amount : requestAmount,
    FLOCNOTAXAMOUNT: excludingTaxAmount,
    FLOCTAXAMOUNT: taxAmount,
    FExpenseDeptEntryID: optionalNumberReference(departmentNumber),
    FRemark: expense.purpose || '',
    FOriginalCurrencyId: numberReference(currencyNumber),
    // FOriginalAmount is also net-of-tax on this form; Kingdee derives the
    // tax-inclusive expense amount from it plus FTaxAmt.
    FOriginalAmount: excludingTaxAmount,
    FOriginalExRate: exchangeRate,
    F_PAEZ_Date: expense.expenseDate || (document.sourceKind === 'ONLINE_MONTHLY_BILL' ? '' : documentDate),
    F_PAEZ_Text: expense.startLocation || '',
    F_PAEZ_Text1: expense.trafficType || '',
    F_ora_Text: expense.arrivalLocation || '',
    // The customer's visible grid uses custom fields for these two columns;
    // the standard LOCNOTAXAMOUNT value alone is not rendered there.
    F_ora_Decimal_qtr: excludingTaxAmount,
    F_ora_Text_83g: expense.businessLine || document.businessLine || ''
  };
}

function resolveEmployeeNumber(config, document) {
  const number = REQUIRED_EMPLOYEE_NUMBERS[document.userCode]
    || REQUIRED_EMPLOYEE_NUMBERS[document.userName]
    || config.employeeDetailNumberMappings?.[document.userCode]
    || config.employeeDetailNumberMappings?.[document.userName];
  if (number) return number;
  if (/^X\d+$/i.test(document.userCode)) {
    const error = new Error(`金蝶员工映射缺失：${document.userName || document.userCode}（分贝通编号 ${document.userCode}），请先在金蝶员工资料中建档并配置员工编码。`);
    error.code = 'KINGDEE_EMPLOYEE_MAPPING_MISSING';
    error.detail = { userCode: document.userCode, userName: document.userName };
    throw error;
  }
  return requiredText(document.userCode, 'employee number');
}

function resolveDepartmentNumber(config, document) {
  const number = (
    REQUIRED_DEPARTMENT_NUMBERS[document.departmentCode]
      || REQUIRED_DEPARTMENT_NUMBERS[document.departmentName]
      || config.departmentDetailNumberMappings?.[document.departmentCode]
      || config.departmentDetailNumberMappings?.[document.departmentName]
      || directKingdeeDepartmentNumber(document.departmentCode)
  );
  if (number) return number;
  throw departmentMappingError(document.departmentCode, document.departmentName);
}

function resolveExpenseDepartmentNumber(config, expense) {
  if (!expense.attributionDepartmentCode && !expense.attributionDepartmentName) return '';
  const number = String(
    REQUIRED_DEPARTMENT_NUMBERS[expense.attributionDepartmentCode]
      || REQUIRED_DEPARTMENT_NUMBERS[expense.attributionDepartmentName]
      || config.departmentDetailNumberMappings?.[expense.attributionDepartmentCode]
      || config.departmentDetailNumberMappings?.[expense.attributionDepartmentName]
      || directKingdeeDepartmentNumber(expense.attributionDepartmentCode)
      || ''
  ).trim();
  if (number) return number;
  throw departmentMappingError(
    expense.attributionDepartmentCode,
    expense.attributionDepartmentName
  );
}

function directKingdeeDepartmentNumber(value) {
  const text = String(value || '').trim();
  return /^BM[A-Z0-9_-]+$/i.test(text) ? text : '';
}

function departmentMappingError(code, name) {
  const error = new Error(
    `金蝶部门映射缺失：${name || code || '-'}（分贝通部门编号 ${code || '-'}），未将分贝通第三方部门ID直接写入金蝶`
  );
  error.code = 'KINGDEE_DEPARTMENT_MAPPING_MISSING';
  error.detail = { departmentCode: code || '', departmentName: name || '' };
  return error;
}

function resolveOrganizationNumber(config, sourceCode, sourceName) {
  return requiredText(
    config.organizationNumberMappings?.[sourceCode]
      || config.organizationNumberMappings?.[sourceName]
      || sourceCode
      || config.expenseReimbursementOrgNumber
      || '886',
    'organization number'
  );
}

function reimbursementReason(document) {
  const value = `${document.reimbursementCode} ${document.reason || ''}`.trim();
  return value.slice(0, 200);
}

function expenseItemName(number, fallback) {
  const names = {
    CI007: '通讯费-个人',
    CI008: '交通费-个人',
    CI009: '住宿费-个人',
    CI010: '招待费-个人',
    CI011: '差旅费-个人',
    CI012: '快递费-个人',
    CI013: '餐费-个人',
    CI032: '办公费-非业务'
  };
  return names[number] || fallback || number;
}

function numberReference(number) {
  return { FNumber: requiredText(String(number), 'base data number') };
}

function optionalNumberReference(number) {
  return number ? numberReference(number) : null;
}

function staffReference(number) {
  return { FStaffNumber: requiredText(String(number), 'staff number') };
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function requiredDate(value, field) {
  const text = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must use YYYY-MM-DD`);
  return text;
}

function numeric(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be numeric`);
  return number;
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
