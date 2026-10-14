// Точка входа презентации.
import { App } from './core/app.js';

const app = new App();
app.start().catch((err) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = 'Ошибка запуска: ' + (err && err.message ? err.message : err);
  document.body.appendChild(box);
});
