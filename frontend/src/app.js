import { api } from './api.js';

const fields = {
  accountBookNumber: document.querySelector('#accountBookNumber'),
  voucherGroupNumber: document.querySelector('#voucherGroupNumber'),
  templateErpFid: document.querySelector('#templateErpFid'),
  mockVoucherDate: document.querySelector('#mockVoucherDate'),
  mockYear: document.querySelector('#mockYear'),
  mockPeriod: document.querySelector('#mockPeriod'),
  currencyNumbers: document.querySelector('#currencyNumbers'),
  categoryAccountNumbers: document.querySelector('#categoryAccountNumbers'),
  creditDetailNumbers: document.querySelector('#creditDetailNumbers'),
  mockFixedJson: document.querySelector('#mockFixedJson')
};

const resultOutput = document.querySelector('#resultOutput');
const statusBadge = document.querySelector('#statusBadge');
const sourceIdInput = document.querySelector('#sourceIdInput');

document.querySelector('#loadTemplateButton').addEventListener('click', loadTemplate);
document.querySelector('#saveConfigButton').addEventListener('click', saveConfig);
document.querySelector('#previewButton').addEventListener('click', preview);
document.querySelector('#prepareButton').addEventListener('click', prepare);
document.querySelector('#queryButton').addEventListener('click', queryProcess);

api.health()
  .then(() => {
    statusBadge.textContent = '后端已连接';
    statusBadge.classList.add('ok');
  })
  .catch((error) => {
    statusBadge.textContent = error.message;
  });

async function loadTemplate() {
  show(await api.getMockTemplate());
  applyTemplate(await api.getMockTemplate());
}

async function saveConfig() {
  show(await api.saveConfig(readConfig()));
}

async function preview() {
  show(await api.preview(buildRequest()));
}

async function prepare() {
  const record = await api.prepare(buildRequest());
  sourceIdInput.value = record.sourceId;
  show(record);
}

async function queryProcess() {
  show(await api.getProcess(sourceIdInput.value));
}

function applyTemplate(template) {
  fields.accountBookNumber.value = template.accountBookNumber;
  fields.voucherGroupNumber.value = template.voucherGroupNumber;
  fields.templateErpFid.value = template.templateErpFid;
  fields.mockVoucherDate.value = template.mockVoucherDate;
  fields.mockYear.value = template.mockYear;
  fields.mockPeriod.value = template.mockPeriod;
  fields.currencyNumbers.value = JSON.stringify(template.currencyNumbers, null, 2);
  fields.categoryAccountNumbers.value = JSON.stringify(template.categoryAccountNumbers, null, 2);
  fields.creditDetailNumbers.value = JSON.stringify(template.creditDetailNumbers, null, 2);
  fields.mockFixedJson.value = template.mockFixedJson;
}

function readConfig() {
  return {
    accountBookNumber: fields.accountBookNumber.value,
    voucherGroupNumber: fields.voucherGroupNumber.value,
    templateErpFid: fields.templateErpFid.value,
    currencyNumbers: parseJson(fields.currencyNumbers.value, '币种映射'),
    categoryAccountNumbers: parseJson(fields.categoryAccountNumbers.value, '费用科目映射'),
    departmentDetailField: 'FDETAILID__FFLEX5',
    employeeDetailField: 'FDETAILID__FFLEX7',
    creditAccountNumber: '1002.01',
    creditDetailNumbers: parseJson(fields.creditDetailNumbers.value, '贷方维度'),
    exchangeRateTypeNumber: 'HLTX01_SYS',
    exchangeRate: 1,
    splitDeductibleTax: true,
    taxAccountNumber: '2221.01.01.05'
  };
}

function buildRequest() {
  if (!fields.mockFixedJson.value.trim()) {
    throw new Error('固定 JSON 不能为空');
  }
  return {
    fixedJson: fields.mockFixedJson.value,
    voucherDate: fields.mockVoucherDate.value,
    year: Number(fields.mockYear.value),
    period: Number(fields.mockPeriod.value),
    config: readConfig()
  };
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('not object');
    }
    return value;
  } catch {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
}

function show(value) {
  resultOutput.textContent = JSON.stringify(value, null, 2);
}

window.addEventListener('error', (event) => {
  show({ error: event.error?.message || event.message });
});
