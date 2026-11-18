/**
 * book-set.js — สมุดสต๊อก ขั้น 3: แท็บ ⚙️ สมุดใหม่ (หัวหน้า) ของหน้า public/book/
 *
 * เช็คความพร้อมก่อนตัดรอบ ลงยอดยกมา เทียบยอด สลับโหมด คัดลอก ↔ บันทึก คิดยอดคงเหลือใหม่ สำรองตอนนี้
 *   ยอดยกมา = ยอดคงเหลือทุกกองของชีตเดิม (tx-fifo ที่ดึงมาล่าสุด) กติกาอยู่ใน public/wms-book.js (openingRows, compareStock, readsBook)
 *   สคริปต์ book-api.gs เขียนลงไฟล์ WMS สมุดสต๊อก เท่านั้น ชีตเดิมไม่ถูกแตะ
 *
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (USER RES ST REF BSTATE BKBUSY esc f table bookPost refreshState compute render)
 * ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า เปิดเป็น window.BookSet
 */
(function () {
  'use strict';

  var PLAN = null;   // ยอดยกมาที่คิดไว้ ยังไม่ส่ง { rows, neg, asOf, total, batch, res }
  var CMP = null;    // ผลเทียบยอดล่าสุด { same, diff, piles, oldQty, bookQty, res, rows }
  var NOTE = null;   // { kind: ok|bad|warn, html }
  var SHOW = '';     // ตารางที่เปิดดู: neg | rows | diff
  var STALE_MIN = 15;

  var STEPS = 'วันตัดรอบ ทำตามลำดับ\n' +
    '1 บอกทีมหยุดลงชีต Transaction เดิม ชุดที่บันทึกจากหน้านี้ต้องวางในชีตเดิมให้ครบ\n' +
    '2 กด ดึงสต๊อกใหม่ (มุมซ้ายบน) ให้ได้ยอดล่าสุดของชีตเดิม\n' +
    '3 คิดยอดยกมา ดูกองติดลบ แล้วกด ลงยอดยกมา\n' +
    '4 เทียบยอด ต้องตรงทุกกอง\n' +
    '5 กด สลับเป็นโหมดบันทึก\n' +
    '6 ในไฟล์ที่ tx-api.gs อ่าน แก้ลิงก์ใน IMPORTRANGE ให้ชี้ไปไฟล์ WMS สมุดสต๊อก แท็บ Transaction (คอลัมน์ตรงกับชีตเดิม)\n' +
    '7 ดึงสต๊อกใหม่อีกครั้ง ข้อ tx-api อ่านสมุดใหม่ ต้องขึ้น ✓\n' +
    '8 ตั้งชีตเดิมเป็นดูอย่างเดียว · แชร์ไฟล์ WMS สมุดสต๊อก ให้ทีมแบบดูอย่างเดียว (ลงรายการผ่านหน้าเว็บเท่านั้น)';

  function $(id) { return document.getElementById(id); }
  function S() { return BSTATE || {}; }
  function book() { return S().mode === 'book'; }
  function oldLast() { return RES ? WmsBook.lastRow(RES) : 0; }
  function ago(res) { return res ? Math.round((Date.now() - WmsShared.stamp(res)) / 60000) : 0; }
  function waitCopy() { return (REF.wait || []).filter(function (d) { return !d.book; }); }

  /** สต๊อกที่ใช้เทียบ: โหมดคัดลอก = ชีตเดิมล้วน · โหมดบันทึก = tx-api (อ่านสมุดใหม่) + ชุดที่ยังไม่เห็น */
  function stockNow() { return book() ? ST : WmsBook.stock(RES); }

  function checks() {
    var s = S(), op = s.open, list = [];
    var tx = !!(RES && RES.ob);
    list.push({ t: 'tx-api.gs รุ่นที่รู้จักยอดยกมา', ok: tx, gate: 1,
      v: !RES ? 'รอสต๊อก' : tx ? 'พร้อม' : 'ยังเป็นรุ่นเก่า ให้วาง tx-api.gs ใหม่แล้ว Deploy เป็น New version' });
    list.push({ t: 'ยอดยกมา', ok: !!op, gate: 1,
      v: op ? esc(op.doc) + ' · ' + f(op.rows) + ' กอง · ' + f(op.qty) + ' ชิ้น · ' + esc(String(op.at).slice(5, 16)) + ' · ' + esc(op.who) : 'ยังไม่ลง',
      btn: book() ? '' : '<button class="bk-btn" id="sPlan" ' + (RES && !BKBUSY ? '' : 'disabled') + '>' + (op ? 'คิดใหม่' : 'คิดยอดยกมา') + '</button>' });
    if (!book()) {
      var more = op && RES ? oldLast() - (op.asOf || 0) : 0;
      list.push({ t: 'ชีตเดิมไม่มีแถวเพิ่มหลังลงยอดยกมา', ok: !!(op && RES && more <= 0), gate: 1,
        v: !op ? '—' : !RES ? 'รอสต๊อก' : more > 0 ? 'เพิ่ม ' + f(more) + ' แถว (ตอนนี้ถึงแถว ' + f(oldLast()) + ') ต้องลงยอดยกมาใหม่' : 'คิดถึงแถว ' + f(op.asOf) });
      list.push({ t: 'ไม่มีชุดที่บันทึกหลังลงยอดยกมา', ok: !!(op && !s.after), gate: 1,
        v: !op ? '—' : s.after ? f(s.after) + ' ชุด (' + esc((s.afterDocs || []).join(', ')) + ') ต้องลงยอดยกมาใหม่' : 'ไม่มี' });
    }
    var fresh = CMP && CMP.res === RES && CMP.rows === s.rows;
    list.push({ t: book() ? 'ยอดใน tx-api ตรงกับยอดคงเหลือสมุดใหม่' : 'ยอดชีตเดิมตรงกับยอดคงเหลือสมุดใหม่', ok: !!(fresh && CMP.same), gate: 1,
      v: !CMP ? 'ยังไม่ได้เทียบ' : !fresh ? 'สต๊อกหรือสมุดเปลี่ยนแล้ว เทียบใหม่' : CMP.same ? 'ตรงทุกกอง (' + f(CMP.piles) + ' กอง · ' + f(CMP.bookQty) + ' ชิ้น)'
        : 'ต่าง ' + f(CMP.diff.length) + ' กอง · ชีตเดิม ' + f(CMP.oldQty) + ' / สมุดใหม่ ' + f(CMP.bookQty) + ' ชิ้น',
      btn: '<button class="bk-btn" id="sCmp" ' + (RES && op && !BKBUSY ? '' : 'disabled') + '>เทียบยอด</button>' +
        (CMP && CMP.diff.length ? ' <button class="bk-link" data-show="diff">ดูที่ต่าง</button>' : '') });
    if (book()) {
      var reads = WmsBook.readsBook(RES, s.first);
      list.push({ t: 'tx-api อ่านไฟล์สมุดใหม่แล้ว', ok: reads, v: !RES ? 'รอสต๊อก' : reads ? 'แถว 2 ตรงกับสมุดใหม่' : 'ยังอ่านชีตเดิม แก้ลิงก์ IMPORTRANGE (ข้อ 6 ใน ⓘ) แล้วดึงสต๊อกใหม่' });
    }
    var bk = s.backup || {};
    list.push({ t: 'Backup ทุกคืน', ok: !!bk.at, v: bk.at ? 'ล่าสุด ' + esc(String(bk.at).slice(5, 16)) + ' · ถึงแถว ' + f(bk.row) : 'ยังไม่เคย ในหน้าแก้สคริปต์เลือก installBackup แล้วกด Run ครั้งเดียว',
      btn: '<button class="bk-btn" id="sBak" ' + (BKBUSY ? 'disabled' : '') + '>สำรองตอนนี้</button>' });
    return list;
  }

  function ready() { return checks().every(function (c) { return !c.gate || c.ok; }); }

  /* ── วาด ───────────────────────────────────────────────────────────── */

  function renderIn() {
    var s = S();
    var mode = book() ? '<span class="pill ok">📗 โหมดบันทึก</span> ลงสมุดใหม่เลย' : '<span class="pill">📋 โหมดคัดลอก</span> ชีตเดิมยังเป็นตัวจริง';
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">สมุดใหม่</span>' +
      '<button type="button" class="g-tip" title="' + esc(STEPS) + '" aria-label="ขั้นตอนวันตัดรอบ">ⓘ</button>' +
      '<span class="g-hint s-mode">' + mode + (s.modeAt ? ' · ตั้งแต่ ' + esc(String(s.modeAt).slice(5, 16)) + ' โดย ' + esc(s.modeBy) : '') +
      (s.rows !== undefined ? ' · Transaction ' + f(s.rows) + ' แถว · ยอดคงเหลือ ' + f(s.piles) + ' กอง' : '') + '</span>' +
      '<span class="sp"></span><button class="tx-opt" id="sRefresh" ' + (BKBUSY ? 'disabled' : '') + '>🔄 เช็คใหม่</button></div>';
  }

  function renderSum() {
    if (!PLAN) { $('sum').innerHTML = ''; return; }
    var t = PLAN.total;
    var chip = function (k, cls, label, n, sub) {
      return '<button class="bk-chip ' + cls + (SHOW === k ? ' on' : '') + (n ? '' : ' zero') + '" data-show="' + k + '">' + label + ' <b>' + f(n) + '</b>' + (sub ? ' ' + sub : '') + '</button>';
    };
    $('sum').innerHTML = '<span>ยอดยกมาที่คิดไว้ (ชีตเดิมถึงแถว ' + f(PLAN.asOf) + ')</span>' +
      chip('rows', 'c-ok', 'กอง', t.piles, '· ' + f(t.qty) + ' ชิ้น') +
      '<span class="bk-chip zero">เปิด <b>' + f(t.open) + '</b></span>' +
      '<span class="bk-chip' + (t.noGr ? '' : ' zero') + '" title="ไม่เจอวันรับ (GR) ในชีตเดิม ลงไตรมาสของรอบนับแทน">ไม่รู้วันรับ <b>' + f(t.noGr) + '</b></span>' +
      '<span class="bk-chip' + (t.blank ? ' c-warn' : ' zero') + '" title="LOT หรือ PO ว่างในชีตเดิม ลงเป็น 0">LOT/PO ว่าง → 0 <b>' + f(t.blank) + '</b></span>' +
      chip('neg', 'c-red', 'ติดลบไม่ลง', t.neg, t.neg ? '· ' + f(t.negQty) + ' ชิ้น' : '');
  }

  function renderAct() {
    var html = '', s = S();
    if (PLAN) {
      html += '<button class="bk-save" id="sOpen" ' + (BKBUSY ? 'disabled' : '') + '>' + (BKBUSY ? esc(BKBUSY)
        : (s.open ? '⟳ ลงยอดยกมาใหม่ ' : '📥 ลงยอดยกมา ') + f(PLAN.total.piles) + ' กอง') + '</button>' +
        '<button class="bk-link" id="sPlanX">ไม่ลง</button>';
      if (s.open) html += '<span class="c-warn">ลงใหม่ = ล้างแท็บ Transaction กับยอดคงเหลือในสมุดใหม่ก่อน</span>';
    } else if (!book()) {
      var ok = ready();
      html += '<button class="bk-save" id="sBook" ' + (ok && !BKBUSY ? '' : 'disabled') + '>' + (BKBUSY ? esc(BKBUSY) : '📗 สลับเป็นโหมดบันทึก') + '</button>' +
        '<span>' + (ok ? 'พร้อมแล้ว · หลังสลับ ทุกชุดลงสมุดใหม่ ไม่ต้องคัดลอก' : 'ต้องผ่านทุกข้อที่มีดาว ★ ก่อน') + '</span>';
    } else {
      html += '<span>📗 โหมดบันทึกอยู่</span><button class="bk-link" id="sCopy" ' + (BKBUSY ? 'disabled' : '') + '>ถอยกลับโหมดคัดลอก</button>';
    }
    html += '<span class="sp"></span><button class="bk-link" id="sRebuild" ' + (BKBUSY ? 'disabled' : '') + ' title="ใช้เมื่อมีคนแก้แท็บ Transaction ในไฟล์ด้วยมือ">คิดยอดคงเหลือใหม่จาก Transaction</button>';
    if (NOTE) html += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = html;
  }

  function renderBody() {
    var rows = checks().map(function (c, i) {
      return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + (c.gate ? '★ ' : '') + esc(c.t) + '</td>' +
        '<td class="' + (c.ok ? 'c-ok' : c.gate ? 'c-red' : 'c-warn') + '">' + (c.ok ? '✓' : '✗') + '</td>' +
        '<td class="s-v">' + c.v + '</td><td class="c-act">' + (c.btn || '') + '</td></tr>';
    });
    var html = table([['#', 'num'], ['เช็ค'], [''], ['ผล'], ['', 'c-act']], rows);
    if (PLAN && SHOW === 'neg' && PLAN.neg.length) {
      html += '<div class="bk-dh s-gap"><b>กองติดลบในชีตเดิม</b> ไม่ลงในยอดยกมา (ถือเป็น 0) ถ้าของมีจริงให้แก้ในชีตเดิมก่อน แล้วคิดใหม่</div>' +
        table([['#', 'num'], ['โล'], ['SKU'], ['LOT'], ['PO'], ['ยอด', 'num']], PLAN.neg.map(function (p, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(p.loc) + '</td><td class="c-sku">' + esc(p.sku) + '</td><td>' + esc(p.lot) + '</td>' +
            '<td class="c-sub">' + esc(p.po) + '</td><td class="num c-red">' + f(p.qty) + '</td></tr>';
        }));
    } else if (PLAN && SHOW === 'rows') {
      html += '<div class="bk-dh s-gap"><b>แถวยอดยกมา</b> กองละแถว ลงเป็นแถวรับ Note "ยอดยกมา เลขที่ · GR วันรับ"</div>' +
        table([['#', 'num'], ['โล'], ['SKU'], ['ชื่อสินค้า'], ['LOT'], ['PO'], ['ชิ้น', 'num'], ['Status'], ['วันรับ']], PLAN.rows.map(function (r, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(r[5]) + '</td><td class="c-sku">' + esc(r[0]) + '</td>' +
            '<td class="c-nm" title="' + esc(r[2]) + '">' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td class="c-sub">' + esc(r[4]) + '</td>' +
            '<td class="num">' + f(r[6]) + '</td><td>' + (r[7] ? '<span class="g-open">เปิด</span>' : '') + '</td><td class="c-sub">' + esc(r[8] || r[9]) + '</td></tr>';
        }));
    }
    if (SHOW === 'diff' && CMP && CMP.diff.length) {
      html += '<div class="bk-dh s-gap"><b>กองที่ยอดไม่ตรง</b> ' + (book() ? 'tx-api' : 'ชีตเดิม') + ' เทียบกับแท็บยอดคงเหลือในสมุดใหม่</div>' +
        table([['#', 'num'], ['โล'], ['SKU'], ['LOT'], ['PO'], [book() ? 'tx-api' : 'ชีตเดิม', 'num'], ['สมุดใหม่', 'num'], ['ต่าง', 'num']], CMP.diff.map(function (d, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(d.loc) + '</td><td class="c-sku">' + esc(d.sku) + '</td><td>' + esc(d.lot) + '</td>' +
            '<td class="c-sub">' + esc(d.po) + '</td><td class="num">' + f(d.old) + '</td><td class="num">' + f(d.book) + '</td>' +
            '<td class="num c-red">' + f(Math.round((d.book - d.old) * 1000) / 1000) + '</td></tr>';
        }));
    }
    $('body').innerHTML = html;
  }

  function render() {
    renderIn();
    renderSum();
    renderAct();
    renderBody();
  }
  function renderAll() { if (window.render) window.render(); }

  /* ── ทำ ───────────────────────────────────────────────────────────── */

  function plan() {
    NOTE = null;
    if (!RES) return;
    var wait = waitCopy();
    if (!book() && wait.length) {
      NOTE = { kind: 'bad', html: 'ยังมีชุดที่บันทึกแล้วแต่ไม่เห็นในชีตเดิม: <b>' + esc(wait.map(function (d) { return d.doc; }).join(', ')) +
        '</b> วางในชีตเดิมให้ครบ แล้วดึงสต๊อกใหม่ก่อนคิดยอดยกมา' };
      renderAll();
      return;
    }
    if (ago(RES) > STALE_MIN && !confirm('สต๊อกที่ดึงมาเมื่อ ' + ago(RES) + ' นาทีก่อน\nยอดยกมาควรคิดจากสต๊อกล่าสุด (กด ดึงสต๊อกใหม่ ก่อน)\n\nคิดจากชุดนี้เลยไหม?')) return;
    var p = WmsBook.openingRows(RES, WmsBook.stock(RES));
    p.batch = WmsBook.uuid();
    p.res = RES;
    PLAN = p;
    SHOW = p.neg.length ? 'neg' : 'rows';
    renderAll();
  }

  async function open() {
    if (!PLAN || BKBUSY) return;
    var s = S();
    if (PLAN.res !== RES && !confirm('สต๊อกเปลี่ยนหลังคิดยอดยกมา คิดใหม่ก่อนดีกว่า\nลงชุดที่คิดไว้เลยไหม?')) return;
    var msg = (s.open ? 'ลงยอดยกมาใหม่ แทน ' + s.open.doc + '\nแท็บ Transaction กับยอดคงเหลือในสมุดใหม่จะถูกล้างก่อน\n\n' : '') +
      'ลงยอดยกมา ' + f(PLAN.total.piles) + ' กอง ' + f(PLAN.total.qty) + ' ชิ้น (ชีตเดิมถึงแถว ' + f(PLAN.asOf) + ')?';
    if (!confirm(msg)) return;
    BKBUSY = 'กำลังลงยอดยกมา…'; NOTE = null; renderAll();
    var r;
    try {
      r = await bookPost('bk-open', { batch: PLAN.batch, asOf: PLAN.asOf, replace: !!s.open, rows: PLAN.rows });
    } catch (e) {
      BKBUSY = '';
      NOTE = { kind: 'warn', html: 'ส่งไม่สำเร็จ (' + esc(e.message) + ') กดลงอีกครั้งได้ ระบบไม่ลงซ้ำ' };
      renderAll();
      return;
    }
    BKBUSY = '';
    if (r.error) {
      var bad = (r.bad || []).slice(0, 8).map(function (b) { return '<li>กอง ' + b.n + ' ' + esc(b.sku) + ' ' + esc(b.loc) + ': ' + esc(b.why) + '</li>'; });
      NOTE = { kind: 'bad', html: 'ลงยอดยกมาไม่สำเร็จ: ' + esc(r.error) + (bad.length ? '<ol>' + bad.join('') + '</ol>' : '') };
      renderAll();
      return;
    }
    NOTE = { kind: 'ok', html: '✅ ลงยอดยกมา <b>' + esc(r.doc) + '</b> แล้ว ' + f(r.rows) + ' กอง ' + f(r.qty) + ' ชิ้น' +
      (r.replaced && r.replaced.length ? ' (แทน ' + esc(r.replaced.join(', ')) + ')' : '') + ' · กำลังเทียบยอด…' };
    PLAN = null;
    SHOW = '';
    await refreshState();
    await cmp();
  }

  async function cmp() {
    if (!RES || BKBUSY) return;
    BKBUSY = 'กำลังเทียบยอด…'; renderAll();
    try {
      var r = await bookPost('bk-stock', {});
      if (r.error) throw new Error(r.error);
      var c = WmsBook.compareStock(stockNow(), r.piles);
      c.res = RES;
      c.rows = r.rows;
      CMP = c;
      var head = NOTE && NOTE.kind === 'ok' ? NOTE.html.replace(' · กำลังเทียบยอด…', '') + '<br>' : '';
      NOTE = c.same ? { kind: 'ok', html: head + '✓ ยอดตรงทุกกอง ' + f(c.piles) + ' กอง ' + f(c.bookQty) + ' ชิ้น' }
        : { kind: 'bad', html: head + 'ยอดไม่ตรง ' + f(c.diff.length) + ' กอง ดูตารางด้านล่าง' };
      SHOW = c.same ? SHOW : 'diff';
      if (BSTATE) BSTATE.rows = r.rows;
    } catch (e) {
      NOTE = { kind: 'bad', html: 'เทียบยอดไม่สำเร็จ: ' + esc(e.message) };
    }
    BKBUSY = '';
    renderAll();
  }

  async function setMode(want) {
    if (BKBUSY) return;
    var why = '';
    if (want === 'book') {
      var w = prompt('สลับเป็นโหมดบันทึก\nหลังจากนี้ทุกชุดลงสมุดใหม่ ชีตเดิมห้ามลงอีก\nอย่าลืมแก้ลิงก์ IMPORTRANGE ของ tx-api ทันทีหลังสลับ\n\nพิมพ์คำว่า บันทึก เพื่อยืนยัน');
      if (!w || w.trim() !== 'บันทึก') return;
    } else {
      why = prompt('ถอยกลับโหมดคัดลอก (ชีตเดิมกลับมาเป็นตัวจริง)\nชุดที่ลงสมุดใหม่ไปแล้ว ต้องคัดลอกไปวางต่อในชีตเดิมเอง\n\nเหตุผล:');
      if (!why || !why.trim()) return;
    }
    BKBUSY = 'กำลังสลับโหมด…'; NOTE = null; renderAll();
    try {
      var r = await bookPost('bk-mode', { mode: want, why: (why || '').trim() });
      if (r.error) throw new Error(r.error);
      NOTE = want === 'book'
        ? { kind: 'ok', html: '✅ โหมดบันทึกแล้ว · ต่อไป: แก้ลิงก์ IMPORTRANGE ในไฟล์ที่ tx-api.gs อ่าน ให้ชี้ไปไฟล์ WMS สมุดสต๊อก แท็บ Transaction แล้วดึงสต๊อกใหม่' }
        : { kind: 'warn', html: 'กลับเป็นโหมดคัดลอกแล้ว · ชุดที่ลงสมุดใหม่ไปแล้วกดคัดลอกจากตารางชุดที่บันทึกด้านล่าง ไปวางต่อในชีตเดิม' };
    } catch (e) {
      NOTE = { kind: 'bad', html: 'สลับโหมดไม่สำเร็จ: ' + esc(e.message) };
    }
    BKBUSY = '';
    await refreshState();
    compute();
    renderAll();
  }

  async function simple(op, busy, ok) {
    if (BKBUSY) return;
    BKBUSY = busy; NOTE = null; renderAll();
    try {
      var r = await bookPost(op, {});
      if (r.error) throw new Error(r.error);
      NOTE = { kind: r.neg ? 'warn' : 'ok', html: ok(r) };
    } catch (e) {
      NOTE = { kind: 'bad', html: esc(e.message) };
    }
    BKBUSY = '';
    await refreshState();
    renderAll();
  }

  document.addEventListener('click', function (e) {
    if (typeof MODE === 'undefined' || MODE !== 'set') return;
    var t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.id === 'sRefresh') { NOTE = null; refreshState().then(renderAll); }
    else if (t.id === 'sPlan') plan();
    else if (t.id === 'sPlanX') { PLAN = null; SHOW = ''; renderAll(); }
    else if (t.id === 'sOpen') open();
    else if (t.id === 'sCmp') { NOTE = null; cmp(); }
    else if (t.id === 'sBook') setMode('book');
    else if (t.id === 'sCopy') setMode('copy');
    else if (t.dataset.show) { SHOW = SHOW === t.dataset.show ? '' : t.dataset.show; renderSum(); renderBody(); }
    else if (t.id === 'sRebuild') {
      if (!confirm('คิดแท็บยอดคงเหลือใหม่จากแท็บ Transaction ทั้งแท็บ?')) return;
      simple('bk-rebuild', 'กำลังคิดยอดคงเหลือใหม่…', function (r) {
        return 'คิดใหม่แล้ว ' + f(r.rows) + ' แถว → ' + f(r.piles) + ' กอง' + (r.neg ? ' · <b>ติดลบ ' + f(r.neg) + ' กอง</b> (มีคนแก้แท็บ Transaction ด้วยมือ)' : '');
      });
    } else if (t.id === 'sBak') {
      simple('bk-backup', 'กำลังสำรอง…', function (r) {
        return 'สำรองแล้ว ' + f(r.rows) + ' แถว (ถึงแถว ' + f(r.upTo) + ')' + (r.more ? ' · เหลืออีก ' + f(r.more) + ' แถว กดอีกครั้ง' : '');
      });
    }
  });

  window.BookSet = {
    render: render,
    /** สต๊อกเปลี่ยน (ดึงใหม่) ผลเทียบเดิมใช้ไม่ได้แล้ว แต่ยังโชว์ว่าต้องเทียบใหม่ */
    ready: ready,
  };
})();
