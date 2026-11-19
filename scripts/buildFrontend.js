const fs = require('node:fs');
const path = require('node:path');
function backendOrigin(value) {
  if (!value?.trim()) throw Error('Set BACKEND_URL to your Render HTTPS origin before building.');
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('BACKEND_URL must be an HTTPS origin without credentials, path, query or fragment.');
  return url.origin;
}
function build() {
  const origin = backendOrigin(process.env.BACKEND_URL);
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'dist');
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(root, 'frontend'), output, { recursive: true });
  fs.writeFileSync(path.join(output, 'config.js'), 'globalThis.BLACKOUT_CONFIG = ' + JSON.stringify({ apiBaseUrl: origin }) + ';\n');
  console.log('Public frontend built in dist; backend: ' + origin);
}
if (require.main === module) { try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { backendOrigin, build };
