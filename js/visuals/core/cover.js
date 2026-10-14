// Заставка лаборатории: знак логотипа собирается из частиц, в центре — «затмение» с зелёной короной.
// Состояния: 'cover' (по умолчанию), 'end' (финал — то же, камера ближе).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import { loadMark, logo, PAL, combine, dust, ball } from '../../core/shapes.js';
import { SIMPLEX } from '../../core/glsl.js';

const W = 4.9;                               // ширина знака в мире
const HOLE = { x: 0.0233 * W, y: -0.0806 * W, r: 0.2088 * W }; // круглый вырез знака

const CORONA_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uPower;
uniform vec3 uColor;
varying vec2 vUv;
${SIMPLEX}
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;           // 0 — центр, 1 — край плоскости
  float a = atan(p.y, p.x);
  float r0 = 0.4;                       // радиус выреза на плоскости
  float n = snoise(vec3(cos(a) * 2.2, sin(a) * 2.2, uTime * 0.25)) * 0.5 + 0.5;
  float n2 = snoise(vec3(cos(a) * 7.0, sin(a) * 7.0, uTime * 0.6)) * 0.5 + 0.5;
  float x = (d - r0) / 0.018;
  float ring = exp(-x * x);
  float outer = d > r0 ? exp(-(d - r0) / (0.07 + 0.12 * n * n2)) : 0.0;
  float glow = ring * 1.2 + outer * (0.45 + 0.8 * n) * uPower;
  vec3 col = mix(uColor, vec3(1.0), ring * 0.7);
  gl_FragColor = vec4(col * glow, clamp(glow, 0.0, 1.0) * uOpacity);
}
`;

export default class Cover extends Visual {
  static transition = 'fade';

  async init() {
    const mark = await loadMark();
    const n = this.ctx.particles.count;
    // Знак из частиц + мягкое гало вокруг (половина частиц), чтобы не было пересвета
    this.shape = combine(n, [
      { weight: 0.55, shape: (m) => logo(m, mark, {
        width: W,
        depth: 0.9,
        size: 1.0,
        alpha: 0.2,
        colorFn: (x, y, r) => {
          const k = r();
          return k < 0.1 ? PAL.greenHi : k < 0.16 ? PAL.bright : PAL.white;
        },
      }) },
      { weight: 0.25, shape: (m) => ball(m, { radius: 5.4, color: PAL.mint, alpha: 0.08, size: 0.8 }), position: [0, -0.3, -3.2], scale: [1, 1, 0.35] },
      { weight: 0.2, shape: (m) => dust(m, { radius: 30, inner: 7, alpha: 0.22, size: 0.7 }) },
    ]);

    this.group = new THREE.Group();
    this.root.add(this.group);

    // «Луна» затмения
    this.eclipse = new THREE.Mesh(
      new THREE.SphereGeometry(HOLE.r * 0.94, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.eclipse.material.userData.noFade = true;
    this.eclipse.position.set(HOLE.x, HOLE.y, 0);
    this.group.add(this.eclipse);

    // Корона
    const size = HOLE.r * 5;
    this.coronaUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uPower: { value: 1 },
      uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.6) },
    };
    this.corona = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        uniforms: this.coronaUniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: CORONA_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.corona.material.userData.noFade = true;
    this.corona.position.copy(this.eclipse.position);
    this.group.add(this.corona);
    this.eclipse.scale.setScalar(0.001);
  }

  camera(state) {
    return state === 'end'
      ? { pos: [0, 0.35, 13.2], target: [0, 0.35, 0], fov: 42 }
      : { pos: [0, 0.2, 14.5], target: [0, 0.35, 0], fov: 42 };
  }

  background() { return 'banner'; }

  /** Где стоит знак: на заставке — в левой половине (справа текст и спикеры), в финале — по центру. */
  placement(state) {
    if (state === 'end') return { x: 0, y: 1.55 };
    return { x: -this.stageRect().w * 0.235, y: 0.25 };
  }

  enter(o = {}) {
    this.state = o.state;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.22, swirl: 0, size: 0.055, twinkle: 0.35, spring: 16, damping: 5.5 }, o.instant ? 0 : 1);
    p.morph(this.shape, { duration: o.instant ? 0.01 : 2.8, stagger: 0.6, burst: 20, explode: o.instant ? 0 : 6 });
    const obj = p.object;
    const pl = this.placement(o.state);
    this.tw(obj.position, { x: pl.x, y: pl.y, z: 0, duration: o.instant ? 0 : 2, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 2, ease: 'power2.inOut' });
    this.fromTo(this.eclipse.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, delay: o.instant ? 0 : 1.4, ease: 'expo.out' });
    this.fromTo(this.coronaUniforms.uOpacity, { value: 0 }, { value: 1, duration: o.instant ? 0 : 2, delay: o.instant ? 0 : 1.8 });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.tw(this.coronaUniforms.uPower, { value: state === 'end' ? 1.6 : 1, duration: 1.5 });
    if (this.ownsParticles()) {
      const pl = this.placement(state);
      this.tw(this.particles.object.position, { x: pl.x, y: pl.y, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    }
  }

  resize() {
    if (!this.active || !this.ownsParticles()) return;
    const pl = this.placement(this.state);
    this.particles.object.position.x = pl.x;
    this.particles.object.position.y = pl.y;
  }

  exit(o = {}) {
    this.tw(this.eclipse.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.6, ease: 'power2.in' });
    this.tw(this.coronaUniforms.uOpacity, { value: 0, duration: 0.5 });
    return super.exit(o);
  }

  update(dt, t) {
    this.coronaUniforms.uTime.value = t;
    const obj = this.particles.object;
    if (this.ownsParticles()) {
      obj.rotation.y = Math.sin(t * 0.23) * 0.2;
      obj.rotation.x = Math.sin(t * 0.17) * 0.05;
      obj.rotation.z = 0;
    }
    // «Затмение» повторяет движение облака-логотипа
    this.group.position.copy(obj.position);
    this.group.rotation.copy(obj.rotation);
    this.group.scale.copy(obj.scale);
    // корона смотрит в камеру
    this.corona.quaternion.copy(this.group.quaternion).invert().multiply(this.ctx.camera.quaternion);
  }
}
