/**
 * @file wms-shell.js — renders the system sidebar on the STATIC modules.
 *
 * Usage in a page:
 *   <div data-wms-shell="transport" data-root="../../"></div>
 *   <script type="module" src="../../wms-shell.js"></script>
 *
 *   data-wms-shell = id of the active module (see wms-modules.js)
 *   data-root      = relative path from this page back to the site root
 *
 * The React module renders its own sidebar in JSX, but from the SAME module
 * list, so labels/links/icons cannot drift between them. Styles for everything
 * emitted here live in wms-theme.css.
 */

import { MODULES, GROUPS, BRAND, ICON_PATHS } from './wms-modules.js';

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
    // The active module is not a link — same as aria-current in the React sidebar.
    const attrs = on ? 'class="sysmod active" aria-current="page"' : `class="sysmod" href="${root}${m.path}"`;
    return `<a ${attrs}>${icon(m.icon, 'sysmod-ic')}<span>${esc(m.label)}</span><em>${esc(m.labelEn)}</em></a>`;
  };

  /* โมดูลที่ไม่มีหมวดขึ้นก่อนโดยไม่มีหัวข้อ แล้วค่อยไล่ทีละหมวดตามลำดับใน GROUPS
     หมวดที่ไม่มีโมดูลเหลืออยู่จะไม่ขึ้นหัวข้อค้างไว้ */
  const parts = MODULES.filter((m) => !m.group).map(link);
  for (const g of GROUPS) {
    const inGroup = MODULES.filter((m) => m.group === g.id);
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
    <div class="sysbar-logo">${icon(BRAND.logo, 'sysbar-logo-ic')}</div>
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

/** Replace every <div data-wms-shell> marker on the page with the sidebar. */
export function mountShell(doc = document) {
  for (const slot of doc.querySelectorAll('[data-wms-shell]')) {
    const active = slot.getAttribute('data-wms-shell') || '';
    const root = slot.getAttribute('data-root') ?? './';
    slot.outerHTML = sidebarHTML(active, root);
  }
  for (const btn of doc.querySelectorAll('[data-wms-signout]')) {
    btn.addEventListener('click', () => window.wmsGate?.signOut());
  }
}

// Module scripts are deferred, so the DOM is already parsed by the time we run.
mountShell();
