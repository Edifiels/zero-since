// Базовые визуализации, доступные всем частям лекции.
export const CORE_VISUALS = {
  cover: () => import('./cover.js'),
  chapter: () => import('./chapter.js'),
  ambient: () => import('./ambient.js'),
  'vote-orbs': () => import('./vote-orbs.js'),
};
