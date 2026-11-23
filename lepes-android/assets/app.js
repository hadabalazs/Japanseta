'use strict';
// Android build: the walk itself runs natively (WalkService), so it keeps going with the screen locked.
// This page only shows state and sends commands through the window.Lepes bridge.
(() => {
const $ = id => document.getElementById(id);
const L = window.Lepes || browserStub();
let state = 'idle', ready = false, fast = 180, slow = 180, lastPhase = null;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
};
try {
  const saved = JSON.parse(storage.get('lepes-settings'));
  if (saved && [saved.fast, saved.slow].every(n => Number.isInteger(n) && n >= 1 && n <= 15)) {
    $('fast-minutes').value = saved.fast;
    $('slow-minutes').value = saved.slow;
    $('keep-awake').checked = saved.awake === true;
    $('vibration').checked = saved.vibration === true;
  }
} catch { /* Corrupt or unavailable storage keeps safe defaults. */ }

function phaseAt(position, fast, slow) {
  const time = ((position % (fast + slow)) + fast + slow) % (fast + slow);
  const isFast = time < fast;
  const elapsed = isFast ? time : time - fast;
  const duration = isFast ? fast : slow;
  return { phase: isFast ? 'fast' : 'slow', remaining: Math.ceil(duration - elapsed), progress: elapsed / duration };
}
function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function saveSettings() {
  const saved = storage.set('lepes-settings', JSON.stringify({ fast: fast / 60, slow: slow / 60, awake: $('keep-awake').checked, vibration: $('vibration').checked }));
  if (!saved) $('message').textContent = 'A beállításokat nem sikerült megjegyezni.';
}
function status() {
  try { return JSON.parse(L.status()); } catch { return { state: 'idle', position: 0, fast, slow, interrupted: false }; }
}
function display() {
  const walking = state !== 'idle';
  $('setup').hidden = walking;
  $('intro').hidden = walking;
  $('walk').hidden = !walking;
  $('stop').hidden = !walking;
  $('walk-actions').hidden = !walking;
  $('start-walk').disabled = !ready;
  $('start-status').textContent = ready ? 'Érintsd meg a kört az indításhoz.' : 'Ellenőrizd a lenti időbeállításokat.';
  $('start-summary').textContent = `${fast / 60} perc gyors · ${slow / 60} perc lassú`;
  $('main-action').textContent = state === 'playing' ? 'Szünet' : 'Séta folytatása';
  $('walk-status').textContent = state === 'paused' ? 'A SÉTA SZÜNETEL' : 'SÉTA FOLYAMATBAN';
  const awake = state === 'playing' && $('keep-awake').checked;
  L.keepScreenOn(awake);
  $('wake-status').textContent = awake ? 'A képernyő most bekapcsolva marad.' : 'Nem szükséges: lezárt képernyőn is szólnak a jelzések.';
}
function renderClock(position) {
  if (state === 'idle') return;
  const info = phaseAt(position, fast, slow);
  if (info.phase !== lastPhase) {
    if (lastPhase) $('phase-announcement').textContent = info.phase === 'fast' ? 'Most gyors séta következik.' : 'Most lassú séta következik.';
    lastPhase = info.phase;
  }
  document.body.dataset.phase = info.phase;
  $('phase-title').textContent = info.phase === 'fast' ? 'Gyors séta' : 'Lassú séta';
  $('phase-instruction').textContent = info.phase === 'fast' ? 'Sétálj egy kicsit lendületesebben.' : 'Lassíts, sétálj kényelmesen.';
  $('countdown').textContent = formatTime(info.remaining);
  $('progress-ring').style.strokeDashoffset = String(info.progress * 100);
  $('next-pace').textContent = info.phase === 'fast' ? `Utána: lassú séta · ${slow / 60} perc` : `Utána: gyors séta · ${fast / 60} perc`;
}
// The native engine is the source of truth; notification buttons change it too.
function sync() {
  const s = status();
  if (s.state !== state) {
    const previous = state;
    state = s.state;
    if (state !== 'idle') {
      fast = s.fast; slow = s.slow;
      $('fast-minutes').value = fast / 60; $('slow-minutes').value = slow / 60;
    }
    if (state === 'paused' && s.interrupted) $('message').textContent = 'A lejátszás megszakadt. A folytatáshoz érintsd meg a „Séta folytatása” gombot.';
    else if (state === 'idle' && previous !== 'idle') {
      $('message').textContent = 'A séta véget ért. Jó pihenést!';
      document.body.removeAttribute('data-phase');
      lastPhase = null;
      readInputs();
    } else $('message').textContent = '';
    display();
  }
  renderClock(s.position);
}
function readInputs() {
  const f = Number($('fast-minutes').value), s = Number($('slow-minutes').value);
  const valid = [f, s].every(n => Number.isInteger(n) && n >= 1 && n <= 15);
  for (const key of ['fast', 'slow']) {
    const input = $(`${key}-minutes`), n = Number(input.value);
    input.setAttribute('aria-invalid', String(!Number.isInteger(n) || n < 1 || n > 15));
    document.querySelector(`[data-adjust="${key}:-1"]`).disabled = n <= 1;
    document.querySelector(`[data-adjust="${key}:1"]`).disabled = n >= 15;
  }
  $('input-error').hidden = valid;
  $('input-error').textContent = valid ? '' : 'Adj meg mindkét mezőben egy egész számot 1 és 15 között.';
  return valid ? { fast: f * 60, slow: s * 60 } : null;
}
function prepare() {
  if (state !== 'idle') return;
  const values = readInputs();
  ready = Boolean(values);
  if (values) { fast = values.fast; slow = values.slow; saveSettings(); }
  display();
}
function start() {
  if (!ready) return;
  if (state === 'paused') L.resume();
  else { lastPhase = null; L.start(fast, slow, $('vibration').checked); }
  sync();
  if (state === 'playing') { window.scrollTo({ top: 0, behavior: 'instant' }); $('main-action').focus({ preventScroll: true }); }
  else $('message').textContent = 'A hang nem indult el. Érintsd meg újra az indítást, és ellenőrizd a hangerőt.';
}
function stop() {
  L.stop(); sync();
  window.scrollTo({ top: 0, behavior: 'instant' }); $('start-walk').focus({ preventScroll: true });
}
function checkBattery() { $('battery-box').hidden = Boolean(L.batteryOk()); }

$('main-action').addEventListener('click', () => { if (state === 'playing') { L.pause(); sync(); } else start(); });
$('start-walk').addEventListener('click', start);
$('stop').addEventListener('click', stop);
for (const key of ['fast', 'slow']) $(`${key}-minutes`).addEventListener('input', prepare);
for (const button of document.querySelectorAll('[data-adjust]')) button.addEventListener('click', () => {
  const [key, delta] = button.dataset.adjust.split(':');
  const input = $(`${key}-minutes`);
  input.value = Math.max(1, Math.min(15, (Number(input.value) || 1) + Number(delta)));
  prepare();
});
$('keep-awake').addEventListener('change', () => { saveSettings(); display(); });
$('vibration').addEventListener('change', () => {
  saveSettings(); L.setVibration($('vibration').checked);
  if ($('vibration').checked) L.vibrateTest();
});
let previewTimer;
$('sound-test').addEventListener('click', () => {
  clearTimeout(previewTimer);
  try {
    L.preview();
    $('sound-status').textContent = 'Most két rövid, majd egy hosszú hang szól. Állítsd be a kényelmes hangerőt.';
    previewTimer = setTimeout(() => { $('sound-status').textContent = 'Két rövid hang: gyors séta. Egy hosszú hang: lassú séta.'; }, 4200);
  } catch { $('sound-status').textContent = 'Nem indult el a hang. Próbáld újra, és ellenőrizd a telefon hangerejét.'; }
});
$('battery').addEventListener('click', () => L.askBattery());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); checkBattery(); } });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 250);

prepare();
sync();
checkBattery();

// Desktop-browser preview only: simulates the native engine with a wall clock (no sound).
function browserStub() {
  let st = 'idle', f = 180, s = 180, base = 0, startedAt = 0;
  const pos = () => st === 'playing' ? base + (Date.now() - startedAt) / 1000 : base;
  return {
    status: () => JSON.stringify({ state: st, position: pos(), fast: f, slow: s, interrupted: false }),
    start(a, b) { f = a; s = b; base = 0; startedAt = Date.now(); st = 'playing'; },
    pause() { base = pos(); st = 'paused'; },
    resume() { startedAt = Date.now(); st = 'playing'; },
    stop() { st = 'idle'; base = 0; },
    preview() {}, setVibration() {}, vibrateTest() {}, keepScreenOn() {},
    batteryOk: () => true, askBattery() {}
  };
}
})();
