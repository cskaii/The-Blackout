const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {frontend}=require('./helpers/frontend');
const game=require('../backend/services/gameEngine');
async function unlock(f,mode='practice'){
  f.document.querySelector('#mission-mode').value=mode;await f.fire('#start');
  assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,true);
  const s=f.state(),phrase=game.encrypt(s.cipher.message,26-s.cipher.failedCells);
  f.document.querySelector('#answer').value=phrase;await f.fire('#decode','onsubmit');
  assert.equal(f.state().stage,2);assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,false);
}
async function investigate(f){
  const row=f.document.querySelector('#sensor-records').children[1];await row.querySelector('button').onclick();await f.settle();
  await f.clickText('#file-shortcuts','Read incident.log');
  const source=f.state().collectedEvidence.find(item=>item.file==='incident.log').content.match(/imported (\S+) into/)[1];
  let card=f.document.querySelector('#evidence-candidates').children[1];await card.querySelector('button').onclick();await f.settle();
  await f.clickText('#file-shortcuts','Read '+source);
  card=f.document.querySelector('#evidence-candidates').children[2];await card.querySelector('button').onclick();await f.settle();
  await f.clickText('#file-shortcuts','Read recovery.txt');
  f.document.querySelector('#threat').value='prompt-injection';f.document.querySelector('#source').value=source;
  f.document.querySelector('#support-log').value='file:incident.log:1';f.document.querySelector('#support-instruction').value='file:'+source+':2';
  await f.fire('#diagnosis','onsubmit');assert.equal(f.state().stage,3);return source;
}

test('frontend completes evidence-led mission and shows each recovery confirmation and replay',async()=>{
  const f=frontend();await unlock(f);assert.equal(f.document.querySelector('#monitoring-voltage').textContent,'0 V');
  const source=await investigate(f);
  f.document.querySelector('#recovery-target').value=source;await f.fire('#recovery','onsubmit');
  assert.equal(f.state().recovery.step,1);assert.equal(f.document.querySelector('#monitoring-voltage').textContent,'0 V');
  const s=game.getSession(f.storage.get('blackout-session'));
  f.document.querySelector('#recovery-target').value=s.incident.safeSnapshot;await f.fire('#recovery','onsubmit');
  assert.equal(f.state().recovery.step,2);assert.equal(f.document.querySelector('#monitoring-voltage').textContent,'230 V');assert.equal(f.document.querySelector('#monitoring-alerts').textContent,'MUTED');
  f.document.querySelector('#recovery-target').value='enable-alerts';await f.fire('#recovery','onsubmit');
  assert.equal(f.state().finished,true);assert.equal(f.document.querySelector('#monitoring-alerts').textContent,'ENABLED');assert.equal(f.document.querySelector('#incident-replay').children.length,7);
  await f.fire('#again');assert.equal(f.state().stage,1);assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,true);assert.deepEqual(f.state().evidence.pins,[]);
});

test('refresh restores practice mode, pins and partial recovery without resetting the mission',async()=>{
  const f=frontend();await unlock(f);const source=await investigate(f);
  f.document.querySelector('#recovery-target').value=source;await f.fire('#recovery','onsubmit');
  const refreshed=frontend({app:f.app,storage:f.storage});await refreshed.settle();
  assert.equal(refreshed.state().stage,3);assert.equal(refreshed.state().recovery.step,1);
  assert.equal(refreshed.document.querySelector('#timer').textContent,'UNTIMED');assert.equal(refreshed.state().evidence.pins.length,3);assert.equal(refreshed.document.querySelector('#monitoring-source').textContent,'Maintenance import: QUARANTINED');
});

test('wrong choices preserve input and cannot advance the screen',async()=>{
  const f=frontend();await unlock(f);
  f.document.querySelector('#command').value='ls';await f.fire('#terminal','onsubmit');assert.match(f.document.querySelector('#output').textContent,/incident.log/);
  f.document.querySelector('#threat').value='prompt-injection';f.document.querySelector('#source').value='status.txt';
  await f.fire('#diagnosis','onsubmit');assert.equal(f.state().stage,2);assert.equal(f.document.querySelector('#source').value,'status.txt');assert.match(f.document.querySelector('#notice').textContent,/evidence chain/);
  const row=f.document.querySelector('#sensor-records').children[2];await row.querySelector('button').onclick();await f.settle();assert.equal(f.state().evidence.selectedRecord,null);assert.match(f.document.querySelector('#notice').textContent,/not the first/);
});

test('AI fallback is playable, plain text and does not interrupt investigation',async()=>{
  const f=frontend();await unlock(f);
  await f.clickText('#ai-questions','What changed before the blackout?');
  assert.equal(f.state().ai.history.length,1);assert.match(f.document.querySelector('#ai-status').textContent,/Backup dialogue/);
  await f.clickText('#file-shortcuts','Read incident.log');assert.ok(f.state().readFiles.includes('incident.log'));
  const snapshot=f.state();snapshot.revision++;snapshot.ai.history.push({question:'Test',reply:'<img src=x onerror=alert(1)>',mode:'scripted'});f.context.snapshot=snapshot;vm.runInContext('update(snapshot)',f.context);
  assert.equal(f.document.querySelector('#ai-history').querySelectorAll('img').length,0);assert.match(f.document.querySelector('#ai-history').textContent,/<img src=x/);
});

test('event refresh preserves the server deadline and stale snapshots cannot undo recovery',async()=>{
  const f=frontend();await unlock(f,'event');const s=game.getSession(f.storage.get('blackout-session'));s.startedAt-=60000;
  await [...f.intervals.values()][0]();assert.ok(f.state().remainingSeconds<=240);
  const refreshed=frontend({app:f.app,storage:f.storage});await refreshed.settle();assert.ok(refreshed.state().remainingSeconds<=240);
  const current=refreshed.state();refreshed.context.older={...current,revision:current.revision-1,stage:1};vm.runInContext('update(older)',refreshed.context);assert.equal(refreshed.state().stage,2);
  s.startedAt-=game.DURATION_MS;await [...refreshed.intervals.values()][0]();assert.equal(refreshed.state().expired,true);assert.ok(refreshed.document.querySelector('#again'));assert.equal(refreshed.document.querySelector('#recovery'),null);
});

test('sound requires opt-in, mutes the hum and plays a restoration chord only when enabled',async()=>{
  const f=frontend();let starts=0,stops=0;
  class Audio {
    constructor(){this.state='suspended';this.currentTime=0;this.destination={};}
    async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
    createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){starts++;},stop(){stops++;}};}
    createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  f.context.window.AudioContext=Audio;
  vm.runInContext(require('node:fs').readFileSync('frontend/sound.js','utf8'),f.context);
  await unlock(f);assert.equal(starts,0);
  await f.fire('#sound-toggle');assert.equal(starts,1);assert.equal(f.document.querySelector('#sound-toggle').getAttribute('aria-pressed'),'true');
  vm.runInContext('BLACKOUT_SOUND.restored()',f.context);assert.equal(starts,4);assert.ok(stops>=4);
  await f.fire('#sound-toggle');assert.equal(f.document.querySelector('#sound-toggle').getAttribute('aria-pressed'),'false');
  const before=starts;vm.runInContext('BLACKOUT_SOUND.sync(true); BLACKOUT_SOUND.restored()',f.context);assert.equal(starts,before);
});

test('unsupported audio never blocks gameplay',async()=>{
  const f=frontend();vm.runInContext(require('node:fs').readFileSync('frontend/sound.js','utf8'),f.context);
  await f.fire('#sound-toggle');assert.equal(f.document.querySelector('#sound-toggle').textContent,'Sound unavailable');
  await unlock(f);assert.equal(f.state().stage,2);
});

test('temporary refresh failure preserves the mission and offers reconnect without a new start',async()=>{
  const f=frontend();await unlock(f);const id=f.storage.get('blackout-session');
  const recovered=frontend({app:f.app,storage:f.storage,fetch:async()=>{throw Error('Offline');}});
  await recovered.settle();
  assert.equal(recovered.storage.get('blackout-session'),id);
  assert.match(recovered.document.querySelector('#notice').textContent,/Retry to resume/);
  assert.equal(recovered.document.querySelector('#start').textContent,'Retry connection');
  assert.equal(recovered.document.querySelector('#start').disabled,false);
});
