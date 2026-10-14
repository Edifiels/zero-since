// «Тетрис»: неоновый стакан заполнен почти доверху, падает фигура — и вдруг «ПАУЗА» (навсегда).
// Шаги: 0 — фигура падает и замирает (пауза, событие шины 'b5:tetris-pause'),
//       1 — «1 день», 2 — «1 год», 3 — «вечность»: вокруг стакана растут звёздные треки (таймлапс),
//       стакан покрывается «пылью», на «вечности» камера улетает в космос.
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, TAU } from '../../core/utils.js';

const COLS = 10, ROWS = 18, CELL = 0.48;
const W = COLS * CELL, H = ROWS * CELL;
const X0 = -W / 2, Y0 = -H / 2 - 0.25;          // левый нижний угол стакана
const PIECE = [[0, 0], [1, 0], [1, 1], [2, 1]];  // фигура «Z» (клетки относительно опорной)
const PIECE_COL = 4;
const SPAWN_ROW = ROWS + 4;                       // появляется над стаканом
const FREEZE_ROW = ROWS - 1;                      // замирает у самого верха — за миг до касания
const DROP = 0.34;                                // с на ряд
const POLE_Z = -15;                               // «полюс» звёздных треков
const TRAILS = [0, 0.42, 1.9, TAU * 1.02];        // длина трека (рад) по шагам
const SPIN = [0.012, 0.05, 0.16, 0.42];           // скорость вращения неба (рад/с)

const BLOCK_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vN;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vPos = position;
  vN = normal;
  vColor = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #endif
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;
const BLOCK_FRAG = /* glsl */ `
uniform float uOpacity, uHalf, uAge, uDim, uGlow, uTime, uBlink;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vColor;
void main() {
  vec3 a = abs(vPos) / uHalf;
  float e = max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z));
  float edge = smoothstep(0.8, 0.97, e);
  float inner = smoothstep(0.55, 0.75, e) * (1.0 - edge);
  float light = 0.55 + 0.45 * clamp(dot(normalize(vN), normalize(vec3(-0.4, 0.7, 0.6))), 0.0, 1.0);
  vec3 grey = vec3(dot(vColor, vec3(0.3, 0.55, 0.15))) * 0.55;
  vec3 c = mix(vColor, grey, uAge);
  vec3 face = c * (0.16 + 0.1 * inner) * light;
  vec3 col = face + c * edge * (1.25 * uGlow) * (1.0 - 0.55 * uAge);
  col *= (1.0 - uDim) * mix(1.0, 0.55 + 0.45 * uBlink, step(0.5, uGlow - 1.0));
  gl_FragColor = vec4(col, uOpacity);
}
`;
const GRID_FRAG = /* glsl */ `
uniform float uOpacity, uDim;
uniform vec2 uCells;
varying vec2 vUv;
void main() {
  vec2 g = vUv * uCells;
  vec2 f = abs(fract(g) - 0.5);
  float line = smoothstep(0.47, 0.5, max(f.x, f.y));
  float fade = 0.55 + 0.45 * vUv.y;
  vec3 col = vec3(0.0, 0.9, 0.0) * line * 0.16 * fade + vec3(0.0, 0.05, 0.0);
  gl_FragColor = vec4(col * (1.0 - uDim * 0.6), uOpacity * 0.92);
}
`;
const DANGER_FRAG = /* glsl */ `
uniform float uOpacity, uTime, uOn;
varying vec2 vUv;
void main() {
  float dash = step(0.4, fract(vUv.x * 12.0 - uTime * 0.6));
  float blink = 0.5 + 0.5 * step(0.0, sin(uTime * 6.0));
  vec3 col = vec3(1.0, 0.045, 0.03) * 2.4;
  float a = dash * blink * uOn * uOpacity;
  gl_FragColor = vec4(col, a);
}
`;
const VERT_UV = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export default class Tetris extends Visual {
  static transition = 'glitch';

  async init() {
    const r = rng(58);
    this.group = new THREE.Group();
    this.root.add(this.group);

    // Поле: высоты столбцов почти до верха, «дырки» в рядах — как у настоящей партии
    const heights = [14, 15, 13, 15, 14, 16, 15, 14, 15, 13];
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      for (let row = 0; row < heights[c]; row++) cells.push([c, row]);
    }
    const holes = new Set();
    for (let row = 0; row < 13; row++) holes.add(`${(row * 7 + 3 + Math.floor(r() * 3)) % COLS},${row}`);
    const filled = cells.filter(([c, row]) => !holes.has(`${c},${row}`));
    // цвета «фигурами»: соседние клетки одной фигуры — одного цвета
    const palette = ['#00e000', '#00ff00', '#8dff7a', '#dcffd6', '#ffffff', '#3dd13a', '#b8ffb0'].map((h) => new THREE.Color(h));
    const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

    this.uniforms = {
      uOpacity: { value: 1 }, uHalf: { value: CELL * 0.46 }, uAge: { value: 0 }, uDim: { value: 0 },
      uGlow: { value: 1 }, uTime: { value: 0 }, uBlink: { value: 1 },
    };
    const geo = new THREE.BoxGeometry(CELL * 0.92, CELL * 0.92, CELL * 0.92);
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BLOCK_VERT, fragmentShader: BLOCK_FRAG, transparent: true });
    this.blocks = new THREE.InstancedMesh(geo, mat, filled.length);
    const m4 = new THREE.Matrix4();
    filled.forEach(([c, row], i) => {
      m4.makeTranslation(X0 + (c + 0.5) * CELL, Y0 + (row + 0.5) * CELL, 0);
      this.blocks.setMatrixAt(i, m4);
      const k = hash(Math.floor((c + (row % 2)) / 2), Math.floor(row / 2));
      this.blocks.setColorAt(i, palette[Math.floor(k * palette.length) % palette.length]);
    });
    this.blocks.instanceMatrix.needsUpdate = true;
    this.blocks.instanceColor.needsUpdate = true;
    this.group.add(this.blocks);

    // Падающая фигура — отдельный материал (ярче, мигает на паузе)
    this.pieceU = { ...this.uniforms, uGlow: { value: 2 }, uAge: { value: 0 }, uDim: { value: 0 }, uBlink: { value: 1 } };
    this.pieceU.uOpacity = { value: 1 };
    this.pieceU.uHalf = this.uniforms.uHalf;
    this.pieceU.uTime = this.uniforms.uTime;
    const pmat = new THREE.ShaderMaterial({ uniforms: this.pieceU, vertexShader: BLOCK_VERT, fragmentShader: BLOCK_FRAG, transparent: true });
    this.piece = new THREE.InstancedMesh(geo, pmat, PIECE.length);
    const white = new THREE.Color('#ffffff');
    PIECE.forEach(([dc, dr], i) => {
      m4.makeTranslation((dc + 0.5) * CELL, (dr + 0.5) * CELL, 0);
      this.piece.setMatrixAt(i, m4);
      this.piece.setColorAt(i, white);
    });
    this.piece.instanceMatrix.needsUpdate = true;
    this.piece.instanceColor.needsUpdate = true;
    this.pieceGroup = new THREE.Group();
    this.pieceGroup.add(this.piece);
    this.group.add(this.pieceGroup);
    this.setPieceRow(SPAWN_ROW);

    // Стакан: светящиеся стенки и дно, сетка на задней стенке
    const wallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#00ff00').multiplyScalar(1.05) });
    const t = 0.07;
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(t, H + 0.35, CELL), wallMat);
    wallL.position.set(X0 - t / 2 - 0.02, Y0 + H / 2 + 0.17, 0);
    const wallR = wallL.clone();
    wallR.position.x = -wallL.position.x;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W + t * 2 + 0.04, t, CELL), wallMat);
    floor.position.set(0, Y0 - t / 2 - 0.02, 0);
    this.group.add(wallL, wallR, floor);
    this.gridU = { uOpacity: { value: 1 }, uDim: { value: 0 }, uCells: { value: new THREE.Vector2(COLS, ROWS) } };
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.ShaderMaterial({ uniforms: this.gridU, vertexShader: VERT_UV, fragmentShader: GRID_FRAG, transparent: true, depthWrite: false }));
    grid.position.set(0, Y0 + H / 2, -CELL / 2 - 0.01);
    this.group.add(grid);
    // Красная пунктирная «линия проигрыша» у верха
    this.dangerU = { uOpacity: { value: 1 }, uTime: { value: 0 }, uOn: { value: 1 } };
    const danger = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.2, 0.09),new THREE.ShaderMaterial({ uniforms: this.dangerU, vertexShader: VERT_UV, fragmentShader: DANGER_FRAG, transparent: true, depthWrite: false }));
    danger.position.set(0, Y0 + (ROWS - 1) * CELL, CELL / 2 + 0.02);
    this.group.add(danger);

    this.group.rotation.y = -0.18;
    this.shapes = [];
    this.paused = false;
    this.spin = SPIN[0];
    this.skyAngle = 0;
    for (let k = 0; k < TRAILS.length; k++) this.trails(k);
  }

  setPieceRow(row) {
    this.pieceRow = row;
    this.pieceGroup.position.set(X0 + PIECE_COL * CELL, Y0 + row * CELL, 0);
  }

  // ---------- Частицы: звёзды → треки таймлапса ----------
  trails(step) {
    if (this.shapes[step]) return this.shapes[step];
    const n = this.ctx.particles.count;
    if (step >= 3) {
      // «Вечность»: небо закручивается в галактику, в её центре — замерший стакан
      const g = S.galaxy(n, { radius: 30, arms: 2, twist: 1.2, thickness: 0.7, bulge: 0.1, spread: 0.26, seed: 19 });
      const r = rng(91);
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const x = g.positions[j], z = g.positions[j + 2];
        const f = Math.hypot(x, z) / 30;
        // ядро — зелёное свечение за стаканом (без PAL.bright: плотный центр иначе выгорает в белое пятно)
        const c = f < 0.1 ? (r() < 0.3 ? S.PAL.greenHi : r() < 0.6 ? S.PAL.mint : S.PAL.white) : r() < 0.1 ? S.PAL.greenHi : r() < 0.35 ? S.PAL.mint : S.PAL.white;
        g.colors[j] = c[0]; g.colors[j + 1] = c[1]; g.colors[j + 2] = c[2];
        g.colors[j + 3] *= f < 0.1 ? 0.55 : 0.85;
      }
      S.transform(g, { rotation: [Math.PI / 2 - 0.42, 0, 0], position: [0, 0, POLE_Z] });
      g.meta.axis = 'z';
      this.shapes[step] = g;
      return g;
    }
    const s = S.createShape(n);
    const r = rng(77);
    const stars = 520;
    const per = Math.floor(n / stars);
    const L = TRAILS[step];
    // параметры звёзд одинаковы для всех шагов (одна и та же частица — та же звезда)
    const sp = [];
    for (let k = 0; k < stars; k++) {
      const rad = 2.4 + Math.pow(r(), 0.7) * 34;
      sp.push({ rad, a0: r() * TAU, z: POLE_Z + r.range(-3, 3), b: r.range(0.45, 1), c: r() });
    }
    const boost = step >= 2 ? 1.45 : 1;
    for (let i = 0; i < n; i++) {
      const k = Math.min(stars - 1, Math.floor(i / per));
      const q = sp[k];
      const f = (i % per) / per;              // 0 — голова трека, 1 — хвост
      const a = q.a0 - f * L;
      const jitter = L > 0 ? 0.012 : 0.03;
      const x = Math.cos(a) * q.rad + r.gauss(0, jitter);
      const y = Math.sin(a) * q.rad + r.gauss(0, jitter);
      const col = q.c < 0.06 ? S.PAL.greenHi : q.c < 0.2 ? S.PAL.mint : q.c < 0.3 ? S.PAL.blue : S.PAL.white;
      const head = 1 - f * 0.7;
      const alpha = L > 0 ? q.b * head * 0.5 * boost : q.b * 0.2;
      S.setPoint(s, i, x, y, q.z, (L > 0 ? 1.15 : 1.2) * (0.7 + q.b * 0.6), col, Math.min(0.9, alpha));
    }
    this.shapes[step] = s;
    return s;
  }

  camera(state, step) {
    if (step >= 3) return { pos: [0, 2.5, 38], target: [0, 5.2, -10], fov: 50, duration: 3.2 };
    return { pos: [0.6, 0.35, 15.2], target: [0.1, 0.15, 0], fov: 42 };
  }

  background(state, step) { return step >= 1 ? 'none' : 'corners'; }

  enter(o = {}) {
    this.state = o.state;
    const step = o.step ?? 0;
    this.step = step;
    this.claimParticles();
    const p = this.particles;
    p.setParams({ noise: 0.05, swirl: 0, size: step >= 3 ? 0.12 : 0.07, twinkle: step >= 3 ? 0.2 : 0.45, spring: 12, damping: 5 }, o.instant ? 0 : 1);
    p.morph(this.trails(step), { duration: o.instant ? 0.01 : 2.2, stagger: 0.55, burst: 10 });
    const obj = p.object;
    this.skyAngle = obj.rotation.z;   // вращение неба продолжается с текущего угла облака — без рывка
    this.tw(obj.position, { x: 0, y: 0, z: 0, duration: o.instant ? 0 : 1.5, ease: 'power2.inOut' });
    this.tw(obj.rotation, { x: 0, y: 0, duration: o.instant ? 0 : 1.5, ease: 'power2.inOut' });
    this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: o.instant ? 0 : 1.5 });
    // фигура: при входе на шаг 0 — падает и замирает; иначе — сразу на паузе
    this.fallT = 0;
    if (step === 0 && !o.instant) {
      this.paused = false;
      this.setPieceRow(SPAWN_ROW);
      this.uniforms.uDim.value = 0;
      this.gridU.uDim.value = 0;
      this.delay(0.6, () => { this.falling = true; });
    } else {
      this.falling = false;
      this.setPieceRow(FREEZE_ROW);
      this.pause(true);
    }
    this.applyStep(step, o.instant ? 0 : 1.5, true);
    return super.enter(o);
  }

  setStep(step, o = {}) {
    const prev = this.step;
    this.step = step;
    if (step >= 1 && !this.paused) { this.falling = false; this.setPieceRow(FREEZE_ROW); this.pause(false); }
    if (this.ownsParticles()) this.particles.setParams({ size: step >= 3 ? 0.12 : 0.07, twinkle: step >= 3 ? 0.2 : 0.45 }, o.instant ? 0 : 1.6);
    if (this.ownsParticles() && TRAILS[step] !== TRAILS[prev]) {
      this.particles.morph(this.trails(step), { duration: step > prev ? 2.4 : 1.6, stagger: 0.6, burst: 2, keepSwirl: true });
    }
    this.applyStep(step, o.instant ? 0 : 1.6, false);
    if (step > prev && !o.instant) {
      this.ctx.engine.pulse({ aberration: 0.8, glitch: 0.25 }, 0.6);
      this.ctx.background.surge(0.5, 1.4);
    }
  }

  applyStep(step, dur, entering) {
    this.tw(this, { spin: SPIN[step], duration: dur > 0 ? 1.8 : 0, ease: 'power2.inOut', overwrite: 'auto' });
    const age = step >= 3 ? 1 : step >= 2 ? 0.75 : step >= 1 ? 0.25 : 0;
    this.tw(this.uniforms.uAge, { value: age, duration: dur, ease: 'power2.inOut' });
    this.tw(this.pieceU.uAge, { value: age * 0.6, duration: dur, ease: 'power2.inOut' });
    // «вечность» — стакан тонет в космосе
    const sc = step >= 3 ? 0.85 : 1;
    this.tw(this.group.scale, { x: sc, y: sc, z: sc, duration: dur * 1.4, ease: 'power2.inOut' });
  }

  /** Поставить игру на паузу (вспышка, сканлайны, событие для HTML). */
  pause(quiet) {
    // сцена уже уходит (фигура «долетела» во время затухания) — не включать сканлайны и вспышку на чужом слайде
    if (!this.active) return;
    if (this.paused) quiet = true;   // уже на паузе — только восстановить вид, без «удара»
    this.paused = true;
    const e = this.ctx.engine;
    if (!quiet) {
      e.pulse({ glitch: 0.75, aberration: 1.8, flash: 0.12 }, 0.7);
      this.ctx.rig.shake(0.12, 0.4);
    }
    e.setFx({ scan: 0.32 }, quiet ? 0.3 : 0.4);
    this.tw(this.uniforms.uDim, { value: 0.42, duration: quiet ? 0 : 0.35 });
    this.tw(this.gridU.uDim, { value: 1, duration: quiet ? 0 : 0.35 });
    this.ctx.bus.emit('b5:tetris-pause');
  }

  exit(o = {}) {
    this.falling = false;
    this.ctx.engine.setFx({ scan: 0 }, 0.6);
    return super.exit(o);
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05);
    this.uniforms.uTime.value = t;
    this.dangerU.uTime.value = t;
    // падение по рядам, как в настоящем тетрисе
    if (this.falling && !this.paused) {
      this.fallT += dt;
      if (this.fallT >= DROP) {
        this.fallT -= DROP;
        if (this.pieceRow > FREEZE_ROW) this.setPieceRow(this.pieceRow - 1);
        if (this.pieceRow <= FREEZE_ROW) { this.falling = false; this.delay(0.18, () => this.pause(false)); }
      }
    }
    // на паузе фигура мерцает
    this.pieceU.uBlink.value = this.paused ? (Math.sin(t * 5) > 0 ? 1 : 0.35) : 1;
    // небо вращается вокруг «полюса» за стаканом
    if (this.ownsParticles()) {
      this.skyAngle += dt * this.spin;
      this.particles.object.rotation.z = this.skyAngle;
    }
    this.group.rotation.y = -0.18 + Math.sin(t * 0.25) * 0.05;
    this.group.rotation.x = Math.sin(t * 0.19) * 0.02;
  }
}

