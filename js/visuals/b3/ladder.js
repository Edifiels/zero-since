// Блок 3. Лестница масштабов (логарифмическая шкала): червь — 302 → муха — 140 тыс. → мышь — ~70 млн → человек — 86 млрд.
// Ступени вырастают по клику, иконки-силуэты собираются из облака частиц; последняя (человек) уходит в облака.
// Шаг 4: «следующая цель — мышь» (дуга ×560 от мухи к мыши).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { HALFTONE } from '../../core/glsl.js';
import { eqShape, cellPx } from './common.js';

const BASE_Y = -4.75;
const K = 0.8;                        // мировых единиц на порядок величины
const STEP_W = 3.2, STEP_D = 2.6;
const ITEMS = [
  { key: 'worm', n: 302, x: -5.1, num: '302', name: 'червь' },
  { key: 'fly', n: 139255, x: -1.5, num: '140 тыс.', name: 'муха' },
  { key: 'mouse', n: 7e7, x: 2.1, num: '~70 млн', name: 'мышь' },
  { key: 'human', n: 8.6e10, x: 5.7, num: '86 млрд', name: 'человек' },
];
const yOf = (n) => BASE_Y + (Math.log10(n) - 2) * K;
ITEMS.forEach((it) => { it.top = yOf(it.n); });

const BOX_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vL;
void main() {
  vL = position;
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BOX_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uCell;
uniform float uHot;
uniform float uH;
varying vec3 vN;
varying vec3 vL;
${HALFTONE}
void main() {
  float h = clamp(vL.y / max(uH, 0.001), 0.0, 1.0);   // 0 — низ, 1 — верх (геометрия от 0 до uH)
  float top = step(0.5, vN.y);
  float side = 1.0 - top;
  float v = mix(0.08 + 0.55 * h * h, 0.85, top);
  float dots = halftoneDot(gl_FragCoord.xy, uCell, v);
  vec3 base = vec3(0.004, 0.03, 0.008);
  vec3 g = vec3(0.0, 0.9, 0.12);
  vec3 col = base + g * dots * (0.16 + 0.16 * side * h + 0.14 * top) * (1.0 + uHot * 1.8);
  col += vec3(0.6, 1.0, 0.6) * top * 0.03;
  gl_FragColor = vec4(col, uOpacity);
}
`;

function iconCanvas(key) {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const ell = (x, y, rx, ry, a = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); g.fill(); };
  if (key === 'worm') {
    g.lineWidth = 34;
    g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const x = 40 + t * 432, y = 400 + Math.sin(t * Math.PI * 2.2) * 34 - t * 10;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  } else if (key === 'fly') {
    // вид сбоку: голова, грудь, брюшко, поднятые крылья, лапки
    ell(150, 300, 52, 50);                 // голова
    ell(250, 300, 80, 72);                 // грудь
    ell(380, 318, 105, 64, 0.12);          // брюшко
    g.globalAlpha = 0.85;
    ell(330, 200, 150, 46, -0.35);         // крыло
    g.globalAlpha = 1;
    g.lineWidth = 12;
    [[210, 350, 150, 420, 120, 470], [255, 360, 250, 430, 225, 475], [300, 355, 360, 420, 400, 470]].forEach(([a, b, c2, d, e, f]) => {
      g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.lineTo(e, f); g.stroke();
    });
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(118, 270); g.lineTo(95, 225); g.stroke();
  } else if (key === 'mouse') {
    ell(270, 360, 150, 92, -0.05);         // тело
    ell(130, 330, 72, 62, -0.25);          // голова
    ell(90, 352, 40, 26, -0.1);            // мордочка
    ell(165, 262, 42, 48, -0.3);           // ухо
    g.lineWidth = 14;
    g.beginPath(); g.moveTo(410, 380); g.bezierCurveTo(500, 400, 500, 300, 455, 280); g.stroke();   // хвост
    g.lineWidth = 16;
    for (const x of [200, 330]) { g.beginPath(); g.moveTo(x, 430); g.lineTo(x - 8, 470); g.stroke(); }
  } else {
    // человек
    ell(256, 70, 46, 52);                  // голова
    g.beginPath();
    g.moveTo(196, 140); g.quadraticCurveTo(256, 120, 316, 140);
    g.lineTo(336, 300); g.lineTo(306, 300); g.lineTo(300, 220);
    g.lineTo(296, 490); g.lineTo(262, 490); g.lineTo(256, 320); g.lineTo(250, 490); g.lineTo(216, 490);
    g.lineTo(212, 220); g.lineTo(206, 300); g.lineTo(176, 300);
    g.closePath(); g.fill();
  }
  return c;
}

export default class Ladder extends Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    // --- ступени
    this.steps = [];
    ITEMS.forEach((it, i) => {
      const h = it.top - (BASE_Y - 0.6);
      const geo = new THREE.BoxGeometry(STEP_W, h, STEP_D);
      geo.translate(0, h / 2, 0);
      const u = { uOpacity: { value: 1 }, uCell: { value: 7 }, uHot: { value: 0 }, uH: { value: h } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(it.x, BASE_Y - 0.6, 0);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({
        color: new THREE.Color('#00ff00').multiplyScalar(1.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      mesh.add(edges);
      mesh.scale.y = 0.001;
      this.root.add(mesh);
      this.steps.push({ mesh, u, edges, h });
    });

    // --- логарифмическая ось и направляющие (10³, 10⁶, 10⁹)
    const ax = new THREE.Group();
    this.root.add(ax);
    const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#9dff8a'), transparent: true, opacity: 0.55, depthWrite: false });
    const dashMat = new THREE.LineDashedMaterial({ color: new THREE.Color('#9dff8a'), transparent: true, opacity: 0.32, dashSize: 0.25, gapSize: 0.2, depthWrite: false });
    const axX = -7.5;
    const pts = [];
    pts.push(axX, BASE_Y - 0.6, 0, axX, yOf(1e9), 0);
    for (let e = 2; e <= 9; e++) { const y = yOf(10 ** e); pts.push(axX - (e % 3 === 0 ? 0.35 : 0.18), y, 0, axX, y, 0); }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    ax.add(new THREE.LineSegments(ag, lineMat));
    const dpts = [];
    for (const e of [3, 6, 9]) { const y = yOf(10 ** e); dpts.push(axX, y, -STEP_D / 2, 7.8, y, -STEP_D / 2); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dpts, 3));
    const dl = new THREE.LineSegments(dg, dashMat);
    dl.computeLineDistances();
    ax.add(dl);
    this.axisX = axX;

    // --- дуга «×560» от мухи к мыши
    const a = new THREE.Vector3(ITEMS[1].x + 0.3, ITEMS[1].top + 1.75, 0.6), b = new THREE.Vector3(ITEMS[2].x - 0.45, ITEMS[2].top + 1.45, 0.6);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(-0.35, 0.85, 0));
    this.arcCurve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const arcPts = this.arcCurve.getPoints(64);
    const arcG = new THREE.BufferGeometry().setFromPoints(arcPts);
    this.arcU = { uOpacity: { value: 1 }, uK: { value: 0 }, uTime: { value: 0 } };
    const aIdx = new Float32Array(arcPts.length);
    for (let i = 0; i < arcPts.length; i++) aIdx[i] = i / (arcPts.length - 1);
    arcG.setAttribute('aT', new THREE.Float32BufferAttribute(aIdx, 1));
    this.arc = new THREE.Line(arcG, new THREE.ShaderMaterial({
      uniforms: this.arcU,
      vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform float uK; uniform float uTime; varying float vT; void main() { if (vT > uK) discard; float p = 0.6 + 0.4 * sin(vT * 40.0 - uTime * 6.0); gl_FragColor = vec4(vec3(0.6, 1.0, 0.55) * 1.3 * p, uOpacity); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.arc.frustumCulled = false;
    this.root.add(this.arc);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9dff8a').multiplyScalar(1.2), transparent: true }));
    this.arcHead = head;
    head.visible = false;
    this.root.add(head);

    // --- формы облака частиц: иконки + «облака»
    this.buildShapes(n);
  }

  buildShapes(n) {
    const r = rng(41);
    const counts = { worm: 0.07, fly: 0.13, mouse: 0.16, human: 0.2 };
    const icon = {};
    const sizes = { worm: [2.1, 0.0], fly: [2.1, 0.0], mouse: [2.35, 0.0], human: [2.7, 0.0] };
    let off = 0;
    for (const it of ITEMS) {
      const m = Math.floor(n * counts[it.key]);
      const cnv = iconCanvas(it.key);
      const w = sizes[it.key][0];
      const sh = S.fromCanvas(m, cnv, {
        width: w, depth: 0.35, threshold: 0.4, size: 0.95,
        colorFn: (x, y, rr) => (rr() < 0.2 ? S.PAL.greenHi : rr() < 0.6 ? S.PAL.white : S.PAL.mint),
      });
      // ставим на ступень: низ иконки — на верхнюю грань
      let minY = Infinity;
      for (let i = 0; i < m; i++) minY = Math.min(minY, sh.positions[i * 4 + 1]);
      for (let i = 0; i < m; i++) {
        sh.positions[i * 4] += it.x;
        sh.positions[i * 4 + 1] += it.top - minY + 0.05;
        sh.positions[i * 4 + 2] += 0.2;
      }
      icon[it.key] = { shape: sh, off, m };
      off += m;
    }
    this.iconRange = icon;
    // облака: туманность вокруг вершины лестницы (+ лёгкая дымка по небу)
    const cloud = S.createShape(n);
    const cc = [ITEMS[3].x + 0.4, ITEMS[3].top + 2.35, 0.2];
    for (let i = 0; i < n; i++) {
      let x, y, z, a, c, sz;
      const k = r();
      if (k < 0.8) {
        // космические «облака» вокруг вершины: вытянутые сгустки с мягким краем
        const blob = Math.floor(r() * 7);
        const br = rng(blob * 13 + 7);
        const bx = cc[0] + br.range(-3.2, 2.6), by = cc[1] + br.range(-0.5, 1.4), bz = cc[2] + br.range(-1.6, 1.4);
        const [dx, dy, dz] = r.inSphere(1);
        const sx = br.range(1.3, 2.4), sy = br.range(0.35, 0.7);
        x = bx + dx * sx; y = by + dy * sy; z = bz + dz * 1.2;
        const edge = 1 - Math.min(1, dx * dx + dy * dy);
        a = r.range(0.08, 0.28) * (0.4 + 0.6 * edge); c = r() < 0.55 ? S.PAL.pale : r() < 0.6 ? S.PAL.mint : S.PAL.blue; sz = r.range(0.6, 1.2);
      } else {
        // звёздная пыль
        const [dx, dy, dz] = r.inSphere(1);
        x = dx * 15; y = 1 + dy * 8; z = -7 + dz * 5;
        a = r.range(0.04, 0.14); c = S.PAL.white; sz = r.range(0.4, 0.8);
      }
      S.setPoint(cloud, i, x, y, z, sz, c, a);
    }
    this.cloud = cloud;
    // формы для шагов 0..3 (шаг 4 = шаг 3)
    this.shapes = [];
    for (let s = 0; s <= 3; s++) {
      const sh = S.createShape(n);
      sh.positions.set(cloud.positions);
      sh.colors.set(cloud.colors);
      ITEMS.forEach((it, i) => {
        if (i > s) return;
        const ic = icon[it.key];
        sh.positions.set(ic.shape.positions.subarray(0, ic.m * 4), ic.off * 4);
        sh.colors.set(ic.shape.colors.subarray(0, ic.m * 4), ic.off * 4);
      });
      this.shapes.push(eqShape(sh, 1));
    }
  }

  camera(state, step) {
    switch (Math.min(step, 4)) {
      case 0: return { pos: [-0.8, -0.9, 14.6], target: [-0.4, -0.6, 0], fov: 45 };
      case 1: return { pos: [-0.5, -0.5, 15.0], target: [-0.2, -0.3, 0], fov: 45 };
      case 2: return { pos: [0.1, 0.0, 15.6], target: [0.2, 0.1, 0], fov: 45 };
      case 3: return { pos: [0.6, 0.6, 16.2], target: [0.5, 0.4, 0], fov: 45 };
      // подпись внизу в 2 строки — камера отъезжает, лестница поднимается над ней
      default: return { pos: [0.5, -0.7, 17.6], target: [0.4, -1.15, 0], fov: 45 };
    }
  }

  background(state, step) { return step >= 3 ? 'top' : 'corner'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.tw(p.object.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.4 });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.4 });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.4 });
    p.setParams({ noise: 0.12, swirl: 0, size: 0.07, twinkle: 0.35, spring: 16, damping: 5.5 }, o.instant ? 0 : 1);
    this.lastShape = -1;
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const D = (x) => (inst ? 0 : x);
    const p = this.particles;
    const si = Math.min(step, 3);
    if (si !== this.lastShape) {
      p.morph(this.shapes[si], { duration: D(o.entering ? 2.2 : 2.0), stagger: 0.55, burst: 7 });
      this.lastShape = si;
    }
    // ступени вырастают (именованные анимации: быстрые клики назад-вперёд не «воскрешают» ступень)
    this.steps.forEach((s, i) => {
      const on = i <= si;
      this.twk('step' + i, s.mesh.scale, { y: on ? 1 : 0.001, duration: D(on ? 1.3 : 0.6), delay: D(on && i === si && !o.entering ? 0.15 : 0), ease: on ? 'power3.out' : 'power2.in' });
      this.twk('hot' + i, s.u.uHot, { value: step >= 4 && i === 2 ? 1 : 0, duration: D(0.8) });
    });
    // дуга ×560 и подсветка мыши — на шаге 4
    this.twk('arc', this.arcU.uK, { value: step >= 4 ? 1 : 0, duration: D(step >= 4 ? 1.2 : 0.4), delay: D(step >= 4 ? 0.4 : 0), ease: 'power2.inOut' });
    if (step >= 4 && !inst) this.ctx.engine.pulse({ aberration: 0.6 }, 0.8);
    // новая ступень растёт ~1.3 с — её подпись появляется следом; «×560» — когда дуга дорисуется
    const fwd = !inst && (o.entering || (o.prevStep ?? step) < step);
    this.updateLabels(step, fwd ? 0.75 : 0);
  }

  updateLabels(step, lag = 0) {
    if (!this.lbl) {
      this.lbl = { items: [], ticks: [] };
      ITEMS.forEach((it) => {
        // подписи — на передней грани ступени, как на пьедестале (у червя ступень низкая — подпись над ней)
        const low = it.key === 'worm';
        this.lbl.items.push(this.label({
          html: `<div class="b3-lad"><b>${it.num}</b><span>${it.name}</span></div>`,
          position: low ? [it.x, it.top + 1.05, 0.4] : [it.x, it.top - 0.3, STEP_D / 2 + 0.05],
          anchor: low ? 'bottom' : 'top', visible: false,
        }));
      });
      [[3, 'тысяча'], [6, 'миллион'], [9, 'миллиард']].forEach(([e, t]) => {
        this.lbl.ticks.push(this.label({ html: `<span class="b3-tick is-sm">${t}</span>`, position: [this.axisX - 0.25, yOf(10 ** e), -STEP_D / 2], anchor: 'right', visible: false }));
      });
      this.lbl.x560 = this.label({ html: '<span class="b3-tag is-hot">× 560</span>', position: [0, 0, 0], anchor: 'bottom', visible: false });
    }
    const L = this.lbl;
    const on = (key, l, v, sec) => {
      if (!v) { this._keyed?.get(key)?.kill(); l.hide(); return; }
      if (sec > 0 && !l.visible) {
        const clk = (this._lblClk ||= {})[key] ||= { t: 0 };
        this.twk(key, clk, { t: 1, duration: sec, onComplete: () => l.show() });
      } else { this._keyed?.get(key)?.kill(); l.show(); }
    };
    L.items.forEach((l, i) => on('item' + i, l, i <= step, i === step ? lag : 0));
    L.ticks.forEach((l) => l.show());
    const mid = this.arcCurve.getPoint(0.5);
    L.x560.setPosition([mid.x, mid.y + 0.15, mid.z]);
    on('x560', L.x560, step >= 4, lag ? 1.3 : 0);
    // мышь — «следующая цель» (это говорит подпись внизу): подсвеченная рамка подписи, ступень и дуга ×560
    const m = ITEMS[2];
    L.items[2].setHTML(`<div class="b3-lad${step >= 4 ? ' is-next' : ''}"><b>${m.num}</b><span>${m.name}</span></div>`);
  }

  exit(o = {}) {
    this.removeLabels();
    this.lbl = null;
    return super.exit(o);
  }

  update(dt, t) {
    const cell = cellPx(this.ctx.engine);
    for (const s of this.steps) { s.u.uCell.value = cell; s.mesh.visible = s.mesh.scale.y > 0.02; }
    this.arcU.uTime.value = t;
    this.arc.visible = this.arcU.uK.value > 0.002;
    // наконечник стрелки
    const k = this.arcU.uK.value;
    this.arcHead.visible = k > 0.98;
    if (this.arcHead.visible) {
      if (!this._ap) { this._ap = new THREE.Vector3(); this._at = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0); }
      this.arcCurve.getPoint(1, this._ap);
      this.arcCurve.getTangent(1, this._at);
      this.arcHead.position.copy(this._ap);
      this.arcHead.quaternion.setFromUnitVectors(this._up, this._at);
    }
    // облака медленно дрейфуют
    if (this.ownsParticles()) this.particles.object.position.x = Math.sin(t * 0.08) * 0.15;
  }
}
