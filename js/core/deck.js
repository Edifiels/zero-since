// Колода слайдов: текущий слайд и шаг, HTML-слой, автоматическая шапка блока, URL (#номер).
import { BLOCKS } from '../config.js';
import { mountComponents } from '../components/index.js';
import { store } from './store.js';
import { clamp } from './utils.js';

const STEP_ATTRS = ['data-step', 'data-step-only', 'data-step-until'];

export class Deck {
  constructor(app, slides) {
    this.app = app;
    this.slides = slides;
    this.root = document.getElementById('overlay');
    this.index = -1;
    this.step = 0;
    this.currentEl = null;
    this.comps = [];
    this.mountResult = null;
    slides.forEach((s, i) => {
      s._index = i;
      s._block = BLOCKS.find((b) => b.n === s.block) || BLOCKS[0];
      try { s._steps = this.computeSteps(s); } catch (err) { console.error(`[deck] ${s.id}:`, err); s._steps = 0; }
    });
  }

  get slide() { return this.slides[this.index]; }
  get total() { return this.slides.length; }

  api(slide) {
    return { app: this.app, store, bus: this.app.bus, slide, deck: this, engine: this.app.engine, director: this.app.director };
  }

  html(slide) {
    try {
      return typeof slide.html === 'function' ? slide.html(this.api(slide)) : (slide.html || '');
    } catch (err) {
      console.error(`[deck] html ${slide.id}:`, err);
      return `<div class="t-lead">Ошибка в слайде ${slide.id}</div>`;
    }
  }

  computeSteps(slide) {
    if (Number.isFinite(slide.steps)) return slide.steps;
    const tpl = document.createElement('template');
    tpl.innerHTML = this.html(slide);
    let max = 0;
    tpl.content.querySelectorAll(STEP_ATTRS.map((a) => `[${a}]`).join(',')).forEach((n) => {
      for (const a of STEP_ATTRS) {
        const v = n.getAttribute(a);
        if (v != null) max = Math.max(max, parseInt(v, 10) || 0);
      }
    });
    return max;
  }

  indexOf(idOrNum) {
    if (typeof idOrNum === 'number') return clamp(idOrNum, 0, this.total - 1);
    const i = this.slides.findIndex((s) => s.id === idOrNum);
    return i;
  }

  // ---------- Навигация ----------

  next() {
    if (this.index < 0) return this.goTo(0, 0, { dir: 1 });
    if (this.step < this.slide._steps) return this.setStep(this.step + 1, 1);
    if (this.index < this.total - 1) return this.goTo(this.index + 1, 0, { dir: 1 });
    this.app.ui?.toast('Это последний слайд');
  }

  prev() {
    if (this.index < 0) return;
    if (this.step > 0) return this.setStep(this.step - 1, -1);
    if (this.index > 0) {
      const p = this.slides[this.index - 1];
      return this.goTo(this.index - 1, p._steps, { dir: -1 });
    }
  }

  first() { this.goTo(0, 0, { dir: -1 }); }
  last() { this.goTo(this.total - 1, 0, { dir: 1 }); }

  /** Перейти к слайду index (число или id) на шаг step. */
  goTo(index, step = 0, { dir = null, instant = false } = {}) {
    if (typeof index === 'string') index = this.indexOf(index);
    index = clamp(index | 0, 0, this.total - 1);
    const slide = this.slides[index];
    step = clamp(step | 0, 0, slide._steps);
    if (index === this.index) { this.setStep(step, step >= this.step ? 1 : -1); return; }
    const d = dir ?? (index > this.index ? 1 : -1);
    const prevEl = this.currentEl;
    const prevComps = this.comps;
    const prevMount = this.mountResult;
    const prevSlide = this.slide;

    // Новый слайд
    const el = this.render(slide);
    this.root.appendChild(el);
    this.index = index;
    this.step = step;
    this.currentEl = el;

    // Уход старого
    if (prevEl) {
      prevEl.classList.remove('is-in');
      prevEl.classList.add('is-leaving');
      if (d < 0) prevEl.classList.add('dir-back');
      const cleanup = () => {
        prevComps.forEach((c) => { try { c.destroy?.(); } catch (err) { console.error(err); } });
        try {
          if (typeof prevMount === 'function') prevMount();
          else prevMount?.destroy?.();
          prevSlide?.unmount?.(prevEl, this.api(prevSlide));
        } catch (err) { console.error(err); }
        prevEl.remove();
      };
      if (instant) cleanup(); else setTimeout(cleanup, 650);
    }

    // Появление: сначала всё скрыто (шаг −1), затем is-in и нужный шаг — элементы шага 0 тоже анимируются
    this.applyStep(-1, d, true);
    const enter = () => {
      el.classList.add('is-in');
      this.applyStep(this.step, d);
    };
    if (instant) enter(); else requestAnimationFrame(() => requestAnimationFrame(enter));

    this.app.director?.show(slide, step, { dir: d, instant });
    this.afterChange();
    this.app.bus.emit('slide', { index, step, slide, dir: d });
  }

  setStep(step, dir = 1) {
    const slide = this.slide;
    if (!slide) return;
    step = clamp(step, 0, slide._steps);
    if (step === this.step) return;
    this.step = step;
    this.applyStep(step, dir);
    this.app.director?.step(slide, step, { dir });
    this.afterChange();
    this.app.bus.emit('step', { index: this.index, step, slide, dir });
  }

  applyStep(step, dir = 1, silent = false) {
    const el = this.currentEl;
    if (!el) return;
    if (step < 0) {
      // до появления слайда всё скрыто — чтобы элементы шага 0 тоже вошли с анимацией
      el.querySelectorAll(STEP_ATTRS.map((a) => `[${a}]`).join(',')).forEach((n) => n.classList.remove('is-shown'));
      return;
    }
    el.dataset.curStep = step;
    el.style.setProperty('--step', step);
    el.querySelectorAll('[data-step]').forEach((n) => n.classList.toggle('is-shown', step >= parseInt(n.dataset.step, 10)));
    el.querySelectorAll('[data-step-only]').forEach((n) => n.classList.toggle('is-shown', step === parseInt(n.dataset.stepOnly, 10)));
    el.querySelectorAll('[data-step-until]').forEach((n) => n.classList.toggle('is-shown', step < parseInt(n.dataset.stepUntil, 10)));
    if (silent) return;
    for (const c of this.comps) { try { c.onStep?.(step, dir); } catch (err) { console.error(err); } }
    const slide = this.slide;
    try {
      this.mountResult?.onStep?.(step, dir);
      slide.onStep?.(step, el, this.api(slide), dir);
    } catch (err) { console.error(`[deck] onStep ${slide.id}:`, err); }
  }

  render(slide) {
    const el = document.createElement('section');
    el.className = `slide slide--${slide.id}${slide.className ? ' ' + slide.className : ''}`;
    el.dataset.id = slide.id;
    el.dataset.block = slide.block ?? 0;
    const inner = this.html(slide);
    el.innerHTML = slide.raw ? inner : `<div class="stage ${slide.layout || 'l-center'}">${inner}</div>`;
    if (slide.kicker !== false) el.insertAdjacentHTML('beforeend', this.kickerHTML(slide));
    splitText(el);
    this.comps = mountComponents(el, this.api(slide));
    this.mountResult = null;
    if (slide.mount) {
      try { this.mountResult = slide.mount(el, this.api(slide)) || null; } catch (err) { console.error(`[deck] mount ${slide.id}:`, err); }
    }
    return el;
  }

  kickerHTML(slide) {
    const b = slide._block;
    if (typeof slide.kicker === 'string') return `<div class="slide-kicker"><span class="k-mark"></span><span>${slide.kicker}</span></div>`;
    if (!b || b.n === 0) return `<div class="slide-kicker"><span class="k-mark"></span><span>Лаборатория НСИИИ</span></div>`;
    return `<div class="slide-kicker"><span class="k-num">${String(b.n).padStart(2, '0')}</span><span>${b.title}</span></div>`;
  }

  afterChange() {
    this.app.ui?.update();
    this.app.syncPresenter?.();
    if (!this.app.started) return; // до начала показа адрес и «последний слайд» не трогаем
    // URL: #12 или #12.3 (номер слайда с 1, шаг)
    const hash = '#' + (this.index + 1) + (this.step ? '.' + this.step : '');
    if (location.hash !== hash) history.replaceState(null, '', hash);
    store.set('last', { index: this.index, step: this.step });
  }

  /** Разобрать #12.3 → { index, step } */
  parseHash(h = location.hash) {
    const m = h.replace(/^#\/?/, '');
    if (!m) return null;
    const [a, b] = m.split('.');
    let index = /^\d+$/.test(a) ? parseInt(a, 10) - 1 : this.indexOf(decodeURIComponent(a));
    if (index < 0 || Number.isNaN(index)) return null;
    return { index: clamp(index, 0, this.total - 1), step: parseInt(b || '0', 10) || 0 };
  }
}

// Разбить текст элементов [data-split="words|chars"] на span'ы для каскадного появления.
function splitText(root) {
  root.querySelectorAll('[data-split]').forEach((node) => {
    const mode = node.dataset.split || 'words';
    let k = 0;
    const walk = (n) => {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          if (mode === 'chars') {
            const w = document.createElement('span');
            w.className = 'split-word';
            for (const ch of p) {
              const s = document.createElement('span');
              s.className = 'split-unit';
              s.style.setProperty('--si', k++);
              s.textContent = ch;
              w.appendChild(s);
            }
            frag.appendChild(w);
          } else {
            const s = document.createElement('span');
            s.className = 'split-unit';
            s.style.setProperty('--si', k++);
            s.textContent = p;
            frag.appendChild(s);
          }
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains('split-unit')) {
        [...n.childNodes].forEach(walk);
      }
    };
    [...node.childNodes].forEach(walk);
    if (mode === 'chars' && !node.style.getPropertyValue('--stagger')) node.style.setProperty('--stagger', '28ms');
  });
}
