// «Энергия» (блок 2): мозг ≈ 20 Вт → видеокарта H100 до 700 Вт (= 35 лампочек) → стойка → машинный зал →
// АЭС ~1 ГВт (Colossus 2) → 47 млн мозгов ≈ 95 городов размером с Пензу.
//
// Состояния:
//   'intro' — вопрос №3: справа мозг из частиц; шаг 1 — внутри загорается лампочка «≈ 20 Вт»;
//             шаг 2 — тизер: за мозгом из темноты поднимаются ряды серверных стоек.
//   'scale' — шаги 0…6: серия отъездов камеры («степени десяти»).
//
// Приём «бесконечного зума»: весь мир построен в метрах в одной группе world. Отъезд камеры — это уменьшение
// масштаба мира (в логарифмическом времени), камера всегда на одном расстоянии от фокуса и меняет только ракурс.
// Облако частиц — в «экранных» единицах: для каждого шага форма заранее пересчитана в координаты кадра.
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, lerp, formatNumber } from '../../core/utils.js';
import { glowTexture, makeLayer, applyLayer, glassMaterial, makeSparks, projScale, yieldFrame } from './kit.js';
import * as M from './models.js';

const D = 14, FOV = 40;
const VIS_H = 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- Мир (метры): стойка-герой в начале координат, лицом к +Z ----------
const BULB_BASE = V3(-0.30, 1.185, 1.15);                       // низ цоколя лампочки-«мозга»
const BULB_C = V3(BULB_BASE.x, BULB_BASE.y + 0.06, BULB_BASE.z); // визуальный центр лампочки
const GPU_SHOW = V3(0.02, 1.245, 1.15);                          // видеокарта «на показе»
const GPU_SLOT = V3(...M.rackSlot(...M.HERO_SLOT));               // её место в стойке
const GPU_TURN = 0.4;                                            // поворот «на показе» (вид 3/4)
const MINI = { cols: 7, rows: 5, dx: 0.06, dy: 0.08, scale: 0.7, c: V3(0.2, 1.235, 1.15) };
const PLANT_O = [430, -470];
const DC_C = V3(9, 0, -37);
const CITY_COUNT = 95;

// Кадры: F — видимая высота кадра в фокусе (м), yaw/pitch — ракурс, ox/oy — положение фокуса на экране (доли сцены 16:9)
const LV = {
  intro: { F: 0.62, focus: BULB_C, yaw: 0, pitch: 0.02, ox: 0.215, oy: -0.02 },
  intro2: { F: 0.62, focus: BULB_C, yaw: 0.04, pitch: 0.07, ox: 0.23, oy: 0.06 },
  s0: { F: 0.235, focus: BULB_C, yaw: -0.16, pitch: 0.1, ox: 0.17, oy: -0.08 },
  s1: { F: 0.6, focus: V3(-0.115, 1.235, 1.15), yaw: -0.2, pitch: 0.2, ox: 0.1, oy: -0.13 },
  s2: { F: 0.84, focus: V3(-0.02, 1.235, 1.15), yaw: -0.06, pitch: 0.1, ox: 0.1, oy: -0.1 },
  s3: { F: 3.35, focus: V3(0.05, 1.05, 0.45), yaw: 0.52, pitch: 0.2, ox: 0.2, oy: -0.075 },
  s4: { F: 19, focus: V3(0.5, 0, -6.8), yaw: 0.5, pitch: 0.46, ox: 0.1, oy: -0.1 },
  s5: { F: 700, focus: V3(330, 70, -370), yaw: 0.72, pitch: 0.3, ox: 0.06, oy: -0.12 },
  s6: { F: 1.32e6, focus: V3(0, 0, -50e3), yaw: 0.12, pitch: 1.02, ox: 0.1, oy: -0.06 },
};
// длительность перехода между соседними шагами (по старшему шагу)
const DUR = [2.2, 2.1, 1.8, 2.8, 3.0, 3.4, 3.8];
const BG = { intro: 'right', intro2: 'corner', s0: 'soft', s1: 'soft', s2: 'soft', s3: 'corner', s4: 'soft', s5: 'banner', s6: 'low' };
const PARAMS = {
  intro: { noise: 0.22, size: 0.06, twinkle: 0.3, spring: 16, damping: 5.5, swirl: 0 },
  s0: { noise: 0.16, size: 0.05, twinkle: 0.5, spring: 16, damping: 5.5, swirl: 0.14 },
  s1: { noise: 0.14, size: 0.046, twinkle: 0.4, spring: 16, damping: 5.5, swirl: 0 },
  s2: { noise: 0.1, size: 0.046, twinkle: 0.35, spring: 18, damping: 6, swirl: 0 },
  s3: { noise: 0.2, size: 0.042, twinkle: 0.4, spring: 16, damping: 5.5, swirl: 0 },
  s4: { noise: 0.25, size: 0.04, twinkle: 0.35, spring: 16, damping: 5.5, swirl: 0 },
  s5: { noise: 0.5, size: 0.062, twinkle: 0.2, spring: 12, damping: 5, swirl: 0 },
  s6: { noise: 0.06, size: 0.044, twinkle: 0.45, spring: 16, damping: 5.5, swirl: 0 },
};

export default class Energy extends Visual {
  static transition = 'zoom';

  async init() {
    this.n = this.ctx.particles.count;
    this.cache = new Map();
    this.S = 1;
    this.vFrom = { logS: 0, f: new THREE.Vector3() };
    this.vTo = { logS: 0, f: new THREE.Vector3() };
    this.vCur = { logS: 0, f: new THREE.Vector3() };
    this.viewT = { u: 1 };
    this._dur = 1.6;
    // анимируемые величины
    this.k = { power: 0, minis: 0, reveal: 0, rise: 0, wave: 0, map: 0, site: 1, teaser: 0, wobble: 1, gpuX: GPU_SHOW.x, gpuY: GPU_SHOW.y, gpuZ: GPU_SHOW.z, gpuR: GPU_TURN, sway: 0 };

    this.glowTex = glowTexture();
    this.world = new THREE.Group();
    this.world.name = 'energy-world';
    this.root.add(this.world);

    // --- Лампочка-«мозг»
    this.bulb = M.buildBulb(this.glowTex);
    this.bulb.group.position.copy(BULB_BASE);
    this.world.add(this.bulb.group);

    // --- Видеокарта
    this.gpu = M.buildGPU();
    this.gpu.group.position.copy(GPU_SHOW);
    this.world.add(this.gpu.group);

    // --- 35 лампочек (7×5)
    this.gMinis = new THREE.Group();
    this.world.add(this.gMinis);
    const miniGlassGeo = new THREE.LatheGeometry(M.bulbGlassProfile(0.6), 28).scale(MINI.scale, MINI.scale, MINI.scale);
    const miniBaseGeo = new THREE.LatheGeometry(M.bulbBaseProfile(false), 20).scale(MINI.scale, MINI.scale, MINI.scale);
    this.miniPos = [];
    const ign = new Float32Array(MINI.cols * MINI.rows);
    for (let r = 0; r < MINI.rows; r++) {
      for (let c = 0; c < MINI.cols; c++) {
        const i = r * MINI.cols + c;
        const p = V3(MINI.c.x + (c - (MINI.cols - 1) / 2) * MINI.dx, MINI.c.y + ((MINI.rows - 1) / 2 - r) * MINI.dy - 0.04, MINI.c.z);
        this.miniPos.push(p);
        ign[i] = (c + r * 0.35) / (MINI.cols + MINI.rows * 0.35);
      }
    }
    const miniGlassMat = glassMaterial({ color: '#e4fbe6', glow: '#ffdcae', ignite: true, neck: 0.03 * MINI.scale });
    this.miniGlass = new THREE.InstancedMesh(miniGlassGeo, miniGlassMat, this.miniPos.length);
    this.miniBase = new THREE.InstancedMesh(miniBaseGeo, new THREE.MeshStandardMaterial({ color: '#b9c2bb', metalness: 0.9, roughness: 0.3, transparent: true }), this.miniPos.length);
    const m4 = new THREE.Matrix4();
    this.miniPos.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); this.miniGlass.setMatrixAt(i, m4); this.miniBase.setMatrixAt(i, m4); });
    miniGlassGeo.setAttribute('aIgnite', new THREE.InstancedBufferAttribute(ign, 1));
    this.miniGlass.renderOrder = 6;
    this.miniFil = makeSparks(this.miniPos.map((p, i) => ({ p: [p.x, p.y + M.BULB.filament * MINI.scale + 0.001, p.z], size: 0.03, color: [1.6, 1.25, 0.85], delay: ign[i], phase: Math.random() })), { twinkle: 0.06, minPx: 2 });
    this.miniFil.renderOrder = 7;
    this.gMinis.add(this.miniBase, this.miniGlass, this.miniFil);
    await yieldFrame();

    // --- Стойка-герой и её индикаторы
    this.cardTex = M.cardTexture();
    this.rack = M.buildHeroRack(this.cardTex);
    this.rackLeds = makeSparks(this.rack.leds.map((l) => ({ p: l.p, size: 0.016, color: l.k === 3 ? [1.6, 1.7, 1.6] : [0.2, 2.2, 0.25], phase: l.phase })), { twinkle: 0.9, minPx: 1.6 });
    this.rack.group.add(this.rackLeds);
    this.world.add(this.rack.group);

    // --- Машинный зал (24 зала в здании; в первом — стойка-герой) и пол
    this.gHall = new THREE.Group();
    this.rackMat = M.rackMaterial();
    this.hall = M.buildRackField(M.hallLayout(), this.rackMat);
    this.floor = M.buildFloor();
    this.gHall.add(this.floor, this.hall);
    this.world.add(this.gHall);
    await yieldFrame();

    // --- Здание
    this.building = M.buildBuilding();
    this.world.add(this.building.group);

    // --- АЭС и пар
    this.gPlant = new THREE.Group();
    this.plant = M.buildPlant(PLANT_O);
    this.steam = M.buildSteam(this.plant.towers, 520);   // ~2 тыс. мягких точек: пар плотный, но без лишней перерисовки
    this.gPlant.add(this.plant.group, this.steam);
    this.world.add(this.gPlant);

    // --- Земля / карта
    this.ground = M.buildGround();
    this.world.add(this.ground);

    // --- Карта: 95 городов, дороги, «маяк» дата-центра
    this.gMap = new THREE.Group();
    this.cities = genCities();
    const maxD = Math.max(...this.cities.map(([x, z]) => Math.hypot(x, z)));
    this.waveMax = 1.42e6;                 // волна уходит за край карты и гаснет
    this.waveDone = (maxD * 1.03) / this.waveMax; // доля пути, когда зажёгся последний город
    this.citySparks = makeSparks(this.cities.map(([x, z]) => ({ p: [x, 900, z], size: 44000, color: [0.7, 1.45, 0.75], delay: Math.hypot(x, z) / this.waveMax, phase: Math.random() })), { twinkle: 0.12, minPx: 3, maxPx: 70 });
    this.citySparks.renderOrder = 9;
    this.beacon = makeSparks([{ p: [DC_C.x, 2000, DC_C.z], size: 60000, color: [1.6, 2.2, 1.6] }], { twinkle: 0.3, minPx: 8, maxPx: 70 });
    this.beacon.renderOrder = 9;
    this.roads = buildRoads(this.cities, this.waveMax);
    this.gMap.add(this.roads, this.citySparks, this.beacon);
    this.world.add(this.gMap);
    await yieldFrame();

    // --- Тизер (вне мира, в экранных единицах): бесконечный машинный зал встаёт из темноты до горизонта за мозгом
    this.gTeaser = new THREE.Group();
    this.teaserMat = M.rackMaterial({ body: 0.85, fog: [26, 120], ledR: 2.2, led: 1.3 });
    const titems = [];
    const ROWS = 18, PER = 36;
    for (let r = 0; r < ROWS; r++) {
      for (let i = 0; i < PER; i++) {
        const x = -4 + i * 0.62;
        titems.push({ x, z: -r * 3.4, face: 1, reveal: 0.03 + (r / ROWS) * 0.85 + Math.abs(x - 4) * 0.004, seed: Math.random() });
      }
    }
    this.teaser = M.buildRackField(titems, this.teaserMat);
    this.gTeaser.add(this.teaser);
    this.gTeaser.scale.setScalar(2.1);
    this.gTeaser.position.set(-1.5, -12.5, -16);
    this.root.add(this.gTeaser);
    await yieldFrame();

    // --- «Нейроны срабатывают»: вспышки на коре мозга (интро). Следуют за облаком частиц.
    const brain = this.shape('intro');
    const rs = rng(17);
    const sparkPts = [];
    for (let i = 0; i < 260; i++) {
      const j = Math.floor(rs() * brain.count * 0.7) * 4;   // точки коры (первые ~70% формы)
      sparkPts.push({ p: [brain.positions[j], brain.positions[j + 1], brain.positions[j + 2]], size: rs.range(0.07, 0.14), color: rs() < 0.6 ? [0.5, 2.4, 0.6] : [2, 2.2, 2], phase: rs() });
    }
    this.brainSparks = makeSparks(sparkPts, { flash: true, minPx: 2, maxPx: 40 });
    this.brainSparks.renderOrder = 11;
    this.gSparks = new THREE.Group();
    this.gSparks.add(this.brainSparks);
    this.root.add(this.gSparks);
    await yieldFrame();

    // --- Слои с собственной прозрачностью
    const L = (g) => makeLayer(g, 0);
    this.L = {
      bulb: L(this.bulb.group), gpu: L(this.gpu.group), minis: L(this.gMinis), rack: L(this.rack.group),
      hall: L(this.gHall), building: L(this.building.group), plant: L(this.gPlant), ground: L(this.ground),
      map: L(this.gMap), teaser: L(this.gTeaser), sparks: L(this.gSparks),
    };
    this.layerList = Object.values(this.L);
    Object.values(this.L).forEach((l) => applyLayer(l, 0));

    // --- Якоря подписей
    const anchor = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); this.world.add(o); return o; };
    this.A = {
      w20: anchor(BULB_C.x, BULB_C.y - 0.19, BULB_C.z),
      bulb: anchor(BULB_BASE.x, BULB_BASE.y - 0.018, BULB_BASE.z),
      gpu: anchor(GPU_SHOW.x, GPU_SHOW.y - 0.09, GPU_SHOW.z),
      one: anchor(BULB_BASE.x, BULB_BASE.y - 0.02 - 0.04, BULB_BASE.z),
      eq: anchor((BULB_C.x + this.miniPos[0].x) / 2 - 0.004, BULB_C.y - 0.01, BULB_C.z),
      grid: anchor(MINI.c.x, MINI.c.y - (MINI.rows / 2) * MINI.dy - 0.03, MINI.c.z),
      dot: anchor(BULB_C.x - 0.05, BULB_C.y, BULB_C.z),
      dc: anchor(-40, 16, 3),
      npp: anchor(PLANT_O[0] + 60, 250, PLANT_O[1] - 60),
      dcMap: anchor(DC_C.x, 0, DC_C.z),
    };
  }

  /** Досчитать формы шагов в фоне по одной (каждая — десятки мс), чтобы клики шли без рывков. Форма «intro» — в init(). */
  warmShapes() {
    if (this._warm) return;
    this._warm = true;
    const keys = ['intro1', 's0', 's1', 's2', 's3', 's4', 's5', 's6'];
    // после перехода входа (иначе рывки посреди морфинга), по одной форме в свободное время между кадрами
    const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 0));
    const next = () => {
      const key = keys.shift();
      if (!key || this._disposed) return;
      if (!this.cache.has(key)) this.shape(key);
      setTimeout(() => idle(next), 160);
    };
    setTimeout(() => idle(next), 2200);
  }

  // ------------------------------------------------------------------ формы частиц
  lvKey(state, step) {
    if (state === 'intro') return step >= 2 ? 'intro2' : 'intro';
    return 's' + clamp(step | 0, 0, 6);
  }

  /** Перевести форму из метров мира в экранные единицы кадра lv. */
  toScene(s, lv) {
    const Sx = VIS_H / lv.F;
    return S.transform(s, { position: [-lv.focus.x * Sx, -lv.focus.y * Sx, -lv.focus.z * Sx], scale: Sx });
  }

  shape(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const n = this.n;
    let s;
    const P = S.PAL;
    const bulbGeo = () => new THREE.LatheGeometry(M.bulbGlassProfile(0.6), 24);
    const glassAt = (m, pos, scale = 1, alpha = 0.32, seed = 3) => {
      const g = bulbGeo().scale(scale, scale, scale);
      const sh = S.fromGeometry(m, g, { colorFn: (v, nn, r) => (r() < 0.12 ? P.greenHi : r() < 0.5 ? P.warm : P.white), size: 0.75, alpha, seed });
      g.dispose();
      return S.transform(sh, { position: [pos.x, pos.y, pos.z] });
    };
    const halo = (m, c, r0, r1, seed = 5, alpha = 0.5) => {
      const sh = S.createShape(m), r = rng(seed);
      for (let i = 0; i < m; i++) {
        const t = Math.pow(r(), 1.8);
        const rr = r0 + (r1 - r0) * t;
        const [x, y, z] = r.onSphere(rr);
        const col = r() < 0.1 ? P.greenHi : r() < 0.55 ? P.warm : P.white;
        S.setPoint(sh, i, c.x + x, c.y + y * 0.92, c.z + z, r.range(0.35, 0.9), col, alpha * (1 - t) * r.range(0.4, 1));
      }
      return sh;
    };
    const dust = (m, c, R, seed = 7, alpha = 0.18) => {
      const sh = S.createShape(m), r = rng(seed);
      for (let i = 0; i < m; i++) {
        const [x, y, z] = r.inSphere(R);
        S.setPoint(sh, i, c.x + x, c.y + y * 0.6, c.z + z * 0.6, r.range(0.3, 0.8), r() < 0.25 ? P.mint : P.white, alpha * r.range(0.3, 1));
      }
      return sh;
    };
    const fil = V3(BULB_BASE.x, BULB_BASE.y + M.BULB.filament, BULB_BASE.z);
    switch (key) {
      case 'intro': {
        s = S.brain(n, { scale: 2.8, seed: 9, brightness: 0.85, ridge: P.white, groove: P.green, interior: 0.03 });
        S.transform(s, { rotation: [0.12, -1.22, 0.04] });
        S.fade(s, 0.6);
        S.equalize(s, { target: 5.5 });
        break;
      }
      case 'intro1': {
        // тот же мозг, подсвеченный изнутри тёплым светом
        const b = this.shape('intro');
        s = S.createShape(n);
        s.positions.set(b.positions);
        s.colors.set(b.colors);
        for (let i = 0; i < n; i++) {
          const j = i * 4;
          const x = s.positions[j], y = s.positions[j + 1], z = s.positions[j + 2];
          const k = Math.exp(-(x * x + y * y + z * z) / (2 * 1.7 * 1.7));
          s.colors[j] = lerp(s.colors[j], 1.45, 0.6 * k);
          s.colors[j + 1] = lerp(s.colors[j + 1], 1.15, 0.6 * k);
          s.colors[j + 2] = lerp(s.colors[j + 2], 0.75, 0.6 * k);
          s.colors[j + 3] *= 1 + 0.35 * k;
        }
        s.meta.equalized = b.meta.equalized;
        break;
      }
      case 'intro2': s = this.shape('intro1'); break;
      case 's0': {
        s = S.combine(n, [
          { weight: 0.22, shape: (m) => glassAt(m, BULB_BASE, 1, 0.16, 3) },
          { weight: 0.5, shape: (m) => halo(m, fil, 0.04, 0.24, 5, 0.22) },
          { weight: 0.28, shape: (m) => dust(m, BULB_C, 0.7, 7, 0.14) },
        ]);
        s = this.toScene(s, LV.s0);
        break;
      }
      case 's1': {
        // видеокарта окутана «облаком» (частицы — это то, во что она сейчас рассыплется)
        const gpuBox = new THREE.BoxGeometry(M.GPU.L + 0.01, M.GPU.H + 0.01, 0.05);
        s = S.combine(n, [
          { weight: 0.36, shape: (m) => { const sh = S.fromGeometry(m, gpuBox, { colorFn: (v, nn, r) => (r() < 0.2 ? P.greenHi : r() < 0.6 ? P.mint : P.white), size: 0.55, alpha: 0.09, seed: 11 }); return S.transform(sh, { position: [GPU_SHOW.x, GPU_SHOW.y, GPU_SHOW.z], rotation: [0, GPU_TURN, 0] }); } },
          { weight: 0.16, shape: (m) => glassAt(m, BULB_BASE, 1, 0.16, 4) },
          { weight: 0.28, shape: (m) => halo(m, fil, 0.036, 0.15, 6, 0.22) },
          { weight: 0.2, shape: (m) => dust(m, V3(-0.12, 1.24, 1.0), 0.9, 8, 0.12) },
        ]);
        gpuBox.dispose();
        s = this.toScene(s, LV.s1);
        break;
      }
      case 's2': {
        const parts = this.miniPos.map((p, i) => ({ weight: 1, shape: (m) => glassAt(m, V3(p.x, p.y, p.z), MINI.scale, 0.34, 20 + i) }));
        parts.push({ weight: 3, shape: (m) => glassAt(m, BULB_BASE, 1, 0.3, 4) });
        parts.push({ weight: 4.5, shape: (m) => dust(m, V3(0, 1.24, 1.0), 1.0, 9, 0.13) });
        s = this.toScene(S.combine(n, parts), LV.s2);
        break;
      }
      case 's3': {
        // лёгкое свечение «лиц» видеокарт и пыль вокруг стойки
        s = S.combine(n, [
          { weight: 0.3, shape: (m) => {
            const sh = S.createShape(m), r = rng(31);
            for (let i = 0; i < m; i++) {
              const t = r.int(0, M.RACK.trays - 1), c = r.int(0, 1);
              const [x, y, z] = M.rackSlot(t, c, 0);
              S.setPoint(sh, i, x + r.range(-0.13, 0.13), y + r.range(-0.05, 0.05), z + 0.03 + Math.abs(r.gauss(0, 0.02)), r.range(0.35, 0.8), r() < 0.35 ? P.greenHi : P.white, r.range(0.05, 0.14));
            }
            return sh;
          } },
          { weight: 0.7, shape: (m) => dust(m, V3(0, 1.1, 0.4), 2.6, 33, 0.1) },
        ]);
        s = this.toScene(s, LV.s3);
        break;
      }
      case 's4': {
        // холодный воздух стелется по «холодным» коридорам, тёплый — поднимается из «горячих»
        s = S.combine(n, [
          { weight: 0.55, shape: (m) => {
            const sh = S.createShape(m), r = rng(41);
            for (let i = 0; i < m; i++) {
              const k = r.int(0, 3);
              const zc = 1.15 - 4.3 * k;
              S.setPoint(sh, i, r.range(-7.6, 7.6), Math.abs(r.gauss(0, 0.25)) + 0.03, zc + r.gauss(0, 0.22), r.range(0.4, 1.0), r() < 0.35 ? P.mint : P.white, r.range(0.06, 0.2));
            }
            return sh;
          } },
          { weight: 0.25, shape: (m) => {
            const sh = S.createShape(m), r = rng(42);
            for (let i = 0; i < m; i++) {
              const k = r.int(0, 3);
              const zc = -1.0 - 4.3 * k;
              const t = r();
              S.setPoint(sh, i, r.range(-7.6, 7.6), 2.2 + t * 1.6, zc + r.gauss(0, 0.25 + t * 0.4), r.range(0.4, 0.9), r() < 0.3 ? P.warm : P.white, r.range(0.04, 0.12) * (1 - t * 0.7));
            }
            return sh;
          } },
          { weight: 0.2, shape: (m) => dust(m, V3(0, 2, -7), 13, 43, 0.08) },
        ]);
        s = this.toScene(s, LV.s4);
        s.meta.axis = 'y';
        break;
      }
      case 's5': {
        s = S.combine(n, [
          { weight: 0.6, shape: (m) => {
            // пар над градирнями — объёмные клубы
            const sh = S.createShape(m), r = rng(51);
            const towers = this.plant.towers;
            for (let i = 0; i < m; i++) {
              const [tx, tz] = towers[i % towers.length];
              const t = Math.pow(r(), 0.85);
              const h = M.TOWER.h + 10 + t * 240;
              const rad = 32 + t * 85;
              const [ux, uy, uz] = r.inSphere(1);
              S.setPoint(sh, i, tx + ux * rad + t * t * 130, h + uy * rad * 0.5, tz + uz * rad, r.range(0.45, 1.0), r() < 0.1 ? P.mint : P.white, r.range(0.012, 0.04) * (1 - t * 0.5));
            }
            return sh;
          } },
          { weight: 0.2, shape: (m) => {
            const sh = S.createShape(m), r = rng(52);
            const b = this.building.bounds;
            for (let i = 0; i < m; i++) S.setPoint(sh, i, r.range(b.x0, b.x1), r.range(0.5, 3), r.range(b.z0, b.z1), r.range(0.4, 0.9), r() < 0.5 ? P.green : P.white, r.range(0.05, 0.16));
            return sh;
          } },
          { weight: 0.2, shape: (m) => dust(m, V3(300, 30, -330), 900, 53, 0.08) },
        ]);
        s = this.toScene(s, LV.s5);
        break;
      }
      case 's6': {
        s = S.combine(n, [
          { weight: 0.93, shape: (m) => cityShape(m, this.cities) },
          { weight: 0.07, shape: (m) => {
            const sh = S.createShape(m), r = rng(62);
            for (let i = 0; i < m; i++) {
              let x, z;
              do { x = r.range(-1, 1) * 1.05e6; z = r.range(-1, 1) * 0.68e6; } while ((x / 1.05e6) ** 2 + (z / 0.68e6) ** 2 > 1);
              S.setPoint(sh, i, x, 0, z, r.range(0.3, 0.7), r() < 0.3 ? P.mint : P.white, r.range(0.05, 0.2));
            }
            return sh;
          } },
        ]);
        s = this.toScene(s, LV.s6);
        s.meta.axis = 'y';
        break;
      }
      default: s = S.dust(n);
    }
    this.cache.set(key, s);
    return s;
  }

  // ------------------------------------------------------------------ камера и вид мира
  poseFor(lv) {
    // Кадр считаем для сцены 16:9: на экранах уже 16:9 ядро само расширит угол обзора (director.fitPose),
    // и 3D останется на тех же местах относительно HTML-колонок.
    const w = VIS_H * 16 / 9, h = VIS_H;
    const cp = Math.cos(lv.pitch), sp = Math.sin(lv.pitch), cy = Math.cos(lv.yaw), sy = Math.sin(lv.yaw);
    const back = [cp * sy, sp, cp * cy];
    const right = [cy, 0, -sy];
    const up = [-sy * sp, cp, -cy * sp];
    const T = [0, 1, 2].map((i) => -(lv.ox * w) * right[i] - (lv.oy * h) * up[i]);
    const pos = [0, 1, 2].map((i) => T[i] + back[i] * D);
    return { pos, target: T, fov: FOV };
  }

  camera(state, step) {
    const lv = LV[this.lvKey(state ?? 'intro', step ?? 0)];
    return { ...this.poseFor(lv), duration: this._dur, arc: 0.03 };
  }

  background(state, step) { return BG[this.lvKey(state ?? 'intro', step ?? 0)]; }

  setView(lv, dur) {
    const Sx = VIS_H / lv.F;
    this.vFrom.logS = this.vCur.logS;
    this.vFrom.f.copy(this.vCur.f);
    this.vTo.logS = Math.log(Sx);
    this.vTo.f.copy(lv.focus);
    this.viewTween?.kill();
    this.viewT.u = 0;
    if (dur <= 0) { this.viewT.u = 1; this.applyView(); return; }
    this.viewTween = this.tw(this.viewT, { u: 1, duration: dur, ease: 'power3.inOut' });
  }

  applyView() {
    const u = this.viewT.u;
    const lsA = this.vFrom.logS, lsB = this.vTo.logS;
    const ls = lsA + (lsB - lsA) * u;
    const FA = Math.exp(-lsA), FB = Math.exp(-lsB), F = Math.exp(-ls);
    const g = Math.abs(FB - FA) > 1e-6 * Math.max(FA, FB) ? (F - FA) / (FB - FA) : u;
    this.vCur.logS = ls;
    this.vCur.f.lerpVectors(this.vFrom.f, this.vTo.f, g);
    const Sx = Math.exp(ls);
    this.S = Sx;
    this.world.scale.setScalar(Sx);
    this.world.position.copy(this.vCur.f).multiplyScalar(-Sx);
  }

  // ------------------------------------------------------------------ целевые значения шага
  targets(state, step) {
    if (state === 'intro') {
      return {
        bulb: step >= 1 ? 1 : 0, power: step >= 1 ? 1 : 0, gpu: 0, minis: 0, minisO: 0, rack: 0, hall: 0, reveal: 0,
        building: 0, plant: 0, rise: 0, ground: 0, site: 1, map: 0, mapO: 0, wave: 0,
        teaser: step >= 2 ? 1 : 0, teaserRise: step >= 2 ? 1 : 0, wobble: 1, slot: false,
      };
    }
    const s = clamp(step | 0, 0, 6);
    return {
      bulb: s <= 3 ? 1 : 0, power: 1, gpu: s === 1 || (s >= 3 && s <= 5) ? 1 : 0, minis: s === 2 ? 1 : 0, minisO: s === 2 ? 1 : 0,
      rack: s >= 3 && s <= 5 ? 1 : 0, hall: s >= 4 && s <= 5 ? 1 : 0, reveal: s >= 5 ? 2.75 : s >= 4 ? 1.0 : 0,
      building: s === 5 ? 1 : 0, plant: s === 5 ? 1 : 0, rise: s >= 5 ? 1 : 0, ground: s >= 5 ? 1 : 0, site: s === 5 ? 1 : 0, map: s >= 6 ? 1 : 0,
      mapO: s >= 6 ? 1 : 0, wave: s >= 6 ? 1 : 0, teaser: 0, teaserRise: 0, wobble: 0, slot: s >= 3,
    };
  }

  durationFor(fromState, fromStep, state, step) {
    if (fromState !== state) return 2.4;
    const a = clamp(fromStep | 0, 0, 6), b = clamp(step | 0, 0, 6);
    if (state === 'intro') return 1.6;
    if (a === b) return 1.2;
    let d = 0;
    for (let i = Math.min(a, b) + 1; i <= Math.max(a, b); i++) d = Math.max(d, DUR[i]);
    return d + (Math.abs(a - b) - 1) * 0.5;
  }

  // ------------------------------------------------------------------ жизненный цикл
  /** Запомнить элемент текущего слайда (для счётчика, который ведёт сама визуализация). */
  bindEl(el) {
    if (!el || el === this.el) return;
    this.el = el;
    this.countEl = el.querySelector('[data-b2a-count]');
    this._countV = -1;
  }

  enter(o = {}) {
    const state = o.state || 'intro', step = o.step ?? 0;
    this.state = state;
    this.step = step;
    this.bindEl(o.el);
    this._dur = o.instant ? 0 : (o.duration ?? 1.6);
    this.claimParticles();
    const p = this.particles;
    const key = this.lvKey(state, step);
    const pk = this.particleKey(state, step);
    p.setParams(PARAMS[pk.startsWith('intro') ? 'intro' : pk], o.instant ? 0 : 1);
    if (o.instant) p.snap(this.shape(pk));
    else p.morph(this.shape(pk), { duration: 2.0, stagger: 0.5, burst: 10 });
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    // мир сразу в нужном кадре (камеру ведёт переход режиссёра)
    this.vCur.logS = Math.log(VIS_H / LV[key].F);
    this.vCur.f.copy(LV[key].focus);
    this.setView(LV[key], 0);
    this.apply(this.targets(state, step), 0, 1);
    this.makeLabels();
    this.showLabels(state, step, o.instant ? 0 : 0.9);
    this.warmShapes();
    return super.enter(o);
  }

  particleKey(state, step) {
    if (state === 'intro') return step >= 1 ? 'intro1' : 'intro';
    return 's' + clamp(step | 0, 0, 6);
  }

  setState(state, o = {}) { this.go(state, o.step ?? 0, o); }
  setStep(step, o = {}) { this.go(this.state, step, o); }

  go(state, step, o = {}) {
    this.bindEl(o.el);
    const fromState = this.state, fromStep = this.step;
    if (fromState === state && fromStep === step && !o.force) return;
    this.state = state;
    this.step = step;
    const instant = !!o.instant;
    const dur = instant ? 0 : this.durationFor(fromState, fromStep, state, step);
    this._dur = dur;
    const fwd = fromState === state ? step > fromStep : state === 'scale';
    const key = this.lvKey(state, step);
    this.setView(LV[key], dur);
    this.apply(this.targets(state, step), dur, fwd ? 1 : -1, fromState, fromStep);
    // частицы
    this.claimParticles();
    const p = this.particles;
    const pk = this.particleKey(state, step);
    const prevPk = this.particleKey(fromState, fromStep);
    p.setParams(PARAMS[pk.startsWith('intro') ? 'intro' : pk], instant ? 0 : Math.min(1.4, dur));
    if (pk !== prevPk) {
      if (instant) p.snap(this.shape(pk));
      else {
        const colorOnly = (pk === 'intro1' && prevPk === 'intro') || (pk === 'intro' && prevPk === 'intro1') || (pk === 'intro2' || prevPk === 'intro2');
        const leaving = fromState === 'intro' && state === 'scale';
        p.morph(this.shape(pk), colorOnly
          ? { duration: 1.2, stagger: 0.25, burst: 0 }
          : { duration: Math.max(1.2, dur * 0.85), stagger: 0.4, burst: leaving ? 14 : 8, explode: leaving ? 5 : 0 });
      }
    }
    // эффекты перехода: «варп»-всплеск и аберрация на отъездах/наездах
    if (!instant && dur > 1.3 && (state === 'scale' || fromState !== state)) {
      const e = this.ctx.engine;
      const zoomOut = fromState === state ? step > fromStep : state === 'intro';
      e.pulse({ aberration: 1.1 }, dur * 0.8);
      e.setFx({ warp: (zoomOut ? -0.42 : 0.42) * (step >= 5 || fromStep >= 5 ? 1.3 : 1) }, dur * 0.35);
      this._warpReset?.kill();   // при быстрых кликах старый отложенный сброс не обрывает новый «варп»
      this._warpReset = this.delay(dur * 0.38, () => e.setFx({ warp: 0 }, dur * 0.55));
      if (state === 'scale' && step >= 5 && fwd) this.ctx.background.surge(0.45, dur);
    }
    this.showLabels(state, step, instant ? 0 : dur * 0.72);
  }

  /** Привести анимируемые величины к целям шага. dir: 1 — вперёд (отъезд), −1 — назад. */
  apply(tg, dur, dir, fromState, fromStep) {
    const k = this.k;
    // перед новой целью снимаем и активные, и ещё не начавшиеся (с задержкой) твины тех же свойств —
    // иначе при быстрых кликах «вперёд-назад» отложенный твин сработает позже и испортит картинку
    const T = (target, vars, d, delay = 0, ease = 'power2.inOut') => {
      gsap.killTweensOf(target, Object.keys(vars).join(','));
      if (dur <= 0) { Object.assign(target, vars); return; }
      this.tw(target, { ...vars, duration: d, delay, ease });
    };
    // прозрачности слоёв: появление — во второй половине отъезда, исчезновение — в первой
    const fade = (L, v, inDelay = 0.3, outDur = 0.4) => {
      gsap.killTweensOf(L);
      if (Math.abs(L.o - v) < 1e-3) { L.o = v; return; }
      const up = v > L.o;
      T(L, { o: v }, up ? Math.max(0.3, dur * 0.45) : Math.max(0.25, dur * outDur), up ? dur * inDelay : 0, 'power1.inOut');
    };
    const Lr = this.L;
    fade(Lr.bulb, tg.bulb, 0.1);
    fade(Lr.gpu, tg.gpu, fromStep === 2 ? 0.05 : 0.25, fromStep === 1 && tg.minis ? 0.14 : 0.4);
    fade(Lr.minis, tg.minisO, 0.05, 0.3);
    fade(Lr.rack, tg.rack, 0.2);
    fade(Lr.hall, tg.hall, 0.12);
    fade(Lr.building, tg.building, 0.4);
    fade(Lr.plant, tg.plant, 0.2, 0.25);
    fade(Lr.ground, tg.ground, 0.25);
    fade(Lr.map, tg.mapO, 0.35);
    fade(Lr.teaser, tg.teaser, 0.0, 0.5);
    fade(Lr.sparks, tg.wobble, 0.3, 0.25);
    // лампочка: «зажигание» с мерцанием
    this.ignite?.kill();
    this.ignite = null;
    if (tg.power !== k.power) {
      if (tg.power > k.power && dur > 0) {
        gsap.killTweensOf(k, 'power');
        this.ignite = this.tl()
          .to(k, { power: 0.55, duration: 0.12, ease: 'power2.out' })
          .to(k, { power: 0.15, duration: 0.08 })
          .to(k, { power: 0.8, duration: 0.1 })
          .to(k, { power: 0.4, duration: 0.07 })
          .to(k, { power: 1, duration: 0.5, ease: 'power2.out' });
      } else T(k, { power: tg.power }, 0.5);
    }
    // 35 лампочек загораются волной
    T(k, { minis: tg.minis ? 1.12 : 0 }, tg.minis ? 1.5 : 0.4, tg.minis ? dur * 0.35 : 0, 'power1.inOut');
    // видеокарта уезжает в слот стойки
    const gp = tg.slot ? GPU_SLOT : GPU_SHOW;
    T(k, { gpuX: gp.x, gpuY: gp.y, gpuZ: gp.z, gpuR: tg.slot ? 0 : GPU_TURN }, Math.max(0.5, dur * 0.55), tg.slot && dir > 0 ? dur * 0.12 : 0, 'power2.inOut');
    // «витрина»: на шаге 1 карта медленно покачивается (видны рёбра радиатора), к слоту — замирает
    T(k, { sway: tg.gpu && !tg.slot ? 1 : 0 }, tg.gpu && !tg.slot ? 1.6 : 0.5);
    // стойки поднимаются волной
    T(k, { reveal: tg.reveal }, Math.max(0.4, dur * (dir > 0 ? 0.75 : 0.6)), dir > 0 ? dur * 0.2 : 0, dir > 0 ? 'power1.out' : 'power1.in');
    // градирни вырастают, пар
    T(k, { rise: tg.rise }, tg.rise ? 2.2 : 0.6, tg.rise && dir > 0 ? dur * 0.35 : 0, tg.rise ? 'power2.out' : 'power2.in');
    T(k, { site: tg.site }, Math.max(0.4, dur * 0.5), tg.site ? dur * 0.2 : 0);
    T(k, { map: tg.map }, Math.max(0.4, dur * 0.6), tg.map ? dur * 0.3 : 0);
    // волна по карте (с ней набирается счётчик «47 000 000» — карточка шага появляется к её старту, см. b2a.js)
    if (tg.wave && dur > 0) {
      gsap.killTweensOf(k, 'wave');
      k.wave = 0;
      this.tw(k, { wave: 1, duration: 3.4, delay: Math.min(1.0, dur * 0.3), ease: 'power1.inOut' });
    } else T(k, { wave: tg.wave }, 0.4);
    T(k, { teaser: tg.teaserRise }, tg.teaserRise ? 2.6 : 0.8, 0, tg.teaserRise ? 'power2.out' : 'power2.in');
    T(k, { wobble: tg.wobble }, 1.4);
  }

  // ------------------------------------------------------------------ подписи
  makeLabels() {
    this.removeLabels();
    const tag = (t, cls = '') => `<span class="b2a-tag ${cls}">${t}</span>`;
    this.lb = {
      w20: this.label({ html: tag('≈ 20 Вт', 'is-big is-warm'), object: this.A.w20, anchor: 'top', visible: false }),
      bulb: this.label({ html: tag('мозг · 20 Вт', 'is-warm'), object: this.A.bulb, anchor: 'top', visible: false }),
      gpu: this.label({ html: tag('видеокарта · до 700 Вт'), object: this.A.gpu, anchor: 'top', visible: false }),
      one: this.label({ html: tag('1 мозг', 'is-warm'), object: this.A.one, anchor: 'top', visible: false }),
      eq: this.label({ html: '<span class="b2a-eq">=</span>', object: this.A.eq, visible: false }),
      grid: this.label({ html: tag('35 мозгов', 'is-warm'), object: this.A.grid, anchor: 'top', visible: false }),
      dot: this.label({ html: tag('мозг — вот он', 'is-warm is-arrow'), object: this.A.dot, anchor: 'right', visible: false }),
      dc: this.label({ html: tag('Colossus 2 · ~946 МВт', 'is-big'), object: this.A.dc, anchor: 'bottom-left', visible: false }),
      npp: this.label({ html: tag('АЭС · ~1 ГВт', 'is-big'), object: this.A.npp, anchor: 'bottom', visible: false }),
      dcMap: this.label({ html: tag('Colossus 2', 'is-big'), object: this.A.dcMap, anchor: 'bottom', offset: [0, 70000, 0], visible: false }),
    };
  }

  showLabels(state, step, delay = 0) {
    if (!this.lb) return;
    const want = new Set();
    if (state === 'intro') { if (step >= 1) want.add('w20'); }
    else {
      if (step === 1) { want.add('bulb'); want.add('gpu'); }
      if (step === 2) { want.add('one'); want.add('eq'); want.add('grid'); }
      if (step === 3) want.add('dot');
      if (step === 5) { want.add('dc'); want.add('npp'); }
      if (step === 6) want.add('dcMap');
    }
    this._labelTimer?.kill();
    for (const [name, l] of Object.entries(this.lb)) if (!want.has(name)) l.hide();
    const show = () => { for (const name of want) this.lb[name]?.show(); };
    if (delay > 0) this._labelTimer = this.delay(delay, show); else show();
  }

  exit(o = {}) {
    this.showLabels('none', -1);
    this.ctx.engine.setFx({ warp: 0 }, 0.4);
    return super.exit(o).then(() => { if (!this.active) this.removeLabels(); });
  }

  setOpacity(v) {
    this.opacity = v;
    this.root.visible = v > 0.001 || this.active;
  }

  dispose() {
    this._disposed = true;   // выгрузка по LRU: фоновый досчёт форм больше не нужен
    this.cache?.clear();
    super.dispose();
  }

  // ------------------------------------------------------------------ кадр
  update(dt, t) {
    this.applyView();
    const k = this.k;
    const op = this.opacity;
    for (const L of this.layerList) applyLayer(L, op);
    const ps = projScale(this.ctx.engine, this.ctx.camera);
    const Sx = this.S;

    // лампочка: живое мерцание нити
    const fl = (Math.sin(t * 11.7) * 0.6 + Math.sin(t * 23.1 + 1.3) * 0.4) * 0.025;
    this.bulb.setPower(k.power, fl);
    // мини-лампочки
    this.miniGlass.material.uniforms.uIgnite.value = k.minis;
    this.miniGlass.material.uniforms.uGlow.value = 0.6;
    const mu = this.miniFil.material.uniforms;
    mu.uProgress.value = k.minis; mu.uWorld.value = Sx; mu.uScale.value = ps; mu.uTime.value = t;
    // видеокарта
    this.gpu.group.position.set(k.gpuX, k.gpuY, k.gpuZ);
    this.gpu.group.rotation.y = k.gpuR + k.sway * 0.16 * Math.sin(t * 0.7);
    this.gpu.group.rotation.x = k.sway * 0.05 * Math.sin(t * 0.5 + 1.1);
    this.gpu.stripMat.color.setRGB(0, 1, 0).multiplyScalar(1.6 + 0.8 * Math.sin(t * 2.2));
    // стойка-герой
    const lu = this.rackLeds.material.uniforms;
    lu.uWorld.value = Sx; lu.uScale.value = ps; lu.uTime.value = t;
    // зал
    this.rackMat.uniforms.uTime.value = t;
    this.rackMat.uniforms.uReveal.value = k.reveal;
    const fu = this.floor.material.uniforms;
    fu.uReveal.value = k.reveal; fu.uTime.value = t;
    // АЭС
    this.plant.group.scale.y = Math.max(0.001, k.rise);
    const su = this.steam.material.uniforms;
    su.uTime.value = t; su.uScale.value = ps; su.uWorld.value = Sx; su.uRise.value = k.rise;
    su.uTheme.value = 1 - 0.6 * this.ctx.engine.fx.invert;   // в светлой теме пар не должен выглядеть чёрным дымом
    // земля и карта
    const gu = this.ground.material.uniforms;
    gu.uSite.value = k.site; gu.uMap.value = k.map; gu.uTime.value = t; gu.uWave.value = k.wave * this.waveMax;
    const cu = this.citySparks.material.uniforms;
    cu.uWorld.value = Sx; cu.uScale.value = ps; cu.uTime.value = t; cu.uProgress.value = k.wave;
    const bu = this.beacon.material.uniforms;
    bu.uWorld.value = Sx; bu.uScale.value = ps; bu.uTime.value = t;
    this.roads.material.uniforms.uProgress.value = k.wave;
    // счётчик «47 000 000» идёт вместе с волной по карте (вне шага 6 карточка скрыта — значение не трогаем,
    // чтобы при шаге назад в гаснущей карточке не мелькал «0»)
    if (this.countEl && this.state === 'scale' && this.step >= 6) {
      const v = Math.round(47e6 * clamp(k.wave / this.waveDone, 0, 1));
      if (v !== this._countV) { this._countV = v; this.countEl.textContent = formatNumber(v); }
    }
    // тизер
    this.teaserMat.uniforms.uTime.value = t;
    this.teaserMat.uniforms.uReveal.value = k.teaser * 1.12;

    // частицы: в «интро» мозг мягко пульсирует и покачивается
    if (this.ownsParticles()) {
      const obj = this.particles.object;
      const a = 1 - Math.exp(-dt * 3);
      const w = k.wobble;
      const ry = w * Math.sin(t * 0.33) * 0.2;
      const sc = 1 + w * (0.022 * Math.sin(t * 2.3) + 0.01 * Math.sin(t * 4.6 + 0.8));
      obj.rotation.y += (ry - obj.rotation.y) * a;
      obj.scale.setScalar(obj.scale.x + (sc - obj.scale.x) * a);
      // вспышки повторяют движение мозга
      this.gSparks.position.copy(obj.position);
      this.gSparks.rotation.copy(obj.rotation);
      this.gSparks.scale.copy(obj.scale);
    }
    if (this.gSparks.visible) {
      const su2 = this.brainSparks.material.uniforms;
      su2.uTime.value = t; su2.uScale.value = ps; su2.uWorld.value = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Города и дороги
// ---------------------------------------------------------------------------
function genCities(seed = 21) {
  const r = rng(seed);
  const pts = [];
  let guard = 0, minD = 84e3;
  while (pts.length < CITY_COUNT && guard++ < 200000) {
    if (guard % 40000 === 0) minD *= 0.92;
    const x = r.range(-1, 1) * 980e3, z = r.range(-1, 1) * 610e3;
    if ((x / 980e3) ** 2 + (z / 610e3) ** 2 > 1) continue;
    if (Math.hypot(x, z) < 90e3) continue;
    if (pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < minD)) continue;
    pts.push([x, z]);
  }
  return pts;
}

function cityShape(m, cities) {
  const P = S.PAL;
  const sh = S.createShape(m), r = rng(61);
  const per = m / cities.length;
  for (let i = 0; i < m; i++) {
    const ci = Math.min(cities.length - 1, Math.floor(i / per));
    const [cx, cz] = cities[ci];
    const t = r();
    let x, z, col, a, size;
    if (t < 0.46) {
      x = cx + r.gauss(0, 7000); z = cz + r.gauss(0, 7000);
      col = r() < 0.1 ? P.greenHi : r() < 0.7 ? P.white : P.mint; a = r.range(0.3, 0.6); size = r.range(0.6, 1.3);
    } else if (t < 0.8) {
      const road = Math.floor(r() * 7);
      const ang = (road / 7) * Math.PI * 2 + ci * 1.7;
      const len = Math.pow(r(), 0.7) * (19000 + (ci % 5) * 4000);
      x = cx + Math.cos(ang) * len + r.gauss(0, 650); z = cz + Math.sin(ang) * len + r.gauss(0, 650);
      col = r() < 0.6 ? P.mint : P.white; a = r.range(0.2, 0.42); size = r.range(0.45, 0.9);
    } else {
      x = cx + r.gauss(0, 15000); z = cz + r.gauss(0, 15000);
      col = P.white; a = r.range(0.08, 0.22); size = r.range(0.35, 0.75);
    }
    S.setPoint(sh, i, x, 0, z, size, col, a);
  }
  return sh;
}

const ROAD_VERT = /* glsl */ `
attribute float aD;
uniform float uProgress;
varying float vA;
void main() {
  vA = clamp((uProgress - aD) / 0.1, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ROAD_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vA;
void main() { gl_FragColor = vec4(0.1, 0.9, 0.2, 0.32 * vA * uOpacity); }
`;

function buildRoads(cities, maxD) {
  const pos = [], dd = [];
  const seen = new Set();
  cities.forEach((a, i) => {
    const near = cities.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1])]).filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]).slice(0, 2);
    near.forEach(([j]) => {
      const key = i < j ? i + '-' + j : j + '-' + i;
      if (seen.has(key)) return;
      seen.add(key);
      const b = cities[j];
      pos.push(a[0], 300, a[1], b[0], 300, b[1]);
      dd.push(Math.hypot(a[0], a[1]) / maxD, Math.hypot(b[0], b[1]) / maxD);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aD', new THREE.Float32BufferAttribute(dd, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uProgress: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: ROAD_VERT,
    fragmentShader: ROAD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const l = new THREE.LineSegments(g, m);
  l.frustumCulled = false;
  return l;
}
