// Turns what the physics accumulated during one 10 ms frame into what the real
// chips would report: clamped to their ranges, with noise. The detector only
// ever sees this frame, never the true position or speed.

import { G } from './materials.js';

export const FRAME_HZ = 100;

export function readFrame(ball, t, rng) {
  const S = ball.sense, imu = ball.d.imu;
  const n = () => rng.gauss();
  const gyroLimit = imu.gyroDps;
  const wDps = S.w.map(e => (e * 180) / Math.PI);
  const frame = {
    t,
    dt: S.dt || 1 / FRAME_HZ,
    a: S.a.map(e => e + 0.003 * n()),                       // g, body frame
    aPeak: S.aPeak + 0.01 * Math.abs(n()),                  // g, highest reading in the frame (IMU FIFO)
    aPeakSat: S.sat,                                        // true if the impact went past the chip's range
    aInt: S.aInt,                                           // g·s, area under |a| this frame
    aVec: S.aVec,                                           // g·s, vector integral this frame
    w: wDps.map(e => Math.max(-gyroLimit, Math.min(gyroLimit, e + 0.15 * n()))),
    wSat: wDps.some(e => Math.abs(e) >= gyroLimit),
    piezoMax: S.piezoMax, piezoMin: S.piezoMin,             // volts around the mid-rail bias
    baro: ball.p[1] + 0.08 * n(),                           // m, BMP390-class altitude noise
  };
  // Ground truth rides along for the telemetry plot only.
  frame.truth = {
    height: ball.p[1] - ball.d.R,
    speed: Math.hypot(...ball.v),
    contactPeakN: S.contactPeakN,
    peakGTrue: S.contactPeakN / ball.d.mass / G,
    spinRps: Math.hypot(...ball.w) / (2 * Math.PI),
  };
  ball.resetSense();
  return frame;
}
