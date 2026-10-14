// Печатная машинка: текст элемента набирается по буквам при появлении.
import { isShown } from './index.js';

export class Typewriter {
  constructor(el) {
    this.el = el;
    this.text = el.textContent;
    this.speed = parseFloat(el.dataset.speed || '38');
    this.delay = parseFloat(el.dataset.delay || '0.3') * 1000;
    this.el.textContent = '';
    this.el.style.minHeight = '1.2em';
    this.shown = false;
  }
  onStep() {
    const s = isShown(this.el);
    if (s && !this.shown) {
      this.shown = true;
      let i = 0;
      clearInterval(this.timer);
      this.t0 = setTimeout(() => {
        this.timer = setInterval(() => {
          i++;
          this.el.textContent = this.text.slice(0, i);
          if (i >= this.text.length) clearInterval(this.timer);
        }, this.speed);
      }, this.delay);
    } else if (!s && this.shown) {
      this.shown = false;
      clearTimeout(this.t0);
      clearInterval(this.timer);
      this.el.textContent = '';
    }
  }
  destroy() { clearTimeout(this.t0); clearInterval(this.timer); }
}
