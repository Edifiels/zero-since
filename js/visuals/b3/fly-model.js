// Процедурная модель дрозофилы для визуализаций блока 3.
//
//   const fly = new FlyModel();  root.add(fly.group);  …  fly.update(dt, t)
//   fly.p — параметры (плавно меняйте через gsap): solid / wire — видимость сплошного тела и каркаса,
//     xray — «рентген» тела, headXray — прозрачная голова (видно мозг), flight — взмахи крыльев,
//     hover — лапки поджаты (полёт), walk — трёхногая походка, groom — чистка усиков передними лапками,
//     proboscis — хоботок (0 — убран, 1 — вытянут), glow — яркость глаз.
//
// Координаты модели: перед — +Z, верх — +Y, левая сторона мухи — +X; единица ≈ 1 мм (длина тела ≈ 2.7).
// Тело (fly.body) покачивается внутри корня (fly.group); лапки считаются в координатах корня (ступни — на «земле»).
import * as THREE from 'three';
import { HALFTONE } from '../../core/glsl.js';
import { rng } from '../../core/utils.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------------------
// Шейдеры

const BODY_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 nn = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  nn = mat3(instanceMatrix) * nn;
#endif
  vObj = position;
  vec4 mv = modelViewMatrix * lp;
  vN = normalize(normalMatrix * nn);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const BODY_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uAlpha;
uniform float uXray;
uniform float uStripe;
uniform float uCell;
uniform float uHT;
uniform float uSpec;
uniform float uDark;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
${HALFTONE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  if (!gl_FrontFacing) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float f = 1.0 - ndv;
  float rim = f * f * f * f;
  vec3 L = normalize(vec3(0.45, 0.85, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 H = normalize(L + v);
  float sp = pow(clamp(dot(n, H), 0.0, 1.0), 42.0) * uSpec;
  vec3 L2 = normalize(vec3(-0.7, 0.2, 0.4));
  float back = clamp(dot(n, L2), 0.0, 1.0);
  float band = 1.0;
  if (uStripe > 0.0) {
    float s = fract(vObj.y * 2.75 + 0.35);
    band = mix(1.0, 0.3 + 0.7 * smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.58, 0.7, s)), uStripe);
  }
  vec3 col = uBase * (0.14 + 0.86 * diff + 0.25 * back) * band + vec3(0.7) * sp + uRim * rim;
  float ht = halftoneDot(gl_FragCoord.xy, uCell, clamp(f * f * 1.2, 0.0, 1.0));
  col += uRim * ht * uHT;
  float xf = f * f;
  vec3 xr = uRim * (0.015 + xf * 0.42) + vec3(0.55, 0.75, 0.55) * rim * 0.25 + uRim * ht * 0.12;
  col = mix(col, xr, uXray);
  col = mix(col, uBase * 0.06 + uRim * rim * 0.12, uDark);
  float a = mix(1.0, clamp(0.02 + xf * 0.75 + ht * 0.1, 0.0, 1.0), uXray);
  gl_FragColor = vec4(col, a * uOpacity * uAlpha);
}
`;

const WIRE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float f = 1.0 - ndv;
  float a = 0.55 + 0.25 * f * f;
  gl_FragColor = vec4(uColor * 0.72, a * uOpacity * uAlpha);
}
`;

const EYE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uAlpha;
uniform float uGlow;
uniform float uXray;
uniform float uDark;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float f = 1.0 - ndv;
  vec3 p = normalize(vObj);
  vec2 uv = vec2(atan(p.z, p.x) * 6.5, asin(clamp(p.y, -1.0, 1.0)) * 6.5);
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float d = length(g);
  float lens = 1.0 - smoothstep(0.16, 0.46, d);
  vec3 L = normalize(vec3(0.45, 0.85, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float sp = pow(clamp(dot(n, normalize(L + v)), 0.0, 1.0), 24.0);
  vec3 col = uColor * (0.05 + 0.32 * diff) * (0.25 + 0.75 * lens) * uGlow;
  col += uColor * f * f * f * 0.9 * uGlow;
  col += vec3(0.8) * sp * lens * 0.6;
  col = mix(col, uColor * (0.02 + f * f * 0.35) * (0.4 + 0.6 * lens), uXray);
  col = mix(col, uColor * 0.06 * lens, uDark);
  float al = mix(1.0, clamp(0.03 + f * f * 0.6 + lens * 0.05, 0.0, 1.0), uXray);
  gl_FragColor = vec4(col, al * uOpacity * uAlpha);
}
`;

const WING_VERT = /* glsl */ `
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

const WING_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uAlpha;
uniform float uTime;
uniform float uWire;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 m = texture2D(uMap, vUv);
  if (m.g < 0.02) discard;
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float f = 1.0 - ndv;
  float t = ndv * 1.6 + vUv.x * 1.3 - vUv.y * 0.7 + uTime * 0.05;
  vec3 irid = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  irid = mix(vec3(0.12, 1.0, 0.32), irid, 0.5);
  vec3 col = irid * (0.18 + 0.7 * f) * m.g;
  col += mix(vec3(0.62, 0.8, 0.62), vec3(0.25, 1.0, 0.35), uWire) * m.r * 0.85;
  col += vec3(0.45, 0.95, 0.55) * m.b * 0.6;
  float a = (m.g * (0.14 + 0.36 * f) + m.r * 0.75 + m.b * 0.45) * uOpacity * uAlpha;
  gl_FragColor = vec4(col, a);
}
`;

const LINE_VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const LINE_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uOpacity;
uniform float uSolid;
uniform float uWire;
void main() {
  float w = clamp(uWire / max(uSolid + uWire, 0.001), 0.0, 1.0);
  gl_FragColor = vec4(mix(uColA, uColB, w), uOpacity * max(uSolid, uWire) * 0.85);
}
`;

// ---------------------------------------------------------------------------
// Анатомия

// Лапки: k — пара (0 перед, 1 середина, 2 зад). Координаты для левой стороны (+X); правая — зеркально.
//   hip — основание (тазик) на груди, coxa — смещение конца тазика, L — бедро/голень/лапка,
//   stand — точка опоры на земле (y игнорируется), tdir — направление лапки (на земле),
//   hover — где висит ступня в полёте (координаты тела).
const LEG_DEF = [
  { hip: [0.13, -0.16, 0.6], coxa: [0.05, -0.15, 0.06], L: [0.56, 0.6, 0.5], stand: [0.72, 0, 1.28], tdir: [0.32, -0.42, 0.85], hover: [0.3, -0.62, 1.12] },
  { hip: [0.19, -0.2, 0.34], coxa: [0.08, -0.13, 0.0], L: [0.68, 0.7, 0.52], stand: [1.15, 0, 0.36], tdir: [0.88, -0.45, 0.12], hover: [0.5, -0.86, 0.12] },
  { hip: [0.19, -0.2, 0.1], coxa: [0.08, -0.12, -0.05], L: [0.76, 0.8, 0.58], stand: [0.95, 0, -0.78], tdir: [0.45, -0.42, -0.78], hover: [0.4, -0.62, -0.85] },
];
const LEG_R = [0.075, 0.056, 0.043, 0.03];
const JOINT_R = [0.058, 0.046, 0.033];
// Трёхногая походка: группа A (левая передняя, правая средняя, левая задняя) и группа B — в противофазе
const GAIT_OFF = [0, 0.5, 0.5, 0, 0, 0.5]; // порядок лапок: L1, R1, L2, R2, L3, R3

const ABD = { c: [0, 0.03, -0.74], r: [0.4, 0.75, 0.36] };

function abdomenProfile(y) {
  // y: −1 (перед) … +1 (кончик)
  const base = Math.pow(Math.max(0, 1 - y * y), 0.42);
  const taper = 1 - 0.2 * Math.max(0, y);
  const rings = 1 + 0.03 * Math.cos((y + 1) * Math.PI * 3.1);
  return base * taper * rings;
}

function latheGeo(n, radial) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const y = -1 + (2 * i) / n;
    pts.push(new THREE.Vector2(Math.max(0.0001, abdomenProfile(y)), y));
  }
  return new THREE.LatheGeometry(pts, radial);
}

// Контур крыла (размах по X от шарнира, хорда по Y: передний край — y > 0)
function wingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.03);
  s.bezierCurveTo(0.3, 0.1, 0.95, 0.14, 1.55, 0.1);
  s.bezierCurveTo(1.98, 0.07, 2.12, -0.14, 2.0, -0.32);
  s.bezierCurveTo(1.9, -0.72, 1.25, -0.9, 0.66, -0.72);
  s.bezierCurveTo(0.34, -0.6, 0.12, -0.36, 0.02, -0.1);
  s.lineTo(0, 0.03);
  return s;
}
const WING_VEINS = [
  [[0.08, -0.01], [0.6, 0.06], [1.15, 0.085], [1.5, 0.09]],          // L2 (сливается с краем)
  [[0.1, -0.05], [0.7, -0.05], [1.4, -0.08], [2.04, -0.18]],         // L3 — к вершине
  [[0.14, -0.12], [0.75, -0.22], [1.4, -0.36], [1.94, -0.5]],        // L4
  [[0.2, -0.2], [0.65, -0.42], [1.1, -0.62], [1.42, -0.78]],         // L5
  [[0.86, -0.065], [0.86, -0.215]],                                  // передняя поперечная
  [[1.18, -0.3], [1.12, -0.56]],                                     // задняя поперечная
];

function wingTexture(shape, bounds) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => ((x - bounds.x0) / (bounds.x1 - bounds.x0)) * W;
  const Y = (y) => (1 - (y - bounds.y0) / (bounds.y1 - bounds.y0)) * H;
  const pts = shape.getPoints(64);
  const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)))); g.closePath(); };
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  path(); g.fillStyle = 'rgb(0,255,0)'; g.fill();
  // жилки (красный канал)
  g.save(); path(); g.clip();
  g.strokeStyle = 'rgb(255,0,0)'; g.lineCap = 'round'; g.lineJoin = 'round';
  WING_VEINS.forEach((v, i) => {
    g.lineWidth = i < 4 ? 5 : 4;
    g.beginPath();
    v.forEach((p, k) => (k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.stroke();
  });
  g.restore();
  // кромка (синий канал), передний край толще
  path(); g.strokeStyle = 'rgb(0,0,255)'; g.lineWidth = 5; g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------

export class FlyModel {
  constructor({ seed = 3 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'fly';
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.trunk = new THREE.Group();           // грудь, брюшко, крылья (можно скрыть целиком)
    this.body.add(this.trunk);
    this.head = new THREE.Group();            // шарнир шеи
    this.head.position.set(0, 0.13, 0.8);
    this.body.add(this.head);

    this.p = { solid: 1, wire: 0, xray: 0, headXray: 0, flight: 0, hover: 0, walk: 0, groom: 0, proboscis: 0, glow: 1, speed: 1, bob: 1, trunk: 1, legs: 1, legWire: 0, dark: 0 };
    this.ground = -0.98;
    this.stride = 0.55;
    this.lift = 0.24;
    this.stepHz = 2.1;
    this.duty = 0.5;
    this.wingHz = 9.5;
    this.wingPhase = 0;
    this.gaitPhase = 0;
    this.legVisible = [true, true, true, true, true, true];
    this.legR = 1;               // множитель толщины лапок
    this.legOverride = [null, null, null, null, null, null];
    this.solidMeshes = [];
    this.wireMeshes = [];
    this._vis = { solid: null, wire: null };
    this._time = 0;

    this._buildMaterials();
    this._buildBody(seed);
    this._buildLegs();
    this._tmp = {
      hip: new THREE.Vector3(), hipEnd: new THREE.Vector3(), foot: new THREE.Vector3(), tdir: new THREE.Vector3(),
      ankle: new THREE.Vector3(), knee: new THREE.Vector3(), d: new THREE.Vector3(), w: new THREE.Vector3(),
      v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), s: new THREE.Vector3(),
      m3: new THREE.Matrix3(),
    };
    // концы сегментов лапок (для облака точек и подписей): [legs][5 точек]
    this.legPts = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => new THREE.Vector3()));
    this.update(0, 0);
  }

  // ---------- Материалы ----------
  _buildMaterials() {
    const shader = (frag, uniforms, opts = {}) => new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uAlpha: { value: 1 }, ...uniforms },
      vertexShader: BODY_VERT,
      fragmentShader: frag,
      transparent: true,
      ...opts,
    });
    const bodyU = (base, stripe = 0) => ({
      uBase: { value: new THREE.Color(base) }, uRim: { value: new THREE.Color('#00ff00').multiplyScalar(0.85) },
      uXray: { value: 0 }, uStripe: { value: stripe }, uCell: { value: 7 }, uHT: { value: 0.2 }, uSpec: { value: 1 }, uDark: { value: 0 },
    });
    this.matBody = shader(BODY_FRAG, bodyU('#465046'));
    this.matAbd = shader(BODY_FRAG, bodyU('#566256', 1));
    this.matHead = shader(BODY_FRAG, bodyU('#465046'));
    this.matLeg = shader(BODY_FRAG, bodyU('#5a645b'));
    this.matLeg.uniforms.uRim.value.multiplyScalar(0.25);
    this.matLeg.uniforms.uHT.value = 0.08;
    this.matEye = shader(EYE_FRAG, { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(0.9) }, uGlow: { value: 1 }, uXray: { value: 0 }, uDark: { value: 0 } });
    // сплошное тело чуть «утоплено» в глубину — рёбра каркаса поверх него не мерцают
    for (const m of [this.matBody, this.matAbd, this.matHead, this.matLeg, this.matEye]) {
      m.polygonOffset = true; m.polygonOffsetFactor = 1.5; m.polygonOffsetUnits = 2;
    }
    this.matWire = shader(WIRE_FRAG, { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.15) } }, {
      wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.matWireHead = this.matWire.clone();
    this.matWireHead.uniforms.uColor.value = new THREE.Color('#00ff00').multiplyScalar(1.15);
    this.matWireLeg = this.matWire.clone();
    this.matWireLeg.uniforms.uColor.value = new THREE.Color('#00ff00').multiplyScalar(1.15);
    this.matLine = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 }, uSolid: { value: 1 }, uWire: { value: 0 },
        uColA: { value: new THREE.Color('#5d6b5d') }, uColB: { value: new THREE.Color('#00ff00').multiplyScalar(0.9) },
      },
      vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.solidMats = [this.matBody, this.matAbd, this.matHead, this.matLeg];
    this.cellMats = [this.matBody, this.matAbd, this.matHead, this.matLeg];
  }

  // ---------- Тело ----------
  _buildBody(seed) {
    const r = rng(seed);
    const SPH = new THREE.SphereGeometry(1, 40, 28);
    // каркас чуть больше сплошной поверхности: рёбра лежат снаружи и не прячутся за «скрытой» поверхностью
    const ICO = new THREE.IcosahedronGeometry(1.04, 2);
    this.geoSph = SPH; this.geoIco = ICO;
    const part = (parent, solidGeo, wireGeo, mat, wireMat, pos, scl, rot = null) => {
      const m = new THREE.Mesh(solidGeo, mat);
      m.position.set(...pos); m.scale.set(...scl);
      if (rot) m.rotation.set(...rot);
      parent.add(m);
      this.solidMeshes.push(m);
      let w = null;
      if (wireGeo) {
        w = new THREE.Mesh(wireGeo, wireMat);
        w.position.copy(m.position); w.scale.copy(m.scale); w.rotation.copy(m.rotation);
        parent.add(w);
        this.wireMeshes.push(w);
      }
      return { m, w };
    };
    this.parts = {};
    // грудь, щиток, шея
    this.parts.thorax = part(this.trunk, SPH, ICO, this.matBody, this.matWire, [0, 0.1, 0.32], [0.41, 0.4, 0.55]);
    this.parts.scutellum = part(this.trunk, SPH, ICO, this.matBody, this.matWire, [0, 0.35, -0.13], [0.2, 0.1, 0.15]);
    this.parts.neck = part(this.trunk, SPH, null, this.matBody, null, [0, 0.12, 0.8], [0.12, 0.12, 0.12]);
    // брюшко (тело вращения с кольцами-сегментами)
    const abdS = latheGeo(48, 36), abdW = latheGeo(14, 14).scale(1.045, 1.02, 1.045);
    this.parts.abdomen = part(this.trunk, abdS, abdW, this.matAbd, this.matWire, ABD.c, ABD.r, [-Math.PI / 2, 0, 0]);
    // голова (координаты — от шарнира шеи)
    const H = this.head;
    this.parts.headCap = part(H, SPH, ICO, this.matHead, this.matWireHead, [0, 0.01, 0.2], [0.25, 0.27, 0.21]);
    this.eyes = [];
    for (const s of [1, -1]) {
      // правый глаз отражён (scale.x < 0), чтобы шов фасеточной развёртки был внутри головы
      const e = part(H, SPH, ICO, this.matEye, this.matWireHead, [s * 0.215, 0.025, 0.19], [s * 0.2, 0.29, 0.255], [0, 0.22, 0]);
      this.eyes.push(e);
    }
    // усики
    this.antennae = [];
    const aristaSeg = [];
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.065, 0.08, 0.42);
      H.add(g);
      part(g, SPH, ICO, this.matHead, this.matWireHead, [0, 0, 0], [0.04, 0.04, 0.04]);
      part(g, SPH, ICO, this.matHead, this.matWireHead, [s * 0.012, -0.055, 0.03], [0.042, 0.068, 0.045], [0.35, 0, 0]);
      this.antennae.push(g);
      // ариста — перистая щетинка
      const base = [s * 0.03, -0.04, 0.06];
      const tip = [s * 0.1, 0.12, 0.26];
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push([g.position.x + lerp(base[0], tip[0], t), g.position.y + lerp(base[1], tip[1], t) + Math.sin(t * Math.PI) * 0.03, g.position.z + lerp(base[2], tip[2], t)]);
      }
      for (let i = 0; i < pts.length - 1; i++) aristaSeg.push(pts[i], pts[i + 1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        aristaSeg.push(p, [p[0] + s * 0.015, p[1] + 0.05, p[2] + 0.02]);
        aristaSeg.push(p, [p[0] - s * 0.01, p[1] - 0.045, p[2] + 0.025]);
      }
    }
    // хоботок
    this.prob = new THREE.Group();
    this.prob.position.set(0, -0.2, 0.25);
    H.add(this.prob);
    const CYL = new THREE.CylinderGeometry(1, 0.8, 1, 12, 1).translate(0, 0.5, 0);
    const CYLW = new THREE.CylinderGeometry(1.18, 0.95, 1, 6, 2).translate(0, 0.5, 0);
    this.geoCyl = CYL; this.geoCylW = CYLW;
    this.probA = part(this.prob, CYL, CYLW, this.matHead, this.matWireHead, [0, 0, 0], [0.055, 0.2, 0.055], [Math.PI, 0, 0]);
    this.probB = new THREE.Group();
    this.prob.add(this.probB);
    part(this.probB, CYL, CYLW, this.matHead, this.matWireHead, [0, 0, 0], [0.038, 0.2, 0.038], [Math.PI, 0, 0]);
    for (const s of [1, -1]) part(this.probB, SPH, ICO, this.matHead, this.matWireHead, [s * 0.045, -0.22, 0.0], [0.06, 0.05, 0.085]);
    // жужжальца
    this.halteres = [];
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.24, 0.3, -0.12);
      this.trunk.add(g);
      part(g, CYL, null, this.matBody, null, [0, 0, 0], [0.018, 0.16, 0.018], [0, 0, -s * 1.2]);
      part(g, SPH, ICO, this.matBody, this.matWire, [s * 0.14, 0.06, 0], [0.045, 0.045, 0.045]);
      this.halteres.push({ g, s });
    }
    // щетинки на груди и голове (off — вычесть смещение системы координат головы)
    const thoraxSeg = [], headSeg = [];
    const bristle = (out, c, rr, n, up, back, len, off = [0, 0, 0]) => {
      for (let i = 0; i < n; i++) {
        const a = r.range(-1.2, 1.2), b = r.range(0.25, 1.1);
        const nx = Math.sin(a) * Math.cos(b), ny = Math.sin(b), nz = Math.cos(a) * Math.cos(b) * 0.6 - 0.2;
        const p0 = [c[0] + nx * rr[0] - off[0], c[1] + ny * rr[1] - off[1], c[2] + nz * rr[2] - off[2]];
        const l = r.range(len * 0.6, len);
        out.push(p0, [p0[0] + nx * l * 0.4, p0[1] + up * l, p0[2] - back * l]);
      }
    };
    bristle(thoraxSeg, [0, 0.1, 0.32], [0.41, 0.4, 0.55], 18, 0.45, 0.85, 0.3);
    bristle(thoraxSeg, [0, 0.35, -0.13], [0.2, 0.1, 0.15], 4, 0.4, 0.9, 0.3);
    bristle(headSeg, [0, 0.14, 1.02], [0.26, 0.28, 0.2], 8, 0.5, 0.7, 0.2, [0, 0.13, 0.8]);
    const mkLines = (arr) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr.flat(), 3));
      const l = new THREE.LineSegments(g, this.matLine);
      l.frustumCulled = false;
      return l;
    };
    this.head.add(mkLines([...aristaSeg, ...headSeg]));
    this.trunk.add(mkLines(thoraxSeg));

    // крылья (+ «призраки» для размытия взмаха)
    const shape = wingShape();
    const pts = shape.getPoints(64);
    const bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    pts.forEach((p) => { bounds.x0 = Math.min(bounds.x0, p.x); bounds.x1 = Math.max(bounds.x1, p.x); bounds.y0 = Math.min(bounds.y0, p.y); bounds.y1 = Math.max(bounds.y1, p.y); });
    this.wingPoly = pts;
    this.wingBounds = bounds;
    const wgeo = new THREE.ShapeGeometry(shape, 24);
    const uv = wgeo.attributes.uv, pos = wgeo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) - bounds.x0) / (bounds.x1 - bounds.x0), (pos.getY(i) - bounds.y0) / (bounds.y1 - bounds.y0));
    }
    const wtex = wingTexture(shape, bounds);
    this.wingTex = wtex;
    const wingMat = () => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: wtex }, uOpacity: { value: 1 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uWire: { value: 0 } },
      vertexShader: WING_VERT, fragmentShader: WING_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.wings = [];
    this.wingMats = [];
    for (const s of [1, -1]) {
      const side = new THREE.Group();
      side.scale.x = s;
      this.trunk.add(side);
      const pivots = [];
      for (let gI = 0; gI < 3; gI++) {
        const piv = new THREE.Group();
        piv.position.set(0.2, 0.43, 0.42);
        piv.rotation.order = 'YZX';
        const mat = wingMat();
        const mesh = new THREE.Mesh(wgeo, mat);
        mesh.rotation.x = Math.PI / 2;
        mesh.renderOrder = 2;
        piv.add(mesh);
        side.add(piv);
        pivots.push(piv);
        this.wingMats.push({ mat, ghost: gI });
      }
      this.wings.push({ s, side, pivots });
    }
  }

  // ---------- Лапки (инстансы) ----------
  _buildLegs() {
    const seg = new THREE.CylinderGeometry(0.75, 1, 1, 10, 1).translate(0, 0.5, 0);
    const segW = new THREE.CylinderGeometry(0.95, 1.27, 1, 5, 2).translate(0, 0.5, 0);
    const jg = new THREE.SphereGeometry(1, 12, 8);
    this.segSolid = new THREE.InstancedMesh(seg, this.matLeg, 24);
    this.segWire = new THREE.InstancedMesh(segW, this.matWireLeg, 24);
    this.segWire.instanceMatrix = this.segSolid.instanceMatrix;
    this.joints = new THREE.InstancedMesh(jg, this.matLeg, 18);
    for (const m of [this.segSolid, this.segWire, this.joints]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.legs = [];
    for (let k = 0; k < 3; k++) for (const s of [1, -1]) this.legs.push({ k, s, def: LEG_DEF[k] });
  }

  // ---------- Помощники ----------
  setCell(px) { for (const m of this.cellMats) m.uniforms.uCell.value = px; }

  /** Скорость «земли» под ногами при ходьбе (единицы модели в секунду, без учёта масштаба). */
  groundSpeed() { return this.stride * this.stepHz / this.duty * this.p.walk * this.p.speed; }

  /** Мировая позиция точки модели: 'head' | 'brain' | 'eye' | 'proboscis' | 'foot0'…'foot5' | 'antenna' | 'thorax'. */
  point(name, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    if (name.startsWith('foot')) return out.copy(this.legPts[+name.slice(4)][4]).applyMatrix4(this.group.matrixWorld);
    if (name === 'proboscis') return out.set(0, -0.27, 0).applyMatrix4(this.probB.matrixWorld);
    if (name === 'antenna') return out.set(0, 0, 0).applyMatrix4(this.antennae[0].matrixWorld);
    if (name === 'thorax') return out.set(0, 0.1, 0.32).applyMatrix4(this.body.matrixWorld);
    // голова / мозг
    return out.set(0, 0.01, 0.2).applyMatrix4(this.head.matrixWorld);
  }

  /** Матрица «система мозга → мир»: центр головы, мозг шириной brainW (в единицах модели). */
  brainMatrix(out = new THREE.Matrix4(), brainW = 0.62) {
    this.group.updateMatrixWorld(true);
    const k = brainW / 2;
    const local = this._tmp.m.compose(new THREE.Vector3(0, 0.02, 0.17), new THREE.Quaternion(), new THREE.Vector3(k, k, k));
    return out.multiplyMatrices(this.head.matrixWorld, local);
  }

  // ---------- Кадр ----------
  update(dt, t) {
    this._time = t;
    const p = this.p;
    // материалы
    const solid = p.solid, wire = p.wire, tr = p.trunk, lg = p.legs;
    for (const m of this.solidMats) { m.uniforms.uAlpha.value = m === this.matHead ? solid : m === this.matLeg ? solid * lg : solid * tr; m.uniforms.uXray.value = p.xray; }
    this.matWireLeg.uniforms.uAlpha.value = Math.max(wire * lg, p.legWire);
    this.matHead.uniforms.uXray.value = Math.max(p.xray, p.headXray);
    this.matEye.uniforms.uAlpha.value = solid;
    this.matEye.uniforms.uXray.value = Math.max(p.xray, p.headXray);
    this.matEye.uniforms.uGlow.value = p.glow;
    this.matEye.uniforms.uDark.value = p.dark;
    for (const m of this.solidMats) m.uniforms.uDark.value = m === this.matLeg ? p.dark * 0.45 : p.dark;
    this.matWire.uniforms.uAlpha.value = wire * tr;
    this.matWireHead.uniforms.uAlpha.value = Math.max(wire, p.headXray * 0.2);
    this.matLine.uniforms.uSolid.value = solid * tr;
    this.matLine.uniforms.uWire.value = wire * tr;
    const tv = tr > 0.002;
    if (this.trunk.visible !== tv) this.trunk.visible = tv;
    const xrBody = p.xray > 0.02, xrHead = Math.max(p.xray, p.headXray) > 0.02;
    for (const m of this.solidMats) {
      const want = !(m === this.matHead ? xrHead : xrBody) && solid > 0.98;
      if (m.depthWrite !== want) m.depthWrite = want;
    }
    const eyeDW = !xrHead && solid > 0.98;
    if (this.matEye.depthWrite !== eyeDW) this.matEye.depthWrite = eyeDW;
    // не рисовать невидимый режим (экономия draw calls)
    const sv = solid > 0.002, wv = wire > 0.002 || p.headXray > 0.002;
    if (this._vis.solid !== sv) {
      this._vis.solid = sv;
      for (const m of this.solidMeshes) m.visible = sv;
    }
    const lv = solid * lg > 0.002;
    if (this.segSolid.visible !== lv) this.segSolid.visible = this.joints.visible = lv;
    if (this._vis.wire !== wv) {
      this._vis.wire = wv;
      for (const m of this.wireMeshes) m.visible = wv;
      this.segWire.visible = wire > 0.002;
    }
    const lwv = Math.max(wire * lg, p.legWire) > 0.002;
    if (this.segWire.visible !== lwv) this.segWire.visible = lwv;
    for (const w of this.wingMats) {
      w.mat.uniforms.uTime.value = t;
      w.mat.uniforms.uWire.value = wire;
      const ghostK = w.ghost === 0 ? 1 : (w.ghost === 1 ? 0.42 : 0.2) * clamp((p.flight - 0.4) / 0.6, 0, 1);
      w.mat.uniforms.uAlpha.value = Math.max(solid, wire) * ghostK * tr;
    }

    // крылья
    this.wingPhase += dt * TAU * this.wingHz * (p.flight > 0.01 ? 1 : 0);
    const fl = p.flight;
    for (const w of this.wings) {
      w.pivots.forEach((piv, g) => {
        const ph = this.wingPhase - g * 0.5;
        const sw = Math.sin(ph), cw = Math.cos(ph);
        piv.rotation.y = lerp(Math.PI / 2 - 0.2, 1.05 * sw, fl);
        piv.rotation.z = lerp(0.09, 0.3 + 0.24 * cw, fl);
        piv.rotation.x = lerp(0, 0.7 * cw, fl);
        piv.visible = g === 0 || fl > 0.4;
      });
    }
    for (const h of this.halteres) h.g.rotation.z = fl * 0.7 * Math.sin(this.wingPhase + Math.PI) * h.s;

    // походка и поза тела
    this.gaitPhase += dt * this.stepHz * p.walk * p.speed;
    const gp = this.gaitPhase;
    const B = this.body;
    B.position.set(0, p.walk * 0.022 * Math.sin(gp * TAU * 2) + p.hover * 0.05 * Math.sin(t * 1.7) * p.bob, 0);
    B.rotation.set(-0.13 * p.groom - 0.1 * p.hover + 0.02 * Math.sin(t * 1.1) * p.hover * p.bob, 0, p.walk * 0.025 * Math.sin(gp * TAU));
    this.head.rotation.set(0.28 * p.groom + 0.04 * p.groom * Math.sin(t * 9), 0, 0);
    for (let i = 0; i < this.antennae.length; i++) this.antennae[i].rotation.set(p.groom * 0.22 * Math.sin(t * 14 + i * 2), 0, 0);
    // хоботок
    const pe = p.proboscis;
    this.prob.rotation.set(lerp(1.15, -0.22, pe), 0, 0);
    this.probB.scale.setScalar(lerp(0.85, 1.12, pe));
    this.probA.m.scale.y = this.probA.w.scale.y = lerp(0.13, 0.2, pe);
    this.probB.position.y = -this.probA.m.scale.y;
    B.updateMatrix();
    this.head.updateMatrix();

    // лапки
    for (let i = 0; i < 6; i++) this._leg(i, t);
    this.segSolid.instanceMatrix.needsUpdate = true;
    this.joints.instanceMatrix.needsUpdate = true;
  }

  _leg(i, t) {
    const L = this.legs[i], d = L.def, s = L.s, p = this.p, T = this._tmp;
    const bm = this.body.matrix;
    const hip = T.hip.set(s * d.hip[0], d.hip[1], d.hip[2]).applyMatrix4(bm);
    const hipEnd = T.hipEnd.set(s * (d.hip[0] + d.coxa[0]), d.hip[1] + d.coxa[1], d.hip[2] + d.coxa[2]).applyMatrix4(bm);
    // 1) ходьба / стойка (координаты корня, ступня на земле)
    const G = this.ground;
    const foot = T.foot;
    const restZ = d.stand[2] + (L.k === 1 ? 0.14 * p.groom : 0) + (L.k === 0 ? -0.1 * p.groom : 0);
    const ph = ((this.gaitPhase + GAIT_OFF[i]) % 1 + 1) % 1;
    let fz, fy = G;
    if (ph < this.duty) {
      const u = ph / this.duty;
      fz = this.stride * (0.5 - u);
    } else {
      const u = (ph - this.duty) / (1 - this.duty);
      const e = u * u * (3 - 2 * u);
      fz = this.stride * (-0.5 + e);
      fy = G + this.lift * Math.sin(Math.PI * u) * Math.min(1, p.walk * 2);
    }
    const wk = Math.min(1, p.walk * 3);
    foot.set(s * d.stand[0], lerp(G, fy, wk), restZ + fz * wk);
    const tdir = T.tdir.set(s * d.tdir[0], d.tdir[1], d.tdir[2]).normalize();
    // 2) полёт: лапки висят под телом
    if (p.hover > 0.001) {
      const sw = Math.sin(t * 2.3 + i * 1.3) * 0.05;
      const hv = T.v.set(s * d.hover[0], d.hover[1] + sw, d.hover[2] + sw).applyMatrix4(bm);
      foot.lerp(hv, p.hover);
      T.v2.set(s * 0.15, -0.8, L.k === 0 ? 0.35 : L.k === 1 ? -0.25 : -0.75).normalize();
      tdir.lerp(T.v2, p.hover).normalize();
    }
    // 3) чистка усиков передними лапками
    if (L.k === 0 && p.groom > 0.001) {
      const w = t * TAU * 2.4;
      const gv = T.v.set(
        s * (0.055 + 0.035 * Math.sin(w + (s > 0 ? 0 : Math.PI))),
        0.3 + 0.06 * Math.sin(w * 2 + s),
        1.38 + 0.05 * Math.cos(w),
      ).applyMatrix4(bm);
      foot.lerp(gv, p.groom);
      T.v2.set(-s * 0.5, 0.75, 0.3).normalize();
      tdir.lerp(T.v2, p.groom).normalize();
    }
    // 4) внешнее управление (напр. лапка тянется к капле)
    const ov = this.legOverride[i];
    if (ov && ov.w > 0) { foot.lerp(ov.foot, ov.w); tdir.lerp(ov.dir, ov.w).normalize(); }

    // IK: бедро + голень, колено — вверх и наружу
    const [L1, L2, L3] = d.L;
    const ankle = T.ankle.copy(foot).addScaledVector(tdir, -L3);
    const dv = T.d.subVectors(ankle, hipEnd);
    let dist = dv.length();
    const maxD = L1 + L2 - 1e-3, minD = Math.abs(L1 - L2) + 0.05;
    if (dist > maxD) { dv.multiplyScalar(maxD / dist); dist = maxD; ankle.copy(hipEnd).add(dv); }
    else if (dist < minD) { dv.multiplyScalar(minD / Math.max(dist, 1e-4)); dist = minD; ankle.copy(hipEnd).add(dv); }
    const u = dv.multiplyScalar(1 / dist);
    const w = T.w.set(s * 0.55, 1, 0.1).normalize();
    w.addScaledVector(u, -w.dot(u));
    if (w.lengthSq() < 1e-6) w.set(0, 1, 0);
    w.normalize();
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const a = Math.acos(cosA);
    const knee = T.knee.copy(hipEnd).addScaledVector(u, Math.cos(a) * L1).addScaledVector(w, Math.sin(a) * L1);
    foot.copy(ankle).addScaledVector(tdir, L3);

    const pts = this.legPts[i];
    pts[0].copy(hip); pts[1].copy(hipEnd); pts[2].copy(knee); pts[3].copy(ankle); pts[4].copy(foot);
    const vis = this.legVisible[i] ? 1 : 0;
    const lr = vis * this.legR;
    for (let k = 0; k < 4; k++) this._seg(i * 4 + k, pts[k], pts[k + 1], LEG_R[k] * lr);
    for (let k = 0; k < 3; k++) this._joint(i * 3 + k, pts[k + 1], JOINT_R[k] * lr);
  }

  _seg(idx, a, b, r) {
    const T = this._tmp;
    const dir = T.v.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-5 || r <= 0) { T.m.makeScale(0, 0, 0); this.segSolid.setMatrixAt(idx, T.m); return; }
    T.q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
    T.m.compose(a, T.q, T.s.set(r, len, r));
    this.segSolid.setMatrixAt(idx, T.m);
  }

  _joint(idx, p, r) {
    const T = this._tmp;
    T.m.compose(p, T.q.identity(), T.s.set(r, r, r));
    this.joints.setMatrixAt(idx, T.m);
  }

  // ---------- Облако точек по поверхности модели (для «схемы» из частиц) ----------
  /**
   * Точки на поверхности мухи в координатах корня (fly.group). Возвращает { pos: Float32Array(n*3), kind: Uint8Array(n) }
   * kind: 0 — тело, 1 — глаз, 2 — крыло (мембрана), 3 — жилка/кромка крыла, 4 — лапка.
   */
  samplePoints(n, seed = 9) {
    const r = rng(seed);
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const pos = new Float32Array(n * 3), kind = new Uint8Array(n);
    const v = new THREE.Vector3(), M = new THREE.Matrix4();
    let i = 0;
    const put = (x, y, z, k) => { if (i < n) { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; kind[i] = k; i++; } };
    // 1) эллипсоиды и брюшко
    const meshes = this.solidMeshes.filter((m) => m.geometry.type !== 'CylinderGeometry' && m.userData.sample !== false);
    const areas = meshes.map((m) => {
      m.updateWorldMatrix(true, false);
      const s = new THREE.Vector3().setFromMatrixScale(M.multiplyMatrices(inv, m.matrixWorld));
      return 4 * Math.PI * Math.pow((Math.pow(s.x * s.y, 1.6) + Math.pow(s.x * s.z, 1.6) + Math.pow(s.y * s.z, 1.6)) / 3, 1 / 1.6);
    });
    const totalA = areas.reduce((a, b) => a + b, 0);
    const nBody = Math.floor(n * 0.52);
    meshes.forEach((m, mi) => {
      M.multiplyMatrices(inv, m.matrixWorld);
      const cnt = Math.round(nBody * areas[mi] / totalA);
      const isEye = m.material === this.matEye;
      const isAbd = m.geometry.type === 'LatheGeometry';
      for (let k = 0; k < cnt; k++) {
        if (isAbd) {
          const y = r.range(-1, 1), ph = r() * TAU, rr = abdomenProfile(y);
          v.set(Math.cos(ph) * rr, y, Math.sin(ph) * rr);
        } else {
          v.set(...r.onSphere(1));
        }
        v.applyMatrix4(M);
        put(v.x, v.y, v.z, isEye ? 1 : 0);
      }
    });
    // 2) лапки
    const nLeg = Math.floor(n * 0.14);
    const segs = [];
    for (let li = 0; li < 6; li++) if (this.legVisible[li]) for (let k = 0; k < 4; k++) segs.push([this.legPts[li][k], this.legPts[li][k + 1], LEG_R[k]]);
    const segLen = segs.map((sg) => sg[0].distanceTo(sg[1]));
    const totalL = segLen.reduce((a, b) => a + b, 0) || 1;
    segs.forEach((sg, si) => {
      const cnt = Math.round(nLeg * segLen[si] / totalL);
      for (let k = 0; k < cnt; k++) {
        const t = r();
        const [x, y, z] = r.onSphere(sg[2] * 0.9);
        put(lerp(sg[0].x, sg[1].x, t) + x, lerp(sg[0].y, sg[1].y, t) + y, lerp(sg[0].z, sg[1].z, t) + z, 4);
      }
    });
    // 3) крылья (основные, без «призраков»)
    const poly = this.wingPoly, b = this.wingBounds;
    const inPoly = (x, y) => {
      let c = false;
      for (let a = 0, z = poly.length - 1; a < poly.length; z = a++) {
        const pa = poly[a], pz = poly[z];
        if ((pa.y > y) !== (pz.y > y) && x < ((pz.x - pa.x) * (y - pa.y)) / (pz.y - pa.y) + pa.x) c = !c;
      }
      return c;
    };
    const wingMeshes = this.wings.map((w) => w.pivots[0].children[0]);
    const nWing = n - i;
    for (let k = 0; k < nWing; k++) {
      const wm = wingMeshes[k % 2];
      wm.updateWorldMatrix(true, false);
      M.multiplyMatrices(inv, wm.matrixWorld);
      let x, y, edge = false, guard = 0;
      if (r() < 0.3) {
        // по контуру и жилкам
        if (r() < 0.5) {
          const q = r() * (poly.length - 1), qi = Math.floor(q), f = q - qi;
          x = lerp(poly[qi].x, poly[qi + 1].x, f); y = lerp(poly[qi].y, poly[qi + 1].y, f);
        } else {
          const vein = WING_VEINS[Math.floor(r() * WING_VEINS.length)];
          const q = r() * (vein.length - 1), qi = Math.floor(q), f = q - qi;
          x = lerp(vein[qi][0], vein[qi + 1][0], f); y = lerp(vein[qi][1], vein[qi + 1][1], f);
        }
        edge = true;
      } else {
        do { x = r.range(b.x0, b.x1); y = r.range(b.y0, b.y1); } while (!inPoly(x, y) && ++guard < 50);
      }
      v.set(x, y, 0).applyMatrix4(M);
      put(v.x, v.y, v.z, edge ? 3 : 2);
    }
    return { pos, kind, count: i };
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
    this.wingTex?.dispose();
  }
}

export { abdomenProfile };
