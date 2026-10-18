// Rigid-ball physics at 4 kHz: gravity, drag, spin lift, contacts with floors,
// furniture and other balls, and a hand that holds, tosses, catches and throws.
// Every substep also feeds the ball's sensor accumulators, so the sensors
// see the same forces the ball feels. No three.js here.

import { G, RHO_AIR, SURFACES, CORE_K, contactForce } from './materials.js';

export const SUBSTEP = 1 / 4000;
const GRAV = [0, -G, 0];

// ---------- small vector + quaternion helpers (arrays, y up) ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
const addTo = (o, a, s = 1) => { o[0] += a[0] * s; o[1] += a[1] * s; o[2] += a[2] * s; };

// q = [x, y, z, w], rotates body → world.
export function qRotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export function qInvRotate(q, v) { return qRotate([-q[0], -q[1], -q[2], q[3]], v); }
export function qIntegrate(q, w, h) {
  // dq = 0.5 * (w, 0) ⊗ q, with w in world frame
  const [x, y, z, s] = q, [a, b, c] = w;
  const n = [
    x + 0.5 * h * (s * a + b * z - c * y),
    y + 0.5 * h * (s * b + c * x - a * z),
    z + 0.5 * h * (s * c + a * y - b * x),
    s + 0.5 * h * (-a * x - b * y - c * z),
  ];
  const l = Math.hypot(...n);
  return n.map(e => e / l);
}

// Seeded random numbers so tests are repeatable.
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  next.gauss = () => { let u = 0; while (!u) u = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()); };
  return next;
}

// ---------- ball ----------
export class Ball {
  constructor(id, d, pos) {
    this.id = id;
    this.d = d;
    this.p = [...pos]; this.v = [0, 0, 0]; this.w = [0, 0, 0]; this.q = [0, 0, 0, 1];
    this.contacts = new Map();      // collider key -> speed at first touch
    this.holder = null;
    this.squeezeN = 0;              // grip force while squeezed (N)
    this.piezoY = 0; this.piezoPrev = 0;
    this.compress = 0; this.compressN = [0, 1, 0];
    this.resetSense();
  }
  resetSense() {
    this.sense = { dt: 0, a: [0, 0, 0], aPeak: 0, aInt: 0, aVec: [0, 0, 0], w: [0, 0, 0], piezoMax: -9, piezoMin: 9, contactPeakN: 0, compressMax: 0, sat: false };
  }
}

// ---------- hand ----------
// States: empty, hold, toss (small idle flick up), air (waiting to catch),
// catch (soaking up the fall), launch (user throw), drop.
//
// Two parts:
//   grip — while the hand grips its ball (hold, toss, launch, catch), a spring
//          and push model stands in for fingers, which a flat box cannot do.
//   palm — a flat box that moves with the hand. Any ball it is not gripping
//          (a missed catch, a dropped ball landing back, another ball) collides
//          with it like any other surface, at the palm's own velocity.
export const PALM_HALF = [0.045, 0.011, 0.05];      // half-size of the palm box (m)
export const PALM_REACH = 0.4;                      // how far the palm leaves its rest spot (m)
const GRIP = ['hold', 'catch', 'toss', 'launch'];

export class Hand {
  constructor(id, pos, yaw = 0) {
    this.id = id;
    this.pos = [...pos];                            // rest spot of the palm's top surface
    this.palmP = [...pos]; this.palmV = [0, 0, 0];  // where the palm actually is, and its velocity
    this.owner = null; this.restT = 0;
    this.yaw = yaw; this.pitch = 0.45; this.power = 4; this.spin = 0;
    this.ball = null; this.state = 'empty'; this.t = 0; this.phaseT = 0;
    this.idleToss = true;
    this.nextToss = 2 + Math.random() * 4;
    this.tremor = Math.random() * 10;
    this.squeezing = false;
  }
  aimDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }
  speed() { return this.power * 1.5; }                    // linear: power 1–10 → 1.5–15 m/s
  spinVec() {
    // Side spin around the vertical axis makes it curve; a little backspin keeps it honest.
    const dir = this.aimDir();
    const right = norm(cross(dir, [0, 1, 0]));
    return add([0, this.spin * 2 * Math.PI, 0], scale(right, -2 * 2 * Math.PI * Math.min(1, this.power / 5)));
  }
  // The palm's rest spot plus a little tremor and sway.
  base(t) {
    const tr = this.tremor + t;
    return [
      this.pos[0] + 0.00015 * Math.sin(2 * Math.PI * 8.3 * tr) + 0.002 * Math.sin(2 * Math.PI * 0.27 * tr),
      this.pos[1] + 0.00012 * Math.sin(2 * Math.PI * 9.1 * tr + 1) + 0.0015 * Math.sin(2 * Math.PI * 0.21 * tr),
      this.pos[2] + 0.00015 * Math.sin(2 * Math.PI * 7.7 * tr + 2),
    ];
  }
  // Where a held ball's centre should sit: on top of the palm.
  palm(t) {
    const r = this.ball ? this.ball.d.R : 0.034;
    return add(this.base(t), [0, r, 0]);
  }
  // Move the palm: under the ball while gripping it (rising on a toss, reaching
  // on a throw, sinking on a catch), otherwise easing back to rest.
  updatePalm(h, t) {
    const base = this.base(t), b = this.ball;
    let P;
    if (b && GRIP.includes(this.state)) {
      P = [b.p[0], b.p[1] - b.d.R, b.p[2]];
      const off = sub(P, base), reach = len(off);
      if (reach > PALM_REACH) P = add(base, scale(off, PALM_REACH / reach));
    } else {
      let goal = base;
      if (this.state === 'drop') {
        this.phaseT += h;
        goal = add(base, [0, -0.15, 0]);
        if (this.phaseT > 0.5) this.state = 'empty';
      }
      P = add(this.palmP, scale(sub(goal, this.palmP), Math.min(1, h * 25)));
    }
    this.palmV = scale(sub(P, this.palmP), 1 / h);
    this.palmP = P;
  }
  grab(ball, t = 0) {
    if (ball.holder && ball.holder !== this) ball.holder.release();
    if (this.ball && this.ball !== ball) this.release();
    this.ball = ball; ball.holder = this; this.owner = ball; this.restT = 0;
    this.palmP = this.base(t); this.palmV = [0, 0, 0];
    ball.p = this.palm(t); ball.v = [0, 0, 0]; ball.w = [0, 0, 0]; ball.contacts.clear();
    this.state = 'hold'; this.phaseT = 0;
    this.nextToss = 2 + Math.random() * 4;
  }
  release() {
    if (this.ball) this.ball.holder = null;
    this.ball = null; this.state = 'empty';
  }
  throw() {
    if (!this.ball || !['hold', 'catch'].includes(this.state)) return false;
    // Short enough that the ball leaves the hand within arm's reach (~35 cm of push).
    this.state = 'launch'; this.phaseT = 0; this.launchDur = Math.min(0.15, 0.7 / this.speed());
    this.vTarget = scale(this.aimDir(), this.speed());
    this.wTarget = this.spinVec();
    return true;
  }
  drop() {
    if (!this.ball || !['hold', 'catch'].includes(this.state)) return false;
    this.ball.v = [0, 0, 0];
    this.release();
    // Letting go means the hand drops away from under the ball for half a second.
    this.state = 'drop'; this.phaseT = 0;
    return true;
  }
  toss(up = 1.1) {
    if (!this.ball || this.state !== 'hold') return;
    this.state = 'toss'; this.phaseT = 0; this.launchDur = 0.1;
    this.vTarget = [0, up, 0]; this.wTarget = [Math.random() - 0.5, 0, Math.random() - 0.5];
  }

  // Called every substep. Returns the force (N) and torque the hand puts on its ball.
  force(ball, h, t) {
    const m = ball.d.mass, I = ball.d.inertia;
    this.phaseT += h;
    const F = [0, 0, 0], T = [0, 0, 0];
    const target = this.palm(t);
    const support = scale(GRAV, -m);                   // cancel gravity

    if (this.state === 'hold') {
      const om = 40;
      const k = m * om * om, c = 2 * m * om;
      addTo(F, sub(target, ball.p), k);
      addTo(F, ball.v, -c);
      addTo(F, support);
      // Hands turn the ball a few degrees per second without meaning to.
      const tw = t + this.tremor;
      const wT = [0.12 * Math.sin(2.5 * tw), 0.09 * Math.sin(1.9 * tw + 1), 0.1 * Math.sin(3.1 * tw + 2)];
      addTo(T, sub(wT, ball.w), I * 25);
      ball.squeezeN = this.squeezing ? Math.min(25, (ball.squeezeN || 0) + 400 * h) : Math.max(0, (ball.squeezeN || 0) - 600 * h);
      if (len(sub(ball.p, target)) > 0.12) { this.release(); return { F: [0, 0, 0], T }; }
      if (this.idleToss && !this.squeezing) {
        this.nextToss -= h;
        if (this.nextToss <= 0) { this.toss(0.7 + Math.random() * 0.7); this.nextToss = 3 + Math.random() * 5; }
      }
    } else if (this.state === 'launch' || this.state === 'toss') {
      const remain = Math.max(h, this.launchDur - this.phaseT);
      addTo(F, sub(this.vTarget, ball.v), m / remain);
      addTo(F, support);
      addTo(T, sub(this.wTarget, ball.w), I / remain);
      ball.squeezeN = 0;
      if (this.phaseT >= this.launchDur) {
        if (this.state === 'launch') this.release();
        else { this.state = 'air'; this.phaseT = 0; }
      }
    } else if (this.state === 'air') {
      const dy = ball.p[1] - target[1];
      const horiz = Math.hypot(ball.p[0] - target[0], ball.p[2] - target[2]);
      if (ball.v[1] < 0 && dy <= 0.004 && horiz < 0.08) { this.state = 'catch'; this.phaseT = 0; }
      else if (dy < -0.15 || horiz > 0.25 || this.phaseT > 3) this.release();
    } else if (this.state === 'catch') {
      // A real catch gives way: the fingers close over ~30 ms, then the hand
      // sinks with the ball and brings it to rest over ~0.15 s (under 2 g).
      const close = Math.min(1, this.phaseT / 0.03);
      const om = 6;
      addTo(F, sub(target, ball.p), m * om * om * close);
      addTo(F, ball.v, -(m / 0.13) * close);
      addTo(F, support, close);
      addTo(T, ball.w, -I * 25);
      if (this.phaseT > 0.6) this.state = 'hold';
    }
    return { F, T };
  }
}

// ---------- world ----------
export class World {
  constructor() {
    this.balls = []; this.hands = []; this.boxes = [];
    this.ground = SURFACES.wood; this.t = 0;
  }
  setScene(scene) {
    this.boxes = scene.boxes.map((b, i) => ({ min: b.min, max: b.max, s: SURFACES[b.surf], key: 'box' + i }));
    this.ground = SURFACES[scene.ground];
  }
  step(dt) {
    const n = Math.max(1, Math.round(dt / SUBSTEP));
    for (let i = 0; i < n; i++) this.substep(SUBSTEP);
  }

  substep(h) {
    const balls = this.balls;
    const acc = balls.map(() => ({ F: [0, 0, 0], T: [0, 0, 0], contactN: 0 }));

    for (const hand of this.hands) hand.updatePalm(h, this.t);

    for (let i = 0; i < balls.length; i++) {
      const b = balls[i], d = b.d, A = acc[i];
      b.compress = 0;
      // Air: drag, spin lift (Magnus), and the wiffle half-holes side force.
      const s = len(b.v);
      if (s > 0.05) {
        const qd = 0.5 * RHO_AIR * d.area * s * s;
        addTo(A.F, b.v, -qd * d.cd / s);
        const wl = len(b.w);
        if (wl > 0.5) {
          const S = d.R * wl / s;
          const cl = Math.min(0.4, S / (2 * S + 1));
          addTo(A.F, norm(cross(b.w, b.v)), qd * cl);
        }
        if (d.design.holeLayout === 'half') {
          const vh = scale(b.v, 1 / s);
          const solid = qRotate(b.q, [0, -1, 0]);
          const side = sub(solid, scale(vh, dot(solid, vh)));
          addTo(A.F, side, qd * 0.3 / (1 + wl / 6));
        }
      }
      // Floor.
      if (b.p[1] < d.R) this.contact(b, A, 'ground', [0, 1, 0], d.R - b.p[1], this.ground);
      else b.contacts.delete('ground');
      // Furniture and walls (axis-aligned boxes).
      for (const box of this.boxes) {
        const c = [
          Math.max(box.min[0], Math.min(b.p[0], box.max[0])),
          Math.max(box.min[1], Math.min(b.p[1], box.max[1])),
          Math.max(box.min[2], Math.min(b.p[2], box.max[2])),
        ];
        const diff = sub(b.p, c), dist = len(diff);
        if (dist >= d.R) { b.contacts.delete(box.key); continue; }
        let n, x;
        if (dist > 1e-9) { n = scale(diff, 1 / dist); x = d.R - dist; }
        else {
          // Centre inside the box: push out through the nearest face.
          const faces = [
            [b.p[0] - box.min[0], [-1, 0, 0]], [box.max[0] - b.p[0], [1, 0, 0]],
            [b.p[1] - box.min[1], [0, -1, 0]], [box.max[1] - b.p[1], [0, 1, 0]],
            [b.p[2] - box.min[2], [0, 0, -1]], [box.max[2] - b.p[2], [0, 0, 1]],
          ].sort((u, v) => u[0] - v[0]);
          n = faces[0][1]; x = d.R + faces[0][0];
        }
        this.contact(b, A, box.key, n, x, box.s);
      }
      // Palms: every hand except the one gripping this ball.
      for (const hand of this.hands) {
        if (hand.ball === b && GRIP.includes(hand.state)) continue;
        if (hand.state === 'drop' && hand.owner === b) continue;
        this.palmContact(b, A, hand, h);
      }
    }
    // Ball against ball.
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      const diff = sub(a.p, b.p), dist = len(diff), key = 'ball' + b.id;
      const x = a.d.R + b.d.R - dist;
      if (x <= 0 || dist < 1e-9) { a.contacts.delete(key); continue; }
      const n = scale(diff, 1 / dist);
      const vr = sub(a.v, b.v);
      const xdot = -dot(vr, n);
      if (!a.contacts.has(key)) a.contacts.set(key, Math.max(0.05, xdot));
      const k = Math.min(a.d.kHertz, b.d.kHertz) * 0.6;
      const mu = (a.d.mass * b.d.mass) / (a.d.mass + b.d.mass);
      const Fn = contactForce(x, xdot, a.contacts.get(key), k, Math.sqrt(a.d.cor * b.d.cor), a.d.bottomOutX + b.d.bottomOutX,
        0.9 * mu * Math.abs(xdot) / h, Math.min(CORE_K, 1.5 * mu / (h * h)));
      addTo(acc[i].F, n, Fn); addTo(acc[j].F, n, -Fn);
      acc[i].contactN += Fn; acc[j].contactN += Fn;
      a.compress = Math.max(a.compress, x / 2); b.compress = Math.max(b.compress, x / 2);
    }
    // Hands.
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.holder) {
        const { F, T } = b.holder.force(b, h, this.t);
        addTo(acc[i].F, F); addTo(acc[i].T, T);
      } else b.squeezeN = 0;
    }
    // Integrate and feed the sensors.
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i], d = b.d, A = acc[i];
      const aNG = scale(A.F, 1 / d.mass);                // what an accelerometer feels (proper acceleration)
      addTo(b.v, add(aNG, GRAV), h);
      addTo(b.p, b.v, h);
      addTo(b.w, A.T, h / d.inertia);
      b.q = qIntegrate(b.q, b.w, h);
      this.accumulate(b, aNG, A.contactN, h);
    }
    this.t += h;
  }

  // Ball against the hand's palm box, which is turned by the hand's yaw and moving.
  palmContact(b, A, hand, h) {
    const R = b.d.R, [hx, hy, hz] = PALM_HALF, key = 'palm' + hand.id;
    const c = [hand.palmP[0], hand.palmP[1] - hy, hand.palmP[2]];
    const cs = Math.cos(hand.yaw), sn = Math.sin(hand.yaw);
    const dw = sub(b.p, c);
    const lx = dw[0] * cs - dw[2] * sn, ly = dw[1], lz = dw[0] * sn + dw[2] * cs;   // world → palm frame
    const q = [Math.max(-hx, Math.min(hx, lx)), Math.max(-hy, Math.min(hy, ly)), Math.max(-hz, Math.min(hz, lz))];
    const dl = [lx - q[0], ly - q[1], lz - q[2]], dist = len(dl);
    if (dist >= R) { b.contacts.delete(key); if (hand.owner === b) hand.restT = 0; return; }
    let nl, x;
    if (dist > 1e-9) { nl = scale(dl, 1 / dist); x = R - dist; }
    else { nl = [0, 1, 0]; x = R + (hy - ly); }
    const n = [nl[0] * cs + nl[2] * sn, nl[1], -nl[0] * sn + nl[2] * cs];            // palm frame → world
    this.contact(b, A, key, n, x, SURFACES.hand, hand.palmV);
    // A ball that comes to rest on its own empty hand gets picked up.
    if (hand.state === 'empty' && hand.owner === b && !b.holder && len(sub(b.v, hand.palmV)) < 0.2) {
      hand.restT += h;
      if (hand.restT > 0.4) hand.grab(b, this.t);
    }
  }

  contact(b, A, key, n, x, surf, vOther = null) {
    const d = b.d;
    const vr = vOther ? sub(b.v, vOther) : b.v;
    const xdot = -dot(vr, n);
    if (!b.contacts.has(key)) b.contacts.set(key, Math.max(0.05, xdot));
    const k = d.kHertz * surf.stiff, cor = d.cor * surf.cor;
    const Fn = contactForce(x, xdot, b.contacts.get(key), k, cor, d.bottomOutX,
      0.9 * d.mass * Math.abs(xdot) / SUBSTEP, Math.min(CORE_K, 1.5 * d.mass / (SUBSTEP * SUBSTEP)));
    addTo(A.F, n, Fn);
    A.contactN += Fn;
    if (x > b.compress) { b.compress = x; b.compressN = n; }
    // Friction at the contact point, smoothed near zero slip.
    const r = scale(n, -d.R);
    const vc = add(vr, cross(b.w, r));
    const vt = sub(vc, scale(n, dot(vc, n)));
    const ft = scale(vt, -surf.mu * Fn / (len(vt) + 0.03));
    addTo(A.F, ft);
    addTo(A.T, cross(r, ft));
    // Rolling resistance.
    const wl = len(b.w);
    if (wl > 1e-6) addTo(A.T, b.w, -surf.rr * Fn * d.R / (wl + 0.5));
  }

  accumulate(b, aNG, contactN, h) {
    const S = b.sense, imu = b.d.imu;
    const aBody = scale(qInvRotate(b.q, aNG), 1 / G);    // in g
    const clamp = (v, r) => v.map(e => Math.max(-r, Math.min(r, e)));
    const aMain = clamp(aBody, imu.accelG);
    const aPeakSensor = imu.highG ? clamp(aBody, imu.highG) : aMain;
    const pk = len(aPeakSensor);
    if (aBody.some(e => Math.abs(e) > (imu.highG || imu.accelG))) S.sat = true;
    S.dt += h;
    S.a = aMain;
    if (pk > S.aPeak) S.aPeak = pk;
    S.aInt += pk * h;
    addTo(S.aVec, aMain, h);
    S.w = qInvRotate(b.q, b.w);
    if (contactN > S.contactPeakN) S.contactPeakN = contactN;
    if (b.compress > S.compressMax) S.compressMax = b.compress;
    // Piezo disc on the core: a charge source high-passed by its 1 MΩ bleed resistor.
    const tau = 0.02, alpha = tau / (tau + h);
    const input = contactN + (b.squeezeN || 0);
    b.piezoY = alpha * (b.piezoY + input - b.piezoPrev);
    b.piezoPrev = input;
    const volts = Math.max(-1.6, Math.min(1.6, b.piezoY * 0.05));
    if (volts > S.piezoMax) S.piezoMax = volts;
    if (volts < S.piezoMin) S.piezoMin = volts;
  }
}

// Golf-game style preview of where a throw goes (air only; stops at first hit).
export function predictPath(d, p0, v0, w0, boxes, maxT = 4) {
  const pts = [[...p0]];
  let p = [...p0], v = [...v0];
  const h = 1 / 240;
  for (let t = 0; t < maxT; t += h) {
    const s = len(v);
    const qd = 0.5 * RHO_AIR * d.area * s * s;
    let a = [...GRAV];
    if (s > 0.05) {
      a = add(a, scale(v, -qd * d.cd / s / d.mass));
      const wl = len(w0);
      if (wl > 0.5) {
        const S = d.R * wl / s;
        a = add(a, scale(norm(cross(w0, v)), qd * Math.min(0.4, S / (2 * S + 1)) / d.mass));
      }
    }
    v = add(v, scale(a, h)); p = add(p, scale(v, h));
    if (pts.length < 400 && Math.round(t / h) % 4 === 0) pts.push([...p]);
    if (p[1] < d.R) { pts.push([...p]); break; }
    if (boxes.some(b => p[0] > b.min[0] - d.R && p[0] < b.max[0] + d.R && p[1] > b.min[1] - d.R && p[1] < b.max[1] + d.R && p[2] > b.min[2] - d.R && p[2] < b.max[2] + d.R)) { pts.push([...p]); break; }
  }
  return pts;
}
