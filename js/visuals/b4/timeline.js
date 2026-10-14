// Лента времени 1943 → 2026: светящаяся ось-траектория в космосе, вехи-звёзды, дуги-промежутки.
// Расстояния между вехами пропорциональны годам — к концу вехи сбиваются в кучу.
// Шаги 0…8 — вехи по одной: «комета» из частиц прокладывает ось к новой вехе, камера летит следом;
//   к концу ленты вехи идут всё чаще — и камера подходит всё ближе.
// Шаг 9 — общий план: все дуги-промежутки, по оси бежит импульс — вспышки вех учащаются.
//   Последние четыре вехи (2022–2026) стоят так тесно, что показаны ещё и в «лупе» — увеличенной врезке.
// Подписи раскладываются под каждый шаг (ярусы без наложений) и держат постоянный экранный отступ.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp } from '../../core/utils.js';
import { MILESTONES as MS, yearsWord } from './data.js';
import { glowTexture, glowMat, haloSprite, polyline, SOFT_POINTS_FRAG, pointScale, ease, easeOut } from './util.js';

const K = 0.3;                                   // мировых единиц на год
const MID = (1943 + 2026) / 2;
const X = (year) => (year - MID) * K;
const X0 = X(1943), XN = X(2026);
const LAST = MS.length - 1;                      // 8 — последняя веха
const OVERVIEW = MS.length;                      // 9 — общий план
const CLUSTER = 5;                               // с 2022-го — «гуща» в конце ленты (в общем плане — в лупе)
const ARC_K = 0.075;                             // высота дуги на год промежутка
const arcH = (years) => Math.max(0.11, years * ARC_K);
const FOV = 45;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const ASPECT = 16 / 9;                           // позы — для 16:9; под другие экраны их подгоняет ядро
const distForW = (w) => w / (2 * TAN * ASPECT);  // расстояние, на котором кадр 16:9 имеет ширину w
const wpuAt = (dist) => (2 * dist * TAN * ASPECT) / 100;   // мировых единиц в 1u (1% ширины сцены) на расстоянии dist
const STEP_W = [12.5, 12.5, 22.7, 12.5, 12.5, 12.5, 10, 8.4, 6.6];   // ширина кадра на шагах 0…8 (к концу — ближе)
const REF_W = 12.5;
const OV_W = 31.5;                               // общий план
const OV_T = [0.75, -1.3];                       // цель камеры общего плана: ось — в верхней половине кадра
// Подписи (в u): годы — под осью ярусами, промежутки — над дугами
const YEAR_TOP = 1.3, YEAR_STEP = 2.9;
const GAP_PAD = 0.4, GAP_H = 2.4;
// «Лупа» общего плана (в u сцены 16:9): центр, размер, отрезок лет, ось — на axisTop от верхнего края
const LENS = { cx: 71.5, cy: 39.5, w: 46, h: 11.6, y0: 2021.55, y1: 2026.45, axisTop: 6.8, arcK: 0.7 };
const HEAD_Y = 10;                               // сколько лет «будущего» несёт голова кометы

const AXIS_VERT = /* glsl */ `
varying float vX;
varying vec3 vN;
varying vec3 vV;
void main() {
  vX = position.x;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const AXIS_FRAG = /* glsl */ `
uniform float uFront, uOpacity, uTime, uStart, uEnd, uPulse, uPulseOn;
varying float vX;
varying vec3 vN;
varying vec3 vV;
void main() {
  float lit = 1.0 - smoothstep(uFront - 0.04, uFront + 0.04, vX);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float flow = 0.5 + 0.5 * sin(vX * 2.6 - uTime * 3.2);
  vec3 litC = vec3(0.25, 1.0, 0.25) * (0.7 + 0.35 * flow) + vec3(0.35) * facing * 0.5;
  float dash = step(0.5, fract(vX * 1.6 - uTime * 0.25));
  vec3 dimC = vec3(0.2, 0.42, 0.2);
  float ends = smoothstep(uStart, uStart + 1.2, vX) * (1.0 - smoothstep(uEnd - 5.0, uEnd, vX));
  float dp = (vX - uPulse) / 0.45;
  float pulse = uPulseOn * exp(-dp * dp);
  vec3 col = mix(dimC, litC, lit) + vec3(1.0, 1.4, 1.0) * pulse;
  float a = mix(0.5 * dash, 1.0, lit) * ends * uOpacity;
  gl_FragColor = vec4(col, clamp(a + pulse * uOpacity, 0.0, 1.0));
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aPhase;
attribute float aSpeed;
attribute vec2 aOff;
attribute float aSize;
uniform float uTime, uX0, uX1, uFront, uScale, uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // искры бегут по всей ленте с постоянной плотностью и видны только на освещённой её части
  float p = fract(aPhase + uTime * 0.045 * aSpeed);
  float x = uX0 + (uX1 - uX0) * p;
  vec3 pos = vec3(x, aOff.x, aOff.y);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uScale / max(0.05, -mv.z);
  gl_PointSize = clamp(px, 1.5, 40.0);
  float lit = 1.0 - smoothstep(uFront - 0.5, uFront + 0.05, x);
  vAlpha = 0.8 * uOpacity * smoothstep(uX0, uX0 + 0.6, x) * lit;
  vColor = mix(vec3(0.45, 1.4, 0.45), vec3(1.3), fract(aPhase * 7.31));
  if (vAlpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

// Скруглённая рамка (SDF): тёмная подложка с халфтон-точками и светящийся контур (лупа и скобка на оси).
const FRAME_VERT = /* glsl */ `
uniform vec2 uSize;
varying vec2 vP;
void main() {
  vP = (uv - 0.5) * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAME_FRAG = /* glsl */ `
uniform vec2 uBox;
uniform float uR, uLine, uFill, uDots, uOpacity, uDash, uTime;
uniform vec3 uColor, uFillCol;
varying vec2 vP;
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  float d = sdBox(vP, uBox, uR);
  float aa = max(fwidth(d), 1e-5);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float line = 1.0 - smoothstep(uLine * 0.5 - aa, uLine * 0.5 + aa, abs(d));
  if (uDash > 0.0) line *= step(0.42, fract((vP.x - vP.y) / uDash - uTime * 0.5));
  float halo = exp(-max(d, 0.0) / (uLine * 2.5)) * (1.0 - inside) * 0.35;
  vec2 c = fract(vP / uDots) - 0.5;
  float dots = (1.0 - smoothstep(0.13, 0.19, length(c))) * inside * 0.07 * uFill;
  vec3 col = uFillCol * (1.0 - line) + uColor * (line + halo + dots);
  float a = clamp(inside * uFill + line + halo + dots, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

// «Луч» лупы: полупрозрачная трапеция от скобки на оси к лупе, проявляется сверху вниз.
const BEAM_VERT = /* glsl */ `
attribute vec2 aST;
varying vec2 vST;
void main() {
  vST = aST;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uOpacity, uDraw, uTime;
uniform vec3 uColor;
varying vec2 vST;
void main() {
  if (vST.y > uDraw) discard;
  float flow = 0.7 + 0.3 * sin(vST.y * 14.0 - uTime * 2.4);
  float a = (0.16 - 0.08 * vST.y) * flow * uOpacity;
  gl_FragColor = vec4(uColor, a);
}
`;

// Ось лупы: тонкая светящаяся линия, гаснущая к краям.
const LAXIS_FRAG = /* glsl */ `
uniform float uOpacity, uA, uB, uTime;
varying float vX;
void main() {
  float e = smoothstep(uA, uA + 0.9, vX) * (1.0 - smoothstep(uB - 0.9, uB, vX));
  float flow = 0.8 + 0.2 * sin(vX * 3.0 - uTime * 2.5);
  gl_FragColor = vec4(vec3(0.3, 1.15, 0.3) * flow, e * uOpacity);
}
`;
const LAXIS_VERT = /* glsl */ `
varying float vX;
void main() { vX = position.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export default class Timeline extends Visual {
  static transition = 'morph';

  async init() {
    this.front = { x: X0 };            // освещённая часть оси (до текущей вехи)
    this.pulse = { x: X0 - 3, on: 0 }; // импульс общего плана
    this.lensK = { v: 0 };             // раскрытие лупы (0…1)
    this.keepT = { v: 0 };             // таймер повторного замера HTML-зон
    this.haloTex = glowTexture(128);
    this.keepOut = [];
    this.plan = null;
    this._wq = -1;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    // --- Ось-траектория (освещённая до текущей вехи, дальше — пунктир «будущего»)
    const xs = X0 - 2.2, xe = XN + 9;
    const axisGeo = new THREE.CylinderGeometry(0.03, 0.03, xe - xs, 10, 1, true);
    axisGeo.rotateZ(-Math.PI / 2);
    axisGeo.translate((xs + xe) / 2, 0, 0);
    this.axisU = {
      uFront: { value: X0 }, uOpacity: { value: 1 }, uTime: { value: 0 },
      uStart: { value: xs }, uEnd: { value: xe }, uPulse: { value: -100 }, uPulseOn: { value: 0 },
    };
    this.axis = new THREE.Mesh(axisGeo, new THREE.ShaderMaterial({
      uniforms: this.axisU, vertexShader: AXIS_VERT, fragmentShader: AXIS_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.root.add(this.axis);

    // --- Вехи: ядро, ореол, орбита, ударная волна
    this.nodeGeo = { core: new THREE.SphereGeometry(0.09, 24, 16), ring: new THREE.TorusGeometry(0.25, 0.01, 8, 96), shock: new THREE.TorusGeometry(0.42, 0.01, 8, 96) };
    this.nodes = MS.map((m, i) => {
      const nd = this.makeNode(i);
      nd.g.position.set(X(m.y), 0, 0);
      nd.g.scale.setScalar(0.001);
      nd.g.visible = false;
      this.root.add(nd.g);
      return nd;
    });

    // --- «Ножки» годовых подписей нижних ярусов (вершины — в layoutNow())
    this.stems = MS.map(() => {
      const l = polyline([[0, 0, 0], [0, -1, 0]], { color: 0xffffff, opacity: 0.4 });
      l.material.userData.noFade = true;
      l.visible = false;
      this.root.add(l);
      return l;
    });

    // --- Дуги-промежутки (трубки «рисуются» от вехи к вехе) и выноски к поднятым подписям
    this.arcs = [];
    for (let g = 0; g < MS.length - 1; g++) {
      const a = X(MS[g].y), b = X(MS[g + 1].y);
      const years = MS[g + 1].y - MS[g].y;
      const h = arcH(years);
      const { geo, tubular, radial } = this.arcGeo(a, b, h, years >= 15 ? 0.028 : years >= 4 ? 0.021 : 0.015);
      const mesh = new THREE.Mesh(geo, glowMat(new THREE.Color(0.4, 1.35, 0.4), 1));
      mesh.material.userData.noFade = true;
      this.root.add(mesh);
      const leader = polyline([[0, 0, 0], [0, 1, 0]], { color: 0x66ff66, opacity: 0.55 });
      leader.material.userData.noFade = true;
      leader.visible = false;
      this.root.add(leader);
      this.arcs.push({ mesh, geo, tubular, radial, p: { v: 0 }, leader, years, h, cx: (a + b) / 2 });
    }

    // --- Искры, бегущие по освещённой части оси (чем длиннее лента, тем быстрее)
    const NS = this.ctx.quality === 'low' ? 240 : 460;
    const r = rng(17);
    const sg = new THREE.BufferGeometry();
    const ph = new Float32Array(NS), sp = new Float32Array(NS), off = new Float32Array(NS * 2), sz = new Float32Array(NS);
    for (let i = 0; i < NS; i++) {
      ph[i] = r(); sp[i] = r.range(0.7, 1.3);
      off[i * 2] = r.gauss(0, 0.045); off[i * 2 + 1] = r.gauss(0, 0.045);
      sz[i] = r.range(0.045, 0.1);
    }
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    sg.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1));
    sg.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
    sg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.sparkU = { uTime: { value: 0 }, uX0: { value: X0 }, uX1: { value: XN + 0.6 }, uFront: { value: X0 }, uScale: { value: 600 }, uOpacity: { value: 1 } };
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: this.sparkU, vertexShader: SPARK_VERT, fragmentShader: SOFT_POINTS_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);

    // --- Лупа общего плана
    this.buildLens();

    // --- Формы облака частиц для каждого шага (строим заранее, с паузами)
    this.prepParticles();
    this.shapes = [];
    for (let s = 0; s <= LAST; s++) {
      this.shapes.push(this.buildShape(s));
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  /** Веха: ядро, ореол, орбита, ударная волна (s — масштаб относительно вех ленты). */
  makeNode(i, s = 1) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.nodeGeo.core, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.6, 1.35), transparent: true }));
    const halo = haloSprite(this.haloTex, new THREE.Color(0.3, 1.0, 0.3), 1.1, 0.5);
    halo.material.userData.noFade = true;
    const ring = new THREE.Mesh(this.nodeGeo.ring, glowMat(new THREE.Color(0.35, 1.2, 0.35), 0.8));
    ring.material.userData.noFade = true;
    ring.rotation.set(1.2 + (i % 3) * 0.2, 0.3 * i, 0);
    const shock = new THREE.Mesh(this.nodeGeo.shock, glowMat(new THREE.Color(0.55, 1.45, 0.55), 0));
    shock.material.userData.noFade = true;
    shock.visible = false;
    const inner = new THREE.Group();
    inner.scale.setScalar(s);
    inner.add(halo, core, ring, shock);
    g.add(inner);
    return { g, inner, core, halo, ring, shock, s: { v: 0 }, flash: 0 };
  }

  /** Полукруглая дуга-трубка от a до b высотой h (рисуется по drawRange). */
  arcGeo(a, b, h, radius, y = 0) {
    const pts = [];
    const N = 64;
    for (let k = 0; k <= N; k++) {
      const ang = Math.PI * (1 - k / N);
      pts.push(new THREE.Vector3((a + b) / 2 + Math.cos(ang) * (b - a) / 2, y + Math.sin(ang) * h, 0));
    }
    const tubular = 80, radial = 8;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tubular, radius, radial, false);
    geo.setDrawRange(0, 0);
    return { geo, tubular, radial };
  }

  // ---------- Лупа (увеличенная врезка 2022–2026 в общем плане) ----------
  buildLens() {
    const pose = this.camera(null, OVERVIEW);
    const cam = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 500);
    cam.position.fromArray(pose.pos);
    cam.lookAt(new THREE.Vector3().fromArray(pose.target));
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    // точка сцены 16:9 (в u) → мир на плоскости z = 0; и обратно
    const onPlane = (ux, uy) => {
      const p = new THREE.Vector3(ux / 50 - 1, 1 - uy / 28.125, 0.5).unproject(cam);
      const dir = p.sub(cam.position).normalize();
      return cam.position.clone().addScaledVector(dir, -cam.position.z / dir.z);
    };
    const toU = (v) => { const p = v.clone().project(cam); return [(p.x + 1) * 50, (1 - p.y) * 28.125]; };
    const wpuOf = (v) => wpuAt(v.clone().sub(cam.position).dot(fwd));
    const frameMat = (o) => new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: new THREE.Vector2(o.w, o.h) }, uBox: { value: new THREE.Vector2(o.bw / 2, o.bh / 2) },
        uR: { value: o.r }, uLine: { value: o.line }, uFill: { value: o.fill }, uDots: { value: o.dots },
        uOpacity: { value: 0 }, uDash: { value: o.dash || 0 }, uTime: { value: 0 },
        uColor: { value: new THREE.Color(0.35, 1.45, 0.35) }, uFillCol: { value: new THREE.Color(0.0, 0.02, 0.0) },
      },
      vertexShader: FRAME_VERT, fragmentShader: FRAME_FRAG, transparent: true, depthWrite: false, depthTest: false,
    });

    const L = (this.lens = { root: new THREE.Group() });
    L.root.visible = false;
    this.root.add(L.root);

    // --- скобка вокруг «гущи» на оси (центр — 2024 г.)
    const bc = new THREE.Vector3(X((LENS.y0 + LENS.y1) / 2), 0, 0.02);
    const bw0 = wpuOf(bc);
    const bwU = (X(LENS.y1) - X(LENS.y0)) / bw0 + 1.4, bhU = 3.0;
    const bMat = frameMat({ w: (bwU + 2) * bw0, h: (bhU + 2) * bw0, bw: bwU * bw0, bh: bhU * bw0, r: 1.2 * bw0, line: 0.16 * bw0, fill: 0.0, dots: 1, dash: 0 });
    bMat.userData.noFade = true;
    const bracket = new THREE.Mesh(new THREE.PlaneGeometry((bwU + 2) * bw0, (bhU + 2) * bw0), bMat);
    bracket.position.copy(bc);
    bracket.quaternion.copy(cam.quaternion);
    bracket.renderOrder = 11;
    L.root.add(bracket);
    L.bracket = bracket;

    // --- рамка лупы
    const lc = onPlane(LENS.cx, LENS.cy);
    const lw = wpuOf(lc);
    L.center = lc.clone();
    L.wpu = lw;
    const g = new THREE.Group();
    g.position.copy(lc);
    g.quaternion.copy(cam.quaternion);
    L.root.add(g);
    L.g = g;
    const fMat = frameMat({ w: (LENS.w + 2) * lw, h: (LENS.h + 2) * lw, bw: LENS.w * lw, bh: LENS.h * lw, r: 1.5 * lw, line: 0.2 * lw, fill: 0.84, dots: 0.85 * lw });
    fMat.userData.noFade = true;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry((LENS.w + 2) * lw, (LENS.h + 2) * lw), fMat);
    frame.renderOrder = 11;
    g.add(frame);
    L.frame = frame;

    // --- содержимое лупы: ось, вехи, дуги (в координатах лупы, 1u = lw)
    const inner = LENS.w - 2.4;
    const M = (inner * lw) / ((LENS.y1 - LENS.y0) * K);          // увеличение лупы
    const yc = (LENS.y0 + LENS.y1) / 2;
    const lx = (year) => (year - yc) * K * M;
    const ay = (LENS.h / 2 - LENS.axisTop) * lw;
    L.lx = lx; L.ay = ay; L.M = M;
    const content = new THREE.Group();
    g.add(content);
    L.content = content;
    const a0 = -(LENS.w / 2 - 0.6) * lw, a1 = (LENS.w / 2 - 0.6) * lw;
    const axGeo = new THREE.CylinderGeometry(0.09 * lw, 0.09 * lw, a1 - a0, 8, 1, true);
    axGeo.rotateZ(-Math.PI / 2);
    axGeo.translate((a0 + a1) / 2, ay, 0.02);
    L.axisU = { uOpacity: { value: 0 }, uA: { value: a0 }, uB: { value: a1 }, uTime: { value: 0 } };
    const axMat = new THREE.ShaderMaterial({ uniforms: L.axisU, vertexShader: LAXIS_VERT, fragmentShader: LAXIS_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    axMat.userData.noFade = true;
    const ax = new THREE.Mesh(axGeo, axMat);
    ax.renderOrder = 12;
    content.add(ax);
    // вехи лупы — того же вида, что и на ленте, но крупнее (ядро ≈ 1.3u)
    const ns = (0.65 * lw) / 0.09;
    L.nodes = [];
    for (let i = CLUSTER; i <= LAST; i++) {
      const nd = this.makeNode(i, ns);
      nd.g.position.set(lx(MS[i].y), ay, 0.04);
      nd.halo.scale.setScalar(1);
      nd.inner.traverse((o) => { o.renderOrder = 13; if (o.material) o.material.depthTest = false; });
      content.add(nd.g);
      L.nodes.push(nd);
    }
    L.arcs = [];
    for (let gI = CLUSTER; gI < LAST; gI++) {
      const years = MS[gI + 1].y - MS[gI].y;
      const h = arcH(years) * M * LENS.arcK;                        // по вертикали дуги лупы чуть сжаты
      const { geo, tubular, radial } = this.arcGeo(lx(MS[gI].y), lx(MS[gI + 1].y), h, 0.1 * lw, ay);
      const mat = glowMat(new THREE.Color(0.4, 1.35, 0.4), 0, { depthTest: false });
      mat.userData.noFade = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 12;
      content.add(mesh);
      L.arcs.push({ mesh, geo, tubular, radial, g: gI, years, top: ay + h, cx: (lx(MS[gI].y) + lx(MS[gI + 1].y)) / 2 });
    }

    // --- луч от скобки к лупе (уже лупы — чтобы не задевать подписи 2012/2016)
    const [bu] = toU(bc);
    const bL = bc.clone().addScaledVector(right, -(bwU / 2 - 0.9) * bw0).addScaledVector(up, -(bhU / 2) * bw0);
    const bR = bc.clone().addScaledVector(right, (bwU / 2 - 0.9) * bw0).addScaledVector(up, -(bhU / 2) * bw0);
    const half = LENS.w / 2 - 2;
    const cL = clamp(bu - 4.2 - LENS.cx, -half, half), cR = clamp(bu + 6.8 - LENS.cx, -half, half);
    const lL = lc.clone().addScaledVector(right, cL * lw).addScaledVector(up, (LENS.h / 2) * lw);
    const lR = lc.clone().addScaledVector(right, cR * lw).addScaledVector(up, (LENS.h / 2) * lw);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...bL.toArray(), ...bR.toArray(), ...lL.toArray(), ...lR.toArray()]), 3));
    bGeo.setAttribute('aST', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    bGeo.setIndex([0, 2, 1, 1, 2, 3]);
    L.beamU = { uOpacity: { value: 0 }, uDraw: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.3, 1.2, 0.3) } };
    const beamMat = new THREE.ShaderMaterial({ uniforms: L.beamU, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    beamMat.userData.noFade = true;
    const beam = new THREE.Mesh(bGeo, beamMat);
    beam.renderOrder = 11;
    beam.frustumCulled = false;
    L.root.add(beam);
    const edge = (A, B) => {
      const pts = [];
      for (let k = 0; k <= 24; k++) pts.push(A.clone().lerp(B, k / 24));
      const l = polyline(pts, { color: 0x55ff55, opacity: 0 });
      l.material.userData.noFade = true;
      l.material.depthTest = false;
      l.renderOrder = 11;
      l.frustumCulled = false;
      L.root.add(l);
      return l;
    };
    L.edges = [edge(bL, lL), edge(bR, lR)];
    // точка привязки для масштабирования лупы при раскрытии — середина верхнего края над лучом
    L.pivot = new THREE.Vector3().addScaledVector(right, ((cL + cR) / 2) * lw).addScaledVector(up, (LENS.h / 2) * lw);
  }

  // ---------- Облако частиц ----------
  prepParticles() {
    const n = this.ctx.particles.count;
    const r = rng(1943);
    this.nLine = Math.floor(n * 0.3);
    this.nNode = Math.floor(n * 0.08);
    const P = (this.pre = {
      year: new Float32Array(n), a: new Float32Array(n * 3), h: new Float32Array(n * 3), f: new Float32Array(n * 3),
      col: new Float32Array(n * 3), alpha: new Float32Array(n), size: new Float32Array(n), node: new Int16Array(n),
    });
    const pick = (k, list) => { let acc = 0; for (const [w, c] of list) { acc += w; if (k < acc) return c; } return list[list.length - 1][1]; };
    const perNode = this.nNode / MS.length;
    for (let i = 0; i < n; i++) {
      let c, al, sz;
      // «голова кометы» — позади фронта (несёт ближайшее «будущее»)
      const hx = -Math.abs(r.gauss(0, 0.5)) - 0.03;
      const hs = 0.05 + 0.13 * Math.abs(hx);
      P.h[i * 3] = hx; P.h[i * 3 + 1] = r.gauss(0, hs); P.h[i * 3 + 2] = r.gauss(0, hs);
      // «пыль будущего» — редкая и тусклая вдоль пунктира
      P.f[i * 3] = r(); P.f[i * 3 + 1] = r.gauss(0, 0.3); P.f[i * 3 + 2] = r.gauss(0, 0.3);
      if (i < this.nLine) {
        P.year[i] = 1943 + r() * 83;
        const wide = r() < 0.35;
        const sd = wide ? 0.16 : 0.035;
        P.a[i * 3] = r.gauss(0, 0.02); P.a[i * 3 + 1] = r.gauss(0, sd); P.a[i * 3 + 2] = r.gauss(0, sd);
        c = pick(r(), [[0.55, S.PAL.green], [0.22, S.PAL.mint], [0.23, S.PAL.white]]);
        al = (wide ? r.range(0.06, 0.16) : r.range(0.16, 0.36)) * (P.year[i] > 2021 ? 0.6 : 1);
        sz = wide ? r.range(0.45, 0.85) : r.range(0.5, 0.95);
        P.node[i] = -1;
      } else if (i < this.nLine + this.nNode) {
        const nd = Math.min(MS.length - 1, Math.floor((i - this.nLine) / perNode));
        P.node[i] = nd;
        const [x, y, z] = r.onSphere(1);
        // в «гуще» (2022–2026) звёзды-вехи компактнее — иначе сливаются в белое пятно
        const rad = (0.16 + 0.22 * Math.pow(r(), 1.5)) * (nd >= CLUSTER ? 0.5 : 1);
        P.a[i * 3] = x * rad; P.a[i * 3 + 1] = y * rad; P.a[i * 3 + 2] = z * rad;
        c = pick(r(), [[0.35, S.PAL.greenHi], [0.1, S.PAL.bright], [0.55, S.PAL.white]]);
        al = r.range(0.12, 0.32) * (nd >= CLUSTER ? 0.6 : 1);
        sz = r.range(0.5, 1.0);
      } else {
        // Звёздная «река» позади ленты + редкое поле
        P.node[i] = -2;
        let x, y, z;
        if (r() < 0.8) {
          x = r.range(-34, 34); y = r.gauss(0, 2.6) + x * 0.07 - 0.6; z = r.range(-38, -8);
        } else {
          [x, y, z] = r.onSphere(r.range(30, 60)); z = -Math.abs(z) * 0.8 - 6;
        }
        P.a[i * 3] = x; P.a[i * 3 + 1] = y; P.a[i * 3 + 2] = z;
        c = pick(r(), [[0.66, S.PAL.white], [0.15, S.PAL.mint], [0.13, S.PAL.blue], [0.06, S.PAL.pale]]);
        al = r.range(0.08, 0.32);
        sz = Math.pow(r(), 4) * 2.2 + 0.45;
      }
      P.col[i * 3] = c[0]; P.col[i * 3 + 1] = c[1]; P.col[i * 3 + 2] = c[2];
      P.alpha[i] = al; P.size[i] = sz;
    }
  }

  buildShape(step) {
    const n = this.ctx.particles.count;
    const s = S.createShape(n);
    const P = this.pre;
    const k = Math.min(step, LAST);
    const fy = MS[k].y, fx = X(fy);
    const fEnd = XN + 4;
    const col = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      let x, y, z, a = P.alpha[i], sz = P.size[i];
      col[0] = P.col[j]; col[1] = P.col[j + 1]; col[2] = P.col[j + 2];
      const nd = P.node[i];
      let where = 0;                                   // 0 — на месте, 1 — в голове кометы, 2 — пыль будущего
      if (nd === -2) { x = P.a[j]; y = P.a[j + 1]; z = P.a[j + 2]; }
      else if (nd === -1) {
        if (P.year[i] <= fy + 1e-3) { x = X(P.year[i]) + P.a[j]; y = P.a[j + 1]; z = P.a[j + 2]; }
        else where = P.year[i] <= fy + HEAD_Y ? 1 : 2;
      } else if (nd <= k) {
        x = X(MS[nd].y) + P.a[j]; y = P.a[j + 1]; z = P.a[j + 2];
      } else where = nd === k + 1 ? 1 : 2;
      if (where === 1) {
        x = fx + P.h[j]; y = P.h[j + 1]; z = P.h[j + 2];
        a *= 0.38; sz *= 0.85;
        if ((i & 7) === 0) { col[0] = S.PAL.greenHi[0]; col[1] = S.PAL.greenHi[1]; col[2] = S.PAL.greenHi[2]; }
      } else if (where === 2) {
        x = nd === -1 ? X(P.year[i]) + (P.f[j] - 0.5) * 0.3 : fx + 0.4 + (fEnd - fx - 0.4) * P.f[j];
        y = P.f[j + 1]; z = P.f[j + 2];
        a *= 0.1; sz *= 0.8;
      }
      S.setPoint(s, i, x, y, z, sz, col, a);
    }
    return S.equalize(s, { cell: 0.1, target: 3.2, floor: 0.004 });
  }

  // ---------- Камера и фон ----------
  camera(state, step) {
    if (step >= OVERVIEW) {
      const d = distForW(OV_W);
      return { pos: [OV_T[0] - d * 0.035, OV_T[1] + d * 0.055, d], target: [OV_T[0], OV_T[1], 0], fov: FOV, duration: 2.2, arc: 0.1 };
    }
    const n = clamp(step, 0, LAST);
    const W = STEP_W[n], d = distForW(W), H = W / ASPECT;
    const cx = X(MS[n].y) - W * 0.13;
    // ось — чуть выше центра кадра; для длинной дуги 1958→1997 — ниже, чтобы дуга не упёрлась в заголовок
    const ty = n === 2 ? 0.06 * H : -0.04 * H;
    return { pos: [cx - d * 0.08, ty + d * 0.05, d], target: [cx, ty, 0], fov: FOV, duration: n === 2 ? 2.1 : 1.6, arc: 0.06 };
  }

  background(state, step) { return step >= OVERVIEW ? 'bottom' : 'none'; }

  /** Размер частиц: при наезде камеры точки крупнее на экране — уменьшаем, чтобы «гуща» не выгорала. */
  partSize(step) {
    const W = step >= OVERVIEW ? OV_W : STEP_W[clamp(step, 0, LAST)];
    return 0.058 * Math.pow(clamp(W / REF_W, 0.5, 1), 0.7);
  }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.12, swirl: 0, size: this.partSize(this.step), twinkle: 0.3, spring: 18, damping: 6.2, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    const obj = p.object;
    const d = o.instant ? 0 : 1.6;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    this.makeLabels();
    // HTML ещё «въезжает» (data-anim) — меряем сразу и повторно, когда анимация появления закончится
    this.measureKeepOut(o.el);
    this.delay(1.4, () => { if (this.active) this.measureKeepOut(); });
    this.lastShape = -1;
    // состояние прошлого показа: лишние вехи, дуги и лупу убираем сразу
    const k0 = Math.min(this.step, LAST);
    this.nodes.forEach((nd, i) => { nd.target = undefined; nd.flash = 0; nd.shock.visible = false; if (i > k0) { nd.s.v = 0; nd.g.visible = false; } });
    this.arcs.forEach((a, g) => { a.target = undefined; if (g >= k0) a.p.v = 0; });
    this.front.x = Math.min(this.front.x, X(MS[k0].y));
    this.pulse.on = 0; this.pulse.x = X0 - 3;
    this.lensK.v = 0;                  // лупа всегда раскрывается заново, когда камера уже на месте
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  makeLabels() {
    this.removeLabels();
    this.yearLabels = MS.map((m) => this.label({
      html: `<div class="b4-ms"><span class="b4-ms-y">${m.y}</span></div>`,
      position: [X(m.y), -0.5, 0], anchor: 'top', visible: false,
    }));
    this.gapLabels = this.arcs.map((a) => this.label({
      html: `<div class="b4-gap">${yearsWord(a.years)}</div>`,
      position: [a.cx, a.h + 0.2, 0], anchor: 'bottom', visible: false,
    }));
    // подписи лупы привязаны к её группе (едут и масштабируются вместе с ней)
    const L = this.lens, lw = L.wpu;
    this.lensYearLabels = L.nodes.map((nd, j) => this.label({
      html: `<div class="b4-ms b4-ms-lens"><span class="b4-ms-y">${MS[CLUSTER + j].y}</span></div>`,
      object: L.g, offset: [nd.g.position.x, L.ay - 1.05 * lw, 0.05], anchor: 'top', visible: false,
    }));
    this.lensGapLabels = L.arcs.map((a) => this.label({
      html: `<div class="b4-gap">${yearsWord(a.years)}</div>`,
      object: L.g, offset: [a.cx, a.top + 0.35 * lw, 0.05], anchor: 'bottom', visible: false,
    }));
    this.plan = null;
    this._wq = -1;
  }

  setStep(step, o = {}) {
    this.step = step;
    this.measureKeepOut(o.el);
    // панель вехи ещё «въезжает» — перемерить, когда встанет на место
    this.twk('keepOut', this.keepT, { v: 1, duration: 1.2, onComplete: () => { this.keepT.v = 0; if (this.active) this.measureKeepOut(); } });
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const instant = !!o.instant;
    const fwd = (o.dir ?? 1) >= 0;
    const ov = step >= OVERVIEW;
    const k = Math.min(step, LAST);
    // частицы: комета прокладывает ось до текущей вехи
    if (this.lastShape !== k) {
      this.particles.morph(this.shapes[k], {
        duration: instant ? 0.01 : (o.entering ? 2.2 : 1.7),
        stagger: o.entering ? 0.5 : 0.3,
        burst: o.entering ? 10 : 4,
      });
      this.lastShape = k;
    }
    if (!o.entering) this.particles.setParams({ size: this.partSize(step) }, instant ? 0 : 1.4);
    // освещённая часть оси
    this.twk('front', this.front, { x: X(MS[k].y), duration: instant ? 0 : (k === 2 ? 1.9 : 1.3), ease: 'power2.inOut' });
    // вехи (цели запоминаем: быстрые клики туда-обратно не должны «терять» вехи посреди анимации)
    this.nodes.forEach((nd, i) => {
      const want = i <= k ? 1 : 0;
      if (nd.target === want && !instant) return;
      nd.target = want;
      if (want) {
        nd.g.visible = true;
        if (i === k && fwd && !instant && nd.s.v < 0.5) {
          nd.s.v = 0.001;
          this.twk('node' + i, nd.s, { v: 1, duration: 1.1, delay: 0.45, ease: 'back.out(2.2)' });
          this.delay(0.45, () => { if (nd.target === 1 && Math.min(this.step, LAST) === i) this.flashNode(nd); });
        } else {
          this.twk('node' + i, nd.s, { v: 1, duration: instant ? 0 : 0.6, ease: 'power2.out' });
        }
      } else {
        this.twk('node' + i, nd.s, { v: 0, duration: instant ? 0 : 0.45, ease: 'power2.in' });
      }
    });
    // дуги
    this.arcs.forEach((a, g) => {
      const want = g < k ? 1 : 0;
      if (a.target === want && !instant) return;
      a.target = want;
      if (want === 1) {
        const fresh = g === k - 1 && fwd && !instant && a.p.v < 0.5;
        this.twk('arc' + g, a.p, { v: 1, duration: instant ? 0 : fresh ? 1.25 : 0.6, delay: fresh ? 0.15 : 0, ease: 'power1.inOut' });
      } else {
        this.twk('arc' + g, a.p, { v: 0, duration: instant ? 0 : 0.45, ease: 'power1.in' });
      }
    });
    // общий план: импульс по оси (вспышки вех учащаются) и лупа над «гущей» 2022–2026
    if (ov && !instant) {
      this.pulse.on = 1;
      this.pulse.x = X0 - 1.5;
      this.twk('pulse', this.pulse, { x: XN + 2.5, duration: 3.2, delay: 1.0, ease: 'none' });
    } else {
      this.twk('pulse', this.pulse, { x: X0 - 3, duration: 0 });
      this.pulse.on = 0;
    }
    if (ov) this.twk('lens', this.lensK, { v: 1, duration: instant ? 0 : 1.8, delay: instant ? 0 : 1.25, ease: 'none' });
    else this.twk('lens', this.lensK, { v: 0, duration: instant ? 0 : 0.45, ease: 'power2.in' });
    // раскладка подписей под этот шаг
    this.plan = this.planLayout(step);
    this._wq = -1;
    if (!instant && fwd && !o.entering) this.ctx.engine.pulse({ aberration: 0.45 }, 0.9);
  }

  flashNode(nd) {
    nd.shock.visible = true;
    nd.shock.scale.setScalar(0.3);
    this.tw(nd.shock.scale, { x: 5.5, y: 5.5, z: 5.5, duration: 1.2, ease: 'expo.out', overwrite: true });
    nd.flash = 1;
    this.tw(nd, { flash: 0, duration: 1.0, ease: 'power2.out', overwrite: true });
  }

  exit(o = {}) {
    // подписи гасим сразу (иначе они «висят» над следующим слайдом)
    this.allLabels().forEach((l) => l.hide());
    const p = super.exit(o);
    p.then(() => { if (!this.active) this.removeLabels(); });
    return p;
  }

  allLabels() {
    return [...(this.yearLabels || []), ...(this.gapLabels || []), ...(this.lensYearLabels || []), ...(this.lensGapLabels || [])];
  }

  // ---------- Раскладка подписей ----------
  /** u в пикселях (как --u в CSS: 1% ширины сцены 16:9). */
  uPx() { return Math.max(1, Math.min(window.innerWidth, window.innerHeight * ASPECT) / 100); }

  /** Ширина подписи в u (меряем один раз; пока шрифт не готов — оценка). */
  labelW(l, fallback) {
    if (!l) return fallback;
    if (!l._wu) {
      const r = l.inner.getBoundingClientRect();
      if (r.width > 1) l._wu = r.width / this.uPx();
    }
    return l._wu || fallback;
  }

  /**
   * Раскладка подписей на шаг (в u — экранных единицах): годы — под осью на самом верхнем ярусе, где нет
   * наложения; промежутки — над своей дугой, а если тесно или мешает соседняя дуга — выше, с выноской.
   */
  planLayout(step) {
    const ov = step >= OVERVIEW;
    const k = Math.min(step, LAST);
    const wpu = (ov ? OV_W : STEP_W[k]) / 100;
    const years = MS.map(() => null), gaps = this.arcs.map(() => null);
    if (!this.yearLabels) return { years, gaps };
    // новая веха — первой (ей — верхний ярус у самой оси), дальше — справа налево
    const tiers = [[], [], [], [], []];
    for (let i = k; i >= 0; i--) {
      if (ov && i >= CLUSTER) continue;               // в общем плане «гуща» подписана в лупе
      const xu = X(MS[i].y) / wpu;
      const w = this.labelW(this.yearLabels[i], 5.4) * (i === k && !ov ? 1.25 : 1) + 1.0;
      const x0 = xu - w / 2, x1 = xu + w / 2;
      let lvl = 0;
      while (lvl < 4 && tiers[lvl].some((r) => x0 < r[1] && x1 > r[0])) lvl++;
      tiers[lvl].push([x0, x1]);
      years[i] = { lvl };
    }
    const arcAt = (j, xu) => {
      const x0 = X(MS[j].y) / wpu, x1 = X(MS[j + 1].y) / wpu;
      if (xu <= x0 || xu >= x1) return 0;
      return Math.sin(Math.PI * (xu - x0) / (x1 - x0)) * this.arcs[j].h / wpu;
    };
    const rects = [];
    for (let g = k - 1; g >= 0; g--) {                // свежий промежуток — первым (у самой дуги)
      if (ov && g >= CLUSTER) continue;
      const a = this.arcs[g];
      const xu = a.cx / wpu, top = a.h / wpu;
      const w = this.labelW(this.gapLabels[g], 6) + 0.8;
      const x0 = xu - w / 2, x1 = xu + w / 2;
      let y = top + GAP_PAD;
      for (let j = 0; j < k; j++) {
        if (j === g) continue;
        for (let s = 0; s <= 4; s++) y = Math.max(y, arcAt(j, x0 + (x1 - x0) * (s / 4)) + 0.6);
      }
      for (let guard = 0; guard < 10; guard++) {
        const hit = rects.find((r) => x0 < r.x1 && x1 > r.x0 && y < r.y1 && y + GAP_H > r.y0);
        if (!hit) break;
        y = hit.y1 + 0.3;
      }
      rects.push({ x0, x1, y0: y, y1: y + GAP_H });
      gaps[g] = { extra: y - top, lead: y - top > GAP_PAD + 0.7 };
    }
    return { years, gaps };
  }

  /** Поставить подписи, «ножки» и выноски по плану при текущем масштабе (wpu — мир в 1u). */
  layoutNow(wpu, ns) {
    const plan = this.plan;
    if (!plan || !this.yearLabels) return;
    MS.forEach((m, i) => {
      const pl = plan.years[i];
      const x = X(m.y);
      const y = -(YEAR_TOP + (pl ? pl.lvl : 0) * YEAR_STEP) * wpu;
      this.yearLabels[i].setPosition(x, y, 0);
      const st = this.stems[i];
      st.userData.on = !!(pl && pl.lvl > 0);
      if (st.userData.on) {
        const pos = st.geometry.attributes.position;
        pos.setXYZ(0, x, -0.12 * ns, 0); pos.setXYZ(1, x, y + 0.15 * wpu, 0);
        pos.needsUpdate = true;
      }
    });
    this.arcs.forEach((a, g) => {
      const pl = plan.gaps[g];
      const y = a.h + (pl ? pl.extra : GAP_PAD) * wpu;
      this.gapLabels[g].setPosition(a.cx, y, 0);
      a.leader.userData.on = !!(pl && pl.lead);
      if (a.leader.userData.on) {
        const pos = a.leader.geometry.attributes.position;
        pos.setXYZ(0, a.cx, a.h + 0.03, 0); pos.setXYZ(1, a.cx, y - 0.1 * wpu, 0);
        pos.needsUpdate = true;
      }
    });
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const op = this.opacity;
    const k = Math.min(this.step, LAST);
    const ov = this.step >= OVERVIEW;
    this.axisU.uTime.value = t;
    this.axisU.uFront.value = this.front.x;
    this.axisU.uPulse.value = this.pulse.x;
    this.axisU.uPulseOn.value = this.pulse.on;
    this.sparkU.uTime.value = t;
    this.sparkU.uFront.value = this.front.x;
    this.sparkU.uScale.value = pointScale(this.ctx);

    // масштаб: мир в 1u при текущем расстоянии камеры; вехи вблизи — компактнее (иначе «гуща» слипается)
    const wpu = clamp(wpuAt(Math.max(0.5, this.ctx.camera.position.z)), 0.02, 0.6);
    const ns = clamp((wpu * 100) / REF_W, 0.55, 1);
    const wq = Math.round(wpu * 4000);
    if (wq !== this._wq) { this._wq = wq; this.layoutNow(wpu, ns); }
    this.axis.scale.set(1, ns, ns);

    // вехи (простые циклы — без замыканий и аллокаций в кадре)
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      const v = nd.s.v;
      nd.g.visible = v > 0.002;
      if (!nd.g.visible) continue;
      let wave = 0;
      if (this.pulse.on) {
        const dx = (nd.g.position.x - this.pulse.x) / 0.35;
        wave = Math.exp(-dx * dx);
      }
      const isNew = i === k && !ov;
      const pul = isNew ? 0.15 * Math.sin(t * 3.2) : 0;
      nd.g.scale.setScalar(Math.max(0.001, v * ns * (1 + 0.45 * nd.flash + 0.55 * wave)));
      // в «гуще» ореолы меньше и тише — иначе соседние вехи сливаются в белое пятно
      const hk = i >= CLUSTER && !ov ? (isNew ? 0.75 : 0.6) : 1;
      nd.halo.scale.setScalar(((isNew ? 1.5 : 1.0) + pul + nd.flash * 2.2 + wave * 1.6) * hk);
      nd.halo.material.opacity = op * (isNew ? 0.6 : i >= CLUSTER ? 0.26 : 0.38) + op * 0.4 * wave;
      nd.ring.rotation.z += dt * (0.6 + i * 0.05);
      nd.ring.rotation.x += dt * 0.15;
      nd.ring.material.opacity = op * (isNew ? 0.9 : 0.45);
      if (nd.shock.visible) {
        nd.shock.material.opacity = op * nd.flash;
        nd.shock.quaternion.copy(this.ctx.camera.quaternion);
        if (nd.flash <= 0.01) nd.shock.visible = false;
      }
    }
    // дуги: свежая — ярче, старые — приглушённые
    for (let g = 0; g < this.arcs.length; g++) {
      const a = this.arcs[g];
      const v = a.p.v;
      const n = Math.round(v * a.tubular) * a.radial * 6;
      a.geo.setDrawRange(0, n);
      a.mesh.visible = n > 0;
      const fresh = g === k - 1 || ov;
      const dp = (a.cx - this.pulse.x) / 0.8;
      const pw = this.pulse.on ? 0.5 * Math.exp(-dp * dp) : 0;
      a.mesh.material.opacity = op * ((fresh ? 0.95 : 0.36) + pw);
    }

    // лупа
    this.updateLens(dt, t, op);

    // подписи — по факту состояния (устойчиво к быстрым кликам в обе стороны);
    // прячем те, что вылезли за кадр или наехали на HTML-заголовок / панель вехи
    const plan = this.plan;
    if (this.yearLabels && this.active && plan) {
      for (let i = 0; i < this.yearLabels.length; i++) {
        const l = this.yearLabels[i];
        const want = !!plan.years[i] && this.nodes[i].s.v > 0.6 && this.fits(l, 'top');
        if (want !== l.visible) { if (want) l.show(); else l.hide(); }
        this.stems[i].visible = want && this.stems[i].userData.on;
        this.stems[i].material.opacity = op * 0.4;
        const isNew = i === k && !ov;
        if (l._new !== isNew) { l._new = isNew; l.el.classList.toggle('is-new', isNew); }
      }
      for (let g = 0; g < this.gapLabels.length; g++) {
        const l = this.gapLabels[g], a = this.arcs[g];
        // дуга, чьё начало за кадром, подписи не получает (иначе «висящая» цифра у края)
        const v = this._v2.set(X(MS[g].y), 0, 0).project(this.ctx.camera);
        const want = !!plan.gaps[g] && a.p.v > 0.85 && v.x > -0.98 && this.fits(l, 'bottom');
        if (want !== l.visible) { if (want) l.show(); else l.hide(); }
        a.leader.visible = want && a.leader.userData.on;
        a.leader.material.opacity = op * 0.55;
      }
      const lensOn = this.lensK.v > 0.9 && ov;
      for (const l of this.lensYearLabels) if (lensOn !== l.visible) { if (lensOn) l.show(); else l.hide(); }
      for (const l of this.lensGapLabels) if (lensOn !== l.visible) { if (lensOn) l.show(); else l.hide(); }
    }
  }

  updateLens(dt, t, op) {
    const L = this.lens, v = this.lensK.v;
    L.root.visible = v > 0.001;
    if (!L.root.visible) return;
    const kb = ease(clamp(v / 0.22)), kBeam = clamp((v - 0.12) / 0.3), kf = easeOut(clamp((v - 0.3) / 0.32));
    const kc = easeOut(clamp((v - 0.48) / 0.25)), ka = clamp((v - 0.58) / 0.3);
    // скобка вокруг «гущи» на оси
    const bu = L.bracket.material.uniforms;
    bu.uOpacity.value = op * kb;
    bu.uTime.value = t;
    L.bracket.scale.setScalar(0.75 + 0.25 * kb);
    // луч
    L.beamU.uDraw.value = kBeam;
    L.beamU.uOpacity.value = op * Math.min(1, kBeam * 3);
    L.beamU.uTime.value = t;
    const ne = Math.round(kBeam * 24) + 1;
    for (const e of L.edges) { e.geometry.setDrawRange(0, kBeam > 0 ? ne : 0); e.material.opacity = op * 0.5 * Math.min(1, kBeam * 3); }
    // рамка: раскрывается от точки, куда приходит луч
    const s = 0.8 + 0.2 * kf;
    L.g.scale.setScalar(s);
    L.g.position.copy(L.center).addScaledVector(L.pivot, 1 - s);
    L.frame.material.uniforms.uOpacity.value = op * kf;
    L.frame.material.uniforms.uTime.value = t;
    // содержимое: ось, вехи (вспыхивают вместе с импульсом на ленте), дуги
    L.axisU.uOpacity.value = op * kc * 0.85;
    L.axisU.uTime.value = t;
    for (let j = 0; j < L.nodes.length; j++) {
      const nd = L.nodes[j], i = CLUSTER + j;
      let wave = 0;
      if (this.pulse.on) { const dx = (X(MS[i].y) - this.pulse.x) / 0.35; wave = Math.exp(-dx * dx); }
      nd.g.visible = kc > 0.01;
      nd.g.scale.setScalar(Math.max(0.001, kc * (1 + 0.5 * wave)));
      nd.halo.scale.setScalar(1.0 + wave * 1.4);
      nd.halo.material.opacity = op * kc * (0.42 + 0.45 * wave);
      nd.ring.rotation.z += dt * (0.6 + i * 0.05);
      nd.ring.material.opacity = op * kc * 0.55;
    }
    for (const a of L.arcs) {
      const n = Math.round(ka * a.tubular) * a.radial * 6;
      a.geo.setDrawRange(0, n);
      a.mesh.visible = n > 0;
      const dp = (X(MS[a.g].y + a.years / 2) - this.pulse.x) / 0.8;
      a.mesh.material.opacity = op * (0.95 + (this.pulse.on ? 0.5 * Math.exp(-dp * dp) : 0));
    }
  }

  /** Помещается ли подпись: целиком в кадре и не поверх HTML-заголовка и панели вехи (экранные пиксели). */
  fits(l, anchor) {
    const v = this._v;
    v.copy(l.position).project(this.ctx.camera);
    if (v.z > 1) return false;
    const W = this.ctx.width, H = this.ctx.height;
    const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
    if (!l._w) {
      const r = l.inner.getBoundingClientRect();
      if (r.width > 0) { l._w = r.width; l._h = r.height; }
    }
    const w = (l._w || 80) * (l._new ? 1.25 : 1.05), h = l._h || 30;
    let x0, y0;
    if (anchor === 'bottom') { x0 = px - w / 2; y0 = py - h; }
    else { x0 = px - w / 2; y0 = py; }
    const x1 = x0 + w, y1 = y0 + h, m = 6;
    if (x0 < m || y0 < m || x1 > W - m || y1 > H - m) return false;
    for (const r of this.keepOut) if (x0 < r.x1 + m && x1 > r.x0 - m && y0 < r.y1 + m && y1 > r.y0 - m) return false;
    return true;
  }

  /** Запомнить прямоугольники HTML-заголовка, текущей вехи и итоговой подписи (на экране). */
  measureKeepOut(el) {
    this.keepOut = [];
    const root = el || this.ctx.deck?.currentEl;
    if (!root) return;
    for (const sel of ['.b4-tl-head .t-title', '.b4-tl-head .t-kicker', '.b4-tl-item.is-shown', '.b4-tl-caption.is-shown .panel']) {
      const n = root.querySelector(sel);
      if (!n) continue;
      const r = n.getBoundingClientRect();
      if (r.width > 0) this.keepOut.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
  }

  resize() {
    if (!this.active) return;
    this.measureKeepOut();
    this.allLabels().forEach((l) => { l._w = 0; l._wu = 0; });
    this.plan = this.planLayout(this.step);
    this._wq = -1;
  }
}
