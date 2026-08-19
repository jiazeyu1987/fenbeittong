import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFenbeitongDetail } from '../src/fenbeitong-detail.js';

test('uses the Fenbeitong submission date as the offline application date', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'EXPENSE-DATE-ID',
      reimb_code: 'EXPENSE-DATE-CODE',
      currency_code: 'CNY',
      total_amount: 3,
      payment_amount: 3,
      apply_state: 4,
      submit_time: '2026-07-20 09:52:23',
      user: { code: 'X001', name: 'Tester' },
      expenses: [
        {
          id: 'EXPENSE-DATE-1',
          cost_category: { code: 'CI001', name: 'Expense type' },
          total_amount: 1,
          cost_attributions: [],
          invoices: [],
          cost_custom_fields: [
            { field_code: 'date_of_expense', detail: '2026-06-03 00:00:00' }
          ]
        },
        {
          id: 'EXPENSE-DATE-2',
          cost_category: { code: 'CI001', name: 'Expense type' },
          total_amount: 2,
          cost_attributions: [],
          invoices: [],
          cost_custom_fields: [
            { field_code: 'date_of_expense', detail: '2026-06-18 00:00:00' }
          ]
        }
      ]
    }
  }));

  assert.equal(parsed.applicationDate, '2026-07-20');
  assert.equal(parsed.applicationDateSource, 'FENBEITONG_SUBMISSION_DATE');
  assert.equal(parsed.sourceDocumentStatus, '已审核');
  assert.deepEqual(parsed.expenses.map((expense) => expense.expenseDate), [
    '2026-06-03',
    '2026-06-18'
  ]);
});

test('uses exact full-invoice values when Fenbeitong custom split fields do not balance', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'SOURCE-SPLIT-ID',
      reimb_code: 'SOURCE-SPLIT-CODE',
      currency_code: 'CNY',
      total_amount: 47.7,
      payment_amount: 47.7,
      user: { code: 'X001', name: 'Tester' },
      expenses: [{
        id: 'SOURCE-SPLIT-EXPENSE',
        cost_category: { code: 'CI00801', name: 'Transport' },
        total_amount: 47.7,
        cost_attributions: [],
        invoices: [{
          id: 'SOURCE-SPLIT-INVOICE',
          type: 10130,
          code: '0123456789',
          number: '9876543210',
          issued_time: '2026-04-01',
          seller_name: '销售方公司',
          seller_tax_code: 'SELLER-TAX-ID',
          buyer_name: '购买方公司',
          buyer_tax_code: 'BUYER-TAX-ID',
          total_amount: 47.7,
          used_amount: 47.7,
          tax_amount: 1.39,
          exclude_tax_amount: 46.31
        }],
        cost_custom_fields: [
          { field_code: 'date_of_expense', detail: '2026-04-02 00:00:00' },
          { field_code: 'deductible_tax', detail: '1.39' },
          { field_code: 'untaxed_amount', detail: '47.70' },
          {
            field_code: 'invoice_info',
            detail: {
              invoiceList: [{
                fbInvId: 'SOURCE-SPLIT-INVOICE',
                invTypeName: '电子发票（增值税普通发票）'
              }]
            }
          }
        ]
      }]
    }
  }));

  assert.equal(parsed.expenses[0].expenseDate, '2026-04-02');
  assert.equal(parsed.expenses[0].splitTaxAmount, 1.39);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, 46.31);
  assert.equal(
    parsed.expenses[0].taxSplitSource,
    'FENBEITONG_FULL_INVOICE_FIELDS_AFTER_INVALID_SPLIT'
  );
  assert.equal(parsed.expenses[0].correctedInvalidSourceSplitFromInvoice, true);
  assert.equal(parsed.expenses[0].sourceSplitTaxAmount, 1.39);
  assert.equal(parsed.expenses[0].sourceSplitExcludingTaxAmount, 47.7);
  const invoice = parsed.expenses[0].invoices[0];
  assert.deepEqual({
    typeCode: invoice.typeCode,
    typeName: invoice.typeName,
    code: invoice.code,
    number: invoice.number,
    issuedDate: invoice.issuedDate,
    sellerName: invoice.sellerName,
    sellerTaxNumber: invoice.sellerTaxNumber,
    buyerName: invoice.buyerName,
    buyerTaxNumber: invoice.buyerTaxNumber,
    exactTaxAmount: invoice.exactTaxAmount,
    exactExcludingTaxAmount: invoice.exactExcludingTaxAmount,
    exactTotalAmount: invoice.exactTotalAmount
  }, {
    typeCode: '10130',
    typeName: '电子发票（增值税普通发票）',
    code: '0123456789',
    number: '9876543210',
    issuedDate: '2026-04-01',
    sellerName: '销售方公司',
    sellerTaxNumber: 'SELLER-TAX-ID',
    buyerName: '购买方公司',
    buyerTaxNumber: 'BUYER-TAX-ID',
    exactTaxAmount: 1.39,
    exactExcludingTaxAmount: 46.31,
    exactTotalAmount: 47.7
  });
});

test('does not substitute deductible tax for a missing exact tax and net pair', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'ZERO-INVOICE-TAX-ID',
      reimb_code: 'ZERO-INVOICE-TAX-CODE',
      currency_code: 'CNY',
      total_amount: 455,
      payment_amount: 455,
      user: { code: 'X039', name: 'Tester' },
      expenses: [{
        id: 'ZERO-INVOICE-TAX-EXPENSE',
        cost_category: { code: 'CI00802', name: 'Train' },
        total_amount: 455,
        cost_attributions: [],
        invoices: [{
          id: 'ZERO-INVOICE-TAX-INVOICE',
          total_amount: 455,
          used_amount: 455,
          tax_amount: 0,
          exclude_tax_amount: 0,
          deductible_tax: 37.57
        }],
        cost_custom_fields: [
          { field_code: 'date_of_expense', detail: '2026-05-07 00:00:00' }
        ]
      }]
    }
  }));

  assert.equal(parsed.expenses[0].splitTaxAmount, null);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, null);
  assert.equal(parsed.expenses[0].taxMappingComplete, false);
});

test('does not use generic tax fields in place of Fenbeitong deductible tax', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'EXPLICIT-SPLIT-ID',
      reimb_code: 'EXPLICIT-SPLIT-CODE',
      currency_code: 'CNY',
      total_amount: 101.78,
      payment_amount: 101.78,
      user: { code: 'X017', name: 'Tester' },
      expenses: [{
        id: 'EXPLICIT-SPLIT-EXPENSE',
        cost_category: { code: 'CI00805', name: 'Mileage' },
        total_amount: 101.78,
        cost_attributions: [],
        invoices: [{
          id: 'PARTIAL-INVOICE',
          total_amount: 293.16,
          used_amount: 101.78,
          tax_amount: 33.72,
          exclude_tax_amount: 259.44
        }],
        cost_custom_fields: [
          { field_code: 'date_of_expense', detail: '2026-04-10 00:00:00' },
          { field_code: 'custom_tax', title: '\u7a0e\u989d', detail: '11.80' },
          { field_code: 'untaxed_amount', title: '\u672a\u7a0e\u91d1\u989d', detail: '89.98' }
        ]
      }]
    }
  }));

  assert.equal(parsed.expenses[0].splitTaxAmount, null);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, null);
  assert.equal(parsed.expenses[0].taxMappingComplete, false);
});

test('uses Fenbeitong deductible tax and untaxed amount exactly', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'DEDUCTIBLE-ONLY-ID',
      reimb_code: 'DEDUCTIBLE-ONLY-CODE',
      currency_code: 'CNY',
      total_amount: 101,
      payment_amount: 101,
      user: { code: 'X022', name: 'Tester' },
      expenses: [{
        id: 'DEDUCTIBLE-ONLY-EXPENSE',
        cost_category: { code: 'CI020', name: 'Hospitality' },
        total_amount: 101,
        cost_attributions: [],
        invoices: [{
          id: 'PARTIAL-INVOICE',
          total_amount: 394,
          used_amount: 101,
          tax_amount: 3.9,
          exclude_tax_amount: 390.1
        }],
        cost_custom_fields: [
          { field_code: 'deductible_tax', title: '\u53ef\u62b5\u6263\u7a0e\u989d', detail: '0.00' },
          { field_code: 'untaxed_amount', title: '\u672a\u7a0e\u91d1\u989d', detail: '101.00' }
        ]
      }]
    }
  }));

  assert.equal(parsed.expenses[0].splitTaxAmount, 0);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, 101);
  assert.equal(parsed.expenses[0].taxMappingComplete, true);
});

test('leaves partially used invoice splits empty even when an old override id is present', () => {
  const cases = [
    {
      invoiceId: 'FID1251385483190845442942893798',
      expenseAmount: 101.78,
      invoiceAmount: 293.16,
      invoiceTax: 33.72,
      expectedTax: 11.80,
      expectedExcludingTax: 89.98
    },
    {
      invoiceId: 'FID2305658563354705927713335813',
      expenseAmount: 207.04,
      invoiceAmount: 220,
      invoiceTax: 25.31,
      expectedTax: 23.80,
      expectedExcludingTax: 183.24
    }
  ];
  for (const item of cases) {
    const parsed = parseFenbeitongDetail(JSON.stringify({
      code: 0,
      data: {
        reimb_id: `DISCOUNT-${item.invoiceId}`,
        reimb_code: `DISCOUNT-${item.invoiceId}`,
        currency_code: 'CNY',
        total_amount: item.expenseAmount,
        payment_amount: item.expenseAmount,
        user: { code: 'X017', name: 'Tester' },
        expenses: [{
          id: `EXPENSE-${item.invoiceId}`,
          cost_category: { code: 'CI00805', name: 'Mileage' },
          total_amount: item.expenseAmount,
          cost_attributions: [],
          invoices: [{
            id: item.invoiceId,
            total_amount: item.invoiceAmount,
            used_amount: item.expenseAmount,
            tax_amount: item.invoiceTax,
            exclude_tax_amount: item.invoiceAmount - item.invoiceTax,
            detail: [
              { amount: item.invoiceTax + 1, exclude_tax_amount: item.invoiceAmount },
              { amount: -1, exclude_tax_amount: -1 }
            ]
          }],
          cost_custom_fields: [
            { field_code: 'date_of_expense', detail: '2026-04-10 00:00:00' }
          ]
        }]
      }
    }));

    assert.equal(parsed.expenses[0].splitTaxAmount, null);
    assert.equal(parsed.expenses[0].splitExcludingTaxAmount, null);
    assert.equal(parsed.expenses[0].taxMappingComplete, false);
  }
});

test('does not invent 1.01 and 99.99 when Fenbeitong only returns whole-invoice values', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'MAO-YUN-SPLIT-ID',
      reimb_code: 'B1IELSHBX26070100003',
      currency_code: 'CNY',
      total_amount: 101,
      payment_amount: 101,
      user: { code: 'X022', name: 'Tester' },
      expenses: [{
        id: '8596904',
        cost_category: { code: 'CI020', name: 'Hospitality' },
        total_amount: 101,
        cost_attributions: [],
        invoices: [{
          id: 'FID5024904612158095362399925113',
          total_amount: 394,
          used_amount: 101,
          tax_amount: 3.9,
          exclude_tax_amount: 390.1,
          tax_rate: 1
        }],
        cost_custom_fields: [
          { field_code: 'date_of_expense', detail: '2026-06-14 00:00:00' }
        ]
      }]
    }
  }));

  assert.equal(parsed.expenses[0].splitTaxAmount, null);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, null);
  assert.equal(parsed.expenses[0].taxMappingComplete, false);
});

test('leaves tax fields empty when deductible tax and untaxed amount are absent', () => {
  const invoiceGroups = [
    [[394, 300, 0]],
    [[498, 498, 28.19]],
    [[77.84, 77.84, 0.77], [0.5, 0.5, 0.03]],
    [[56, 56, 3.17]],
    [[18.71, 18.71, 0.19]],
    [[1235, 1235, 12.23]],
    [[80, 80, 4.53]],
    [[41.98, 41.98, 0.42], [2.1, 2.1, 0.12]],
    [[100, 100, 5.66]],
    [[339.93, 339.93, 19.24]],
    [[139, 80, 7.87, 'FID4574364324625367042072490046']],
    [[78.1, 78.1, 0.77], [0.5, 0.5, 0.03]],
    [[75.1, 75.1, 0.74]],
    [[45, 45, 0.45]],
    [[112.14, 80, 1.11, undefined, 0.79], [0.2, 0, 0.01]],
    [[118, 80, 6.68, 'FID4599943802294353926369161594']]
  ];
  const expenses = invoiceGroups.map((group, expenseIndex) => ({
    id: `EXP-${expenseIndex + 1}`,
    cost_category: { code: 'CI013', name: '餐费-个人' },
    total_amount: group.reduce((sum, [, used]) => sum + used, 0),
    reason: 'confirmed split row',
    cost_attributions: [],
    cost_custom_fields: [],
    invoices: group.map(([total, used, tax, id, currentSplitTax], invoiceIndex) => ({
      id: id || `INV-${expenseIndex + 1}-${invoiceIndex + 1}`,
      total_amount: total,
      used_amount: used,
      tax_amount: tax,
      exclude_tax_amount: total - tax,
      ...(currentSplitTax === undefined ? {} : { current_split_tax_amount: currentSplitTax })
    }))
  }));
  const total = expenses.reduce((sum, expense) => sum + expense.total_amount, 0);
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'CONFIRMED-SPLIT-ID',
      reimb_code: 'B1IELSHBX26053100003',
      currency_code: 'CNY',
      total_amount: total,
      payment_amount: total,
      create_time: '2026-07-20 09:52:23',
      user: { code: 'X026', name: '孙天一', department_code: 'BM000006', department_name: '销售部' },
      expenses
    }
  }));

  assert.equal(parsed.expenses.length, 16);
  assert.ok(parsed.expenses.every((expense) => expense.splitTaxAmount === null));
  assert.ok(parsed.expenses.every((expense) => expense.splitExcludingTaxAmount === null));
  assert.equal(parsed.totalAmount, 3188.76);
  assert.equal(parsed.splitTaxAmount, null);
  assert.equal(parsed.splitExcludingTaxAmount, null);
  assert.equal(parsed.taxMappingComplete, false);
  assert.ok(parsed.expenses.every((expense) => expense.purpose === 'confirmed split row'));
  assert.ok(parsed.expenses.every((expense) => expense.trafficType === ''));
});

test('never prorates whole-invoice tax when a partial-use split is missing', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      reimb_id: 'PARTIAL-TAX-MISSING-ID',
      reimb_code: 'PARTIAL-TAX-MISSING-CODE',
      currency_code: 'CNY',
      total_amount: 101,
      payment_amount: 101,
      user: { code: 'X001', name: 'Tester' },
      expenses: [{
        id: 'PARTIAL-TAX-MISSING-EXPENSE',
        cost_category: { code: 'CI020', name: 'Hospitality' },
        total_amount: 101,
        cost_attributions: [],
        invoices: [{
          id: 'PARTIAL-TAX-MISSING-INVOICE',
          total_amount: 394,
          used_amount: 101,
          tax_amount: 3.9,
          exclude_tax_amount: 390.1
        }],
        cost_custom_fields: [
          { field_code: 'date_of_expense', detail: '2026-06-14 00:00:00' }
        ]
      }]
    }
  }));

  assert.equal(parsed.taxMappingComplete, false);
  assert.equal(parsed.expenses[0].taxMappingComplete, false);
  assert.equal(parsed.expenses[0].taxSplitSource, 'FENBEITONG_SPLIT_FIELDS_MISSING');
  assert.equal(parsed.expenses[0].splitTaxAmount, null);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, null);
  assert.equal(parsed.splitTaxAmount, null);
  assert.equal(parsed.splitExcludingTaxAmount, null);
});

test('normalizes online route, purpose, traffic type and direct department fields', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-ROUTE-001',
      settlement_month: '202607',
      order: {
        order_category: 3,
        order_id: 'ORDER-ROUTE-001',
        order_create_time: '2026-07-21 08:30:00',
        employee_name: '\u5b59\u5929\u4e00',
        third_employee_id: 'X026',
        cost_attribution_name: '\u9879\u76ee\u6210\u672c\u4e2d\u5fc3',
        booker_department_name: '\u9500\u552e\u90e8',
        booker_department_code: 'BM000006',
        pickup_city_name: '\u4e0a\u6d77\u5e02',
        return_city_name: '\u82cf\u5dde\u5e02',
        business_line_name: '\u7528\u8f66',
        reason: '\u5ba2\u6237\u62dc\u8bbf',
        travel_approval_reason: '\u5546\u52a1\u6d3d\u8c08',
        repayment_total_amount: 100,
        reference_deductible_total_amount: 5,
        reference_non_deductible_amount: 95
      }
    }
  }));

  assert.equal(parsed.departmentName, '\u9500\u552e\u90e8');
  assert.equal(parsed.departmentCode, 'BM000006');
  assert.equal(parsed.expenses[0].startLocation, '\u4e0a\u6d77\u5e02');
  assert.equal(parsed.expenses[0].arrivalLocation, '\u82cf\u5dde\u5e02');
  assert.equal(parsed.expenses[0].trafficType, '\u7528\u8f66');
  assert.equal(parsed.expenses[0].purpose, '\u5546\u52a1\u6d3d\u8c08');
  assert.equal(parsed.expenses[0].businessLine, '\u7528\u8f66');
});

test('online expense date uses the issued-bill order creation time only', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-DATE-001',
      settlement_month: '202607',
      order: {
        order_category: 3,
        order_id: 'ORDER-DATE-001',
        order_create_time: '2026-06-30 15:20:26',
        reimbursement_date_time: '2026-07-01 00:00:00',
        start_time: '2026-07-03 08:00:00',
        end_time: '2026-07-03 09:00:00',
        employee_name: 'Tester',
        business_line_name: '\u7528\u8f66',
        repayment_total_amount: 100,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: 100
      }
    }
  }));

  assert.equal(parsed.expenses[0].expenseDateTime, '2026-06-30 15:20:26');
  assert.equal(parsed.expenses[0].expenseDate, '2026-06-30');
});

test('uses source-native hotel, dining, and express locations without inventing cities', () => {
  const common = {
    employee_name: '任向阳',
    employee_code: 'X016',
    department_name: '中部战区',
    third_department_id: '3039607800797',
    reference_deductible_total_amount: 0
  };
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-LOCATION-001',
      settlement_month: '202607',
      orders: [
        {
          ...common,
          order_category: 11,
          order_id: 'HOTEL-1',
          order_create_time: '2026-07-01 08:00:00',
          business_line_name: '酒店',
          pickup_city_name: '武汉市',
          arrival_name: '武汉市',
          repayment_total_amount: 100,
          reference_non_deductible_amount: 100
        },
        {
          ...common,
          order_category: 60,
          order_id: 'DINING-1',
          order_create_time: '2026-07-02 08:00:00',
          business_line_name: '用餐',
          order: { restaurant: '分贝通原始餐厅名称' },
          repayment_total_amount: 80,
          reference_non_deductible_amount: 80
        },
        {
          ...common,
          order_category: 130,
          order_id: 'EXPRESS-1',
          order_create_time: '2026-07-03 08:00:00',
          business_line_name: '快递',
          express: { sender_address: '寄件地址', receiver_address: '收件地址' },
          repayment_total_amount: 20,
          reference_non_deductible_amount: 20
        }
      ]
    }
  }));

  assert.deepEqual(parsed.expenses.map((expense) => [expense.startLocation, expense.arrivalLocation]), [
    ['武汉市', '武汉市'],
    ['分贝通原始餐厅名称', '分贝通原始餐厅名称'],
    ['寄件地址', '收件地址']
  ]);
});

test('leaves online traffic type blank for a non-transport business line', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-HOTEL-001',
      settlement_month: '202607',
      order: {
        order_category: 11,
        order_id: 'ORDER-HOTEL-001',
        order_create_time: '2026-07-21 08:30:00',
        employee_name: '\u5b59\u5929\u4e00',
        third_employee_id: 'X026',
        department_name: '\u9500\u552e\u90e8',
        third_department_id: 'BM000006',
        business_line_name: '\u9152\u5e97',
        repayment_total_amount: 500,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: 500
      }
    }
  }));

  assert.equal(parsed.expenses[0].trafficType, '');
  assert.equal(parsed.expenses[0].purpose, '');
});

test('prefers the Fenbeitong employee code over an internal third-party id', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-EMPLOYEE-001',
      settlement_month: '202607',
      order: {
        order_category: 60,
        order_id: 'ORDER-EMPLOYEE-001',
        order_create_time: '2026-07-22 10:01:15',
        employee_name: '\u5434\u4e9a\u660a',
        third_employee_id: '180920411821365220',
        payer: { code: 'X036', third_id: '180920411821365220' },
        department_name: '\u9500\u552e\u90e8',
        third_department_id: '6463471272514',
        business_line_name: '\u7528\u9910',
        repayment_total_amount: 33.15,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: 0
      }
    }
  }));

  assert.equal(parsed.userCode, 'X036');
});

test('does not infer missing online ERP display fields from unrelated fields', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: 'BILL-BLANK-001',
      settlement_month: '202607',
      order: {
        order_category: 3,
        order_id: 'ORDER-BLANK-001',
        order_create_time: '2026-07-21 08:30:00',
        employee_name: '\u5b59\u5929\u4e00',
        third_employee_id: 'X026',
        cost_attribution_name: '\u4e0d\u5e94\u8865\u5165\u7684\u8d39\u7528\u5f52\u5c5e\u90e8\u95e8',
        from_station_name: '\u4e0d\u5e94\u8865\u5165\u7684\u51fa\u53d1\u7ad9',
        to_station_name: '\u4e0d\u5e94\u8865\u5165\u7684\u5230\u8fbe\u7ad9',
        reason: '\u4e0d\u5e94\u8865\u5165\u7528\u9014\u7684\u4e8b\u7531',
        repayment_total_amount: 100,
        reference_deductible_total_amount: 0,
        reference_non_deductible_amount: 100
      }
    }
  }));

  assert.equal(parsed.departmentName, '');
  assert.equal(parsed.departmentCode, '');
  assert.equal(parsed.businessLine, '');
  assert.equal(parsed.expenses[0].startLocation, '');
  assert.equal(parsed.expenses[0].arrivalLocation, '');
  assert.equal(parsed.expenses[0].trafficType, '');
  assert.equal(parsed.expenses[0].purpose, '');
});

test('combines one employee month into one online document with one detail per order', () => {
  const common = {
    order_category: 3,
    employee_name: '孙钊',
    employee_code: 'X001',
    booker_department_name: '销售部',
    booker_department_code: '6463471272514',
    business_line_name: '用车',
    reference_deductible_total_amount: 0
  };
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      group_id: 'ONLINE-MONTH:puhui:X001:202607',
      group_bill_no: 'FBT202607X001',
      bill_no: 'FBT202607X001',
      settlement_month: '2026-07',
      bill_cycle: '2026/07/01-2026/07/31',
      orders: [
        {
          ...common,
          order_id: 'ORDER-1',
          order_create_time: '2026-07-01 08:00:00',
          repayment_total_amount: 100,
          reference_non_deductible_amount: 100
        },
        {
          ...common,
          order_id: 'ORDER-2',
          order_create_time: '2026-07-22 18:00:00',
          repayment_total_amount: 157.72,
          reference_non_deductible_amount: 157.72
        }
      ]
    }
  }));

  assert.equal(parsed.reimbursementId, 'ONLINE-MONTH:puhui:X001:202607');
  assert.equal(parsed.reimbursementCode, 'FBT202607X001');
  assert.equal(parsed.userCode, 'X001');
  assert.equal(parsed.applicationDate, '2026-07-01');
  assert.equal(parsed.applicationDateSource, 'FENBEITONG_MONTHLY_SETTLEMENT_DATE');
  assert.equal(parsed.expenses.length, 2);
  assert.equal(parsed.totalAmount, 257.72);
  assert.equal(parsed.splitExcludingTaxAmount, 257.72);
  assert.deepEqual(parsed.expenses.map((expense) => expense.id), ['ORDER-1', 'ORDER-2']);
});

test('maps Fenbeitong deductible and un-deductible totals without using tax-rate fallbacks', () => {
  const common = {
    employee_name: '毛云',
    employee_code: 'X022',
    booker_department_name: '西南战区',
    booker_department_code: 'SW',
    reason: '日常出差'
  };
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: '0013808520260701',
      settlement_month: '202606',
      orders: [
        { ...common, order_id: 'RIDE-14.10', order_category: 3, repayment_total_amount: 14.1, refer_including_tax_amount_par_price: 14.1 },
        { ...common, order_id: 'HOTEL-293', order_category: 11, repayment_total_amount: 293, deductible_total_amount: 16.58, un_deductible_total_amount: 276.42 },
        { ...common, order_id: 'TRAIN-REFUND', order_category: 15, repayment_total_amount: -151, deductible_total_amount: -12.68, un_deductible_total_amount: -138.32 },
        { ...common, order_id: 'EXPRESS-22', order_category: 131, repayment_total_amount: 22, deductible_total_amount: 1.25, un_deductible_total_amount: 20.75 },
        { ...common, order_id: 'VALUE-0.59', order_category: 913, business_line_name: '增值服务', repayment_total_amount: 0.59, refer_including_tax_amount_par_price: 0.59, refer_total_amount_deductible_par_price: 0.03 }
      ]
    }
  }));

  assert.deepEqual(parsed.expenses.map((expense) => expense.splitTaxAmount), [0, 16.58, -12.68, 1.25, 0]);
  assert.deepEqual(parsed.expenses.map((expense) => expense.splitExcludingTaxAmount), [14.1, 276.42, -138.32, 20.75, 0.59]);
  assert.deepEqual(parsed.expenses.map((expense) => expense.taxSplitSource), [
    'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS',
    'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS',
    'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS',
    'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS',
    'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS'
  ]);
  assert.equal(parsed.taxMappingComplete, true);
});

test('uses the red deductible columns instead of blue tax and excluding-tax columns', () => {
  const parsed = parseFenbeitongDetail(JSON.stringify({
    code: 0,
    data: {
      source_kind: 'ONLINE_MONTHLY_BILL',
      bill_no: '0013808520260601',
      settlement_month: '202605',
      order: {
        order_id: 'HOTEL-1670',
        order_category: 11,
        employee_name: '栗大志',
        employee_code: 'X002',
        booker_department_name: '销售部',
        booker_department_code: '6463471272514',
        repayment_total_amount: 1670,
        exclude_tax_amount: 1575.47,
        total_tax: 94.53,
        deductible_total_amount: 0,
        un_deductible_total_amount: 1670,
        refer_including_tax_amount_par_price: 1670
      }
    }
  }));

  assert.equal(parsed.expenses[0].splitTaxAmount, 0);
  assert.equal(parsed.expenses[0].splitExcludingTaxAmount, 1670);
  assert.equal(parsed.expenses[0].taxSplitSource, 'FENBEITONG_REFERENCE_DEDUCTIBLE_FIELDS');
});
