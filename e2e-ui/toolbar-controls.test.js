import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { handleApi } from '../backend/src/routes.js';
import { resetRepository } from '../backend/src/repository.js';

function startApiServer() {
  const server = createServer(handleApi);
  return new Promise((resolve) => {
    server.listen(3001, '127.0.0.1', () => resolve(server));
  });
}
function startFrontendServer() {
  const root = new URL('../frontend/src/', import.meta.url);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = pathname === '/' ? 'index.html' : pathname.slice(1);
    try {
      const file = await import('node:fs/promises');
      const data = await file.readFile(new URL(path, root));
      const contentType = path.endsWith('.js')
        ? 'application/javascript; charset=utf-8'
        : path.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/html; charset=utf-8';
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(5173, '127.0.0.1', () => resolve(server));
  });
}

test('finance toolbar controls each produce observable E2E effects', async () => {
  const restoreEnv = forceMockExternalEnv();
  resetRepository();
  await stopKnownDevServers();
  const apiServer = await startApiServer();
  const frontendServer = await startFrontendServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });

  try {
    await page.goto('http://127.0.0.1:5173');
    await page.waitForSelector('#syncFenbeitongButton');

    await page.click('#syncFenbeitongButton');
    await expectTotal(page, 'Total 100');
    assert.equal(await rowCount(page), 100);
    assert.equal(await page.locator('th[data-column-key="operationPanel"]').innerText(), '\u64cd\u4f5c\u9762\u677f');
    assert.equal(await page.locator('button.row-generate-voucher').count(), 100);

    const selectedBeforeRowAction = await page.locator('input.row-checkbox:checked').count();
    const singleRowAction = page.locator('button.row-generate-voucher').nth(1);
    const singleRowSourceId = await singleRowAction.getAttribute('data-source-id');
    await singleRowAction.click();
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-voucher/process',
      (body) => body.data.filter((record) => record.processStage === 'ERP_PUSHED').length === 1
        && body.data.some((record) => record.sourceId === singleRowSourceId && record.processStage === 'ERP_PUSHED')
    );
    await page.waitForSelector('#operationFeedback:not([hidden])');
    assert.equal(await page.locator('#operationFeedback').innerText(), '保存成功');
    await page.waitForFunction((sourceId) => {
      const output = document.querySelector('#resultOutput')?.textContent || '';
      return output.includes(sourceId) && output.includes('ERP_PUSHED');
    }, singleRowSourceId);
    assert.equal(await page.locator('input.row-checkbox:checked').count(), selectedBeforeRowAction);

    const requester = await firstCellText(page, 'requester');
    await page.selectOption('#searchFieldSelect', 'requester');
    await page.selectOption('#matchModeSelect', 'contains');
    await page.fill('#sourceSearchInput', requester);
    await page.click('#queryLedgerButton');
    const containsTotal = await waitForTotalNot(page, 100);
    assert.ok(containsTotal > 0 && containsTotal < 100);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value.includes(requester)));

    await page.selectOption('#matchModeSelect', 'equals');
    await page.fill('#sourceSearchInput', requester);
    await page.click('#queryLedgerButton');
    const equalsTotal = await waitForTotalValue(page, containsTotal);
    assert.ok(equalsTotal > 0);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value === requester));

    await page.selectOption('#matchModeSelect', 'notEquals');
    await page.fill('#sourceSearchInput', requester);
    await page.click('#queryLedgerButton');
    await expectTotal(page, `Total ${100 - equalsTotal}`);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value !== requester));

    await page.click('#resetButton');
    await expectTotal(page, 'Total 100');
    assert.equal(await page.inputValue('#sourceSearchInput'), '');
    assert.equal(await page.locator('#searchFieldSelect').inputValue(), 'sourceCode');
    assert.equal(await page.locator('#matchModeSelect').inputValue(), 'contains');

    await page.click('button[data-sort-field="sourceCode"]');
    assertSorted(await columnTexts(page, 'sourceCode'), 'asc');
    await page.click('button[data-sort-field="sourceCode"]');
    assertSorted(await columnTexts(page, 'sourceCode'), 'desc');

    await page.click('button[data-sort-field="amount"]');
    assertNumberSorted(await amountValues(page), 'asc');

    await page.click('#columnSettingsButton');
    await page.uncheck('input[data-column-toggle="requester"]');
    assert.equal(await page.locator('th[data-column-key="requester"]').isHidden(), true);
    await page.check('input[data-column-toggle="requester"]');
    assert.equal(await page.locator('th[data-column-key="requester"]').isVisible(), true);

    await clearCheckedRows(page);
    await page.locator('input.row-checkbox').nth(2).check();
    await page.locator('input.row-checkbox').nth(3).check();
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 2);
    await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('已选择 2 张来源单据'));

    assert.equal(await page.locator('#generateVoucherButton').innerText(), '\u751f\u6210\u51ed\u8bc1');
    assert.equal(await page.locator('#saveErpButton').innerText(), '\u4fdd\u5b58\u81f3ERP');
    const selectedSourceIds = await page.locator('input.row-checkbox:checked').evaluateAll((checkboxes) =>
      checkboxes.map((checkbox) => checkbox.dataset.sourceId)
    );
    await page.click('#generateVoucherButton');
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-voucher/process',
      (body) => selectedSourceIds.every((sourceId) =>
        body.data.some((record) => record.sourceId === sourceId && record.processStage === 'PREPARED')
      )
    );
    assert.equal(await page.locator('#saveErpButton').isEnabled(), true);
    await page.click('#saveErpButton');
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-voucher/process',
      (body) => body.data.filter((record) => record.processStage === 'ERP_PUSHED').length === 3
    );
    const pushedRecords = await fetchJson('http://127.0.0.1:3001/api/fenbeitong-voucher/process');
    assert.equal(pushedRecords.data.filter((record) => record.processStage === 'ERP_PUSHED').length, 3);

    await page.click('#viewVoucherButton');
    await page.waitForFunction(() => document.querySelector('#resultOutput')?.textContent.includes('ERP_PUSHED'));

    const downloadPromise = page.waitForEvent('download');
    await page.click('#exportButton');
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.csv$/);

    await page.locator('#selectAllRowsCheckbox').check();
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 100);
  } finally {
    await browser.close();
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => frontendServer.close(resolve));
    restoreEnv();
  }
});

async function expectTotal(page, text) {
  await page.waitForFunction((expected) => document.querySelector('#paginationSummary')?.textContent === expected, text);
}

async function waitForTotalNot(page, total) {
  await page.waitForFunction((value) => {
    const text = document.querySelector('#paginationSummary')?.textContent || '';
    const match = text.match(/Total (\d+)/);
    return match && Number(match[1]) !== value;
  }, total);
  return parseTotal(await page.locator('#paginationSummary').innerText());
}

async function waitForTotalValue(page, total) {
  await expectTotal(page, `Total ${total}`);
  return total;
}

async function clearCheckedRows(page) {
  while (await page.locator('input.row-checkbox:checked').count() > 0) {
    await page.locator('input.row-checkbox:checked').first().click();
  }
}

async function rowCount(page) {
  return page.locator('#sourceQueueBody tr').count();
}

async function firstCellText(page, key) {
  return page.locator(`#sourceQueueBody tr:first-child td[data-column-key="${key}"]`).innerText();
}

async function columnTexts(page, key) {
  return page.locator(`#sourceQueueBody td[data-column-key="${key}"]`).evaluateAll((cells) =>
    cells.map((cell) => cell.textContent.trim())
  );
}

async function amountValues(page) {
  const values = await columnTexts(page, 'amount');
  return values.map((value) => Number(value.replace(/,/g, '')));
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitForApiCondition(url, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastBody = null;
  while (Date.now() < deadline) {
    lastBody = await fetchJson(url);
    if (predicate(lastBody)) {
      return lastBody;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for API condition at ${url}; last body: ${JSON.stringify(lastBody)}`);
}

function parseTotal(text) {
  const match = text.match(/Total (\d+)/);
  return match ? Number(match[1]) : 0;
}

function assertSorted(values, direction) {
  const expected = [...values].sort((a, b) => a.localeCompare(b));
  if (direction === 'desc') {
    expected.reverse();
  }
  assert.deepEqual(values, expected);
}

function assertNumberSorted(values, direction) {
  const expected = [...values].sort((a, b) => a - b);
  if (direction === 'desc') {
    expected.reverse();
  }
  assert.deepEqual(values, expected);
}

function forceMockExternalEnv() {
  const previous = {
    APP_DATA_DIR: process.env.APP_DATA_DIR,
    FENBEITONG_MODE: process.env.FENBEITONG_MODE,
    KINGDEE_MODE: process.env.KINGDEE_MODE
  };
  process.env.APP_DATA_DIR = 'runtime-data/e2e-ui-toolbar';
  process.env.FENBEITONG_MODE = 'mock';
  process.env.KINGDEE_MODE = 'mock';
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

async function stopKnownDevServers() {
  if (process.platform !== 'win32') {
    return;
  }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const script = [
    '$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.LocalAddress -eq "127.0.0.1" -and ($_.LocalPort -eq 3001 -or $_.LocalPort -eq 5173) }',
    'foreach ($connection in $connections) {',
    '  try { Stop-Process -Id $connection.OwningProcess -Force } catch {}',
    '}',
    'Start-Sleep -Milliseconds 500'
  ].join('\n');
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
}
