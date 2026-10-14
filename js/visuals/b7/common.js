// Общие помощники визуализаций блока 7: построитель форм для облака частиц,
// собственные облака точек, «толстые» линии с бегущими импульсами, голографический материал,
// шар «ИИ», базовый класс с аккуратным управлением подписями.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Visual } from '../../core/visual.js';
import { PARTICLE_DEFAULTS } from '../../core/particles.js';
import * as S from '../../core/shapes.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { HASH, HALFTONE } from '../../core/glsl.js';
import { rng, lerp, clamp, TAU } from '../../core/utils.js';

export { S, rng, lerp, clamp, TAU };
export const PAL = S.PAL;
export const C = {
  white: PAL.white,
  bright: PAL.bright,
  green: PAL.green,
  greenHi: PAL.greenHi,
  mint: PAL.mint,
  pale: PAL.pale,
  warm: PAL.warm,
  grey: PAL.grey,
  dim: PAL.dim,
  orange: PAL.orange,
  soft: S.color('#cfe9cb'),
  ash: S.color('#6f7a6f'),
};

// ---------------------------------------------------------------------------
// Построитель формы: части добавляются долями, остаток заполняется повтором точек.
// gen(r) => [x, y, z, size, color, alpha] или null (отказ — повторить)
// ---------------------------------------------------------------------------
export class Pts {
  constructor(count, seed = 1) {
    this.count = count;
    this.s = S.createShape(count);
    this.r = rng(seed);
    this.i = 0;
  }
  add(frac, gen) {
    const n = Math.round(this.count * frac);
    const r = this.r;
    for (let k = 0; k < n && this.i < this.count; k++) {
      let p = null;
      for (let tries = 0; tries < 40 && !p; tries++) p = gen(r, k, n);
      if (!p) continue;
      S.setPoint(this.s, this.i++, p[0], p[1], p[2], p[3] ?? 1, p[4] ?? PAL.white, p[5] ?? 1);
    }
    return this;
  }
  done() {
    const r = this.r, P = this.s.positions, Cc = this.s.colors;
    const filled = this.i;
    if (!filled) return S.hidden(this.count);
    for (; this.i < this.count; this.i++) {
      const k = Math.floor(r() * filled) * 4, j = this.i * 4;
      P[j] = P[k] + r.gauss(0, 0.01); P[j + 1] = P[k + 1] + r.gauss(0, 0.01); P[j + 2] = P[k + 2] + r.gauss(0, 0.01); P[j + 3] = P[k + 3];
      Cc[j] = Cc[k]; Cc[j + 1] = Cc[k + 1]; Cc[j + 2] = Cc[k + 2]; Cc[j + 3] = Cc[k + 3];
    }
    return this.s;
  }
}

// ---------- Примитивы выборки (2D-точки [x, y]) ----------
/** Точка на контуре скруглённого прямоугольника. */
export function rrEdge(r, cx, cy, w, h, rad) {
  rad = Math.min(rad, w / 2, h / 2);
  const sx = w - 2 * rad, sy = h - 2 * rad, arc = (Math.PI / 2) * rad;
  const total = 2 * sx + 2 * sy + 4 * arc;
  let t = r() * total;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  if (t < sx) return [x0 + rad + t, y0];
  t -= sx;
  if (t < sx) return [x0 + rad + t, y0 + h];
  t -= sx;
  if (t < sy) return [x0, y0 + rad + t];
  t -= sy;
  if (t < sy) return [x0 + w, y0 + rad + t];
  t -= sy;
  const q = Math.floor(t / arc), a = ((t - q * arc) / arc) * (Math.PI / 2);
  const corners = [[x0 + rad, y0 + rad, Math.PI], [x0 + w - rad, y0 + rad, 1.5 * Math.PI], [x0 + w - rad, y0 + h - rad, 0], [x0 + rad, y0 + h - rad, 0.5 * Math.PI]];
  const [ccx, ccy, a0] = corners[Math.min(3, q)];
  return [ccx + Math.cos(a0 + a) * rad, ccy + Math.sin(a0 + a) * rad];
}
/** Точка внутри скруглённого прямоугольника. */
export function rrFill(r, cx, cy, w, h, rad) {
  rad = Math.min(rad, w / 2, h / 2);
  for (let k = 0; k < 30; k++) {
    const x = (r() - 0.5) * w, y = (r() - 0.5) * h;
    const dx = Math.max(0, Math.abs(x) - (w / 2 - rad)), dy = Math.max(0, Math.abs(y) - (h / 2 - rad));
    if (dx * dx + dy * dy <= rad * rad) return [cx + x, cy + y];
  }
  return [cx, cy];
}
/** Точка на окружности / в круге. */
export function circEdge(r, cx, cy, rad) { const a = r() * TAU; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; }
export function discFill(r, cx, cy, rad) { const a = r() * TAU, d = Math.sqrt(r()) * rad; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; }
/** Точка на отрезке (2D или 3D). */
export function seg(r, a, b) { const t = r(); return a.map((v, i) => lerp(v, b[i], t)); }

/**
 * «Строки текста»: заранее раскладывает слова по строкам и выбирает точку внутри случайного слова.
 * Возвращает функцию (r) => [x, y].
 */
export function textBlock({ x0, x1, yTop, rows, rowH, seed = 1, minW = 0.18, maxW = 0.75, gap = 0.12, lastShort = true, thick = 0.035 }) {
  const rr = rng(seed);
  const words = [];
  for (let k = 0; k < rows; k++) {
    const y = yTop - k * rowH;
    let x = x0;
    const end = lastShort && k === rows - 1 ? lerp(x0, x1, 0.55) : x1;
    while (x < end - minW) {
      const w = Math.min(rr.range(minW, maxW), end - x);
      words.push([x, x + w, y]);
      x += w + gap;
    }
  }
  const lens = words.map((w) => w[1] - w[0]);
  const total = lens.reduce((a, b) => a + b, 0);
  return (r) => {
    let t = r() * total, i = 0;
    while (i < words.length - 1 && t > lens[i]) { t -= lens[i]; i++; }
    const w = words[i];
    return [w[0] + t, w[2] + r.gauss(0, thick)];
  };
}

/** Повернуть/сдвинуть форму (обёртка над S.transform). */
export function place(shape, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  return S.transform(shape, { position, rotation, scale });
}

/** Перекрасить (с сохранением альфы), k — множитель яркости, alphaK — множитель альфы. */
export function tint(shape, fn) {
  const Cc = shape.colors, P = shape.positions;
  for (let i = 0; i < shape.count; i++) {
    const j = i * 4;
    const out = fn([Cc[j], Cc[j + 1], Cc[j + 2]], Cc[j + 3], i, [P[j], P[j + 1], P[j + 2]]);
    if (!out) continue;
    Cc[j] = out[0]; Cc[j + 1] = out[1]; Cc[j + 2] = out[2];
    if (out[3] != null) Cc[j + 3] = out[3];
  }
  return shape;
}

/**
 * Убрать ствол у S.brain (в профиль он превращает мозг в «гриб»): точки ниже порога
 * переносятся на случайные точки коры. scale — тот же, что у S.brain.
 */
export function noStem(s, scale) {
  const P = s.positions, Cc = s.colors, lim = -0.34 * scale;
  const r = rng(31);
  for (let i = 0; i < s.count; i++) {
    const j = i * 4;
    if (P[j + 1] >= lim) continue;
    let k = 0;
    for (let tries = 0; tries < 30; tries++) { k = Math.floor(r() * s.count) * 4; if (P[k + 1] >= lim) break; }
    for (let c = 0; c < 4; c++) { P[j + c] = P[k + c] + (c < 3 ? r.gauss(0, 0.015) : 0); Cc[j + c] = Cc[k + c]; }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Асинхронные построители форм: тяжёлая работа дробится на куски с уступкой кадра,
// чтобы фоновая предзагрузка визуализаций не вызывала рывков на предыдущих слайдах.
// ---------------------------------------------------------------------------
export const tick = () => new Promise((res) => setTimeout(res, 0));

/** Выравнивание плотности (S.equalize) после уступки кадра. opts — как у S.equalize (target, cell…). */
export async function equalizeAsync(shape, opts = {}) {
  const s = await shape;
  await tick();
  S.equalize(s, opts);
  await tick();
  return s;
}

/** Как S.combine, но с уступкой кадра между частями. */
export async function combineAsync(count, parts) {
  const out = S.createShape(count);
  const total = parts.reduce((a, p) => a + (p.weight ?? 1), 0);
  let offset = 0;
  for (let idx = 0; idx < parts.length; idx++) {
    const p = parts[idx];
    const m = idx === parts.length - 1 ? count - offset : Math.floor(count * (p.weight ?? 1) / total);
    if (m <= 0) continue;
    const s = await p.shape(m);
    if (p.position || p.rotation || p.scale) S.transform(s, p);
    out.positions.set(s.positions.subarray(0, m * 4), offset * 4);
    out.colors.set(s.colors.subarray(0, m * 4), offset * 4);
    offset += m;
    await tick();
  }
  return out;
}

/**
 * Мозг из точек — тот же алгоритм, что S.brain() ядра (полушария с извилинами, мозжечок, ствол,
 * внутреннее свечение), но строится кусками с уступкой кадра. Параметры — как у S.brain();
 * stem: false — без ствола (в профиль он превращает мозг в «гриб»), его точки отдаются коре.
 */
export async function brainAsync(count, { scale = 3.6, seed = 9, interior = 0.06, brightness = 1, ridge = PAL.bright, groove = PAL.green, detail = 5.2, chunk = 5000, stem = true } = {}) {
  const s = S.createShape(count), r = rng(seed);
  const noise = new SimplexNoise({ random: r });
  const nStem = stem ? Math.floor(count * 0.04) : 0;
  const nCortex = Math.floor(count * (0.8 - interior)) + (stem ? 0 : Math.floor(count * 0.04));
  const nCereb = Math.floor(count * 0.12);
  const mix = S.mixColor, sc = S.scaleColor;
  let i = 0, work = 0;
  const p = new THREE.Vector3();
  while (i < nCortex) {
    if (++work % chunk === 0) await tick();
    const [dx, dy, dz] = r.onSphere(1);
    p.set(dx * 0.7, dy * 0.6, dz * 0.93);
    if (p.y < -0.22) p.y = -0.22 + (p.y + 0.22) * 0.5;
    const tl = Math.exp(-(((p.y + 0.18) / 0.2) ** 2) - (((p.z - 0.12) / 0.38) ** 2));
    p.x *= 1 + 0.12 * tl;
    p.x *= 1 - 0.1 * Math.max(0, p.z - 0.5);
    const sd = Math.sign(p.x || 1);
    p.x = sd * (Math.abs(p.x) * 0.95 + 0.035);
    if (Math.abs(dx) < 0.07 && p.y > -0.1) p.y -= 0.04 * (1 - Math.abs(dx) / 0.07);
    const n = noise.noise3d(p.x * detail, p.y * detail, p.z * detail);
    const n2 = noise.noise3d(p.x * detail * 2.1 + 7, p.y * detail * 2.1, p.z * detail * 2.1);
    const g = 1 - Math.abs(n * 0.8 + n2 * 0.2);
    if (r() > 0.25 + 0.75 * Math.pow(g, 2.2)) continue;
    const disp = 1 + 0.06 * g;
    const c = mix(groove, ridge, Math.pow(g, 3));
    S.setPoint(s, i, p.x * disp * scale, p.y * disp * scale, p.z * disp * scale, 0.55 + g * 0.75, sc(c, brightness), 0.45 + 0.55 * g);
    i++;
  }
  await tick();
  const cc = [0, -0.36, -0.64];
  const nEnd1 = i + nCereb;
  while (i < nEnd1) {
    if (++work % chunk === 0) await tick();
    const [dx, dy, dz] = r.onSphere(1);
    const q = [dx * 0.44, dy * 0.22, dz * 0.3];
    const fol = 0.5 + 0.5 * Math.sin((q[1] + 0.03 * Math.sin(q[0] * 9)) * 85);
    if (r() > 0.3 + 0.7 * fol) continue;
    const k = 1 + 0.04 * fol;
    S.setPoint(s, i, (cc[0] + q[0] * k) * scale, (cc[1] + q[1] * k) * scale, (cc[2] + q[2] * k) * scale, 0.5 + fol * 0.5, sc(mix(groove, ridge, fol * 0.8), brightness), 0.55 + 0.4 * fol);
    i++;
  }
  const nEnd2 = i + nStem;
  for (; i < nEnd2; i++) {
    const t = r();
    const a = r() * TAU;
    const rad = 0.09 * (1 - t * 0.25);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const y = lerp(-0.3, -0.95, t), zz = lerp(-0.28, -0.44, t);
    S.setPoint(s, i, x * scale, y * scale, (zz + z) * scale, 0.6, sc(groove, brightness), 0.7);
  }
  for (; i < count; i++) {
    const [x, y, z] = r.inSphere(1);
    S.setPoint(s, i, x * 0.55 * scale, y * 0.42 * scale, z * 0.8 * scale, r.range(0.4, 0.9), sc(PAL.green, brightness), r.range(0.05, 0.22));
  }
  return s;
}

/** Копия формы. */
export function clone(shape) {
  return { count: shape.count, positions: shape.positions.slice(), colors: shape.colors.slice(), meta: { ...(shape.meta || {}) } };
}

/** Холст для рисования силуэтов. */
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------------------------------------------------------------------------
// Собственное облако точек (тот же вид, что у общего облака)
// ---------------------------------------------------------------------------
const PTS_VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
attribute float aRand;
uniform float uSize, uScale, uOpacity, uFade, uTime, uTwinkle, uJitter, uMaxSize;
varying vec4 vColor;
void main() {
  vec3 p = position;
  if (uJitter > 0.0) {
    float ph = aRand * 63.0;
    p += uJitter * vec3(sin(uTime * 1.3 + ph), sin(uTime * 1.07 + ph * 1.7), sin(uTime * 0.91 + ph * 2.3));
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * 0.6 * sin(uTime * (0.7 + aRand * 2.6) + aRand * 40.0);
  float px = aSize * uSize * uScale / max(0.05, -mv.z);
  float a = aColor.a * uOpacity * uFade * tw;
  if (px < 1.2) { a *= px / 1.2; px = 1.2; }
  gl_PointSize = min(px, uMaxSize);
  vColor = vec4(aColor.rgb, a);
  if (a < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const PTS_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 5.5);
  float a = (core + (1.0 - d) * 0.25) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

/** THREE.Points из формы (shape из shapes.js). */
export function localPoints(shape, { size = 0.062, opacity = 1, twinkle = 0.25, jitter = 0, seed = 3 } = {}) {
  const n = shape.count;
  const pos = new Float32Array(n * 3), sz = new Float32Array(n), col = new Float32Array(n * 4), rnd = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = shape.positions[i * 4]; pos[i * 3 + 1] = shape.positions[i * 4 + 1]; pos[i * 3 + 2] = shape.positions[i * 4 + 2];
    sz[i] = shape.positions[i * 4 + 3];
    col.set(shape.colors.subarray(i * 4, i * 4 + 4), i * 4);
    rnd[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  g.computeBoundingSphere();
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: size }, uScale: { value: 600 }, uOpacity: { value: opacity }, uFade: { value: 1 },
      uTime: { value: 0 }, uTwinkle: { value: twinkle }, uJitter: { value: jitter }, uMaxSize: { value: 64 },
    },
    vertexShader: PTS_VERT,
    fragmentShader: PTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// ---------------------------------------------------------------------------
// «Толстые» отрезки с бегущими импульсами (ширина — в пикселях экрана)
// segs: [{ a:[x,y,z], b:[x,y,z], phase, speed, bright, pulse, rank }]
// ---------------------------------------------------------------------------
const LINE_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aCorner;
attribute vec4 aParams;
attribute float aRank;
uniform vec2 uRes;
uniform float uWidth;
varying float vT;
varying float vSide;
varying vec4 vParams;
varying float vRank;
void main() {
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  vec2 sa = ca.xy / max(abs(ca.w), 1e-4);
  vec2 sb = cb.xy / max(abs(cb.w), 1e-4);
  vec2 d = (sb - sa) * uRes;
  float l = length(d);
  vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = aCorner.x < 0.5 ? ca : cb;
  c.xy += nrm * aCorner.y * uWidth / uRes * c.w;
  gl_Position = c;
  vT = aCorner.x;
  vSide = aCorner.y;
  vParams = aParams;
  vRank = aRank;
}
`;
const LINE_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uFade, uPulseLen, uCut, uBase, uPulseK;
uniform vec3 uColor, uPulseColor;
varying float vT;
varying float vSide;
varying vec4 vParams;
varying float vRank;
void main() {
  float e = 1.0 - abs(vSide);
  float core = smoothstep(0.0, 0.8, e);
  float head = fract(uTime * vParams.y + vParams.x) * 1.6 - 0.3;
  float dd = (vT - head) / max(uPulseLen, 1e-3);
  float pulse = exp(-dd * dd) * vParams.w * uPulseK;
  float alive = clamp((vRank - uCut) * 20.0 + 1.0, 0.0, 1.0);
  vec3 col = uColor * vParams.z * uBase + uPulseColor * pulse;
  float a = core * (vParams.z * uBase * 0.8 + pulse) * uOpacity * uFade * alive;
  gl_FragColor = vec4(col, a);
}
`;

export function pulseLines(segs, { width = 3, color = '#9dffa0', pulseColor = '#00ff00', colorK = 1, pulseK = 2.2, pulseLen = 0.12, base = 1 } = {}) {
  const n = segs.length;
  const A = new Float32Array(n * 4 * 3), B = new Float32Array(n * 4 * 3), CR = new Float32Array(n * 4 * 2);
  const PR = new Float32Array(n * 4 * 4), RK = new Float32Array(n * 4), POS = new Float32Array(n * 4 * 3);
  const idx = [];
  segs.forEach((s, i) => {
    const corners = [[0, -1], [0, 1], [1, -1], [1, 1]];
    corners.forEach((cc, k) => {
      const v = i * 4 + k;
      A.set(s.a, v * 3); B.set(s.b, v * 3); CR.set(cc, v * 2);
      POS.set(cc[0] < 0.5 ? s.a : s.b, v * 3);
      PR.set([s.phase ?? Math.random(), s.speed ?? 0.5, s.bright ?? 1, s.pulse ?? 1], v * 4);
      RK[v] = s.rank ?? 1;
    });
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(POS, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(B, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(CR, 2));
  g.setAttribute('aParams', new THREE.BufferAttribute(PR, 4));
  g.setAttribute('aRank', new THREE.BufferAttribute(RK, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1600, 900) }, uWidth: { value: width }, uTime: { value: 0 },
      uOpacity: { value: 1 }, uFade: { value: 1 }, uPulseLen: { value: pulseLen }, uCut: { value: 0 },
      uBase: { value: base }, uPulseK: { value: pulseK },
      uColor: { value: new THREE.Color(color).multiplyScalar(colorK) },
      uPulseColor: { value: new THREE.Color(pulseColor) },
    },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.userData.baseWidth = width;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Простой светящийся материал с двумя множителями прозрачности:
// uOpacity — общий (появление/уход визуализации), uFade — свой, пошаговый.
// ---------------------------------------------------------------------------
const GLOW_VERT = /* glsl */ `
varying vec3 vTint;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade;
varying vec3 vTint;
void main() { gl_FragColor = vec4(uColor * vTint, uOpacity * uFade); }
`;
export function glowMat(color = '#ffffff', k = 1, opacity = 1, { additive = true, depthTest = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(k) }, uOpacity: { value: opacity }, uFade: { value: 1 } },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------
// Голографический материал: френель-кромка + фирменный халфтон + бегущая полоса.
// Поддерживает InstancedMesh (instanceMatrix, instanceColor).
// ---------------------------------------------------------------------------
const HOLO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vWP;
varying vec3 vTint;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * lp;
  vWP = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vN = normalize(mat3(viewMatrix) * (mat3(modelMatrix) * n));
  vV = normalize(-mv.xyz);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * mv;
}
`;
const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uOpacity, uFade, uFill, uRimK, uCell, uTime, uScan, uDots, uSolid, uSharp;
uniform vec2 uClipX;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWP;
varying vec3 vTint;
${HALFTONE}
void main() {
  vec3 n = normalize(vN);
  float ndv = clamp(abs(dot(n, normalize(vV))), 0.0, 1.0);
  float f = 1.0 - ndv;
  float f2 = f * f;
  float rim = mix(f2 * (0.6 + 0.4 * f), f2 * f2 * f2, uSharp);
  float light = clamp(0.35 + 0.65 * dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0, 1.0);
  float dots = halftoneDot(gl_FragCoord.xy, uCell, clamp(uFill * light + rim * 0.75, 0.0, 1.0)) * uDots;
  float band = fract(vWP.y * 0.22 - uTime * 0.18);
  float scan = uScan * (1.0 - smoothstep(0.0, 0.035, abs(band - 0.5)));
  vec3 col = vTint * (uColor * (uFill * light * 0.45 + dots * 0.55) + uRim * rim * uRimK) + uRim * scan * 0.6;
  float a = clamp(uFill * 0.35 + dots * 0.5 + rim * uRimK * 0.8 + scan * 0.4, 0.0, 1.0);
  a = mix(a, 1.0, uSolid);
  // растворение по мировой X (uClipX.x < uClipX.y — включено): к uClipX.y объект исчезает
  if (uClipX.x < uClipX.y) a *= 1.0 - smoothstep(uClipX.x, uClipX.y, vWP.x);
  gl_FragColor = vec4(col, a * uOpacity * uFade);
}
`;

/**
 * Голографический материал. vertexShader/uniforms — свой вершинный шейдер (должен выдавать varyings
 * vN, vV, vWP, vTint, как HOLO_VERT) и дополнительные uniform'ы — например, для анимации на GPU.
 */
export function holoMaterial({ color = '#bfffc0', rim = '#00ff00', rimK = 1.4, fill = 0.35, dots = 1, scan = 0.35, solid = 0, sharp = 0, additive = true, depthWrite = false, side = THREE.FrontSide, vertexShader = HOLO_VERT, uniforms = {} } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uColor: { value: new THREE.Color(color) },
      uRim: { value: new THREE.Color(rim).multiplyScalar(1.4) },
      uOpacity: { value: 1 }, uFade: { value: 1 }, uFill: { value: fill }, uRimK: { value: rimK },
      uCell: { value: 7 }, uTime: { value: 0 }, uScan: { value: scan }, uDots: { value: dots }, uSolid: { value: solid }, uSharp: { value: sharp },
      uClipX: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side,
  });
}

// ---------------------------------------------------------------------------
// Свечение-спрайт (радиальный градиент)
// ---------------------------------------------------------------------------
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  // общая для всех сцен блока: dispose() выгружаемой сцены (LRU) её не трогает
  glowTex.userData.shared = true;
  return glowTex;
}
export function glowSprite(color = '#00ff00', k = 1.6, size = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

// ---------------------------------------------------------------------------
// Шар «ИИ»: халфтон-сфера с френель-кромкой, ядро-свечение и орбита.
// ---------------------------------------------------------------------------
const ORB_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uCell, uTime, uPower;
varying vec3 vN;
varying vec3 vV;
${HALFTONE}
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float f = 1.0 - ndv;
  float rim = f * f;
  float v = clamp(0.12 + rim * 0.95 + 0.08 * sin(uTime * 2.0), 0.0, 1.0);
  float dm = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 col = uColor * (dm * 0.85 + rim * 1.5) * uPower + vec3(1.0) * rim * rim * rim * 0.7;
  gl_FragColor = vec4(col, uOpacity * uFade * (0.2 + 0.8 * max(dm, rim)));
}
`;

export function makeOrb({ radius = 0.6, color = '#00ff00' } = {}) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.25) }, uOpacity: { value: 1 }, uFade: { value: 1 }, uCell: { value: 7 }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: ORB_VERT,
    fragmentShader: ORB_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  const core = glowSprite(color, 1.3, radius * 2.6);
  core.material.userData.noFade = true;
  const ringMat = glowMat(color, 1.5, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.55, radius * 0.035, 8, 96), ringMat);
  ring.rotation.set(1.2, 0.3, 0);
  const ring2Mat = glowMat('#ffffff', 0.9, 0.6);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.85, radius * 0.025, 8, 96), ring2Mat);
  ring2.rotation.set(1.6, -0.5, 0.4);
  const spin = new THREE.Group();
  spin.add(ring, ring2);
  group.add(core, sphere, spin);
  const orb = {
    group, sphere, core, ring, ring2, mat,
    mats: [mat, ringMat, ring2Mat],
    fade: 1,
    /** visOpacity — общая прозрачность визуализации (this.opacity). */
    update(t, cellPx, visOpacity = 1) {
      mat.uniforms.uTime.value = t;
      if (cellPx) mat.uniforms.uCell.value = cellPx;
      spin.rotation.y = t * 0.7;
      ring.rotation.z = t * 0.9;
      ring2.rotation.z = -t * 0.6;
      const f = orb.fade;
      for (const m of orb.mats) m.uniforms.uFade.value = f;
      core.material.opacity = (0.75 + 0.25 * Math.sin(t * 3.1)) * f * visOpacity;
      group.visible = f > 0.003;
    },
  };
  return orb;
}

// ---------------------------------------------------------------------------
// Базовый класс визуализаций блока 7
// ---------------------------------------------------------------------------
export class B7Visual extends Visual {
  constructor(ctx, id) {
    super(ctx, id);
    this._labs = [];
    this._v = new THREE.Vector3();
  }

  /** Подпись у 3D-точки (с аккуратным удалением при уходе со слайда). */
  lab(o) {
    const l = this.label(o);
    this._labs.push(l);
    return l;
  }

  dropLabels(fade = true) {
    const old = this._labs;
    this._labs = [];
    if (!fade) { old.forEach((l) => l.remove()); return; }
    // гаснут быстро: текст следующего слайда появляется сразу, подписи не должны на него налезать
    old.forEach((l) => { l.el.style.transitionDuration = '.22s'; l.hide(); });
    setTimeout(() => old.forEach((l) => l.remove()), 400);
  }

  exit(o = {}) {
    this.dropLabels(!o.instant);
    this.drive(null);
    // Оставляем общее облако в нейтральном состоянии: без потока/вращения формы, без наклона.
    // Следующая визуализация, если ей нужно другое, перезапишет это своими твинами (overwrite: 'auto').
    const p = this.particles;
    p.setParams({ flow: [0, 0, 0], swirl: 0 }, o.instant ? 0 : 0.8);
    const obj = p.object;
    if (o.instant) { obj.rotation.set(0, 0, 0); obj.scale.set(1, 1, 1); }
    else {
      gsap.to(obj.rotation, { x: 0, y: 0, z: 0, duration: 1.2, ease: 'power2.inOut', overwrite: 'auto' });
      gsap.to(obj.scale, { x: 1, y: 1, z: 1, duration: 1.2, ease: 'power2.inOut', overwrite: 'auto' });
    }
    // 3D уходит не дольше 0.6 с: подписи/линии сцены не спорят с HTML следующего слайда
    return super.exit(o.instant ? o : { ...o, duration: Math.min(o.duration ?? 0.7, 0.6) });
  }

  /**
   * Поза камеры для шага — basePose() визуализации, заданная для 16:9.
   * Под экраны уже 16:9 (4:3, 16:10) позу подгоняет ядро (director.fitPose), при смене размера окна
   * режиссёр сам заново ставит камеру — здесь ничего не подгоняем.
   */
  camera(state, step) {
    return this.basePose ? this.basePose(state, step) : super.camera(state, step);
  }

  /** Изменение размера окна: только своя раскладка объектов напротив колонок HTML (onResize). */
  resize(w, h, dpr) {
    if (!this.active) return;
    try { this.onResize?.(w, h, dpr); } catch (err) { console.error(err); }
  }

  /**
   * Параметры общего облака для своего слайда: значения по умолчанию ядра + свои.
   * (Если предыдущий слайд — из другой части — что-то поменял, например flow или noiseScale, это сбросится.)
   */
  particleParams(own = {}, duration = 1) {
    this.particles.setParams({ ...PARTICLE_DEFAULTS, flow: [0, 0, 0], ...own }, duration);
  }

  /** Пикселей на единицу мира на расстоянии 1 (для собственных Points). */
  pxScale() {
    const e = this.ctx.engine;
    return (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5));
  }

  /** Шаг фирменного халфтона в пикселях. */
  cellPx() {
    const e = this.ctx.engine;
    return Math.max(5, (e.height * e.pixelRatio) / 150);
  }

  /** Обновить служебные uniform'ы у материалов (время, масштаб точек, разрешение линий). */
  tickMaterials(t, list) {
    const e = this.ctx.engine;
    const sc = this.pxScale(), cell = this.cellPx();
    const W = e.width * e.pixelRatio, H = e.height * e.pixelRatio;
    for (const m of list) {
      const u = m.uniforms;
      if (!u) continue;
      if (u.uTime) u.uTime.value = t;
      if (u.uScale) u.uScale.value = sc;
      if (u.uCell) u.uCell.value = cell;
      if (u.uRes) u.uRes.value.set(W, H);
      if (u.uWidth && m.userData.baseWidth) u.uWidth.value = m.userData.baseWidth * Math.max(0.6, H / 1000);
    }
  }
}
