// Блок 3. Курьёз: цифровая муха в пиксельном коридоре ретро-шутера растерянно врезается в стены.
// Коридор рендерится в маленькую текстуру 320×180 (NearestFilter — честная пикселизация), затем экран-шейдер
// переводит картинку в зелёную палитру с упорядоченным дизерингом и сканлайнами.
// HUD (HTML, пиксельный шрифт) обновляется отсюда: data-doom="hp" | "hits" | "msg".
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { FlyModel } from './fly-model.js';
import { eqShape } from './common.js';

const RT_W = 320, RT_H = 180;
const WALL_X = 2.2, CEIL = 3.2, SEG = 4, NSEG = 14, LOOP = 16;
// экран в единицах сцены 16:9 (u)
const SCREEN = { left: 17, top: 8.6, width: 66 };

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SCREEN_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uOpacity;
uniform float uFlash;
uniform float uTime;
uniform float uBoot;
varying vec2 vUv;
float bayer4(vec2 p) {
  vec2 q = mod(p, 4.0);
  float x = q.x, y = q.y;
  float b = 0.0;
  if (y < 1.0) b = x < 1.0 ? 0.0 : x < 2.0 ? 8.0 : x < 3.0 ? 2.0 : 10.0;
  else if (y < 2.0) b = x < 1.0 ? 12.0 : x < 2.0 ? 4.0 : x < 3.0 ? 14.0 : 6.0;
  else if (y < 3.0) b = x < 1.0 ? 3.0 : x < 2.0 ? 11.0 : x < 3.0 ? 1.0 : 9.0;
  else b = x < 1.0 ? 15.0 : x < 2.0 ? 7.0 : x < 3.0 ? 13.0 : 5.0;
  return (b + 0.5) / 16.0;
}
void main() {
  // лёгкая «бочка» кинескопа
  vec2 c = vUv - 0.5;
  vec2 uv = 0.5 + c * (1.0 + 0.035 * dot(c, c));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity); return; }
  vec2 px = floor(uv * uRes);
  vec3 src = texture2D(uTex, (px + 0.5) / uRes).rgb;
  float l = dot(src, vec3(0.299, 0.587, 0.114));
  l = clamp(l * 1.25 + uFlash * 0.6, 0.0, 1.0);
  // 5 уровней зелёной палитры + дизеринг
  float lv = l * 4.0 + (bayer4(px) - 0.5) * 0.9;
  float q = clamp(floor(lv + 0.5), 0.0, 4.0);
  vec3 pal0 = vec3(0.004, 0.02, 0.006);
  vec3 pal1 = vec3(0.01, 0.09, 0.02);
  vec3 pal2 = vec3(0.03, 0.26, 0.05);
  vec3 pal3 = vec3(0.12, 0.6, 0.13);
  vec3 pal4 = vec3(0.55, 0.85, 0.5);
  vec3 col = q < 0.5 ? pal0 : q < 1.5 ? pal1 : q < 2.5 ? pal2 : q < 3.5 ? pal3 : pal4;
  // сканлайны и виньетка
  float scan = 0.82 + 0.18 * sin(uv.y * uRes.y * 3.14159 * 2.0);
  col *= scan;
  col *= 1.0 - 0.55 * dot(c, c) * 2.0;
  // включение экрана
  float boot = smoothstep(0.0, 1.0, uBoot);
  float band = 1.0 - smoothstep(0.0, 0.02, abs(uv.y - 0.5) - boot * 0.52);
  col *= band;
  col += vec3(0.4, 1.0, 0.5) * (1.0 - boot) * band * 0.5;
  gl_FragColor = vec4(col, uOpacity);
}
`;

const BEZEL_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSize;
uniform float uTime;
varying vec2 vUv;
float rbox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = rbox(p, uSize * 0.5 - 0.35, 0.25);
  float edge = exp(-abs(d) * 9.0);
  float glow = exp(-max(d, 0.0) * 2.5) * step(0.0, d);
  float body = step(d, 0.0);
  vec3 col = vec3(0.01, 0.025, 0.012) * body + vec3(0.25, 1.0, 0.35) * (edge * 0.9 + glow * 0.18);
  float a = clamp(body * 0.96 + edge + glow * 0.35, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

// ---------- Пиксельные текстуры коридора ----------
function pixTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const gray = (v) => `rgb(${v},${v},${v})`;

function makeTextures() {
  const r = rng(66);
  const brick = pixTex(64, 64, (g) => {
    g.fillStyle = gray(40); g.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 8 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * 16 + off, y = row * 8;
        const v = 120 + Math.floor(r() * 50);
        g.fillStyle = gray(v); g.fillRect(x + 1, y + 1, 14, 6);
        g.fillStyle = gray(v + 25); g.fillRect(x + 1, y + 1, 14, 1);
      }
    }
    for (let i = 0; i < 140; i++) { g.fillStyle = gray(60 + Math.floor(r() * 80)); g.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1); }
  });
  const floor = pixTex(64, 64, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = gray((x + y) % 2 ? 70 : 95); g.fillRect(x * 16, y * 16, 16, 16);
      g.fillStyle = gray(45); g.fillRect(x * 16, y * 16, 16, 1); g.fillRect(x * 16, y * 16, 1, 16);
    }
    for (let i = 0; i < 160; i++) { g.fillStyle = gray(50 + Math.floor(r() * 60)); g.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1); }
  });
  const ceil = pixTex(64, 64, (g) => {
    g.fillStyle = gray(55); g.fillRect(0, 0, 64, 64);
    g.fillStyle = gray(35); for (let i = 0; i < 64; i += 16) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
    g.fillStyle = gray(235); g.fillRect(20, 20, 24, 24);
    g.fillStyle = gray(180); g.fillRect(22, 22, 20, 20);
  });
  const panel = pixTex(32, 64, (g) => {
    g.fillStyle = gray(90); g.fillRect(0, 0, 32, 64);
    g.fillStyle = gray(150); for (let y = 4; y < 64; y += 10) g.fillRect(3, y, 26, 3);
    g.fillStyle = gray(220); g.fillRect(12, 28, 8, 8);
  });
  const barrel = pixTex(32, 32, (g) => {
    g.fillStyle = gray(110); g.fillRect(0, 0, 32, 32);
    g.fillStyle = gray(60); g.fillRect(0, 4, 32, 3); g.fillRect(0, 25, 32, 3);
    g.fillStyle = gray(200); g.fillRect(4, 10, 4, 12);
    g.fillStyle = gray(150); g.fillRect(14, 12, 6, 6);
  });
  return { brick, floor, ceil, panel, barrel };
}

export default class Doom extends Visual {
  static transition = 'glitch';

  async init() {
    const n = this.ctx.particles.count;
    // --- мир ретро-шутера
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x000000);
    sc.fog = new THREE.Fog(0x000000, 3, 19);
    this.dScene = sc;
    this.dCam = new THREE.PerspectiveCamera(72, RT_W / RT_H, 0.05, 60);
    const tx = makeTextures();
    this.dTex = tx;
    const mat = (map, rep) => { const m = new THREE.MeshBasicMaterial({ map, fog: true }); m.userData.noFade = true; if (rep) { map.repeat.set(...rep); } return m; };
    const wallMat = mat(tx.brick, [SEG / 2, CEIL / 2]);
    const floorMat = mat(tx.floor, [WALL_X, SEG / 2]);
    const ceilMat = mat(tx.ceil, [WALL_X / 2, SEG / 2]);
    const panelMat = mat(tx.panel);
    const barrelMat = mat(tx.barrel);
    const g = new THREE.Group();
    sc.add(g);
    const wallGeo = new THREE.PlaneGeometry(SEG, CEIL);
    const floorGeo = new THREE.PlaneGeometry(WALL_X * 2, SEG);
    for (let i = 0; i < NSEG; i++) {
      const z = -i * SEG + 6;
      const fl = new THREE.Mesh(floorGeo, floorMat); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0, z - SEG / 2); g.add(fl);
      const ce = new THREE.Mesh(floorGeo, ceilMat); ce.rotation.x = Math.PI / 2; ce.position.set(0, CEIL, z - SEG / 2); g.add(ce);
      const wl = new THREE.Mesh(wallGeo, wallMat); wl.rotation.y = Math.PI / 2; wl.position.set(-WALL_X, CEIL / 2, z - SEG / 2); g.add(wl);
      const wr = new THREE.Mesh(wallGeo, wallMat); wr.rotation.y = -Math.PI / 2; wr.position.set(WALL_X, CEIL / 2, z - SEG / 2); g.add(wr);
      // светящиеся панели и колонны — через сегмент (период повтора — LOOP)
      if (i % 2 === 0) {
        for (const s of [-1, 1]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, CEIL, 0.5), panelMat);
          col.position.set(s * (WALL_X - 0.17), CEIL / 2, z);
          g.add(col);
        }
      }
      if (i % 4 === 1) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.85, 10), barrelMat);
        b.position.set((i % 8 === 1 ? -1 : 1) * (WALL_X - 0.5), 0.43, z - 2);
        g.add(b);
      }
    }
    // дальняя стена-«тупик» не нужна — туман прячет конец коридора

    // муха
    const fly = new FlyModel({ seed: 11 });
    Object.assign(fly.p, { solid: 1, wire: 0.6, flight: 1, hover: 1, glow: 1.6 });
    fly.wingHz = 7;
    fly.setCell(3);
    // в тёмном коридоре муха должна читаться: светлое тело
    for (const m of [fly.matBody, fly.matHead, fly.matLeg]) m.uniforms.uBase.value.set('#e6efe6');
    fly.matAbd.uniforms.uBase.value.set('#f2f7f2');
    fly.group.scale.setScalar(0.52);
    sc.add(fly.group);
    this.fly = fly;
    this.fs = { x: 0, y: 1.4, z: 0, vx: 0.6, vy: 0, vz: -1.6, yaw: Math.PI, spin: 0, turn: 0, turnT: 0, dazed: 0 };
    this.camS = { x: 0, y: 1.5, z: 3.4, shake: 0 };
    this.hits = 0;
    this.hp = 100;
    this.rnd = rng(5);

    // --- экран в главной сцене
    this.screenU = {
      uTex: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(RT_W, RT_H) },
      uOpacity: { value: 1 }, uFlash: { value: 0 }, uTime: { value: 0 }, uBoot: { value: 0 },
    };
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 9 / 16), new THREE.ShaderMaterial({
      uniforms: this.screenU, vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, transparent: true,
    }));
    this.screen.renderOrder = 2;
    this.bezelU = { uOpacity: { value: 1 }, uSize: { value: new THREE.Vector2(16, 9) }, uTime: { value: 0 } };
    this.bezel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: this.bezelU, vertexShader: SCREEN_VERT, fragmentShader: BEZEL_FRAG, transparent: true, depthWrite: false,
    }));
    this.bezel.renderOrder = 1;
    this.screenGroup = new THREE.Group();
    this.screenGroup.add(this.bezel, this.screen);
    this.root.add(this.screenGroup);
    this.layout();

    // частицы: светящаяся рамка-«портал» вокруг экрана + редкая пыль
    this.shapes = { frame: null };
    this.buildFrame(n);
  }

  layout() {
    // экран — точно под HTML-HUD: сцена 16:9 в мире = vh × 16/9 на любом экране (камеру подгоняет ядро)
    const h = 2 * 14 * Math.tan(THREE.MathUtils.degToRad(22.5));
    const w = h * 16 / 9;
    const sw = (SCREEN.width / 100) * w, sh = sw * 9 / 16;
    const cx = ((SCREEN.left + SCREEN.width / 2) / 100 - 0.5) * w;
    const cy = (0.5 - (SCREEN.top + (SCREEN.width * 9 / 16) / 2) / 56.25) * h;
    this.screenGroup.position.set(cx, cy, 0);
    this.screen.scale.set(sw, sw, 1);
    const pad = 0.55;
    this.bezel.scale.set(sw + pad * 2, sh + pad * 2, 1);
    this.bezel.position.z = -0.02;
    this.bezelU.uSize.value.set(sw + pad * 2, sh + pad * 2);
    this.scr = { cx, cy, sw, sh };
  }

  buildFrame(n) {
    const { cx, cy, sw, sh } = this.scr;
    const r = rng(12);
    const s = S.createShape(n);
    const W = sw + 0.9, H = sh + 0.85;
    const per = 2 * (W + H);
    for (let i = 0; i < n; i++) {
      const k = r();
      if (k < 0.72) {
        // по периметру прямоугольника, с «шлейфом» наружу
        let t = r() * per, x, y;
        if (t < W) { x = -W / 2 + t; y = H / 2; } else if (t < W + H) { x = W / 2; y = H / 2 - (t - W); } else if (t < 2 * W + H) { x = W / 2 - (t - W - H); y = -H / 2; } else { x = -W / 2; y = -H / 2 + (t - 2 * W - H); }
        const out = Math.abs(r.gauss(0, 0.14));
        const nx = Math.abs(x) >= W / 2 - 1e-3 ? Math.sign(x) : 0, ny = nx === 0 ? Math.sign(y) : 0;
        const c = r() < 0.25 ? S.PAL.greenHi : r() < 0.6 ? S.PAL.mint : S.PAL.white;
        S.setPoint(s, i, cx + x + nx * out, cy + y + ny * out, r.gauss(0, 0.25) - 0.4, r.range(0.5, 1.1), c, r.range(0.25, 0.6) * Math.exp(-out * 1.5));
      } else {
        const [x, y, z] = r.inSphere(1);
        S.setPoint(s, i, x * 22, y * 12, z * 10 - 6, r.range(0.4, 0.9), r() < 0.5 ? S.PAL.mint : S.PAL.white, r.range(0.05, 0.22));
      }
    }
    this.shapes.frame = eqShape(s, 1);
  }

  camera() { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; }
  background() { return 'center'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.morph(this.shapes.frame, { duration: o.instant ? 0.01 : 2.0, stagger: 0.5, burst: 10 });
    p.setParams({ noise: 0.25, swirl: 0, size: 0.06, twinkle: 0.5, spring: 16, damping: 5.5 }, o.instant ? 0 : 1);
    this.tw(p.object.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.2 });
    this.tw(p.object.rotation, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.2 });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.2 });
    this.screenU.uBoot.value = o.instant ? 1 : 0;
    if (!o.instant) this.tw(this.screenU.uBoot, { value: 1, duration: 0.9, delay: 0.3, ease: 'power2.out' });
    this.hits = 0; this.hp = 100;
    this.hudEl = null;
    this.msgT = 0;
    this.setStep(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    if (step >= 1 && !o.instant && !o.entering) {
      // «Плохо»: со всего маху — в стену
      const f = this.fs;
      f.vx = (f.x >= 0 ? 1 : -1) * 4.5;
      f.vz = -0.5;
      this.bigHit = true;
    }
  }

  hud(sel) {
    const el = this.ctx.deck?.currentEl;
    if (!el) return null;
    if (!this.hudEl || !this.hudEl.isConnected) this.hudEl = el;
    return this.hudEl.querySelector(`[data-doom="${sel}"]`);
  }

  bump(side, big = false) {
    this.hits++;
    this.hp = Math.max(1, this.hp - (big ? 23 : 7));
    const f = this.fs;
    f.spin = (big ? 16 : 9) * (this.rnd() < 0.5 ? -1 : 1);
    f.dazed = big ? 1.6 : 0.5;
    this.camS.shake = big ? 0.35 : 0.14;
    this.tw(this.screenU.uFlash, { value: 0, duration: big ? 0.7 : 0.35, startAt: { value: big ? 0.9 : 0.45 } });
    if (big) { this.ctx.rig.shake(0.18, 0.5); this.ctx.engine.pulse({ aberration: 1.4, glitch: 0.35 }, 0.6); }
    else this.ctx.engine.pulse({ aberration: 0.5 }, 0.3);
    const msgs = ['ОЙ! СТЕНА', 'ТУДА НЕЛЬЗЯ', 'ОПЯТЬ СТЕНА', 'ГДЕ ВЫХОД?', 'БАМ!'];
    const hp = this.hud('hp'), hits = this.hud('hits'), msg = this.hud('msg');
    if (hp) hp.textContent = this.hp + '%';
    if (hits) hits.textContent = String(this.hits);
    if (msg) {
      msg.textContent = big ? 'ВЫ ВРЕЗАЛИСЬ В СТЕНУ' : msgs[this.hits % msgs.length];
      msg.classList.remove('is-on'); void msg.offsetWidth; msg.classList.add('is-on');
    }
    const face = this.hud('face');
    if (face) { face.classList.add('is-hurt'); clearTimeout(this._faceT); this._faceT = setTimeout(() => face.classList.remove('is-hurt'), 700); }
  }

  exit(o = {}) {
    clearTimeout(this._faceT);
    return super.exit(o);
  }

  update(dt, t) {
    const f = this.fs, r = this.rnd, fly = this.fly;
    const d = Math.min(dt, 1 / 30);
    // --- «пилот» мухи: блуждание, стены, развороты
    if (f.dazed > 0) f.dazed -= d;
    f.turnT -= d;
    if (f.turnT <= 0) { f.turnT = 2.5 + r() * 3; f.turn = r() < 0.3 ? 1 : 0; }
    const want = f.turn ? 1.2 : -1.7;                // иногда разворачивается и летит назад
    f.vz += (want - f.vz) * Math.min(1, d * 1.2) * (f.dazed > 0 ? 0.2 : 1);
    f.vx += (r() - 0.5) * 9 * d;
    f.vy += (r() - 0.5) * 5 * d + (1.5 - f.y) * 0.8 * d;
    f.vx *= Math.exp(-0.3 * d); f.vy *= Math.exp(-1.2 * d);
    if (this.bigHit) { this.bigHit = false; f.vx = (f.x >= 0 ? 1 : -1) * 5; }
    f.x += f.vx * d; f.y += f.vy * d; f.z += f.vz * d;
    const lim = WALL_X - 0.42;
    if (f.x > lim) { f.x = lim; const big = Math.abs(f.vx) > 3.5; f.vx = -Math.abs(f.vx) * 0.6 - 0.6; this.bump(1, big); }
    if (f.x < -lim) { f.x = -lim; const big = Math.abs(f.vx) > 3.5; f.vx = Math.abs(f.vx) * 0.6 + 0.6; this.bump(-1, big); }
    if (f.y < 0.45) { f.y = 0.45; f.vy = Math.abs(f.vy); }
    if (f.y > CEIL - 0.45) { f.y = CEIL - 0.45; f.vy = -Math.abs(f.vy) * 0.5; this.bump(0); }
    // бесшовная петля коридора
    if (f.z < -LOOP) { f.z += LOOP; this.camS.z += LOOP; }
    if (f.z > 2) { f.z = 2; f.vz = -Math.abs(f.vz); }
    // ориентация: по скорости + «кувырки» от ударов
    f.spin *= Math.exp(-3 * d);
    const heading = Math.atan2(f.vx, f.vz);
    f.yaw = heading + Math.sin(t * 2) * 0.1;
    const g = fly.group;
    g.position.set(f.x, f.y, f.z);
    g.rotation.set(0.15 + Math.sin(t * 7) * 0.05 * (f.dazed > 0 ? 3 : 1), f.yaw + f.spin * 0.12 + (f.dazed > 0 ? Math.sin(t * 25) * 0.4 : 0), f.spin * 0.08);
    fly.p.glow = 1.6;
    fly.update(d, t);
    // --- камера «от третьего лица»
    const c = this.camS;
    c.shake *= Math.exp(-6 * d);
    const tz = f.z + 2.5;
    c.x += (f.x * 0.55 - c.x) * Math.min(1, d * 3);
    c.y += (f.y * 0.4 + 0.95 - c.y) * Math.min(1, d * 3);
    c.z += (tz - c.z) * Math.min(1, d * 4);
    const sh = c.shake;
    this.dCam.position.set(c.x + (r() - 0.5) * sh, c.y + (r() - 0.5) * sh, c.z);
    this.dCam.lookAt(f.x * 0.75, f.y * 0.85 + 0.15, f.z - 2.0);
    // --- рендер в маленькую текстуру
    const R = this.ctx.renderer;
    const prev = R.getRenderTarget();
    R.setRenderTarget(this.rt);
    R.render(this.dScene, this.dCam);
    R.setRenderTarget(prev);
    this.screenU.uTime.value = t;
    this.bezelU.uTime.value = t;
    if (this.ownsParticles()) this.particles.object.rotation.z = Math.sin(t * 0.2) * 0.01;
  }

  resize() {
    if (!this.screenGroup) return;
    this.layout();
  }

  dispose() {
    this.rt?.dispose();
    Object.values(this.dTex || {}).forEach((t) => t.dispose());
    this.dScene?.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.fly?.dispose();
    super.dispose();
  }
}
