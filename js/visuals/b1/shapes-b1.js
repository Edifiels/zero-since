// Формы части b1 для облака частиц: спиральная Галактика, космическая паутина ⇄ сеть нейронов
// (на одном графе, с одинаковой раскладкой частиц — морфинг структурный), мозг со связями.
import * as THREE from 'three';
import * as S from '../../core/shapes.js';
import { rng, lerp, TAU } from '../../core/utils.js';
import { makeBuf, putPoint, copyPoint, sortIdx } from './common.js';

const { PAL } = S;

// ---------------------------------------------------------------------------
// Галактика: балдж, две главные и две слабые спиральные ветви с пылевыми прожилками,
// зелёные «туманности» (области звездообразования), диск и гало. Плоскость XZ.
// ---------------------------------------------------------------------------
export function galaxyBuf(n, { radius = 6.6, seed = 11, bright = 1, pitch = 0.4 } = {}) {
  const buf = makeBuf(n);
  const r = rng(seed);
  const R = radius;
  const r0 = 0.13 * R;
  const k = pitch;                                 // шаг логарифмической спирали (≈ 0,8 витка)
  const armAngle = (rr, arm) => arm * Math.PI + Math.log(Math.max(rr, r0) / r0) / k;
  const warm = S.color('#ffe9c4'), blue = S.color('#c7dbff'), pale = PAL.pale, white = PAL.white, mint = PAL.mint;
  const neb = S.scaleColor(S.color('#5dff6a'), 1.25);
  // центры «туманностей» вдоль ветвей
  const knots = [];
  for (let i = 0; i < 70; i++) {
    const rr = R * r.range(0.25, 0.92);
    const arm = i % 2;
    const a = armAngle(rr, arm) + r.gauss(0, 0.07) + 0.12;
    knots.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  for (let i = 0; i < n; i++) {
    const t = r();
    let x, y, z, size, c, a;
    if (t < 0.075) {
      // балдж с небольшой перемычкой
      const bar = r() < 0.2;
      x = r.gauss(0, R * (bar ? 0.15 : 0.09));
      z = r.gauss(0, R * (bar ? 0.07 : 0.09));
      const rot = 0.5, cx = x * Math.cos(rot) - z * Math.sin(rot), cz = x * Math.sin(rot) + z * Math.cos(rot);
      x = cx; z = cz;
      y = r.gauss(0, R * 0.05);
      size = r.range(0.55, 1.15);
      c = r() < 0.6 ? warm : r() < 0.6 ? pale : white;
      a = r.range(0.14, 0.32);
    } else if (t < 0.7) {
      // звёзды ветвей
      const major = r() < 0.8;
      const arm = (i % 2) + (major ? 0 : 0.5);
      let rr = R * 0.07 - Math.log(1 - r() * 0.96) * R * 0.31;
      if (rr > R * 1.02) rr = R * r.range(0.55, 1.0);
      const f = rr / R;
      const off = r.gauss(0, (major ? 0.2 : 0.32) * (1 - f * 0.35));
      const ang = armAngle(rr, arm) + off;
      x = Math.cos(ang) * rr + r.gauss(0, 0.04 * R * f);
      z = Math.sin(ang) * rr + r.gauss(0, 0.04 * R * f);
      y = r.gauss(0, R * 0.022 * (1.2 - f * 0.6));
      const kk = r();
      c = kk < 0.22 ? blue : kk < 0.3 ? mint : f > 0.6 ? S.mixColor(white, pale, f) : white;
      size = Math.pow(r(), 7) * 2.0 + 0.5;
      a = r.range(0.32, 0.7) * (1 - f * 0.3);
      // пылевые прожилки на внутренней кромке ветви
      if (off < -0.05 && off > -0.24 && f > 0.15) { a *= 0.22; c = warm; }
    } else if (t < 0.76) {
      // туманности
      const kn = knots[Math.floor(r() * knots.length)];
      x = kn[0] + r.gauss(0, 0.017 * R);
      z = kn[1] + r.gauss(0, 0.017 * R);
      y = r.gauss(0, 0.04);
      c = r() < 0.7 ? neb : pale;
      size = r.range(0.6, 1.25);
      a = r.range(0.3, 0.7);
    } else if (t < 0.95) {
      // диск
      let rr = R * 0.04 - Math.log(1 - r() * 0.97) * R * 0.3;
      if (rr > R * 1.05) rr = R * r.range(0.5, 1.0);
      const ang = r() * TAU;
      x = Math.cos(ang) * rr; z = Math.sin(ang) * rr;
      y = r.gauss(0, R * 0.03);
      c = r() < 0.5 ? white : warm;
      size = r.range(0.4, 0.8);
      a = r.range(0.1, 0.26);
    } else {
      // гало
      const [hx, hy, hz] = r.inSphere(R * 1.15);
      x = hx; y = hy * 0.55; z = hz;
      c = white;
      size = r.range(0.35, 0.8);
      a = r.range(0.06, 0.2);
    }
    putPoint(buf, i, x, y, z, size, S.scaleColor(c, bright), a);
  }
  return buf;
}

/** Повернуть точки буфера (Эйлер XYZ) и сдвинуть. */
export function transformBuf(buf, { rotation = [0, 0, 0], position = [0, 0, 0], scale = 1 } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(scale, scale, scale));
  const v = new THREE.Vector3();
  for (let i = 0; i < buf.n; i++) {
    const j = i * 4;
    v.set(buf.P[j], buf.P[j + 1], buf.P[j + 2]).applyMatrix4(m);
    buf.P[j] = v.x; buf.P[j + 1] = v.y; buf.P[j + 2] = v.z;
  }
  return buf;
}

/** Выравнивание плотности буфера (как shapes.equalize). */
export function equalizeBuf(buf, opts) {
  S.equalize({ count: buf.n, positions: buf.P, colors: buf.C, meta: {} }, opts);
  return buf;
}

// ---------------------------------------------------------------------------
// Галактика, разложенная по рангам частиц: внешние звёзды — частицам с малой задержкой
// (след ракеты снизу → края Галактики, верх следа → ядро).
// ---------------------------------------------------------------------------
export function galaxyShape(count, ranks, { unwind = 0, swirlR0 = 0.8, ...opts } = {}) {
  const buf = equalizeBuf(galaxyBuf(count, opts), { axis: 'y', cell: 0.12, target: 6.5 });
  // «раскрутка» навстречу будущему закручиванию (swirl облака поворачивает точку на phase / (R0 + r))
  if (unwind) {
    for (let i = 0; i < count; i++) {
      const j = i * 4, x = buf.P[j], z = buf.P[j + 2];
      const a = -unwind / (swirlR0 + Math.hypot(x, z));
      const c = Math.cos(a), s = Math.sin(a);
      buf.P[j] = c * x + s * z;
      buf.P[j + 2] = -s * x + c * z;
    }
  }
  const byR = sortIdx(count, (i) => -Math.hypot(buf.P[i * 4], buf.P[i * 4 + 2]));
  const s = S.createShape(count);
  for (let k = 0; k < count; k++) copyPoint(s, ranks.order[k], buf, byR[k]);
  s.meta.equalized = true;
  s.meta.axis = 'y';
  return s;
}

// ---------------------------------------------------------------------------
// Космическая паутина ⇄ сеть нейронов на одном графе
// ---------------------------------------------------------------------------
export const NET_TILT = 0.95;   // облако сети повёрнуто на этот угол вокруг X (Галактика смотрит в камеру)

export function buildNetwork(count, { seed = 5, nodes = 44, extent = 9.2, galaxy = null, ranks = null } = {}) {
  const g = S.webGraph({ seed, nodes, extent, depth: 0.55, k: 3 });
  // центральный узел («наша Галактика») — ближайший к центру; сдвигаем граф в него
  let ci = 0, best = 1e9;
  g.nodes.forEach((nd, i) => { const d = Math.hypot(nd.p[0] * 0.7, nd.p[1], nd.p[2]); if (d < best) { best = d; ci = i; } });
  const c0 = g.nodes[ci].p.slice();
  // сдвиг в центральный узел и поворот на −NET_TILT (облако частиц будет повёрнуто на +NET_TILT)
  const tc = Math.cos(NET_TILT), ts = Math.sin(NET_TILT);
  g.nodes.forEach((nd) => {
    const x = nd.p[0] - c0[0], y = nd.p[1] - c0[1], z = nd.p[2] - c0[2];
    nd.p = [x, y * tc + z * ts, -y * ts + z * tc];
  });
  const r = rng(seed + 300);
  const sc = g.extent / 9;

  const nCenter = Math.floor(count * 0.035);
  const nNodes = Math.floor(count * 0.19);
  const nEdges = Math.floor(count * 0.6);
  const nRest = count - nCenter - nNodes - nEdges;
  const web = makeBuf(count), neu = makeBuf(count);

  // кривые аксонов (для импульсов)
  const curves = g.edges.map(([a, b, dist]) => {
    const A = new THREE.Vector3(...g.nodes[a].p), B = new THREE.Vector3(...g.nodes[b].p);
    const off = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize().multiplyScalar(dist * 0.26);
    const C = A.clone().add(B).multiplyScalar(0.5).add(off);
    const crv = new THREE.QuadraticBezierCurve3(A, C, B);
    return { a, b, p0: A.toArray(), p1: C.toArray(), p2: B.toArray(), curve: crv, len: crv.getLength(), dist };
  });
  // дендриты каждого узла
  const branches = g.nodes.map((nd, ni) => {
    const list = [];
    const center = ni === ci;
    const nb = center ? 10 : 4 + Math.floor(r() * 3);
    for (let b = 0; b < nb; b++) {
      const dir = new THREE.Vector3(...r.onSphere(1));
      const len = r.range(0.6, 1.3) * sc * (center ? 1.5 : 1);
      const st = new THREE.Vector3(...nd.p);
      const mid = st.clone().addScaledVector(dir, len * 0.55).add(new THREE.Vector3(...r.onSphere(len * 0.18)));
      const end = st.clone().addScaledVector(dir, len).add(new THREE.Vector3(...r.onSphere(len * 0.3)));
      list.push(new THREE.QuadraticBezierCurve3(st, mid, end));
      if (r() < 0.75) {
        const d2 = dir.clone().add(new THREE.Vector3(...r.onSphere(0.9))).normalize();
        const e2 = mid.clone().addScaledVector(d2, len * 0.5);
        list.push(new THREE.QuadraticBezierCurve3(mid, mid.clone().lerp(e2, 0.5).add(new THREE.Vector3(...r.onSphere(len * 0.1))), e2));
      }
    }
    return list;
  });

  const v = new THREE.Vector3();
  let i = 0;
  // 1) центральный узел: мини-галактика / центральный нейрон
  const cp = g.nodes[ci].p;
  for (let k = 0; k < nCenter; k++, i++) {
    // мини-галактика (повёрнута к камере, как Галактика на прошлом слайде)
    const rr = 0.62 * Math.pow(r(), 0.8);
    const arm = k % 2;
    const ang = arm * Math.PI + Math.log(Math.max(rr, 0.06) / 0.06) / 0.42 + r.gauss(0, 0.32);
    let gx = Math.cos(ang) * rr, gz = Math.sin(ang) * rr, gy = r.gauss(0, 0.02);
    if (r() < 0.18) { gx = r.gauss(0, 0.07); gz = r.gauss(0, 0.07); gy = r.gauss(0, 0.04); }
    const yy = gy, zz = gz;
    const cc = rr < 0.12 ? S.color('#fff3dc') : r() < 0.2 ? S.scaleColor(PAL.green, 1.4) : PAL.pale;
    putPoint(web, i, cp[0] + gx, cp[1] + yy, cp[2] + zz, r.range(0.5, 1.1), S.scaleColor(cc, 1.1), r.range(0.4, 0.85));
    // центральный нейрон: тело и пышные дендриты
    if (k < nCenter * 0.3) {
      const [sx, sy, sz] = r.inSphere(0.26 * sc);
      putPoint(neu, i, cp[0] + sx, cp[1] + sy, cp[2] + sz, r.range(0.7, 1.3), r() < 0.3 ? PAL.greenHi : r() < 0.5 ? PAL.pale : PAL.green, r.range(0.45, 0.8));
    } else {
      const br = branches[ci][Math.floor(r() * branches[ci].length)];
      const tt = Math.pow(r(), 0.8);
      br.getPoint(tt, v);
      putPoint(neu, i, v.x + r.gauss(0, 0.016), v.y + r.gauss(0, 0.016), v.z + r.gauss(0, 0.016), r.range(0.4, 0.9) * (1 - tt * 0.5), PAL.mint, r.range(0.45, 0.95) * (1 - tt * 0.55));
    }
  }
  // 2) узлы: скопления галактик / тела нейронов
  const others = g.nodes.map((nd, ni) => (ni === ci ? 0 : nd.m));
  const totM = others.reduce((s, m) => s + m, 0);
  const perNode = others.map((m) => Math.floor(nNodes * m / totM));
  let used = perNode.reduce((s, x) => s + x, 0);
  for (let q = 0; used < nNodes; q = (q + 1) % perNode.length) { if (q !== ci) { perNode[q]++; used++; } }
  g.nodes.forEach((nd, ni) => {
    const rad = 0.2 * nd.m * sc;
    const sr = 0.15 * (0.7 + nd.m * 0.4) * sc;
    for (let k = 0; k < perNode[ni]; k++, i++) {
      const cw = r() < 0.3 ? PAL.bright : r() < 0.55 ? PAL.pale : PAL.mint;
      putPoint(web, i, nd.p[0] + r.gauss(0, rad), nd.p[1] + r.gauss(0, rad), nd.p[2] + r.gauss(0, rad), r.range(0.55, 1.3), cw, r.range(0.4, 0.85));
      const [sx, sy, sz] = r.inSphere(sr);
      putPoint(neu, i, nd.p[0] + sx, nd.p[1] + sy, nd.p[2] + sz, r.range(0.7, 1.3), r() < 0.3 ? PAL.greenHi : r() < 0.5 ? PAL.pale : PAL.green, r.range(0.45, 0.8));
    }
  });
  // 3) рёбра: нити / аксоны (одинаковый параметр t вдоль связи)
  const totL = curves.reduce((s, c) => s + c.dist, 0);
  const perEdge = curves.map((c) => Math.floor(nEdges * c.dist / totL));
  used = perEdge.reduce((s, x) => s + x, 0);
  for (let q = 0; used < nEdges; q = (q + 1) % perEdge.length) { perEdge[q]++; used++; }
  curves.forEach((c, ei) => {
    const A = c.p0, B = c.p2;
    const m = perEdge[ei];
    for (let k = 0; k < m; k++, i++) {
      const t = (k + r()) / m;
      const s1 = (0.05 + 0.08 * Math.sin(Math.PI * t)) * sc;
      const cw = r() < 0.55 ? PAL.mint : PAL.white;
      putPoint(web, i, lerp(A[0], B[0], t) + r.gauss(0, s1), lerp(A[1], B[1], t) + r.gauss(0, s1), lerp(A[2], B[2], t) + r.gauss(0, s1), r.range(0.45, 1.1), S.scaleColor(cw, 0.95), r.range(0.45, 0.9));
      c.curve.getPoint(t, v);
      const s2 = 0.022 * sc;
      putPoint(neu, i, v.x + r.gauss(0, s2), v.y + r.gauss(0, s2), v.z + r.gauss(0, s2), r.range(0.45, 0.9), r() < 0.7 ? PAL.green : PAL.mint, r.range(0.4, 0.85));
    }
  });
  // 4) остаток: «поле» вокруг узлов / дендриты
  const restNodes = g.nodes.map((nd, ni) => ni).filter((ni) => ni !== ci);
  for (let k = 0; k < nRest; k++, i++) {
    const ni = restNodes[k % restNodes.length];
    const nd = g.nodes[ni];
    const [dx, dy, dz] = r.onSphere(r.range(0.5, 2.6) * sc);
    putPoint(web, i, nd.p[0] + dx, nd.p[1] + dy * 0.8, nd.p[2] + dz, r.range(0.35, 0.8), r() < 0.8 ? PAL.white : PAL.mint, r.range(0.12, 0.32));
    const br = branches[ni][Math.floor(r() * branches[ni].length)];
    const tt = Math.pow(r(), 0.8);
    br.getPoint(tt, v);
    putPoint(neu, i, v.x + r.gauss(0, 0.015), v.y + r.gauss(0, 0.015), v.z + r.gauss(0, 0.015), r.range(0.35, 0.8) * (1 - tt * 0.5), PAL.mint, r.range(0.4, 0.9) * (1 - tt * 0.6));
  }

  equalizeBuf(web, { axis: 'z', cell: 0.12, target: 7 });
  equalizeBuf(neu, { axis: 'z', cell: 0.12, target: 4.5 });

  // Раскладка по частицам: если известна Галактика — подбираем частицы так, чтобы звёзды
  // «разлетались» из Галактики в ту же сторону экрана, а ядро становилось мини-галактикой.
  const perm = new Uint32Array(count);   // perm[k] = частица для пары k
  if (galaxy && ranks) {
    const P = galaxy.positions;
    // ядро Галактики (большие задержки) → центральный узел
    for (let k = 0; k < nCenter; k++) perm[k] = ranks.order[count - 1 - k];
    const angG = new Float32Array(count), angW = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      angG[k] = Math.atan2(-P[k * 4 + 2], P[k * 4]);
      angW[k] = Math.atan2(web.P[k * 4 + 1], web.P[k * 4]);
    }
    const restParts = [];
    for (let k = 0; k < count - nCenter; k++) restParts.push(ranks.order[k]);
    restParts.sort((a, b) => angG[a] - angG[b]);
    const restPairs = [];
    for (let k = nCenter; k < count; k++) restPairs.push(k);
    restPairs.sort((a, b) => angW[a] - angW[b]);
    for (let k = 0; k < restPairs.length; k++) perm[restPairs[k]] = restParts[k];
  } else {
    for (let k = 0; k < count; k++) perm[k] = k;
  }
  const webShape = S.createShape(count), neuShape = S.createShape(count);
  for (let k = 0; k < count; k++) {
    copyPoint(webShape, perm[k], web, k);
    copyPoint(neuShape, perm[k], neu, k);
  }
  webShape.meta.equalized = neuShape.meta.equalized = true;
  return {
    graph: g,
    center: ci,
    curves,
    nodes: g.nodes.map((nd) => nd.p.slice()),
    web: webShape,
    neurons: neuShape,
  };
}

/** Копия формы с изменённой яркостью/прозрачностью. */
export function tintShape(s, { alpha = 1, color = 1, sizeK = 1 } = {}) {
  const o = S.createShape(s.count);
  o.positions.set(s.positions);
  o.colors.set(s.colors);
  for (let i = 0; i < s.count; i++) {
    const j = i * 4;
    o.colors[j] *= color; o.colors[j + 1] *= color; o.colors[j + 2] *= color;
    o.colors[j + 3] *= alpha;
    o.positions[j + 3] *= sizeK;
  }
  o.meta = { ...s.meta, equalized: true };
  return o;
}

// ---------------------------------------------------------------------------
// «Млечный Путь против мозга»: Галактика слева, мозг справа
// ---------------------------------------------------------------------------
// Галактика — под вариантом «А», мозг — под вариантом «Б»; мозг правее, чтобы на шаге ответа
// строка счётчика связей (слева) не заходила на него.
export const VERSUS = {
  gal: { position: [-6.3, -2.7, 0], rotation: [1.1, 0, 0.22], radius: 3.9 },
  brain: { position: [6.95, -2.55, 0], rotY: -Math.PI / 2 + 0.38, rotX: 0.08, scale: 2.8 },
};

export function versusShapes(count) {
  const half = Math.floor(count / 2);
  const gal = equalizeBuf(galaxyBuf(half, { radius: VERSUS.gal.radius, seed: 41, pitch: 0.36 }), { axis: 'y', cell: 0.08, target: 5 });
  transformBuf(gal, { rotation: VERSUS.gal.rotation, position: VERSUS.gal.position });
  const nb = count - half;
  const br = S.brain(nb, { scale: VERSUS.brain.scale, seed: 9, ridge: S.scaleColor(PAL.pale, 0.95), groove: S.scaleColor(PAL.green, 0.55), interior: 0.04 });
  const brainBuf = { n: nb, P: br.positions, C: br.colors };
  transformBuf(brainBuf, { rotation: [VERSUS.brain.rotX, VERSUS.brain.rotY, 0], position: VERSUS.brain.position });
  equalizeBuf(brainBuf, { axis: 'z', cell: 0.1, target: 4 });
  const base = S.createShape(count), lit = S.createShape(count);
  const r = rng(5);
  for (let k = 0; k < half; k++) {
    copyPoint(base, k, gal, k);
    copyPoint(lit, k, gal, k);
    lit.colors[k * 4 + 3] *= 0.45;
  }
  for (let k = 0; k < nb; k++) {
    const i = half + k;
    copyPoint(base, i, brainBuf, k);
    copyPoint(lit, i, brainBuf, k);
    // в «загоревшемся» мозге — больше зелёного свечения
    const j = i * 4;
    base.colors[j + 3] *= 0.85;
    // «загоревшийся» мозг: сама кора приглушена и позеленела — светятся связи (линии и импульсы поверх)
    if (r() < 0.3) { lit.colors[j] = 0.2; lit.colors[j + 1] = 0.95; lit.colors[j + 2] = 0.28; }
    lit.colors[j + 3] *= 0.5;
  }
  base.meta.equalized = lit.meta.equalized = true;
  return { base, lit, brainPositions: brainBuf.P, brainCount: nb };
}

/**
 * Связи внутри мозга: дуги между точками коры, проходящие через глубину (как тракты белого вещества).
 * Возвращает { curves (для импульсов), lines: { positions, alphas, ts } }.
 */
export function brainLinks(P, n, { count = 170, seed = 13, center = [0, 0, 0], minDist = 0.7, maxDist = 2.2, sag = [0.12, 0.3] } = {}) {
  const r = rng(seed);
  const C = new THREE.Vector3(...center);
  const curves = [];
  const pos = [], al = [], ts = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  let guard = 0;
  while (curves.length < count && guard++ < count * 40) {
    const i = Math.floor(r() * n * 0.7), j = Math.floor(r() * n * 0.7);
    A.set(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]);
    B.set(P[j * 4], P[j * 4 + 1], P[j * 4 + 2]);
    const d = A.distanceTo(B);
    if (d < minDist || d > maxDist) continue;
    // дуга чуть «проседает» внутрь мозга (тракты под корой), но не через центр
    M.copy(A).add(B).multiplyScalar(0.5).lerp(C, r.range(sag[0], sag[1]));
    const crv = new THREE.QuadraticBezierCurve3(A.clone(), M.clone(), B.clone());
    curves.push({ p0: A.toArray(), p1: M.toArray(), p2: B.toArray(), len: crv.getLength(), a: -1, b: -1 });
    const order = r();
    const SEG = 18;
    for (let s = 0; s < SEG; s++) {
      crv.getPoint(s / SEG, p);
      crv.getPoint((s + 1) / SEG, q);
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      const w = Math.sin(Math.PI * (s + 0.5) / SEG);
      al.push(0.12 + 0.3 * w, 0.12 + 0.3 * w);
      const tt = order * 0.85 + (s / SEG) * 0.15;
      ts.push(tt, tt);
    }
  }
  return { curves, lines: { positions: new Float32Array(pos), alphas: new Float32Array(al), ts: new Float32Array(ts) } };
}
