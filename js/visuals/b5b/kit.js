// Общие помощники части b5b: «голографический» материал с фирменным халфтоном, свечение, толстые линии,
// кометные следы, ударные кольца, «текущие» трубки-связи, рисованные текстуры, управление видимостью.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALFTONE } from '../../core/glsl.js';

// ---------------------------------------------------------------------------
// Сборка фигур из примитивов в одну геометрию (один draw call).
//   build([{ g: new THREE.BoxGeometry(1,1,1), p: [x,y,z], r: [rx,ry,rz] | q: Quaternion, s: 1 | [sx,sy,sz] }, …])
// ---------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
export function build(parts) {
  const geos = parts.map(({ g, p = [0, 0, 0], r = [0, 0, 0], q = null, s = 1 }) => {
    _m4.compose(
      new THREE.Vector3(...p),
      q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
      typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
    );
    const gg = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
    gg.applyMatrix4(_m4);
    return gg;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}
/** Капсула между точками a и b (радиус r) — деталь для build(). */
export function limb(a, b, r, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = Math.max(0.001, d.length());
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return { g: new THREE.CapsuleGeometry(r, len, 4, seg), p: A.clone().add(B).multiplyScalar(0.5).toArray(), q };
}

export const HEX = { green: '#00e000', greenHi: '#00ff00', white: '#ffffff', red: '#ff3b30', orange: '#ff8a1f', mint: '#8dff7a' };
export const toColor = (c, k = 1) => (c instanceof THREE.Color ? c.clone() : new THREE.Color(c)).multiplyScalar(k);

// Общий размер ячейки халфтона (пиксели) — один uniform на все материалы части.
export const CELL = { value: 6 };
export function setCell(heightPx) { CELL.value = Math.max(4.5, heightPx / 165); }

// ---------------------------------------------------------------------------
// «Голограмма»: тёмное тело, освещённая сторона — зелёные халфтон-точки, контур — свечение.
// Поддерживает InstancedMesh (instanceMatrix, instanceColor). Прозрачность: uOpacity (общий fade) × uShow.
// vertexHead / vertexPre — свой GLSL: объявления и код, меняющий локальные p (vec4) и n (vec3) до instanceMatrix
// (так анимируются экземпляры без перезаливки instanceMatrix каждый кадр).
// ---------------------------------------------------------------------------
const holoVert = (head = '', pre = '') => /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
${head}
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  vTint = vec3(1.0);
  ${pre}
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
#ifdef USE_INSTANCING_COLOR
  vTint *= instanceColor;
#endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const HOLO_VERT = holoVert();
const HOLO_FRAG = /* glsl */ `
uniform vec3 uColor, uRim, uBase, uLight;
uniform float uOpacity, uShow, uCell, uHalftone, uRimPower, uFill, uRimK;
varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
${HALFTONE}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - ndv, uRimPower);
  float lam = clamp(dot(n, normalize(uLight)) * 0.5 + 0.5, 0.0, 1.0);
  float lit = clamp(uFill * lam * lam, 0.0, 1.0);
  float dots = halftoneDot(gl_FragCoord.xy, uCell, lit);
  vec3 fill = uColor * vTint * mix(lit, dots * 0.95, uHalftone);
  vec3 col = uBase * vTint + fill + uRim * rim * uRimK;
  gl_FragColor = vec4(col, uOpacity * uShow);
}
`;

/** Материал-«голограмма». color — цвет точек освещённой стороны, rim — свечение контура, base — тёмная заливка. */
export function holoMaterial({
  color = HEX.green, rim = HEX.white, base = '#030603', fill = 1, halftone = 1, rimPower = 2.2, rimK = 1,
  light = [0.45, 0.8, 0.55], opacity = 1, side = THREE.FrontSide, transparent = true, depthWrite = true, k = 1,
  vertexHead = '', vertexPre = '', uniforms = {},
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: toColor(color, k) },
      uRim: { value: toColor(rim) },
      uBase: { value: toColor(base) },
      uLight: { value: new THREE.Vector3(...light) },
      uOpacity: { value: opacity },
      uShow: { value: 1 },
      uCell: CELL,
      uHalftone: { value: halftone },
      uRimPower: { value: rimPower },
      uFill: { value: fill },
      uRimK: { value: rimK },
      ...uniforms,
    },
    vertexShader: vertexHead || vertexPre ? holoVert(vertexHead, vertexPre) : HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent,
    depthWrite,
    side,
  });
}

// ---------------------------------------------------------------------------
// Стекло (куб-песочница, купола): почти прозрачное, светится по краю.
// ---------------------------------------------------------------------------
const GLASS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uShow, uPower, uMin;
varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float f = pow(1.0 - ndv, uPower);
  float a = (uMin + f * 0.85) * uOpacity * uShow;
  gl_FragColor = vec4(uColor * (0.4 + f), a);
}
`;
export function glassMaterial({ color = HEX.green, k = 1, power = 2.4, min = 0.05, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: toColor(color, k) },
      uOpacity: { value: opacity },
      uShow: { value: 1 },
      uPower: { value: power },
      uMin: { value: min },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Свечение
// ---------------------------------------------------------------------------
let glowTex = null;
export function glowTexture() {
  if (glowTex && glowTex.image) return glowTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  // одна текстура на все сцены части: dispose() выгружаемой сцены (LRU) её не трогает
  glowTex.userData.shared = true;
  return glowTex;
}

/** Спрайт-свечение (аддитивный). k — яркость (>1 — через bloom). */
export function glowSprite(color = HEX.greenHi, size = 1, k = 1.6, opacity = 1) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(), color: toColor(color, k), transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

/** Светящийся (аддитивный) базовый материал. */
export function glowMaterial(color = HEX.greenHi, k = 1.6, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color: toColor(color, k), transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, ...extra,
  });
}

// ---------------------------------------------------------------------------
// Толстые линии (LineSegments2). Ширина — в CSS-пикселях; разрешение обновляется в resize().
// ---------------------------------------------------------------------------
const LINE_MATS = new Set();
const RES = new THREE.Vector2(1600, 900);
export function setLineResolution(w, h) {
  RES.set(w, h);
  LINE_MATS.forEach((m) => m.resolution.copy(RES));
}
export function lineMaterial({ color = HEX.green, k = 1.4, width = 3, opacity = 1, additive = true, dashed = false, dashSize = 0.3, gapSize = 0.2 } = {}) {
  const mat = new LineMaterial({
    color: toColor(color, k), linewidth: width, transparent: true, opacity, depthWrite: false,
    dashed, dashSize, gapSize,
  });
  if (additive) mat.blending = THREE.AdditiveBlending;
  mat.resolution.copy(RES);
  LINE_MATS.add(mat);
  mat.addEventListener('dispose', () => LINE_MATS.delete(mat));
  return mat;
}
/** positions — плоский массив пар точек [x1,y1,z1, x2,y2,z2, …]. */
export function fatLines(positions, opts = {}) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(positions);
  const l = new LineSegments2(geo, lineMaterial(opts));
  if (opts.dashed) l.computeLineDistances();
  return l;
}
/** Ломаная из точек [[x,y,z], …] → пары для fatLines. */
export function polyline(points, closed = false) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) out.push(...points[i], ...points[i + 1]);
  if (closed && points.length > 2) out.push(...points[points.length - 1], ...points[0]);
  return out;
}
/** Рёбра геометрии (EdgesGeometry) → пары для fatLines. */
export function edgePairs(geometry, thresholdAngle = 1) {
  const e = new THREE.EdgesGeometry(geometry, thresholdAngle);
  const arr = Array.from(e.attributes.position.array);
  e.dispose();
  return arr;
}

// ---------------------------------------------------------------------------
// Кометный след (Points): голова — индекс 0. Размер — в мировых единицах.
// ---------------------------------------------------------------------------
const TRAIL_VERT = /* glsl */ `
attribute float aK;
uniform float uSize, uScale;
varying float vK;
void main() {
  vK = aK;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale * (1.0 - aK * 0.8) / max(0.1, -mv.z), 1.0, 90.0);
}
`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uShow, uHeadCut;
varying float vK;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float cut = uHeadCut > 0.0 ? smoothstep(0.0, uHeadCut, vK) : 1.0;
  float a = exp(-d * d * 4.5) * (1.0 - vK) * (1.0 - vK) * cut * uOpacity * uShow;
  gl_FragColor = vec4(uColor, a);
}
`;
export class Trail {
  /** headCut — доля «хвоста» у головы, которая не рисуется (чтобы след не засвечивал сам летящий объект). */
  constructor(n = 40, { color = HEX.greenHi, k = 1.8, size = 0.3, scale = null, headCut = 0.0 } = {}) {
    this.n = n;
    const pos = new Float32Array(n * 3);
    const kk = new Float32Array(n);
    for (let i = 0; i < n; i++) kk[i] = i / (n - 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aK', new THREE.BufferAttribute(kk, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.uniforms = {
      uColor: { value: toColor(color, k) },
      uSize: { value: size },
      uScale: scale || { value: 600 },
      uOpacity: { value: 1 },
      uShow: { value: 1 },
      uHeadCut: { value: headCut },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.attr = g.attributes.position;
  }
  reset(p) {
    const a = this.attr.array;
    for (let i = 0; i < this.n; i++) { a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z; }
    this.attr.needsUpdate = true;
  }
  push(p) {
    const a = this.attr.array;
    a.copyWithin(3, 0, (this.n - 1) * 3);
    a[0] = p.x; a[1] = p.y; a[2] = p.z;
    this.attr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Ударное кольцо (плоскость): uT 0→1 — расширение и угасание.
// ---------------------------------------------------------------------------
const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uShow, uT, uWidth;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float w = uWidth * (0.6 + uT);
  float d = (r - uT) / w;
  float ring = exp(-d * d);
  float inner = (1.0 - smoothstep(0.0, uT + 0.001, r)) * 0.18;
  float a = (ring + inner) * (1.0 - uT) * uOpacity * uShow;
  gl_FragColor = vec4(uColor, a);
}
`;
export function shockRing(color = HEX.greenHi, k = 2, size = 4, width = 0.07) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: toColor(color, k) }, uOpacity: { value: 1 }, uShow: { value: 1 }, uT: { value: 1 }, uWidth: { value: width } },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  m.visible = false;
  return m;
}

// ---------------------------------------------------------------------------
// Трубка-связь с «текущими» импульсами: uLit — доля пути, которая горит (0..1), uFlow — скорость потока.
// ---------------------------------------------------------------------------
const FLOW_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const FLOW_FRAG = /* glsl */ `
uniform vec3 uColor, uDim, uHead;
uniform float uOpacity, uShow, uLit, uTime, uFlow, uDash, uBase;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float x = vUv.x;
  float lit = 1.0 - smoothstep(uLit - 0.015, uLit + 0.001, x);
  float ph = fract(x * uDash - uTime * uFlow);
  float dash = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.45, 0.7, ph));
  float hd = (x - uLit) * 28.0;
  float head = exp(-hd * hd) * step(0.002, uLit) * (1.0 - step(0.998, uLit));
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float body = 0.35 + 0.65 * ndv;
  vec3 col = mix(uDim, uColor * (0.55 + 0.9 * dash), lit) * body + uHead * head;
  float a = (mix(uBase, 1.0, lit) * body + head) * uOpacity * uShow;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;
export function flowMaterial({ color = HEX.greenHi, k = 1.5, dim = '#1d3a1d', head = '#ffffff', headK = 3, base = 0.35, dash = 9, flow = 0.8 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: toColor(color, k) },
      uDim: { value: toColor(dim) },
      uHead: { value: toColor(head, headK) },
      uOpacity: { value: 1 },
      uShow: { value: 1 },
      uLit: { value: 0 },
      uTime: { value: 0 },
      uFlow: { value: flow },
      uDash: { value: dash },
      uBase: { value: base },
    },
    vertexShader: FLOW_VERT,
    fragmentShader: FLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------
// Видимость «своих» материалов (не ShaderMaterial): итоговая прозрачность = base × show × общий fade.
// ---------------------------------------------------------------------------
export class Fader {
  constructor() { this.items = []; }
  /** obj — Object3D (все его материалы) или материал. Возвращает «ручку» { show } для анимации. */
  add(obj, show = 1) {
    const mats = [];
    if (obj.isMaterial) mats.push(obj);
    else obj.traverse((o) => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { if (!mats.includes(mm)) mats.push(mm); }); });
    const it = { show, mats: [], objs: obj.isMaterial ? [] : [obj] };
    mats.forEach((m) => {
      if (m.uniforms?.uShow) { it.mats.push({ m, shader: true }); return; }
      m.userData.noFade = true;
      m.transparent = true;
      // ShaderMaterial без uShow (например, пенный след лодки): прозрачность — через его uOpacity
      if (m.uniforms?.uOpacity) { it.mats.push({ m, uop: true, base: m.uniforms.uOpacity.value }); return; }
      it.mats.push({ m, base: m.opacity });
    });
    this.items.push(it);
    return it;
  }
  apply(global) {
    for (const it of this.items) {
      const s = it.show;
      for (const e of it.mats) {
        if (e.shader) e.m.uniforms.uShow.value = s;
        else if (e.uop) e.m.uniforms.uOpacity.value = e.base * s * global;
        else e.m.opacity = e.base * s * global;
      }
      for (const o of it.objs) o.visible = s > 0.002;
    }
  }
}

// ---------------------------------------------------------------------------
// Рисованные текстуры
// ---------------------------------------------------------------------------
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/** Плоскость с текстурой (MeshBasic, яркость ниже порога bloom). */
export function texPlane(tex, w, h, { k = 0.82, additive = false, side = THREE.DoubleSide, depthWrite = false, depthTest = true } = {}) {
  const m = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite, depthTest, side,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.color.setScalar(k);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

// ---------------------------------------------------------------------------
// Собственное облако точек (для объектов, которые надо вращать отдельно от общего облака).
// fill(i, p, c) — заполнить позицию p = [x,y,z,size] и цвет c = [r,g,b,a].
// ---------------------------------------------------------------------------
const PTS_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uSize, uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uSize * uScale / max(0.1, -mv.z);
  vColor = aColor;
  if (px < 1.2) { vColor.a *= px / 1.2; px = 1.2; }
  gl_PointSize = min(px, 64.0);
}
`;
const PTS_FRAG = /* glsl */ `
uniform float uOpacity, uShow;
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 5.0) + (1.0 - d) * 0.2) * vColor.a * uOpacity * uShow;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;
export function pointCloud(n, fill, { size = 0.06, scale = null } = {}) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), sz = new Float32Array(n);
  const p = [0, 0, 0, 1], c = [1, 1, 1, 1];
  for (let i = 0; i < n; i++) {
    p[3] = 1; c[3] = 1;
    fill(i, p, c);
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    sz[i] = p[3];
    col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = c[3];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.computeBoundingSphere();
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uScale: scale || { value: 600 }, uOpacity: { value: 1 }, uShow: { value: 1 } },
    vertexShader: PTS_VERT, fragmentShader: PTS_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  return pts;
}

// ---------------------------------------------------------------------------
// Маска суши (Natural Earth) для глобусов из точек: isLand(lon, lat).
// ---------------------------------------------------------------------------
let landPromise = null;
export function loadLand() {
  if (!landPromise) {
    landPromise = fetch(new URL('../../../assets/data/land.json', import.meta.url))
      .then((r) => r.json())
      .then((j) => {
        const W = 1024, H = 512;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff';
        for (const poly of j.polygons) {
          g.beginPath();
          for (const ring of poly) {
            for (let i = 0; i < ring.length; i += 2) {
              const x = ((ring[i] + 180) / 360) * W, y = ((90 - ring[i + 1]) / 180) * H;
              if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.closePath();
          }
          g.fill('evenodd');
        }
        const data = g.getImageData(0, 0, W, H).data;
        return {
          isLand(lon, lat) {
            const x = ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W;
            const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
            return data[(y * W + x) * 4 + 3] > 127;
          },
        };
      })
      .catch((err) => { console.warn('[b5b] land.json', err); return { isLand: () => false }; });
  }
  return landPromise;
}
let citiesPromise = null;
/** Города Natural Earth: [[lon, lat, население], …]. */
export function loadCities() {
  if (!citiesPromise) {
    citiesPromise = fetch(new URL('../../../assets/data/cities.json', import.meta.url))
      .then((r) => r.json())
      .then((j) => j.cities.map((c) => [c[0], c[1], c[2]]))
      .catch((err) => { console.warn('[b5b] cities.json', err); return []; });
  }
  return citiesPromise;
}

/** Точка на сфере по долготе/широте (градусы). */
export function lonLat(lon, lat, R, out = [0, 0, 0]) {
  const a = THREE.MathUtils.degToRad(lon), b = THREE.MathUtils.degToRad(lat);
  out[0] = R * Math.cos(b) * Math.sin(a);
  out[1] = R * Math.sin(b);
  out[2] = R * Math.cos(b) * Math.cos(a);
  return out;
}

// Позы камеры задаются для 16:9: под экраны 4:3/16:10 их подгоняет ядро (director.fitPose)
// и само переставляет камеру при смене размера окна — своей подгонки в части нет.

/** HTML-подпись части (заголовок + подстрочник). */
export function lbl(title, sub = '', cls = '') {
  return `<div class="b5b-lbl ${cls}"><div class="b5b-lbl-t">${title}</div>${sub ? `<div class="b5b-lbl-s">${sub}</div>` : ''}</div>`;
}

/**
 * «Именованные» анимации: для каждого ключа жива только последняя. Нужны для шагов в обе стороны —
 * отложенный (delay) твин предыдущего шага иначе «воскрешает» объект после быстрого возврата назад.
 *   const kt = keyed(visual); kt.to('lock', st, { lock: 1, duration: .7, delay: 1 }); kt.fromTo(…); kt.kill('lock');
 */
export function keyed(visual) {
  const map = new Map();
  const put = (key, t) => { const p = map.get(key); if (p && p !== t) p.kill(); map.set(key, t); return t; };
  return {
    to: (key, target, vars) => { const p = map.get(key); if (p) p.kill(); return put(key, visual.tw(target, vars)); },
    fromTo: (key, target, from, to) => { const p = map.get(key); if (p) p.kill(); return put(key, visual.fromTo(target, from, to)); },
    delay: (key, sec, fn) => { const p = map.get(key); if (p) p.kill(); return put(key, visual.delay(sec, fn)); },
    kill: (key) => { const p = map.get(key); if (p) { p.kill(); map.delete(key); } },
  };
}

/** Ограниченная скорость приближения (экспоненциальное сглаживание). */
export const approach = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
