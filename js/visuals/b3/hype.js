// Блок 3. «Проверка хайпа»: газета с громким заголовком влетает, крутясь; на неё падают штампы (HTML);
// шаг 3 — «сфинкс»: каркасная муха идёт по сетке, а управляет ею схема мозга червя — 302 нейрона.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { FlyModel } from './fly-model.js';
import { makeFloor, makeBeam, cellPx, eqShape } from './common.js';

// Газета: центр и высота в единицах сцены 16:9 (u = 1% ширины), чтобы HTML-штампы легли точно на неё
const PAPER = { cx: 66, cy: 29.5, h: 44 };
const ASPECT = 3 / 4;
const FLY_WIRE = 0.45;      // яркость каркаса мухи-«сфинкса» (ярче — свечение «заливает» тело)
const lp = (l, x, y, z) => { const a = l._p3 || (l._p3 = [0, 0, 0]); a[0] = x; a[1] = y; a[2] = z; l.setPosition(a); };


const PAPER_VERT = /* glsl */ `
uniform float uBend;
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec3 p = position;
  // лёгкий изгиб листа и «дыхание»
  float x = p.x;
  p.z += -uBend * x * x * 0.05 + sin(p.y * 0.8 + uTime * 1.3) * 0.03 * uBend;
  vec3 n = normalize(vec3(uBend * x * 0.1, 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const PAPER_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uVis;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) { c = vec3(0.55, 0.53, 0.48) * 0.5; n = -n; }
  float l = 0.55 + 0.45 * clamp(dot(n, normalize(vec3(0.3, 0.5, 1.0))), 0.0, 1.0);
  gl_FragColor = vec4(c * l * 0.82, uOpacity * uVis);
}
`;

const NEUR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uScale;
uniform float uTime;
uniform float uOpacity;
uniform float uK;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float fire = pow(0.5 + 0.5 * sin(uTime * 3.0 + aPhase * 6.2831), 8.0);
  gl_PointSize = clamp(aSize * (1.0 + fire * 0.8) * uScale / max(0.1, -mv.z), 1.5, 40.0);
  vA = uOpacity * uK * (0.55 + 0.45 * fire);
}
`;
const NEUR_FRAG = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (exp(-d * d * 7.0) + 0.25 * (1.0 - d)) * vA;
  gl_FragColor = vec4(vec3(0.55, 1.0, 0.55) * 1.35, a);
}
`;

function drawPaper() {
  const W = 1024, H = Math.round(W / ASPECT);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(31);
  // бумага
  g.fillStyle = '#ebe6d8';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(90,80,60,${r.range(0.01, 0.05)})`;
    g.fillRect(r() * W, r() * H, r.range(1, 3), r.range(1, 3));
  }
  const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(70,55,30,0.28)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const ink = '#141414';
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';
  // шапка
  g.font = '800 70px Unbounded';
  g.textAlign = 'center';
  g.fillText('ГЛАВНЫЕ НОВОСТИ', W / 2, 108);
  g.fillRect(56, 132, W - 112, 6);
  g.fillRect(56, 146, W - 112, 2);
  g.font = '600 26px Onest';
  g.textAlign = 'left';
  g.fillText('МАРТ 2026', 60, 184);
  g.textAlign = 'right';
  g.fillText('ЭКСТРЕННЫЙ ВЫПУСК', W - 60, 184);
  g.fillRect(56, 200, W - 112, 2);
  // заголовок
  g.textAlign = 'center';
  g.font = '900 104px Unbounded';
  ['МУХУ', 'ЗАГРУЗИЛИ', 'В КОМПЬЮТЕР!'].forEach((t, i) => {
    let size = 104;
    g.font = `900 ${size}px Unbounded`;
    while (g.measureText(t).width > W - 110 && size > 40) { size -= 2; g.font = `900 ${size}px Unbounded`; }
    g.fillText(t, W / 2, 318 + i * 118);
  });
  g.font = '600 34px Onest';
  g.fillText('Цифровая копия мозга ходит, чистится и ищет еду', W / 2, 640);
  g.fillRect(56, 672, W - 112, 2);
  // «фото» мухи — халфтон
  const px = 60, py = 700, pw = 560, ph = 560;
  const sc = document.createElement('canvas');
  sc.width = pw; sc.height = ph;
  const s = sc.getContext('2d');
  s.fillStyle = '#fff'; s.fillRect(0, 0, pw, ph);
  s.translate(pw / 2, ph / 2 + 20);
  s.fillStyle = '#000';
  const ell = (x, y, rx, ry, a = 0, alpha = 1) => { s.globalAlpha = alpha; s.beginPath(); s.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); s.fill(); s.globalAlpha = 1; };
  ell(-150, -40, 175, 72, -0.55, 0.28);   // крылья
  ell(150, -40, 175, 72, 0.55, 0.28);
  s.lineWidth = 9; s.strokeStyle = '#000'; s.lineCap = 'round';
  [[-1, -40, 60, -150, 20, -210, 120], [-1, -30, 20, -170, 60, -230, 70], [-1, -20, 80, -120, 150, -170, 230]].forEach(([sg, a, b, c2, d, e, f]) => {
    for (const k of [1, -1]) { s.beginPath(); s.moveTo(k * -a * sg, b); s.lineTo(k * -c2 * sg, d); s.lineTo(k * -e * sg, f); s.stroke(); }
  });
  ell(0, 120, 70, 120, 0, 0.95);           // брюшко
  ell(0, -20, 82, 82, 0, 1);               // грудь
  ell(0, -125, 62, 50, 0, 1);              // голова
  ell(-48, -135, 34, 40, 0, 0.75);         // глаза
  ell(48, -135, 34, 40, 0, 0.75);
  const img = s.getImageData(0, 0, pw, ph).data;
  // фон фото
  g.fillStyle = '#d9d3c2';
  g.fillRect(px, py, pw, ph);
  g.fillStyle = ink;
  const cell = 11;
  for (let y = 0; y < ph; y += cell) {
    for (let x = 0; x < pw; x += cell) {
      const j = (Math.min(ph - 1, y + 5) * pw + Math.min(pw - 1, x + 5)) * 4;
      const v = 1 - img[j] / 255;
      const rad = Math.sqrt(Math.max(0.04, v)) * cell * 0.62;
      g.beginPath(); g.arc(px + x + cell / 2, py + y + cell / 2, rad, 0, Math.PI * 2); g.fill();
    }
  }
  g.font = '500 22px Onest';
  g.textAlign = 'left';
  g.fillText('Цифровая муха «ожила» в компьютере', px, py + ph + 34);
  // колонки «текста»
  const tx = 660, tw = W - 60 - tx;
  for (let col = 0; col < 1; col++) {
    let y = 712;
    for (let i = 0; i < 26; i++) {
      const wl = i % 7 === 6 ? tw * r.range(0.3, 0.6) : tw * r.range(0.86, 1);
      g.fillStyle = 'rgba(20,20,20,0.55)';
      g.fillRect(tx, y, wl, 11);
      y += i % 7 === 6 ? 34 : 22;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Червь C. elegans: изгиб тела, 302 нейрона (нервное кольцо в голове, брюшная цепочка, хвостовые ганглии)
function wormCurve() {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector3((t - 0.5) * 6.4, Math.sin(t * Math.PI * 1.6 + 0.4) * 0.55, Math.cos(t * Math.PI * 1.3) * 0.5));
  }
  return new THREE.CatmullRomCurve3(pts);
}
const wormR = (u) => 0.27 * Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, u))), 0.45) * (1 - 0.25 * u);

function frameAt(crv, u, T, N, B) {
  crv.getTangentAt(u, T);
  N.set(0, 1, 0).addScaledVector(T, -T.y).normalize();
  B.crossVectors(T, N);
}

function wormNeurons() {
  const crv = wormCurve(), r = rng(302);
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  const pos = [];
  const add = (u, ang, rad) => {
    crv.getPointAt(u, P);
    frameAt(crv, u, T, N, B);
    const R = wormR(u) * rad;
    pos.push(P.x + (N.x * Math.cos(ang) + B.x * Math.sin(ang)) * R, P.y + (N.y * Math.cos(ang) + B.y * Math.sin(ang)) * R, P.z + (N.z * Math.cos(ang) + B.z * Math.sin(ang)) * R);
  };
  for (let i = 0; i < 190; i++) add(r.range(0.03, 0.13), r() * Math.PI * 2, r.range(0.25, 0.85));   // нервное кольцо и головные ганглии
  for (let i = 0; i < 80; i++) add(0.13 + (i / 79) * 0.74 + r.gauss(0, 0.004), -Math.PI / 2 + r.gauss(0, 0.25), r.range(0.55, 0.8)); // брюшная цепочка
  for (let i = 0; i < 32; i++) add(r.range(0.87, 0.96), r() * Math.PI * 2, r.range(0.2, 0.75));    // хвостовые ганглии
  return { pos, crv };
}

export default class Hype extends Visual {
  static transition = 'glitch';

  async init() {
    const n = this.ctx.particles.count;
    // --- газета
    this.paperU = { uMap: { value: drawPaper() }, uOpacity: { value: 1 }, uVis: { value: 1 }, uBend: { value: 1 }, uTime: { value: 0 } };
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / ASPECT, 24, 32), new THREE.ShaderMaterial({
      uniforms: this.paperU, vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, transparent: true, side: THREE.DoubleSide,
    }));
    this.paperGroup = new THREE.Group();
    this.paperGroup.add(this.paper);
    this.root.add(this.paperGroup);

    // --- «сфинкс»: муха + червь
    this.sphinx = new THREE.Group();
    this.root.add(this.sphinx);
    const fly = new FlyModel({ seed: 7 });
    this.fly = fly;
    Object.assign(fly.p, { solid: 1, dark: 1, wire: FLY_WIRE, walk: 1, trunk: 1, legs: 1 });
    fly.group.position.set(3.0, -0.95, 0);   // правее и выше: подпись снизу слева не закрывает передние лапки
    fly.group.rotation.set(0, -1.38, 0);
    fly.group.scale.setScalar(2.0);
    this.sphinx.add(fly.group);
    this.floor = makeFloor({ size: 80, cell: 1.0, fade: 11, k: 0.45 });
    this.sphinx.add(this.floor.mesh);
    this.floorOffset = 0;

    // червь (точки-нейроны и связи) — в своей группе; облако частиц повторяет её положение
    this.worm = new THREE.Group();
    this.worm.position.set(3.4, 3.35, -1.8);
    this.worm.rotation.set(0.25, -0.35, 0.05);
    this.worm.scale.setScalar(1.12);
    this.sphinx.add(this.worm);
    const wn = wormNeurons();
    this.wormCrv = wn.crv;
    const cnt = wn.pos.length / 3;
    const sizes = new Float32Array(cnt), phase = new Float32Array(cnt);
    const r = rng(9);
    for (let i = 0; i < cnt; i++) { sizes[i] = r.range(0.05, 0.09); phase[i] = r(); }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(wn.pos, 3));
    ng.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    ng.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    this.neurU = { uScale: { value: 600 }, uTime: { value: 0 }, uOpacity: { value: 1 }, uK: { value: 0 } };
    this.neurons = new THREE.Points(ng, new THREE.ShaderMaterial({
      uniforms: this.neurU, vertexShader: NEUR_VERT, fragmentShader: NEUR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.neurons.frustumCulled = false;
    this.worm.add(this.neurons);
    // связи: каждый нейрон — с двумя ближайшими
    const P = wn.pos, segs = [];
    for (let i = 0; i < cnt; i++) {
      let b1 = -1, b2 = -1, d1 = 1e9, d2 = 1e9;
      for (let j = 0; j < cnt; j++) {
        if (j === i) continue;
        const d = (P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2;
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = j; } else if (d < d2) { d2 = d; b2 = j; }
      }
      for (const b of [b1, b2]) if (b > i) segs.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.linksU = { uOpacity: { value: 1 }, uK: { value: 0 } };
    this.links = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      uniforms: this.linksU,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform float uK; void main() { gl_FragColor = vec4(vec3(0.4, 1.0, 0.45) * 0.8, 0.45 * uOpacity * uK); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.links.frustumCulled = false;
    this.worm.add(this.links);

    // луч «мозг червя → тело мухи»
    this.beam = makeBeam([[0, 0, 0], [0, 1, 0], [0, 2, 0]], { radius: 0.035, dash: 5, speed: 1.1 });
    this.beam.uniforms.uReveal.value = 0;
    this.sphinx.add(this.beam.mesh);

    // --- формы облака частиц
    this.shapes = {
      dust: S.fade(S.dust(n, { radius: 30, inner: 7, alpha: 0.35, size: 0.7, seed: 21 }), 0.8),
      worm: this.wormShape(n),
    };
    this.cur = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
    this.layoutPaper();
  }

  wormShape(n) {
    const s = S.createShape(n), r = rng(17), crv = wormCurve();
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = r();
      crv.getPointAt(u, P);
      frameAt(crv, u, T, N, B);
      const surf = r() < 0.78;
      const a = r() * Math.PI * 2;
      const R = wormR(u) * (surf ? r.range(0.92, 1.05) : Math.sqrt(r()) * 0.9);
      const x = P.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * R;
      const y = P.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * R;
      const z = P.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * R;
      const c = surf ? (r() < 0.75 ? S.PAL.pale : S.PAL.mint) : S.PAL.green;
      S.setPoint(s, i, x, y, z, surf ? r.range(0.5, 0.9) : 0.6, c, surf ? r.range(0.25, 0.5) : 0.12);
    }
    return eqShape(s, 1.12);
  }

  layoutPaper() {
    // положение газеты под HTML-штампы: камера (0,0,14), fov 45. Сцена 16:9 в мире — vh × 16/9 на любом экране
    // (ядро расширяет угол обзора на 4:3/16:10 так, что по горизонтали видна ровно ширина 16:9).
    const h = 2 * 14 * Math.tan(THREE.MathUtils.degToRad(22.5));
    const w = h * 16 / 9;
    const H = (PAPER.h / 56.25) * h;
    this.paperHome = {
      pos: new THREE.Vector3((PAPER.cx / 100 - 0.5) * w, (0.5 - PAPER.cy / 56.25) * h, 0),
      scale: H * ASPECT,
    };
    this.paper.scale.setScalar(this.paperHome.scale);
  }

  camera(state, step) {
    if (step >= 3) return { pos: [-3.6, 2.4, 13.6], target: [1.6, 0.9, 0], fov: 45 };
    return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 };
  }

  background(state, step) { return step >= 3 ? 'bottom' : 'corners'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const ob = this.particles.object;
    this.cur.pos.copy(ob.position); this.cur.quat.copy(ob.quaternion); this.cur.scale = ob.scale.x;
    this.layoutPaper();
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const inst = !!o.instant, entering = !!o.entering;
    const D = (x) => (inst ? 0 : x);
    const prev = o.prevStep ?? -1;
    const p = this.particles;
    const pg = this.paperGroup, home = this.paperHome;
    if (step < 3) {
      // газета на месте
      if (entering && !inst) {
        pg.position.set(home.pos.x - 2, home.pos.y + 1, -38);
        pg.rotation.set(0.3, -0.6, Math.PI * 5);
        this.twk('pgPos', pg.position, { x: home.pos.x, y: home.pos.y, z: 0, duration: 1.5, ease: 'power3.out' });
        this.twk('pgRot', pg.rotation, { x: 0.03, y: -0.13, z: -0.035, duration: 1.6, ease: 'power3.out' });
        this.twk('land', this._clockA || (this._clockA = {}), { duration: 1.35, onComplete: () => { this.ctx.rig.shake(0.12, 0.4); this.ctx.engine.pulse({ flash: 0.08, aberration: 0.6 }, 0.5); this.particles.explode(6, [home.pos.x, home.pos.y, 0]); } });
      } else {
        this.twk('pgPos', pg.position, { x: home.pos.x, y: home.pos.y, z: 0, duration: D(1.2), ease: 'power3.out' });
        this.twk('pgRot', pg.rotation, { x: 0.03, y: -0.13, z: -0.035, duration: D(1.2), ease: 'power3.out' });
      }
      this.twk('pgVis', this.paperU.uVis, { value: 1, duration: D(0.6) });
      // удар штампа — газета вздрагивает
      if (!inst && !entering && step > prev && (step === 1 || step === 2)) {
        this.twk('thud', this._clockB || (this._clockB = {}), {
          duration: 0.42,
          onComplete: () => {
            this.ctx.rig.shake(0.1, 0.35);
            this.twk('pgPos', pg.position, { startAt: { z: -0.6 }, x: home.pos.x, y: home.pos.y, z: 0, duration: 0.5, ease: 'back.out(3)' });
            this.ctx.engine.pulse({ aberration: 0.8 }, 0.5);
          },
        });
      }
      if (this.shapeKey !== 'dust' || entering) { p.morph(this.shapes.dust, { duration: D(1.8), stagger: 0.5, burst: 6 }); this.shapeKey = 'dust'; }
      p.setParams({ noise: 0.5, swirl: 0.02, size: 0.06, twinkle: 0.4, spring: 14, damping: 5 }, D(1));
      this.particleFrame = 'world';
      this.sphinxOn(false, inst);
    } else {
      // газета улетает (при входе сразу на шаг 3 — назад со следующего слайда — её просто нет)
      this._keyed?.get('thud')?.kill();
      this._keyed?.get('land')?.kill();
      if (entering) { pg.position.set(home.pos.x - 16, home.pos.y + 4, -10); pg.rotation.set(0.4, -1.2, 0.8); this.paperU.uVis.value = 0; }
      this.twk('pgPos', pg.position, { x: home.pos.x - 16, y: home.pos.y + 4, z: -10, duration: D(1.3), ease: 'power3.in' });
      this.twk('pgRot', pg.rotation, { x: 0.4, y: -1.2, z: 0.8, duration: D(1.3), ease: 'power2.in' });
      this.twk('pgVis', this.paperU.uVis, { value: 0, duration: D(1.0), delay: D(0.3) });
      this.sphinxOn(true, inst);
      if (this.shapeKey !== 'worm' || entering) { p.morph(this.shapes.worm, { duration: D(2.4), stagger: 0.5, burst: 8 }); this.shapeKey = 'worm'; }
      p.setParams({ noise: 0.04, swirl: 0, size: 0.05, twinkle: 0.3, spring: 18, damping: 6 }, D(1));
      this.particleFrame = 'worm';
    }
    if (inst) this.snap = true;
    this.updateLabels(step, !inst && step >= 3 && (entering || prev < 3));
  }

  sphinxOn(on, inst) {
    const D = (x) => (inst ? 0 : x);
    const P = this.fly.p;
    this.twk('fly', P, { solid: on ? 1 : 0, wire: on ? FLY_WIRE : 0, duration: D(on ? 1.2 : 0.5), delay: D(on ? 0.6 : 0) });
    this.twk('floor', this.floor.uniforms.uVis, { value: on ? 1 : 0, duration: D(on ? 1.2 : 0.5), delay: D(on ? 0.4 : 0) });
    this.twk('neur', this.neurU.uK, { value: on ? 1 : 0, duration: D(on ? 1.2 : 0.4), delay: D(on ? 1.6 : 0) });
    this.twk('links', this.linksU.uK, { value: on ? 1 : 0, duration: D(on ? 1.2 : 0.4), delay: D(on ? 1.9 : 0) });
    this.twk('beam', this.beam.uniforms.uReveal, { value: on ? 1 : 0, duration: D(on ? 1.2 : 0.4), delay: D(on ? 2.2 : 0) });
    if (on) {
      this.worm.updateMatrixWorld(true);
      const head = new THREE.Vector3(...[0, 0, 0]);
      this.wormCrv.getPointAt(0.08, head);
      head.applyMatrix4(this.worm.matrix);
      this.fly.group.updateMatrix();
      const thorax = new THREE.Vector3(0, 0.55, 0.45).applyMatrix4(this.fly.group.matrix);
      const mid = head.clone().lerp(thorax, 0.5).add(new THREE.Vector3(-0.8, 0.4, 0.3));
      this.beam.set([head, mid, thorax]);
    }
  }

  updateLabels(step, delayed = false) {
    if (!this.lbl) {
      this.lbl = {
        worm: this.label({ html: '<span class="b3-tag is-hot">мозг червя · 302 нейрона</span>', position: [0, 0, 0], anchor: 'bottom', visible: false }),
        body: this.label({ html: '<span class="b3-tag is-dim">тело мухи</span>', position: [0, 0, 0], anchor: 'left', visible: false }),
      };
    }
    // подписи появляются вслед за объектами (червь собирается из частиц ~2 с), а не раньше них
    const later = (key, l, sec) => {
      if (sec <= 0) { this._keyed?.get(key)?.kill(); l.show(); return; }
      this.twk(key, this['_c' + key] || (this['_c' + key] = {}), { duration: sec, onComplete: () => l.show() });
    };
    if (step >= 3) {
      later('lw', this.lbl.worm, delayed ? 2.2 : 0);
      later('lb', this.lbl.body, delayed ? 1.2 : 0);
    } else {
      this._keyed?.get('lw')?.kill(); this._keyed?.get('lb')?.kill();
      this.lbl.worm.hide(); this.lbl.body.hide();
    }
  }

  exit(o = {}) {
    this.removeLabels();
    this.lbl = null;
    return super.exit(o);
  }

  resize() { this.layoutPaper(); if (this.step < 3 && this.active) { this.paperGroup.position.copy(this.paperHome.pos); } }

  update(dt, t) {
    this.paperU.uTime.value = t;
    this.paperGroup.visible = this.paperU.uVis.value > 0.002;
    const on = this.fly.p.wire > 0.002 || this.fly.p.solid > 0.002;
    this.fly.group.visible = on;
    this.floor.mesh.visible = this.floor.uniforms.uVis.value > 0.002;
    this.worm.visible = this.neurU.uK.value > 0.002;
    this.beam.mesh.visible = this.beam.uniforms.uReveal.value > 0.002;
    const eng = this.ctx.engine;
    const pxScale = (eng.height * eng.pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.ctx.camera.fov * 0.5));
    this.neurU.uScale.value = pxScale;
    this.neurU.uTime.value = t;
    this.beam.uniforms.uTime.value = t;
    // червь слегка извивается
    this.worm.rotation.z = 0.05 + Math.sin(t * 0.7) * 0.06;
    this.worm.position.y = 3.35 + Math.sin(t * 0.9) * 0.08;
    if (on) {
      const fly = this.fly;
      fly.setCell(cellPx(eng));
      fly.update(dt, t);
      const g = fly.group, u = this.floor.uniforms;
      this.floorOffset += dt * fly.groundSpeed() * g.scale.x;
      u.uOffset.value = this.floorOffset;
      u.uDir.value.set(Math.sin(g.rotation.y), Math.cos(g.rotation.y));
      this.floor.mesh.position.set(0, g.position.y + fly.ground * g.scale.x, 0);
      u.uCenter.value.set(g.position.x, g.position.z);
      u.uCell.value = cellPx(eng);
    }
    // облако частиц: «пыль» в мире или тело червя
    if (this.ownsParticles()) {
      const w = this.worm;
      const tp = this.particleFrame === 'worm' ? w.position : this._zero || (this._zero = new THREE.Vector3());
      const tq = this.particleFrame === 'worm' ? w.quaternion : this._qid || (this._qid = new THREE.Quaternion());
      const ts = this.particleFrame === 'worm' ? w.scale.x : 1;
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 3);
      this.snap = false;
      const c = this.cur;
      c.pos.lerp(tp, k); c.quat.slerp(tq, k); c.scale += (ts - c.scale) * k;
      const ob = this.particles.object;
      ob.position.copy(c.pos); ob.quaternion.copy(c.quat); ob.scale.setScalar(c.scale);
    }
    if (this.lbl && this.step >= 3) {
      const h = this._lv || (this._lv = new THREE.Vector3());
      this.wormCrv.getPointAt(0.5, h).applyMatrix4(this.worm.matrixWorld);
      lp(this.lbl.worm, h.x, h.y + 0.75, h.z);
      const f = this.fly.group.position;
      lp(this.lbl.body, f.x + 2.6, f.y + 0.2, f.z + 1.0);
    }
  }

  dispose() {
    this.fly?.dispose();
    super.dispose();
  }
}
