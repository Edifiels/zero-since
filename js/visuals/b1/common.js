// Общие помощники части b1: порядок частиц, звёздный атлас (небесная сфера, созвездия, Млечный Путь),
// импульсы вдоль связей, свечения и линии.
import * as THREE from 'three';
import * as S from '../../core/shapes.js';
import { rng, TAU, clamp, lerp } from '../../core/utils.js';

export const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Порядок частиц по их задержке в morph().
// В шейдерах core/particles.js у частицы есть «случайное» число rnd.x = hash42(uv * 1000 + 0.5).x;
// при morph() она стартует, когда uMorph > rnd.x * stagger. Повторяя этот хэш на CPU,
// раскладываем форму так, чтобы её части появлялись в нужном порядке
// (след ракеты «рисуется» снизу вверх вслед за ней, след закручивается в галактику от краёв к ядру…).
// ---------------------------------------------------------------------------
const f32 = Math.fround;
const fr = (x) => f32(x - Math.floor(x));
const K1 = f32(0.1031), K2 = f32(0.1030), K3 = f32(0.0973), K33 = f32(33.33);
const K4 = f32(0.1099);
function hashX(u, v) {
  const px = f32(f32(u * 1000) + 0.5), py = f32(f32(v * 1000) + 0.5);
  let a = fr(f32(px * K1));
  let b = fr(f32(py * K2));
  let c = fr(f32(px * K3));
  const d = fr(f32(py * K4));
  // dot(p4, p4.wzxy + 33.33)
  const dt = f32(f32(f32(f32(a * f32(d + K33)) + f32(b * f32(c + K33))) + f32(c * f32(a + K33))) + f32(d * f32(b + K33)));
  a = f32(a + dt); b = f32(b + dt); c = f32(c + dt);
  return fr(f32(f32(a + b) * c));
}

const rankCache = new Map();
/**
 * Ранги частиц облака. { rnd: Float32Array — задержка частицы, order: Uint32Array — индексы частиц
 * по возрастанию задержки, rank: Float32Array — нормированный ранг 0..1 }.
 */
export function particleRanks(count) {
  if (rankCache.has(count)) return rankCache.get(count);
  const side = Math.round(Math.sqrt(count));
  const rnd = new Float32Array(count);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) rnd[y * side + x] = hashX(f32((x + 0.5) / side), f32((y + 0.5) / side));
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => rnd[a] - rnd[b]);
  const rank = new Float32Array(count);
  for (let k = 0; k < count; k++) rank[order[k]] = k / Math.max(1, count - 1);
  const res = { rnd, order, rank, side };
  rankCache.set(count, res);
  return res;
}

/** Временный буфер точек (как форма, но без привязки к частицам). */
export function makeBuf(n) {
  return { n, P: new Float32Array(n * 4), C: new Float32Array(n * 4) };
}
export function putPoint(buf, i, x, y, z, size, c, a) {
  const j = i * 4;
  buf.P[j] = x; buf.P[j + 1] = y; buf.P[j + 2] = z; buf.P[j + 3] = size;
  buf.C[j] = c[0]; buf.C[j + 1] = c[1]; buf.C[j + 2] = c[2]; buf.C[j + 3] = a;
}
/** Скопировать точку k буфера в частицу i формы. */
export function copyPoint(shape, i, buf, k) {
  const a = i * 4, b = k * 4;
  for (let c = 0; c < 4; c++) { shape.positions[a + c] = buf.P[b + c]; shape.colors[a + c] = buf.C[b + c]; }
}
/** Индексы точек буфера, отсортированные по ключу (по возрастанию). */
export function sortIdx(n, keyFn) {
  const keys = new Float32Array(n);
  for (let i = 0; i < n; i++) keys[i] = keyFn(i);
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => keys[a] - keys[b]);
  return idx;
}

// ---------------------------------------------------------------------------
// Звёздный атлас: координаты, сетка небесной сферы, созвездия, Млечный Путь
// ---------------------------------------------------------------------------

// Ориентация неба: широта Байконура; звёздное время и разворот подобраны так, чтобы ядро Млечного Пути
// (Стрелец) стояло низко над горизонтом за ракетой, а полоса поднималась диагональю.
export const SKY = { lat: 45.6 * DEG, lst: 17.6 * 15 * DEG, yaw: Math.PI + 0.12 };

/** Экваториальные координаты (рад) → единичный вектор сцены (Y — зенит, −Z — юг после разворота). */
export function eqToLocal(ra, dec, out = new THREE.Vector3(), sky = SKY) {
  const H = sky.lst - ra;
  const cd = Math.cos(dec), sd = Math.sin(dec), cH = Math.cos(H), sH = Math.sin(H);
  const cp = Math.cos(sky.lat), sp = Math.sin(sky.lat);
  let x = -cd * sH;
  const y = cd * cH * cp + sd * sp;
  let z = cd * cH * sp - sd * cp;
  if (sky.yaw) {
    const c = Math.cos(sky.yaw), s = Math.sin(sky.yaw);
    const xx = c * x + s * z;
    z = -s * x + c * z;
    x = xx;
  }
  return out.set(x, y, z);
}

// Галактические → экваториальные (J2000): eq = Tᵀ · gal
const T = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
export function galToLocal(l, b, out = new THREE.Vector3(), sky = SKY) {
  const cb = Math.cos(b);
  const g0 = cb * Math.cos(l), g1 = cb * Math.sin(l), g2 = Math.sin(b);
  const ex = T[0][0] * g0 + T[1][0] * g1 + T[2][0] * g2;
  const ey = T[0][1] * g0 + T[1][1] * g1 + T[2][1] * g2;
  const ez = T[0][2] * g0 + T[1][2] * g1 + T[2][2] * g2;
  return eqToLocal(Math.atan2(ey, ex), Math.asin(clamp(ez, -1, 1)), out, sky);
}

// Созвездия: звёзды [RA (ч), Dec (°), блеск 0..1] и линии-«фигуры» (индексы звёзд).
export const CONSTELLATIONS = [
  { name: 'Большая Медведица', stars: [[11.06, 61.75, 0.8], [11.03, 56.38, 0.7], [11.9, 53.69, 0.6], [12.26, 57.03, 0.45], [12.9, 55.96, 0.8], [13.4, 54.93, 0.7], [13.79, 49.31, 0.75]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] },
  { name: 'Малая Медведица', stars: [[2.53, 89.26, 0.8], [17.54, 86.59, 0.35], [16.77, 82.04, 0.35], [15.73, 77.79, 0.4], [14.85, 74.16, 0.7], [15.35, 71.83, 0.5], [16.29, 75.76, 0.3]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]] },
  { name: 'Кассиопея', stars: [[0.15, 59.15, 0.65], [0.68, 56.54, 0.7], [0.95, 60.72, 0.7], [1.43, 60.24, 0.6], [1.91, 63.67, 0.5]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'Лебедь', stars: [[20.69, 45.28, 0.9], [20.37, 40.26, 0.65], [19.51, 27.96, 0.55], [20.77, 33.97, 0.6], [19.75, 45.13, 0.5], [21.22, 30.23, 0.4], [19.29, 53.37, 0.35]],
    lines: [[0, 1], [1, 2], [4, 1], [1, 3], [3, 5], [4, 6]] },
  { name: 'Лира', stars: [[18.62, 38.78, 1.0], [18.83, 33.36, 0.45], [18.98, 32.69, 0.5], [18.91, 36.9, 0.35], [18.75, 37.61, 0.35]],
    lines: [[0, 4], [4, 3], [3, 2], [2, 1], [1, 4]] },
  { name: 'Орёл', stars: [[19.85, 8.87, 0.95], [19.77, 10.61, 0.55], [19.92, 6.41, 0.45], [19.1, 13.86, 0.45], [20.19, -0.82, 0.4], [19.42, 3.11, 0.4]],
    lines: [[1, 0], [0, 2], [1, 3], [0, 5], [2, 4]] },
  { name: 'Стрелец', stars: [[18.1, -30.42, 0.55], [18.35, -29.83, 0.6], [18.4, -34.38, 0.8], [18.47, -25.42, 0.6], [18.76, -26.99, 0.5], [18.92, -26.3, 0.75], [19.12, -27.67, 0.5], [19.04, -29.88, 0.65]],
    lines: [[0, 1], [0, 2], [1, 2], [1, 3], [3, 4], [4, 1], [4, 5], [5, 6], [6, 7], [7, 4], [7, 2]] },
  { name: 'Скорпион', stars: [[16.49, -26.43, 1.0], [16.09, -19.81, 0.6], [16.01, -22.62, 0.65], [15.98, -26.11, 0.5], [16.35, -25.59, 0.5], [16.6, -28.22, 0.5], [16.84, -34.29, 0.6], [16.86, -38.05, 0.5], [16.91, -42.36, 0.5], [17.2, -43.24, 0.5], [17.62, -43.0, 0.6], [17.79, -40.13, 0.5], [17.71, -39.03, 0.5], [17.56, -37.1, 0.8]],
    lines: [[1, 2], [2, 3], [2, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]] },
  { name: 'Геркулес', stars: [[16.69, 31.6, 0.5], [16.71, 38.92, 0.5], [17.0, 30.93, 0.45], [17.25, 36.81, 0.45], [16.5, 21.49, 0.6], [17.24, 14.39, 0.55], [17.25, 24.84, 0.5], [17.94, 37.25, 0.4]],
    lines: [[0, 1], [1, 3], [3, 2], [2, 0], [0, 4], [2, 6], [6, 5], [3, 7]] },
  { name: 'Волопас', stars: [[14.26, 19.18, 1.0], [14.75, 27.07, 0.55], [15.03, 40.39, 0.45], [14.53, 38.31, 0.45], [15.26, 33.31, 0.45], [13.91, 18.4, 0.45], [14.69, 13.73, 0.45]],
    lines: [[0, 1], [1, 4], [4, 2], [2, 3], [3, 1], [0, 5], [0, 6]] },
  { name: 'Северная Корона', stars: [[15.58, 26.71, 0.6], [15.46, 29.11, 0.4], [15.55, 31.36, 0.35], [15.71, 26.3, 0.35], [15.83, 26.07, 0.35], [15.96, 26.88, 0.35]],
    lines: [[2, 1], [1, 0], [0, 3], [3, 4], [4, 5]] },
  { name: 'Змееносец', stars: [[17.58, 12.56, 0.7], [17.72, 4.57, 0.55], [16.24, -3.69, 0.55], [16.31, -4.69, 0.5], [17.17, -15.72, 0.6], [16.62, -10.57, 0.55], [17.37, -24.99, 0.45]],
    lines: [[0, 1], [1, 4], [4, 6], [4, 5], [5, 3], [3, 2], [2, 0]] },
];

/** Звёзды и отрезки созвездий в координатах сцены (только над горизонтом). */
export function constellationGeometry(radius, sky = SKY) {
  const stars = [];
  const segs = [];
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  CONSTELLATIONS.forEach((c) => {
    const pts = c.stars.map(([ra, dec, m]) => {
      eqToLocal(ra * 15 * DEG, dec * DEG, v, sky);
      return { p: v.clone(), m };
    });
    pts.forEach((s) => { if (s.p.y > -0.02) stars.push({ p: s.p.clone().multiplyScalar(radius), m: s.m }); });
    c.lines.forEach(([a, b]) => {
      const A = pts[a].p, B = pts[b].p;
      if (A.y < 0 || B.y < 0) return;
      // дуга большого круга, отступая от звёзд
      const n = 10;
      for (let k = 0; k < n; k++) {
        const t0 = 0.08 + (k / n) * 0.84, t1 = 0.08 + ((k + 1) / n) * 0.84;
        v.copy(A).lerp(B, t0).normalize().multiplyScalar(radius);
        w.copy(A).lerp(B, t1).normalize().multiplyScalar(radius);
        segs.push(v.x, v.y, v.z, w.x, w.y, w.z);
      }
    });
  });
  return { stars, segs: new Float32Array(segs) };
}

/**
 * Сетка небесной сферы «как в старинном атласе»: круги склонения, часовые круги, эклиптика с делениями,
 * горизонт. Возвращает { positions, alphas, ts } для LineSegments (alpha гаснет под горизонтом).
 */
export function celestialGrid(radius, sky = SKY) {
  const pos = [], al = [], ts = [];
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const fadeY = (y) => clamp((y + 0.02) / 0.1, 0, 1);
  const seg = (a, b, alpha, t = 0) => {
    const fa = fadeY(a.y), fb = fadeY(b.y);
    if (fa <= 0 && fb <= 0) return;
    pos.push(a.x * radius, a.y * radius, a.z * radius, b.x * radius, b.y * radius, b.z * radius);
    al.push(alpha * fa, alpha * fb);
    ts.push(t, t);
  };
  // круги склонения
  [-60, -30, 0, 30, 60, 75].forEach((dec) => {
    const alpha = dec === 0 ? 0.55 : 0.28;
    for (let k = 0; k < 180; k++) {
      eqToLocal((k / 180) * TAU, dec * DEG, v, sky);
      eqToLocal(((k + 1) / 180) * TAU, dec * DEG, w, sky);
      seg(v, w, alpha, k / 180);
    }
  });
  // часовые круги (через 2 часа)
  for (let h = 0; h < 12; h++) {
    const ra = h * 30 * DEG;
    for (let k = 0; k < 84; k++) {
      const d0 = -84 + k * 2, d1 = d0 + 2;
      eqToLocal(ra, d0 * DEG, v, sky);
      eqToLocal(ra, d1 * DEG, w, sky);
      seg(v, w, h % 3 === 0 ? 0.3 : 0.18, (d0 + 84) / 168);
    }
  }
  // эклиптика с делениями (наклон 23,44°)
  const eps = 23.44 * DEG;
  const ecl = (lam, beta, out) => {
    // эклиптические → экваториальные
    const cb = Math.cos(beta);
    const x = cb * Math.cos(lam), y = cb * Math.sin(lam), z = Math.sin(beta);
    const ye = y * Math.cos(eps) - z * Math.sin(eps);
    const ze = y * Math.sin(eps) + z * Math.cos(eps);
    return eqToLocal(Math.atan2(ye, x), Math.asin(clamp(ze, -1, 1)), out, sky);
  };
  for (let k = 0; k < 360; k++) {
    ecl(k * DEG, 0, v); ecl((k + 1) * DEG, 0, w);
    seg(v, w, 0.75, k / 360);
    if (k % 5 === 0) {
      const len = k % 30 === 0 ? 2.6 : k % 10 === 0 ? 1.5 : 0.8;
      ecl(k * DEG, -len * DEG, v); ecl(k * DEG, len * DEG, w);
      seg(v, w, k % 30 === 0 ? 0.8 : 0.55, k / 360);
    }
  }
  // горизонт
  for (let k = 0; k < 180; k++) {
    const a0 = (k / 180) * TAU, a1 = ((k + 1) / 180) * TAU;
    v.set(Math.cos(a0), 0.004, Math.sin(a0));
    w.set(Math.cos(a1), 0.004, Math.sin(a1));
    seg(v, w, 0.45, k / 180);
  }
  return { positions: new Float32Array(pos), alphas: new Float32Array(al), ts: new Float32Array(ts) };
}

/**
 * Купол неба из частиц: полоса Млечного Пути (с тёмной пылевой «щелью») + отдельные звёзды.
 * Только над горизонтом. Возвращает буфер точек.
 */
export function skyDomeBuf(n, opts = {}) {
  const job = skyDomeJob(n, opts, Infinity);
  let it;
  do { it = job.next(); } while (!it.done);
  return it.value;
}

/** То же, но генератор: уступает поток каждые chunk точек (для построения в init() без долгих кадров). */
export function* skyDomeJob(n, { radius = 46, seed = 31, bandFrac = 0.8, glowFrac = 0.42, alphaK = 1, sky = SKY } = {}, chunk = 12000) {
  const buf = makeBuf(n);
  const r = rng(seed);
  const v = new THREE.Vector3();
  const warm = S.color('#fff1d8'), blue = S.color('#cfe0ff'), pale = S.PAL.pale, white = S.PAL.white, mint = S.PAL.mint;
  for (let i = 0; i < n; i++) {
    let guard = 0;
    let size, c, a;
    for (;;) {
      guard++;
      if (r() < bandFrac) {
        // галактическая долгота: сгущение к центру Галактики
        let l = r() < 0.6 ? r.gauss(0, 42) : r.range(-180, 180);
        l = ((l % 360) + 540) % 360 - 180;
        const core = Math.exp(-((l / 24) ** 2));
        const thick = 2.6 + 6.5 * core + 1.2 * Math.abs(Math.sin(l * DEG * 2));
        let b = r.gauss(0, thick);
        // «Большой провал» — тёмная пылевая полоса вдоль середины полосы
        const lane = 0.6 + 1.6 * Math.sin(l * DEG * 1.7);
        if (l > -30 && l < 75 && Math.abs(b - lane) < 1.4 + 1.2 * core && r() < 0.82 && guard < 40) continue;
        galToLocal(l * DEG, b * DEG, v, sky);
        const k = r();
        if (r() < glowFrac) {
          // «молочное» свечение полосы — крупные слабые точки
          c = core > 0.3 && k < 0.35 ? warm : k < 0.6 ? pale : k < 0.85 ? white : mint;
          size = r.range(6, 13) * (1 + core * 0.5);
          a = r.range(0.012, 0.032) * (0.5 + 0.9 * core) * Math.exp(-((b / (thick * 1.3)) ** 2)) * alphaK;
        } else {
          c = core > 0.4 && k < 0.5 ? warm : k < 0.5 ? white : k < 0.68 ? pale : k < 0.84 ? blue : k < 0.92 ? mint : warm;
          size = Math.pow(r(), 7) * 2.6 + 0.6;
          a = r.range(0.25, 0.65) * (0.55 + 0.45 * core + 0.25 * Math.exp(-((b / 3) ** 2))) * alphaK;
        }
      } else {
        const [x, y, z] = r.onSphere(1);
        v.set(x, y, z);
        const k = r();
        c = k < 0.75 ? white : k < 0.87 ? blue : k < 0.95 ? warm : mint;
        size = Math.pow(r(), 9) * 3.6 + 0.6;
        a = r.range(0.35, 0.9) * alphaK;
      }
      if (v.y > 0.012 || guard > 40) break;
    }
    // чуть «утапливаем» у горизонта
    const fade = clamp((v.y - 0.01) / 0.08, 0, 1);
    putPoint(buf, i, v.x * radius, v.y * radius, v.z * radius, size, c, a * (0.35 + 0.65 * fade));
    if (i % chunk === chunk - 1) yield;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Материалы
// ---------------------------------------------------------------------------

/** Линии с прозрачностью по вершинам, «прорисовкой» (uProgress по атрибуту aT) и общей прозрачностью. */
export function lineMaterial({ color = '#00e000', k = 1, alpha = 1, additive = true } = {}) {
  const c = new THREE.Color(color).multiplyScalar(k);
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uAlpha: { value: alpha }, uColor: { value: c }, uProgress: { value: 1 }, uSoft: { value: 0.04 } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aT;
      varying float vA;
      varying float vT;
      void main() {
        vA = aAlpha;
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uAlpha, uProgress, uSoft;
      varying float vA;
      varying float vT;
      void main() {
        float reveal = 1.0 - smoothstep(uProgress - uSoft, uProgress, vT);
        gl_FragColor = vec4(uColor, vA * uOpacity * uAlpha * reveal);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export function lineGeometry(positions, alphas, ts = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  g.setAttribute('aT', new THREE.BufferAttribute(ts || new Float32Array(alphas.length), 1));
  return g;
}

/** Точки-«звёзды» с мягким свечением (размер в мировых единицах). */
export function starMaterial({ k = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uAlpha: { value: 1 }, uScale: { value: 600 }, uTime: { value: 0 }, uK: { value: k } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uScale, uTime, uK;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.5, 64.0);
        vColor = aColor * uK;
        vTw = 0.8 + 0.2 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 30.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity, uAlpha;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = exp(-d * d * 18.0);
        float halo = exp(-d * d * 3.5) * 0.35;
        float spike = max(0.0, 1.0 - abs(gl_PointCoord.x - 0.5) * 40.0) * max(0.0, 1.0 - d) + max(0.0, 1.0 - abs(gl_PointCoord.y - 0.5) * 40.0) * max(0.0, 1.0 - d);
        float a = (core + halo + spike * 0.5) * vTw * uOpacity * uAlpha;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

let glowTex = null;
/** Мягкая радиальная текстура свечения (для спрайтов). */
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  glowTex.userData.shared = true;   // кэш модуля: dispose() сцены (выгрузка LRU) её не трогает
  return glowTex;
}

/** Светящийся спрайт (цвет > 1 — попадает в bloom). */
export function glowSprite(color = '#00ff00', k = 1.5, size = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(color).multiplyScalar(k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

/** Пикселей на мировую единицу на расстоянии 1 (как uScale у облака частиц). */
export function pxScale(ctx) {
  const e = ctx.engine;
  return (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov * 0.5));
}

/**
 * «Дозаправка» прогрева. Режиссёр после init() компилирует шейдеры (compileAsync), но журналы и адреса uniform-ов
 * программы three запрашивает при первом кадре — синхронно, дожидаясь GPU-процесса (под нагрузкой — до 0,2 с на
 * программу, рывок при первом показе сцены). Здесь то же делается заранее, в фоне, пока сцена ещё не на экране.
 * Вызывать в конце init() (без await): ждёт, пока прогрев режиссёра создаст программы.
 */
export function primePrograms(visual, tries = 0) {
  const r = visual.ctx.renderer;
  setTimeout(() => {
    if (visual._disposed || visual.active) return;
    let pending = false;
    visual.root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        const progs = r.properties.get(m).programs;
        if (!progs || !progs.size) { pending = true; continue; }
        progs.forEach((p) => {
          if (p.isReady && !p.isReady()) pending = true;
          else p.getUniforms?.();
        });
      }
    });
    if (pending && tries < 30) primePrograms(visual, tries + 1);
  }, tries ? 300 : 600);
}

/**
 * Угол обзора для экранов уже 16:9 — так же, как director.fitPose (по горизонтали видно столько же, сколько на 16:9).
 * Нужен только для покадровой камеры (drive): позы из camera() режиссёр подгоняет сам.
 */
export function fitFov(ctx, fov) {
  const a = ctx.camera.aspect || 16 / 9;
  if (a >= 16 / 9 - 0.01) return fov;
  const f2 = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (16 / 9) / a);
  return Math.min(150, THREE.MathUtils.radToDeg(f2));
}

// ---------------------------------------------------------------------------
// Импульсы: светящиеся точки с хвостом бегут по квадратичным кривым Безье (вычисляется на GPU).
// curves: [{ p0:[x,y,z], p1, p2, a, b }]. Прибытие импульса в узел можно отследить на CPU (onArrive).
// ---------------------------------------------------------------------------
const PULSE_VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aP1;
attribute vec3 aP2;
attribute vec4 aParam;   // скорость, сдвиг фазы, место в хвосте (0 — голова … 1 — конец), размер
uniform float uTime, uScale, uSize, uTail, uWaveR, uWaveAmp, uWaveW;
uniform vec3 uWaveC, uColA, uColB;
varying vec3 vCol;
varying float vA;
void main() {
  float ph = fract(uTime * aParam.x + aParam.y);
  float head = ph * 1.3 - 0.15;
  float t = head - aParam.z * uTail;
  float vis = step(0.0, t) * step(t, 1.0);
  t = clamp(t, 0.0, 1.0);
  float u = 1.0 - t;
  vec3 p = u * u * aP0 + 2.0 * u * t * aP1 + t * t * aP2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = 1.0 - aParam.z;
  float dw = (distance(p, uWaveC) - uWaveR) / uWaveW;
  float wave = uWaveAmp * exp(-dw * dw);
  float sz = uSize * aParam.w * (0.3 + 0.7 * k) * (1.0 + wave * 0.8);
  gl_PointSize = clamp(sz * uScale / max(0.1, -mv.z), 1.0, 56.0);
  vCol = mix(uColB, uColA, k) * (1.0 + wave);
  vA = vis * k * (0.35 + 0.65 * k);
  if (vis < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PULSE_FRAG = /* glsl */ `
uniform float uOpacity, uAlpha;
varying vec3 vCol;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 6.0) + (1.0 - d) * 0.15) * vA * uOpacity * uAlpha;
  gl_FragColor = vec4(vCol, a);
}`;

export class Pulses {
  constructor(curves, { count = 220, tail = 7, size = 0.2, speed = [0.16, 0.34], seed = 3, colA = [0.7, 2.6, 0.75], colB = [0.1, 0.9, 0.2], tailLen = 0.11 } = {}) {
    const r = rng(seed);
    this.curves = curves;
    this.count = count;
    this.tail = tail;
    const N = count * tail;
    const P0 = new Float32Array(N * 3), P1 = new Float32Array(N * 3), P2 = new Float32Array(N * 3), PR = new Float32Array(N * 4);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const c = curves[Math.floor(r() * curves.length)];
      const fwd = r() < 0.5;
      const a = fwd ? c.p0 : c.p2, b = fwd ? c.p2 : c.p0;
      const sp = r.range(speed[0], speed[1]) * (6 / Math.max(2, c.len || 6));
      const off = r();
      const sz = r.range(0.75, 1.3);
      this.items.push({ sp, off, to: fwd ? c.b : c.a, prev: 0 });
      for (let k = 0; k < tail; k++) {
        const j = i * tail + k;
        P0.set(a, j * 3); P1.set(c.p1, j * 3); P2.set(b, j * 3);
        PR.set([sp, off, k / tail, sz], j * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aP0', new THREE.BufferAttribute(P0, 3));
    g.setAttribute('aP1', new THREE.BufferAttribute(P1, 3));
    g.setAttribute('aP2', new THREE.BufferAttribute(P2, 3));
    g.setAttribute('aParam', new THREE.BufferAttribute(PR, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.uniforms = {
      uTime: { value: 0 }, uScale: { value: 600 }, uSize: { value: size }, uTail: { value: tailLen },
      uOpacity: { value: 1 }, uAlpha: { value: 0 },
      uWaveR: { value: -100 }, uWaveAmp: { value: 0 }, uWaveW: { value: 1.6 }, uWaveC: { value: new THREE.Vector3() },
      uColA: { value: new THREE.Vector3(...colA) }, uColB: { value: new THREE.Vector3(...colB) },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PULSE_VERT, fragmentShader: PULSE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this.time = 0;
    this.rate = 1;
  }

  /** Шаг времени; onArrive(nodeIndex) — когда голова импульса доходит до конца связи. */
  update(dt, onArrive) {
    this.time += dt * this.rate;
    this.uniforms.uTime.value = this.time;
    if (!onArrive) return;
    const t = this.time;
    for (const it of this.items) {
      const ph = (t * it.sp + it.off) % 1;
      // голова доходит до конца (t=1) при ph = 1.15/1.3
      if (it.prev < 0.885 && ph >= 0.885) onArrive(it.to);
      it.prev = ph;
    }
  }
}

// ---------------------------------------------------------------------------
// Вспышки узлов (тел нейронов): мягкие точки, яркость задаётся на CPU.
// ---------------------------------------------------------------------------
export class NodeGlows {
  constructor(positions, { size = 0.55, base = 0.25, color = [0.35, 1.6, 0.4], flash = [1.6, 2.2, 1.6] } = {}) {
    const n = positions.length;
    this.n = n;
    this.flash = new Float32Array(n);
    this.base = new Float32Array(n).fill(base);
    const pos = new Float32Array(n * 3);
    positions.forEach((p, i) => pos.set(p, i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.attr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aF', this.attr);
    this.uniforms = { uScale: { value: 600 }, uSize: { value: size }, uOpacity: { value: 1 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Vector3(...color) }, uFlashCol: { value: new THREE.Vector3(...flash) } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aF;
        uniform float uScale, uSize;
        uniform vec3 uCol, uFlashCol;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float f = clamp(aF, 0.0, 2.0);
          gl_PointSize = clamp(uSize * (1.0 + f * 0.9) * uScale / max(0.1, -mv.z), 1.0, 90.0);
          vCol = mix(uCol, uFlashCol, clamp(f, 0.0, 1.0));
          vA = clamp(0.2 + f * 0.75, 0.0, 1.1);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity, uAlpha;
        varying vec3 vCol;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = (exp(-d * d * 7.0) * 0.9 + exp(-d * d * 2.0) * 0.25) * vA * uOpacity * uAlpha;
          gl_FragColor = vec4(vCol, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }
  hit(i, k = 1) { if (i >= 0 && i < this.n) this.flash[i] = Math.min(2, this.flash[i] + k); }
  update(dt) {
    const a = this.attr.array;
    const decay = Math.exp(-dt * 3.2);
    for (let i = 0; i < this.n; i++) {
      this.flash[i] *= decay;
      a[i] = this.base[i] + this.flash[i];
    }
    this.attr.needsUpdate = true;
  }
}

/** Плавное значение-«ручка» для gsap: { v }. */
export const knob = (v = 0) => ({ v });

export { lerp, clamp, TAU, rng };
