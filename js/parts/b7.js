// Часть «b7» — Блок 7 «Не отдавайте мозг на аутсорс»: ИИ и наше мышление (38:00–43:00).
import { chapterSlide } from './common.js';
import { prize } from '../components/html.js';

export const visuals = {
  'b7-fear': () => import('../visuals/b7/fear.js'),
  'b7-school': () => import('../visuals/b7/school.js'),
  'b7-brains': () => import('../visuals/b7/brains.js'),
  'b7-muscle': () => import('../visuals/b7/muscle.js'),
  'b7-hands': () => import('../visuals/b7/hands.js'),
  'b7-rules': () => import('../visuals/b7/rules.js'),
};

const ERAS = ['Книги', 'Калькуляторы', 'Навигаторы', 'Смартфоны', 'Чат-боты'];
const svgArrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_UP = svgArrow('M12 20V5M5 11.5l7-7 7 7');
const ARROW_DOWN = svgArrow('M12 4v15M5 12.5l7 7 7-7');

export const slides = [
  chapterSlide({
    block: 7,
    title: 'Не отдавайте мозг на аутсорс',
    subtitle: 'ИИ и наше мышление',
    time: '38:00',
    notes: 'Блок 7 (5 минут). Задача: перевести вопрос «захватит ли ИИ мир» в вопрос «не захватит ли он наше мышление» — и дать залу практические правила.',
  }),

  {
    id: 'b7-fear',
    block: 7,
    title: 'Вечный страх',
    visual: { id: 'b7-fear' },
    transition: 'morph',
    layout: 'l-left',
    steps: 6,
    time: '38:30',
    html: `
      <div class="b7-fear-col" data-step-until="6">
        <div class="t-kicker" data-step="0">Вечный страх</div>
        <blockquote class="b7-quote" data-step="0" style="--d:.25s">«Письменность сделает людей <span class="accent">забывчивыми</span>»</blockquote>
        <div class="b7-cite" data-step="0" style="--d:.5s">Сократ пересказывает миф<br>в&nbsp;диалоге Платона «Федр»</div>
        <div class="b7-era" data-step="1">
          <div class="b7-again">И снова та же тревога:</div>
          <div class="b7-slot"><div class="b7-slot-track">${ERAS.map((e) => `<span>${e}</span>`).join('')}</div></div>
        </div>
      </div>
      <div class="b7-fear-final" data-step="6" data-anim="zoom">
        <h2 class="t-title">У каждой эпохи&nbsp;— <span class="accent">та же тревога</span></h2>
      </div>`,
    notes: 'Страх старый. В диалоге Платона «Федр» Сократ пересказывает миф: письменность сделает людей забывчивыми. Потом то же говорили про калькуляторы, навигаторы и смартфоны.\n\nКлики: свиток → книга → калькулятор → навигатор → смартфон → окно чат-бота. Последний клик — все эпохи в ряд: «У каждой эпохи — та же тревога».',
  },

  {
    id: 'b7-school',
    block: 7,
    title: 'Эксперимент со школьниками',
    visual: { id: 'b7-school' },
    transition: 'zoom',
    layout: 'l-left',
    steps: 2,
    time: '39:15',
    html: `
      <div class="b7-pages">
        <div class="b7-page" data-step-until="2" data-anim="left" style="--d:.45s">
          <div class="t-kicker">Но теперь есть данные</div>
          <h2 class="t-h2">Эксперимент со&nbsp;школьниками</h2>
          <p class="b7-point" data-step="0" style="--d:.75s">С&nbsp;ИИ тренировочные задачи решали <b class="accent">на&nbsp;48% лучше</b></p>
          <p class="b7-point" data-step="1" style="--d:.2s">Доступ к&nbsp;ИИ убрали&nbsp;— на&nbsp;экзамене результат <b class="warn">на&nbsp;17% хуже</b>, чем у&nbsp;тех, у&nbsp;кого ИИ не&nbsp;было вовсе</p>
        </div>
        <div class="b7-page" data-step="2" data-anim="right">
          <div class="t-kicker">Доклад с&nbsp;чат-ботом</div>
          <h2 class="t-h2">Через 45&nbsp;дней</h2>
          <p class="b7-point">Студенты, готовившие доклад с&nbsp;чат-ботом, помнили <b class="accent">заметно меньше</b></p>
        </div>
      </div>`,
    notes: 'Но теперь есть данные. Школьники с ИИ решали тренировочные задачи на 48% лучше (клик 0). А когда доступ убрали (клик «ИИ забрали»), на экзамене показали результат на 17% хуже тех, у кого ИИ не было вовсе.\n\nСледующий клик: студенты, готовившие доклад с чат-ботом, через 45 дней помнили заметно меньше — доклад из частиц «выветривается», счётчик дней идёт до 45.',
  },

  {
    id: 'b7-brains',
    block: 7,
    title: 'Два мозга',
    visual: { id: 'b7-brains' },
    transition: 'morph',
    layout: 'l-bottom',
    steps: 1,
    time: '40:00',
    html: `
      <div class="caption-bar t-caption" data-step-until="1" style="--d:1.2s"><span class="panel b7-pill">По мотивам ЭЭГ-исследования MIT</span></div>
      <div class="b7-stmt" data-step="1">
        <p class="b7-stmt-text">Чем чаще человек полагается на&nbsp;ИИ, тем <b>слабее его критическое мышление</b></p>
        <span class="chip warn b7-age">сильнее всего&nbsp;— в&nbsp;17–25&nbsp;лет</span>
      </div>`,
    notes: 'Критическое мышление. В исследовании MIT по ЭЭГ у тех, кто писал эссе с ChatGPT, мозг работал слабее, и многие не могли процитировать собственный текст. Слева — «думал сам»: связи ярко пульсируют; справа — «за меня думал ИИ»: связи тусклые и редкие.\n\nКлик: чем чаще человек полагается на ИИ, тем слабее его критическое мышление, и сильнее всего — в 17–25 лет (связи справа гаснут одна за другой).',
  },

  {
    id: 'b7-muscle',
    block: 7,
    title: 'Мышца мышления',
    visual: { id: 'b7-muscle' },
    transition: 'morph',
    layout: 'l-left',
    steps: 2,
    time: '40:40',
    html: `
      <div class="b7-muscle-col">
        <h2 class="t-title b7-mtitle" data-step="0">Мышца мышления</h2>
        <div class="b7-mstack">
          <div class="b7-mrows" data-step-until="2">
            <div class="b7-mrow is-up" data-step="0" style="--d:.3s">
              <span class="b7-mico">${ARROW_UP}</span>
              <div><div class="b7-mrow-t">Решаешь сам</div><div class="b7-mrow-s">мышца растёт</div></div>
            </div>
            <div class="b7-mrow is-down" data-step="1">
              <span class="b7-mico">${ARROW_DOWN}</span>
              <div><div class="b7-mrow-t">Списываешь</div><div class="b7-mrow-s">мышца сдувается</div></div>
            </div>
          </div>
          <div class="b7-good" data-step="2" style="--d:.2s">
            <div class="t-kicker">Хорошая новость</div>
            <p class="b7-good-t">Когда ИИ встроен в&nbsp;учёбу продуманно, критическое мышление <b class="accent">растёт</b></p>
            <div class="b7-order"><span class="b7-o1">Сначала думаю сам</span><span class="b7-o2">потом ИИ как&nbsp;критик</span></div>
          </div>
        </div>
      </div>`,
    notes: 'Мозг — как мышца: «качается», когда решаешь сам, и сдувается, когда списываешь.\n\nКлик 1 — «Списываешь»: рука опускается, гантель выпадает, мозг-бицепс сдувается.\nКлик 2 — хорошая новость: когда ИИ встроен в учёбу продуманно, критическое мышление растёт, а не падает. Работает порядок «сначала думаю сам, потом ИИ как критик».',
  },

  {
    id: 'b7-hands',
    block: 7,
    title: 'Интерактив №11: поднимите руки',
    visual: { id: 'b7-hands' },
    transition: 'iris',
    layout: 'l-top',
    steps: 1,
    time: '41:15',
    html: `
      <div class="b7-hands-top">
        <div class="q-badge b7-badge" data-step="0"><span class="mark"></span>Вопрос залу №11</div>
        <div class="b7-hq-wrap">
          <h2 class="b7-hq" data-step-until="1" style="--d:.2s">Поднимите руки: кто хоть раз делал домашку с&nbsp;нейросетью?</h2>
          <h2 class="b7-hq" data-step="1">А&nbsp;кто потом смог объяснить решение <span class="accent">сам</span>?</h2>
        </div>
      </div>`,
    notes: 'Интерактив №11 (2 мин). «Поднимите руки, кто хоть раз делал домашку с нейросетью?» Пауза — на экране поднимается волна рук.\n\nКлик: «А теперь — кто потом смог объяснить решение сам?» Рук становится заметно меньше.\n\nБез осуждения, тон тёплый: просто показать разницу между первой и второй волной рук.',
  },

  {
    id: 'b7-rules',
    block: 7,
    title: 'Правила',
    visual: { id: 'b7-rules' },
    transition: 'zoom',
    layout: 'l-left',
    steps: 5,
    time: '42:00',
    html: `
      <div class="b7-rules-col">
        <div class="b7-rules-page" data-step-until="5">
          <h2 class="t-title" data-step="0">Три правила</h2>
          <div class="b7-rules">
            <div class="b7-rule" data-step="1" data-anim="left"><span class="b7-rule-n">1</span><span class="b7-rule-t">Сначала думаю сам, потом спрашиваю</span></div>
            <div class="b7-rule" data-step="2" data-anim="left"><span class="b7-rule-n">2</span><span class="b7-rule-t">Прошу «объясни», а&nbsp;не&nbsp;«реши»</span></div>
            <div class="b7-rule" data-step="3" data-anim="left"><span class="b7-rule-n">3</span><span class="b7-rule-t">Проверяю ответ</span></div>
            <div class="b7-rule is-empty" data-step="4" data-anim="left"><span class="b7-rule-n">4</span><span class="b7-rule-t">Ваше правило?</span></div>
          </div>
          <div class="b7-prize-row" data-step="4" style="--d:.45s">${prize('Приз — тому, кто предложит четвёртое правило', { step: 4, delay: 0.45 })}</div>
        </div>
        <div class="b7-final" data-step="5">
          <p class="b7-final-lead">Вспомните муху: даже громкий заголовок пришлось проверять.</p>
          <h2 class="b7-final-title">Критическое мышление&nbsp;— <span class="accent">главный навык эпохи&nbsp;ИИ</span></h2>
        </div>
      </div>`,
    notes: 'Три правила на экране (по клику):\n1. Сначала думаю сам, потом спрашиваю.\n2. Прошу «объясни», а не «реши».\n3. Проверяю ответ.\nКлик 4 — пустая карточка «Ваше правило?»: приз тому, кто предложит четвёртое правило.\n\nФинал: вспомнить муху — даже громкий заголовок про «загрузку мозга» пришлось проверять. Критическое мышление — главный навык эпохи ИИ.',
  },
];
