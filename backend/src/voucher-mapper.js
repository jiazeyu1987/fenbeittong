import { createHash } from 'node:crypto';
import { loadMockKingdeeTemplateModel } from './mock-template.js';

function money(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error(`${field} must be numeric`);
  }
  return Math.round(amount * 100) / 100;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

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
  if (!data || typeof data !== 'object') {
    throw new Error('data is required');
  }

  const document = {
    reimbursementId: requireText(data.reimb_id, 'data.reimb_id'),
    reimbursementCode: requireText(data.reimb_code, 'data.reimb_code'),
    currencyCode: requireText(data.currency_code, 'data.currency_code'),
    totalAmount: money(data.total_amount, 'data.total_amount'),
    paymentAmount: money(data.payment_amount, 'data.payment_amount'),
    reason: data.apply_reason || data.reimb_code,
    userCode: data.user?.code || '',
    userName: data.user?.name || data.user?.code || '',
    departmentCode: data.user?.department_code || '',
    departmentName: data.user?.department_name || data.user?.department_code || '',
    expenses: Array.isArray(data.expenses) ? data.expenses : []
  };

  if (document.totalAmount <= 0) {
    throw new Error('data.total_amount must be positive');
  }
  if (document.paymentAmount < 0) {
    throw new Error('data.payment_amount must not be negative');
  }
  if (document.expenses.length === 0) {
    throw new Error('data.expenses must not be empty');
  }

  const invoiceIds = new Set();
  document.expenses = document.expenses.map((expense, index) => {
    const invoices = Array.isArray(expense.invoices) ? expense.invoices.map((invoice, invoiceIndex) => ({
      id: invoice.id || `INV-${index + 1}-${invoiceIndex + 1}`,
      totalAmount: money(invoice.total_amount || 0, 'invoice.total_amount'),
      taxAmount: money(invoice.tax_amount || 0, 'invoice.tax_amount'),
      deductibleTaxAmount: money(invoice.deductible_tax_amount || 0, 'invoice.deductible_tax_amount')
    })) : [];
    for (const invoice of invoices) {
      if (invoiceIds.has(invoice.id)) {
        throw new Error(`duplicate invoice id: ${invoice.id}`);
      }
      invoiceIds.add(invoice.id);
      if (invoice.totalAmount < 0) {
        throw new Error(`invoice total amount must not be negative: ${invoice.id}`);
      }
      if (invoice.taxAmount < 0) {
        throw new Error(`invoice tax amount must not be negative: ${invoice.id}`);
      }
      if (invoice.deductibleTaxAmount < 0) {
        throw new Error(`invoice deductible tax amount must not be negative: ${invoice.id}`);
      }
      if (invoice.deductibleTaxAmount > invoice.taxAmount) {
        throw new Error(`deductible tax amount for ${invoice.id} must not exceed tax amount`);
      }
    }
    return {
      id: requireText(expense.id || `EXP-${index + 1}`, `data.expenses[${index}].id`),
      categoryCode: requireText(expense.cost_category?.code, `data.expenses[${index}].cost_category.code`),
      categoryName: expense.cost_category?.name || expense.cost_category?.code,
      amount: money(expense.total_amount, `data.expenses[${index}].total_amount`),
      reason: expense.reason || document.reason,
      invoices,
      invoiceCount: invoices.length,
      invoiceTotalAmount: round(invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)),
      taxAmount: round(invoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0)),
      deductibleTaxAmount: round(invoices.reduce((sum, invoice) => sum + invoice.deductibleTaxAmount, 0))
    };
  });

  const expenseTotal = round(document.expenses.reduce((sum, expense) => sum + expense.amount, 0));
  if (expenseTotal !== document.totalAmount) {
    throw new Error(`expense total ${expenseTotal.toFixed(2)} does not match document total ${document.totalAmount.toFixed(2)}`);
  }

  return document;
}

export function buildVoucherPreview(input) {
  const config = input.config || {};
  const document = parseFenbeitongDetail(input.fixedJson);
  const voucherDate = requireText(input.voucherDate, 'voucherDate');
  const year = Number(input.year);
  const period = Number(input.period);

  if (!Number.isInteger(year) || year <= 0) {
    throw new Error('year must be a positive integer');
  }
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('period must be a positive integer');
  }
  assertVoucherDateMatchesPeriod(voucherDate, year, period);

  const currencyNumber = config.currencyNumbers?.[document.currencyCode];
  if (!currencyNumber) {
    throw new Error(`currency mapping is missing for ${document.currencyCode}`);
  }

  const lines = [];
  const lineMetas = [];
  let deductibleTaxTotal = 0;
  for (const expense of document.expenses) {
    const accountNumber = config.categoryAccountNumbers?.[expense.categoryCode];
    if (!accountNumber) {
      throw new Error(`category account mapping is missing for ${expense.categoryCode}`);
    }
    const tax = config.splitDeductibleTax ? round(expense.deductibleTaxAmount) : 0;
    deductibleTaxTotal = round(deductibleTaxTotal + tax);
    const debitAmount = round(expense.amount - tax);
    lines.push(voucherLine({
      explanation: `${document.reimbursementCode}/${expense.categoryName}`,
      accountNumber,
      currencyNumber,
      exchangeRateTypeNumber: config.exchangeRateTypeNumber,
      exchangeRate: config.exchangeRate,
      debit: debitAmount,
      credit: 0,
      detail: buildDetail(config, document)
    }));
    lineMetas.push({
      lineType: 'EXPENSE',
      sourceExpenseId: expense.id,
      sourceCategoryCode: expense.categoryCode,
      sourceCategoryName: expense.categoryName,
      sourceReason: expense.reason,
      sourceAmount: expense.amount,
      sourceTaxAmount: tax,
      mappingRule: `category ${expense.categoryCode} -> account ${accountNumber}`
    });
    if (tax > 0) {
      const taxAccountNumber = requireText(config.taxAccountNumber, 'taxAccountNumber');
      lines.push(voucherLine({
        explanation: `${document.reimbursementCode}/deductible tax`,
        accountNumber: taxAccountNumber,
        currencyNumber,
        exchangeRateTypeNumber: config.exchangeRateTypeNumber,
        exchangeRate: config.exchangeRate,
        debit: tax,
        credit: 0,
        detail: buildDetail(config, document)
      }));
      lineMetas.push({
        lineType: 'TAX',
        sourceExpenseId: expense.id,
        sourceCategoryCode: expense.categoryCode,
        sourceCategoryName: expense.categoryName,
        sourceReason: expense.reason,
        sourceAmount: expense.amount,
        sourceTaxAmount: tax,
        mappingRule: `deductible tax -> account ${taxAccountNumber}`
      });
    }
  }

  const creditAccountNumber = requireText(config.creditAccountNumber, 'creditAccountNumber');
  lines.push(voucherLine({
    explanation: `${document.reimbursementCode}/payment`,
    accountNumber: creditAccountNumber,
    currencyNumber,
    exchangeRateTypeNumber: config.exchangeRateTypeNumber,
    exchangeRate: config.exchangeRate,
    debit: 0,
    credit: document.paymentAmount,
    detail: config.creditDetailNumbers || {}
  }));
  lineMetas.push({
    lineType: 'PAYMENT',
    sourceExpenseId: 'PAYMENT',
    sourceCategoryCode: 'PAYMENT',
    sourceCategoryName: 'Payment',
    sourceReason: document.reason,
    sourceAmount: document.paymentAmount,
    sourceTaxAmount: 0,
    mappingRule: `payment -> account ${creditAccountNumber}`
  });

  const debitTotal = round(lines.reduce((sum, line) => sum + line.FDEBIT, 0));
  const creditTotal = round(lines.reduce((sum, line) => sum + line.FCREDIT, 0));
  const balanced = debitTotal === creditTotal;
  if (!balanced) {
    throw new Error(`voucher is unbalanced: debit=${debitTotal.toFixed(2)}, credit=${creditTotal.toFixed(2)}`);
  }

  const payload = {
    NeedUpDateFields: [],
    NeedReturnFields: [],
    IsDeleteEntry: 'true',
    SubSystemId: '',
    IsVerifyBaseDataField: 'false',
    IsEntryBatchFill: 'true',
    ValidateFlag: 'true',
    NumberSearch: 'true',
    IsAutoAdjustField: 'false',
    InterationFlags: '',
    IgnoreInterationFlag: '',
    IsControlPrecision: 'false',
    ValidateRepeatJson: 'false',
    Model: buildKingdeeSaveModel(config, {
      voucherDate,
      year,
      period,
      lines
    })
  };

  const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const voucherLines = lines.map((line, index) => ({
    explanation: line.FEXPLANATION,
    accountNumber: line.FACCOUNTID.FNumber,
    accountName: resolveAccountName(config, line.FACCOUNTID.FNumber),
    detailText: formatDetail(line.FDetailID),
    debit: line.FDEBIT,
    credit: line.FCREDIT,
    ...lineMetas[index]
  }));
  const invoiceCount = document.expenses.reduce((sum, expense) => sum + expense.invoiceCount, 0);
  const invoiceTaxAmount = round(document.expenses.reduce((sum, expense) => sum + expense.taxAmount, 0));
  const sourceSummary = {
    sourceId: document.reimbursementId,
    sourceCode: document.reimbursementCode,
    requester: document.userName,
    requesterCode: document.userCode,
    department: document.departmentName,
    departmentCode: document.departmentCode,
    reason: document.reason,
    currencyCode: document.currencyCode,
    totalAmount: document.totalAmount,
    paymentAmount: document.paymentAmount,
    expenseCount: document.expenses.length,
    invoiceCount,
    expenseCategories: document.expenses.map((expense) => ({
      expenseId: expense.id,
      categoryCode: expense.categoryCode,
      categoryName: expense.categoryName,
      amount: expense.amount,
      taxAmount: expense.taxAmount,
      deductibleTaxAmount: expense.deductibleTaxAmount
    }))
  };
  const taxSummary = {
    grossAmount: document.totalAmount,
    netExpenseAmount: round(document.totalAmount - deductibleTaxTotal),
    invoiceTaxAmount,
    deductibleTaxAmount: deductibleTaxTotal,
    invoiceCount,
    taxAccountNumber: config.taxAccountNumber || ''
  };
  return {
    sourceId: document.reimbursementId,
    sourceCode: document.reimbursementCode,
    marker: `FBT-${document.reimbursementCode}`,
    idempotencyKey: `FENBEITONG:REIMBURSEMENT:${document.reimbursementId}`,
    contentHash,
    debitTotal,
    creditTotal,
    totalAmount: document.totalAmount,
    deductibleTaxAmount: deductibleTaxTotal,
    balanced,
    sourceSummary,
    taxSummary,
    voucherLines,
    financialSummary: {
      sourceCode: document.reimbursementCode,
      requester: document.userName,
      department: document.departmentName,
      accountBookNumber: config.accountBookNumber,
      voucherGroupNumber: config.voucherGroupNumber,
      voucherDate,
      year,
      period,
      debitTotal,
      creditTotal,
      lineCount: voucherLines.length,
      deductibleTaxAmount: deductibleTaxTotal,
      documentStatus: 'Z',
      documentStatusName: 'Saved draft only; not submitted, audited, or posted'
    },
    payload
  };
}

function buildKingdeeSaveModel(config, draft) {
  const templateModel = resolveKingdeeTemplateModel(config);
  validateTemplateReference(
    templateModel.AccountBookID,
    requireText(config.accountBookNumber, 'accountBookNumber'),
    'Kingdee voucher template AccountBookID'
  );
  validateTemplateReference(
    templateModel.VOUCHERGROUPID,
    requireText(config.voucherGroupNumber, 'voucherGroupNumber'),
    'Kingdee voucher template VOUCHERGROUPID'
  );

  const model = structuredClone(templateModel);
  delete model.FID;
  delete model.GL_VOUCHERENTRY;
  model.Id = 0;
  model.BillNo = '';
  model.Date = draft.voucherDate;
  model.BUSDATE = draft.voucherDate;
  model.YEAR = draft.year;
  model.PERIOD = draft.period;
  model.VOUCHERGROUPNO = config.voucherGroupNo || '';
  model.DocumentStatus = 'Z';
  model.FEntity = draft.lines;
  return model;
}

function resolveKingdeeTemplateModel(config) {
  if (config.erpTemplateModel && typeof config.erpTemplateModel === 'object' && !Array.isArray(config.erpTemplateModel)) {
    return structuredClone(config.erpTemplateModel);
  }
  if (
    config.templateErpFid === '780047'
    && config.accountBookNumber === '908'
    && config.voucherGroupNumber === 'PZZ9'
  ) {
    return loadMockKingdeeTemplateModel();
  }
  throw new Error('erpTemplateModel is required for Kingdee GL_VOUCHER Save payload');
}

function validateTemplateReference(reference, expectedNumber, label) {
  const actual = referenceNumber(reference);
  if (!actual) {
    throw new Error(`${label} is required`);
  }
  if (actual !== expectedNumber) {
    throw new Error(`${label} ${actual} does not match configured number ${expectedNumber}`);
  }
}

function referenceNumber(reference) {
  if (!reference || typeof reference !== 'object') {
    return '';
  }
  return reference.FNumber || reference.Number || '';
}

function voucherLine({
  explanation,
  accountNumber,
  currencyNumber,
  exchangeRateTypeNumber,
  exchangeRate,
  debit,
  credit,
  detail
}) {
  const roundedDebit = round(debit);
  const roundedCredit = round(credit);
  return {
    FEntryID: 0,
    FEXPLANATION: explanation,
    FACCOUNTID: { FNumber: accountNumber },
    FDetailID: detail,
    FCURRENCYID: { FNumber: currencyNumber },
    FEXCHANGERATETYPE: { FNumber: requireText(exchangeRateTypeNumber, 'exchangeRateTypeNumber') },
    FEXCHANGERATE: Number(exchangeRate || 1),
    FUnitId: { FNUMBER: '' },
    FPrice: 0,
    FQty: 0,
    FAMOUNTFOR: roundedDebit || roundedCredit,
    FDEBIT: roundedDebit,
    FCREDIT: roundedCredit,
    FDC: roundedDebit > 0 ? '1' : '-1',
    FSettleTypeID: { FNumber: '' },
    FSETTLENO: '',
    FBUSNO: explanation,
    FEXPORTENTRYID: 0
  };
}

function buildDetail(config, document) {
  const detail = {};
  if (config.departmentDetailField && !document.departmentCode) {
    throw new Error('department detail dimension is required');
  }
  if (config.departmentDetailField && document.departmentCode) {
    detail[config.departmentDetailField] = { FNumber: document.departmentCode };
  }
  if (config.employeeDetailField && !document.userCode) {
    throw new Error('employee detail dimension is required');
  }
  if (config.employeeDetailField && document.userCode) {
    detail[config.employeeDetailField] = { FNumber: document.userCode };
  }
  return detail;
}

function assertVoucherDateMatchesPeriod(voucherDate, year, period) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(voucherDate);
  if (!matched) {
    throw new Error('voucherDate must use YYYY-MM-DD');
  }
  const dateYear = Number(matched[1]);
  const datePeriod = Number(matched[2]);
  if (dateYear !== year || datePeriod !== period) {
    throw new Error(`voucherDate ${voucherDate} does not match year/period ${year}/${period}`);
  }
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function resolveAccountName(config, accountNumber) {
  const accountNames = config.accountNames || {
    '6601.09': 'Travel expense',
    '6601.15': 'Office expense',
    '1002.01': 'Bank deposit',
    '2221.01.01.05': 'Input VAT',
    '1001.01': 'Cash',
    '6111': 'Investment income'
  };
  return accountNames[accountNumber] || '';
}

function formatDetail(detail) {
  return Object.entries(detail || {})
    .map(([key, value]) => `${key}:${value?.FNumber || value}`)
    .join('; ');
}
