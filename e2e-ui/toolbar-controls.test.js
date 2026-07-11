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

    await page.locator('input.row-checkbox').nth(0).check();
    await page.locator('input.row-checkbox').nth(1).check();
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 2);
    await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('已选择 2 张来源单据'));

    assert.equal(await page.locator('#generateVoucherButton').isEnabled(), true);
    await page.click('#generateVoucherButton');
    await page.waitForFunction(async () => {
      const body = await fetch('http://127.0.0.1:3001/api/fenbeitong-voucher/process').then((response) => response.json());
      return body.data.length === 2;
    });
    const preparedRecords = await fetchJson('http://127.0.0.1:3001/api/fenbeitong-voucher/process');
    assert.equal(preparedRecords.data.length, 2);
    assert.equal(preparedRecords.data.every((record) => record.processStage === 'PREPARED'), true);

    assert.equal(await page.locator('#saveErpButton').isEnabled(), true);
    await page.click('#saveErpButton');
    await page.waitForFunction(async () => {
      const body = await fetch('http://127.0.0.1:3001/api/fenbeitong-voucher/process').then((response) => response.json());
      return body.data.filter((record) => record.processStage === 'ERP_PUSHED').length === 2;
    });
    const pushedRecords = await fetchJson('http://127.0.0.1:3001/api/fenbeitong-voucher/process');
    assert.equal(pushedRecords.data.filter((record) => record.processStage === 'ERP_PUSHED').length, 2);

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
