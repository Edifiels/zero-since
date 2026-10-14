// Движок: WebGL-рендер, пост-обработка, фон, частицы, камера, подписи, цикл кадров, адаптивное качество.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FinalPass, SanitizeShader, TRANSITION_MODE } from './postfx.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Background } from './background.js';
import { ParticleField } from './particles.js';
import { CameraRig } from './rig.js';
import { Labels } from './labels.js';
import { clamp } from './utils.js';

export const FX_DEFAULTS = {
  bloom: 0.7, bloomRadius: 0.42, bloomThreshold: 0.86,
  aberration: 0, warp: 0, flash: 0, vignette: 0.55, grain: 0.028,
  glitch: 0, scan: 0, dim: 0, sat: 1,
};

// Заглушка облака частиц (если GPGPU недоступен): тот же интерфейс, ничего не рисует.
class NullParticles {
  constructor(count) {
    this.count = count;
    this.owner = null;
    this.object = new THREE.Group();
    this.params = {};
    this.pointer = { enabled: false };
  }
  claim(owner) { this.owner = owner; }
  release(owner) { if (!owner || this.owner === owner) this.owner = null; }
  morph() { return Promise.resolve(); }
  snap() {}
  setParams() {}
  resetParams() {}
  explode() {}
  setPointer() {}
  resize() {}
  update() {}
}

export class Engine {
  constructor({ container, labelsRoot, quality = 'high', test = false, debug = false }) {
    this.container = container;
    this.quality = quality;
    this.test = test;
    this.time = 0;
    this.updates = new Set();
    this.resizers = new Set();
    this.stats = { fps: 60, frameMs: 16.7, dpr: 1, calls: 0, triangles: 0 };
    this.autoQuality = !test;          // адаптивное разрешение (отключается ручным выбором Q)
    this.canAdapt = () => true;        // приложение подменяет: не адаптировать во время переходов и загрузки

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    // Проверка ошибок шейдеров заставляет драйвер синхронно отдавать логи при первом использовании программы —
    // это рывки при показе. Включена только в тестах и режиме отладки (?debug).
    renderer.debug.checkShaderErrors = !!(test || debug);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.maxDpr = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2;
    this.dprScale = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    this.camera.position.set(0, 0, 14);
    this.rig = new CameraRig(this.camera);
    this.labels = new Labels(labelsRoot, this.camera);

    // Свет и окружение для «твёрдых» объектов (MeshStandardMaterial)
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.22;
    this.lights = new THREE.Group();
    this.lights.name = 'lights';
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0b2a0b, 0.45);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(6, 9, 8);
    const rim = new THREE.DirectionalLight(0x22ff22, 0.9);
    rim.position.set(-8, 2, -9);
    this.lights.add(hemi, key, rim);
    this.keyLight = key;
    this.rimLight = rim;
    this.scene.add(this.lights);

    this.background = new Background(this);
    this.scene.add(this.background.group);

    const side = quality === 'low' ? 128 : quality === 'medium' ? 192 : 256;
    try {
      this.particles = new ParticleField(renderer, { side });
    } catch (err) {
      // без GPGPU (нет float-текстур) отключаем только облако частиц, остальное 3D работает
      console.warn('[engine] облако частиц недоступно:', err);
      this.particles = new NullParticles(side * side);
    }
    this.scene.add(this.particles.object);

    // Пост-обработка
    // MSAA нужно только на высоком качестве и при обычной плотности пикселей (на Retina/4K оно избыточно)
    const msaa = quality === 'high' && (window.devicePixelRatio || 1) <= 1.25 ? 4 : 0;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), FX_DEFAULTS.bloom, FX_DEFAULTS.bloomRadius, FX_DEFAULTS.bloomThreshold);
    this.bloomScale = quality === 'high' ? 0.6 : 0.5;
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSetSize(Math.max(64, Math.round(w * this.bloomScale)), Math.max(64, Math.round(h * this.bloomScale)));
    this.output = new OutputPass();
    this.final = new FinalPass();
    this.sanitize = new ShaderPass(SanitizeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.sanitize);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.final);
    // статистика отрисовки именно сцены (финальные проходы сбрасывают renderer.info)
    const rpRender = this.renderPass.render.bind(this.renderPass);
    this.renderPass.render = (...args) => {
      rpRender(...args);
      this.stats.calls = renderer.info.render.calls;
      this.stats.triangles = renderer.info.render.triangles;
    };

    // t* — «транзиентные» каналы переходов режиссёра: складываются с базовыми, которыми управляют визуализации
    this.fx = { ...FX_DEFAULTS, invert: 0, mix: 1, tWarp: 0, tAberration: 0, tFlash: 0, tGlitch: 0, tScan: 0 };

    // Указатель (для параллакса и взаимодействия с частицами)
    this.pointer = new THREE.Vector2();
    this.pointerActive = false;
    this._pointerTimer = 0;
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.rig.pointer.copy(this.pointer);
      this.pointerActive = true;
      this._pointerTimer = 1.2;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { this.rig.pointer.set(0, 0); });

    // Потеря WebGL-контекста
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost');
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => location.reload());

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();

    this._last = performance.now();
    this._acc = { t: 0, n: 0, sum: 0, slow: 0, fast: 0, list: [], period: 1 / 60 };
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    // Прогрев шейдеров фона и частиц (в т. ч. невидимых «варп»-шлейфов) — чтобы первый переход не дёргался
    setTimeout(() => this.prewarm(), 0);
  }

  async prewarm() {
    try {
      const r = this.renderer;
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.composer.readBuffer);
      const p = r.compileAsync(this.scene, this.camera);
      r.setRenderTarget(prev);
      await p;
    } catch { /* не критично */ }
  }

  addUpdate(fn) { this.updates.add(fn); return () => this.updates.delete(fn); }
  addResize(fn) { this.resizers.add(fn); return () => this.resizers.delete(fn); }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, this.maxDpr) * this.dprScale; }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const dpr = this.pixelRatio;
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.background.resize(w, h, dpr);
    this.particles.resize(h * dpr, this.camera);
    this.labels.resize(w, h);
    this.stats.dpr = dpr;
    this.resizers.forEach((fn) => { try { fn(w, h, dpr); } catch (e) { console.error(e); } });
  }

  setQualityScale(s) {
    this.dprScale = clamp(s, 0.5, 1);
    this.resize();
  }

  setTheme(theme, duration = 0.8) {
    const light = theme === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    gsap.to(this.fx, { invert: light ? 1 : 0, duration, ease: 'power2.inOut', overwrite: 'auto' });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? '#f4f1e8' : '#000000';
  }

  /** Захватить текущий кадр для перехода «старый → новый». */
  snapshot() {
    return this.final.capture();
  }

  /**
   * Переход по маске от сохранённого кадра к живому.
   * mode: 'fade' | 'halftone' | 'glitch' | 'iris' | 'wipe' | 'dissolve'
   */
  transition(mode = 'fade', duration = 1.2, origin = [0.5, 0.5], ease = 'power1.inOut') {
    const u = this.final.uniforms;
    u.uMode.value = TRANSITION_MODE[mode] || 1;
    u.uOrigin.value.set(origin[0], origin[1]);
    gsap.killTweensOf(this.fx, 'mix');
    this.fx.mix = 0;
    return new Promise((resolve) => {
      gsap.to(this.fx, { mix: 1, duration, ease, onComplete: resolve, onInterrupt: resolve });
    });
  }

  /** Короткий всплеск эффекта: pulse({ aberration: 1, flash: .3 }, 0.8) */
  pulse(values, duration = 0.8, ease = 'power2.out') {
    for (const [k, v] of Object.entries(values)) {
      const base = FX_DEFAULTS[k] ?? 0;
      gsap.fromTo(this.fx, { [k]: v }, { [k]: base, duration, ease, overwrite: 'auto' });
    }
  }

  /** Плавно установить эффект: setFx({ bloom: 1.4 }, 1) ; resetFx() вернёт значения по умолчанию */
  setFx(values, duration = 0.8) {
    gsap.to(this.fx, { ...values, duration, ease: 'power2.inOut', overwrite: 'auto' });
  }
  resetFx(duration = 0.8) {
    this.setFx({ ...FX_DEFAULTS, aberration: 0, warp: 0, flash: 0, glitch: 0, scan: 0, dim: 0, sat: 1 }, duration);
  }

  _applyFx() {
    const f = this.fx, u = this.final.uniforms;
    // в светлой теме свечение превращается в «кляксы» туши — ослабляем
    this.bloom.strength = f.bloom * (1 - 0.55 * f.invert);
    this.bloom.radius = f.bloomRadius;
    this.bloom.threshold = f.bloomThreshold;
    this.bloom.enabled = f.bloom > 0.001;
    u.uAberration.value = f.aberration + f.tAberration;
    const warp = f.warp + f.tWarp;
    u.uWarp.value = Math.abs(warp) * 0.35;
    u.uFlash.value = f.flash + f.tFlash;
    u.uVignette.value = f.vignette;
    u.uGrain.value = f.grain;
    u.uGlitch.value = f.glitch + f.tGlitch;
    u.uScan.value = f.scan + f.tScan;
    u.uInvert.value = f.invert;
    u.uDim.value = f.dim;
    u.uSat.value = f.sat;
    u.uMix.value = f.mix;
    u.uTime.value = this.time;
    this.background.setWarp(warp);
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const rawDt = (now - this._last) / 1000;
    this._last = now;
    const dt = clamp(rawDt, 0, 0.1);
    if (this.lost) return;
    this.time += dt;
    const t = this.time;

    if (this._pointerTimer > 0) { this._pointerTimer -= dt; if (this._pointerTimer <= 0) this.pointerActive = false; }

    for (const fn of this.updates) {
      try { fn(dt, t); } catch (e) { console.error(e); }
    }
    this.rig.update(dt, t);
    this.camera.updateMatrixWorld();
    this.background.update(dt, t, this.camera);
    this.particles.update(dt, t, this.camera, this.pointer, this.pointerActive);
    this._applyFx();
    this.composer.render(dt);
    this.labels.update();
    this._stats(rawDt);
  }

  _stats(rawDt) {
    const a = this._acc;
    a.t += rawDt; a.n++; a.sum += rawDt;
    if (rawDt > 0 && rawDt < 0.25) a.list.push(rawDt);
    if (a.t < 1) return;
    const avg = a.sum / a.n;
    this.stats.frameMs = avg * 1000;
    this.stats.fps = Math.round(1 / avg);
    const list = a.list.sort((x, y) => x - y);
    const median = list.length ? list[Math.floor(list.length / 2)] : avg;
    const p10 = list.length ? list[Math.floor(list.length * 0.1)] : avg;
    a.t = 0; a.n = 0; a.sum = 0; a.list = [];
    // Период дисплея (30/60/120 Гц) — по самым быстрым кадрам за всё время; выше 60 fps не целимся
    // (на 30-герцовом выходе 33 мс — норма, а не повод снижать разрешение)
    if (list.length > 10) a.minP10 = Math.min(a.minP10 ?? Infinity, p10);
    a.period = Math.max(a.minP10 ?? 1 / 60, 1 / 60);
    // Адаптивное разрешение: только во время показа, без переходов и загрузки, с гистерезисом
    if (!this.autoQuality || document.hidden || !this.canAdapt()) { a.slow = 0; a.fast = 0; return; }
    if (median > a.period * 1.45) { a.slow++; a.fast = 0; }
    else if (median < a.period * 1.12) { a.fast++; a.slow = 0; }
    else { a.slow = 0; a.fast = 0; }
    if (a.slow >= 4 && this.dprScale > 0.6) { a.slow = 0; this.setQualityScale(this.dprScale - 0.12); }
    if (a.fast >= 10 && this.dprScale < 1) { a.fast = 0; this.setQualityScale(this.dprScale + 0.08); }
  }
}
