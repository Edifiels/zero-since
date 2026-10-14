// Мозг дрозофилы для визуализаций блока 3: объём (объединение эллипсоидов) и «нейроны» —
// случайные блуждания внутри объёма, каждый нейрон своим цветом (как на картах FlyWire).
//
// Единицы «мозга»: ширина ≈ 2 (−1…1 по X вместе со зрительными долями), высота ≈ 0.9, толщина ≈ 0.55.
// Ориентация: перед — +Z, верх — +Y. Через центр снизу проходит отверстие пищевода (вдоль Z).
//
// Все формы для облака частиц строятся из ОДНОГО набора точек (тот же порядок частиц),
// поэтому морфинг «мозг → срезы → цветной мозг» выглядит связно: каждая частица летит на своё место.
import * as THREE from 'three';
import { rng } from '../../core/utils.js';
import { createShape, setPoint, PAL, equalize } from '../../core/shapes.js';

// cx, cy, cz, rx, ry, rz, регион (0 — центральный мозг, 1 — подглоточная зона, 2 — антеннальные доли,
// 3 — лобула, 4 — медулла, 5 — ламина)
export const BRAIN_PARTS = [
  [-0.17, 0.09, 0.0, 0.27, 0.29, 0.25, 0],
  [0.17, 0.09, 0.0, 0.27, 0.29, 0.25, 0],
  [0.0, -0.05, 0.02, 0.31, 0.26, 0.24, 0],
  [0.0, -0.3, 0.05, 0.19, 0.12, 0.17, 1],
  [-0.1, -0.17, 0.19, 0.09, 0.08, 0.08, 2],
  [0.1, -0.17, 0.19, 0.09, 0.08, 0.08, 2],
  [-0.52, 0.0, -0.05, 0.16, 0.29, 0.19, 3],
  [0.52, 0.0, -0.05, 0.16, 0.29, 0.19, 3],
  [-0.74, 0.0, 0.0, 0.13, 0.37, 0.25, 4],
  [0.74, 0.0, 0.0, 0.13, 0.37, 0.25, 4],
  [-0.9, 0.0, 0.02, 0.055, 0.36, 0.24, 5],
  [0.9, 0.0, 0.02, 0.055, 0.36, 0.24, 5],
];
// Габариты (для срезов): плоскость среза покрывает X ∈ [−1.05; 1.05], Y ∈ [Y0; Y0 + 1.05]
export const BOX = { x0: -1.05, x1: 1.05, y0: -0.545, y1: 0.505, z0: -0.27, z1: 0.27 };
export const HOLE = { y: -0.16, rx: 0.055, ry: 0.06 };

/** «Глубина» точки внутри мозга: > 0 — внутри (до 1 в центре доли), ≤ 0 — снаружи. */
export function brainDepth(x, y, z) {
  if (Math.abs(x) < HOLE.rx && Math.abs(y - HOLE.y) < HOLE.ry) return -1;
  let best = -1;
  for (let i = 0; i < BRAIN_PARTS.length; i++) {
    const p = BRAIN_PARTS[i];
    const dx = (x - p[0]) / p[3], dy = (y - p[1]) / p[4], dz = (z - p[2]) / p[5];
    const v = 1 - (dx * dx + dy * dy + dz * dz);
    if (v > best) best = v;
  }
  return best;
}

/** GLSL-версия brainDepth (для шейдеров срезов). */
export const BRAIN_GLSL = /* glsl */ `
float brainDepth(vec3 p) {
  if (abs(p.x) < ${HOLE.rx.toFixed(3)} && abs(p.y - (${HOLE.y.toFixed(3)})) < ${HOLE.ry.toFixed(3)}) return -1.0;
  float best = -1.0;
  vec3 d;
${BRAIN_PARTS.map((p) => `  d = (p - vec3(${p[0].toFixed(3)}, ${p[1].toFixed(3)}, ${p[2].toFixed(3)})) / vec3(${p[3].toFixed(3)}, ${p[4].toFixed(3)}, ${p[5].toFixed(3)});
  best = max(best, 1.0 - dot(d, d));`).join('\n')}
  return best;
}
`;

// ---------------------------------------------------------------------------
// Нейроны

let NEURONS = null;

function buildNeurons(seed = 21) {
  const r = rng(seed);
  const byRegion = [[], [], [], [], [], []];
  BRAIN_PARTS.forEach((p) => byRegion[p[6]].push(p));
  const regionW = [0.36, 0.07, 0.05, 0.14, 0.28, 0.1];
  const pickRegion = () => {
    let k = r(), i = 0;
    for (; i < regionW.length - 1; i++) { k -= regionW[i]; if (k <= 0) break; }
    return i;
  };
  const col = new THREE.Color();
  const list = [];
  const step = 0.028;
  const NEUR = 1700;
  for (let n = 0; n < NEUR; n++) {
    const reg = pickRegion();
    const part = byRegion[reg][Math.floor(r() * byRegion[reg].length)];
    // тело клетки — у поверхности доли (кора), отростки уходят вглубь
    let sx = 0, sy = 0, sz = 0, ok = false;
    for (let tries = 0; tries < 30 && !ok; tries++) {
      const [ux, uy, uz] = r.onSphere(1);
      const k = r.range(0.78, 0.95);
      sx = part[0] + ux * part[3] * k; sy = part[1] + uy * part[4] * k; sz = part[2] + uz * part[5] * k;
      ok = brainDepth(sx, sy, sz) > 0.02;
    }
    if (!ok) continue;
    const optic = reg >= 3;
    let dx = part[0] - sx, dy = part[1] - sy, dz = part[2] - sz;
    if (optic) { dx = -Math.sign(sx || 1) * 1.2; dy *= 0.3; dz *= 0.3; }
    let l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const pts = [sx, sy, sz];
    const steps = optic ? r.int(22, 62) : r.int(14, 46);
    let px = sx, py = sy, pz = sz;
    const wig = optic ? 0.22 : 0.45;
    for (let s = 0; s < steps; s++) {
      dx += r.gauss(0, wig); dy += r.gauss(0, wig); dz += r.gauss(0, wig);
      if (optic) dx += -Math.sign(px || 1) * 0.35;
      l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      let nx = px + dx * step, ny = py + dy * step, nz = pz + dz * step;
      if (brainDepth(nx, ny, nz) <= 0.01) {
        // упёрлись в край — разворачиваемся внутрь доли
        dx = part[0] - px + r.gauss(0, 0.05); dy = part[1] - py + r.gauss(0, 0.05); dz = part[2] - pz + r.gauss(0, 0.05);
        l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        nx = px + dx * step; ny = py + dy * step; nz = pz + dz * step;
        if (brainDepth(nx, ny, nz) <= 0.0) break;
      }
      px = nx; py = ny; pz = nz;
      pts.push(px, py, pz);
    }
    if (pts.length < 9) continue;
    col.setHSL(r(), r.range(0.85, 1), r.range(0.46, 0.56));
    list.push({ pts, c: [col.r, col.g, col.b], reg, soma: [sx, sy, sz] });
  }
  // Грибовидные тела — плотные пучки (характерная структура центрального мозга)
  for (const s of [-1, 1]) {
    for (let n = 0; n < 50; n++) {
      const path = [
        [s * 0.22, 0.24, -0.17], [s * 0.18, 0.16, -0.06], [s * 0.14, 0.06, 0.08], [s * 0.13, 0.03, 0.15],
        r() < 0.5 ? [s * 0.14, 0.26, 0.17] : [s * 0.02, 0.03, 0.16],
      ];
      const pts = [];
      const j = () => r.gauss(0, 0.03);
      const jit = [j(), j(), j()];
      const crv = new THREE.CatmullRomCurve3(path.map((q) => new THREE.Vector3(q[0] + jit[0], q[1] + jit[1], q[2] + jit[2])));
      const v = new THREE.Vector3();
      for (let k = 0; k <= 24; k++) { crv.getPoint(k / 24, v); pts.push(v.x, v.y, v.z); }
      col.setHSL(r(), r.range(0.85, 1), r.range(0.46, 0.56));
      list.push({ pts, c: [col.r, col.g, col.b], reg: 0, soma: [pts[0], pts[1], pts[2]] });
    }
  }
  return list;
}

export function neurons() {
  if (!NEURONS) NEURONS = buildNeurons();
  return NEURONS;
}

// ---------------------------------------------------------------------------
// Базовый набор точек (кэш по числу частиц)

const BASE = new Map();

/**
 * База точек: P (xyz), C (цвет нейрона), A (альфа), S (размер), K (тип: 0 — отросток, 1 — тело клетки, 2 — заполнение).
 */
export function brainBase(count) {
  if (BASE.has(count)) return BASE.get(count);
  const r = rng(77);
  const list = neurons();
  const P = new Float32Array(count * 3), C = new Float32Array(count * 3), A = new Float32Array(count), S = new Float32Array(count);
  const K = new Uint8Array(count);
  const nNeur = Math.floor(count * 0.8), nSoma = Math.floor(count * 0.08);
  // длины нейронов
  const lens = list.map((n) => (n.pts.length / 3 - 1));
  const total = lens.reduce((a, b) => a + b, 0);
  let i = 0;
  // отростки: распределяем по длине
  for (let ni = 0; ni < list.length && i < nNeur; ni++) {
    const nrn = list[ni];
    const m = ni === list.length - 1 ? nNeur - i : Math.round(nNeur * lens[ni] / total);
    const segs = lens[ni];
    for (let k = 0; k < m && i < nNeur; k++, i++) {
      const t = r() * segs;
      const s0 = Math.min(segs - 1, Math.floor(t)), f = t - s0;
      const a = s0 * 3, b = a + 3;
      const p = nrn.pts;
      P[i * 3] = p[a] + (p[b] - p[a]) * f + r.gauss(0, 0.005);
      P[i * 3 + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * f + r.gauss(0, 0.005);
      P[i * 3 + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * f + r.gauss(0, 0.005);
      C.set(nrn.c, i * 3);
      A[i] = r.range(0.32, 0.6);
      S[i] = r.range(0.45, 0.95);
      K[i] = 0;
    }
  }
  // тела клеток
  for (let k = 0; k < nSoma; k++, i++) {
    const nrn = list[Math.floor(r() * list.length)];
    const [x, y, z] = r.inSphere(0.012);
    P[i * 3] = nrn.soma[0] + x; P[i * 3 + 1] = nrn.soma[1] + y; P[i * 3 + 2] = nrn.soma[2] + z;
    C.set(nrn.c, i * 3);
    A[i] = r.range(0.45, 0.8);
    S[i] = r.range(0.9, 1.5);
    K[i] = 1;
  }
  // заполнение объёма (нейропиль) — едва заметное
  while (i < count) {
    const x = r.range(-1, 1), y = r.range(-0.46, 0.42), z = r.range(-0.27, 0.27);
    if (brainDepth(x, y, z) <= 0) continue;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    C[i * 3] = 0.55; C[i * 3 + 1] = 0.75; C[i * 3 + 2] = 0.6;
    A[i] = r.range(0.04, 0.12);
    S[i] = r.range(0.4, 0.8);
    K[i] = 2;
    i++;
  }
  const base = { count, P, C, A, S, K };
  BASE.set(count, base);
  return base;
}

// ---------------------------------------------------------------------------
// Формы для облака частиц (позиции — в единицах мозга)

const SHAPES = new Map();
// eq — во сколько раз форма будет увеличена в мире (object.scale): выравнивание плотности
// (shapes.equalize) считается в мировых клетках, иначе мелкая форма «выгорает» или гаснет.
const cached = (key, eq, fn, target = 9) => {
  const k = key + ':' + (eq || 0) + ':' + target;
  if (!SHAPES.has(k)) {
    const s = fn();
    if (eq) equalize(s, { cell: 0.12 / eq, target });
    SHAPES.set(k, s);
  }
  return SHAPES.get(k);
};

/** Многоцветный мозг (как на картах FlyWire). */
export function brainColored(count, { alpha = 1, eq = 3, target = 4 } = {}) {
  return cached(`col:${count}:${alpha}`, eq, () => {
    const b = brainBase(count), s = createShape(count);
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const soma = b.K[i] === 1, fill = b.K[i] === 2;
      const k = soma ? 1.15 : 1.05;
      setPoint(s, i, b.P[j], b.P[j + 1], b.P[j + 2], b.S[i], [b.C[j] * k, b.C[j + 1] * k, b.C[j + 2] * k], b.A[i] * alpha * (fill ? 0.35 : 1.1));
    }
    return s;
  }, target);
}

/** Тот же мозг в фирменных цветах (белый/зелёный). */
export function brainBrand(count, { alpha = 1, eq = 3 } = {}) {
  return cached(`brand:${count}:${alpha}`, eq, () => {
    const b = brainBase(count), s = createShape(count), r = rng(5);
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const t = r();
      const c = b.K[i] === 2 ? PAL.green : b.K[i] === 1 ? (t < 0.5 ? PAL.bright : PAL.greenHi) : t < 0.12 ? PAL.greenHi : t < 0.55 ? PAL.white : PAL.mint;
      setPoint(s, i, b.P[j], b.P[j + 1], b.P[j + 2], b.S[i], c, b.A[i] * alpha * (b.K[i] === 2 ? 1.6 : 1));
    }
    return s;
  });
}

/**
 * Мозг, «нарезанный» на ns срезов вдоль Z и раздвинутый: x += k·shear, z = k·depth·spread, k = i/(ns−1) − 0.5.
 * Совпадает с раскладкой плоскостей-срезов в connectome.js.
 * colored — цвета нейронов (иначе серо-белые), alpha — множитель прозрачности.
 */
export function brainSlices(count, { ns = 40, spread = 1, shear = 0, colored = false, alpha = 0.15, lift = 0.006, eq = 3 } = {}) {
  return cached(`sl:${count}:${ns}:${spread}:${shear}:${colored}:${alpha}`, eq, () => {
    const b = brainBase(count), s = createShape(count);
    const depth = BOX.z1 - BOX.z0;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      const zn = (b.P[j + 2] - BOX.z0) / depth;
      const idx = Math.max(0, Math.min(ns - 1, Math.round(zn * (ns - 1))));
      const k = idx / (ns - 1) - 0.5;
      const c = colored ? [b.C[j], b.C[j + 1], b.C[j + 2]] : [0.75, 0.8, 0.75];
      setPoint(s, i, b.P[j] + k * shear, b.P[j + 1], k * depth * spread + lift, b.S[i] * 0.8, c, b.A[i] * alpha);
    }
    return s;
  });
}

/** Точка входа вкусового сигнала (подглоточная зона) и моторный нейрон хоботка — в единицах мозга. */
export const TASTE_IN = [0.0, -0.4, 0.08];
export const MOTOR = [0.05, -0.33, 0.16];
