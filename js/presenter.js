// Окно спикера: заметки, таймер с отставанием от плана, следующий слайд, управление.
// Синхронизация с презентацией — через BroadcastChannel (оба окна должны быть открыты с одного адреса).
import { CHANNEL, BLOCKS, STORE_PREFIX } from './config.js';
import { parseTime, fmtTime } from './core/utils.js';

const $ = (id) => document.getElementById(id);
const ch = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
let outline = null;
let state = { index: -1, step: 0 };
let lastVisibleAt = 0;
let visibleSession = null;

// ---------- Таймер (переживает перезагрузку окна) ----------
const TKEY = STORE_PREFIX + 'presenter-timer';
let timer = load() || { start: null, acc: 0, running: false, session: null };
// таймер с прошлой репетиции (старше 4 часов) — сбросить
if (timer.start && Date.now() - timer.start > 4 * 3600 * 1000) timer = { start: null, acc: 0, running: false, session: null };
function load() { try { return JSON.parse(localStorage.getItem(TKEY)); } catch { return null; } }
function save() { try { localStorage.setItem(TKEY, JSON.stringify(timer)); } catch { /* ignore */ } }
function elapsed() { return timer.acc + (timer.running && timer.start ? (Date.now() - timer.start) / 1000 : 0); }
function startTimer() { if (!timer.running) { timer.running = true; timer.start = Date.now(); save(); renderTimer(); } }
function pauseTimer() { if (timer.running) { timer.acc = elapsed(); timer.running = false; timer.start = null; save(); renderTimer(); } }
function resetTimer() { timer = { start: null, acc: 0, running: false, session: timer.session || null }; save(); renderTimer(); }

function renderTimer() {
  $('p-elapsed').textContent = fmtTime(elapsed());
  $('p-timer-btn').textContent = timer.running ? 'Пауза таймера' : 'Старт таймера';
  const now = new Date();
  $('p-clock').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const plan = plannedTime(state.index);
  if (plan != null) {
    $('p-plan').textContent = fmtTime(plan);
    const d = elapsed() - plan;
    const el = $('p-delta');
    if (!timer.running && !timer.acc) { el.textContent = '—'; el.className = 'p-mid'; return; }
    if (Math.abs(d) < 45) { el.textContent = 'по графику'; el.className = 'p-mid p-delta-ok'; }
    else if (d > 0) { el.textContent = 'отстаём ' + fmtTime(d); el.className = 'p-mid ' + (d > 180 ? 'p-delta-bad' : 'p-delta-late'); }
    else { el.textContent = 'опережаем ' + fmtTime(-d); el.className = 'p-mid p-delta-ok'; }
  }
}
setInterval(renderTimer, 500);

// Плановое время слайда: его time, иначе ближайший предыдущий с time, иначе начало блока
function plannedTime(i) {
  if (!outline || i < 0) return null;
  for (let k = i; k >= 0; k--) {
    const s = outline.slides[k];
    if (s.time) return parseTime(s.time);
  }
  const b = BLOCKS.find((x) => x.n === outline.slides[i].block);
  return b ? parseTime(b.time) : null;
}

// ---------- Отрисовка ----------
function render() {
  if (!outline || state.index < 0) return;
  const s = outline.slides[state.index];
  const b = BLOCKS.find((x) => x.n === s.block) || BLOCKS[0];
  $('p-block-num').textContent = b.n ? String(b.n).padStart(2, '0') : '★';
  $('p-block-title').textContent = b.n ? `${b.title} · ${b.time}, ${b.dur} мин` : b.title;
  $('p-num').textContent = `Слайд ${state.index + 1} / ${outline.slides.length}`;
  $('p-steps').innerHTML = s.steps ? Array.from({ length: s.steps + 1 }, (_, k) => `<i class="${k <= state.step ? 'on' : ''}"></i>`).join('') : '';
  $('p-title').textContent = s.title;
  $('p-notes').textContent = s.notes || '—';
  // Дальше
  let nextTitle, nextNotes = '';
  if (state.step < s.steps) {
    nextTitle = `Шаг ${state.step + 2} из ${s.steps + 1} на этом слайде`;
  } else if (state.index < outline.slides.length - 1) {
    const n = outline.slides[state.index + 1];
    nextTitle = `${state.index + 2}. ${n.title}`;
    nextNotes = n.notes || '';
  } else {
    nextTitle = 'Это последний слайд';
  }
  $('p-next-title').textContent = nextTitle;
  $('p-next-notes').textContent = nextNotes;
  // Блоки
  $('p-blocks').innerHTML = BLOCKS.filter((x) => x.n > 0).map((x) => `<div class="b ${x.n === b.n ? 'cur' : x.n < b.n ? 'done' : ''}"><b>${String(x.n).padStart(2, '0')}</b><span>${x.title}</span><span>${x.time}</span></div>`).join('');
  renderTimer();
}

// ---------- Связь с презентацией ----------
function send(msg) { ch?.postMessage(msg); }
if (ch) {
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'outline') { outline = m; render(); }
    else if (m.type === 'state') {
      // открыто несколько вкладок с презентацией (например, с репетиции) — показываем видимую
      if (m.visible === false && Date.now() - lastVisibleAt < 15000 && m.session !== visibleSession) return;
      if (m.visible !== false) { lastVisibleAt = Date.now(); visibleSession = m.session; }
      state = m;
      // новый сеанс показа (перезапуск презентации) — таймер с нуля
      if (m.session && timer.session && m.session !== timer.session && m.started && m.index <= 1) {
        timer = { start: null, acc: 0, running: false, session: m.session }; save();
      }
      if (m.session && !timer.session) { timer.session = m.session; save(); }
      if (m.started && m.index > 0 && !timer.running && !timer.acc) startTimer();
      document.body.classList.toggle('is-curtain', !!m.curtain);
      render();
    }
    else if (m.type === 'error') toast('Презентация: ' + m.msg);
  };
  send({ type: 'hello' });
  setTimeout(() => { if (!outline) toast('Нет связи с презентацией — откройте index.html в этом же браузере'); }, 2500);
  setInterval(() => { if (!outline) send({ type: 'hello' }); }, 3000);
} else {
  toast('Браузер не поддерживает BroadcastChannel');
}

function toast(t) {
  const el = $('p-toast');
  el.textContent = t;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 3500);
}

// ---------- Управление ----------
document.querySelector('.p-controls').addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'next') send({ type: 'nav', action: 'next' });
  else if (a === 'prev') send({ type: 'nav', action: 'prev' });
  else if (a === 'curtain') send({ type: 'nav', action: 'curtain' });
  else if (a === 'timer') (timer.running ? pauseTimer() : startTimer());
  else if (a === 'reset') resetTimer();
  else if (a === 'font') {
    const cur = parseFloat(getComputedStyle(document.body).getPropertyValue('--notes-size')) || 26;
    const next = cur >= 40 ? 20 : cur + 4;
    document.body.style.setProperty('--notes-size', next + 'px');
  }
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key, code = e.code || '';
  // автоповтор (придержанная кнопка кликера) не должен пролистывать несколько слайдов
  if (e.repeat) { if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) e.preventDefault(); return; }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); send({ type: 'nav', action: 'next' }); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); send({ type: 'nav', action: 'prev' }); }
  else if (code === 'KeyB' || code === 'Period') { e.preventDefault(); send({ type: 'nav', action: 'curtain' }); }
  else if (k === 'F5') { e.preventDefault(); }
});
