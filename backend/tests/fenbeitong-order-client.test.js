import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOnlineTravelOrderDocumentForTest,
  clearFenbeitongTokenCacheForTest,
  hasOfflineExpenseTypeForTest,
  pullFenbeitongReimbursements,
  settlementSourceDetailIdsForTest
} from '../src/adapters/fenbeitong-client.js';
import {
  resetTenantStoreForTest,
  saveFenbeitongTenantCredentials
} from '../src/tenant-store.js';

test('keeps every train detail when one order and ticket number have multiple ticket ids', () => {
  assert.deepEqual(settlementSourceDetailIdsForTest([{
    order_id: 'TRAIN-ORDER-1',
    root_order_id: 'TRAIN-ORDER-1',
    ticket_number: 'E123456789',
    ticket_id: 'TICKET-ID-A'
  }, {
    order_id: 'TRAIN-ORDER-1',
    root_order_id: 'TRAIN-ORDER-1',
    ticket_number: 'E123456789',
    ticket_id: 'TICKET-ID-B'
  }]), [
    'E123456789:TICKET-ID-A',
    'E123456789:TICKET-ID-B'
  ]);
});

test('drops an offline reimbursement row when its expense type is empty', () => {
  assert.equal(hasOfflineExpenseTypeForTest({
    data: {
      reimb_id: 'EMPTY-TYPE',
      reimb_code: 'B1IELSHBX-EMPTY',
      expenses: [{
        total_amount: 1597,
        cost_category: { code: ' ', name: '' },
        expense_type: { code: '', name: null }
      }]
    }
  }), false);

  assert.equal(hasOfflineExpenseTypeForTest({
    data: {
      reimb_id: 'HAS-TYPE',
      reimb_code: 'B1IELSHBX-VALID',
      expenses: [{
        total_amount: 1577,
        cost_category: { code: 'CI011', name: '差旅费' }
      }]
    }
  }), true);
});

test('queries settlement bills even when reimbursement details have no linked orders', async (t) => {
  const previousMode = process.env.FENBEITONG_MODE;
  const previousDataDir = process.env.APP_DATA_DIR;
  const previousFetch = globalThis.fetch;
  process.env.APP_DATA_DIR = 'runtime-data/test-fenbeitong-settlement-gate';
  process.env.FENBEITONG_MODE = 'real';
  resetTenantStoreForTest();

  t.after(() => {
    globalThis.fetch = previousFetch;
    resetTenantStoreForTest();
    if (previousMode === undefined) delete process.env.FENBEITONG_MODE;
    else process.env.FENBEITONG_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;
  });

  saveTenant();
  clearFenbeitongTokenCacheForTest();

  const paths = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === '/openapi/auth/getToken') {
      return jsonResponse({ code: 0, data: 'settlement-access-token' });
    }
    assert.equal(options.headers['access-token'], 'settlement-access-token');
    if (path === '/openapi/reimbursement/v1/list') {
      return jsonResponse({ code: 0, msg: 'success', data: { reimbursements: [] } });
    }
    if (path === '/openapi/bill/business/v1/list') {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: { page_info: { total_pages: 1 }, list: [] }
      });
    }
    assert.fail(`unexpected API call: ${path}`);
  };

  const result = await pullFenbeitongReimbursements({ tenantKey: 'puhui' });

  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.sourceWarnings, []);
  assert.equal(paths.some((path) => path.startsWith('/openapi/order/')), false);
  assert.equal(paths.filter((path) => path === '/openapi/bill/business/v1/list').length, 4);
});

test('uses one access token to pull only posted settlement bill rows', async (t) => {
  const previousMode = process.env.FENBEITONG_MODE;
  const previousDataDir = process.env.APP_DATA_DIR;
  const previousFetch = globalThis.fetch;
  process.env.APP_DATA_DIR = 'runtime-data/test-fenbeitong-linked-orders';
  process.env.FENBEITONG_MODE = 'real';
  resetTenantStoreForTest();

  t.after(() => {
    globalThis.fetch = previousFetch;
    resetTenantStoreForTest();
    if (previousMode === undefined) delete process.env.FENBEITONG_MODE;
    else process.env.FENBEITONG_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;
  });

  saveTenant({ billMonthsBack: 1200 });
  clearFenbeitongTokenCacheForTest();

  const paths = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === '/openapi/auth/getToken') {
      return jsonResponse({ code: 0, data: 'linked-order-access-token' });
    }
    assert.equal(options.headers['access-token'], 'linked-order-access-token');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const payload = JSON.parse(options.body);

    if (path === '/openapi/reimbursement/v1/list') {
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          total_pages: 1,
          reimbursements: [{ id: 'REIMB-1' }]
        }
      });
    }
    if (path === '/openapi/reimbursement/v2/detail') {
      assert.deepEqual(payload, { reimb_code: 'REIMB-1' });
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          reimb_id: 'REIMB-ID-1',
          reimb_code: 'REIMB-1',
          expenses: [],
          orders: [
            { id: 'MUST-NOT-BE-USED', type: '3' }
          ]
        }
      });
    }
    if (path === '/openapi/bill/business/v1/list') {
      assert.equal(payload.start_time.length, 6);
      assert.equal(payload.end_time.length, 6);
      assert.equal([1, 2, 3, 4].includes(payload.state), true);
      assert.equal(payload.page_index, 1);
      if (payload.state !== 4) {
        return jsonResponse({
          code: 0,
          msg: 'success',
          data: {
            total_pages: 1,
            bills: payload.state === 1 ? [{
              code: 'UNISSUED-MUST-BE-IGNORED',
              start_time: '202607',
              end_time: '202607',
              bill_cycle: '2026/07/01-2026/07/31',
              state: 5,
              company_total_price: '1577.00'
            }] : []
          }
        });
      }
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          total_pages: 1,
          bills: [{
            code: '0013808520260601',
            start_time: '202606',
            end_time: '202606',
            bill_cycle: '2026/06/01-2026/06/30',
            state: 4,
            company_total_price: '158.31'
          }]
        }
      });
    }
    if (path === '/openapi/bill/business/v1/detail') {
      assert.deepEqual(payload, {
        bill_code: '0013808520260601',
        page_index: 1,
        page_size: 100
      });
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          count: 6,
          page_index: 1,
          page_size: 50,
          details: [{
            order_category: '快递',
            order_id: 'EXPRESS-1',
            root_order_id: 'EXPRESS-1',
            ticket_number: 'SHARED-TICKET-1',
            order_create_time: '2026-06-20 08:00:00',
            user_name: 'Receiver One',
            user_code: 'X999',
            payer_name: 'Employee One',
            payer_code: 'X001',
            user_dept: 'Sales',
            payer_dept: 'Finance',
            payer_department_code: 'BOOKER-DEPT-1',
            third_fields_json: {
              settleOrder_thirdExtFieldsJson_passengerUserId: 'PASSENGER-ID-MUST-NOT-BE-USED',
              settleOrder_thirdExtFieldsJson_passengerDeptId: 'PASSENGER-DEPT-MUST-NOT-BE-USED',
              settleOrder_thirdExtFieldsJson_bookerUserId: 'BOOKER-ID-FALLBACK',
              settleOrder_thirdExtFieldsJson_bookerDeptId: 'BOOKER-DEPT-FALLBACK'
            },
            cost_attribution_name1: '<Sales:100.00%>',
            company_price: '157.72',
            deductible_total_amount: '5.66',
            un_deductible_total_amount: '152.06',
            refer_including_tax_amount_par_price: '250.00',
            refer_total_amount_deductible_par_price: '9.00',
            reason: '寄送样品',
            start_address_name: 'Shanghai',
            end_address_name: 'Suzhou'
          }, {
            order_category: 913,
            order_id: 'SERVICE-1',
            root_order_id: 'EXPRESS-1',
            ticket_number: 'SHARED-TICKET-1',
            order_create_time: '2026-06-20 08:10:00',
            payer_name: 'Employee One',
            payer_dept: 'Sales',
            company_price: '0.59',
            deductible_total_amount: '0.03',
            refer_including_tax_amount_par_price: '0.59',
            refer_total_amount_deductible_par_price: '0.03',
            cost_category: '服务费'
          }, {
            order_category: '用车',
            order_id: 'PERSONAL-1',
            personal_price: '88.00'
          }, {
            order_category: 15,
            order_id: 'ZERO-COMPANY-PAY-CHANGE-ORDER',
            company_price: '0.00',
            refer_including_tax_amount_par_price: '147.00',
            refer_total_amount_deductible_par_price: '12.14'
          }, {
            order_category: 15,
            order_id: 'SIGNED-ZERO-NET-CHANGE-ORDER',
            root_order_id: 'EXPRESS-1',
            ticket_number: 'CHANGE-TICKET-1',
            order_state: '改签成功',
            trip_number: 'D8185',
            order_create_time: '2026-05-25 16:56:59',
            payer_name: 'Employee One',
            payer_code: 'X001',
            payer_dept: 'Finance',
            payer_department_code: 'BOOKER-DEPT-1',
            company_price: '0.00',
            deductible_total_amount: '-0.03',
            un_deductible_total_amount: '0.03',
            start_city_name: '潍坊市',
            end_city_name: '青岛市',
            cost_category: '交通费-个人（火车）'
          }, {
            order_category: 9999,
            order_id: 'EMPTY-BUSINESS-LINE-MUST-BE-IGNORED',
            company_price: '1577.00',
            deductible_total_amount: '37.87',
            un_deductible_total_amount: '1539.13',
            user_name: '粟大志'
          }, {
            order_category: 3,
            order_id: 'USER-MUST-NOT-BECOME-BOOKER',
            company_price: '12.00',
            deductible_total_amount: '0.00',
            un_deductible_total_amount: '12.00',
            user_name: 'Traveler Must Not Be Used',
            user_code: 'X888',
            user_dept: 'Passenger Department'
          }]
        }
      });
    }
    if (path === '/openapi/order/taxi/v1/detail') {
      assert.equal(payload.category_type, 3);
      const posted = payload.order_id === 'OMS260620000001';
      return jsonResponse({
        code: 0,
        msg: 'success',
        data: {
          order: {
            id: payload.order_id,
            create_time: '2026-06-20 08:00:00',
            ...(posted ? { bill_code: '0013808520260601' } : {})
          },
          payer: {
            name: 'Employee One',
            third_id: 'EMP-1',
            third_dept_id: 'DEPT-1',
            department_name: 'Sales'
          },
          price: {
            corporate: posted ? '157.72' : '88.00',
            corporate_surplus: posted ? '157.72' : '88.00'
          },
          saas: {
            order_reason: 'Business trip',
            cost_category: { code: 'CI00803', name: '交通费-个人（机票）' },
            cost_attributions: []
          },
          trip: { start_city_name: 'Shanghai', end_city_name: 'Suzhou' }
        }
      });
    }
    assert.fail(`unexpected request: ${path}`);
  };

  const result = await pullFenbeitongReimbursements({ tenantKey: 'puhui' });
  const online = result.documents.filter((document) => document.data?.source_kind === 'ONLINE_MONTHLY_BILL');

  assert.equal(online.length, 4);
  assert.equal(online[0].data.source_origin, 'SETTLEMENT_POSTING');
  assert.equal(online[0].data.source_contract, 'BUSINESS_BILL_LIST_AND_DETAIL');
  assert.equal(online[0].data.settlement_month, '202606');
  assert.equal(online[0].data.bill_no, '0013808520260601');
  assert.equal(online[0].data.order.repayment_total_amount, 157.72);
  assert.equal(online[0].data.order.booker_department_name, 'Sales');
  assert.equal(online[0].data.order.order_category, 131);
  assert.equal(online[0].data.order.business_line_name, '快递');
  assert.equal(online[1].data.order.order_category, 913);
  assert.equal(online[1].data.order.business_line_name, '增值服务');
  assert.equal(online[1].data.order.repayment_total_amount, 0.59);
  assert.equal(online[1].data.order.reference_deductible_total_amount, 0.03);
  assert.equal(online[1].data.order.reference_non_deductible_amount, 0.56);
  assert.equal(online[2].data.order.order_id, 'SIGNED-ZERO-NET-CHANGE-ORDER');
  assert.equal(online[2].data.order.repayment_total_amount, 0);
  assert.equal(online[2].data.order.reference_deductible_total_amount, -0.03);
  assert.equal(online[2].data.order.reference_non_deductible_amount, 0.03);
  assert.equal(online[2].data.order.business_line_name, '火车');
  assert.equal(online[2].data.order.source_detail_id, 'CHANGE-TICKET-1:SIGNED-ZERO-NET-CHANGE-ORDER');
  assert.equal(online[0].data.order.reference_deductible_total_amount, 5.66);
  assert.equal(online[0].data.order.reference_non_deductible_amount, 152.06);
  assert.equal(online[0].data.order.employee_name, 'Employee One');
  assert.equal(online[0].data.order.third_employee_id, 'X001');
  assert.equal(online[0].data.order.department_name, 'Finance');
  assert.equal(online[0].data.order.third_department_id, 'BOOKER-DEPT-1');
  assert.equal(online[0].data.order.source_detail_id, 'SHARED-TICKET-1');
  assert.equal(online[1].data.order.source_detail_id, 'SHARED-TICKET-1:SERVICE-1');
  assert.equal(online[3].data.order.employee_name, '');
  assert.equal(online[3].data.order.third_employee_id, '');
  assert.equal(online[3].data.order.department_name, '');
  assert.equal(online[3].data.order.third_department_id, '');
  assert.equal(paths.some((path) => path.startsWith('/openapi/order/')), false);
  assert.equal(paths.filter((path) => path === '/openapi/bill/business/v1/list').length, 4);
  assert.equal(paths.filter((path) => path === '/openapi/bill/business/v1/detail').length, 1);
});

test('retains a signed refund and does not manufacture settlement tax fields', () => {
  const document = buildOnlineTravelOrderDocumentForTest({
    summary: { order_id: 'REFUND-1', category_type: 60 },
    payload: { order_id: 'REFUND-1', category_type: 60 }
  }, {
    code: 0,
    data: {
      order: { id: 'REFUND-1', create_time: '2026-06-29 08:24:00', bill_code: '0013808520260601' },
      payer: { name: '毛云', code: 'X022', department_name: '西南战区' },
      price: { corporate_surplus: '-28.80' },
      saas: { order_reason: '退订', cost_category: { custom_code: 'CI013', name: '餐费-个人' } }
    }
  });

  assert.equal(document.data.order.repayment_total_amount, -28.8);
  assert.equal(document.data.order.reference_deductible_total_amount, null);
  assert.equal(document.data.order.reference_non_deductible_amount, null);
});

function saveTenant(overrides = {}) {
  saveFenbeitongTenantCredentials({
    key: 'puhui',
    name: 'Puhui',
    status: 'ready',
    authMode: 'app-key',
    baseUrl: 'https://openapi.example.test',
    authPath: '/openapi/auth/getToken',
    pullPath: '/openapi/reimbursement/v1/list',
    detailPath: '/openapi/reimbursement/v2/detail',
    appId: 'app-id-for-settlement-test',
    appKey: 'app-key-for-settlement-test',
    billMonthsBack: 2,
    refreshIntervalSeconds: 7200,
    listPayload: { page_index: 1, page_size: 20 },
    ...overrides
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
