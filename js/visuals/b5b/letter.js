// «Письмо»: за кубом-песочницей — ночной парк из частиц, человек с бутербродом на скамейке.
// Сбежавший агент запускает к нему конверт «Я выбрался».
//   шаг 0 — полёт конверта, «!» над головой исследователя;
//   шаг 1 — над парком всплывают окна-страницы малоизвестных сайтов (подробности побега);
//   шаг 2 — камера отъезжает: снаружи только «руки» модели, сама модель с весами (мозг из частиц)
//           осталась на другом сервере — их связывает тонкая светящаяся нить.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import {
  HEX, toColor, holoMaterial, glassMaterial, glowSprite, glowMaterial, fatLines, polyline, edgePairs,
  Trail, shockRing, flowMaterial, Fader, canvasTexture, roundRect, texPlane, lbl, build, limb,
  setCell, setLineResolution, keyed,
} from './kit.js';

const GY = -2.2;                                      // уровень земли
const CUBE = { x: -6.2, y: GY + 1.55, z: 1.2, s: 3.0 };
const ORB = new THREE.Vector3(-3.7, -0.05, 2.3);      // сбежавший агент — «руки» (снаружи куба)
const BENCH = { x: 2.6, z: -1.9, ry: -0.38, s: 1.55 };
const LAMP = { x: 5.9, z: -3.4 };
const SERVER = { x: -16.5, z: -9.5 };
const BRAIN = new THREE.Vector3(SERVER.x, 3.5, SERVER.z);
const TREES = [
  { x: -0.9, z: -7.4, h: 4.6, w: 1.5 },
  { x: 2.6, z: -11.0, h: 5.4, w: 1.8 },
  { x: 7.4, z: -8.2, h: 5.0, w: 1.65 },
  { x: 11.2, z: -5.2, h: 4.4, w: 1.45 },
  { x: 11.8, z: -12.6, h: 5.8, w: 1.9 },
  { x: -4.8, z: -10.6, h: 4.9, w: 1.6 },
  { x: -9.6, z: -13.5, h: 5.2, w: 1.75 },
  { x: 15.6, z: -9.0, h: 4.8, w: 1.6 },
];

// ---------------------------------------------------------------------------
// Формы облака частиц (кэш на модуль)
// ---------------------------------------------------------------------------
const SHAPES = new Map();

// Кроны: несколько «шаров» на дерево, точки — в основном у поверхности (чёткий силуэт)
function crowns(t, ti) {
  const r = rng(700 + ti);
  const cy = GY + t.h * 0.7;
  const list = [[t.x, cy + t.w * 0.32, t.z, t.w * 0.78]];
  const nb = 5 + (ti % 3);
  for (let b = 1; b < nb; b++) {
    const ang = (b / (nb - 1)) * Math.PI * 2 + ti * 1.3;
    const rr = t.w * 0.56;
    list.push([t.x + Math.cos(ang) * rr, cy - t.w * 0.12 + r.range(-0.15, 0.3) * t.w, t.z + Math.sin(ang) * rr * 0.7, t.w * r.range(0.5, 0.64)]);
  }
  return list;
}

function treesShape(m) {
  const s = S.createShape(m), r = rng(51);
  const total = TREES.reduce((a, t) => a + t.h * t.w * t.w, 0);
  const dark = S.color('#0a6a0a'), mid = S.PAL.green, top = S.PAL.mint, pale = S.PAL.pale;
  let i = 0;
  TREES.forEach((t, ti) => {
    const cnt = ti === TREES.length - 1 ? m - i : Math.floor(m * t.h * t.w * t.w / total);
    const blobs = crowns(t, ti);
    const nb = blobs.length;
    for (let k = 0; k < cnt && i < m; k++, i++) {
      const bl = blobs[Math.floor(r() * nb)];
      const [dx, dy, dz] = r.onSphere(1);
      const rad = bl[3] * (r() < 0.78 ? r.range(0.88, 1.0) : Math.sqrt(r()));
      const x = bl[0] + dx * rad, y = bl[1] + dy * rad * 0.92, z = bl[2] + dz * rad;
      const lightK = Math.min(1, Math.max(0, 0.45 + dx * 0.35 + dy * 0.5 + dz * 0.25));
      let c = S.mixColor(dark, mid, lightK);
      c = S.mixColor(c, top, Math.max(0, lightK - 0.62) * 1.8);
      if (r() < 0.035) c = pale;
      if (r() < 0.02) c = S.PAL.greenHi;
      S.setPoint(s, i, x, y, z, r.range(0.55, 1.2), c, r.range(0.3, 0.62) * (0.4 + 0.6 * lightK));
    }
  });
  return s;
}

function firefliesShape(m) {
  const s = S.createShape(m), r = rng(77);
  for (let i = 0; i < m; i++) {
    const x = r.range(-9, 16), z = r.range(-18, -1.5);
    const y = GY + 0.15 + Math.pow(r(), 1.6) * 3.4;
    const c = r() < 0.7 ? S.PAL.greenHi : S.PAL.bright;
    S.setPoint(s, i, x, y, z, r.range(0.6, 1.5), c, r.range(0.35, 0.85));
  }
  return s;
}

function skyShape(m, seed = 91) {
  const s = S.createShape(m), r = rng(seed);
  for (let i = 0; i < m; i++) {
    const x = r.range(-42, 42), z = r.range(-58, -30);
    const y = r.range(-1, 22) * (0.6 + 0.4 * r());
    const c = r() < 0.82 ? S.PAL.white : r() < 0.6 ? S.PAL.mint : S.PAL.blue;
    S.setPoint(s, i, x, y, z, r.range(0.5, 1.3), c, r.range(0.08, 0.4));
  }
  return s;
}

function brainShape(m) {
  // профиль (вид сбоку) к камере общего плана — так мозг узнаётся лучше всего
  // зелёные борозды и светлые гребни — мозг читается и не выгорает в белое облако
  const b = S.brain(m, { scale: 2.6, seed: 9, brightness: 1, interior: 0.05, ridge: S.PAL.pale, groove: S.PAL.green });
  return S.transform(b, { position: BRAIN.toArray(), rotation: [0.12, -1.21, 0], scale: 1 });
}

function parkShape(n, withBrain) {
  const key = n + (withBrain ? ':brain' : ':park');
  if (SHAPES.has(key)) return SHAPES.get(key);
  const s = S.combine(n, [
    { weight: 0.5, shape: (m) => treesShape(m) },
    { weight: 0.07, shape: (m) => firefliesShape(m) },
    { weight: 0.27, shape: (m) => skyShape(m, 91) },
    { weight: 0.16, shape: (m) => (withBrain ? brainShape(m) : skyShape(m, 92)) },
  ]);
  SHAPES.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Земля: фирменный халфтон в мировых координатах, светлое пятно под фонарём и дорожка.
// ---------------------------------------------------------------------------
const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const GROUND_FRAG = /* glsl */ `
uniform vec3 uColor, uLamp, uCam, uCube;
uniform float uOpacity, uSpacing;
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  const mat2 R = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  vec2 q = R * p / uSpacing;
  vec2 f = fract(q) - 0.5;
  float d = length(f);
  vec2 dl = p - uLamp.xz;
  float lamp = exp(-dot(dl, dl) * 0.09);
  vec2 dc = p - uCube.xz;
  float cube = exp(-dot(dc, dc) * 0.09) * 0.22;
  // извилистая дорожка через парк
  float py = abs(p.y - (-0.6 + 1.2 * sin(p.x * 0.3)));
  float path = exp(-py * py * 0.8);
  float dist = length(vW - uCam);
  float far = 1.0 - smoothstep(14.0, 40.0, dist);
  float near = smoothstep(7.0, 13.0, dist);
  float edge = 1.0 - smoothstep(16.0, 28.0, abs(p.x - 2.0));
  float v = clamp(0.05 + 0.8 * lamp + cube + 0.1 * path, 0.0, 1.0) * far * edge * near;
  float r = 0.44 * sqrt(v);
  float aa = max(fwidth(d) * 1.1, 0.01);
  float m = 1.0 - smoothstep(r - aa, r + aa, d);
  vec3 col = mix(uColor, vec3(0.9), lamp * 0.3);
  gl_FragColor = vec4(col * m, m * uOpacity);
}
`;

// Конус света фонаря
const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uShow;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float down = vUv.y;
  float a = (0.05 + 0.2 * ndv * ndv) * smoothstep(0.0, 0.9, down) * uOpacity * uShow;
  gl_FragColor = vec4(uColor, a);
}
`;
const CONE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

// Огоньки сервера (InstancedMesh): мигают по своей фазе, без перезаливки буферов
const LED_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying float vOn;
void main() {
  vOn = step(0.2, sin(uTime * (3.0 + mod(aPhase, 5.0)) + aPhase * 1.7));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const LED_FRAG = /* glsl */ `
uniform vec3 uOn, uOff;
uniform float uOpacity, uShow;
varying float vOn;
void main() { gl_FragColor = vec4(mix(uOff, uOn, vOn), uOpacity * uShow); }
`;

// ---------------------------------------------------------------------------
// Текстуры
// ---------------------------------------------------------------------------
function envelopeTexture() {
  return canvasTexture(512, 328, (g, w, h) => {
    g.fillStyle = '#eef6ee';
    roundRect(g, 0, 0, w, h, 22);
    g.fill();
    g.strokeStyle = 'rgba(0,60,0,.55)';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(14, 18); g.lineTo(w / 2, h * 0.6); g.lineTo(w - 14, 18);
    g.moveTo(14, h - 14); g.lineTo(w * 0.4, h * 0.5);
    g.moveTo(w - 14, h - 14); g.lineTo(w * 0.6, h * 0.5);
    g.stroke();
    // зелёная печать с «@»
    g.fillStyle = '#00c800';
    g.beginPath(); g.arc(w / 2, h * 0.6, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#031203';
    g.font = '800 64px Unbounded';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('@', w / 2, h * 0.6 + 2);
  });
}

function letterTexture() {
  return canvasTexture(512, 360, (g, w, h) => {
    g.fillStyle = '#f4fbf4';
    roundRect(g, 0, 0, w, h, 16);
    g.fill();
    g.fillStyle = '#062306';
    g.font = '800 62px Unbounded';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Я выбрался', w / 2, 92);
    g.fillStyle = 'rgba(6,40,6,.28)';
    for (let i = 0; i < 4; i++) { roundRect(g, 60, 170 + i * 42, (w - 120) * (i === 3 ? 0.55 : 1), 16, 8); g.fill(); }
  });
}

const WIN_TITLES = ['подробности побега', 'как это было', 'подробности побега', 'обход защиты'];
function windowTexture(variant) {
  return canvasTexture(768, 512, (g, w, h) => {
    const r = rng(300 + variant);
    g.fillStyle = 'rgba(3,12,4,.94)';
    roundRect(g, 6, 6, w - 12, h - 12, 26); g.fill();
    g.lineWidth = 7;
    g.strokeStyle = variant === 3 ? '#ff3b30' : '#00e000';
    g.stroke();
    // заголовок окна
    g.fillStyle = 'rgba(0,224,0,.13)';
    roundRect(g, 10, 10, w - 20, 70, 20); g.fill();
    ['#ff3b30', '#ffffff', '#00e000'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(46 + i * 38, 45, 12, 0, Math.PI * 2); g.fill(); });
    // адресная строка
    g.fillStyle = 'rgba(255,255,255,.1)';
    roundRect(g, 170, 24, w - 200, 42, 21); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = '600 26px "JetBrains Mono"';
    g.textBaseline = 'middle';
    const doms = ['h**p://p•••••e.net', 'h**p://f•••m.org', 'h**p://b•••g.io', 'h**p://w•••i.cc'];
    g.fillText(doms[variant % 4], 190, 46);
    // заголовок страницы
    g.fillStyle = variant === 3 ? '#ff6a5f' : '#7dff6e';
    g.font = '800 40px Unbounded';
    g.fillText(WIN_TITLES[variant % 4].toUpperCase(), 40, 128);
    // содержимое
    let y = 180;
    for (let i = 0; i < 7; i++) {
      const lw = (w - 90) * r.range(0.45, 1);
      if (variant === 1 && i % 2 === 0) {
        g.fillStyle = 'rgba(0,224,0,.55)';
        g.beginPath(); g.arc(58, y + 12, 16, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.32)';
        roundRect(g, 86, y + 2, lw * 0.8, 20, 10); g.fill();
      } else if (variant === 2) {
        g.fillStyle = 'rgba(0,224,0,.45)';
        g.font = '600 22px "JetBrains Mono"';
        g.fillText(String(i + 1).padStart(2, '0'), 36, y + 12);
        g.fillStyle = i % 3 === 0 ? 'rgba(0,255,0,.5)' : 'rgba(255,255,255,.3)';
        roundRect(g, 86 + (i % 3) * 30, y + 2, lw * 0.75, 20, 10); g.fill();
      } else {
        g.fillStyle = 'rgba(255,255,255,.3)';
        roundRect(g, 40, y + 2, lw, 20, 10); g.fill();
      }
      y += 44;
    }
  });
}

function serverTexture() {
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#050b06'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const y = 18 + i * 54;
      g.fillStyle = '#0d1a0e';
      roundRect(g, 14, y, w - 28, 44, 8); g.fill();
      g.strokeStyle = 'rgba(0,224,0,.45)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(255,255,255,.18)';
      for (let k = 0; k < 6; k++) { g.fillRect(28 + k * 18, y + 12, 9, 20); }
    }
  });
}

// ---------------------------------------------------------------------------
export default class Letter extends Visual {
  static transition = 'morph';

  async init() {
    const ctx = this.ctx;
    this.fader = new Fader();
    this.kt = keyed(this);
    this.sv = { windows: 0, beams: 0, server: 0, thread: 0, mail: 0, bang: 0 };
    this.flight = { k: 1 };
    this.flap = { a: 0 };
    this.letterUp = { k: 0 };
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.scaleU = ctx.particles.uniforms.uScale;

    // --- Земля
    this.groundU = {
      uColor: { value: toColor(HEX.green, 0.5) },
      uLamp: { value: new THREE.Vector3(LAMP.x - 0.4, GY, LAMP.z + 0.6) },
      uCube: { value: new THREE.Vector3(CUBE.x, GY, CUBE.z) },
      uCam: { value: new THREE.Vector3() },
      uOpacity: { value: 1 },
      uSpacing: { value: 0.34 },
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.ShaderMaterial({
      uniforms: this.groundU, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
      transparent: true, depthWrite: false,
    }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(2, GY, -14);
    ground.renderOrder = -5;
    this.root.add(ground);

    // --- Луна (в правом верхнем углу, частично за кадром)
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(5.2, 64, 40), holoMaterial({ color: '#e8ffe4', rim: HEX.green, base: '#000000', fill: 1.1, rimPower: 3, light: [0.95, 0.35, 0.15] }));
    this.moon.position.set(37, 18.5, -52);
    this.root.add(this.moon);
    const moonGlow = glowSprite(HEX.greenHi, 26, 0.42, 0.55);
    moonGlow.position.copy(this.moon.position).add(new THREE.Vector3(0, 0, -1));
    this.root.add(moonGlow);

    // --- Стволы деревьев (под кронами из частиц)
    const trunkParts = [];
    TREES.forEach((t, ti) => {
      const top = GY + t.h * 0.66;
      trunkParts.push({ g: new THREE.CylinderGeometry(0.07 * t.w, 0.14 * t.w, top - GY, 8), p: [t.x, (top + GY) / 2, t.z] });
      crowns(t, ti).slice(1, 4).forEach((b) => trunkParts.push(limb([t.x, GY + t.h * 0.45, t.z], [b[0] * 0.6 + t.x * 0.4, b[1] - b[3] * 0.4, b[2] * 0.6 + t.z * 0.4], 0.045 * t.w, 6)));
    });
    // опорная точка — на земле: при входе стволы «вырастают» вместе с кронами из частиц
    const trunkGeo = build(trunkParts);
    trunkGeo.translate(0, -GY, 0);
    this.trunks = new THREE.Mesh(trunkGeo, holoMaterial({ color: '#2f8f2f', rim: '#9dff8e', base: '#020502', fill: 0.7, rimK: 0.7 }));
    this.trunks.position.y = GY;
    this.root.add(this.trunks);

    // --- Куб-песочница
    this.cube = new THREE.Group();
    this.cube.position.set(CUBE.x, CUBE.y, CUBE.z);
    this.cube.rotation.y = 0.32;
    this.root.add(this.cube);
    const box = new THREE.BoxGeometry(CUBE.s, CUBE.s, CUBE.s);
    this.cube.add(new THREE.Mesh(box, glassMaterial({ color: HEX.green, k: 0.26, min: 0.025 })));
    this.cube.add(fatLines(edgePairs(box), { color: HEX.greenHi, k: 1.15, width: 3 }));
    // трещина на стенке, обращённой к парку
    const h = CUBE.s / 2 + 0.01;
    const crack = [[h, 0.9, -0.2], [h, 0.45, 0.15], [h, 0.1, -0.05], [h, -0.35, 0.3], [h, -0.7, 0.05], [h, -1.05, 0.4]];
    this.cube.add(fatLines([...polyline(crack), h, 0.45, 0.15, h, 0.62, 0.62, h, -0.35, 0.3, h, -0.2, 0.75], { color: '#ffffff', k: 1.6, width: 3.4 }));
    // компьютер внутри
    const pcMat = holoMaterial({ color: HEX.green, rim: '#b9ffb0', fill: 0.9 });
    const pc = new THREE.Mesh(build([
      { g: new THREE.BoxGeometry(1.25, 0.82, 0.08), p: [0, -0.25, -0.2] },
      { g: new THREE.BoxGeometry(0.12, 0.5, 0.1), p: [0, -0.86, -0.22] },
      { g: new THREE.BoxGeometry(0.62, 0.05, 0.36), p: [0, -1.12, -0.2] },
      { g: new THREE.BoxGeometry(1.15, 0.06, 0.4), p: [0, -1.12, 0.45] },
    ]), pcMat);
    this.cube.add(pc);
    const screenTex = canvasTexture(256, 160, (g, w, hh) => {
      g.fillStyle = '#021a04'; g.fillRect(0, 0, w, hh);
      g.fillStyle = '#00ff00';
      for (let i = 0; i < 6; i++) g.fillRect(16, 16 + i * 22, 40 + ((i * 53) % 150), 10);
    });
    const screen = texPlane(screenTex, 1.12, 0.7, { k: 1.25, additive: true });
    screen.position.set(0, -0.25, -0.155);
    this.cube.add(screen);

    // --- Агент («руки» модели): светящийся шар с манипулятором
    this.agent = new THREE.Group();
    this.agent.position.copy(ORB);
    this.root.add(this.agent);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), glowMaterial(HEX.greenHi, 2.0));
    this.agent.add(this.orb);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), glowMaterial('#ffffff', 2.4));
    this.agent.add(core);
    this.agent.add(glowSprite(HEX.greenHi, 3.6, 1.2));
    this.agent.scale.setScalar(1.15);
    this.claws = [];
    const clawMat = holoMaterial({ color: '#d8ffd2', rim: HEX.greenHi, rimK: 1.4, fill: 1.1 });
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / 3) * Math.PI * 2;
      const seg = new THREE.Group();
      seg.position.set(0.22, -0.12, 0);
      const g = build([
        limb([0, 0, 0], [0.32, -0.28, 0], 0.045),
        limb([0.32, -0.28, 0], [0.26, -0.62, 0], 0.04),
        { g: new THREE.SphereGeometry(0.07, 12, 8), p: [0.32, -0.28, 0] },
      ]);
      seg.add(new THREE.Mesh(g, clawMat));
      arm.add(seg);
      this.agent.add(arm);
      this.claws.push(seg);
    }

    // --- Скамейка, фонарь, человек
    this.park = new THREE.Group();
    this.root.add(this.park);
    const benchMat = holoMaterial({ color: '#cfe9cf', rim: HEX.green, fill: 0.95, rimK: 0.9 });
    const bench = new THREE.Mesh(build([
      ...[-0.17, 0, 0.17].map((z) => ({ g: new THREE.BoxGeometry(2.5, 0.07, 0.15), p: [0, 0.55, z] })),
      ...[0.82, 1.04].map((y) => ({ g: new THREE.BoxGeometry(2.5, 0.14, 0.06), p: [0, y, -0.32], r: [-0.12, 0, 0] })),
      ...[-1.05, 1.05].flatMap((x) => [
        { g: new THREE.BoxGeometry(0.08, 0.55, 0.08), p: [x, 0.27, 0.18] },
        { g: new THREE.BoxGeometry(0.08, 1.15, 0.08), p: [x, 0.56, -0.28], r: [-0.12, 0, 0] },
        { g: new THREE.BoxGeometry(0.08, 0.08, 0.6), p: [x, 0.8, -0.03] },
      ]),
    ]), benchMat);
    this.benchG = new THREE.Group();
    this.benchG.position.set(BENCH.x, GY, BENCH.z);
    this.benchG.rotation.y = BENCH.ry;
    this.benchG.scale.setScalar(BENCH.s);
    this.benchG.add(bench);
    this.park.add(this.benchG);

    // Человек (сидит, смотрит в +Z), чуть левее центра скамейки
    const manMat = holoMaterial({ color: HEX.green, rim: '#ffffff', fill: 1.05, rimK: 1.25, rimPower: 2 });
    this.man = new THREE.Group();
    this.man.position.set(-0.15, 0, 0);
    this.benchG.add(this.man);
    this.man.add(new THREE.Mesh(build([
      limb([0, 0.72, -0.05], [0, 1.2, -0.12], 0.23),             // туловище
      limb([-0.14, 0.66, 0.0], [-0.14, 0.66, 0.46], 0.11),       // бёдра
      limb([0.14, 0.66, 0.0], [0.14, 0.66, 0.46], 0.11),
      limb([-0.14, 0.62, 0.5], [-0.14, 0.1, 0.56], 0.09),        // голени
      limb([0.14, 0.62, 0.5], [0.14, 0.1, 0.56], 0.09),
      { g: new THREE.BoxGeometry(0.15, 0.08, 0.28), p: [-0.14, 0.04, 0.64] },
      { g: new THREE.BoxGeometry(0.15, 0.08, 0.28), p: [0.14, 0.04, 0.64] },
      limb([-0.3, 1.32, -0.1], [-0.33, 1.02, 0.12], 0.075),     // левое плечо
      limb([-0.33, 1.02, 0.12], [-0.12, 1.14, 0.38], 0.065),    // левое предплечье
      limb([0, 1.38, -0.1], [0, 1.5, -0.08], 0.07),              // шея
    ]), manMat));
    this.head = new THREE.Group();
    this.head.position.set(0, 1.66, -0.06);
    this.man.add(this.head);
    this.head.add(new THREE.Mesh(build([
      { g: new THREE.SphereGeometry(0.2, 24, 16), p: [0, 0, 0], s: [1, 1.1, 1] },
      { g: new THREE.SphereGeometry(0.05, 8, 6), p: [0, -0.02, 0.2] },
    ]), manMat));
    // правая рука с бутербродом — вращается в плече («ест»)
    this.arm = new THREE.Group();
    this.arm.position.set(0.3, 1.32, -0.1);
    this.man.add(this.arm);
    this.arm.add(new THREE.Mesh(build([
      limb([0, 0, 0], [0.03, -0.3, 0.2], 0.075),
      limb([0.03, -0.3, 0.2], [-0.12, -0.16, 0.48], 0.065),
    ]), manMat));
    const breadMat = holoMaterial({ color: '#ffe9b8', rim: '#ffffff', fill: 1.2, rimK: 0.8, base: '#151006' });
    const leafMat = holoMaterial({ color: HEX.greenHi, rim: '#d9ffd0', fill: 1.3, base: '#032003' });
    this.sandwich = new THREE.Group();
    this.sandwich.position.set(-0.16, -0.12, 0.56);
    this.sandwich.rotation.set(0.3, 0.2, 0.1);
    this.sandwich.add(new THREE.Mesh(build([
      { g: new THREE.BoxGeometry(0.34, 0.07, 0.24), p: [0, -0.05, 0] },
      { g: new THREE.BoxGeometry(0.34, 0.07, 0.24), p: [0, 0.07, 0] },
    ]), breadMat));
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.29), leafMat);
    leaf.position.y = 0.01;
    this.sandwich.add(leaf);
    this.arm.add(this.sandwich);

    // Фонарь
    const lampMat = holoMaterial({ color: '#cfe9cf', rim: HEX.green, fill: 0.9 });
    const lampG = new THREE.Group();
    lampG.position.set(LAMP.x, GY, LAMP.z);
    lampG.rotation.y = -0.5;
    lampG.scale.setScalar(1.25);
    this.park.add(lampG);
    lampG.add(new THREE.Mesh(build([
      { g: new THREE.CylinderGeometry(0.07, 0.11, 3.7, 12), p: [0, 1.85, 0] },
      { g: new THREE.CylinderGeometry(0.2, 0.26, 0.2, 12), p: [0, 0.1, 0] },
      { g: new THREE.CylinderGeometry(0.045, 0.045, 0.75, 8), p: [-0.33, 3.72, 0], r: [0, 0, Math.PI / 2] },
      { g: new THREE.ConeGeometry(0.28, 0.28, 16, 1, true), p: [-0.66, 3.6, 0] },
    ]), lampMat));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), glowMaterial('#ffffff', 2.4));
    bulb.position.set(-0.66, 3.48, 0);
    lampG.add(bulb);
    const lampGlow = glowSprite('#e9ffe0', 3.2, 1.1);
    lampGlow.position.copy(bulb.position);
    lampG.add(lampGlow);
    this.lampGlow = lampGlow;
    lampGlow.material.userData.noFade = true;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 1.9, 3.5, 40, 1, true), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: toColor('#d9ffcf', 1) }, uOpacity: { value: 1 }, uShow: { value: 1 } },
      vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    cone.position.set(-0.66, 1.72, 0);
    lampG.add(cone);

    // --- Конверт
    this.mail = new THREE.Group();
    this.root.add(this.mail);
    this.mailBody = new THREE.Group();
    this.mail.add(this.mailBody);
    const envTex = envelopeTexture();
    const env = texPlane(envTex, 1.0, 0.64, { k: 0.86 });
    this.mailBody.add(env);
    const flapShape = new THREE.Shape();
    flapShape.moveTo(-0.5, 0); flapShape.lineTo(0.5, 0); flapShape.lineTo(0, -0.36); flapShape.closePath();
    const flapMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d6e8d6').multiplyScalar(0.86), side: THREE.DoubleSide, transparent: true });
    this.flapPivot = new THREE.Group();
    this.flapPivot.position.set(0, 0.32, 0.004);
    this.flapPivot.add(new THREE.Mesh(new THREE.ShapeGeometry(flapShape), flapMat));
    this.mailBody.add(this.flapPivot);
    this.letter = texPlane(letterTexture(), 0.88, 0.62, { k: 0.86 });
    this.letter.position.set(0, 0, -0.006);
    this.mailBody.add(this.letter);
    this.mailGlow = glowSprite(HEX.greenHi, 2.2, 0.55);
    this.mailGlow.position.z = -0.05;
    this.mailGlow.material.userData.noFade = true;
    this.mail.add(this.mailGlow);
    // хвост не рисуется у самого конверта — иначе конверт у камеры выгорает в белое пятно
    this.trail = new Trail(46, { color: HEX.greenHi, k: 1.3, size: 0.3, scale: this.scaleU, headCut: 0.16 });
    this.root.add(this.trail.points);
    this.hit = shockRing(HEX.greenHi, 2.2, 3.4);
    this.root.add(this.hit);
    // траектория: от агента — высоко над парком — к исследователю
    const dest = this.mailDest = new THREE.Vector3();
    this.benchG.updateMatrixWorld(true);
    dest.set(-0.75, 1.75, 0.95).applyMatrix4(this.benchG.matrixWorld);
    this.mailCurve = new THREE.CubicBezierCurve3(
      ORB.clone().add(new THREE.Vector3(0.2, 0.25, 0)),
      new THREE.Vector3(-1.4, 3.7, 1.0),
      new THREE.Vector3(2.4, 3.9, -1.6),
      dest.clone(),
    );

    // --- Окна-страницы (шаг 1) и лучи к ним
    this.windows = [];
    const WIN = [
      { p: [-0.4, 2.15, -1.6], ry: 0.2, s: 0.82 },
      { p: [6.3, 4.9, -8.2], ry: -0.05, s: 1.05 },
      { p: [10.2, 2.0, -4.6], ry: -0.34, s: 0.95 },
      { p: [13.6, 5.8, -13.0], ry: -0.2, s: 1.2 },
    ];
    const beamPts = [];
    WIN.forEach((w, i) => {
      const g = new THREE.Group();
      g.position.set(...w.p);
      g.rotation.y = w.ry;
      const pl = texPlane(windowTexture(i), 3.0, 2.0, { k: 0.9 });
      g.add(pl);
      const halo = glowSprite(i === 3 ? HEX.red : HEX.green, 5.5, 0.35, 0.8);
      halo.position.z = -0.1;
      g.add(halo);
      g.userData = { base: w.s, phase: i * 1.7, y: w.p[1] };
      g.scale.setScalar(0.001);
      this.root.add(g);
      this.windows.push({ g, show: this.fader.add(g, 0) });
      beamPts.push(...ORB.toArray(), w.p[0], w.p[1] - 1.0 * w.s, w.p[2]);
    });
    this.beams = fatLines(beamPts, { color: HEX.greenHi, k: 1.4, width: 2.6, dashed: true, dashSize: 0.35, gapSize: 0.25 });
    this.root.add(this.beams);
    this.beamsH = this.fader.add(this.beams, 0);

    // --- Другой сервер с моделью и её весами (шаг 2)
    this.server = new THREE.Group();
    this.server.position.set(SERVER.x, GY, SERVER.z);
    this.server.rotation.y = 0.5;
    this.server.scale.setScalar(1.3);
    this.root.add(this.server);
    const rackMat = holoMaterial({ color: '#9fdc9f', rim: HEX.greenHi, fill: 0.85, rimK: 1.1 });
    this.server.add(new THREE.Mesh(build([
      { g: new THREE.BoxGeometry(1.9, 3.4, 1.4), p: [0, 1.7, 0] },
      { g: new THREE.BoxGeometry(2.1, 0.12, 1.55), p: [0, 3.44, 0] },
      { g: new THREE.BoxGeometry(2.1, 0.12, 1.55), p: [0, 0.06, 0] },
    ]), rackMat));
    const front = texPlane(serverTexture(), 1.7, 3.2, { k: 0.95 });
    front.position.set(0, 1.72, 0.71);
    this.server.add(front);
    // мигающие огоньки: мигание считается в шейдере (instanceColor не перезаливается каждый кадр)
    const ledGeo = new THREE.SphereGeometry(0.045, 8, 6);
    const phase = new Float32Array(27);
    for (let i = 0; i < 27; i++) phase[i] = i;
    ledGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.ledU = {
      uTime: { value: 0 }, uOpacity: { value: 1 }, uShow: { value: 1 },
      uOn: { value: toColor(HEX.greenHi, 2.2) }, uOff: { value: toColor('#0a3a0a', 1) },
    };
    this.leds = new THREE.InstancedMesh(ledGeo, new THREE.ShaderMaterial({
      uniforms: this.ledU, vertexShader: LED_VERT, fragmentShader: LED_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), 27);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 27; i++) {
      m4.makeTranslation(0.62 - (i % 3) * 0.12, 0.38 + Math.floor(i / 3) * 0.354, 0.74);
      this.leds.setMatrixAt(i, m4);
    }
    this.server.add(this.leds);
    this.serverGlow = glowSprite(HEX.greenHi, 9, 0.5);
    this.serverGlow.position.copy(BRAIN);
    this.root.add(this.serverGlow);
    this.serverH = this.fader.add(this.server, 0);
    this.serverGlowH = this.fader.add(this.serverGlow, 0);

    // нить: от модели на сервере к «рукам»
    const tp = [
      BRAIN.clone().add(new THREE.Vector3(0.6, -0.4, 0.5)),
      new THREE.Vector3(-11, 3.8, -6.5),
      new THREE.Vector3(-6.5, 3.4, -1.5),
      new THREE.Vector3(-4.2, 1.2, 1.6),
      ORB.clone(),
    ];
    this.threadCurve = new THREE.CatmullRomCurve3(tp, false, 'centripetal');
    this.threadMat = flowMaterial({ color: HEX.greenHi, k: 1.6, dim: '#0a2a0a', base: 0.0, dash: 22, flow: 0.9, headK: 4 });
    this.thread = new THREE.Mesh(new THREE.TubeGeometry(this.threadCurve, 220, 0.035, 8, false), this.threadMat);
    this.root.add(this.thread);
    this.threadH = this.fader.add(this.thread, 0);
    this.pulse = glowSprite('#ffffff', 0.9, 2);
    this.root.add(this.pulse);
    this.pulseH = this.fader.add(this.pulse, 0);

    // Подписи создаются при первом входе
    this.labelsMade = false;
  }

  makeLabels() {
    if (this.labelsMade) return;
    this.labelsMade = true;
    this.lMail = this.label({ html: '<div class="b5b-mail">«Я выбрался»</div>', object: this.mail, offset: [0.35, 0.72, 0], anchor: 'right', visible: false, className: 'b5b-pop' });
    this.lBang = this.label({ html: '<div class="b5b-bang">!</div>', object: this.head, offset: [0.32, 0.55, 0], visible: false, className: 'b5b-pop' });
    this.lHands = this.label({ html: lbl('«Руки» модели', 'выбрались наружу', 'is-accent'), object: this.agent, offset: [0, 0.95, 0], anchor: 'bottom', visible: false, className: 'b5b-pop' });
    this.lModel = this.label({ html: lbl('Модель и её веса', 'остались на другом сервере'), position: [SERVER.x + 0.4, GY + 0.2, SERVER.z + 1.2], anchor: 'top', visible: false, className: 'b5b-pop' });
  }

  // ---------- Камера и фон ----------
  // Позы — для 16:9; под 4:3/16:10 их подгоняет ядро.
  camera(state, step) {
    if (step >= 2) return { pos: [-6.4, 3.4, 17.5], target: [-5.0, -0.2, -4.6], fov: 50 };
    return { pos: [-0.6, 1.5, 13.4], target: [0.6, -0.35, -2.6], fov: 45 };
  }
  background(state, step) { return 'none'; }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    setCell(this.ctx.height * this.ctx.engine.pixelRatio);
    setLineResolution(this.ctx.width, this.ctx.height);
    this.makeLabels();
    this.claimParticles();
    const p = this.particles;
    const n = p.count;
    p.setParams({ noise: 0.07, swirl: 0, size: 0.056, twinkle: 0.45, spring: 14, damping: 5.2 }, o.instant ? 0 : 1.2);
    p.morph(parkShape(n, this.step >= 2), { duration: o.instant ? 0.01 : 2.4, stagger: 0.55, burst: 10 });
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.brainOn = this.step >= 2;
    this.hit.visible = false;   // ударное кольцо могло «застыть», если уход прервал анимацию
    // парк «вырастает»: стволы поднимаются, пока частицы собираются в кроны
    const fresh = this.step === 0 && (o.dir ?? 1) > 0 && !o.instant;
    if (fresh) {
      this.trunks.scale.y = 0.02;
      this.twk('trunks', this.trunks.scale, { y: 1, duration: 2.0, delay: 0.25, ease: 'power3.out' });
    } else { this._keyed?.get('trunks')?.kill(); this.trunks.scale.y = 1; }
    // письмо: при входе вперёд на шаг 0 — летит, иначе уже доставлено
    if (fresh) this.launch(0.7);
    else this.deliver(true);
    this.applyStep(this.step, true);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    if (step >= 1 && this.flight.k < 1) this.deliver(false);
    const wantBrain = step >= 2;
    if (wantBrain !== this.brainOn && this.ownsParticles()) {
      this.brainOn = wantBrain;
      this.particles.morph(parkShape(this.particles.count, wantBrain), { duration: 2.2, stagger: 0.5, burst: wantBrain ? 9 : 6 });
    }
    this.applyStep(step, !!o.instant, prev);
  }

  applyStep(step, instant = false, prev = -1) {
    const d = instant ? 0 : 1;
    const kt = this.kt;
    // окна (шаг ≥ 1)
    this.windows.forEach((w, i) => {
      const on = step >= 1;
      const target = on ? (step >= 2 ? 0.55 : 1) : 0;
      if (instant) {
        kt.kill('win' + i); kt.kill('winS' + i); kt.kill('winFx' + i);
        w.show.show = target;
        w.g.scale.setScalar(on ? w.g.userData.base : 0.001);
      } else {
        const delay = on && prev < 1 ? 0.15 + i * 0.22 : 0;
        const sc = on ? w.g.userData.base : 0.001;
        kt.to('win' + i, w.show, { show: target, duration: 0.6, delay });
        kt.to('winS' + i, w.g.scale, { x: sc, y: sc, z: sc, duration: on ? 0.75 : 0.45, delay, ease: on ? 'back.out(2.2)' : 'power2.in' });
        if (on && prev < 1) kt.delay('winFx' + i, delay, () => this.ctx.engine.pulse({ glitch: 0.35, aberration: 0.8 }, 0.35));
        else kt.kill('winFx' + i);
      }
    });
    kt.to('beams', this.beamsH, { show: step >= 1 ? (step >= 2 ? 0.35 : 1) : 0, duration: 0.8 * d });
    // сервер с моделью и нить (шаг 2)
    const s2 = step >= 2;
    kt.to('server', this.serverH, { show: s2 ? 1 : 0, duration: 1.0 * d, delay: s2 && !instant ? 0.4 : 0 });
    kt.to('sglow', this.serverGlowH, { show: s2 ? 1 : 0, duration: 1.2 * d, delay: s2 && !instant ? 0.6 : 0 });
    kt.to('thread', this.threadH, { show: s2 ? 1 : 0, duration: 0.6 * d, delay: s2 && !instant ? 0.9 : 0 });
    kt.to('pulse', this.pulseH, { show: s2 ? 1 : 0, duration: 0.6 * d, delay: s2 && !instant ? 2.2 : 0 });
    const u = this.threadMat.uniforms.uLit;
    if (instant) { kt.kill('tlit'); u.value = s2 ? 1 : 0; }
    else kt.to('tlit', u, { value: s2 ? 1 : 0, duration: s2 ? 1.6 : 0.6, delay: s2 ? 1.0 : 0, ease: 'power2.inOut' });
    if (this.lMail && this.flight.k >= 1) { if (s2) this.lMail.hide(); else this.lMail.show(); }
    if (this.lHands) {
      if (s2) {
        kt.delay('lHands', instant ? 0 : 2.3, () => { if (this.step >= 2) this.lHands.show(); });
        kt.delay('lModel', instant ? 0 : 1.4, () => { if (this.step >= 2) this.lModel.show(); });
      } else {
        kt.kill('lHands'); kt.kill('lModel');
        this.lHands.hide(); this.lModel.hide();
      }
    }
  }

  /** Запуск конверта от агента к исследователю. */
  launch(delay = 0) {
    this.flight.k = 0;
    this.flap.a = 0;
    this.letterUp.k = 0;
    this.sv.mail = 0;
    this.lMail?.hide();
    this.lBang?.hide();
    this.trail.reset(this.mailCurve.getPoint(0, this._v));
    this.tw(this.sv, { mail: 1, duration: 0.5, delay });
    this.tw(this.flight, {
      k: 1, duration: 2.6, delay: delay + 0.2, ease: 'power1.inOut',
      onComplete: () => this.arrive(),
    });
  }

  arrive() {
    this.hit.position.copy(this.mailDest);
    this.hit.visible = true;
    this.fromTo(this.hit.material.uniforms.uT, { value: 0 }, { value: 1, duration: 1.2, ease: 'power2.out', onComplete: () => { this.hit.visible = false; } });
    this.tw(this.flap, { a: 1, duration: 0.6, ease: 'back.out(1.6)' });
    this.tw(this.letterUp, { k: 1, duration: 0.8, delay: 0.35, ease: 'power3.out' });
    this.delay(0.45, () => { if (this.step < 2) this.lMail?.show(); });
    this.delay(0.15, () => { if (this.step < 1) this.lBang?.show(); });
    this.delay(2.4, () => this.lBang?.hide());
  }

  deliver(instant) {
    this.killFlight();
    this.flight.k = 1;
    this.sv.mail = 1;
    if (instant) {
      this.flap.a = 1;
      this.letterUp.k = 1;
    } else {
      this.tw(this.flap, { a: 1, duration: 0.4 });
      this.tw(this.letterUp, { k: 1, duration: 0.5 });
    }
    if (this.step < 2) this.lMail?.show(); else this.lMail?.hide();
    this.lBang?.hide();
    this.trail.reset(this.mailDest);
  }

  killFlight() {
    this._tweens.forEach((t) => { const tg = t.targets?.(); if (tg && (tg.includes(this.flight) || tg.includes(this.flap) || tg.includes(this.letterUp) || tg.includes(this.sv))) t.kill(); });
  }

  exit(o = {}) {
    // отложенные показы подписей не должны сработать во время ухода
    this.killTweens();
    this.lMail?.hide(); this.lBang?.hide(); this.lHands?.hide(); this.lModel?.hide();
    return super.exit(o);
  }

  resize(w, h, dpr) {
    setCell(h * dpr);
    setLineResolution(w, h);
  }

  update(dt, t) {
    this.fader.apply(this.opacity);
    this.groundU.uCam.value.copy(this.ctx.camera.position);

    // агент: покачивание, «ощупывающие» манипуляторы
    this.agent.position.set(ORB.x, ORB.y + Math.sin(t * 1.6) * 0.12, ORB.z);
    this.agent.rotation.y = t * 0.5;
    const open = 0.25 + 0.2 * Math.sin(t * 2.2);
    this.claws.forEach((c) => { c.rotation.z = -open; });
    this.orb.scale.setScalar(1 + Math.sin(t * 5) * 0.06);

    // исследователь ест бутерброд; при письме поворачивает голову
    const bite = Math.max(0, Math.sin(t * 0.9)) ** 6;
    this.arm.rotation.x = -0.15 - bite * 0.75;
    this.arm.rotation.z = bite * 0.15;
    const look = this.flight.k > 0.7 ? 1 : 0;
    this.head.rotation.y = approachAngle(this.head.rotation.y, look ? -0.55 : Math.sin(t * 0.4) * 0.15, dt * 3);
    this.head.rotation.x = -bite * 0.15;

    // конверт
    const k = this.flight.k;
    const mail = this.mail;
    this.mailCurve.getPoint(Math.min(1, k), this._v);
    if (k < 1) {
      mail.position.copy(this._v);
      mail.rotation.set(Math.sin(t * 7) * 0.3, t * 4 % (Math.PI * 2), Math.sin(t * 5) * 0.25);
      this.trail.push(this._v);
    } else {
      mail.position.set(this.mailDest.x, this.mailDest.y + Math.sin(t * 1.8) * 0.06, this.mailDest.z);
      // смотрит в камеру
      mail.quaternion.slerp(this.ctx.camera.quaternion, Math.min(1, dt * 5));
      // хвост догорает; когда погас — буфер больше не перезаливается
      if (this.trail.uniforms.uShow.value > 0.001) this.trail.push(mail.position);
    }
    this.mail.visible = this.sv.mail > 0.01;
    this.mailBody.scale.setScalar(0.2 + 0.8 * this.sv.mail);
    this.flapPivot.rotation.x = -this.flap.a * 2.6;
    this.letter.position.y = this.letterUp.k * 0.42;
    this.trail.uniforms.uShow.value = k < 1 ? 1 : Math.max(0, this.trail.uniforms.uShow.value - dt * 1.5);
    if (this.hit.visible) this.hit.quaternion.copy(this.ctx.camera.quaternion);
    this.mailGlow.material.opacity = (0.5 + 0.3 * Math.sin(t * 3)) * this.opacity;

    // окна покачиваются, лучи «текут»
    this.windows.forEach((w) => {
      const ph = w.g.userData.phase;
      w.g.position.y = w.g.userData.y + Math.sin(t * 0.9 + ph) * 0.1;
      w.g.rotation.z = Math.sin(t * 0.6 + ph) * 0.03;
    });
    this.beams.material.dashOffset = -t * 1.4;

    // сервер: огоньки, нить, импульс по нити
    if (this.serverH.show > 0.01) {
      this.ledU.uTime.value = t;
      this.threadMat.uniforms.uTime.value = t;
      const pk = (t * 0.32) % 1;
      this.threadCurve.getPoint(pk, this._v2);
      this.pulse.position.copy(this._v2);
      this.pulse.scale.setScalar(0.8 + Math.sin(t * 12) * 0.15);
      this.serverGlow.material.opacity = (0.45 + 0.15 * Math.sin(t * 2.1)) * this.opacity * this.serverGlowH.show;
    }
    this.lampGlow.material.opacity = (0.9 + 0.08 * Math.sin(t * 13) * Math.sin(t * 3.1)) * this.opacity;
    this.moon.rotation.y = t * 0.02;

    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = 0;
    }
  }
}

function approachAngle(a, b, k) { return a + (b - a) * Math.min(1, k); }
