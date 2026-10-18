// Sample packs. Each slot is one thing the ball can say. On the real ball a slot
// is a WAV file on the SD card (sd/packs/<pack>/<slot>.wav). When a slot has no
// file, the ball speaks it with its built-in formant voice from the phoneme
// string below ("phoneme:milliseconds").

export const SLOTS = [
  { id: 'oh', when: 'Tossed a little' },
  { id: 'launch', when: 'Thrown hard' },
  { id: 'scream', when: 'In the air (scream mode), loops' },
  { id: 'whee', when: 'In the air (whee mode), loops' },
  { id: 'never', when: 'Curving in the air (taunt mode)' },
  { id: 'bip', when: 'Light tap' },
  { id: 'oof', when: 'Medium hit' },
  { id: 'ow', when: 'Hard hit' },
  { id: 'splat', when: 'Very hard hit' },
  { id: 'phew', when: 'Caught or came to rest' },
  { id: 'dizzy', when: 'Rolling' },
  { id: 'gasp', when: 'Now and then while held, more often when nervous' },
  { id: 'whimper', when: 'Now and then while held, more often when nervous' },
  { id: 'gulp', when: 'Now and then while held, more often when nervous' },
  { id: 'mode_scream', when: 'Squeeze S S' },
  { id: 'mode_whee', when: 'Squeeze S S S' },
  { id: 'mode_taunt', when: 'Squeeze S L' },
  { id: 'mode_adult', when: 'Squeeze L L (adult edition)' },
  { id: 'mode_mine', when: 'Squeeze S S L' },
  { id: 'sleep', when: 'Squeeze and hold 2 s' },
  { id: 'wake', when: 'Squeeze and hold 2 s again' },
  { id: 'nope', when: 'Pattern not allowed' },
];

// The murmur, as a pool of short recorded clips the ball strings together with
// small pauses: calm ones while it is relaxed, nervous ones as anxiety rises.
export const MURMUR_CLIPS = {
  calm: [
    { id: 'm_calm_1', text: 'Hmm.' }, { id: 'm_calm_2', text: 'Mm-hm.' }, { id: 'm_calm_3', text: 'Uh…' },
    { id: 'm_calm_4', text: 'Oh.' }, { id: 'm_calm_5', text: 'Um.' }, { id: 'm_calm_6', text: 'Hm?' },
  ],
  nervous: [
    { id: 'm_nerv_1', text: 'Oh no.' }, { id: 'm_nerv_2', text: 'Uh oh.' }, { id: 'm_nerv_3', text: 'Oh dear, oh dear.' },
    { id: 'm_nerv_4', text: 'Um, um, um.' }, { id: 'm_nerv_5', text: 'What was that?' }, { id: 'm_nerv_6', text: 'No no no no.' },
  ],
};
for (const [mood, list] of Object.entries(MURMUR_CLIPS)) {
  list.forEach((c, i) => SLOTS.push({ id: c.id, when: `Murmur while held (${mood} ${i + 1})` }));
}

// What the Mac's text-to-speech says for each slot when making the starter
// pack (scripts/make-pack.mjs). Captions stay censored; adult audio does not.
export const TTS = {
  kid: {
    oh: 'Oh!', launch: 'Whoa!', scream: 'Aaaaaaaaaaah!', whee: 'Wheeeeeeee!', never: 'Neverrrrr!', bip: 'Eep!',
    oof: 'Oof!', ow: 'Ow!', splat: 'Ow, ow, ow!', phew: 'Phew.', dizzy: 'Whoa, whoa, whoa.',
    gasp: 'Huh!', whimper: 'Mmm. Nnnnn.', gulp: 'Ulp.',
    mode_scream: 'Scream mode!', mode_whee: 'Whee mode!', mode_taunt: 'Bring it!', mode_adult: 'Nope. Kid edition.',
    mode_mine: 'Hi! It\'s me!', sleep: 'Night night.', wake: 'Hm?', nope: 'Nope.',
  },
  adult: {
    launch: 'Oh shit!', ow: 'Ow! Damn!', splat: 'What the f', phew: 'Holy shit.', never: 'Never, sucker!', mode_adult: 'Oh, it\'s on.',
  },
};

// Squeeze rhythm → what it does. S = short squeeze, L = long, H = one long hold.
export const PATTERNS = {
  SS: { action: 'mode', mode: 'scream', label: 'Scream mode' },
  SSS: { action: 'mode', mode: 'whee', label: 'Whee mode' },
  SL: { action: 'mode', mode: 'taunt', label: 'Taunt mode (curveballs)' },
  LL: { action: 'adult', label: 'Adult words on/off (adult edition only)' },
  SSL: { action: 'mine', label: 'Your recorded voice on/off' },
  H: { action: 'sleep', label: 'Sleep / wake' },
};

const KID = {
  oh: { text: 'Oh!', ph: 'o:150 h:50', f0: [1.2, 1.5] },
  launch: { text: 'Whoaaa!', ph: 'w:80 o:260 a:240', f0: [1.2, 1.6] },
  scream: { text: 'AAAAAAH!', ph: 'a:900', f0: [2.2, 2.8], loud: 1 },
  whee: { text: 'Wheeeee!', ph: 'w:90 i:900', f0: [1.3, 2.2], loud: 0.9 },
  never: { text: 'NEVERRRR!', ph: 'n:60 e:110 v:50 er:650', f0: [1.6, 1.0], loud: 1 },
  bip: { text: 'Eep!', ph: 'i:70 p:30', f0: [1.9, 1.7], loud: 0.6 },
  oof: { text: 'Oof!', ph: 'u:120 f:110', f0: [1.0, 0.75], loud: 0.85 },
  ow: { text: 'OW!', ph: 'a:140 u:200', f0: [1.7, 1.1], loud: 1 },
  splat: { text: 'Ow ow OW!', ph: 'a:90 u:70 _:40 a:90 u:70 _:40 a:150 u:220', f0: [1.6, 2.0], loud: 1 },
  phew: { text: 'Phew…', ph: 'f:130 y:40 u:380', f0: [1.0, 0.7], loud: 0.6 },
  dizzy: { text: 'Wuh-wuh-wuh…', ph: 'w:50 @:90 w:50 @:90 w:50 @:140', f0: [1.0, 0.8], loud: 0.6 },
  gasp: { text: '*gasp*', ph: 'in:230 i:45', f0: [1.8, 2.0], loud: 0.85 },
  whimper: { text: 'mmnnn…', ph: 'm:140 u:420', f0: [1.6, 1.15], loud: 0.5 },
  gulp: { text: '*gulp*', ph: 'g:30 u:80 k:30', f0: [1.0, 0.85], loud: 0.6 },
  mode_scream: { text: 'Scream mode!', ph: 's:110 k:30 r:50 i:250 m:150', f0: [1.3, 1.5] },
  mode_whee: { text: 'Whee mode!', ph: 'w:80 i:450', f0: [1.2, 1.8] },
  mode_taunt: { text: 'Bring it!', ph: 'b:30 r:40 i:110 n:70 g:30 i:80 t:40', f0: [1.1, 1.3] },
  mode_adult: { text: 'Nope, kid edition.', ph: 'n:70 o:220 p:40', f0: [1.0, 0.8] },
  mode_mine: { text: 'Hi! It\'s me!', ph: 'h:40 a:120 i:160 _:60 m:60 i:200', f0: [1.2, 1.4] },
  sleep: { text: 'Night night…', ph: 'n:60 a:120 i:120 _:60 n:60 a:120 i:220', f0: [1.0, 0.7], loud: 0.5 },
  wake: { text: 'Hm?', ph: 'h:40 @:100 m:200', f0: [0.9, 1.3], loud: 0.6 },
  nope: { text: 'Nope.', ph: 'n:70 o:220 p:40', f0: [1.0, 0.8] },
};

const ADULT = {
  ...KID,
  launch: { text: 'OH SH*T!', ph: 'o:220 sh:170 i:90 t:60', f0: [1.3, 1.7], loud: 1 },
  ow: { text: 'OW! D*MN!', ph: 'a:130 u:110 _:40 d:30 ae:200 m:200', f0: [1.6, 1.1], loud: 1 },
  splat: { text: 'WHAT THE F—', ph: 'w:50 a:140 t:30 _:20 @:80 f:220', f0: [1.5, 1.9], loud: 1 },
  phew: { text: 'Holy sh*t.', ph: 'h:40 o:160 l:60 i:100 sh:150 i:80 t:50', f0: [1.0, 0.75], loud: 0.7 },
  never: { text: 'NEVER, SUCKER!', ph: 'n:60 e:100 v:50 er:300 s:110 @:80 k:40 er:260', f0: [1.6, 1.1], loud: 1 },
  mode_adult: { text: 'Oh, it\'s ON.', ph: 'o:260 _:50 i:80 t:30 s:90 o:150 n:200', f0: [1.0, 0.8] },
};

export const PACKS = {
  kid: { name: 'Kid (built-in voice)', phrases: KID },
  adult: { name: 'Adult words (built-in voice)', phrases: ADULT },
  mine: { name: 'Your recordings', phrases: KID },
};
