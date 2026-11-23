import { createTrack, phaseAt, formatTime } from './engine.js';

const $ = id => document.getElementById(id);
const audio = new Audio();
audio.loop = true;
audio.preload = 'auto';
const preview = new Audio();
let audioUrl, previewUrl, worker, wakeLock, registration, deferredInstall, preparationTimeout;
let state = 'idle', ready = false, preparing = false, prepareId = 0;
let fast = 180, slow = 180, lastPhase = null, lastPosition = 0, starting = false;
let activationRequested = false, reloaded = false;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
};
try {
  const saved = JSON.parse(storage.get('lepes-settings'));
  if (saved && [saved.fast, saved.slow].every(n => Number.isInteger(n) && n >= 1 && n <= 15)) {
    $('fast-minutes').value = saved.fast;
    $('slow-minutes').value = saved.slow;
    $('keep-awake').checked = saved.awake !== false;
    $('vibration').checked = saved.vibration === true;
  }
} catch { /* Corrupt or unavailable storage keeps safe defaults. */ }
const canVibrate = typeof navigator.vibrate === 'function';
if (!canVibrate) {
  $('vibration').checked = false;
  $('vibration').disabled = true;
  $('vibration-help').textContent = 'Ezen a készüléken nem érhető el. A hangjelzés használható.';
}
function saveSettings() {
  const saved = storage.set('lepes-settings', JSON.stringify({ fast: fast / 60, slow: slow / 60, awake: $('keep-awake').checked, vibration: $('vibration').checked }));
  if (!saved) $('message').textContent = 'A beállításokat ez a böngésző nem tudja megjegyezni.';
}
function stopPreview() { preview.pause(); preview.currentTime = 0; }
function vibrate(phase) {
  if (canVibrate && $('vibration').checked && document.visibilityState === 'visible') {
    navigator.vibrate(phase === 'fast' ? [180, 130, 180] : [500]);
  }
}
function display() {
  const walking = state !== 'idle';
  $('setup').hidden = walking;
  $('intro').hidden = walking;
  $('walk').hidden = !walking;
  $('stop').hidden = !walking;
  $('walk-actions').hidden = !walking;
  $('start-walk').disabled = preparing || !ready || starting;
  $('start-label').innerHTML = 'Indulhat<br>a séta';
  $('start-status').textContent = starting ? 'Indítás…' : preparing ? 'Hang előkészítése…' : !ready ? 'Ellenőrizd a lenti időbeállításokat.' : 'Érintsd meg a kört az indításhoz.';
  $('start-summary').textContent = `${fast / 60} perc gyors · ${slow / 60} perc lassú`;
  $('main-action').disabled = preparing || (!ready && state === 'idle') || starting;
  $('main-action').textContent = starting ? 'Indítás…' : preparing ? 'Hang előkészítése…' : state === 'playing' ? 'Szünet' : state === 'paused' ? 'Séta folytatása' : 'Séta indítása';
  $('walk-status').textContent = state === 'paused' ? 'A SÉTA SZÜNETEL' : 'SÉTA FOLYAMATBAN';
  if (registration?.waiting) {
    $('update').disabled = walking;
    $('update-help').textContent = walking ? 'A séta befejezése után frissíthetsz.' : '';
  }
  renderClock(false);
}
function renderClock(allowBuzz = true) {
  if (state === 'idle') return;
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const info = phaseAt(position, fast, slow);
  const changed = info.phase !== lastPhase;
  const wrapped = position < lastPosition - 1;
  if ((changed || wrapped) && allowBuzz && state === 'playing') vibrate(info.phase);
  if (changed) $('phase-announcement').textContent = info.phase === 'fast' ? 'Most gyors séta következik.' : 'Most lassú séta következik.';
  lastPhase = info.phase;
  lastPosition = position;
  document.body.dataset.phase = info.phase;
  $('phase-title').textContent = info.phase === 'fast' ? 'Gyors séta' : 'Lassú séta';
  $('phase-instruction').textContent = info.phase === 'fast' ? 'Sétálj egy kicsit lendületesebben.' : 'Lassíts, sétálj kényelmesen.';
  $('countdown').textContent = formatTime(info.remaining);
  $('progress-ring').style.strokeDashoffset = String(info.progress * 100);
  $('next-pace').textContent = info.phase === 'fast' ? `Utána: lassú séta · ${slow / 60} perc` : `Utána: gyors séta · ${fast / 60} perc`;
}
function releaseWake() {
  if (wakeLock) { const lock = wakeLock; wakeLock = null; lock.release().catch(() => {}); }
}
let wakePending = false;
async function requestWake() {
  if (state !== 'playing' || !$('keep-awake').checked || document.visibilityState !== 'visible' || wakeLock || wakePending) return;
  if (!navigator.wakeLock) {
    $('wake-status').textContent = 'Automatikus ébren tartás nem érhető el. Ne hagyd lezáródni a képernyőt.';
    return;
  }
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (state !== 'playing' || !$('keep-awake').checked || document.visibilityState !== 'visible') { await lock.release(); return; }
    wakeLock = lock;
    $('wake-status').textContent = 'A képernyő most bekapcsolva marad.';
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
      $('wake-status').textContent = 'A képernyő ébren tartása kikapcsolt.';
    });
  } catch { $('wake-status').textContent = 'A telefon nem engedte az ébren tartást. Figyelj a képernyőre.'; }
  finally { wakePending = false; }
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
  const id = ++prepareId;
  clearTimeout(preparationTimeout);
  worker?.terminate(); worker = null;
  stopPreview();
  audio.pause(); audio.removeAttribute('src'); audio.load();
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  ready = false; preparing = false;
  const values = readInputs();
  if (!values) { display(); return; }
  fast = values.fast; slow = values.slow; saveSettings();
  preparing = true; display();
  const failed = () => {
    if (id !== prepareId) return;
    clearTimeout(preparationTimeout);
    worker?.terminate(); worker = null;
    preparing = false; ready = false; display();
    $('message').textContent = 'A hang előkészítése nem sikerült. Érintsd meg az újrapróbálkozást.';
    $('main-action').textContent = 'Újrapróbálkozás';
    $('main-action').disabled = false;
    $('start-label').textContent = 'Újrapróbálkozás';
    $('start-walk').disabled = false;
    $('start-status').textContent = 'A hang nem készült el. Érintsd meg a kört újra.';
  };
  preparationTimeout = setTimeout(failed, 15000);
  const useBuffer = buffer => {
    if (id !== prepareId) return;
    worker?.terminate(); worker = null;
    audioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    audio.src = audioUrl; audio.load();
    // Loading metadata is sufficient; the complete file is already in memory.
    audio.onloadedmetadata = () => {
      if (id !== prepareId) return;
      clearTimeout(preparationTimeout);
      preparing = false; ready = true; display();
    };
  };
  try {
    worker = new Worker('./audio-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => data.buffer ? useBuffer(data.buffer) : failed();
    worker.onerror = failed;
    worker.postMessage({ fast, slow });
  } catch { failed(); }
}
function playbackCategory() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Optional enhancement. */ }
}
async function start() {
  if (starting || preparing) return;
  if (!ready) { prepare(); return; }
  stopPreview(); playbackCategory();
  const previous = state;
  if (state === 'idle') { audio.currentTime = 0; lastPhase = null; lastPosition = 0; }
  starting = true; display();
  try {
    await audio.play();
    state = 'playing'; starting = false;
    $('message').textContent = '';
    display(); vibrate(phaseAt(audio.currentTime, fast, slow).phase);
    requestWake();
    if (previous === 'idle') { window.scrollTo({ top: 0, behavior: 'instant' }); $('main-action').focus({ preventScroll: true }); }
    setMediaState();
  } catch {
    starting = false; state = previous; display();
    $('message').textContent = 'A hang nem indult el. Érintsd meg újra az indítást, és ellenőrizd a hangerőt.';
  }
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused'; audio.pause(); releaseWake();
  if (canVibrate) navigator.vibrate(0);
  $('message').textContent = ''; display(); setMediaState();
}
function stop() {
  state = 'idle'; audio.pause(); audio.currentTime = 0;
  stopPreview(); releaseWake(); lastPhase = null;
  if (canVibrate) navigator.vibrate(0);
  $('message').textContent = 'A séta véget ért. Jó pihenést!';
  document.body.removeAttribute('data-phase');
  display(); setMediaState(); window.scrollTo({ top: 0, behavior: 'instant' }); $('start-walk').focus({ preventScroll: true });
}
function setMediaState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none';
}
if ('mediaSession' in navigator && 'MediaMetadata' in window) {
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Lépés – Séta', artist: 'Gyors és lassú tempó', artwork: [{ src: new URL('./icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
  for (const [name, handler] of Object.entries({ play: start, pause, stop })) {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Optional control. */ }
  }
}
audio.addEventListener('pause', () => {
  if (state === 'playing') {
    state = 'paused'; releaseWake(); display(); setMediaState();
    $('message').textContent = 'A lejátszás megszakadt. A folytatáshoz érintsd meg a „Séta folytatása” gombot.';
  }
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  clearTimeout(preparationTimeout);
  preparing = false; ready = false;
  if (state !== 'idle') { state = 'idle'; releaseWake(); }
  display(); $('main-action').disabled = false; $('main-action').textContent = 'Újrapróbálkozás';
  $('start-label').textContent = 'Újrapróbálkozás'; $('start-walk').disabled = false;
  $('start-status').textContent = 'A hang nem játszható le. Érintsd meg a kört újra.';
  $('message').textContent = 'A hang nem játszható le. Próbáld újra.';
});
audio.addEventListener('waiting', () => { if (state === 'playing') $('message').textContent = 'A hang lejátszása várakozik…'; });
audio.addEventListener('playing', () => { $('message').textContent = ''; });
audio.addEventListener('timeupdate', () => renderClock());
setInterval(() => { if (state === 'playing' && document.visibilityState === 'visible') renderClock(); }, 200);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Never buzz for cues missed while hidden; reconcile against media position.
    renderClock(false);
    if (state === 'playing' && audio.paused) { state = 'paused'; display(); setMediaState(); }
    requestWake();
  } else { releaseWake(); stopPreview(); }
});
$('main-action').addEventListener('click', () => state === 'playing' ? pause() : start());
$('start-walk').addEventListener('click', start);
$('stop').addEventListener('click', stop);
for (const key of ['fast', 'slow']) $(`${key}-minutes`).addEventListener('input', prepare);
for (const button of document.querySelectorAll('[data-adjust]')) button.addEventListener('click', () => {
  const [key, delta] = button.dataset.adjust.split(':');
  const input = $(`${key}-minutes`);
  input.value = Math.max(1, Math.min(15, (Number(input.value) || 1) + Number(delta)));
  prepare();
});
$('keep-awake').addEventListener('change', () => { saveSettings(); if ($('keep-awake').checked) requestWake(); else releaseWake(); });
$('vibration').addEventListener('change', () => { saveSettings(); if ($('vibration').checked) vibrate('fast'); });
$('sound-test').addEventListener('click', async () => {
  stopPreview(); playbackCategory();
  if (!previewUrl) previewUrl = URL.createObjectURL(new Blob([createTrack(0, 0, true)], { type: 'audio/wav' }));
  preview.src = previewUrl;
  try { await preview.play(); $('sound-status').textContent = 'Most két rövid, majd egy hosszú hang szól. Állítsd be a kényelmes hangerőt.'; }
  catch { $('sound-status').textContent = 'Nem indult el a hang. Próbáld újra, és ellenőrizd a telefon hangerejét.'; }
});
preview.addEventListener('ended', () => { $('sound-status').textContent = 'Két rövid hang: gyors séta. Egy hosszú hang: lassú séta.'; });

// First-visit guidance is optional and does not block using the app in a browser.
const dialog = $('install-dialog');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let guideDevice = isIOS ? 'ios' : 'android';
let guideStep = 0;
const instructions = $('install-instructions');
const guides = {
  android: [
    { title: 'Nyisd meg a hárompontos menüt!', copy: 'Chrome-ban keresd a három egymás alatti pontot, általában a jobb felső sarokban.', alt: 'Böngészősáv: a jobb felső hárompontos menüt narancssárga kör jelöli.' },
    { title: 'Válaszd a kezdőképernyőhöz adást!', copy: 'Érintsd meg a „Hozzáadás a kezdőképernyőhöz” sort. Egyes telefonokon „Alkalmazás telepítése” a neve.', alt: 'A menüben a Hozzáadás a kezdőképernyőhöz sor van kiemelve.' },
    { title: 'Erősítsd meg a telepítést!', copy: 'Érintsd meg a „Telepítés” vagy „Hozzáadás” gombot. Ezután a Lépés ikonját keresd a kezdőképernyőn vagy az alkalmazások között.', alt: 'A Lépés telepítési ablakában a Telepítés gomb van kiemelve.' }
  ],
  ios: [
    { title: 'Safariban nyisd meg a Megosztást!', copy: 'Keresd a felfelé mutató nyilat egy négyzetben. Ha nem látszik, nyisd meg a Safari további lehetőségeit.', alt: 'Safari eszköztár: a négyzetből felfelé mutató Megosztás nyilat kör jelöli.' },
    { title: 'Válaszd a „Főképernyőhöz adás” sort!', copy: 'A megnyíló listában keresd ezt a sort. Ha nem látod, görgess lejjebb a listában.', alt: 'A megosztási menüben a Főképernyőhöz adás sor és a plusz ikon van kiemelve.' },
    { title: 'Érintsd meg a „Hozzáadás” gombot!', copy: 'A jobb felső sarokban találod. A Lépés ikonja ezután a telefonod kezdőképernyőjén lesz.', alt: 'A Főképernyőhöz adás ablak jobb felső Hozzáadás gombja van kiemelve.' }
  ]
};
function renderGuide(focus = false) {
  const item = guides[guideDevice][guideStep];
  instructions.innerHTML = `<p class="guide-count">${guideStep + 1}. lépés a 3-ból · ${guideDevice === 'ios' ? 'iPhone vagy iPad' : 'Android telefon'}</p><h3 class="guide-title" tabindex="-1">${item.title}</h3><p class="guide-copy">${item.copy}</p><img class="guide-image" src="./install-${guideDevice}-${guideStep + 1}.svg" width="420" height="210" alt="${item.alt}">`;
  $('guide-android').setAttribute('aria-pressed', String(guideDevice === 'android'));
  $('guide-ios').setAttribute('aria-pressed', String(guideDevice === 'ios'));
  $('guide-back').hidden = guideStep === 0;
  $('guide-next').textContent = guideStep === 2 ? 'Értem, kezdjük' : 'Következő lépés';
  $('install').hidden = !deferredInstall;
  if (focus) {
    instructions.querySelector('h3').focus({ preventScroll: true });
    document.querySelector('.install-content').scrollTop = 0;
  }
}
function showInstall() {
  guideStep = 0; renderGuide();
  if (!dialog.open) dialog.showModal();
  $('install-title').focus({ preventScroll: true });
  document.querySelector('.install-content').scrollTop = 0;
}
function dismissInstall() {
  storage.set('lepes-install-seen', '1'); dialog.close();
  (state === 'idle' ? $('start-walk') : $('main-action')).focus({ preventScroll: true });
}
for (const device of ['android', 'ios']) $('guide-' + device).addEventListener('click', () => { guideDevice = device; guideStep = 0; renderGuide(true); });
$('guide-next').addEventListener('click', () => {
  if (guideStep === 2) dismissInstall();
  else { guideStep++; renderGuide(true); }
});
$('guide-back').addEventListener('click', () => { guideStep = Math.max(0, guideStep - 1); renderGuide(true); });
$('dismiss-install').addEventListener('click', dismissInstall);
dialog.addEventListener('cancel', () => storage.set('lepes-install-seen', '1'));
$('install-help').addEventListener('click', showInstall);
if (!standalone() && !storage.get('lepes-install-seen')) showInstall();
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  const prompt = deferredInstall; deferredInstall = null; $('install').hidden = true;
  try {
    await prompt.prompt(); const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') dismissInstall();
  } catch { /* The illustrated installation steps remain available. */ }
});
window.addEventListener('appinstalled', () => { deferredInstall = null; $('install').hidden = true; dismissInstall(); });

async function checkCache() {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const channel = new MessageChannel();
  const timeout = setTimeout(() => { channel.port1.close(); $('offline-status').textContent = 'Offline állapot nem ellenőrizhető'; }, 7000);
  channel.port1.onmessage = ({ data }) => {
    clearTimeout(timeout); channel.port1.close();
    $('offline-status').textContent = data.ready ? 'Offline használatra kész' : 'Az offline mentés még nem teljes';
  };
  controller.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
}
function showUpdate() {
  const hasUpdate = Boolean(registration?.waiting && navigator.serviceWorker.controller);
  $('update-banner').hidden = !hasUpdate;
  if (hasUpdate) display();
}
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    registration = reg; showUpdate();
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      installing?.addEventListener('statechange', () => { if (installing.state === 'installed') { showUpdate(); checkCache(); } });
    });
    navigator.serviceWorker.ready.then(checkCache);
  }).catch(() => { $('offline-status').textContent = 'Offline mentés nem sikerült'; });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (activationRequested && !reloaded && state === 'idle') { reloaded = true; location.reload(); }
    else { showUpdate(); checkCache(); }
  });
} else $('offline-status').textContent = 'Offline használathoz biztonságos webcím kell';
$('update').addEventListener('click', () => {
  if (state !== 'idle' || !registration?.waiting) return;
  activationRequested = true; registration.waiting.postMessage({ type: 'ACTIVATE' });
});
// Optional agent access reads the same visible walking state; never starts audio without a tap.
try {
  const result = document.modelContext?.registerTool({
    name: 'read_walking_timer', title: 'Séta állapota',
    description: 'Read current pace, remaining seconds, timer state, and configured durations without changing them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('No arguments expected.');
      return { state, fastSeconds: fast, slowSeconds: slow, ...phaseAt(audio.currentTime || 0, fast, slow) };
    }
  });
  Promise.resolve(result).catch(() => {});
} catch { /* Optional browser proposal. */ }
prepare();
