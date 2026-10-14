// Титул блока: номер блока собирается из частиц, вокруг — орбиты и «лучи» логотипа.
// Состояние = номер блока ('1'…'8'). HTML-заголовок располагается справа (см. parts/common.js → chapterSlide).
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import { fromText, PAL } from '../../core/shapes.js';

const BG = ['corner', 'left', 'soft', 'corners', 'right', 'corner', 'soft', 'banner'];

export default class Chapter extends Visual {
  static transition = 'warp';

  async init() {
    this.cache = new Map();
    // Орбиты вокруг номера
    this.orbits = new THREE.Group();
    this.root.add(this.orbits);
    const mkRing = (r, color, opacity, dots) => {
      const g = new THREE.Group();
      const pts = [];
      for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(line);
      for (let i = 0; i < dots; i++) {
        const a = (i / dots) * Math.PI * 2 + Math.random();
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 16, 12), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0x00ff00, transparent: true }));
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        g.add(m);
      }
      return g;
    };
    this.ringA = mkRing(4.6, 0x00e000, 0.55, 3);
    this.ringB = mkRing(5.4, 0xffffff, 0.22, 2);
    this.ringA.rotation.set(1.15, 0.2, 0.35);
    this.ringB.rotation.set(1.35, -0.4, -0.5);
    this.orbits.add(this.ringA, this.ringB);
  }

  shapeFor(n) {
    const key = String(n);
    if (!this.cache.has(key)) {
      const s = fromText(this.ctx.particles.count, key.padStart(2, '0'), {
        font: '800 420px Unbounded',
        width: 7.4,
        depth: 1.1,
        size: 1,
        alpha: 0.42,
        colorFn: (x, y, r) => { const k = r(); return k < 0.08 ? PAL.greenHi : k < 0.13 ? PAL.bright : PAL.white; },
      });
      this.cache.set(key, s);
    }
    return this.cache.get(key);
  }

  layoutX() {
    // номер — по центру левой половины «сцены 16:9»
    return -this.stageRect().w * 0.25;
  }

  camera() { return { pos: [0, 0.2, 15], target: [0, 0, 0], fov: 42 }; }
  background(state) { return BG[((parseInt(state, 10) || 1) - 1) % BG.length]; }

  enter(o = {}) {
    this.state = o.state;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.3, swirl: 0, size: 0.072, twinkle: 0.3, spring: 18, damping: 6 }, o.instant ? 0 : 0.8);
    p.morph(this.shapeFor(o.state || '1'), { duration: o.instant ? 0.01 : 2.2, stagger: 0.5, burst: 16 });
    const x = this.layoutX();
    this.orbits.position.set(x, 0, 0);
    this.tw(p.object.position, { x, y: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power3.out' });
    this.tw(p.object.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.6 });
    this.fromTo(this.orbits.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 2, ease: 'expo.out' });
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.particles.morph(this.shapeFor(state), { duration: 1.8, stagger: 0.5, burst: 16 });
  }

  resize() {
    if (!this.active) return;
    const x = this.layoutX();
    this.orbits.position.x = x;
    if (this.ownsParticles()) this.particles.object.position.x = x;
  }

  update(dt, t) {
    this.ringA.rotation.y += dt * 0.25;
    this.ringB.rotation.y -= dt * 0.16;
    if (this.ownsParticles()) {
      const o = this.particles.object;
      o.rotation.y = Math.sin(t * 0.3) * 0.22;
      o.rotation.x = Math.sin(t * 0.21) * 0.06;
    }
  }
}
