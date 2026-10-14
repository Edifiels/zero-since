// Граф зависимостей: узлы-сервисы связаны стрелками, по рёбрам бегут импульсы.
// Шаг 0 — граф живёт; шаг 1 — один узел («Облако») краснеет; шаг 2 — красный каскадом расходится по графу.
// Облако частиц образует «космическую паутину» на этом же графе и краснеет той же волной.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { orderShape, recolorShape, makeCanvas, drawIcon, canvasTexture, yieldFrame } from './util.js';

// Тон значков: «работает» (бледно-зелёный, ниже порога bloom) и «отказ» (красный)
const BADGE_OK = new THREE.Color(0.58, 0.92, 0.52);
const BADGE_DOWN = new THREE.Color(1.0, 0.27, 0.22);

/** Значок узла: тёмный диск, тонкое кольцо и пиктограмма службы (белым — тонируется цветом материала). */
function badgeTexture(icon) {
  const S = 192;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const paper = '#030904';
  g.fillStyle = paper;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.47, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineWidth = S * 0.035;
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.445, 0, Math.PI * 2); g.stroke();
  drawIcon(g, icon, S / 2, S / 2, S * 0.56, '#ffffff', 'rgba(255,255,255,.55)', paper);
  return canvasTexture(c, { anisotropy: 4 });
}

// lab: 'up' — подпись над узлом (по умолчанию — под ним); icon — пиктограмма в узле (те же, что на картах домика)
const NODES = [
  { id: 'cloud', name: 'Облако', p: [0, 0.3, 0.8], m: 1.5, icon: 'cloud' },
  { id: 'net', name: 'Связь', p: [-4.1, 2.35, -0.4], m: 1.2, lab: 'up', icon: 'tower' },
  { id: 'pay', name: 'Платежи', p: [3.9, 2.4, 0.2], m: 1.15, lab: 'up', icon: 'card' },
  { id: 'mail', name: 'Электронная почта', p: [-3.3, -1.25, 0.5], m: 1.0, icon: 'mail' },
  { id: 'log', name: 'Логистика', p: [3.6, -1.35, -0.3], m: 1.0, icon: 'truck' },
  { id: 'gov', name: 'Госуслуги', p: [-0.1, 3.65, -0.6], m: 1.0, lab: 'up', icon: 'gov' },
  { id: 'bank', name: 'Банки', p: [7.6, 2.55, -0.4], m: 1.1, lab: 'up', icon: 'bank' },
  { id: 'shop', name: 'Магазины', p: [7.5, -0.75, 0.4], m: 1.0, icon: 'cart' },
  { id: 'stock', name: 'Склады', p: [5.7, -3.3, -0.2], m: 0.95, icon: 'box' },
  { id: 'trans', name: 'Транспорт', p: [0.9, -3.25, 0.5], m: 1.0, icon: 'bus' },
  { id: 'air', name: 'Аэропорты', p: [-6.9, -3.15, -0.3], m: 1.05, icon: 'plane' },
  { id: 'hosp', name: 'Больницы', p: [-7.7, 0.35, 0.3], m: 1.05, icon: 'cross' },
];
const EDGES = [
  ['cloud', 'pay'], ['cloud', 'mail'], ['cloud', 'gov'], ['cloud', 'log'], ['cloud', 'net'],
  ['net', 'hosp'], ['net', 'air'], ['net', 'gov'],
  ['pay', 'bank'], ['pay', 'shop'], ['pay', 'gov'], ['bank', 'shop'],
  ['log', 'stock'], ['log', 'trans'], ['stock', 'shop'], ['trans', 'air'], ['trans', 'stock'],
  ['mail', 'hosp'], ['mail', 'air'],
];
const SOURCE = 'cloud';
const SPEED = 3.6;      // скорость каскада (ед./с)

const EDGE_VERT = /* glsl */ `
attribute float aArr;
attribute float aS;
uniform float uCascade, uTime, uOpacity;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float red = uCascade >= 0.0 ? smoothstep(aArr - 0.02, aArr + 0.12, uCascade) : 0.0;
  float fd = (uCascade - aArr) * 7.0;
  float front = uCascade >= 0.0 ? exp(-fd * fd) : 0.0;
  vec3 green = vec3(0.12, 0.9, 0.2);
  vCol = mix(green, vec3(1.25, 0.12, 0.07), red) + vec3(2.2, 0.6, 0.4) * front;
  vA = (0.42 + 0.5 * red + 1.2 * front) * uOpacity;
}
`;
const EDGE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() { gl_FragColor = vec4(vCol, vA); }
`;

// Импульсы: точка бежит по квадратичной кривой Безье (P0, P1, P2) от источника к потребителю
const PULSE_VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aP1;
attribute vec3 aP2;
attribute vec2 aArr;   // время прихода каскада в начало и конец ребра
attribute float aPhase;
uniform float uCascade, uTime, uScale, uOpacity;
varying vec3 vCol;
varying float vA;
void main() {
  float s = fract(uTime * 0.34 + aPhase);
  vec3 p = mix(mix(aP0, aP1, s), mix(aP1, aP2, s), s);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float arr = mix(aArr.x, aArr.y, s);
  float red = uCascade >= 0.0 ? step(arr, uCascade) : 0.0;
  vCol = mix(vec3(0.55, 1.6, 0.55), vec3(2.2, 0.28, 0.18), red);
  vA = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.9, 1.0, s)) * uOpacity;
  gl_PointSize = clamp(1.9 * uScale / max(0.1, -mv.z), 0.0, 48.0);
}
`;
const PULSE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol, (exp(-d * d * 6.0) + (1.0 - d) * 0.2) * vA);
}
`;

const ORB_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uCell, uRed, uPulse;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = clamp(1.0 - dot(vN, vV), 0.0, 1.0);
  float rim = f * f;
  const mat2 R = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 q = R * gl_FragCoord.xy / uCell;
  vec2 c = fract(q) - 0.5;
  float v = clamp(0.25 + rim * 0.9 + uPulse * 0.3, 0.0, 1.0);
  float r = 0.72 * sqrt(v);
  float dotm = 1.0 - smoothstep(r - 0.08, r + 0.08, length(c));
  vec3 base = mix(uColor, vec3(1.35, 0.1, 0.06), uRed);
  vec3 col = base * (dotm * 0.85 + rim * 1.3 + 0.12) + vec3(1.0) * pow(clamp(rim, 0.0, 1.0), 5.0) * 0.5;
  gl_FragColor = vec4(col, uOpacity * (0.3 + 0.7 * max(dotm, rim)));
}
`;

export default class Graph extends Visual {
  static transition = 'morph';

  async init() {
    this.group = new THREE.Group();
    this.root.add(this.group);
    const byId = new Map(NODES.map((n, i) => [n.id, i]));
    this.nodes = NODES.map((n) => ({ ...n, v: new THREE.Vector3(...n.p) }));
    const r = rng(31);

    // Кривые рёбер (слегка изогнутые)
    this.edges = EDGES.map(([a, b]) => {
      const A = this.nodes[byId.get(a)].v, B = this.nodes[byId.get(b)].v;
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const d = B.clone().sub(A);
      const side = new THREE.Vector3(-d.y, d.x, 0).normalize().multiplyScalar(d.length() * 0.12 * (r() < 0.5 ? -1 : 1));
      const C = mid.add(side).add(new THREE.Vector3(0, 0, (r() - 0.5) * 0.8));
      const crv = new THREE.QuadraticBezierCurve3(A.clone(), C, B.clone());
      return { a: byId.get(a), b: byId.get(b), crv, len: crv.getLength() };
    });

    // Времена прихода каскада (кратчайший путь по длине рёбер)
    const src = byId.get(SOURCE);
    const T = new Array(this.nodes.length).fill(Infinity);
    T[src] = 0;
    for (let it = 0; it < this.nodes.length; it++) {
      this.edges.forEach((e) => { const t = T[e.a] + e.len / SPEED; if (t < T[e.b]) T[e.b] = t; });
    }
    this.tArr = T;
    this.edges.forEach((e) => { e.t0 = T[e.a]; e.t1 = T[e.a] + e.len / SPEED; });
    this.tEnd = Math.max(...this.edges.map((e) => e.t1)) + 0.45;

    // Рёбра — тонкие светящиеся трубки (одна геометрия, время прихода в атрибуте)
    const geos = [];
    this.edges.forEach((e) => {
      const g = new THREE.TubeGeometry(e.crv, 56, 0.024, 6, false);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n), sAttr = new Float32Array(n);
      const segs = 56, rad = 7;
      for (let i = 0; i < n; i++) {
        const s = Math.floor(i / rad) / segs;
        sAttr[i] = s;
        arr[i] = e.t0 + s * (e.t1 - e.t0);
      }
      g.setAttribute('aArr', new THREE.BufferAttribute(arr, 1));
      g.setAttribute('aS', new THREE.BufferAttribute(sAttr, 1));
      g.deleteAttribute('uv');
      geos.push(g);
    });
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    this.u = { uCascade: { value: -1 }, uTime: { value: 0 }, uOpacity: { value: 1 }, uScale: { value: 300 } };
    this.edgeMesh = new THREE.Mesh(mergeGeometries(geos), new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.edgeMesh.renderOrder = 11;
    geos.forEach((g) => g.dispose());
    this.group.add(this.edgeMesh);

    // Стрелки (конусы) у потребителя
    const cone = new THREE.ConeGeometry(0.13, 0.36, 14);
    cone.rotateX(Math.PI / 2); // остриё по +Z
    this.arrows = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), this.edges.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tan = new THREE.Vector3(), pos = new THREE.Vector3();
    this.edges.forEach((e, i) => {
      const nb = this.nodes[e.b];
      const s = 1 - (0.36 + 0.3 * nb.m) / e.len;
      e.crv.getPointAt(s, pos);
      e.crv.getTangentAt(s, tan);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.normalize());
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      this.arrows.setMatrixAt(i, m);
      this.arrows.setColorAt(i, new THREE.Color(0.12, 0.95, 0.22));
      e.arrowT = e.t0 + s * (e.t1 - e.t0);
    });
    this.arrows.renderOrder = 12;
    this.group.add(this.arrows);

    // Импульсы по рёбрам
    const P = 3;
    const cnt = this.edges.length * P;
    const pg = new THREE.BufferGeometry();
    const p0 = new Float32Array(cnt * 3), p1 = new Float32Array(cnt * 3), p2 = new Float32Array(cnt * 3), ar = new Float32Array(cnt * 2), ph = new Float32Array(cnt);
    this.edges.forEach((e, i) => {
      for (let k = 0; k < P; k++) {
        const j = i * P + k;
        p0.set(e.crv.v0.toArray(), j * 3); p1.set(e.crv.v1.toArray(), j * 3); p2.set(e.crv.v2.toArray(), j * 3);
        ar[j * 2] = e.t0; ar[j * 2 + 1] = e.t1;
        ph[j] = k / P + r() * 0.2;
      }
    });
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cnt * 3), 3));
    pg.setAttribute('aP0', new THREE.BufferAttribute(p0, 3));
    pg.setAttribute('aP1', new THREE.BufferAttribute(p1, 3));
    pg.setAttribute('aP2', new THREE.BufferAttribute(p2, 3));
    pg.setAttribute('aArr', new THREE.BufferAttribute(ar, 2));
    pg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.pulses = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: PULSE_VERT, fragmentShader: PULSE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.pulses.frustumCulled = false;
    this.pulses.renderOrder = 13;
    this.group.add(this.pulses);

    // Узлы — халфтон-сферы со значком службы внутри; кольца-ударные волны при отказе.
    // Яркость сфер умеренная: много зелёного ярче порога bloom заливает весь кадр зелёной дымкой.
    const sph = new THREE.SphereGeometry(1, 40, 28);
    const ringG = new THREE.RingGeometry(0.86, 1, 64);
    this.nodes.forEach((n, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(0.78) }, uOpacity: { value: 1 }, uCell: { value: 6 }, uRed: { value: 0 }, uPulse: { value: 0 } },
        vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      n.r = 0.32 + 0.16 * n.m;
      n.mesh = new THREE.Mesh(sph, mat);
      n.mesh.position.copy(n.v);
      n.mesh.scale.setScalar(n.r);
      n.mesh.renderOrder = 14;
      this.group.add(n.mesh);
      // значок: тёмный диск с пиктограммой (тонируется цветом состояния: зелёный → красный)
      n.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(n.icon), color: BADGE_OK.clone(), transparent: true, depthWrite: false }));
      n.badge.position.copy(n.v);
      n.badge.scale.setScalar(n.r * 1.72);
      n.badge.renderOrder = 16;
      this.group.add(n.badge);
      n.ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      n.ring.material.userData.noFade = true;
      n.ring.position.copy(n.v);
      n.ring.renderOrder = 17;
      n.ring.visible = false;
      this.group.add(n.ring);
      n.t = this.tArr[i];
      n.fired = false;
      n.ringT = -1;
      n.seed = r() * 10;
    });

    await yieldFrame();
    await this.buildShapes();
    this.k = { src: 0 };
    this.labels = [];
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const r = rng(41);
    const s = S.createShape(n);
    const keys = new Float32Array(n).fill(-1);
    const nNodes = Math.floor(n * 0.15), nEdges = Math.floor(n * 0.5);
    let i = 0;
    const tEnd = Math.max(...this.tArr);
    const totalM = this.nodes.reduce((a, b) => a + b.m, 0);
    this.nodes.forEach((nd, k) => {
      const cnt = k === this.nodes.length - 1 ? nNodes - i : Math.floor(nNodes * nd.m / totalM);
      for (let q = 0; q < cnt; q++, i++) {
        const rad = 0.55 * nd.m;
        const [x, y, z] = r.inSphere(1);
        const g = Math.pow(r(), 1.3);
        S.setPoint(s, i, nd.v.x + x * rad * (0.45 + g), nd.v.y + y * rad * (0.45 + g), nd.v.z + z * rad * (0.45 + g),
          r.range(0.5, 1.2), r() < 0.04 ? S.PAL.bright : r() < 0.4 ? S.PAL.pale : S.PAL.green, r.range(0.12, 0.34));
        keys[i] = this.tArr[k] / tEnd;
      }
    });
    const totalL = this.edges.reduce((a, e) => a + e.len, 0);
    const v = new THREE.Vector3();
    this.edges.forEach((e, k) => {
      const cnt = k === this.edges.length - 1 ? nNodes + nEdges - i : Math.floor(nEdges * e.len / totalL);
      for (let q = 0; q < cnt; q++, i++) {
        const t = r();
        e.crv.getPoint(t, v);
        const sc = 0.06 + 0.09 * Math.sin(Math.PI * t);
        S.setPoint(s, i, v.x + r.gauss(0, sc), v.y + r.gauss(0, sc), v.z + r.gauss(0, sc), r.range(0.4, 0.95), r() < 0.55 ? S.PAL.green : r() < 0.6 ? S.PAL.mint : S.PAL.white, r.range(0.14, 0.38));
        keys[i] = (e.t0 + t * (e.t1 - e.t0)) / tEnd;
      }
    });
    for (; i < n; i++) {
      const p = [r.range(-1, 1) * 11, r.range(-1, 1) * 6.5, r.range(-1, 1) * 6 - 1];
      S.setPoint(s, i, p[0], p[1], p[2], r.range(0.3, 0.8), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.04, 0.14));
    }
    // ранги (см. globe.js): точка с ключом k получает частицу, стартующую при доле ≈ k
    const order = [];
    for (let q = 0; q < n; q++) if (keys[q] >= 0) order.push(q);
    order.sort((a, b) => keys[a] - keys[b]);
    const rank = new Float32Array(n).fill(-1);
    const used = new Uint8Array(n);
    let last = -1;
    for (const q of order) {
      let rk = Math.max(Math.round(keys[q] * 0.97 * (n - 1)), last + 1);
      if (rk > n - 1) rk = n - 1;
      while (used[rk] && rk < n - 1) rk++;
      used[rk] = 1; rank[q] = rk; last = rk;
    }
    let free = 0;
    for (let q = 0; q < n; q++) { if (rank[q] >= 0) continue; while (used[free]) free++; used[free] = 1; rank[q] = free; }
    // помечаем принадлежность к источнику (альфа-канал не трогаем — храним отдельно)
    const srcMark = new Float32Array(n);
    const sv = this.nodes[0].v;
    for (let q = 0; q < n; q++) {
      const j = q * 4;
      const d = Math.hypot(s.positions[j] - sv.x, s.positions[j + 1] - sv.y, s.positions[j + 2] - sv.z);
      srcMark[q] = keys[q] === 0 && d < 1.2 ? 1 : 0;
    }
    await yieldFrame();
    orderShape(s, rank);
    this.shapeGreen = s;
    const redOf = (c) => {
      const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      return [0.25 + lum * 1.05, lum * 0.12, lum * 0.08, c[3]];
    };
    await yieldFrame();
    this.shapeRed = recolorShape(s, (q, c) => (c[3] > 0.22 || this.isOnGraph(s.positions, q * 4) ? redOf(c) : c));
    this.shapeSrc = recolorShape(s, (q, c, P, j) => (Math.hypot(P[j] - sv.x, P[j + 1] - sv.y, P[j + 2] - sv.z) < 0.75 ? redOf(c) : c));
  }

  isOnGraph(P, j) {
    for (const nd of this.nodes) if (Math.hypot(P[j] - nd.v.x, P[j + 1] - nd.v.y, P[j + 2] - nd.v.z) < 0.9) return true;
    return false;
  }

  // Позы — для 16:9; под экраны 4:3 / 16:10 ядро подгоняет их само.
  camera(state, step) {
    return step >= 2 ? { pos: [0.5, 0.0, 18.2], target: [0.15, -0.3, 0], fov: 42 } : { pos: [0.9, 0.55, 15.8], target: [0.2, 0.35, 0], fov: 42 };
  }

  background(state, step) { return step >= 1 ? 'danger' : 'corner'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.18, swirl: 0, size: 0.058, twinkle: 0.3, spring: 16, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    this.shapeKey = this.step >= 2 ? 'red' : this.step === 1 ? 'src' : 'green';
    p.morph(this.shapeFor(this.shapeKey), { duration: o.instant ? 0.01 : 2.3, stagger: 0.5, burst: 14 });
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    // подписи узлов
    this.removeLabels();
    this.labels = this.nodes.map((nd) => {
      const up = nd.lab === 'up';
      return this.label({
        html: `<span class="b6k-node">${nd.name}</span>`,
        object: this.group,
        offset: [nd.v.x, nd.v.y + (up ? nd.r + 0.3 : -nd.r - 0.3), nd.v.z],
        anchor: up ? 'bottom' : 'top',
        visible: false,
      });
    });
    const c0 = this.nodes[0];
    this.flag = this.label({ html: '<span class="b6k-fail">Сбой</span>', object: this.group, offset: [c0.v.x, c0.v.y + c0.r + 0.45, c0.v.z], anchor: 'bottom', visible: false });
    // мгновенно в состояние шага
    this.u.uCascade.value = this.step >= 2 ? this.tEnd : -1;
    this._lastCas = this.u.uCascade.value;
    this.k.src = this.step >= 1 ? 1 : 0;
    this.nodes.forEach((nd) => { nd.fired = this.step >= 2; nd.ringT = -1; nd.ring.visible = false; });
    this.group.rotation.set(0, 0, 0);
    this.revealLabels(o);
    return super.enter(o);
  }

  /** Подписи появляются вместе со сценой (а не поверх уходящей предыдущей). */
  revealLabels(o) {
    this._labDelay?.kill();
    this._labsOn = !!o.instant;
    if (o.instant) this.syncLabels();
    else this._labDelay = this.delay(0.5, () => { this._labDelay = null; this._labsOn = true; this.syncLabels(); });
  }

  /** Видимость подписей по текущему шагу. */
  syncLabels() {
    if (!this._labsOn) return;
    this.labels.forEach((l) => l.show());
    this.flag[this.step >= 1 ? 'show' : 'hide']();
  }

  shapeFor(key) { return key === 'red' ? this.shapeRed : key === 'src' ? this.shapeSrc : this.shapeGreen; }

  morphTo(key, opts) {
    if (this.shapeKey === key || !this.ownsParticles()) return;
    this.shapeKey = key;
    this.particles.morph(this.shapeFor(key), opts);
  }

  /** Привести граф к виду шага из любого текущего состояния (в т. ч. посреди анимации). */
  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    this._tl?.kill();
    const tl = this._tl = this.tl();
    const u = this.u, k = this.k;
    // 1) источник
    const srcT = step >= 1 ? 1 : 0;
    if (k.src !== srcT) tl.to(k, { src: srcT, duration: srcT ? 0.35 : 0.6, ease: 'power2.out' }, 0);
    if (step >= 1 && prev === 0) {
      this.fireRing(this.nodes[0]);
      this.ctx.rig.shake(0.08, 0.5);
      this.ctx.engine.pulse({ aberration: 0.9, flash: 0.05 }, 0.7);
    }
    this.syncLabels();
    // 2) каскад: вперёд — от текущего фронта, назад — «отмотка» к источнику
    const lag = step >= 2 && prev === 0 ? 0.5 : 0;
    if (step >= 2) {
      const from = Math.max(0, u.uCascade.value);
      if (from < this.tEnd) tl.fromTo(u.uCascade, { value: from }, { value: this.tEnd, duration: this.tEnd - from, ease: 'none' }, lag);
    } else if (u.uCascade.value > -1) {
      tl.to(u.uCascade, { value: -1, duration: 1.0, ease: 'power2.inOut' }, 0);
    }
    // 3) облако частиц
    const key = step >= 2 ? 'red' : step === 1 ? 'src' : 'green';
    if (key === 'red') this.morphTo('red', { duration: Math.max(...this.tArr) / 0.9 + 0.3, stagger: 0.9, burst: 5, ease: 'none', delay: lag });
    else if (key === 'src' && prev === 0) this.morphTo('src', { duration: 0.7, stagger: 0.3, burst: 4 });
    else this.morphTo(key, { duration: 1.0, stagger: 0.35, burst: 3 });
  }

  fireRing(nd) {
    nd.ringT = this.ctx.time;
    nd.ring.visible = true;
  }

  exit(o = {}) {
    this._tl?.kill();
    this._labDelay?.kill();
    this._labsOn = false;
    this.labels.forEach((l) => l.hide());
    this.flag?.hide();
    return super.exit(o);
  }

  update(dt, t) {
    const u = this.u;
    u.uTime.value = t;
    const e = this.ctx.engine;
    u.uScale.value = (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5)) * 0.06;
    const cell = Math.max(5, e.height * e.pixelRatio / 150);
    // лёгкое покачивание графа (видна глубина)
    this.group.rotation.y = Math.sin(t * 0.21) * 0.16;
    this.group.rotation.x = Math.sin(t * 0.17) * 0.05;
    if (this.ownsParticles()) this.particles.object.rotation.copy(this.group.rotation);
    const cas = u.uCascade.value;
    const cam = this.ctx.camera;
    const col = this._c || (this._c = new THREE.Color());
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      const red = i === 0 ? Math.max(this.k.src, cas >= 0 ? 1 : 0) : cas >= 0 ? THREE.MathUtils.smoothstep(cas, nd.t - 0.02, nd.t + 0.25) : 0;
      const m = nd.mesh.material.uniforms;
      m.uRed.value = red;
      m.uCell.value = cell;
      m.uPulse.value = 0.5 + 0.5 * Math.sin(t * 2.2 + nd.seed);
      const pop = red > 0 && red < 1 ? Math.sin(red * Math.PI) : 0;
      nd.mesh.scale.setScalar(nd.r * (1 + 0.05 * Math.sin(t * 2.2 + nd.seed) + 0.25 * pop));
      nd.badge.scale.setScalar(nd.r * 1.72 * (1 + 0.2 * pop));
      if (nd._tint !== red) { nd._tint = red; nd.badge.material.color.copy(BADGE_OK).lerp(BADGE_DOWN, red); }
      // момент отказа (только когда фронт идёт вперёд): ударная волна; при «отмотке» — сброс
      if (i > 0) {
        if (cas >= nd.t && !nd.fired && cas > this._lastCas) {
          nd.fired = true;
          this.fireRing(nd);
          this.ctx.rig.shake(0.035, 0.3);
        } else if (cas < nd.t) nd.fired = false;
      }
      const lab = this.labels[i];
      const down = red > 0.5;
      if (lab && lab._down !== down) { lab._down = down; lab.el.classList.toggle('is-down', down); }
      // кольцо
      if (nd.ring.visible) {
        const k = (t - nd.ringT) / 0.9;
        if (k >= 1 || k < 0) nd.ring.visible = false;
        else {
          nd.ring.scale.setScalar(nd.r * (1.2 + k * 4.5));
          nd.ring.material.opacity = (1 - k) * (1 - k);
          nd.ring.quaternion.copy(this.group.quaternion).invert().multiply(cam.quaternion);
        }
      }
    }
    // стрелки краснеют, когда каскад проходит
    let changed = false;
    for (let i = 0; i < this.edges.length; i++) {
      const ed = this.edges[i];
      const red = cas >= ed.arrowT ? 1 : 0;
      if (ed._red === red) continue;
      ed._red = red;
      changed = true;
      col.setRGB(0.12 + red * 1.28, 0.95 - red * 0.83, 0.22 - red * 0.14);
      this.arrows.setColorAt(i, col);
    }
    if (changed) this.arrows.instanceColor.needsUpdate = true;
    this._lastCas = cas;
  }
}
