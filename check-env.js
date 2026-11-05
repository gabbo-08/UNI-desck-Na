require('dotenv').config();

const checks = [];

function check(name, ok, message) {
  checks.push({ name, ok, message });
}

check('CRED_KEY', /^[0-9a-fA-F]{64}$/.test(process.env.CRED_KEY || ''),
  'obbligatoria in formato esadecimale di 32 byte (64 caratteri)');

const username = process.env.DOCENTI_USERNAME || '';
const password = process.env.DOCENTI_PASSWORD || '';
const hasDocentiCredentials = Boolean(username && password);
check('DOCENTI_USERNAME', !username || username === username.trim(), 'presenta spazi ai bordi');
check('DOCENTI_PASSWORD', !password || password === password.trim(), 'presenta spazi ai bordi');

check('PORT', !process.env.PORT || /^\d+$/.test(process.env.PORT), 'deve essere un numero');
const frontendOrigins = String(process.env.FRONTEND_URL || '').split(',').map(value => value.trim()).filter(Boolean);
const validFrontendOrigins = frontendOrigins.every(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
});
check('FRONTEND_URL', validFrontendOrigins, 'deve contenere URL http(s) validi separati da virgole');

for (const { name, ok, message } of checks) {
  console.log(`${ok ? '[OK]' : '[!]'} ${name}: ${ok ? 'valida' : message}`);
}

console.log(`\nDocenti: ${hasDocentiCredentials ? 'credenziali presenti' : 'credenziali assenti (solo avvisi pubblici)'}`);
console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);

const fatal = !checks.find(item => item.name === 'CRED_KEY').ok;
process.exit(fatal ? 1 : 0);
