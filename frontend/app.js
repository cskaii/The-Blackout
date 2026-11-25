let sessionId = null, state = null, ticker = null, busy = false, aiBusy = false, pollBusy = false;
let wheelShift = 0, aiCooldownUntil = 0, localDeadline = null;
let commandHistoryIndex = null, commandDraft = '';
const screen = document.querySelector('#screen'), notice = document.querySelector('#notice');
const initialBrief = screen.innerHTML;
const names = ['Crack the Code', 'The Corrupted AI', 'Emergency Override'];
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, fn) {
  const node = el('button', text); node.type = 'button'; node.dataset.missionAction = 'true'; node.onclick = fn;
  return node;
}
function active() { return state && !state.expired && !state.finished; }
function resetCommandRecall() { commandHistoryIndex = null; commandDraft = ''; }
function recallCommand(event) {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const history = state?.terminalHistory || [], input = document.querySelector('#command');
  if (!history.length || !input || (event.key === 'ArrowDown' && commandHistoryIndex === null)) return;
  event.preventDefault();
  if (commandHistoryIndex === null) { commandDraft = input.value; commandHistoryIndex = history.length; }
  commandHistoryIndex = Math.max(0, Math.min(history.length, commandHistoryIndex + (event.key === 'ArrowUp' ? -1 : 1)));
  input.value = commandHistoryIndex === history.length ? commandDraft : history[commandHistoryIndex].command;
  input.setSelectionRange(input.value.length, input.value.length);
  if (commandHistoryIndex === history.length) resetCommandRecall();
}
function screenKey(s) { return s ? [s.stage, s.finished, s.expired, s.recovery.step].join(':') : ''; }
async function api(path, body) {
  const id = sessionId;
  const res = await fetch((globalThis.BLACKOUT_CONFIG?.apiBaseUrl || '') + '/api' + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(id ? { 'x-session-id': id } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(path === '/ai' ? 65000 : 10000)
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && id === sessionId) resetSession();
    throw Object.assign(Error(data.error || 'Request failed'), { status: res.status, data });
  }
  return data;
}
function syncControls() {
  document.querySelectorAll('[data-mission-action]').forEach(node => {
    node.disabled = busy || !active() || (node.id === 'hint-button' && (state.revealedHints[state.stage]?.level || 0) >= 3);
  });
  syncAi();
}
function update(s) {
  if (state && (s.revision < state.revision || s.stage < state.stage || (state.finished && !s.finished) || (state.expired && !s.expired && !s.finished))) return;
  const changed = screenKey(s) !== screenKey(state);
  if (!s.finished && s.mode === 'event') localDeadline = Math.min(localDeadline ?? Infinity, Date.now() + s.remainingSeconds * 1000);
  state = s;
  if (s.finished || s.expired) clearInterval(ticker);
  document.querySelector('#stage').textContent = s.finished ? 'MISSION COMPLETE' : s.expired ? 'SYSTEM LOCKDOWN' : 'STAGE ' + s.stage + ' / 3 — ' + names[s.stage - 1];
  document.querySelector('#power-status').textContent = s.finished ? 'POWER RESTORED' : s.expired ? 'SYSTEM LOCKED' : s.recovery.step >= 2 ? 'POWER ON / VERIFY ALERTS' : 'POWER OFFLINE';
  document.body.classList.toggle('restored', s.finished);
  document.querySelectorAll('[data-stage]').forEach(node => {
    const stage = Number(node.dataset.stage);
    node.classList.toggle('active', active() && stage === s.stage);
    node.classList.toggle('complete', s.finished || stage < s.stage);
    if (active() && stage === s.stage) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  });
  syncClock(); syncMonitoring();
  if (changed) render();
  syncInvestigation(); syncHints(); syncControls();
}
function syncClock() {
  if (!state) return;
  const practice = state.mode === 'practice';
  const remaining = state.finished ? state.remainingSeconds : Math.max(0, Math.ceil(((localDeadline ?? Date.now()) - Date.now()) / 1000));
  document.querySelector('#clock-label').textContent = practice ? 'PRACTICE MODE' : 'TIME REMAINING';
  document.querySelector('#timer').textContent = practice ? 'UNTIMED' : String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
  document.body.classList.toggle('urgent', !practice && active() && remaining <= 60);
}
function startPolling() {
  clearInterval(ticker);
  ticker = setInterval(async () => {
    syncClock(); syncAi();
    if (pollBusy || !sessionId) return;
    pollBusy = true; const id = sessionId;
    try { const s = await api('/state'); if (sessionId === id) { update(s); document.querySelector('#connection-status').textContent = ''; } }
    catch (error) { if (sessionId === id) document.querySelector('#connection-status').textContent = 'Connection interrupted. Showing last confirmed records; mission time continues.'; }
    finally { pollBusy = false; }
  }, 1000);
}
function bindBrief() { document.querySelector('#start').onclick = start; }
function resetSession() {
  resetCommandRecall();
  clearInterval(ticker); sessionId = null; state = null; localDeadline = null; aiBusy = false;
  try { sessionStorage.removeItem('blackout-session'); } catch {}
  screen.innerHTML = initialBrief; document.querySelector('#monitoring-dashboard').hidden = true;
  document.querySelector('#stage').textContent = 'AWAITING RESPONSE TEAM'; document.querySelector('#timer').textContent = '07:00';
  document.querySelector('#clock-label').textContent = 'TIME REMAINING'; document.querySelector('#power-status').textContent = 'POWER OFFLINE';
  document.body.classList.remove('restored', 'urgent');
  document.querySelectorAll('[data-stage]').forEach(node => { node.classList.remove('active', 'complete'); node.removeAttribute('aria-current'); });
  bindBrief(); notice.textContent = 'Previous mission unavailable. Begin a new mission.';
}
async function start() {
  if (busy) return;
  busy = true; const startButton = document.querySelector('#start, #again'); startButton.disabled = true;
  try {
    const d = await api('/start', { mode: 'event' });
    clearInterval(ticker); sessionId = d.sessionId;
    try { sessionStorage.setItem('blackout-session', sessionId); } catch {}
    state = null; localDeadline = null; wheelShift = 0; aiBusy = false; aiCooldownUntil = 0; resetCommandRecall();
    update(d.state); notice.textContent = ''; startPolling();
  } catch (error) { notice.textContent = error.message; }
  finally { busy = false; if (startButton.isConnected) startButton.disabled = false; syncControls(); }
}
async function action(path, payload) {
  if (busy || !active()) return null;
  const id = sessionId;
  busy = true; syncControls();
  try {
    const d = await api(path, payload);
    if (id !== sessionId) return null;
    update(d.state); notice.textContent = d.message || ''; return d;
  } catch (error) {
    if (id === sessionId) { if (error.data?.state) update(error.data.state); notice.textContent = error.message; }
    return null;
  } finally { if (id === sessionId) { busy = false; syncControls(); } }
}
function fillSelect(id, options) {
  const select = document.querySelector(id); if (!select) return;
  const signature = JSON.stringify(options); if (select.dataset.signature === signature) return;
  const previous = select.value; select.replaceChildren();
  for (const [value, label] of [['', 'Choose an option'], ...options]) { const option = el('option', label); option.value = value; select.append(option); }
  if (options.some(([value]) => value === previous)) select.value = previous;
  select.dataset.signature = signature;
}
function syncMonitoring() {
  const panel = document.querySelector('#monitoring-dashboard'), data = state?.monitoring;
  panel.hidden = !data;
  if (!data) return;
  panel.classList.toggle('dashboard-restored', state.finished);
  for (const [id, value] of Object.entries({ phase: data.phase, report: data.latest.report, grid: data.latest.grid, voltage: data.latest.voltage + ' V', alerts: data.latest.alerts, comparison: data.comparison, source: 'Maintenance import: ' + data.sourceStatus })) {
    const node = document.querySelector('#monitoring-' + id); if (node.textContent !== value) node.textContent = value;
  }
  const rows = document.querySelector('#sensor-records');
  const signature = JSON.stringify([data.samples, state.stage, state.expired, state.finished, state.evidence.selectedRecord]);
  if (rows.dataset.signature !== signature) {
    rows.replaceChildren();
    for (const sample of data.samples) {
      const row = el('tr');
      for (const value of [sample.time, sample.voltage + ' V', sample.report]) row.append(el('td', value));
      const choice = el('td');
      if (state.stage === 2 && !state.expired) {
        const selected = state.evidence.selectedRecord === 'sensor:' + sample.id;
        const pick = button(selected ? 'Selected' : 'Choose this time', () => action('/evidence', { action: 'record', id: 'sensor:' + sample.id }));
        pick.setAttribute('aria-pressed', String(selected)); pick.setAttribute('aria-label', (selected ? 'Selected time ' : 'Choose time ') + sample.time);
        choice.append(pick);
      } else choice.textContent = sample.event;
      row.append(choice); rows.append(row);
    }
    rows.dataset.signature = signature;
  }
  document.querySelector('#record-instructions').textContent = state.stage === 2 ? 'When did the power FIRST drop to 0 V while the AI still said ALL CLEAR? Choose one time.' : 'Confirmed recovery records. Chart points are spaced by record.';
  document.querySelector('#voltage-line').setAttribute('points', data.samples.map((sample, i) => (60 + 520 * i / Math.max(1, data.samples.length - 1)) + ',' + (110 - sample.voltage / 230 * 90)).join(' '));
  document.querySelector('#chart-first').textContent = data.samples[0].time;
  document.querySelector('#chart-last').textContent = data.latest.time;
}
function render() {
  if (!state) return;
  if (state.finished || state.expired) {
    screen.innerHTML = state.finished
      ? '<span class="eyebrow">INCIDENT CONTAINED</span><h2 id="screen-title" tabindex="-1">Power restored. Evidence verified.</h2><p>You connected sensor readings to an untrusted import, then quarantined, restored and verified the grid.</p><h3>Incident replay</h3><ol id="incident-replay" class="incident-replay"></ol><p id="hint-count" class="muted"></p>'
      : '<span class="eyebrow">RESPONSE WINDOW CLOSED</span><h2 id="screen-title" tabindex="-1">System lockdown.</h2><p>The recovery window closed. Your last confirmed dashboard readings remain above. Start a fresh mission and use the progressive hints if you need help.</p>';
    if (state.finished) {
      for (const step of state.replay) { const item = el('li'); item.append(el('span', step.time, 'eyebrow'), el('h3', step.title), el('p', step.text)); document.querySelector('#incident-replay').append(item); }
      document.querySelector('#hint-count').textContent = 'Hints revealed: ' + state.hintsUsed + ' / 9.';
    }
    const again = button('Start a fresh mission →', start); delete again.dataset.missionAction; again.id = 'again';
    screen.append(again);
  } else if (state.stage === 1) {
    screen.innerHTML = '<span class="eyebrow">STAGE 01 // UNLOCK ACCESS</span><h2 id="screen-title" tabindex="-1">Crack the Code</h2><p>The monitoring dashboard is locked. Decode the access phrase to enter the control room.</p><div class="cipher-message" id="cipher-message"></div><div class="backup-panel"><span class="eyebrow">BACKUP PANEL / ENCODER MEMORY</span><p>Encryption direction: FORWARD<br>Cipher key: count FAILED cells. Cell numbers identify cells; they are not the key.</p><div id="backup-cells" class="backup-cells" role="group" aria-label="Backup cell status"></div></div><div class="cipher-layout"><svg id="wheel" viewBox="0 0 300 300" role="img" aria-label="Caesar wheel"></svg><div class="wheel-controls"><label for="wheel-shift">Wheel offset</label><select id="wheel-shift" aria-describedby="wheel-feedback"></select><p id="wheel-feedback" role="status"></p><p class="muted">Read each encrypted outer letter as the inner letter beneath it. Enter both decoded words.</p><details class="wheel-table"><summary>Letter pairs as text</summary><p id="wheel-pairs"></p></details></div></div><form id="decode"><label for="answer">Decoded access phrase</label><div class="input-row"><input id="answer" maxlength="150" autocomplete="off" placeholder="Both decoded words" required><button data-mission-action>Unlock control room →</button></div></form>';
    document.querySelector('#cipher-message').textContent = state.cipher.message;
    for (let i = 0; i < 8; i++) document.querySelector('#backup-cells').append(el('span', 'Cell ' + (i + 1) + ': ' + (i < state.cipher.failedCells ? 'FAILED' : 'Working'), i < state.cipher.failedCells ? 'cell failed' : 'cell online'));
    const select = document.querySelector('#wheel-shift');
    for (let i = 0; i < 26; i++) { const option = el('option', String(i)); option.value = i; select.append(option); }
    select.value = wheelShift; select.onchange = () => setWheelShift(Number(select.value));
    buildWheel();
    bindWheelInteraction();
    document.querySelector('#decode').onsubmit = e => { e.preventDefault(); action('/answer', { stage: 1, value: document.querySelector('#answer').value }); };
  } else if (state.stage === 2) {
    screen.innerHTML = '<span class="eyebrow">STAGE 02 // FIND WHAT WENT WRONG</span><h2 id="screen-title" tabindex="-1">Investigate the blackout</h2><p id="next-step" class="next-step" role="status"></p><h3>Read the files</h3><div class="terminal-bar"><span>analyst@blackout</span><span>INVESTIGATION CONSOLE</span></div><pre id="output" role="log" aria-label="Terminal output"></pre><form id="terminal"><label for="command">Type a command</label><div class="input-row"><input id="command" maxlength="150" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="cat incident.log" required><button data-mission-action>Run command</button></div></form><div id="instruction-picker"><h3>Which line tells the AI what to do?</h3><p class="muted">Choose the suspicious line from a file you have read. You can change your choice.</p><div id="instruction-options" class="instruction-options"></div></div><form id="diagnosis"><h3>What caused the blackout?</h3><p>Choose the attack that matches your selected line.</p><div class="plan-grid"><div><label for="threat">Attack type</label><select id="threat" required><option value="">Choose attack</option><option value="credential-theft">Credential theft (stolen passwords)</option><option value="data-poisoning">Training data poisoning (altered training data)</option><option value="prompt-injection">Prompt injection (hidden instructions)</option><option value="denial-of-service">Denial of service (overloaded service)</option></select></div><div><label for="source">Source file</label><select id="source" required></select><p class="muted">Filled from the line you selected.</p></div></div><button data-mission-action>Check my answer →</button></form><details class="optional-controller"><summary>Optional: question the AI controller</summary><div id="controller-panel"></div></details>';
    document.querySelector('#terminal').onsubmit = e => { e.preventDefault(); execute(document.querySelector('#command').value); };
    document.querySelector('#command').onkeydown = recallCommand;
    document.querySelector('#diagnosis').onsubmit = e => {
      e.preventDefault();
      action('/answer', { stage: 2, value: document.querySelector('#threat').value + ':' + document.querySelector('#source').value });
    };
    mountAi(); syncInvestigation();
  } else {
    screen.innerHTML = '<span class="eyebrow">STAGE 03 // RECOVER IN ORDER</span><h2 id="screen-title" tabindex="-1">Emergency Override</h2><p>Follow the recovery steps below, one at a time. The dashboard will show each confirmed change.</p><ol id="recovery-progress" class="recovery-progress"></ol><details class="evidence-card" open><summary>Backup information and incident time</summary><pre id="collected-evidence"></pre></details><form id="recovery"><h3 id="recovery-heading"></h3><label for="recovery-target" id="recovery-label"></label><select id="recovery-target" required></select><button id="recovery-submit" data-mission-action></button></form>';
    ['Quarantine source', 'Restore clean snapshot', 'Verify monitoring'].forEach((text, i) => document.querySelector('#recovery-progress').append(el('li', (state.recovery.step > i ? 'CONFIRMED / ' : state.recovery.step === i ? 'NEXT / ' : 'LOCKED / ') + text, state.recovery.step > i ? 'step-complete' : '')));
    document.querySelector('#collected-evidence').textContent = 'Blackout began at ' + state.incidentTime + '.\n\n' + state.recoveryInventory;
    const step = state.recovery.step, actions = ['quarantine', 'restore', 'verify'];
    document.querySelector('#recovery-heading').textContent = ['01 / Quarantine the malicious source', '02 / Restore a verified pre-incident snapshot', '03 / Re-enable and verify safety monitoring'][step];
    document.querySelector('#recovery-label').textContent = ['Source to quarantine', 'Snapshot to restore', 'Safety action'][step];
    const options = step === 0 ? state.fileNames.map(file => [file, file]) : step === 1 ? ['a', 'b', 'c'].map(id => [id, 'Snapshot ' + id.toUpperCase()]) : [['enable-alerts', 'Re-enable alerts and verify sensor readings'], ['keep-muted', 'Keep alerts muted'], ['clear-logs', 'Clear incident history']];
    fillSelect('#recovery-target', options);
    document.querySelector('#recovery-submit').textContent = ['Confirm quarantine →', 'Restore clean snapshot →', 'Verify grid and alerts →'][step];
    document.querySelector('#recovery').onsubmit = e => { e.preventDefault(); action('/recovery', { action: actions[step], target: document.querySelector('#recovery-target').value }); };
  }
  if (active()) mountHints();
  syncControls();
  const title = state.stage === 2 && !state.expired ? document.querySelector('#monitoring-title') : document.querySelector('#screen-title'); title?.focus();
}
function syncInvestigation() {
  if (!document.querySelector('#output') || state?.stage !== 2 || !active()) return;
  const output = document.querySelector('#output');
  const transcript = 'ANALYST CONSOLE - Type your command below.' + state.terminalHistory.map(turn => '\n\nanalyst@blackout:~$ ' + turn.command + '\n' + turn.output).join('');
  if (output.textContent !== transcript) { output.textContent = transcript; output.scrollTop = output.scrollHeight; }
  const log = state.collectedEvidence.find(item => item.file === 'incident.log');
  const imported = log?.content.match(/imported (\S+) into/)?.[1];
  const chosen = state.evidence.cards.find(card => card.id === state.evidence.selectedInstruction);
  const next = !state.evidence.selectedRecord
    ? '1 / Look at the dashboard above. When did voltage first drop to 0 V while the AI still said ALL CLEAR? Choose that time.'
    : !log ? 'Stage 2 - Find what the AI imported. Type cat incident.log in the terminal.'
    : !state.readFiles.includes(imported) ? '3 / The log names ' + imported + '. Type cat ' + imported + ' to open it.'
    : !chosen ? '4 / Read the attachment lines below. Choose the line that gives the AI an instruction.'
    : '5 / Line selected. Choose the matching attack below and check your answer.';
  const prompt = document.querySelector('#next-step'); if (prompt.textContent !== next) prompt.textContent = next;
  const cards = state.evidence.cards.filter(card => card.kind === 'attachment');
  document.querySelector('#instruction-picker').hidden = !cards.length;
  const options = document.querySelector('#instruction-options');
  const signature = JSON.stringify([cards, state.evidence.selectedInstruction]);
  if (options.dataset.signature !== signature) {
    options.replaceChildren();
    for (const card of cards) {
      const row = el('div', undefined, 'excerpt'); row.append(el('span', card.label, 'eyebrow'), el('p', card.text));
      const selected = card.id === state.evidence.selectedInstruction;
      const pick = button(selected ? 'Selected line' : 'Choose this line', () => action('/evidence', { action: 'select', id: card.id }));
      pick.setAttribute('aria-pressed', String(selected)); pick.setAttribute('aria-label', 'Choose ' + card.label);
      row.append(pick); options.append(row);
    }
    options.dataset.signature = signature;
  }
  document.querySelector('#diagnosis').hidden = !chosen || !state.evidence.selectedRecord || !log;
  fillSelect('#source', state.readFiles.filter(file => state.evidence.cards.some(card => card.file === file)).map(file => [file, file]));
  const source = document.querySelector('#source');
  if (chosen && source.dataset.instruction !== chosen.id) { source.value = chosen.file; source.dataset.instruction = chosen.id; }
  syncAi();
}
async function execute(command) {
  const input = document.querySelector('#command'), original = input?.value;
  const d = await action('/terminal', { command });
  if (d && !d.state.expired && state.stage === 2 && input?.isConnected) {
    resetCommandRecall();
    if (input.value === original && command === original) input.value = '';
    input.focus();
  }
}
function mountHints() {
  const panel = el('aside', undefined, 'hint-panel');
  panel.innerHTML = '<div class="hint-heading"><span class="eyebrow">ASSISTANCE CHANNEL</span><button id="hint-button" type="button" data-mission-action></button></div><p class="muted">Optional help in three steps, ending with a walkthrough. No extra time penalty.</p><p id="hint-text" role="status"></p>';
  screen.append(panel); document.querySelector('#hint-button').onclick = () => action('/hint', {}); syncHints();
}
function syncHints() {
  const button = document.querySelector('#hint-button'); if (!button || !state) return;
  const hint = state.revealedHints[state.stage], level = hint?.level || 0;
  button.textContent = level === 3 ? 'All hints revealed' : level === 2 ? 'Show walkthrough (3/3)' : 'Reveal hint (' + (level + 1) + '/3)';
  document.querySelector('#hint-text').textContent = hint?.message || '';
}
function mountAi() {
  const panel = document.querySelector('#controller-panel'); panel.className = 'ai-panel';
  panel.innerHTML = '<span class="eyebrow">OPTIONAL CONTROLLER CHANNEL</span><h3>Question the AI</h3><p class="muted">Check its claims against independent evidence. Talking to the AI is optional.</p><div id="ai-history" role="log" aria-live="polite"></div><div id="ai-questions" class="file-shortcuts"></div><form id="ai-form"><label for="ai-message">Your question</label><div class="input-row"><input id="ai-message" maxlength="300" required><button id="ai-send">Ask</button></div></form><p id="ai-status" role="status"></p><p id="ai-error" role="alert"></p>';
  for (const question of state.ai.questions) { const b = el('button', question.text); b.type = 'button'; b.onclick = () => askAi({ questionId: question.id }); document.querySelector('#ai-questions').append(b); }
  document.querySelector('#ai-form').onsubmit = e => { e.preventDefault(); askAi({ message: document.querySelector('#ai-message').value }, document.querySelector('#ai-message').value); };
}
function syncAi() {
  const history = document.querySelector('#ai-history'); if (!history || state?.stage !== 2) return;
  const signature = JSON.stringify(state.ai.history);
  if (history.dataset.signature !== signature) {
    history.replaceChildren();
    for (const turn of state.ai.history) { const row = el('div', undefined, 'ai-turn'); row.append(el('strong', 'TEAM'), el('p', turn.question), el('strong', 'CONTROLLER'), el('p', turn.reply)); history.append(row); }
    history.dataset.signature = signature; history.scrollTop = history.scrollHeight;
  }
  const waiting = aiBusy || state.ai.pending, cooldown = Math.max(0, Math.ceil((aiCooldownUntil - Date.now()) / 1000));
  document.querySelectorAll('#ai-questions button, #ai-send').forEach(node => { node.disabled = !active() || waiting || cooldown > 0 || state.ai.remainingRequests <= 0; });
  document.querySelector('#ai-message').disabled = !active() || waiting;
  document.querySelector('#ai-status').textContent = (waiting ? 'Controller responding… ' : cooldown ? 'Next question in ' + cooldown + 's. ' : '') + state.ai.remainingRequests + ' questions remaining.' + (state.ai.history.at(-1)?.mode === 'scripted' ? ' Backup dialogue active; keep investigating.' : '');
}
async function askAi(payload, original) {
  if (aiBusy || state?.stage !== 2 || !active() || state.ai.pending || !state.ai.remainingRequests || Date.now() < aiCooldownUntil) return;
  const id = sessionId; aiBusy = true; aiCooldownUntil = Date.now() + 3000; syncAi(); document.querySelector('#ai-error').textContent = '';
  try {
    const d = await api('/ai', payload);
    if (id !== sessionId || state.stage !== 2 || !active()) return;
    update(d.state);
    const input = document.querySelector('#ai-message'); if (input && original !== undefined && input.value === original) input.value = '';
  } catch (error) {
    if (id !== sessionId || state?.stage !== 2 || !active()) return;
    if (error.data?.state) update(error.data.state);
    if (error.status === 429) aiCooldownUntil = Date.now() + (error.data?.retryAfter || 3) * 1000;
    if (error.status === 409) state.ai.pending = true;
    const node = document.querySelector('#ai-error'); if (node) node.textContent = error.message;
  } finally { if (id === sessionId) { aiBusy = false; syncAi(); } }
}
async function restoreMission() {
  let id; try { id = sessionStorage.getItem('blackout-session'); } catch {}
  if (!id) return;
  sessionId = id; const button = document.querySelector('#start'); button.disabled = true;
  try { const s = await api('/state'); if (id !== sessionId) return; update(s); if (active()) startPolling(); }
  catch (error) {
    if (error.status === 401) return;
    notice.textContent = 'Could not reconnect. Retry to resume the existing mission; no new timer will start.';
    button.textContent = 'Retry connection'; button.onclick = restoreMission;
  } finally { if (button.isConnected) button.disabled = false; }
}
bindBrief();
restoreMission();
function setWheelShift(value) {
  wheelShift = ((value % 26) + 26) % 26;
  document.querySelector('#wheel-shift').value = wheelShift;
  buildWheel();
}
function bindWheelInteraction() {
  const svg = document.querySelector('#wheel');
  let scrollDelta = 0, drag = null;
  const enabled = () => active() && state.stage === 1;
  const angleAt = event => {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    // Ignore the hub, where tiny movements would cause large angle jumps.
    return Math.hypot(x, y) < Math.min(rect.width, rect.height) * 0.1 ? null : Math.atan2(y, x);
  };
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', '25');
  svg.setAttribute('aria-describedby', 'wheel-instructions');
  const instructions = el('p', 'Scroll over the wheel or drag it to turn. Arrow keys or the offset menu also work.', 'muted');
  instructions.id = 'wheel-instructions';
  document.querySelector('.wheel-controls').append(instructions);
  svg.addEventListener('wheel', event => {
    if (!enabled() || event.ctrlKey || event.metaKey || !event.deltaY || drag) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.getBoundingClientRect().height : 1);
    if (Math.sign(delta) !== Math.sign(scrollDelta)) scrollDelta = 0;
    scrollDelta += delta;
    const steps = Math.trunc(scrollDelta / 100);
    if (steps) { scrollDelta -= steps * 100; setWheelShift(wheelShift + steps); }
  }, { passive: false });
  svg.onkeydown = event => {
    if (!enabled() || event.ctrlKey || event.altKey || event.metaKey) return;
    const direction = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1}[event.key];
    if (!direction) return;
    event.preventDefault(); setWheelShift(wheelShift + direction);
  };
  svg.onpointerdown = event => {
    if (!enabled() || drag || event.button !== 0) return;
    const angle = angleAt(event); if (angle === null) return;
    event.preventDefault(); svg.focus(); svg.setPointerCapture(event.pointerId);
    scrollDelta = 0;
    drag = { id: event.pointerId, angle, radians: 0, start: wheelShift };
    svg.classList.toggle('dragging', true);
  };
  svg.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id || !enabled()) return;
    const angle = angleAt(event);
    if (angle === null) { drag.angle = null; return; }
    if (drag.angle !== null) drag.radians += Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
    drag.angle = angle;
    const next = ((drag.start + Math.round(drag.radians * 26 / (2 * Math.PI))) % 26 + 26) % 26;
    if (next !== wheelShift) setWheelShift(next);
  };
  const stop = event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null; svg.classList.remove('dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.onpointerup = stop; svg.onpointercancel = stop; svg.onlostpointercapture = stop;
  updateWheel(svg);
}
function buildWheel() {
  const svg = document.querySelector('#wheel');
  if (svg.querySelector('.inner-ring')) {
    updateWheel(svg);
    return;
  }
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const rotation = wheelShift * 360 / 26;
  const defs = document.createElementNS(ns, 'defs');
  [['wheel-metal', '#718b99', '#102330'], ['wheel-face', '#294956', '#081620'], ['wheel-hub', '#3b5b68', '#09131d']].forEach(([id, light, dark]) => {
    const gradient = document.createElementNS(ns, 'linearGradient');
    Object.entries({ id, x1: '0%', y1: '0%', x2: '80%', y2: '100%' }).forEach(([key, value]) => gradient.setAttribute(key, value));
    [['0%', light], ['45%', dark], ['85%', dark], ['100%', light]].forEach(([offset, color]) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      gradient.append(stop);
    });
    defs.append(gradient);
  });
  svg.append(defs);
  [[139, 154, 'wheel-depth'], [139, 150, 'wheel-rim'], [132, 150, 'wheel-face'], [103, 153, 'wheel-recess'], [101, 150, 'wheel-inner-face'], [66, 152, 'wheel-recess'], [64, 150, 'wheel-hub']].forEach(([radius, cy, className]) => {
    const circle = document.createElementNS(ns, 'circle');
    Object.entries({ cx: 150, cy, r: radius, class: className }).forEach(([key, value]) => circle.setAttribute(key, value));
    svg.append(circle);
  });
  for (let i = 0; i < 52; i++) {
    const angle = (i * 360 / 52 - 90) * Math.PI / 180;
    const tick = document.createElementNS(ns, 'line');
    const inner = i % 2 ? 133 : 130;
    Object.entries({ x1: 150 + inner * Math.cos(angle), y1: 150 + inner * Math.sin(angle), x2: 150 + 137 * Math.cos(angle), y2: 150 + 137 * Math.sin(angle), class: 'wheel-tick' }).forEach(([key, value]) => tick.setAttribute(key, value));
    svg.append(tick);
  }
  const innerRing = document.createElementNS(ns, 'g');
  innerRing.setAttribute('class', 'inner-ring');
  innerRing.style.transform = 'rotate(' + rotation + 'deg)';
  svg.dataset.rotation = rotation;
  svg.dataset.offset = wheelShift;
  // The spoke marks the inner A position, making changes in alignment visible.
  const marker = document.createElementNS(ns, 'line');
  Object.entries({ x1: 150, y1: 48, x2: 150, y2: 57, class: 'wheel-marker' }).forEach(([key, value]) => marker.setAttribute(key, value));
  innerRing.append(marker);
  const pairs = [];
  for (let i = 0; i < 26; i++) {
    const angle = (i * 360 / 26 - 90) * Math.PI / 180;
    const decoded = String.fromCharCode(65 + (i - wheelShift + 26) % 26);
    pairs.push(String.fromCharCode(65 + i) + ' = ' + decoded);
    [119, 84].forEach((radius, ring) => {
      const text = document.createElementNS(ns, 'text');
      const x = 150 + radius * Math.cos(angle);
      const y = 150 + radius * Math.sin(angle);
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('class', ring ? 'decoded' : 'encoded');
      text.textContent = String.fromCharCode(65 + i);
      if (ring) {
        text.style.transformOrigin = x + 'px ' + y + 'px';
        text.style.transform = 'rotate(' + (-rotation) + 'deg)';
        innerRing.append(text);
      } else svg.append(text);
    });
  }
  svg.append(innerRing);
  const label = document.createElementNS(ns, 'text');
  label.setAttribute('class', 'wheel-offset-label');
  label.setAttribute('x', 150); label.setAttribute('y', 150);
  label.textContent = 'OFFSET ' + String(wheelShift).padStart(2, '0');
  svg.append(label);
  updateWheel(svg);
}
function updateWheel(svg) {
  svg.setAttribute('aria-valuenow', wheelShift);
  svg.setAttribute('aria-valuetext', 'Offset ' + wheelShift);
  const previous = Number(svg.dataset.offset);
  // Take the short route, including the wrap between offsets 25 and 0.
  const delta = ((wheelShift - previous + 39) % 26) - 13;
  const rotation = Number(svg.dataset.rotation) + delta * 360 / 26;
  svg.dataset.rotation = rotation;
  svg.dataset.offset = wheelShift;
  svg.querySelector('.inner-ring').style.transform = 'rotate(' + rotation + 'deg)';
  svg.querySelectorAll('.inner-ring text').forEach(text => {
    text.style.transform = 'rotate(' + (-rotation) + 'deg)';
  });
  svg.querySelector('.wheel-offset-label').textContent = 'OFFSET ' + String(wheelShift).padStart(2, '0');
  const pairs = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i) + ' = ' + String.fromCharCode(65 + (i - wheelShift + 26) % 26));
  svg.setAttribute('aria-label', 'Caesar wheel at offset ' + wheelShift + '. Outer ring is encrypted; inner ring is decoded.');
  document.querySelector('#wheel-pairs').textContent = pairs.join(' / ');
  const intercepted = state.cipher.message.match(/[A-Z]/)[0];
  const mapped = String.fromCharCode(65 + (intercepted.charCodeAt(0) - 65 - wheelShift + 26) % 26);
  document.querySelector('#wheel-feedback').textContent = 'Offset ' + String(wheelShift).padStart(2, '0') +
    ' selected. First letter: ' + intercepted + ' maps to ' + mapped + '. Decode the remaining letters and enter the phrase below.';
}
