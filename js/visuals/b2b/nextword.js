// «Угадай слово» / «Понимает ли модель?»
// Шаг 0: фраза «Поехали!» — сказал … — над пропуском растут столбики вероятностей кандидатов
//        (только относительная высота, без процентов); модель «думает» — столбики колеблются.
// Шаг 1: побеждает самый высокий — частицы столбика «Гагарин» стекают в пропуск и складываются в слово.
// Шаг 2: вопрос залу «Понимает ли она смысл?» — из частиц собирается огромный «?».
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { HALFTONE } from '../../core/glsl.js';
import { ready, FatLines, noFade, fittedPose, updateShared, sstep, bump, phase, SHARED, glowSprite } from './lib.js';

// кандидаты: слева направо — по возрастанию; самый высокий справа, над пропуском
const CANDS = [
  { w: 'пилот', h: 0.14 },
  { w: 'Королёв', h: 0.24 },
  { w: 'он', h: 0.36 },
  { w: 'космонавт', h: 0.52 },
  { w: 'Гагарин', h: 1.0 },
];
const BARS = { x0: -5.7, dx: 3.05, base: -0.15, maxH: 4.05, w: 1.95, d: 1.0 };
const WIN = CANDS.length - 1;

const BAR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const BAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uCell, uGlow, uH;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${HALFTONE}
void main() {
  // халфтон гуще к верху столбика, светлая кромка
  float top = smoothstep(0.0, 1.0, vUv.y);
  vec2 b = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.0, 0.06, min(b.x, b.y * max(1.0, uH)));
  float dotm = halftoneDot(gl_FragCoord.xy, uCell, 0.12 + 0.6 * top);
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  vec3 col = uColor * (0.35 * dotm + 0.6 * edge + 0.25 * f) * (1.0 + uGlow);
  float a = uOpacity * uFade * clamp(0.12 + 0.6 * dotm + 0.9 * edge, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export default class NextWord extends Visual {
  static transition = 'dissolve';

  async init() {
    this.fade = { value: 1 };
    this.ph = { grow: 0, win: 0, q: 0 };
    this.t0 = 0;
    this.bars = new THREE.Group();
    this.root.add(this.bars);
    this.barMeshes = CANDS.map((c, i) => {
      const geo = new THREE.BoxGeometry(BARS.w, 1, BARS.d);
      geo.translate(0, 0.5, 0);
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(i === WIN ? '#00ff00' : '#d8ffd2').multiplyScalar(i === WIN ? 1.2 : 0.75) },
          uOpacity: { value: 1 }, uFade: this.fade, uCell: SHARED.cell, uGlow: { value: 0 }, uH: { value: 1 },
        },
        vertexShader: BAR_VERT,
        fragmentShader: BAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(BARS.x0 + i * BARS.dx, BARS.base, 0);
      mesh.scale.y = 0.001;
      this.bars.add(mesh);
      return mesh;
    });
    // базовая линия
    this.baseLine = new FatLines(1, { width: 3, color: '#9dff8f', intensity: 0.9, fade: this.fade });
    this.baseLine.setEdge(0, [BARS.x0 - 1.4, BARS.base, 0.5], [BARS.x0 + WIN * BARS.dx + 1.4, BARS.base, 0.5]);
    this.baseLine.commit();
    this.root.add(this.baseLine.mesh);
    this.winGlow = glowSprite('#00ff00', 5, 0.8);
    this.root.add(this.winGlow);
    noFade(this.root);
    this.shapes = {};
    // формы частиц — заранее (кроме зависящих от положения пропуска в разметке)
    this.shapeFor(0);
    this.shapeFor(2);
    this.blank = null;
  }

  // ---------------------------------------------------------------------------
  space(r) {
    return (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) S.setPoint(s, i, r.range(-30, 30), r.range(-16, 16), -r.range(4, 34), r.range(0.4, 1.1), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.2));
      return s;
    };
  }

  barsShape(n) {
    const r = rng(13);
    const total = CANDS.reduce((a, c) => a + c.h, 0);
    const parts = CANDS.map((c, i) => ({
      weight: (0.5 * c.h) / total,
      shape: (m) => {
        const s = S.createShape(m);
        const x0 = BARS.x0 + i * BARS.dx;
        for (let k = 0; k < m; k++) {
          const y = BARS.base + Math.pow(r(), 0.8) * c.h * BARS.maxH;
          const cc = i === WIN ? (r() < 0.5 ? S.PAL.greenHi : S.PAL.mint) : r() < 0.25 ? S.PAL.green : S.PAL.white;
          S.setPoint(s, k, x0 + r.range(-0.5, 0.5) * BARS.w * 0.9, y, r.range(-0.5, 0.5) * BARS.d * 0.9, r.range(0.45, 0.95), cc, r.range(0.18, 0.42));
        }
        return s;
      },
    }));
    parts.push({ weight: 0.5, shape: this.space(r) });
    return S.combine(n, parts);
  }

  wordShape(n) {
    // частицы победившего столбика — в слово «Гагарин» в пропуске; остальные — в пыль
    const r = rng(1961);
    const b = this.blankWorld();
    const total = CANDS.reduce((a, c) => a + c.h, 0);
    const parts = CANDS.map((c, i) => ({
      weight: (0.5 * c.h) / total,
      shape: (m) => {
        if (i === WIN) {
          const s = S.fromText(m, 'Гагарин', { font: '800 180px Unbounded', width: b.w * 1.06, depth: 0.25, size: 0.85, alpha: 0.5, colorFn: (x, y, rr) => (rr() < 0.4 ? S.PAL.greenHi : S.PAL.mint), seed: 3 });
          return S.transform(s, { position: [b.x, b.y, 0.2] });
        }
        // проигравшие столбики осыпаются и уходят в глубину (а не оседают пылью вокруг фразы)
        const s = S.createShape(m);
        const x0 = BARS.x0 + i * BARS.dx;
        for (let k = 0; k < m; k++) S.setPoint(s, k, x0 + r.gauss(0, 1.1), BARS.base - r.range(0, 2.5), -r.range(3, 10), r.range(0.3, 0.8), S.PAL.white, r.range(0.03, 0.07));
        return s;
      },
    }));
    parts.push({ weight: 0.5, shape: this.space(r) });
    return S.combine(n, parts);
  }

  haloShape() {
    const key = 'halo:' + this.blankKey();
    if (!this.shapes[key]) this.shapes[key] = ready(this.buildHalo());
    return this.shapes[key];
  }

  buildHalo() {
    // мягкий ореол вокруг пропуска + пыль
    const n = this.ctx.particles.count;
    const r = rng(1962);
    const b = this.blankWorld();
    return S.combine(n, [
      { weight: 0.16, shape: (m) => {
        const s = S.createShape(m);
        for (let i = 0; i < m; i++) {
          const a = r() * Math.PI * 2, k = Math.sqrt(r());
          S.setPoint(s, i, b.x + Math.cos(a) * k * b.w * 0.62, b.y + Math.sin(a) * k * 0.62, r.range(-0.6, 0.2), r.range(0.4, 0.9), r() < 0.5 ? S.PAL.green : S.PAL.mint, r.range(0.05, 0.16));
        }
        return s;
      } },
      { weight: 0.84, shape: this.space(r) },
    ]);
  }

  questionShape(n) {
    const r = rng(7);
    // знак потоньше по глубине — читается чётче (толстый «?» в перспективе расплывается в облако)
    const q = S.fromText(Math.floor(n * 0.62), '?', { font: '800 520px Unbounded', width: 6.4, depth: 0.7, size: 1, alpha: 0.6, colorFn: (x, y, rr) => (rr() < 0.3 ? S.PAL.greenHi : rr() < 0.6 ? S.PAL.mint : S.PAL.white), seed: 9 });
    S.transform(q, { position: [5.2, 0.15, 0] });
    return S.combine(n, [
      { weight: 0.62, shape: (m) => q },
      { weight: 0.38, shape: this.space(r) },
    ]);
  }

  /** Ключ кеша для форм, зависящих от положения пропуска (меняется только при смене размера окна). */
  blankKey() {
    const b = this.blankWorld();
    return `${this.ctx.particles.count}:${b.x.toFixed(2)}:${b.y.toFixed(2)}:${b.w.toFixed(2)}`;
  }

  shapeFor(step) {
    const n = this.ctx.particles.count;
    if (step === 1) {
      const key = 'word:' + this.blankKey();
      if (!this.shapes[key]) this.shapes[key] = ready(this.wordShape(n));
      return this.shapes[key];
    }
    const key = step + ':' + n;
    if (!this.shapes[key]) this.shapes[key] = ready(step === 0 ? this.barsShape(n) : this.questionShape(n));
    return this.shapes[key];
  }

  /** Положение пропуска в мире (по разметке слайда), с запасным вариантом. */
  blankWorld() {
    const el = this.ctx.deck?.currentEl?.querySelector('.b2b-blank-word') || this.ctx.deck?.currentEl?.querySelector('.b2b-blank');
    const pose = fittedPose(this.ctx, this.camera(this.state, this.step)); // как её поставит режиссёр (с подгонкой под 4:3)
    if (el) {
      const r0 = el.getBoundingClientRect();
      // фраза может ещё «въезжать» (CSS-переход transform) — берём её положение покоя
      let dy = 0;
      const ph = el.closest('.b2b-phrase');
      if (ph) { try { dy = new DOMMatrixReadOnly(getComputedStyle(ph).transform).m42; } catch { dy = 0; } }
      const rc = { left: r0.left, right: r0.right, top: r0.top - dy, height: r0.height, width: r0.width };
      if (rc.width > 4) {
        // проецируем через «финальную» позу камеры (а не текущую — она может ещё лететь)
        const cam = this.ctx.camera.clone();
        cam.position.set(...pose.pos);
        cam.lookAt(new THREE.Vector3(...pose.target));
        cam.fov = pose.fov;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        const toW = (x, y) => {
          const v = new THREE.Vector3((x / this.ctx.engine.width) * 2 - 1, -(y / this.ctx.engine.height) * 2 + 1, 0.5).unproject(cam);
          const dir = v.sub(cam.position).normalize();
          const t = (0 - cam.position.z) / dir.z;
          return cam.position.clone().addScaledVector(dir, t);
        };
        const a = toW(rc.left, rc.top + rc.height / 2), b = toW(rc.right, rc.top + rc.height / 2);
        return { x: (a.x + b.x) / 2, y: a.y, w: Math.abs(b.x - a.x) };
      }
    }
    return { x: 4.3, y: -2.5, w: 4.6 };
  }

  // ---------------------------------------------------------------------------
  camera() { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; } // для 16:9; под 4:3 подгоняет ядро

  background(state, step) {
    if (step >= 2) return { glows: [[0.6, 0.0, 0.55, 0.75]], band: null };
    return { glows: [[0.62, 0.05, 0.42, 0.55]], band: [0.55, -0.48, 0.12, 0.0] };
  }

  makeLabels() {
    this.removeLabels();
    this.lbls = CANDS.map((c, i) => this.label({
      html: `<span class="b2b-cand${i === WIN ? ' is-win' : ''}">${c.w}</span>`,
      position: [BARS.x0 + i * BARS.dx, BARS.base - 0.32, 0.5],
      anchor: 'top',
      visible: false,
    }));
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const d = inst ? 0 : 1;
    phase(this, this.ph, 'grow', step <= 1 ? 1 : 0, { duration: d * (step <= 1 ? 2.4 : 1.0), ease: step <= 1 ? 'power2.out' : 'power2.in', delay: step === 0 && !inst ? 0.4 : 0 });
    phase(this, this.ph, 'win', step === 1 ? 1 : 0, { duration: d * (step === 1 ? 1.6 : 0.6) });
    phase(this, this.ph, 'q', step >= 2 ? 1 : 0, { duration: d * 1.4 });
    // подписи кандидатов — каскадом вслед за ростом столбиков (отложенные вызовы отменяются при смене шага/уходе)
    this._lblCalls?.forEach((c) => c.kill());
    this._lblCalls = [];
    if (step <= 1) {
      this.lbls.forEach((l, i) => {
        if (inst || l.visible) l.show();
        else this._lblCalls.push(this.delay(0.7 + i * 0.16, () => { if (this.active && this.step <= 1) l.show(); }));
      });
    } else this.lbls.forEach((l) => l.hide());
    this.lbls.forEach((l, i) => { l.el.classList.toggle('is-lost', step === 1 && i !== WIN); l.el.classList.toggle('is-won', step === 1 && i === WIN); });
    const p = this.particles;
    p.setParams({ noise: step === 2 ? 0.16 : 0.14, swirl: 0, size: 0.06, twinkle: 0.35, spring: 15, damping: 5.5 }, d * 1.2);
    this._haloCall?.kill();
    if (step === 1) {
      // столбик-победитель «перетекает» в пропуск (см. update: он оседает), его частицы стекают вниз
      // и складываются в слово; когда проявилось чёткое слово (HTML), частицы расходятся мягким ореолом
      if (inst) p.morph(this.haloShape(), { duration: 0.01 });
      else {
        p.morph(this.shapeFor(1), { duration: 1.7, stagger: 0.35, burst: 3, delay: 0.1 });
        this.ctx.engine.pulse({ flash: 0.12 }, 0.8);
        this._haloCall = this.delay(2.7, () => p.morph(this.haloShape(), { duration: 1.6, stagger: 0.4, burst: 4 }));
      }
    } else {
      p.morph(this.shapeFor(step), { duration: inst ? 0.01 : 2.2, stagger: 0.5, burst: step === 2 ? 14 : 8 });
    }
  }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const obj = this.particles.object;
    const d = o.instant ? 0 : 1.4;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    updateShared(this.ctx);
    this.baseLine.resize(this.ctx);
    this.makeLabels();
    const s = this.step;
    this.ph.grow = o.instant || o.dir < 0 ? (s <= 1 ? 1 : 0) : 0;
    this.ph.win = s === 1 ? 1 : 0;
    this.ph.q = s >= 2 ? 1 : 0;
    this.t0 = this.ctx.time;
    // пропуск измеряем после того, как разметка встала
    if (s === 1) this.delay(0.05, () => this.apply(1, { ...o, instant: !!o.instant }));
    else this.apply(s, o);
    // формы «слово в пропуске» и «ореол» зависят от положения пропуска в разметке — строим их заранее,
    // когда фраза уже встала (иначе на клике шага 1 — заметная пауза на растеризацию текста и выравнивание)
    if (s === 0) this.delay(1.2, () => { if (this.active) { this.shapeFor(1); this.haloShape(); } });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  exit(o = {}) {
    this._lblCalls?.forEach((c) => c.kill());
    this.lbls?.forEach((l) => l.hide());
    return super.exit(o);
  }

  resize() {
    updateShared(this.ctx);
    this.baseLine.resize(this.ctx);
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const T = t - this.t0;
    const { grow, win, q } = this.ph;
    // модель «думает»: высоты колеблются, потом успокаиваются
    const think = (1 - sstep(1.6, 3.4, T)) * (1 - win);
    for (let i = 0; i < CANDS.length; i++) {
      const c = CANDS[i];
      const g = sstep(i * 0.08, i * 0.08 + 0.6, grow);
      const wobble = 1 + think * 0.22 * Math.sin(t * (3.1 + i * 0.7) + i * 1.9);
      let h = c.h * BARS.maxH * g * wobble;
      if (i !== WIN) h *= 1 - 0.75 * win;
      else h *= 1 - 0.8 * sstep(0.25, 1, win); // победитель «перетекает» в пропуск — оседает вслед за своими частицами
      const m = this.barMeshes[i];
      m.scale.y = Math.max(0.001, h);
      m.visible = h > 0.002 && q < 0.999;
      const u = m.material.uniforms;
      u.uH.value = Math.max(1, h / BARS.w);
      u.uOpacity.value = (i === WIN ? 1 : 1 - 0.7 * win) * (1 - q);
      u.uGlow.value = i === WIN ? 0.25 + 0.6 * win + 0.15 * Math.sin(t * 3) : 0;
    }
    this.baseLine.uniforms.uOpacity.value = 0.7 * grow * (1 - q);
    this.baseLine.mesh.visible = grow > 0.003 && q < 0.999;
    const wm = this.barMeshes[WIN];
    this.winGlow.position.set(wm.position.x, BARS.base + wm.scale.y * 0.8, -0.6);
    this.winGlow.scale.setScalar(2.2 + 2.8 * Math.min(1, wm.scale.y / BARS.maxH)); // сияние оседает вместе со столбиком
    this.winGlow.material.opacity = (0.15 + 0.35 * win) * grow * (1 - q) * this.fade.value;
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = 0;
    }
  }
}
