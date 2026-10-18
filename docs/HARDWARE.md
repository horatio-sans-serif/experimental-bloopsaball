# Bloopsaball hardware, for a first electronics project

Each layer below rests on the one before it. The running example is one ball: a 67 mm EVA-foam
ball with a 42 mm core, the simulator's default design.

## Layer 0: what is inside

A small hard plastic sphere (the **core**) sits in the middle of a foam ball. The core holds a tiny
computer, a motion sensor, a vibration sensor, a speaker, a battery and a memory card. The foam
protects the core and lets sound out through holes.

Example: the default ball is 67 mm across (tennis-ball size). The core is 42 mm, so there is
12.5 mm of foam all round it.

## Layer 1: the parts to buy for a desk prototype

Build everything on a desk first, wired loosely, before anything goes inside a ball. This layer
names the parts that sit in the Layer 0 core.

| Job | Part | Why this one |
|---|---|---|
| Computer | Seeed Studio **XIAO ESP32S3 Sense** | Thumbnail-sized ESP32-S3 board. It has USB-C, a battery charger, a microSD slot and a microphone (the mic is for the voice-clone idea later). |
| Motion sensor | **LSM6DSV320X** breakout, if you can find one. Otherwise an **LSM6DSV16X** board plus an **ADXL375** board | You need two ranges: ±16 g to feel throws and catches, and ±200–320 g to measure impacts. The 320X has both in one chip. Check that a breakout board is in stock before ordering. |
| Amplifier | **MAX98357A** I2S breakout (Adafruit sells one) | Takes digital audio from the ESP32 and drives the speaker directly. No analog wiring to get wrong. |
| Speaker | 28 mm, 8 Ω, 1 W micro speaker | The largest that fits a 42 mm core next to the battery. |
| Vibration sensor | 20 mm **piezo disc**, a 1 MΩ resistor, two 100 kΩ resistors, two small Schottky diodes | Feels squeezes and hits. The resistors bias it to half the supply voltage; the diodes stop a hard hit from frying the input pin. |
| Battery | 300 mAh LiPo pouch cell, about 4 × 20 × 30 mm, **with a protection circuit** | Fits the core. The protection circuit cuts power if the cell is shorted. |

Example: wired up on the desk, shaking the board makes the motion sensor numbers jump, tapping
the piezo makes its voltage spike, and the speaker murmurs. That is the whole product in miniature.

## Layer 2: how the ball measures what you asked for

Layer 1 named the sensors. This layer says how each one answers your four questions. One thing to
know first: **no cheap sensor measures height directly.**

| You asked | What actually measures it | How |
|---|---|---|
| How high off the ground | The motion sensor and a clock | A falling ball's accelerometer reads almost zero ("free fall"). The firmware times the fall. Fall height is ½·g·t², so 0.64 s of free fall means a 2 m drop. |
| How fast it is moving | The motion sensor | At the throw, it adds up the push from the hand to get launch speed. At impact, the size of the impact spike gives landing speed. |
| When it hits and how hard | The high-g accelerometer and the piezo | Peak acceleration times the ball's mass is the force. A ±16 g sensor reads "16 g" for every real bounce, which is why the second range matters. |
| Squeeze rhythms | The piezo | A squeeze makes a spike, the release makes an opposite spike. The time between them says short or long. |
| Curveballs | Both parts of the motion sensor | In the air, the only force the accelerometer feels is the air pushing on the ball. Drag pushes straight back along the flight path. Any sideways push means the ball is curving. The gyro keeps track of which way is "sideways" while the ball spins. |

Example: drop the default ball from 1.2 m onto hardwood in the simulator. From sensor readings
alone, the detector reports a fall of about 1.2 m and a landing speed of 4.9 m/s (the true speed is
4.85 m/s). The hit peaks near 390 g, so even the 320 g range is briefly maxed out; the speed estimate
still works because it uses the area under the spike, not its peak. The telemetry strip draws the true height
as a solid line and the sensed height as a dashed line, so you can see how close they are.

Two findings from the simulator that change the parts list:

- A pitched wiffle ball spins about 20–25 times a second. A gyro that tops out at 2000 °/s (5.6
  turns a second) just reads "maxed out". Pick a 4000 °/s gyro.
- A real Wiffle ball curves mostly because its holes are on one half, not because it spins. The gyro
  cannot see that kind of curve, but the accelerometer can, because the sideways air force shows up
  directly. Set "Hole layout: one half only" in the simulator to try it.

## Layer 3: keeping the core alive

Layers 1 and 2 put fragile parts inside a thrown ball. This layer is about the hit.

When the ball lands, the foam squashes and slows the core down. Thinner or stiffer foam means a
shorter stop, and a shorter stop means a harder hit on the electronics. If the foam squashes all the
way, the core hits the floor almost directly ("bottoming out").

Example: the default EVA ball dropped 2 m onto hardwood squashes about 7 mm and the core feels
about 530 g for 4 ms. The same ball in squishy TPE gel bottoms out and the core feels about 2000 g.

What to do about it:

1. **Fill the core with silicone potting** once the electronics work. Every part is then held still
   and cannot rattle or snap its solder joints.
2. Hold the battery in place with foam tape so it cannot slam against the case.
3. Point the speaker at a grille in the core case, lined up with a hole in the foam.
4. Leave slack and a dab of glue where every wire meets a pad.

## Layer 4: charging and loading sounds

Layer 3 sealed the core. This layer gets power and files in and out of it.

- **Prototype:** a short USB-C extension runs from the XIAO board to a port flush with the foam
  surface, covered by a silicone plug. The ESP32-S3 can present the SD card to a computer as a USB
  drive, so the ball shows up as a drive called BLOOPSABALL. Sounds go in `packs/mine/`, one WAV file
  per slot (the simulator's "My voice" panel names them and saves them in the right format).
- **Mass-market version:** use wireless (Qi) charging and load sounds from a phone app over
  Bluetooth instead. A hole to the core lets in dirt and drink, and a USB port is the first thing to
  break when a ball is thrown at a wall.

## Layer 5: from prototype to a product people can buy

Layer 4 finished one working ball. Selling thousands adds rules that someone else owns: a toy
safety lab, a battery test lab and a contract factory.

- **Christmas 2026 is not possible** for a shop product: tooling, safety testing and factory runs take
  months. Christmas 2027 is a realistic target, with prototypes and preorders during 2027.
- A children's toy in the US needs ASTM F963 and CPSIA testing by an accredited lab. The lithium
  battery needs UN38.3 (for shipping) and IEC 62133 test reports. Using a pre-certified radio module
  (the ESP32-S3 modules are) keeps the FCC part simple.
- **The adult edition should be a separate product**, sold and labelled as an adult novelty, with
  firmware that cannot play adult words at all. A setting that a child can find by squeezing in the
  right rhythm is a recall waiting to happen. The simulator models this: adult words only work when
  "Adult edition" is ticked.
- Parts cost at 10,000 units comes out around $13 for the default design (see the simulator's parts
  table). Retail is usually three to four times parts cost.

## Layer 6: the voice-clone idea (version 2)

Layers 1–5 make a ball that speaks recorded or synthesized sounds. Cloning a voice is too heavy for
the ESP32. It belongs on the phone or computer:

1. Record about 30 seconds of someone talking (the XIAO Sense microphone or the phone).
2. A voice-cloning text-to-speech service generates every slot phrase ("Wheee!", "Oof!", "NEVERRRR!")
   in that voice.
3. The files go onto the ball the same way as Layer 4.

Only clone the voice of someone who has agreed to it; the app should ask for that consent on screen.
