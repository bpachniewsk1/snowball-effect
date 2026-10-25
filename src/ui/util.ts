// Small DOM helpers shared by the screens.

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Undertale-style narration line. */
export const say = (html: string, cls = '') => `<p class="say ${cls}">* ${html}</p>`;
