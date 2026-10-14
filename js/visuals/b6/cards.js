// Карточный домик: 3D-домик из карт-сервисов, внизу — карта «Обновление».
// Состояния: 'intro' (вопрос №10 — домик справа, вид со спины) и 'fall' (шаг 0 — стоит и покачивается,
// шаг 1 — невидимая рука выдёргивает «Обновление», шаг 2 — домик складывается).
// Падение — заранее посчитанная физика твёрдых тел (гравитация, вращение, отскок и трение о пол),
// поэтому его можно проигрывать вперёд и «отматывать» назад.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { HASH } from '../../core/glsl.js';
import { rng, fontsReady } from '../../core/utils.js';
import { makeCanvas, roundRectPath, drawHalftone, drawMark, drawIcon, fitFont, canvasTexture, Sparks, halftoneDisc, orderShape, recolorShape, orbitPose, yieldFrame } from './util.js';

// ---------- Геометрия домика ----------
const W = 1.7;          // ширина карты (вдоль X)
const L = 1.05;         // длина карты (наклонная сторона «палатки»)
const T = 0.024;        // толщина
const BETA = THREE.MathUtils.degToRad(15); // наклон карт «палатки» от вертикали
const GAP = 0.22;       // зазор между палатками
const SP = W + GAP;     // шаг палаток
const TENT_H = L * Math.cos(BETA);
const TENT_D = L * Math.sin(BETA);
const ROWS = [4, 3, 2, 1];
const LEVEL = TENT_H + T;
const HOUSE_H = ROWS.length * LEVEL;
const FLOOR_Y = -2.25;  // уровень пола в мире

// Подписи передних карт палаток (ряд снизу вверх, слева направо). null — карта рубашкой вперёд.
const FACES = [
  [null, 'update', null, null],
  ['Связь', 'Магазины', 'Транспорт'],
  ['Аэропорты', 'Больницы'],
  ['Банки'],
];
const ICONS = {
  'Банки': 'bank', 'Аэропорты': 'plane', 'Больницы': 'cross', 'Связь': 'tower', 'Магазины': 'cart', 'Транспорт': 'bus', update: 'refresh',
};

// ---------- Текстуры карт ----------
const TEX_W = 768, TEX_H = Math.round(768 * L / W);
const INK = '#0b0c0b';

function cardFace(label, mark) {
  const c = makeCanvas(TEX_W, TEX_H);
  const g = c.getContext('2d');
  const isUpdate = label === 'update';
  const bg = isUpdate ? '#00e000' : '#efeee6';
  g.fillStyle = bg;
  g.fillRect(0, 0, TEX_W, TEX_H);
  // фирменный халфтон в углу
  drawHalftone(g, 0, 0, TEX_W, TEX_H, 17, (u, v) => {
    const d = Math.hypot(1 - u, 1 - v) / 1.1;
    return Math.pow(Math.max(0, 1 - d), 1.6) * 1.25;
  }, isUpdate ? 'rgba(0,70,0,.55)' : 'rgba(0,200,0,.55)');
  // рамка
  g.lineWidth = 5;
  g.strokeStyle = isUpdate ? 'rgba(0,0,0,.55)' : 'rgba(11,12,11,.28)';
  roundRectPath(g, 18, 18, TEX_W - 36, TEX_H - 36, 22);
  g.stroke();
  // «индексы» по углам — знак лаборатории
  drawMark(g, mark, 52, 64, 64, isUpdate ? INK : '#00b400');
  g.save(); g.translate(TEX_W - 52, TEX_H - 64); g.rotate(Math.PI); drawMark(g, mark, 0, 0, 64, isUpdate ? INK : '#00b400'); g.restore();
  // пиктограмма
  const text = isUpdate ? 'Обновление' : label;
  drawIcon(g, ICONS[label], TEX_W / 2, TEX_H * 0.34, 150, INK, isUpdate ? '#00e000' : '#00c800', bg);
  // подпись
  const fam = 'Unbounded';
  const size = fitFont(g, text, 800, fam, TEX_W * 0.86, 104, 40);
  g.font = `800 ${size}px ${fam}`;
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, TEX_W / 2, TEX_H * 0.76);
  return c;
}

function cardBack(mark) {
  const c = makeCanvas(TEX_W, TEX_H);
  const g = c.getContext('2d');
  g.fillStyle = '#040704';
  g.fillRect(0, 0, TEX_W, TEX_H);
  drawHalftone(g, 0, 0, TEX_W, TEX_H, 15, (u, v) => {
    const d = Math.hypot((u - 0.5) * 1.6, v - 0.5) * 1.35;
    return Math.max(0, 1 - d) * 1.15;
  }, 'rgba(0,224,0,.75)');
  g.lineWidth = 6;
  g.strokeStyle = '#00e000';
  roundRectPath(g, 20, 20, TEX_W - 40, TEX_H - 40, 22);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,.35)';
  roundRectPath(g, 34, 34, TEX_W - 68, TEX_H - 68, 16);
  g.stroke();
  // центр — знак на тёмной плашке
  g.fillStyle = 'rgba(0,0,0,.72)';
  g.beginPath(); g.ellipse(TEX_W / 2, TEX_H / 2, 112, 112, 0, 0, Math.PI * 2); g.fill();
  drawMark(g, mark, TEX_W / 2, TEX_H / 2, 170, '#f4f4ee');
  return c;
}

// Геометрия карты со скруглёнными углами: группы 0 — лицо (+Z), 1 — рубашка (−Z), 2 — торцы.
function cardGeometry(w, h, t, r = 0.075, seg = 6) {
  const shape = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x0 + w - r, y0);
  shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  shape.lineTo(x0 + w, y0 + h - r);
  shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  shape.lineTo(x0 + r, y0 + h);
  shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  let pts = shape.getPoints(seg);
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts = pts.slice(0, -1);
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], nor = [], uv = [], idx = [];
  const hz = t / 2;
  // лицо
  pts.forEach((p) => { pos.push(p.x, p.y, hz); nor.push(0, 0, 1); uv.push(p.x / w + 0.5, p.y / h + 0.5); });
  tris.forEach(([a, b, c]) => idx.push(a, b, c));
  const nFront = tris.length * 3;
  // рубашка (зеркальные U, обратный обход)
  const o1 = pts.length;
  pts.forEach((p) => { pos.push(p.x, p.y, -hz); nor.push(0, 0, -1); uv.push(0.5 - p.x / w, p.y / h + 0.5); });
  tris.forEach(([a, b, c]) => idx.push(o1 + a, o1 + c, o1 + b));
  const nBack = tris.length * 3;
  // торцы
  const o2 = pos.length / 3;
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const p = pts[i], q = pts[(i + 1) % m];
    const nx = q.y - p.y, ny = -(q.x - p.x);
    const l = Math.hypot(nx, ny) || 1;
    const b = o2 + i * 4;
    pos.push(p.x, p.y, hz, q.x, q.y, hz, q.x, q.y, -hz, p.x, p.y, -hz);
    for (let k = 0; k < 4; k++) { nor.push(nx / l, ny / l, 0); uv.push(0, 0); }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.addGroup(0, nFront, 0);
  geo.addGroup(nFront, nBack, 1);
  geo.addGroup(nFront + nBack, idx.length - nFront - nBack, 2);
  geo.computeBoundingSphere();
  return geo;
}

// ---------- Материал карт (свой свет: белые карты не «выгорают» в bloom) ----------
const CARD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CARD_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uOpacity, uRed, uGlow, uGlitch, uTime, uFlash, uErr;
uniform vec3 uKey;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${HASH}
void main() {
  vec2 uv = vUv;
  vec3 tex;
  if (uGlitch > 0.001) {
    float tt = floor(uTime * 16.0);
    float row = floor(uv.y * 18.0);
    float h = hash12(vec2(row, tt));
    if (h < uGlitch * 0.45) uv.x += (hash12(vec2(row * 1.7, tt + 3.0)) - 0.5) * 0.16 * uGlitch;
    float s = 0.014 * uGlitch;
    tex = vec3(texture2D(map, uv + vec2(s, 0.0)).r, texture2D(map, uv).g, texture2D(map, uv - vec2(s, 0.0)).b);
  } else {
    tex = texture2D(map, uv).rgb;
  }
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float lam = max(dot(n, uKey), 0.0);
  float facing = max(dot(n, v), 0.0);
  float rim = pow(clamp(1.0 - facing, 0.0, 1.0), 3.0);
  float spec = pow(clamp(dot(reflect(-uKey, n), v), 0.0, 1.0), 28.0) * 0.1;
  rim *= smoothstep(0.0, 0.3, facing);
  vec3 col = tex * (0.5 + 0.38 * lam) + spec + vec3(0.0, 0.42, 0.06) * rim * 0.35;
  // «сбой»: карты тускнеют, по краям — красный отсвет
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(lum * 0.78, lum * 0.66, lum * 0.64), uRed) + vec3(0.6, 0.04, 0.02) * (rim * 0.5 + 0.03) * uRed;
  // карта-виновник: «ошибка» — красная
  float l2 = dot(tex, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(1.0, 0.045, 0.03) * (0.32 + l2 * 0.6) * (0.75 + 0.3 * lam), uErr);
  col += tex * uGlow * (1.0 - uErr);
  col += vec3(uFlash);
  gl_FragColor = vec4(col, uOpacity);
}
`;

// ---------- Физика падения (заранее, детерминированно) ----------
function quatToMat(q, m) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy;     // столбец 0
  m[3] = xy - wz; m[4] = 1 - (xx + zz); m[5] = yz + wx;     // столбец 1
  m[6] = xz + wy; m[7] = yz - wx; m[8] = 1 - (xx + yy);     // столбец 2
}

export function simulate(bodies, { duration = 4.6, hz = 240, recHz = 60, g = 13, e = 0.22, mu = 0.55, seed = 7, releaseAll = 1.35 } = {}) {
  const r = rng(seed);
  const n = bodies.length;
  const X = new Float64Array(n * 3), V = new Float64Array(n * 3), Q = new Float64Array(n * 4), Wv = new Float64Array(n * 3);
  const held = new Uint8Array(n).fill(1), asleep = new Uint8Array(n), sleepT = new Float64Array(n);
  const releaseAt = new Float64Array(n).fill(Infinity);
  const lastPuff = new Float64Array(n).fill(-9);
  const invI = bodies.map((b) => {
    const [hx, hy, hz2] = b.half;
    const a = 2 * hx, bb = 2 * hy, c = 2 * hz2;
    return [12 / (bb * bb + c * c), 12 / (a * a + c * c), 12 / (a * a + bb * bb)];
  });
  bodies.forEach((b, i) => {
    X.set(b.pos, i * 3);
    Q.set(b.quat, i * 4);
    if (b.release0 != null) releaseAt[i] = b.release0;
  });
  const steps = Math.ceil(duration * hz);
  const dt = 1 / hz;
  const recEvery = Math.round(hz / recHz);
  const frames = Math.floor(steps / recEvery) + 1;
  const out = new Float32Array(frames * n * 7);
  const events = [];
  const m = new Float64Array(9);
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx, sy, sz]);
  // помощник: Iinv(world) * v
  const tmp = [0, 0, 0];
  const applyInvI = (i, vx, vy, vz, res) => {
    // body = R^T v
    const bx = m[0] * vx + m[1] * vy + m[2] * vz;
    const by = m[3] * vx + m[4] * vy + m[5] * vz;
    const bz = m[6] * vx + m[7] * vy + m[8] * vz;
    const ii = invI[i];
    const cx = bx * ii[0], cy = by * ii[1], cz = bz * ii[2];
    res[0] = m[0] * cx + m[3] * cy + m[6] * cz;
    res[1] = m[1] * cx + m[4] * cy + m[7] * cz;
    res[2] = m[2] * cx + m[5] * cy + m[8] * cz;
  };
  const release = (i, t) => {
    if (!held[i]) return;
    held[i] = 0;
    const b = bodies[i];
    const k = b.kick || {};
    V[i * 3] = (k.v?.[0] ?? 0) + (r() - 0.5) * 0.12;
    V[i * 3 + 1] = (k.v?.[1] ?? 0);
    V[i * 3 + 2] = (k.v?.[2] ?? 0) + (r() - 0.5) * 0.12;
    Wv[i * 3] = (k.w?.[0] ?? 0) + (r() - 0.5) * 0.5;
    Wv[i * 3 + 1] = (k.w?.[1] ?? 0) + (r() - 0.5) * 0.7;
    Wv[i * 3 + 2] = (k.w?.[2] ?? 0) + (r() - 0.5) * 0.5;
    (b.deps || []).forEach(([j, d]) => { releaseAt[j] = Math.min(releaseAt[j], t + d * (0.75 + r() * 0.5)); });
  };
  let frame = 0;
  const record = () => {
    for (let i = 0; i < n; i++) {
      const o = (frame * n + i) * 7;
      out[o] = X[i * 3]; out[o + 1] = X[i * 3 + 1]; out[o + 2] = X[i * 3 + 2];
      out[o + 3] = Q[i * 4]; out[o + 4] = Q[i * 4 + 1]; out[o + 5] = Q[i * 4 + 2]; out[o + 6] = Q[i * 4 + 3];
    }
    frame++;
  };
  record();
  for (let s = 1; s <= steps; s++) {
    const t = s * dt;
    for (let i = 0; i < n; i++) if (held[i] && (releaseAt[i] <= t || t >= releaseAll)) release(i, t);
    for (let i = 0; i < n; i++) {
      if (held[i] || asleep[i]) continue;
      const b = bodies[i];
      const i3 = i * 3;
      // гравитация и сопротивление воздуха
      V[i3 + 1] -= g * dt;
      const ld = Math.exp(-0.45 * dt), ad = Math.exp(-0.9 * dt);
      V[i3] *= ld; V[i3 + 1] *= ld; V[i3 + 2] *= ld;
      Wv[i3] *= ad; Wv[i3 + 1] *= ad; Wv[i3 + 2] *= ad;
      const q = [Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]];
      quatToMat(q, m);
      const floor = b.floor;
      let touching = false;
      // контакты с полом (импульсы в точках контакта; проникновение гасится «смещением» скорости — Баумгарте)
      for (let it = 0; it < 3; it++) {
        for (const c of corners) {
          const lx = c[0] * b.half[0], ly = c[1] * b.half[1], lz = c[2] * b.half[2];
          const rx = m[0] * lx + m[3] * ly + m[6] * lz;
          const ry = m[1] * lx + m[4] * ly + m[7] * lz;
          const rz = m[2] * lx + m[5] * ly + m[8] * lz;
          const pen = floor - (X[i3 + 1] + ry);
          if (pen < 0) continue;
          // скорость точки контакта
          const w0 = Wv[i3], w1 = Wv[i3 + 1], w2 = Wv[i3 + 2];
          let vx = V[i3] + (w1 * rz - w2 * ry);
          let vy = V[i3 + 1] + (w2 * rx - w0 * rz);
          let vz = V[i3 + 2] + (w0 * ry - w1 * rx);
          touching = true;
          const bias = Math.min(1.2, (pen * 0.2) / dt);
          if (vy >= bias) continue;
          // нормальный импульс: n = (0,1,0); r×n = (-rz, 0, rx)
          applyInvI(i, -rz, 0, rx, tmp);
          const kN = 1 + (tmp[2] * rx - tmp[0] * rz);
          const ee = vy < -0.9 ? e : 0;
          const jn = (-(1 + ee) * Math.min(vy, 0) + (bias - Math.max(vy, 0))) / kN;
          if (jn <= 0) continue;
          if (it === 0 && vy < -1.6 && t - lastPuff[i] > 0.18) {
            lastPuff[i] = t;
            events.push({ t, x: X[i3] + rx, z: X[i3 + 2] + rz, s: -vy });
          }
          V[i3 + 1] += jn;
          applyInvI(i, -rz * jn, 0, rx * jn, tmp);
          Wv[i3] += tmp[0]; Wv[i3 + 1] += tmp[1]; Wv[i3 + 2] += tmp[2];
          // трение
          const w0b = Wv[i3], w1b = Wv[i3 + 1], w2b = Wv[i3 + 2];
          vx = V[i3] + (w1b * rz - w2b * ry);
          vz = V[i3 + 2] + (w0b * ry - w1b * rx);
          const vt = Math.hypot(vx, vz);
          if (vt > 1e-5) {
            const tx = vx / vt, tz = vz / vt;
            // r×t = (ry*tz, rz*tx - rx*tz, -ry*tx)
            const cx = ry * tz, cy = rz * tx - rx * tz, cz = -ry * tx;
            applyInvI(i, cx, cy, cz, tmp);
            // (tmp × r)·t
            const ux = tmp[1] * rz - tmp[2] * ry, uz = tmp[0] * ry - tmp[1] * rx;
            const kT = 1 + (ux * tx + uz * tz);
            let jt = -vt / kT;
            const lim = mu * jn;
            if (jt < -lim) jt = -lim;
            V[i3] += jt * tx; V[i3 + 2] += jt * tz;
            applyInvI(i, cx * jt, cy * jt, cz * jt, tmp);
            Wv[i3] += tmp[0]; Wv[i3 + 1] += tmp[1]; Wv[i3 + 2] += tmp[2];
          }
        }
      }
      // карта, «застывшая» на ребре, не бывает идеально уравновешена — помогаем ей упасть плашмя
      if (touching) {
        const nx = m[6], ny = m[7], nz = m[8];
        if (Math.abs(ny) < 0.8) {
          const s = (ny >= 0 ? 1 : -1) * 7 * dt;
          Wv[i3] += -nz * s; Wv[i3 + 2] += nx * s;
        }
        // трение качения: на полу карта быстрее успокаивается
        const fd = Math.exp(-2.2 * dt);
        Wv[i3] *= fd; Wv[i3 + 1] *= fd; Wv[i3 + 2] *= fd;
      }
      // интегрирование
      X[i3] += V[i3] * dt; X[i3 + 1] += V[i3 + 1] * dt; X[i3 + 2] += V[i3 + 2] * dt;
      const wx = Wv[i3], wy = Wv[i3 + 1], wz = Wv[i3 + 2];
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const h = 0.5 * dt;
      let nx = qx + h * (wx * qw + wy * qz - wz * qy);
      let ny = qy + h * (wy * qw + wz * qx - wx * qz);
      let nz = qz + h * (wz * qw + wx * qy - wy * qx);
      let nw = qw + h * (-wx * qx - wy * qy - wz * qz);
      const ql = Math.hypot(nx, ny, nz, nw) || 1;
      nx /= ql; ny /= ql; nz /= ql; nw /= ql;
      Q[i * 4] = nx; Q[i * 4 + 1] = ny; Q[i * 4 + 2] = nz; Q[i * 4 + 3] = nw;
      // проекция из пола
      quatToMat([nx, ny, nz, nw], m);
      let minY = Infinity;
      for (const c of corners) {
        const y = m[1] * c[0] * b.half[0] + m[4] * c[1] * b.half[1] + m[7] * c[2] * b.half[2];
        if (y < minY) minY = y;
      }
      const low = X[i3 + 1] + minY;
      if (low < floor - 0.03) X[i3 + 1] += floor - 0.03 - low;
      // сон
      const sv = V[i3] ** 2 + V[i3 + 1] ** 2 + V[i3 + 2] ** 2, sw = wx * wx + wy * wy + wz * wz;
      if (low < floor + 0.03 && sv < 0.012 && sw < 0.05 && Math.abs(m[7]) > 0.8) {
        sleepT[i] += dt;
        if (sleepT[i] > 0.25) { asleep[i] = 1; V.fill(0, i3, i3 + 3); Wv.fill(0, i3, i3 + 3); }
      } else sleepT[i] = 0;
    }
    if (s % recEvery === 0) {
      record();
      // все уснули — дальше записывать нечего
      let all = true;
      for (let i = 0; i < n; i++) if (!asleep[i]) { all = false; break; }
      if (all && t > releaseAll) break;
    }
  }
  return { frames: frame, n, data: out, events, recHz, duration: (frame - 1) / recHz, asleep, held };
}

// ---------- Визуализация ----------
export default class Cards extends Visual {
  static transition = 'morph';

  async init() {
    await fontsReady();
    const mark = await S.loadMark();
    this.mark = mark;
    const R = rng(11);

    this.stage = new THREE.Group();
    this.stage.position.y = FLOOR_Y;
    this.root.add(this.stage);
    this.house = new THREE.Group();
    this.stage.add(this.house);

    // Материалы
    this.shared = {
      uRed: { value: 0 },
      uTime: { value: 0 },
      uKey: { value: new THREE.Vector3(0.45, 0.7, 0.55).normalize() },
    };
    const mkMat = (tex, extra = {}) => new THREE.ShaderMaterial({
      uniforms: {
        map: { value: tex },
        uOpacity: { value: 1 },
        uGlow: { value: 0 },
        uGlitch: { value: 0 },
        uFlash: { value: 0 },
        uErr: { value: 0 },
        uRed: this.shared.uRed,
        uTime: this.shared.uTime,
        uKey: this.shared.uKey,
        ...extra,
      },
      vertexShader: CARD_VERT,
      fragmentShader: CARD_FRAG,
      transparent: true,
    });
    const backTex = canvasTexture(cardBack(mark));
    this.backMat = mkMat(backTex);
    this.edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfd2c6').multiplyScalar(0.55), transparent: true });
    const faceTex = new Map();
    const faceMat = (label) => {
      if (!faceTex.has(label)) faceTex.set(label, mkMat(canvasTexture(cardFace(label, mark))));
      return faceTex.get(label);
    };
    await yieldFrame();
    this.geo = cardGeometry(W, L, T);

    // Раскладка домика
    this.cards = [];
    const add = (pos, rotX, face, info) => {
      const upd = face === 'update';
      const mat = upd ? mkMat(canvasTexture(cardFace('update', mark)), { uRed: { value: 0 } }) : face ? faceMat(face) : this.backMat;
      const mesh = new THREE.Mesh(this.geo, [mat, upd ? mkMat(backTex, { uRed: { value: 0 } }) : this.backMat, this.edgeMat]);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0));
      mesh.position.set(...pos);
      mesh.quaternion.copy(q);
      const card = { mesh, base: { pos: new THREE.Vector3(...pos), quat: q.clone() }, face, ...info, idx: this.cards.length };
      this.cards.push(card);
      this.house.add(mesh);
      return card;
    };
    this.tents = [];
    this.flats = [];
    ROWS.forEach((cnt, r) => {
      const y0 = r * LEVEL;
      const row = [];
      for (let i = 0; i < cnt; i++) {
        const x = (i - (cnt - 1) / 2) * SP;
        const f = add([x, y0 + TENT_H / 2, TENT_D / 2], -BETA, FACES[r][i], { kind: 'front', row: r, col: i });
        const b = add([x, y0 + TENT_H / 2, -TENT_D / 2], BETA, null, { kind: 'back', row: r, col: i });
        f.partner = b; b.partner = f;
        row.push({ f, b, x });
      }
      this.tents.push(row);
      const flats = [];
      for (let j = 0; j < cnt - 1; j++) {
        const x = (row[j].x + row[j + 1].x) / 2;
        flats.push(add([x, y0 + TENT_H + T / 2, 0], -Math.PI / 2, null, { kind: 'flat', row: r, col: j }));
      }
      this.flats.push(flats);
    });
    this.update0 = this.tents[0][1].f;
    this.update0.isUpdate = true;
    this.updMat = this.update0.mesh.material[0];
    this.updMat.uniforms.uGlow.value = 0.08;

    // «Провисание» на шаге 1: опоры вокруг пустого места чуть проседают
    this.sag = this.cards.map(() => ({ dp: new THREE.Vector3(), dq: new THREE.Quaternion() }));
    const setSag = (card, dp, axis, ang) => {
      const s = this.sag[card.idx];
      s.dp.set(...dp);
      s.dq.setFromAxisAngle(new THREE.Vector3(...axis).normalize(), ang);
    };
    setSag(this.tents[0][1].b, [0, -0.01, 0.06], [1, 0, 0], 0.07);
    setSag(this.flats[0][0], [0, -0.035, 0], [0, 0, 1], -0.03);
    setSag(this.flats[0][1], [0, -0.035, 0], [0, 0, 1], 0.03);
    [this.tents[1][0], this.tents[1][1]].forEach((t, k) => {
      setSag(t.f, [0, -0.04, 0], [0, 0, 1], k ? 0.02 : -0.02);
      setSag(t.b, [0, -0.04, 0], [0, 0, 1], k ? 0.02 : -0.02);
    });
    setSag(this.flats[1][0], [0, -0.05, 0], [0, 0, 1], -0.02);
    setSag(this.tents[2][0].f, [0, -0.05, 0], [0, 0, 1], -0.015);
    setSag(this.tents[2][0].b, [0, -0.05, 0], [0, 0, 1], -0.015);
    this.sagPose = this.cards.map((c) => {
      const s = this.sag[c.idx];
      return { pos: c.base.pos.clone().add(s.dp), quat: s.dq.clone().multiply(c.base.quat) };
    });

    // Физика: все карты, кроме «Обновления»
    this.simCards = this.cards.filter((c) => !c.isUpdate);
    const simIndex = new Map(this.simCards.map((c, i) => [c, i]));
    const x0 = this.tents[0][1].x;
    const byHeight = [...this.simCards].sort((a, b) => a.base.pos.y - b.base.pos.y);
    const floorOf = new Map(byHeight.map((c, k) => [c, 0.0012 + k * 0.0016]));
    const deps = new Map(this.simCards.map((c) => [c, []]));
    const dep = (a, b, d) => { if (a && b && !a.isUpdate && !b.isUpdate) deps.get(a).push([simIndex.get(b), d]); };
    ROWS.forEach((cnt, r) => {
      for (let i = 0; i < cnt; i++) {
        const t = this.tents[r][i];
        dep(t.f, t.b, 0.05); dep(t.b, t.f, 0.05);
        // плоские карты, лежащие на этой палатке
        [this.flats[r][i - 1], this.flats[r][i]].forEach((fl) => { if (fl) { dep(t.f, fl, 0.07); dep(t.b, fl, 0.07); } });
      }
      (this.flats[r] || []).forEach((fl, j) => {
        const up = this.tents[r + 1]?.[j];
        if (up) { dep(fl, up.f, 0.03); dep(fl, up.b, 0.03); }
        // падающая плоская карта задевает вторую опору
        [this.tents[r][j], this.tents[r][j + 1]].forEach((t) => { dep(fl, t.f, 0.24); dep(fl, t.b, 0.24); });
      });
    });
    await yieldFrame();
    const bodies = this.simCards.map((c) => {
      const p = this.sagPose[c.idx];
      const dx = c.base.pos.x - x0;
      const away = Math.sign(dx || (R() - 0.5));
      let kick;
      if (c.kind === 'flat') kick = { v: [away * 0.35, 0, 0], w: [(R() - 0.5) * 1.2, 0, -away * 1.8] };
      else kick = { v: [away * (0.25 + 0.15 * c.row), 0, (c.kind === 'front' ? 0.12 : -0.12)], w: [0, (R() - 0.5) * 1.4, -away * 0.6] };
      return {
        pos: p.pos.toArray(), quat: p.quat.toArray(), half: [W / 2, L / 2, T / 2], floor: floorOf.get(c),
        deps: deps.get(c), kick, release0: c === this.update0.partner ? 0 : null,
      };
    });
    this.simBodies = bodies;
    this.sim = simulate(bodies, { duration: 7 });
    this.simEnd = this.sim.duration;
    this.sim.events.sort((a, b) => a.t - b.t);

    // «Обновление»: путь вытаскивания
    const u = this.update0;
    this.updPath = {
      p0: u.base.pos.clone(),
      q0: u.base.quat.clone(),
      p1: u.base.pos.clone().add(new THREE.Vector3(0, 0.04, 1.35)),
      p2: new THREE.Vector3(2.15, 3.95, 0.95),
      q2: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, -0.3, -0.07)),
    };
    this.stage.add(u.mesh); // «Обновление» не качается вместе с домиком

    // Пол: мягкая тень и кольцо
    const shadowTex = (() => {
      const c = makeCanvas(256, 256);
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(0,0,0,.85)'); grd.addColorStop(0.55, 'rgba(0,0,0,.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.renderOrder = -5;
    this.stage.add(this.shadow);

    // Пыль от ударов карт о пол
    this.dust = new Sparks(700, { gravity: -0.6, drag: 2.4, soft: 0.45, additive: true });
    this.stage.add(this.dust.object);

    // Формы облака частиц (халфтон-«луна» за домиком и кольцо-пол)
    this.shapes = {};
    await yieldFrame();
    await this.buildShapes();

    // Состояние
    this.k = { pull: 0, tau: 0, sway: 1, tremble: 0, build: 1, sagK: 0 };
    this.evCursor = 0;
    this.applyPoses(0);
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const discs = {};
    const mk = (side) => {
      // side: +1 — диск за домиком для вида спереди (z<0), −1 — для вида со спины
      const yaw = side > 0 ? 0.3 : Math.PI - 0.55;
      const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const c = dir.clone().multiplyScalar(-6.2).add(new THREE.Vector3(side > 0 ? 2.4 : -2.2, FLOOR_Y + 3.6, 0));
      discs[side] = { c, n: dir };
      return S.combine(n, [
        { weight: 0.52, shape: (m) => halftoneDisc(m, {
          radius: 4.7, step: side > 0 ? 0.17 : 0.24, alpha: 0.42, size: side > 0 ? 1 : 1.5,
          fn: (u, v, d) => Math.min(1, Math.max(0, 0.15 + 0.85 * (0.5 - 0.5 * (u * 0.55 + v * 0.75)) * (1.15 - d * 0.6))),
          color: S.PAL.green, accent: S.PAL.mint, accentRatio: 0.18,
        }), position: c.toArray(), rotation: [0, yaw, 0] },
        { weight: 0.2, shape: (m) => S.ring(m, { radius: side > 0 ? 6.2 : 4.9, width: 0.55, thickness: 0.015, alpha: 0.5, accentRatio: 0.45, size: 0.8 }), position: [0, FLOOR_Y + 0.01, 0] },
        { weight: 0.1, shape: (m) => S.ring(m, { radius: side > 0 ? 8.4 : 5.9, width: 0.25, thickness: 0.01, alpha: side > 0 ? 0.35 : 0.2, accentRatio: 0.2, size: 0.6 }), position: [0, FLOOR_Y + 0.01, 0] },
        { weight: 0.18, shape: (m) => S.dust(m, { radius: 34, inner: 9, alpha: 0.2, size: 0.7 }) },
      ]);
    };
    this.shapes.back = mk(-1);
    await yieldFrame();
    // вид спереди: точки «луны» упорядочены снизу вверх — при падении она краснеет волной
    const front = mk(1);
    const P = front.positions;
    const keys = new Float32Array(n);
    const r = rng(5);
    let y0 = Infinity, y1 = -Infinity;
    const D = discs[1];
    const isDisc = (A, j) => {
      const dx = A[j] - D.c.x, dy = A[j + 1] - D.c.y, dz = A[j + 2] - D.c.z;
      return Math.abs(dx * D.n.x + dz * D.n.z) < 0.2 && dx * dx + dy * dy + dz * dz < 4.9 * 4.9;
    };
    for (let i = 0; i < n; i++) if (isDisc(P, i * 4)) { y0 = Math.min(y0, P[i * 4 + 1]); y1 = Math.max(y1, P[i * 4 + 1]); }
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      keys[i] = isDisc(P, j) ? ((P[j + 1] - y0) / (y1 - y0 + 1e-6)) * 0.92 + r() * 0.08 : r();
    }
    this.shapes.front = orderShape(front, keys);
    const red = S.PAL.red;
    await yieldFrame();
    this.shapes.frontRed = recolorShape(this.shapes.front, (i, c, pos, j) => {
      if (isDisc(pos, j)) return [red[0] * 0.95, red[1] * 1.2, red[2] * 1.2, c[3] * 0.95];
      if (Math.abs(pos[j + 1] - FLOOR_Y) < 0.3) return [c[0] * 0.9 + 0.25, c[1] * 0.35, c[2] * 0.3, c[3]];
      return c;
    });
  }

  // ---------- Камера и фон ----------
  // Позы — для 16:9; под экраны 4:3 / 16:10 ядро подгоняет их само.
  camera(state, step) {
    const C = [0, FLOOR_Y + HOUSE_H * 0.5, 0];
    // вопрос №10: домик справа от вариантов ответа, вид со спины
    if (state === 'intro') return { ...orbitPose(C, 146, 9, 11.4, 0.31, 0.02), arc: 0.3 };
    // после падения: чуть выше и дальше — видны карты на полу и «Обновление»-виновник (не обрезано краем)
    if (step >= 2) return { ...orbitPose(C, 8, 19, 9.7, 0.0, 0.0), arc: 0.1 };
    if (step === 1) return { ...orbitPose(C, 7, 9, 8.9, 0.075, -0.02), arc: 0.1 };
    return { ...orbitPose(C, 16, 9, 8.5, 0.07, 0.0), arc: 0.6, duration: 2.2 };
  }

  background(state, step) {
    if (state === 'intro') return 'left';
    return step >= 2 ? 'danger' : 'corner';
  }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.22, swirl: 0, size: 0.06, twinkle: 0.3, spring: 16, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    this.curShape = this.shapeKey(this.state, this.step);
    const orbit = !o.instant && this.state === 'intro' && o.prev && o.prev !== this;
    p.morph(this.shapes[this.curShape], { duration: o.instant ? 0.01 : 2.4, stagger: 0.55, burst: orbit ? 7 : 14 });
    if (orbit) {
      // камера облетает сцену — яркое облако предыдущего слайда, видимое сбоку, иначе «выгорает» в белое пятно
      const st = { v: 1 };
      this._dimTl = this.tl({ onComplete: () => { this._dimTl = null; } })
        .to(st, { v: 0.3, duration: 0.45, ease: 'power2.out', onUpdate: () => { p.params.opacity = st.v; } })
        .to(st, { v: 1, duration: 1.3, ease: 'power1.inOut', onUpdate: () => { p.params.opacity = st.v; } }, 1.5);
    }
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.dust.clear();
    // мгновенно привести к виду шага
    this.applyStep(this.step, { instant: true });
    // эффектное появление: карты «падают» на свои места (только при входе в начало)
    if (!o.instant && this.step === 0 && this.state === 'intro') {
      this.k.build = 0;
      this._buildTw = this.tw(this.k, { build: 1, duration: 2.4, delay: 0.25, ease: 'none' });
    } else this.k.build = 1;
    return super.enter(o);
  }

  shapeKey(state, step) { return state === 'intro' ? 'back' : step >= 2 ? 'frontRed' : 'front'; }

  /** Перетечь в форму облака для (state, step). wave — красная волна снизу вверх (при падении). */
  morphTo(key, { wave = false, delay = 0 } = {}) {
    if (this.curShape === key || !this.ownsParticles()) return;
    const prev = this.curShape;
    this.curShape = key;
    const sameSet = prev && prev !== 'back' && key !== 'back';
    if (wave) this.particles.morph(this.shapes[key], { duration: 2.8, stagger: 0.86, burst: 3, ease: 'none', delay });
    else this.particles.morph(this.shapes[key], sameSet ? { duration: 1.1, stagger: 0.3, burst: 2 } : { duration: 2.2, stagger: 0.5, burst: 10 });
  }

  setState(state, o = {}) {
    this.state = state;
    this.setStep(o.step ?? 0, o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, { instant: !!o.instant, dir: o.dir ?? 1 });
  }

  /** Привести домик к виду шага (анимированно или мгновенно). */
  applyStep(step, { instant = false } = {}) {
    const k = this.k;
    const fall = this.state === 'fall';
    const tPull = fall && step >= 1 ? 1 : 0;
    const tTau = fall && step >= 2 ? this.simEnd : 0;
    this._stepTl?.kill();
    this._buildTw?.kill();
    if (!tTau) { this._fxDelay?.kill(); this._fxDelay2?.kill(); this._fxDelay = this._fxDelay2 = null; }
    if (k.build < 1) k.build = 1;
    const key = this.shapeKey(this.state, step);
    if (key !== 'frontRed' || instant) this.morphTo(key);
    if (instant) {
      Object.assign(k, { pull: tPull, tau: tTau, sway: tTau > 0 ? 0 : tPull ? 0.25 : 1, tremble: tPull && !tTau ? 0.45 : 0, sagK: tPull && !tTau ? 1 : 0 });
      this.evCursor = this.sim.events.findIndex((e) => e.t > k.tau);
      if (this.evCursor < 0) this.evCursor = this.sim.events.length;
      this.shared.uRed.value = tTau ? 0.55 : 0;
      this.updMat.uniforms.uErr.value = tTau ? 1 : 0;
      this.updMat.uniforms.uGlitch.value = tPull ? 0.55 : 0;
      this.updMat.uniforms.uGlow.value = tPull ? 0.12 : 0.08;
      return;
    }
    const tl = this._stepTl = this.tl();
    // 1) если домик упал, а нужно назад — «перемотка»
    if (tTau === 0 && k.tau > 0) {
      const d = Math.min(1.5, 0.6 + k.tau * 0.3);
      tl.to(k, { tau: 0, duration: d, ease: 'power2.inOut', onStart: () => { this.evCursor = this.sim.events.length; } }, 0);
      tl.to(this.shared.uRed, { value: 0, duration: d * 0.8 }, 0);
      tl.to(this.updMat.uniforms.uErr, { value: 0, duration: d * 0.8 }, 0);
      tl.to(k, { sagK: tPull ? 1 : 0, tremble: tPull ? 0.45 : 0, sway: tPull ? 0.25 : 1, duration: 0.5 }, d * 0.7);
    }
    // 2) карта «Обновление»
    if (tPull !== k.pull) {
      const at = tl.duration();
      if (tPull) {
        tl.to(k, { pull: 1, duration: 1.65, ease: 'none' }, at);
        tl.to(this.updMat.uniforms.uGlitch, { value: 0.55, duration: 0.6 }, at + 0.55);
        tl.to(this.updMat.uniforms.uGlow, { value: 0.12, duration: 0.6 }, at + 0.55);
        tl.call(() => {
          this.ctx.rig.shake(0.1, 0.5);
          this.ctx.engine.pulse({ aberration: 0.7 }, 0.6);
        }, null, at + 0.42);
        tl.to(k, { sagK: 1, tremble: 0.45, sway: 0.25, duration: 0.5, ease: 'power2.out' }, at + 0.45);
      } else {
        tl.to(k, { sagK: 0, tremble: 0, sway: 1, duration: 0.6 }, at);
        tl.to(this.updMat.uniforms.uGlitch, { value: 0, duration: 0.4 }, at);
        tl.to(this.updMat.uniforms.uGlow, { value: 0.08, duration: 0.4 }, at);
        tl.to(k, { pull: 0, duration: 1.25, ease: 'power1.inOut' }, at);
      }
    }
    // 3) падение
    if (tTau > 0 && k.tau < tTau) {
      const at = tl.duration();
      this.evCursor = this.sim.events.findIndex((e) => e.t > k.tau);
      if (this.evCursor < 0) this.evCursor = this.sim.events.length;
      tl.to(k, { sway: 0, tremble: 0, duration: 0.15 }, at);
      tl.to(k, { tau: tTau, duration: (tTau - k.tau) * 1.3, ease: 'none' }, at);
      tl.to(this.shared.uRed, { value: 0.55, duration: 1.4 }, at + 0.5);
      tl.to(this.updMat.uniforms.uErr, { value: 1, duration: 0.25, ease: 'steps(4)' }, at + 0.15);
      tl.call(() => this.collapseFx(), null, at + 0.05);
      tl.call(() => this.morphTo('frontRed', { wave: true }), null, at + 0.25);
    }
    // шаг «ответа» на вопросе: домик вздрагивает
    if (this.state === 'intro' && step >= 1) {
      tl.to(k, { tremble: 0.9, duration: 0.15 }, 0).to(k, { tremble: 0, duration: 1.4, ease: 'power2.out' });
    }
  }

  collapseFx() {
    const e = this.ctx.engine;
    this.ctx.rig.shake(0.22, 1.2);
    e.pulse({ aberration: 1.4 }, 1.1);
    // отложенные эффекты отменяются, если зритель успел вернуться назад
    this._fxDelay?.kill();
    this._fxDelay2?.kill();
    this._fxDelay = this.delay(0.55, () => {
      this._fxDelay = null;
      if (this.ownsParticles()) this.particles.explode(4.2, [this.tents[0][1].x, FLOOR_Y + 0.25, 0]);
      this.ctx.rig.shake(0.16, 0.8);
    });
    // удар карт о пол — когда фон уже стал красным (волна поверх перехода «зелёный → красный» даёт жёлтое пятно)
    this._fxDelay2 = this.delay(1.45, () => {
      this._fxDelay2 = null;
      this.ctx.rig.shake(0.1, 0.6);
      this.ctx.background.surge(0.6, 1.6);
    });
  }

  exit(o = {}) {
    this.killTweens();
    if (this._dimTl) { this._dimTl = null; this.particles.setParams({ opacity: 1 }, 0.4); }
    return super.exit(o);
  }

  // ---------- Кадр ----------
  applyPoses(t) {
    const k = this.k;
    const sim = this.sim;
    const tau = Math.min(k.tau, sim.duration);
    const simOn = tau > 1e-4;
    const fi = tau * sim.recHz;
    const f0 = Math.min(sim.frames - 1, Math.floor(fi));
    const f1 = Math.min(sim.frames - 1, f0 + 1);
    const a = fi - f0;
    const d = sim.data;
    const n = sim.n;
    const qa = this._qa || (this._qa = new THREE.Quaternion());
    const qb = this._qb || (this._qb = new THREE.Quaternion());
    // сборка (появление): ряды падают на места снизу вверх
    const build = k.build;
    this.simCards.forEach((c, i) => {
      const m = c.mesh;
      if (simOn) {
        const o0 = (f0 * n + i) * 7, o1 = (f1 * n + i) * 7;
        m.position.set(d[o0] + (d[o1] - d[o0]) * a, d[o0 + 1] + (d[o1 + 1] - d[o0 + 1]) * a, d[o0 + 2] + (d[o1 + 2] - d[o0 + 2]) * a);
        qa.set(d[o0 + 3], d[o0 + 4], d[o0 + 5], d[o0 + 6]);
        qb.set(d[o1 + 3], d[o1 + 4], d[o1 + 5], d[o1 + 6]);
        m.quaternion.copy(qa).slerp(qb, a);
      } else {
        const sp = this.sagPose[c.idx], b = c.base;
        m.position.lerpVectors(b.pos, sp.pos, k.sagK);
        m.quaternion.copy(b.quat).slerp(sp.quat, k.sagK);
        if (build < 1) {
          const order = (c.row * 0.22 + (c.kind === 'flat' ? 0.12 : 0) + (c.col % 2) * 0.03);
          const kk = THREE.MathUtils.clamp((build * 1.25 - order) / 0.42, 0, 1);
          const e = 1 - Math.pow(1 - kk, 3);
          m.position.y += (1 - e) * (2.6 + c.row * 0.4);
          m.position.x += (1 - e) * (c.base.pos.x * 0.18);
          m.rotateZ((1 - e) * 0.35 * (c.col % 2 ? 1 : -1));
          m.visible = kk > 0.001;
        } else m.visible = true;
      }
    });
    // «Обновление»
    this.applyPull(k.pull, t, build);
  }

  applyPull(kp, t, build = 1) {
    const u = this.update0.mesh, P = this.updPath;
    const ease = (x) => x * x * (3 - 2 * x);
    if (kp <= 0) {
      u.position.copy(P.p0);
      u.quaternion.copy(P.q0);
      if (build < 1) {
        const kk = THREE.MathUtils.clamp((build * 1.25 - 0.0) / 0.42, 0, 1);
        const e = 1 - Math.pow(1 - kk, 3);
        u.position.y += (1 - e) * 2.6;
        u.visible = kk > 0.001;
      } else u.visible = true;
      this.followHouse(u);
      return;
    }
    u.visible = true;
    if (kp < 0.2) {
      // невидимая рука «берётся» за карту
      const w = Math.sin((kp / 0.2) * Math.PI);
      u.position.copy(P.p0);
      u.quaternion.copy(P.q0);
      u.rotateZ(Math.sin(kp * 90) * 0.035 * w);
      u.position.y += 0.02 * w;
      this.followHouse(u);
    } else if (kp < 0.42) {
      const x = (kp - 0.2) / 0.22;
      const e = x * x * x;
      u.position.lerpVectors(P.p0, P.p1, e);
      u.quaternion.copy(P.q0);
    } else {
      const x = ease((kp - 0.42) / 0.58);
      const e = 1 - Math.pow(1 - x, 2);
      u.position.lerpVectors(P.p1, P.p2, e);
      u.position.y += Math.sin(Math.PI * x) * 1.2;
      u.quaternion.copy(P.q0).slerp(P.q2, ease(Math.min(1, x * 1.3)));
      if (kp >= 0.999) {
        // парит, держится «рукой»
        u.position.y += Math.sin(t * 1.3) * 0.06;
        u.rotateZ(Math.sin(t * 0.9) * 0.025);
        u.rotateY(Math.sin(t * 0.6) * 0.04);
      }
    }
  }

  /** Пока карта в домике — она качается вместе с ним. */
  followHouse(obj) {
    const q = this._hq || (this._hq = new THREE.Quaternion());
    q.setFromEuler(this.house.rotation);
    obj.position.applyQuaternion(q).add(this.house.position);
    obj.quaternion.premultiply(q);
  }

  update(dt, t) {
    this.shared.uTime.value = t;
    const k = this.k;
    // качание домика и дрожь
    const sw = k.sway, tr = k.tremble;
    this.house.rotation.set(
      Math.sin(t * 0.83) * 0.006 * sw + Math.sin(t * 23.0) * 0.0035 * tr,
      Math.sin(t * 0.37) * 0.035 * sw,
      Math.sin(t * 1.07) * 0.009 * sw + Math.sin(t * 19.0 + 1.3) * 0.004 * tr,
    );
    this.house.position.x = Math.sin(t * 31.0) * 0.004 * tr;
    this.applyPoses(t);
    // глитч «Обновления» вспыхивает рывками
    if (k.pull >= 0.999) {
      const g = this.updMat.uniforms.uGlitch;
      g.value = 0.35 + 0.4 * Math.max(0, Math.sin(t * 2.3) * Math.sin(t * 5.1 + 1.0));
    }
    // пыль при ударах карт о пол
    const ev = this.sim.events;
    if (!this._puff) this._puff = { p: [0, 0, 0], o: { speed: 1, dir: [0, 0.3, 0], spread: 1.3, color: [0.62, 0.7, 0.62], alpha: 0.2, size: 0.9, life: 1.0, grow: 0.9 } };
    while (this.evCursor < ev.length && ev[this.evCursor].t <= k.tau) {
      const e = ev[this.evCursor++];
      const s = Math.min(1, e.s / 4);
      const lp = this._lp || (this._lp = new THREE.Vector3());
      lp.set(e.x, 0.04, e.z).applyEuler(this.house.rotation);
      const P = this._puff;
      P.p[0] = lp.x; P.p[1] = 0.05; P.p[2] = lp.z;
      P.o.speed = 1.0 + 1.8 * s;
      this.dust.emit(P.p, Math.round(8 + 22 * s), P.o);
    }
    this.dust.update(dt);
    this.dust.setScale(this.ctx.engine.height * this.ctx.engine.pixelRatio, this.ctx.camera.fov);
    // облако: лёгкое дыхание
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = Math.sin(t * 0.11) * 0.015;
    }
  }

  dispose() {
    super.dispose();
  }
}
