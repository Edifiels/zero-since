// Блиц «Умеет или пока нет?»: справа — эмблема из частиц («?» → зелёная галочка / оранжевые песочные часы),
// на каждый переворот карточки — салют искр от карточки и вспышка эмблемы.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, TAU } from '../../core/utils.js';
import { pointScale, idle } from './util.js';

const VERDICT = [null, 'ok', 'ok', 'ok', 'wow', 'no'];   // по шагам: что показывает эмблема
const SHELLS = 6;
const PER_SHELL = 520;

const FW_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aShell;
attribute float aDelay;
attribute float aSize;
attribute float aMix;
uniform float uTime, uScale, uOpacity;
uniform float uLaunch[${SHELLS}];
uniform vec3 uOrigin[${SHELLS}];
uniform vec3 uColA[${SHELLS}];
uniform vec3 uColB[${SHELLS}];
uniform float uPower[${SHELLS}];
varying vec3 vColor;
varying float vAlpha;
void main() {
  int s = int(aShell + 0.5);
  float t = uTime - uLaunch[s] - aDelay;
  float life = 1.9;
  vec3 p = uOrigin[s];
  float alpha = 0.0;
  if (t > 0.0 && t < life) {
    float k = 1.0 - exp(-t * 3.2);
    p += aDir * k * uPower[s] + vec3(0.0, -0.55, 0.0) * t * t;
    float f = 1.0 - t / life;
    alpha = f * f * (0.75 + 0.25 * sin(t * 40.0 + aDelay * 300.0));
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.05, -mv.z), 1.5, 26.0);
  vColor = mix(uColA[s], uColB[s], aMix);
  vAlpha = alpha * uOpacity;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FW_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 5.0) + (1.0 - d) * 0.25) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}
`;

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Толстая галочка в кольце. */
function checkCanvas() {
  const c = canvas(640, 640), g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 34;
  g.beginPath(); g.arc(320, 320, 280, 0, TAU); g.stroke();
  g.lineWidth = 96;
  g.beginPath(); g.moveTo(170, 335); g.lineTo(280, 445); g.lineTo(480, 215); g.stroke();
  return c;
}

/** Песочные часы («пока нет»). */
function hourglassCanvas() {
  const c = canvas(520, 680), g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 34;
  // рамка
  g.beginPath(); g.moveTo(80, 40); g.lineTo(440, 40); g.stroke();
  g.beginPath(); g.moveTo(80, 640); g.lineTo(440, 640); g.stroke();
  // колба
  g.lineWidth = 22;
  g.beginPath();
  g.moveTo(120, 60); g.bezierCurveTo(120, 230, 230, 290, 240, 340); g.bezierCurveTo(230, 390, 120, 450, 120, 620);
  g.moveTo(400, 60); g.bezierCurveTo(400, 230, 290, 290, 280, 340); g.bezierCurveTo(290, 390, 400, 450, 400, 620);
  g.stroke();
  // песок: остаток сверху и горка снизу
  g.beginPath(); g.moveTo(170, 210); g.lineTo(350, 210); g.lineTo(262, 300); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(140, 615); g.quadraticCurveTo(260, 470, 380, 615); g.closePath(); g.fill();
  g.fillRect(255, 300, 10, 300);
  return c;
}

export default class Blitz extends Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    const r = rng(7);
    // фон — звёздная пыль (общая для всех форм)
    const nBg = Math.floor(n * 0.3);
    const bg = [];
    for (let i = 0; i < nBg; i++) {
      const [x, y, z] = r.onSphere(r.range(18, 55));
      bg.push([x, y * 0.65, -Math.abs(z) - 3, Math.pow(r(), 4) * 2 + 0.4, r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.06, 0.24)]);
    }
    const nFg = n - nBg;
    const withBg = (fg) => {
      const s = S.createShape(n);
      bg.forEach((b, i) => S.setPoint(s, i, b[0], b[1], b[2], b[3], b[4], b[5]));
      s.positions.set(fg.positions.subarray(0, nFg * 4), nBg * 4);
      s.colors.set(fg.colors.subarray(0, nFg * 4), nBg * 4);
      return S.equalize(s, { cell: 0.1, target: 6 });
    };
    // «?»
    const q = S.fromText(nFg, '?', { font: '800 560px Unbounded', width: 4.1, depth: 0.4, colorFn: (x, y, rr) => (rr() < 0.3 ? S.PAL.greenHi : rr() < 0.42 ? S.PAL.bright : S.PAL.white), alpha: 0.75, jitter: 1.2 });
    this.shapeQ = withBg(q);
    await idle();
    // галочка
    const ck = S.fromCanvas(nFg, checkCanvas(), { width: 5.0, depth: 0.7, colorFn: (x, y, rr) => (rr() < 0.4 ? S.PAL.greenHi : rr() < 0.75 ? S.PAL.green : S.PAL.white), alpha: 0.6, jitter: 1.5 });
    this.shapeOk = withBg(ck);
    await idle();
    // галочка-сюрприз: та же, но с «лучами» вокруг
    const rays = S.combine(nFg, [
      { weight: 0.82, shape: (m) => S.fromCanvas(m, checkCanvas(), { width: 5.0, depth: 0.7, colorFn: (x, y, rr) => (rr() < 0.45 ? S.PAL.greenHi : rr() < 0.7 ? S.PAL.bright : S.PAL.white), alpha: 0.6, jitter: 1.5 }) },
      { weight: 0.18, shape: (m) => {
        const s = S.createShape(m), rr = rng(11);
        for (let i = 0; i < m; i++) {
          const a = Math.floor(rr() * 16) / 16 * TAU + rr.gauss(0, 0.02);
          const rad = 3.0 + Math.pow(rr(), 0.8) * 1.6;
          S.setPoint(s, i, Math.cos(a) * rad, Math.sin(a) * rad, rr.gauss(0, 0.1), rr.range(0.5, 1.0), rr() < 0.5 ? S.PAL.greenHi : S.PAL.white, 0.45 * (1 - (rad - 3.0) / 1.7) + 0.05);
        }
        return s;
      } },
    ]);
    this.shapeWow = withBg(rays);
    await idle();
    // песочные часы — оранжевые
    const hg = S.fromCanvas(nFg, hourglassCanvas(), { width: 3.3, depth: 0.5, colorFn: (x, y, rr) => (rr() < 0.5 ? S.scaleColor(S.PAL.orange, 1.25) : rr() < 0.75 ? S.PAL.warm : S.scaleColor(S.PAL.orange, 1.7)), alpha: 0.8, jitter: 1.2 });
    this.shapeNo = withBg(hg);
    await idle();

    // ---------- Салют ----------
    const N = SHELLS * PER_SHELL;
    const geo = new THREE.BufferGeometry();
    const dir = new Float32Array(N * 3), shell = new Float32Array(N), delay = new Float32Array(N), size = new Float32Array(N), mix = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const [x, y, z] = r.onSphere(1);
      const sp = r.range(0.55, 1.0);
      dir[i * 3] = x * sp; dir[i * 3 + 1] = y * sp; dir[i * 3 + 2] = z * sp * 0.6;
      shell[i] = Math.floor(i / PER_SHELL);
      delay[i] = r() * 0.12;
      size[i] = r.range(0.05, 0.12);
      mix[i] = r();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    geo.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
    geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.fwU = {
      uTime: { value: 0 }, uScale: { value: 600 }, uOpacity: { value: 1 },
      uLaunch: { value: new Array(SHELLS).fill(-100) },
      uOrigin: { value: Array.from({ length: SHELLS }, () => new THREE.Vector3()) },
      uColA: { value: Array.from({ length: SHELLS }, () => new THREE.Color(0.4, 1.5, 0.4)) },
      uColB: { value: Array.from({ length: SHELLS }, () => new THREE.Color(1.4, 1.6, 1.4)) },
      uPower: { value: new Array(SHELLS).fill(2.5) },
    };
    this.fw = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: this.fwU, vertexShader: FW_VERT, fragmentShader: FW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fw.frustumCulled = false;
    this.root.add(this.fw);
    this.nextShell = 0;
    this.t = 0;
  }

  emblemPos() {
    const w = this.stageRect(14).w;
    return new THREE.Vector3(w * 0.3, -0.35, 0);
  }

  camera() { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; }
  background(state, step) { return VERDICT[step] === 'no' ? 'left' : 'corners'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.22, swirl: 0, size: 0.06, twinkle: 0.35, spring: 16, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    const e = this.emblemPos();
    this.emblemY = e.y;
    const d = o.instant ? 0 : 1.6;
    // y ведёт update() (плавно, с покачиванием «песочных часов»)
    this.tw(p.object.position, { x: e.x, z: 0, duration: d, ease: 'power2.inOut' });
    if (o.instant) p.object.position.y = e.y;
    this.tw(p.object.rotation, { x: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    this.spinS = { v: 0 };
    this.lastShape = null;
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    this.apply(step, { ...o, prev });
  }

  shapeFor(step) {
    const v = VERDICT[step];
    return v === 'ok' ? this.shapeOk : v === 'wow' ? this.shapeWow : v === 'no' ? this.shapeNo : this.shapeQ;
  }

  apply(step, o = {}) {
    const instant = !!o.instant;
    const fwd = (o.dir ?? 1) >= 0;
    const p = this.particles;
    const shape = this.shapeFor(step);
    const fresh = !instant && fwd && !o.entering && step > 0;
    if (shape !== this.lastShape || fresh) {
      p.morph(shape, { duration: instant ? 0.01 : 1.6, stagger: 0.45, burst: fresh ? 16 : 10, explode: fresh ? (VERDICT[step] === 'wow' ? 12 : 8) : 0 });
      this.lastShape = shape;
    }
    if (fresh) {
      // эмблема делает оборот, из карточки — салют
      this.fromTo(this.spinS, { v: 0 }, { v: TAU, duration: 1.6, ease: 'power3.out', overwrite: true });
      this.salute(step);
      this.ctx.engine.pulse({ aberration: 0.7, flash: VERDICT[step] === 'wow' ? 0.14 : 0.07 }, 0.8);
      if (VERDICT[step] === 'wow') this.ctx.rig.shake(0.1, 0.5);
    }
  }

  /** Салют: залп из карточки и пара залпов вокруг эмблемы. */
  salute(step) {
    const v = VERDICT[step];
    const no = v === 'no';
    const colA = no ? new THREE.Color(1.6, 0.55, 0.1) : new THREE.Color(0.35, 1.5, 0.35);
    const colB = no ? new THREE.Color(1.5, 1.0, 0.45) : new THREE.Color(1.3, 1.6, 1.3);
    const el = this.ctx.deck?.currentEl?.querySelector(`.b4-bz-card[data-n="${step}"]`);
    const e = this.emblemPos();
    const origins = [];
    if (el) {
      const rc = el.getBoundingClientRect();
      origins.push(this.screenToWorld(rc.right + rc.height * 0.35, rc.top + rc.height * 0.5, 0.5));
    }
    origins.push(e.clone().add(new THREE.Vector3(-1.6, 2.2, 0.5)));
    origins.push(e.clone().add(new THREE.Vector3(1.7, 1.6, 0.4)));
    if (v === 'wow') origins.push(e.clone().add(new THREE.Vector3(0.2, -2.4, 0.6)));
    origins.forEach((o, i) => {
      const s = this.nextShell;
      this.nextShell = (this.nextShell + 1) % SHELLS;
      const U = this.fwU;
      U.uOrigin.value[s].copy(o);
      U.uColA.value[s].copy(colA);
      U.uColB.value[s].copy(colB);
      U.uPower.value[s] = i === 0 ? 2.2 : v === 'wow' ? 3.2 : 2.6;
      U.uLaunch.value[s] = this.t + 0.12 + i * 0.22;
    });
  }

  resize() {
    if (!this.active) return;
    const e = this.emblemPos();
    this.emblemY = e.y;
    if (this.ownsParticles()) this.particles.object.position.x = e.x;
  }

  update(dt, t) {
    this.t = t;
    this.fwU.uTime.value = t;
    this.fwU.uScale.value = pointScale(this.ctx);
    if (this.ownsParticles()) {
      const o = this.particles.object;
      const sway = VERDICT[this.step] == null ? Math.sin(t * 0.8) * 0.35 : Math.sin(t * 0.6) * 0.18;
      o.rotation.y = sway + (this.spinS?.v || 0);
      // «пока нет» — песочные часы слегка покачиваются (через y-смещение, без наклона облака)
      const ty = this.emblemY + (VERDICT[this.step] === 'no' ? Math.sin(t * 1.3) * 0.1 : 0);
      o.position.y += (ty - o.position.y) * Math.min(1, dt * 2.5);
    }
  }
}
