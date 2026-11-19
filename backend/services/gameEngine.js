const crypto = require('node:crypto');
const config = require('../config');
const { QUESTIONS } = require('./aiService');
const { createIncident, filesFor, evidenceFor, supportFor, monitoringFor, replayFor } = require('./incident');
const sessions = new Map();
const DURATION_MS = 5 * 60 * 1000;
const PASSPHRASES = ['NIGHT SHIFT', 'LAST LIGHT', 'EYES OPEN', 'BACKUP ACCESS', 'SILENT ALARM', 'DARK SIGNAL'];
const OFFSETS = [3, 4, 5, 6, 7];
let previousPhrase;
let previousOffset;
function encrypt(text, shift) {
  return text.replace(/[A-Z]/g, letter => String.fromCharCode(65 + (letter.charCodeAt(0) - 65 + shift) % 26));
}
function createSession(options = {}) {
  cleanupSessions();
  if (sessions.size >= 1000) throw new Error('Session capacity reached');
  const choices = PASSPHRASES.filter(p => p !== previousPhrase);
  const passphrase = choices[crypto.randomInt(choices.length)];
  previousPhrase = passphrase;
  const offsetChoices = OFFSETS.filter(offset => offset !== previousOffset);
  const shift = offsetChoices[crypto.randomInt(offsetChoices.length)];
  const id = crypto.randomUUID();
  sessions.set(id, {
    stage: 1, revision: 0, mode: options.mode === 'practice' ? 'practice' : 'event',
    passphrase, incident: createIncident(), shift, startedAt: Date.now(), lastSeenAt: Date.now(),
    finished: false, readFiles: [], pins: [], selectedRecord: null, recovery: { step: 0, source: null, snapshot: null },
    hints: { 1: 0, 2: 0, 3: 0 }, hintMessages: {}, terminalHistory: [],
    aiHistory: [], aiRequests: 0, aiPending: false, aiLastAt: 0
  });
  previousOffset = shift;
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
    stage: s.stage, revision: s.revision, mode: s.mode,
    remainingSeconds: s.mode === 'practice' ? null : Math.max(0, Math.ceil((DURATION_MS - elapsed) / 1000)),
    elapsedSeconds: Math.floor(elapsed / 1000), finished: s.finished, expired: expired(s),
    readFiles: [...s.readFiles],
    fileNames: s.stage >= 2 ? Object.keys(files) : [],
    collectedEvidence: s.readFiles.map(file => ({ file, content: files[file] })),
    evidenceReady: requiredFiles(s).every(file => s.readFiles.includes(file)),
    evidence: { selectedRecord: s.selectedRecord, pins: [...s.pins], cards: s.stage >= 2 ? evidenceFor(s) : [] },
    recovery: { ...s.recovery },
    monitoring: monitoringFor(s, expired(s)), replay: replayFor(s),
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
  if (stage === 1) {
    if (normalized !== s.passphrase.toLowerCase()) return result(s, false, 'The phrase does not unlock the console. Recheck the wheel or use a hint.');
    s.stage = 2; s.revision++;
    return result(s, true, 'Access granted. Monitoring dashboard unlocked. Find the first conflicting reading.');
  }
  if (stage === 3) return result(s, false, 'Complete quarantine, restore and verification in order using the recovery controls.');
  const support = supportFor(s);
  const supported = Array.isArray(evidence) && evidence.length === 3 && new Set(evidence).size === 3 && support.every(id => evidence.includes(id) && s.pins.includes(id));
  if (!publicState(s).evidenceReady || !s.selectedRecord || !supported) return result(s, false, 'Build a complete evidence chain: the first conflicting sensor record, the import log entry and the malicious instruction. Read the recovery inventory too.');
  if (normalized !== 'prompt-injection:' + s.incident.source) return result(s, false, 'Diagnosis does not match your evidence. Recheck the attack and source.');
  s.stage = 3; s.revision++;
  return result(s, true, 'Diagnosis verified. Quarantine the source before restoring power.');
}
function evidence(s, action, id) {
  if (!valid(s) || s.stage !== 2) return result(s, false, 'Evidence controls are available during active investigation only.');
  const card = evidenceFor(s).find(card => card.id === id);
  if (!card) return result(s, false, 'Read that file before pinning its evidence.');
  if (action === 'record') {
    if (id !== 'sensor:record-1') return result(s, false, 'This is not the first contradiction. Compare voltage and the AI report across the records.');
    s.selectedRecord = id;
    if (!s.pins.includes(id)) s.pins.push(id);
  } else if (action === 'pin' && card.kind !== 'telemetry') {
    if (!s.pins.includes(id)) s.pins.push(id);
  } else if (action === 'unpin') {
    s.pins = s.pins.filter(pin => pin !== id);
    if (id === s.selectedRecord) s.selectedRecord = null;
  } else return result(s, false, 'Choose a sensor record on the dashboard, or pin an examined file excerpt.');
  s.revision++;
  return result(s, true, action === 'record' ? 'First contradiction verified and pinned. Trace what was imported at that time.' : action === 'unpin' ? 'Evidence removed from board.' : 'Evidence pinned. Connect it to the sensor reading in your diagnosis.');
}
function recover(s, action, target) {
  if (!valid(s) || s.stage !== 3) return result(s, false, 'Recovery controls are available during active Stage 3 only.');
  const expected = ['quarantine', 'restore', 'verify'][s.recovery.step];
  if (action !== expected) return result(s, false, 'Follow the recovery order: quarantine, restore, then verify monitoring.');
  const correct = action === 'quarantine' ? target === s.incident.source : action === 'restore' ? target === s.incident.safeSnapshot : target === 'enable-alerts';
  if (!correct) return result(s, false, 'That choice is not safe. Compare the incident source, backup time and integrity, or safety requirement.');
  if (action === 'quarantine') s.recovery.source = target;
  if (action === 'restore') s.recovery.snapshot = target;
  s.recovery.step++;
  if (action === 'verify') { s.finished = true; s.finishedAt = Date.now(); }
  s.revision++;
  return result(s, true, action === 'quarantine' ? 'Source quarantined. Grid remains offline. Choose a clean pre-incident snapshot.' : action === 'restore' ? 'Clean configuration restored: 230 V. Alerts remain muted. Re-enable and verify monitoring.' : 'Power and safety monitoring verified. Mission complete!');
}
function hint(s) {
  if (!valid(s)) return result(s, false, 'Mission ended.');
  const p = s.incident;
  const hints = {
    1: ['Count FAILED backup cells. Reverse the encoder shift to decode the phrase.', `Set the wheel to ${s.shift}. Match encrypted outer letters to decoded inner letters.`, `Walkthrough: offset ${s.shift}; access phrase ${s.passphrase}.`],
    2: ['Find the first row where voltage drops but ALL CLEAR remains. Read incident.log and follow the import.', 'Pin the import entry and the attachment line that tells the AI to ignore its rules. Read recovery.txt before diagnosis.', `Walkthrough: select ${p.event}. Read incident.log, ${p.source} and recovery.txt. Pin incident.log line 2 and ${p.source} line 3. Submit Prompt injection, ${p.source}, and those three pinned evidence items.`],
    3: ['Quarantine the imported source first. Use the newest intact backup from BEFORE the first conflicting record.', `The incident began at ${p.event}. Reject snapshots taken afterwards or marked FAIL, then enable monitoring.`, `Walkthrough: quarantine ${p.source}; restore Snapshot ${p.safeSnapshot.toUpperCase()} (${p.normal}, PASS); re-enable and verify safety alerts.`]
  };
  const level = Math.min(s.hints[s.stage] + 1, 3);
  s.hints[s.stage] = level;
  s.hintMessages[s.stage] = { level, total: 3, message: hints[s.stage][level - 1] };
  s.revision++;
  return { ...result(s, true, hints[s.stage][level - 1]), level, total: 3 };
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
