// Общие помощники для частей лекции.
import { BLOCKS } from '../config.js';

/**
 * Титульный слайд блока: номер из частиц слева, название справа, «варп»-прыжок при входе.
 *   chapterSlide({ block: 2, title: 'Две вселенные', subtitle: 'Человеческий мозг против кремниевой нейросети', notes: '…' })
 */
export function chapterSlide({ block, title, subtitle = '', notes = '', id = null, time = null, transition = 'warp' }) {
  const b = BLOCKS.find((x) => x.n === block);
  const dur = b && b.dur ? `${b.dur} мин` : '';
  // самое длинное слово определяет кегль (иначе «Сверхспособности» не влезает в колонку)
  const longest = Math.max(...String(title).replace(/<[^>]+>/g, ' ').split(/\s+/).map((w) => w.length));
  const sizeCls = longest > 15 ? ' is-xlong' : longest > 12 ? ' is-long' : longest > 10 ? ' is-mid' : '';
  return {
    id: id || `b${block}-chapter`,
    block,
    title: `Блок ${block}. ${title}`,
    visual: { id: 'chapter', state: String(block) },
    transition,
    layout: 'l-chapter',
    kicker: false,
    time: time || b?.time || null,
    html: `
      <div class="chapter-kicker" data-step="0" data-anim="left"><span class="k-num">${String(block).padStart(2, '0')}</span>Блок ${block} из 8${dur ? ` · ${dur}` : ''}</div>
      <h1 class="t-hero chapter-title${sizeCls}" data-step="0" data-split="words" style="--d:.25s">${title}</h1>
      ${subtitle ? `<p class="t-lead chapter-sub" data-step="0" style="--d:.9s">${subtitle}</p>` : ''}`,
    notes,
  };
}
