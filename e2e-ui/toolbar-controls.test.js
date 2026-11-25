import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { handleApi } from '../backend/src/routes.js';
import { resetRepository } from '../backend/src/repository.js';

function startTestServer() {
  const root = new URL('../frontend/src/', import.meta.url);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return handleApi(request, response, { standalone: true });
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
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('finance toolbar controls each produce observable E2E effects', async () => {
  const restoreEnv = forceMockExternalEnv();
  const removedErpIds = new Set();
  const restoreFetch = stubKingdeeFetch(removedErpIds);
  resetRepository();
  const { server, baseUrl } = await startTestServer();
  const processUrl = `${baseUrl}/api/fenbeitong-expense-reimbursement/process`;
  const ledgerTotal = 201;
  let browser;

  try {
    browser = await launchTestBrowser();
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    });
    await page.goto(baseUrl);
    await page.waitForSelector('#syncFenbeitongButton');
    await page.waitForSelector('#kingdeeAccountSelect');
    assert.equal(await page.locator('#kingdeeAccountSelect option').count(), 1);
    await page.selectOption('#kingdeeAccountSelect', 'current');

    await page.click('#syncFenbeitongButton');
    await expectTotal(page, `Total ${ledgerTotal}`);
    assert.equal(await rowCount(page), 20);
    assert.equal(await page.locator('th[data-column-key="operationPanel"]').innerText(), '\u64cd\u4f5c\u9762\u677f');
    assert.equal(await page.locator('button.row-generate-expense-reimbursement').count(), 20);

    const selectedBeforeRowAction = await page.locator('input.row-checkbox:checked').count();
    const singleRowAction = page.locator('button.row-generate-expense-reimbursement').nth(1);
    const singleRowSourceId = await singleRowAction.getAttribute('data-source-id');
    await singleRowAction.click();
    await waitForApiCondition(
      processUrl,
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
    const requesterInput = page.locator('#requesterFilterInput');
    const requesterOptions = page.locator('#requesterSuggestions');
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1920, height: 900 });
    await requesterInput.focus();
    assert.ok(await requesterOptions.isHidden());
    await requesterInput.fill([...requester][0]);
    await expectTotal(page, `Total ${ledgerTotal}`);
    const matchedNames = await requesterOptions.locator('[role="option"]').allTextContents();
    assert.ok(matchedNames.includes(requester));
    assert.ok(matchedNames.every((name) => name.includes([...requester][0])));
    const firstOption = requesterOptions.getByRole('option').first();
    assert.equal(await firstOption.evaluate((option) => {
      const box = option.getBoundingClientRect();
      return [0.15, 0.5, 0.85].every((fraction) =>
        option.contains(document.elementFromPoint(box.left + box.width * 0.5, box.top + box.height * fraction)));
    }), true);
    await requesterOptions.getByRole('option', { name: requester, exact: true }).click();
    await page.setViewportSize(viewport);
    await waitForTotalNot(page, ledgerTotal);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value === requester));
    assert.ok(await requesterOptions.isHidden());
    assert.equal(await requesterInput.getAttribute('list'), null);
    await page.click('#resetButton');
    const expenseDate = (await columnTexts(page, 'time')).find(value => /^\d{4}-\d{2}-\d{2}/.test(value)).slice(0, 10);
    await page.fill('#dateFilterStart', expenseDate);
    await page.fill('#dateFilterEnd', expenseDate);
    await expectTotal(page, `Total ${ledgerTotal}`);
    await page.click('#applyDateFilterButton');
    await waitForTotalNot(page, ledgerTotal);
    assert.ok((await columnTexts(page, 'time')).every((value) => value.startsWith(expenseDate)));
    await page.fill('#dateFilterEnd', '2000-01-01');
    await page.click('#applyDateFilterButton');
    assert.equal(await page.locator('#dateFilterEnd').evaluate(input => input.validity.customError), true);
    assert.ok((await columnTexts(page, 'time')).every((value) => value.startsWith(expenseDate)));
    await page.click('#resetButton');

    await page.selectOption('#searchFieldSelect', 'requester');
    await page.selectOption('#matchModeSelect', 'contains');
    await page.fill('#sourceSearchInput', requester);
    await page.click('#queryLedgerButton');
    const containsTotal = await waitForTotalNot(page, ledgerTotal);
    assert.ok(containsTotal > 0 && containsTotal < ledgerTotal);
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
    await expectTotal(page, `Total ${ledgerTotal - equalsTotal}`);
    assert.ok((await columnTexts(page, 'requester')).every((value) => value !== requester));

    await page.click('#resetButton');
    await expectTotal(page, `Total ${ledgerTotal}`);
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
    const offlineRows = page.locator('#sourceQueueBody tr').filter({ hasText: '线下报销' });
    const offlineIds = await offlineRows.locator('input.row-checkbox').evaluateAll((checkboxes) =>
      [...new Set(checkboxes.map((checkbox) => checkbox.dataset.sourceId))]
    );
    const selectedSourceIds = offlineIds.filter((id) => id !== singleRowSourceId).slice(0, 2);
    assert.equal(selectedSourceIds.length, 2);
    for (const sourceId of selectedSourceIds) {
      await page.locator(`input.row-checkbox[data-source-id="${sourceId}"]`).first().check();
    }
    await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent.includes('已选择 2 张来源单据'));

    assert.equal(await page.locator('#generateVoucherButton').innerText(), '生成费用报销单');
    assert.equal(await page.locator('#saveErpButton').innerText(), '保存费用报销单');
    await page.click('#generateVoucherButton');
    await waitForApiCondition(
      processUrl,
      (body) => selectedSourceIds.every((sourceId) =>
        body.data.some((record) => record.sourceId === sourceId && record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED')
      )
    );
    await page.waitForSelector('#operationFeedback:not([hidden])');
    assert.match(await page.locator('#operationFeedback').innerText(), /已按员工和月份生成 2 张待保存费用报销单/);
    await waitForApiCondition(
      processUrl,
      (body) => body.data.filter((record) => record.processStage === 'EXPENSE_REIMBURSEMENT_PREPARED').length === 3
    );
    await page.click('#saveErpButton');
    await waitForApiCondition(
      processUrl,
      (body) => selectedSourceIds.every((sourceId) =>
        body.data.some((record) => record.sourceId === sourceId && record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED')
      )
    );
    await page.waitForFunction(() => document.querySelector('#resultSummary')?.textContent === '全部 2 张费用报销单保存成功');
    assert.equal(await page.locator('#resultSummary').innerText(), '全部 2 张费用报销单保存成功');
    const pushedRecords = await fetchJson(processUrl);
    assert.equal(pushedRecords.data.filter((record) => record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED').length, 2);

    await page.click('#viewVoucherButton');
    await page.waitForFunction(() => document.querySelector('#resultOutput')?.textContent.includes('ERP_EXPENSE_REIMBURSEMENT_SAVED'));

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportButton')]);
    assert.match(download.suggestedFilename(), /\.csv$/);
    const localPath = await download.path();
    assert.equal(existsSync(localPath), true);
    assert.match(readFileSync(localPath, 'utf8'), /"=""MOCK-BX-001"""/);
    const exportResult = JSON.parse(await page.locator('#resultOutput').innerText());
    assert.equal(exportResult.filename, download.suggestedFilename());
    assert.equal(exportResult.destination, 'browser-download');

    await page.locator('#selectAllRowsCheckbox').check();
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 20);
    assert.equal(
      await page.locator('#operationFeedback').innerText(),
      `已全选当前筛选结果，共 ${ledgerTotal} 张来源单据。`
    );
    await page.click('#nextPageButton');
    assert.equal(await page.locator('input.row-checkbox:checked').count(), 20);
    assert.equal(await page.locator('#selectAllRowsCheckbox').isChecked(), true);

    const savedFilter = page.locator('#saveStatusFilterSelect');
    await savedFilter.selectOption('saved');
    const savedStatuses = await columnTexts(page, 'status');
    assert.ok(savedStatuses.length >= 2 && savedStatuses.every((text) => text === '已保存ERP'));
    const beforeDeletion = await rowCount(page);
    const removed = pushedRecords.data.find(record => record.processStage === 'ERP_EXPENSE_REIMBURSEMENT_SAVED');
    removedErpIds.add(String(removed.erpFid));
    await page.reload();
    await page.waitForSelector('#sourceQueueBody input.row-checkbox');
    await savedFilter.selectOption('saved');
    assert.ok(await rowCount(page) < beforeDeletion);
    await savedFilter.selectOption('unsaved');
    assert.ok((await columnTexts(page, 'status')).every((text) => text !== '已保存ERP'));
    assert.ok((await fetchJson(processUrl)).data.some(record => record.erpFid === removed.erpFid));
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
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
  process.env.FENBEITONG_MODE = 'mock';
  process.env.KINGDEE_MODE = 'real';
  process.env.KINGDEE_BASE_URL = 'http://kingdee.test';
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

function stubKingdeeFetch(removedErpIds) {
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
    if (text.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc')) {
      const query = JSON.parse(JSON.parse(String(options.body)).data);
      if (query.FormId === 'BD_Empinfo') {
        return Response.json([[5093315, 'PH022', query.FilterString?.[0]?.Value, '886']]);
      }
      if (query.FormId === 'BD_Department') {
        return Response.json([[6001, 'BM000006', query.FilterString?.[0]?.Value || '销售部', '886']]);
      }
      assert.equal(query.FormId, 'ER_ExpReimbursement');
      if (typeof query.FilterString === 'string' && query.FilterString.startsWith('FID in (')) {
        const fids = query.FilterString.slice(8, -1).split(',');
        return Response.json(fids.filter(id => savedModels.has(id) && !removedErpIds.has(id)).map(id => [id, id]));
      }
      return Response.json([]);
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
      if (body.formid === 'BD_Empinfo') {
        return Response.json({ Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: { EmpinfoBank: [{ OpenBankName: '测试银行', BankHolder: '测试员工', BankCode: '6222000000000000' }] }
        } });
      }
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
            F_ora_Text_qtr: model.F_ora_Text_qtr,
            FRequestType: model.FRequestType,
            FRealPay: model.FRealPay,
            BankBranchT: model.FBankBranchT,
            BankAccountNameT: model.FBankAccountNameT,
            BankAccountT: model.FBankAccountT,
            ER_ExpenseReimbEntry: model.FEntity.map((entry) => ({
              ...entry,
              BankBranch: entry.FBankBranch,
              BankAccountName: entry.FBankAccountName,
              BankAccount: entry.FBankAccount
            })),
            FDocumentStatus: 'Z'
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (new URL(text).hostname === 'kingdee.test') throw new Error(`Unexpected Kingdee endpoint: ${text}`);
    return previousFetch(url, options);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}
