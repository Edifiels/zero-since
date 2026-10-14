// Часть «b2b» — Блок 2 «Две вселенные», вторая половина (09:30–14:00):
// синапс против персептрона, от нейрона к таблице весов, кошка Хьюбела и Визела, Нобель-2024,
// нейропластичность, «Угадай слово».

export const visuals = {
  'b2-synapse': () => import('../visuals/b2b/synapse.js'),
  'b2-layers': () => import('../visuals/b2b/layers.js'),
  'b2-cat': () => import('../visuals/b2b/cat.js'),
  'b2-nobel': () => import('../visuals/b2b/nobel.js'),
  'b2-plasticity': () => import('../visuals/b2b/plasticity.js'),
  'b2-nextword': () => import('../visuals/b2b/nextword.js'),
};

// Цепочка «нейрон → слой → сеть → таблица» (текущий шаг подсвечивается через data-cur-step)
const chain = ['Нейрон', 'Слой', 'Сеть', 'Таблица']
  .map((w, i) => `${i ? '<span class="b2b-chain-arrow">→</span>' : ''}<span class="b2b-chain-item" data-i="${i}">${w}</span>`)
  .join('');

export const slides = [
  {
    id: 'b2-synapse',
    block: 2,
    title: '1943: нейрон на языке математики',
    visual: { id: 'b2-synapse' },
    transition: 'zoom',
    layout: 'l-top',
    steps: 2,
    time: '09:30',
    html: `
      <div class="b2b-head" data-step-until="2" data-anim="left">
        <div class="b2b-year">1943</div>
        <div class="b2b-sub">нейрон на&nbsp;языке математики</div>
      </div>
      <div class="b2b-head" data-step="2" data-anim="left" style="--d:.5s">
        <div class="b2b-year">1958</div>
        <div class="b2b-sub">Розенблатт строит персептрон</div>
      </div>
      <p class="b2b-left-lead" data-step="2" style="--d:1.1s">Аксоны, дендриты и&nbsp;синапсы превратились во&nbsp;<span class="accent">входы, веса и&nbsp;порог</span></p>`,
    notes: `Откуда взялся ИИ. В 1943 году нейрон впервые описали математически.
Слева — живой синапс: импульс бежит по аксону, на окончании лопаются пузырьки нейромедиатора, молекулы перелетают щель — следующий нейрон вспыхивает.
[клик] Справа — тот же сигнал в цифрах: входы x₁…x₃, веса w₁…w₃, сумматор Σ, порог — на выходе загорается «1». Дендриты стали входами, синапсы — весами, порог срабатывания — порогом.
[клик] В 1958-м Розенблатт построил персептрон: аксоны, дендриты и синапсы превратились во входы, веса и порог.`,
  },
  {
    id: 'b2-layers',
    block: 2,
    title: 'От нейрона к таблице',
    visual: { id: 'b2-layers' },
    transition: 'morph',
    layout: 'l-top',
    className: 'b2b-layers',
    steps: 3,
    time: '10:30',
    html: `
      <div class="b2b-chain" data-step="0" data-anim="down">${chain}</div>
      <div class="b2b-gpt" data-step="3" style="--d:1.6s">
        <div class="b2b-gpt-1">В&nbsp;GPT от&nbsp;нейрона осталась только идея:</div>
        <div class="b2b-gpt-2">на&nbsp;деле это перемножение огромных таблиц чисел&nbsp;— <span class="accent">весов</span></div>
      </div>`,
    notes: `Трансформеры. Один такой нейрон — это входы, веса и порог.
[клик] Нейрон размножается — получается слой.
[клик] Слои ставим друг за другом — многослойная сеть: сигнал бежит слоями.
[клик] А теперь честно: в GPT и подобных моделях от нейрона осталась только идея. На деле это перемножение огромных таблиц чисел — весов.`,
  },
  {
    id: 'b2-cat',
    block: 2,
    title: 'Кошка Хьюбела и Визела',
    visual: { id: 'b2-cat' },
    transition: 'halftone',
    layout: 'l-top',
    steps: 2,
    time: '11:15',
    html: `
      <h2 class="b2b-title b2b-head" data-step="0" data-anim="left">Кошка Хьюбела и&nbsp;Визела</h2>
      <div class="caption-bar t-caption b2b-cap-md" data-step-until="2" style="--d:.6s"><span class="panel b2b-pill">Хьюбел и&nbsp;Визел: в&nbsp;зрительной коре&nbsp;— нейроны-«детекторы линий»</span></div>
      <div class="caption-bar t-caption b2b-cap-big" data-step="2" style="--d:2.2s"><span class="panel b2b-pill">Это вдохновило <span class="accent">свёрточные нейросети</span></span></div>`,
    notes: `Хьюбел и Визел нашли в зрительной коре кошки нейроны — «детекторы линий». Кошка смотрит на полоски под разными углами — и для каждого угла загораются РАЗНЫЕ нейроны.
[клик] Полоски превращаются в фильтры свёрточной сети — маленькие ядра, каждое «ловит» свою ориентацию.
[клик] Фильтры складываются в контуры, контуры — в мордочку. Это вдохновило свёрточные нейросети.`,
  },
  {
    id: 'b2-nobel',
    block: 2,
    title: '2024: Нобелевская премия — за нейросети',
    visual: { id: 'b2-nobel' },
    transition: 'iris',
    layout: 'l-top',
    steps: 1,
    time: '12:00',
    html: `
      <div class="b2b-head b2b-nobel" data-step="0">
        <div class="b2b-year">2024</div>
        <div class="b2b-sub" style="--d:.25s">Нобелевская премия по&nbsp;физике&nbsp;—</div>
        <div class="b2b-names" style="--d:.55s">Хопфилду и&nbsp;Хинтону.</div>
        <div class="b2b-for" style="--d:1.1s">За&nbsp;нейросети.</div>
      </div>`,
    notes: `В 2024 году Нобелевскую премию по физике дали Хопфилду и Хинтону — за нейросети.
[клик] Короткая лента: 1943 — нейрон описали математически, 1958 — персептрон Розенблатта, 2024 — Нобелевская премия.`,
  },
  {
    id: 'b2-plasticity',
    block: 2,
    title: 'Главное отличие: нейропластичность',
    visual: { id: 'b2-plasticity' },
    transition: 'morph',
    layout: 'l-top',
    className: 'b2b-plast',
    steps: 3,
    time: '12:30',
    html: `
      <h2 class="b2b-title b2b-head" data-step="0" data-anim="left">Главное отличие</h2>
      <div class="b2b-plast-text" data-step-only="0" style="--d:.4s">
        <p class="b2b-plast-lead">Мозг перестраивает связи,<br>когда мы&nbsp;учимся,&nbsp;—<br>всю&nbsp;жизнь.</p>
        <p class="b2b-plast-big">Это <span class="accent">нейропластичность</span></p>
      </div>
      <div class="b2b-side is-left">
        <!-- одна подпись на шаги 1–2 (без мигания при переходе 1 → 2): внешний — «с шага 1», внутренний — «до шага 3» -->
        <div data-step="1" style="--d:.9s"><div class="b2b-side-cap" data-step-until="3" data-anim="fade" style="--d:.15s"><b>Мозг</b> учится с&nbsp;<span class="nowrap">одного-двух</span> примеров</div></div>
        <div class="b2b-side-cap is-live" data-step="3" style="--d:.3s"><b>Мозг</b> учится всю&nbsp;жизнь</div>
      </div>
      <div class="b2b-side is-right">
        <div class="b2b-side-cap" data-step-only="1" style="--d:1.6s"><b>Модели распознавания</b> нужны тысячи фото кошек</div>
        <div class="b2b-side-cap" data-step-only="2" style="--d:.8s"><b>Большие модели</b> учатся на&nbsp;миллиардах картинок</div>
        <div class="b2b-side-cap is-ice" data-step="3" style="--d:2.6s">После обучения веса «замораживаются»</div>
      </div>`,
    notes: `Главное отличие. Мозг перестраивает связи, когда мы учимся, и делает это всю жизнь — это нейропластичность.
[клик] Учится он с одного-двух примеров: ребёнку достаточно один раз обжечься или увидеть кошку. Модели распознавания нужны тысячи фото кошек…
[клик] …а большие модели учатся на миллиардах картинок.
[клик] После обучения веса «замораживаются». А мозг продолжает перестраиваться.`,
  },
  {
    id: 'b2-nextword',
    block: 2,
    title: 'Угадай слово. Понимает ли модель?',
    visual: { id: 'b2-nextword' },
    transition: 'dissolve',
    layout: 'l-top',
    className: 'b2b-nw',
    steps: 2,
    time: '13:15',
    html: `
      <h2 class="b2b-title b2b-head" data-step-until="2" data-anim="left">Угадай слово</h2>
      <div class="b2b-phrase" data-step-until="2">«Поехали!»&nbsp;— сказал <span class="b2b-blank"><span class="b2b-blank-word">Гагарин</span><i class="b2b-cursor"></i></span></div>
      <div class="caption-bar t-caption" data-step-only="1" style="--d:1.6s"><span class="panel b2b-pill b2b-cap-lg">Всё «мышление» модели&nbsp;— угадать следующее слово<span class="accent b2b-qmark">?</span></span></div>
      <div class="b2b-q" data-step="2">
        <div class="q-badge" style="--d:.2s"><span class="mark"></span>Вопрос залу</div>
        <h2 class="b2b-q-title" style="--d:.35s">Понимает ли модель смысл?</h2>
        <p class="b2b-q-lead" style="--d:.7s">Открытый спор: учёные не&nbsp;договорились.</p>
        <p class="b2b-q-ask" style="--d:1.2s">А&nbsp;вы как думаете?</p>
      </div>`,
    notes: `Понимает ли модель? Языковая модель учится, угадывая следующее слово. «Поехали!» — сказал… Над пропуском — столбики вероятностей кандидатов.
[клик] Побеждает самый высокий — «Гагарин». Всё «мышление» модели — угадать следующее слово? Вопросительный знак здесь не случайно.
[клик] Понимает ли она смысл — открытый спор, учёные не договорились. Хороший вопрос, чтобы оставить его залу: а вы как думаете?`,
  },
];
