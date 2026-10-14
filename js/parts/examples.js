// Примеры всех компонентов и базовых визуализаций (не входит в лекцию).
// Открыть: index.html?part=examples
import { chapterSlide } from './common.js';
import { question, quote, counter, caption, statement, vote, stamp, bars, countdown, prize } from '../components/html.js';

export const visuals = {
  'ex-demo': () => import('../visuals/examples/demo.js'),
};

export const slides = [
  chapterSlide({ block: 2, title: 'Две вселенные', subtitle: 'Человеческий мозг против кремниевой нейросети', id: 'ex-chapter', notes: 'Пример титула блока.' }),
  {
    id: 'ex-question',
    block: 2,
    title: 'Пример: вопрос залу',
    visual: { id: 'ambient', state: 'question@right' },
    layout: 'l-left',
    html: question({
      num: 3,
      q: 'Сколько энергии потребляет ваш мозг прямо сейчас?',
      options: ['2 Вт', '20 Вт', '200 Вт', '2000 Вт'],
      correct: 1,
      cols: 2,
      answer: 'Около <b>20 Вт</b> — как тусклая лампочка.',
      prize: 'Приз — за точный ответ',
    }),
    notes: 'Пример вопроса.',
  },
  {
    id: 'ex-counters',
    block: 1,
    title: 'Пример: счётчики',
    visual: { id: 'ambient', state: 'galaxy' },
    layout: 'l-left',
    html: `
      ${counter({ label: 'Звёзд в Галактике', to: 400, unit: 'млрд', step: 0, final: '100–400' })}
      ${counter({ label: 'Нейронов в мозге', to: 86, unit: 'млрд', step: 1, accent: true })}
      ${counter({ label: 'Связей в мозге', to: 100000000000000, step: 2, size: 'small', prefix: '~' })}`,
    notes: 'Пример счётчиков.',
  },
  {
    id: 'ex-vote',
    block: 1,
    title: 'Пример: голосование',
    visual: { id: 'vote-orbs', state: 'demo' },
    layout: 'l-top',
    html: `
      <h2 class="t-h2" data-step="0">Что ИИ сделает с миром?</h2>
      ${vote({ id: 'demo', options: [{ title: 'Захватит', hint: 'выйдет из-под контроля' }, { title: 'Калькулятор', hint: 'бояться нечего' }, { title: 'Уже захватил', hint: 'посмотрите на телефоны' }] })}`,
    notes: 'Пример голосования.',
  },
  {
    id: 'ex-quote',
    block: 1,
    title: 'Пример: цитата',
    visual: { id: 'ambient', state: 'orb@right' },
    transition: 'halftone',
    layout: 'l-left',
    html: quote({ text: 'Планета есть колыбель разума, но нельзя вечно жить в колыбели.', author: 'К. Э. Циолковский', step: 0, anim: 'halftone' }),
    notes: 'Пример цитаты.',
  },
  {
    id: 'ex-misc',
    block: 5,
    title: 'Пример: штампы, полосы, подпись',
    visual: { id: 'ambient', state: 'ring' },
    transition: 'glitch',
    layout: 'l-left',
    html: `
      ${statement('ИИ делает не то, что мы хотели, а то, <span class="accent">за что мы его наградили</span>.', { step: 0 })}
      ${bars([{ label: 'Найдено ИИ', value: 92, text: '> 10 000' }, { label: 'Исправлено', value: 6, text: 'единицы', cls: 'warn' }], { step: 1 })}
      <div class="row" style="gap:calc(var(--u)*3)">${stamp('Без рецензии', { step: 2 })} ${stamp('Списал', { step: 3, rot: 6 })}</div>
      ${caption('Подпись внизу экрана — как в сценарии', { step: 0 })}`,
    notes: 'Пример штампов и полос.',
  },
  {
    id: 'ex-cards',
    block: 4,
    title: 'Пример: карточки-перевёртыши',
    visual: { id: 'ambient', state: 'rays@right' },
    layout: 'l-top',
    html: `
      <h2 class="t-h2" data-step="0">Умеет или пока нет?</h2>
      <div class="cards" style="--cols:3">
        <div class="flip" data-step="1" data-reveal="none"><div class="flip-inner"><div class="flip-front">Решить задачу международной олимпиады</div><div class="flip-back ok">Умеет ✓</div></div></div>
        <div class="flip" data-step="2" data-reveal="none"><div class="flip-inner"><div class="flip-front">Робот завязывает шнурки</div><div class="flip-back ok">Уже да!<span class="flip-note">DeepMind, 2024</span></div></div></div>
        <div class="flip" data-step="3" data-reveal="none"><div class="flip-inner"><div class="flip-front">Убрать незнакомую квартиру</div><div class="flip-back no">Пока нет</div></div></div>
      </div>
      <div class="row mt-2" data-step="3">${prize('Приз — первому правильному ответу')}</div>`,
    notes: 'Пример карточек.',
  },
  {
    id: 'ex-demo',
    block: 6,
    title: 'Пример: меши, подписи, облёт камеры',
    visual: { id: 'ex-demo' },
    layout: 'l-bottom',
    steps: 3,
    html: `${caption('Шаг 0: сцена · 1: камера · 2: подпись · 3: облёт', { step: 0 })}`,
    notes: 'Пример визуализации с подписями.',
  },
  {
    id: 'ex-countdown',
    block: 1,
    title: 'Пример: обратный отсчёт',
    visual: { id: 'ambient', state: 'nebula' },
    transition: 'warp',
    layout: 'l-center',
    html: `<h2 class="t-title" data-step-until="1">Готовы?</h2>${countdown({ from: 3, word: 'Поехали!', step: 1 })}`,
    notes: 'Пример отсчёта.',
  },
];
