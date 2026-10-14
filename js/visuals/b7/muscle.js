// «Мышца мышления»: голографическая рука качает гантель, бицепс — мозг из частиц.
// Шаг 0 «Решаешь сам» — повторы, мозг-бицепс растёт и пульсирует.
// Шаг 1 «Списываешь» — рука опускается, гантель выпадает, мозг сдувается и тускнеет.
// Шаг 2 «Хорошая новость» — снова повторы, мозг больше и зеленее, рядом шар «ИИ как критик».
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { B7Visual, S, C, Pts, holoMaterial, glowSprite, makeOrb, pulseLines, clone, tint, noStem, lerp, brainAsync, tick } from './common.js';

const L1 = 4.8;      // плечо (от плечевого сустава до локтя)
const L2 = 3.5;      // предплечье
const TH = { curl: -0.55, ext: 0.7, hang: 2.15 };
const BRAIN_SCALE = 1.22;
const ARM_SCALE = 1.18;

function limbGeometry(L, prof, seg = 48, radial = 40) {
  const rAt = (t) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [t0, r0] = prof[i], [t1, r1] = prof[i + 1];
      if (t <= t1) { const u = (t - t0) / (t1 - t0); const s = u * u * (3 - 2 * u); return r0 + (r1 - r0) * s; }
    }
    return prof[prof.length - 1][1];
  };
  const pts = [];
  const r0 = rAt(0), r1 = rAt(1);
  for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + (k / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-3, Math.cos(a) * r0), Math.sin(a) * r0 * 0.8)); }
  for (let i = 1; i < seg; i++) { const t = i / seg; pts.push(new THREE.Vector2(rAt(t), t * L)); }
  for (let k = 0; k <= 8; k++) { const a = (k / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-3, Math.cos(a) * r1), L + Math.sin(a) * r1 * 0.8)); }
  return new THREE.LatheGeometry(pts, radial);
}

export default class Muscle extends B7Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    this.armMat = holoMaterial({ color: '#c9ffc4', rim: '#00ff00', rimK: 1.25, fill: 0.2, scan: 0.4 });
    this.bellMat = holoMaterial({ color: '#dfe9df', rim: '#c8f5c0', rimK: 0.62, fill: 0.14, scan: 0.15 });
    this.mats = [this.armMat, this.bellMat];

    // Иерархия: armRoot (плечевой сустав) → shoulder (наклон плеча) → elbow (сгиб) → кулак, гантель
    this.armRoot = new THREE.Group();
    this.root.add(this.armRoot);
    this.shoulder = new THREE.Group();
    this.armRoot.add(this.shoulder);
    const upper = new THREE.Mesh(limbGeometry(L1, [[0, 1.0], [0.16, 0.86], [0.5, 0.68], [0.82, 0.58], [1, 0.54]]), this.armMat);
    upper.rotation.z = Math.PI / 2;
    this.shoulder.add(upper);
    this.elbow = new THREE.Group();
    this.elbow.position.set(-L1, 0, 0);
    this.shoulder.add(this.elbow);
    const fore = new THREE.Mesh(limbGeometry(L2, [[0, 0.56], [0.22, 0.63], [0.55, 0.5], [1, 0.36]]), this.armMat);
    this.elbow.add(fore);
    // кулак
    const fist = new THREE.Group();
    fist.position.set(0, L2 + 0.45, 0);
    this.elbow.add(fist);
    fist.add(new THREE.Mesh(new RoundedBoxGeometry(0.98, 1.05, 0.9, 4, 0.3), this.armMat));
    const fingerGeo = new THREE.CapsuleGeometry(0.15, 0.56, 6, 14);
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(fingerGeo, this.armMat);
      f.rotation.x = Math.PI / 2;
      f.position.set(0.47, -0.36 + k * 0.245, 0);
      fist.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 6, 14), this.armMat);
    thumb.position.set(0.18, 0.28, 0.44);
    thumb.rotation.z = 1.15;
    fist.add(thumb);
    // гантель
    this.bell = new THREE.Group();
    this.bell.rotation.y = 0.8;
    fist.add(this.bell);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.1, 14), this.bellMat);
    bar.rotation.x = Math.PI / 2;
    this.bell.add(bar);
    const disc = new THREE.CylinderGeometry(0.64, 0.64, 0.24, 48);
    const disc2 = new THREE.CylinderGeometry(0.47, 0.47, 0.2, 40);
    [-1, 1].forEach((sd) => {
      const d1 = new THREE.Mesh(disc, this.bellMat); d1.rotation.x = Math.PI / 2; d1.position.z = sd * 1.0; this.bell.add(d1);
      const d2 = new THREE.Mesh(disc2, this.bellMat); d2.rotation.x = Math.PI / 2; d2.position.z = sd * 1.28; this.bell.add(d2);
    });

    // Якорь мозга-бицепса и свечение «накачки»
    this.brainAnchor = new THREE.Object3D();
    this.brainAnchor.position.set(-L1 * 0.6, 0.72, 0.05);
    this.brainAnchor.rotation.set(0, Math.PI / 2, 0);
    this.shoulder.add(this.brainAnchor);
    this.pumpGlow = glowSprite('#00ff00', 1.0, 4.2);
    this.pumpGlow.material.userData.noFade = true;
    this.root.add(this.pumpGlow);

    // «ИИ как критик» (шаг 2): шар и луч обратной связи к мозгу
    this.orb = makeOrb({ radius: 0.42 });
    this.root.add(this.orb.group);
    this.critic = { v: 0 };
    this.feedback = pulseLines([
      { a: [0, 0, 0], b: [1, 0, 0], phase: 0, speed: 0.9, bright: 0.35, pulse: 1 },
      { a: [0, 0, 0], b: [1, 0, 0], phase: 0.5, speed: 0.9, bright: 0, pulse: 1 },
    ], { width: 3, color: '#ffffff', colorK: 0.6, pulseColor: '#9dff8f', pulseK: 2.2, pulseLen: 0.1 });
    this.root.add(this.feedback);
    this.mats.push(this.feedback.material, ...this.orb.mats);

    // Формы частиц: мозг + «аура» вокруг (те же точки, разные цвета на шагах)
    const b = new Pts(n, 17);
    await tick();
    const brain = noStem(await brainAsync(Math.round(n * 0.72), { scale: BRAIN_SCALE, seed: 5 }), BRAIN_SCALE);
    let bi = 0;
    b.add(0.72, () => { const j = (bi++ % brain.count) * 4; const P = brain.positions, Q = brain.colors; return [P[j], P[j + 1], P[j + 2], P[j + 3], [Q[j], Q[j + 1], Q[j + 2]], Q[j + 3]]; });
    b.add(0.28, (r) => { const [x, y, z] = r.onSphere(r.range(1.25, 2.3)); return [x * 0.9, y * 0.75, z * 1.1, r.range(0.4, 0.8), C.mint, r.range(0.04, 0.14)]; });
    const base = S.equalize(b.done());
    await tick();
    this.shapeGood = base;
    this.shapeWeak = tint(clone(base), (c, a) => { const l = (c[0] + c[1] + c[2]) / 3; return [l * 0.42, l * 0.45, l * 0.42, a * 0.55]; });
    this.shapeStrong = tint(clone(base), (c, a) => { const l = Math.min(1.6, (c[0] + c[1] + c[2]) / 3); return [l * 0.55, Math.min(2.2, l * 1.25 + 0.12), l * 0.5, Math.min(1, a * 1.1)]; });

    this.relax = { v: 0 };
    this.drop = { v: 0 };
    this.pumpBase = 1;
    this.repT = 0;
    this.curl = 0;
    this._lastPeak = 0;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  shoulderX() { return this.stageRect().w * 0.5; }

  basePose(state, step) {
    if (step === 1) return { pos: [0.7, 0.35, 14.2], target: [1.25, -0.45, 0], fov: 45 };
    if (step >= 2) return { pos: [0.5, -0.7, 14.6], target: [1.2, 0.35, 0], fov: 45 };
    return { pos: [0.6, 0.45, 14.6], target: [1.1, 0.1, 0], fov: 45 };
  }

  background(state, step) { return step === 1 ? 'none' : step >= 2 ? 'right' : 'corner'; }

  layout() {
    const sx = this.shoulderX();
    this.armRoot.position.set(sx, -2.05, -0.6);
    this.armRoot.rotation.set(0, 0.22, 0);
    this.armRoot.scale.setScalar(ARM_SCALE);
    this.armMat.uniforms.uClipX.value.set(sx - 1.9, sx + 0.2);
  }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.layout();
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.2, size: 0.056, twinkle: 0.35, spring: 20, damping: 6.5 }, o.instant ? 0 : 1);
    this.relax.v = this.step === 1 ? 1 : 0;
    this.drop.v = this.step === 1 ? 1 : 0;
    this.critic.v = this.step >= 2 ? 1 : 0;
    this.pumpBase = this.step === 1 ? 0.62 : this.step >= 2 ? 1.22 : 1;
    this.orbLab = this.lab({ html: '<span class="b7-ai">ИИ</span>', object: this.orb.group, visible: false });
    this.criticLab = this.lab({ html: '<span class="b7-tag">ИИ как критик</span>', object: this.orb.group, offset: [0, 0.95, 0], visible: false });
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  applyStep(step, o = {}) {
    const D = (v) => (o.instant ? 0 : v);
    const p = this.particles;
    if (this.ownsParticles()) {
      const shape = step === 1 ? this.shapeWeak : step >= 2 ? this.shapeStrong : this.shapeGood;
      p.morph(shape, { duration: D(o.enter ? 2.2 : 1.3), stagger: o.enter ? 0.5 : 0.35, burst: o.enter ? 12 : step === 1 ? 3 : 7 });
      p.setParams({ flow: step === 1 ? [0, -0.9, 0] : [0, 0, 0], noise: step === 1 ? 0.12 : 0.2 }, D(1.2));
    }
    // именованные анимации: отложенные «выпала гантель» / «появился критик» не «воскреснут» при быстром «назад»
    this.twk('relax', this.relax, { v: step === 1 ? 1 : 0, duration: D(step === 1 ? 1.6 : 1.2), ease: 'power2.inOut' });
    this.twk('drop', this.drop, { v: step === 1 ? 1 : 0, duration: D(step === 1 ? 0.9 : 0.8), delay: D(step === 1 ? 0.35 : 0), ease: step === 1 ? 'power2.in' : 'power2.out' });
    this.twk('critic', this.critic, { v: step >= 2 ? 1 : 0, duration: D(1.2), delay: D(step >= 2 && !o.enter ? 0.9 : 0) });
    this._labT?.kill();
    this._labT = null;
    if (step >= 2) {
      const show = () => { if (this.step >= 2) { this.orbLab.show(); this.criticLab.show(); } };
      if (o.instant) show();
      else this._labT = this.delay(1.6, show);
    } else { this.orbLab.hide(); this.criticLab.hide(); }
    if (!o.instant && !o.enter) {
      this.ctx.engine.pulse({ aberration: step === 1 ? 0.4 : 0.7 }, 0.9);
      if (step >= 2) this.ctx.background.surge(0.5, 1.4);
    }
  }

  onResize() { if (this.active) this.layout(); }

  update(dt, t) {
    const step = this.step;
    const relax = this.relax.v;
    // повторы: на шаге 2 бодрее
    const rate = step >= 2 ? 1 / 1.65 : 1 / 2.1;
    this.repT += dt * rate * (1 - relax);
    const curl = 0.5 - 0.5 * Math.cos(this.repT * Math.PI * 2);
    this.curl = curl;
    const thRep = lerp(TH.ext, TH.curl, curl);
    this.elbow.rotation.z = lerp(thRep, TH.hang, relax);
    this.shoulder.rotation.z = lerp(-0.06 - 0.06 * curl, 0.24, relax);
    // гантель выпадает
    const dr = this.drop.v;
    this.bell.position.set(0, -dr * dr * 2.2, dr * 0.6);
    this.bell.rotation.x = dr * 0.9;
    this.bellMat.uniforms.uFade.value = 1 - dr;
    this.armMat.uniforms.uFade.value = 1 - relax * 0.42;
    this.armMat.uniforms.uRimK.value = 1.25 - relax * 0.45 + (step >= 2 ? 0.25 : 0);
    // мозг-бицепс
    const targetBase = step === 1 ? 0.6 : step >= 2 ? 1.32 : 1;
    this.pumpBase += (targetBase - this.pumpBase) * Math.min(1, dt * 2.2);
    const pump = this.pumpBase * (1 + 0.15 * curl * (1 - relax));
    this.shoulder.updateWorldMatrix(true, true);
    this.brainAnchor.getWorldPosition(this._v1);
    this.brainAnchor.getWorldQuaternion(this._q);
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.position.copy(this._v1);
      o.quaternion.copy(this._q);
      o.scale.setScalar(pump * ARM_SCALE);
      // всплеск на пике повтора (шаг 2)
      if (step >= 2 && curl > 0.97 && t - this._lastPeak > 0.8) { this._lastPeak = t; this.particles.explode(1.4); }
    }
    this.pumpGlow.position.copy(this._v1);
    this.pumpGlow.scale.setScalar(3.6 * pump * ARM_SCALE);
    const glowK = step === 1 ? 0.08 : step >= 2 ? 0.34 : 0.28;
    this.pumpGlow.material.opacity = (0.4 + 0.6 * curl) * glowK * this.opacity * (1 - relax * 0.8);
    // ИИ-критик
    const cv = this.critic.v;
    this._v2.copy(this._v1).add(this._tmpOff || (this._tmpOff = new THREE.Vector3(1.25, 2.55, 0.9)));
    this.orb.group.position.copy(this._v2);
    this.orb.group.position.y += Math.sin(t * 1.4) * 0.12;
    this.orb.group.scale.setScalar(Math.max(0.001, cv));
    this.orb.fade = cv;
    this.orb.update(t, this.cellPx(), this.opacity);
    // луч «критика»: единичный отрезок вдоль X, растянутый и повёрнутый от шара к мозгу (без перезаливки буферов)
    const fb = this.feedback;
    fb.position.copy(this.orb.group.position);
    fb.position.y -= 0.35;
    this._v2.set(this._v1.x + 0.2, this._v1.y + 0.8 * pump * ARM_SCALE, this._v1.z).sub(fb.position);
    const len = Math.max(1e-3, this._v2.length());
    fb.quaternion.setFromUnitVectors(this._xAxis || (this._xAxis = new THREE.Vector3(1, 0, 0)), this._v2.multiplyScalar(1 / len));
    fb.scale.set(len, 1, 1);
    this.feedback.material.uniforms.uFade.value = cv * (0.35 + 0.65 * curl);
    this.feedback.visible = cv > 0.01;
    this.tickMaterials(t, this.mats);
  }
}
