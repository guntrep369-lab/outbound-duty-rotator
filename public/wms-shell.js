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
import { mountMotion } from './wms-motion.js';

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

/** The group a module sits in, '' for the ones at the top with no group. */
export function groupOf(id) {
  return MODULES.find((m) => m.id === id)?.group || '';
}

/**
 * @param {string} activeId  id of the module this page belongs to
 * @param {string} root      relative path to the site root, e.g. '../'
 * @param {string} lastGroup the group left open on the page before (wms:menu-group)
 */
export function sidebarHTML(activeId, root, lastGroup = '') {
  /* เมนูเรียบ: ชื่อไทยบรรทัดเดียว ชื่ออังกฤษเป็นคำอธิบายตอนชี้ (title)
     หน้าในหมวดเป็นตัวหนังสือล้วน ไอคอนมีแค่ที่หัวหมวดกับหน้าที่ไม่มีหมวด
     ไอคอนทุกบรรทัดบวกชื่อสองภาษาคือสิ่งที่ทำให้เมนูเดิมลายตา */
  const link = (m) => {
    const on = m.id === activeId;
    // The active module is not a link — you are already on it.
    const attrs = (on ? 'class="sysmod active" aria-current="page"' : `class="sysmod" href="${root}${m.path}"`) +
      ` data-mod="${esc(m.id)}" title="${esc(m.labelEn)}"`;
    return `<a ${attrs}>${m.group ? '' : icon(m.icon, 'sysmod-ic')}<span>${esc(m.label)}</span></a>`;
  };

  /* โมดูลที่ไม่มีหมวดขึ้นก่อนโดยไม่มีหัวข้อ แล้วค่อยไล่ทีละหมวดตามลำดับใน GROUPS
     หมวดที่ไม่มีโมดูลเหลืออยู่จะไม่ขึ้นหัวข้อค้างไว้
     โมดูลที่ซ่อน (hidden) ไม่ขึ้น ยกเว้นตอนเปิดหน้านั้นอยู่ จะได้รู้ว่าอยู่ตรงไหน

     หมวดพับเก็บได้และเปิดทีละหมวด — เมนูยาวเกินจอโน้ตบุ๊กจนต้องเลื่อนหา
     พอพับแล้วเหลือแค่หัวหมวด กดหัวไหนก็เห็นว่าในนั้นมีอะไร
     หมวดของหน้าที่เปิดอยู่เปิดไว้ก่อน จะได้เห็นว่าอยู่ตรงไหน หน้าที่ไม่มีหมวด
     (สมุดกะ) เปิดหมวดเดิมจากหน้าก่อน เมนูตอนเปลี่ยนหน้าจะได้ไม่กระตุก */
  const shown = MODULES.filter((m) => !m.hidden || m.id === activeId);
  const open = groupOf(activeId) || lastGroup;
  const parts = shown.filter((m) => !m.group).map(link);
  for (const g of GROUPS) {
    const inGroup = shown.filter((m) => m.group === g.id);
    if (!inGroup.length) continue;
    const on = g.id === open;
    const here = inGroup.some((m) => m.id === activeId);
    const id = `sysgrp-${esc(g.id)}`;
    parts.push(
      `<div class="sysgrp${on ? ' open' : ''}${here ? ' here' : ''}" data-grp="${esc(g.id)}">` +
        `<button type="button" class="sysgrp-head" aria-expanded="${on}" aria-controls="${id}" title="${esc(g.labelEn)}">` +
        `${icon(g.icon, 'sysgrp-gi')}<span>${esc(g.label)}</span>${icon('chevronRight', 'sysgrp-ic')}</button>` +
        `<div class="sysgrp-items" id="${id}"${on ? '' : ' hidden'}>${inGroup.map(link).join('')}</div>` +
      '</div>',
    );
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
  <div class="sysbar-brand" title="${esc(`${BRAND.full} — ${BRAND.sub}`)}">
    <img class="sysbar-logo" src="${root}${BRAND.logo}" alt="" width="26" height="26">
    <div class="sysbar-title">${esc(BRAND.name)} <span class="sysbar-by">${esc(BRAND.by)}</span></div>
  </div>
  <nav class="sysbar-mods">
    ${mods}
  </nav>
  ${userRow}
</aside>`;
}

const MENU_SCROLL = 'wms:menu-scroll';
/** The menu group left open, so the next page in this tab opens the same one. */
const MENU_GROUP = 'wms:menu-group';

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
  // The page you are on must be in sight. On a phone the open group's pages
  // run off the right of the strip, so the first page in a tab would otherwise
  // show สมุดกะ and the group chips but not where you are. Already in sight = no move.
  bar.querySelector('.sysmod.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  window.addEventListener('pagehide', () => {
    try { sessionStorage.setItem(MENU_SCROLL, JSON.stringify([bar.scrollTop, mods.scrollLeft])); } catch {}
  });
}

/** Open one group and close the rest; `null` closes them all. */
function openGroup(nav, grp) {
  for (const g of nav.querySelectorAll('.sysgrp')) {
    const on = g === grp;
    g.classList.toggle('open', on);
    g.querySelector('.sysgrp-head').setAttribute('aria-expanded', String(on));
    g.querySelector('.sysgrp-items').hidden = !on;
  }
}

/**
 * Group heads fold their group open and shut, one group at a time. A group
 * just opened is scrolled into sight: on a laptop it may sit below the fold,
 * and on a phone the menu is one sideways strip, so the head moves to the left
 * with its pages lined up after it.
 */
function foldGroups(doc) {
  const nav = doc.querySelector?.('.sysbar-mods');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const head = e.target.closest?.('.sysgrp-head');
    if (!head) return;
    const grp = head.parentElement;
    const opening = !grp.classList.contains('open');
    openGroup(nav, opening ? grp : null);
    if (!opening) return;
    const wide = window.matchMedia?.('(min-width:1024px)').matches;
    const calm = window.matchMedia?.('(prefers-reduced-motion:reduce)').matches;
    (wide ? grp : head).scrollIntoView?.({
      block: 'nearest', inline: wide ? 'nearest' : 'start', behavior: calm ? 'auto' : 'smooth',
    });
  });
  window.addEventListener('pagehide', () => {
    const g = nav.querySelector('.sysgrp.open');
    try { sessionStorage.setItem(MENU_GROUP, g ? g.dataset.grp : ''); } catch {}
  });
}

/**
 * ⓘ next to the page name (wms-theme.css, "Calm header"): the description is
 * hidden until pressed, then shows under the name; press again to hide it.
 * Hovering the ⓘ or the name shows the same text as a tooltip, set on first
 * hover so the words live only in the page's <p>.
 * Listens on the document, not the buttons: the ทำใบงานขนส่ง / เอกสารขนส่ง /
 * เอกสารคลัง headers are drawn by their own scripts, possibly after this one.
 */
function infoToggles(doc) {
  if (!doc.addEventListener) return;
  doc.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.mod-info');
    const head = btn?.closest('.mod-title');
    if (!head) return;
    const open = head.classList.toggle('info-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  doc.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('.mod-info, .mod-title h2, .mod-title h1');
    if (!el || el.title) return;
    const text = el.closest('.mod-title')?.querySelector('p, .sub')?.textContent.trim();
    if (text) el.title = text;
  });
}

/** Turn every <div data-wms-shell> marker on the page into the sidebar. */
export function mountShell(doc = document) {
  let active = '';
  let root = './';
  let last = '';
  try { last = sessionStorage.getItem(MENU_GROUP) || ''; } catch {}
  for (const slot of doc.querySelectorAll('[data-wms-shell]')) {
    active = slot.getAttribute('data-wms-shell') || '';
    root = slot.getAttribute('data-root') ?? './';
    // Fill the placeholder itself instead of swapping it out. A page transition
    // may already have captured it as the menu (see wms-theme.css), and removing
    // a captured element cuts the transition off halfway.
    const tpl = doc.createElement('template');
    tpl.innerHTML = sidebarHTML(active, root, last);
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
  foldGroups(doc);
  keepMenuScroll(doc);
  infoToggles(doc);
  // Open-item count on สมุดกะ, see wms-badges.js.
  mountBadges(active);
  // Loading belt, tab sweep, count-up, see wms-motion.js.
  mountMotion(doc, root);
}

// Module scripts are deferred, so the DOM is already parsed by the time we run.
mountShell();
