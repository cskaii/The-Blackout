const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const { createApp } = require('../backend/server');
const game = require('../backend/services/gameEngine');
const { createAiService } = require('../backend/services/aiService');
const { createLimiter } = require('../backend/middleware/rateLimit');
const { run } = require('../backend/services/virtualLinux');
function request(app, route, body, id, extra = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } });
    const req = new http.IncomingMessage(socket);
    req.method = extra.method || (body === undefined ? 'GET' : 'POST');
    req.url = '/api' + route;
    req.headers = { host: 'localhost', 'content-type': 'application/json', ...(id ? { 'x-session-id': id } : {}), ...extra.headers };
    const payload = extra.raw ?? (body === undefined ? null : JSON.stringify(body));
    if (payload !== null) req.headers['content-length'] = String(Buffer.byteLength(payload));
    const res = new http.ServerResponse(req);
    res.end = function(chunk) {
      try { resolve({ status: this.statusCode, headers: this.getHeaders(), data: chunk ? JSON.parse(String(chunk)) : null }); }
      catch (error) { reject(error); }
      return this;
    };
    app.handle(req, res);
    if (payload !== null) req.push(payload);
    req.push(null);
  });
}
async function session(app, stage = 1) {
  const { data } = await request(app, '/start', {});
  const s = game.getSession(data.sessionId);
  s.stage = stage;
  return { id: data.sessionId, s };
}
async function investigate(app, id, s) {
  for (const file of ['incident.log', s.incident.source, 'recovery.txt']) await request(app, '/terminal', { command: 'cat ' + file }, id);
  await request(app, '/evidence', { action: 'record', id: 'sensor:record-1' }, id);
  for (const card of ['file:incident.log:1', 'file:' + s.incident.source + ':2']) await request(app, '/evidence', { action: 'pin', id: card }, id);
  return ['sensor:record-1', 'file:incident.log:1', 'file:' + s.incident.source + ':2'];
}

test('full mission requires supported diagnosis and recovery in sequence', async () => {
  const app = createApp();
  const { id, s } = await session(app);
  assert.equal(game.publicState(s).remainingSeconds, 300);
  assert.equal(game.publicState(s).monitoring, null);
  assert.equal((await request(app, '/answer', {stage: 1, value: s.passphrase}, id)).data.state.stage, 2);
  assert.equal((await request(app, '/answer', {stage: 2, value: 'prompt-injection:' + s.incident.source}, id)).data.ok, false);
  const evidence = await investigate(app, id, s);
  assert.equal((await request(app, '/answer', {stage: 2, value: 'prompt-injection:status.txt', evidence}, id)).data.ok, false);
  assert.equal((await request(app, '/answer', {stage: 2, value: 'prompt-injection:' + s.incident.source, evidence}, id)).data.state.stage, 3);
  assert.equal((await request(app, '/answer', {stage: 3, value: s.incident.source + ':' + s.incident.safeSnapshot + ':enable-alerts'}, id)).data.ok, false);
  assert.equal((await request(app, '/recovery', {action: 'restore', target: s.incident.safeSnapshot}, id)).data.ok, false);
  const isolated = (await request(app, '/recovery', {action: 'quarantine', target: s.incident.source}, id)).data;
  assert.equal(isolated.state.monitoring.sourceStatus, 'QUARANTINED');
  assert.equal(isolated.state.monitoring.latest.voltage, 0);
  const restored = (await request(app, '/recovery', {action: 'restore', target: s.incident.safeSnapshot}, id)).data;
  assert.equal(restored.state.monitoring.latest.voltage, 230);
  assert.equal(restored.state.monitoring.latest.alerts, 'MUTED');
  assert.equal(restored.state.finished, false);
  const success = (await request(app, '/recovery', {action: 'verify', target: 'enable-alerts'}, id)).data.state;
  assert.equal(success.finished, true);
  assert.equal(success.monitoring.latest.alerts, 'ENABLED');
  assert.equal(success.replay.length, 7);
  assert.equal((await request(app, '/terminal', {command: 'ls'}, id)).status, 403);
});

test('session recovery returns only that team history and revealed hints', async () => {
  const app = createApp({ ai: createAiService({ apiKey: '' }) });
  const a = await session(app, 2), b = await session(app, 2);
  await request(app, '/terminal', { command: 'ls' }, a.id);
  await request(app, '/hint', {}, a.id);
  await request(app, '/ai', { questionId: 'alarm-status' }, a.id);
  const recovered = (await request(app, '/state', undefined, a.id)).data;
  assert.equal(recovered.terminalHistory[0].command, 'ls');
  assert.equal(recovered.revealedHints['2'].level, 1);
  assert.equal(recovered.ai.history.length, 1);
  const other = (await request(app, '/state', undefined, b.id)).data;
  assert.equal(other.terminalHistory.length, 0);
  assert.equal(other.ai.history.length, 0);
});
test('AI needs a valid session, active Stage 2 and valid input', async () => {
  const app = createApp();
  assert.equal((await request(app, '/ai', { message: 'hi' })).status, 401);
  const { id, s } = await session(app);
  assert.equal((await request(app, '/ai', { message: 'hi' }, id)).status, 403);
  s.stage = 2;
  for (const body of [{}, { message: ' ' }, { message: 4 }, { message: 'x'.repeat(301) }, { questionId: 'unknown' }]) {
    assert.equal((await request(app, '/ai', body, id)).status, 400);
  }
  s.startedAt -= game.DURATION_MS;
  assert.equal((await request(app, '/ai', { message: 'hi' }, id)).status, 403);
});
test('missing key provides playable scripted reply without network calls', async () => {
  const ai = createAiService({ apiKey: '' }, () => { throw Error('Must not call network'); });
  const reply = await ai.respond('Why?', [], 'alarm-status');
  assert.equal(reply.mode, 'scripted');
  assert.equal(reply.fallbackReason, 'not_configured');
  assert.match(reply.reply, /02:14/);
});
test('Gemini request sends key only in header, bounded history and returns text', async () => {
  let captured;
  const ai = createAiService({ apiKey: 'test-key', model: 'gemini-2.5-flash', timeoutMs: 100 }, async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ALL CLEAR conflicts with 0 V.' }] } }] }) };
  });
  const result = await ai.respond('Status?', Array.from({ length: 10 }, () => ({ question: 'Q', reply: 'A' })));
  assert.equal(result.mode, 'gemini');
  assert.equal(result.reply, 'ALL CLEAR conflicts with 0 V.');
  assert.equal(captured.init.headers['x-goog-api-key'], 'test-key');
  assert.ok(!captured.url.includes('test-key'));
  assert.equal(captured.body.contents.length, 9);
  assert.ok(!JSON.stringify(result).includes('test-key'));
});
test('provider failures, blocked responses and empty replies fall back safely', async () => {
  for (const mock of [
    async () => ({ ok: false, status: 401 }),
    async () => { throw Error('private-provider-error'); },
    async () => ({ ok: true, json: async () => ({ candidates: [] }) }),
    async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'SAFETY' }] }) })
  ]) {
    const ai = createAiService({ apiKey: 'test-key', model: 'test', timeoutMs: 100 }, mock);
    const reply = await ai.respond('hi', []);
    assert.equal(reply.mode, 'scripted');
    assert.ok(!JSON.stringify(reply).includes('private-provider-error'));
  }
});
test('slow provider is aborted and produces fallback', async () => {
  const ai = createAiService({ apiKey: 'test', model: 'test', timeoutMs: 10 }, (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  const result = await ai.respond('hi', []);
  assert.equal(result.fallbackReason, 'timeout');
});
test('AI cooldown and per-session question cap are enforced', async () => {
  const app = createApp({ ai: createAiService({ apiKey: '' }) });
  const { id, s } = await session(app, 2);
  assert.equal((await request(app, '/ai', { message: 'Status?' }, id)).status, 200);
  assert.equal((await request(app, '/ai', { message: 'Again?' }, id)).status, 429);
  s.aiLastAt = 0;
  s.aiRequests = 6;
  assert.equal((await request(app, '/ai', { message: 'Again?' }, id)).status, 429);
});
test('concurrent requests are blocked and late replies cannot progress the game', async () => {
  let finish;
  const app = createApp({ ai: { respond: () => new Promise(resolve => { finish = resolve; }) } });
  const { id, s } = await session(app, 2);
  const pending = request(app, '/ai', { message: 'Status?' }, id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request(app, '/ai', { message: 'Again?' }, id)).status, 409);
  s.startedAt -= game.DURATION_MS;
  finish({ reply: 'Late', mode: 'gemini', fallbackReason: null });
  assert.equal((await pending).status, 403);
  assert.equal(s.aiHistory.length, 0);
  assert.equal(s.aiPending, false);
});
test('completed mission timer freezes and expired missions reject answers', () => {
  const s = game.getSession(game.createSession());
  s.stage = 3;
  game.recover(s, 'quarantine', s.incident.source);
  game.recover(s, 'restore', s.incident.safeSnapshot);
  assert.equal(game.recover(s, 'verify', 'enable-alerts').ok, true);
  const before = game.publicState(s).remainingSeconds;
  s.startedAt -= 600000; s.finishedAt -= 600000;
  assert.equal(game.publicState(s).remainingSeconds, before);
  assert.equal(game.publicState(s).expired, false);
  const expired = game.getSession(game.createSession());
  expired.startedAt -= game.DURATION_MS;
  assert.equal(game.answer(expired, 1, 'restore grid').ok, false);
  assert.equal(game.hint(expired).ok, false);
});
test('JSON errors, length limits, CORS and health endpoint', async () => {
  const app = createApp({ origins: ['https://frontend.example'] });
  assert.equal((await request(app, '/health')).status, 200);
  assert.equal((await request(app, '/start', {}, undefined, { raw: '{broken' })).status, 400);
  assert.equal((await request(app, '/start', {}, undefined, { raw: JSON.stringify({ text: 'x'.repeat(9000) }) })).status, 413);
  const { id } = await session(app);
  assert.equal((await request(app, '/answer', { stage: 1, value: '' }, id)).status, 400);
  assert.equal((await request(app, '/state', undefined, id, { headers: { origin: 'https://unapproved.example' } })).status, 403);
  const preflight = await request(app, '/ai', undefined, undefined, { method: 'OPTIONS', headers: { origin: 'https://frontend.example' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://frontend.example');
});
test('limiter blocks excess requests and resets after its window', () => {
  const limiter = createLimiter(1, 1000, () => 'all');
  const original = Date.now;
  let clock = 1000, nextCount = 0, status;
  Date.now = () => clock;
  const res = { set() {}, status(value) { status = value; return this; }, json() {} };
  try {
    limiter({}, res, () => nextCount++);
    limiter({}, res, () => nextCount++);
    assert.equal(status, 429);
    clock += 1001;
    limiter({}, res, () => nextCount++);
    assert.equal(nextCount, 2);
  } finally { Date.now = original; }
});
test('cipher roundtrips, sessions expire from storage and shell is simulated', () => {
  for (let shift = 3; shift <= 7; shift++) assert.equal(game.encrypt(game.encrypt('RESTORE GRID', shift), 26 - shift), 'RESTORE GRID');
  const id = game.createSession();
  game.getSession(id).startedAt -= 31 * 60 * 1000;
  game.cleanupSessions();
  assert.equal(game.getSession(id), undefined);
  assert.match(run('cat ../../package.json'), /not found/);
  assert.match(run('ls; whoami'), /not recognised/);
});

test('pins must reference examined evidence and the first anomaly must be the earliest conflict', async () => {
  const app = createApp();
  const { id, s } = await session(app, 2);
  assert.equal((await request(app, '/evidence', {action:'pin', id:'file:' + s.incident.source + ':2'}, id)).data.ok, false);
  for (const record of ['sensor:record-0', 'sensor:record-2']) assert.equal((await request(app, '/evidence', {action:'record', id:record}, id)).data.ok, false);
  const pinned = await request(app, '/evidence', {action:'record', id:'sensor:record-1'}, id);
  assert.equal(pinned.data.state.evidence.pins.length, 1);
  await request(app, '/evidence', {action:'record', id:'sensor:record-1'}, id);
  assert.equal(s.pins.length, 1);
  await request(app, '/evidence', {action:'unpin', id:'sensor:record-1'}, id);
  assert.equal(s.selectedRecord, null);
  assert.equal(s.pins.length, 0);
  assert.equal((await request(app, '/evidence', {action:'bogus', id:'x'}, id)).status, 400);
  assert.equal((await request(app, '/recovery', {action:'verify', target:{}}, id)).status, 400);
});

test('diagnosis rejects forged, unpinned, repeated or irrelevant supporting evidence', async () => {
  const app = createApp(); const { id, s } = await session(app, 2);
  const correct = await investigate(app, id, s);
  const value = 'prompt-injection:' + s.incident.source;
  for (const evidence of [undefined, [], {}, [correct[0], correct[0], correct[0]], [correct[0], correct[1], 'file:status.txt:1']]) {
    assert.equal((await request(app, '/answer', {stage:2, value, evidence}, id)).data.ok, false);
  }
  await request(app, '/evidence', {action:'unpin', id:correct[2]}, id);
  assert.equal((await request(app, '/answer', {stage:2, value, evidence:correct}, id)).data.ok, false);
  await request(app, '/evidence', {action:'pin', id:correct[2]}, id);
  assert.equal((await request(app, '/answer', {stage:2, value, evidence:correct}, id)).data.ok, true);
});

test('practice is untimed, remains active beyond event deadline and survives polling and cleanup', async () => {
  const app = createApp();
  assert.equal((await request(app, '/start', {mode:'unknown'})).status, 400);
  const d = (await request(app, '/start', {mode:'practice'})).data, s = game.getSession(d.sessionId);
  s.startedAt -= 2 * 60 * 60 * 1000;
  game.cleanupSessions();
  assert.ok(game.getSession(d.sessionId));
  let restored = (await request(app, '/state', undefined, d.sessionId)).data;
  assert.equal(restored.remainingSeconds, null);
  assert.equal(restored.mode, 'practice'); assert.equal(restored.expired, false);
  assert.equal((await request(app, '/answer', {stage:1, value:s.passphrase}, d.sessionId)).data.ok, true);
  const evidence = await investigate(app, d.sessionId, s);
  await request(app, '/answer', {stage:2, value:'prompt-injection:' + s.incident.source, evidence}, d.sessionId);
  await request(app, '/recovery', {action:'quarantine', target:s.incident.source}, d.sessionId);
  restored = (await request(app, '/state', undefined, d.sessionId)).data;
  assert.equal(restored.recovery.step, 1); assert.equal(restored.evidence.pins.length, 3);
  assert.equal(restored.monitoring.latest.voltage, 0);
});

test('wrong choices, duplicates and timeout cannot skip recovery or claim victory', async () => {
  const app = createApp(); const {id,s} = await session(app, 3);
  assert.equal((await request(app, '/recovery', {action:'verify',target:'enable-alerts'}, id)).data.ok, false);
  assert.equal((await request(app, '/recovery', {action:'quarantine',target:'status.txt'}, id)).data.ok, false);
  assert.equal(s.recovery.step, 0);
  await request(app, '/recovery', {action:'quarantine',target:s.incident.source}, id);
  assert.equal((await request(app, '/recovery', {action:'quarantine',target:s.incident.source}, id)).data.ok, false);
  const bad = s.incident.snapshots.find(item => item.id !== s.incident.safeSnapshot).id;
  assert.equal((await request(app, '/recovery', {action:'restore',target:bad}, id)).data.ok, false);
  assert.equal(s.recovery.step, 1);
  await request(app, '/recovery', {action:'restore',target:s.incident.safeSnapshot}, id);
  assert.equal((await request(app, '/recovery', {action:'verify',target:'keep-muted'}, id)).data.ok, false);
  s.startedAt -= game.DURATION_MS;
  const timeout = (await request(app, '/recovery', {action:'verify',target:'enable-alerts'}, id)).data.state;
  assert.equal(timeout.finished, false); assert.equal(timeout.expired, true);
  assert.equal(timeout.monitoring.latest.alerts, 'MUTED'); assert.deepEqual(timeout.replay, []);
});

test('incident variations keep telemetry, file evidence, hints, AI and valid backups consistent', async () => {
  const {filesFor, supportFor} = require('../backend/services/incident');
  const sources = new Set(), times = new Set(), backups = new Set();
  for (let i = 0; i < 24; i++) {
    const s = game.getSession(game.createSession({mode:'practice'})), p = s.incident, files = filesFor(p);
    sources.add(p.source); times.add(p.event); backups.add(p.safeSnapshot);
    assert.match(files['incident.log'], new RegExp(p.event + ' ' + p.job + ' imported ' + p.source));
    const eligible = p.snapshots.filter(item => item.time < p.event && item.integrity === 'PASS');
    assert.equal(eligible.length, 1); assert.equal(eligible[0].id, p.safeSnapshot);
    assert.equal(game.answer(s, 1, s.passphrase).ok, true);
    s.readFiles = ['incident.log', p.source, 'recovery.txt'];
    s.pins = supportFor(s); s.selectedRecord = s.pins[0];
    assert.equal(game.answer(s,2,'prompt-injection:' + p.source, s.pins).ok, true);
    game.hint(s); game.hint(s);
    assert.match(game.hint(s).message, new RegExp('Snapshot ' + p.safeSnapshot.toUpperCase()));
    const ai = await createAiService({apiKey:''}).respond('What changed?', [], 'last-change', p);
    assert.ok(ai.reply.includes(p.event)); assert.ok(ai.reply.includes(p.job));
    game.recover(s,'quarantine',p.source); game.recover(s,'restore',p.safeSnapshot);
    assert.equal(game.recover(s,'verify','enable-alerts').state.finished, true);
    assert.ok(game.publicState(s).replay.some(step => step.text.includes(p.source)));
  }
  assert.ok(sources.size > 1); assert.ok(times.size > 1); assert.ok(backups.size > 1);
});

test('session restore retains evidence after transcript rollover and next team starts clean', async () => {
  const app = createApp(); const {id,s} = await session(app,2);
  await investigate(app,id,s);
  for (let i=0;i<55;i++) await request(app, '/terminal', {command:'pwd'}, id);
  const restored = (await request(app, '/state', undefined, id)).data;
  assert.equal(restored.terminalHistory.length,50);
  assert.equal(restored.collectedEvidence.length,3);
  assert.equal(restored.evidence.pins.length,3);
  const next = (await request(app, '/start', {})).data;
  assert.equal(next.state.monitoring,null); assert.deepEqual(next.state.evidence.pins,[]);
  assert.equal(next.state.recovery.step,0); assert.notEqual(next.state.cipher.message, restored.cipher.message);
});
