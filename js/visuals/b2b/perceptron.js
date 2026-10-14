// Перцептрон: входы x₁…x₃ → веса w₁…w₃ → сумматор Σ → порог → «1».
// Общий для слайдов «1943: нейрон на языке математики» (synapse.js) и «От нейрона к таблице» (layers.js):
// одинаковые координаты, форма частиц и вид — поэтому переход между слайдами бесшовный.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import { ready, FatLines, GlowPoints, orbMaterial, instAttr, sstep, bump, glowSprite, setInstance, spaceDust } from './lib.js';

// Раскладка (мир; камера [0,0,14], fov 45 — правая половина «сцены 16:9»)
export const PERC = {
  inputs: [[1.6, 2.0, 0], [1.6, 0, 0], [1.6, -2.0, 0]],
  inR: 0.36,
  sigma: [4.5, 0, 0],
  sigR: 0.72,
  thr: [6.55, 0, 0],
  thrW: 1.25,
  thrH: 1.0,
  out: [8.35, 0, 0],
  outR: 0.62,
  weights: [1.45, 0.62, 1.05], // толщина = «сила» веса
};

// Длительность цикла сигнала (общая с синапсом)
export const CYCLE = 4.4;

// ---------- Форма облака частиц ----------
let shapeCache = null;
export function perceptronShape(count) {
  if (shapeCache && shapeCache.count === count) return shapeCache;
  const r = rng(58);
  const parts = [];
  const shell = (c, rad, m, col) => (n) => {
    const s = S.createShape(n);
    for (let i = 0; i < n; i++) {
      const inner = r() < 0.18;
      const [x, y, z] = inner ? r.inSphere(rad * 0.85) : r.onSphere(rad * (1 + r.gauss(0, 0.04)));
      const cc = r() < 0.3 ? S.PAL.greenHi : r() < 0.5 ? S.PAL.mint : S.PAL.white;
      S.setPoint(s, i, c[0] + x, c[1] + y, c[2] + z, r.range(0.5, 1.15), cc, (inner ? 0.12 : 0.42) * m * col);
    }
    return s;
  };
  const seg = (a, b, scatter, alpha) => (n) => {
    const s = S.createShape(n);
    for (let i = 0; i < n; i++) {
      const t = r();
      const cc = r() < 0.45 ? S.PAL.green : S.PAL.mint;
      S.setPoint(s, i, a[0] + (b[0] - a[0]) * t + r.gauss(0, scatter), a[1] + (b[1] - a[1]) * t + r.gauss(0, scatter), a[2] + (b[2] - a[2]) * t + r.gauss(0, scatter), r.range(0.4, 0.9), cc, alpha * r.range(0.5, 1));
    }
    return s;
  };
  const P = PERC;
  P.inputs.forEach((p) => parts.push({ weight: 2400, shape: shell(p, P.inR, 1, 1) }));
  P.inputs.forEach((p, i) => parts.push({ weight: 1300, shape: seg(p, P.sigma, 0.035 * P.weights[i], 0.45) }));
  parts.push({ weight: 5200, shape: shell(P.sigma, P.sigR, 1, 1) });
  parts.push({ weight: 800, shape: seg(P.sigma, P.thr, 0.03, 0.45) });
  // рамка «порога»
  parts.push({ weight: 3400, shape: (n) => {
    const s = S.createShape(n);
    const w = P.thrW / 2, h = P.thrH / 2;
    for (let i = 0; i < n; i++) {
      const k = r() * 4;
      let x, y;
      if (k < 1) { x = -w + k * 2 * w; y = h; } else if (k < 2) { x = w; y = h - (k - 1) * 2 * h; } else if (k < 3) { x = w - (k - 2) * 2 * w; y = -h; } else { x = -w; y = -h + (k - 3) * 2 * h; }
      const cc = r() < 0.4 ? S.PAL.greenHi : S.PAL.white;
      S.setPoint(s, i, P.thr[0] + x + r.gauss(0, 0.02), P.thr[1] + y + r.gauss(0, 0.02), r.gauss(0, 0.12), r.range(0.5, 1), cc, 0.38);
    }
    return s;
  } });
  parts.push({ weight: 800, shape: seg(P.thr, P.out, 0.03, 0.45) });
  parts.push({ weight: 3600, shape: shell(P.out, P.outR, 1, 1) });
  // мягкое гало вокруг схемы
  parts.push({ weight: 9000, shape: (n) => {
    const s = S.createShape(n);
    for (let i = 0; i < n; i++) {
      const x = r.range(0.4, 9.6), y = r.gauss(0, 1.5), z = r.gauss(0, 1.2) - 0.6;
      S.setPoint(s, i, x, y, z, r.range(0.35, 0.8), r() < 0.35 ? S.PAL.green : S.PAL.white, r.range(0.03, 0.1));
    }
    return s;
  } });
  // космическая пыль
  parts.push({ weight: 26000, shape: spaceDust(S, r, { alpha: [0.05, 0.2] }) });
  const total = parts.reduce((a, p) => a + p.weight, 0);
  const s = S.combine(count, parts.map((p) => ({ weight: p.weight / total, shape: p.shape })));
  shapeCache = ready(s);
  return s;
}

// ---------- Шейдер рёбер: «прорисовка» + бегущие импульсы ----------
const EDGE_FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uOpacity, uFade, uTime, uBuild;
uniform vec4 uP;
varying vec2 vST;
varying vec4 vData;
varying float vLen;
void main() {
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vST.x));
  float grow = clamp((uBuild - vData.x) / 0.3, 0.0, 1.0);
  if (vST.y > grow + 0.001) discard;
  int g = int(vData.z + 0.5);
  float p = g == 0 ? uP.x : (g == 1 ? uP.y : uP.z);
  float k = 0.0;
  if (p > -0.5) { float x = (vST.y - p) / 0.085; k = exp(-x * x); }
  float tq = max(0.0, grow - vST.y) / 0.05;
  float tip = grow < 0.999 ? exp(-tq * tq) : 0.0;
  vec3 col = uColor * (0.5 + 0.35 * vData.y) + uHot * (k * (0.7 + 0.5 * vData.y) + tip);
  float a = e * vData.w * uOpacity * uFade * (0.55 + 0.45 * max(k, tip));
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;

// Кольцо-«накопитель» вокруг Σ и ступенька «порога»
const GAUGE_FRAG = /* glsl */ `
uniform vec3 uColor, uHot, uDim;
uniform float uOpacity, uFade, uFill, uFire, uBuild;
varying vec2 vST;
varying vec4 vData;
void main() {
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vST.x));
  int g = int(vData.z + 0.5);
  vec3 col;
  float a;
  if (g == 0) {
    // сегмент кольца: vData.x — доля окружности
    float on = step(vData.x, uFill);
    col = mix(uDim, uColor, on) + uHot * uFire * on;
    a = mix(0.35, 1.0, on);
  } else if (g == 1) {
    // отметка порога
    col = uColor * 1.4 + uHot * uFire;
    a = 1.0;
  } else {
    // ступенька
    col = mix(uDim * 1.6, uColor, 0.6) + uHot * uFire;
    a = 0.9;
  }
  a *= e * vData.w * uOpacity * uFade * uBuild;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;


/**
 * Вид перцептрона: меши, рёбра, кольцо Σ, ступенька порога, подписи.
 *   view = new PerceptronView(visual, fadeUniform); visual.root.add(view.group)
 *   view.makeLabels(); view.set(build 0..1, alpha 0..1); view.loop(tCycle) — в update()
 */
export class PerceptronView {
  constructor(visual, fade) {
    this.visual = visual;
    this.fade = fade;
    this.group = new THREE.Group();
    this.group.name = 'perceptron';
    this.build = 0;
    this.alpha = 1;
    this.labels = null;
    this._on = {};
    const P = PERC;

    // Узлы: 3 входа, Σ, выход. Матрицы статичны; «прорисовка», пульсации и вспышки — в шейдере по uniform'ам
    this.nU = { uB: { value: 0 }, uAl: { value: 1 }, uInK: { value: 0 }, uSigB: { value: 0 }, uFill: { value: 0 }, uFire: { value: 0 }, uFlash: { value: 0 } };
    this.nodeMat = orbMaterial({
      color: '#00ff00', intensity: 1.0, fill: 0.16, rim: 1.25, core: 0.06, fade, uniforms: this.nU,
      vertexHead: 'attribute vec2 aNode; uniform float uB, uAl, uInK, uSigB, uFill, uFire, uFlash;',
      vertexBody: `
        float i = aNode.x;
        float k = smoothstep(0.08 * i, 0.08 * i + 0.4, uB);
        float extra = i < 2.5 ? 0.12 * uInK : (i < 3.5 ? 0.08 * uSigB : 0.18 * uFlash);
        s = vec3(aNode.y * (0.2 + 0.8 * k) * (1.0 + extra));
        float lum = 0.55 + (i < 2.5 ? 1.4 * uInK : (i < 3.5 ? 0.9 * uFill : 1.6 * uFire + 1.5 * uFlash));
        tint = vec3(lum * k * uAl);`,
    });
    this.nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 40, 28), this.nodeMat, 5);
    this.nodes.frustumCulled = false;
    this.nodeDefs = [
      ...P.inputs.map((p) => ({ p, r: P.inR })),
      { p: P.sigma, r: P.sigR },
      { p: P.out, r: P.outR },
    ];
    this.nodeDefs.forEach((d, i) => setInstance(this.nodes, i, d.p[0], d.p[1], d.p[2], 1));
    instAttr(this.nodes, 'aNode', 2, this.nodeDefs.flatMap((d, i) => [i, d.r]));
    this.group.add(this.nodes);

    // Блок «порог» — стеклянный брусок
    this.thrMat = orbMaterial({ color: '#c8ffc0', intensity: 0.85, fill: 0.06, rim: 1.0, fade });
    this.thrBox = new THREE.Mesh(new RoundedBoxGeometry(P.thrW, P.thrH, 0.5, 4, 0.16), this.thrMat);
    this.thrBox.position.set(...P.thr);
    this.group.add(this.thrBox);

    // Рёбра
    this.edges = new FatLines(5, {
      width: 4.2,
      color: '#7dff6e',
      intensity: 0.9,
      fade,
      fragment: EDGE_FRAG,
      uniforms: { uHot: { value: new THREE.Color('#00ff00').multiplyScalar(2.6) }, uBuild: { value: 0 }, uP: { value: new THREE.Vector4(-1, -1, -1, -1) } },
    });
    const sig = new THREE.Vector3(...P.sigma);
    P.inputs.forEach((p, i) => {
      const a = new THREE.Vector3(...p), d = sig.clone().sub(a).normalize();
      const A = a.clone().addScaledVector(d, P.inR + 0.06), B = sig.clone().addScaledVector(d, -(P.sigR + 0.08));
      this.edges.setEdge(i, A.toArray(), B.toArray());
      this.edges.setData(i, 0.05 + i * 0.06, P.weights[i], 0, 1);
    });
    this.edges.setEdge(3, [P.sigma[0] + P.sigR + 0.08, 0, 0], [P.thr[0] - P.thrW / 2 - 0.05, 0, 0]);
    this.edges.setData(3, 0.45, 1, 1, 1);
    this.edges.setEdge(4, [P.thr[0] + P.thrW / 2 + 0.05, 0, 0], [P.out[0] - P.outR - 0.08, 0, 0]);
    this.edges.setData(4, 0.6, 1, 2, 1);
    this.edges.commit();
    this.group.add(this.edges.mesh);

    // Кольцо Σ (72 сегмента) + отметка порога + ступенька (3 отрезка)
    const NG = 72;
    this.gauge = new FatLines(NG + 1 + 3, {
      width: 5,
      color: '#00ff00',
      intensity: 1.7,
      fade,
      fragment: GAUGE_FRAG,
      uniforms: {
        uHot: { value: new THREE.Color('#ffffff').multiplyScalar(1.4) },
        uDim: { value: new THREE.Color('#1f5a1a') },
        uFill: { value: 0 },
        uFire: { value: 0 },
        uBuild: { value: 0 },
      },
    });
    const R = P.sigR + 0.2;
    for (let i = 0; i < NG; i++) {
      const a0 = Math.PI / 2 - (i / NG) * Math.PI * 2, a1 = Math.PI / 2 - ((i + 1) / NG) * Math.PI * 2;
      this.gauge.setEdge(i, [P.sigma[0] + Math.cos(a0) * R, P.sigma[1] + Math.sin(a0) * R, 0], [P.sigma[0] + Math.cos(a1) * R, P.sigma[1] + Math.sin(a1) * R, 0]);
      this.gauge.setData(i, (i + 0.5) / NG, 1, 0, 1);
    }
    this.thrFrac = 0.62;
    const at = Math.PI / 2 - this.thrFrac * Math.PI * 2;
    this.gauge.setEdge(NG, [P.sigma[0] + Math.cos(at) * (R - 0.16), P.sigma[1] + Math.sin(at) * (R - 0.16), 0], [P.sigma[0] + Math.cos(at) * (R + 0.2), P.sigma[1] + Math.sin(at) * (R + 0.2), 0]);
    this.gauge.setData(NG, 0, 1.15, 1, 1);
    const [tx, ty] = P.thr;
    const sx = 0.38, sy = 0.24;
    this.stepPts = [[tx - sx, ty - sy], [tx, ty - sy], [tx, ty + sy], [tx + sx, ty + sy]];
    for (let i = 0; i < 3; i++) {
      const a = this.stepPts[i], b = this.stepPts[i + 1];
      this.gauge.setEdge(NG + 1 + i, [a[0], a[1], 0.26], [b[0], b[1], 0.26]);
      this.gauge.setData(NG + 1 + i, 0, 1.0, 2, 1);
    }
    this.gauge.commit();
    this.group.add(this.gauge.mesh);

    // Точка на ступеньке (положение и яркость — uniform uDot) + вспышки
    this.dotU = { uDot: { value: new THREE.Vector3(0, 0, 0) } };
    this.dots = new GlowPoints(1, { fade, uniforms: this.dotU, vertexHead: 'uniform vec3 uDot;', vertexBody: 'pos = vec3(uDot.xy, 0.3); col.a *= uDot.z;' });
    this.dots.set(0, 0, 0, 0.3, 0.28, 0.6, 2.4, 0.6, 1);
    this.dots.commit();
    this.group.add(this.dots.points);
    this.outGlow = glowSprite('#00ff00', 2.6, 1.6);
    this.outGlow.position.set(...P.out);
    this.group.add(this.outGlow);
    this.sigGlow = glowSprite('#00ff00', 2.2, 1.2);
    this.sigGlow.position.set(...P.sigma);
    this.group.add(this.sigGlow);
  }

  /** HTML-подписи (создаются заново при каждом входе визуализации). */
  makeLabels() {
    const v = this.visual, P = PERC;
    const L = {};
    L.x = P.inputs.map((p, i) => v.label({ html: `<span class="b2b-sym">x<sub>${i + 1}</sub></span>`, position: [p[0] - P.inR - 0.18, p[1], 0], anchor: 'right', visible: false }));
    const sig = new THREE.Vector3(...P.sigma);
    L.w = P.inputs.map((p, i) => {
      const a = new THREE.Vector3(...p);
      const mid = a.clone().lerp(sig, 0.5);
      const d = sig.clone().sub(a).normalize();
      const n = new THREE.Vector3(-d.y, d.x, 0);
      if (i === 2) n.multiplyScalar(-1);
      mid.addScaledVector(n, 0.5);
      return v.label({ html: `<span class="b2b-sym is-w">w<sub>${i + 1}</sub></span>`, position: mid.toArray(), visible: false });
    });
    L.sigma = v.label({ html: '<span class="b2b-sym is-big">Σ</span>', position: [P.sigma[0], P.sigma[1], 0.2], visible: false });
    L.thr = v.label({ html: '<span class="b2b-chip">порог</span>', position: [P.thr[0], P.thr[1] - P.thrH / 2 - 0.5, 0], visible: false });
    L.out = v.label({ html: '<span class="b2b-out">1</span>', position: [P.out[0], P.out[1], 0.3], visible: false });
    this.labels = L;
    this._on = {};
    return L;
  }

  showLabels(on) {
    const L = this.labels;
    if (!L) return;
    const all = [...L.x, ...L.w, L.sigma, L.thr, L.out];
    all.forEach((l) => (on ? l.show() : l.hide()));
  }

  _toggle(key, el, on) {
    if (this._on[key] === on) return;
    this._on[key] = on;
    el.classList.toggle('is-on', on);
  }

  /** build — прорисовка (0..1), alpha — общая видимость (0..1). */
  set(build, alpha = 1) {
    this.build = build;
    this.alpha = alpha;
  }

  /**
   * Покадрово: tt — время внутри цикла сигнала [0, CYCLE), active — идёт ли сигнал.
   */
  update(tt, active = true) {
    const P = PERC, b = this.build, al = this.alpha;
    const vis = b * al;
    this.group.visible = vis > 0.002;
    if (!this.group.visible) return;
    const sig = active ? 1 : 0;
    // фазы сигнала
    const inK = sig * bump(tt, 1.1, 0.22);
    const pIn = sig && tt > 1.0 && tt < 1.85 ? sstep(1.0, 1.8, tt) : -1;
    const fill = sig ? (tt < 1.7 ? 0 : tt < 2.9 ? sstep(1.7, 2.9, tt) * 0.88 : tt < 3.9 ? 0.88 : 0.88 * (1 - sstep(3.9, 4.3, tt))) : 0;
    const pSig = sig && tt > 2.5 && tt < 2.95 ? sstep(2.5, 2.9, tt) : -1;
    const pOut = sig && tt > 2.92 && tt < 3.2 ? sstep(2.92, 3.12, tt) : -1;
    const fire = sig * (tt > 3.05 ? Math.max(0, 1 - sstep(3.5, 4.2, tt)) : 0);
    const flash = sig * bump(tt, 3.1, 0.12);

    // узлы: появление по очереди, пульсации — в шейдере (здесь только uniform'ы)
    const nu = this.nU;
    nu.uB.value = b;
    nu.uAl.value = al;
    nu.uInK.value = inK;
    nu.uSigB.value = bump(tt, 2.9, 0.25) * sig;
    nu.uFill.value = fill;
    nu.uFire.value = fire;
    nu.uFlash.value = flash;
    this.thrMat.uniforms.uOpacity.value = sstep(0.4, 0.8, b) * al * (0.75 + 0.6 * fire);
    this.thrBox.scale.setScalar(0.6 + 0.4 * sstep(0.4, 0.8, b));

    const eu = this.edges.uniforms;
    eu.uBuild.value = b * 1.25;
    eu.uOpacity.value = al;
    eu.uP.value.set(pIn, pSig, pOut, -1);
    const gu = this.gauge.uniforms;
    gu.uBuild.value = sstep(0.55, 0.95, b);
    gu.uOpacity.value = al;
    gu.uFill.value = fill;
    gu.uFire.value = fire;

    // точка на ступеньке: едет вправо и прыгает вверх на пороге
    const [s0, s1, s2, s3] = this.stepPts;
    const mv = sig ? sstep(2.75, 3.05, tt) : 0;
    let x, y;
    if (mv < 0.5) { x = s0[0] + (s1[0] - s0[0]) * (mv / 0.5); y = s0[1]; } else { x = s2[0] + (s3[0] - s2[0]) * ((mv - 0.5) / 0.5); y = s2[1]; }
    const dotA = sig * sstep(2.6, 2.8, tt) * (1 - sstep(3.9, 4.3, tt)) * vis;
    this.dotU.uDot.value.set(x, y, dotA);
    this.dots.update(this.visual.ctx);

    this.outGlow.material.opacity = (0.15 + 0.85 * fire + 0.6 * flash) * vis * this.fade.value;
    this.outGlow.scale.setScalar(2.2 + 1.6 * flash);
    this.sigGlow.material.opacity = (0.08 + 0.5 * fill * fill) * vis * this.fade.value;

    // подписи: «1» загорается, веса вспыхивают при проходе импульса
    const L = this.labels;
    if (L) {
      this._toggle('out', L.out.el, fire > 0.5);
      const wOn = pIn > 0.3 && pIn < 0.85;
      L.w.forEach((l, i) => this._toggle('w' + i, l.el, wOn));
      L.x.forEach((l, i) => this._toggle('x' + i, l.el, inK > 0.4));
      this._toggle('s', L.sigma.el, fill > this.thrFrac);
      this._toggle('t', L.thr.el, fire > 0.5);
    }
  }
}
