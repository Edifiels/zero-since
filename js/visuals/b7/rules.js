// «Правила»: мозг из частиц; с каждым правилом вокруг него замыкается светящееся кольцо-щит.
// Шаг 4 — пунктирное «ваше» кольцо; шаг 5 — кольца раскручиваются, мозг укрывает щит-сфера:
// «Критическое мышление — главный навык эпохи ИИ».
import * as THREE from 'three';
import { HALFTONE } from '../../core/glsl.js';
import { B7Visual, S, C, Pts, clone, tint, brainAsync, tick } from './common.js';

const RING_VERT = /* glsl */ `
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
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uArc, uTrack, uFlash, uDash, uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float u = vUv.x;
  float on = step(u, uArc);
  float dash = uDash > 0.5 ? step(fract(u * 54.0), 0.55) : 1.0;
  float hd = (u - uArc) * 40.0;
  float head = uArc > 0.001 && uArc < 0.999 ? exp(-hd * hd) : 0.0;
  float shimmer = 0.75 + 0.25 * sin(u * 40.0 - uTime * 3.0);
  float f = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float body = (0.55 + 0.45 * f) * shimmer;
  float a = (on * body * (1.0 + uFlash * 1.5) + head * 2.5) * dash + uTrack * (1.0 - on) * 0.6;
  vec3 col = uColor * (on * body * (1.0 + uFlash) + head * 2.2) * dash + uColor * uTrack * (1.0 - on) * 0.4;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity * uFade);
}
`;

const SHIELD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uCell, uTime, uPulse;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${HALFTONE}
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float f = 1.0 - ndv;
  float rim = f * f * f;
  float band = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 2.0);
  float v = clamp(rim * 0.95 + uPulse * 0.3, 0.0, 1.0);
  float d = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 col = uColor * (d * 0.55 + rim * 1.2 + band * rim * 0.3);
  gl_FragColor = vec4(col, (d * 0.45 + rim) * uOpacity * uFade);
}
`;

const RINGS = [
  { r: 3.2, rot: [1.32, 0.05, 0.28], spin: 0.32 },
  { r: 3.55, rot: [0.22, 1.12, 0.62], spin: -0.26 },
  { r: 3.9, rot: [0.95, -0.82, -0.55], spin: 0.21 },
  { r: 4.3, rot: [1.05, 0.55, 1.25], spin: -0.16, dash: true },
];

export default class Rules extends B7Visual {
  static transition = 'zoom';

  async init() {
    const n = this.ctx.particles.count;
    this.anchor = new THREE.Group();
    this.root.add(this.anchor);
    this.rings = RINGS.map((cfg, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(cfg.dash ? '#ffffff' : '#00ff00').multiplyScalar(cfg.dash ? 1.0 : 1.35) },
          uOpacity: { value: 1 }, uFade: { value: 1 }, uArc: { value: 0 }, uTrack: { value: cfg.dash ? 0 : 0.22 },
          uFlash: { value: 0 }, uDash: { value: cfg.dash ? 1 : 0 }, uTime: { value: 0 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const tilt = new THREE.Group();
      tilt.rotation.set(...cfg.rot);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.r, cfg.dash ? 0.035 : 0.05, 10, 260), mat);
      tilt.add(ring);
      this.anchor.add(tilt);
      return { cfg, mat, ring, tilt, arc: { v: 0 }, flash: { v: 0 }, idx: i };
    });
    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.1) }, uOpacity: { value: 1 }, uFade: { value: 0 }, uCell: { value: 7 }, uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: RING_VERT,
      fragmentShader: SHIELD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(4.7, 64, 48), this.shieldMat);
    this.anchor.add(this.shield);
    this.shieldState = { v: 0, pulse: 0 };
    this.mats = [...this.rings.map((r) => r.mat), this.shieldMat];

    // Мозг + лёгкая аура; на финале — зелёный
    const b = new Pts(n, 23);
    await tick();
    const brain = await brainAsync(Math.round(n * 0.78), { scale: 2.45, seed: 14, brightness: 0.62, stem: false });
    let bi = 0;
    b.add(0.78, () => { const j = (bi++ % brain.count) * 4; const P = brain.positions, Q = brain.colors; return [P[j], P[j + 1], P[j + 2], P[j + 3], [Q[j], Q[j + 1], Q[j + 2]], Q[j + 3]]; });
    b.add(0.22, (r) => { const [x, y, z] = r.onSphere(r.range(2.6, 5.5)); return [x, y * 0.8, z, r.range(0.4, 0.8), r() < 0.7 ? C.white : C.mint, r.range(0.03, 0.12)]; });
    this.shapeBrain = S.equalize(b.done());
    await tick();
    this.shapeGreen = tint(clone(this.shapeBrain), (c, a) => [c[0] * 0.35, Math.min(2.2, c[1] * 1.2 + 0.2), c[2] * 0.32, a]);
    this.spinBoost = { v: 0 };
  }

  cx() { return this.stageRect().w * 0.245; }

  basePose(state, step) {
    if (step >= 5) return { pos: [-0.6, 0.6, 15.4], target: [0.8, 0.1, 0], fov: 45 };
    return { pos: [0.4, 0.5, 14.6], target: [0.6, 0, 0], fov: 45 };
  }

  background(state, step) { return step >= 5 ? 'right' : 'corner'; }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.22, size: 0.054, twinkle: 0.35, spring: 16, damping: 5.5, opacity: 0.9 }, o.instant ? 0 : 1);
    const x = this.cx();
    this.anchor.position.set(x, 0.1, 0);
    this.tw(p.object.position, { x, y: 0.1, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut', overwrite: 'auto' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.4, overwrite: 'auto' });
    // кольца — сразу в состояние шага (без «замыкания»)
    this.rings.forEach((r) => { r.arc.v = r.want = this.target(r.idx, this.step); r.flash.v = 0; });
    this.shieldState.v = this.step >= 5 ? 1 : 0;
    this.spinBoost.v = this.step >= 5 ? 1 : 0;
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  target(i, step) { return i < 3 ? (step >= i + 1 ? 1 : 0) : (step >= 4 ? 1 : 0); }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  applyStep(step, o = {}) {
    const D = (v) => (o.instant ? 0 : v);
    const fwd = (o.dir ?? 1) > 0;
    this.rings.forEach((r) => {
      const t = this.target(r.idx, step);
      // кольцо уже идёт (или пришло) к нужному виду — не трогаем; иначе — именованная анимация:
      // она отменяет отложенное «замыкание» прошлого шага, даже если то ещё не стартовало
      if (r.want === t) return;
      r.want = t;
      const closing = t > r.arc.v;
      this.twk('arc' + r.idx, r.arc, {
        v: t,
        duration: D(closing ? 1.35 : 0.6),
        delay: D(closing && !o.enter ? 0.25 : 0),
        ease: closing ? 'power2.inOut' : 'power2.in',
        onComplete: () => {
          if (!closing || o.instant) return;
          this.fromTo(r.flash, { v: 1 }, { v: 0, duration: 1.1, ease: 'power2.out' });
          if (fwd && r.idx < 3) { this.ctx.engine.pulse({ aberration: 0.55 }, 0.7); this.ctx.background.surge(0.35, 1.1); }
        },
      });
    });
    this.twk('shield', this.shieldState, { v: step >= 5 ? 1 : 0, duration: D(step >= 5 ? 1.6 : 0.8) });
    this.twk('spin', this.spinBoost, { v: step >= 5 ? 1 : 0, duration: D(1.8) });
    if (step >= 5 && !o.instant && !o.enter) {
      this.fromTo(this.shieldState, { pulse: 1 }, { pulse: 0, duration: 1.8, ease: 'power2.out' });
      this.ctx.engine.pulse({ aberration: 0.9, flash: 0.08 }, 1.0);
      this.ctx.background.surge(0.8, 1.6);
    }
    if (this.ownsParticles()) {
      this.particles.morph(step >= 5 ? this.shapeGreen : this.shapeBrain, { duration: D(o.enter ? 2.2 : 1.6), stagger: o.enter ? 0.5 : 0.4, burst: o.enter ? 12 : 6 });
      if (step >= 5 && !o.instant && !o.enter) this.delay(0.4, () => this.ownsParticles() && this.particles.explode(3));
    }
  }

  onResize() {
    if (!this.active) return;
    const x = this.cx();
    this.anchor.position.x = x;
    if (this.ownsParticles()) this.particles.object.position.x = x;
  }

  update(dt, t) {
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.set(Math.sin(t * 0.23) * 0.05, -Math.PI / 2 + 0.5 + Math.sin(t * 0.3) * 0.4, 0);
    }
    const boost = 1 + this.spinBoost.v * 1.4;
    for (const r of this.rings) {
      r.ring.rotation.z += dt * r.cfg.spin * boost;
      const u = r.mat.uniforms;
      u.uArc.value = r.arc.v;
      u.uFlash.value = r.flash.v + this.spinBoost.v * 0.12;
      u.uTime.value = t;
      if (r.cfg.dash) u.uFade.value = 0.55 + 0.45 * Math.sin(t * 2.4) * Math.sin(t * 2.4);
    }
    const sv = this.shieldState.v;
    this.shield.visible = sv > 0.002;
    this.shieldMat.uniforms.uFade.value = sv * 0.42;
    this.shieldMat.uniforms.uPulse.value = this.shieldState.pulse;
    this.shield.scale.setScalar(0.85 + 0.15 * sv + this.shieldState.pulse * 0.06);
    this.shield.rotation.y = t * 0.1;
    this.tickMaterials(t, this.mats);
  }
}
