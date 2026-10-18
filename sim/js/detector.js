// The sensing half of the firmware: reads one sensor frame every 10 ms and says
// what is happening to the ball. It sees only clamped, noisy chip readings.
// Written without classes-of-classes or allocation-heavy tricks so it ports to C
// line for line (see docs/FIRMWARE.md).
//
// How each input is measured:
//   height  — nothing measures height directly. An accelerometer in free fall
//             reads ~0 g, so the firmware times the fall and uses h = ½·g·t².
//             The throw itself (the push before release) gives launch speed.
//   speed   — at launch: integrate the push. At impact: the area under the
//             impact spike is Δv = v_in·(1 + e), so v_in = Δv / (1 + e).
//   impacts — peak acceleration × mass = force. Needs a high-g accelerometer;
//             a ±16 g part saturates on every real bounce.
//   curve   — in flight the accelerometer feels only air forces. Drag points
//             back along the path; anything sideways (out of the throw's
//             vertical plane) is the ball curving. The gyro keeps that plane
//             fixed while the ball spins.
//   squeeze — the piezo on the core sees a spike on press and an opposite spike
//             on release. Read only while the ball is held, so bounces never
//             change modes.

const G = 9.81;

export const SQUEEZE = { pressV: 0.25, shortMax: 0.4, gap: 0.9, longHold: 1.5 };

function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qRot(q, v) {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
const mag = v => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => { const l = mag(v); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; };

export class Detector {
  constructor({ massKg = 0.06, cor = 0.7 } = {}) {
    this.massKg = massKg; this.cor = cor;
    this.state = 'REST';
    this.gUp = [0, 1, 0];
    this.ring = [];
    this.flight = null; this.impact = null;
    this.lastImpactT = -99; this.lastFlightEndT = -99;
    this.lowCount = 0; this.highCount = 0; this.stillT = 0;
    this.jostle = 0; this.wiggle = 0; this.wSlow = 0; this.aSlow = [0, 1, 0];
    this.baro = null;
    this.press = null; this.code = ''; this.lastRelease = -99;
    this.lastImpactInfo = null;
    this.t = 0;
  }
  configure(massKg, cor) { this.massKg = massKg; this.cor = cor; }

  step(f) {
    const ev = [];
    const dt = f.dt;
    this.t = f.t;
    const aMag = mag(f.a);
    const wMag = mag(f.w);
    this.baro = this.baro == null ? f.baro : this.baro + 0.05 * (f.baro - this.baro);
    this.ring.push({ aVec: f.aVec, dt, aMag });
    if (this.ring.length > 60) this.ring.shift();

    // Which way is up, learned while the ball sits or is held still.
    if (this.state !== 'FLIGHT' && Math.abs(aMag - 1) < 0.08 && wMag < 60) {
      this.gUp = unit([
        this.gUp[0] + 0.1 * (f.a[0] - this.gUp[0]),
        this.gUp[1] + 0.1 * (f.a[1] - this.gUp[1]),
        this.gUp[2] + 0.1 * (f.a[2] - this.gUp[2]),
      ]);
    }

    // Impact: a short spike of more than 2.5 g. A throw also pushes past 2.5 g, but
    // smoothly for 100+ ms, so a frame only counts if its peak towers over its mean.
    // A hit can span two frames, so collect, then report.
    const meanA = f.aInt / dt;
    if (f.aPeak >= 2.5 && (f.aPeak > 1.6 * meanA || this.impact)) {
      if (!this.impact) this.impact = { peak: 0, area: 0, sat: false, t: f.t };
      this.impact.peak = Math.max(this.impact.peak, f.aPeak);
      this.impact.area += f.aInt;
      this.impact.sat = this.impact.sat || f.aPeakSat;
    } else if (this.impact) {
      const im = this.impact; this.impact = null;
      const dv = im.area * G;
      const info = {
        type: 'impact', t: im.t,
        peakG: im.peak, forceN: this.massKg * im.peak * G,
        speedEst: dv / (1 + this.cor), sat: im.sat,
      };
      if (this.flight) {
        const fl = this.flight;
        info.airtime = fl.t;
        const tFall = Math.max(0, fl.t - Math.max(0, fl.v0z / G));
        info.fallEst = 0.5 * G * tFall * tFall;
        info.apexEst = fl.v0z > 0 ? (fl.v0z * fl.v0z) / (2 * G) : 0;
        this.flight = null;
      }
      this.lastImpactInfo = info;
      this.lastImpactT = f.t;
      this.state = 'BOUNCE';
      this.stillT = 0;
      ev.push(info);
    }

    // Free fall: below 0.7 g for 30 ms (drag on a light fast ball can reach ~0.6 g).
    this.lowCount = aMag < 0.7 && !this.impact ? this.lowCount + 1 : 0;
    if (this.state !== 'FLIGHT' && this.lowCount >= 3) {
      const fromBounce = this.state === 'BOUNCE' || this.state === 'ROLL';
      const v0 = fromBounce ? null : this.launchVelocity();
      let v0z, v0Mag, n = null;
      if (v0) {
        v0z = dot3(v0, this.gUp);
        v0Mag = mag(v0);
        const horiz = [v0[0] - v0z * this.gUp[0], v0[1] - v0z * this.gUp[1], v0[2] - v0z * this.gUp[2]];
        if (mag(horiz) > 1) {
          const c = [this.gUp[1] * v0[2] - this.gUp[2] * v0[1], this.gUp[2] * v0[0] - this.gUp[0] * v0[2], this.gUp[0] * v0[1] - this.gUp[1] * v0[0]];
          n = unit(c);
        }
      } else {
        const last = this.lastImpactInfo;
        v0z = last ? last.speedEst * this.cor * 0.7 : 0;
        v0Mag = v0z;
      }
      this.flight = { t: 0.02, v0z, v0Mag, n, q: [0, 0, 0, 1], lat: 0, curveT: 0, curved: false, spun: false, bounce: fromBounce, maxSpin: 0 };
      this.state = 'FLIGHT';
      ev.push({ type: fromBounce ? 'rebound' : 'launch', t: f.t, v0: v0Mag, v0z, bounce: fromBounce });
    }

    if (this.state === 'FLIGHT' && this.flight) {
      const fl = this.flight;
      fl.t += dt;
      // Keep the launch frame fixed while the ball spins: integrate the gyro.
      const wr = f.w.map(e => (e * Math.PI) / 180);
      const half = [wr[0] * dt / 2, wr[1] * dt / 2, wr[2] * dt / 2, 1];
      const dq = qMul(fl.q, half);
      const l = Math.hypot(...dq); fl.q = dq.map(e => e / l);
      if (fl.n) {
        const aL = qRot(fl.q, f.a);
        const lateral = dot3(aL, fl.n);
        fl.lat = 0.8 * fl.lat + 0.2 * lateral;
        fl.curveT = Math.abs(fl.lat) > 0.03 ? fl.curveT + dt : 0;
        if (!fl.curved && fl.curveT >= 0.12) { fl.curved = true; ev.push({ type: 'curve', t: f.t, lateralG: fl.lat }); }
      }
      const spin = wMag / 360;
      fl.maxSpin = Math.max(fl.maxSpin, spin);
      if (!fl.spun && spin > 6) { fl.spun = true; ev.push({ type: 'spin', t: f.t, rps: spin, sat: f.wSat }); }
      // Gentle landing (couch, hand) with no spike: back above 0.9 g for 20 ms.
      this.highCount = aMag > 0.9 ? this.highCount + 1 : 0;
      if (this.highCount >= 2 && !this.impact) {
        ev.push({ type: 'caught', t: f.t, airtime: fl.t });
        this.flight = null;
        this.state = 'HELD';
        this.lastFlightEndT = f.t;
      }
    }

    // On the ground or in a hand.
    if (this.state !== 'FLIGHT') {
      this.jostle = 0.95 * this.jostle + 0.05 * Math.abs(aMag - 1);
      // A hand is never perfectly still: it sways and turns a few degrees per second.
      // A ball on the floor shows only sensor noise.
      for (let k = 0; k < 3; k++) this.aSlow[k] += 0.05 * (f.a[k] - this.aSlow[k]);
      const dev = Math.hypot(f.a[0] - this.aSlow[0], f.a[1] - this.aSlow[1], f.a[2] - this.aSlow[2]);
      this.wiggle = 0.9 * this.wiggle + 0.1 * dev;
      this.wSlow = 0.9 * this.wSlow + 0.1 * wMag;
      const still = this.wSlow < 2 && this.wiggle < 0.012;
      this.stillT = still ? this.stillT + dt : 0;
      if (this.state === 'BOUNCE' || this.state === 'ROLL') {
        if (f.t - this.lastImpactT > 0.15 && wMag > 40 && Math.abs(aMag - 1) < 0.3) this.state = 'ROLL';
        if (this.stillT > 0.5) { this.state = 'REST'; ev.push({ type: 'settled', t: f.t }); }
      } else if (this.state === 'REST') {
        if (this.wSlow > 3 || this.wiggle > 0.016) this.state = 'HELD';
      } else if (this.state === 'HELD') {
        if (this.stillT > 1.0) this.state = 'REST';
      }
    }

    // Squeeze rhythm, read only while held and not just after a hit.
    if ((this.state === 'HELD' || this.state === 'REST') && f.t - this.lastImpactT > 1) {
      if (!this.press && f.piezoMax > SQUEEZE.pressV) this.press = { t: f.t };
      else if (this.press && f.piezoMin < -SQUEEZE.pressV) {
        const dur = f.t - this.press.t;
        this.code += dur < SQUEEZE.shortMax ? 'S' : 'L';
        if (dur >= SQUEEZE.longHold && this.code === 'L') this.code = 'H';   // one long hold
        this.press = null; this.lastRelease = f.t;
        ev.push({ type: 'squeeze', t: f.t, dur, code: this.code });
      }
    }
    if (this.code && !this.press && f.t - this.lastRelease > SQUEEZE.gap) {
      ev.push({ type: 'pattern', t: f.t, code: this.code.slice(0, 4) });
      this.code = '';
    }
    if (this.state !== 'HELD' && this.state !== 'REST' && this.press) this.press = null;

    const fl = this.flight;
    return {
      state: this.state,
      events: ev,
      features: {
        aMag, spinRps: wMag / 360, spinSat: f.wSat,
        airtime: fl ? fl.t : 0,
        heightEst: fl ? Math.max(0, fl.v0z * fl.t - 0.5 * G * fl.t * fl.t) : 0,
        v0: fl ? fl.v0Mag : 0,
        lateralG: fl ? fl.lat : 0,
        curving: !!(fl && fl.curved),
        jostle: this.jostle,
        baro: this.baro,
        squeezing: !!this.press,
        code: this.code,
        lastImpact: this.lastImpactInfo,
      },
    };
  }

  // Launch speed from the push before release: integrate (a − 1 g up) over the
  // frames where the hand was accelerating the ball. Body frame, m/s.
  launchVelocity() {
    const r = this.ring;
    const v = [0, 0, 0];
    const addFrame = (e, frac) => {
      v[0] += (e.aVec[0] - this.gUp[0] * e.dt * frac) * G;
      v[1] += (e.aVec[1] - this.gUp[1] * e.dt * frac) * G;
      v[2] += (e.aVec[2] - this.gUp[2] * e.dt * frac) * G;
    };
    // Walk back past the free-fall frames to the release frame. The release frame
    // is part push, part free fall: estimate the push share from its integral.
    let i = r.length - 1;
    while (i >= 0 && r[i].aMag < 0.7 && Math.hypot(...r[i].aVec) < 0.5 * r[i].dt) i--;
    if (i < 1) return v;
    const rel = r[i], prev = r[i - 1];
    if (prev.aMag > 1.1) {
      const frac = Math.min(1, Math.hypot(...rel.aVec) / (prev.aMag * rel.dt));
      addFrame(rel, frac);
      i--;
    }
    let n = 0;
    while (i >= 0 && r[i].aMag > 1.1 && n < 40) { addFrame(r[i], 1); i--; n++; }
    return v;
  }
}
