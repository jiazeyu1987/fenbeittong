import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAssistantSessionContext,
  runWithAssistantSession
} from '../src/assistant-session-context.js';
import { getAppConfig, getEffectiveKingdeeConfig } from '../src/config.js';

const session = {
  userId: 203,
  permissions: ['erp:fenbeitong-voucher:query'],
  kingdeeConfig: {
    baseUrl: 'http://kingdee.session.test/K3Cloud',
    acctId: 'session-acct',
    username: 'session-user',
    password: 'session-password',
    appId: 'session-app',
    signedData: 'session-signature',
    timestamp: '1700000000',
    lcid: 2052
  }
};

test('request context exposes only the active assistant session', async () => {
  assert.equal(getAssistantSessionContext(), null);
  await runWithAssistantSession(session, async () => {
    assert.equal(getAssistantSessionContext().userId, 203);
    await Promise.resolve();
    assert.equal(getAssistantSessionContext().kingdeeConfig.acctId, 'session-acct');
  });
  assert.equal(getAssistantSessionContext(), null);
});

test('Kingdee configuration comes from the current assistant session', () => {
  runWithAssistantSession(session, () => {
    const appConfig = getAppConfig();
    const config = getEffectiveKingdeeConfig('current', 'puhui-6977227150362f');
    assert.equal(appConfig.kingdee.mode, 'real');
    assert.equal(config.baseUrl, 'http://kingdee.session.test/K3Cloud');
    assert.equal(config.acctId, 'session-acct');
    assert.equal(config.username, 'session-user');
    assert.equal(config.password, 'session-password');
  });
});

test('missing session Kingdee fields fail fast instead of using process credentials', () => {
  assert.throws(() => runWithAssistantSession({
    ...session,
    kingdeeConfig: { ...session.kingdeeConfig, password: '' }
  }, () => getAppConfig()), /kingdeeConfig\.password/);
});
