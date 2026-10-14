// Мелкие утилиты: математика, случайные числа, DOM, форматирование.

export const params = new URLSearchParams(location.search);
export const IS_TEST = params.has('test');

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const mapRange = (v, a1, b1, a2, b2) => lerp(a2, b2, clamp(invLerp(a1, b1, v)));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

// Детерминированный генератор случайных чисел (mulberry32).
export function rng(seed = 1) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (min, max) => min + (max - min) * r();
  r.int = (min, max) => Math.floor(min + (max - min + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  // Нормальное распределение (Бокс — Мюллер)
  r.gauss = (mean = 0, sd = 1) => {
    const u = 1 - r(), v = r();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  // Точка в шаре / на сфере
  r.inSphere = (radius = 1) => {
    const u = r(), v = r(), w = r();
    const theta = TAU * u, phi = Math.acos(2 * v - 1), rr = radius * Math.cbrt(w);
    return [rr * Math.sin(phi) * Math.cos(theta), rr * Math.sin(phi) * Math.sin(theta), rr * Math.cos(phi)];
  };
  r.onSphere = (radius = 1) => {
    const u = r(), v = r();
    const theta = TAU * u, phi = Math.acos(2 * v - 1);
    return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi)];
  };
  return r;
}

export const wait = (ms) => new Promise((res) => setTimeout(res, ms));
export const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));

// DOM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function h(tag, attrs = {}, html = '') {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  if (html) el.innerHTML = html;
  return el;
}

// Числа по-русски: 86 000 000 000 (узкий неразрывный пробел) и десятичная запятая.
const NBSP = ' ';
export function formatNumber(n, { decimals = 0, group = true } = {}) {
  const neg = n < 0;
  let s = Math.abs(n).toFixed(decimals);
  let [int, frac] = s.split('.');
  if (group && int.length > 4) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? '−' : '') + int + (frac ? ',' + frac : '');
}

// Ожидание загрузки шрифтов (нужно до рисования текста в canvas).
let fontsPromise = null;
export function fontsReady() {
  if (!fontsPromise) {
    const faces = [
      '800 64px Unbounded', '700 64px Unbounded', '600 64px Unbounded',
      '400 64px Onest', '600 64px Onest', '700 64px Onest',
      '600 64px "JetBrains Mono"', '400 32px "Press Start 2P"',
    ];
    const sample = 'АБВгдеЁё 0123456789 abc';
    fontsPromise = Promise.race([
      Promise.all(faces.map((f) => document.fonts.load(f, sample).catch(() => null))).then(() => document.fonts.ready),
      wait(4000),
    ]);
  }
  return fontsPromise;
}

// Простая шина событий.
export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) { if (!this._h.has(type)) this._h.set(type, new Set()); this._h.get(type).add(fn); return () => this.off(type, fn); }
  off(type, fn) { this._h.get(type)?.delete(fn); }
  once(type, fn) { const off = this.on(type, (...a) => { off(); fn(...a); }); return off; }
  emit(type, ...args) { this._h.get(type)?.forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }
}

// Парсинг "мм:сс" в секунды.
export function parseTime(s) {
  if (!s) return null;
  const [m, sec] = String(s).split(':').map(Number);
  return (m || 0) * 60 + (sec || 0);
}
export function fmtTime(sec) {
  const neg = sec < 0; sec = Math.abs(Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return (neg ? '−' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
