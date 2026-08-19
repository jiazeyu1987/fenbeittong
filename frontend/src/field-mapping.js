export function formatFieldMapping(mapping = {}) {
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') return '';
  return Object.entries(mapping)
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([source, target]) => `${source} = ${target}`)
    .join('\n');
}

export function parseFieldMapping(value, label = '字段对应关系') {
  const mapping = {};
  const lines = String(value || '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const separator = line.includes('=>') ? '=>' : '=';
    const separatorIndex = line.indexOf(separator);
    if (separatorIndex < 1) {
      throw new Error(`${label}第 ${index + 1} 行格式错误，请按“分贝通值 = ERP编码”填写。`);
    }

    const source = line.slice(0, separatorIndex).trim();
    const target = line.slice(separatorIndex + separator.length).trim();
    if (!source || !target) {
      throw new Error(`${label}第 ${index + 1} 行不能为空，请同时填写分贝通值和ERP编码。`);
    }
    mapping[source] = target;
  });

  return mapping;
}
