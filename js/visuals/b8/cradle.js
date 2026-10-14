// «Колыбель разума» (финальная мысль, блок 8).
// Мозг из частиц спит в колыбели-полумесяце (тоже из частиц); колыбель мягко качается.
//   шаг 0 — колыбель качается, мозг спит;
//   шаг 1 — сверху опускается нейросеть, нити тянутся к колыбели и к мозгу, сеть раскачивает колыбель,
//           мозг тускнеет («отдали мышление»);
//   шаг 2 — нити рвутся, мозг просыпается, покидает колыбель и улетает вверх (метафора Циолковского).
// Шаги обратимы: всё состояние — набор чисел st (их плавно ведёт gsap), кадр строится из них в update().
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU, lerp, clamp } from '../../core/utils.js';

const RC = 2.75;                          // радиус средней линии полумесяца
const ARC0 = (160 / 180) * Math.PI;       // дуга от левого «рога» через низ…
const ARC1 = (380 / 180) * Math.PI;       // …к правому
const PIVOT_Y = 0.95;                     // ось качания (центр дуги) — высота в мире
const BRAIN = [0, -0.95, 0];              // центр мозга в колыбели (в системе колыбели)
const BRAIN_UP = 6.0;                     // подъём мозга на последнем шаге
const BRAIN_SC = 1.6;

// Узлы нейросети над колыбелью (в системе сети; ось качания — начало координат)
const NODES = [
  [-3.5, 2.35, 0.3], [-2.6, 3.15, -0.4], [-1.65, 2.25, 0.5], [-0.95, 3.6, 0.0], [-0.2, 2.75, -0.5],
  [0.6, 2.2, 0.4], [0.95, 3.35, 0.6], [1.75, 2.6, -0.3], [2.55, 3.5, 0.2], [3.45, 2.45, -0.2],
  [-2.0, 4.0, 0.2], [2.05, 4.15, -0.3], [0.1, 4.3, 0.1],
];
// Нити: [узел сети, точка крепления (в системе колыбели), крепится к мозгу?]
const THREADS = [
  [0, [Math.cos(ARC0) * RC, Math.sin(ARC0) * RC, 0], false],
  [9, [Math.cos(ARC1) * RC, Math.sin(ARC1) * RC, 0], false],
  [2, [-0.8, -0.12, 0.25], true],
  [5, [0.12, 0.02, 0.3], true],
  [7, [0.95, -0.18, 0.2], true],
];
const SEG = 14;                            // отрезков в нити

// ---------- Формы облака частиц ----------------------------------------------

function crescentFrame(u) {
  const a = lerp(ARC0, ARC1, u);
  const k = Math.pow(Math.sin(Math.PI * u), 0.8);
  return { a, ca: Math.cos(a), sa: Math.sin(a), w: 0.05 + 0.58 * k, h: 0.08 + 0.6 * k };
}

/** Колыбель-полумесяц: изогнутая сужающаяся «труба» по дуге, рога вверх. */
function crescent(count, seed = 31) {
  const s = S.createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    let f;
    for (let g = 0; g < 50; g++) { f = crescentFrame(r()); if (r() < (f.w + 0.1) / 0.73) break; }
    const phi = r() * TAU;
    const shell = r() < 0.84 ? 1 : Math.sqrt(r());
    const cr = Math.cos(phi), sr = Math.sin(phi);
    const rad = RC + cr * f.w * shell;
    const x = f.ca * rad, y = f.sa * rad, z = sr * f.h * shell;
    let c, a, size;
    if (r() < 0.045) { c = S.PAL.greenHi; a = 0.85; size = 1.25; }
    else if (cr > 0.15) { c = S.mixColor(S.PAL.white, S.PAL.pale, r()); a = 0.42 + 0.3 * cr; size = 0.7 + 0.45 * r(); }
    else { c = r() < 0.6 ? S.PAL.green : S.PAL.mint; a = 0.32 + 0.25 * r(); size = 0.55 + 0.45 * r(); }
    S.setPoint(s, i, x, y, z, size, c, shell < 1 ? a * 0.45 : a);
  }
  return s;
}

/** Мозг, лежащий на боку (профиль), ствол укорочен — чтобы лёг в колыбель. */
function brainPart(count) {
  const s = S.brain(count, { scale: BRAIN_SC, seed: 12, brightness: 0.62, detail: 5.4 });
  const P = s.positions, lim = -0.6 * BRAIN_SC;
  for (let i = 0; i < count; i++) {
    const j = i * 4;
    if (P[j + 1] < lim) P[j + 1] = lim + (P[j + 1] - lim) * 0.35;
  }
  return S.transform(s, { position: BRAIN, rotation: [0, -Math.PI / 2, 0.08] });
}

/** Звёздная пыль вокруг колыбели. */
function sparkles(count, seed = 33) {
  const s = S.createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, rr = r.range(3.7, 5.4);
    const c = r() < 0.25 ? S.PAL.mint : r() < 0.08 ? S.PAL.greenHi : S.PAL.white;
    S.setPoint(s, i, Math.cos(a) * rr, Math.sin(a) * rr * 0.8 - 0.5, r.gauss(0, 0.7), r.range(0.45, 1.15), c, r.range(0.12, 0.42));
  }
  return s;
}

const cloneShape = (s) => ({ count: s.count, positions: s.positions.slice(), colors: s.colors.slice(), meta: { ...s.meta, equalized: false } });

function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.45)');
  grd.addColorStop(0.6, 'rgba(255,255,255,.08)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// След взлёта: вертикальный световой столб от колыбели к мозгу (как след ракеты)
const TRAIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const TRAIL_FRAG = /* glsl */ `
uniform float uOpacity, uTime;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-x * x * 26.0);
  float wide = exp(-x * x * 4.0) * 0.35;
  float y = vUv.y;                                         // 0 — колыбель, 1 — мозг
  float along = smoothstep(0.0, 0.25, y) * (0.35 + 0.65 * y) * (1.0 - smoothstep(0.88, 1.0, y));
  float flick = 0.85 + 0.15 * sin(y * 40.0 - uTime * 18.0);
  float a = (core + wide) * along * flick * uOpacity;
  gl_FragColor = vec4(mix(vec3(0.2, 1.3, 0.35), vec3(1.2, 1.4, 1.2), core) * a, a);
}
`;

// Сеть, нити и импульсы анимируются в шейдерах: каждый кадр меняются только uniform'ы,
// буферы не перезаливаются (на ANGLE/D3D11 покадровая заливка заметно стоит — см. AUTHORING.md).
const NN = NODES.length;
const NT = THREADS.length;

// Узлы сети: светящиеся точки, «дыхание» и вспышки при прибытии импульса
const NODE_VERT = /* glsl */ `
attribute float aIdx;
attribute float aSize;
uniform float uScale, uTime;
uniform float uFlash[${NN}];
varying float vK;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fl = 0.0;
  for (int k = 0; k < ${NN}; k++) { if (abs(float(k) - aIdx) < 0.5) fl = uFlash[k]; }
  vK = 0.75 + 0.25 * sin(uTime * 2.1 + aIdx * 1.7) + 1.4 * fl;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 96.0);
}
`;
const NODE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vK;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.26, 0.4, d);
  float glow = exp(-d * d * 5.0) * 0.5;
  gl_FragColor = vec4(uColor * vK, (core + glow) * uOpacity);
}
`;

// Импульсы по рёбрам сети: position — начало ребра, aTo — конец, aSp — (скорость, фаза)
const EDGE_PULSE_VERT = /* glsl */ `
attribute vec3 aTo;
attribute vec2 aSp;
uniform float uScale, uTime, uOpacity;
varying float vA;
void main() {
  float s = fract(uTime * aSp.x + aSp.y);
  vec4 mv = modelViewMatrix * vec4(mix(position, aTo, s), 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.16 * uScale / max(0.1, -mv.z), 1.0, 72.0);
  vA = sin(3.14159265 * s) * 0.9 * uOpacity;
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

// Нити-«кукловоды»: квадратичная кривая A → M → B (мировые точки — uniform'ы), вытягивается на uThr
const THREAD_COMMON = /* glsl */ `
uniform vec3 uA[${NT}];
uniform vec3 uM[${NT}];
uniform vec3 uB[${NT}];
uniform float uThr;
vec3 threadPoint(float j, float u) {
  vec3 A = uA[0], M = uM[0], B = uB[0];
  for (int k = 1; k < ${NT}; k++) { if (abs(float(k) - j) < 0.5) { A = uA[k]; M = uM[k]; B = uB[k]; } }
  float v = 1.0 - u;
  return A * (v * v) + M * (2.0 * v * u) + B * (u * u);
}
`;
const THREAD_VERT = /* glsl */ `
attribute float aT;
attribute float aU;
${THREAD_COMMON}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(threadPoint(aT, aU * uThr), 1.0);
}
`;
const THREAD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;
// Импульсы вниз по нитям (от сети к колыбели); aSp — (скорость, фаза)
const THREAD_PULSE_VERT = /* glsl */ `
attribute float aT;
attribute vec2 aSp;
uniform float uScale, uTime, uOpacity;
${THREAD_COMMON}
varying float vA;
void main() {
  float f = fract(uTime * aSp.x + aSp.y);
  vec4 mv = modelViewMatrix * vec4(threadPoint(aT, f * uThr), 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.2 * uScale / max(0.1, -mv.z), 1.0, 72.0);
  vA = sin(3.14159265 * f) * uOpacity;
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const PULSE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 6.0) + 0.2 * (1.0 - d)) * vA;
  gl_FragColor = vec4(uColor, a);
}
`;

// Параметры шагов
const STEP = [
  { rock: 0.11, period: 3.7, net: 0, thr: 0, lift: 0, glow: 0.42, halo: 0, noise: 0.12 },
  { rock: 0.17, period: 3.0, net: 1, thr: 1, lift: 0, glow: 0.16, halo: 0, noise: 0.1 },
  { rock: 0.03, period: 4.4, net: 0, thr: 0, lift: 1, glow: 0.3, halo: 1, noise: 0.2 },
];

export default class Cradle extends Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    // Форма A — мозг спит в колыбели
    const A = S.combine(n, [
      { weight: 0.54, shape: brainPart },
      { weight: 0.38, shape: (m) => crescent(m) },
      { weight: 0.08, shape: (m) => sparkles(m) },
    ]);
    const br = A.meta.part0;
    const cr = A.meta.part1;
    // Форма B — мышление «отдано»: мозг тусклый, колыбель зеленее
    const B = cloneShape(A);
    for (let i = br.offset; i < br.offset + br.count; i++) {
      const j = i * 4;
      const l = (B.colors[j] + B.colors[j + 1] + B.colors[j + 2]) / 3;
      B.colors[j] = l * 0.16; B.colors[j + 1] = l * 0.42; B.colors[j + 2] = l * 0.22;
      B.colors[j + 3] *= 0.75;
    }
    // Форма C — мозг проснулся и улетел вверх; колыбель опустела и притихла
    const C = cloneShape(A);
    const r = rng(77);
    const cy = BRAIN[1];
    for (let i = br.offset; i < br.offset + br.count; i++) {
      const j = i * 4;
      C.positions[j] *= 1.12;
      C.positions[j + 1] = cy + (C.positions[j + 1] - cy) * 1.12 + BRAIN_UP;
      C.positions[j + 2] *= 1.12;
      if (r() < 0.07) { C.colors[j] = S.PAL.greenHi[0] * 0.8; C.colors[j + 1] = S.PAL.greenHi[1] * 0.8; C.colors[j + 2] = S.PAL.greenHi[2] * 0.8; }
      else C.colors[j + 1] *= 1.08;
      C.colors[j + 3] *= 0.85;
    }
    for (let i = cr.offset; i < cr.offset + cr.count; i++) C.colors[i * 4 + 3] *= 0.8;
    this.shapes = [A, B, C];

    // --- Колыбель: контур, свечение мозга, ореол (качаются вместе с облаком частиц)
    this.cradle = new THREE.Group();
    this.root.add(this.cradle);
    const outline = [];
    const K = 120;
    for (let k = 0; k <= K; k++) { const f = crescentFrame(k / K); outline.push(new THREE.Vector3(f.ca * (RC + f.w), f.sa * (RC + f.w), 0)); }
    for (let k = K; k >= 0; k--) { const f = crescentFrame(k / K); outline.push(new THREE.Vector3(f.ca * (RC - f.w), f.sa * (RC - f.w), 0)); }
    this.outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outline),
      new THREE.LineBasicMaterial({ color: new THREE.Color(0.25, 1.15, 0.35), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.cradle.add(this.outline);

    const glowTex = glowTexture();
    this.brainGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.35, 1.0, 0.45), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.brainGlow.scale.setScalar(5.2);
    this.cradle.add(this.brainGlow);

    this.halo = new THREE.Group();
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.016, 6, 200), ringMat(new THREE.Color(0.2, 1.4, 0.3)));
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.011, 6, 200), ringMat(new THREE.Color(0.8, 0.9, 0.85)));
    this.ringA.rotation.set(1.2, 0.25, 0.3);
    this.ringB.rotation.set(1.35, -0.4, -0.45);
    this.halo.add(this.ringA, this.ringB);
    // «спутники» на орбитах
    this.moons = [];
    [this.ringA, this.ringB].forEach((ring, k) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(k ? 0.07 : 0.09, 14, 10), ringMat(k ? new THREE.Color(1.6, 1.6, 1.6) : new THREE.Color(0.3, 1.8, 0.4)));
      ring.add(m);
      this.moons.push({ m, r: k ? 2.85 : 2.35, a: k * 2.1, w: k ? -0.35 : 0.5 });
    });
    this.cradle.add(this.halo);

    // след взлёта (виден только во время полёта мозга вверх)
    this.trailU = { uOpacity: { value: 0 }, uTime: { value: 0 } };
    this.trail = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1, 1, 1).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({
        uniforms: this.trailU, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.trail.position.set(0, BRAIN[1], 0.2);
    this.trail.visible = false;
    this.cradle.add(this.trail);
    this._lift = 0;
    this.trailI = 0;

    // --- Нейросеть над колыбелью
    this.net = new THREE.Group();
    this.root.add(this.net);
    this.nodePos = NODES.map((p) => new THREE.Vector3(...p));
    // общие uniform'ы точек: масштаб «мир → пиксели» и время
    this.uScale = { value: 600 };
    this.uTime = { value: 0 };
    const glow = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const nr = rng(5);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.nodePos.flatMap((p) => p.toArray())), 3));
    ng.setAttribute('aIdx', new THREE.BufferAttribute(new Float32Array(NN).map((_, i) => i), 1));
    ng.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(NN).map(() => nr.range(0.08, 0.14) * 4.2), 1));
    this.flash = new Float32Array(NN);
    this.nodeU = { uScale: this.uScale, uTime: this.uTime, uFlash: { value: this.flash }, uColor: { value: new THREE.Color(0.25, 1.35, 0.35) }, uOpacity: { value: 0 } };
    this.nodes = new THREE.Points(ng, glow(NODE_VERT, NODE_FRAG, this.nodeU));
    this.nodes.frustumCulled = false;
    this.net.add(this.nodes);
    // рёбра: 2–3 ближайших соседа
    const edges = [];
    const seen = new Set();
    this.nodePos.forEach((a, i) => {
      const d = this.nodePos.map((b, j) => [j, a.distanceTo(b)]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]);
      for (let k = 0; k < 3; k++) {
        const [j, dist] = d[k];
        if (k === 2 && dist > 1.9) continue;
        const key = i < j ? i + '-' + j : j + '-' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i, j]);
      }
    });
    this.edges = edges;
    const ep = new Float32Array(edges.length * 6);
    edges.forEach(([a, b], k) => { ep.set(this.nodePos[a].toArray(), k * 6); ep.set(this.nodePos[b].toArray(), k * 6 + 3); });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.2, 1.0, 0.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.edgeLines = new THREE.LineSegments(eg, this.edgeMat);
    this.net.add(this.edgeLines);

    // импульсы по рёбрам (2 на ребро): расписание (скорость, фаза) — статичный атрибут
    const pr = rng(9);
    this.edgePulse = [];
    const EP = edges.length * 2;
    const epFrom = new Float32Array(EP * 3), epTo = new Float32Array(EP * 3), epSp = new Float32Array(EP * 2);
    edges.forEach(([a, b], e) => {
      const ph = pr(), sp = pr.range(0.35, 0.7), rev = pr() < 0.5;
      const from = rev ? b : a, to = rev ? a : b;
      for (let q = 0; q < 2; q++) {
        const k = e * 2 + q;
        epFrom.set(this.nodePos[from].toArray(), k * 3);
        epTo.set(this.nodePos[to].toArray(), k * 3);
        epSp[k * 2] = sp; epSp[k * 2 + 1] = (ph + q * 0.5) % 1;
        this.edgePulse.push({ sp, ph: (ph + q * 0.5) % 1, to });
      }
    });
    const epg = new THREE.BufferGeometry();
    epg.setAttribute('position', new THREE.BufferAttribute(epFrom, 3));
    epg.setAttribute('aTo', new THREE.BufferAttribute(epTo, 3));
    epg.setAttribute('aSp', new THREE.BufferAttribute(epSp, 2));
    this.edgePulseU = { uScale: this.uScale, uTime: this.uTime, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.75, 1.8, 0.8) } };
    this.edgePulses = new THREE.Points(epg, glow(EDGE_PULSE_VERT, PULSE_FRAG, this.edgePulseU));
    this.edgePulses.frustumCulled = false;
    this.net.add(this.edgePulses);

    // --- Нити: концы (мировые точки) — uniform'ы, вершины — параметр вдоль кривой
    this.thrA = Array.from({ length: NT }, () => new THREE.Vector3());
    this.thrM = Array.from({ length: NT }, () => new THREE.Vector3());
    this.thrB = Array.from({ length: NT }, () => new THREE.Vector3());
    const thrCommon = () => ({ uA: { value: this.thrA }, uM: { value: this.thrM }, uB: { value: this.thrB }, uThr: this.thrU });
    this.thrU = { value: 0 };
    const tN = NT * SEG * 2;
    const tT = new Float32Array(tN), tUv = new Float32Array(tN);
    for (let j = 0; j < NT; j++) {
      for (let s = 0; s < SEG; s++) {
        for (let e = 0; e < 2; e++) { const o = (j * SEG + s) * 2 + e; tT[o] = j; tUv[o] = (s + e) / SEG; }
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tN * 3), 3));
    tg.setAttribute('aT', new THREE.BufferAttribute(tT, 1));
    tg.setAttribute('aU', new THREE.BufferAttribute(tUv, 1));
    this.threadU = { ...thrCommon(), uColor: { value: new THREE.Color(0.7, 1.25, 0.75) }, uOpacity: { value: 0 } };
    this.threads = new THREE.LineSegments(tg, glow(THREAD_VERT, THREAD_FRAG, this.threadU));
    this.threads.frustumCulled = false;
    this.root.add(this.threads);
    // импульсы вниз по нитям (2 на нить)
    const TP = NT * 2;
    const tpT = new Float32Array(TP), tpSp = new Float32Array(TP * 2);
    for (let j = 0; j < NT; j++) {
      const ph = pr(), sp = pr.range(0.45, 0.7);
      for (let q = 0; q < 2; q++) { const k = j * 2 + q; tpT[k] = j; tpSp[k * 2] = sp; tpSp[k * 2 + 1] = (ph + q * 0.5) % 1; }
    }
    const tpg = new THREE.BufferGeometry();
    tpg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TP * 3), 3));
    tpg.setAttribute('aT', new THREE.BufferAttribute(tpT, 1));
    tpg.setAttribute('aSp', new THREE.BufferAttribute(tpSp, 2));
    this.threadPulseU = { ...thrCommon(), uScale: this.uScale, uTime: this.uTime, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.75, 1.8, 0.8) } };
    this.threadPulses = new THREE.Points(tpg, glow(THREAD_PULSE_VERT, PULSE_FRAG, this.threadPulseU));
    this.threadPulses.frustumCulled = false;
    this.root.add(this.threadPulses);

    // Все материалы видимостью управляет update() (с учётом общего fade — this.opacity)
    this.root.traverse((o) => {
      const m = o.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => { mm.userData.noFade = true; });
    });

    this.st = { ...STEP[0], obj: 1 };
    this.phase = 0;
    this.baseX = 5;
    this._p0 = new THREE.Vector3();
    this._r0 = new THREE.Vector3();
    this._s0 = 1;
  }

  layout() {
    // колыбель — по центру правой половины «сцены 16:9» (слева текст)
    this.baseX = this.stageRect(14.5, 42).w * 0.25;
  }

  camera(state, step) {
    return step >= 2
      ? { pos: [0.6, 3.0, 15.6], target: [0.6, 2.55, 0], fov: 42 }
      : { pos: [0, 0.55, 14.5], target: [0, 0.35, 0], fov: 42 };
  }

  background(state, step) {
    // на последнем шаге — «рассвет» над улетевшим мозгом (справа сверху)
    return step >= 2 ? { glows: [[0.42, 0.68, 0.62, 0.85], [-0.95, -0.62, 0.42, 0.35]], band: null } : 'corner';
  }

  enter(o = {}) {
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.layout();
    this.claimParticles();
    const p = this.particles;
    const sp = STEP[this.step] || STEP[0];
    p.setParams({ noise: sp.noise, swirl: 0, size: 0.06, twinkle: 0.3, spring: 15, damping: 5.2, opacity: 1, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    Object.assign(this.st, sp);
    this.cur = this.shapes[this.step] || this.shapes[0];
    p.morph(this.cur, { duration: o.instant ? 0.01 : 2.4, stagger: 0.5, burst: 8 });
    // облако плавно переезжает из позы предыдущей сцены в колыбель
    const obj = p.object;
    this._p0.copy(obj.position);
    this._r0.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    this._s0 = obj.scale.x;
    this.st.obj = 0;
    this.tw(this.st, { obj: 1, duration: o.instant ? 0 : 1.8, ease: 'power2.inOut' });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    const sp = STEP[step] || STEP[0];
    const k = o.instant ? 0 : 1;
    const st = this.st;
    const p = this.particles;
    this.claimParticles();
    // отложенные твины прошлого шага не должны «проснуться» поверх нового
    gsap.killTweensOf(st, 'rock,period,glow,net,thr,lift,halo');
    // качание и свечение
    this.tw(st, { rock: sp.rock, period: sp.period, glow: sp.glow, duration: 1.8 * k, ease: 'sine.inOut', overwrite: 'auto' });
    p.setParams({ noise: sp.noise }, 1.2 * k);
    if (step === 1) {
      // сеть опускается, затем нити тянутся вниз
      this.tw(st, { net: 1, duration: 2.0 * k, ease: 'power3.out', overwrite: 'auto' });
      this.tw(st, { thr: 1, duration: 1.3 * k, delay: (prev < 1 ? 0.9 : 0.2) * k, ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(st, { lift: 0, halo: 0, duration: 1.6 * k, ease: 'power2.inOut', overwrite: 'auto' });
    } else if (step >= 2) {
      // нити рвутся, сеть уходит, мозг взлетает
      this.tw(st, { thr: 0, duration: 0.45 * k, ease: 'power2.in', overwrite: 'auto' });
      this.tw(st, { net: 0, duration: 1.6 * k, delay: 0.25 * k, ease: 'power2.in', overwrite: 'auto' });
      this.tw(st, { lift: 1, duration: 2.8 * k, delay: 0.15 * k, ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(st, { halo: 1, duration: 1.6 * k, delay: 2.0 * k, ease: 'power2.out', overwrite: 'auto' });
      if (k && prev < 2) {
        this.ctx.engine.pulse({ aberration: 1.1, flash: 0.1 }, 0.9);
        this.ctx.rig.shake(0.12, 0.6);
      }
    } else {
      this.tw(st, { thr: 0, duration: 0.6 * k, ease: 'power2.in', overwrite: 'auto' });
      this.tw(st, { net: 0, duration: 1.3 * k, ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(st, { lift: 0, halo: 0, duration: 1.6 * k, ease: 'power2.inOut', overwrite: 'auto' });
    }
    // облако частиц
    const shape = this.shapes[step] || this.shapes[0];
    if (shape !== this.cur) {
      this.cur = shape;
      const up = step === 2 && prev < 2;
      const down = prev === 2 && step < 2;
      p.morph(shape, {
        duration: k ? (up ? 2.7 : down ? 2.2 : 1.6) : 0.01,
        stagger: up ? 0.1 : down ? 0.45 : 0.3,
        burst: up ? 5 : down ? 6 : 2,
      });
    }
  }

  update(dt, t) {
    const st = this.st;
    const vis = this.opacity;
    this.phase += (dt * TAU) / Math.max(0.5, st.period);
    const theta = Math.sin(this.phase) * st.rock;
    const yaw = -0.2 + Math.sin(t * 0.21) * 0.17;

    // колыбель (и облако частиц) — качание вокруг центра дуги + «перекатывание»
    this.cradle.position.set(this.baseX - RC * theta * 0.35, PIVOT_Y, 0);
    this.cradle.rotation.set(0.05, yaw, theta);
    if (this.ownsParticles()) {
      const o = this.particles.object;
      const k = st.obj;
      if (k >= 1) {
        o.position.copy(this.cradle.position);
        o.rotation.copy(this.cradle.rotation);
        o.scale.setScalar(1);
      } else {
        o.position.lerpVectors(this._p0, this.cradle.position, k);
        o.rotation.set(lerp(this._r0.x, 0.05, k), lerp(this._r0.y, yaw, k), lerp(this._r0.z, theta, k));
        o.scale.setScalar(lerp(this._s0, 1, k));
      }
    }

    // свечение мозга следует за мозгом
    const lift = st.lift;
    const by = BRAIN[1] + BRAIN_UP * lift;
    this.brainGlow.position.set(0, by, 0);
    this.brainGlow.material.opacity = st.glow * vis * (0.85 + 0.15 * Math.sin(t * 1.3));
    this.brainGlow.scale.setScalar(5.2 + lift * 1.6);
    this.outline.material.opacity = (0.42 - 0.12 * lift) * vis;
    // след взлёта: тянется за мозгом, ярче при подъёме, гаснет на месте
    const rising = lift > this._lift + 1e-5;
    this._lift = lift;
    const tr = rising ? Math.sin(Math.PI * Math.min(1, lift * 1.15)) : 0;
    this.trailI += (tr - this.trailI) * Math.min(1, dt * 6);
    this.trail.visible = this.trailI > 0.01;
    if (this.trail.visible) {
      this.trail.scale.set(1, Math.max(0.01, BRAIN_UP * lift - 0.6), 1);
      this.trailU.uOpacity.value = 0.9 * this.trailI * vis;
      this.trailU.uTime.value = t;
    }
    // ореол с «лунами»
    this.halo.position.set(0, by, 0);
    this.halo.visible = st.halo > 0.002;
    this.halo.scale.setScalar(0.7 + 0.3 * st.halo);
    this.ringA.rotation.z += dt * 0.25;
    this.ringB.rotation.z -= dt * 0.18;
    this.ringA.material.opacity = 0.75 * st.halo * vis;
    this.ringB.material.opacity = 0.45 * st.halo * vis;
    for (const mo of this.moons) {
      mo.a += dt * mo.w;
      mo.m.position.set(Math.cos(mo.a) * mo.r, Math.sin(mo.a) * mo.r, 0);
      mo.m.material.opacity = st.halo * vis;
    }

    // нейросеть: опускается сверху, покачивается в такт колыбели
    const net = st.net;
    this.net.position.set(this.baseX + Math.sin(this.phase) * 0.14 * net, PIVOT_Y + (1 - net) * 3.6, 0);
    this.net.rotation.set(0.05, yaw * 0.6, theta * 0.22);
    this.net.updateMatrixWorld();
    this.cradle.updateMatrixWorld();
    const netOn = net > 0.002;
    this.net.visible = netOn;
    this.edgeMat.opacity = 0.42 * net * vis;
    this.uTime.value = t;
    const e = this.ctx.engine;
    this.uScale.value = (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5));
    this.nodeU.uOpacity.value = Math.min(1, net * 1.2) * vis;
    this.edgePulseU.uOpacity.value = net * vis;

    // вспышки узлов при прибытии импульса (то же расписание, что в шейдере импульсов)
    const fl = this.flash;
    fl.fill(0);
    if (netOn) {
      for (let k = 0; k < this.edgePulse.length; k++) {
        const pu = this.edgePulse[k];
        const s = (t * pu.sp + pu.ph) % 1;
        if (s > 0.85) fl[pu.to] = Math.max(fl[pu.to], (s - 0.85) / 0.15);
      }
    }

    // нити: от узла сети к рогам колыбели и к мозгу (вытягиваются вниз на thr) — только концы, кривую строит шейдер
    const thr = st.thr;
    const thrOn = thr > 0.002 && netOn;
    this.threads.visible = thrOn;
    this.threadPulses.visible = thrOn;
    if (thrOn) {
      for (let j = 0; j < NT; j++) {
        const [ni, anchor, toBrain] = THREADS[j];
        const A = this.thrA[j], B = this.thrB[j], M = this.thrM[j];
        this.net.localToWorld(A.copy(this.nodePos[ni]));
        this.cradle.localToWorld(B.set(anchor[0], anchor[1] + (toBrain ? BRAIN_UP * lift : 0), anchor[2]));
        M.lerpVectors(A, B, 0.5);
        M.y -= 0.12 * A.distanceTo(B);
      }
    }
    this.thrU.value = thr;
    this.threadU.uOpacity.value = 0.5 * Math.min(1, net * 1.5) * vis;
    this.threadPulseU.uOpacity.value = thr > 0.98 ? vis * net : 0;
  }

  resize() {
    if (this.active) this.layout();
  }
}
