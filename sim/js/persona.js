// The persona half of the firmware: a jumpy, nervous little creature.
// Input: the detector's state, features and events every 10 ms.
// Output: messages for the voice (murmur settings, phrases to say, sustained
// screams). It never touches audio itself, so the same logic drives the sim's
// Web Audio voice and the ESP32's I2S voice.
//
// One number carries the mood: anxiety, 0 (calm) to 1 (panicking).
// Being held still lets it drift down to a baseline. Jostling, tosses and hits
// push it up. Mood sets the murmur's speed, pitch, loudness and shakiness.

import { PATTERNS } from './packs.js';

export const MOODS = [[0.25, 'calm'], [0.5, 'uneasy'], [0.8, 'nervous'], [2, 'panicking']];
export const moodOf = a => MOODS.find(([th]) => a < th)[1];

export class Persona {
  constructor({ adultEdition = false } = {}) {
    this.adultEdition = adultEdition;
    this.mode = 'whee';          // scream | whee | taunt
    this.adult = false;          // adult words (adult edition only)
    this.mine = false;           // use the owner's recordings where present
    this.asleep = false;
    this.anx = 0.15; this.base = 0.12;
    this.sustain = null;         // {kind, t}
    this.lastSay = -9; this.lastLine = '';
    this.murmurSent = 0;
    this.settledSaid = true;
    this.t = 0;
  }

  setMode(mode) { this.mode = mode; }

  step(det, dt) {
    const out = [];
    this.t += dt;
    const say = (slot, opts = {}) => {
      out.push({ type: 'say', slot, interrupt: !!opts.interrupt, gain: opts.gain ?? 1, pitch: opts.pitch ?? 1 });
      this.lastSay = this.t;
    };

    for (const e of det.events) {
      if (e.type === 'pattern') {
        const p = PATTERNS[e.code];
        if (!p) continue;
        if (p.action === 'sleep') {
          this.asleep = !this.asleep;
          if (this.asleep) { this.stopSustain(out); say('sleep', { interrupt: true }); out.push({ type: 'silence', on: true }); }
          else { out.push({ type: 'silence', on: false }); say('wake', { interrupt: true }); }
          continue;
        }
        if (this.asleep) continue;
        if (p.action === 'mode') { this.mode = p.mode; say('mode_' + p.mode, { interrupt: true }); }
        else if (p.action === 'adult') {
          if (!this.adultEdition) say('nope', { interrupt: true });
          else { this.adult = !this.adult; say(this.adult ? 'mode_adult' : 'nope', { interrupt: true }); }
        } else if (p.action === 'mine') { this.mine = !this.mine; say('mode_mine', { interrupt: true }); }
        out.push({ type: 'settings', mode: this.mode, adult: this.adult, mine: this.mine });
        continue;
      }
      if (this.asleep) {
        // A sleeping ball only wakes for a real hit.
        if (e.type === 'impact' && e.forceN > 60) { this.asleep = false; out.push({ type: 'silence', on: false }); }
        else continue;
      }
      if (e.type === 'launch') {
        const v = e.v0;
        if (v < 2.2) {
          // A little toss: a startled squeak, more often the more nervous it is.
          this.anx = Math.min(1, this.anx + 0.06 + 0.05 * v);
          if (this.t - this.lastSay > 0.8 && Math.random() < 0.35 + this.anx) say('oh', { pitch: 1 + this.anx * 0.4, gain: 0.6 + 0.4 * this.anx });
        } else {
          this.anx = Math.min(1, this.anx + 0.3 + 0.04 * v);
          if (this.adult) say('launch', { interrupt: true });
          this.startSustain(this.mode === 'scream' ? 'scream' : 'whee', out, !this.adult);
        }
        this.settledSaid = false;
      } else if (e.type === 'rebound') {
        if (e.v0z > 1.2 && !this.sustain) this.startSustain(this.mode === 'scream' ? 'scream' : 'whee', out, true, 0.7);
      } else if (e.type === 'curve' || e.type === 'spin') {
        if (this.mode === 'taunt' && this.sustain && !this.sustain.taunted) {
          this.sustain.taunted = true;
          this.stopSustain(out);
          say('never', { interrupt: true });
        }
      } else if (e.type === 'impact') {
        this.stopSustain(out);
        const F = e.forceN;
        this.anx = Math.min(1, this.anx + Math.min(0.45, F / 500));
        const slot = F < 12 ? 'bip' : F < 60 ? 'oof' : F < 200 ? 'ow' : 'splat';
        if (slot !== 'bip' || this.t - this.lastSay > 0.4) say(slot, { interrupt: true, gain: Math.min(1, 0.5 + F / 150) });
        this.settledSaid = false;
      } else if (e.type === 'caught') {
        if (this.sustain) { this.stopSustain(out); say('phew', { interrupt: true }); }
        this.settledSaid = true;
      } else if (e.type === 'settled') {
        if (!this.settledSaid) { this.settledSaid = true; if (this.anx > 0.35) say('phew'); }
      }
    }

    // Live control of a sustained scream/whee: higher and louder the longer it flies.
    const st = det.state;
    if (this.sustain) {
      this.sustain.t += dt;
      const s = this.sustain;
      if (s.kind !== 'dizzy') {
        const rise = Math.min(1.4, s.t * 0.9);
        out.push({ type: 'sustain', kind: s.kind, f0: s.base * (1 + rise * (s.kind === 'whee' ? 0.6 : 0.35)), loud: Math.min(1, s.loud * (0.75 + 0.25 * this.anx + 0.1 * rise)), wobble: det.features.spinRps });
        if (st !== 'FLIGHT' && s.t > 0.2) this.stopSustain(out);
        if (s.t > 6) this.stopSustain(out);
      } else {
        out.push({ type: 'sustain', kind: 'dizzy', f0: 0.9, loud: 0.45, wobble: det.features.spinRps });
        if (st !== 'ROLL') this.stopSustain(out);
      }
    } else if (st === 'ROLL' && !this.asleep && this.t - this.lastSay > 0.6) {
      this.startSustain('dizzy', out, false);
    }

    // Nervous noises while held or sitting: a gasp, a whimper or a gulp now and
    // then, more often the more anxious it is (from about one a minute when calm
    // to one every two seconds when panicking). The voice drops it if busy.
    if (!this.asleep && !this.sustain && (st === 'HELD' || st === 'REST') && this.t - this.lastSay > 1.5) {
      const perSecond = 0.02 + 0.5 * this.anx * this.anx;
      if (Math.random() < perSecond * dt) {
        const r = Math.random();
        say(r < 0.5 ? 'gasp' : r < 0.8 ? 'whimper' : 'gulp', { gain: 0.5 + 0.5 * this.anx });
      }
    }

    // Mood.
    if (st !== 'FLIGHT') {
      const tau = st === 'HELD' ? 4 : 7;
      this.anx += (this.base - this.anx) * dt / tau;
      this.anx += Math.min(0.5, det.features.jostle * 3) * dt;
    } else {
      this.anx = Math.min(1, this.anx + 0.15 * dt);
    }
    this.anx = Math.max(0, Math.min(1, this.anx));

    if (this.t - this.murmurSent > 0.1) {
      this.murmurSent = this.t;
      const a = this.anx;
      out.push({
        type: 'murmur',
        on: !this.asleep && st !== 'FLIGHT',
        rate: 1 + 2.4 * a,
        f0: 1 + 0.55 * a,
        loud: 0.22 + 0.4 * a,
        jitter: 0.01 + 0.07 * a,
        breath: 0.08 + 0.25 * a,
        style: a > 0.85 ? 'pant' : a > 0.45 ? 'nervous' : 'calm',
      });
    }
    return out;
  }

  startSustain(kind, out, playOnset = true, loud = 1) {
    this.sustain = { kind, t: 0, base: kind === 'scream' ? 2.2 : kind === 'whee' ? 1.4 : 0.9, loud, taunted: false };
    out.push({ type: 'sustainStart', kind, onset: playOnset });
  }
  stopSustain(out) {
    if (!this.sustain) return;
    this.sustain = null;
    out.push({ type: 'sustainStop' });
  }
}
