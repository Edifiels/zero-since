// «Мораль классики»: частицы складываются в бесконечную петлю-восьмёрку (∞),
// по ней без конца мчится яркая точка — рифма с лодкой. В стороне тускло светится «Цель», к которой
// ведёт пунктир, — но точка туда никогда не сворачивает.
// Шаг 1 («…а то, за что мы его наградили»): на петле загораются бонусы, сыплются «+1», петля разгорается.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU } from '../../core/utils.js';

const A = 3.3;                 // полуширина ∞
const N_TRAIL = 56;
const TILT = [-0.42, -0.3, 0.04]; // наклон петли (x, y, z)
const GOAL = [1.25, 3.05, -0.5];  // «Цель» — над петлёй (в координатах группы)

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * a * uPower;
  gl_FragColor = vec4(uColor * a, a) * uOpacity;
}
`;
const TRAIL_VERT = /* glsl */ `
attribute float aAge;
uniform float uSize, uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = 1.0 - aAge;
  gl_PointSize = max(1.0, uSize * uScale * (0.25 + 0.75 * k) / max(0.1, -mv.z));
  vA = k * k;
}
`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 4.0) * vA * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;
const DASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime;
varying vec2 vUv;
void main() {
  float dash = step(0.5, fract(vUv.x * 9.0 - uTime * 0.5));
  float fade = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.55, 0.95, vUv.x));
  float a = dash * fade * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Лемниската Бернулли (в плоскости XY). */
function lemniscate(u, out) {
  const s = Math.sin(u), c = Math.cos(u);
  const k = 1 / (1 + s * s);
  return out.set(A * c * k, A * s * c * k, 0);
}

export default class Loop extends Visual {
  static transition = 'morph';

  async init() {
    // кривая с параметризацией по длине (для равномерной скорости)
    const pts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < 240; i++) pts.push(lemniscate((i / 240) * TAU, v).clone());
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.curve.arcLengthDivisions = 600;
    this.curve.getLengths();

    this.group = new THREE.Group();
    this.group.rotation.set(TILT[0], TILT[1], TILT[2]);
    this.root.add(this.group);

    // Гонщик: яркое ядро + ореол + шлейф
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.2), side: THREE.DoubleSide });
    this.racer = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), coreMat);
    this.racerGlowU = { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.6) }, uOpacity: { value: 1 }, uPower: { value: 1 } };
    this.racerGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.ShaderMaterial({ uniforms: this.racerGlowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.group.add(this.racer, this.racerGlow);
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(N_TRAIL * 3);
    const age = new Float32Array(N_TRAIL);
    for (let i = 0; i < N_TRAIL; i++) age[i] = i / (N_TRAIL - 1);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.trailU = { uColor: { value: new THREE.Color('#b8ffb0').multiplyScalar(1.4) }, uOpacity: { value: 1 }, uSize: { value: 0.32 }, uScale: { value: 600 } };
    this.trail = new THREE.Points(tg, new THREE.ShaderMaterial({ uniforms: this.trailU, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    // «Цель»: мишень с флажком — тусклая, к ней ведёт пунктир, который обрывается
    this.goal = new THREE.Group();
    this.goal.position.set(GOAL[0], GOAL[1], GOAL[2]);
    // прозрачность цели и пунктира задаём сами (goalK/dashK × общий fade) — иначе общий fade визуализации
    // и пошаговое «приглушение» спорят за одно свойство и картинка дёргается
    const goalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.75), transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    goalMat.userData.noFade = true;
    this.goalMat = goalMat;
    this.goalK = 0.8;
    this.dashK = 1;
    [0.62, 0.42, 0.22].forEach((r) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.05, r, 48), goalMat);
      this.goal.add(ring);
    });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 24), goalMat);
    this.goal.add(dot);
    this.group.add(this.goal);
    // пунктир от петли к цели
    const from = new THREE.Vector3(A * 0.5, 1.12, 0);
    const to = new THREE.Vector3(GOAL[0] - 0.15, GOAL[1] - 0.55, GOAL[2]);
    const dir = to.clone().sub(from);
    const len = dir.length();
    this.dashU = { uColor: { value: new THREE.Color('#ffffff').multiplyScalar(0.85) }, uOpacity: { value: 1 }, uTime: { value: 0 } };
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.045), new THREE.ShaderMaterial({ uniforms: this.dashU, vertexShader: GLOW_VERT, fragmentShader: DASH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    dash.material.userData.noFade = true;
    dash.position.copy(from).add(to).multiplyScalar(0.5);
    dash.rotation.z = Math.atan2(dir.y, dir.x);
    this.group.add(dash);

    // Бонусы на петле (кончики лепестков) — загораются на шаге 1
    this.coinU = [];
    this.coins = [0, Math.PI].map((u, i) => {
      const p = lemniscate(u, new THREE.Vector3());
      const g = new THREE.Group();
      g.position.copy(p);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const gu = { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.2) }, uOpacity: { value: 1 }, uPower: { value: 0.5 } };
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.ShaderMaterial({ uniforms: gu, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.add(ring, glow);
      g.scale.setScalar(0.001);
      this.group.add(g);
      this.coinU.push(gu);
      return { g, ring, glow, u: i * 0.5, flash: 0, t: (i * 0.5 + 0.0) };
    });

    this.shapes = {};
    this.t = 0;            // положение гонщика (0..1 по длине)
    this.speed = 0.36;     // кругов в секунду
    this.lit = 0;          // 0..1 — «награды» включены
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.shape(false);
    this.shape(true);
  }

  shape(lit) {
    const key = lit ? 'lit' : 'base';
    if (this.shapes[key]) return this.shapes[key];
    const n = this.ctx.particles.count;
    const crv = this.curve;
    const v = new THREE.Vector3();
    const s = S.combine(n, [
      // плотная лента петли
      { weight: 0.5, shape: (m) => {
        const sh = S.createShape(m), r = rng(31);
        for (let i = 0; i < m; i++) {
          crv.getPointAt(r(), v);
          const rad = Math.abs(r.gauss(0, lit ? 0.11 : 0.13));
          const [ox, oy, oz] = r.onSphere(rad);
          const c = lit ? (r() < 0.3 ? S.PAL.greenHi : r() < 0.6 ? S.PAL.mint : S.PAL.white) : (r() < 0.1 ? S.PAL.green : r() < 0.35 ? S.PAL.mint : S.PAL.white);
          S.setPoint(sh, i, v.x + ox, v.y + oy, v.z + oz * 1.6, r.range(0.55, 1.1), c, r.range(0.22, 0.5) * (lit ? 1.15 : 1));
        }
        return sh;
      } },
      // широкий ореол
      { weight: 0.22, shape: (m) => {
        const sh = S.createShape(m), r = rng(32);
        for (let i = 0; i < m; i++) {
          crv.getPointAt(r(), v);
          const [ox, oy, oz] = r.inSphere(lit ? 0.85 : 0.6);
          S.setPoint(sh, i, v.x + ox, v.y + oy, v.z + oz, r.range(0.4, 0.8), lit ? S.PAL.green : S.PAL.mint, r.range(0.04, 0.12));
        }
        return sh;
      } },
      // кольца-«орбиты» вокруг петли (космический фон сцены)
      { weight: 0.12, shape: (m) => {
        const sh = S.createShape(m), r = rng(33);
        for (let i = 0; i < m; i++) {
          const k = r() < 0.5 ? 0 : 1;
          const rad = (k ? 5.2 : 4.4) + r.gauss(0, 0.05);
          const a = r() * TAU;
          S.setPoint(sh, i, Math.cos(a) * rad, Math.sin(a) * rad * 0.36, Math.sin(a) * rad * 0.2 - 0.5, r.range(0.4, 0.75), S.PAL.white, r.range(0.05, 0.16));
        }
        return sh;
      } },
      // пыль
      { weight: 0.16, shape: (m) => S.fade(S.dust(m, { radius: 18, inner: 5, size: 0.6, alpha: 0.28, seed: 34 }), 0.8), position: [-2, 0, -6], scale: [1.2, 1, 0.45] },
    ]);
    this.shapes[key] = s;
    return s;
  }

  layoutX() {
    // правая половина сцены 16:9 (поза шага 0: расстояние 14, fov 45). Ядро само подгоняет камеру под
    // экраны уже 16:9 так, что по горизонтали видна та же ширина, — поэтому от пропорций окна не зависит.
    return this.stageRect(14, 45).w * 0.245;
  }

  camera(state, step) {
    return step >= 1
      ? { pos: [0.5, 0.4, 12.9], target: [0.42, 0.1, 0], fov: 45 }
      : { pos: [0, 0.6, 14], target: [0, 0.1, 0], fov: 45 };
  }

  background(state, step) { return step >= 1 ? 'right' : 'none'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.ctx.engine.setFx({ scan: 0 }, 0.6); // на случай, если прошлый слайд оставил сканлайны
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.22, swirl: 0, size: 0.064, twinkle: 0.3, spring: 15, damping: 5.5 }, o.instant ? 0 : 1);
    p.morph(this.shape(this.step >= 1), { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 14 });
    const x = this.layoutX();
    this.group.position.set(x, 0, 0);
    const obj = p.object;
    this.tw(obj.position, { x, y: 0, z: 0, duration: o.instant ? 0 : 1.8, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: TILT[0], y: TILT[1], z: TILT[2], duration: o.instant ? 0 : 1.8, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.8 });
    this.ensureLabels();
    this.lbl.goal.hide();
    if (o.instant) this.lbl.goal.show();
    else this.delay(1.4, () => this.lbl.goal.show());
    this.applyStep(this.step, o.instant, true);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    if (this.ownsParticles() && (step >= 1) !== (prev >= 1)) {
      this.particles.morph(this.shape(step >= 1), { duration: 1.6, stagger: 0.4, burst: 6 });
      if (step > prev) this.particles.explode(3, [0, 0, 0]);
    }
    this.applyStep(step, o.instant, false);
  }

  applyStep(step, instant, entering) {
    const lit = step >= 1 ? 1 : 0;
    const d = instant ? 0 : 1.2;
    this.tw(this, { lit, speed: lit ? 0.48 : 0.36, goalK: lit ? 0.35 : 0.8, dashK: lit ? 0.35 : 1, duration: d, ease: 'power2.inOut', overwrite: 'auto' });
    this.coins.forEach((c, i) => {
      // именованная анимация: быстрый «назад» отменяет ещё не стартовавшее появление (иначе монета «воскреснет»)
      this.twk('coin' + i, c.g.scale, { x: lit ? 1 : 0.001, y: lit ? 1 : 0.001, z: lit ? 1 : 0.001, duration: instant ? 0 : 0.9, delay: lit && !instant ? 0.15 + i * 0.2 : 0, ease: lit ? 'back.out(2)' : 'power2.in' });
    });
    if (lit && !instant && !entering) {
      this.ctx.engine.pulse({ aberration: 0.8, flash: 0.08 }, 0.7);
      this.ctx.background.surge(0.6, 1.4);
    }
    if (!lit) this.pops?.forEach((l) => l.hide());
  }

  ensureLabels() {
    if (this.lbl) return;
    this.lbl = {
      goal: this.label({ html: '<span class="b5-tag3d b5-goal">Цель</span>', object: this.goal, offset: [0, 1.05, 0], visible: false }),
    };
    this.pops = [];
    for (let i = 0; i < 4; i++) this.pops.push(this.label({ html: '<span class="b5-pop">+1</span>', position: [0, 0, 0], visible: false }));
    this.popIdx = 0;
  }

  exit(o = {}) {
    this.lbl && Object.values(this.lbl).forEach((l) => l.hide());
    this.pops?.forEach((l) => l.hide());
    return super.exit(o);
  }

  pop(coin) {
    const lab = this.pops[this.popIdx++ % this.pops.length];
    coin.g.getWorldPosition(this._w);
    lab.setPosition([this._w.x, this._w.y + 0.85, this._w.z]);
    lab.show();
    const span = lab.inner.firstElementChild;
    if (span) { span.classList.remove('is-pop'); void span.offsetWidth; span.classList.add('is-pop'); }
    coin.flash = 1;
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05);
    const prevT = this.t;
    this.t = (this.t + dt * this.speed) % 1;
    const p = this.curve.getPointAt(this.t, this._p);
    this.racer.position.copy(p);
    this.racerGlow.position.copy(p);
    this.racerGlow.quaternion.copy(this.group.quaternion).invert().multiply(this.ctx.camera.quaternion);
    this.racerGlowU.uPower.value = 0.75 + this.lit * 0.6 + Math.sin(t * 12) * 0.08;
    // шлейф: точки на петле позади гонщика
    const tp = this.trailPos;
    const span = 0.16 + this.lit * 0.06;
    for (let i = 0; i < N_TRAIL; i++) {
      let u = this.t - (i / (N_TRAIL - 1)) * span;
      if (u < 0) u += 1;
      this.curve.getPointAt(u, this._q);
      tp[i * 3] = this._q.x; tp[i * 3 + 1] = this._q.y; tp[i * 3 + 2] = this._q.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trailU.uScale.value = this.particles.uniforms.uScale.value;
    this.trailU.uSize.value = 0.3 + this.lit * 0.12;
    // бонусы: вспышка и «+1», когда гонщик проходит кончик лепестка
    for (const c of this.coins) {
      const crossed = prevT <= this.t ? (prevT < c.t && this.t >= c.t) : (prevT < c.t || this.t >= c.t);
      if (crossed && this.lit > 0.5 && this.active) this.pop(c);
      c.flash = Math.max(0, c.flash - dt * 2.2);
      c.ring.rotation.y = Math.sin(t * 1.7 + c.t * 6) * 0.7;
      c.ring.scale.setScalar(1 + c.flash * 0.5);
      c.glow.quaternion.copy(this.group.quaternion).invert().multiply(this.ctx.camera.quaternion);
    }
    this.coinU.forEach((u, i) => { u.uPower.value = 0.4 + this.coins[i].flash * 1.2; });
    this.dashU.uTime.value = t;
    this.dashU.uOpacity.value = this.dashK * this.opacity;
    this.goalMat.opacity = this.goalK * this.opacity;
    // цель повёрнута к зрителю и слегка «дышит»
    this.goal.quaternion.copy(this.group.quaternion).invert().multiply(this.ctx.camera.quaternion);
    this.goal.scale.setScalar(1 + Math.sin(t * 1.3) * 0.04);
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.position.y = Math.sin(t * 0.5) * 0.08;
      this.group.position.y = o.position.y;
    }
  }
}
