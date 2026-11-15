const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const paths = ['/health', '/ready'];

for (const path of paths) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  console.log(`${path} ${response.status} ${body}`);
  if (!response.ok) process.exitCode = 1;
}
