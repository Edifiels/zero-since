// «2024: Нобелевская премия по физике — Хопфилду и Хинтону. За нейросети.»
// Медаль в 3D: металл с отражениями окружения, рельеф (карта нормалей из процедурного рисунка),
// зелёный контровой свет, частицы на орбитах; за ней — галактика из общего облака частиц.
// Шаг 1: лента «1943 → 1958 → 2024» — частицы вытягиваются в ленту времени, по ней бегут «кометы».
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { ready, FatLines, GlowPoints, glowSprite, orbMaterial, instAttr, noFade, updateShared, setInstance, phase, pixelScale, spaceEnvMap } from './lib.js';

const MEDAL = { c: [4.55, 0.25, 0], r: 2.45, h: 0.26 };
const MEDAL1 = { c: [5.0, 1.15, 0], s: 0.8 };            // где медаль на шаге 1
// 1943, 1958, 2024 — подпись 1943 (самая широкая) должна целиком помещаться в поля сцены 16:9
const TL = [[-6.3, -3.15, 0.2], [-1.0, -3.0, 0.2], [5.0, -2.35, 0.2]];
const RIBBON = new THREE.CatmullRomCurve3([[-11.5, -3.35, -0.5], [-6.3, -3.15, 0.2], [-1.0, -3.0, 0.2], [2.6, -2.75, 0.2], [5.0, -2.35, 0.2], [7.0, -1.5, -0.3], [8.4, -0.2, -1.0]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));


const ORBIT_VERT = /* glsl */ `
attribute vec4 aOrb;     // радиус, фаза, скорость, кольцо
attribute vec4 aCol;     // цвет, альфа
attribute float aSize;
uniform float uTime, uScale, uFade, uOpacity;
uniform mat3 uRing[3];
varying vec4 vColor;
void main() {
  float a = aOrb.y + uTime * aOrb.z;
  int k = int(aOrb.w + 0.5);
  mat3 R = k == 0 ? uRing[0] : (k == 1 ? uRing[1] : uRing[2]);
  vec3 p = R * vec3(cos(a) * aOrb.x, position.y, sin(a) * aOrb.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uScale / max(0.05, -mv.z);
  float al = aCol.a * uFade * uOpacity;
  // дальняя половина орбиты — тусклее (медаль «впереди»)
  al *= 0.55 + 0.45 * smoothstep(-1.5, 1.5, p.z);
  if (px < 1.5) { al *= px / 1.5; px = 1.5; }
  gl_PointSize = min(px, 48.0);
  vColor = vec4(aCol.rgb, al);
}
`;
const ORBIT_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 6.0);
  gl_FragColor = vec4(vColor.rgb, (core + (1.0 - d) * 0.25) * vColor.a);
}
`;

export default class Nobel extends Visual {
  static transition = 'iris';

  async init() {
    this.fade = { value: 1 };
    this.ph = { tl: 0, spin: 0 };
    this.t0 = 0;
    this.medalGroup = new THREE.Group();
    this.medalGroup.position.set(...MEDAL.c);
    this.root.add(this.medalGroup);
    this.buildMedal();
    this.buildOrbits();
    this.buildTimeline();
    noFade(this.root);
    this.shapes = {};
    // формы частиц — заранее (при фоновой предзагрузке)
    this.shapeFor(0);
    this.shapeFor(1);
  }

  // ---------------------------------------------------------------------------
  reliefCanvas() {
    const N = 1024, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true });
    const C = N / 2, R = N / 2 - 4;
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    // поле медали
    g.fillStyle = 'rgb(90,90,90)';
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();
    // бортик с фаской
    const grd = g.createRadialGradient(C, C, R * 0.88, C, C, R);
    grd.addColorStop(0, 'rgb(90,90,90)');
    grd.addColorStop(0.35, 'rgb(225,225,225)');
    grd.addColorStop(0.75, 'rgb(240,240,240)');
    grd.addColorStop(1, 'rgb(150,150,150)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.arc(C, C, R * 0.9, 0, Math.PI * 2, true); g.fill();
    // тонкое внутреннее кольцо
    g.strokeStyle = 'rgb(200,200,200)';
    g.lineWidth = 7;
    g.beginPath(); g.arc(C, C, R * 0.64, 0, Math.PI * 2); g.stroke();
    // надпись по кругу
    const text = 'НОБЕЛЕВСКАЯ ПРЕМИЯ ПО ФИЗИКЕ · 2024 · ';
    g.fillStyle = 'rgb(215,215,215)';
    g.font = '700 54px Unbounded';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const rr = R * 0.77;
    let total = 0;
    const widths = [...text].map((ch) => { const w = g.measureText(ch).width + 6; total += w; return w; });
    const k = (Math.PI * 2 * rr) / total;
    let a = -Math.PI / 2 - ((widths[0] * k) / rr) / 2;
    [...text].forEach((ch, i) => {
      const w = widths[i] * k;
      const mid = a + (w / 2) / rr;
      g.save();
      g.translate(C + Math.cos(mid) * rr, C + Math.sin(mid) * rr);
      g.rotate(mid + Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
      a += w / rr;
    });
    // в центре — сеть Хопфилда: каждый нейрон связан с каждым
    const nodes = [];
    for (let i = 0; i < 6; i++) { const t = -Math.PI / 2 + (i / 6) * Math.PI * 2; nodes.push([C + Math.cos(t) * R * 0.4, C + Math.sin(t) * R * 0.4]); }
    g.strokeStyle = 'rgb(185,185,185)';
    g.lineWidth = 11;
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { g.beginPath(); g.moveTo(...nodes[i]); g.lineTo(...nodes[j]); g.stroke(); }
    nodes.forEach(([x, y]) => {
      const gg = g.createRadialGradient(x - 8, y - 8, 4, x, y, 40);
      gg.addColorStop(0, 'rgb(255,255,255)');
      gg.addColorStop(1, 'rgb(205,205,205)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(x, y, 38, 0, Math.PI * 2); g.fill();
    });
    return c;
  }

  normalFromHeight(src, strength = 3.2, blur = 2, dome = 0) {
    const N = src.width;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = N;
    const tg = tmp.getContext('2d', { willReadFrequently: true });
    tg.filter = `blur(${blur}px)`;
    tg.drawImage(src, 0, 0);
    const h = tg.getImageData(0, 0, N, N).data;
    const out = tg.createImageData(N, N);
    const o = out.data;
    const H = (x, y) => h[(Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))) * 4] / 255;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const ex = (x - N / 2) / (N / 2), ey = (y - N / 2) / (N / 2);
        const inside = ex * ex + ey * ey < 0.81 ? 1 : 0;
        let nx = -dx + ex * dome * inside, ny = dy - ey * dome * inside, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const j = (y * N + x) * 4;
        o[j] = (nx * 0.5 + 0.5) * 255; o[j + 1] = (ny * 0.5 + 0.5) * 255; o[j + 2] = (nz * 0.5 + 0.5) * 255; o[j + 3] = 255;
      }
    }
    tg.filter = 'none';
    tg.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(tmp);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  }

  buildMedal() {
    const { r, h } = MEDAL;
    const geo = new THREE.CylinderGeometry(r, r, h, 160, 1, false);
    geo.rotateX(Math.PI / 2);
    // UV лицевых сторон — прямо по X/Y (рисунок стоит ровно)
    const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nrm.getZ(i)) > 0.9) {
        const sx = nrm.getZ(i) > 0 ? 1 : -1;
        uv.setXY(i, (pos.getX(i) * sx) / (2 * r) + 0.5, pos.getY(i) / (2 * r) + 0.5);
      }
    }
    uv.needsUpdate = true;
    const relief = this.reliefCanvas();
    const nmap = this.normalFromHeight(relief, 3.4, 2, 0.32);
    // гурт — рифление
    const gc = document.createElement('canvas');
    gc.width = 1024; gc.height = 8;
    const gg = gc.getContext('2d');
    for (let x = 0; x < 1024; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / 1024) * Math.PI * 2 * 140);
      gg.fillStyle = `rgb(${Math.round((0.5 + 0.45 * Math.cos((x / 1024) * Math.PI * 2 * 140)) * 255)},128,${Math.round((0.75 + 0.25 * v) * 255)})`;
      gg.fillRect(x, 0, 1, 8);
    }
    const gt = new THREE.CanvasTexture(gc);
    gt.colorSpace = THREE.NoColorSpace;
    this.envRT = spaceEnvMap(this.ctx.renderer);
    const env = this.envRT.texture;
    const gold = new THREE.Color('#ead9a8');
    const face = new THREE.MeshPhysicalMaterial({ color: gold, metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 1.25, normalMap: nmap, normalScale: new THREE.Vector2(1.25, 1.25), clearcoat: 0.15, clearcoatRoughness: 0.35, transparent: true });
    const side = new THREE.MeshPhysicalMaterial({ color: gold, metalness: 1, roughness: 0.4, envMap: env, envMapIntensity: 1.2, normalMap: gt, normalScale: new THREE.Vector2(0.8, 0.8), transparent: true });
    this.medalMats = [face, side];
    this.medal = new THREE.Mesh(geo, [side, face, face]);
    this.medalGroup.add(this.medal);
    // свечение за медалью
    this.halo = glowSprite('#00ff00', 9.5, 0.75);
    this.halo.position.set(0, 0, -1.2);
    this.medalGroup.add(this.halo);
  }

  buildOrbits() {
    const n = 5200;
    const r = rng(2024);
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), orb = new Float32Array(n * 4), col = new Float32Array(n * 4), size = new Float32Array(n);
    const rings = [3.0, 3.55, 4.15];
    for (let i = 0; i < n; i++) {
      const k = i % 3;
      const R = rings[k] + r.gauss(0, 0.08 + k * 0.03);
      p[i * 3 + 1] = r.gauss(0, 0.04);
      orb.set([R, r() * Math.PI * 2, (0.35 + 0.15 * k) * (k === 1 ? -1 : 1) * r.range(0.9, 1.1), k], i * 4);
      const hot = r() < 0.12;
      const c = hot ? [1.6, 1.8, 1.6] : r() < 0.6 ? [0.2, 1.3, 0.25] : [0.8, 1.0, 0.8];
      col.set([...c, r.range(0.35, 0.9)], i * 4);
      size[i] = hot ? r.range(0.07, 0.11) : r.range(0.035, 0.07);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aOrb', new THREE.BufferAttribute(orb, 4));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const ring = (x, y, z) => new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z)));
    this.orbU = {
      uTime: { value: 0 }, uScale: { value: 1000 }, uFade: this.fade, uOpacity: { value: 1 },
      uRing: { value: [ring(1.25, 0.2, 0.35), ring(1.45, -0.5, -0.45), ring(0.95, 0.6, 0.15)] },
    };
    const m = new THREE.ShaderMaterial({ uniforms: this.orbU, vertexShader: ORBIT_VERT, fragmentShader: ORBIT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.orbits = new THREE.Points(g, m);
    this.orbits.frustumCulled = false;
    this.medalGroup.add(this.orbits);
  }

  buildTimeline() {
    // Лента «1943 → 1958 → 2024»: появление узлов, «прорисовка» линии и бег комет — в шейдерах
    // (каждый кадр меняются только uniform'ы uTl/uT/uTT, буферы статичны).
    this.tlU = { uTl: { value: 0 }, uT: { value: 0 }, uTT: { value: 0 } };
    // узлы-годы
    this.tlMat = orbMaterial({
      color: '#00ff00', intensity: 1, fill: 0.2, rim: 1.3, core: 0.12, fade: this.fade, uniforms: this.tlU,
      vertexHead: 'attribute float aIdx; uniform float uTl, uT, uTT;',
      vertexBody: `
        float k = smoothstep(0.25 + aIdx * 0.2, 0.45 + aIdx * 0.2, uTl);
        s = vec3(0.42 * k * (1.0 + 0.08 * sin(uT * 2.2 + aIdx)));
        float q = (mod(uTT * 0.5, 1.5) - aIdx * 0.5) / 0.18;
        tint = vec3(k * (0.9 + 0.5 * exp(-q * q) + (aIdx > 1.5 ? 0.5 : 0.0)));`,
    });
    this.tlNodes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 28, 20), this.tlMat, 3);
    this.tlNodes.frustumCulled = false;
    TL.forEach((p, i) => setInstance(this.tlNodes, i, p[0], p[1], p[2], 1));
    instAttr(this.tlNodes, 'aIdx', 1, [0, 1, 2]);
    this.root.add(this.tlNodes);
    // линия ленты (тонкая основа) + связь 2024 → медаль (data.z = 1); «прорисовка» слева направо — в шейдере
    const n = 120;
    const pts = RIBBON.getSpacedPoints(n);
    this.tlLine = new FatLines(n + 1, {
      width: 3, color: '#7dff6e', intensity: 1.1, fade: this.fade, uniforms: this.tlU,
      vertexHead: 'uniform float uTl;',
      vertexBody: 'data.w = data.z > 0.5 ? 0.7 * smoothstep(0.85, 1.0, uTl) : 0.7 * smoothstep(data.x - 0.05, data.x + 0.02, uTl * 1.08);',
    });
    for (let i = 0; i < n; i++) {
      this.tlLine.setEdge(i, pts[i].toArray(), pts[i + 1].toArray());
      this.tlLine.setData(i, i / n, 1, 0, 0);
    }
    this.tlLine.setEdge(n, TL[2], [MEDAL1.c[0], MEDAL1.c[1] - MEDAL.r * MEDAL1.s - 0.1, 0]);
    this.tlLine.setData(n, 1, 1, 1, 0);
    this.tlLine.commit();
    this.root.add(this.tlLine.mesh);
    // «кометы» по ленте: точка ленты — по 64 опорным точкам (uniform-массив), 8 «дорожек» × (голова + 5 хвост)
    const RN = 64;
    this.ribPts = RIBBON.getSpacedPoints(RN - 1);
    this.comets = new GlowPoints(48, {
      fade: this.fade,
      uniforms: { ...this.tlU, uRib: { value: this.ribPts } },
      vertexHead: `
        attribute vec2 aC;
        uniform float uTl, uTT;
        uniform vec3 uRib[${RN}];
        vec3 ribbonAt(float u) {
          float f = clamp(u, 0.0, 1.0) * ${RN - 1}.0;
          int i = int(floor(f));
          int j = min(i + 1, ${RN - 1});
          return mix(uRib[i], uRib[j], f - float(i));
        }`,
      vertexBody: `
        float lane = aC.x, j = aC.y;
        float u = fract(uTT * 0.085 + lane * 0.125) - j * 0.006;
        if (u < 0.0 || u > 1.0) {
          col.a = 0.0;
        } else {
          pos = ribbonAt(u) + vec3(0.0, sin(lane * 2.1 + uTT) * 0.06, 0.15);
          bool head = j < 0.5;
          size = head ? 0.32 : 0.18;
          float a = uTl * (head ? 1.0 : 0.5 - j * 0.07) * smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.94, 1.0, u));
          col = head ? vec4(1.4, 2.2, 1.4, a) : vec4(0.4, 1.6, 0.4, a);
        }`,
    });
    this.comets.attr('aC', 2, Array.from({ length: 48 }, (_, i) => [Math.floor(i / 6), i % 6]).flat());
    this.comets.commit();
    this.root.add(this.comets.points);
  }

  // ---------------------------------------------------------------------------
  galaxyShape(n) {
    const g = S.galaxy(n, { radius: 10, arms: 2, twist: 1.2, thickness: 0.3, brightness: 0.65, seed: 24 });
    S.fade(g, 0.55);
    S.transform(g, { rotation: [1.15, 0, -0.35], position: [MEDAL.c[0] - 0.6, MEDAL.c[1] - 0.4, -7.5] });
    return g;
  }

  ribbonShape(n) {
    const r = rng(1958);
    const parts = [
      { weight: 0.42, shape: (m) => {
        const s = S.createShape(m);
        const v = new THREE.Vector3();
        for (let i = 0; i < m; i++) {
          const t = r();
          RIBBON.getPointAt(t, v);
          const w = 0.22 + 0.25 * Math.sin(t * Math.PI);
          const cc = r() < 0.3 ? S.PAL.greenHi : r() < 0.6 ? S.PAL.mint : S.PAL.white;
          S.setPoint(s, i, v.x + r.gauss(0, 0.05), v.y + r.gauss(0, w * 0.35), v.z + r.gauss(0, w), r.range(0.4, 0.95), cc, r.range(0.2, 0.55));
        }
        return s;
      } },
      { weight: 0.1, shape: (m) => {
        const s = S.createShape(m);
        for (let i = 0; i < m; i++) {
          const c = TL[i % 3];
          const [x, y, z] = r.onSphere(0.62 + r.gauss(0, 0.05));
          S.setPoint(s, i, c[0] + x, c[1] + y, c[2] + z, r.range(0.5, 1), r() < 0.4 ? S.PAL.greenHi : S.PAL.white, 0.4);
        }
        return s;
      } },
      { weight: 0.48, shape: (m) => {
        const g = this.galaxyShape(m);
        return S.fade(g, 0.7);
      } },
    ];
    return S.combine(n, parts);
  }

  shapeFor(step) {
    const n = this.ctx.particles.count;
    const key = step + ':' + n;
    if (!this.shapes[key]) this.shapes[key] = ready(step === 0 ? this.galaxyShape(n) : this.ribbonShape(n));
    return this.shapes[key];
  }

  // ---------------------------------------------------------------------------
  camera(state, step) {
    // для 16:9; под 4:3/16:10 подгоняет ядро (director.fitPose)
    return step >= 1 ? { pos: [0, -0.15, 14], target: [0, -0.15, 0], fov: 45 } : { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 };
  }

  background(state, step) { return { glows: [[0.55, 0.05, 0.62, 0.62], [-0.95, -0.65, 0.35, 0.3]], band: null }; }

  makeLabels() {
    this.removeLabels();
    const data = [['1943', 'нейрон на&nbsp;языке математики'], ['1958', 'персептрон Розенблатта'], ['2024', 'Нобелевская премия']];
    this.tlLabels = data.map(([y, t], i) => this.label({
      html: `<div class="b2b-tl"><span class="b2b-tl-year">${y}</span><span class="b2b-tl-text">${t}</span></div>`,
      position: [TL[i][0], TL[i][1] - 0.62, TL[i][2]],
      anchor: 'top',
      visible: false,
    }));
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    phase(this, this.ph, 'tl', step >= 1 ? 1 : 0, { duration: inst ? 0 : step >= 1 ? 2.6 : 1.0, ease: step >= 1 ? 'power1.inOut' : 'power2.in' });
    const p = this.particles;
    p.setParams({ noise: step >= 1 ? 0.12 : 0.18, swirl: 0, size: 0.06, twinkle: 0.4, spring: 15, damping: 5.5 }, inst ? 0 : 1.2);
    p.morph(this.shapeFor(step >= 1 ? 1 : 0), { duration: inst ? 0.01 : 2.4, stagger: 0.5, burst: 10 });
    // подписи лет — по очереди, вслед за «прорисовкой» ленты (отложенные вызовы отменяются при смене шага/уходе)
    this._lblCalls?.forEach((c) => c.kill());
    this._lblCalls = [];
    this.tlLabels.forEach((l, i) => {
      if (step < 1) l.hide();
      else if (inst) l.show();
      else this._lblCalls.push(this.delay(0.7 + i * 0.52, () => { if (this.step >= 1 && this.active) l.show(); }));
    });
  }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const obj = this.particles.object;
    const d = o.instant ? 0 : 1.4;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    updateShared(this.ctx);
    this.tlLine.resize(this.ctx);
    this.makeLabels();
    this.ph.tl = this.step >= 1 ? 1 : 0;
    // медаль влетает с оборотом
    this.ph.spin = o.instant ? 1 : 0;
    if (!o.instant) phase(this, this.ph, 'spin', 1, { duration: 2.6, ease: 'expo.out', delay: 0.15 });
    this.t0 = this.ctx.time;
    this.apply(this.step, o);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  exit(o = {}) {
    this._lblCalls?.forEach((c) => c.kill());
    this.tlLabels?.forEach((l) => l.hide());
    return super.exit(o);
  }

  dispose() {
    super.dispose();
    this.envRT?.dispose();
    this.envRT = null;
  }

  resize() {
    updateShared(this.ctx);
    this.tlLine.resize(this.ctx);
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const fade = this.fade.value;
    const T = t - this.t0;
    const { tl, spin } = this.ph;
    // медаль: оборот при входе, затем лёгкое покачивание (блики бегут по рельефу)
    const mg = this.medalGroup;
    const sc = 1 + (MEDAL1.s - 1) * tl;
    mg.position.set(MEDAL.c[0] + (MEDAL1.c[0] - MEDAL.c[0]) * tl, MEDAL.c[1] + (MEDAL1.c[1] - MEDAL.c[1]) * tl, (1 - spin) * -6);
    mg.scale.setScalar(sc * (0.55 + 0.45 * spin));
    this.medal.rotation.y = (1 - spin) * Math.PI * 3 - 0.12 + Math.sin(t * 0.45) * 0.36;
    this.medal.rotation.x = 0.2 + Math.sin(t * 0.31) * 0.08;
    this.medal.rotation.z = Math.sin(t * 0.23) * 0.04;
    this.medalMats.forEach((m) => { m.opacity = fade; });
    this.halo.material.opacity = (0.32 + 0.08 * Math.sin(t * 1.3)) * fade;
    this.orbU.uTime.value = t;
    this.orbU.uScale.value = pixelScale(this.ctx);
    this.orbU.uOpacity.value = 0.25 + 0.75 * spin;

    // лента времени
    const vis = tl > 0.003;
    this.tlNodes.visible = vis;
    this.tlLine.mesh.visible = vis;
    this.comets.points.visible = vis;
    if (vis) {
      // узлы, «прорисовка» линии и кометы — в шейдерах; здесь только uniform'ы
      const u = this.tlU;
      u.uTl.value = tl;
      u.uT.value = t;
      u.uTT.value = T;
      this.comets.update(this.ctx);
    }
    if (this.ownsParticles()) {
      this.particles.object.rotation.z = 0;
    }
  }
}
