// «Космос → разум»: Галактика, космическая паутина, сеть нейронов, мозг, звёздное небо.
// Состояния (контракт: их использует и часть b8 — каждое входит напрямую и через setState из любого другого):
//   'galaxy'      — спиральная Галактика (шаг 1 — та же сцена, Галактика уходит вправо под текст слева);
//   'web'         — космическая паутина (наша Галактика — точка в узле); шаг 1 — морфинг в сеть нейронов с импульсами;
//   'neurons'     — сеть нейронов с бегущими импульсами (шаг 1 — волна импульсов под название лекции);
//   'neurons-dim' — та же сеть, приглушённая и сдвинутая вправо (слева текст); шаг 1 — сеть разгорается волной;
//   'versus'      — слева Галактика, справа мозг; шаг 1 — мозг загорается сетью связей;
//   'sky'         — звёздное небо: купол с полосой Млечного Пути и созвездиями.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import {
  particleRanks, skyDomeJob, constellationGeometry, celestialGrid, lineMaterial, lineGeometry, starMaterial,
  Pulses, NodeGlows, pxScale, copyPoint, primePrograms,
} from './common.js';
import { galaxyShape, buildNetwork, tintShape, versusShapes, brainLinks, VERSUS, NET_TILT } from './shapes-b1.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const SKY_R = 46;
const TAU = Math.PI * 2;
// «Закручивание» следа ракеты в Галактику: swirl облака по профилю S0·(1 − smoothstep(0, D, τ)).
// Накопленный поворот P = S0·D/2 заранее «раскручен» в форме galaxyCoil — в конце Галактика точно та же, что galaxy.
const COIL = { S0: 1.2, D: 3.8 };
const COIL_PHASE = COIL.S0 * COIL.D / 2;
const SPIN = 0.035;   // медленное вращение Галактики (рад/с) — поворотом всего облака, без «закручивания» рукавов

// Параметры облака для каждой формы
const PARAMS = {
  galaxy: { noise: 0.14, size: 0.052, twinkle: 0.3, spring: 14, damping: 5.2, opacity: 1 },
  web: { noise: 0.22, size: 0.06, twinkle: 0.35, spring: 15, damping: 5.4, opacity: 1 },
  neurons: { noise: 0.16, size: 0.058, twinkle: 0.2, spring: 16, damping: 5.5, opacity: 1 },
  neuronsDim: { noise: 0.16, size: 0.056, twinkle: 0.2, spring: 16, damping: 5.5, opacity: 1 },
  neuronsLit: { noise: 0.16, size: 0.058, twinkle: 0.25, spring: 16, damping: 5.5, opacity: 1 },
  versus: { noise: 0.14, size: 0.05, twinkle: 0.3, spring: 15, damping: 5.4, opacity: 1 },
  versusLit: { noise: 0.14, size: 0.05, twinkle: 0.35, spring: 15, damping: 5.4, opacity: 1 },
  sky: { noise: 0.04, size: 0.085, twinkle: 0.55, spring: 14, damping: 5.2, opacity: 1 },
};

export default class Cosmos extends Visual {
  static transition = 'morph';

  async init() {
    const n = this.particles.count;
    this.n = n;
    this.ranks = particleRanks(n);
    this.sh = {};
    this.sh.galaxy = galaxyShape(n, this.ranks, { radius: 6.6 });
    await tick();
    this.sh.galaxyCoil = galaxyShape(n, this.ranks, { radius: 6.6, unwind: COIL_PHASE });
    await tick();
    this.net = buildNetwork(n, { galaxy: this.sh.galaxy, ranks: this.ranks });
    this.sh.web = this.net.web;
    this.sh.neurons = this.net.neurons;
    this.sh.neuronsDim = tintShape(this.net.neurons, { alpha: 0.38, color: 0.85 });
    this.sh.neuronsLit = tintShape(this.net.neurons, { alpha: 0.8 });
    await tick();
    const vs = versusShapes(n);
    this.sh.versus = vs.base;
    this.sh.versusLit = vs.lit;
    await tick();
    const domeJob = skyDomeJob(n, { radius: SKY_R, seed: 53, bandFrac: 0.84 });
    let it;
    while (!(it = domeJob.next()).done) await tick();
    const dome = it.value;
    const sky = S.createShape(n);
    for (let i = 0; i < n; i++) copyPoint(sky, i, dome, i);
    sky.meta.equalized = true;
    this.sh.sky = sky;

    // Наложения следуют за облаком частиц (копируют его положение/поворот/масштаб)
    this.group = new THREE.Group();
    this.root.add(this.group);
    this.pulses = new Pulses(this.net.curves, { count: 240, tail: 7, size: 0.15, speed: [0.14, 0.3], colA: [0.6, 1.9, 0.65], colB: [0.08, 0.7, 0.15] });
    this.group.add(this.pulses.points);
    this.glows = new NodeGlows(this.net.nodes, { size: 0.24, base: 0.15, color: [0.22, 0.95, 0.28], flash: [0.95, 1.5, 1.0] });
    this.group.add(this.glows.points);
    this._onArrive = (i) => this.glows.hit(i, 0.9);
    this.waveHit = new Uint8Array(this.net.nodes.length);

    // Кольцо-указатель «Наша Галактика»
    const RS = 128, rp = new Float32Array(RS * 6), ra = new Float32Array(RS * 2), rt = new Float32Array(RS * 2);
    for (let k = 0; k < RS; k++) {
      const a0 = (k / RS) * Math.PI * 2 + Math.PI / 2, a1 = ((k + 1) / RS) * Math.PI * 2 + Math.PI / 2;
      rp.set([Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0], k * 6);
      const dash = (k % 8) < 5 ? 1 : 0.15;
      ra.set([dash, dash], k * 2);
      rt.set([k / RS, (k + 1) / RS], k * 2);
    }
    this.ringMat = lineMaterial({ color: '#00ff2a', k: 1.5 });
    this.ring = new THREE.LineSegments(lineGeometry(rp, ra, rt), this.ringMat);
    this.ring.scale.setScalar(1.05);
    this.ring.rotation.x = -NET_TILT;
    this.ring.frustumCulled = false;
    this.group.add(this.ring);
    this.label3 = this.label({ html: '<span class="b1-tag"><i></i>Наша Галактика</span>', object: this.group, offset: [0, 1.42 * Math.cos(NET_TILT), -1.42 * Math.sin(NET_TILT)], visible: false });

    // Связи в мозге (вопрос №2)
    const bl = brainLinks(vs.brainPositions, vs.brainCount, { center: VERSUS.brain.position, minDist: 0.8, maxDist: 2.4, count: 240 });
    this.brainMat = lineMaterial({ color: '#5dff6a', k: 1.25 });
    this.brainLines = new THREE.LineSegments(lineGeometry(bl.lines.positions, bl.lines.alphas, bl.lines.ts), this.brainMat);
    this.brainLines.frustumCulled = false;
    this.group.add(this.brainLines);
    this.brainPulses = new Pulses(bl.curves, { count: 300, tail: 6, size: 0.13, speed: [0.3, 0.6], seed: 8, colA: [1.0, 1.9, 1.05], colB: [0.1, 0.75, 0.2] });
    this.group.add(this.brainPulses.points);

    // Небо: созвездия и тонкая сетка
    this.skyGroup = new THREE.Group();
    this.group.add(this.skyGroup);
    const con = constellationGeometry(SKY_R - 1);
    this.conMat = lineMaterial({ color: '#ffffff', k: 0.62 });
    const conLines = new THREE.LineSegments(lineGeometry(con.segs, new Float32Array(con.segs.length / 3).fill(0.6)), this.conMat);
    conLines.frustumCulled = false;
    this.skyGroup.add(conLines);
    const ns = con.stars.length;
    const sp = new Float32Array(ns * 3), ss = new Float32Array(ns), sc = new Float32Array(ns * 3), ph = new Float32Array(ns);
    con.stars.forEach((st, i) => {
      sp.set([st.p.x, st.p.y, st.p.z], i * 3);
      ss[i] = 0.3 + st.m * 0.7;
      sc.set(i % 5 === 0 ? [0.75, 1.6, 0.8] : [1.25, 1.3, 1.25], i * 3);
      ph[i] = (i * 0.618) % 1;
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    sg.setAttribute('aColor', new THREE.BufferAttribute(sc, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.conStarMat = starMaterial();
    const conStars = new THREE.Points(sg, this.conStarMat);
    conStars.frustumCulled = false;
    this.skyGroup.add(conStars);
    const grid = celestialGrid(SKY_R + 4);
    this.gridMat = lineMaterial({ color: '#2cff3a', k: 0.45 });
    const gridLines = new THREE.LineSegments(lineGeometry(grid.positions, grid.alphas, grid.ts), this.gridMat);
    gridLines.frustumCulled = false;
    this.skyGroup.add(gridLines);

    // «Ручки» наложений
    this.k = { pulses: 0, glows: 0, ring: 0, ringP: 0, brain: 0, brainP: 0, sky: 0 };
    this.obj = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, wob: 0 };
    this.coil = { tau: -1 };          // таймер «закручивания» (−1 — выключено)
    this.spin = { a: 0, rate: 0 };    // вращение Галактики целиком
    this.curKey = null;
    this.time = 0;
    this.waveOn = false;
    this.waveK = 1;
    this.wasWave = false;
    primePrograms(this);
  }

  dispose() {
    this._disposed = true;
    super.dispose();
  }

  // ---------- Состояние → форма, камера, фон ----------
  shapeKey(state, step) {
    switch (state) {
      case 'web': return step >= 1 ? 'neurons' : 'web';
      case 'neurons': return 'neurons';
      case 'neurons-dim': return step >= 1 ? 'neuronsLit' : 'neuronsDim';
      case 'versus': return step >= 1 ? 'versusLit' : 'versus';
      case 'sky': return 'sky';
      default: return 'galaxy';
    }
  }

  // Позы — для сцены 16:9; под экраны 4:3/16:10 их подгоняет режиссёр (fitPose).
  camera(state, step) {
    switch (state) {
      case 'web':
        return step >= 1
          ? { pos: [0, 0.5, 16], target: [0, 0, 0], fov: 45 }
          : { pos: [0, 1.6, 20.5], target: [0, 0.15, 0], fov: 45 };
      case 'neurons':
      case 'neurons-dim':
        return { pos: [0, 0.4, 15.5], target: [0, 0, 0], fov: 45 };
      case 'versus':
        return { pos: [0, 0, 16], target: [0, 0, 0], fov: 45 };
      case 'sky':
        return { pos: [0, 1.2, 0.3], target: [0, 10.5, -24], fov: 58 };
      default:
        return step >= 1
          ? { pos: [-4.6, 9.9, 7.5], target: [-4.6, -0.4, 0], fov: 45 }
          : { pos: [0, 11.0, 8.2], target: [0, -0.3, 0], fov: 45 };
    }
  }

  background(state, step) {
    switch (state) {
      case 'web': return { glows: [[0.95, -0.62, 0.5, 0.36], [-0.95, 0.62, 0.45, 0.28]] };
      case 'neurons': return step >= 1 ? { glows: [[0.62, -0.74, 0.7, 0.95]], band: [1.05, -0.48, 0.12, -0.08] } : { glows: [[0.92, -0.58, 0.55, 0.42], [-0.92, 0.58, 0.42, 0.3]] };
      case 'neurons-dim': return step >= 1 ? { glows: [[0.95, -0.6, 0.6, 0.55]] } : { glows: [[0.95, -0.6, 0.55, 0.36]] };
      case 'versus': return { glows: [[0.0, -0.82, 0.7, 0.3]] };
      case 'sky': return { glows: [], band: [0.3, -0.47, 0.07, 0.0] };
      default: return { glows: [[0.92, -0.58, 0.5, 0.4], [-0.95, 0.58, 0.4, 0.28]] };
    }
  }

  objectTarget(state, step) {
    switch (state) {
      case 'web': case 'neurons': return { x: 0, y: 0, z: 0, rx: NET_TILT, ry: 0, rz: 0, s: 1, wob: 1 };
      // целиком в правой половине сцены: слева — колонка счётчиков, сеть не должна заходить под цифры
      case 'neurons-dim': return { x: 6.0, y: -0.45, z: 0, rx: NET_TILT, ry: -0.22, rz: 0, s: 0.6, wob: 0.6 };
      case 'versus': return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, wob: 0 };
      case 'sky': return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, wob: 0 };
      default: return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, wob: 0 };
    }
  }

  morphOpts(from, to, o) {
    if (o.instant) return { duration: 0.01, stagger: 0, burst: 0 };
    if (o.coil) return { duration: 3.4, stagger: 0.8, burst: 4 };
    // вход из другой сцены (в т. ч. короткие слайды «обратного пути» части b8) — форма складывается быстрее
    if (!from) return { duration: 2.3, stagger: 0.45, burst: 7 };
    if (from === 'galaxy' && to === 'web') return { duration: 3.4, stagger: 0.72, burst: 5 };
    if ((from === 'web' && to === 'neurons') || (from === 'neurons' && to === 'web')) return { duration: 2.8, stagger: 0.5, burst: 3 };
    if (from.startsWith('neurons') && to.startsWith('neurons')) return { duration: 1.4, stagger: 0.2, burst: 0 };
    if (from.startsWith('versus') && to.startsWith('versus')) return { duration: 1.5, stagger: 0.3, burst: 0.5 };
    return { duration: 2.6, stagger: 0.55, burst: 8 };
  }

  // ---------- Применить состояние и шаг ----------
  // Все отложенные анимации — «именованные» (twk): новая с тем же ключом отменяет ждущую старта,
  // поэтому быстрые клики вперёд-назад не «воскрешают» импульсы, кольцо или связи мозга.
  apply(state, step, o = {}) {
    const key = this.shapeKey(state, step);
    const p = this.particles;
    const inst = !!o.instant;
    const fresh = !this.curKey;   // вход из другой сцены: наложения ждут, пока сложится форма
    this.claimParticles();
    // swirl облака ведёт update() (закручивание следа), чужие твины swirl гасим
    this.ctx.gsap.killTweensOf(p.params, 'swirl');
    p.setParams(PARAMS[key], inst ? 0 : 1.4);
    if (key !== this.curKey) {
      const shape = key === 'galaxy' && o.coil ? this.sh.galaxyCoil : this.sh[key];
      if (!o.coil) this.coil.tau = -1;
      p.morph(shape, this.morphOpts(this.curKey, key, o));
      this.curKey = key;
    }
    // Галактика медленно вращается целиком; при уходе — довернуть до целого оборота
    if (key === 'galaxy') {
      this.killKey('spin');
      this.spin.rate = SPIN;
    } else if (this.spin.rate || this.spin.a) {
      this.spin.rate = 0;
      const a = this.spin.a % TAU;
      this.spin.a = a > Math.PI ? a - TAU : a;
      this.twk('spin', this.spin, { a: 0, duration: inst ? 0 : 1.8, ease: 'power2.inOut' });
    }
    const ot = this.objectTarget(state, step);
    this.twk('obj', this.obj, { ...ot, duration: inst ? 0 : (o.entering ? 1.8 : 1.6), ease: 'power2.inOut' });

    // наложения
    const kk = {
      pulses: key === 'neurons' ? 1 : key === 'neuronsLit' ? 0.9 : key === 'neuronsDim' ? 0.4 : 0,
      glows: key === 'neurons' ? 1 : key === 'neuronsLit' ? 0.9 : key === 'neuronsDim' ? 0.35 : 0,
      ring: key === 'web' ? 1 : 0,
      brain: key === 'versusLit' ? 1 : 0,
      sky: key === 'sky' ? 1 : 0,
    };
    // импульсы бегут по готовым связям: после морфинга паутины в нейроны или после сборки сети при входе
    const netDelay = inst || kk.pulses <= this.k.pulses ? 0 : this.lastKey === 'web' ? 1.4 : fresh ? 1.5 : 0;
    this.twk('net', this.k, { pulses: kk.pulses, glows: kk.glows, duration: inst ? 0 : 1.4, delay: netDelay });
    this.twk('sky', this.k, { sky: kk.sky, duration: inst ? 0 : 2.2, delay: inst || !kk.sky ? 0 : 1.0 });
    // кольцо «Наша Галактика»: рисуется после отъезда камеры (при возврате из нейронов — быстрее)
    if (kk.ring) {
      if (this.lastKey !== 'web') {
        const d = inst ? 0 : this.lastKey === 'neurons' ? 1.2 : 2.4;
        this.k.ringP = 0;
        this.twk('ring', this.k, { ring: 1, duration: inst ? 0 : 0.6, delay: d });
        this.twk('ringP', this.k, { ringP: 1, duration: inst ? 0 : 1.3, delay: d, ease: 'power2.inOut' });
        if (inst) this.label3.show();
        else this.twk('label', this.k, { duration: d + 0.5, onComplete: () => { if (this.curKey === 'web' && this.active) this.label3.show(); } });
      }
    } else {
      this.twk('ring', this.k, { ring: 0, duration: inst ? 0 : 0.5 });
      this.killKey('ringP');
      this.killKey('label');
      this.label3.hide();
    }
    // мозг загорается связями
    if (kk.brain) {
      if (this.lastKey !== 'versusLit') {
        this.k.brainP = 0;
        this.twk('brain', this.k, { brain: 1, duration: inst ? 0 : 0.6, delay: inst ? 0 : 0.2 });
        this.twk('brainP', this.k, { brainP: 1, duration: inst ? 0 : 2.6, delay: inst ? 0 : 0.2, ease: 'power1.inOut' });
        if (!inst) this.ctx.engine.pulse({ flash: 0.08 }, 0.8);
      }
    } else {
      this.twk('brain', this.k, { brain: 0, duration: inst ? 0 : 0.6 });
      this.killKey('brainP');
    }
    // волна импульсов: под название лекции (сильная) и на счётчике нейронов (мягкая)
    const fwd = (o.dir ?? 1) > 0 && !inst;
    const wave = (state === 'neurons' && step >= 1) || key === 'neuronsLit';
    if (wave && !this.wasWave && fwd) this.startWave(key === 'neuronsLit' ? 0.55 : 1);
    if (!wave) this.stopWave(inst);
    this.wasWave = wave;
    this.lastKey = key;
  }

  killKey(key) {
    const t = this._keyed?.get(key);
    if (t) { t.kill(); this._keyed.delete(key); }
  }

  /** Волна импульсов от центрального нейрона: power — 1 (название лекции) … 0,5 (мягкая). */
  startWave(power = 1) {
    const u = this.pulses.uniforms;
    u.uWaveC.value.set(0, 0, 0);
    this.waveHit.fill(0);
    this.waveOn = true;
    this.waveK = power;
    u.uWaveR.value = 0;
    u.uWaveAmp.value = 2.8 * power;
    this.twk('waveR', u.uWaveR, { value: 24, duration: 2.8, ease: 'power1.out', delay: 0.25 });
    this.twk('waveA', u.uWaveAmp, { value: 0, duration: 3.0, ease: 'power1.in', delay: 0.25 });
    this.pulses.rate = 1 + 1.8 * power;
    this.twk('rate', this.pulses, { rate: 1, duration: 3.4, ease: 'power2.out' });
    this.glows.hit(this.net.center, 2 * power);
    this.ctx.engine.pulse({ flash: 0.12 * power, aberration: 0.7 * power }, 1.0);
    this.ctx.background.surge(0.9 * power, 2.4);
    this.particles.explode(1.4 * power, [0, 0, 0]);
  }

  stopWave(instant = false) {
    this.waveOn = false;
    const u = this.pulses.uniforms;
    this.killKey('waveR');
    this.twk('waveA', u.uWaveAmp, { value: 0, duration: instant ? 0 : 0.4 });
    this.twk('rate', this.pulses, { rate: 1, duration: instant ? 0 : 0.6 });
  }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state || 'galaxy';
    this.step = o.step ?? 0;
    this.active = true;
    this.curKey = null;
    this.lastKey = null;
    this.waveOn = false;
    this.wasWave = false;
    this.pulses.uniforms.uWaveAmp.value = 0;
    this.pulses.rate = 1;
    const obj = this.particles.object;
    Object.assign(this.obj, { x: obj.position.x, y: obj.position.y, z: obj.position.z, rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z, s: obj.scale.x, wob: 0 });
    Object.assign(this.k, { pulses: 0, glows: 0, ring: 0, ringP: 0, brain: 0, brainP: 0, sky: 0 });
    this.label3.hide();
    this.spin.a = 0;
    // след ракеты закручивается в спираль Млечного Пути
    const coil = this.state === 'galaxy' && o.prev && o.prev.id === 'b1-vostok' && !o.instant;
    this.coil.tau = coil ? 0 : -1;
    this.apply(this.state, this.step, { ...o, coil, entering: true });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.step = o.step ?? 0;
    this.apply(state, this.step, o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(this.state, step, o);
  }

  exit(o = {}) {
    this.killKey('label');
    this.label3.hide();
    this.waveOn = false;
    return super.exit(o);
  }

  // ---------- Кадр ----------
  update(dt, t) {
    this.time += dt;
    const own = this.ownsParticles();
    const po = this.particles.object;
    if (own) {
      // swirl: только «закручивание» следа при входе из сцены ракеты, профиль S0·(1 − smoothstep)
      let sw = 0;
      if (this.coil.tau >= 0) {
        const tau0 = this.coil.tau;
        this.coil.tau += dt;
        if (this.coil.tau < COIL.D) {
          const x = Math.min(1, (tau0 + dt * 0.5) / COIL.D);
          sw = COIL.S0 * (1 - x * x * (3 - 2 * x));
        } else {
          // добор до точного угла: тогда «раскрученная» форма закручивается ровно в задуманную спираль
          const rest = COIL_PHASE - this.particles.phaseB;
          if (rest > 0.002 && this.coil.tau < COIL.D + 2) sw = Math.min(rest / Math.max(dt, 1e-3), 0.3);
          else this.coil.tau = -1;
        }
      }
      this.particles.params.swirl = sw;
      this.spin.a += dt * this.spin.rate;
      const o = this.obj;
      const wob = o.wob * (Math.sin(t * 0.13) * 0.16 + Math.sin(t * 0.071 + 1.3) * 0.07);
      po.position.set(o.x, o.y, o.z);
      po.rotation.set(o.rx + o.wob * Math.sin(t * 0.09) * 0.04, o.ry + wob + this.spin.a, o.rz);
      po.scale.setScalar(o.s);
    }
    this.group.position.copy(po.position);
    this.group.rotation.copy(po.rotation);
    this.group.scale.copy(po.scale);

    const scale = pxScale(this.ctx) * (po.scale.x || 1);
    const k = this.k;
    // импульсы и вспышки нейронов
    const pu = this.pulses.uniforms;
    pu.uScale.value = scale;
    pu.uAlpha.value = k.pulses;
    this.pulses.points.visible = k.pulses > 0.003;
    this.pulses.update(dt, k.glows > 0.05 ? this._onArrive : null);
    this.glows.uniforms.uScale.value = scale;
    this.glows.uniforms.uAlpha.value = k.glows;
    this.glows.points.visible = k.glows > 0.003;
    if (this.waveOn) {
      const R = pu.uWaveR.value;
      const nodes = this.net.nodes;
      for (let i = 0; i < nodes.length; i++) {
        if (this.waveHit[i]) continue;
        const p = nodes[i];
        if (Math.hypot(p[0], p[1], p[2]) < R) { this.waveHit[i] = 1; this.glows.hit(i, 1.5 * this.waveK); }
      }
      if (R > 23.5) this.waveOn = false;
    }
    if (k.glows > 0.003) this.glows.update(dt);
    // кольцо «Наша Галактика»
    this.ringMat.uniforms.uAlpha.value = k.ring;
    this.ringMat.uniforms.uProgress.value = k.ringP * 1.05;
    this.ring.visible = k.ring > 0.003;
    this.ring.rotation.z = t * 0.12;

    // связи мозга
    this.brainMat.uniforms.uAlpha.value = k.brain;
    this.brainMat.uniforms.uProgress.value = k.brainP * 1.05;
    this.brainLines.visible = k.brain > 0.003;
    const bp = this.brainPulses.uniforms;
    bp.uScale.value = scale;
    bp.uAlpha.value = k.brain * Math.min(1, k.brainP * 1.6);
    this.brainPulses.points.visible = k.brain > 0.003;
    if (this.brainPulses.points.visible) this.brainPulses.update(dt, null);
    // небо
    this.skyGroup.visible = k.sky > 0.003;
    this.conMat.uniforms.uAlpha.value = k.sky;
    this.gridMat.uniforms.uAlpha.value = k.sky * 0.7;
    this.conStarMat.uniforms.uAlpha.value = k.sky;
    this.conStarMat.uniforms.uScale.value = scale;
    this.conStarMat.uniforms.uTime.value = t;
  }
}
