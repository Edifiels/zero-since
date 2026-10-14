// «Гонка данных» (блок 2):
//   'intro' — вопрос №4: справа бесконечная лента строк текста из частиц, свёрнутая в воронку-спираль,
//             из глубины к зрителю летят слова.
//   'race'  — шаг 0: две полосы в ЛИНЕЙНОЙ шкале: ребёнок к 13 годам (< 100 млн слов — полоса-«пиксель»)
//             и пустая дорожка языковой модели (десятки триллионов);
//             шаг 1: полоса модели срывается за край экрана — камера мчится вдоль неё (варп), растут счётчики
//             слов и «лет чтения» до «сотен тысяч»;
//             шаг 2: отъезд — видна вся полоса модели, а полоса ребёнка — точка (соотношение ~1 : 300 000).
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, lerp, formatNumber } from '../../core/utils.js';
import { textSprite } from '../../core/text.js';
import { glowTexture, makeLayer, applyLayer, makeSparks, projScale } from './kit.js';

const D = 14, FOV = 40;
const VIS_H = 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
// Сцена 16:9 на расстоянии D: на экранах уже 16:9 ядро само расширяет угол обзора (director.fitPose),
// поэтому раскладка шкалы всегда считается для 16:9 и совпадает с HTML-колонками.
const STAGE = { w: VIS_H * 16 / 9, h: VIS_H };

// --- Шкала: 1 единица = 100 млн слов (полоса ребёнка). Модель — десятки триллионов ≈ 300 000 единиц.
const U_WORDS = 1e8;
const MODEL_U = 300000;
const BAR_X0 = -0.37 * STAGE.w;                // начало полосы модели в итоговом кадре (шаг 2)
const K2 = (0.74 * STAGE.w) / MODEL_U;         // масштаб итогового кадра: вся полоса модели — на ¾ ширины
const WORDS_X0 = 0.3, WORDS_X1 = 0.5;          // слова интро гаснут левее этой полосы экрана (NDC x) — там текст вопроса
const WORDS_PER_YEAR = 250 * 60 * 8 * 365;   // 250 слов в минуту, 8 часов в день
const ROW = { child: -0.25, model: -2.45 };  // высоты полос (экранные единицы)
const BAR_H = 0.5;
const TICKS = [[10, '1 млрд'], [100, '10 млрд'], [1000, '100 млрд'], [10000, '1 трлн'], [100000, '10 трлн']];

const TILT = -0.4;   // ось воронки уходит вправо-вдаль (точка схода — справа, а не за текстом)
const WORDS = ['слово', 'мама', 'космос', 'кошка', 'почему', 'ракета', 'нейрон', 'звезда', 'привет', 'книга', 'мечта', 'Земля', 'разум', 'свет', 'время', 'вопрос', 'смысл', 'ответ'];

// ---------- Полоса-«луч»: строки текста бегут вдоль полосы (узор привязан к словам, а не к экрану) ----------
const BAR_VERT = /* glsl */ `
uniform float uLenU, uH;
varying float vU;
varying vec3 vP;
varying vec3 vN;
void main() {
  vU = position.x * uLenU;
  vP = vec3(position.x, position.y / uH, position.z / uH);
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime, uPeriod, uGlow;
varying float vU;
varying vec3 vP;
varying vec3 vN;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  // 4 «строки» по высоте полосы, в каждой — слова-штрихи разной длины
  float rowsF = (vP.y + 0.5) * 4.0;
  float row = floor(rowsF);
  float fy = fract(rowsF);
  float x = vU / uPeriod + row * 3.17;
  float cell = floor(x);
  float fx = fract(x);
  float len = 0.35 + 0.55 * h1(cell + row * 17.0);
  float dash = step(fx, len) * smoothstep(0.18, 0.32, fy) * smoothstep(0.82, 0.68, fy);
  // на большом удалении узор усредняется (без муара)
  float aa = clamp(fwidth(x) * 1.2, 0.0, 1.0);
  dash = mix(dash, 0.32, aa);
  float edge = smoothstep(0.38, 0.5, abs(vP.y)) + smoothstep(0.38, 0.5, abs(vP.z));
  float side = abs(vN.z) > 0.5 ? 1.0 : 0.65;
  vec3 col = uColor * (0.18 + 0.85 * dash + 0.55 * edge) * side * uGlow;
  gl_FragColor = vec4(col, uOpacity);
}
`;

// ---------- Пунктир дорожки (в экранных пикселях — виден при любом масштабе) ----------
const DASH_VERT = /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime, uFlow;
void main() {
  // пунктир «течёт» вправо — туда, куда улетит полоса модели
  if (mod(gl_FragCoord.x + gl_FragCoord.y * 0.3 - uTime * uFlow, 22.0) > 12.0) discard;
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

export default class Data extends Visual {
  static transition = 'morph';

  async init() {
    this.n = this.ctx.particles.count;
    this.cache = new Map();
    this.glowTex = glowTexture();
    // анимируемые величины
    this.k = { tipU: 0, pull: 0, wobble: 1, stream: 0, gateZ: 0.02 };
    this.view = { A: -6.6, C: 0, k: 0.045 };
    this.streamPhase = 0;
    this.lastTip = 0;
    this._v = new THREE.Vector3();
    this._wordsKey = -1;
    this._yearsKey = -1;

    // ===== Интро: летящие слова
    this.gWords = new THREE.Group();
    this.gWords.rotation.y = TILT;
    this.root.add(this.gWords);
    const r = rng(77);
    this.words = WORDS.map((w, i) => {
      const green = i % 4 === 1;
      const sp = textSprite(w, { height: 0.78, font: '700 110px Unbounded', color: green ? '#7dff6e' : '#f4fff4', padding: 18, glow: true });
      sp.material.depthWrite = false;
      sp.userData = { u: i / WORDS.length, phi: r() * Math.PI * 2, speed: 0.045 + r() * 0.02 };
      this.gWords.add(sp);
      return sp;
    });

    // ===== Гонка: полосы, дорожки, отметки
    this.gChart = new THREE.Group();
    this.root.add(this.gChart);
    const barGeo = new THREE.BoxGeometry(1, BAR_H, BAR_H).translate(0.5, 0, 0);
    const barMat = (color) => new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uLenU: { value: 1 }, uH: { value: BAR_H }, uPeriod: { value: 7 }, uGlow: { value: 1 } },
      vertexShader: BAR_VERT,
      fragmentShader: BAR_FRAG,
      transparent: true,
    });
    this.modelBar = new THREE.Mesh(barGeo, barMat('#2dff3a'));
    this.childBar = new THREE.Mesh(barGeo, barMat('#ffe7c4'));
    this.modelBar.position.y = ROW.model;
    this.childBar.position.y = ROW.child;
    this.gChart.add(this.modelBar, this.childBar);

    // дорожки (пунктирные контуры)
    const dashMat = (op, flow = 0) => new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0.55, 0.75, 0.6) }, uOpacity: { value: op }, uTime: { value: 0 }, uFlow: { value: flow } }, vertexShader: DASH_VERT, fragmentShader: DASH_FRAG, transparent: true, depthWrite: false });
    const trackGeo = new THREE.BufferGeometry();
    const hh = BAR_H / 2 + 0.08;
    trackGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, hh, 0, 1, hh, 0, 0, -hh, 0, 1, -hh, 0, 0, -hh, 0, 0, hh, 0], 3));
    this.modelTrack = new THREE.LineSegments(trackGeo, dashMat(0.8, 60));
    this.modelTrack.position.y = ROW.model;
    this.modelTrack.frustumCulled = false;
    this.childTrack = new THREE.LineSegments(trackGeo, dashMat(0.5));
    this.childTrack.position.y = ROW.child;
    this.childTrack.frustumCulled = false;
    // ось начала
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, ROW.child + 0.75, 0, 0, ROW.model - 0.75, 0], 3));
    this.axis = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.8, 1, 0.8), transparent: true, opacity: 0.6 }));
    this.axis.frustumCulled = false;
    this.gChart.add(this.modelTrack, this.childTrack, this.axis);

    // «ворота»-отметки на дорожке модели
    const gateGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.5, 1.5).rotateY(Math.PI / 2));
    this.gates = TICKS.map(([u]) => {
      const g = new THREE.LineSegments(gateGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.position.y = ROW.model;
      g.userData.u = u;
      g.frustumCulled = false;
      this.gChart.add(g);
      return g;
    });
    // свечение конца полосы модели и маркер «пикселя» ребёнка
    this.tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(0.7, 2.2, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.tip.scale.setScalar(1.6);
    this.tip.position.y = ROW.model;
    this.childMark = makeSparks([{ p: [0, 0, 0], size: 0.16, color: [2.2, 1.9, 1.4] }], { twinkle: 0.0, minPx: 5, maxPx: 40 });
    this.childMark.position.y = ROW.child;
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.0), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 64), this.ringMat);
    this.ring.position.y = ROW.child;
    this.gChart.add(this.tip, this.childMark, this.ring);

    // якоря подписей
    const anchor = () => { const o = new THREE.Object3D(); this.gChart.add(o); return o; };
    this.A = { child: anchor(), model: anchor(), childDot: anchor(), modelEnd: anchor(), edge: anchor(), ticks: TICKS.map(() => anchor()) };

    // слои
    this.L = { words: makeLayer(this.gWords, 0), chart: makeLayer(this.gChart, 0) };
    this.layerList = Object.values(this.L);
    this.layerList.forEach((l) => applyLayer(l, 0));

    this.shape('intro');
  }

  // ------------------------------------------------------------------ формы частиц
  shape(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const n = this.n;
    const P = S.PAL;
    let s;
    if (key === 'intro') {
      s = S.combine(n, [
        { weight: 0.86, shape: (m) => vortexShape(m) },
        { weight: 0.14, shape: (m) => { const d = S.dust(m, { radius: 30, inner: 4, alpha: 0.22, size: 0.6, seed: 71 }); return d; } },
      ]);
      S.equalize(s, { target: 7 });
    } else if (key === 'race0') {
      s = S.combine(n, [
        { weight: 0.75, shape: (m) => textCloud(m, { x0: -30, x1: 30, y0: -14, y1: 14, z0: -70, z1: -24, seed: 81, alpha: 0.16 }) },
        { weight: 0.25, shape: (m) => S.dust(m, { radius: 40, inner: 10, alpha: 0.18, size: 0.6, seed: 82 }) },
      ]);
      S.equalize(s, { target: 7 });
    } else if (key === 'race1') {
      s = tunnelShape(n);
      S.equalize(s, { target: 9 });
    } else if (key === 'race2') {
      const xa = BAR_X0, xb = BAR_X0 + MODEL_U * K2;
      s = S.combine(n, [
        { weight: 0.55, shape: (m) => {
          const sh = S.createShape(m), r = rng(91);
          for (let i = 0; i < m; i++) {
            const t = r();
            const x = lerp(xa, xb, Math.pow(t, 0.9));
            S.setPoint(sh, i, x, ROW.model + r.gauss(0, 0.32 + 0.25 * t), r.gauss(0, 0.6), r.range(0.4, 1.0), r() < 0.25 ? P.greenHi : r() < 0.6 ? P.mint : P.white, r.range(0.08, 0.3));
          }
          return sh;
        } },
        { weight: 0.45, shape: (m) => textCloud(m, { x0: -30, x1: 30, y0: -14, y1: 14, z0: -70, z1: -24, seed: 92, alpha: 0.12 }) },
      ]);
      S.equalize(s, { target: 7 });
    } else s = S.dust(n);
    this.cache.set(key, s);
    return s;
  }

  // ------------------------------------------------------------------ раскладка шкалы
  stage() { return STAGE; }
  x0() { return -0.36 * STAGE.w; }                          // начало полос
  xHold() { return 1.2; }                                   // где держится конец полосы во время гонки
  k0() { return (4 * VIS_H / 900); }                         // 1 единица (100 млн слов) ≈ 4 пикселя при 900 px по высоте
  k2() { return K2; }                                        // вся полоса модели — на ¾ ширины

  /** Положение по шкале → экранная X. */
  xOf(u) { return this.view.A + (u - this.view.C) * this.view.k; }

  computeView() {
    const k = this.k;
    const k0 = this.k0(), k2 = K2, X0 = this.x0(), xh = this.xHold();
    const C0 = Math.max(0, k.tipU - (xh - X0) / k0);
    const p = clamp(k.pull, 0, 1);
    if (p <= 0) { this.view.A = X0; this.view.C = C0; this.view.k = k0; return; }
    const lk = Math.log(k0) + (Math.log(k2) - Math.log(k0)) * p;
    const kk = Math.exp(lk);
    const g = (1 / kk - 1 / k0) / (1 / k2 - 1 / k0);
    this.view.k = kk;
    this.view.C = C0 + (0 - C0) * g;
    this.view.A = X0 + (BAR_X0 - X0) * g;
  }

  // ------------------------------------------------------------------ камера
  poseIntro() {
    const st = STAGE;
    const T = [-0.27 * st.w, 0.02 * st.h, 0];
    return { pos: [T[0] + 1.2, T[1] + 0.6, D], target: T, fov: FOV };
  }

  camera(state, step) {
    let pose;
    if (state === 'race') {
      if (step === 1) {
        const xh = this.xHold();
        pose = { pos: [xh - 8.5, ROW.model + 1.7, 3.6], target: [xh + 9, ROW.model - 0.2, -0.6], fov: 52 };
      } else if (step >= 2) pose = { pos: [0, 0.9, 15], target: [0, -0.4, 0], fov: FOV };
      else pose = { pos: [0, 0, D], target: [0, 0, 0], fov: FOV };
    } else pose = this.poseIntro();
    return { ...pose, duration: this._dur ?? 1.6, arc: 0.06 };
  }

  background(state, step) {
    if (state === 'race') return step === 1 ? 'none' : step >= 2 ? 'corner' : 'low';
    return 'corner';
  }

  // ------------------------------------------------------------------ жизненный цикл
  bindEl(el) {
    if (!el || el === this.el) return;
    this.el = el;
    this.wordsEl = el.querySelector('[data-b2a-words]');
    this.yearsEl = el.querySelector('[data-b2a-years]');
    this.yearsUnitEl = el.querySelector('[data-b2a-years-unit]');
    this._wordsKey = this._yearsKey = -1;
  }

  enter(o = {}) {
    const state = o.state || 'intro', step = o.step ?? 0;
    this.state = state;
    this.step = step;
    this.bindEl(o.el);
    this._dur = o.instant ? 0 : (o.duration ?? 1.6);
    this.claimParticles();
    const p = this.particles;
    const key = this.pKey(state, step);
    p.setParams(this.params(key), o.instant ? 0 : 1);
    if (o.instant) p.snap(this.shape(key)); else p.morph(this.shape(key), { duration: 2.0, stagger: 0.5, burst: 10 });
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.4, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, duration: o.instant ? 0 : 1.4, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.4, ease: 'power2.inOut' });
    this.apply(state, step, 0, null, null);
    this.makeLabels();
    this.showLabels(state, step, o.instant ? 0 : 0.9);
    if (!this._warm) {
      // формы следующих шагов — после перехода входа, по одной в свободное время между кадрами
      this._warm = true;
      const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 0));
      ['race0', 'race1', 'race2', 'intro'].forEach((key, i) => setTimeout(() => idle(() => { if (!this._disposed && !this.cache.has(key)) this.shape(key); }), 2200 + i * 180));
    }
    return super.enter(o);
  }

  pKey(state, step) { return state === 'race' ? 'race' + clamp(step | 0, 0, 2) : 'intro'; }
  params(key) {
    if (key === 'intro') return { noise: 0.18, size: 0.052, twinkle: 0.4, swirl: 0, spring: 16, damping: 5.5 };
    if (key === 'race1') return { noise: 0.05, size: 0.06, twinkle: 0.2, swirl: 0, spring: 16, damping: 5.5 };
    return { noise: 0.2, size: 0.05, twinkle: 0.35, swirl: 0, spring: 16, damping: 5.5 };
  }

  setState(state, o = {}) { this.go(state, o.step ?? 0, o); }
  setStep(step, o = {}) { this.go(this.state, step, o); }

  go(state, step, o = {}) {
    this.bindEl(o.el);
    const fromState = this.state, fromStep = this.step;
    if (fromState === state && fromStep === step) return;
    this.state = state;
    this.step = step;
    const instant = !!o.instant;
    let dur = 1.6;
    if (state === 'race' && fromState === 'race') dur = step === 2 && fromStep < 2 ? 3.2 : step === 1 && fromStep === 0 ? 1.9 : 1.8;
    else if (state !== fromState) dur = 2.2;
    this._dur = instant ? 0 : dur;
    this.apply(state, step, instant ? 0 : dur, fromState, fromStep);
    const key = this.pKey(state, step), prev = this.pKey(fromState, fromStep);
    const p = this.particles;
    this.claimParticles();
    p.setParams(this.params(key), instant ? 0 : 1.2);
    if (key !== prev) {
      if (instant) p.snap(this.shape(key));
      else p.morph(this.shape(key), { duration: Math.max(1.4, dur * 0.8), stagger: 0.45, burst: key === 'race1' ? 4 : 10 });
    }
    this.showLabels(state, step, instant ? 0 : (state === 'race' && step === 2 ? dur * 0.75 : 0.9));
  }

  apply(state, step, dur, fromState, fromStep) {
    const k = this.k;
    const T = (vars, d, delay = 0, ease = 'power2.inOut') => {
      gsap.killTweensOf(k, Object.keys(vars).join(','));
      if (dur <= 0) { Object.assign(k, vars); return; }
      this.tw(k, { ...vars, duration: d, delay, ease });
    };
    const fade = (L, v, d = 0.8, delay = 0) => {
      gsap.killTweensOf(L);
      if (dur <= 0) { L.o = v; return; }
      this.tw(L, { o: v, duration: d, delay, ease: 'power1.inOut' });
    };
    const race = state === 'race';
    fade(this.L.words, race ? 0 : 1, race ? 0.7 : 1.2, race ? 0 : 0.5);
    fade(this.L.chart, race ? 1 : 0, race ? 1.0 : 0.6, race ? 0.5 : 0);
    T({ wobble: race ? 0 : 1 }, 1.4);
    T({ gateZ: race && step === 1 ? 1 : 0.02 }, race && step === 1 ? 1.2 : 0.6);
    this.stopRace();
    if (!race) { T({ tipU: 0, pull: 0, stream: 0 }, 0.8); return; }
    if (step === 0) {
      T({ tipU: 0, pull: 0, stream: 0 }, Math.min(1.2, dur || 1));
    } else if (step === 1) {
      this.streamPhase = 0;   // поток строк начинается с нуля — облако частиц не «прыгает» по X
      if (fromStep === 0 && dur > 0 && fromState === 'race') this.startRace();
      else T({ tipU: MODEL_U, pull: 0, stream: 0 }, dur || 1);
    } else {
      if (!(k.tipU >= MODEL_U * 0.999)) T({ tipU: MODEL_U }, Math.min(1, dur || 1));
      T({ pull: 1, stream: 0 }, dur || 1, 0, 'power3.inOut');
      if (dur > 0) this.ctx.engine.pulse({ aberration: 0.8 }, dur * 0.7);
    }
  }

  /** Гонка: длина полосы растёт в логарифмическом времени (всё быстрее), в конце — торможение. */
  startRace() {
    const k = this.k, e = this.ctx.engine;
    k.pull = 0;
    const st = { t: 0 };
    const l0 = Math.log10(Math.max(0.6, k.tipU || 0.6)), l1 = Math.log10(MODEL_U);
    const calls = [];
    calls.push(this.tw(st, {
      t: 1, duration: 6.4, ease: 'none',
      onUpdate: () => {
        // основание степени зажато в [0, 1]: при t = 1 (1 − 0.18) / 0.82 чуть больше 1 → pow(−ε, 2.2) = NaN
        const rest = clamp(1 - (st.t - 0.18) / 0.82, 0, 1);
        const q = st.t < 0.18 ? (st.t / 0.18) ** 2 * 0.08 : 0.08 + 0.92 * (1 - Math.pow(rest, 2.2));
        k.tipU = Math.min(MODEL_U, Math.pow(10, lerp(l0, l1, q)));
      },
      onComplete: () => this.flash(),
    }));
    // варп-разгон, торможение, поток строк навстречу (warp > 0.5 заливает кадр серой дымкой полос и свечения)
    calls.push(this.delay(1.0, () => e.setFx({ warp: 0.5, aberration: 0.8 }, 1.6)));
    calls.push(this.delay(5.3, () => e.setFx({ warp: 0, aberration: 0 }, 1.3)));
    calls.push(this.delay(1.2, () => this.ctx.background.surge(1.1, 3)));
    calls.push(this.tw(k, { stream: 1, duration: 1.2, delay: 0.8, ease: 'power2.in' }));
    calls.push(this.tw(k, { stream: 0, duration: 1.2, delay: 5.2, ease: 'power2.out' }));
    this.raceCalls = calls;
  }

  stopRace() {
    if (!this.raceCalls) return;
    this.raceCalls.forEach((c) => c.kill());
    this.raceCalls = null;
    this.ctx.engine.setFx({ warp: 0, aberration: 0 }, 0.5);
  }

  flash() {
    this.ctx.engine.pulse({ flash: 0.18 }, 0.6);
    this.ctx.rig.shake(0.12, 0.5);
  }

  // ------------------------------------------------------------------ подписи
  makeLabels() {
    this.removeLabels();
    this.lb = {
      child: this.label({ html: '<div class="b2a-blab is-warm"><b>Ребёнок к 13 годам</b><span>меньше 100 млн слов</span></div>', object: this.A.child, anchor: 'bottom-left', offset: [0, 0.42, 0], visible: false }),
      model: this.label({ html: '<div class="b2a-blab"><b>Языковая модель</b><span>десятки триллионов слов и их кусочков</span></div>', object: this.A.model, anchor: 'bottom-left', offset: [0, 0.46, 0], visible: false }),
      pixel: this.label({ html: '<span class="b2a-tag is-warm is-pointer">← вся полоса ребёнка</span>', object: this.A.childDot, anchor: 'left', offset: [0.62, 0, 0], visible: false }),
      dot: this.label({ html: '<span class="b2a-tag is-warm is-big">← полоса ребёнка — точка</span>', object: this.A.childDot, anchor: 'left', offset: [0.5, 0, 0], visible: false }),
      end: this.label({ html: '<span class="b2a-tag is-big">модель: десятки триллионов</span>', object: this.A.modelEnd, offset: [0, 0.55, 0], anchor: 'bottom-right', visible: false }),
      edge: this.label({ html: '<span class="b2a-tag is-pointer">дальше — за краем экрана →</span>', object: this.A.edge, offset: [0, -0.5, 0], anchor: 'top-right', visible: false }),
    };
    this.lbTicks = TICKS.map(([, t], i) => this.label({ html: `<span class="b2a-tick">${t}</span>`, object: this.A.ticks[i], anchor: 'top', offset: [0, -0.16, 0], visible: false }));
    this._tickVis = TICKS.map(() => false);
    this._ticksOn = false;
  }

  /** Подписи отметок: в гонке — только у ближних «ворот» (дальние сбиваются в кучу у точки схода). */
  updateTickLabels() {
    if (!this.lbTicks) return;
    const racing = this.k.gateZ > 0.5;
    const camX = this.ctx.camera.position.x;
    for (let i = 0; i < this.lbTicks.length; i++) {
      const d = this.gates[i].position.x - camX;
      const want = this._ticksOn && this.gates[i].visible && (!racing || (d > 1.5 && d < 40));
      if (want !== this._tickVis[i]) {
        this._tickVis[i] = want;
        if (want) this.lbTicks[i].show(); else this.lbTicks[i].hide();
      }
    }
  }

  showLabels(state, step, delay = 0) {
    if (!this.lb) return;
    const want = new Set();
    let ticks = false;
    if (state === 'race') {
      if (step === 0) { want.add('child'); want.add('model'); want.add('pixel'); want.add('edge'); ticks = true; }
      if (step === 1) ticks = true;
      if (step === 2) { want.add('dot'); want.add('end'); }
    }
    this._labelTimer?.kill();
    for (const [name, l] of Object.entries(this.lb)) if (!want.has(name)) l.hide();
    // подписи отметок включает/гасит updateTickLabels() по положению «ворот»
    if (!ticks) { this._ticksOn = false; this.updateTickLabels(); }
    const show = () => {
      for (const name of want) this.lb[name]?.show();
      if (ticks) this._ticksOn = true;
    };
    if (delay > 0) this._labelTimer = this.delay(delay, show); else show();
  }

  exit(o = {}) {
    this.showLabels('none', -1);
    this.stopRace();
    this.ctx.engine.setFx({ warp: 0, aberration: 0 }, 0.4);
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
    const k = this.k;
    // страховка: нечисловое значение шкалы «отравило» бы полосы, счётчики и положение облака частиц
    if (!Number.isFinite(k.tipU)) k.tipU = MODEL_U;
    if (!Number.isFinite(this.streamPhase)) this.streamPhase = 0;
    for (const L of this.layerList) applyLayer(L, this.opacity);

    // --- летящие слова (интро)
    if (this.L.words.group.visible) {
      const cx = 0, cy = 0;
      const cam = this.ctx.camera, mw = this.gWords.matrixWorld, v = this._v;
      for (const w of this.words) {
        const d = w.userData;
        d.u = (d.u + dt * d.speed) % 1;
        const u = d.u;
        const z = lerp(-110, 3, Math.pow(u, 1.6));
        const R = 2.1 + u * 1.9;
        const a = d.phi + u * 2.4 + t * 0.12;
        w.position.set(cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.8, z);
        const fadeIn = clamp(u / 0.12, 0, 1), fadeOut = clamp((1 - u) / 0.22, 0, 1);
        // над колонкой вопроса слова не летают: гаснут по мере приближения к ней (по экранной X)
        v.copy(w.position).applyMatrix4(mw).project(cam);
        const side = clamp((v.x - WORDS_X0) / (WORDS_X1 - WORDS_X0), 0, 1);
        w.material.opacity = fadeIn * fadeOut * side * side * this.L.words.o * this.opacity;
      }
    }

    // --- шкала гонки
    if (this.L.chart.group.visible) {
      this.computeView();
      const xm = this.xOf(0);
      const tipX = this.xOf(k.tipU);
      // полосы
      this.modelBar.position.x = xm;
      this.modelBar.scale.x = Math.max(1e-4, tipX - xm);
      this.modelBar.material.uniforms.uLenU.value = Math.max(1e-4, k.tipU);
      this.modelBar.visible = k.tipU > 0.02;
      const thin = 1 - 0.45 * clamp(k.pull, 0, 1);   // при отъезде полоса тоньше — читается как «луч»
      this.modelBar.scale.y = this.modelBar.scale.z = thin;
      this.childBar.position.x = xm;
      this.childBar.scale.x = Math.max(1e-4, this.view.k * 1);
      this.childBar.material.uniforms.uLenU.value = 1;
      // дорожки: модель — до своего конца (и за край экрана), ребёнок — до конца своей полосы
      const endX = this.xOf(MODEL_U);
      this.modelTrack.position.x = xm;
      this.modelTrack.scale.x = Math.max(1e-4, endX - xm);
      this.childTrack.position.x = xm;
      this.childTrack.scale.x = Math.max(0.6, this.view.k);
      this.childTrack.visible = k.pull < 0.05;
      this.axis.position.x = xm;
      // отметки: в покое — короткие штрихи у дорожки (не заходят на подпись модели), в гонке — «ворота»
      const gp = clamp((k.gateZ - 0.02) / 0.98, 0, 1);
      const gy = 0.5 + 0.5 * gp;
      for (let i = 0; i < this.gates.length; i++) {
        const g = this.gates[i];
        g.position.x = this.xOf(g.userData.u);
        g.scale.z = k.gateZ;
        g.scale.y = gy;
        g.visible = k.pull < 0.6;
        this.A.ticks[i].position.set(g.position.x, ROW.model - 0.75 * gy, 0);
      }
      this.updateTickLabels();
      // конец полосы и маркер ребёнка
      this.tip.position.x = tipX;
      this.tip.visible = k.tipU > 0.5;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      this.tip.material.color.setRGB(0.7, 2.2, 0.8).multiplyScalar(0.8 + 0.4 * pulse + k.stream * 0.8);
      this.childMark.position.x = xm + this.view.k * 0.5;
      const cu = this.childMark.material.uniforms;
      cu.uScale.value = projScale(this.ctx.engine, this.ctx.camera); cu.uWorld.value = 1; cu.uTime.value = t;
      this.ring.position.x = this.childMark.position.x;
      const rs = 1 + 0.18 * Math.sin(t * 3.0) - k.pull * 0.25;
      this.ring.scale.setScalar(rs);
      this.ringMat.opacity = (0.55 + 0.35 * pulse) * this.L.chart.o * this.opacity;
      this.ring.lookAt(this.ctx.camera.position);
      // якоря подписей
      this.A.child.position.set(xm, ROW.child, 0);
      this.A.model.position.set(xm, ROW.model, 0);
      this.A.childDot.position.set(this.childMark.position.x, ROW.child, 0);
      this.A.modelEnd.position.set(endX, ROW.model, 0);
      this.A.edge.position.set(0.45 * this.stage().w, ROW.model, 0);
      this.modelBar.material.uniforms.uTime.value = t;
      this.modelTrack.material.uniforms.uTime.value = t;
      // поток частиц-строк навстречу во время гонки
      const speed = this.lastTip ? (k.tipU - this.lastTip) * this.view.k / Math.max(dt, 1e-3) : 0;
      this.lastTip = k.tipU;
      this.streamPhase += Math.min(90, Math.max(0, speed)) * dt * k.stream + dt * 1.5 * k.stream;
      // счётчики (HUD виден только на шаге гонки — в гаснущем HUD цифры не крутим)
      if (this.state === 'race' && this.step === 1) this.updateCounters();
    }

    // --- частицы
    if (this.ownsParticles()) {
      const obj = this.particles.object;
      const a = 1 - Math.exp(-dt * 3);
      if (this.state === 'race' && this.step === 1) {
        obj.position.x = -(this.streamPhase % TUNNEL_P);
      } else {
        obj.position.x += (0 - obj.position.x) * a;
      }
      const w = k.wobble;
      obj.rotation.y += (TILT * w - obj.rotation.y) * a;
      obj.rotation.z += dt * 0.09 * w;
      if (w < 0.5) {
        // свести вращение к ближайшему «нулю», не раскручивая обороты назад
        const TAU = Math.PI * 2;
        obj.rotation.z = ((obj.rotation.z % TAU) + TAU + Math.PI) % TAU - Math.PI;
        obj.rotation.z += (0 - obj.rotation.z) * a;
      }
    }
  }

  updateCounters() {
    const k = this.k;
    // с 10 трлн слов (≈ 230 тыс. лет чтения) — итоговые формулировки сценария: «десятки триллионов», «сотни тысяч»
    const done = k.tipU >= 1e5;
    // строки собираем только при смене значения (без аллокаций в каждом кадре)
    if (this.wordsEl) {
      const words = k.tipU * U_WORDS;
      const key = done ? -2 : wordsKey(words);
      if (key !== this._wordsKey) { this._wordsKey = key; this.wordsEl.textContent = done ? 'десятки триллионов' : wordsText(words); }
    }
    if (this.yearsEl) {
      const y = Math.floor((k.tipU * U_WORDS) / WORDS_PER_YEAR);
      const key = done ? -2 : y;
      if (key !== this._yearsKey) {
        this._yearsKey = key;
        this.yearsEl.textContent = done ? 'сотни тысяч' : formatNumber(y);
        if (this.yearsUnitEl) this.yearsUnitEl.textContent = done ? 'лет' : yearsWord(y);
      }
    }
  }
}

/** «год / года / лет» по числу. */
function yearsWord(n) {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return 'лет';
  if (b === 1) return 'год';
  if (b >= 2 && b <= 4) return 'года';
  return 'лет';
}

function wordsText(w) {
  if (w < 1e9) return formatNumber(Math.round(w / 1e6)) + ' млн';
  if (w < 1e12) return formatNumber(w / 1e9, { decimals: w < 1e10 ? 1 : 0 }) + ' млрд';
  return formatNumber(w / 1e12, { decimals: w < 1e13 ? 1 : 0 }) + ' трлн';
}
/** Ключ отображаемого значения wordsText (меняется ровно тогда, когда меняется текст). */
function wordsKey(w) {
  if (w < 1e9) return Math.round(w / 1e6);
  if (w < 1e12) return 1e6 + Math.round(w / (w < 1e10 ? 1e8 : 1e9)) * (w < 1e10 ? 1 : 1000);
  return 1e9 + Math.round(w / (w < 1e13 ? 1e11 : 1e12)) * (w < 1e13 ? 1 : 1000);
}

// ---------------------------------------------------------------------------
// Формы: воронка из строк текста, облако «строк», тоннель для гонки
// ---------------------------------------------------------------------------
const TUNNEL_P = 36;

/** Лента-страница, свёрнутая в спираль, уходит вдаль (ось −Z). Строки — штрихи-слова. */
function vortexShape(m) {
  const P = S.PAL;
  const s = S.createShape(m), r = rng(73);
  const loops = 9, lines = 6, width = 1.75;
  // предварительно: список слов (штрихов) вдоль ленты
  const segs = [];
  let total = 0;
  for (let li = 0; li < lines; li++) {
    let p = r() * 0.4;
    while (p < 1) {
      const len = r.range(0.0035, 0.012);
      const accent = r() < 0.12;
      segs.push({ li, a: p, b: Math.min(1, p + len), accent });
      total += Math.min(1, p + len) - p;
      p += len + r.range(0.0012, 0.003);
    }
  }
  const pt = (sv, across, out) => {
    const th = sv * loops * Math.PI * 2;
    const z = 0.5 - Math.pow(sv, 2.0) * 150;
    const R = 3.6 * (1 - 0.17 * sv);
    out[0] = Math.cos(th) * R; out[1] = Math.sin(th) * R * 0.86; out[2] = z + across * width;
  };
  const tmp = [0, 0, 0];
  let i = 0;
  for (const sg of segs) {
    const cnt = Math.round(((sg.b - sg.a) / total) * m);
    for (let k = 0; k < cnt && i < m; k++, i++) {
      const sv = lerp(sg.a, sg.b, r());
      const across = (sg.li + 0.5) / lines - 0.5 + r.gauss(0, 0.012);
      pt(sv, across, tmp);
      const c = sg.accent ? P.greenHi : r() < 0.2 ? P.mint : P.white;
      S.setPoint(s, i, tmp[0], tmp[1], tmp[2], r.range(0.7, 1.3), c, (sg.accent ? 0.75 : 0.58) * r.range(0.65, 1));
    }
  }
  for (; i < m; i++) {
    pt(r(), r.range(-0.5, 0.5), tmp);
    S.setPoint(s, i, tmp[0], tmp[1], tmp[2], 0.5, P.white, 0.15);
  }
  return s;
}

/** Облако коротких «строк» в объёме (фон). */
function textCloud(m, { x0, x1, y0, y1, z0, z1, seed = 1, alpha = 0.2 }) {
  const P = S.PAL;
  const s = S.createShape(m), r = rng(seed);
  let i = 0;
  while (i < m) {
    const x = r.range(x0, x1), y = r.range(y0, y1), z = r.range(z0, z1);
    const words = r.int(2, 6);
    let px = x;
    const accent = r() < 0.1;
    for (let w = 0; w < words && i < m; w++) {
      const len = r.range(0.25, 0.9);
      const cnt = Math.max(2, Math.round(len * 18));
      for (let k = 0; k < cnt && i < m; k++, i++) {
        S.setPoint(s, i, px + (k / cnt) * len, y + r.gauss(0, 0.012), z, r.range(0.5, 0.9), accent ? P.greenHi : P.white, alpha * r.range(0.5, 1));
      }
      px += len + r.range(0.15, 0.3);
    }
  }
  return s;
}

/** Тоннель из строк вокруг полосы модели — повторяется с периодом TUNNEL_P по X (для бесшовного потока). */
function tunnelShape(n) {
  const P = S.PAL;
  const s = S.createShape(n), r = rng(95);
  const periods = 5, x0 = -40;
  const base = [];
  // один период: штрихи на «стенах» тоннеля
  const per = Math.floor(n / periods);
  let i = 0;
  while (i < per) {
    const ang = r() * Math.PI * 2;
    const rad = r.range(7.5, 13);
    const y = ROW.model + Math.sin(ang) * rad * 0.8, z = Math.cos(ang) * rad;
    const len = r.range(0.4, 2.6);
    const x = r() * TUNNEL_P;
    const cnt = Math.max(3, Math.round(len * 10));
    const accent = r() < 0.14;
    for (let k = 0; k < cnt && i < per; k++, i++) base.push([x + (k / cnt) * len, y, z, accent]);
  }
  for (let p = 0; p < periods; p++) {
    for (let j = 0; j < base.length; j++) {
      const idx = p * base.length + j;
      if (idx >= n) break;
      const b = base[j];
      let x = b[0] + x0 + p * TUNNEL_P;
      S.setPoint(s, idx, x, b[1], b[2], 0.8, b[3] ? P.greenHi : r() < 0.3 ? P.mint : P.white, b[3] ? 0.45 : 0.3);
    }
  }
  for (let idx = periods * base.length; idx < n; idx++) S.setPoint(s, idx, 0, ROW.model, -30, 0.5, P.white, 0);
  return s;
}
