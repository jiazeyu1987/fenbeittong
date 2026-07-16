import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../backend/src/routes.js';
import { resetRepository } from '../backend/src/repository.js';

function startServer() {
  const server = createServer(handleApi);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}
test('mock user path can template, sync Fenbeitong, push ERP, and query', async () => {
  const restoreEnv = forceMockExternalEnv();
  const restoreFetch = stubKingdeeFetch();
  resetRepository();
  const { server, baseUrl } = await startServer();
  try {
    const templateResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/config/mock-template`);
    const templateBody = await templateResponse.json();
    assert.equal(templateBody.success, true);

    const statusResponse = await fetch(`${baseUrl}/api/system/status`);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.data.mode.fenbeitong, 'mock');
    assert.equal(statusBody.data.config.fenbeitong.credentialStore, 'sqlite');
    assert.equal(Object.hasOwn(statusBody.data.config.fenbeitong.tenants[0], 'appKey'), false);
    assert.equal(statusBody.data.config.kingdee.accounts.some((account) => account.key === 'jia-zeyu'), true);
    assert.equal(statusBody.data.config.kingdee.acctIds.some((acctId) => acctId.key === 'puhui-6977227150362f'), true);
    assert.equal(statusBody.data.config.integrationSelection.tenantKey, 'puhui');

    const settingsResponse = await fetch(`${baseUrl}/api/integration-settings`);
    const settingsBody = await settingsResponse.json();
    assert.equal(settingsBody.success, true);
    assert.equal(settingsBody.data.selection.tenantKey, 'puhui');
    assert.equal(settingsBody.data.selection.kingdeeAccountKey, 'current');
    assert.equal(settingsBody.data.selection.kingdeeAcctIdKey, 'puhui-6977227150362f');
    assert.equal(settingsBody.data.kingdeeAccounts.some((account) => account.key === 'jia-zeyu'), true);
    assert.equal(settingsBody.data.kingdeeAcctIds.some((acctId) => acctId.key === 'puhui-6977227150362f'), true);
    assert.equal(JSON.stringify(settingsBody.data).includes('test-password'), false);

    const savedSettingsBody = await postJson(`${baseUrl}/api/integration-settings`, {
      tenantKey: 'yingtai',
      kingdeeAccountKey: 'jia-zeyu',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    }, 'PUT');
    assert.equal(savedSettingsBody.success, true);
    assert.equal(savedSettingsBody.data.selection.tenantKey, 'yingtai');
    assert.equal(savedSettingsBody.data.selection.kingdeeAccountKey, 'jia-zeyu');
    assert.equal(savedSettingsBody.data.selection.kingdeeAcctIdKey, 'puhui-6977227150362f');
    const restoredSettingsBody = await postJson(`${baseUrl}/api/integration-settings`, {
      tenantKey: 'puhui',
      kingdeeAccountKey: 'current',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    }, 'PUT');
    assert.equal(restoredSettingsBody.data.selection.tenantKey, 'puhui');

    const readyResponse = await fetch(`${baseUrl}/api/ready`);
    const readyBody = await readyResponse.json();
    assert.equal(readyBody.data.ready, true);

    const schedulerStatusResponse = await fetch(`${baseUrl}/api/scheduler/status`);
    const schedulerStatusBody = await schedulerStatusResponse.json();
    assert.equal(schedulerStatusBody.data.enabled, false);
    assert.equal(schedulerStatusBody.data.autoPushErp, false);

    const template = templateBody.data;
    const request = {
      fixedJson: template.mockFixedJson,
      voucherDate: template.mockVoucherDate,
      year: template.mockYear,
      period: template.mockPeriod,
      config: template
    };

    const previewBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/preview`, request);
    assert.equal(previewBody.data.balanced, true);
    assert.ok(previewBody.data.voucherLines.length >= 2);
    assert.equal(previewBody.data.sourceSummary.requester, 'Mock User');
    assert.equal(previewBody.data.taxSummary.deductibleTaxAmount, 0);
    assert.equal(previewBody.data.voucherLines.some((line) => line.lineType === 'TAX'), false);
    assert.equal(previewBody.data.financialSummary.documentStatusName, 'Saved draft only; not submitted, audited, or posted');

    const syncBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/sync`, {});
    assert.equal(syncBody.data.batch.status, 'SUCCESS');
    assert.equal(syncBody.data.batch.mockReplacement, true);
    assert.equal(syncBody.data.records.length, 100);
    assert.equal(syncBody.data.records[0].processStage, 'SYNCED');
    assert.equal(syncBody.data.records[0].mockReplacement, true);
    const sourceId = syncBody.data.records[0].sourceId;

    const syncedDocumentsResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/synced-documents`);
    const syncedDocumentsBody = await syncedDocumentsResponse.json();
    assert.equal(syncedDocumentsBody.data.length, 100);
    assert.equal(syncedDocumentsBody.data[0].batchId, syncBody.data.batch.batchId);
    assert.equal(syncedDocumentsBody.data[0].mockReplacement, true);

    const schedulerRunBody = await postJson(`${baseUrl}/api/scheduler/run-once`, {});
    assert.equal(schedulerRunBody.data.sync.batch.status, 'SUCCESS');
    assert.equal(schedulerRunBody.data.sync.records[0].processStage, 'SYNCED');

    const pushBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/push-erp`, {
      sourceId,
      voucherDate: template.mockVoucherDate,
      year: template.mockYear,
      period: template.mockPeriod,
      config: template,
      kingdeeAccountKey: 'jia-zeyu',
      kingdeeAcctIdKey: 'puhui-6977227150362f'
    });
    assert.equal(pushBody.data.processStage, 'ERP_PUSHED');
    assert.equal(pushBody.data.erpFid, '100033');
    assert.equal(pushBody.data.erpMockReplacement, false);

    const duplicatePushBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/push-erp`, {
      sourceId,
      voucherDate: template.mockVoucherDate,
      year: template.mockYear,
      period: template.mockPeriod,
      config: template
    });
    assert.equal(duplicatePushBody.success, false);
    assert.match(duplicatePushBody.error.message, /already pushed to ERP/);

    const queryResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/process/${sourceId}`);
    const queryBody = await queryResponse.json();
    assert.equal(queryBody.data.sourceId, sourceId);

    const recordsResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/process`);
    const recordsBody = await recordsResponse.json();
    assert.equal(recordsBody.data.length, 1);

    const logsResponse = await fetch(`${baseUrl}/api/operations/logs`);
    const logsBody = await logsResponse.json();
    assert.ok(logsBody.data.some((log) => log.action === 'ERP_PUSH'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreFetch();
    restoreEnv();
  }
});

async function postJson(url, body, method = 'POST') {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

function forceMockExternalEnv() {
  const previous = {
    APP_DATA_DIR: process.env.APP_DATA_DIR,
    FENBEITONG_MODE: process.env.FENBEITONG_MODE,
    KINGDEE_MODE: process.env.KINGDEE_MODE,
    KINGDEE_BASE_URL: process.env.KINGDEE_BASE_URL,
    KINGDEE_ACCT_ID: process.env.KINGDEE_ACCT_ID,
    KINGDEE_ACCT_ID_KEY: process.env.KINGDEE_ACCT_ID_KEY,
    KINGDEE_ACCT_ID_LABEL: process.env.KINGDEE_ACCT_ID_LABEL,
    KINGDEE_USERNAME: process.env.KINGDEE_USERNAME,
    KINGDEE_PASSWORD: process.env.KINGDEE_PASSWORD,
    KINGDEE_ACCOUNT_JIAZEYU_ENABLED: process.env.KINGDEE_ACCOUNT_JIAZEYU_ENABLED,
    KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID: process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID,
    KINGDEE_ACCOUNT_JIAZEYU_USERNAME: process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME,
    KINGDEE_ACCOUNT_JIAZEYU_PASSWORD: process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD
  };
  process.env.APP_DATA_DIR = 'runtime-data/e2e-flow';
  process.env.FENBEITONG_MODE = 'mock';
  process.env.KINGDEE_MODE = 'real';
  process.env.KINGDEE_BASE_URL = 'http://172.30.30.8';
  process.env.KINGDEE_ACCT_ID = '6977227150362f';
  process.env.KINGDEE_ACCT_ID_KEY = 'puhui-6977227150362f';
  process.env.KINGDEE_ACCT_ID_LABEL = 'Puhui verified acctID';
  process.env.KINGDEE_USERNAME = 'test-user';
  process.env.KINGDEE_PASSWORD = 'test-password';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_ENABLED = 'true';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID = '6977227150362f';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME = 'jia-user';
  process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD = 'jia-password';
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

function stubKingdeeFetch() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      assert.match(String(options.body), /acctID=6977227150362f/);
      assert.match(String(options.body), /username=jia-user/);
      return new Response(JSON.stringify({ LoginResultType: 1 }), {
        status: 200,
        headers: { 'Set-Cookie': 'kdservice-sessionid=e2e123; Path=/K3Cloud' }
      });
    }
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      assert.equal(options.headers.Cookie, 'kdservice-sessionid=e2e123');
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'GL_VOUCHER');
      const payload = JSON.parse(body.data);
      assert.equal(payload.Model.ACCBOOKORGID.Number, '886');
      assert.ok(payload.Model.FEntity.length >= 2);
      return new Response(JSON.stringify({
        Result: {
          Id: '100033',
          Number: '23',
          ResponseStatus: { IsSuccess: true, Errors: [] }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'GL_VOUCHER');
      assert.equal(JSON.parse(body.data).Id, '100033');
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 100033,
            FBillNo: '23',
            AccountBookID: { Number: '007' },
            ACCBOOKORGID: { Number: '886' },
            VOUCHERGROUPID: { Number: 'PZZ9' },
            FDocumentStatus: 'Z'
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return previousFetch(url, options);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}
