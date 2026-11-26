import { SR, N_FFT, HOP, BINS, FRAME_SEC, analyse, spectrogram, Index, match, toSR, PARAMS } from './engine.js';
import { DEMOS, makeDemo } from './synth.js';

const $ = (id) => document.getElementById(id);
const lib = []; // {name, pcm:Float32Array, builtin, id, frames, peaks, pairs}
let index = new Index();
let actx = null;

// ---------- storage (IndexedDB) ----------
const DB = 'echo-library';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'name' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbAll() { try { const d = await db(); return await new Promise((res) => { const q = d.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); }); } catch { return []; } }
async function dbPut(rec) { try { const d = await db(); d.transaction('songs', 'readwrite').objectStore('songs').put(rec); } catch {} }
async function dbDel(name) { try { const d = await db(); d.transaction('songs', 'readwrite').objectStore('songs').delete(name); } catch {} }

const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.max(-1, Math.min(1, f[i])) * 32767; return o; };
const fromI16 = (i) => { const o = new Float32Array(i.length); for (let k = 0; k < i.length; k++) o[k] = i[k] / 32767; return o; };

// ---------- audio decode ----------
function ctx() { return (actx ||= new (window.AudioContext || window.webkitAudioContext)()); }
async function decodeFile(file, maxSec) {
  const buf = await file.arrayBuffer();
  const off = new OfflineAudioContext(1, 1, SR); // decodeAudioData resamples to SR
  const ab = await off.decodeAudioData(buf);
  const n = Math.min(ab.length, maxSec * ab.sampleRate);
  const out = new Float32Array(Math.floor(n));
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < out.length; i++) out[i] += d[i] / ab.numberOfChannels; }
  return ab.sampleRate === SR ? out : toSR(out, ab.sampleRate);
}
function play(pcm) {
  const c = ctx(); c.resume();
  const ab = c.createBuffer(1, pcm.length, SR); ab.copyToChannel(pcm, 0);
  const s = c.createBufferSource(); s.buffer = ab; s.connect(c.destination); s.start();
}

// ---------- library ----------
function addToIndex(song) {
  const a = analyse(song.pcm);
  song.frames = a.spec.frames; song.peaks = a.peaks.length; song.pairs = a.pairs.length;
  song.id = index.add({ name: song.name, frames: song.frames, peaks: song.peaks }, a.pairs);
}
function rebuild() {
  index = new Index();
  for (const s of lib) addToIndex(s);
  renderLib();
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderLib() {
  const el = $('songs'); el.innerHTML = '';
  lib.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'song';
    d.innerHTML = `<div><b></b> <small>${fmt(s.pcm.length / SR)} &middot; ${s.peaks} peaks &middot; ${s.pairs} hashes${s.builtin ? ' &middot; built in' : ''}</small></div>`;
    d.querySelector('b').textContent = s.name;
    const bt = document.createElement('button'); bt.textContent = '▶'; bt.title = 'Play'; bt.onclick = () => play(s.pcm);
    const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = s.builtin ? 'Built-in' : 'Remove'; rm.disabled = s.builtin; rm.style.opacity = s.builtin ? .2 : 1;
    rm.onclick = async () => { await dbDel(s.name); lib.splice(i, 1); rebuild(); fillSelect(); };
    const w = document.createElement('div'); w.append(bt, rm); d.append(w); el.append(d);
  });
  $('libStatus').textContent = `${lib.length} songs, ${index.hashCount.toLocaleString()} hashes indexed`;
}
function fillSelect() {
  const sel = $('cutSong'), cur = sel.value; sel.innerHTML = '';
  lib.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = s.name; sel.append(o); });
  if (cur && lib[cur]) sel.value = cur; updCut();
}
$('addSongs').onchange = async (e) => {
  $('libStatus').textContent = 'Reading songs...';
  for (const f of e.target.files) {
    try {
      const pcm = await decodeFile(f, 480);
      const name = f.name.replace(/\.[^.]+$/, '');
      if (lib.some((s) => s.name === name)) continue;
      lib.push({ name, pcm }); await dbPut({ name, pcm: toI16(pcm).buffer });
    } catch (err) { alert(`Could not read ${f.name}: ${err.message || 'unsupported audio'}`); }
  }
  e.target.value = ''; rebuild(); fillSelect();
};

// ---------- tabs and controls ----------
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  for (const k of ['cut', 'file', 'mic']) $('tab-' + k).hidden = k !== t.dataset.tab;
}));
function cutSong() { return lib[+$('cutSong').value]; }
function updCut() {
  const s = cutSong(); if (!s) return;
  const dur = s.pcm.length / SR, len = +$('cutLen').value;
  $('cutStart').max = Math.max(0, dur - len);
  if (+$('cutStart').value > +$('cutStart').max) $('cutStart').value = $('cutStart').max;
  $('cutStartV').textContent = fmt(+$('cutStart').value); $('cutLenV').textContent = len;
  const nz = +$('cutNoise').value; $('cutNoiseV').textContent = nz >= 30 ? 'clean' : nz + ' dB';
}
['cutSong', 'cutStart', 'cutLen', 'cutNoise'].forEach((id) => ($(id).oninput = updCut));
function gauss() { return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random()); }
function makeCut() {
  const s = cutSong(), st = Math.floor(+$('cutStart').value * SR), n = Math.floor(+$('cutLen').value * SR);
  const clip = s.pcm.slice(st, st + n), nz = +$('cutNoise').value;
  if (nz < 30) {
    let p = 0; for (const v of clip) p += v * v; p /= clip.length || 1;
    const sigma = Math.sqrt(p / Math.pow(10, nz / 10));
    for (let i = 0; i < clip.length; i++) clip[i] += sigma * gauss();
  }
  return { clip, truth: { name: s.name, start: st / SR } };
}
$('cutPlay').onclick = () => play(makeCut().clip);
$('cutGo').onclick = () => { const { clip, truth } = makeCut(); identify(clip, truth); };
$('clipFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return; $('clipName').textContent = f.name;
  try { identify(await decodeFile(f, 20)); } catch (err) { alert('Could not read that clip.'); }
};

// ---------- microphone ----------
$('micGo').onclick = async () => {
  const st = $('micStatus'), btn = $('micGo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    btn.disabled = true; st.textContent = 'Listening...';
    const c = ctx(); await c.resume();
    const src = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const chunks = []; const rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r)); rec.start();
    const cv = $('live'), g = cv.getContext('2d'); g.fillStyle = '#06080c'; g.fillRect(0, 0, cv.width, cv.height);
    const t0 = performance.now(), arr = new Uint8Array(an.frequencyBinCount);
    await new Promise((resolve) => {
      const tick = () => {
        const el = (performance.now() - t0) / 1000; st.textContent = `Listening... ${Math.max(0, 8 - el).toFixed(0)} s`;
        an.getByteFrequencyData(arr);
        const x = Math.min(cv.width - 2, (el / 8) * cv.width);
        for (let y = 0; y < cv.height; y++) { const b = Math.floor((1 - y / cv.height) * (arr.length / 2)); g.fillStyle = heat(arr[b] / 255); g.fillRect(x, y, 3, 1); }
        if (el < 8) requestAnimationFrame(tick); else resolve();
      }; tick();
    });
    rec.stop(); await done; stream.getTracks().forEach((t) => t.stop());
    st.textContent = 'Analysing...';
    const blob = new Blob(chunks); const pcm = await decodeFile(blob, 20);
    st.textContent = ''; btn.disabled = false; identify(pcm);
  } catch (err) { btn.disabled = false; st.textContent = 'Microphone unavailable: ' + (err.message || err.name); }
};

// ---------- drawing ----------
function heat(v) { // 0..1 -> dark blue -> teal -> yellow
  v = Math.max(0, Math.min(1, v));
  const r = Math.floor(255 * Math.pow(v, 2.2)), g = Math.floor(230 * Math.pow(v, 1.3)), b = Math.floor(70 + 120 * Math.sin(Math.PI * Math.min(1, v * 1.1)) * (1 - v * 0.4));
  return `rgb(${r},${g},${b})`;
}
function drawSpec(cv, spec, f0, f1) { // draw frames f0..f1
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = Math.max(1, f1 - f0);
  const img = g.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const fr = Math.min(spec.frames - 1, f0 + Math.floor((x / W) * n));
    for (let y = 0; y < H; y++) {
      const b = Math.floor(((H - 1 - y) / H) * BINS);
      const v = (spec.data[fr * BINS + b] + 70) / 70;
      const c = colorRGB(v), o = (y * W + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
function colorRGB(v) { v = Math.max(0, Math.min(1, v)); return [Math.floor(255 * Math.pow(v, 2.4)), Math.floor(220 * Math.pow(v, 1.5)), Math.floor(40 + 140 * Math.sin(Math.PI * Math.min(1, v * 1.05)) * (1 - v * 0.5))]; }
const px = (cv, t, f0, f1) => ((t - f0) / (f1 - f0)) * cv.width;
const py = (cv, f) => cv.height - (f / BINS) * cv.height;

function drawPeaks(cv, peaks, f0, f1, color, r = 4, lw = 1.5) {
  const g = cv.getContext('2d'); g.strokeStyle = color; g.lineWidth = lw;
  for (const p of peaks) { if (p.t < f0 || p.t > f1) continue; g.beginPath(); g.arc(px(cv, p.t, f0, f1), py(cv, p.f), r, 0, 7); g.stroke(); }
}

// ---------- identify ----------
async function identify(clip, truth) {
  if (!lib.length) return alert('Add at least one song first.');
  if (clip.length < N_FFT * 4) return alert('That clip is too short.');
  const t0 = performance.now();
  const q = analyse(clip);
  const m = match(index, q.pairs);
  const ms = Math.round(performance.now() - t0);
  $('result').hidden = false;
  const v = m.verdict, top = m.results[0];
  const verdict = $('verdict');
  if (v) {
    verdict.className = 'verdict yes';
    verdict.innerHTML = '';
    const b = document.createElement('b'); b.textContent = v.name;
    const sm = document.createElement('small');
    sm.textContent = `Matched with ${v.score} aligned votes. Your clip starts about ${fmt(Math.max(0, v.offset * FRAME_SEC))} (${(v.offset * FRAME_SEC).toFixed(1)} s) into the song.` +
      (truth ? (truth.name === v.name ? ` Correct: the clip was cut from ${truth.name} at ${truth.start.toFixed(1)} s.` : ` Wrong: the clip came from ${truth.name}.`) : '');
    verdict.append('Match: ', b, sm);
  } else {
    verdict.className = 'verdict no';
    verdict.innerHTML = '';
    const sm = document.createElement('small');
    sm.textContent = top ? `Best guess had only ${top.score} aligned vote(s). That is not enough, or too close to the runner-up. The clip may not be in your library, or it is too short or too noisy.` : 'No hash from the clip exists in the library.';
    verdict.append('No confident match', sm);
  }
  $('stats').innerHTML = [
    [q.peaks.length, 'peaks'], [q.pairs.length, 'hashes made'], [m.totalHits.toLocaleString(), 'library hits'], [top ? top.score : 0, 'best aligned votes'], [ms + ' ms', 'time in your browser']
  ].map(([a, b]) => `<div class="stat"><b>${a}</b><span>${b}</span></div>`).join('');

  // step 1
  const c1 = $('cQuery'); drawSpec(c1, q.spec, 0, q.spec.frames); drawPeaks(c1, q.peaks, 0, q.spec.frames, '#ffffff', 4);
  // step 2: sample of pairs
  const c2 = $('cPairs'); const g2 = c2.getContext('2d'); g2.fillStyle = '#06080c'; g2.fillRect(0, 0, c2.width, c2.height);
  g2.strokeStyle = 'rgba(124,240,200,.35)'; g2.lineWidth = 1;
  const stepP = Math.max(1, Math.floor(q.pairs.length / 220));
  for (let i = 0; i < q.pairs.length; i += stepP) { const p = q.pairs[i]; g2.beginPath(); g2.moveTo(px(c2, p.a.t, 0, q.spec.frames), py(c2, p.a.f)); g2.lineTo(px(c2, p.b.t, 0, q.spec.frames), py(c2, p.b.f)); g2.stroke(); }
  drawPeaks(c2, q.peaks, 0, q.spec.frames, '#ffb454', 3, 1.2);
  if (q.pairs[0]) { g2.fillStyle = '#e8ebf3'; g2.font = '13px system-ui'; const p = q.pairs[Math.floor(q.pairs.length / 2)]; g2.fillText(`example hash: pitch ${p.a.f}, pitch ${p.b.f}, gap ${p.b.t - p.a.t} frames -> ${p.h}`, 10, 18); }
  // step 3 bars
  const bars = $('bars'); bars.innerHTML = '';
  const mx = Math.max(1, ...m.results.map((r) => r.score));
  const shown = m.results.slice(0, 6);
  if (!shown.length) bars.textContent = 'No votes.';
  shown.forEach((r, i) => {
    const d = document.createElement('div'); d.className = 'bar' + (v && i === 0 ? ' win' : '');
    d.innerHTML = '<div class="nm"></div><div class="tr"><div class="fl"></div></div><div></div>'; d.children[0].textContent = r.name; d.children[2].textContent = r.score; bars.append(d);
    setTimeout(() => (d.querySelector('.fl').style.width = (r.score / mx) * 100 + '%'), 60 + i * 90);
  });
  // histogram of offsets (top song)
  const ch = $('cHist'), gh = ch.getContext('2d'); gh.fillStyle = '#06080c'; gh.fillRect(0, 0, ch.width, ch.height);
  if (top) {
    const offs = [...top.offsets.entries()]; const lo = Math.min(...offs.map((o) => o[0])), hi = Math.max(...offs.map((o) => o[0]));
    const span = Math.max(1, hi - lo + 1), bins = Math.min(260, span), arr = new Float32Array(bins);
    for (const [o, e] of offs) arr[Math.min(bins - 1, Math.floor(((o - lo) / span) * bins))] += e.count;
    const am = Math.max(...arr), bw = ch.width / bins;
    const wi = Math.min(bins - 1, Math.floor(((top.offset - lo) / span) * bins));
    arr.forEach((a, i) => { const h = (a / am) * (ch.height - 20); gh.fillStyle = i === wi ? '#7cf0c8' : '#4b5877'; gh.fillRect(i * bw, ch.height - h, Math.max(1, bw - 0.5), h); });
    $('offLabel').textContent = `(${top.name})`;
  }
  // step 4: song with window
  const c4 = $('cSong'); const g4 = c4.getContext('2d');
  if (top) {
    const s = lib[top.id], spec = spectrogram(s.pcm);
    drawSpec(c4, spec, 0, spec.frames);
    const f1 = spec.frames, w0 = Math.max(0, top.offset), w1 = Math.min(f1, top.offset + q.spec.frames);
    if (v) { g4.fillStyle = 'rgba(124,240,200,.18)'; g4.fillRect(px(c4, w0, 0, f1), 0, px(c4, w1, 0, f1) - px(c4, w0, 0, f1), c4.height); g4.strokeStyle = '#7cf0c8'; g4.lineWidth = 2; g4.strokeRect(px(c4, w0, 0, f1), 1, px(c4, w1, 0, f1) - px(c4, w0, 0, f1), c4.height - 2); }
    g4.fillStyle = '#7cf0c8';
    for (const h of top.hits) { const t = h.songTime; g4.beginPath(); g4.arc(px(c4, t, 0, f1), py(c4, h.q.a.f), 2.5, 0, 7); g4.fill(); }
    g4.fillStyle = '#fff'; g4.font = '13px system-ui'; g4.fillText(`${s.name} (${fmt(s.pcm.length / SR)})`, 10, 18);
  } else { g4.fillStyle = '#06080c'; g4.fillRect(0, 0, c4.width, c4.height); }
  if (!truth) $('result').scrollIntoView({ behavior: 'smooth' });
}

// ---------- boot ----------
async function boot() {
  $('libStatus').textContent = 'Building demo tracks...';
  await new Promise((r) => setTimeout(r, 20));
  for (const d of DEMOS) lib.push({ name: d.name, pcm: makeDemo(d), builtin: true });
  for (const rec of await dbAll()) lib.push({ name: rec.name, pcm: fromI16(new Int16Array(rec.pcm)) });
  rebuild(); fillSelect();
  window.__echo = { lib, get index() { return index; }, identify, analyse, match };
}
boot();
