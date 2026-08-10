/**
 * @file wh-nav.js — module header for เอกสารคลังสินค้า, and the list of forms.
 *
 * Usage:
 *   <div data-wh-nav="transfer"></div>
 *   <script type="module" src="./wh-nav.js"></script>
 */

/**
 * ฟอร์มที่ทำแล้ว — `rows` คือจำนวนช่องต่อแผ่น (บรรทัดรายการ / ป้าย / ใบ)
 *
 * ไฟล์ Excel ต้นฉบับมี 14 ชีต แต่เป็นฟอร์มจริง 5 แบบ ที่เหลือคือก๊อปของใบโอน
 * ที่ต่างกันแค่แผนก/คลังที่พิมพ์ไว้ล่วงหน้า — ตรงนี้จึงเหลือใบเดียวแล้วเลือกจาก
 * dropdown แทน แก้ฟอร์มทีเดียวจบ ไม่ต้องไล่แก้ห้าก๊อปให้ตรงกัน
 */
export const FORMS = [
  {
    id: 'transfer',
    file: 'transfer.html',
    icon: '🔀',
    label: 'ใบโอนสินค้า',
    en: 'Transfer Request Form',
    desc: 'โอนย้ายสินค้าระหว่างคลัง — พิมพ์รหัส SKU แล้วชื่อสินค้าขึ้นเอง',
    paper: 'A5 แนวนอน',
    rows: 10,
  },
  {
    id: 'requisition',
    file: 'requisition.html',
    icon: '📤',
    label: 'ใบเบิก',
    en: 'Requisition',
    desc: 'เบิกของออกจากคลัง มีช่องเลขออเดอร์ออนไลน์/ภายใน และปลายทางโล',
    paper: 'A5 แนวนอน',
    rows: 10,
  },
  {
    id: 'convert',
    file: 'convert.html',
    icon: '🔁',
    label: 'ใบขอแปลงรหัสสินค้า',
    en: 'Code Conversion',
    desc: 'แปลงสินค้าขาย ↔ สินค้าแถม — ใส่รหัสด้านหนึ่ง อีกด้านขึ้นให้จากคู่ที่บันทึกไว้',
    paper: 'A5 แนวนอน',
    rows: 9,
  },
  {
    id: 'tag',
    file: 'tag.html',
    icon: '🏷️',
    label: 'ป้ายบ่งชี้',
    en: 'Identification Tag',
    desc: 'ป้ายรับเข้าคลัง — Location / SKU / PO / LOT / QTY / MFG / ผู้รับเข้า-ผู้ตรวจสอบ',
    paper: 'A5 แนวนอน หรือ A4 แนวตั้ง',
    rows: 1, unit: 'ป้าย/แผ่น (หรือ 2 ใบต่อ A4)',
  },
  {
    id: 'saffron',
    file: 'saffron.html',
    icon: '📦',
    label: 'ใบขนย้ายของ Saffron',
    en: 'Saffron Move Slip',
    desc: 'มีชื่อเอกสารกับวันที่ · 20 ใบต่อแผ่น (ต้นฉบับมีแค่สองช่องนี้)',
    paper: 'A4 แนวตั้ง',
    rows: 20, unit: 'ใบ/แผ่น',
  },
];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function navHTML(activeForm = null) {
  const tabs = activeForm
    ? '\n    <nav class="mod-subnav">\n      ' +
      `<a class="mod-tab" href="./">📁 รายการเอกสาร</a>\n      ` +
      FORMS.map((f) =>
        f.id === activeForm
          ? `<span class="mod-tab active">${f.icon} ${esc(f.label)}</span>`
          : `<a class="mod-tab" href="./${f.file}">${f.icon} ${esc(f.label)}</a>`
      ).join('\n      ') +
      '\n    </nav>'
    : '';

  return `<div class="mod-head">
      <div class="mod-title">
        <div class="ic">🏬</div>
        <div>
          <h2>เอกสารคลังสินค้า · Warehouse Forms</h2>
          <p>กรอกในเว็บแล้วสั่งพิมพ์ — ใส่รหัส SKU แล้วชื่อสินค้าขึ้นเอง</p>
        </div>
      </div>${tabs}
    </div>`;
}

export function mountNav(doc = document) {
  for (const slot of doc.querySelectorAll('[data-wh-nav]')) {
    slot.outerHTML = navHTML(slot.getAttribute('data-wh-nav') || null);
  }
}

mountNav();
