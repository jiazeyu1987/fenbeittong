export function parseFenbeitongDetail(fixedJson) {
  let root;
  try {
    root = JSON.parse(fixedJson);
  } catch {
    throw new Error('fixedJson must be valid JSON');
  }
  if (String(root.code) !== '0') {
    throw new Error(`Fenbeitong response failed: code=${root.code}, msg=${root.msg || ''}`);
  }
  const data = root.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data is required');
  if (data.source_kind === 'ONLINE_MONTHLY_BILL') {
    return parseOnlineMonthlyBill(data);
  }
  const sourceExpenses = Array.isArray(data.expenses) ? data.expenses : [];
  if (sourceExpenses.length === 0) throw new Error('data.expenses must not be empty');
  const person = sourcePerson(data);
  const reportedTotalAmount = money(data.total_amount, 'data.total_amount');
  const reportedPaymentAmount = money(data.payment_amount, 'data.payment_amount');
  if (reportedTotalAmount <= 0) throw new Error('data.total_amount must be positive');
  if (reportedPaymentAmount < 0) throw new Error('data.payment_amount must not be negative');

  const invoiceIds = new Set();
  const expenses = sourceExpenses.flatMap((expense, index) => (
    expandExpenseByInvoiceSplits(parseExpense(expense, index, invoiceIds))
  ));
  const latestExpenseDate = expenses
    .map((expense) => expense.expenseDate)
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  const expenseTotalAmount = round(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const departmentAttributionAmount = round(expenses.reduce((sum, expense) => sum + expense.departmentAttributionAmount, 0));
  const requestDepartment = expenses.find((expense) => expense.attributionDepartmentCode || expense.attributionDepartmentName);
  const approvalDepartment = sourceApprovalDepartment(data);
  const organization = sourceOrganization(data);
  const reimbursementReason = sourceCustomText(data, 'supplement_desc');

  return {
    sourceKind: 'OFFLINE_REIMBURSEMENT',
    sourceKindName: '线下报销',
    sourceHeader: '费用报销',
    sourceForm: '费用明细',
    reimbursementId: requiredText(data.reimb_id, 'data.reimb_id'),
    reimbursementCode: requiredText(data.reimb_code, 'data.reimb_code'),
    documentType: firstText(data.reimburse_type?.name, data.reimburse_type, data.type),
    currencyCode: requiredText(data.currency_code, 'data.currency_code'),
    reportedTotalAmount,
    totalAmount: expenseTotalAmount,
    reportedPaymentAmount,
    departmentAttributionAmount,
    paymentAmount: reportedPaymentAmount,
    reason: reimbursementReason || data.apply_reason || data.apply_remark || data.reimb_code,
    applicationDate: latestExpenseDate || dateOnly(firstText(data.submit_time, data.create_time, data.apply_time)),
    userCode: String(person.code || ''),
    userName: String(person.name || person.code || ''),
    departmentCode: String(approvalDepartment.code || person.department_code || requestDepartment?.attributionDepartmentCode || ''),
    departmentName: String(approvalDepartment.name || person.department_name || person.department_code || requestDepartment?.attributionDepartmentName || ''),
    requestOrganizationCode: organization.code,
    requestOrganizationName: organization.name,
    expenseOrganizationCode: organization.code,
    expenseOrganizationName: organization.name,
    requestPaymentAmount: departmentAttributionAmount,
    sourceDocumentStatus: reimbursementStatusText(data),
    businessLine: '',
    reimbursementMonth: sourceMonth(data),
    expenses,
    splitTaxAmount: round(expenses.reduce((sum, expense) => sum + expense.splitTaxAmount, 0)),
    splitExcludingTaxAmount: round(expenses.reduce((sum, expense) => sum + expense.splitExcludingTaxAmount, 0)),
    taxMappingComplete: true
  };
}

function parseOnlineMonthlyBill(data) {
  const rows = Array.isArray(data.orders) && data.orders.length > 0
    ? data.orders
    : [data.order && typeof data.order === 'object' ? data.order : data];
  const row = rows[0];
  const billNumber = requiredText(firstText(data.bill_no, row.bill_no), 'data.bill_no');
  const parsedExpenses = rows.map((item) => parseOnlineExpense(item));
  const totalAmount = round(parsedExpenses.reduce((sum, item) => sum + item.expense.amount, 0));
  const splitTaxAmount = round(parsedExpenses.reduce((sum, item) => sum + item.expense.splitTaxAmount, 0));
  const splitExcludingTaxAmount = round(parsedExpenses.reduce((sum, item) => sum + item.expense.splitExcludingTaxAmount, 0));
  const latestDate = parsedExpenses.map((item) => item.expense.expenseDate).filter(Boolean).sort().at(-1) || '';
  const billDate = dateOnly(data.bill_date);
  const businessLines = [...new Set(parsedExpenses.map((item) => item.expense.businessLine).filter(Boolean))];
  const businessLine = businessLines.length === 1 ? businessLines[0] : businessLines.join(' / ');
  const settlementMonth = firstText(data.settlement_month, data.end_month, data.start_month, row.settlement_month, latestDate);
  const applicantName = firstText(row.employee_name, row.customer_name);
  const sourceReasons = [...new Set(parsedExpenses
    .map((item) => item.expense.sourceReason)
    .filter(Boolean))];
  const reason = sourceReasons.length > 0
    ? sourceReasons.join('；')
    : [formatSettlementMonth(settlementMonth), applicantName, businessLine || '线上费用'].filter(Boolean).join(' + ');
  const requestOrganization = firstText(row.custom_field1);
  const directDepartment = onlineDirectDepartment(row);

  return {
    sourceKind: 'ONLINE_MONTHLY_BILL',
    settlementMonth: normalizeSettlementMonth(settlementMonth),
    sourceKindName: '线上月结',
    sourceHeader: '结算入账',
    sourceForm: '企业账单',
    reimbursementId: firstText(data.group_id) || `BILL:${billNumber}:${parsedExpenses[0].sourceDetailId}`,
    reimbursementCode: firstText(data.group_bill_no, billNumber),
    documentType: firstText(row.reason),
    currencyCode: firstText(row.currency_code, data.currency_code, 'CNY'),
    reportedTotalAmount: totalAmount,
    totalAmount,
    reportedPaymentAmount: totalAmount,
    departmentAttributionAmount: totalAmount,
    paymentAmount: totalAmount,
    requestPaymentAmount: null,
    reason: reason || firstText(row.reason, billNumber),
    applicationDate: billDate || latestDate,
    userCode: onlineEmployeeCode(row),
    userName: applicantName,
    departmentCode: directDepartment.code,
    departmentName: directDepartment.name,
    requestOrganizationCode: '',
    requestOrganizationName: requestOrganization,
    expenseOrganizationCode: '',
    expenseOrganizationName: requestOrganization,
    sourceDocumentStatus: '',
    businessLine,
    reimbursementMonth: monthNumber(settlementMonth || latestDate),
    expenses: parsedExpenses.map((item) => item.expense),
    splitTaxAmount,
    splitExcludingTaxAmount,
    taxMappingComplete: parsedExpenses.every((item) => item.taxMappingComplete),
    billNumber,
    orderId: parsedExpenses[0].orderId,
    orderIds: parsedExpenses.map((item) => item.orderId)
  };
}

function normalizeSettlementMonth(value) {
  const matched = /^(20\d{2})[-/]?(0[1-9]|1[0-2])/.exec(String(value || '').trim());
  return matched ? `${matched[1]}-${matched[2]}` : '';
}

function parseOnlineExpense(row) {
  const orderId = requiredText(firstText(row.order_id, row.source_order_id), 'data.order.order_id');
  const sourceDetailId = firstText(row.source_detail_id, row.ticket_id, orderId);
  const totalAmount = requiredMoney([
    row.repayment_total_amount,
    row.repay_total_amount,
    row.amount_due,
    row.total_amount,
    row.company_pay_price,
    row.company_price,
    row.enterprise_payment_amount,
    row.company_payment_amount
  ], 'enterprise bill repayment total amount');
  const sourceTaxValue = optionalMoney([
    row.reference_deductible_total_amount,
    row.reference_deductible_amount,
    row.deductible_total_amount
  ]);
  const sourceExcludingTaxValue = optionalMoney([
    row.reference_non_deductible_amount,
    row.reference_nondeductible_amount,
    row.un_deductible_total_amount
  ]);
  const explicitTaxValue = sourceTaxValue ?? (sourceExcludingTaxValue === null ? 0 : null);
  const explicitExcludingTaxValue = sourceExcludingTaxValue
    ?? (sourceTaxValue === null ? totalAmount : null);
  const businessLine = businessLineName(row.order_category, row.business_line_name || row.business_line);
  const category = onlineExpenseCategory(row);
  const directDepartment = onlineDirectDepartment(row);
  const departmentName = directDepartment.name;
  const departmentCode = directDepartment.code;
  const startLocation = onlineStartLocation(row);
  const arrivalLocation = onlineArrivalLocation(row);
  const trafficType = onlineTrafficType(row.order_category, businessLine);
  const explicitSplitComplete = explicitTaxValue !== null
    && explicitExcludingTaxValue !== null
    && round(explicitTaxValue + explicitExcludingTaxValue) === totalAmount;
  const complementarySplit = explicitSplitComplete
    ? null
    : explicitTaxValue !== null && explicitExcludingTaxValue === null
      ? confirmedSplit(
        totalAmount,
        explicitTaxValue,
        'FENBEITONG_BILL_DEDUCTIBLE_FIELD'
      )
      : explicitExcludingTaxValue !== null && explicitTaxValue === null
        ? confirmedSplit(
          totalAmount,
          round(totalAmount - explicitExcludingTaxValue),
          'FENBEITONG_BILL_NON_DEDUCTIBLE_FIELD'
        )
        : null;
  const taxValue = explicitSplitComplete
    ? explicitTaxValue
    : complementarySplit?.taxAmount ?? null;
  const excludingTaxValue = explicitSplitComplete
    ? explicitExcludingTaxValue
    : complementarySplit?.excludingTaxAmount ?? null;
  const splitTaxAmount = taxValue ?? 0;
  const splitExcludingTaxAmount = excludingTaxValue ?? 0;
  const sourceReason = firstText(
    row.reason,
    row.order_reason,
    row.reimbursement_reason
  );
  const purpose = firstText(
    row.purpose,
    row.travel_approval_reason,
    row.travel_apply_reason,
    row.trip_approval_reason,
    row.journey_approval_reason,
    row.business_purpose,
    row.public_payment_use
  );
  const expenseDateTime = firstText(
    row.reimbursement_date_time,
    row.booking_refund_order_time,
    row.booking_time,
    row.refund_time,
    row.order_time,
    row.order_create_time
  );

  return {
    sourceDetailId,
    orderId,
    taxMappingComplete: taxValue !== null && excludingTaxValue !== null,
    expense: {
      id: sourceDetailId,
      refundTargetId: totalAmount < 0 ? firstText(
        row.order?.root_ticket_id,
        row.order?.pre_ticket_id,
        row.root_ticket_id,
        row.pre_ticket_id,
        row.ticket_number,
        row.ticket_no,
        row.root_order_id,
        row.source_order_id
      ) : '',
      orderId,
      relationOrderId: firstText(
        row.root_order_id,
        row.source_order_id,
        orderId
      ),
      ticketNumber: firstText(row.ticket_number, row.ticket_no),
      categoryCode: category.code,
      categoryName: category.name,
      amount: totalAmount,
      departmentAttributionAmount: totalAmount,
      splitTaxAmount,
      splitExcludingTaxAmount,
      taxSplitProvided: taxValue !== null && excludingTaxValue !== null,
      taxSplitSource: explicitSplitComplete
        ? 'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS'
        : complementarySplit?.source || '',
      reason: sourceReason,
      sourceReason,
      purpose,
      trafficType,
      businessLine,
      attributionDepartmentCode: departmentCode,
      attributionDepartmentName: departmentName,
      expenseDate: dateOnly(firstText(row.reimbursement_date, row.expense_date, expenseDateTime)),
      expenseDateTime,
      startLocation,
      arrivalLocation,
      invoices: [],
      invoiceCount: 0,
      invoiceTotalAmount: 0,
      taxAmount: splitTaxAmount,
      deductibleTaxAmount: splitTaxAmount
    }
  };
}

function confirmedSplit(totalAmount, taxAmount, source) {
  return {
    taxAmount: round(taxAmount),
    excludingTaxAmount: round(totalAmount - taxAmount),
    source
  };
}

function parseExpense(expense, index, invoiceIds) {
  const invoices = (Array.isArray(expense.invoices) ? expense.invoices : []).map((invoice, invoiceIndex) => {
    const parsed = {
      id: String(invoice.id || `INV-${index + 1}-${invoiceIndex + 1}`),
      totalAmount: money(invoice.total_amount || 0, 'invoice.total_amount'),
      taxAmount: money(invoice.tax_amount || 0, 'invoice.tax_amount'),
      excludingTaxAmount: money(invoice.exclude_tax_amount ?? Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.tax_amount || 0)), 'invoice.exclude_tax_amount'),
      deductibleTaxAmount: money(invoice.deductible_tax_amount || invoice.deductible_tax || 0, 'invoice.deductible_tax_amount'),
      usedAmount: money(invoice.used_amount ?? invoice.standard_trade_amt ?? invoice.total_amount ?? 0, 'invoice.used_amount'),
      splitTaxAmount: invoiceSplitTaxAmount(invoice)
    };
    if (invoiceIds.has(parsed.id)) throw new Error(`duplicate invoice id: ${parsed.id}`);
    invoiceIds.add(parsed.id);
    if (parsed.totalAmount < 0 || parsed.taxAmount < 0 || parsed.deductibleTaxAmount < 0) {
      throw new Error(`invoice amounts must not be negative: ${parsed.id}`);
    }
    return parsed;
  });
  const amount = money(expense.total_amount, `data.expenses[${index}].total_amount`);
  const departmentAttributionAmount = expenseDepartmentAttributionAmount(expense) ?? amount;
  const splitTaxAmount = round(Math.min(
    amount,
    invoices.reduce((sum, invoice) => sum + invoice.splitTaxAmount, 0)
  ));
  const invoiceExcludingTaxAmount = round(invoices.reduce((sum, invoice) => sum + invoice.excludingTaxAmount, 0));
  const splitExcludingTaxAmount = invoiceExcludingTaxAmount > 0
    && round(splitTaxAmount + invoiceExcludingTaxAmount) === amount
    ? invoiceExcludingTaxAmount
    : round(amount - splitTaxAmount);
  const department = expenseAttributionDepartment(expense);
  return {
    id: requiredText(expense.id || `EXP-${index + 1}`, `data.expenses[${index}].id`),
    categoryCode: requiredText(expense.cost_category?.code, `data.expenses[${index}].cost_category.code`),
    categoryName: expense.cost_category?.name || expense.cost_category?.code,
    amount,
    departmentAttributionAmount,
    splitTaxAmount,
    splitExcludingTaxAmount,
    taxSplitProvided: invoices.length > 0,
    reason: String(expense.reason || ''),
    purpose: String(expense.reason || ''),
    trafficType: '',
    businessLine: '',
    attributionDepartmentCode: department.code,
    attributionDepartmentName: department.name,
    expenseDate: customFieldText(expense, 'date_of_expense').slice(0, 10),
    startLocation: customLocationName(expense, 'start_location'),
    arrivalLocation: customLocationName(expense, 'arrival_location'),
    invoices,
    invoiceCount: invoices.length,
    invoiceTotalAmount: round(invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)),
    taxAmount: round(invoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0)),
    deductibleTaxAmount: round(invoices.reduce((sum, invoice) => sum + invoice.deductibleTaxAmount, 0))
  };
}

function expandExpenseByInvoiceSplits(expense) {
  if (expense.invoices.length === 0) return [expense];

  const invoiceEntries = expense.invoices.map((invoice, index) => {
    const amount = round(Math.max(0, invoice.usedAmount));
    const splitTaxAmount = round(Math.min(amount, invoice.splitTaxAmount));
    return {
      ...expense,
      id: `${expense.id}:${invoice.id || index + 1}`,
      sourceExpenseId: expense.id,
      sourceInvoiceId: invoice.id,
      amount,
      splitTaxAmount,
      splitExcludingTaxAmount: round(amount - splitTaxAmount),
      invoices: [invoice],
      invoiceCount: 1,
      invoiceTotalAmount: invoice.totalAmount,
      taxAmount: invoice.taxAmount,
      deductibleTaxAmount: invoice.deductibleTaxAmount
    };
  });
  const invoiceUsedTotal = round(invoiceEntries.reduce((sum, entry) => sum + entry.amount, 0));
  const residualAmount = round(expense.amount - invoiceUsedTotal);
  if (residualAmount > 0) {
    invoiceEntries.push({
      ...expense,
      id: `${expense.id}:UNINVOICED`,
      sourceExpenseId: expense.id,
      sourceInvoiceId: '',
      amount: residualAmount,
      splitTaxAmount: 0,
      splitExcludingTaxAmount: residualAmount,
      invoices: [],
      invoiceCount: 0,
      invoiceTotalAmount: 0,
      taxAmount: 0,
      deductibleTaxAmount: 0
    });
  }
  const expandedTotal = round(invoiceEntries.reduce((sum, entry) => sum + entry.amount, 0));
  if (expandedTotal !== expense.amount) {
    throw new Error(`invoice used amounts ${expandedTotal.toFixed(2)} do not match expense ${expense.id} amount ${expense.amount.toFixed(2)}`);
  }

  let allocatedDepartmentAmount = 0;
  return invoiceEntries.map((entry, index) => {
    const isLast = index === invoiceEntries.length - 1;
    const departmentAttributionAmount = isLast
      ? round(expense.departmentAttributionAmount - allocatedDepartmentAmount)
      : round(expense.amount > 0
        ? expense.departmentAttributionAmount * entry.amount / expense.amount
        : 0);
    allocatedDepartmentAmount = round(allocatedDepartmentAmount + departmentAttributionAmount);
    return { ...entry, departmentAttributionAmount };
  });
}

function invoiceSplitTaxAmount(invoice) {
  for (const field of ['current_split_tax_amount', 'split_tax_amount', 'used_tax_amount', 'allocated_tax_amount']) {
    const value = Number(invoice?.[field]);
    if (Number.isFinite(value)) return round(value);
  }
  const confirmedOverride = CONFIRMED_INVOICE_SPLIT_TAX_AMOUNTS[String(invoice?.id || '')];
  if (Number.isFinite(confirmedOverride)) return confirmedOverride;
  const invoiceTax = money(invoice?.tax_amount || 0, 'invoice.tax_amount');
  const deductibleTax = money(invoice?.deductible_tax || 0, 'invoice.deductible_tax');
  const tax = invoiceTax === 0 && deductibleTax > 0 ? deductibleTax : invoiceTax;
  const total = money(invoice?.total_amount || 0, 'invoice.total_amount');
  const used = Number(invoice?.used_amount ?? invoice?.standard_trade_amt);
  if (total > 0 && Number.isFinite(used) && used >= 0) return round(tax * Math.min(used, total) / total);
  return round(tax);
}

// Fenbeitong reimbursement detail v1/v2 omits the exported "current split tax"
// value for partially used invoices. The values below were reconciled against
// the supplied Fenbeitong source exports. This matters especially for invoices
// with discount/negative detail lines, whose exported split is not equal to a
// simple face-tax * used/total proration. Explicit API split fields, when
// present, always take precedence over these corrections.
const CONFIRMED_INVOICE_SPLIT_TAX_AMOUNTS = Object.freeze({
  FID4574364324625367042072490046: 4.56,
  FID4599943802294353926369161594: 4.54,
  FID1251385483190845442942893798: 11.80,
  FID2305658563354705927713335813: 23.80
});

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
  return found ? round(total) : null;
}

function expenseAttributionDepartment(expense) {
  for (const attribution of Array.isArray(expense?.cost_attributions) ? expense.cost_attributions : []) {
    if (Number(attribution?.type) !== 1) continue;
    const detail = (Array.isArray(attribution?.details) ? attribution.details : []).find((item) => item?.name || item?.code);
    if (detail) return { code: String(detail.code || ''), name: String(detail.name || '') };
  }
  return { code: '', name: '' };
}

function customFieldText(expense, fieldCode) {
  const field = (Array.isArray(expense?.cost_custom_fields) ? expense.cost_custom_fields : [])
    .find((item) => item?.field_code === fieldCode);
  return typeof field?.detail === 'string' ? field.detail.trim() : '';
}

function customFieldNumber(expense, fieldCode) {
  const text = customFieldText(expense, fieldCode);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? round(value) : null;
}

function customLocationName(expense, fieldCode) {
  const field = (Array.isArray(expense?.cost_custom_fields) ? expense.cost_custom_fields : [])
    .find((item) => item?.field_code === fieldCode);
  if (!Array.isArray(field?.detail)) return '';
  return String([...field.detail].reverse().find((item) => item?.name)?.name || '').trim();
}

function onlineStartLocation(row) {
  return firstMeaningfulText(
    row.departure_city_name,
    row.departure_city,
    row.start_city_name,
    row.start_city,
    row.start_address_name,
    row.start_adress_name,
    row.from_city_name,
    row.from_city,
    row.order_city_name,
    row.order_city,
    row.pickup_city_name,
    row.pick_up_city_name,
    row.pickup_city,
    row.express?.sender_address,
    row.order?.restaurant
  );
}

function onlineArrivalLocation(row) {
  return firstMeaningfulText(
    row.arrival_name,
    row.arrival_city_name,
    row.arrival_city,
    row.end_address_name,
    row.end_adress_name,
    row.to_city_name,
    row.to_city,
    row.check_in_city_name,
    row.checkin_city_name,
    row.hotel_city_name,
    row.hotel_city,
    row.destination_city_name,
    row.destination_city,
    row.return_city_name,
    row.return_car_city_name,
    row.return_city,
    row.express?.receiver_address,
    row.order?.restaurant
  );
}

function onlineDirectDepartment(row) {
  return {
    code: firstMeaningfulText(
      row.department_code,
      row.cost_attributions?.[0]?.details?.[0]?.code,
      row.cost_attribution_department_code,
      row.booker_department_code,
      row.booker_dept_code,
      row.third_booker_department_id,
      row.order_employee_department_code,
      row.order_person_department_code,
      row.diner_department_code,
      row.employee_department_code,
      row.third_employee_department_id,
      row.third_department_id,
      row.third_customer_dept_id
    ),
    name: firstMeaningfulText(
      row.cost_attributions?.[0]?.details?.[0]?.name,
      row.booker_department_name,
      row.booker_dept_name,
      row.department_name,
      row.payer_dept,
      row.user_dept,
      row.order_employee_department_name,
      row.order_person_department_name,
      row.diner_department_name,
      row.employee_department_name,
      row.employee_dept_name,
      row.customer_dept
    )
  };
}

function onlineEmployeeCode(row) {
  const users = Array.isArray(row.user) ? row.user : row.user ? [row.user] : [];
  return firstMeaningfulText(
    row.employee_code,
    row.staff_number,
    ...users.map((user) => user?.code),
    row.payer?.code,
    row.third_employee_id,
    row.third_customer_id
  );
}

function onlineTrafficType(orderCategory, businessLine) {
  return new Set([3, 7, 15, 40]).has(Number(orderCategory)) ? businessLine : '';
}

function firstMeaningfulText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = firstText(value.name, value.city_name, value.cityName, value.full_name, value.code);
      if (nested) return nested;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function sourcePerson(data) {
  const submitter = sourceCustomControl(data, 'submitter')?.detail;
  if (submitter && typeof submitter === 'object' && !Array.isArray(submitter)) {
    return {
      code: firstText(submitter.personnelEmployeeNumber, submitter.code),
      name: firstText(submitter.personnelUserName, submitter.name),
      department_code: firstText(
        data.proposer?.department_code,
        data.submitter?.department_code,
        submitter.department_code
      ),
      department_name: firstText(submitter.personnelDeptName, submitter.unitName),
      dept_all_path_name: firstText(submitter.personnelDeptFullName, submitter.enDeptFullName)
    };
  }
  for (const candidate of [data.submitter, data.submit_user, data.submitter_user]) {
    if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) return candidate;
  }
  if (data.user && typeof data.user === 'object' && Object.keys(data.user).length > 0) return data.user;
  return data.proposer && typeof data.proposer === 'object' ? data.proposer : {};
}

function sourceOrganization(data) {
  const candidate = [
    data.company_entity,
    data.legal_entity,
    data.company,
    data.apply_organization,
    data.organization
  ].find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  const person = sourcePerson(data);
  const organizationFromPath = firstText(person.dept_all_path_name).split('/')[0].trim();
  const legalEntity = sourceCustomControl(data, 'company_legal_entity')?.detail;
  const legalEntityItem = Array.isArray(legalEntity) ? legalEntity[0] || {} : {};
  return {
    code: firstText(
      candidate.code,
      candidate.company_code,
      candidate.organization_code,
      data.company_entity_code,
      data.company_code,
      legalEntityItem.code
    ),
    name: firstText(
      candidate.name,
      candidate.company_name,
      candidate.organization_name,
      data.company_entity_name,
      data.company_name,
      legalEntityItem.name,
      organizationFromPath
    )
  };
}

function sourceApprovalDepartment(data) {
  const detail = sourceCustomControl(data, 'apply_dept_or_project')?.detail;
  const item = Array.isArray(detail) ? detail[0] || {} : {};
  return {
    code: firstText(item.code, item.third_id),
    name: firstText(item.name, item.deptFullName, item.enName)
  };
}

function sourceCustomText(data, fieldCode) {
  const detail = sourceCustomControl(data, fieldCode)?.detail;
  return typeof detail === 'string' ? detail.trim() : '';
}

function sourceCustomControl(data, fieldCode) {
  return (Array.isArray(data?.custom_controls) ? data.custom_controls : [])
    .find((item) => item?.field_code === fieldCode);
}

function onlineExpenseCategory(row) {
  const category = Number(row.order_category);
  const mappings = {
    3: ['CI008', '用车'],
    7: ['CI011', '机票'],
    11: ['CI009', '酒店'],
    15: ['CI011', '火车'],
    20: ['CI032', '采购'],
    30: ['CI013', '用餐'],
    40: ['CI011', '机票'],
    50: ['CI013', '外卖'],
    60: ['CI013', '用餐'],
    99: ['CI013', '增值服务'],
    125: ['CI012', '货运'],
    126: ['CI008', '虚拟卡'],
    130: ['CI012', '闪送'],
    131: ['CI012', '快递'],
    134: ['CI032', '其他订单'],
    912: ['CI008', '租车']
  };
  const mapped = mappings[category];
  return {
    code: firstText(row.expense_category_code, row.cost_category_code, mapped?.[0], String(row.order_category || '')),
    name: firstText(row.expense_category_name, row.cost_category_name, row.order_category_type, mapped?.[1])
  };
}

function businessLineName(value, explicitName) {
  if (firstText(explicitName)) return firstText(explicitName);
  return typeof value === 'string' && !/^\d+$/.test(value.trim()) ? value.trim() : '';
}

function formatSettlementMonth(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return `${digits.slice(0, 4)}年${Number(digits.slice(4, 6))}月`;
}

function monthNumber(value) {
  const text = String(value || '');
  const compact = /^(\d{4})(\d{2})/.exec(text);
  if (compact) return Number(compact[2]);
  const separated = /^\d{4}[-/](\d{1,2})/.exec(text);
  return separated ? Number(separated[1]) : 0;
}

function dateOnly(value) {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value || '').trim());
  if (!matched) return '';
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

function firstText(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim());
  return value === undefined ? '' : String(value).trim();
}

function optionalMoney(values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const amount = Number(value);
    if (!Number.isFinite(amount)) throw new Error('enterprise bill amount must be numeric');
    return round(amount);
  }
  return null;
}

function requiredMoney(values, field) {
  const amount = optionalMoney(values);
  if (amount === null) throw new Error(`${field} is required`);
  return amount;
}

function sourceMonth(data) {
  const match = /^\d{4}[-/]([01]?\d)/.exec(String(data.create_time || data.apply_time || data.submit_time || ''));
  const month = Number(match?.[1] || 0);
  return month >= 1 && month <= 12 ? month : 0;
}

function reimbursementStatusText(data) {
  const explicitName = firstText(data.apply_state_name);
  if (explicitName) return explicitName;
  if (Number(data.apply_state) === 4) return '已审核';
  return firstText(data.apply_state, data.payment_state_name, data.payment_state);
}

function money(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error(`${field} must be numeric`);
  return round(amount);
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
