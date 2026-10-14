// ИИ против ИИ: два светящихся агента (мозги из частиц) с гекса-щитами сталкиваются щит в щит, летят искры.
// Шаг 1 — «обратная сторона»: банковский перевод $1 500 000 упирается в зелёный барьер и перечёркивается.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { HASH } from '../../core/glsl.js';
import { fontsReady } from '../../core/utils.js';
import { makeCanvas, roundRectPath, drawHalftone, drawMark, canvasTexture, Sparks, yieldFrame } from './util.js';

const CENTER = new THREE.Vector3(3.95, 0.5, 0);
const HALF = 2.25;          // расстояние агента от центра
const RS = 1.95;            // радиус щита
const CYCLE = 2.7;          // период столкновений, с

const SHIELD_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vN;
varying vec3 vV;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SHIELD_FRAG = /* glsl */ `
uniform vec3 uColor, uFace, uHitPos;
uniform float uOpacity, uTime, uHit, uHitAge, uDensity, uCap, uPower;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vV;
${HASH}
const vec2 HS = vec2(1.0, 1.7320508);
float hexDist(vec2 p) { p = abs(p); return max(dot(p, HS * 0.5), p.x); }
vec4 hexGrid(vec2 uv) {
  vec4 hC = floor(vec4(uv, uv - vec2(0.5, 1.0)) / HS.xyxy) + 0.5;
  vec4 h = vec4(uv - hC.xy * HS, uv - (hC.zw + 0.5) * HS);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}
void main() {
  vec3 dir = normalize(vPos);
  float f = dot(dir, uFace);
  if (f < uCap) discard;
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(uFace, up));
  vec2 uv = vec2(dot(vPos, side), dot(vPos, up)) * uDensity;
  vec4 h = hexGrid(uv);
  float edge = smoothstep(0.38, 0.49, hexDist(h.xy));
  float cr = hash12(h.zw + 7.0);
  float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
  float rimFade = smoothstep(uCap, uCap + 0.22, f);
  float d = distance(vPos, uHitPos);
  float wd = (d - uHitAge * 3.4) * 2.6;
  float wave = exp(-wd * wd) * uHit;
  float near = exp(-d * 2.3) * uHit;
  float shimmer = 0.5 + 0.5 * sin(uTime * 2.4 + cr * 30.0);
  float cell = step(0.72, cr) * (0.25 + 0.75 * shimmer);
  float a = edge * (0.32 + 0.6 * fres) + 0.05 + cell * 0.12 * (0.4 + fres) + wave * (0.75 + edge) + near * 0.5;
  a *= rimFade * uPower;
  vec3 col = uColor * (0.7 + edge * 0.9) + mix(uColor, vec3(1.0), 0.45) * (wave * 0.55 + near * 0.4);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.6) * uOpacity);
}
`;

function transferTexture(mark) {
  const W = 1024, H = 600;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#efeee6';
  roundRectPath(g, 0, 0, W, H, 40);
  g.fill();
  drawHalftone(g, 0, 0, W, H, 18, (u, v) => Math.max(0, 1 - Math.hypot(1 - u, 1 - v) * 1.25) * 1.3, 'rgba(0,190,0,.5)');
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(11,12,11,.25)';
  roundRectPath(g, 22, 22, W - 44, H - 44, 28);
  g.stroke();
  g.fillStyle = '#0b0c0b';
  g.font = '700 46px Unbounded';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.fillText('ПЕРЕВОД', 70, 104);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  drawMark(g, mark, W - 100, 104, 82, '#00b400');
  // Сумма — группами разрядов с явным зазором: у «1» в Unbounded широкие поля, и с обычным
  // (даже тонким) пробелом «$1 500 000» издалека читается как «$1500 000».
  const groups = ['$1', '500', '000'];
  const gapK = 0.36;
  let size = 170;
  const widthAt = () => groups.reduce((a, t) => a + g.measureText(t).width, 0) + gapK * size * (groups.length - 1);
  for (; size > 60; size -= 2) {
    g.font = `800 ${size}px Unbounded`;
    if (widthAt() <= W * 0.84) break;
  }
  g.font = `800 ${size}px Unbounded`;
  g.textAlign = 'left';
  let x = (W - widthAt()) / 2;
  for (const t of groups) {
    g.fillText(t, x, H * 0.52);
    x += g.measureText(t).width + gapK * size;
  }
  // декоративная полоса
  for (let i = 0; i < 46; i++) {
    const w = (i * 37) % 7 < 3 ? 6 : 12;
    g.fillRect(70 + i * 19, H - 132, w, 54);
  }
  return c;
}

export default class AiVsAi extends Visual {
  static transition = 'morph';

  async init() {
    await fontsReady();
    const mark = await S.loadMark();
    this.group = new THREE.Group();
    this.root.add(this.group);

    // Щиты
    const sph = new THREE.SphereGeometry(RS, 96, 64);
    const mkShield = (color, face, cap = 0.38, density = 2.6) => {
      const u = {
        uColor: { value: new THREE.Color(color) }, uFace: { value: new THREE.Vector3(...face) },
        uHitPos: { value: new THREE.Vector3(...face).multiplyScalar(RS) }, uOpacity: { value: 1 }, uTime: { value: 0 },
        uHit: { value: 0 }, uHitAge: { value: 0 }, uDensity: { value: density }, uCap: { value: cap }, uPower: { value: 1 },
      };
      const m = new THREE.Mesh(sph, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.renderOrder = 14;
      return m;
    };
    this.shieldL = mkShield(new THREE.Color('#00ff00').multiplyScalar(1.15), [1, 0, 0]);
    this.shieldR = mkShield(new THREE.Color('#ff3b30').multiplyScalar(1.25), [-1, 0, 0]);
    this.group.add(this.shieldL, this.shieldR);

    // Ядра агентов — мягкое свечение
    const glowMat = (c) => new THREE.SpriteMaterial({ color: new THREE.Color(c).multiplyScalar(0.22), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: glowSprite() });
    this.coreL = new THREE.Sprite(glowMat('#00ff00')); this.coreL.scale.setScalar(4.2);
    this.coreR = new THREE.Sprite(glowMat('#ff3b30')); this.coreR.scale.setScalar(4.2);
    this.group.add(this.coreL, this.coreR);

    // Искры
    this.sparks = new Sparks(700, { gravity: -3.2, drag: 1.4, soft: 0 });
    this.root.add(this.sparks.object);

    // Перевод
    this.card = new THREE.Group();
    const tex = canvasTexture(transferTexture(mark));
    const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.3 * 600 / 1024), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    cardMesh.material.color.setScalar(0.82);
    this.card.add(cardMesh);
    const strikeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b30').multiplyScalar(1.9), transparent: true, depthTest: false });
    // линия по средней линии суммы, тонкая — цифры остаются читаемыми
    const sg = new THREE.PlaneGeometry(1, 0.075);
    sg.translate(0.5, 0, 0);
    this.strike = new THREE.Mesh(sg, strikeMat);
    this.strike.position.set(-1.42, -0.085, 0.01);
    this.strike.rotation.z = 0.03;
    this.strike.scale.set(0.0001, 1, 1);
    this.strike.renderOrder = 20;
    this.card.add(this.strike);
    this.card.visible = false;
    this.root.add(this.card);
    // Зелёный барьер, который останавливает перевод
    this.barrier = mkShield(new THREE.Color('#00ff00').multiplyScalar(1.1), [1, 0, 0], 0.76, 3.6);
    this.barrier.scale.setScalar(0.85);
    this.barrier.visible = false;
    this.root.add(this.barrier);

    await yieldFrame();
    this.buildShapes();
    this.k = { lunge: 0, card: 0, strike: 0, barrier: 0, dimAgents: 0 };
    this.phase = 0;
    this.lastImpact = -1;
  }

  buildShapes() {
    const n = this.ctx.particles.count;
    const redRidge = [1.25, 0.3, 0.2];
    this.shape = S.combine(n, [
      { weight: 0.38, shape: (m) => S.brain(m, { scale: 1.35, ridge: S.PAL.pale, groove: S.PAL.green, brightness: 0.62, seed: 9 }), position: [-HALF - 0.55, 0, 0], rotation: [0, Math.PI / 2, 0] },
      { weight: 0.38, shape: (m) => S.brain(m, { scale: 1.35, ridge: redRidge, groove: S.PAL.red, brightness: 0.9, seed: 12 }), position: [HALF + 0.55, 0, 0], rotation: [0, -Math.PI / 2, 0] },
      { weight: 0.24, shape: (m) => S.dust(m, { radius: 26, inner: 5, alpha: 0.18, size: 0.7 }) },
    ]);
  }

  // Позы — для 16:9; под экраны 4:3 / 16:10 ядро подгоняет их само.
  camera(state, step) {
    return step >= 1
      ? { pos: [0.5, -0.45, 13.4], target: [0.5, -0.55, 0], fov: 40 }
      : { pos: [-0.1, 0.45, 14], target: [0.0, 0.3, 0], fov: 40 };
  }

  background(state, step) { return step >= 1 ? 'corner' : 'corners'; }

  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.16, swirl: 0, size: 0.056, twinkle: 0.3, spring: 14, damping: 5, flow: [0, 0, 0] }, o.instant ? 0 : 1);
    p.morph(this.shape, { duration: o.instant ? 0.01 : 2.4, stagger: 0.5, burst: 14 });
    const obj = p.object;
    // облако «садится» на место через прокси: в update к нему добавляется отъезд агентов на шаге 1
    this.pp = { x: obj.position.x, y: obj.position.y, z: obj.position.z, s: obj.scale.y };
    this.tw(this.pp, { x: CENTER.x, y: CENTER.y, z: CENTER.z, s: 1, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, z: 0, duration: o.instant ? 0 : 1.6, ease: 'power2.inOut' });
    this.removeLabels();
    this.labL = this.label({ html: '<span class="b6k-tag3d b6k-tag-green">Открытая модель</span>', position: [CENTER.x - HALF - 0.4, CENTER.y + 1.95, 0], anchor: 'bottom', visible: false });
    this.labR = this.label({ html: '<span class="b6k-tag3d b6k-tag-red">Атакующий ИИ-агент</span>', position: [CENTER.x + HALF - 0.2, CENTER.y - 2.05, 0], anchor: 'top', visible: false });
    this.stampL = this.label({ html: '<span class="b6k-stamp">Остановлен</span>', object: this.card, offset: [0.12, -0.62, 0.06], visible: false });
    this.t0 = this.ctx.time + (o.instant ? 0 : 1.6);
    this.phase = 0;
    this.sparks.clear();
    // подписи появляются вместе со сценой (а не поверх уходящей предыдущей)
    this._labDelay?.kill();
    this._labsOn = !!o.instant;
    if (!o.instant) this._labDelay = this.delay(0.5, () => { this._labDelay = null; this._labsOn = true; this.syncLabels(); });
    this.applyCard(this.step >= 1, true);
    return super.enter(o);
  }

  /** Видимость подписей по текущему шагу: агенты — на шаге 0, штамп — когда перевод уже перечёркнут. */
  syncLabels() {
    if (!this._labsOn) return;
    const on = this.step >= 1;
    [this.labL, this.labR].forEach((l) => l?.[on ? 'hide' : 'show']());
    if (!on) this.stampL?.hide();
    else if (this.k.strike >= 0.999) this.stampL?.show();
  }

  setStep(step, o = {}) {
    this.step = step;
    this.applyCard(step >= 1, !!o.instant);
  }

  applyCard(on, instant) {
    this._cardTl?.kill();
    const k = this.k;
    if (this.ownsParticles()) this.particles.setParams({ opacity: on ? 0.55 : 1 }, instant ? 0 : 0.8);
    this._dimmed = on;
    if (instant) {
      k.card = on ? 1 : 0; k.strike = on ? 1 : 0; k.barrier = on ? 1 : 0; k.dimAgents = on ? 1 : 0;
      this.syncLabels();
      return;
    }
    if (on) { k.card = 0; k.strike = 0; k.barrier = 0; }
    this.syncLabels();
    const tl = this._cardTl = this.tl();
    if (on) {
      tl.to(k, { dimAgents: 1, duration: 0.8 }, 0);
      tl.to(k, { card: 1, duration: 1.05, ease: 'power3.out' }, 0.1);
      tl.to(k, { barrier: 1, duration: 0.35, ease: 'back.out(2)' }, 0.55);
      tl.call(() => this.barrierHit(), null, 0.82);
      tl.to(k, { strike: 1, duration: 0.55, ease: 'power2.inOut' }, 1.35);
      tl.call(() => { this.stampL.show(); this.ctx.rig.shake(0.06, 0.35); }, null, 1.85);
    } else {
      this.stampL?.hide();
      tl.to(k, { strike: 0, duration: 0.3 }, 0);
      tl.to(k, { card: 0, barrier: 0, duration: 0.7, ease: 'power2.in' }, 0.1);
      tl.to(k, { dimAgents: 0, duration: 0.8 }, 0.2);
    }
  }

  barrierHit() {
    const u = this.barrier.material.uniforms;
    u.uHit.value = 1;
    this.barrierHitT = this.ctx.time;
    this.ctx.rig.shake(0.12, 0.45);
    this.ctx.engine.pulse({ aberration: 0.9, flash: 0.04 }, 0.6);
    const p = this.card.position;
    this.sparks.emit([p.x - 1.7, p.y, p.z], 60, { speed: 4.5, dir: [-0.2, 0, 0], spread: 1.2, color: [0.55, 1.9, 0.55], alpha: 0.9, size: 1.0, life: 0.85 });
  }

  exit(o = {}) {
    this._cardTl?.kill();
    this._labDelay?.kill();
    this._labsOn = false;
    [this.labL, this.labR, this.stampL].forEach((l) => l?.hide());
    // режиссёр уже снял «владельца» частиц — возвращаем прозрачность облака без проверки
    if (this._dimmed) { this._dimmed = false; this.particles.setParams({ opacity: 1 }, 0.6); }
    return super.exit(o);
  }

  update(dt, t) {
    const k = this.k;
    const e = this.ctx.engine;
    // цикл столкновения: замах — бросок — удар — отскок — пауза
    const tt = t - this.t0;
    let lunge = 0;
    if (tt > 0) {
      const ph = tt % CYCLE;
      const cyc = Math.floor(tt / CYCLE);
      if (ph < 0.55) lunge = -0.35 * Math.sin((ph / 0.55) * Math.PI * 0.5);          // замах назад
      else if (ph < 0.78) { const x = (ph - 0.55) / 0.23; lunge = -0.35 + 1.35 * x * x; } // бросок
      else if (ph < 1.6) { const x = (ph - 0.78) / 0.82; lunge = 1 - 1.15 * (1 - Math.pow(1 - x, 3)) + 0.15 * Math.sin(x * Math.PI); } // отскок
      else lunge = -0.15 * Math.sin(((ph - 1.6) / (CYCLE - 1.6)) * Math.PI);
      if (ph >= 0.78 && this.lastImpact !== cyc) { this.lastImpact = cyc; this.impact(); }
    }
    const dim = 1 - 0.45 * k.dimAgents;
    // шаг 1: агенты отъезжают вверх и вглубь — место для перевода
    const ay = 1.05 * k.dimAgents, az = -2.4 * k.dimAgents, as = 1 - 0.12 * k.dimAgents;
    this.group.position.set(0, ay, az);
    // агенты: облако «сжимается» по X — мозги идут навстречу; щиты — вместе с ними
    const sx = 1 - 0.135 * lunge;
    if (this.ownsParticles()) {
      const o = this.particles.object;
      const pp = this.pp;
      o.position.set(pp.x, pp.y + ay, pp.z + az);
      o.scale.set(pp.s * sx * as, pp.s * as, pp.s * as);
      o.rotation.y = Math.sin(t * 0.3) * 0.08;
    }
    const xl = CENTER.x - HALF * sx * as, xr = CENTER.x + HALF * sx * as;
    this.shieldL.position.set(xl, CENTER.y, 0);
    this.shieldR.position.set(xr, CENTER.y, 0);
    this.shieldL.scale.setScalar(as);
    this.shieldR.scale.setScalar(as);
    this.coreL.position.set(xl - 0.55 * as, CENTER.y, -0.3);
    this.coreR.position.set(xr + 0.55 * as, CENTER.y, -0.3);
    const shields = this._shields || (this._shields = [this.shieldL, this.shieldR, this.barrier]);
    for (let i = 0; i < shields.length; i++) {
      const u = shields[i].material.uniforms;
      u.uTime.value = t;
      u.uHitAge.value = Math.min(3, u.uHitAge.value + dt);
      u.uHit.value = Math.max(0, u.uHit.value - dt * 1.1);
    }
    this.shieldL.material.uniforms.uPower.value = dim;
    this.shieldR.material.uniforms.uPower.value = dim;
    // перевод
    const cardOn = k.card > 0.001;
    this.card.visible = cardOn;
    if (cardOn) {
      const c = k.card;
      // летит справа, «упирается» и чуть отскакивает
      const x = THREE.MathUtils.lerp(10.5, 4.25, c);
      this.card.position.set(x + Math.sin(t * 0.9) * 0.03 * c, -1.6 + Math.sin(t * 1.3) * 0.04, 3.0);
      this.card.rotation.set(-0.06 + (1 - c) * 0.3, -0.14 - (1 - c) * 0.7, 0.04 + (1 - c) * 0.3);
      this.strike.scale.x = Math.max(0.0001, k.strike * 2.84);
    }
    const bOn = k.barrier > 0.001;
    this.barrier.visible = bOn;
    if (bOn) {
      this.barrier.position.set(this.card.position.x - 1.78 - RS * 0.72 * k.barrier, this.card.position.y, this.card.position.z - 0.45);
      this.barrier.scale.setScalar(Math.max(0.001, 0.72 * k.barrier));
      this.barrier.material.uniforms.uHitPos.value.set(RS, 0, 0);
    }
    this.sparks.update(dt);
    this.sparks.setScale(e.height * e.pixelRatio, this.ctx.camera.fov);
  }

  impact() {
    const contact = this._contact || (this._contact = [0, 0, 0]);
    contact[0] = CENTER.x; contact[1] = CENTER.y + this.group.position.y; contact[2] = this.group.position.z;
    const l = this.shieldL.material.uniforms, r = this.shieldR.material.uniforms;
    l.uHit.value = 1; l.uHitAge.value = 0; l.uHitPos.value.set(RS, 0, 0);
    r.uHit.value = 1; r.uHitAge.value = 0; r.uHitPos.value.set(-RS, 0, 0);
    const strong = this.k.dimAgents < 0.5;
    this.sparks.emit(contact, strong ? 46 : 20, { speed: 6, dir: [0, 0.3, 0], spread: 1.0, color: [1.5, 1.35, 0.9], alpha: 0.85, size: 1.05, life: 0.85 });
    this.sparks.emit(contact, strong ? 34 : 14, { speed: 4.5, dir: [-1, 0.25, 0], spread: 0.8, color: [0.45, 1.8, 0.45], alpha: 0.9, size: 0.95, life: 0.8 });
    this.sparks.emit(contact, strong ? 34 : 14, { speed: 4.5, dir: [1, 0.25, 0], spread: 0.8, color: [2.0, 0.35, 0.25], alpha: 0.9, size: 0.95, life: 0.8 });
    if (this.ownsParticles()) this.particles.explode(strong ? 1.2 : 0.7, [0, 0, 0]);
    if (strong) {
      this.ctx.rig.shake(0.07, 0.35);
      this.ctx.engine.pulse({ aberration: 0.6 }, 0.5);
    }
  }
}

function glowSprite() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,.9)');
  grd.addColorStop(0.3, 'rgba(255,255,255,.3)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
