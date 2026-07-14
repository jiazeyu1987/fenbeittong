import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFenbeitongTenant,
  listFenbeitongTenants,
  resetTenantStoreForTest,
  saveFenbeitongTenantCredentials,
  updateFenbeitongTenantToken
} from '../src/tenant-store.js';

test('SQLite tenant store seeds public Puhui and Yingtai tenant records', () => {
  const restore = useTenantStoreDataDir('runtime-data/test-tenant-store-seed');
  try {
    resetTenantStoreForTest();

    const tenants = listFenbeitongTenants();

    assert.deepEqual(tenants.map((tenant) => tenant.key), ['puhui', 'yingtai']);
    assert.equal(tenants.find((tenant) => tenant.key === 'puhui').name, '璞慧');
    assert.equal(tenants.find((tenant) => tenant.key === 'puhui').refreshIntervalSeconds, 7200);
    assert.equal(tenants.find((tenant) => tenant.key === 'yingtai').status, 'waiting_development');
    assert.equal(Object.hasOwn(tenants[0], 'appKey'), false);
    assert.equal(Object.hasOwn(tenants[0], 'accessToken'), false);
  } finally {
    resetTenantStoreForTest();
    restore();
  }
});

test('SQLite tenant store persists credentials and tenant-specific token expiry', () => {
  const restore = useTenantStoreDataDir('runtime-data/test-tenant-store-credentials');
  try {
    resetTenantStoreForTest();
    saveFenbeitongTenantCredentials({
      key: 'puhui',
      name: '璞慧',
      status: 'ready',
      authMode: 'app-key',
      baseUrl: 'https://openapi.example.test',
      appId: 'sqlite-app-id',
      appKey: 'sqlite-app-key',
      refreshIntervalSeconds: 3600
    });

    const publicTenant = getFenbeitongTenant('puhui');
    assert.equal(publicTenant.credentialsConfigured, true);
    assert.equal(publicTenant.refreshIntervalSeconds, 3600);
    assert.equal(Object.hasOwn(publicTenant, 'appKey'), false);

    const privateTenant = getFenbeitongTenant('puhui', { includeSecrets: true });
    assert.equal(privateTenant.appId, 'sqlite-app-id');
    assert.equal(privateTenant.appKey, 'sqlite-app-key');

    updateFenbeitongTenantToken('puhui', {
      accessToken: 'sqlite-access-token',
      expiresAt: '2026-07-14T12:00:00.000Z'
    });

    const tokenTenant = getFenbeitongTenant('puhui', { includeSecrets: true });
    assert.equal(tokenTenant.accessToken, 'sqlite-access-token');
    assert.equal(tokenTenant.tokenExpiresAt, '2026-07-14T12:00:00.000Z');
  } finally {
    resetTenantStoreForTest();
    restore();
  }
});

function useTenantStoreDataDir(dataDir) {
  const previous = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dataDir;
  return () => {
    if (previous === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previous;
    }
  };
}

