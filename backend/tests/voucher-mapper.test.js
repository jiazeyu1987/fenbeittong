import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMockTemplate } from '../src/mock-template.js';
import { buildVoucherPreview, parseFenbeitongDetail } from '../src/voucher-mapper.js';

const template = buildMockTemplate();

test('valid fixed JSON creates a balanced voucher preview', () => {
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  assert.equal(preview.sourceId, 'MOCK-REIMB-001');
  assert.equal(preview.debitTotal, 228);
  assert.equal(preview.creditTotal, 228);
  assert.equal(preview.balanced, true);
  assert.equal(preview.payload.Model.DocumentStatus, 'Z');
});

test('missing reimbursement id fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-missing-field.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /data\.reimb_id/);
});

test('expense total mismatch fails fast', () => {
  const fixedJson = readFileSync('mock-data/fenbeitong-reimbursement-invalid-unbalanced.json', 'utf8');
  assert.throws(() => parseFenbeitongDetail(fixedJson), /expense total/);
});

test('real paid amount detail can voucher when expenses match payment amount', () => {
  const config = structuredClone(template);
  config.categoryAccountNumbers.CI007 = '6601.10';
  config.departmentDetailField = 'FDETAILID__FFLEX5';
  config.employeeDetailField = 'FDETAILID__FFLEX7';
  config.departmentDetailNumberMappings = { BM000330: '140103' };
  config.employeeDetailNumberMappings = { PL0189: 'DN00343' };
  config.detailIdMappings = { '140103|DN00343': 139766 };
  const preview = buildVoucherPreview({
    fixedJson: JSON.stringify({
      code: 0,
      data: {
        reimb_id: 'REAL-ID-CI007',
        reimb_code: 'REAL-CODE-CI007',
        currency_code: 'CNY',
        total_amount: 3243.74,
        payment_amount: 186.38,
        apply_reason: 'Real paid reimbursement',
        user: {},
        proposer: {
          code: 'PL0189',
          name: 'Real User',
          department_code: 'BM000330',
          department_name: 'East'
        },
        expenses: [
          {
            id: 'REAL-EXP-CI007',
            cost_category: { code: 'CI007', name: '通讯费-个人' },
            total_amount: 186.38,
            invoices: []
          }
        ]
      }
    }),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  });

  assert.equal(preview.debitTotal, 186.38);
  assert.equal(preview.creditTotal, 186.38);
  assert.equal(preview.payload.Model.FEntity[0].FACCOUNTID.FNumber, '6601.10');
  assert.deepEqual(preview.payload.Model.FEntity[0].FDetailID, { FId: 139766 });
});

test('real Fenbeitong department code maps to Kingdee department dimension number', () => {
  const config = structuredClone(template);
  config.categoryAccountNumbers.CI007 = '6601.10';
  config.departmentDetailField = 'FDETAILID__FFLEX5';
  config.employeeDetailField = 'FDETAILID__FFLEX7';
  config.departmentDetailNumberMappings = { '3039607800797': '140103' };
  config.employeeDetailNumberMappings = { X018: 'DN00343' };
  delete config.detailIdMappings;
  const preview = buildVoucherPreview({
    fixedJson: JSON.stringify({
      code: 0,
      data: {
        reimb_id: 'REAL-ID-MAPPED-DIM',
        reimb_code: 'REAL-CODE-MAPPED-DIM',
        currency_code: 'CNY',
        total_amount: 119,
        payment_amount: 119,
        apply_reason: 'Real paid reimbursement',
        user: {},
        proposer: {
          code: 'X018',
          name: '蒋丹',
          department_code: '3039607800797',
          department_name: '中部战区'
        },
        expenses: [
          {
            id: 'REAL-EXP-CI007-MAPPED',
            cost_category: { code: 'CI007', name: '通讯费-个人' },
            total_amount: 119,
            invoices: []
          }
        ]
      }
    }),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  });

  assert.equal(preview.payload.Model.FEntity[0].FDetailID.FDETAILID__FFLEX5.FNumber, '140103');
  assert.equal(preview.payload.Model.FEntity[0].FDetailID.FDETAILID__FFLEX7.FNumber, 'DN00343');
});

test('known Kingdee auxiliary combination saves by existing detail id', () => {
  const config = structuredClone(template);
  config.categoryAccountNumbers.CI007 = '6601.10';
  config.departmentDetailField = 'FDETAILID__FFLEX5';
  config.employeeDetailField = 'FDETAILID__FFLEX7';
  config.departmentDetailNumberMappings = { '3039607800797': '140103' };
  config.employeeDetailNumberMappings = { X018: 'DN00343' };
  config.detailIdMappings = {
    '140103|DN00343': 139766
  };
  const preview = buildVoucherPreview({
    fixedJson: JSON.stringify({
      code: 0,
      data: {
        reimb_id: 'REAL-ID-DETAIL-ID',
        reimb_code: 'REAL-CODE-DETAIL-ID',
        currency_code: 'CNY',
        total_amount: 119,
        payment_amount: 119,
        apply_reason: 'Real paid reimbursement',
        user: {},
        proposer: {
          code: 'X018',
          name: '蒋丹',
          department_code: '3039607800797',
          department_name: '中部战区'
        },
        expenses: [
          {
            id: 'REAL-EXP-CI007-DETAIL-ID',
            cost_category: { code: 'CI007', name: '通讯费-个人' },
            total_amount: 119,
            invoices: []
          }
        ]
      }
    }),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  });

  assert.deepEqual(preview.payload.Model.FEntity[0].FDetailID, { FId: 139766 });
});

test('default template omits detail dimensions for current Kingdee smoke-save account', () => {
  const preview = buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  });

  assert.equal(preview.payload.Model.FEntity[0].FACCOUNTID.FNumber, '6111');
  assert.deepEqual(preview.payload.Model.FEntity[0].FDetailID, {});
  assert.deepEqual(preview.payload.Model.FEntity[1].FDetailID, {});
});

test('missing category account mapping fails before payload generation', () => {
  const config = structuredClone(template);
  delete config.categoryAccountNumbers.TRAVEL;
  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  }), /category account mapping is missing/);
});

test('voucher date must match accounting year and period', () => {
  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: '2026-08-01',
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /voucherDate .* does not match year\/period/);
});

test('invoice tax anomalies fail before voucher payload generation', () => {
  const root = JSON.parse(template.mockFixedJson);
  root.data.expenses[0].invoices[0].tax_amount = 1;
  root.data.expenses[0].invoices[0].deductible_tax_amount = 2;
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /deductible tax amount .* must not exceed tax amount/);
});

test('duplicate invoice ids fail fast', () => {
  const root = JSON.parse(template.mockFixedJson);
  const duplicate = structuredClone(root.data.expenses[0].invoices[0]);
  root.data.expenses[0].invoices.push(duplicate);
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: template
  }), /duplicate invoice id/);
});

test('required detail dimensions fail fast for expense lines', () => {
  const root = JSON.parse(template.mockFixedJson);
  root.data.user.department_code = '';
  assert.throws(() => buildVoucherPreview({
    fixedJson: JSON.stringify(root),
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config: { ...template, departmentDetailField: 'FDETAILID__FFLEX5' }
  }), /department detail dimension is required/);
});

test('missing ERP template model fails before Kingdee save payload generation', () => {
  const config = structuredClone(template);
  config.templateErpFid = 'UNCONFIRMED-TEMPLATE';
  delete config.erpTemplateModel;

  assert.throws(() => buildVoucherPreview({
    fixedJson: template.mockFixedJson,
    voucherDate: template.mockVoucherDate,
    year: template.mockYear,
    period: template.mockPeriod,
    config
  }), /erpTemplateModel is required/);
});
