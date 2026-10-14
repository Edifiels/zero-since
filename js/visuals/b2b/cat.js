// «Кошка Хьюбела и Визела»: кошка смотрит на экран с полоской под разными углами — в её «зрительной коре»
// загораются РАЗНЫЕ нейроны для разных углов. Шаг 1: полоски превращаются в фильтры свёрточной сети
// (сетка маленьких ориентированных ядер). Шаг 2: фильтры садятся на контуры, контуры собираются в мордочку.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { ready, FatLines, GlowPoints, orbMaterial, glowInstancedMaterial, instAttr, noFade, updateShared, sstep, bump, setInstance, phase } from './lib.js';
import { catSideCanvas, silhouetteEdges, catFaceCanvas, contourPointForAngle } from './catdraw.js';

const ANGLES = [0, 30, 60, 90, 120, 150];
const ORDER = [0, 3, 1, 4, 2, 5];           // порядок показа углов на экране
const SEG = 1.7;                              // секунд на один угол

const CAT = { c: [-6.4, -1.15, 0], h: 5.5 };
const SCREEN = { c: [-0.35, -0.55, 0], w: 4.3, h: 3.25 };
const PANEL = { c: [5.95, -0.35, 0], dx: 1.0, dy: 1.2 };
const FACE = { c: [1.35, -0.2, 0], h: 7.2 };
const EYE = [CAT.c[0] + (400 / 512 - 0.5) * CAT.h * (512 / 640) - 0.25, CAT.c[1] - (222 / 640 - 0.5) * CAT.h + 0.05, 0.3];

const DASH_FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uOpacity, uFade, uTime, uPulse;
varying vec2 vST;
varying vec4 vData;
void main() {
  float s = vData.x + vST.y * vData.z;
  float dash = step(0.45, fract(s / 0.28 - uTime * 0.9));
  float e = 1.0 - smoothstep(0.3, 1.0, abs(vST.x));
  float u = s / max(vData.w, 0.001);
  float q = (u - uPulse) / 0.06;
  float k = uPulse > -0.5 ? exp(-q * q) : 0.0;
  float a = e * uOpacity * uFade * (0.22 + 0.4 * dash + k);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (0.6 + 0.4 * dash) + uHot * k, a);
}
`;


export default class Cat extends Visual {
  static transition = 'halftone';

  async init() {
    this.fade = { value: 1 };
    this.ph = { kern: 0, face: 0, panel: 1 };
    this.t0 = 0;
    this.buildScreen();
    this.buildPanel();
    this.buildKernels();
    this.buildArc();
    // глаз кошки: две статичные точки, яркость — uniform'ами (точки различаем по размеру)
    this.eyeU = { uEyeA: { value: 0 }, uEyeB: { value: 0 } };
    this.eye = new GlowPoints(2, { fade: this.fade, uniforms: this.eyeU, vertexHead: 'uniform float uEyeA, uEyeB;', vertexBody: 'col.a *= size > 0.2 ? uEyeA : uEyeB;' });
    this.eye.set(0, EYE[0], EYE[1], EYE[2], 0.38, 0.6, 2.2, 0.6, 1);
    this.eye.set(1, EYE[0], EYE[1], EYE[2], 0.12, 1.6, 1.8, 1.6, 1);
    this.eye.commit();
    this.root.add(this.eye.points);
    noFade(this.root);
    this.shapes = {};
    // формы частиц — заранее (при фоновой предзагрузке)
    ['side', 'edges', 'full'].forEach((k) => this.shapeFor(k));
  }

  // ---------------------------------------------------------------------------
  buildScreen() {
    const { c, w, h } = SCREEN;
    this.screen = new THREE.Group();
    this.screen.position.set(...c);
    this.root.add(this.screen);
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color('#062006'), transparent: true, opacity: 0.55, depthWrite: false }));
    this.glass.position.z = -0.02;
    this.screen.add(this.glass);
    // рамка экрана
    const r = 0.18, pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(w / 2 - r, h / 2 - r, 0); corner(-w / 2 + r, h / 2 - r, Math.PI / 2); corner(-w / 2 + r, -h / 2 + r, Math.PI); corner(w / 2 - r, -h / 2 + r, Math.PI * 1.5);
    this.frame = new FatLines(pts.length, { width: 3.4, color: '#bfffb6', intensity: 0.85, fade: this.fade });
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; this.frame.setEdge(i, [p[0], p[1], 0], [q[0], q[1], 0]); });
    this.frame.commit();
    this.screen.add(this.frame.mesh);
    // полоска
    this.barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9ffe4').multiplyScalar(1.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 2.35), this.barMat);
    this.bar.position.z = 0.02;
    this.screen.add(this.bar);
    this.barGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.9), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: this.softTex() }));
    this.barGlow.position.z = 0.01;
    this.screen.add(this.barGlow);
    // «взгляд» кошки на экран
    this.gaze = new FatLines(2, { width: 2.2, color: '#00ff00', intensity: 0.9, opacity: 0.35, fade: this.fade });
    this.gaze.setEdge(0, EYE, [c[0] - w / 2, c[1] + h / 2 - 0.1, 0]);
    this.gaze.setEdge(1, EYE, [c[0] - w / 2, c[1] - h / 2 + 0.1, 0]);
    this.gaze.commit();
    this.root.add(this.gaze.mesh);
  }

  softTex() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 64, 2, 32, 64, 60);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 128);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  panelPos(col, row) {
    return [PANEL.c[0] + (col - 2.5) * PANEL.dx, PANEL.c[1] + (0.5 - row) * PANEL.dy, 0];
  }

  buildPanel() {
    // нейроны «зрительной коры»: 6 столбцов (углы) × 2. Матрицы статичны; размер и яркость — в шейдере
    // по uniform'ам (возбуждение каждого нейрона uFire[i] сглаживается на CPU — это 12 чисел, а не буфер)
    this.fire = new Float32Array(12);
    this.neuU = { uFire: { value: this.fire }, uPk: { value: 1 }, uSpike: { value: 0 }, uAi: { value: 0 } };
    this.neuMat = orbMaterial({
      color: '#00ff00', intensity: 1, fill: 0.18, rim: 1.3, core: 0.08, fade: this.fade, uniforms: this.neuU,
      vertexHead: 'attribute vec2 aN; uniform float uFire[12]; uniform float uPk, uSpike, uAi;',
      vertexBody: `
        float fire = uFire[int(aN.x + 0.5)];
        float match = abs(aN.y - uAi) < 0.5 ? 1.0 : 0.0;
        s = vec3(0.3 * (0.25 + 0.75 * uPk) * (1.0 + 0.35 * fire + 0.25 * uSpike * match));
        tint = vec3(uPk * (0.35 + 1.6 * fire + 1.2 * uSpike * match));`,
    });
    this.neurons = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 28, 20), this.neuMat, 12);
    this.neurons.frustumCulled = false;
    for (let i = 0; i < 12; i++) { const [x, y] = this.panelPos(i % 6, Math.floor(i / 6)); setInstance(this.neurons, i, x, y, 0, 1); }
    instAttr(this.neurons, 'aN', 2, Array.from({ length: 12 }, (_, i) => [i, i % 6]).flat());
    this.root.add(this.neurons);
    // значки ориентации над столбцами
    const icoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dcffd6'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.icons = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.62), icoMat, 6);
    this.icons.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    ANGLES.forEach((a, i) => {
      const [x, y] = this.panelPos(i, 0);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(a));
      p.set(x, y + 0.98, 0);
      m.compose(p, q, sc);
      this.icons.setMatrixAt(i, m);
    });
    this.root.add(this.icons);
    // рамка панели
    const W = PANEL.dx * 6 + 0.1, H = PANEL.dy * 2 + 1.2;
    const cx = PANEL.c[0], cy = PANEL.c[1] + 0.32;
    const pts = [[cx - W / 2, cy - H / 2], [cx + W / 2, cy - H / 2], [cx + W / 2, cy + H / 2], [cx - W / 2, cy + H / 2]];
    this.panelFrame = new FatLines(4, { width: 2.4, color: '#7dff6e', intensity: 0.6, opacity: 0.6, fade: this.fade });
    pts.forEach((a, i) => { const b = pts[(i + 1) % 4]; this.panelFrame.setEdge(i, [a[0], a[1], -0.1], [b[0], b[1], -0.1]); });
    this.panelFrame.commit();
    this.root.add(this.panelFrame.mesh);
  }

  buildKernels() {
    // 12 ядер 5×5: 6 углов × (полоска, перепад)
    const N = 5, px = 0.155;
    this.kernels = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 6; col++) {
        const th = THREE.MathUtils.degToRad(ANGLES[col]);
        const vals = [];
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const x = i - (N - 1) / 2, y = (N - 1) / 2 - j;
            const d = x * Math.cos(th) + y * Math.sin(th);    // поперёк полоски (0° — вертикальная)
            const along = -x * Math.sin(th) + y * Math.cos(th);
            const g = Math.exp(-(d * d + along * along * 0.35) / 5.5);
            const v = row === 0 ? Math.cos(d * 1.45) * g : Math.sin(d * 1.25) * g * 1.25;
            vals.push(v);
          }
        }
        // точка на контуре мордочки с такой же касательной
        const cp = contourPointForAngle(ANGLES[col] + 90, row).p;
        const fx = FACE.c[0] + (cp[0] / 512 - 0.5) * FACE.h;
        const fy = FACE.c[1] - (cp[1] / 512 - 0.5) * FACE.h;
        this.kernels.push({ col, row, vals, grid: this.panelPos(col, row), face: [fx, fy, 0.25] });
      }
    }
    // Состояние 12 ядер (центр, масштаб, яркость) считается на CPU и уходит в шейдер uniform-массивами;
    // 300 ячеек и 48 рёбер рамок берут из них свои координаты — буферы экземпляров не перезаливаются.
    this.kState = Array.from({ length: 12 }, () => new THREE.Vector4());   // x, y, z, масштаб
    this.kState2 = Array.from({ length: 12 }, () => new THREE.Vector4());  // появление, яркость ячеек, альфа рамки
    this.kU = { uK: { value: this.kState }, uK2: { value: this.kState2 }, uPx: { value: px } };
    const KHEAD = 'uniform vec4 uK[12]; uniform vec4 uK2[12]; uniform float uPx;';
    const geo = new THREE.BoxGeometry(px * 0.86, px * 0.86, 1);
    this.kMat = glowInstancedMaterial({
      color: '#ffffff', fade: this.fade, uniforms: this.kU,
      vertexHead: 'attribute vec4 aCell; ' + KHEAD,
      vertexBody: `
        int ki = int(aCell.x + 0.5);
        vec4 K = uK[ki];
        vec4 K2 = uK2[ki];
        float sc = K.w;
        float v = aCell.w;
        float depth = max(0.02, 0.05 + 0.35 * max(0.0, v)) * sc;
        s = vec3(max(0.001, sc), max(0.001, sc), max(0.001, depth));
        offset = vec3(K.x + aCell.y * uPx * sc, K.y + aCell.z * uPx * sc, K.z + depth * 0.5);
        float pos = max(0.0, v), neg = max(0.0, -v);
        float b = (0.04 + 0.78 * pos) * K2.y;
        tint = neg > 0.05 ? vec3(0.02, 0.06 + 0.05 * (1.0 - neg), 0.02) : vec3(b * (0.35 + 0.65 * pos), b, b * (0.3 + 0.6 * pos));
        tint *= K2.x;`,
    });
    this.kMesh = new THREE.InstancedMesh(geo, this.kMat, 12 * N * N);
    this.kMesh.frustumCulled = false;
    const cells = new Float32Array(12 * N * N * 4);
    let idx = 0;
    this.kernels.forEach((K, k) => {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          cells.set([k, i - (N - 1) / 2, (N - 1) / 2 - j, K.vals[j * N + i]], idx * 4);
          idx++;
        }
      }
    });
    instAttr(this.kMesh, 'aCell', 4, cells);
    this.root.add(this.kMesh);
    // рамки ядер: в position — (ядро, угол начала), в aB — (ядро, угол конца); координаты — в шейдере
    this.kFrames = new FatLines(12 * 4, {
      width: 2.2, color: '#9dff8f', intensity: 0.9, fade: this.fade, uniforms: this.kU,
      vertexHead: KHEAD,
      vertexBody: `
        int ki = int(position.x + 0.5);
        vec4 K = uK[ki];
        float h = 2.5 * uPx * K.w + 0.03 * K.w;
        float c0 = position.y, c1 = aB.y;
        pa = vec3(K.x + (c0 < 0.5 || c0 > 2.5 ? -h : h), K.y + (c0 < 1.5 ? -h : h), K.z);
        pb = vec3(K.x + (c1 < 0.5 || c1 > 2.5 ? -h : h), K.y + (c1 < 1.5 ? -h : h), K.z);
        data.w = uK2[ki].z;`,
    });
    for (let k = 0; k < 12; k++) for (let e = 0; e < 4; e++) this.kFrames.setEdge(k * 4 + e, [k, e, 0], [k, (e + 1) % 4, 0]);
    this.kFrames.commit();
    this.root.add(this.kFrames.mesh);
  }

  buildArc() {
    // сигнал от затылка кошки к «коре»
    const A = new THREE.Vector3(CAT.c[0] - 0.2, CAT.c[1] + CAT.h * 0.37, 0.2);
    const B = new THREE.Vector3(PANEL.c[0] - PANEL.dx * 3 - 0.15, PANEL.c[1] + 1.35, 0);
    const C = new THREE.Vector3((A.x + B.x) / 2 - 0.5, 3.15, 0.3);
    const crv = new THREE.QuadraticBezierCurve3(A, C, B);
    const n = 60;
    const pts = crv.getSpacedPoints(n);
    let L = 0;
    for (let i = 0; i < n; i++) L += pts[i].distanceTo(pts[i + 1]);
    this.arc = new FatLines(n, {
      width: 2.6, color: '#7dff6e', intensity: 1.0, fade: this.fade, fragment: DASH_FRAG,
      uniforms: { uHot: { value: new THREE.Color('#00ff00').multiplyScalar(2.4) }, uPulse: { value: -1 } },
    });
    let s = 0;
    for (let i = 0; i < n; i++) {
      const l = pts[i].distanceTo(pts[i + 1]);
      this.arc.setEdge(i, pts[i].toArray(), pts[i + 1].toArray());
      this.arc.setData(i, s, 1, l, L);
      s += l;
    }
    this.arc.commit();
    this.root.add(this.arc.mesh);
  }

  // ---------------------------------------------------------------------------
  // Формы частиц
  space(r) {
    return (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) S.setPoint(s, i, r.range(-30, 30), r.range(-16, 16), -r.range(4, 34), r.range(0.4, 1.1), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.2));
      return s;
    };
  }

  sideShape(n) {
    const r = rng(17);
    const cnv = catSideCanvas();
    const edges = silhouetteEdges(cnv);
    const W = CAT.h * (cnv.width / cnv.height);
    const k = W / cnv.width;
    const toW = (x, y) => [CAT.c[0] + (x - cnv.width / 2) * k, CAT.c[1] - (y - cnv.height / 2) * k];
    const parts = [
      { weight: 0.44, shape: (m) => {
        const s = S.createShape(m);
        for (let i = 0; i < m; i++) {
          const [x, y] = edges[Math.floor(r() * edges.length)];
          const [wx, wy] = toW(x + r.gauss(0, 1.2), y + r.gauss(0, 1.2));
          const cc = r() < 0.3 ? S.PAL.greenHi : r() < 0.55 ? S.PAL.mint : S.PAL.white;
          S.setPoint(s, i, wx, wy, r.gauss(0, 0.12), r.range(0.5, 1.1), cc, r.range(0.35, 0.7));
        }
        return s;
      } },
      { weight: 0.2, shape: (m) => {
        const f = S.fromCanvas(m, cnv, { width: W, depth: 0.7, size: 0.7, alpha: 0.1, color: S.PAL.green, seed: 5 });
        return S.transform(f, { position: [CAT.c[0], CAT.c[1], 0] });
      } },
      { weight: 0.36, shape: this.space(r) },
    ];
    return S.combine(n, parts);
  }

  faceShape(n, full) {
    const r = rng(full ? 23 : 29);
    const strokes = catFaceCanvas({ strokes: true });
    const parts = [
      { weight: full ? 0.46 : 0.62, shape: (m) => {
        const f = S.fromCanvas(m, strokes, { width: FACE.h, depth: 0.25, size: 0.85, alpha: 0.6, jitter: 1.2, colorFn: (x, y, rr) => (rr() < 0.35 ? S.PAL.greenHi : rr() < 0.6 ? S.PAL.mint : S.PAL.white), seed: 41 });
        return S.transform(f, { position: [FACE.c[0], FACE.c[1], 0] });
      } },
    ];
    if (full) {
      const fill = catFaceCanvas({ strokes: false, fill: true, eyes: true });
      parts.push({ weight: 0.2, shape: (m) => {
        const f = S.fromCanvas(m, fill, { width: FACE.h, depth: 0.5, size: 0.7, alpha: 0.16, threshold: 0.3, colorFn: (x, y, rr) => (rr() < 0.5 ? S.PAL.green : S.PAL.mint), seed: 43 });
        return S.transform(f, { position: [FACE.c[0], FACE.c[1], -0.05] });
      } });
    }
    parts.push({ weight: full ? 0.34 : 0.38, shape: this.space(r) });
    return S.combine(n, parts);
  }

  shapeFor(key) {
    const n = this.ctx.particles.count;
    const k = key + ':' + n;
    if (!this.shapes[k]) this.shapes[k] = ready(key === 'side' ? this.sideShape(n) : this.faceShape(n, key === 'full'));
    return this.shapes[k];
  }

  // ---------------------------------------------------------------------------
  camera(state, step) {
    // для 16:9; под 4:3/16:10 подгоняет ядро (director.fitPose)
    return step >= 2 ? { pos: [1.2, -0.15, 13.2], target: [1.2, -0.35, 0], fov: 45 } : { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 };
  }

  background(state, step) {
    return step >= 2 ? { glows: [[0.1, -0.05, 0.42, 0.38], [-0.95, -0.6, 0.4, 0.4]], band: null } : 'corners';
  }

  makeLabels() {
    this.removeLabels();
    this.lCortex = this.label({ html: '<span class="b2b-chip is-accent">зрительная кора кошки</span>', position: [PANEL.c[0], PANEL.c[1] + PANEL.dy + 1.1, 0], visible: false });
    this.lFilters = this.label({ html: '<span class="b2b-chip is-map">фильтры свёрточной сети</span>', position: [PANEL.c[0], PANEL.c[1] + PANEL.dy + 1.1, 0], visible: false });
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const d = inst ? 0 : 1;
    phase(this, this.ph, 'kern', step >= 1 ? 1 : 0, { duration: d * 1.6, ease: 'power2.inOut' });
    phase(this, this.ph, 'face', step >= 2 ? 1 : 0, { duration: d * 2.2, ease: 'power2.inOut' });
    phase(this, this.ph, 'panel', step === 0 ? 1 : 0, { duration: d * 0.9 });
    if (step === 0) { this.lCortex.show(); this.lFilters.hide(); } else if (step === 1) { this.lCortex.hide(); this.lFilters.show(); } else { this.lCortex.hide(); this.lFilters.hide(); }
    const p = this.particles;
    this._faceCall?.kill();
    if (step >= 2) {
      p.setParams({ noise: 0.14, swirl: 0, size: 0.062, twinkle: 0.35, spring: 15, damping: 5.5 }, d * 1.2);
      if (inst || this._shape === 'full' || o.dir < 0) {
        p.morph(this.shapeFor('full'), { duration: inst ? 0.01 : 2.2, stagger: 0.5, burst: 10 });
        this._shape = 'full';
      } else {
        p.morph(this.shapeFor('edges'), { duration: 2.0, stagger: 0.55, burst: 14 });
        this._shape = 'edges';
        this._faceCall = this.delay(2.4, () => { p.morph(this.shapeFor('full'), { duration: 1.8, stagger: 0.4, burst: 4 }); this._shape = 'full'; });
      }
    } else {
      p.setParams({ noise: 0.14, swirl: 0, size: 0.06, twinkle: 0.3, spring: 15, damping: 5.5 }, d * 1.2);
      if (this._shape !== 'side') p.morph(this.shapeFor('side'), { duration: inst ? 0.01 : 1.8, stagger: 0.4, burst: 8 });
      this._shape = 'side';
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
    [this.frame, this.gaze, this.panelFrame, this.kFrames, this.arc].forEach((l) => l.resize(this.ctx));
    this.makeLabels();
    this.ph.kern = this.step >= 1 ? 1 : 0;
    this.ph.face = this.step >= 2 ? 1 : 0;
    this.ph.panel = this.step === 0 ? 1 : 0;
    this._shape = null;
    this.t0 = this.ctx.time;
    this.apply(this.step, { ...o, instant: !!o.instant, dir: -1 });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  exit(o = {}) {
    this.lCortex?.hide();
    this.lFilters?.hide();
    return super.exit(o);
  }

  resize() {
    updateShared(this.ctx);
    [this.frame, this.gaze, this.panelFrame, this.kFrames, this.arc].forEach((l) => l.resize(this.ctx));
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const fade = this.fade.value;
    const T = t - this.t0;
    const { kern, face, panel } = this.ph;
    // текущий угол полоски
    const segI = Math.floor(T / SEG);
    const local = T - segI * SEG;
    const ai = ORDER[((segI % 6) + 6) % 6];
    const prevA = ANGLES[ORDER[(((segI - 1) % 6) + 6) % 6]];
    const curA = ANGLES[ai];
    const rot = sstep(0, 0.32, local);
    let da = curA - prevA;
    if (da > 90) da -= 180;
    if (da < -90) da += 180;
    const ang = THREE.MathUtils.degToRad(prevA + da * rot);
    const scr = 1 - face;                       // экран исчезает при сборке мордочки
    this.screen.visible = scr > 0.003;
    this.bar.rotation.z = ang;
    this.barGlow.rotation.z = ang;
    const on = sstep(0.28, 0.42, local) * (1 - sstep(SEG - 0.12, SEG, local) * 0.5);
    this.barMat.opacity = (0.25 + 0.75 * on) * scr * fade;
    this.barGlow.material.opacity = (0.15 + 0.6 * on) * scr * fade;
    this.glass.material.opacity = 0.55 * scr * fade;
    this.frame.uniforms.uOpacity.value = scr;
    this.gaze.uniforms.uOpacity.value = 0.32 * scr * (0.6 + 0.4 * on);
    this.gaze.mesh.visible = scr > 0.003;
    // вспышка «нейрона» после появления полоски
    const spike = bump(local, 0.55, 0.16) + 0.5 * bump(local, 0.85, 0.2);

    // панель «коры»: возбуждение нейронов сглаживаем на CPU (12 чисел → uniform), остальное — в шейдере
    for (let i = 0; i < 12; i++) {
      const col = i % 6;
      const match = col === ai ? 1 : 0;
      const near = Math.abs(col - ai) === 1 || Math.abs(col - ai) === 5 ? 0.18 : 0;
      const target = (match + near) * on;
      this.fire[i] += (target - this.fire[i]) * Math.min(1, dt * 9);
    }
    const nu = this.neuU;
    nu.uPk.value = panel * (1 - kern * 0.999);
    nu.uSpike.value = spike;
    nu.uAi.value = ai;
    this.neurons.visible = panel > 0.003;
    this.icons.material.opacity = Math.max(panel, kern * (1 - face)) * fade * 0.85;
    this.panelFrame.uniforms.uOpacity.value = 0.55 * panel;
    this.panelFrame.mesh.visible = panel > 0.003;
    // дуга «кошка → кора»
    this.arc.uniforms.uTime.value = t;
    this.arc.uniforms.uPulse.value = local > 0.25 && local < 0.75 ? (local - 0.25) / 0.5 : -1;
    this.arc.uniforms.uOpacity.value = 1 - face;
    this.arc.mesh.visible = face < 0.997;

    // ядра свёрточной сети: на CPU — только 12 состояний ядер (uniform-массивы), ячейки и рамки строит шейдер
    const sx = SCREEN.c[0], sy = SCREEN.c[1];
    for (let k = 0; k < this.kernels.length; k++) {
      const K = this.kernels[k];
      const appear = sstep(K.col * 0.06 + K.row * 0.1, K.col * 0.06 + K.row * 0.1 + 0.5, kern);
      const toFace = sstep(K.col * 0.05, K.col * 0.05 + 0.65, face);
      // путь: экран → сетка → контур мордочки
      let x = sx + (K.grid[0] - sx) * appear, y = sy + (K.grid[1] - sy) * appear, z = 0;
      x += (K.face[0] - x) * toFace; y += (K.face[1] - y) * toFace; z += (K.face[2] - z) * toFace;
      // прыжок по дуге во время перелёта на мордочку
      z += Math.sin(toFace * Math.PI) * 1.4;
      const lit = (K.col === ai ? 1 : 0) * on * (1 - toFace);
      const glowK = 1 + 0.7 * lit + 0.5 * bump(toFace, 1, 0.12) * face;
      const fadeK = 1 - 0.55 * sstep(0.85, 1, toFace) * sstep(0.6, 1, face);
      this.kState[k].set(x, y, z, appear * (1 - 0.3 * toFace));
      this.kState2[k].set(appear, glowK * fadeK, appear * (0.55 + 0.45 * lit) * fadeK, 0);
    }
    this.kMesh.visible = kern > 0.003;
    this.kFrames.mesh.visible = kern > 0.003;

    // глаз кошки
    const ea = (1 - face) * fade;
    this.eyeU.uEyeA.value = ea * (0.55 + 0.45 * on);
    this.eyeU.uEyeB.value = ea;
    this.eye.update(this.ctx);

    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = Math.sin(t * 0.3) * 0.04 * face;
    }
  }
}

