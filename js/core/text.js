// Текст внутри 3D-сцены (на canvas-текстурах). Для чёткого крупного текста поверх сцены
// лучше использовать HTML (ctx.labels или разметку слайда); эти функции — для надписей,
// которые должны вращаться/перекрываться вместе с объектами (карточки, табло, штампы).
//
//   const m = textMesh('Банки', { height: 0.6, font: '700 120px Unbounded', color: '#fff' })
import * as THREE from 'three';

/**
 * Нарисовать текст на canvas.
 * opts: font, color, align ('center'|'left'|'right'), padding (px), lineHeight, maxWidth (px, перенос по словам),
 *       background (CSS-цвет или null), radius (скругление фона), stroke ({ color, width })
 */
export function textCanvas(text, {
  font = '700 120px Unbounded', color = '#ffffff', align = 'center', padding = 28, lineHeight = 1.15,
  maxWidth = null, background = null, radius = 24, stroke = null, border = null,
} = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 100);
  // перенос строк
  const lines = [];
  String(text).split('\n').forEach((para) => {
    if (!maxWidth) { lines.push(para); return; }
    let cur = '';
    para.split(' ').forEach((w) => {
      const test = cur ? cur + ' ' + w : w;
      if (probe.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    lines.push(cur);
  });
  const textW = Math.max(...lines.map((l) => probe.measureText(l).width));
  const W = Math.ceil(textW + padding * 2);
  const H = Math.ceil(size * lineHeight * lines.length + padding * 2);
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    roundRect(ctx, 0, 0, W, H, radius);
    ctx.fill();
  }
  if (border) {
    ctx.strokeStyle = border.color; ctx.lineWidth = border.width;
    roundRect(ctx, border.width / 2, border.width / 2, W - border.width, H - border.width, radius);
    ctx.stroke();
  }
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  const x = align === 'center' ? W / 2 : align === 'left' ? padding : W - padding;
  lines.forEach((l, i) => {
    const y = padding + size * lineHeight * (i + 0.5);
    if (stroke) { ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineJoin = 'round'; ctx.strokeText(l, x, y); }
    ctx.fillStyle = color;
    ctx.fillText(l, x, y);
  });
  return { canvas: cnv, width: W, height: H, aspect: W / H };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function textTexture(text, opts = {}) {
  const t = textCanvas(text, opts);
  const tex = new THREE.CanvasTexture(t.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.aspect = t.aspect;
  return tex;
}

/** Плоскость с текстом. height — высота в мировых единицах (вся плашка). */
export function textMesh(text, { height = 1, opacity = 1, depthTest = true, additive = false, glow = false, ...opts } = {}) {
  const tex = textTexture(text, opts);
  const geo = new THREE.PlaneGeometry(height * tex.userData.aspect, height);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  // ниже порога bloom, чтобы текст оставался чётким (glow: true — пусть светится)
  if (!glow) mat.color.setScalar(0.8);
  const m = new THREE.Mesh(geo, mat);
  m.userData.text = text;
  return m;
}

/** Спрайт с текстом (всегда смотрит на камеру). */
export function textSprite(text, { height = 1, opacity = 1, depthTest = false, glow = false, ...opts } = {}) {
  const tex = textTexture(text, opts);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, depthTest });
  if (!glow) mat.color.setScalar(0.8);
  const s = new THREE.Sprite(mat);
  s.scale.set(height * tex.userData.aspect, height, 1);
  return s;
}
