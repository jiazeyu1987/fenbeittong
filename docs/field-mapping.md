# Field Mapping

| ERP field | Offline reimbursement / 费用明细 | Online monthly settlement / 企业账单 |
|---|---|---|
| source header | 费用报销 | 结算入账 |
| document type | 报销单类型 | 事由 |
| document number | 报销单号 | 账单编号 |
| reason | 报销事由 | 结算月 + 提交人姓名 + 业务线 |
| application date | 提交日期 | 预订/退票/下单日期时间 |
| applicant | 提交人姓名 | 预订/下单/用餐人 |
| request department | 审批部门/项目 | 费用归属部门 |
| request organization | 公司主体 | 自定义字段1 |
| reimbursement total | 报销金额 | 应还款总金额 |
| expense item | 费用类别 | 费用类别/业务类别 |
| request/refund total | 费用归属部门金额 | blank |
| source document status | 单据状态 | blank |
| expense organization | 公司主体 | 自定义字段1 |
| payment amount | 企业支付金额 `company_pay_price` | 应还款总金额 |
| tax amount | 本次拆分税额 | 参考可抵扣总金额 |
| excluding-tax amount | 本次拆分不含税金额 | 参考不可抵扣金额 |
| business line | blank | 业务线 |
| start location (`F_PAEZ_Text`) | 出发地 | 出发城市 / 下单城市 / 取车城市 |
| destination (`F_ora_Text`) | 目的地 | 到达城市 / 入住城市 / 目的城市 / 还车城市 |
| traffic type (`F_PAEZ_Text1`) | blank | 交通类业务线（用车、机票、火车） |
| purpose (`FRemark`) | 费用描述 | 订单关联申请单的 `apply_reason`（例如“商务洽谈”） |
| expense department (`FExpenseDeptEntryID`) | 费用归属部门名称 | 预订 / 下单 / 用餐人直属部门 |

Online settlement details are kept as signed rows. Refunds remain negative and
value-added service charges remain independent rows; neither may be merged into
the original travel or dining line in the source data. Because Kingdee rejects a
negative expense amount, an ERP payload combines a refund with the original ticket
identified by Fenbeitong `root_ticket_id`; the resulting positive row is the net
refund fee. `business line + source detail id` identifies the source row, while
every row must satisfy `enterprise payment = tax + excluding tax`.
The ERP payload never substitutes missing dates, locations, purpose, tax, or
excluding-tax values. Source-provided blank cells stay blank.

`FDate`, `FProposerID`, `FRequestDeptID`, `FOrgID`, `FExpenseOrgId`, totals and `FEntity` fields receive the mapped values. The source status is retained separately because Kingdee's `FDocumentStatus` must remain `Z` (draft) on Save. Kingdee metadata confirms the dedicated business-line field is `F_ora_Text_83g`.

Blank date, location and purpose cells stay empty. For legacy online order snapshots whose
reference deductible/non-deductible fields are absent or incorrectly stored as `0/0`, the
split is reconstructed only for business lines confirmed against the supplied settlement
bill: ride/dining are zero-tax, hotel/express/value-added service use tax-inclusive 6%, and
train uses tax-inclusive 9% with a separately calculated 6% refund fee. Other unverified
business lines remain blocked when their bill split is missing.

Transport subcategories `CI00801`, `CI00802`, `CI00804` and `CI00805` map to Kingdee `CI008`. Missing `Xnnn` employee mappings fail before Save.
