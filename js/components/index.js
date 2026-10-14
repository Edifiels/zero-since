// Регистрация и монтирование «живых» компонентов слайдов (элементы с data-component="…").
// Свои компоненты части лекции могут регистрировать через registerComponent(name, Class).
// Интерфейс компонента: constructor(el, ctx), onStep(step, dir), destroy().
import { Question } from './question.js';
import { Counter } from './counter.js';
import { Countdown } from './countdown.js';
import { Typewriter } from './typewriter.js';
import { Vote } from './vote.js';

const REGISTRY = {
  question: Question,
  counter: Counter,
  countdown: Countdown,
  typewriter: Typewriter,
  vote: Vote,
};

export function registerComponent(name, Cls) { REGISTRY[name] = Cls; }

/** Виден ли элемент с учётом пошаговых появлений (все предки с data-step показаны). */
export function isShown(el) {
  let n = el;
  while (n && !n.classList?.contains('slide')) {
    if (n.hasAttribute && (n.hasAttribute('data-step') || n.hasAttribute('data-step-only') || n.hasAttribute('data-step-until'))) {
      if (!n.classList.contains('is-shown')) return false;
    }
    n = n.parentElement;
  }
  return !n || n.classList.contains('is-in');
}

// Полосы диаграмм: data-bar="значение 0..100" заполняется при появлении.
class BarFill {
  constructor(el) { this.el = el; this.v = parseFloat(el.dataset.bar) || 0; this.valueEl = el.parentElement?.querySelector('[data-bar-value]'); }
  onStep() {
    const v = isShown(this.el) ? this.v : 0;
    this.el.style.setProperty('--v', v);
    this.valueEl?.style.setProperty('--v', v);
  }
}

export function mountComponents(root, ctx) {
  const list = [];
  root.querySelectorAll('[data-component]').forEach((el) => {
    const name = el.dataset.component;
    const C = REGISTRY[name];
    if (!C) { console.warn(`[components] неизвестный компонент «${name}»`); return; }
    try { list.push(new C(el, ctx)); } catch (err) { console.error(`[components] ${name}:`, err); }
  });
  root.querySelectorAll('[data-bar]').forEach((el) => list.push(new BarFill(el)));
  return list;
}
