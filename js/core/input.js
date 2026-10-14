// Управление: кликер, клавиатура, мышь, колесо, касания.
//
// Кликеры (Logitech R400/R500/Spotlight, Targus, Kensington и др.) обычно посылают:
//   далее — PageDown / → / ↓ / Space;  назад — PageUp / ← / ↑;
//   «старт показа» — F5 / Shift+F5 / Esc (чередуются);  «чёрный экран» — . (точка) или B.
export class Input {
  constructor(app) {
    this.app = app;
    this.wheelAcc = 0;
    this.wheelLock = 0;
    this.numBuf = '';
    this.numTimer = null;
    window.addEventListener('keydown', (e) => this.onKey(e));
    const surface = document.getElementById('app');
    surface.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    surface.addEventListener('pointerup', (e) => this.onPointerUp(e));
    surface.addEventListener('contextmenu', (e) => {
      if (this.isInteractive(e.target)) return;
      e.preventDefault();
      if (this.app.started) this.app.deck.prev();
    });
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  isInteractive(t) {
    return !!(t && t.closest && t.closest('button, a, input, select, textarea, .interactive, .modal.is-open, .start, [data-interactive]'));
  }

  onKey(e) {
    const app = this.app;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // системные сочетания не трогаем
    const k = e.key;
    // Буквенные клавиши — по физической клавише (не зависит от раскладки RU/EN)
    const code = e.code || '';
    const L = code.startsWith('Key') ? code.slice(3).toLowerCase()
      : code === 'Period' ? '.' : code === 'Comma' ? ',' : code === 'Slash' ? '?' : (k.length === 1 ? k.toLowerCase() : '');
    const ui = app.ui;
    // F5 никогда не перезагружает страницу (кнопка «показ» на кликере): только входит в полный экран
    if (k === 'F5') {
      e.preventDefault();
      if (ui.modalOpen) ui.closeModals();
      if (!app.started) { app.requestBegin({ fullscreen: true }); return; }
      app.enterFullscreen();
      return;
    }
    // После автопродолжения (сбой графики) первое нажатие возвращает полный экран
    if (app._fsOnFirstKey && !app.isFullscreen) { app._fsOnFirstKey = false; app.enterFullscreen(); }

    // Модальные окна
    if (ui.modalOpen) {
      if (k === 'Escape' || L === 'g' || L === 'm' || L === 'h' || L === '?') { e.preventDefault(); ui.closeModals(); }
      return;
    }

    // Стартовый экран: «далее» — начать (если сцены ещё грузятся — начнём сразу после загрузки)
    if (!app.started) {
      if (['PageDown', 'ArrowRight', 'ArrowDown', ' ', 'Enter'].includes(k)) {
        e.preventDefault();
        app.requestBegin({ fullscreen: true });
      } else if (L === 't') app.toggleTheme();
      else if (L === 'f') app.toggleFullscreen();
      return;
    }

    // Затемнение: любая клавиша (кроме переключателей) — снять
    if (ui.curtain && !['b', '.', ',', 'w'].includes(L)) {
      e.preventDefault();
      ui.setCurtain(null);
      return;
    }

    const NEXT = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
    const PREV = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
    if (NEXT.includes(k) || L === 'n') {
      e.preventDefault();
      if (k === 'Enter' && this.numBuf) { this.jumpToBuffer(); return; }
      if (!e.repeat) app.deck.next();
      return;
    }
    if (PREV.includes(k) || L === 'p') {
      e.preventDefault();
      if (!e.repeat) app.deck.prev();
      return;
    }
    if (k === 'Home') { e.preventDefault(); app.deck.first(); return; }
    if (k === 'End') { e.preventDefault(); app.deck.last(); return; }
    if (L === 'f') { e.preventDefault(); app.toggleFullscreen(); return; }
    if (k === 'F1') { e.preventDefault(); ui.openHelp(); return; }
    // Esc в полноэкранном режиме перехвачен (keyboard.lock): выйти — удерживать Esc или нажать F
    if (k === 'Escape') return;
    switch (L) {
      case 'b': case '.': case ',':
        e.preventDefault(); ui.setCurtain(ui.curtain === 'black' ? null : 'black'); return;
      case 'w':
        e.preventDefault(); ui.setCurtain(ui.curtain === 'white' ? null : 'white'); return;
      case 'g': case 'm':
        e.preventDefault(); ui.openNavigator(); return;
      case 'h': case '?':
        e.preventDefault(); ui.openHelp(); return;
      case 't':
        e.preventDefault(); app.toggleTheme(); return;
      case 's':
        e.preventDefault(); app.openPresenter(); return;
      case 'q':
        e.preventDefault(); app.cycleQuality(); return;
      default:
        if (/^[0-9]$/.test(k)) {
          this.numBuf += k;
          ui.toast('Слайд ' + this.numBuf + ' — нажмите Enter');
          clearTimeout(this.numTimer);
          this.numTimer = setTimeout(() => { this.numBuf = ''; }, 2500);
        }
    }
  }

  jumpToBuffer() {
    const n = parseInt(this.numBuf, 10);
    this.numBuf = '';
    clearTimeout(this.numTimer);
    if (n >= 1 && n <= this.app.deck.total) this.app.deck.goTo(n - 1, 0);
  }

  onPointerDown(e) {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), interactive: this.isInteractive(e.target), button: e.button, type: e.pointerType };
  }

  onPointerUp(e) {
    const d = this.down;
    this.down = null;
    if (!d || d.interactive || !this.app.started) return;
    if (this.app.ui.modalOpen) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - d.t;
    if (this.app.ui.curtain) { this.app.ui.setCurtain(null); return; }
    // Свайп
    if (d.type !== 'mouse' && dist > 50 && dt < 800) {
      if (Math.abs(dx) > Math.abs(dy)) (dx < 0 ? this.app.deck.next() : this.app.deck.prev());
      else (dy < 0 ? this.app.deck.next() : this.app.deck.prev());
      return;
    }
    // Клик / тап — далее
    if (dist < 8 && dt < 600 && d.button === 0) this.app.deck.next();
  }

  onWheel(e) {
    if (this.isInteractive(e.target) || !this.app.started || this.app.ui.modalOpen) return;
    e.preventDefault();
    const now = performance.now();
    if (now < this.wheelLock) return;
    this.wheelAcc += e.deltaY;
    if (Math.abs(this.wheelAcc) > 80) {
      if (this.wheelAcc > 0) this.app.deck.next(); else this.app.deck.prev();
      this.wheelAcc = 0;
      this.wheelLock = now + 900;
    }
  }
}
