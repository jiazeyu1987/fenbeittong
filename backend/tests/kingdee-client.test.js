import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearKingdeeDepartmentNumberCacheForTest,
  clearKingdeeEmployeeNumberCacheForTest,
  findKingdeeDepartmentNumberByName,
  findKingdeeEmployeeNumberByName,
  extractKingdeeEmployeeBankDetails,
  queryKingdeeSuccessfulExpensePaymentBills,
  expenseReimbursementWithoutRequestPaymentForTest,
  validateExpensePaymentBankFields,
  saveKingdeeExpenseReimbursement
} from '../src/adapters/kingdee-client.js';

test('payment bank verification reads View property names and ignores non-payment bills', () => {
  const payload = { Model: { FRequestType: '1', FBankBranchT: 'Bank', FBankAccountNameT: 'Employee', FBankAccountT: '123' } };
  const view = { Result: { Result: { BankBranchT: 'Bank', BankAccountNameT: 'Employee', BankAccountT: '123' } } };
  assert.doesNotThrow(() => validateExpensePaymentBankFields(payload, view));
  view.Result.Result.BankAccountT = '';
  assert.throws(() => validateExpensePaymentBankFields(payload, view), (error) =>
    error.code === 'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH'
    && error.detail.mismatches.length === 1
    && error.detail.mismatches[0].field === 'FBankAccountT');
  payload.Model.FRequestType = '0';
  assert.doesNotThrow(() => validateExpensePaymentBankFields(payload, view));
});

test('payment verification checks every entry even when header and first entry match', () => {
  const entry = { FBankBranch: 'Bank', FBankAccountName: 'Employee', FBankAccount: '123' };
  const actual = { BankBranch: 'Bank', BankAccountName: 'Employee', BankAccount: '123' };
  const payload = { Model: { FRequestType: '1', FEntity: [entry, entry] } };
  const view = { Result: { Result: { ER_ExpenseReimbEntry: [actual, { ...actual, BankAccount: ' ' }] } } };
  assert.throws(() => validateExpensePaymentBankFields(payload, view), (error) =>
    error.code === 'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH'
    && error.detail.mismatches[0].field === 'FEntity[1].FBankAccount');
  view.Result.Result.ER_ExpenseReimbEntry[1] = actual;
  assert.doesNotThrow(() => validateExpensePaymentBankFields(payload, view));
  payload.Model.FRequestType = '0';
  view.Result.Result.ER_ExpenseReimbEntry = [];
  assert.doesNotThrow(() => validateExpensePaymentBankFields(payload, view));
});

test('entry bank-only differences require updating the existing bill and retain its ID on failed verification', async () => {
  const restore = forceKingdeeEnv();
  const previousFetch = globalThis.fetch;
  let saved = false;
  let persistBank = false;
  const payload = { Model: { FID: 0, FBillNo: 'BANK-TEST', FOrgID: { FNumber: '886' }, FRequestType: '1', FExpAmountSum: 100, FEntity: [], FBankBranchT: 'Bank', FBankAccountNameT: 'Employee', FBankAccountT: '123' } };
  payload.Model.FEntity = [{ FExpenseAmount: 100, FTaxSubmitAmt: 100, FExpSubmitAmount: 100,
    FBankBranch: 'Bank', FBankAccountName: 'Employee', FBankAccount: '123' }];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'session=test' });
    if (path.includes('DynamicFormService.SwitchOrg')) return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true } } });
    if (path.includes('DynamicFormService.ExecuteBillQuery')) return jsonResponse([[77, 'BANK-TEST']]);
    if (path.includes('DynamicFormService.Save')) {
      assert.equal(JSON.parse(JSON.parse(options.body).data).Model.FID, 77);
      saved = true;
      return jsonResponse({ Result: { Id: 77, Number: 'BANK-TEST', ResponseStatus: { IsSuccess: true } } });
    }
    if (path.includes('DynamicFormService.View')) return jsonResponse({ Result: {
      ResponseStatus: { IsSuccess: true }, Result: {
        Id: 77, BillNo: 'BANK-TEST', OrgID: { Number: '886' }, RequestType: '1', ExpAmountSum: 100,
        ER_ExpenseReimbEntry: [{ ExpenseAmount: 100, TaxSubmitAmt: 100, ExpSubmitAmount: 100,
          BankBranch: 'Bank', BankAccountName: 'Employee', BankAccount: saved && persistBank ? '123' : ' ' }],
        BankBranchT: 'Bank', BankAccountNameT: 'Employee', BankAccountT: '123'
      }
    } });
    throw new Error('unexpected request');
  };
  try {
    await assert.rejects(() => saveKingdeeExpenseReimbursement(payload), (e) => e.code === 'KINGDEE_EXISTING_BILL_MISMATCH');
    assert.equal(saved, false);
    await assert.rejects(() => saveKingdeeExpenseReimbursement(payload, { allowExistingBillOverwrite: true }), (e) =>
      e.code === 'KINGDEE_PAYMENT_BANK_FIELDS_MISMATCH' && String(e.detail.savedResult.erpFid) === '77');
    persistBank = true;
    const result = await saveKingdeeExpenseReimbursement(payload, { allowExistingBillOverwrite: true });
    assert.equal(result.erpFid, '77');
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('extracts the preferred complete bank row from an ERP employee profile', () => {
  const details = extractKingdeeEmployeeBankDetails({
    EmpinfoBank: [{
      OpenBankName: [{ Key: 2052, Value: 'Bank A' }],
      BankHolder: 'Employee A',
      BankCode: '111',
      IsDefault: false
    }, {
      OpenBankName: [{ Key: 2052, Value: 'Bank B' }],
      BankHolder: 'Employee B',
      BankCode: '222',
      IsDefault: true
    }]
  });
  assert.deepEqual(details, {
    openBank: 'Bank B',
    accountName: 'Employee B',
    bankAccount: '222',
    isDefault: true
  });
});

test('returns blank bank fields when the ERP employee profile is incomplete', () => {
  assert.deepEqual(extractKingdeeEmployeeBankDetails({
    EmpinfoBank: [{ OpenBankName: [], BankHolder: null, BankCode: null }]
  }), {
    openBank: '',
    accountName: '',
    bankAccount: '',
    isDefault: false
  });
});

test('bank-data fallback disables request payment but keeps real payment', () => {
  const payload = {
    Model: {
      FRequestType: '1',
      FRealPay: true,
      FReqAmountSum: 100,
      FLocReqAmountSum: 100,
      FReqPayReFoundAmountSum: 100,
      FEntity: [{
        FRequestAmount: 100,
        FReqSubmitAmount: 100,
        FLocReqSubmitAmount: 100,
        FExpenseAmount: 100
      }]
    }
  };
  const adjusted = expenseReimbursementWithoutRequestPaymentForTest(payload);
  assert.equal(adjusted.Model.FRequestType, '0');
  assert.equal(adjusted.Model.FRealPay, true);
  assert.equal(adjusted.Model.FReqAmountSum, 0);
  assert.equal(adjusted.Model.FEntity[0].FRequestAmount, 0);
  assert.equal(adjusted.Model.FEntity[0].FExpenseAmount, 100);
  assert.equal(payload.Model.FRequestType, '1');
});

test('resolves a Fenbeitong department by exact Kingdee department name', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  clearKingdeeDepartmentNumberCacheForTest();
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=dept; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      const query = JSON.parse(JSON.parse(String(options.body)).data);
      assert.equal(query.FormId, 'BD_Department');
      assert.equal(query.FilterString[0].Value, '质检');
      return jsonResponse([
        [6000, 'BM-OTHER', '质检', '892'],
        [6001, 'BM000118', '质检', '886']
      ]);
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    assert.equal(await findKingdeeDepartmentNumberByName('质检'), 'BM000118');
  } finally {
    globalThis.fetch = previousFetch;
    clearKingdeeDepartmentNumberCacheForTest();
    restore();
  }
});

test('queries only expense payment bills whose every bank entry succeeded', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=pay; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      const query = JSON.parse(JSON.parse(String(options.body)).data);
      assert.equal(query.FormId, 'AP_PAYBILL');
      return jsonResponse([
        [1, 'FKD0001', 'SGBXD', '费用报销付款单', '2026-08-01', 'X001', '测试员工', 100, 100, '', '', '', 'C', '', '', 40, 'R1'],
        [1, 'FKD0001', 'SGBXD', '费用报销付款单', '2026-08-01', 'X001', '测试员工', 100, 100, '', '', '', 'C', '', '', 60, 'R2'],
        [2, 'FKD0002', 'SGBXD', '费用报销付款单', '2026-08-01', 'X002', '未成功员工', 50, 50, '', '', '', 'A', '处理中', '', 50, 'R3'],
        [3, 'FKD0003', 'OTHER', '其他付款单', '2026-08-01', 'X003', '其他员工', 20, 20, '', '', '', 'C', '', '', 20, 'R4']
      ]);
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    const bills = await queryKingdeeSuccessfulExpensePaymentBills({ orgNumber: '892' });
    assert.equal(bills.length, 1);
    assert.equal(bills[0].billNumber, 'FKD0001');
    assert.equal(bills[0].billTypeName, '费用报销付款单');
    assert.equal(bills[0].bankStatusName, '银行交易成功');
    assert.equal(bills[0].entryPaymentAmount, 100);
    assert.equal(bills[0].entries.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

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

test('an unchanged existing bill number is accepted without calling save again', async () => {
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
      assert.equal(query.FilterString[0].Value, 'B1IELSHBX26070100003');
      return jsonResponse([[127430, 'B1IELSHBX26070100003']]);
    }
    if (path.includes('DynamicFormService.View')) {
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 127430,
            FBillNo: 'B1IELSHBX26070100003',
            FDocumentStatus: 'Z',
            FOrgID: { FNumber: '886' },
            FProposerID: { FStaffNumber: 'PL-MAO' },
            FRequestDeptID: { FNumber: 'BM000006' },
            FBillTypeID: { FNumber: 'FYBXD001_SYS' },
            FExpAmountSum: 200,
            FEntity: []
          }
        }
      });
    }
    if (path.includes('DynamicFormService.Save')) {
      saveCount += 1;
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    const result = await saveKingdeeExpenseReimbursement({
      Model: {
        FID: 0,
        FBillNo: 'B1IELSHBX26070100003',
        FOrgID: { FNumber: '886' },
        FProposerID: { FStaffNumber: 'PL-MAO' },
        FRequestDeptID: { FNumber: 'BM000006' },
        FBillTypeID: { FNumber: 'FYBXD001_SYS' },
        FExpAmountSum: 200,
        FEntity: []
      }
    });
    assert.equal(result.recoveredExistingBill, true);
    assert.equal(result.erpFid, '127430');
    assert.equal(result.erpNumber, 'B1IELSHBX26070100003');
    assert.equal(saveCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('a changed existing bill number is not overwritten by normal save', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  let saveCount = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      return jsonResponse([[127429, 'B1IELSHBX26071900003']]);
    }
    if (path.includes('DynamicFormService.View')) {
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 127429,
            FBillNo: 'B1IELSHBX26071900003',
            FOrgID: { FNumber: '886' },
            FProposerID: { FStaffNumber: 'PL-WRONG' },
            FRequestDeptID: { FNumber: 'BM000006' },
            FBillTypeID: { FNumber: 'FYBXD001_SYS' },
            FExpAmountSum: 100,
            FEntity: []
          }
        }
      });
    }
    if (path.includes('DynamicFormService.Save')) saveCount += 1;
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    await assert.rejects(
      () => saveKingdeeExpenseReimbursement({
        Model: {
          FID: 0,
          FBillNo: 'B1IELSHBX26071900003',
          FOrgID: { FNumber: '886' },
          FProposerID: { FStaffNumber: 'PL-CURRENT' },
          FRequestDeptID: { FNumber: 'BM000006' },
          FBillTypeID: { FNumber: 'FYBXD001_SYS' },
          FExpAmountSum: 100,
          FEntity: []
        }
      }),
      (error) => error.code === 'KINGDEE_EXISTING_BILL_MISMATCH'
    );
    assert.equal(saveCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test('an explicit retry updates a changed existing bill and preserves its prior view', async () => {
  const restore = forceKingdeeEnv({ KINGDEE_MODE: 'real' });
  const previousFetch = globalThis.fetch;
  let savedModel;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('AuthService.ValidateUser')) {
      return jsonResponse({ LoginResultType: 1 }, { 'Set-Cookie': 'kdservice-sessionid=abc; Path=/' });
    }
    if (path.includes('DynamicFormService.SwitchOrg')) {
      return jsonResponse({ Result: { ResponseStatus: { IsSuccess: true, Errors: [] } } });
    }
    if (path.includes('DynamicFormService.ExecuteBillQuery')) {
      return jsonResponse([[127429, 'B1IELSHBX26071900003']]);
    }
    if (path.includes('DynamicFormService.View')) {
      if (savedModel) {
        return jsonResponse({
          Result: {
            ResponseStatus: { IsSuccess: true, Errors: [] },
            Result: {
              FID: 127429,
              FBillNo: 'B1IELSHBX26071900003',
              FOrgID: { FNumber: '886' },
              FProposerID: { FStaffNumber: 'PL-CURRENT' },
              FRequestDeptID: { FNumber: 'BM000006' },
              FBillTypeID: { FNumber: 'FYBXD001_SYS' },
              FExpAmountSum: 100,
              FEntity: []
            }
          }
        });
      }
      return jsonResponse({
        Result: {
          ResponseStatus: { IsSuccess: true, Errors: [] },
          Result: {
            FID: 127429,
            FBillNo: 'B1IELSHBX26071900003',
            FOrgID: { FNumber: '886' },
            FProposerID: { FStaffNumber: 'PL-WRONG' },
            FRequestDeptID: { FNumber: 'BM000006' },
            FBillTypeID: { FNumber: 'FYBXD001_SYS' },
            FExpAmountSum: 100,
            FEntity: []
          }
        }
      });
    }
    if (path.includes('DynamicFormService.Save')) {
      savedModel = JSON.parse(JSON.parse(String(options.body)).data).Model;
      return jsonResponse({
        Result: {
          ResponseStatus: {
            IsSuccess: true,
            SuccessEntitys: [{ Id: 127429, Number: 'B1IELSHBX26071900003' }]
          }
        }
      });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  const payload = {
    Model: {
      FID: 0,
      FBillNo: 'B1IELSHBX26071900003',
      FOrgID: { FNumber: '886' },
      FProposerID: { FStaffNumber: 'PL-CURRENT' },
      FRequestDeptID: { FNumber: 'BM000006' },
      FBillTypeID: { FNumber: 'FYBXD001_SYS' },
      FExpAmountSum: 100,
      FEntity: []
    }
  };
  try {
    const result = await saveKingdeeExpenseReimbursement(payload, {
      allowExistingBillOverwrite: true
    });
    assert.equal(savedModel.FID, 127429);
    assert.equal(result.erpFid, '127429');
    assert.equal(result.erpNumber, 'B1IELSHBX26071900003');
    assert.equal(result.overwroteExistingBill, true);
    assert.equal(
      result.rawResponse.existingBeforeOverwrite.Result.Result.FProposerID.FStaffNumber,
      'PL-WRONG'
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

test('save classifies an application date before the Kingdee organization enable date as a business skip', async () => {
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
      return jsonResponse({
        Result: {
          ResponseStatus: {
            IsSuccess: false,
            Errors: [{
              Message: 'ResolveFiled_InnerEx解析字段(Key:FDate,name:申请日期)时发生异常，异常信息:申请日期应大于申请组织启用日期2026-06-01 00:00:00'
            }]
          }
        }
      });
    }
    throw new Error(`unexpected Kingdee URL: ${url}`);
  };
  try {
    await assert.rejects(
      () => saveKingdeeExpenseReimbursement({
        Model: {
          FDate: '2026-05-31',
          FOrgID: { FNumber: '886' }
        }
      }),
      (error) => error.code === 'KINGDEE_APPLICATION_DATE_BEFORE_ENABLE_DATE'
        && error.detail.applicationDate === '2026-05-31'
        && error.detail.enableDate === '2026-06-01'
        && error.message.includes('程序保留了分贝通申请日期')
        && !error.message.includes('ResolveFiled_InnerEx')
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
            OrgID: { Number: '886' },
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
