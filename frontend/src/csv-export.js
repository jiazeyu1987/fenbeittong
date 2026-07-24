export function encodeCsvCell(value, options = {}) {
  const text = String(value ?? '');
  const excelValue = options.excelText && text
    ? `="${text.replaceAll('"', '""')}"`
    : text;
  return `"${excelValue.replaceAll('"', '""')}"`;
}
