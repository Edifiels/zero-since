// Шары голосования: за каждой карточкой голосования светится шар, его размер — доля голосов.
// Состояние = id голосования ('start' | 'copy' | 'final' …). В режиме сравнения (у компонента
// задан data-compare) показывается пунктирное кольцо «было».
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import { store } from '../../core/store.js';
import * as S from '../../core/shapes.js';
import { HASH } from '../../core/glsl.js';

const ORB_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const ORB_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime, uCell;
varying vec3 vN;
varying vec3 vV;
${HASH}
void main() {
  float f = clamp(1.0 - dot(vN, vV), 0.0, 1.0);
  float rim = pow(f, 2.2);
  // фирменный халфтон по поверхности: точки крупнее к краю
  const mat2 R = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 q = R * gl_FragCoord.xy / uCell;
  vec2 c = fract(q) - 0.5;
  float v = clamp(0.15 + rim * 0.9, 0.0, 1.0);
  float dotm = 1.0 - smoothstep(0.72 * sqrt(v) - 0.08, 0.72 * sqrt(v) + 0.08, length(c));
  vec3 col = uColor * (dotm * 0.9 + rim * 1.4) + vec3(1.0) * pow(rim, 6.0) * 0.6;
  gl_FragColor = vec4(col, uOpacity * (0.25 + 0.75 * max(dotm, rim)));
}
`;

export default class VoteOrbs extends Visual {
  static transition = 'halftone';

  async init() {
    this.orbs = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#00ff00').multiplyScalar(1.2) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uCell: { value: 7 } },
        vertexShader: ORB_VERT,
        fragmentShader: ORB_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), mat);
      const ghostPts = [];
      for (let k = 0; k <= 128; k++) { const a = (k / 128) * Math.PI * 2; ghostPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
      const ghost = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ghostPts), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.8 }));
      ghost.computeLineDistances();
      ghost.visible = false;
      g.add(orb, ghost);
      g.userData = { orb, ghost, r: 0.05, target: 0.05, ghostR: 0 };
      this.root.add(g);
      this.orbs.push(g);
    }
    this.off = this.ctx.bus.on('vote:change', (e) => { if (e.id === this.state) this.setValues(e.values); });
  }

  camera() { return { pos: [0, 0, 16], target: [0, 0, 0], fov: 42 }; }
  background() { return 'low'; }

  setValues(values) {
    this.values = values;
    const ghost = this.compareId ? store.get('vote:' + this.compareId) : null;
    this.orbs.forEach((g, i) => {
      const v = values[i] ?? 0;
      g.visible = i < values.length;
      g.userData.target = 0.25 + Math.sqrt(v / 100) * 2.3;
      g.userData.ghostR = Array.isArray(ghost) ? 0.25 + Math.sqrt((ghost[i] ?? 0) / 100) * 2.3 : 0;
      g.userData.ghost.visible = Array.isArray(ghost);
    });
    this.claimParticles();
  }

  readFromDom() {
    const el = this.ctx.deck?.currentEl;
    const vote = el?.querySelector('[data-component="vote"]');
    this.compareId = vote?.dataset.compare || null;
    this.cards = vote ? [...vote.querySelectorAll('.vote-card')] : [];
  }

  enter(o = {}) {
    this.state = o.state || 'start';
    this.readFromDom();
    const saved = store.get('vote:' + this.state);
    this.setValues(Array.isArray(saved) ? saved : [0, 0, 0]);
    // частицы — лёгкое облако-«зал»
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.5, swirl: 0.04, size: 0.06 }, 1);
    p.morph(S.fade(S.dust(p.count, { radius: 22, inner: 4, alpha: 0.5, size: 0.8 }), 0.9), { duration: 2, stagger: 0.4, burst: 8 });
    return super.enter(o);
  }

  setState(state, o = {}) { this.state = state; this.readFromDom(); const s = store.get('vote:' + state); this.setValues(Array.isArray(s) ? s : [0, 0, 0]); }
  setStep(step, o = {}) { this.step = step; this.readFromDom(); if (this.values) this.setValues(this.values); }

  update(dt, t) {
    if (!this.cards || !this.cards.length) this.readFromDom();
    const v = new THREE.Vector3();
    this.orbs.forEach((g, i) => {
      const u = g.userData;
      u.r += (u.target - u.r) * Math.min(1, dt * 3);
      u.orb.scale.setScalar(u.r * (1 + Math.sin(t * 1.6 + i) * 0.02));
      u.ghost.scale.setScalar(u.ghostR || 0.001);
      u.orb.material.uniforms.uTime.value = t;
      u.orb.material.uniforms.uCell.value = Math.max(5, this.ctx.engine.height * this.ctx.engine.pixelRatio / 150);
      const card = this.cards?.[i];
      if (card && card.isConnected) {
        const r = card.getBoundingClientRect();
        this.screenToWorld(r.left + r.width / 2, r.top + r.height * 0.58, -2, v);
        g.position.lerp(v, Math.min(1, dt * 6));
      } else {
        g.position.lerp(v.set((i - 1) * 6, 0, -2), Math.min(1, dt * 3));
      }
      u.ghost.quaternion.copy(this.ctx.camera.quaternion);
    });
  }

  dispose() { this.off?.(); super.dispose(); }
}
