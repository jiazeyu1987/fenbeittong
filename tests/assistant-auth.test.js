import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';

const assistantUrl = 'http://127.0.0.1:18734';
const queryPermission = 'erp:fenbeitong-voucher:query';
const configPermission = 'erp:fenbeitong-voucher:config';
const savePermission = 'erp:fenbeitong-voucher:save';

let validateServer;
let validatePort;
let assistant;
let appDataDir;
let validateCalls = 0;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function validationData(permissions) {
  return {
    valid: true,
    userId: 203,
    permissions,
    expiresTime: '2099-01-01T00:00:00',
    kingdeeConfig: {
      baseUrl: 'http://kingdee.example.test/K3Cloud',
      acctId: 'acct-from-int-ruoyi',
      username: 'session-user',
      password: 'session-password',
      lcid: 2052
    }
  };
}

function waitForAssistant(process) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('assistant did not start')), 10000);
    process.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Fenbeitong assistant listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    process.stderr.on('data', (chunk) => {
      const output = String(chunk);
      if (/EADDRINUSE|fixed port|ticket validate/i.test(output)) {
        clearTimeout(timeout);
        reject(new Error(output));
      }
    });
    process.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`assistant exited before test completed: ${code}`));
    });
  });
}

function sessionFrom(response) {
  const location = response.headers.location || '';
  const parsed = new URL(location, assistantUrl);
  return {
    id: parsed.searchParams.get('assistantSession'),
    cookie: response.headers['set-cookie']?.[0]?.split(';')[0] || ''
  };
}

async function openTicket(ticket) {
  const response = await request(`${assistantUrl}/auth/callback?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(response.statusCode, 302);
  const session = sessionFrom(response);
  assert.ok(session.id);
  assert.ok(session.cookie);
  return session;
}

before(async () => {
  validateServer = http.createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/validate');
    validateCalls += 1;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const ticket = JSON.parse(Buffer.concat(chunks).toString('utf8')).ticket;
    const data = ticket === 'query-ticket'
      ? validationData([queryPermission])
      : ticket === 'full-ticket'
        ? validationData([queryPermission, configPermission, savePermission])
        : { valid: false, reason: 'missing' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 0, data }));
  });
  validatePort = await listen(validateServer);
  appDataDir = mkdtempSync(join(tmpdir(), 'fenbeitong-assistant-auth-'));
  assistant = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FENBEITONG_ASSISTANT_HOST: '127.0.0.1',
      FENBEITONG_ASSISTANT_PORT: '18734',
      FENBEITONG_ASSISTANT_TICKET_VALIDATE_URL: `http://127.0.0.1:${validatePort}/validate`,
      FENBEITONG_ASSISTANT_SESSION_TTL_SECONDS: '60',
      APP_DATA_DIR: appDataDir,
      FENBEITONG_MODE: 'mock',
      KINGDEE_MODE: 'mock'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForAssistant(assistant);
});

after(async () => {
  if (assistant?.exitCode === null) {
    const exited = new Promise((resolve) => assistant.once('exit', resolve));
    assistant.kill();
    await exited;
  }
  if (validateServer?.listening) {
    await new Promise((resolve, reject) => validateServer.close((error) => (
      error ? reject(error) : resolve()
    )));
  }
  if (appDataDir) rmSync(appDataDir, { recursive: true, force: true });
});

test('integrated entry rejects a non-fixed public port', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FENBEITONG_ASSISTANT_PORT: '18735',
      FENBEITONG_ASSISTANT_TICKET_VALIDATE_URL: 'http://127.0.0.1/validate'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixed port must be 18734/i);
});

test('direct page and business API access are rejected', async () => {
  const page = await request(`${assistantUrl}/`);
  assert.equal(page.statusCode, 403);
  assert.match(page.body, /没有分贝通费用报销权限/);

  const api = await request(`${assistantUrl}/api/system/status`);
  assert.equal(api.statusCode, 403);
  assert.equal(JSON.parse(api.body).error.code, 'ASSISTANT_SESSION_REQUIRED');

  const health = await request(`${assistantUrl}/api/health`);
  assert.equal(health.statusCode, 200);
});

test('valid ticket creates a session and callback replay does not consume it twice', async () => {
  const beforeCalls = validateCalls;
  const first = await request(`${assistantUrl}/auth/callback?ticket=query-ticket`, {
    headers: { 'User-Agent': 'assistant-auth-test' }
  });
  assert.equal(first.statusCode, 302);
  const session = sessionFrom(first);
  assert.ok(session.id);

  const second = await request(`${assistantUrl}/auth/callback?ticket=query-ticket`, {
    headers: { 'User-Agent': 'assistant-auth-test' }
  });
  assert.equal(second.statusCode, 302);
  assert.equal(sessionFrom(second).id, session.id);
  assert.equal(validateCalls, beforeCalls + 1);

  const page = await request(`${assistantUrl}/?assistantSession=${session.id}`, {
    headers: { Cookie: session.cookie }
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /分贝通金蝶费用报销单工作台/);
});

test('a new ERP ticket replaces an existing browser session', async () => {
  const querySession = await openTicket('query-ticket');
  const beforeCalls = validateCalls;
  const response = await request(`${assistantUrl}/auth/callback?ticket=full-ticket`, {
    headers: { Cookie: querySession.cookie }
  });
  assert.equal(response.statusCode, 302);
  const fullSession = sessionFrom(response);
  assert.notEqual(fullSession.id, querySession.id);
  assert.equal(validateCalls, beforeCalls + 1);

  const sessionResponse = await request(`${assistantUrl}/api/assistant/session`, {
    headers: { 'x-fenbeitong-assistant-session': fullSession.id }
  });
  assert.equal(sessionResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(sessionResponse.body).data.permissions, [
    queryPermission,
    configPermission,
    savePermission
  ]);
});

test('invalid ticket is rejected', async () => {
  const response = await request(`${assistantUrl}/auth/callback?ticket=invalid-ticket`);
  assert.equal(response.statusCode, 403);
  assert.match(response.body, /没有分贝通费用报销权限/);
});

test('query-only session cannot call config or save operations', async () => {
  const session = await openTicket('query-ticket');
  const headers = {
    'Content-Type': 'application/json',
    'x-fenbeitong-assistant-session': session.id
  };

  const sessionResponse = await request(`${assistantUrl}/api/assistant/session`, { headers });
  assert.equal(sessionResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(sessionResponse.body).data.permissions, [queryPermission]);

  const configResponse = await request(`${assistantUrl}/api/integration-settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      tenantKey: 'puhui',
      kingdeeAccountKey: 'current',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    })
  });
  assert.equal(configResponse.statusCode, 403);
  assert.equal(JSON.parse(configResponse.body).error.code, 'ASSISTANT_PERMISSION_DENIED');

  const saveResponse = await request(`${assistantUrl}/api/fenbeitong-expense-reimbursement/save-erp`, {
    method: 'POST',
    headers,
    body: '{}'
  });
  assert.equal(saveResponse.statusCode, 403);
  assert.equal(JSON.parse(saveResponse.body).error.code, 'ASSISTANT_PERMISSION_DENIED');

  for (const path of [
    '/api/fenbeitong-expense-reimbursement/prepare',
    '/api/payment-status-sync/run',
    '/api/scheduler/run-once'
  ]) {
    const result = await request(assistantUrl + path, { method: 'POST', headers, body: '{}' });
    assert.equal(result.statusCode, 403, path);
    assert.equal(JSON.parse(result.body).error.code, 'ASSISTANT_PERMISSION_DENIED', path);
  }
});

test('query-only session reaches sync input validation without ERP write permission', async () => {
  const session = await openTicket('query-ticket');
  const response = await request(`${assistantUrl}/api/fenbeitong-expense-reimbursement/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fenbeitong-assistant-session': session.id
    },
    // Reach the real sync handler, but reject before creating a batch or calling upstream.
    body: '{'
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error.message, 'request body must be valid JSON');
});

test('business APIs reject cookie-only authentication', async () => {
  const session = await openTicket('full-ticket');
  const response = await request(`${assistantUrl}/api/system/status`, {
    headers: { Cookie: session.cookie }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).error.code, 'ASSISTANT_SESSION_REQUIRED');
});

test('full session can update integration selection with the session ERP account', async () => {
  const session = await openTicket('full-ticket');
  const response = await request(`${assistantUrl}/api/integration-settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-fenbeitong-assistant-session': session.id
    },
    body: JSON.stringify({
      tenantKey: 'puhui',
      kingdeeAccountKey: 'current',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).data.selection.kingdeeAccountKey, 'current');
});
