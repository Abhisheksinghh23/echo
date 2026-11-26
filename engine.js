// Echo engine: spectrogram -> peaks -> pair hashes -> offset-vote matching.
// Pure JS, no dependencies. Runs in the browser and in Node (for tests).

export const SR = 8000;        // all audio is reduced to 8 kHz mono
export const N_FFT = 1024;     // window length (128 ms)
export const HOP = 256;        // hop (32 ms)
export const BINS = N_FFT / 2; // 0..4 kHz in 512 bins
export const FRAME_SEC = HOP / SR;

// Peak picking and hashing parameters (kept here so the UI can show them).
export const PARAMS = {
  peakFreqRadius: 10,   // a peak must be the loudest within +-10 bins
  peakTimeRadius: 8,    // and within +-8 frames
  minDb: -62,           // ignore anything this far under the loudest point
  minBin: 6,            // skip the lowest bins (rumble)
  fanOut: 6,            // pairs made per anchor peak
  dtMin: 2,             // target zone: 2..60 frames after the anchor
  dtMax: 60,
  dfMax: 120            // and within +-120 bins in frequency
};

// ---------- FFT ----------
const hann = new Float32Array(N_FFT);
for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1));
const cosT = new Float32Array(N_FFT / 2), sinT = new Float32Array(N_FFT / 2);
for (let i = 0; i < N_FFT / 2; i++) { cosT[i] = Math.cos((2 * Math.PI * i) / N_FFT); sinT[i] = -Math.sin((2 * Math.PI * i) / N_FFT); }
const rev = new Uint16Array(N_FFT);
for (let i = 0, bits = Math.log2(N_FFT); i < N_FFT; i++) {
  let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
  rev[i] = r;
}
function fft(re, im) {
  const n = N_FFT;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cosT[k] - im[b] * sinT[k];
        const ti = re[b] * sinT[k] + im[b] * cosT[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

// ---------- Spectrogram ----------
// Returns { frames, data } where data is a Float32Array frames*BINS of dB values (max = 0).
export function spectrogram(pcm) {
  const frames = Math.max(0, Math.floor((pcm.length - N_FFT) / HOP) + 1);
  const data = new Float32Array(frames * BINS);
  const re = new Float32Array(N_FFT), im = new Float32Array(N_FFT);
  let maxP = 1e-12;
  const pow = new Float32Array(frames * BINS);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = pcm[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < BINS; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      pow[f * BINS + b] = p; if (p > maxP) maxP = p;
    }
  }
  for (let i = 0; i < pow.length; i++) data[i] = 10 * Math.log10(pow[i] / maxP + 1e-12);
  return { frames, data };
}

// ---------- Peaks ----------
// A peak is a point that is the loudest in its neighbourhood and above a floor.
// Returns array of {t, f, db} sorted by t.
export function findPeaks(spec, params = PARAMS) {
  const { frames, data } = spec;
  const { peakFreqRadius: FR, peakTimeRadius: TR, minDb, minBin } = params;
  // Pass 1: max over frequency window for each frame (sliding by brute force, radius is small).
  const fmax = new Float32Array(frames * BINS);
  for (let t = 0; t < frames; t++) {
    for (let b = 0; b < BINS; b++) {
      let m = -1e9;
      const lo = Math.max(0, b - FR), hi = Math.min(BINS - 1, b + FR);
      for (let k = lo; k <= hi; k++) { const v = data[t * BINS + k]; if (v > m) m = v; }
      fmax[t * BINS + b] = m;
    }
  }
  const peaks = [];
  for (let t = 0; t < frames; t++) {
    for (let b = minBin; b < BINS; b++) {
      const v = data[t * BINS + b];
      if (v < minDb) continue;
      if (fmax[t * BINS + b] !== v) continue;
      let ok = true;
      const lo = Math.max(0, t - TR), hi = Math.min(frames - 1, t + TR);
      for (let u = lo; u <= hi; u++) { if (fmax[u * BINS + b] > v) { ok = false; break; } }
      if (ok) peaks.push({ t, f: b, db: v });
    }
  }
  return peaks;
}

// ---------- Hashing ----------
// A hash packs (anchor bin, target bin, time gap) into 24 bits:
// 9 bits + 9 bits + 6 bits. Only the gap, not absolute time, goes into the
// hash, so the same pair matches no matter where in the song a clip starts.
export function hashPair(f1, f2, dt) { return (f1 | (f2 << 9) | (dt << 18)) >>> 0; }

// Returns array of {h, t, a, b} where a, b are the two peaks forming the pair.
export function fingerprint(peaks, params = PARAMS) {
  const out = [];
  const { fanOut, dtMin, dtMax, dfMax } = params;
  for (let i = 0; i < peaks.length; i++) {
    const a = peaks[i];
    let made = 0;
    for (let j = i + 1; j < peaks.length && made < fanOut; j++) {
      const b = peaks[j];
      const dt = b.t - a.t;
      if (dt < dtMin) continue;
      if (dt > dtMax) break;
      if (Math.abs(b.f - a.f) > dfMax) continue;
      out.push({ h: hashPair(a.f, b.f, dt), t: a.t, a, b });
      made++;
    }
  }
  return out;
}

// ---------- Index ----------
export class Index {
  constructor() { this.map = new Map(); this.songs = []; this.hashCount = 0; }
  add(song, pairs) {
    const id = this.songs.length;
    this.songs.push({ id, name: song.name, frames: song.frames, pairs: pairs.length, peaks: song.peaks || 0 });
    for (const p of pairs) {
      let list = this.map.get(p.h);
      if (!list) { list = []; this.map.set(p.h, list); }
      list.push(id, p.t);
    }
    this.hashCount += pairs.length;
    return id;
  }
  clear() { this.map.clear(); this.songs = []; this.hashCount = 0; }
}

// ---------- Matching ----------
// Every query pair that exists in the index votes for (song, songTime - queryTime).
// If the clip really comes from that song, many votes land on the same offset.
export function match(index, queryPairs, opts = {}) {
  const minVotes = opts.minVotes ?? 7;
  const perSong = new Map(); // id -> Map(offset -> {count, hits:[...]})
  let totalHits = 0;
  for (const q of queryPairs) {
    const list = index.map.get(q.h);
    if (!list) continue;
    for (let i = 0; i < list.length; i += 2) {
      const id = list[i], st = list[i + 1];
      const off = st - q.t;
      let m = perSong.get(id);
      if (!m) { m = new Map(); perSong.set(id, m); }
      let e = m.get(off);
      if (!e) { e = { count: 0, hits: [] }; m.set(off, e); }
      e.count++;
      if (e.hits.length < 400) e.hits.push({ q, songTime: st });
      totalHits++;
    }
  }
  const results = [];
  for (const [id, m] of perSong) {
    let best = null, bestOff = 0, total = 0;
    for (const [off, e] of m) { total += e.count; if (!best || e.count > best.count) { best = e; bestOff = off; } }
    // Votes near the best offset (+-1 frame) also count: clips are not frame-aligned.
    let near = 0;
    for (const d of [-1, 0, 1]) { const e = m.get(bestOff + d); if (e) near += e.count; }
    results.push({ id, name: index.songs[id].name, score: near, offset: bestOff, totalHits: total, offsets: m, hits: best.hits });
  }
  results.sort((a, b) => b.score - a.score);
  const top = results[0], second = results[1];
  let verdict = null;
  if (top && top.score >= minVotes) {
    const ratio = second ? top.score / Math.max(1, second.score) : Infinity;
    if (ratio >= 2) verdict = top;
  }
  return { results, verdict, totalHits, queryPairs: queryPairs.length };
}

// ---------- Helpers ----------
export function analyse(pcm, params = PARAMS) {
  const spec = spectrogram(pcm);
  const peaks = findPeaks(spec, params);
  const pairs = fingerprint(peaks, params);
  return { spec, peaks, pairs };
}

// Average-decimate arbitrary-rate mono samples to SR (simple anti-alias box filter).
export function toSR(samples, rate) {
  if (rate === SR) return Float32Array.from(samples);
  const ratio = rate / SR;
  const n = Math.floor(samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * ratio, b = (i + 1) * ratio;
    let s = 0, w = 0;
    for (let k = Math.floor(a); k < Math.ceil(b) && k < samples.length; k++) {
      const wt = Math.min(b, k + 1) - Math.max(a, k);
      s += samples[k] * wt; w += wt;
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}
