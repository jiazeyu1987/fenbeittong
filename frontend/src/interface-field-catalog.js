const COMMON_NOTES = {
  configured: '编码值通过上方对应关系配置转换',
  displayOnly: '仅在工作台展示/导出，当前不写入ERP字段'
};

export const interfaceFieldCatalog = [
  row('线下', 'ERP员工列表.EmpinfoBank[].OpenBankName', '开户银行', 'BankBranchT', '按报销人员工编号读取ERP员工档案的真实开户银行；不使用默认值'),
  row('线下', 'ERP员工列表.EmpinfoBank[].BankHolder', '账户名称', 'BankAccountNameT', '按报销人员工编号读取ERP员工档案的真实账户名称；不使用默认值'),
  row('线下', 'ERP员工列表.EmpinfoBank[].BankCode', '银行账号', 'BankAccountT', '按报销人员工编号读取ERP员工档案的真实银行账号；不使用默认值'),
  row('线下', '固定业务规则：电汇（编码10）', '结算方式', 'FPaySettlleTypeID', '所有费用报销单固定写入电汇'),
  row('线上', 'ERP员工列表.EmpinfoBank[].OpenBankName', '开户银行', 'BankBranchT', '按报销人员工编号读取ERP员工档案的真实开户银行；不使用默认值'),
  row('线上', 'ERP员工列表.EmpinfoBank[].BankHolder', '账户名称', 'BankAccountNameT', '按报销人员工编号读取ERP员工档案的真实账户名称；不使用默认值'),
  row('线上', 'ERP员工列表.EmpinfoBank[].BankCode', '银行账号', 'BankAccountT', '按报销人员工编号读取ERP员工档案的真实银行账号；不使用默认值'),
  row('线上', '固定业务规则：电汇（编码10）', '结算方式', 'FPaySettlleTypeID', '所有费用报销单固定写入电汇'),
  row('线下', 'data.reimb_code', '来源单号', 'FBillNo', '单据编号'),
  row('线下', 'data.submit_time / reimburse_time / create_time / apply_time', '申请日期', 'FDate', '申请日期优先取分贝通提交日期'),
  row('线下', 'data.user.code / applicant.code', '报销人员工编号', 'FProposerID / FCONTACTUNIT', '申请人及往来单位；' + COMMON_NOTES.configured),
  row('线下', 'data.user.name / applicant.name', '报销人姓名', 'FProposerID', COMMON_NOTES.configured),
  row('线下', 'data.approval_department.code / department_code', '申请部门编号', 'FRequestDeptID / FExpenseDeptID', COMMON_NOTES.configured),
  row('线下', 'data.approval_department.name / department_name', '申请部门名称', 'FRequestDeptID / FExpenseDeptID', COMMON_NOTES.configured),
  row('线下', 'data.organization.code / name', '申请组织、费用承担组织', 'FOrgID / FExpenseOrgId / FPayOrgId', COMMON_NOTES.configured),
  row('线下', 'data.currency_code', '币种', 'FCurrencyID / FLocCurrencyID / FOriginalCurrencyId', COMMON_NOTES.configured),
  row('线下', 'data.supplement_desc / apply_reason / apply_remark', '事由', 'FCausa', '费用报销单事由'),
  row('线下', 'data.total_amount', '单据报销总额', 'FExpAmountSum / FLocExpAmountSum / FReqReimbAmountSum', '单据头合计以明细汇总校验'),
  row('线下', 'data.payment_amount', '付款金额', 'FReqPayReFoundAmountSum', '申请退/付款金额'),
  row('线下', 'data.reimburse_type.name / type', '单据类型', 'FBillTypeID', 'ERP单据类型编码取配置值'),
  row('线下', 'data.status / state / apply_state', '分贝通单据状态', '—', '只同步已审核；' + COMMON_NOTES.displayOnly),
  row('线下', 'data.expenses[].cost_category.code / name', '费用类型', 'FEntity[].FExpID', COMMON_NOTES.configured),
  row('线下', 'data.expenses[].total_amount', '报销金额', 'FExpenseAmount / FExpSubmitAmount / FOriginalAmount / FReimbNotPayAmount', 'ERP报销金额及报销未付款金额均写分贝通报销金额'),
  row('线下', 'data.expenses[].cost_custom_fields[untaxed_amount]', '不含税金额', 'FTaxSubmitAmt / FLOCNOTAXAMOUNT / F_ora_Decimal_qtr', 'ERP费用金额写分贝通接口不含税金额；缺失时不反算'),
  row('线下', 'data.expenses[].attribution_department_amount', '费用归属部门金额', 'FRequestAmount / FReqSubmitAmount / FLocReqSubmitAmount', '为空的费用明细不取值'),
  row('线下', '费用自定义字段：可抵扣税额（deductible_tax）', '税额', 'FTaxAmt / FLOCTAXAMOUNT', '直接取分贝通可抵扣税额，不按比例反算'),
  row('线下', '费用自定义字段：未税金额', '不含税金额', 'FLOCNOTAXAMOUNT / F_ora_Decimal_qtr', '直接取分贝通未税金额'),
  row('线下', 'data.expenses[].cost_custom_fields[date_of_expense]', '费用发生日期', 'F_PAEZ_Date', '直接取费用发生日期'),
  row('线下', 'data.expenses[].cost_custom_fields[start_location]', '出发地', 'F_PAEZ_Text', '最长写入50字符'),
  row('线下', 'data.expenses[].cost_custom_fields[arrival_location]', '目的地', 'F_ora_Text', '最长写入50字符'),
  row('线下', 'data.expenses[].reason', '用途', 'FRemark', '费用明细用途'),
  row('线下', 'data.expenses[].attribution_department.code / name', '费用承担部门', 'FExpenseDeptEntryID', COMMON_NOTES.configured),
  row('线下', 'data.expenses[].invoices[].type', '发票类型', 'FInvoiceType', '有发票或税额拆分时使用增值税模式'),
  row('线下', 'invoices[].code / number / issued_time', '发票代码、号码、开票日期', '—', COMMON_NOTES.displayOnly),
  row('线下', 'invoices[].seller_name / buyer_name', '销售方、购买方名称', '—', COMMON_NOTES.displayOnly),
  row('线下', 'invoices[].tax_amount / exclude_tax_amount / total_amount', '发票税额、不计税金额、价税合计', '—', '用于界面核对；费用行税额仍取费用拆分字段'),

  row('线上', 'data.bill_no / orders[].bill_no', '企业账单编号', 'FBillNo', '直接同步企业账单编号，并追加员工编号保证唯一'),
  row('线上', 'data.group_bill_no', '分组账单编号', 'FBillNo', '有值时优先于bill_no'),
  row('线上', 'data.bill_cycle', '账单周期第一天', 'FDate', '线上申请日期取分贝通账单周期的第一天'),
  row('线上', 'data.settlement_month / start_month / end_month', '结算月份', 'FYear / FPeriod', '用于ERP会计期间'),
  row('线上', 'orders[].employee_code / employee_id', '报销人员工编号', 'FProposerID / FCONTACTUNIT', COMMON_NOTES.configured),
  row('线上', 'orders[].employee_name / customer_name', '报销人姓名', 'FProposerID', COMMON_NOTES.configured),
  row('线上', 'orders[].department_code / department_name', '申请部门、费用承担部门', 'FRequestDeptID / FExpenseDeptID / FExpenseDeptEntryID', COMMON_NOTES.configured),
  row('线上', 'orders[].custom_field1', '申请组织、费用承担组织', 'FOrgID / FExpenseOrgId / FPayOrgId', COMMON_NOTES.configured),
  row('线上', 'orders[].currency_code / data.currency_code', '币种', 'FCurrencyID / FLocCurrencyID / FOriginalCurrencyId', COMMON_NOTES.configured),
  row('线上', 'orders[].reason / order_reason / reimbursement_reason', '事由', 'FCausa', '月结单据事由'),
  row('线上', 'orders[].purpose / travel_approval_reason / business_purpose / public_payment_use', '用途', 'FRemark', '费用明细用途'),
  row('线上', 'orders[].order_category / business_line', '业务线、费用类型', 'FExpID / F_ora_Text_83g', '费用项目编码按类别配置；业务线写自定义字段'),
  row('线上', 'repayment_total_amount / amount_due / total_amount / company_pay_price / enterprise_payment_amount', '报销金额', 'FExpenseAmount / FExpSubmitAmount / FOriginalAmount / FPayedAmount / FReimbNotPayAmount', '取企业账单实际结算金额，同时写入ERP报销未付款金额'),
  row('线上', 'reference_non_deductible_amount', '不含税金额', 'FTaxSubmitAmt / FLOCNOTAXAMOUNT / F_ora_Decimal_qtr', 'ERP费用金额写分贝通接口不含税金额；缺失时不反算'),
  row('线上', 'reference_deductible_total_amount / reference_deductible_amount / deductible_total_amount', '税额', 'FTaxAmt / FLOCTAXAMOUNT', '直接取分贝通可抵扣税额'),
  row('线上', 'reference_non_deductible_amount / reference_nondeductible_amount / un_deductible_total_amount', '不含税金额', 'FLOCNOTAXAMOUNT / F_ora_Decimal_qtr', '直接取分贝通未税金额'),
  row('线上', '已出账单明细 order_create_time', '费用发生日期', 'F_PAEZ_Date', '直接取线上预订/退票/下单日期时间；没有则留空，不使用行程起止时间替代'),
  row('线上', '出发城市/地址字段', '出发地', 'F_PAEZ_Text', '按业务线识别，最长写入50字符'),
  row('线上', '到达城市/地址字段', '目的地', 'F_ora_Text', '按业务线识别，最长写入50字符'),
  row('线上', 'order_category', '交通类型', 'F_PAEZ_Text1', '根据机票、火车、用车等业务类型转换'),
  row('线上', 'order_id / source_order_id', '订单编号', '—', '用于来源追踪和退款关联，不直接写ERP可见字段'),
  row('线上', 'root_order_id / root_ticket_id / pre_ticket_id', '原订单/退款关联编号', '—', '用于退款行和原单关系校验'),
  row('线上', 'ticket_number / ticket_no', '票号', '—', COMMON_NOTES.displayOnly)
];

function row(sourceType, sourceField, normalizedField, erpField, rule) {
  return { sourceType, sourceField, normalizedField, erpField, rule };
}

export function filterInterfaceFieldCatalog(rows, sourceType = '', query = '') {
  const keyword = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return rows.filter((item) => {
    if (sourceType && item.sourceType !== sourceType) return false;
    if (!keyword) return true;
    return [item.sourceField, item.normalizedField, item.erpField, item.rule]
      .some((value) => String(value).toLocaleLowerCase('zh-CN').includes(keyword));
  });
}
