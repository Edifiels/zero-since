// «Песочница»: стеклянный куб с компьютером внутри, забор с табличкой «Нет интернета», цепочка замков.
// Шаги: 0 — песочница (ИИ спит в компьютере);
//       1 — ИИ-шарик выходит из монитора и ощупывает стенки (касания — круги-волны на стекле);
//       2 — находит трещину: трещины расползаются по стенке, свет пробивается наружу;
//       3 — просачивается сквозь трещину и проходит цепочку замков — дужки откидываются одна за другой;
//       4 — шарик снаружи: «интернет» (сеть узлов вокруг) загорается волной.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU, fontsReady } from '../../core/utils.js';

const HALF = 1.8;                                  // полуразмер куба
const CUBE_C = new THREE.Vector3(0, HALF, 0);      // центр куба
const FENCE = 3.15;                                // полуразмер забора
const BALL_R = 0.2;
const CRACK = new THREE.Vector3(HALF, 2.35, 0.55); // точка трещины на правой (+X) стенке (мир)
const CRACK_UV = [CRACK.z / (2 * HALF) + 0.5, (CRACK.y - HALF) / (2 * HALF) + 0.5];
const LOCKS = [[2.5, 2.35, 0.72], [3.3, 2.22, 0.95], [4.1, 2.06, 1.18]];
const EXIT_END = new THREE.Vector3(5.0, 1.95, 1.42);
const NET_NODE = new THREE.Vector3(6.6, 3.0, 1.3); // узел сети, к которому уходит шарик
const SCREEN = new THREE.Vector3(-0.15, 0.92, -0.16);
const SCREEN_IN = new THREE.Vector3(-0.15, 0.92, -0.1); // огонёк ИИ «внутри» монитора (шаг 0)
const HOVER_CRACK = new THREE.Vector3(0.65, 2.68, 1.1);   // где шарик ждёт после трещины (шаг 2): не заслоняет её
const AI_UP = 0.62, AI_DOWN = -0.62;                    // подпись «ИИ» над шариком / под ним (шаг 3 — чтобы не закрывать замки)
const MAX_RIP = 6;
const BEAM_ON = 0.5;      // луч из трещины (шаг 2)
const BEAM_OUT = 0.38;    // луч, когда шарик уже снаружи (шаги 3–4)
const FLARE_ON = 0.18;    // блик в точке удара

const VERT_UV = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GLASS_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNl;
varying vec3 vN;
varying vec3 vV;
void main() {
  vLocal = position;
  vNl = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const GLASS_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uHalf, uCrack, uFlash;
uniform vec4 uRip[${MAX_RIP}];
uniform sampler2D tCrack;
uniform vec2 uCrackUv;
varying vec3 vLocal;
varying vec3 vNl;
varying vec3 vN;
varying vec3 vV;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fres = (1.0 - ndv) * (1.0 - ndv);
  vec3 a = abs(vLocal) / uHalf;
  float e = max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z));
  float edge = smoothstep(0.955, 0.995, e);
  float rim = smoothstep(0.86, 0.995, e) * 0.25;
  // круги-волны от касаний
  float rip = 0.0;
  for (int i = 0; i < ${MAX_RIP}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.w;
    if (age < 0.0 || age > 2.2) continue;
    float d = distance(vLocal, r.xyz);
    float k = 1.0 - age / 2.2;
    float x1 = (d - age * 1.6) / 0.09;
    float x2 = (d - age * 1.05) / 0.06;
    rip += (exp(-x1 * x1) + 0.5 * exp(-x2 * x2)) * k * k;
    rip += exp(-d * d * 40.0) * k * k * k * 1.5;
  }
  // трещины — только на правой стенке
  float crack = 0.0, burst = 0.0;
  if (vNl.x > 0.5) {
    vec2 uv = vec2(vLocal.z, vLocal.y) / (2.0 * uHalf) + 0.5;
    float dist = length(uv - uCrackUv);
    float grow = smoothstep(dist - 0.02, dist + 0.02, uCrack * 0.62);
    crack = texture2D(tCrack, uv).r * grow;
    burst = exp(-dist * dist * 160.0) * smoothstep(0.0, 0.25, uCrack);
  }
  vec3 tint = vec3(0.55, 1.0, 0.62);
  // трещина светится (bloom), но не выгорает в белое пятно вместе с шариком и лучом
  vec3 col = tint * (0.04 + fres * 0.22 + rim * 0.5)
           + vec3(0.85, 1.0, 0.9) * edge * 0.95
           + vec3(0.35, 1.0, 0.45) * rip * 2.4
           + vec3(0.92, 1.0, 0.9) * crack * 1.45
           + vec3(0.55, 1.0, 0.6) * burst * 0.55
           + tint * uFlash * 0.3;
  float alpha = clamp(0.035 + fres * 0.18 + rim * 0.3 + edge * 0.8 + rip * 0.9 + crack + burst, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * a * uPower;
  gl_FragColor = vec4(uColor * a, a) * uOpacity;
}
`;
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFace = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower, uTime;
varying vec2 vUv;
varying float vFace;
void main() {
  float along = 1.0 - vUv.y;                   // 0 — у трещины, 1 — дальний конец
  float rays = 0.6 + 0.4 * sin(vUv.x * 62.83 + uTime * 1.3) * sin(vUv.x * 25.13 - uTime * 0.7);
  float a = (1.0 - along) * (1.0 - along) * vFace * rays * uPower * 0.8;
  gl_FragColor = vec4(uColor * a, a) * uOpacity;
}
`;
const TRAIL_VERT = /* glsl */ `
attribute float aAge;
uniform float uSize, uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = 1.0 - aAge;
  gl_PointSize = max(1.0, uSize * uScale * (0.2 + 0.8 * k) / max(0.1, -mv.z));
  vA = k * k;
}
`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 4.0) * vA * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;
const CABLE_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uProg;
varying vec2 vUv;
void main() {
  float dash = step(0.45, fract(vUv.x * 26.0 - uTime * 0.8));
  float lit = 1.0 - smoothstep(uProg - 0.04, uProg, vUv.x);   // edge0 < edge1 (иначе по стандарту GLSL результат не определён)
  vec3 col = mix(vec3(0.45), vec3(1.0, 0.045, 0.03) * 1.5, lit);
  float a = (0.35 + 0.65 * lit) * mix(dash, 1.0, lit) * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;
const NET_VERT = /* glsl */ `
attribute float aT;
attribute float aDist;
attribute float aSeed;
uniform float uWave, uTime;
varying float vOn;
varying float vPulse;
void main() {
  vOn = 1.0 - smoothstep(uWave - 1.5, uWave, aDist);
  float p = fract(aT * 1.0 - uTime * 0.45 + aSeed);
  vPulse = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const NET_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vOn;
varying float vPulse;
void main() {
  float pulse = smoothstep(0.88, 1.0, vPulse) * 2.5;
  vec3 col = vec3(0.06, 1.0, 0.08) * (0.35 + pulse);
  float a = vOn * (0.45 + pulse * 0.5) * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;
const NODE_VERT = /* glsl */ `
attribute float aDist;
attribute float aSize;
uniform float uWave, uScale, uTime;
varying float vOn;
void main() {
  vOn = 1.0 - smoothstep(uWave - 1.2, uWave, aDist);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flash = 1.0 + 0.6 * exp(-pow(abs(uWave - aDist - 0.3) * 2.0, 2.0));
  gl_PointSize = aSize * uScale * flash * (0.9 + 0.1 * sin(uTime * 3.0 + aDist)) / max(0.1, -mv.z);
}
`;
const NODE_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vOn;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d * 3.5) * 0.45;
  vec3 col = mix(vec3(0.1, 1.0, 0.12), vec3(1.0), core) * (core * 1.6 + halo);
  float a = (core + halo) * vOn * uOpacity;
  gl_FragColor = vec4(col * a, a);
}
`;

/** Холст с узором трещин (белые ломаные на чёрном), из точки (u0, v0). */
function crackCanvas(u0, v0, seed = 5) {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const r = rng(seed);
  const ox = u0 * N, oy = (1 - v0) * N;
  const branch = (x, y, ang, len, w, depth) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    let px = x, py = y;
    const segs = 6 + Math.floor(r() * 5);
    for (let i = 0; i < segs; i++) {
      ang += r.gauss(0, 0.35);
      const l = (len / segs) * r.range(0.6, 1.4);
      px += Math.cos(ang) * l; py += Math.sin(ang) * l;
      g.lineTo(px, py);
      if (depth > 0 && r() < 0.33) {
        g.stroke();
        branch(px, py, ang + r.sign() * r.range(0.4, 1.1), len * r.range(0.35, 0.6), Math.max(1.2, w * 0.6), depth - 1);
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(px, py);
      }
    }
    g.stroke();
  };
  const arms = 9;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * TAU + r.range(-0.25, 0.25);
    branch(ox, oy, a, N * r.range(0.22, 0.42), r.range(3.2, 5.2), 2);
  }
  // концентрические «сколы» вокруг удара
  g.lineWidth = 2.2;
  for (let k = 1; k <= 3; k++) {
    const rad = k * N * 0.035;
    for (let s = 0; s < 7; s++) {
      const a0 = r() * TAU;
      g.beginPath();
      g.arc(ox, oy, rad * r.range(0.85, 1.15), a0, a0 + r.range(0.3, 0.8));
      g.stroke();
    }
  }
  // центр удара
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(ox, oy, N * 0.012, 0, TAU);
  g.fill();
  return c;
}

function screenCanvas() {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#020802';
  g.fillRect(0, 0, W, H);
  const r = rng(12);
  for (let i = 0; i < 24; i++) {
    const y = 14 + i * 21;
    let x = 18 + (r() < 0.4 ? 26 : 0) + (r() < 0.2 ? 26 : 0);
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const w = 20 + r() * 110;
      g.fillStyle = r() < 0.22 ? '#ffffff' : r() < 0.5 ? '#00ff00' : '#00a800';
      g.fillRect(x, y, w, 9);
      x += w + 12;
      if (x > W - 40) break;
    }
  }
  return c;
}

function signTexture() {
  const W = 1280, H = 300;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const R = 46;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.fillStyle = '#050805';
  rr(6, 6, W - 12, H - 12, R);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#00e000';
  rr(12, 12, W - 24, H - 24, R - 6);
  g.stroke();
  // иконка: перечёркнутый Wi-Fi
  const cx = 170, cy = 196;
  g.strokeStyle = '#00e000';
  g.lineCap = 'round';
  [[46, 14], [86, 14], [126, 14]].forEach(([rad, w]) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(cx, cy, rad, -Math.PI * 0.75, -Math.PI * 0.25);
    g.stroke();
  });
  g.fillStyle = '#00e000';
  g.beginPath(); g.arc(cx, cy, 12, 0, TAU); g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 16;
  g.beginPath(); g.moveTo(cx - 105, cy - 120); g.lineTo(cx + 105, cy + 30); g.stroke();
  // надпись
  g.fillStyle = '#ffffff';
  g.font = '800 104px Unbounded';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText('НЕТ', 330, 98);
  g.fillText('ИНТЕРНЕТА', 330, 210);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, aspect: W / H };
}

export default class Sandbox extends Visual {
  static transition = 'zoom';

  async init() {
    await fontsReady();   // табличка «Нет интернета» рисуется шрифтом Unbounded на canvas
    this.world = new THREE.Group();
    this.root.add(this.world);
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3();
    this.buildCube();
    this.buildComputer();
    this.buildFence();
    this.buildBall();
    this.buildLocks();
    this.buildBeam();
    this.buildNetwork();
    this.shapes = {};
    this.ripIdx = 0;
    this.mode = 'hidden';
    this.probeIdx = 0;
    this.probe = null;
    this.hover = new THREE.Vector3().copy(SCREEN);
    this.ballVis = 0;
    this.aiOff = AI_UP;        // смещение подписи «ИИ» по вертикали (в координатах шарика)
    // формы частиц — заранее (чтобы шаги шли без рывков)
    this.shape('floor');
    this.shape('net');
  }

  // ---------- Построение ----------

  buildCube() {
    this.glassU = {
      uOpacity: { value: 1 }, uTime: { value: 0 }, uHalf: { value: HALF }, uCrack: { value: 0 }, uFlash: { value: 0 },
      uRip: { value: Array.from({ length: MAX_RIP }, () => new THREE.Vector4(0, 0, 0, -100)) },
      tCrack: { value: null }, uCrackUv: { value: new THREE.Vector2(CRACK_UV[0], CRACK_UV[1]) },
    };
    const tex = new THREE.CanvasTexture(crackCanvas(CRACK_UV[0], CRACK_UV[1]));
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    this.glassU.tCrack.value = tex;
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2), new THREE.ShaderMaterial({
      uniforms: this.glassU, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.cube.position.copy(CUBE_C);
    this.cube.renderOrder = 5;
    this.world.add(this.cube);
    // подиум под кубом
    const pad = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.5, 0.12, HALF * 2 + 0.5), new THREE.MeshStandardMaterial({ color: 0x0b120b, roughness: 0.6, metalness: 0.4 }));
    pad.position.y = -0.06;
    this.world.add(pad);
    const padEdge = new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.2), transparent: true }));
    padEdge.position.copy(pad.position);
    this.world.add(padEdge);
  }

  buildComputer() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x151a15, roughness: 0.45, metalness: 0.55 });
    const light = new THREE.MeshStandardMaterial({ color: 0xc9d1c9, roughness: 0.5, metalness: 0.2 });
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.5), side: THREE.DoubleSide });
    const pc = new THREE.Group();
    // монитор
    const frame = new THREE.Mesh(new RoundedBoxGeometry(1.6, 1.0, 0.08, 2, 0.03), dark);
    frame.position.set(-0.15, 0.92, -0.22);
    const scr = screenCanvas();
    this.screenTex = new THREE.CanvasTexture(scr);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.wrapT = THREE.RepeatWrapping;
    this.screenTex.repeat.set(1, 0.55);
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.15, 1.15, 1.15), side: THREE.DoubleSide });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 0.88), this.screenMat);
    screen.position.set(-0.15, 0.92, -0.175);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.08), dark);
    neck.position.set(-0.15, 0.24, -0.28);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 0.34), dark);
    base.position.set(-0.15, 0.02, -0.26);
    pc.add(frame, screen, neck, base);
    // клавиатура
    const kb = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.06, 0.46, 2, 0.02), dark);
    kb.position.set(-0.15, 0.03, 0.55);
    pc.add(kb);
    const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.03, 0.075), light, 13 * 4);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 13; col++, i++) {
        m4.makeTranslation(-0.15 - 0.585 + col * 0.0975, 0.075, 0.55 - 0.15 + row * 0.1);
        keys.setMatrixAt(i, m4);
      }
    }
    pc.add(keys);
    const space = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.07), green);
    space.position.set(-0.15, 0.078, 0.82);
    pc.add(space);
    // системный блок
    const tower = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.98, 0.9, 2, 0.03), dark);
    tower.position.set(1.05, 0.49, -0.25);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, 0.03), green);
    led.position.set(0.82, 0.55, 0.2);
    const btn = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), green);
    btn.position.set(1.05, 0.86, 0.205);
    pc.add(tower, led, btn);
    this.world.add(pc);
  }

  buildFence() {
    const postMat = new THREE.MeshStandardMaterial({ color: 0xaab4aa, roughness: 0.4, metalness: 0.6 });
    const per = 6;
    const posts = [];
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < per; k++) {
        const t = -FENCE + (k / per) * FENCE * 2;
        const p = s === 0 ? [t, FENCE] : s === 1 ? [FENCE, -t] : s === 2 ? [-t, -FENCE] : [-FENCE, t];
        posts.push(p);
      }
    }
    const H = 1.15;
    const postGeo = new THREE.CylinderGeometry(0.04, 0.05, H, 8);
    const inst = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, H / 2, z); inst.setMatrixAt(i, m4); });
    this.world.add(inst);
    // провода: три ряда по периметру
    const pts = [];
    const corners = [[-FENCE, FENCE], [FENCE, FENCE], [FENCE, -FENCE], [-FENCE, -FENCE]];
    [0.35, 0.7, 1.05].forEach((y) => {
      for (let c = 0; c < 4; c++) {
        const a = corners[c], b = corners[(c + 1) % 4];
        pts.push(a[0], y, a[1], b[0], y, b[1]);
      }
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wireMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(0.9), transparent: true, opacity: 0.85 });
    this.world.add(new THREE.LineSegments(wg, this.wireMat));
    // табличка «Нет интернета» на передней стороне забора
    const { tex, aspect } = signTexture();
    const h = 0.86;
    this.signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(0.85, 0.85, 0.85), side: THREE.DoubleSide });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), this.signMat);
    this.sign.position.set(-0.85, 0.82, FENCE + 0.06);
    this.world.add(this.sign);
  }

  buildBall() {
    this.ball = new THREE.Group();
    this.ballCore = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9ffe6').multiplyScalar(1.5), side: THREE.DoubleSide }));
    this.ballGlowU = { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.5) }, uOpacity: { value: 1 }, uPower: { value: 1.1 } };
    this.ballGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), new THREE.ShaderMaterial({ uniforms: this.ballGlowU, vertexShader: VERT_UV, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ballGlow.renderOrder = 6;
    this.ball.add(this.ballCore, this.ballGlow);
    this.ball.scale.setScalar(0.001);
    this.ball.position.copy(SCREEN);
    this.world.add(this.ball);
    // шлейф
    const N = this.trailN = 40;
    this.trailPos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this.trailPos.set([SCREEN.x, SCREEN.y, SCREEN.z], i * 3);
    const age = new Float32Array(N);
    for (let i = 0; i < N; i++) age[i] = i / (N - 1);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.trailU = { uColor: { value: new THREE.Color('#b8ffb0').multiplyScalar(1.3) }, uOpacity: { value: 0 }, uSize: { value: 0.34 }, uScale: { value: 600 } };
    this.trailU.uOpacity.value = 0;
    this.trail = new THREE.Points(tg, new THREE.ShaderMaterial({ uniforms: this.trailU, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.trail.material.userData.noFade = true;
    this.world.add(this.trail);
  }

  buildLocks() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe6df, roughness: 0.28, metalness: 0.75 });
    const shackleMat = new THREE.MeshStandardMaterial({ color: 0xb9c2b9, roughness: 0.2, metalness: 0.9 });
    const bodyGeo = new RoundedBoxGeometry(0.46, 0.38, 0.17, 3, 0.06);
    const arcGeo = new THREE.TorusGeometry(0.13, 0.035, 10, 24, Math.PI);
    const legGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10);
    const holeGeo = new THREE.CircleGeometry(0.045, 20);
    const slotGeo = new THREE.PlaneGeometry(0.03, 0.08);
    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 40);
    this.locks = LOCKS.map(([x, y, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = 0.35;
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const sh = new THREE.Group();
      sh.position.set(-0.13, 0.19, 0);                  // ось вращения — левая ножка
      const arc = new THREE.Mesh(arcGeo, shackleMat);
      arc.position.set(0.13, 0.14, 0);
      const legL = new THREE.Mesh(legGeo, shackleMat);
      legL.position.set(0, 0.07, 0);
      const legR = new THREE.Mesh(legGeo, shackleMat);
      legR.position.set(0.26, 0.07, 0);
      sh.add(arc, legL, legR);
      const holeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.6), side: THREE.DoubleSide });
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.position.set(0, 0.02, 0.087);
      const slot = new THREE.Mesh(slotGeo, holeMat);
      slot.position.set(0, -0.04, 0.087);
      const burstMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      burstMat.userData.noFade = true;
      const burst = new THREE.Mesh(ringGeo, burstMat);
      g.add(body, sh, hole, slot, burst);
      this.world.add(g);
      return { g, sh, hole, holeMat, burst, burstMat, open: 0, jig: 0, pop: 0, base: new THREE.Vector3(x, y, z), phase: i * 1.3 };
    });
    // «цепь» от трещины через замки наружу
    const pts = [CRACK.clone().add(new THREE.Vector3(0.05, 0, 0)), ...LOCKS.map(([x, y, z]) => new THREE.Vector3(x, y, z + 0.3)), EXIT_END.clone()];
    this.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.cableU = { uOpacity: { value: 1 }, uTime: { value: 0 }, uProg: { value: 0 } };
    const cable = new THREE.Mesh(new THREE.TubeGeometry(this.path, 120, 0.018, 6, false), new THREE.ShaderMaterial({ uniforms: this.cableU, vertexShader: VERT_UV, fragmentShader: CABLE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.world.add(cable);
    // параметры пути у каждого замка
    const probe = new THREE.Vector3();
    this.lockT = LOCKS.map(([x, y, z]) => {
      let best = 0, bd = 1e9;
      for (let k = 0; k <= 400; k++) {
        this.path.getPointAt(k / 400, probe);
        const d = probe.distanceToSquared(this.v1.set(x, y, z + 0.3));
        if (d < bd) { bd = d; best = k / 400; }
      }
      return best;
    });
  }

  buildBeam() {
    // луч света из трещины наружу
    this.beamU = { uColor: { value: new THREE.Color('#d9ffd2').multiplyScalar(1.2) }, uOpacity: { value: 1 }, uPower: { value: 0 }, uTime: { value: 0 } };
    const geo = new THREE.ConeGeometry(1.5, 4.2, 40, 1, true);
    geo.translate(0, -2.1, 0);
    geo.rotateZ(Math.PI / 2);   // ось конуса — вдоль +X, вершина в начале координат
    this.beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: this.beamU, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beam.position.copy(CRACK);
    this.beam.rotation.set(0, -0.12, 0.08);
    this.world.add(this.beam);
    this.flareU = { uColor: { value: new THREE.Color('#ffffff').multiplyScalar(1.6) }, uOpacity: { value: 1 }, uPower: { value: 0 } };
    this.flare = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.ShaderMaterial({ uniforms: this.flareU, vertexShader: VERT_UV, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flare.position.copy(CRACK).add(new THREE.Vector3(0.04, 0, 0));
    this.world.add(this.flare);
  }

  buildNetwork() {
    // узлы «интернета» вокруг песочницы (в основном позади и по бокам)
    const r = rng(404);
    const nodes = [NET_NODE.clone()];
    let guard = 0;
    while (nodes.length < 30 && guard++ < 5000) {
      const a = r.range(-Math.PI * 0.95, Math.PI * 0.62);    // угол вокруг Y (0 — +X)
      const rad = r.range(6.2, 12.5);
      const p = new THREE.Vector3(Math.cos(a) * rad + 0.8, r.range(0.6, 7.2), -Math.sin(a) * rad * 0.85 - 0.6);
      if (p.z > 3.6 && p.x > -1) continue;   // не загораживать вид спереди
      if (nodes.some((q) => q.distanceTo(p) < 2.3)) continue;
      nodes.push(p);
    }
    const edges = [];
    const seen = new Set();
    nodes.forEach((a, i) => {
      const d = nodes.map((b, j) => [j, a.distanceTo(b)]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]);
      for (let k = 0; k < 3; k++) {
        const [j, dist] = d[k];
        if (dist > 6.5) continue;
        const key = i < j ? i + '-' + j : j + '-' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i, j]);
      }
    });
    // расстояние каждого узла до стартового узла (по графу — для волны «включения»)
    const dist = nodes.map(() => Infinity);
    dist[0] = 0;
    for (let it = 0; it < nodes.length; it++) {
      edges.forEach(([a, b]) => {
        const l = nodes[a].distanceTo(nodes[b]);
        if (dist[a] + l < dist[b]) dist[b] = dist[a] + l;
        if (dist[b] + l < dist[a]) dist[a] = dist[b] + l;
      });
    }
    nodes.forEach((n, i) => { if (!Number.isFinite(dist[i])) dist[i] = n.distanceTo(nodes[0]) * 1.4; });
    this.net = { nodes, edges, dist, maxDist: Math.max(...dist) };
    // подпись «Интернет» — над самым высоким узлом в середине сети
    let topI = 1;
    nodes.forEach((n, i) => { if (n.y > nodes[topI].y && n.x > -2.5 && n.x < 6.5) topI = i; });
    const top = nodes[topI];
    this.netLabelPos = [top.x, top.y + 1.0, top.z];
    this.netLabelDist = dist[topI];   // когда до этого узла дойдёт волна — показать подпись
    // линии
    const P = [], T = [], D = [], Sd = [];
    edges.forEach(([a, b], k) => {
      const A = nodes[a], B = nodes[b];
      const seg = 10;
      for (let s = 0; s < seg; s++) {
        const t0 = s / seg, t1 = (s + 1) / seg;
        const p0 = A.clone().lerp(B, t0), p1 = A.clone().lerp(B, t1);
        P.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        const flip = dist[a] > dist[b];
        T.push(flip ? 1 - t0 : t0, flip ? 1 - t1 : t1);
        D.push(dist[a] + (dist[b] - dist[a]) * t0, dist[a] + (dist[b] - dist[a]) * t1);
        Sd.push(k * 0.37 % 1, k * 0.37 % 1);
      }
    });
    // связь шарика с сетью
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    lg.setAttribute('aT', new THREE.Float32BufferAttribute(T, 1));
    lg.setAttribute('aDist', new THREE.Float32BufferAttribute(D, 1));
    lg.setAttribute('aSeed', new THREE.Float32BufferAttribute(Sd, 1));
    this.netU = { uOpacity: { value: 1 }, uWave: { value: -2 }, uTime: { value: 0 } };
    this.netLines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ uniforms: this.netU, vertexShader: NET_VERT, fragmentShader: NET_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.netLines.frustumCulled = false;
    this.world.add(this.netLines);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(nodes.flatMap((n) => [n.x, n.y, n.z]), 3));
    ng.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    ng.setAttribute('aSize', new THREE.Float32BufferAttribute(nodes.map((_, i) => (i === 0 ? 1.0 : r.range(0.55, 0.95))), 1));
    this.nodeU = { uOpacity: { value: 1 }, uWave: this.netU.uWave, uScale: { value: 600 }, uTime: this.netU.uTime };
    this.netNodes = new THREE.Points(ng, new THREE.ShaderMaterial({ uniforms: this.nodeU, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.netNodes.frustumCulled = false;
    this.world.add(this.netNodes);
  }

  // ---------- Частицы ----------

  shape(kind) {
    if (this.shapes[kind]) return this.shapes[kind];
    const n = this.ctx.particles.count;
    const floor = (m, R, seed, k = 1) => {
      const s = S.createShape(m), r = rng(seed);
      const step = 0.22;
      for (let i = 0; i < m; i++) {
        let x, z, d;
        do {
          x = Math.round(r.range(-R, R) / step) * step;
          z = Math.round(r.range(-R, R) / step) * step;
          d = Math.hypot(x, z);
        } while (d > R);
        const f = d / R;
        const ring = 0.5 + 0.5 * Math.cos(d * 2.2);
        const size = (0.35 + 0.75 * (1 - f) * (0.6 + 0.4 * ring)) * k;
        const c = Math.abs(Math.abs(x) - FENCE) < 0.12 && Math.abs(z) < FENCE + 0.1 || Math.abs(Math.abs(z) - FENCE) < 0.12 && Math.abs(x) < FENCE + 0.1 ? S.PAL.green : r() < 0.15 ? S.PAL.mint : S.PAL.white;
        S.setPoint(s, i, x + r.gauss(0, 0.008), -0.005, z + r.gauss(0, 0.008), size, c, (0.1 + 0.22 * (1 - f)) * k);
      }
      return s;
    };
    let s;
    if (kind === 'floor') {
      s = S.combine(n, [
        { weight: 0.82, shape: (m) => floor(m, 13, 61) },
        { weight: 0.18, shape: (m) => S.fade(S.dust(m, { radius: 30, inner: 9, size: 0.7, alpha: 0.3, seed: 62 }), 0.8) },
      ]);
      s.meta.axis = 'y';
    } else {
      const { nodes, edges } = this.net;
      const nodeShape = (m) => {
        const sh = S.createShape(m), r = rng(71);
        for (let i = 0; i < m; i++) {
          const k = i % nodes.length;
          const q = nodes[k];
          const rad = k === 0 ? 0.32 : 0.24;
          const [x, y, z] = r.inSphere(rad);
          const c = r() < 0.35 ? S.PAL.greenHi : r() < 0.5 ? S.PAL.mint : S.PAL.white;
          S.setPoint(sh, i, q.x + x, q.y + y, q.z + z, r.range(0.6, 1.3), c, r.range(0.25, 0.6));
        }
        return sh;
      };
      const edgeShape = (m) => {
        const sh = S.createShape(m), r = rng(72);
        const lens = edges.map(([a, b]) => nodes[a].distanceTo(nodes[b]));
        const total = lens.reduce((x, y) => x + y, 0);
        const v = new THREE.Vector3();
        for (let i = 0; i < m; i++) {
          let pick = r() * total, e = 0;
          while (pick > lens[e] && e < edges.length - 1) { pick -= lens[e]; e++; }
          const [a, b] = edges[e];
          v.copy(nodes[a]).lerp(nodes[b], r());
          S.setPoint(sh, i, v.x + r.gauss(0, 0.035), v.y + r.gauss(0, 0.035), v.z + r.gauss(0, 0.035), r.range(0.45, 0.85), r() < 0.6 ? S.PAL.mint : S.PAL.green, r.range(0.2, 0.45));
        }
        return sh;
      };
      // плотность выравниваем по частям: сеть — «вид спереди», пол — «вид сверху»
      s = S.combine(n, [
        { weight: 0.22, shape: (m) => S.equalize(nodeShape(m), { axis: 'z' }) },
        { weight: 0.4, shape: (m) => S.equalize(edgeShape(m), { axis: 'z' }) },
        { weight: 0.38, shape: (m) => S.equalize(floor(m, 9.5, 63, 0.75), { axis: 'y' }) },
      ]);
      s.meta.equalized = true;
    }
    this.shapes[kind] = s;
    return s;
  }

  // ---------- Камера и фон ----------

  camera(state, step) {
    switch (step) {
      case 1: return { pos: [5.3, 4.6, 9.0], target: [0.2, 1.55, 0], fov: 42 };
      case 2: return { pos: [5.6, 3.1, 5.6], target: [1.3, 2.15, 0.3], fov: 42 };
      case 3: return { pos: [3.6, 3.0, 6.2], target: [3.1, 2.1, 0.9], fov: 42 };
      case 4: return { pos: [6.2, 9.8, 21.5], target: [1.6, 2.4, -1.2], fov: 46, duration: 2.6 };
      default: return { pos: [6.4, 5.6, 10.6], target: [0.7, 1.45, 0.2], fov: 42 };
    }
  }

  background(state, step) { return step >= 4 ? 'corners' : 'none'; }

  // ---------- Жизненный цикл ----------

  enter(o = {}) {
    this.state = o.state;
    const step = o.step ?? 0;
    this.step = step;
    this.ctx.engine.setFx({ scan: 0 }, 0.6); // на случай, если прошлый слайд оставил сканлайны
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.1, swirl: 0, size: 0.06, twinkle: 0.3, spring: 14, damping: 5.5 }, o.instant ? 0 : 1);
    p.morph(this.shape(step >= 4 ? 'net' : 'floor'), { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 10 });
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.5, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.5, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.5 });
    this.ensureLabels();
    this.setInstant(step);
    if (!o.instant) {
      this.lbl.ai.hide(); this.lbl.net.hide();
      this.delay(1.3, () => this.updateLabels(this.step));
    }
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    this.killScript();
    if (o.instant || Math.abs(step - prev) > 1 || step < prev) {
      if (this.ownsParticles()) this.particles.morph(this.shape(step >= 4 ? 'net' : 'floor'), { duration: 1.6, stagger: 0.4, burst: 4 });
      this.setInstant(step, !o.instant);
      return;
    }
    // вперёд на один шаг — анимация; сначала дотягиваем всё, что мог оборвать быстрый клик
    this.applyProps(prev, 0.25);
    if (step >= 2) this.tw(this.ball.scale, { x: 1, y: 1, z: 1, duration: 0.3, ease: 'power2.out' });
    if (step === 1) this.goProbe();
    else if (step === 2) this.goCrack();
    else if (step === 3) this.goEscape();
    else if (step === 4) this.goFree();
  }

  ensureLabels() {
    if (this.lbl) return;
    this.lbl = {
      ai: this.label({ html: '<span class="b5-tag3d is-accent b5-ai">ИИ</span>', object: this.ball, offset: [0, 0.62, 0], visible: false }),
      net: this.label({ html: '<span class="b5-tag3d b5-net">Интернет</span>', position: this.netLabelPos, visible: false }),
    };
  }

  /** Всё, кроме шарика: трещина, луч, замки, цепь, сеть — к виду шага step. */
  applyProps(step, d, dNet = d) {
    const crack = step >= 2 ? 1 : 0;
    this.setVal(this.glassU.uCrack, crack, d);
    this.setVal(this.beamU.uPower, step >= 2 ? (step >= 3 ? BEAM_OUT : BEAM_ON) : 0, d);
    this.setVal(this.flareU.uPower, step >= 2 ? FLARE_ON : 0, d);
    this.locks.forEach((L) => this.setLock(L, step >= 3 ? 1 : 0, d));
    this.setVal(this.cableU.uProg, step >= 3 ? 1.05 : 0, d);
    this.setVal(this.netU.uWave, step >= 4 ? this.net.maxDist + 2 : -2, dNet);
    if (d > 0) this.tw(this.screenMat.color, { r: 1.15, g: 1.15, b: 1.15, duration: d });
    else this.screenMat.color.setScalar(1.15);
  }

  /** Привести сцену к виду шага step без сценария (вход, назад, прыжок). soft — с короткими переходами. */
  setInstant(step, soft = false) {
    const d = soft ? 0.6 : 0;
    this.killScript();
    this.applyProps(step, d, soft ? 1.2 : 0);
    // шарик
    if (step <= 0) {
      this.mode = 'sleep';
      this.setBall(SCREEN_IN, 0.42, d);
    } else if (step === 1) {
      if (this.mode !== 'probe') this.setBall(this.v1.set(0, 2.6, 0.3), 1, d);
      this.mode = 'probe';
      this.probe = null;
    } else if (step === 2) {
      this.mode = 'hover';
      this.hover.copy(HOVER_CRACK);
      this.setBall(this.hover, 1, d);
    } else if (step === 3) {
      this.mode = 'hover';
      this.hover.copy(EXIT_END);
      this.setBall(this.hover, 1, d);
    } else {
      this.mode = 'hover';
      this.hover.copy(NET_NODE).add(this.v1.set(-0.05, -0.55, 0.05));
      this.setBall(this.hover, 1, d);
    }
    this.twk('aiOff', this, { aiOff: step === 3 ? AI_DOWN : AI_UP, duration: d });
    this.updateLabels(step);
  }

  updateLabels(step) {
    if (!this.lbl) return;
    step >= 1 ? this.lbl.ai.show() : this.lbl.ai.hide();
    step >= 4 ? this.lbl.net.show() : this.lbl.net.hide();
  }

  setVal(u, v, d) { if (d > 0) this.tw(u, { value: v, duration: d, ease: 'power2.inOut' }); else u.value = v; }

  /** Поставить шарик в pos; vis — масштаб (1 — обычный, 0 — скрыт). d > 0 — «схлопнуться и проявиться». */
  setBall(pos, vis, d) {
    const k = Math.max(0.001, +vis || 0);
    const p = pos.clone();
    if (d > 0) {
      const b = this.ball;
      const tl = this.tl();
      tl.to(b.scale, { x: 0.001, y: 0.001, z: 0.001, duration: d * 0.45, ease: 'power2.in' })
        .call(() => { b.position.copy(p); this.resetTrail(); })
        .to(b.scale, { x: k, y: k, z: k, duration: d * 0.55, ease: 'back.out(2)' });
      this.script = tl;
    } else {
      this.ball.position.copy(p);
      this.ball.scale.setScalar(k);
      this.resetTrail();
    }
  }

  setLock(L, open, d) {
    L.jig = 0;
    L.pop = 0;
    if (d > 0) {
      this.tw(L, { open, duration: d, ease: 'power2.inOut' });
    } else L.open = open;
  }

  killScript() { this.script?.kill(); this.script = null; }

  ripple(worldPoint) {
    const u = this.glassU.uRip.value[this.ripIdx++ % MAX_RIP];
    u.set(worldPoint.x - CUBE_C.x, worldPoint.y - CUBE_C.y, worldPoint.z - CUBE_C.z, this.glassU.uTime.value);
  }

  // ---------- Сценарии шагов ----------

  goProbe() {
    // шарик выходит из монитора и начинает ощупывать стенки
    this.mode = 'script';
    const b = this.ball;
    b.position.copy(SCREEN_IN);
    this.resetTrail();
    this.updateLabels(1);
    const tl = this.tl();
    tl.to(this.screenMat.color, { r: 3, g: 3, b: 3, duration: 0.25, ease: 'power2.out' })
      .to(b.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(2.2)' }, 0.1)
      .to(b.position, { z: SCREEN.z + 0.9, y: SCREEN.y + 0.9, duration: 0.9, ease: 'power2.out' }, 0.2)
      .to(this.screenMat.color, { r: 1.15, g: 1.15, b: 1.15, duration: 0.8 }, 0.4)
      .call(() => { this.mode = 'probe'; this.probe = null; });
    this.script = tl;
  }

  goCrack() {
    // к правой стенке, три удара — трещина растёт, свет пробивается
    this.mode = 'script';
    const b = this.ball;
    const tap = this.v2.set(CRACK.x - BALL_R - 0.02, CRACK.y, CRACK.z).clone();
    const back = this.v3.set(CRACK.x - 0.75, CRACK.y + 0.05, CRACK.z - 0.1).clone();
    const tl = this.tl();
    tl.to(b.position, { x: back.x, y: back.y, z: back.z, duration: 0.8, ease: 'power2.inOut' });
    const hits = [0.34, 0.66, 1.0];
    hits.forEach((c, i) => {
      tl.to(b.position, { x: tap.x, y: tap.y, z: tap.z, duration: 0.22, ease: 'power3.in' })
        .call(() => {
          this.ripple(CRACK);
          this.ctx.rig.shake(0.06 + i * 0.05, 0.35);
          this.ctx.engine.pulse({ aberration: 0.6 + i * 0.5, glitch: i === 2 ? 0.5 : 0.15 }, 0.5);
        })
        .to(this.glassU.uCrack, { value: c, duration: i === 2 ? 1.1 : 0.45, ease: 'power2.out' })
        .to(b.position, { x: back.x + (i === 2 ? 0.45 : 0), y: back.y, z: back.z, duration: 0.35, ease: 'power2.out' }, '<');
    });
    tl.to(this.beamU.uPower, { value: BEAM_ON, duration: 1.2, ease: 'power2.out' }, '-=0.6')
      .to(this.flareU.uPower, { value: FLARE_ON, duration: 0.8 }, '<')
      .call(() => { this.ctx.background.surge(0.6, 1.3); })
      .to(b.position, { x: HOVER_CRACK.x, y: HOVER_CRACK.y, z: HOVER_CRACK.z, duration: 0.8, ease: 'power2.inOut' })
      .call(() => { this.hover.copy(b.position); this.mode = 'hover'; });
    this.script = tl;
  }

  goEscape() {
    // протиснуться сквозь трещину и пройти цепочку замков
    this.mode = 'script';
    const b = this.ball;
    const st = { t: 0 };
    const tl = this.tl();
    // подпись «ИИ» уходит под шарик, чтобы не закрывать замки
    this.twk('aiOff', this, { aiOff: AI_DOWN, duration: 0.6, ease: 'power2.inOut' });
    tl.to(b.position, { x: CRACK.x - BALL_R - 0.02, y: CRACK.y, z: CRACK.z, duration: 0.5, ease: 'power2.inOut' }, 0)
      .to(b.scale, { x: 0.35, y: 1.35, z: 1.35, duration: 0.3, ease: 'power2.in' })
      .to(b.position, { x: CRACK.x + 0.12, duration: 0.55, ease: 'power1.inOut' })
      .call(() => { this.ripple(CRACK); this.ctx.engine.pulse({ glitch: 0.45, aberration: 1.2 }, 0.5); })
      .to(b.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2.5)' });
    // по цепи: у каждого замка — остановка, «подбор» (замок дребезжит), щелчок — дужка откидывается
    let tPrev = 0;
    this.lockT.forEach((t, i) => {
      const L = this.locks[i];
      tl.to(st, { t, duration: 0.45 + (t - tPrev) * 1.3, ease: 'power2.inOut', onUpdate: () => this.path.getPointAt(st.t, b.position) })
        .to(this.cableU.uProg, { value: t, duration: 0.45 }, '<')
        .to(L, { jig: 1, duration: 0.1 })
        .to(L, { jig: 0, duration: 0.25 })
        .call(() => this.unlock(L))
        .to(L, { open: 1, duration: 0.55, ease: 'back.out(1.8)' }, '<')
        .to({}, { duration: 0.15 });
      tPrev = t;
    });
    tl.to(st, { t: 1, duration: 0.9, ease: 'power2.out', onUpdate: () => this.path.getPointAt(st.t, b.position) })
      .to(this.cableU.uProg, { value: 1.05, duration: 0.7 }, '<')
      .call(() => { this.hover.copy(b.position); this.mode = 'hover'; });
    // луч слабеет — шарик уже снаружи
    tl.to(this.beamU.uPower, { value: BEAM_OUT, duration: 1.2 }, 0.8);
    this.script = tl;
  }

  unlock(L) {
    L.burstMat.opacity = 1;
    L.burstT = 0;
    L.pop = 1;
    this.ctx.engine.pulse({ glitch: 0.35, aberration: 1.0 }, 0.45);
    this.ctx.rig.shake(0.05, 0.25);
  }

  goFree() {
    // шарик снаружи — сеть загорается волной от ближайшего узла
    this.mode = 'script';
    const b = this.ball;
    const end = this.v1.copy(NET_NODE).add(this.v2.set(-0.05, -0.55, 0.05)).clone();
    // волна uWave: −2 → maxDist + 2 за 2,6 с (power1.in) — момент, когда она дойдёт до узла с подписью
    const WAVE = 2.6;
    const tLbl = WAVE * Math.sqrt(Math.min(1, Math.max(0, (this.netLabelDist + 2.6) / (this.net.maxDist + 4))));
    const tl = this.tl();
    this.twk('aiOff', this, { aiOff: AI_UP, duration: 0.8, ease: 'power2.inOut' });
    tl.to(b.position, { x: end.x, y: end.y, z: end.z, duration: 1.1, ease: 'power2.inOut' }, 0)
      .call(() => {
        if (this.ownsParticles()) {
          this.particles.morph(this.shape('net'), { duration: 2.4, stagger: 0.6, burst: 8 });
        }
        this.ctx.engine.pulse({ flash: 0.12, aberration: 1.2 }, 0.8);
        this.ctx.background.surge(0.55, 1.8);
      })
      .to(this.netU.uWave, { value: this.net.maxDist + 2, duration: WAVE, ease: 'power1.in' }, '<')
      // подпись «Интернет» — когда волна дошла до узла под ней (а не над пустым местом)
      .call(() => this.lbl?.net.show(), null, '<' + tLbl.toFixed(2))
      .call(() => { this.hover.copy(b.position); this.mode = 'hover'; });
    this.script = tl;
  }

  exit(o = {}) {
    this.killScript();
    this.lbl && Object.values(this.lbl).forEach((l) => l.hide());
    return super.exit(o);
  }

  // ---------- Кадр ----------

  resetTrail() {
    const p = this.ball.position, tp = this.trailPos;
    for (let i = 0; i < this.trailN; i++) { tp[i * 3] = p.x; tp[i * 3 + 1] = p.y; tp[i * 3 + 2] = p.z; }
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  updateProbe(dt) {
    // ощупывание: дуга над компьютером к очередной точке стенки, касание — волна на стекле
    const TARGETS = this._targets || (this._targets = [
      [[-HALF + BALL_R + 0.02, 2.4, -0.4], [-1, 0, 0]],
      [[0.55, 2.7, -HALF + BALL_R + 0.02], [0, 0, -1]],
      [[0.2, 2 * HALF - BALL_R - 0.02, 0.35], [0, 1, 0]],
      [[-0.5, 2.15, HALF - BALL_R - 0.02], [0, 0, 1]],
      [[HALF - BALL_R - 0.02, 1.7, -0.75], [1, 0, 0]],
      [[-HALF + BALL_R + 0.02, 1.55, 0.9], [-1, 0, 0]],
      [[-0.6, 1.9, -HALF + BALL_R + 0.02], [0, 0, -1]],
      [[0.75, 2.6, HALF - BALL_R - 0.02], [0, 0, 1]],
    ].map(([p, n]) => ({ p: new THREE.Vector3(...p), n: new THREE.Vector3(...n) })));
    const b = this.ball.position;
    if (!this.probe) {
      const tg = TARGETS[this.probeIdx++ % TARGETS.length];
      this.probe = { from: b.clone(), to: tg.p, n: tg.n, k: 0, dur: 0.75, wait: 0 };
    }
    const pr = this.probe;
    if (pr.wait > 0) {
      pr.wait -= dt;
      if (pr.wait <= 0) this.probe = null;
      return;
    }
    pr.k = Math.min(1, pr.k + dt / pr.dur);
    const k = pr.k < 0.5 ? 2 * pr.k * pr.k : 1 - Math.pow(-2 * pr.k + 2, 2) / 2;
    // квадратичная кривая через верх куба
    const cx = 0, cy = 3.0, cz = 0.1;
    const a = 1 - k;
    b.set(a * a * pr.from.x + 2 * a * k * cx + k * k * pr.to.x, a * a * pr.from.y + 2 * a * k * cy + k * k * pr.to.y, a * a * pr.from.z + 2 * a * k * cz + k * k * pr.to.z);
    if (pr.k >= 1) {
      this.ripple(this.v3.copy(pr.to).addScaledVector(pr.n, BALL_R));
      pr.wait = 0.22;
    }
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05);
    this.glassU.uTime.value = t;
    this.beamU.uTime.value = t;
    this.cableU.uTime.value = t;
    this.netU.uTime.value = t;
    this.screenTex.offset.y = (t * 0.06) % 1;
    const sc = this.particles.uniforms.uScale.value;
    this.trailU.uScale.value = sc;
    this.nodeU.uScale.value = sc;
    // шарик
    if (this.mode === 'probe') this.updateProbe(dt);
    else if (this.mode === 'sleep' && !this.script?.isActive()) this.ball.scale.setScalar(0.42 + Math.sin(t * 2.4) * 0.06);
    else if (this.mode === 'hover') {
      this.ball.position.set(this.hover.x + Math.sin(t * 1.7) * 0.05, this.hover.y + Math.sin(t * 2.3) * 0.07, this.hover.z + Math.cos(t * 1.3) * 0.05);
    }
    const vis = this.ball.scale.y > 0.05 ? 1 : 0;
    this.ballVis += (vis - this.ballVis) * Math.min(1, dt * 6);
    this.trailU.uOpacity.value = this.ballVis * this.opacity;
    this.ballGlow.quaternion.copy(this.ctx.camera.quaternion);
    this.ballGlowU.uPower.value = 0.9 + Math.sin(t * 6) * 0.1;
    if (this.lbl) this.lbl.ai.offset.y = this.aiOff;
    // шлейф — сдвиг истории
    const tp = this.trailPos, p = this.ball.position;
    tp.copyWithin(3, 0, (this.trailN - 1) * 3);
    tp[0] = p.x; tp[1] = p.y; tp[2] = p.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
    // замки: дужка поднимается и откидывается, корпус качается
    for (const L of this.locks) {
      const o = L.open;
      L.sh.position.y = 0.19 + Math.min(1, o * 1.6) * 0.12;
      L.sh.rotation.y = -Math.max(0, o - 0.35) / 0.65 * 2.1;
      L.g.rotation.z = Math.sin(t * 1.4 + L.phase) * 0.06 * (1 + o * 2) + o * 0.18 + Math.sin(t * 47) * 0.11 * L.jig;
      L.g.position.y = L.base.y + Math.sin(t * 1.1 + L.phase) * 0.05;
      // щелчок: замок «подпрыгивает»
      if (L.pop > 0) L.pop = Math.max(0, L.pop - dt * 2.6);
      L.g.scale.setScalar(1 + Math.sin(L.pop * Math.PI) * 0.22);
      L.holeMat.color.setRGB(o * 1.7, 1.6 * (1 - o) + o * 0.075, o * 0.05);
      if (L.burstT != null && L.burstT < 1) {
        L.burstT = Math.min(1, L.burstT + dt * 1.6);
        L.burst.scale.setScalar(0.6 + L.burstT * 1.8);
        L.burstMat.opacity = (1 - L.burstT) * this.opacity;
      } else if (L.burstMat.opacity !== 0) L.burstMat.opacity = 0;
      L.burst.quaternion.copy(L.g.quaternion).invert().multiply(this.ctx.camera.quaternion);
    }
    this.flare.quaternion.copy(this.ctx.camera.quaternion);
    // табличка «Нет интернета» сбоит, когда сеть уже горит
    const on = this.netU.uWave.value > 2 ? 1 : 0;
    const flick = on ? (Math.sin(t * 37) * Math.sin(t * 13.7) > 0.35 ? 0.25 : 0.85) : 0.85;
    this.signMat.color.setScalar(flick);
  }
}
