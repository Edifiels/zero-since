// Процедурные рисунки кошки (для облака частиц): силуэт сидящей кошки в профиль и мордочка анфас из штрихов.
// Мордочка задана ломаными (контур головы с ушами, глаза, зрачки, нос, рот, усы) — по ним считаются
// и точки контуров, и направления касательных (куда «садятся» фильтры свёрточной сети).
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }); // контекст с быстрым чтением (fromCanvas читает пиксели)
  return c;
}

/** Силуэт сидящей кошки, смотрит вправо. Холст 512×640, белым по прозрачному. */
export function catSideCanvas() {
  const c = canvas(512, 640);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
  // туловище с бедром и наклонённая вперёд грудь
  ell(226, 478, 108, 118);
  ell(292, 372, 66, 128, 0.42);
  // голова и мордочка
  ell(350, 222, 64, 60);
  ell(400, 244, 33, 24);
  // уши
  poly([[300, 190], [306, 112], [344, 160]]);
  poly([[342, 162], [384, 102], [398, 190]]);
  // передняя лапа (плавно выходит из груди)
  g.beginPath();
  g.moveTo(296, 404);
  g.quadraticCurveTo(352, 360, 360, 420);
  g.quadraticCurveTo(368, 500, 372, 588);
  g.lineTo(328, 592);
  g.quadraticCurveTo(320, 500, 296, 404);
  g.closePath();
  g.fill();
  ell(358, 592, 30, 12);
  // задняя лапа
  ell(266, 594, 46, 12);
  // хвост вокруг лап
  g.lineCap = 'round';
  g.lineWidth = 24;
  g.beginPath();
  g.moveTo(126, 532);
  g.bezierCurveTo(86, 618, 220, 630, 334, 612);
  g.stroke();
  return c;
}

/** Точки контура силуэта (пиксели, где непрозрачное граничит с прозрачным). */
export function silhouetteEdges(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = c;
  const d = g.getImageData(0, 0, W, H).data;
  const a = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
  const out = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a(x, y) < 128) continue;
      if (a(x - 1, y) < 128 || a(x + 1, y) < 128 || a(x, y - 1) < 128 || a(x, y + 1) < 128) out.push([x, y]);
    }
  }
  return out;
}

// ---------- Мордочка анфас (холст 512×512) ----------
const smooth = (pts, n = 6, closed = false) => {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), closed, 'centripetal');
  return c.getSpacedPoints(Math.max(8, pts.length * n)).map((v) => [v.x, v.y]);
};
const arc = (cx, cy, rx, ry, a0, a1, n = 24) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]); }
  return out;
};
const mirror = (pts) => pts.map(([x, y]) => [512 - x, y]);

let faceCache = null;
/** Штрихи мордочки: [{ pts: [[x,y],…], w: толщина, kind }] */
export function catFaceStrokes() {
  if (faceCache) return faceCache;
  const S = [];
  // контур головы с ушами (по часовой стрелке от подбородка)
  const head = [
    [256, 408], [196, 400], [146, 376], [112, 334], [98, 288], [104, 242], [118, 204],
    [126, 150], [140, 88], [182, 126], [214, 160], [256, 152], [298, 160], [330, 126], [372, 88],
    [386, 150], [394, 204], [408, 242], [414, 288], [400, 334], [366, 376], [316, 400], [256, 408],
  ];
  S.push({ pts: smooth(head, 8, false), w: 7, kind: 'head' });
  // внутренние линии ушей
  const ear = [[146, 112], [164, 146], [192, 166]];
  S.push({ pts: smooth(ear, 8), w: 5, kind: 'ear' });
  S.push({ pts: smooth(mirror(ear), 8), w: 5, kind: 'ear' });
  // глаза (миндалевидные) и зрачки-щёлки
  const eye = (cx) => [...arc(cx, 272, 36, 24, Math.PI, Math.PI * 2, 20), ...arc(cx, 272, 36, 20, 0, Math.PI, 20)];
  S.push({ pts: eye(192), w: 6, kind: 'eye' });
  S.push({ pts: eye(320), w: 6, kind: 'eye' });
  S.push({ pts: arc(192, 272, 7, 18, 0, Math.PI * 2, 24), w: 6, kind: 'pupil' });
  S.push({ pts: arc(320, 272, 7, 18, 0, Math.PI * 2, 24), w: 6, kind: 'pupil' });
  // нос и рот
  S.push({ pts: [[238, 322], [274, 322], [256, 342], [238, 322]], w: 6, kind: 'nose' });
  const mouth = smooth([[256, 342], [254, 356], [240, 368], [222, 364]], 8);
  S.push({ pts: mouth, w: 5, kind: 'mouth' });
  S.push({ pts: mirror(mouth), w: 5, kind: 'mouth' });
  // усы
  const wh = [
    [[204, 338], [140, 326], [64, 314]],
    [[204, 350], [140, 352], [60, 356]],
    [[206, 362], [146, 378], [74, 398]],
  ];
  wh.forEach((w) => { const p = smooth(w, 8); S.push({ pts: p, w: 3.5, kind: 'whisker' }); S.push({ pts: mirror(p), w: 3.5, kind: 'whisker' }); });
  faceCache = S;
  return S;
}

/** Нарисовать мордочку: strokes — линии; fill — заливка головы (полупрозрачно). Холст 512×512. */
export function catFaceCanvas({ strokes = true, fill = false, eyes = false } = {}) {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  const S = catFaceStrokes();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (fill) {
    const head = S[0].pts;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    // вырезать глаза и нос, чтобы читались
    g.globalCompositeOperation = 'destination-out';
    [192, 320].forEach((cx) => { g.beginPath(); g.ellipse(cx, 272, 38, 25, 0, 0, Math.PI * 2); g.fill(); });
    g.globalCompositeOperation = 'source-over';
  }
  if (eyes) {
    g.fillStyle = '#fff';
    [192, 320].forEach((cx) => { g.beginPath(); g.ellipse(cx, 272, 7, 18, 0, 0, Math.PI * 2); g.fill(); });
  }
  if (strokes) {
    g.strokeStyle = '#fff';
    S.forEach((s) => {
      g.lineWidth = s.w * 1.4;
      g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    });
  }
  return c;
}

/**
 * Точки на контуре головы, где касательная имеет заданный угол (в градусах, по модулю 180).
 * Возвращает [x, y] в координатах холста 512×512.
 */
export function contourPointForAngle(deg, prefer = 0) {
  const pts = catFaceStrokes()[0].pts;
  let best = null, bestScore = 1e9;
  const target = ((deg % 180) + 180) % 180;
  const cands = [];
  for (let i = 2; i < pts.length - 2; i++) {
    const [x0, y0] = pts[i - 2], [x1, y1] = pts[i + 2];
    // угол касательной в «математических» координатах (y вверх)
    let a = (Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI;
    a = ((a % 180) + 180) % 180;
    let d = Math.abs(a - target);
    d = Math.min(d, 180 - d);
    cands.push({ i, d, p: pts[i] });
  }
  cands.sort((u, v) => u.d - v.d);
  // несколько лучших — берём prefer-й, разнесённый по контуру
  const picked = [];
  for (const c of cands) {
    if (c.d > 8) break;
    if (picked.every((q) => Math.abs(q.i - c.i) > pts.length * 0.12)) picked.push(c);
    if (picked.length > 3) break;
  }
  best = picked[Math.min(prefer, picked.length - 1)] || cands[0];
  bestScore = best.d;
  return { p: best.p, d: bestScore };
}
