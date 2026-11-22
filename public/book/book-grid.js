/**
 * book-grid.js — สมุดสต๊อก ขั้น 2–4: แท็บ รับของ, ย้าย / เติม / QA, คืนของ, แปลงสินค้า, ปรับยอด (หัวหน้า) และตารางแบบสมุดเดิม (หัวหน้า) ของหน้า public/book/
 *
 * ตารางพิมพ์แบบ Excel หนึ่งแถวต่อหนึ่งงาน วางจาก Excel ได้ (Ctrl+V ลงช่องไหนก็เติมจากช่องนั้น วางนอกตารางต่อท้าย)
 * ทุกครั้งที่พิมพ์ คิดแผนใหม่จากกองสต๊อกของหน้า (ST) แล้วขึ้นผลท้ายแถว ไม่วาดช่องพิมพ์ใหม่ เคอร์เซอร์จะได้ไม่หลุด
 * กติกาเลือกกอง / LOT / PO อยู่ใน public/wms-book.js (planGr, planMoves, planReturns, planConv, planAdj, planRows) เลข TRcloud ใส่ด้วย trApply
 * โหมดบันทึก (หลังตัดรอบ) กดบันทึกแล้วลงสมุดใหม่เลย ไม่ต้องคัดลอก · ส่งไม่สำเร็จเพราะเน็ต ชุดค้างไว้แล้วส่งซ้ำเอง (queueRetry ของหน้า)
 *
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (USER RES ST DOCS REF BKBUSY MSG LAST esc f dm bookPost copyText compute render
 * refreshDocs actTail bookMode shortList queueRetry) ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า ห้ามเรียกของพวกนั้นตอนโหลด
 * เปิดเป็น window.BookGrid
 */
(function () {
  'use strict';

  /* ช่องเลข TRcloud ท้ายตาราง ว่าง = ใช้เลขของชุด (ช่องด้านบน) */
  var TR = { k: 'tr', t: 'TRcloud', w: 112, ph: 'เลขของชุด' };
  var COLS = {
    gr: [
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku' },
      { k: 'lot', t: 'LOT', w: 46, ph: 'บนของ' },
      { k: 'po', t: 'PO', w: 100 },
      { k: 'to', t: 'โลที่วาง', w: 100, dl: 'dl-loc' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true },
      { k: 'status', t: 'เปิด?', w: 50, ph: 'auto' },
      TR,
    ],
    move: [
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku' },
      { k: 'from', t: 'จาก', w: 100, dl: 'dl-loc', ph: 'R เก่าสุด' },
      { k: 'to', t: 'ไป', w: 100, dl: 'dl-loc', ph: 'โลเปิดขาย' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true },
      { k: 'lot', t: 'LOT', w: 46, ph: 'FIFO' },
      { k: 'po', t: 'PO', w: 100, ph: 'FIFO' },
      { k: 'status', t: 'เปิด?', w: 50, ph: 'auto' },
      TR,
    ],
    ret: [
      { k: 'key', t: 'ออเดอร์ / เลขพัสดุ', w: 150 },
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku', ph: 'ทั้งออเดอร์' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true, ph: 'ที่เหลือ' },
      { k: 'to', t: 'โลที่วาง', w: 100, dl: 'dl-loc', ph: 'โลเปิดขาย' },
      { k: 'note', t: 'M/E', w: 96, ph: 'RETURN' },
      TR,
    ],
    conv: [
      { k: 'sku', t: 'SKU ที่จะได้', w: 112, dl: 'dl-sku' },
      { k: 'buy', t: 'SKU ตอนซื้อ', w: 112, dl: 'dl-sku', ph: 'MASTER' },
      { k: 'from', t: 'โล', w: 100, dl: 'dl-loc', ph: 'โลเปิดขาย' },
      { k: 'qty', t: 'ชิ้น', w: 54, num: true },
      { k: 'lot', t: 'LOT', w: 46, ph: 'FIFO' },
      { k: 'po', t: 'PO', w: 100, ph: 'FIFO' },
      { k: 'mr', t: 'MR', w: 112, ph: 'เลขของชุด' },
      { k: 'gr', t: 'GR', w: 112, ph: 'เลขของชุด' },
    ],
    adj: [
      { k: 'loc', t: 'โล', w: 100, dl: 'dl-loc' },
      { k: 'sku', t: 'SKU', w: 112, dl: 'dl-sku' },
      { k: 'lot', t: 'LOT', w: 46, ph: 'กองเดียว' },
      { k: 'po', t: 'PO', w: 100, ph: 'กองเดียว' },
      { k: 'count', t: 'นับได้', w: 60, num: true },
      { k: 'why', t: 'เหตุผล', w: 96, dl: 'dl-why' },
      TR,
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
      { k: 'tr', t: 'RUNNUMBER', w: 112, ph: 'เลขของชุด' },
    ],
  };
  /* ระบบใหม่: เลข TRcloud ของใบย้าย ใส่หลังหัวหน้าอนุมัติ จึงไม่มีช่องเลขตอนบันทึก */
  if (window.BookFire) COLS.move = COLS.move.filter(function (c) { return c !== TR; });
  var TITLE = { gr: 'รับของ', move: 'ย้าย / เติม / QA', ret: 'คืนของ', conv: 'แปลงสินค้า', adj: 'ปรับยอด', rows: 'ตารางแบบสมุดเดิม' };
  var TIP = {
    move: 'พิมพ์หรือวางจาก Excel เรียงคอลัมน์ SKU · จาก · ไป · ชิ้น · LOT · PO\n' +
      'จากว่าง = เติมจากของสำรองที่ R กองเก่าสุด (Supplier เดียวกับที่เปิดขายก่อน)\nไปว่าง = โลที่ SKU นี้เปิดขายอยู่\n' +
      'LOT / PO ว่าง = เอากองที่โลต้นทางตาม FIFO แบ่งหลายกองให้เอง\nเปิด? ว่าง = ตามโลปลายทาง (R QA RIB ทางเดิน ไม่เปิด) พิมพ์ - = ไม่เปิด\n' +
      (window.BookFire ? 'เติม / ย้ายในคลัง: ย้ายต่อจากโลที่เพิ่งย้ายเข้าในชุดเดียวกันได้\n' +
        'โอนเข้า QA · โอนออกจาก QA · ย้ายใน QA: แยกบันทึกคนละใบ ผู้รับกดรับก่อน ของจึงใช้ต่อได้ หัวหน้าอนุมัติแล้วจึงใส่เลข TRcloud'
        : 'ย้ายต่อจากโลที่เพิ่งย้ายเข้าในชุดเดียวกันได้ (QA → ORDER แล้ว ORDER → S)'),
    ret: 'วางเลขออเดอร์ / เลขอ้างอิง (ออนไลน์) / เลขพัสดุ ทีละบรรทัด ระบบหาว่าตัดจากกองไหน แล้วคืนเข้า LOT / PO เดิม\n' +
      'ไม่ใส่ SKU = คืนทั้งออเดอร์ · ไม่ใส่ชิ้น = ชิ้นที่ยังไม่คืน\nไม่เจอ (ออเดอร์ที่ตัดด้วยมือในชีตเดิม) = ใส่ SKU กับชิ้น คืนเป็น LOT 0 / PO 0 แบบเดิม\n' +
      'โลที่วางว่าง = โลที่ SKU นี้เปิดขายอยู่ · ช่อง M/E ใส่เลข M/E-xxxxx ถ้าเป็นของ M/E',
    rows: 'ลงแถวแบบชีต Transaction เดิม ใช้กับงานที่ยังไม่มีหน้า (ส่งเคลม ตัดซ่อม งานแปลก ๆ) เฉพาะหัวหน้า\n' +
      'วางจาก Excel ได้ เรียงคอลัมน์ SKU · LOT · PO · Location เบิก · Location รับ · QTY · รับ/เบิก · Note · Status\n' +
      'รับ = มีแต่ Location รับ ต้องใส่ LOT PO · เบิก = มี Location เบิก (รับมีหรือไม่ก็ได้) · ขาย = มีแต่ Location เบิก\n' +
      'แถวเบิก/ขาย LOT PO ว่าง = โลนั้นมี SKU นี้กองเดียวใช้กองนั้น · กองไม่พอบันทึกไม่ได้ · ทุกแถวต้องมี Note\n' +
      'แถวขาย Note = วันที่ขาย แบบชีตเดิม (ว่างไว้ = วันที่ของชุด)\n' +
      'Status ว่าง = ตามโลรับ (R QA RIB ทางเดิน ไม่เปิด) พิมพ์ - = ไม่เปิด\nRUNNUMBER = เลข TRcloud ของแถว ว่าง = เลขของชุด ไม่มีเลยใช้เลขที่ของระบบ',
    gr: 'กดส่งจากหน้าจัดที่เก็บ หรือคัดลอกตารางจากหน้าจัดที่เก็บ / แท็บ OUTPUT มาวาง (Ctrl+V) ระบบเรียงช่องให้เอง\n' +
      'หรือพิมพ์ / วางจาก Excel เรียงคอลัมน์ SKU · LOT · PO · โลที่วาง · ชิ้น\n' +
      'LOT = เดือนที่เห็นบนของ (1–12) ปีมาจากวันที่รับ · Note ลงเป็น GR วว-ดด-ปป ของวันที่ด้านบน\n' +
      'เปิด? ว่าง = ตามโล (R QA RIB ทางเดิน ไม่เปิด) · แถว ย้ายจาก RIB ของหน้าจัดที่เก็บไปอยู่แท็บย้ายให้เอง\n' +
      '🎯 เลือกโลให้ (ระบบใหม่) = แถวที่ยังไม่มีโลที่วาง ระบบเลือกแร็คตามข้อมูลหลัก แตกเป็นแถวละพาเลท',
    conv: 'แปลงแบบสมุดเดิม: เบิก SKU ตอนซื้อออก รับ SKU ใหม่เข้าโลเดียวกัน LOT PO เดิม Note แปลงสินค้า\n' +
      'SKU ตอนซื้อว่าง = หาจาก MASTER แปลงสินค้า ตัวที่มีของพอ · โลว่าง = โลเปิดขายตาม FIFO แบ่งหลายกองให้เอง\n' +
      'MR = เลข TRcloud ฝั่งเบิก · GR = ฝั่งรับ (ช่องด้านบนใช้ทั้งชุด ช่องในแถวใช้แทนเฉพาะแถว)\n' +
      'แท็บตัดขาย ขาดของ → กดปุ่ม แปลง ข้าง SKU ที่แปลงได้ จะมาเติมแถวที่นี่',
    adj: 'ใส่ยอดที่นับได้จริงของกอง ระบบลงแถวส่วนต่างให้ ขาด = เบิกออก เกิน = รับเข้า ตรงแล้วไม่ลง\n' +
      'LOT / PO ว่าง = โลนั้นมี SKU นี้กองเดียว · ของที่เจอใหม่ใส่ LOT PO เอง · นับได้ 0 = ของไม่มีแล้ว\n' +
      'เหตุผล: นับผิด ของเสีย หาย เจอเพิ่ม ลงผิด (พิมพ์เองได้) · เฉพาะหัวหน้ากับรองหัวหน้า\n' +
      'โหมดบันทึก: มีคนลงกองเดียวกันระหว่างนั้น ระบบไม่รับ ให้ดึงสต๊อกใหม่แล้วดูยอดอีกครั้ง',
  };
  if (window.BookFire) {
    TIP.move += '\nออกจาก IQA: ต้องใส่ LOT กับ PO (ระบบไม่เลือกกองแทน) · ไม่มียอด = แจ้ง Inbound ทำใบโอนเข้า อย่าปรับยอด · วันที่ออกต้องไม่ก่อนวันที่ของเข้า';
    TIP.rows += '\nออกจาก IQA: ต้องใส่ LOT กับ PO ทุกแถว และวันที่ต้องไม่ก่อนวันที่ของเข้า';
    TIP.adj += '\nIQA: ขาดใบโอนเข้า ให้ Inbound ทำใบโอน อย่าปรับเพิ่ม (ใบโอนตามมาแล้วยอดซ้ำ)';
  }
  if (!window.BookFire) TIP.move += '\nTRcloud = เลขของแถว ว่าง = เลขของชุด (โอน QA ไม่มีเลขขึ้นเตือนสีส้ม)';
  TIP.ret += '\nTRcloud = เลขของแถว ว่าง = เลขของชุด (คืนของ 2 เลขในชุดเดียว ใส่ในแถว) ไม่มีเลขขึ้นเตือนสีส้ม';
  var KEY = { gr: 'wms:book:draft:gr', move: 'wms:book:draft:move', ret: 'wms:book:draft:ret', conv: 'wms:book:draft:conv',
    adj: 'wms:book:draft:adj', rows: 'wms:book:draft:rows' };
  /** กุญแจร่างในเครื่อง โหมดซ้อม/ทดลองของระบบใหม่แยกกุญแจ ชุดรอส่งจะได้ไม่หลุดไปส่งเข้าระบบจริง (BookFire โหลดทีหลังไฟล์นี้ อ่านตอนใช้) */
  function keyOf(mode) { var ns = window.BookFire && window.BookFire.ns; return KEY[mode] + (ns ? ':' + ns : ''); }
  var TYPE = { gr: 'รับของ', move: 'ย้าย', ret: 'คืน', conv: 'แปลง', adj: 'ปรับยอด', rows: 'ตารางเดิม' };
  var OP = { gr: 'bk-gr', move: 'bk-move', ret: 'bk-return', conv: 'bk-conv', adj: 'bk-adj', rows: 'bk-rows' };
  var HINT = {
    gr: 'วางจากหน้าจัดที่เก็บ หรือ Excel · LOT ตามที่เห็นบนของ',
    move: 'พิมพ์หรือ Ctrl+V จาก Excel · ช่องว่างระบบเลือกให้',
    ret: 'วางเลขออเดอร์ / เลขพัสดุ ระบบหากองที่ตัดให้',
    conv: 'SKU ตอนซื้อ → SKU ใหม่ ตาม MASTER แปลงสินค้า',
    adj: 'เฉพาะหัวหน้า · ใส่ยอดที่นับได้จริง',
    rows: 'เฉพาะหัวหน้า · งานที่ยังไม่มีหน้า',
  };

  var S = {};                 // { move: {rows, date, pending, ref, tr, mr, gr}, ret: {...} } โหลดตอนใช้ครั้งแรก
  var LOOK = { found: {}, miss: {} };
  var PLAN = {};
  var QA_OPEN = false;        // กล่อง ของ QA ที่รับแล้ว เปิดอยู่ไหม
  var DRAWN = null;           // ตารางที่วาดอยู่ { mode, n, res } เปลี่ยนเมื่อไรถึงวาดใหม่ทั้งตาราง
  var LISTS = null;           // RES ที่ใช้ทำ datalist ล่าสุด
  var FINDING = false, FIND_ERR = '', findTimer = 0, outTimer = 0, saveTimer = 0;

  function rj(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function wj(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function $(id) { return document.getElementById(id); }

  function state(mode) {
    if (!S[mode]) {
      var d = rj(keyOf(mode)) || {};
      S[mode] = { rows: Array.isArray(d.rows) ? d.rows : [], date: d.date || '', pending: d.pending || null, ref: d.ref || '',
        tr: d.tr || '', mr: d.mr || '', gr: d.gr || '' };
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
    var g = S[mode];
    var go = function () { wj(keyOf(mode), { rows: g.rows, date: g.date, pending: g.pending, ref: g.ref, tr: g.tr, mr: g.mr, gr: g.gr, at: Date.now() }); };
    if (now) go(); else saveTimer = setTimeout(go, 400);
  }

  function plan(mode) {
    if (!ST) return null;
    var g = state(mode), B = WmsBook;
    var iqa = !!window.BookFire;   // กติกา IQA เฉพาะระบบใหม่
    var p = mode === 'move' ? B.planMoves(g.rows, ST, { iqa: iqa }) : mode === 'rows' ? B.planRows(g.rows, ST, { date: g.date, iqa: iqa })
      : mode === 'gr' ? B.planGr(g.rows, ST, { date: g.date }) : mode === 'conv' ? B.planConv(g.rows, ST)
      : mode === 'adj' ? B.planAdj(g.rows, ST, { iqa: iqa }) : B.planReturns(g.rows, LOOK, ST);
    p = B.trApply(p, mode, { tr: g.tr, mr: g.mr, gr: g.gr }, trAfter(mode));
    /* ระบบใหม่: เทียบข้อมูลหลัก (Location / SKU / กลุ่มสินค้า) ไม่มีตาราง = ไม่เปลี่ยนอะไร */
    var su = window.BookFire && window.WmsFireSetup && window.BookFire.setup ? window.BookFire.setup() : null;
    if (su) p = window.WmsFireSetup.check(p, mode, su.ix, mode === 'gr' ? window.BookFire.setupOcc() : null);
    if (iqa && window.BookFire.iqaCheck && mode !== 'ret') p = window.BookFire.iqaCheck(p, g.date);
    /* ใบโอน QA: ใบละแบบเดียว ตามทีมคนทำ · ตารางแบบเดิมโอน QA ไม่ได้ */
    if (iqa && window.BookFire.xferCheck && (mode === 'move' || mode === 'rows')) p = window.BookFire.xferCheck(p, mode);
    return p;
  }
  function trAfter(mode) { return mode === 'move' && !!window.BookFire; }

  /** แผน → แถวที่ส่งให้สคริปต์ */
  function copyOf(mode, pl) {
    var B = WmsBook;
    return mode === 'move' ? B.moveCopy(pl) : mode === 'rows' ? B.rowsCopy(pl) : mode === 'gr' ? B.grCopy(pl)
      : mode === 'conv' ? B.convCopy(pl) : mode === 'adj' ? B.adjCopy(pl) : B.returnCopy(pl);
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
    var opts = function (list) { return list.map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join(''); };
    box.innerHTML = '<datalist id="dl-sku">' + sk.join('') + '</datalist><datalist id="dl-loc">' + lc.join('') + '</datalist>' +
      '<datalist id="dl-type">' + opts(WmsBook.TX_TYPES) + '</datalist><datalist id="dl-why">' + opts(WmsBook.ADJ_WHY) + '</datalist>';
  }

  /* ── ผลท้ายแถว ──────────────────────────────────────────────────────── */

  function trTag(r) { return r.tr ? ' <span class="c-sub">' + esc(r.tr) + '</span>' : ''; }

  function takeText(r, mode, o) {
    var open = r.status === 'เปิด' ? ' <span class="g-open">เปิด</span>' : '';
    if (mode === 'rows') {
      return '<b>' + esc(r.type) + '</b>' + (r.type === 'ขาย' ? ' ' + esc(r.note.slice(8, 10) + '/' + r.note.slice(5, 7)) : '') + ' LOT ' + esc(r.lot) + ' · ' + esc(r.po) + ' ×' + f(r.qty) + ' ' + (r.from ? esc(r.from) : '') + (r.to ? ' → ' + esc(r.to) : '') +
        open + trTag(r);
    }
    if (mode === 'gr') return 'LOT ' + esc(r.lot) + ' · ' + esc(r.po) + ' ×' + f(r.qty) + ' → ' + esc(r.to) + open + ' <span class="c-sub">' + esc(r.note) + '</span>' + trTag(r);
    if (mode === 'conv') {
      return r.type === 'เบิก'
        ? '<b>เบิก</b> ' + (o.autoBuy ? '<b>' + esc(r.sku) + '</b>' : esc(r.sku)) + ' LOT ' + esc(r.lot) + ' · ' + esc(r.po) + ' ×' + f(r.qty) + ' ที่ ' + esc(r.from) + trTag(r)
        : '<b>รับ</b> ' + esc(r.sku) + ' → ' + esc(r.to) + open + trTag(r);
    }
    if (mode === 'adj') {
      return 'มี ' + f(o.have) + ' → นับ ' + f(o.count) + ' = <b class="' + (o.diff < 0 ? 'c-red' : 'c-ok') + '">' + (o.diff > 0 ? '+' : '') + f(o.diff) + '</b> ' +
        esc(r.type) + ' LOT ' + esc(r.lot) + ' · ' + esc(r.po) + open + trTag(r);
    }
    var lot = r.lot === '0' && r.po === '0' ? '<span class="c-warn">LOT 0 / PO 0</span>' : 'LOT ' + esc(r.lot) + ' · ' + esc(r.po);
    /* ตัวหนา = ระบบเลือกให้ */
    var where = mode === 'move'
      ? (o.autoFrom ? '<b>' + esc(r.from) + '</b>' : esc(r.from)) + ' → ' + (o.autoTo ? '<b>' + esc(r.to) + '</b>' : esc(r.to))
      : '→ ' + (o.in.to ? esc(r.to) : '<b>' + esc(r.to) + '</b>');
    var st = r.status === 'เปิด' ? ' <span class="g-open">เปิด</span>' : '';
    var doc = mode === 'ret' && r.doc ? ' <span class="c-sub">ตัด ' + esc(r.doc) + '</span>' : '';
    var sku = mode === 'ret' && !o.in.sku ? '<b>' + esc(r.sku) + '</b> ' : '';
    return sku + lot + ' ×' + f(r.qty) + (where ? ' ' + where : '') + st + doc + trTag(r);
  }

  function outHtml(mode, o) {
    if (!o || o.st === 'blank') return '';
    if (o.st === 'bad') return '<span class="c-red">' + esc(o.why) + '</span>';
    if (o.st === 'same') return '<span class="c-ok">✓ ตรงแล้ว ' + f(o.have) + ' ไม่ต้องปรับ</span>';
    if (o.st === 'wait') return '<span class="c-sub">' + (FINDING ? 'กำลังหา…' : esc(o.why)) + '</span>';
    var html = o.take.map(function (r) { return '<span class="tk">' + takeText(r, mode, o) + '</span>'; }).join('<br>');
    if (o.warn.length) html += '<br><span class="c-warn">⚠ ' + o.warn.map(esc).join(' · ') + '</span>';
    return html;
  }

  function nameOf(mode, o) {
    if (!o || o.st === 'blank' || !ST) return '';
    if (mode === 'conv' || mode === 'gr') {
      /* แปลง: ชื่อของ SKU ที่จะได้ · รับของ: SKU ใหม่ใช้ชื่อที่มากับแถว */
      var row = o.take.filter(function (t) { return t.type === 'รับ'; })[0];
      if (row && row.name) return row.name;
    }
    var many = mode !== 'conv' && o.take.some(function (t) { return t.s !== o.take[0].s; });
    if (many) return '';   // คืนทั้งออเดอร์หลาย SKU ชื่ออยู่ในช่องลงสมุดแล้ว
    var s = mode === 'move' ? o.s : o.take.length && mode !== 'conv' ? o.take[0].s : ST.code(String(o.in.sku || ''));
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
    var field = function (id, k, w, ph) {
      return '<input class="bk-field" id="' + id + '" style="width:' + w + 'px" maxlength="30" placeholder="' + esc(ph) + '" value="' + esc(g[k] || '') +
        '" autocomplete="off" spellcheck="false" aria-label="' + esc(ph) + '">';
    };
    var html = '<div class="bk-top"><span class="bk-h">' + TITLE[mode] + '</span>' +
      '<button type="button" class="g-tip" title="' + esc(TIP[mode]) + '" aria-label="วิธีใช้">ⓘ</button>' +
      '<span class="g-hint">' + esc(HINT[mode]) + '</span>';
    if (mode === 'rows') {
      html += '<input class="bk-field" id="gRef" style="width:200px" maxlength="60" placeholder="อ้างอิง เช่น เลข Transfer" value="' + esc(g.ref || '') + '">';
    }
    /* เลข TRcloud ทั้งชุด (แปลง = MR ฝั่งเบิก GR ฝั่งรับ) ช่องในแถวใช้แทนเฉพาะแถว */
    if (mode === 'conv') html += field('gMr', 'mr', 150, 'เลข MR ทั้งชุด') + field('gGr', 'gr', 150, 'เลข GR ทั้งชุด');
    else if (!trAfter(mode)) html += field('gTr', 'tr', 160, 'เลข TRcloud ทั้งชุด');
    var qa = mode === 'move' ? qaList() : null;
    if (qa) {
      html += '<button type="button" class="tx-opt' + (QA_OPEN ? ' on' : '') + '" id="gQa" aria-expanded="' + QA_OPEN + '">' +
        'ของ QA ที่รับแล้ว <b>' + f(qa.piles.length) + '</b></button>';
    }
    if (mode === 'ret') {
      html += '<button class="tx-opt' + (need ? ' p' : '') + '" id="gFind" ' + (FINDING || !need || !USER ? 'disabled' : '') + '>' +
        (FINDING ? 'กำลังหา…' : '🔍 หาออเดอร์' + (need ? ' ' + f(need) : '')) + '</button>';
    }
    if (mode === 'gr' && pickOn()) {
      html += '<button type="button" class="tx-opt" id="gPick" title="' + esc('แถวที่มี SKU + ชิ้น แต่ยังไม่มีโลที่วาง → ระบบเลือกช่องให้ แตกเป็นแถวต่อพาเลท\n' +
        'ตามข้อมูลหลักที่บันทึกแล้ว: กลุ่มสินค้า (ชั้นแร็ค · ที่เก็บเศษ) · SKU : Pallet · โซนแร็ค · Location ที่ว่าง\nแถวที่ใส่โลเองแล้วไม่เปลี่ยน · ลองก่อนได้ที่ ข้อมูลหลัก → โซนแร็ค') + '">🎯 เลือกโลให้</button>';
    }
    html += '<span class="sp"></span>' +
      (g.rows.length > 1 ? '<button class="bk-link" id="gClear">ล้างตาราง</button>' : '') +
      '<label for="gDate">วันที่ <input type="date" class="bk-date" id="gDate" value="' + esc(g.date) + '"></label></div>';
    if (qa && QA_OPEN) html += qaBox(g, qa);
    if (FIND_ERR) html += '<div class="bk-warn">หาออเดอร์ไม่สำเร็จ: ' + esc(FIND_ERR) + '</div>';
    if (mode === 'ret' && !USER) html += '<div class="bk-warn">เข้าสมุดก่อน (มุมขวาบน) ถึงจะหาออเดอร์ที่ตัดได้</div>';
    $('inp').innerHTML = html;
  }

  /* ── ของ QA ที่รับแล้ว: เลือกมาทำใบโอนออก (ระบบใหม่) ── */

  /** กองใน QA / IQA ที่ใช้ต่อได้ + ชิ้นที่ยังรอรับ · null = คนนี้ไม่ได้ทำใบออก */
  function qaList() {
    var B = WmsBook, C = window.WmsFireCore, u = window.BookFire && window.BookFire.user && window.BookFire.user();
    if (!ST || !C || !u || u.role === 'viewer' || C.makeWhy('out', u)) return null;
    var piles = [], wait = 0;
    Object.keys(ST.all || {}).forEach(function (s) {
      ST.all[s].forEach(function (p) {
        if (!B.qaWh(p.loc)) return;
        if (p.hold) wait += p.hold;
        var free = B.freeQty(p);
        if (!(free > 0)) return;
        var t = ST.skus[p.s] || [], short = String(t[0] || '');
        piles.push({ sku: short && ST.code(short) === p.s ? short : String(t[1] || short), name: t[2] || '', from: String(p.loc), lot: String(p.lot), po: String(p.po), qty: free, first: p.first || '' });
      });
    });
    piles.sort(function (a, b) { return (a.first || '9').localeCompare(b.first || '9') || a.sku.localeCompare(b.sku); });
    return { piles: piles, wait: Math.round(wait * 1000) / 1000 };
  }
  function qaKey(x) { return [x.sku, x.from, x.lot, x.po].map(function (v) { return String(v == null ? '' : v).trim().toUpperCase(); }).join('|'); }
  function qaBox(g, qa) {
    var wait = qa.wait ? '<div class="qa-wait c-warn">🔒 ยังรอรับ ' + f(qa.wait) + ' ชิ้น กดรับที่หน้าเอกสารก่อน จึงโอนออกได้</div>' : '';
    if (!qa.piles.length) return '<div class="qa-pick"><div class="tx-empty">ยังไม่มีของ QA ที่รับแล้ว</div>' + wait + '</div>';
    var used = {};
    g.rows.forEach(function (r) { if (!blank(r)) used[qaKey(r)] = 1; });
    var rows = qa.piles.map(function (x, i) {
      var on = used[qaKey(x)];
      return '<tr><td class="c-act"><button type="button" class="bk-link" data-gqa="' + i + '" data-qk="' + esc(qaKey(x)) + '"' + (on || g.pending ? ' disabled' : '') + '>' + (on ? 'ใส่แล้ว' : '+ โอนออก') + '</button></td>' +
        '<td class="c-sku">' + esc(x.sku) + '</td><td>' + esc(x.from) + '</td><td>' + esc(x.lot) + '</td><td>' + esc(x.po) + '</td>' +
        '<td class="num">' + f(x.qty) + '</td><td class="c-nm" title="' + esc(x.name) + '">' + esc(x.name) + '</td></tr>';
    }).join('');
    return '<div class="qa-pick"><div class="bk-wrap" style="max-height:220px"><table class="bk-xl"><thead><tr><th></th><th>SKU</th><th>โล</th><th>LOT</th><th>PO</th>' +
      '<th class="num">ใช้ได้</th><th>ชื่อสินค้า</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + wait + '</div>';
  }
  /** กด + โอนออก: เติมแถว (ไปโลไหน ใส่เองหรือว่างให้ระบบเลือก) · จำด้วยกุญแจกอง ยอดอาจเปลี่ยนระหว่างที่กล่องเปิดอยู่ */
  function qaAdd(key) {
    var g = state('move'), qa = qaList();
    if (!qa || g.pending || g.rows.some(function (r) { return !blank(r) && qaKey(r) === key; })) return;
    var x = qa.piles.filter(function (p) { return qaKey(p) === key; })[0];
    if (x) {
      append('move', [{ sku: x.sku, from: x.from, qty: String(x.qty), lot: x.lot, po: x.po }]);
      LAST = null;
    }
    renderIn('move');
    renderBody('move', true);
    if (!x) return;
    var el = document.querySelector('#gTable input[data-r="' + (g.rows.length - 2) + '"][data-c="to"]');
    if (el) el.focus();
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
    if (mode === 'adj') html += chip('c-ok', 'ตรงแล้ว', t.same, 'กอง');
    if (t.noTr) html += chip('c-warn', 'ไม่มีเลข TRcloud', t.noTr, 'บรรทัด');
    $('sum').innerHTML = html;
  }

  function canSave(mode) {
    var p = PLAN[mode];
    return !!(!docsLocked() && USER && DOCS_OK && p && p.total.rows && !p.total.bad && !p.total.wait && !BKBUSY);
  }

  function renderAct(mode) {
    var g = state(mode), p = PLAN[mode], locked = docsLocked(), html = lockNote();
    if (g.pending) {
      html += '<button class="bk-save" id="gSave" ' + (!USER || BKBUSY || locked ? 'disabled' : '') + '>' + (BKBUSY ? esc(BKBUSY) : '↻ ส่งอีกครั้ง') + '</button>' +
        '<span>ชุดที่ส่งค้าง <b>' + f(g.pending.copy.length) + '</b> แถว ' +
        (isHeld(g.pending) ? heldNote() : 'ยังไม่รู้ว่าถึงสมุดไหม ระบบส่งซ้ำเองทุก 30 วินาที (กดเองก็ได้) ไม่บันทึกซ้ำ') + '</span>' +
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
    /* รหัสยาวกับชื่อที่มากับแถวจากหน้าจัดที่เก็บ ใช้ไม่ได้แล้วเมื่อแก้ SKU */
    if (el.dataset.c === 'sku') { delete g.rows[i].long; delete g.rows[i].name; }
    LAST = null;
    var grew = false;
    if (i === g.rows.length - 1 && el.value.trim()) { g.rows.push({}); grew = true; }
    keep(mode);
    if (grew) renderBody(mode, true);
    else soon(mode);
    if (mode === 'ret' && el.dataset.c === 'key') findSoon();
  }

  /** เติมแถวต่อท้ายตาราง (ปุ่มแปลงในแท็บตัดขาย ปุ่มส่งของหน้าจัดที่เก็บ) */
  function append(mode, list) {
    var g = state(mode);
    var r = g.rows.length;
    while (r > 0 && blank(g.rows[r - 1])) r--;
    g.rows.length = r;
    (list || []).forEach(function (x) { g.rows.push(x); });
    tidy(mode);
    keep(mode, true);
  }

  /** วางตารางจาก Excel ลงที่แถว r คอลัมน์ c (r = -1 ต่อท้าย) */
  function paste(mode, text, r, c) {
    text = String(text || '').replace(/\r/g, '');
    /* รับของ: ตารางจากหน้าจัดที่เก็บ (มี REMARK Location OPEN …) เรียงช่องให้เอง แถวย้ายจาก RIB ไปแท็บย้าย */
    var out = mode === 'gr' ? WmsBook.grFromOutput(text) : null;
    if (out) {
      append('gr', out.rows);
      if (out.moves.length) append('move', out.moves);
      LAST = null;
      MSG = { kind: 'ok', html: 'วางจากหน้าจัดที่เก็บ ' + f(out.rows.length) + ' แถว' +
        (out.moves.length ? ' · แถว ย้ายจาก RIB ' + f(out.moves.length) + ' แถวไปอยู่แท็บ ย้าย / เติม / QA' : '') + ' · ใส่ LOT ที่เห็นบนของให้ครบ' };
      renderIn(mode);
      renderBody(mode, true);
      return true;
    }
    var grid = text.replace(/\n+$/, '').split('\n').map(function (l) { return l.split('\t'); });
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

  /* ── 🎯 เลือกโลให้ (ระบบใหม่ · แท็บรับของ) ─────────────────────────── */

  function pickOn() { return typeof FIRE !== 'undefined' && !!FIRE && !!FIRE.setupPicker && !!window.WmsFireSetup; }

  /** แถวที่ยังไม่มีโลที่วาง → ระบบเลือกแร็คตามข้อมูลหลัก (กลุ่ม · SKU : Pallet · โซนแร็ค) แตกแถวต่อพาเลท · แถวที่มีโลแล้วไม่เปลี่ยน */
  function pickLocs() {
    var g = state('gr');
    /* ชุดค้างส่ง = แถวล็อกแล้ว · สต๊อกยังไม่มา = ไม่รู้ว่าช่องไหนว่าง ห้ามเดา */
    var stop = g.pending ? 'มีชุดที่ส่งค้าง รอให้ส่งเสร็จก่อน' : !ST ? 'รอสต๊อกก่อน ยังไม่รู้ว่าช่องไหนว่าง' : '';
    if (stop) { MSG = { kind: 'warn', html: stop }; renderAct('gr'); return; }
    var X = window.WmsFireSetup, P = pickOn() ? FIRE.setupPicker() : null;
    if (!P) return;
    var body = g.rows.filter(function (r) { return !blank(r); });
    var need = body.filter(function (r) { return !String(r.to || '').trim() && String(r.sku || '').trim() && +String(r.qty || '').replace(/,/g, '') > 0; }).length;
    if (!need) { MSG = { kind: 'warn', html: 'ไม่มีแถวที่มี SKU + ชิ้น แต่ยังไม่มีโลที่วาง' }; renderAct('gr'); return; }
    var res = X.pickRows(P, body);
    g.rows = res.rows;
    tidy('gr');
    keep('gr', true);
    LAST = null;
    var bad = res.err.slice(0, 3).map(function (e) { return esc((e.sku ? e.sku + ': ' : '') + e.t); }).join(' · ');
    MSG = { kind: res.err.length || res.man ? 'warn' : 'ok',
      html: '🎯 เลือกโลให้ ' + f(res.done) + ' แถว → ' + f(res.lines) + ' แถว (แถวละพาเลท)' +
        (res.man ? ' · หาที่ไม่ได้ ' + f(res.man) + ' แถว (โลยังว่าง ใส่เอง)' : '') +
        (res.err.length ? ' · ไม่ได้เลือก ' + f(res.err.length) + ' แถว: ' + bad + (res.err.length > 3 ? ' …' : '') : '') + ' · ตรวจก่อนบันทึก' };
    renderIn('gr');
    renderBody('gr', true);
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
    if (!USER || BKBUSY || docsLocked()) return;
    var g = state(mode), p = g.pending, resend = !!p;
    if (p && p.held) { delete p.held; keep(mode, true); }   // คนกดส่งเอง
    if (!p) {
      if (!canSave(mode)) return;
      var pl = PLAN[mode];
      p = { batch: WmsBook.uuid(), date: g.date, base: WmsBook.lastRow(RES), copy: copyOf(mode, pl) };
      if (mode === 'ret') p.lines = pl.save;
      if (mode === 'adj') p.lines = pl.check;
      if (mode === 'rows') p.ref = g.ref || '';
      p.names = WmsBook.namesOf(ST, p.copy, pl.rows);
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
    if (r.noOpen && resend) { holdPending(); show(mode); return; }
    if (r.error) {
      g.pending = null;
      keep(mode, true);
      var list = (r.bad || []).slice(0, 8).map(function (b) { return '<li>แถว ' + b.n + (b.sku ? ' ' + esc(b.sku) : '') + (b.order ? ' ' + esc(b.order) : '') + ': ' + esc(b.why) + '</li>'; });
      if (r.over) {
        list = r.over.slice(0, 8).map(function (o) { return '<li>' + esc(o.key.split('|')[1]) + ' ' + esc(o.key.split('|')[2]) + ': ตัด ' + f(o.cut) + ' คืนแล้ว ' + f(o.back) + ' คืนเพิ่ม ' + f(o.qty) + '</li>'; });
        LOOK = { found: {}, miss: {} };
        findSoon(0);
      }
      if (r.moved) {
        list = r.moved.slice(0, 8).map(function (m) { return '<li>' + esc(m.loc) + ' ' + esc(m.sku) + ' LOT ' + esc(m.lot) + ' ' + esc(m.po) + ': ตอนคิด ' + f(m.have) + ' ตอนนี้ ' + f(m.now) + '</li>'; });
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
    g.ref = ''; g.tr = ''; g.mr = ''; g.gr = '';
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
      var p = state(modes[i]).pending;
      if (p && !isHeld(p) && !BKBUSY && USER) await save(modes[i]);
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
    var fk = { gTr: 'tr', gMr: 'mr', gGr: 'gr' }[e.target.id];
    if (fk) { state(mode)[fk] = e.target.value.trim().toUpperCase(); e.target.value = state(mode)[fk]; keep(mode, true); updateOut(mode); return; }
    if (e.target.id === 'gDate' && e.target.value) {
      state(mode).date = e.target.value;
      keep(mode, true);
      if (mode === 'ret') { LOOK = { found: {}, miss: {} }; findSoon(0); }
      updateOut(mode);   // แผนขึ้นกับวันที่ (วันออกจาก IQA · Note วันรับ)
    }
  });

  document.addEventListener('click', function (e) {
    var mode = grid();
    var t = e.target.closest && e.target.closest('button');
    if (!mode || !t) return;
    var g = state(mode);
    if (t.id === 'gSave') save(mode);
    else if (t.id === 'gFind') find();
    else if (t.id === 'gPick') pickLocs();
    else if (t.id === 'gQa') { QA_OPEN = !QA_OPEN; renderIn(mode); }
    else if (t.dataset.qk !== undefined) qaAdd(t.dataset.qk);
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
    /** แถวในร่างที่ยังไม่บันทึก (ไม่นับแถวว่าง) หน้าวันนี้ใช้เตือนร่างค้าง */
    filled: function (mode) { return KEY[mode] ? state(mode).rows.filter(function (r) { return !blank(r); }).length : 0; },
    retry: retry,
    held: function (mode) { return !!(KEY[mode] && isHeld(state(mode).pending)); },
    /** พักทุกชุดที่ค้าง (ยังไม่มียอดยกมา) เก็บลงเครื่องทันที */
    hold: function () {
      Object.keys(KEY).forEach(function (mode) {
        var p = state(mode).pending;
        if (p && !p.held) { p.held = 1; keep(mode, true); }
      });
    },
    modes: function () { return Object.keys(KEY); },
    act: function (mode) { renderAct(mode); },
    /** เติมแถวต่อท้ายตารางของแท็บ (ปุ่ม แปลง ในแท็บตัดขาย) */
    append: function (mode, list) { if (KEY[mode]) { append(mode, list); DRAWN = null; } },
    /** แท็บอื่นในเครื่องเดียวกัน (หน้าจัดที่เก็บ) เขียนร่างไว้ อ่านใหม่จากเครื่อง */
    reload: function (mode) { if (KEY[mode]) { delete S[mode]; DRAWN = null; } },
  };
})();
