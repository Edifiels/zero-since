// Базовый класс 3D-визуализации слайда.
//
// Жизненный цикл (вызывает режиссёр, core/director.js):
//   constructor(ctx, id)  — ничего тяжёлого
//   async init()          — построить геометрию/материалы (один раз, заранее)
//   enter(o)              — появление. o: { state, step, dir, instant, slide, el, prev, duration }
//   setState(state, o)    — смена состояния, когда соседние слайды используют ту же визуализацию
//   setStep(step, o)      — шаг внутри слайда (клик кликера). Должен приводить к виду шага step
//                           из ЛЮБОГО предыдущего шага (в т. ч. назад и через несколько шагов).
//   exit(o)               — исчезновение (вернуть Promise). o: { dir, next, instant, duration }
//   update(dt, t)         — каждый кадр, пока root.visible
//   camera(state, step)   — поза камеры { pos, target, fov, roll } или null (не трогать камеру)
//   background(state, step) — пресет фона (см. core/background.js) или null (взять slide.bg)
//   resize(w, h, dpr), dispose()
import * as THREE from 'three';
import { gsap } from 'gsap';

export class Visual {
  /** Переход по умолчанию при входе в эту визуализацию (если у слайда не задан transition). */
  static transition = 'morph';

  constructor(ctx, id) {
    this.ctx = ctx;
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = 'visual:' + id;
    this.root.visible = false;
    this.state = null;
    this.step = 0;
    this.active = false;
    this.opacity = 1;
    this._tweens = new Set();
    this._mats = null;
  }

  async init() {}

  camera(state, step) { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; }
  background(state, step) { return null; }

  enter(o = {}) {
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.setOpacity(0);
    return this.fadeTo(1, o.instant ? 0 : 1.0, 'power2.out');
  }

  setState(state, o = {}) { this.state = state; this.setStep(o.step ?? 0, o); }
  setStep(step, o = {}) { this.step = step; }

  exit(o = {}) {
    // отложенные показы/«именованные» анимации не должны срабатывать во время ухода
    this.killKeyed();
    return this.fadeTo(0, o.instant ? 0 : (o.duration ?? 0.7), 'power2.in');
  }

  update(dt, t) {}
  resize(w, h, dpr) {}

  // ---------- Помощники ----------

  get particles() { return this.ctx.particles; }
  /** Сообщить режиссёру, что эта визуализация использует общее облако частиц. */
  claimParticles() { this.ctx.particles.claim(this); }
  ownsParticles() { return this.ctx.particles.owner === this; }

  /** gsap.to с автоматической отменой при выходе. */
  tw(target, vars) {
    const t = gsap.to(target, vars);
    this._track(t);
    return t;
  }
  fromTo(target, from, to) {
    const t = gsap.fromTo(target, from, to);
    this._track(t);
    return t;
  }
  tl(vars = {}) {
    const t = gsap.timeline(vars);
    this._track(t);
    return t;
  }
  delay(sec, fn) {
    const t = gsap.delayedCall(sec, fn);
    this._track(t);
    if (!this._delays) this._delays = new Set();
    this._delays.add(t);
    t.eventCallback('onComplete', ((orig) => () => { this._delays?.delete(t); orig && orig(); })(t.eventCallback('onComplete')));
    return t;
  }
  _track(t) {
    this._tweens.add(t);
    const done = () => this._tweens.delete(t);
    const wrap = (name) => t.eventCallback(name, ((orig) => function () { done(); orig && orig.apply(this, arguments); })(t.eventCallback(name)));
    wrap('onComplete');
    wrap('onInterrupt');
  }

  /**
   * «Именованная» анимация: новая анимация с тем же ключом отменяет предыдущую, даже если та ещё ждёт delay.
   * Защищает от «воскрешения» скрытых объектов при быстрых кликах вперёд-назад.
   *   this.twk('ring', ring.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.4 })
   */
  twk(key, target, vars) {
    if (!this._keyed) this._keyed = new Map();
    this._keyed.get(key)?.kill();
    const t = this.tw(target, vars);
    this._keyed.set(key, t);
    return t;
  }
  /** «Именованный» fromTo (см. twk). */
  twkFromTo(key, target, from, to) {
    if (!this._keyed) this._keyed = new Map();
    this._keyed.get(key)?.kill();
    const t = this.fromTo(target, from, to);
    this._keyed.set(key, t);
    return t;
  }
  /** «Именованный» отложенный вызов: новый вызов с тем же ключом отменяет прежний. */
  delayk(key, sec, fn) {
    if (!this._keyed) this._keyed = new Map();
    this._keyed.get(key)?.kill();
    const t = this.delay(sec, fn);
    this._keyed.set(key, t);
    return t;
  }
  /** Отменить все «именованные» анимации и отложенные вызовы (вызывается в базовом exit). */
  killKeyed() {
    this._keyed?.forEach((t) => t.kill());
    this._keyed?.clear();
    this._delays?.forEach((t) => t.kill());
    this._delays?.clear();
  }
  killTweens() {
    this._tweens.forEach((t) => t.kill());
    this._tweens.clear();
  }

  /** Управлять камерой покадрово: fn(dt, t) => { pos, target, fov?, roll? }; drive(null) — отпустить. */
  drive(fn, blend = 0.9) {
    if (fn) this.ctx.rig.setDriver(fn, blend, this);
    else this.ctx.rig.releaseDriver(this);
  }

  /**
   * Размер «сцены 16:9» (области HTML-раскладки) в мировых единицах на расстоянии distance от камеры.
   * Помогает ставить 3D-объекты напротив колонок HTML (например, слева от текста).
   * fov — вертикальный угол камеры (по умолчанию текущий).
   */
  stageRect(distance = null, fov = null) {
    // по умолчанию — из собственной позы камеры (а не текущей: во время перехода камера «плывёт»).
    // Защита от рекурсии: если camera() сама вызывает stageRect(), берём позу по умолчанию.
    let pose = null;
    if (!this._inStageRect) {
      this._inStageRect = true;
      try { pose = this.camera(this.state, this.step); } catch { /* ignore */ }
      this._inStageRect = false;
    }
    if (distance == null) {
      distance = pose && pose.pos && pose.target
        ? Math.hypot(pose.pos[0] - pose.target[0], pose.pos[1] - pose.target[1], pose.pos[2] - pose.target[2])
        : 14;
    }
    if (fov == null) fov = pose?.fov ?? 45;
    // Ядро само подгоняет камеру под экраны уже 16:9 (director.fitPose): по горизонтали всегда видна
    // ширина «16:9 при исходном fov», поэтому сцена 16:9 = vh × 16/9 на любом экране.
    const vh = 2 * distance * Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const aspect = this.ctx.camera.aspect || 16 / 9;
    const w = vh * 16 / 9;
    return { w, h: vh, visibleW: Math.max(w, vh * aspect), visibleH: Math.max(vh, w / aspect) };
  }

  /** Точка экрана (CSS-пиксели) → мировая точка на плоскости z = planeZ (по текущей камере). */
  screenToWorld(x, y, planeZ = 0, out = new THREE.Vector3()) {
    const cam = this.ctx.camera;
    const ndc = new THREE.Vector3((x / this.ctx.engine.width) * 2 - 1, -(y / this.ctx.engine.height) * 2 + 1, 0.5);
    ndc.unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    const t = (planeZ - cam.position.z) / (dir.z || 1e-6);
    return out.copy(cam.position).addScaledVector(dir, t);
  }

  /** HTML-подпись, привязанная к 3D (удаляется автоматически при dispose / removeLabels). */
  label(opts) { return this.ctx.labels.add({ owner: this, ...opts }); }
  removeLabels() { this.ctx.labels.removeOwner(this); }

  /** Собрать материалы для общего fade (вызывается лениво). */
  collectMaterials() {
    const mats = [];
    this.root.traverse((o) => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => {
        if (mm.userData.noFade) return;
        if (mm.userData.baseOpacity == null) {
          mm.userData.baseOpacity = mm.uniforms?.uOpacity ? mm.uniforms.uOpacity.value : mm.opacity;
        }
        mats.push(mm);
      });
    });
    this._mats = mats;
    return mats;
  }

  /** Общая прозрачность всех материалов визуализации (0..1). */
  setOpacity(v) {
    this.opacity = v;
    const mats = this._mats || this.collectMaterials();
    for (const m of mats) {
      const base = m.userData.baseOpacity ?? 1;
      if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = base * v;
      else {
        m.opacity = base * v;
        if (!m.transparent && v < 1) { m.transparent = true; m.needsUpdate = true; }
      }
    }
    this.root.visible = v > 0.001 || this.active;
  }

  fadeTo(v, duration = 0.8, ease = 'power2.inOut') {
    this._mats = null; // пересобрать: объекты могли добавиться
    this.collectMaterials();
    if (duration <= 0) { this.setOpacity(v); return Promise.resolve(); }
    const st = { v: this.opacity };
    return new Promise((resolve) => {
      const t = gsap.to(st, { v, duration, ease, onUpdate: () => this.setOpacity(st.v), onComplete: resolve, onInterrupt: resolve });
      this._tweens.add(t);
    });
  }

  dispose() {
    this.killTweens();
    this.removeLabels();
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => {
        // общие текстуры (окружение движка, модульные кэши с userData.shared) не трогаем
        const own = (tx) => tx && tx.isTexture && !tx.userData?.shared && tx !== this.ctx.engine.envMap && tx !== this.ctx.scene.environment;
        for (const v of Object.values(mm)) if (own(v)) v.dispose();
        if (mm.uniforms) for (const u of Object.values(mm.uniforms)) if (u && own(u.value)) u.value.dispose();
        mm.dispose();
      });
    });
    this.root.parent?.remove(this.root);
  }
}
