// «Гонка» (CoastRunners, 2016): трасса сверху из неоновых линий и халфтон-точек,
// лодка вместо финиша крутит восьмёрки в лагуне у бонусов, бонусы исчезают и появляются снова,
// счётчик очков растёт, флажок «Финиш» одиноко мигает.
// Состояния: 'intro' (вопрос №8: лодка ждёт на старте, трасса справа от текста; шаг 1 — подсказка-восьмёрка),
//            'loop' (гонка: восьмёрки, очки; шаг 1 — низкий «кинокадр» с одиноким финишем).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU, formatNumber } from '../../core/utils.js';
import { Boat, figureEight } from './boat-model.js';

// ---------- Геометрия трассы (плоскость XZ; камера сверху, -Z — верх экрана) ----------
const TRACK_PTS = [
  [-4.2, -2.6], [-1.0, -3.0], [2.6, -2.7], [4.6, -1.6], [4.5, 0.9],
  [3.2, 2.6], [0.6, 2.2], [-1.6, 3.0], [-4.0, 2.4], [-4.8, 0.0],
];
const HALF_W = 0.72;                       // полуширина трассы
const BAY = { x: 0.4, z: 0.0, r: 1.7 };    // лагуна с бонусами
const LOOP = { a: 1.25, b: 0.62, cx: BAY.x, cz: BAY.z }; // восьмёрка
const START_T = 0.142;                     // параметр кривой у линии старта/финиша (верхняя прямая, правее центра)
const SCENE_C = [-0.1, -0.25];             // центр всей сцены (для камеры)
const BONUS_U = [Math.PI / 2, 0, (3 * Math.PI) / 2]; // бонусы — на кончиках и в центре восьмёрки
const LOOP_SPEED = 2.05;                   // рад/с
const RESPAWN = 1.25;                      // с

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d));
  a = a * a * uPower;
  gl_FragColor = vec4(uColor * a, a) * uOpacity;
}
`;
const FLAG_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.x;
  p.z += sin(uv.x * 7.0 - uTime * 6.0) * 0.07 * k;
  p.y += sin(uv.x * 5.0 - uTime * 4.5) * 0.025 * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const SPOT_VERT = /* glsl */ `
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
const SPOT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uPower;
varying vec2 vUv;
varying float vFace;
void main() {
  float a = vUv.y * vUv.y * vFace * vFace * uPower;   // ярче у «прожектора» сверху, мягкие края
  gl_FragColor = vec4(uColor * a, a) * uOpacity;
}
`;
const FLAG_FRAG = /* glsl */ `
uniform float uOpacity, uBlink;
varying vec2 vUv;
void main() {
  vec2 c = floor(vUv * vec2(6.0, 4.0));
  float chk = mod(c.x + c.y, 2.0);
  // не ярче ~0.8: иначе bloom размывает клетку флага в белое пятно (особенно на низком «кинокадре»)
  vec3 hi = vec3(0.72) * (0.55 + 0.5 * uBlink);
  vec3 col = mix(vec3(0.03, 0.05, 0.03), hi, chk);
  gl_FragColor = vec4(col, uOpacity);
}
`;
const DASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime, uDraw;
varying vec2 vUv;
void main() {
  float d = step(0.5, fract(vUv.x * 46.0 - uTime * 1.6));
  float drawn = 1.0 - smoothstep(uDraw - 0.02, uDraw, vUv.x);
  float a = d * drawn * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aLife;
uniform float uScale;
varying float vL;
void main() {
  vL = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aLife > 0.0 ? max(1.0, 0.11 * uScale * (0.4 + 0.6 * aLife) / max(0.1, -mv.z)) : 0.0;
}
`;
const SPARK_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vL;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vL <= 0.0) discard;
  float a = exp(-d * d * 3.5) * vL * uOpacity;
  vec3 col = mix(vec3(0.2, 1.0, 0.25), vec3(1.0), vL * vL) * 1.6;
  gl_FragColor = vec4(col * a, a);
}
`;

function ribbon(centers, normals, width, valid = null, y = 0.01) {
  const n = centers.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i], m = normals[i];
    pos.set([c.x + m.x * width / 2, y, c.z + m.z * width / 2, c.x - m.x * width / 2, y, c.z - m.z * width / 2], i * 6);
    uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
    if (i < n - 1 && (!valid || (valid[i] && valid[i + 1]))) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export default class Race extends Visual {
  static transition = 'morph';

  async init() {
    const P = TRACK_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(P, true, 'centripetal');
    // выборка трассы по длине
    const N = 640;
    this.tc = []; this.tn = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u);
      this.tc.push(p);
      this.tn.push(new THREE.Vector3(-t.z, 0, t.x).normalize());
    }
    this.scene = new THREE.Group();
    this.root.add(this.scene);
    this.buildTrack();
    this.buildStartFinish();
    this.buildBonuses();
    // лодка
    this.boat = new Boat({ scale: 0.92, wakeLength: 90, spacing: 0.06, wakeLife: 2.2 });
    this.scene.add(this.boat.object, this.boat.wake);
    this.startPos = this.curve.getPoint(START_T).clone();
    this.startPos.addScaledVector(this.startTan, -0.7); // перед линией старта
    this.boat.place(this.startPos, this.startTan);
    this.boat.setHeading(Math.atan2(this.startTan.x, this.startTan.z));
    this.boat.resetWake();
    // подсказка: пунктир-восьмёрка
    this.buildHint();
    this.buildSparks();
    // частицы
    this.shapes = {};
    this.mode = 'idle';
    this.u = -Math.PI / 2;
    this.blendK = 1;
    this.blendDur = 1.6;
    this.blendFrom = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.score = 0;
    this.shownScore = -1;
    this.popIdx = 0;
    this.flash = 0;
    this.shape(false);
    this.shape(true);
  }

  // ---------- Построение сцены ----------

  buildTrack() {
    const tc = this.tc, tn = this.tn;
    const edgeO = [], edgeI = [], validI = [], validO = [];
    // какая нормаль «наружу»: от центра сцены
    let sign = 0;
    tc.forEach((c, i) => { sign += (c.x - SCENE_C[0]) * tn[i].x + (c.z - SCENE_C[1]) * tn[i].z; });
    this.outSign = sign >= 0 ? 1 : -1;
    tc.forEach((c, i) => {
      const n = tn[i];
      const o = c.clone().addScaledVector(n, HALF_W * this.outSign);
      const ii = c.clone().addScaledVector(n, -HALF_W * this.outSign);
      edgeO.push(o); edgeI.push(ii);
      validO.push(true);
      validI.push(Math.hypot(ii.x - BAY.x, ii.z - BAY.z) > BAY.r + 0.02);
    });
    const green = new THREE.Color('#4dff3a').multiplyScalar(1.0);
    const white = new THREE.Color('#ffffff').multiplyScalar(0.9);
    this.edgeMat = new THREE.MeshBasicMaterial({ color: green, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.edgeMat2 = new THREE.MeshBasicMaterial({ color: white, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(ribbon(edgeO, tn, 0.055, validO), this.edgeMat));
    this.scene.add(new THREE.Mesh(ribbon(edgeI, tn, 0.045, validI), this.edgeMat2));
    // мягкое свечение вдоль внешнего края
    this.edgeGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e000').multiplyScalar(0.06), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(ribbon(edgeO, tn, 0.3, validO, 0.005), this.edgeGlowMat));
    // разметка по центру — короткие штрихи
    const dashPos = [], dashIdx = [];
    const len = this.curve.getLength();
    const step = 0.55, dl = 0.26, dw = 0.045;
    let k = 0;
    for (let s = 0.4; s < len - 0.4; s += step) {
      const u0 = s / len, u1 = (s + dl) / len;
      if (Math.abs(u0 - this.curveUAt(START_T)) < 0.02) continue;
      const a = this.curve.getPointAt(u0), b = this.curve.getPointAt(u1);
      const t = this.curve.getTangentAt(u0);
      const n = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(dw);
      dashPos.push(a.x + n.x, 0.012, a.z + n.z, a.x - n.x, 0.012, a.z - n.z, b.x + n.x, 0.012, b.z + n.z, b.x - n.x, 0.012, b.z - n.z);
      dashIdx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      k += 4;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dashPos, 3));
    dg.setIndex(dashIdx);
    this.dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(0.55), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(dg, this.dashMat));
    // берег лагуны (дуга без части, где лагуна открыта в трассу)
    const M = 220, bc = [], bn = [], bv = [];
    for (let i = 0; i <= M; i++) {
      const a = (i / M) * TAU;
      const p = new THREE.Vector3(BAY.x + Math.cos(a) * BAY.r, 0, BAY.z + Math.sin(a) * BAY.r);
      bc.push(p); bn.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      let dmin = 1e9;
      for (let j = 0; j < tc.length; j += 2) dmin = Math.min(dmin, Math.hypot(tc[j].x - p.x, tc[j].z - p.z));
      bv.push(dmin > HALF_W + 0.03);
    }
    this.bayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c8ffc0').multiplyScalar(0.9), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.scene.add(new THREE.Mesh(ribbon(bc, bn, 0.05, bv), this.bayMat));
  }

  /** Параметр по длине (getPointAt) для параметра getPoint — приближённо. */
  curveUAt(t) {
    if (this._uCache?.[t] != null) return this._uCache[t];
    const p = this.curve.getPoint(t);
    let best = 0, bd = 1e9;
    for (let i = 0; i < this.tc.length; i++) {
      const d = this.tc[i].distanceToSquared(p);
      if (d < bd) { bd = d; best = i / (this.tc.length - 1); }
    }
    this._uCache = this._uCache || {};
    this._uCache[t] = best;
    return best;
  }

  buildStartFinish() {
    const c = this.curve.getPoint(START_T);
    const t = this.curve.getTangent(START_T).normalize();
    this.startTan = t.clone();
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const yaw = Math.atan2(t.x, t.z);
    // клетчатая линия старта/финиша
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 32;
    const g = cnv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#d8d8d8' : '#0a0a0a';
      g.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_W * 2 / 8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(0.85, 0.85, 0.85) }));
    line.rotation.set(-Math.PI / 2, 0, 0);
    const lg = new THREE.Group();
    lg.add(line);
    lg.position.set(c.x, 0.015, c.z);
    lg.rotation.y = yaw + Math.PI / 2;
    this.scene.add(lg);
    // флаг «Финиш» — снаружи трассы
    this.flagGroup = new THREE.Group();
    const fp = c.clone().addScaledVector(n, (HALF_W + 0.42) * this.outSign);
    this.flagGroup.position.set(fp.x, 0, fp.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.35, 10), new THREE.MeshStandardMaterial({ color: 0xcfd6cf, roughness: 0.4, metalness: 0.5, flatShading: true }));
    pole.position.y = 0.675;
    this.flagGroup.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(2), side: THREE.DoubleSide }));
    knob.position.y = 1.37;
    this.flagGroup.add(knob);
    this.flagUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 }, uBlink: { value: 1 } };
    const flagGeo = new THREE.PlaneGeometry(0.8, 0.5, 14, 6);
    flagGeo.translate(0.4, 0, 0);
    const flag = new THREE.Mesh(flagGeo, new THREE.ShaderMaterial({ uniforms: this.flagUniforms, vertexShader: FLAG_VERT, fragmentShader: FLAG_FRAG, side: THREE.DoubleSide, transparent: true }));
    flag.position.set(0.02, 1.08, 0);
    this.flagGroup.add(flag);
    // маячок на воде вокруг флага
    this.beaconU = { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.4) }, uOpacity: { value: 1 }, uPower: { value: 0.8 } };
    const beacon = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.ShaderMaterial({ uniforms: this.beaconU, vertexShader: GLOW_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    beacon.rotation.x = -Math.PI / 2;
    beacon.position.y = 0.02;
    this.flagGroup.add(beacon);
    this.flagRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.39, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.flagRing.rotation.x = -Math.PI / 2;
    this.flagRing.position.y = 0.03;
    this.flagRing.material.userData.noFade = true;
    this.flagGroup.add(this.flagRing);
    // одинокий «прожектор» над финишем (виден, пока лодка крутит восьмёрки)
    this.spotU = { uColor: { value: new THREE.Color('#e8ffe4').multiplyScalar(0.9) }, uOpacity: { value: 1 }, uPower: { value: 0 } };
    const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.75, 3.2, 40, 1, true), new THREE.ShaderMaterial({
      uniforms: this.spotU, vertexShader: SPOT_VERT, fragmentShader: SPOT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    spot.position.y = 1.6;
    this.flagGroup.add(spot);
    this.scene.add(this.flagGroup);
  }

  buildBonuses() {
    const ringGeo = new THREE.TorusGeometry(0.3, 0.026, 8, 48);
    const gemGeo = new THREE.OctahedronGeometry(0.17, 0);
    const haloGeo = new THREE.PlaneGeometry(1.5, 1.5);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#4dff3a').multiplyScalar(1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.gemMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color('#00ff00'), emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.2, flatShading: true });
    this.haloU = { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(0.8) }, uOpacity: { value: 1 }, uPower: { value: 0.24 } };
    const haloMat = new THREE.ShaderMaterial({ uniforms: this.haloU, vertexShader: GLOW_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.bonuses = BONUS_U.map((u, i) => {
      const p = figureEight(u, LOOP);
      const g = new THREE.Group();
      g.position.set(p.x, 0.05, p.z);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2;
      const body = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, this.ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      const gem = new THREE.Mesh(gemGeo, this.gemMat);
      gem.position.y = 0.38;
      body.add(ring, gem);
      const burstMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      burstMat.userData.noFade = true;
      const burst = new THREE.Mesh(ringGeo, burstMat);
      burst.rotation.x = Math.PI / 2;
      burst.position.y = 0.1;
      g.add(halo, body, burst);
      this.scene.add(g);
      return { g, body, gem, halo, burst, u, pos: g.position, on: true, appear: 1, timer: 0, burstT: 1, phase: i * 1.7 };
    });
  }

  buildSparks() {
    // искры при сборе бонуса (свой маленький пул, без аллокаций в кадре)
    const N = this.sparkN = 120;
    this.sparkPos = new Float32Array(N * 3);
    this.sparkVel = new Float32Array(N * 3);
    this.sparkLife = new Float32Array(N);
    this.sparkIdx = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.sparkLife, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.sparkU = { uOpacity: { value: 1 }, uScale: { value: 600 } };
    this.sparks = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.sparkU,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
  }

  burst(p) {
    const N = this.sparkN;
    for (let k = 0; k < 22; k++) {
      const i = this.sparkIdx++ % N;
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.2;
      this.sparkPos[i * 3] = p.x; this.sparkPos[i * 3 + 1] = p.y + 0.3; this.sparkPos[i * 3 + 2] = p.z;
      this.sparkVel[i * 3] = Math.cos(a) * sp; this.sparkVel[i * 3 + 1] = 1.5 + Math.random() * 2.5; this.sparkVel[i * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[i] = 1;
    }
  }

  updateSparks(dt) {
    const P = this.sparkPos, V = this.sparkVel, L = this.sparkLife;
    const damp = Math.exp(-2.2 * dt);
    let any = false;
    for (let i = 0; i < this.sparkN; i++) {
      if (L[i] <= 0) continue;
      any = true;
      L[i] = Math.max(0, L[i] - dt * 1.5);
      V[i * 3 + 1] -= 7 * dt;
      V[i * 3] *= damp; V[i * 3 + 1] *= damp; V[i * 3 + 2] *= damp;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] = Math.max(0.02, P[i * 3 + 1] + V[i * 3 + 1] * dt); P[i * 3 + 2] += V[i * 3 + 2] * dt;
    }
    if (any || this._sparksDirty) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.aLife.needsUpdate = true;
      this._sparksDirty = any;
    }
    this.sparkU.uScale.value = this.particles.uniforms.uScale.value;
  }

  buildHint() {
    // пунктир-восьмёрка «идеального» маршрута (появляется на шаге-ответе)
    const M = 260, c = [], n = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i <= M; i++) {
      const u = (i / M) * TAU;
      figureEight(u, LOOP, p, t);
      c.push(p.clone()); n.push(new THREE.Vector3(-t.z, 0, t.x));
    }
    this.hintU = { uColor: { value: new THREE.Color('#ffffff').multiplyScalar(1.3) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uDraw: { value: 0 } };
    this.hint = new THREE.Mesh(ribbon(c, n, 0.07, null, 0.03), new THREE.ShaderMaterial({ uniforms: this.hintU, vertexShader: GLOW_VERT, fragmentShader: DASH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.scene.add(this.hint);
  }

  // ---------- Частицы ----------

  shape(withLoop) {
    const key = withLoop ? 'loop' : 'plain';
    if (this.shapes[key]) return this.shapes[key];
    const n = this.ctx.particles.count;
    const tc = this.tc, tn = this.tn, L = tc.length - 1;
    const parts = [
      // халфтон-покрытие трассы: точки в узлах сетки вдоль трассы
      { weight: 0.36, shape: (m) => {
        const s = S.createShape(m), r = rng(21);
        const rows = 330, cols = 11;
        for (let i = 0; i < m; i++) {
          const row = Math.floor(r() * rows), col = Math.floor(r() * cols);
          const j = Math.floor((row / rows) * L);
          const v = ((col + 0.5) / cols) * 2 - 1;
          const c = tc[j], nn = tn[j];
          const x = c.x + nn.x * v * HALF_W * 0.9 + r.gauss(0, 0.012);
          const z = c.z + nn.z * v * HALF_W * 0.9 + r.gauss(0, 0.012);
          const edge = Math.abs(v) > 0.8;
          const col3 = r() < 0.12 ? S.PAL.green : edge ? S.PAL.mint : S.PAL.white;
          S.setPoint(s, i, x, 0.0, z, r.range(0.55, 0.9), col3, r.range(0.18, 0.34));
        }
        return s;
      } },
      // вода: халфтон-волны (размер точки — по «волнам»)
      { weight: 0.36, shape: (m) => {
        const s = S.createShape(m), r = rng(22);
        let i = 0, guard = 0;
        while (i < m && guard++ < m * 30) {
          const x = r.range(-12, 12), z = r.range(-7.5, 7.5);
          if ((x / 12) ** 2 + (z / 7.5) ** 2 > 1) continue;
          if (Math.hypot(x - BAY.x, z - BAY.z) < BAY.r + 0.05) continue;
          // не на трассе
          let dmin = 1e9;
          for (let j = 0; j < L; j += 8) dmin = Math.min(dmin, (tc[j].x - x) ** 2 + (tc[j].z - z) ** 2);
          if (dmin < (HALF_W + 0.25) ** 2) continue;
          const w = 0.5 + 0.5 * Math.sin(x * 1.3 + Math.sin(z * 0.7) * 1.6) * Math.cos(z * 1.1 - x * 0.35);
          const far = Math.hypot(x / 12, z / 7.5);
          S.setPoint(s, i, x, -0.06, z, 0.35 + w * 0.75, r() < 0.3 ? S.PAL.mint : S.PAL.white, (0.06 + w * 0.16) * (1 - far * 0.6));
          i++;
        }
        for (; i < m; i++) S.setPoint(s, i, 0, -0.06, 0, 0.3, S.PAL.white, 0);
        return s;
      } },
      // лагуна: круги-рябь
      { weight: 0.16, shape: (m) => {
        const s = S.createShape(m), r = rng(23);
        for (let i = 0; i < m; i++) {
          const k = Math.floor(r() * 8);
          const rad = (k + 0.6) * (BAY.r / 8.2) + r.gauss(0, 0.01);
          const a = r() * TAU;
          S.setPoint(s, i, BAY.x + Math.cos(a) * rad, -0.02, BAY.z + Math.sin(a) * rad, r.range(0.45, 0.85), r() < 0.6 ? S.PAL.white : S.PAL.mint, r.range(0.1, 0.22));
        }
        return s;
      } },
      // восьмёрка (только в «loop») или звёздная пыль над сценой
      { weight: 0.12, shape: (m) => {
        const s = S.createShape(m), r = rng(24);
        const p = new THREE.Vector3(), t = new THREE.Vector3();
        for (let i = 0; i < m; i++) {
          if (withLoop) {
            const u = r() * TAU;
            figureEight(u, LOOP, p, t);
            const off = r.gauss(0, 0.07);
            S.setPoint(s, i, p.x - t.z * off, 0.02 + Math.abs(r.gauss(0, 0.03)), p.z + t.x * off, r.range(0.5, 0.95), r() < 0.12 ? S.PAL.greenHi : r() < 0.5 ? S.PAL.mint : S.PAL.white, r.range(0.12, 0.3));
          } else {
            const [x, y, z] = r.inSphere(1);
            S.setPoint(s, i, x * 14, 2 + Math.abs(y) * 6, z * 9, r.range(0.4, 0.9), S.PAL.white, r.range(0.05, 0.16));
          }
        }
        return s;
      } },
    ];
    const s = S.combine(n, parts);
    s.meta.axis = 'y';
    this.shapes[key] = s;
    return s;
  }

  // ---------- Камера и фон ----------

  camera(state, step) {
    if (state === 'loop') {
      if (step >= 1) return { pos: [0.75, 2.5, 4.2], target: [0.45, 0.35, -1.3], fov: 46 };
      return { pos: [0.4, 8.9, 5.0], target: [0.35, 0, -0.75], fov: 45.5 };
    }
    // intro: вся трасса справа от колонки текста. Ширина сцены 16:9 (ядро само подгоняет fov под 4:3/16:10,
    // поэтому по горизонтали всегда видна именно она).
    const d = step >= 1 ? 19.3 : 20.4, fov = 36;
    const W = 2 * d * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 16 / 9;
    const sx = W * 0.262;
    const tx = SCENE_C[0] - sx + (step >= 1 ? 0.35 : 0), tz = SCENE_C[1] + 0.15;
    const el = THREE.MathUtils.degToRad(step >= 1 ? 70 : 66);
    return { pos: [tx, Math.sin(el) * d, tz + Math.cos(el) * d], target: [tx, 0, tz], fov };
  }

  background(state, step) {
    if (state === 'loop') return 'low';
    return 'none';
  }

  // ---------- Жизненный цикл ----------

  enter(o = {}) {
    this.state = o.state || 'intro';
    this.step = o.step ?? 0;
    this.ctx.engine.setFx({ scan: 0 }, 0.6); // на случай, если прошлый слайд оставил сканлайны
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.12, swirl: 0, size: 0.06, twinkle: 0.3, spring: 14, damping: 5.5 }, o.instant ? 0 : 1.2);
    const obj = p.object;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.ensureLabels();
    this.score = 0;
    this.shownScore = -1;
    this.applyState(o.instant, true);
    const r = super.enter(o);
    return r;
  }

  setState(state, o = {}) {
    this.state = state;
    this.step = o.step ?? 0;
    this.applyState(o.instant, false);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyState(o.instant, false);
  }

  ensureLabels() {
    if (this.lbl) return;
    this.lbl = {
      start: this.label({ html: '<span class="b5-tag3d">Старт</span>', position: [this.startPos.x, 0.2, this.startPos.z + 0.95], visible: false }),
      bonus: this.label({ html: '<span class="b5-tag3d is-accent">Бонусы</span>', position: [BAY.x + 1.75, 0.3, BAY.z + 0.05], anchor: 'left', visible: false }),
      finish: this.label({ html: '<span class="b5-finish3d">Финиш</span>', object: this.flagGroup, offset: [0, 1.62, 0], className: 'b5-finish-l', visible: false }),
    };
    this.pops = [];
    for (let i = 0; i < 6; i++) {
      this.pops.push(this.label({ html: '<span class="b5-pop">+100</span>', position: [0, 0, 0], offset: [0, 0.9, 0], visible: false }));
    }
  }

  applyState(instant, entering) {
    const loop = this.state === 'loop';
    const st = this.step;
    const p = this.particles;
    const wantLoopShape = loop || st >= 1;
    if (this.ownsParticles()) {
      const key = wantLoopShape ? 'loop' : 'plain';
      if (entering || this._shapeKey !== key) {
        p.morph(this.shape(wantLoopShape), { duration: instant ? 0.01 : (entering ? 2.2 : 1.6), stagger: entering ? 0.5 : 0.35, burst: entering ? 12 : 4 });
        this._shapeKey = key;
      }
    }
    this.tw(this.spotU.uPower, { value: loop ? (st >= 1 ? 0.55 : 0.3) : 0, duration: instant ? 0 : 1.6, ease: 'power2.inOut' });
    // режим лодки
    const mode = loop ? 'loop' : 'idle';
    if (mode !== this.mode) this.setMode(mode, instant ? 0 : (mode === 'loop' ? 1.8 : 1.3));
    else if (instant && mode === 'idle') this.setMode('idle', 0);
    // подсказка-восьмёрка (только в вопросе, на шаге ответа)
    const showHint = !loop && st >= 1;
    this.tw(this.hintU.uDraw, { value: showHint ? 1.02 : 0, duration: instant ? 0 : (showHint ? 1.6 : 0.5), ease: 'power2.inOut' });
    this.tw(this.hintU.uOpacity, { value: showHint ? 1 : 0, duration: instant ? 0 : 0.5 });
    if (showHint && !instant) this.flash = 1;
    // подписи (при входе — когда камера долетела, чтобы не «проплывали» по тексту слайда)
    this._lblCall?.kill();
    if (entering && !instant) {
      this.hideLabels();
      this._lblCall = this.delay(1.5, () => this.applyLabels());
    } else this.applyLabels();
  }

  hideLabels() {
    if (!this.lbl) return;
    Object.values(this.lbl).forEach((l) => l.hide());
    this.pops.forEach((q) => q.hide());
  }

  applyLabels() {
    const L = this.lbl;
    if (!L) return;
    const loop = this.state === 'loop';
    !loop ? L.start.show() : L.start.hide();
    !loop ? L.bonus.show() : L.bonus.hide();
    L.finish.show();
    L.finish.el.classList.toggle('is-loop', loop);
    if (!loop) this.pops.forEach((q) => q.hide());
  }

  setMode(mode, dur) {
    this.blendFrom.copy(this.boat.object.position);
    this.mode = mode;
    if (mode === 'loop') {
      this.score = 0;
      this.u = -Math.PI * 0.62;
      this.bonuses.forEach((b) => { b.on = true; b.appear = 1; b.timer = 0; });
    }
    if (dur <= 0) {
      this.blendK = 1;
      if (mode === 'idle') {
        this.boat.place(this.startPos, this.startTan);
        this.boat.setHeading(Math.atan2(this.startTan.x, this.startTan.z));
        this.boat.resetWake();
      } else {
        figureEight(this.u, LOOP, this._pos, this._tan);
        this.boat.resetWake();
        this.boat.place(this._pos, this._tan);
        this.boat.setHeading(Math.atan2(this._tan.x, this._tan.z));
      }
    } else {
      this.blendK = 0;
      this.blendDur = dur;
    }
  }

  exit(o = {}) {
    this._lblCall?.kill();
    this.hideLabels();
    return super.exit(o);
  }

  // ---------- Кадр ----------

  update(dt, t) {
    dt = Math.min(dt, 0.05);
    const boat = this.boat;
    // лодка
    if (this.mode === 'loop') this.u += dt * LOOP_SPEED;
    const target = this._pos, tan = this._tan;
    if (this.mode === 'loop') figureEight(this.u, LOOP, target, tan);
    else { target.copy(this.startPos); tan.copy(this.startTan); }
    if (this.blendK < 1) {
      this.blendK = Math.min(1, this.blendK + dt / this.blendDur);
      const k = this.blendK * this.blendK * (3 - 2 * this.blendK);
      this._tmp.copy(this.blendFrom).lerp(target, k);
      boat.place(this._tmp, this.blendK > 0.85 ? tan : null);
    } else {
      boat.place(target, tan);
    }
    boat.update(dt, t);

    // бонусы
    const bp = boat.object.position;
    for (const b of this.bonuses) {
      if (b.on) {
        b.appear = Math.min(1, b.appear + dt * 2.2);
        if (this.mode === 'loop' && this.blendK > 0.6) {
          const dx = bp.x - b.pos.x, dz = bp.z - b.pos.z;
          if (dx * dx + dz * dz < 0.36 * 0.36) this.collect(b);
        }
      } else {
        b.timer -= dt;
        if (b.timer <= 0) { b.on = true; b.appear = 0; }
      }
      const a = b.on ? b.appear : 0;
      // «пружинное» появление
      const s = b.on ? (a < 1 ? 1 + Math.sin(a * Math.PI) * 0.35 * (1 - a) - (1 - a) * (1 - a) : 1) : 0;
      const pulse = 1 + 0.06 * Math.sin(t * 4 + b.phase) + this.flash * 0.5;
      b.body.scale.setScalar(Math.max(0.001, s * pulse));
      b.halo.scale.setScalar(Math.max(0.001, (b.on ? 0.6 + 0.4 * a : 0.25) * pulse));
      b.gem.rotation.y = t * 2.2 + b.phase;
      b.gem.position.y = 0.38 + Math.sin(t * 2.6 + b.phase) * 0.05;
      // вспышка при сборе
      if (b.burstT < 1) {
        b.burstT = Math.min(1, b.burstT + dt * 1.8);
        const k = b.burstT;
        b.burst.scale.setScalar(1 + k * 3.2);
        b.burst.material.opacity = (1 - k) * (1 - k) * this.opacity;
      } else if (b.burst.material.opacity !== 0) b.burst.material.opacity = 0;
    }
    this.flash = Math.max(0, this.flash - dt * 0.8);

    // флаг и маячок «Финиш»: одиноко мигает
    const blink = (t % 1.1) < 0.6 ? 1 : 0.25;
    this.flagUniforms.uTime.value = t;
    this.flagUniforms.uBlink.value = blink;
    this.beaconU.uPower.value = 0.35 + 0.65 * blink;
    const rk = (t % 1.1) / 1.1;
    this.flagRing.scale.setScalar(1 + rk * 2.2);
    this.flagRing.material.opacity = (1 - rk) * 0.9 * this.opacity;
    if (this.lbl && this._blink !== blink) {
      this._blink = blink;
      this.lbl.finish.inner.style.opacity = blink > 0.5 ? '1' : '0.3';
    }
    this.hintU.uTime.value = t;
    this.updateSparks(dt);

    // счёт — в HTML слайда
    if (this.state === 'loop' && this.shownScore !== this.score) this.renderScore();
  }

  collect(b) {
    this.burst(b.pos);
    b.on = false;
    b.timer = RESPAWN;
    b.burstT = 0;
    this.score += 100;
    // «+100» над бонусом (не во время ухода со слайда: подписи уже спрятаны)
    if (!this.active || !this.pops) return;
    const lab = this.pops[this.popIdx++ % this.pops.length];
    lab.setPosition([b.pos.x, b.pos.y, b.pos.z]);
    lab.show();
    const span = lab.inner.firstElementChild;
    if (span) { span.classList.remove('is-pop'); void span.offsetWidth; span.classList.add('is-pop'); }
  }

  renderScore() {
    const el = this.ctx.deck?.currentEl;
    const node = el?.querySelector('[data-b5-score]');
    if (!node) return;
    this.shownScore = this.score;
    node.textContent = formatNumber(this.score);
    node.classList.remove('is-bump'); void node.offsetWidth; node.classList.add('is-bump');
  }
}
