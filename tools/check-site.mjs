// Проверка сайта перед публикацией: все импорты и ссылки ведут на существующие файлы
// с ТОЧНЫМ регистром букв (GitHub Pages чувствителен к регистру, Windows — нет), без внешних зависимостей.
// Запуск: node tools/check-site.mjs   (код выхода 1 — есть проблемы)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const existsExact = (abs) => {
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  let cur = root;
  for (const seg of rel.split(path.sep)) {
    if (!seg) continue;
    let list;
    try { list = fs.readdirSync(cur); } catch { return false; }
    if (!list.includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
};

const walk = (dir, exts, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
};

// importmap из index.html
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const map = JSON.parse(indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const resolveSpec = (spec, fromFile) => {
  if (spec.startsWith('.') || spec.startsWith('/')) return path.resolve(path.dirname(fromFile), spec);
  for (const [k, v] of Object.entries(map)) {
    if (k.endsWith('/') ? spec.startsWith(k) : spec === k) return path.join(root, v + (k.endsWith('/') ? spec.slice(k.length) : ''));
  }
  return null;
};
const rel = (f) => path.relative(root, f).split(path.sep).join('/');

for (const f of walk(path.join(root, 'js'), ['.js'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
    const s = m[1];
    if (/^https?:/.test(s)) { problems.push(`${rel(f)}: внешний импорт ${s}`); continue; }
    const abs = resolveSpec(s, f);
    if (!abs) { problems.push(`${rel(f)}: неизвестный модуль «${s}»`); continue; }
    if (!existsExact(abs)) problems.push(`${rel(f)}: нет файла (с учётом регистра) ${s}`);
  }
  for (const m of src.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
    if (!existsExact(path.resolve(path.dirname(f), m[1]))) problems.push(`${rel(f)}: нет ресурса ${m[1]}`);
  }
}
for (const f of walk(path.join(root, 'css'), ['.css'])) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const u = m[1];
    if (u.startsWith('data:') || u.startsWith('#') || u.startsWith('%23')) continue;
    if (/^https?:/.test(u)) { problems.push(`${rel(f)}: внешний url ${u}`); continue; }
    if (!existsExact(path.resolve(path.dirname(f), u))) problems.push(`${rel(f)}: нет ресурса ${u}`);
  }
}
for (const page of ['index.html', 'presenter.html']) {
  const src = fs.readFileSync(path.join(root, page), 'utf8');
  for (const m of src.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:)/.test(u)) continue;
    if (!existsExact(path.resolve(root, u))) problems.push(`${page}: нет ресурса ${u}`);
  }
}
// части лекции из js/config.js
const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const parts = (config.match(/PART_ORDER\s*=\s*\[([^\]]+)\]/)?.[1] || '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) || [];
for (const p of parts) {
  if (!existsExact(path.join(root, 'js/parts', p + '.js'))) problems.push(`js/config.js: часть «${p}» — нет файла js/parts/${p}.js`);
}

if (problems.length) {
  console.error('Найдены проблемы:\n' + problems.map((p) => ' • ' + p).join('\n'));
  process.exit(1);
}
console.log(`Проверка пройдена: ${parts.length} частей лекции, все пути существуют с точным регистром букв.`);
