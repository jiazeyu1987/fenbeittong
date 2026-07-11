import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAppConfig, getRootDir, validateFenbeitongConfig } from '../config.js';
import { dependencyError } from '../errors.js';

export async function pullFenbeitongReimbursements() {
  const config = getAppConfig().fenbeitong;
  if (config.mode === 'mock') {
    const fixedJson = readFileSync(
      resolve(getRootDir(), 'mock-data/fenbeitong-reimbursement-valid.json'),
      'utf8'
    );
    return {
      mode: 'mock',
      mockReplacement: true,
      mockReason: 'Fenbeitong access token is not available yet',
      documents: [JSON.parse(fixedJson)]
    };
  }

  validateFenbeitongConfig();
  const url = new URL(config.pullPath, config.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access-token': config.accessToken
    },
    body: JSON.stringify({})
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
  if (Array.isArray(body.data)) {
    return {
      mode: 'real',
      mockReplacement: false,
      mockReason: '',
      documents: body.data.map((item) => ({ code: '0', msg: body.msg || '', data: item }))
    };
  }
  if (body.data && typeof body.data === 'object') {
    return {
      mode: 'real',
      mockReplacement: false,
      mockReason: '',
      documents: [body]
    };
  }
  throw dependencyError('FENBEITONG_INVALID_RESPONSE', 'Fenbeitong response data must be an object or array');
}
