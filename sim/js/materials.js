// Parts catalog and the physics that turns a design into numbers.
// Pure functions only: no DOM, no three.js, so node tests and the firmware
// port can share every formula here.

export const G = 9.81;            // m/s²
export const RHO_AIR = 1.2;       // kg/m³
export const CORE_K = 1.2e6;      // N/m, stiffness once the shell bottoms out on the core case

// Outer shell materials. E is Young's modulus (Pa), rho density (kg/m³),
// cor is coefficient of restitution on a hard floor, cell says how sound gets through.
export const SHELLS = {
  eva: {
    name: 'EVA foam, closed-cell', E: 1.2e6, rho: 110, cor: 0.70, cell: 'closed', costUsd: 0.35, color: '#ff8a3d',
    note: 'Same family as Crocs and yoga blocks. Non-toxic, cheap to mold, and holes punched in it stay clean.',
  },
  pu: {
    name: 'Polyurethane foam, open-cell', E: 0.25e6, rho: 35, cor: 0.30, cell: 'open', costUsd: 0.25, color: '#ffd35c',
    note: 'Nerf-ball foam. Very soft and lets sound through, but bounces poorly and tears around holes.',
  },
  silicone: {
    name: 'Platinum silicone, Shore 20A', E: 0.9e6, rho: 1100, cor: 0.60, cell: 'solid', costUsd: 1.60, color: '#7fd1ff',
    note: 'Food-safe and washable. Heavy, and solid rubber blocks most sound unless it has holes.',
  },
  gel: {
    name: 'TPE gel ("squishy")', E: 0.12e6, rho: 950, cor: 0.22, cell: 'solid', costUsd: 0.90, color: '#c58bff',
    note: 'The gushy stress-ball feel. It thuds instead of bouncing and bottoms out on the core easily.',
  },
  pbd: {
    name: 'Polybutadiene (superball)', E: 6e6, rho: 1050, cor: 0.88, cell: 'solid', costUsd: 0.80, color: '#ff5c8a',
    note: 'Very bouncy. Because it is stiff, it passes the hardest hits through to the electronics.',
  },
  wiffle: {
    name: 'Thin plastic skin over EVA liner (wiffle-style)', E: 1.8e6, rho: 300, cor: 0.55, cell: 'closed', costUsd: 0.55, color: '#f4f4ef',
    note: 'A hard perforated outer skin over a foam liner. The holes are part of the look.',
  },
};

// Micro speakers. sens = dB SPL at 10 cm with 1 W in (typical datasheet figure).
export const SPEAKERS = {
  s20: { name: '20 mm, 8 Ω, 1 W', sens: 84, fRes: 950, pMax: 1.0, massG: 2, costUsd: 0.35, diaMm: 20 },
  s28: { name: '28 mm, 8 Ω, 1 W', sens: 87, fRes: 700, pMax: 1.0, massG: 5, costUsd: 0.45, diaMm: 28 },
  s36: { name: '36 mm, 8 Ω, 2 W', sens: 89, fRes: 520, pMax: 2.0, massG: 9, costUsd: 0.70, diaMm: 36 },
};

// MAX98357A class-D amp output into 8 Ω, by supply voltage (W, ~10% THD).
export const AMP_SUPPLY = {
  lipo: { name: 'Battery direct (3.7 V)', w8: 0.8, costUsd: 0 },
  boost: { name: '5 V boost converter', w8: 1.8, costUsd: 0.45 },
};

// Motion sensors. accelG/gyroDps are full-scale ranges; highG is a second
// accelerometer for impacts (0 = none).
export const IMUS = {
  dso: { name: 'LSM6DSO (±16 g, ±2000 °/s)', accelG: 16, gyroDps: 2000, highG: 0, costUsd: 1.6 },
  dsv: { name: 'LSM6DSV16X (±16 g, ±4000 °/s)', accelG: 16, gyroDps: 4000, highG: 0, costUsd: 2.2 },
  dsv320: { name: 'LSM6DSV320X (±16 g + ±320 g, ±4000 °/s)', accelG: 16, gyroDps: 4000, highG: 320, costUsd: 3.0 },
};

export const BATTERIES = {
  b150: { name: '150 mAh LiPo (402025)', mAh: 150, massG: 3.5, longMm: 25, costUsd: 0.8 },
  b300: { name: '300 mAh LiPo (402030)', mAh: 300, massG: 6.5, longMm: 30, costUsd: 1.0 },
  b500: { name: '500 mAh LiPo (502540)', mAh: 500, massG: 10, longMm: 40, costUsd: 1.3 },
};

// Floors and furniture. stiff scales contact stiffness (soft surfaces cushion),
// cor scales restitution, mu is friction, rr is rolling resistance.
export const SURFACES = {
  wood: { name: 'hardwood', stiff: 1.0, cor: 1.0, mu: 0.45, rr: 0.02, color: '#b98a5a' },
  carpet: { name: 'carpet', stiff: 0.35, cor: 0.8, mu: 0.7, rr: 0.08, color: '#7b6f8f' },
  grass: { name: 'grass', stiff: 0.3, cor: 0.72, mu: 0.6, rr: 0.12, color: '#5d9a4a' },
  concrete: { name: 'concrete', stiff: 1.3, cor: 1.0, mu: 0.6, rr: 0.02, color: '#a3a39e' },
  tile: { name: 'tile', stiff: 1.3, cor: 1.0, mu: 0.35, rr: 0.015, color: '#d8d4cc' },
  drywall: { name: 'drywall', stiff: 0.8, cor: 0.95, mu: 0.4, rr: 0.02, color: '#ece6dc' },
  fabric: { name: 'couch fabric', stiff: 0.12, cor: 0.55, mu: 0.8, rr: 0.2, color: '#4f6d8a' },
  branches: { name: 'tree branches', stiff: 0.08, cor: 0.35, mu: 0.9, rr: 0.3, color: '#2f6b3a' },
  cardboard: { name: 'cardboard box', stiff: 0.4, cor: 0.6, mu: 0.5, rr: 0.05, color: '#c9a36b' },
  hand: { name: 'hand', stiff: 0.25, cor: 0.45, mu: 0.9, rr: 0.3, color: '#e2b593' },
  fence: { name: 'wood fence', stiff: 0.9, cor: 0.9, mu: 0.5, rr: 0.02, color: '#8b6b4a' },
};

export const DEFAULT_DESIGN = {
  shell: 'eva', diameterMm: 67, coreMm: 42, openArea: 0.18, holeLayout: 'all',
  speaker: 's28', amp: 'lipo', imu: 'dsv320', battery: 'b300',
};

// Hertz contact stiffness for a sphere of radius R on a flat (Poisson ratio 0.5,
// so E* = E / 0.75). F = k · x^1.5.
export function hertzK(E, R) {
  return (4 / 3) * (E / 0.75) * Math.sqrt(R);
}

// Turns a design (choices) into physical properties. Everything downstream reads this.
export function deriveDesign(design) {
  const d = { ...DEFAULT_DESIGN, ...design };
  const shell = SHELLS[d.shell], spk = SPEAKERS[d.speaker], imu = IMUS[d.imu];
  const bat = BATTERIES[d.battery], amp = AMP_SUPPLY[d.amp];
  const R = d.diameterMm / 2000, rc = d.coreMm / 2000;
  const shellT = Math.max(0.002, R - rc);
  const phi = Math.min(0.45, Math.max(0, d.openArea));

  const shellVol = (4 / 3) * Math.PI * (R ** 3 - rc ** 3);
  const shellMass = shellVol * shell.rho * (1 - phi);
  const caseMass = 4 * Math.PI * rc * rc * 0.0016 * 1240;      // 1.6 mm PLA sphere
  const partsMass = (9 + spk.massG + bat.massG) / 1000;        // MCU, IMU, amp, piezo, SD, wires
  const coreMass = caseMass + partsMass;
  const mass = shellMass + coreMass;
  const inertia = 0.4 * coreMass * rc * rc + 0.4 * shellMass * (R ** 5 - rc ** 5) / (R ** 3 - rc ** 3);

  // Holes remove material, so the shell gets softer.
  const Eeff = shell.E * Math.max(0.3, 1 - 1.2 * phi);
  const kHertz = hertzK(Eeff, R);
  const bottomOutX = 0.75 * shellT;

  const ampW = Math.min(amp.w8, spk.pMax);
  const coreInnerMm = d.coreMm - 3.2;
  const warnings = [];
  if (spk.diaMm > coreInnerMm - 2) warnings.push(`The ${spk.diaMm} mm speaker does not fit inside a ${d.coreMm} mm core.`);
  if (bat.longMm > coreInnerMm * 0.9) warnings.push(`The ${bat.longMm} mm battery is too long for a ${d.coreMm} mm core.`);
  if (shellT < 0.008) warnings.push(`The shell is only ${(shellT * 1000).toFixed(0)} mm thick, so hard drops will bottom out on the core.`);
  if (imu.gyroDps <= 2000) warnings.push('The gyro tops out at 2000 °/s (5.6 turns per second). A spinning curveball reads as "maxed out", not as a number.');
  if (!imu.highG) warnings.push('With only a ±16 g accelerometer, every real impact reads 16 g, so the ball cannot tell a soft bounce from a hard slam. The piezo has to do that job.');

  const derived = {
    design: d, shell, spk, imu, bat, amp,
    R, rc, shellT, phi, mass, shellMass, coreMass, inertia,
    Eeff, kHertz, bottomOutX, cor: shell.cor, ampW,
    cd: 0.47 + 0.25 * phi,
    area: Math.PI * R * R,
    warnings,
  };
  derived.tl = BANDS.map(f => shellTL(derived, f));
  derived.costUsd = bomCost(derived);
  derived.battery = batteryLife(derived);
  return derived;
}

// ---------- contact law (shared by the drop test and the 3D physics) ----------

// Hunt–Crossley contact with the Flores et al. (2011) damping term, which holds
// for low restitution too. x = compression (m), xdot = compression rate (m/s),
// vIn = speed when contact began. Returns normal force in newtons.
//
// Stability (for a fixed-step simulation): dampCap limits the damping force to
// what would stop the approach within one step (m·|xdot|/h), and coreK can be
// lowered so the bottom-out spring stays stable for a light ball. Without these,
// a light soft ball hitting hard at 4 kHz gains energy instead of losing it.
export function contactForce(x, xdot, vIn, k, cor, bottomOutX, dampCap = Infinity, coreK = CORE_K) {
  if (x <= 0) return 0;
  const e = Math.max(0.05, Math.min(0.97, cor));
  const chi = (8 * (1 - e)) / (5 * e * Math.max(vIn, 0.05));
  let spring = k * x ** 1.5, damp = spring * chi * xdot;
  if (x > bottomOutX) { const fc = coreK * (x - bottomOutX); spring += fc; damp += fc * 0.6 * chi * xdot; }
  damp = Math.max(-dampCap, Math.min(dampCap, damp));
  return Math.max(0, spring + damp);
}

// Drops the ball straight down from height h (m) onto a surface and measures the hit.
export function simulateDrop(d, h, surface = SURFACES.wood) {
  const vIn = Math.sqrt(2 * G * h);
  const k = d.kHertz * surface.stiff, cor = d.cor * surface.cor, xb = d.bottomOutX;
  let x = 0, v = vIn, t = 0, peakF = 0, maxX = 0;
  const dt = 2e-6;
  while (t < 0.05) {
    const F = contactForce(x, v, vIn, k, cor, xb);
    const a = (-F) / d.mass + G;       // downward positive
    v += a * dt; x += v * dt; t += dt;
    if (F > peakF) peakF = F;
    if (x > maxX) maxX = x;
    if (x <= 0 && v < 0) break;
  }
  const vOut = Math.max(0, -v);
  return {
    peakG: peakF / d.mass / G,
    peakForceN: peakF,
    contactMs: t * 1000,
    reboundH: vOut * vOut / (2 * G),
    effectiveCor: vOut / vIn,
    maxCompressionMm: maxX * 1000,
    bottomedOut: maxX > xb,
  };
}

// ---------- acoustics ----------

export const BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];
export const A_WEIGHT = [-16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];
// Relative band levels (dB) of the voice at each intensity.
export const VOICE_SPECTRUM = {
  scream: [-24, -14, -6, -1, 0, -5, -14],
  murmur: [-12, -3, 0, -5, -13, -21, -30],
};

// Sound lost passing through the shell at frequency f (dB).
// Closed-cell foam and solid rubber follow the mass law: heavier per square metre
// blocks more, and more so at high frequency. Open-cell foam lets air through and
// only absorbs a little per centimetre. Holes pass sound almost unchanged, and
// the transmitted power adds up area by area.
export function shellTL(d, f) {
  const t = d.shellT, phi = d.phi;
  let wallTL;
  if (d.shell.cell === 'open') {
    wallTL = t * 100 * 0.35 * Math.pow(f / 500, 0.9);
  } else {
    const m = d.shell.rho * t;                       // kg/m²
    wallTL = Math.max(0, 20 * Math.log10(f * m) - 47);
  }
  const tauWall = Math.pow(10, -wallTL / 10);
  const tau = phi * 1 + (1 - phi) * tauWall;
  return -10 * Math.log10(tau);
}

// Small speakers cannot move enough air below their resonance: a 2nd-order high-pass.
export function speakerResponseDb(f, fRes, q = 1.0) {
  const r = f / fRes;
  const mag = (r * r) / Math.sqrt((1 - r * r) ** 2 + (r / q) ** 2);
  return 20 * Math.log10(mag);
}

const dbsum = arr => 10 * Math.log10(arr.reduce((s, L) => s + Math.pow(10, L / 10), 0));
export const dbSum = dbsum;

// Band levels (dB SPL) measured 10 cm outside the shell, at a fraction of full power.
export function outsideBands(d, kind = 'scream', powerFrac = 1) {
  const spec = VOICE_SPECTRUM[kind];
  const norm = dbsum(spec);
  const L0 = d.spk.sens + 10 * Math.log10(Math.max(1e-6, d.ampW * powerFrac));
  return BANDS.map((f, i) => L0 + spec[i] - norm + speakerResponseDb(f, d.spk.fRes) - d.tl[i]);
}

// Room acoustics from Sabine's formula. room = {V, S, alpha} or null for outdoors.
export function roomConstant(room) {
  if (!room) return null;
  return room.S * room.alpha / (1 - room.alpha);
}
export function rt60(room) {
  if (!room) return 0;
  return 0.161 * room.V / (room.S * room.alpha);
}

// What a listener hears at distance dist (m). extraDb is a per-band loss (occlusion etc).
export function listenerBands(bands10cm, dist, room, extraDb = null) {
  const Rc = roomConstant(room);
  const r = Math.max(0.1, dist);
  const direct = [], reverb = [], total = [];
  bands10cm.forEach((L, i) => {
    const air = 0.000005 * BANDS[i] * r;                     // ~0.005 dB/m at 1 kHz
    let Ld = L - 20 * Math.log10(r / 0.1) - air - (extraDb ? extraDb[i] : 0);
    if (!room) Ld += 3;                                      // ground reflection outdoors
    const Lw = L + 20 * Math.log10(0.1) + 11;                // sound power level from SPL at 10 cm
    const Lr = room ? Lw + 10 * Math.log10(4 / Rc) : -Infinity;
    direct.push(Ld); reverb.push(Lr);
    total.push(room ? dbsum([Ld, Lr]) : Ld);
  });
  return { direct, reverb, total, dBA: aWeighted(total), directDBA: aWeighted(direct), reverbDBA: room ? aWeighted(reverb) : -Infinity };
}

export function aWeighted(bands) {
  return dbsum(bands.map((L, i) => L + A_WEIGHT[i]));
}

// ---------- cost and battery ----------

export function bomCost(d) {
  const fixed = {
    'ESP32-S3 module': 2.6, 'Class-D amp (MAX98357A)': 0.5, 'Charger IC + USB-C port': 0.6,
    'microSD slot + 1 GB card': 1.4, 'Piezo disc': 0.15, 'PCB + passives': 1.2,
    'Printed core case': 0.3, 'Assembly + test': 1.5,
  };
  const lines = {
    ...fixed,
    [`Shell (${d.shell.name})`]: d.shell.costUsd,
    [`Speaker ${d.spk.name}`]: d.spk.costUsd,
    [`IMU ${d.imu.name}`]: d.imu.costUsd,
    [`Battery ${d.bat.name}`]: d.bat.costUsd,
  };
  if (d.amp.costUsd) lines['5 V boost converter'] = d.amp.costUsd;
  const total = Object.values(lines).reduce((a, b) => a + b, 0);
  return { lines, total };
}

export function batteryLife(d) {
  const mcuMa = 45;                                           // ESP32-S3 at 80 MHz + I2S + IMU
  const murmurW = 0.05 * d.ampW;                              // average speaker power while murmuring
  const spkMa = (murmurW / (3.7 * 0.85)) * 1000;
  const activeH = (d.bat.mAh * 0.85) / (mcuMa + spkMa);
  const standbyDays = (d.bat.mAh * 0.85) / 0.12 / 24;         // deep sleep, IMU wake-on-motion
  return { activeH, standbyDays, avgMa: mcuMa + spkMa };
}
