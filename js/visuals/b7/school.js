// «Эксперимент со школьниками»: 3D-столбики относительно пунктира контрольной группы.
// Шаг 0 — шар «ИИ» подпитывает зелёный столбик «+48%» (вихрь частиц-знаний).
// Шаг 1 — «ИИ забрали»: шар улетает вместе с частицами, оранжевый столбик «−17%» падает ниже пунктира.
// Шаг 2 — доклад из частиц «выветривается» за 45 дней.
import * as THREE from 'three';
import { HALFTONE } from '../../core/glsl.js';
import { B7Visual, S, C, Pts, rrEdge, rrFill, textBlock, glowMat, pulseLines, makeOrb, tick, equalizeAsync, TAU, lerp } from './common.js';

const K = 0.098;              // мировых единиц на 1 %
const H_A = 48 * K;           // тренировка с ИИ: +48 %
const H_B = 17 * K;           // экзамен без ИИ: −17 %
const BW = 1.6;              // ширина столбика
const GAP = 3.7;              // расстояние между столбиками
const BASE_Y = -1.0;         // уровень контрольной группы

const BAR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uCell, uTime;
varying vec3 vN;
varying vec3 vP;
${HALFTONE}
void main() {
  vec3 n = normalize(vN);
  float face = 0.5 + 0.5 * abs(dot(n, normalize(vec3(0.45, 0.75, 0.55))));
  float h = clamp(abs(vP.y), 0.0, 1.0);
  float wave = 0.08 * sin(h * 18.0 - uTime * 3.0);
  float v = clamp((0.22 + 0.62 * h + wave) * face, 0.0, 1.0);
  float d = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 col = uColor * (0.22 + d * 0.95) * face;
  gl_FragColor = vec4(col, (0.3 + d * 0.55) * uOpacity * uFade);
}
`;

function barMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uFade: { value: 1 }, uCell: { value: 7 }, uTime: { value: 0 } },
    vertexShader: BAR_VERT,
    fragmentShader: BAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Столбик: halftone-заливка, светящиеся рёбра с импульсами, крышка; растёт вверх (dir=1) или вниз (dir=-1). */
function makeBar({ color, edge, dir = 1, height }) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const geo = new THREE.BoxGeometry(BW, 1, BW);
  geo.translate(0, dir * 0.5, 0);
  const mat = barMaterial(color);
  body.add(new THREE.Mesh(geo, mat));
  const w = BW / 2, y1 = dir;
  const P = (x, y, z) => [x, y, z];
  const segs = [];
  const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
  corners.forEach(([x, z], i) => {
    segs.push({ a: P(x, 0, z), b: P(x, y1, z), phase: i * 0.27, speed: 0.55, bright: 1, pulse: 1 });
    const [x2, z2] = corners[(i + 1) % 4];
    segs.push({ a: P(x, y1, z), b: P(x2, y1, z2), phase: 0, speed: 0, bright: 1.2, pulse: 0 });
    segs.push({ a: P(x, 0, z), b: P(x2, 0, z2), phase: 0, speed: 0, bright: 0.6, pulse: 0 });
  });
  const edges = pulseLines(segs, { width: 2.6, color: edge, colorK: 0.9, pulseColor: edge, pulseK: 2.4, pulseLen: 0.14 });
  body.add(edges);
  const capMat = glowMat(edge, 1.25, 0.42);
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.96, BW * 0.96), capMat);
  cap.rotation.x = -Math.PI / 2;
  const capHolder = new THREE.Group();
  capHolder.add(cap);
  g.add(capHolder);
  return { group: g, body, cap: capHolder, mats: [mat, edges.material, capMat], height, dir, grow: { v: 0 } };
}

export default class School extends B7Visual {
  static transition = 'zoom';

  async init() {
    const n = this.ctx.particles.count;
    this.chart = new THREE.Group();
    this.root.add(this.chart);

    // Пунктир контрольной группы
    const dashes = 24, span = GAP + 3.8;
    const dashMat = glowMat('#ffffff', 0.95, 0.9);
    const dm = new THREE.InstancedMesh(new THREE.BoxGeometry(span / dashes * 0.55, 0.075, 0.075), dashMat, dashes);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < dashes; i++) { m4.makeTranslation(-2.2 + (i + 0.5) * (span / dashes), 0, 0.2); dm.setMatrixAt(i, m4); }
    this.chart.add(dm);

    this.barA = makeBar({ color: '#00ff00', edge: '#7dff6e', dir: 1, height: H_A });
    this.barB = makeBar({ color: '#ff8a1f', edge: '#ffb066', dir: -1, height: H_B });
    this.barB.group.position.x = GAP;
    this.chart.add(this.barA.group, this.barB.group);
    this.chartMats = [dashMat, ...this.barA.mats, ...this.barB.mats];

    // Шар «ИИ» и луч к столбику
    this.orb = makeOrb({ radius: 0.5 });
    this.orbHome = new THREE.Vector3(GAP * 0.56, H_A * 0.7, 0.4);
    this.orb.group.position.copy(this.orbHome);
    this.chart.add(this.orb.group);
    this.beam = pulseLines([
      { a: [GAP * 0.56, H_A * 0.7, 0.4], b: [BW * 0.5, H_A * 0.82, 0], phase: 0, speed: 1.1, bright: 0.5, pulse: 1 },
      { a: [GAP * 0.56, H_A * 0.7, 0.4], b: [BW * 0.5, H_A * 0.82, 0], phase: 0.5, speed: 1.1, bright: 0, pulse: 1 },
    ], { width: 4, color: '#9dff8f', colorK: 0.7, pulseColor: '#00ff00', pulseK: 2.6, pulseLen: 0.12 });
    this.chart.add(this.beam);
    this.orbState = { away: 0 };
    this.orbMats = [...this.orb.mats, this.beam.material];
    this.tickList = [...this.chartMats, ...this.orbMats];

    // ---- Формы частиц (координаты относительно столбика A на уровне пунктира)
    await tick();
    this.shapeBoost = await equalizeAsync(this.boostShape(n));
    this.shapeAway = await equalizeAsync(this.awayShape(n));
    this.shapeDoc = await equalizeAsync(this.docShape(n));
    this.shapeGone = this.goneShape(this.shapeDoc);
    this.shapeGone.meta.equalized = true;

    this.chartFade = { v: 1 };
    this.dissolve = { t: 0 };
    this._day = -1;
    this._pending = [];
  }

  // Вихрь знаний вокруг столбика A + струя от шара + лёгкая пыль
  boostShape(n) {
    const b = new Pts(n, 7);
    const R = 1.25;
    b.add(0.24, (r) => {
      const strand = r.int(0, 2), t = r();
      const a = t * TAU * 1.6 + (strand / 3) * TAU;
      const rr = R + 0.15 + r.gauss(0, 0.05);
      return [Math.cos(a) * rr, t * (H_A + 0.3) + r.gauss(0, 0.04), Math.sin(a) * rr, r.range(0.5, 1.0), r() < 0.4 ? C.greenHi : C.white, r.range(0.25, 0.55)];
    });
    b.add(0.12, (r) => {
      const a = r() * TAU, rr = 1.2 + r() * 0.9;
      return [Math.cos(a) * rr, r() * (H_A + 1.2), Math.sin(a) * rr, r.range(0.4, 0.9), C.mint, r.range(0.08, 0.22)];
    });
    b.add(0.06, (r) => { const a = r() * TAU, rr = 1.1 + r.gauss(0, 0.035); return [Math.cos(a) * rr, H_A + 0.16 + r.gauss(0, 0.025), Math.sin(a) * rr, 0.9, C.greenHi, 0.6]; });
    b.add(0.58, (r) => { const [x, y, z] = r.inSphere(10); return [x + 1.8, y * 0.6 + 1.5, z * 0.5 - 2.5, r.range(0.4, 0.8), C.white, r.range(0.03, 0.12)]; });
    return b.done();
  }

  // Шар улетает — частицы уносятся вверх, за край кадра (и на 4:3 тоже), на месте — редкая пыль
  awayShape(n) {
    const b = new Pts(n, 8);
    b.add(0.55, (r) => { const [x, y, z] = r.inSphere(2.2); return [GAP * 0.7 + x * 1.6, 17 + y, z, r.range(0.5, 1.1), r() < 0.5 ? C.greenHi : C.white, r.range(0.3, 0.7)]; });
    b.add(0.45, (r) => { const [x, y, z] = r.inSphere(9); return [x + 1.5, y * 0.6 + 1.0, z * 0.5 - 2, r.range(0.4, 0.8), C.white, r.range(0.03, 0.1)]; });
    return b.done();
  }

  // Доклад: лист с заголовком, строками и значком чат-бота
  docShape(n) {
    const b = new Pts(n, 9);
    const cx = GAP * 0.42, cy = 1.35, W = 3.6, H = 4.7;
    const tb = textBlock({ x0: cx - W / 2 + 0.35, x1: cx + W / 2 - 0.35, yTop: cy + 0.75, rows: 9, rowH: 0.3, seed: 4, minW: 0.15, maxW: 0.7, gap: 0.1, thick: 0.03 });
    b.add(0.14, (r) => { const [x, y] = rrEdge(r, cx, cy, W, H, 0.18); return [x, y, 0, 1, C.white, 0.95]; });
    b.add(0.12, (r) => { const [x, y] = rrFill(r, cx, cy, W, H, 0.18); return [x, y, -0.02, 0.75, C.soft, 0.16]; });
    b.add(0.08, (r) => [cx - W / 2 + 0.35 + r() * 1.7, cy + 1.45 + r.gauss(0, 0.06), 0.02, 1.1, C.greenHi, 0.85]);
    b.add(0.4, (r) => { const [x, y] = tb(r); return [x, y, 0.02, 0.85, C.white, 0.85]; });
    b.add(0.06, (r) => { const [x, y] = rrEdge(r, cx + W / 2 - 0.55, cy + 1.45, 0.62, 0.42, 0.16); return [x, y, 0.05, 0.95, C.greenHi, 0.9]; });
    b.add(0.03, (r) => { const k = r.int(0, 2); const a = r() * TAU, d = Math.sqrt(r()) * 0.05; return [cx + W / 2 - 0.71 + k * 0.16 + Math.cos(a) * d, cy + 1.45 + Math.sin(a) * d, 0.06, 1, C.white, 0.9]; });
    b.add(0.17, (r) => { const [x, y, z] = r.inSphere(9); return [x + 1.5, y * 0.6 + 1.0, z * 0.5 - 2, r.range(0.4, 0.8), C.white, r.range(0.03, 0.1)]; });
    return b.done();
  }

  // «Выветривание»: исчезают целые слова и куски рамки, остаются обрывки
  goneShape(doc) {
    const s = { count: doc.count, positions: doc.positions.slice(), colors: doc.colors.slice(), meta: {} };
    let a = 99;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
    const P = s.positions, Cc = s.colors;
    for (let i = 0; i < s.count; i++) {
      const j = i * 4;
      const x = P[j], y = P[j + 1];
      const far = Math.abs(P[j + 2]) > 0.6 || Math.abs(x - GAP * 0.42) > 2.2 || Math.abs(y - 1.35) > 2.7;
      const keep = !far && hash(Math.round(x / 0.55), Math.round(y / 0.3)) < 0.24;
      if (keep) { Cc[j + 3] *= 0.85; continue; }
      if (far) continue;
      P[j] += (r() - 0.5) * 6;
      P[j + 1] += 2.5 + r() * 7;
      P[j + 2] += (r() - 0.5) * 4;
      Cc[j] = C.mint[0]; Cc[j + 1] = C.mint[1]; Cc[j + 2] = C.mint[2];
      Cc[j + 3] *= 0.05;
    }
    return s;
  }

  chartX() { return this.stageRect().w * 0.135; }

  basePose(state, step) {
    if (step >= 2) return { pos: [0.2, 0.9, 14.2], target: [1.3, 0.55, 0], fov: 45 };
    return { pos: [-1.6, 1.5, 14.6], target: [0.9, 0.55, 0], fov: 45 };
  }

  background(state, step) { return step >= 2 ? 'soft' : 'corner'; }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.25, size: 0.06, twinkle: 0.35, spring: 16, damping: 5.5 }, o.instant ? 0 : 0.8);
    this.chart.position.set(this.chartX(), BASE_Y, 0);
    // подписи
    const A = this.barA, B = this.barB;
    this.labs = {
      plus: this.lab({ html: '<span class="b7-big accent">+48%</span>', object: A.cap, offset: [0, 0.62, 0], visible: false }),
      minus: this.lab({ html: '<span class="b7-big warn">−17%</span>', object: B.cap, offset: [0, -0.62, 0], visible: false }),
      nameA: this.lab({ html: '<span class="b7-tag">Тренировка с ИИ</span>', position: [0, 0, 0], visible: false }),
      nameB: this.lab({ html: '<span class="b7-tag is-warn">Экзамен</span>', position: [0, 0, 0], visible: false }),
      ctl: this.lab({ html: '<span class="b7-ctl">Без ИИ</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
      ai: this.lab({ html: '<span class="b7-ai">ИИ</span>', object: this.orb.group, offset: [0, 0, 0], visible: false }),
      gone: this.lab({ html: '<span class="b7-stamp-lab">ИИ забрали</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
      day: this.lab({ html: '<span class="b7-day">День 1</span>', position: [0, 0, 0], visible: false }),
    };
    this.placeLabels();
    // столбики — сразу в нужное состояние, затем анимация шага
    A.grow.v = 0; B.grow.v = 0;
    this.chartFade.v = this.step >= 2 ? 0 : 1;
    this.orbState.away = this.step >= 1 ? 1 : 0;
    this._day = -1;
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  placeLabels() {
    const x0 = this.chartX();
    const L = this.labs;
    if (!L) return;
    L.nameA.setPosition([x0, BASE_Y - 0.62, 0.75]);
    L.nameB.setPosition([x0 + GAP, BASE_Y + 0.82, 0.75]);
    L.ctl.setPosition([x0 + GAP + 1.65, BASE_Y, 0.2]);
    L.gone.setPosition([x0 + BW * 0.5 + 0.45, BASE_Y + H_A * 0.64, 0.4]);
    L.day.setPosition([x0 + GAP * 0.42, BASE_Y + 1.35 + 3.0, 0]);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  applyStep(step, o = {}) {
    const instant = !!o.instant;
    const D = (v) => (instant ? 0 : v);
    const p = this.particles;
    const L = this.labs;
    this._pending.forEach((d) => d.kill());
    this._pending = [];
    const later = (sec, fn) => { if (instant) fn(); else this._pending.push(this.delay(sec, fn)); };
    const A = this.barA, B = this.barB;

    // столбики (именованные анимации: отложенный рост не «воскреснет» при быстром «назад»)
    this.twk('growA', A.grow, { v: 1, duration: D(o.enter ? 1.8 : 1.2), delay: D(o.enter ? 0.5 : 0), ease: 'power3.out' });
    this.twk('growB', B.grow, { v: step >= 1 ? 1 : 0, duration: D(step >= 1 ? 1.0 : 0.6), delay: D(step === 1 && !o.enter ? 0.55 : 0), ease: step >= 1 ? 'bounce.out' : 'power2.in' });
    this.twk('chartFade', this.chartFade, { v: step >= 2 ? 0 : 1, duration: D(1.0) });
    this.twk('orb', this.orbState, { away: step >= 1 ? 1 : 0, duration: D(step >= 1 ? 1.3 : 1.0), ease: step >= 1 ? 'power2.in' : 'power2.out' });

    // подписи
    const vis = (l, on, delay = 0) => { if (!on) l.hide(); else later(delay, () => l.show()); };
    vis(L.plus, step <= 1, o.enter ? 1.6 : 0.6);
    vis(L.nameA, step <= 1, o.enter ? 1.2 : 0.3);
    vis(L.ctl, step <= 1, o.enter ? 0.8 : 0.2);
    vis(L.ai, step === 0, o.enter ? 1.0 : 0.4);
    vis(L.nameB, step === 1, 0.9);
    vis(L.minus, step === 1, 1.3);
    vis(L.gone, step === 1, 0.15);
    vis(L.day, step >= 2, 1.2);

    // частицы
    if (this.ownsParticles()) {
      this.tw(p.object.position, { x: this.chartX(), y: BASE_Y, z: 0, duration: D(1.6), ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: D(1.2), overwrite: 'auto' });
      this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: D(1.2), overwrite: 'auto' });
      this.twk('dissolve', this.dissolve, { t: 0, duration: 0 });
      if (step === 0) {
        p.setParams({ swirl: 1.15, noise: 0.25 }, D(1));
        p.morph(this.shapeBoost, { duration: D(o.enter ? 2.2 : 1.6), stagger: 0.5, burst: 10 });
      } else if (step === 1) {
        p.setParams({ swirl: 0.3, noise: 0.3 }, D(0.6));
        p.morph(this.shapeAway, { duration: D(1.6), stagger: 0.4, burst: 16, ease: 'power2.in' });
      } else {
        p.setParams({ swirl: 0, noise: 0.18 }, D(0.6));
        p.morph(this.shapeDoc, { duration: D(1.6), stagger: 0.45, burst: 9 });
        later(2.1, () => {
          if (this.step < 2 || !this.ownsParticles()) return;
          this.particles.morph(this.shapeGone, { duration: 6.5, stagger: 0.88, burst: 3, ease: 'none' });
          this.particles.setParams({ flow: [0, 0.35, 0], noise: 0.4 }, 3);
          this.twk('dissolve', this.dissolve, { t: 1, duration: 6.5, ease: 'none', startAt: { t: 0 } });
        });
      }
      if (step < 2) p.setParams({ flow: [0, 0, 0] }, D(0.6));
    }

    // «щелчок» — ИИ забрали
    if (!instant && step === 1 && o.prevStep === 0) {
      this.ctx.engine.pulse({ aberration: 1.3, flash: 0.12 }, 0.8);
      this.ctx.rig.shake(0.22, 0.5);
      later(0.75, () => { this.ctx.rig.shake(0.3, 0.6); this.ctx.background.surge(0.5, 1.2); });
    } else if (!instant && !o.enter) {
      this.ctx.engine.pulse({ aberration: 0.6 }, 0.8);
    }
  }

  onResize() {
    if (!this.active) return;
    this.chart.position.x = this.chartX();
    this.placeLabels();
    if (this.ownsParticles()) this.particles.object.position.x = this.chartX();
  }

  update(dt, t) {
    const A = this.barA, B = this.barB;
    const f = this.chartFade.v;
    this.chart.visible = f > 0.003;
    for (const m of this.chartMats) m.uniforms.uFade.value = f;
    // рост столбиков
    const hA = Math.max(0.001, A.height * A.grow.v), hB = Math.max(0.001, B.height * B.grow.v);
    A.body.scale.set(1, hA, 1);
    A.cap.position.y = hA;
    B.body.scale.set(1, hB, 1);
    B.cap.position.y = -hB;
    B.group.visible = B.grow.v > 0.002;
    // шар ИИ
    const aw = this.orbState.away;
    const og = this.orb.group;
    og.position.set(this.orbHome.x + aw * 0.6, this.orbHome.y + aw * aw * 9 + Math.sin(t * 1.6) * 0.1 * (1 - aw), this.orbHome.z);
    og.scale.setScalar(Math.max(0.001, 1 - aw * 0.75));
    const of = f * (1 - aw);
    this.orb.fade = of;
    this.orb.update(t, this.cellPx(), this.opacity);
    this.beam.material.uniforms.uFade.value = of * (1 - Math.min(1, aw * 3));
    // счётчик дней (шаг 2)
    if (this.step >= 2 && this.labs) {
      const day = 1 + Math.round(44 * this.dissolve.t);
      if (day !== this._day) {
        this._day = day;
        this.labs.day.setHTML(`<span class="b7-day">День <b>${day}</b></span>`);
      }
    }
    this.tickMaterials(t, this.tickList);
  }
}
