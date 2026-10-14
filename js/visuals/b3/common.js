// Общие помощники визуализаций блока 3: светящийся пол-сетка (с «беговой дорожкой» и пятнами опоры лапок),
// луч-связь с бегущими импульсами, подготовка форм облака частиц.
import * as THREE from 'three';
import { equalize, createShape } from '../../core/shapes.js';
import { HALFTONE } from '../../core/glsl.js';

/** Размер клетки халфтона в пикселях (как у фона). */
export function cellPx(engine) {
  return Math.max(5, (engine.height * engine.pixelRatio) / 150);
}

/** Выровнять плотность формы, которая будет увеличена в мире в scale раз. */
export function eqShape(s, scale = 1, target = 9) {
  return equalize(s, { cell: 0.12 / scale, target });
}

/** Копия формы с переносом/масштабом позиций (цвета и альфа сохраняются). */
export function placeShape(src, { scale = 1, offset = [0, 0, 0], matrix = null } = {}) {
  const s = createShape(src.count);
  s.colors.set(src.colors);
  const P = src.positions, Q = s.positions;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    const j = i * 4;
    if (matrix) {
      v.set(P[j], P[j + 1], P[j + 2]).applyMatrix4(matrix);
      Q[j] = v.x; Q[j + 1] = v.y; Q[j + 2] = v.z;
    } else {
      Q[j] = P[j] * scale + offset[0]; Q[j + 1] = P[j + 1] * scale + offset[1]; Q[j + 2] = P[j + 2] * scale + offset[2];
    }
    Q[j + 3] = P[j + 3];
  }
  s.meta = { ...(src.meta || {}) };
  return s;
}

// ---------------------------------------------------------------------------
// Пол-сетка

const FLOOR_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const FLOOR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uVis;
uniform float uOffset;
uniform vec2 uDir;
uniform vec2 uCenter;
uniform float uCellW;
uniform float uFade;
uniform float uCell;
uniform vec4 uFeet[6];
uniform float uFeetK;
varying vec3 vW;
${HALFTONE}
float gline(vec2 p, float w) {
  vec2 fw = max(fwidth(p), vec2(1e-4));
  vec2 g = abs(fract(p - 0.5) - 0.5) / fw;
  return 1.0 - min(min(g.x, g.y) / w, 1.0);
}
void main() {
  vec2 q = vW.xz + uDir * uOffset;
  vec2 p = q / uCellW;
  float major = gline(p, 1.4);
  float minor = gline(p * 4.0, 1.0) * 0.28;
  float d = length(vW.xz - uCenter);
  float fade = 1.0 - smoothstep(uFade * 0.25, uFade, d);
  float glow = exp(-d * d / (uFade * uFade * 0.12)) * 0.55;
  float ht = halftoneDot(gl_FragCoord.xy, uCell, glow * 0.75);
  float a = (max(major, minor) * 0.85 + ht * 0.32) * fade;
  vec3 col = uColor * (0.5 + major * 0.9);
  // пятна опоры лапок
  float feet = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 f = uFeet[i];
    if (f.z <= 0.001) continue;
    float r = length(vW.xz - f.xy);
    feet += f.z * (exp(-r * r / (f.w * f.w)) * 0.9 + exp(-pow(abs(r - f.w * 1.6) / (f.w * 0.35), 2.0)) * 0.6);
  }
  feet *= uFeetK;
  col += vec3(0.75, 1.0, 0.75) * feet * 1.4;
  a = clamp(a + feet, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uOpacity * uVis);
}
`;

export function makeFloor({ size = 80, color = '#00ff00', cell = 1.2, fade = 18, k = 0.55 } = {}) {
  const uniforms = {
    uColor: { value: new THREE.Color(color).multiplyScalar(k) },
    uOpacity: { value: 1 },
    uVis: { value: 1 },
    uOffset: { value: 0 },
    uDir: { value: new THREE.Vector2(0, 1) },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uCellW: { value: cell },
    uFade: { value: fade },
    uCell: { value: 7 },
    uFeet: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0.2)) },
    uFeetK: { value: 0 },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Луч-связь с импульсами (трубка вдоль кривой)

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSpeed;
uniform float uDash;
uniform float uFlow;
uniform float uReveal;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (vUv.x > uReveal) discard;
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(ndv, 1.5);
  float ph = fract(vUv.x * uDash - uTime * uSpeed);
  float pulse = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.1, 0.45, ph));
  float a = (0.22 + pulse * uFlow * 1.1) * (0.35 + 0.65 * core);
  float head = smoothstep(uReveal - 0.04, uReveal, vUv.x) * step(uReveal, 0.999);
  vec3 col = uColor * (0.55 + pulse * uFlow * 1.6 + head * 2.0);
  gl_FragColor = vec4(col, clamp(a + head, 0.0, 1.0) * uOpacity);
}
`;

/** Трубка-луч через точки pts (мировые/локальные Vector3). */
export function makeBeam(pts, { radius = 0.04, color = '#00ff00', segments = 96, dash = 6, speed = 0.9 } = {}) {
  const uniforms = {
    uColor: { value: new THREE.Color(color).multiplyScalar(1.1) },
    uOpacity: { value: 1 }, uTime: { value: 0 }, uSpeed: { value: speed }, uDash: { value: dash },
    uFlow: { value: 1 }, uReveal: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.frustumCulled = false;
  const beam = {
    mesh, uniforms, radius, segments,
    set(points) {
      const crv = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p))));
      const g = new THREE.TubeGeometry(crv, beam.segments, beam.radius, 8, false);
      mesh.geometry.dispose();
      mesh.geometry = g;
      beam.curve = crv;
    },
  };
  if (pts) beam.set(pts);
  return beam;
}
