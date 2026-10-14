// Голосование: спикер считает поднятые руки — каждое нажатие на карточку фиксирует голос (+1),
// кнопки «−1», «+1», «+10» — для исправлений и больших залов. Проценты считаются от общего числа голосов
// по всем карточкам (в сумме 100 %).
// Голоса хранятся в localStorage под ключом 'vote:<id>:counts', доли (в процентах) — под 'vote:<id>'
// (их читают 3D-шары голосования и сравнение «до / после»). Событие шины: 'vote:change' { id, values (доли), counts }.
import { store } from '../core/store.js';
import { esc } from './html.js';

/** Доли в процентах, сумма ровно 100 (метод наибольших остатков). */
export function sharesOf(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const base = raw.map((x) => Math.floor(x));
  let rest = 100 - base.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { base[i]++; rest--; } });
  return base;
}

const people = (n) => `${n} чел.`;

export class Vote {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.id = el.dataset.vote;
    this.key = 'vote:' + this.id;
    this.countsKey = 'vote:' + this.id + ':counts';
    let options = [];
    try { options = JSON.parse(el.dataset.options || '[]'); } catch { /* ignore */ }
    this.options = options.map((o) => (typeof o === 'string' ? { title: o } : o));
    this.compare = el.dataset.compare || null;
    this.deltaStep = el.dataset.deltaStep != null ? parseInt(el.dataset.deltaStep, 10) : null;
    this.lockStep = el.dataset.lockStep != null ? parseInt(el.dataset.lockStep, 10) : null;
    this.ghostLabel = el.dataset.ghostLabel || 'было';
    const saved = store.get(this.countsKey);
    this.counts = Array.isArray(saved) && saved.length === this.options.length ? saved.map((x) => Math.max(0, x | 0)) : this.options.map(() => 0);
    this.values = sharesOf(this.counts);
    this.render();
    this.offStore = store.on(this.countsKey, (v) => {
      if (Array.isArray(v) && v.join() !== this.counts.join()) { this.counts = v.slice(); this.values = sharesOf(this.counts); this.update(false); }
    });
    this.offCompare = this.compare ? store.on('vote:' + this.compare, () => this.update(false)) : null;
  }

  render() {
    const el = this.el;
    el.innerHTML = this.options.map((o, i) => `
      <div class="vote-card" data-i="${i}">
        <div class="vote-fill"></div>
        <div class="vote-ghost" data-label="${esc(this.ghostLabel)}"></div>
        <div class="vote-head">
          <div class="vote-title">${o.title}</div>
          ${o.hint ? `<div class="vote-hint">${o.hint}</div>` : ''}
        </div>
        <div class="vote-delta"></div>
        <div class="vote-value"><span class="v-num">0</span><small>%</small><span class="v-count"></span></div>
        <div class="vote-btns">
          <button class="vote-btn" data-d="-1" aria-label="Убрать голос">−1</button>
          <button class="vote-btn" data-d="1" aria-label="Добавить голос">+1</button>
          <button class="vote-btn" data-d="10" aria-label="Добавить 10 голосов">+10</button>
        </div>
      </div>`).join('');
    // Строка подсказки и сброса под карточками
    const tools = document.createElement('div');
    tools.className = 'vote-tools interactive';
    tools.innerHTML = `<span>Нажатие на карточку — +1 голос; проценты — от всех голосов</span><span class="vote-total"></span><button type="button" data-reset>Сбросить</button>`;
    el.after(tools);
    this.tools = tools;
    this.totalEl = tools.querySelector('.vote-total');

    const resetBtn = tools.querySelector('[data-reset]');
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // защита от случайного клика: сначала «Точно сбросить?», второй клик в течение 3 с — сброс
      if (!this._armed) {
        this._armed = true;
        resetBtn.textContent = 'Точно сбросить?';
        resetBtn.classList.add('is-armed');
        clearTimeout(this._armT);
        this._armT = setTimeout(() => { this._armed = false; resetBtn.textContent = 'Сбросить'; resetBtn.classList.remove('is-armed'); }, 3000);
        return;
      }
      this._armed = false;
      clearTimeout(this._armT);
      resetBtn.textContent = 'Сбросить';
      resetBtn.classList.remove('is-armed');
      this.counts = this.options.map(() => 0);
      this.commit();
    });

    this.cards = [...el.querySelectorAll('.vote-card')];
    this.cards.forEach((card, i) => {
      card.querySelectorAll('.vote-btn').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.add(i, parseInt(b.dataset.d, 10));
      }));
      // нажатие на саму карточку — +1 голос
      card.addEventListener('click', (e) => {
        if (e.target.closest('.vote-btn')) return;
        e.stopPropagation();
        this.add(i, 1);
      });
      // колесо/свайп тачпада над карточкой ничего не меняет и не листает слайды
      card.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    });
    this.update(false);
  }

  add(i, d) {
    if (this.locked) return;
    this.counts[i] = Math.max(0, (this.counts[i] || 0) + d);
    this.commit();
    const card = this.cards[i];
    card.classList.remove('is-bump');
    void card.offsetWidth;
    card.classList.add('is-bump');
  }

  commit() {
    this.values = sharesOf(this.counts);
    store.set(this.countsKey, this.counts.slice());
    store.set(this.key, this.values.slice());
    this.update(true);
  }

  update(emit = true) {
    const ghost = this.compare ? store.get('vote:' + this.compare) : null;
    this.el.classList.toggle('has-ghost', Array.isArray(ghost));
    const total = this.counts.reduce((a, b) => a + b, 0);
    const max = Math.max(...this.values);
    this.cards.forEach((card, i) => {
      const v = this.values[i];
      card.style.setProperty('--v', v);
      card.querySelector('.v-num').textContent = v;
      card.querySelector('.v-count').textContent = people(this.counts[i] || 0);
      card.classList.toggle('is-leader', max > 0 && v === max);
      if (Array.isArray(ghost)) {
        const g = ghost[i] ?? 0;
        card.style.setProperty('--g', g);
        const d = v - g;
        const dEl = card.querySelector('.vote-delta');
        dEl.textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d);
        dEl.className = 'vote-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '');
      }
    });
    if (this.totalEl) this.totalEl.textContent = total ? `Всего: ${people(total)}` : '';
    if (emit) this.ctx.bus.emit('vote:change', { id: this.id, values: this.values.slice(), counts: this.counts.slice() });
  }

  onStep(step) {
    this.locked = this.lockStep != null && step >= this.lockStep;
    this.el.classList.toggle('is-locked', this.locked);
    this.tools.style.visibility = this.locked ? 'hidden' : '';
    this.el.classList.toggle('show-delta', this.deltaStep != null && step >= this.deltaStep);
    this.ctx.bus.emit('vote:change', { id: this.id, values: this.values.slice(), counts: this.counts.slice(), step });
  }

  destroy() {
    clearTimeout(this._armT);
    this.offStore?.();
    this.offCompare?.();
    this.tools?.remove();
  }
}
