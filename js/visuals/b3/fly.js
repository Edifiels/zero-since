// Блок 3. Муха: «hover» — зависает в кольце частиц (вопрос №5), «scale» — схема из частиц и зум в голову
// с линейкой (мозг меньше 1 мм), «walk» — каркасная муха шагает трёхногой походкой по светящейся сетке,
// над ней — цветная копия мозга, связанная с телом; шаг 1 — остановка и чистка усиков.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { FlyModel } from './fly-model.js';
import { brainColored, brainBrand } from './brain-shape.js';
import { makeFloor, makeBeam, cellPx, eqShape, placeShape } from './common.js';
import { rng } from '../../core/utils.js';

const HEAD_C = [0, 0.15, 0.97];   // центр мозга в координатах мухи (тело в покое)
const BRAIN_K = 0.31;             // мозг шириной 0.62 мм
const BRAIN_COPY_K = 2.3;         // масштаб цветной «копии мозга» над шагающей мухой (крупно — это главный герой слайда)
const lp = (l, x, y, z) => { const a = l._p3 || (l._p3 = [0, 0, 0]); a[0] = x; a[1] = y; a[2] = z; l.setPosition(a); };

export default class FlyVisual extends Visual {
  static transition = 'morph';

  async init() {
    const fly = new FlyModel();
    this.fly = fly;
    this.root.add(fly.group);
    this.base = { rotY: -0.5, rotX: 0.1, wob: 1 };

    // Пол для ходьбы
    this.floor = makeFloor({ size: 90, cell: 1.0, fade: 12, k: 0.5 });
    this.floor.mesh.visible = false;
    this.root.add(this.floor.mesh);
    this.floorOffset = 0;

    // Линейка (в координатах мухи: 1 единица = 1 мм) — перед головой
    this.ruler = this.makeRuler();
    this.ruler.visible = false;
    this.rulerK = 0;
    this.ruler.traverse((o) => { if (o.material) { o.material.userData.noFade = true; o.material.userData.base = o.material.opacity; } });
    fly.group.add(this.ruler);

    // Луч «копия мозга → тело»
    this.beam = makeBeam([[0, 3, 0], [0, 2, 0], [0, 1, 0]], { radius: 0.035, dash: 5, speed: 1.1 });
    this.beam.mesh.visible = false;
    this.root.add(this.beam.mesh);

    this.frame = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, key: null };
    this._tq = new THREE.Quaternion();
    this._te = new THREE.Euler();
    this._tv = new THREE.Vector3();
    this._feet = Array.from({ length: 6 }, () => new THREE.Vector3());
    this.buildShapes();
  }

  // ---------- Формы облака частиц ----------
  buildShapes() {
    const n = this.ctx.particles.count;
    const fly = this.fly;
    this.shapes = {};
    // Кольцо вокруг зависшей мухи (в единицах мухи; рамка — «ring»)
    const ring = S.combine(n, [
      { weight: 0.5, shape: (m) => S.ring(m, { radius: 1.8, width: 0.18, thickness: 0.025, color: S.PAL.white, accent: S.PAL.greenHi, accentRatio: 0.22, alpha: 0.6 }) },
      { weight: 0.14, shape: (m) => S.ring(m, { radius: 2.25, width: 0.05, thickness: 0.01, color: S.PAL.mint, accent: S.PAL.white, accentRatio: 0.3, alpha: 0.45, size: 0.7 }) },
      { weight: 0.36, shape: (m) => S.dust(m, { radius: 9, inner: 2.4, alpha: 0.2, size: 0.65 }) },
    ]);
    this.shapes.ring = eqShape(ring, 1.95);

    // Муха из частиц (поза стоя, координаты корня мухи)
    const P = fly.p;
    const save = { ...P };
    Object.assign(P, { flight: 0, hover: 0, walk: 0, groom: 0, proboscis: 0 });
    fly.group.position.set(0, 0, 0); fly.group.rotation.set(0, 0, 0); fly.group.scale.setScalar(1);
    fly.update(0, 0);
    const smp = fly.samplePoints(n, 13);
    Object.assign(P, save);
    const r = rng(4);
    const pc = S.createShape(n);
    for (let i = 0; i < n; i++) {
      const k = i < smp.count ? smp.kind[i] : 0;
      const t = r();
      let c, a, sz;
      if (k === 1) { c = t < 0.5 ? S.PAL.greenHi : S.PAL.mint; a = 0.55; sz = 0.9; }
      else if (k === 2) { c = S.PAL.pale; a = 0.12; sz = 0.6; }
      else if (k === 3) { c = t < 0.4 ? S.PAL.greenHi : S.PAL.white; a = 0.5; sz = 0.7; }
      else if (k === 4) { c = t < 0.2 ? S.PAL.greenHi : S.PAL.white; a = 0.5; sz = 0.75; }
      else { c = t < 0.1 ? S.PAL.greenHi : t < 0.7 ? S.PAL.white : S.PAL.mint; a = 0.4; sz = r.range(0.6, 1.1); }
      S.setPoint(pc, i, smp.pos[i * 3], smp.pos[i * 3 + 1], smp.pos[i * 3 + 2], sz, c, a);
    }
    this.shapes.cloud = eqShape(pc, 2.8);

    // Мозг в голове (координаты мухи)
    const hb = placeShape(brainBrand(n, { eq: 0, alpha: 1.6 }), { scale: BRAIN_K, offset: HEAD_C });
    // в мозг уходят 9 частиц из каждых 20, остальные разлетаются и гаснут
    const far = S.dust(n, { radius: 16, inner: 6, alpha: 0, size: 0.5, seed: 8 });
    for (let i = 0; i < n; i++) {
      if (i % 20 < 9) continue;
      const j = i * 4;
      for (let c = 0; c < 4; c++) { hb.positions[j + c] = far.positions[j + c]; hb.colors[j + c] = far.colors[j + c]; }
    }
    hb.meta.equalized = false;
    this.shapes.headBrain = eqShape(hb, 2.7);
    // Цветная копия мозга над мухой (рамка «brain»)
    this.shapes.colorBrain = brainColored(n, { eq: BRAIN_COPY_K, alpha: 1, target: 3.5 });
  }

  makeRuler() {
    const g = new THREE.Group();
    // линейка шириной 1 мм под головой, перед мухой
    const green = new THREE.Color('#7dff6e').multiplyScalar(0.95);
    const mat = new THREE.LineBasicMaterial({ color: green, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = [];
    const x0 = -0.5, y0 = 0, z = 0;
    pts.push(x0, y0, z, x0 + 1, y0, z);
    for (let i = 0; i <= 20; i++) {
      const x = x0 + i * 0.05;
      const h = i % 10 === 0 ? 0.11 : i % 2 === 0 ? 0.065 : 0.035;
      pts.push(x, y0, z, x, y0 + h, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, mat);
    g.add(lines);
    // скобки: ширина мозга
    const bm = new THREE.LineDashedMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.85), dashSize: 0.025, gapSize: 0.02, transparent: true, depthWrite: false });
    const bp = [];
    const bw = BRAIN_K;
    bp.push(-bw, 0.13, z, -bw, 0.5, z, bw, 0.13, z, bw, 0.5, z);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    const br = new THREE.LineSegments(bg, bm);
    br.computeLineDistances();
    g.add(br);
    // засечка «ширина мозга» на линейке
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(bw * 2, 0.008), new THREE.MeshBasicMaterial({ color: new THREE.Color('#b6ffb0').multiplyScalar(0.7), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    hl.position.set(0, -0.018, 0);
    g.add(hl);
    this.rulerHL = hl;
    g.position.set(0, HEAD_C[1] - 0.47, HEAD_C[2] + 0.34);
    return g;
  }

  // ---------- Раскладка по состояниям ----------
  cfg(state) {
    // ширина «сцены 16:9» на расстоянии 14 при fov 45. Камеру под экраны 4:3/16:10 ядро подгоняет само
    // (director.fitPose: по горизонтали всегда видна ширина 16:9), поэтому от пропорций экрана не зависит.
    const w = 2 * 14 * Math.tan(THREE.MathUtils.degToRad(22.5)) * 16 / 9;
    switch (state) {
      // rotX = 0: линейка у головы стоит ровно (камера шага 1 смотрит строго спереди-сбоку, без крена)
      case 'scale': return { pos: [1.9, -0.15, 0], scale: 2.7, rotY: -0.95, rotX: 0, wob: 0 };
      case 'walk': return { pos: [1.3, -0.12, 0], scale: 2.3, rotY: -1.32, rotX: 0, wob: 0 };
      default: return { pos: [w * 0.25, -0.05, 0], scale: 1.95, rotY: -1.12, rotX: 0.1, wob: 1 };
    }
  }

  headWorld(state, out = new THREE.Vector3()) {
    const c = this.cfg(state);
    const e = this._te.set(c.rotX, c.rotY, 0);
    return out.set(...HEAD_C).multiplyScalar(c.scale).applyEuler(e).add(this._tv.set(...c.pos));
  }

  camera(state, step) {
    if (state === 'scale') {
      if (step >= 1) {
        const h = this.headWorld('scale', new THREE.Vector3());
        const c = this.cfg('scale');
        const dir = new THREE.Vector3(0, 0.05, 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rotY);
        // голову держим в правой половине кадра: сдвигаем камеру и цель вместе (линейка остаётся фронтальной)
        const left = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        // (1.15 — подпись «1 мм» остаётся внутри полей сцены, не у самого края экрана)
        const shift = left.multiplyScalar(1.15).add(new THREE.Vector3(0, -0.28, 0));
        const tgt = h.clone().add(shift);
        const pos = tgt.clone().addScaledVector(dir, 5.6);
        return { pos: pos.toArray(), target: tgt.toArray(), fov: 40 };
      }
      return { pos: [-0.6, 1.5, 14], target: [0.9, -0.3, 0], fov: 42 };
    }
    if (state === 'walk') return { pos: [-5.8, 3.3, 11.6], target: [0.4, 0.2, 0], fov: 44 };
    return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 };
  }

  background(state) {
    if (state === 'walk') return 'bottom';
    if (state === 'scale') return 'corner';
    return 'right';
  }

  enter(o = {}) {
    this.state = o.state || 'hover';
    this.step = o.step ?? 0;
    this.claimParticles();
    this.apply(this.state, this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.step = o.step ?? 0;
    this.claimParticles();
    this.apply(state, this.step, o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(this.state, step, o);
  }

  apply(state, step, o = {}) {
    const fly = this.fly, P = fly.p;
    const inst = !!o.instant;
    const D = (x) => (inst ? 0 : x);
    const c = this.cfg(state);
    const entering = !!o.entering;
    const g = fly.group;
    if (entering) {
      // появление: муха прилетает чуть издалека
      g.position.set(c.pos[0] + (state === 'walk' ? 0 : 1.5), c.pos[1] + (state === 'walk' ? 0 : 0.6), c.pos[2] - (state === 'walk' ? 0 : 3));
      g.scale.setScalar(c.scale * (state === 'walk' ? 1 : 0.7));
      Object.assign(this.base, { rotY: c.rotY, rotX: c.rotX, wob: c.wob });
      this.floorOffset = 0;
    }
    // «именованные» анимации (twk): при быстрых кликах новая отменяет старую, даже если та ещё ждёт delay
    this.twk('pos', g.position, { x: c.pos[0], y: c.pos[1], z: c.pos[2], duration: D(entering ? 2.0 : 1.6), ease: 'power3.inOut' });
    this.twk('scale', g.scale, { x: c.scale, y: c.scale, z: c.scale, duration: D(entering ? 2.0 : 1.6), ease: 'power3.inOut' });
    this.twk('base', this.base, { rotY: c.rotY, rotX: c.rotX, wob: c.wob, duration: D(1.6), ease: 'power2.inOut' });

    // параметры модели
    let tgt;
    if (state === 'hover') tgt = { solid: 1, dark: 0, wire: 0, xray: 0, headXray: 0, trunk: 1, legs: 1, flight: 1, hover: 1, walk: 0, groom: 0, proboscis: 0, glow: step >= 1 ? 1.5 : 1 };
    else if (state === 'scale') tgt = { solid: 1, dark: 0, wire: 0.22, xray: 1, headXray: 1, trunk: step >= 1 ? 0 : 1, legs: step >= 1 ? 0 : 1, flight: 0, hover: 0, walk: 0, groom: 0, proboscis: 0, glow: 0.8 };
    else tgt = { solid: 1, dark: 1, wire: 0.45, xray: 0, headXray: 0, trunk: 1, legs: 1, flight: 0, hover: 0, walk: step >= 1 ? 0 : 1, groom: step >= 1 ? 1 : 0, proboscis: 0, glow: 1 };
    if (inst) {
      for (const k of ['P', 'walk', 'groom']) this._keyed?.get(k)?.kill();
      Object.assign(P, tgt);
    } else {
      const { walk, groom, ...rest } = tgt;
      this.twk('P', P, { ...rest, duration: entering ? 1.2 : 1.1, ease: 'power2.inOut' });
      // остановка: сначала гаснет ходьба, потом начинается чистка (и наоборот)
      if (groom > P.groom) {
        this.twk('walk', P, { walk, duration: 0.9, ease: 'power2.out' });
        this.twk('groom', P, { groom, duration: 1.1, delay: 0.7, ease: 'power2.inOut' });
      } else {
        const wasGrooming = groom < P.groom - 0.05;
        this.twk('groom', P, { groom, duration: 0.8, ease: 'power2.inOut' });
        this.twk('walk', P, { walk, duration: 1.0, delay: wasGrooming ? 0.5 : 0, ease: 'power2.in' });
      }
    }

    // частицы
    const p = this.particles;
    let key, frame;
    if (state === 'hover') { key = 'ring'; frame = 'ring'; }
    else if (state === 'scale') { key = step >= 1 ? 'headBrain' : 'cloud'; frame = 'fly'; }
    else { key = 'colorBrain'; frame = 'brain'; }
    if (key !== this.shapeKey || entering) {
      const opt = key === 'headBrain' ? { duration: D(2.2), stagger: 0.55, burst: 4 }
        : key === 'cloud' ? { duration: D(2.4), stagger: 0.5, burst: 9 }
          : { duration: D(2.2), stagger: 0.5, burst: 10 };
      p.morph(this.shapes[key], opt);
      this.shapeKey = key;
    }
    const prm = {
      ring: { noise: 0.25, swirl: 0.16, size: 0.064, twinkle: 0.35, spring: 16, damping: 5.5 },
      cloud: { noise: 0.08, swirl: 0, size: 0.052, twinkle: 0.3, spring: 22, damping: 6.5 },
      headBrain: { noise: 0.03, swirl: 0, size: 0.034, twinkle: 0.25, spring: 24, damping: 7 },
      colorBrain: { noise: 0.06, swirl: 0.06, size: 0.05, twinkle: 0.3, spring: 18, damping: 6 },
    }[key];
    p.setParams(prm, D(1.2));
    if (this.frame.key !== frame) { this.frame.key = frame; }
    if (entering) {
      const ob = p.object;
      this.frame.pos.copy(ob.position); this.frame.quat.copy(ob.quaternion); this.frame.scale = ob.scale.x;
    }
    if (inst) this.snapFrame = true;
    if (state === 'hover' && step >= 1 && !inst && o.prevStep === 0) {
      // ответ: вспышка кольца
      p.explode(5);
      this.ctx.engine.pulse({ flash: 0.12 }, 0.6);
    }

    // пол, линейка, луч
    this.floor.mesh.visible = state === 'walk';
    this.beam.mesh.visible = state === 'walk';
    this.twk('feet', this.floor.uniforms.uFeetK, { value: state === 'walk' && step === 0 ? 1 : 0, duration: D(0.8) });
    const rulerOn = state === 'scale' && step >= 1 ? 1 : 0;
    this.twk('ruler', this, { rulerK: rulerOn, duration: D(rulerOn ? 1.0 : 0.4), delay: rulerOn && !inst ? 1.0 : 0 });
    if (state === 'walk') {
      this.buildBeam();
      if (entering && !inst) this.twk('beam', this.beam.uniforms.uReveal, { startAt: { value: 0 }, value: 1, duration: 1.6, delay: 0.9, ease: 'power2.inOut' });
      else { this._keyed?.get('beam')?.kill(); this.beam.uniforms.uReveal.value = 1; }
    }

    // подписи — вслед за объектами: муха прилетает (~1.3 с), линейка проявляется (~1 с), чистка начинается (~0.7 с)
    let lag = 0;
    if (!inst) {
      if (entering && state === 'walk') lag = 1.3;
      else if (state === 'scale' && step >= 1 && (o.prevStep ?? 0) < 1) lag = 1.1;
      else if (state === 'walk' && step >= 1 && (o.prevStep ?? 0) < 1) lag = 0.8;
    }
    this.updateLabels(state, step, lag);
  }

  updateLabels(state, step, lag = 0) {
    if (!this.lbl) {
      this.lbl = {
        r0: this.label({ html: '<span class="b3-tick">0</span>', object: this.ruler, offset: [-0.5, 0.13, 0], anchor: 'bottom', visible: false }),
        r1: this.label({ html: '<span class="b3-tick">1&nbsp;мм</span>', object: this.ruler, offset: [0.5, 0.13, 0], anchor: 'bottom', visible: false }),
        brain: this.label({ html: '<span class="b3-tag">мозг</span>', object: this.ruler, offset: [0, 0.075, 0], anchor: 'bottom', visible: false }),
        gait: this.label({ html: '<span class="b3-tag">три лапы на земле,<br>три в воздухе</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
        groom: this.label({ html: '<span class="b3-tag">чистит усики</span>', position: [0, 0, 0], visible: false }),
        copy: this.label({ html: '<span class="b3-tag is-dim">копия мозга</span>', position: [0, 0, 0], anchor: 'bottom', visible: false }),
      };
    }
    const L = this.lbl;
    const on = (l, v) => {
      const key = 'lbl:' + Object.keys(L).find((k) => L[k] === l);
      if (!v) { this._keyed?.get(key)?.kill(); l.hide(); return; }
      if (lag <= 0 || l.visible) { this._keyed?.get(key)?.kill(); l.show(); return; }
      if (!this._lblClock) this._lblClock = {};
      const clk = this._lblClock[key] || (this._lblClock[key] = { t: 0 });
      this.twk(key, clk, { t: 1, duration: lag, onComplete: () => l.show() });
    };
    const ruler = state === 'scale' && step >= 1;
    on(L.r0, ruler); on(L.r1, ruler); on(L.brain, ruler);
    on(L.gait, state === 'walk' && step === 0);
    on(L.groom, state === 'walk' && step >= 1);
    on(L.copy, state === 'walk');
  }

  exit(o = {}) {
    this.removeLabels();
    this.lbl = null;
    return super.exit(o);
  }

  brainPos(out = new THREE.Vector3()) {
    const c = this.cfg('walk');
    return out.set(c.pos[0] + 4.1, c.pos[1] + 3.15, c.pos[2] - 1.2);
  }

  buildBeam() {
    const head = this.headWorld('walk', new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0));
    const from = this.brainPos().add(new THREE.Vector3(-0.2, -0.75, 0.3));
    const mid = from.clone().lerp(head, 0.5).add(new THREE.Vector3(0.5, 0.45, 0.2));
    this.beam.set([from, mid, head]);
  }

  // ---------- Кадр ----------
  frameTarget(key, out) {
    const g = this.fly.group;
    if (key === 'ring') {
      out.pos.copy(g.position);
      out.quat.setFromEuler(this._te.set(0.3, 0, 0.1));
      out.scale = g.scale.x;
    } else if (key === 'fly') {
      out.pos.copy(g.position);
      out.quat.copy(g.quaternion);
      out.scale = g.scale.x;
    } else {
      // копия мозга — сверху справа от мухи
      this.brainPos(out.pos);
      out.quat.setFromEuler(this._te.set(0.15, -0.5 + Math.sin(this.ctx.time * 0.3) * 0.25, 0));
      out.scale = BRAIN_COPY_K;
    }
    return out;
  }

  update(dt, t) {
    const fly = this.fly;
    const g = fly.group;
    // покачивание при зависании
    const b = this.base;
    g.rotation.set(b.rotX + b.wob * 0.05 * Math.sin(t * 0.8), b.rotY + b.wob * 0.2 * Math.sin(t * 0.55), b.wob * 0.04 * Math.sin(t * 0.7));
    fly.setCell(cellPx(this.ctx.engine));
    fly.update(dt, t);
    if (this.ruler.visible || this.rulerK > 0.001) {
      this.ruler.visible = this.rulerK > 0.001;
      const k = this.rulerK * this.opacity;
      this.ruler.traverse((o) => { if (o.material) o.material.opacity = o.material.userData.base * k; });
    }

    // рамка облака частиц плавно следует за целью
    if (this.ownsParticles() && this.frame.key) {
      const tg = this._frameTmp || (this._frameTmp = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 });
      this.frameTarget(this.frame.key, tg);
      const f = this.frame;
      const k = this.snapFrame ? 1 : 1 - Math.exp(-dt * 3.2);
      this.snapFrame = false;
      f.pos.lerp(tg.pos, k);
      f.quat.slerp(tg.quat, k);
      f.scale += (tg.scale - f.scale) * k;
      const o = this.particles.object;
      o.position.copy(f.pos);
      o.quaternion.copy(f.quat);
      o.scale.setScalar(f.scale);
    }

    // пол-«беговая дорожка»
    if (this.floor.mesh.visible) {
      const u = this.floor.uniforms;
      const sc = g.scale.x;
      this.floorOffset += dt * fly.groundSpeed() * sc;
      u.uOffset.value = this.floorOffset;
      u.uDir.value.set(Math.sin(g.rotation.y), Math.cos(g.rotation.y));
      this.floor.mesh.position.set(0, g.position.y + fly.ground * sc, 0);
      u.uCenter.value.set(g.position.x, g.position.z);
      u.uCell.value = cellPx(this.ctx.engine);
      g.updateMatrixWorld(true);
      for (let i = 0; i < 6; i++) {
        const fp = this._feet[i].copy(fly.legPts[i][4]);
        const ground = Math.max(0, 1 - (fp.y - fly.ground) / 0.06);
        fp.applyMatrix4(g.matrixWorld);
        u.uFeet.value[i].set(fp.x, fp.z, ground, 0.16 * sc);
      }
      this.beam.uniforms.uTime.value = t;
      // подписи
      if (this.lbl) {
        lp(this.lbl.gait, g.position.x + 2.2, g.position.y + fly.ground * g.scale.x + 0.15, g.position.z + 1.5);
        const a = fly.point('antenna', this._tv);
        lp(this.lbl.groom, a.x - 0.4, a.y + 1.3, a.z);
        lp(this.lbl.copy, this.frame.pos.x, this.frame.pos.y + 1.38, this.frame.pos.z);
      }
    }
  }

  dispose() {
    this.fly?.dispose();
    super.dispose();
  }
}
