// Процедурные модели для визуализации «Энергия» (всё в метрах):
// лампочка накаливания, видеокарта H100, серверная стойка, машинный зал (InstancedMesh + шейдер индикаторов),
// пол зала, здание, градирни АЭС (гиперболоиды с образующими), пар.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HASH, SIMPLEX } from '../../core/glsl.js';
import { hermite, glassMaterial } from './kit.js';
import { textMesh } from '../../core/text.js';

// ---------------------------------------------------------------------------
// Лампочка (высота ≈ 0.108 м, основание цоколя в y = 0)
// ---------------------------------------------------------------------------
export const BULB = { height: 0.108, glassCenter: 0.075, filament: 0.074 };

export function bulbGlassProfile(seg = 1) {
  const pts = [];
  const y0 = 0.025, r0 = 0.0128, m0 = 0.06;
  const R = 0.0305, cy = 0.0775, phiJ = -50 * Math.PI / 180;
  const y1 = cy + R * Math.sin(phiJ), r1 = R * Math.cos(phiJ), m1 = -Math.tan(phiJ);
  const n1 = Math.round(12 * seg), n2 = Math.round(26 * seg);
  for (let i = 0; i <= n1; i++) {
    const t = i / n1;
    pts.push(new THREE.Vector2(hermite(r0, m0, r1, m1, t, y1 - y0), y0 + t * (y1 - y0)));
  }
  for (let i = 1; i <= n2; i++) {
    const phi = phiJ + (Math.PI / 2 - phiJ) * (i / n2);
    pts.push(new THREE.Vector2(Math.max(2e-4, R * Math.cos(phi)), cy + R * Math.sin(phi)));
  }
  return pts;
}

export function bulbBaseProfile(threads = true) {
  const pts = [new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.0034, 0), new THREE.Vector2(0.0046, 0.0016),
    new THREE.Vector2(0.006, 0.0032), new THREE.Vector2(0.0095, 0.0045), new THREE.Vector2(0.0116, 0.0058)];
  const n = threads ? 44 : 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = 0.0062 + t * 0.0178;
    const r = threads ? 0.0124 + 0.0007 * Math.sin(t * Math.PI * 2 * 4.5) : 0.0125;
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(0.0131, 0.0246), new THREE.Vector2(0.0128, 0.0258));
  return pts;
}

function filamentCurve() {
  const pts = [];
  const span = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.0095, 0.0735, 0), new THREE.Vector3(0, 0.0805, 0.0005), new THREE.Vector3(0.0095, 0.0735, 0));
  const turns = 15, N = 360, rc = 0.00115;
  const p = new THREE.Vector3(), tng = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    span.getPoint(t, p);
    span.getTangent(t, tng);
    nrm.set(0, 0, 1);
    bin.crossVectors(tng, nrm).normalize();
    nrm.crossVectors(bin, tng).normalize();
    // концы катушки — прямые выводы
    const k = Math.min(1, Math.min(t, 1 - t) / 0.06);
    const a = t * turns * Math.PI * 2;
    pts.push(p.clone().addScaledVector(nrm, Math.cos(a) * rc * k).addScaledVector(bin, Math.sin(a) * rc * k));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Лампочка: { group, glass, filament, glow, halo, base, setPower(v) } */
export function buildBulb(glowTex) {
  const group = new THREE.Group();
  group.name = 'bulb';
  const glassGeo = new THREE.LatheGeometry(bulbGlassProfile(1), 64);
  const glass = new THREE.Mesh(glassGeo, glassMaterial({ color: '#e4fbe6', glow: '#ffdcae', neck: 0.03 }));
  glass.renderOrder = 6;
  const base = new THREE.Mesh(
    new THREE.LatheGeometry(bulbBaseProfile(true), 48),
    new THREE.MeshStandardMaterial({ color: '#b9c2bb', metalness: 0.92, roughness: 0.28, transparent: true }),
  );
  // стеклянная «ножка» и вводы
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0026, 0.0055, 0.03, 16, 1, true).translate(0, 0.039, 0),
    glassMaterial({ color: '#cfeed2' }),
  );
  stem.renderOrder = 6;
  const wireMat = new THREE.MeshStandardMaterial({ color: '#9aa39c', metalness: 0.9, roughness: 0.35, transparent: true });
  const w1 = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.0018, 0.05, 0), new THREE.Vector3(-0.006, 0.062, 0), new THREE.Vector3(-0.0095, 0.0735, 0)]);
  const w2 = new THREE.CatmullRomCurve3([new THREE.Vector3(0.0018, 0.05, 0), new THREE.Vector3(0.006, 0.062, 0), new THREE.Vector3(0.0095, 0.0735, 0)]);
  const w3 = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.07, 0.0005), new THREE.Vector3(0, 0.0795, 0.0006)]);
  const wires = new THREE.Mesh(mergeGeometries([
    new THREE.TubeGeometry(w1, 16, 0.00032, 5), new THREE.TubeGeometry(w2, 16, 0.00032, 5), new THREE.TubeGeometry(w3, 16, 0.00022, 5),
  ]), wireMat);
  const filMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.22, 0.2), transparent: true });
  const filament = new THREE.Mesh(new THREE.TubeGeometry(filamentCurve(), 420, 0.00034, 6), filMat);
  // свечение: яркое ядро и широкое гало
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1, 0.85, 0.62), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(0.05);
  glow.position.set(0, BULB.filament + 0.002, 0);
  glow.renderOrder = 7;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1, 0.9, 0.72), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(0.22);
  halo.position.copy(glow.position);
  halo.renderOrder = 7;
  group.add(base, stem, wires, filament, glass, glow, halo);

  const warm = new THREE.Color(1.0, 0.8, 0.52);
  const off = new THREE.Color(0.2, 0.19, 0.17);
  const tmp = new THREE.Color();
  const api = {
    group, glass, filament, glow, halo, base,
    power: 0,
    setPower(v, flicker = 0) {
      api.power = v;
      const e = v * (1 + flicker);
      tmp.copy(off).lerp(warm, Math.min(1, v)).multiplyScalar(1 + e * 2.6);
      filMat.color.copy(tmp);
      glass.material.uniforms.uGlow.value = e * api.glassGlow;
      glow.material.color.setRGB(1, 0.8, 0.55).multiplyScalar(e * api.glowK);
      halo.material.color.setRGB(1, 0.86, 0.66).multiplyScalar(e * api.haloK);
      glow.visible = halo.visible = e > 0.01;
    },
    glassGlow: 0.2, glowK: 0.9, haloK: 0.28,
  };
  api.setPower(0);
  return api;
}

// ---------------------------------------------------------------------------
// Видеокарта (H100, PCIe): длина 0.268 м по X, высота 0.111 м по Y, толщина ~0.04 м, лицо к +Z
// ---------------------------------------------------------------------------
export const GPU = { L: 0.268, H: 0.111, T: 0.04 };

export function cardTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 212;
  const g = c.getContext('2d');
  g.fillStyle = '#2b312e'; g.fillRect(0, 0, 512, 212);
  // рамка кожуха
  g.fillStyle = '#3d4541'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 196, 512, 16);
  // окно с рёбрами радиатора
  g.fillStyle = '#101412'; g.fillRect(96, 30, 384, 140);
  for (let x = 100; x < 478; x += 7) { g.fillStyle = '#7d8a83'; g.fillRect(x, 32, 3, 136); }
  // логотип-надпись
  g.fillStyle = '#d7e3da';
  g.font = '800 34px Unbounded, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('H100', 14, 62);
  // зелёная полоса (плата)
  g.fillStyle = '#00c400'; g.fillRect(0, 184, 512, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Детальная модель видеокарты: { group, edges, strip } */
export function buildGPU() {
  const { L, H } = GPU;
  const group = new THREE.Group();
  group.name = 'gpu';
  const metal = new THREE.MeshStandardMaterial({ color: '#2a3033', metalness: 0.75, roughness: 0.3, envMapIntensity: 3, transparent: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#0b0d0c', metalness: 0.5, roughness: 0.6, envMapIntensity: 1.5, transparent: true });
  const pcbMat = new THREE.MeshStandardMaterial({ color: '#0f3a16', metalness: 0.25, roughness: 0.6, envMapIntensity: 2, transparent: true });
  const finMat = new THREE.MeshStandardMaterial({ color: '#f2f7f3', metalness: 0.85, roughness: 0.22, envMapIntensity: 5, transparent: true });
  const gold = new THREE.MeshStandardMaterial({ color: '#e0cc85', metalness: 0.95, roughness: 0.25, envMapIntensity: 3, transparent: true });

  const pcb = new THREE.Mesh(new THREE.BoxGeometry(L, H, 0.0018), pcbMat);
  pcb.position.z = -0.0175;
  // кожух: рамка вокруг окна радиатора (4 бруска) + задняя стенка
  const sh = [];
  const T = 0.032, z = 0.0;
  const winX0 = -0.066, winX1 = 0.118, winY0 = -0.034, winY1 = 0.036;
  const box = (w, h, d, x, y, zz) => new THREE.BoxGeometry(w, h, d).translate(x, y, zz);
  const sx0 = -L / 2 + 0.006, sx1 = L / 2 - 0.004, sy0 = -H / 2 + 0.006, sy1 = H / 2 - 0.004;
  sh.push(box(sx1 - sx0, sy1 - winY1, T, (sx0 + sx1) / 2, (winY1 + sy1) / 2, z));
  sh.push(box(sx1 - sx0, winY0 - sy0, T, (sx0 + sx1) / 2, (sy0 + winY0) / 2, z));
  sh.push(box(winX0 - sx0, winY1 - winY0, T, (sx0 + winX0) / 2, (winY0 + winY1) / 2, z));
  sh.push(box(sx1 - winX1, winY1 - winY0, T, (winX1 + sx1) / 2, (winY0 + winY1) / 2, z));
  const shroud = new THREE.Mesh(mergeGeometries(sh), metal);
  const winBack = new THREE.Mesh(box(winX1 - winX0, winY1 - winY0, 0.004, (winX0 + winX1) / 2, (winY0 + winY1) / 2, -0.013), dark);
  // светлая рамка окна радиатора
  const frameMat = new THREE.MeshStandardMaterial({ color: '#c9d3cd', metalness: 0.9, roughness: 0.25, envMapIntensity: 4, transparent: true });
  const fr = 0.0018;
  const winFrame = new THREE.Mesh(mergeGeometries([
    box(winX1 - winX0 + fr * 2, fr, 0.002, (winX0 + winX1) / 2, winY1 + fr / 2, T / 2 + 0.0008),
    box(winX1 - winX0 + fr * 2, fr, 0.002, (winX0 + winX1) / 2, winY0 - fr / 2, T / 2 + 0.0008),
    box(fr, winY1 - winY0, 0.002, winX0 - fr / 2, (winY0 + winY1) / 2, T / 2 + 0.0008),
    box(fr, winY1 - winY0, 0.002, winX1 + fr / 2, (winY0 + winY1) / 2, T / 2 + 0.0008),
  ]), frameMat);
  // рёбра радиатора
  const finGeo = new THREE.BoxGeometry(0.0011, winY1 - winY0 - 0.004, T - 0.006);
  const nF = 58;
  const fins = new THREE.InstancedMesh(finGeo, finMat, nF);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < nF; i++) {
    m4.makeTranslation(winX0 + 0.002 + (i + 0.5) * ((winX1 - winX0 - 0.004) / nF), (winY0 + winY1) / 2, 0.0);
    fins.setMatrixAt(i, m4);
  }
  // планка крепления, «золотые» контакты, разъём питания
  const bracket = new THREE.Mesh(mergeGeometries([box(0.0016, H + 0.014, 0.022, -L / 2 - 0.001, 0.004, -0.004), box(0.012, 0.0016, 0.022, -L / 2 + 0.005, H / 2 + 0.011, -0.004)]), finMat);
  const fingers = new THREE.Mesh(box(0.082, 0.0085, 0.0019, 0.012, -H / 2 - 0.004, -0.0175), gold);
  const power = new THREE.Mesh(box(0.022, 0.009, 0.012, 0.105, H / 2 + 0.0035, -0.008), dark);
  // светящаяся полоса и подпись
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(2.2), transparent: true });
  const strip = new THREE.Mesh(box(sx1 - sx0 - 0.02, 0.0022, 0.002, (sx0 + sx1) / 2, sy0 + 0.0045, T / 2 + 0.001), stripMat);
  const label = textMesh('H100', { height: 0.019, font: '800 120px Unbounded', color: '#e9f2ec', padding: 10 });
  label.position.set((sx0 + winX0) / 2 - 0.002, 0.014, T / 2 + 0.0012);
  label.material.transparent = true;
  // контур «голограммы»
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, 0.04).translate(0, 0, -0.002)),
    new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  edges.material.opacity = 0.4;
  group.add(pcb, shroud, winBack, winFrame, fins, bracket, fingers, power, strip, label, edges);
  return { group, edges, strip, stripMat };
}

// Упрощённая карта для массивов (одна коробка с текстурой «лица»)
export function cardGeometry() {
  return new THREE.BoxGeometry(GPU.L, GPU.H, 0.036);
}

// ---------------------------------------------------------------------------
// Серверная стойка и машинный зал
// ---------------------------------------------------------------------------
export const RACK = { W: 0.6, H: 2.1, D: 1.1, trays: 12, tray0: 0.12, pitch: 0.156 };

/** Слот видеокарты в стойке (локальные координаты стойки, лицом к +Z). */
export function rackSlot(tray, col, row) {
  const x = col === 0 ? -0.138 : 0.138;
  const y = RACK.tray0 + (tray + 0.5) * RACK.pitch + 0.004;
  const z = RACK.D / 2 - 0.07 - row * 0.062;
  return [x, y, z];
}

/** Детальная («героическая») стойка: открытая, с видеокартами внутри и мигающими индикаторами. */
export function buildHeroRack(cardTex) {
  const { W, H, D } = RACK;
  const group = new THREE.Group();
  group.name = 'hero-rack';
  const frameMat = new THREE.MeshStandardMaterial({ color: '#232926', metalness: 0.75, roughness: 0.4, transparent: true });
  const parts = [];
  const post = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(post, H, post).translate(sx * (W / 2 - post / 2), H / 2, sz * (D / 2 - post / 2)));
  parts.push(new THREE.BoxGeometry(W, 0.08, D).translate(0, 0.04, 0));
  parts.push(new THREE.BoxGeometry(W, 0.06, D).translate(0, H - 0.03, 0));
  // полки
  for (let i = 0; i <= RACK.trays; i++) parts.push(new THREE.BoxGeometry(W - 0.05, 0.005, D - 0.06).translate(0, RACK.tray0 + i * RACK.pitch - 0.003, 0));
  // задняя стенка
  parts.push(new THREE.BoxGeometry(W - 0.02, H - 0.1, 0.01).translate(0, H / 2, -D / 2 + 0.01));
  const frame = new THREE.Mesh(mergeGeometries(parts), frameMat);
  // боковые стёкла
  const sideGlass = new THREE.Mesh(
    mergeGeometries([new THREE.PlaneGeometry(D - 0.06, H - 0.12).rotateY(Math.PI / 2).translate(W / 2, H / 2, 0), new THREE.PlaneGeometry(D - 0.06, H - 0.12).rotateY(-Math.PI / 2).translate(-W / 2, H / 2, 0)]),
    glassMaterial({ color: '#bfe9c4' }),
  );
  sideGlass.material.uniforms.uOpacity.value = 0.55;
  sideGlass.renderOrder = 5;
  // видеокарты (без «героической» — её слот пустой)
  const cardMat = new THREE.MeshStandardMaterial({ map: cardTex, metalness: 0.55, roughness: 0.42, transparent: true });
  const slots = [];
  for (let t = 0; t < RACK.trays; t++) for (let c = 0; c < 2; c++) for (let r = 0; r < 4; r++) {
    if (t === HERO_SLOT[0] && c === HERO_SLOT[1] && r === HERO_SLOT[2]) continue;
    slots.push(rackSlot(t, c, r));
  }
  const cards = new THREE.InstancedMesh(cardGeometry(), cardMat, slots.length);
  const m4 = new THREE.Matrix4();
  slots.forEach((s, i) => { m4.makeTranslation(s[0], s[1], s[2]); cards.setMatrixAt(i, m4); });
  // индикаторы на передней кромке полок
  const leds = [];
  for (let t = 0; t < RACK.trays; t++) for (let k = 0; k < 4; k++) {
    leds.push({ p: [W / 2 - 0.05 - k * 0.022, RACK.tray0 + t * RACK.pitch + 0.012, D / 2 - 0.004], phase: Math.random(), k });
  }
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0)),
    new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.1), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  group.add(frame, cards, sideGlass, edges);
  return { group, leds, cards };
}

export const HERO_SLOT = [7, 0, 0];

// --- Стойки зала: одна InstancedMesh, шейдер — корпус, «лицо» с картами и мигающими индикаторами, подъём волной
const RACK_VERT = /* glsl */ `
attribute float aSeed;
attribute float aReveal;
uniform float uReveal;
varying vec3 vNl;
varying vec2 vUv;
varying float vSeed;
varying vec3 vNv;
varying float vK;
varying float vDepth;
void main() {
  float k = clamp((uReveal - aReveal) / 0.09, 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  vec3 p = position;
  p.y *= max(k, 0.0005);
  vec4 lp = vec4(p, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * lp;
  vNv = normalize(normalMatrix * n);
  vNl = normal;
  vUv = uv;
  vSeed = aSeed;
  vK = k;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const RACK_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uLed, uBody;
uniform vec2 uFog;
varying vec3 vNl;
varying vec2 vUv;
varying float vSeed;
varying vec3 vNv;
varying float vK;
varying float vDepth;
${HASH}
uniform float uLedR;
float ledDot(vec2 p, vec2 c, float r0, float px) {
  r0 *= uLedR;
  float r = max(r0, px * 0.9);
  float d = length(p - c);
  // вдали огонёк не исчезает, а становится тусклее (иначе — мерцание и «пустые» стойки)
  return (1.0 - smoothstep(r * 0.55, r, d)) * (r0 / r);
}
void main() {
  vec3 n = normalize(vNv);
  float diff = 0.4 + 0.6 * max(dot(n, normalize(vec3(0.25, 0.85, 0.45))), 0.0);
  vec3 col = vec3(0.035, 0.042, 0.038) * diff;
  vec3 glow = vec3(0.0);
  if (vNl.z > 0.5) {
    vec2 pm = vec2(vUv.x * 0.6, vUv.y * 2.1);
    float px = fwidth(pm.y);
    float inner = step(0.03, pm.x) * step(pm.x, 0.57) * step(0.1, pm.y) * step(pm.y, 2.03);
    float ty = (pm.y - 0.12) / 0.156;
    float tray = floor(ty);
    float fy = fract(ty);
    if (inner > 0.5 && ty > 0.0 && tray < 12.0) {
      col = vec3(0.012, 0.015, 0.013);
      // две «лицевые» видеокарты в полке: рёбра радиатора + зелёная кромка платы
      float card = step(0.13, fy) * step(fy, 0.86) * step(0.04, pm.x) * step(pm.x, 0.56) * (1.0 - step(0.296, pm.x) * step(pm.x, 0.304));
      float fins = 0.5 + 0.5 * cos(pm.x * 140.0 * 6.2831853);
      fins = mix(fins, 0.5, clamp(fwidth(pm.x * 140.0) * 1.5, 0.0, 1.0));
      col += card * (vec3(0.07, 0.08, 0.075) + vec3(0.07) * fins) * uBody;
      float pcb = step(0.13, fy) * step(fy, 0.2) * card;
      glow += pcb * vec3(0.0, 0.16, 0.0);
      // индикаторы
      vec2 lp = vec2(pm.x, fy * 0.156);
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float rate = 0.6 + hash12(vec2(vSeed * 13.1 + tray, fi)) * 2.6;
        float on = step(0.3, hash12(vec2(vSeed * 71.3 + tray * 3.7 + fi * 11.0, floor(uTime * rate + vSeed * 9.0 + fi))));
        float isW = step(0.82, hash12(vec2(vSeed + fi * 5.0, tray * 1.7)));
        vec3 lc = mix(vec3(0.2, 3.0, 0.2), vec3(2.4, 2.6, 2.4), isW);
        glow += lc * on * ledDot(lp, vec2(0.44 + fi * 0.04, 0.0085), 0.0065, px) * uLed;
      }
    } else if (inner < 0.5) {
      col = vec3(0.09, 0.1, 0.095) * diff * uBody;
    }
  } else if (vNl.z < -0.5) {
    // задняя стенка: решётка вентиляции
    float v = 0.5 + 0.5 * cos(vUv.y * 2.1 * 60.0 * 6.2831853);
    v = mix(v, 0.5, clamp(fwidth(vUv.y * 126.0) * 1.5, 0.0, 1.0));
    col = (vec3(0.02, 0.024, 0.022) + vec3(0.02) * v) * uBody;
  } else if (vNl.y > 0.5) {
    col = vec3(0.04, 0.046, 0.043) * uBody;
    float e = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5));
    glow += vec3(0.0, 0.16, 0.03) * smoothstep(0.47, 0.5, e);
  } else {
    col *= uBody;
  }
  // кромка снизу при подъёме
  glow += vec3(0.0, 1.2, 0.2) * (1.0 - vK) * step(0.02, vK);
  // «туман» по глубине: корпуса тонут во тьме, огоньки видны дальше
  float fog = 1.0 - smoothstep(uFog.x, uFog.y, vDepth);
  gl_FragColor = vec4(col * fog + glow * mix(0.3, 1.0, fog), uOpacity);
}
`;

export function rackMaterial({ body = 1, fog = [1e6, 2e6], led = 1, ledR = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uOpacity: { value: 1 }, uLed: { value: led }, uLedR: { value: ledR }, uReveal: { value: 0 },
      uBody: { value: body }, uFog: { value: new THREE.Vector2(fog[0], fog[1]) },
    },
    vertexShader: RACK_VERT,
    fragmentShader: RACK_FRAG,
    transparent: true,
  });
}

/**
 * Массив стоек. items — [{ x, z, face: 1|-1, reveal, seed }]. Стойка стоит на полу (y = 0), лицом к +Z (face = 1) или −Z.
 */
export function buildRackField(items, mat) {
  const geo = new THREE.BoxGeometry(RACK.W, RACK.H, RACK.D).translate(0, RACK.H / 2, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const seed = new Float32Array(items.length), rev = new Float32Array(items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot ?? (it.face > 0 ? 0 : Math.PI));
    p.set(it.x, it.y || 0, it.z);
    if (it.scale) s.setScalar(it.scale); else s.set(1, 1, 1);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
    seed[i] = it.seed ?? Math.random();
    rev[i] = it.reveal ?? 0;
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.setAttribute('aReveal', new THREE.InstancedBufferAttribute(rev, 1));
  mesh.frustumCulled = false;
  return mesh;
}

// Раскладка зала: ряды по X, «холодные» и «горячие» коридоры. Стойка-герой — в начале координат, лицом к +Z.
export const HALL = { perRow: 25, rows: 8, pitchX: 0.62, cols: [-2, 3], deep: 4, sizeX: 18, sizeZ: 20 };
export function hallRowZ(r) {
  // пары рядов: 0 (лицом +Z), 1 (лицом −Z, спиной к 0), 2 (лицом +Z), …
  const pair = Math.floor(r / 2);
  const z = r % 2 === 0 ? -pair * 4.3 : -2.0 - pair * 4.3;
  return { z, face: r % 2 === 0 ? 1 : -1 };
}

export function hallLayout() {
  const items = [];
  for (let hi = HALL.cols[0]; hi <= HALL.cols[1]; hi++) {
    for (let hj = 0; hj < HALL.deep; hj++) {
      const ox = hi * HALL.sizeX, oz = -hj * HALL.sizeZ;
      const hallDist = Math.hypot(hi, hj);
      for (let r = 0; r < HALL.rows; r++) {
        const { z, face } = hallRowZ(r);
        for (let k = 0; k < HALL.perRow; k++) {
          const x = (k - (HALL.perRow - 1) / 2) * HALL.pitchX;
          if (hi === 0 && hj === 0 && r === 0 && k === (HALL.perRow - 1) / 2) continue; // место героя
          const d = Math.hypot(x, z);
          const reveal = hi === 0 && hj === 0 ? 0.05 + d / 21 : 1.08 + hallDist * 0.22 + Math.hypot(x, z) / 120;
          items.push({ x: ox + x, z: oz + z, face, reveal, seed: Math.random() });
        }
      }
    }
  }
  return items;
}

// --- Пол: плитки фальшпола, «холодные» коридоры с перфорированными плитками, проявление по залам
const FLOOR_VERT = /* glsl */ `
varying vec3 vP;
void main() {
  vP = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FLOOR_FRAG = /* glsl */ `
uniform float uOpacity, uReveal, uTime, uCold;
varying vec3 vP;
${HASH}
float gridLine(float x, float period, float w) {
  float f = abs(fract(x / period + 0.5) - 0.5) * period;
  float aa = fwidth(x) * 1.2;
  return 1.0 - smoothstep(w, w + aa, f);
}
void main() {
  vec2 p = vP.xz;
  float hi = floor((p.x + 9.0) / 18.0);
  float hj = floor((2.6 - p.y) / 20.0);
  vec2 lp = vec2(p.x - hi * 18.0, p.y + hj * 20.0);
  float inHall = step(abs(lp.x), 8.2) * step(-16.4, lp.y) * step(lp.y, 2.6) * step(-2.5, hi) * step(hi, 3.5) * step(-0.5, hj) * step(hj, 3.5);
  float thr = (hi == 0.0 && hj == 0.0) ? 0.04 : 1.0 + length(vec2(hi, hj)) * 0.22;
  float rev = smoothstep(thr, thr + 0.12, uReveal);
  vec3 col = vec3(0.012, 0.016, 0.014);
  float a = 0.0;
  if (inHall > 0.5) {
    float tiles = gridLine(lp.x, 0.6, 0.012) + gridLine(lp.y, 0.6, 0.012);
    float lodT = clamp(1.0 - fwidth(lp.x) * 6.0, 0.0, 1.0);
    col = vec3(0.03, 0.036, 0.033) + vec3(0.05, 0.065, 0.058) * min(tiles, 1.0) * lodT;
    // холодные коридоры: центры 1.15 − 4.3k (k = 0…3)
    float cz = lp.y - 1.15;
    float k = floor(-cz / 4.3 + 0.5);
    float dz = cz + k * 4.3;
    float cold = (1.0 - smoothstep(0.5, 0.62, abs(dz))) * step(-0.5, k) * step(k, 3.5) * step(abs(lp.x), 7.9);
    vec2 q = fract(lp / 0.06) - 0.5;
    float perf = 1.0 - smoothstep(0.18, 0.28, length(q));
    perf = mix(perf, 0.35, clamp(fwidth(lp.x / 0.06) * 1.2, 0.0, 1.0));
    float breathe = 0.85 + 0.15 * sin(uTime * 1.3 + lp.y * 0.4);
    col += cold * uCold * (vec3(0.18, 0.5, 0.24) * perf + vec3(0.03, 0.1, 0.05)) * breathe;
    a = rev;
  } else {
    a = 0.0;
  }
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export function buildFloor() {
  // весь пол здания: x от −45 до 63, z от −78 до 3
  const geo = new THREE.PlaneGeometry(110, 84, 1, 1).rotateX(-Math.PI / 2).translate(9, -0.004, -37.5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uReveal: { value: 0 }, uTime: { value: 0 }, uCold: { value: 1 } },
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -2;
  return m;
}

/** Корпус здания (стены без крыши) с контуром. */
export function buildBuilding() {
  const x0 = -45.2, x1 = 63.2, z0 = -76.6, z1 = 3.4, h = 12;
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: '#141a17', metalness: 0.3, roughness: 0.75, transparent: true, side: THREE.DoubleSide });
  const w = x1 - x0, d = z1 - z0;
  const walls = mergeGeometries([
    new THREE.PlaneGeometry(w, h).translate((x0 + x1) / 2, h / 2, z1),
    new THREE.PlaneGeometry(w, h).translate((x0 + x1) / 2, h / 2, z0),
    new THREE.PlaneGeometry(d, h).rotateY(Math.PI / 2).translate(x0, h / 2, (z0 + z1) / 2),
    new THREE.PlaneGeometry(d, h).rotateY(Math.PI / 2).translate(x1, h / 2, (z0 + z1) / 2),
  ]);
  const wallMesh = new THREE.Mesh(walls, wallMat);
  // перегородки между залами (низкие)
  const parts = [];
  for (let hi = -2; hi <= 2; hi++) parts.push(new THREE.BoxGeometry(0.4, 4, d - 1).translate(hi * 18 + 9, 2, (z0 + z1) / 2));
  for (let hj = 1; hj <= 3; hj++) parts.push(new THREE.BoxGeometry(w - 1, 4, 0.4).translate((x0 + x1) / 2, 2, -hj * 20 + 2.9));
  const inner = new THREE.Mesh(mergeGeometries(parts), wallMat);
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.3), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d).translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2)), edgeMat);
  // крышные агрегаты (охладители) по периметру
  const units = [];
  for (let i = 0; i < 18; i++) units.push(new THREE.BoxGeometry(4.2, 2.4, 2.6).translate(x0 + 4 + i * 5.9, 1.2, z0 - 3.6));
  for (let i = 0; i < 18; i++) units.push(new THREE.BoxGeometry(4.2, 2.4, 2.6).translate(x0 + 4 + i * 5.9, 1.2, z0 - 7.2));
  const chillers = new THREE.Mesh(mergeGeometries(units), new THREE.MeshStandardMaterial({ color: '#2a312d', metalness: 0.5, roughness: 0.55, transparent: true }));
  group.add(wallMesh, inner, edges, chillers);
  return { group, bounds: { x0, x1, z0, z1, h } };
}

// ---------------------------------------------------------------------------
// АЭС: градирни (однополостный гиперболоид), реакторные корпуса, машинный зал
// ---------------------------------------------------------------------------
export const TOWER = { h: 150, throat: 34, throatY: 110, base: 58 };
const towerC = () => TOWER.throatY / Math.sqrt((TOWER.base / TOWER.throat) ** 2 - 1);

export function towerGeometry() {
  const c = towerC();
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * TOWER.h;
    const s = (y - TOWER.throatY) / c;
    pts.push(new THREE.Vector2(TOWER.throat * Math.sqrt(1 + s * s), y));
  }
  return new THREE.LatheGeometry(pts, 72);
}

/** Образующие гиперболоида (две системы прямых) для всех градирен. */
export function towerLines(centers, perFamily = 40) {
  const c = towerC();
  const s0 = -TOWER.throatY / c, s1 = (TOWER.h - TOWER.throatY) / c;
  const a = TOWER.throat * 1.004;
  const pos = [];
  centers.forEach(([cx, cz]) => {
    for (const sign of [-1, 1]) {
      for (let i = 0; i < perFamily; i++) {
        const th = (i / perFamily) * Math.PI * 2;
        for (const s of [s0, s1]) {
          pos.push(cx + a * (Math.cos(th) - sign * s * Math.sin(th)), TOWER.throatY + c * s, cz + a * (Math.sin(th) + sign * s * Math.cos(th)));
        }
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function buildPlant(origin) {
  const [ox, oz] = origin;
  const group = new THREE.Group();
  group.name = 'plant';
  const towers = [[0, 0], [175, -20], [-20, -175], [155, -195]].map(([x, z]) => [ox + x, oz + z]);
  const tGeo = towerGeometry();
  const tMat = new THREE.MeshStandardMaterial({ color: '#29312c', metalness: 0.1, roughness: 0.92, side: THREE.DoubleSide, transparent: true });
  const tMesh = new THREE.InstancedMesh(tGeo, tMat, towers.length);
  const m4 = new THREE.Matrix4();
  towers.forEach(([x, z], i) => { m4.makeTranslation(x, 0, z); tMesh.setMatrixAt(i, m4); });
  const lines = new THREE.LineSegments(towerLines(towers), new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(0.9), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
  // верхние кромки градирен
  const rimPos = [];
  towers.forEach(([x, z]) => {
    const r = TOWER.throat * Math.sqrt(1 + ((TOWER.h - TOWER.throatY) / towerC()) ** 2);
    for (let i = 0; i < 96; i++) {
      const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
      rimPos.push(x + Math.cos(a0) * r, TOWER.h, z + Math.sin(a0) * r, x + Math.cos(a1) * r, TOWER.h, z + Math.sin(a1) * r);
    }
  });
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  const rims = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(1.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  // реакторные здания (цилиндр + купол) и машинный зал
  const bMat = new THREE.MeshStandardMaterial({ color: '#2c3530', metalness: 0.2, roughness: 0.8, transparent: true });
  const domes = [];
  [[-120, 70], [-120, -40]].forEach(([x, z]) => {
    domes.push(new THREE.CylinderGeometry(24, 24, 44, 40).translate(ox + x, 22, oz + z));
    domes.push(new THREE.SphereGeometry(24, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).translate(ox + x, 44, oz + z));
  });
  domes.push(new THREE.BoxGeometry(46, 36, 150).translate(ox - 185, 18, oz + 15));
  domes.push(new THREE.BoxGeometry(24, 70, 24).translate(ox - 70, 35, oz + 140));
  const buildings = new THREE.Mesh(mergeGeometries(domes), bMat);
  const bEdges = new THREE.LineSegments(new THREE.EdgesGeometry(buildings.geometry, 30), new THREE.LineBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.1), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(tMesh, lines, rims, buildings, bEdges);
  return { group, towers, tMesh };
}

// --- Пар над градирнями: поднимающиеся клубы (Points, анимация в шейдере)
const STEAM_VERT = /* glsl */ `
attribute vec4 aData;   // x: индекс градирни-центр (через позицию), y: фаза, z: угол, w: случайное
uniform float uTime, uScale, uWorld, uRise;
varying float vA;
${SIMPLEX}
void main() {
  float t = fract(uTime * (0.045 + aData.w * 0.03) + aData.y);
  float h = t * 230.0 * uRise;
  float r0 = 36.0 * sqrt(aData.w);
  float spread = r0 + t * (40.0 + 60.0 * aData.w);
  vec3 p = position;
  p.x += cos(aData.z) * spread + t * t * 120.0;
  p.z += sin(aData.z) * spread;
  p.y += h;
  p += vec3(snoise(vec3(p.xz * 0.012, uTime * 0.1 + aData.w)), 0.0, snoise(vec3(p.zx * 0.012, uTime * 0.1))) * 18.0 * t;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (14.0 + 52.0 * t) * (0.6 + aData.w * 0.8);
  gl_PointSize = clamp(size * uWorld * uScale / max(0.05, -mv.z), 1.0, 104.0);
  vA = sin(3.14159 * t) * (1.0 - t * 0.4) * uRise;
}
`;
const STEAM_FRAG = /* glsl */ `
uniform float uOpacity, uTheme;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.0) * vA * 0.078 * uOpacity * uTheme;
  gl_FragColor = vec4(vec3(0.92, 1.0, 0.94), a);
}
`;

export function buildSteam(towers, perTower = 900) {
  const n = towers.length * perTower;
  const pos = new Float32Array(n * 3), data = new Float32Array(n * 4);
  let i = 0;
  towers.forEach(([x, z]) => {
    for (let k = 0; k < perTower; k++, i++) {
      pos.set([x, TOWER.h - 6, z], i * 3);
      data.set([0, Math.random(), Math.random() * Math.PI * 2, Math.random()], i * 4);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uWorld: { value: 1 }, uRise: { value: 0 }, uOpacity: { value: 1 }, uTheme: { value: 1 } },
    vertexShader: STEAM_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 8;
  return p;
}

// ---------------------------------------------------------------------------
// Земля: сетка участка (вблизи) и тёмная «карта» с халфтоном (издалека), волна от дата-центра
// ---------------------------------------------------------------------------
const GROUND_FRAG = /* glsl */ `
uniform float uOpacity, uMap, uWave, uTime, uSite;
varying vec3 vP;
${HASH}
float gridLine(float x, float period, float w) {
  float f = abs(fract(x / period + 0.5) - 0.5) * period;
  float aa = fwidth(x) * 1.2;
  float l = 1.0 - smoothstep(w, w + aa, f);
  // гасим слишком частую сетку (LOD)
  return l * clamp(1.0 - fwidth(x) / period * 5.0, 0.0, 1.0);
}
void main() {
  vec2 p = vP.xz;
  float r = length(p);
  // участок: сетка 50 / 250 м, затухает к краям
  float siteFade = (1.0 - smoothstep(600.0, 2600.0, r)) * uSite;
  float g1 = gridLine(p.x, 50.0, 0.6) + gridLine(p.y, 50.0, 0.6);
  float g2 = gridLine(p.x, 250.0, 1.4) + gridLine(p.y, 250.0, 1.4);
  vec3 col = vec3(0.0, 0.06, 0.012) * min(g1, 1.0) * siteFade + vec3(0.02, 0.13, 0.035) * min(g2, 1.0) * siteFade;
  // карта: сетка 100 км + халфтон-точки, ярче к центру
  const mat2 R = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  vec2 q = R * p / 26000.0;
  vec2 f = fract(q) - 0.5;
  float v = 0.12 + 0.55 * exp(-r / 600000.0);
  float dotm = 1.0 - smoothstep(0.32 * sqrt(v) - 0.06, 0.32 * sqrt(v) + 0.06, length(f));
  dotm *= clamp(1.0 - fwidth(q.x) * 2.0, 0.0, 1.0);
  float g3 = gridLine(p.x, 100000.0, 600.0) + gridLine(p.y, 100000.0, 600.0);
  float mapFade = (1.0 - smoothstep(900000.0, 1600000.0, r)) * uMap;
  col += (vec3(0.0, 0.05, 0.01) * dotm + vec3(0.01, 0.055, 0.02) * min(g3, 1.0)) * mapFade;
  // волна от дата-центра
  float w = uWave;
  float dw = (r - w) / 22000.0;
  float ring = exp(-dw * dw) * step(1.0, w) * (1.0 - smoothstep(850000.0, 1350000.0, w));
  col += vec3(0.1, 0.95, 0.22) * ring * uMap;
  float a = clamp(max(siteFade, mapFade), 0.0, 1.0);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export function buildGround() {
  const geo = new THREE.PlaneGeometry(4.4e6, 4.4e6, 1, 1).rotateX(-Math.PI / 2).translate(0, -0.05, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uMap: { value: 0 }, uSite: { value: 1 }, uWave: { value: 0 }, uTime: { value: 0 } },
    vertexShader: FLOOR_VERT,
    fragmentShader: GROUND_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -3;
  return m;
}
