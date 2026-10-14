// «Два мозга» (по мотивам ЭЭГ-исследования MIT): слева «Думал сам» — яркий мозг из общего облака,
// густая сеть связей с частыми импульсами и живая ЭЭГ; справа «За меня думал ИИ» — тусклый
// редкий мозг, связи редкие и медленные, ЭЭГ почти плоская. Шаг 1 — связи справа гаснут одна за другой.
import * as THREE from 'three';
import { B7Visual, S, C, localPoints, pulseLines, glowMat, tint, rng, brainAsync, tick } from './common.js';

const SCALE = 2.45;
const BRAIN_Y = 0.55;
const EEG_Y = -2.55;

const EEG_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const EEG_FRAG = /* glsl */ `
uniform float uTime, uAmp, uFreq, uSpeed, uNoise, uOpacity, uFade, uSeed;
uniform vec3 uColor;
varying vec2 vUv;
float wave(float x, float t) {
  return sin(x * uFreq + t * uSpeed + uSeed) * 0.5
       + sin(x * uFreq * 2.3 + t * uSpeed * 1.7 + 1.3 + uSeed) * 0.3
       + sin(x * uFreq * 5.1 - t * uSpeed * 2.9 + 4.0) * 0.22 * uNoise
       + sin(x * uFreq * 9.7 + t * uSpeed * 4.3 + uSeed * 2.0) * 0.14 * uNoise
       + sin(x * uFreq * 17.3 - t * uSpeed * 6.1) * 0.08 * uNoise;
}
void main() {
  float x = vUv.x * 6.2831853;
  float w = wave(x, uTime) * uAmp;
  float d = vUv.y - 0.5 - w;
  float core = exp(-d * d / 0.0011);
  float glow = exp(-d * d / 0.012) * 0.4;
  float grid = (1.0 - smoothstep(0.0, 0.004, abs(fract(vUv.x * 14.0) - 0.5) - 0.495)) * 0.0;
  float mid = exp(-(vUv.y - 0.5) * (vUv.y - 0.5) / 0.00004) * 0.12;
  float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  float v = core + glow + mid + grid;
  gl_FragColor = vec4(uColor * (core * 1.25 + glow + mid), v * edge * uOpacity * uFade);
}
`;

function eegPlane({ color, amp, freq, speed, noise, seed }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: amp }, uFreq: { value: freq }, uSpeed: { value: speed }, uNoise: { value: noise },
      uOpacity: { value: 1 }, uFade: { value: 1 }, uSeed: { value: seed }, uColor: { value: new THREE.Color(color) },
    },
    vertexShader: EEG_VERT,
    fragmentShader: EEG_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.7), mat);
}

/** Узлы внутри объёма мозга и рёбра к ближайшим соседям. */
function brainNet(seed, nodes, k, { bright = 1, speed = [0.5, 1.1], pulse = 1 } = {}) {
  const r = rng(seed);
  const N = [];
  let guard = 0;
  while (N.length < nodes && guard++ < 5000) {
    const [x, y, z] = r.inSphere(1);
    const p = [x * 0.62 * SCALE, y * 0.5 * SCALE + 0.04 * SCALE, z * 0.84 * SCALE];
    if (p[1] < -0.22 * SCALE) continue;
    if (N.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.42)) continue;
    N.push(p);
  }
  const segs = [];
  const seen = new Set();
  N.forEach((a, i) => {
    const d = N.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])]).filter(([j]) => j !== i).sort((u, v) => u[1] - v[1]);
    for (let n = 0; n < k && n < d.length; n++) {
      const j = d[n][0];
      const key = i < j ? i + '-' + j : j + '-' + i;
      if (seen.has(key)) continue;
      seen.add(key);
      segs.push({ a: a, b: N[j], phase: r(), speed: r.range(speed[0], speed[1]) * (r() < 0.5 ? 1 : -1), bright: bright * r.range(0.6, 1), pulse: pulse * r.range(0.6, 1), rank: r() });
    }
  });
  return { nodes: N, segs };
}

export default class Brains extends B7Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    // Левый мозг — общее облако (яркий, плотный). Без ствола: в профиль он превращает мозг в «гриб».
    this.shapeLeft = S.equalize(await brainAsync(n, { scale: SCALE, seed: 9, brightness: 0.8, stem: false }));
    await tick();
    // Правый мозг — свои точки: заметно реже и тусклее левого (серый, без зелёного свечения)
    const dim = await brainAsync(9000, { scale: SCALE, seed: 12, ridge: C.soft, groove: S.scaleColor(C.dim, 0.6), brightness: 0.62, interior: 0.02, stem: false });
    tint(dim, (c, a) => { const l = (c[0] + c[1] + c[2]) / 3; return [l * 0.78, l * 0.82, l * 0.78, a * 0.4]; });
    this.rightPts = localPoints(dim, { size: 0.06, opacity: 1, twinkle: 0.1 });

    // Группы, к которым привязаны сети связей
    this.leftG = new THREE.Group();
    this.rightG = new THREE.Group();
    this.root.add(this.leftG, this.rightG);
    this.rightG.add(this.rightPts);

    const L = brainNet(3, 70, 3, { bright: 1, speed: [0.55, 1.25], pulse: 1 });
    const R = brainNet(5, 24, 2, { bright: 0.55, speed: [0.12, 0.25], pulse: 0.45 });
    this.netL = pulseLines(L.segs, { width: 2.2, color: '#c8ffc0', colorK: 0.42, pulseColor: '#00ff00', pulseK: 2.6, pulseLen: 0.16 });
    this.netR = pulseLines(R.segs, { width: 2.2, color: '#c9d4c9', colorK: 0.6, pulseColor: '#b0bab0', pulseK: 1.2, pulseLen: 0.12 });
    this.leftG.add(this.netL);
    this.rightG.add(this.netR);
    // Узлы-нейроны
    const nodeGeo = new THREE.SphereGeometry(0.06, 12, 8);
    this.nodeMatL = glowMat('#7dff6e', 1.3, 0.85);
    this.nodeMatR = glowMat('#aab4aa', 0.95, 0.8);
    const mkNodes = (pts, mat, g) => {
      const im = new THREE.InstancedMesh(nodeGeo, mat, pts.length);
      const m4 = new THREE.Matrix4();
      pts.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m4); });
      g.add(im);
      return im;
    };
    mkNodes(L.nodes, this.nodeMatL, this.leftG);
    this.nodesR = mkNodes(R.nodes, this.nodeMatR, this.rightG);

    // ЭЭГ под каждым мозгом
    this.eegL = eegPlane({ color: '#5dff4a', amp: 0.24, freq: 3.2, speed: 2.6, noise: 1, seed: 0.3 });
    this.eegR = eegPlane({ color: '#8f998f', amp: 0.06, freq: 1.6, speed: 0.9, noise: 0.25, seed: 2.1 });
    this.root.add(this.eegL, this.eegR);

    this.mats = [this.rightPts.material, this.netL.material, this.netR.material, this.nodeMatL, this.nodeMatR, this.eegL.material, this.eegR.material];
    this.cut = { v: 0 };
    this.boost = { v: 0 };
    this.tL = 0;
  }

  sideX() { return this.stageRect().w * 0.235; }

  basePose(state, step) {
    return step >= 1
      ? { pos: [0, -0.3, 15.6], target: [0, -1.0, 0], fov: 45 }
      : { pos: [0, 0.5, 14.6], target: [0, 0.05, 0], fov: 45 };
  }

  background(state, step) { return 'soft'; }

  layout() {
    const x = this.sideX();
    this.rightG.position.set(x, BRAIN_Y, 0);
    this.eegL.position.set(-x, EEG_Y, 0.5);
    this.eegR.position.set(x, EEG_Y, 0.5);
    return x;
  }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.16, size: 0.05, twinkle: 0.4, spring: 18, damping: 6, opacity: 0.9 }, o.instant ? 0 : 1);
    p.morph(this.shapeLeft, { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 12 });
    const x = this.layout();
    this.tw(p.object.position, { x: -x, y: BRAIN_Y, z: 0, duration: o.instant ? 0 : 1.8, ease: 'power2.inOut', overwrite: 'auto' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.4, overwrite: 'auto' });
    this.labL = this.lab({ html: '<span class="b7-brain-lab is-on">Думал сам</span>', position: [-x, BRAIN_Y + 2.15, 0], visible: false });
    this.labR = this.lab({ html: '<span class="b7-brain-lab">За меня думал ИИ</span>', position: [x, BRAIN_Y + 2.15, 0], visible: false });
    this.delay(o.instant ? 0 : 0.9, () => this.labL.show());
    this.delay(o.instant ? 0 : 1.3, () => this.labR.show());
    // правый мозг «проявляется» из точки
    this.fromTo(this.rightG.scale, { x: 0.6, y: 0.6, z: 0.6 }, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.8, ease: 'power3.out' });
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  applyStep(step, o = {}) {
    const D = (v) => (o.instant ? 0 : v);
    this.tw(this.cut, { v: step >= 1 ? 0.8 : 0, duration: D(step >= 1 ? 3.2 : 1.0), ease: 'power1.inOut', overwrite: 'auto' });
    this.tw(this.boost, { v: step >= 1 ? 1 : 0, duration: D(1.5), overwrite: 'auto' });
    this.tw(this.eegR.material.uniforms.uAmp, { value: step >= 1 ? 0.025 : 0.06, duration: D(2.5), overwrite: 'auto' });
    if (!o.instant && !o.enter) this.ctx.engine.pulse({ aberration: 0.5 }, 0.8);
  }

  onResize() {
    if (!this.active) return;
    const x = this.layout();
    if (this.ownsParticles()) this.particles.object.position.x = -x;
    this.labL?.setPosition([-x, BRAIN_Y + 2.15, 0]);
    this.labR?.setPosition([x, BRAIN_Y + 2.15, 0]);
  }

  update(dt, t) {
    const p = this.particles;
    const swayL = Math.PI / 2 - 0.45 + Math.sin(t * 0.32) * 0.3;
    const swayR = -Math.PI / 2 + 0.45 + Math.sin(t * 0.27 + 1.3) * 0.3;
    if (this.ownsParticles()) {
      const o = p.object;
      o.rotation.set(0.06 + Math.sin(t * 0.21) * 0.04, swayL, 0);
      // «живой» мозг слегка пульсирует
      const beat = 1 + Math.sin(t * 2.4) * 0.012 * (1 + this.boost.v);
      o.scale.setScalar(beat);
      this.leftG.position.copy(o.position);
      this.leftG.rotation.copy(o.rotation);
      this.leftG.scale.copy(o.scale);
    }
    this.rightG.rotation.set(0.06 + Math.sin(t * 0.19) * 0.04, swayR, 0);
    // связи справа гаснут (шаг 1), слева — ускоряются
    const nu = this.netR.material.uniforms;
    nu.uCut.value = this.cut.v;
    this.nodeMatR.uniforms.uFade.value = 1 - this.cut.v * 0.7;
    this.rightPts.material.uniforms.uFade.value = 1 - this.cut.v * 0.35;
    this.netL.material.uniforms.uPulseK.value = 2.8 + this.boost.v * 0.8;
    this.tickMaterials(t, this.mats);
    // скорость импульсов слева чуть выше на шаге 1 (своё время — без скачков)
    this.tL += dt * (1 + this.boost.v * 0.35);
    this.netL.material.uniforms.uTime.value = this.tL;
    this.rightPts.material.uniforms.uScale.value = this.pxScale();
  }
}
