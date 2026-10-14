// Силуэты-формы для облака частиц (слайд «Вечный страх»):
// античный бюст, свиток, книга, калькулятор, навигатор, смартфон, окно чат-бота.
// Все формы — в локальных координатах, центр около (0, 0), высота ≈ 4–5 единиц.
import { Pts, rrEdge, rrFill, circEdge, discFill, textBlock, place, canvas, combineAsync, tick, C, S, rng, lerp, TAU } from './common.js';

const J = (r, s = 0.012) => r.gauss(0, s);
const side = (r) => (r() < 0.5 ? -1 : 1);
const lit = (k) => S.scaleColor(C.white, k);

// ---------------------------------------------------------------------------
// Бюст (профиль вправо) — силуэт на canvas, объём — по размытой карте высот
// ---------------------------------------------------------------------------
function bustPath() {
  const p = new Path2D();
  p.moveTo(180, 44);
  p.bezierCurveTo(238, 38, 290, 70, 299, 128);
  p.bezierCurveTo(302, 142, 304, 152, 298, 162);
  p.bezierCurveTo(306, 172, 322, 186, 334, 200);
  p.bezierCurveTo(342, 210, 334, 220, 322, 219);
  p.bezierCurveTo(316, 219, 312, 216, 308, 218);
  p.bezierCurveTo(318, 222, 324, 230, 318, 238);
  p.bezierCurveTo(332, 246, 334, 262, 326, 270);
  p.bezierCurveTo(338, 282, 334, 300, 322, 306);
  p.bezierCurveTo(330, 322, 320, 338, 304, 342);
  p.bezierCurveTo(302, 358, 284, 368, 268, 366);
  p.bezierCurveTo(258, 378, 238, 376, 230, 366);
  p.bezierCurveTo(232, 380, 236, 392, 246, 400);
  p.bezierCurveTo(286, 410, 330, 424, 346, 452);
  p.bezierCurveTo(350, 466, 340, 476, 326, 480);
  p.bezierCurveTo(260, 496, 140, 498, 78, 482);
  p.bezierCurveTo(60, 476, 54, 460, 62, 446);
  p.bezierCurveTo(78, 418, 104, 398, 122, 384);
  p.bezierCurveTo(128, 360, 126, 336, 118, 316);
  p.bezierCurveTo(104, 296, 90, 270, 86, 236);
  p.bezierCurveTo(80, 180, 90, 120, 116, 84);
  p.bezierCurveTo(134, 58, 154, 46, 180, 44);
  p.closePath();
  return p;
}
function pedestalPath() {
  const p = new Path2D();
  p.moveTo(170, 486); p.lineTo(230, 486); p.lineTo(240, 512); p.lineTo(160, 512); p.closePath();
  p.moveTo(128, 512); p.lineTo(272, 512); p.lineTo(264, 524); p.lineTo(136, 524); p.closePath();
  p.rect(118, 526, 164, 30);
  return p;
}
function bustDetails(g) {
  const arc = (x, y, rx, ry, rot, a0, a1) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, a0, a1); g.stroke(); };
  const q = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 4) g.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]); g.stroke(); };
  // ухо
  arc(170, 192, 15, 27, 0.12, -1.4, 2.6);
  arc(172, 194, 6, 13, 0.12, -1.2, 2.2);
  // глаз, бровь, морщины на лбу
  q([268, 170, 281, 161, 294, 168]);
  q([270, 172, 282, 178, 292, 171]);
  q([258, 150, 280, 141, 300, 150]);
  q([226, 88, 256, 80, 284, 96]);
  q([232, 108, 260, 102, 288, 116]);
  // усы, скула
  q([296, 228, 310, 222, 322, 234]);
  q([262, 214, 280, 226, 296, 226]);
  // кудри бороды
  const beard = [[300, 252], [318, 262], [282, 270], [306, 284], [322, 292], [270, 296], [292, 304], [312, 318], [258, 322], [282, 330], [300, 340], [248, 346], [272, 352], [262, 254], [244, 280]];
  beard.forEach(([x, y], i) => arc(x, y, 10, 7, 0.5 + i * 0.6, 0.3, 3.5));
  // волосы на затылке
  const hair = [[118, 140], [110, 176], [118, 214], [132, 248], [140, 160], [146, 214]];
  hair.forEach(([x, y], i) => arc(x, y, 12, 9, i * 0.8, 0.4, 3.6));
  // складки драпировки
  q([108, 404, 168, 430, 196, 478]);
  q([150, 398, 214, 420, 250, 474]);
  q([214, 410, 276, 428, 300, 470]);
  q([262, 414, 312, 432, 330, 462]);
  // профиль пьедестала
  g.beginPath(); g.moveTo(124, 540); g.lineTo(276, 540); g.stroke();
}

/** Сдвиг точек по Z по «карте высот» (размытый силуэт) — объёмный рельеф. */
function puff(shape, heightCanvas, width, depthK, both = true) {
  const W = heightCanvas.width, H = heightCanvas.height;
  const data = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const k = width / W;
  const P = shape.positions;
  const r = rng(77);
  for (let i = 0; i < shape.count; i++) {
    const j = i * 4;
    const px = Math.min(W - 1, Math.max(0, Math.round(P[j] / k + W / 2 - 0.5)));
    const py = Math.min(H - 1, Math.max(0, Math.round(-P[j + 1] / k + H / 2 - 0.5)));
    const h = data[(py * W + px) * 4 + 3] / 255;
    const s = both && r() < 0.42 ? -0.55 : 1;
    P[j + 2] = P[j + 2] * 0.5 + (h - 0.45) * depthK * s;
  }
  return shape;
}

/** Бюст строится по частям (заливка, контур, детали) с уступкой кадра между ними. */
export async function bust(count, seed = 21) {
  const W = 400, H = 560, width = 4.0;
  const path = bustPath(), ped = pedestalPath();
  const fill = canvas(W, H), line = canvas(W, H), det = canvas(W, H), hmap = canvas(W, H);
  let g = fill.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fill(path); g.fill(ped);
  g = line.getContext('2d', { willReadFrequently: true });
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke(path); g.stroke(ped);
  g = det.getContext('2d', { willReadFrequently: true });
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  bustDetails(g);
  await tick();
  g = hmap.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(26px)'; g.fillStyle = '#fff'; g.fill(path); g.fill(ped); g.filter = 'none';
  await tick();
  return combineAsync(count, [
    { weight: 0.34, shape: (m) => puff(S.fromCanvas(m, fill, { width, depth: 0.2, size: 0.75, sizeJitter: 0.3, alpha: 0.26, color: C.soft, seed }), hmap, width, 0.8) },
    { weight: 0.42, shape: (m) => puff(S.fromCanvas(m, line, { width, depth: 0.1, size: 1, alpha: 0.95, color: C.white, seed: seed + 1 }), hmap, width, 0.8, false) },
    { weight: 0.24, shape: (m) => puff(S.fromCanvas(m, det, { width, depth: 0.08, size: 0.95, alpha: 0.9, colorFn: (x, y, r) => (r() < 0.45 ? C.greenHi : C.white), seed: seed + 2 }), hmap, width, 0.8, false) },
  ]);
}

// ---------------------------------------------------------------------------
// Свиток (развёрнутый, горизонтальный)
// ---------------------------------------------------------------------------
export function scroll(count, seed = 11) {
  const b = new Pts(count, seed);
  const W2 = 2.0, H2 = 1.25;
  const zs = (x) => 0.1 * Math.sin(x * 1.7);
  const txt = textBlock({ x0: -1.7, x1: 1.7, yTop: 0.88, rows: 7, rowH: 0.29, seed: seed + 1, minW: 0.15, maxW: 0.6, gap: 0.11, thick: 0.028 });
  b.add(0.2, (r) => { const x = (r() - 0.5) * 2 * W2, y = (r() - 0.5) * 2 * H2; return [x, y, zs(x) - 0.01, 0.75, C.warm, 0.22 * r.range(0.6, 1)]; });
  b.add(0.1, (r) => { const x = (r() - 0.5) * 2 * W2, y = side(r) * H2; return [x, y + J(r), zs(x), 0.9, C.white, 0.9]; });
  b.add(0.28, (r) => { const [x, y] = txt(r); const first = y > 0.75; return [x, y, zs(x) + 0.01, first ? 1 : 0.85, first ? C.greenHi : C.white, first ? 0.7 : 0.85]; });
  b.add(0.26, (r) => {
    const sd = side(r), a = r() * TAU, R = 0.25;
    const x = sd * (W2 + 0.13) + Math.cos(a) * R, z = zs(sd * W2) + Math.sin(a) * R, y = (r() - 0.5) * 2 * 1.45;
    const k = 0.4 + 0.6 * Math.max(0, Math.sin(a + 0.5));
    return [x, y, z, 0.9, lit(k), 0.85];
  });
  b.add(0.06, (r) => { const sd = side(r), tp = side(r), a = r() * TAU, R = 0.085; return [sd * (W2 + 0.13) + Math.cos(a) * R, tp * r.range(1.45, 1.72), zs(sd * W2) + Math.sin(a) * R, 0.85, C.white, 0.85]; });
  b.add(0.05, (r) => { const sd = side(r), tp = side(r); const [dx, dy, dz] = r.onSphere(0.15); return [sd * (W2 + 0.13) + dx, tp * 1.84 + dy, zs(sd * W2) + dz, 1, C.greenHi, 0.8]; });
  return b.done();
}

// ---------------------------------------------------------------------------
// Открытая книга
// ---------------------------------------------------------------------------
export function book(count, seed = 31) {
  const b = new Pts(count, seed);
  const PW = 2.25, PH = 1.55;
  const lift = (u) => 0.6 * Math.sin(Math.min(1, u) * Math.PI * 0.62);
  const pz = (x) => lift(Math.abs(x) / PW);
  const tl = textBlock({ x0: -PW + 0.25, x1: -0.3, yTop: 1.22, rows: 10, rowH: 0.262, seed: seed + 1, minW: 0.12, maxW: 0.5, gap: 0.09, thick: 0.024 });
  const tr = textBlock({ x0: 0.3, x1: PW - 0.25, yTop: 1.22, rows: 10, rowH: 0.262, seed: seed + 2, minW: 0.12, maxW: 0.5, gap: 0.09, thick: 0.024 });
  b.add(0.19, (r) => { const x = side(r) * r() * PW, y = (r() - 0.5) * 2 * PH; return [x, y, pz(x) - 0.01, 0.75, C.warm, 0.2]; });
  b.add(0.14, (r) => {
    const sd = side(r);
    if (r() < 0.68) { const x = sd * r() * PW, y = side(r) * PH; return [x, y + J(r), pz(x), 0.9, C.white, 0.9]; }
    const y = (r() - 0.5) * 2 * PH; return [sd * PW + J(r), y, pz(PW), 0.9, C.white, 0.9];
  });
  b.add(0.3, (r) => { const [x, y] = (r() < 0.5 ? tl : tr)(r); return [x, y, pz(x) + 0.012, 0.8, C.white, 0.8]; });
  b.add(0.08, (r) => {
    const sd = side(r), k = r.int(1, 6);
    if (r() < 0.6) { const y = (r() - 0.5) * 2 * PH; return [sd * (PW - k * 0.01), y, pz(PW) - k * 0.055, 0.7, C.soft, 0.6]; }
    const x = sd * r() * PW; return [x, side(r) * PH, pz(x) - k * 0.055, 0.7, C.soft, 0.5];
  });
  b.add(0.1, (r) => {
    const [x, y] = rrEdge(r, 0, 0, 2 * PW + 0.3, 2 * PH + 0.24, 0.08);
    return [x, y, pz(x) * 0.8 - 0.42, 0.9, C.white, 0.75];
  });
  b.add(0.05, (r) => { const y = (r() - 0.5) * 2 * (PH + 0.12); return [J(r, 0.02), y, -0.36 + r() * 0.3, 0.9, C.white, 0.8]; });
  b.add(0.05, (r) => { const x = 0.34 + (r() - 0.5) * 0.16, y = lerp(PH + 0.05, -PH - 0.65, r()); return [x, y, pz(0.34) + 0.03, 0.9, C.greenHi, 0.75]; });
  const s = b.done();
  return place(s, { rotation: [-0.62, 0.18, 0.02] });
}

// ---------------------------------------------------------------------------
// Калькулятор
// ---------------------------------------------------------------------------
const SEG7 = { a: [[0, 1], [1, 1]], b: [[1, 1], [1, 0.5]], c: [[1, 0.5], [1, 0]], d: [[0, 0], [1, 0]], e: [[0, 0.5], [0, 0]], f: [[0, 1], [0, 0.5]], g: [[0, 0.5], [1, 0.5]] };
const DIG7 = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function seg7(r, d, cx, cy, w, h) {
  const segs = DIG7[d];
  const sgm = SEG7[segs[Math.floor(r() * segs.length)]];
  const t = r();
  const sx = lerp(sgm[0][0], sgm[1][0], t), sy = lerp(sgm[0][1], sgm[1][1], t);
  return [cx + (sx - 0.5) * w + J(r, 0.018), cy + (sy - 0.5) * h + J(r, 0.018)];
}

export function calculator(count, seed = 41) {
  const b = new Pts(count, seed);
  const BW = 3.0, BH = 4.4, D = 0.2;
  b.add(0.12, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.32); return [x, y, D, 1, C.white, 0.95]; });
  b.add(0.05, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.32); return [x, y, -D, 0.85, C.white, 0.5]; });
  b.add(0.03, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.32); return [x, y, (r() - 0.5) * 2 * D, 0.8, C.soft, 0.45]; });
  b.add(0.09, (r) => { const [x, y] = rrFill(r, 0, 0, BW, BH, 0.32); return [x, y, D - 0.01, 0.7, C.soft, 0.16]; });
  // дисплей
  b.add(0.05, (r) => { const [x, y] = rrEdge(r, 0, 1.45, 2.4, 0.86, 0.1); return [x, y, D + 0.02, 0.9, C.white, 0.9]; });
  b.add(0.06, (r) => { const [x, y] = rrFill(r, 0, 1.45, 2.4, 0.86, 0.1); return [x, y, D + 0.015, 0.8, C.green, 0.3]; });
  b.add(0.09, (r) => { const k = r.int(0, 3); const [x, y] = seg7(r, [1, 2, 3, 4][k], -0.66 + k * 0.48, 1.45, 0.3, 0.54); return [x, y, D + 0.03, 1, C.greenHi, 0.9]; });
  // кнопки 4×5
  const keys = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) keys.push([-0.99 + col * 0.66, 0.55 - row * 0.6, row, col]);
  b.add(0.36, (r) => {
    const [cx, cy, row, col] = keys[Math.floor(r() * keys.length)];
    const eq = row === 4 && col === 3, op = col === 3;
    if (r() < 0.62) { const [x, y] = rrEdge(r, cx, cy, 0.5, 0.44, 0.1); return [x, y, D + 0.08, 0.9, eq ? C.greenHi : C.white, 0.9]; }
    const [x, y] = rrFill(r, cx, cy, 0.5, 0.44, 0.1); return [x, y, D + 0.07, 0.75, eq ? C.green : op ? C.mint : C.soft, eq ? 0.6 : 0.28];
  });
  // символы на кнопках: «+» «−» «×» «=» в правом столбце
  b.add(0.06, (r) => {
    const row = r.int(0, 4), cx = 0.99, cy = 0.55 - row * 0.6, t = (r() - 0.5) * 0.24;
    const sym = ['×', '−', '+', '+', '='][row];
    let x = cx, y = cy;
    if (sym === '−') { x += t; }
    else if (sym === '+') { if (r() < 0.5) x += t; else y += t; }
    else if (sym === '×') { const u = side(r); x += t; y += t * u; }
    else { x += t; y += side(r) * 0.06; }
    return [x + J(r, 0.012), y + J(r, 0.012), D + 0.1, 0.9, row === 4 ? C.white : C.greenHi, 0.9];
  });
  const s = b.done();
  return place(s, { rotation: [-0.22, 0.42, 0.05] });
}

// ---------------------------------------------------------------------------
// Навигатор: карта с маршрутом и метка-«капля»
// ---------------------------------------------------------------------------
export function navigator(count, seed = 51) {
  const b = new Pts(count, seed);
  const MY = -1.5, MW = 2.7, MD = 1.7;
  const px = 1.25, pz = -0.45;
  const route = [[-2.2, 1.25], [-1.5, 0.55], [-0.55, 0.95], [0.1, 0.2], [0.6, -0.1], [px, pz]];
  const rpt = (t) => {
    const n = route.length - 1, f = Math.min(n - 1e-6, t * n), i = Math.floor(f), u = f - i;
    const a = route[i], c = route[i + 1];
    const s = u * u * (3 - 2 * u);
    return [lerp(a[0], c[0], s), lerp(a[1], c[1], s)];
  };
  b.add(0.07, (r) => { const [x, z] = rrEdge(r, 0, 0, 2 * MW, 2 * MD, 0.12); return [x, MY, z, 0.9, C.white, 0.7]; });
  b.add(0.06, (r) => { const x = (r() - 0.5) * 2 * MW, z = (r() - 0.5) * 2 * MD; return [x, MY - 0.01, z, 0.7, C.soft, 0.12]; });
  b.add(0.12, (r) => {
    const k = r();
    if (k < 0.33) { const z = [-0.9, 0.4, 1.2][r.int(0, 2)]; return [(r() - 0.5) * 2 * MW, MY, z + J(r, 0.02), 0.75, C.soft, 0.45]; }
    if (k < 0.75) { const x = [-1.7, -0.4, 0.9, 2.0][r.int(0, 3)]; return [x + J(r, 0.02), MY, (r() - 0.5) * 2 * MD, 0.75, C.soft, 0.45]; }
    const t = r(); return [lerp(-2.6, 1.0, t), MY, lerp(-1.6, 1.6, t) + J(r, 0.02), 0.75, C.soft, 0.4];
  });
  b.add(0.18, (r) => {
    const t = r();
    if ((t * 18) % 1 > 0.7) return null;
    const [x, z] = rpt(t);
    return [x + J(r, 0.035), MY + 0.02, z + J(r, 0.035), 1, r() < 0.6 ? C.greenHi : C.green, 0.85];
  });
  b.add(0.04, (r) => { const [x, z] = circEdge(r, route[0][0], route[0][1], 0.22); return [x, MY + 0.02, z, 0.95, C.white, 0.9]; });
  b.add(0.05, (r) => { const rad = r() < 0.5 ? 0.55 : 0.9; const [x, z] = circEdge(r, px, pz, rad); return [x, MY + 0.01, z, 0.8, C.mint, rad > 0.6 ? 0.35 : 0.6]; });
  b.add(0.04, (r) => { const [x, z] = discFill(r, px, pz, 0.45); return [x, MY + 0.01, z, 0.7, C.green, 0.25]; });
  // метка
  const R = 0.74, HC = 2.25;
  const cy = MY + HC;
  b.add(0.3, (r) => {
    if (r() < 0.62) {
      const [dx, dy, dz] = r.onSphere(R);
      if (dy < -0.34 * R) return null;
      const front = dz / R;
      const ry = dy / R;
      const hole = front > 0.25 && Math.hypot(dx, dy) < 0.33;
      if (hole) return [px + dx, cy + dy, pz + dz, 0.6, C.green, 0.06];
      const k = 0.55 + 0.45 * Math.max(0, 0.6 * front + 0.5 * ry);
      return [px + dx, cy + dy, pz + dz, 0.95, r() < 0.2 ? C.greenHi : lit(k), 0.9];
    }
    const t = Math.sqrt(r()), a = r() * TAU;
    const yRel = -0.34 * R, h = HC + yRel, rc = 0.94 * R;
    const y = MY + t * h, rad = t * rc;
    const k = 0.5 + 0.5 * Math.max(0, Math.sin(a));
    return [px + Math.cos(a) * rad, y, pz + Math.sin(a) * rad, 0.9, lit(k), 0.85];
  });
  b.add(0.04, (r) => { const a = r() * TAU; return [px + Math.cos(a) * 0.33, cy + Math.sin(a) * 0.33, pz + 0.7, 1, C.greenHi, 0.9]; });
  const s = b.done();
  return place(s, { position: [0.1, 0.35, 0], rotation: [0.42, -0.3, 0] });
}

// ---------------------------------------------------------------------------
// Смартфон
// ---------------------------------------------------------------------------
export function phone(count, seed = 61) {
  const b = new Pts(count, seed);
  const BW = 2.5, BH = 4.8, D = 0.13;
  b.add(0.12, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.4); return [x, y, D, 1, C.white, 0.95]; });
  b.add(0.04, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.4); return [x, y, -D, 0.85, C.white, 0.5]; });
  b.add(0.03, (r) => { const [x, y] = rrEdge(r, 0, 0, BW, BH, 0.4); return [x, y, (r() - 0.5) * 2 * D, 0.8, C.soft, 0.45]; });
  b.add(0.06, (r) => { const [x, y] = rrEdge(r, 0, 0, 2.22, 4.5, 0.28); return [x, y, D + 0.01, 0.85, C.soft, 0.6]; });
  b.add(0.07, (r) => { const [x, y] = rrFill(r, 0, 0, 2.22, 4.5, 0.28); return [x, y, D, 0.7, C.mint, 0.12]; });
  b.add(0.025, (r) => { const [x, y] = rrFill(r, 0, 2.02, 0.62, 0.17, 0.085); return [x, y, D + 0.02, 0.9, C.white, 0.9]; });
  const icons = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) icons.push([-0.75 + col * 0.5, 1.45 - row * 0.56, (row * 4 + col) % 5 === 1]);
  b.add(0.4, (r) => {
    const [cx, cy, g] = icons[Math.floor(r() * icons.length)];
    if (r() < 0.45) { const [x, y] = rrEdge(r, cx, cy, 0.37, 0.37, 0.1); return [x, y, D + 0.04, 0.9, g ? C.greenHi : C.white, 0.9]; }
    const [x, y] = rrFill(r, cx, cy, 0.37, 0.37, 0.1); return [x, y, D + 0.035, 0.8, g ? C.green : C.soft, g ? 0.55 : 0.35];
  });
  b.add(0.06, (r) => { const [x, y] = rrEdge(r, 0, -1.62, 1.95, 0.56, 0.2); return [x, y, D + 0.03, 0.85, C.soft, 0.55]; });
  b.add(0.07, (r) => { const k = r.int(0, 3); const cx = -0.69 + k * 0.46; if (r() < 0.5) { const [x, y] = rrEdge(r, cx, -1.62, 0.34, 0.34, 0.09); return [x, y, D + 0.05, 0.9, C.white, 0.9]; } const [x, y] = rrFill(r, cx, -1.62, 0.34, 0.34, 0.09); return [x, y, D + 0.045, 0.8, k === 0 ? C.green : C.soft, 0.4]; });
  b.add(0.02, (r) => { const [x, y] = rrFill(r, 0, -2.08, 0.8, 0.06, 0.03); return [x, y, D + 0.02, 0.9, C.white, 0.9]; });
  const s = b.done();
  return place(s, { rotation: [-0.08, -0.5, 0.06] });
}

// ---------------------------------------------------------------------------
// Окно чат-бота
// ---------------------------------------------------------------------------
export function chat(count, seed = 71) {
  const b = new Pts(count, seed);
  const WW = 4.9, WH = 3.9;
  b.add(0.1, (r) => { const [x, y] = rrEdge(r, 0, 0, WW, WH, 0.3); return [x, y, 0, 1, C.white, 0.95]; });
  b.add(0.06, (r) => { const [x, y] = rrFill(r, 0, 0, WW, WH, 0.3); return [x, y, -0.02, 0.7, C.soft, 0.12]; });
  b.add(0.025, (r) => [(r() - 0.5) * WW, 1.47 + J(r, 0.01), 0, 0.8, C.soft, 0.6]);
  b.add(0.03, (r) => { const k = r.int(0, 2); const [x, y] = discFill(r, -2.1 + k * 0.32, 1.7, 0.09); return [x, y, 0.01, 0.9, k === 2 ? C.greenHi : C.white, 0.85]; });
  // аватар бота с «искрой» ИИ
  b.add(0.025, (r) => { const [x, y] = circEdge(r, -1.98, 0.42, 0.3); return [x, y, 0.25, 0.9, C.greenHi, 0.85]; });
  b.add(0.025, (r) => {
    for (let k = 0; k < 30; k++) {
      const x = (r() - 0.5) * 0.44, y = (r() - 0.5) * 0.44;
      if (Math.cbrt(x * x) + Math.cbrt(y * y) < Math.cbrt(0.22 * 0.22)) return [-1.98 + x, 0.42 + y, 0.26, 0.9, C.bright, 0.9];
    }
    return null;
  });
  // реплика пользователя (справа)
  b.add(0.05, (r) => { const [x, y] = rrEdge(r, 1.08, 1.03, 1.9, 0.5, 0.2); return [x, y, 0.2, 0.9, C.white, 0.9]; });
  b.add(0.04, (r) => { const [x, y] = rrFill(r, 1.08, 1.03, 1.9, 0.5, 0.2); return [x, y, 0.19, 0.75, C.soft, 0.3]; });
  const tu = textBlock({ x0: 0.38, x1: 1.78, yTop: 1.03, rows: 1, rowH: 0.2, seed: seed + 1, minW: 0.12, maxW: 0.4, gap: 0.08, lastShort: false, thick: 0.022 });
  b.add(0.03, (r) => { const [x, y] = tu(r); return [x, y, 0.21, 0.8, C.white, 0.9]; });
  // ответ бота (слева, зелёный)
  b.add(0.07, (r) => { const [x, y] = rrEdge(r, -0.15, 0.02, 3.0, 1.12, 0.24); return [x, y, 0.32, 0.95, C.greenHi, 0.85]; });
  b.add(0.07, (r) => { const [x, y] = rrFill(r, -0.15, 0.02, 3.0, 1.12, 0.24); return [x, y, 0.31, 0.75, C.green, 0.3]; });
  const tb = textBlock({ x0: -1.45, x1: 1.15, yTop: 0.3, rows: 3, rowH: 0.27, seed: seed + 2, minW: 0.12, maxW: 0.55, gap: 0.08, thick: 0.022 });
  b.add(0.1, (r) => { const [x, y] = tb(r); return [x, y, 0.33, 0.85, C.white, 0.9]; });
  // «печатает…»
  b.add(0.04, (r) => { const [x, y] = rrEdge(r, -1.1, -0.9, 1.05, 0.42, 0.2); return [x, y, 0.22, 0.85, C.soft, 0.7]; });
  b.add(0.04, (r) => { const k = r.int(0, 2); const [x, y] = discFill(r, -1.4 + k * 0.3, -0.9, 0.08); return [x, y, 0.23, 0.95, C.greenHi, 0.9]; });
  // поле ввода и стрелка «отправить»
  b.add(0.05, (r) => { const [x, y] = rrEdge(r, -0.25, -1.55, 3.95, 0.46, 0.23); return [x, y, 0.08, 0.9, C.white, 0.75]; });
  b.add(0.03, (r) => {
    const t = r(), u = r();
    const A = [1.95, -1.55], B = [2.2, -1.42], Cc = [2.2, -1.68];
    if (u < 0.5) return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), 0.1, 0.95, C.greenHi, 0.9];
    return [lerp(A[0], Cc[0], t), lerp(A[1], Cc[1], t), 0.1, 0.95, C.greenHi, 0.9];
  });
  const s = b.done();
  return place(s, { rotation: [0.06, -0.42, 0.03] });
}

/** Все значки эпох по порядку (для финального ряда). */
export const ERA_ICONS = [scroll, book, calculator, navigator, phone, chat];
