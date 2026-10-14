// Общие помощники визуализаций части b6 («Карточный домик»).
import * as THREE from 'three';
import { createShape, setPoint, PAL } from '../../core/shapes.js';
import { rng } from '../../core/utils.js';

// ---------------------------------------------------------------------------
// «Упорядоченный» морфинг общего облака.
// У каждой частицы в шейдере облака есть псевдослучайное число rnd.x = hash42(uv*1000+0.5).x —
// оно задаёт, КОГДА частица начинает перетекать (stagger). Если раздать частицам точки формы
// в порядке этого числа, морфинг с большим stagger и линейным изингом превращается в
// пространственную ВОЛНУ (по долготе, по графу, по высоте…). Ниже — точная эмуляция хэша (float32).
// ---------------------------------------------------------------------------
const fr = Math.fround;
const fract = (x) => fr(x - Math.floor(x));
const rankCache = new Map();

/** Индексы частиц, отсортированные по моменту старта в морфинге (раньше → позже). */
export function particleOrder(count) {
  if (rankCache.has(count)) return rankCache.get(count);
  const side = Math.round(Math.sqrt(count));
  const keys = new Float32Array(count);
  const k1 = fr(0.1031), k2 = fr(0.1030), k3 = fr(0.0973), k4 = fr(0.1099), c = fr(33.33);
  for (let y = 0, i = 0; y < side; y++) {
    const v = fr(fr(y + 0.5) / side);
    const py = fr(fr(v * 1000) + 0.5);
    for (let x = 0; x < side; x++, i++) {
      const u = fr(fr(x + 0.5) / side);
      const px = fr(fr(u * 1000) + 0.5);
      let a = fract(fr(px * k1));
      let b = fract(fr(py * k2));
      let cc = fract(fr(px * k3));
      const d = fract(fr(py * k4));
      const dt = fr(fr(fr(fr(a * fr(d + c)) + fr(b * fr(cc + c))) + fr(cc * fr(a + c))) + fr(d * fr(b + c)));
      a = fr(a + dt); b = fr(b + dt); cc = fr(cc + dt);
      keys[i] = fract(fr(fr(a + b) * cc));
    }
  }
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  idx.sort((p, q) => keys[p] - keys[q]);
  rankCache.set(count, idx);
  return idx;
}

/**
 * Переставить точки формы так, чтобы точка с k-м по величине ключом досталась частице,
 * стартующей k-й. keys — Float32Array(count) (меньше → раньше).
 */
export function orderShape(shape, keys) {
  const n = shape.count;
  const order = particleOrder(n);
  const src = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = i;
  src.sort((p, q) => keys[p] - keys[q]);
  const P = new Float32Array(n * 4), C = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const d = order[k] * 4, s = src[k] * 4;
    P[d] = shape.positions[s]; P[d + 1] = shape.positions[s + 1]; P[d + 2] = shape.positions[s + 2]; P[d + 3] = shape.positions[s + 3];
    C[d] = shape.colors[s]; C[d + 1] = shape.colors[s + 1]; C[d + 2] = shape.colors[s + 2]; C[d + 3] = shape.colors[s + 3];
  }
  shape.positions = P;
  shape.colors = C;
  return shape;
}

/** Копия формы с другими цветами: fn(i, [r,g,b,a]) → [r,g,b,a] (позиции те же — для «волн» цвета). */
export function recolorShape(shape, fn) {
  const out = { count: shape.count, positions: shape.positions, colors: new Float32Array(shape.colors.length), meta: { ...shape.meta, equalized: false } };
  const c = [0, 0, 0, 0];
  for (let i = 0; i < shape.count; i++) {
    const j = i * 4;
    c[0] = shape.colors[j]; c[1] = shape.colors[j + 1]; c[2] = shape.colors[j + 2]; c[3] = shape.colors[j + 3];
    const r = fn(i, c, shape.positions, j);
    out.colors[j] = r[0]; out.colors[j + 1] = r[1]; out.colors[j + 2] = r[2]; out.colors[j + 3] = r[3];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------
const jsonCache = new Map();
export function loadData(name) {
  if (!jsonCache.has(name)) {
    jsonCache.set(name, fetch(new URL(`../../../assets/data/${name}.json`, import.meta.url)).then((r) => r.json()));
  }
  return jsonCache.get(name);
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Фирменный халфтон: точки на сетке под 45°, радиус = f(x, y) ∈ [0..1] (доля половины шага). */
export function drawHalftone(ctx, x0, y0, w, h, step, fn, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  const s2 = step / Math.SQRT2;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const R = Math.hypot(w, h) / 2 + step;
  for (let a = -R; a <= R; a += step) {
    for (let b = -R; b <= R; b += step) {
      const x = cx + (a - b) * Math.SQRT1_2, y = cy + (a + b) * Math.SQRT1_2;
      if (x < x0 - step || x > x0 + w + step || y < y0 - step || y > y0 + h + step) continue;
      const v = fn((x - x0) / w, (y - y0) / h);
      if (v <= 0.02) continue;
      ctx.beginPath();
      ctx.arc(x, y, Math.min(1, v) * s2 * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Нарисовать знак логотипа (Path2D из loadMark()) в прямоугольник высотой h с центром (cx, cy). */
export function drawMark(ctx, mark, cx, cy, h, color) {
  if (!mark) return;
  const k = h / mark.h;
  ctx.save();
  ctx.translate(cx - (mark.w * k) / 2, cy - h / 2);
  ctx.scale(k, k);
  ctx.fillStyle = color;
  ctx.fill(mark.path || (mark.path = new Path2D(mark.d)), 'evenodd');
  ctx.restore();
}

/** Подобрать размер шрифта, чтобы текст влез в ширину. */
export function fitFont(ctx, text, weight, family, maxW, maxSize, minSize = 10) {
  let size = maxSize;
  for (; size > minSize; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

/**
 * Пиктограммы служб (одни и те же на картах домика и в узлах графа — визуальная рифма).
 * Рисуются в квадрате 100×100 с центром (cx, cy), масштаб s (px на 100 единиц).
 * kind: bank, plane, cross, tower, cart, bus, refresh, cloud, card, gov, mail, truck, box.
 */
export function drawIcon(g, kind, cx, cy, s, ink, accent, paper = null) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = 9;
  const P = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  const circle = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); };
  // «вырезы» (окна, колёсные диски): цветом бумаги или прозрачностью
  const cut = (fn) => {
    g.save();
    if (paper) g.fillStyle = paper; else g.globalCompositeOperation = 'destination-out';
    fn();
    g.restore();
  };
  switch (kind) {
    case 'bank': {
      P([[-48, -16], [0, -46], [48, -16]]); g.fill();
      g.fillStyle = accent; P([[-22, -22], [0, -36], [22, -22]]); g.fill(); g.fillStyle = ink;
      g.fillRect(-44, -12, 88, 8);
      [-32, -11, 11, 32].forEach((x) => g.fillRect(x - 5, 0, 10, 28));
      g.fillRect(-46, 32, 92, 8);
      g.fillRect(-50, 42, 100, 7);
      break;
    }
    case 'plane': {
      g.rotate(Math.PI / 4);
      g.beginPath(); g.ellipse(0, 0, 8, 48, 0, 0, Math.PI * 2); g.fill();
      P([[-50, 8], [-6, -16], [6, -16], [50, 8], [50, 18], [6, 4], [-6, 4], [-50, 18]]); g.fill();
      P([[-20, 42], [-4, 30], [4, 30], [20, 42], [20, 49], [0, 42], [-20, 49]]); g.fill();
      g.fillStyle = accent; g.beginPath(); g.ellipse(0, -30, 4, 9, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'cross': {
      g.lineWidth = 8;
      circle(0, 0, 46); g.stroke();
      g.fillStyle = accent;
      g.fillRect(-13, -34, 26, 68); g.fillRect(-34, -13, 68, 26);
      g.strokeStyle = ink; g.lineWidth = 5;
      P([[-13, -34], [13, -34], [13, -13], [34, -13], [34, 13], [13, 13], [13, 34], [-13, 34], [-13, 13], [-34, 13], [-34, -13], [-13, -13]]); g.stroke();
      break;
    }
    case 'tower': {
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(0, -18); g.lineTo(-20, 48); g.moveTo(0, -18); g.lineTo(20, 48);
      g.moveTo(-14, 26); g.lineTo(14, 26); g.moveTo(-8, 6); g.lineTo(8, 6); g.stroke();
      g.fillStyle = accent; circle(0, -24, 9); g.fill();
      g.strokeStyle = ink;
      [18, 32, 46].forEach((r, i) => {
        g.lineWidth = 8 - i;
        g.beginPath(); g.arc(0, -24, r, -Math.PI * 0.22, Math.PI * 0.22); g.stroke();
        g.beginPath(); g.arc(0, -24, r, Math.PI * 0.78, Math.PI * 1.22); g.stroke();
      });
      break;
    }
    case 'cart': {
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(-50, -36); g.lineTo(-36, -36); g.lineTo(-24, 16); g.lineTo(34, 16); g.stroke();
      g.fillStyle = accent; P([[-32, -22], [46, -22], [38, 6], [-26, 6]]); g.fill();
      g.strokeStyle = ink; g.lineWidth = 7; P([[-32, -22], [46, -22], [38, 6], [-26, 6]]); g.stroke();
      g.fillStyle = ink;
      circle(-16, 34, 9); g.fill();
      circle(28, 34, 9); g.fill();
      break;
    }
    case 'bus': {
      roundRectPath(g, -36, -46, 72, 80, 12); g.fill();
      g.fillStyle = accent; roundRectPath(g, -27, -36, 54, 30, 6); g.fill();
      cut(() => { circle(-20, 18, 7); g.fill(); circle(20, 18, 7); g.fill(); g.fillRect(-10, 14, 20, 6); });
      g.fillStyle = ink;
      g.fillRect(-32, 32, 14, 16); g.fillRect(18, 32, 14, 16);
      break;
    }
    case 'refresh': {
      g.lineWidth = 12;
      g.beginPath(); g.arc(0, 0, 36, Math.PI * 0.15, Math.PI * 0.95); g.stroke();
      g.beginPath(); g.arc(0, 0, 36, Math.PI * 1.15, Math.PI * 1.95); g.stroke();
      const head = (a) => {
        const x = Math.cos(a) * 36, y = Math.sin(a) * 36;
        const tx = -Math.sin(a), ty = Math.cos(a);
        P([[x + tx * 18, y + ty * 18], [x - ty * 16 - tx * 4, y + tx * 16 - ty * 4], [x + ty * 16 - tx * 4, y - tx * 16 - ty * 4]]);
        g.fill();
      };
      head(Math.PI * 0.95); head(Math.PI * 1.95);
      break;
    }
    case 'cloud': {
      g.beginPath();
      g.arc(-4, -8, 26, Math.PI * 0.95, Math.PI * 1.95);
      g.arc(26, 6, 18, Math.PI * 1.45, Math.PI * 0.5);
      g.lineTo(-30, 24);
      g.arc(-30, 8, 16, Math.PI * 0.5, Math.PI * 1.5);
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      g.fillRect(-26, 34, 52, 7);
      g.fillRect(-14, 44, 28, 6);
      break;
    }
    case 'card': {
      g.lineWidth = 8;
      roundRectPath(g, -46, -32, 92, 64, 9); g.stroke();
      g.fillStyle = accent; g.fillRect(-46, -18, 92, 13);
      g.fillStyle = ink;
      g.fillRect(-32, 12, 30, 8); g.fillRect(6, 12, 14, 8);
      break;
    }
    case 'gov': {
      g.lineWidth = 8;
      P([[-30, -46], [16, -46], [32, -30], [32, 46], [-30, 46]]); g.stroke();
      g.fillRect(-18, -26, 32, 7); g.fillRect(-18, -10, 36, 7); g.fillRect(-18, 6, 20, 7);
      g.fillStyle = accent; circle(18, 30, 16); g.fill();
      g.strokeStyle = ink; g.lineWidth = 6;
      g.beginPath(); g.moveTo(10, 30); g.lineTo(16, 36); g.lineTo(27, 23); g.stroke();
      break;
    }
    case 'mail': {
      g.lineWidth = 8;
      roundRectPath(g, -46, -32, 92, 64, 8); g.stroke();
      g.fillStyle = accent; P([[-40, -26], [0, 6], [40, -26]]); g.fill();
      g.beginPath(); g.moveTo(-42, -28); g.lineTo(0, 6); g.lineTo(42, -28); g.stroke();
      break;
    }
    case 'truck': {
      g.fillRect(-50, -30, 62, 46);
      P([[16, -16], [36, -16], [50, 2], [50, 16], [16, 16]]); g.fill();
      g.fillStyle = accent; P([[22, -10], [34, -10], [43, 2], [22, 2]]); g.fill();
      g.fillStyle = ink;
      circle(-30, 26, 11); g.fill();
      circle(32, 26, 11); g.fill();
      cut(() => { circle(-30, 26, 4.5); g.fill(); circle(32, 26, 4.5); g.fill(); });
      break;
    }
    case 'box': {
      const boxAt = (x, y, w, h) => {
        g.fillStyle = ink; g.fillRect(x, y, w, h);
        g.fillStyle = accent; g.fillRect(x + w / 2 - 5, y, 10, h * 0.42);
      };
      boxAt(-46, 2, 44, 42); boxAt(2, 2, 44, 42); boxAt(-22, -44, 44, 42);
      break;
    }
    default: break;
  }
  g.restore();
}

/** Текстура из canvas с правильным цветовым пространством и мипмапами. */
export function canvasTexture(cnv, { anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(cnv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------------------------------------------------------------------------
// Искры / пыль — пул точек, движение считается в вершинном шейдере (гравитация + сопротивление
// аналитически). Буферы перезаливаются только в момент выброса (участок кольцевого буфера),
// а не каждый кадр: на ANGLE/D3D11 покадровая перезаливка буферов стоит десятки миллисекунд.
// ---------------------------------------------------------------------------
const SPARK_VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aColor;
attribute vec4 aLife;   // x — момент выброса, y — длительность жизни, z — размер, w — рост к концу жизни
uniform float uTime, uClear, uScale, uOpacity, uGravity, uDrag;
varying vec4 vColor;
void main() {
  float age = uTime - aLife.x;
  float life = max(aLife.y, 0.001);
  vColor = vec4(0.0);
  if (age < 0.0 || age >= life || aLife.x < uClear || aColor.a < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float d = max(uDrag, 0.001);
  float e = exp(-d * age);
  float gd = uGravity / d;
  vec3 p = position + aVel * ((1.0 - e) / d);
  p.y += gd * age - gd * (1.0 - e) / d;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = 1.0 - age / life;
  float a = aColor.a * (k < 0.7 ? k / 0.7 : 1.0) * min(1.0, (1.0 - k) * 12.0 + 0.2);
  gl_PointSize = clamp(aLife.z * (1.0 + aLife.w * (1.0 - k)) * uScale / max(0.1, -mv.z), 0.0, 96.0);
  vColor = vec4(aColor.rgb, a * uOpacity);
}
`;
const SPARK_FRAG = /* glsl */ `
uniform float uSoft;
varying vec4 vColor;
void main() {
  if (vColor.a < 0.002) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = mix(exp(-d * d * 6.0) + (1.0 - d) * 0.2, (1.0 - d * d), uSoft) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

export class Sparks {
  /**
   * n — размер пула; opts: gravity, drag, soft (0 — искры, 1 — мягкая пыль), additive.
   * Время — собственное (update(dt) его накапливает): emit() ставит момент выброса, шейдер ведёт полёт.
   */
  constructor(n = 400, { gravity = -6, drag = 1.6, soft = 0, additive = true } = {}) {
    this.n = n;
    this.cursor = 0;
    this.time = 0;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.lif = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.lif[i * 4] = -1e6; // все слоты «давно погасли»
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aLif = new THREE.BufferAttribute(this.lif, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aLife', this.aLif);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.uniforms = {
      uTime: { value: 0 }, uClear: { value: -1e5 }, uScale: { value: 400 }, uOpacity: { value: 1 },
      uSoft: { value: soft }, uGravity: { value: gravity }, uDrag: { value: drag },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.object = new THREE.Points(g, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 12;
  }

  /** Выпустить m частиц из точки p. o: speed, spread (разброс направления вокруг dir), dir, color [r,g,b], alpha, size, life, grow, jitter */
  emit(p, m, o = {}, r = Math.random) {
    const { speed = 4, spread = 1, dir = null, color = [1, 1, 1], alpha = 1, size = 1, life = 0.8, grow = 0, jitter = 0.05 } = o;
    m = Math.min(m, this.n);
    const start = this.cursor;
    for (let k = 0; k < m; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      let dx = r() * 2 - 1, dy = r() * 2 - 1, dz = r() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      if (dir) {
        dx = dir[0] + dx * spread; dy = dir[1] + dy * spread; dz = dir[2] + dz * spread;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      const sp = speed * (0.35 + r() * 0.9);
      this.pos[i * 3] = p[0] + (r() - 0.5) * jitter;
      this.pos[i * 3 + 1] = p[1] + (r() - 0.5) * jitter;
      this.pos[i * 3 + 2] = p[2] + (r() - 0.5) * jitter;
      this.vel[i * 3] = dx * sp; this.vel[i * 3 + 1] = dy * sp; this.vel[i * 3 + 2] = dz * sp;
      this.col[i * 4] = color[0]; this.col[i * 4 + 1] = color[1]; this.col[i * 4 + 2] = color[2]; this.col[i * 4 + 3] = alpha;
      this.lif[i * 4] = this.time;
      this.lif[i * 4 + 1] = life * (0.6 + r() * 0.8);
      this.lif[i * 4 + 2] = size * (0.6 + r() * 0.8);
      this.lif[i * 4 + 3] = grow;
    }
    // перезалить только записанный участок кольца (один или два диапазона)
    const first = Math.min(m, this.n - start);
    this._range(start, first);
    if (m > first) this._range(0, m - first);
  }

  _range(start, count) {
    if (count <= 0) return;
    for (const [a, size] of [[this.aPos, 3], [this.aVel, 3], [this.aCol, 4], [this.aLif, 4]]) {
      a.addUpdateRange(start * size, count * size);
      a.needsUpdate = true;
    }
  }

  /** Погасить все частицы (без перезаливки буферов). */
  clear() {
    this.uniforms.uClear.value = this.time;
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
  }

  /** Масштаб точек по высоте экрана (как у облака частиц). */
  setScale(heightPx, fovDeg) {
    this.uniforms.uScale.value = (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5)) * 0.06;
  }
}

// ---------------------------------------------------------------------------
// Формы для облака частиц
// ---------------------------------------------------------------------------

/**
 * Фирменный «халфтон-диск» из частиц: точки на сетке под 45°, размер точек — градиент.
 * Плоскость XY (смотрит на +Z). fn(u, v) → 0..1 — «тон» в точке (u, v ∈ [-1, 1]).
 */
export function halftoneDisc(count, { radius = 5, step = 0.2, fn = null, color: col = PAL.green, accent = PAL.white, accentRatio = 0.12, alpha = 0.5, size = 1, seed = 61 } = {}) {
  const s = createShape(count), r = rng(seed);
  const pts = [];
  const R = radius;
  for (let a = -R * 1.5; a <= R * 1.5; a += step) {
    for (let b = -R * 1.5; b <= R * 1.5; b += step) {
      const x = (a - b) * Math.SQRT1_2, y = (a + b) * Math.SQRT1_2;
      const d = Math.hypot(x, y) / R;
      if (d > 1) continue;
      const v = fn ? fn(x / R, y / R, d) : 1 - d;
      if (v <= 0.03) continue;
      pts.push([x, y, v]);
    }
  }
  for (let i = 0; i < count; i++) {
    const p = pts[i < pts.length ? i : Math.floor(r() * pts.length)];
    const dup = i >= pts.length;
    const v = p[2];
    const c = r() < accentRatio ? accent : col;
    setPoint(s, i, p[0] + (dup ? r.gauss(0, step * 0.12) : 0), p[1] + (dup ? r.gauss(0, step * 0.12) : 0), (r() - 0.5) * 0.05,
      size * (0.35 + 2.4 * v) * (dup ? 0.55 : 1), c, alpha * (0.35 + 0.65 * v) * (dup ? 0.35 : 1));
  }
  s.meta.dots = pts.length;
  return s;
}

// ---------------------------------------------------------------------------
// Камера
// ---------------------------------------------------------------------------
/**
 * Поза камеры: смотреть на точку C под углами yaw/pitch (градусы) с расстояния dist;
 * offX/offY — где C окажется на экране (сдвиг от центра в долях ширины/высоты сцены 16:9).
 */
export function orbitPose(C, yawDeg, pitchDeg, dist, offX = 0, offY = 0, fov = 40, round = true) {
  const yaw = THREE.MathUtils.degToRad(yawDeg), pitch = THREE.MathUtils.degToRad(pitchDeg);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd);
  const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fov / 2)), visW = visH * 16 / 9;
  const target = new THREE.Vector3(...C).addScaledVector(right, -offX * visW).addScaledVector(up, -offY * visH);
  const pos = target.clone().addScaledVector(dir, dist);
  const r = (v) => (round ? v.toArray().map((x) => Math.round(x * 1000) / 1000) : v.toArray());
  return { pos: r(pos), target: r(target), fov };
}

/**
 * Позы из camera() ядро подгоняет под экраны уже 16:9 само (director.fitPose). Покадровый «водитель»
 * камеры (drive) ядро не подгоняет — для него вертикальный угол расширяем здесь так же, как это делает ядро:
 * по горизонтали видно столько же, сколько на 16:9.
 */
export function fitFov(fov, aspect) {
  if (!aspect || aspect >= 16 / 9 - 0.01) return fov;
  const f = THREE.MathUtils.degToRad(fov);
  return Math.min(150, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(f / 2) * (16 / 9) / aspect)));
}

/** Отдать управление браузеру (длинную инициализацию — частями, чтобы не было рывков у текущего слайда). */
export const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
