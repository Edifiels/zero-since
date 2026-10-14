// «Главное отличие»: слева — живая сеть мозга, связи постоянно перестраиваются (нейропластичность).
// Шаг 1: мозгу хватает одной кошки — модели нужна стена из тысяч фото кошек (InstancedMesh, слетаются).
// Шаг 2: стена «отъезжает» — миллиарды картинок (процедурная бесконечная стена).
// Шаг 3: справа обученная сеть покрывается инеем — веса «замораживаются», движение останавливается; мозг — живёт.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { HASH } from '../../core/glsl.js';
import { ready, FatLines, orbMaterial, glowInstancedMaterial, instAttr, noFade, updateShared, sstep, setInstance, phase, glowSprite, pixelScale } from './lib.js';
import { catSideCanvas, catFaceStrokes } from './catdraw.js';

const BC = [-4.75, -0.25, 0];                       // центр мозга
// стена: левый край (точка поворота) — у центра экрана, правая часть уходит вглубь
const WALL = { edge: [0.75, 0.3, 0.2], w: 9.6, h: 6.4, rotY: 0.3, rotY2: 1.12, cell: 0.25, cell2: 0.1 };
const NET = { layers: [4, 6, 6, 4], x: [2.5, 4.6, 6.7, 8.8], y: 0.15, dy: 0.95 };
const ICE = new THREE.Color('#d9f1ff');

// ---------- Шейдер «живых» связей мозга: растут, держатся, втягиваются, по ним бегут импульсы ----------
const SYN_FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uOpacity, uFade, uTime, uLearn;
varying vec2 vST;
varying vec4 vData;   // x — фаза, y — толщина, z — период, w — доля «жизни»
void main() {
  float P = vData.z;
  float tau = mod(uTime + vData.x, P);
  float life = vData.w * P;
  float grow = smoothstep(0.0, 1.1, tau);
  float gone = smoothstep(life, life + 1.1, tau);
  if (vST.y > grow || vST.y < gone) discard;
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vST.x));
  // кончик растущей связи
  float tq = (grow - vST.y) / 0.06;
  float tip = grow < 0.999 ? exp(-tq * tq) : 0.0;
  // импульсы
  float pu = fract(uTime * (0.45 + 0.5 * uLearn) + vData.x * 0.37);
  float pq = (vST.y - pu) / 0.07;
  float pulse = exp(-pq * pq) * step(gone + 0.05, pu) * step(pu, grow);
  vec3 col = uColor * (0.75 + 0.6 * uLearn) + uHot * (tip * 1.2 + pulse * (0.8 + uLearn));
  float a = e * uOpacity * uFade * (0.42 + 0.3 * uLearn + 0.6 * max(tip, pulse));
  gl_FragColor = vec4(col, a);
}
`;

// ---------- Шейдер рёбер модели: «обучение» (мерцание весов) → иней ----------
const NET_FRAG = /* glsl */ `
uniform vec3 uColor, uHot, uIce;
uniform float uOpacity, uFade, uTime, uFreeze, uBuild;
varying vec2 vST;
varying vec4 vData;   // x — слой, y — толщина, z — случайное, w — альфа
${HASH}
void main() {
  float grow = clamp((uBuild * 4.0 - vData.x) , 0.0, 1.0);
  if (vST.y > grow) discard;
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vST.x));
  float fl = hash12(vec2(floor(uTime * 7.0) + vData.z * 91.0, vData.z * 13.0));
  float train = (1.0 - uFreeze);
  float frontF = smoothstep(vData.x / 3.0 - 0.15, vData.x / 3.0 + 0.2, uFreeze * 1.25);
  vec3 c = mix(uColor * (0.45 + 0.9 * fl * train), uIce * 0.9, frontF);
  float a = e * vData.w * uOpacity * uFade * mix(0.35 + 0.6 * fl, 0.75, frontF);
  gl_FragColor = vec4(c, a);
}
`;

// ---------- Плитки-«фото кошек» (InstancedMesh) и бесконечная стена ----------
const PHOTO_COMMON = /* glsl */ `
uniform sampler2D tAtlas;
vec3 bgTint(float k) {
  if (k < 0.25) return vec3(0.02, 0.16, 0.04);
  if (k < 0.5) return vec3(0.01, 0.035, 0.015);
  if (k < 0.75) return vec3(0.03, 0.4, 0.07);
  return vec3(0.72, 0.8, 0.7);
}
vec3 catTint(float k) {
  if (k < 0.25) return vec3(0.85, 0.95, 0.82);
  if (k < 0.5) return vec3(0.25, 0.95, 0.3);
  if (k < 0.75) return vec3(0.92, 0.97, 0.9);
  return vec3(0.02, 0.05, 0.02);
}
// f — координаты внутри фото (0..1), id — тип (0 — профиль, 1 — мордочка), flip
vec4 photo(vec2 f, float id, float flip, float tint, vec2 gx, vec2 gy) {
  vec2 q = f;
  if (flip > 0.5) q.x = 1.0 - q.x;
  vec2 inner = (q - 0.09) / 0.82;
  float inside = step(0.0, inner.x) * step(inner.x, 1.0) * step(0.0, inner.y) * step(inner.y, 1.0);
  vec2 uv = vec2((clamp(inner.x, 0.0, 1.0) + id) * 0.5, clamp(inner.y, 0.0, 1.0));
  float m = textureGrad(tAtlas, uv, gx * vec2(0.61, 1.22), gy * vec2(0.61, 1.22)).r * inside;
  vec3 col = mix(bgTint(tint), catTint(tint), m);
  // рамка фото (не ярче ~0.8 — иначе bloom размывает её в сияние)
  vec2 b = min(f, 1.0 - f);
  float frame = 1.0 - step(0.045, min(b.x, b.y));
  col = mix(col, vec3(0.78), frame * 0.85);
  return vec4(col, 1.0);
}
`;

const GALAXY_XFORM = /* glsl */ `
uniform float uRot, uTilt;
uniform vec3 uGalC;
// позиция в галактике: вращение (чуть быстрее у центра) и наклон диска к зрителю
vec3 galaxyPos(vec3 a, float spread) {
  float ang = uRot * (1.0 + 0.5 / (1.0 + length(a.xz)));
  float ca = cos(ang), sa = sin(ang);
  vec3 g = vec3(ca * a.x - sa * a.z, a.y, sa * a.x + ca * a.z) * spread;
  float ct = cos(uTilt), st = sin(uTilt);
  return uGalC + vec3(g.x, g.y * ct - g.z * st, g.y * st + g.z * ct);
}
`;

const TILE_VERT = /* glsl */ `
attribute vec4 aTile;      // тип, оттенок, отражение, случайное
attribute vec3 aFrom;      // откуда летит
attribute vec4 aGal;       // место в «галактике картинок» + размер
uniform float uIn, uTime, uGal;
varying vec2 vUv;
varying vec4 vTile;
varying float vK;
${GALAXY_XFORM}
void main() {
  vUv = uv;
  vTile = aTile;
  float d = aTile.w * 0.55;
  float k = clamp((uIn - d) / 0.42, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vK = k;
  float ang = (1.0 - k) * (aTile.w - 0.5) * 9.0;
  vec2 rp = vec2(cos(ang) * position.x - sin(ang) * position.y, sin(ang) * position.x + cos(ang) * position.y);
  vec4 target = instanceMatrix * vec4(position, 1.0);
  vec3 start = aFrom + vec3(rp * (0.6 + 1.4 * (1.0 - k)), 0.0) * length(instanceMatrix[0].xyz);
  vec3 p = mix(start, target.xyz, k);
  if (uGal > 0.0001) {
    float gk = clamp((uGal - aTile.w * 0.4) / 0.6, 0.0, 1.0);
    gk = gk * gk * (3.0 - 2.0 * gk);
    vec3 gp = galaxyPos(aGal.xyz, 1.0) + vec3(position.xy * aGal.w, 0.0);
    // по пути — дуга «вверх и вглубь»
    p = mix(p, gp, gk) + vec3(0.0, 0.0, -sin(gk * 3.14159) * 1.5);
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const TILE_FRAG = /* glsl */ `
uniform float uOpacity, uFade;
varying vec2 vUv;
varying vec4 vTile;
varying float vK;
${PHOTO_COMMON}
void main() {
  vec4 p = photo(vUv, vTile.x, vTile.z, vTile.y, dFdx(vUv), dFdy(vUv));
  float a = uOpacity * uFade * smoothstep(0.0, 0.15, vK);
  if (a < 0.003) discard;
  gl_FragColor = vec4(p.rgb, a);
}
`;

// «Пыль» галактики картинок: десятки тысяч крошечных «фото»-точек
const DUST_VERT = /* glsl */ `
attribute vec4 aG;        // позиция в галактике + размер
attribute vec4 aCol;      // цвет + «мигание»
uniform float uScale, uOpacity, uFade, uSpread, uTime;
varying vec4 vCol;
${GALAXY_XFORM}
void main() {
  vec3 p = galaxyPos(aG.xyz, uSpread);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aG.w * uScale / max(0.05, -mv.z);
  float a = uOpacity * uFade;
  float blink = step(0.985, fract(aCol.w * 37.0 + floor(uTime * 2.0) * 0.618));
  if (px < 1.5) { a *= px / 1.5; px = 1.5; }
  gl_PointSize = min(px, 9.0);
  vCol = vec4(mix(aCol.rgb, vec3(0.6, 1.8, 0.6), blink), a);
}
`;
const DUST_FRAG = /* glsl */ `
varying vec4 vCol;
void main() {
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
  float m = 1.0 - smoothstep(0.7, 1.0, max(q.x, q.y));
  gl_FragColor = vec4(vCol.rgb, vCol.a * m);
}
`;

export default class Plasticity extends Visual {
  static transition = 'morph';

  async init() {
    this.fade = { value: 1 };
    this.ph = { wall: 0, zoom: 0, net: 0, freeze: 0, cat: 0, learn: 0 };
    this.t0 = 0;
    this.buildBrainNet();
    this.buildOneCat();
    this.buildWall();
    this.buildModelNet();
    noFade(this.root);
    this.shapes = {};
    // форма частиц — заранее (при фоновой предзагрузке)
    this.shape();
  }

  // ---------------------------------------------------------------------------
  buildBrainNet() {
    const r = rng(86);
    const nodes = [];
    let guard = 0;
    while (nodes.length < 30 && guard++ < 5000) {
      const [x, y, z] = r.inSphere(1);
      const p = [BC[0] + x * 2.7, BC[1] + 0.25 + y * 1.55, BC[2] + z * 1.45];
      if (nodes.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0.72)) nodes.push(p);
    }
    this.bNodes = nodes;
    const edges = [];
    const seen = new Set();
    nodes.forEach((a, i) => {
      const d = nodes.map((b, j) => [j, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])]).filter(([j]) => j !== i).sort((u, v) => u[1] - v[1]);
      for (let k = 0; k < 5; k++) {
        const j = d[k][0];
        const key = i < j ? i + '-' + j : j + '-' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i, j]);
      }
    });
    this.bEdges = edges;
    this.syn = new FatLines(edges.length, {
      width: 4.2, color: '#8dff7d', intensity: 1.35, fade: this.fade, fragment: SYN_FRAG,
      uniforms: { uHot: { value: new THREE.Color('#ffffff').multiplyScalar(1.6) }, uLearn: { value: 0 } },
    });
    edges.forEach(([i, j], k) => {
      const A = nodes[i], B = nodes[j];
      const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
      const L = Math.hypot(dx, dy, dz);
      const kk = 0.2 / L;
      const flip = r() < 0.5;
      const a = [A[0] + dx * kk, A[1] + dy * kk, A[2] + dz * kk], b = [B[0] - dx * kk, B[1] - dy * kk, B[2] - dz * kk];
      this.syn.setEdge(k, flip ? b : a, flip ? a : b);
      const P = r.range(4.5, 9);
      this.syn.setData(k, r() * P, r.range(0.7, 1.3), P, r.range(0.45, 0.78));
    });
    this.syn.commit();
    this.root.add(this.syn.mesh);
    // тела нейронов: пульсация и «вспышка обучения» — в шейдере (матрицы экземпляров статичны)
    this.bU = { uT: { value: 0 }, uLearn: { value: 0 } };
    this.bMat = orbMaterial({
      color: '#00ff00', intensity: 1, fill: 0.18, rim: 1.3, core: 0.1, fade: this.fade, uniforms: this.bU,
      vertexHead: 'attribute float aI; uniform float uT, uLearn;',
      vertexBody: `
        float pulse = 0.5 + 0.5 * sin(uT * 1.7 + aI * 1.3);
        s = vec3(0.15 + 0.035 * pulse + 0.05 * uLearn);
        tint = vec3(0.55 + 0.45 * pulse + 1.1 * uLearn * (0.5 + 0.5 * sin(uT * 9.0 + aI)));`,
    });
    this.bOrbs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 18), this.bMat, nodes.length);
    this.bOrbs.frustumCulled = false;
    nodes.forEach((p, i) => setInstance(this.bOrbs, i, p[0], p[1], p[2], 1));
    instAttr(this.bOrbs, 'aI', 1, nodes.map((_, i) => i));
    this.root.add(this.bOrbs);
  }

  catPhotoAtlas() {
    // 1024×512: слева — кошка в профиль, справа — мордочка (заливка)
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 1024, 512);
    const side = catSideCanvas();
    g.drawImage(side, 40, 12, 488 * (512 / 640) * 1.12, 488 * 1.0);
    const head = catFaceStrokes()[0].pts;
    g.fillStyle = '#fff';
    g.beginPath();
    head.forEach(([x, y], i) => (i ? g.lineTo(512 + x * 0.92 + 20, y * 0.92 + 20) : g.moveTo(512 + x * 0.92 + 20, y * 0.92 + 20)));
    g.closePath();
    g.fill();
    // глаза — прорези
    g.fillStyle = '#000';
    [192, 320].forEach((cx) => { g.beginPath(); g.ellipse(512 + cx * 0.92 + 20, 272 * 0.92 + 20, 26, 16, 0, 0, Math.PI * 2); g.fill(); });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  tileUniforms(extra = {}) {
    // общие uniform'ы «галактики» (один объект на все материалы плиток и пыли)
    if (!this.galU) this.galU = { uRot: { value: 0 }, uTilt: { value: -0.92 }, uGalC: { value: new THREE.Vector3(4.7, 0.15, -1.4) } };
    return { tAtlas: { value: this.atlas }, uOpacity: { value: 0 }, uFade: this.fade, uIn: { value: 1 }, uTime: { value: 0 }, uGal: { value: 0 }, ...this.galU, ...extra };
  }

  buildOneCat() {
    // одна кошка рядом с «мозгом» — то самое «одного-двух примеров хватает»
    this.atlas = this.catPhotoAtlas();
    const m = new THREE.ShaderMaterial({ uniforms: this.tileUniforms(), vertexShader: TILE_VERT, fragmentShader: TILE_FRAG, transparent: true, depthWrite: false });
    this.oneCat = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, 1);
    this.oneCat.frustumCulled = false;
    const g = this.oneCat.geometry;
    // оттенок 0.3: зелёная кошка на тёмном фото (бледная кошка + bloom выгорала в белое пятно)
    g.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array([0, 0.3, 0, 0.0]), 4));
    g.setAttribute('aFrom', new THREE.InstancedBufferAttribute(new Float32Array([BC[0] - 6, BC[1] + 4, 3]), 3));
    g.setAttribute('aGal', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4));
    // между мозгом и стеной фото — не перекрывает облако мозга
    this.oneCatPos = [-0.62, 0.95, 1.4];
    const os = 1.6;
    setInstance(this.oneCat, 0, ...this.oneCatPos, os);
    this.root.add(this.oneCat);
    this.oneGlow = glowSprite('#00ff00', 2.8, 0.4);
    this.oneGlow.position.set(this.oneCatPos[0], this.oneCatPos[1], 1.2);
    this.root.add(this.oneGlow);
    // «взгляд» мозга на единственный пример
    this.oneLink = new FatLines(2, { width: 2.4, color: '#00ff00', intensity: 1.0, fade: this.fade });
    const [ox, oy, oz] = this.oneCatPos;
    this.oneLink.setEdge(0, [ox - os / 2 - 0.04, oy + os * 0.32, oz], [BC[0] + 2.4, BC[1] + 1.1, 0.6]);
    this.oneLink.setEdge(1, [ox - os / 2 - 0.04, oy - os * 0.32, oz], [BC[0] + 2.4, BC[1] - 0.2, 0.6]);
    this.oneLink.commit();
    this.root.add(this.oneLink.mesh);
  }

  /** Точка в спиральной галактике (локально, диск в плоскости XZ). */
  galPoint(r, R, rMin = 0.35) {
    const arm = r() < 0.5 ? 0 : 1;
    // экспоненциальный диск без «скопления» на минимальном радиусе (иначе ядро выгорает)
    const rad = Math.min(R, rMin + -Math.log(1 - r() * 0.97) * (R - rMin) * 0.3);
    const th = arm * Math.PI + 2.3 * Math.log(rad / 0.35 + 1) + r.gauss(0, 0.32 * (1.1 - rad / R * 0.5));
    return [Math.cos(th) * rad, r.gauss(0, 0.08 + 0.05 * (1 - rad / R)), Math.sin(th) * rad, rad];
  }

  buildWall() {
    // тысячи «фото» — слетаются в стену; на шаге 2 — разлетаются в спиральную «галактику картинок»
    const { w, h, cell } = WALL;
    const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
    const n = cols * rows;
    this.wallN = n;
    const mat = new THREE.ShaderMaterial({ uniforms: this.tileUniforms({ uIn: { value: 0 } }), vertexShader: TILE_VERT, fragmentShader: TILE_FRAG, transparent: true, depthWrite: false });
    this.tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
    this.tiles.frustumCulled = false;
    const aTile = new Float32Array(n * 4), aFrom = new Float32Array(n * 3), aGal = new Float32Array(n * 4);
    const r = rng(5);
    this.wallGroup = new THREE.Group();
    this.wallGroup.position.set(...WALL.edge);
    this.wallGroup.rotation.y = WALL.rotY;
    this.root.add(this.wallGroup);
    const m4 = new THREE.Matrix4();
    const R = 4.7;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const x = (i + 0.5) * cell, y = (j + 0.5) * cell - (rows * cell) / 2;
        m4.makeScale(cell * 0.94, cell * 0.94, 1).setPosition(x, y, 0);
        this.tiles.setMatrixAt(k, m4);
        // задержка — от центра к краям, с разбросом
        const dist = Math.hypot((x - w / 2) / (w / 2), y / (h / 2));
        aTile.set([r() < 0.62 ? 0 : 1, r(), r() < 0.5 ? 1 : 0, Math.min(1, dist * 0.55 + r() * 0.45)], k * 4);
        // летят «из космоса» — из-за камеры и сбоку
        aFrom.set([x + r.range(-6, 6), y + r.range(-5, 5), r.range(4, 11)], k * 3);
        const [gx, gy, gz, rad] = this.galPoint(r, R, 0.7);
        aGal.set([gx, gy, gz, cell * (1.05 - 0.55 * (rad / R)) * r.range(0.7, 1.1)], k * 4);
      }
    }
    this.tiles.geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(aTile, 4));
    this.tiles.geometry.setAttribute('aFrom', new THREE.InstancedBufferAttribute(aFrom, 3));
    this.tiles.geometry.setAttribute('aGal', new THREE.InstancedBufferAttribute(aGal, 4));
    this.wallGroup.add(this.tiles);
    // пыль галактики — десятки тысяч крошечных «фото»
    const nd = this.ctx.quality === 'low' ? 14000 : 36000;
    const gp = new Float32Array(nd * 4), gc = new Float32Array(nd * 4);
    const tints = [[0.85, 0.95, 0.82], [0.25, 0.95, 0.3], [0.05, 0.45, 0.1], [0.6, 0.7, 0.6]];
    for (let i = 0; i < nd; i++) {
      const bulge = r() < 0.07;
      let p;
      if (bulge) { const [x, y, z] = r.inSphere(1.0); p = [x, y * 0.45, z, 0.3]; } else p = this.galPoint(r, R * 1.08, 0.2);
      gp.set([p[0], p[1], p[2], r.range(0.022, 0.05) * (bulge ? 1.15 : 1)], i * 4);
      const c = tints[Math.floor(r() * tints.length)];
      const k = bulge ? 0.9 : 0.7 + 0.35 * r();
      gc.set([c[0] * k, c[1] * k, c[2] * k, r()], i * 4);
    }
    // выравнивание плотности (как shapes.equalize): в плотных ячейках диска гасим яркость,
    // чтобы аддитивное ядро не выгорало в белое пятно при любом повороте галактики
    {
      const cellSz = 0.16, inv = 1 / cellSz, target = 7;
      const cnt = new Map();
      const key = (i) => (Math.floor(gp[i * 4] * inv) * 73856093) ^ (Math.floor(gp[i * 4 + 2] * inv) * 19349663);
      for (let i = 0; i < nd; i++) { const kk = key(i); cnt.set(kk, (cnt.get(kk) || 0) + 1); }
      for (let i = 0; i < nd; i++) {
        const c = cnt.get(key(i));
        if (c > target) { const s = target / c; gc[i * 4] *= s; gc[i * 4 + 1] *= s; gc[i * 4 + 2] *= s; }
      }
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nd * 3), 3));
    dg.setAttribute('aG', new THREE.BufferAttribute(gp, 4));
    dg.setAttribute('aCol', new THREE.BufferAttribute(gc, 4));
    this.dustU = { uScale: { value: 1000 }, uOpacity: { value: 0 }, uFade: this.fade, uSpread: { value: 0.2 }, uTime: { value: 0 }, ...this.galU };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: this.dustU, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.wallGroup.add(this.dust);
    // мягкое ядро галактики (одна плоскость-свечение вместо тысяч перекрывающихся точек)
    this.galCore = glowSprite('#c8ffc0', 2.6, 0.55);
    this.galCore.position.copy(this.galU.uGalC.value);
    this.wallGroup.add(this.galCore);
  }

  buildModelNet() {
    const nodes = [];
    NET.layers.forEach((n, L) => { for (let i = 0; i < n; i++) nodes.push({ L, p: [NET.x[L], NET.y + ((n - 1) / 2 - i) * NET.dy, 0] }); });
    this.mNodes = nodes;
    const edges = [];
    let off = 0;
    NET.layers.forEach((n, L) => {
      if (L < NET.layers.length - 1) {
        const next = NET.layers[L + 1];
        for (let a = 0; a < n; a++) for (let b = 0; b < next; b++) edges.push([off + a, off + n + b, L]);
      }
      off += n;
    });
    this.mEdges = edges;
    const r = rng(77);
    this.mLines = new FatLines(edges.length, {
      width: 2.6, color: '#00ff00', intensity: 1.25, fade: this.fade, fragment: NET_FRAG,
      uniforms: { uHot: { value: new THREE.Color('#ffffff') }, uIce: { value: ICE.clone().multiplyScalar(1.1) }, uFreeze: { value: 0 }, uBuild: { value: 0 } },
    });
    edges.forEach(([a, b, L], k) => {
      const A = nodes[a].p, B = nodes[b].p;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const len = Math.hypot(dx, dy), q = 0.25 / len;
      this.mLines.setEdge(k, [A[0] + dx * q, A[1] + dy * q, 0], [B[0] - dx * q, B[1] - dy * q, 0]);
      this.mLines.setData(k, L, r.range(0.6, 1.4), r(), 1);
    });
    this.mLines.commit();
    this.root.add(this.mLines.mesh);
    // узлы модели: «обучение» (мерцание) → иней; всё — в шейдере по uniform'ам uNet/uFreeze
    this.mU = { uT: { value: 0 }, uNet: { value: 0 }, uFreeze: { value: 0 }, uIce: { value: ICE.clone() } };
    this.mMat = orbMaterial({
      color: '#ffffff', intensity: 1, fill: 0.18, rim: 1.3, core: 0.08, fade: this.fade, uniforms: this.mU,
      vertexHead: 'attribute vec2 aNode; uniform float uT, uNet, uFreeze; uniform vec3 uIce;',
      vertexBody: `
        float L = aNode.y;
        float k = smoothstep(L * 0.18, L * 0.18 + 0.4, uNet);
        float th = L / 3.0 * 0.72;
        float fr = smoothstep(th, th + 0.25, uFreeze);
        float flick = (1.0 - fr) * (0.5 + 0.5 * sin(uT * 11.0 + aNode.x * 2.7));
        s = vec3(0.22 * k * (1.0 + 0.1 * flick));
        float g = k * (0.6 + 0.8 * flick);
        tint = mix(vec3(0.12 * g, g, 0.16 * g), uIce, fr * 0.85);`,
    });
    this.mOrbs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 18), this.mMat, nodes.length);
    this.mOrbs.frustumCulled = false;
    nodes.forEach((n, i) => setInstance(this.mOrbs, i, ...n.p, 1));
    instAttr(this.mOrbs, 'aNode', 2, nodes.flatMap((n, i) => [i, n.L]));
    this.root.add(this.mOrbs);
    // кристаллы инея вдоль рёбер: матрицы (место, поворот, длина) — статичные, рост и мерцание — в шейдере
    const per = 9;
    const nc = edges.length * per + nodes.length * 6;
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.022, 0.13, 0.022);
    this.iceU = { uFreeze: { value: 0 }, uT: { value: 0 } };
    this.iceMat = glowInstancedMaterial({
      color: '#ffffff', fade: this.fade, uniforms: this.iceU,
      vertexHead: 'attribute vec2 aIce; uniform float uFreeze, uT;',
      vertexBody: `
        float g = smoothstep(aIce.x, aIce.x + 0.14, uFreeze);
        s = vec3(g);
        tint = vec3(0.75, 0.88, 1.0) * g * (0.7 + 0.3 * sin(aIce.y + uT * 0.6 * (1.0 - uFreeze)));`,
    });
    this.ice = new THREE.InstancedMesh(geo, this.iceMat, nc);
    this.ice.frustumCulled = false;
    const aIce = new Float32Array(nc * 2);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4(), P = new THREE.Vector3(), Sc = new THREE.Vector3();
    let k = 0;
    const put = (pos, len, th) => {
      P.set(pos[0], pos[1], pos[2]);
      Sc.set(1, len, 1);
      this.ice.setMatrixAt(k, m4.compose(P, q, Sc));
      aIce[k * 2] = th; aIce[k * 2 + 1] = k * 7.1;
      k++;
    };
    edges.forEach(([a, b, L]) => {
      const A = nodes[a].p, B = nodes[b].p;
      for (let i = 0; i < per; i++) {
        const t = r.range(0.08, 0.92);
        const pos = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, r.gauss(0, 0.03)];
        e.set(r.range(-1.3, 1.3), r.range(-1.3, 1.3), r() * Math.PI);
        q.setFromEuler(e);
        put(pos, r.range(0.5, 1.4), (L + t) / 3 * 0.72 + r() * 0.22);
      }
    });
    nodes.forEach((n) => {
      for (let i = 0; i < 6; i++) {
        const [x, y, z] = r.onSphere(0.24);
        e.set(r() * 6.28, r() * 6.28, r() * 6.28);
        q.setFromEuler(e);
        put([n.p[0] + x, n.p[1] + y, n.p[2] + z], r.range(0.8, 1.5), n.L / 3 * 0.72 + r() * 0.2);
      }
    });
    instAttr(this.ice, 'aIce', 2, aIce);
    this.root.add(this.ice);
  }

  // ---------------------------------------------------------------------------
  brainShape(n) {
    const r = rng(2);
    const parts = [
      { weight: 0.5, shape: (m) => {
        const b = S.brain(m, { scale: 3.35, seed: 12, brightness: 0.55 });
        S.fade(b, 0.34);
        return S.transform(b, { rotation: [0, Math.PI / 2, 0], position: [BC[0], BC[1] + 0.15, BC[2]] });
      } },
      { weight: 0.12, shape: (m) => {
        const s = S.createShape(m);
        for (let i = 0; i < m; i++) {
          const p = this.bNodes[i % this.bNodes.length];
          const [x, y, z] = r.inSphere(0.32);
          S.setPoint(s, i, p[0] + x, p[1] + y, p[2] + z, r.range(0.5, 1.1), r() < 0.4 ? S.PAL.greenHi : S.PAL.white, r.range(0.12, 0.3));
        }
        return s;
      } },
      { weight: 0.38, shape: (m) => {
        const s = S.createShape(m);
        for (let i = 0; i < m; i++) S.setPoint(s, i, r.range(-30, 30), r.range(-16, 16), -r.range(4, 34), r.range(0.4, 1.1), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.2));
        return s;
      } },
    ];
    return S.combine(n, parts);
  }

  shape() {
    const n = this.ctx.particles.count;
    if (!this.shapes[n]) this.shapes[n] = ready(this.brainShape(n));
    return this.shapes[n];
  }

  // ---------------------------------------------------------------------------
  camera() { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; } // для 16:9; под 4:3 подгоняет ядро

  background(state, step) {
    if (step === 3) return { glows: [[-0.62, -0.1, 0.5, 0.7], [0.75, 0.3, 0.45, 0.25]], band: null };
    return { glows: [[-0.6, -0.15, 0.55, 0.75]], band: null };
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const d = inst ? 0 : 1;
    phase(this, this.ph, 'cat', step >= 1 && step <= 2 ? 1 : 0, { duration: d * 1.2, delay: step === 1 && !inst ? 0.2 : 0 });
    phase(this, this.ph, 'wall', step >= 1 ? 1 : 0, { duration: d * (step === 1 ? 3.2 : 1.0), delay: step === 1 && !inst ? 0.5 : 0, ease: 'power1.out' });
    phase(this, this.ph, 'zoom', step >= 2 ? 1 : 0, { duration: d * (step === 2 ? 4.2 : 1.4), ease: step >= 2 ? 'power2.inOut' : 'power2.out' });
    phase(this, this.ph, 'net', step >= 3 ? 1 : 0, { duration: d * 1.6, delay: step >= 3 && !inst ? 0.5 : 0 });
    phase(this, this.ph, 'freeze', step >= 3 ? 1 : 0, { duration: d * (step >= 3 ? 3.8 : 0.6), delay: step >= 3 && !inst ? 2.8 : 0, ease: 'power1.inOut' });
    // «обучение» мозга на одной кошке — вспышка активности
    learnBurst(this, step === 1 && !inst);
    const p = this.particles;
    p.setParams({ noise: 0.16, swirl: 0, size: 0.058, twinkle: 0.35, spring: 15, damping: 5.5, opacity: 1 }, d * 1.2);
    if (!this._shaped) { p.morph(this.shape(), { duration: inst ? 0.01 : 2.2, stagger: 0.5, burst: 10 }); this._shaped = true; }
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
    this.syn.resize(this.ctx);
    this.mLines.resize(this.ctx);
    this.oneLink.resize(this.ctx);
    const s = this.step;
    this.ph.cat = s >= 1 && s <= 2 ? 1 : 0;
    this.ph.wall = s >= 1 ? 1 : 0;
    this.ph.zoom = s >= 2 ? 1 : 0;
    this.ph.net = s >= 3 ? 1 : 0;
    this.ph.freeze = s >= 3 ? 1 : 0;
    this.ph.learn = 0;
    this._shaped = false;
    this.t0 = this.ctx.time;
    this.apply(s, { ...o, instant: true });
    if (!o.instant) { this._shaped = false; this.particles.morph(this.shape(), { duration: 2.2, stagger: 0.5, burst: 10 }); this._shaped = true; }
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  resize() {
    updateShared(this.ctx);
    this.syn.resize(this.ctx);
    this.mLines.resize(this.ctx);
    this.oneLink.resize(this.ctx);
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const fade = this.fade.value;
    const { wall, zoom, net, freeze, cat, learn } = this.ph;
    // мозг
    const su = this.syn.uniforms;
    su.uTime.value = t;
    su.uLearn.value = learn;
    this.bU.uT.value = t;
    this.bU.uLearn.value = learn;

    // одна кошка
    const oc = this.oneCat.material.uniforms;
    oc.uIn.value = cat;
    oc.uOpacity.value = Math.min(1, cat * 1.4);
    this.oneCat.visible = cat > 0.003;
    this.oneGlow.material.opacity = cat * (0.28 + 0.12 * Math.sin(t * 2)) * fade;
    this.oneGlow.visible = cat > 0.003;
    this.oneLink.uniforms.uOpacity.value = sstep(0.6, 1, cat) * (0.35 + 0.25 * learn);
    this.oneLink.mesh.visible = cat > 0.003;

    // стена фото → «галактика картинок»
    const gal = zoom;
    const tu = this.tiles.material.uniforms;
    tu.uIn.value = wall;
    tu.uGal.value = gal;
    tu.uTime.value = t;
    const keep = 1 - sstep(0.0, 0.55, net);
    const tilesA = Math.min(1, wall * 2) * keep;
    tu.uOpacity.value = tilesA;
    this.tiles.visible = tilesA > 0.003;
    // вращение галактики: копится, пока она видна
    if (gal > 0.001) this.galU.uRot.value += dt * 0.16 * sstep(0.2, 1, gal);
    else this.galU.uRot.value = 0;
    this.dustU.uOpacity.value = sstep(0.25, 0.9, gal) * keep * 0.85;
    this.dustU.uSpread.value = 0.15 + 0.85 * sstep(0.1, 0.95, gal);
    this.dustU.uTime.value = t;
    this.dustU.uScale.value = pixelScale(this.ctx);
    this.dust.visible = gal > 0.003 && keep > 0.003;
    this.galCore.material.opacity = sstep(0.3, 1, gal) * keep * (0.42 + 0.06 * Math.sin(t * 1.7)) * fade;
    this.galCore.visible = this.dust.visible;
    this.wallGroup.rotation.y = WALL.rotY * (1 - sstep(0, 0.6, gal));
    this.wallGroup.scale.setScalar(1 - 0.55 * sstep(0, 0.7, net));
    this.wallGroup.visible = wall > 0.003 || gal > 0.003;

    // сеть модели: обучение → иней
    const vis = net > 0.003;
    this.mLines.mesh.visible = vis;
    this.mOrbs.visible = vis;
    this.ice.visible = vis && freeze > 0.003;
    if (vis) {
      const mu = this.mLines.uniforms;
      mu.uTime.value = t;
      mu.uBuild.value = net;
      mu.uFreeze.value = freeze;
      // узлы и кристаллы инея анимируются в шейдере — здесь только uniform'ы
      this.mU.uT.value = t;
      this.mU.uNet.value = net;
      this.mU.uFreeze.value = freeze;
      this.iceU.uT.value = t;
      this.iceU.uFreeze.value = freeze;
    }
    if (this.ownsParticles()) this.particles.object.rotation.y = 0;
  }
}

// Вспышка «обучения» мозга: всплеск и спад
function learnBurst(v, on) {
  if (!on) { phase(v, v.ph, 'learn', 0, { duration: 0.6 }); return; }
  phase(v, v.ph, 'learn', 1, { duration: 0.6, delay: 0.9, ease: 'power2.out' });
  v._learnCall?.kill();
  v._learnCall = v.delay(2.6, () => phase(v, v.ph, 'learn', 0.25, { duration: 1.6 }));
}
