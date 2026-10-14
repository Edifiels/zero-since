// Гонка дыр и заплат: колонна «найдено ИИ» из 10 080 кубиков стремительно растёт,
// колонна «исправлено» ползёт у самого основания (кубик за кубиком).
// Шаг 1 — «узкое место»: над колонной заплат — воронка-вихрь из частиц; в неё летят найденные дыры,
// а из узкого горлышка по одной капают зелёные заплаты.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, formatNumber } from '../../core/utils.js';
import { Sparks, yieldFrame } from './util.js';

const FLOOR = -2.9;
const A_X = 2.4, B_X = 6.0;
const N = 12;                 // кубиков в ряду (сечение N×N)
const PITCH = 0.1, CUBE = 0.078;
const LAYERS = 70;            // 70 × 144 = 10 080
const A_TOP = FLOOR + LAYERS * PITCH;
const NECK_Y = 1.05, MOUTH_Y = 4.05, MOUTH_R = 1.55, NECK_R = 0.16;
const GROW = 3.6;             // секунды роста колонны дыр

const CUBE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying float vTop;
uniform float uTopY;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vCol = instanceColor;
  vTop = clamp(1.0 - (uTopY - wp.y) / 0.6, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CUBE_FRAG = /* glsl */ `
uniform float uOpacity, uGlow;
uniform vec3 uKey;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying float vTop;
void main() {
  vec3 n = normalize(vN);
  float lam = max(dot(n, uKey), 0.0);
  float rim = pow(clamp(1.0 - dot(n, normalize(vV)), 0.0, 1.0), 2.0);
  vec3 col = vCol * (0.32 + 0.5 * lam + 0.35 * rim) + vCol * vTop * uGlow;
  gl_FragColor = vec4(col, uOpacity);
}
`;

// «Дыры», летящие в воронку: квадратичная кривая Безье P0 → C → P2, вращение — в шейдере
const FLY_VERT = /* glsl */ `
attribute vec4 aFly;   // x — фаза, yzw — смещение от траектории
attribute float aRot;
uniform float uTime, uVis;
uniform vec3 uP0, uC, uP2;
void main() {
  float s = fract(uTime * 0.32 + aFly.x);
  float a = 1.0 - s;
  vec3 c = a * a * uP0 + 2.0 * a * s * uC + s * s * uP2 + aFly.yzw;
  float vis = uVis * min(1.0, s * 8.0) * min(1.0, (1.0 - s) * 6.0);
  float rx = aRot + uTime * 2.0, ry = aRot * 0.7 + uTime * 1.6;
  mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cos(rx), sin(rx), 0.0, -sin(rx), cos(rx));
  mat3 Ry = mat3(cos(ry), 0.0, -sin(ry), 0.0, 1.0, 0.0, sin(ry), 0.0, cos(ry));
  vec3 p = c + Ry * (Rx * (position * vis));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  if (vis < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FLY_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;

export default class Patches extends Visual {
  static transition = 'glitch';

  async init() {
    const r = rng(77);
    this.u = { uOpacity: { value: 1 }, uGlow: { value: 1.4 }, uKey: { value: new THREE.Vector3(0.4, 0.75, 0.55).normalize() }, uTopY: { value: FLOOR } };
    const mkMat = (u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: CUBE_VERT, fragmentShader: CUBE_FRAG, transparent: true });
    const box = new THREE.BoxGeometry(CUBE, CUBE, CUBE);

    // Колонна «найдено ИИ»: слои снизу вверх, внутри слоя — случайный порядок
    const total = LAYERS * N * N;
    this.colA = new THREE.InstancedMesh(box, mkMat(this.u), total);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let k = 0;
    for (let l = 0; l < LAYERS; l++) {
      const cells = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) cells.push([i, j]);
      for (let q = cells.length - 1; q > 0; q--) { const w = Math.floor(r() * (q + 1)); [cells[q], cells[w]] = [cells[w], cells[q]]; }
      for (const [i, j] of cells) {
        m.makeTranslation(A_X + (i - (N - 1) / 2) * PITCH, FLOOR + PITCH * 0.5 + l * PITCH, (j - (N - 1) / 2) * PITCH);
        this.colA.setMatrixAt(k, m);
        const h = r();
        c.setRGB(0.95, 0.06 + h * 0.1, 0.04 + h * 0.03).multiplyScalar(0.7 + h * 0.45);
        if (h > 0.9) c.setRGB(1.6, 0.42, 0.16);
        if (h > 0.975) c.setRGB(1.5, 1.35, 1.2);
        this.colA.setColorAt(k, c);
        k++;
      }
    }
    this.colA.count = 0;
    this.colA.frustumCulled = false;
    this.root.add(this.colA);
    // тёмно-красная сердцевина колонны: в щелях между кубиками не просвечивает фон
    // (иначе на уровне глаз камеры по колонне шла тёмная «трещина»)
    const coreG = new THREE.BoxGeometry(N * PITCH - 0.06, 1, N * PITCH - 0.06);
    coreG.translate(0, 0.5, 0);
    this.core = new THREE.Mesh(coreG, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.012, 0.008), transparent: true }));
    this.core.position.set(A_X, FLOOR, 0);
    this.core.scale.y = 0.001;
    this.core.visible = false;
    this.root.add(this.core);

    // Колонна «исправлено»
    this.uB = { uOpacity: { value: 1 }, uGlow: { value: 1.0 }, uKey: this.u.uKey, uTopY: { value: FLOOR } };
    const totalB = N * N * 3;
    this.colB = new THREE.InstancedMesh(box, mkMat(this.uB), totalB);
    k = 0;
    for (let l = 0; l < 3; l++) {
      const cells = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) cells.push([i, j]);
      // заполнение от центра к краям — «ползёт»
      cells.sort((p, q) => Math.hypot(p[0] - 5.5, p[1] - 5.5) - Math.hypot(q[0] - 5.5, q[1] - 5.5) + (r() - 0.5) * 1.5);
      for (const [i, j] of cells) {
        m.makeTranslation(B_X + (i - (N - 1) / 2) * PITCH, FLOOR + PITCH * 0.5 + l * PITCH, (j - (N - 1) / 2) * PITCH);
        this.colB.setMatrixAt(k, m);
        c.setRGB(0.1, 1.15 + r() * 0.35, 0.18);
        this.colB.setColorAt(k, c);
        k++;
      }
    }
    this.colB.count = 0;
    this.colB.frustumCulled = false;
    this.root.add(this.colB);
    this.bTargets = [];
    for (let q = 0; q < totalB; q++) { this.colB.getMatrixAt(q, m); this.bTargets.push(new THREE.Vector3().setFromMatrixPosition(m)); }

    // «Пол»: тонкие светящиеся квадраты-основания
    const baseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00e000').multiplyScalar(0.9), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const plate = (x, color) => {
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(N * PITCH + 0.12, 0.02, N * PITCH + 0.12));
      const l = new THREE.LineSegments(g, baseMat.clone());
      l.material.color.copy(color);
      l.position.set(x, FLOOR, 0);
      this.root.add(l);
      return l;
    };
    plate(A_X, new THREE.Color('#ff3b30').multiplyScalar(1.4));
    plate(B_X, new THREE.Color('#00ff00').multiplyScalar(1.2));

    // Летящие в воронку «дыры» и капающие «заплаты»
    // полёт считается в вершинном шейдере (без покадровой перезаливки instanceMatrix)
    const NF = 48;
    const flyBox = new THREE.BoxGeometry(CUBE * 1.15, CUBE * 1.15, CUBE * 1.15);
    const flyG = new THREE.InstancedBufferGeometry();
    flyG.index = flyBox.index;
    flyG.setAttribute('position', flyBox.getAttribute('position'));
    const aFly = new Float32Array(NF * 4), aRot = new Float32Array(NF);
    for (let i = 0; i < NF; i++) {
      aFly.set([i / NF + r() * 0.02, (r() - 0.5) * 0.5, (r() - 0.5) * 0.4, (r() - 0.5) * 0.6], i * 4);
      aRot[i] = r() * 6;
    }
    flyG.setAttribute('aFly', new THREE.InstancedBufferAttribute(aFly, 4));
    flyG.setAttribute('aRot', new THREE.InstancedBufferAttribute(aRot, 1));
    flyG.instanceCount = NF;
    const p0x = A_X, p0y = A_TOP + 0.1, p2x = B_X - MOUTH_R * 0.55, p2y = MOUTH_Y + 0.1;
    this.uFly = {
      uTime: { value: 0 }, uVis: { value: 0 }, uOpacity: { value: 1 },
      uColor: { value: new THREE.Color('#ff3b30').multiplyScalar(1.6) },
      uP0: { value: new THREE.Vector3(p0x, p0y, 0) },
      uC: { value: new THREE.Vector3((p0x + p2x) / 2, Math.max(p0y, p2y) + 1.4, 0) },
      uP2: { value: new THREE.Vector3(p2x, p2y, 0) },
    };
    this.fly = new THREE.Mesh(flyG, new THREE.ShaderMaterial({ uniforms: this.uFly, vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, transparent: true }));
    this.fly.frustumCulled = false;
    this.fly.visible = false;
    this.root.add(this.fly);
    this.drop = new THREE.Mesh(new THREE.BoxGeometry(CUBE * 1.3, CUBE * 1.3, CUBE * 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.8), transparent: true }));
    this.drop.visible = false;
    this.root.add(this.drop);

    // Искры с вершины колонны дыр
    this.sparks = new Sparks(500, { gravity: -2.5, drag: 1.2, soft: 0 });
    this.root.add(this.sparks.object);

    await yieldFrame();
    this.buildShapes();
    this.k = { grow: 0, b: 0, funnel: 0 };
    this.dripT = 0;
  }

  buildShapes() {
    const n = this.ctx.particles.count;
    // облако стоит на оси воронки (над колонной заплат) — вихрь вращается вокруг неё
    const ox = B_X;
    // шаг 0: халфтон-пол + лёгкая пыль
    this.shapeFloor = S.combine(n, [
      { weight: 0.55, shape: (m) => floorDots(m), position: [(A_X + B_X) / 2 - ox, FLOOR - 0.02, 0], rotation: [-Math.PI / 2, 0, 0] },
      { weight: 0.45, shape: (m) => S.dust(m, { radius: 30, inner: 7, alpha: 0.2, size: 0.7 }) },
    ]);
    // шаг 1: воронка-вихрь
    const r = rng(91);
    const s = S.createShape(n);
    let i = 0;
    const nWall = Math.floor(n * 0.24), nPile = Math.floor(n * 0.28), nStream = Math.floor(n * 0.05), nTop = Math.floor(n * 0.08);
    const prof = (y) => NECK_R + (MOUTH_R - NECK_R) * Math.pow((y - NECK_Y) / (MOUTH_Y - NECK_Y), 1.7);
    for (; i < nWall; i++) {
      const y = NECK_Y + (MOUTH_Y - NECK_Y) * Math.pow(r(), 0.8);
      const a = r() * Math.PI * 2;
      const rr = prof(y) * (1 + r.gauss(0, 0.025));
      S.setPoint(s, i, Math.cos(a) * rr, y, Math.sin(a) * rr, r.range(0.4, 0.9), r() < 0.7 ? S.PAL.pale : S.PAL.mint, r.range(0.15, 0.4));
    }
    // накопившиеся дыры — плотная красная масса в нижней части воронки
    for (let e = i + nPile; i < e; i++) {
      const y = NECK_Y + 0.05 + (MOUTH_Y - NECK_Y) * 0.62 * Math.pow(r(), 0.75);
      const a = r() * Math.PI * 2;
      const rr = prof(y) * Math.sqrt(r()) * 0.94;
      const hot = r() < 0.12;
      S.setPoint(s, i, Math.cos(a) * rr, y, Math.sin(a) * rr, r.range(0.6, 1.3), hot ? S.PAL.warm : S.PAL.red, r.range(0.35, 0.75));
    }
    // верхний «водоворот» у кромки
    for (let e = i + nTop; i < e; i++) {
      const y = MOUTH_Y + r.gauss(0, 0.06);
      const a = r() * Math.PI * 2;
      const rr = MOUTH_R * r.range(0.5, 1.05);
      S.setPoint(s, i, Math.cos(a) * rr, y, Math.sin(a) * rr, r.range(0.5, 1.0), r() < 0.5 ? S.PAL.red : S.PAL.orange, r.range(0.2, 0.5));
    }
    // тонкая зелёная струйка из горлышка
    const topB = FLOOR + PITCH * 1.2;
    for (let e = i + nStream; i < e; i++) {
      const y = topB + (NECK_Y - topB) * r();
      S.setPoint(s, i, r.gauss(0, 0.03), y, r.gauss(0, 0.03), r.range(0.6, 1.2), S.PAL.greenHi, r.range(0.25, 0.6));
    }
    // пыль вокруг
    for (; i < n; i++) {
      const [x, y, z] = r.onSphere(r.range(6, 28));
      S.setPoint(s, i, x, y * 0.7, z, r.range(0.4, 0.8), S.PAL.white, r.range(0.04, 0.16));
    }
    this.shapeFunnel = s;
  }

  // Позы — для 16:9; под экраны 4:3 / 16:10 ядро подгоняет их само.
  camera(state, step) {
    return step >= 1
      ? { pos: [0.1, 1.15, 14.6], target: [0.55, 0.8, 0], fov: 40 }
      : { pos: [-0.2, 0.2, 13.8], target: [0.45, 0.65, 0], fov: 40 };
  }

  background(state, step) { return step >= 1 ? 'danger' : 'corner'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    const f = this.step >= 1;
    p.setParams({ noise: f ? 0.12 : 0.25, swirl: f ? 0.55 : 0, swirlR0: 0.35, size: 0.06, twinkle: 0.3, spring: 16, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    p.morph(f ? this.shapeFunnel : this.shapeFloor, { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 12, keepSwirl: false });
    const obj = p.object;
    this.tw(obj.position, { x: B_X, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    // подписи
    this.removeLabels();
    this.labA = this.label({ html: '<span class="b6k-tag3d b6k-tag-red">найдено ИИ</span>', position: [A_X, FLOOR + 0.6, 0], anchor: 'bottom', visible: false });
    this.labB = this.label({ html: '<span class="b6k-tag3d b6k-tag-green">исправлено</span>', position: [B_X, FLOOR - 0.35, 0.6], anchor: 'top', visible: false });
    this.labN = this.label({ html: '<span class="b6k-tag3d b6k-tag-warn">узкое место</span>', position: [B_X + 0.45, NECK_Y + 0.05, 0], anchor: 'left', visible: false });
    this._labDelay?.kill();
    this._labsOn = !!o.instant;
    if (o.instant) this.syncLabels();
    else this._labDelay = this.delay(0.5, () => { this._labDelay = null; this._labsOn = true; this.syncLabels(); });
    // рост: при входе с начала — с нуля, иначе — сразу готовая колонна
    this.countEl = null;
    if (this.step === 0 && !o.instant && o.dir !== -1) {
      this.k.grow = 0; this.k.b = 0;
      this._growTw = this.tw(this.k, { grow: 1, duration: GROW, delay: 0.6, ease: 'power2.in' });
      this._bTw = this.tw(this.k, { b: 26, duration: 9, delay: 0.9, ease: 'none' });
    } else {
      this.k.grow = 1; this.k.b = f ? 40 : 26;
    }
    this._funTw?.kill();
    this.k.funnel = f ? 1 : 0;
    this.dripT = 0;
    this.sparks.clear();
    return super.enter(o);
  }

  /** Видимость подписей по текущему шагу (после того как сцена проявилась). */
  syncLabels() {
    if (!this._labsOn) return;
    this.labA.show();
    this.labB.show();
    this.labN[this.step >= 1 ? 'show' : 'hide']();
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    const p = this.particles;
    if (step >= 1 && prev === 0) {
      // заплаты дальше капают по одной из горлышка (растущий счётчик не должен их перебивать)
      this._bTw?.kill();
      this._bTw = null;
      if (this.k.grow < 1) {
        this._growTw?.kill();
        this._growTw = this.tw(this.k, { grow: 1, duration: 0.6 });
      }
      if (this.ownsParticles()) {
        p.setParams({ noise: 0.12, swirl: 0.55, swirlR0: 0.35 }, 1.2);
        p.morph(this.shapeFunnel, { duration: 2.2, stagger: 0.45, burst: 14 });
      }
      this._funTw?.kill();
      this._funTw = this.tw(this.k, { funnel: 1, duration: 1.2, delay: 0.4 });
      this.syncLabels();
      this.ctx.engine.pulse({ aberration: 0.8 }, 0.8);
    } else if (step === 0 && prev >= 1) {
      if (this.ownsParticles()) {
        p.setParams({ noise: 0.25, swirl: 0 }, 1.0);
        p.morph(this.shapeFloor, { duration: 1.6, stagger: 0.4, burst: 8 });
      }
      this._funTw?.kill();
      this._funTw = this.tw(this.k, { funnel: 0, duration: 0.6 });
      this.syncLabels();
    }
  }

  exit(o = {}) {
    this._labDelay?.kill();
    this._labsOn = false;
    [this.labA, this.labB, this.labN].forEach((l) => l?.hide());
    // вернуть параметры облака по умолчанию (вихрь воронки)
    this.particles.setParams({ swirl: 0, swirlR0: 0.8 }, 0.8);
    return super.exit(o);
  }

  /** Число на слайде — синхронно с ростом колонны. */
  setCount(v, final) {
    if (!this.countEl || !this.countEl.isConnected) {
      const el = this.ctx.deck?.currentEl;
      this.countEl = el && el.dataset.id === 'b6k-race' ? el.querySelector('[data-b6k-found]') : null;
    }
    if (!this.countEl) return;
    const txt = final ? '> 10 000' : formatNumber(v);
    if (txt !== this._txt) { this._txt = txt; this.countEl.textContent = txt; }
  }

  update(dt, t) {
    const k = this.k;
    // колонна дыр
    const total = LAYERS * N * N;
    const shown = Math.floor(total * Math.min(1, k.grow));
    this.colA.count = shown;
    const topY = FLOOR + Math.ceil(shown / (N * N)) * PITCH;
    this.u.uTopY.value = topY;
    this.u.uGlow.value = 1.2 + 0.25 * Math.sin(t * 3);
    const lp = this._labP || (this._labP = [A_X, 0, 0]);
    lp[1] = topY + 0.18;
    this.labA.setPosition(lp);
    this.setCount(Math.round(shown / 10) * 10 > 10000 ? 10000 : Math.round(shown / 10) * 10, k.grow >= 1);
    this.core.visible = shown > 0;
    this.core.scale.y = Math.max(0.001, topY - FLOOR - PITCH * 0.5);
    // искры летят с растущей вершины (пачками ~14 раз в секунду: буфер перезаливается только при выбросе)
    if (k.grow > 0 && k.grow < 1) {
      this._spAcc = (this._spAcc || 0) + dt;
      if (this._spAcc >= 0.07) {
        this._spAcc = 0;
        const S0 = this._sp || (this._sp = { p: [0, 0, 0], o: { speed: 2.6, dir: [0, 1, 0], spread: 0.9, color: [2.0, 0.45, 0.28], size: 0.85, life: 0.9 } });
        for (let q = 0; q < 3; q++) {
          S0.p[0] = A_X + (Math.random() - 0.5) * 1.1; S0.p[1] = topY; S0.p[2] = (Math.random() - 0.5) * 1.1;
          this.sparks.emit(S0.p, 4, S0.o);
        }
      }
    }
    this.sparks.update(dt);
    this.sparks.setScale(this.ctx.engine.height * this.ctx.engine.pixelRatio, this.ctx.camera.fov);
    // колонна заплат: на шаге 1 — по одной из горлышка
    if (k.funnel > 0.5) {
      this.dripT += dt;
      const per = 0.85;
      const ph = (this.dripT % per) / per;
      const idx = Math.min(this.bTargets.length - 1, Math.floor(k.b));
      const tgt = this.bTargets[idx];
      this.drop.visible = true;
      const e = ph * ph;
      this.drop.position.set(B_X + (tgt.x - B_X) * e, NECK_Y - 0.1 + (tgt.y - NECK_Y + 0.1) * e, tgt.z * e);
      this.drop.rotation.set(ph * 3, ph * 2, 0);
      if (this.dripT >= per) { this.dripT -= per; k.b = Math.min(this.bTargets.length - 1, k.b + 1); }
    } else this.drop.visible = false;
    this.colB.count = Math.floor(k.b);
    this.uB.uTopY.value = FLOOR + PITCH * (1 + Math.floor(k.b / (N * N)));
    // летящие в воронку дыры (движение — в шейдере)
    this.fly.visible = k.funnel > 0.01;
    this.uFly.uVis.value = k.funnel;
    this.uFly.uTime.value = t;
  }
}

// Халфтон-«пол»: точки на сетке под 45°, крупнее в центре (плоскость XY → повернём в XZ)
function floorDots(m) {
  const s = S.createShape(m), r = rng(5);
  const pts = [];
  const R = 6.2, step = 0.2;
  for (let a = -R * 1.5; a <= R * 1.5; a += step) {
    for (let b = -R * 1.5; b <= R * 1.5; b += step) {
      const x = (a - b) * Math.SQRT1_2, y = (a + b) * Math.SQRT1_2 * 0.55;
      const d = Math.hypot(x / R, y / (R * 0.55));
      if (d > 1) continue;
      pts.push([x, y, 1 - d]);
    }
  }
  for (let i = 0; i < m; i++) {
    const p = pts[i % pts.length];
    const dup = i >= pts.length;
    const c = r() < 0.15 ? S.PAL.white : S.PAL.green;
    S.setPoint(s, i, p[0] + (dup ? r.gauss(0, 0.03) : 0), p[1] + (dup ? r.gauss(0, 0.03) : 0), 0, (0.4 + 2.0 * p[2]) * (dup ? 0.5 : 1), c, (0.1 + 0.28 * p[2]) * (dup ? 0.22 : 1));
  }
  return s;
}
