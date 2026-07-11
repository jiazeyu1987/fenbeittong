import { getAppConfig, validateKingdeeConfig } from '../config.js';
import { dependencyError } from '../errors.js';

export async function saveKingdeeVoucher(payload) {
  const config = getAppConfig().kingdee;
  if (config.mode === 'mock') {
    return {
      simulated: true,
      mode: 'mock',
      mockReplacement: true,
      mockReason: 'Kingdee GL_VOUCHER save example is not confirmed yet',
      erpFid: 'MOCK-KINGDEE-FID',
      erpNumber: 'MOCK-KINGDEE-NUMBER',
      documentStatus: 'Z'
    };
  }

  validateKingdeeConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (config.authHeaderName && config.authHeaderValue) {
    headers[config.authHeaderName] = config.authHeaderValue;
  }
  const response = await fetch(config.saveUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      formid: 'GL_VOUCHER',
      data: payload
    })
  });
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
  return {
    simulated: false,
    mode: 'real',
    mockReplacement: false,
    mockReason: '',
    erpFid: body.Result.Id || '',
    erpNumber: body.Result.Number || '',
    documentStatus: 'Z',
    rawResponse: body
  };
}
