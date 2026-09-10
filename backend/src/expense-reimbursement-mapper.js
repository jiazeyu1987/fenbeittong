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
  CI011: 'CI011',
  CI012: 'CI012',
  CI013: 'CI013',
  CI014: 'CI014',
  CI016: 'CI016',
  CI017: 'CI017',
  CI019: 'CI019',
  CI020: 'CI020',
  CI021: 'CI021',
  CI022: 'CI022',
  CI032: 'CI032',
  // Fenbeitong's team-building subcategories do not have one-to-one Kingdee
  // expense items in this account set. Kingdee exposes the authoritative
  // team-activity item FYXM13_SYS for all three.
  10037: 'FYXM13_SYS',
  10039: 'FYXM13_SYS',
  10043: 'FYXM13_SYS'
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

const ONLINE_CONTACT_UNIT = Object.freeze({
  type: 'FIN_OTHERS',
  number: '01.03.034',
  // Real-mode saves replace this fallback with the exact base-data record
  // resolved for 北京分贝通科技有限公司 in the target Kingdee organization.
  name: '北京分贝通科技有限公司'
});

export function buildExpenseReimbursementPreview(input) {
  const config = input.config || {};
  const employeeBankDetails = normalizeEmployeeBankDetails(input.employeeBankDetails);
  const hasCompleteEmployeeBankDetails = Boolean(
    employeeBankDetails.openBank
    && employeeBankDetails.accountName
    && employeeBankDetails.bankAccount
  );
  const document = parseFenbeitongDetail(input.fixedJson);
  const onlineContactUnit = document.sourceKind === 'ONLINE_MONTHLY_BILL'
    ? normalizeOnlineContactUnit(input.onlineContactUnit || ONLINE_CONTACT_UNIT)
    : null;
  const documentDate = requiredDate(document.applicationDate || input.documentDate, 'documentDate');
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
  const entries = mappedExpenses.map((expense) => ({
    ...buildExpenseEntry({
      config,
      document,
      documentDate,
      departmentNumber: resolveExpenseDepartmentNumber(config, document, expense),
      currencyNumber,
      exchangeRate,
      expense
    }),
    // The desktop client's lower payment panel belongs to the current entry.
    ...(document.sourceKind === 'OFFLINE_REIMBURSEMENT' && hasCompleteEmployeeBankDetails ? {
      FBankBranch: employeeBankDetails.openBank,
      FBankAccountName: employeeBankDetails.accountName,
      FBankAccount: employeeBankDetails.bankAccount
    } : {})
  }));
  const totalAmount = round(entries.reduce((sum, entry) => sum + entry.FExpenseAmount, 0));
  const taxAmount = round(entries.reduce((sum, entry) => sum + (Number(entry.FTaxAmt) || 0), 0));
  const excludingTaxAmount = round(entries.reduce(
    (sum, entry) => sum + (Number(entry.FLOCNOTAXAMOUNT) || 0),
    0
  ));
  const requiresSourcePreservingValidationBypass = !hasCompleteEmployeeBankDetails || entries.some(
    (entry) => (
      !entry.F_PAEZ_Text
      || !entry.F_ora_Text
      || !entry.FRemark
      || (Number(entry.FTaxAmt) || 0) !== 0
    )
  );
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
    // Fenbeitong legitimately leaves route/purpose fields blank. This account
    // set also displays both FExpenseAmount and FExpSubmitAmount as the gross
    // reimbursement amount while retaining tax in its own column; Kingdee's
    // stock formula instead assumes a net expense amount and adds tax again.
    // Preserve the exact source values and bypass only those generic form
    // validations. Source amount/tax consistency and base-data checks above
    // still run before the request reaches Kingdee.
    ValidateFlag: requiresSourcePreservingValidationBypass ? 'false' : 'true',
    NumberSearch: 'true',
    // Kingdee resolves fields with base-data dependencies (for example,
    // FRequestDeptID -> FOrgID) in request order unless this is enabled.
    // New account sets reject an otherwise valid department when its
    // organization context has not been resolved first.
    IsAutoAdjustField: 'true',
    InterationFlags: '',
    IgnoreInterationFlag: '',
    IsControlPrecision: 'false',
    ValidateRepeatJson: 'false',
    Model: {
      FID: 0,
      // Only online monthly bills append the exact Kingdee employee number,
      // because their source number can be shared by multiple employees.
      FBillNo: document.sourceKind === 'ONLINE_MONTHLY_BILL'
        ? onlineEnterpriseBillNumber(input, document, employeeNumber)
        : requiredText(input.sourceCodeValue || document.reimbursementCode, 'reimbursement number'),
      FDocumentStatus: 'Z',
      // Kingdee resolves departments and employees inside their organization
      // context. Keep the organization fields before every dependent base-data
      // field because update/save parsing follows the JSON field order.
      FOrgID: numberReference(requestOrgNumber),
      FExpenseOrgId: numberReference(expenseOrgNumber),
      FPayOrgId: numberReference(expenseOrgNumber),
      FDate: documentDate,
      // ER_ExpReimbursement.FProposerID references the employee's staff record.
      // Unlike ordinary base-data fields, Kingdee exposes its number as
      // FStaffNumber (confirmed from the form's View response).
      FProposerID: staffReference(employeeNumber),
      FRequestDeptID: numberReference(departmentNumber),
      FExpenseDeptID: numberReference(departmentNumber),
      FExchangeRate: exchangeRate,
      FCurrencyID: numberReference(currencyNumber),
      FExchangeTypeID: numberReference(exchangeTypeNumber),
      FLocCurrencyID: numberReference(currencyNumber),
      // All online monthly enterprise-bill reimbursements are settled with
      // Fenbeitong's travel-service entity.  This is a real FIN_OTHERS base
      // record in account set 20260728 (number 01.03.034), not a display-only
      // default.  Offline reimbursements continue to use the employee as the
      // contact unit.
      FCONTACTUNITTYPE: document.sourceKind === 'ONLINE_MONTHLY_BILL'
        ? onlineContactUnit.type
        : 'BD_Empinfo',
      FCONTACTUNIT: numberReference(
        document.sourceKind === 'ONLINE_MONTHLY_BILL'
          ? onlineContactUnit.number
          : employeeNumber
      ),
      FBillTypeID: numberReference(config.expenseReimbursementBillTypeNumber || 'FYBXD001_SYS'),
      // Kingdee stores the "申请付款" choice in FRequestType; PayBox is only
      // the derived UI state returned by View.  Real records in this account
      // use 1 for an offline reimbursement requesting payment and 0 when no
      // payment is requested (online monthly bills).
      FRequestType: document.sourceKind === 'OFFLINE_REIMBURSEMENT' ? '1' : '0',
      FCombinedPay: false,
      FExpAmountSum: totalAmount,
      FLocExpAmountSum: totalAmount,
      FReqAmountSum: document.requestPaymentAmount ?? 0,
      FLocReqAmountSum: document.requestPaymentAmount ?? 0,
      FReqReimbAmountSum: totalAmount,
      FReqPayReFoundAmountSum: document.requestPaymentAmount ?? 0,
      FCausa: reimbursementReason(document),
      // Custom Kingdee header field "来源类型".  Keep the same source label
      // exposed by the Fenbeitong interface/dashboard instead of deriving a
      // separate ERP-only value.
      // Copy the exact 来源类型 value from the synchronized Fenbeitong row.
      // Do not derive or default this ERP field inside the mapper.
      F_ora_Text_qtr: String(input.sourceTypeValue || '').trim(),
      // Account set 20260728: settlement method number 10 is 电汇. The
      // integration requirement is fixed, so do not let environment-specific
      // defaults silently change it for individual documents.
      FPaySettlleTypeID: numberReference('10'),
      ...(employeeBankDetails.openBank ? {
        ...(document.sourceKind === 'OFFLINE_REIMBURSEMENT' ? {
          FBankBranchT: employeeBankDetails.openBank,
          FBankAccountNameT: employeeBankDetails.accountName,
          FBankAccountT: employeeBankDetails.bankAccount
        } : {
          BankBranchT: employeeBankDetails.openBank,
          BankAccountNameT: employeeBankDetails.accountName,
          BankAccountT: employeeBankDetails.bankAccount
        })
      } : {}),
      FRealPay: true,
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
    startLocation: mappedExpenses[index].startLocation || '',
    arrivalLocation: mappedExpenses[index].arrivalLocation || '',
    trafficType: mappedExpenses[index].trafficType || '',
    purpose: entry.FRemark,
    businessLine: mappedExpenses[index].businessLine || document.businessLine || '',
    departmentNumber: entry.FExpenseDeptEntryID?.FNumber || '',
    expenseDepartmentName: mappedExpenses[index].attributionDepartmentName || '',
    employeeNumber,
    amount: round(mappedExpenses[index].amount),
    excludingTaxAmount: mappedExpenses[index].splitExcludingTaxAmount === null
      ? null
      : round(mappedExpenses[index].splitExcludingTaxAmount),
    taxAmount: entry.FTaxAmt ?? null,
    taxRate: entry.FTaxRate ?? null,
    taxSplitSource: mappedExpenses[index].taxSplitSource || '',
    correctedInvalidSourceSplitFromInvoice: Boolean(
      mappedExpenses[index].correctedInvalidSourceSplitFromInvoice
    ),
    sourceSplitTaxAmount: mappedExpenses[index].sourceSplitTaxAmount ?? null,
    sourceSplitExcludingTaxAmount: mappedExpenses[index].sourceSplitExcludingTaxAmount ?? null
  }));

  return {
    sourceId: document.reimbursementId,
    sourceIds: Array.isArray(input.sourceIds) && input.sourceIds.length > 0
      ? [...new Set(input.sourceIds.map((value) => String(value).trim()).filter(Boolean))]
      : [document.reimbursementId],
    sourceCode: requiredText(input.sourceCodeValue || document.reimbursementCode, 'reimbursement number'),
    sourceKind: document.sourceKind,
    sourceKindName: document.sourceKindName,
    sourceHeader: document.sourceHeader,
    sourceForm: document.sourceForm,
    marker: `FBT-${requiredText(input.sourceCodeValue || document.reimbursementCode, 'reimbursement number')}`,
    idempotencyKey: `FENBEITONG:EXPENSE_REIMBURSEMENT:${document.reimbursementId}`,
    contentHash,
    totalAmount,
    taxAmount,
    excludingTaxAmount,
    sourceSummary: {
      sourceId: document.reimbursementId,
      sourceCode: requiredText(input.sourceCodeValue || document.reimbursementCode, 'reimbursement number'),
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
      documentStatusName: '暂存；不提交、不审核',
      contactUnitType: onlineContactUnit?.type || 'BD_Empinfo',
      contactUnitNumber: onlineContactUnit?.number || employeeNumber,
      contactUnitName: onlineContactUnit?.name || document.userName
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
  // A fully offset change/refund group can still carry a signed tax split
  // (for example +0.01 deductible tax and -0.01 excluding-tax amount).
  // Drop only a true all-zero helper group; otherwise the document-level
  // Fenbeitong tax and excluding-tax totals would drift by a cent.
  if (amount === 0 && taxAmount === 0 && excludingTaxAmount === 0) return;
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
  const hasExactSplit = expense.splitTaxAmount !== null
    && expense.splitExcludingTaxAmount !== null;
  const taxAmount = hasExactSplit ? round(expense.splitTaxAmount) : null;
  const excludingTaxAmount = hasExactSplit ? round(expense.splitExcludingTaxAmount) : null;
  if (hasExactSplit && round(taxAmount + excludingTaxAmount) !== amount) {
    const error = new Error(
      `分贝通费用明细 ${expense.id} 的可抵扣税额与未税金额之和不等于报销金额，已停止保存。`
    );
    error.code = 'FENBEITONG_SPLIT_AMOUNT_MISMATCH';
    error.detail = {
      expenseId: expense.id,
      grossAmount: amount,
      deductibleTaxAmount: taxAmount,
      excludingTaxAmount
    };
    throw error;
  }
  const exactTaxFields = hasExactSplit
    ? {
        FTaxRate: excludingTaxAmount !== 0 ? round(taxAmount / excludingTaxAmount * 100) : 0,
        FTaxAmt: taxAmount,
        FLOCNOTAXAMOUNT: excludingTaxAmount,
        FLOCTAXAMOUNT: taxAmount,
        // The customer's visible grid uses this custom field for the
        // Fenbeitong untaxed amount.
        F_ora_Decimal_qtr: excludingTaxAmount
      }
    : {};
  return {
    FExpID: numberReference(expenseItemNumber),
    // Kingdee only renders tax and net-of-tax columns for VAT invoice rows.
    // Fenbeitong invoice-backed expenses therefore use the VAT mode even
    // when an exempt/zero-rate invoice has a zero tax amount.
    // When Fenbeitong does not return the dedicated deductible-tax and
    // untaxed-amount fields, keep the ERP tax columns blank. Do not substitute
    // invoice tax or derive values proportionally.
    FInvoiceType: hasExactSplit ? '1' : '0',
    // This account set displays FExpenseAmount as "报销金额" and
    // FTaxSubmitAmt as "费用金额".  The requested accounting mapping is:
    //   报销金额 = Fenbeitong gross reimbursement amount
    //   费用金额 = Fenbeitong excluding-tax amount
    // Never derive an absent excluding-tax amount from the gross amount or
    // invoice tax; omit it when Fenbeitong did not return the dedicated value.
    FExpenseAmount: amount,
    ...(hasExactSplit ? { FTaxSubmitAmt: excludingTaxAmount } : {}),
    FExpSubmitAmount: amount,
    // ERP detail field "报销未付款金额". At the time the reimbursement is
    // created, it must carry the same authoritative Fenbeitong reimbursement
    // amount; later ERP payment operations may reduce this balance.
    FReimbNotPayAmount: amount,
    // Keep every reimbursement detail on the same telegraphic-transfer
    // settlement method as the document header. The Kingdee detail field uses
    // JSFS04_SYS, while the header field uses number 10.
    FSettlleTypeID: numberReference('JSFS04_SYS'),
    FRequestAmount: requestAmount,
    FReqSubmitAmount: requestAmount,
    FLocExpSubmitAmount: amount,
    FLocReqSubmitAmount: requestAmount,
    FPayedAmount: document.sourceKind === 'ONLINE_MONTHLY_BILL' ? amount : requestAmount,
    ...exactTaxFields,
    FExpenseDeptEntryID: optionalNumberReference(departmentNumber),
    FRemark: expense.purpose || '',
    FOriginalCurrencyId: numberReference(currencyNumber),
    FOriginalAmount: amount,
    FOriginalExRate: exchangeRate,
    // This custom field is the Fenbeitong expense-occurrence date. Do not
    // replace a missing value with the reimbursement submission/application
    // date because those dates have different accounting meaning.
    F_PAEZ_Date: expense.expenseDate || '',
    // The account set's custom route columns are nvarchar(50). Fenbeitong may
    // return a full courier street address longer than that. Keep the complete
    // source value in the synchronized document and constrain only the ERP
    // payload so Kingdee does not reject the entire reimbursement.
    F_PAEZ_Text: kingdeeCustomText(expense.startLocation, 50),
    F_PAEZ_Text1: kingdeeCustomText(expense.trafficType, 50),
    F_ora_Text: kingdeeCustomText(expense.arrivalLocation, 50),
    F_ora_Text_83g: kingdeeCustomText(
      expense.businessLine || document.businessLine,
      50
    )
  };
}

function normalizeEmployeeBankDetails(value) {
  const details = value && typeof value === 'object' ? value : {};
  const openBank = String(details.openBank || '').trim();
  const accountName = String(details.accountName || '').trim();
  const bankAccount = String(details.bankAccount || '').trim();
  if (!openBank || !accountName || !bankAccount) {
    return { openBank: '', accountName: '', bankAccount: '' };
  }
  return { openBank, accountName, bankAccount };
}

function kingdeeCustomText(value, maximumLength) {
  return [...String(value || '')].slice(0, maximumLength).join('');
}

function resolveEmployeeNumber(config, document) {
  const configuredNumber = config.employeeDetailNumberMappings?.[document.userCode]
    || config.employeeDetailNumberMappings?.[document.userName];
  const legacyNumber = config.disableRequiredEmployeeNumberMappings
    ? ''
    : REQUIRED_EMPLOYEE_NUMBERS[document.userCode]
      || REQUIRED_EMPLOYEE_NUMBERS[document.userName];
  const number = configuredNumber || legacyNumber;
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
  const number = [
    document.departmentCode,
    document.departmentName,
    ...departmentHierarchyParts(document.departmentName)
  ].map((candidate) => (
    REQUIRED_DEPARTMENT_NUMBERS[candidate]
      || config.departmentDetailNumberMappings?.[candidate]
      || directKingdeeDepartmentNumber(candidate)
      || ''
  )).find(Boolean);
  if (number) return number;
  throw departmentMappingError(document.departmentCode, document.departmentName);
}

function resolveExpenseDepartmentNumber(config, document, expense) {
  if (!expense.attributionDepartmentCode && !expense.attributionDepartmentName) return '';
  const candidates = [
    expense.attributionDepartmentCode,
    expense.attributionDepartmentName,
    ...departmentHierarchyParts(expense.attributionDepartmentName),
    document.departmentCode,
    document.departmentName,
    ...departmentHierarchyParts(document.departmentName)
  ];
  const number = candidates.map((candidate) => (
    REQUIRED_DEPARTMENT_NUMBERS[candidate]
      || config.departmentDetailNumberMappings?.[candidate]
      || directKingdeeDepartmentNumber(candidate)
      || ''
  )).find(Boolean);
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

function departmentHierarchyParts(value) {
  return String(value || '')
    .split(/[\\/／>＞]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function onlineEnterpriseBillNumber(input, document, employeeNumber) {
  const sourceNumber = requiredText(
    input.sourceCodeValue || document.reimbursementCode,
    'online enterprise bill number'
  );
  // Use the employee number resolved against Kingdee. CSVEMP-* is only a
  // local import placeholder and must never become part of an ERP bill number.
  const resolvedEmployeeNumber = requiredText(
    employeeNumber,
    'resolved Kingdee employee number'
  );
  return `${sourceNumber}-${resolvedEmployeeNumber}`;
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

function normalizeOnlineContactUnit(value) {
  return {
    type: requiredText(value?.type, 'onlineContactUnit.type'),
    number: requiredText(value?.number, 'onlineContactUnit.number'),
    name: requiredText(value?.name, 'onlineContactUnit.name')
  };
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
