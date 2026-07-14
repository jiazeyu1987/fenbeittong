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
    accountBookNumber: '908',
    voucherGroupNumber: 'PZZ9',
    voucherGroupNo: '',
    templateErpFid: '780047',
    currencyNumbers: { CNY: 'PRE001' },
    categoryAccountNumbers: {
      TRAVEL: '1001.01',
      OFFICE: '1001.01',
      CI007: '6601.10',
      CI00802: '6601.09',
      CI010: '6601.07',
      CI012: '6601.15',
      CI013: '6601.07'
    },
    departmentDetailField: '',
    employeeDetailField: '',
    creditAccountNumber: '6111',
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
    resolve(root, 'mock-data/kingdee-voucher-template-908-pzz9.json'),
    'utf8'
  ));
}
