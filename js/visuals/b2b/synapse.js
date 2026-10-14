// «1943: нейрон на языке математики». Сплит-скрин:
//   слева — живой синапс (импульс по аксону → лопаются пузырьки нейромедиатора → молекулы летят через щель →
//   следующий нейрон вспыхивает), справа — тот же сигнал в цифрах (перцептрон: x → w → Σ → порог → «1»).
// Шаги: 0 — синапс крупно; 1 — справа строится перцептрон, соответствия «дендриты → входы» и т. д.;
//       2 — «1958: Розенблатт…»: частицы живого синапса перетекают в перцептрон.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng } from '../../core/utils.js';
import {
  ready, FatLines, GlowPoints, membraneMaterial, orbMaterial, glowInstancedMaterial, instAttr, glowSprite, noFade, fitFov,
  updateShared, sstep, bump, setInstance, phase,
} from './lib.js';
import { PerceptronView, perceptronShape, PERC, CYCLE } from './perceptron.js';

// ---------- Геометрия синапса (мир, камера шага 1: [0,0,14]) ----------
const B = [-6.35, 0.2, 0];            // пресинаптическое окончание (бутон)
const BR = [1.25, 1.35, 1.1];
const BFACE = B[0] + 0.92;            // плоская «активная зона» (смотрит в щель)
const H = [-3.58, 0.2, 0];            // шипик следующего нейрона (щель ~1 ед. — видно, как молекулы перелетают)
const HR = [0.95, 1.05, 0.85];
const HFACE = H[0] - 0.78;            // постсинаптическая мембрана
const GAP_X = (BFACE + HFACE) / 2;    // середина синаптической щели
const SOMA = [-1.55, -1.75, -0.2];
const SOMA_R = 0.9;

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const AXON = new THREE.CatmullRomCurve3([[-12.8, 1.35, -1.9], [-10.6, 1.12, -0.95], [-8.8, 0.82, -0.3], [-7.55, 0.45, 0], [-6.75, 0.28, 0]].map(V3));
const DEND = new THREE.CatmullRomCurve3([[-3.3, -0.1, 0], [-2.85, -0.62, -0.05], [-2.45, -1.1, -0.12], [-2.0, -1.47, -0.18], [-1.62, -1.72, -0.2]].map(V3));
const BRANCHES = [
  new THREE.CatmullRomCurve3([[-0.95, -2.25, -0.2], [-0.45, -3.05, -0.4], [0.05, -3.75, -0.6]].map(V3)),
  new THREE.CatmullRomCurve3([[-2.15, -2.3, 0.1], [-2.95, -2.95, 0.25], [-3.85, -3.3, 0.3]].map(V3)),
  new THREE.CatmullRomCurve3([[-1.4, -2.55, 0.25], [-1.3, -3.3, 0.45], [-1.05, -3.95, 0.6]].map(V3)),
];
const SAXON = new THREE.CatmullRomCurve3([[-0.75, -2.1, -0.1], [-0.05, -2.45, -0.2], [0.55, -2.75, -0.3], [1.1, -3.05, -0.35]].map(V3));

// ---------- Шейдер дуг-соответствий («марширующий» пунктир) ----------
const ARC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uFade, uTime, uBuild;
uniform vec3 uLen;
varying vec2 vST;
varying vec4 vData;
void main() {
  int k = int(vData.w + 0.5);
  float L = k == 0 ? uLen.x : (k == 1 ? uLen.y : uLen.z);
  float s = vData.x + vST.y * vData.z;
  float u = s / L;
  float grow = clamp(uBuild * 1.9 - vData.w * 0.35, 0.0, 1.0);
  if (u > grow) discard;
  float dash = step(0.42, fract(s / 0.32 - uTime * 1.6));
  float e = 1.0 - smoothstep(0.3, 1.0, abs(vST.x));
  float hq = max(0.0, grow - u) / 0.04;
  float head = exp(-hq * hq) * step(grow, 0.999);
  float a = e * uOpacity * uFade * (0.28 + 0.72 * dash) + head * e;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (1.0 + head * 1.5), a);
}
`;

export default class Synapse extends Visual {
  static transition = 'zoom';

  async init() {
    this.fade = { value: 1 };
    this.ph = { bio: 1, perc: 0, map: 0 };
    this.t0 = 0;
    this.r = rng(1943);
    this.bio = new THREE.Group();
    this.root.add(this.bio);
    this.buildMembranes();
    this.buildVesicles();
    this.buildMolecules();
    this.buildReceptors();
    this.view = new PerceptronView(this, this.fade);
    this.root.add(this.view.group);
    this.buildArcs();
    noFade(this.root);
    this.bioShapeCache = null;
    // формы частиц строим заранее (init идёт при фоновой предзагрузке), чтобы переход не ждал
    this.bioShape();
    perceptronShape(this.ctx.particles.count);
  }

  // ---------------------------------------------------------------------------
  buildMembranes() {
    const f = this.fade;
    const mk = (geo, opts) => { const m = new THREE.Mesh(geo, membraneMaterial({ fade: f, ...opts })); this.bio.add(m); return m; };
    // аксон
    this.axon = mk(new THREE.TubeGeometry(AXON, 160, 0.27, 18, false), { width: 0.07, trail: 0.16 });
    // бутон (эллипсоид с плоской активной зоной)
    const bg = new THREE.SphereGeometry(1, 56, 40);
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * BR[0] + B[0];
      if (x > BFACE) x = BFACE + (x - BFACE) * 0.08;
      p.setXYZ(i, x, p.getY(i) * BR[1] + B[1], p.getZ(i) * BR[2] + B[2]);
    }
    bg.computeVertexNormals();
    this.bouton = mk(bg, { base: 0.03, intensity: 0.45 });
    // шипик (постсинаптическая сторона)
    const hg = new THREE.SphereGeometry(1, 48, 36);
    const q = hg.attributes.position;
    for (let i = 0; i < q.count; i++) {
      let x = q.getX(i) * HR[0] + H[0];
      if (x < HFACE) x = HFACE + (x - HFACE) * 0.08;
      q.setXYZ(i, x, q.getY(i) * HR[1] + H[1], q.getZ(i) * HR[2] + H[2]);
    }
    hg.computeVertexNormals();
    this.spine = mk(hg, { base: 0.03, intensity: 0.42 });
    // дендрит до тела следующего нейрона
    this.dend = mk(new THREE.TubeGeometry(DEND, 90, 0.19, 14, false), { width: 0.09, trail: 0.2 });
    // тело следующего нейрона
    this.soma = mk(new THREE.SphereGeometry(SOMA_R, 48, 36), { base: 0.05, intensity: 0.5 });
    this.soma.position.set(...SOMA);
    this.branches = BRANCHES.map((c) => mk(new THREE.TubeGeometry(c, 60, 0.1, 10, false), { width: 0.12, trail: 0.2, intensity: 0.4 }));
    this.saxon = mk(new THREE.TubeGeometry(SAXON, 60, 0.13, 12, false), { width: 0.1, trail: 0.2 });

    // свечения — чисто зелёные и умеренные: бледно-зелёная вспышка + bloom выгорают в белый диск
    this.boutonGlow = glowSprite('#00ff00', 3.0, 0.8);
    this.boutonGlow.position.set(B[0] + 0.3, B[1], 0.2);
    this.somaGlow = glowSprite('#00ff00', 3.6, 0.85);
    this.somaGlow.position.set(...SOMA);
    this.heads = [glowSprite('#8dff80', 1.1, 1.3), glowSprite('#8dff80', 0.9, 1.3), glowSprite('#8dff80', 0.8, 1.3)];
    this.bio.add(this.boutonGlow, this.somaGlow, ...this.heads);
  }

  buildVesicles() {
    const r = this.r;
    const N = 34;
    // Пузырьки: покачивание, причаливание, «лопание» и восстановление считает шейдер по uniform'ам цикла
    this.vesU = { uTT: { value: 0 }, uTime: { value: 0 }, uK: { value: 1 }, uDock: { value: 0 }, uPop: { value: 0 }, uReform: { value: 0 }, uBumpV: { value: 0 }, uBface: { value: BFACE } };
    this.vesMat = orbMaterial({
      color: '#dfffd8', intensity: 1.0, fill: 0.2, rim: 1.3, core: 0.12, fade: this.fade, uniforms: this.vesU,
      vertexHead: 'attribute vec4 aV; attribute vec2 aV2; uniform float uTT, uTime, uK, uDock, uPop, uReform, uBumpV, uBface;',
      vertexBody: `
        vec3 P = vec3(aV.x + sin(uTime * 1.3 + aV2.x) * 0.03, aV.y + cos(uTime * 1.1 + aV2.x) * 0.03, aV.z);
        float sc = aV.w, lum = 0.8;
        if (aV2.y > 0.5) {
          if (uTT < 3.55) {
            P.x = aV.x + (uBface - 0.1 - aV.x) * uDock;
            sc = aV.w * (1.0 + 0.7 * uPop);
            lum = max(0.0, 0.85 + 0.7 * uBumpV - 0.85 * uPop) * (1.0 - uPop);
          } else {
            sc = aV.w * uReform;
            lum = 0.8 * uReform;
          }
        }
        s = vec3(sc);
        offset = P;
        tint = vec3(lum * uK);`,
    });
    this.ves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), this.vesMat, N);
    this.ves.frustumCulled = false;
    this.vdef = [];
    const active = [[-0.55, 0.32], [-0.18, -0.3], [0.2, 0.28], [0.55, -0.22], [0.88, 0.2], [0.02, 0.0]];
    for (let i = 0; i < N; i++) {
      let x, y, z;
      if (i < active.length) {
        x = BFACE - 0.3; y = B[1] + active[i][0]; z = active[i][1];
      } else {
        // случайно внутри эллипсоида, ближе к активной зоне
        for (let g = 0; g < 50; g++) {
          const [a, b, c] = r.inSphere(0.78);
          x = B[0] + a * BR[0]; y = B[1] + b * BR[1]; z = c * BR[2];
          if (x < BFACE - 0.25 && x > B[0] - 0.75) break;
        }
      }
      this.vdef.push({ x, y, z, s: r.range(0.12, 0.17), ph: r() * 6.28, active: i < active.length });
    }
    instAttr(this.ves, 'aV', 4, this.vdef.flatMap((v) => [v.x, v.y, v.z, v.s]));
    instAttr(this.ves, 'aV2', 2, this.vdef.flatMap((v) => [v.ph, v.active ? 1 : 0]));
    this.bio.add(this.ves);
  }

  buildMolecules() {
    // Молекулы нейромедиатора: немного и покрупнее — чтобы в зале было видно отдельные «капли», летящие через щель.
    // Полёт считает шейдер по времени цикла (uTT): у каждой молекулы — статичное «расписание» в атрибутах.
    const r = this.r;
    this.molPer = 22;
    const n = 6 * this.molPer;
    this.molU = { uTT: { value: 0 }, uFK: { value: 1 }, uPopA: { value: 0 }, uBface: { value: BFACE }, uHface: { value: HFACE } };
    this.mols = new GlowPoints(n + 6, {
      fade: this.fade, uniforms: this.molU,
      vertexHead: 'attribute vec4 aM1; attribute vec4 aM2; attribute vec4 aM3; uniform float uTT, uFK, uPopA, uBface, uHface;',
      vertexBody: `
        if (aM3.w > 0.5) {
          // вспышка «лопнувшего» пузырька
          pos = vec3(uBface - 0.06, aM1.x, aM1.y);
          size = 0.5;
          col = vec4(0.3, 1.5, 0.3, uPopA);
        } else {
          float u = (uTT - aM2.z) / aM2.w;
          if (u < 0.0 || uTT > 2.95) {
            col.a = 0.0;
          } else {
            float e = min(1.0, u);
            float ee = 1.0 - (1.0 - e) * (1.0 - e);
            float u3 = min(1.0, u * 3.0);
            float sx = uBface - 0.02, tx = uHface + 0.03;
            pos = vec3(sx + (tx - sx) * ee,
                       aM1.x + aM1.z * u3 + (aM2.x - aM1.z) * ee + sin(u * 9.0 + aM3.x) * 0.04 * (1.0 - e),
                       aM1.y + aM1.w * u3 + (aM2.y - aM1.w) * ee);
            float a = min(1.0, u * 5.0) * (1.0 - smoothstep(2.55, 2.95, uTT)) * uFK;
            if (aM3.z > 0.5) { size = aM3.y; col = vec4(0.22, 1.25, 0.22, a); }
            else { size = aM3.y * 0.9; col = vec4(0.75, 1.0, 0.75, a * 0.8); }
          }
        }`,
    });
    const M1 = new Float32Array((n + 6) * 4), M2 = new Float32Array((n + 6) * 4), M3 = new Float32Array((n + 6) * 4);
    let i = 0;
    for (let v = 0; v < 6; v++) {
      const vd = this.vdef[v];
      for (let j = 0; j < this.molPer; j++, i++) {
        const dy = r.gauss(0, 0.26), dz = r.gauss(0, 0.26);
        const ty = r.gauss(0, 0.4), tz = r.gauss(0, 0.3);
        const t0 = 1.47 + r() * 0.22, dur = r.range(0.55, 0.95);
        const wob = r() * 6.28, s = r.range(0.1, 0.16), g = r() < 0.72;
        M1.set([vd.y, vd.z, dy, dz], i * 4);
        M2.set([ty, tz, t0, dur], i * 4);
        M3.set([wob, s, g ? 1 : 0, 0], i * 4);
      }
    }
    for (let v = 0; v < 6; v++, i++) {
      M1.set([this.vdef[v].y, this.vdef[v].z, 0, 0], i * 4);
      M2.set([0, 0, 0, 1], i * 4);
      M3.set([0, 0.5, 0, 1], i * 4);
    }
    this.mols.attr('aM1', 4, M1);
    this.mols.attr('aM2', 4, M2);
    this.mols.attr('aM3', 4, M3);
    for (let k = 0; k < n + 6; k++) this.mols.set(k, BFACE, 0, 0, 0.12, 1, 1, 1, 1);
    this.mols.commit();
    this.bio.add(this.mols.points);
  }

  buildReceptors() {
    const r = this.r;
    const N = 11;
    const geo = new THREE.CapsuleGeometry(0.055, 0.16, 4, 8);
    geo.rotateZ(Math.PI / 2);
    // рецепторы «загораются», когда долетают молекулы: яркость — в шейдере по uniform uRec
    this.recU = { uRec: { value: 0 }, uK: { value: 1 } };
    this.recMat = glowInstancedMaterial({
      color: '#ffffff', fade: this.fade, uniforms: this.recU,
      vertexHead: 'attribute float aI; uniform float uRec, uK;',
      vertexBody: `
        float g = (0.15 + 1.25 * uRec * (0.6 + 0.4 * sin(aI * 1.7))) * uK;
        tint = vec3(g * 0.35, g, g * 0.3);`,
    });
    this.rec = new THREE.InstancedMesh(geo, this.recMat, N);
    this.rec.frustumCulled = false;
    for (let i = 0; i < N; i++) {
      const y = H[1] - 0.62 + (i / (N - 1)) * 1.3 + r.gauss(0, 0.03);
      const z = r.range(-0.42, 0.42);
      setInstance(this.rec, i, HFACE + 0.08, y, z, 1);
    }
    instAttr(this.rec, 'aI', 1, Array.from({ length: N }, (_, i) => i));
    this.bio.add(this.rec);
  }

  buildArcs() {
    // 1 — дендриты → входы; 2 — синапсы → веса; 3 — порог срабатывания → порог
    const P = PERC;
    const defs = [
      [[-2.75, -0.75, 0.3], [-1.0, -0.15, 0.4], [0.35, -0.05, 0.3]],
      [[GAP_X, 1.25, 0.4], [-2.0, 3.7, 0.5], [2.85, 1.55, 0.3]],
      [[-0.9, -2.5, 0.3], [2.6, -4.4, 0.4], [P.thr[0] - 0.1, -0.62, 0.3]],
    ];
    // где ставить подписи соответствий (параметр t на дуге и сдвиг)
    // (подпись «синапсы → веса» сдвинута вправо-вверх: не касается заголовка и подписи x₁)
    this.arcLabelAt = [[0.5, [-0.1, 1.05, 0]], [0.6, [0.7, 0.25, 0]], [0.45, [0, 0, 0]]];
    this.arcCurves = [];
    const SEG = 48;
    this.arcs = new FatLines(defs.length * SEG, {
      width: 3.4, color: '#9dff8f', intensity: 1.25, fade: this.fade, fragment: ARC_FRAG,
      uniforms: { uBuild: { value: 0 }, uLen: { value: new THREE.Vector3(1, 1, 1) } },
    });
    const lens = [];
    defs.forEach((d, k) => {
      const crv = new THREE.QuadraticBezierCurve3(V3(d[0]), V3(d[1]), V3(d[2]));
      this.arcCurves.push(crv);
      const pts = crv.getSpacedPoints(SEG);
      let s = 0;
      for (let i = 0; i < SEG; i++) {
        const a = pts[i], b = pts[i + 1];
        const l = a.distanceTo(b);
        this.arcs.setEdge(k * SEG + i, a.toArray(), b.toArray());
        this.arcs.setData(k * SEG + i, s, 1, l, k);
        s += l;
      }
      lens.push(s);
    });
    this.arcs.uniforms.uLen.value.set(...lens);
    this.arcs.commit();
    this.arcEnds = defs;
    this.root.add(this.arcs.mesh);
  }

  // ---------------------------------------------------------------------------
  // Формы облака частиц
  bioShape() {
    const n = this.ctx.particles.count;
    if (this.bioShapeCache && this.bioShapeCache.count === n) return this.bioShapeCache;
    const r = rng(431);
    // «светящихся» HDR-цветов (greenHi, bright) — не больше ~20% точек, иначе плотные мембраны выгорают
    const col = () => { const k = r(); return k < 0.15 ? S.PAL.greenHi : k < 0.47 ? S.PAL.mint : k < 0.52 ? S.PAL.bright : S.PAL.pale; };
    const tube = (curve, rad, alpha, taper = 0) => (m) => {
      const s = S.createShape(m);
      const v = new THREE.Vector3(), frames = curve.computeFrenetFrames(200, false);
      for (let i = 0; i < m; i++) {
        const t = r();
        const fi = Math.min(199, Math.floor(t * 200));
        curve.getPointAt(t, v);
        const a = r() * Math.PI * 2;
        const R = rad * (1 - taper * t) * (1 + r.gauss(0, 0.06));
        const N = frames.normals[fi], Bn = frames.binormals[fi];
        S.setPoint(s, i, v.x + (N.x * Math.cos(a) + Bn.x * Math.sin(a)) * R, v.y + (N.y * Math.cos(a) + Bn.y * Math.sin(a)) * R, v.z + (N.z * Math.cos(a) + Bn.z * Math.sin(a)) * R, r.range(0.45, 1.0), col(), alpha * r.range(0.5, 1));
      }
      return s;
    };
    const ell = (c, R, flat, alpha) => (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) {
        const [dx, dy, dz] = r.onSphere(1);
        let x = c[0] + dx * R[0] * (1 + r.gauss(0, 0.025));
        if (flat && flat.max != null && x > flat.max) x = flat.max + (x - flat.max) * 0.08;
        if (flat && flat.min != null && x < flat.min) x = flat.min + (x - flat.min) * 0.08;
        S.setPoint(s, i, x, c[1] + dy * R[1] * (1 + r.gauss(0, 0.025)), c[2] + dz * R[2] * (1 + r.gauss(0, 0.025)), r.range(0.45, 1.05), col(), alpha * r.range(0.5, 1));
      }
      return s;
    };
    const fill = (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) {
        const k = r();
        const [x, y, z] = r.inSphere(1);
        const c = k < 0.45 ? [B, BR, 0.85] : k < 0.75 ? [H, HR, 0.8] : [SOMA, [SOMA_R, SOMA_R, SOMA_R], 0.85];
        S.setPoint(s, i, c[0][0] + x * c[1][0] * c[2], c[0][1] + y * c[1][1] * c[2], c[0][2] + z * c[1][2] * c[2], r.range(0.4, 0.9), S.PAL.green, r.range(0.04, 0.12));
      }
      return s;
    };
    const space = (m) => {
      const s = S.createShape(m);
      for (let i = 0; i < m; i++) {
        const x = r.range(-30, 26), y = r.range(-15, 15), z = -r.range(3, 34);
        S.setPoint(s, i, x, y, z, r.range(0.4, 1.1), r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.22));
      }
      return s;
    };
    const parts = [
      { weight: 6500, shape: tube(AXON, 0.29, 0.42) },
      { weight: 9500, shape: ell(B, BR, { max: BFACE }, 0.36) },
      { weight: 5200, shape: ell(H, HR, { min: HFACE }, 0.36) },
      { weight: 2600, shape: tube(DEND, 0.2, 0.4) },
      { weight: 5200, shape: ell(SOMA, [SOMA_R, SOMA_R, SOMA_R], null, 0.4) },
      { weight: 1500, shape: tube(BRANCHES[0], 0.11, 0.4, 0.6) },
      { weight: 1100, shape: tube(BRANCHES[1], 0.11, 0.4, 0.6) },
      { weight: 900, shape: tube(BRANCHES[2], 0.11, 0.4, 0.6) },
      { weight: 900, shape: tube(SAXON, 0.13, 0.4, 0.4) },
      { weight: 2600, shape: fill },
      { weight: 29000, shape: space },
    ];
    const total = parts.reduce((a, p) => a + p.weight, 0);
    const s = S.combine(n, parts.map((p) => ({ weight: p.weight / total, shape: p.shape })));
    this.bioShapeCache = ready(s);
    return s;
  }

  // ---------------------------------------------------------------------------
  // Позы — для 16:9; под 4:3/16:10 их подгоняет ядро (director.fitPose).
  camera(state, step) {
    return step === 0
      ? { pos: [-4.15, 0.75, 10.0], target: [-4.15, 0.55, 0], fov: 45 }
      : step === 1
        ? { pos: [0, 0.4, 14], target: [0, 0.4, 0], fov: 45 }
        : { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 };
  }

  background(state, step) {
    if (step === 0) return { glows: [[-0.95, -0.62, 0.48, 0.55], [0.95, 0.55, 0.32, 0.3]], band: null };
    return step === 1 ? 'soft' : { glows: [[0.95, -0.4, 0.55, 0.72], [-0.95, 0.6, 0.3, 0.25]], band: null };
  }

  makeLabels() {
    this.removeLabels();
    const L = {};
    // анатомия (шаг 0)
    L.axon = this.label({ html: '<span class="b2b-chip">аксон</span>', position: [-9.7, 0.35, 0.2], anchor: 'top', visible: false });
    L.ves = this.label({ html: '<span class="b2b-chip">пузырьки нейромедиатора</span>', position: [-6.9, -1.35, 0.3], anchor: 'top', visible: false });
    L.syn = this.label({ html: '<span class="b2b-chip is-accent">синапс</span>', position: [GAP_X, 1.66, 0.3], anchor: 'bottom', visible: false });
    L.next = this.label({ html: '<span class="b2b-chip">следующий нейрон</span>', position: [SOMA[0] + SOMA_R + 0.3, SOMA[1] - 0.15, 0.3], anchor: 'left', visible: false });
    // соответствия (шаг 1) — подписи на дугах
    const texts = ['дендриты → входы', 'синапсы → веса', 'порог срабатывания → порог'];
    L.map = texts.map((txt, k) => {
      const [t, off] = this.arcLabelAt[k];
      const p = this.arcCurves[k].getPoint(t);
      return this.label({ html: `<span class="b2b-chip is-map">${txt.replace(' → ', ' <b class="b2b-arrow">→</b> ')}</span>`, position: [p.x + off[0], p.y + off[1], p.z + off[2]], visible: false });
    });
    this.L = L;
    this.view.makeLabels();
  }

  applyLabels(step) {
    const L = this.L;
    if (!L) return;
    const anat = step === 0, map = step === 1;
    [L.axon, L.ves, L.syn, L.next].forEach((l) => (anat ? l.show() : l.hide()));
    this._mapCall?.kill();
    if (map) {
      // подписи появляются вслед за «прорисовкой» дуг (отложенный вызов отменяется при смене шага/уходе)
      this._mapCall = this.delay(1.9, () => { if (this.step === 1 && this.active) L.map.forEach((l) => l.show()); });
    } else L.map.forEach((l) => l.hide());
    this.view.showLabels(step >= 1);
  }

  apply(step, o = {}) {
    const inst = !!o.instant;
    const d = inst ? 0 : 1;
    const tg = { bio: step <= 1 ? 1 : 0, perc: step >= 1 ? 1 : 0, map: step === 1 ? 1 : 0 };
    phase(this, this.ph, 'bio', tg.bio, { duration: d * (tg.bio ? 1.0 : 1.6) });
    phase(this, this.ph, 'perc', tg.perc, { duration: d * (tg.perc ? 2.4 : 1.0), ease: tg.perc ? 'power1.inOut' : 'power2.in', delay: tg.perc && !inst ? 0.35 : 0 });
    phase(this, this.ph, 'map', tg.map, { duration: d * (tg.map ? 1.6 : 0.6), delay: tg.map && !inst ? 1.6 : 0, ease: 'power1.inOut' });
    // частицы
    const p = this.particles;
    if (step === 2) {
      p.setParams({ noise: 0.18, swirl: 0, size: 0.06, twinkle: 0.3, spring: 15, damping: 5.5 }, d * 1.2);
      p.morph(perceptronShape(p.count), { duration: inst ? 0.01 : 2.6, stagger: 0.55, burst: 18 });
      if (!inst) this.ctx.engine.pulse({ aberration: 0.9 }, 1.4);
    } else {
      p.setParams({ noise: 0.16, swirl: 0, size: 0.058, twinkle: 0.3, spring: 15, damping: 5.5 }, d * 1.2);
      if (this._shapeStep !== 'bio') p.morph(this.bioShape(), { duration: inst ? 0.01 : 2.2, stagger: 0.5, burst: 10 });
    }
    this._shapeStep = step === 2 ? 'perc' : 'bio';
    this.applyLabels(step);
    // шаг 0: камера медленно «облетает» синапс — видно, что он объёмный.
    // «Водитель» камеры минует подгонку ядра, поэтому угол обзора под узкий экран считаем сами (fitFov).
    if (step === 0) {
      const base = this.camera(this.state, 0);
      const [tx, ty, tz] = base.target;
      const R = Math.hypot(base.pos[0] - tx, base.pos[2] - tz);
      const t0 = this.ctx.time;
      const pose = this._drivePose || (this._drivePose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 });
      pose.target.set(tx, ty, tz);
      this.drive((dt, t) => {
        const k = Math.min(1, (t - t0) / 3);
        const a = Math.sin((t - t0) * 0.32) * 0.2 * k;
        const b = Math.sin((t - t0) * 0.23 + 1.1) * 0.06 * k;
        pose.pos.set(tx + Math.sin(a) * R, base.pos[1] + Math.sin(b) * R * 0.5, tz + Math.cos(a) * R);
        pose.fov = fitFov(this.ctx, base.fov);
        return pose;
      }, 1.2);
    } else this.drive(null);
  }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const obj = this.particles.object;
    const d = o.instant ? 0 : 1.6;
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut' });
    updateShared(this.ctx);
    this.resizeLines();
    this.makeLabels();
    // при входе сразу с шага 1–2 — без «перестройки» схемы
    this.ph.bio = this.step <= 1 ? 1 : 0;
    this.ph.perc = this.step >= 1 ? (o.instant || o.dir < 0 ? 1 : 0) : 0;
    this.ph.map = 0;
    this._shapeStep = null;
    this.t0 = this.ctx.time;
    this.apply(this.step, o);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  exit(o = {}) {
    this.drive(null);
    this._mapCall?.kill();
    if (this.L) [this.L.axon, this.L.ves, this.L.syn, this.L.next, ...this.L.map].forEach((l) => l.hide());
    this.view.showLabels(false);
    return super.exit(o);
  }

  /** Толщина экранных линий — от высоты экрана. */
  resizeLines() {
    this.arcs.resize(this.ctx);
    this.view.edges.resize(this.ctx);
    this.view.gauge.resize(this.ctx);
  }

  // Камеру после смены размера окна переустанавливает режиссёр (director.refit).
  resize() {
    updateShared(this.ctx);
    this.resizeLines();
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    this.fade.value = this.opacity;
    const tt = (t - this.t0) % CYCLE;
    const bio = this.ph.bio;
    this.bio.visible = bio > 0.003;
    if (this.bio.visible) this.updateBio(tt, bio);
    this.view.set(this.ph.perc, 1);
    this.view.update(tt, true);
    const au = this.arcs.uniforms;
    au.uBuild.value = this.ph.map;
    au.uOpacity.value = Math.min(1, this.ph.map * 1.5);
    au.uTime.value = t;
    this.arcs.mesh.visible = this.ph.map > 0.003;
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = Math.sin(t * 0.13) * 0.02;
    }
  }

  setHead(i, curve, u, a) {
    const h = this.heads[i];
    const on = u >= 0 && u <= 1;
    if (on) curve.getPointAt(u, h.position);
    h.material.opacity = on ? a * Math.min(1, (1 - u) * 6, u * 10 + 0.3) : 0;
  }

  updateBio(tt, k) {
    const fk = k * this.fade.value;
    // импульс по аксону
    const ax = tt < 1.15 ? tt / 1.1 : -1;
    this.axon.material.uniforms.uPulse.value = ax;
    this.axon.material.uniforms.uOpacity.value = k;
    // вспышки — зелёные и умеренные (без выгорания в белое)
    const bFlash = bump(tt, 1.15, 0.2);
    // плоская «активная зона» видна под скользящим углом (rim≈1) — сильная вспышка мембраны выгорает
    this.bouton.material.uniforms.uFlash.value = bFlash * 0.22;
    this.bouton.material.uniforms.uOpacity.value = k;
    this.boutonGlow.material.opacity = (0.08 + 0.34 * bFlash) * fk;
    // молекулы долетают → рецепторы → дендрит → тело
    const rec = bump(tt, 2.3, 0.28);
    this.spine.material.uniforms.uFlash.value = rec * 0.24;
    this.spine.material.uniforms.uOpacity.value = k;
    const dp = tt > 2.2 && tt < 3.1 ? (tt - 2.25) / 0.8 : -1;
    this.dend.material.uniforms.uPulse.value = dp;
    this.dend.material.uniforms.uOpacity.value = k;
    const sf = Math.min(1, 0.8 * bump(tt, 3.05, 0.14) + 0.35 * bump(tt, 3.25, 0.35));
    this.soma.material.uniforms.uFlash.value = 0.6 * sf;
    this.soma.material.uniforms.uOpacity.value = k;
    this.somaGlow.material.opacity = (0.06 + 0.5 * sf) * fk;
    this.somaGlow.scale.setScalar(3.0 + 1.2 * sf);
    const sp = tt > 3.0 && tt < 4.0 ? (tt - 3.05) / 0.85 : -1;
    this.saxon.material.uniforms.uPulse.value = sp;
    this.saxon.material.uniforms.uOpacity.value = k;
    this.branches.forEach((b, i) => {
      b.material.uniforms.uFlash.value = 0.7 * bump(tt, 3.12 + i * 0.05, 0.2);
      b.material.uniforms.uOpacity.value = k;
    });
    // головы импульсов
    this.setHead(0, AXON, ax, fk);
    this.setHead(1, DEND, dp, fk * 0.85);
    this.setHead(2, SAXON, sp, fk * 0.85);

    // пузырьки (причаливают, лопаются, появляются вновь), молекулы и рецепторы анимирует шейдер —
    // здесь только фазы цикла в uniform'ах
    const vu = this.vesU;
    vu.uTT.value = tt;
    vu.uTime.value = this.ctx.time;
    vu.uK.value = k;
    vu.uDock.value = sstep(1.0, 1.42, tt);
    vu.uPop.value = sstep(1.42, 1.62, tt);
    vu.uReform.value = sstep(3.55, 4.3, tt);
    vu.uBumpV.value = bump(tt, 1.48, 0.07);
    const mu = this.molU;
    mu.uTT.value = tt;
    mu.uFK.value = fk;
    mu.uPopA.value = bump(tt, 1.52, 0.08) * fk;
    this.mols.update(this.ctx);
    this.recU.uRec.value = rec;
    this.recU.uK.value = k;
    this.recMat.uniforms.uOpacity.value = k;
  }
}
