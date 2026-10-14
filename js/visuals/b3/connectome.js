// Блок 3. Коннектом дрозофилы.
//  'map'   — шаг 0: мозг расслаивается на тончайшие срезы-«микрофотографии» (стопка раздвигается);
//            шаг 1: ИИ раскрашивает каждый нейрон своим цветом (волна сегментации по срезам);
//            шаг 2: из стопки собирается многоцветное 3D-облако нейронов (общее облако частиц), медленно вращается.
//  'taste' — мозг внутри головы мухи: шаг 0 — капля сахара падает на лапку; шаг 1 — сигнал бежит по нерву
//            и волной вспышек по мозгу к моторному нейрону; шаг 2 — хоботок вытягивается.
//
// Срезы: атлас 6×6 плиток генерируется один раз на GPU (клетки-«нейроны» — диаграмма Вороного, точки которой
// плавно смещаются от среза к срезу, поэтому один и тот же нейрон проходит через всю стопку и окрашен одинаково).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { HASH, HALFTONE } from '../../core/glsl.js';
import { FlyModel } from './fly-model.js';
import { BOX, BRAIN_GLSL, brainBase, brainBrand, brainColored, brainSlices, neurons, TASTE_IN, MOTOR } from './brain-shape.js';
import { makeBeam, cellPx } from './common.js';

const NS = 36;                // плиток в атласе
const NSHOW = 24;             // срезов в стопке на экране
const GRID = [6, 6];
const TILE = [320, 160];
const SPREAD = 6.2;
const SHEAR = 1.1;
const DEPTH = BOX.z1 - BOX.z0;

// Раскладка мозга в мире для 'map'
// стопка крупно и почти анфас — каждый срез-«микрофотография» читается с последних рядов
const MAP_STACK = { pos: [4.25, 0.1, -1.5], rot: [0.3, -0.64, 0.0], scale: 3.05 };
const MAP_BRAIN = { pos: [5.0, 0.4, 0], rot: [0.14, -0.3, 0], scale: 3.9 };

// Муха для 'taste' (координаты мухи: 1 = 1 мм)
const TASTE_FLY = { scale: 7.0, rot: [0.2, -0.16, 0], head: [3.85, 2.25, 0] };
const BRAIN_W = 0.62;
const lp = (l, x, y, z) => { const a = l._p3 || (l._p3 = [0, 0, 0]); a[0] = x; a[1] = y; a[2] = z; l.setPosition(a); };


const GEN_FRAG = /* glsl */ `
uniform vec2 uGrid;
uniform float uNS;
uniform vec4 uBox;
uniform vec2 uZ;
varying vec2 vUv;
${HASH}
${BRAIN_GLSL}
void main() {
  vec2 g = vUv * uGrid;
  vec2 tile = floor(g);
  vec2 tuv = fract(g);
  float row = uGrid.y - 1.0 - tile.y;
  float idx = row * uGrid.x + tile.x;
  if (idx > uNS - 0.5) { gl_FragColor = vec4(0.0); return; }
  float z = mix(uZ.x, uZ.y, idx / (uNS - 1.0));
  vec2 b = vec2(mix(uBox.x, uBox.y, tuv.x), mix(uBox.z, uBox.w, tuv.y));
  float depth = brainDepth(vec3(b, z));
  float mask = smoothstep(-0.004, 0.02, depth);
  float C = 0.05;
  vec2 q = b / C;
  vec2 gi = floor(q);
  float d1 = 9.0, d2 = 9.0;
  vec2 id1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = gi + vec2(float(i), float(j));
      vec2 h = hash22(c);
      vec2 h2 = hash22(c + 17.31) * 2.0 - 1.0;
      vec2 pt = c + 0.15 + 0.7 * h + h2 * z * 1.5;
      float d = length(q - pt);
      if (d < d1) { d2 = d1; d1 = d; id1 = c; } else if (d < d2) { d2 = d; }
    }
  }
  float memb = 1.0 - smoothstep(0.05, 0.16, d2 - d1);
  float hc = hash12(id1 + 3.7);
  float grain = hash12(floor(vUv * vec2(1920.0, 960.0)) + idx * 7.0);
  float gray = 0.56 + (hash12(id1) - 0.5) * 0.14 - memb * 0.4 + (grain - 0.5) * 0.09;
  if (hc < 0.14) gray -= 0.22 * (1.0 - smoothstep(0.1, 0.32, d1));
  if (hash12(id1 + 9.1) < 0.3) gray -= 0.12 * (1.0 - smoothstep(0.03, 0.07, length(fract(q * 3.0 + hc * 7.0) - 0.5)));
  float edge = 1.0 - smoothstep(0.0, 0.035, depth);
  gray -= edge * 0.25 * mask;
  gl_FragColor = vec4(clamp(gray, 0.0, 1.0), hc, memb, mask);
}
`;

const SLICE_VERT = /* glsl */ `
attribute float aSlice;
uniform float uSpread;
uniform float uShear;
uniform float uDepth;
varying vec2 vUv;
varying float vSlice;
void main() {
  vUv = uv;
  vSlice = aSlice;
  vec3 p = position;
  float k = aSlice - 0.5;
  p.x += k * uShear;
  p.z += k * uDepth * uSpread;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const SLICE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform float uNS;
uniform float uOpacity;
uniform float uSeg;
uniform float uCut;
uniform float uVis;
uniform float uCell;
uniform float uTime;
varying vec2 vUv;
varying float vSlice;
${HALFTONE}
vec3 hsl2rgb(float h, float s, float l) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}
void main() {
  float idx = floor(vSlice * (uNS - 1.0) + 0.5);
  float row = floor(idx / uGrid.x);
  float col = idx - row * uGrid.x;
  vec2 tile = vec2(col, uGrid.y - 1.0 - row);
  vec2 uv = (tile + clamp(vUv, 0.004, 0.996)) / uGrid;
  vec4 t = texture2D(uAtlas, uv);
  float appear = smoothstep(vSlice - 0.03, vSlice + 0.03, uCut * 1.06 - 0.03);
  float vis = clamp(uVis * 1.7 - vSlice * 0.7, 0.0, 1.0) * appear * uOpacity;
  float keep = vis >= 0.999 ? 1.0 : halftoneDot(gl_FragCoord.xy, uCell, vis);
  vec2 e = min(vUv, 1.0 - vUv);
  float frame = 1.0 - smoothstep(0.0, 0.004, min(e.x * 0.5, e.y));
  float tissue = t.a;
  if (keep < 0.5 || (tissue < 0.5 && frame < 0.5)) discard;
  vec3 em = vec3(t.r * t.r) * 0.75;
  vec3 seg = hsl2rgb(t.g, 0.88, 0.55);
  seg = seg * seg * (1.0 - 0.8 * t.b) * 0.95;
  float front = uSeg * 1.6 - vSlice * 0.55;
  float rev = smoothstep(front, front - 0.05, vUv.x);
  float dx = (vUv.x - front) * 30.0;
  float scan = exp(-dx * dx) * step(0.001, uSeg) * step(uSeg, 0.999);
  vec3 c = mix(em, mix(em * 0.35, seg, 0.9), rev);
  c += vec3(0.35, 1.0, 0.45) * scan * 0.9 * tissue;
  // кромка только что «отрезанного» среза
  float cutEdge = smoothstep(vSlice + 0.06, vSlice, uCut) * appear;
  c += vec3(0.4, 1.0, 0.5) * cutEdge * 0.8;
  if (tissue < 0.5) c = vec3(0.06, 0.38, 0.1) * (0.5 + 0.5 * appear);
  gl_FragColor = vec4(c, 1.0);
}
`;

// Вспышки-волна по мозгу (свои точки поверх облака)
const WAVE_VERT = /* glsl */ `
attribute float aDelay;
attribute float aSize;
uniform float uWave;
uniform float uScale;
uniform float uSize;
uniform float uOpacity;
uniform float uDone;
varying float vA;
varying float vHot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float dt = uWave - aDelay;
  float flash = exp(-dt * dt * 90.0);
  float after = step(0.0, dt) * (0.03 + 0.1 * exp(-max(dt, 0.0) * 2.5)) * uDone;
  vA = (flash * 0.75 + after) * uOpacity;
  vHot = flash;
  gl_PointSize = clamp(aSize * uSize * (1.0 + 0.8 * flash) * uScale / max(0.1, -mv.z), 1.0, 24.0);
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const WAVE_FRAG = /* glsl */ `
varying float vA;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 4.0) * vA;
  vec3 c = mix(vec3(0.2, 1.0, 0.3), vec3(0.85, 1.0, 0.8), vHot * 0.6);
  gl_FragColor = vec4(c * 1.1, a);
}
`;

// Светящиеся точки (моторный нейрон, вкусовые рецепторы, вспышка контакта)
const GLOW_VERT = /* glsl */ `
attribute float aSize;
uniform float uScale;
uniform float uK;
uniform float uOpacity;
uniform float uTime;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = 1.0 + 0.18 * sin(uTime * 5.0);
  gl_PointSize = clamp(aSize * uK * pulse * uScale / max(0.1, -mv.z), 1.0, 160.0);
  vA = uOpacity * clamp(uK, 0.0, 1.0);
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d * 3.0) * 0.45;
  float rr = (d - 0.72) * 9.0;
  float ring = exp(-rr * rr) * 0.5;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6) * 1.4, (core + halo + ring) * vA);
}
`;

const DROP_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uGlow;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN), v = normalize(vV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float f = 1.0 - ndv;
  vec3 L = normalize(vec3(0.4, 0.9, 0.5));
  float sp = pow(clamp(dot(n, normalize(L + v)), 0.0, 1.0), 60.0);
  vec3 c = vec3(0.75, 0.82, 0.78) * (0.08 + f * f * 0.9) + vec3(1.0) * sp * 1.2 + vec3(0.3, 1.0, 0.4) * uGlow * (0.3 + f);
  gl_FragColor = vec4(c, clamp(0.15 + f * 0.8 + sp, 0.0, 1.0) * uOpacity);
}
`;
const DROP_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

function glowPoints(positions, sizes, color = '#00ff00') {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uK: { value: 0 }, uOpacity: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color).multiplyScalar(1.2) } },
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 20;
  return p;
}

export default class Connectome extends Visual {
  static transition = 'zoom';

  async init() {
    const n = this.ctx.particles.count;
    this.brainGroup = new THREE.Group();
    this.root.add(this.brainGroup);
    this._seq = new Set();

    // --- атлас срезов (GPU) и стопка
    this.atlas = this.makeAtlas();
    const geo = new THREE.PlaneGeometry(BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, 1, 1).translate(0, (BOX.y0 + BOX.y1) / 2, 0);
    const aSlice = new Float32Array(NSHOW);
    for (let i = 0; i < NSHOW; i++) aSlice[i] = i / (NSHOW - 1);
    geo.setAttribute('aSlice', new THREE.InstancedBufferAttribute(aSlice, 1));
    this.sliceU = {
      uAtlas: { value: this.atlas.texture }, uGrid: { value: new THREE.Vector2(...GRID) }, uNS: { value: NS },
      uOpacity: { value: 1 }, uSeg: { value: 0 }, uCut: { value: 0 }, uVis: { value: 0 },
      uSpread: { value: 1 }, uShear: { value: 0 }, uDepth: { value: DEPTH }, uCell: { value: 7 }, uTime: { value: 0 },
    };
    this.slices = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      uniforms: this.sliceU, vertexShader: SLICE_VERT, fragmentShader: SLICE_FRAG, side: THREE.DoubleSide,
    }), NSHOW);
    this.slices.frustumCulled = false;
    this.slices.visible = false;
    this.brainGroup.add(this.slices);

    // --- формы облака
    this.shapes = {
      brand: brainBrand(n, { eq: MAP_STACK.scale }),
      cutDim: brainSlices(n, { ns: NSHOW, spread: 1, shear: 0, alpha: 0.1, eq: MAP_STACK.scale }),
      slicesDim: brainSlices(n, { ns: NSHOW, spread: SPREAD, shear: SHEAR, alpha: 0.06, eq: MAP_STACK.scale }),
      slicesCol: brainSlices(n, { ns: NSHOW, spread: SPREAD, shear: SHEAR, alpha: 0.1, colored: true, eq: MAP_STACK.scale }),
      color: brainColored(n, { alpha: 1, eq: MAP_BRAIN.scale, target: 3.2 }),
      colorDim: brainColored(n, { alpha: 0.32, eq: TASTE_FLY.scale * BRAIN_W / 2 }),
    };

    // --- волна вкуса: точки на отростках, задержка — по удалённости от входа сигнала
    const base = brainBase(n);
    const W = 3000;
    const wp = new Float32Array(W * 3), wd = new Float32Array(W), ws = new Float32Array(W);
    let k = 0;
    const step = Math.max(1, Math.floor((n * 0.8) / W));
    for (let i = 0; i < n && k < W; i += step) {
      if (base.K[i] === 2) continue;
      const x = base.P[i * 3], y = base.P[i * 3 + 1], z = base.P[i * 3 + 2];
      wp[k * 3] = x; wp[k * 3 + 1] = y; wp[k * 3 + 2] = z;
      const d = Math.hypot(x - TASTE_IN[0], (y - TASTE_IN[1]) * 1.3, z - TASTE_IN[2]);
      wd[k] = d * 1.05 + Math.sin(i * 12.9898) * 0.06;
      ws[k] = 0.6 + (i % 7) * 0.08;
      k++;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp.subarray(0, k * 3), 3));
    wg.setAttribute('aDelay', new THREE.Float32BufferAttribute(wd.subarray(0, k), 1));
    wg.setAttribute('aSize', new THREE.Float32BufferAttribute(ws.subarray(0, k), 1));
    this.waveU = { uWave: { value: -1 }, uScale: { value: 600 }, uSize: { value: 0.036 }, uOpacity: { value: 1 }, uDone: { value: 0 } };
    this.wave = new THREE.Points(wg, new THREE.ShaderMaterial({
      uniforms: this.waveU, vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.wave.frustumCulled = false;
    this.wave.renderOrder = 15;
    this.wave.visible = false;
    this.brainGroup.add(this.wave);
    this.waveMax = 2.1;

    // нити-отростки нейронов (чёткая «проводка» поверх облака частиц)
    const list = neurons();
    let segs = 0;
    for (const nr of list) segs += nr.pts.length / 3 - 1;
    const lp = new Float32Array(segs * 6), lc = new Float32Array(segs * 6);
    let o = 0;
    for (const nr of list) {
      const q = nr.pts;
      for (let i = 0; i + 5 < q.length; i += 3, o++) {
        for (let c = 0; c < 6; c++) lp[o * 6 + c] = q[i + c];
        for (let c = 0; c < 3; c++) { lc[o * 6 + c] = nr.c[c]; lc[o * 6 + 3 + c] = nr.c[c]; }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('aCol', new THREE.Float32BufferAttribute(lc, 3));
    this.wiresU = { uOpacity: { value: 1 }, uAlpha: { value: 0 } };
    this.wires = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      uniforms: this.wiresU,
      vertexShader: 'attribute vec3 aCol; varying vec3 vC; void main() { vC = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform float uAlpha; varying vec3 vC; void main() { gl_FragColor = vec4(vC * 0.95, uOpacity * uAlpha); }',
      transparent: true, depthWrite: false,
    }));
    this.wires.frustumCulled = false;
    this.wires.visible = false;
    this.brainGroup.add(this.wires);

    // моторный нейрон и вход вкусового сигнала (в координатах мозга)
    this.motor = glowPoints([...MOTOR], [0.42], '#00ff00');
    this.brainGroup.add(this.motor);
    this.entry = glowPoints([...TASTE_IN], [0.3], '#00ff00');
    this.brainGroup.add(this.entry);

    // --- муха (голова + передняя лапка) для 'taste'
    const fly = new FlyModel({ seed: 5 });
    this.fly = fly;
    fly.p.solid = 0; fly.p.wire = 0; fly.p.trunk = 0; fly.p.legs = 0;
    fly.legVisible = [true, false, false, false, false, false];
    fly.legR = 0.75;
    this.root.add(fly.group);
    this.legOv = { foot: new THREE.Vector3(), dir: new THREE.Vector3(-0.4, -0.45, 0.8).normalize(), w: 1 };
    fly.legOverride[0] = this.legOv;

    // капля сахара (в координатах мухи) + брызги
    this.dropU = { uOpacity: { value: 1 }, uGlow: { value: 0 } };
    this.drop = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.ShaderMaterial({
      uniforms: this.dropU, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.drop.scale.set(0.12, 0.095, 0.12);
    this.drop.visible = false;
    fly.group.add(this.drop);
    this.splash = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: new THREE.Color('#9dff8a'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.splash.material.userData.noFade = true;
    fly.group.add(this.splash);
    this.sense = glowPoints([0, 0, 0], [0.5], '#00ff00');
    fly.group.add(this.sense);
    this.contact = glowPoints([0, 0, 0], [0.9], '#ffffff');
    fly.group.add(this.contact);

    // нервы: лапка → мозг (вкус), моторный нейрон → хоботок
    this.nerveIn = makeBeam([[0, 0, 0], [0, 1, 0], [0, 2, 0]], { radius: 0.035, dash: 7, speed: 1.4, color: '#b6ff9e' });
    this.nerveOut = makeBeam([[0, 0, 0], [0, 1, 0], [0, 2, 0]], { radius: 0.035, dash: 5, speed: 1.4, color: '#b6ff9e' });
    this.nerves = [this.nerveIn, this.nerveOut];         // массивы — заранее, чтобы не создавать их в каждом кадре
    this.glows = [this.motor, this.entry, this.sense, this.contact];
    for (const b of this.nerves) { b.uniforms.uReveal.value = 0; b.mesh.visible = false; this.root.add(b.mesh); }

    this.place = { k: 0 };   // 0 — раскладка 'map', 1 — внутри головы мухи
    this.mapPose = { pos: new THREE.Vector3(...MAP_STACK.pos), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...MAP_STACK.rot)), scale: MAP_STACK.scale };
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.placeFly();
  }

  makeAtlas() {
    const r = this.ctx.renderer;
    const W = GRID[0] * TILE[0], H = GRID[1] * TILE[1];
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 4,
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uGrid: { value: new THREE.Vector2(...GRID) }, uNS: { value: NS },
        uBox: { value: new THREE.Vector4(BOX.x0, BOX.x1, BOX.y0, BOX.y1) }, uZ: { value: new THREE.Vector2(BOX.z0, BOX.z1) },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: GEN_FRAG, depthTest: false, depthWrite: false,
    });
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(scene, cam);
    r.setRenderTarget(prev);
    quad.geometry.dispose();
    mat.dispose();
    return rt;
  }

  // ---------- Муха в 'taste' ----------
  placeFly() {
    const fly = this.fly, c = TASTE_FLY;
    const g = fly.group;
    g.rotation.set(...c.rot);
    g.scale.setScalar(c.scale);
    // голова (центр мозга) — в точку c.head
    const hc = new THREE.Vector3(0, 0.15, 0.97).multiplyScalar(c.scale).applyEuler(g.rotation);
    g.position.set(c.head[0] - hc.x, c.head[1] - hc.y, c.head[2] - hc.z);
    // капля — под кончиком вытянутого хоботка; передняя лапка касается её сзади
    fly.p.proboscis = 1; fly.update(0, 0); g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const tipL = fly.point('proboscis', new THREE.Vector3()).applyMatrix4(inv);
    const dp = tipL.clone().add(new THREE.Vector3(0.0, -0.105, 0.015));
    this.dropPos = dp;
    this.drop.position.copy(dp);
    this.splash.position.set(dp.x, dp.y - 0.085, dp.z);
    this.sense.position.set(dp.x + 0.06, dp.y - 0.02, dp.z - 0.07);
    this.legOv.foot.set(dp.x + 0.1, dp.y - 0.03, dp.z - 0.02);
    fly.p.proboscis = 0;
    fly.update(0, 0);
    g.updateMatrixWorld(true);
    // поза мозга внутри головы
    const bm = fly.brainMatrix(new THREE.Matrix4(), BRAIN_W);
    this.tastePose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
    const sc = new THREE.Vector3();
    bm.decompose(this.tastePose.pos, this.tastePose.quat, sc);
    this.tastePose.scale = sc.x;
    // нерв вкуса: капля → по лапке → к шее → в подглоточную зону мозга
    const L = fly.legPts[0];
    const W = (v) => v.clone().applyMatrix4(g.matrixWorld);
    const entryW = new THREE.Vector3(...TASTE_IN).applyMatrix4(bm);
    const motorW = new THREE.Vector3(...MOTOR).applyMatrix4(bm);
    const neck = new THREE.Vector3(0, -0.1, 0.78).applyMatrix4(g.matrixWorld);
    this.nerveIn.set([W(L[4]), W(L[3]), W(L[2]), W(L[1]), neck, entryW]);
    // моторный нерв: моторный нейрон → основание хоботка → кончик
    fly.p.proboscis = 1; fly.update(0, 0); g.updateMatrixWorld(true);
    const tip = fly.point('proboscis', new THREE.Vector3());
    const pbase = new THREE.Vector3(0, 0, 0).applyMatrix4(fly.prob.matrixWorld);
    fly.p.proboscis = 0; fly.update(0, 0);
    this.nerveOut.set([motorW, pbase.clone().lerp(motorW, 0.35), pbase, tip]);
    this.contact.position.copy(new THREE.Vector3().copy(tip).applyMatrix4(new THREE.Matrix4().copy(g.matrixWorld).invert()));
    this.tipW = tip.clone();
    this.motorW = motorW;
  }

  // ---------- Камера и фон ----------
  camera(state, step) {
    if (state === 'taste') return { pos: [0.7, 0.9, 15.2], target: [0.7, -0.3, 0], fov: 45 };
    if (step >= 2) return { pos: [0, 0.3, 14], target: [0, 0.2, 0], fov: 45 };
    return { pos: [0.4, 0.8, 14.2], target: [0.3, 0.1, 0], fov: 45 };
  }

  background(state, step) {
    if (state === 'taste') return 'soft';
    // многоцветный мозг — на тёмном: фирменное свечение уходит в углы и не «зеленит» карту
    return step >= 2 ? { glows: [[0.98, -0.66, 0.55, 0.8], [-0.98, 0.62, 0.4, 0.35]], band: null }
      : { glows: [[0.8, -0.5, 0.55, 0.45], [-0.95, 0.55, 0.35, 0.3]], band: null };
  }

  // ---------- Последовательности, которые можно прервать новым шагом ----------
  seqKill() { this._seq.forEach((t) => t.kill()); this._seq.clear(); }
  sq(t) { this._seq.add(t); return t; }
  sTw(target, vars) { return this.sq(this.tw(target, vars)); }
  sDelay(sec, fn) { return this.sq(this.delay(sec, fn)); }

  enter(o = {}) {
    this.state = o.state || 'map';
    this.step = o.step ?? 0;
    this.claimParticles();
    const ob = this.particles.object;
    // рамка частиц стартует из текущего положения облака (плавно, без скачка)
    this.cur = { pos: ob.position.clone(), quat: ob.quaternion.clone(), scale: ob.scale.x };
    this.apply(this.state, this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.step = o.step ?? 0;
    this.claimParticles();
    this.apply(state, this.step, o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(this.state, step, o);
  }

  apply(state, step, o = {}) {
    const inst = !!o.instant, entering = !!o.entering;
    const D = (x) => (inst ? 0 : x);
    const p = this.particles, u = this.sliceU, fly = this.fly, P = fly.p;
    const prev = o.prevStep ?? (entering ? -1 : step);
    const stateChanged = entering || this._appliedState !== state;
    this._appliedState = state;
    // Все анимации шага живут в «последовательности»: новый шаг (в любую сторону и с любой скоростью кликов)
    // отменяет её целиком, а затем заново задаёт цели ВСЕМ свойствам — ничего не «воскресает» и не залипает.
    this.seqKill();

    this.sTw(this.wiresU.uAlpha, {
      value: state === 'taste' ? 0.22 : step >= 2 ? 0.7 : 0,
      duration: D(state === 'map' && step >= 2 ? 1.4 : 0.6), delay: D(state === 'map' && step >= 2 && prev < 2 ? 1.7 : 0),
    });
    if (state === 'map') {
      this.shapeKey = null;
      this.sTw(this.place, { k: 0, duration: D(1.6), ease: 'power2.inOut' });
      this.sTw(P, { solid: 0, wire: 0, headXray: 0, xray: 0, legWire: 0, duration: D(0.6) });
      this.sTw(P, { proboscis: 0, duration: D(0.6) });
      this.wave.visible = false;
      this.hideTaste(inst);
      const target = step >= 2 ? MAP_BRAIN : MAP_STACK;
      this.tweenMapPose(target, D(entering ? 0 : 1.8));
      this.slices.visible = true;
      if (step <= 1) {
        const fresh = entering && step === 0 && !inst;
        if (fresh) {
          // 1) облако-мозг; 2) «нарезка» — срезы появляются один за другим; 3) стопка раздвигается
          p.morph(this.shapes.brand, { duration: 1.6, stagger: 0.5, burst: 8 });
          p.setParams({ noise: 0.05, swirl: 0, size: 0.05, twinkle: 0.3, spring: 20, damping: 6.5 }, 1);
          u.uCut.value = 0; u.uSpread.value = 1; u.uShear.value = 0; u.uVis.value = 1; u.uSeg.value = 0;
          this.sTw(u.uCut, { value: 1, duration: 1.2, delay: 1.0, ease: 'power1.inOut' });
          this.sDelay(1.1, () => p.morph(this.shapes.cutDim, { duration: 1.1, stagger: 0.7, burst: 0 }));
          this.sTw(u.uSpread, { value: SPREAD, duration: 2.0, delay: 2.2, ease: 'power3.inOut' });
          this.sTw(u.uShear, { value: SHEAR, duration: 2.0, delay: 2.2, ease: 'power3.inOut' });
          this.sDelay(2.2, () => p.morph(this.shapes.slicesDim, { duration: 2.0, stagger: 0.1, burst: 0, ease: 'power3.inOut' }));
        } else {
          this.sTw(u.uCut, { value: 1, duration: D(0.8) });
          this.sTw(u.uSpread, { value: SPREAD, duration: D(1.2), ease: 'power2.inOut' });
          this.sTw(u.uShear, { value: SHEAR, duration: D(1.2), ease: 'power2.inOut' });
          this.sTw(u.uVis, { value: 1, duration: D(1.3), delay: D(prev >= 2 ? 0.5 : 0) });
          const key = step >= 1 ? 'slicesCol' : 'slicesDim';
          p.morph(this.shapes[key], { duration: D(prev >= 2 ? 1.8 : 1.2), stagger: 0.35, burst: prev >= 2 ? 3 : 0 });
          p.setParams({ noise: 0.03, swirl: 0, size: 0.05, twinkle: 0.2, spring: 22, damping: 7 }, D(1));
          if (step >= 1) {
            if (prev === 0 && !inst) { u.uSeg.value = 0; this.sTw(u.uSeg, { value: 1, duration: 3.0, ease: 'none' }); }
            else u.uSeg.value = 1;
          } else {
            this.sTw(u.uSeg, { value: 0, duration: D(1.0) });
          }
        }
        if (step === 1 && prev === 0 && !inst) this.ctx.engine.pulse({ aberration: 0.5 }, 1.2);
      } else {
        // шаг 2: срезы растворяются, частицы собираются в цветной 3D-мозг
        u.uCut.value = 1; u.uSpread.value = Math.max(u.uSpread.value, 1); u.uSeg.value = 1;
        if (entering) { u.uVis.value = 0; u.uSpread.value = SPREAD; u.uShear.value = SHEAR; }
        this.sTw(u.uVis, { value: 0, duration: D(1.5), ease: 'power1.in' });
        p.morph(this.shapes.color, { duration: D(2.6), stagger: 0.6, burst: entering ? 10 : 6 });
        p.setParams({ noise: 0.05, swirl: 0, size: 0.048, twinkle: 0.35, spring: 16, damping: 5.5 }, D(1.2));
        if (!inst && prev === 1) this.ctx.engine.pulse({ aberration: 0.8, flash: 0.08 }, 1.4);
      }
    } else {
      // ---------- 'taste' ----------
      this.sTw(this.place, { k: 1, duration: D(entering ? 0 : 1.8), ease: 'power2.inOut' });
      this.sTw(u.uVis, { value: 0, duration: D(0.8) });
      this.sTw(P, { solid: 1, wire: 0, xray: 1, headXray: 1, trunk: 0, legs: 1, legWire: 0.18, duration: D(1.2), delay: D(stateChanged && !entering ? 0.6 : 0) });
      if (this.shapeKey !== 'colorDim') {
        p.morph(this.shapes.colorDim, { duration: D(entering ? 2.2 : 1.4), stagger: 0.4, burst: entering ? 8 : 0 });
        this.shapeKey = 'colorDim';
      }
      p.setParams({ noise: 0.03, swirl: 0, size: 0.05, twinkle: 0.25, spring: 20, damping: 6.5 }, D(1));
      this.wave.visible = true;
      this.showTaste(step, prev, inst, entering);
    }
    // подписи — вслед за событиями: капля долетает (~2.2 с), сигнал трогается (~0.5 с), хоботок вытягивается (~1.2 с)
    const lag = { sugar: this._dropFell ? 2.2 : 0, taste: !inst && step >= 1 && prev === 0 ? 0.5 : 0, prob: !inst && step >= 2 && prev === 1 ? 1.2 : 0 };
    this._dropFell = false;
    this.updateLabels(state, step, lag);
  }

  tweenMapPose(t, dur) {
    const mp = this.mapPose;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rot));
    if (dur <= 0) { mp.pos.set(...t.pos); mp.quat.copy(q); mp.scale = t.scale; return; }
    const st = { k: 0 }, p0 = mp.pos.clone(), q0 = mp.quat.clone(), s0 = mp.scale;
    const p1 = new THREE.Vector3(...t.pos);
    this.sTw(st, {
      k: 1, duration: dur, ease: 'power2.inOut',
      onUpdate: () => { mp.pos.lerpVectors(p0, p1, st.k); mp.quat.slerpQuaternions(q0, q, st.k); mp.scale = s0 + (t.scale - s0) * st.k; },
    });
  }

  hideTaste(inst) {
    const D = (x) => (inst ? 0 : x);
    this.sTw(this.dropU.uOpacity, { value: 0, duration: D(0.4) });
    this.sTw(this.dropU.uGlow, { value: 0, duration: D(0.4) });
    for (const b of [this.nerveIn, this.nerveOut]) this.sTw(b.uniforms.uReveal, { value: 0, duration: D(0.4) });
    for (const g of [this.motor, this.entry, this.sense, this.contact]) this.sTw(g.material.uniforms.uK, { value: 0, duration: D(0.4) });
    this.sTw(this.splash.material, { opacity: 0, duration: D(0.3) });
    this.waveU.uWave.value = -1;
    this.dropShown = false;
  }

  showTaste(step, prev, inst, entering) {
    const D = (x) => (inst ? 0 : x);
    const P = this.fly.p, w = this.waveU;
    const drop = this.drop, dU = this.dropU;
    drop.visible = true;
    this.nerveIn.mesh.visible = this.nerveOut.mesh.visible = true;
    const sK = this.sense.material.uniforms.uK, eK = this.entry.material.uniforms.uK;
    const mK = this.motor.material.uniforms.uK, cK = this.contact.material.uniforms.uK;
    // капля: падает при первом показе шага 0
    const dropIn = step === 0 && !this.dropShown && !inst;
    this.dropShown = true;
    this._dropFell = dropIn;
    if (dropIn) {
      const dp = this.dropPos;
      drop.position.set(dp.x, dp.y + 1.6, dp.z);
      drop.scale.set(0.12, 0.095, 0.12);
      dU.uOpacity.value = 0;
      this.sTw(dU.uOpacity, { value: 1, duration: 0.4, delay: 1.4 });
      this.sTw(drop.position, { y: dp.y, duration: 0.75, delay: 1.4, ease: 'power2.in' });
      this.sDelay(2.15, () => {
        this.sq(this.fromTo(drop.scale, { x: 0.15, y: 0.068, z: 0.15 }, { x: 0.12, y: 0.095, z: 0.12, duration: 0.7, ease: 'elastic.out(1, 0.4)' }));
        // всплеск: тонкое кольцо по «полу» вокруг капли — расходится и гаснет
        this.sq(this.fromTo(this.splash.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 0.3, y: 0.3, z: 0.3, duration: 0.8, ease: 'power2.out' }));
        this.sq(this.fromTo(this.splash.material, { opacity: 0.75 }, { opacity: 0, duration: 0.8, ease: 'power1.in' }));
        this.sq(this.fromTo(sK, { value: 1.6 }, { value: 0.5, duration: 1.0 }));
      });
    } else {
      drop.position.copy(this.dropPos);
      drop.scale.set(0.12, 0.095, 0.12);
      this.sTw(this.splash.material, { opacity: 0, duration: D(0.3) });
      this.sTw(dU.uOpacity, { value: 1, duration: D(0.6) });
      this.sTw(sK, { value: step >= 1 ? 0.8 : 0.5, duration: D(0.5) });
    }
    // шаг 1: сигнал по нерву → волна по мозгу → моторный нейрон
    if (step >= 1) {
      if (prev === 0 && !inst) {
        w.uWave.value = -1; w.uDone.value = 1;
        this.nerveIn.uniforms.uReveal.value = 0;
        mK.value = 0; eK.value = 0;
        this.sq(this.fromTo(sK, { value: 2.0 }, { value: 0.8, duration: 1.0 }));
        this.sTw(this.nerveIn.uniforms.uReveal, { value: 1, duration: 1.0, ease: 'power1.in' });
        this.sDelay(0.9, () => this.sq(this.fromTo(eK, { value: 1.8 }, { value: 0.6, duration: 0.8 })));
        this.sTw(w.uWave, { value: this.waveMax, duration: 2.0, delay: 0.95, ease: 'none' });
        this.sDelay(2.75, () => {
          this.sq(this.fromTo(mK, { value: 3.2 }, { value: 1.25, duration: 1.0, ease: 'power2.out' }));
          this.ctx.engine.pulse({ flash: 0.06 }, 0.5);
          this.lbl?.motor.show();
        });
      } else {
        w.uWave.value = this.waveMax; w.uDone.value = 1;
        this.sTw(this.nerveIn.uniforms.uReveal, { value: 1, duration: D(0.6) });
        this.sTw(mK, { value: 1.25, duration: D(0.6) });
        this.sTw(eK, { value: 0.6, duration: D(0.6) });
      }
    } else {
      w.uWave.value = -1;
      this.sTw(this.nerveIn.uniforms.uReveal, { value: 0, duration: D(0.5) });
      this.sTw(mK, { value: 0, duration: D(0.5) });
      this.sTw(eK, { value: 0, duration: D(0.5) });
    }
    // шаг 2: моторный нерв → хоботок вытягивается к капле
    if (step >= 2) {
      if (prev === 1 && !inst) {
        this.nerveOut.uniforms.uReveal.value = 0;
        this.sTw(this.nerveOut.uniforms.uReveal, { value: 1, duration: 0.6, ease: 'power1.in' });
        this.sTw(P, { proboscis: 1, duration: 1.1, delay: 0.5, ease: 'back.out(1.6)' });
        this.sDelay(1.45, () => {
          this.sq(this.fromTo(cK, { value: 2.4 }, { value: 0, duration: 1.2, ease: 'power2.out' }));
          this.sq(this.fromTo(dU.uGlow, { value: 1.4 }, { value: 0.3, duration: 1.2 }));
          this.ctx.rig.shake(0.05, 0.4);
        });
      } else {
        this.sTw(this.nerveOut.uniforms.uReveal, { value: 1, duration: D(0.6) });
        this.sTw(P, { proboscis: 1, duration: D(0.9), ease: 'power2.out' });
        this.sTw(dU.uGlow, { value: 0.3, duration: D(0.4) });
        this.sTw(cK, { value: 0, duration: D(0.3) });
      }
    } else {
      this.sTw(this.nerveOut.uniforms.uReveal, { value: 0, duration: D(0.5) });
      this.sTw(P, { proboscis: 0, duration: D(0.8), ease: 'power2.inOut' });
      this.sTw(dU.uGlow, { value: 0, duration: D(0.5) });
      this.sTw(cK, { value: 0, duration: D(0.3) });
    }
  }

  updateLabels(state, step, lag = {}) {
    if (!this.lbl) {
      this.lbl = {
        sugar: this.label({ html: '<span class="b3-tag">сахар</span>', object: this.drop, offset: [-1.7, -0.1, 0], anchor: 'right', visible: false }),
        taste: this.label({ html: '<span class="b3-tag is-dim">вкусовые нейроны</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
        motor: this.label({ html: '<span class="b3-tag is-hot">моторный нейрон</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
        prob: this.label({ html: '<span class="b3-tag">хоботок</span>', position: [0, 0, 0], anchor: 'right', visible: false }),
      };
    }
    const L = this.lbl;
    const t = state === 'taste';
    // показ с задержкой живёт в «последовательности» шага (seqKill отменяет его при следующем клике)
    const on = (l, v, sec = 0) => {
      if (!v) { l.hide(); return; }
      if (sec > 0 && !l.visible) this.sDelay(sec, () => l.show());
      else l.show();
    };
    on(L.sugar, t, lag.sugar);
    on(L.taste, t && step >= 1, lag.taste);
    if (!(t && step >= 1)) L.motor.hide(); else if (step >= 2 || this.waveU.uWave.value >= this.waveMax) L.motor.show();
    on(L.prob, t && step >= 2, lag.prob);
  }

  exit(o = {}) {
    this.removeLabels();
    this.lbl = null;
    this.seqKill();
    this.dropShown = false;
    return super.exit(o);
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const eng = this.ctx.engine;
    const pxScale = (eng.height * eng.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5));
    this.sliceU.uCell.value = cellPx(eng);
    this.sliceU.uTime.value = t;
    this.waveU.uScale.value = pxScale;
    for (const g of this.glows) {
      g.material.uniforms.uScale.value = pxScale;
      g.material.uniforms.uTime.value = t;
    }
    this.slices.visible = this.sliceU.uVis.value > 0.002 && this.state === 'map' || (this.state === 'map' && this.step < 2);
    for (const b of this.nerves) {
      b.uniforms.uTime.value = t;
      b.mesh.visible = b.uniforms.uReveal.value > 0.002;
    }
    this.drop.visible = this.dropU.uOpacity.value > 0.002;
    this.wires.visible = this.wiresU.uAlpha.value > 0.002;
    this.fly.group.visible = this.place.k > 0.01;
    this.fly.setCell(cellPx(eng));
    this.fly.update(dt, t);

    // поза мозга: 'map' ⇄ внутри головы мухи
    const mp = this.mapPose, tp = this.tastePose, k = this.place.k;
    const sway = this.state === 'map' && this.step >= 2 ? Math.sin(t * 0.25) * 0.55 : this.state === 'map' ? Math.sin(t * 0.2) * 0.05 : 0;
    const qs = this._q.setFromEuler(this._e.set(0, sway, 0));
    const pos = this._p.lerpVectors(mp.pos, tp.pos, k);
    const quat = this._tq || (this._tq = new THREE.Quaternion());
    quat.copy(mp.quat).multiply(qs).slerp(tp.quat, k);
    const scale = mp.scale + (tp.scale - mp.scale) * k;
    const bg = this.brainGroup;
    bg.position.copy(pos);
    bg.quaternion.copy(quat);
    bg.scale.setScalar(scale);
    if (this.ownsParticles()) {
      const c = this.cur;
      const a = 1 - Math.exp(-dt * 3.5);
      c.pos.lerp(pos, a);
      c.quat.slerp(quat, a);
      c.scale += (scale - c.scale) * a;
      const ob = this.particles.object;
      ob.position.copy(c.pos);
      ob.quaternion.copy(c.quat);
      ob.scale.setScalar(c.scale);
    }
    // подписи, привязанные к мозгу
    if (this.lbl && this.state === 'taste') {
      bg.updateMatrixWorld(true);
      const m = this._p.set(...MOTOR).applyMatrix4(bg.matrixWorld);
      lp(this.lbl.motor, m.x + 1.5, m.y - 0.75, m.z);
      const e = this.nerveIn.curve ? this.nerveIn.curve.getPoint(0.04, this._s) : this._s.set(0, 0, 0);
      lp(this.lbl.taste, e.x + 0.9, e.y - 0.15, e.z);
      const tip = this.fly.point('proboscis', this._s);
      lp(this.lbl.prob, tip.x - 1.6, tip.y + 1.0, tip.z);
    }
  }

  dispose() {
    this.atlas?.dispose();
    this.fly?.dispose();
    super.dispose();
  }
}
