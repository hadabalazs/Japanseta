import { createTrack } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const buffer = createTrack(data.fast, data.slow);
    self.postMessage({ buffer }, [buffer]);
  } catch { self.postMessage({ error: 'A hangot nem sikerült előkészíteni.' }); }
};
