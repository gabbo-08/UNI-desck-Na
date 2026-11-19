const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const paths = ['/health', '/ready'];

for (const path of paths) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    console.log(`${path} ${response.status} ${body}`);
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.error(`${path} non raggiungibile entro 5 secondi`);
    process.exitCode = 1;
  }
}
