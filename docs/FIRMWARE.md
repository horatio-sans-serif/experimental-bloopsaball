# Bloopsaball firmware design

The simulator's JavaScript modules are the firmware's reference code. Each one ports to a C++ task
on the ESP32-S3, and each talks to the next only by small fixed-size messages, so the same parts can
run in the sim, on the ball, or split across both with a USB cable between them.

## Layer 0: the pipeline

```
SENSORS ─frame (100 Hz)→ DETECTOR ─state + events→ PERSONA ─voice messages→ VOICE ─PCM→ I2S amp → speaker
```

Example: you toss the ball. SENSORS sends frames whose acceleration drops to ~0 g. DETECTOR sends
`launch {v0: 1.1 m/s}`. PERSONA raises anxiety a little and sends `say oh`. VOICE speaks "Oh!".

## Layer 1: the four tasks

Each row is a FreeRTOS task with one input queue. The reference file is the sim module it ports.

| Task | Runs | Input | Output | Reference |
|---|---|---|---|---|
| SENSORS | IMU FIFO at 1.6 kHz, piezo ADC at 2 kHz | chip interrupts | one `Frame` every 10 ms: last accel, peak accel, area under accel, accel integral, gyro, piezo min/max | `sim/js/sensors.js` (and the accumulation in `physics.js`) |
| DETECTOR | every frame | `Frame` | state (`HELD REST FLIGHT BOUNCE ROLL`), events, features | `sim/js/detector.js` |
| PERSONA | every frame | detector output | `murmur`, `say`, `sustainStart/sustain/sustainStop`, `silence`, `settings` | `sim/js/persona.js` |
| VOICE | I2S DMA callback, 22.05 kHz | voice messages | plays one WAV clip at a time from the SD card: murmur clips by mood, lines on request, scream/whee clips repeated higher in flight | `sim/js/clipvoice.js` |

Building on Layer 0: the `launch` event in the example is one DETECTOR output message; the `say oh`
is one PERSONA output message.

## Layer 2: the messages

Layer 1 named the outputs. This layer fixes their shape. Every message is a small struct with a type
byte. The same struct serializes to one NDJSON line over USB serial, which is how a computer watches
the ball live (and how the simulator could replay a real throw).

```json
{"type":"launch","t":12.34,"v0":5.6,"v0z":3.1}
{"type":"impact","t":13.01,"peakG":212,"forceN":88,"speedEst":4.4,"sat":false,"fallEst":1.1}
{"type":"pattern","t":20.5,"code":"SS"}
{"type":"say","slot":"oof","gain":0.9,"interrupt":true}
{"type":"murmur","on":true,"rate":1.8,"f0":1.2,"loud":0.4,"jitter":0.04,"style":"nervous"}
```

## Layer 3: thresholds (all in `detector.js`)

These numbers sit on the Layer 2 events: they decide when each one fires.

| Event | Rule |
|---|---|
| launch / free fall | acceleration under 0.7 g for 30 ms (drag on a fast, light ball can reach 0.6 g) |
| impact | peak over 2.5 g **and** the peak towers over the frame's average (a throw is smooth; a hit is a spike) |
| caught | back above 0.9 g for 20 ms with no spike |
| held vs still | a hand always turns the ball a few degrees per second; a ball on the floor shows only sensor noise |
| curve | sideways air force over 0.03 g for 120 ms, measured in the frame fixed at launch |
| squeeze | piezo over +0.25 V starts a press, under −0.25 V ends it; under 0.4 s is S, longer is L, 1.5 s alone is a hold |

## Layer 4: squeeze patterns

Layer 3 turns squeezes into letters. This layer maps letters to modes. Patterns are read **only
while the ball is held or sitting still**, never within 1 s of a hit, so bouncing never changes a mode.

| Rhythm | Does |
|---|---|
| S S | Scream mode |
| S S S | Whee mode |
| S L | Taunt mode ("NEVERRRR!" when it curves) |
| L L | Adult words on/off (adult edition only; the kids' firmware answers "Nope.") |
| S S L | Your recorded voice on/off |
| hold 2 s | Sleep / wake |

## Layer 5: the SD card

Layer 4's "your recorded voice" reads from here. The ball shows up as a USB drive.

```
packs/kid/<slot>.wav       built-in kid pack (optional; the formant voice covers missing slots)
packs/adult/<slot>.wav     adult edition only
packs/mine/<slot>.wav      your recordings
packs/<pack>/m_calm_N.wav, m_nerv_N.wav   murmur clips (calm and nervous pools)
config.json                {"mode":"whee","volume":0.8,"mine":false}
```

WAV format: 16-bit mono, 22.05 kHz. Slot names are listed in `sim/js/packs.js` and in the
simulator's "My voice" panel, which saves files in this format.

## Layer 6: power

Planned, not in the sim yet: after 2 minutes in `REST` the ball says "Night night…", arms the IMU's wake-on-motion interrupt and
goes into deep sleep (about 0.1 mA). Picking it up wakes it. Murmuring all the time costs about
58 mA, so a 300 mAh battery murmurs for about 4.4 hours.

## Not done yet

- The C++ port itself.
- A volume cap for the kids' edition, set from the current ASTM F963 acoustics section.
- Pin assignments, chosen once the breakout boards are on the desk.
