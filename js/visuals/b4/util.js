// Помощники визуализаций части b4: текстуры свечения, линии, мягкие точки.
import * as THREE from 'three';

/** Радиальное свечение (для спрайтов-ореолов). Новая текстура на каждый вызов — освобождается вместе с визуализацией. */
export function glowTexture(size = 128, { core = 0.18, falloff = 2.2 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const v = t < core ? 1 : Math.pow(1 - (t - core) / (1 - core), falloff);
    grd.addColorStop(t, `rgba(255,255,255,${v.toFixed(4)})`);
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Аддитивный «светящийся» базовый материал (цвет можно делать > 1 — его подхватит bloom). */
export function glowMat(color, opacity = 1, extra = {}) {
  const m = new THREE.MeshBasicMaterial({
    color: color instanceof THREE.Color ? color : new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    ...extra,
  });
  return m;
}

/** Ореол-спрайт. */
export function haloSprite(tex, color, scale = 1, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    color: color instanceof THREE.Color ? color : new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

/** Простая линия по точкам [[x,y,z], …]. */
export function polyline(points, { color = 0xffffff, opacity = 0.5, additive = false } = {}) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  return new THREE.Line(geo, mat);
}

/** Плавная ступенька 0..1. */
export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const easeOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Шейдер мягких точек (собственные Points визуализаций). Атрибуты: position, aColor (rgb), aSize, aAlpha. */
export const SOFT_POINTS_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uScale, uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uScale / max(0.05, -mv.z);
  vAlpha = aAlpha * uOpacity * clamp(px / 1.5, 0.0, 1.0);
  gl_PointSize = clamp(px, 1.5, 64.0);
  vColor = aColor;
  if (vAlpha < 0.002 || mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
export const SOFT_POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 5.0) + (1.0 - d) * 0.2) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

/** Пикселей на мировую единицу на расстоянии 1 (для размеров точек). */
export function pointScale(ctx) {
  const h = (ctx.height || 900) * (ctx.engine?.pixelRatio || 1);
  return (h * 0.5) / Math.tan(THREE.MathUtils.degToRad((ctx.camera?.fov || 45) * 0.5));
}

// Позы камеры задаём для 16:9: под экраны 4:3 / 16:10 их подгоняет ядро (director.fitPose).

/** Уступить главный поток (тяжёлую подготовку форм режем на куски, чтобы фоновая загрузка не дёргала анимацию). */
export const idle = () => new Promise((r) => setTimeout(r, 0));
