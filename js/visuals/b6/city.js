// Ночной город (бонус-вопрос): процедурные дома с окнами-огнями, улицы с фонарями, машины,
// вышки связи, над городом — «сеть» из частиц. Шаг 1 — интернет пропал: сеть рассыпается,
// огни мерцают и гаснут кварталами.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { HASH } from '../../core/glsl.js';
import { rng } from '../../core/utils.js';
import { orderShape, orbitPose, fitFov, yieldFrame } from './util.js';

const NB = 7;                 // кварталов по стороне
const BLOCK = 2.1, STREET = 0.55, PITCH = BLOCK + STREET;
const EXT = NB * PITCH;       // размер города
const OUT_DUR = 5.5;          // за сколько секунд гаснет весь город
const CITY_C = [0, 0, 0];
// облёт камеры: начальный азимут и скорость (град, град/с), наклон, расстояние, сдвиг города вправо/вниз (доли кадра)
const ORBIT = { yaw0: 28, speed: 2.2, pitch: 36, dist: 23, offX: 0.3, offY: -0.04 };

const BUILD_VERT = /* glsl */ `
attribute float aSeed;
attribute float aOrder;
varying vec3 vLocal;
varying vec3 vNo;
varying vec3 vScale;
varying vec3 vWN;
varying vec3 vV;
varying float vSeed;
varying float vOrder;
void main() {
  vLocal = position;
  vNo = normal;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vSeed = aSeed;
  vOrder = aOrder;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BUILD_FRAG = /* glsl */ `
uniform float uTime, uOut, uDur, uOpacity;
varying vec3 vLocal;
varying vec3 vNo;
varying vec3 vScale;
varying vec3 vWN;
varying vec3 vV;
varying float vSeed;
varying float vOrder;
${HASH}
void main() {
  vec3 n = vNo;
  float wall = 1.0 - step(0.5, abs(n.y));
  vec2 wc = abs(n.x) > 0.5 ? vec2((vLocal.z + 0.5) * vScale.z, vLocal.y * vScale.y) : vec2((vLocal.x + 0.5) * vScale.x, vLocal.y * vScale.y);
  vec2 cell = vec2(0.16, 0.2);
  vec2 id = floor(wc / cell);
  vec2 f = fract(wc / cell);
  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78) * step(0.6, wc.y);
  float h = hash12(id + vec2(vSeed * 91.7, n.x * 13.0 + n.z * 7.0 + 3.0));
  float lit = step(0.45, h);
  float tOut = uOut < 0.0 ? -1.0 : uOut - vOrder * uDur;
  float on = 1.0;
  if (tOut >= 0.0) on = tOut < 0.7 ? step(0.55, hash12(vec2(floor(uTime * 16.0), vSeed * 37.0 + id.x * 0.3))) * (1.0 - tOut / 0.7 * 0.5) : 0.0;
  float tv = 0.88 + 0.12 * sin(uTime * (3.0 + h * 9.0) + h * 40.0);
  vec3 warm = mix(vec3(1.3, 1.02, 0.66), vec3(0.75, 1.4, 0.82), step(0.82, fract(h * 7.31)));
  float emer = step(0.992, fract(h * 3.7)) * (1.0 - on);
  float facing = max(dot(normalize(vWN), normalize(vV)), 0.0);
  vec3 col = vec3(0.008, 0.011, 0.01) * (0.6 + 0.7 * facing) + vec3(0.0, 0.035, 0.015) * pow(clamp(1.0 - facing, 0.0, 1.0), 3.0) * on;
  col += win * wall * (warm * lit * on * tv * (0.75 + 0.5 * fract(h * 13.1)) + vec3(0.9, 0.12, 0.06) * emer);
  // крыша: редкие огоньки
  float roof = step(0.5, n.y);
  col += roof * step(0.97, hash12(floor(vLocal.xz * 6.0) + vSeed)) * vec3(0.6, 1.2, 0.6) * on * 0.6;
  gl_FragColor = vec4(col, uOpacity);
}
`;

const GROUND_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const GROUND_FRAG = /* glsl */ `
uniform sampler2D tOrder;
uniform float uTime, uOut, uDur, uOpacity, uExt, uPitch, uBlock, uNB;
varying vec3 vW;
${HASH}
float orderAt(vec2 p) {
  vec2 b = clamp(floor((p + uExt * 0.5) / uPitch), 0.0, uNB - 1.0);
  return texture2D(tOrder, (b + 0.5) / uNB).r;
}
void main() {
  vec2 p = vW.xz;
  vec2 q = mod(p + uExt * 0.5, uPitch);
  float inCity = step(abs(p.x), uExt * 0.5) * step(abs(p.y), uExt * 0.5);
  // улицы — промежутки между кварталами
  float sx = step(uBlock, q.x), sz = step(uBlock, q.y);
  float street = max(sx, sz) * inCity;
  float ord = orderAt(p);
  float tOut = uOut < 0.0 ? -1.0 : uOut - ord * uDur;
  float on = tOut < 0.0 ? 1.0 : (tOut < 0.7 ? step(0.5, hash12(vec2(floor(uTime * 14.0), ord * 99.0))) * 0.8 : 0.0);
  // фонари вдоль улиц — точки
  vec2 lp = vec2(p.x * 2.2, p.y * 2.2);
  vec2 cell = fract(lp) - 0.5;
  float dotm = 1.0 - smoothstep(0.12, 0.2, length(cell));
  float lampRow = max(sx * step(abs(q.x - uBlock - (uPitch - uBlock) * 0.5), 0.06), sz * step(abs(q.y - uBlock - (uPitch - uBlock) * 0.5), 0.06));
  float fade = 1.0 - smoothstep(uExt * 0.42, uExt * 0.75, length(p));
  vec3 col = vec3(0.004, 0.007, 0.005) + vec3(0.02, 0.03, 0.022) * street;
  col += vec3(0.03, 0.08, 0.04) * street * on;
  col += dotm * street * vec3(1.4, 1.15, 0.7) * 0.9 * on * step(0.5, hash12(floor(lp)));
  // мягкое свечение улиц вокруг (халфтон-подсветка)
  col *= fade;
  gl_FragColor = vec4(col, uOpacity);
}
`;

const CAR_VERT = /* glsl */ `
attribute vec4 aCar;   // ось (0 — x, 1 — z), координата улицы, фаза, скорость (со знаком)
uniform sampler2D tOrder;
uniform float uTime, uOut, uDur, uScale, uOpacity, uExt, uPitch, uNB;
varying vec3 vCol;
varying float vA;
void main() {
  float s = fract(aCar.z + uTime * aCar.w / uExt);
  float along = -uExt * 0.5 + s * uExt;
  vec3 p = aCar.x < 0.5 ? vec3(along, 0.06, aCar.y) : vec3(aCar.y, 0.06, along);
  vec2 b = clamp(floor((p.xz + uExt * 0.5) / uPitch), 0.0, uNB - 1.0);
  float ord = texture2D(tOrder, (b + 0.5) / uNB).r;
  float tOut = uOut < 0.0 ? -1.0 : uOut - ord * uDur;
  float on = tOut < 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 0.9, tOut);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vCol = aCar.w > 0.0 ? vec3(1.6, 1.5, 1.25) : vec3(1.5, 0.9, 0.35);
  vA = on * uOpacity * smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.96, 1.0, s));
  gl_PointSize = clamp(0.9 * uScale / max(0.1, -mv.z), 0.0, 24.0);
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const DOT_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vCol, (exp(-d * d * 6.0) + (1.0 - d) * 0.2) * vA);
}
`;

export default class City extends Visual {
  static transition = 'zoom';

  async init() {
    const r = rng(2024);
    this.city = new THREE.Group();
    this.city.position.set(...CITY_C);
    this.root.add(this.city);

    // Порядок отключения кварталов: волна от эпицентра + разброс
    const epi = [1.6, 2.4];
    const ord = new Float32Array(NB * NB);
    let maxD = 0;
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) maxD = Math.max(maxD, Math.hypot(i - epi[0], j - epi[1]));
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) ord[j * NB + i] = Math.min(1, (Math.hypot(i - epi[0], j - epi[1]) / maxD) * 0.82 + r() * 0.18);
    this.order = ord;
    const data = new Uint8Array(NB * NB * 4);
    for (let q = 0; q < NB * NB; q++) { data[q * 4] = Math.round(ord[q] * 255); data[q * 4 + 3] = 255; }
    this.orderTex = new THREE.DataTexture(data, NB, NB, THREE.RGBAFormat);
    this.orderTex.needsUpdate = true;
    // точное значение, как в текстуре
    for (let q = 0; q < NB * NB; q++) ord[q] = data[q * 4] / 255;

    this.u = {
      uTime: { value: 0 }, uOut: { value: -1 }, uDur: { value: OUT_DUR }, uOpacity: { value: 1 },
      uExt: { value: EXT }, uPitch: { value: PITCH }, uBlock: { value: BLOCK }, uNB: { value: NB },
      tOrder: { value: this.orderTex }, uScale: { value: 300 },
    };

    // Дома
    const lots = [];
    for (let i = 0; i < NB; i++) {
      for (let j = 0; j < NB; j++) {
        const cx = (i - (NB - 1) / 2) * PITCH, cz = (j - (NB - 1) / 2) * PITCH;
        const nx = r() < 0.5 ? 2 : 3, nz = r() < 0.5 ? 2 : 3;
        const d = Math.hypot(cx - 0.6, cz + 0.4);
        const down = 1 + 3.2 * Math.exp(-(d * d) / 22);
        for (let a = 0; a < nx; a++) {
          for (let b = 0; b < nz; b++) {
            if (r() < 0.08) continue; // двор/парк
            const w = BLOCK / nx, dd = BLOCK / nz;
            const x = cx - BLOCK / 2 + w * (a + 0.5), z = cz - BLOCK / 2 + dd * (b + 0.5);
            let h = (0.3 + r() * 0.75) * down;
            if (r() < 0.06) h *= 1.7;
            lots.push({ x, z, w: w * (0.78 + r() * 0.12), d: dd * (0.78 + r() * 0.12), h, ord: ord[j * NB + i], seed: r() });
          }
        }
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const seedA = new Float32Array(lots.length), ordA = new Float32Array(lots.length);
    lots.forEach((l, k) => { seedA[k] = l.seed; ordA[k] = l.ord; });
    box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedA, 1));
    box.setAttribute('aOrder', new THREE.InstancedBufferAttribute(ordA, 1));
    this.buildings = new THREE.InstancedMesh(box, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: BUILD_VERT, fragmentShader: BUILD_FRAG, transparent: true,
    }), lots.length);
    const m = new THREE.Matrix4();
    lots.forEach((l, k) => { m.makeScale(l.w, l.h, l.d).setPosition(l.x, 0, l.z); this.buildings.setMatrixAt(k, m); });
    this.buildings.frustumCulled = false;
    this.city.add(this.buildings);
    this.lots = lots;

    // Земля с улицами и фонарями
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(EXT * 2.4, EXT * 2.4), new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, transparent: true,
    }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.01;
    this.ground.renderOrder = -2;
    this.city.add(this.ground);

    // Машины
    const NC = 190;
    const cars = new Float32Array(NC * 4);
    for (let k = 0; k < NC; k++) {
      const axis = r() < 0.5 ? 0 : 1;
      const line = Math.floor(r() * (NB + 1));
      const coord = -EXT / 2 + line * PITCH - STREET / 2 + (r() < 0.5 ? -0.1 : 0.1) + (line === 0 ? STREET / 2 : 0);
      const dir = r() < 0.5 ? -1 : 1;
      cars[k * 4] = axis; cars[k * 4 + 1] = Math.max(-EXT / 2 + 0.1, Math.min(EXT / 2 - 0.1, coord));
      cars[k * 4 + 2] = r(); cars[k * 4 + 3] = dir * (0.9 + r() * 1.3);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NC * 3), 3));
    cg.setAttribute('aCar', new THREE.BufferAttribute(cars, 4));
    this.cars = new THREE.Points(cg, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: CAR_VERT, fragmentShader: DOT_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.cars.frustumCulled = false;
    this.cars.renderOrder = 12;
    this.city.add(this.cars);

    // Вышки связи с маяками и волнами сигнала
    this.towers = [];
    const towerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9aa59a').multiplyScalar(0.2), transparent: true });
    const ringG = new THREE.TorusGeometry(1, 0.025, 6, 96);
    [[-4.6, -3.3], [3.9, 4.5], [5.4, -4.2]].forEach(([x, z], k) => {
      const h = 6.2 + k * 0.8;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.13, h, 6), towerMat);
      mast.position.set(x, h / 2, z);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.2), transparent: true }));
      beacon.material.userData.noFade = true;
      beacon.position.set(x, h + 0.08, z);
      const rings = [0, 1, 2].map(() => {
        const ring = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.material.userData.noFade = true;
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, h - 0.3, z);
        this.city.add(ring);
        return ring;
      });
      this.city.add(mast, beacon);
      this.towers.push({ x, z, h, beacon, rings, ord: ord[Math.min(NB - 1, Math.max(0, Math.floor((z + EXT / 2) / PITCH))) * NB + Math.min(NB - 1, Math.max(0, Math.floor((x + EXT / 2) / PITCH)))] });
    });

    await yieldFrame();
    await this.buildShapes();
    this.k = { yaw: 0 };
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const r = rng(8);
    // Сеть: купол из точек по параллелям и меридианам + «пакеты» данных
    const s = S.createShape(n);
    const keys = new Float32Array(n);
    const R = EXT * 0.62;
    const epi = new THREE.Vector3((1.6 - 3) * PITCH, 0, (2.4 - 3) * PITCH);
    let i = 0;
    const nLines = Math.floor(n * 0.62);
    for (; i < nLines; i++) {
      const meridian = r() < 0.5;
      let th, ph;
      if (meridian) { th = Math.floor(r() * 24) / 24 * Math.PI * 2; ph = r() * Math.PI * 0.5; } else { ph = (Math.floor(r() * 7) + 1) / 8 * Math.PI * 0.5; th = r() * Math.PI * 2; }
      const x = Math.cos(th) * Math.cos(ph) * R, y = Math.sin(ph) * R * 0.55 + 1.2, z = Math.sin(th) * Math.cos(ph) * R;
      S.setPoint(s, i, x + r.gauss(0, 0.03), y + r.gauss(0, 0.03), z + r.gauss(0, 0.03), r.range(0.4, 0.9), r() < 0.7 ? S.PAL.green : S.PAL.mint, r.range(0.12, 0.32));
      keys[i] = Math.hypot(x - epi.x, z - epi.z) / (R * 1.6);
    }
    // узлы сети — яркие точки на пересечениях
    const nNodes = Math.floor(n * 0.08);
    for (let e = i + nNodes; i < e; i++) {
      const th = Math.floor(r() * 24) / 24 * Math.PI * 2, ph = (Math.floor(r() * 7) + 1) / 8 * Math.PI * 0.5;
      const x = Math.cos(th) * Math.cos(ph) * R, y = Math.sin(ph) * R * 0.55 + 1.2, z = Math.sin(th) * Math.cos(ph) * R;
      S.setPoint(s, i, x + r.gauss(0, 0.07), y + r.gauss(0, 0.07), z + r.gauss(0, 0.07), r.range(0.8, 1.6), r() < 0.5 ? S.PAL.bright : S.PAL.greenHi, r.range(0.3, 0.7));
      keys[i] = Math.hypot(x - epi.x, z - epi.z) / (R * 1.6);
    }
    // далёкие звёзды
    for (; i < n; i++) {
      const [x, y, z] = r.onSphere(r.range(30, 60));
      S.setPoint(s, i, x, Math.abs(y) * 0.6 + 4, z, r.range(0.4, 1), S.PAL.white, r.range(0.05, 0.2));
      keys[i] = r();
    }
    await yieldFrame();
    this.shapeNet = orderShape(s, keys);
    await yieldFrame();
    // Сеть рассыпалась: тусклая пыль оседает на город (те же частицы)
    const d = S.createShape(n);
    const P = this.shapeNet.positions, C = this.shapeNet.colors;
    for (let q = 0; q < n; q++) {
      const j = q * 4;
      if (P[j + 1] > 3.9 && Math.hypot(P[j], P[j + 2]) > 26) {
        d.positions.set(P.subarray(j, j + 4), j); d.colors.set(C.subarray(j, j + 4), j);
        continue;
      }
      const x = P[j] * 0.95 + r.gauss(0, 0.5), z = P[j + 2] * 0.95 + r.gauss(0, 0.5);
      S.setPoint(d, q, x, 0.08 + Math.pow(r(), 3) * 2.2, z, r.range(0.3, 0.7), r() < 0.6 ? S.PAL.dim : S.PAL.grey, r.range(0.02, 0.06));
    }
    d.meta.equalized = false;
    this.shapeDust = d;
  }

  /** Облёт: город справа от текста, медленно поворачивается (yaw растёт со временем t). */
  pose(t) {
    return orbitPose(CITY_C, ORBIT.yaw0 + t * ORBIT.speed, ORBIT.pitch, ORBIT.dist, ORBIT.offX, ORBIT.offY, 40, false);
  }

  /** То же, что pose(t), но без аллокаций (для покадрового «водителя» камеры). */
  poseInto(t, pos, target) {
    const yaw = THREE.MathUtils.degToRad(ORBIT.yaw0 + t * ORBIT.speed), pitch = THREE.MathUtils.degToRad(ORBIT.pitch);
    const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
    // right = normalize(fwd × Y), fwd = −dir; up = right × fwd
    let rx = dz, rz = -dx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = rz * dy, uy = rx * dz - rz * dx, uz = -rx * dy;
    const visH = 2 * ORBIT.dist * Math.tan(THREE.MathUtils.degToRad(20)), visW = visH * 16 / 9;
    const ox = ORBIT.offX * visW, oy = ORBIT.offY * visH;
    target.set(CITY_C[0] - rx * ox - ux * oy, CITY_C[1] - uy * oy, CITY_C[2] - rz * ox - uz * oy);
    pos.set(target.x + dx * ORBIT.dist, target.y + dy * ORBIT.dist, target.z + dz * ORBIT.dist);
  }

  // Поза для 16:9 (ядро подгоняет её под 4:3 / 16:10); облёт камеры — drive() в enter.
  camera(state, step) {
    const p = this.pose(0);
    return { pos: p.pos, target: p.target, fov: 40 };
  }

  background(state, step) { return step >= 1 ? 'low' : 'bottom'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    const out = this.step >= 1;
    p.setParams({ noise: 0.18, swirl: 0.02, swirlR0: 0.8, size: 0.058, twinkle: 0.35, spring: 16, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    p.morph(out ? this.shapeDust : this.shapeNet, { duration: o.instant ? 0.01 : 2.4, stagger: 0.5, burst: 12 });
    const obj = p.object;
    this.tw(obj.position, { x: CITY_C[0], y: CITY_C[1], z: CITY_C[2], duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.u.uOut.value = out ? OUT_DUR + 2 : -1;
    this.tStart = this.ctx.time;
    this.k.yaw = 0;
    this.drive((dt, t) => this.driverPose(t), o.instant ? 0.01 : 2.2);
    return super.enter(o);
  }

  driverPose(t) {
    const d = this._dp || (this._dp = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 });
    this.poseInto(t - this.tStart, d.pos, d.target);
    // водителя камеры ядро не подгоняет под экраны уже 16:9 — расширяем угол сами
    const a = this.ctx.camera.aspect;
    if (a !== this._fitA) { this._fitA = a; this._fitFov = fitFov(40, a); }
    d.fov = this._fitFov;
    return d;
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    this._tl?.kill();
    const tl = this._tl = this.tl();
    const p = this.particles;
    if (step >= 1 && prev === 0) {
      this.u.uOut.value = 0;
      tl.to(this.u.uOut, { value: OUT_DUR + 2, duration: OUT_DUR + 2, ease: 'none' }, 0);
      if (this.ownsParticles()) {
        p.explode(2.5, [0, 3, 0]);
        p.morph(this.shapeDust, { duration: OUT_DUR / 0.85, stagger: 0.85, burst: 10, ease: 'none' });
      }
      this.ctx.engine.pulse({ aberration: 1.0, glitch: 0.35 }, 0.9);
      this.ctx.rig.shake(0.08, 0.6);
    } else if (step === 0 && prev >= 1) {
      // свет возвращается кварталами в обратном порядке
      const cur = Math.max(0, this.u.uOut.value);
      tl.to(this.u.uOut, { value: 0, duration: Math.min(2.2, 0.3 + cur * 0.3), ease: 'power1.in' }, 0)
        .set(this.u.uOut, { value: -1 });
      if (this.ownsParticles()) p.morph(this.shapeNet, { duration: 2.0, stagger: 0.5, burst: 10 });
    }
  }

  exit(o = {}) {
    this._tl?.kill();
    this.drive(null);
    this.particles.setParams({ swirl: 0 }, 0.8);
    return super.exit(o);
  }

  update(dt, t) {
    const u = this.u;
    u.uTime.value = t;
    const e = this.ctx.engine;
    u.uScale.value = (e.height * e.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5)) * 0.06;
    const out = u.uOut.value;
    // вышки: маяки мигают, волны сигнала расходятся (пока есть сеть)
    for (let k = 0; k < this.towers.length; k++) {
      const tw = this.towers[k];
      const tOut = out < 0 ? -1 : out - tw.ord * OUT_DUR;
      const alive = tOut < 0 ? 1 : Math.max(0, 1 - tOut / 0.6);
      tw.beacon.material.opacity = (0.35 + 0.65 * (Math.sin(t * 3 + k * 2) > 0.2 ? 1 : 0)) * alive * this.opacity;
      for (let q = 0; q < tw.rings.length; q++) {
        const ring = tw.rings[q];
        const ph = (t * 0.45 + q / 3 + k * 0.17) % 1;
        ring.scale.setScalar(0.3 + ph * 3.6);
        ring.material.opacity = (1 - ph) * (1 - ph) * 0.55 * alive * this.opacity;
      }
    }
  }
}
