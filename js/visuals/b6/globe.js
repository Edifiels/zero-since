// Карта мира: точечный глобус (суша — частицы общего облака), аэропорты — яркие огни, дуги перелётов.
// Шаг 0 — мир живёт; шаг 1 — сбой волной с востока на запад: огни аэропортов гаснут, суша темнеет,
// глобус поворачивается вслед за фронтом, счётчик набирает 8 500 000; шаг 2 — итог.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { HASH } from '../../core/glsl.js';
import { rng, formatNumber, clamp } from '../../core/utils.js';
import { loadData, makeCanvas, orderShape, recolorShape, yieldFrame } from './util.js';

const R = 3.55;                    // радиус глобуса
const CENTER = [4.15, -0.25, 0];   // центр глобуса в мире (справа от текста)
const TILT = 0.36;                 // наклон: северное полушарие к зрителю
const WAVE_FROM = 196, WAVE_TO = -200; // долгота фронта (градусы): восток → запад
const WAVE_DUR = 8.0;              // секунды
const TOTAL = 8500000;

const deg = THREE.MathUtils.degToRad;
const toXYZ = (lon, lat, r = R) => {
  const la = deg(lat), lo = deg(lon);
  return [r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo)];
};

// ---------- Шейдеры ----------
const AIRPORT_VERT = /* glsl */ `
attribute float aLon;
attribute float aSize;
attribute float aSeed;
uniform float uFront, uTime, uScale, uOpacity;
varying vec3 vCol;
varying float vA;
${HASH}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 nV = normalize(normalMatrix * normalize(position));
  float facing = dot(nV, normalize(-mv.xyz));
  float d = aLon - uFront;
  float tw = 0.78 + 0.22 * sin(uTime * (1.3 + aSeed * 3.0) + aSeed * 40.0);
  vec3 col = mix(vec3(0.75, 1.7, 0.7), vec3(1.5, 1.6, 1.45), step(0.72, aSeed));
  float a = tw;
  float size = aSize;
  if (d > 0.0) {
    float k = d / 22.0;
    if (k < 1.0) {
      float fl = step(0.45, hash12(vec2(aSeed * 91.0, floor(uTime * 15.0))));
      col = mix(vec3(2.6, 0.35, 0.22), vec3(1.4, 0.1, 0.06), k);
      a = mix(1.5, fl * 0.9, smoothstep(0.08, 0.9, k));
      size *= 1.0 + 1.6 * (1.0 - k);
    } else {
      col = vec3(0.75, 0.06, 0.04);
      a = 0.26 + 0.2 * step(0.985, hash12(vec2(aSeed * 13.0, floor(uTime * 6.0))));
      size *= 0.75;
    }
  }
  a *= smoothstep(0.02, 0.3, facing) * uOpacity;
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 0.0, 64.0);
  vCol = col;
  vA = a;
  if (a < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const GLOW_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 7.0);
  float halo = (1.0 - d) * 0.22;
  gl_FragColor = vec4(vCol, (core + halo) * vA);
}
`;

const ARC_VERT = /* glsl */ `
attribute float aT;
attribute float aSeed;
attribute float aLonMax;
uniform float uFront, uTime, uScale, uOpacity;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 nV = normalize(normalMatrix * normalize(position));
  float facing = dot(nV, normalize(-mv.xyz));
  float hit = aLonMax - uFront;
  float alive = 1.0 - smoothstep(0.0, 9.0, hit);
  float death = smoothstep(0.0, 1.5, hit) * (1.0 - smoothstep(2.0, 9.0, hit));
  float head = fract(uTime * (0.09 + aSeed * 0.08) + aSeed * 7.0);
  float dd = head - aT;
  float pulse = dd >= 0.0 ? exp(-dd * 16.0) : 0.0;
  float a = (0.16 + pulse * 1.1) * alive + death * 0.9;
  vCol = mix(mix(vec3(0.45, 1.15, 0.45), vec3(1.7, 1.75, 1.6), pulse), vec3(2.2, 0.25, 0.15), death);
  vA = a * smoothstep(-0.25, 0.25, facing) * uOpacity;
  gl_PointSize = clamp((0.85 + pulse * 1.6) * uScale / max(0.1, -mv.z), 0.0, 40.0);
  if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SPHERE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const OCEAN_FRAG = /* glsl */ `
uniform float uFront, uOpacity, uHit;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec2 xz = vObj.xz;
  if (dot(xz, xz) < 1e-10) xz = vec2(0.0, 1.0);
  float lon = degrees(atan(xz.x, xz.y));
  float d = lon - uFront;
  float hit = step(0.0, d);
  float band = hit * exp(-d / 22.0);
  float fres = pow(clamp(1.0 - dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.5);
  vec3 col = vec3(0.0, 0.012, 0.003) + vec3(0.0, 0.11, 0.02) * fres * (1.0 - uHit);
  col += vec3(0.26, 0.01, 0.0) * band + vec3(0.008, 0.0, 0.0) * hit + vec3(0.12, 0.0, 0.0) * fres * uHit;
  gl_FragColor = vec4(col, uOpacity);
}
`;
const ATMO_FRAG = /* glsl */ `
uniform float uOpacity, uHit;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
  float a = pow(clamp(f, 0.0, 1.0), 6.0) * 0.95;
  vec3 col = mix(vec3(0.1, 1.0, 0.18), vec3(1.0, 0.12, 0.06), uHit);
  gl_FragColor = vec4(col * a, a * uOpacity);
}
`;

export default class Globe extends Visual {
  static transition = 'zoomout';

  async init() {
    const [land, airports, cities] = await Promise.all([loadData('land'), loadData('airports'), loadData('cities')]);
    this.u = { uFront: { value: WAVE_FROM }, uTime: { value: 0 }, uScale: { value: 300 }, uOpacity: { value: 1 }, uHit: { value: 0 } };

    // Группа глобуса повторяет трансформацию облака частиц
    this.globe = new THREE.Group();
    this.root.add(this.globe);

    // «Океан» — непрозрачная сфера (закрывает обратную сторону точек)
    this.ocean = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.985, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { uFront: this.u.uFront, uOpacity: { value: 1 }, uHit: this.u.uHit },
        vertexShader: SPHERE_VERT, fragmentShader: OCEAN_FRAG, transparent: true,
      }),
    );
    this.ocean.renderOrder = 1;
    this.globe.add(this.ocean);
    // Атмосфера
    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.13, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0.9 }, uHit: this.u.uHit },
        vertexShader: SPHERE_VERT, fragmentShader: ATMO_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.atmo.renderOrder = 2;
    this.globe.add(this.atmo);

    // Аэропорты
    const r = rng(17);
    const ap = airports.airports;
    const pos = new Float32Array(ap.length * 3), lon = new Float32Array(ap.length), size = new Float32Array(ap.length), seed = new Float32Array(ap.length);
    ap.forEach(([lo, la, rank], i) => {
      pos.set(toXYZ(lo, la, R * 1.006), i * 3);
      lon[i] = lo;
      size[i] = 0.62 + (9 - rank) * 0.085;
      seed[i] = r();
    });
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ag.setAttribute('aLon', new THREE.BufferAttribute(lon, 1));
    ag.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    ag.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.airports = new THREE.Points(ag, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: AIRPORT_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.airports.renderOrder = 14;
    this.airports.frustumCulled = false;
    this.globe.add(this.airports);

    // Дуги перелётов между крупными аэропортами (точками)
    const big = ap.filter((a) => a[2] <= 4);
    const arcs = [];
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vt = new THREE.Vector3();
    let guard = 0;
    while (arcs.length < 74 && guard++ < 5000) {
      const a = big[Math.floor(r() * big.length)], b = big[Math.floor(r() * big.length)];
      va.set(...toXYZ(a[0], a[1], 1)); vb.set(...toXYZ(b[0], b[1], 1));
      const ang = va.angleTo(vb);
      if (ang < deg(18) || ang > deg(95)) continue;
      arcs.push([a, b, ang]);
    }
    const PER = 46;
    const apos = new Float32Array(arcs.length * PER * 3), at = new Float32Array(arcs.length * PER), aseed = new Float32Array(arcs.length * PER), alon = new Float32Array(arcs.length * PER);
    arcs.forEach(([a, b, ang], k) => {
      va.set(...toXYZ(a[0], a[1], 1)); vb.set(...toXYZ(b[0], b[1], 1));
      const s = r(), lm = Math.max(a[0], b[0]);
      for (let i = 0; i < PER; i++) {
        const t = i / (PER - 1);
        // сферическая интерполяция
        const sa = Math.sin((1 - t) * ang) / Math.sin(ang), sb = Math.sin(t * ang) / Math.sin(ang);
        vt.copy(va).multiplyScalar(sa).addScaledVector(vb, sb).normalize().multiplyScalar(R * (1.012 + 0.2 * Math.sin(Math.PI * t) * (ang / deg(90))));
        const j = k * PER + i;
        apos.set([vt.x, vt.y, vt.z], j * 3);
        at[j] = t; aseed[j] = s; alon[j] = lm;
      }
    });
    const arcG = new THREE.BufferGeometry();
    arcG.setAttribute('position', new THREE.BufferAttribute(apos, 3));
    arcG.setAttribute('aT', new THREE.BufferAttribute(at, 1));
    arcG.setAttribute('aSeed', new THREE.BufferAttribute(aseed, 1));
    arcG.setAttribute('aLonMax', new THREE.BufferAttribute(alon, 1));
    this.arcs = new THREE.Points(arcG, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: ARC_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.arcs.renderOrder = 13;
    this.arcs.frustumCulled = false;
    this.globe.add(this.arcs);

    // Фронт сбоя: красный меридиан
    this.front = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(0.9), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.frontMats = [ringMat, glowMat];
    this.front.add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.008, 0.014, 6, 200), ringMat));
    this.front.add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.09, 8, 200), glowMat));
    this.front.renderOrder = 15;
    this.globe.add(this.front);
    this.front.visible = false;

    // Формы облака: суша, города, океан — упорядочены по долготе (для волны)
    await yieldFrame();
    await this.buildShapes(land, cities);

    this.k = { wave: 0, enter: 1 };
    this.spin = 0;          // текущая долгота «к зрителю» (градусы)
    this.lonC = 128;
    this.countEl = null;
  }

  async buildShapes(land, cities) {
    const n = this.ctx.particles.count;
    // Маска суши (равнопромежуточная проекция)
    const MW = 1440, MH = 720;
    const cnv = makeCanvas(MW, MH);
    const g = cnv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    land.polygons.forEach((poly) => {
      g.beginPath();
      poly.forEach((ring) => {
        for (let i = 0; i < ring.length; i += 2) {
          const x = (ring[i] + 180) / 360 * MW, y = (90 - ring[i + 1]) / 180 * MH;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
      });
      g.fill('evenodd');
    });
    const mask = g.getImageData(0, 0, MW, MH).data;
    const isLand = (lon, lat) => {
      const x = Math.min(MW - 1, Math.max(0, Math.floor((lon + 180) / 360 * MW)));
      const y = Math.min(MH - 1, Math.max(0, Math.floor((90 - lat) / 180 * MH)));
      return mask[(y * MW + x) * 4 + 3] > 127;
    };
    const r = rng(23);
    const s = S.createShape(n);
    const keys = new Float32Array(n);   // время «удара» волны, 0..1 (−1 — заполнитель)
    const golden = Math.PI * (3 - Math.sqrt(5));
    let i = 0;
    const nLand = Math.floor(n * 0.56), nCity = Math.floor(n * 0.035), nOcean = Math.floor(n * 0.1);
    const waveKey = (lon) => clamp((WAVE_FROM - lon) / (WAVE_FROM - WAVE_TO), 0, 1);
    // суша: точки решётки Фибоначчи над сушей
    await yieldFrame();
    const N = Math.round(nLand / 0.3);
    const landPts = [];
    for (let k = 0; k < N; k++) {
      const y = 1 - (2 * (k + 0.5)) / N;
      const rad = Math.sqrt(1 - y * y);
      const ph = golden * k;
      const lat = THREE.MathUtils.radToDeg(Math.asin(y));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(Math.cos(ph) * rad, Math.sin(ph) * rad));
      if (isLand(lon, lat)) landPts.push([lon, lat]);
    }
    for (let k = 0; i < nLand; k++, i++) {
      const [lon, lat] = landPts[k % landPts.length];
      const dup = k >= landPts.length;
      const jl = dup ? r.gauss(0, 0.25) : 0;
      const p = toXYZ(lon + jl, lat + (dup ? r.gauss(0, 0.25) : 0), R * (1.0 + r() * 0.004));
      const c = r() < 0.16 ? S.PAL.white : r() < 0.5 ? S.PAL.mint : S.PAL.green;
      S.setPoint(s, i, p[0], p[1], p[2], dup ? 0.55 : r.range(0.7, 1.05), c, dup ? 0.18 : r.range(0.32, 0.55));
      keys[i] = waveKey(lon);
    }
    await yieldFrame();
    // города — огни (крупные — ярче и больше)
    const cs = cities.cities.filter((c) => c[2] > 300000).sort((a, b) => b[2] - a[2]);
    const lights = [];
    cs.forEach(([lon, lat, pop]) => { const m = Math.min(14, 1 + Math.round(Math.sqrt(pop / 1.2e6) * 3)); for (let q = 0; q < m; q++) lights.push([lon, lat, pop]); });
    for (let k = 0; i < nLand + nCity; k++, i++) {
      const [lon, lat, pop] = lights[k % lights.length];
      const sp = 0.25 + Math.min(1.2, pop / 8e6);
      const p = toXYZ(lon + r.gauss(0, sp), lat + r.gauss(0, sp * 0.8), R * 1.003);
      S.setPoint(s, i, p[0], p[1], p[2], r.range(0.8, 1.5), r() < 0.6 ? S.PAL.warm : S.PAL.bright, r.range(0.45, 0.8));
      keys[i] = waveKey(lon);
    }
    // океан — редкая решётка
    const NO = Math.round(nOcean / 0.68);
    for (let k = 0; k < NO && i < nLand + nCity + nOcean; k++) {
      const y = 1 - (2 * (k + 0.5)) / NO;
      const rad = Math.sqrt(1 - y * y);
      const ph = golden * k;
      const lat = THREE.MathUtils.radToDeg(Math.asin(y));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(Math.cos(ph) * rad, Math.sin(ph) * rad));
      if (isLand(lon, lat)) continue;
      const p = toXYZ(lon, lat, R * 0.998);
      S.setPoint(s, i, p[0], p[1], p[2], 0.6, S.PAL.green, 0.07);
      keys[i] = -1;
      i++;
    }
    // звёздная пыль вокруг
    for (; i < n; i++) {
      const [x, y, z] = r.onSphere(r.range(R * 2.2, 30));
      S.setPoint(s, i, x, y * 0.7, z, r.range(0.4, 0.9), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.22));
      keys[i] = -1;
    }
    // Ранги: точка, которую волна «бьёт» в момент key, получает частицу с долей старта ≈ key
    const order = [];
    for (let q = 0; q < n; q++) if (keys[q] >= 0) order.push(q);
    order.sort((a, b) => keys[a] - keys[b]);
    const rank = new Float32Array(n).fill(-1);
    const used = new Uint8Array(n);
    let last = -1;
    for (const q of order) {
      let rk = Math.max(Math.round(keys[q] * (n - 1)), last + 1);
      if (rk > n - 1) rk = n - 1;
      while (used[rk] && rk < n - 1) rk++;
      used[rk] = 1; rank[q] = rk; last = rk;
    }
    let free = 0;
    for (let q = 0; q < n; q++) {
      if (rank[q] >= 0) continue;
      while (used[free]) free++;
      used[free] = 1; rank[q] = free;
    }
    await yieldFrame();
    orderShape(s, rank);
    s.meta.equalized = true;
    this.shapeLit = s;
    // «Погасший» мир: суша тускнеет, огни городов — красные угли
    await yieldFrame();
    this.shapeDim = recolorShape(s, (q, c) => {
      const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      if (c[3] < 0.1) return c; // океан и дальние звёзды
      if (lum > 0.9) return [0.95, 0.08, 0.05, c[3] * 0.45];
      return [lum * 0.2 + 0.03, lum * 0.2, lum * 0.21, c[3] * 0.55];
    });
    this.shapeDim.meta.equalized = true;
  }

  // Позы — для 16:9; под экраны 4:3 / 16:10 ядро подгоняет их само.
  camera(state, step) {
    return step >= 2
      ? { pos: [-0.6, 0.55, 15.2], target: [0.25, -0.1, 0], fov: 40 }
      : { pos: [0, 0.45, 14.2], target: [0, -0.05, 0], fov: 40 };
  }

  background(state, step) { return step >= 1 ? 'danger' : 'right'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.08, swirl: 0, size: 0.052, twinkle: 0.18, spring: 18, damping: 6, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    const done = this.step >= 1;
    this.lit = !done;
    p.morph(done ? this.shapeDim : this.shapeLit, { duration: o.instant ? 0.01 : 2.1, stagger: 0.5, burst: 12, equalize: false });
    const obj = p.object;
    this._rot0 = obj.rotation.clone();
    this.k.enter = o.instant ? 1 : 0;
    this.tw(this.k, { enter: 1, duration: o.instant ? 0 : 1.9, ease: 'power2.inOut' });
    this.tw(obj.position, { x: CENTER[0], y: CENTER[1], z: CENTER[2], duration: o.instant ? 0 : 1.9, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.9, ease: 'power2.inOut' });
    // начальный вид: живой мир — Азия и Тихий океан (волна придёт с востока); погасший — Европа и Африка
    this.lonC = done ? 34 : 128;
    this._follow = true;
    this._waveDelay?.kill();
    this._waveDelay = null;
    this._waveTl?.kill();
    this._waveTl = null;
    this.u.uFront.value = done ? WAVE_TO : WAVE_FROM;
    this.u.uHit.value = done ? 1 : 0;
    this.front.visible = false;
    this.countEl = null;
    this._lastCount = null;
    this.setCount(done ? 1 : 0);
    if (this.step === 1 && !o.instant && o.dir !== -1) {
      // вошли сразу на шаг волны — проиграть её после перехода
      this.u.uFront.value = WAVE_FROM;
      this.u.uHit.value = 0;
      this.lit = true;
      this.lonC = 128;
      this.setCount(0);
      p.morph(this.shapeLit, { duration: 2.0, stagger: 0.5, burst: 10, equalize: false });
      this._waveDelay = this.delay(1.6, () => { this._waveDelay = null; this.runWave(); });
    }
    return super.enter(o);
  }

  /** Шаг 0 — мир живёт; 1 — волна сбоя; 2 — итог (если волна ещё идёт — она быстро доходит до конца). */
  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    const pending = !!this._waveDelay;
    this._waveDelay?.kill();
    this._waveDelay = null;
    if (step === 0) {
      if (prev >= 1 || pending || this.u.uFront.value < WAVE_FROM) this.relight();
    } else if (step === 1) {
      if (prev === 0 || pending) this.runWave();
    } else if (this.u.uFront.value > WAVE_TO + 0.5) {
      this.finishWave(pending);
    }
  }

  /** Волна с востока на запад. fast — короткая версия (итог по клику, пока волна не дошла). */
  runWave(fast = false) {
    this._waveTl?.kill();
    const u = this.u;
    const p = this.particles;
    const from = Math.min(u.uFront.value, WAVE_FROM);
    const left = (from - WAVE_TO) / (WAVE_FROM - WAVE_TO);
    const dur = Math.max(0.6, fast ? Math.min(1.5, WAVE_DUR * left) : WAVE_DUR * left);
    this._follow = !fast;
    this._waveKind = 'wave';
    if (this.ownsParticles() && this.lit) {
      this.lit = false;
      p.morph(this.shapeDim, { duration: dur / 0.9, stagger: 0.9, burst: 5, ease: 'none', equalize: false });
      this._dimMorph = p.morphTween;
    }
    this.front.visible = true;
    const tl = this._waveTl = this.tl();
    this.frontMats[0].opacity = 0; this.frontMats[1].opacity = 0;
    tl.to(this.frontMats[0], { opacity: 1, duration: 0.4 }, 0);
    tl.to(this.frontMats[1], { opacity: 0.22, duration: 0.4 }, 0);
    tl.to(u.uFront, { value: WAVE_TO, duration: dur, ease: 'none' }, 0);
    tl.to(u.uHit, { value: 1, duration: dur * 0.9, ease: 'power1.in' }, 0);
    tl.to(this.frontMats, { opacity: 0, duration: 0.6 }, Math.max(0.4, dur - 0.5));
    tl.call(() => { this.front.visible = false; }, null, dur + 0.15);
    tl.call(() => this.ctx.engine.pulse({ aberration: 0.8 }, 0.8), null, 0.05);
  }

  /** Итог по клику, пока волна ещё идёт: ускорить её (вместе с угасанием суши) до ~1,5 с. */
  finishWave(notStarted = false) {
    const tl = this._waveTl;
    if (notStarted || !tl || this._waveKind !== 'wave' || tl.progress() >= 1) { this.runWave(true); return; }
    const left = (tl.duration() - tl.time()) / tl.timeScale();
    if (left <= 1.5) return;
    const k = left / 1.5;
    tl.timeScale(tl.timeScale() * k);
    if (this._dimMorph && this.particles.morphTween === this._dimMorph) this._dimMorph.timeScale(this._dimMorph.timeScale() * k);
    this._follow = false;
  }

  relight() {
    this._waveTl?.kill();
    const u = this.u;
    this.front.visible = false;
    this._follow = true;
    this._waveKind = 'light';
    const tl = this._waveTl = this.tl();
    tl.to(u.uFront, { value: WAVE_FROM, duration: 1.4, ease: 'power2.inOut' }, 0);
    tl.to(u.uHit, { value: 0, duration: 1.2 }, 0);
    if (this.ownsParticles()) {
      this.lit = true;
      this.particles.morph(this.shapeLit, { duration: 1.4, stagger: 0.4, burst: 3, equalize: false });
    }
  }

  exit(o = {}) {
    this._waveDelay?.kill();
    this._waveDelay = null;
    this._waveTl?.kill();
    this._waveTl = null;
    this.front.visible = false;
    return super.exit(o);
  }

  /** Счётчик на слайде синхронизирован с фронтом волны. */
  setCount(p) {
    if (!this.countEl || !this.countEl.isConnected) {
      const el = this.ctx.deck?.currentEl;
      this.countEl = el && el.dataset.id === 'b6k-world' ? el.querySelector('[data-b6k-count]') : null;
    }
    if (!this.countEl) return;
    const e = p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(1 - p, 1.6);
    const v = Math.round((TOTAL * e) / 1000) * 1000;
    if (v !== this._lastCount) {
      this._lastCount = v;
      this.countEl.textContent = formatNumber(v);
    }
  }

  update(dt, t) {
    const u = this.u;
    u.uTime.value = t;
    const e = this.ctx.engine;
    u.uScale.value = (e.height * e.pixelRatio * 0.5) / Math.tan(deg(this.ctx.camera.fov * 0.5)) * 0.06;
    // долгота «к зрителю»: медленное вращение, во время волны — догоняем фронт (только на запад,
    // по кратчайшей дуге — иначе на переходе через ±180° глобус делал бы лишний оборот)
    const lonF = u.uFront.value;
    this.lonC -= dt * 2.2;
    if (this._follow && lonF < WAVE_FROM - 0.5 && lonF > WAVE_TO + 0.5) {
      const d = ((lonF - 24 - this.lonC + 540) % 360) - 180;
      if (d < 0) this.lonC += d * Math.min(1, dt * 2.4);
    }
    if (this.lonC < -180) this.lonC += 360;
    if (this.lonC > 180) this.lonC -= 360;
    // крутить сам глобус
    const spinY = -deg(this.lonC);
    const g = this.globe;
    const obj = this.particles.object;
    if (this.ownsParticles()) {
      const k = this.k.enter;
      const tgtX = TILT;
      if (k < 1) {
        const r0 = this._rot0;
        obj.rotation.set(r0.x + (tgtX - r0.x) * k, lerpAngle(r0.y, spinY, k), r0.z * (1 - k));
      } else obj.rotation.set(tgtX, spinY, 0);
      g.position.copy(obj.position);
      g.rotation.copy(obj.rotation);
      g.scale.copy(obj.scale);
    } else {
      g.position.set(...CENTER);
      g.rotation.set(TILT, spinY, 0);
    }
    // фронт волны — меридиан
    if (this.front.visible) this.front.rotation.set(0, deg(lonF) + Math.PI / 2, 0);
    // счётчик
    this.setCount((WAVE_FROM - lonF) / (WAVE_FROM - WAVE_TO));
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
