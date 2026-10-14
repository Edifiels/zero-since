// Интерактив №11 «Поднимите руки»: зал из голографических силуэтов, руки поднимаются волной,
// над поднятыми ладонями — огоньки из частиц. Шаг 1 — «а кто смог объяснить сам?»: рук заметно меньше,
// оставшиеся светятся зелёным.
//
// Руки анимируются целиком на GPU: у каждого зрителя — статичные атрибуты (плечо, сторона, фаза)
// и «расписание» подъёма (откуда, куда, когда, сколько), которое переписывается только при смене шага.
// Так не нужно каждый кадр перегружать буферы экземпляров.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { B7Visual, S, C, Pts, holoMaterial, rng, lerp, clamp, tick, equalizeAsync } from './common.js';

const ROWS = 5;
const ARM = 1.05;          // длина руки (от плеча до запястья)
const UP_ANGLE = 0.16;     // наклон поднятой руки наружу
const GLOW_T = 1.0;        // время разгорания подсветки, с

const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/** Значение подъёма руки в момент now (то же, что считает вершинный шейдер). */
function raiseAt(p, now) {
  const k = clamp((now - p.start) / Math.max(1e-3, p.dur));
  const e = p.to > p.from ? clamp(easeOutBack(k), 0, 1.12) : k * k;
  return clamp(lerp(p.from, p.to, e), 0, 1.12);
}
function glowAt(p, now) {
  const k = clamp((now - p.gStart) / GLOW_T);
  return lerp(p.gFrom, p.gTo, k * k * (3 - 2 * k));
}

const LIMB_VERT = /* glsl */ `
attribute vec4 aP;   // плечо x, y, z, масштаб
attribute vec4 aM;   // сторона (±1), фаза покачивания
attribute vec4 aA;   // подъём: откуда, куда, старт, длительность
attribute vec4 aG;   // подсветка: откуда, куда, старт
uniform float uNow, uTime, uUp, uArm, uHand, uGlowT;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWP;
varying vec3 vTint;
float easeOutBack(float x) { float y = x - 1.0; return 1.0 + 2.5 * y * y * y + 1.5 * y * y; }
void main() {
  float k = clamp((uNow - aA.z) / max(aA.w, 1e-3), 0.0, 1.0);
  float e = aA.y > aA.x ? clamp(easeOutBack(k), 0.0, 1.12) : k * k;
  float raise = clamp(mix(aA.x, aA.y, e), 0.0, 1.12);
  float r1 = min(raise, 1.0);
  float vis = clamp(raise / 0.3, 0.0, 1.0);
  float wob = sin(uTime * 2.2 + aM.y) * 0.1 * r1;
  float a = -aM.x * mix(1.9, uUp, r1) + wob;
  float s = aP.w * max(0.0001, vis);
  float ang = a + wob * 0.8 * uHand;
  float c = cos(ang), sn = sin(ang);
  mat2 R = mat2(c, sn, -sn, c);
  vec3 lp = position * s;
  vec2 base = aP.xy;
  if (uHand > 0.5) base += vec2(-sin(a), cos(a)) * (uArm - 0.02) * s;
  vec3 pos = vec3(base + R * lp.xy, aP.z + 0.05 + lp.z);
  vec3 n = vec3(R * normal.xy, normal.z);
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWP = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vN = normalize(mat3(viewMatrix) * (mat3(modelMatrix) * n));
  vV = normalize(-mv.xyz);
  float gk = clamp((uNow - aG.z) / uGlowT, 0.0, 1.0);
  float g = mix(aG.x, aG.y, gk * gk * (3.0 - 2.0 * gk));
  float kk = 0.55 + 0.75 * r1;
  vTint = vec3(kk * (1.0 - g * 0.55), kk + g * 0.6, kk * (1.0 - g * 0.6)) * (uHand > 0.5 ? 1.0 : 0.85);
  gl_Position = projectionMatrix * mv;
}
`;

function personGeometry() {
  const head = new THREE.SphereGeometry(0.34, 16, 12);
  head.translate(0, 1.0, 0);
  const neck = new THREE.CylinderGeometry(0.13, 0.16, 0.3, 10, 1, true);
  neck.translate(0, 0.66, 0);
  // торс-бюст: шея → покатые плечи → грудь → пояс (профиль вращения, сплюснут спереди назад) —
  // силуэт читается как человек в зале, а не как «снеговик» из двух шаров
  const prof = [[0.001, 0.6], [0.16, 0.58], [0.4, 0.5], [0.57, 0.36], [0.64, 0.14], [0.62, -0.25], [0.56, -0.66], [0.001, -0.7]];
  const torso = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  torso.scale(1, 1, 0.55);
  return mergeGeometries([head, neck, torso]);
}
function armGeometry() {
  const g = new THREE.CapsuleGeometry(0.1, ARM - 0.2, 3, 8);
  g.translate(0, (ARM - 0.2) / 2 + 0.1, 0);
  return g;
}
function handGeometry() {
  const parts = [];
  const palm = new RoundedBoxGeometry(0.34, 0.36, 0.1, 2, 0.05);
  palm.translate(0, 0.2, 0);
  parts.push(palm);
  const fx = [-0.12, -0.04, 0.04, 0.12], fl = [0.18, 0.23, 0.22, 0.17];
  fx.forEach((x, i) => {
    const f = new THREE.CapsuleGeometry(0.038, fl[i], 2, 6);
    f.translate(x, 0.38 + fl[i] / 2 + 0.03, 0);
    parts.push(f);
  });
  const th = new THREE.CapsuleGeometry(0.04, 0.16, 2, 6);
  th.rotateZ(0.9);
  th.translate(0.2, 0.2, 0);
  parts.push(th);
  // все части должны иметь одинаковый набор атрибутов
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Геометрия с экземплярами: базовая форма + общие для рук и кистей атрибуты зрителей. */
function instanced(base, attrs, count) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  for (const [name, attr] of Object.entries(attrs)) g.setAttribute(name, attr);
  g.instanceCount = count;
  return g;
}

export default class Hands extends B7Visual {
  static transition = 'iris';

  async init() {
    const r = rng(11);
    // Зал: ряды амфитеатром
    this.people = [];
    for (let row = 0; row < ROWS; row++) {
      const z = 1.5 - row * 2.0;
      const y = -3.45 + row * 0.6;
      const half = 7.8 + row * 1.25;
      const step = 1.48;
      const off = row % 2 ? step / 2 : 0;
      for (let x = -half + off; x <= half; x += step) {
        const jx = x + r.range(-0.18, 0.18);
        const s = r.range(0.9, 1.08);
        const side = r() < 0.5 ? -1 : 1;
        this.people.push({ x: jx, y, z: z + r.range(-0.15, 0.15), s, side, row, phase: r() * 6.28, from: 0, to: 0, start: -10, dur: 0.8, gFrom: 0, gTo: 0, gStart: -10 });
      }
    }
    const N = this.people.length;
    // кто поднимает руку на шаге 0 и кто держит её на шаге 1 (примерно треть)
    this.people.forEach((p) => { p.a = r() < 0.86; p.b = p.a && r() < 0.32; });

    // Тела — статичные экземпляры
    this.bodyMat = holoMaterial({ color: '#000000', rim: '#9dff90', rimK: 1.0, fill: 0, dots: 0, scan: 0, solid: 1, sharp: 1, additive: false, depthWrite: true });
    this.bodies = new THREE.InstancedMesh(personGeometry(), this.bodyMat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    this.people.forEach((p, i) => {
      m4.compose(pos.set(p.x, p.y, p.z), q, sc.setScalar(p.s));
      this.bodies.setMatrixAt(i, m4);
      this.bodies.setColorAt(i, col.setScalar(lerp(1, 0.6, p.row / (ROWS - 1))));
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.bodies.renderOrder = 1;
    this.bodies.frustumCulled = false;

    // Руки и кисти — анимация в вершинном шейдере
    const aP = new Float32Array(N * 4), aM = new Float32Array(N * 4);
    this.people.forEach((p, i) => {
      aP.set([p.x + p.side * 0.42 * p.s, p.y + 0.42 * p.s, p.z, p.s], i * 4);
      aM.set([p.side, p.phase, 0, 0], i * 4);
    });
    this.attrA = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.attrG = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    const shared = {
      aP: new THREE.InstancedBufferAttribute(aP, 4),
      aM: new THREE.InstancedBufferAttribute(aM, 4),
      aA: this.attrA,
      aG: this.attrG,
    };
    const limbUniforms = (hand) => ({
      uNow: { value: 0 }, uUp: { value: UP_ANGLE }, uArm: { value: ARM }, uHand: { value: hand }, uGlowT: { value: GLOW_T },
    });
    this.limbMat = holoMaterial({ color: '#000000', rim: '#b8ffae', rimK: 1.1, fill: 0, dots: 0, scan: 0, solid: 1, sharp: 1, additive: false, depthWrite: true, vertexShader: LIMB_VERT, uniforms: limbUniforms(0) });
    this.handMat = holoMaterial({ color: '#f2fff0', rim: '#00ff00', rimK: 0.9, fill: 1, dots: 0.3, scan: 0, solid: 1, additive: false, depthWrite: true, vertexShader: LIMB_VERT, uniforms: limbUniforms(1) });
    this.arms = new THREE.Mesh(instanced(armGeometry(), shared, N), this.limbMat);
    this.hands = new THREE.Mesh(instanced(handGeometry(), shared, N), this.handMat);
    this.arms.renderOrder = 2; this.hands.renderOrder = 3;
    this.arms.frustumCulled = false; this.hands.frustumCulled = false;

    this.crowd = new THREE.Group();
    this.crowd.add(this.bodies, this.arms, this.hands);
    this.root.add(this.crowd);
    this.mats = [this.bodyMat, this.limbMat, this.handMat];

    // Формы частиц: огоньки над поднятыми ладонями + лёгкая пыль в зале
    const n = this.ctx.particles.count;
    await tick();
    this.shapeA = await equalizeAsync(this.lightsShape(n, (p) => p.a, 1));
    this.shapeB = await equalizeAsync(this.lightsShape(n, (p) => p.b, 2));
    this._t = 0;
  }

  handTop(p) {
    const sx = p.x + p.side * 0.42 * p.s, sy = p.y + 0.42 * p.s;
    const a = -p.side * UP_ANGLE;
    const L = (ARM + 0.55) * p.s;
    return [sx - Math.sin(a) * L, sy + Math.cos(a) * L, p.z + 0.05];
  }

  lightsShape(n, pick, seed) {
    const sel = this.people.filter(pick);
    const tops = sel.map((p) => this.handTop(p));
    const b = new Pts(n, 40 + seed);
    b.add(0.4, (r) => {
      const t = tops[Math.floor(r() * tops.length)];
      return [t[0] + r.gauss(0, 0.11), t[1] + 0.02 + r.gauss(0, 0.14), t[2] + r.gauss(0, 0.11), r.range(0.45, 0.9), r() < 0.55 ? C.greenHi : C.bright, r.range(0.3, 0.75)];
    });
    b.add(0.08, (r) => {
      const t = tops[Math.floor(r() * tops.length)];
      const k = r();
      return [t[0] + r.gauss(0, 0.04), t[1] + 0.3 + k * 1.2, t[2] + r.gauss(0, 0.04), r.range(0.4, 0.8) * (1 - k * 0.6), C.mint, r.range(0.1, 0.3) * (1 - k)];
    });
    b.add(0.52, (r) => {
      const [x, y, z] = r.inSphere(1);
      return [x * 14, 2.6 + y * 3.4, -5 + z * 7, r.range(0.4, 0.8), r() < 0.8 ? C.white : C.mint, r.range(0.02, 0.09)];
    });
    return b.done();
  }

  basePose(state, step) {
    return step >= 1
      ? { pos: [0, 1.3, 13.2], target: [0, -0.62, -4], fov: 45 }
      : { pos: [0, 1.6, 13.9], target: [0, -0.42, -4], fov: 45 };
  }

  background(state, step) { return 'bottom'; }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.3, size: 0.056, twinkle: 0.55, spring: 14, damping: 5 }, o.instant ? 0 : 1);
    this.tw(p.object.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.4, overwrite: 'auto' });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.4, overwrite: 'auto' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.4, overwrite: 'auto' });
    // зал — с опущенными руками, затем волна
    this._t = 0;
    this.people.forEach((pp) => { pp.from = 0; pp.to = 0; pp.start = -10; pp.gFrom = 0; pp.gTo = 0; pp.gStart = -10; });
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  applyStep(step, o = {}) {
    const now = this._t;
    const base = o.enter ? 0.9 : 0.15;
    const A = this.attrA.array, G = this.attrG.array;
    this.people.forEach((p, i) => {
      const want = step >= 1 ? (p.b ? 1 : 0) : (p.a ? 1 : 0);
      if (o.instant) { p.from = want; p.to = want; p.start = now - 10; }
      else if (want !== p.to) {
        const wave = (p.x + 12) / 24;
        p.from = raiseAt(p, now);
        p.to = want;
        p.start = now + base + (want ? wave * 1.3 : (1 - wave) * 0.9) + Math.random() * 0.25;
        p.dur = want ? 0.75 : 0.6;
      }
      const gWant = step >= 1 && p.b ? 1 : 0;
      if (o.instant) { p.gFrom = gWant; p.gTo = gWant; p.gStart = now - 10; }
      else if (gWant !== p.gTo) { p.gFrom = glowAt(p, now); p.gTo = gWant; p.gStart = now + (gWant ? 0.6 : 0); }
      A[i * 4] = p.from; A[i * 4 + 1] = p.to; A[i * 4 + 2] = p.start; A[i * 4 + 3] = p.dur;
      G[i * 4] = p.gFrom; G[i * 4 + 1] = p.gTo; G[i * 4 + 2] = p.gStart;
    });
    this.attrA.needsUpdate = true;
    this.attrG.needsUpdate = true;
    if (this.ownsParticles()) {
      this.particles.morph(step >= 1 ? this.shapeB : this.shapeA, { duration: o.instant ? 0.01 : 2.2, stagger: 0.65, burst: 8, delay: o.instant ? 0 : o.enter ? 0.8 : 0.3 });
    }
    if (!o.instant && !o.enter) this.ctx.engine.pulse({ aberration: 0.45 }, 0.8);
  }

  update(dt, t) {
    this._t += dt;
    this.limbMat.uniforms.uNow.value = this._t;
    this.handMat.uniforms.uNow.value = this._t;
    this.tickMaterials(t, this.mats);
  }
}
