/**
 * book-grid.js — สมุดสต๊อก ขั้น 2–3: แท็บ ย้าย / เติม / QA, คืนของ และตารางแบบสมุดเดิม (หัวหน้า) ของหน้า public/book/
 *
 * ตารางพิมพ์แบบ Excel หนึ่งแถวต่อหนึ่งงาน วางจาก Excel ได้ (Ctrl+V ลงช่องไหนก็เติมจากช่องนั้น วางนอกตารางต่อท้าย)
 * ทุกครั้งที่พิมพ์ คิดแผนใหม่จากกองสต๊อกของหน้า (ST) แล้วขึ้นผลท้ายแถว ไม่วาดช่องพิมพ์ใหม่ เคอร์เซอร์จะได้ไม่หลุด
 * กติกาเลือกกอง / LOT / PO อยู่ใน public/wms-book.js (planMoves, planReturns, planRows)
 * โหมดบันทึก (หลังตัดรอบ) กดบันทึกแล้วลงสมุดใหม่เลย ไม่ต้องคัดลอก · ส่งไม่สำเร็จเพราะเน็ต ชุดค้างไว้แล้วส่งซ้ำเอง (queueRetry ของหน้า)
 *
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (USER RES ST DOCS REF BKBUSY MSG LAST esc f dm bookPost copyText compute render
 * refreshDocs actTail bookMode shortList queueRetry) ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า ห้ามเรียกของพวกนั้นตอนโหลด
 * เปิดเป็น window.BookGrid
 */
(function () {
  'use strict';

  var COLS = {
    move: [
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku' },
      { k: 'from', t: 'จาก', w: 100, dl: 'dl-loc', ph: 'R เก่าสุด' },
      { k: 'to', t: 'ไป', w: 100, dl: 'dl-loc', ph: 'โลเปิดขาย' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true },
      { k: 'lot', t: 'LOT', w: 46, ph: 'FIFO' },
      { k: 'po', t: 'PO', w: 100, ph: 'FIFO' },
      { k: 'status', t: 'เปิด?', w: 50, ph: 'auto' },
    ],
    ret: [
      { k: 'key', t: 'ออเดอร์ / เลขพัสดุ', w: 150 },
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku', ph: 'ทั้งออเดอร์' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true, ph: 'ที่เหลือ' },
      { k: 'to', t: 'โลที่วาง', w: 100, dl: 'dl-loc', ph: 'โลเปิดขาย' },
      { k: 'note', t: 'M/E', w: 96, ph: 'RETURN' },
    ],
    rows: [
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku' },
      { k: 'lot', t: 'LOT', w: 46 },
      { k: 'po', t: 'PO', w: 100 },
      { k: 'from', t: 'Location เบิก', w: 100, dl: 'dl-loc' },
      { k: 'to', t: 'Location รับ', w: 100, dl: 'dl-loc' },
      { k: 'qty', t: 'QTY', w: 54, num: true },
      { k: 'type', t: 'รับ/เบิก', w: 62, dl: 'dl-type' },
      { k: 'note', t: 'Note', w: 150 },
      { k: 'status', t: 'Status', w: 54, ph: 'auto' },
    ],
  };
  var TITLE = { move: 'ย้าย / เติม / QA', ret: 'คืนของ', rows: 'ตารางแบบสมุดเดิม' };
  var TIP = {
    move: 'พิมพ์หรือวางจาก Excel เรียงคอลัมน์ SKU · จาก · ไป · ชิ้น · LOT · PO\n' +
      'จากว่าง = เติมจากของสำรองที่ R กองเก่าสุด (Supplier เดียวกับที่เปิดขายก่อน)\nไปว่าง = โลที่ SKU นี้เปิดขายอยู่\n' +
      'LOT / PO ว่าง = เอากองที่โลต้นทางตาม FIFO แบ่งหลายกองให้เอง\nเปิด? ว่าง = ตามโลปลายทาง (R QA RIB ทางเดิน ไม่เปิด) พิมพ์ - = ไม่เปิด\n' +
      'ย้ายต่อจากโลที่เพิ่งย้ายเข้าในชุดเดียวกันได้ (QA → ORDER แล้ว ORDER → S)',
    ret: 'วางเลขออเดอร์ / เลขอ้างอิง (ออนไลน์) / เลขพัสดุ ทีละบรรทัด ระบบหาว่าตัดจากกองไหน แล้วคืนเข้า LOT / PO เดิม\n' +
      'ไม่ใส่ SKU = คืนทั้งออเดอร์ · ไม่ใส่ชิ้น = ชิ้นที่ยังไม่คืน\nไม่เจอ (ออเดอร์ที่ตัดด้วยมือในชีตเดิม) = ใส่ SKU กับชิ้น คืนเป็น LOT 0 / PO 0 แบบเดิม\n' +
      'โลที่วางว่าง = โลที่ SKU นี้เปิดขายอยู่ · ช่อง M/E ใส่เลข M/E-xxxxx ถ้าเป็นของ M/E',
    rows: 'ลงแถวแบบชีต Transaction เดิม ใช้กับงานที่ยังไม่มีหน้า (รับของ แปลงสินค้า M/E ปรับยอด) เฉพาะหัวหน้า\n' +
      'วางจาก Excel ได้ เรียงคอลัมน์ SKU · LOT · PO · Location เบิก · Location รับ · QTY · รับ/เบิก · Note · Status\n' +
      'รับ = มีแต่ Location รับ ต้องใส่ LOT PO · เบิก = มี Location เบิก (รับมีหรือไม่ก็ได้) · ขาย = มีแต่ Location เบิก\n' +
      'แถวเบิก/ขาย LOT PO ว่าง = โลนั้นมี SKU นี้กองเดียวใช้กองนั้น · กองไม่พอบันทึกไม่ได้ · ทุกแถวต้องมี Note\n' +
      'แถวขาย Note = วันที่ขาย แบบชีตเดิม (ว่างไว้ = วันที่ของชุด)\n' +
      'Status ว่าง = ตามโลรับ (R QA RIB ทางเดิน ไม่เปิด) พิมพ์ - = ไม่เปิด',
  };
  var KEY = { move: 'wms:book:draft:move', ret: 'wms:book:draft:ret', rows: 'wms:book:draft:rows' };
  var TYPE = { move: 'ย้าย', ret: 'คืน', rows: 'ตารางเดิม' };
  var OP = { move: 'bk-move', ret: 'bk-return', rows: 'bk-rows' };

  var S = {};                 // { move: {rows, date, pending}, ret: {...} } โหลดตอนใช้ครั้งแรก
  var LOOK = { found: {}, miss: {} };
  var PLAN = { move: null, ret: null };
  var DRAWN = null;           // ตารางที่วาดอยู่ { mode, n, res } เปลี่ยนเมื่อไรถึงวาดใหม่ทั้งตาราง
  var LISTS = null;           // RES ที่ใช้ทำ datalist ล่าสุด
  var FINDING = false, FIND_ERR = '', findTimer = 0, outTimer = 0, saveTimer = 0;

  function rj(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function wj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function $(id) { return document.getElementById(id); }

  function state(mode) {
    if (!S[mode]) {
      var d = rj(KEY[mode]) || {};
      S[mode] = { rows: Array.isArray(d.rows) ? d.rows : [], date: d.date || '', pending: d.pending || null, ref: d.ref || '' };
      if (!S[mode].date || S[mode].date < todayStr() && !S[mode].pending) S[mode].date = todayStr();
      tidy(mode);
    }
    return S[mode];
  }
  function blank(r) { return !r || !Object.keys(r).some(function (k) { return String(r[k] == null ? '' : r[k]).trim(); }); }
  /** แถวว่างท้ายตารางมีแถวเดียวเสมอ */
  function tidy(mode) {
    var rows = S[mode].rows;
    while (rows.length > 1 && blank(rows[rows.length - 1]) && blank(rows[rows.length - 2])) rows.pop();
    if (!rows.length || !blank(rows[rows.length - 1])) rows.push({});
  }
  function keep(mode, now) {
    clearTimeout(saveTimer);
    var go = function () { wj(KEY[mode], { rows: S[mode].rows, date: S[mode].date, pending: S[mode].pending, ref: S[mode].ref, at: Date.now() }); };
    if (now) go(); else saveTimer = setTimeout(go, 400);
  }

  function plan(mode) {
    if (!ST) return null;
    var g = state(mode);
    return mode === 'move' ? WmsBook.planMoves(g.rows, ST) : mode === 'rows' ? WmsBook.planRows(g.rows, ST, { date: g.date }) : WmsBook.planReturns(g.rows, LOOK, ST);
  }

  /* ── datalist SKU กับโล จากสต๊อกที่ดึงมา ───────────────────────────── */

  function lists() {
    if (!RES || LISTS === RES) return;
    LISTS = RES;
    var box = $('dls');
    if (!box) { box = document.createElement('div'); box.id = 'dls'; box.hidden = true; document.body.appendChild(box); }
    var sk = (RES.skus || []).map(function (t) { return '<option value="' + esc(t[0]) + '">' + esc(t[2] || '') + '</option>'; });
    var lc = (RES.locs || []).slice().sort(function (a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); })
      .map(function (l) { return '<option value="' + esc(l) + '"></option>'; });
    box.innerHTML = '<datalist id="dl-sku">' + sk.join('') + '</datalist><datalist id="dl-loc">' + lc.join('') + '</datalist>' +
      '<datalist id="dl-type">' + WmsBook.TX_TYPES.map(function (t) { return '<option value="' + t + '"></option>'; }).join('') + '</datalist>';
  }

  /* ── ผลท้ายแถว ──────────────────────────────────────────────────────── */

  function takeText(r, mode, o) {
    if (mode === 'rows') {
      return '<b>' + esc(r.type) + '</b>' + (r.type === 'ขาย' ? ' ' + esc(r.note.slice(8, 10) + '/' + r.note.slice(5, 7)) : '') + ' LOT ' + esc(r.lot) + ' · ' + esc(r.po) + ' ×' + f(r.qty) + ' ' + (r.from ? esc(r.from) : '') + (r.to ? ' → ' + esc(r.to) : '') +
        (r.status === 'เปิด' ? ' <span class="g-open">เปิด</span>' : '');
    }
    var lot = r.lot === '0' && r.po === '0' ? '<span class="c-warn">LOT 0 / PO 0</span>' : 'LOT ' + esc(r.lot) + ' · ' + esc(r.po);
    /* ตัวหนา = ระบบเลือกให้ */
    var where = mode === 'move'
      ? (o.autoFrom ? '<b>' + esc(r.from) + '</b>' : esc(r.from)) + ' → ' + (o.autoTo ? '<b>' + esc(r.to) + '</b>' : esc(r.to))
      : '→ ' + (o.in.to ? esc(r.to) : '<b>' + esc(r.to) + '</b>');
    var st = r.status === 'เปิด' ? ' <span class="g-open">เปิด</span>' : '';
    var doc = mode === 'ret' && r.doc ? ' <span class="c-sub">ตัด ' + esc(r.doc) + '</span>' : '';
    var sku = mode === 'ret' && !o.in.sku ? '<b>' + esc(r.sku) + '</b> ' : '';
    return sku + lot + ' ×' + f(r.qty) + (where ? ' ' + where : '') + st + doc;
  }

  function outHtml(mode, o) {
    if (!o || o.st === 'blank') return '';
    if (o.st === 'bad') return '<span class="c-red">' + esc(o.why) + '</span>';
    if (o.st === 'wait') return '<span class="c-sub">' + (FINDING ? 'กำลังหา…' : esc(o.why)) + '</span>';
    var html = o.take.map(function (r) { return '<span class="tk">' + takeText(r, mode, o) + '</span>'; }).join('<br>');
    if (o.warn.length) html += '<br><span class="c-warn">⚠ ' + o.warn.map(esc).join(' · ') + '</span>';
    return html;
  }

  function nameOf(mode, o) {
    if (!o || o.st === 'blank' || !ST) return '';
    var many = o.take.some(function (t) { return t.s !== o.take[0].s; });
    if (many) return '';   // คืนทั้งออเดอร์หลาย SKU ชื่ออยู่ในช่องลงสมุดแล้ว
    var s = mode === 'move' ? o.s : o.take.length ? o.take[0].s : ST.code(String(o.in.sku || ''));
    if (s === undefined) s = -1;
    var t = s >= 0 ? ST.skus[s] : null;
    return t ? t[2] || '' : '';
  }

  function updateOut(mode) {
    PLAN[mode] = plan(mode);
    var p = PLAN[mode];
    var g = state(mode);
    g.rows.forEach(function (r, i) {
      var cell = $('go-' + i), nm = $('gn-' + i), tr = cell && cell.parentNode;
      if (!cell) return;
      var o = p ? p.lines[i] : null;
      cell.innerHTML = p ? outHtml(mode, o) : (blank(r) ? '' : '<span class="c-sub">รอสต๊อกจากสมุด Transaction</span>');
      if (nm) { var n = nameOf(mode, o); nm.textContent = n; nm.title = n; }
      tr.className = o && o.st === 'bad' ? 'r-bad' : o && o.warn && o.warn.length ? 'r-warn' : '';
    });
    renderSum(mode);
    renderAct(mode);
  }
  function soon(mode) { clearTimeout(outTimer); outTimer = setTimeout(function () { updateOut(mode); }, 120); }

  /* ── วาด ───────────────────────────────────────────────────────────── */

  function renderIn(mode) {
    var g = state(mode);
    var need = mode === 'ret' ? WmsBook.lookKeys(g.rows, LOOK).length : 0;
    var html = '<div class="bk-top"><span class="bk-h">' + TITLE[mode] + '</span>' +
      '<button type="button" class="g-tip" title="' + esc(TIP[mode]) + '" aria-label="วิธีใช้">ⓘ</button>' +
      '<span class="g-hint">' + (mode === 'move' ? 'พิมพ์หรือ Ctrl+V จาก Excel · ช่องว่างระบบเลือกให้'
        : mode === 'rows' ? 'เฉพาะหัวหน้า · งานที่ยังไม่มีหน้า' : 'วางเลขออเดอร์ / เลขพัสดุ ระบบหากองที่ตัดให้') + '</span>';
    if (mode === 'rows') {
      html += '<input class="bk-field" id="gRef" style="width:220px" maxlength="60" placeholder="อ้างอิง เช่น เลข GR / Transfer" value="' + esc(g.ref || '') + '">';
    }
    if (mode === 'ret') {
      html += '<button class="tx-opt' + (need ? ' p' : '') + '" id="gFind" ' + (FINDING || !need || !USER ? 'disabled' : '') + '>' +
        (FINDING ? 'กำลังหา…' : '🔍 หาออเดอร์' + (need ? ' ' + f(need) : '')) + '</button>';
    }
    html += '<span class="sp"></span>' +
      (g.rows.length > 1 ? '<button class="bk-link" id="gClear">ล้างตาราง</button>' : '') +
      '<label for="gDate">วันที่ <input type="date" class="bk-date" id="gDate" value="' + esc(g.date) + '"></label></div>';
    if (FIND_ERR) html += '<div class="bk-warn">หาออเดอร์ไม่สำเร็จ: ' + esc(FIND_ERR) + '</div>';
    if (mode === 'ret' && !USER) html += '<div class="bk-warn">เข้าสมุดก่อน (มุมขวาบน) ถึงจะหาออเดอร์ที่ตัดได้</div>';
    $('inp').innerHTML = html;
  }

  function renderSum(mode) {
    var p = PLAN[mode];
    if (!p || !p.total.lines) { $('sum').innerHTML = ''; return; }
    var t = p.total;
    var chip = function (cls, label, n, sub) {
      return '<span class="bk-chip ' + cls + (n ? '' : ' zero') + '">' + label + ' <b>' + f(n) + '</b>' + (sub ? ' ' + sub : '') + '</span>';
    };
    var html = chip('c-ok', 'ลงสมุด', t.rows, 'แถว · ' + f(t.qty) + ' ชิ้น') + chip('c-red', 'แถวผิด', t.bad, '') + chip('c-warn', 'เตือน', t.warn, '');
    if (mode === 'ret') html += chip('', 'รอหา', t.wait, '') + chip('c-warn', 'LOT 0', t.lot0, 'บรรทัด');
    $('sum').innerHTML = html;
  }

  function canSave(mode) {
    var p = PLAN[mode];
    return !!(USER && DOCS_OK && p && p.total.rows && !p.total.bad && !p.total.wait && !BKBUSY);
  }

  function renderAct(mode) {
    var g = state(mode), p = PLAN[mode], html = '';
    if (g.pending) {
      html += '<button class="bk-save" id="gSave" ' + (!USER || BKBUSY ? 'disabled' : '') + '>' + (BKBUSY ? esc(BKBUSY) : '↻ ส่งอีกครั้ง') + '</button>' +
        '<span>ชุดที่ส่งค้าง <b>' + f(g.pending.copy.length) + '</b> แถว ยังไม่รู้ว่าถึงสมุดไหม ระบบส่งซ้ำเองทุก 30 วินาที (กดเองก็ได้) ไม่บันทึกซ้ำ</span>' +
        '<button class="bk-link" id="gDrop">ทิ้งชุดนี้</button>';
    } else {
      var n = p ? p.total.rows : 0;
      html += '<button class="bk-save" id="gSave" ' + (canSave(mode) ? '' : 'disabled') + '>' + (BKBUSY ? esc(BKBUSY)
        : bookMode() ? '💾 ลงสมุด ' + f(n) + ' แถว' : '💾 บันทึก + คัดลอก ' + f(n) + ' แถว') + '</button>';
      if (!USER) html += '<span>เข้าสมุดด้วยชื่อกับรหัสก่อน (มุมขวาบน)</span>';
      else if (!DOCS_OK && !BKBUSY) html += '<button class="bk-link" id="docsBtn">โหลดชุดที่บันทึกอีกครั้ง</button>';
      else if (p && p.total.bad) html += '<span class="c-red">แก้หรือลบแถวผิด ' + f(p.total.bad) + ' แถวก่อน</span>';
      else if (p && p.total.wait) html += '<span>รอหาออเดอร์ ' + f(p.total.wait) + ' แถว</span>';
      else if (!ST && RES === null) html += '<span>รอสต๊อกจากสมุด Transaction</span>';
    }
    html += actTail();
    $('act').innerHTML = html;
  }

  function cellHtml(mode, c, i, r, last) {
    var v = r[c.k] == null ? '' : r[c.k];
    return '<td class="g-in' + (c.num ? ' num' : '') + '"><input data-r="' + i + '" data-c="' + c.k + '" value="' + esc(v) + '"' +
      (c.dl ? ' list="' + c.dl + '"' : '') + (last && c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') +
      (c.num ? ' inputmode="decimal"' : '') + ' autocomplete="off" spellcheck="false" aria-label="' + esc(c.t) + ' แถว ' + (i + 1) + '"></td>';
  }

  function renderBody(mode, force) {
    var g = state(mode);
    if (!force && DRAWN && DRAWN.mode === mode && DRAWN.n === g.rows.length && DRAWN.res === RES && $('gTable')) { updateOut(mode); return; }
    lists();
    var cols = COLS[mode];
    var focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.c
      ? { r: document.activeElement.dataset.r, c: document.activeElement.dataset.c, s: document.activeElement.selectionStart } : null;
    var head = '<tr><th class="num">#</th>' + cols.map(function (c) { return '<th style="min-width:' + c.w + 'px">' + esc(c.t) + '</th>'; }).join('') +
      '<th>ลงสมุด</th><th>ชื่อสินค้า</th><th class="c-act"></th></tr>';
    var body = g.rows.map(function (r, i) {
      var last = i === g.rows.length - 1;
      return '<tr><td class="c-no num">' + (i + 1) + '</td>' + cols.map(function (c) { return cellHtml(mode, c, i, r, last); }).join('') +
        '<td class="g-out" id="go-' + i + '"></td><td class="c-nm c-sub" id="gn-' + i + '"></td>' +
        '<td class="c-act">' + (last && blank(r) ? '' : '<button class="bk-x" data-gdel="' + i + '" aria-label="ลบแถว ' + (i + 1) + '">✕</button>') + '</td></tr>';
    }).join('');
    $('body').innerHTML = '<div class="bk-wrap"><table class="bk-xl g-xl" id="gTable"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    DRAWN = { mode: mode, n: g.rows.length, res: RES };
    if (focus) {
      var el = document.querySelector('#gTable input[data-r="' + focus.r + '"][data-c="' + focus.c + '"]');
      if (el) { el.focus(); try { el.setSelectionRange(focus.s, focus.s); } catch (e) {} }
    }
    updateOut(mode);
  }

  function render(mode) {
    state(mode);
    renderIn(mode);
    renderBody(mode);
  }

  /* ── พิมพ์ / วาง ───────────────────────────────────────────────────── */

  function onInput(mode, el) {
    var g = state(mode), i = +el.dataset.r;
    if (!g.rows[i]) return;
    g.rows[i][el.dataset.c] = el.value;
    LAST = null;
    var grew = false;
    if (i === g.rows.length - 1 && el.value.trim()) { g.rows.push({}); grew = true; }
    keep(mode);
    if (grew) renderBody(mode, true);
    else soon(mode);
    if (mode === 'ret' && el.dataset.c === 'key') findSoon();
  }

  /** วางตารางจาก Excel ลงที่แถว r คอลัมน์ c (r = -1 ต่อท้าย) */
  function paste(mode, text, r, c) {
    var grid = String(text || '').replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(function (l) { return l.split('\t'); });
    if (!grid.length) return false;
    var g = state(mode), cols = COLS[mode];
    var c0 = c ? Math.max(0, cols.findIndex(function (x) { return x.k === c; })) : 0;
    if (r < 0) { r = g.rows.length; while (r > 0 && blank(g.rows[r - 1])) r--; }
    grid.forEach(function (line, k) {
      if (!line.some(function (v) { return v.trim(); }) && grid.length > 1) return;
      var row = g.rows[r + k] || (g.rows[r + k] = {});
      line.forEach(function (v, j) { var col = cols[c0 + j]; if (col) row[col.k] = v.trim(); });
    });
    for (var i = 0; i < g.rows.length; i++) if (!g.rows[i]) g.rows[i] = {};
    tidy(mode);
    LAST = null;
    keep(mode, true);
    renderIn(mode);
    renderBody(mode, true);
    if (mode === 'ret') findSoon(0);
    return true;
  }

  function move(el, dr) {
    var next = document.querySelector('#gTable input[data-r="' + (+el.dataset.r + dr) + '"][data-c="' + el.dataset.c + '"]');
    if (next) { next.focus(); next.select(); }
  }

  /* ── หาออเดอร์ (คืนของ) ────────────────────────────────────────────── */

  function findSoon(ms) { clearTimeout(findTimer); findTimer = setTimeout(find, ms === undefined ? 900 : ms); }

  async function find() {
    if (FINDING || !USER || !bookUrl()) return;
    var g = state('ret');
    var keys = WmsBook.lookKeys(g.rows, LOOK);
    if (!keys.length) return;
    FINDING = true; FIND_ERR = '';
    if (MODE === 'ret') { renderIn('ret'); updateOut('ret'); }
    try {
      var r = await bookPost('bk-find', { date: g.date, keys: keys.slice(0, 2000) });
      if (r.error) throw new Error(r.error);
      Object.keys(r.found || {}).forEach(function (k) { LOOK.found[k] = r.found[k]; });
      (r.miss || []).forEach(function (k) { LOOK.miss[k] = 1; });
    } catch (e) { FIND_ERR = e.message; }
    FINDING = false;
    if (MODE === 'ret') { renderIn('ret'); updateOut('ret'); }
    if (!FIND_ERR && WmsBook.lookKeys(g.rows, LOOK).length) findSoon(0);   // มีเลขใหม่ระหว่างหา
  }

  /* ── บันทึก ───────────────────────────────────────────────────────── */

  async function save(mode) {
    if (!USER || BKBUSY) return;
    var g = state(mode), p = g.pending;
    if (!p) {
      if (!canSave(mode)) return;
      var pl = PLAN[mode];
      p = { batch: WmsBook.uuid(), date: g.date, base: WmsBook.lastRow(RES),
        copy: mode === 'move' ? WmsBook.moveCopy(pl) : mode === 'rows' ? WmsBook.rowsCopy(pl) : WmsBook.returnCopy(pl) };
      if (mode === 'ret') p.lines = pl.save;
      if (mode === 'rows') p.ref = g.ref || '';
      p.names = WmsBook.namesOf(ST, p.copy);
      g.pending = p;
      keep(mode, true);
    }
    BKBUSY = 'กำลังบันทึก…'; MSG = null; LAST = null;
    show(mode);
    var r;
    try {
      r = await bookPost(OP[mode], p);
    } catch (e) {
      BKBUSY = '';
      MSG = { kind: 'warn', html: TITLE[mode] + ': ส่งไม่สำเร็จ (' + esc(e.message) + ') ยังไม่รู้ว่าถึงสมุดไหม ระบบส่งซ้ำเองเมื่อเน็ตกลับมา ไม่บันทึกซ้ำ' };
      show(mode);
      queueRetry();
      return;
    }
    BKBUSY = '';
    if (r.error) {
      g.pending = null;
      keep(mode, true);
      var list = (r.bad || []).slice(0, 8).map(function (b) { return '<li>แถว ' + b.n + (b.sku ? ' ' + esc(b.sku) : '') + (b.order ? ' ' + esc(b.order) : '') + ': ' + esc(b.why) + '</li>'; });
      if (r.over) {
        list = r.over.slice(0, 8).map(function (o) { return '<li>' + esc(o.key.split('|')[1]) + ' ' + esc(o.key.split('|')[2]) + ': ตัด ' + f(o.cut) + ' คืนแล้ว ' + f(o.back) + ' คืนเพิ่ม ' + f(o.qty) + '</li>'; });
        LOOK = { found: {}, miss: {} };
        findSoon(0);
      }
      MSG = { kind: 'bad', html: TITLE[mode] + ' บันทึกไม่สำเร็จ: ' + esc(r.error) + (list.length ? '<ol>' + list.join('') + '</ol>' : shortList(r)) };
      if (MODE === mode) render(mode); else renderAll();
      refreshDocs();
      return;
    }
    if (!DOCS.some(function (d) { return d.doc === r.doc; })) {
      DOCS.unshift({ doc: r.doc, type: TYPE[mode], date: p.date, who: USER.who, at: r.at || '', rows: p.copy.length,
        qty: Math.round(p.copy.reduce(function (a, c) { return a + (+c[6] || 0); }, 0) * 1000) / 1000,
        orders: mode === 'ret' ? new Set(p.lines.filter(function (l) { return l.order; }).map(function (l) { return l.sys + '|' + l.order; })).size : 0,
        status: '', base: r.book ? r.txAt - 1 : p.base, copy: p.copy, book: r.book ? 1 : 0 });
    }
    LAST = { doc: r.doc, who: USER.who, copy: p.copy, book: !!r.book, txAt: r.txAt };
    g.pending = null;
    g.rows = [{}];
    if (mode === 'rows') g.ref = '';
    keep(mode, true);
    if (mode === 'ret') LOOK = { found: {}, miss: {} };
    compute();
    if (!r.book) LAST.copied = await copyText(WmsBook.tsv(p.copy, USER.who, r.doc));
    renderAll();
    refreshDocs();
  }

  /** แถบบันทึกของแท็บนี้ถ้ากำลังเปิดอยู่ ไม่งั้นวาดทั้งหน้า (ส่งซ้ำเองตอนอยู่แท็บอื่น) */
  function show(mode) { if (MODE === mode) renderAct(mode); else renderAll(); }

  /** ส่งชุดที่ค้างของทุกแท็บอีกครั้ง (หน้าเรียกเองทุก 30 วินาทีหลังส่งไม่สำเร็จ และตอนเน็ตกลับมา) */
  async function retry() {
    var modes = Object.keys(KEY);
    for (var i = 0; i < modes.length; i++) {
      if (state(modes[i]).pending && !BKBUSY && USER) await save(modes[i]);
    }
  }

  /** วาดทั้งหน้าของสคริปต์ในหน้า */
  function renderAll() { window.render ? window.render() : null; }

  /* ── ปุ่มและช่อง (ทำงานเฉพาะตอนอยู่แท็บย้าย / คืน) ───────────────────── */

  function grid() { return typeof MODE !== 'undefined' && COLS[MODE] ? MODE : ''; }

  document.addEventListener('input', function (e) {
    var mode = grid();
    if (mode && e.target.matches && e.target.matches('#gTable input')) onInput(mode, e.target);
  });

  document.addEventListener('paste', function (e) {
    var mode = grid();
    if (!mode || !e.target.matches || !e.target.matches('#gTable input')) return;
    var text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;   // ข้อความช่องเดียว ให้วางในช่องตามปกติ
    e.preventDefault();
    e.stopPropagation();
    paste(mode, text, +e.target.dataset.r, e.target.dataset.c);
  }, true);

  document.addEventListener('keydown', function (e) {
    var mode = grid();
    if (!mode || !e.target.matches || !e.target.matches('#gTable input')) return;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.target.list)) { e.preventDefault(); move(e.target, 1); }
    else if (e.key === 'ArrowUp' && !e.target.list) { e.preventDefault(); move(e.target, -1); }
  });

  document.addEventListener('change', function (e) {
    var mode = grid();
    if (!mode) return;
    if (e.target.id === 'gRef') { state(mode).ref = e.target.value.trim(); keep(mode, true); return; }
    if (e.target.id === 'gDate' && e.target.value) {
      state(mode).date = e.target.value;
      keep(mode, true);
      if (mode === 'ret') { LOOK = { found: {}, miss: {} }; findSoon(0); }
    }
  });

  document.addEventListener('click', function (e) {
    var mode = grid();
    var t = e.target.closest && e.target.closest('button');
    if (!mode || !t) return;
    var g = state(mode);
    if (t.id === 'gSave') save(mode);
    else if (t.id === 'gFind') find();
    else if (t.id === 'gClear') {
      if (!confirm('ล้างทุกแถวในตาราง' + TITLE[mode] + '?')) return;
      g.rows = [{}]; LAST = null; MSG = null; keep(mode, true); render(mode);
    } else if (t.id === 'gDrop') {
      if (!confirm('ทิ้งชุดที่ส่งค้าง?\nถ้าชุดนี้ถึงสมุดแล้ว จะเห็นในตารางชุดที่บันทึกด้านล่าง กดคัดลอกจากตรงนั้นได้')) return;
      g.pending = null; keep(mode, true); MSG = null; renderAct(mode); refreshDocs();
    } else if (t.dataset.gdel !== undefined) {
      g.rows.splice(+t.dataset.gdel, 1); tidy(mode); keep(mode, true); renderIn(mode); renderBody(mode, true);
    }
  });

  window.BookGrid = {
    render: render,
    redraw: function (mode) { DRAWN = null; render(mode); },
    /** วางนอกตาราง: ต่อท้ายแถวที่มี */
    pasteAppend: function (mode, text) { return paste(mode, text, -1, ''); },
    /** หลังยกเลิกชุดคืน ชิ้นที่คืนแล้วเปลี่ยน ต้องหาใหม่ */
    forget: function () { LOOK = { found: {}, miss: {} }; if (S.ret) findSoon(0); },
    pending: function (mode) { return !!(KEY[mode] && state(mode).pending); },
    retry: retry,
    modes: function () { return Object.keys(KEY); },
    act: function (mode) { renderAct(mode); },
  };
})();
