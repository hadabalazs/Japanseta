export const SAMPLE_RATE = 16000;
export function validateDurations(fast, slow) {
  if (![fast, slow].every(n => Number.isInteger(n) && n >= 10 && n <= 900)) {
    throw new RangeError('Érvénytelen időtartam.');
  }
}
export function phaseAt(position, fast, slow) {
  validateDurations(fast, slow);
  const time = ((position % (fast + slow)) + fast + slow) % (fast + slow);
  const isFast = time < fast;
  const elapsed = isFast ? time : time - fast;
  const duration = isFast ? fast : slow;
  return { phase: isFast ? 'fast' : 'slow', remaining: Math.ceil(duration - elapsed), progress: elapsed / duration };
}
export function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
// A single PCM track contains both cues; the media engine loops it without JS callbacks.
export function createTrack(fast, slow, preview = false) {
  if (!preview) validateDurations(fast, slow);
  const length = preview ? 4 : fast + slow;
  const samples = length * SAMPLE_RATE;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  function tone(start, duration, hz) {
    const count = Math.floor(duration * SAMPLE_RATE);
    const offset = Math.floor(start * SAMPLE_RATE);
    for (let i = 0; i < count && offset + i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.min(1, t / .025, (duration - t) / .06);
      const value = .55 * envelope * Math.sin(2 * Math.PI * hz * t);
      view.setInt16(44 + (offset + i) * 2, Math.round(value * 32767), true);
    }
  }
  tone(0, .22, 880); tone(.38, .22, 880);
  tone(preview ? 2 : fast, .85, 440);
  return buffer;
}
