import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export function buildMockTemplate() {
  return {
    expenseReimbursementOrgNumber: '886',
    expenseReimbursementBillTypeNumber: 'FYBXD001_SYS',
    expenseReimbursementSettlementTypeNumber: '10',
    expenseItemNumberMappings: {
      TRAVEL: 'CI011',
      OFFICE: 'CI032',
      CI007: 'CI007',
      CI00801: 'CI008',
      CI00802: 'CI008',
      CI00803: 'CI008',
      CI00804: 'CI008',
      CI00805: 'CI008',
      CI009: 'CI009',
      CI010: 'CI010',
      CI012: 'CI012',
      CI013: 'CI013',
      CI014: 'CI014',
      CI016: 'CI016',
      CI017: 'CI017',
      CI019: 'CI019',
      CI020: 'CI020',
      CI021: 'CI021'
    },
    currencyNumbers: { CNY: 'PRE001' },
    exchangeRateTypeNumber: 'HLTX01_SYS',
    exchangeRate: 1,
    organizationNumberMappings: {
      '璞慧医疗器械': '886'
    },
    departmentDetailNumberMappings: {
      '6463471272514': 'BM000006',
      '3867759050639': 'BM000006',
      '销售部': 'BM000006',
      BM000330: 'BM000006',
      BM000339: 'BM000006',
      BM000321: 'BM000006',
      BM000341: 'BM000006',
      BM000337: 'BM000006',
      BM000340: 'BM000006',
      '1608270254198': 'BM000006',
      '2438456886021': 'BM000006',
      '2481555029466': 'BM000006',
      '2541275905756': 'BM000006',
      '2799607721580': 'BM000006',
      '3039607800797': 'BM000006',
      '3219339967221': 'BM000006',
      '3704976290675': 'BM000006',
      '4451279758290': 'BM000006',
      '6447570410271': 'BM000006',
      '7165741918850': 'BM000006',
      '7232151811803': 'BM000006',
      '7456144743836': 'BM000006',
      '7775236858376': 'BM000006',
      '0692360552606': 'BM000006',
      '销售部': 'BM000006',
      '北大区': 'BM000006',
      '华东战区': 'BM000006',
      '华南战区': 'BM000006',
      '华北战区': 'BM000006',
      '中部战区': 'BM000006',
      '西南战区': 'BM000006',
      '西北战区': 'BM000006',
      '东北战区': 'BM000006',
      '山河战区': 'BM000006',
      '市场技术部': 'BM000006',
      '市场部': 'BM000006',
      '商务部': 'BM000006',
      'OCT产品': 'BM000006'
    },
    employeeDetailNumberMappings: {
      PH022: 'PH022',
      PH025: 'PH025',
      X002: 'PL0147',
      X012: 'PL0223',
      X018: 'PL0198',
      X020: 'PL0145',
      X025: 'PL0098',
      X026: 'PL0205',
      X029: 'PL0221',
      X040: '0000000000001',
      '栗大志': 'PL0147',
      '刘昊': 'PL0223',
      '蒋丹': 'PL0198',
      '杜明': 'PL0145',
      '王俊': 'PL0098',
      '孙天一': 'PL0205',
      '刘俊霞': 'PL0221',
      '李雄': '0000000000001'
    },
    mockFixedJson: readFileSync(
      resolve(root, 'mock-data/fenbeitong-reimbursement-valid.json'),
      'utf8'
    ),
    mockDocumentDate: '2026-01-26',
    mockYear: 2026,
    mockPeriod: 1,
    fenbeitongBaseUrl: '',
    fenbeitongAccessToken: '',
    fenbeitongReimbursementApplyState: 4,
    fenbeitongReimbursementPageSize: 20
  };
}
