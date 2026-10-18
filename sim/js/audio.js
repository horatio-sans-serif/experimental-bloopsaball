// Web Audio side: one voice per ball, and the acoustic path from that voice to
// your ears.
//
// Per ball, in order:
//   voice (formant synth in an AudioWorklet, or your recording)
//   → speaker: high-pass at the speaker's resonance (small speakers have no bass)
//   → amp clipping: the class-D amp runs out of voltage on loud screams
//   → shell: one filter per octave band, cut by the shell's transmission loss
//   → aim: the speaker faces one way inside the core, so the far side is duller
//   → occlusion: furniture between ball and listener muffles it
//   → distance: direct sound falls 6 dB per doubling of distance
//   → 3D panning (HRTF), plus a send into the room's reverb (Sabine RT60)
//
// Calibration: REF_DB dB SPL at the listener = digital full scale. The listening
// volume shifts everything equally, so ratios between balls, distances and the
// room noise stay true.

import { BANDS, rt60, roomConstant } from './materials.js';
import { PACKS } from './packs.js';
import { ClipVoice } from './clipvoice.js';

export const REF_DB = 94;

const WORKLET_TAIL = `
class BloopVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new VoiceCore(sampleRate, (Math.random() * 1e9) | 0);
    this.n = 0;
    this.port.onmessage = e => this.core.command(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    this.core.render(out);
    if ((this.n++ & 7) === 0) this.port.postMessage({ level: this.core.level, now: this.core.now });
    return true;
  }
}
registerProcessor('bloop-voice', BloopVoice);
`;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.recordings = new Map();     // slot -> AudioBuffer
    this.volumeDb = 0;
    this.noiseOn = false;
    this.echoOn = false;           // room reverb: true to the room, but hard rooms smear speech
    this.raw = false;              // hear the voice without the speaker and shell
    this.packs = { kid: {}, adult: {}, text: { kid: {}, adult: {} }, voice: '' };
    this.voices = new Set();
  }

  async start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const src = await fetch('js/voicecore.js').then(r => r.text());
    const code = src.replace(/^export /gm, '') + WORKLET_TAIL;
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    // Output: a limiter so a pile of screaming balls cannot hurt anyone's ears.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.limiter.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.connect(this.limiter);
    this.reverb = ctx.createConvolver();
    this.reverb.normalize = false;
    this.reverb.connect(this.out);
    // Background noise of the scene, at its real level.
    this.noise = ctx.createBufferSource();
    this.noise.buffer = makeBabble(ctx);
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseGain).connect(this.out);
    this.noise.start();
    await this.loadPacks();
    this.ready = true;
    this.setVolume(this.volumeDb);
    if (this.scene) this.setScene(this.scene);
  }

  // The recorded starter pack: sim/packs/manifest.json lists every clip.
  async loadPacks() {
    try {
      const m = await fetch('packs/manifest.json').then(r => r.json());
      this.packs.voice = m.voice;
      for (const [pack, entries] of Object.entries(m.packs)) {
        await Promise.all(Object.entries(entries).map(async ([id, e]) => {
          const buf = await fetch('packs/' + e.file).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
          this.packs[pack][id] = buf;
          this.packs.text[pack][id] = e.text;
        }));
      }
    } catch (e) { console.warn('No recorded voice pack loaded', e); }
  }

  setVolume(db) {
    this.volumeDb = db;
    if (this.out) this.out.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.05);
  }

  setScene(scene) {
    this.scene = scene;
    if (!this.ready) return;
    this.reverb.buffer = scene.room ? makeImpulse(this.ctx, rt60(scene.room)) : null;
    this.updateNoise();
  }
  setNoise(on) { this.noiseOn = on; this.updateNoise(); }
  updateNoise() {
    if (!this.ready || !this.scene) return;
    const g = this.noiseOn ? Math.pow(10, (this.scene.noiseDBA - REF_DB) / 20) : 0;
    this.noiseGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.2);
  }

  setListener(pos, fwd, up) {
    if (!this.ready) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos[0], t, 0.02); L.positionY.setTargetAtTime(pos[1], t, 0.02); L.positionZ.setTargetAtTime(pos[2], t, 0.02);
      L.forwardX.setTargetAtTime(fwd[0], t, 0.02); L.forwardY.setTargetAtTime(fwd[1], t, 0.02); L.forwardZ.setTargetAtTime(fwd[2], t, 0.02);
      L.upX.setTargetAtTime(up[0], t, 0.02); L.upY.setTargetAtTime(up[1], t, 0.02); L.upZ.setTargetAtTime(up[2], t, 0.02);
    } else {
      L.setPosition(...pos); L.setOrientation(...fwd, ...up);
    }
  }

  createVoice() {
    const v = new BallVoice(this);
    this.voices.add(v);
    return v;
  }
}

export class BallVoice {
  constructor(engine) {
    this.engine = engine;
    const ctx = engine.ctx;
    this.node = new AudioWorkletNode(ctx, 'bloop-voice', { outputChannelCount: [1] });
    this.level = 0;
    this.now = { kind: 'rest', text: '' };          // what the voice is producing right now
    this.style = 'recorded';                          // 'recorded' (clips) or 'spirit' (synth)
    this.node.port.onmessage = e => { if (this.style !== 'spirit') return; this.level = e.data.level; if (!this.oneShot && !this.loop) this.now = e.data.now; };
    this.cv = new ClipVoice();
    this.cur = null;                                  // the clip source playing now
    this.meter = ctx.createAnalyser(); this.meter.fftSize = 512;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.samples = ctx.createGain();
    this.mix = ctx.createGain();
    this.node.connect(this.mix); this.samples.connect(this.mix);
    this.mix.connect(this.meter);
    this.speaker = ctx.createBiquadFilter(); this.speaker.type = 'highpass';
    this.clip = ctx.createWaveShaper(); this.clip.curve = softClipCurve(); this.clip.oversample = '2x';
    this.drive = ctx.createGain();
    this.eq = BANDS.map(f => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.4; return b; });
    this.aim = ctx.createBiquadFilter(); this.aim.type = 'highshelf'; this.aim.frequency.value = 2500;
    this.occ = ctx.createBiquadFilter(); this.occ.type = 'lowpass'; this.occ.frequency.value = 20000;
    this.dry = ctx.createGain(); this.wet = ctx.createGain();
    this.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0, refDistance: 1, maxDistance: 10000 });
    let n = this.mix.connect(this.speaker).connect(this.drive).connect(this.clip);
    for (const b of this.eq) n = n.connect(b);
    n.connect(this.aim).connect(this.occ);
    this.occ.connect(this.dry).connect(this.panner).connect(engine.out);
    this.occ.connect(this.wet).connect(engine.reverb);
    this.loop = null;
    this.caption = null;
    this.setStyle('recorded');
  }

  // Switch between the recorded voice (default) and the synth ("11th dimension").
  setStyle(style) {
    this.style = style === 'spirit' ? 'spirit' : 'recorded';
    const post = m => this.node.port.postMessage(m);
    if (this.style === 'spirit') {
      this.stopClip();
      post({ type: 'voice', style: 'spirit' });
      post({ type: 'silence', on: !!this.persona?.asleep });
    } else {
      post({ type: 'silence', on: true }); post({ type: 'sustainStop' }); post({ type: 'say', ph: '_:20', interrupt: true });
      this.stopLoop();
      this.cv = new ClipVoice();
      this.now = { kind: 'rest', text: '' };
    }
  }

  // Which recording plays for a slot: yours (if "use my recordings" is on),
  // then the adult pack (if adult words are on), then the kid pack.
  clipFor(slot, persona) {
    const P = this.engine.packs, rec = this.engine.recordings;
    const label = P.text.kid[slot] ?? PACKS.kid.phrases[slot]?.text ?? slot;
    if (persona?.mine && rec.has(slot)) return { buf: rec.get(slot), text: `${label} (your voice)` };
    if (persona?.adult && P.adult[slot]) return { buf: P.adult[slot], text: P.text.adult[slot] };
    if (P.kid[slot]) return { buf: P.kid[slot], text: label };
    return null;
  }

  runClip(a) {
    if (!a) return;
    const ctx = this.engine.ctx;
    if (a.type === 'stop') { this.stopClip(); return; }
    const c = this.clipFor(a.slot, this.persona);
    if (!c) { this.cv.ended(ctx.currentTime); return; }
    if (this.cur) { const old = this.cur; this.cur = null; try { old.stop(); } catch { } }
    const s = ctx.createBufferSource(); s.buffer = c.buf; s.playbackRate.value = a.rate;
    const g = ctx.createGain(); g.gain.value = 0.9 * (a.gain ?? 1);
    s.connect(g).connect(this.samples); s.start();
    this.cur = s;
    this.now = { kind: a.kind, text: c.text };
    this.caption = { text: c.text, t: performance.now(), loud: a.gain };
    s.onended = () => { if (this.cur === s) { this.cur = null; this.now = { kind: 'rest', text: '' }; this.cv.ended(ctx.currentTime); } };
  }
  stopClip() { if (this.cur) { try { this.cur.stop(); } catch { } } }

  // Called every frame: start the next clip if it is time, and meter the level.
  tick() {
    if (this.style === 'spirit') return;
    this.runClip(this.cv.tick(this.engine.ctx.currentTime));
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let e = 0; for (const x of this.meterBuf) e += x * x;
    this.level = Math.sqrt(e / this.meterBuf.length);
  }

  // With engine.raw on, the speaker and shell filters go flat so you hear the
  // voice itself, as if it were not inside a ball.
  applyDesign(d) {
    const t = this.engine.ctx.currentTime, raw = this.engine.raw;
    this.speaker.frequency.setTargetAtTime(raw ? 20 : d.spk.fRes, t, 0.02);
    this.speaker.Q.value = raw ? 0.7 : 1.0;
    d.tl.forEach((tl, i) => this.eq[i].gain.setTargetAtTime(raw ? 0 : -tl, t, 0.02));
    this.maxDb10 = d.spk.sens + 10 * Math.log10(d.ampW);   // full-scale sine at 10 cm
    this.drive.gain.value = 0.5;      // unity small-signal gain through the 2× clip curve
  }

  // geometry: {dist, blocked, facing (-1..1), faceDown, outdoor, room}
  place(pos, geom) {
    this.tick();
    const t = this.engine.ctx.currentTime;
    const p = this.panner;
    if (p.positionX) { p.positionX.setTargetAtTime(pos[0], t, 0.02); p.positionY.setTargetAtTime(pos[1], t, 0.02); p.positionZ.setTargetAtTime(pos[2], t, 0.02); }
    else p.setPosition(...pos);
    const r = Math.max(0.1, geom.dist);
    // A full-scale sine (rms 0.707) at 10 cm is maxDb10; REF_DB at the ear is full scale.
    let directDb = this.maxDb10 - 20 * Math.log10(r / 0.1) - 12 * Math.min(2, geom.blocked) - REF_DB;
    if (!geom.room) directDb += 3;
    this.dry.gain.setTargetAtTime(Math.pow(10, directDb / 20), t, 0.03);
    const wetDb = geom.room ? this.maxDb10 - 9 + 10 * Math.log10(4 / roomConstant(geom.room)) - REF_DB : -120;
    this.wet.gain.setTargetAtTime(this.engine.echoOn ? Math.pow(10, wetDb / 20) : 0, t, 0.05);
    this.occ.frequency.setTargetAtTime(geom.blocked ? 1200 : geom.faceDown ? 2500 : 20000, t, 0.05);
    this.aim.gain.setTargetAtTime(-3 * (1 - geom.facing) - (geom.faceDown ? 6 : 0), t, 0.05);
  }

  // A persona message: style changes here; everything else goes to the
  // recorded voice's scheduler, or to the synth in "11th dimension" style.
  command(cmd, persona) {
    this.persona = persona;
    if (cmd.type === 'voice') { this.setStyle(cmd.style); return; }
    if (this.style !== 'spirit') { this.runClip(this.cv.command(cmd, this.engine.ctx.currentTime)); return; }
    this.synthCommand(cmd, persona);
  }

  synthCommand(cmd, persona) {
    const rec = this.engine.recordings;
    const phrases = (persona.adult ? PACKS.adult : PACKS.kid).phrases;
    const now = performance.now();
    if (cmd.type === 'say') {
      const ph = phrases[cmd.slot];
      const buf = persona.mine ? rec.get(cmd.slot) : null;
      this.caption = { text: persona.mine && buf ? `“${ph?.text ?? cmd.slot}” (your voice)` : ph?.text ?? cmd.slot, t: now, loud: cmd.gain };
      if (buf) {
        this.playBuffer(buf, cmd.gain, cmd.interrupt);
        this.node.port.postMessage({ type: 'say', ph: `_:${Math.round(buf.duration * 1000)}`, interrupt: true });
      } else if (ph) {
        this.node.port.postMessage({ type: 'say', ph: ph.ph, text: ph.text, f0: ph.f0, loud: ph.loud ?? 0.9, gain: cmd.gain, pitch: cmd.pitch, interrupt: cmd.interrupt });
      }
    } else if (cmd.type === 'sustainStart') {
      const buf = persona.mine ? rec.get(cmd.kind) : null;
      const label = { scream: phrases.scream.text, whee: phrases.whee.text, dizzy: phrases.dizzy.text }[cmd.kind];
      this.caption = { text: label, t: now, loud: 1, sustain: true };
      if (buf) { this.startLoop(buf); this.now = { kind: 'sustain', text: label + ' (your voice)' }; }
      else this.node.port.postMessage({ ...cmd, text: label });
    } else if (cmd.type === 'sustain') {
      if (this.loop) this.loop.playbackRate.setTargetAtTime(cmd.f0 / (cmd.kind === 'scream' ? 2.2 : 1.4), this.engine.ctx.currentTime, 0.05);
      else this.node.port.postMessage(cmd);
      if (this.caption?.sustain) this.caption.t = now;
    } else if (cmd.type === 'sustainStop') {
      this.stopLoop();
      this.node.port.postMessage(cmd);
      if (this.caption?.sustain) this.caption.sustain = false;
    } else {
      this.node.port.postMessage(cmd);
    }
  }

  // Recordings follow the same one-at-a-time rule as the synth voice.
  playBuffer(buf, gain = 1, interrupt = true) {
    const ctx = this.engine.ctx;
    if (!interrupt && (this.oneShot || this.loop)) return;
    this.stopLoop();
    if (this.oneShot) { try { this.oneShot.stop(); } catch { } }
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.9 * gain;
    s.connect(g).connect(this.samples); s.start();
    this.oneShot = s;
    this.now = { kind: 'phrase', text: this.caption?.text ?? '' };
    s.onended = () => { if (this.oneShot === s) this.oneShot = null; };
  }
  startLoop(buf) {
    this.stopLoop();
    if (this.oneShot) { try { this.oneShot.stop(); } catch { } this.oneShot = null; }
    const s = this.engine.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.connect(this.samples); s.start();
    this.loop = s;
  }
  stopLoop() { if (this.loop) { try { this.loop.stop(); } catch { } this.loop = null; } }

  dispose() {
    this.stopLoop(); this.stopClip();
    try { this.node.disconnect(); this.panner.disconnect(); this.wet.disconnect(); } catch { }
    this.engine.voices.delete(this);
  }
}

function softClipCurve() {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(2 * x); }   // input ±1 = signal ±2
  return c;
}

// Exponentially decaying noise, brighter early and darker late, with the RT60
// from Sabine's formula. Normalized to unit energy so the send gain alone sets
// the reverberant level.
function makeImpulse(ctx, rt) {
  const sr = ctx.sampleRate, len = Math.floor(sr * Math.min(4, rt * 1.2 + 0.05));
  const buf = ctx.createBuffer(2, len, sr);
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.pow(10, (-60 * t / rt) / 20);
      const k = 0.15 + 0.8 * Math.exp(-t / (rt * 0.4));      // air absorbs highs as it rings
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env * (t < 0.008 ? t / 0.008 : 1);
      energy += d[i] * d[i];
    }
  }
  const s = 1 / Math.sqrt(energy / 2);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= s; }
  return buf;
}

// Room noise: pink-ish noise shaped like muffled talking (230 Hz–1.1 kHz, swelling at syllable rate),
// scaled to rms 0.707 so its gain sets its level in dB.
function makeBabble(ctx) {
  const sr = ctx.sampleRate, len = sr * 6;
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, hp = 0, prev = 0, lp1 = 0, lp2 = 0, env = 0.5, envT = 0.5, sum = 0;
    const a = 1 - Math.exp(-2 * Math.PI * 1100 / sr);   // two low-passes: muffled voices, not hiss
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w;
      const pink = b0 + b1 + b2 + 0.02 * w;
      hp = 0.97 * (hp + pink - prev); prev = pink;
      lp1 += a * (hp - lp1); lp2 += a * (lp1 - lp2);
      if (i % Math.floor(sr / 6) === 0) envT = 0.25 + Math.random() * 1.0;   // syllable-rate swell
      env += (envT - env) * 0.0015;
      d[i] = lp2 * env;
      sum += d[i] * d[i];
    }
    const s = 0.707 / Math.sqrt(sum / len);
    for (let i = 0; i < len; i++) d[i] *= s;
    // Crossfade the ends so the loop has no click.
    const xf = 2000;
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[len - xf + i] * (1 - a); }
  }
  return buf;
}

// ---------- recording your own voice ----------

export async function recordClip(ctx, maxMs = 3500, onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const arr = new Float32Array(an.fftSize);
  let raf;
  const meter = () => { an.getFloatTimeDomainData(arr); onLevel?.(Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length)); raf = requestAnimationFrame(meter); };
  meter();
  const done = new Promise(res => { rec.onstop = res; });
  rec.start();
  const handle = { stop: () => rec.state !== 'inactive' && rec.stop() };
  const timer = setTimeout(handle.stop, maxMs);
  handle.result = done.then(async () => {
    clearTimeout(timer); cancelAnimationFrame(raf);
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType });
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return trimSilence(ctx, buf);
  });
  return handle;
}

function trimSilence(ctx, buf) {
  const d = buf.getChannelData(0), th = 0.02;
  let a = 0, b = d.length - 1;
  while (a < b && Math.abs(d[a]) < th) a++;
  while (b > a && Math.abs(d[b]) < th) b--;
  a = Math.max(0, a - Math.floor(0.02 * buf.sampleRate));
  b = Math.min(d.length - 1, b + Math.floor(0.05 * buf.sampleRate));
  const out = ctx.createBuffer(1, Math.max(1, b - a), buf.sampleRate);
  out.getChannelData(0).set(d.subarray(a, b));
  return out;
}

// 16-bit mono WAV at 22.05 kHz, the format the firmware reads from the SD card.
export async function toWav(buf) {
  const sr = 22050;
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * sr), sr);
  const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
  const r = await off.startRendering();
  const pcm = r.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return new Blob([out], { type: 'audio/wav' });
}

// Recordings persist in this browser only (IndexedDB), as WAV blobs.
const DB = 'bloopsaball', STORE = 'recordings';
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveRecording(slot, blob) {
  try { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); blob ? tx.objectStore(STORE).put(blob, slot) : tx.objectStore(STORE).delete(slot); } catch { }
}
export async function loadRecordings(ctx) {
  const out = new Map();
  try {
    const db = await openDb();
    const keys = await new Promise(res => { const r = db.transaction(STORE).objectStore(STORE).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
    for (const k of keys) {
      const blob = await new Promise(res => { const r = db.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
      if (blob) out.set(k, await ctx.decodeAudioData(await blob.arrayBuffer()));
    }
  } catch { }
  return out;
}
