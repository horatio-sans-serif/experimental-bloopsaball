// Test scenes. Boxes are axis-aligned colliders (min/max corners in metres,
// y up) that the physics bounces off and the renderer draws. `deco` items are
// drawn only. `room` feeds Sabine's reverb formula; null means outdoors.
// noiseDBA is the background the ball has to be heard over.

const wallBoxes = (w, d, h, surf = 'drywall', t = 0.2, ceiling = true) => {
  const x = w / 2, z = d / 2;
  const b = [
    { min: [-x - t, 0, -z - t], max: [x + t, h, -z], surf, kind: 'wall' },
    { min: [-x - t, 0, z], max: [x + t, h, z + t], surf, kind: 'wall', see: false },
    { min: [-x - t, 0, -z], max: [-x, h, z], surf, kind: 'wall' },
    { min: [x, 0, -z], max: [x + t, h, z], surf, kind: 'wall' },
  ];
  if (ceiling) b.push({ min: [-x - t, h, -z - t], max: [x + t, h + t, z + t], surf, kind: 'ceiling', see: false });
  return b;
};

function stairs(x0, z0, z1, steps, rise, run, surf) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    out.push({ min: [x0 + i * run, 0, z0], max: [x0 + (i + 1) * run, (i + 1) * rise, z1], surf, kind: 'step' });
  }
  return out;
}

export const SCENES = {
  livingroom: {
    name: 'Christmas morning',
    question: 'Can the family hear it over the present-opening?',
    ground: 'wood', noiseDBA: 58,
    room: { V: 6 * 5 * 2.6, S: 2 * (30 + 15.6 + 13), alpha: 0.3 },
    sky: '#2a2233',
    boxes: [
      ...wallBoxes(6, 5, 2.6),
      { min: [-2.7, 0, -2.4], max: [-0.6, 0.45, -1.5], surf: 'fabric', kind: 'furniture', color: '#4f6d8a' },
      { min: [-2.7, 0, -2.5], max: [-0.6, 0.9, -2.15], surf: 'fabric', kind: 'furniture', color: '#45607a' },
      { min: [-1.9, 0.36, -0.9], max: [-0.6, 0.42, -0.3], surf: 'wood', kind: 'furniture', color: '#6b4a2f' },
      { min: [1.6, 0, -2.3], max: [2.5, 1.9, -1.4], surf: 'branches', kind: 'tree', see: false },
      { min: [1.1, 0, -1.3], max: [1.45, 0.25, -0.95], surf: 'cardboard', kind: 'present', color: '#d64545' },
      { min: [1.55, 0, -1.2], max: [1.85, 0.35, -0.85], surf: 'cardboard', kind: 'present', color: '#3c8f5a' },
      { min: [-0.4, 0, -1.25], max: [-0.1, 0.2, -0.95], surf: 'cardboard', kind: 'present', color: '#e0b43a' },
      { min: [2.3, 0, 0.3], max: [2.95, 0.6, 1.9], surf: 'wood', kind: 'furniture', color: '#3a2f2a' },
    ],
    deco: [{ type: 'tree', at: [2.05, 0, -1.85], h: 2.1, r: 0.6 }, { type: 'rug', min: [-2, -1.6], max: [1.3, 1.2], color: '#7b3b3b' }],
    hands: [{ pos: [0.6, 1.15, 1.4], yaw: 0.3 }, { pos: [-0.9, 1.1, 1.6], yaw: -0.2 }, { pos: [1.6, 1.2, 0.6], yaw: 0.9 }, { pos: [-2.0, 1.0, 0.4], yaw: -0.8 }],
    tripod: [-2.6, 1.0, 2.2],
    camera: { pos: [0.5, 1.9, 2.35], look: [0, 0.7, -0.9] },
  },
  stairwell: {
    name: 'Stairwell drop',
    question: 'Does the core survive a drop down the stairwell, and does it echo?',
    ground: 'tile', noiseDBA: 38,
    room: { V: 6 * 4 * 6.4, S: 2 * (24 + 38.4 + 25.6), alpha: 0.06 },
    sky: '#1e2228',
    boxes: [
      ...wallBoxes(6, 4, 6.4, 'concrete'),
      ...stairs(-2.25, 0.4, 1.6, 15, 0.2, 0.26, 'concrete'),
      { min: [1.65, 2.9, -2], max: [3, 3.0, 2], surf: 'concrete', kind: 'landing' },
      { min: [1.6, 3.0, -2], max: [1.65, 4.0, 0.3], surf: 'fence', kind: 'rail', color: '#6b6b70' },
    ],
    deco: [],
    hands: [{ pos: [1.5, 4.15, -1.0], yaw: 1.4, pitch: 0, power: 1 }, { pos: [2.2, 4.15, 1.1], yaw: 1.57 }, { pos: [-1.5, 1.2, -1.2], yaw: -1.2 }],
    tripod: [-2.5, 1.3, -1.6],
    camera: { pos: [-1.5, 3.5, -1.8], look: [1, 2.5, 0] },
  },
  backyard: {
    name: 'Backyard wiffle',
    question: 'Does the pitch curve, and does the batter hear "NEVERRRR"?',
    ground: 'grass', noiseDBA: 45, room: null,
    sky: '#86b6e0',
    boxes: [
      { min: [-4, 0, 3], max: [4, 2.4, 3.15], surf: 'fence', kind: 'fence' },
      { min: [-12, 0, -18], max: [-11.85, 1.8, 5], surf: 'fence', kind: 'fence' },
      { min: [11.85, 0, -18], max: [12, 1.8, 5], surf: 'fence', kind: 'fence' },
      { min: [-12, 0, -18.15], max: [12, 1.8, -18], surf: 'fence', kind: 'fence' },
    ],
    deco: [{ type: 'batter', at: [0.75, 0, 0.2] }, { type: 'zone', at: [0, 0, 0], w: 0.5, y0: 0.45, y1: 1.1 }, { type: 'plate', at: [0, 0, 0] }],
    hands: [{ pos: [0, 1.6, -13.7], yaw: Math.PI, pitch: 0.06, power: 6 }, { pos: [1.5, 1.6, -13.7], yaw: Math.PI - 0.1, pitch: 0.06, power: 6 }],
    tripod: [-2.2, 1.4, 1.5],
    camera: { pos: [3.5, 2.4, 4.5], look: [0, 1, -6] },
  },
  court: {
    name: 'Racquetball court',
    question: 'How does it sound in a big, hard, echoing room?',
    ground: 'wood', noiseDBA: 48,
    room: { V: 12.2 * 6.1 * 6.1, S: 2 * (74.4 + 74.4 + 37.2), alpha: 0.06 },
    sky: '#2b2b30',
    boxes: [...wallBoxes(6.1, 12.2, 6.1, 'concrete')],
    deco: [{ type: 'lines' }],
    hands: [{ pos: [0, 1.4, 2.5], yaw: 0, pitch: 0.25, power: 7 }, { pos: [-1.5, 1.4, 3.5], yaw: -0.2 }, { pos: [1.5, 1.4, 3.5], yaw: 0.2 }],
    tripod: [2.6, 1.5, 5.6],
    camera: { pos: [-2.2, 2.6, 5.7], look: [0, 1.2, -1] },
  },
};
