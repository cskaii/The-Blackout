const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function checkSyntax() {
  const root = path.resolve(__dirname, '..');
  let count = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        count++;
      }
    }
  }
  for (const directory of ['backend', 'frontend', 'scripts']) walk(path.join(root, directory));
  console.log('Syntax checks passed for ' + count + ' JavaScript files.');
}
if (require.main === module) {
  try { checkSyntax(); } catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
}
module.exports = { checkSyntax };
