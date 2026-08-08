/**
 * @file forms-nav.js — the module header for เอกสารขนส่ง: carrier pills on top,
 * document tabs underneath. One definition for every page in the module.
 *
 * Usage:
 *   <div data-forms-nav="company" data-depth="0" data-form="status-tag"></div>
 *   <script type="module" src="./forms-nav.js"></script>
 *
 *   data-forms-nav = active carrier id
 *   data-depth     = folders below /transport-forms/ (0 for pages at its root)
 *   data-form      = active document id, omitted on the list page
 */
import { CARRIERS as ALL } from '../wms-carriers.js';

/**
 * Which carriers have forms stored here. Only รถบริษัท does — the other three
 * are third-party carriers whose paperwork comes from the carrier, not from us.
 */
const HAS_FORMS = new Set(['company']);
export const CARRIERS = ALL.map((c) => ({ ...c, ready: HAS_FORMS.has(c.id) }));

/**
 * เอกสารของรถบริษัท — the blank forms the team prints and writes on.
 *
 * `paper` is shown on the card and is not decoration: these go into a shared
 * printer, and picking the wrong tray or orientation wastes the sheet.
 */
export const FORMS = [
  {
    id: 'status-tag',
    file: 'status-tag.html',
    icon: '🏷️',
    label: 'ป้ายชี้บ่งสถานะสินค้า',
    desc: 'ป้ายติดหน้าสินค้าที่จัดไว้แล้ว — เขียน Order, สินค้า, ขนาด, จำนวน, คนขับ',
    paper: 'A4 แนวนอน',
    source: 'ป้ายชี้บ่งสถานะ.docx',
  },
  {
    id: 'mileage',
    file: 'mileage.html',
    icon: '⛽',
    label: 'ฟอร์มเขียนเลขไมล์',
    desc: 'บันทึกเลขไมล์ เก็บเงินปลายทาง และสรุปค่าน้ำมัน — 3 ชุดต่อแผ่น',
    paper: 'A4 แนวตั้ง',
    source: 'ฟอร์มเขียนเลขไมล์.xlsx · ชีต Sheet1',
  },
  {
    id: 'cash',
    file: 'cash.html',
    icon: '💵',
    label: 'ใบสรุปเงินสด',
    desc: 'สรุปเงินสดที่เก็บมาต่อรอบ — 9 ใบต่อแผ่น ตัดแจกได้',
    paper: 'A4 แนวนอน',
    source: 'ฟอร์มเขียนเลขไมล์.xlsx · ชีต เงินสด',
  },
];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {string} activeCarrier
 * @param {number} depth folders below /transport-forms/
 * @param {string|null} activeForm document id, when a document is open
 */
export function navHTML(activeCarrier, depth, activeForm = null) {
  const toModule = '../'.repeat(depth) || './';
  const href = (dir) => (dir ? `${toModule}${dir}/` : toModule);

  const carriers = CARRIERS.map((c) => {
    // A carrier with nothing stored is a plain <span>, not a dimmed link.
    // A link that leads to an empty page reads as a broken page, not as
    // "nothing here yet" — the pill itself has to say that.
    if (!c.ready) {
      return `<span class="carrier-tab soon">${esc(c.label)}<span class="soon-badge">ยังไม่มีเอกสาร</span></span>`;
    }
    return c.id === activeCarrier
      ? `<span class="carrier-tab active" aria-current="page">${esc(c.label)}</span>`
      : `<a class="carrier-tab" href="${href(c.dir)}">${esc(c.label)}</a>`;
  }).join('\n        ');

  let docRow = '';
  if (activeForm) {
    const root = toModule;
    docRow =
      '\n    <nav class="mod-subnav">\n      ' +
      `<a class="mod-tab" href="${root}">📁 รายการเอกสาร</a>\n      ` +
      FORMS.map((f) =>
        f.id === activeForm
          ? `<span class="mod-tab active">${f.icon} ${esc(f.label)}</span>`
          : `<a class="mod-tab" href="${root}${f.file}">${f.icon} ${esc(f.label)}</a>`
      ).join('\n      ') +
      '\n    </nav>';
  }

  return `<div class="mod-head">
      <div class="mod-title">
        <div class="ic">📁</div>
        <div>
          <h2>เอกสารขนส่ง · Transport Forms</h2>
          <p>ฟอร์มเปล่าที่ใช้ประจำ เปิดดูแล้วสั่งพิมพ์ได้จากเว็บ ไม่ต้องเปิด Word/Excel</p>
        </div>
      </div>
      <nav class="carrier-nav">
          ${carriers}
      </nav>${docRow}
    </div>`;
}

/** Swap every <div data-forms-nav> marker for the real header. */
export function mountNav(doc = document) {
  for (const slot of doc.querySelectorAll('[data-forms-nav]')) {
    slot.outerHTML = navHTML(
      slot.getAttribute('data-forms-nav') || '',
      Number(slot.getAttribute('data-depth') || 0),
      slot.getAttribute('data-form') || null
    );
  }
}

mountNav();
