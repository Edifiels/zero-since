// Общие помощники визуализаций части b2a: слои с собственной прозрачностью, стекло (френель),
// текстура свечения, светящиеся точки-«огоньки».
import * as THREE from 'three';

/** Мягкое круглое пятно (для спрайтов свечения). Своё у каждой визуализации — dispose() безопасен. */
export function glowTexture(size = 128, stops = [[0, 1], [0.18, 0.6], [0.45, 0.16], [1, 0]]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, a]) => grd.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Слой: группа объектов с общей прозрачностью layer.o (0..1), которую можно твинить.
 * Итоговая прозрачность = layer.o * общая прозрачность визуализации (enter/exit).
 */
export function makeLayer(group, initial = 0) {
  const mats = [];
  const seen = new Set();
  group.traverse((o) => {
    const m = o.material;
    if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((mm) => {
      if (seen.has(mm)) return;
      seen.add(mm);
      mm.userData.noFade = true;
      mats.push({ m: mm, base: mm.uniforms?.uOpacity ? mm.uniforms.uOpacity.value : mm.opacity });
    });
  });
  return { group, o: initial, mats, last: -1 };
}

export function applyLayer(L, k) {
  const v = L.o * k;
  if (Math.abs(v - L.last) < 1e-4) return;
  L.last = v;
  L.group.visible = v > 0.003;
  for (const e of L.mats) {
    if (e.m.uniforms?.uOpacity) e.m.uniforms.uOpacity.value = e.base * v;
    else e.m.opacity = e.base * v;
  }
}

// ---------- Стекло: френель-ободок + блик + внутреннее свечение ----------
const GLASS_VERT = /* glsl */ `
attribute float aIgnite;
uniform float uIgnite;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vOn;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * lp;
  vN = normalize(normalMatrix * n);
  vV = normalize(-mv.xyz);
  vY = position.y;
  #ifdef USE_IGNITE
    vOn = clamp((uIgnite - aIgnite) / 0.12, 0.0, 1.0);
  #else
    vOn = 1.0;
  #endif
  gl_Position = projectionMatrix * mv;
}
`;
const GLASS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlowColor;
uniform float uGlow, uOpacity, uNeck;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vOn;
void main() {
  vec3 n = normalize(vN);
  float ndv = abs(dot(n, normalize(vV)));
  float f = clamp(1.0 - ndv, 0.0, 1.0);
  float rim = f * f * f;
  float spec = smoothstep(0.88, 0.995, abs(dot(n, normalize(vec3(-0.5, 0.55, 0.67)))));
  float g = uGlow * vOn;
  // изнутри светится сильнее там, где стекло «смотрит» на нас
  float inner = g * (0.18 + 0.55 * ndv * ndv) * smoothstep(uNeck, uNeck + 0.02, vY);
  vec3 col = uColor * (0.035 + rim * 0.95) + vec3(1.0) * spec * 0.5 + uGlowColor * inner;
  float a = clamp(0.06 + rim * 0.8 + spec * 0.5 + inner, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, a);
}
`;

export function glassMaterial({ color = '#d9f7dc', glow = '#ffd9a8', ignite = false, neck = 0.03 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uGlowColor: { value: new THREE.Color(glow) },
      uGlow: { value: 0 },
      uOpacity: { value: 1 },
      uIgnite: { value: 0 },
      uNeck: { value: neck },
    },
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  if (ignite) m.defines = { USE_IGNITE: '' };
  return m;
}

// ---------- Светящиеся точки фиксированного размера в мире (огоньки, маяки) ----------
const SPARK_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aDelay;
uniform float uTime, uScale, uWorld, uProgress, uTwinkle, uMinPx, uMaxPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = clamp((uProgress - aDelay) / 0.08, 0.0, 1.0);
  #ifdef FLASH
    // короткие вспышки («нейроны срабатывают»): основание степени всегда ≥ 0
    float sn = max(0.0, sin(uTime * (0.9 + aPhase * 1.7) + aPhase * 57.0));
    float tw = sn * sn * sn * sn * sn * sn * sn * sn * 1.6;
  #else
    float tw = 1.0 + uTwinkle * sin(uTime * (1.3 + aPhase * 3.0) + aPhase * 40.0);
  #endif
  float px = aSize * uWorld * uScale / max(0.05, -mv.z);
  float a = on * tw;
  if (px < uMinPx) { a *= px / uMinPx; px = uMinPx; }
  gl_PointSize = min(px, uMaxPx);
  vColor = aColor;
  vAlpha = a;
  if (a < 0.002 || mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const SPARK_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 7.0);
  float halo = (1.0 - d) * 0.22;
  gl_FragColor = vec4(vColor, (core + halo) * vAlpha * uOpacity);
}
`;

/**
 * Облако «огоньков»: pts — [{ p: [x,y,z], size (в единицах мира), color: THREE.Color|[r,g,b], phase, delay }].
 * uWorld — масштаб мира (если точки лежат в масштабируемой группе), uProgress — для поочерёдного зажигания.
 */
export function makeSparks(pts, { twinkle = 0.25, minPx = 1.5, maxPx = 90, flash = false } = {}) {
  const n = pts.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3), ph = new Float32Array(n), dl = new Float32Array(n);
  pts.forEach((s, i) => {
    pos.set(s.p, i * 3);
    size[i] = s.size ?? 1;
    const c = s.color?.isColor ? [s.color.r, s.color.g, s.color.b] : (s.color || [1, 1, 1]);
    col.set(c, i * 3);
    ph[i] = s.phase ?? Math.random();
    dl[i] = s.delay ?? 0;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aDelay', new THREE.BufferAttribute(dl, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 600 }, uWorld: { value: 1 }, uProgress: { value: 1 },
      uTwinkle: { value: twinkle }, uMinPx: { value: minPx }, uMaxPx: { value: maxPx }, uOpacity: { value: 1 },
    },
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  if (flash) m.defines = { FLASH: '' };
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/**
 * Уступить кадр: тяжёлый init() режем на куски, чтобы фоновая предзагрузка сцены не «замораживала»
 * анимацию текущего слайда (каждый кусок — отдельная задача, между ними рисуется кадр).
 * Страховка по таймеру — если rAF не приходит (вкладка скрыта).
 */
export function yieldFrame() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 40);
    requestAnimationFrame(() => { clearTimeout(t); setTimeout(resolve, 0); });
  });
}

/** Пикселей на единицу мира на расстоянии 1 (как uScale у частиц). */
export function projScale(engine, camera) {
  const h = (engine.height || 900) * (engine.renderer?.getPixelRatio?.() || 1);
  return (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
}

/** Кубическая эрмитова интерполяция. */
export function hermite(p0, m0, p1, m1, t, h = 1) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * h * m1;
}
