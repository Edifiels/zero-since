// «Вечный страх»: бюст Сократа и свиток → книга → калькулятор → навигатор → смартфон → окно чат-бота,
// вокруг — «колесо времени» с бусинами эпох; на последнем шаге все эпохи выстраиваются в ряд,
// и по ним прокатывается одна и та же волна тревоги.
import * as THREE from 'three';
import { B7Visual, S, glowMat, glowSprite, pulseLines, combineAsync, equalizeAsync, tick, TAU } from './common.js';
import * as I from './icons.js';

const ERA = ['Письменность', 'Книги', 'Калькуляторы', 'Навигаторы', 'Смартфоны', 'Чат-боты'];
const LAST = 6;
const ROW_X = [-8.1, -4.86, -1.62, 1.62, 4.86, 8.1];
const ROW_Y = -1.05;          // ряд эпох чуть ниже центра — под двухстрочным заголовком, без пустого низа
const ROW_SCALE = 0.54;
const RING_R = 4.1;

const COL_CUR = new THREE.Color('#ffffff').multiplyScalar(1.7);
const COL_PAST = new THREE.Color('#00ff00').multiplyScalar(1.35);
const COL_NEXT = new THREE.Color('#ffffff').multiplyScalar(0.32);

export default class Fear extends B7Visual {
  static transition = 'morph';

  async init() {
    const n = this.ctx.particles.count;
    this.shapes = [];
    await tick();
    this.shapes[0] = await equalizeAsync(combineAsync(n, [
      { weight: 0.55, shape: (m) => I.bust(m), position: [-2.95, -0.2, -0.5] },
      { weight: 0.45, shape: (m) => I.scroll(m), position: [2.25, 0.95, 0.25], rotation: [0.08, -0.42, 0.04], scale: 0.84 },
    ]));
    const single = [I.book, I.calculator, I.navigator, I.phone, I.chat];
    for (let k = 0; k < single.length; k++) {
      this.shapes[k + 1] = await equalizeAsync(single[k](n));
    }
    // ряд из шести уменьшенных значков плотнее одиночных форм — порог яркости ниже, без белых «горячих» пятен
    this.shapes[LAST] = await equalizeAsync(combineAsync(n, I.ERA_ICONS.map((f, k) => ({
      weight: 1,
      shape: (m) => f(m, 100 + k * 7),
      position: [ROW_X[k], ROW_Y, 0],
      scale: ROW_SCALE,
    }))), { target: 7.5 });

    // ---- «Колесо времени» вокруг предмета
    this.anchor = new THREE.Group();
    this.root.add(this.anchor);
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = -1.28;
    this.anchor.add(this.tilt);
    this.spin = new THREE.Group();
    this.tilt.add(this.spin);
    this.ringMats = [glowMat('#ffffff', 0.9, 0.3), glowMat('#00ff00', 1.3, 0.32)];
    this.spin.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.02, 6, 240), this.ringMats[0]));
    this.spin.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R * 1.07, 0.012, 4, 240), this.ringMats[1]));
    // засечки-«деления» колеса
    const tickGeo = new THREE.BoxGeometry(0.05, 0.26, 0.02);
    const tickMat = glowMat('#ffffff', 0.8, 0.45);
    this.ringMats.push(tickMat);
    const ticks = new THREE.InstancedMesh(tickGeo, tickMat, 36);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU;
      e.set(0, 0, a - Math.PI / 2);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(Math.cos(a) * RING_R * 1.035, Math.sin(a) * RING_R * 1.035, 0), q, one);
      ticks.setMatrixAt(k, m4);
    }
    this.spin.add(ticks);
    this.beads = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const mat = glowMat('#ffffff', 1, 1);
      this.ringMats.push(mat);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), mat);
      bead.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0);
      const halo = glowSprite('#00ff00', 1.2, 1.05);
      halo.material.userData.noFade = true;
      bead.add(halo);
      this.spin.add(bead);
      this.beads.push({ mesh: bead, mat, halo, col: new THREE.Color(), sc: 1, h: 0 });
    }

    // ---- Ряд эпох (последний шаг): линия времени, бусины, волны «тревоги»
    this.row = new THREE.Group();
    this.root.add(this.row);
    this.rowMats = [];
    const lineY = ROW_Y - 1.5;
    const line = pulseLines([
      { a: [-9.8, lineY, 0], b: [9.8, lineY, 0], phase: 0.0, speed: 0.16, bright: 0.85, pulse: 1 },
      { a: [-9.8, lineY, 0], b: [9.8, lineY, 0], phase: 0.5, speed: 0.16, bright: 0.0, pulse: 0.8 },
    ], { width: 3.2, color: '#ffffff', colorK: 0.42, pulseColor: '#00ff00', pulseK: 2.6, pulseLen: 0.05 });
    this.row.add(line);
    this.rowMats.push(line.material);
    const rbMat = glowMat('#00ff00', 1.4, 1);
    this.rowMats.push(rbMat);
    const rbeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 20, 14), rbMat, 6);
    ROW_X.forEach((x, k) => { m4.makeTranslation(x, lineY, 0); rbeads.setMatrixAt(k, m4); });
    this.row.add(rbeads);
    this.sonar = [];
    const sonarGeo = new THREE.RingGeometry(0.97, 1.0, 128);
    for (let k = 0; k < 6; k++) {
      const mat = glowMat('#ffffff', 1.1, 0);
      mat.userData.noFade = true;
      const ring = new THREE.Mesh(sonarGeo, mat);
      ring.position.set(ROW_X[k], ROW_Y, -0.2);
      this.row.add(ring);
      this.rowMats.push(mat);
      this.sonar.push(ring);
    }

    this.ringFade = { v: 1 };
    this.rowFade = { v: 0 };
    this.spinTarget = -Math.PI / 2;
    this.rowLabels = [];
    this._pending = [];
  }

  cx() { return this.stageRect().w * 0.235; }

  basePose(state, step) {
    if (step >= LAST) return { pos: [0, 0.1, 14.9], target: [0, -0.45, 0], fov: 45 };
    const sway = [0, 0.75, -0.65, 0.6, -0.55, 0.5][step] || 0;
    return { pos: [sway, 0.35, 14.2], target: [sway * 0.35, 0, 0], fov: 45 };
  }

  background(state, step) { return step >= LAST ? 'soft' : 'right'; }

  enter(o = {}) {
    this.dropLabels(false);
    this.state = o.state ?? null;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    this.particleParams({ noise: 0.2, size: 0.058, twinkle: 0.3, spring: 18, damping: 6 }, o.instant ? 0 : 1);
    this.rowLabels = ERA.map((t, k) => this.lab({
      html: `<span class="b7-era-lab${k === 5 ? ' is-now' : ''}">${t}</span>`,
      position: [ROW_X[k], ROW_Y - 2.1, 0],
      visible: false,
    }));
    // колесо и ряд — сразу в нужном виде
    this.spinTarget = this.spinFor(this.step);
    this.spin.rotation.z = this.spinTarget;
    this.ringFade.v = this.step >= LAST ? 0 : 1;
    this.rowFade.v = this.step >= LAST ? 1 : 0;
    if (o.instant) p.object.position.set(this.step >= LAST ? 0 : this.cx(), 0, 0);
    this.anchor.position.set(this.cx(), 0, 0);
    this.applyStep(this.step, { ...o, enter: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyStep(step, o);
  }

  spinFor(step) { return -Math.PI / 2 - Math.min(step, 5) * (TAU / 6); }

  applyStep(step, o = {}) {
    const instant = !!o.instant;
    const p = this.particles;
    this._pending.forEach((d) => d.kill());
    this._pending = [];
    if (this.ownsParticles()) {
      p.morph(this.shapes[Math.min(step, LAST)], {
        duration: instant ? 0.01 : o.enter ? 2.3 : 1.75,
        stagger: o.enter ? 0.55 : 0.5,
        burst: o.enter ? 14 : 10,
      });
      this.twk('pPos', p.object.position, { x: step >= LAST ? 0 : this.cx(), y: 0, z: 0, duration: instant ? 0 : 1.7, ease: 'power2.inOut', overwrite: 'auto' });
      this.twk('pScale', p.object.scale, { x: 1, y: 1, z: 1, duration: instant ? 0 : 1.2, overwrite: 'auto' });
    }
    this.spinTarget = this.spinFor(step);
    const showRow = step >= LAST;
    // именованные анимации: отложенный показ ряда не «воскреснет» при быстром «назад»
    this.twk('ringFade', this.ringFade, { v: showRow ? 0 : 1, duration: instant ? 0 : 0.9 });
    this.twk('rowFade', this.rowFade, { v: showRow ? 1 : 0, duration: instant ? 0 : 1.3, delay: showRow && !instant ? 0.7 : 0 });
    this.rowLabels.forEach((l, k) => {
      if (!showRow) { l.hide(); return; }
      if (instant) { l.show(); return; }
      this._pending.push(this.delay(1.0 + k * 0.14, () => l.show()));
    });
    if (!instant && !o.enter) {
      this.ctx.engine.pulse({ aberration: 0.6 }, 0.9);
      this.ctx.background.surge(0.32, 1.4);
    }
  }

  onResize() {
    if (!this.active || this.step >= LAST || !this.ownsParticles()) return;
    this.particles.object.position.x = this.cx();
  }

  update(dt, t) {
    const p = this.particles;
    if (this.ownsParticles()) {
      const o = p.object;
      const amp = this.step >= LAST ? 0.05 : this.step === 0 ? 0.13 : 0.3;
      o.rotation.y = Math.sin(t * 0.42) * amp;
      o.rotation.x = Math.sin(t * 0.31) * 0.05;
      this.anchor.position.copy(o.position);
    }
    // колесо времени
    const k = Math.min(1, dt * 3.2);
    this.spin.rotation.z += (this.spinTarget + Math.sin(t * 0.5) * 0.05 - this.spin.rotation.z) * k;
    const rf = this.ringFade.v;
    for (const m of this.ringMats) m.uniforms.uFade.value = rf;
    this.anchor.visible = rf > 0.003;
    const step = this.step;
    const kb = Math.min(1, dt * 5);
    for (let i = 0; i < this.beads.length; i++) {
      const b = this.beads[i];
      const cur = i === step, past = i < step;
      const tc = cur ? COL_CUR : past ? COL_PAST : COL_NEXT;
      b.col.lerp(tc, kb);
      b.mat.uniforms.uColor.value.copy(b.col);
      b.sc += ((cur ? 1.4 : past ? 1.0 : 0.8) - b.sc) * kb;
      const pulse = cur ? 1 + Math.sin(t * 4) * 0.08 : 1;
      b.mesh.scale.setScalar(b.sc * pulse);
      b.h += ((cur ? 0.75 : past ? 0.22 : 0) - b.h) * kb;
      b.halo.material.opacity = b.h * rf * this.opacity;
    }
    // ряд эпох
    const wf = this.rowFade.v;
    this.row.visible = wf > 0.003;
    if (this.row.visible) {
      for (const m of this.rowMats) m.uniforms.uFade.value = wf;
      for (let i = 0; i < this.sonar.length; i++) {
        const ring = this.sonar[i];
        const ph = (((t * 0.32 - i * 0.075) % 1) + 1) % 1;
        ring.scale.setScalar((0.9 + ph * 1.05) * ROW_SCALE / 0.5);
        ring.material.uniforms.uOpacity.value = (1 - ph) * (1 - ph) * 0.6 * this.opacity;
      }
    }
    this.tickMaterials(t, this.rowMats);
  }
}
