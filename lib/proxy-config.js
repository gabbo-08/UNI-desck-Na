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

function isExplicitTrustProxy(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const normalized = String(value).trim().toLowerCase();
  // Express treats these values as "trust every proxy". They are unsafe in
  // production because an arbitrary client can forge X-Forwarded-* headers.
  if (['true', 'on', 'yes'].includes(normalized)) return false;
  if (['false', 'off', 'no', '0'].includes(normalized)) return true;
  if (/^\d+$/.test(normalized)) return Number(normalized) <= 10;

  const entries = String(value).split(',').map(item => item.trim()).filter(Boolean);
  if (!entries.length) return false;
  return entries.every(entry => {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(entry.toLowerCase())) return true;
    const [address, prefix] = entry.split('/');
    const family = net.isIP(address);
    if (!family || entry.split('/').length > 2) return false;
    if (prefix === undefined) return true;
    if (!/^\d+$/.test(prefix)) return false;
    const max = family === 4 ? 32 : 128;
    return Number(prefix) <= max;
  });
}

module.exports = { parseTrustProxy, isExplicitTrustProxy };
const net = require('node:net');

