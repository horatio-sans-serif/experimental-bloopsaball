# Bloopsaball evolution

Append-only. One dated entry per turn that changed something. Each entry: subject, then claims,
questions, risks and annotations.

## 2026-10-18 — first build, kept as the "11th dimension" gem

**Subject:** a browser simulator for a nervous talking bouncy ball, built in one session.

**Claims**
- Physics (4 kHz rigid ball, Hertz contact, drag, spin lift, friction), sensor models (IMU ranges,
  noise, piezo), a firmware-style detector, a persona, and an acoustic chain (speaker, shell mass
  law, distance, occlusion, Sabine echo) all run and pass 21 hermetic tests.
- Sensing findings stand on their own: height comes from fall time; a ±16 g IMU saturates on every
  bounce; a 2000 °/s gyro maxes out on a wiffle pitch; holes dominate how much sound gets out.

**Questions**
- How close is any of this to a real ball? Nothing was measured against ground truth.

**Risks**
- The voice went through three synth versions and a text-to-speech pack. Brian: "terribly bizarre
  and absurd and I love it", but not useful for deciding whether to prototype.
- Every quality judgment so far was a guess: there was no rubric to compare the outputs against.

**Annotations**
- Kept as git branch `gem/eleventh-dimension`. `main` starts from the same commit.
- Next: design a rubric/assessment harness first, then re-aim the sim at the one decision it must
  inform (prototype or not).

## 2026-10-18 — first rubric: "can it be heard"

**Subject:** the assess-first harness applied to Bloopsaball for the first time (`assess/`).

**Claims**
- Rubric: 4 representation criteria (speaker sensitivity, amp power, shell loss, room noise),
  2 behavior criteria (scream heard 10 dB over a lively room at 3 m; murmur audible at 0.5 m in a
  quiet room), 1 human-judged exposition criterion (listen at the tripod).
- First assessment caught a wrong input: the sim's 28 mm speaker was 87 dB (1 W, 10 cm); real
  parts list 92–100 dB (Taoglas SPKM.28.8.A 89 dB at 0.5 W = 92 dB at 1 W; PUI AS02808MR-R
  80 dB at 1 W/1 m = 100 dB at 10 cm). Set to the conservative Taoglas value; representation went
  0.33 → 1.00 on the measured half.
- With a real speaker on battery power (0.8 W), a full scream at 3 m is 65 dBA against the sim's
  58 dBA room: a 7.2 dB margin, short of the 10 dB needed to be understood. Murmur at 0.5 m in a
  quiet room: 13.8 dB over, passes.

**Questions**
- The decision sentence in `assess/config.json` is a draft; Brian has not confirmed it.
- Shell loss and room noise are unmeasured. Either could move the margin by ±5 dB.

**Risks**
- Speaker figures are from distributor listings, not the PDF datasheets.
- The 20 mm and 36 mm speakers are still unverified guesses (now labelled so in the UI).

**Annotations**
- Ways to close the 3 dB gap: 5 V boost (+3.5 dB), the louder PUI part (+8 dB if its claim
  holds), more holes (small effect: holes already cap shell loss near 7 dB).
- Not committed; `main` has the rubric and the speaker change as uncommitted work.

## 2026-10-18 — measurement plan for the two unmeasured truths

**Subject:** phone measurements for room noise and shell loss (`docs/MEASURING.md`).

**Claims**
- Shell-loss criterion now compares like with like: the sim reports the A-weighted drop for pink
  noise (6.8 dBA for the default shell), which is what a phone meter measures; before it compared
  a single-pitch (1 kHz) number with a broadband reading.
- Test signal: `assess/signals/pink-noise-45s.wav`. Meter: NIOSH Sound Level Meter (iPhone), LAeq.

**Questions**
- What foam does Brian have? If it differs from the default design, the sim must be set to match
  before comparing.

**Risks**
- Phone microphones vary by about ±2 dB; three repeats and a background check are in the procedure.

## 2026-10-18 — test sample chosen for the shell-loss measurement

**Claims**
- 1/2" EVA puzzle-mat foam (ProsourceFit, Walmart, ~$30 for 6 tiles) is 12.7 mm thick, a near match
  to the 12.5 mm default shell. 3/8" holes on a 2 cm grid give 17.7% open area (sim: 18%).
- The collector now computes the loss for that exact box (`sampleShellLossPinkA`, 6.9 dBA at the
  catalog density) and uses the foam's measured density once a tile is weighed
  (`assess measure foam-tile-grams`). `deriveDesign` accepts `rho` to override catalog density.

**Risks**
- Puzzle-mat density is unknown until weighed; mass-law loss scales with it.
- A cube is not a sphere; corners and taped edges may leak a little more than a ball would.
