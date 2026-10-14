// Часть «b6» — Блок 6 «Карточный домик»: хрупкость современного мира (34:00–38:00).
// Все идентификаторы части (слайды, визуализации, CSS-классы) — с префиксом «b6k-»,
// чтобы часть не пересекалась с другими вариантами блока 6 и их стилями.
// Стили части — css/parts/b6.css (подключены в index.html).
import { question, counter, caption } from '../components/html.js';
import { chapterSlide } from './common.js';

export const visuals = {
  'b6k-cards': () => import('../visuals/b6/cards.js'),
  'b6k-globe': () => import('../visuals/b6/globe.js'),
  'b6k-graph': () => import('../visuals/b6/graph.js'),
  'b6k-patches': () => import('../visuals/b6/patches.js'),
  'b6k-aivsai': () => import('../visuals/b6/aivsai.js'),
  'b6k-city': () => import('../visuals/b6/city.js'),
};

export const slides = [
  chapterSlide({
    id: 'b6k-chapter',
    block: 6,
    title: 'Карточный домик',
    subtitle: 'Хрупкость современного мира',
    time: '34:00',
    notes: 'Блок 6 (34:00–38:00, 4 мин). Задача блока: показать, почему ошибки и взломы опаснее, чем кажется: всё связано со всем.\n\nПлан: интерактив №10 → одно обновление (CrowdStrike) → карта мира → граф зависимостей → дыры быстрее заплат → ИИ против ИИ → бонус-вопрос, если есть время.',
  }),

  {
    id: 'b6k-q10',
    block: 6,
    title: 'Вопрос №10: одно обновление',
    visual: { id: 'b6k-cards', state: 'intro' },
    transition: 'morph',
    layout: 'l-left b6k-q10',
    time: '34:30',
    html: question({
      num: 10,
      q: 'Сколько компьютеров уронило одно неудачное обновление в&nbsp;2024&nbsp;году?',
      options: ['850', '85&nbsp;тысяч', '8,5&nbsp;миллиона'],
      correct: 2,
      cols: 3,
      answer: '<b>8,5&nbsp;миллиона</b> компьютеров с&nbsp;Windows.',
      prize: 'Приз — за верный ответ',
    }),
    notes: 'Интерактив с залом №10.\n\nВопрос: «Сколько компьютеров уронило одно неудачное обновление в 2024 году: 850, 85 тысяч или 8,5 миллиона?» Пусть зал проголосует руками за каждый вариант.\n\nКлик — ответ: 8,5 миллиона. Приз — за верный ответ.\n\nСправа — карточный домик (пока со спины). Дальше развернём его и посмотрим, что внизу.',
  },

  {
    id: 'b6k-cards',
    block: 6,
    title: 'Карточный домик',
    visual: { id: 'b6k-cards', state: 'fall' },
    layout: 'l-top-left b6k-cards',
    steps: 2,
    time: '35:00',
    html: `
      <div class="b6k-head" data-step="0">
        <div class="t-kicker">19 июля 2024</div>
        <h2 class="t-h2">Одно неудачное обновление <span class="accent">CrowdStrike</span></h2>
      </div>
      <div class="b6k-cards-total" data-step="2" data-anim="zoom" style="--d:1.9s">
        ${counter({ to: 8.5, decimals: 1, prefix: '~', unit: 'млн', duration: 1.6, countDelay: 2.0, accent: true, size: 'big' })}
        <div class="t-lead">компьютеров с&nbsp;Windows</div>
      </div>`,
    notes: 'Одно обновление.\n\n19 июля 2024 года неудачное обновление CrowdStrike уронило около 8,5 млн компьютеров с Windows. Встали аэропорты, больницы, банки.\n\nКлик 1 — невидимая рука выдёргивает нижнюю карту «Обновление». Домик ещё держится… Клик 2 — домик складывается: ~8,5 млн компьютеров с Windows.',
  },

  {
    id: 'b6k-world',
    block: 6,
    title: 'Карта мира: волна сбоя',
    visual: { id: 'b6k-globe' },
    transition: 'zoomout',
    layout: 'l-left b6k-world',
    steps: 2,
    time: '35:40',
    html: `
      <div class="t-kicker" data-step="0">Карта мира · 19 июля 2024</div>
      <div class="b6k-legend" data-step-until="1"><span class="b6k-dot"></span>аэропорты мира</div>
      <div class="b6k-world-count" data-step="1">
        <div class="b6k-world-num" data-b6k-count>0</div>
        <div class="b6k-world-unit">компьютеров</div>
      </div>
      <p class="b6k-world-stop t-h2" data-step="2" data-split="words">Встали аэропорты, больницы, банки</p>`,
    notes: 'Карта мира. Огни — аэропорты. Клик — сбой идёт волной с востока на запад: точки-аэропорты гаснут, счётчик набирает 8 500 000 компьютеров.\n\nКлик 2 — итог: встали аэропорты, больницы, банки.',
  },

  {
    id: 'b6k-graph',
    block: 6,
    title: 'Граф зависимостей',
    visual: { id: 'b6k-graph' },
    transition: 'morph',
    layout: 'l-bottom b6k-graph',
    steps: 2,
    time: '36:10',
    html: `${caption('<span class="b6k-caption-big">Всё связано со всем</span>', { step: 2, anim: 'zoom', delay: 1.2 })}`,
    notes: 'Граф зависимостей: сервисы связаны стрелками — кто от кого зависит. По рёбрам бегут импульсы — система живёт.\n\nКлик 1 — один узел («Облако») краснеет. Клик 2 — сбой каскадом расходится по графу: платежи, банки, магазины, больницы, аэропорты…\n\nВывод: всё связано со всем.',
  },

  {
    id: 'b6k-race',
    block: 6,
    title: 'Гонка дыр и заплат',
    visual: { id: 'b6k-patches' },
    transition: 'glitch',
    layout: 'l-left b6k-race',
    steps: 1,
    time: '36:40',
    html: `
      <div class="t-kicker" data-step="0">Участники Project Glasswing</div>
      <div class="b6k-race-num" data-step="0" data-b6k-found>0</div>
      <p class="b6k-race-lead" data-step="0" style="--d:.2s">серьёзных уязвимостей нашли с&nbsp;помощью ИИ за&nbsp;месяц</p>
      <div class="b6k-race-more" data-step="1">
        <p class="t-lead">Узкое место теперь не&nbsp;поиск, а&nbsp;<b>проверка и&nbsp;выпуск исправлений</b>.</p>
        <p class="b6k-race-punch" style="--d:.5s">Дыры находятся быстрее, чем их закрывают</p>
      </div>`,
    notes: 'Дыры быстрее заплат.\n\nУчастники Project Glasswing с помощью ИИ за месяц нашли больше 10 000 серьёзных уязвимостей. Красная колонна «найдено ИИ» стремительно растёт, зелёная «исправлено» ползёт у самого основания.\n\nКлик — узкое место теперь не поиск, а проверка и выпуск исправлений. Дыры находятся быстрее, чем их закрывают.',
  },

  {
    id: 'b6k-aivsai',
    block: 6,
    title: 'ИИ против ИИ',
    visual: { id: 'b6k-aivsai' },
    transition: 'morph',
    layout: 'l-left b6k-ai',
    steps: 1,
    time: '37:10',
    html: `
      <h2 class="t-title" data-step="0">ИИ против ИИ</h2>
      <div class="b6k-swap">
        <div class="b6k-swap-a" data-step-until="1">
          <p class="t-lead">Hugging Face отбивался от&nbsp;атакующего ИИ-агента с&nbsp;помощью <b class="accent">открытой китайской модели</b>.</p>
          <p class="b6k-ai-note">Американской помешали её&nbsp;же ограничители.</p>
        </div>
        <div class="b6k-swap-b" data-step="1">
          <div class="t-kicker">Обратная сторона</div>
          <p class="t-lead">Банк с&nbsp;помощью ИИ <b class="accent">остановил мошеннический перевод</b> на&nbsp;1,5&nbsp;млн долларов.</p>
        </div>
      </div>`,
    notes: 'ИИ против ИИ.\n\nHugging Face отбивался от атакующего ИИ-агента с помощью открытой китайской модели: американской помешали её же ограничители. Два агента сталкиваются щит в щит.\n\nКлик — обратная сторона: банк-участник с помощью ИИ остановил мошеннический перевод на 1,5 млн долларов.',
  },

  {
    id: 'b6k-bonus',
    block: 6,
    title: 'Бонус-вопрос: город без интернета',
    visual: { id: 'b6k-city' },
    transition: 'zoom',
    layout: 'l-left b6k-bonus',
    steps: 1,
    time: '37:40',
    html: `
      ${question({
        badge: 'Бонус-вопрос',
        q: 'Что в&nbsp;нашем городе сломается первым, если интернет пропадёт на&nbsp;сутки?',
        options: [],
        answerStep: 0,
        prize: 'Приз — за лучший ответ',
      })}
      <div class="b6k-offline" data-step="1" data-anim="fade"><span class="b6k-offline-dot"></span>Сутки без интернета</div>`,
    notes: 'Бонус, если есть время.\n\nВопрос залу: «Что в нашем городе сломается первым, если интернет пропадёт на сутки?» Приз — за лучший ответ.\n\nКлик — над городом рассыпается «сеть», огни мерцают и гаснут кварталами. Собрать ответы зала.',
  },
];
