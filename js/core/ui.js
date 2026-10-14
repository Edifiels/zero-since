// Интерфейс: стартовый экран, прогресс по блокам, всплывающие кнопки, навигатор, справка, тосты, затемнение.
import { BLOCKS, LECTURE, QUALITY_NAMES } from '../config.js';
import { h, $ } from './utils.js';
import { store } from './store.js';


const ICONS = {
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.2-1.5 2.2V15"/><circle cx="12" cy="19" r=".6" fill="currentColor"/></svg>',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.chrome = document.getElementById('chrome');
    this.modals = document.getElementById('modals');
    this.curtainEl = document.getElementById('curtain');
    this.curtain = null;
    this.modalOpen = false;
    this.buildProgress();
    this.buildHud();
    this.buildModals();
    this.toastEl = h('div', { class: 'toast' });
    this.chrome.appendChild(this.toastEl);
    this.setupIdle();
  }

  // ---------- Прогресс ----------
  buildProgress() {
    const slides = this.app.deck.slides;
    const blocks = BLOCKS.filter((b) => slides.some((s) => (s.block ?? 0) === b.n));
    this.progress = h('div', { class: 'progress' });
    this.segs = blocks.map((b) => {
      const n = slides.filter((s) => (s.block ?? 0) === b.n).length;
      const seg = h('div', { class: 'progress-seg', title: b.title }, '<i></i>');
      seg.style.setProperty('--w', n);
      this.progress.appendChild(seg);
      return { b, seg, slides: slides.filter((s) => (s.block ?? 0) === b.n) };
    });
    this.chrome.appendChild(this.progress);
  }

  // ---------- HUD ----------
  buildHud() {
    const hud = h('div', { class: 'hud' });
    hud.innerHTML = `
      <div class="hud-group">
        <button class="hud-btn" data-a="menu" title="Список слайдов (G)">${ICONS.menu}</button>
        <button class="hud-btn" data-a="theme" title="Светлая/тёмная тема (T)">${ICONS.theme}</button>
        <button class="hud-btn" data-a="help" title="Клавиши (H)">${ICONS.help}</button>
      </div>
      <div class="hud-group">
        <span class="hud-count"></span>
        <button class="hud-btn" data-a="prev" title="Назад">${ICONS.prev}</button>
        <button class="hud-btn" data-a="next" title="Далее">${ICONS.next}</button>
        <button class="hud-btn" data-a="full" title="Полный экран (F)">${ICONS.full}</button>
      </div>`;
    hud.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.a;
      const app = this.app;
      if (a === 'prev') app.deck.prev();
      else if (a === 'next') app.deck.next();
      else if (a === 'full') app.toggleFullscreen();
      else if (a === 'menu') this.openNavigator();
      else if (a === 'theme') app.toggleTheme();
      else if (a === 'help') this.openHelp();
    });
    this.hudCount = hud.querySelector('.hud-count');
    this.chrome.appendChild(hud);
  }

  setupIdle() {
    let t = null;
    const wake = () => {
      document.body.classList.add('hud-on');
      document.body.classList.remove('cursor-hidden');
      clearTimeout(t);
      t = setTimeout(() => {
        document.body.classList.remove('hud-on');
        if (this.app.started) document.body.classList.add('cursor-hidden');
      }, 2600);
    };
    window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') wake(); }, { passive: true });
  }

  update() {
    const deck = this.app.deck;
    const s = deck.slide;
    if (!s) return;
    this.hudCount.textContent = `${deck.index + 1} / ${deck.total}`;
    for (const { seg, slides } of this.segs) {
      const i = slides.indexOf(s);
      const before = slides.length && slides[slides.length - 1]._index < deck.index;
      const p = i >= 0 ? (i + (s._steps ? deck.step / (s._steps + 1) : 0) + 1) / slides.length : before ? 1 : 0;
      seg.style.setProperty('--p', p.toFixed(4));
      seg.classList.toggle('is-current', i >= 0);
    }
    if (this.navList) this.markNavCurrent();
  }

  // ---------- Модальные окна ----------
  buildModals() {
    // Навигатор
    const nav = h('div', { class: 'modal', id: 'navigator' });
    const slides = this.app.deck.slides;
    const groups = BLOCKS.map((b) => ({ b, list: slides.filter((s) => (s.block ?? 0) === b.n) })).filter((g) => g.list.length);
    nav.innerHTML = `
      <div class="modal-box">
        <div class="modal-title"><span>Слайды</span><button class="modal-close" data-close>✕</button></div>
        <div class="nav-blocks">
          ${groups.map(({ b, list }) => `
            <div class="nav-block">
              <h3>${b.n ? String(b.n).padStart(2, '0') : '★'} ${b.title} ${b.n ? `<span>${b.time}</span>` : ''}</h3>
              ${list.map((s) => `<button class="nav-item" data-i="${s._index}"><b>${s._index + 1}</b><span>${s.title || s.id}</span></button>`).join('')}
            </div>`).join('')}
        </div>
      </div>`;
    nav.addEventListener('click', (e) => {
      e.stopPropagation();
      const it = e.target.closest('[data-i]');
      if (it) { this.closeModals(); this.app.deck.goTo(parseInt(it.dataset.i, 10), 0); return; }
      if (e.target.closest('[data-close]') || e.target === nav) this.closeModals();
    });
    this.navList = nav;
    // Справка
    const help = h('div', { class: 'modal', id: 'help' });
    const rows = [
      ['Далее', 'PageDown → Space'],
      ['Назад', 'PageUp ←'],
      ['Полный экран', 'F5 F'],
      ['Затемнить экран', 'B .'],
      ['Белый экран', 'W'],
      ['Список слайдов', 'G'],
      ['Перейти к слайду', 'номер + Enter'],
      ['Первый / последний', 'Home End'],
      ['Тема светлая/тёмная', 'T'],
      ['Окно спикера', 'S'],
      ['Качество графики', 'Q'],
      ['Мышь', 'клик — далее, правый клик — назад'],
    ];
    help.innerHTML = `
      <div class="modal-box">
        <div class="modal-title"><span>Управление</span><button class="modal-close" data-close>✕</button></div>
        <div class="help-grid">
          ${rows.map(([a, b]) => `<div class="help-row"><span>${a}</span><span>${b.includes(' ') && !b.includes('—') && !b.includes('+') ? b.split(' ').map((x) => `<span class="kbd">${x}</span>`).join('') : `<span class="kbd">${b}</span>`}</span></div>`).join('')}
        </div>
      </div>`;
    help.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-close]') || e.target === help) this.closeModals(); });
    this.helpEl = help;
    this.modals.append(nav, help);
  }

  markNavCurrent() {
    const i = this.app.deck.index;
    this.navList.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('is-current', parseInt(b.dataset.i, 10) === i));
  }

  openNavigator() {
    this.closeModals();
    this.markNavCurrent();
    this.navList.classList.add('is-open');
    this.modalOpen = true;
    this.navList.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }
  openHelp() { this.closeModals(); this.helpEl.classList.add('is-open'); this.modalOpen = true; }
  closeModals() {
    this.modals.querySelectorAll('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
    this.modalOpen = false;
  }

  // ---------- Стартовый экран ----------
  buildStart({ resume = null } = {}) {
    const el = h('div', { class: 'start', id: 'start' });
    el.innerHTML = `
      <div class="start-inner">
        <span class="lockup"></span>
        <div class="start-sub">${LECTURE.format}</div>
        <h1 class="start-title">${LECTURE.title}<br><span class="accent">${LECTURE.subtitle}</span></h1>
        <div class="start-actions">
          <button class="btn btn-primary" data-start disabled>Загрузка…</button>
          ${resume ? `<button class="btn" data-resume>Продолжить со слайда ${resume.index + 1}</button>` : ''}
          <button class="btn" data-theme>Тема: <span data-theme-name>тёмная</span></button>
          <button class="btn" data-presenter>Окно спикера</button>
          ${this.app.noWebGL ? '' : `<button class="btn" data-quality title="Число частиц и сглаживание; применяется с перезагрузкой">Качество: <span>${QUALITY_NAMES[this.app.qualityLevel] || this.app.qualityLevel}</span></button>`}
          ${this.hasVotes() ? '<button class="btn" data-reset-votes>Сбросить голосования</button>' : ''}
        </div>
        <div class="start-load"><i></i></div>
        <div class="start-hint">
          Кликер или клавиатура: <span class="kbd">→</span><span class="kbd">PgDn</span> — далее,
          <span class="kbd">←</span><span class="kbd">PgUp</span> — назад, <span class="kbd">F5</span><span class="kbd">F</span> — полный экран,
          <span class="kbd">B</span> — затемнить, <span class="kbd">H</span> — все клавиши
        </div>
      </div>`;
    this.modals.appendChild(el);
    this.startEl = el;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('[data-start]')) this.app.requestBegin({ fullscreen: true });
      else if (e.target.closest('[data-resume]')) this.app.requestBegin({ fullscreen: true, resume: true });
      else if (e.target.closest('[data-quality]')) {
        const order = ['high', 'medium', 'low'];
        const next = order[(order.indexOf(this.app.qualityLevel) + 1) % order.length];
        this.app.setQualityLevel(next);
      }
      else if (e.target.closest('[data-theme]')) this.app.toggleTheme();
      else if (e.target.closest('[data-presenter]')) this.app.openPresenter();
      else if (e.target.closest('[data-reset-votes]')) {
        if (window.confirm('Обнулить результаты всех голосований и таймер окна спикера (например, после репетиции)?')) {
          this.voteKeys().forEach((k) => store.remove(k));
          store.remove('presenter-timer');
          e.target.closest('[data-reset-votes]').remove();
          this.toast('Голосования сброшены');
        }
      }
    });
    this.updateThemeName();
    return el;
  }

  voteKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nsiii:vote:')) keys.push(k.slice('nsiii:'.length));
      }
    } catch { /* приватный режим */ }
    return keys;
  }

  hasVotes() {
    return this.voteKeys().some((k) => { const v = store.get(k); return Array.isArray(v) && v.some((x) => x > 0); });
  }

  setLoad(p) {
    if (!this.startEl) return;
    const bar = this.startEl.querySelector('.start-load');
    bar.style.setProperty('--p', Math.min(1, p).toFixed(3));
    if (p >= 1) {
      bar.classList.add('is-done');
      const b = this.startEl.querySelector('[data-start]');
      b.disabled = false;
      b.textContent = 'Начать ▶';
    }
  }

  hideStart() {
    this.startEl?.classList.add('is-hidden');
    setTimeout(() => this.startEl?.remove(), 1200);
  }

  updateThemeName() {
    const n = this.startEl?.querySelector('[data-theme-name]');
    if (n) n.textContent = document.documentElement.dataset.theme === 'light' ? 'светлая' : 'тёмная';
  }

  // ---------- Прочее ----------
  setCurtain(mode) {
    this.curtain = mode;
    this.curtainEl.className = 'curtain' + (mode ? ' is-' + mode : '');
    document.body.classList.toggle('is-blackout', !!mode);
    this.app.syncPresenter?.();
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('is-on'), ms);
  }

  error(text) {
    const box = h('div', { class: 'error-box' }, text);
    this.chrome.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }
}
