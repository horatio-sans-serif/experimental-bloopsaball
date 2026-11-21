# Measuring ground truth with a phone

Two measurements feed the "can it be heard" rubric (`assess/rubrics/representation.json`). Each
takes about 15 minutes. Record results with `assess measure`, or tell Claude the numbers.

**The meter:** on an iPhone, install the free **NIOSH Sound Level Meter** app (made by the US
CDC's workplace-safety institute; tested to within about 2 dB on iPhones). Use its **LAeq**
reading: the average loudness over the time it has been running, weighted the way ears hear.
Press its reset button to start a new average.

## Test 1: how loud is a lively family room?

The sim assumes 58 dBA for Christmas morning. This checks it.

1. Wait for a lively moment with everyone in the room: dinner with everyone talking, a game night,
   kids playing.
2. Put the phone face up on a table near the middle of the room, microphone uncovered.
3. Reset the meter. Wait 60 seconds without touching the phone.
4. Read **LAeq**.
5. Record it: `assess measure room-noise-dba <number> "<where and what was happening>"`

## Test 2: how much sound does the foam block?

The sim says the default shell (12.5 mm EVA foam, holes over 18% of the surface) cuts pink noise
by about 7 dBA. This checks it with a box of real foam built to match.

**Shopping list (about $45, or $30 if you already have a punch):**

| What | Where | Why this one |
|---|---|---|
| **ProsourceFit Puzzle Exercise Mat, 1/2" EVA, 6 tiles (24 sq ft)**, about $30. BalanceFrom's 1/2" mat is a fine substitute. | Walmart (store or walmart.com); also Amazon | 12.7 mm EVA foam: almost exactly the sim's default 12.5 mm shell. One tile is enough; the rest is foam for later prototypes. |
| **3/8-inch hollow punch**, e.g. General Tools 1280J (about $15) or 1271C arch punch | Hardware stores, Amazon | Cuts clean round holes through soft foam. |
| A hammer and a scrap of wood to punch onto | You likely have these | |
| A small Bluetooth speaker, no bigger than about 7 cm | Any, or use an old phone | The sound source that goes inside the foam box. |
| A kitchen scale, utility knife, ruler, packing tape | You likely have these | |

**Build the foam box (about 30 minutes):**

1. **Weigh one whole tile** (with its teeth, without the edge strips) on the kitchen scale. Record
   it: `assess measure foam-tile-grams <grams>`. The sim uses this to get the foam's real density,
   which sets how much sound it blocks.
2. Measure the speaker's longest side and add 1 cm. That is the inside size of a cube.
3. Cut 6 squares from one tile with the utility knife: 2 at the inside size, 2 at the inside size
   plus 2.5 cm on one side, 2 at the inside size plus 2.5 cm on both sides, so they close into a
   cube with no gaps.
4. On every square, mark a grid of dots 2 cm apart, starting 1 cm from the edges, and punch a
   3/8-inch hole at each dot (hammer onto the wood scrap). That makes holes over about 18% of the
   surface, the same as the sim.
5. Tape the cube together along the outside edges only. Do not tape over holes. Leave one face
   loose as a lid.

**Measure (about 15 minutes):**

1. Put the speaker on a folded towel. Put the meter phone 30 cm away, at the same height, its
   bottom edge (the microphone) pointing at the speaker. Tape both positions.
2. **Background:** nothing playing, reset, wait 15 seconds, read LAeq. Write it down.
3. **Open air:** play the pink noise at a steady medium volume. Do not touch the volume again.
   Reset the meter, wait 20 seconds, read LAeq. This is **A**. It must be at least 10 dB above the
   background; if not, turn the volume up and start this step again.
4. **Wrapped:** put the speaker inside the foam box, close the lid, put it back on its tape mark, reset,
   wait 20 seconds, read LAeq. This is **B**.
5. Do steps 3 and 4 two more times, turning the wrapped speaker a quarter turn each time. Average
   the three A readings and the three B readings.
6. Shell loss = average A − average B.
7. Record it: `assess measure shell-loss-dba <number> "puzzle-mat box, 3/8 in holes on 2 cm grid"`

## Then

Run `assess run` in this project (or ask Claude to). The scorecard shows whether the sim's room and
shell match reality, and whether the ball still falls short of being heard at 3 m.
