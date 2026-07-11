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
    accountBookNumber: '011',
    voucherGroupNumber: 'PZZ8',
    voucherGroupNo: '',
    templateErpFid: '779869',
    currencyNumbers: { CNY: 'PRE001' },
    categoryAccountNumbers: {
      TRAVEL: '6601.09',
      OFFICE: '6601.15'
    },
    departmentDetailField: 'FDETAILID__FFLEX5',
    employeeDetailField: 'FDETAILID__FFLEX7',
    creditAccountNumber: '1002.01',
    creditDetailNumbers: {
      FDETAILID__FF100009: '31050179420000002440'
    },
    exchangeRateTypeNumber: 'HLTX01_SYS',
    exchangeRate: 1,
    splitDeductibleTax: true,
    taxAccountNumber: '2221.01.01.05',
    mockFixedJson: fixedJson,
    mockVoucherDate: '2026-07-11',
    mockYear: 2026,
    mockPeriod: 7,
    fenbeitongBaseUrl: '',
    fenbeitongAccessToken: '',
    fenbeitongReimbursementApplyState: 4,
    fenbeitongReimbursementPageSize: 20
  };
}
