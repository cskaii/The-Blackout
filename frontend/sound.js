(() => {
  let context, hum, gain, enabled = false;
  const button = document.querySelector('#sound-toggle');
  function stopHum() { if (hum) { hum.stop(); hum.disconnect(); hum = null; } if (gain) { gain.disconnect(); gain = null; } }
  function active() { return context && context.state === 'running'; }
  function sync(playing) {
    if (!enabled || !active() || !playing) { stopHum(); return; }
    if (hum) return;
    hum = context.createOscillator(); gain = context.createGain();
    hum.frequency.value = 55; hum.type = 'sine'; gain.gain.value = 0.018;
    hum.connect(gain); gain.connect(context.destination); hum.start();
  }
  function restored() {
    stopHum();
    if (!enabled || !active()) return;
    [261.63, 329.63, 392].forEach((frequency, i) => {
      const tone = context.createOscillator(), volume = context.createGain(), at = context.currentTime + i * 0.12;
      tone.frequency.value = frequency; volume.gain.setValueAtTime(0, at);
      volume.gain.linearRampToValueAtTime(0.045, at + 0.03); volume.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      tone.connect(volume); volume.connect(context.destination); tone.start(at); tone.stop(at + 0.65);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    });
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (enabled) { enabled = false; stopHum(); await context?.suspend(); }
      else {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw Error('Unavailable');
        context ||= new Audio(); await context.resume(); enabled = true;
      }
      button.setAttribute('aria-pressed', String(enabled)); button.textContent = enabled ? 'Sound: on — mute' : 'Sound: off';
      window.dispatchEvent(new Event('blackout-sound-change'));
    } catch { enabled = false; stopHum(); button.textContent = 'Sound unavailable'; button.setAttribute('aria-pressed', 'false'); }
    finally { button.disabled = false; }
  };
  window.addEventListener('pagehide', () => {
    enabled = false; stopHum(); const previous = context; context = null;
    previous?.close().catch(() => {}); button.textContent = 'Sound: off'; button.setAttribute('aria-pressed', 'false');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopHum(); else window.dispatchEvent(new Event('blackout-sound-change')); });
  globalThis.BLACKOUT_SOUND = { sync, restored };
})();
