// Hermetic checks for the pure modules: materials, physics + sensors + detector,
// persona and the voice. No browser, no network. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../sim/js/materials.js';
import { World, Ball, Hand, makeRng } from '../sim/js/physics.js';
import { readFrame, FRAME_HZ } from '../sim/js/sensors.js';
import { Detector } from '../sim/js/detector.js';
import { Persona } from '../sim/js/persona.js';
import { VoiceCore } from '../sim/js/voicecore.js';
import { PACKS } from '../sim/js/packs.js';

function rig(design = {}, groundSurf = 'wood') {
  const d = M.deriveDesign(design);
  const w = new World();
  w.setScene({ boxes: [], ground: groundSurf });
  const ball = new Ball(1, d, [0, 1.2, 0]);
  const hand = new Hand(1, [0, 1.2, 0]);
  hand.idleToss = false;
  w.balls.push(ball); w.hands.push(hand);
  hand.grab(ball, 0);
  const det = new Detector({ massKg: d.mass, cor: d.cor });
  const persona = new Persona({ adultEdition: true });
  const rng = makeRng(3);
  const log = [];
  const run = secs => {
    for (let i = 0; i < secs * FRAME_HZ; i++) {
      w.step(1 / FRAME_HZ);
      const f = readFrame(ball, w.t, rng);
      const out = det.step(f);
      const cmds = persona.step(out, 1 / FRAME_HZ);
      log.push({ t: w.t, f, out, cmds });
    }
  };
  return { d, w, ball, hand, det, persona, run, log };
}
const events = log => log.flatMap(l => l.out.events);

test('materials: every shell gives finite numbers and drop tests run', () => {
  for (const k of Object.keys(M.SHELLS)) {
    const d = M.deriveDesign({ shell: k });
    const r = M.simulateDrop(d, 2);
    assert.ok(d.mass > 0.02 && d.mass < 0.3, `${k} mass ${d.mass}`);
    assert.ok(r.peakG > 50 && r.peakG < 5000, `${k} peak ${r.peakG}`);
    assert.ok(r.effectiveCor > 0 && r.effectiveCor < 1, `${k} cor ${r.effectiveCor}`);
    d.tl.forEach(v => assert.ok(Number.isFinite(v) && v >= 0));
  }
});

test('acoustics: holes cap the loss; solid silicone blocks far more', () => {
  const holed = M.deriveDesign({ shell: 'silicone', openArea: 0.2 });
  const solid = M.deriveDesign({ shell: 'silicone', openArea: 0 });
  assert.ok(Math.max(...holed.tl) < 7.1);
  assert.ok(solid.tl[3] > 25, `solid TL@1k ${solid.tl[3]}`);
  const room = { V: 78, S: 117, alpha: 0.3 };
  const near = M.listenerBands(M.outsideBands(holed), 0.5, room).dBA;
  const far = M.listenerBands(M.outsideBands(holed), 5, room).dBA;
  assert.ok(near > far);
});

test('held ball: detector says HELD or REST, persona murmurs', () => {
  const r = rig();
  r.run(3);
  const states = new Set(r.log.slice(100).map(l => l.out.state));
  assert.ok([...states].every(s => s === 'HELD' || s === 'REST'), [...states].join());
  assert.ok(r.log.some(l => l.cmds.some(c => c.type === 'murmur' && c.on)));
});

test('drop from hand: launch with ~0 speed, impact, fall height estimate close to truth', () => {
  const r = rig();
  r.run(1);
  const h0 = r.ball.p[1] - r.d.R;
  r.hand.drop();
  r.run(2);
  const ev = events(r.log);
  const launch = ev.find(e => e.type === 'launch');
  const impact = ev.find(e => e.type === 'impact');
  assert.ok(launch, 'launch event');
  assert.ok(launch.v0 < 0.5, `drop v0 ${launch.v0}`);
  assert.ok(impact, 'impact event');
  assert.ok(Math.abs(impact.fallEst - h0) < 0.25, `fallEst ${impact.fallEst} vs ${h0}`);
  assert.ok(impact.forceN > 20, `force ${impact.forceN}`);
});

test('throw: launch speed estimate within 25% of the real throw', () => {
  const r = rig();
  r.run(1);
  r.hand.yaw = 0; r.hand.pitch = 0.6; r.hand.power = 4;   // 6 m/s
  r.hand.throw();
  r.run(1.5);
  const launch = events(r.log).find(e => e.type === 'launch');
  assert.ok(launch, 'launch');
  assert.ok(Math.abs(launch.v0 - 6) < 1.5, `v0 ${launch.v0}`);
  assert.ok(r.log.some(l => l.cmds.some(c => c.type === 'sustainStart')), 'persona starts a whee/scream');
});

test('idle toss: small launch, then caught, anxiety rises a bit', () => {
  const r = rig();
  r.run(2);
  const a0 = r.persona.anx;
  r.hand.toss(1.1);
  r.run(1.5);
  const ev = events(r.log);
  assert.ok(ev.some(e => e.type === 'launch' && e.v0 < 2.2), 'small launch');
  assert.ok(ev.some(e => e.type === 'caught'), 'caught');
  assert.ok(Math.max(...r.log.slice(-150).map(l => r.persona.anx)) >= a0);
});

test('curveball: side spin makes the detector flag a curve', () => {
  const r = rig({ imu: 'dsv320' });
  r.run(1);
  r.hand.pitch = 0.25; r.hand.power = 7; r.hand.spin = 20;
  r.hand.throw();
  r.run(1.2);
  assert.ok(events(r.log).some(e => e.type === 'curve' || e.type === 'spin'), events(r.log).map(e => e.type).join());
});

test('squeeze rhythm S S while held becomes pattern SS → scream mode', () => {
  const r = rig();
  r.run(1.5);
  const tap = (ms) => { r.hand.squeezing = true; r.run(ms / 1000); r.hand.squeezing = false; r.run(0.2); };
  tap(150); tap(150);
  r.run(1.2);
  const pat = events(r.log).find(e => e.type === 'pattern');
  assert.ok(pat, 'pattern event: ' + events(r.log).map(e => e.type + (e.code || '')).join());
  assert.equal(pat.code, 'SS');
  assert.equal(r.persona.mode, 'scream');
});

test('voice: renders finite, audible audio for murmur and every phrase', () => {
  const v = new VoiceCore(48000);
  const buf = new Float32Array(48000);
  v.render(buf);
  assert.ok(buf.every(Number.isFinite));
  const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
  assert.ok(rms > 0.003 && rms < 0.5, `murmur rms ${rms}`);
  for (const [slot, ph] of Object.entries(PACKS.adult.phrases)) {
    v.command({ type: 'say', ...ph, interrupt: true });
    const b = new Float32Array(24000);
    v.render(b);
    assert.ok(b.every(Number.isFinite), slot);
    assert.ok(Math.max(...b.map(Math.abs)) > 0.02, `${slot} silent`);
  }
  v.command({ type: 'sustainStart', kind: 'scream' });
  const s = new Float32Array(24000); v.render(s);
  const srms = Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);
  assert.ok(srms > rms, `scream ${srms} louder than murmur ${rms}`);
});

test('curve sensing: half-holed wiffle curves with no spin and the accelerometer catches it', () => {
  const r = rig({ holeLayout: 'half' });
  r.run(1);
  // Turn the ball so its solid side faces sideways to the throw.
  r.ball.q = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  r.hand.pitch = 0.2; r.hand.power = 7; r.hand.spin = 0;
  r.hand.throw();
  r.run(1.0);
  const ev = events(r.log).map(e => e.type);
  assert.ok(ev.includes('curve'), ev.join());
});

test('curve sensing: a straight throw with all-over holes does not cry curve', () => {
  const r = rig({ holeLayout: 'all' });
  r.run(1);
  r.hand.pitch = 0.2; r.hand.power = 7; r.hand.spin = 0;
  r.hand.throw();
  r.run(0.8);
  const ev = events(r.log).map(e => e.type);
  assert.ok(!ev.includes('curve'), ev.join());
});

test('palm is solid: a ball falling on a hand that is not gripping it bounces off', () => {
  const r = rig();
  const other = new Ball(2, r.d, [0, 1.6, 0]);       // a second ball, not this hand's
  r.w.balls.push(other);
  r.hand.release(); r.hand.state = 'empty';
  r.ball.p = [3, r.d.R, 0];                          // move the hand's own ball out of the way
  let minY = 9, bounced = false;
  for (let i = 0; i < 80; i++) {
    r.w.step(0.01);
    minY = Math.min(minY, other.p[1]);
    if (other.v[1] > 0.3) bounced = true;
  }
  const palmTop = r.hand.palmP[1];
  assert.ok(bounced, 'ball should rebound upward off the palm');
  assert.ok(minY > palmTop + r.d.R - 0.015, `ball sank into palm: centre ${minY.toFixed(3)} vs palm top ${palmTop.toFixed(3)}`);
});

test('palm is solid: a ball left resting on its own empty hand is picked up again', () => {
  const r = rig();
  r.run(0.5);
  r.hand.release();
  r.run(1.0);
  assert.equal(r.hand.state, 'hold');
  assert.equal(r.ball.holder, r.hand);
});

test('drop: the hand pulls away, so the ball falls to the floor', () => {
  const r = rig();
  r.run(0.5);
  r.hand.drop();
  let minY = 9;
  for (let i = 0; i < 150; i++) { r.w.step(0.01); minY = Math.min(minY, r.ball.p[1]); }
  assert.ok(minY < r.d.R + 0.005, `lowest point ${minY.toFixed(3)} m; never reached the floor`);
});

test('stability: no shell gains speed on hard hits in any scene (regression: soft foam shot off at 800 m/s)', async () => {
  const { SCENES } = await import('../sim/js/scenes.js');
  for (const shell of Object.keys(M.SHELLS)) {
    const d = M.deriveDesign({ shell, openArea: 0.38 });
    for (const sc of Object.values(SCENES)) {
      const spot = sc.hands[0];
      const w = new World(); w.setScene(sc);
      const b = new Ball(1, d, spot.pos), h = new Hand(1, spot.pos, spot.yaw);
      h.idleToss = false; h.pitch = 0.2; h.power = 10;
      w.balls.push(b); w.hands.push(h); h.grab(b, 0);
      w.step(0.5); h.throw();
      let vmax = 0;
      for (let i = 0; i < 600; i++) { w.step(0.01); if (i > 20) vmax = Math.max(vmax, Math.hypot(...b.v)); }
      assert.ok(vmax < 16, `${shell} in ${sc.name}: ${vmax.toFixed(1)} m/s`);
    }
  }
});

test('voice: one sound at a time; a polite line waits its turn by being dropped, and captions track what plays', () => {
  const v = new VoiceCore(48000);
  const buf = new Float32Array(2400);                 // 50 ms blocks
  v.command({ type: 'say', ph: 'a:400', text: 'Aaah', interrupt: true });
  v.render(buf);
  assert.equal(v.now.kind, 'phrase'); assert.equal(v.now.text, 'Aaah');
  v.command({ type: 'say', ph: 'o:200', text: 'Oh!', interrupt: false });   // busy: dropped
  assert.equal(v.queue.filter(q => !q.murmur).length, 0);
  v.render(buf);
  assert.equal(v.now.text, 'Aaah');
  v.command({ type: 'say', ph: 'u:120 f:110', text: 'Oof!', interrupt: true });
  v.render(buf);
  assert.equal(v.now.text, 'Oof!');
  for (let i = 0; i < 40; i++) v.render(buf);          // 2 s later it murmurs, one syllable at a time
  assert.equal(v.now.kind === 'murmur' || v.now.kind === 'rest', true);
});

test('murmur is one continuous voice: almost never silent, gliding through vowels with breaths', () => {
  const v = new VoiceCore(48000);
  v.command({ type: 'murmur', on: true, rate: 1.3, f0: 1.15, loud: 0.35, jitter: 0.03, style: 'calm' });
  const b = new Float32Array(2400);                  // 50 ms blocks, 10 s total
  let silent = 0, breaths = 0, wasBreathing = false;
  for (let i = 0; i < 200; i++) {
    v.render(b);
    if (v.level < 0.002 && !v.dr.breathing && !wasBreathing) silent++;   // pauses to inhale are allowed
    if (v.dr.breathing && !wasBreathing) breaths++;
    wasBreathing = v.dr.breathing;
  }
  assert.ok(silent < 5, `${silent} of 200 blocks silent mid-breath`);
  assert.ok(breaths >= 2, `only ${breaths} breaths in 10 s`);
  assert.equal(v.now.kind, 'murmur');
});

test('nervous persona gasps, whimpers or gulps now and then; a calm one rarely', () => {
  const count = anx => {
    const p = new Persona();
    let n = 0;
    for (let i = 0; i < 3000; i++) {                 // 30 s held
      p.anx = anx;
      const cmds = p.step({ state: 'HELD', events: [], features: { jostle: 0, spinRps: 0 } }, 0.01);
      n += cmds.filter(c => c.type === 'say' && ['gasp', 'whimper', 'gulp'].includes(c.slot)).length;
    }
    return n;
  };
  const nervous = count(0.9), calm = count(0.1);
  assert.ok(nervous >= 5, `nervous: ${nervous} in 30 s`);
  assert.ok(calm < nervous, `calm ${calm} vs nervous ${nervous}`);
});

test('voice styles: human-ish murmur is mostly hum and duller than the 11th-dimension voice', () => {
  const run = style => {
    const v = new VoiceCore(48000, 3);
    v.command({ type: 'voice', style });
    v.command({ type: 'murmur', on: true, rate: 1.3, f0: 1.15, loud: 0.35, jitter: 0.03, style: 'calm' });
    const b = new Float32Array(2400);
    let e = 0, hd = 0, prev = 0, hum = 0, ticks = 0;
    for (let i = 0; i < 200; i++) {
      v.render(b);
      for (const x of b) { e += x * x; hd += (x - prev) ** 2; prev = x; }
      if (!v.dr.breathing) { ticks++; if (v.dr.vowel === 'm' || v.dr.vowel === 'n') hum++; }
    }
    return { brightness: hd / e, humShare: hum / ticks };
  };
  const human = run('human'), spirit = run('spirit');
  assert.ok(human.brightness < 0.75 * spirit.brightness, `human ${human.brightness.toFixed(4)} vs spirit ${spirit.brightness.toFixed(4)}`);
  assert.ok(human.humShare > 0.45, `hum share ${human.humShare.toFixed(2)}`);
});

test('recorded voice: every slot has a starter clip on disk', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { SLOTS } = await import('../sim/js/packs.js');
  const m = JSON.parse(readFileSync(new URL('../sim/packs/manifest.json', import.meta.url)));
  for (const s of SLOTS) {
    const e = m.packs.kid[s.id];
    assert.ok(e, `no starter clip for ${s.id}`);
    assert.ok(existsSync(new URL('../sim/packs/' + e.file, import.meta.url)), `missing file ${e.file}`);
  }
});

test('recorded voice: one clip at a time, murmur by mood, urgent lines cut in, screams repeat higher', async () => {
  const { ClipVoice, BASE_RATE } = await import('../sim/js/clipvoice.js');
  const { MURMUR_CLIPS } = await import('../sim/js/packs.js');
  const cv = new ClipVoice(makeRng(4));
  // Calm murmur picks calm clips, and nothing else starts while one plays.
  cv.command({ type: 'murmur', on: true, style: 'calm', loud: 0.3, f0: 1 }, 0);
  const a = cv.tick(0);
  assert.equal(a.kind, 'murmur');
  assert.ok(MURMUR_CLIPS.calm.some(c => c.id === a.slot));
  assert.equal(cv.tick(0.1), null);
  // A polite line replaces murmur; a second polite line is dropped; an urgent one cuts in.
  assert.equal(cv.command({ type: 'say', slot: 'gasp', interrupt: false }, 0.2).slot, 'gasp');
  assert.equal(cv.command({ type: 'say', slot: 'gulp', interrupt: false }, 0.3), null);
  assert.equal(cv.command({ type: 'say', slot: 'ow', interrupt: true }, 0.4).slot, 'ow');
  cv.ended(0.8);
  // After a line, a pause before murmuring again.
  assert.equal(cv.tick(0.85), null);
  // Nervous murmur picks nervous clips.
  cv.command({ type: 'murmur', on: true, style: 'nervous', loud: 0.6, f0: 1.5 }, 2);
  const b = cv.tick(3);
  assert.ok(MURMUR_CLIPS.nervous.some(c => c.id === b.slot), b.slot);
  cv.ended(3.5);
  // In flight the scream clip repeats, higher as the flight goes on.
  cv.command({ type: 'sustainStart', kind: 'scream' }, 4);
  const s1 = cv.tick(4); assert.equal(s1.slot, 'scream'); assert.equal(s1.kind, 'sustain');
  cv.ended(4.4);
  cv.command({ type: 'sustain', f0: 3.0 }, 4.5);
  const s2 = cv.tick(4.5);
  assert.ok(s2.rate > s1.rate && s1.rate >= BASE_RATE * 0.99, `${s1.rate} then ${s2.rate}`);
  cv.command({ type: 'sustainStop' }, 4.8); cv.ended(4.9);
  assert.notEqual(cv.tick(4.95)?.kind, 'sustain');
});
