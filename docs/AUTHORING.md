# Как устроена презентация и как добавлять слайды

Документ для тех, кто правит или расширяет презентацию (в том числе для ИИ-помощников).
Сборка не нужна: чистые ES-модули, three.js и gsap лежат в `vendor/`, импортируются через importmap
(`import * as THREE from 'three'`, `import { gsap } from 'gsap'`, аддоны — `three/addons/...`).

## 1. Структура

```
index.html            — каркас, importmap, подключение CSS
presenter.html        — окно спикера (заметки, таймер, следующий слайд)
css/base.css          — токены, типографика, раскладки, пошаговые появления
css/components.css    — вопрос залу, счётчик, голосование, карточки, штамп, цитата…
css/ui.css            — интерфейс (прогресс, кнопки, стартовый экран)
css/parts/<часть>.css — стили конкретной части лекции
js/config.js          — блоки лекции, порядок частей
js/core/*             — движок (не трогать без необходимости)
js/components/*       — HTML-помощники и «живые» компоненты
js/visuals/core/*     — общие визуализации: cover, chapter, ambient, vote-orbs
js/visuals/<часть>/*  — визуализации части
js/parts/<часть>.js   — слайды части: export const slides = [...]; export const visuals = {...}
assets/               — логотип, шрифты, данные (суша, аэропорты, города — Natural Earth)
```

Порядок частей задаёт `PART_ORDER` в `js/config.js`. Часть можно открыть отдельно: `index.html?part=b3`
(загрузятся заставка и часть `b3`). Примеры всех компонентов: `index.html?part=examples`.

## 2. Слайд

```js
// js/parts/b1.js
import { question, quote, counter, caption, statement, vote, stamp, prize, bars, countdown } from '../components/html.js';
import { chapterSlide } from './common.js';

export const visuals = {
  'b1-cosmos': () => import('../visuals/b1/cosmos.js'),   // id визуализации → модуль
};

export const slides = [
  chapterSlide({ block: 1, title: 'Поехали!', subtitle: '…', notes: '…' }),
  {
    id: 'b1-galaxy',                 // уникальный id (латиница)
    block: 1,                        // номер блока (шапка «01 · Поехали!» добавится сама)
    title: 'Галактика',              // для навигатора и окна спикера
    visual: { id: 'b1-cosmos', state: 'galaxy' },  // 3D-сцена и её состояние
    transition: 'morph',             // переход В этот слайд (см. ниже)
    bg: 'soft',                      // пресет фона, если визуализация не задала свой
    layout: 'l-left',                // класс раскладки сцены 16:9
    steps: 2,                        // необязательно: число кликов внутри слайда (иначе — max data-step)
    html: `…разметка…`,              // строка или (api) => строка
    mount(el, api) { … },            // необязательно: после вставки HTML; может вернуть { onStep(step, dir), destroy() } или функцию очистки
    onStep(step, el, api, dir) { … },// необязательно
    notes: 'Текст для спикера…',     // показывается в окне спикера
    time: '01:30',                   // плановое время начала (мм:сс от начала лекции)
    kicker: false,                   // скрыть шапку блока (или строка — своя шапка)
    raw: false,                      // true — html без обёртки .stage
  },
];
```

**Шаги.** Клик кликера сначала проходит шаги слайда, потом переходит к следующему.
Назад — шаг назад; при возврате на предыдущий слайд он открывается на последнем шаге.
`api` = `{ app, store, bus, slide, deck, engine, director }`.

**Переходы** (`transition`): `morph` (по умолчанию: облако частиц перетекает, камера пролетает),
`warp` (прыжок с растяжкой звёзд — между блоками), `zoom` / `zoomout` (нырок в сцену / вылет),
`halftone` (фирменное растворение точками), `glitch` (сбой — для тем взлома), `fade`, `iris`, `wipe`, `dissolve`, `cut`.
Если у визуализации задан `static transition = '…'`, он используется, когда у слайда нет своего.
Соседние слайды с одной и той же визуализацией не «перезапускают» её — вызывается `setState`/`setStep`.

## 3. HTML-слой

### Размеры
Всё в единицах `--u` = 1% ширины сцены 16:9 (`calc(var(--u) * 2)`). Сцена `.stage` вписана в экран,
поля: слева/справа `--pad-x` (5.5u), сверху `--pad-top` (6.8u — под шапкой блока), снизу `--pad-y`.
Текст КРУПНЫЙ: минимум `--fs-label` (1.45u ≈ 28px на 1080p). Не делайте мелких элементов —
презентацию смотрят с последних рядов и на небольших экранах.

### Раскладки (`layout`)
`l-center`, `l-left` (колонка слева ~46u, справа место для 3D), `l-right`, `l-top`, `l-bottom`,
`l-top-left`, `l-split` (2 колонки), `l-split3`, `l-chapter` (для титулов блоков).
Помощники: `.row`, `.col`, `.spacer`, `.w-50/.w-60/.w-70/.w-80`, `.mt-1/2/3/auto`, `.caption-bar` (низ по центру).

### Типографика
`.t-mega`, `.t-hero`, `.t-title`, `.t-h2`, `.t-lead`, `.t-body`, `.t-caption`, `.t-label`, `.t-kicker`, `.t-num`,
`.t-mono`, `.t-pixel` (пиксельный шрифт), `.t-upper`; цвета: `.accent` (зелёный), `.accent-bg`, `.warn` (оранжевый),
`.danger` (красный), `.muted`, `.dim`, `.glow`, `.strike` (красное зачёркивание). Плашки: `.panel`, `.chip`, `.card`.
Знак логотипа: `<span class="mark"></span>` (цвет = currentColor), полный логотип `.lockup`, надпись `.wordmark`.

**Только CSS-переменные цветов** (`var(--fg)`, `var(--green-ink)`, `var(--panel)`…) — тогда светлая тема (клавиша T)
работает сама. Никаких внешних ресурсов (CDN, картинки из интернета) — презентация должна работать офлайн.

### Пошаговые появления
- `data-step="n"` — появиться на шаге n (0 — сразу при входе на слайд);
- `data-step-only="n"` — только на шаге n; `data-step-until="n"` — до шага n;
- `data-anim="up|down|left|right|fade|scale|zoom|blur|halftone|none"`, задержка `style="--d:.3s"`;
- `data-reveal="none"` — не прятать, только переключать класс `.is-shown` (для своих анимаций, флипа карточек);
- `data-split="words|chars"` — каскадное появление слов/букв;
- класс `.reveal` — появиться при входе на слайд (без шага).
- На элементе слайда есть атрибут `data-cur-step` и CSS-переменная `--step` — для своих стилей.

### Помощники (`js/components/html.js`)
- `question({ num, q, options, correct, answer, prize, answerStep, cols, long })` — вопрос залу; на шаге answerStep подсвечивается ответ и «Приз».
- `quote({ text, author, step, anim, long })`, `statement(text, { step, anim })`.
- `counter({ label, to, from, unit, prefix, decimals, duration, countDelay, step, accent, size: 'big'|'small', final })` — набирающийся счётчик (при возврате на слайд назад сразу показывает итог).
- `caption(text, { step })` — нижняя подпись («Подпись: …» из сценария).
- `vote({ id, options:[{title,hint}], compare, deltaStep, lockStep })` — голосование (значения в localStorage, событие шины `vote:change`).
- `stamp(text, { step, color: 'red'|'green'|'orange', rot })`, `prize(text, { step })`.
- `bars(rows, { step })` — горизонтальные полосы `{ label, value (0..100), text, cls: 'warn'|'danger', step }`.
- `countdown({ from, word, step })` — 3-2-1-«Поехали!», события `countdown:tick` / `countdown:done`.
- Карточки-перевёртыши: `<div class="flip" data-step="n" data-reveal="none"><div class="flip-inner"><div class="flip-front">…</div><div class="flip-back ok|no">…</div></div></div>`.
- `data-component="typewriter"` — печатная машинка.
- Свой компонент: `registerComponent('name', Class)` из `js/components/index.js` (класс: `constructor(el, api)`, `onStep(step, dir)`, `destroy()`).

## 4. 3D-визуализация

```js
// js/visuals/b1/cosmos.js
import * as THREE from 'three';
import { Visual } from '../../core/visual.js';
import * as S from '../../core/shapes.js';

export default class Cosmos extends Visual {
  static transition = 'morph';
  async init() { /* построить геометрию/материалы; можно await S.loadMark() и т. п. */ }
  camera(state, step) { return { pos: [0, 3, 14], target: [0, 0, 0], fov: 45 }; } // поза камеры (null — не трогать)
  background(state, step) { return 'soft'; }                                       // пресет фона (null — slide.bg)
  enter(o) { /* o: { state, step, dir, instant, slide, el, prev, duration } */ return super.enter(o); }
  setState(state, o) { … }        // соседний слайд с той же визуализацией
  setStep(step, o) { … }          // клик внутри слайда; o.prevStep, o.dir; должен работать в обе стороны и «через шаг»
  exit(o) { return super.exit(o); } // вернуть Promise
  update(dt, t) { … }             // каждый кадр, пока видна
  resize(w, h, dpr) { … }
}
```

`this.ctx`: `THREE, gsap, engine, scene, camera, renderer, rig, particles, labels, background, fx, bus, store, quality, time, deck, width, height`.
`this.root` — группа визуализации (добавлена в сцену режиссёром). По умолчанию `enter`/`exit` плавно меняют
прозрачность всех материалов root (материалам с `uniforms.uOpacity` меняется этот uniform; `material.userData.noFade = true` — исключить).

Помощники базового класса: `this.tw(target, vars)`, `this.fromTo(...)`, `this.tl()`, `this.delay(sec, fn)` — gsap-анимации,
которые автоматически отменяются при уходе; `this.label({ html, object | position, offset, anchor, className })` — HTML-подпись у 3D-точки (anchor: center, left, right, top, bottom, top-left, top-right, bottom-left, bottom-right; `l.setPosition(vec3 | [x,y,z] | x, y, z)`);
`this.drive((dt, t) => ({ pos, target, fov }))` — покадровое управление камерой (`this.drive(null)` — отпустить);
`this.stageRect()` — размер сцены 16:9 в мировых единицах (для собственной позы камеры) — чтобы ставить объекты напротив колонок HTML;
`this.screenToWorld(xPx, yPx, planeZ)`; `this.setOpacity(v)`, `this.fadeTo(v, dur)`.

### Камера и эффекты
- `camera()` возвращает `{ pos, target, fov, roll?, duration?, arc? }`. Режиссёр пролетает к позе при входе и на каждом шаге.
- `ctx.rig.shake(amount, duration)`; `ctx.engine.pulse({ aberration: 1, flash: .3, glitch: .5, warp: .4 }, dur)` — всплеск;
  `ctx.engine.setFx({ bloom: 1.2, vignette: .8, sat: .2, scan: .3 }, dur)` / `resetFx()` — вернуть (вызывать в exit!).
- `ctx.background.set('preset' | { glows:[[x,y,r,i]], band:[i,y,soft,tilt] }, { duration })`, `ctx.background.surge(k, dur)`.
  Пресеты: `none, banner, low, soft, corner, corners, left, right, center, top, bottom, full, danger` (красное свечение).

### Общее облако частиц (`ctx.particles`) — главный «зрелищный» инструмент
65 536 частиц (на слабых ПК меньше) живут всю презентацию и перетекают между формами.
```js
this.claimParticles();                               // я использую частицы на своём слайде (иначе режиссёр уведёт их в «пыль»)
this.particles.morph(shape, { duration: 1.8, stagger: .45, burst: 14, explode: 0 });
this.particles.setParams({ swirl: .15, noise: .35, size: .062, opacity: 1, spring: 16, damping: 5.5, twinkle: .25, flow: [0, .2, 0] }, 1.2);
this.particles.explode(8, [0, 0, 0]);
this.particles.object                                // THREE.Points: двигать/вращать/масштабировать через this.tw(...)
if (this.ownsParticles()) { … }                      // в update() трогайте частицы только если они ваши
```
Формы (`js/core/shapes.js`, все — `(count, opts)`): `dust, hidden, sphere, ball, ring, helix, line, curve, grid, fromPoints,
galaxy, webGraph → cosmicWeb / neurons (на одном графе — морфинг «паутина ⇄ нейроны» структурный), brain, fromCanvas,
fromPath (SVG-путь), fromText, fromGeometry, logo`; операции: `combine, transform, recolor, fade, shuffle, equalize`; цвета `PAL`.
Кэшируйте формы (строить 65 тыс. точек — 10–50 мс). Если облако будет увеличено (`particles.object.scale`), передайте `morph(shape, { equalizeOpts: { scale } })`. Плотные места автоматически приглушаются (`equalize`) — иначе свечение
выгорает в белое пятно. Держите альфу 0.2–0.6, «светящиеся» HDR-цвета (`PAL.bright`, `PAL.greenHi`) — не больше 10–20% точек.

### Свет и материалы
В сцене есть свет (`engine.keyLight`, `engine.rimLight` — зелёный контровой, полусферический) и окружение
(для `MeshStandardMaterial`/`MeshPhysicalMaterial`). Для свечения — `MeshBasicMaterial`/`ShaderMaterial` с
`blending: THREE.AdditiveBlending, depthWrite: false` и цветом > 1. Bloom захватывает ВСЁ ярче ~0.86 целиком — поэтому «твёрдые» белые
объекты и текст держите не ярче 0.8 (у `textMesh`/`textSprite` это по умолчанию; `glow: true` — чтобы светились).
Текст на текстурах: `textMesh(text, { height, font, color, background, border, maxWidth })`, `textSprite(...)`, `textTexture(...)` из `js/core/text.js`.
Фирменный халфтон в шейдерах: `HALFTONE` из `js/core/glsl.js`; шум: `NOISE` (snoise, curlNoise, hash*).
В шейдерах никогда не вызывайте `pow()` с возможным отрицательным основанием и не делите на 0 —
NaN «зачернит» кадр (страховочный проход есть, но картинка испортится).

### Экраны не 16:9 (проекторы 4:3, 16:10)
HTML-сцена вписывается в экран с полями, а камеру **ядро подгоняет само** (`director.fitPose`): на узких экранах
вертикальный угол обзора расширяется так, чтобы по горизонтали было видно ровно столько же, сколько на 16:9.
Поэтому позы в `camera()` задавайте для 16:9 и НЕ подгоняйте их сами (если подгоняете — верните позу с `fitted: true`,
отключить подгонку — `fit: false`). `stageRect()` возвращает ширину сцены 16:9 (`vh × 16/9`) с учётом этой подгонки.
При смене размера окна (вход в полноэкранный режим) режиссёр заново ставит позу текущей сцены.
Позы «водителя» камеры (`this.drive`) ядро НЕ подгоняет — используйте `fitFov(fov, ctx.camera.aspect)` из `js/core/rig.js`.
HTML-подписи уходящей сцены гаснут автоматически в начале перехода.
В позе можно задать `ease` (gsap-изинг пролёта), `duration`, `arc`.

### Быстрые клики и анимации
Отложенные анимации (`delay`) не отменяются новой анимацией того же свойства, пока ждут старта, — при быстрых кликах
«назад-вперёд» они могут «воскресить» скрытый объект. Используйте `this.twk('ключ', target, vars)`, `this.twkFromTo(ключ, target, from, to)` и `this.delayk(ключ, sec, fn)`:
новая анимация/вызов с тем же ключом отменяет прежний. Базовый `exit()` отменяет все «именованные» анимации и отложенные
вызовы (`this.delay`) — подписи не «вспыхивают» во время ухода. Внутри `setStep` всегда приводите сцену к виду шага, а не «добавляйте изменения».

### Выгрузка сцен (LRU)
Режиссёр держит в памяти до 14 сцен (8 на низком качестве); давние выгружаются (`dispose()`) и при возврате создаются
заново (`init()` во время фоновой предзагрузки). Поэтому: таймеры/подписки на шину снимайте в `exit()`/`dispose()`;
не храните GPU-ресурсы на уровне модуля (или помечайте общие текстуры `texture.userData.shared = true` — их `dispose()` не тронет);
тяжёлые формы частиц стройте в `init()`.

### Производительность
Цель — 60 fps на встроенной видеокарте ноутбука. Не перезаливайте каждый кадр `instanceMatrix`/`instanceColor` у
`InstancedMesh` и большие буферы (на ANGLE/D3D11 это 25–40 мс на кадр даже для сотни экземпляров) — анимируйте в вершинном
шейдере по атрибутам-«расписаниям», обновляемым только при смене шага. `backdrop-filter` внутри слайдов отключён (дорого).
Не создавайте объекты в `update()` (переиспользуйте Vector3),
не больше ~300 draw calls на сцену (используйте `InstancedMesh`, `Points`, `LineSegments`), текстуры ≤ 2048,
освобождайте ресурсы в `dispose()` (базовый класс освобождает геометрии/материалы/текстуры root).

### Цвета
Чёрный, белый, фирменный зелёный `#00e000`/`#00ff00` (из логотипа). Оранжевый `#ff8a1f` — только «Пока нет»/предупреждение,
красный `#ff3b30` — только опасность/ошибка/каскад отказов.

## 5. Управление (для справки)
Далее: `PageDown → ↓ Space Enter`, клик. Назад: `PageUp ← ↑ Backspace`, правый клик. `F5`/`F` — полный экран,
`B`/`.` — чёрный экран, `W` — белый, `G` — список слайдов, номер + `Enter` — переход, `T` — тема, `S` — окно спикера,
`Q` — качество графики, `H` — справка. Адрес `#12.3` — слайд 12, шаг 3.

## 6. Проверка
Запустите локальный сервер в корне (`npx serve .` или `python -m http.server`) и откройте
`http://localhost:…/index.html?part=<часть>`. Режим `?test=1` пропускает стартовый экран; `APP.goTo(i, step)`,
`APP.next()`, `APP.engine.stats.fps` — в консоли.
