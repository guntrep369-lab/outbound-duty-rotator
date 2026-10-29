/**
 * @file wms-shell.js — renders the system sidebar on every module page.
 *
 * Usage in a page:
 *   <div data-wms-shell="transport" data-root="../../"></div>
 *   <script type="module" src="../../wms-shell.js"></script>
 *
 *   data-wms-shell = id of the active module (see wms-modules.js)
 *   data-root      = relative path from this page back to the site root
 *
 * Styles for everything emitted here live in wms-theme.css.
 */

import { MODULES, GROUPS, BRAND, ICON_PATHS } from './wms-modules.js';
import { mountBadges } from './wms-badges.js';

/** Inline SVG for one lucide icon name. */
function icon(name, cls) {
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`
  );
}

/** Escape text destined for innerHTML (labels are ours, but keep the habit). */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {string} activeId id of the module this page belongs to
 * @param {string} root     relative path to the site root, e.g. '../'
 */
export function sidebarHTML(activeId, root) {
  const link = (m) => {
    const on = m.id === activeId;
    // The active module is not a link — you are already on it.
    const attrs = (on ? 'class="sysmod active" aria-current="page"' : `class="sysmod" href="${root}${m.path}"`) +
      ` data-mod="${esc(m.id)}"`;
    return `<a ${attrs}>${icon(m.icon, 'sysmod-ic')}<span>${esc(m.label)}</span><em>${esc(m.labelEn)}</em></a>`;
  };

  /* โมดูลที่ไม่มีหมวดขึ้นก่อนโดยไม่มีหัวข้อ แล้วค่อยไล่ทีละหมวดตามลำดับใน GROUPS
     หมวดที่ไม่มีโมดูลเหลืออยู่จะไม่ขึ้นหัวข้อค้างไว้
     โมดูลที่ซ่อน (hidden) ไม่ขึ้น ยกเว้นตอนเปิดหน้านั้นอยู่ จะได้รู้ว่าอยู่ตรงไหน */
  const shown = MODULES.filter((m) => !m.hidden || m.id === activeId);
  const parts = shown.filter((m) => !m.group).map(link);
  for (const g of GROUPS) {
    const inGroup = shown.filter((m) => m.group === g.id);
    if (!inGroup.length) continue;
    parts.push(`<p class="sysbar-modlabel">${esc(g.label)} · ${esc(g.labelEn)}</p>`);
    parts.push(...inGroup.map(link));
  }
  const mods = parts.join('\n    ');

  // Who is signed in, from wms-gate.js. Absent if the gate isn't loaded.
  const user = typeof window !== 'undefined' && window.wmsGate ? window.wmsGate.user() : null;
  const userRow = user
    ? `<div class="sysbar-user">
    <span class="sysbar-user-name" title="${esc(user)}">${esc(user)}</span>
    <button type="button" class="sysbar-signout" data-wms-signout>ออก</button>
  </div>`
    : '';

  return `<aside class="sysbar">
  <div class="sysbar-brand">
    <img class="sysbar-logo" src="${root}${BRAND.logo}" alt="" width="32" height="32">
    <div class="sysbar-titles">
      <div class="sysbar-title">${esc(BRAND.name)} <span class="sysbar-by">${esc(BRAND.by)}</span></div>
      <div class="sysbar-sub">${esc(BRAND.sub)}</div>
    </div>
  </div>
  <nav class="sysbar-mods">
    ${mods}
  </nav>
  ${userRow}
</aside>`;
}

const MENU_SCROLL = 'wms:menu-scroll';

/**
 * Keep the menu's scroll position from page to page. Each module is its own
 * page, so the menu is rebuilt on every click and would snap back to the top —
 * on a laptop the list is taller than the screen (and on a phone wider), and
 * with page transitions the snap shows as a jump when the old menu's picture
 * lifts off at the end.
 */
function keepMenuScroll(doc) {
  const bar = doc.querySelector?.('.sysbar');
  if (!bar) return;
  const mods = bar.querySelector('.sysbar-mods');
  try {
    const [y, x] = JSON.parse(sessionStorage.getItem(MENU_SCROLL) || '[0,0]');
    bar.scrollTop = y;
    mods.scrollLeft = x;
  } catch {}
  window.addEventListener('pagehide', () => {
    try { sessionStorage.setItem(MENU_SCROLL, JSON.stringify([bar.scrollTop, mods.scrollLeft])); } catch {}
  });
}

/** Turn every <div data-wms-shell> marker on the page into the sidebar. */
export function mountShell(doc = document) {
  let active = '';
  for (const slot of doc.querySelectorAll('[data-wms-shell]')) {
    active = slot.getAttribute('data-wms-shell') || '';
    const root = slot.getAttribute('data-root') ?? './';
    // Fill the placeholder itself instead of swapping it out. A page transition
    // may already have captured it as the menu (see wms-theme.css), and removing
    // a captured element cuts the transition off halfway.
    const tpl = doc.createElement('template');
    tpl.innerHTML = sidebarHTML(active, root);
    const bar = tpl.content.firstElementChild;
    slot.removeAttribute('data-wms-shell');
    slot.removeAttribute('data-root');
    slot.className = bar.className;
    slot.setAttribute('role', 'complementary'); // what the <aside> would have been
    slot.replaceChildren(...bar.childNodes);
  }
  for (const btn of doc.querySelectorAll('[data-wms-signout]')) {
    btn.addEventListener('click', () => window.wmsGate?.signOut());
  }
  keepMenuScroll(doc);
  // Open-item count on สมุดกะ, see wms-badges.js.
  mountBadges(active);
}

// Module scripts are deferred, so the DOM is already parsed by the time we run.
mountShell();
