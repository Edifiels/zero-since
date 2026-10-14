// Заставка (показывается, пока зал собирается): логотип лаборатории и спикеры.
export const visuals = {};

// Спикеры лекции — правьте здесь.
const SPEAKERS = [
  { name: 'Маркин Евгений Игоревич', role: 'к.т.н., доцент кафедры «Программирование»' },
  { name: 'Зупарова Валентина Владимировна', role: 'старший преподаватель кафедры «Программирование»' },
];

export const slides = [
  {
    id: 'cover',
    block: 0,
    title: 'Заставка: Лаборатория НСИИИ',
    visual: { id: 'cover', state: 'cover' },
    transition: 'fade',
    kicker: false,
    layout: 'l-cover',
    html: `
      <div class="cover-text">
        <div class="reveal" data-anim="halftone"><span class="wordmark cover-wordmark"></span></div>
        <div class="cover-sub reveal" style="--d:.7s">Открытая лекция</div>
        <div class="cover-speakers">
          ${SPEAKERS.map((s, i) => `
          <div class="speaker reveal" data-anim="left" style="--d:${(1.1 + i * 0.25).toFixed(2)}s">
            <div class="speaker-name">${s.name}</div>
            <div class="speaker-role">${s.role}</div>
          </div>`).join('')}
        </div>
      </div>`,
    notes: 'Заставка, пока зал собирается: логотип лаборатории и спикеры — Маркин Евгений Игоревич (к.т.н., доцент кафедры «Программирование») и Зупарова Валентина Владимировна (старший преподаватель кафедры «Программирование»). Логотип собирается из частиц; курсор мыши «раздвигает» частицы. Нажмите «далее», чтобы начать лекцию.',
    time: '00:00',
  },
];
