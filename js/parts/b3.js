// Часть «b3» — Блок 3 «Муха в матрице»: первый оцифрованный мозг (14:00–21:00).
// Задача блока: показать, насколько близко наука подошла к копированию мозга, и научить отличать прорыв от шумихи.
import { question, caption, counter, vote, stamp } from '../components/html.js';
import { chapterSlide } from './common.js';

// Пиксельная «мордочка» мухи для HUD ретро-шутера (16×16, рисуется один раз)
function pixelFace(hurt) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(4, 3, 8, 11, '#0b3d0b');            // голова
  px(3, 5, 10, 7, '#0b3d0b');
  for (const x of [1, 10]) {             // фасеточные глаза
    px(x, 3, 5, 7, '#1f7a1f');
    px(x + 1, 2, 3, 9, '#1f7a1f');
    if (!hurt) { px(x + 1, 4, 2, 2, '#b6ffb0'); px(x + 3, 6, 1, 1, '#3fd23f'); }
    else { px(x + 1, 4, 1, 1, '#b6ffb0'); px(x + 3, 4, 1, 1, '#b6ffb0'); px(x + 2, 5, 1, 1, '#b6ffb0'); px(x + 1, 6, 1, 1, '#b6ffb0'); px(x + 3, 6, 1, 1, '#b6ffb0'); }
  }
  px(7, 2, 1, 2, '#3fd23f'); px(8, 1, 1, 2, '#3fd23f');   // усики
  px(7, 12, 2, 3, '#3fd23f');                              // хоботок
  if (hurt) px(6, 10, 4, 1, '#b6ffb0');
  return c.toDataURL();
}

export const visuals = {
  'b3-fly': () => import('../visuals/b3/fly.js'),
  'b3-connectome': () => import('../visuals/b3/connectome.js'),
  'b3-hype': () => import('../visuals/b3/hype.js'),
  'b3-doom': () => import('../visuals/b3/doom.js'),
  'b3-ladder': () => import('../visuals/b3/ladder.js'),
};

export const slides = [
  chapterSlide({
    block: 3,
    title: 'Муха в матрице',
    subtitle: 'Первый оцифрованный мозг',
    time: '14:00',
    notes: 'Блок 3 (7 мин). Задача: показать, насколько близко наука подошла к копированию мозга, и научить отличать прорыв от шумихи. '
      + 'План: вопрос про число нейронов мухи → карта мозга (2024) → модель на ноутбуке → виртуальное тело (март 2026) → проверка шумихи → курьёз с DOOM → лестница масштабов → голосование.',
  }),

  {
    id: 'b3-q5',
    block: 3,
    title: 'Вопрос №5: сколько нейронов у мухи?',
    visual: { id: 'b3-fly', state: 'hover' },
    layout: 'l-left',
    time: '14:30',
    html: question({
      num: 5,
      q: 'Сколько нейронов у&nbsp;мухи?',
      options: ['Тысяча', '140&nbsp;тысяч', 'Миллион', 'Миллиард'],
      correct: 1,
      cols: 2,
      answer: 'Около <b>140&nbsp;тысяч</b> (точнее&nbsp;— 139&nbsp;255).',
      prize: 'Приз&nbsp;— за верный ответ',
    }),
    notes: 'Интерактив №5 (1 мин). Спросите ДО того, как прозвучит число: «Сколько нейронов у мухи: тысяча, 140 тысяч, миллион или миллиард?» '
      + 'Пусть зал проголосует руками за каждый вариант. Клик — ответ: около 140 тысяч (точнее — 139 255). Приз — за верный ответ.',
  },

  {
    id: 'b3-scale',
    block: 3,
    title: 'Масштаб: мозг меньше миллиметра',
    visual: { id: 'b3-fly', state: 'scale' },
    layout: 'l-top-left',
    steps: 1,
    time: '15:00',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Масштаб</div>
      <h2 class="t-title b3-title" data-step="0" style="--d:.15s">Дрозофила</h2>
      <p class="t-lead b3-lead" data-step="0" style="--d:.35s">плодовая мушка</p>
      ${caption('Сам мозг мухи&nbsp;— <b>меньше миллиметра</b>', { step: 1, cls: 'b3-cap-big', delay: 1.2 })}`,
    notes: 'Сам мозг мухи меньше миллиметра. Клик — зум в голову: рядом линейка, мозг — меньше 1 мм.',
  },

  {
    id: 'b3-connectome',
    block: 3,
    title: 'Карта мозга (2024)',
    visual: { id: 'b3-connectome', state: 'map' },
    transition: 'zoom',
    layout: 'l-left',
    steps: 2,
    time: '15:30',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Карта мозга · 2024</div>
      <div class="b3-stack">
        <div data-step-only="0" style="--d:.2s">
          <h2 class="t-title b3-title">Тысячи тончайших срезов</h2>
          <p class="t-lead b3-lead">микрофотографии мозга мухи</p>
        </div>
        <div data-step-only="1" style="--d:.15s">
          <h2 class="t-title b3-title b3-title-md">ИИ&nbsp;раскрашивает каждый нейрон своим цветом</h2>
        </div>
        <div class="b3-counters" data-step="2" style="--d:.5s">
          ${counter({ label: 'нейронов', to: 139255, duration: 2.4, countDelay: 0.6, accent: true })}
          ${counter({ label: 'синапсов', to: 54.5, decimals: 1, unit: 'млн', duration: 2.4, countDelay: 1.0 })}
        </div>
      </div>
      ${caption('2024: учёные вместе с&nbsp;ИИ составили <b>полную карту мозга дрозофилы</b>', { step: 2, cls: 'b3-cap-big', delay: 1.4 })}`,
    notes: 'Карта мозга (2024). Учёные вместе с ИИ составили полную карту мозга дрозофилы — 139 255 нейронов и 54,5 млн синапсов. '
      + 'Сейчас: мозг расслаивается на тысячи тончайших срезов-микрофотографий. Клик 1: ИИ раскрашивает каждый нейрон своим цветом. '
      + 'Клик 2: из стопки срезов собирается цветное 3D-облако нейронов, счётчики.',
  },

  {
    id: 'b3-taste',
    block: 3,
    title: 'Модель на ноутбуке: вкус',
    visual: { id: 'b3-connectome', state: 'taste' },
    layout: 'l-left',
    steps: 2,
    time: '16:30',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Модель на ноутбуке</div>
      <div class="b3-stack">
        <div data-step-only="0" style="--d:.2s">
          <h2 class="t-title b3-title">Капля сахара&nbsp;— на&nbsp;лапку</h2>
        </div>
        <div data-step-only="1" style="--d:.15s">
          <h2 class="t-title b3-title">Волна по мозгу</h2>
          <p class="t-lead b3-lead">от вкусовых нейронов&nbsp;—<br>к&nbsp;моторному нейрону</p>
        </div>
        <div data-step="2" style="--d:.15s">
          <h2 class="t-title b3-title">Хоботок вытягивается</h2>
          <p class="t-lead b3-lead">модель воспроизвела, как муха начинает есть</p>
        </div>
      </div>
      ${caption('Модель на ноутбуке: <b>91% совпадений с&nbsp;опытами</b> (164&nbsp;проверки)', { step: 2, cls: 'b3-cap-big', delay: 1.4 })}`,
    notes: 'Модель на ноутбуке. Модель всего этого мозга запустили на ноутбуке. Она воспроизвела, как муха начинает есть и чистить усики, '
      + 'и совпала с опытами в 91% из 164 проверок. Сейчас: на лапку падает капля сахара. '
      + 'Клик 1: от вкусовых нейронов по мозгу бежит волна вспышек и доходит до моторного нейрона. Клик 2: хоботок вытягивается.',
  },

  {
    id: 'b3-body',
    block: 3,
    title: 'Виртуальное тело (март 2026)',
    visual: { id: 'b3-fly', state: 'walk' },
    layout: 'l-top-left',
    steps: 1,
    time: '17:15',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Копия мозга + тело</div>
      <h2 class="t-title b3-title" data-step="0" style="--d:.15s">Виртуальное тело</h2>
      ${caption('Март 2026: стартап Eon Systems подключил копию мозга к&nbsp;виртуальному телу&nbsp;— <b>по заявлению компании</b>, без всякого обучения', { step: 0, delay: 0.9 })}`,
    notes: 'Виртуальное тело (март 2026). Стартап Eon Systems подключил копию мозга к виртуальному телу: муха ходит, чистится, ищет еду — '
      + 'по заявлению компании, без всякого обучения. Покажите трёхногую походку: три лапы на земле, три в воздухе. '
      + 'Клик: муха останавливается и чистит усики передними лапками.',
  },

  {
    id: 'b3-hype',
    block: 3,
    title: 'Проверка хайпа',
    visual: { id: 'b3-hype' },
    transition: 'glitch',
    layout: 'l-left',
    steps: 3,
    time: '18:00',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Проверка хайпа</div>
      <div class="b3-stack b3-hype-col">
        <div data-step-only="0" style="--d:.3s">
          <h2 class="t-title b3-title">Громкий заголовок</h2>
          <p class="t-lead b3-lead">проверим, что за ним стоит</p>
        </div>
        <div data-step-only="1" style="--d:.5s">
          <h2 class="t-title b3-title">Не&nbsp;проверено</h2>
          <p class="t-lead b3-lead">нет рецензируемой статьи и&nbsp;проверяемого метода</p>
        </div>
        <div data-step-only="2" style="--d:.5s">
          <h2 class="t-title b3-title">Случайная сеть тоже ходит</h2>
          <p class="t-lead b3-lead">если подключить её к&nbsp;той&nbsp;же модели тела</p>
        </div>
        <div data-step="3" style="--d:.4s">
          <h2 class="t-title b3-title">«Сфинкс»</h2>
          <p class="t-lead b3-lead">мозг червя + тело мухи&nbsp;—<br>и&nbsp;муха всё равно идёт</p>
        </div>
      </div>
      <div class="b3-hype-stamps" data-step-until="3" data-anim="fade">
        ${stamp('Без рецензии', { step: 1, color: 'orange', rot: -6, cls: 'b3-st1' })}
        ${stamp('Ходьбу делает<br>модель тела', { step: 2, color: 'orange', rot: 5, cls: 'b3-st2' })}
      </div>
      ${caption('В ответном препринте телом мухи управлял <b>мозг червя&nbsp;— 302&nbsp;нейрона</b>', { step: 3, cls: 'b3-cap-big', delay: 1.6 })}`,
    notes: 'Проверка шумихи. Громкое заявление вышло без рецензируемой статьи и проверяемого метода (клик 1 — штамп «Без рецензии»). '
      + 'Учёные заметили, что ходить может и случайная сеть, подключённая к той же модели тела (клик 2 — штамп «Ходьбу делает модель тела»). '
      + 'Клик 3 — «сфинкс»: в ответном препринте телом мухи управлял мозг червя (302 нейрона), и муха всё равно шла. '
      + 'Умение ходить в основном зашито в саму модель тела.',
  },

  {
    id: 'b3-doom',
    block: 3,
    title: 'Курьёз: муха играет в DOOM',
    visual: { id: 'b3-doom' },
    transition: 'glitch',
    layout: 'l-center',
    steps: 1,
    time: '18:45',
    html: `
      <div class="b3-doom">
        <div class="b3-doom-top t-pixel"><span class="b3-doom-msg" data-doom="msg">УРОВЕНЬ 1: КОРИДОР</span></div>
        <div class="b3-doom-hud t-pixel">
          <div class="b3-hud-cell"><b data-doom="hp">100%</b><span>ЗДОРОВЬЕ</span></div>
          <div class="b3-hud-face" data-doom="face"></div>
          <div class="b3-hud-cell"><b data-doom="hits">0</b><span>УДАРЫ</span></div>
        </div>
        <div class="b3-doom-bad t-pixel" data-step="1" data-anim="zoom">ПЛОХО</div>
      </div>
      ${caption('Сентябрь 2026: мозг мухи играет в&nbsp;DOOM. <b class="b3-bad-word" data-step="1" data-anim="fade">Плохо</b>', { step: 0, cls: 'b3-cap-big', delay: 0.8 })}`,
    mount(el) {
      const face = el.querySelector('.b3-hud-face');
      if (face) {
        face.style.setProperty('--face', `url(${pixelFace(false)})`);
        face.style.setProperty('--face-hurt', `url(${pixelFace(true)})`);
      }
    },
    notes: 'Курьёз. В сентябре 2026 года энтузиаст подключил цифровую муху к игре DOOM — играет она плохо. '
      + 'Муха растерянно врезается в стены (счётчик ударов на экране растёт сам). Клик — «Плохо».',
  },

  {
    id: 'b3-ladder',
    block: 3,
    title: 'Лестница масштабов',
    visual: { id: 'b3-ladder' },
    layout: 'l-top-left',
    steps: 4,
    time: '19:00',
    html: `
      <div class="t-kicker b3-kicker" data-step="0"><span class="mark"></span>Что дальше</div>
      <h2 class="t-h2 b3-ladder-title" data-step="0" style="--d:.15s">Лестница масштабов</h2>
      <p class="t-lead b3-lead" data-step-until="4" style="--d:.3s">нейронов в мозге</p>
      ${caption('Следующая цель&nbsp;— мышь: <b>в&nbsp;560&nbsp;раз больше нейронов</b>, чем у&nbsp;мухи. До&nbsp;человека ещё очень далеко', { step: 4, cls: 'b3-cap-big', delay: 0.9 })}`,
    notes: 'Что дальше. Шкала логарифмическая: каждая ступень — в сотни и тысячи раз больше нейронов. '
      + 'Клики: червь — 302 → муха — 140 тыс. → мышь — около 70 млн → человек — 86 млрд (уходит в облака). '
      + 'Последний клик: следующая цель — мышь, около 70 млн нейронов, в 560 раз больше, чем у мухи. До человека с его 86 млрд ещё очень далеко.',
  },

  {
    id: 'b3-vote',
    block: 3,
    title: 'Голосование №6: копия мозга — это ты?',
    visual: { id: 'vote-orbs', state: 'copy' },
    transition: 'halftone',
    layout: 'l-top',
    time: '19:30',
    html: `
      <div class="b3-vote-head" data-step="0">
        <div class="q-badge"><span class="mark"></span>Голосование №6</div>
        <h2 class="t-h2 b3-vote-q">Если скопировать все связи мозга в&nbsp;компьютер — это будет та же муха? А&nbsp;если так скопируют вас — это будете&nbsp;вы?</h2>
      </div>
      ${vote({ id: 'copy', options: [{ title: 'Да' }, { title: 'Нет' }, { title: 'Не знаю' }] })}
      ${caption('Правильного ответа нет&nbsp;— об этом спорят философы. <b>Приз&nbsp;— за самый сильный аргумент</b>', { step: 0, delay: 0.6, cls: 'b3-vote-note' })}`,
    notes: 'Интерактив №6 (2 мин). «Если скопировать все связи мозга в компьютер — это будет та же муха? А если так скопируют вас — это будете вы?» '
      + 'Голосование «да / нет / не знаю»: выставьте доли кликом по карточкам. Затем 2–3 мнения из зала. '
      + 'Комментарий: правильного ответа нет, об этом спорят философы. Приз — за самый сильный аргумент.',
  },
];
