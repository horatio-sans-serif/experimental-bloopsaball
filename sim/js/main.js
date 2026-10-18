// Bloopsaball Studio: wires the pure modules (materials, physics, sensors,
// detector, persona, voice) to a three.js scene, Web Audio and the panels.
//
// Each ball is an "agent" made of addressable parts that only exchange plain
// messages, the same split the firmware uses:
//   physics → sensor frame → detector → {state, events} → persona → voice messages → audio
// Nothing downstream reads the true position or speed except the telemetry plot.

import * as THREE from '../vendor/three.module.js';
import {
  deriveDesign, DEFAULT_DESIGN, SHELLS, SPEAKERS, IMUS, BATTERIES, AMP_SUPPLY, SURFACES,
  simulateDrop, outsideBands, listenerBands, BANDS, rt60, speakerResponseDb,
} from './materials.js';
import { World, Ball, Hand, makeRng, predictPath, qRotate, sub, len, norm, dot } from './physics.js';
import { readFrame, FRAME_HZ } from './sensors.js';
import { Detector } from './detector.js';
import { Persona, moodOf } from './persona.js';
import { SCENES } from './scenes.js';
import { SLOTS, PATTERNS, PACKS } from './packs.js';
import { AudioEngine, recordClip, toWav, saveRecording, loadRecordings } from './audio.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('bloop.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bloop.' + k, JSON.stringify(v)); } catch { } },
};
const BALL_COLORS = ['#ff6a2b', '#2b9bff', '#2fbf71', '#c058ff', '#ffc12b', '#ff4f8b', '#22c3c3', '#8a8a8a'];
const FRAME = 1 / FRAME_HZ;

// ---------- state ----------
const S = {
  design: { ...DEFAULT_DESIGN, ...store.get('design', {}) },
  derived: null,
  sceneKey: store.get('scene', 'livingroom'),
  agents: [], sel: 0,
  listenerMode: 'camera',
  follow: false,
  adultEdition: false,
  idleToss: true,
  squeezeHeld: false,
  acc: 0,
};
S.derived = deriveDesign(S.design);

const world = new World();
const audio = new AudioEngine();
const rng = makeRng(11);

// ---------- three.js setup ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 200);
const sceneRoot = new THREE.Group(); scene3.add(sceneRoot);
const hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 1.1); scene3.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
scene3.add(sun); scene3.add(sun.target);

// Orbit camera: drag to turn, wheel to zoom, right-drag to slide.
const orbit = { target: new THREE.Vector3(), r: 4, theta: 0, phi: 1.1 };
function setCameraFrom(pos, look) {
  orbit.target.set(...look);
  const d = new THREE.Vector3(...pos).sub(orbit.target);
  orbit.r = d.length(); orbit.theta = Math.atan2(d.x, d.z); orbit.phi = Math.acos(d.y / orbit.r);
}
function updateCamera() {
  const { target, r, theta, phi } = orbit;
  camera.position.set(target.x + r * Math.sin(phi) * Math.sin(theta), target.y + r * Math.cos(phi), target.z + r * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
{
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button }; canvas.setPointerCapture(e.pointerId); canvas.focus(); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.b === 2 || e.shiftKey) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const fwd = new THREE.Vector3(Math.sin(orbit.theta), 0, Math.cos(orbit.theta));
      orbit.target.addScaledVector(right, -dx * orbit.r * 0.0015).addScaledVector(fwd, -dy * orbit.r * 0.0015);
      S.follow = false;
    } else {
      orbit.theta -= dx * 0.006; orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi - dy * 0.006));
    }
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.r = Math.max(0.4, Math.min(40, orbit.r * Math.exp(e.deltaY * 0.001))); }, { passive: false });
}

// ---------- scene building ----------
let sceneBoxesForAudio = [];
let tripodMesh = null;
function buildScene() {
  const sc = SCENES[S.sceneKey];
  sceneRoot.clear();
  world.setScene(sc);
  scene3.background = new THREE.Color(sc.sky);
  scene3.fog = sc.room ? null : new THREE.Fog(sc.sky, 25, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(sc.room ? 14 : 80, sc.room ? 14 : 80), new THREE.MeshStandardMaterial({ color: SURFACES[sc.ground].color, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; sceneRoot.add(ground);
  for (const b of sc.boxes) {
    if (b.see === false) continue;
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: b.color || SURFACES[b.surf].color, roughness: 0.85 }));
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    m.castShadow = b.kind !== 'wall'; m.receiveShadow = true;
    sceneRoot.add(m);
  }
  for (const d of sc.deco) sceneRoot.add(makeDeco(d));
  sceneBoxesForAudio = sc.boxes.filter(b => b.see !== false && b.kind !== 'wall');
  tripodMesh = makeTripod(sc.tripod[1]); tripodMesh.position.set(...sc.tripod); sceneRoot.add(tripodMesh);
  sun.position.set(sc.room ? 2 : 8, sc.room ? 6 : 14, sc.room ? 3 : 6);
  setCameraFrom(sc.camera.pos, sc.camera.look);
  audio.setScene(sc);
  $('scene-q').textContent = `${sc.question} Floor: ${SURFACES[sc.ground].name}. Background noise ${sc.noiseDBA} dBA. ${sc.room ? `Echo time ${rt60(sc.room).toFixed(1)} s.` : 'Outdoors, no echo.'}`;
}

function makeDeco(d) {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  if (d.type === 'tree') {
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(d.r * (1 - i * 0.25), d.h * 0.45, 16), mat('#2f6b3a'));
      c.position.set(d.at[0], 0.25 + d.h * 0.2 + i * d.h * 0.25, d.at[2]); c.castShadow = true; g.add(c);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb000', emissiveIntensity: 1 }));
    star.position.set(d.at[0], d.h + 0.1, d.at[2]); g.add(star);
    for (let i = 0; i < 24; i++) {
      const a = i * 2.4, y = 0.4 + (i / 24) * (d.h - 0.5), r = d.r * (1 - (y / d.h)) * 0.95 + 0.05;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025), new THREE.MeshStandardMaterial({ color: ['#ff4040', '#40a0ff', '#ffd040', '#40ff80'][i % 4], emissive: ['#ff2020', '#2080ff', '#ffb000', '#20ff60'][i % 4], emissiveIntensity: 1.2 }));
      bulb.position.set(d.at[0] + r * Math.cos(a), y, d.at[2] + r * Math.sin(a)); g.add(bulb);
    }
  } else if (d.type === 'rug') {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d.max[0] - d.min[0], d.max[1] - d.min[1]), mat(d.color));
    m.rotation.x = -Math.PI / 2; m.position.set((d.min[0] + d.max[0]) / 2, 0.003, (d.min[1] + d.max[1]) / 2); m.receiveShadow = true; g.add(m);
  } else if (d.type === 'batter') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.9, 4, 10), mat('#3a5fa0'));
    body.position.set(d.at[0], 0.75, d.at[2]); body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat('#e0b090')); head.position.set(d.at[0], 1.5, d.at[2]); g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#c8372d')); cap.position.set(d.at[0], 1.53, d.at[2]); g.add(cap);
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 10), mat('#ffd84a'));
    bat.position.set(d.at[0] - 0.05, 1.45, d.at[2] + 0.15); bat.rotation.x = 0.6; bat.rotation.z = 0.5; g.add(bat);
  } else if (d.type === 'zone') {
    const pts = [[-d.w / 2, d.y0], [d.w / 2, d.y0], [d.w / 2, d.y1], [-d.w / 2, d.y1], [-d.w / 2, d.y0]].map(([x, y]) => new THREE.Vector3(d.at[0] + x, y, d.at[2]));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 })));
  } else if (d.type === 'plate') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.01, 0.43), mat('#f4f4f0')); m.position.set(d.at[0], 0.005, d.at[2]); g.add(m);
  } else if (d.type === 'lines') {
    for (const z of [-0.6, 0.9]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 0.05), new THREE.MeshBasicMaterial({ color: '#c8372d' }));
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.004, z); g.add(m);
    }
  }
  return g;
}

// Phone on a tripod: the "At the phone on the tripod" listening spot.
// The group sits at the phone; legs run from just under it to the floor.
function makeTripod(height) {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.6 });
  const top = [0, -0.1, 0], spread = Math.max(0.15, height * 0.28);
  for (let i = 0; i < 3; i++) {
    const a = i * (2 * Math.PI / 3) + 0.3;
    const foot = [spread * Math.cos(a), -height, spread * Math.sin(a)];
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 6), black);
    placeLimb(leg, top, foot);
    g.add(leg);
  }
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.1, 10), black);
  head.position.y = -0.05; g.add(head);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.008), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#223', roughness: 0.3 }));
  phone.position.y = 0.04; g.add(phone);
  return g;
}

// ---------- ball, hand and aim meshes ----------
function makeFaceTexture(color, holes, expr) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 512, 256);
  // Holes: dark ellipses spread over the sphere (only the top half for "half").
  const n = Math.round(holes.openArea * 160);
  const r0 = 10;
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const v = Math.acos(1 - 2 * ((i * 0.618034) % 1)) / Math.PI;      // even on the sphere
    const u = (i * 0.381966 * 7.3) % 1;
    if (holes.layout === 'half' && v > 0.5) continue;
    if (Math.abs(u - 0.25) < 0.1 && Math.abs(v - 0.5) < 0.18) continue; // leave the face clear
    const sx = r0 / Math.max(0.25, Math.sin(v * Math.PI));
    g.fillStyle = 'rgba(20,14,10,0.75)';
    g.beginPath(); g.ellipse(u * 512, v * 256, Math.min(40, sx), r0, 0, 0, Math.PI * 2); g.fill();
    k++;
  }
  // Face at u = 0.25 (body +Z), which is where the speaker points: the mouth is the grille.
  const cx = 128, cy = 128;
  g.fillStyle = '#fff'; g.strokeStyle = '#1f1b16'; g.lineWidth = 3;
  const eye = (x, open) => {
    if (expr === 'asleep') { g.beginPath(); g.arc(x, cy - 22, 9, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke(); return; }
    if (expr === 'dizzy') { g.beginPath(); for (let a = 0; a < 12; a += 0.2) g.lineTo(x + Math.cos(a) * a, cy - 22 + Math.sin(a) * a); g.stroke(); return; }
    g.beginPath(); g.ellipse(x, cy - 22, 10, 13 * open, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1f1b16'; g.beginPath(); g.arc(x + (expr === 'nervous' ? 3 : 0), cy - 20, 4.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff';
  };
  const open = { calm: 0.8, uneasy: 1, nervous: 1.2, panicking: 1.35, scream: 1.4, whee: 0.6, oof: 0.3 }[expr] ?? 1;
  eye(cx - 20, open); eye(cx + 20, open);
  g.fillStyle = '#1f1b16';
  g.beginPath();
  if (expr === 'scream' || expr === 'panicking') g.ellipse(cx, cy + 14, 13, 16, 0, 0, Math.PI * 2);
  else if (expr === 'whee') { g.arc(cx, cy + 6, 16, 0, Math.PI); }
  else if (expr === 'nervous' || expr === 'oof') g.ellipse(cx, cy + 12, 6, 7, 0, 0, Math.PI * 2);
  else if (expr === 'uneasy') { g.lineWidth = 3; g.moveTo(cx - 14, cy + 12); for (let x = -14; x <= 14; x += 4) g.lineTo(cx + x, cy + 12 + ((x / 4) % 2 ? 3 : -3)); g.stroke(); }
  else { g.lineWidth = 3; g.arc(cx, cy + 4, 11, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
  g.fill();
  // Speaker grille dots in the mouth area.
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) { g.beginPath(); g.arc(cx + i * 5, cy + 14 + j * 5, 1.2, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBallMesh(agent) {
  const d = S.derived;
  const outer = new THREE.Group();
  const squash = new THREE.Group(); outer.add(squash);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
  const spin = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  spin.castShadow = true;
  squash.add(spin);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.06, 6, 32), new THREE.MeshBasicMaterial({ color: agent.color }));
  ring.rotation.x = Math.PI / 2; outer.add(ring);
  outer.scale.setScalar(d.R);
  agent.mesh = { outer, squash, spin, mat, ring, expr: null };
  scene3.add(outer);
}

function setExpression(agent, expr) {
  if (agent.mesh.expr === expr) return;
  agent.mesh.expr = expr;
  agent.mesh.mat.map?.dispose();
  agent.mesh.mat.map = makeFaceTexture(S.derived.shell.color, { openArea: S.design.openArea, layout: S.design.holeLayout }, expr);
  agent.mesh.mat.needsUpdate = true;
}

function makeHandMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: '#e2b593', roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.022, 0.095), skin);
  palm.position.y = -0.011; palm.castShadow = true; g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 3, 6), skin);
    f.position.set(-0.03 + i * 0.02, 0.004, -0.06); f.rotation.x = -1.0; f.castShadow = true; g.add(f);
  }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.04, 3, 6), skin);
  th.position.set(0.05, 0.0, 0.0); th.rotation.z = -0.9; g.add(th);
  scene3.add(g);
  return g;
}

// ---------- arm: two joints, solved each frame ----------
// Shoulder fixed beside and behind the hand's rest spot; upper arm and forearm
// have fixed lengths. Given where the wrist must be, the elbow position follows
// from the triangle (law of cosines), bent down and outward like a real arm.
const ARM = { shoulder: [0.16, 0.2, 0.26], upper: 0.34, fore: 0.32, wrist: [0, -0.006, 0.05] };
const rotY = (v, yaw) => [v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), v[1], -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];

function makeArm() {
  const skin = new THREE.MeshStandardMaterial({ color: '#e2b593', roughness: 0.7 });
  const sleeve = new THREE.MeshStandardMaterial({ color: '#c94b3b', roughness: 0.9 });
  const limb = (r0, r1, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 10), mat); m.castShadow = true; return m; };
  const g = new THREE.Group();
  const upper = limb(0.034, 0.03, sleeve), fore = limb(0.028, 0.021, skin);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), sleeve);
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), sleeve);
  g.add(upper, fore, elbow, shoulder);
  scene3.add(g);
  return { g, upper, fore, elbow, shoulder };
}

function placeLimb(mesh, from, to) {
  const d = sub(to, from), L = len(d);
  mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
  mesh.quaternion.setFromUnitVectors(Y, tmpV.set(...d).normalize());
  mesh.scale.set(1, L, 1);
}

function poseArm(arm, hand) {
  const S = add3(hand.pos, rotY(ARM.shoulder, hand.yaw));
  let W = add3(hand.palmP, rotY(ARM.wrist, hand.yaw));
  const { upper: L1, fore: L2 } = ARM;
  const toW = sub(W, S), dRaw = len(toW);
  const u = norm(toW);
  const d = Math.max(Math.abs(L1 - L2) + 0.01, Math.min(L1 + L2 - 0.001, dRaw));
  if (dRaw > d) W = add3(S, u.map(e => e * d));          // out of reach: the arm goes straight
  const pole = norm(rotY([0.5, -1, 0.3], hand.yaw));
  const pp = norm(sub(pole, u.map(e => e * dot(pole, u))));
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const up = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  const E = [S[0] + u[0] * along + pp[0] * up, S[1] + u[1] * along + pp[1] * up, S[2] + u[2] * along + pp[2] * up];
  placeLimb(arm.upper, S, E);
  placeLimb(arm.fore, E, W);
  arm.elbow.position.set(...E);
  arm.shoulder.position.set(...S);
}
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function makeAim() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), mat); shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 12), mat);
  g.add(shaft, head);
  g.renderOrder = 10; shaft.renderOrder = 10; head.renderOrder = 10;
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.8 }));
  scene3.add(g, path);
  return { g, shaft, head, mat, path };
}
const aim = makeAim();

// ---------- agents ----------
function addAgent() {
  const sc = SCENES[S.sceneKey];
  const i = S.agents.length;
  const spot = sc.hands[i % sc.hands.length];
  const lap = Math.floor(i / sc.hands.length);
  const pos = [spot.pos[0] + lap * 0.35, spot.pos[1], spot.pos[2] + lap * 0.2];
  const id = (S.agents.at(-1)?.id || 0) + 1;
  const hand = new Hand(id, pos, spot.yaw);
  hand.pitch = spot.pitch ?? 0.45; hand.power = spot.power ?? 4; hand.idleToss = S.idleToss;
  const ball = new Ball(id, S.derived, pos);
  world.balls.push(ball); world.hands.push(hand);
  hand.grab(ball, world.t);
  const agent = {
    id, ball, hand, color: BALL_COLORS[(id - 1) % BALL_COLORS.length],
    det: new Detector({ massKg: S.derived.mass, cor: S.derived.cor }),
    persona: new Persona({ adultEdition: S.adultEdition }),
    voice: null, out: null, hist: [], log: [],
    handMesh: makeHandMesh(), arm: makeArm(), bubble: document.createElement('div'),
    flightMaxH: 0, lastTrueSpeed: 0, truthImpact: null, dBA: -99, caption: null,
  };
  agent.persona.mode = S.agents[S.sel]?.persona.mode ?? 'whee';
  agent.bubble.className = 'bubble'; agent.bubble.style.opacity = 0;
  $('bubbles').appendChild(agent.bubble);
  makeBallMesh(agent);
  if (audio.ready) setupVoice(agent);
  S.agents.push(agent);
  S.sel = S.agents.length - 1;
  renderBalls();
  return agent;
}

function removeAgent(agent) {
  if (!agent) return;
  agent.hand.release();
  world.balls = world.balls.filter(b => b !== agent.ball);
  world.hands = world.hands.filter(h => h !== agent.hand);
  scene3.remove(agent.mesh.outer, agent.handMesh, agent.arm.g);
  agent.mesh.mat.map?.dispose();
  agent.bubble.remove();
  agent.voice?.dispose();
  S.agents = S.agents.filter(a => a !== agent);
  S.sel = Math.max(0, Math.min(S.sel, S.agents.length - 1));
  renderBalls();
}

function resetAgents() {
  const n = Math.max(1, S.agents.length);
  [...S.agents].forEach(removeAgent);
  for (let i = 0; i < n; i++) addAgent();
  S.sel = 0; renderBalls(); syncThrowUI();
  cameraBehind(selAgent());
}

// Golf-game view: behind and above the thrower, looking down the aim.
function cameraBehind(a) {
  if (!a) return;
  const d = a.hand.aimDir();
  const hz = norm([d[0], 0, d[2]]);
  const p = a.hand.pos;
  // Step 0.6 m to the left so the right arm and shoulder don't block the view.
  const left = [hz[2], 0, -hz[0]];
  setCameraFrom([p[0] - hz[0] * 1.5 + left[0] * 0.6, p[1] + 0.55, p[2] - hz[2] * 1.5 + left[2] * 0.6], [p[0] + hz[0] * 1.2, p[1] - 0.1, p[2] + hz[2] * 1.2]);
}

const selAgent = () => S.agents[S.sel];

// ---------- simulation step ----------
function stepFrame() {
  world.step(FRAME);
  for (const a of S.agents) {
    const prevSpeed = Math.hypot(...a.ball.v);
    const f = readFrame(a.ball, world.t, rng);
    const out = a.det.step(f);
    a.out = out;
    // Truth bookkeeping for the telemetry only.
    if (out.state === 'FLIGHT') a.flightMaxH = Math.max(a.flightMaxH, f.truth.height);
    if (f.truth.contactPeakN < 1) a.lastTrueSpeed = prevSpeed;
    for (const e of out.events) {
      if (e.type === 'launch') { a.flightMaxH = f.truth.height; a.launchH = f.truth.height; }
      if (e.type === 'impact') a.truthImpact = { speed: a.lastTrueSpeed, drop: a.flightMaxH - Math.max(0, f.truth.height), peakG: a.peakTrue || 0 };
      a.log.unshift({ t: world.t, e });
    }
    a.peakTrue = Math.max(a.peakTrue || 0, f.truth.peakGTrue);
    if (out.state === 'FLIGHT') a.peakTrue = 0;
    if (a.log.length > 8) a.log.length = 8;
    const cmds = a.persona.step(out, FRAME);
    for (const c of cmds) {
      if (c.type === 'settings') { if (a === selAgent()) syncPersonaUI(); continue; }
      a.voice?.command(c, a.persona);
      if (!a.voice && c.type === 'say') {
        const ph = (a.persona.adult ? PACKS.adult : PACKS.kid).phrases[c.slot];
        a.caption = { text: ph?.text ?? c.slot, t: performance.now() };
      }
      if (!a.voice && c.type === 'sustainStart') a.caption = { text: PACKS.kid.phrases[c.kind]?.text, t: performance.now(), sustain: true };
      if (!a.voice && c.type === 'sustainStop' && a.caption) a.caption.sustain = false;
    }
    a.hist.push({
      a: Math.hypot(...f.a), pk: f.aPeak, spin: out.features.spinRps, sat: f.wSat,
      pz: Math.abs(f.piezoMax) > Math.abs(f.piezoMin) ? f.piezoMax : f.piezoMin,
      h: f.truth.height, hEst: out.state === 'FLIGHT' ? out.features.heightEst + (a.launchH || 0) : null,
      state: out.state, anx: a.persona.anx,
    });
    if (a.hist.length > 600) a.hist.shift();
  }
}

// ---------- audio geometry ----------
function listenerPose() {
  if (S.listenerMode === 'tripod') {
    const sc = SCENES[S.sceneKey];
    const p = sc.tripod;
    const c = selAgent()?.ball.p ?? sc.hands[0].pos;
    return { pos: p, fwd: norm(sub(c, p)), up: [0, 1, 0] };
  }
  const f = new THREE.Vector3(); camera.getWorldDirection(f);
  return { pos: camera.position.toArray(), fwd: f.toArray(), up: [0, 1, 0] };
}

function segmentHitsBox(p, q, b) {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k] - p[k];
    if (Math.abs(d) < 1e-9) { if (p[k] < b.min[k] || p[k] > b.max[k]) return false; continue; }
    let ta = (b.min[k] - p[k]) / d, tb = (b.max[k] - p[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return t0 > 0.02 && t0 < 0.98;
}

function audioGeom(agent, L) {
  const b = agent.ball, sc = SCENES[S.sceneKey];
  const toL = sub(L.pos, b.p);
  const dist = len(toL);
  const axis = qRotate(b.q, [0, 0, 1]);
  const facing = dot(axis, norm(toL));
  const blocked = sceneBoxesForAudio.filter(box => segmentHitsBox(b.p, L.pos, box)).length;
  const faceDown = b.p[1] < b.d.R + 0.01 && axis[1] < -0.7;
  return { dist, blocked, facing, faceDown, room: sc.room };
}

// Predicted loudness at the listener (dBA) from the voice's current level.
function loudnessAt(agent, geom) {
  const lvl = agent.voice ? agent.voice.level : (agent.out?.state === 'FLIGHT' ? 0.3 : 0.06);
  const frac = Math.min(1, (lvl / 0.707) ** 2);
  const kind = lvl > 0.15 || (agent.persona.sustain && agent.persona.sustain.kind !== 'dizzy') ? 'scream' : 'murmur';
  const extra = BANDS.map(f => geom.blocked * (f >= 1000 ? 14 : 6) + (geom.faceDown && f >= 2000 ? 6 : 0) + 3 * (1 - geom.facing) * (f >= 2000 ? 1 : 0));
  return listenerBands(outsideBands(S.derived, kind, Math.max(1e-6, frac)), geom.dist, geom.room, extra).dBA;
}

// ---------- render loop ----------
let last = performance.now();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  S.acc += dt;
  let steps = 0;
  while (S.acc >= FRAME && steps < 6) { stepFrame(); S.acc -= FRAME; steps++; }
  if (steps === 6) S.acc = 0;

  const sel = selAgent();
  if (S.follow && sel) orbit.target.lerp(tmpV.set(...sel.ball.p), 0.12);
  updateCamera();
  const L = listenerPose();
  audio.setListener(L.pos, L.fwd, L.up);
  tripodMesh.visible = S.listenerMode === 'tripod' || true;

  for (const a of S.agents) {
    const b = a.ball, m = a.mesh;
    m.outer.position.set(...b.p);
    m.outer.scale.setScalar(b.d.R);
    const c = Math.min(0.45, (b.sense.compressMax || b.compress) / b.d.R);
    tmpQ.setFromUnitVectors(Y, tmpV.set(...b.compressN));
    m.squash.quaternion.copy(tmpQ);
    m.squash.scale.set(1 + c * 0.5, 1 - c, 1 + c * 0.5);
    tmpQ2.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    m.spin.quaternion.copy(tmpQ.clone().invert().multiply(tmpQ2));
    m.ring.visible = a === sel && S.agents.length > 1;
    // Face follows mood and what it is doing.
    const p = a.persona;
    let expr = p.asleep ? 'asleep' : moodOf(p.anx);
    if (p.sustain) expr = p.sustain.kind === 'dizzy' ? 'dizzy' : p.sustain.kind === 'whee' ? 'whee' : 'scream';
    else if (a.out?.state === 'ROLL') expr = 'dizzy';
    setExpression(a, expr);
    // Hand.
    const h = a.hand;
    // The drawn palm is the physics palm box; the arm bends to reach it.
    a.handMesh.position.set(...h.palmP);
    poseArm(a.arm, h);
    a.handMesh.rotation.y = h.yaw;
    // Sound placement.
    const geom = audioGeom(a, L);
    a.voice?.place(b.p, geom);
    const dBA = loudnessAt(a, geom);
    a.dBA = Math.max(dBA, a.dBA - 0.6);
    a.geom = geom;
    a.utt = utterance(a, now);
    if ((a.utt.kind === 'phrase' || a.utt.kind === 'sustain') && a.utt.text !== a.lastSaid) {
      a.lastSaid = a.utt.text;
      a.said = [a.utt.text, ...(a.said || [])].slice(0, 4);
    } else if (a.utt.kind === 'murmur' || a.utt.kind === 'rest') a.lastSaid = null;
    drawBubble(a, now);
  }
  drawAim(sel);
  renderer.render(scene3, camera);
  if ((now / 1000 * 15 | 0) !== S.lastUi) { S.lastUi = now / 1000 * 15 | 0; drawTrace(); drawReadout(); drawSaying(now); updateModeline(); renderBallMeta(); }
  requestAnimationFrame(frame);
}

function drawAim(a) {
  const show = a && a.hand.ball === a.ball && ['hold', 'catch', 'toss', 'air'].includes(a.hand.state);
  aim.g.visible = aim.path.visible = !!show;
  if (!show) return;
  const h = a.hand, dir = h.aimDir();
  const L = 0.25 + h.power * 0.09;
  aim.g.position.set(...a.ball.p);
  aim.g.quaternion.setFromUnitVectors(Y, tmpV.set(...dir));
  aim.shaft.scale.y = L; aim.shaft.position.y = L / 2; aim.head.position.y = L + 0.04;
  aim.mat.color.setHSL(0.33 - 0.33 * (h.power - 1) / 9, 0.9, 0.55);
  const key = [h.yaw, h.pitch, h.power, h.spin, ...a.ball.p.map(v => v.toFixed(2)), S.design.diameterMm, S.design.shell].join();
  if (key !== aim.key) {
    aim.key = key;
    const pts = predictPath(S.derived, a.ball.p, dir.map(v => v * h.speed()), h.spinVec(), world.boxes);
    aim.path.geometry.dispose();
    aim.path.geometry = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    aim.path.computeLineDistances();
  }
}

const MURMUR_TEXT = { calm: ['hmm…', 'mm.', 'uh… ah…', 'hm-hm'], nervous: ['uh-ah… oh-um…', 'uh? uh?', 'hmm-hmm-hm', 'oh… oh…'], pant: ['ha-ha-ha-ha', 'hhh-hhh-hhh', 'eep eep'] };
// What a ball is saying right now, from the voice itself when sound is on
// (so the screen matches what you hear), else from the persona's messages.
function utterance(a, now) {
  if (a.persona.asleep) return { kind: 'asleep', text: 'asleep' };
  if (a.voice) {
    const n = a.voice.now;
    if (n && n.kind !== 'rest' && n.text) { a.lastUtt = { ...n, t: now }; return n; }
    if (a.lastUtt && a.lastUtt.kind !== 'murmur' && now - a.lastUtt.t < 600) return a.lastUtt;   // let a line linger briefly
    return { kind: 'rest', text: '' };
  }
  const cap = a.caption;
  if (cap && (cap.sustain || now - cap.t < 1700)) return { kind: cap.sustain ? 'sustain' : 'phrase', text: cap.text };
  if (a.out && (a.out.state === 'HELD' || a.out.state === 'REST')) {
    const style = a.persona.anx > 0.85 ? 'pant' : a.persona.anx > 0.45 ? 'nervous' : 'calm';
    if (!a.murmur || now - a.murmur.t > 2200 || a.murmur.style !== style) {
      const list = MURMUR_TEXT[style];
      a.murmur = { text: list[Math.floor(Math.random() * list.length)], t: now, style };
    }
    return { kind: 'murmur', text: a.murmur.text };
  }
  return { kind: 'rest', text: '' };
}

function drawBubble(a, now) {
  const el = a.bubble;
  const u = a.utt;
  tmpV.set(a.ball.p[0], a.ball.p[1] + a.ball.d.R * 1.6, a.ball.p[2]).project(camera);
  const visible = tmpV.z < 1;
  const rect = canvas.getBoundingClientRect();
  el.style.left = ((tmpV.x + 1) / 2 * rect.width) + 'px';
  el.style.top = ((1 - tmpV.y) / 2 * rect.height) + 'px';
  const who = S.agents.length > 1 ? `<span class="who">${a.id}</span>` : '';
  if (u.kind === 'phrase' || u.kind === 'sustain') {
    el.className = 'bubble';
    el.innerHTML = who + escapeHtml(u.text);
    el.style.fontSize = (13 + 8 * Math.min(1, a.voice ? a.voice.level / 0.35 : 1)) + 'px';
    el.style.opacity = visible ? 1 : 0;
  } else if (u.kind === 'murmur') {
    el.className = 'bubble murmur';
    el.innerHTML = who + escapeHtml(u.text);
    el.style.fontSize = '12px';
    el.style.opacity = visible ? 0.85 : 0;
  } else el.style.opacity = 0;
}

// One line per ball: what it is saying now, plus the selected ball's last few lines.
function drawSaying(now) {
  const sel = selAgent();
  const rows = S.agents.map(a => {
    const u = a.utt || { kind: 'rest', text: '' };
    const text = u.kind === 'rest' ? '—' : escapeHtml(u.text);
    return `<li class="${u.kind}${a === sel ? ' sel' : ''}"><span class="dot" style="background:${a.color}"></span><span class="who">Ball ${a.id}</span><span class="line">${text}</span></li>`;
  }).join('');
  const said = sel?.said?.length ? `<p class="said">Before: ${sel.said.map(escapeHtml).join(' · ')}</p>` : '';
  $('saying').innerHTML = `<h4>Saying now</h4><ul>${rows}</ul>${said}`;
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- telemetry ----------
const trace = $('trace');
function drawTrace() {
  const a = selAgent();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = trace.clientWidth, H = trace.clientHeight;
  if (trace.width !== W * dpr) { trace.width = W * dpr; trace.height = H * dpr; }
  const g = trace.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!a) return;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  const lanes = [
    { name: 'acceleration (g)', key: 'pk', max: 20, color: '#ff6a2b', fmt: v => v.toFixed(1) + ' g', scale: v => Math.sqrt(v / 20) },
    { name: 'spin (turns/s)', key: 'spin', max: 30, color: '#2b9bff', fmt: v => v.toFixed(1) },
    { name: 'piezo (V)', key: 'pz', max: 1.6, color: '#2fbf71', fmt: v => v.toFixed(2) + ' V', signed: true },
    { name: 'height: true (solid) vs sensed (dashed), m', key: 'h', max: 5, color: '#c058ff', fmt: v => v.toFixed(2) + ' m' },
  ];
  const lh = (H - 8) / lanes.length, x0 = 6, w = W - 12;
  const n = a.hist.length;
  lanes.forEach((ln, i) => {
    const y0 = 4 + i * lh;
    g.strokeStyle = line; g.beginPath(); g.moveTo(x0, y0 + lh); g.lineTo(x0 + w, y0 + lh); g.stroke();
    // Shade flight time.
    g.fillStyle = 'rgba(255,106,43,0.07)';
    for (let k = 0; k < n; k++) if (a.hist[k].state === 'FLIGHT') g.fillRect(x0 + w * (1 - (n - k) / 600), y0, w / 600 + 0.5, lh);
    const yOf = v => {
      const s = ln.scale ? ln.scale(Math.max(0, v)) : ln.signed ? 0.5 + 0.5 * v / ln.max : v / ln.max;
      return y0 + lh - 2 - Math.max(0, Math.min(1, s)) * (lh - 6);
    };
    g.strokeStyle = ln.color; g.lineWidth = 1.5; g.beginPath();
    for (let k = 0; k < n; k++) { const x = x0 + w * (1 - (n - k) / 600), y = yOf(a.hist[k][ln.key]); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    if (ln.key === 'h') {
      g.setLineDash([4, 3]); g.beginPath(); let pen = false;
      for (let k = 0; k < n; k++) {
        const v = a.hist[k].hEst; const x = x0 + w * (1 - (n - k) / 600);
        if (v == null) { pen = false; continue; }
        pen ? g.lineTo(x, yOf(v)) : g.moveTo(x, yOf(v)); pen = true;
      }
      g.stroke(); g.setLineDash([]);
    }
    if (ln.key === 'spin') {
      const lim = S.derived.imu.gyroDps / 360;
      g.strokeStyle = 'rgba(200,55,45,0.6)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x0, yOf(lim)); g.lineTo(x0 + w, yOf(lim)); g.stroke(); g.setLineDash([]);
    }
    const lastV = n ? a.hist[n - 1][ln.key] : 0;
    g.fillStyle = ink; g.font = '11px system-ui, sans-serif';
    g.fillText(`${ln.name}  ${ln.fmt(lastV ?? 0)}`, x0 + 4, y0 + 12);
  });
}

function drawReadout() {
  const a = selAgent();
  const el = $('readout');
  if (!a || !a.out) { el.innerHTML = ''; return; }
  const p = a.persona, f = a.out.features, im = f.lastImpact, tr = a.truthImpact;
  const sc = SCENES[S.sceneKey];
  const margin = a.dBA - sc.noiseDBA;
  const verdict = margin > 10 ? ['clear', 'good'] : margin > 3 ? ['audible', 'warn'] : ['buried in the noise', 'bad'];
  const stateName = { HELD: 'In a hand', REST: 'Sitting still', FLIGHT: 'In the air', BOUNCE: 'Bouncing', ROLL: 'Rolling' }[a.out.state] || a.out.state;
  const rows = [
    ['Mode', `${p.mode}${p.adult ? ' · adult words' : ''}${p.mine ? ' · my voice' : ''}${p.asleep ? ' · asleep' : ''}`],
    ['Heard here', `<span class="${verdict[1]}">${a.dBA.toFixed(0)} dBA, ${verdict[0]}</span>`],
  ];
  if (a.out.state === 'FLIGHT') {
    rows.push(['Air time', `${f.airtime.toFixed(2)} s`], ['Spin', `${f.spinRps.toFixed(1)} turns/s${f.spinSat ? ' (maxed out)' : ''}`], ['Sideways air force', `${(f.lateralG * 1000).toFixed(0)} mg${f.curving ? ' · curving' : ''}`]);
  } else if (im) {
    rows.push(['Last hit', `${im.forceN.toFixed(0)} N, ${im.peakG.toFixed(0)} g${im.sat ? ' (sensor maxed)' : ''}`]);
    if (tr) rows.push(['Speed sensed / true', `${im.speedEst.toFixed(1)} / ${tr.speed.toFixed(1)} m/s`]);
    if (im.fallEst != null && tr) rows.push(['Fall sensed / true', `${im.fallEst.toFixed(2)} / ${tr.drop.toFixed(2)} m`]);
  }
  if (f.code) rows.push(['Squeezes', `<span class="mono">${f.code.split('').join(' ')}</span>`]);
  el.innerHTML = `<div class="state">Ball ${a.id}: ${stateName} · ${moodOf(p.anx)}</div>
    <div class="bar"><i style="width:${(p.anx * 100).toFixed(0)}%"></i></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function updateModeline() {
  const a = selAgent();
  if (!a) { $('modeline').textContent = 'No balls. Press n to add one.'; return; }
  const h = a.hand, held = h.ball === a.ball;
  const what = held ? `aiming ${h.speed().toFixed(1)} m/s${h.spin ? `, curve ${h.spin > 0 ? 'left' : 'right'} ${Math.abs(h.spin)}/s` : ''}` : 'loose (press r to pick up)';
  $('modeline').innerHTML = `<b>${S.squeezeHeld ? 'SQUEEZE' : 'AIM'}</b> · Ball ${S.sel + 1} of ${S.agents.length} · ${what} · ${a.persona.mode} mode${S.follow ? ' · following' : ''}`;
}

// ---------- design panel ----------
function fillSelect(id, obj, val) {
  const el = $(id);
  el.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  el.value = val;
}
function initDesignPanel() {
  fillSelect('d-shell', SHELLS, S.design.shell);
  fillSelect('d-speaker', SPEAKERS, S.design.speaker);
  fillSelect('d-amp', AMP_SUPPLY, S.design.amp);
  fillSelect('d-imu', IMUS, S.design.imu);
  fillSelect('d-battery', BATTERIES, S.design.battery);
  $('d-layout').value = S.design.holeLayout;
  $('d-diameter').value = S.design.diameterMm; $('d-core').value = S.design.coreMm; $('d-open').value = Math.round(S.design.openArea * 100);
  const bind = (id, key, conv = v => v) => $(id).addEventListener('input', e => { S.design[key] = conv(e.target.value); designChanged(); });
  bind('d-shell', 'shell'); bind('d-speaker', 'speaker'); bind('d-amp', 'amp'); bind('d-imu', 'imu'); bind('d-battery', 'battery');
  bind('d-layout', 'holeLayout');
  bind('d-diameter', 'diameterMm', Number); bind('d-core', 'coreMm', Number); bind('d-open', 'openArea', v => Number(v) / 100);
  renderDesign();
}

function designChanged() {
  S.derived = deriveDesign(S.design);
  store.set('design', S.design);
  for (const a of S.agents) {
    a.ball.d = S.derived;
    a.det.configure(S.derived.mass, S.derived.cor);
    a.voice?.applyDesign(S.derived);
    a.mesh.expr = null;
  }
  aim.key = null;
  renderDesign();
}

function renderDesign() {
  const d = S.derived, sc = SCENES[S.sceneKey], surf = SURFACES[sc.ground];
  $('o-diameter').textContent = `${S.design.diameterMm} mm`;
  $('o-core').textContent = `${S.design.coreMm} mm`;
  $('o-open').textContent = `${Math.round(S.design.openArea * 100)}%`;
  $('d-shell-note').textContent = d.shell.note;
  const drop1 = simulateDrop(d, 1, surf), drop2 = simulateDrop(d, 2, surf);
  const tripodDist = len(sub(sc.tripod, sc.hands[0].pos));
  const full = listenerBands(outsideBands(d, 'scream', 1), tripodDist, sc.room);
  const m1 = listenerBands(outsideBands(d, 'scream', 1), 1, null).directDBA - 3;
  const margin = full.dBA - sc.noiseDBA;
  const gClass = drop2.peakG > 1500 ? 'bad' : drop2.peakG > 500 ? 'warn' : 'good';
  const gText = drop2.peakG > 1500 ? 'Risky for solder joints and the speaker coil.' : drop2.peakG > 500 ? 'Survivable if the core is potted in silicone.' : 'Gentle on the electronics.';
  const loudClass = margin > 10 ? 'good' : margin > 3 ? 'warn' : 'bad';
  $('results').innerHTML = `<dl>
    <dt>Size and weight</dt><dd>${S.design.diameterMm} mm, ${(d.mass * 1000).toFixed(0)} g</dd>
    <dd class="verdict note">A tennis ball is 67 mm and 58 g.</dd>
    <dt>Foam around the core</dt><dd>${(d.shellT * 1000).toFixed(1)} mm</dd>
    <dt>Bounce (1 m drop on ${surf.name})</dt><dd>${(drop1.reboundH * 100).toFixed(0)} cm back up</dd>
    <dt>Core shock (2 m drop)</dt><dd class="${gClass}">${drop2.peakG.toFixed(0)} g for ${drop2.contactMs.toFixed(1)} ms</dd>
    <dd class="verdict ${gClass}">${gText}${drop2.bottomedOut ? ' The foam bottomed out on the core.' : ''}</dd>
    <dt>Loudest scream at 1 m</dt><dd>${m1.toFixed(0)} dBA</dd>
    <dt>At the tripod (${tripodDist.toFixed(1)} m)</dt><dd class="${loudClass}">${full.dBA.toFixed(0)} dBA vs ${sc.noiseDBA} room</dd>
    <dd class="verdict ${loudClass}">${margin > 10 ? 'Clearly heard on a phone video.' : margin > 3 ? 'Heard, but the room competes with it.' : 'Lost in the room noise. Add holes, a bigger speaker or the 5 V boost.'}</dd>
    <dt>Battery, murmuring</dt><dd>${d.battery.activeH.toFixed(1)} h</dd>
    <dt>Battery, asleep</dt><dd>${d.battery.standbyDays.toFixed(0)} days</dd>
    <dt>Parts cost</dt><dd>$${d.costUsd.total.toFixed(2)}</dd>
  </dl>`;
  $('warnings').innerHTML = d.warnings.map(w => `<li>${w}</li>`).join('');
  $('bom-table').innerHTML = Object.entries(d.costUsd.lines).map(([k, v]) => `<tr><td>${k}</td><td>$${v.toFixed(2)}</td></tr>`).join('') + `<tr><td><b>Total</b></td><td><b>$${d.costUsd.total.toFixed(2)}</b></td></tr>`;
  // Chart: shell loss bars + speaker roll-off line.
  const svg = $('tl-chart'), W = 280, H = 110, top = 8, bot = 22, maxDb = 40;
  const bw = (W - 20) / BANDS.length;
  const y = db => top + (Math.min(maxDb, Math.max(0, db)) / maxDb) * (H - top - bot);
  let s = `<line x1="10" x2="${W - 10}" y1="${top}" y2="${top}" stroke="currentColor" opacity="0.15"/>`;
  BANDS.forEach((f, i) => {
    const x = 10 + i * bw;
    s += `<rect class="bar" x="${x + 4}" y="${top}" width="${bw - 8}" height="${y(d.tl[i]) - top}" rx="2"/>`;
    s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${f >= 1000 ? f / 1000 + 'k' : f}</text>`;
    s += `<text x="${x + bw / 2}" y="${y(d.tl[i]) + 10}" text-anchor="middle">−${d.tl[i].toFixed(0)}</text>`;
  });
  const spk = BANDS.map((f, i) => `${10 + i * bw + bw / 2},${y(-speakerResponseDb(f, d.spk.fRes))}`).join(' ');
  s += `<polyline class="spk" points="${spk}"/><text x="${W - 12}" y="${H - 22}" text-anchor="end">dashed: speaker has no bass</text>`;
  svg.innerHTML = s;
}

// ---------- play panel ----------
function initPlayPanel() {
  $('scenes').innerHTML = Object.entries(SCENES).map(([k, v], i) => `<button data-scene="${k}">${i + 1}. ${v.name}</button>`).join('');
  $('scenes').addEventListener('click', e => { const k = e.target.closest('button')?.dataset.scene; if (k) setScene(k); e.target.blur(); });
  $('add-ball').onclick = e => { addAgent(); e.target.blur(); };
  $('remove-ball').onclick = e => { removeAgent(selAgent()); e.target.blur(); };
  $('b-throw').onclick = e => { doThrow(); e.target.blur(); };
  $('b-drop').onclick = e => { doDrop(); e.target.blur(); };
  $('b-pick').onclick = e => { doPick(); e.target.blur(); };
  $('b-all').onclick = e => { throwAll(); e.target.blur(); };
  $('t-idle').onchange = e => { S.idleToss = e.target.checked; S.agents.forEach(a => { a.hand.idleToss = S.idleToss; }); };
  const aimBind = (id, key, conv) => $(id).addEventListener('input', e => { const a = selAgent(); if (a) { a.hand[key] = conv(Number(e.target.value)); syncThrowUI(); } });
  aimBind('t-power', 'power', v => v);
  aimBind('t-pitch', 'pitch', v => v * Math.PI / 180);
  aimBind('t-yaw', 'yaw', v => v * Math.PI / 180);
  aimBind('t-spin', 'spin', v => v);
  $('modes').addEventListener('click', e => { const m = e.target.closest('button')?.dataset.mode; const a = selAgent(); if (m && a) { a.persona.setMode(m); syncPersonaUI(); } e.target.blur(); });
  $('p-edition').onchange = e => {
    S.adultEdition = e.target.checked;
    S.agents.forEach(a => { a.persona.adultEdition = S.adultEdition; if (!S.adultEdition) a.persona.adult = false; });
    syncPersonaUI();
  };
  $('p-adult').onchange = e => { const a = selAgent(); if (a) a.persona.adult = e.target.checked; };
  $('p-mine').onchange = e => { const a = selAgent(); if (a) a.persona.mine = e.target.checked; };
  const sq = $('squeeze');
  sq.addEventListener('pointerdown', e => { e.preventDefault(); setSqueeze(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => sq.addEventListener(t, () => setSqueeze(false)));
  $('patterns').innerHTML = Object.entries(PATTERNS).map(([k, v]) => `<tr><td>${k === 'H' ? 'hold 2 s' : k.split('').join(' ')}</td><td>${v.label}</td></tr>`).join('') + '<tr><td></td><td class="note">S = quick squeeze, L = squeeze for half a second.</td></tr>';
  $('l-mode').onchange = e => { S.listenerMode = e.target.value; };
  $('l-noise').onchange = e => audio.setNoise(e.target.checked);
  audio.echoOn = store.get('echo', false);
  $('l-echo').checked = audio.echoOn;
  $('l-echo').onchange = e => { audio.echoOn = e.target.checked; store.set('echo', audio.echoOn); };
  audio.raw = store.get('raw', false);
  $('l-raw').checked = audio.raw;
  $('l-raw').onchange = e => { audio.raw = e.target.checked; store.set('raw', audio.raw); S.agents.forEach(a => a.voice?.applyDesign(S.derived)); };
  S.voiceStyle = store.get('voiceStyle', 'recorded');
  if (S.voiceStyle !== 'spirit') S.voiceStyle = 'recorded';     // the old "human-ish" synth style is gone
  $('styles').addEventListener('click', e => {
    const st = e.target.closest('button')?.dataset.style; if (!st) return;
    S.voiceStyle = st; store.set('voiceStyle', st);
    S.agents.forEach(a => a.voice?.command({ type: 'voice', style: st }, a.persona));
    syncStyleUI(); e.target.blur();
  });
  syncStyleUI();
  const vol = store.get('volume', 6);
  $('l-vol').value = vol; $('o-vol').textContent = `${vol > 0 ? '+' : ''}${vol} dB`; audio.volumeDb = vol;
  $('l-vol').oninput = e => { const v = Number(e.target.value); $('o-vol').textContent = `${v > 0 ? '+' : ''}${v} dB`; audio.setVolume(v); store.set('volume', v); };
  $('voice-panel').addEventListener('toggle', () => { if ($('voice-panel').open) renderSlots(); });
  $('sound').onclick = startSound;
}

function setupVoice(a) {
  a.voice = audio.createVoice();
  a.voice.applyDesign(S.derived);
  a.voice.command({ type: 'voice', style: S.voiceStyle }, a.persona);
}
function syncStyleUI() {
  document.querySelectorAll('#styles button').forEach(b => b.classList.toggle('on', b.dataset.style === S.voiceStyle));
  $('voice-note').textContent = S.voiceStyle === 'spirit'
    ? 'The built-in synthesizer. Good for the art piece, not for a toy.'
    : `Recorded clips. The starter pack is the Mac's ${audio.packs.voice || 'Samantha'} voice standing in for a voice actor; anything you record below replaces it.`;
}

function syncThrowUI() {
  const a = selAgent(); if (!a) return;
  const h = a.hand;
  $('t-power').value = h.power; $('o-power').textContent = `${h.power} → ${h.speed().toFixed(1)} m/s`;
  const deg = v => Math.round(v * 180 / Math.PI);
  $('t-pitch').value = deg(h.pitch); $('o-pitch').textContent = `${deg(h.pitch)}°`;
  let y = deg(h.yaw); y = ((y + 540) % 360) - 180;
  $('t-yaw').value = y; $('o-yaw').textContent = `${y}°`;
  $('t-spin').value = h.spin; $('o-spin').textContent = h.spin ? `${Math.abs(h.spin)} turns/s ${h.spin > 0 ? 'left' : 'right'}` : 'none';
}
function syncPersonaUI() {
  const a = selAgent(); if (!a) return;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === a.persona.mode));
  $('p-edition').checked = S.adultEdition;
  $('p-adult').disabled = !S.adultEdition; $('p-adult').checked = a.persona.adult;
  $('p-mine').checked = a.persona.mine;
}

function renderBalls() {
  $('balls').innerHTML = S.agents.map((a, i) => `<li data-i="${i}" class="${i === S.sel ? 'sel' : ''}"><span class="dot" style="background:${a.color}"></span>Ball ${a.id}<span class="meta" id="meta-${a.id}"></span></li>`).join('');
  $('balls').querySelectorAll('li').forEach(li => li.onclick = () => selectAgent(Number(li.dataset.i)));
  syncThrowUI(); syncPersonaUI();
}
function renderBallMeta() {
  for (const a of S.agents) {
    const el = $('meta-' + a.id);
    if (el) el.textContent = `${{ HELD: 'held', REST: 'still', FLIGHT: 'flying', BOUNCE: 'bouncing', ROLL: 'rolling' }[a.out?.state] || ''} · ${moodOf(a.persona.anx)}`;
  }
}
function selectAgent(i) { S.sel = i; renderBalls(); aim.key = null; }

function setScene(k) {
  S.sceneKey = k; store.set('scene', k);
  document.querySelectorAll('#scenes button').forEach(b => b.classList.toggle('on', b.dataset.scene === k));
  buildScene();
  resetAgents();
  renderDesign();
}

// ---------- actions ----------
function doThrow() { const a = selAgent(); if (a && a.hand.throw()) canvas.focus(); }
function doDrop() { selAgent()?.hand.drop(); }
function doPick() { const a = selAgent(); if (a) { a.hand.grab(a.ball, world.t); a.det.flight = null; } }
function throwAll() { S.agents.forEach(a => a.hand.throw()); }
function setSqueeze(on) {
  S.squeezeHeld = on;
  const a = selAgent(); if (a) a.hand.squeezing = on;
  $('squeeze').classList.toggle('on', on);
}

// ---------- voice recording slots ----------
let recording = null;
function renderSlots() {
  const rec = audio.recordings;
  $('slots').innerHTML = SLOTS.map(s => {
    const has = rec.has(s.id);
    return `<li data-slot="${s.id}"><div class="head"><span class="mono">${s.id}.wav</span>${has ? `<span class="has">recorded, ${rec.get(s.id).duration.toFixed(1)} s</span>` : ''}</div>
      <div class="when">${s.when}. Built-in: “${escapeHtml(PACKS.kid.phrases[s.id]?.text ?? audio.packs.text.kid[s.id] ?? '')}”</div>
      <div class="btns"><button data-act="rec">${recording?.slot === s.id ? 'Stop' : 'Record'}</button>
      <button data-act="play" ${has ? '' : 'disabled'}>Play</button>
      <button data-act="wav" ${has ? '' : 'disabled'}>Save .wav</button>
      <button data-act="clear" ${has ? '' : 'disabled'}>Clear</button></div></li>`;
  }).join('');
  $('slots').querySelectorAll('button').forEach(b => b.onclick = () => slotAction(b.closest('li').dataset.slot, b.dataset.act, b));
}
async function slotAction(slot, act, btn) {
  if (!audio.ready) await startSound();
  if (act === 'rec') {
    if (recording) { recording.handle.stop(); return; }
    try {
      const handle = await recordClip(audio.ctx, 3500, lvl => { btn.style.boxShadow = `0 0 0 ${Math.min(6, lvl * 60)}px rgba(200,55,45,0.4)`; });
      recording = { slot, handle };
      renderSlots();
      const buf = await handle.result;
      audio.recordings.set(slot, buf);
      saveRecording(slot, await toWav(buf));
    } catch (e) {
      alert('Recording needs microphone permission. ' + (e.message || ''));
    } finally { recording = null; renderSlots(); }
  } else if (act === 'play') {
    const s = audio.ctx.createBufferSource(); s.buffer = audio.recordings.get(slot); s.connect(audio.out); s.start();
  } else if (act === 'wav') {
    const blob = await toWav(audio.recordings.get(slot));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${slot}.wav`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else if (act === 'clear') {
    // Two steps: the first press arms it, the second deletes.
    if (!btn.classList.contains('confirm')) { btn.classList.add('confirm'); btn.textContent = 'Press again to clear'; setTimeout(() => renderSlots(), 3000); return; }
    audio.recordings.delete(slot); saveRecording(slot, null); renderSlots();
  }
}

// ---------- sound start ----------
async function startSound() {
  if (audio.ready) {
    if (audio.ctx.state === 'running') { await audio.ctx.suspend(); $('sound').textContent = 'Sound off'; $('sound').classList.remove('primary'); }
    else { await audio.ctx.resume(); $('sound').textContent = 'Sound on'; $('sound').classList.add('primary'); }
    return;
  }
  try {
    $('sound').textContent = 'Loading voice…';
    await audio.start();
    audio.setNoise($('l-noise').checked);
    audio.setScene(SCENES[S.sceneKey]);
    audio.recordings = await loadRecordings(audio.ctx);
    for (const a of S.agents) setupVoice(a);
    syncStyleUI();
    $('sound').textContent = 'Sound on';
    if ($('voice-panel').open) renderSlots();
  } catch (e) {
    console.error(e);
    $('sound').textContent = 'Sound failed';
  }
}

// ---------- keyboard ----------
function keyHints() {
  $('keys').innerHTML = `<kbd>h</kbd><kbd>l</kbd> turn · <kbd>j</kbd><kbd>k</kbd> down/up · <kbd>-</kbd><kbd>=</kbd> force · <kbd>,</kbd><kbd>.</kbd> curve · <kbd>space</kbd> throw · <kbd>d</kbd> drop · <kbd>r</kbd> pick up · <kbd>a</kbd> throw all · <kbd>n</kbd> new ball · <kbd>tab</kbd> next · <kbd>s</kbd> squeeze · <kbd>f</kbd> follow · <kbd>c</kbd> camera behind · <kbd>1</kbd>–<kbd>4</kbd> scene`;
}
window.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type === 'text')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = selAgent();
  const k = e.key;
  const turn = 3 * Math.PI / 180;
  let handled = true;
  if (k === 'h' && a) a.hand.yaw += turn;
  else if (k === 'l' && a) a.hand.yaw -= turn;
  else if (k === 'j' && a) a.hand.pitch = Math.max(-1.05, a.hand.pitch - turn);
  else if (k === 'k' && a) a.hand.pitch = Math.min(1.4, a.hand.pitch + turn);
  else if ((k === '=' || k === '+') && a) a.hand.power = Math.min(10, a.hand.power + 0.5);
  else if (k === '-' && a) a.hand.power = Math.max(1, a.hand.power - 0.5);
  else if (k === ',' && a) a.hand.spin = Math.max(-25, a.hand.spin - 1);
  else if (k === '.' && a) a.hand.spin = Math.min(25, a.hand.spin + 1);
  else if (k === ' ') { if (!e.repeat) doThrow(); }
  else if (k === 'd') doDrop();
  else if (k === 'r') doPick();
  else if (k === 'a') throwAll();
  else if (k === 'n') addAgent();
  else if (k === 'Tab') { if (S.agents.length) selectAgent((S.sel + (e.shiftKey ? S.agents.length - 1 : 1)) % S.agents.length); }
  else if (k === 's') { if (!e.repeat) setSqueeze(true); }
  else if (k === 'f') S.follow = !S.follow;
  else if (k === 'c') { S.follow = false; cameraBehind(a); }
  else if (/^[1-4]$/.test(k)) setScene(Object.keys(SCENES)[Number(k) - 1]);
  else handled = false;
  if (handled) { e.preventDefault(); if ('hjkl=+-,.'.includes(k)) syncThrowUI(); }
});
window.addEventListener('keyup', e => { if (e.key === 's') setSqueeze(false); });

// ---------- boot ----------
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
initDesignPanel();
initPlayPanel();
keyHints();
buildScene();
document.querySelectorAll('#scenes button').forEach(b => b.classList.toggle('on', b.dataset.scene === S.sceneKey));
addAgent();
cameraBehind(selAgent());
resize();
requestAnimationFrame(frame);
// Console handle for debugging and headless tests: bloop.step(n) runs n 10 ms frames.
window.bloop = { S, world, audio, step: n => { for (let i = 0; i < n; i++) stepFrame(); }, render: () => renderer.render(scene3, camera) };
