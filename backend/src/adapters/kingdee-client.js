import { getEffectiveKingdeeConfig, validateKingdeeConfig } from '../config.js';
import { AppError, dependencyError } from '../errors.js';
import { getKingdeeAccountSelection, getKingdeeAcctIdSelection } from '../repository.js';

export async function saveKingdeeVoucher(payload, options = {}) {
  const accountKey = options.accountKey || getKingdeeAccountSelection();
  const acctIdKey = options.acctIdKey || getKingdeeAcctIdSelection();
  const config = getEffectiveKingdeeConfig(accountKey, acctIdKey);
  if (config.mode !== 'real') {
    throw new AppError(
      'KINGDEE_REAL_MODE_REQUIRED',
      'Kingdee voucher save requires KINGDEE_MODE=real; mock save is disabled',
      422,
      { missing: ['KINGDEE_MODE=real'] }
    );
  }

  validateKingdeeConfig(accountKey, acctIdKey);
  const authSession = await loginKingdee(config);
  const response = await postKingdeeJsonWrapper(config, config.savePath, {
    formid: 'GL_VOUCHER',
    data: JSON.stringify(payload)
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_HTTP_FAILED', `Kingdee voucher save failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError('KINGDEE_SAVE_FAILED', `Kingdee voucher save failed: ${message || 'unknown error'}`);
  }
  const identifiers = saveIdentifiers(body);
  if (!identifiers.erpFid || !identifiers.erpNumber) {
    throw dependencyError('KINGDEE_SAVE_RESPONSE_INVALID', 'Kingdee voucher save response missing Id or Number');
  }
  const viewBody = await viewSavedVoucher(config, authSession, identifiers.erpFid);
  validateSavedVoucherTarget(payload, viewBody);
  return {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    mockReason: '',
    erpFid: identifiers.erpFid,
    erpNumber: identifiers.erpNumber,
    documentStatus: viewBody?.Result?.Result?.FDocumentStatus
      || viewBody?.Result?.Result?.DocumentStatus
      || 'Z',
    rawResponse: { save: body, view: viewBody }
  };
}

function validateSavedVoucherTarget(payload, viewBody) {
  const expected = {
    accountBookNumber: referenceNumber(payload?.Model?.AccountBookID || payload?.Model?.FAccountBookID),
    accountOrgNumber: referenceNumber(payload?.Model?.ACCBOOKORGID || payload?.Model?.FACCBOOKORGID),
    voucherGroupNumber: referenceNumber(payload?.Model?.VOUCHERGROUPID || payload?.Model?.FVOUCHERGROUPID)
  };
  const viewModel = viewBody?.Result?.Result || {};
  const actual = {
    accountBookNumber: referenceNumber(viewModel.AccountBookID || viewModel.FAccountBookID),
    accountOrgNumber: referenceNumber(
      viewModel.ACCBOOKORGID
      || viewModel.FACCBOOKORGID
      || viewModel.AccountBookID?.AccountOrgID
    ),
    voucherGroupNumber: referenceNumber(viewModel.VOUCHERGROUPID || viewModel.FVOUCHERGROUPID)
  };
  const mismatches = Object.entries(expected)
    .filter(([, expectedValue]) => Boolean(expectedValue))
    .filter(([key, expectedValue]) => actual[key] !== expectedValue)
    .map(([key, expectedValue]) => ({ field: key, expected: expectedValue, actual: actual[key] || '' }));
  if (mismatches.length > 0) {
    throw dependencyError(
      'KINGDEE_SAVE_TARGET_MISMATCH',
      'Kingdee voucher save target mismatch',
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

async function postKingdeeForm(config, servicePath, form, cookieHeader = '') {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  return fetch(buildServiceUrl(config.baseUrl, servicePath), {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString()
  });
}

async function viewSavedVoucher(config, authSession, erpFid) {
  const response = await postKingdeeJsonWrapper(config, config.viewPath, {
    formid: 'GL_VOUCHER',
    data: JSON.stringify({
      Number: '',
      Id: String(erpFid),
      CreateOrgId: 0
    })
  }, authSession);
  const body = await response.json();
  if (!response.ok) {
    throw dependencyError('KINGDEE_VIEW_HTTP_FAILED', `Kingdee voucher view failed: HTTP ${response.status}`, {
      status: response.status
    });
  }
  const status = body?.Result?.ResponseStatus;
  if (!status?.IsSuccess) {
    const message = status?.Errors?.map((error) => error.Message || error.FieldName).filter(Boolean).join('; ');
    throw dependencyError('KINGDEE_VIEW_FAILED', `Kingdee voucher view failed: ${message || 'unknown error'}`);
  }
  if (!body?.Result?.Result || typeof body.Result.Result !== 'object') {
    throw dependencyError('KINGDEE_VIEW_RESPONSE_INVALID', 'Kingdee voucher view response missing Result.Result');
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
  return fetch(buildServiceUrl(config.baseUrl, servicePath), {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
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
  return String(reference.FNumber || reference.Number || reference.number || '').trim();
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
