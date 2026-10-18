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
