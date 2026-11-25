const SHANGHAI_OFFSET_MINUTES = 8 * 60;

export function normalizePaymentTimestamp(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    String(value ?? '').trim()
  );
  if (!match) return '';

  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offset = match[7];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return '';

  if (offset) {
    let sourceOffset = 0;
    if (offset !== 'Z') {
      const hours = Number(offset.slice(1, 3));
      const minutes = Number(offset.slice(-2));
      if (hours > 23 || minutes > 59) return '';
      sourceOffset = (offset.startsWith('-') ? -1 : 1) * (hours * 60 + minutes);
    }
    date.setUTCMinutes(date.getUTCMinutes() + SHANGHAI_OFFSET_MINUTES - sourceOffset);
  }

  const timestamp = date.toISOString().slice(0, 19).replace('T', ' ');
  return timestamp === '1900-01-01 00:00:00' ? '' : timestamp;
}
