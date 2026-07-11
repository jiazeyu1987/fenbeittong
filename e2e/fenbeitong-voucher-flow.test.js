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

test('mock user path can template, preview, prepare, and query', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const templateResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/config/mock-template`);
    const templateBody = await templateResponse.json();
    assert.equal(templateBody.success, true);

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

    const prepareBody = await postJson(`${baseUrl}/api/fenbeitong-voucher/prepare`, request);
    assert.equal(prepareBody.data.processStage, 'PREPARED');

    const queryResponse = await fetch(`${baseUrl}/api/fenbeitong-voucher/process/MOCK-REIMB-001`);
    const queryBody = await queryResponse.json();
    assert.equal(queryBody.data.sourceId, 'MOCK-REIMB-001');
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
