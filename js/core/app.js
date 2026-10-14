// Приложение: собирает движок, режиссёра, колоду, интерфейс и управление.
import { PART_ORDER, CHANNEL, BLOCKS, QUALITY_NAMES } from '../config.js';
import { Engine } from './engine.js';
import { Director, normalizeVisual } from './director.js';
import { NullEngine, NullDirector } from './fallback.js';
import { Deck } from './deck.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { store } from './store.js';
import { Emitter, params, IS_TEST, fontsReady, wait, nextFrame } from './utils.js';
import { CORE_VISUALS } from '../visuals/core/index.js';

const RESUME_KEY = 'nsiii-autoresume';
export { QUALITY_NAMES };

// Подбор качества по видеокарте: встроенная/программная — ниже.
function detectQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/SwiftShader|llvmpipe|Basic Render|Software/i.test(name)) return 'low';
    if (/Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple GPU/i.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export class App {
  constructor() {
    this.bus = new Emitter();
    this.store = store;
    this.started = false;
    this.ready = false;
    this.test = IS_TEST;
    this.debug = params.has('debug');
    this.session = Math.random().toString(36).slice(2, 10);
    this._lastNav = 0;
  }

  async start() {
    // Адрес «#слайд.шаг» запоминаем сразу — до загрузки (иначе нажатие кликера во время загрузки его затрёт)
    this._initialHash = location.hash;
    let autoResume = null;
    try { autoResume = sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }

    const q = params.get('q') || store.get('quality-level') || (matchMedia('(pointer: coarse)').matches ? 'medium' : detectQuality());
    this.qualityLevel = ['low', 'medium', 'high'].includes(q) ? q : 'high';
    const theme = params.get('theme') || store.get('theme') || 'dark';
    document.documentElement.dataset.theme = theme;

    await fontsReady();

    // Движок (без WebGL 2 — HTML-режим без 3D)
    try {
      this.engine = new Engine({
        container: document.getElementById('gl'),
        labelsRoot: document.getElementById('labels'),
        quality: this.qualityLevel,
        test: this.test,
        debug: this.debug,
      });
      this.engine.canAdapt = () => this.started && !this.director?.running && !this.director?.busy;
      this.engine.canvas.addEventListener('webglcontextlost', () => {
        // после восстановления контекста страница перезагрузится — продолжим с того же места
        try { sessionStorage.setItem(RESUME_KEY, location.hash || '#1'); } catch { /* ignore */ }
      });
    } catch (err) {
      console.error('[app] WebGL недоступен, включаю HTML-режим без 3D:', err);
      this.engine = new NullEngine();
      this.noWebGL = true;
    }
    this.engine.setTheme(theme, 0);

    // Режиссёр и визуализации
    this.director = this.noWebGL ? new NullDirector() : new Director(this);
    this.director.register(CORE_VISUALS);

    // Части лекции (ошибка в одной части не ломает остальные)
    const only = params.get('part');
    const names = only ? ['intro', ...only.split(',').filter((n) => n !== 'intro')] : PART_ORDER;
    const loaded = await Promise.allSettled(names.map((n) => import(`../parts/${n}.js`)));
    const slides = [];
    loaded.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[parts] не удалось загрузить часть «${names[i]}»:`, r.reason);
        this._partErrors = (this._partErrors || []).concat(names[i]);
        return;
      }
      const mod = r.value;
      this.director.register(mod.visuals || {});
      (mod.slides || []).forEach((s) => { s._part = names[i]; slides.push(s); });
    });

    this.deck = new Deck(this, slides);
    this.ui = new UI(this);
    this.input = new Input(this);
    if (this._partErrors) this.reportError('Не загрузились части: ' + this._partErrors.join(', '));
    if (this.noWebGL) this.reportError('WebGL 2 недоступен — показ без 3D-сцен');
    this.setupPresenterChannel();
    this.setupFullscreenWatch();
    window.APP = this;

    // Тестовый режим: без стартового экрана
    if (this.test) {
      this.started = true;
      document.body.classList.add('is-test');
      const h = this.deck.parseHash(this._initialHash);
      await this.director.preload(this.visualIdsFrom(h?.index ?? 0, 2));
      this.deck.goTo(h?.index ?? 0, h?.step ?? 0, { dir: 1, instant: true });
      this.bus.on('slide', () => this.preloadAhead());
      await wait(300);
      this.ready = true;
      return;
    }

    // Автопродолжение после сбоя графики — сразу к слайду, без стартового экрана
    if (autoResume) {
      const h = this.deck.parseHash(autoResume);
      this.ready = true;
      this._fsOnFirstKey = true;
      this.begin({ fullscreen: false, target: h || { index: 0, step: 0 } });
      this.ui.toast('Показ продолжен после сбоя графики — нажмите F для полного экрана', 4000);
      this.prefetchAll();
      return;
    }

    // Стартовый экран + предзагрузка первых сцен
    const last = store.get('last');
    const resume = last && last.index > 0 && last.index < this.deck.total ? last : null;
    this.ui.buildStart({ resume });
    const first = this.deck.slides[0];
    const ids = this.visualIdsFrom(0, 6);
    this.ui.setLoad(0.05);
    try {
      await this.director.get(normalizeVisual(first.visual).id);
      this.director.show(first, 0, { dir: 1 });
    } catch (err) { console.error(err); }
    let done = 0;
    for (const id of ids) {
      await this.director.preload([id]);
      done++;
      this.ui.setLoad(0.1 + 0.9 * (done / ids.length));
    }
    this.ui.setLoad(1);
    this.ready = true;
    const hh = this.deck.parseHash(this._initialHash);
    if (hh && (hh.index > 0 || hh.step > 0)) this._hashTarget = hh;
    // Кликер нажали во время загрузки — начинаем сейчас
    if (this._pendingBegin) this.begin(this._pendingBegin);
    // Код всех сцен и данные — заранее, пока есть сеть (дальше показ не зависит от Wi-Fi)
    this.prefetchAll();
  }

  visualIdsFrom(index, n) {
    const ids = [];
    for (let i = index; i < this.deck.slides.length && ids.length < n; i++) {
      const id = normalizeVisual(this.deck.slides[i].visual).id;
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Запрос начала показа (кликер, кнопка). До окончания загрузки — откладывается. */
  requestBegin(opts = {}) {
    if (this.started) return;
    if (opts.fullscreen) this.enterFullscreen(); // полный экран — только из обработчика нажатия
    if (!this.ready) {
      this._pendingBegin = { ...opts, fullscreen: false };
      this.ui.toast('Загружаю сцены — начнём через пару секунд…', 2500);
      return;
    }
    this.begin({ ...opts, fullscreen: false });
  }

  /** Начать показ (со стартового экрана). */
  begin({ fullscreen = true, resume = false, target = null } = {}) {
    if (this.started) return;
    this.started = true;
    if (fullscreen) this.enterFullscreen();
    this.ui.hideStart();
    this.requestWakeLock();
    let t = target || { index: 0, step: 0 };
    if (!target) {
      if (resume) t = store.get('last') || t;
      else if (this._hashTarget) t = this._hashTarget;
    }
    this.deck.goTo(t.index, t.step, { dir: 1 });
    this.bus.on('slide', () => this.preloadAhead());
    this.preloadAhead();
    this.syncPresenter();
  }

  /**
   * Заранее готовим сцены ближайших слайдов. Начинаем ПОСЛЕ окончания перехода и в простое,
   * по одной сцене за раз — чтобы тяжёлая подготовка не попадала в анимацию.
   */
  preloadAhead() {
    const token = (this._preToken = (this._preToken || 0) + 1);
    const ids = this.visualIdsFrom(this.deck.index, 4);
    (async () => {
      await this.director.idle();
      await wait(250);
      for (const id of ids) {
        if (token !== this._preToken) return; // слайд сменился — начнём заново
        if (this.director.instances.has(id) || !this.director.has(id)) continue;
        await this.director.idle();
        await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1200 }) : setTimeout(r, 200)));
        if (token !== this._preToken || this.director.running) return;
        await this.director.preload([id]);
        await nextFrame();
      }
    })().catch((err) => console.error('[preload]', err));
  }

  /** Загрузить код всех сцен и данные (без создания сцен) — чтобы показ не зависел от сети. */
  async prefetchAll() {
    await wait(1500);
    await this.director.prefetchModules?.();
    const data = ['land.json', 'airports.json', 'cities.json'];
    for (const f of data) {
      try { await fetch(new URL(`../../assets/data/${f}`, import.meta.url)); } catch { /* ignore */ }
    }
  }

  // ---------- Ошибки: в консоль и окно спикера, на проектор — только в режиме отладки ----------
  reportError(msg) {
    console.error('[presentation]', msg);
    this.channel?.postMessage({ type: 'error', msg: String(msg) });
    if (this.test || this.debug) this.ui?.error(msg);
  }

  // ---------- Полный экран ----------
  get isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  enterFullscreen() {
    if (this.isFullscreen) return;
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
      p?.then?.(() => {
        // Esc перехватываем (закрыть меню/снять затемнение); выйти из полного экрана — удерживать Esc или нажать F
        try { navigator.keyboard?.lock?.(['Escape']); } catch { /* ignore */ }
      }).catch?.(() => this.ui.toast('Нажмите F для полноэкранного режима'));
    } catch { /* ignore */ }
  }

  exitFullscreen() {
    try { navigator.keyboard?.unlock?.(); } catch { /* ignore */ }
    try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* ignore */ }
  }

  toggleFullscreen() {
    if (this.isFullscreen) this.exitFullscreen(); else this.enterFullscreen();
  }

  setupFullscreenWatch() {
    const on = () => document.body.classList.toggle('is-fullscreen', this.isFullscreen);
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
  }

  async requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
      if (!this._wakeWatch) {
        this._wakeWatch = true;
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible' && this.started) {
            try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
          }
        });
      }
    } catch { /* ignore */ }
  }

  // ---------- Тема и качество ----------
  toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    this.engine.setTheme(next);
    store.set('theme', next);
    this.ui.updateThemeName();
    this.ui.toast(next === 'light' ? 'Светлая тема (для светлого зала)' : 'Тёмная тема');
  }

  /** Q во время показа: разрешение 3D (100 → 75 → 55 %), автоподстройка после ручного выбора отключается. */
  cycleQuality() {
    if (this.noWebGL) return;
    const levels = [1, 0.75, 0.55];
    const names = ['высокое', 'среднее', 'низкое'];
    const cur = this.engine.dprScale;
    let i = levels.findIndex((l) => Math.abs(l - cur) < 0.06);
    i = (i + 1) % levels.length;
    this.engine.autoQuality = false;
    this.engine.setQualityScale(levels[i]);
    this.ui.toast('Разрешение графики: ' + names[i]);
  }

  /** Уровень качества (число частиц, сглаживание) — сохраняется и применяется после перезагрузки. */
  setQualityLevel(level) {
    store.set('quality-level', level);
    location.reload();
  }

  // ---------- Окно спикера ----------
  setupPresenterChannel() {
    if (!('BroadcastChannel' in window)) return;
    this.channel = new BroadcastChannel(CHANNEL);
    document.addEventListener('visibilitychange', () => this.syncPresenter());
    this.channel.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'hello') { this.sendOutline(); this.syncPresenter(); return; }
      if (m.type !== 'nav') return;
      const now = performance.now();
      if (now - this._lastNav < 220) return; // защита от автоповтора
      this._lastNav = now;
      if (m.action === 'curtain') { this.ui.setCurtain(this.ui.curtain ? null : 'black'); this.syncPresenter(); return; }
      if (this.ui.curtain) { this.ui.setCurtain(null); this.syncPresenter(); return; } // как с клавиатуры: сначала снять затемнение
      if (!this.started) { this.requestBegin({ fullscreen: false }); return; }
      if (m.action === 'next') this.deck.next();
      else if (m.action === 'prev') this.deck.prev();
      else if (m.action === 'goto') this.deck.goTo(m.index, m.step || 0);
    };
  }

  sendOutline() {
    if (!this.channel || !this.deck) return;
    this.channel.postMessage({
      type: 'outline',
      session: this.session,
      blocks: BLOCKS,
      slides: this.deck.slides.map((s) => ({ id: s.id, title: s.title || s.id, notes: s.notes || '', time: s.time || null, block: s.block ?? 0, steps: s._steps })),
    });
  }

  syncPresenter() {
    if (!this.channel || !this.deck) return;
    this.channel.postMessage({ type: 'state', session: this.session, visible: !document.hidden, index: this.deck.index, step: this.deck.step, started: this.started, curtain: this.ui?.curtain || null });
  }

  openPresenter() {
    const w = window.open('presenter.html', 'nsiii-presenter', 'width=1280,height=820');
    if (!w) this.ui.toast('Разрешите всплывающие окна для окна спикера');
    setTimeout(() => { this.sendOutline(); this.syncPresenter(); }, 1200);
  }

  // ---------- Для отладки и автотестов ----------
  goTo(i, step = 0, opts = {}) { this.deck.goTo(i, step, opts); }
  next() { this.deck.next(); }
  prev() { this.deck.prev(); }
}
