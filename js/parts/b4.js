// Часть «b4» — Блок 4 «Сверхспособности»: что ИИ уже умеет (21:00–26:00).
// Слайды: титул → лента времени 1943→2026 → белок и Нобель → Mythos и уязвимости → парадокс Моравека → блиц №7.
import { chapterSlide } from './common.js';
import { caption, prize, counter } from '../components/html.js';
import { MILESTONES } from '../visuals/b4/data.js';

export const visuals = {
  'b4-timeline': () => import('../visuals/b4/timeline.js'),
  'b4-protein': () => import('../visuals/b4/protein.js'),
  'b4-cyber': () => import('../visuals/b4/cyber.js'),
  'b4-frontier': () => import('../visuals/b4/frontier.js'),
  'b4-blitz': () => import('../visuals/b4/blitz.js'),
};

// Панель «текущая веха» на ленте времени (по одной на шаг)
const tlItems = MILESTONES.map((m, i) => `
  <div class="b4-tl-item" data-step-only="${i}" style="--d:${i ? '.35s' : '.2s'}">
    <div class="b4-tl-year">${m.y}</div>
    <div class="b4-tl-name">${m.name}</div>
    ${m.sub ? `<div class="b4-tl-sub">${m.sub}</div>` : ''}
  </div>`).join('');

// Блиц «Умеет или пока нет?» (галочка — SVG: в шрифтах презентации нет глифа ✓, а системный выглядит как «√»)
const CHECK = '<svg class="b4-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.8l5.1 5.1L20 7"/></svg>';
const BLITZ = [
  { q: 'Решить задачу международной олимпиады', a: `Умеет${CHECK}`, ok: true },
  { q: 'Найти ошибку, которую люди не&nbsp;видели 27&nbsp;лет', a: `Умеет${CHECK}`, ok: true },
  { q: 'Предсказать форму белка', a: `Умеет${CHECK}`, note: 'за&nbsp;это дали Нобелевку', ok: true },
  { q: 'Робот завязывает шнурки', a: 'Уже да!', note: 'DeepMind, 2024', ok: true, wow: true },
  { q: 'Убрать квартиру, в&nbsp;которой робот впервые', a: 'Пока плохо', ok: false },
];
const blitzCards = BLITZ.map((c, i) => `
  <div class="flip b4-bz-card${c.wow ? ' is-wow' : ''}" data-step="${i + 1}" data-reveal="none" data-n="${i + 1}">
    <div class="flip-inner">
      <div class="flip-front">
        <span class="b4-bz-num">${i + 1}</span>
        <span class="b4-bz-q">${c.q}</span>
        <span class="b4-bz-mark">?</span>
      </div>
      <div class="flip-back ${c.ok ? 'ok' : 'no'}">
        <span class="b4-bz-num">${i + 1}</span>
        <span class="b4-bz-q">${c.q}</span>
        <span class="b4-bz-a"><span class="b4-bz-v">${c.a}</span>${c.note ? `<span class="b4-bz-note">${c.note}</span>` : ''}</span>
      </div>
    </div>
  </div>`).join('');

// Титул блока. Одной строкой «Сверхспособности» не помещается в колонку титула (44.5u) даже кеглем ядра для длинных
// слов (3.9u → ≈47u), поэтому переносим по морфемам: «Сверх-/способности» — крупно, как титулы других блоков
// (5.3u, самая длинная строка ≈44u; стиль — .chapter-title:has(br) в css/parts/b4.css).
const chapter = chapterSlide({
  block: 4,
  title: 'Сверхспособности',
  subtitle: 'Что ИИ уже умеет',
  time: '21:00',
  notes: 'Блок 4 (21:00–26:00, 5 мин). Задача блока: показать реальную мощь ИИ и его «рваную» границу — в чём-то он сильнее человека, в чём-то беспомощен.',
});
chapter.html = chapter.html.replace('>Сверхспособности</h1>', '>Сверх-<br>способности</h1>');

export const slides = [
  chapter,

  {
    id: 'b4-timeline',
    block: 4,
    title: 'Лента времени 1943 → 2026',
    visual: { id: 'b4-timeline' },
    transition: 'morph',
    layout: 'l-top-left b4-tl',
    steps: 9,
    time: '21:30',
    html: `
      <div class="b4-tl-head" data-step="0" data-anim="left">
        <div class="t-kicker">Лента времени</div>
        <h2 class="t-title">1943 <span class="accent">→</span> 2026</h2>
      </div>
      <div class="b4-tl-panel" data-step-until="9">${tlItems}</div>
      ${caption('Промежутки между вехами сжимаются&nbsp;— <b class="accent">ИИ ускоряется</b>', { step: 9, cls: 'b4-tl-caption' })}`,
    notes: 'Лента времени 1943 → 2026. Расстояния между вехами пропорциональны годам. Каждый клик — новая веха: '
      + '1943 — нейрон впервые описали математически; 1958 — персептрон Розенблатта; Deep Blue (1997); AlexNet (2012); AlphaGo (2016); '
      + 'ChatGPT (2022); Нобелевские премии (2024: по физике — Хопфилду и Хинтону за нейросети, по химии — за AlphaFold); '
      + 'олимпиада (2025: результат уровня золотой медали); Mythos (2026). '
      + 'Последний клик — общий план: промежутки между вехами сжимаются (39 лет → 15 → 4 → 6 → 2 → 1 → 1) — видно ускорение.',
  },

  {
    id: 'b4-protein',
    block: 4,
    title: 'Наука: белок, Нобель, олимпиада',
    visual: { id: 'b4-protein' },
    transition: 'zoom',
    layout: 'l-left b4-pr',
    steps: 3,
    time: '22:30',
    html: `
      <div class="b4-pr-stack">
        <div class="b4-pr-a" data-step-until="3">
          <h2 class="t-title b4-pr-title" data-step="0" data-anim="left">Белок&nbsp;— цепочка <span class="accent">аминокислот</span></h2>
          <p class="t-lead b4-pr-lead" data-step="1"><b class="accent">AlphaFold</b> предсказал форму почти всех известных белков</p>
          <div class="b4-pr-chip" data-step="2"><span class="chip b4-chip-big">Нобелевская премия по химии · 2024</span></div>
        </div>
        <div class="b4-pr-b" data-step="3" style="--d:.5s">
          <div class="b4-pr-year">2025</div>
          <p class="t-lead b4-pr-imo">ИИ впервые показал на&nbsp;<b>Международной математической олимпиаде</b> результат уровня <b class="accent">золотой медали</b></p>
        </div>
      </div>`,
    notes: 'Наука. Шаг 0: белок — цепочка аминокислот. Клик 1: цепочка сама сворачивается в объёмный клубок — '
      + 'AlphaFold предсказал форму почти всех известных белков. Клик 2: медаль — это принесло Нобелевскую премию по химии 2024 года. '
      + 'Клик 3: в 2025-м ИИ впервые показал на Международной математической олимпиаде результат уровня золотой медали.',
  },

  {
    id: 'b4-cyber',
    block: 4,
    title: 'Кибербезопасность (2026): Mythos',
    visual: { id: 'b4-cyber' },
    transition: 'glitch',
    layout: 'l-left b4-cy',
    steps: 4,
    time: '23:15',
    html: `
      <div class="b4-cy-head" data-step="0" data-anim="left">
        <div class="t-kicker">Кибербезопасность · 2026</div>
        <h2 class="t-title b4-cy-title">Claude <span class="accent">Mythos</span> Preview</h2>
      </div>
      <div class="b4-cy-stack">
        <p class="t-lead b4-cy-t" data-step-only="0" style="--d:.4s">Поиск неизвестных уязвимостей в&nbsp;коде</p>
        <p class="t-lead b4-cy-t" data-step-only="1" style="--d:.35s"><b class="b4-red">Тысячи</b> неизвестных уязвимостей во&nbsp;всех основных ОС и&nbsp;браузерах</p>
        <p class="t-lead b4-cy-t" data-step-only="2" style="--d:.35s">Несколько дыр в&nbsp;ядре <b>Linux</b> модель сама связала в&nbsp;цепочку&nbsp;— <span class="b4-red">до&nbsp;полного контроля над машиной</span></p>
        <div class="b4-cy-t b4-cy-age" data-step-only="3" style="--d:.35s">
          <p class="t-lead">Одной из&nbsp;найденных ошибок, в&nbsp;<b>OpenBSD</b>, было</p>
          ${counter({ to: 27, unit: 'лет', duration: 1.6, countDelay: 0.75, cls: 'b4-cy-counter' })}
        </div>
        <p class="t-lead b4-cy-t b4-cy-lock" data-step-only="4" style="--d:.5s">Разработчик решил <b class="accent">не выпускать</b> модель в&nbsp;открытый доступ</p>
      </div>`,
    notes: 'Кибербезопасность (2026). Модель Claude Mythos Preview нашла тысячи неизвестных уязвимостей во всех основных операционных системах и браузерах (клик 1). '
      + 'Несколько дыр в ядре Linux она сама связала в цепочку — от обычного пользователя до полного контроля над машиной (клик 2). '
      + 'Одной из найденных ошибок, в OpenBSD, было 27 лет (клик 3). Разработчик решил не выпускать её в открытый доступ (клик 4).',
  },

  {
    id: 'b4-moravec',
    block: 4,
    title: 'Парадокс Моравека и рваная граница',
    visual: { id: 'b4-frontier' },
    transition: 'halftone',
    layout: 'l-left b4-mv',
    steps: 1,
    time: '24:00',
    html: `
      <div class="b4-mv-a" data-step-until="1">
        <div class="t-kicker" data-step="0">Парадокс Моравека</div>
        <p class="b4-mv-p" data-step="0" style="--d:.2s">Трудное для нас&nbsp;— <span class="accent">олимпиады, белки, поиск ошибок</span>&nbsp;— ИИ&nbsp;даётся <b>легко</b>.</p>
        <p class="b4-mv-p" data-step="0" style="--d:1.1s">А&nbsp;то, что умеет любой трёхлетка,&nbsp;— <span class="b4-warn">пройти по&nbsp;незнакомой квартире, не&nbsp;уронить чашку</span>&nbsp;— до&nbsp;сих&nbsp;пор <b>трудно</b>.</p>
      </div>
      <div class="b4-mv-b" data-step="1" style="--d:.6s">
        <div class="t-kicker">Парадокс Моравека</div>
        <h2 class="t-title">Рваная граница</h2>
      </div>`,
    notes: 'Парадокс Моравека. Трудное для нас — олимпиады, белки, поиск ошибок — ИИ даётся легко. А то, что умеет любой трёхлетка, — '
      + 'пройти по незнакомой квартире, не уронить чашку — до сих пор трудно. '
      + 'Клик: «рваная граница». По горизонтали — задачи, светящаяся пунктирная плоскость — уровень человека. '
      + 'Линия ИИ зубчатая: пики над плоскостью (олимпиада, белки, уязвимости), провалы под ней (уборка, здравый смысл).',
  },

  {
    id: 'b4-blitz',
    block: 4,
    title: 'Интерактив №7: блиц «Умеет или пока нет?»',
    visual: { id: 'b4-blitz' },
    transition: 'morph',
    layout: 'l-top-left b4-bz',
    steps: 5,
    time: '24:30',
    html: `
      <div class="b4-bz-head" data-step="0">
        <div class="b4-bz-top"><div class="q-badge"><span class="mark"></span>Вопрос залу №7 · блиц</div>${prize('Приз&nbsp;— первому правильному ответу', { step: 0, delay: 0.7 })}</div>
        <h2 class="t-title b4-bz-title">Умеет или пока нет?</h2>
      </div>
      <div class="b4-bz-list">${blitzCards}</div>`,
    notes: 'Интерактив №7 (2 мин) — блиц «Умеет или пока нет?». Зачитайте карточку — зал отвечает хором, приз первому правильному; '
      + 'кликом переворачиваете карточку. 1) Решить задачу международной олимпиады → умеет. 2) Найти ошибку, которую люди не видели 27 лет → умеет. '
      + '3) Предсказать форму белка → умеет, за это дали Нобелевскую премию. 4) Робот завязывает шнурки → уже да (DeepMind, 2024) — сюрприз! '
      + '5) Убрать квартиру, в которой робот впервые → пока плохо.',
  },
];
