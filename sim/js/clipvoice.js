// The recorded voice's scheduler: decides which clip plays next and when.
// Pure: it hands back "play this clip" decisions; audio.js plays them in the
// sim, and the firmware's VOICE task would play the same WAV files from the SD
// card. One clip at a time per ball, always.
//
// Layer 1 — murmur: while nothing else is happening it picks a short murmur
//   clip ("Hmm.", "Uh oh."), calm or nervous by mood, waits a gap, picks another.
//   Nervous means shorter gaps and slightly higher, faster playback.
// Layer 2 — lines: the persona's "say" plays a slot's clip. An urgent line cuts
//   off whatever is playing; a polite one only replaces murmur.
// Layer 3 — in flight: the scream or whee clip repeats back to back, a little
//   higher each time as the flight goes on ("Aah! AAH! AAAH!").

import { MURMUR_CLIPS } from './packs.js';

export const BASE_RATE = 1.12;           // ~2 semitones up: a smaller, younger voice
const SUSTAIN_BASE = { scream: 2.2, whee: 1.4, dizzy: 0.9 };
const GAPS = { calm: [0.8, 2.2], nervous: [0.3, 0.9], pant: [0.08, 0.25] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class ClipVoice {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.mur = { on: true, style: 'calm', loud: 0.3, f0: 1 };
    this.sus = null;
    this.silenced = false;
    this.playing = null;                 // { kind: 'murmur' | 'phrase' | 'sustain' }
    this.nextMurAt = 0;
    this.lastMur = null;
  }

  // A persona message. Returns an action for the player, or null.
  command(cmd, t) {
    switch (cmd.type) {
      case 'murmur': this.mur = { ...this.mur, ...cmd }; return null;
      case 'silence':
        this.silenced = cmd.on;
        return cmd.on && this.playing ? { type: 'stop' } : null;
      case 'say':
        if (!cmd.interrupt && ((this.playing && this.playing.kind !== 'murmur') || this.sus)) return null;
        return this.start({ slot: cmd.slot, kind: 'phrase', gain: cmd.gain ?? 1, rate: BASE_RATE * clamp(cmd.pitch ?? 1, 0.85, 1.4) });
      case 'sustainStart':
        this.sus = { kind: cmd.kind, f0: SUSTAIN_BASE[cmd.kind] ?? 1, base: SUSTAIN_BASE[cmd.kind] ?? 1, nextAt: t };
        return this.playing && this.playing.kind === 'murmur' ? { type: 'stop' } : null;
      case 'sustain':
        if (this.sus) this.sus.f0 = cmd.f0;
        return null;
      case 'sustainStop':
        this.sus = null;
        return null;
      default: return null;
    }
  }

  // Called every frame. Starts the next clip when nothing is playing.
  tick(t) {
    if (this.playing) return null;
    if (this.sus) {
      if (t < this.sus.nextAt) return null;
      return this.start({ slot: this.sus.kind, kind: 'sustain', gain: 1, rate: BASE_RATE * Math.pow(this.sus.f0 / this.sus.base, 0.7) });
    }
    if (this.mur.on && !this.silenced && t >= this.nextMurAt) {
      const style = this.mur.style === 'calm' ? 'calm' : 'nervous';
      const pool = MURMUR_CLIPS[style];
      let c = pool[Math.floor(this.rand() * pool.length)];
      if (c.id === this.lastMur && pool.length > 1) c = pool[(pool.indexOf(c) + 1) % pool.length];
      this.lastMur = c.id;
      const anx = clamp((this.mur.f0 - 1) / 0.55, 0, 1);
      return this.start({
        slot: c.id, kind: 'murmur',
        gain: clamp(0.45 + 0.8 * this.mur.loud, 0, 1),
        rate: BASE_RATE * (1 + 0.3 * anx) * (0.97 + 0.06 * this.rand()),
      });
    }
    return null;
  }

  // The player reports the current clip finished (or could not play).
  ended(t) {
    const kind = this.playing && this.playing.kind;
    this.playing = null;
    if (kind === 'sustain' && this.sus) this.sus.nextAt = t + 0.05;
    else if (kind === 'murmur') { const [a, b] = GAPS[this.mur.style] || GAPS.calm; this.nextMurAt = t + a + (b - a) * this.rand(); }
    else if (kind === 'phrase') this.nextMurAt = t + 0.4 + 0.6 * this.rand();
  }

  start(a) {
    this.playing = { kind: a.kind };
    return { type: 'play', ...a };
  }
}
