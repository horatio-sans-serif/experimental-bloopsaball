# BLOOPSABALL

A tennis-ball-sized bouncy ball with a jumpy, nervous voice inside. It murmurs ("uh-ah… oh-um…
hmm") while it sits in your hand, gets more anxious when you toss it, and screams, yells "Wheee!" or
taunts "NEVERRRR!" when it flies. Squeezing it in a rhythm changes its mode.

## Run the simulator

```bash
npm run sim
```

Then open http://localhost:4801 and press **Start sound**. (It has to be served over HTTP; opening
`index.html` as a file blocks the JavaScript modules.)

- Left panel: pick the shell material, size, holes, speaker, motion sensor and battery. Results
  show weight, bounce, the shock on the electronics, loudness at the tripod, battery life and parts cost.
- Middle: the 3D scene. Drag to turn, scroll to zoom, right-drag to slide. Keys are listed on screen.
- Bottom strip: what the sensors read, and what the ball worked out from them (dashed height line).
- Right panel: scenes, balls, throw settings, persona mode, squeeze button, listening position,
  and recording your own voice for each sample.

## Test

```bash
npm test
```

21 hermetic checks: materials, the drop/throw/toss/curve/squeeze detection pipeline, the solid palm, physics stability, the persona, and the voice
synth. No browser, no network, no dependencies.

## Layout

| Path | What |
|---|---|
| `docs/HARDWARE.md` | Parts to buy, how each input is measured, protecting the core, charging, production |
| `docs/FIRMWARE.md` | The sensor → detector → persona → voice pipeline as ESP32 tasks and messages |
| `sim/js/materials.js` | Parts catalog, contact physics, drop test, shell sound loss, loudness, cost, battery |
| `sim/js/physics.js` | 4 kHz ball physics, hands, sensor accumulation, throw-path preview |
| `sim/js/sensors.js` | Turns physics into clamped, noisy chip readings |
| `sim/js/detector.js` | Firmware reference: what is happening, from sensor readings only |
| `sim/js/persona.js` | Firmware reference: the nervous creature |
| `sim/js/clipvoice.js` | Firmware reference: which recorded clip plays next, one at a time |
| `sim/js/voicecore.js` | Formant voice synth, used only for the "11th dimension" voice style |
| `sim/packs/` | Starter voice clips (WAV) and `manifest.json`; remake with `node scripts/make-pack.mjs [voice]` |
| `sim/js/audio.js` | Web Audio: speaker, shell filter, distance, occlusion, room echo, 3D panning, recording |
| `sim/js/scenes.js`, `packs.js` | Test scenes; sample slots and squeeze patterns |

## What is modelled, and what is assumed

Modelled from physics: Hertz contact with damping (bounce, squash, peak g), drag and spin lift,
friction and rolling, sensor ranges and noise, mass-law sound loss through the shell, speaker
roll-off, distance loss, room echo from Sabine's formula, and background noise at a stated level.

Assumed, and worth replacing with real numbers once parts arrive: speaker sensitivity (typical
datasheet values), foam stiffness, the side force on a half-holed wiffle shell, and the listening
calibration (94 dB SPL at your ear = full scale; use the Volume slider to match your headphones).
