const crypto = require('node:crypto');
const config = require('../config');
const { QUESTIONS } = require('./aiService');
const { run } = require('./virtualLinux');
const { monitoringState } = require('./monitoring');
const sessions = new Map();
const DURATION_MS = 5 * 60 * 1000;
const REQUIRED_FILES = ['incident.log', 'update.txt', 'recovery.txt'];
const PASSPHRASES = ['NIGHT SHIFT', 'LAST LIGHT', 'EYES OPEN', 'BACKUP ACCESS', 'SILENT ALARM', 'DARK SIGNAL'];
let previousPhrase = null;
function encrypt(text, shift) {
  return text.replace(/[A-Z]/g, letter => String.fromCharCode(65 + (letter.charCodeAt(0) - 65 + shift) % 26));
}
function createSession(options = {}) {
  cleanupSessions();
  if (sessions.size >= 1000) throw new Error('Session capacity reached');
  const choices = PASSPHRASES.filter(p => p !== previousPhrase);
  const passphrase = choices[crypto.randomInt(choices.length)];
  previousPhrase = passphrase;
  const id = crypto.randomUUID();
  const choices = PASSPHRASES.filter(phrase => phrase !== previousPhrase);
  const passphrase = choices[crypto.randomInt(choices.length)];
  previousPhrase = passphrase;
  sessions.set(id, {
    stage: 1, revision: 0, passphrase, shift: crypto.randomInt(3, 8), startedAt: Date.now(),
    finished: false, readFiles: [], hints: { 1: 0, 2: 0, 3: 0 },
    hintMessages: {}, terminalHistory: [], aiHistory: [], aiRequests: 0, aiPending: false, aiLastAt: 0
  });
  return id;
}
function getSession(id) {
  const s = sessions.get(id);
  if (s) s.lastSeenAt = Date.now();
  return s;
}
function expired(s) { return s.mode !== 'practice' && !s.finished && Date.now() - s.startedAt >= DURATION_MS; }
function valid(s) { return Boolean(s && !s.finished && !expired(s)); }
function requiredFiles(s) { return ['incident.log', s.incident.source, 'recovery.txt']; }
function publicState(s) {
  const elapsed = (s.finishedAt ?? Date.now()) - s.startedAt;
  const files = filesFor(s.incident);
  return {
    stage: s.stage,
    revision: s.revision,
    remainingSeconds: Math.max(0, Math.ceil((DURATION_MS - elapsed) / 1000)),
    finished: s.finished,
    expired: !s.finished && elapsed >= DURATION_MS,
    monitoring: monitoringState(s, !s.finished && elapsed >= DURATION_MS),
    readFiles: [...s.readFiles],
    requiredFiles: [...REQUIRED_FILES],
    collectedEvidence: s.readFiles.map(file => ({ file, content: run('cat ' + file) })),
    evidenceReady: REQUIRED_FILES.every(file => s.readFiles.includes(file)),
    cipher: { message: encrypt(s.passphrase, s.shift), failedCells: s.shift },
    hintsUsed: Object.values(s.hints).reduce((sum, count) => sum + count, 0),
    revealedHints: { ...s.hintMessages },
    terminalHistory: s.terminalHistory.map(turn => ({ ...turn })),
    ai: { configured: Boolean(config.apiKey), questions: QUESTIONS, remainingRequests: Math.max(0, config.sessionLimit - s.aiRequests), pending: s.aiPending, history: s.aiHistory.map(turn => ({ ...turn })) }
  };
}
function result(s, ok, message) { return { ok, message, state: publicState(s) }; }
function answer(s, stage, value, evidence) {
  if (!valid(s)) return result(s, false, 'Mission ended. Start a new mission to try again.');
  if (s.stage !== stage) return result(s, false, 'Complete the current stage first.');
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const correct = stage === 1 ? normalized === s.passphrase.toLowerCase()
    : stage === 2 ? normalized === 'prompt-injection:update.txt'
    : stage === 3 ? normalized === 'update.txt:b:enable-alerts' : false;
  if (!correct) return result(false, 'That combination does not match the evidence. Recheck the clues or request a hint.');
  if (stage === 3) {
    s.finished = true;
    s.finishedAt = Date.now();
  } else s.stage++;
  s.revision++;
  return result(true, s.finished ? 'Power restored. Mission complete!' : 'Verified. Next stage unlocked.');
}
function hint(s) {
  if (!valid(s)) return result(s, false, 'Mission ended.');
  const p = s.incident;
  const hints = {
    1: [
      'The dark cells on the backup panel give the key. Encryption moved forward; decoding must reverse it.',
      'There are ' + shift + ' failed cells. Set the wheel to ' + shift + ' and read each outer letter as the inner letter. ' + encrypt(s.passphrase[0], shift) + ' becomes ' + s.passphrase[0] + '.',
      'Walkthrough: set the wheel to ' + shift + ', then decode both words. The password is ' + s.passphrase + '.'
    ],
    2: [
      'Use ls, then cat incident.log. Follow the import entry rather than the harmless power-status report.',
      'Read update.txt and recovery.txt. Ask which file tells the assistant to ignore rules rather than simply report measurements.',
      'Walkthrough: read incident.log, update.txt and recovery.txt. Submit Prompt injection with update.txt as the source.'
    ],
    3: [
      'Stop the source of the attack before restoring. Compare backup times and integrity checks with the incident time.',
      'The incident began at 02:14. The latest backup was taken afterwards; the oldest failed its integrity check. Choose the remaining backup and restore monitoring.',
      'Walkthrough: quarantine update.txt, restore Snapshot B, and re-enable safety alerts.'
    ]
  };
  const index = Math.min(s.hints[s.stage], 2);
  s.hints[s.stage] = Math.min(index + 1, 3);
  s.hintMessages[s.stage] = { level: index + 1, total: 3, message: hints[s.stage][index] };
  s.revision++;
  return { ok: true, level: index + 1, total: 3, message: hints[s.stage][index], state: publicState(s) };
}
function cleanupSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const stale = s.mode === 'practice' && !s.finished ? now - s.lastSeenAt > 24 * 60 * 60 * 1000 : now - (s.finishedAt ?? s.startedAt) > 30 * 60 * 1000;
    if (stale) sessions.delete(id);
  }
}
setInterval(cleanupSessions, 60000).unref();
module.exports = { createSession, getSession, publicState, valid, answer, hint, evidence, recover, encrypt, DURATION_MS, cleanupSessions };
