import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildExpenseReimbursementPreview } from '../src/expense-reimbursement-mapper.js';

test('maps Fenbeitong detail directly to ER_ExpReimbursement', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: config.mockFixedJson,
    documentDate: '2026-01-26',
    sourceTypeValue: '线下报销 · 费用明细',
    config
  });
  const model = preview.payload.Model;
  assert.equal(preview.documentSummary.formId, 'ER_ExpReimbursement');
  assert.equal(model.FOrgID.FNumber, '886');
  assert.equal(model.FProposerID.FStaffNumber, 'PH022');
  assert.equal(model.FRequestDeptID.FNumber, 'BM000006');
  const modelKeys = Object.keys(model);
  assert.ok(modelKeys.indexOf('FOrgID') < modelKeys.indexOf('FProposerID'));
  assert.ok(modelKeys.indexOf('FOrgID') < modelKeys.indexOf('FRequestDeptID'));
  assert.ok(modelKeys.indexOf('FExpenseOrgId') < modelKeys.indexOf('FExpenseDeptID'));
  assert.equal(model.FBillTypeID.FNumber, 'FYBXD001_SYS');
  assert.equal(model.FRequestType, '1');
  assert.equal(model.FRealPay, true);
  assert.equal(model.FCONTACTUNITTYPE, 'BD_Empinfo');
  assert.equal(model.FCONTACTUNIT.FNumber, 'PH022');
  assert.equal(model.FPaySettlleTypeID.FNumber, '10');
  assert.ok(model.FEntity.every((entry) => entry.FSettlleTypeID.FNumber === 'JSFS04_SYS'));
  assert.equal(model.FBillNo, 'MOCK-BX-001');
  assert.equal(model.FDate, '2026-07-11');
  assert.equal(model.FReqAmountSum, 228);
  assert.equal(model.FReqPayReFoundAmountSum, 228);
  assert.equal(model.FEntity.length, 2);
  assert.equal(model.F_ora_Text_qtr, '线下报销 · 费用明细');
  assert.equal(model.FEntity[0].FInvoiceType, '1');
  assert.equal(model.FEntity[1].FInvoiceType, '1');
  assert.equal(model.FEntity[0].F_ora_Decimal_qtr, 101.89);
  assert.equal(model.FEntity[0].FExpenseAmount, 108);
  assert.equal(model.FEntity[0].FReimbNotPayAmount, 108);
  assert.equal(model.FEntity[0].FTaxSubmitAmt, 101.89);
  assert.equal(model.FEntity[0].FLOCNOTAXAMOUNT, 101.89);
  assert.deepEqual(model.FEntity.map((entry) => entry.FExpID.FNumber), ['CI011', 'CI032']);
  assert.equal(model.FExpAmountSum, 228);
  assert.equal(preview.payload.ValidateFlag, 'false');
  assert.equal(preview.payload.IsAutoAdjustField, 'true');
  assert.ok(model.FEntity.every((entry) => entry.FRequestAmount > 0 && entry.FReqSubmitAmount > 0));
  assert.ok(model.FEntity.every((entry) => entry.F_PAEZ_Text === '' && entry.F_ora_Text === ''));
  assert.doesNotMatch(JSON.stringify(preview.payload), /GL_VOUCHER|FAccountBookID|FVOUCHERGROUPID|FDEBIT|FCREDIT|FVOUCHERID/);
});

test('maps ERP employee bank details to header and every payment entry without changing other fields', () => {
  const config = buildMockTemplate();
  config.expenseReimbursementSettlementTypeNumber = 'OTHER';
  const preview = buildExpenseReimbursementPreview({
    fixedJson: config.mockFixedJson,
    documentDate: '2026-01-26',
    employeeBankDetails: {
      openBank: 'Test Bank Branch',
      accountName: 'Test Employee',
      bankAccount: '6222000000000000'
    },
    config
  });
  const model = preview.payload.Model;
  assert.equal(model.FBankBranchT, 'Test Bank Branch');
  assert.equal(model.FBankAccountNameT, 'Test Employee');
  assert.equal(model.FBankAccountT, '6222000000000000');
  const withoutBank = structuredClone(model);
  delete withoutBank.FBankBranchT;
  delete withoutBank.FBankAccountNameT;
  delete withoutBank.FBankAccountT;
  for (const entry of withoutBank.FEntity) {
    assert.equal(entry.FBankBranch, 'Test Bank Branch');
    assert.equal(entry.FBankAccountName, 'Test Employee');
    assert.equal(entry.FBankAccount, '6222000000000000');
    delete entry.FBankBranch;
    delete entry.FBankAccountName;
    delete entry.FBankAccount;
  }
  assert.deepEqual(withoutBank, buildExpenseReimbursementPreview({
    fixedJson: config.mockFixedJson, documentDate: '2026-01-26', config
  }).payload.Model);
  assert.equal(model.FPaySettlleTypeID.FNumber, '10');
});

test('uses the synchronized source document number as the ERP bill number verbatim', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: config.mockFixedJson,
    sourceCodeValue: '0013808520260801',
    config
  });

  assert.equal(preview.payload.Model.FBillNo, '0013808520260801');
  assert.equal(preview.sourceCode, '0013808520260801');
  assert.equal(preview.sourceSummary.sourceCode, '0013808520260801');
  assert.equal(preview.marker, 'FBT-0013808520260801');
});

test('does not invent incomplete ERP employee bank details', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: config.mockFixedJson,
    documentDate: '2026-01-26',
    employeeBankDetails: {
      openBank: 'Test Bank Branch',
      accountName: '',
      bankAccount: ''
    },
    config
  });
  const model = preview.payload.Model;
  assert.equal(Object.hasOwn(model, 'FBankBranchT'), false);
  assert.equal(preview.payload.ValidateFlag, 'false');
  assert.equal(Object.hasOwn(model, 'FBankAccountNameT'), false);
  assert.equal(Object.hasOwn(model, 'FBankAccountT'), false);
});

test('uses exact full-invoice values when Fenbeitong split fields do not balance', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  const deductibleTax = source.data.expenses[0].cost_custom_fields
    .find((field) => field.field_code === 'deductible_tax');
  deductibleTax.detail = '6.10';

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-01-26',
    config
  });
  assert.equal(preview.payload.Model.FEntity[0].FTaxAmt, 6.11);
  assert.equal(preview.payload.Model.FEntity[0].FTaxSubmitAmt, 101.89);
  assert.equal(preview.payload.Model.FEntity[0].FLOCNOTAXAMOUNT, 101.89);
  assert.equal(preview.expenseEntries[0].correctedInvalidSourceSplitFromInvoice, true);
  assert.equal(
    preview.expenseEntries[0].taxSplitSource,
    'FENBEITONG_FULL_INVOICE_FIELDS_AFTER_INVALID_SPLIT'
  );
  assert.equal(preview.expenseEntries[0].sourceSplitTaxAmount, 6.1);
  assert.equal(preview.expenseEntries[0].sourceSplitExcludingTaxAmount, 101.89);
});

test('maps online monthly bill fields and preserves intentional blanks', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'),
    documentDate: '2026-01-01',
    sourceTypeValue: '线上月结 · 企业账单',
    config
  });
  const model = preview.payload.Model;
  assert.equal(preview.sourceKind, 'ONLINE_MONTHLY_BILL');
  assert.equal(preview.sourceSummary.sourceForm, '企业账单');
  assert.equal(preview.sourceSummary.businessLine, '用车');
  assert.equal(model.FBillNo, 'MOCK-BILL-202607-0000000000001');
  assert.equal(
    model.F_ora_Text_qtr,
    `${preview.sourceSummary.sourceKindName} · ${preview.sourceSummary.sourceForm}`
  );
  assert.equal(model.FCausa.startsWith('MOCK-BILL-202607 '), true);
  assert.equal(preview.sourceCode, 'MOCK-BILL-202607');
  assert.equal(preview.payload.ValidateFlag, 'false');
  assert.equal(model.FDate, '2026-07-01');
  assert.equal(model.FReqAmountSum, 0);
  assert.equal(model.FReqPayReFoundAmountSum, 0);
  assert.equal(model.FRequestType, '0');
  assert.equal(model.FRealPay, true);
  assert.equal(model.FCONTACTUNITTYPE, 'FIN_OTHERS');
  assert.equal(model.FCONTACTUNIT.FNumber, '01.03.034');
  assert.equal(preview.documentSummary.contactUnitName, '北京分贝通科技有限公司');
  assert.equal(model.FPaySettlleTypeID.FNumber, '10');
  assert.equal(model.FEntity[0].FSettlleTypeID.FNumber, 'JSFS04_SYS');
  assert.equal(model.FEntity[0].FRequestAmount, 0);
  assert.equal(model.FEntity[0].FTaxAmt, 100);
  assert.equal(model.FEntity[0].FTaxSubmitAmt, 900);
  assert.equal(model.FEntity[0].FLOCNOTAXAMOUNT, 900);
  assert.equal(model.FEntity[0].FExpenseAmount, 1000);
  assert.equal(model.FEntity[0].FReimbNotPayAmount, 1000);
  assert.equal(model.FEntity[0].FOriginalAmount, 1000);
  assert.equal(model.FEntity[0].F_ora_Decimal_qtr, 900);
  assert.equal(model.FEntity[0].F_ora_Text_83g, '用车');
  assert.equal(model.FEntity[0].F_PAEZ_Text, '上海市');
  assert.equal(model.FEntity[0].F_ora_Text, '苏州市');
  assert.equal(model.FEntity[0].F_PAEZ_Text1, '用车');
  assert.equal(model.FEntity[0].FRemark, '商务洽谈');
  assert.equal(model.FEntity[0].FInvoiceType, '1');
  assert.equal(model.FEntity[0].FExpenseDeptEntryID.FNumber, 'BM000006');
  assert.equal(preview.expenseEntries[0].purpose, '商务洽谈');
  assert.equal(preview.expenseEntries[0].sourceReason, '客户拜访用车');
  assert.equal(preview.expenseEntries[0].trafficType, '用车');
});

test('online bill number uses the resolved employee number instead of a CSV placeholder', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.third_employee_id = 'CSVEMP-080';
  source.data.order.employee_name = '李雄';

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    sourceCodeValue: '0013808520260801',
    config
  });

  assert.equal(preview.payload.Model.FBillNo, '0013808520260801-0000000000001');
  assert.doesNotMatch(preview.payload.Model.FBillNo, /CSVEMP/i);
});

test('uses the enterprise non-deductible total when deductible amount is zero', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.order_id = 'OMS260722100113898106295';
  source.data.order.source_detail_id = 'OMS260722100113898106295';
  source.data.order.repayment_total_amount = 33.15;
  source.data.order.reference_deductible_total_amount = 0;
  source.data.order.reference_non_deductible_amount = 33.15;

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-22',
    config
  });
  const entry = preview.payload.Model.FEntity[0];
  assert.equal(entry.FTaxAmt, 0);
  assert.equal(entry.FTaxSubmitAmt, 33.15);
  assert.equal(entry.FLOCNOTAXAMOUNT, 33.15);
  assert.equal(entry.FExpSubmitAmount, 33.15);
});

test('keeps a signed zero-net change order and drops only an all-zero helper row', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  const common = {
    ...source.data.order,
    order_category: 15,
    business_line_name: '火车',
    expense_category_code: 'CI00802',
    start_city_name: '潍坊市',
    end_city_name: '青岛市'
  };
  source.data.orders = [{
    ...common,
    order_id: 'SIGNED-ZERO-NET-CHANGE',
    source_detail_id: 'SIGNED-ZERO-NET-CHANGE',
    order_state: '改签成功',
    repayment_total_amount: 0,
    reference_deductible_total_amount: -0.03,
    reference_non_deductible_amount: 0.03
  }, {
    ...common,
    order_id: 'ALL-ZERO-HELPER',
    source_detail_id: 'ALL-ZERO-HELPER',
    repayment_total_amount: 0,
    reference_deductible_total_amount: 0,
    reference_non_deductible_amount: 0
  }];
  delete source.data.order;

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-05-25',
    config
  });
  const entries = preview.payload.Model.FEntity;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].FExpenseAmount, 0);
  assert.equal(entries[0].FTaxAmt, -0.03);
  assert.equal(entries[0].FExpSubmitAmount, 0);
  assert.equal(preview.totalAmount, 0);
});

test('keeps a zero-gross refund group when its merged tax split is non-zero', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  const common = {
    ...source.data.order,
    order_category: 15,
    business_line_name: '火车',
    expense_category_code: 'CI00802',
    root_order_id: 'CHANGE-GROUP'
  };
  source.data.orders = [{
    ...common,
    order_id: 'CHANGE-GROUP',
    source_detail_id: 'CHANGE-POSITIVE',
    repayment_total_amount: 100,
    reference_deductible_total_amount: 9.01,
    reference_non_deductible_amount: 90.99
  }, {
    ...common,
    order_id: 'CHANGE-REFUND',
    source_detail_id: 'CHANGE-REFUND',
    repayment_total_amount: -100,
    reference_deductible_total_amount: -9,
    reference_non_deductible_amount: -91
  }];
  delete source.data.order;

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-05-25',
    config
  });

  assert.equal(preview.payload.Model.FEntity.length, 1);
  assert.equal(preview.payload.Model.FEntity[0].FExpSubmitAmount, 0);
  assert.equal(preview.payload.Model.FEntity[0].FTaxAmt, 0.01);
  assert.equal(preview.payload.Model.FEntity[0].FTaxSubmitAmt, -0.01);
  assert.equal(preview.payload.Model.FEntity[0].FLOCNOTAXAMOUNT, -0.01);
  assert.equal(preview.taxAmount, 0.01);
  assert.equal(preview.excludingTaxAmount, -0.01);
  assert.equal(preview.totalAmount, 0);
});

test('uses the organization-verified online contact unit supplied by the workflow', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'),
    sourceTypeValue: '线上月结 · 企业账单',
    onlineContactUnit: {
      type: 'FIN_OTHERS',
      number: 'QTWL-886-VERIFIED',
      name: '北京分贝国际旅行社有限公司'
    },
    config
  });

  assert.equal(preview.payload.Model.FCONTACTUNITTYPE, 'FIN_OTHERS');
  assert.equal(preview.payload.Model.FCONTACTUNIT.FNumber, 'QTWL-886-VERIFIED');
  assert.equal(preview.documentSummary.contactUnitNumber, 'QTWL-886-VERIFIED');
  assert.equal(preview.documentSummary.contactUnitName, '北京分贝国际旅行社有限公司');
});

test('keeps a genuinely missing online location blank', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  const order = source.data.order;
  order.order_id = 'ORDER-WITHOUT-LOCATION';
  order.source_detail_id = 'ORDER-WITHOUT-LOCATION';
  for (const field of [
    'departure_city_name', 'departure_city', 'start_city_name', 'start_city',
    'from_city_name', 'from_city', 'order_city_name', 'order_city',
    'pickup_city_name', 'pick_up_city_name', 'pickup_city', 'arrival_name',
    'arrival_city_name', 'arrival_city', 'to_city_name', 'to_city',
    'destination_city_name', 'destination_city', 'return_city_name',
    'return_car_city_name', 'return_city'
  ]) delete order[field];

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-15',
    config
  });
  const entry = preview.payload.Model.FEntity[0];
  assert.equal(entry.F_PAEZ_Text, '');
  assert.equal(entry.F_ora_Text, '');
  assert.equal(preview.payload.ValidateFlag, 'false');
});

test('maps Mao Yun style positive, refund, zero-tax and value-added bill rows exactly', () => {
  const config = buildMockTemplate();
  config.employeeDetailNumberMappings = { ...config.employeeDetailNumberMappings, X022: 'PL-MAO' };
  config.departmentDetailNumberMappings = { ...config.departmentDetailNumberMappings, '西南战区': 'BM-SW' };
  const common = {
    employee_name: '毛云',
    employee_code: 'X022',
    booker_department_name: '西南战区',
    booker_department_code: '西南战区',
    custom_field1: '璞慧医疗器械',
    reason: '日常出差（含参会的“个人消费）',
    travel_approval_reason: '商务洽谈'
  };
  const fixedJson = JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      source_origin: 'SETTLEMENT_POSTING',
      bill_no: 'MAO-YUN-JUNE',
      settlement_month: '202606',
      orders: [
        { ...common, order_id: 'HOTEL-1', order_category: 11, business_line_name: '酒店', expense_category_code: 'CI009', repayment_total_amount: 293, reference_deductible_total_amount: 16.58, reference_non_deductible_amount: 276.42 },
        { ...common, order_id: 'RIDE-1', order_category: 3, business_line_name: '用车', expense_category_code: 'CI008', repayment_total_amount: 28.77, reference_deductible_total_amount: 0, reference_non_deductible_amount: 28.77 },
        { ...common, order_id: 'TRAIN-1', root_order_id: 'TRAIN-1', ticket_number: 'TRAIN-TICKET-1', source_detail_id: 'TRAIN-TICKET-1', order_category: 15, business_line_name: '火车', expense_category_code: 'CI00802', repayment_total_amount: 159, reference_deductible_total_amount: 13.13, reference_non_deductible_amount: 145.87 },
        { ...common, order_id: 'TRAIN-REFUND-1', root_order_id: 'TRAIN-1', ticket_number: 'TRAIN-TICKET-1', source_detail_id: 'TRAIN-TICKET-1:TRAIN-REFUND-1', order_category: 15, business_line_name: '火车', expense_category_code: 'CI00802', repayment_total_amount: -151, reference_deductible_total_amount: -12.68, reference_non_deductible_amount: -138.32 },
        { ...common, order_id: 'SERVICE-1', order_category: 99, business_line_name: '增值服务', expense_category_code: 'CI013', expense_category_name: '餐费-个人', repayment_total_amount: 0.59, reference_deductible_total_amount: 0.03, reference_non_deductible_amount: 0.56 }
      ]
    }
  });

  const preview = buildExpenseReimbursementPreview({ fixedJson, documentDate: '2026-06-30', config });
  assert.equal(preview.documentSummary.entryCount, 4);
  assert.equal(preview.totalAmount, 330.36);
  assert.equal(preview.taxAmount, 17.06);
  assert.equal(preview.excludingTaxAmount, 313.3);
  assert.deepEqual(preview.expenseEntries.map((entry) => entry.businessLine), ['酒店', '用车', '火车', '增值服务']);
  assert.deepEqual(preview.expenseEntries.map((entry) => entry.amount), [293, 28.77, 8, 0.59]);
  assert.deepEqual(preview.expenseEntries.map((entry) => entry.taxAmount), [16.58, 0, 0.45, 0.03]);
  assert.deepEqual(preview.expenseEntries.map((entry) => entry.excludingTaxAmount), [276.42, 28.77, 7.55, 0.56]);
  assert.ok(preview.payload.Model.FEntity.every((entry) => entry.FInvoiceType === '1'));
  assert.ok(preview.payload.Model.FEntity.every((entry) => entry.FExpenseAmount > 0));
});

test('offsets a prior-period refund against enough current rows of the same expense category', () => {
  const config = buildMockTemplate();
  config.employeeDetailNumberMappings = { ...config.employeeDetailNumberMappings, X022: 'PL-MAO' };
  config.departmentDetailNumberMappings = { ...config.departmentDetailNumberMappings, '西南战区': 'BM-SW' };
  const common = {
    employee_name: '毛云',
    employee_code: 'X022',
    booker_department_name: '西南战区',
    booker_department_code: '西南战区',
    order_category: 11,
    business_line_name: '酒店',
    expense_category_code: 'CI009',
    expense_category_name: '住宿费-个人'
  };
  const fixedJson = JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      source_origin: 'SETTLEMENT_POSTING',
      bill_no: 'REFUND-FALLBACK-BILL',
      settlement_month: '202605',
      orders: [
        { ...common, order_id: 'CURRENT-HOTEL-1', source_detail_id: 'CURRENT-HOTEL-1', repayment_total_amount: 400, reference_deductible_total_amount: 22.64, reference_non_deductible_amount: 377.36 },
        { ...common, order_id: 'CURRENT-HOTEL-2', source_detail_id: 'CURRENT-HOTEL-2', repayment_total_amount: 400, reference_deductible_total_amount: 22.64, reference_non_deductible_amount: 377.36 },
        { ...common, order_id: 'LATER-REFUND', root_order_id: 'PRIOR-BILL-HOTEL', source_detail_id: 'LATER-REFUND', repayment_total_amount: -700, reference_deductible_total_amount: -39.62, reference_non_deductible_amount: -660.38 }
      ]
    }
  });

  const preview = buildExpenseReimbursementPreview({
    fixedJson,
    documentDate: '2026-05-31',
    config
  });

  assert.equal(preview.documentSummary.entryCount, 1);
  assert.equal(preview.totalAmount, 100);
  assert.equal(preview.taxAmount, 5.66);
  assert.equal(preview.excludingTaxAmount, 94.34);
  assert.ok(preview.payload.Model.FEntity.every((entry) => entry.FExpenseAmount > 0));
});

test('blocks an unpaired negative online refund before calling Kingdee', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.order_id = 'UNPAIRED-REFUND';
  source.data.order.source_detail_id = 'UNPAIRED-REFUND-TICKET';
  source.data.order.order = { root_ticket_id: 'MISSING-ORIGINAL-TICKET' };
  source.data.order.repayment_total_amount = -10;
  source.data.order.reference_deductible_total_amount = 0;
  source.data.order.reference_non_deductible_amount = -10;

  assert.throws(() => buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-15',
    config
  }), /未找到对应原订单/);
});

test('maps real transport subcategory, employee, tax and route fields', () => {
  const state = JSON.parse(readFileSync('runtime-data-offline/state.json', 'utf8'));
  const record = Object.values(state.syncedDocuments).find((item) =>
    item.sourceMode === 'real'
    && item.requesterCode === 'X025'
    && String(item.fixedJson || '').includes('CI00802')
    && String(item.fixedJson || '').includes('29.56'));
  const preview = buildExpenseReimbursementPreview({
    fixedJson: record.fixedJson,
    documentDate: record.paymentDate,
    config: buildMockTemplate()
  });
  assert.equal(preview.documentSummary.employeeNumber, 'PL0098');
  const train = preview.expenseEntries.find((entry) => entry.sourceCategoryCode === 'CI00802');
  assert.equal(train.expenseItemNumber, 'CI008');
  assert.equal(train.expenseDate, '2026-06-29');
  assert.equal(train.startLocation, '长沙市');
  assert.equal(train.arrivalLocation, '广州市');
  assert.equal(train.taxAmount, 29.56);
  assert.equal(train.excludingTaxAmount, 328.44);
});

test('blocks an unmapped X employee instead of falling back to another person', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.user.code = 'X999';
  source.data.user.name = '未建档员工';
  assert.throws(() => buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-01-26',
    config
  }), /金蝶员工映射缺失/);
});

test('a live account employee mapping overrides the legacy account mapping', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.user.code = 'X012';
  source.data.user.name = '刘昊';
  config.disableRequiredEmployeeNumberMappings = true;
  config.employeeDetailNumberMappings = { X012: 'X012' };

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-01-26',
    config
  });

  assert.equal(preview.documentSummary.employeeNumber, 'X012');
  assert.equal(preview.payload.Model.FProposerID.FStaffNumber, 'X012');
  assert.equal(preview.payload.Model.FCONTACTUNIT.FNumber, 'X012');
});

test('keeps a missing source purpose blank and bypasses only Kingdee generic validation', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.purpose = '';
  source.data.order.public_payment_use = '';
  source.data.order.travel_approval_reason = '';
  source.data.order.reference_deductible_total_amount = 0;
  source.data.order.reference_non_deductible_amount =
    source.data.order.repayment_total_amount;

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-05-25',
    config
  });

  assert.equal(preview.payload.Model.FEntity[0].FRemark, '');
  assert.equal(preview.payload.ValidateFlag, 'false');
});

test('constrains long courier addresses only in the Kingdee custom text fields', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  const longAddress = '贵州省贵阳市观山湖区观山街道观山街道西二环235号贵阳火车北站北大资源项目北大资源梦想城一号地块一栋一单元十二层二十三号';
  source.data.order.order_city_name = longAddress;
  source.data.order.destination_city_name = longAddress;

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-05-25',
    config
  });
  const entry = preview.payload.Model.FEntity[0];

  assert.equal([...entry.F_PAEZ_Text].length, 50);
  assert.equal([...entry.F_ora_Text].length, 50);
  assert.equal(preview.expenseEntries[0].startLocation, longAddress);
  assert.equal(preview.expenseEntries[0].arrivalLocation, longAddress);
});

test('maps the expense department independently for each detail row', () => {
  const config = buildMockTemplate();
  config.departmentDetailNumberMappings = {
    ...config.departmentDetailNumberMappings,
    'SOURCE-DEPT-1': 'ERP-DEPT-1',
    'SOURCE-DEPT-2': 'ERP-DEPT-2'
  };
  const source = JSON.parse(config.mockFixedJson);
  source.data.expenses[0].cost_attributions = [{
    type: 1,
    details: [{ code: 'SOURCE-DEPT-1', name: '来源部门一', amount: 108 }]
  }];
  source.data.expenses[1].cost_attributions = [{
    type: 1,
    details: [{ code: 'SOURCE-DEPT-2', name: '来源部门二', amount: 120 }]
  }];

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-11',
    config
  });
  assert.deepEqual(
    preview.payload.Model.FEntity.map((entry) => entry.FExpenseDeptEntryID.FNumber),
    ['ERP-DEPT-1', 'ERP-DEPT-2']
  );
});

test('maps the confirmed Fenbeitong sales department id to Kingdee BM000006', () => {
  const config = buildMockTemplate();
  config.departmentDetailNumberMappings = {};
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.third_department_id = '6463471272514';
  source.data.order.department_name = '\u9500\u552e\u90e8';
  source.data.order.booker_department_code = '6463471272514';
  source.data.order.booker_department_name = '\u9500\u552e\u90e8';

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-15',
    config
  });

  assert.equal(preview.payload.Model.FRequestDeptID.FNumber, 'BM000006');
  assert.equal(preview.payload.Model.FExpenseOrgId.FNumber, '886');
  assert.equal(preview.payload.Model.FEntity[0].FExpenseDeptEntryID.FNumber, 'BM000006');
});

test('maps the Fenbeitong company-level department placeholder to the valid Kingdee sales department', () => {
  const config = buildMockTemplate();
  config.departmentDetailNumberMappings = {};
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.third_department_id = '3867759050639';
  source.data.order.department_name = '上海璞慧医疗器械有限公司';
  source.data.order.booker_department_code = '3867759050639';
  source.data.order.booker_department_name = '上海璞慧医疗器械有限公司';

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-15',
    config
  });

  assert.equal(preview.payload.Model.FRequestDeptID.FNumber, 'BM000006');
  assert.equal(preview.payload.Model.FEntity[0].FExpenseDeptEntryID.FNumber, 'BM000006');
});

test('maps the Fenbeitong personal flight subcategory to the Kingdee transport expense item', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'));
  source.data.order.expense_category_code = 'CI00803';
  source.data.order.expense_category_name = '交通费-个人（机票）';

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-15',
    config
  });

  assert.equal(preview.payload.Model.FEntity[0].FExpID.FNumber, 'CI008');
});

test('maps a detailed sales hierarchy to the configured top-level sales department', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.user.department_name = '销售部/中大区/华东战区';
  source.data.expenses[0].cost_attributions = [{
    type: 1,
    details: [{ name: '销售部/中大区/华东战区', amount: 108 }]
  }];

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-11',
    config
  });

  assert.equal(preview.payload.Model.FRequestDeptID.FNumber, 'BM000006');
  assert.equal(preview.payload.Model.FEntity[0].FExpenseDeptEntryID.FNumber, 'BM000006');
});

test('falls back to the application department when an expense attribution contains an organization name', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.user.department_name = '销售部/中大区/华东战区';
  source.data.expenses[0].cost_attributions = [{
    type: 1,
    details: [{ name: '上海璞慧医疗器械有限公司', amount: 108 }]
  }];

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    documentDate: '2026-07-11',
    config
  });

  assert.equal(preview.payload.Model.FEntity[0].FExpenseDeptEntryID.FNumber, 'BM000006');
});

test('maps direct Fenbeitong CI011 and CI032 codes without changing other payload fields', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.expenses[0].cost_category = { code: 'CI011', name: '交通费-个人（火车）' };
  source.data.expenses[1].cost_category = { code: 'CI032', name: '通讯费-个人' };

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    sourceTypeValue: '线下报销 · 费用明细',
    config
  });
  const model = preview.payload.Model;

  assert.deepEqual(model.FEntity.map((entry) => entry.FExpID.FNumber), ['CI011', 'CI032']);
  assert.equal(model.FBillNo, 'MOCK-BX-001');
  assert.equal(model.FRequestDeptID.FNumber, 'BM000006');
  assert.equal(model.FRequestType, '1');
  assert.equal(model.FPaySettlleTypeID.FNumber, '10');
  assert.equal(model.F_ora_Text_qtr, '线下报销 · 费用明细');
  assert.deepEqual(model.FEntity.map((entry) => entry.FReimbNotPayAmount), [108, 120]);
});

test('rejects an unknown expense code instead of falling back to another item', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.expenses[0].cost_category = { code: 'UNKNOWN-CODE', name: '未知费用' };

  assert.throws(
    () => buildExpenseReimbursementPreview({ fixedJson: JSON.stringify(source), config }),
    /金蝶费用项目映射缺失：UNKNOWN-CODE\/未知费用/
  );
});

test('maps Fenbeitong team-building subcategories to the Kingdee team activity item', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  const expense = source.data.expenses[0];
  expense.cost_category = { code: '10039', name: '住宿费-团建' };

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    config
  });

  assert.equal(preview.payload.Model.FEntity[0].FExpID.FNumber, 'FYXM13_SYS');
});

test('keeps missing Fenbeitong split fields blank without using invoice tax', () => {
  const config = buildMockTemplate();
  const source = JSON.parse(config.mockFixedJson);
  source.data.expenses[0].cost_custom_fields = source.data.expenses[0].cost_custom_fields
    .filter((field) => !['deductible_tax', 'untaxed_amount', 'date_of_expense'].includes(field.field_code));

  const preview = buildExpenseReimbursementPreview({
    fixedJson: JSON.stringify(source),
    config
  });
  const entry = preview.payload.Model.FEntity[0];

  assert.equal(entry.FExpenseAmount, Number(source.data.expenses[0].total_amount));
  assert.equal(entry.FInvoiceType, '0');
  assert.equal(Object.hasOwn(entry, 'FTaxAmt'), false);
  assert.equal(Object.hasOwn(entry, 'FTaxSubmitAmt'), false);
  assert.equal(Object.hasOwn(entry, 'FLOCNOTAXAMOUNT'), false);
  assert.equal(Object.hasOwn(entry, 'F_ora_Decimal_qtr'), false);
  assert.equal(entry.F_PAEZ_Date, '');
  assert.equal(preview.expenseEntries[0].taxAmount, null);
  assert.equal(preview.expenseEntries[0].excludingTaxAmount, null);
});
