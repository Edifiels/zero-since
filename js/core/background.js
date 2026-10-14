// Фон: фирменное халфтон-свечение (как в логотипе), далёкие звёзды с «варп»-шлейфами и ближняя пыль.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { SIMPLEX, HASH } from './glsl.js';
import { rng } from './utils.js';

// Пресеты свечения. Координаты: y ∈ [-0.5; 0.5] (по высоте экрана), x — в тех же единицах (≈ ±0.89 по краям 16:9).
// glows: [x, y, радиус, яркость]; band: [яркость, y-уровень, мягкость, наклон] — «волна» снизу, как на баннере.
export const BG_PRESETS = {
  none: { glows: [], band: null, level: 1 },
  banner: { glows: [[0.62, -0.66, 0.78, 1.2]], band: [1.25, -0.33, 0.2, -0.1] },
  low: { glows: [[0.55, -0.62, 0.5, 0.6]], band: [0.75, -0.43, 0.12, -0.05] },
  soft: { glows: [[0.8, -0.58, 0.55, 0.85], [-0.9, 0.55, 0.38, 0.45]], band: null },
  corner: { glows: [[0.9, -0.6, 0.7, 1.05]], band: null },
  corners: { glows: [[0.95, -0.6, 0.55, 0.9], [-0.95, 0.6, 0.5, 0.75]], band: null },
  left: { glows: [[-0.95, -0.25, 0.62, 0.95]], band: null },
  right: { glows: [[0.95, 0.0, 0.62, 0.95]], band: null },
  center: { glows: [[0.0, -0.05, 0.5, 0.62]], band: null },
  top: { glows: [[0.1, 0.72, 0.62, 0.9]], band: null },
  bottom: { glows: [], band: [0.95, -0.4, 0.14, 0.0] },
  full: { glows: [[0.0, 0.0, 1.25, 1.7]], band: null },
  danger: { glows: [[0.85, -0.55, 0.6, 0.85], [-0.9, 0.5, 0.42, 0.5]], band: null, tint: 'red' },
};

const MAX_GLOWS = 4;

const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const SKY_FRAG = /* glsl */ `
uniform float uTime, uCell, uLevel, uSurge, uSurgeR;
uniform vec2 uRes;
uniform vec4 uGlow[${MAX_GLOWS}];
uniform vec4 uBand;
uniform vec3 uColA, uColB;
${SIMPLEX}
${HASH}

float field(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    vec4 g = uGlow[i];
    if (g.w <= 0.001) continue;
    float n = snoise(vec3(p * 1.7 + float(i) * 7.13, uTime * 0.05 + float(i) * 3.1));
    float d = length(p - g.xy) / max(g.z, 0.001) + n * 0.24;
    f += g.w * (1.0 - smoothstep(0.0, 1.0, d));
  }
  if (uBand.x > 0.001) {
    float wave = 0.085 * sin(p.x * 2.4 + uTime * 0.11) + 0.07 * snoise(vec3(p.x * 1.25, 4.0, uTime * 0.045));
    float y = p.y - (uBand.y + p.x * uBand.w + wave);
    f += uBand.x * (1.0 - smoothstep(-uBand.z, uBand.z * 1.4, y));
  }
  f *= uLevel;
  if (uSurge > 0.001) {
    float r = length(p);
    f += uSurge * (1.0 - smoothstep(0.0, 0.22, abs(r - uSurgeR))) * (0.65 + 0.35 * snoise(vec3(p * 3.0, uTime)));
  }
  return f;
}

float dotMask(float r, float d, float aa) {
  if (r <= 0.0005) return 0.0;
  return (1.0 - smoothstep(r - aa, r + aa, d)) * smoothstep(0.0, aa * 2.0, r);
}

void main() {
  const mat2 R = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  const mat2 Ri = mat2(0.70710678, 0.70710678, -0.70710678, 0.70710678);
  vec2 frag = gl_FragCoord.xy;
  vec2 q = R * frag / uCell;
  vec2 id = floor(q);
  vec2 center = Ri * ((id + 0.5) * uCell);
  vec2 p = (center - 0.5 * uRes) / uRes.y;
  float v = field(p);
  vec2 f = fract(q) - 0.5;
  float d = mix(length(f), max(abs(f.x), abs(f.y)), 0.16);
  float aa = 1.3 / uCell;
  float m1 = dotMask(0.74 * sqrt(clamp(v, 0.0, 1.0)), d, aa);
  float m2 = dotMask(0.74 * sqrt(clamp(v - 1.0, 0.0, 1.0)), d, aa);
  vec3 col = uColA * m1;
  col = mix(col, uColB, m2);
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime, uScale, uOpacity, uTwinkle;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 31.0);
  gl_PointSize = clamp(aSize * uScale, 1.0, 9.0);
  vColor = aColor;
  vAlpha = uOpacity * clamp(tw, 0.2, 1.6) * clamp(aSize * uScale * 0.6, 0.15, 1.0);
}
`;
const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 4.5) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

const STREAK_VERT = /* glsl */ `
attribute float aTail;
attribute vec3 aColor;
uniform float uWarp, uLen;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.z += aTail * uWarp * uLen;
  mv.z = min(mv.z, -2.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAlpha = clamp(abs(uWarp) * 1.6, 0.0, 1.0) * (1.0 - aTail * 0.9);
}
`;
const STREAK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(vColor * 1.6, vAlpha); }
`;

function lin(hex) { const c = new THREE.Color(hex); return c; }

export class Background {
  constructor(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'background';
    const quality = engine.quality;

    // --- Халфтон-небо (полноэкранный квад)
    this.skyUniforms = {
      uTime: { value: 0 },
      uCell: { value: 7 },
      uLevel: { value: 1 },
      uSurge: { value: 0 },
      uSurgeR: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uGlow: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4(0, 0, 0.5, 0)) },
      uBand: { value: new THREE.Vector4(0, -0.4, 0.15, 0) },
      uColA: { value: lin('#00e000').multiplyScalar(0.55) },
      uColB: { value: lin('#ffffff').multiplyScalar(0.72) },
    };
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.name = 'halftone-sky';

    // --- Далёкие звёзды (привязаны к камере — «бесконечно далеко»)
    const N = quality === 'low' ? 2200 : 4200;
    const r = rng(7);
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const col = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const white = lin('#ffffff'), green = lin('#5dff4a'), blue = lin('#cfe3ff'), warm = lin('#fff1d6');
    for (let i = 0; i < N; i++) {
      const [x, y, z] = r.onSphere(r.range(700, 950));
      pos.set([x, y, z], i * 3);
      size[i] = Math.pow(r(), 6) * 2.6 + 0.35;
      const t = r();
      const c = t < 0.7 ? white : t < 0.82 ? green : t < 0.92 ? blue : warm;
      col.set([c.r, c.g, c.b], i * 3);
      phase[i] = r();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { uTime: { value: 0 }, uScale: { value: 1 }, uOpacity: { value: 1 }, uTwinkle: { value: 0.35 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;

    // --- «Варп»-шлейфы звёзд (линии, видны только при прыжке)
    const M = Math.floor(N * 0.6);
    const lp = new Float32Array(M * 2 * 3);
    const lt = new Float32Array(M * 2);
    const lc = new Float32Array(M * 2 * 3);
    for (let i = 0; i < M; i++) {
      for (let k = 0; k < 2; k++) {
        lp[(i * 2 + k) * 3 + 0] = pos[i * 3 + 0];
        lp[(i * 2 + k) * 3 + 1] = pos[i * 3 + 1];
        lp[(i * 2 + k) * 3 + 2] = pos[i * 3 + 2];
        lt[i * 2 + k] = k;
        lc[(i * 2 + k) * 3 + 0] = col[i * 3 + 0];
        lc[(i * 2 + k) * 3 + 1] = col[i * 3 + 1];
        lc[(i * 2 + k) * 3 + 2] = col[i * 3 + 2];
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('aTail', new THREE.BufferAttribute(lt, 1));
    lg.setAttribute('aColor', new THREE.BufferAttribute(lc, 3));
    this.streakUniforms = { uWarp: { value: 0 }, uLen: { value: 820 } };
    this.streaks = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      uniforms: this.streakUniforms,
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = -899;
    this.streaks.visible = false;

    this.farGroup = new THREE.Group();
    this.farGroup.add(this.stars, this.streaks);

    // --- Ближняя космическая пыль (даёт параллакс при движении камеры)
    const D = quality === 'low' ? 600 : 1400;
    const dp = new Float32Array(D * 3), ds = new Float32Array(D), dc = new Float32Array(D * 3), dph = new Float32Array(D);
    for (let i = 0; i < D; i++) {
      const [x, y, z] = r.inSphere(150);
      dp.set([x, y, z], i * 3);
      ds[i] = r.range(0.25, 0.9);
      const c = r() < 0.75 ? white : green;
      dc.set([c.r * 0.5, c.g * 0.5, c.b * 0.5], i * 3);
      dph[i] = r();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aSize', new THREE.BufferAttribute(ds, 1));
    dg.setAttribute('aColor', new THREE.BufferAttribute(dc, 3));
    dg.setAttribute('aPhase', new THREE.BufferAttribute(dph, 1));
    this.dustUniforms = { uTime: { value: 0 }, uScale: { value: 1 }, uOpacity: { value: 0.55 }, uTwinkle: { value: 0.2 } };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.dust.frustumCulled = false;
    this.dust.renderOrder = -800;

    this.group.add(this.sky, this.farGroup, this.dust);

    // Состояние свечения (интерполируется между пресетами)
    this.state = {
      glows: Array.from({ length: MAX_GLOWS }, () => ({ x: 0, y: -0.6, r: 0.5, i: 0 })),
      band: { i: 0, y: -0.45, soft: 0.15, tilt: 0 },
      level: 1,
    };
    this.preset = 'none';
    this.warp = 0;
  }

  // Плавно перейти к пресету (имя или объект { glows, band, level }).
  set(preset, { duration = 1.6, ease = 'power2.inOut' } = {}) {
    if (preset == null) return;
    const p = typeof preset === 'string' ? (BG_PRESETS[preset] || BG_PRESETS.soft) : preset;
    if (typeof preset === 'string' && this.preset === preset) return;
    this.preset = typeof preset === 'string' ? preset : 'custom';
    const glows = p.glows || [];
    for (let i = 0; i < MAX_GLOWS; i++) {
      const cur = this.state.glows[i];
      const g = glows[i];
      const tgt = g ? { x: g[0], y: g[1], r: g[2], i: g[3] } : { x: cur.x, y: cur.y, r: cur.r, i: 0 };
      gsap.to(cur, { ...tgt, duration, ease, overwrite: true });
    }
    const b = this.state.band;
    const band = p.band ? { i: p.band[0], y: p.band[1], soft: p.band[2], tilt: p.band[3] } : { i: 0, y: b.y, soft: b.soft, tilt: b.tilt };
    gsap.to(b, { ...band, duration, ease, overwrite: true });
    gsap.to(this.state, { level: p.level ?? 1, duration, ease, overwrite: 'auto' });
    const tint = p.tint === 'red' ? '#ff3b30' : '#00e000';
    const c = lin(tint).multiplyScalar(0.55);
    gsap.to(this.skyUniforms.uColA.value, { r: c.r, g: c.g, b: c.b, duration, ease, overwrite: true });
  }

  // Волна-всплеск от центра (для переходов).
  surge(strength = 1, duration = 1.6) {
    const u = this.skyUniforms;
    gsap.killTweensOf([u.uSurge, u.uSurgeR]);
    u.uSurgeR.value = 0;
    gsap.fromTo(u.uSurge, { value: strength }, { value: 0, duration, ease: 'power2.in' });
    gsap.fromTo(u.uSurgeR, { value: 0.02 }, { value: 1.25, duration, ease: 'power2.out' });
  }

  setWarp(v) {
    this.warp = v;
    this.streakUniforms.uWarp.value = v;
    this.streaks.visible = Math.abs(v) > 0.002;
  }

  resize(w, h, pixelRatio) {
    const W = w * pixelRatio, H = h * pixelRatio;
    this.skyUniforms.uRes.value.set(W, H);
    this.skyUniforms.uCell.value = Math.max(4.5, H / 165);
    const s = Math.max(0.7, H / 1100);
    this.starUniforms.uScale.value = s * 1.6;
    this.dustUniforms.uScale.value = s * 2.2;
  }

  update(dt, t, camera) {
    this.skyUniforms.uTime.value = t;
    this.starUniforms.uTime.value = t;
    this.dustUniforms.uTime.value = t;
    const u = this.skyUniforms;
    for (let i = 0; i < MAX_GLOWS; i++) {
      const g = this.state.glows[i];
      u.uGlow.value[i].set(g.x, g.y, g.r, g.i);
    }
    const b = this.state.band;
    u.uBand.value.set(b.i, b.y, b.soft, b.tilt);
    u.uLevel.value = this.state.level;
    // Звёзды «на бесконечности»: следуют за камерой, медленно вращаются
    this.farGroup.position.copy(camera.position);
    this.farGroup.rotation.y = t * 0.004;
  }
}
