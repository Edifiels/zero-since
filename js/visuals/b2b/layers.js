// «От нейрона к таблице»: нейрон → слой → многослойная сеть (сигналы бегут слоями) →
// сеть разворачивается в гигантскую таблицу весов, по которой бегут подсвеченные строки.
// Шаги: 0 — один нейрон (тот же перцептрон, что на предыдущем слайде), 1 — слой, 2 — сеть, 3 — таблица.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { HASH } from '../../core/glsl.js';
import { ready, FatLines, orbMaterial, instAttr, noFade, updateShared, sstep, bump, phase, spaceDust } from './lib.js';
import { PerceptronView, perceptronShape, PERC, CYCLE } from './perceptron.js';

const LAYERS = [3, 5, 7, 7, 5, 2];
const NET_X = [-8.2, -4.9, -1.6, 1.7, 5.0, 8.3];
const SPACING = { 2: 2.2, 3: 1.9, 5: 1.4, 7: 1.0 };

// Таблица весов (плоскость, наклонённая «от зрителя»)
const TABLE = { pos: [0, -1.55, 0], rotX: -1.08, cw: 1.7, ch: 0.74 };

const EDGE_FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uOpacity, uFade, uWave, uWaveOn;
varying vec2 vST;
varying vec4 vData;
void main() {
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vST.x));
  float pos = vData.x + vST.y;
  float d = (pos - uWave) / 0.3;
  float k = exp(-d * d) * uWaveOn;
  vec3 col = uColor * (0.5 + 0.5 * vData.z) + uHot * k;
  float a = e * vData.w * uOpacity * uFade * (0.32 + 0.68 * k + 0.2 * vData.z);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;

const TABLE_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const TABLE_FRAG = /* glsl */ `
uniform sampler2D tAtlas;
uniform float uOpacity, uFade, uTime, uReveal, uCW, uCH;
uniform vec3 uColor, uHot, uCam;
varying vec2 vLocal;
varying vec3 vWorld;
${HASH}
void main() {
  vec2 g = vLocal / vec2(uCW, uCH);
  vec2 id = floor(g);
  vec2 f = fract(g);
  // раскрытие от ближнего края
  float r = length(vLocal * vec2(0.55, 1.0) - vec2(0.0, -2.0));
  float rev = 1.0 - smoothstep(uReveal - 2.5, uReveal, r);
  float fq = (r - uReveal + 1.2) / 1.2;
  float front = exp(-fq * fq) * step(0.001, uReveal) * (1.0 - step(60.0, uReveal));
  // число из атласа (8×8)
  float h = hash12(id + 31.7);
  float idx = floor(h * 64.0);
  vec2 a = vec2(mod(idx, 8.0), floor(idx / 8.0));
  vec2 inner = clamp((f - vec2(0.06, 0.12)) / vec2(0.88, 0.76), 0.0, 1.0);
  vec2 uv = vec2((a.x + inner.x) / 8.0, 1.0 - (a.y + 1.0 - inner.y) / 8.0);
  vec2 gx = dFdx(g) / 8.0, gy = dFdy(g) / 8.0;
  float txt = textureGrad(tAtlas, uv, gx, gy).r;
  // мелкие ячейки (далеко) — без цифр, только ровная «рябь»
  float px = max(length(dFdx(g)), length(dFdy(g)));
  float detail = 1.0 - smoothstep(0.035, 0.09, px);
  txt = mix(0.16, txt, detail);
  // сетка
  vec2 bd = min(f, 1.0 - f) / max(fwidth(g), vec2(1e-4));
  float grid = 1.0 - smoothstep(0.0, 1.4, min(bd.x, bd.y));
  // подсвеченные строки бегут к зрителю
  float row = id.y + uTime * 3.2;
  float band = 0.0;
  float m1 = mod(row, 17.0);
  float q1 = (m1 - 8.0) / 0.9;
  band += exp(-q1 * q1);
  float m2 = mod(row + 6.0, 29.0);
  float q2 = (m2 - 14.0) / 0.8;
  band += 0.7 * exp(-q2 * q2);
  // столбец-«вход»
  float q3 = (id.x - floor(mod(uTime * 1.3, 24.0)) + 12.0) / 0.7;
  float col = exp(-q3 * q3) * 0.35;
  float hot = clamp(band + col, 0.0, 1.4);
  // туман по расстоянию
  float dist = length(vWorld - uCam);
  float fog = 1.0 - smoothstep(16.0, 46.0, dist);
  vec3 c = uColor * (0.1 + 0.9 * txt) + uHot * hot * (0.18 + 0.9 * txt) + uColor * grid * 0.35;
  float alpha = (0.1 + 0.9 * txt + grid * 0.25 + hot * 0.35) * rev * fog;
  c += uHot * front * 0.8;
  alpha = max(alpha, front * 0.5 * fog);
  gl_FragColor = vec4(c, alpha * uOpacity * uFade);
}
`;

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export default class Layers extends Visual {
  static transition = 'morph';

  async init() {
    this.fade = { value: 1 };
    this.ph = { k: 0, table: 0 };
    this.t0 = 0;
    this.view = new PerceptronView(this, this.fade);
    this.root.add(this.view.group);
    this.buildNet();
    this.buildTable();
    noFade(this.root);
    this.shapes = {};
    // формы частиц — заранее (при фоновой предзагрузке)
    for (let s = 0; s < 4; s++) this.shapeFor(s);
  }

  // ---------------------------------------------------------------------------
  buildNet() {
    // узлы
    this.nodes = [];
    LAYERS.forEach((n, L) => { for (let i = 0; i < n; i++) this.nodes.push({ L, i, n }); });
    this.lay = [0, 1, 2, 3].map((s) => this.nodes.map((nd) => this.nodeLayout(s, nd)));
    // Состояние узлов (положение, радиус, видимость, свечение волны) считается на CPU и уходит
    // в шейдер uniform-массивами; сферы и рёбра читают его по индексам — буферы не перезаливаются.
    const NN = this.nodes.length;
    this.nState = Array.from({ length: NN }, () => new THREE.Vector4());   // x, y, z, радиус
    this.nState2 = Array.from({ length: NN }, () => new THREE.Vector4());  // видимость, свечение
    this.nU = { uN: { value: this.nState }, uNA: { value: this.nState2 } };
    const NHEAD = `uniform vec4 uN[${NN}]; uniform vec4 uNA[${NN}];`;
    this.nodeMat = orbMaterial({
      color: '#00ff00', intensity: 1.0, fill: 0.16, rim: 1.25, core: 0.06, fade: this.fade, uniforms: this.nU,
      vertexHead: 'attribute float aIdx; ' + NHEAD,
      vertexBody: `
        int ni = int(aIdx + 0.5);
        vec4 N = uN[ni];
        vec4 NA = uNA[ni];
        s = vec3(max(0.001, N.w * (1.0 + 0.12 * NA.y)));
        offset = N.xyz;
        tint = vec3(NA.x * (0.62 + 0.9 * NA.y));`,
    });
    this.nodeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 32, 22), this.nodeMat, NN);
    this.nodeMesh.frustumCulled = false;
    instAttr(this.nodeMesh, 'aIdx', 1, this.nodes.map((_, i) => i));
    this.root.add(this.nodeMesh);
    // рёбра (полносвязные слои)
    this.edges = [];
    let off = 0;
    const r = rng(7);
    LAYERS.forEach((n, L) => {
      if (L === LAYERS.length - 1) { off += n; return; }
      const next = LAYERS[L + 1];
      for (let a = 0; a < n; a++) for (let b = 0; b < next; b++) this.edges.push({ A: off + a, B: off + n + b, L, w: r() });
      off += n;
    });
    // рёбра — от поверхности до поверхности узлов; концы считает шейдер по индексам узлов (в position.xy)
    this.edgeLines = new FatLines(this.edges.length, {
      width: 2.6, color: '#7dff6e', intensity: 0.75, fade: this.fade, fragment: EDGE_FRAG,
      uniforms: { uHot: { value: new THREE.Color('#00ff00').multiplyScalar(1.6) }, uWave: { value: -5 }, uWaveOn: { value: 0 }, ...this.nU },
      vertexHead: NHEAD,
      vertexBody: `
        int ia = int(position.x + 0.5);
        int ib = int(position.y + 0.5);
        vec4 A = uN[ia];
        vec4 B = uN[ib];
        vec3 dd = B.xyz - A.xyz;
        float el = length(dd);
        float il = 1.0 / max(el, 1e-4);
        pa = A.xyz + dd * ((A.w + 0.05) * il);
        pb = B.xyz - dd * ((B.w + 0.05) * il);
        data.w = min(uNA[ia].x, uNA[ib].x) * step(0.3, el);`,
    });
    this.edges.forEach((e, i) => {
      this.edgeLines.setEdge(i, [e.A, e.B, 0], [e.A, e.B, 0]);
      this.edgeLines.setData(i, e.L, 0.55 + e.w * 0.9, e.w, 0);
    });
    this.edgeLines.commit();
    this.root.add(this.edgeLines.mesh);
  }

  /** Положение узла nd на шаге s (0 — нейрон, 1 — слой, 2 — сеть, 3 — таблица). */
  nodeLayout(s, nd) {
    const { L, i, n } = nd;
    if (s === 0) {
      if (L === 0) return { p: PERC.inputs[i], r: PERC.inR, a: 1 };
      if (L === 1) return { p: PERC.sigma, r: i === 2 ? PERC.sigR : 0.05, a: i === 2 ? 1 : 0 };
      return { p: [12, 0, 0], r: 0.05, a: 0 };
    }
    if (s === 1) {
      if (L === 0) return { p: [-2.6, 2.0 - i * 2.0, 0], r: 0.4, a: 1 };
      if (L === 1) return { p: [2.4, (2 - i) * 1.45, 0], r: 0.46, a: 1 };
      return { p: [12, ((n - 1) / 2 - i) * 1.0, 0], r: 0.05, a: 0 };
    }
    const sp = SPACING[n];
    const p = [NET_X[L], ((n - 1) / 2 - i) * sp, 0];
    return { p, r: L === 0 || L === LAYERS.length - 1 ? 0.4 : 0.36, a: 1 };
  }

  buildTable() {
    // атлас из 64 «весов»
    const W = 2048, H = 1024;
    const cnv = document.createElement('canvas');
    cnv.width = W; cnv.height = H;
    const g = cnv.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 82px "JetBrains Mono"';
    const r = rng(2024);
    for (let k = 0; k < 64; k++) {
      const v = (r() * 2 - 1) * (r() < 0.2 ? 2.4 : 1.1);
      const s = (v < 0 ? '−' : ' ') + Math.abs(v).toFixed(2).replace('.', ','); // десятичная запятая — по-русски
      g.fillText(s, (k % 8) * 256 + 128, Math.floor(k / 8) * 128 + 66);
    }
    this.atlas = new THREE.CanvasTexture(cnv);
    this.atlas.generateMipmaps = true;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.anisotropy = 8;
    this.tableU = {
      tAtlas: { value: this.atlas },
      uOpacity: { value: 0 },
      uFade: this.fade,
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uCW: { value: TABLE.cw },
      uCH: { value: TABLE.ch },
      uColor: { value: new THREE.Color('#d8ffd2').multiplyScalar(0.62) },
      uHot: { value: new THREE.Color('#00ff00').multiplyScalar(1.5) },
      uCam: { value: new THREE.Vector3() },
    };
    this.table = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 170),
      new THREE.ShaderMaterial({
        uniforms: this.tableU,
        vertexShader: TABLE_VERT,
        fragmentShader: TABLE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.table.position.set(...TABLE.pos);
    this.table.rotation.x = TABLE.rotX;
    this.table.visible = false;
    this.root.add(this.table);
  }

  // ---------------------------------------------------------------------------
  // Формы частиц
  shapeFor(step) {
    const n = this.ctx.particles.count;
    const key = step + ':' + n;
    if (this.shapes[key]) return this.shapes[key];
    let s;
    if (step === 0) s = perceptronShape(n);
    else if (step === 3) s = this.tableShape(n);
    else s = this.netShape(n, step);
    this.shapes[key] = ready(s);
    return s;
  }

  netShape(n, step) {
    const r = rng(100 + step);
    const lay = this.lay[step];
    const vis = this.nodes.map((nd, i) => lay[i].a > 0.5);
    const E = this.edges.filter((e) => vis[e.A] && vis[e.B]);
    const nodesIdx = this.nodes.map((_, i) => i).filter((i) => vis[i]);
    const parts = [];
    parts.push({ weight: 0.36, shape: (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) {
        const k = nodesIdx[i % nodesIdx.length];
        const c = lay[k].p, rad = lay[k].r;
        const inner = r() < 0.2;
        const [x, y, z] = inner ? r.inSphere(rad * 0.8) : r.onSphere(rad * (1 + r.gauss(0, 0.05)));
        const cc = r() < 0.3 ? S.PAL.greenHi : r() < 0.5 ? S.PAL.mint : S.PAL.white;
        S.setPoint(s, i, c[0] + x, c[1] + y, c[2] + z, r.range(0.5, 1.1), cc, inner ? 0.12 : 0.4);
      }
      return s;
    } });
    parts.push({ weight: 0.3, shape: (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) {
        const e = E[Math.floor(r() * E.length)];
        const A = lay[e.A].p, B = lay[e.B].p;
        const t = r();
        const sc = 0.03;
        S.setPoint(s, i, A[0] + (B[0] - A[0]) * t + r.gauss(0, sc), A[1] + (B[1] - A[1]) * t + r.gauss(0, sc), A[2] + (B[2] - A[2]) * t + r.gauss(0, sc), r.range(0.35, 0.8), r() < 0.5 ? S.PAL.green : S.PAL.mint, r.range(0.12, 0.35));
      }
      return s;
    } });
    parts.push({ weight: 0.34, shape: spaceDust(S, r) });
    return S.combine(n, parts);
  }

  tableShape(n) {
    // По частице на узел сетки таблицы — только в видимой части (дальше её всё равно скрывает туман).
    // Остальные частицы «паркуются» невидимыми на той же плоскости рядом: если раскидать их до горизонта
    // (±200 ед.), при уходе со слайда они летят обратно несколько секунд — следующая форма собирается с опозданием.
    const COLS = 64, ROWS = 96;
    const nodes = Math.min(n, COLS * ROWS);
    const s = S.createShape(n);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...TABLE.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(TABLE.rotX, 0, 0)), new THREE.Vector3(1, 1, 1));
    const v = new THREE.Vector3();
    const r = rng(33);
    for (let i = 0; i < n; i++) {
      if (i < nodes) {
        const gx = (i % COLS) - COLS / 2, gy = Math.floor(i / COLS) - 12;
        v.set(gx * TABLE.cw, gy * TABLE.ch, 0.02).applyMatrix4(m);
        const hot = r() < 0.08;
        S.setPoint(s, i, v.x, v.y, v.z, hot ? 0.9 : 0.6, hot ? S.PAL.greenHi : S.PAL.mint, hot ? 0.5 : 0.28);
      } else {
        v.set(r.range(-24, 24) * TABLE.cw, r.range(-10, 60) * TABLE.ch, 0.02).applyMatrix4(m);
        S.setPoint(s, i, v.x, v.y, v.z, 0.5, S.PAL.mint, 0);
      }
    }
    s.meta.equalized = true; // сетка равномерная — выравнивание не нужно
    return s;
  }

  // ---------------------------------------------------------------------------
  camera(state, step) {
    const poses = [
      { pos: [4.6, -0.2, 12.6], target: [4.6, -0.2, 0], fov: 45 },
      { pos: [0.2, 0.3, 14], target: [0.2, 0.3, 0], fov: 45 },
      { pos: [0, 0, 16.2], target: [0, 0, 0], fov: 45 },
      { pos: [0, 1.6, 12.2], target: [0, -0.9, 0], fov: 50 },
    ];
    return poses[Math.min(3, step)]; // для 16:9; под 4:3/16:10 подгоняет ядро (director.fitPose)
  }

  background(state, step) {
    if (step === 3) return { glows: [[0.0, -0.75, 0.75, 0.75]], band: null };
    if (step === 2) return 'corners';
    return step === 1 ? 'soft' : { glows: [[0.95, -0.4, 0.55, 0.72], [-0.95, 0.6, 0.3, 0.25]], band: null };
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const from = this.ph.k;
    const dist = Math.abs(step - from);
    phase(this, this.ph, 'k', step, { duration: inst ? 0 : 1.7 + 0.5 * Math.min(2, dist), ease: 'power1.inOut' });
    phase(this, this.ph, 'table', step === 3 ? 1 : 0, { duration: inst ? 0 : step === 3 ? 3.2 : 0.8, delay: step === 3 && !inst ? 0.9 : 0, ease: step === 3 ? 'power1.out' : 'power2.in' });
    const p = this.particles;
    if (step === 3) {
      p.setParams({ noise: 0.05, swirl: 0, size: 0.06, twinkle: 0.45, spring: 14, damping: 5.2 }, inst ? 0 : 1.5);
      p.morph(this.shapeFor(3), { duration: inst ? 0.01 : 2.8, stagger: 0.6, burst: 10 });
      if (!inst) this.ctx.engine.pulse({ aberration: 1.1 }, 1.6);
    } else {
      p.setParams({ noise: 0.16, swirl: 0, size: 0.06, twinkle: 0.3, spring: 15, damping: 5.5 }, inst ? 0 : 1.2);
      p.morph(this.shapeFor(step), { duration: inst ? 0.01 : 2.2, stagger: 0.5, burst: step === 0 ? 8 : 12 });
    }
    this.view.showLabels(step === 0);
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
    this.edgeLines.resize(this.ctx);
    this.view.edges.resize(this.ctx);
    this.view.gauge.resize(this.ctx);
    this.removeLabels();
    this.view.makeLabels();
    this.ph.k = this.step;
    this.ph.table = this.step === 3 ? 1 : 0;
    this.t0 = this.ctx.time;
    this.apply(this.step, { ...o, instant: true });
    // частицы при входе — плавно (а не мгновенно), если это не мгновенный переход
    if (!o.instant) {
      const p = this.particles;
      p.morph(this.shapeFor(this.step), { duration: 2.2, stagger: 0.5, burst: 8 });
    }
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  exit(o = {}) {
    this.view.showLabels(false);
    return super.exit(o);
  }

  resize() {
    updateShared(this.ctx);
    this.edgeLines.resize(this.ctx);
    this.view.edges.resize(this.ctx);
    this.view.gauge.resize(this.ctx);
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const k = this.ph.k;
    const tt = (t - this.t0) % CYCLE;
    // перцептрон — только около шага 0
    const pv = 1 - sstep(0.02, 0.22, k);
    this.view.set(1, pv);
    this.view.update(tt, true);

    // узлы сети
    const seg = Math.min(2, Math.floor(k));
    const fr = k - seg;
    const A = this.lay[seg], B = this.lay[seg + 1];
    const netA = sstep(0.0, 0.18, k) * (1 - sstep(2.04, 2.36, k));
    const wave = ((t - this.t0) * 2.2) % (LAYERS.length + 2.5) - 0.8;
    const waveOn = sstep(0.6, 1.0, k) * (1 - sstep(2.0, 2.4, k));
    // узлы: только состояние (uniform-массивы); сферы и рёбра строит шейдер
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      const d = (nd.L / (LAYERS.length - 1)) * 0.45 + (nd.i / Math.max(1, nd.n - 1)) * 0.08;
      const u = ease(Math.min(1, Math.max(0, (fr - d) / 0.47)));
      const a0 = A[i], b0 = B[i];
      this.nState[i].set(
        a0.p[0] + (b0.p[0] - a0.p[0]) * u,
        a0.p[1] + (b0.p[1] - a0.p[1]) * u,
        a0.p[2] + (b0.p[2] - a0.p[2]) * u,
        a0.r + (b0.r - a0.r) * u,
      );
      // волна подсвечивает слой, но узлы должны оставаться различимыми (без сплошного «столба» свечения)
      this.nState2[i].set((a0.a + (b0.a - a0.a) * u) * netA, waveOn * bump(wave, nd.L, 0.45), 0, 0);
    }
    const L = this.edgeLines;
    L.uniforms.uWave.value = wave;
    L.uniforms.uWaveOn.value = waveOn;
    this.nodeMesh.visible = netA > 0.002;
    L.mesh.visible = netA > 0.002;

    // таблица
    const tb = this.ph.table;
    this.table.visible = tb > 0.002;
    if (this.table.visible) {
      const u = this.tableU;
      u.uOpacity.value = sstep(0, 0.25, tb);
      u.uReveal.value = 2 + tb * 70;
      u.uTime.value = t;
      u.uCam.value.copy(this.ctx.camera.position);
    }
    if (this.ownsParticles()) this.particles.object.rotation.y = 0;
  }
}
