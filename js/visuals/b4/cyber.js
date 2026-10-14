// Кибербезопасность (2026): «город» голографических башен бегущего кода, сфера-модель Mythos сканирует их лучами.
// Шаги: 0 — сканирование; 1 — тысячи красных меток-уязвимостей; 2 — цепочка дыр в ядре Linux
// (от «обычного пользователя» до «полного контроля»); 3 — «пыльный» фрагмент кода OpenBSD (27 лет);
// 4 — модель закрывают: замок защёлкивается, частицы смыкаются в защитную оболочку.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';
import { rng, clamp, TAU } from '../../core/utils.js';
import { SIMPLEX } from '../../core/glsl.js';
import { glowTexture, glowMat, haloSprite, idle } from './util.js';

const GROUND = -4.6;
const TOWERS = [
  { x: 4.6, z: -2.5, r: 1.55, h: 9.0, seed: 0.13 },                 // 0 — ядро Linux
  { x: 12.4, z: -8.8, r: 1.3, h: 7.0, seed: 0.71, old: true },      // 1 — OpenBSD (старый код)
  { x: 1.2, z: -15.5, r: 2.1, h: 12, seed: 0.37 },
  { x: 8.2, z: -17.5, r: 1.8, h: 10.5, seed: 0.52 },
  { x: 17.8, z: -16, r: 2.4, h: 13, seed: 0.91 },
  { x: 2.4, z: -28, r: 2.7, h: 15, seed: 0.24 },
  { x: 19.8, z: -5.0, r: 1.15, h: 6.4, seed: 0.66 },
  { x: -4.5, z: -31, r: 1.9, h: 11, seed: 0.45 },
];
const ORB = new THREE.Vector3(9.6, 4.3, -4.6);
const ATLAS_W = 5.2;               // ширина «страницы» кода в мире
const ROWS = 48, PAGES = 2, CPP = 8;  // строк в атласе, «страниц» по ширине, ячеек на страницу
const COLS = PAGES * CPP;

// Обобщённый «системный» код (декорация, не реальные фрагменты)
const CODE = [
  'static int parse_header(struct buf *b, size_t len)', '{', '\tif (len > MAX_LEN)', '\t\treturn -EINVAL;',
  '\tmemcpy(dst, src, len);', '\tfor (i = 0; i < n; i++) {', '\t\tp = alloc(size, FLAGS);', '\t\tif (!p)', '\t\t\tgoto out;',
  '\t}', '\tspin_lock(&dev->lock);', '\tret = copy_from_user(buf, ubuf, count);', '\tif (ret)', '\t\tgoto unlock;',
  '\tidx = hdr->offset + hdr->size;', '\tdev->state = STATE_READY;', '\tspin_unlock(&dev->lock);', '\treturn 0;', '}',
  'int handle_request(struct req *rq)', '\tstruct page *pg = rq->page;', '\twhile (len--) {', '\t\t*dst++ = *src++;',
  '\tif (flags & F_USER)', '\t\tcheck_access(rq, MODE_RW);', '\tsize = round_up(size, PAGE_SIZE);', '\tnode->next = head;',
  '\thead = node;', '\tif (refcount_dec(&obj->ref))', '\t\tfree_obj(obj);', '\tbuf[pos] = 0;', '\tswitch (cmd) {',
  '\tcase CMD_READ:', '\t\tret = do_read(f, buf, n);', '\t\tbreak;', '\tdefault:', '\t\tret = -ENOTTY;', '\t}',
  'static void reset_queue(struct queue *q)', '\tq->head = q->tail = 0;', '\tmemset(q->slots, 0, sizeof(q->slots));',
  '\tif (uid != 0 && !capable(CAP_ADMIN))', '\t\treturn -EPERM;', '\ttimer_setup(&t, on_timeout, 0);', '',
];

function codeAtlas(seed, old = false) {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(Math.floor(seed * 1e5) + 7);
  const lh = H / ROWS;
  g.font = '600 15px "JetBrains Mono", monospace';
  g.textRendering = 'optimizeSpeed';   // без лигатур шрифта («->» не превращается в «→»)
  g.textBaseline = 'middle';
  const cw = g.measureText('M').width || 9;
  const pageW = W / PAGES, cellW = pageW / CPP;
  const mask = new Uint8Array(COLS * ROWS * 4);
  for (let p = 0; p < PAGES; p++) {
    let k = Math.floor(r() * CODE.length);
    for (let row = 0; row < ROWS; row++) {
      const line = CODE[k % CODE.length].replace(/\t/g, '    ');
      k += r() < 0.15 ? 1 + Math.floor(r() * 5) : 1;
      const x0 = p * pageW + 12;
      const y = H - (row + 0.5) * lh;              // строка 0 — внизу (совпадает с uv.y)
      const t = r();
      g.fillStyle = old ? (t < 0.75 ? '#a9b3a9' : '#dfe6df') : (t < 0.62 ? '#33ff33' : t < 0.86 ? '#9dff8f' : '#ffffff');
      g.fillText(line, x0, y);
      for (let cc = 0; cc < CPP; cc++) {
        const a = Math.floor((cc * cellW - 12) / cw), b = Math.floor(((cc + 1) * cellW - 12) / cw);
        const seg = line.slice(Math.max(0, a), Math.max(0, b));
        const idx = (row * COLS + p * CPP + cc) * 4;
        mask[idx] = seg.trim().length >= 3 ? 255 : 0;
        mask[idx + 1] = Math.floor(r() * 255);
        mask[idx + 2] = Math.floor(r() * 255);
        mask[idx + 3] = 255;
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const mt = new THREE.DataTexture(mask, COLS, ROWS, THREE.RGBAFormat);
  mt.wrapS = mt.wrapT = THREE.RepeatWrapping;
  mt.magFilter = mt.minFilter = THREE.NearestFilter;
  mt.needsUpdate = true;
  return { tex, mask: mt };
}

const TOWER_VERT = /* glsl */ `
uniform float uH;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vUv = uv;
  vY = position.y / uH + 0.5;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const TOWER_FRAG = /* glsl */ `
uniform sampler2D tCode, tMask;
uniform float uTime, uOpacity, uScan, uVuln, uSeed, uRepX, uRepY, uSpeed, uDim, uOld, uFocus;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vec2 uvA = vec2(vUv.x * uRepX, vUv.y * uRepY + uTime * uSpeed + uSeed);
  vec4 code = texture2D(tCode, uvA);
  vec4 m = texture2D(tMask, uvA);
  vec2 cf = fract(uvA * vec2(${COLS}.0, ${ROWS}.0));
  float box = step(0.03, cf.x) * step(cf.x, 0.97) * step(0.08, cf.y) * step(cf.y, 0.92);
  float edge = box * (1.0 - step(0.09, cf.x) * step(cf.x, 0.91) * step(0.2, cf.y) * step(cf.y, 0.8));
  float on = step(0.5, m.r) * step(m.g, uVuln);
  float fresh = 1.0 - smoothstep(0.0, 0.06, uVuln - m.g);
  float blink = 0.55 + 0.45 * sin(uTime * (3.0 + m.b * 4.0) + m.b * 40.0);
  float bd = (vY - uScan) / 0.04;                  // без pow() от отрицательного
  float band = exp(-bd * bd);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float rim = (1.0 - facing) * (1.0 - facing);
  float glyph = code.a;
  vec3 base = code.rgb * glyph * (0.42 + 0.9 * band) * (1.0 - uDim);
  vec3 red = vec3(1.5, 0.12, 0.08) * on * (box * 0.45 + edge * 0.9) * (blink + fresh * 2.5);
  vec3 col = base + red + uTint * rim * 0.4 * (1.0 - uDim * 0.6) + vec3(0.45, 1.2, 0.45) * band * 0.22 * (1.0 - uDim);
  col += vec3(0.6, 1.4, 0.6) * uFocus * rim * 0.5;
  float a = glyph * 0.85 + on * box * 0.55 + rim * 0.3 + band * 0.15;
  if (!gl_FrontFacing) { col *= 0.3; a *= 0.3; }
  float fadeY = smoothstep(0.0, 0.05, vY) * (1.0 - smoothstep(0.96, 1.0, vY));
  gl_FragColor = vec4(col * fadeY, clamp(a, 0.0, 1.0) * uOpacity * fadeY);
}
`;

const GRID_FRAG = /* glsl */ `
uniform float uOpacity, uTime;
varying vec3 vW;
void main() {
  vec2 p = vW.xz;
  vec2 g = abs(fract(p * 0.5 - 0.5) - 0.5) / fwidth(p * 0.5);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float d = length(p - vec2(7.0, -10.0));
  float fade = 1.0 - smoothstep(6.0, 34.0, d);
  float pulse = 0.6 + 0.4 * sin(d * 0.6 - uTime * 1.5);
  vec3 col = vec3(0.2, 0.9, 0.2) * line * fade * pulse;
  gl_FragColor = vec4(col, line * fade * 0.55 * uOpacity);
}
`;

const ORB_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const ORB_FRAG = /* glsl */ `
uniform float uTime, uOpacity, uDim;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${SIMPLEX}
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float n = snoise(vP * 1.9 + vec3(0.0, uTime * 0.35, uTime * 0.2));
  float n2 = snoise(vP * 4.6 - vec3(uTime * 0.3, 0.0, uTime * 0.25));
  float veins = 1.0 - abs(n2);
  veins = veins * veins * veins;
  vec3 deep = vec3(0.02, 0.16, 0.03);
  vec3 col = deep + vec3(0.12, 0.62, 0.16) * (0.3 + 0.7 * (0.5 + 0.5 * n)) + vec3(0.55, 0.95, 0.55) * veins * 0.42;
  col += vec3(0.3, 1.15, 0.4) * f * f * 1.1;
  col *= 1.0 - uDim * 0.8;
  gl_FragColor = vec4(col, uOpacity);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uOpacity, uTime;
varying vec2 vUv;
void main() {
  float flow = 0.55 + 0.45 * sin(vUv.y * 40.0 + uTime * 9.0);
  float a = uOpacity * flow * (0.35 + 0.65 * vUv.y);
  gl_FragColor = vec4(vec3(0.5, 1.5, 0.5) * a, a);
}
`;

function fragmentTexture() {
  const W = 1024, H = 640;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(27);
  g.fillStyle = 'rgba(14,16,14,0.92)';
  g.beginPath(); g.roundRect?.(0, 0, W, H, 28); if (!g.roundRect) g.rect(0, 0, W, H); g.fill();
  g.strokeStyle = 'rgba(190,200,190,0.55)';
  g.lineWidth = 4;
  g.beginPath(); g.roundRect?.(2, 2, W - 4, H - 4, 26); if (!g.roundRect) g.rect(2, 2, W - 4, H - 4); g.stroke();
  // «шапка» окна
  g.fillStyle = 'rgba(190,200,190,0.18)';
  g.fillRect(4, 4, W - 8, 64);
  [0, 1, 2].forEach((i) => { g.fillStyle = 'rgba(200,210,200,0.6)'; g.beginPath(); g.arc(44 + i * 40, 36, 11, 0, TAU); g.fill(); });
  const lines = ['int', 'check_len(struct buf *bp, int len)', '{', '\tif (len < 0)', '\t\treturn (EINVAL);', '\tbcopy(bp->b_data, dst, len + 1);', '\treturn (0);', '}'];
  g.font = '600 46px "JetBrains Mono", monospace';
  g.textRendering = 'optimizeSpeed';   // без лигатур шрифта («->» не превращается в «→»)
  g.textBaseline = 'middle';
  const y0 = 120, lh = 64;
  // подсветка «ошибки»
  g.fillStyle = 'rgba(255,59,48,0.28)';
  g.fillRect(16, y0 + 5 * lh - lh / 2, W - 32, lh);
  g.fillStyle = 'rgba(255,59,48,0.95)';
  g.fillRect(16, y0 + 5 * lh - lh / 2, 10, lh);
  lines.forEach((l, i) => {
    g.fillStyle = i === 5 ? '#ffd9d6' : '#b9c4b9';
    g.fillText(l.replace(/\t/g, '    '), 48, y0 + i * lh);
  });
  // «пыль» и царапины
  for (let i = 0; i < 2600; i++) {
    const a = r() * 0.35;
    g.fillStyle = `rgba(${200 + r() * 40},${200 + r() * 40},${190 + r() * 40},${a.toFixed(3)})`;
    const s = r() < 0.92 ? 1 + r() * 2 : 3 + r() * 5;
    g.fillRect(r() * W, r() * H, s, s);
  }
  g.strokeStyle = 'rgba(220,225,215,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const x = r() * W, y = r() * H;
    g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 300, y + (r() - 0.5) * 80);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H, bugY: (y0 + 5 * lh) / H };
}

export default class Cyber extends Visual {
  static transition = 'glitch';

  async init() {
    const r = rng(2026);
    this.haloTex = glowTexture(128);
    this.vuln = { v: 0 };
    this.dim = { v: 0 };
    this.focus = { v: 0 };

    // ---------- Башни кода ----------
    // три общих атласа (две «зелёные» страницы и одна старая) — башни сдвигают их по-разному (uSeed)
    const atlases = [];
    for (const [seed, old] of [[0.13, false], [0.52, false], [0.71, true]]) { atlases.push(codeAtlas(seed, old)); await idle(); }
    this.towers = TOWERS.map((T, i) => {
      const { tex, mask } = atlases[T.old ? 2 : i % 2];
      const repX = Math.max(1, Math.round((TAU * T.r) / ATLAS_W));
      const u = {
        tCode: { value: tex }, tMask: { value: mask }, uTime: { value: 0 }, uOpacity: { value: 1 },
        uScan: { value: 0.5 }, uVuln: { value: 0 }, uSeed: { value: T.seed * 7.3 }, uRepX: { value: repX },
        uRepY: { value: T.h / ATLAS_W }, uSpeed: { value: T.old ? 0.006 : 0.025 + 0.01 * (i % 3) }, uDim: { value: 0 },
        uOld: { value: T.old ? 1 : 0 }, uFocus: { value: 0 }, uH: { value: T.h },
        uTint: { value: T.old ? new THREE.Color(0.7, 0.75, 0.7) : new THREE.Color(0.3, 1.0, 0.35) },
      };
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(T.r, T.r, T.h, 72, 1, true),
        new THREE.ShaderMaterial({ uniforms: u, vertexShader: TOWER_VERT, fragmentShader: TOWER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      const g = new THREE.Group();
      g.position.set(T.x, GROUND + T.h / 2, T.z);
      g.add(mesh);
      const ringCol = T.old ? new THREE.Color(0.6, 0.65, 0.6) : new THREE.Color(0.35, 1.3, 0.35);
      [-1, 1].forEach((s) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(T.r, 0.035, 8, 96), glowMat(ringCol, 0.9));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = (s * T.h) / 2;
        g.add(ring);
      });
      this.root.add(g);
      return { T, g, mesh, u, phase: r() * TAU, speed: 0.5 + r() * 0.5 };
    });
    this.linux = this.towers[0];
    this.bsd = this.towers[1];

    // ---------- Сетка «земли» ----------
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: GRID_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = GROUND - 0.02;
    this.grid = grid;
    this.root.add(grid);

    // ---------- Сфера-модель Mythos ----------
    this.orbU = { uTime: { value: 0 }, uOpacity: { value: 1 }, uDim: { value: 0 } };
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(1.0, 64, 48), new THREE.ShaderMaterial({ uniforms: this.orbU, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, transparent: true }));
    this.orb.position.copy(ORB);
    this.root.add(this.orb);
    this.orbRings = [1.55, 1.95].map((rad, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.014, 8, 160), glowMat(new THREE.Color(0.4, 1.4, 0.4), 0.8));
      m.position.copy(ORB);
      m.rotation.set(1.2 + i * 0.4, 0.3 - i * 0.7, 0);
      this.root.add(m);
      return m;
    });
    this.orbHalo = haloSprite(this.haloTex, new THREE.Color(0.25, 0.9, 0.3), 5.5, 0.35);
    this.orbHalo.position.copy(ORB).add(new THREE.Vector3(0, 0, -0.8));
    this.orbHalo.material.userData.noFade = true;
    this.root.add(this.orbHalo);

    // ---------- Лучи сканирования ----------
    this.beamU = { uOpacity: { value: 0.5 }, uTime: { value: 0 } };
    const beamMat = new THREE.ShaderMaterial({
      uniforms: this.beamU,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    beamMat.userData.noFade = true; // прозрачность ведёт update() (с учётом общей)
    const beamGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beams = this.towers.map(() => {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.frustumCulled = false;
      this.root.add(b);
      return b;
    });
    this.hits = this.towers.map(() => {
      const h = haloSprite(this.haloTex, new THREE.Color(0.5, 1.6, 0.5), 0.9, 0.9);
      h.material.userData.noFade = true;
      this.root.add(h);
      return h;
    });

    // ---------- Цепочка дыр в ядре Linux ----------
    this.buildChain();

    // ---------- «Пыльный» фрагмент кода OpenBSD ----------
    const fr = fragmentTexture();
    this.frag = new THREE.Group();
    const fw = 3.9, fh = fw / fr.aspect;
    const fragMesh = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshBasicMaterial({ map: fr.tex, transparent: true, depthWrite: true, alphaTest: 0.05, side: THREE.DoubleSide }));
    fragMesh.material.color.setScalar(0.82);
    fragMesh.material.userData.noFade = true;
    this.frag.add(fragMesh);
    const hl = new THREE.Mesh(new THREE.PlaneGeometry(fw * 0.97, fh / 10), glowMat(new THREE.Color(1.4, 0.15, 0.1), 0));
    hl.material.userData.noFade = true;
    hl.position.set(0, (0.5 - fr.bugY) * fh, 0.01);
    this.fragHL = hl;
    this.frag.add(hl);
    const B = this.bsd.T;
    const bsdCam = this.camBSD();
    const dirB = new THREE.Vector3(bsdCam.pos[0] - B.x, 0, bsdCam.pos[2] - B.z).normalize();
    this.fragOut = new THREE.Vector3(B.x, 0.35, B.z).addScaledVector(dirB, B.r + 1.7);
    this.fragIn = new THREE.Vector3(B.x, 0.35, B.z).addScaledVector(dirB, B.r * 0.6);
    this.frag.position.copy(this.fragIn);
    this.frag.lookAt(new THREE.Vector3(...bsdCam.pos));
    this.frag.scale.setScalar(0.001);
    this.frag.visible = false;
    this.root.add(this.frag);
    this.fragK = { v: 0 };

    // ---------- Замок ----------
    this.buildLock();

    // ---------- Частицы ----------
    await idle();
    await this.buildShapes();
  }

  // Цепочка: узлы на поверхности башни поднимаются по спирали — от пользователя до полного контроля
  buildChain() {
    const T = this.linux.T;
    const c = this.camLinux();
    const th = Math.atan2(c.pos[2] - T.z, c.pos[0] - T.x);
    const cy = GROUND + T.h / 2;
    this.chainNodes = [];
    const pts = [];
    for (let k = 0; k < 5; k++) {
      const a = th + 0.62 - k * 0.31;
      const y = cy - 2.35 + k * 1.15;
      const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const p = new THREE.Vector3(T.x, y, T.z).addScaledVector(n, T.r + 0.04);
      pts.push({ p, n });
    }
    this.chainPts = pts;
    this.chain = new THREE.Group();
    this.root.add(this.chain);
    const holeGeo = new THREE.CircleGeometry(0.3, 40);
    pts.forEach(({ p, n }, k) => {
      const g = new THREE.Group();
      g.position.copy(p);
      g.lookAt(p.clone().add(n));
      const start = k === 0, end = k === 4;
      const col = start ? new THREE.Color(0.6, 1.6, 0.6) : new THREE.Color(1.7, 0.18, 0.12);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(end ? 0.48 : 0.36, end ? 0.06 : 0.045, 10, 64), glowMat(col, 1));
      ring.material.userData.noFade = true;
      g.add(ring);
      if (!start) {
        const hole = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.92 }));
        hole.position.z = 0.01;
        if (end) hole.scale.setScalar(1.3);
        g.add(hole);
      } else {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), glowMat(new THREE.Color(1.2, 1.7, 1.2), 1));
        dot.material.userData.noFade = true;
        dot.position.z = 0.01;
        g.add(dot);
      }
      const glow = haloSprite(this.haloTex, col.clone().multiplyScalar(0.6), end ? 2.6 : 1.7, 0);
      glow.material.userData.noFade = true;
      g.add(glow);
      g.scale.setScalar(0.001);
      this.chain.add(g);
      this.chainNodes.push({ g, ring, glow, s: { v: 0 } });
    });
    // стрелки-дуги между узлами
    this.chainArcs = [];
    for (let k = 0; k < 4; k++) {
      const A = pts[k].p, Bp = pts[k + 1].p;
      const mid = A.clone().add(Bp).multiplyScalar(0.5);
      const nm = pts[k].n.clone().add(pts[k + 1].n).normalize();
      const ctrl = mid.addScaledVector(nm, 0.95);
      const a0 = A.clone().addScaledVector(pts[k].n, 0.05), b0 = Bp.clone().addScaledVector(pts[k + 1].n, 0.05);
      const curve = new THREE.QuadraticBezierCurve3(a0, ctrl, b0);
      const tub = 60, rad = 8;
      const geo = new THREE.TubeGeometry(curve, tub, 0.045, rad, false);
      geo.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geo, glowMat(new THREE.Color(1.6, 0.35, 0.25), 1));
      mesh.material.userData.noFade = true;
      this.chain.add(mesh);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 18), glowMat(new THREE.Color(1.7, 0.4, 0.3), 1));
      head.material.userData.noFade = true;
      head.visible = false;
      this.chain.add(head);
      const pulse = haloSprite(this.haloTex, new THREE.Color(1.6, 0.6, 0.4), 0.55, 0);
      pulse.material.userData.noFade = true;
      this.chain.add(pulse);
      this.chainArcs.push({ curve, geo, mesh, head, pulse, tub, rad, p: { v: 0 } });
    }
  }

  buildLock() {
    const env = this.ctx.engine.envMap;
    const metal = new THREE.MeshStandardMaterial({ color: '#c5cfc5', metalness: 0.9, roughness: 0.32, envMap: env, envMapIntensity: 1.1, emissive: '#061a06', transparent: true });
    const lock = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.38, 0.62, 5, 0.16), metal);
    lock.add(body);
    // дужка: две «ноги» и полукольцо
    const shackle = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.9, 24);
    const legL = new THREE.Mesh(legGeo, metal); legL.position.set(-0.52, 0.45, 0);
    const legR = new THREE.Mesh(legGeo, metal); legR.position.set(0.52, 0.45, 0);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.12, 20, 48, Math.PI), metal);
    arc.position.y = 0.9;
    shackle.add(legL, legR, arc);
    // поворот вокруг левой ноги: сдвинем пивот
    const pivot = new THREE.Group();
    pivot.position.set(-0.52, 0.55, 0);
    shackle.position.set(0.52, -0.55, 0);
    pivot.add(shackle);
    lock.add(pivot);
    // скважина и светящийся ободок
    const keyMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true });
    const keyCirc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), keyMat);
    keyCirc.position.set(0, 0.06, 0.312);
    const keySlot = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.36), keyMat);
    keySlot.position.set(0, -0.16, 0.312);
    const keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 8, 64), glowMat(new THREE.Color(0.4, 1.5, 0.4), 1));
    keyRing.material.userData.noFade = true;
    keyRing.position.set(0, -0.02, 0.315);
    lock.add(keyCirc, keySlot, keyRing);
    const halo = haloSprite(this.haloTex, new THREE.Color(0.3, 1.1, 0.35), 4.2, 0);
    halo.material.userData.noFade = true;
    halo.position.z = -0.6;
    lock.add(halo);
    const shock = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 128), glowMat(new THREE.Color(0.6, 1.6, 0.6), 0));
    shock.material.userData.noFade = true;
    lock.add(shock);
    lock.position.copy(ORB).add(new THREE.Vector3(-0.15, -0.35, 2.0));
    lock.scale.setScalar(0.001);
    lock.visible = false;
    this.root.add(lock);
    this.lock = { g: lock, pivot, keyRing, halo, shock, open: { v: 1 }, s: { v: 0 }, k: { v: 0 }, flash: { v: 0 } };
  }

  async buildShapes() {
    const n = this.ctx.particles.count;
    const r = rng(404);
    const nBg = Math.floor(n * 0.42);
    const bg = [];
    for (let i = 0; i < nBg; i++) {
      bg.push([r.range(-30, 42), r.range(GROUND, 18), r.range(-50, 6), Math.pow(r(), 4) * 1.8 + 0.35, r() < 0.8 ? S.PAL.white : S.PAL.mint, r.range(0.05, 0.22)]);
    }
    const mk = (fill, origin) => {
      const s = S.createShape(n);
      for (let i = 0; i < nBg; i++) {
        const b = bg[i];
        S.setPoint(s, i, b[0] - origin.x, b[1] - origin.y, b[2] - origin.z, b[3], b[4], b[5]);
      }
      const rr = rng(9);
      for (let i = nBg; i < n; i++) fill(s, i, rr);
      return S.equalize(s, { cell: 0.12, target: 7 });
    };
    // 0/1: «аккреционный диск» данных вокруг сферы (1 — с красными искрами)
    const disk = (red) => (s, i, rr) => {
      const t = rr();
      const rad = 1.6 + Math.pow(rr(), 0.7) * 3.6;
      const a = rr() * TAU;
      const y = rr.gauss(0, 0.08 + 0.05 * rad);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      // наклон диска
      const ty = y * Math.cos(0.32) - z * Math.sin(0.32), tz = y * Math.sin(0.32) + z * Math.cos(0.32);
      const q = rr(), q2 = rr(), sz = rr.range(0.5, 1.1), al = rr.range(0.18, 0.5);
      const isRed = red && q < 0.32;
      const c = isRed ? (q2 < 0.4 ? S.PAL.red : S.scaleColor(S.PAL.red, 1.4)) : t < 0.5 ? S.PAL.green : t < 0.75 ? S.PAL.mint : S.PAL.white;
      S.setPoint(s, i, x, ty, tz, sz, c, al * (isRed ? 1.2 : 1));
    };
    this.shape0 = mk(disk(false), ORB);
    await idle();
    this.shape1 = mk(disk(true), ORB);
    await idle();
    // 2: красный поток вдоль цепочки атаки (координаты — от центра башни Linux)
    const L = new THREE.Vector3(this.linux.T.x, GROUND + this.linux.T.h / 2, this.linux.T.z);
    const v = new THREE.Vector3();
    this.shape2 = mk((s, i, rr) => {
      const t = rr();
      if (t < 0.7) {
        const arc = this.chainArcs[Math.floor(rr() * 4)];
        arc.curve.getPoint(rr(), v);
        const sd = 0.05 + rr() * 0.08;
        const c = rr() < 0.6 ? S.PAL.red : rr() < 0.5 ? S.scaleColor(S.PAL.red, 1.5) : S.PAL.warm;
        S.setPoint(s, i, v.x - L.x + rr.gauss(0, sd), v.y - L.y + rr.gauss(0, sd), v.z - L.z + rr.gauss(0, sd), rr.range(0.45, 0.9), c, rr.range(0.2, 0.5));
      } else {
        // мерцающая «пыль» у поверхности башни
        const a = rr() * TAU, y = rr.range(-4.4, 4.4);
        const R = this.linux.T.r + 0.15 + rr() * 0.5;
        S.setPoint(s, i, Math.cos(a) * R, y, Math.sin(a) * R, rr.range(0.4, 0.8), rr() < 0.3 ? S.PAL.red : S.PAL.green, rr.range(0.06, 0.18));
      }
    }, L);
    this.originL = L;
    await idle();
    // 3: «пыль» вокруг старого фрагмента
    this.shape3 = mk((s, i, rr) => {
      const [x, y, z] = rr.inSphere(1);
      const k = rr();
      const c = k < 0.7 ? S.PAL.grey : k < 0.9 ? S.PAL.warm : S.PAL.white;
      const zz = z * 1.7 - 1.5 - Math.max(0, z) * 0.6;
      S.setPoint(s, i, x * 3.6, y * 2.3, zz, rr.range(0.35, 1.0), c, rr.range(0.05, 0.2));
    }, this.fragOut);
    await idle();
    // 4: защитная оболочка вокруг сферы
    this.shape4 = mk((s, i, rr) => {
      const t = rr();
      if (t < 0.78) {
        const [x, y, z] = rr.onSphere(2.45 + rr.gauss(0, 0.04));
        const c = rr() < 0.35 ? S.PAL.greenHi : rr() < 0.6 ? S.PAL.green : S.PAL.white;
        S.setPoint(s, i, x, y, z, rr.range(0.45, 0.9), c, rr.range(0.16, 0.4));
      } else {
        const a = rr() * TAU, rad = 2.95 + rr.gauss(0, 0.05);
        const x = Math.cos(a) * rad, y0 = rr.gauss(0, 0.03), z = Math.sin(a) * rad;
        S.setPoint(s, i, x, y0 * Math.cos(0.55) - z * Math.sin(0.55), y0 * Math.sin(0.55) + z * Math.cos(0.55), rr.range(0.5, 1.0), rr() < 0.5 ? S.PAL.greenHi : S.PAL.white, rr.range(0.2, 0.45));
      }
    }, ORB);
  }

  // ---------- Камера ----------
  camLinux() {
    const T = TOWERS[0];
    return { pos: [T.x - 3.8, 1.0, T.z + 10.6], target: [T.x - 1.35, 0.35, T.z], fov: 45 };
  }
  camBSD() {
    const T = TOWERS[1];
    return { pos: [T.x - 3.6, 1.2, T.z + 8.6], target: [T.x - 1.6, 0.45, T.z], fov: 45 };
  }

  // Позы — для 16:9 (под другие экраны их подгоняет ядро).
  camera(state, step) {
    if (step <= 0) return { pos: [2.4, 2.6, 15.5], target: [6.2, 0.6, -7], fov: 45 };
    if (step === 1) return { pos: [3.6, 2.2, 13.2], target: [7.0, 0.4, -7], fov: 45, duration: 2.0 };
    if (step === 2) return { ...this.camLinux(), duration: 2.0, arc: 0.1 };
    if (step === 3) return { ...this.camBSD(), duration: 2.4, arc: 0.18 };
    return { pos: [ORB.x - 4.4, ORB.y + 1.3, ORB.z + 10.5], target: [ORB.x - 1.1, ORB.y - 0.45, ORB.z], fov: 45, duration: 2.2, arc: 0.15 };
  }

  background(state, step) { return step >= 4 ? 'soft' : step >= 1 ? 'danger' : 'corners'; }

  // ---------- Жизненный цикл ----------
  enter(o = {}) {
    this.state = o.state;
    this.step = o.step ?? 0;
    this.claimParticles();
    this.removeLabels();
    const T0 = this.linux.T, T1 = this.bsd.T;
    const P = this.chainPts;
    this.lbl = {
      orb: this.label({ html: '<span class="tag b4-cy-tag">Mythos</span>', position: [ORB.x, ORB.y + 1.45, ORB.z], anchor: 'bottom', visible: false }),
      // под верхним кольцом башни, на обращённой к камере стороне (над башней подпись ушла бы за кадр)
      linux: this.label({ html: '<span class="tag b4-cy-tag">Ядро Linux</span>', position: [T0.x - 0.34 * T0.r, GROUND + T0.h - 0.3, T0.z + 0.94 * T0.r], anchor: 'top', visible: false }),
      user: this.label({ html: '<span class="tag b4-cy-tag">Обычный пользователь</span>', position: [P[0].p.x + 0.55, P[0].p.y - 0.05, P[0].p.z], anchor: 'left', visible: false }),
      root: this.label({ html: '<span class="tag b4-cy-tag is-red">Полный контроль над машиной</span>', position: [P[4].p.x, P[4].p.y + 0.72, P[4].p.z], anchor: 'bottom', visible: false }),
      bsd: this.label({ html: '<span class="tag b4-cy-tag">OpenBSD</span>', position: [T1.x, GROUND + T1.h + 0.35, T1.z], anchor: 'bottom', visible: false }),
    };
    this.holeLabels = [1, 2, 3].map((k) => this.label({ html: `<span class="b4-cy-hole">${k}</span>`, position: [P[k].p.x - 0.62, P[k].p.y, P[k].p.z], anchor: 'right', visible: false }));
    this.lastShape = -1;
    this.lock.target = undefined;
    // состояние прошлого показа: то, чего на шаге входа быть не должно, убираем сразу
    const st = this.step;
    if (st < 1) this.vuln.v = 0;
    if (st !== 2) { this.chainNodes.forEach((n) => { n.s.v = 0; }); this.chainArcs.forEach((a) => { a.p.v = 0; }); }
    if (st !== 3) { this.fragK.v = 0; this.frag.visible = false; this.focus.v = 0; }
    if (st < 4) { const L = this.lock; L.s.v = 0; L.open.v = 1; L.k.v = 0; L.flash.v = 0; L.g.visible = false; this.dim.v = 0; }
    this.apply(this.step, { ...o, entering: true });
    return super.enter(o);
  }

  setStep(step, o = {}) {
    this.step = step;
    this.apply(step, o);
  }

  apply(step, o = {}) {
    const instant = !!o.instant;
    const fwd = (o.dir ?? 1) >= 0;
    const fresh = !instant && fwd && !o.entering;
    const p = this.particles;
    const obj = p.object;
    // ---- частицы: форма и «якорь» облака на шаг
    const sk = Math.min(step, 4);
    if (sk !== this.lastShape) {
      const shapes = [this.shape0, this.shape1, this.shape2, this.shape3, this.shape4];
      const anchors = [ORB, ORB, this.originL, this.fragOut, ORB];
      const same01 = (this.lastShape === 0 && sk === 1) || (this.lastShape === 1 && sk === 0);
      p.morph(shapes[sk], { duration: instant ? 0.01 : same01 ? 1.2 : 2.0, stagger: same01 ? 0.7 : 0.5, burst: same01 ? 3 : 8, keepSwirl: same01 });
      const a = anchors[sk];
      const d = instant ? 0 : 1.8;
      this.tw(obj.position, { x: a.x, y: a.y, z: a.z, duration: d, ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(obj.rotation, { x: 0, y: 0, z: 0, duration: d, ease: 'power2.inOut', overwrite: 'auto' });
      this.tw(obj.scale, { x: 1, y: 1, z: 1, duration: d, ease: 'power2.inOut', overwrite: 'auto' });
      const swirl = sk <= 1 ? 0.28 : sk === 3 ? 0.03 : sk === 4 ? 0.12 : 0;
      p.setParams({ swirl, noise: sk === 3 ? 0.7 : 0.18, size: 0.058, twinkle: 0.4, spring: sk === 3 ? 6 : 15, damping: 5.5, flow: [0, 0, 0] }, instant ? 0 : 1);
      if (sk === 1 && fresh) p.explode(5, [0, 0, 0]);
      this.lastShape = sk;
    }
    // ---- уязвимости
    const vT = step >= 1 ? 0.42 : 0;
    this.tw(this.vuln, { v: vT, duration: instant ? 0 : step >= 1 && fresh && step === 1 ? 2.4 : 0.8, ease: 'power1.in', overwrite: true });
    if (step === 1 && fresh) {
      this.ctx.engine.pulse({ glitch: 0.55, aberration: 1.4 }, 0.9);
      this.ctx.rig.shake(0.12, 0.6);
    }
    // ---- цепочка атаки
    const chainOn = step === 2;
    this.chainNodes.forEach((nd, k) => {
      const want = chainOn ? 1 : 0;
      const delay = chainOn && fresh && step === 2 ? 0.9 + k * 0.55 : 0;
      this.tw(nd.s, { v: want, duration: instant ? 0 : want ? 0.6 : 0.4, delay, ease: want ? 'back.out(2)' : 'power2.in', overwrite: true });
    });
    this.chainArcs.forEach((a, k) => {
      const want = chainOn ? 1 : 0;
      const delay = chainOn && fresh && step === 2 ? 1.15 + k * 0.55 : 0;
      this.tw(a.p, { v: want, duration: instant ? 0 : want ? 0.5 : 0.35, delay, ease: 'power1.inOut', overwrite: true });
    });
    if (step === 2 && fresh) this.delay(3.4, () => { if (this.step === 2) { this.ctx.engine.pulse({ aberration: 1.2, flash: 0.08 }, 0.7); this.ctx.rig.shake(0.08, 0.5); } });
    // ---- фрагмент OpenBSD
    const fragOn = step === 3;
    if (fragOn) this.frag.visible = true;
    this.tw(this.fragK, { v: fragOn ? 1 : 0, duration: instant ? 0 : fragOn ? 1.6 : 0.6, delay: fragOn && !instant ? 0.9 : 0, ease: fragOn ? 'power3.out' : 'power2.in', overwrite: true,
      onComplete: () => { if (this.fragK.v < 0.01) this.frag.visible = false; } });
    this.tw(this.focus, { v: step === 3 ? 1 : 0, duration: instant ? 0 : 1.2, overwrite: true });
    // ---- замок и «приглушение» города
    const locked = step >= 4;
    this.tw(this.dim, { v: locked ? 0.6 : 0, duration: instant ? 0 : 1.6, overwrite: true });
    const L = this.lock;
    if (locked && (L.target !== 1 || instant)) {
      L.target = 1;
      L.g.visible = true;
      if (instant || !fwd || L.s.v >= 0.5) {
        this.tw(L.s, { v: 1, duration: instant ? 0 : 0.5, ease: 'power2.out', overwrite: true });
        this.tw(L.open, { v: 0, duration: instant ? 0 : 0.3, overwrite: true });
        this.tw(L.k, { v: 1, duration: instant ? 0 : 0.5, overwrite: true });
      }
      else {
        L.open.v = 1;
        this.fromTo(L.s, { v: 0.001 }, { v: 1, duration: 1.1, delay: 0.9, ease: 'back.out(1.7)', overwrite: true });
        this.fromTo(L.k, { v: 0 }, { v: 1, duration: 1.1, delay: 0.9, ease: 'power3.out', overwrite: true });
        this.tw(L.open, { v: 0, duration: 0.32, delay: 2.35, ease: 'power3.in', overwrite: true, onComplete: () => this.snapLock() });
      }
    } else if (!locked && (L.target !== 0 || instant)) {
      L.target = 0;
      this.tw(L.s, { v: 0, duration: instant ? 0 : 0.5, ease: 'power2.in', overwrite: true, onComplete: () => { if (this.step < 4) L.g.visible = false; } });
      this.tw(L.open, { v: 1, duration: instant ? 0 : 0.3, overwrite: true });
    }
  }

  toggle(l, want) { if (l && want !== l.visible) { if (want) l.show(); else l.hide(); } }

  snapLock() {
    if (this.step < 4) return;
    const L = this.lock;
    this.fromTo(L.flash, { v: 1 }, { v: 0, duration: 1.4, ease: 'power2.out', overwrite: true });
    this.ctx.engine.pulse({ flash: 0.2, aberration: 0.8 }, 0.7);
    this.ctx.rig.shake(0.1, 0.45);
    this.ctx.background.surge(0.6, 1.4);
    this.particles.explode(3, [0, 0, 0]);
  }

  exit(o = {}) {
    Object.values(this.lbl || {}).forEach((l) => l.hide());
    (this.holeLabels || []).forEach((l) => l.hide());
    const p = super.exit(o);
    p.then(() => { if (!this.active) this.removeLabels(); });
    return p;
  }

  // ---------- Кадр ----------
  update(dt, t) {
    const op = this.opacity;
    const dim = this.dim.v;
    // башни
    this.towers.forEach((tw, i) => {
      const u = tw.u;
      u.uTime.value = t;
      u.uScan.value = 0.5 + 0.47 * Math.sin(t * 0.55 * tw.speed + tw.phase);
      u.uVuln.value = this.vuln.v;
      u.uDim.value = dim;
      u.uFocus.value = i === 1 ? this.focus.v : 0;
    });
    this.grid.material.uniforms.uTime.value = t;
    // сфера
    this.orbU.uTime.value = t;
    this.orbU.uDim.value = clamp(dim * 1.5, 0, 1);
    this.orb.rotation.y += dt * 0.15;
    this.orbRings[0].rotation.z += dt * 0.5;
    this.orbRings[1].rotation.z -= dt * 0.35;
    this.orbHalo.material.opacity = op * (0.32 - dim * 0.15);
    // лучи сканирования (гаснут, когда модель закрыта)
    const beamK = (1 - clamp(dim / 0.55, 0, 1)) * op;
    this.beamU.uTime.value = t;
    this.beamU.uOpacity.value = 0.42 * beamK;
    const v = (this._v ||= new THREE.Vector3());
    const d = (this._d ||= new THREE.Vector3());
    const up = (this._up ||= new THREE.Vector3(0, 1, 0));
    this.towers.forEach((tw, i) => {
      const T = tw.T;
      const y = GROUND + T.h * tw.u.uScan.value;
      d.set(ORB.x - T.x, 0, ORB.z - T.z).normalize();
      v.set(T.x, y, T.z).addScaledVector(d, T.r);
      const b = this.beams[i];
      d.copy(v).sub(ORB);
      const len = d.length();
      b.position.copy(ORB);
      b.quaternion.setFromUnitVectors(up, d.multiplyScalar(1 / Math.max(1e-4, len)));
      b.scale.set(1, len, 1);
      b.visible = beamK > 0.01;
      const h = this.hits[i];
      h.position.copy(v);
      h.material.opacity = beamK * (0.6 + 0.4 * Math.sin(t * 7 + i));
      h.visible = b.visible;
    });
    // цепочка
    this.chainNodes.forEach((nd, k) => {
      const s = nd.s.v;
      nd.g.visible = s > 0.002;
      nd.g.scale.setScalar(Math.max(0.001, s));
      nd.ring.material.opacity = op * (0.85 + 0.15 * Math.sin(t * 5 + k));
      nd.glow.material.opacity = op * s * (k === 4 ? 0.55 + 0.35 * Math.sin(t * 4) : 0.4);
    });
    this.chainArcs.forEach((a, k) => {
      const pv = a.p.v;
      a.geo.setDrawRange(0, Math.round(pv * a.tub) * a.rad * 6);
      a.mesh.visible = pv > 0.001;
      a.mesh.material.opacity = op;
      // наконечник стрелки — в конце нарисованной части (пересчёт — только пока стрелка «рисуется»;
      // getTangent у кривых three создаёт временные векторы, поэтому касательную считаем по двум точкам сами)
      if (pv > 0.02) {
        const tt = Math.min(1, pv);
        if (a._tt !== tt) {
          a._tt = tt;
          a.curve.getPoint(tt, v);
          a.curve.getPoint(Math.max(0, tt - 0.002), d);
          d.subVectors(v, d).normalize();
          a.head.position.copy(v);
          a.head.quaternion.setFromUnitVectors(up, d);
        }
        a.head.visible = true;
        a.head.material.opacity = op;
      } else { a.head.visible = false; a._tt = -1; }
      // бегущий импульс
      if (pv >= 1) {
        const ph = (t * 0.9 + k * 0.25) % 1;
        a.curve.getPoint(ph, v);
        a.pulse.position.copy(v);
        a.pulse.material.opacity = op * 0.9 * Math.sin(Math.PI * ph);
      } else a.pulse.material.opacity = 0;
    });
    // фрагмент OpenBSD
    if (this.frag.visible) {
      const k = this.fragK.v;
      this.frag.position.lerpVectors(this.fragIn, this.fragOut, k);
      this.frag.scale.setScalar(Math.max(0.001, 0.4 + 0.6 * k));
      this.frag.children[0].material.opacity = op * k;
      this.fragHL.material.opacity = op * k * (0.25 + 0.25 * Math.sin(t * 5));
    }
    // замок
    const L = this.lock;
    if (L.g.visible) {
      const s = L.s.v;
      L.g.scale.setScalar(Math.max(0.001, s));
      L.g.position.set(ORB.x - 0.15, ORB.y - 0.35 + (1 - L.k.v) * 2.6, ORB.z + 2.0);
      L.g.rotation.y = Math.sin(t * 0.5) * 0.18 + (1 - L.k.v) * 1.4;
      L.pivot.position.y = 0.55 + L.open.v * 0.42;
      L.pivot.rotation.y = L.open.v * -0.9;
      const f = L.flash.v;
      L.halo.material.opacity = op * s * (0.3 + 0.6 * f);
      L.keyRing.material.opacity = op * (0.6 + 0.4 * Math.sin(t * 3)) * (1 - L.open.v * 0.7);
      L.shock.visible = f > 0.01;
      L.shock.scale.setScalar(1 + (1 - f) * 3.5);
      L.shock.material.opacity = op * f;
    }
    // подписи по шагам
    if (this.lbl && this.active) {
      const st = this.step;
      this.toggle(this.lbl.orb, st <= 1 || st === 4);
      this.toggle(this.lbl.linux, st === 2);
      this.toggle(this.lbl.user, st === 2 && this.chainNodes[0].s.v > 0.8);
      this.toggle(this.lbl.root, st === 2 && this.chainNodes[4].s.v > 0.8);
      this.toggle(this.lbl.bsd, st === 3);
      for (let k = 0; k < this.holeLabels.length; k++) this.toggle(this.holeLabels[k], st === 2 && this.chainNodes[k + 1].s.v > 0.8);
    }
  }
}
