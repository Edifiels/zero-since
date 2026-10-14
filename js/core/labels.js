// HTML-подписи, привязанные к точкам 3D-сцены (чёткий текст любым шрифтом поверх WebGL).
//
//   const l = ctx.labels.add({ html: '<span class="tag">Аэропорты</span>', object: mesh, offset: [0, 1.2, 0], owner: this })
//   l.show(); l.hide(); l.setHTML('…'); l.remove();
//   ctx.labels.removeOwner(this)
import * as THREE from 'three';

export class Labels {
  constructor(root, camera) {
    this.root = root;
    this.camera = camera;
    this.items = new Set();
    this.w = 1;
    this.h = 1;
    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  resize(w, h) { this.w = w; this.h = h; }

  /**
   * @param {object} o
   *   html, className, object (Object3D) | position ([x,y,z] в мировых координатах), offset ([x,y,z]),
   *   anchor: 'center'|'left'|'right'|'top'|'bottom'|'top-left'|'top-right'|'bottom-left'|'bottom-right', owner, visible (true),
   *   scale (false) — уменьшать с расстоянием, fadeNear (0) — плавно гасить на краях
   */
  add(o) {
    const el = document.createElement('div');
    el.className = 'label3d' + (o.anchor && o.anchor !== 'center' ? ' anchor-' + o.anchor : '') + (o.className ? ' ' + o.className : '');
    const inner = document.createElement('div');
    inner.className = 'l-in';
    inner.innerHTML = o.html || '';
    el.appendChild(inner);
    const item = {
      el,
      inner,
      object: o.object || null,
      position: o.position ? new THREE.Vector3(...o.position) : new THREE.Vector3(),
      offset: new THREE.Vector3(...(o.offset || [0, 0, 0])),
      owner: o.owner || null,
      visible: o.visible !== false,
      scale: !!o.scale,
      refDist: o.refDist || 14,
      show: () => { item.visible = true; item.hiddenAt = 0; el.classList.remove('is-hidden'); return item; },
      hide: () => { if (item.visible) item.hiddenAt = performance.now(); item.visible = false; el.classList.add('is-hidden'); return item; },
      setHTML: (h) => { inner.innerHTML = h; return item; },
      setOffset: (p, y, z) => {
        if (typeof p === 'number') item.offset.set(p, y, z);
        else if (p && p.isVector3) item.offset.copy(p);
        else item.offset.set(p[0], p[1], p[2]);
        return item;
      },
      setPosition: (p, y, z) => {
        if (typeof p === 'number') item.position.set(p, y, z);
        else if (p && p.isVector3) item.position.copy(p);
        else item.position.set(p[0], p[1], p[2]);
        return item;
      },
      remove: () => { el.remove(); this.items.delete(item); },
    };
    if (!item.visible) el.classList.add('is-hidden');
    this.root.appendChild(el);
    this.items.add(item);
    return item;
  }

  removeOwner(owner) {
    for (const it of [...this.items]) if (it.owner === owner) it.remove();
  }

  setOwnerVisible(owner, visible) {
    for (const it of this.items) {
      if (it.owner !== owner) continue;
      it.el.style.display = visible ? '' : 'none';
      if (visible) it.el.classList.remove('is-owner-leaving');
    }
  }

  /** Быстро погасить подписи уходящей визуализации (в начале перехода, чтобы не налезали на новый слайд). */
  fadeOwner(owner) {
    for (const it of this.items) if (it.owner === owner) it.el.classList.add('is-owner-leaving');
  }

  update() {
    const cam = this.camera;
    const now = performance.now();
    for (const it of this.items) {
      if (it.el.style.display === 'none') continue;
      if (!it.visible && it.hiddenAt && now - it.hiddenAt > 700) continue; // скрыта и уже погасла — не трогаем DOM
      const v = this._v;
      if (it.object) {
        it.object.updateWorldMatrix(true, false);
        v.copy(it.offset).applyMatrix4(it.object.matrixWorld);
      } else {
        v.copy(it.position).add(it.offset);
      }
      const dist = this._c.copy(v).applyMatrix4(cam.matrixWorldInverse).z;
      v.project(cam);
      const behind = dist > -0.1;
      const x = (v.x * 0.5 + 0.5) * this.w;
      const y = (-v.y * 0.5 + 0.5) * this.h;
      if (behind) { it.el.style.opacity = '0'; continue; }
      it.el.style.opacity = '';
      const s = it.scale ? Math.max(0.35, Math.min(2, it.refDist / -dist)) : 1;
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
    }
  }
}
