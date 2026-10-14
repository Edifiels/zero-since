// Пример визуализации: меши со светом, частицы из геометрии, HTML-подписи у 3D-точек, текст на текстуре, облёт камеры.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { textMesh } from '../../core/text.js';

export default class Demo extends Visual {
  static transition = 'zoom';

  async init() {
    // «Твёрдый» объект со светом и окружением
    this.knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.6, 0.42, 220, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.25 }),
    );
    this.knot.position.set(-4, 0, 0);
    this.root.add(this.knot);
    // Светящееся кольцо
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.03, 8, 160),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.position.copy(this.knot.position);
    this.root.add(this.ring);
    // Текст на текстуре (вращается вместе со сценой)
    this.sign = textMesh('Банки', { height: 0.9, font: '800 140px Unbounded', background: 'rgba(0,0,0,.6)', border: { color: '#00e000', width: 8 } });
    this.sign.position.set(4.2, 2.2, 0);
    this.root.add(this.sign);
    // Частицы — по поверхности геометрии
    this.shape = S.fromGeometry(this.ctx.particles.count, new THREE.IcosahedronGeometry(2.4, 3), {
      colorFn: (v, n, r) => (r() < 0.3 ? S.PAL.greenHi : S.PAL.white),
      alpha: 0.5,
    });
  }

  camera(state, step) {
    return step >= 1 ? { pos: [6, 3, 10], target: [2, 0, 0], fov: 45 } : { pos: [0, 0, 15], target: [0, 0, 0], fov: 45 };
  }

  background() { return 'corners'; }

  enter(o) {
    this.claimParticles();
    this.particles.morph(this.shape, { duration: o.instant ? 0.01 : 2 });
    this.tw(this.particles.object.position, { x: 4, y: -0.5, z: 0, duration: 1.5 });
    this.lbl = this.label({ html: '<span class="tag big">HTML-подпись</span>', object: this.knot, offset: [0, 2.6, 0] });
    this.lbl2 = this.label({ html: '<span class="huge accent">86 млрд</span>', position: [4, -3.4, 0], visible: false });
    this.setStep(o.step ?? 0, o);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    if (step >= 2) this.lbl2?.show(); else this.lbl2?.hide();
    if (step >= 3) this.drive((dt, t) => ({ pos: [Math.cos(t * 0.3) * 14, 3, Math.sin(t * 0.3) * 14], target: [0, 0, 0], fov: 45 }));
    else this.drive(null);
  }

  exit(o) {
    this.drive(null);
    this.removeLabels();
    return super.exit(o);
  }

  update(dt, t) {
    this.knot.rotation.x += dt * 0.4;
    this.knot.rotation.y += dt * 0.25;
    this.ring.rotation.x = Math.sin(t * 0.5) * 0.6;
    if (this.ownsParticles()) this.particles.object.rotation.y += dt * 0.2;
  }
}
