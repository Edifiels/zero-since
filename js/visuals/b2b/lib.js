// Общие помощники визуализаций части b2b («Две вселенные», вторая половина):
// толстые линии с импульсами, светящиеся точки, халфтон-сферы, текстуры, подготовка форм частиц.
//
// Соглашение: у всех материалов этих визуализаций userData.noFade = true, а общая прозрачность
// визуализации (this.opacity) передаётся в шейдеры через общий uniform uFade (объект this.fade,
// передаётся в материалы опцией fade и обновляется в update()).
// Анимация экземпляров — в вершинных шейдерах (хуки vertexHead/vertexBody): каждый кадр меняются
// только uniform'ы, буферы InstancedMesh/линий/точек заливаются один раз при построении.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { HASH, HALFTONE } from '../../core/glsl.js';
import { clamp } from '../../core/utils.js';
import { equalize } from '../../core/shapes.js';

/**
 * Довести форму частиц заранее (в init / при фоновой подготовке): выравнивание плотности, которое
 * particles.morph() иначе делает на первом показе — 65 тыс. точек ≈ 10 мс рывка прямо на клике.
 */
export function ready(shape) {
  if (shape && !shape.meta?.equalized) equalize(shape);
  return shape;
}

/**
 * Плавно перевести «фазу» obj[key] к value. Сначала убивает ВСЕ твины этого свойства
 * (включая отложенные delay) — иначе при быстрых кликах старый отложенный твин «вернёт» фазу.
 * duration 0 — мгновенно.
 */
export function phase(visual, obj, key, value, { duration = 1, delay = 0, ease = 'power2.inOut' } = {}) {
  gsap.killTweensOf(obj, key);
  if (duration <= 0 && delay <= 0) { obj[key] = value; return null; }
  return visual.tw(obj, { [key]: value, duration: Math.max(0.001, duration), delay, ease });
}

export const TAU = Math.PI * 2;
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 0 → 1 на [a, a+up], держится, 1 → 0 на [b-down, b]. */
export const window01 = (x, a, up, b, down) => Math.min(sstep(a, a + up, x), 1 - sstep(b - down, b, x));
export const bump = (x, c, w) => { const k = (x - c) / w; return Math.exp(-k * k); };
export const color = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ---------------------------------------------------------------------------
// Камера. Позы в camera() задаются для 16:9 — под экраны 4:3/16:10 их подгоняет ЯДРО (director.fitPose:
// расширяет вертикальный угол обзора). Свои подгонки здесь не нужны; эти помощники — только для случаев,
// когда визуализация сама ведёт камеру (drive) или проецирует разметку через «финальную» позу.
// ---------------------------------------------------------------------------

/** Поза так, как её поставит режиссёр (с подгонкой под узкий экран). */
export function fittedPose(ctx, pose) {
  const d = ctx.app?.director;
  return d?.fitPose ? d.fitPose(pose) : pose;
}

/** Вертикальный угол обзора с подгонкой под узкий экран (как director.fitPose), без аллокаций. */
export function fitFov(ctx, fov = 45) {
  const aspect = ctx.camera.aspect || 16 / 9;
  if (aspect >= 16 / 9 - 0.01) return fov;
  const f2 = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (16 / 9) / aspect);
  return Math.min(150, THREE.MathUtils.radToDeg(f2));
}

/** Пиксели на мировую единицу на расстоянии 1 (как uScale у облака частиц). */
export function pixelScale(ctx) {
  const e = ctx.engine;
  return (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov * 0.5));
}

// Общие uniform-объекты (один объект — во всех материалах): размер ячейки халфтона и разрешение.
export const SHARED = {
  cell: { value: 7 },
  res: { value: new THREE.Vector2(1600, 900) },
};
export function updateShared(ctx) {
  const e = ctx.engine;
  const H = e.height * e.pixelRatio, W = e.width * e.pixelRatio;
  SHARED.cell.value = Math.max(4.5, H / 150);
  SHARED.res.value.set(W, H);
}

/** Пометить все материалы группы как «не трогать базовым fade» (прозрачность ведём сами через uFade). */
export function noFade(root) {
  root.traverse((o) => {
    const m = o.material;
    (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => { mm.userData.noFade = true; });
  });
}

// ---------------------------------------------------------------------------
// Халфтон-сфера (узлы сетей, пузырьки, медальоны) — поддерживает InstancedMesh и instanceColor.
//
// Анимация экземпляров — в вершинном шейдере (AUTHORING «Производительность»: не перезаливать
// instanceMatrix/instanceColor каждый кадр): vertexHead — объявления (атрибуты-«расписания», uniform'ы),
// vertexBody — код, который задаёт vec3 s (масштаб в локальных координатах), vec3 offset (сдвиг после
// instanceMatrix) и vec3 tint (яркость/цвет экземпляра). Каждый кадр меняются только uniform'ы.
// ---------------------------------------------------------------------------

const orbVert = (head = '', body = '') => /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
${head}
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  vec3 s = vec3(1.0);
  vec3 offset = vec3(0.0);
  vec3 tint = vec3(1.0);
  ${body}
  p.xyz *= s;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
#endif
  p.xyz += offset;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor * tint;
#else
  vCol = tint;
#endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const ORB_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uCell, uFill, uRim, uCore;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
${HALFTONE}
void main() {
  float d = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float f = 1.0 - d;
  float rim = f * f * (0.35 + 0.65 * f);
  float k = clamp(length(vCol) * 0.58, 0.0, 2.0);
  float v = clamp(uFill * k + rim * 0.95, 0.0, 1.0);
  float dotm = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 c = uColor * vCol;
  vec3 col = c * (dotm * 0.8 + rim * uRim) + c * d * d * uCore + vec3(1.0) * rim * rim * rim * 0.3 * k;
  float a = uOpacity * uFade * clamp(0.18 + 0.82 * max(dotm, rim), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export function orbMaterial({ color: c = '#00ff00', intensity = 1, opacity = 1, fill = 0.14, rim = 1.2, core = 0.0, fade, blending = THREE.AdditiveBlending, vertexHead = '', vertexBody = '', uniforms = {} } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(c).multiplyScalar(intensity) },
      uOpacity: { value: opacity },
      uFade: fade || { value: 1 },
      uCell: SHARED.cell,
      uFill: { value: fill },
      uRim: { value: rim },
      uCore: { value: core },
      ...uniforms,
    },
    vertexShader: orbVert(vertexHead, vertexBody),
    fragmentShader: ORB_FRAG,
    transparent: true,
    depthWrite: false,
    blending,
  });
  m.userData.noFade = true;
  return m;
}

// ---------------------------------------------------------------------------
// Простой «светящийся» материал для InstancedMesh (кристаллы, ячейки ядер, рецепторы) с анимацией
// в вершинном шейдере — те же хуки, что у orbMaterial: vertexBody задаёт vec3 s, offset, tint.
// ---------------------------------------------------------------------------

const BASIC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade;
varying vec3 vCol;
void main() {
  float a = uOpacity * uFade;
  if (a < 0.002 || dot(vCol, vec3(1.0)) < 0.0005) discard;
  gl_FragColor = vec4(uColor * vCol, a);
}
`;

export function glowInstancedMaterial({ color: c = '#ffffff', intensity = 1, opacity = 1, fade, blending = THREE.AdditiveBlending, vertexHead = '', vertexBody = '', uniforms = {} } = {}) {
  const vert = /* glsl */ `
varying vec3 vCol;
${vertexHead}
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 s = vec3(1.0);
  vec3 offset = vec3(0.0);
  vec3 tint = vec3(1.0);
  ${vertexBody}
  p.xyz *= s;
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  p.xyz += offset;
  vCol = tint;
  gl_Position = projectionMatrix * modelViewMatrix * p;
}`;
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(c).multiplyScalar(intensity) }, uOpacity: { value: opacity }, uFade: fade || { value: 1 }, ...uniforms },
    vertexShader: vert,
    fragmentShader: BASIC_FRAG,
    transparent: true,
    depthWrite: false,
    blending,
  });
  m.userData.noFade = true;
  return m;
}

/** Статичный атрибут экземпляров (задаётся один раз при построении, каждый кадр не перезаливается). */
export function instAttr(mesh, name, itemSize, data) {
  const a = new THREE.InstancedBufferAttribute(data instanceof Float32Array ? data : new Float32Array(data), itemSize);
  mesh.geometry.setAttribute(name, a);
  return a;
}

// ---------------------------------------------------------------------------
// Мембрана (трубки аксонов/дендритов, тела клеток): френель + халфтон + бегущий импульс + вспышка
// ---------------------------------------------------------------------------

const MEM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const MEM_FRAG = /* glsl */ `
uniform vec3 uColor, uPulseColor;
uniform float uOpacity, uFade, uCell, uPulse, uPulseW, uFlash, uBase, uTrail;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${HALFTONE}
void main() {
  float d = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float f = 1.0 - d;
  float rim = f * f;
  float band = 0.0;
  if (uPulse > -0.5) {
    float x = (vUv.x - uPulse) / uPulseW;
    band = exp(-x * x);
    // хвост за импульсом
    float tail = vUv.x < uPulse ? exp((vUv.x - uPulse) / max(0.001, uTrail)) : 0.0;
    band = max(band, tail * 0.35);
  }
  // Вспышка подсвечивает в основном контур мембраны и только зелёным (uPulseColor): заливка всего диска
  // (две стороны DoubleSide + bloom) выгорает в белое пятно.
  float v = clamp(uBase + rim * 0.75 + band * 0.95 + uFlash * 0.15, 0.0, 1.0);
  float dotm = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 col = uColor * (dotm * 0.62 + rim * 0.55) + uPulseColor * (band * (0.55 + rim * 0.8) + uFlash * (0.1 + rim * 0.9));
  float a = uOpacity * uFade * clamp(0.1 + 0.9 * max(dotm, max(rim, band)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export function membraneMaterial({ color: c = '#bfffb8', intensity = 0.55, pulse = '#00ff00', pulseIntensity = 2.2, opacity = 1, base = 0.05, width = 0.06, trail = 0.12, fade } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(c).multiplyScalar(intensity) },
      uPulseColor: { value: new THREE.Color(pulse).multiplyScalar(pulseIntensity) },
      uOpacity: { value: opacity },
      uFade: fade || { value: 1 },
      uCell: SHARED.cell,
      uPulse: { value: -1 },
      uPulseW: { value: width },
      uTrail: { value: trail },
      uFlash: { value: 0 },
      uBase: { value: base },
    },
    vertexShader: MEM_VERT,
    fragmentShader: MEM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.userData.noFade = true;
  return m;
}

// ---------------------------------------------------------------------------
// Толстые линии (ширина в пикселях экрана), по 4 вершины на отрезок.
//   const L = new FatLines(n, { width: 3, fragment: '...' })
//   L.setEdge(i, a, b); L.setData(i, phase, widthK, group, alpha); L.commit()
// Во фрагментном шейдере доступны: vST (x — поперёк −1..1, y — вдоль 0..1), vData, vLen (длина в пикселях),
// uniform'ы uColor, uOpacity, uFade, uTime + свои (opts.uniforms).
// ---------------------------------------------------------------------------

// Хуки вершинного шейдера (как у orbMaterial): vertexHead — объявления, vertexBody — может переопределить
// концы отрезка pa/pb (напр. по индексам узлов из uniform-массива) и данные data — без перезаливки буферов.
const lineVert = (head = '', body = '') => /* glsl */ `
attribute vec3 aB;
attribute vec2 aST;
attribute vec4 aData;
uniform vec2 uRes;
uniform float uWidth;
varying vec2 vST;
varying vec4 vData;
varying float vLen;
${head}
void main() {
  vec3 pa = position;
  vec3 pb = aB;
  vec4 data = aData;
  ${body}
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(pa, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(pb, 1.0);
  vec2 sa = ca.xy / max(ca.w, 1e-4);
  vec2 sb = cb.xy / max(cb.w, 1e-4);
  vec2 d = (sb - sa) * uRes * 0.5;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(ca, cb, aST.y);
  float w = uWidth * data.y;
  c.xy += nrm * aST.x * w / uRes * c.w;
  gl_Position = c;
  vST = aST;
  vData = data;
  vLen = len;
}
`;

export const LINE_FRAG_DEFAULT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uTime;
varying vec2 vST;
varying vec4 vData;
varying float vLen;
void main() {
  float e = 1.0 - smoothstep(0.3, 1.0, abs(vST.x));
  float a = e * vData.w * uOpacity * uFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class FatLines {
  constructor(n, { width = 3, color: c = '#00ff00', intensity = 1.4, opacity = 1, fragment = LINE_FRAG_DEFAULT, uniforms = {}, fade, blending = THREE.AdditiveBlending, depthTest = true, vertexHead = '', vertexBody = '' } = {}) {
    this.n = n;
    const V = n * 4;
    this.pA = new Float32Array(V * 3);
    this.pB = new Float32Array(V * 3);
    this.st = new Float32Array(V * 2);
    this.data = new Float32Array(V * 4);
    const idx = V > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    for (let i = 0; i < n; i++) {
      const v = i * 4;
      this.st.set([-1, 0, 1, 0, -1, 1, 1, 1], v * 2);
      idx[i * 6] = v; idx[i * 6 + 1] = v + 1; idx[i * 6 + 2] = v + 2;
      idx[i * 6 + 3] = v + 2; idx[i * 6 + 4] = v + 1; idx[i * 6 + 5] = v + 3;
      for (let k = 0; k < 4; k++) { this.data[(v + k) * 4 + 1] = 1; this.data[(v + k) * 4 + 3] = 1; }
    }
    const g = new THREE.BufferGeometry();
    this.attrA = new THREE.BufferAttribute(this.pA, 3);
    this.attrB = new THREE.BufferAttribute(this.pB, 3);
    this.attrData = new THREE.BufferAttribute(this.data, 4);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    this.attrData.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrA);
    g.setAttribute('aB', this.attrB);
    g.setAttribute('aST', new THREE.BufferAttribute(this.st, 2));
    g.setAttribute('aData', this.attrData);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.uniforms = {
      uRes: SHARED.res,
      uWidth: { value: width },
      uColor: { value: new THREE.Color(c).multiplyScalar(intensity) },
      uOpacity: { value: opacity },
      uFade: fade || { value: 1 },
      uTime: { value: 0 },
      ...uniforms,
    };
    this.baseWidth = width;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: lineVert(vertexHead, vertexBody),
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending,
      side: THREE.DoubleSide,
    });
    this.material.userData.noFade = true;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.geometry = g;
  }

  setEdge(i, a, b) {
    const v = i * 12;
    for (let k = 0; k < 4; k++) {
      const j = v + k * 3;
      this.pA[j] = a[0]; this.pA[j + 1] = a[1]; this.pA[j + 2] = a[2];
      this.pB[j] = b[0]; this.pB[j + 1] = b[1]; this.pB[j + 2] = b[2];
    }
  }

  setEdgeXYZ(i, ax, ay, az, bx, by, bz) {
    const v = i * 12;
    for (let k = 0; k < 4; k++) {
      const j = v + k * 3;
      this.pA[j] = ax; this.pA[j + 1] = ay; this.pA[j + 2] = az;
      this.pB[j] = bx; this.pB[j + 1] = by; this.pB[j + 2] = bz;
    }
  }

  setData(i, x, y, z, w) {
    const v = i * 16;
    for (let k = 0; k < 4; k++) {
      const j = v + k * 4;
      this.data[j] = x; this.data[j + 1] = y; this.data[j + 2] = z; this.data[j + 3] = w;
    }
  }

  setAlpha(i, w) {
    const v = i * 16;
    this.data[v + 3] = w; this.data[v + 7] = w; this.data[v + 11] = w; this.data[v + 15] = w;
  }

  commit(positions = true, data = true) {
    if (positions) { this.attrA.needsUpdate = true; this.attrB.needsUpdate = true; }
    if (data) this.attrData.needsUpdate = true;
  }

  /** Ширина линий масштабируется с высотой экрана (база — 900 px). */
  resize(ctx) {
    const e = ctx.engine;
    this.uniforms.uWidth.value = this.baseWidth * Math.max(0.6, (e.height * e.pixelRatio) / 900);
  }
}

// ---------------------------------------------------------------------------
// Светящиеся точки (CPU-управляемые, до нескольких тысяч): импульсы, молекулы, искры.
// ---------------------------------------------------------------------------

// Хуки: vertexBody может переопределить pos, size, col (напр. посчитать полёт молекулы по времени цикла).
const gpVert = (head = '', body = '') => /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale, uFade, uMax;
varying vec4 vColor;
${head}
void main() {
  vec3 pos = position;
  float size = aSize;
  vec4 col = aColor;
  ${body}
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = size * uScale / max(0.05, -mv.z);
  float a = col.a * uFade;
  if (px < 1.5) { a *= px / 1.5; px = 1.5; }
  gl_PointSize = min(px, uMax);
  vColor = vec4(col.rgb, a);
  if (a < 0.002 || mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const GP_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 6.0);
  float a = (core + (1.0 - d) * 0.28) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

/**
 * Светящиеся точки. Без хуков — CPU-управляемые (set/commit). С vertexBody — «статичные расписания»:
 * заполните set()/attr() один раз, commit() один раз, а движение посчитайте в шейдере по uniform'ам.
 */
export class GlowPoints {
  constructor(n, { fade, max = 160, vertexHead = '', vertexBody = '', uniforms = {} } = {}) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.col = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    const usage = vertexBody ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage;
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(usage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(usage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(usage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aCol);
    this.geometry = g;
    this.uniforms = { uScale: { value: 1000 }, uFade: fade || { value: 1 }, uMax: { value: max }, ...uniforms };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: gpVert(vertexHead, vertexBody),
      fragmentShader: GP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.material.userData.noFade = true;
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  set(i, x, y, z, size, r, g, b, a) {
    const j = i * 3, k = i * 4;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.size[i] = size;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b; this.col[k + 3] = a;
  }

  hide(i) { this.col[i * 4 + 3] = 0; }

  /** Дополнительный статичный атрибут (данные «расписания» для шейдера). */
  attr(name, itemSize, data) {
    const a = new THREE.BufferAttribute(data instanceof Float32Array ? data : new Float32Array(data), itemSize);
    this.geometry.setAttribute(name, a);
    return a;
  }

  commit() { this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true; }

  update(ctx) { this.uniforms.uScale.value = pixelScale(ctx); }
}

// ---------------------------------------------------------------------------
// Спрайт-свечение
// ---------------------------------------------------------------------------

// Общий только холст; текстура — своя у каждого спрайта: режиссёр выгружает давно не нужные сцены
// (Visual.dispose() освобождает все текстуры материалов), общая текстура «умерла» бы вместе с одной из них.
let _glowCanvas = null;
export function glowTexture() {
  if (!_glowCanvas) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    _glowCanvas = c;
  }
  const t = new THREE.CanvasTexture(_glowCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowSprite(c = '#00ff00', size = 1, intensity = 1) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(c).multiplyScalar(intensity), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 });
  m.userData.noFade = true;
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.userData.baseScale = size;
  return s;
}

// ---------------------------------------------------------------------------
// «Космическое» окружение для металла: тёмное небо, зелёное зарево, мягкий белый блик, зелёный контровой.
// ---------------------------------------------------------------------------
/**
 * Возвращает WebGLRenderTarget (PMREM) — владелец обязан вызвать .dispose() у него в своём dispose().
 * Не кешируется между экземплярами: выгруженная сцена освобождает свои текстуры.
 */
export function spaceEnvMap(renderer) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
varying vec3 vDir;
float lobe(vec3 d, vec3 c, float k) { return pow(max(0.0, dot(d, normalize(c))), k); }
void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.02, 0.022, 0.02);
  col += vec3(1.0, 0.98, 0.93) * lobe(d, vec3(0.3, -0.12, 0.95), 5.0) * 0.95;
  col += vec3(1.0, 1.0, 0.96) * lobe(d, vec3(-0.32, -0.4, 0.86), 22.0) * 1.15;
  col += vec3(0.08, 1.0, 0.12) * lobe(d, vec3(0.95, -0.25, 0.15), 3.0) * 0.85;
  col += vec3(0.1, 0.9, 0.15) * lobe(d, vec3(-0.85, -0.1, -0.5), 4.0) * 0.6;
  col += vec3(0.9, 1.0, 0.9) * lobe(d, vec3(0.0, 1.0, 0.2), 2.0) * 0.14;
  col += vec3(0.4, 0.6, 0.4) * smoothstep(0.1, 1.0, -d.y) * 0.04;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
  const geo = new THREE.SphereGeometry(40, 64, 32);
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.0);
  pm.dispose();
  mat.dispose();
  geo.dispose();
  return rt;
}

// ---------------------------------------------------------------------------
// Звёздная пыль для облака частиц — только ЗА сценой (z < −3): точки перед камерой
// превращаются в огромные размытые пятна.
// ---------------------------------------------------------------------------
export function spaceDust(S, r, { alpha = [0.05, 0.2], size = [0.4, 1.1], z = [4, 34], spread = [30, 16] } = {}) {
  return (m) => {
    const s = S.createShape(m);
    for (let i = 0; i < m; i++) {
      S.setPoint(s, i, r.range(-spread[0], spread[0]), r.range(-spread[1], spread[1]), -r.range(z[0], z[1]), r.range(size[0], size[1]), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(alpha[0], alpha[1]));
    }
    return s;
  };
}

// ---------------------------------------------------------------------------
// Разное
// ---------------------------------------------------------------------------

/** Точки на кривой с шагом (для подписей и импульсов). */
export function curvePoint(curve, t, out = new THREE.Vector3()) { return curve.getPointAt(clamp(t, 0, 1), out); }

/** Записать матрицу инстанса из позиции/масштаба (без поворота) — быстро и без аллокаций. */
const _m4 = new THREE.Matrix4();
export function setInstance(mesh, i, x, y, z, sx, sy = sx, sz = sx) {
  _m4.makeScale(sx, sy, sz);
  _m4.elements[12] = x; _m4.elements[13] = y; _m4.elements[14] = z;
  mesh.setMatrixAt(i, _m4);
}

/** Хеш-шум для детерминированных значений в JS. */
export function hash1(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export { HASH };
