import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './backend/src/config.js';
import {
  normalizeAssistantKingdeeConfig,
  runWithAssistantSession
} from './backend/src/assistant-session-context.js';
import { handleApi } from './backend/src/routes.js';

loadLocalEnv();

const root = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(root, 'frontend/src');
const fixedPort = 18734;
const configuredPort = process.env.FENBEITONG_ASSISTANT_PORT;
if (configuredPort !== undefined && Number(configuredPort) !== fixedPort) {
  throw new Error('Fenbeitong assistant fixed port must be 18734.');
}
const port = fixedPort;
const host = process.env.FENBEITONG_ASSISTANT_HOST
  || (process.platform === 'win32' ? '127.0.0.1' : '0.0.0.0');
const ticketValidateUrl = requiredEnvironment('FENBEITONG_ASSISTANT_TICKET_VALIDATE_URL');
const sessionTtlSeconds = positiveInteger(
  process.env.FENBEITONG_ASSISTANT_SESSION_TTL_SECONDS || 14_400,
  'FENBEITONG_ASSISTANT_SESSION_TTL_SECONDS'
);
const sessionHeaderName = 'x-fenbeitong-assistant-session';
const sessionCookieName = 'fenbeitong_assistant_session';
const sessionQueryName = 'assistantSession';
const callbackReplayTtlMillis = 30_000;
const queryPermission = 'erp:fenbeitong-voucher:query';
const configPermission = 'erp:fenbeitong-voucher:config';
const savePermission = 'erp:fenbeitong-voucher:save';
const sessions = new Map();
const callbackReplayGrants = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const pair of String(cookieHeader || '').split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

function getSessionId(request, requestUrl) {
  const header = request.headers[sessionHeaderName];
  if (header) return String(Array.isArray(header) ? header[0] : header).trim();
  const query = requestUrl.searchParams.get(sessionQueryName);
  if (query) return query.trim();
  return parseCookies(request.headers.cookie)[sessionCookieName] || '';
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) sessions.delete(sessionId);
  }
  for (const [ticket, grant] of callbackReplayGrants.entries()) {
    if (!grant || grant.expiresAt <= now || !sessions.has(grant.sessionId)) {
      callbackReplayGrants.delete(ticket);
    }
  }
}

function getSession(request, requestUrl) {
  cleanupExpiredSessions();
  return sessions.get(getSessionId(request, requestUrl)) || null;
}

function getApiSession(request) {
  cleanupExpiredSessions();
  const header = request.headers[sessionHeaderName];
  const sessionId = String(Array.isArray(header) ? header[0] : header || '').trim();
  return sessionId ? sessions.get(sessionId) || null : null;
}

function callbackUserAgent(request) {
  const value = request.headers['user-agent'];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function replaySessionId(ticket, request) {
  cleanupExpiredSessions();
  const grant = callbackReplayGrants.get(ticket);
  if (!grant || grant.userAgent !== callbackUserAgent(request)) return '';
  return sessions.has(grant.sessionId) ? grant.sessionId : '';
}

function rememberCallback(ticket, sessionId, request) {
  callbackReplayGrants.set(ticket, {
    sessionId,
    userAgent: callbackUserAgent(request),
    expiresAt: Date.now() + Math.min(callbackReplayTtlMillis, sessionTtlSeconds * 1000)
  });
}

function createAssistantSession(validation) {
  const permissions = [...new Set(
    (Array.isArray(validation.permissions) ? validation.permissions : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  if (!permissions.includes(queryPermission)) {
    throw new Error('ERP 授权响应缺少分贝通费用报销查询权限。');
  }
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    userId: validation.userId,
    permissions,
    kingdeeConfig: normalizeAssistantKingdeeConfig(validation.kingdeeConfig),
    expiresAt: Date.now() + sessionTtlSeconds * 1000
  });
  return sessionId;
}

async function validateTicket(ticket) {
  const response = await fetch(ticketValidateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket })
  });
  if (!response.ok) throw new Error(`ERP 授权校验失败：HTTP ${response.status}`);
  const body = await response.json();
  if (body?.code !== 0) {
    throw new Error(body?.msg || 'ERP 拒绝了分贝通助手授权。');
  }
  return body.data || { valid: false, reason: 'empty_response' };
}

function redirectToSession(response, sessionId) {
  response.writeHead(302, {
    Location: `/?${sessionQueryName}=${encodeURIComponent(sessionId)}`,
    'Set-Cookie': `${sessionCookieName}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionTtlSeconds}`,
    'Cache-Control': 'no-store'
  });
  response.end();
}

async function handleAuthCallback(request, response, requestUrl) {
  const ticket = String(requestUrl.searchParams.get('ticket') || '').trim();
  if (!ticket) return sendForbiddenPage(response, '没有取得 ERP 授权票据，请从 ERP 系统入口重新进入。');

  const replay = replaySessionId(ticket, request);
  if (replay) return redirectToSession(response, replay);

  try {
    const validation = await validateTicket(ticket);
    if (!validation.valid) {
      return sendForbiddenPage(response, '没有分贝通费用报销权限，请从 ERP 系统入口重新进入。');
    }
    const sessionId = createAssistantSession(validation);
    rememberCallback(ticket, sessionId, request);
    return redirectToSession(response, sessionId);
  } catch (error) {
    return sendForbiddenPage(response, String(error?.message || error), 503);
  }
}

function requiredPermission(method, pathname) {
  if (method === 'PUT') return configPermission;
  if (method === 'POST' && [
    '/api/scheduler/run-once',
    '/api/payment-status-sync/run',
    '/api/fenbeitong-expense-reimbursement/prepare',
    '/api/fenbeitong-expense-reimbursement/save-erp'
  ].includes(pathname)) return savePermission;
  return queryPermission;
}

function hasPermission(session, permission) {
  return session.permissions.includes(permission);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function sendApiForbidden(response, code, message) {
  sendJson(response, 403, { success: false, error: { code, message, detail: {} } });
}

function sendForbiddenPage(response, message = '没有分贝通费用报销权限，请从 ERP 系统入口重新进入。', statusCode = 403) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>无权访问</title></head><body><main><h1>无权访问分贝通费用报销助手</h1><p>${escapeHtml(message)}</p></main></body></html>`);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sendStatic(response, pathname) {
  const decodedPath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const fullPath = resolve(join(publicDirectory, decodedPath));
  const pathFromRoot = relative(publicDirectory, fullPath);
  if (!pathFromRoot || pathFromRoot.startsWith('..') || resolve(publicDirectory, pathFromRoot) !== fullPath) {
    return sendForbiddenPage(response, '请求路径无效。');
  }
  try {
    if (!statSync(fullPath).isFile()) throw new Error('not a file');
    const content = readFileSync(fullPath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(fullPath)] || 'application/octet-stream',
      'Cache-Control': extname(fullPath) === '.html' ? 'no-store' : 'private, max-age=300'
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      return sendJson(response, 200, { success: true, status: 'ok' });
    }
    if (request.method === 'GET' && requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    if (request.method === 'GET' && requestUrl.pathname === '/auth/callback') {
      return await handleAuthCallback(request, response, requestUrl);
    }

    const session = requestUrl.pathname.startsWith('/api/')
      ? getApiSession(request)
      : getSession(request, requestUrl);
    if (!session) {
      if (requestUrl.pathname.startsWith('/api/')) {
        return sendApiForbidden(
          response,
          'ASSISTANT_SESSION_REQUIRED',
          '没有分贝通费用报销权限，请从 ERP 系统入口重新进入。'
        );
      }
      return sendForbiddenPage(response);
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/assistant/session') {
      return sendJson(response, 200, {
        success: true,
        data: {
          userId: session.userId,
          permissions: session.permissions,
          expiresTime: new Date(session.expiresAt).toISOString()
        }
      });
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      const permission = requiredPermission(request.method || 'GET', requestUrl.pathname);
      if (!hasPermission(session, permission)) {
        return sendApiForbidden(
          response,
          'ASSISTANT_PERMISSION_DENIED',
          `当前账号缺少权限：${permission}`
        );
      }
      return await runWithAssistantSession(session, () => handleApi(request, response));
    }

    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      return response.end();
    }
    return sendStatic(response, requestUrl.pathname);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    sendJson(response, 500, {
      success: false,
      error: { code: 'ASSISTANT_REQUEST_FAILED', message: String(error?.message || error), detail: {} }
    });
  }
});

server.listen(port, host, () => {
  console.log(`Fenbeitong assistant listening on http://${host}:${port}`);
});
