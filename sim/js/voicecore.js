// The ball's voice: a tiny formant synthesizer, cheap enough for an ESP32-S3.
//
// Layer 1 — source: a buzzing sawtooth at the pitch (f0), like vocal folds,
//   plus hiss for breath and for consonants like "sh" and "f".
// Layer 2 — filter: three resonators (formants F1, F2, F3) shape the buzz into
//   a vowel. "ee" is F1 270 / F2 2290 Hz; "ah" is 730 / 1090 Hz. Sliding the
//   formants from one vowel to the next is what makes "uh-ah… oh-um" sound
//   like a mouth.
// Layer 3 — sequencer: plays phrases (lists of phonemes with durations), or a
//   sustained scream/whee steered live. When idle it murmurs: one unbroken
//   voice whose mouth glides from vowel to vowel ("uh-ah-oh-mm"), swells and
//   fades at syllable speed, drifts in pitch, falls at the end of each breath
//   (or rises, like a question), and pauses to inhale. Mood sets its speed,
//   pitch, shakiness and how short the breaths get.
//
// Two styles. "human" (default): the murmur is mostly a closed-mouth hum that
// opens a little to "uh" or "oh"; the buzz is low-passed like a real throat
// (dull when quiet, brighter when loud); formants are wider so they ring less;
// wobble and vibrato are small. "spirit" (the 11th-dimension voice): bright raw
// buzz, wide random jumps between vowels, deep swells.
//
// Runs inside an AudioWorklet in the sim (this file is loaded as text and
// registered there) and in node tests. No imports, no DOM.

const PH = {
  a: { f: [730, 1090, 2440], v: 1 },
  ae: { f: [660, 1720, 2410], v: 1 },
  e: { f: [530, 1840, 2480], v: 1 },
  i: { f: [270, 2290, 3010], v: 1 },
  o: { f: [570, 840, 2410], v: 1 },
  u: { f: [300, 870, 2240], v: 1 },
  '@': { f: [500, 1500, 2500], v: 1 },
  er: { f: [490, 1350, 1690], v: 1 },
  m: { f: [250, 1000, 2200], v: 0.3, bw: 2 },
  n: { f: [250, 1700, 2600], v: 0.3, bw: 2 },
  w: { f: [300, 610, 2200], v: 0.7 },
  y: { f: [280, 2250, 2900], v: 0.7 },
  l: { f: [360, 1300, 2700], v: 0.7 },
  r: { f: [420, 1300, 1600], v: 0.7 },
  v: { f: [220, 1100, 2080], v: 0.35, n: 0.25, nf: 3500, nq: 1.2 },
  h: { f: null, v: 0, n: 0.35, asp: true },
  in: { f: [750, 1250, 2550], v: 0, n: 0.6, asp: true },     // a sharp inhale (gasp)
  sh: { f: null, v: 0, n: 0.8, nf: 2600, nq: 1.6 },
  s: { f: null, v: 0, n: 0.6, nf: 6000, nq: 2.5 },
  f: { f: null, v: 0, n: 0.3, nf: 4200, nq: 0.9 },
  p: { stop: true, nf: 1000 }, b: { stop: true, nf: 900, voiced: true },
  t: { stop: true, nf: 4000 }, d: { stop: true, nf: 3500, voiced: true },
  k: { stop: true, nf: 2000 }, g: { stop: true, nf: 1800, voiced: true },
  _: { f: null, v: 0 },
};

// Vowels the murmur glides between: calm stays low and round, nervous adds bright ones.
const MURMUR_VOWELS = { calm: ['@', 'a', 'o', 'm', 'u', 'm', '@'], nervous: ['@', 'a', 'o', 'm', 'e', 'u', 'm', 'i'] };
const VOWEL_GAIN = { i: 2.4, u: 1.9, y: 1.8, w: 1.5, er: 1.3 };
// Human murmur: weighted toward the hum; the mouth only half-opens toward a vowel.
const HUM_VOWELS = { calm: ['m', 'm', 'm', 'm', 'n', '@', '@', 'o'], nervous: ['m', 'm', 'm', '@', '@', 'a', 'o', 'n', 'e'] };
const MOUTH_OPEN = 0.5;                  // fraction of the way from "uh" to the full vowel shape
const STYLE = {
  human: { bw: [100, 140, 210], jitter: 0.5, vibBase: 0.004, vibAnx: 0.012, amDepth: 0.2, amRate: 1.3, fall: 0.08, rise: 0.5, pitchSpan: 0.5 },
  spirit: { bw: [80, 110, 170], jitter: 1, vibBase: 0.008, vibAnx: 0.03, amDepth: 0.5, amRate: 1.9, fall: 0.12, rise: 0.9, pitchSpan: 1 },
};

// How each phoneme is written in captions, so the screen shows what is being said.
const SPELL = { a: 'ah', ae: 'aa', e: 'eh', i: 'ee', o: 'oh', u: 'oo', '@': 'uh', er: 'rr', m: 'mm', n: 'n', w: 'w', y: 'y', l: 'l', r: 'r', v: 'v', h: 'h', in: 'hhh', sh: 'sh', s: 's', f: 'f', p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g', _: '… ' };
export const spell = segs => segs.map(s => SPELL[s.p] ?? '').join('').replace(/(…\s*)+$/, '').trim();

export function parsePhonemes(str) {
  return str.trim().split(/\s+/).map(tok => {
    const [p, ms] = tok.split(':');
    return { p: PH[p] ? p : '@', ms: +ms || 100 };
  });
}

export class VoiceCore {
  constructor(sr = 48000, seed = 7) {
    this.sr = sr;
    this.T = 1 / sr;
    this.seed = seed >>> 0 || 7;
    this.basePitch = 230;          // Hz, a small creature
    this.tract = 1.18;             // formant scale: shorter vocal tract than an adult
    this.phase = 0;
    // Smoothed synthesis parameters (current) and their targets.
    this.cur = { F1: 500, F2: 1500, F3: 2500, bw: 1, voice: 0, noise: 0, nf: 3000, nq: 1, f0: 1, loud: 0, rough: 0, vib: 0, wob: 0 };
    this.tgt = { ...this.cur };
    this.res = [0, 0, 0, 0].map(() => ({ y1: 0, y2: 0 }));
    this.nres = { y1: 0, y2: 0 };
    this.queue = [];               // phrases waiting: [{segs, f0, loud}]
    this.seg = null;               // current segment
    this.mode = 'murmur';
    this.murmur = { on: true, rate: 1, f0: 1, loud: 0.25, jitter: 0.02, breath: 0.1, style: 'calm' };
    this.sustain = null;
    this.jit = 0; this.t = 0; this.vibPh = 0; this.wobPh = 0; this.subPh = 0;
    this.level = 0;
    this.silenced = false;
    this.gainOut = 0.22;
    this.murPitch = 1;             // murmur pitch wanders slowly, so it sounds like one speaker
    this.dr = { vowel: '@', vowelIn: 0, breathing: true, breathLeft: 0.3, uttT: 0, uttLen: 2, question: false, amPh: 0, trail: [] };
    this.now = { kind: 'rest', text: '' };
    this.style = 'human';
    this.glp = 0;                  // throat low-pass state (human style)
  }

  rand() { let s = this.seed; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; this.seed = s; return s / 4294967296; }

  command(m) {
    if (m.type === 'murmur') Object.assign(this.murmur, m);
    else if (m.type === 'say') {
      // One sound at a time: an interrupting line replaces whatever is playing; a
      // polite one replaces only murmur, and is dropped if a line is already playing.
      const segs = parsePhonemes(m.ph);
      const phrase = { segs, text: m.text || spell(segs), f0: m.f0 || [1, 1], loud: (m.loud ?? 0.9) * (m.gain ?? 1), pitch: m.pitch || 1 };
      const busy = (this.seg && this.seg.kind === 'phrase') || this.queue.length > 0;
      if (m.interrupt) { this.queue = [phrase]; this.seg = null; }
      else if (!busy) { this.queue = [phrase]; if (this.seg && this.seg.kind === 'murmur') this.seg = null; }
    } else if (m.type === 'sustainStart') {
      this.sustain = { kind: m.kind, text: m.text || m.kind, f0: m.kind === 'scream' ? 2.2 : m.kind === 'whee' ? 1.4 : 0.9, loud: 0.9, wobble: 0, onset: m.onset };
      if (m.onset && m.kind === 'whee') this.queue.push({ segs: parsePhonemes('w:90'), text: this.sustain.text, f0: [1.3, 1.4], loud: 0.8, pitch: 1 });
      if (this.seg && this.seg.kind !== 'phrase') this.seg = null;
    } else if (m.type === 'sustain') {
      if (this.sustain) Object.assign(this.sustain, { f0: m.f0, loud: m.loud, wobble: m.wobble || 0 });
    } else if (m.type === 'sustainStop') {
      this.sustain = null;
      if (this.seg && this.seg.kind === 'sustain') this.seg = null;
    } else if (m.type === 'silence') {
      this.silenced = m.on;
    } else if (m.type === 'voice') {
      if (m.basePitch) this.basePitch = m.basePitch;
      if (m.tract) this.tract = m.tract;
      if (m.style && STYLE[m.style]) this.style = m.style;
    }
  }

  // Decide what to play next and set targets.
  nextSegment() {
    if (this.queue.length) {
      const ph = this.queue[0];
      if (!ph.done) this.now = { kind: 'phrase', text: ph.text || '' };
      const s = ph.segs.shift();
      const total = ph.total || (ph.total = ph.segs.reduce((a, b) => a + b.ms, 0) + s.ms);
      ph.done = (ph.done || 0);
      const frac0 = ph.done / total;
      ph.done += s.ms;
      const frac1 = ph.done / total;
      if (!ph.segs.length) this.queue.shift();
      this.seg = { kind: 'phrase', p: s.p, n: Math.round(s.ms * this.sr / 1000), i: 0, f0a: ph.f0[0] + (ph.f0[1] - ph.f0[0]) * frac0, f0b: ph.f0[0] + (ph.f0[1] - ph.f0[0]) * frac1, pitch: ph.pitch, loud: ph.loud };
    } else if (this.sustain) {
      const s = this.sustain;
      const p = s.kind === 'scream' ? (this.rand() < 0.5 ? 'a' : 'ae') : s.kind === 'whee' ? 'i' : (this.rand() < 0.5 ? 'u' : 'o');
      this.seg = { kind: 'sustain', p, n: Math.round(0.25 * this.sr), i: 0 };
      this.now = { kind: 'sustain', text: s.text };
    } else if (this.murmur.on && !this.silenced) {
      // Murmur runs in 20 ms control ticks; the sound itself never stops between them.
      this.seg = { kind: 'murmur', p: this.dr.vowel, n: Math.round(0.02 * this.sr), i: 0 };
      this.murmurTick(0.02);
      return;
    } else {
      this.seg = { kind: 'rest', p: '_', n: Math.round(0.05 * this.sr), i: 0 };
      this.now = { kind: 'rest', text: '' };
    }
    this.applyTargets();
  }

  // Steer the continuous murmur: pick the next vowel to glide to, end a breath
  // group and inhale, start the next one. Called every 20 ms.
  murmurTick(dt) {
    const d = this.dr, m = this.murmur, tg = this.tgt, k = this.tract;
    const anx = Math.max(0, Math.min(1, (m.f0 - 1) / 0.55));
    const rate = Math.max(0.8, Math.min(2.6, m.rate));
    this.murPitch = Math.max(0.9, Math.min(1.12, this.murPitch + (this.rand() - 0.5) * 0.012));
    if (d.breathing) {
      d.breathLeft -= dt;
      const inh = PH.in.f;
      tg.F1 = inh[0] * k; tg.F2 = inh[1] * k; tg.F3 = inh[2] * k; tg.bw = 1;
      tg.voice = 0; tg.noise = 0.08 + 0.3 * anx; tg.nf = tg.F2; tg.nq = 0.7;
      this.seg.gain = 1;
      if (d.breathLeft <= 0) {
        d.breathing = false; d.uttT = 0; d.vowelIn = 0;
        d.uttLen = (1.2 + 2.8 * this.rand()) * (1 - 0.45 * anx);
        d.question = this.rand() < 0.25 + 0.35 * anx;
        d.trail.push('…');
      }
    } else {
      d.uttT += dt; d.vowelIn -= dt;
      const human = this.style === 'human';
      if (d.vowelIn <= 0) {
        const set = (human ? HUM_VOWELS : MURMUR_VOWELS)[anx > 0.45 ? 'nervous' : 'calm'];
        let v = d.vowel;
        // The hum may hold (repeat) in human style; the spirit always jumps.
        if (human) v = set[Math.floor(this.rand() * set.length)];
        else while (v === d.vowel) v = set[Math.floor(this.rand() * set.length)];
        if (v !== d.vowel || !human) d.trail.push(SPELL[v]);
        d.vowel = v; d.vowelIn = (human ? 0.3 + 0.5 * this.rand() : 0.22 + 0.4 * this.rand()) / rate;
      }
      const ph = PH[d.vowel];
      if (human && ph.f && d.vowel !== 'm' && d.vowel !== 'n') {
        const c0 = PH['@'].f;
        tg.F1 = (c0[0] + (ph.f[0] - c0[0]) * MOUTH_OPEN) * k;
        tg.F2 = (c0[1] + (ph.f[1] - c0[1]) * MOUTH_OPEN) * k;
        tg.F3 = (c0[2] + (ph.f[2] - c0[2]) * MOUTH_OPEN) * k;
      } else { tg.F1 = ph.f[0] * k; tg.F2 = ph.f[1] * k; tg.F3 = ph.f[2] * k; }
      tg.bw = ph.bw || 1;
      // A hum is the main sound in human style, so it is voiced fully, not as a consonant.
      tg.voice = human && (d.vowel === 'm' || d.vowel === 'n') ? 0.8 : ph.v; tg.noise = 0;
      this.seg.gain = (human && (d.vowel === 'm' || d.vowel === 'n')) ? 1.6 : (VOWEL_GAIN[d.vowel] || 1);
      if (d.uttT >= d.uttLen) { d.breathing = true; d.breathLeft = (0.25 + 0.45 * this.rand()) * (1 - 0.5 * anx); }
    }
    while (d.trail.length > 7) d.trail.shift();
    const st = STYLE[this.style];
    tg.rough = 0; tg.vib = st.vibBase + st.vibAnx * anx;
    this.now = { kind: 'murmur', text: d.trail.join('-').replace(/-?…-?/g, '… ').trim() };
  }

  applyTargets() {
    const s = this.seg, ph = PH[s.p], k = this.tract, tg = this.tgt;
    if (ph.f) { tg.F1 = ph.f[0] * k; tg.F2 = ph.f[1] * k; tg.F3 = ph.f[2] * k; }
    tg.bw = ph.bw || 1;
    tg.voice = ph.stop ? 0 : (ph.v ?? 0);
    tg.noise = ph.n || 0;
    if (ph.nf) { tg.nf = ph.nf; tg.nq = ph.nq || 1.5; }
    if (ph.asp) { tg.nf = tg.F2; tg.nq = 0.7; }
    s.stop = !!ph.stop;
    // Close vowels (low F1) come out of the cascade quieter; even them up.
    s.gain = { i: 2.4, u: 1.9, y: 1.8, w: 1.5, er: 1.3 }[s.p] || 1;
    if (s.kind === 'sustain') {
      const su = this.sustain;
      tg.rough = su.kind === 'scream' ? 0.45 : 0.05;
      tg.vib = su.kind === 'whee' ? 0.035 : 0.015;
      tg.noise = su.kind === 'scream' ? 0.12 : 0.03;
      tg.nf = 3000; tg.nq = 0.8;
    } else { tg.rough = 0; tg.vib = 0.006; }
    if (s.p === '_' || s.kind === 'rest') tg.voice = 0;
  }

  // One resonator with unity gain at DC (Klatt-style).
  reso(r, x, F, bw) {
    const T = this.T;
    const C = -Math.exp(-2 * Math.PI * bw * T);
    const B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * F * T);
    const A = 1 - B - C;
    const y = A * x + B * r.y1 + C * r.y2;
    r.y2 = r.y1; r.y1 = y;
    return y;
  }

  render(out) {
    const n = out.length, c = this.cur, tg = this.tgt;
    const kfFast = 1 - Math.exp(-1 / (0.012 * this.sr));  // formant glide ~12 ms for words
    const kfSlow = 1 - Math.exp(-1 / (0.07 * this.sr));   // ~70 ms: the murmur's mouth slides
    const ka = 1 - Math.exp(-1 / (0.006 * this.sr));    // amplitude ~6 ms
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      if (!this.seg || this.seg.i >= this.seg.n) this.nextSegment();
      const s = this.seg;
      const frac = s.i / Math.max(1, s.n);
      s.i++;
      const kf = s.kind === 'murmur' ? kfSlow : kfFast;
      // Pitch and loudness for this sample.
      let f0m, loud;
      if (s.kind === 'phrase') { f0m = (s.f0a + (s.f0b - s.f0a) * frac) * s.pitch; loud = s.loud; }
      else if (s.kind === 'sustain' && this.sustain) { f0m = this.sustain.f0; loud = this.sustain.loud; }
      else if (s.kind === 'murmur') {
        // Pitch falls across each breath group (or rises at the end: a question);
        // loudness swells and fades at syllable speed; an inhale is a soft hiss.
        const d = this.dr, m = this.murmur;
        const st = STYLE[this.style];
        const u = d.uttLen ? Math.min(1, d.uttT / d.uttLen) : 0;
        let contour = 1 + st.fall / 2 - st.fall * u;
        if (d.question && u > 0.75) contour += (u - 0.75) * st.rise;
        f0m = (1 + (m.f0 - 1) * st.pitchSpan) * this.murPitch * contour;
        d.amPh += st.amRate * Math.min(2.6, m.rate) * this.T;
        const am = 0.5 - 0.5 * Math.cos(2 * Math.PI * d.amPh);
        loud = d.breathing ? (this.style === 'human' ? 0.25 : 0.4) * m.loud : m.loud * (1 - st.amDepth + st.amDepth * am);
      } else { f0m = this.murmur.f0; loud = 0; }
      if (this.silenced && s.kind !== 'phrase') loud = 0;
      // Stops: silence then a short burst of noise at the end.
      let stopBurst = 0;
      if (s.stop) { loud *= frac > 0.7 ? 1 : 0; stopBurst = frac > 0.7 ? 0.9 : 0; }
      tg.f0 = f0m; tg.loud = loud * (s.gain || 1);
      c.F1 += (tg.F1 - c.F1) * kf; c.F2 += (tg.F2 - c.F2) * kf; c.F3 += (tg.F3 - c.F3) * kf;
      c.bw += (tg.bw - c.bw) * kf; c.nf += (tg.nf - c.nf) * kf; c.nq += (tg.nq - c.nq) * kf;
      c.f0 += (tg.f0 - c.f0) * kf;
      c.voice += (tg.voice - c.voice) * ka; c.noise += (tg.noise - c.noise) * ka; c.loud += (tg.loud - c.loud) * ka;
      c.rough += (tg.rough - c.rough) * kf; c.vib += (tg.vib - c.vib) * kf;

      // Source: sawtooth with jitter, vibrato and (for screams) a rough subharmonic.
      const sty = STYLE[this.style];
      const jitAmt = this.murmur.jitter * sty.jitter;
      this.jit += (this.rand() - 0.5) * 0.02 - this.jit * 0.002;
      this.vibPh += (5.5 + 2 * c.rough) * this.T;
      const wob = this.sustain ? Math.min(1, (this.sustain.wobble || 0) / 15) : 0;
      this.wobPh += (2 + 6 * wob) * this.T;
      const f0 = this.basePitch * c.f0 * (1 + c.vib * Math.sin(2 * Math.PI * this.vibPh) + this.jit * jitAmt * 4) * (1 + 0.08 * wob * Math.sin(2 * Math.PI * this.wobPh));
      this.phase += f0 * this.T;
      if (this.phase >= 1) this.phase -= 1;
      // PolyBLEP sawtooth (keeps high pitches from aliasing).
      const dtp = f0 * this.T;
      let saw = 2 * this.phase - 1;
      if (this.phase < dtp) { const x = this.phase / dtp; saw -= x + x - x * x - 1; }
      else if (this.phase > 1 - dtp) { const x = (this.phase - 1) / dtp; saw -= x * x + x + x + 1; }
      this.subPh += f0 * 0.5 * this.T; if (this.subPh >= 1) this.subPh -= 1;
      const roughMod = 1 - c.rough * 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.subPh)) - c.rough * 0.25 * this.rand();
      const white = this.rand() * 2 - 1;
      const breath = this.murmur.breath;
      // A real throat's buzz is dull when quiet and brighter when loud. Low-pass
      // the sawtooth to match (human style), and make up the lost level.
      if (this.style === 'human') {
        const fc = 450 + 2600 * Math.min(1, c.loud) * Math.min(1, c.loud);
        this.glp += (1 - Math.exp(-2 * Math.PI * fc * this.T)) * (saw - this.glp);
        saw = this.glp * Math.min(2.4, Math.sqrt(3050 / fc));
      }
      const asp = (PH[s.p] && PH[s.p].asp) || (s.kind === 'murmur' && this.dr.breathing);
      let src = saw * c.voice * roughMod + white * (0.15 * breath * c.voice + (asp ? c.noise : 0));
      // Filter: three formants in cascade plus a fixed fourth for presence.
      const bwk = c.bw;
      let y = this.reso(this.res[0], src, c.F1, sty.bw[0] * bwk);
      y = this.reso(this.res[1], y, c.F2, sty.bw[1] * bwk);
      y = this.reso(this.res[2], y, c.F3, sty.bw[2] * bwk);
      y = this.reso(this.res[3], y, 3600 * this.tract, 300);
      // Frication (sh, s, f) and stop bursts go round the vowel filter.
      const fric = this.reso(this.nres, white, c.nf, c.nf / Math.max(0.3, c.nq)) * (asp ? 0 : c.noise + stopBurst) * 3;
      let o = (y * 1.0 + fric * 0.5) * c.loud * this.gainOut;
      o = Math.tanh(o * 1.6) / 1.6;
      out[i] = o;
      sumSq += o * o;
    }
    this.level = Math.sqrt(sumSq / n);
    return out;
  }
}
