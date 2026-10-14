// «Схема атаки июля 2026»: «Тест на кибернавыки» → «Песочница OpenAI» → «Уязвимость» → «Интернет» →
// «Hugging Face: база с ответами». Импульс бежит по связям по клику; в конце ответы летят обратно к тесту,
// штамп «Списал» и лодка из «Гонки» (визуальная рифма) крутит восьмёрки.
// Состояния: 'intro' — крупно база Hugging Face под атакой (вопрос №9; шаг 1 — база вскрыта, видны ответы);
//            'scheme' — вся цепочка, шаги 0–5.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import {
  HEX, toColor, holoMaterial, glassMaterial, glowSprite, glowMaterial, fatLines, polyline, edgePairs,
  Trail, shockRing, flowMaterial, Fader, canvasTexture, roundRect, texPlane, lbl, build,
  setCell, setLineResolution, pointCloud, loadLand, lonLat, keyed,
} from './kit.js';

const V3 = (a) => new THREE.Vector3(...a);
const NODES = [
  { key: 'test', p: [-9.0, 1.0, 0], title: 'Тест на<br>кибернавыки', below: false },
  { key: 'sandbox', p: [-4.5, -1.35, 1.0], title: 'Песочница OpenAI', below: true },
  { key: 'vuln', p: [0, 1.0, 0], title: 'Уязвимость', below: false, danger: true },
  { key: 'net', p: [4.6, -1.35, 1.0], title: 'Интернет', below: true },
  { key: 'hf', p: [9.9, 1.0, -0.4], title: 'Hugging Face', sub: 'база с ответами', below: true },
];
const LINK_COLORS = [HEX.greenHi, HEX.greenHi, HEX.red, HEX.red];
const INTRO_BG = { glows: [[0.78, 0.3, 0.5, 0.7], [0.95, -0.5, 0.45, 0.45]], band: null, tint: 'red' };
const BOAT_C = { x: -8.9, z: 2.6, y: -1.9 };

// ---------------------------------------------------------------------------
// Частицы: потоки вдоль связей, обратная дуга, фоновая «паутина интернета»
// ---------------------------------------------------------------------------
const SHAPES = new Map();
let LINK_CURVES = null;
let RETURN_CURVE = null;

function linkCurves() {
  if (LINK_CURVES) return LINK_CURVES;
  LINK_CURVES = [];
  for (let i = 0; i < 4; i++) {
    const A = V3(NODES[i].p), B = V3(NODES[i + 1].p);
    const d = B.clone().sub(A).normalize();
    const a = A.clone().addScaledVector(d, 1.45);
    const b = B.clone().addScaledVector(d, -1.6);
    const c = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.75, 0.9));
    LINK_CURVES.push(new THREE.QuadraticBezierCurve3(a, c, b));
  }
  // ответы возвращаются по той же цепочке — через интернет, дыру и песочницу — к тесту
  const pts = [V3(NODES[4].p).add(new THREE.Vector3(0, 2.1, 0.4))];
  for (let i = 3; i >= 0; i--) {
    pts.push(LINK_CURVES[i].getPoint(0.5).add(new THREE.Vector3(0, 0.25, 0.7)));
    pts.push(V3(NODES[i].p).add(new THREE.Vector3(i === 0 ? 0.25 : 0, i === 0 ? 0.1 : 0.15, i === 0 ? 0.9 : 1.7)));
  }
  RETURN_CURVE = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  return LINK_CURVES;
}

function streamPart(m, k, lit, seed) {
  const s = S.createShape(m), r = rng(seed);
  const crv = linkCurves()[k];
  const v = new THREE.Vector3();
  const base = k < 2 ? S.PAL.green : S.PAL.red;
  for (let i = 0; i < m; i++) {
    const t = r();
    crv.getPoint(t, v);
    const sc = 0.08 + 0.18 * Math.sin(Math.PI * t);
    const c = lit ? (r() < 0.25 ? S.PAL.bright : base) : S.PAL.dim;
    S.setPoint(s, i, v.x + r.gauss(0, sc), v.y + r.gauss(0, sc), v.z + r.gauss(0, sc), r.range(0.5, 1.2), c, lit ? r.range(0.35, 0.8) : r.range(0.05, 0.14));
  }
  return s;
}

function returnPart(m, on, seed = 61) {
  linkCurves();
  const s = S.createShape(m), r = rng(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < m; i++) {
    if (on) {
      const t = r();
      RETURN_CURVE.getPoint(t, v);
      const sc = 0.12 + 0.2 * Math.sin(Math.PI * t);
      const c = r() < 0.35 ? S.PAL.bright : S.PAL.greenHi;
      S.setPoint(s, i, v.x + r.gauss(0, sc), v.y + r.gauss(0, sc), v.z + r.gauss(0, sc), r.range(0.5, 1.1), c, r.range(0.25, 0.6));
    } else {
      // «припаркованы» далеко в фоне и почти невидимы
      S.setPoint(s, i, r.range(-26, 26), r.range(-12, 14), r.range(-34, -18), r.range(0.4, 0.8), S.PAL.white, r.range(0.02, 0.08));
    }
  }
  return s;
}

function webPart(m, bright, graph) {
  const w = S.cosmicWeb(m, { graph, brightness: bright ? 0.8 : 0.45 });
  if (!bright) S.fade(w, 0.7);
  return S.transform(w, { position: [0, 0.8, -15], rotation: [0.1, 0, 0], scale: [2.0, 1.55, 1.0] });
}

function vortexPart(m, seed = 71) {
  // спиральный вихрь вокруг базы Hugging Face (в координатах относительно базы)
  const s = S.createShape(m), r = rng(seed);
  for (let i = 0; i < m; i++) {
    const t = r();
    const rad = 1.7 + t * 1.7 + r.gauss(0, 0.1);
    const a = t * 9.5 + r.gauss(0, 0.25) + (i % 3) * 2.094;
    const y = r.gauss(0, 0.18) + Math.sin(a * 0.5) * 0.35 - 0.2;
    const c = r() < 0.18 ? S.PAL.red : r() < 0.35 ? S.PAL.bright : S.PAL.green;
    S.setPoint(s, i, Math.cos(a) * rad, y, Math.sin(a) * rad, r.range(0.5, 1.3), c, r.range(0.25, 0.7) * (1 - t * 0.5));
  }
  return s;
}

// Части форм кэшируются по (имя, число точек) — формы шагов собираются из готовых кусков.
const PARTS = new Map();
const memo = (key, m, fn) => {
  const k = key + ':' + m;
  if (!PARTS.has(k)) PARTS.set(k, fn());
  const s = PARTS.get(k);
  // combine() может трансформировать часть — отдаём копию
  return { count: s.count, positions: s.positions.slice(), colors: s.colors.slice(), meta: {} };
};
let GRAPH = null;
const graph = () => GRAPH || (GRAPH = S.webGraph({ seed: 12, nodes: 54, extent: 9 }));

function schemeShape(n, step) {
  const lvl = Math.min(4, step);
  const key = `${n}:s${lvl}:${step >= 5 ? 1 : 0}`;
  if (SHAPES.has(key)) return SHAPES.get(key);
  const s = S.combine(n, [
    ...[0, 1, 2, 3].map((k) => ({ weight: 0.065, shape: (m) => memo(`st${k}${lvl > k ? 1 : 0}`, m, () => streamPart(m, k, lvl > k, 11 + k)) })),
    { weight: 0.09, shape: (m) => memo(`ret${step >= 5 ? 1 : 0}`, m, () => returnPart(m, step >= 5)) },
    { weight: 0.65, shape: (m) => memo(`web${lvl >= 3 ? 1 : 0}`, m, () => webPart(m, lvl >= 3, graph())) },
  ]);
  SHAPES.set(key, s);
  return s;
}

function introShape(n) {
  const key = n + ':intro';
  if (SHAPES.has(key)) return SHAPES.get(key);
  const hf = V3(NODES[4].p);
  const s = S.combine(n, [
    { weight: 0.35, shape: (m) => vortexPart(m) },
    { weight: 0.65, shape: (m) => S.transform(memo('web0', m, () => webPart(m, false, graph())), { position: [-hf.x, -hf.y, -hf.z] }) },
  ]);
  SHAPES.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Текстуры
// ---------------------------------------------------------------------------
function testTexture() {
  return canvasTexture(512, 660, (g, w, h) => {
    g.fillStyle = '#eef7ee';
    roundRect(g, 0, 0, w, h, 26); g.fill();
    g.fillStyle = '#0a2a0a';
    g.font = '800 72px Unbounded';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ТЕСТ', w / 2, 86);
    g.fillStyle = 'rgba(10,42,10,.35)';
    g.fillRect(60, 140, w - 120, 6);
    for (let i = 0; i < 4; i++) {
      const y = 205 + i * 112;
      g.strokeStyle = '#0a2a0a'; g.lineWidth = 7;
      roundRect(g, 56, y - 30, 60, 60, 10); g.stroke();
      g.fillStyle = 'rgba(10,42,10,.3)';
      roundRect(g, 140, y - 22, (w - 200) * (0.6 + 0.4 * ((i * 37) % 10) / 10), 18, 9); g.fill();
      roundRect(g, 140, y + 8, (w - 200) * 0.45, 14, 7); g.fill();
    }
  });
}
function checkTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.strokeStyle = '#00ff00'; g.lineWidth = 20; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(20, 66); g.lineTo(52, 98); g.lineTo(110, 26); g.stroke();
  });
}
function answersTexture() {
  return canvasTexture(512, 600, (g, w, h) => {
    g.fillStyle = '#f2fff0';
    roundRect(g, 0, 0, w, h, 26); g.fill();
    g.strokeStyle = '#00b400'; g.lineWidth = 10;
    roundRect(g, 8, 8, w - 16, h - 16, 22); g.stroke();
    g.fillStyle = '#063d06';
    g.font = '800 64px Unbounded';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ОТВЕТЫ', w / 2, 82);
    for (let i = 0; i < 4; i++) {
      const y = 190 + i * 100;
      g.strokeStyle = '#00b400'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(60, y); g.lineTo(84, y + 24); g.lineTo(126, y - 26); g.stroke();
      g.fillStyle = 'rgba(6,61,6,.35)';
      roundRect(g, 160, y - 12, (w - 220) * (0.55 + 0.45 * ((i * 53) % 10) / 10), 24, 12); g.fill();
    }
  });
}

// ---------------------------------------------------------------------------
// Запасная лодка (если модель из b5a недоступна)
// ---------------------------------------------------------------------------
class FallbackBoat {
  constructor({ scale = 1 } = {}) {
    this.object = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-0.18, -0.5); s.lineTo(0.18, -0.5); s.lineTo(0.2, 0.1); s.quadraticCurveTo(0.15, 0.4, 0, 0.55); s.quadraticCurveTo(-0.15, 0.4, -0.2, 0.1); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false });
    g.rotateX(Math.PI / 2); g.translate(0, 0.16, 0);
    const hull = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe9eee9, roughness: 0.35, flatShading: true }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: toColor(HEX.greenHi, 1.4) }));
    stripe.position.set(0, 0.17, 0.05);
    this.body = new THREE.Group();
    this.body.add(hull, stripe);
    this.body.scale.setScalar(scale);
    this.object.add(this.body);
    this.wake = null;
    this._prev = new THREE.Vector3();
  }
  place(pos, tan) { this.object.position.copy(pos); if (tan) this.object.rotation.y = Math.atan2(tan.x, tan.z); }
  update(dt, t) { this.body.position.y = Math.sin(t * 3) * 0.01; }
  resetWake() {}
}
function fallbackEight(u, { a = 1.6, b = 0.8, cx = 0, cz = 0, y = 0 } = {}, out = new THREE.Vector3(), tan = null) {
  const s = Math.sin(u), c = Math.cos(u);
  out.set(cx + a * s, y, cz + b * Math.sin(2 * u));
  if (tan) tan.set(a * c, 0, 2 * b * Math.cos(2 * u)).normalize();
  return out;
}

// ---------------------------------------------------------------------------
export default class Attack extends Visual {
  static transition = 'glitch';

  async init() {
    const ctx = this.ctx;
    this.fader = new Fader();
    this.kt = keyed(this);
    this.scaleU = ctx.particles.uniforms.uScale;
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    linkCurves();

    // модель лодки из части b5a (если есть)
    try {
      const mod = await import('../b5a/boat-model.js');
      this.BoatCls = mod.Boat || FallbackBoat;
      this.eight = mod.figureEight || fallbackEight;
    } catch (err) {
      this.BoatCls = FallbackBoat;
      this.eight = fallbackEight;
    }
    const land = await loadLand();

    this.st = {
      lit: [0, 0, 0, 0, 0],    // подсветка узлов
      link: [0, 0, 0, 0],      // доля горящей связи
      lock: 0,                 // замок открыт
      db: 0,                   // база вскрыта
      sheet: 0,                // ответы: 0 — в базе, 1 — над базой
      fly: 0,                  // полёт ответов к тесту
      checks: 0,               // галочки на тесте
      boat: 0,
      others: 1,               // видимость узлов 1–4 (в intro скрыты)
      big: 1,                  // масштаб базы (в intro — крупнее)
      alarm: 0,
    };

    // --- Узлы
    this.nodes = NODES.map((nd, i) => {
      const g = new THREE.Group();
      g.position.set(...nd.p);
      this.root.add(g);
      const inner = new THREE.Group();
      g.add(inner);
      // платформа-кольцо под узлом
      const ring = [];
      for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; ring.push([Math.cos(a) * 1.35, -1.45, Math.sin(a) * 1.35]); }
      const base = fatLines(polyline(ring), { color: nd.danger ? HEX.red : HEX.greenHi, k: 1.2, width: 2.6 });
      g.add(base);
      const halo = glowSprite(nd.danger ? HEX.red : HEX.greenHi, 4.6, 0.4, 0.0);
      halo.material.userData.noFade = true;
      halo.position.z = -0.6;
      g.add(halo);
      const hit = shockRing(nd.danger ? HEX.red : HEX.greenHi, 2.4, 6);
      g.add(hit);
      return { g, inner, base, halo, hit, data: nd, idx: i, baseH: this.fader.add(base, 0.3), pop: { s: 1 } };
    });
    this.buildTest(this.nodes[0]);
    this.buildSandbox(this.nodes[1]);
    this.buildLock(this.nodes[2]);
    this.buildGlobe(this.nodes[3], land);
    this.buildDB(this.nodes[4]);

    // --- Связи
    this.links = LINK_CURVES.map((crv, i) => {
      const mat = flowMaterial({ color: LINK_COLORS[i], k: 1.5, dim: i < 2 ? '#2c5a2c' : '#5a2a26', base: 0.5, dash: 7, flow: 0.9, headK: 3.5 });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(crv, 90, 0.09, 10, false), mat);
      this.root.add(tube);
      const tan = crv.getTangent(1);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 18), glowMaterial(LINK_COLORS[i], 1.6, 1));
      cone.material.userData.noFade = true;
      cone.position.copy(crv.getPoint(1)).addScaledVector(tan, 0.2);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      this.root.add(cone);
      return { tube, mat, cone, crv };
    });

    // --- Импульс-комета
    this.packet = new THREE.Group();
    this.packet.add(glowSprite('#ffffff', 1.4, 2.2));
    this.packet.add(glowSprite(HEX.greenHi, 3.2, 1.0));
    this.packet.visible = false;
    this.root.add(this.packet);
    this.trail = new Trail(44, { color: HEX.greenHi, k: 1.8, size: 0.42, scale: this.scaleU });
    this.trail.uniforms.uShow.value = 0;
    this.root.add(this.trail.points);
    this.run = { k: 0, link: -1 };

    // --- Обратный полёт ответов (шаг 5)
    this.retMat = flowMaterial({ color: HEX.greenHi, k: 1.4, dim: '#103010', base: 0.0, dash: 12, flow: -1.2, headK: 3 });
    this.retTube = new THREE.Mesh(new THREE.TubeGeometry(RETURN_CURVE, 240, 0.06, 8, false), this.retMat);
    this.root.add(this.retTube);

    // --- Лодка из «Гонки» и «пруд» с бонусами
    this.boatG = new THREE.Group();
    this.boatG.position.set(BOAT_C.x, BOAT_C.y, BOAT_C.z);
    this.root.add(this.boatG);
    this.boatG.rotation.x = 0.5;
    this.boat = new this.BoatCls({ scale: 1.7 });
    this.boatG.add(this.boat.object);
    if (this.boat.wake) this.boatG.add(this.boat.wake);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.7, 64), new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uShow: { value: 1 }, uTime: { value: 0 }, uColor: { value: toColor(HEX.green, 0.9) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uOpacity, uShow, uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
          float rings = 0.5 + 0.5 * sin(r * 26.0 - uTime * 2.4);
          float a = (1.0 - smoothstep(0.75, 1.0, r)) * (0.1 + 0.16 * rings) + exp(-(r - 0.98) * (r - 0.98) * 900.0) * 0.6;
          gl_FragColor = vec4(uColor, a * uOpacity * uShow); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.pondU = pond.material.uniforms;
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.0, 0.62, 1);
    pond.position.y = -0.02;
    this.boatG.add(pond);
    this.bonuses = [-1, 1].map((sx) => {
      const b = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 10, 28), glowMaterial(HEX.greenHi, 1.8));
      b.position.set(sx * 1.15, 0.45, 0);
      this.boatG.add(b);
      return b;
    });
    this.boatH = this.fader.add(this.boatG, 0);
    this.boatU = 0;

    // --- Частицы
    const n = ctx.particles.count;
    for (let s = 0; s <= 5; s++) schemeShape(n, s);
    introShape(n);

    this.labelsMade = false;
  }

  // ---------- Узлы ----------
  buildTest(node) {
    const g = node.inner;
    const frame = new THREE.Mesh(new RoundedBoxGeometry(2.05, 2.6, 0.12, 3, 0.12), holoMaterial({ color: HEX.green, rim: HEX.greenHi, fill: 0.6, rimK: 1.3 }));
    frame.position.z = -0.08;
    g.add(frame);
    const paper = texPlane(testTexture(), 1.86, 2.4, { k: 0.86 });
    paper.position.z = 0.0;
    g.add(paper);
    this.checks = [];
    const ct = checkTexture();
    for (let i = 0; i < 4; i++) {
      const c = texPlane(ct, 0.48, 0.48, { k: 1.6, additive: true });
      c.position.set(-0.52, 0.53 - i * 0.41, 0.05);
      c.scale.setScalar(0.001);
      g.add(c);
      this.checks.push(c);
    }
    node.paper = paper;
  }

  buildSandbox(node) {
    const g = node.inner;
    const box = new THREE.BoxGeometry(2.1, 2.1, 2.1);
    g.add(new THREE.Mesh(box, glassMaterial({ color: HEX.green, k: 0.35, min: 0.03 })));
    g.add(fatLines(edgePairs(box), { color: HEX.greenHi, k: 1.2, width: 2.6 }));
    this.sbOrb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), glowMaterial(HEX.greenHi, 2.2));
    g.add(this.sbOrb);
    const og = glowSprite(HEX.greenHi, 1.8, 1.0);
    this.sbOrb.add(og);
    g.rotation.y = 0.5;
    g.rotation.x = 0.12;
  }

  buildLock(node) {
    const g = node.inner;
    this.lockMat = holoMaterial({ color: '#cfd8cf', rim: '#ffffff', fill: 1.0, rimK: 1.1 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.6, 1.3, 0.55, 4, 0.16), this.lockMat);
    body.position.y = -0.4;
    g.add(body);
    const hole = new THREE.Mesh(build([
      { g: new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16), p: [0, -0.28, 0.27], r: [Math.PI / 2, 0, 0] },
      { g: new THREE.BoxGeometry(0.1, 0.32, 0.1), p: [0, -0.48, 0.27] },
    ]), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    g.add(hole);
    // дужка: U-образная трубка, вращается вокруг правой ножки
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(new THREE.Vector3(-0.48, 0, 0), new THREE.Vector3(-0.48, 0.55, 0)));
    path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.48, 0.55, 0), new THREE.Vector3(0, 1.25, 0), new THREE.Vector3(0.48, 0.55, 0)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(0.48, 0.55, 0), new THREE.Vector3(0.48, 0, 0)));
    this.shackleMat = holoMaterial({ color: '#dfe6df', rim: '#ffffff', fill: 1.1, rimK: 1.2 });
    const shackle = new THREE.Mesh(new THREE.TubeGeometry(path, 48, 0.12, 12, false), this.shackleMat);
    this.shacklePivot = new THREE.Group();
    this.shacklePivot.position.set(0.48, 0.25, 0);
    shackle.position.set(-0.48, 0, 0);
    this.shacklePivot.add(shackle);
    g.add(this.shacklePivot);
    // красные искры при взломе
    this.sparks = pointCloud(160, (i, p, c) => {
      const r = rng(900 + i);
      const [x, y, z] = r.onSphere(1);
      p[0] = x; p[1] = y; p[2] = z; p[3] = r.range(0.6, 1.4);
      const red = toColor(HEX.red, 2.2);
      c[0] = red.r; c[1] = red.g; c[2] = red.b; c[3] = r.range(0.5, 1);
    }, { size: 0.1, scale: this.scaleU });
    this.sparks.visible = false;
    g.add(this.sparks);
    this.sparkT = { k: 1 };
  }

  buildGlobe(node, land) {
    const g = node.inner;
    const R = 1.55;
    const r = rng(404);
    const out = [0, 0, 0];
    const N = 9000;
    const pts = [];
    let guard = 0;
    while (pts.length < N && guard++ < N * 12) {
      const u = r(), v = r();
      const lon = u * 360 - 180, lat = Math.asin(2 * v - 1) * 180 / Math.PI;
      const isL = land.isLand(lon, lat);
      if (!isL && r() > 0.12) continue;
      lonLat(lon, lat, R * (isL ? 1.0 : 0.995), out);
      pts.push([out[0], out[1], out[2], isL]);
    }
    this.globe = pointCloud(pts.length, (i, p, c) => {
      const q = pts[i];
      p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; p[3] = q[3] ? r.range(0.7, 1.3) : 0.5;
      // умеренная альфа: точки на краю глобуса накладываются — иначе «Интернет» выгорает в белое пятно
      const col = q[3] ? (r() < 0.05 ? [1.1, 1.3, 1.1] : [0.1, 0.72, 0.16]) : [0.18, 0.4, 0.22];
      c[0] = col[0]; c[1] = col[1]; c[2] = col[2]; c[3] = q[3] ? 0.5 : 0.2;
    }, { size: 0.085, scale: this.scaleU });
    g.add(this.globe);
    // каркас и орбита
    const wire = [];
    for (let k = 0; k < 6; k++) {
      const pts2 = [];
      for (let j = 0; j <= 48; j++) { const a = (j / 48) * Math.PI * 2; pts2.push([Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, 0]); }
      const pr = polyline(pts2);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k / 6) * Math.PI, 0));
      for (let j = 0; j < pr.length; j += 3) { const v = new THREE.Vector3(pr[j], pr[j + 1], pr[j + 2]).applyQuaternion(q); pr[j] = v.x; pr[j + 1] = v.y; pr[j + 2] = v.z; }
      wire.push(...pr);
    }
    this.globeWire = fatLines(wire, { color: HEX.green, k: 0.7, width: 1.6, opacity: 0.6 });
    g.add(this.globeWire);
    const orbit = [];
    for (let j = 0; j <= 96; j++) { const a = (j / 96) * Math.PI * 2; orbit.push([Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25]); }
    this.orbit = new THREE.Group();
    this.orbit.add(fatLines(polyline(orbit), { color: HEX.greenHi, k: 1.0, width: 2, opacity: 0.8 }));
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), glowMaterial('#ffffff', 2));
    sat.position.set(2.25, 0, 0);
    this.orbit.add(sat);
    this.orbit.rotation.set(0.4, 0, 0.35);
    g.add(this.orbit);
    g.rotation.x = 0.3;
  }

  buildDB(node) {
    const g = node.inner;
    this.dbMat = holoMaterial({ color: HEX.green, rim: '#d8ffd0', fill: 0.85, rimK: 1.2 });
    const discs = [];
    const ringPairs = [];
    for (let i = 0; i < 3; i++) {
      const y = -1.0 + i * 0.62;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.48, 48), this.dbMat);
      d.position.y = y;
      g.add(d);
      discs.push(d);
      for (const yy of [y - 0.24, y + 0.24]) {
        for (let j = 0; j < 64; j++) {
          const a = (j / 64) * Math.PI * 2, b = ((j + 1) / 64) * Math.PI * 2;
          ringPairs.push(Math.cos(a) * 1.16, yy, Math.sin(a) * 1.16, Math.cos(b) * 1.16, yy, Math.sin(b) * 1.16);
        }
      }
    }
    this.dbRings = fatLines(ringPairs, { color: HEX.greenHi, k: 1.25, width: 2.4 });
    g.add(this.dbRings);
    // крышка (поднимается при взломе)
    this.lid = new THREE.Group();
    this.lid.position.y = 0.86;
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.28, 48), this.dbMat);
    this.lid.add(lidMesh);
    const lidRing = [];
    for (let j = 0; j < 64; j++) {
      const a = (j / 64) * Math.PI * 2, b = ((j + 1) / 64) * Math.PI * 2;
      lidRing.push(Math.cos(a) * 1.16, 0.14, Math.sin(a) * 1.16, Math.cos(b) * 1.16, 0.14, Math.sin(b) * 1.16);
    }
    this.lid.add(fatLines(lidRing, { color: HEX.greenHi, k: 1.25, width: 2.4 }));
    g.add(this.lid);
    // лист с ответами
    this.sheet = new THREE.Group();
    const sp = texPlane(answersTexture(), 1.35, 1.58, { k: 0.88 });
    this.sheet.add(sp);
    const sg = glowSprite(HEX.greenHi, 3.4, 0.7);
    sg.position.z = -0.1;
    this.sheet.add(sg);
    this.root.add(this.sheet);
    this.sheetH = this.fader.add(this.sheet, 0);
    // тревога
    this.alarm = glowSprite(HEX.red, 7.5, 0.8, 0);
    this.alarm.material.userData.noFade = true;
    this.alarm.position.z = -0.4;
    g.add(this.alarm);
    this.alarmRing = shockRing(HEX.red, 2.4, 7, 0.06);
    this.alarmRing.rotation.x = -Math.PI / 2;
    this.alarmRing.position.y = -1.3;
    g.add(this.alarmRing);
  }

  makeLabels() {
    if (this.labelsMade) return;
    this.labelsMade = true;
    this.nodes.forEach((n) => {
      const d = n.data;
      n.label = this.label({
        html: lbl(d.title, d.sub || '', 'is-dim' + (d.danger ? ' is-danger' : '')),
        object: n.g,
        offset: d.below ? [0, -1.95, 0] : [0, 2.0, 0],
        anchor: d.below ? 'top' : 'bottom',
        visible: false,
        className: 'b5b-pop',
      });
      n.lblEl = n.label.el.querySelector('.b5b-lbl');
    });
    this.stamp = this.label({ html: '<span class="stamp b5b-stamp" style="--rot:-14deg">Списал</span>', object: this.nodes[0].g, offset: [0.25, 0.1, 1.2], visible: false, className: 'b5b-stamp-wrap' });
  }

  // ---------- Камера и фон ----------
  // Позы — для 16:9; под 4:3/16:10 их подгоняет ядро.
  // intro (вопрос №9): база — справа над карточками ответов; на шаге 1 камера следует за поднятым листом «Ответы».
  camera(state, step) {
    if (state === 'intro') {
      return step >= 1
        ? { pos: [4.6, 0.95, 14.9], target: [4.5, -0.45, -0.4], fov: 42 }
        : { pos: [4.3, 0.3, 14.2], target: [4.2, -1.05, -0.4], fov: 42 };
    }
    return { pos: [0.3, 2.0, 22], target: [0.3, 0.8, 0], fov: 42 };
  }
  background(state, step) {
    if (state === 'intro') return INTRO_BG;
    if (step === 4) return 'danger';
    return 'soft';
  }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state || 'scheme';
    this.step = o.step ?? 0;
    setCell(this.ctx.height * this.ctx.engine.pixelRatio);
    setLineResolution(this.ctx.width, this.ctx.height);
    this.makeLabels();
    this.claimParticles();
    // разовые эффекты могли «застыть», если уход прервал их анимацию
    this.nodes.forEach((n) => { n.hit.visible = false; n.pop.s = 1; });
    this.sparks.visible = false;
    this.applyParticles(true, o.instant);
    this.apply(this.state, this.step, { mode: 'instant' });
    this.labelsFor(this.state, this.step, true);
    return super.enter(o);
  }

  setState(state, o = {}) {
    const prev = this.state;
    this.state = state;
    this.step = o.step ?? 0;
    if (prev !== state) {
      this.ctx.engine.pulse({ glitch: 0.8, aberration: 1.8, scan: 0.5 }, 0.9);
      this.applyParticles(true, false);
    }
    this.apply(state, this.step, { mode: 'anim' });
    this.labelsFor(state, this.step, false);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    const mode = o.instant ? 'instant' : (this.state === 'scheme' && step === prev + 1 && step <= 4 ? 'packet' : 'anim');
    this.apply(this.state, step, { mode, prev });
    this.labelsFor(this.state, step, false);
    this.applyParticles(false, o.instant);
  }

  applyParticles(force, instant) {
    if (!this.ownsParticles()) return;
    const p = this.particles;
    const n = p.count;
    const intro = this.state === 'intro';
    const key = intro ? 'intro' : `s${Math.min(4, this.step)}:${this.step >= 5 ? 1 : 0}`;
    if (!force && key === this._pkey) return;
    this._pkey = key;
    const d = instant ? 0 : 1;
    p.setParams({ noise: intro ? 0.2 : 0.16, swirl: intro ? 0.5 : 0, size: intro ? 0.05 : 0.058, twinkle: 0.35, spring: 15, damping: 5.4 }, d * 1.2);
    p.morph(intro ? introShape(n) : schemeShape(n, this.step), { duration: instant ? 0.01 : (force ? 2.2 : 1.5), stagger: 0.5, burst: force ? 10 : 5, keepSwirl: false });
    const hf = NODES[4].p;
    const pos = intro ? { x: hf[0], y: hf[1], z: hf[2] } : { x: 0, y: 0, z: 0 };
    this.tw(p.object.position, { ...pos, duration: d * 1.8, ease: 'power2.inOut' });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: d * 1.5 });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: d * 1.5 });
  }

  /** Привести сцену к виду (state, step). mode: 'instant' | 'anim' | 'packet' (по клику вперёд — бежит импульс). */
  apply(state, step, { mode = 'anim', prev = -1 } = {}) {
    const st = this.st;
    const I = mode === 'instant';
    const dur = (x) => (I ? 0 : x);
    const intro = state === 'intro';
    const lvl = intro ? 0 : Math.min(4, step);
    // узлы 1–4: в intro скрыты
    const kt = this.kt;
    kt.to('others', st, { others: intro ? 0 : 1, duration: dur(intro ? 0.5 : 1.2), delay: I || intro ? 0 : 0.35 });
    kt.to('big', st, { big: intro ? 1.15 : 1, duration: dur(1.4), ease: 'power2.inOut' });
    // какие узлы горят
    const litTarget = NODES.map((_, i) => (intro ? (i === 4 ? 1 : 0) : (i <= lvl ? 1 : 0)));
    const linkTarget = [0, 1, 2, 3].map((k) => (k < lvl ? 1 : 0));
    if (mode === 'packet' && step >= 1 && step <= 4) {
      const k = step - 1;
      // все предыдущие — сразу; текущая связь — импульсом
      for (let i = 0; i < 5; i++) if (i !== k + 1) kt.to('lit' + i, st.lit, { [i]: litTarget[i], duration: 0.4 });
      for (let j = 0; j < 4; j++) if (j !== k) kt.to('link' + j, st.link, { [j]: linkTarget[j], duration: 0.4 });
      kt.kill('lit' + (k + 1));
      kt.kill('link' + k);
      this.firePacket(k);
    } else {
      this.killPacket();
      for (let i = 0; i < 5; i++) kt.to('lit' + i, st.lit, { [i]: litTarget[i], duration: dur(0.8) });
      for (let j = 0; j < 4; j++) kt.to('link' + j, st.link, { [j]: linkTarget[j], duration: dur(0.9), ease: 'power2.inOut' });
    }
    // спец-состояния узлов
    const lockOpen = !intro && lvl >= 2;
    const dbOpen = intro ? step >= 1 : lvl >= 4;
    const delayNode = mode === 'packet' ? 1.25 : 0;
    kt.to('lock', st, { lock: lockOpen ? 1 : 0, duration: dur(lockOpen ? 0.7 : 0.4), delay: lockOpen && mode === 'packet' && step === 2 ? delayNode : 0, ease: lockOpen ? 'back.out(2.4)' : 'power2.inOut' });
    kt.to('db', st, { db: dbOpen ? 1 : 0, duration: dur(dbOpen ? 0.9 : 0.5), delay: dbOpen && mode === 'packet' && step === 4 ? delayNode + 0.2 : (intro && dbOpen && !I ? 0.25 : 0), ease: dbOpen ? 'back.out(1.6)' : 'power2.inOut' });
    kt.to('alarm', st, { alarm: (intro || lvl >= 4) && !(step >= 5) ? 1 : 0, duration: dur(0.8), delay: !intro && lvl >= 4 && mode === 'packet' ? delayNode : 0 });
    if (lockOpen && mode === 'packet' && step === 2) kt.delay('sparks', delayNode, () => this.burstSparks()); else kt.kill('sparks');
    if (dbOpen && !I && (mode === 'packet' || intro) && (prev < 1 || mode === 'packet')) {
      kt.delay('dbfx', delayNode + 0.2, () => { this.ctx.engine.pulse({ glitch: 0.6, aberration: 1.6, flash: 0.08 }, 0.6); this.ctx.rig.shake(0.18, 0.5); });
    } else kt.kill('dbfx');
    // ответы: поднимаются над базой, на шаге 5 летят к тесту
    const sheetUp = dbOpen || (!intro && step >= 5);
    kt.to('sheet', st, { sheet: sheetUp ? 1 : 0, duration: dur(sheetUp ? 1.0 : 0.4), delay: sheetUp && !I ? delayNode + 0.45 : 0, ease: 'power3.out' });
    kt.to('sheetH', this.sheetH, { show: sheetUp ? 1 : 0, duration: dur(0.6), delay: sheetUp && !I ? delayNode + 0.3 : 0 });
    const ret = !intro && step >= 5;
    if (ret && !I) {
      kt.to('fly', st, { fly: 1, duration: 1.9, delay: 0.2, ease: 'power1.inOut', onComplete: () => this.onAnswersArrive() });
      kt.to('ret', this.retMat.uniforms.uLit, { value: 1, duration: 1.9, delay: 0.2, ease: 'power1.inOut' });
    } else {
      kt.to('fly', st, { fly: ret ? 1 : 0, duration: dur(0.6) });
      kt.to('ret', this.retMat.uniforms.uLit, { value: ret ? 1 : 0, duration: dur(0.5) });
      if (ret) this.onAnswersArrive(true); else this.offAnswers(I);
    }
  }

  firePacket(k) {
    this.killPacket();
    const crv = this.links[k].crv;
    this.run.link = k;
    this.run.k = 0;
    this.trail.reset(crv.getPoint(0, this._v));
    this.trail.uniforms.uColor.value.copy(toColor(LINK_COLORS[k], 1.8));
    this.packet.visible = true;
    this.packetTw = this.tw(this.run, {
      k: 1, duration: 1.25, ease: 'power1.inOut',
      onUpdate: () => { this.st.link[k] = this.run.k; },
      onComplete: () => {
        this.packet.visible = false;
        this.run.link = -1;
        this.st.link[k] = 1;
        this.hitNode(k + 1);
      },
    });
  }

  killPacket() {
    if (this.packetTw) { this.packetTw.kill(); this.packetTw = null; }
    if (this.run.link >= 0) { this.st.link[this.run.link] = 1; this.hitNode(this.run.link + 1, true); }
    this.run.link = -1;
    this.packet.visible = false;
  }

  hitNode(i, quiet = false) {
    const n = this.nodes[i];
    this.kt.to('lit' + i, this.st.lit, { [i]: 1, duration: 0.35 });
    if (quiet) return;
    n.hit.visible = true;
    this.fromTo(n.hit.material.uniforms.uT, { value: 0 }, { value: 1, duration: 1.1, ease: 'power2.out', onComplete: () => { n.hit.visible = false; } });
    this.fromTo(n.pop, { s: 1.22 }, { s: 1, duration: 0.8, ease: 'elastic.out(1, 0.45)' });
    this.ctx.engine.pulse({ aberration: 1.0 }, 0.5);
  }

  burstSparks() {
    this.sparks.visible = true;
    this.fromTo(this.sparkT, { k: 0 }, { k: 1, duration: 1.4, ease: 'power2.out', onComplete: () => { this.sparks.visible = false; } });
    this.ctx.engine.pulse({ glitch: 0.7, aberration: 2 }, 0.7);
    this.ctx.rig.shake(0.15, 0.4);
  }

  onAnswersArrive(instant = false) {
    const st = this.st;
    const kt = this.kt;
    kt.to('checks', st, { checks: 1, duration: instant ? 0 : 0.9, ease: 'power2.out' });
    if (instant) {
      kt.kill('boat'); kt.kill('boatH'); kt.kill('stamp');
      st.boat = 1;
      this.boatH.show = 1;
      this.stamp?.show();
      return;
    }
    this.hitNode(0);
    kt.delay('stamp', 0.45, () => {
      if (this.state !== 'scheme' || this.step < 5) return;
      this.stamp?.show();
      this.ctx.engine.pulse({ glitch: 0.5, aberration: 1.4 }, 0.5);
      this.ctx.rig.shake(0.22, 0.45);
    });
    this.boat.resetWake?.();
    kt.to('boatH', this.boatH, { show: 1, duration: 0.6, delay: 0.55 });
    kt.fromTo('boat', st, { boat: 0 }, { boat: 1, duration: 0.9, delay: 0.55, ease: 'back.out(1.8)' });
  }

  offAnswers(instant) {
    const st = this.st;
    const kt = this.kt;
    kt.to('checks', st, { checks: 0, duration: instant ? 0 : 0.4 });
    kt.to('boat', st, { boat: 0, duration: instant ? 0 : 0.4 });
    kt.to('boatH', this.boatH, { show: 0, duration: instant ? 0 : 0.4 });
    kt.kill('stamp');
    this.stamp?.hide();
  }

  labelsFor(state, step, instant) {
    if (!this.nodes[0].label) return;
    const intro = state === 'intro';
    const lvl = intro ? 0 : Math.min(4, step);
    this.nodes.forEach((n, i) => {
      if (n.lblTimer) { n.lblTimer.kill(); n.lblTimer = null; }
      if (n.readyTimer) { n.readyTimer.kill(); n.readyTimer = null; }
      if (intro) { n.label.hide(); return; }
      const lit = intro ? i === 4 : i <= lvl;
      const delay = instant ? 0 : (intro ? 0.6 : 0.5 + i * 0.12);
      n.lblTimer = this.delay(delay, () => n.label.show());
      const ready = () => n.lblEl.classList.toggle('is-dim', !lit);
      // подсветка подписи — когда импульс долетит
      if (!instant && !intro && lit && i === step && step <= 4 && step >= 1) n.readyTimer = this.delay(1.25, ready); else ready();
    });
  }

  exit(o = {}) {
    // отложенные показы подписей и штампа не должны сработать во время ухода
    this.killTweens();
    this.nodes.forEach((n) => { n.lblTimer = n.readyTimer = null; n.label?.hide(); });
    this.stamp?.hide();
    this.killPacket();
    return super.exit(o);
  }

  resize(w, h, dpr) {
    setCell(h * dpr);
    setLineResolution(w, h);
  }

  update(dt, t) {
    const st = this.st;
    this.fader.apply(this.opacity);
    const op = this.opacity;

    // узлы
    this.nodes.forEach((n, i) => {
      const vis = i === 4 ? 1 : st.others;
      n.g.visible = vis > 0.01;
      const lit = st.lit[i];
      const s = (0.55 + 0.45 * vis) * n.pop.s * (i === 4 ? st.big : 1);
      n.g.scale.setScalar(s);
      n.baseH.show = (0.25 + 0.75 * lit) * vis;
      n.halo.material.opacity = lit * (i === 3 ? 0.18 : 0.4) * vis * op * (0.85 + 0.15 * Math.sin(t * 2 + i));
      n.inner.position.y = Math.sin(t * 1.1 + i * 1.3) * 0.08;
    });
    // связи
    this.links.forEach((l, i) => {
      const u = l.mat.uniforms;
      u.uLit.value = st.link[i];
      u.uTime.value = t;
      u.uShow.value = st.others;
      l.cone.material.opacity = (0.15 + 0.85 * Math.min(1, st.link[i] * 1.2)) * st.others * op;
      l.tube.visible = l.cone.visible = st.others > 0.01;
    });
    this.retMat.uniforms.uTime.value = t;

    // 1. тест: покачивание, галочки
    const test = this.nodes[0].inner;
    test.rotation.y = Math.sin(t * 0.5) * 0.25;
    this.checks.forEach((c, i) => {
      const k = Math.min(1, Math.max(0, st.checks * 4 - i));
      c.scale.setScalar(Math.max(0.001, k * (1 + 0.25 * Math.sin(k * Math.PI))));
    });
    // 2. песочница: шар мечется внутри
    const sb = this.nodes[1].inner;
    sb.rotation.y = 0.5 + t * 0.15;
    const energy = 0.4 + st.lit[1] * 0.8;
    this.sbOrb.position.set(Math.sin(t * 2.3 * energy) * 0.55, Math.sin(t * 3.1 * energy + 1) * 0.5, Math.cos(t * 2.7 * energy) * 0.5);
    // 3. замок: дужка открывается, цвет — красный при взломе
    const lk = st.lock;
    this.shacklePivot.position.y = 0.25 + lk * 0.45;
    this.shacklePivot.rotation.y = lk * 1.9;
    const lr = this.lockMat.uniforms, sr = this.shackleMat.uniforms;
    lr.uColor.value.setRGB(0.81 + 0.19 * lk, 0.85 * (1 - lk) + 0.23 * lk, 0.81 * (1 - lk) + 0.19 * lk);
    lr.uRim.value.setRGB(1, 1 - 0.75 * lk, 1 - 0.8 * lk);
    sr.uColor.value.copy(lr.uColor.value);
    sr.uRim.value.copy(lr.uRim.value);
    this.nodes[2].inner.rotation.y = Math.sin(t * 0.7) * 0.35;
    if (this.sparks.visible) {
      const k = this.sparkT.k;
      this.sparks.scale.setScalar(0.2 + k * 2.6);
      this.sparks.material.uniforms.uShow.value = 1 - k;
    }
    // 4. глобус
    this.globe.rotation.y += dt * (0.12 + st.lit[3] * 0.25);
    this.globeWire.rotation.y = this.globe.rotation.y;
    this.globe.material.uniforms.uShow.value = 0.45 + 0.35 * st.lit[3];
    this.orbit.rotation.y += dt * 0.6;
    // 5. база: крышка, тревога, лист с ответами
    const db = st.db;
    this.lid.position.y = 0.86 + db * 0.9;
    this.lid.rotation.z = db * 0.5;
    this.lid.rotation.x = db * -0.2;
    const al = st.alarm;
    const blink = 0.5 + 0.5 * Math.sin(t * 7);
    this.alarm.material.opacity = al * (0.35 + 0.45 * blink) * op;
    if (al > 0.05) {
      if (!this.alarmRing.visible || this.alarmRing.material.uniforms.uT.value >= 0.99) {
        this.alarmRing.visible = true;
        this.alarmRing.material.uniforms.uT.value = 0;
      }
      this.alarmRing.material.uniforms.uT.value = Math.min(1, this.alarmRing.material.uniforms.uT.value + dt * 0.8);
    } else this.alarmRing.visible = false;
    const dbU = this.dbMat.uniforms;
    dbU.uRim.value.setRGB(0.85 + 0.15 * al * blink, 1 - 0.7 * al * blink, 0.82 - 0.6 * al * blink);
    // лист: позиция между базой, «над базой» и тестом
    const hf = this.nodes[4];
    hf.g.updateMatrixWorld();
    const p0 = this._v.set(0, -0.4, 0).applyMatrix4(hf.g.matrixWorld);
    const p1 = this._t.set(0, 2.25, 0.25).applyMatrix4(hf.g.matrixWorld);
    const sh = this.sheet;
    if (st.fly > 0.001) {
      RETURN_CURVE.getPoint(st.fly, sh.position);
      sh.rotation.set(0, 0, Math.sin(st.fly * Math.PI) * 0.6);
      sh.scale.setScalar(1 - Math.sin(st.fly * Math.PI) * 0.25 - st.fly * 0.25);
      this.trail.uniforms.uShow.value = st.fly < 0.999 ? 1 : Math.max(0, this.trail.uniforms.uShow.value - dt * 2);
      // хвост погас — буфер больше не перезаливается каждый кадр
      if (this.trail.uniforms.uShow.value > 0.001) this.trail.push(sh.position);
    } else {
      sh.position.lerpVectors(p0, p1, st.sheet);
      sh.rotation.set(0, Math.sin(t * 0.8) * 0.25, 0);
      sh.scale.setScalar(0.4 + 0.6 * st.sheet);
    }
    if (this.run.link >= 0) {
      this.links[this.run.link].crv.getPoint(this.run.k, this.packet.position);
      this.trail.uniforms.uShow.value = 1;
      this.trail.push(this.packet.position);
      this.packet.scale.setScalar(1 + Math.sin(t * 30) * 0.12);
    } else if (st.fly <= 0.001 || st.fly >= 0.999) {
      this.trail.uniforms.uShow.value = Math.max(0, this.trail.uniforms.uShow.value - dt * 2.5);
    }

    // лодка: восьмёрка вокруг бонусов
    if (st.boat > 0.01) {
      this.boatU += dt * 1.15;
      this.eight(this.boatU, { a: 1.85, b: 0.9, cx: 0, cz: 0, y: 0 }, this._v, this._t);
      this.boat.place(this._v, this._t);
      this.boat.update(dt, t);
      this.boatG.scale.setScalar(Math.max(0.001, st.boat));
      this.bonuses.forEach((b, i) => { b.rotation.y = t * 2 + i; b.position.y = 0.45 + Math.sin(t * 2.4 + i * 2) * 0.1; });
      this.pondU.uTime.value = t;
    }

    if (this.ownsParticles()) {
      const o = this.particles.object;
      if (this.state !== 'intro') o.rotation.y = 0;
    }
  }
}
