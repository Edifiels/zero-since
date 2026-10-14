// «Таймлайн инцидентов 2026»: ночная Земля с орбиты (огни городов из частиц), дуга месяцев — точно по линии горизонта.
// По клику «курсор времени» бежит по дуге, из горизонта бьёт вспышка-луч с меткой:
//   1 — апрель, Anthropic (Mythos Preview); 2 — июль, OpenAI; 3 — август, Moonshot (Kimi K3); 4 — август, Meta.
// Метки всё чаще, маяки пульсируют всё быстрее, свободные частицы «сгущаются» у июля–августа.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import {
  HEX, toColor, glowSprite, glowMaterial, fatLines, Trail, shockRing, Fader, lbl,
  setCell, setLineResolution, loadLand, loadCities, lonLat, keyed,
} from './kit.js';

const R = 36;                                     // радиус планеты
const PC = new THREE.Vector3(0, -38.6, -2);       // центр планеты
const CAM = { pos: [0, 1.5, 20], target: [0, 0.6, 0], fov: 42 };
const PHI_MAX = THREE.MathUtils.degToRad(41);     // половина дуги месяцев
const SKY_BG = { glows: [[0, -0.75, 0.75, 0.45]], band: null };
const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
// Инциденты: месяц (дробный — середина месяца = m + 0.5), высота луча, подпись, сторона подписи
const INC = [
  { m: 3.45, h: 5.5, title: 'Anthropic', sub: 'Mythos Preview', anchor: 'bottom', off: [0, 0.5, 0] },
  { m: 6.5, h: 6.2, title: 'OpenAI', sub: 'взлом Hugging Face', anchor: 'bottom', off: [0, 0.5, 0] },
  { m: 7.3, h: 3.6, title: 'Moonshot', sub: 'Kimi K3', anchor: 'left', off: [0.6, 0.1, 0] },
  { m: 7.62, h: 6.3, title: 'Meta', sub: 'побег на проверке', anchor: 'left', off: [0.6, 0.15, 0] },
];

// ---------------------------------------------------------------------------
// Геометрия горизонта: окружность-силуэт сферы, видимая из камеры
// ---------------------------------------------------------------------------
const camP = new THREE.Vector3(...CAM.pos);
const toCam = camP.clone().sub(PC);
const D = toCam.length();
const NV = toCam.clone().normalize();                         // центр видимой «шапки»
const CS = PC.clone().addScaledVector(NV, (R * R) / D);       // центр окружности-силуэта
const RS = R * Math.sqrt(1 - (R * R) / (D * D));              // её радиус
const UP = new THREE.Vector3(0, 1, 0).addScaledVector(NV, -NV.y).normalize();
const SIDE = new THREE.Vector3().crossVectors(UP, NV).normalize();
const COS_CAP = R / D;

/** Точка на линии горизонта: t ∈ [0, 1] (январь → декабрь), lift — подъём над поверхностью. */
function horizon(t, lift = 0, out = new THREE.Vector3()) {
  const phi = -PHI_MAX + t * 2 * PHI_MAX;
  out.copy(CS).addScaledVector(UP, Math.cos(phi) * RS).addScaledVector(SIDE, Math.sin(phi) * RS);
  if (lift) { const nrm = out.clone().sub(PC).normalize(); out.addScaledVector(nrm, lift); }
  return out;
}
const monthT = (m) => (m + 0.5) / 12;            // m — номер месяца с 0; середина месяца
function normalAt(p, out = new THREE.Vector3()) { return out.copy(p).sub(PC).normalize(); }

// Поворот «Земля → мир»: точка (lon0, lat0) смотрит в камеру, север — к горизонту
const LON0 = 42, LAT0 = 24;
const M = (() => {
  const e1 = new THREE.Vector3(...lonLat(LON0, LAT0, 1));
  const la = THREE.MathUtils.degToRad(LAT0), lo = THREE.MathUtils.degToRad(LON0);
  const e2 = new THREE.Vector3(-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)).normalize();
  const e3 = new THREE.Vector3().crossVectors(e1, e2);
  const w1 = NV.clone(), w2 = UP.clone(), w3 = new THREE.Vector3().crossVectors(w1, w2);
  const E = new THREE.Matrix4().makeBasis(e1, e2, e3);
  const W = new THREE.Matrix4().makeBasis(w1, w2, w3);
  return W.multiply(E.transpose());
})();
const MI = M.clone().transpose();

// ---------------------------------------------------------------------------
// Частицы
// ---------------------------------------------------------------------------
const SHAPES = new Map();
const PARTS = new Map();
const copyShape = (s) => ({ count: s.count, positions: s.positions.slice(), colors: s.colors.slice(), meta: {} });

function planetPart(m, land) {
  const s = S.createShape(m), r = rng(1201);
  const v = new THREE.Vector3(), loc = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const cosMin = COS_CAP - 0.015;
  let i = 0, guard = 0;
  const dark = S.color('#0c5a0c'), mid = S.PAL.green, pale = S.PAL.mint;
  while (i < m && guard++ < m * 40) {
    // равномерно по сферической «шапке» вокруг NV
    const c = cosMin + r() * (1 - cosMin);
    const sn = Math.sqrt(1 - c * c), a = r() * Math.PI * 2;
    tmpA.copy(UP).multiplyScalar(Math.cos(a) * sn);
    tmpB.copy(SIDE).multiplyScalar(Math.sin(a) * sn);
    v.copy(NV).multiplyScalar(c).add(tmpA).add(tmpB);
    loc.copy(v).applyMatrix4(MI);
    const lat = Math.asin(Math.max(-1, Math.min(1, loc.y))) * 180 / Math.PI;
    const lon = Math.atan2(loc.x, loc.z) * 180 / Math.PI;
    const isL = land.isLand(lon, lat);
    if (!isL && r() > 0.16) continue;
    const limb = 1 - (c - cosMin) / (1 - cosMin);           // 1 — у горизонта
    const col = isL ? S.mixColor(mid, pale, r() * 0.45) : S.mixColor(dark, pale, 0.2);
    const al = isL ? r.range(0.3, 0.62) : r.range(0.05, 0.12);
    S.setPoint(s, i, PC.x + v.x * R, PC.y + v.y * R, PC.z + v.z * R, isL ? r.range(0.6, 1.15) : 0.55, col, al * (0.75 + 0.5 * limb));
    i++;
  }
  for (; i < m; i++) S.setPoint(s, i, 0, -60, -60, 0.1, S.PAL.dim, 0);
  return s;
}

function citiesPart(m, cities) {
  const s = S.createShape(m), r = rng(1301);
  const loc = new THREE.Vector3();
  const vis = [];
  for (const c of cities) {
    lonLatVec(c[0], c[1], loc);
    loc.applyMatrix4(M);
    if (loc.dot(NV) > COS_CAP + 0.004) vis.push({ p: loc.clone(), w: Math.log10(Math.max(1e4, c[2])) - 3.6 });
  }
  if (!vis.length) return S.fade(S.dust(m, { radius: 30, inner: 10 }), 0);
  const total = vis.reduce((a, c) => a + c.w, 0);
  let i = 0;
  vis.forEach((c, ci) => {
    const cnt = ci === vis.length - 1 ? m - i : Math.floor(m * c.w / total);
    const spread = 0.05 + 0.03 * c.w;
    for (let k = 0; k < cnt && i < m; k++, i++) {
      const x = PC.x + c.p.x * R + r.gauss(0, spread), y = PC.y + c.p.y * R + r.gauss(0, spread), z = PC.z + c.p.z * R + r.gauss(0, spread);
      const col = r() < 0.55 ? S.PAL.warm : r() < 0.6 ? S.PAL.bright : S.PAL.greenHi;
      S.setPoint(s, i, x, y, z, r.range(0.6, 1.3), col, r.range(0.45, 0.95));
    }
  });
  return s;
}
function lonLatVec(lon, lat, out) { const a = lonLat(lon, lat, 1); return out.set(a[0], a[1], a[2]); }

const CLUSTER = [0, 0.08, 0.22, 0.5, 0.78];
function freePart(m, step) {
  const s = S.createShape(m), r = rng(1401);
  const c0 = horizon(monthT(6.9), 0);
  const nrm = normalAt(c0);
  const center = c0.clone().addScaledVector(nrm, 4.2);
  const k = CLUSTER[step];
  for (let i = 0; i < m; i++) {
    const inCluster = r() < k;
    const sx = r.range(-34, 34), sy = r.range(-1, 22), sz = r.range(-44, -20);
    if (inCluster) {
      const [dx, dy, dz] = r.inSphere(1);
      const rad = 1.4 + 2.6 * Math.pow(r(), 1.6);
      const col = r() < 0.2 ? S.PAL.red : r() < 0.4 ? S.PAL.bright : S.PAL.greenHi;
      S.setPoint(s, i, center.x + dx * rad * 1.5, center.y + dy * rad * 1.25, center.z + dz * rad, r.range(0.4, 1.1), col, r.range(0.2, 0.6));
    } else {
      S.setPoint(s, i, sx, sy, sz, r.range(0.5, 1.2), r() < 0.85 ? S.PAL.white : S.PAL.mint, r.range(0.06, 0.32));
    }
  }
  return s;
}

function incidentsShape(n, step, land, cities) {
  const key = n + ':' + step;
  if (SHAPES.has(key)) return SHAPES.get(key);
  const part = (name, m, fn) => { const k = name + ':' + m; if (!PARTS.has(k)) PARTS.set(k, fn()); return copyShape(PARTS.get(k)); };
  const s = S.combine(n, [
    { weight: 0.6, shape: (m) => part('planet', m, () => planetPart(m, land)) },
    { weight: 0.13, shape: (m) => part('cities', m, () => citiesPart(m, cities)) },
    { weight: 0.27, shape: (m) => part('free' + step, m, () => freePart(m, step)) },
  ]);
  SHAPES.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Шейдеры: атмосфера и лучи
// ---------------------------------------------------------------------------
const ATMO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower, uK;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = dot(normalize(vN), normalize(vV));
  float g = clamp(1.0 - abs(ndv), 0.0, 1.0);
  float a = pow(g, uPower) * uK;
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor, uCore;
uniform float uOpacity, uShow, uTime, uFlash;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float core = ndv * ndv * ndv;
  float h = vUv.y;
  float fade = (1.0 - smoothstep(0.55, 1.0, h)) * smoothstep(0.0, 0.04, h);
  float ripple = 0.75 + 0.25 * sin(h * 26.0 - uTime * 7.0);
  vec3 col = mix(uColor, uCore, core) * (ripple + uFlash);
  float a = (0.25 + 0.75 * core) * fade * uOpacity * uShow;
  gl_FragColor = vec4(col, a);
}
`;

// Хвосты спутников: точка k (0 — голова) — положение на орбите k·1.1 с назад
const SAT_VERT = /* glsl */ `
attribute float aK;
attribute vec4 aOrbit;   // радиус, угловая скорость, фаза, наклон
attribute vec3 aCol;
uniform float uTime, uSize, uScale;
uniform vec3 uCenter;
varying float vK;
varying float vVis;
varying vec3 vCol;
void main() {
  vK = aK;
  vCol = aCol;
  float a = aOrbit.z + (uTime - aK * 1.1) * aOrbit.y;
  vec3 n = vec3(sin(a), cos(a) * cos(aOrbit.w), cos(a) * sin(aOrbit.w) * 0.6);
  vec3 p = uCenter + n * aOrbit.x;
  vVis = smoothstep(-6.5, -5.5, p.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uScale * (1.0 - aK * 0.8) / max(0.1, -mv.z), 1.0, 90.0);
}
`;
const SAT_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vK;
varying float vVis;
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 4.5) * (1.0 - vK) * (1.0 - vK) * vVis * 0.8 * uOpacity;
  gl_FragColor = vec4(vCol, a);
}
`;

// ---------------------------------------------------------------------------
export default class Incidents extends Visual {
  static transition = 'zoomout';

  async init() {
    const ctx = this.ctx;
    this.fader = new Fader();
    this.kt = keyed(this);
    this.scaleU = ctx.particles.uniforms.uScale;
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    const [land, cities] = await Promise.all([loadLand(), loadCities()]);
    this.land = land; this.cities = cities;

    // Тёмная сфера-заслонка (звёзды за планетой не видны) и атмосфера
    const occ = new THREE.Mesh(new THREE.SphereGeometry(R * 0.996, 160, 80), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    occ.position.copy(PC);
    occ.renderOrder = -2;
    this.root.add(occ);
    this.atmoU = { uColor: { value: toColor(HEX.greenHi, 1.15) }, uOpacity: { value: 1 }, uPower: { value: 7 }, uK: { value: 1.1 } };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 160, 80), new THREE.ShaderMaterial({
      uniforms: this.atmoU, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    }));
    atmo.position.copy(PC);
    this.root.add(atmo);
    // тонкая яркая кромка
    this.rimU = { uColor: { value: toColor('#d8ffd0', 1.3) }, uOpacity: { value: 1 }, uPower: { value: 22 }, uK: { value: 0.9 } };
    const rim = new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 160, 80), new THREE.ShaderMaterial({
      uniforms: this.rimU, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    }));
    rim.position.copy(PC);
    this.root.add(rim);

    // Дуга месяцев: тусклая целиком + яркий «прогресс»
    const SEG = 240;
    const arcPts = [];
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    for (let i = 0; i < SEG; i++) {
      horizon(i / SEG, 0.35, p0); horizon((i + 1) / SEG, 0.35, p1);
      arcPts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
    this.arcDim = fatLines(arcPts, { color: HEX.green, k: 0.7, width: 2.4, opacity: 0.7 });
    this.root.add(this.arcDim);
    this.arc = fatLines(arcPts, { color: HEX.greenHi, k: 1.9, width: 6 });
    this.arc.geometry.instanceCount = 0;
    this.root.add(this.arc);
    this.SEG = SEG;
    this.prog = { t: 0 };

    // Метки месяцев (точки на дуге)
    this.ticks = [];
    for (let m = 0; m < 12; m++) {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), glowMaterial('#ffffff', 1.2, 1));
      horizon(monthT(m), 0.35, g.position);
      this.root.add(g);
      this.ticks.push(g);
    }

    // Курсор времени
    this.cursor = new THREE.Group();
    this.cursor.add(glowSprite('#ffffff', 1.3, 2.2));
    this.cursor.add(glowSprite(HEX.greenHi, 3.2, 1.0));
    this.root.add(this.cursor);
    this.cursorH = this.fader.add(this.cursor, 0);
    this.trail = new Trail(40, { color: HEX.greenHi, k: 1.8, size: 0.5, scale: this.scaleU });
    this.trail.uniforms.uShow.value = 0;
    this.root.add(this.trail.points);

    // Вспышки-инциденты
    this.incs = INC.map((d, i) => {
      const base = horizon(d.m / 12, 0.35);
      const nrm = normalAt(base);
      const g = new THREE.Group();
      g.position.copy(base);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
      this.root.add(g);
      const u = {
        uColor: { value: toColor(i === 1 ? HEX.red : HEX.greenHi, 1.4) },
        uCore: { value: toColor('#ffffff', 1.5) },
        uOpacity: { value: 1 }, uShow: { value: 1 }, uTime: { value: 0 }, uFlash: { value: 0 },
      };
      const beamGeo = new THREE.CylinderGeometry(0.16, 0.34, 1, 24, 1, true);
      beamGeo.translate(0, 0.5, 0);
      const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      beam.scale.set(1, 0.001, 1);
      g.add(beam);
      const flare = glowSprite('#ffffff', 2.0, 1.15);
      flare.material.userData.noFade = true;
      g.add(flare);
      const halo = glowSprite(i === 1 ? HEX.red : HEX.greenHi, 5.5, 0.5);
      halo.material.userData.noFade = true;
      g.add(halo);
      const ring = shockRing(HEX.red, 2.2, 9, 0.05);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      const top = new THREE.Object3D();
      g.add(top);
      return { d, g, beam, u, flare, halo, ring, top, on: { k: 0 }, nrm, base };
    });

    // Спутники на орбитах (движение даже на пустом шаге). Хвосты считаются в шейдере по той же орбите —
    // без перезаливки буферов каждый кадр.
    this.sats = [];
    const TP = 26;
    const sk = new Float32Array(4 * TP), orb = new Float32Array(4 * TP * 4), scol = new Float32Array(4 * TP * 3);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.add(glowSprite(i % 2 ? '#ffffff' : HEX.greenHi, 0.9, 1.8));
      this.root.add(g);
      const s = { g, r: R + 3.2 + i * 1.6, sp: 0.045 + i * 0.012, ph: i * 1.9, tilt: -0.35 + i * 0.22 };
      this.sats.push(s);
      const c = toColor(i % 2 ? '#ffffff' : HEX.greenHi, 1.2);
      for (let j = 0; j < TP; j++) {
        const q = i * TP + j;
        sk[q] = j / (TP - 1);
        orb.set([s.r, s.sp, s.ph, s.tilt], q * 4);
        scol.set([c.r, c.g, c.b], q * 3);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * TP * 3), 3));
    sg.setAttribute('aK', new THREE.BufferAttribute(sk, 1));
    sg.setAttribute('aOrbit', new THREE.BufferAttribute(orb, 4));
    sg.setAttribute('aCol', new THREE.BufferAttribute(scol, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.satU = { uTime: { value: 0 }, uSize: { value: 0.18 }, uScale: this.scaleU, uOpacity: { value: 1 }, uCenter: { value: PC.clone() } };
    const satTrails = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.satU, vertexShader: SAT_VERT, fragmentShader: SAT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    satTrails.frustumCulled = false;
    this.root.add(satTrails);

    // Частицы — заранее
    const n = ctx.particles.count;
    for (let s = 0; s <= 4; s++) incidentsShape(n, s, land, cities);
    this.labelsMade = false;
  }

  makeLabels() {
    if (this.labelsMade) return;
    this.labelsMade = true;
    this.monthLbl = MONTHS.map((name, m) => this.label({
      html: `<div class="b5b-month">${name}</div>`,
      position: horizon(monthT(m), 1.25).toArray(),
      visible: false,
    }));
    this.incLbl = this.incs.map((it) => {
      const d = it.d;
      return this.label({ html: lbl(d.title, d.sub, 'is-danger-soft'), object: it.top, offset: d.off, anchor: d.anchor, visible: false, className: 'b5b-pop' });
    });
  }

  // Позы — для 16:9; под 4:3/16:10 их подгоняет ядро.
  camera(state, step) {
    if (step >= 4) return { pos: [0, 1.6, 20.6], target: [0, 0.65, 0], fov: 42 };
    return { pos: CAM.pos, target: CAM.target, fov: CAM.fov };
  }
  background() { return SKY_BG; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    setCell(this.ctx.height * this.ctx.engine.pixelRatio);
    setLineResolution(this.ctx.width, this.ctx.height);
    this.makeLabels();
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.06, swirl: 0, size: 0.06, twinkle: 0.5, spring: 14, damping: 5.2 }, o.instant ? 0 : 1.2);
    p.morph(incidentsShape(p.count, this.step, this.land, this.cities), { duration: o.instant ? 0.01 : 2.4, stagger: 0.55, burst: 12 });
    this.tw(p.object.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6 });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6 });
    this.pstep = this.step;
    // ударные кольца могли «застыть», если уход прервал их анимацию
    this.incs.forEach((it) => { it.ring.visible = false; it.u.uFlash.value = 0; });
    // месяцы проявляются волной слева направо
    this.monthLbl.forEach((l, m) => { l.hide(); this.delay(o.instant ? 0 : 0.6 + m * 0.07, () => l.show()); });
    this.apply(this.step, true);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    if (this.ownsParticles() && step !== this.pstep) {
      this.pstep = step;
      this.particles.morph(incidentsShape(this.particles.count, step, this.land, this.cities), { duration: step > prev ? 1.8 : 1.2, stagger: 0.45, burst: 6 });
    }
    if (step === prev + 1 && !o.instant) this.advance(prev, step);
    else this.apply(step, !!o.instant);
  }

  /** Мгновенно (или быстро) привести к шагу. */
  apply(step, instant) {
    const t = step > 0 ? INC[step - 1].m / 12 : 0;
    this.killCursor();
    if (instant) { this.kt.kill('prog'); this.prog.t = t; } else this.kt.to('prog', this.prog, { t, duration: 0.6 });
    this.incs.forEach((it, i) => {
      const on = i < step;
      this.kt.kill('lbl' + i);
      if (instant) { this.kt.kill('on' + i); it.on.k = on ? 1 : 0; }
      else this.kt.to('on' + i, it.on, { k: on ? 1 : 0, duration: on ? 0.6 : 0.35 });
      if (on) this.incLbl?.[i].show(); else this.incLbl?.[i].hide();
    });
    this.kt.kill('cursor');
    this.cursorH.show = step > 0 && step < 5 ? 1 : 0;
  }

  /** Шаг вперёд: курсор бежит по дуге к месяцу инцидента, затем — вспышка. */
  advance(prev, step) {
    // предыдущие состояния — сразу
    for (let i = 0; i < prev; i++) { this.kt.kill('on' + i); this.incs[i].on.k = 1; this.incLbl[i].show(); }
    const to = INC[step - 1].m / 12;
    const from = this.prog.t;
    const dist = Math.max(0, to - from);
    const dur = dist < 0.001 ? 0.01 : 0.35 + dist * 2.2;
    this.killCursor();
    this.kt.to('cursor', this.cursorH, { show: 1, duration: 0.3 });
    this.horizonPt(from, this._v);
    this.trail.reset(this._v);
    this.cursorTw = this.kt.to('prog', this.prog, {
      t: to, duration: dur, ease: dist < 0.05 ? 'power1.out' : 'power2.inOut',
      // курсор добежал: хвост гаснет и больше не перезаливается каждый кадр
      onComplete: () => { this.cursorTw = null; this.flare(step - 1); },
    });
  }

  killCursor() {
    if (this.cursorTw) { this.cursorTw.kill(); this.cursorTw = null; }
  }

  flare(i) {
    const it = this.incs[i];
    this.kt.fromTo('on' + i, it.on, { k: 0 }, { k: 1, duration: 0.9, ease: 'expo.out' });
    it.ring.visible = true;
    this.fromTo(it.ring.material.uniforms.uT, { value: 0 }, { value: 1, duration: 1.4, ease: 'power2.out', onComplete: () => { it.ring.visible = false; } });
    this.fromTo(it.u.uFlash, { value: 2.2 }, { value: 0, duration: 1.2, ease: 'power2.out' });
    this.kt.delay('lbl' + i, 0.25, () => { if (this.step > i) this.incLbl[i].show(); });
    const e = this.ctx.engine;
    e.pulse({ aberration: 1.2 + i * 0.4, flash: 0.04 + i * 0.03 }, 0.6);
    this.ctx.rig.shake(0.08 + i * 0.05, 0.45);
    this.ctx.background.surge(0.3 + i * 0.1, 1.2);
  }

  horizonPt(t, out) { return horizon(t, 0.35, out); }

  exit(o = {}) {
    // отложенные показы подписей не должны сработать во время ухода
    this.killTweens();
    this.cursorTw = null;
    this.monthLbl?.forEach((l) => l.hide());
    this.incLbl?.forEach((l) => l.hide());
    return super.exit(o);
  }

  resize(w, h, dpr) {
    setCell(h * dpr);
    setLineResolution(w, h);
  }

  update(dt, t) {
    this.fader.apply(this.opacity);
    const op = this.opacity;
    const tp = this.prog.t;
    // прогресс-дуга
    this.arc.geometry.instanceCount = Math.max(0, Math.min(this.SEG, Math.round(tp * this.SEG)));
    // курсор и след
    this.horizonPt(tp, this._v);
    this.cursor.position.copy(this._v);
    this.cursor.scale.setScalar(1 + 0.15 * Math.sin(t * 9));
    if (this.cursorTw) { this.trail.uniforms.uShow.value = 1; this.trail.push(this._v); }
    else this.trail.uniforms.uShow.value = Math.max(0, this.trail.uniforms.uShow.value - dt * 2);
    // месяцы: пройденные — ярче
    for (let m = 0; m < 12; m++) {
      const passed = monthT(m) <= tp + 0.02 ? 1 : 0;
      const s = 0.8 + passed * 0.5;
      this.ticks[m].scale.setScalar(s);
      this.ticks[m].material.opacity = (0.35 + 0.65 * passed) * op;
      const el = this.monthLbl?.[m]?.el;
      if (el) {
        const on = passed === 1;
        if (el._on !== on) { el._on = on; el.classList.toggle('is-on', on); }
      }
    }
    // вспышки: лучи растут, маяки пульсируют — тем чаще, чем больше инцидентов
    const count = this.incs.reduce((a, it) => a + (it.on.k > 0.5 ? 1 : 0), 0);
    const freq = 1.4 + count * 1.1;
    for (let i = 0; i < this.incs.length; i++) {
      const it = this.incs[i];
      const k = it.on.k;
      it.g.visible = k > 0.001;
      if (!it.g.visible) continue;
      const h = it.d.h * k;
      it.beam.scale.set(1, Math.max(0.001, h), 1);
      it.top.position.set(0, h, 0);
      it.u.uTime.value = t;
      const pulse = 0.5 + 0.5 * Math.sin(t * freq * 2.2 + i * 1.3);
      // вспышка у основания — умеренная: два августовских луча рядом не должны слипаться в белое пятно
      it.flare.material.opacity = k * (0.45 + 0.4 * pulse) * op;
      it.flare.scale.setScalar(1.1 + 1.0 * pulse);
      it.halo.material.opacity = k * (0.2 + 0.25 * pulse) * op;
    }
    // спутники (хвосты — в шейдере по той же формуле орбиты)
    this.satU.uTime.value = t;
    for (let i = 0; i < this.sats.length; i++) {
      const s = this.sats[i];
      const a = s.ph + t * s.sp;
      // орбита вокруг центра планеты в плоскости, наклонённой к камере
      this._n.set(Math.sin(a), Math.cos(a) * Math.cos(s.tilt), Math.cos(a) * Math.sin(s.tilt) * 0.6);
      this._v.copy(PC).addScaledVector(this._n, s.r);
      s.g.position.copy(this._v);
      s.g.visible = this._v.y > -6;
    }
    // атмосфера «нагревается» с каждым инцидентом
    this.atmoU.uK.value = 1.0 + count * 0.07 + 0.05 * Math.sin(t * freq);
  }
}
