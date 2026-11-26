import { analyse, Index, match, SR, FRAME_SEC } from './engine.js';
import { DEMOS, makeDemo, makeTrack } from './synth.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const r = rng(5);
const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

const idx = new Index();
const tracks = DEMOS.map((d) => makeDemo(d));
let t0 = Date.now();
tracks.forEach((pcm, i) => {
  const a = analyse(pcm);
  idx.add({ name: DEMOS[i].name, frames: a.spec.frames, peaks: a.peaks.length }, a.pairs);
  console.log(DEMOS[i].name, 'frames', a.spec.frames, 'peaks', a.peaks.length, 'pairs', a.pairs.length);
});
console.log('index ms', Date.now() - t0, 'hashes', idx.hashCount);

function trial(song, startSec, lenSec, snrDb, gain = 1) {
  const s = Math.floor(startSec * SR), n = Math.floor(lenSec * SR);
  const clip = tracks[song].slice(s, s + n);
  let p = 0; for (const v of clip) p += v * v; p /= clip.length;
  const sigma = Math.sqrt(p / Math.pow(10, snrDb / 10));
  for (let i = 0; i < clip.length; i++) clip[i] = (clip[i] * gain + sigma * gauss());
  const a = analyse(clip);
  const m = match(idx, a.pairs);
  return { m, startSec };
}

for (const snr of [30, 10, 0, -5]) {
  for (const len of [5, 10]) {
    let ok = 0, wrong = 0, none = 0, N = 30, tOff = 0;
    for (let k = 0; k < N; k++) {
      const song = k % 3, start = 1 + r() * (40 - len - 2);
      const { m } = trial(song, start, len, snr, 0.3 + r());
      if (!m.verdict) none++;
      else if (m.verdict.id === song) { ok++; tOff += Math.abs(m.verdict.offset * FRAME_SEC - start); }
      else wrong++;
    }
    console.log(`SNR ${snr} dB, ${len}s: correct ${ok}/${N}, wrong ${wrong}, no-match ${none}, mean start err ${(tOff / Math.max(ok, 1)).toFixed(3)}s`);
  }
}
// unrelated track must give no match
let falsePos = 0;
for (let k = 0; k < 10; k++) {
  const other = makeTrack(9000 + k, 20, 'minor', 100 + k * 5, 180 + k * 7);
  const a = analyse(other.slice(8000, 8000 + 5 * SR));
  const m = match(idx, a.pairs);
  if (m.verdict) falsePos++;
}
console.log('unrelated clips falsely matched:', falsePos, '/ 10');
