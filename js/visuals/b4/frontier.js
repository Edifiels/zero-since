// Парадокс Моравека и «рваная граница».
// Шаг 0 — чашка из частиц опасно покачивается («не уронить чашку» — до сих пор трудно).
// Шаг 1 — чашка рассыпается в горный хребет возможностей ИИ: пики над светящейся пунктирной плоскостью
//          «уровня человека» (олимпиада, белки, уязвимости) и провалы под ней (уборка, здравый смысл).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, TAU } from '../../core/utils.js';
import { glowTexture, haloSprite, glowMat, idle } from './util.js';

const CUP_P = new THREE.Vector3(5.3, -0.2, 0);     // чашка (шаг 0)
const RIDGE_Y = -0.35;                               // уровень человека (плоскость) в мире
const TASKS = [
  { x: -7.2, a: 2.15, name: 'Олимпиада', up: true },
  { x: -3.6, a: 2.6, name: 'Белки', up: true },
  { x: 0.0, a: 1.9, name: 'Уязвимости', up: true },
  { x: 3.6, a: -1.2, name: 'Уборка', up: false },
  { x: 7.2, a: -0.95, name: 'Здравый<br>смысл', up: false },
];
const X0 = -9.6, X1 = 9.6, ZW = 2.5;

/** Профиль линии ИИ над/под уровнем человека: гауссовы пики + «зубцы». */
function ridge(x) {
  const s = clamp((x - 1.1) / 1.5, 0, 1);
  let f = 0.38 + (-0.6 - 0.38) * s * s * (3 - 2 * s);
  for (const t of TASKS) f += t.a * Math.exp(-(((x - t.x) / 0.95) ** 2));
  const saw = Math.abs(((x * 1.35 + 0.3) % 1 + 1) % 1 - 0.5) * 2;   // 0..1 треугольная волна
  f += (saw - 0.5) * 0.42 + 0.12 * Math.sin(x * 4.7 + 1.3);
  const edge = Math.min(1, (x - X0) / 0.8, (X1 - x) / 0.8);
  return f * clamp(edge, 0, 1);
}

const PLANE_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uK;
varying vec2 vUv;
varying vec3 vP;
void main() {
  // пунктирные линии вдоль X (каждые 0.5) и рамка
  float zl = abs(fract(vP.z * 1.0 + 0.5) - 0.5);
  float dashX = step(0.5, fract(vP.x * 1.4 - uTime * 0.4));
  float lineZ = (1.0 - smoothstep(0.0, 0.035, zl)) * dashX;
  float xl = abs(fract(vP.x * 0.5 + 0.5) - 0.5);
  float dashZ = step(0.5, fract(vP.z * 1.4 + uTime * 0.3));
  float lineX = (1.0 - smoothstep(0.0, 0.025, xl)) * dashZ * 0.6;
  vec2 e = min(vUv, 1.0 - vUv);
  float border = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y * 0.33));
  float dashB = step(0.45, fract((vP.x + vP.z) * 1.2 - uTime * 0.5));
  float edgeFade = smoothstep(0.0, 0.08, min(e.x, e.y));
  float fill = 0.05 * edgeFade;
  float sd = (vP.x - (uK * 20.0 - 10.0)) / 0.6;   // без pow() от отрицательного
  float scan = exp(-sd * sd) * (1.0 - smoothstep(0.98, 1.0, uK));
  vec3 col = vec3(0.55, 1.2, 0.55) * (lineZ * 0.55 + lineX * 0.45 + border * dashB * 1.1 + scan * 0.6) + vec3(0.2, 0.7, 0.2) * fill;
  float a = (lineZ * 0.5 + lineX * 0.35 + border * dashB + fill + scan * 0.4) * uOpacity * uK;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const LINE_VERT = /* glsl */ `
varying float vY;
varying float vX;
void main() {
  vY = position.y;
  vX = position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LINE_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uLevel;
varying float vY;
varying float vX;
void main() {
  float above = smoothstep(uLevel - 0.06, uLevel + 0.06, vY);
  vec3 green = vec3(0.45, 1.55, 0.45);
  vec3 orange = vec3(1.6, 0.62, 0.12);
  float flow = 0.8 + 0.2 * sin(vX * 3.0 - uTime * 4.0);
  vec3 col = mix(orange, green, above) * flow;
  gl_FragColor = vec4(col, uOpacity);
}
`;

export default class Frontier extends Visual {
  static transition = 'halftone';

  async init() {
    this.haloTex = glowTexture(128);
    this.k = { v: 0 };      // проявление графика
    this.line = { v: 0 };   // прорисовка линии ИИ
    this.orbit = { v: 0 };

    // ---------- Плоскость «уровень человека» ----------
    const pw = X1 - X0 + 1.4, pd = ZW * 2 + 0.6;
    this.planeU = { uOpacity: { value: 1 }, uTime: { value: 0 }, uK: { value: 0 } };
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd, 1, 1), new THREE.ShaderMaterial({
      uniforms: this.planeU,
      vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = vec3(position.x, 0.0, -position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: PLANE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = RIDGE_Y;
    this.root.add(this.plane);

    // ---------- Линия ИИ (гребень) ----------
    const pts = [];
    for (let i = 0; i <= 260; i++) {
      const x = X0 + (X1 - X0) * (i / 260);
      pts.push(new THREE.Vector3(x, RIDGE_Y + ridge(x) + 0.05, 0));
    }
    this.crest = new THREE.CatmullRomCurve3(pts);
    this.crestTub = 360; this.crestRad = 8;
    this.crestGeo = new THREE.TubeGeometry(this.crest, this.crestTub, 0.05, this.crestRad, false);
    this.crestGeo.setDrawRange(0, 0);
    this.lineU = { uOpacity: { value: 1 }, uTime: { value: 0 }, uLevel: { value: RIDGE_Y } };
    this.crestMesh = new THREE.Mesh(this.crestGeo, new THREE.ShaderMaterial({
      uniforms: this.lineU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.root.add(this.crestMesh);

    // точки пересечения с уровнем человека
    this.cross = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i].y - RIDGE_Y, b = pts[i + 1].y - RIDGE_Y - 0.05;
      if ((a - 0.05) * b < 0) {
        const t = (a - 0.05) / ((a - 0.05) - b);
        const p = pts[i].clone().lerp(pts[i + 1], t);
        p.y = RIDGE_Y;
        const h = haloSprite(this.haloTex, new THREE.Color(1.3, 1.5, 1.3), 0.7, 0);
        h.material.userData.noFade = true;
        h.position.copy(p);
        this.root.add(h);
        this.cross.push({ h, x: p.x });
      }
    }

    // маркеры задач: вертикальные «отвесы» от плоскости до гребня
    this.taskMarks = TASKS.map((t) => {
      const top = RIDGE_Y + ridge(t.x);
      const h = Math.abs(top - RIDGE_Y);
      const geo = new THREE.CylinderGeometry(0.018, 0.018, Math.max(0.01, h), 6, 1, true);
      const m = new THREE.Mesh(geo, glowMat(t.up ? new THREE.Color(0.5, 1.4, 0.5) : new THREE.Color(1.5, 0.6, 0.15), 0));
      m.material.userData.noFade = true;
      m.position.set(t.x, (top + RIDGE_Y) / 2, 0);
      const dot = haloSprite(this.haloTex, t.up ? new THREE.Color(0.6, 1.6, 0.6) : new THREE.Color(1.6, 0.7, 0.2), 1.1, 0);
      dot.material.userData.noFade = true;
      dot.position.set(t.x, top + 0.05, 0);
      this.root.add(m, dot);
      return { m, dot, top };
    });

    // ---------- Формы частиц ----------
    await idle();
    await this.buildShapes();
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const r = rng(1972);
    // фон — общий для обеих форм (в мировых координатах; облако стоит в начале координат)
    const nBg = Math.floor(n * 0.28);
    const bg = [];
    for (let i = 0; i < nBg; i++) {
      const [x, y, z] = r.onSphere(r.range(22, 60));
      bg.push([x, y * 0.6, -Math.abs(z) - 4, Math.pow(r(), 4) * 2 + 0.4, r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.06, 0.26)]);
    }
    const putBg = (s) => bg.forEach((b, i) => S.setPoint(s, i, b[0], b[1], b[2], b[3], b[4], b[5]));
    const nFg = n - nBg;

    // --- Чашка с блюдцем и паром (мировые координаты вокруг CUP_P)
    const cupProfile = [
      [0.0, -1.0], [0.62, -1.0], [0.78, -0.92], [0.98, -0.45], [1.16, 0.3], [1.26, 0.92], [1.3, 1.02],
      [1.22, 1.02], [1.16, 0.92], [1.06, 0.3], [0.88, -0.45], [0.66, -0.8], [0.0, -0.8],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const saucerProfile = [
      [0.0, -1.18], [1.5, -1.18], [2.05, -1.02], [2.2, -0.92], [2.08, -0.95], [1.5, -1.08], [0.9, -1.06], [0.0, -1.06],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const cupGeo = new THREE.LatheGeometry(cupProfile, 96);
    const saucerGeo = new THREE.LatheGeometry(saucerProfile, 96);
    const handleGeo = new THREE.TorusGeometry(0.46, 0.1, 14, 48, Math.PI * 1.15);
    handleGeo.rotateZ(-Math.PI * 0.575);
    handleGeo.translate(1.18, 0.12, 0);
    const colorFn = (v, nrm, rr) => {
      const k = rr();
      return k < 0.18 ? S.PAL.greenHi : k < 0.3 ? S.PAL.mint : S.PAL.white;
    };
    const cup = S.combine(nFg, [
      { weight: 0.5, shape: (m) => S.fromGeometry(m, cupGeo, { colorFn, alpha: 0.55, size: 0.85, seed: 3 }) },
      { weight: 0.1, shape: (m) => S.fromGeometry(m, handleGeo, { colorFn, alpha: 0.6, size: 0.85, seed: 4 }) },
      { weight: 0.26, shape: (m) => S.fromGeometry(m, saucerGeo, { colorFn, alpha: 0.45, size: 0.8, seed: 5 }) },
      { weight: 0.14, shape: (m) => {
        // пар: три извилистые струйки
        const s = S.createShape(m), rr = rng(6);
        for (let i = 0; i < m; i++) {
          const st = i % 3, t = rr();
          const y = 1.25 + t * 2.1;
          const x = (st - 1) * 0.42 + Math.sin(t * 7.0 + st * 2.1) * 0.22 * (0.4 + t);
          const z = Math.cos(t * 5.0 + st) * 0.15;
          S.setPoint(s, i, x + rr.gauss(0, 0.05 + 0.08 * t), y, z + rr.gauss(0, 0.05), rr.range(0.5, 1.0), rr() < 0.3 ? S.PAL.mint : S.PAL.white, 0.22 * (1 - t) + 0.04);
        }
        return s;
      } },
    ]);
    S.transform(cup, { position: [CUP_P.x, CUP_P.y, CUP_P.z], rotation: [0.32, -0.5, 0], scale: 1.35 });
    const A = S.createShape(n);
    putBg(A);
    A.positions.set(cup.positions.subarray(0, nFg * 4), nBg * 4);
    A.colors.set(cup.colors.subarray(0, nFg * 4), nBg * 4);
    this.shapeCup = S.equalize(A, { cell: 0.1, target: 6 });
    await idle();

    // --- Горный хребет возможностей ИИ
    const B = S.createShape(n);
    putBg(B);
    const yFloor = RIDGE_Y - 2.5;
    let i = nBg;
    const nCrest = Math.floor(nFg * 0.16);
    for (; i < nBg + nCrest; i++) {
      // гребень — ярче
      const x = X0 + (X1 - X0) * r();
      const y = RIDGE_Y + ridge(x);
      const above = y > RIDGE_Y;
      const c = above ? (r() < 0.4 ? S.PAL.greenHi : S.PAL.white) : (r() < 0.6 ? S.PAL.orange : S.PAL.warm);
      S.setPoint(B, i, x + r.gauss(0, 0.03), y + r.gauss(0, 0.04), r.gauss(0, 0.06), r.range(0.55, 1.0), c, r.range(0.35, 0.7));
    }
    for (; i < n; i++) {
      const x = X0 + (X1 - X0) * r();
      const top = RIDGE_Y + ridge(x);
      const z = r.gauss(0, 1) * ZW * 0.42;
      const g = Math.exp(-((z / (ZW * 0.55)) ** 2));
      const jag = 0.1 * Math.sin(x * 9.0 + z * 6.0) + 0.06 * Math.sin(z * 13.0 - x * 4.0);
      const y = yFloor + (top - yFloor) * g + jag * g;
      const above = y > RIDGE_Y;
      const hk = clamp((y - yFloor) / (top - yFloor + 1e-3), 0, 1);
      let c;
      if (above) c = r() < 0.25 ? S.PAL.mint : r() < 0.55 ? S.PAL.green : S.PAL.white;
      else c = top < RIDGE_Y && hk > 0.75 ? (r() < 0.5 ? S.PAL.orange : S.PAL.warm) : S.PAL.dim;
      const al = above ? r.range(0.18, 0.42) * (0.5 + 0.5 * hk) : r.range(0.08, 0.22) * (0.4 + 0.6 * hk);
      S.setPoint(B, i, x, y, z, r.range(0.45, 0.9), c, al);
    }
    this.shapeRidge = S.equalize(B, { cell: 0.1, target: 5 });
  }

  // ---------- Камера ----------
  // Позы — для 16:9 (под другие экраны их подгоняет ядро).
  camera(state, step) {
    return step <= 0
      ? { pos: [0.3, 0.5, 14.5], target: [0.3, 0.0, 0], fov: 45 }
      : { pos: [0.0, 5.3, 14.9], target: [0.0, 0.05, 0], fov: 45, duration: 2.4, arc: 0.2 };
  }

  background(state, step) { return step >= 1 ? 'soft' : 'right'; }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    // положение облака ведёт update() (плавно, с покачиванием чашки)
    this.snapObj = !!o.instant;
    this.removeLabels();
    this.taskLabels = TASKS.map((t, i) => {
      const top = RIDGE_Y + ridge(t.x);
      return t.up
        ? this.label({ html: `<span class="b4-rg-task">${t.name}</span>`, position: [t.x, top + 0.42, 0], anchor: 'bottom', visible: false })
        : this.label({ html: `<span class="b4-rg-task is-low">${t.name}</span>`, position: [t.x, top - 0.38, 0], anchor: 'top', visible: false });
    });
    this.levelLabel = this.label({ html: '<span class="b4-rg-level">Уровень человека</span>', position: [X1 - 1.6, RIDGE_Y + 0.12, -ZW - 0.3], anchor: 'bottom', visible: false });
    this.aiLabel = this.label({ html: '<span class="b4-rg-ai">Линия ИИ</span>', position: [X0 + 0.9, RIDGE_Y + ridge(X0 + 0.9) + 0.35, 0], anchor: 'bottom', visible: false });
    this.shapeK = -1;
    if (this.step < 1) { this.k.v = 0; this.line.v = 0; this.orbit.v = 0; }
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const instant = !!o.instant;
    const p = this.particles;
    const sk = step >= 1 ? 1 : 0;
    if (sk !== this.shapeK) {
      p.morph(sk ? this.shapeRidge : this.shapeCup, { duration: instant ? 0.01 : sk ? 2.6 : 2.0, stagger: 0.6, burst: sk ? 12 : 8, explode: sk && !instant && !o.entering ? 4 : 0 });
      p.setParams({ noise: sk ? 0.14 : 0.2, swirl: 0, size: 0.06, twinkle: 0.3, spring: 16, damping: 5.8, flow: [0, 0, 0] }, instant ? 0 : 1.2);
      this.shapeK = sk;
    }
    const on = step >= 1 ? 1 : 0;
    this.tw(this.k, { v: on, duration: instant ? 0 : on ? 2.2 : 0.6, delay: on && !instant ? 0.8 : 0, ease: 'power2.inOut', overwrite: true });
    this.tw(this.line, { v: on, duration: instant ? 0 : on ? 2.4 : 0.5, delay: on && !instant ? 1.3 : 0, ease: on ? 'power1.inOut' : 'power1.in', overwrite: true });
    // облёт камеры на графике
    if (on) {
      this.tw(this.orbit, { v: 1, duration: instant ? 0 : 3, delay: instant ? 0 : 2.4, ease: 'power2.inOut', overwrite: true });
      const base = this.camera(null, 1);
      const tx = base.target[0], tz = base.target[2];
      const R = Math.hypot(base.pos[0] - tx, base.pos[2] - tz);
      // без fov: угол обзора остаётся тем, что поставило ядро (на 4:3 он шире)
      const pose = { pos: [0, 0, 0], target: base.target };
      this.drive((dt, t) => {
        const a = Math.sin(t * 0.16) * 0.1 * this.orbit.v;
        pose.pos[0] = tx + Math.sin(a) * R;
        pose.pos[1] = base.pos[1] + Math.sin(t * 0.11) * 0.35 * this.orbit.v;
        pose.pos[2] = tz + Math.cos(a) * R;
        return pose;
      }, instant ? 0.01 : 1.5);
    } else {
      this.tw(this.orbit, { v: 0, duration: 0, overwrite: true });
      this.drive(null);
    }
  }

  toggle(l, want) { if (l && want !== l.visible) { if (want) l.show(); else l.hide(); } }

  exit(o = {}) {
    this.drive(null);
    [...(this.taskLabels || []), this.levelLabel, this.aiLabel].forEach((l) => l?.hide());
    const p = super.exit(o);
    p.then(() => { if (!this.active) this.removeLabels(); });
    return p;
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const op = this.opacity;
    const k = this.k.v, lv = this.line.v;
    this.planeU.uTime.value = t;
    this.planeU.uK.value = k;
    this.lineU.uTime.value = t;
    this.lineU.uOpacity.value = op;
    this.crestGeo.setDrawRange(0, Math.round(lv * this.crestTub) * this.crestRad * 6);
    this.crestMesh.visible = lv > 0.001;
    const xNow = X0 + (X1 - X0) * lv;
    this.cross.forEach((c) => {
      const on = xNow > c.x ? 1 : 0;
      c.h.material.opacity = op * on * (0.6 + 0.3 * Math.sin(t * 4 + c.x));
      c.h.visible = on > 0;
    });
    this.taskMarks.forEach((m, i) => {
      const on = xNow > TASKS[i].x ? 1 : 0;
      m.m.material.opacity = op * on * 0.55;
      m.dot.material.opacity = op * on * (0.8 + 0.2 * Math.sin(t * 3 + i));
      m.dot.scale.setScalar(1.0 + 0.15 * Math.sin(t * 3 + i));
    });
    // чашка покачивается — вот-вот упадёт (поворот вокруг донышка блюдца)
    if (this.ownsParticles()) {
      const o = this.particles.object;
      let rz = 0, px = 0, py = 0;
      if (this.step < 1) {
        rz = Math.sin(t * 1.6) * 0.045 + Math.sin(t * 0.53) * 0.03 + Math.max(0, Math.sin(t * 0.37)) ** 6 * 0.12;
        const cx = CUP_P.x, cy = CUP_P.y - 1.6;
        const c = Math.cos(rz), sn = Math.sin(rz);
        px = cx - (cx * c - cy * sn);
        py = cy - (cx * sn + cy * c);
      }
      const a = this.snapObj ? 1 : 1 - Math.exp(-dt * 4);
      this.snapObj = false;
      o.position.x += (px - o.position.x) * a;
      o.position.y += (py - o.position.y) * a;
      o.position.z += (0 - o.position.z) * a;
      o.rotation.x += (0 - o.rotation.x) * a;
      o.rotation.y += (0 - o.rotation.y) * a;
      o.rotation.z += (rz - o.rotation.z) * a;
      const sc = o.scale.x + (1 - o.scale.x) * a;
      o.scale.setScalar(sc);
    }
    // подписи
    if (this.taskLabels && this.active) {
      for (let i = 0; i < this.taskLabels.length; i++) this.toggle(this.taskLabels[i], this.step >= 1 && xNow > TASKS[i].x + 0.2);
      this.toggle(this.levelLabel, this.step >= 1 && k > 0.6);
      this.toggle(this.aiLabel, this.step >= 1 && lv > 0.12);
    }
  }
}
