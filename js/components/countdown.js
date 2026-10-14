// Обратный отсчёт: 3 — 2 — 1 — «Поехали!». События шины: countdown:tick (n), countdown:done.
import { isShown } from './index.js';

export class Countdown {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.from = parseInt(el.dataset.from || '3', 10);
    this.word = el.dataset.word || '';
    this.interval = parseFloat(el.dataset.interval || '1') * 1000;
    this.timers = [];
    this.running = false;
    const nums = [];
    for (let n = this.from; n >= 1; n--) nums.push(`<div class="cd-num" data-n="${n}">${n}</div>`);
    if (this.word) nums.push(`<div class="cd-num cd-word" data-n="0">${this.word}</div>`);
    el.innerHTML = nums.join('');
  }
  onStep(step, dir) {
    const s = isShown(this.el);
    if (s && !this.running && dir !== -1) this.start();
    if (!s && this.running) this.reset();
  }
  start() {
    this.running = true;
    const items = [...this.el.querySelectorAll('.cd-num')];
    items.forEach((it, i) => {
      this.timers.push(setTimeout(() => {
        items.forEach((x) => x.classList.remove('is-on'));
        void it.offsetWidth;
        it.classList.add('is-on');
        const n = parseInt(it.dataset.n, 10);
        if (n > 0) this.ctx.bus.emit('countdown:tick', n);
        else this.ctx.bus.emit('countdown:done');
      }, i * this.interval));
    });
    if (!this.word) this.timers.push(setTimeout(() => this.ctx.bus.emit('countdown:done'), items.length * this.interval));
  }
  reset() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.running = false;
    this.el.querySelectorAll('.cd-num').forEach((x) => x.classList.remove('is-on'));
  }
  destroy() { this.reset(); }
}
