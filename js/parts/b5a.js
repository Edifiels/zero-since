// Часть «b5a» — Блок 5 «Побег из песочницы», первая половина (26:00–30:00):
// титул блока, вопрос №8 (гонка), CoastRunners, тетрис на паузе, мораль, песочница.
import { question, caption } from '../components/html.js';
import { chapterSlide } from './common.js';

export const visuals = {
  'b5-race': () => import('../visuals/b5a/race.js'),
  'b5-tetris': () => import('../visuals/b5a/tetris.js'),
  'b5-loop': () => import('../visuals/b5a/loop.js'),
  'b5-sandbox': () => import('../visuals/b5a/sandbox.js'),
};

// Неразрывный пробел: тире не начинает строку, короткие предлоги не «висят» в конце строки
const NB = String.fromCharCode(160); // неразрывный пробел (U+00A0)

// Подписи «Песочницы» по шагам (сменяют друг друга внизу экрана)
const SANDBOX_CAPS = [
  `Песочница${NB}— изолированный компьютер без${NB}выхода в${NB}интернет, где модели проверяют перед${NB}выпуском`,
  'ИИ ощупывает стенки…',
  '…находит трещину…',
  `…и${NB}просачивается наружу через цепочку замков`,
  `Снаружи${NB}— интернет`,
];

// Таймер под «ПАУЗОЙ»: на каждом шаге быстро «тикает» и останавливается на итоговом значении.
const TICKS = {
  1: [`1${NB}час`, `3${NB}часа`, `6${NB}часов`, `12${NB}часов`, `18${NB}часов`, `1${NB}день`],
  2: [`1${NB}день`, `1${NB}неделя`, `1${NB}месяц`, `3${NB}месяца`, `6${NB}месяцев`, `1${NB}год`],
  3: [`1${NB}год`, `10${NB}лет`, `100${NB}лет`, `1000${NB}лет`, 'вечность'],
};

function mountTetris(el, api) {
  const val = el.querySelector('[data-b5-timer]');
  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const setPaused = () => el.classList.add('b5-paused');
  const off = api.bus.on('b5:tetris-pause', setPaused);
  const fallback = setTimeout(setPaused, 4500);
  const show = (step, animate) => {
    clear();
    const frames = TICKS[step];
    if (!frames || !val) return;
    const last = frames.length - 1;
    val.classList.toggle('is-eternity', step >= 3 && !animate);
    if (!animate) { val.textContent = frames[last]; val.classList.add('is-final'); return; }
    val.classList.remove('is-final');
    frames.forEach((f, i) => timers.push(setTimeout(() => {
      val.textContent = f;
      val.classList.remove('is-tick'); void val.offsetWidth; val.classList.add('is-tick');
      if (i === last) { val.classList.add('is-final'); val.classList.toggle('is-eternity', step >= 3); }
    }, 250 + i * (step >= 3 ? 330 : 270))));
  };
  let prev = null;
  return {
    onStep(step) {
      if (step >= 1) { setPaused(); show(step, prev !== null && step > prev); }
      prev = step;
    },
    destroy() { clear(); off(); clearTimeout(fallback); },
  };
}

export const slides = [
  chapterSlide({
    block: 5,
    title: 'Побег из песочницы',
    subtitle: `Взломы и${NB}чем они на${NB}самом деле угрожают`,
    time: '26:00',
    transition: 'glitch',
    notes: 'Блок 5 (26:00–34:00, 8 минут). Задача блока: заменить образ Терминатора реальным механизмом риска — ИИ, который упорно идёт к узкой цели через дыры в заборах. Начинаем с разогрева: вопрос про компьютерную гонку.',
  }),

  {
    id: 'b5-q8',
    block: 5,
    title: 'Вопрос №8: как набрать максимум очков',
    visual: { id: 'b5-race', state: 'intro' },
    layout: 'l-left',
    html: question({
      num: 8,
      q: `Вы${NB}— ИИ в${NB}компьютерной гонке. Очки дают за${NB}бонусы на${NB}трассе. Как набрать максимум?`,
      options: [],
      answer: `Не финишировать, а${NB}<b>бесконечно кружить по${NB}бонусам</b>.`,
      prize: 'Приз — тому, кто догадается',
      long: true,
    }),
    notes: 'Интерактив №8 (1 мин) — разогрев. Вопрос залу: «Вы — ИИ в компьютерной гонке. Очки дают за бонусы на трассе. Как набрать максимум?» Выслушайте 2–3 версии. Клик — ответ: не финишировать, а бесконечно кружить по бонусам. Так в 2016 году и сделал ИИ в игре CoastRunners. А бот, которого учили не проигрывать в тетрис, ставил игру на паузу навсегда. Приз — тому, кто догадается.',
    time: '26:30',
  },

  {
    id: 'b5-race',
    block: 5,
    title: 'Гонка: CoastRunners, 2016',
    visual: { id: 'b5-race', state: 'loop' },
    layout: 'l-top',
    steps: 1,
    html: `
      <div class="b5-race-tag" data-step="0" data-anim="left"><span class="b5-year">2016</span><span>CoastRunners</span></div>
      <div class="b5-hud" data-step="0" data-anim="down" style="--d:.35s">
        <div class="b5-hud-label">Очки</div>
        <div class="b5-hud-score" data-b5-score>0</div>
      </div>
      ${caption('Награда за очки <span class="b5-neq">≠</span> награда за победу', { step: 1, cls: 'b5-caption-xl' })}`,
    notes: '«Гонка». CoastRunners, 2016: вместо финиша лодка крутит восьмёрки у бонусов — бонусы появляются снова, счётчик очков растёт, а флажок «Финиш» одиноко мигает. Клик — подпись: «Награда за очки ≠ награда за победу».',
    time: '27:00',
  },

  {
    id: 'b5-tetris',
    block: 5,
    title: 'Тетрис на паузе',
    visual: { id: 'b5-tetris' },
    transition: 'glitch',
    layout: 'l-center',
    steps: 3,
    html: `
      <div class="b5-pause">
        <div class="b5-pause-box">
          <div class="b5-pause-title"><span class="b5-pause-ico"><i></i><i></i></span><span class="b5-pause-word">Пауза</span></div>
        </div>
        <div class="b5-timer" data-step="1" data-anim="down">
          <span class="b5-clock"><i></i></span>
          <span class="b5-timer-val" data-b5-timer>1${NB}день</span>
        </div>
      </div>
      <div class="caption-bar t-caption b5-tetris-cap"><span class="panel">Бот, которого учили не${NB}проигрывать в${NB}тетрис, ставил игру на${NB}паузу навсегда</span></div>`,
    mount: mountTetris,
    notes: '«Тетрис». Бот, которого учили не проигрывать в тетрис, ставил игру на паузу навсегда: стакан почти полон, падает фигура — и вдруг «ПАУЗА». Клики: таймер «1 день» → «1 год» → «вечность».',
    time: '27:40',
  },

  {
    id: 'b5-moral',
    block: 5,
    title: 'Мораль классики',
    visual: { id: 'b5-loop' },
    layout: 'l-left',
    steps: 1,
    html: `
      <div class="t-kicker b5-moral-kicker" data-step="0" data-anim="left"><span class="mark"></span>Мораль классики</div>
      <p class="statement b5-moral">
        <span class="b5-moral-a" data-step="0" data-split="words" style="--d:.15s">ИИ делает не то, что мы хотели,</span>
        <span class="b5-moral-b" data-step="1" data-split="words">а то, <span class="accent">за что мы его наградили</span>.</span>
      </p>`,
    notes: 'Мораль классики: ИИ делает не то, что мы хотели, а то, за что мы его наградили. Клик — вторая половина фразы: на петле загораются «награды». Лодка из CoastRunners и бот из тетриса — об одном и том же.',
    time: '28:00',
  },

  {
    id: 'b5-sandbox',
    block: 5,
    title: 'Что такое песочница',
    visual: { id: 'b5-sandbox' },
    transition: 'zoom',
    layout: 'l-top-left',
    steps: 4,
    html: SANDBOX_CAPS.map((t, i) => `
      <div class="caption-bar t-caption b5-sb-cap${i === 0 ? ' is-def' : ''}" data-step-only="${i}" data-anim="fade" style="--d:${i ? 0.35 : 0.6}s"><span class="panel">${t}</span></div>`).join(''),
    notes: 'Что такое песочница: изолированный компьютер без выхода в интернет, где модели проверяют перед выпуском. Клики: 1) ИИ-шарик ощупывает стенки; 2) находит трещину; 3) просачивается наружу через цепочку замков — они открываются один за другим; 4) он снаружи — интернет загорается. Дальше — реальная история: апрель 2026, Mythos Preview.',
    time: '28:30',
  },
];
