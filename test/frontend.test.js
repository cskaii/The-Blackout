const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {frontend}=require('./helpers/frontend');
const game=require('../backend/services/gameEngine');
async function unlock(f){
  await f.fire('#start');
  assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,true);
  const s=f.state(),phrase=game.encrypt(s.cipher.message,26-s.cipher.failedCells);
  f.document.querySelector('#answer').value=phrase;await f.fire('#decode','onsubmit');
  assert.equal(f.state().stage,2);assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,false);
}

test('wheel scrolling wraps offsets, accumulates trackpad movement and synchronizes controls',async()=>{
  const f=frontend();await f.fire('#start');
  const wheel=f.document.querySelector('#wheel'),select=f.document.querySelector('#wheel-shift');
  let prevented=0;
  const scroll=(deltaY,extra={})=>wheel.events.wheel({deltaY,deltaMode:0,preventDefault(){prevented++;},...extra});
  scroll(40);assert.equal(Number(select.value),0);
  scroll(60);assert.equal(Number(select.value),1);
  assert.match(f.document.querySelector('#wheel-pairs').textContent,/A = Z/);
  assert.equal(wheel.getAttribute('aria-valuenow'),'1');
  scroll(-100);assert.equal(Number(select.value),0);
  scroll(-100);assert.equal(Number(select.value),25);
  assert.equal(Number(wheel.dataset.rotation),-360/26);
  scroll(100);assert.equal(Number(select.value),0);
  const before=prevented;scroll(100,{ctrlKey:true});assert.equal(prevented,before);assert.equal(Number(select.value),0);
  scroll(100,{deltaMode:1});assert.equal(Number(select.value),16);
  select.value='4';select.onchange();assert.equal(Number(wheel.dataset.offset),4);
  wheel.onkeydown({key:'ArrowLeft',preventDefault(){}});assert.equal(Number(select.value),3);
  wheel.onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(Number(select.value),4);
  assert.equal(f.state().stage,1);
});

test('wheel dragging follows angles across the seam, captures pointers and stops on release or cancel',async()=>{
  const f=frontend();await f.fire('#start');
  const wheel=f.document.querySelector('#wheel'),select=f.document.querySelector('#wheel-shift');
  wheel.getBoundingClientRect=()=>({left:20,top:30,width:300,height:300});
  let captured=null;
  wheel.setPointerCapture=id=>{captured=id;};wheel.hasPointerCapture=id=>captured===id;
  wheel.releasePointerCapture=()=>{captured=null;};
  const point=(degrees,extra={})=>({pointerId:1,button:0,clientX:170+110*Math.cos(degrees*Math.PI/180),clientY:180+110*Math.sin(degrees*Math.PI/180),preventDefault(){},...extra});
  wheel.onpointerdown(point(0,{button:2}));assert.equal(captured,null);
  wheel.onpointerdown(point(0,{clientX:170,clientY:180}));assert.equal(captured,null);
  wheel.onpointerdown(point(170));assert.equal(captured,1);
  wheel.onpointermove(point(-170,{pointerId:2}));assert.equal(Number(select.value),0);
  wheel.onpointermove(point(-170));assert.equal(Number(select.value),1);
  wheel.onpointermove(point(170));assert.equal(Number(select.value),0);
  wheel.onpointermove(point(170-360/26));assert.equal(Number(select.value),25);
  wheel.onpointerup(point(150));assert.equal(captured,null);assert.ok(!wheel.className.includes('dragging'));
  wheel.onpointermove(point(0));assert.equal(Number(select.value),25);
  wheel.onpointerdown(point(0));wheel.onpointercancel(point(0));assert.equal(captured,null);
  wheel.onpointermove(point(90));assert.equal(Number(select.value),25);
  wheel.onpointerdown(point(0));captured=null;wheel.onlostpointercapture(point(0));
  assert.ok(!wheel.className.includes('dragging'));
  wheel.onpointermove(point(90));assert.equal(Number(select.value),25);
});
async function investigate(f){
  const row=f.document.querySelector('#sensor-records').children[1];await row.querySelector('button').onclick();await f.settle();
  assert.match(f.document.querySelector('#next-step').textContent,/cat incident.log/);
  await f.command('cat incident.log');
  const source=f.state().collectedEvidence.find(item=>item.file==='incident.log').content.match(/imported (\S+) into/)[1];
  assert.ok(f.document.querySelector('#next-step').textContent.includes('cat '+source));
  await f.command('cat '+source);
  const line=f.document.querySelector('#instruction-options').children[2];await line.querySelector('button').onclick();await f.settle();
  assert.equal(f.document.querySelector('#source').value,source);
  f.document.querySelector('#threat').value='prompt-injection';
  await f.fire('#diagnosis','onsubmit');assert.equal(f.state().stage,3);return source;
}

function arrow(f, key, modifiers = {}) {
  let prevented = false;
  f.document.querySelector('#command').onkeydown({key, ...modifiers, preventDefault(){prevented = true;}});
  return prevented;
}

test('terminal arrow keys recall commands without running them and restore the draft',async()=>{
  const f=frontend();await unlock(f);
  const input=f.document.querySelector('#command');input.value='cat unfinished';
  assert.equal(arrow(f,'ArrowUp'),false);assert.equal(input.value,'cat unfinished');
  await f.command('ls');await f.command('cat incident.log');
  input.value='cat status.txt';
  assert.equal(arrow(f,'ArrowUp'),true);assert.equal(input.value,'cat incident.log');
  assert.equal(input.selectionStart,input.value.length);assert.equal(input.selectionEnd,input.value.length);
  await [...f.intervals.values()][0]();
  arrow(f,'ArrowUp');assert.equal(input.value,'ls');
  arrow(f,'ArrowUp');assert.equal(input.value,'ls');
  arrow(f,'ArrowDown');assert.equal(input.value,'cat incident.log');
  arrow(f,'ArrowDown');assert.equal(input.value,'cat status.txt');
  assert.equal(arrow(f,'ArrowDown'),false);assert.equal(input.value,'cat status.txt');
  assert.equal(arrow(f,'ArrowUp',{ctrlKey:true}),false);
  assert.equal(arrow(f,'ArrowUp',{isComposing:true}),false);
  assert.equal(f.state().terminalHistory.length,2);
  arrow(f,'ArrowUp');await f.fire('#terminal','onsubmit');
  assert.equal(input.value,'');assert.equal(f.state().terminalHistory.length,3);
  arrow(f,'ArrowUp');assert.equal(input.value,'cat incident.log');
  arrow(f,'ArrowDown');assert.equal(input.value,'');
});

test('terminal history resumes after refresh and stays isolated from the next mission',async()=>{
  const f=frontend();await unlock(f);await f.command('pwd');
  const refreshed=frontend({app:f.app,storage:f.storage});await refreshed.settle();
  arrow(refreshed,'ArrowUp');assert.equal(refreshed.document.querySelector('#command').value,'pwd');
  game.getSession(refreshed.storage.get('blackout-session')).startedAt-=game.DURATION_MS;
  await [...refreshed.intervals.values()][0]();
  await refreshed.fire('#again');
  assert.equal(refreshed.state().remainingSeconds,420);
  assert.equal(refreshed.document.querySelector('#timer').textContent,'07:00');
  const s=refreshed.state();
  refreshed.document.querySelector('#answer').value=game.encrypt(s.cipher.message,26-s.cipher.failedCells);
  await refreshed.fire('#decode','onsubmit');
  assert.equal(arrow(refreshed,'ArrowUp'),false);assert.equal(refreshed.document.querySelector('#command').value,'');
});

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
  assert.equal(f.document.querySelector('#mission-mode'),null);await f.fire('#again');assert.equal(f.state().mode,'event');assert.equal(f.state().stage,1);assert.equal(f.document.querySelector('#monitoring-dashboard').hidden,true);assert.equal(f.state().evidence.selectedInstruction,null);
});

test('refresh restores event countdown, selected instruction and partial recovery without resetting the mission',async()=>{
  const f=frontend();await unlock(f);const source=await investigate(f);
  f.document.querySelector('#recovery-target').value=source;await f.fire('#recovery','onsubmit');
  const refreshed=frontend({app:f.app,storage:f.storage});await refreshed.settle();
  assert.equal(refreshed.state().stage,3);assert.equal(refreshed.state().recovery.step,1);
  assert.equal(refreshed.state().mode,'event');assert.match(refreshed.document.querySelector('#timer').textContent,/^\d{2}:\d{2}$/);assert.equal(refreshed.state().evidence.selectedInstruction,'file:'+source+':2');assert.equal(refreshed.document.querySelector('#monitoring-source').textContent,'Maintenance import: QUARANTINED');
});

test('wrong choices preserve input and cannot advance the screen',async()=>{
  const f=frontend();await unlock(f);
  f.document.querySelector('#command').value='ls';await f.fire('#terminal','onsubmit');assert.match(f.document.querySelector('#output').textContent,/incident.log/);
  f.document.querySelector('#threat').value='prompt-injection';f.document.querySelector('#source').value='status.txt';
  await f.fire('#diagnosis','onsubmit');assert.equal(f.state().stage,2);assert.equal(f.document.querySelector('#threat').value,'prompt-injection');assert.match(f.document.querySelector('#notice').textContent,/First choose/);
  const row=f.document.querySelector('#sensor-records').children[2];await row.querySelector('button').onclick();await f.settle();assert.equal(f.state().evidence.selectedRecord,null);assert.match(f.document.querySelector('#notice').textContent,/FIRST time/);
});

test('AI fallback is playable, plain text and does not interrupt investigation',async()=>{
  const f=frontend();await unlock(f);
  await f.clickText('#ai-questions','What changed before the blackout?');
  assert.equal(f.state().ai.history.length,1);assert.match(f.document.querySelector('#ai-status').textContent,/Backup dialogue/);
  await f.command('cat incident.log');assert.ok(f.state().readFiles.includes('incident.log'));
  const snapshot=f.state();snapshot.revision++;snapshot.ai.history.push({question:'Test',reply:'<img src=x onerror=alert(1)>',mode:'scripted'});f.context.snapshot=snapshot;vm.runInContext('update(snapshot)',f.context);
  assert.equal(f.document.querySelector('#ai-history').querySelectorAll('img').length,0);assert.match(f.document.querySelector('#ai-history').textContent,/<img src=x/);
});

test('event refresh preserves the server deadline and stale snapshots cannot undo recovery',async()=>{
  const f=frontend();await unlock(f,'event');const s=game.getSession(f.storage.get('blackout-session'));s.startedAt-=60000;
  await [...f.intervals.values()][0]();assert.ok(f.state().remainingSeconds<=360);
  const refreshed=frontend({app:f.app,storage:f.storage});await refreshed.settle();assert.ok(refreshed.state().remainingSeconds<=360);
  const current=refreshed.state();refreshed.context.older={...current,revision:current.revision-1,stage:1};vm.runInContext('update(older)',refreshed.context);assert.equal(refreshed.state().stage,2);
  s.startedAt-=game.DURATION_MS;await [...refreshed.intervals.values()][0]();assert.equal(refreshed.state().expired,true);assert.ok(refreshed.document.querySelector('#again'));assert.equal(refreshed.document.querySelector('#recovery'),null);
});

test('player flow has no sound controls, mode picker or clickable file-reading shortcuts',async()=>{
  const f=frontend();
  assert.equal(f.document.querySelector('#mission-mode'),null);
  assert.equal(f.document.querySelector('#sound-toggle'),null);
  assert.equal(f.document.querySelector('script').getAttribute('src'),'config.js');
  await unlock(f);
  assert.equal(f.state().mode,'event');
  assert.equal(f.document.querySelector('#file-shortcuts'),null);
  assert.deepEqual(f.state().readFiles,[]);
  await f.command('ls');
  assert.match(f.document.querySelector('#output').textContent,/incident.log/);
  await f.command('cat incident.log');
  assert.deepEqual(f.state().readFiles,['incident.log']);
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


test('beginners see instructions before the timer and no pinning or supporting dropdowns',async()=>{
  const f=frontend();
  assert.equal(f.state(),null);
  assert.match(f.document.querySelector('.command-brief').textContent,/cat readme.txt/);
  await unlock(f);
  for(const selector of ['#support-log','#support-instruction','#evidence-board','#evidence-file']) assert.equal(f.document.querySelector(selector),null);
  assert.equal(f.document.querySelector('#diagnosis').hidden,true);
  assert.equal(f.document.querySelector('#instruction-picker').hidden,true);
  assert.equal(f.document.querySelector('.optional-controller').getAttribute('open'),null);
  assert.equal(f.document.querySelector('.optional-trend').getAttribute('open'),null);
  await investigate(f);
  assert.match(f.document.querySelector('#collected-evidence').textContent,/Blackout began at/);
  assert.match(f.document.querySelector('#collected-evidence').textContent,/Snapshot/);
  assert.equal(f.state().readFiles.includes('recovery.txt'),false);
});
