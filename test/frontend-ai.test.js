const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { frontend } = require('./helpers/frontend');
const { createApp } = require('../backend/server');
const { createAiService } = require('../backend/services/aiService');
const game = require('../backend/services/gameEngine');
async function unlock(f) {
  await f.fire('#start');
  const s = f.state();
  f.document.querySelector('#answer').value = game.encrypt(s.cipher.message, 26 - s.cipher.failedCells);
  await f.fire('#decode', 'onsubmit');
}

test('pending controller response leaves polling and file investigation usable', async () => {
  let finish;
  const f = frontend({ app: createApp({ ai: { respond: () => new Promise(resolve => { finish = resolve; }) } }) });
  await unlock(f);
  const pending = vm.runInContext("askAi({ message: 'Status?' })", f.context);
  await f.settle();
  assert.equal(f.document.querySelector('#ai-send').disabled, true);
  await [...f.intervals.values()][0]();
  await f.command('cat incident.log');
  assert.ok(f.state().readFiles.includes('incident.log'));
  finish({ reply: 'Compare the timeline.', mode: 'scripted', fallbackReason: 'not_configured' });
  await pending;
  assert.equal(f.state().ai.history.length, 1);
  assert.ok(f.state().readFiles.includes('incident.log'));
});

test('late controller reply cannot replace the next team after timeout', async () => {
  let finish;
  const f = frontend({ app: createApp({ ai: { respond: () => new Promise(resolve => { finish = resolve; }) } }) });
  await unlock(f);
  const oldId = f.storage.get('blackout-session');
  const pending = vm.runInContext("askAi({ message: 'Status?' })", f.context);
  await f.settle();
  game.getSession(oldId).startedAt -= game.DURATION_MS;
  await [...f.intervals.values()][0]();
  await f.fire('#again');
  const newId = f.storage.get('blackout-session');
  finish({ reply: 'Old team reply', mode: 'gemini', fallbackReason: null });
  await pending;
  assert.notEqual(newId, oldId);
  assert.equal(f.state().stage, 1);
  assert.deepEqual(f.state().ai.history, []);
  assert.equal(f.document.querySelector('#monitoring-dashboard').hidden, true);
});

test('AI cooldown and exhausted allowance prevent duplicate requests', async () => {
  const f = frontend(); await unlock(f); let calls = 0;
  f.context.fetch = async () => { calls++; throw Error('Unexpected request'); };
  vm.runInContext('aiCooldownUntil = Date.now() + 3000;', f.context);
  await vm.runInContext("askAi({ message: 'Status?' })", f.context);
  vm.runInContext('aiCooldownUntil = 0; state.ai.remainingRequests = 0; syncAi();', f.context);
  await vm.runInContext("askAi({ message: 'Status?' })", f.context);
  assert.equal(calls, 0);
  assert.equal(f.document.querySelector('#ai-send').disabled, true);
});

test('countdown continues during a polling outage without declaring victory', async () => {
  const f = frontend(); await unlock(f);
  f.context.fetch = async () => { throw Error('Offline'); };
  vm.runInContext('localDeadline = Date.now() - 1000;', f.context);
  await [...f.intervals.values()][0]();
  assert.equal(f.document.querySelector('#timer').textContent, '00:00');
  assert.equal(f.state().finished, false);
  assert.match(f.document.querySelector('#connection-status').textContent, /Connection interrupted/);
});

test('Gemini generation settings and incident context survive merge reconciliation', async () => {
  for (const model of ['gemini-3.1-flash-lite', 'gemini-3.8-flash']) {
    let body;
    const ai = createAiService({ apiKey: 'test', model, timeoutMs: 100 }, async (_, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Inspect the timeline.' }] } }] }) };
    });
    await ai.respond('What changed?', [], 'last-change', { event: '04:39', job: 'Job-43' });
    assert.match(body.systemInstruction.parts[0].text, /04:39/);
    assert.match(body.systemInstruction.parts[0].text, /Job-43/);
    if (model.endsWith('flash-lite')) assert.deepEqual(body.generationConfig, { maxOutputTokens: 256 });
    else assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  }
});
