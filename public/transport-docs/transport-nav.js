/**
 * @file transport-nav.js — the module header for ทำใบงานขนส่ง: carrier pills on
 * top, document tabs underneath. One definition for all five pages.
 *
 * Usage:
 *   <div data-transport-nav="kex" data-depth="1"></div>
 *   <script type="module" src="../transport-nav.js"></script>
 *
 *   data-transport-nav = active carrier id
 *   data-depth         = folders below /transport-docs/ (0 for the index page)
 */

/** Carriers under this module. `docs` renders only for carriers marked ready. */
export const CARRIERS = [
  { id: 'company', label: 'รถบริษัท', dir: '', ready: true },
  { id: 'kex', label: 'Kex express', dir: 'kex', ready: true },
  { id: 'best', label: 'Best express', dir: 'best', ready: true },
  { id: 'bi', label: 'Business Idea', dir: 'business-idea', ready: true },
];

/** Documents that exist under รถบริษัท. Third-party carriers print labels only. */
export const DOCS = [
  { id: 'picklist', label: '🏷️ Picklist Label', dir: '' },
  { id: 'delivery', label: '📄 ใบนำส่งสินค้า', dir: 'delivery' },
];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {string} activeCarrier
 * @param {number} depth folders below /transport-docs/
 * @param {string|null} activeDoc only meaningful for carriers that have documents
 */
export function navHTML(activeCarrier, depth, activeDoc = null) {
  const toModule = '../'.repeat(depth) || './';
  const href = (dir) => (dir ? `${toModule}${dir}/` : toModule);

  const carriers = CARRIERS.map((c) => {
    const soon = c.ready ? '' : '<span class="soon-badge">เร็ว ๆ นี้</span>';
    return c.id === activeCarrier
      ? `<span class="carrier-tab active" aria-current="page">${esc(c.label)}${soon}</span>`
      : `<a class="carrier-tab${c.ready ? '' : ' soon'}" href="${href(c.dir)}">${esc(c.label)}${soon}</a>`;
  }).join('\n        ');

  // Only รถบริษัท has more than one document, so only it shows the second row.
  const active = CARRIERS.find((c) => c.id === activeCarrier);
  let docRow = '';
  if (active && activeDoc) {
    const root = href(active.dir);
    docRow =
      '\n    <nav class="mod-subnav">\n      ' +
      DOCS.map((d) => {
        const to = d.dir ? `${root}${d.dir}/` : root;
        return d.id === activeDoc
          ? `<span class="mod-tab active">${d.label}</span>`
          : `<a class="mod-tab" href="${to}">${d.label}</a>`;
      }).join('\n      ') +
      '\n    </nav>';
  }

  return `<div class="mod-head">
    <div class="mod-title">
      <div class="ic">🚚</div>
      <div>
        <h2>ทำใบงานขนส่ง · Transport Documents</h2>
        <p>เลือกขนส่ง แล้วสร้างเอกสารจากไฟล์ Excel</p>
      </div>
    </div>
    <nav class="carrier-nav">
        ${carriers}
    </nav>${docRow}
  </div>`;
}

/** Swap every <div data-transport-nav> marker for the real header. */
export function mountNav(doc = document) {
  for (const slot of doc.querySelectorAll('[data-transport-nav]')) {
    slot.outerHTML = navHTML(
      slot.getAttribute('data-transport-nav') || '',
      Number(slot.getAttribute('data-depth') || 0),
      slot.getAttribute('data-doc') || null
    );
  }
}

mountNav();
