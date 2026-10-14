// Часть «b8» — Блок 8 «Вердикт» (43:00–45:00) и финал лекции.
// Повторное голосование «до / после», финальная мысль с колыбелью разума,
// обратный путь (нейросеть → паутина → небо → Земля в иллюминаторе → «Восток-1»),
// титр «Думайте сами. Поехали!» и «Спасибо! Ваши вопросы?».
import { vote, caption, prize } from '../components/html.js';
import { chapterSlide } from './common.js';

// Сцены части b1 для кольцевой композиции (по контракту b1: 'b1-cosmos' — neurons/web/sky, 'b1-vostok' — final).
// Загрузчик берём у самой части b1 (пути остаются в её ведении) — так финал работает и при отдельном
// запуске ?part=b8 (например, для репетиции), а в полной лекции модуль b1 уже загружен и берётся из кэша.
const fromB1 = (id) => async () => {
  const b1 = await import('./b1.js');
  const load = b1.visuals?.[id];
  if (!load) throw new Error(`Часть b1 не предоставляет визуализацию «${id}»`);
  return load();
};

export const visuals = {
  'b8-cradle': () => import('../visuals/b8/cradle.js'),
  'b8-porthole': () => import('../visuals/b8/porthole.js'),
  'b1-cosmos': fromB1('b1-cosmos'),
  'b1-vostok': fromB1('b1-vostok'),
};

// Те же три варианта, что и в голосовании №1 (часть b1).
const VOTE_OPTIONS = [
  { title: 'Захватит', hint: 'выйдет из-под контроля, поработит или уничтожит' },
  { title: 'Калькулятор', hint: 'просто умный калькулятор — бояться нечего' },
  { title: 'Уже захватил', hint: 'посмотрите на телефоны в руках' },
];

// Кольцевая композиция: обратный путь к началу лекции.
const ROUTE = ['Нейросеть', 'Паутина', 'Небо', 'Земля', '«Восток-1»'];
const RING_NOTES = 'Обратный путь — кольцевая композиция: нейросеть мозга → космическая паутина → звёздное небо → Земля в иллюминаторе → «Восток-1» на старте. Мы возвращаемся туда, откуда начали лекцию. Слайды короткие — кликайте в ритме фразы.';

function route(i) {
  const nodes = ROUTE.map((name, k) => {
    const cls = k < i ? ' is-past' : k === i ? ' is-cur' : '';
    return `<div class="b8-route-node${cls}"><span class="b8-route-dot"></span><span class="b8-route-label">${name}</span></div>`;
  }).join('');
  const n = ROUTE.length - 1;
  return `
    <div class="b8-route" style="--from:${Math.max(0, i - 1) / n};--to:${i / n}">
      <div class="b8-route-track"><i class="b8-route-fill"></i></div>
      ${nodes}
    </div>`;
}

/**
 * Обход для ядра (описан в отчёте): у сцены «Востока-1» (часть b1) есть непрозрачные материалы. При первом плавном
 * появлении базовый Visual делает их transparent, и three синхронно собирает новые варианты шейдеров — ровно на пике
 * варпа в финал (кадр «замерзает» на ~1,3 с на сером тоннеле). Пока идёт обратный путь, заранее и асинхронно
 * собираем эти варианты. Делаем ровно то, что сделал бы первый fade (transparent у материалов без noFade), — вид сцены не меняется.
 */
async function prewarmFade(api, id, { load = false } = {}) {
  const d = api.director, e = api.engine;
  if (!d || !e || !d.has?.(id)) return;
  let inst = d.instances?.get(id);
  if (!inst && load) { try { inst = await d.get(id); } catch { return; } }
  if (!inst || inst.active || inst.root.visible || inst.__b8warm) return;
  inst.__b8warm = true;
  const mats = new Set();
  inst.root.traverse((o) => {
    const m = o.material;
    (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => { if (!mm.transparent && !mm.userData?.noFade) mats.add(mm); });
  });
  if (!mats.size) return;
  mats.forEach((m) => { m.transparent = true; m.needsUpdate = true; });
  const r = e.renderer;
  const prevRT = r.getRenderTarget();
  try {
    r.setRenderTarget(e.composer.readBuffer);   // та же цель, что у прогрева режиссёра
    const p = r.compileAsync(inst.root, e.camera, e.scene);
    r.setRenderTarget(prevRT);
    await p;
  } catch { r.setRenderTarget(prevRT); }
}

/**
 * Обход для части b1 (описан в отчёте): в b1-cosmos пролёт камеры из «паутины»/«нейронов» в центр небесного купола
 * идёт сквозь облако частиц — частицы у самой камеры складываются в белое пятно (~1,5 с пересвета).
 * На время пролёта приглушаем облако публичным setParams({ opacity }) — звёзды «проявляются» из дымки.
 */
function dimFlightIntoSky(api) {
  const cur = api.director?.current;
  if (!cur || cur.id !== 'b1-cosmos' || cur.state === 'sky') return null;
  const p = api.engine.particles;
  // mount вызывается до смены состояния сцены; b1 при смене ставит свои параметры облака (в т. ч. opacity: 1),
  // поэтому приглушение запускаем сразу после неё — новый твин opacity вытесняет твин b1 (overwrite: 'auto').
  let dim = setTimeout(() => { dim = 0; p.setParams({ opacity: 0.12 }, 0.3); }, 60);
  let up = setTimeout(() => { up = 0; p.setParams({ opacity: 1 }, 1.2); }, 1900);
  return () => {
    if (dim) { clearTimeout(dim); dim = 0; }
    if (up) { clearTimeout(up); up = 0; p.setParams({ opacity: 1 }, 0.5); }
  };
}

/** mount слайдов обратного пути: прогрев финальной сцены (+ мягкий пролёт в «небо»). */
const ringMount = ({ sky = false, last = false } = {}) => (el, api) => {
  const undo = sky ? dimFlightIntoSky(api) : null;
  const t = setTimeout(() => prewarmFade(api, 'b1-vostok', { load: last }), 2200);
  return () => { clearTimeout(t); undo?.(); };
};

/** Нижний блок слайдов обратного пути: крупная подпись + «карта» пути. */
function ring(i, text, { until = null } = {}) {
  const vis = until != null ? ` data-step-until="${until}"` : '';
  return `
    <div class="b8-ring">
      <div class="b8-ring-in"${vis}>
        <p class="b8-ring-cap" data-step="0" data-anim="blur" style="--d:.15s">${text}</p>
        <div data-step="0" data-anim="fade" style="--d:.45s">${route(i)}</div>
      </div>
    </div>`;
}

/**
 * Шаг «До / после»: полоски сначала показывают «снимок» начала лекции,
 * затем перетекают в новые значения; разница подсвечивается плашками.
 * Шары 3D-сцены (vote-orbs) перетекают синхронно — через событие шины vote:change.
 */
function mountRevote(el, api) {
  const voteEl = el.querySelector('[data-component="vote"]');
  const comp = (api.deck.comps || []).find((c) => c.el === voteEl);
  if (!voteEl || !comp) return null;
  let timers = [];
  let raf = 0;
  const FLOW = 1700;
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const parts = () => comp.cards.map((card) => ({
    card,
    fill: card.querySelector('.vote-fill'),
    num: card.querySelector('.v-num'),
  }));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(raf);
  };
  const restore = () => {
    stop();
    voteEl.classList.remove('b8-flowing');
    parts().forEach((p) => { if (p.fill) p.fill.style.transition = ''; });
    comp.update(false);
  };
  const flow = () => {
    const from = api.store.get('vote:start');
    const to = comp.values;
    if (!Array.isArray(from) || !Array.isArray(to)) return;
    stop();
    const ps = parts();
    voteEl.classList.add('b8-flowing');
    // 1) мгновенно — «как было в начале лекции»
    ps.forEach((p, i) => {
      if (p.fill) p.fill.style.transition = 'none';
      p.card.style.setProperty('--v', from[i] ?? 0);
      if (p.num) p.num.textContent = from[i] ?? 0;
    });
    void voteEl.offsetWidth;
    api.bus.emit('vote:change', { id: comp.id, values: from.slice() });
    // 2) перетекание к новым значениям
    timers.push(setTimeout(() => {
      ps.forEach((p, i) => {
        if (p.fill) p.fill.style.transition = `height ${FLOW}ms cubic-bezier(.65,0,.35,1)`;
        p.card.style.setProperty('--v', to[i] ?? 0);
      });
      api.bus.emit('vote:change', { id: comp.id, values: to.slice() });
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / FLOW);
        const e = ease(k);
        ps.forEach((p, i) => {
          if (p.num) p.num.textContent = Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * e);
        });
        if (k < 1) raf = requestAnimationFrame(tick);
        else voteEl.classList.remove('b8-flowing');
      };
      raf = requestAnimationFrame(tick);
    }, 650));
  };
  return {
    onStep(step, dir) {
      if (step >= 1 && dir > 0) flow();
      else restore();
    },
    destroy: stop,
  };
}

export const slides = [
  chapterSlide({
    block: 8,
    title: 'Вердикт',
    subtitle: 'Так захватит ли ИИ мир?',
    time: '43:00',
    notes: 'Блок 8 «Вердикт» (43:00–45:00, 2 мин). Задача блока: замкнуть сюжет и оставить зал с мыслью. Дальше: повторное голосование (интерактив №12), финальная мысль и обратный путь к «Востоку-1».',
  }),

  {
    id: 'b8-revote',
    block: 8,
    title: 'Интерактив №12: голосуем ещё раз',
    visual: { id: 'vote-orbs', state: 'final' },
    transition: 'halftone',
    layout: 'l-top',
    time: '43:00',
    html: `
      <div class="b8-swap">
        <h2 class="t-h2" data-step-until="1">Голосуем ещё раз: что будет через 20–30&nbsp;лет?</h2>
        <h2 class="t-h2" data-step="1" style="--d:.2s">До <span class="accent">/</span> после</h2>
      </div>
      ${vote({ id: 'final', options: VOTE_OPTIONS, compare: 'start', ghostLabel: 'в начале', deltaStep: 1, lockStep: 1 })}
      ${caption('Как изменилось мнение зала', { step: 1, delay: 0.6 })}`,
    mount: mountRevote,
    notes: 'Интерактив №12 (1 мин): повторное голосование с теми же тремя вариантами, сравнение с началом. Повторите вопрос из начала лекции: «Поднимите руки те, кто считает, что в ближайшие 20–30 лет ИИ выйдет из-под контроля и поработит или уничтожит человечество. А теперь — кто уверен, что это просто умный калькулятор и бояться нечего? И третий вариант: кто считает, что ИИ уже захватил мир?» Выставьте доли кликом или перетаскиванием по карточкам (или колесом мыши, кнопками −/+). Пунктир — «снимок мнения зала» из начала лекции. Клик — «До / после»: голосование блокируется, полоски из начала лекции перетекают в новые значения, разница подсвечивается.',
  },

  {
    id: 'b8-thought',
    block: 8,
    title: 'Финальная мысль: колыбель разума',
    visual: { id: 'b8-cradle' },
    layout: 'l-left',
    time: '43:45',
    html: `
      <div class="b8-stack">
        <div class="b8-say b8-say--no" data-step-only="0" data-anim="left">
          <p class="b8-ask">Захватит ли ИИ мир танками, как в кино?</p>
          <p class="b8-no" data-step-only="0" data-anim="zoom" style="--d:.55s">Нет.</p>
        </div>
        <div class="b8-say" data-step-only="1" data-anim="up" style="--d:.3s">
          <p class="b8-big">Но если мы сами отдадим ему <span class="accent">мышление</span> и <span class="accent">ключи от хрупких систем</span> —</p>
          <p class="b8-tail" data-step-only="1" style="--d:1.1s"><span>захватывать ничего не придётся.</span></p>
        </div>
        <div class="b8-say" data-step-only="2" data-anim="up" style="--d:.3s">
          <p class="b8-pre">Циолковский говорил, что нельзя вечно жить в колыбели.</p>
          <p class="b8-big" data-step-only="2" style="--d:1s">Разуму тоже нельзя — <span class="accent">даже если колыбель качает нейросеть.</span></p>
        </div>
      </div>`,
    notes: 'Финальная мысль спикера (1 мин): «Захватит ли ИИ мир танками, как в кино? Нет. Но если мы сами отдадим ему мышление и ключи от хрупких систем, захватывать ничего не придётся. Циолковский говорил, что нельзя вечно жить в колыбели. Разуму тоже нельзя — даже если колыбель качает нейросеть. Думайте сами. Поехали!» '
      + 'Клики: после «Нет.» — «Но если мы сами отдадим…» (сверху опускается нейросеть и на нитях раскачивает колыбель, мозг тускнеет); '
      + 'после «…ничего не придётся» — «Циолковский говорил…» (нити рвутся, мозг покидает колыбель и улетает вверх). '
      + '«Думайте сами. Поехали!» — в конце обратного пути, вместе со стартом «Востока-1».',
  },

  {
    id: 'b8-back-net',
    block: 8,
    kicker: 'Обратный путь',
    title: 'Обратный путь: нейросеть мозга',
    visual: { id: 'b1-cosmos', state: 'neurons' },
    transition: 'zoomout',
    layout: 'l-bottom',
    time: '44:30',
    html: ring(0, 'Нейросеть мозга…'),
    mount: ringMount(),
    notes: RING_NOTES + ' Сейчас: «Нейросеть мозга…»',
  },
  {
    id: 'b8-back-web',
    block: 8,
    kicker: 'Обратный путь',
    title: 'Обратный путь: космическая паутина',
    visual: { id: 'b1-cosmos', state: 'web' },
    layout: 'l-bottom',
    time: '44:35',
    html: ring(1, '…космическая паутина…'),
    mount: ringMount(),
    notes: RING_NOTES + ' Сейчас: «…космическая паутина…»',
  },
  {
    id: 'b8-back-sky',
    block: 8,
    kicker: 'Обратный путь',
    title: 'Обратный путь: звёздное небо',
    visual: { id: 'b1-cosmos', state: 'sky' },
    layout: 'l-bottom',
    time: '44:40',
    html: ring(2, '…звёздное небо…'),
    mount: ringMount({ sky: true }),
    notes: RING_NOTES + ' Сейчас: «…звёздное небо…»',
  },
  {
    id: 'b8-back-earth',
    block: 8,
    kicker: 'Обратный путь',
    title: 'Обратный путь: Земля в иллюминаторе',
    visual: { id: 'b8-porthole' },
    transition: 'zoom',
    layout: 'l-bottom',
    time: '44:45',
    html: ring(3, '…Земля в иллюминаторе…'),
    mount: ringMount({ last: true }),
    notes: RING_NOTES + ' Сейчас: «…Земля в иллюминаторе…» — за стеклом медленно вращается Земля, по краю восходит Солнце.',
  },
  {
    id: 'b8-final',
    block: 8,
    kicker: 'Обратный путь',
    title: 'Финальный титр: «Думайте сами. Поехали!»',
    visual: { id: 'b1-vostok', state: 'final' },
    transition: 'warp',
    layout: 'l-center',
    steps: 1,
    time: '44:50',
    // Титр в два такта: «Думайте сами.» — сразу на клик, «Поехали!» — в момент отрыва ракеты (зажигание ~1,1 с).
    html: `
      ${ring(4, '…и «Восток-1» на старте', { until: 1 })}
      <h1 class="b8-final-title">
        <span class="b8-ft-think" data-step="1" data-anim="halftone" style="--d:.1s">Думайте сами.</span>
        <span class="b8-ft-go accent" data-step="1" data-anim="zoom" style="--d:1.1s">Поехали!</span>
      </h1>`,
    notes: 'Круг замкнулся: «…и „Восток-1“ на старте». [клик на словах] «Думайте сами. Поехали!» — на клик проявляется «Думайте сами.», '
      + 'ракета стартует без отсчёта, и в момент отрыва вспыхивает «Поехали!». Дайте ракете уйти вверх — затем «Спасибо!».',
  },

  {
    id: 'b8-thanks',
    block: 8,
    kicker: false,
    title: 'Спасибо! Ваши вопросы?',
    visual: { id: 'cover', state: 'end' },
    transition: 'halftone',
    layout: 'l-bottom',
    time: '45:00',
    html: `
      <div class="b8-thanks">
        <h1 class="b8-thanks-title reveal" data-anim="halftone"><span class="accent">Спасибо!</span> Ваши вопросы?</h1>
        <div class="b8-thanks-row">
          <span class="wordmark b8-thanks-wordmark reveal" data-anim="fade" style="--d:.6s"></span>
          ${prize('Приз — за лучший вопрос', { step: 0, delay: 1.1 })}
        </div>
      </div>`,
    notes: 'Спасибо! Ответы на вопросы зала. Приз — за лучший вопрос.',
  },
];
