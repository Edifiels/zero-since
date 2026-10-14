// Счётчик, набирающий число при появлении (повторно — при каждом новом показе).
import { gsap } from 'gsap';
import { formatNumber } from '../core/utils.js';
import { isShown } from './index.js';

export class Counter {
  constructor(el) {
    this.el = el;
    this.from = parseFloat(el.dataset.from || '0');
    this.to = parseFloat(el.dataset.to || '0');
    this.decimals = parseInt(el.dataset.decimals || '0', 10);
    this.duration = parseFloat(el.dataset.duration || '2.2');
    this.format = el.dataset.format || 'group';
    this.final = el.dataset.final || '';
    this.delay = parseFloat(el.dataset.delay || '0.25');
    this.shown = false;
    this.state = { v: this.from };
    this.render();
  }
  render() {
    const v = this.state.v;
    this.el.textContent = formatNumber(v, { decimals: this.decimals, group: this.format !== 'plain' });
  }
  onStep(step, dir) {
    const s = isShown(this.el);
    if (s && !this.shown && dir < 0) {
      // вернулись на слайд назад — показываем итог без повторного «набора»
      this.shown = true;
      this.tween?.kill();
      this.state.v = this.to;
      this.render();
      if (this.final) this.el.innerHTML = this.final;
      return;
    }
    if (s && !this.shown) {
      this.shown = true;
      this.tween?.kill();
      this.state.v = this.from;
      // экспоненциальный «набор» для огромных чисел выглядит живее
      const st = { k: 0 };
      this.tween = gsap.to(st, {
        k: 1,
        duration: this.duration,
        delay: this.delay,
        ease: 'power3.out',
        onUpdate: () => {
          this.state.v = this.from + (this.to - this.from) * st.k;
          if (this.decimals === 0) this.state.v = Math.round(this.state.v);
          this.render();
        },
        onComplete: () => {
          this.state.v = this.to;
          this.render();
          if (this.final) this.el.innerHTML = this.final;
        },
      });
    } else if (!s && this.shown) {
      this.shown = false;
      this.tween?.kill();
      this.state.v = this.from;
      this.render();
    }
  }
  destroy() { this.tween?.kill(); }
}
