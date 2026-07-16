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
      /KINGDEE_BASE_URL, KINGDEE_ACCOUNT\.acctId, KINGDEE_ACCOUNT\.username, KINGDEE_ACCOUNT\.password/
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
      assert.match(String(options.body), /acctID=6977227150362f/);
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
            DocumentStatus: 'A'
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
    assert.equal(result.documentStatus, 'A');
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
    assert.match(calls[1].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
    assert.match(calls[2].url, /http:\/\/172\.30\.30\.8\/K3Cloud\/Kingdee\.BOS/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('real Kingdee save uses the explicitly selected ERP account', async () => {
  const restoreEnv = forceRealKingdeeEnv({
    KINGDEE_ACCOUNT_JIAZEYU_ENABLED: 'true',
    KINGDEE_ACCOUNT_JIAZEYU_LABEL: 'Jia Zeyu',
    KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID: '6977227150362f',
    KINGDEE_ACCOUNT_JIAZEYU_USERNAME: 'jia-user',
    KINGDEE_ACCOUNT_JIAZEYU_PASSWORD: 'jia-password'
  });
  const previousFetch = globalThis.fetch;
  const loginBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      loginBodies.push(String(options.body));
      assert.match(String(options.body), /acctID=6977227150362f/);
      assert.match(String(options.body), /username=jia-user/);
      assert.match(String(options.body), /password=jia-password/);
      return new Response(JSON.stringify({ LoginResultType: 1 }), {
        status: 200,
        headers: { 'Set-Cookie': 'kdservice-sessionid=jia123; Path=/K3Cloud' }
      });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      return new Response(JSON.stringify({
        Result: {
          Id: '200001',
          Number: '88',
          ResponseStatus: {
            IsSuccess: true,
            Errors: [],
            SuccessEntitys: [{ Id: 200001, Number: '88', DIndex: 0 }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: { FID: 200001, FBillNo: '88', DocumentStatus: 'A' }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };

  try {
    const result = await saveKingdeeVoucher({ Model: { Example: true } }, { accountKey: 'jia-zeyu' });
    assert.equal(result.erpFid, '200001');
    assert.equal(loginBodies.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('real Kingdee save combines selected ERP account credentials with selected acctID', async () => {
  const restoreEnv = forceRealKingdeeEnv({
    KINGDEE_ACCT_ID: '6977227150362f',
    KINGDEE_ACCT_ID_KEY: 'puhui-6977227150362f',
    KINGDEE_ACCT_ID_LABEL: 'Puhui verified acctID',
    KINGDEE_USERNAME: 'int-user',
    KINGDEE_PASSWORD: 'int-password',
    KINGDEE_ACCOUNT_JIAZEYU_ENABLED: 'true',
    KINGDEE_ACCOUNT_JIAZEYU_LABEL: 'Jia Zeyu',
    KINGDEE_ACCOUNT_JIAZEYU_USERNAME: 'jia-user',
    KINGDEE_ACCOUNT_JIAZEYU_PASSWORD: 'jia-password'
  });
  const previousFetch = globalThis.fetch;
  const loginBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      loginBodies.push(String(options.body));
      assert.match(String(options.body), /acctID=6977227150362f/);
      assert.match(String(options.body), /username=jia-user/);
      assert.match(String(options.body), /password=jia-password/);
      assert.doesNotMatch(String(options.body), /username=int-user/);
      assert.doesNotMatch(String(options.body), /password=int-password/);
      return new Response(JSON.stringify({ LoginResultType: 1 }), {
        status: 200,
        headers: { 'Set-Cookie': 'kdservice-sessionid=split123; Path=/K3Cloud' }
      });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      return new Response(JSON.stringify({
        Result: {
          Id: '200002',
          Number: '89',
          ResponseStatus: {
            IsSuccess: true,
            Errors: [],
            SuccessEntitys: [{ Id: 200002, Number: '89', DIndex: 0 }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: { FID: 200002, FBillNo: '89', DocumentStatus: 'A' }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };

  try {
    const result = await saveKingdeeVoucher(
      { Model: { Example: true } },
      { accountKey: 'jia-zeyu', acctIdKey: 'puhui-6977227150362f' }
    );
    assert.equal(result.erpFid, '200002');
    assert.equal(loginBodies.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('real Kingdee save rejects unknown selected ERP account without fallback', async () => {
  const restoreEnv = forceRealKingdeeEnv();
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}');
  };

  try {
    await assert.rejects(
      () => saveKingdeeVoucher({ Model: { Example: true } }, { accountKey: 'missing-account' }),
      /Kingdee ERP account missing-account is not configured/
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('real Kingdee save rejects successful Save when View returns a different ledger target', async () => {
  const restoreEnv = forceRealKingdeeEnv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
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
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 100033,
            FBillNo: '23',
            AccountBookID: { Number: '002' },
            ACCBOOKORGID: { Number: '881' },
            VOUCHERGROUPID: { Number: 'PZZ7' },
            DocumentStatus: 'A'
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };

  try {
    await assert.rejects(
      () => saveKingdeeVoucher({
        Model: {
          AccountBookID: { Number: '007' },
          ACCBOOKORGID: { Number: '886' },
          VOUCHERGROUPID: { Number: 'PZZ9' }
        }
      }),
      /Kingdee voucher save target mismatch/
    );
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
    'KINGDEE_ACCT_ID_KEY',
    'KINGDEE_ACCT_ID_LABEL',
    'KINGDEE_ACCOUNT_KEY',
    'KINGDEE_ACCOUNT_CURRENT_LABEL',
    'KINGDEE_ACCOUNT_JIAZEYU_ENABLED',
    'KINGDEE_ACCOUNT_JIAZEYU_LABEL',
    'KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID',
    'KINGDEE_ACCOUNT_JIAZEYU_USERNAME',
    'KINGDEE_ACCOUNT_JIAZEYU_PASSWORD',
    'KINGDEE_LCID',
    'KINGDEE_AUTH_PATH',
    'KINGDEE_VIEW_PATH',
    'KINGDEE_SAVE_PATH'
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.KINGDEE_MODE = 'real';
  process.env.KINGDEE_BASE_URL = 'http://172.30.30.8';
  process.env.KINGDEE_ACCT_ID = '6977227150362f';
  process.env.KINGDEE_ACCT_ID_KEY = 'puhui-6977227150362f';
  process.env.KINGDEE_ACCT_ID_LABEL = 'Puhui verified acctID';
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
