// Simulated filesystem only. Never execute player input in a real shell.
const { filesFor, createIncident } = require('./incident');
const defaultIncident = createIncident();
function normalize(command) { return String(command || '').trim().replace(/\s+/g, ' '); }
function readFileName(command, incident = defaultIncident) {
  const c = normalize(command);
  return c.startsWith('cat ') && Object.hasOwn(filesFor(incident), c.slice(4)) ? c.slice(4) : null;
}
function run(command, incident = defaultIncident) {
  const c = normalize(command), files = filesFor(incident);
  if (c === 'help') return 'Commands:\n  ls            list files\n  pwd           show current directory\n  cat FILENAME  read a file\nFile names are case-sensitive. File buttons run the same simulated cat command.';
  if (c === 'ls') return Object.keys(files).join('   ');
  if (c === 'pwd') return '/home/analyst/blackout';
  const file = readFileName(c, incident);
  if (file) return files[file];
  if (c.startsWith('cat ')) return 'cat: file not found. Use ls to see available files.';
  return 'Command not recognised. Type help.';
}
module.exports = { run, readFileName };
