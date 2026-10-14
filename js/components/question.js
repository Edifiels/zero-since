// Вопрос залу: на шаге data-answer-step подсвечивает правильный вариант.
export class Question {
  constructor(el) {
    this.el = el;
    this.answerStep = parseInt(el.dataset.answerStep ?? '1', 10);
  }
  onStep(step) {
    this.el.classList.toggle('is-answered', step >= this.answerStep);
  }
}
