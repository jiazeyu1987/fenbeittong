export function summarizeExpenseInvoices(expense) {
  const detailByInvoiceId = invoiceDetailMap(expense);
  const sourceInvoices = Array.isArray(expense?.invoices) ? expense.invoices : [];
  const invoices = sourceInvoices.map((invoice) => {
    const detail = detailByInvoiceId.get(String(invoice?.id || '')) || {};
    return {
      invoiceType: firstText(
        detail.invTypeName,
        invoice?.invoice_type_name,
        invoice?.type_name,
        invoice?.type
      ),
      invoiceCode: firstText(invoice?.code, detail.invCode),
      invoiceNumber: firstText(invoice?.number, detail.invNo),
      invoiceIssueDate: dateOnly(firstText(invoice?.issued_time, detail.issuedDate)),
      sellerName: firstText(invoice?.seller_name, detail.seller, detail.invTitle),
      buyerName: firstText(invoice?.buyer_name, detail.buyer),
      invoiceTaxAmount: exactAmount(invoice?.tax_amount),
      invoiceExcludingTaxAmount: exactAmount(invoice?.exclude_tax_amount),
      invoiceTotalAmount: exactAmount(invoice?.total_amount)
    };
  });

  return {
    invoiceType: joinUnique(invoices.map((invoice) => invoice.invoiceType)),
    invoiceCode: joinUnique(invoices.map((invoice) => invoice.invoiceCode)),
    invoiceNumber: joinUnique(invoices.map((invoice) => invoice.invoiceNumber)),
    invoiceIssueDate: joinUnique(invoices.map((invoice) => invoice.invoiceIssueDate)),
    sellerName: joinUnique(invoices.map((invoice) => invoice.sellerName)),
    buyerName: joinUnique(invoices.map((invoice) => invoice.buyerName)),
    invoiceTaxAmount: sumExact(invoices, 'invoiceTaxAmount'),
    invoiceExcludingTaxAmount: sumExact(invoices, 'invoiceExcludingTaxAmount'),
    invoiceTotalAmount: sumExact(invoices, 'invoiceTotalAmount')
  };
}

function invoiceDetailMap(expense) {
  const invoiceField = (Array.isArray(expense?.cost_custom_fields) ? expense.cost_custom_fields : [])
    .find((field) => field?.field_code === 'invoice_info');
  const details = Array.isArray(invoiceField?.detail?.invoiceList)
    ? invoiceField.detail.invoiceList
    : [];
  return new Map(details
    .map((detail) => [String(detail?.fbInvId || ''), detail])
    .filter(([id]) => id));
}

function firstText(...values) {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim());
  return value === undefined ? '' : String(value).trim();
}

function dateOnly(value) {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(value || '').trim());
  if (!matched) return '';
  return `${matched[1]}-${matched[2].padStart(2, '0')}-${matched[3].padStart(2, '0')}`;
}

function exactAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : null;
}

function sumExact(invoices, key) {
  if (invoices.length === 0 || invoices.some((invoice) => invoice[key] === null)) return null;
  return Math.round((invoices.reduce((sum, invoice) => sum + invoice[key], 0) + Number.EPSILON) * 100) / 100;
}

function joinUnique(values) {
  return [...new Set(values.filter(Boolean))].join(' / ');
}
