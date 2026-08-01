/**
 * @file carrier-label.js — box labels for third-party carriers.
 *
 * One engine, three pages (Kex / Best / Business Idea). They differ only in
 * branding, so the whole tool is shared and each page just calls:
 *
 *   initCarrierLabel({ carrier: 'kex', name: 'Kex express' });
 *
 * WHY THE COLUMN MAPPER: unlike the รถบริษัท tools — which read fixed columns
 * (A ชื่อรถ, B Date, …) because that file is ours — every carrier exports its
 * own headers. So we detect headers by name, let the user correct the guess,
 * and remember the mapping per carrier. Column ORDER can then change without
 * breaking anything, because mappings are stored by header text, not index.
 *
 * Needs SheetJS; JsBarcode is optional (labels fall back to plain text).
 */

/* ── Fields a label can show, and the header names that map onto them ─────── */
const FIELDS = [
  { key: 'tracking', label: 'เลขพัสดุ / Tracking', required: true,
    aliases: ['เลขพัสดุ', 'หมายเลขพัสดุ', 'เลขที่พัสดุ', 'เลขติดตาม', 'เลขconsign', 'consign', 'consignmentno', 'tracking', 'trackingno', 'trackingnumber', 'awb', 'waybill', 'barcode', 'parcelno'] },
  { key: 'customer', label: 'ชื่อผู้รับ', required: true,
    aliases: ['ชื่อผู้รับ', 'ผู้รับ', 'ชื่อลูกค้า', 'ลูกค้า', 'customer', 'customername', 'consignee', 'name', 'receiver'] },
  { key: 'address', label: 'ที่อยู่', required: true,
    aliases: ['ที่อยู่', 'ที่อยู่จัดส่ง', 'ที่อยู่ผู้รับ', 'address', 'addr', 'shippingaddress'] },
  { key: 'phone', label: 'เบอร์โทร',
    aliases: ['เบอร์โทร', 'เบอร์', 'โทร', 'โทรศัพท์', 'phone', 'tel', 'mobile', 'phoneno', 'contact'] },
  { key: 'order', label: 'เลขออเดอร์',
    aliases: ['เลขออเดอร์', 'เลขorder', 'เลขที่ใบสั่งขาย', 'เลขที่', 'order', 'orderno', 'ordernumber', 'so', 'reference', 'ref'] },
  { key: 'qty', label: 'จำนวน',
    aliases: ['จำนวน', 'ชิ้น', 'qty', 'quantity', 'pcs'] },
  { key: 'cod', label: 'เก็บเงินปลายทาง (COD)',
    aliases: ['cod', 'ยอดcod', 'เก็บเงินปลายทาง', 'ยอดเก็บเงิน', 'เก็บปลายทาง', 'codamount', 'amount', 'ยอดเงิน'] },
  { key: 'remark', label: 'หมายเหตุ',
    aliases: ['หมายเหตุ', 'remark', 'remarks', 'note', 'notes'] },
];

const SIZES = {
  portrait: { w: 100, h: 150, label: '100 × 150 mm (แนวตั้ง)' },
  landscape: { w: 150, h: 100, label: '150 × 100 mm (แนวนอน)' },
};

/** Sender block. Same company the ใบนำส่ง prints. */
const SENDER = { name: 'บริษัท ฮอริซอน กรุ๊ป (ประเทศไทย) จำกัด', line: 'คลังสินค้า Outbound' };

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Compare header text loosely: case, spaces and punctuation don't matter. */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_\-.()/:]/g, '');

/* ── State ───────────────────────────────────────────────────────────────── */
let cfg = { carrier: '', name: '' };
let headers = []; // header row text
let rows = []; // data rows (arrays)
let mapping = {}; // field key -> header text
let autoMapped = new Set(); // fields the guesser filled, for the UI hint
let selected = new Set(); // row indexes to print
let sizeKey = 'portrait';

const mapStoreKey = () => `wms:clabel:${cfg.carrier}:map`;
const SIZE_STORE_KEY = 'wms:clabel:size';

/* ── Excel ───────────────────────────────────────────────────────────────── */

/**
 * The header row is the first row carrying at least three non-empty cells —
 * carrier exports often start with a title or a blank line or two.
 */
function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const filled = (matrix[i] || []).filter((c) => String(c ?? '').trim() !== '').length;
    if (filled >= 3) return i;
  }
  return 0;
}

/**
 * How well one header matches one field. Higher wins; 0 means no match.
 *
 * Alias length is part of the score so the MORE SPECIFIC alias wins: header
 * "Consignee Name" contains both `consignee` (ผู้รับ) and `consign` (เลขพัสดุ),
 * and it is the recipient — the longer alias is the right answer.
 */
function score(header, field) {
  const h = norm(header);
  if (!h) return 0;
  let best = 0;
  for (const alias of field.aliases) {
    const a = norm(alias);
    if (!a) continue;
    if (h === a) best = Math.max(best, 100 + a.length);
    else if (h.includes(a)) best = Math.max(best, 50 + a.length);
    else if (a.includes(h)) best = Math.max(best, 30 + h.length);
  }
  return best;
}

/**
 * Best-guess mapping. Every (field, header) pair is scored, then assigned
 * best-first — so the result does not depend on the order FIELDS happens to be
 * declared in, and an exact match always beats a partial one elsewhere.
 */
function autoMap(hdrs) {
  const pairs = [];
  for (const f of FIELDS) {
    for (const h of hdrs) {
      const s = score(h, f);
      if (s > 0) pairs.push({ field: f.key, header: h, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);

  const guess = {};
  const takenHeaders = new Set();
  for (const p of pairs) {
    if (guess[p.field] || takenHeaders.has(p.header)) continue;
    guess[p.field] = p.header;
    takenHeaders.add(p.header);
  }
  return guess;
}

function readWorkbook(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let matrix;
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    } catch (err) {
      alert('อ่านไฟล์ไม่สำเร็จ: ' + err.message);
      return;
    }
    if (!matrix.length) {
      alert('ไฟล์ว่าง ไม่มีข้อมูล');
      return;
    }

    const hi = findHeaderRow(matrix);
    headers = (matrix[hi] || []).map((h) => String(h ?? '').trim());
    rows = matrix.slice(hi + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));

    // A saved mapping wins, but only for headers this file actually has.
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(mapStoreKey()) || '{}');
    } catch {
      saved = {};
    }
    const guess = autoMap(headers);
    mapping = {};
    autoMapped = new Set();
    for (const f of FIELDS) {
      // An empty saved value means "the user turned this field OFF" — that is a
      // decision, not a gap, so the guesser must not quietly fill it back in.
      // Only fall back to the guess when there is no saved choice at all, or
      // when the saved column is missing from this particular file.
      const chosen = Object.prototype.hasOwnProperty.call(saved, f.key);
      if (chosen && (saved[f.key] === '' || headers.includes(saved[f.key]))) {
        mapping[f.key] = saved[f.key];
      } else if (guess[f.key]) {
        mapping[f.key] = guess[f.key];
        autoMapped.add(f.key);
      } else mapping[f.key] = '';
    }

    selected = new Set(rows.map((_, i) => i)); // start with everything selected
    render();
  };
  reader.readAsBinaryString(file);
}

/* ── Reading a value out of a row ────────────────────────────────────────── */
function valueOf(row, key) {
  const header = mapping[key];
  if (!header) return '';
  const i = headers.indexOf(header);
  return i === -1 ? '' : String(row[i] ?? '').trim();
}

/** COD only prints when there is an amount > 0 — a "0" box confuses drivers. */
function codOf(row) {
  const raw = valueOf(row, 'cod').replace(/[,\s฿]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ── Label markup ────────────────────────────────────────────────────────── */
function labelHTML(row, i) {
  const cod = codOf(row);
  const tracking = valueOf(row, 'tracking');
  const order = valueOf(row, 'order');
  const qty = valueOf(row, 'qty');
  const remark = valueOf(row, 'remark');
  const phone = valueOf(row, 'phone');

  return `<div class="clabel">
  <div class="clabel-hdr">
    <div class="clabel-carrier">${esc(cfg.name)}</div>
    <div class="clabel-from"><b>ผู้ส่ง</b><br>${esc(SENDER.name)}<br>${esc(SENDER.line)}</div>
  </div>
  <div>
    <div class="clabel-to-lbl">ผู้รับ / TO</div>
    <div class="clabel-name">${esc(valueOf(row, 'customer')) || '—'}</div>
    ${phone ? `<div class="clabel-phone">โทร ${esc(phone)}</div>` : ''}
    <div class="clabel-addr">${esc(valueOf(row, 'address'))}</div>
  </div>
  ${cod !== null ? `<div class="clabel-cod"><div class="k">เก็บเงินปลายทาง COD</div><div class="v">฿${cod.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div></div>` : ''}
  ${order || qty ? `<div class="clabel-meta">${order ? `<span>Order <b>${esc(order)}</b></span>` : '<span></span>'}${qty ? `<span>จำนวน <b>${esc(qty)}</b></span>` : ''}</div>` : ''}
  ${remark ? `<div class="clabel-remark">${esc(remark)}</div>` : ''}
  <div class="clabel-code">
    <svg class="clabel-bc" data-value="${esc(tracking)}" data-i="${i}"></svg>
    <div class="clabel-track">${esc(tracking) || '—'}</div>
  </div>
</div>`;
}

/** Draw Code128 into every barcode slot. Self-contained SVG, so printing copies fine. */
function drawBarcodes(scope) {
  if (typeof JsBarcode === 'undefined') return;
  for (const el of scope.querySelectorAll('.clabel-bc')) {
    const v = el.dataset.value;
    if (!v) {
      el.remove();
      continue;
    }
    try {
      JsBarcode(el, v, { format: 'CODE128', displayValue: false, height: 40, margin: 0, width: 1.6 });
    } catch {
      el.remove(); // value the symbology can't encode — the text below still shows it
    }
  }
}

/* ── Rendering ───────────────────────────────────────────────────────────── */
function missingRequired() {
  return FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}

function render() {
  const root = document.getElementById('cl-root');
  const size = SIZES[sizeKey];

  if (!rows.length) {
    root.innerHTML = uploadHTML();
    wireUpload();
    return;
  }

  const missing = missingRequired();
  root.innerHTML = `
    ${mapPanelHTML()}
    <div class="cl-bar">
      <div class="cl-sizes">
        ${Object.entries(SIZES)
          .map(([k, s]) => `<button class="cl-size${k === sizeKey ? ' active' : ''}" data-size="${k}">${s.label}</button>`)
          .join('')}
      </div>
      <span class="spacer"></span>
      <span class="cl-count">เลือก <b id="cl-n">${selected.size}</b> / ${rows.length} ใบ</span>
      <button class="btn" id="cl-all">เลือกทั้งหมด</button>
      <button class="btn" id="cl-none">ล้างที่เลือก</button>
      <button class="btn btn-blue" id="cl-print"${missing.length ? ' disabled' : ''}>🖨️ พิมพ์ที่เลือก</button>
      <button class="btn" id="cl-reset">เปลี่ยนไฟล์</button>
    </div>
    ${missing.length ? `<div class="info-note" style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:10px 12px;font-size:13px;color:#92400E">ยังไม่ได้เลือกคอลัมน์: <b>${missing.map(esc).join(', ')}</b> — พิมพ์ไม่ได้จนกว่าจะครบ</div>` : ''}
    <div class="cl-grid">
      ${rows
        .map(
          (r, i) => `<div class="cl-card${selected.has(i) ? ' sel' : ''}${sizeKey === 'landscape' ? ' land' : ''}" data-i="${i}">
        <div class="cl-selbar"><input type="checkbox" ${selected.has(i) ? 'checked' : ''} tabindex="-1"> ใบที่ ${i + 1}</div>
        ${labelHTML(r, i)}
      </div>`
        )
        .join('')}
    </div>
    <div class="cl-print-area" style="display:none"></div>
    <style id="cl-page-style">@page{size:${size.w}mm ${size.h}mm;margin:0}
      @media print{.cl-print-area .clabel{width:${size.w}mm;height:${size.h}mm;page-break-after:always;break-after:page}}
    </style>`;

  drawBarcodes(root);
  wireGrid();
}

function uploadHTML() {
  return `<div class="upload-zone" id="cl-drop" style="padding:44px 20px;text-align:center;cursor:pointer">
      <div style="font-size:34px">📤</div>
      <div style="font-size:15px;font-weight:600;margin-top:8px">ลากไฟล์ Excel ของ ${esc(cfg.name)} มาวาง</div>
      <div style="font-size:12px;color:var(--wms-muted);margin-top:4px">หรือคลิกเพื่อเลือกไฟล์ · .xlsx .xls .csv</div>
      <div style="font-size:12px;color:var(--wms-muted);margin-top:10px">ระบบจะอ่านหัวคอลัมน์ให้เอง แล้วให้แก้ได้ถ้าจับผิด</div>
      <input type="file" id="cl-file" accept=".xlsx,.xls,.csv" hidden>
    </div>`;
}

function mapPanelHTML() {
  const opts = (sel) =>
    ['<option value="">— ไม่ใช้ —</option>']
      .concat(headers.map((h) => `<option value="${esc(h)}"${h === sel ? ' selected' : ''}>${esc(h)}</option>`))
      .join('');
  return `<div class="cl-map">
    <h3>จับคู่คอลัมน์</h3>
    <p class="hint">อ่านหัวคอลัมน์จากไฟล์แล้ว — แก้ได้ถ้าจับผิด ระบบจะจำไว้ใช้ครั้งต่อไปของ ${esc(cfg.name)}</p>
    <div class="cl-map-grid">
      ${FIELDS.map(
        (f) => `<div class="cl-field${autoMapped.has(f.key) ? ' auto' : ''}">
        <label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
        <select data-field="${f.key}">${opts(mapping[f.key])}</select>
      </div>`
      ).join('')}
    </div>
    ${autoMapped.size ? `<p class="cl-auto-note">ช่องที่ไฮไลต์ = ระบบเดาให้ (${autoMapped.size} ช่อง) กรุณาตรวจก่อนพิมพ์</p>` : ''}
  </div>`;
}

/* ── Events ──────────────────────────────────────────────────────────────── */
function wireUpload() {
  const dz = document.getElementById('cl-drop');
  const input = document.getElementById('cl-file');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => e.target.files[0] && readWorkbook(e.target.files[0]));
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    if (e.dataTransfer.files[0]) readWorkbook(e.dataTransfer.files[0]);
  });
}

function wireGrid() {
  const root = document.getElementById('cl-root');

  root.querySelectorAll('.cl-field select').forEach((sel) =>
    sel.addEventListener('change', () => {
      mapping[sel.dataset.field] = sel.value;
      autoMapped.delete(sel.dataset.field); // the user has taken it over
      localStorage.setItem(mapStoreKey(), JSON.stringify(mapping));
      render();
    })
  );

  root.querySelectorAll('.cl-size').forEach((b) =>
    b.addEventListener('click', () => {
      sizeKey = b.dataset.size;
      localStorage.setItem(SIZE_STORE_KEY, sizeKey);
      render();
    })
  );

  root.querySelectorAll('.cl-card').forEach((card) =>
    card.addEventListener('click', () => {
      const i = Number(card.dataset.i);
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
      card.classList.toggle('sel', selected.has(i));
      card.querySelector('input').checked = selected.has(i);
      document.getElementById('cl-n').textContent = selected.size;
    })
  );

  const setAll = (on) => {
    selected = on ? new Set(rows.map((_, i) => i)) : new Set();
    render();
  };
  document.getElementById('cl-all').addEventListener('click', () => setAll(true));
  document.getElementById('cl-none').addEventListener('click', () => setAll(false));
  document.getElementById('cl-reset').addEventListener('click', () => {
    rows = [];
    headers = [];
    render();
  });
  document.getElementById('cl-print').addEventListener('click', printSelected);
}

/**
 * Print in-page rather than via window.open: no popup blocker to fight, and the
 * barcodes are already inline SVG so nothing has to be re-rendered.
 */
function printSelected() {
  if (!selected.size) {
    alert('ยังไม่ได้เลือกใบที่จะพิมพ์');
    return;
  }
  const area = document.querySelector('.cl-print-area');
  area.innerHTML = [...selected]
    .sort((a, b) => a - b)
    .map((i) => document.querySelector(`.cl-card[data-i="${i}"] .clabel`).outerHTML)
    .join('');
  area.style.display = 'block';
  window.print();
  area.style.display = 'none';
}

/* ── Entry point ─────────────────────────────────────────────────────────── */
export function initCarrierLabel(config) {
  cfg = config;
  sizeKey = localStorage.getItem(SIZE_STORE_KEY) || 'portrait';
  if (!SIZES[sizeKey]) sizeKey = 'portrait';
  render();
}
