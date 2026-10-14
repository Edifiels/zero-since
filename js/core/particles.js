// Общее облако частиц (GPGPU). Одно на всю презентацию — визуализации «заказывают» ему форму,
// и частицы перетекают из одной формы в другую (галактика → паутина → нейроны → мозг …).
//
//   ctx.particles.morph(shape, { duration, stagger, burst, explode })
//   ctx.particles.setParams({ swirl, noise, size, opacity, spring, damping, flow }, duration)
//   ctx.particles.explode(strength, center)
//   ctx.particles.claim(owner) — визуализация сообщает, что использует частицы на своём слайде
//   ctx.particles.object — THREE.Points: можно двигать/вращать/масштабировать
//
// Форма (shape) — объект { positions: Float32Array(count*4) [x,y,z,size], colors: Float32Array(count*4) [r,g,b,a] }
// или функция (count) => shape. Готовые формы — в core/shapes.js.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { NOISE, HASH } from './glsl.js';
import { rng } from './utils.js';
import { equalize } from './shapes.js';

const VEL_SHADER = /* glsl */ `
uniform sampler2D tTarget;
uniform sampler2D tPrev;
uniform float uTime, uDt, uMorph, uStagger, uSpring, uDamping, uNoise, uBurst, uNoiseScale, uNoiseSpeed;
uniform float uPhaseA, uPhaseB, uSwirlR0;
uniform vec3 uFlow;
uniform float uImpulse;
uniform vec3 uImpulseC;
uniform vec3 uRayO, uRayD;
uniform float uRayR, uRayF;
${NOISE}
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
bool badv(vec3 v) { uvec3 b = floatBitsToUint(v) & 0x7f800000u; return any(equal(b, uvec3(0x7f800000u))) || dot(v, v) > 1e8; }
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 pos = texture2D(tPos, uv).xyz;
  vec3 vel = texture2D(tVel, uv).xyz;
  if (badv(pos) || badv(vel)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec4 rnd = hash42(uv * 1000.0 + 0.5);
  vec3 a = texture2D(tPrev, uv).xyz;
  vec3 b = texture2D(tTarget, uv).xyz;
  if (uPhaseA != 0.0) a = rotY(a, uPhaseA / (uSwirlR0 + length(a.xz)));
  if (uPhaseB != 0.0) b = rotY(b, uPhaseB / (uSwirlR0 + length(b.xz)));
  float k = clamp((uMorph - rnd.x * uStagger) / max(1e-4, 1.0 - uStagger), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec3 target = mix(a, b, k);
  vec3 acc = (target - pos) * uSpring;
  float nAmp = uNoise + uBurst * sin(3.14159265 * k);
  if (nAmp > 0.0005) acc += curlNoise(pos * uNoiseScale + vec3(0.0, uTime * uNoiseSpeed, uTime * uNoiseSpeed * 0.7)) * nAmp;
  acc += uFlow;
  if (uRayF > 0.0) {
    vec3 w = pos - uRayO;
    vec3 cp = uRayO + uRayD * dot(w, uRayD);
    vec3 dv = pos - cp;
    float d = length(dv);
    acc += (dv / max(d, 1e-3)) * uRayF * (1.0 - smoothstep(0.0, uRayR, d));
  }
  vel += acc * uDt;
  vel *= exp(-uDamping * uDt);
  if (uImpulse > 0.0) {
    vec3 dir = pos - uImpulseC;
    float l = length(dir);
    vel += (dir / max(l, 1e-3)) * uImpulse * (0.35 + rnd.y) + (rnd.yzw - 0.5) * uImpulse * 0.7;
  }
  gl_FragColor = vec4(vel, 1.0);
}
`;

const POS_SHADER = /* glsl */ `
uniform float uDt;
uniform sampler2D tTarget;
bool badv(vec3 v) { uvec3 b = floatBitsToUint(v) & 0x7f800000u; return any(equal(b, uvec3(0x7f800000u))) || dot(v, v) > 1e8; }
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(tPos, uv);
  vec3 v = texture2D(tVel, uv).xyz;
  if (badv(p.xyz) || badv(v)) { gl_FragColor = vec4(texture2D(tTarget, uv).xyz, 1.0); return; }
  p.xyz += v * uDt;
  gl_FragColor = p;
}
`;

const RENDER_VERT = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tTarget;
uniform sampler2D tPrev;
uniform sampler2D tCol;
uniform sampler2D tColPrev;
uniform float uMorph, uStagger, uSize, uScale, uOpacity, uTime, uTwinkle, uMaxSize, uAlphaK;
attribute vec2 ref;
varying vec4 vColor;
${HASH}
void main() {
  vec3 pos = texture2D(tPos, ref).xyz;
  vec4 rnd = hash42(ref * 1000.0 + 0.5);
  float k = clamp((uMorph - rnd.x * uStagger) / max(1e-4, 1.0 - uStagger), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec4 c = mix(texture2D(tColPrev, ref), texture2D(tCol, ref), k);
  float s = mix(texture2D(tPrev, ref).w, texture2D(tTarget, ref).w, k);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 1.0 + uTwinkle * 0.6 * sin(uTime * (0.7 + rnd.z * 2.6) + rnd.w * 40.0);
  float px = s * uSize * uScale / max(0.05, -mv.z);
  float a = c.a * uOpacity * tw * uAlphaK;
  if (px < 1.2) { a *= px / 1.2; px = 1.2; }
  gl_PointSize = min(px, uMaxSize);
  vColor = vec4(c.rgb, a);
  if (a < 0.002 || mv.z > -0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const RENDER_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 5.5);
  float a = (core + (1.0 - d) * 0.25) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

// Заменить нечисловые значения формы нулями (одна NaN-точка иначе навсегда «отравит» частицу).
function sanitizeShape(s, count) {
  const P = s.positions, C = s.colors, n = Math.min(count * 4, P.length);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(P[i])) { P[i] = 0; bad++; }
    if (C && !Number.isFinite(C[i])) { C[i] = 0; bad++; }
  }
  if (bad) console.warn(`[particles] в форме ${bad} нечисловых значений — заменены нулями`);
}

export const PARTICLE_DEFAULTS = {
  spring: 16,
  damping: 5.5,
  noise: 0.35,
  noiseScale: 0.14,
  noiseSpeed: 0.07,
  swirl: 0,
  swirlR0: 0.8,
  size: 0.062,
  opacity: 1,
  twinkle: 0.25,
  flow: { x: 0, y: 0, z: 0 },
};

export class ParticleField {
  constructor(renderer, { side = 256 } = {}) {
    this.renderer = renderer;
    this.side = side;
    this.count = side * side;
    this.owner = null;
    this.params = { ...PARTICLE_DEFAULTS, flow: { ...PARTICLE_DEFAULTS.flow } };
    this.phaseA = 0;
    this.phaseB = 0;
    this.morphState = { t: 1, burst: 0 };
    this.impulse = 0;
    this.impulseCenter = new THREE.Vector3();
    this.pointer = { enabled: true, radius: 1.6, force: 26, active: 0 };
    this._ray = new THREE.Ray();
    this._inv = new THREE.Matrix4();
    this.morphTween = null;

    const gpu = new GPUComputationRenderer(side, side, renderer);
    this.gpu = gpu;
    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    const r = rng(42);
    const pd = pos0.image.data;
    for (let i = 0; i < this.count; i++) {
      const [x, y, z] = r.inSphere(60);
      pd[i * 4] = x; pd[i * 4 + 1] = y; pd[i * 4 + 2] = z; pd[i * 4 + 3] = 1;
    }
    this.posVar = gpu.addVariable('tPos', POS_SHADER, pos0);
    this.velVar = gpu.addVariable('tVel', VEL_SHADER, vel0);
    gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    // Текстуры целей: текущая и предыдущая форма (позиции+размер, цвет+альфа)
    const mk = () => {
      const t = new THREE.DataTexture(new Float32Array(this.count * 4), side, side, THREE.RGBAFormat, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.tTarget = mk();
    this.tPrev = mk();
    this.tCol = mk();
    this.tColPrev = mk();
    // Стартовая форма — пыль
    this.tTarget.image.data.set(pd);
    this.tPrev.image.data.set(pd);
    const cd = this.tCol.image.data;
    for (let i = 0; i < this.count; i++) { cd[i * 4] = cd[i * 4 + 1] = cd[i * 4 + 2] = 0.8; cd[i * 4 + 3] = 0.0; }
    this.tColPrev.image.data.set(cd);

    const vu = this.velVar.material.uniforms;
    Object.assign(vu, {
      tTarget: { value: this.tTarget },
      tPrev: { value: this.tPrev },
      uTime: { value: 0 },
      uDt: { value: 0.016 },
      uMorph: { value: 1 },
      uStagger: { value: 0.4 },
      uSpring: { value: this.params.spring },
      uDamping: { value: this.params.damping },
      uNoise: { value: this.params.noise },
      uBurst: { value: 0 },
      uNoiseScale: { value: this.params.noiseScale },
      uNoiseSpeed: { value: this.params.noiseSpeed },
      uPhaseA: { value: 0 },
      uPhaseB: { value: 0 },
      uSwirlR0: { value: this.params.swirlR0 },
      uFlow: { value: new THREE.Vector3() },
      uImpulse: { value: 0 },
      uImpulseC: { value: new THREE.Vector3() },
      uRayO: { value: new THREE.Vector3() },
      uRayD: { value: new THREE.Vector3(0, 0, -1) },
      uRayR: { value: this.pointer.radius },
      uRayF: { value: 0 },
    });
    this.posVar.material.uniforms.uDt = { value: 0.016 };
    this.posVar.material.uniforms.tTarget = { value: this.tTarget };
    // Точность: half float там, где float-рендер недоступен
    const gl = renderer.getContext();
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      gpu.setDataType(THREE.HalfFloatType);
    }
    const err = gpu.init();
    if (err) throw new Error('GPGPU: ' + err);
    this.gl = gl;

    // Отрисовка
    const geo = new THREE.BufferGeometry();
    const refs = new Float32Array(this.count * 2);
    for (let y = 0, i = 0; y < side; y++) {
      for (let x = 0; x < side; x++, i++) {
        refs[i * 2] = (x + 0.5) / side;
        refs[i * 2 + 1] = (y + 0.5) / side;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geo.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = {
      tPos: { value: null },
      tTarget: { value: this.tTarget },
      tPrev: { value: this.tPrev },
      tCol: { value: this.tCol },
      tColPrev: { value: this.tColPrev },
      uMorph: { value: 1 },
      uStagger: { value: 0.4 },
      uSize: { value: this.params.size },
      uScale: { value: 600 },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uTwinkle: { value: this.params.twinkle },
      uMaxSize: { value: 64 },
      // при меньшем числе частиц (низкое качество) делаем каждую чуть ярче
      uAlphaK: { value: Math.min(2.2, Math.pow(65536 / this.count, 0.55)) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Points(geo, this.material);
    this.object.frustumCulled = false;
    this.object.name = 'particles';
    this.object.renderOrder = 10;
    const maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.uniforms.uMaxSize.value = Math.min(96, maxPt ? maxPt[1] : 64);
  }

  // Захват частиц визуализацией (режиссёр отправляет «бесхозные» частицы в пыль).
  claim(owner) { this.owner = owner; }
  release(owner) { if (!owner || this.owner === owner) this.owner = null; }

  /**
   * Перетечь в новую форму.
   * @param {object|function} shape  — { positions, colors } или (count) => shape
   * @param {object} o
   *   duration (1.8) — длительность, stagger (0.45) — разброс старта частиц (0..0.9),
   *   burst (14) — сила завихрения в полёте (0 — по прямой), explode (0) — радиальный взрыв в начале,
   *   ease ('power2.inOut'), delay (0), keepSwirl (false) — не сбрасывать вращение формы,
   *   equalize (true) — автоматически гасить слишком плотные места (см. shapes.equalize), equalizeOpts.
   */
  morph(shape, o = {}) {
    const { duration = 1.8, stagger = 0.45, burst = 14, explode = 0, ease = 'power2.inOut', delay = 0, keepSwirl = false } = o;
    const s = typeof shape === 'function' ? shape(this.count) : shape;
    if (!s || !s.positions || s.positions.length < this.count * 4) {
      console.warn('[particles] неверная форма', s);
      return Promise.resolve();
    }
    sanitizeShape(s, this.count);
    if (o.equalize !== false && !s.meta?.equalized) equalize(s, o.equalizeOpts || {});
    const apply = () => {
      // предыдущая цель = текущая
      this.tPrev.image.data.set(this.tTarget.image.data);
      this.tColPrev.image.data.set(this.tCol.image.data);
      this.tTarget.image.data.set(s.positions.subarray(0, this.count * 4));
      this.tCol.image.data.set(s.colors.subarray(0, this.count * 4));
      this.tPrev.needsUpdate = this.tColPrev.needsUpdate = this.tTarget.needsUpdate = this.tCol.needsUpdate = true;
      this.phaseA = this.phaseB;
      if (!keepSwirl) this.phaseB = 0;
      this.uniforms.uStagger.value = this.velVar.material.uniforms.uStagger.value = Math.min(0.9, Math.max(0, stagger));
      if (explode) this.explode(explode);
    };
    if (this.morphTween) this.morphTween.kill();
    const st = this.morphState;
    return new Promise((resolve) => {
      this.morphTween = gsap.timeline({ delay, onComplete: resolve, onInterrupt: resolve })
        .call(apply)
        .fromTo(st, { t: 0, burst }, { t: 1, burst: 0, duration: Math.max(0.01, duration), ease, immediateRender: false });
    });
  }

  /** Мгновенно поставить форму (без анимации), напр. при прямом переходе к слайду. */
  snap(shape) {
    const s = typeof shape === 'function' ? shape(this.count) : shape;
    if (!s || !s.positions) return;
    sanitizeShape(s, this.count);
    if (this.morphTween) this.morphTween.kill();
    this.tTarget.image.data.set(s.positions.subarray(0, this.count * 4));
    this.tPrev.image.data.set(s.positions.subarray(0, this.count * 4));
    this.tCol.image.data.set(s.colors.subarray(0, this.count * 4));
    this.tColPrev.image.data.set(s.colors.subarray(0, this.count * 4));
    this.tPrev.needsUpdate = this.tColPrev.needsUpdate = this.tTarget.needsUpdate = this.tCol.needsUpdate = true;
    this.morphState.t = 1; this.morphState.burst = 0;
    this.phaseA = this.phaseB = 0;
    // переносим позиции частиц прямо в цель
    const tex = this.gpu.createTexture();
    tex.image.data.set(s.positions.subarray(0, this.count * 4));
    for (let i = 0; i < this.count; i++) tex.image.data[i * 4 + 3] = 1;
    this.gpu.renderTexture(tex, this.posVar.renderTargets[0]);
    this.gpu.renderTexture(tex, this.posVar.renderTargets[1]);
    const zero = this.gpu.createTexture();
    this.gpu.renderTexture(zero, this.velVar.renderTargets[0]);
    this.gpu.renderTexture(zero, this.velVar.renderTargets[1]);
    tex.dispose(); zero.dispose();
  }

  /** Плавно изменить параметры движения/вида. */
  setParams(p = {}, duration = 1.2) {
    const target = {};
    for (const k of Object.keys(p)) {
      if (k === 'flow') continue;
      if (k in this.params && Number.isFinite(p[k])) target[k] = p[k];
    }
    if (p.flow) {
      const src = Array.isArray(p.flow) ? { x: p.flow[0], y: p.flow[1], z: p.flow[2] } : p.flow;
      const fl = { x: +src.x || 0, y: +src.y || 0, z: +src.z || 0 };
      if (duration <= 0) Object.assign(this.params.flow, fl);
      else gsap.to(this.params.flow, { ...fl, duration, overwrite: 'auto' });
    }
    if (duration <= 0) Object.assign(this.params, target);
    else gsap.to(this.params, { ...target, duration, ease: 'power2.inOut', overwrite: 'auto' });
  }

  resetParams(duration = 1.2) {
    this.setParams({ ...PARTICLE_DEFAULTS, flow: { x: 0, y: 0, z: 0 } }, duration);
  }

  /** Радиальный «взрыв» из точки (в локальных координатах облака). */
  explode(strength = 8, center = [0, 0, 0]) {
    this.impulse = strength;
    this.impulseCenter.set(center[0], center[1], center[2]);
  }

  setPointer(enabled, { radius, force } = {}) {
    this.pointer.enabled = enabled;
    if (radius != null) this.pointer.radius = radius;
    if (force != null) this.pointer.force = force;
  }

  resize(heightPx, camera) {
    // пиксели на единицу мира на расстоянии 1
    this._heightPx = heightPx;
    this.uniforms.uScale.value = (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  }

  update(dt, t, camera, pointerNdc, pointerActive) {
    const p = this.params;
    if (this._heightPx) this.uniforms.uScale.value = (this._heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    this.phaseB += p.swirl * dt;
    const vu = this.velVar.material.uniforms;
    const subSteps = dt > 1 / 30 ? 2 : 1;
    const step = Math.min(dt / subSteps, 1 / 30);
    vu.uTime.value = t;
    vu.uDt.value = step;
    this.posVar.material.uniforms.uDt.value = step;
    vu.uMorph.value = this.morphState.t;
    vu.uBurst.value = this.morphState.burst;
    vu.uSpring.value = p.spring;
    vu.uDamping.value = p.damping;
    vu.uNoise.value = p.noise;
    vu.uNoiseScale.value = p.noiseScale;
    vu.uNoiseSpeed.value = p.noiseSpeed;
    vu.uPhaseA.value = this.phaseA;
    vu.uPhaseB.value = this.phaseB;
    vu.uSwirlR0.value = p.swirlR0;
    vu.uFlow.value.set(p.flow.x, p.flow.y, p.flow.z);
    vu.uImpulse.value = this.impulse;
    vu.uImpulseC.value.copy(this.impulseCenter);
    this.impulse = 0;

    // Луч от курсора — в локальных координатах облака
    const ptr = this.pointer;
    ptr.active += ((pointerActive && ptr.enabled ? 1 : 0) - ptr.active) * Math.min(1, dt * 4);
    if (ptr.active > 0.01 && pointerNdc) {
      this.object.updateMatrixWorld();
      this._ray.origin.setFromMatrixPosition(camera.matrixWorld);
      this._ray.direction.set(pointerNdc.x, pointerNdc.y, 0.5).unproject(camera).sub(this._ray.origin).normalize();
      this._inv.copy(this.object.matrixWorld).invert();
      this._ray.applyMatrix4(this._inv);
      vu.uRayO.value.copy(this._ray.origin);
      vu.uRayD.value.copy(this._ray.direction).normalize();
      const sc = this.object.scale.x || 1;
      vu.uRayR.value = ptr.radius / sc;
      vu.uRayF.value = ptr.force * ptr.active;
    } else {
      vu.uRayF.value = 0;
    }

    this.gpu.compute();
    if (subSteps > 1) { vu.uImpulse.value = 0; this.gpu.compute(); }
    this.uniforms.tPos.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.uniforms.uMorph.value = this.morphState.t;
    this.uniforms.uSize.value = p.size;
    this.uniforms.uOpacity.value = p.opacity;
    this.uniforms.uTwinkle.value = p.twinkle;
    this.uniforms.uTime.value = t;
  }
}
