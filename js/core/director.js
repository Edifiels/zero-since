// Режиссёр 3D-сцены: загружает визуализации, переключает их между слайдами,
// ставит камеру и фон, проигрывает зрелищные переходы.
//
// Переходы (slide.transition): 'morph' (по умолчанию), 'warp', 'zoom', 'zoomout',
// 'halftone', 'glitch', 'fade', 'iris', 'wipe', 'dissolve', 'cut'.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { wait, clamp, nextFrame } from './utils.js';
import { dust } from './shapes.js';
import { store } from './store.js';

const SNAPSHOT_TRANSITIONS = {
  halftone: { mode: 'halftone', duration: 1.5 },
  glitch: { mode: 'glitch', duration: 0.95 },
  fade: { mode: 'fade', duration: 1.0 },
  iris: { mode: 'iris', duration: 1.2 },
  wipe: { mode: 'wipe', duration: 1.3 },
  dissolve: { mode: 'dissolve', duration: 1.1 },
};

export function normalizeVisual(v) {
  if (!v) return { id: 'ambient', state: 'nebula' };
  if (typeof v === 'string') {
    const [id, state] = v.split(':');
    return { id, state: state ?? null };
  }
  return { id: v.id, state: v.state ?? null };
}

export class Director {
  constructor(app) {
    this.app = app;
    this.engine = app.engine;
    this.registry = new Map();
    this.instances = new Map();
    this.loading = new Map();
    this.current = null;      // { id, inst, state }
    this.currentStep = 0;
    this.running = null;
    this.token = 0;
    this.target = null;
    this._dust = null;
    // LRU: сколько сцен держать в памяти одновременно (остальные выгружаются и при возврате создаются заново)
    this.maxInstances = app.engine.quality === 'low' ? 8 : 14;
    this.useTick = 0;
    this.lastUsed = new Map();
    this.pinned = new Set(['cover', 'chapter', 'ambient', 'vote-orbs']);
    this.busy = 0;              // > 0 — идёт подготовка сцены (для адаптивного качества)
    this.loadTimeout = 4500;    // мс: дольше — показываем запасную сцену и догружаем в фоне
    const e = this.engine;
    this.ctx = {
      app,
      engine: e,
      THREE,
      gsap,
      scene: e.scene,
      camera: e.camera,
      renderer: e.renderer,
      rig: e.rig,
      particles: e.particles,
      labels: e.labels,
      background: e.background,
      fx: e.fx,
      bus: app.bus,
      store,
      quality: e.quality,
      get time() { return e.time; },
      get deck() { return app.deck; },
      get width() { return e.width; },
      get height() { return e.height; },
    };
    e.addUpdate((dt, t) => this.update(dt, t));
    e.addResize((w, h, dpr) => {
      this.instances.forEach((i) => { try { i.resize(w, h, dpr); } catch (err) { console.error(err); } });
      clearTimeout(this._refitT);
      this._refitT = setTimeout(() => this.refit(), 60);
    });
  }

  register(map) {
    for (const [id, loader] of Object.entries(map || {})) this.registry.set(id, loader);
  }

  has(id) { return this.registry.has(id); }

  /** Загрузить и инициализировать визуализацию (один раз). */
  async get(id) {
    if (this.instances.has(id)) return this.instances.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    const loader = this.registry.get(id);
    if (!loader) throw new Error(`Визуализация «${id}» не зарегистрирована`);
    const p = (async () => {
      const mod = await loader();
      const Cls = mod.default || Object.values(mod).find((v) => typeof v === 'function');
      const inst = new Cls(this.ctx, id);
      this.busy++;
      try {
        await inst.init();
        await nextFrame();
        // Материалы, которые плавно проявляются (fade), сразу делаем прозрачными: иначе при первом показе
        // переключение transparent заставит three пересобрать шейдеры прямо в переходе (заморозка до ~1 с).
        for (const m of inst.collectMaterials()) {
          if (!m.transparent) { m.transparent = true; if (m.side === THREE.DoubleSide) m.forceSinglePass = true; m.needsUpdate = true; }
        }
        // Прогрев шейдеров и текстур: root ещё не в сцене (не мелькает в кадре); цель рендера — буфер композера,
        // иначе three соберёт вариант шейдера «для экрана» (sRGB), а при показе — ещё один.
        await this.warmUp(inst.root);
      } finally {
        this.busy--;
      }
      inst.root.visible = false;
      this.engine.scene.add(inst.root);
      this.instances.set(id, inst);
      this.lastUsed.set(id, ++this.useTick);
      this.loading.delete(id);
      return inst;
    })();
    this.loading.set(id, p);
    try {
      return await p;
    } catch (err) {
      this.loading.delete(id);
      throw err;
    }
  }

  /** Скомпилировать шейдеры и загрузить текстуры объекта заранее (объект не должен быть в сцене). */
  async warmUp(object) {
    const e = this.engine, r = e.renderer;
    const wasVisible = object.visible;
    object.visible = true;
    try {
      const prevRT = r.getRenderTarget();
      r.setRenderTarget(e.composer.readBuffer);
      const p = r.compileAsync(object, e.camera, e.scene);
      r.setRenderTarget(prevRT);
      await p;
      object.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          const prog = r.properties.get(m)?.currentProgram;
          try { prog?.getUniforms?.(); } catch { /* ignore */ }
        }
      });
      object.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture) r.initTexture(v);
          if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !u.value.isRenderTargetTexture) r.initTexture(u.value);
        }
      });
    } catch (err) { /* не критично */ }
    object.visible = wasVisible;
  }

  /** Дождаться окончания текущего перехода. */
  async idle() {
    while (this.running) { try { await this.running; } catch { /* ignore */ } }
  }

  /** Загрузить код всех зарегистрированных сцен (без создания) — чтобы показ не зависел от сети. */
  async prefetchModules() {
    for (const [id, loader] of this.registry) {
      try { await loader(); } catch (err) { console.warn('[prefetch]', id, err?.message || err); }
      await wait(20);
    }
  }

  /** Фоновая предзагрузка (по одной, чтобы не мешать анимации). */
  async preload(ids) {
    for (const id of ids) {
      if (!id || this.instances.has(id) || !this.registry.has(id)) continue;
      try { await this.get(id); } catch (err) { console.error(`[preload ${id}]`, err); }
      await wait(30);
    }
  }

  dustShape() {
    if (!this._dust) this._dust = dust(this.engine.particles.count);
    return this._dust;
  }

  /** Показать визуализацию слайда. Быстрые повторные вызовы схлопываются до последнего. */
  async show(slide, step, { dir = 1, instant = false } = {}) {
    const token = ++this.token;
    this.target = { slide, step, dir };
    if (this.running) { try { await this.running; } catch { /* ignore */ } }
    if (token !== this.token) return;
    this.running = this._show(slide, step, { dir, instant }).catch((err) => console.error('[director]', err));
    await this.running;
    this.running = null;
    // Шаг мог измениться, пока шёл переход
    if (token === this.token && this.target && this.target.slide === slide && this.target.step !== this.currentStep) {
      this.step(slide, this.target.step, { dir: this.target.dir ?? 1 });
    }
    if (this._needRefit && !this.running) { this._needRefit = false; this.refit(); }
  }

  /** Шаг внутри слайда. */
  step(slide, step, { dir = 1, instant = false } = {}) {
    this.target = { slide, step, dir };
    if (this.running || !this.current) return;
    const inst = this.current.inst;
    const prevStep = this.currentStep;
    this.currentStep = step;
    const o = { state: this.current.state, step, prevStep, dir, instant, slide, el: this.app.deck?.currentEl };
    try { inst.setStep(step, o); } catch (err) { console.error(`[${inst.id}.setStep]`, err); }
    this.applyCamera(inst, this.current.state, step, instant ? 0 : 1.5);
    this.applyBackground(inst, slide, this.current.state, step, instant ? 0 : 1.4);
  }

  /**
   * Подгонка позы под экраны уже 16:9 (проекторы 4:3, 16:10): расширяем вертикальный угол обзора так,
   * чтобы по горизонтали было видно столько же, сколько на 16:9, — 3D совпадает с HTML-сценой и не обрезается.
   * Отключить: вернуть из camera() позу с fit: false (или fitted: true, если подгоняете сами).
   */
  fitPose(pose) {
    if (!pose || pose.fit === false || pose.fitted) return pose;
    const aspect = this.engine.camera.aspect || 16 / 9;
    if (aspect >= 16 / 9 - 0.01) return pose;
    const fov = pose.fov ?? 45;
    const f2 = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (16 / 9) / aspect);
    return { ...pose, fov: Math.min(150, THREE.MathUtils.radToDeg(f2)), fitted: true };
  }

  poseOf(inst, state, step) {
    let pose = null;
    try { pose = inst.camera(state, step); } catch (err) { console.error(err); }
    return this.fitPose(pose);
  }

  applyCamera(inst, state, step, duration = 1.6, arc = 0.12) {
    const pose = this.poseOf(inst, state, step);
    if (!pose) return null;
    if (pose.duration != null) duration = pose.duration;
    if (pose.arc != null) arc = pose.arc;
    const key = JSON.stringify(pose);
    if (key === this._lastPose && duration > 0) return null;
    this._lastPose = key;
    if (duration <= 0) { this.engine.rig.set(pose); return null; }
    return this.engine.rig.flyTo(pose, { duration, arc, ease: pose.ease || 'power3.inOut' });
  }

  /** После смены размера окна (полный экран, другой проектор) — заново поставить камеру текущей сцены. */
  refit() {
    if (!this.current) return;
    if (this.running) { this._needRefit = true; return; }
    const pose = this.poseOf(this.current.inst, this.current.state, this.currentStep);
    if (!pose || JSON.stringify(pose) === this._lastPose) return; // поза не изменилась (например, сменился только DPR)
    this.applyCamera(this.current.inst, this.current.state, this.currentStep, 0.35, 0);
  }

  applyBackground(inst, slide, state, step, duration = 1.6) {
    let bg = null;
    try { bg = inst.background(state, step); } catch (err) { console.error(err); }
    if (bg == null) bg = slide.bg ?? 'soft';
    this.engine.background.set(bg, { duration: Math.max(0.01, duration) });
  }

  /** Запустить вход визуализации и, если ей не нужны частицы, отправить их в «пыль». */
  enterNext(next, o) {
    next.active = true;
    next.root.visible = true;
    this.app.engine.labels.setOwnerVisible(next, true);
    const parts = this.engine.particles;
    let p;
    try { p = next.enter(o); } catch (err) { console.error(`[${next.id}.enter]`, err); }
    if (parts.owner !== next) {
      parts.owner = null;
      parts.morph(this.dustShape(), { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 6 });
      parts.resetParams(o.instant ? 0 : 1.5);
      const obj = parts.object;
      gsap.to(obj.position, { x: 0, y: 0, z: 0, duration: 1.8, ease: 'power2.inOut', overwrite: 'auto' });
      gsap.to(obj.rotation, { x: 0, y: 0, z: 0, duration: 1.8, ease: 'power2.inOut', overwrite: 'auto' });
      gsap.to(obj.scale, { x: 1, y: 1, z: 1, duration: 1.8, ease: 'power2.inOut', overwrite: 'auto' });
    }
    return p;
  }

  /** Спрятать визуализацию немедленно. */
  deactivate(inst) {
    if (!inst) return;
    inst.active = false;
    try { inst.killTweens(); } catch { /* ignore */ }
    inst.root.visible = false;
    this.app.engine.labels.setOwnerVisible(inst, false);
    this.engine.rig.releaseDriver(inst);
  }

  async exitPrev(prev, o) {
    if (!prev) return;
    this.app.engine.labels.fadeOwner?.(prev);
    prev.active = false;
    try { await Promise.race([prev.exit(o), wait(3000)]); } catch (err) { console.error(`[${prev.id}.exit]`, err); }
    if (!prev.active) this.deactivate(prev);
  }

  async _show(slide, step, { dir, instant }) {
    const spec = normalizeVisual(slide.visual);
    let inst;
    try {
      inst = this.instances.get(spec.id) || await Promise.race([this.get(spec.id), wait(this.loadTimeout).then(() => null)]);
      if (!inst) {
        // Сцена грузится слишком долго: показываем запасную, а когда загрузится — переключимся, если слайд всё ещё этот
        console.warn(`[director] «${spec.id}» грузится дольше ${this.loadTimeout} мс — запасная сцена`);
        this.get(spec.id).then(() => {
          const deck = this.app.deck;
          if (deck && deck.slide === slide && this.current?.id === 'ambient') this.show(slide, deck.step, { dir });
        }).catch(() => {});
      }
    } catch (err) {
      inst = null;
      this.app.reportError?.(`Сцена «${spec.id}» не загрузилась: ${err?.message || err}`);
    }
    if (!inst) {
      inst = await this.get('ambient');
      spec.state = 'nebula';
      spec.id = 'ambient';
    }
    const prev = this.current?.inst || null;
    const el = this.app.deck?.currentEl;
    this.lastUsed.set(spec.id, ++this.useTick);

    if (prev === inst) {
      const o = { state: spec.state, step, prevStep: this.currentStep, dir, instant, slide, el, sameVisual: true };
      inst.active = true;
      inst.root.visible = true;
      try {
        if (this.current.state !== spec.state) inst.setState(spec.state, o);
        else inst.setStep(step, o);
      } catch (err) { console.error(`[${inst.id}.setState]`, err); }
      this.current.state = spec.state;
      this.currentStep = step;
      this.applyCamera(inst, spec.state, step, instant ? 0 : 1.7, 0.15);
      this.applyBackground(inst, slide, spec.state, step, instant ? 0 : 1.6);
      return;
    }

    const type = instant ? 'cut' : (slide.transition || inst.constructor.transition || 'morph');
    this.engine.particles.owner = null;
    this._lastPose = null;
    const args = { prev, next: inst, spec, step, dir, slide, el, instant };
    const run = TRANSITIONS[type] || (SNAPSHOT_TRANSITIONS[type] ? TRANSITIONS.snapshot : TRANSITIONS.morph);
    this.current = { id: spec.id, inst, state: spec.state };
    this.currentStep = step;
    await run.call(this, args, type);
    this.evict();
  }

  /** Выгрузить давно не используемые сцены (кроме текущей, соседних и закреплённых). */
  evict() {
    if (this.instances.size <= this.maxInstances) return;
    const deck = this.app.deck;
    const keep = new Set(this.pinned);
    if (this.current) keep.add(this.current.id);
    if (deck) {
      for (let i = Math.max(0, deck.index - 2); i <= Math.min(deck.total - 1, deck.index + 6); i++) keep.add(normalizeVisual(deck.slides[i].visual).id);
    }
    const order = [...this.instances.keys()].filter((id) => !keep.has(id)).sort((a, b) => (this.lastUsed.get(a) || 0) - (this.lastUsed.get(b) || 0));
    while (this.instances.size > this.maxInstances && order.length) {
      const id = order.shift();
      const inst = this.instances.get(id);
      if (!inst || inst.active || inst.root.visible) continue;
      try { inst.dispose(); } catch (err) { console.error('[director] dispose', id, err); }
      this.instances.delete(id);
      this.lastUsed.delete(id);
    }
  }

  update(dt, t) {
    for (const inst of this.instances.values()) {
      if (!inst.root.visible) continue;
      try { inst.update(dt, t); } catch (err) { console.error(`[${inst.id}.update]`, err); }
    }
  }
}

// ---------------------------------------------------------------------------
// Переходы. this — Director.
// ---------------------------------------------------------------------------
const TRANSITIONS = {
  async cut({ prev, next, spec, step, dir, slide, el }) {
    this.deactivate(prev);
    this.enterNext(next, { state: spec.state, step, dir, instant: true, slide, el, prev });
    this.applyCamera(next, spec.state, step, 0);
    this.applyBackground(next, slide, spec.state, step, 0.01);
  },

  async morph({ prev, next, spec, step, dir, slide, el }) {
    const D = 1.8;
    const e = this.engine;
    const exitP = this.exitPrev(prev, { dir, next, duration: D * 0.55 });
    this.enterNext(next, { state: spec.state, step, dir, slide, el, prev, duration: D });
    this.applyCamera(next, spec.state, step, D, 0.22);
    this.applyBackground(next, slide, spec.state, step, D);
    e.pulse({ tAberration: 0.9 }, D);
    await Promise.all([exitP, wait(D * 1000 * 0.85)]);
  },

  async warp({ prev, next, spec, step, dir, slide, el }) {
    const e = this.engine, rig = e.rig, fx = e.fx;
    const sign = dir < 0 ? -1 : 1;
    const A = 0.75, B = 1.25;
    // 1) Разгон
    const exitP = this.exitPrev(prev, { dir, next, duration: A * 0.8 });
    gsap.to(fx, { tWarp: sign, tAberration: 1.6, duration: A, ease: 'power3.in', overwrite: 'auto' });
    const fov0 = e.camera.fov;
    rig.flyTo({ pos: rig.pos.clone().lerp(rig.target, 0.35 * sign).toArray(), target: rig.target.toArray(), fov: fov0 + 22 }, { duration: A, ease: 'power3.in', arc: 0 });
    e.background.surge(1.3, A + B);
    e.particles.explode(10 * sign);
    await wait(A * 1000);
    await exitP;
    // 2) Пик: вспышка, смена сцены
    gsap.fromTo(fx, { tFlash: 0.55 }, { tFlash: 0, duration: 0.5, ease: 'power2.out' });
    const pose = this.poseOf(next, spec.state, step);
    if (pose) {
      const p = new THREE.Vector3(...pose.pos), t = new THREE.Vector3(...pose.target);
      const back = p.clone().sub(t).normalize().multiplyScalar(p.distanceTo(t) * 1.4 * sign);
      rig.set({ pos: p.clone().add(back).toArray(), target: pose.target, fov: (pose.fov || 45) + 24, roll: pose.roll });
    }
    this.enterNext(next, { state: spec.state, step, dir, slide, el, prev, duration: B });
    this.applyBackground(next, slide, spec.state, step, B);
    // 3) Торможение
    gsap.to(fx, { tWarp: 0, tAberration: 0, duration: B, ease: 'power3.out', overwrite: 'auto' });
    if (pose) { this._lastPose = null; this.applyCamera(next, spec.state, step, B * 1.2, 0); }
    await wait(B * 1000 * 0.8);
  },

  async zoom({ prev, next, spec, step, dir, slide, el }, type) {
    const e = this.engine, rig = e.rig, fx = e.fx;
    const out = type === 'zoomout';
    const s = out ? -1 : 1;
    const A = 0.7, B = 1.2;
    // нырок в текущую сцену (или вылет из неё)
    const exitP = this.exitPrev(prev, { dir, next, duration: A });
    const p0 = rig.pos.clone(), t0 = rig.target.clone();
    const dirV = t0.clone().sub(p0);
    rig.flyTo({ pos: p0.clone().addScaledVector(dirV, out ? -1.2 : 0.85).toArray(), target: t0.toArray(), fov: e.camera.fov + (out ? 12 : -14) }, { duration: A, ease: 'power3.in', arc: 0 });
    gsap.to(fx, { tWarp: 0.55 * s, tAberration: 1.2, duration: A, ease: 'power2.in', overwrite: 'auto' });
    await wait(A * 1000);
    await exitP;
    gsap.fromTo(fx, { tFlash: 0.25 }, { tFlash: 0, duration: 0.45 });
    const pose = this.poseOf(next, spec.state, step);
    if (pose) {
      const p = new THREE.Vector3(...pose.pos), t = new THREE.Vector3(...pose.target);
      const k = out ? 0.25 : 2.6;
      rig.set({ pos: t.clone().add(p.clone().sub(t).multiplyScalar(k)).toArray(), target: pose.target, fov: pose.fov || 45, roll: pose.roll });
    }
    this.enterNext(next, { state: spec.state, step, dir, slide, el, prev, duration: B });
    this.applyBackground(next, slide, spec.state, step, B);
    gsap.to(fx, { tWarp: 0, tAberration: 0, duration: B, ease: 'power3.out', overwrite: 'auto' });
    this._lastPose = null;
    this.applyCamera(next, spec.state, step, B, 0);
    await wait(B * 1000 * 0.8);
  },

  async zoomout(args) { return TRANSITIONS.zoom.call(this, args, 'zoomout'); },

  async snapshot({ prev, next, spec, step, dir, slide, el }, type) {
    const e = this.engine;
    const cfg = SNAPSHOT_TRANSITIONS[type];
    await Promise.race([e.snapshot(), wait(400)]);
    this.deactivate(prev);
    if (prev) { try { prev.exit({ dir, next, instant: true }); } catch { /* ignore */ } }
    this.enterNext(next, { state: spec.state, step, dir, slide, el, prev, duration: cfg.duration });
    this.applyCamera(next, spec.state, step, 0);
    this.applyBackground(next, slide, spec.state, step, 0.01);
    if (type === 'glitch') {
      gsap.fromTo(e.fx, { tGlitch: 1, tAberration: 2.2, tScan: 0.6 }, { tGlitch: 0, tAberration: 0, tScan: 0, duration: cfg.duration * 1.1, ease: 'power2.out' });
    } else if (type === 'halftone') {
      e.background.surge(0.9, cfg.duration);
    }
    const origin = slide.transitionOrigin || (dir < 0 ? [0.85, 0.2] : [0.15, 0.8]);
    await e.transition(cfg.mode, cfg.duration, origin, type === 'glitch' ? 'steps(8)' : 'power1.inOut');
  },
};
for (const k of Object.keys(SNAPSHOT_TRANSITIONS)) {
  TRANSITIONS[k] = function (args) { return TRANSITIONS.snapshot.call(this, args, k); };
}
