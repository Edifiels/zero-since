// Запасной режим без 3D: если WebGL 2 недоступен (старая видеокарта, удалённый рабочий стол, виртуальная машина),
// презентация работает как HTML-слайды — колода, кликер, голосования и окно спикера остаются.

export class NullEngine {
  constructor() {
    this.dprScale = 1;
    this.stats = { fps: 0, frameMs: 0, dpr: 1, calls: 0, triangles: 0 };
    this.fx = {};
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.quality = 'none';
    this.autoQuality = false;
    document.body.classList.add('no-webgl');
  }
  setTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }
  setQualityScale() {}
  addUpdate() { return () => {}; }
  addResize() { return () => {}; }
}

export class NullDirector {
  constructor() {
    this.registry = new Map();
    this.instances = new Map();
    this.loading = new Map();
    this.current = null;
    this.running = null;
  }
  register(map) { for (const [id, loader] of Object.entries(map || {})) this.registry.set(id, loader); }
  has(id) { return this.registry.has(id); }
  async get() { return null; }
  async preload() {}
  async prefetchModules() {}
  idle() { return Promise.resolve(); }
  show() {}
  step() {}
}
