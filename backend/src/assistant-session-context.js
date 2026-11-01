import { AsyncLocalStorage } from 'node:async_hooks';

const assistantSessionStorage = new AsyncLocalStorage();

export function runWithAssistantSession(session, callback) {
  return assistantSessionStorage.run(session, callback);
}

export function getAssistantSessionContext() {
  return assistantSessionStorage.getStore() || null;
}

export function normalizeAssistantKingdeeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('ERP 授权响应缺少 kingdeeConfig。');
  }
  return {
    baseUrl: requiredText(input.baseUrl, 'kingdeeConfig.baseUrl'),
    acctId: requiredText(input.acctId, 'kingdeeConfig.acctId'),
    username: requiredText(input.username, 'kingdeeConfig.username'),
    password: requiredText(input.password, 'kingdeeConfig.password'),
    lcid: positiveInteger(input.lcid, 'kingdeeConfig.lcid')
  };
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  if (/\r|\n/.test(text)) throw new Error(`${field} contains an invalid line break`);
  return text;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return number;
}
