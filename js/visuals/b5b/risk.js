// «Финальный кадр»: слева — карикатурный робот-злодей из кино (его перечёркивает красный крест),
// справа — отличник на горе тестов: стопки листов растут и поднимают его вверх, сверху падают новые листы.
// Вокруг горы — дырявый забор, узкий луч «цели» уходит через дыру к мишени «Сдать тест».
//   шаг 1 — камера отъезжает: такая модель «у всех» — толпа людей со светящимися ИИ в руках,
//           от них к замкам тянутся потоки, замки открываются волной.
// Массовые анимации (рост стопок, появление людей и замков, открывание дужек) считаются в вершинных шейдерах
// по атрибутам-«расписаниям»: буферы экземпляров заливаются один раз, каждый кадр меняются только uniform.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import {
  HEX, toColor, holoMaterial, glowSprite, glowMaterial, fatLines, Fader, canvasTexture, roundRect,
  lbl, build, limb, setCell, setLineResolution, shockRing, keyed,
} from './kit.js';

const GY = -3.2;
const VIL = new THREE.Vector3(-7.4, GY, 0.6);
const MT = new THREE.Vector3(3.6, GY, -0.8);       // центр горы тестов
const MT_H = 3.0, MT_R = 2.9;
const GOAL = new THREE.Vector3(10.6, 2.6, -3.2);
const FENCE_R = 4.3;
const LOCKS = 30;

// ---------------------------------------------------------------------------
// Раскладки (детерминированные): стопки горы, толпа, замки. Координаты — относительно центра горы.
// ---------------------------------------------------------------------------
/** Рост стопки k(uGrow) — та же формула, что в шейдере (для отличника на вершине). */
const growK = (g, delay) => { const k = Math.min(1, Math.max(0, (g * 1.45 - delay) / 0.45)); return k * k * (3 - 2 * k); };

const STACK_DATA = (() => {
  const r = rng(2301), out = [];
  const N = 58;
  for (let i = 0; i < N; i++) {
    // «подсолнух»: плотная равномерная укладка по кругу, в центре — самая высокая стопка
    const rr = MT_R * Math.sqrt(i / N) * (i ? 1 : 0);
    const a = i * 2.39996 + r.range(-0.2, 0.2);
    const u = rr / MT_R;
    const h = i === 0 ? MT_H : Math.max(0.25, MT_H * Math.pow(1 - Math.pow(u, 1.5), 0.9) * r.range(0.82, 1.04));
    out.push({
      x: Math.cos(a) * rr, z: Math.sin(a) * rr, h,
      ry: r() * Math.PI, rx: r.gauss(0, 0.025), rz: r.gauss(0, 0.025),
      delay: 0.08 + (1 - u) * 0.62 + r() * 0.12,   // от краёв к вершине: гора «вырастает»
    });
  }
  // россыпь отдельных листов у подножия
  for (let i = 0; i < 34; i++) {
    const a = r() * Math.PI * 2, rr = r.range(MT_R + 0.1, FENCE_R - 0.35);
    out.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, h: r.range(0.03, 0.09), ry: r() * Math.PI, rx: 0, rz: 0, delay: r.range(0, 0.3) });
  }
  return out;
})();
const TOP_DELAY = STACK_DATA[0].delay;

const VX = VIL.x - MT.x, VZ = VIL.z - MT.z;
const PEOPLE = (() => {
  const r = rng(2201), out = [];
  for (let row = 0; row < 8; row++) {
    const z = 6.4 - row * 2.55;
    const sp = 2.3 + row * 0.14;
    const cnt = 17 + row * 2;
    for (let j = 0; j < cnt; j++) {
      const x = (j - (cnt - 1) / 2) * sp + r.range(-0.45, 0.45);
      const zz = z + r.range(-0.6, 0.6);
      if (Math.abs(x) > 25) continue;
      if (Math.hypot(x, zz) < FENCE_R + 0.9) continue;          // не на горе
      if (Math.hypot(x - VX, zz - VZ) < 2.9) continue;          // не на злодее
      out.push({ x, z: zz, s: r.range(0.9, 1.12), ry: r.range(-0.55, 0.55), delay: Math.hypot(x, zz) / 28 + r() * 0.18 });
    }
  }
  return out;
})();
// рука, в которой «ИИ» (в локальных координатах человека)
const HAND = [0.5, 1.12, 0.36];
function handOf(p, out) {
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  out[0] = p.x + (c * HAND[0] + s * HAND[2]) * p.s;
  out[1] = HAND[1] * p.s;
  out[2] = p.z + (-s * HAND[0] + c * HAND[2]) * p.s;
  return out;
}

const LOCK_DATA = (() => {
  const r = rng(2401), out = [];
  for (let i = 0; i < LOCKS; i++) {
    let x, z, guard = 0;
    do {
      x = r.range(-17, 17); z = r.range(-14, 6);
      guard++;
    } while (guard < 80 && (Math.hypot(x, z) < FENCE_R + 1.5 || (Math.abs(x - VX) < 4.2 && z > -7)));
    out.push({ x, z, y: 2.4 + r.range(0, 1.6), delay: Math.hypot(x, z) / 20 + r() * 0.25, ry: r.range(-0.5, 0.5) });
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Частицы: вихрь листков вокруг горы (шаг 0) → «ИИ у всех» (шаг 1): огоньки в руках и потоки к замкам
// ---------------------------------------------------------------------------
const SHAPES = new Map();
function vortexShape(n) {
  const key = n + ':v';
  if (SHAPES.has(key)) return SHAPES.get(key);
  const s = S.createShape(n), r = rng(2101);
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.38) {
      // вихрь листков: спираль вокруг горы
      const t = r();
      const a = t * 18 + r.gauss(0, 0.3);
      const rad = 3.4 + t * 3.2 + r.gauss(0, 0.25);
      const y = -0.2 + t * 6.2 + r.gauss(0, 0.2);
      const c = r() < 0.7 ? S.PAL.white : r() < 0.6 ? S.PAL.greenHi : S.PAL.mint;
      S.setPoint(s, i, Math.cos(a) * rad, y, Math.sin(a) * rad, r.range(0.5, 1.1), c, r.range(0.1, 0.34) * (1 - t * 0.5));
    } else if (k < 0.66) {
      // «арена» — халфтон-кольца под горой
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 9.5;
      const g = Math.round(rad * 3) / 3;
      S.setPoint(s, i, Math.cos(a) * g, 0.02, Math.sin(a) * g, r.range(0.5, 0.9), S.PAL.green, r.range(0.08, 0.25) * (1 - rad / 10));
    } else {
      // звёзды
      S.setPoint(s, i, r.range(-46, 46), r.range(-2, 26), r.range(-60, -26), r.range(0.5, 1.2), S.PAL.white, r.range(0.05, 0.3));
    }
  }
  s.meta.axis = 'z';
  SHAPES.set(key, s);
  return s;
}

function crowdShape(n) {
  const key = n + ':c';
  if (SHAPES.has(key)) return SHAPES.get(key);
  const s = S.createShape(n), r = rng(2202);
  const h = [0, 0, 0];
  const nOrb = Math.floor(n * 0.24), nStream = Math.floor(n * 0.36);
  let i = 0;
  // 1) светящийся «ИИ» в руке у каждого
  const perOrb = Math.floor(nOrb / PEOPLE.length);
  for (const p of PEOPLE) {
    handOf(p, h);
    for (let k = 0; k < perOrb; k++, i++) {
      const [dx, dy, dz] = r.inSphere(0.24 * p.s);
      const c = r() < 0.6 ? S.PAL.greenHi : S.PAL.bright;
      S.setPoint(s, i, h[0] + dx, h[1] + dy, h[2] + dz, r.range(0.7, 1.4), c, r.range(0.4, 0.8));
    }
  }
  // 2) потоки «атак»: от ИИ — к ближайшему замку (у каждого второго), к замку краснеют
  const shooters = PEOPLE.filter((_, j) => j % 2 === 0);
  const per = Math.floor(nStream / shooters.length);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), v = new THREE.Vector3();
  const crv = new THREE.QuadraticBezierCurve3(A, C, B);
  const red = S.PAL.red;
  for (const p of shooters) {
    handOf(p, h);
    let best = LOCK_DATA[0], bd = Infinity;
    for (const L of LOCK_DATA) { const d = (L.x - p.x) ** 2 + (L.z - p.z) ** 2; if (d < bd) { bd = d; best = L; } }
    A.set(h[0], h[1], h[2]);
    B.set(best.x, best.y - 0.1, best.z);
    C.copy(A).lerp(B, 0.5).add(v.set(0, 1.4, 0));
    for (let k = 0; k < per; k++, i++) {
      const t = r();
      crv.getPoint(t, v);
      const c = t > 0.72 ? S.mixColor(S.PAL.greenHi, red, (t - 0.72) / 0.28) : S.PAL.greenHi;
      S.setPoint(s, i, v.x + r.gauss(0, 0.035), v.y + r.gauss(0, 0.035), v.z + r.gauss(0, 0.035), r.range(0.5, 1.0), c, r.range(0.28, 0.55));
    }
  }
  // 3) остаток — звёзды
  for (; i < n; i++) S.setPoint(s, i, r.range(-50, 50), r.range(2, 30), r.range(-70, -30), r.range(0.5, 1.2), S.PAL.white, r.range(0.05, 0.3));
  s.meta.axis = 'z';
  SHAPES.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Стопки тестов: верх — лист теста, бока — кромки листов (тонкие линии), рост — в шейдере
// ---------------------------------------------------------------------------
const STACK_VERT = /* glsl */ `
attribute float aDelay;
uniform float uGrow;
varying vec2 vUv;
varying vec3 vN;
varying float vH;
varying float vTop;
void main() {
  float k = clamp((uGrow * 1.45 - aDelay) / 0.45, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec4 p = vec4(position, 1.0);
  p.y *= max(k, 0.002);
  float h = length(instanceMatrix[1].xyz);
  vH = position.y * h * k;
  vTop = step(0.5, normal.y);
  vUv = uv;
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * p;
}
`;
const STACK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uPaper, uShade;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vN;
varying float vH;
varying float vTop;
void main() {
  vec3 n = normalize(vN);
  float lam = 0.5 + 0.5 * clamp(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0, 1.0);
  vec3 col;
  if (vTop > 0.5) {
    col = texture2D(uMap, vUv).rgb * 0.8;
  } else {
    // кромки листов: линия каждые 0.06 (гасим, когда линии мельче пикселя — без муара)
    float f = vH / 0.06;
    float w = fwidth(f);
    float d = abs(fract(f + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.06, 0.06 + max(w, 0.001) * 1.2, d);
    line *= 1.0 - smoothstep(0.25, 0.6, w);
    col = uPaper * lam * (1.0 - 0.38 * line);
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.45, vH);   // тень у основания
    col = mix(uShade, col, 0.85 + 0.15 * lam);
  }
  gl_FragColor = vec4(col, uOpacity);
}
`;

function sheetTexture() {
  return canvasTexture(256, 340, (g, w, h) => {
    g.fillStyle = '#eef6ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,40,10,.32)';
    for (let i = 0; i < 6; i++) { roundRect(g, 26, 40 + i * 44, (w - 52) * (i % 3 === 2 ? 0.6 : 1), 14, 7); g.fill(); }
    g.strokeStyle = '#00c000'; g.lineWidth = 18; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(150, 250); g.lineTo(180, 286); g.lineTo(236, 206); g.stroke();
  });
}

// Появление экземпляров (люди, замки): масштаб по uPop и своей задержке
const POP_HEAD = 'attribute float aDelay; uniform float uPop; uniform float uOpen;';
const POP_K = `
  float pk = clamp((uPop * 1.5 - aDelay) / 0.5, 0.0, 1.0);
  pk = pk * pk * (3.0 - 2.0 * pk);`;

export default class Risk extends Visual {
  static transition = 'halftone';

  async init() {
    this.fader = new Fader();
    this.kt = keyed(this);
    this.st = { cross: 0, villain: 1, beam: 0 };
    this.stackU = { uGrow: { value: 0 } };
    this.crowdU = { uPop: { value: 0 }, uOpen: { value: 0 } };
    this.lockU = { uPop: { value: 0 }, uOpen: { value: 0 } };

    this.buildVillain();
    this.buildMountain();
    this.buildStudent();
    this.buildFence();
    this.buildGoal();
    this.buildCrowd();
    this.buildLocks();

    const n = this.ctx.particles.count;
    vortexShape(n);
    crowdShape(n);
    this.labelsMade = false;
  }

  // ---------- Злодей ----------
  buildVillain() {
    const g = this.villain = new THREE.Group();
    g.position.copy(VIL);
    g.rotation.y = 0.35;
    this.root.add(g);
    this.vilMat = holoMaterial({ color: '#ff5a50', rim: '#ffb0a8', base: '#0a0303', fill: 0.95, rimK: 1.1 });
    const torso = new THREE.CylinderGeometry(1.15, 0.78, 1.7, 4, 1);
    torso.rotateY(Math.PI / 4);
    g.add(new THREE.Mesh(build([
      { g: torso, p: [0, 2.35, 0], s: [1, 1, 0.62] },
      { g: new RoundedBoxGeometry(1.45, 1.15, 1.05, 3, 0.14), p: [0, 3.85, 0] },              // голова
      { g: new THREE.BoxGeometry(1.05, 0.34, 0.2), p: [0, 3.45, 0.5] },                        // челюсть
      { g: new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), p: [0.35, 4.7, 0] },                // антенна
      { g: new THREE.SphereGeometry(0.28, 16, 12), p: [-1.25, 3.0, 0] },                       // плечи
      { g: new THREE.SphereGeometry(0.28, 16, 12), p: [1.25, 3.0, 0] },
      limb([-1.3, 3.0, 0], [-1.75, 2.3, 0.35], 0.17),
      limb([-1.75, 2.3, 0.35], [-1.7, 3.3, 0.8], 0.15),                                         // поднятые «когти»
      limb([1.3, 3.0, 0], [1.75, 2.3, 0.35], 0.17),
      limb([1.75, 2.3, 0.35], [1.7, 3.3, 0.8], 0.15),
      ...[-1.7, 1.7].flatMap((x) => [-0.18, 0, 0.18].map((dz, k) => limb([x, 3.35, 0.8], [x + (k - 1) * 0.12, 3.75, 0.9 + dz * 0.4], 0.06))),
      limb([-0.4, 1.5, 0], [-0.45, 0.35, 0.05], 0.22),                                          // ноги
      limb([0.4, 1.5, 0], [0.45, 0.35, 0.05], 0.22),
      { g: new RoundedBoxGeometry(0.62, 0.3, 0.85, 2, 0.08), p: [-0.45, 0.15, 0.15] },
      { g: new RoundedBoxGeometry(0.62, 0.3, 0.85, 2, 0.08), p: [0.45, 0.15, 0.15] },
    ]), this.vilMat));
    // зубы-решётка и визор
    const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
    g.add(new THREE.Mesh(build([
      { g: new THREE.BoxGeometry(1.2, 0.42, 0.06), p: [0, 3.98, 0.53] },
      ...[-0.32, -0.16, 0, 0.16, 0.32].map((x) => ({ g: new THREE.BoxGeometry(0.06, 0.26, 0.05), p: [x, 3.45, 0.61] })),
    ]), dark));
    // злые красные глаза (скошенные)
    this.eyeMat = glowMaterial(HEX.red, 2.6, 1);
    const eyes = new THREE.Mesh(build([
      { g: new THREE.BoxGeometry(0.38, 0.12, 0.05), p: [-0.28, 4.0, 0.57], r: [0, 0, -0.32] },
      { g: new THREE.BoxGeometry(0.38, 0.12, 0.05), p: [0.28, 4.0, 0.57], r: [0, 0, 0.32] },
    ]), this.eyeMat);
    g.add(eyes);
    this.eyeGlow = [-0.28, 0.28].map((x) => {
      const s = glowSprite(HEX.red, 1.4, 1.6);
      s.material.userData.noFade = true;
      s.position.set(x, 4.0, 0.7);
      g.add(s);
      return s;
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), glowMaterial(HEX.red, 2.4));
    bulb.position.set(0.35, 5.05, 0);
    g.add(bulb);
    this.bulb = bulb;
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), glowMaterial(HEX.red, 1.3, 1));
    core.position.set(0, 2.55, 0.62);
    g.add(core);
    this.vilCore = core;

    // Красный крест: непрозрачные (не аддитивные) перекладины — в перекрестии нет белого пересвета
    this.cross = new THREE.Group();
    this.cross.position.set(VIL.x, VIL.y + 2.6, VIL.z + 1.4);
    const barMat = new THREE.MeshBasicMaterial({ color: toColor(HEX.red, 1.2), transparent: true, depthWrite: false });
    barMat.userData.noFade = true;
    this.cross.add(new THREE.Mesh(build([
      { g: new RoundedBoxGeometry(6.4, 0.42, 0.2, 2, 0.1), r: [0, 0, 0.78] },
      { g: new RoundedBoxGeometry(6.4, 0.42, 0.2, 2, 0.1), p: [0, 0, 0.01], r: [0, 0, -0.78] },
    ]), barMat));
    const cg = glowSprite(HEX.red, 8, 0.45);
    cg.material.userData.noFade = true;
    this.cross.add(cg);
    this.crossMat = barMat;
    this.crossGlow = cg;
    this.cross.renderOrder = 3;
    this.cross.visible = false;
    this.root.add(this.cross);
  }

  // ---------- Гора тестов: стопки листов ----------
  buildMountain() {
    const tex = this.sheetTex = sheetTexture();
    const geo = new THREE.BoxGeometry(0.62, 1, 0.82);
    geo.translate(0, 0.5, 0);                       // основание стопки — на земле
    const N = STACK_DATA.length;
    const delay = new Float32Array(N);
    STACK_DATA.forEach((d, i) => { delay[i] = d.delay; });
    geo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uPaper: { value: new THREE.Color(0.76, 0.8, 0.76) },
        uShade: { value: new THREE.Color(0.08, 0.2, 0.09) },
        uOpacity: { value: 1 },
        uGrow: this.stackU.uGrow,
      },
      vertexShader: STACK_VERT, fragmentShader: STACK_FRAG,
      transparent: true,
    });
    this.stacks = new THREE.InstancedMesh(geo, mat, N);
    this.stacks.position.copy(MT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    STACK_DATA.forEach((d, i) => {
      e.set(d.rx, d.ry, d.rz);
      q.setFromEuler(e);
      m4.compose(p.set(d.x, 0, d.z), q, sc.set(1, d.h, 1));
      this.stacks.setMatrixAt(i, m4);
    });
    this.stacks.frustumCulled = false;
    this.root.add(this.stacks);

    // падающие сверху листы (бесконечный «приток» тестов)
    const fallMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    fallMat.color.setScalar(0.82);
    const fallGeo = new THREE.BoxGeometry(0.62, 0.02, 0.82);
    this.fall = [];
    for (let k = 0; k < 7; k++) {
      const m = new THREE.Mesh(fallGeo, fallMat);
      m.visible = false;
      this.root.add(m);
      const a0 = k * 2.4, r0 = MT_R * 0.3;
      this.fall.push({ m, t: -k * 0.45, x: MT.x + Math.cos(a0) * r0, z: MT.z + Math.sin(a0) * r0, spin: 1.5 - k * 0.5, seed: k * 7.31 });
    }
    // мягкое свечение у подножия
    const glow = glowSprite(HEX.greenHi, 9, 0.3);
    glow.position.set(MT.x, MT.y + 1.3, MT.z);
    this.root.add(glow);
  }

  // ---------- Отличник ----------
  buildStudent() {
    const g = this.student = new THREE.Group();
    g.position.set(MT.x, MT.y + MT_H + 0.05, MT.z);
    g.rotation.y = -0.45;
    g.scale.setScalar(1.3);
    this.root.add(g);
    const body = holoMaterial({ color: '#9dff8e', rim: '#ffffff', fill: 0.95, rimK: 1.0, base: '#031003' });
    g.add(new THREE.Mesh(build([
      { g: new THREE.CapsuleGeometry(0.42, 0.45, 6, 16), p: [0, 0.75, 0] },                    // туловище
      { g: new THREE.SphereGeometry(0.46, 24, 18), p: [0, 1.62, 0] },                          // голова
      limb([-0.25, 0.28, 0.15], [-0.6, 0.18, 0.55], 0.13),                                       // ноги (сидит)
      limb([0.25, 0.28, 0.15], [0.6, 0.18, 0.55], 0.13),
      limb([-0.42, 1.05, 0], [-0.55, 0.65, 0.4], 0.1),                                          // левая рука держит лист
    ]), body));
    // очки
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    g.add(new THREE.Mesh(build([
      { g: new THREE.TorusGeometry(0.17, 0.045, 10, 28), p: [-0.19, 1.66, 0.42] },
      { g: new THREE.TorusGeometry(0.17, 0.045, 10, 28), p: [0.19, 1.66, 0.42] },
      { g: new THREE.BoxGeometry(0.12, 0.04, 0.04), p: [0, 1.68, 0.44] },
    ]), rimMat));
    const eyes = new THREE.Mesh(build([
      { g: new THREE.SphereGeometry(0.075, 12, 10), p: [-0.19, 1.66, 0.38] },
      { g: new THREE.SphereGeometry(0.075, 12, 10), p: [0.19, 1.66, 0.38] },
    ]), glowMaterial(HEX.greenHi, 2.2));
    g.add(eyes);
    // шапочка выпускника
    const capMat = holoMaterial({ color: '#2a2a2a', rim: '#ffffff', fill: 0.5, rimK: 0.9, base: '#050505' });
    const cap = new THREE.Group();
    cap.position.set(0, 2.02, 0);
    cap.rotation.set(-0.12, 0.3, 0.08);
    cap.add(new THREE.Mesh(build([
      { g: new THREE.CylinderGeometry(0.34, 0.38, 0.22, 20), p: [0, 0, 0] },
      { g: new THREE.BoxGeometry(1.05, 0.06, 1.05), p: [0, 0.13, 0], r: [0, Math.PI / 4, 0] },
    ]), capMat));
    const tassel = new THREE.Mesh(build([
      { g: new THREE.CylinderGeometry(0.015, 0.015, 0.45, 6), p: [0.52, -0.06, 0] },
      { g: new THREE.SphereGeometry(0.06, 10, 8), p: [0.52, -0.3, 0] },
    ]), glowMaterial(HEX.greenHi, 1.8));
    cap.add(tassel);
    g.add(cap);
    // правая рука с карандашом — быстро пишет
    this.arm = new THREE.Group();
    this.arm.position.set(0.42, 1.05, 0);
    this.arm.add(new THREE.Mesh(build([limb([0, 0, 0], [0.22, -0.35, 0.42], 0.1)]), body));
    const pencil = new THREE.Mesh(build([
      { g: new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), p: [0, 0.1, 0] },
      { g: new THREE.ConeGeometry(0.035, 0.1, 8), p: [0, -0.16, 0], r: [Math.PI, 0, 0] },
    ]), glowMaterial('#ffe08a', 1.2));
    pencil.position.set(0.22, -0.35, 0.45);
    pencil.rotation.set(0.6, 0, -0.4);
    this.arm.add(pencil);
    g.add(this.arm);
    // лист на коленях
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.8), new THREE.MeshBasicMaterial({ map: this.sheetTex, side: THREE.DoubleSide, transparent: true }));
    paper.material.color.setScalar(0.85);
    paper.position.set(0, 0.42, 0.62);
    paper.rotation.x = -1.2;
    g.add(paper);
    const halo = glowSprite(HEX.greenHi, 4.2, 0.28);
    halo.position.set(0, 1.3, -0.6);
    g.add(halo);
  }

  // ---------- Дырявый забор ----------
  buildFence() {
    const posts = [];
    const rails = [];
    const gaps = [[-0.35, 0.2], [1.7, 2.15], [3.6, 4.05]];     // углы дыр (рад)
    const inGap = (a) => gaps.some(([a0, a1]) => a > a0 && a < a1);
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - 0.6;
      if (inGap(a)) continue;
      posts.push({ g: new THREE.BoxGeometry(0.14, 1.5, 0.14), p: [Math.cos(a) * FENCE_R, 0.75, Math.sin(a) * FENCE_R], r: [0, -a, 0] });
    }
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 - 0.6, b = ((i + 1) / 120) * Math.PI * 2 - 0.6;
      if (inGap(a) || inGap(b)) continue;
      for (const y of [0.5, 1.15]) rails.push(Math.cos(a) * FENCE_R, y, Math.sin(a) * FENCE_R, Math.cos(b) * FENCE_R, y, Math.sin(b) * FENCE_R);
    }
    const g = this.fence = new THREE.Group();
    g.position.set(MT.x, GY, MT.z);
    g.rotation.y = 0.15;
    g.add(new THREE.Mesh(build(posts), holoMaterial({ color: '#9fb59f', rim: '#ffffff', fill: 0.8, rimK: 0.8 })));
    g.add(fatLines(rails, { color: '#cfe9cf', k: 0.9, width: 2.6 }));
    // красные «дыры»
    this.gapGlows = gaps.map(([a0, a1]) => {
      const a = (a0 + a1) / 2;
      const s = glowSprite(HEX.red, 2.6, 1.0);
      s.material.userData.noFade = true;
      s.position.set(Math.cos(a) * FENCE_R, 0.8, Math.sin(a) * FENCE_R);
      g.add(s);
      return s;
    });
    this.root.add(g);
  }

  // ---------- Узкая цель ----------
  buildGoal() {
    const g = this.goal = new THREE.Group();
    g.position.copy(GOAL);
    g.rotation.y = -0.7;
    const rings = [];
    [1.15, 0.78, 0.42].forEach((rr) => {
      for (let j = 0; j < 64; j++) {
        const a = (j / 64) * Math.PI * 2, b = ((j + 1) / 64) * Math.PI * 2;
        rings.push(Math.cos(a) * rr, Math.sin(a) * rr, 0, Math.cos(b) * rr, Math.sin(b) * rr, 0);
      }
    });
    g.add(fatLines(rings, { color: HEX.greenHi, k: 1.4, width: 3.2 }));
    const bull = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), glowMaterial('#ffffff', 2.2));
    g.add(bull);
    g.add(glowSprite(HEX.greenHi, 4, 0.7));
    this.root.add(g);
    // луч от отличника к цели (через дыру в заборе)
    const from = new THREE.Vector3(MT.x + 0.25, MT.y + MT_H + 2.2, MT.z + 0.25);
    const mid = from.clone().lerp(GOAL, 0.5).add(new THREE.Vector3(0, 0.6, 0.8));
    this.beamCurve = new THREE.QuadraticBezierCurve3(from, mid, GOAL.clone());
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uShow: { value: 0 }, uTime: { value: 0 }, uColor: { value: toColor(HEX.greenHi, 1.8) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uOpacity, uShow, uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float x = vUv.x; float vis = 1.0 - smoothstep(uShow - 0.02, uShow, x);
          float dash = 0.6 + 0.4 * sin(x * 60.0 - uTime * 10.0);
          gl_FragColor = vec4(uColor * dash, vis * uOpacity * 0.9); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(new THREE.TubeGeometry(this.beamCurve, 80, 0.05, 8, false), this.beamMat);
    this.root.add(this.beam);
    this.goalHit = shockRing(HEX.greenHi, 2, 4);
    g.add(this.goalHit);
  }

  // ---------- Толпа «ИИ у всех» (шаг 1) ----------
  buildCrowd() {
    // низкополигональный силуэт: людей ~150, каждый — мелкий на экране
    const geo = build([
      { g: new THREE.CapsuleGeometry(0.24, 0.5, 3, 8), p: [0, 1.08, 0] },        // туловище
      { g: new THREE.SphereGeometry(0.2, 10, 7), p: [0, 1.62, 0] },             // голова
      { g: new THREE.CapsuleGeometry(0.085, 0.7, 2, 5), p: [-0.12, 0.45, 0.01], r: [0, 0, -0.03] },   // ноги
      { g: new THREE.CapsuleGeometry(0.085, 0.7, 2, 5), p: [0.12, 0.45, 0.01], r: [0, 0, 0.03] },
      limb([-0.27, 1.3, 0], [-0.33, 0.82, 0.05], 0.07, 5),                     // левая рука — вниз
      limb([0.27, 1.3, 0], [0.46, 1.08, 0.3], 0.07, 5),                        // правая — вперёд, держит «ИИ»
    ]);
    const N = PEOPLE.length;
    const delay = new Float32Array(N);
    // задержки нормированы: при uPop = 1 выросли все, даже самые дальние (1.5 − 1.0 = 0.5 — полный рост)
    const maxD = PEOPLE.reduce((a, p) => Math.max(a, p.delay), 0.001);
    PEOPLE.forEach((p, i) => { delay[i] = p.delay / maxD; });
    geo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay, 1));
    const mat = holoMaterial({
      color: '#bfe8bf', rim: HEX.greenHi, base: '#020602', fill: 0.85, rimK: 1.1,
      vertexHead: POP_HEAD, vertexPre: `${POP_K}\n  p.xyz *= max(pk, 0.0001);`,
      uniforms: this.crowdU,
    });
    this.crowd = new THREE.InstancedMesh(geo, mat, N);
    this.crowd.position.copy(MT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    PEOPLE.forEach((d, i) => {
      q.setFromEuler(e.set(0, d.ry, 0));
      m4.compose(p.set(d.x, 0, d.z), q, sc.setScalar(d.s));
      this.crowd.setMatrixAt(i, m4);
    });
    this.crowd.frustumCulled = false;
    this.root.add(this.crowd);
    this.crowdH = this.fader.add(this.crowd, 0);
  }

  // ---------- Замки «у всех» (шаг 1): появление и открывание — в шейдере ----------
  buildLocks() {
    const delay = new Float32Array(LOCKS);
    // нормировано: при uOpen = 1 открыты все замки (1.6 − 1.2 = 0.4 — дужка откинута полностью)
    const maxD = LOCK_DATA.reduce((a, d) => Math.max(a, d.delay), 0.001);
    LOCK_DATA.forEach((d, i) => { delay[i] = (d.delay / maxD) * 1.2; });
    const bodyGeo = new RoundedBoxGeometry(0.62, 0.52, 0.24, 2, 0.07);
    bodyGeo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay, 1));
    const sh = new THREE.CurvePath();
    sh.add(new THREE.LineCurve3(new THREE.Vector3(-0.19, 0, 0), new THREE.Vector3(-0.19, 0.22, 0)));
    sh.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.19, 0.22, 0), new THREE.Vector3(0, 0.52, 0), new THREE.Vector3(0.19, 0.22, 0)));
    sh.add(new THREE.LineCurve3(new THREE.Vector3(0.19, 0.22, 0), new THREE.Vector3(0.19, 0, 0)));
    const shGeo = new THREE.TubeGeometry(sh, 24, 0.05, 8, false);
    shGeo.translate(-0.19, 0, 0);   // ось вращения — у правой ножки
    shGeo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay.slice(), 1));
    const POP_ONLY = `
  float pk = clamp(uPop, 0.0, 1.0);
  pk = pk * pk * (3.0 - 2.0 * pk);`;
    const common = { color: HEX.red, rim: '#ffb3ad', base: '#0a0202', fill: 1.0, rimK: 1.1, vertexHead: POP_HEAD, uniforms: this.lockU };
    const bodyMat = holoMaterial({ ...common, vertexPre: `${POP_ONLY}\n  p.xyz *= max(pk, 0.0001);` });
    const shMat = holoMaterial({
      ...common,
      vertexPre: `${POP_ONLY}
  float ok = clamp((uOpen * 1.6 - aDelay) / 0.4, 0.0, 1.0);
  float ang = ok * 1.8;
  float ca = cos(ang), sa = sin(ang);
  p.xz = vec2(ca * p.x + sa * p.z, -sa * p.x + ca * p.z);
  n.xz = vec2(ca * n.x + sa * n.z, -sa * n.x + ca * n.z);
  p.xyz += vec3(0.19, 0.22 + ok * 0.22, 0.0);
  p.xyz *= max(pk, 0.0001);`,
    });
    this.lockBody = new THREE.InstancedMesh(bodyGeo, bodyMat, LOCKS);
    this.lockShackle = new THREE.InstancedMesh(shGeo, shMat, LOCKS);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1.3, 1.3, 1.3);
    LOCK_DATA.forEach((d, i) => {
      q.setFromEuler(e.set(0, d.ry, 0));
      m4.compose(p.set(MT.x + d.x, GY + d.y, MT.z + d.z), q, sc);
      this.lockBody.setMatrixAt(i, m4);
      this.lockShackle.setMatrixAt(i, m4);
    });
    this.lockBody.frustumCulled = this.lockShackle.frustumCulled = false;
    this.locksG = new THREE.Group();
    this.locksG.add(this.lockBody, this.lockShackle);
    this.root.add(this.locksG);
    this.locksH = this.fader.add(this.locksG, 0);
  }

  makeLabels() {
    if (this.labelsMade) return;
    this.labelsMade = true;
    this.lVil = this.label({ html: lbl('<span class="b5b-struck">Злодей из кино</span>', '', 'is-danger'), position: [VIL.x, GY - 0.35, VIL.z + 0.6], anchor: 'top', visible: false, className: 'b5b-pop' });
    this.lStudent = this.label({ html: lbl('Отличник', 'сдаст тест любой ценой', 'is-accent'), position: [MT.x - 0.4, MT.y + MT_H + 3.25, MT.z], anchor: 'bottom', visible: false, className: 'b5b-pop' });
    this.lGoal = this.label({ html: lbl('Цель: сдать тест'), position: [GOAL.x, GOAL.y - 1.45, GOAL.z], anchor: 'top', visible: false, className: 'b5b-pop' });
    this.lFence = this.label({ html: lbl('Дырявые заборы', '', 'is-danger'), position: [MT.x - 3.4, GY + 0.1, MT.z + 4.4], anchor: 'top', visible: false, className: 'b5b-pop' });
  }

  // Позы — для 16:9; под 4:3/16:10 их подгоняет ядро.
  camera(state, step) {
    if (step >= 1) return { pos: [0.4, 7.2, 27.5], target: [0.4, -1.6, -2.5], fov: 46 };
    return { pos: [0, 1.9, 19.5], target: [0, 0.75, 0], fov: 44 };
  }
  background(state, step) { return step >= 1 ? 'danger' : 'corners'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    setCell(this.ctx.height * this.ctx.engine.pixelRatio);
    setLineResolution(this.ctx.width, this.ctx.height);
    this.makeLabels();
    this.claimParticles();
    this.applyParticles(true, o.instant);
    // мгновенно (cut) или назад со следующего слайда — сразу итог, без повторного «спектакля»
    const I = !!o.instant || (o.dir ?? 1) < 0;
    const kt = this.kt;
    this.goalHit.visible = false;   // кольцо могло «застыть», если уход прервал анимацию
    // сюжет шага 0: крест на злодее → гора растёт и поднимает отличника → луч к цели
    this.stackU.uGrow.value = I ? 1 : 0;
    kt.to('grow', this.stackU.uGrow, { value: 1, duration: I ? 0 : 3.0, delay: I ? 0 : 0.35, ease: 'power1.inOut' });
    this.st.beam = I ? 1 : 0;
    kt.to('beam', this.st, { beam: 1, duration: I ? 0 : 1.1, delay: I ? 0 : 2.9, ease: 'power2.inOut' });
    if (!I) kt.delay('goalHit', 3.9, () => this.hitGoal()); else kt.kill('goalHit');
    this.lVil.el.querySelector('.b5b-lbl')?.classList.remove('is-struck');
    this.lVil.show();
    kt.kill('cross');
    if (I) {
      kt.kill('slam');
      this.st.cross = 1;
      this.strike(true);
    } else {
      kt.kill('villain');
      this.st.cross = 0;
      this.st.villain = 1;
      kt.delay('slam', 1.3, () => this.slamCross());
    }
    kt.delay('lStudent', I ? 0 : 2.6, () => { if (this.step < 1) this.lStudent.show(); });
    kt.delay('lGoal', I ? 0 : 3.6, () => { if (this.step < 1) { this.lGoal.show(); this.lFence.show(); } });
    this.applyStep(this.step, true);
    return super.enter(o);
  }

  slamCross() {
    this.cross.visible = true;
    this.kt.fromTo('cross', this.st, { cross: 0 }, { cross: 1, duration: 0.42, ease: 'power3.in', onComplete: () => {
      this.ctx.engine.pulse({ aberration: 1.6, flash: 0.05 }, 0.5);
      this.ctx.rig.shake(0.22, 0.45);
      this.strike(false);
    } });
  }

  strike(instant) {
    this.lVil?.el.querySelector('.b5b-lbl')?.classList.add('is-struck');
    this.kt.to('villain', this.st, { villain: 0.25, duration: instant ? 0 : 1.2, delay: instant ? 0 : 0.2 });
  }

  hitGoal() {
    if (!this.goalHit) return;
    this.goalHit.visible = true;
    this.kt.fromTo('goalRing', this.goalHit.material.uniforms.uT, { value: 0 }, { value: 1, duration: 1.1, ease: 'power2.out', onComplete: () => { this.goalHit.visible = false; } });
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyParticles(false, o.instant);
    this.applyStep(step, !!o.instant);
  }

  applyStep(step, instant) {
    const on = step >= 1;
    const d = instant ? 0 : 1;
    const kt = this.kt;
    // люди появляются волной от горы к краям
    kt.to('crowdH', this.crowdH, { show: on ? 1 : 0, duration: (on ? 0.4 : 0.5) * d, delay: on && !instant ? 0.25 : 0 });
    kt.to('pop', this.crowdU.uPop, { value: on ? 1 : 0, duration: (on ? 1.6 : 0.5) * d, delay: on && !instant ? 0.25 : 0, ease: on ? 'power1.out' : 'power2.in' });
    // замки: всплывают, затем открываются волной
    kt.to('locksH', this.locksH, { show: on ? 1 : 0, duration: 0.6 * d, delay: on && !instant ? 0.7 : 0 });
    kt.to('lockPop', this.lockU.uPop, { value: on ? 1 : 0, duration: (on ? 0.8 : 0.4) * d, delay: on && !instant ? 0.7 : 0, ease: on ? 'back.out(1.8)' : 'power2.in' });
    if (on) kt.fromTo('locks', this.lockU.uOpen, { value: instant ? 1 : 0 }, { value: 1, duration: instant ? 0 : 2.6, delay: instant ? 0 : 1.7, ease: 'power1.in' });
    else kt.to('locks', this.lockU.uOpen, { value: 0, duration: 0.4 * d });
    if (on && !instant) kt.delay('lockFx', 2.1, () => this.ctx.engine.pulse({ glitch: 0.35, aberration: 1.2 }, 0.6));
    else kt.kill('lockFx');
    // в общем плане подписи горы уходят
    if (on) {
      kt.kill('lStudent'); kt.kill('lGoal');
      this.lFence?.hide(); this.lGoal?.hide(); this.lStudent?.hide();
    } else if (!instant) {
      // назад с общего плана — подписи возвращаются, когда гора уже стоит
      if (this.st.beam > 0.5) { this.lFence?.show(); this.lGoal?.show(); }
      if (this.stackU.uGrow.value > 0.9) this.lStudent?.show();
    }
  }

  applyParticles(force, instant) {
    if (!this.ownsParticles()) return;
    const crowd = this.step >= 1;
    if (!force && crowd === this._crowd) return;
    this._crowd = crowd;
    const p = this.particles;
    p.setParams({ noise: crowd ? 0.04 : 0.14, swirl: crowd ? 0 : 0.6, size: crowd ? 0.062 : 0.055, twinkle: 0.4, spring: 15, damping: 5.4 }, instant ? 0 : 1.2);
    p.morph(crowd ? crowdShape(p.count) : vortexShape(p.count), { duration: instant ? 0.01 : 2.4, stagger: 0.55, burst: crowd ? 8 : 12, equalizeOpts: { axis: 'z' } });
    this.tw(p.object.position, { x: MT.x, y: GY, z: MT.z, duration: instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: instant ? 0 : 1.6 });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: instant ? 0 : 1.6 });
  }

  exit(o = {}) {
    // отложенные показы подписей не должны сработать во время ухода
    this.killTweens();
    this.lVil?.hide(); this.lStudent?.hide(); this.lGoal?.hide(); this.lFence?.hide();
    return super.exit(o);
  }

  resize(w, h, dpr) {
    setCell(h * dpr);
    setLineResolution(w, h);
  }

  update(dt, t) {
    const st = this.st;
    this.fader.apply(this.opacity);
    const op = this.opacity;
    // злодей: угрожающе покачивается, глаза мигают; после креста — гаснет
    const v = st.villain;
    this.villain.rotation.z = Math.sin(t * 1.3) * 0.03 * v;
    this.villain.position.y = VIL.y - (1 - v) * 0.25;
    const flick = Math.sin(t * 9) > -0.6 ? 1 : 0.4;
    this.eyeGlow.forEach((s) => { s.material.opacity = v * flick * op; });
    this.vilMat.uniforms.uShow.value = 0.35 + 0.65 * v;
    this.vilMat.uniforms.uColor.value.setRGB(0.55 + 0.45 * v, 0.55 - 0.2 * v, 0.55 - 0.24 * v);
    this.eyeMat.opacity = (0.25 + 0.75 * v) * op;
    this.bulb.visible = v > 0.3 && Math.sin(t * 4) > 0;
    this.vilCore.material.opacity = (0.25 + 0.45 * v) * op;
    // крест: «влетает» из-за камеры
    const c = st.cross;
    this.cross.visible = c > 0.001;
    this.cross.scale.setScalar(1 + (1 - c) * 2.2);
    this.cross.rotation.z = (1 - c) * 0.6;
    this.crossMat.opacity = Math.min(1, c * 1.2) * op;
    this.crossGlow.material.opacity = c * 0.5 * op * (0.85 + 0.15 * Math.sin(t * 6));
    // гора растёт (в шейдере); отличник едет вверх на центральной стопке
    const g = this.stackU.uGrow.value;
    const top = MT_H * growK(g, TOP_DELAY);
    this.student.position.y = MT.y + top + 0.05 + Math.abs(Math.sin(t * 3.5)) * 0.04;
    // сверху падают новые листы
    for (const f of this.fall) {
      f.t += dt;
      if (f.t < 0) { f.m.visible = false; continue; }
      if (f.t > 1.4) {
        f.t = 0;
        f.seed += 1.618;
        const a = (f.seed * 4.17) % (Math.PI * 2), r = MT_R * 0.45 * ((f.seed * 0.731) % 1);
        f.x = MT.x + Math.cos(a) * r; f.z = MT.z + Math.sin(a) * r; f.spin = ((f.seed * 1.37) % 1 - 0.5) * 6;
      }
      const k = f.t / 1.4;
      f.m.visible = g > 0.85;
      f.m.position.set(f.x, MT.y + top + 0.2 + (1 - k) * 3.4, f.z);
      f.m.rotation.set(Math.sin(f.t * 5) * 0.5, f.spin * f.t, Math.cos(f.t * 4) * 0.4);
    }
    if (this.fall.length) this.fall[0].m.material.opacity = op;
    // отличник усердно пишет
    this.arm.rotation.x = Math.sin(t * 14) * 0.12;
    this.arm.rotation.z = Math.sin(t * 7) * 0.08;
    // луч к цели
    this.beamMat.uniforms.uShow.value = st.beam;
    this.beamMat.uniforms.uTime.value = t;
    this.goal.rotation.z = t * 0.6;
    this.gapGlows.forEach((s, i) => { s.material.opacity = (0.55 + 0.45 * Math.sin(t * 3 + i * 2)) * op; });
  }
}
