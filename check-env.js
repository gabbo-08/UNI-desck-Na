require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const checks = [];

function check(name, ok, message) {
  checks.push({ name, ok, message });
}

check('JWT_SECRET', Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.trim()),
  isProduction ? 'obbligatorio in produzione' : 'mancante: verrà usato il segreto di sviluppo');

const username = process.env.DOCENTI_USERNAME || '';
const password = process.env.DOCENTI_PASSWORD || '';
const hasDocentiCredentials = Boolean(username && password);
check('DOCENTI_USERNAME', !username || username === username.trim(), 'presenta spazi ai bordi');
check('DOCENTI_PASSWORD', !password || password === password.trim(), 'presenta spazi ai bordi');

check('PORT', !process.env.PORT || /^\d+$/.test(process.env.PORT), 'deve essere un numero');
check('FRONTEND_URL', !process.env.FRONTEND_URL || /^https?:\/\//.test(process.env.FRONTEND_URL), 'deve essere un URL http(s)');

for (const { name, ok, message } of checks) {
  console.log(`${ok ? '[OK]' : '[!]'} ${name}: ${ok ? 'valida' : message}`);
}

console.log(`\nDocenti: ${hasDocentiCredentials ? 'credenziali presenti' : 'credenziali assenti (solo avvisi pubblici)'}`);
console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);

const fatal = isProduction && !checks.find(item => item.name === 'JWT_SECRET').ok;
process.exit(fatal ? 1 : 0);
