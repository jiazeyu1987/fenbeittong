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
    config
  });
  const model = preview.payload.Model;
  assert.equal(preview.documentSummary.formId, 'ER_ExpReimbursement');
  assert.equal(model.FOrgID.FNumber, '886');
  assert.equal(model.FProposerID.FStaffNumber, 'PH022');
  assert.equal(model.FRequestDeptID.FNumber, 'BM000006');
  assert.equal(model.FBillTypeID.FNumber, 'FYBXD001_SYS');
  assert.equal(model.FRequestType, '0');
  assert.equal(model.FRealPay, false);
  assert.equal(model.FBillNo, 'MOCK-BX-001');
  assert.equal(model.FDate, '2026-07-11');
  assert.equal(model.FReqAmountSum, 228);
  assert.equal(model.FReqPayReFoundAmountSum, 228);
  assert.equal(model.FEntity.length, 2);
  assert.equal(model.FEntity[0].FInvoiceType, '1');
  assert.equal(model.FEntity[1].FInvoiceType, '0');
  assert.equal(model.FEntity[0].F_ora_Decimal_qtr, 101.89);
  assert.deepEqual(model.FEntity.map((entry) => entry.FExpID.FNumber), ['CI011', 'CI032']);
  assert.equal(model.FExpAmountSum, 228);
  assert.ok(model.FEntity.every((entry) => entry.FRequestAmount > 0 && entry.FReqSubmitAmount > 0));
  assert.ok(model.FEntity.every((entry) => entry.F_PAEZ_Text === '' && entry.F_ora_Text === ''));
  assert.doesNotMatch(JSON.stringify(preview.payload), /GL_VOUCHER|FAccountBookID|FVOUCHERGROUPID|FDEBIT|FCREDIT|FVOUCHERID/);
});

test('maps online monthly bill fields and preserves intentional blanks', () => {
  const config = buildMockTemplate();
  const preview = buildExpenseReimbursementPreview({
    fixedJson: readFileSync('mock-data/fenbeitong-online-bill-valid.json', 'utf8'),
    documentDate: '2026-01-01',
    config
  });
  const model = preview.payload.Model;
  assert.equal(preview.sourceKind, 'ONLINE_MONTHLY_BILL');
  assert.equal(preview.sourceSummary.sourceForm, '企业账单');
  assert.equal(preview.sourceSummary.businessLine, '用车');
  assert.equal(model.FBillNo, '');
  assert.equal(model.FCausa.startsWith('MOCK-BILL-202607 '), true);
  assert.equal(preview.sourceCode, 'MOCK-BILL-202607');
  assert.equal(preview.payload.ValidateFlag, 'true');
  assert.equal(model.FDate, '2026-07-15');
  assert.equal(model.FReqAmountSum, 0);
  assert.equal(model.FReqPayReFoundAmountSum, 0);
  assert.equal(model.FEntity[0].FRequestAmount, 0);
  assert.equal(model.FEntity[0].FTaxAmt, 100);
  assert.equal(model.FEntity[0].FTaxSubmitAmt, 900);
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
  assert.equal(entries[0].FExpenseAmount, 0.03);
  assert.equal(entries[0].FTaxAmt, -0.03);
  assert.equal(entries[0].FExpSubmitAmount, 0);
  assert.equal(preview.totalAmount, 0);
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
  const state = JSON.parse(readFileSync('runtime-data/state.json', 'utf8'));
  const record = Object.values(state.syncedDocuments).find((item) => item.sourceMode === 'real');
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
