import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../backend/src/routes.js';

function startServer() {
  const server = createServer(handleApi);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('mock user path can template, sync Fenbeitong, push ERP, and query', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const templateResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/config/mock-template`);
    const templateBody = await templateResponse.json();
    assert.equal(templateBody.success, true);

    const statusResponse = await fetch(`${baseUrl}/api/system/status`);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.data.mode.fenbeitong, 'mock');
    assert.equal(statusBody.data.config.fenbeitong.accessTokenConfigured, false);

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
    assert.equal(previewBody.data.taxSummary.deductibleTaxAmount, 6.11);
    assert.ok(previewBody.data.voucherLines.some((line) => line.lineType === 'TAX'));
    assert.equal(previewBody.data.financialSummary.documentStatusName, 'Saved draft only; not submitted, audited, or posted');

    const syncBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/sync`, {});
    assert.equal(syncBody.data.batch.status, 'SUCCESS');
    assert.equal(syncBody.data.batch.mockReplacement, true);
    assert.equal(syncBody.data.records[0].processStage, 'SYNCED');
    assert.equal(syncBody.data.records[0].mockReplacement, true);

    const syncedDocumentsResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/synced-documents`);
    const syncedDocumentsBody = await syncedDocumentsResponse.json();
    assert.equal(syncedDocumentsBody.data[0].sourceId, 'MOCK-REIMB-001');
    assert.equal(syncedDocumentsBody.data[0].batchId, syncBody.data.batch.batchId);
    assert.equal(syncedDocumentsBody.data[0].mockReplacement, true);

    const schedulerRunBody = await postJson(`${baseUrl}/api/scheduler/run-once`, {});
    assert.equal(schedulerRunBody.data.sync.batch.status, 'SUCCESS');
    assert.equal(schedulerRunBody.data.sync.records[0].processStage, 'SYNCED');

    const pushBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/push-erp`, {
      sourceId: syncBody.data.records[0].sourceId,
      voucherDate: template.mockVoucherDate,
      year: template.mockYear,
      period: template.mockPeriod,
      config: template
    });
    assert.equal(pushBody.data.processStage, 'ERP_PUSHED');
    assert.equal(pushBody.data.erpFid, 'MOCK-KINGDEE-FID');
    assert.equal(pushBody.data.erpMockReplacement, true);

    const duplicatePushBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/push-erp`, {
      sourceId: syncBody.data.records[0].sourceId,
      voucherDate: template.mockVoucherDate,
      year: template.mockYear,
      period: template.mockPeriod,
      config: template
    });
    assert.equal(duplicatePushBody.success, false);
    assert.match(duplicatePushBody.error.message, /already pushed to ERP/);

    const queryResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/process/MOCK-REIMB-001`);
    const queryBody = await queryResponse.json();
    assert.equal(queryBody.data.sourceId, 'MOCK-REIMB-001');

    const recordsResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/process`);
    const recordsBody = await recordsResponse.json();
    assert.equal(recordsBody.data.length, 1);

    const logsResponse = await fetch(`${baseUrl}/api/operations/logs`);
    const logsBody = await logsResponse.json();
    assert.ok(logsBody.data.some((log) => log.action === 'ERP_PUSH'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}
