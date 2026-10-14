// Белок: цепочка разноцветных бусин-аминокислот сама сворачивается в объёмный клубок (пучок спиралей).
// Облако частиц превращается во «вселенную белков» — сотни свёрнутых клубков вокруг.
// Шаги: 0 — цепочка; 1 — сворачивание (AlphaFold); 2 — медаль «Нобель-2024 · химия»;
//       3 — пролёт к золотой медали Международной математической олимпиады (2025).
import * as THREE from 'three';
import { gsap } from 'gsap';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, TAU } from '../../core/utils.js';
import { textSprite } from '../../core/text.js';
import { glowTexture, haloSprite, glowMat, idle } from './util.js';

const N = 72;                       // аминокислот
const BEAD_R = 0.26;
// Вторичная структура: хвост, 4 спирали по 14, петли по 4, хвост
const SEGS = [
  { t: 'tail', a: 0, b: 1 },
  { t: 'helix', a: 2, b: 15, axis: [-0.8, -0.8], up: 1 },
  { t: 'loop', a: 16, b: 19, side: 1 },
  { t: 'helix', a: 20, b: 33, axis: [0.8, -0.8], up: -1 },
  { t: 'loop', a: 34, b: 37, side: -1 },
  { t: 'helix', a: 38, b: 51, axis: [0.8, 0.8], up: 1 },
  { t: 'loop', a: 52, b: 55, side: 1 },
  { t: 'helix', a: 56, b: 69, axis: [-0.8, 0.8], up: -1 },
  { t: 'tail', a: 70, b: 71 },
];
const PROT_C = new THREE.Vector3(3.4, -0.1, 0);     // центр свёрнутого белка (мир)
const NOBEL_P = new THREE.Vector3(7.45, 1.2, 0.3);   // медаль Нобеля
const GOLD_P = new THREE.Vector3(38, 5.5, -14);      // золотая медаль олимпиады
const BG_GOLD = { glows: [[1.0, -0.7, 0.5, 0.7], [-0.95, 0.65, 0.35, 0.4]], band: null };   // фон шага олимпиады
const PALETTE = ['#8dff7a', '#eafff0', '#a6dcff', '#ffe6a8', '#cdbdff', '#86f2d4'];
const PAL_W = [0.3, 0.24, 0.14, 0.1, 0.11, 0.11];

function medalTexture(lines, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r * 0.75, r * 0.65, r * 0.05, r, r, r);
  grd.addColorStop(0, '#fff6d6');
  grd.addColorStop(0.5, '#f2d488');
  grd.addColorStop(1, '#b98a32');
  g.fillStyle = grd;
  g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(105,74,18,.6)';
  g.lineWidth = size * 0.014;
  g.beginPath(); g.arc(r, r, r * 0.85, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(105,74,18,.55)';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    g.beginPath(); g.arc(r + Math.cos(a) * r * 0.925, r + Math.sin(a) * r * 0.925, size * 0.009, 0, TAU); g.fill();
  }
  g.fillStyle = '#5e420e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = (text, px, maxW) => { g.font = `800 ${px}px Unbounded`; const w = g.measureText(text).width; if (w > maxW) g.font = `800 ${Math.floor(px * maxW / w)}px Unbounded`; };
  fit(lines[0], Math.round(size * 0.085), r * 1.05);
  g.fillText(lines[0], r, r * 0.56);
  g.font = `800 ${Math.round(size * 0.21)}px Unbounded`;
  g.fillText(lines[1], r, r * 1.0);
  fit(lines[2], Math.round(size * 0.08), r * 1.05);
  g.fillText(lines[2], r, r * 1.43);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export default class Protein extends Visual {
  static transition = 'zoom';

  async init() {
    const r = rng(2024);
    this.f = { v: 0 };            // степень сворачивания 0..1
    this.spinS = { v: 0 };
    this.scanS = { v: 0 };
    this.haloTex = glowTexture(128);

    // ---------- Конформации ----------
    this.P0 = []; this.P1 = []; this.P2 = [];
    this.buildExtended();
    this.buildFolded();
    this.buildLocalHelices();
    this.delayA = new Float32Array(N); this.delayB = new Float32Array(N);
    let hIdx = 0;
    SEGS.forEach((sg) => {
      for (let i = sg.a; i <= sg.b; i++) {
        this.delayA[i] = 0.02 + 0.13 * (hIdx / 4) + 0.01 * ((i - sg.a) % 3);
        this.delayB[i] = 0.12 * (hIdx / 4);
      }
      if (sg.t === 'helix') hIdx++;
    });

    // ---------- Бусины и связи ----------
    // Сворачивание считается в вершинном шейдере (по трём конформациям и задержкам каждой бусины):
    // каждый кадр меняется только uniform uFold — без перезаливки instanceMatrix (на ANGLE это очень дорого).
    this.prot = new THREE.Group();
    this.prot.position.copy(PROT_C);
    this.root.add(this.prot);
    this.foldU = { value: 0 };
    const env = this.ctx.engine.envMap;
    const beadMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.48, 0.48, 0.48), roughness: 0.36, metalness: 0.0, envMap: env, envMapIntensity: 0.55, transparent: true });
    const beadGeo = new THREE.SphereGeometry(BEAD_R, 22, 14);
    this.beads = new THREE.InstancedMesh(beadGeo, beadMat, N);
    this.colors = [];
    for (let i = 0; i < N; i++) {
      let k = r(), acc = 0, ci = 0;
      for (; ci < PAL_W.length; ci++) { acc += PAL_W[ci]; if (k < acc) break; }
      const c = new THREE.Color(PALETTE[Math.min(ci, PALETTE.length - 1)]);
      this.colors.push(c);
      this.beads.setColorAt(i, c);
    }
    this.beads.instanceColor.needsUpdate = true;
    this.beads.frustumCulled = false;
    const bondMat = new THREE.MeshStandardMaterial({ color: 0x6f7d6f, roughness: 0.5, metalness: 0.1, envMap: env, envMapIntensity: 0.5, transparent: true });
    const bondGeo = new THREE.CylinderGeometry(0.075, 0.075, 1, 10, 1, true);
    this.bonds = new THREE.InstancedMesh(bondGeo, bondMat, N - 1);
    this.bonds.frustumCulled = false;
    this.setupFoldShaders(beadGeo, beadMat, bondGeo, bondMat);
    this.prot.add(this.beads, this.bonds);

    // Кольцо-«скан» при завершении сворачивания
    this.scan = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 128), glowMat(new THREE.Color(0.5, 1.5, 0.5), 0));
    this.scan.material.userData.noFade = true;
    this.scan.position.copy(PROT_C);
    this.scan.visible = false;
    this.root.add(this.scan);

    await idle();
    // ---------- Медали ----------
    this.nobel = this.makeMedal(['НОБЕЛЬ', '2024', 'ХИМИЯ'], 1.25);
    this.nobel.position.copy(NOBEL_P);
    this.nobel.scale.setScalar(0.001);
    this.nobel.visible = false;
    this.root.add(this.nobel);
    this.gold = this.makeMedal(['ОЛИМПИАДА', '2025', 'ЗОЛОТО'], 1.7);
    this.gold.position.copy(GOLD_P);
    this.gold.scale.setScalar(0.001);
    this.gold.visible = false;
    this.root.add(this.gold);
    this.goldHalo = haloSprite(this.haloTex, new THREE.Color(1.0, 0.85, 0.45), 9, 0);
    this.goldHalo.material.userData.noFade = true;
    this.goldHalo.position.copy(GOLD_P).add(new THREE.Vector3(0, 0, -1.2));
    this.root.add(this.goldHalo);
    this.nobelHalo = haloSprite(this.haloTex, new THREE.Color(0.9, 0.8, 0.45), 6, 0);
    this.nobelHalo.material.userData.noFade = true;
    this.nobelHalo.position.copy(NOBEL_P).add(new THREE.Vector3(0, 0, -1));
    this.root.add(this.nobelHalo);

    // Математические символы на орбитах вокруг золотой медали
    this.symbols = new THREE.Group();
    this.symbols.position.copy(GOLD_P);
    this.root.add(this.symbols);
    const syms = ['∑', 'π', '√', '∫', '∞', 'x²', '÷', '≠', 'Δ', '='];   // однозначно читаемые (∠ в запасном шрифте походил на «4»)
    this.symList = syms.map((s, i) => {
      const col = i % 3 === 0 ? '#9dff8f' : '#ffffff';
      const sp = textSprite(s, { height: i % 2 ? 1.35 : 1.15, font: '700 150px Unbounded', color: col, stroke: { color: col, width: 7 }, padding: 22, glow: i % 3 === 0, depthTest: true });
      sp.material.userData.noFade = true; // прозрачность ведёт update()
      const ring = i % 2;
      sp.userData = { a: (i / syms.length) * TAU * 2 + r() * 0.4, rad: ring ? 3.25 : 2.65, tilt: ring ? 0.75 : -0.7, speed: ring ? 0.2 : -0.26, y: r.range(-0.25, 0.25) };
      this.symbols.add(sp);
      return sp;
    });
    this.symbols.visible = false;
    this.symK = { v: 0 };

    // ---------- Частицы: «бульон» вокруг цепочки и «вселенная белков» ----------
    await idle();
    await this.buildShapes();
  }

  // Вытянутая цепочка: плавная «змейка» через весь экран (координаты — относительно PROT_C)
  buildExtended() {
    const M = 3000;
    const fn = (u, out) => out.set(
      -9.6 + 19.2 * u,
      -1.45 + 1.75 * Math.sin(u * TAU * 3.1 + 0.3) + 0.4 * Math.sin(u * TAU * 7.3 + 1.1),
      1.1 * Math.sin(u * TAU * 2.2 + 0.5),
    );
    const pts = [], cum = [0];
    const v = new THREE.Vector3();
    for (let i = 0; i <= M; i++) { pts.push(fn(i / M, new THREE.Vector3())); if (i) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1])); }
    const L = cum[M];
    this.extLen = L;
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * L;
      while (j < M && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      v.lerpVectors(pts[j], pts[Math.min(M, j + 1)], t);
      this.P0.push(v.clone().sub(PROT_C));
    }
    this.extFn = fn;
  }

  // Свёрнутая форма: пучок из 4 спиралей (оси вдоль Y), петли, хвосты
  buildFolded() {
    const R = 0.5, rise = 0.21, twist = THREE.MathUtils.degToRad(100), S = 1.32;
    const P = new Array(N);
    SEGS.forEach((sg) => {
      if (sg.t !== 'helix') return;
      const n = sg.b - sg.a + 1;
      const half = ((n - 1) * rise) / 2;
      for (let j = 0; j < n; j++) {
        const y = sg.up > 0 ? -half + j * rise : half - j * rise;
        const a = j * twist + (sg.up > 0 ? 0 : Math.PI);
        P[sg.a + j] = new THREE.Vector3(sg.axis[0] + Math.cos(a) * R, y, sg.axis[1] + Math.sin(a) * R);
      }
    });
    SEGS.forEach((sg, si) => {
      if (sg.t === 'loop') {
        const A = P[sg.a - 1], B = P[sg.b + 1];
        const n = sg.b - sg.a + 1;
        for (let j = 0; j < n; j++) {
          const t = (j + 1) / (n + 1);
          const p = A.clone().lerp(B, t);
          p.y += sg.side * Math.sin(Math.PI * t) * 0.75;
          const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(Math.sin(Math.PI * t) * 0.35);
          P[sg.a + j] = p.add(out);
        }
      } else if (sg.t === 'tail') {
        const first = si === 0;
        const anchor = first ? P[sg.b + 1] : P[sg.a - 1];
        const n = sg.b - sg.a + 1;
        for (let j = 0; j < n; j++) {
          const k = first ? n - j : j + 1;
          P[sg.a + j] = anchor.clone().add(new THREE.Vector3(-0.25 * k, -0.5 * k, 0.3 * k));
        }
      }
    });
    // наклон для красивого ракурса и масштаб
    const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.8, 0.35, 0.7));
    for (let i = 0; i < N; i++) this.P2.push(P[i].multiplyScalar(S * 0.88).applyMatrix4(rot));
  }

  // Промежуточная форма: спирали уже скрутились, но ещё лежат вдоль вытянутой цепочки
  buildLocalHelices() {
    const R = 0.4, rise = 0.21, twist = THREE.MathUtils.degToRad(100);
    const P = this.P0.map((p) => p.clone());
    SEGS.forEach((sg) => {
      if (sg.t !== 'helix') return;
      const n = sg.b - sg.a + 1;
      const c = new THREE.Vector3();
      for (let i = sg.a; i <= sg.b; i++) c.add(this.P0[i]);
      c.multiplyScalar(1 / n);
      const ax = this.P0[sg.b].clone().sub(this.P0[sg.a]).normalize();
      const u = new THREE.Vector3(0, 0, 1).cross(ax).normalize();
      if (u.lengthSq() < 1e-6) u.set(0, 1, 0);
      const w = ax.clone().cross(u).normalize();
      const half = ((n - 1) * rise) / 2;
      for (let j = 0; j < n; j++) {
        const a = j * twist;
        P[sg.a + j] = c.clone().addScaledVector(ax, -half + j * rise).addScaledVector(u, Math.cos(a) * R).addScaledVector(w, Math.sin(a) * R);
      }
    });
    // петли и хвосты — по прямой между соседями
    SEGS.forEach((sg) => {
      if (sg.t === 'helix') return;
      const A = sg.a > 0 ? P[sg.a - 1] : null, B = sg.b < N - 1 ? P[sg.b + 1] : null;
      const n = sg.b - sg.a + 1;
      for (let j = 0; j < n; j++) {
        if (A && B) P[sg.a + j] = A.clone().lerp(B, (j + 1) / (n + 1));
        else if (B) P[sg.a + j] = B.clone().lerp(this.P0[sg.a + j], 0.6);
        else if (A) P[sg.a + j] = A.clone().lerp(this.P0[sg.a + j], 0.6);
      }
    });
    this.P1 = P;
  }

  /**
   * Сворачивание в вершинном шейдере: у каждой бусины — три конформации (вытянутая, локальные спирали, клубок)
   * и задержки двух этапов; у связи — то же для обоих концов. Формула — та же, что была на CPU:
   *   a = ease((f − dA) / 0.3), b = ease((f − 0.42 − dB) / 0.42), p = mix(P0, P1, a) + (P2 − P1)·b + «горб» траектории.
   */
  setupFoldShaders(beadGeo, beadMat, bondGeo, bondMat) {
    const v3 = (arr, k) => { const a = new Float32Array(arr.length * 3); arr.forEach((p, i) => p.toArray(a, i * 3)); return new THREE.InstancedBufferAttribute(a, k ?? 3); };
    beadGeo.setAttribute('aP0', v3(this.P0));
    beadGeo.setAttribute('aP1', v3(this.P1));
    beadGeo.setAttribute('aP2', v3(this.P2));
    const del = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) del.set([this.delayA[i], this.delayB[i], i, 0], i * 4);
    beadGeo.setAttribute('aDel', new THREE.InstancedBufferAttribute(del, 4));
    // связь i: от бусины i к бусине i + 1
    const sl = (arr, from, to) => arr.slice(from, to);
    bondGeo.setAttribute('aP0', v3(sl(this.P0, 0, N - 1)));
    bondGeo.setAttribute('aP1', v3(sl(this.P1, 0, N - 1)));
    bondGeo.setAttribute('aP2', v3(sl(this.P2, 0, N - 1)));
    bondGeo.setAttribute('aQ0', v3(sl(this.P0, 1, N)));
    bondGeo.setAttribute('aQ1', v3(sl(this.P1, 1, N)));
    bondGeo.setAttribute('aQ2', v3(sl(this.P2, 1, N)));
    const bdel = new Float32Array((N - 1) * 4);
    for (let i = 0; i < N - 1; i++) bdel.set([this.delayA[i], this.delayB[i], this.delayA[i + 1], this.delayB[i + 1]], i * 4);
    bondGeo.setAttribute('aDel', new THREE.InstancedBufferAttribute(bdel, 4));
    const bidx = new Float32Array(N - 1);
    for (let i = 0; i < N - 1; i++) bidx[i] = i;
    bondGeo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(bidx, 1));
    const COMMON = /* glsl */ `
uniform float uFold;
attribute vec3 aP0;
attribute vec3 aP1;
attribute vec3 aP2;
attribute vec4 aDel;
float foldEase(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 foldPos(vec3 p0, vec3 p1, vec3 p2, vec2 d, float idx) {
  float a = foldEase((uFold - d.x) / 0.3);
  float b = foldEase((uFold - 0.42 - d.y) / 0.42);
  vec3 p = mix(p0, p1, a) + (p2 - p1) * b;
  float bulge = sin(3.14159265 * b) * 0.9;
  p.y += bulge * (0.6 + 0.4 * sin(idx * 0.31));
  p.z += bulge * 1.1;
  return p;
}
`;
    const U = this.foldU;
    beadMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFold = U;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + COMMON)
        .replace('#include <begin_vertex>', 'vec3 transformed = position + foldPos(aP0, aP1, aP2, aDel.xy, aDel.z);');
    };
    beadMat.customProgramCacheKey = () => 'b4-protein-bead';
    bondMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFold = U;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + COMMON + 'attribute vec3 aQ0;\nattribute vec3 aQ1;\nattribute vec3 aQ2;\nattribute float aIdx;\n')
        .replace('#include <beginnormal_vertex>', /* glsl */ `
vec3 bA = foldPos(aP0, aP1, aP2, aDel.xy, aIdx);
vec3 bB = foldPos(aQ0, aQ1, aQ2, aDel.zw, aIdx + 1.0);
vec3 bD = bB - bA;
float bLen = length(bD);
vec3 bT = bLen > 1e-5 ? bD / bLen : vec3(0.0, 1.0, 0.0);
vec3 bH = abs(bT.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 bN = normalize(cross(bH, bT));
vec3 bBn = cross(bN, bT);
vec3 objectNormal = bN * normal.x + bT * normal.y + bBn * normal.z;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = (bA + bB) * 0.5 + bN * position.x + bT * (position.y * max(bLen, 0.001)) + bBn * position.z;');
    };
    bondMat.customProgramCacheKey = () => 'b4-protein-bond';
  }

  /** Текстура ленты медали: зелёная с белой полосой посередине, к верхнему краю прозрачная (одна на обе медали). */
  ribbonTex() {
    if (this._ribTex) return this._ribTex;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#00a800';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#e8ffe8';
    g.fillRect(26, 0, 12, 256);
    g.fillStyle = 'rgba(0,40,0,0.55)';
    g.fillRect(0, 0, 4, 256); g.fillRect(60, 0, 4, 256);
    // прозрачность к верху (v = 1 — верх плоскости)
    g.globalCompositeOperation = 'destination-in';
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.45, 'rgba(0,0,0,1)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._ribTex = tex;
    return tex;
  }

  makeMedal(lines, R) {
    const g = new THREE.Group();
    const env = this.ctx.engine.envMap;
    const metal = new THREE.MeshStandardMaterial({ color: '#c9a24f', metalness: 1, roughness: 0.42, envMap: env, envMapIntensity: 0.8, transparent: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.14 * R, 96, 1), metal);
    body.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07 * R, 16, 128), metal);
    const tex = medalTexture(lines);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.0, metalness: 0.2, roughness: 0.6, envMap: env, envMapIntensity: 0.45, color: new THREE.Color(0.74, 0.74, 0.74), transparent: true });
    const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.93, 96), faceMat);
    face.position.z = 0.071 * R + 0.002;
    const back = face.clone();
    back.rotation.y = Math.PI;
    back.position.z = -face.position.z;
    // лента: «V» от ушка вверх, фирменный зелёный с белой полосой, к верху тает
    const ribMat = new THREE.MeshStandardMaterial({ map: this.ribbonTex(), roughness: 0.55, metalness: 0.05, emissive: '#002a00', transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ribGeo = new THREE.PlaneGeometry(0.44 * R, 1.75 * R);
    ribGeo.translate(0, 0.875 * R, 0);                        // начало ленты — у ушка
    const ribL = new THREE.Mesh(ribGeo, ribMat), ribR = new THREE.Mesh(ribGeo, ribMat);
    ribL.position.set(-0.07 * R, 1.0 * R, -0.06); ribL.rotation.z = 0.36;
    ribR.position.set(0.07 * R, 1.0 * R, -0.09); ribR.rotation.z = -0.36;
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.13 * R, 0.035 * R, 10, 32), metal);
    loop.position.set(0, R * 1.04, 0);
    const inner = new THREE.Group();
    inner.add(body, rim, face, back, ribL, ribR, loop);
    g.add(inner);
    g.userData.inner = inner;
    return g;
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const r = rng(77);
    const nBg = Math.floor(n * 0.5);
    const nAura = Math.floor(n * 0.16);
    const pastel = PALETTE.map((h) => S.color(h));
    // общий фон: звёзды (одинаковы в обеих формах — не двигаются)
    const bg = new Float32Array(nBg * 8);
    for (let i = 0; i < nBg; i++) {
      const [x, y, z] = r.onSphere(r.range(26, 70));
      const c = r() < 0.75 ? S.PAL.white : pastel[Math.floor(r() * pastel.length)];
      bg.set([x + 10, y * 0.7, -Math.abs(z) - 6, Math.pow(r(), 4) * 2.2 + 0.4, c[0], c[1], c[2], r.range(0.08, 0.3)], i * 8);
    }
    const put = (s, i, o) => S.setPoint(s, i, bg[o], bg[o + 1], bg[o + 2], bg[o + 3], [bg[o + 4], bg[o + 5], bg[o + 6]], bg[o + 7]);
    // A: «бульон» — туманная оболочка вдоль вытянутой цепочки
    const A = S.createShape(n);
    for (let i = 0; i < nBg; i++) put(A, i, i * 8);
    const v = new THREE.Vector3();
    for (let i = nBg; i < nBg + nAura; i++) {
      const u = r();
      this.extFn(u, v);
      const sd = r() < 0.7 ? 0.35 : 0.95;
      const ci = Math.min(N - 1, Math.round(u * (N - 1)));
      const c = this.colors[ci];
      S.setPoint(A, i, v.x + r.gauss(0, sd), v.y + r.gauss(0, sd), v.z + r.gauss(0, sd), r.range(0.4, 0.85), [c.r, c.g, c.b], r.range(0.025, 0.07));
    }
    // остальное — редкая разноцветная «пыль» (из неё потом соберутся клубки)
    for (let i = nBg + nAura; i < n; i++) {
      const x = r.range(-30, 60), y = r.range(-14, 14), z = r.range(-48, -6);
      const c = pastel[Math.floor(r() * pastel.length)];
      S.setPoint(A, i, x, y, z, r.range(0.4, 0.9), c, r.range(0.05, 0.16));
    }
    this.shapeA = S.equalize(A, { cell: 0.12, target: 6 });
    await idle();
    // B: «вселенная белков» — сотни свёрнутых клубков вокруг
    const B = S.createShape(n);
    for (let i = 0; i < nBg; i++) put(B, i, i * 8);
    const rest = n - nBg;
    const G = this.ctx.quality === 'low' ? 140 : 260;
    const per = Math.floor(rest / G);
    let i = nBg;
    for (let gI = 0; gI < G; gI++) {
      // место клубка: подальше от камеры и от главного белка
      let cx, cy, cz, guard = 0;
      do {
        cx = r.range(-28, 58); cy = r.range(-13, 13); cz = r.range(-46, -5);
        guard++;
      } while (guard < 50 && Math.hypot(cx - 3.4, cy, cz) < 7);
      const rad = r.range(0.35, 0.75) * (1 + (-cz) / 60);
      const c1 = pastel[Math.floor(r() * pastel.length)], c2 = pastel[Math.floor(r() * pastel.length)];
      let px = 0, py = 0, pz = 0;
      const cnt = gI === G - 1 ? n - i : per;
      for (let k = 0; k < cnt; k++, i++) {
        px = px * 0.9 + r.gauss(0, 0.2); py = py * 0.9 + r.gauss(0, 0.2); pz = pz * 0.9 + r.gauss(0, 0.2);
        const c = (k >> 3) % 2 ? c1 : c2;
        S.setPoint(B, i, cx + px * rad, cy + py * rad, cz + pz * rad, r.range(0.55, 1.05), r() < 0.15 ? S.PAL.white : c, r.range(0.25, 0.55));
      }
    }
    await idle();
    this.shapeB = S.equalize(B, { cell: 0.12, target: 6 });
  }

  // ---------- Камера ----------
  rightOffset(d) {
    return 0.5 * d * Math.tan(THREE.MathUtils.degToRad(22.5)) * (16 / 9);
  }

  // Позы — для 16:9 (под другие экраны их подгоняет ядро).
  camera(state, step) {
    if (step <= 0) return { pos: [0.3, 0.2, 17.5], target: [0.3, -0.55, 0], fov: 45 };
    if (step === 1) { const d = 10.5, x = PROT_C.x - this.rightOffset(d); return { pos: [x - 0.9, 1.2, d], target: [x, -0.15, 0], fov: 45, duration: 2.2 }; }
    if (step === 2) {
      const d = 11.5, mid = (PROT_C.x + NOBEL_P.x) / 2, x = mid - this.rightOffset(d);
      return { pos: [x - 0.9, 1.0, d], target: [x, 0.05, 0], fov: 45 };
    }
    const d = 10.5, x = GOLD_P.x - this.rightOffset(d);
    return { pos: [x - 1.2, GOLD_P.y + 0.9, GOLD_P.z + d], target: [x, GOLD_P.y, GOLD_P.z], fov: 45, duration: 2.8, arc: 0.25 };
  }

  // на шаге олимпиады — мягкий свет из угла (пресет «right» заливал зелёным полэкрана за золотой медалью)
  background(state, step) { return step >= 3 ? BG_GOLD : step >= 1 ? 'corners' : 'low'; }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.2, swirl: 0, size: 0.06, twinkle: 0.35, spring: 14, damping: 5.5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    const obj = p.object, d = o.instant ? 0 : 1.6;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    this.removeLabels();
    this.nobelLabel = null;
    this.shapeK = -1;
    // состояние прошлого показа: сразу ставим вид шага входа (без «досворачивания» на глазах)
    const fT = this.step >= 1 ? 1 : 0;
    this.f.v = fT; this.fTarget = fT; this.foldU.value = fT;
    if (this.step < 2) { this.nobelOn = false; this.nobel.visible = false; this.nobel.scale.setScalar(0.001); }
    if (this.step < 3) { this.goldOn = false; this.gold.visible = false; this.gold.scale.setScalar(0.001); this.symK.v = 0; this.symbols.visible = false; }
    this.prot.scale.setScalar(this.step >= 2 ? 0.86 : 1);
    this.scan.visible = false;
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const instant = !!o.instant;
    const fwd = (o.dir ?? 1) >= 0;
    // частицы
    const sk = step >= 1 ? 1 : 0;
    if (sk !== this.shapeK) {
      this.particles.morph(sk ? this.shapeB : this.shapeA, {
        duration: instant ? 0.01 : sk ? 3.0 : 2.0, stagger: 0.55, burst: sk ? 9 : 6, delay: sk && !o.entering && !instant ? 0.6 : 0,
      });
      this.shapeK = sk;
    }
    // сворачивание
    const fT = step >= 1 ? 1 : 0;
    if (instant) { this.fTarget = fT; this.tw(this.f, { v: fT, duration: 0, overwrite: true }); this.foldU.value = fT; }
    else if (this.fTarget !== fT) {
      this.fTarget = fT;
      this.tw(this.f, { v: fT, duration: fT ? 3.6 : 2.4, ease: fT ? 'none' : 'power1.inOut', overwrite: true,
        onComplete: () => { if (fT === 1 && this.step >= 1) this.scanPulse(); } });
    }
    if (step === 0) this.tw(this.spinS, { v: Math.round(this.spinS.v / TAU) * TAU, duration: instant ? 0 : 1.6, ease: 'power2.inOut', overwrite: true });
    else gsap.killTweensOf(this.spinS);
    // клубок чуть уменьшается, освобождая место медали
    const ps = step >= 2 ? 0.86 : 1;
    this.tw(this.prot.scale, { x: ps, y: ps, z: ps, duration: instant ? 0 : 1.4, ease: 'power2.inOut', overwrite: true });
    // медаль Нобеля
    const nob = step >= 2;
    if (nob && !this.nobelOn) {
      this.nobelOn = true;
      this.nobel.visible = true;
      if (instant || !fwd || step > 2) {
        this.tw(this.nobel.scale, { x: 1, y: 1, z: 1, duration: instant ? 0 : 0.8, ease: 'power2.out', overwrite: true });
        this.nobel.position.copy(NOBEL_P);
      } else {
        this.fromTo(this.nobel.position, { x: NOBEL_P.x + 6, y: NOBEL_P.y + 3.5, z: NOBEL_P.z - 6 }, { x: NOBEL_P.x, y: NOBEL_P.y, z: NOBEL_P.z, duration: 1.6, ease: 'power3.out', delay: 0.2 });
        this.fromTo(this.nobel.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'back.out(1.6)', delay: 0.2, overwrite: true });
        this.fromTo(this.nobel.userData.inner.rotation, { y: -Math.PI * 3 }, { y: 0, duration: 2.0, ease: 'power3.out', delay: 0.2 });
        this.delay(1.3, () => { if (this.step >= 2) this.ctx.engine.pulse({ flash: 0.12 }, 0.6); });
      }
    } else if (!nob && this.nobelOn) {
      this.nobelOn = false;
      this.tw(this.nobel.scale, { x: 0.001, y: 0.001, z: 0.001, duration: instant ? 0 : 0.5, ease: 'power2.in', overwrite: true,
        onComplete: () => { if (!this.nobelOn) this.nobel.visible = false; } });
    }
    // золотая медаль олимпиады
    const gold = step >= 3;
    if (gold && !this.goldOn) {
      this.goldOn = true;
      this.gold.visible = true;
      this.symbols.visible = true;
      const dl = instant ? 0 : 1.5;
      this.fromTo(this.gold.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: instant ? 0 : 1.3, delay: dl, ease: 'back.out(1.8)', overwrite: true });
      this.fromTo(this.gold.userData.inner.rotation, { y: -Math.PI * 4 }, { y: 0, duration: instant ? 0 : 2.4, delay: dl, ease: 'power3.out' });
      this.tw(this.symK, { v: 1, duration: instant ? 0 : 1.6, delay: dl + 0.3, ease: 'power2.out', overwrite: true });
      if (!instant) this.delay(dl + 0.4, () => { if (this.step >= 3) this.ctx.engine.pulse({ flash: 0.18, aberration: 0.6 }, 0.8); });
    } else if (!gold && this.goldOn) {
      this.goldOn = false;
      this.tw(this.gold.scale, { x: 0.001, y: 0.001, z: 0.001, duration: instant ? 0 : 0.5, ease: 'power2.in', overwrite: true,
        onComplete: () => { if (!this.goldOn) this.gold.visible = false; } });
      this.tw(this.symK, { v: 0, duration: instant ? 0 : 0.5, overwrite: true, onComplete: () => { if (!this.goldOn) this.symbols.visible = false; } });
    }
  }

  scanPulse() {
    this.scan.visible = true;
    this.fromTo(this.scanS, { v: 0 }, { v: 1, duration: 1.6, ease: 'power2.out', overwrite: true, onComplete: () => { this.scan.visible = false; } });
  }

  exit(o = {}) {
    this.nobelLabel?.hide();
    const p = super.exit(o);
    p.then(() => { if (!this.active) this.removeLabels(); });
    return p;
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const op = this.opacity;
    // сворачивание и вращение клубка
    this.foldU.value = this.f.v;
    if (this.step >= 1) this.spinS.v += dt * 0.2 * this.f.v;
    this.prot.rotation.y = this.spinS.v;
    this.prot.rotation.x = Math.sin(t * 0.4) * 0.06 * this.f.v;
    this.prot.position.y = PROT_C.y + Math.sin(t * 0.7) * 0.08 * this.f.v;

    if (this.scan.visible) {
      const k = this.scanS.v;
      this.scan.scale.setScalar(0.8 + k * 3.6);
      this.scan.material.opacity = op * (1 - k) * 0.9;
      this.scan.quaternion.copy(this.ctx.camera.quaternion);
      this.scan.position.copy(this.prot.position);
    }
    // медали покачиваются, ловя блики
    if (this.nobel.visible) {
      this.nobel.rotation.y = Math.sin(t * 0.6) * 0.3;
      this.nobel.rotation.x = Math.sin(t * 0.43) * 0.06;
    }
    // в светлой теме аддитивный ореол после инверсии превращается в грязное пятно — гасим
    const lightK = 1 - 0.85 * (this.ctx.engine.fx.invert || 0);
    this.nobelHalo.material.opacity = op * 0.12 * lightK * clamp(this.nobel.scale.x, 0, 1);
    if (this.gold.visible) {
      this.gold.rotation.y = Math.sin(t * 0.5) * 0.3;
      this.gold.rotation.x = Math.sin(t * 0.37) * 0.05;
    }
    this.goldHalo.material.opacity = op * 0.16 * lightK * clamp(this.gold.scale.x, 0, 1);
    // символы на орбитах
    if (this.symbols.visible) {
      const sk = this.symK.v;
      this.symList.forEach((sp) => {
        const u = sp.userData;
        u.a += dt * u.speed;
        const rad = u.rad * (0.4 + 0.6 * sk);
        const x = Math.cos(u.a) * rad, z = Math.sin(u.a) * rad;
        sp.position.set(x, u.y + z * Math.sin(u.tilt), z * Math.cos(u.tilt));
        sp.material.opacity = op * sk * (0.55 + 0.45 * (z > 0 ? 1 : 0.6));
      });
    }
    // подпись медали
    if (this.nobelLabel && this.active) {
      const want = this.nobelOn && this.nobel.scale.x > 0.8;
      if (want !== this.nobelLabel.visible) want ? this.nobelLabel.show() : this.nobelLabel.hide();
    }
  }
}
