// Библиотека форм для облака частиц.
// Каждая функция: (count, opts) => { count, positions: Float32Array(count*4), colors: Float32Array(count*4), meta? }
//   positions: x, y, z, размер (1 — обычный);  colors: r, g, b (линейные, можно > 1 для свечения), альфа.
// Мировые единицы: формы обычно умещаются в ±5…7 по X — камера по умолчанию стоит на z ≈ 14.
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { rng, TAU, clamp, lerp } from './utils.js';

// ---------- Цвета (линейные RGB) -------------------------------------------
const lin = (hex, k = 1) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
export const PAL = {
  white: lin('#ffffff'),
  bright: lin('#ffffff', 1.8),     // светится через bloom
  green: lin('#00e000'),
  greenHi: lin('#00ff00', 1.6),    // светящийся зелёный
  mint: lin('#8dff7a'),
  pale: lin('#dcffd6'),
  blue: lin('#bcd6ff'),
  warm: lin('#ffeccb'),
  orange: lin('#ff8a1f'),
  red: lin('#ff3b30'),
  grey: lin('#9aa59a'),
  dim: lin('#2f4a2d'),
};
export const color = lin;
export const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const scaleColor = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------- Базовые операции -----------------------------------------------
export function createShape(count) {
  return { count, positions: new Float32Array(count * 4), colors: new Float32Array(count * 4), meta: {} };
}
export function setPoint(s, i, x, y, z, size = 1, c = PAL.white, a = 1) {
  const j = i * 4, p = s.positions, q = s.colors;
  p[j] = x; p[j + 1] = y; p[j + 2] = z; p[j + 3] = size;
  q[j] = c[0]; q[j + 1] = c[1]; q[j + 2] = c[2]; q[j + 3] = a;
}

/** Сдвиг/поворот/масштаб формы (на месте). */
export function transform(s, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale),
  );
  const v = new THREE.Vector3();
  for (let i = 0; i < s.count; i++) {
    const j = i * 4;
    v.set(s.positions[j], s.positions[j + 1], s.positions[j + 2]).applyMatrix4(m);
    s.positions[j] = v.x; s.positions[j + 1] = v.y; s.positions[j + 2] = v.z;
  }
  return s;
}

/** Перекрасить форму. */
export function recolor(s, c, alpha = null, sizeK = 1) {
  for (let i = 0; i < s.count; i++) {
    const j = i * 4;
    s.colors[j] = c[0]; s.colors[j + 1] = c[1]; s.colors[j + 2] = c[2];
    if (alpha != null) s.colors[j + 3] = alpha;
    s.positions[j + 3] *= sizeK;
  }
  return s;
}

/** Умножить альфу (напр. приглушить форму). */
export function fade(s, k) {
  for (let i = 0; i < s.count; i++) s.colors[i * 4 + 3] *= k;
  return s;
}

/**
 * Выравнивание плотности: там, где на экране слишком много частиц друг на друге,
 * их прозрачность уменьшается (иначе аддитивное свечение «выгорает» в белое пятно).
 * Вызывается автоматически в particles.morph() (отключить: morph(shape, { equalize: false })).
 *   axis — вдоль какой оси смотрит камера: 'z' (по умолчанию, вид спереди) или 'y' (вид сверху, напр. галактика)
 *   target — допустимая «сумма альфы» в ячейке cell×cell (мировые единицы)
 */
export function equalize(s, { axis = s.meta?.axis || 'z', cell = 0.12, target = 11, floor = 0.015, scale = 1 } = {}) {
  // scale — во сколько раз облако будет увеличено (particles.object.scale): ячейку берём в координатах формы
  cell = cell / Math.max(1e-3, scale);
  const P = s.positions, C = s.colors, n = s.count;
  const ax = axis === 'y' ? [0, 2] : axis === 'x' ? [2, 1] : [0, 1];
  const inv = 1 / cell;
  const map = new Map();
  const keys = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const a = C[j + 3];
    if (a <= 0) continue;
    const kx = Math.floor(P[j + ax[0]] * inv), ky = Math.floor(P[j + ax[1]] * inv);
    keys[i * 2] = kx; keys[i * 2 + 1] = ky;
    const key = kx * 73856093 ^ ky * 19349663;
    map.set(key, (map.get(key) || 0) + a * Math.max(0.5, P[j + 3]));
  }
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (C[j + 3] <= 0) continue;
    const key = keys[i * 2] * 73856093 ^ keys[i * 2 + 1] * 19349663;
    const sum = map.get(key) || 0;
    if (sum > target) C[j + 3] = Math.max(floor, C[j + 3] * target / sum);
  }
  s.meta = s.meta || {};
  s.meta.equalized = true;
  return s;
}

/** Случайно перемешать порядок точек (другое соответствие частиц при морфинге). */
export function shuffle(s, seed = 1) {
  const r = rng(seed);
  const P = s.positions, C = s.colors;
  for (let i = s.count - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    for (let c = 0; c < 4; c++) {
      let t = P[i * 4 + c]; P[i * 4 + c] = P[k * 4 + c]; P[k * 4 + c] = t;
      t = C[i * 4 + c]; C[i * 4 + c] = C[k * 4 + c]; C[k * 4 + c] = t;
    }
  }
  return s;
}

/**
 * Склеить несколько форм в одну.
 * parts: [{ weight, shape: (m) => shape, position, rotation, scale }]
 */
export function combine(count, parts) {
  const out = createShape(count);
  const total = parts.reduce((a, p) => a + (p.weight ?? 1), 0);
  let offset = 0;
  parts.forEach((p, idx) => {
    const m = idx === parts.length - 1 ? count - offset : Math.floor(count * (p.weight ?? 1) / total);
    if (m <= 0) return;
    const s = p.shape(m);
    if (p.position || p.rotation || p.scale) transform(s, p);
    out.positions.set(s.positions.subarray(0, m * 4), offset * 4);
    out.colors.set(s.colors.subarray(0, m * 4), offset * 4);
    out.meta['part' + idx] = { offset, count: m, meta: s.meta };
    offset += m;
  });
  return out;
}

// ---------- Простые формы ----------------------------------------------------

/** Космическая пыль — «нейтральное» состояние облака. */
export function dust(count, { radius = 58, inner = 14, size = 0.55, alpha = 0.2, seed = 3 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const rr = lerp(inner, radius, Math.pow(r(), 0.6));
    const [x, y, z] = r.onSphere(rr);
    const c = r() < 0.8 ? PAL.white : PAL.mint;
    setPoint(s, i, x, y * 0.7, z, size * r.range(0.5, 1.4), c, alpha * r.range(0.3, 1));
  }
  return s;
}

/** Невидимое облако (частицы рассеяны и прозрачны). */
export function hidden(count, opts = {}) {
  const s = dust(count, { ...opts, alpha: 0 });
  return s;
}

/** Сфера (оболочка). */
export function sphere(count, { radius = 4, thickness = 0.05, color: c = PAL.white, accent = PAL.green, accentRatio = 0.25, size = 1, alpha = 1, seed = 4 } = {}) {
  const s = createShape(count), r = rng(seed);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    const R = radius * (1 + r.gauss(0, thickness));
    const col = r() < accentRatio ? accent : c;
    setPoint(s, i, Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R, size * r.range(0.6, 1.3), col, alpha * r.range(0.5, 1));
  }
  return shuffle(s, seed);
}

/** Шар (заполненный объём). */
export function ball(count, { radius = 3, color: c = PAL.white, size = 1, alpha = 0.8, seed = 5 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = r.inSphere(radius);
    setPoint(s, i, x, y, z, size * r.range(0.5, 1.2), c, alpha * r.range(0.4, 1));
  }
  return s;
}

/** Кольцо / тор (в плоскости XZ). */
export function ring(count, { radius = 4, width = 0.5, thickness = 0.12, color: c = PAL.white, accent = PAL.green, accentRatio = 0.3, size = 1, alpha = 1, seed = 6 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU;
    const rr = radius + r.gauss(0, width * 0.5);
    setPoint(s, i, Math.cos(a) * rr, r.gauss(0, thickness), Math.sin(a) * rr, size * r.range(0.5, 1.3), r() < accentRatio ? accent : c, alpha * r.range(0.4, 1));
  }
  return s;
}

/** Двойная спираль (ДНК). */
export function helix(count, { radius = 1.4, height = 9, turns = 3.5, strands = 2, rungs = 0.25, color: c = PAL.white, accent = PAL.green, size = 1, seed = 7 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const t = r();
    const y = (t - 0.5) * height;
    const a = t * turns * TAU;
    if (r() < rungs) {
      const k = r();
      const x0 = Math.cos(a) * radius, z0 = Math.sin(a) * radius;
      const x1 = Math.cos(a + Math.PI) * radius, z1 = Math.sin(a + Math.PI) * radius;
      const rr = Math.round(t * turns * 10) / (turns * 10);
      const yy = (rr - 0.5) * height;
      setPoint(s, i, lerp(x0, x1, k), yy, lerp(z0, z1, k), size * 0.7, accent, 0.7);
    } else {
      const st = r.int(0, strands - 1);
      const aa = a + (st / strands) * TAU;
      setPoint(s, i, Math.cos(aa) * radius + r.gauss(0, 0.05), y + r.gauss(0, 0.05), Math.sin(aa) * radius + r.gauss(0, 0.05), size * r.range(0.7, 1.3), c, 1);
    }
  }
  return s;
}

/** Точки вдоль отрезка. */
export function line(count, from, to, { scatter = 0.03, color: c = PAL.white, size = 1, alpha = 1, seed = 8 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const t = r();
    setPoint(s, i, lerp(from[0], to[0], t) + r.gauss(0, scatter), lerp(from[1], to[1], t) + r.gauss(0, scatter), lerp(from[2], to[2], t) + r.gauss(0, scatter), size, c, alpha);
  }
  return s;
}

/** Точки вдоль кривой THREE.Curve. */
export function curve(count, crv, { scatter = 0.03, color: c = PAL.white, size = 1, alpha = 1, seed = 9, taper = false } = {}) {
  const s = createShape(count), r = rng(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = r();
    crv.getPointAt(t, v);
    const k = taper ? 1 - t * 0.8 : 1;
    setPoint(s, i, v.x + r.gauss(0, scatter * k), v.y + r.gauss(0, scatter * k), v.z + r.gauss(0, scatter * k), size * k, c, alpha);
  }
  return s;
}

/** Плоская сетка точек (XY). */
export function grid(count, { width = 12, height = 7, z = 0, jitter = 0.02, color: c = PAL.white, size = 0.8, alpha = 0.6, seed = 10 } = {}) {
  const s = createShape(count), r = rng(seed);
  const aspect = width / height;
  const ny = Math.max(1, Math.round(Math.sqrt(count / aspect)));
  const nx = Math.max(1, Math.ceil(count / ny));
  for (let i = 0; i < count; i++) {
    const gx = i % nx, gy = Math.floor(i / nx);
    const x = (gx / Math.max(1, nx - 1) - 0.5) * width;
    const y = (gy / Math.max(1, ny - 1) - 0.5) * height;
    setPoint(s, i, x + r.gauss(0, jitter), y + r.gauss(0, jitter), z, size, c, alpha);
  }
  return s;
}

/** Пересэмплировать произвольный список точек [[x,y,z], …] до count. */
export function fromPoints(count, pts, { jitter = 0.02, color: c = PAL.white, size = 1, alpha = 1, seed = 11 } = {}) {
  const s = createShape(count), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const p = pts[i < pts.length ? i : Math.floor(r() * pts.length)];
    setPoint(s, i, p[0] + r.gauss(0, jitter), p[1] + r.gauss(0, jitter), p[2] + r.gauss(0, jitter), p[3] ?? size, c, alpha);
  }
  return s;
}

// ---------- Галактика --------------------------------------------------------

/** Спиральная галактика в плоскости XZ (вид сверху — камера над ней). */
export function galaxy(count, { radius = 7, arms = 2, twist = 1.35, thickness = 0.22, bulge = 0.16, spread = 0.33, seed = 11, brightness = 1 } = {}) {
  const s = createShape(count), r = rng(seed);
  const core = PAL.warm, armC = PAL.white, outer = PAL.mint;
  for (let i = 0; i < count; i++) {
    let x, y, z, size, c, a;
    const t = r();
    if (t < bulge) {
      x = r.gauss(0, radius * 0.09); z = r.gauss(0, radius * 0.09); y = r.gauss(0, radius * 0.045);
      size = r.range(0.7, 1.6);
      c = r() < 0.7 ? core : PAL.bright;
      a = r.range(0.6, 1);
    } else {
      const rr = clamp(-Math.log(1 - r() * 0.985) * radius * 0.3, radius * 0.06, radius);
      const f = rr / radius;
      const arm = i % arms;
      const ang = (arm / arms) * TAU + f * twist * TAU + r.gauss(0, spread * (1 - f * 0.4));
      const sc = r.gauss(0, 0.06 * radius * (0.4 + f));
      x = Math.cos(ang) * rr + sc;
      z = Math.sin(ang) * rr + r.gauss(0, 0.06 * radius * (0.4 + f));
      y = r.gauss(0, thickness * (1 - f * 0.7));
      size = Math.pow(r(), 5) * 2.6 + 0.45;
      const k = r();
      c = k < 0.12 ? PAL.blue : k < 0.2 ? PAL.green : f > 0.62 ? mixColor(armC, outer, (f - 0.62) * 2.2) : armC;
      a = r.range(0.45, 1) * (1 - f * 0.35);
    }
    setPoint(s, i, x, y, z, size, scaleColor(c, brightness), a);
  }
  s.meta.axis = 'y';
  return s;
}

// ---------- Космическая паутина и нейросеть (общий граф) --------------------

/** Случайный граф узлов: основа и для космической паутины, и для сети нейронов. */
export function webGraph({ seed = 5, nodes = 46, extent = 9, depth = 0.55, k = 3 } = {}) {
  const r = rng(seed);
  const N = [];
  let guard = 0;
  while (N.length < nodes && guard++ < 20000) {
    const p = [r.range(-1, 1) * extent, r.range(-1, 1) * extent * 0.58, r.range(-1, 1) * extent * depth];
    // выкидываем точки за пределами эллипсоида и слишком близкие
    const e = (p[0] / extent) ** 2 + (p[1] / (extent * 0.58)) ** 2 + (p[2] / (extent * depth)) ** 2;
    if (e > 1) continue;
    const minD = extent * 0.17;
    if (N.some((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1], q.p[2] - p[2]) < minD)) continue;
    N.push({ p, m: r.range(0.5, 1.5) });
  }
  const E = [];
  const seen = new Set();
  N.forEach((a, i) => {
    const d = N.map((b, j) => [j, Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2])]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]);
    for (let n = 0; n < k; n++) {
      const [j, dist] = d[n];
      if (dist > extent * 0.75) continue;
      const key = i < j ? i + '-' + j : j + '-' + i;
      if (seen.has(key)) continue;
      seen.add(key);
      E.push([i, j, dist]);
    }
  });
  return { nodes: N, edges: E, extent };
}

function allocate(count, graph, fracNodes, fracEdges) {
  const nNodes = Math.floor(count * fracNodes);
  const nEdges = Math.floor(count * fracEdges);
  const nRest = count - nNodes - nEdges;
  const totalLen = graph.edges.reduce((a, e) => a + e[2], 0);
  const perEdge = graph.edges.map((e) => Math.floor(nEdges * e[2] / totalLen));
  let used = perEdge.reduce((a, b) => a + b, 0);
  for (let i = 0; used < nEdges; i = (i + 1) % perEdge.length) { perEdge[i]++; used++; }
  const totalM = graph.nodes.reduce((a, n) => a + n.m, 0);
  const perNode = graph.nodes.map((n) => Math.floor(nNodes * n.m / totalM));
  used = perNode.reduce((a, b) => a + b, 0);
  for (let i = 0; used < nNodes; i = (i + 1) % perNode.length) { perNode[i]++; used++; }
  return { nNodes, nEdges, nRest, perEdge, perNode };
}

/** Космическая паутина: скопления галактик в узлах, нити между ними, редкое «поле». */
export function cosmicWeb(count, { seed = 5, graph = null, extent = 9, nodes = 46, brightness = 1 } = {}) {
  const g = graph || webGraph({ seed, extent, nodes });
  const s = createShape(count), r = rng(seed + 100);
  const al = allocate(count, g, 0.24, 0.68);
  let i = 0;
  g.nodes.forEach((n, ni) => {
    const rad = 0.22 * n.m * (g.extent / 9);
    for (let k = 0; k < al.perNode[ni]; k++, i++) {
      const c = r() < 0.6 ? PAL.bright : r() < 0.5 ? PAL.pale : PAL.mint;
      setPoint(s, i, n.p[0] + r.gauss(0, rad), n.p[1] + r.gauss(0, rad), n.p[2] + r.gauss(0, rad), r.range(0.6, 1.5), scaleColor(c, brightness), r.range(0.6, 1));
    }
  });
  g.edges.forEach(([a, b], ei) => {
    const A = g.nodes[a].p, B = g.nodes[b].p;
    for (let k = 0; k < al.perEdge[ei]; k++, i++) {
      const t = r();
      const sc = 0.05 + 0.07 * Math.sin(Math.PI * t);
      const c = r() < 0.55 ? PAL.mint : PAL.white;
      setPoint(s, i, lerp(A[0], B[0], t) + r.gauss(0, sc), lerp(A[1], B[1], t) + r.gauss(0, sc), lerp(A[2], B[2], t) + r.gauss(0, sc), r.range(0.4, 1), scaleColor(c, brightness * 0.9), r.range(0.35, 0.85));
    }
  });
  for (; i < count; i++) {
    const p = [r.range(-1, 1) * g.extent * 1.1, r.range(-1, 1) * g.extent * 0.65, r.range(-1, 1) * g.extent * 0.6];
    setPoint(s, i, p[0], p[1], p[2], r.range(0.3, 0.7), PAL.white, r.range(0.08, 0.25));
  }
  s.meta.graph = g;
  return s;
}

/**
 * Сеть нейронов на том же графе: тела клеток в узлах, изогнутые аксоны вдоль рёбер,
 * ветвящиеся дендриты. meta.curves — кривые связей (для «импульсов»).
 */
export function neurons(count, { seed = 5, graph = null, extent = 9, nodes = 46, brightness = 1, bend = 0.28 } = {}) {
  const g = graph || webGraph({ seed, extent, nodes });
  const s = createShape(count), r = rng(seed + 200);
  const al = allocate(count, g, 0.2, 0.62);
  const scale = g.extent / 9;
  let i = 0;
  // Тела нейронов
  g.nodes.forEach((n, ni) => {
    const rad = 0.16 * (0.7 + n.m * 0.4) * scale;
    for (let k = 0; k < al.perNode[ni]; k++, i++) {
      const [x, y, z] = r.inSphere(rad);
      const c = r() < 0.55 ? PAL.greenHi : PAL.bright;
      setPoint(s, i, n.p[0] + x, n.p[1] + y, n.p[2] + z, r.range(0.8, 1.6), scaleColor(c, brightness), 1);
    }
  });
  // Аксоны — изогнутые кривые между узлами
  const curves = [];
  const v = new THREE.Vector3();
  g.edges.forEach(([a, b, dist], ei) => {
    const A = new THREE.Vector3(...g.nodes[a].p), B = new THREE.Vector3(...g.nodes[b].p);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const off = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize().multiplyScalar(dist * bend);
    const C = mid.add(off);
    const crv = new THREE.QuadraticBezierCurve3(A, C, B);
    curves.push({ a, b, curve: crv, length: crv.getLength() });
    for (let k = 0; k < al.perEdge[ei]; k++, i++) {
      const t = r();
      crv.getPoint(t, v);
      const sc = 0.022 * scale;
      const c = r() < 0.7 ? PAL.green : PAL.mint;
      setPoint(s, i, v.x + r.gauss(0, sc), v.y + r.gauss(0, sc), v.z + r.gauss(0, sc), r.range(0.45, 0.9), scaleColor(c, brightness), r.range(0.5, 0.95));
    }
  });
  // Дендриты — короткие ветвящиеся отростки
  const branches = [];
  g.nodes.forEach((n) => {
    const nb = 4 + Math.floor(r() * 3);
    for (let b = 0; b < nb; b++) {
      const dir = new THREE.Vector3(...r.onSphere(1));
      const len = r.range(0.6, 1.3) * scale;
      const start = new THREE.Vector3(...n.p);
      const mid = start.clone().addScaledVector(dir, len * 0.55).add(new THREE.Vector3(...r.onSphere(len * 0.18)));
      const end = start.clone().addScaledVector(dir, len).add(new THREE.Vector3(...r.onSphere(len * 0.3)));
      branches.push(new THREE.QuadraticBezierCurve3(start, mid, end));
      if (r() < 0.7) {
        const d2 = dir.clone().add(new THREE.Vector3(...r.onSphere(0.9))).normalize();
        const e2 = mid.clone().addScaledVector(d2, len * 0.5);
        branches.push(new THREE.QuadraticBezierCurve3(mid, mid.clone().lerp(e2, 0.5).add(new THREE.Vector3(...r.onSphere(len * 0.1))), e2));
      }
    }
  });
  for (; i < count; i++) {
    const crv = branches[Math.floor(r() * branches.length)];
    const t = Math.pow(r(), 0.8);
    crv.getPoint(t, v);
    setPoint(s, i, v.x + r.gauss(0, 0.015), v.y + r.gauss(0, 0.015), v.z + r.gauss(0, 0.015), r.range(0.35, 0.8) * (1 - t * 0.5), scaleColor(PAL.mint, brightness), r.range(0.4, 0.9) * (1 - t * 0.6));
  }
  s.meta.graph = g;
  s.meta.curves = curves;
  return s;
}

// ---------- Мозг ---------------------------------------------------------------

/**
 * Мозг из точек: два полушария с извилинами, мозжечок, ствол.
 * Ориентация: перед — +Z, верх — +Y, полушария — ±X. Размер ≈ 2·scale по длине.
 * opts.palette: { ridge, groove } — цвета гребней и борозд.
 */
export function brain(count, { scale = 3.6, seed = 9, interior = 0.06, brightness = 1, ridge = PAL.bright, groove = PAL.green, detail = 5.2 } = {}) {
  const s = createShape(count), r = rng(seed);
  const noise = new SimplexNoise({ random: r });
  const nCortex = Math.floor(count * (0.8 - interior));
  const nCereb = Math.floor(count * 0.12);
  const nStem = Math.floor(count * 0.04);
  let i = 0;
  const p = new THREE.Vector3();
  // Кора
  while (i < nCortex) {
    const [dx, dy, dz] = r.onSphere(1);
    p.set(dx * 0.7, dy * 0.6, dz * 0.93);
    // приплюснутое дно
    if (p.y < -0.22) p.y = -0.22 + (p.y + 0.22) * 0.5;
    // височные доли — выпуклость сбоку снизу
    const tl = Math.exp(-(((p.y + 0.18) / 0.2) ** 2) - (((p.z - 0.12) / 0.38) ** 2));
    p.x *= 1 + 0.12 * tl;
    // сужение к лобной части и затылку
    p.x *= 1 - 0.1 * Math.max(0, p.z - 0.5);
    // продольная щель между полушариями
    const side = Math.sign(p.x || 1);
    p.x = side * (Math.abs(p.x) * 0.95 + 0.035);
    if (Math.abs(dx) < 0.07 && p.y > -0.1) p.y -= 0.04 * (1 - Math.abs(dx) / 0.07);
    // извилины: «гребневой» шум
    const n = noise.noise3d(p.x * detail, p.y * detail, p.z * detail);
    const n2 = noise.noise3d(p.x * detail * 2.1 + 7, p.y * detail * 2.1, p.z * detail * 2.1);
    const g = 1 - Math.abs(n * 0.8 + n2 * 0.2);
    if (r() > 0.25 + 0.75 * Math.pow(g, 2.2)) continue;
    const disp = 1 + 0.06 * g;
    const c = mixColor(groove, ridge, Math.pow(g, 3));
    setPoint(s, i, p.x * disp * scale, p.y * disp * scale, p.z * disp * scale, 0.55 + g * 0.75, scaleColor(c, brightness), 0.45 + 0.55 * g);
    i++;
  }
  // Мозжечок (сзади снизу) с тонкими бороздами-листками
  const cc = [0, -0.36, -0.64];
  const nEnd1 = i + nCereb;
  while (i < nEnd1) {
    const [dx, dy, dz] = r.onSphere(1);
    const q = [dx * 0.44, dy * 0.22, dz * 0.3];
    const fol = 0.5 + 0.5 * Math.sin((q[1] + 0.03 * Math.sin(q[0] * 9)) * 85);
    if (r() > 0.3 + 0.7 * fol) continue;
    const k = 1 + 0.04 * fol;
    setPoint(s, i, (cc[0] + q[0] * k) * scale, (cc[1] + q[1] * k) * scale, (cc[2] + q[2] * k) * scale, 0.5 + fol * 0.5, scaleColor(mixColor(groove, ridge, fol * 0.8), brightness), 0.55 + 0.4 * fol);
    i++;
  }
  // Ствол
  const nEnd2 = i + nStem;
  for (; i < nEnd2; i++) {
    const t = r();
    const a = r() * TAU;
    const rad = 0.09 * (1 - t * 0.25);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const y = lerp(-0.3, -0.95, t), zz = lerp(-0.28, -0.44, t);
    setPoint(s, i, x * scale, y * scale, (zz + z) * scale, 0.6, scaleColor(groove, brightness), 0.7);
  }
  // Внутреннее свечение
  for (; i < count; i++) {
    const [x, y, z] = r.inSphere(1);
    setPoint(s, i, x * 0.55 * scale, y * 0.42 * scale, z * 0.8 * scale, r.range(0.4, 0.9), scaleColor(PAL.green, brightness), r.range(0.05, 0.22));
  }
  return s;
}

// ---------- Формы из картинок, SVG, текста, геометрии --------------------------

/**
 * Точки по непрозрачным (или ярким) пикселям canvas. Плоскость XY, центр в 0.
 * opts: width — ширина в мире, depth — толщина по Z, threshold, channel: 'alpha' | 'luma',
 *       color, colorFn(x, y, r) => [r,g,b], size, alpha, jitter (в пикселях), useImageColor
 */
export function fromCanvas(count, canvas, { width = 8, depth = 0.3, threshold = 0.5, channel = 'alpha', color: c = PAL.white, colorFn = null, size = 1, sizeJitter = 0.35, alpha = 1, jitter = 1, seed = 12, useImageColor = false } = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, W, H).data;
  const cand = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4;
      const v = channel === 'alpha' ? data[j + 3] / 255 : (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255 * (data[j + 3] / 255);
      if (v > threshold) cand.push(y * W + x);
    }
  }
  const s = createShape(count), r = rng(seed);
  if (!cand.length) return hidden(count);
  const k = width / W;
  for (let i = 0; i < count; i++) {
    const idx = cand[Math.floor(r() * cand.length)];
    const px = idx % W, py = Math.floor(idx / W);
    const x = (px + 0.5 + (r() - 0.5) * jitter - W / 2) * k;
    const y = -(py + 0.5 + (r() - 0.5) * jitter - H / 2) * k;
    const z = (r() - 0.5) * depth;
    let col = c;
    if (useImageColor) { const j = idx * 4; col = lin(`rgb(${data[j]},${data[j + 1]},${data[j + 2]})`); }
    if (colorFn) col = colorFn(x, y, r);
    setPoint(s, i, x, y, z, size * (1 + (r() - 0.5) * 2 * sizeJitter), col, alpha * r.range(0.65, 1));
  }
  s.meta.aspect = W / H;
  s.meta.height = width * H / W;
  return s;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/** Точки внутри SVG-пути (строка d). viewBox: [ширина, высота]. */
export function fromPath(count, d, { viewBox = [100, 100], res = 640, fillRule = 'evenodd', ...opts } = {}) {
  const [vw, vh] = viewBox;
  const k = res / Math.max(vw, vh);
  const cnv = makeCanvas(vw * k, vh * k);
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.scale(k, k);
  ctx.fillStyle = '#fff';
  const paths = Array.isArray(d) ? d : [d];
  paths.forEach((pd) => ctx.fill(new Path2D(pd), fillRule));
  return fromCanvas(count, cnv, opts);
}

/** Точки по тексту (шрифт должен быть загружен — см. fontsReady()). */
export function fromText(count, text, { font = '800 200px Unbounded', lineHeight = 1.05, letterSpacing = 0, ...opts } = {}) {
  const lines = String(text).split('\n');
  const probe = makeCanvas(8, 8).getContext('2d');
  probe.font = font;
  const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 200);
  const widths = lines.map((l) => probe.measureText(l).width + letterSpacing * l.length);
  const W = Math.max(...widths) + size * 0.3, H = size * lineHeight * lines.length + size * 0.3;
  const cnv = makeCanvas(W, H);
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if ('letterSpacing' in ctx && letterSpacing) ctx.letterSpacing = letterSpacing + 'px';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, size * 0.15 + size * lineHeight * (i + 0.5)));
  return fromCanvas(count, cnv, opts);
}

/** Точки на поверхности геометрии (MeshSurfaceSampler). */
export function fromGeometry(count, geometry, { color: c = PAL.white, colorFn = null, size = 1, alpha = 1, seed = 13 } = {}) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const sampler = new MeshSurfaceSampler(mesh);
  const r = rng(seed);
  sampler.setRandomGenerator(r);
  sampler.build();
  const s = createShape(count);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(v, n);
    setPoint(s, i, v.x, v.y, v.z, size * r.range(0.6, 1.3), colorFn ? colorFn(v, n, r) : c, alpha * r.range(0.6, 1));
  }
  mesh.material.dispose();
  return s;
}

// ---------- Логотип ---------------------------------------------------------------

let markCache = null;
/** Загрузить путь знака логотипа: { d, w, h }. */
export function loadMark() {
  if (!markCache) {
    markCache = fetch(new URL('../../assets/logo/mark.svg', import.meta.url))
      .then((r) => r.text())
      .then((t) => {
        const vb = t.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
        const d = t.match(/ d="([^"]+)"/)[1];
        return { d, w: vb[2], h: vb[3] };
      })
      .catch((err) => { markCache = null; throw err; });
  }
  return markCache;
}

/** Знак логотипа из частиц (нужно заранее: const mark = await loadMark()). */
export function logo(count, mark, { width = 6, depth = 0.5, ...opts } = {}) {
  return fromPath(count, mark.d, { viewBox: [mark.w, mark.h], width, depth, ...opts });
}
