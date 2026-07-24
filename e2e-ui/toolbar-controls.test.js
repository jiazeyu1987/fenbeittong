import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const restoreFetch = stubKingdeeFetch();
  resetRepository();
  await stopKnownDevServers();
  const apiServer = await startApiServer();
  const frontendServer = await startFrontendServer();
  let browser;

  try {
    browser = await launchTestBrowser();
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto('http://127.0.0.1:5173');
    await page.waitForSelector('#syncFenbeitongButton');
    await page.waitForSelector('#kingdeeAccountSelect');
    assert.equal(await page.locator('#kingdeeAccountSelect option').count(), 1);
    await page.selectOption('#kingdeeAccountSelect', 'current');

    await page.click('#syncFenbeitongButton');
    await expectTotal(page, 'Total 101');
    assert.equal(await rowCount(page), 20);
    assert.equal(await page.locator('th[data-column-key="operationPanel"]').innerText(), '\u64cd\u4f5c\u9762\u677f');
    assert.equal(await page.locator('button.row-generate-expense-reimbursement').count(), 20);

    const selectedBeforeRowAction = await page.locator('input.row-checkbox:checked').count();
    const singleRowAction = page.locator('button.row-generate-expense-reimbursement').nth(1);
    const singleRowSourceId = await singleRowAction.getAttribute('data-source-id');
    await singleRowAction.click();
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-expense-reimbursement/process',
      (body) => body.data.filter((record) => record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED').length === 1
        && body.data.some((record) => record.sourceId === singleRowSourceId && record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED')
    );
    await page.waitForSelector('#operationFeedback:not([hidden])');
    assert.match(await page.locator('#operationFeedback').innerText(), /已生成待保存费用报销单/);
    await page.waitForFunction((sourceId) => {
      const output = document.querySelector('#resultOutput')?.textContent || '';
      return output.includes(sourceId) && output.includes('EXPENSE_REIMBURSEMENT_PREPARED');
    }, singleRowSourceId);
    assert.equal(await page.locator('input.row-checkbox:checked').count(), selectedBeforeRowAction);

    const requester = await firstCellText(page, 'requester');
    await page.selectOption('#searchFieldSelect', 'requester');
    await page.selectOption('#matchModeSelect', 'contains');
    await page.fill('#sourceSearchInput', requester);
    await page.click('#queryLedgerButton');
    const containsTotal = await waitForTotalNot(page, 101);
    assert.ok(containsTotal > 0 && containsTotal < 101);
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
    await expectTotal(page, `Total ${101 - equalsTotal}`);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value !== requester));

    await page.click('#resetButton');
    await expectTotal(page, 'Total 101');
    assert.equal(await page.inputValue('#sourceSearchInput'), '');
    assert.equal(await page.locator('#searchFieldSelect').inputValue(), 'sourceCode');
    assert.equal(await page.locator('#matchModeSelect').inputValue(), 'contains');

    await page.click('button[data-sort-field="sourceCode"]');
    assertSorted(await columnTexts(page, 'sourceCode'), 'asc');
    await page.click('button[data-sort-field="sourceCode"]');
    assertSorted(await columnTexts(page, 'sourceCode'), 'desc');

    await page.click('button[data-sort-field="departmentAttributionAmount"]');
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

    assert.equal(await page.locator('#generateVoucherButton').innerText(), '生成费用报销单');
    assert.equal(await page.locator('#saveErpButton').innerText(), '保存费用报销单');
    const selectedSourceIds = await page.locator('input.row-checkbox:checked').evaluateAll((checkboxes) =>
      checkboxes.map((checkbox) => checkbox.dataset.sourceId)
    );
    await page.click('#generateVoucherButton');
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-expense-reimbursement/process',
      (body) => selectedSourceIds.every((sourceId) =>
        body.data.some((record) => record.sourceId === sourceId && record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED')
      )
    );
    await page.waitForSelector('#operationFeedback:not([hidden])');
    assert.match(await page.locator('#operationFeedback').innerText(), /已按员工和月份生成 2 张待保存费用报销单/);
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-expense-reimbursement/process',
      (body) => body.data.filter((record) => record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED').length === 3
    );
    await page.click('#saveErpButton');
    await waitForApiCondition(
      'http://127.0.0.1:3001/api/fenbeitong-expense-reimbursement/process',
      (body) => selectedSourceIds.every((sourceId) =>
        body.data.some((record) => record.sourceId === sourceId && record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED')
      )
    );
    await page.waitForFunction(() => document.querySelector('#operationFeedback')?.textContent === '保存成功');
    assert.equal(await page.locator('#operationFeedback').innerText(), '保存成功');
    const pushedRecords = await fetchJson('http://127.0.0.1:3001/api/fenbeitong-expense-reimbursement/process');
    assert.equal(pushedRecords.data.filter((record) => record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED').length, 2);

    await page.click('#viewVoucherButton');
    await page.waitForFunction(() => document.querySelector('#resultOutput')?.textContent.includes('ERP_EXPENSE_REIMBURSEMENT_SAVED'));

    await page.click('#exportButton');
    await page.waitForFunction(() =>
      document.querySelector('#resultSummary')?.textContent.includes('文件位置：')
    );
    const exportResult = JSON.parse(await page.locator('#resultOutput').innerText());
    assert.match(exportResult.filename, /\.csv$/);
    assert.equal(existsSync(exportResult.localPath), true);
    assert.match(readFileSync(exportResult.localPath, 'utf8'), /"=""MOCK-BX-001"""/);

    await page.locator('#selectAllRowsCheckbox').check();
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 20);
    assert.equal(
      await page.locator('#operationFeedback').innerText(),
      '已全选当前筛选结果，共 101 张来源单据。'
    );
    await page.click('#nextPageButton');
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 20);
    assert.equal(await page.locator('#selectAllRowsCheckbox').isChecked(), true);
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => frontendServer.close(resolve));
    restoreFetch();
    restoreEnv();
  }
});

async function launchTestBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(error?.message || error))) {
      throw error;
    }
    return chromium.launch({ channel: 'chrome' });
  }
}

async function expectTotal(page, text) {
  await page.waitForFunction((expected) => document.querySelector('#paginationSummary')?.textContent?.startsWith(expected), text);
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
  const values = await columnTexts(page, 'departmentAttributionAmount');
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
    EXPORT_DOWNLOAD_DIR: process.env.EXPORT_DOWNLOAD_DIR,
    FENBEITONG_MODE: process.env.FENBEITONG_MODE,
    KINGDEE_MODE: process.env.KINGDEE_MODE,
    KINGDEE_BASE_URL: process.env.KINGDEE_BASE_URL,
    KINGDEE_ACCT_ID: process.env.KINGDEE_ACCT_ID,
    KINGDEE_USERNAME: process.env.KINGDEE_USERNAME,
    KINGDEE_PASSWORD: process.env.KINGDEE_PASSWORD,
    KINGDEE_ACCOUNT_JIAZEYU_ENABLED: process.env.KINGDEE_ACCOUNT_JIAZEYU_ENABLED,
    KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID: process.env.KINGDEE_ACCOUNT_JIAZEYU_ACCT_ID,
    KINGDEE_ACCOUNT_JIAZEYU_USERNAME: process.env.KINGDEE_ACCOUNT_JIAZEYU_USERNAME,
    KINGDEE_ACCOUNT_JIAZEYU_PASSWORD: process.env.KINGDEE_ACCOUNT_JIAZEYU_PASSWORD
  };
  process.env.APP_DATA_DIR = 'runtime-data/e2e-ui-toolbar';
  process.env.EXPORT_DOWNLOAD_DIR = join(
    process.cwd(),
    'runtime-data',
    'e2e-ui-toolbar',
    'exports'
  );
  process.env.FENBEITONG_MODE = 'mock';
  process.env.KINGDEE_MODE = 'real';
  process.env.KINGDEE_BASE_URL = 'http://172.30.30.8';
  process.env.KINGDEE_ACCT_ID = '6977227150362f';
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
  let nextId = 100033;
  const savedModels = new Map();
  globalThis.fetch = async (url, options = {}) => {
    const text = String(url);
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      assert.match(String(options.body), /acctID=6977227150362f/);
      assert.match(String(options.body), /username=test-user/);
      return new Response(JSON.stringify({ LoginResultType: 1 }), {
        status: 200,
        headers: { 'Set-Cookie': 'kdservice-sessionid=e2eui123; Path=/K3Cloud' }
      });
    }
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SwitchOrg.common.kdsvc')) {
      assert.equal(options.headers.Cookie, 'kdservice-sessionid=e2eui123');
      const data = JSON.parse(new URLSearchParams(String(options.body)).get('data'));
      assert.deepEqual(data, { OrgNumber: '886' });
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: {
            IsSuccess: true,
            Errors: [],
            SuccessEntitys: [{ Id: 238131, Number: '886', DIndex: 0 }]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      assert.equal(options.headers.Cookie, 'kdservice-sessionid=e2eui123');
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'ER_ExpReimbursement');
      const payload = JSON.parse(body.data);
      assert.equal(payload.Model.FOrgID.FNumber, '886');
      assert.ok(payload.Model.FEntity.length >= 2);
      const currentId = String(nextId++);
      savedModels.set(currentId, payload.Model);
      return new Response(JSON.stringify({
        Result: {
          Id: currentId,
          Number: currentId,
          ResponseStatus: { IsSuccess: true, Errors: [] }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      const body = JSON.parse(String(options.body));
      assert.equal(body.formid, 'ER_ExpReimbursement');
      const id = JSON.parse(body.data).Id;
      const model = savedModels.get(String(id));
      return new Response(JSON.stringify({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: id,
            FBillNo: id,
            FOrgID: model.FOrgID,
            FProposerID: model.FProposerID,
            FRequestDeptID: model.FRequestDeptID,
            FBillTypeID: model.FBillTypeID,
            FExpAmountSum: model.FExpAmountSum,
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
