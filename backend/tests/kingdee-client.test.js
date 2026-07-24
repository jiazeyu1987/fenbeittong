import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearKingdeeEmployeeNumberCacheForTest,
  findKingdeeEmployeeNumberByName,
  saveKingdeeExpenseReimbursement
} from '../src/adapters/kingdee-client.js';

test('Kingdee expense reimbursement save rejects mock mode', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'mock' });
  try {
    await assert.rejects(
      () => saveKingdeeExpenseReimbursement({ Model: {} }),
      /expense reimbursement save requires KINGDEE_MODE=real/
    );
  } finally {
    restore();
  }
});

test('resolves a Fenbeitong employee by exact Kingdee employee name', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  clearKingdeeEmployeeNumberCacheForTest();
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      const query = JSON.parse(JSON.parse(String(options.body)).data);
      assert.equal(query.FormId, 'BD_Empinfo');
      assert.equal(query.FilterString[0].Value, '任向阳');
      return jsonResponse([[5093315, 'PL0228', '任向阳', '892']]);
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    assert.equal(await findKingdeeEmployeeNumberByName('任向阳'), 'PL0228');
  } finally {
    globalThis.fetch = previousFetch;
    clearKingdeeEmployeeNumberCacheForTest();
    restore();
  }
});

test('retries a transient network failure during a safe employee query', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  clearKingdeeEmployeeNumberCacheForTest();
  let authAttempts = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      authAttempts += 1;
      if (authAttempts === 1) {
        const error = new Error('transient timeout');
        error.cause = { code: 'ETIMEDOUT' };
        throw error;
      }
      return jsonResponse({ LoginResultType: 1 }, {
        'Set-Cookie': 'kdservice-sessionid=retry; Path=/'
      });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      return jsonResponse([[5093315, 'PL0999', 'Test User', '892']]);
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    assert.equal(await findKingdeeEmployeeNumberByName('Test User'), 'PL0999');
    assert.equal(authAttempts, 2);
  } finally {
    globalThis.fetch = previousFetch;
    clearKingdeeEmployeeNumberCacheForTest();
    restore();
  }
});

test('save and verification both use ER_ExpReimbursement and never GL_VOUCHER', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  const formIds = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc')) {
      return jsonResponse({ LoginResultType: 1, Context: { SessionId: 's1' } }, {
        'Set-Cookie': 'kdservice-sessionid=abc; Path=/K3Cloud'
      });
    }
    if (path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.SwitchOrg.common.kdsvc')) {
      assert.deepEqual(JSON.parse(new URLSearchParams(String(options.body)).get('data')), { OrgNumber: '886' });
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.Save.common.kdsvc')) {
      const wrapper = JSON.parse(String(options.body));
      formIds.push(wrapper.formid);
      assert.equal(JSON.parse(wrapper.data).Model.FProposerID.FNumber, 'PL0098');
      return jsonResponse({
        Result: {
          Id: '127500',
          Number: 'FYBX20260721000001',
          ResponseStatus: {
            IsSuccess: true,
            Errors: [],
            SuccessEntitys: [{ Id: 127500, Number: 'FYBX20260721000001' }]
          }
        }
      });
    }
    if (path.endsWith('/Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.View.common.kdsvc')) {
      const wrapper = JSON.parse(String(options.body));
      formIds.push(wrapper.formid);
      assert.deepEqual(JSON.parse(wrapper.data), { Number: '', Id: '127500', CreateOrgId: 0 });
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 127500,
            FBillNo: 'FYBX20260721000001',
            FDocumentStatus: 'Z',
            FOrgID: { FNumber: '886' },
            FProposerID: { FNumber: 'PL0098' },
            FRequestDeptID: { FNumber: 'BM000006' },
            FBillTypeID: { FNumber: 'FYBXD001_SYS' },
            FExpAmountSum: 100
          }
        }
      });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  const payload = {
    Model: {
      FOrgID: { FNumber: '886' },
      FProposerID: { FNumber: 'PL0098' },
      FRequestDeptID: { FNumber: 'BM000006' },
      FBillTypeID: { FNumber: 'FYBXD001_SYS' },
      FExpAmountSum: 100
    }
  };
  try {
    const result = await saveKingdeeExpenseReimbursement(payload);
    assert.equal(result.erpFid, '127500');
    assert.equal(result.erpNumber, 'FYBX20260721000001');
    assert.deepEqual(formIds, ['ER_ExpReimbursement', 'ER_ExpReimbursement']);
    assert.doesNotMatch(JSON.stringify(formIds), /GL_VOUCHER/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('network-control conflict is accepted when ERP already contains the requested values', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = networkConflictFetch({ purpose: '客户拜访' });
  try {
    const result = await saveKingdeeExpenseReimbursement(networkConflictPayload());
    assert.equal(result.erpFid, '127388');
    assert.equal(result.erpNumber, 'B1IELSHBX26053100003');
    assert.equal(result.recoveredNetworkControlConflict, true);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('network-control conflict gives an actionable error when ERP values differ', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = networkConflictFetch({ purpose: '旧用途' });
  try {
    await assert.rejects(
      () => saveKingdeeExpenseReimbursement(networkConflictPayload()),
      (error) => error.code === 'KINGDEE_NETWORK_CONTROL_CONFLICT'
        && /关闭该单据的编辑页面/.test(error.message)
        && error.detail.lockOwner === 'int'
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('verification rejects a different employee target', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.Save')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, SuccessEntitys: [{ Id: 1, Number: 'FY1' }] } } });
    }
    return jsonResponse({
      Result: {
        ResponseStatus: { IsSuccess: true, Errors: [] },
        Result: {
          FOrgID: { FNumber: '886' },
          FProposerID: { FNumber: 'WRONG' },
          FRequestDeptID: { FNumber: 'BM000006' },
          FBillTypeID: { FNumber: 'FYBXD001_SYS' },
          FExpAmountSum: 100
        }
      }
    });
  };
  try {
    await assert.rejects(() => saveKingdeeExpenseReimbursement({ Model: {
      FOrgID: { FNumber: '886' },
      FProposerID: { FNumber: 'PL0098' },
      FRequestDeptID: { FNumber: 'BM000006' },
      FBillTypeID: { FNumber: 'FYBXD001_SYS' },
      FExpAmountSum: 100
    } }), /expense reimbursement save target mismatch/);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('retry safely recreates an expense reimbursement after its saved FID was deleted', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  let saveCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      const query = JSON.parse(JSON.parse(String(options.body)).data);
      assert.equal(query.FormId, 'ER_ExpReimbursement');
      assert.equal(query.FilterString[0].Value, 'B1IELSHBX26053100003');
      return jsonResponse([]);
    }
    if (path.includes('DynamicFormService.Save')) {
      saveCount += 1;
      const model = JSON.parse(JSON.parse(String(options.body)).data).Model;
      if (saveCount === 1) {
        assert.equal(model.FID, 127383);
        return jsonResponse({
          Result: {
            ResponseStatus: {
              IsSuccess: false,
              Errors: [{
                Message: '您要读取的数据在系统中不存在,可能已经被删除！[ID=127383,Type=BillHead,TableName=t_ER_ExpenseReimb]'
              }]
            }
          }
        });
      }
      assert.equal(model.FID, 0);
      return jsonResponse({
        Result: {
          ResponseStatus: {
            IsSuccess: true,
            SuccessEntitys: [{ Id: 127390, Number: 'B1IELSHBX26053100003' }]
          }
        }
      });
    }
    if (path.includes('DynamicFormService.View')) {
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            OrgID: { Number: '886' },
            ProposerID: { FStaffNumber: 'PL0205' },
            RequestDeptID: { Number: 'BM000006' },
            BillTypeID: { Number: 'FYBXD001_SYS' },
            ExpAmountSum: 3188.76
          }
        }
      });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  const payload = {
    Model: {
      FID: 127383,
      FBillNo: 'B1IELSHBX26053100003',
      FOrgID: { FNumber: '886' },
      FProposerID: { FStaffNumber: 'PL0205' },
      FRequestDeptID: { FNumber: 'BM000006' },
      FBillTypeID: { FNumber: 'FYBXD001_SYS' },
      FExpAmountSum: 3188.76
    }
  };
  try {
    const result = await saveKingdeeExpenseReimbursement(payload);
    assert.equal(saveCount, 2);
    assert.equal(result.erpFid, '127390');
    assert.equal(result.erpNumber, 'B1IELSHBX26053100003');
    assert.equal(result.recoveredMissingTarget, true);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('save reports when the Kingdee organization has not initialized expense management', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    return jsonResponse({
      Result: {
        ResponseStatus: {
          IsSuccess: false,
          Errors: [{ Message: '组织未启用费用管理' }]
        }
      }
    });
  };
  try {
    await assert.rejects(
      () => saveKingdeeExpenseReimbursement({ Model: { FOrgID: { FNumber: '886' } } }),
      (error) => error.code === 'KINGDEE_EXPENSE_MANAGEMENT_NOT_ENABLED'
        && error.message.includes('设置该申请组织的启用日期')
    );
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
}

function networkConflictPayload() {
  return {
    Model: {
      FID: 127388,
      FBillNo: 'B1IELSHBX26053100003',
      FOrgID: { FNumber: '886' },
      FExpAmountSum: 100,
      FEntity: [{
        FExpID: { FNumber: 'CI008' },
        FExpenseAmount: 95,
        FTaxAmt: 5,
        FTaxSubmitAmt: 95,
        FExpSubmitAmount: 100,
        F_PAEZ_Date: '2026-07-21',
        F_PAEZ_Text: '上海市',
        F_ora_Text: '苏州市',
        F_PAEZ_Text1: '用车',
        FRemark: '客户拜访',
        FExpenseDeptEntryID: { FNumber: 'BM000006' },
        F_ora_Text_83g: '用车'
      }]
    }
  };
}

function networkConflictFetch({ purpose }) {
  return async (url) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.Save')) {
      return jsonResponse({
        Result: {
          ResponseStatus: {
            IsSuccess: false,
            ErrorCode: 13,
            Errors: [{ Message: '“int”使用业务单据：“费用报销单-1”业务操作-“修改”冲突，请稍候再使用。' }]
          }
        }
      });
    }
    if (path.includes('DynamicFormService.View')) {
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            Id: 127388,
            BillNo: 'B1IELSHBX26053100003',
            DocumentStatus: 'A',
            ExpAmountSum: 100,
            ER_ExpenseReimbEntry: [{
              ExpID: { Number: 'CI008' },
              ExpenseAmount: 95,
              TaxAmt: 5,
              TaxSubmitAmt: 95,
              ExpSubmitAmount: 100,
              F_PAEZ_Date: '2026-07-21T00:00:00',
              F_PAEZ_Text: '上海市',
              F_ora_Text: '苏州市',
              F_PAEZ_Text1: '用车',
              Remark: purpose,
              ExpenseDeptEntryID: { Number: 'BM000006' },
              F_ora_Text_83g: '用车'
            }]
          }
        }
      });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
}

function forceKingdeeEnv(overrides = {}) {
  const names = ['KINGDEE_MODE', 'KINGDEE_BASE_URL', 'KINGDEE_ACCT_ID', 'KINGDEE_USERNAME', 'KINGDEE_PASSWORD'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    KINGDEE_MODE: 'real',
    KINGDEE_BASE_URL: 'http://172.30.30.8',
    KINGDEE_ACCT_ID: '6977227150362f',
    KINGDEE_USERNAME: 'test-user',
    KINGDEE_PASSWORD: 'test-password',
    ...overrides
  });
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
