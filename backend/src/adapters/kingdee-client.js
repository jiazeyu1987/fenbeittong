import { getEffectiveKingdeeConfig, validateKingdeeConfig } from '../config.js';
import { AppError, dependencyError } from '../errors.js';
import { normalizePaymentTimestamp } from '../payment-timestamp.js';
import { getKingdeeAccountSelection, getKingdeeAcctIdSelection } from '../repository.js';

const EXPENSE_REIMBURSEMENT_FORM_ID = 'ER_ExpReimbursement';
const EMPLOYEE_FORM_ID = 'BD_Empinfo';
const DEPARTMENT_FORM_ID = 'BD_Department';
const PAYMENT_BILL_FORM_ID = 'AP_PAYBILL';
const RECEIPT_FORM_ID = 'IV_ReceivedInvoice';
const BILL_QUERY_PATH = 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc';
const BUSINESS_INFO_PATH = 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.QueryBusinessInfo.common.kdsvc';
const BILL_DELETE_PATH = 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Delete.common.kdsvc';
const employeeNumberCache = new Map();
const employeeBankCache = new Map();
const departmentNumberCache = new Map();
const otherContactUnitCache = new Map();
const receiptCreations = new Map();
const receiptTypeCache = new Map();
const EMPLOYEE_CACHE_TTL_MS = 10 * 60 * 1000;

export function clearKingdeeEmployeeNumberCacheForTest() {
  employeeNumberCache.clear();
  employeeBankCache.clear();
}

export function clearKingdeeDepartmentNumberCacheForTest() {
  departmentNumberCache.clear();
}

export async function findKingdeeOtherContactUnitByName(name, options = {}) {
  const contactName = String(name || '').trim();
  if (!contactName) return null;
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') return null;
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '886').trim();
  const cacheKey = [config.baseUrl, config.acctId, orgNumber, contactName].join('|');
  const cached = otherContactUnitCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const fieldKeys = ['FId', 'FNumber', 'FName', 'FUseOrgId.FNumber'];
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: 'FIN_OTHERS',
      FieldKeys: fieldKeys.join(','),
      FilterString: [],
      OrderString: 'FId DESC',
      TopRowCount: 0,
      StartRow: 0,
      Limit: 10000
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_OTHER_CONTACT_QUERY_HTTP_FAILED',
      `Kingdee other-contact lookup failed: HTTP ${response.status}`,
      { status: response.status, contactName }
    );
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_OTHER_CONTACT_QUERY_FAILED',
      `Kingdee other-contact lookup failed: ${message || 'unknown error'}`,
      { contactName }
    );
  }
  const rows = (Array.isArray(body) ? body : []).filter((row) => (
    Array.isArray(row) && String(row[2] || '').trim() === contactName
  ));
  const exactOrg = rows.find((row) => String(row[3] || '').trim() === orgNumber);
  // Controlled base data is usable only after it has been allocated to the
  // organization that owns the reimbursement. Never fall back to a same-name
  // record from another organization: its number can resolve to a completely
  // different company in the target organization.
  const row = exactOrg || null;
  const value = row ? {
    id: Number(row[0]) || 0,
    number: String(row[1] || '').trim(),
    name: String(row[2] || '').trim(),
    useOrgNumber: String(row[3] || '').trim()
  } : null;
  otherContactUnitCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + (value ? EMPLOYEE_CACHE_TTL_MS : 60 * 1000)
  });
  return value;
}

export async function queryKingdeeExpensePaymentBills(options = {}) {
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') {
    throw new AppError(
      'KINGDEE_REAL_MODE_REQUIRED',
      'Kingdee payment bill query requires KINGDEE_MODE=real',
      422,
      { missing: ['KINGDEE_MODE=real'] }
    );
  }
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '').trim();
  if (!orgNumber) {
    throw dependencyError('KINGDEE_PAYMENT_ORG_REQUIRED', '查询金蝶付款单需要明确的付款组织。');
  }
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 2000));
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const fieldKeys = [
    'FID',
    'FBillNo',
    'FBillTypeID.FNumber',
    'FBillTypeID.FName',
    'FDATE',
    'FCONTACTUNIT.FNumber',
    'FCONTACTUNIT.FName',
    'FPAYTOTALAMOUNTFOR_H',
    'FREALPAYAMOUNTFOR_H',
    'FREMARK',
    'FSourceBillNumber',
    'FTHIRDBILLNO',
    'FBankStatus',
    'FBANKMSG',
    'FCOMMENT',
    'FPAYAMOUNTFOR_E',
    'FQQLSH',
    'FLastFinishTime',
    'FFinishTime',
    'FSRCBILLNO',
    'FPAYBILLENTRY_FEntryID'
  ];
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: PAYMENT_BILL_FORM_ID,
      FieldKeys: fieldKeys.join(','),
      FilterString: `FPAYORGID.FNumber = ${kingdeeFilterText(orgNumber)}`,
      OrderString: 'FDATE DESC,FBillNo DESC',
      TopRowCount: 0,
      StartRow: Math.max(0, Number(options.startRow) || 0),
      Limit: limit
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_PAYMENT_BILL_QUERY_HTTP_FAILED',
      `Kingdee payment bill query failed: HTTP ${response.status}`,
      { status: response.status, orgNumber }
    );
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_PAYMENT_BILL_QUERY_FAILED',
      `Kingdee payment bill query failed: ${message || 'unknown error'}`,
      { orgNumber }
    );
  }
  const rows = (Array.isArray(body) ? body : [])
    .filter(Array.isArray)
    .map((row) => paymentBillRow(fieldKeys, row));
  if (options.requireComplete && rows.length >= limit) {
    throw dependencyError('KINGDEE_PAYMENT_QUERY_TRUNCATED', '金蝶付款单查询达到明细行上限，无法完整核对付款关系。');
  }
  return aggregatePaymentBills(rows);
}

export async function queryKingdeeSuccessfulExpensePaymentBills(options = {}) {
  const bills = await queryKingdeeExpensePaymentBills(options);
  return bills.filter((bill) => bill.bankStatusCode === 'C');
}

export async function findKingdeeEmployeeNumberByName(name, options = {}) {
  const employeeName = String(name || '').trim();
  if (!employeeName) return '';
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') return '';
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '886').trim();
  const cacheKey = [config.baseUrl, config.acctId, orgNumber, employeeName].join('|');
  const cached = employeeNumberCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.number;

  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: EMPLOYEE_FORM_ID,
      FieldKeys: 'FID,FStaffNumber,FName,FUseOrgId.FNumber',
      FilterString: [{
        Left: '(',
        FieldName: 'FName',
        Compare: '67',
        Value: employeeName,
        Right: ')',
        Logic: 0
      }],
      OrderString: 'FID DESC',
      TopRowCount: 0,
      StartRow: 0,
      Limit: 50
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_EMPLOYEE_QUERY_HTTP_FAILED', `Kingdee employee lookup failed: HTTP ${response.status}`, {
      status: response.status,
      employeeName
    });
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError('KINGDEE_EMPLOYEE_QUERY_FAILED', `Kingdee employee lookup failed: ${message || 'unknown error'}`, {
      employeeName
    });
  }
  const numbers = [...new Set((Array.isArray(body) ? body : [])
    .filter((row) => Array.isArray(row) && String(row[2] || '').trim() === employeeName)
    .map((row) => String(row[1] || '').trim())
    .filter(Boolean))];
  if (numbers.length > 1) {
    throw dependencyError(
      'KINGDEE_EMPLOYEE_NAME_AMBIGUOUS',
      `金蝶存在多个姓名为“${employeeName}”且员工编号不同的员工，请配置明确的员工编号。`,
      { employeeName, employeeNumbers: numbers }
    );
  }
  const number = numbers[0] || '';
  employeeNumberCache.set(cacheKey, {
    number,
    expiresAt: Date.now() + EMPLOYEE_CACHE_TTL_MS
  });
  return number;
}

export async function viewKingdeeEmployeeByNumber(employeeNumber, options = {}) {
  const number = String(employeeNumber || '').trim();
  if (!number) throw new Error('Kingdee employee number is required');
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '886').trim();
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const response = await postKingdeeJsonWrapper(config, config.viewPath, {
    formid: EMPLOYEE_FORM_ID,
    data: JSON.stringify({ Number: number, Id: '', CreateOrgId: 0 })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_EMPLOYEE_VIEW_HTTP_FAILED', `Kingdee employee view failed: HTTP ${response.status}`);
  }
  const status = body?.Result?.ResponseStatus;
  if (status && !status.IsSuccess) {
    throw dependencyError('KINGDEE_EMPLOYEE_VIEW_FAILED', `Kingdee employee view failed: ${statusMessage(status) || 'unknown error'}`);
  }
  return body?.Result?.Result || {};
}

export function extractKingdeeEmployeeBankDetails(employeeModel) {
  const rows = Array.isArray(employeeModel?.EmpinfoBank)
    ? employeeModel.EmpinfoBank
    : [];
  const candidates = rows.map((row) => ({
    openBank: localizedText(row?.OpenBankName),
    accountName: String(row?.BankHolder || '').trim(),
    bankAccount: String(row?.BankCode || '').trim(),
    isDefault: Boolean(row?.IsDefault)
  }));
  const complete = candidates.filter((row) =>
    row.openBank && row.accountName && row.bankAccount);
  return complete.find((row) => row.isDefault) || complete[0] || {
    openBank: '',
    accountName: '',
    bankAccount: '',
    isDefault: false
  };
}

export async function getKingdeeEmployeeBankDetails(employeeNumber, options = {}) {
  const number = String(employeeNumber || '').trim();
  if (!number) return extractKingdeeEmployeeBankDetails({});
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const orgNumber = String(options.orgNumber || '886').trim();
  const cacheKey = [accountKey, acctIdKey, orgNumber, number].join('|');
  const cached = employeeBankCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.details;
  const details = extractKingdeeEmployeeBankDetails(
    await viewKingdeeEmployeeByNumber(number, {
      accountKey,
      acctIdKey,
      orgNumber
    })
  );
  employeeBankCache.set(cacheKey, {
    details,
    expiresAt: Date.now() + EMPLOYEE_CACHE_TTL_MS
  });
  return details;
}

export async function findKingdeeDepartmentNumberByName(name, options = {}) {
  const departmentName = String(name || '').trim();
  if (!departmentName) return '';
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') return '';
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '886').trim();
  const cacheKey = [config.baseUrl, config.acctId, orgNumber, departmentName].join('|');
  const cached = departmentNumberCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.number;

  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: DEPARTMENT_FORM_ID,
      FieldKeys: 'FDEPTID,FNumber,FName,FUseOrgId.FNumber',
      FilterString: [{
        Left: '(',
        FieldName: 'FName',
        Compare: '67',
        Value: departmentName,
        Right: ')',
        Logic: 0
      }],
      OrderString: 'FDEPTID DESC',
      TopRowCount: 0,
      StartRow: 0,
      Limit: 50
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_DEPARTMENT_QUERY_HTTP_FAILED',
      `金蝶部门查询失败：HTTP ${response.status}`,
      { status: response.status, departmentName }
    );
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError(
      'KINGDEE_DEPARTMENT_QUERY_FAILED',
      `金蝶部门查询失败：${message || '未知错误'}`,
      { departmentName }
    );
  }
  const numbers = [...new Set((Array.isArray(body) ? body : [])
    .filter((row) => Array.isArray(row)
      && String(row[2] || '').trim() === departmentName
      && String(row[3] || '').trim() === orgNumber)
    .map((row) => String(row[1] || '').trim())
    .filter(Boolean))];
  if (numbers.length > 1) {
    throw dependencyError(
      'KINGDEE_DEPARTMENT_NAME_AMBIGUOUS',
      `金蝶存在多个名称为“${departmentName}”且编号不同的部门，请配置明确的部门编号。`,
      { departmentName, departmentNumbers: numbers }
    );
  }
  const number = numbers[0] || '';
  departmentNumberCache.set(cacheKey, {
    number,
    expiresAt: Date.now() + EMPLOYEE_CACHE_TTL_MS
  });
  return number;
}

export async function viewKingdeeExpenseReimbursement(erpFid, options = {}) {
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    String(options.orgNumber || '886')
  );
  return viewSavedExpenseReimbursement(config, authSession, erpFid);
}

export async function resolveKingdeeExpenseReimbursementFid(erpFid, billNumber, options) {
  const { accountKey, acctIdKey, orgNumber } = options;
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await switchKingdeeOrganization(config, await loginKingdee(config), orgNumber);
  try {
    await viewSavedExpenseReimbursement(config, authSession, erpFid);
    return Number(erpFid);
  } catch (error) {
    if (error.code !== 'KINGDEE_VIEW_FAILED'
      || !isMissingExpenseReimbursement({ Errors: [{ Message: error.message }] })) throw error;
  }
  return findExpenseReimbursementFidByNumber(config, authSession, billNumber);
}

export async function queryKingdeeExpenseReimbursementHeaders(options = {}) {
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const orgNumber = String(options.orgNumber || '886').trim();
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 10000));
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    orgNumber
  );
  const fieldKeys = [
    'FID',
    'FBillNo',
    'FDocumentStatus',
    'FCreatorId.FName',
    'FCreateDate',
    'F_ora_Text_qtr'
  ];
  const fids = options.fids?.map(Number).filter(positiveId);
  if (fids && fids.length === 0) return [];
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: EXPENSE_REIMBURSEMENT_FORM_ID,
      FieldKeys: fieldKeys.join(','),
      FilterString: fids ? `FID in (${fids.join(',')})` : [],
      OrderString: 'FCreateDate DESC,FBillNo DESC',
      TopRowCount: 0,
      StartRow: Math.max(0, Number(options.startRow) || 0),
      Limit: limit
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_EXPENSE_REIMBURSEMENT_QUERY_HTTP_FAILED',
      `Kingdee expense reimbursement query failed: HTTP ${response.status}`,
      { status: response.status, orgNumber }
    );
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_EXPENSE_REIMBURSEMENT_QUERY_FAILED',
      `Kingdee expense reimbursement query failed: ${message || 'unknown error'}`,
      { orgNumber }
    );
  }
  if (fids && (!Array.isArray(body) || body.some((row) => !Array.isArray(row)
    || !fids.includes(Number(row[0])) || !String(row[1] || '').trim()))) {
    throw dependencyError('KINGDEE_BILL_QUERY_RESPONSE_INVALID', '金蝶单据核对结果异常，暂无法确认保存状态。');
  }
  return (Array.isArray(body) ? body : [])
    .filter(Array.isArray)
    .map((row) => Object.fromEntries(fieldKeys.map((key, index) => [key, row[index]])));
}

export async function updateKingdeeExpenseReimbursementSourceType(erpFid, sourceTypeValue, options = {}) {
  const fid = Number(erpFid);
  const value = String(sourceTypeValue || '').trim();
  if (!positiveId(fid) || !value) {
    throw new Error('Kingdee source type update requires a valid FID and non-empty source value');
  }
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    String(options.orgNumber || '886')
  );
  const before = await viewSavedExpenseReimbursement(config, authSession, fid);
  const beforeModel = before?.Result?.Result || {};
  if (sameText(beforeModel.F_ora_Text_qtr, value)) {
    return { erpFid: String(fid), sourceTypeValue: value, unchanged: true };
  }
  if (String(beforeModel.F_ora_Text_qtr || '').trim()) {
    throw dependencyError(
      'KINGDEE_SOURCE_TYPE_NOT_EMPTY',
      `Kingdee expense reimbursement ${fid} already has a different source type`,
      { erpFid: String(fid), actual: String(beforeModel.F_ora_Text_qtr), expected: value }
    );
  }
  const body = await postExpenseReimbursementSave(config, authSession, {
    NeedUpDateFields: ['F_ora_Text_qtr'],
    NeedReturnFields: [],
    IsDeleteEntry: 'false',
    SubSystemId: '',
    IsVerifyBaseDataField: 'false',
    IsEntryBatchFill: 'false',
    // This operation changes only one header text field on historical bills.
    // Do not revalidate unrelated legacy entry formulas or bank fields.
    ValidateFlag: 'false',
    NumberSearch: 'true',
    IsAutoAdjustField: 'true',
    InterationFlags: '',
    IgnoreInterationFlag: '',
    IsControlPrecision: 'false',
    ValidateRepeatJson: 'false',
    Model: {
      FID: fid,
      F_ora_Text_qtr: value
    }
  });
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_SOURCE_TYPE_UPDATE_FAILED',
      `Kingdee expense reimbursement source type update failed: ${message || 'unknown error'}`,
      { erpFid: String(fid), sourceTypeValue: value }
    );
  }
  const after = await viewSavedExpenseReimbursement(config, authSession, fid);
  const actual = String(after?.Result?.Result?.F_ora_Text_qtr || '').trim();
  if (!sameText(actual, value)) {
    throw dependencyError(
      'KINGDEE_SOURCE_TYPE_UPDATE_MISMATCH',
      'Kingdee expense reimbursement source type update was not persisted',
      { erpFid: String(fid), expected: value, actual }
    );
  }
  return { erpFid: String(fid), sourceTypeValue: actual, unchanged: false };
}

export async function updateKingdeeExpenseReimbursementContactUnit(
  erpFid,
  contactUnit,
  options = {}
) {
  const fid = Number(erpFid);
  const type = String(contactUnit?.type || '').trim();
  const number = String(contactUnit?.number || '').trim();
  const name = String(contactUnit?.name || '').trim();
  const contactUnitId = Number(contactUnit?.id) || 0;
  if (!positiveId(fid) || !type || (!number && !positiveId(contactUnitId))) {
    throw new Error('Kingdee contact-unit update requires a valid FID, type and number');
  }
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    String(options.orgNumber || '886')
  );
  const before = await viewSavedExpenseReimbursement(config, authSession, fid);
  const beforeModel = before?.Result?.Result || {};
  if (
    sameText(beforeModel.CONTACTUNITTYPE, type)
    && (positiveId(contactUnitId)
      ? Number(beforeModel.CONTACTUNIT_Id) === contactUnitId
      : sameText(beforeModel.CONTACTUNIT?.Number, number))
    && (!name || sameText(localizedText(beforeModel.CONTACTUNIT?.Name), name))
  ) {
    return { erpFid: String(fid), type, number, unchanged: true };
  }
  const body = await postExpenseReimbursementSave(config, authSession, {
    NeedUpDateFields: ['FCONTACTUNITTYPE', 'FCONTACTUNIT'],
    NeedReturnFields: [],
    IsDeleteEntry: 'false',
    SubSystemId: '',
    IsVerifyBaseDataField: 'true',
    IsEntryBatchFill: 'false',
    ValidateFlag: 'false',
    NumberSearch: positiveId(contactUnitId) ? 'false' : 'true',
    IsAutoAdjustField: 'true',
    InterationFlags: '',
    IgnoreInterationFlag: '',
    IsControlPrecision: 'false',
    ValidateRepeatJson: 'false',
    Model: {
      FID: fid,
      FCONTACTUNITTYPE: type,
      FCONTACTUNIT: positiveId(contactUnitId)
        ? { Id: contactUnitId }
        : { FNumber: number }
    }
  });
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_CONTACT_UNIT_UPDATE_FAILED',
      `Kingdee expense reimbursement contact-unit update failed: ${message || 'unknown error'}`,
      { erpFid: String(fid), type, number }
    );
  }
  const after = await viewSavedExpenseReimbursement(config, authSession, fid);
  const afterModel = after?.Result?.Result || {};
  const actualType = String(afterModel.CONTACTUNITTYPE || '').trim();
  const actualNumber = String(afterModel.CONTACTUNIT?.Number || '').trim();
  const actualName = localizedText(afterModel.CONTACTUNIT?.Name);
  const actualId = Number(afterModel.CONTACTUNIT_Id) || 0;
  if (
    !sameText(actualType, type)
    || (positiveId(contactUnitId)
      ? actualId !== contactUnitId
      : !sameText(actualNumber, number))
    || (name && !sameText(actualName, name))
  ) {
    throw dependencyError(
      'KINGDEE_CONTACT_UNIT_UPDATE_MISMATCH',
      'Kingdee expense reimbursement contact-unit update was not persisted',
      {
        erpFid: String(fid),
        expectedType: type,
        expectedId: contactUnitId,
        expectedNumber: number,
        expectedName: name,
        actualType,
        actualId,
        actualNumber,
        actualName
      }
    );
  }
  return {
    erpFid: String(fid),
    type: actualType,
    number: actualNumber,
    unchanged: false
  };
}

export async function saveKingdeeExpenseReimbursement(payload, options = {}) {
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') {
    throw new AppError(
      'KINGDEE_REAL_MODE_REQUIRED',
      'Kingdee expense reimbursement save requires KINGDEE_MODE=real; mock save is disabled',
      422,
      { missing: ['KINGDEE_MODE=real'] }
    );
  }

  validateKingdeeConfig(accountKey, acctIdKey);
  const accountOrgNumber = referenceNumber(payload?.Model?.FOrgID);
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    accountOrgNumber
  );
  let activePayload = payload;
  let existingBillBeforeOverwrite = null;
  let existingView;
  const { receipts, receiptWarnings } = await planKingdeeReceipts(
    config, authSession, accountOrgNumber, options.receiptInvoices || []
  );
  const requestedFid = Number(activePayload?.Model?.FID);
  const requestedBillNumber = String(activePayload?.Model?.FBillNo || '').trim();
  if (!positiveId(requestedFid) && requestedBillNumber) {
    const existingFid = await findExpenseReimbursementFidByNumber(
      config,
      authSession,
      requestedBillNumber
    );
    if (options.requiredExistingFid && existingFid !== options.requiredExistingFid) {
      throw dependencyError('KINGDEE_EXISTING_BILL_CHANGED', `金蝶原单 ${requestedBillNumber} 已发生变化，请重新核对。`);
    }
    if (positiveId(existingFid)) {
      existingView = await viewSavedExpenseReimbursement(config, authSession, existingFid);
      if (options.requiredExistingFid
        && !sameText(existingView.Result.Result.BillNo || existingView.Result.Result.FBillNo, requestedBillNumber)) {
        throw dependencyError('KINGDEE_EXISTING_BILL_CHANGED', `金蝶原单 ${requestedBillNumber} 的单号已发生变化，请重新核对。`);
      }
      if (matchesExistingExpenseReimbursement(activePayload, existingView)
        && receipts.every((receipt) => receipt.id && linkedReceiptIds(existingView).has(receipt.id))) {
        const existingModel = existingView.Result.Result;
        return {
          simulated: false,
          mode: 'real',
          mockReplacement: false,
          mockReason: '',
          recoveredExistingBill: true,
          receiptWarnings,
          erpFid: String(existingModel.Id || existingModel.FID || existingFid),
          erpNumber: String(existingModel.BillNo || existingModel.FBillNo || requestedBillNumber),
          documentStatus: existingModel.DocumentStatus || existingModel.FDocumentStatus || 'Z',
          rawResponse: { view: existingView }
        };
      }
      const existingModel = existingView.Result.Result;
      const existingStatus = existingModel.DocumentStatus || existingModel.FDocumentStatus;
      if (existingStatus && !['Z', 'A', 'D'].includes(String(existingStatus))) {
        throw dependencyError(
          'KINGDEE_EXISTING_BILL_LOCKED',
          `金蝶原单 ${requestedBillNumber} 内容与分贝通不同，且当前状态不可更新。请财务核对原单及其状态。`,
          { billNumber: requestedBillNumber, erpFid: String(existingFid), documentStatus: existingStatus }
        );
      }
      if (!options.allowExistingBillOverwrite) {
        throw dependencyError(
          'KINGDEE_EXISTING_BILL_MISMATCH',
          `金蝶已存在费用报销单 ${requestedBillNumber}，但原单内容与工作台本次生成的数据不一致。请先在金蝶核对原单。`,
          { billNumber: requestedBillNumber, erpFid: String(existingFid) }
        );
      }
      existingBillBeforeOverwrite = existingView;
      activePayload = structuredClone(payload);
      activePayload.Model.FID = existingFid;
    }
  }
  if (options.receiptOnly && receipts.length === 0) {
    if (receiptWarnings.length > 0 && positiveId(requestedFid)) {
      const view = await viewSavedExpenseReimbursement(config, authSession, requestedFid);
      const model = view.Result.Result;
      if (String(model.BillNo || model.FBillNo || '') !== requestedBillNumber) {
        throw dependencyError('KINGDEE_RECEIPT_UPDATE_TARGET_MISMATCH', '收票补录的单号与金蝶原单不一致。');
      }
      validateExpensePaymentBankFields(activePayload, view);
      return {
        simulated: false,
        mode: 'real',
        mockReplacement: false,
        receiptWarnings,
        erpFid: String(requestedFid),
        erpNumber: requestedBillNumber,
        documentStatus: model.DocumentStatus || model.FDocumentStatus || 'Z',
        rawResponse: { view }
      };
    }
    throw dependencyError('KINGDEE_RECEIPT_UPDATE_TARGET_REQUIRED', '补录收票需要完整的来源发票。');
  }
  if (receipts.length > 0) {
    const targetFid = Number(activePayload.Model.FID);
    if (!existingView && positiveId(targetFid)) {
      existingView = await viewSavedExpenseReimbursement(config, authSession, targetFid).catch((error) => {
        if (error.code === 'KINGDEE_VIEW_FAILED' && /不存在|已删除|未找到/.test(error.message)) return null;
        throw error;
      });
    }
    if (options.receiptOnly && !existingView) {
      throw dependencyError('KINGDEE_RECEIPT_UPDATE_TARGET_REQUIRED', '未找到金蝶原单，已停止补录收票。');
    }
    const existingStatus = existingView?.Result?.Result?.DocumentStatus
      ?? existingView?.Result?.Result?.FDocumentStatus;
    if (existingView && !['Z', 'A', 'D'].includes(String(existingStatus))
      && receipts.some((receipt) => !linkedReceiptIds(existingView).has(receipt.id))) {
      throw dependencyError('KINGDEE_RECEIPT_REIMBURSEMENT_LOCKED', '金蝶原单当前状态无法补录收票信息，请由财务确认可编辑后重试。');
    }
    for (const receipt of receipts) {
      if (!receipt.id) receipt.id = await ensureKingdeeReceipt(config, authSession, receipt);
    }
    activePayload = structuredClone(activePayload);
    const links = new Map(receiptViewEntries(existingView)
      .filter((row) => positiveId(row.RecInv_Id || row.RecInv?.Id))
      .map((row) => [String(row.RecInv_Id || row.RecInv.Id), row.Id]));
    for (const { id } of receipts) {
      if (!links.has(id)) links.set(id, null);
    }
    activePayload.Model.FRecInvInfo = [...links].map(([id, entryId]) => ({
      ...(positiveId(entryId) ? { FEntryID: entryId } : {}),
      FRecInv: { FID: Number(id) }
    }));
  }
  const savePayload = options.receiptOnly ? {
    ...activePayload,
    NeedUpDateFields: ['FRecInvInfo', 'FRecInv'],
    IsDeleteEntry: 'false',
    Model: {
      FID: activePayload.Model.FID,
      FRecInvInfo: activePayload.Model.FRecInvInfo
    }
  } : activePayload;
  let body = await postExpenseReimbursementSave(config, authSession, savePayload);
  let status = body?.Result?.ResponseStatus;
  let recoveredMissingTarget = false;
  let savedWithoutRequestPayment = false;
  if (!options.receiptOnly && !status?.IsSuccess && isMissingEmployeeBankDetails(status)) {
    activePayload = expenseReimbursementWithoutRequestPayment(activePayload);
    body = await postExpenseReimbursementSave(config, authSession, activePayload);
    status = body?.Result?.ResponseStatus;
    savedWithoutRequestPayment = Boolean(status?.IsSuccess);
  }
  if (!status?.IsSuccess && isNetworkControlConflict(status)) {
    const existingFid = Number(activePayload?.Model?.FID);
    if (positiveId(existingFid)) {
      const existingView = await viewSavedExpenseReimbursement(config, authSession, existingFid);
      if (matchesExistingExpenseReimbursement(activePayload, existingView)
        && receipts.every((receipt) => linkedReceiptIds(existingView).has(receipt.id))) {
        const existingModel = existingView.Result.Result;
        return {
          simulated: false,
          mode: 'real',
          mockReplacement: false,
          mockReason: '',
          recoveredMissingTarget: false,
          recoveredNetworkControlConflict: true,
          receiptWarnings,
          erpFid: String(existingModel.Id || existingModel.FID || existingFid),
          erpNumber: String(existingModel.BillNo || existingModel.FBillNo || activePayload.Model.FBillNo),
          documentStatus: existingModel.DocumentStatus || existingModel.FDocumentStatus || 'Z',
          rawResponse: { save: body, view: existingView }
        };
      }
    }
    throw networkControlConflictError(activePayload, status);
  }
  if (!options.receiptOnly && !options.requiredExistingFid && !status?.IsSuccess
    && isMissingExpenseReimbursement(status) && positiveId(activePayload?.Model?.FID)) {
    activePayload = structuredClone(payload);
    activePayload.Model.FID = await findExpenseReimbursementFidByNumber(
      config,
      authSession,
      activePayload.Model.FBillNo
    );
    if (receipts.length > 0) {
      activePayload.Model.FRecInvInfo = receipts.map(({ id }) => ({ FRecInv: { FID: Number(id) } }));
    }
    body = await postExpenseReimbursementSave(config, authSession, activePayload);
    status = body?.Result?.ResponseStatus;
    recoveredMissingTarget = true;
  }
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    if (message?.includes('申请日期应大于申请组织启用日期')) {
      const applicationDate = String(activePayload?.Model?.FDate || '').slice(0, 10);
      const enableDate = message.match(/申请组织启用日期\s*(20\d{2}-\d{2}-\d{2})/)?.[1] || '';
      throw dependencyError(
        'KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE',
        `申请日期 ${applicationDate || '-'} 早于金蝶申请组织费用管理启用日期 ${enableDate || '-'}，已跳过；程序保留了分贝通申请日期。`,
        {
          applicationDate,
          enableDate,
          orgNumber: accountOrgNumber,
          kingdeeMessage: message
        }
      );
    }
    if (message?.includes('组织未启用费用管理')) {
      throw dependencyError(
        'KINGDEE_EXPENSE_MANAGEMENT_NOT_ENABLED',
        `金蝶组织 ${accountOrgNumber || '-'} 尚未启用费用管理；请在金蝶“财务会计 → 费用管理 → 初始化”中设置该申请组织的启用日期并完成初始化后重试`,
        { orgNumber: accountOrgNumber, kingdeeMessage: message }
      );
    }
    throw dependencyError('KINGDEE_SAVE_FAILED', `Kingdee expense reimbursement save failed: ${message || 'unknown error'}`);
  }
  const identifiers = saveIdentifiers(body);
  if (!identifiers.erpFid || !identifiers.erpNumber) {
    throw dependencyError('KINGDEE_SAVE_RESPONSE_INVALID', 'Kingdee expense reimbursement save response missing Id or Number');
  }
  if (options.receiptOnly && (identifiers.erpFid !== String(activePayload.Model.FID)
    || identifiers.erpNumber !== activePayload.Model.FBillNo)) {
    throw dependencyError('KINGDEE_RECEIPT_UPDATE_TARGET_MISMATCH', '收票补录返回的单号或内码与金蝶原单不一致。');
  }
  const viewBody = await viewSavedExpenseReimbursement(config, authSession, identifiers.erpFid);
  try {
    validateExpensePaymentBankFields(activePayload, viewBody);
    const actualReceiptIds = linkedReceiptIds(viewBody);
    if (receipts.some((receipt) => !actualReceiptIds.has(receipt.id))) {
      throw dependencyError(
        'KINGDEE_RECEIPT_LINK_MISMATCH',
        '金蝶已保存报销单，但回读缺少应关联的收票单。请更新原单重试。',
        {}
      );
    }
  } catch (error) {
    error.detail.savedResult = {
      ...identifiers,
      mode: 'real',
      simulated: false,
      mockReplacement: false,
      documentStatus: viewBody?.Result?.Result?.DocumentStatus
        || viewBody?.Result?.Result?.FDocumentStatus || 'Z',
      rawResponse: { save: body, view: viewBody }
    };
    throw error;
  }
  let verificationWarning = '';
  try {
    validateSavedExpenseReimbursementTarget(activePayload, viewBody);
  } catch (error) {
    // Kingdee has already returned a successful save with a persistent FID and
    // bill number. A detail-only verification difference must not discard that
    // successful result or cause the caller to create a duplicate document.
    if (error?.code !== 'KINGDEE_SAVE_LINE_MISMATCH') throw error;
    verificationWarning = error.message;
  }
  return {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    mockReason: '',
    recoveredMissingTarget,
    savedWithoutRequestPayment,
    verificationWarning,
    receiptWarnings,
    erpFid: identifiers.erpFid,
    erpNumber: identifiers.erpNumber,
    documentStatus: viewBody?.Result?.Result?.FDocumentStatus
      || viewBody?.Result?.Result?.DocumentStatus
      || 'Z',
    overwroteExistingBill: Boolean(existingBillBeforeOverwrite),
    rawResponse: {
      save: body,
      view: viewBody,
      existingBeforeOverwrite: existingBillBeforeOverwrite
    }
  };
}

function receiptViewEntries(view) {
  const entries = view?.Result?.Result?.RecInvInfo;
  return Array.isArray(entries) ? entries : [];
}

function linkedReceiptIds(view) {
  return new Set(receiptViewEntries(view).map((row) => String(row.RecInv_Id || row.RecInv?.Id || '')));
}

async function planKingdeeReceipts(config, authSession, orgNumber, invoices) {
  const missing = new Set();
  const receipts = new Map();
  if (invoices.length === 0) return { receipts: [], receiptWarnings: [] };
  let typeMappings;
  try {
    const configured = JSON.parse(process.env.KINGDEE_RECEIPT_INVOICE_TYPES || '{}');
    if (!configured || Array.isArray(configured) || typeof configured !== 'object') throw new Error();
    typeMappings = configured;
  } catch {
    throw dependencyError('KINGDEE_RECEIPT_TYPE_CONFIG_INVALID', '金蝶发票类别配置必须为 JSON 对象。');
  }
  let categories;
  for (const invoice of invoices) {
    const number = String(invoice.number || '').trim();
    if (number.split(/[,，;；/|、]/).filter((part) => part.trim()).length > 1) {
      missing.add('同一格合并了多个发票号码，收票信息待补。请提供逐张发票数据后更新单据。');
      continue;
    }
    if (!number || number.length > 50 || /[\s,，;；/|、]/.test(number)) {
      missing.add('缺少有效的单张发票号码，请补充逐张发票数据。');
      continue;
    }
    const required = [
      ['发票代码', invoice.code || (/^\d{20}$/.test(number) ? true : '')],
      ['开票日期', invoice.issuedDate], ['销售方名称', invoice.sellerName],
      ['税额', Number.isFinite(invoice.taxAmount)], ['不含税金额', Number.isFinite(invoice.excludingTaxAmount)],
      ['价税合计', Number.isFinite(invoice.totalAmount)]
    ].filter(([, value]) => !value).map(([label]) => label);
    if (required.length) {
      missing.add(`发票 ${number} 缺少${required.join('、')}。`);
      continue;
    }
    const type = [invoice.typeCode, invoice.typeName].find((key) => key && Object.hasOwn(typeMappings, key));
    const caption = receiptTypeCaption(invoice.typeName || invoice.typeCode, number);
    let typeNumber = type ? String(typeMappings[type]).trim() : '';
    if (!typeNumber && caption) {
      categories ||= await readKingdeeReceiptTypes(config, authSession);
      typeNumber = categories.get(caption) || '';
    }
    if (!/^\d+$/.test(typeNumber)) {
      missing.add(`发票 ${number} 的票种“${invoice.typeName || invoice.typeCode || '来源未提供'}”无法映射到金蝶发票类别。`);
      continue;
    }
    const model = {
      FIVCODE: invoice.code || '',
      FIVNUMBER: number,
      FOPENDATE: invoice.issuedDate,
      FSALENAME: invoice.sellerName,
      ...(invoice.buyerName ? { FPURNAME: invoice.buyerName } : {}),
      FSUMTAXAMOUNT: invoice.taxAmount,
      FSUMAMOUNT: invoice.excludingTaxAmount,
      FSUMALLAMOUNT: invoice.totalAmount,
      FINVOICETYPE: typeNumber
    };
    const key = JSON.stringify([invoice.code, invoice.number]);
    if (receipts.has(key)) {
      if (JSON.stringify(receipts.get(key).model) !== JSON.stringify(model)) {
        throw dependencyError('KINGDEE_RECEIPT_SOURCE_CONFLICT', `来源发票 ${invoice.number} 的票面信息不一致。`);
      }
      continue;
    }
    receipts.set(key, { model, orgNumber, id: '' });
  }
  for (const receipt of receipts.values()) {
    receipt.id = await findKingdeeReceipt(config, authSession, receipt);
  }
  return { receipts: [...receipts.values()], receiptWarnings: [...missing] };
}

function receiptTypeCaption(value, number) {
  const name = String(value || '').trim().replaceAll('(', '（').replaceAll(')', '）');
  const digital = /^\d{20}$/.test(number);
  switch (name) {
    case '增值税电子普通发票':
    case '电子发票（增值税普通发票）':
    case '电子发票（普通发票）':
      return digital ? '全电普通发票' : '电子普通发票';
    case '电子发票（增值税专用发票）':
      return digital ? '全电专用发票' : '电子发票专票';
    case '电子发票（铁路电子客票）':
    case '电子发票（铁路电子客票退票费发票）':
      return '电子铁路客票';
    case '电子发票（普通发票-通行费）':
      return '数电通行费发票';
    case '其他票据':
      return '其他';
    case '电子发票（航空运输电子客票行程单）':
      return '电子航空客票';
    case '出租车发票':
      return '的士票';
    case '客运汽车票':
      return '客运发票';
    default:
      return name;
  }
}

async function readKingdeeReceiptTypes(config, authSession) {
  const key = JSON.stringify([config.baseUrl, config.acctId, config.accountKey]);
  const cached = receiptTypeCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.types;
  const response = await postKingdeeJsonWrapper(config, BUSINESS_INFO_PATH, {
    formid: RECEIPT_FORM_ID,
    data: JSON.stringify({ FormId: RECEIPT_FORM_ID })
  }, authSession);
  const body = await response.json();
  const field = body?.Result?.NeedReturnData?.Entrys?.flatMap((entity) => entity.Fields || [])
    .find((item) => item.Key === 'FINVOICETYPE');
  const types = new Map((Array.isArray(field?.Extends) ? field.Extends : [])
    .filter((item) => item.Invalid === false && item.Caption && /^\d+$/.test(String(item.Value)))
    .map((item) => [item.Caption, String(item.Value)]));
  if (!response.ok || types.size === 0) {
    throw dependencyError('KINGDEE_RECEIPT_TYPE_LOOKUP_FAILED', '无法读取金蝶收票单的发票类别，请核对账套权限或配置票种映射。');
  }
  receiptTypeCache.set(key, { types, expiresAt: Date.now() + EMPLOYEE_CACHE_TTL_MS });
  return types;
}

async function findKingdeeReceipt(config, authSession, receipt, savedId = '') {
  const { model, orgNumber } = receipt;
  const fields = Object.keys(model);
  const filter = positiveId(savedId)
    ? `FID = ${kingdeeFilterText(savedId)}`
    : `FIVNUMBER = ${kingdeeFilterText(model.FIVNUMBER)} AND FSOURCEORGID.FNumber = ${kingdeeFilterText(orgNumber)}`;
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: RECEIPT_FORM_ID,
      FieldKeys: ['FID', 'FSOURCEORGID.FNumber', ...fields].join(','),
      FilterString: filter,
      Limit: 100
    })
  }, authSession);
  const rows = await response.json();
  if (!response.ok || !Array.isArray(rows) || rows.some((row) => !Array.isArray(row) || !positiveId(row[0]))) {
    throw dependencyError('KINGDEE_RECEIPT_QUERY_FAILED', '金蝶收票单查询失败，请检查接口权限。');
  }
  const matches = rows.filter((row) => (!savedId || sameText(row[0], savedId)) && sameText(row[1], orgNumber)
    && sameText(row[2], model.FIVCODE) && sameText(row[3], model.FIVNUMBER));
  if (matches.length === 0) return '';
  if (matches.length > 1 || fields.some((field, index) => {
    const expected = model[field];
    if (expected === '' || expected === null) return false;
    return typeof expected === 'number'
      ? !String(matches[0][index + 2] ?? '').trim() || !sameMoney(matches[0][index + 2], expected)
      : !sameText(matches[0][index + 2], expected, field === 'FOPENDATE');
  })) {
    throw dependencyError(
      'KINGDEE_RECEIPT_CONFLICT',
      `金蝶收票单与来源发票 ${model.FIVNUMBER} 的票面信息不一致或匹配到多张，已停止关联。`
    );
  }
  return String(matches[0][0]);
}

async function ensureKingdeeReceipt(config, authSession, receipt) {
  const { model, orgNumber } = receipt;
  const key = JSON.stringify([config.baseUrl, config.acctId, orgNumber, model.FIVCODE, model.FIVNUMBER]);
  const pending = receiptCreations.get(key);
  if (pending) {
    const savedId = await pending;
    return readBackKingdeeReceipt(config, authSession, receipt, savedId);
  }
  const creation = (async () => {
    const existing = await findKingdeeReceipt(config, authSession, receipt);
    if (existing) return existing;
    const response = await postKingdeeJsonWrapper(config, config.savePath, {
      formid: RECEIPT_FORM_ID,
      data: JSON.stringify({
        NumberSearch: 'true',
        Model: {
          FID: 0,
          FSOURCEORGID: { FNumber: orgNumber },
          FSETTLEORGID: { FNumber: orgNumber },
          ...Object.fromEntries(Object.entries(model).filter(([, value]) => value !== null && value !== ''))
        }
      })
    }, authSession);
    const body = await response.json();
    if (!response.ok || !body?.Result?.ResponseStatus?.IsSuccess) {
      throw dependencyError(
        'KINGDEE_RECEIPT_SAVE_FAILED',
        `金蝶收票单 ${model.FIVNUMBER} 保存失败：${statusMessage(body?.Result?.ResponseStatus) || response.status}`
      );
    }
    return readBackKingdeeReceipt(config, authSession, receipt, saveIdentifiers(body).erpFid);
  })();
  receiptCreations.set(key, creation);
  try {
    return await creation;
  } finally {
    receiptCreations.delete(key);
  }
}

async function readBackKingdeeReceipt(config, authSession, receipt, savedId) {
  const receiptId = positiveId(savedId) ? String(savedId) : '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await retryDelay(attempt);
    const id = await findKingdeeReceipt(config, authSession, receipt, receiptId);
    if (id) return id;
  }
  throw dependencyError(
    'KINGDEE_RECEIPT_READBACK_FAILED',
    `发票 ${receipt.model.FIVNUMBER} 的收票单已提交保存，但暂未查到可核验的记录。`,
    { invoiceNumber: receipt.model.FIVNUMBER, receiptId }
  );
}

function kingdeeFilterText(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function isMissingEmployeeBankDetails(status) {
  const message = statusMessage(status);
  const bankFields = [
    '\u5f00\u6237\u94f6\u884c',
    '\u8d26\u6237\u540d\u79f0',
    '\u94f6\u884c\u8d26\u53f7'
  ];
  return bankFields.every((field) => message.includes(field))
    && message.includes('\u5b57\u6bb5\u5fc5\u5f55');
}

function expenseReimbursementWithoutRequestPayment(payload) {
  const adjusted = structuredClone(payload);
  const model = adjusted?.Model;
  if (!model || typeof model !== 'object') return adjusted;
  // Keep FRealPay untouched. Only the payment-request choice depends on the
  // employee bank archive; real reimbursement can still be stored in Kingdee.
  model.FRequestType = '0';
  model.FReqAmountSum = 0;
  model.FLocReqAmountSum = 0;
  model.FReqPayReFoundAmountSum = 0;
  for (const entry of Array.isArray(model.FEntity) ? model.FEntity : []) {
    entry.FRequestAmount = 0;
    entry.FReqSubmitAmount = 0;
    entry.FLocReqSubmitAmount = 0;
  }
  return adjusted;
}

export function expenseReimbursementWithoutRequestPaymentForTest(payload) {
  return expenseReimbursementWithoutRequestPayment(payload);
}

export async function deleteKingdeeExpenseReimbursement(erpFid, options = {}) {
  const fid = Number(erpFid);
  if (!positiveId(fid)) {
    throw new Error('Kingdee expense reimbursement delete requires a valid FID');
  }
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await switchKingdeeOrganization(
    config,
    await loginKingdee(config),
    String(options.orgNumber || '886')
  );
  const view = await viewSavedExpenseReimbursement(config, authSession, fid);
  const model = view?.Result?.Result;
  const status = String(model?.DocumentStatus || model?.FDocumentStatus || '').trim();
  if (!model || !['A', 'Z'].includes(status)) {
    throw dependencyError(
      'KINGDEE_DELETE_NOT_DRAFT',
      `Kingdee expense reimbursement ${fid} is not a draft and cannot be safely replaced`,
      { erpFid: String(fid), documentStatus: status }
    );
  }
  const response = await postKingdeeJsonWrapper(config, BILL_DELETE_PATH, {
    formid: EXPENSE_REIMBURSEMENT_FORM_ID,
    data: JSON.stringify({
      CreateOrgId: 0,
      Numbers: [],
      Ids: String(fid),
      NetworkCtrl: '',
      IgnoreInterationFlag: ''
    })
  }, authSession);
  const body = await response.json();
  const responseStatus = body?.Result?.ResponseStatus;
  if (!response.ok || !responseStatus?.IsSuccess) {
    const message = responseStatus?.Errors
      ?.map((error) => error.Message || error.FieldName)
      .filter(Boolean)
      .join('; ');
    throw dependencyError(
      'KINGDEE_DELETE_FAILED',
      `Kingdee expense reimbursement ${fid} delete failed: ${message || `HTTP ${response.status}`}`,
      { erpFid: String(fid), documentStatus: status }
    );
  }
  return {
    erpFid: String(fid),
    erpNumber: String(model.BillNo || model.FBillNo || ''),
    documentStatus: status,
    rawResponse: body
  };
}

async function postExpenseReimbursementSave(config, authSession, payload) {
  const response = await postKingdeeJsonWrapper(config, config.savePath, {
    formid: EXPENSE_REIMBURSEMENT_FORM_ID,
    data: JSON.stringify(payload)
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_HTTP_FAILED', `Kingdee expense reimbursement save failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  return body;
}

async function findExpenseReimbursementFidByNumber(config, authSession, billNumber) {
  const number = String(billNumber || '').trim();
  if (!number) {
    throw dependencyError(
      'KINGDEE_MISSING_TARGET_RECOVERY_FAILED',
      'Kingdee expense reimbursement recovery requires FBillNo'
    );
  }
  const response = await postKingdeeJsonWrapper(config, BILL_QUERY_PATH, {
    data: JSON.stringify({
      FormId: EXPENSE_REIMBURSEMENT_FORM_ID,
      FieldKeys: 'FID,FBillNo',
      FilterString: [{
        Left: '(',
        FieldName: 'FBillNo',
        Compare: '67',
        Value: number,
        Right: ')',
        Logic: 0
      }],
      OrderString: 'FID DESC',
      TopRowCount: 0,
      StartRow: 0,
      Limit: 2
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_BILL_QUERY_HTTP_FAILED',
      `Kingdee expense reimbursement lookup failed: HTTP ${response.status}`,
      { status: response.status, billNumber: number }
    );
  }
  const queryError = body?.[0]?.[0]?.Result?.ResponseStatus;
  if (queryError && !queryError.IsSuccess) {
    const message = queryError.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError(
      'KINGDEE_BILL_QUERY_FAILED',
      `Kingdee expense reimbursement lookup failed: ${message || 'unknown error'}`,
      { billNumber: number }
    );
  }
  if (!Array.isArray(body) || body.some((row) => !Array.isArray(row)
    || !positiveId(row[0]) || String(row[1] || '').trim() !== number)) {
    throw dependencyError('KINGDEE_BILL_QUERY_RESPONSE_INVALID', '金蝶单号查询结果异常，无法确认原单是否存在。');
  }
  const matches = body;
  if (matches.length > 1) {
    throw dependencyError(
      'KINGDEE_DUPLICATE_BILL_NUMBER',
      `Kingdee contains multiple expense reimbursements with number ${number}; automatic recovery stopped`,
      { billNumber: number, fids: matches.map((row) => String(row[0] || '')) }
    );
  }
  if (matches.length === 0) return 0;
  return Number(matches[0][0]);
}

function isMissingExpenseReimbursement(status) {
  const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ') || '';
  return message.includes('数据在系统中不存在')
    && message.includes('t_ER_ExpenseReimb');
}

function isNetworkControlConflict(status) {
  const message = statusMessage(status);
  return status?.ErrorCode === 13
    || message.includes('使用业务单据') && message.includes('业务操作') && message.includes('冲突');
}

function networkControlConflictError(payload, status) {
  const message = statusMessage(status);
  const owner = /[“"]([^”"]+)[”"]使用业务单据/.exec(message)?.[1] || '其他账号';
  const billNumber = String(payload?.Model?.FBillNo || '').trim() || '-';
  return dependencyError(
    'KINGDEE_NETWORK_CONTROL_CONFLICT',
    `金蝶费用报销单 ${billNumber} 正在被账号 ${owner} 编辑，暂时无法重新保存。请在金蝶中关闭该单据的编辑页面（或退出账号 ${owner}）后重试。`,
    { billNumber, lockOwner: owner, kingdeeMessage: message }
  );
}

function matchesExistingExpenseReimbursement(payload, viewBody) {
  const expectedModel = payload?.Model || {};
  const actualModel = viewBody?.Result?.Result || {};
  if (paymentBankMismatches(expectedModel, actualModel).length > 0) return false;
  const expectedBillNumber = String(expectedModel.FBillNo || '').trim();
  if (expectedBillNumber && String(actualModel.BillNo || actualModel.FBillNo || '').trim()
    !== expectedBillNumber) return false;
  for (const [expected, actual] of [
    [expectedModel.FOrgID, actualModel.OrgID || actualModel.FOrgID],
    [expectedModel.FProposerID, actualModel.ProposerID || actualModel.FProposerID],
    [expectedModel.FRequestDeptID, actualModel.RequestDeptID || actualModel.FRequestDeptID],
    [expectedModel.FBillTypeID, actualModel.BillTypeID || actualModel.FBillTypeID]
  ]) {
    const expectedNumber = referenceNumber(expected);
    if (expectedNumber && referenceNumber(actual) !== expectedNumber) return false;
  }
  if (!sameMoney(actualModel.ExpAmountSum ?? actualModel.FExpAmountSum, expectedModel.FExpAmountSum)) return false;
  if (!sameText(actualModel.F_ora_Text_qtr, expectedModel.F_ora_Text_qtr)) return false;
  // PayBox/RefundBox are transient UI properties.  Kingdee persists the
  // payment choice in RequestType (field key FRequestType).
  if (!sameText(actualModel.RequestType ?? actualModel.FRequestType, expectedModel.FRequestType)) return false;
  if (!sameBoolean(actualModel.FRealPay, expectedModel.FRealPay)) return false;

  const expectedEntries = Array.isArray(expectedModel.FEntity) ? expectedModel.FEntity : [];
  const actualEntries = Array.isArray(actualModel.ER_ExpenseReimbEntry)
    ? actualModel.ER_ExpenseReimbEntry
    : Array.isArray(actualModel.FEntity) ? actualModel.FEntity : [];
  return matchesExpenseReimbursementEntries(expectedEntries, actualEntries);
}

function paymentBankMismatches(expected, actual) {
  if (String(expected.FRequestType) !== '1') return [];
  const mismatches = [
    ['FBankBranchT', 'BankBranchT', '开户银行'],
    ['FBankAccountNameT', 'BankAccountNameT', '账户名称'],
    ['FBankAccountT', 'BankAccountT', '银行账号']
  ].filter(([key, property]) => Object.hasOwn(expected, key)
    && !sameText(actual[property], expected[key]))
    .map(([field, , label]) => ({ field, label }));
  for (const [index, entry] of (expected.FEntity || []).entries()) {
    const actualEntry = actual.ER_ExpenseReimbEntry?.[index] || {};
    for (const [key, property, label] of [
      ['FBankBranch', 'BankBranch', '开户银行'],
      ['FBankAccountName', 'BankAccountName', '账户名称'],
      ['FBankAccount', 'BankAccount', '银行账号']
    ]) {
      if (Object.hasOwn(entry, key) && !sameText(actualEntry[property], entry[key])) {
        mismatches.push({ field: `FEntity[${index}].${key}`, label: `第${index + 1}条明细${label}` });
      }
    }
  }
  return mismatches;
}

export function validateExpensePaymentBankFields(payload, viewBody) {
  const mismatches = paymentBankMismatches(payload?.Model || {}, viewBody?.Result?.Result || {});
  if (mismatches.length) {
    throw dependencyError(
      'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH',
      `金蝶单据已保存，但付款页签字段校验失败：${mismatches.map((item) => item.label).join('、')}。请更新原单，不要重复新建。`,
      { mismatches }
    );
  }
}

function matchesExpenseReimbursementEntries(expectedEntries, actualEntries) {
  if (actualEntries.length !== expectedEntries.length) return false;
  return expectedEntries.every((expected, index) => {
    const actual = actualEntries[index] || {};
    return referenceNumber(actual.ExpID || actual.FExpID) === referenceNumber(expected.FExpID)
      && sameMoney(actual.ExpenseAmount ?? actual.FExpenseAmount, expected.FExpenseAmount)
      && (
        !Number.isFinite(Number(expected.FTaxAmt))
        || sameMoney(actual.TaxAmt ?? actual.FTaxAmt, expected.FTaxAmt)
      )
      && (!Object.hasOwn(expected, 'FTaxSubmitAmt')
        || sameMoney(actual.TaxSubmitAmt ?? actual.FTaxSubmitAmt, expected.FTaxSubmitAmt))
      && sameMoney(actual.ExpSubmitAmount ?? actual.FExpSubmitAmount, expected.FExpSubmitAmount)
      && (
        !Number.isFinite(Number(expected.FReimbNotPayAmount))
        || sameMoney(
          actual.ReimbNotPayAmount ?? actual.FReimbNotPayAmount,
          expected.FReimbNotPayAmount
        )
      )
      && sameText(actual.F_PAEZ_Date, expected.F_PAEZ_Date, true)
      && sameText(actual.F_PAEZ_Text, expected.F_PAEZ_Text)
      && sameText(actual.F_ora_Text, expected.F_ora_Text)
      && sameText(actual.F_PAEZ_Text1, expected.F_PAEZ_Text1)
      && (
        !Number.isFinite(Number(expected.F_ora_Decimal_qtr))
        || sameMoney(actual.F_ora_Decimal_qtr, expected.F_ora_Decimal_qtr)
      )
      && sameText(actual.Remark ?? actual.FRemark, expected.FRemark)
      && (!referenceNumber(expected.FExpenseDeptEntryID)
        || referenceNumber(actual.ExpenseDeptEntryID || actual.FExpenseDeptEntryID)
          === referenceNumber(expected.FExpenseDeptEntryID))
      && sameText(actual.F_ora_Text_83g, expected.F_ora_Text_83g);
  });
}

function statusMessage(status) {
  return status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ') || '';
}

function sameMoney(actual, expected) {
  return Number.isFinite(Number(actual))
    && Number.isFinite(Number(expected))
    && Math.abs(Number(actual) - Number(expected)) < 0.001;
}

function sameText(actual, expected, dateOnly = false) {
  const normalize = (value) => {
    const text = String(value ?? '').trim();
    return dateOnly ? text.slice(0, 10) : text;
  };
  return normalize(actual) === normalize(expected);
}

function sameBoolean(actual, expected) {
  return Boolean(actual) === Boolean(expected);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}

function validateSavedExpenseReimbursementTarget(payload, viewBody) {
  const expected = {
    orgNumber: referenceNumber(payload?.Model?.FOrgID),
    employeeNumber: referenceNumber(payload?.Model?.FProposerID),
    departmentNumber: referenceNumber(payload?.Model?.FRequestDeptID),
    billTypeNumber: referenceNumber(payload?.Model?.FBillTypeID),
    totalAmount: Number(payload?.Model?.FExpAmountSum)
  };
  const viewModel = viewBody?.Result?.Result || {};
  const actual = {
    orgNumber: referenceNumber(viewModel.FOrgID || viewModel.OrgID),
    employeeNumber: referenceNumber(viewModel.FProposerID || viewModel.ProposerID),
    departmentNumber: referenceNumber(viewModel.FRequestDeptID || viewModel.RequestDeptID),
    billTypeNumber: referenceNumber(viewModel.FBillTypeID || viewModel.BillTypeID),
    totalAmount: Number(viewModel.FExpAmountSum ?? viewModel.ExpAmountSum)
  };
  const mismatches = Object.entries(expected)
    .filter(([, expectedValue]) => expectedValue !== '' && Number.isFinite(expectedValue) || Boolean(expectedValue))
    .filter(([key, expectedValue]) => key === 'totalAmount'
      ? Math.abs(actual[key] - expectedValue) > 0.001
      : actual[key] !== expectedValue)
    .map(([key, expectedValue]) => ({ field: key, expected: expectedValue, actual: actual[key] || '' }));
  if (mismatches.length > 0) {
    throw dependencyError(
      'KINGDEE_SAVE_TARGET_MISMATCH',
      'Kingdee expense reimbursement save target mismatch',
      { expected, actual, mismatches }
    );
  }
  if (!sameText(viewModel.F_ora_Text_qtr, payload?.Model?.F_ora_Text_qtr)) {
    throw dependencyError(
      'KINGDEE_SAVE_SOURCE_TYPE_MISMATCH',
      'Kingdee expense reimbursement source type does not match the Fenbeitong interface value',
      {
        expected: String(payload?.Model?.F_ora_Text_qtr || ''),
        actual: String(viewModel.F_ora_Text_qtr || '')
      }
    );
  }
  const checkboxMismatches = [];
  const actualRequestType = String(viewModel.RequestType ?? viewModel.FRequestType ?? '').trim();
  const expectedRequestType = String(payload?.Model?.FRequestType ?? '').trim();
  if (actualRequestType !== expectedRequestType) {
    checkboxMismatches.push(['FRequestType', actualRequestType, expectedRequestType]);
  }
  if (!sameBoolean(viewModel.FRealPay, payload?.Model?.FRealPay)) {
    checkboxMismatches.push(['FRealPay', viewModel.FRealPay, payload?.Model?.FRealPay]);
  }
  if (checkboxMismatches.length > 0) {
    throw dependencyError(
      'KINGDEE_SAVE_PAYMENT_CHECKBOX_MISMATCH',
      'Kingdee expense reimbursement payment checkboxes do not match the source rule',
      {
        mismatches: checkboxMismatches.map(([field, actualValue, expectedValue]) => ({
          field,
          expected: field === 'FRequestType' ? String(expectedValue) : Boolean(expectedValue),
          actual: field === 'FRequestType' ? String(actualValue) : Boolean(actualValue)
        }))
      }
    );
  }
  const expectedEntries = Array.isArray(payload?.Model?.FEntity) ? payload.Model.FEntity : [];
  const viewEntries = Array.isArray(viewModel.ER_ExpenseReimbEntry)
    ? viewModel.ER_ExpenseReimbEntry
    : Array.isArray(viewModel.FEntity) ? viewModel.FEntity : [];
  if (
    expectedEntries.length > 0
    && !matchesExpenseReimbursementEntries(expectedEntries, viewEntries)
  ) {
    throw dependencyError(
      'KINGDEE_SAVE_LINE_MISMATCH',
      'Kingdee expense reimbursement was saved, but its detail amounts or source fields do not match the requested data'
    );
  }
}

async function loginKingdee(config) {
  const response = await postKingdeeForm(config, config.authPath, {
    acctID: config.acctId,
    username: config.username,
    password: config.password,
    lcid: config.lcid
  });
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_LOGIN_HTTP_FAILED', `Kingdee login failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  if (!isLoginSuccess(body)) {
    throw dependencyError('KINGDEE_LOGIN_FAILED', 'Kingdee login failed');
  }
  const cookie = extractCookieHeader(response.headers);
  if (!cookie) {
    throw dependencyError('KINGDEE_LOGIN_COOKIE_MISSING', 'Kingdee login response missing Set-Cookie');
  }
  return {
    cookie,
    sessionId: body?.Context?.SessionId || '',
    kdsvcSessionId: body?.KDSVCSessionId || ''
  };
}

async function switchKingdeeOrganization(config, authSession, orgNumber) {
  if (!orgNumber) {
    return authSession;
  }
  const response = await postKingdeeForm(config, config.switchOrgPath, {
    data: JSON.stringify({ OrgNumber: orgNumber })
  }, authSession.cookie);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError(
      'KINGDEE_SWITCH_ORG_HTTP_FAILED',
      `Kingdee organization switch failed: HTTP ${response.status}`,
      { status: response.status, orgNumber }
    );
  }
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError(
      'KINGDEE_SWITCH_ORG_FAILED',
      `Kingdee organization switch failed for ${orgNumber}: ${message || 'unknown error'}`,
      { orgNumber }
    );
  }
  return {
    ...authSession,
    cookie: mergeCookieHeaders(authSession.cookie, extractCookieHeader(response.headers))
  };
}

async function postKingdeeForm(config, servicePath, form, cookieHeader = '') {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  return fetchKingdee(config, servicePath, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString()
  });
}

async function viewSavedExpenseReimbursement(config, authSession, erpFid) {
  const response = await postKingdeeJsonWrapper(config, config.viewPath, {
    formid: EXPENSE_REIMBURSEMENT_FORM_ID,
    data: JSON.stringify({
      Number: '',
      Id: String(erpFid),
      CreateOrgId: 0
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_VIEW_HTTP_FAILED', `Kingdee expense reimbursement view failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError('KINGDEE_VIEW_FAILED', `Kingdee expense reimbursement view failed: ${message || 'unknown error'}`);
  }
  if (!body?.Result?.Result || typeof body.Result.Result !== 'object') {
    throw dependencyError('KINGDEE_VIEW_RESPONSE_INVALID', 'Kingdee expense reimbursement view response missing Result.Result');
  }
  return body;
}

async function postKingdeeJsonWrapper(config, servicePath, body, authSession) {
  const headers = { 'Content-Type': 'application/json;charset=UTF-8' };
  if (authSession?.cookie) {
    headers.Cookie = authSession.cookie;
  }
  if (authSession?.sessionId) {
    headers.SessionId = authSession.sessionId;
  }
  if (authSession?.kdsvcSessionId) {
    headers.KDSVCSessionId = authSession.kdsvcSessionId;
  }
  return fetchKingdee(config, servicePath, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function fetchKingdee(config, servicePath, options) {
  const url = buildServiceUrl(config.baseUrl, servicePath);
  const maximumAttempts = isSafeKingdeeRetry(config, servicePath) ? 3 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
      });
      if (
        attempt < maximumAttempts
        && [408, 429, 502, 503, 504].includes(response.status)
      ) {
        await retryDelay(attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) {
        await retryDelay(attempt);
      }
    }
  }
  const cause = String(
    lastError?.cause?.code
    || lastError?.name
    || lastError?.message
    || 'NETWORK_ERROR'
  );
  throw dependencyError(
    'KINGDEE_NETWORK_FAILED',
    `无法连接金蝶服务 ${config.baseUrl}，请确认公司内网或 VPN 已连接后重试`,
    { baseUrl: config.baseUrl, servicePath, cause, attempts: maximumAttempts }
  );
}

function isSafeKingdeeRetry(config, servicePath) {
  return [
    config.authPath,
    config.switchOrgPath,
    config.viewPath,
    BILL_QUERY_PATH
  ].includes(servicePath);
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 250 * attempt));
}

function saveIdentifiers(body) {
  const successEntity = body?.Result?.ResponseStatus?.SuccessEntitys?.[0];
  return {
    erpFid: String(successEntity?.Id || body?.Result?.Id || ''),
    erpNumber: String(successEntity?.Number || body?.Result?.Number || '')
  };
}

function paymentBillRow(fieldKeys, row) {
  const values = Object.fromEntries(fieldKeys.map((field, index) => [field, row[index]]));
  return {
    id: String(values.FID || ''),
    billNumber: String(values.FBillNo || '').trim(),
    billTypeNumber: String(values['FBillTypeID.FNumber'] || '').trim(),
    billTypeName: String(values['FBillTypeID.FName'] || '').trim(),
    businessDate: String(values.FDATE || '').slice(0, 10),
    paymentTime: normalizePaymentTimestamp(values.FLastFinishTime),
    entryPaymentTime: normalizePaymentTimestamp(values.FFinishTime),
    employeeNumber: String(values['FCONTACTUNIT.FNumber'] || '').trim(),
    employeeName: String(values['FCONTACTUNIT.FName'] || '').trim(),
    payableAmount: Number(values.FPAYTOTALAMOUNTFOR_H || 0),
    paidAmount: Number(values.FREALPAYAMOUNTFOR_H || 0),
    remark: String(values.FREMARK || '').trim(),
    sourceBillNumber: String(values.FSourceBillNumber || '').trim(),
    linkedSourceBillNumber: String(values.FSRCBILLNO || '').trim(),
    thirdPartyBillNumber: String(values.FTHIRDBILLNO || '').trim(),
    entryId: String(values.FPAYBILLENTRY_FEntryID || ''),
    bankStatusCode: String(values.FBankStatus || '').trim(),
    bankStatusName: values.FBankStatus === 'C' ? '银行交易成功' : String(values.FBANKMSG || '').trim(),
    bankStatusMessage: String(values.FBANKMSG || '').trim(),
    entryRemark: String(values.FCOMMENT || '').trim(),
    entryPaymentAmount: Number(values.FPAYAMOUNTFOR_E || 0),
    requestSerialNumber: String(values.FQQLSH || '').trim(),
    sourceBillId: '',
    sourceType: '',
    sourcePaidAmount: 0
  };
}

function aggregatePaymentBills(rows) {
  const bills = new Map();
  for (const row of rows) {
    if (row.billTypeNumber !== 'SGBXD' || !row.id) continue;
    const bill = bills.get(row.id) || {
      ...row,
      sourceBillNumbers: new Set(),
      entryIds: new Set(),
      entries: []
    };
    if (row.sourceBillNumber) bill.sourceBillNumbers.add(row.sourceBillNumber);
    if (row.linkedSourceBillNumber) bill.sourceBillNumbers.add(row.linkedSourceBillNumber);
    bills.set(row.id, bill);
    if (row.entryId && bill.entryIds.has(row.entryId)) continue;
    if (row.entryId) bill.entryIds.add(row.entryId);
    bill.entries.push({
      bankStatusCode: row.bankStatusCode,
      bankStatusName: row.bankStatusName,
      bankStatusMessage: row.bankStatusMessage,
      remark: row.entryRemark,
      sourceBillNumber: row.sourceBillNumber,
      paymentAmount: row.entryPaymentAmount,
      paymentTime: row.entryPaymentTime,
      requestSerialNumber: row.requestSerialNumber
    });
  }
  return [...bills.values()].map(({ entryIds, sourceBillNumbers, ...bill }) => {
    const codes = [...new Set(bill.entries.map((entry) => entry.bankStatusCode))];
    const names = [...new Set(bill.entries.map((entry) => entry.bankStatusName || entry.bankStatusCode).filter(Boolean))];
    const entryTimes = bill.entries.map((entry) => entry.paymentTime);
    return {
      ...bill,
      sourceBillNumbers: [...sourceBillNumbers],
      paymentTime: bill.paymentTime || (entryTimes.every(Boolean) ? entryTimes.sort().at(-1) : ''),
      bankStatusCode: codes.length === 1 ? codes[0] : '',
      bankStatusName: names.join(' / '),
      entryRemark: '',
      entryPaymentAmount: bill.entries.reduce((sum, entry) => sum + entry.paymentAmount, 0),
      requestSerialNumber: bill.entries
        .map((entry) => entry.requestSerialNumber)
        .find(Boolean) || ''
    };
  });
}

function referenceNumber(reference) {
  if (!reference || typeof reference !== 'object') {
    return '';
  }
  return String(
    reference.FStaffNumber
      || reference.FNumber
      || reference.Number
      || reference.number
      || ''
  ).trim();
}

function localizedText(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  const preferred = value.find((item) => Number(item?.Key) === 2052)
    || value.find((item) => String(item?.Value || '').trim());
  return String(preferred?.Value || '').trim();
}

function buildServiceUrl(baseUrl, servicePath) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const k3cloudBase = /\/k3cloud$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}/K3Cloud`;
  return `${k3cloudBase}/${servicePath.replace(/^\/+/, '')}`;
}

function isLoginSuccess(body) {
  return body?.LoginResultType === 1 || body?.IsSuccessByAPI === true;
}

function extractCookieHeader(headers) {
  const setCookie = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  return setCookie
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function mergeCookieHeaders(...headers) {
  const cookies = new Map();
  for (const header of headers) {
    for (const part of String(header || '').split(';')) {
      const cookie = part.trim();
      const index = cookie.indexOf('=');
      if (index > 0) {
        cookies.set(cookie.slice(0, index), cookie.slice(index + 1));
      }
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}
