// Помощники разметки слайдов. Возвращают HTML-строки — их удобно вставлять в slide.html.
//
//   import { question, quote, counter, caption, statement, vote, stamp, prize, bars } from '../components/html.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attrJSON = (v) => esc(JSON.stringify(v));
const stepAttr = (step, anim, delay) =>
  (step != null ? ` data-step="${step}"` : '') + (anim ? ` data-anim="${anim}"` : '') + (delay ? ` style="--d:${delay}s"` : '');

/**
 * Вопрос залу с вариантами ответа. На шаге answerStep подсвечивается правильный вариант,
 * появляется пояснение и плашка «Приз».
 *   question({ num: 3, q: 'Сколько…?', options: ['2 Вт', '20 Вт', …], correct: 1, answer: 'Мозг — около <b>20 Вт</b>', prize: '…' })
 * options — строки (HTML допустим). correct — индекс или массив индексов (или null — без «правильного»).
 */
export function question({ num = null, badge = 'Вопрос залу', q, options = [], correct = null, answer = '', prize: prizeText = 'Приз — за точный ответ', answerStep = 1, cols = null, long = false, extra = '' } = {}) {
  const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
  const correctSet = new Set(Array.isArray(correct) ? correct : correct == null ? [] : [correct]);
  const n = options.length;
  const c = cols ?? (n <= 4 ? n : 3);
  const opts = options.map((o, i) => `
      <div class="q-option${correctSet.has(i) ? ' is-correct' : ''}" data-step="0" style="--d:${(0.25 + i * 0.12).toFixed(2)}s">
        <span class="q-letter">${letters[i] || i + 1}</span><span class="q-label">${o}</span>
        ${correctSet.has(i) ? '<span class="q-check">✓</span>' : ''}
      </div>`).join('');
  return `
    <div class="q" data-component="question" data-answer-step="${answerStep}">
      <div class="q-badge" data-step="0"><span class="mark"></span>${esc(badge)}${num != null ? ' №' + num : ''}</div>
      <h2 class="q-text${long ? ' is-long' : ''}" data-step="0" style="--d:.1s">${q}</h2>
      ${n ? `<div class="q-options" style="--cols:${c}">${opts}</div>` : ''}
      ${extra}
      ${answer ? `<div class="q-answer" data-step="${answerStep}" style="--d:.35s">${answer}</div>` : ''}
      ${prizeText ? `<div class="row" data-step="${answerStep}" style="--d:.7s"><span class="prize" data-step="${answerStep}" data-reveal="none"><span class="mark"></span>${prizeText}</span></div>` : ''}
    </div>`;
}

/** Большая цитата. */
export function quote({ text, author = '', step = null, anim = null, long = false, delay = 0 } = {}) {
  return `
    <figure class="quote${long ? ' is-long' : ''}"${stepAttr(step, anim, delay)}>
      <div class="q-mark-open">«</div>
      <blockquote>${text}</blockquote>
      ${author ? `<cite>${author}</cite>` : ''}
    </figure>`;
}

/** Крупное утверждение. */
export function statement(text, { step = null, anim = null, delay = 0, cls = '' } = {}) {
  return `<p class="statement ${cls}"${stepAttr(step, anim, delay)}>${text}</p>`;
}

/**
 * Счётчик, который «набирается» при появлении.
 *   counter({ label: 'Нейронов в мозге', to: 86e9, unit: '', step: 1 })
 * format: 'group' — 86 000 000 000; 'plain' — без разрядов. value — показать готовый текст вместо числа в конце.
 */
export function counter({ label = '', to = 0, from = 0, unit = '', prefix = '', decimals = 0, duration = 2.2, step = null, anim = null, delay = 0, countDelay = 0.25, accent = false, size = '', format = 'group', final = '', cls = '' } = {}) {
  const sizeCls = size ? ' is-' + size : '';
  return `
    <div class="counter-block${accent ? ' is-accent' : ''}${sizeCls} ${cls}"${stepAttr(step, anim, delay)}>
      ${label ? `<div class="c-label">${label}</div>` : ''}
      <div class="c-value">${prefix}<span data-component="counter" data-from="${from}" data-to="${to}" data-decimals="${decimals}" data-duration="${duration}" data-delay="${countDelay}" data-format="${format}"${final ? ` data-final="${esc(final)}"` : ''}>${from}</span>${unit ? `<span class="c-unit">${unit}</span>` : ''}</div>
    </div>`;
}

/** Нижняя подпись (как «Подпись: …» в сценарии). */
export function caption(text, { step = null, anim = null, delay = 0, cls = '' } = {}) {
  return `<div class="caption-bar t-caption ${cls}"${stepAttr(step, anim, delay)}><span class="panel" style="display:inline-block;padding:.45em 1.1em;border-radius:999px">${text}</span></div>`;
}

/** Плашка «Приз». */
export function prize(text = 'Приз', { step = null, delay = 0 } = {}) {
  return `<span class="prize"${step != null ? ` data-step="${step}" data-reveal="none"` : ''}${delay ? ` style="--d:${delay}s"` : ''}><span class="mark"></span>${text}</span>`;
}

/** Штамп («Без рецензии», «Списал»). color: 'red' | 'green' | 'orange'. */
export function stamp(text, { step = null, color = 'red', rot = -8, delay = 0, cls = '' } = {}) {
  const c = color === 'red' ? '' : color;
  return `<span class="stamp ${c} ${cls}"${step != null ? ` data-step="${step}" data-reveal="none"` : ''} style="--rot:${rot}deg;${delay ? `--d:${delay}s` : ''}">${text}</span>`;
}

/**
 * Голосование с карточками. Значения хранятся в localStorage до конца лекции.
 *   vote({ id: 'start', options: [{ title: 'Захватит', hint: '…' }, …] })
 * compare — id другого голосования: показать его значения пунктиром («было»).
 * deltaStep — с какого шага показывать разницу; lockStep — с какого шага запретить правку.
 */
export function vote({ id, options = [], compare = null, deltaStep = null, lockStep = null, ghostLabel = 'было', step = null } = {}) {
  return `
    <div class="vote interactive" data-component="vote" data-vote="${esc(id)}" data-options="${attrJSON(options)}"
      ${compare ? `data-compare="${esc(compare)}" data-ghost-label="${esc(ghostLabel)}"` : ''}
      ${deltaStep != null ? `data-delta-step="${deltaStep}"` : ''} ${lockStep != null ? `data-lock-step="${lockStep}"` : ''}
      style="--n:${options.length}"${step != null ? ` data-step="${step}"` : ''}></div>`;
}

/** Полосы-диаграмма: rows = [{ label, value (0..100), text, cls: 'warn'|'danger' }] */
export function bars(rows, { step = null, anim = null } = {}) {
  return `<div class="bars"${stepAttr(step, anim)}>${rows.map((r, i) => `
    <div class="bar-row"${r.step != null ? ` data-step="${r.step}"` : ''}>
      <div class="bar-label">${r.label}</div>
      <div class="bar-track"><div class="bar-fill ${r.cls || ''}" data-bar="${r.value}" style="--d:${(0.2 + i * 0.15).toFixed(2)}s"></div><div class="bar-value" data-bar-value style="--d:${(0.2 + i * 0.15).toFixed(2)}s">${r.text ?? ''}</div></div>
    </div>`).join('')}</div>`;
}

/** Обратный отсчёт 3–2–1 и слово. Событие шины: 'countdown:tick' (n), 'countdown:done'. */
export function countdown({ from = 3, word = 'Поехали!', step = null, interval = 1 } = {}) {
  return `<div class="countdown" data-component="countdown" data-from="${from}" data-word="${esc(word)}" data-interval="${interval}"${step != null ? ` data-step="${step}" data-reveal="none"` : ''}></div>`;
}
