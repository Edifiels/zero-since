// Хранилище настроек и результатов голосований (localStorage с запасным вариантом в памяти).
import { STORE_PREFIX } from '../config.js';
import { Emitter } from './utils.js';

const mem = new Map();
const events = new Emitter();

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      if (raw != null) return JSON.parse(raw);
    } catch { /* приватный режим и т. п. */ }
    return mem.has(key) ? mem.get(key) : fallback;
  },
  set(key, value) {
    mem.set(key, value);
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
    events.emit(key, value);
    events.emit('*', key, value);
  },
  remove(key) {
    mem.delete(key);
    try { localStorage.removeItem(STORE_PREFIX + key); } catch { /* ignore */ }
    events.emit(key, null);
    events.emit('*', key, null);
  },
  on(key, fn) { return events.on(key, fn); },
};

// Изменения из другого окна (окно спикера) — пробрасываем подписчикам.
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith(STORE_PREFIX)) return;
  const key = e.key.slice(STORE_PREFIX.length);
  let value = null;
  try { value = e.newValue == null ? null : JSON.parse(e.newValue); } catch { /* ignore */ }
  mem.set(key, value);
  events.emit(key, value);
  events.emit('*', key, value);
});
