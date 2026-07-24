import { getEffectiveKingdeeConfig, validateKingdeeConfig } from '../config.js';
import { AppError, dependencyError } from '../errors.js';
import { getKingdeeAccountSelection, getKingdeeAcctIdSelection } from '../repository.js';

const EXPENSE_REIMBURSEMENT_FORM_ID = 'ER_ExpReimbursement';
const EMPLOYEE_FORM_ID = 'BD_Empinfo';
const BILL_QUERY_PATH = 'Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc';
const employeeNumberCache = new Map();
const EMPLOYEE_CACHE_TTL_MS = 10 * 60 * 1000;

export function clearKingdeeEmployeeNumberCacheForTest() {
  employeeNumberCache.clear();
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
  let body = await postExpenseReimbursementSave(config, authSession, activePayload);
  let status = body?.Result?.ResponseStatus;
  let recoveredMissingTarget = false;
  if (!status?.IsSuccess && isNetworkControlConflict(status)) {
    const existingFid = Number(activePayload?.Model?.FID);
    if (positiveId(existingFid)) {
      const existingView = await viewSavedExpenseReimbursement(config, authSession, existingFid);
      if (matchesExistingExpenseReimbursement(activePayload, existingView)) {
        const existingModel = existingView.Result.Result;
        return {
          simulated: false,
          mode: 'real',
          mockReplacement: false,
          mockReason: '',
          recoveredMissingTarget: false,
          recoveredNetworkControlConflict: true,
          erpFid: String(existingModel.Id || existingModel.FID || existingFid),
          erpNumber: String(existingModel.BillNo || existingModel.FBillNo || activePayload.Model.FBillNo),
          documentStatus: existingModel.DocumentStatus || existingModel.FDocumentStatus || 'Z',
          rawResponse: { save: body, view: existingView }
        };
      }
    }
    throw networkControlConflictError(activePayload, status);
  }
  if (!status?.IsSuccess && isMissingExpenseReimbursement(status) && positiveId(activePayload?.Model?.FID)) {
    activePayload = structuredClone(payload);
    activePayload.Model.FID = await findExpenseReimbursementFidByNumber(
      config,
      authSession,
      activePayload.Model.FBillNo
    );
    body = await postExpenseReimbursementSave(config, authSession, activePayload);
    status = body?.Result?.ResponseStatus;
    recoveredMissingTarget = true;
  }
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
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
  const viewBody = await viewSavedExpenseReimbursement(config, authSession, identifiers.erpFid);
  validateSavedExpenseReimbursementTarget(activePayload, viewBody);
  return {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    mockReason: '',
    recoveredMissingTarget,
    erpFid: identifiers.erpFid,
    erpNumber: identifiers.erpNumber,
    documentStatus: viewBody?.Result?.Result?.FDocumentStatus
      || viewBody?.Result?.Result?.DocumentStatus
      || 'Z',
    rawResponse: {
      save: body,
      view: viewBody
    }
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
  const matches = Array.isArray(body)
    ? body.filter((row) => Array.isArray(row) && String(row[1] || '').trim() === number)
    : [];
  if (matches.length > 1) {
    throw dependencyError(
      'KINGDEE_DUPLICATE_BILL_NUMBER',
      `Kingdee contains multiple expense reimbursements with number ${number}; automatic recovery stopped`,
      { billNumber: number, fids: matches.map((row) => String(row[0] || '')) }
    );
  }
  if (matches.length === 0) return 0;
  const fid = Number(matches[0][0]);
  if (!positiveId(fid)) {
    throw dependencyError(
      'KINGDEE_BILL_QUERY_RESPONSE_INVALID',
      `Kingdee expense reimbursement lookup returned an invalid FID for ${number}`
    );
  }
  return fid;
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
  const expectedBillNumber = String(expectedModel.FBillNo || '').trim();
  if (expectedBillNumber && String(actualModel.BillNo || actualModel.FBillNo || '').trim()
    !== expectedBillNumber) return false;
  if (!sameMoney(actualModel.ExpAmountSum ?? actualModel.FExpAmountSum, expectedModel.FExpAmountSum)) return false;

  const expectedEntries = Array.isArray(expectedModel.FEntity) ? expectedModel.FEntity : [];
  const actualEntries = Array.isArray(actualModel.ER_ExpenseReimbEntry)
    ? actualModel.ER_ExpenseReimbEntry
    : Array.isArray(actualModel.FEntity) ? actualModel.FEntity : [];
  if (actualEntries.length !== expectedEntries.length) return false;
  return expectedEntries.every((expected, index) => {
    const actual = actualEntries[index] || {};
    return referenceNumber(actual.ExpID || actual.FExpID) === referenceNumber(expected.FExpID)
      // Save accepts FExpenseAmount as net-of-tax, while View returns the
      // calculated tax-inclusive amount. Compare the stable net, tax and
      // submitted gross fields below instead of this transformed field.
      && sameMoney(actual.TaxAmt ?? actual.FTaxAmt, expected.FTaxAmt)
      && sameMoney(actual.TaxSubmitAmt ?? actual.FTaxSubmitAmt, expected.FTaxSubmitAmt)
      && sameMoney(actual.ExpSubmitAmount ?? actual.FExpSubmitAmount, expected.FExpSubmitAmount)
      && sameText(actual.F_PAEZ_Date, expected.F_PAEZ_Date, true)
      && sameText(actual.F_PAEZ_Text, expected.F_PAEZ_Text)
      && sameText(actual.F_ora_Text, expected.F_ora_Text)
      && sameText(actual.F_PAEZ_Text1, expected.F_PAEZ_Text1)
      && sameText(actual.Remark ?? actual.FRemark, expected.FRemark)
      && referenceNumber(actual.ExpenseDeptEntryID || actual.FExpenseDeptEntryID)
        === referenceNumber(expected.FExpenseDeptEntryID)
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
