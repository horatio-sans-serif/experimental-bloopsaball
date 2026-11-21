// Collector for the "can it be heard" rubric: prints the simulation's loudness
// numbers for the default design as JSON. Run by `assess run`.
import { deriveDesign, SPEAKERS, AMP_SUPPLY, outsideBands, listenerBands, aWeighted, BANDS } from '../../sim/js/materials.js';
import { SCENES } from '../../sim/js/scenes.js';
import { readFileSync } from 'node:fs';

const d = deriveDesign({});
const living = SCENES.livingroom;
const scream = outsideBands(d, 'scream', 1);
// Murmur: a recorded clip plays at roughly a twentieth of full power (rms ~0.15 of full scale).
const murmur = outsideBands(d, 'murmur', 0.05);
const at = (bands, dist, room) => listenerBands(bands, dist, room).dBA;
// What a phone meter would show for pink noise (equal energy per octave) played
// in open air and then through the shell: the A-weighted drop, all pitches at once.
const pink = BANDS.map(() => 0);
const pinkLoss = dd => aWeighted(pink) - aWeighted(pink.map((L, i) => L - dd.tl[i]));
const shellLossPinkA = pinkLoss(d);

// The physical test sample in docs/MEASURING.md: 1/2-inch (12.7 mm) EVA puzzle-mat foam,
// 3/8-inch holes on a 2 cm grid (17.7% open). Its density comes from weighing one
// 24 x 24 inch tile (assess measure foam-tile-grams), else the catalog's 110 kg/m3.
let tileGrams = null;
try { tileGrams = JSON.parse(readFileSync(new URL('../measurements.json', import.meta.url)))['foam-tile-grams']?.at(-1)?.value ?? null; } catch { }
const tileM3 = 0.6096 * 0.6096 * 0.0127;
const sampleRho = tileGrams ? tileGrams / 1000 / tileM3 : null;
const sample = deriveDesign({ shell: 'eva', coreMm: 42, diameterMm: 42 + 2 * 12.7, openArea: 0.177, ...(sampleRho ? { rho: sampleRho } : {}) });

console.log(JSON.stringify({
  design: d.design,
  spkSens: d.spk.sens,                         // dB SPL at 10 cm with 1 W, as the sim assumes
  ampW: AMP_SUPPLY[d.design.amp].w8,           // W into 8 ohms on battery power, as the sim assumes
  shellLoss1k: d.tl[3],                        // dB lost through the shell at 1 kHz
  shellLossPinkA: shellLossPinkA,              // dBA lost for pink noise: what a phone meter measures
  sampleShellLossPinkA: pinkLoss(sample),      // the same, for the exact foam box built for the test
  sampleRho: sampleRho ?? 110,                 // kg/m3 used for the sample (measured if weighed)
  livingNoiseDBA: living.noiseDBA,             // the sim's Christmas-morning background
  scream10cmDBA: aWeighted(scream),
  scream3mLivingDBA: at(scream, 3, living.room),
  margin3mDB: at(scream, 3, living.room) - living.noiseDBA,
  murmurHalfMQuietMarginDB: at(murmur, 0.5, living.room) - 40,   // vs a quiet room (40 dBA)
}));
