import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKingdeeConfig } from '../src/config.js';
import { saveKingdeeVoucher } from '../src/adapters/kingdee-client.js';

test('Kingdee voucher save rejects mock mode instead of simulating ERP success', async () => {
  const restoreEnv = forceKingdeeEnv({ KINGDEE_MODE: 'mock' });

  try {
    await assert.rejects(
      () => saveKingdeeVoucher({ Model: { Example: true } }),
      /requires KINGDEE_MODE=real/
    );
  } finally {
    restoreEnv();
  }
});

test('real Kingdee mode requires K3Cloud login configuration', () => {
  const restoreEnv = forceRealKingdeeEnv({
    KINGDEE_BASE_URL: '',
    KINGDEE_ACCT_ID: '',
    KINGDEE_USERNAME: '',
    KINGDEE_PASSWORD: ''
  });

  try {
    assert.throws(
      () => validateKingdeeConfig(),
      /KINGDEE_BASE_URL, KINGDEE_ACCT_ID, KINGDEE_USERNAME, KINGDEE_PASSWORD/
    );
  } finally {
    restoreEnv();
  }
});

test('real Kingdee save logs in, posts GL_VOUCHER Save as JSON wrapper, and verifies by View', async () => {
  const restoreEnv = forceRealKingdeeEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      method: options.method,
      headers: options.headers,
      body: options.body
    });
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
      assert.match(String(options.body), /acctID=test-acct/);
      assert.match(String(options.body), /username=test-user/);
      assert.match(String(options.body), /password=test-password/);
      return new Response(JSON.stringify({
        LoginResultType: 1,
        Context: { SessionId: 'session-001' },
        KDSVCSessionId: 'kdsvc-001'
      }), {
        status: 200,
        headers: { 'Set-Cookie': 'kdservice-sessionid=abc123; Path=/K3Cloud' }
      });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      assert.equal(options.headers.Cookie, 'kdservice-sessionid=abc123');
      assert.equal(options.headers.SessionId, 'session-001');
      assert.equal(options.headers.KDSVCSessionId, 'kdsvc-001');
      assert.equal(options.headers['Content-Type'], 'application/json;charset=UTF-8');
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'GL_VOUCHER');
      assert.deepEqual(JSON.parse(body.data).Model, { Example: true });
      return new Response(JSON.stringify({
        Result: {
          Id: '100033',
          Number: '23',
          ResponseStatus: {
            IsSuccess: true,
            Errors: [],
            SuccessEntitys: [{ Id: 100033, Number: '23', DIndex: 0 }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      assert.equal(options.headers.Cookie, 'kdservice-sessionid=abc123');
      assert.equal(options.headers['Content-Type'], 'application/json;charset=UTF-8');
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'GL_VOUCHER');
      assert.deepEqual(JSON.parse(body.data), {
        Number: '',
        Id: '100033',
        CreateOrgId: 0
      });
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 100033,
            FBillNo: '23',
            FDocumentStatus: 'Z'
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };

  try {
    const result = await saveKingdeeVoucher({ Model: { Example: true } });
    assert.equal(result.simulated, false);
    assert.equal(result.mockReplacement, false);
    assert.equal(result.erpFid, '100033');
    assert.equal(result.erpNumber, '23');
    assert.equal(result.documentStatus, 'Z');
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
    assert.match(calls[1].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
    assert.match(calls[2].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

function forceRealKingdeeEnv(overrides = {}) {
  return forceKingdeeEnv({ KINGDEE_MODE: 'real', ...overrides });
}

function forceKingdeeEnv(overrides = {}) {
  const names = [
    'KINGDEE_MODE',
    'KINGDEE_BASE_URL',
    'KINGDEE_ACCT_ID',
    'KINGDEE_USERNAME',
    'KINGDEE_PASSWORD',
    'KINGDEE_LCID',
    'KINGDEE_AUTH_PATH',
    'KINGDEE_VIEW_PATH',
    'KINGDEE_SAVE_PATH'
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.KINGDEE_MODE = 'real';
  process.env.KINGDEE_BASE_URL = 'http://172.30.30.8';
  process.env.KINGDEE_ACCT_ID = 'test-acct';
  process.env.KINGDEE_USERNAME = 'test-user';
  process.env.KINGDEE_PASSWORD = 'test-password';
  process.env.KINGDEE_LCID = '2052';
  process.env.KINGDEE_SAVE_PATH = '';
  for (const [name, value] of Object.entries(overrides)) {
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}
