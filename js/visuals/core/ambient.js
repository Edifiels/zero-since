// Спокойный фон для текстовых слайдов (цитаты, вопросы, утверждения).
// Состояния: 'nebula' (по умолчанию) | 'orb' | 'question' | 'rays' | 'ring' | 'brain' | 'galaxy' | 'helix' | 'dim'
// Положение облака можно сдвинуть суффиксом: 'orb@right', 'question@left' (под колонку текста).
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';

export default class Ambient extends Visual {
  static transition = 'morph';

  async init() {
    this.cache = new Map();
    this.mark = await S.loadMark();
  }

  parse(state) {
    const [name, side] = String(state || 'nebula').split('@');
    return { name, side: side || 'center' };
  }

  shape(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const n = this.ctx.particles.count;
    let s;
    switch (name) {
      case 'orb': s = S.combine(n, [
        { weight: 3, shape: (m) => S.sphere(m, { radius: 3.2, thickness: 0.04, accentRatio: 0.3 }) },
        { weight: 1, shape: (m) => S.ring(m, { radius: 5.2, width: 0.5, thickness: 0.05 }), rotation: [0.35, 0, 0.2] },
      ]); break;
      case 'question': s = S.fromText(n, '?', { font: '800 520px Unbounded', width: 5.2, depth: 1.4, colorFn: (x, y, r) => (r() < 0.3 ? S.PAL.greenHi : S.PAL.bright) }); break;
      case 'rays': s = S.logo(n, this.mark, { width: 5.2, depth: 0.6, colorFn: (x, y, r) => (r() < 0.25 ? S.PAL.greenHi : S.PAL.white) }); break;
      case 'ring': s = S.combine(n, [
        { weight: 2, shape: (m) => S.ring(m, { radius: 4.4, width: 0.9, thickness: 0.18 }), rotation: [1.1, 0, 0.25] },
        { weight: 1, shape: (m) => S.ball(m, { radius: 1.2, color: S.PAL.greenHi, alpha: 0.7 }) },
      ]); break;
      case 'brain': s = S.brain(n, { scale: 3.4 }); break;
      case 'galaxy': s = S.galaxy(n, { radius: 6.5 }); break;
      case 'helix': s = S.helix(n, { radius: 1.5, height: 10, turns: 3 }); break;
      case 'dim': s = S.fade(S.dust(n, { radius: 40, inner: 6 }), 0.6); break;
      default: s = S.combine(n, [
        { weight: 3, shape: (m) => S.dust(m, { radius: 26, inner: 3, alpha: 0.32, size: 0.8 }) },
        { weight: 1, shape: (m) => S.galaxy(m, { radius: 9, twist: 1.1, thickness: 0.6, brightness: 0.55 }), rotation: [0.9, 0, 0.3] },
      ]);
    }
    this.cache.set(name, s);
    return s;
  }

  placement(side) {
    const w = this.stageRect().w;
    if (side === 'left') return { x: -w * 0.24, y: 0 };
    if (side === 'right') return { x: w * 0.24, y: 0 };
    if (side === 'top') return { x: 0, y: 1.6 };
    if (side === 'bottom') return { x: 0, y: -1.6 };
    return { x: 0, y: 0 };
  }

  camera() { return { pos: [0, 0, 14], target: [0, 0, 0], fov: 45 }; }

  apply(state, o = {}) {
    const { name, side } = this.parse(state);
    this.claimParticles();
    const p = this.particles;
    const spin = { galaxy: 0.12, ring: 0.05, nebula: 0.03 }[name] ?? 0;
    p.setParams({ noise: name === 'nebula' || name === 'dim' ? 0.6 : 0.3, swirl: spin, size: 0.07, twinkle: 0.35 }, o.instant ? 0 : 1.2);
    p.morph(this.shape(name), { duration: o.instant ? 0.01 : 2, stagger: 0.5, burst: 12 });
    const pos = this.placement(side);
    const tilt = name === 'galaxy' ? 0.95 : 0;
    this.tw(p.object.position, { x: pos.x, y: pos.y, z: 0, duration: o.instant ? 0 : 1.8, ease: 'power2.inOut' });
    this.tw(p.object.rotation, { x: tilt, y: 0, z: 0, duration: o.instant ? 0 : 1.8, ease: 'power2.inOut' });
    this.name = name;
  }

  enter(o = {}) {
    this.state = o.state;
    this.apply(o.state, o);
    return super.enter(o);
  }

  setState(state, o = {}) {
    this.state = state;
    this.apply(state, o);
  }

  update(dt, t) {
    if (!this.ownsParticles()) return;
    const o = this.particles.object;
    if (this.name === 'question' || this.name === 'rays' || this.name === 'brain') o.rotation.y = Math.sin(t * 0.35) * 0.35;
    else if (this.name === 'orb' || this.name === 'helix') o.rotation.y += dt * 0.12;
  }
}
