// «Восток-1» на стартовом столе — в звёздном атласе (небесная сфера, эклиптика с делениями, созвездия,
// Млечный Путь из общего облака частиц).
// Состояния:
//   'pad'   — шаг 0: дата; шаг 1: цитата; шаг 2: обратный отсчёт (countdown:tick) и старт по countdown:done.
//   'final' — для финала (часть b8): шаг 0 — ракета на старте на рассвете; шаг 1 — старт без отсчёта.
// След ракеты — общее облако частиц: точки следа разложены по «задержкам» частиц, поэтому при morph()
// след проявляется снизу вверх ровно вслед за ракетой (см. common.js → particleRanks).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, lerp } from '../../core/utils.js';
import {
  particleRanks, makeBuf, putPoint, copyPoint, skyDomeJob, celestialGrid, constellationGeometry,
  lineMaterial, lineGeometry, starMaterial, glowSprite, pxScale, fitFov, primePrograms,
} from './common.js';

const SKY_R = 46;          // радиус купола со звёздами
const GRID_R = 52;         // радиус линий небесной сферы
const T_TRAIL = 9.5;       // за сколько секунд полёта «рисуется» след
const ROCKET_Y = 0.42;     // высота «нуля» ракеты над землёй (ракета висит в проёме стартового стола)
const TRAIL_FRAC = 7 / 25; // доля частиц облака, отданная следу

// ---------------------------------------------------------------------------
// Шейдеры: огонь, дым, земля-«астролябия», лучи прожекторов
// ---------------------------------------------------------------------------
const FIRE_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec4 aNoz;     // xyz — сопло (в координатах ракеты), w — 1 рулевое
uniform float uTime, uThrust, uLen, uScale, uAge;
varying float vLife;
varying float vA;
void main() {
  float speed = 2.2 + aSeed.y * 1.6;
  float life = fract(uTime * speed + aSeed.x);
  float born = step(life / speed, uAge);
  float vern = aNoz.w;
  float L = uLen * (0.3 + 0.7 * uThrust) * (1.0 - 0.45 * vern) * (0.75 + 0.25 * aSeed.w);
  vec2 lat = (aSeed.zw - 0.5) * 2.0;
  float spread = 0.012 + life * (0.06 + 0.16 * uThrust);
  vec3 p = aNoz.xyz + vec3(lat.x * spread, -life * L, lat.y * spread);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = (0.07 + life * 0.38) * (0.55 + 0.45 * uThrust) * (1.0 - 0.4 * vern);
  gl_PointSize = clamp(sz * uScale / max(0.1, -mv.z), 1.0, 80.0);
  vLife = life;
  vA = born * smoothstep(0.0, 0.04, life) * (1.0 - life) * (1.0 - life) * clamp(uThrust * 2.0, 0.0, 1.0);
}`;
const FIRE_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vLife;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.2) * vA * uOpacity;
  vec3 hot = vec3(2.3, 2.5, 2.2);
  vec3 mid = vec3(0.6, 2.0, 0.7);
  vec3 col = mix(hot, mid, smoothstep(0.06, 0.45, vLife));
  col = mix(col, vec3(0.25, 0.55, 0.3), smoothstep(0.45, 1.0, vLife));
  gl_FragColor = vec4(col, a * 0.4);
}`;

const SMOKE_VERT = /* glsl */ `
attribute vec4 aSeed;   // фаза, направление, дальность, размер
uniform float uTime, uAge, uLife, uScale, uSmoke;
varying float vA;
varying float vLife;
varying float vSeed;
void main() {
  float life = fract(uTime / uLife + aSeed.x);
  float age = life * uLife;
  float born = step(age, uAge);
  float jet = step(0.45, aSeed.w);
  float ang = aSeed.y * 6.2831853;
  // половина клубов — два «языка» из газоотводного лотка (±X), остальные — кольцом вокруг стола
  vec2 dir = mix(vec2(cos(ang), sin(ang)), vec2(sign(cos(ang)), sin(ang) * 0.35), jet);
  dir = normalize(dir);
  float reach = (2.8 + 8.5 * aSeed.z) * (0.6 + 0.6 * jet);
  float dist = sqrt(life) * reach;
  vec3 p = vec3(dir.x * dist, 0.15 + life * life * (1.6 + 2.6 * aSeed.z) + (1.0 - jet) * life * 1.2, dir.y * dist);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = (0.5 + life * (2.0 + 1.6 * aSeed.w));
  gl_PointSize = clamp(sz * uScale / max(0.1, -mv.z), 1.0, 150.0);
  vLife = life;
  vSeed = aSeed.y;
  vA = born * uSmoke * smoothstep(0.0, 0.06, life) * (1.0 - life) * (1.0 - life);
}`;
const SMOKE_FRAG = /* glsl */ `
uniform float uOpacity, uLit;
varying float vA;
varying float vLife;
varying float vSeed;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = length(q) * 2.0;
  if (d > 1.0) discard;
  float lumpy = 0.75 + 0.25 * sin(q.x * 9.0 + vSeed * 40.0) * sin(q.y * 8.0 - vSeed * 25.0);
  float a = exp(-d * d * 2.6) * vA * uOpacity * lumpy;
  // Клубы перекрывают сцену (обычное смешивание): сколько их ни наложится, они не ярче своего цвета —
  // без белого «пересвета» у стола. Молодые клубы подсвечены факелом снизу.
  float glow = clamp(uLit * (1.0 - vLife) * 1.7, 0.0, 1.0);
  vec3 col = mix(vec3(0.27, 0.32, 0.28), vec3(0.74, 1.0, 0.78), glow);
  col = mix(col, vec3(0.4, 0.46, 0.42), smoothstep(0.5, 1.0, vLife) * (1.0 - glow));
  gl_FragColor = vec4(col, a * 0.6);
}`;

const GROUND_VERT = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const GROUND_FRAG = /* glsl */ `
uniform float uOpacity, uAlpha, uGlow, uTime;
uniform vec3 uCol;
varying vec3 vP;
float aaLine(float dist, float w, float aa) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + aa, dist); }
void main() {
  vec2 p = vec2(vP.x, -vP.y);
  float r = length(p);
  float ang = atan(p.y, p.x);
  float aa = max(fwidth(r), 1e-4) * 1.2;
  // концентрические круги через 2 единицы
  float ring = aaLine(abs(fract(r / 2.0 + 0.5) - 0.5) * 2.0, 0.035, aa) * step(1.6, r);
  // лучи через 15°
  float sp = abs(fract(ang / (3.14159265 / 12.0) + 0.5) - 0.5) * (3.14159265 / 12.0) * r;
  float spokes = aaLine(sp, 0.03, aa) * step(2.9, r);
  // кольцо делений (лимб астролябии)
  float limb = aaLine(abs(r - 6.0), 0.05, aa) + aaLine(abs(r - 6.9), 0.05, aa);
  float tk = abs(fract(ang / (2.0 * 0.01745329) + 0.5) - 0.5) * (2.0 * 0.01745329) * r;
  float big = step(0.5, 1.0 - abs(fract(ang / (10.0 * 0.01745329) + 0.5) - 0.5) * 2.0 - 0.9);
  float tick = aaLine(tk, 0.035, aa) * step(6.0, r) * step(r, mix(6.35, 6.85, big));
  float fade = exp(-r / 13.0) * (1.0 - smoothstep(22.0, 34.0, r));
  float lines = (ring * 0.5 + spokes * 0.35 + limb * 0.9 + tick * 0.8) * fade;
  // фирменный халфтон: пятно света от двигателей/прожекторов
  const mat2 R = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  vec2 q = R * p / 0.16;
  vec2 f = fract(q) - 0.5;
  float glow = uGlow * exp(-r * r / 22.0) + 0.16 * exp(-r * r / 40.0);
  float dotm = 1.0 - smoothstep(0.62 * sqrt(clamp(glow, 0.0, 1.0)) - 0.08, 0.62 * sqrt(clamp(glow, 0.0, 1.0)) + 0.08, length(f));
  vec3 col = uCol * lines + vec3(0.25, 1.0, 0.3) * dotm * 0.5 * clamp(glow * 1.5, 0.0, 1.0);
  float a = clamp(lines + dotm * 0.6 * clamp(glow * 1.5, 0.0, 1.0), 0.0, 1.0) * uOpacity * uAlpha;
  gl_FragColor = vec4(col, a);
}`;

const OCCL_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vP;
void main() {
  float r = length(vP.xy);
  float a = 1.0 - smoothstep(30.0, 140.0, r);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.92 * uOpacity);
}`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uOpacity, uAlpha;
uniform vec3 uCol;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float along = clamp(vUv.y, 0.0, 1.0);
  float fall = (1.0 - along) * (1.0 - along);
  float edge = abs(dot(normalize(vN), normalize(vV)));
  float a = fall * edge * edge * uOpacity * uAlpha;
  gl_FragColor = vec4(uCol, a);
}`;

// Пар: дренаж кислорода с корпуса — облачка сползают вниз и тают
const VAPOR_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aSrc;
uniform float uTime, uScale;
varying float vA;
void main() {
  float life = fract(uTime * (0.16 + aSeed.y * 0.1) + aSeed.x);
  vec2 d = normalize(aSrc.xz + vec2(0.001, 0.0));
  vec3 p = aSrc + vec3(d.x, 0.0, d.y) * (0.05 + life * (0.5 + aSeed.z * 0.6))
         + vec3((aSeed.w - 0.5) * life * 0.5, -life * life * (1.2 + aSeed.z * 1.4), (aSeed.z - 0.5) * life * 0.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.18 + life * 0.9) * uScale / max(0.1, -mv.z), 1.0, 90.0);
  vA = smoothstep(0.0, 0.12, life) * (1.0 - life);
}`;
const VAPOR_FRAG = /* glsl */ `
uniform float uOpacity, uVapor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.0) * vA * uOpacity * uVapor * 0.16;
  gl_FragColor = vec4(vec3(0.85, 0.95, 0.88), a);
}`;

// ---------------------------------------------------------------------------
// Текстура корпуса (швы, стрингеры, люки)
// ---------------------------------------------------------------------------
function bodyTexture(kind = 'body') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 1024);
  grd.addColorStop(0, '#f2f4f2');
  grd.addColorStop(1, '#d9dcd9');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 1024);
  const r = rng(kind === 'body' ? 3 : 9);
  g.strokeStyle = 'rgba(25,32,25,.38)';
  g.lineWidth = 2;
  for (let y = 30; y < 1024; y += r.range(60, 120)) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.strokeStyle = 'rgba(25,32,25,.12)';
  g.lineWidth = 1;
  for (let x = 0; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  g.fillStyle = 'rgba(20,26,20,.5)';
  for (let k = 0; k < 14; k++) g.fillRect(r.range(0, 240), r.range(40, 980), r.range(6, 16), r.range(8, 22));
  if (kind === 'fairing') {
    // «окна» обтекателя
    g.fillStyle = 'rgba(8,12,8,.85)';
    for (let k = 0; k < 4; k++) {
      const x = 20 + k * 64;
      g.fillRect(x, 300, 26, 160);
      g.fillRect(x + 4, 520, 18, 90);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function latticeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.strokeRect(0, 3, 256, 58);
  for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 3); g.lineTo(x + 32, 61); g.moveTo(x + 32, 3); g.lineTo(x, 61); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

// ---------------------------------------------------------------------------
// Решётчатые фермы (InstancedMesh из тонких брусков)
// ---------------------------------------------------------------------------
function latticeMatrices({ h, w, d, bay, t, diag = true }) {
  const out = [];
  const up = new THREE.Vector3(0, 1, 0);
  const member = (a, b, th = t) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const p = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    out.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(th, len, th)));
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const n = Math.max(1, Math.round(h / bay));
  cs.forEach(([x, z]) => member(V(x, 0, z), V(x, h, z), t * 1.5));
  for (let k = 0; k <= n; k++) {
    const y = (k * h) / n;
    for (let c = 0; c < 4; c++) {
      const [x0, z0] = cs[c], [x1, z1] = cs[(c + 1) % 4];
      member(V(x0, y, z0), V(x1, y, z1));
    }
  }
  if (diag) {
    for (let k = 0; k < n; k++) {
      const y0 = (k * h) / n, y1 = ((k + 1) * h) / n;
      for (let c = 0; c < 4; c++) {
        const [x0, z0] = cs[c], [x1, z1] = cs[(c + 1) % 4];
        if ((k + c) % 2) member(V(x0, y0, z0), V(x1, y1, z1), t * 0.8);
        else member(V(x0, y1, z0), V(x1, y0, z1), t * 0.8);
      }
    }
  }
  return out;
}

function instancedFrom(mats, geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => m.setMatrixAt(i, mm));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere?.();
  return m;
}

// ---------------------------------------------------------------------------
export default class Vostok extends Visual {
  static transition = 'warp';

  async init() {
    const ctx = this.ctx;
    this.cache = new Map();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._tilt = { x: 0, z: 0 };
    this._pose = { pos: [0, 0, 0], target: [0, 0, 0], fov: 40 };
    this.parked = false;

    // Общие «ручки» анимации
    this.flight = { t: 0 };               // время полёта (с), 0 — на столе
    this.thr = { v: 0 };                  // тяга 0..1
    this.smk = { v: 0 };                  // дым 0..1
    this.arms = { v: 0 };                 // опорные фермы: 0 — держат ракету, 1 — раскрыты
    this.gant = { v: 0 };                 // фермы обслуживания: 0 — подведены, 1 — опущены
    this.flood = { v: 1 };                // прожекторы
    this.dawn = { v: 0 };                 // рассвет
    this.cam = { az: 0.3, dist: 14.5, h: 1.9, ty: 3.8, side: 3.9, fov: 40, orbit: 1, follow: 0, end: 0 };
    this.igniteT = 0;
    this.smokeT = 0;
    this.launched = false;
    this.armed = false;

    // Подсветка от двигателей и прожекторов — «ненастоящий» свет в шейдере (без новых источников,
    // чтобы не пересобирать материалы других сцен).
    this.glowU = {
      uGlowPos: { value: new THREE.Vector3() },
      uGlow: { value: 0 },
      uFloodDir: { value: new THREE.Vector3(0, -0.5, 1).normalize() },
      uFlood: { value: 0.35 },
      uRimDir: { value: new THREE.Vector3(0, 0, -1) },
      uRim: { value: 0 },
    };

    const tex = bodyTexture('body');
    const texF = bodyTexture('fairing');
    this.matBody = this.glowMat(new THREE.MeshStandardMaterial({ color: 0xbfc4bf, map: tex, metalness: 0.28, roughness: 0.5 }));
    this.matFair = this.glowMat(new THREE.MeshStandardMaterial({ color: 0xc6cbc6, map: texF, metalness: 0.3, roughness: 0.45 }));
    this.matDark = this.glowMat(new THREE.MeshStandardMaterial({ color: 0x2b302b, metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }));
    this.matNozzle = new THREE.MeshStandardMaterial({ color: 0x343a34, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide, emissive: new THREE.Color(0x66ff77), emissiveIntensity: 0 });
    this.matTruss = this.glowMat(new THREE.MeshStandardMaterial({ color: 0x6b736b, metalness: 0.55, roughness: 0.45 }));
    this.matPad = this.glowMat(new THREE.MeshStandardMaterial({ color: 0x252a25, metalness: 0.25, roughness: 0.85 }));

    this.buildSky();
    this.buildGround();
    this.buildPad();
    this.buildRocket();
    this.buildFire();
    this.buildSmoke();
    this.buildVapor();

    // «Твёрдые» материалы сразу делаем прозрачными (при opacity = 1 выглядят так же). Иначе базовый
    // setOpacity() при первом входе переключит transparent → другой вариант шейдера (OPAQUE), и ~10 программ
    // MeshStandardMaterial скомпилируются синхронно прямо в кадре: рывок ~1–1,5 с на старте слайда.
    // Прогрев режиссёра (после init) тогда собирает именно те варианты, что будут на экране.
    this.root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.transparent) continue;
        m.transparent = true;
        m.forceSinglePass = true; // двусторонние прозрачные иначе рисуются в два прохода
      }
    });

    // Подпись ракеты
    this.tag = this.label({ html: '<span class="b1-tag"><i></i>«Восток-1»</span>', object: this.rocket, offset: [0.42, 7.1, 0], anchor: 'left', visible: false });

    // Обратный отсчёт (компонент countdown на слайде)
    this.offTick = ctx.bus.on('countdown:tick', (n) => this.onTick(n));
    this.offDone = ctx.bus.on('countdown:done', () => this.onDone());

    // Формы облака частиц (кэш; строятся по частям, чтобы не «замораживать» текущий слайд при фоновой загрузке)
    await this.buildShapes(this.particles.count);
    primePrograms(this);
  }

  // ---------- Материалы ----------
  glowMat(mat) {
    const U = this.glowU;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGlowPos; uniform float uGlow; uniform vec3 uFloodDir; uniform float uFlood; uniform vec3 uRimDir; uniform float uRim;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 vpB1 = -vViewPosition;
            vec3 LB1 = uGlowPos - vpB1;
            float dB1 = length(LB1);
            LB1 /= max(dB1, 1e-3);
            float ndlB1 = max(dot(normal, LB1), 0.0);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.8, 1.0, 0.82) * (uGlow * (0.15 + ndlB1) / (1.0 + dB1 * dB1 * 0.22));
            float flB1 = max(dot(normal, uFloodDir), 0.0);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 1.0, 0.62) * uFlood * flB1 * flB1;
            float rimB1 = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
            totalEmissiveRadiance += vec3(0.75, 1.0, 0.8) * uRim * rimB1 * rimB1 * rimB1 * (0.35 + max(dot(normal, uRimDir), 0.0));
          }`);
    };
    mat.customProgramCacheKey = () => 'b1-vostok-glow';
    return mat;
  }

  // ---------- Небо-атлас ----------
  buildSky() {
    this.skyGroup = new THREE.Group();
    this.root.add(this.skyGroup);
    const grid = celestialGrid(GRID_R);
    this.gridMat = lineMaterial({ color: '#2cff3a', k: 0.55, alpha: 1 });
    this.grid = new THREE.LineSegments(lineGeometry(grid.positions, grid.alphas, grid.ts), this.gridMat);
    this.grid.frustumCulled = false;
    this.skyGroup.add(this.grid);
    const con = constellationGeometry(GRID_R - 1.5);
    const al = new Float32Array(con.segs.length / 3).fill(0.55);
    this.conMat = lineMaterial({ color: '#ffffff', k: 0.6, alpha: 1 });
    this.conLines = new THREE.LineSegments(lineGeometry(con.segs, al), this.conMat);
    this.conLines.frustumCulled = false;
    this.skyGroup.add(this.conLines);
    const n = con.stars.length;
    const sp = new Float32Array(n * 3), ss = new Float32Array(n), sc = new Float32Array(n * 3), ph = new Float32Array(n);
    con.stars.forEach((s, i) => {
      sp.set([s.p.x, s.p.y, s.p.z], i * 3);
      ss[i] = 0.35 + s.m * 0.75;
      const c = i % 5 === 0 ? [0.75, 1.6, 0.8] : [1.25, 1.3, 1.25];
      sc.set(c, i * 3);
      ph[i] = (i * 0.618) % 1;
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    sg.setAttribute('aColor', new THREE.BufferAttribute(sc, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.conStarMat = starMaterial({ k: 1 });
    this.conStars = new THREE.Points(sg, this.conStarMat);
    this.conStars.frustumCulled = false;
    this.skyGroup.add(this.conStars);

    // Рассвет (состояние 'final'): широкое свечение над горизонтом (нижнюю половину спрайтов закрывает
    // «земля»-окклюдер) и край восходящего солнца слева — ядро с горизонтальным бликом.
    const dawnSprite = (color, k, x, y, z, sx, sy) => {
      const s = glowSprite(color, k, 1);
      s.position.set(x, y, z);
      s.scale.set(sx, sy, 1);
      s.material.opacity = 0;
      s.material.userData.noFade = true;
      s.renderOrder = -6;
      this.skyGroup.add(s);
      return s;
    };
    this.dawnGlow = dawnSprite('#bfffc4', 1.0, -14, -2, -70, 170, 44);
    this.dawnCore = dawnSprite('#ffffff', 1.5, -30, 0.9, -66, 13, 13);
    this.dawnStreak = dawnSprite('#e6ffe8', 1.3, -30, 0.9, -66, 95, 1.7);
  }

  // ---------- Земля ----------
  buildGround() {
    const occl = new THREE.Mesh(
      new THREE.CircleGeometry(160, 64),
      new THREE.ShaderMaterial({ uniforms: { uOpacity: { value: 1 } }, vertexShader: GROUND_VERT, fragmentShader: OCCL_FRAG, transparent: true, depthWrite: false }),
    );
    occl.rotation.x = -Math.PI / 2;
    occl.position.y = -0.02;
    occl.renderOrder = -5;
    this.root.add(occl);
    this.groundU = { uOpacity: { value: 1 }, uAlpha: { value: 1 }, uGlow: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0.25, 1.0, 0.32) } };
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(36, 128),
      new THREE.ShaderMaterial({ uniforms: this.groundU, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    ground.renderOrder = -4;
    this.root.add(ground);
  }

  // ---------- Стартовый стол, фермы, прожекторы ----------
  buildPad() {
    this.pad = new THREE.Group();
    this.root.add(this.pad);
    // кольцевой стол с проёмом
    const deck = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(1.05, -0.35), new THREE.Vector2(1.05, 0.3), new THREE.Vector2(2.55, 0.3), new THREE.Vector2(2.8, 0.0), new THREE.Vector2(2.8, -0.02),
    ], 64), this.matPad);
    this.pad.add(deck);
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -0.34;
    this.pad.add(pit);

    const box = new THREE.BoxGeometry(1, 1, 1);
    // Опорные фермы («тюльпан»): от края стола к поясу ракеты, при старте раскрываются
    this.supports = [];
    const L = Math.hypot(2.15 - 0.66, 3.75 - 0.3);
    const lean = Math.atan2(2.15 - 0.66, 3.75 - 0.3);
    const sm = latticeMatrices({ h: L, w: 0.17, d: 0.13, bay: 0.27, t: 0.022 });
    // «лапа» сверху
    sm.push(new THREE.Matrix4().compose(new THREE.Vector3(0, L, 0.03), new THREE.Quaternion(), new THREE.Vector3(0.2, 0.08, 0.2)));
    for (let k = 0; k < 4; k++) {
      const az = (k + 0.5) * Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.sin(az) * 2.15, 0.3, Math.cos(az) * 2.15);
      pivot.rotation.y = az;
      const arm = new THREE.Group();
      arm.rotation.x = -lean;           // наклон внутрь
      arm.add(instancedFrom(sm, box, this.matTruss));
      pivot.add(arm);
      // противовес
      const cw = new THREE.Mesh(box, this.matTruss);
      cw.scale.set(0.34, 0.26, 0.4);
      cw.position.set(0, 0.13, 0.32);
      pivot.add(cw);
      this.pad.add(pivot);
      this.supports.push({ arm, lean });
    }
    // Фермы обслуживания (две башни по бокам), перед стартом опускаются
    this.gantries = [];
    const gm = latticeMatrices({ h: 7.4, w: 0.62, d: 0.5, bay: 0.42, t: 0.03 });
    [2.35, 4.45, 6.3].forEach((y) => {
      const arm = latticeMatrices({ h: 0.78, w: 0.32, d: 0.06, bay: 0.2, t: 0.02 });
      const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
      const tr = new THREE.Matrix4().makeTranslation(-0.31, y, 0);
      arm.forEach((m) => gm.push(new THREE.Matrix4().multiplyMatrices(tr, new THREE.Matrix4().multiplyMatrices(rot, m))));
    });
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.98, 0.3, 0);
      const tower = instancedFrom(gm, box, this.matTruss);
      tower.position.x = -0.31;            // центр башни внутрь от оси поворота
      const holder = new THREE.Group();
      holder.add(tower);
      holder.scale.x = side;               // зеркально для левой башни
      pivot.add(holder);
      this.pad.add(pivot);
      this.gantries.push({ pivot, side });
    }
    // Прожекторы с лучами
    this.beams = [];
    this.beamU = { uOpacity: { value: 1 }, uAlpha: { value: 1 }, uCol: { value: new THREE.Color(0.55, 1.0, 0.6).multiplyScalar(0.16) } };
    const beamMat = new THREE.ShaderMaterial({ uniforms: this.beamU, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const lampSpots = [[-1.2, 11.5], [1.25, 12.5], [2.45, 10.5], [-2.35, 11]];
    const lampGeo = new THREE.CylinderGeometry(0.17, 0.12, 0.3, 20);
    const up = new THREE.Vector3(0, 1, 0);
    lampSpots.forEach(([az, r]) => {
      const L0 = new THREE.Vector3(Math.sin(az) * r, 0.35, Math.cos(az) * r);
      const T0 = new THREE.Vector3(0, 4.6, 0);
      const dir = T0.clone().sub(L0);
      const len = dir.length() * 1.35;
      dir.normalize();
      const geo = new THREE.CylinderGeometry(2.4, 0.09, len, 28, 1, true);
      geo.translate(0, len / 2, 0);
      // uv.y: 0 — у лампы … 1 — дальний конец (у CylinderGeometry «верх» = радиус 2.4)
      const beam = new THREE.Mesh(geo, beamMat);
      beam.position.copy(L0);
      beam.quaternion.setFromUnitVectors(up, dir);
      beam.renderOrder = 6;
      this.pad.add(beam);
      const q0 = beam.quaternion.clone();
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();
      const lamp = glowSprite('#c8ffcc', 1.6, 0.75);
      lamp.position.copy(L0).addScaledVector(dir, 0.12);
      lamp.material.userData.noFade = true;
      this.pad.add(lamp);
      // корпус прожектора: стойка + цилиндр, повёрнутый на ракету
      const housing = new THREE.Mesh(lampGeo, this.matDark);
      housing.position.copy(L0);
      housing.quaternion.setFromUnitVectors(up, dir);
      this.pad.add(housing);
      const post = new THREE.Mesh(box, this.matTruss);
      post.scale.set(0.06, 0.36, 0.06);
      post.position.copy(L0).add(new THREE.Vector3(0, -0.18, 0));
      this.pad.add(post);
      this.beams.push({ beam, lamp, q0, side, ph: az * 3.1 });
    });
  }

  // ---------- Ракета Р-7 «Восток» ----------
  buildRocket() {
    const V2 = (r, y) => new THREE.Vector2(r, y);
    this.rocket = new THREE.Group();
    this.rocket.position.set(0, ROCKET_Y, 0);
    this.root.add(this.rocket);
    const R = this.rocket;
    const SEG = 48;
    // Центральный блок «А» — с характерной «талией» внизу
    const coreProf = [V2(0, -0.08), V2(0.16, -0.08), V2(0.19, 0), V2(0.205, 0.3), V2(0.226, 1.0), V2(0.256, 2.0), V2(0.283, 3.0), V2(0.295, 3.7),
      V2(0.296, 4.5), V2(0.286, 5.0), V2(0.257, 5.35), V2(0.218, 5.55), V2(0.203, 5.62), V2(0, 5.62)];
    R.add(new THREE.Mesh(new THREE.LatheGeometry(coreProf, SEG), this.matBody));
    // Межступенчатая ферма
    const lt = latticeTexture();
    const inter = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.2, 0.24, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x8a918a, metalness: 0.6, roughness: 0.4, alphaMap: lt, alphaTest: 0.5, side: THREE.DoubleSide }));
    inter.position.y = 5.74;
    R.add(inter);
    const innerCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 16), this.matDark);
    innerCyl.position.y = 5.74;
    R.add(innerCyl);
    // Блок «Е» (третья ступень)
    R.add(new THREE.Mesh(new THREE.LatheGeometry([V2(0, 5.86), V2(0.24, 5.86), V2(0.258, 5.9), V2(0.258, 6.42), V2(0.252, 6.46), V2(0, 6.46)], SEG), this.matBody));
    // Головной обтекатель корабля «Восток»
    R.add(new THREE.Mesh(new THREE.LatheGeometry([V2(0, 6.46), V2(0.252, 6.46), V2(0.262, 6.5), V2(0.262, 6.8), V2(0.24, 6.98), V2(0.19, 7.22),
      V2(0.135, 7.42), V2(0.082, 7.58), V2(0.045, 7.67), V2(0.018, 7.72), V2(0, 7.73)], SEG), this.matFair));
    // Боковые блоки — конусы, прислонённые к центральному
    const boostProf = [V2(0, -0.06), V2(0.2, -0.06), V2(0.238, 0), V2(0.27, 0.12), V2(0.27, 1.05), V2(0.252, 1.45), V2(0.212, 2.0), V2(0.163, 2.6),
      V2(0.108, 3.15), V2(0.064, 3.58), V2(0.032, 3.84), V2(0.012, 3.93), V2(0, 3.95)];
    const boostGeo = new THREE.LatheGeometry(boostProf, SEG);
    const finGeo = new THREE.BoxGeometry(0.014, 0.5, 0.34);
    const R0 = 0.535, tilt = Math.atan2(R0 - 0.29, 3.92);
    const nozzleGeo = new THREE.LatheGeometry([V2(0.026, 0.02), V2(0.034, -0.02), V2(0.05, -0.09), V2(0.068, -0.19), V2(0.076, -0.26)], 18);
    const nozMats = [];
    this.nozzles = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const addNoz = (x, y, z, s, vern) => {
      nozMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.identity().clone(), sc.set(s, s, s).clone()));
      this.nozzles.push([x, y - 0.28 * s, z, vern ? 1 : 0]);
    };
    for (let k = 0; k < 4; k++) {
      const az = k * Math.PI / 2;
      const g = new THREE.Group();
      g.position.set(Math.sin(az) * R0, 0, Math.cos(az) * R0);
      g.rotation.y = az;
      const b = new THREE.Group();
      b.rotation.x = -tilt;             // верх — к центральному блоку
      b.add(new THREE.Mesh(boostGeo, this.matBody));
      const fin = new THREE.Mesh(finGeo, this.matBody);
      fin.position.set(0, 0.24, 0.36);
      b.add(fin);
      g.add(b);
      R.add(g);
      // сопла бокового блока: 4 основных + 2 рулевых
      const ax = new THREE.Vector3();
      for (const [dx, dz] of [[-0.075, -0.075], [0.075, -0.075], [-0.075, 0.075], [0.075, 0.075]]) {
        ax.set(dx, -0.06, dz).applyAxisAngle(new THREE.Vector3(1, 0, 0), -tilt).applyAxisAngle(new THREE.Vector3(0, 1, 0), az).add(g.position);
        addNoz(ax.x, ax.y, ax.z, 1, false);
      }
      for (const dx of [-0.2, 0.2]) {
        ax.set(dx, -0.04, 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), az).add(g.position);
        addNoz(ax.x, ax.y, ax.z, 0.55, true);
      }
    }
    // сопла центрального блока: 4 основных + 4 рулевых
    for (const [dx, dz] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) addNoz(dx, -0.08, dz, 1, false);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; addNoz(Math.sin(a) * 0.17, -0.07, Math.cos(a) * 0.17, 0.5, true); }
    const noz = new THREE.InstancedMesh(nozzleGeo, this.matNozzle, nozMats.length);
    nozMats.forEach((mm, i) => noz.setMatrixAt(i, mm));
    noz.instanceMatrix.needsUpdate = true;
    R.add(noz);
    // Свечение сопел
    this.nozGlow = [];
    [[0, -0.35, 0], ...[0, 1, 2, 3].map((k) => [Math.sin(k * Math.PI / 2) * R0, -0.3, Math.cos(k * Math.PI / 2) * R0])].forEach((p) => {
      const s = glowSprite('#d9ffd9', 2.2, 0.01);
      s.position.set(...p);
      s.material.userData.noFade = true;
      R.add(s);
      this.nozGlow.push(s);
    });
  }

  // ---------- Огонь двигателей ----------
  buildFire() {
    const N = this.ctx.quality === 'low' ? 1400 : 2600;
    const r = rng(17);
    const seed = new Float32Array(N * 4), noz = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      seed.set([r(), r(), r(), r()], i * 4);
      const nz = this.nozzles[Math.floor(r() * this.nozzles.length)];
      noz.set(nz, i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aNoz', new THREE.BufferAttribute(noz, 4));
    this.fireU = { uTime: { value: 0 }, uThrust: { value: 0 }, uLen: { value: 2.4 }, uScale: { value: 600 }, uAge: { value: 0 }, uOpacity: { value: 1 } };
    this.fire = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.fireU, vertexShader: FIRE_VERT, fragmentShader: FIRE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fire.frustumCulled = false;
    this.fire.renderOrder = 8;
    this.rocket.add(this.fire);
  }

  // ---------- Дым ----------
  buildSmoke() {
    // меньше, но плотнее клубы: дым — самая «дорогая» по заливке часть старта
    const N = this.ctx.quality === 'low' ? 180 : 300;
    const r = rng(23);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) seed.set([r(), r(), r(), r()], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.smokeU = { uTime: { value: 0 }, uAge: { value: 0 }, uLife: { value: 4.2 }, uScale: { value: 600 }, uSmoke: { value: 0 }, uOpacity: { value: 1 }, uLit: { value: 0 } };
    this.smoke = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.smokeU, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false }));
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 7.5;   // до огня: факел светится поверх клубов
    this.root.add(this.smoke);
  }

  // ---------- Пар (дренаж кислорода, ракета «дышит» на старте) ----------
  buildVapor() {
    const N = 160;
    const r = rng(29);
    const seed = new Float32Array(N * 4);
    const src = new Float32Array(N * 3);
    // точки сброса: середина центрального блока и верх боковых блоков
    const vents = [[0.25, 3.3, 0.1], [-0.22, 3.0, -0.15], [0.5, 2.6, 0.32], [-0.48, 2.5, 0.3], [0.18, 4.6, -0.22]];
    for (let i = 0; i < N; i++) {
      seed.set([r(), r(), r(), r()], i * 4);
      src.set(vents[i % vents.length], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aSrc', new THREE.BufferAttribute(src, 3));
    this.vaporU = { uTime: { value: 0 }, uScale: { value: 600 }, uOpacity: { value: 1 }, uVapor: { value: 1 } };
    this.vapor = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.vaporU,
      vertexShader: VAPOR_VERT,
      fragmentShader: VAPOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.vapor.frustumCulled = false;
    this.vapor.renderOrder = 7;
    this.rocket.add(this.vapor);
  }

  // ---------- Траектория ----------
  flightPos(tau, out) {
    const t = Math.max(0, tau);
    return out.set(-0.0042 * t * t * t, ROCKET_Y + 0.17 * t * t + 0.06 * t, -0.0022 * t * t * t);
  }
  flightTilt(tau, out = this._tilt) {
    const t = Math.max(0, tau);
    const vx = -0.0126 * t * t, vy = 0.34 * t + 0.06, vz = -0.0066 * t * t;
    out.z = Math.atan2(-vx, vy);
    out.x = Math.atan2(vz, vy);
    return out;
  }
  /** Точка выхлопа (низ ракеты) в момент tau. */
  exhaustPos(tau, out) {
    this.flightPos(tau, out);
    const tl = this.flightTilt(tau);
    out.x += Math.sin(-tl.z) * -0.45;
    out.y -= 0.45;
    out.z += Math.sin(tl.x) * -0.45;
    return out;
  }

  // ---------- Формы облака частиц ----------
  // Купол неба (полоса Млечного Пути) + частицы следа. Частицы следа живут в трёх раскладках:
  //   park  — невидимы, рассыпаны по куполу (при входе на слайд растворяются в небе, а не слетаются к ракете);
  //   hid   — невидимы, уже стоят на траектории (тихо переезжают туда из park, пока идёт рассказ);
  //   trail — видимый след: при старте morph(hid → trail) «рисует» его снизу вверх вслед за ракетой.
  /** Построить общие буферы заранее, по частям (с паузами между кусками). */
  async buildShapes(count) {
    if (this.cache.has(count)) return this.cache.get(count);
    const job = this.shapesJob(count);
    const pause = () => new Promise((r) => setTimeout(r, 0));
    for (;;) {
      const it = job.next();
      if (it.done) break;
      await pause();
    }
    // формы слайда «Старт» — заранее (рассветные для финала части b8 соберутся при первом входе)
    for (const kind of ['in', 'pad', 'launch']) { this.shape(kind, false); await pause(); }
    return this.cache.get(count);
  }

  /** Общие буферы (синхронно достраивает, если их ещё нет — например, сменилось число частиц). */
  shapes(count) {
    if (this.cache.has(count)) return this.cache.get(count);
    const job = this.shapesJob(count);
    let it;
    do { it = job.next(); } while (!it.done);
    return it.value;
  }

  *shapesJob(count) {
    const ranks = particleRanks(count);
    yield;
    const trailIdx = [], bandIdx = [];
    for (let k = 0; k < count; k++) ((k % 25) < 7 ? trailIdx : bandIdx).push(ranks.order[k]);
    const nT = trailIdx.length, nB = bandIdx.length;
    const band = yield* skyDomeJob(nB, { radius: SKY_R, seed: 31 });
    // след: точка k — момент полёта tau_k (по возрастанию «задержки» частицы)
    const r = rng(77);
    const trail = makeBuf(nT), hid = makeBuf(nT), park = makeBuf(nT);
    const p = new THREE.Vector3();
    const pale = S.PAL.pale, mint = S.PAL.mint, white = S.PAL.white, hot = S.scaleColor(S.PAL.pale, 1.35);
    for (let k = 0; k < nT; k++) {
      const tau = ((k + r()) / nT) * T_TRAIL;
      this.exhaustPos(tau, p);
      const age = T_TRAIL - tau;                // «возраст» участка следа к концу полёта
      const ground = clamp(1 - (p.y - 0.2) / 1.8, 0, 1);
      const sig = 0.035 + 0.05 * Math.pow(age, 1.15) + ground * 0.55;
      const x = p.x + r.gauss(0, sig), y = p.y + r.gauss(0, sig * 0.8) - r() * 0.25, z = p.z + r.gauss(0, sig);
      const young = Math.exp(-age / 1.6);
      const c = young > 0.5 ? (r() < 0.6 ? hot : pale) : (r() < 0.55 ? mint : r() < 0.6 ? white : pale);
      const size = 0.55 + 1.3 * (1 - young) * r.range(0.6, 1.2) + ground * 0.8;
      const a = (0.34 + 0.46 * young) * r.range(0.65, 1) * (1 - 0.4 * ground);
      putPoint(trail, k, x, Math.max(0.05, y), z, size, c, a);
      putPoint(hid, k, x, Math.max(0.05, y), z, size * 0.3, c, 0);
      // «стоянка» на куполе — рядом со звездой полосы, тоже невидимо
      const j = ((k * 7919) % nB) * 4;
      putPoint(park, k, band.P[j], band.P[j + 1], band.P[j + 2], 0.3, c, 0);
      if ((k & 8191) === 8191) yield;
    }
    // выравнивание плотности только для следа (купол редкий)
    S.equalize({ count: nT, positions: trail.P, colors: trail.C, meta: {} }, { axis: 'z', cell: 0.14, target: 7.5 });
    const base = { count, nT, nB, trailIdx, bandIdx, band, bufs: { in: park, pad: hid, launch: trail }, made: {} };
    this.cache.set(count, base);
    return base;
  }

  /** Форма облака: kind — 'in' (вход) | 'pad' (на столе) | 'launch' (след); dawn — приглушённый купол (рассвет). */
  shape(kind, dawn = this.state === 'final') {
    const b = this.shapes(this.particles.count);
    const key = (dawn ? 'dawn-' : '') + kind;
    if (b.made[key]) return b.made[key];
    const s = S.createShape(b.count);
    const bandK = dawn ? 0.4 : 1;
    for (let k = 0; k < b.nB; k++) {
      copyPoint(s, b.bandIdx[k], b.band, k);
      if (bandK !== 1) s.colors[b.bandIdx[k] * 4 + 3] *= bandK;
    }
    const tb = b.bufs[kind];
    for (let k = 0; k < b.nT; k++) copyPoint(s, b.trailIdx[k], tb, k);
    s.meta.equalized = true;
    b.made[key] = s;
    return s;
  }

  // ---------- Камера ----------
  /**
   * Поза облёта для сцены 16:9 (st — параметры облёта, t — время для медленного «дыхания» орбиты).
   * fit — подогнать угол обзора под экран уже 16:9: позы из camera() подгоняет режиссёр (fitPose),
   * а покадровую камеру (drive) — мы сами, тем же способом.
   */
  basePose(st = this.cam, t = 0, out = this._pose, fit = false) {
    const az = st.az + st.orbit * (Math.sin(t * 0.07) * 0.16 + Math.sin(t * 0.031 + 1) * 0.08);
    const dist = st.dist;
    const px = Math.sin(az) * dist, py = st.h, pz = Math.cos(az) * dist;
    // сдвиг кадра: ракета — в правой части сцены 16:9 (слева текст)
    const rx = Math.cos(az), rz = -Math.sin(az);
    const side = st.side;
    out.pos[0] = px - rx * side; out.pos[1] = py; out.pos[2] = pz - rz * side;
    out.target[0] = -rx * side; out.target[1] = st.ty; out.target[2] = -rz * side;
    out.fov = st.fov;
    // следование за ракетой: в кадре вся ракета с факелом (цель — середина корпуса), затем отъезд —
    // видно, как след дугой уходит в небо над стартовым столом
    if (st.follow > 0.001 || st.end > 0.001) {
      const rp = this.flightPos(this.flight.t, this._v3);
      const f = st.follow;
      out.target[0] = lerp(out.target[0], rp.x * 0.6 - rx * side * 0.4, f);
      out.target[1] = lerp(out.target[1], Math.min(rp.y + 3.3, 12.5), f);
      out.target[2] = lerp(out.target[2], rp.z * 0.6, f);
      out.pos[1] = lerp(out.pos[1], st.h + Math.min(rp.y, 14) * 0.3, f);
      const e = st.end;
      if (e > 0.001) {
        out.pos[0] = lerp(out.pos[0], 7.5, e);
        out.pos[1] = lerp(out.pos[1], 3.2, e);
        out.pos[2] = lerp(out.pos[2], 21.5, e);
        out.target[0] = lerp(out.target[0], -2.2, e);
        out.target[1] = lerp(out.target[1], 7.2, e);
        out.target[2] = lerp(out.target[2], -1.5, e);
        out.fov = lerp(out.fov, 44, e);
      }
    }
    if (fit) out.fov = fitFov(this.ctx, out.fov);
    return out;
  }

  camParams(state, step) {
    // финал (часть b8): ракета по центру и чуть выше — внизу сцены подпись и «карта» обратного пути
    if (state === 'final') {
      if (step >= 1) return { az: -0.08, dist: 18, h: 1.4, ty: 3.4, side: 1.4, fov: 42, orbit: 0.3 };
      return { az: -0.08, dist: 18, h: 1.3, ty: 3.0, side: 1.4, fov: 42, orbit: 0.3 };
    }
    if (step === 1) return { az: -0.42, dist: 13.4, h: 3.4, ty: 4.1, side: 3.7, fov: 40, orbit: 1 };
    if (step >= 2) return { az: 0.1, dist: 14, h: 1.4, ty: 4.0, side: 3.5, fov: 42, orbit: 0.4 };
    return { az: 0.36, dist: 14.6, h: 1.7, ty: 3.9, side: 3.9, fov: 40, orbit: 1 };
  }

  // Поза для режиссёра (пролёт при входе и на шагах) — та же, что у покадровой камеры, иначе после
  // перехода камера «доплывает» в другое место. После старта — общий план со следом.
  camera(state, step) {
    const launched = this.launched && (state === 'final' ? step >= 1 : step >= 2);
    const st = { ...this.camParams(state, step), follow: launched ? this.followK(state) : 0, end: launched ? 1 : 0 };
    return this.basePose(st, this.ctx.time, { pos: [0, 0, 0], target: [0, 0, 0], fov: 40 });
  }

  /** Насколько камера провожает ракету после старта. */
  followK(state) { return state === 'final' ? 0.45 : 1; }

  background(state, step) {
    // рассвет — фирменной халфтон-полосой у горизонта
    if (state === 'final') return { glows: [[-0.55, -0.16, 0.55, 0.42]], band: [0.42, -0.2, 0.07, 0.03] };
    if (step >= 2 && this.launched) return { glows: [[0.3, -0.36, 0.55, 0.38]], band: [0.24, -0.38, 0.06, 0.0] };
    return { glows: [[0.42, -0.2, 0.42, 0.34]], band: [0.26, -0.17, 0.05, 0.0] };
  }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state || 'pad';
    this.step = o.step ?? 0;
    this.active = true;
    this.claimParticles();
    const p = this.particles;
    const inst = !!o.instant;
    p.setParams({ noise: 0.12, swirl: 0, size: 0.062, twinkle: 0.45, spring: 14, damping: 5.2, flow: [0, 0, 0] }, inst ? 0 : 1.2);
    this.tw(p.object.position, { x: 0, y: 0, z: 0, duration: inst ? 0 : 1.4, ease: 'power2.inOut' });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: inst ? 0 : 1.4, ease: 'power2.inOut' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: inst ? 0 : 1.4, ease: 'power2.inOut' });
    const backLaunched = this.isLaunchStep(this.step) && (o.dir ?? 1) < 0;
    this.resetPad(true);
    // Прежняя форма облака (например, «01» титула блока) после прыжка камеры оказалась бы прямо у ракеты:
    // гасим облако в момент вспышки перехода и проявляем, пока частицы разлетаются по куполу.
    this.ctx.gsap.killTweensOf(p.params, 'opacity');
    if (!inst) {
      p.params.opacity = 0;
      this.twk('pop', p.params, { opacity: 1, duration: 1.6, delay: 1.0, ease: 'power1.inOut' });
    } else p.params.opacity = 1;
    if (backLaunched) {
      p.morph(this.shape('launch'), { duration: inst ? 0.01 : 2.6, stagger: 0.55, burst: 10, explode: inst ? 0 : 4 });
    } else if (inst) {
      this.parked = true;
      p.morph(this.shape('pad'), { duration: 0.01, stagger: 0, burst: 0 });
    } else {
      this.enterPad({ duration: 2.6, stagger: 0.55, burst: 10, explode: 4 });
    }
    this.applyLook(true);
    // камера: облёт (подгонка под экран — та же, что у режиссёра)
    Object.assign(this.cam, this.camParams(this.state, this.step), { follow: 0, end: 0 });
    this.drive((dt, t) => this.basePose(this.cam, t, this._pose, true), inst ? 0.01 : 2.4);
    if (backLaunched) this.showLaunched(true);
    else this.applyStep(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.step = o.step ?? 0;
    this.claimParticles();
    this.resetPad(false);
    this.enterPad({ duration: 1.6, stagger: 0.4, burst: 4 });
    this.applyLook(false);
    this.applyStep(this.step, o);
  }

  /**
   * Частицы — в купол неба. Невидимые частицы следа сначала растворяются в небе (а не слетаются к ракете
   * светящимся облаком), а когда купол сложился — тихо переезжают на траекторию (park).
   */
  enterPad(opts) {
    this.parked = false;
    this.particles.morph(this.shape('in'), opts);
    this._parkT?.kill();
    this._parkT = this.delay(opts.duration + 0.2, () => this.park());
  }

  park() {
    this._parkT?.kill();
    this._parkT = null;
    if (this.parked || this.launched || !this.active || !this.ownsParticles()) return;
    this.parked = true;
    this.parkedAt = this.ctx.time + 2.0;   // к этому моменту частицы следа стоят на траектории
    this.particles.morph(this.shape('pad'), { duration: 1.8, stagger: 0.3, burst: 0 });
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    this.applyStep(step, { ...o, prevStep: o.prevStep ?? prev });
  }

  isLaunchStep(step) { return this.state === 'final' ? step >= 1 : step >= 2; }

  applyStep(step, o = {}) {
    const dir = o.dir ?? 1;
    const camP = this.camParams(this.state, step);
    this.twk('cam', this.cam, { ...camP, duration: o.instant || o.entering ? 0 : 1.8, ease: 'power2.inOut' });
    // подпись «Восток-1»
    if (this.state === 'pad' && step < 2) this.tag.show(); else this.tag.hide();
    if (this.isLaunchStep(step)) {
      if (this.launched || this.armed) return;
      if (dir < 0) { this.showLaunched(false); return; }
      if (this.state === 'final') this.launchSequence(true);
      else this.arm();
    } else if (this.launched || this.armed) {
      this.rewind();
    }
  }

  // Вид сцены: ночь (pad) или рассвет (final)
  applyLook(instant) {
    const d = instant ? 0 : 1.6;
    const dawn = this.state === 'final' ? 1 : 0;
    this.tw(this.dawn, { v: dawn, duration: d });
    this.tw(this.flood, { v: dawn ? 0 : 1, duration: d });
    this.tw(this.gant, { v: dawn ? 1 : 0, duration: d, ease: 'power2.inOut' });
  }

  // Ракета на столе, всё сброшено
  resetPad(instant) {
    this.killSeq();
    this._parkT?.kill();
    this._parkT = null;
    this.launched = false;
    this.armed = false;
    this.flight.t = 0;
    this.thr.v = 0;
    this.smk.v = 0;
    this.arms.v = 0;
    this.cam.follow = 0;
    this.cam.end = 0;
    this._t1 = this._t2 = false;
    this.rocket.visible = true;
    if (instant) this.gant.v = this.state === 'final' ? 1 : 0;
  }

  killSeq() {
    (this.seq || []).forEach((t) => t.kill());
    this.seq = [];
  }
  seqAdd(t) { (this.seq = this.seq || []).push(t); return t; }

  // Шаг «отсчёт»: подготовка, синхронизация с компонентом countdown
  arm() {
    this.armed = true;
    this._t1 = this._t2 = false;
    this.killSeq();
    this.park();   // частицы следа — на траекторию (если спикер кликнул раньше, чем они туда переехали)
    // фермы обслуживания отводятся
    this.seqAdd(this.tw(this.gant, { v: 1, duration: 2.6, ease: 'power2.inOut' }));
    this.seqAdd(this.tw(this.smk, { v: 0.18, duration: 1.5 }));
    this.smokeT = this.ctx.engine.time;
    // страховка, если событие отсчёта не пришло
    this.seqAdd(this.delay(1.15, () => this.onTick(2, true)));
    this.seqAdd(this.delay(2.15, () => this.onTick(1, true)));
    this.seqAdd(this.delay(3.3, () => this.onDone(true)));
  }

  onTick(n, fallback = false) {
    if (!this.active || !this.armed || this.launched) return;
    if (this.state !== 'pad' || this.step < 2) return;
    if (n === 2 && !this._t2) {
      this._t2 = true;
      this.igniteT = this.ctx.engine.time;
      this.tw(this.thr, { v: 0.16, duration: 0.6, ease: 'power2.out' });
      this.tw(this.smk, { v: 0.55, duration: 1.0 });
      this.ctx.rig.shake(0.05, 0.8);
    } else if (n === 1 && !this._t1) {
      this._t1 = true;
      if (!this._t2) { this._t2 = true; this.igniteT = this.ctx.engine.time; }
      this.tw(this.thr, { v: 0.55, duration: 0.8, ease: 'power2.out' });
      this.tw(this.smk, { v: 1, duration: 1.0 });
      this.ctx.rig.shake(0.1, 1.0);
    }
    void fallback;
  }

  onDone() {
    if (!this.active || !this.armed || this.launched) return;
    if (this.state !== 'pad' || this.step < 2) return;
    this.launchSequence(false);
  }

  /** Старт: зажигание (если нужно), отрыв, полёт; след — из облака частиц. */
  launchSequence(withIgnition) {
    this.killSeq();
    this.park();
    this.armed = true;
    this._t1 = this._t2 = false;
    const e = this.ctx.engine;
    const go = () => {
      if (!this.active) return;   // слайд уже уходит — частицы может забрать следующая сцена
      this.launched = true;
      this.ctx.background.set(this.background(this.state, this.step), { duration: 2.2 });
      this.seqAdd(this.tw(this.thr, { v: 1, duration: 0.5, ease: 'power2.out' }));
      this.seqAdd(this.tw(this.smk, { v: 1, duration: 0.5 }));
      this.seqAdd(this.tw(this.arms, { v: 1, duration: 1.6, ease: 'power2.out' }));
      this.seqAdd(this.tw(this.gant, { v: 1, duration: 0.8 }));
      this.seqAdd(this.tw(this.flight, { t: 16, duration: 16, ease: 'none' }));
      // в финале камера провожает ракету лишь отчасти: та пролетает сквозь титр «Думайте сами. Поехали!» вверх
      this.seqAdd(this.tw(this.cam, { follow: this.followK(this.state), duration: 3.2, ease: 'power2.inOut' }));
      this.seqAdd(this.tw(this.cam, { end: 1, duration: 6.5, delay: 1.2, ease: 'power2.inOut' }));
      this.seqAdd(this.tw(this.cam, { orbit: 0.15, duration: 3 }));
      this.seqAdd(this.tw(this.smk, { v: 0.35, duration: 9, delay: 3.5, ease: 'power1.inOut' }));
      e.pulse({ flash: 0.22, aberration: 0.8 }, 1.2);
      this.ctx.rig.shake(0.22, 3.2);
      this.ctx.background.surge(0.45, 2.2);
      // след: проявляется вслед за ракетой
      this.claimParticles();
      this.parked = true;
      this.particles.morph(this.shape('launch'), { duration: T_TRAIL / 0.9, stagger: 0.9, burst: 3, ease: 'none' });
    };
    if (withIgnition) {
      this.igniteT = e.time;
      this.smokeT = e.time;
      this.seqAdd(this.tw(this.thr, { v: 0.5, duration: 0.9, ease: 'power2.out' }));
      this.seqAdd(this.tw(this.smk, { v: 0.9, duration: 1 }));
      this.ctx.rig.shake(0.08, 1.0);
      // отрыв — когда частицы следа уже на траектории (клик сразу после входа: двигатели чуть дольше «ревут»)
      this.seqAdd(this.delay(Math.max(1.1, (this.parkedAt || 0) - e.time), go));
    } else {
      if (this.thr.v < 0.1) this.igniteT = e.time;
      go();
    }
  }

  /** Сразу показать состояние «после старта» (переход назад к последнему шагу). */
  showLaunched(entering) {
    this.killSeq();
    this.armed = true;
    this.launched = true;
    this.flight.t = 16;
    this.thr.v = 0;
    this.arms.v = 1;
    this.gant.v = 1;
    this.smokeT = this.ctx.engine.time - 4;
    this.smk.v = 0.3;
    this.seqAdd(this.tw(this.smk, { v: 0.12, duration: 6 }));
    Object.assign(this.cam, { follow: this.followK(this.state), end: 1, orbit: 0.15 });
    this.rocket.visible = false;
    this.parked = true;
    if (!entering) {
      this.claimParticles();
      this.particles.morph(this.shape('launch'), { duration: 1.4, stagger: 0.3, burst: 2 });
    }
  }

  /** Вернуть ракету на стол (шаг назад). */
  rewind() {
    this.killSeq();
    this.armed = false;
    this.launched = false;
    this._t1 = this._t2 = false;
    this.rocket.visible = true;
    const d = 1.4;
    this.seqAdd(this.tw(this.flight, { t: 0, duration: d, ease: 'power2.inOut' }));
    this.seqAdd(this.tw(this.thr, { v: 0, duration: 0.5 }));
    this.seqAdd(this.tw(this.smk, { v: 0, duration: 0.8 }));
    this.seqAdd(this.tw(this.arms, { v: 0, duration: d, ease: 'power2.inOut' }));
    this.seqAdd(this.tw(this.gant, { v: this.state === 'final' ? 1 : 0, duration: d + 0.4, ease: 'power2.inOut' }));
    this.seqAdd(this.tw(this.cam, { follow: 0, end: 0, duration: d, ease: 'power2.inOut' }));
    // след гаснет на месте (позиции те же) — частицы уже стоят на траектории для следующего старта
    this.claimParticles();
    this.parked = true;
    this.particles.morph(this.shape('pad'), { duration: 1.0, stagger: 0.3, burst: 0 });
  }

  exit(o = {}) {
    this.armed = false;
    this._parkT?.kill();
    this._parkT = null;
    // облако — следующей сцене в полной яркости (если уходим, не дождавшись проявления)
    this.killKey('pop');
    if (this.particles.params.opacity < 1) this.particles.setParams({ opacity: 1 }, o.instant ? 0 : 0.5);
    this.drive(null);
    this.tag.hide();
    return super.exit(o);
  }

  killKey(key) {
    const t = this._keyed?.get(key);
    if (t) { t.kill(); this._keyed.delete(key); }
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const ctx = this.ctx;
    const scale = pxScale(ctx);
    // полёт
    const tau = this.flight.t;
    this.flightPos(tau, this.rocket.position);
    const tl = this.flightTilt(tau);
    this.rocket.rotation.set(tl.x, 0, tl.z);
    if (this.launched && tau > 14.5) this.rocket.visible = false;
    else if (tau < 14) this.rocket.visible = true;
    // огонь
    const thr = this.thr.v;
    this.fireU.uTime.value = t;
    this.fireU.uThrust.value = thr;
    this.fireU.uAge.value = Math.max(0, t - this.igniteT);
    this.fireU.uScale.value = scale;
    this.fireU.uLen.value = 1.5 + 2.4 * clamp(tau / 3, 0, 1);
    this.fire.visible = thr > 0.002 && this.rocket.visible;
    this.matNozzle.emissiveIntensity = thr * 2.4;
    const flick = 1 + Math.sin(t * 37) * 0.06 + Math.sin(t * 23.3) * 0.05;
    const ng = this.nozGlow;
    for (let i = 0; i < ng.length; i++) {
      ng[i].scale.setScalar(0.01 + thr * (i === 0 ? 1.3 : 1.0) * flick);
      ng[i].material.opacity = this.opacity;
    }
    // дым
    this.smokeU.uTime.value = t;
    this.smokeU.uAge.value = Math.max(0, t - this.smokeT);
    this.smokeU.uSmoke.value = this.smk.v;
    this.smokeU.uScale.value = scale;
    this.smokeU.uLit.value = thr * clamp(1 - tau / 4, 0, 1);
    this.smoke.visible = this.smk.v > 0.002;
    const vap = this.launched ? 0 : clamp(1 - thr * 3, 0, 1);
    this.vaporU.uTime.value = t;
    this.vaporU.uScale.value = scale;
    this.vaporU.uVapor.value = vap;
    this.vapor.visible = vap > 0.01 && this.rocket.visible;
    // свет двигателей и прожекторов (в координатах камеры)
    const cam = ctx.camera;
    const gp = this._v1.set(0, -0.4, 0);
    this.rocket.localToWorld(gp);
    gp.applyMatrix4(cam.matrixWorldInverse);
    this.glowU.uGlowPos.value.copy(gp);
    this.glowU.uGlow.value = thr * 2.2 * flick;
    this.glowU.uFloodDir.value.set(0, -0.45, 1).normalize().transformDirection(cam.matrixWorldInverse);
    this.glowU.uFlood.value = 0.36 * this.flood.v;
    this.glowU.uRimDir.value.set(-0.2, 0.15, -1).normalize().transformDirection(cam.matrixWorldInverse);
    this.glowU.uRim.value = 0.55 * this.dawn.v;
    this.groundU.uGlow.value = thr * clamp(1.3 - tau / 3.5, 0, 1.3) * 0.9 + 0.12 * this.flood.v;
    this.beamU.uAlpha.value = this.flood.v;
    const lampA = this.flood.v * this.opacity;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      b.beam.quaternion.copy(b.q0);
      this._q.setFromAxisAngle(b.side, Math.sin(t * 0.23 + b.ph) * 0.05);
      b.beam.quaternion.premultiply(this._q);
      b.lamp.material.opacity = lampA;
    }
    // фермы
    const a = this.arms.v;
    for (let i = 0; i < this.supports.length; i++) this.supports[i].arm.rotation.x = -this.supports[i].lean + a * 0.62;
    const gnt = this.gant.v;
    for (let i = 0; i < this.gantries.length; i++) this.gantries[i].pivot.rotation.z = -this.gantries[i].side * gnt * 1.42;
    // небо и рассвет
    const dawn = this.dawn.v;
    this.conStarMat.uniforms.uTime.value = t;
    this.conStarMat.uniforms.uScale.value = scale;
    this.conStarMat.uniforms.uAlpha.value = 1 - 0.6 * dawn;
    this.conMat.uniforms.uAlpha.value = 1 - 0.55 * dawn;
    this.gridMat.uniforms.uAlpha.value = 1 - 0.4 * dawn;
    this.dawnGlow.material.opacity = 0.7 * dawn * this.opacity;
    this.dawnCore.material.opacity = 0.75 * dawn * this.opacity;
    this.dawnStreak.material.opacity = 0.55 * dawn * this.opacity * (0.85 + 0.15 * Math.sin(t * 0.7));
  }

  dispose() {
    this._disposed = true;
    this.offTick?.();
    this.offDone?.();
    super.dispose();
  }
}
