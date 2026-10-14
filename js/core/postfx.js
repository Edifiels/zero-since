// Финальный проход пост-обработки: переходы между кадрами (халфтон, глитч, растворение),
// хроматическая аберрация, «варп»-размытие, вспышка, виньетка, зерно и светлая тема (инверсия яркости).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HASH } from './glsl.js';

// Режимы перехода (uMode)
export const TRANSITION_MODE = { fade: 1, halftone: 2, glitch: 3, iris: 4, wipe: 5, dissolve: 6 };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tSnap;
uniform vec2 uRes;
uniform float uTime, uMix, uAberration, uWarp, uFlash, uVignette, uGrain, uGlitch, uScan, uInvert, uCell, uDim, uSat;
uniform int uMode;
uniform vec3 uFlashColor, uPaper;
uniform vec2 uOrigin;
varying vec2 vUv;
${HASH}

const mat2 R45 = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
const mat2 R45i = mat2(0.70710678, 0.70710678, -0.70710678, 0.70710678);

float transitionMask(vec2 uv, float t, int mode) {
  float aspect = uRes.x / uRes.y;
  if (mode == 2) {
    // Халфтон: точки нового кадра растут волной от точки uOrigin, затем сливаются
    vec2 q = R45 * gl_FragCoord.xy / uCell;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 c = (R45i * ((id + 0.5) * uCell)) / uRes;
    float dist = length((c - uOrigin) * vec2(aspect, 1.0));
    float delay = dist * 0.55 + hash12(id) * 0.12;
    float k = clamp((t * 1.9 - delay) / 0.75, 0.0, 1.0);
    float r = 0.76 * k;
    float aa = 1.5 / uCell;
    float m = (1.0 - smoothstep(r - aa, r + aa, length(f))) * step(0.0001, k);
    return k >= 1.0 ? 1.0 : m;
  }
  if (mode == 3) {
    // Глитч: блоки разного размера переключаются вразнобой
    vec2 grid = vec2(18.0, 10.0) * (1.0 + floor(hash12(vec2(floor(t * 9.0), 3.0)) * 3.0));
    vec2 id = floor(uv * grid);
    float h = hash12(id + floor(t * 7.0) * 0.37);
    return step(h, t * 1.15 - 0.05);
  }
  if (mode == 4) {
    // Ирис: круг от точки uOrigin
    float d = length((uv - uOrigin) * vec2(aspect, 1.0));
    float r = t * 1.35 * max(aspect, 1.0);
    return 1.0 - smoothstep(r - 0.04, r, d);
  }
  if (mode == 5) {
    // Диагональная шторка с халфтон-кромкой
    vec2 q = R45 * gl_FragCoord.xy / uCell;
    vec2 f = fract(q) - 0.5;
    float x = (uv.x * aspect + (1.0 - uv.y)) / (aspect + 1.0);
    float edge = clamp((t * 1.3 - x) / 0.3, 0.0, 1.0);
    float r = 0.76 * edge;
    return (1.0 - smoothstep(r - 0.06, r + 0.06, length(f))) * step(0.0001, edge);
  }
  if (mode == 6) {
    // Шумовое растворение
    float n = hash12(floor(gl_FragCoord.xy / 3.0));
    return step(n, t);
  }
  return smoothstep(0.0, 1.0, t);
}

vec3 sceneAt(vec2 uv) {
  vec2 c = uv - 0.5;
  float ab = uAberration * 0.012;
  vec3 col = texture2D(tDiffuse, uv).rgb;
  if (ab > 0.00001) {
    col.r = texture2D(tDiffuse, uv - c * ab).r;
    col.b = texture2D(tDiffuse, uv + c * ab).b;
  }
  return col;
}

void main() {
  vec2 uv = vUv;
  if (uGlitch > 0.001) {
    float row = floor(uv.y * 34.0);
    float tt = floor(uTime * 22.0);
    if (hash12(vec2(row, tt)) < uGlitch * 0.5) uv.x += (hash12(vec2(row, tt + 7.0)) - 0.5) * 0.1 * uGlitch;
  }
  vec3 col = sceneAt(uv);
  if (uGlitch > 0.001) {
    float s = uGlitch * 0.012;
    col.r = mix(col.r, texture2D(tDiffuse, uv + vec2(s, 0.0)).r, uGlitch);
    col.b = mix(col.b, texture2D(tDiffuse, uv - vec2(s, 0.0)).b, uGlitch);
  }
  if (uWarp > 0.001) {
    vec2 dir = uv - 0.5;
    vec3 acc = col;
    float wsum = 1.0;
    for (int i = 1; i <= 10; i++) {
      float k = float(i) / 10.0;
      float w = 1.0 - k * 0.7;
      acc += texture2D(tDiffuse, uv - dir * k * uWarp * 0.16).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  }
  if (uMix < 0.9999) {
    vec3 snap = texture2D(tSnap, vUv).rgb;
    col = mix(snap, col, transitionMask(vUv, uMix, uMode));
  }
  if (uScan > 0.001) col *= 1.0 - uScan * 0.3 * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.5708));
  if (uSat != 1.0) { float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, uSat); }
  col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
  vec2 vc = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, smoothstep(1.15, 0.2, length(vc)), uVignette);
  col *= 1.0 - uDim;
  if (uInvert > 0.001) {
    vec3 c = clamp(col, 0.0, 1.0);
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    y = 1.0 - y;
    vec3 inv = vec3(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q);
    inv = clamp(inv, 0.0, 1.0) * uPaper;
    col = mix(col, inv, uInvert);
  }
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`;

// Защитный проход перед bloom: NaN/Inf из любого шейдера иначе «размазываются» bloom'ом на весь экран.
export const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
// побитовая проверка: экспонента из одних единиц = NaN или Inf (оптимизатор её не выбросит, в отличие от isnan)
bool badf(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  bool bad = badf(c.r) || badf(c.g) || badf(c.b);
  vec3 col = bad ? vec3(0.0) : clamp(c.rgb, 0.0, 48.0);
  gl_FragColor = vec4(col, 1.0);
}
`,
};

export class FinalPass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tSnap: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uMix: { value: 1 },
      uMode: { value: 1 },
      uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
      uAberration: { value: 0 },
      uWarp: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uVignette: { value: 0.55 },
      uGrain: { value: 0.03 },
      uGlitch: { value: 0 },
      uScan: { value: 0 },
      uInvert: { value: 0 },
      uPaper: { value: new THREE.Vector3(0.957, 0.945, 0.91) },
      uCell: { value: 8 },
      uDim: { value: 0 },
      uSat: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.copyQuad = new FullScreenQuad(this.copyMaterial);
    this.snapRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.uniforms.tSnap.value = this.snapRT.texture;
    this._capture = [];
  }

  setSize(w, h) {
    // snapRT здесь не трогаем: смена размера освободила бы снимок посреди перехода (маска «проявляла» бы из черноты)
    this.uniforms.uRes.value.set(w, h);
    this.uniforms.uCell.value = Math.max(5, h / 115);
  }

  // Запомнить текущий кадр (для переходов «старый кадр → новый»). Промис — после захвата.
  capture() {
    return new Promise((resolve) => this._capture.push(resolve));
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this._capture.length) {
      if (this.snapRT.width !== readBuffer.width || this.snapRT.height !== readBuffer.height) this.snapRT.setSize(readBuffer.width, readBuffer.height);
      this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.snapRT);
      this.copyQuad.render(renderer);
      const list = this._capture.splice(0);
      list.forEach((fn) => fn());
    }
    this.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.copyMaterial.dispose();
    this.fsQuad.dispose();
    this.copyQuad.dispose();
    this.snapRT.dispose();
  }
}
