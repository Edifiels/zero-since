// «Земля в иллюминаторе» (обратный путь, блок 8).
// Круглое окно с толстой металлической рамой и заклёпками в стене кабины (халфтон-свет из окна),
// за стеклом медленно вращается Земля: точечная суша (Natural Earth, assets/data/land.json) в фирменном халфтоне,
// свечение атмосферы по лимбу и восход Солнца по краю Земли. Общее облако частиц — звёзды за окном,
// мерцающая атмосфера вдоль лимба и пылинки в кабине.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU, lerp, clamp } from '../../core/utils.js';

const DEG = Math.PI / 180;
const CAM = new THREE.Vector3(0, 0, 14);          // расчётная позиция камеры
const WIN = new THREE.Vector3(0, 0.95, 0);        // центр иллюминатора
const RW = 2.85;                                  // радиус стекла (до масштаба PORT_SC)
const PORT_SC = 0.88;                             // масштаб иллюминатора
const HOLE = 3.3;                                 // вырез в стене (прячется под рамой)
const EARTH_R = 24;
const EARTH_AZ = 11 * DEG, EARTH_EL = -27 * DEG;  // где «центр» Земли относительно оси взгляда
const LIMB_GAP = 0.6 * DEG;                       // лимб проходит почти через центр окна
const SUN_BETA = -0.27;                           // где вдоль лимба восходит Солнце (рад)
const ATM_K = 1.065;                              // радиус оболочки атмосферы

// ---------- Шейдеры ------------------------------------------------------------

const WALL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WALL_FRAG = /* glsl */ `
uniform float uOpacity, uCell, uHole, uTime, uSunI;
uniform vec2 uSun2;
varying vec2 vP;
void main() {
  float r = length(vP);
  if (r < uHole) discard;
  // свет из окна: ярче у рамы и со стороны Солнца
  vec2 dir = vP / max(r, 1e-3);
  float side = 0.5 + 0.5 * dot(dir, uSun2);
  float spill = exp(-(r - uHole) / 1.15) * (0.25 + 0.75 * side * side) * (0.6 + 0.4 * uSunI);
  // фирменный халфтон в плоскости стены (ячейки повернуты на 45°)
  const mat2 R = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  vec2 q = R * vP / uCell;
  vec2 f = fract(q) - 0.5;
  float d = mix(length(f), max(abs(f.x), abs(f.y)), 0.16);
  float v = clamp(spill, 0.0, 1.0);
  float rad = 0.62 * sqrt(v);
  float aa = clamp(fwidth(d) * 1.2, 0.002, 0.3);
  float m = (1.0 - smoothstep(rad - aa, rad + aa, d)) * step(0.004, v);
  // когда ячейки мельче пикселя — плавно к среднему значению (без муара)
  float far = smoothstep(0.18, 0.45, fwidth(q.x));
  m = mix(m, v * 0.9, far);
  vec3 dotCol = mix(vec3(0.0, 0.3, 0.05), vec3(0.42, 0.55, 0.46), smoothstep(0.45, 0.95, v));
  // швы панелей обшивки
  float seamR = abs(fract(r / 2.6 + 0.35) - 0.5);
  float seam = (1.0 - smoothstep(0.0, 0.012, seamR)) * step(uHole + 1.4, r) * exp(-(r - uHole) / 6.0);
  vec3 col = dotCol * m * 0.6 + vec3(0.01, 0.035, 0.02) * seam;
  gl_FragColor = vec4(col, uOpacity);
}
`;

const GLASS_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uR, uInk;
varying vec2 vP;
void main() {
  float r = length(vP) / uR;
  float edge = smoothstep(0.7, 1.0, r) * 0.07;
  float s = (vP.x + vP.y) * 0.7071 / uR;
  float st1 = smoothstep(0.16, 0.0, abs(s - 0.42 - 0.04 * sin(uTime * 0.13))) * 0.055;
  float st2 = smoothstep(0.05, 0.0, abs(s - 0.68)) * 0.035;
  float st3 = smoothstep(0.08, 0.0, abs(s + 0.55)) * 0.02;
  float a = (edge + (st1 + st2 + st3) * smoothstep(1.0, 0.6, r)) * uOpacity * uInk;
  gl_FragColor = vec4(vec3(0.8, 1.0, 0.88), a);
}
`;

const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const EARTH_FRAG = /* glsl */ `
uniform sampler2D uLand;
uniform vec3 uSun;
uniform float uOpacity, uDot, uSunUp, uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
const float PI = 3.14159265;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  // равномерная сетка точек на сфере («точечный глобус»)
  float lat = (vUv.y - 0.5) * PI;
  float lon = (vUv.x - 0.5) * 2.0 * PI;
  float row = floor((lat + 0.5 * PI) / uDot);
  float latC = -0.5 * PI + (row + 0.5) * uDot;
  float nCols = max(1.0, floor(2.0 * PI * cos(latC) / uDot));
  float colW = 2.0 * PI / nCols;
  float col = floor((lon + PI) / colW);
  float lonC = -PI + (col + 0.5) * colW;
  vec2 dd = vec2((lon - lonC) * cos(lat), lat - latC) / uDot;
  float dist = length(dd);
  vec2 uvC = vec2(lonC / (2.0 * PI) + 0.5, latC / PI + 0.5);
  float land = step(0.5, texture2D(uLand, uvC).r);
  // свет
  float ndl = dot(N, uSun);
  float day = smoothstep(-0.16, 0.32, ndl) * uSunUp;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 1.0 - ndv;
  float lit = clamp(0.55 + 0.45 * day + 0.2 * fres * fres, 0.0, 1.0);
  float v = land * lit + (1.0 - land) * (0.06 + 0.14 * day);
  float rad = 0.47 * sqrt(clamp(v, 0.0, 1.0));
  float aa = clamp(fwidth(dist) * 1.1, 0.01, 0.16);
  float m = 1.0 - smoothstep(rad - aa, rad + aa, dist);
  vec3 landCol = mix(vec3(0.04, 0.62, 0.16), vec3(0.78, 0.95, 0.8), day);
  vec3 seaCol = vec3(0.0, 0.22, 0.12);
  vec3 dotCol = mix(seaCol, landCol, land);
  vec3 base = vec3(0.003, 0.01, 0.007) + vec3(0.01, 0.035, 0.022) * day;
  vec3 c = base + dotCol * m * (0.55 + 0.45 * lit);
  // дымка атмосферы у края диска (вид сверху на атмосферу)
  c += vec3(0.16, 0.7, 0.32) * pow(fres, 4.0) * (0.12 + 0.45 * day);
  gl_FragColor = vec4(c, uOpacity);
}
`;

const ATM_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const ATM_FRAG = /* glsl */ `
uniform vec3 uCenter, uSun;
uniform float uR, uRA, uOpacity, uSunUp, uSunK;
varying vec3 vW;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - ro);
  vec3 oc = uCenter - ro;
  float tc = dot(oc, rd);
  float h = length(oc - rd * tc);
  float x = (h - uR) / (uRA - uR);        // 0 — лимб, 1 — внешний край оболочки
  float glow = x < 0.0 ? 0.55 * exp(x * 3.2) : exp(-x * 4.2) * (1.0 - smoothstep(0.8, 1.0, x));
  vec3 p = ro + rd * tc;
  vec3 pc = p - uCenter;
  vec3 n = pc / max(length(pc), 1e-4);      // луч точно через центр Земли — без NaN
  float lit = smoothstep(-0.2, 0.45, dot(n, uSun)) * uSunUp;
  float toSun = max(dot(rd, uSun), 0.0);
  float sunNear = pow(toSun, 900.0);       // узкое яркое пятно у Солнца (~2°)
  float sunWide = pow(toSun, 60.0);        // широкий ореол (~8°)
  float I = glow * (0.16 + 0.32 * lit + (0.5 * sunWide + 2.2 * sunNear) * uSunUp * uSunK);
  vec3 col = mix(vec3(0.0, 0.75, 0.2), vec3(0.85, 1.0, 0.9), clamp(lit * 0.35 + sunWide * 0.6 + sunNear, 0.0, 1.0));
  gl_FragColor = vec4(col * I * uOpacity, 1.0);
}
`;

const BILL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
// Диск Солнца с лучами (закрывается Землёй по глубине)
const SUN_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uI;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float core = (1.0 - smoothstep(0.03, 0.045, r)) * 3.0;
  float glow = exp(-r * 16.0) * 1.2 + exp(-r * 6.0) * 0.06;
  float ang = atan(p.y, p.x + 1e-5);       // atan(0, 0) в GLSL не определён
  float ray = abs(cos(ang * 3.0 + uTime * 0.04));
  ray = ray * ray; ray = ray * ray; ray = ray * ray; ray = ray * ray; ray = ray * ray;   // ^32
  float ray2 = abs(cos(ang * 4.0 - uTime * 0.03 + 0.4));
  ray2 = ray2 * ray2; ray2 = ray2 * ray2; ray2 = ray2 * ray2; ray2 = ray2 * ray2; ray2 = ray2 * ray2; ray2 = ray2 * ray2;
  float rays = (ray * 0.9 + ray2 * 0.5) * exp(-r * 3.2) * smoothstep(0.03, 0.12, r) * (1.0 - smoothstep(0.55, 0.98, r));
  float I = (core + glow + rays) * uI * uOpacity;
  gl_FragColor = vec4(vec3(1.0, 1.0, 0.94) * I, 1.0);
}
`;
// «Линзовый» блик: мягкое гало и горизонтальная полоса (поверх всего)
const FLARE_FRAG = /* glsl */ `
uniform float uOpacity, uI;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float halo = exp(-r * 9.0) * 0.26;
  float streak = exp(-abs(p.y) * 200.0) * exp(-abs(p.x) * 2.8) * 0.5 * (1.0 - smoothstep(0.6, 0.98, abs(p.x)));
  float ring = exp(-pow(abs(r - 0.32) * 28.0, 2.0)) * 0.035;
  vec3 col = vec3(0.75, 1.0, 0.8) * halo + vec3(0.6, 1.0, 0.7) * streak + vec3(0.3, 1.0, 0.45) * ring;
  gl_FragColor = vec4(col * uI * uOpacity, 1.0);
}
`;

// ---------- Данные: карта суши ---------------------------------------------------

async function landTexture() {
  const W = 2048, H = 1024;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const g = cnv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  try {
    const data = await fetch(new URL('../../../assets/data/land.json', import.meta.url)).then((r) => r.json());
    g.fillStyle = '#fff';
    for (const poly of data.polygons || []) {
      g.beginPath();
      for (const ring of poly) {
        for (let k = 0; k < ring.length; k += 2) {
          const x = ((ring[k] + 180) / 360) * W, y = ((90 - ring[k + 1]) / 180) * H;
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
      }
      g.fill('evenodd');
    }
  } catch (err) {
    console.error('[b8-porthole] не удалось загрузить сушу:', err);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 128, 0, 0);   // низ холста — v = 0 (внутренняя кромка рамы)
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.18, '#5a5a5a');
  grd.addColorStop(0.45, '#0c0c0c');
  grd.addColorStop(1, '#000000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default class Porthole extends Visual {
  static transition = 'zoom';

  async init() {
    const ctx = this.ctx;
    // --- Геометрия сцены: где Земля и где восходит Солнце (из расчётной позы камеры)
    const fwd = WIN.clone().sub(CAM).normalize();
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const dE = fwd.clone().addScaledVector(right, Math.tan(EARTH_AZ)).addScaledVector(up, Math.tan(EARTH_EL)).normalize();
    const sepE = Math.acos(clamp(dE.dot(fwd), -1, 1));
    const angR = sepE - LIMB_GAP;                      // угловой радиус диска Земли
    const dist = EARTH_R / Math.sin(angR);
    this.earthC = CAM.clone().addScaledVector(dE, dist);
    this.angR = angR;
    // точка лимба, ближайшая к центру окна, и направление «вдоль лимба»
    const axis = new THREE.Vector3().crossVectors(dE, fwd).normalize();
    this.limbDir = dE.clone().applyAxisAngle(axis, angR);
    this.dE = dE;
    this.sunBase = this.limbDir.clone().applyAxisAngle(dE, SUN_BETA);   // направление на Солнце у самого лимба
    this.sunAxis = new THREE.Vector3().crossVectors(dE, this.sunBase).normalize(); // поворот «вверх от лимба»
    this.sunDir = this.sunBase.clone();

    // --- Стена кабины с вырезом
    this.group = new THREE.Group();
    this.group.position.copy(WIN);
    this.group.scale.setScalar(PORT_SC);
    this.root.add(this.group);
    this.wallU = {
      uOpacity: { value: 1 }, uCell: { value: 0.115 }, uHole: { value: HOLE }, uTime: { value: 0 },
      uSunI: { value: 0 }, uSun2: { value: new THREE.Vector2(-0.6, 0.8) },
    };
    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 110, 1, 1),
      new THREE.ShaderMaterial({ uniforms: this.wallU, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, transparent: true, depthWrite: true }),
    );
    this.wall.position.z = -0.06;
    this.wall.renderOrder = -1;   // раньше Земли: её фрагменты за стеной отсекаются тестом глубины
    this.group.add(this.wall);

    // --- Рама: токарный профиль (внутренняя кромка, фаска, плоское кольцо под болты, скруглённый край)
    const prof = [
      [2.85, -0.32], [2.85, 0.08], [2.87, 0.15], [2.93, 0.2], [3.03, 0.23],
      [3.18, 0.31], [3.34, 0.41], [3.46, 0.46], [3.62, 0.48], [3.82, 0.48],
      [3.9, 0.46], [3.96, 0.41], [4.0, 0.32], [4.03, 0.17], [4.04, 0.0], [4.04, -0.06],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const frameGeo = new THREE.LatheGeometry(prof, 160);
    frameGeo.rotateX(Math.PI / 2);
    this.frameMat = new THREE.MeshStandardMaterial({
      color: 0x6c746c, metalness: 0.9, roughness: 0.34, envMapIntensity: 0.75,
      emissive: new THREE.Color(0.12, 0.55, 0.22), emissiveMap: gradientTexture(), emissiveIntensity: 0.3,
      side: THREE.DoubleSide, transparent: true,
    });
    this.frame = new THREE.Mesh(frameGeo, this.frameMat);
    this.group.add(this.frame);

    // уплотнитель стекла
    this.gasket = new THREE.Mesh(
      new THREE.TorusGeometry(RW + 0.02, 0.055, 10, 160),
      new THREE.MeshStandardMaterial({ color: 0x050705, roughness: 0.8, metalness: 0.1, transparent: true }),
    );
    this.gasket.position.z = 0.1;
    this.group.add(this.gasket);

    // болты на раме
    const boltGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.09, 6);
    boltGeo.rotateX(Math.PI / 2);
    this.boltMat = new THREE.MeshStandardMaterial({ color: 0x7d857d, metalness: 0.9, roughness: 0.36, envMapIntensity: 0.9, transparent: true });
    const NB = 20;
    this.bolts = new THREE.InstancedMesh(boltGeo, this.boltMat, NB);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * TAU + 0.08;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a * 2.3);
      pv.set(Math.cos(a) * 3.72, Math.sin(a) * 3.72, 0.52);
      m4.compose(pv, q, sc);
      this.bolts.setMatrixAt(i, m4);
    }
    this.group.add(this.bolts);

    // заклёпки на стене вокруг рамы
    const rivGeo = new THREE.SphereGeometry(0.07, 12, 6, 0, TAU, 0, Math.PI / 2);
    rivGeo.rotateX(Math.PI / 2);
    this.rivMat = new THREE.MeshStandardMaterial({ color: 0x5d655d, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.8, transparent: true });
    const NR = 36;
    this.rivets = new THREE.InstancedMesh(rivGeo, this.rivMat, NR);
    q.identity();
    for (let i = 0; i < NR; i++) {
      const a = (i / NR) * TAU;
      pv.set(Math.cos(a) * 4.42, Math.sin(a) * 4.42, -0.04);
      m4.compose(pv, q, sc);
      this.rivets.setMatrixAt(i, m4);
    }
    this.group.add(this.rivets);

    // стекло
    this.glassU = { uOpacity: { value: 1 }, uTime: { value: 0 }, uR: { value: RW }, uInk: { value: 1 } };
    this.glass = new THREE.Mesh(
      new THREE.CircleGeometry(RW, 96),
      new THREE.ShaderMaterial({ uniforms: this.glassU, vertexShader: WALL_VERT, fragmentShader: GLASS_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.glass.position.z = 0.09;
    this.group.add(this.glass);

    // --- Земля
    this.land = await landTexture();
    this.earthU = {
      uLand: { value: this.land }, uSun: { value: this.sunDir.clone() }, uOpacity: { value: 1 },
      uDot: { value: 0.85 * DEG }, uSunUp: { value: 0 }, uTime: { value: 0 },
    };
    this.earthTilt = new THREE.Group();
    this.earthTilt.position.copy(this.earthC);
    this.earthTilt.rotation.set(0.35, 0, 0.41);
    this.root.add(this.earthTilt);
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 128, 96),
      new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG, transparent: true, depthWrite: true }),
    );
    this.earthTilt.add(this.earth);
    this.spin0 = 5.45;   // в окне — крупный материк
    this.earth.rotation.y = this.spin0;

    this.atmU = {
      uCenter: { value: this.earthC.clone() }, uSun: { value: this.sunDir.clone() },
      uR: { value: EARTH_R }, uRA: { value: EARTH_R * ATM_K }, uOpacity: { value: 1 }, uSunUp: { value: 0 }, uSunK: { value: 1 },
    };
    this.atm = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R * ATM_K, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: this.atmU, vertexShader: ATM_VERT, fragmentShader: ATM_FRAG,
        transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      }),
    );
    this.atm.position.copy(this.earthC);
    this.atm.renderOrder = 1;
    this.root.add(this.atm);

    // --- Солнце: диск с лучами (за лимбом) и блик линзы
    this.sunU = { uTime: { value: 0 }, uOpacity: { value: 1 }, uI: { value: 0 } };
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.sunU, vertexShader: BILL_VERT, fragmentShader: SUN_FRAG,
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      }),
    );
    this.sun.renderOrder = 2;
    this.sun.frustumCulled = false;
    this.root.add(this.sun);
    this.flareU = { uOpacity: { value: 1 }, uI: { value: 0 } };
    this.flare = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.flareU, vertexShader: BILL_VERT, fragmentShader: FLARE_FRAG,
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      }),
    );
    this.flare.renderOrder = 3;
    this.flare.frustumCulled = false;
    this.root.add(this.flare);

    this.shape = this.buildShape();
    this.st = { rise: -0.04, up: 0, obj: 1 };
    this._v = new THREE.Vector3();
    this._p0 = new THREE.Vector3();
    this._r0 = new THREE.Vector3();
    this._s0 = 1;
    this._ctr = new THREE.Vector2();
  }

  /** Облако частиц: атмосфера вдоль видимого лимба, звёзды за окном, пылинки в кабине. */
  buildShape() {
    const n = this.ctx.particles.count;
    const s = S.createShape(n), r = rng(808);
    const E = this.earthC, R = EARTH_R;
    // окружность касания (видимый лимб) из расчётной позиции камеры
    const CE = CAM.clone().sub(E);
    const d = CE.length();
    const ax = CE.clone().normalize();
    const Q = E.clone().addScaledVector(ax, (R * R) / d);
    const rho = R * Math.sqrt(1 - (R * R) / (d * d));
    // базис в плоскости лимба: u — к ближайшей к окну точке лимба
    const L0 = CAM.clone().addScaledVector(this.limbDir, Math.sqrt(d * d - R * R));
    const u = L0.clone().sub(Q).normalize();
    const v = new THREE.Vector3().crossVectors(ax, u).normalize();
    const fwd = WIN.clone().sub(CAM).normalize();
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // Млечный Путь — наклонная полоса через окно
    const band = right.clone().multiplyScalar(Math.cos(0.6)).addScaledVector(up, Math.sin(0.6));
    const bandN = new THREE.Vector3().crossVectors(band, fwd).normalize();
    const P = new THREE.Vector3(), N = new THREE.Vector3(), D = new THREE.Vector3();
    const nAtm = Math.floor(n * 0.26), nBand = Math.floor(n * 0.14), nStar = Math.floor(n * 0.016), nDust = Math.floor(n * 0.012);
    let i = 0;
    for (; i < nAtm; i++) {
      const g = clamp(r.gauss(0, 0.36), -0.9, 0.9);
      P.copy(Q).addScaledVector(u, Math.cos(g) * rho).addScaledVector(v, Math.sin(g) * rho);
      N.copy(P).sub(E).normalize();
      const k = r();
      let h, c, a, size;
      if (k < 0.6) {                        // тонкий яркий слой у лимба
        h = Math.abs(r.gauss(0, 0.16));
        c = r() < 0.5 ? S.PAL.pale : S.PAL.mint;
        a = r.range(0.04, 0.12); size = r.range(1.2, 2.4);
      } else if (k < 0.9) {                 // внешнее зелёное свечение
        h = 0.15 + Math.abs(r.gauss(0, 0.5));
        c = r() < 0.75 ? S.PAL.green : S.PAL.mint;
        a = r.range(0.02, 0.07); size = r.range(1.6, 3.0);
      } else {                              // искры чуть внутри диска (над атмосферой)
        h = -Math.abs(r.gauss(0, 0.1));
        P.lerp(CAM, 0.003 * r());
        c = r() < 0.35 ? S.PAL.greenHi : S.PAL.white;
        a = r.range(0.04, 0.12); size = r.range(0.9, 1.8);
      }
      P.addScaledVector(N, h).addScaledVector(D.set(r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1)), 0.04);
      S.setPoint(s, i, P.x, P.y, P.z, size, c, a);
    }
    // Млечный Путь — слабая светящаяся полоса из множества тусклых точек
    for (let j = 0; j < nBand; j++, i++) {
      const t = r.range(-1, 1) * 0.32;
      const w = r.gauss(0, 0.028) * (1 + 0.6 * Math.sin(t * 17));
      D.copy(fwd).addScaledVector(right, band.x * t + bandN.x * w).addScaledVector(up, band.y * t + bandN.y * w).normalize();
      P.copy(CAM).addScaledVector(D, r.range(110, 170));
      const c = r() < 0.7 ? S.PAL.white : r() < 0.6 ? S.PAL.mint : S.PAL.blue;
      S.setPoint(s, i, P.x, P.y, P.z, r.range(1.8, 3.6), c, r.range(0.02, 0.06));
    }
    // отдельные звёзды
    for (let j = 0; j < nStar; j++, i++) {
      const a0 = r() * TAU, rr = Math.sqrt(r()) * Math.tan(17 * DEG);
      D.copy(fwd).addScaledVector(right, Math.cos(a0) * rr).addScaledVector(up, Math.sin(a0) * rr).normalize();
      P.copy(CAM).addScaledVector(D, r.range(90, 170));
      const big = Math.pow(r(), 8);
      const t = r();
      const c = t < 0.7 ? S.PAL.white : t < 0.82 ? S.PAL.blue : t < 0.93 ? S.PAL.mint : S.PAL.greenHi;
      S.setPoint(s, i, P.x, P.y, P.z, 2.6 + big * 10, c, r.range(0.3, 0.9));
    }
    // пылинки в кабине (перед окном) — дают глубину
    for (let j = 0; j < nDust; j++, i++) {
      S.setPoint(s, i, r.range(-6, 6), r.range(-4, 4.5), r.range(1.5, 10), r.range(0.4, 0.9), r() < 0.7 ? S.PAL.white : S.PAL.mint, r.range(0.04, 0.1));
    }
    for (; i < n; i++) {
      // лишние частицы — невидимы, далеко за Землёй
      D.copy(fwd).addScaledVector(right, r.range(-0.2, 0.2)).addScaledVector(up, r.range(-0.2, 0.2)).normalize();
      P.copy(CAM).addScaledVector(D, r.range(90, 160));
      S.setPoint(s, i, P.x, P.y, P.z, 1, S.PAL.white, 0);
    }
    return s;
  }

  /** Иллюминатор — в «сцене 16:9»; под экраны 4:3/16:10 камеру подгоняет ядро (director.fitPose), здесь ничего не масштабируем. */
  layout() {
    this.group.scale.setScalar(PORT_SC);
    this.group.position.copy(WIN);
  }

  camera() { return { pos: CAM.toArray(), target: [0, 0, 0], fov: 40 }; }
  // за окном — чёрный космос (халфтон-свечение фона просвечивало бы в окне)
  background() { return 'none'; }

  enter(o = {}) {
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.layout();
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.16, swirl: 0, size: 0.062, twinkle: 0.55, spring: 15, damping: 5.4, opacity: 1, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    // сцена далеко (Земля в ~50 единицах) — плотность гасим сильнее обычного
    p.morph(this.shape, { duration: o.instant ? 0.01 : 2.4, stagger: 0.5, burst: 10, equalizeOpts: { target: 3 } });
    const obj = p.object;
    this._p0.copy(obj.position);
    this._r0.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    this._s0 = obj.scale.x;
    this.st.obj = 0;
    this.tw(this.st, { obj: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    // восход: Солнце выходит из-за края Земли
    this.st.rise = -0.04; this.st.up = 0;
    this.tw(this.st, { rise: 0.013, duration: o.instant ? 0 : 4.2, delay: o.instant ? 0 : 0.7, ease: 'power2.out' });
    this.tw(this.st, { up: 1, duration: o.instant ? 0 : 3.4, delay: o.instant ? 0 : 0.5, ease: 'power1.inOut' });
    this.earth.rotation.y = this.spin0;
    // лёгкое «покачивание» камеры — параллакс рамы и далёкой Земли.
    // fov не задаём: остаётся угол, подогнанный ядром под экран (4:3, 16:10).
    const sway = this._sway || (this._sway = { pos: [0, 0, 0], target: [0, 0, 0] });
    this.delay(o.instant ? 0 : 1.4, () => {
      if (!this.active) return;
      this.drive((dt, t) => {
        sway.pos[0] = Math.sin(t * 0.16) * 0.38;
        sway.pos[1] = Math.sin(t * 0.12 + 1) * 0.22;
        sway.pos[2] = CAM.z - 0.3 * (0.5 + 0.5 * Math.sin(t * 0.07));
        sway.target[0] = Math.sin(t * 0.16) * 0.1;
        sway.target[1] = 0.05 + Math.sin(t * 0.12 + 1) * 0.06;
        return sway;
      }, 2.5);
    });
    return super.enter(o);
  }

  exit(o = {}) {
    this.drive(null);
    return super.exit(o);
  }

  update(dt, t) {
    const st = this.st;
    const cam = this.ctx.camera;
    // Земля вращается
    this.earth.rotation.y += dt * 0.022;
    // Солнце: от лимба «вверх» на угол rise
    this.sunDir.copy(this.sunBase).applyAxisAngle(this.sunAxis, st.rise);
    this.earthU.uSun.value.copy(this.sunDir);
    this.atmU.uSun.value.copy(this.sunDir);
    this.earthU.uSunUp.value = st.up;
    this.atmU.uSunUp.value = st.up;
    // видимость диска Солнца над лимбом (с учётом реальной позиции камеры)
    const v = this._v.copy(this.earthC).sub(cam.position);
    const dE = v.length();
    const sep = Math.acos(clamp(v.normalize().dot(this.sunDir), -1, 1)) - Math.asin(EARTH_R / dE);
    const vis = clamp((sep + 0.004) / 0.012, 0, 1);
    const sunI = vis * vis * (3 - 2 * vis);
    this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 320);
    this.sun.quaternion.copy(cam.quaternion);
    this.sun.scale.setScalar(72);
    this.flare.position.copy(this.sun.position);
    this.flare.quaternion.copy(cam.quaternion);
    this.flare.scale.setScalar(200);
    this.sunU.uTime.value = t;
    // в светлой теме (инверсия яркости) Солнце и блик становятся чернильной «кляксой» — сильно приглушаем
    const inv = this.ctx.engine.fx.invert;
    this.sunU.uI.value = (0.25 + 0.75 * sunI * st.up) * (1 - 0.8 * inv);
    this.flareU.uI.value = sunI * st.up * (1 - inv);
    this.atmU.uSunK.value = 1 - 0.75 * inv;
    this.glassU.uInk.value = 1 - 0.6 * inv;
    // направление «к Солнцу» в плоскости стены — для подсветки халфтона
    this._v.copy(this.sunDir).multiplyScalar(100).add(CAM);
    this._ctr.set(this._v.x - WIN.x, this._v.y - WIN.y).normalize();
    this.wallU.uSun2.value.copy(this._ctr);
    this.wallU.uSunI.value = sunI * st.up;
    this.wallU.uTime.value = t;
    this.glassU.uTime.value = t;
    // облако частиц — в мировых координатах сцены
    if (this.ownsParticles()) {
      const o = this.particles.object;
      const k = st.obj;
      if (k >= 1) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }
      else {
        o.position.copy(this._p0).multiplyScalar(1 - k);
        o.rotation.set(this._r0.x * (1 - k), this._r0.y * (1 - k), this._r0.z * (1 - k));
        o.scale.setScalar(lerp(this._s0, 1, k));
      }
    }
  }
}
