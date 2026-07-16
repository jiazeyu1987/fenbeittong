import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export function buildMockTemplate() {
  const fixedJson = readFileSync(
    resolve(root, 'mock-data/fenbeitong-reimbursement-valid.json'),
    'utf8'
  );

  return {
    accountBookNumber: '007',
    voucherGroupNumber: 'PZZ9',
    voucherGroupNo: '',
    templateErpFid: '111814',
    currencyNumbers: { CNY: 'PRE001' },
    categoryAccountNumbers: {
      TRAVEL: '6111',
      OFFICE: '6111',
      CI007: '6111',
      CI00802: '6111',
      CI010: '6111',
      CI012: '6111',
      CI013: '6111'
    },
    departmentDetailField: '',
    employeeDetailField: '',
    departmentDetailNumberMappings: {},
    employeeDetailNumberMappings: {},
    detailIdMappings: {},
    creditAccountNumber: '1001.01',
    creditDetailNumbers: {},
    exchangeRateTypeNumber: 'HLTX01_SYS',
    exchangeRate: 1,
    splitDeductibleTax: false,
    taxAccountNumber: '',
    erpTemplateModel: loadMockKingdeeTemplateModel(),
    mockFixedJson: fixedJson,
    mockVoucherDate: '2026-07-13',
    mockYear: 2026,
    mockPeriod: 7,
    fenbeitongBaseUrl: '',
    fenbeitongAccessToken: '',
    fenbeitongReimbursementApplyState: 4,
    fenbeitongReimbursementPageSize: 20
  };
}

export function loadMockKingdeeTemplateModel() {
  return JSON.parse(readFileSync(
    resolve(root, 'mock-data/kingdee-voucher-template-007-pzz9.json'),
    'utf8'
  ));
}

