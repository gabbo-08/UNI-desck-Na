function parseTrustProxy(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const normalized = String(value).trim().toLowerCase();
  if (['false', 'off', 'no', '0'].includes(normalized)) return false;
  if (['true', 'on', 'yes'].includes(normalized)) return true;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const entries = String(value).split(',').map(item => item.trim()).filter(Boolean);
  if (!entries.length) return false;
  return entries.length === 1 ? entries[0] : entries;
}

module.exports = { parseTrustProxy };
