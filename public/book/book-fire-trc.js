/**
 * book-fire-trc.js — ระบบใหม่ ขั้น 3: แท็บ 🔁 TRcloud ของหน้า public/book/ (เฉพาะ ?fire=dev ตอนนี้)
 *
 *   📤 รอลง TRcloud   เอกสารที่ต้องลง TRcloud ยังไม่มีเลข: พิมพ์เลขในช่องแล้ว Enter หรือกด บันทึกเลข
 *                     ย้าย QA / ปรับยอด ติ๊กแล้วกด ไฟล์ปรับยอด ได้ Excel แบบที่ใช้ลง TRcloud อยู่แล้ว
 *   ⚖️ กระทบยอด      ยอดในระบบ ณ สิ้นวันของไฟล์ เทียบยอด TRcloud ที่หัวหน้านำเข้า ราย SKU ราย คลัง
 *   📥 นำเข้า (หัวหน้า) ไฟล์ยอดคงเหลือ TRcloud (ชีต Stock, WH-Loss, ราคาทุน) · PO. Truck · MASTER แปลงสินค้า
 *
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (FIRE USER esc f table isHead render xlsxLib copyText refreshDocs today)
 * ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า เปิดเป็น window.BookFireTrc
 */
(function () {
  'use strict';

  var SEC_KEY = 'wms:book:fire:trc';
  var SEC = (function () { try { return localStorage.getItem(SEC_KEY) || ''; } catch (e) { return ''; } })();
  var NOTE = null, BUSY = '';
  var LIST = null, LIST_AT = 0, SHOW = 'wait', TYPE = '';
  var EDIT = {};          // { เลขที่: {tr, state} } ที่พิมพ์แล้วยังไม่บันทึก
  var PICK = {};          // { เลขที่: 1 } ติ๊กไว้ทำไฟล์ปรับยอด
  var OPEN = '';          // เลขที่ที่เปิดดูแถว
  var R = null, R_AT = 0, RSHOW = 'diff';   // { trc, cmp }
  var IMP = null;         // ไฟล์ที่อ่านแล้วยังไม่บันทึก { parsed, files, day }
  var ST_TH = { wait: 'รอลง', done: 'ลงแล้ว', none: 'ไม่ต้องลง' };
  var NEED = { 'รับของ': 'สร้าง GR ใน TRcloud', 'แปลง': 'สร้าง MR + GR ใน TRcloud', 'คืน': 'สร้างรับคืนใน TRcloud', 'กลับรายการ': 'ยกเลิก/ลงกลับใน TRcloud' };
  var GR_TH = { diff: 'ต่าง', nosys: 'TRcloud มี ระบบไม่มี', notrc: 'ไม่มีใน TRcloud', ok: 'ตรง', all: 'ทั้งหมด' };

  function $(id) { return document.getElementById(id); }
  function head() { return isHead(); }
  function viewer() { return !USER || USER.role === 'ดูอย่างเดียว'; }
  function T() { return window.WmsFireTrc; }
  function renderAll() { if (window.render) window.render(); }
  function secs() {
    var s = [['wait', '📤 รอลง TRcloud'], ['recon', '⚖️ กระทบยอด']];
    if (head()) s.push(['imp', '📥 นำเข้า']);
    return s;
  }
  function sec() {
    if (!secs().some(function (s) { return s[0] === SEC; })) SEC = 'wait';
    return SEC;
  }
  function setSec(s) {
    SEC = s; NOTE = null;
    try { localStorage.setItem(SEC_KEY, s); } catch (e) {}
    renderAll();
    need();
  }
  function when(ms) { return ms ? new Date(ms).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
  function sign(n) { return (n > 0 ? '+' : '−') + f(Math.abs(n)); }

  /* ── โหลด ── */

  function need() {
    var s = sec();
    if (BUSY) return;
    if (s === 'wait' && (!LIST || Date.now() - LIST_AT > 60000)) loadList();
    if ((s === 'recon' && (!R || Date.now() - R_AT > 60000)) || (s === 'imp' && !R)) loadRecon();
  }
  async function loadList() {
    BUSY = 'กำลังโหลด…'; renderAll();
    var r = await FIRE.trList();
    BUSY = '';
    if (r.error) NOTE = { kind: 'bad', html: 'โหลดไม่ได้: ' + esc(r.error) };
    else { LIST = r.list; LIST_AT = Date.now(); }
    renderAll();
  }
  async function loadRecon() {
    BUSY = 'กำลังเทียบยอด…'; renderAll();
    var r = await FIRE.trc();
    BUSY = '';
    if (r.error) NOTE = { kind: 'bad', html: 'เทียบยอดไม่ได้: ' + esc(r.error) };
    else { R = r.trc ? r : { trc: null }; R_AT = Date.now(); }
    renderAll();
  }

  /* ── รอลง TRcloud ── */

  function cur(x) { var e = EDIT[x.no]; return { tr: e ? e.tr : x.tr, state: e ? e.state : x.state }; }
  function edited() {
    return (LIST || []).filter(function (x) { var c = cur(x); return EDIT[x.no] && (c.tr !== x.tr || c.state !== x.state); });
  }
  function shown() {
    return (LIST || []).filter(function (x) { return (SHOW === 'all' || x.state === SHOW) && (!TYPE || x.type === TYPE); });
  }
  /** ใบย้ายที่ยังไม่อนุมัติ: ยอดในสมุดเปลี่ยนแล้ว แต่ยังไม่ออกไฟล์ปรับยอด TRcloud */
  function held(x) { return !!x.lock; }
  function lockWhy(x) { return x.voided || x.type === 'กลับรายการ' ? 'ยกเลิกก่อนอนุมัติ ไม่ต้องลง TRcloud' : 'ยังไม่อนุมัติ ออกไฟล์ / ใส่เลขไม่ได้'; }
  /** ติ๊กไว้ หรือไม่ได้ติ๊กเลย = ทุกใบที่รอลงและออกไฟล์ได้ในหน้าที่แสดง (ไม่รวมใบที่ยังไม่อนุมัติ) */
  function fileDocs() {
    var picked = (LIST || []).filter(function (x) { return PICK[x.no] && x.kind === 'file' && x.wh.length && !held(x); });
    if (picked.length) return picked;
    return shown().filter(function (x) { return x.kind === 'file' && x.state === 'wait' && x.wh.length && !held(x); });
  }
  function whSum(x) {
    var by = {};
    x.wh.forEach(function (l) { by[l[1]] = (by[l[1]] || 0) + l[2]; });
    return Object.keys(by).map(function (w) { return '<b>' + esc(w) + '</b> <span class="' + (by[w] > 0 ? 'tt-p' : 'tt-m') + '">' + sign(by[w]) + '</span>'; }).join(' · ');
  }

  function waitIn() {
    var c = { wait: 0, done: 0, none: 0 };
    (LIST || []).forEach(function (x) { c[x.state]++; });
    var chip = function (k, label, cls) {
      return '<button class="bk-chip ' + cls + (SHOW === k ? ' on' : '') + (k !== 'all' && !c[k] ? ' zero' : '') + '" data-tshow="' + k + '">' + label +
        (k === 'all' ? '' : ' <b>' + f(c[k]) + '</b>') + '</button>';
    };
    var html = chip('wait', 'รอลง', c.wait ? 'c-warn' : '') + chip('done', 'ลงแล้ว', 'c-ok') + chip('none', 'ไม่ต้องลง', '') + chip('all', 'ทั้งหมด', '');
    var types = {};
    (LIST || []).filter(function (x) { return SHOW === 'all' || x.state === SHOW; }).forEach(function (x) { types[x.type] = (types[x.type] || 0) + 1; });
    var tk = Object.keys(types);
    if (tk.length > 1 || TYPE) {
      html += '<span class="bk-sep"></span><button class="bk-chip' + (!TYPE ? ' on' : '') + '" data-ttype="">ทุกประเภท</button>' +
        tk.map(function (t) { return '<button class="bk-chip' + (TYPE === t ? ' on' : '') + '" data-ttype="' + esc(t) + '">' + esc(t) + ' <b>' + f(types[t]) + '</b></button>'; }).join('');
    }
    return html;
  }
  function waitAct() {
    var html = '', dis = BUSY ? ' disabled' : '';
    var fd = fileDocs(), ed = edited();
    if (!viewer()) {
      html += '<button class="bk-save" id="ttSave"' + (ed.length && !BUSY ? '' : ' disabled') + '>💾 บันทึกเลข' + (ed.length ? ' ' + f(ed.length) + ' ใบ' : '') + '</button>';
      if (ed.length) html += '<button class="bk-link" id="ttUndo"' + dis + '>ล้างที่พิมพ์</button>';
    }
    html += '<button class="tx-opt' + (fd.length ? ' p' : '') + '" id="ttFile"' + (fd.length && !BUSY ? '' : ' disabled') + ' title="ย้ายเข้า/ออก QA กับปรับยอด: ไฟล์แบบเดียวกับที่ลง TRcloud จากหน้าเช็คตัดสต๊อก">⬇ ไฟล์ปรับยอด' +
      (fd.length ? ' ' + f(fd.length) + ' ใบ' : '') + '</button>';
    if (Object.keys(PICK).length) html += '<button class="bk-link" id="ttPickX">ไม่ติ๊ก</button>';
    if (viewer()) html += '<span class="g-hint">ดูอย่างเดียว ใส่เลขไม่ได้</span>';
    else html += '<span class="g-hint">พิมพ์เลข TRcloud แล้ว Enter · ติ๊ก ☐ เลือกใบที่จะทำไฟล์</span>';
    var nh = shown().filter(function (x) { return held(x) && x.state === 'wait' && x.wh.length; }).length;
    if (nh) html += '<span class="g-hint c-warn">🔒 ' + f(nh) + ' ใบยังไม่อนุมัติ ออกไฟล์และใส่เลขได้หลังหัวหน้าอนุมัติ</span>';
    return html;
  }
  function stSel(x, c) {
    return '<select class="fs-in" data-tst="' + esc(x.no) + '"' + (viewer() || held(x) ? ' disabled' : '') + ' style="min-width:96px">' +
      ['wait', 'done', 'none'].map(function (s) { return '<option value="' + s + '"' + (c.state === s ? ' selected' : '') + '>' + ST_TH[s] + '</option>'; }).join('') + '</select>';
  }
  function detail(x) {
    var rows = x.rows.slice(0, 40).map(function (r) {
      var mv = r[4] && r[5] ? esc(r[4]) + ' → ' + esc(r[5]) : esc(r[4] || r[5]);
      return esc(r[1] || r[0]) + ' · LOT ' + esc(r[2]) + ' · ' + esc(r[3]) + ' · ' + mv + ' · ' + esc(r[7]) + ' ' + f(r[6]) + (r[10] ? ' · TR ' + esc(r[10]) : '');
    });
    var wh = x.wh.map(function (l) { return esc(l[0]) + ' ' + esc(l[1]) + ' <span class="' + (l[2] > 0 ? 'tt-p' : 'tt-m') + '">' + sign(l[2]) + '</span>'; });
    return '<tr class="r-det"><td></td><td colspan="9">' +
      (wh.length ? '<div><b>ยอดในคลัง TRcloud ที่เปลี่ยน:</b> ' + wh.join(' · ') + '</div>' : '<div>ยอดในคลังไม่เปลี่ยน (ย้ายในคลังเดียวกัน)</div>') +
      '<div>' + rows.join('<br>') + (x.rows.length > 40 ? '<br>… อีก ' + f(x.rows.length - 40) + ' แถว' : '') + '</div>' +
      (x.trBy ? '<div>แก้สถานะล่าสุด ' + esc(x.trBy) + ' · ' + esc(when(x.trAt)) + '</div>' : '') + '</td></tr>';
  }
  function waitBody() {
    if (!LIST) return BUSY ? '' : '<div class="tx-empty">กด 🔄 เพื่อโหลด</div>';
    var list = shown();
    if (!list.length) return '<div class="tx-empty">' + (SHOW === 'wait' ? '✓ ไม่มีเอกสารรอลง TRcloud' : 'ไม่มีเอกสารในกลุ่มนี้') + '</div>';
    var rows = [];
    list.forEach(function (x) {
      var c = cur(x), ed = EDIT[x.no] && (c.tr !== x.tr || c.state !== x.state);
      var todo = x.kind === 'file' ? (x.wh.length ? 'ไฟล์ปรับยอด <span class="tt-wh">' + whSum(x) + '</span>' : 'ไม่เปลี่ยนคลัง')
        : esc(NEED[x.type] || 'สร้างใน TRcloud');
      if (x.ok === 'check') todo = '<span class="ba-st wait">' + (x.xf ? 'รอรับ' : 'รอตรวจ') + '</span>' + todo;
      else if (x.ok === 'approve') todo = '<span class="ba-st apv">รออนุมัติ</span>' + todo;
      else if (x.ok === 'reject') todo = '<span class="ba-st void">ไม่รับ</span>รอหัวหน้ายกเลิกใบ';
      var tag = x.type === 'กลับรายการ' ? ' <span class="c-sub">ของ ' + esc(x.link) + '</span>' : x.voided ? ' <span class="c-sub">ยกเลิกแล้ว ' + esc(x.link) + '</span>' : '';
      rows.push('<tr class="' + (x.voided ? 'r-void' : '') + (ed ? ' r-add' : '') + '">' +
        '<td style="text-align:center">' + (x.kind === 'file' && x.wh.length && !held(x) ? '<input type="checkbox" data-tpick="' + esc(x.no) + '"' + (PICK[x.no] ? ' checked' : '') + ' aria-label="เลือก ' + esc(x.no) + '">'
          : held(x) && x.wh.length ? '<span class="c-sub" title="' + esc(lockWhy(x)) + '">🔒</span>' : '') + '</td>' +
        '<td><button class="tt-no" data-topen="' + esc(x.no) + '">' + esc(x.no) + '</button></td>' +
        '<td>' + esc(x.type) + tag + '</td><td class="c-sub">' + esc(x.date) + '</td><td class="c-sub">' + esc(x.name) + '</td>' +
        '<td class="num">' + f(x.qty) + '</td><td style="white-space:normal">' + todo + '</td>' +
        '<td class="fs-c"><input class="fs-in tt-in" data-ttr="' + esc(x.no) + '" value="' + esc(c.tr) + '" placeholder="' + (held(x) ? (x.state === 'wait' ? 'หลังอนุมัติ' : '') : x.kind === 'file' ? 'เลขหลังนำเข้า' : 'เลข TRcloud') + '"' +
        (viewer() || held(x) ? ' disabled' : '') + ' autocomplete="off"></td>' +
        '<td class="fs-c">' + stSel(x, c) + '</td></tr>');
      if (OPEN === x.no) rows.push(detail(x));
    });
    return table([['', 'c-act'], ['เลขที่'], ['ประเภท'], ['วันที่'], ['ผู้ลง'], ['ชิ้น', 'num'], ['ต้องทำ'], ['เลข TRcloud'], ['สถานะ']], rows);
  }

  async function saveNums(only) {
    var list = only ? edited().filter(function (x) { return x.no === only; }) : edited();
    if (!list.length || BUSY) return;
    BUSY = 'กำลังบันทึก…'; NOTE = null; renderAll();
    var ok = 0, errs = [];
    for (var i = 0; i < list.length; i += T().TR_MAX) {
      var items = list.slice(i, i + T().TR_MAX).map(function (x) { var c = cur(x); return { no: x.no, tr: c.tr, state: c.state }; });
      var r = await FIRE.trSave(items);
      if (r.error) errs.push(r.error);
      else { ok += r.saved; items.forEach(function (it) { delete EDIT[it.no]; }); }
    }
    BUSY = '';
    NOTE = errs.length ? { kind: 'bad', html: (ok ? 'บันทึกแล้ว ' + f(ok) + ' ใบ · ' : '') + 'บันทึกไม่ได้: ' + esc(errs.join(' · ')) }
      : { kind: 'ok', html: '✅ บันทึกเลข TRcloud แล้ว ' + f(ok) + ' ใบ · เครื่องอื่นเห็นในรอบดึงถัดไป' };
    LIST = null;
    await loadList();
    if (typeof refreshDocs === 'function') { try { await refreshDocs(); renderAll(); } catch (e) {} }
  }

  async function makeFile() {
    var list = fileDocs();
    if (!list.length) return;
    var r = FIRE.trFile(list.map(function (x) { return x.no; }));
    if (!r.lines) { NOTE = { kind: 'bad', html: 'ไม่มีแถวที่ต้องลง (ยอดในคลังไม่เปลี่ยน)' }; renderAll(); return; }
    try {
      var X = await xlsxLib();
      var wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(r.aoa);
      ws['!cols'] = r.widths.map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, ws, r.name);
      var days = list.map(function (x) { return x.date; }).sort();
      X.writeFile(wb, 'ปรับยอดTRcloud_' + days[0] + (days[days.length - 1] !== days[0] ? '_ถึง_' + days[days.length - 1] : '') + '.xlsx');
      NOTE = { kind: 'ok', html: 'ดาวน์โหลดแล้ว ' + f(r.lines) + ' แถว จาก ' + f(r.docs.length) + ' ใบ (' + esc(r.docs.join(', ')) + ') · นำเข้า TRcloud แล้วพิมพ์เลขเอกสารของ TRcloud ในช่องของแต่ละใบ' +
        (r.skip.length ? ' · ข้าม ' + esc(r.skip.join(', ')) + ' (ไม่ใช่งานไฟล์ปรับยอด)' : '') +
        (r.hold && r.hold.length ? ' · ข้าม ' + esc(r.hold.join(', ')) + ' (ยังไม่อนุมัติ)' : '') };
    } catch (e) {
      NOTE = { kind: 'bad', html: 'ทำไฟล์ไม่ได้: ' + esc(e.message) };
    }
    renderAll();
  }

  /* ── กระทบยอด ── */

  function reconIn() {
    if (!R || !R.trc) return '';
    var t = R.cmp.tot, x = R.trc;
    var chip = function (k, cls) {
      var n = k === 'all' ? t.skus : t[k];
      return '<button class="bk-chip ' + cls + (RSHOW === k ? ' on' : '') + (n ? '' : ' zero') + '" data-trshow="' + k + '">' + GR_TH[k] + ' <b>' + f(n) + '</b></button>';
    };
    return '<span>ยอด TRcloud <b>' + esc(x.day) + '</b> · ' + f(x.n) + ' SKU · นำเข้า ' + esc(x.name) + ' ' + esc(when(x.at)) + '</span><span class="bk-sep"></span>' +
      chip('diff', t.diff ? 'c-red' : '') + chip('nosys', t.nosys ? 'c-warn' : '') + chip('notrc', t.notrc ? 'c-warn' : '') + chip('ok', 'c-ok') + chip('all', '') +
      (t.value ? '<span class="bk-chip" title="(ระบบ − TRcloud) × ราคาทุน รวมทุก SKU ที่ไม่ตรง' + (t.noCost ? ' · ไม่มีราคาทุน ' + t.noCost + ' SKU' : '') + '">มูลค่าต่าง <b>' + f(t.value) + '</b> ฿</span>' : '');
  }
  function reconAct() {
    if (!R || !R.trc) return '';
    var html = '<button class="tx-opt" id="trExcel"' + (BUSY ? ' disabled' : '') + '>⬇ Excel</button>';
    var open = typeof BSTATE !== 'undefined' && BSTATE && BSTATE.open, today0 = today();
    var warn = [];
    if (open && R.trc.day < String(open.at).slice(0, 10)) warn.push('ไฟล์ TRcloud เก่ากว่ายอดยกมา เทียบกันไม่ได้');
    var age = (Date.parse(today0) - Date.parse(R.trc.day)) / 86400000;
    if (age > 3) warn.push('ยอด TRcloud เก่า ' + f(age) + ' วัน นำเข้าไฟล์ใหม่ก่อนเทียบ');
    html += '<span class="g-hint">ยอดในระบบ = สิ้นวัน ' + esc(R.trc.day) + ' (เอกสารที่วันที่ไม่เกินวันนั้น) · ส่วนต่างที่มีเอกสารรอลง มักหายเมื่อใส่เลขครบ</span>';
    if (warn.length) html += '<span class="c-warn">' + esc(warn.join(' · ')) + '</span>';
    return html;
  }
  function dcell(n) { return '<td class="num' + (Math.abs(n) > 1e-9 ? ' c-red' : ' c-sub') + '">' + (Math.abs(n) > 1e-9 ? sign(n) : '0') + '</td>'; }
  function reconBody() {
    if (!R) return BUSY ? '' : '<div class="tx-empty">กด 🔄 เพื่อเทียบ</div>';
    if (!R.trc) return '<div class="tx-empty">ยังไม่มียอด TRcloud ' + (head() ? '· นำเข้าที่ <b>📥 นำเข้า</b>' : '· ให้หัวหน้านำเข้าไฟล์ยอดคงเหลือจาก TRcloud') + '</div>';
    var list = R.cmp.items.filter(function (x) { return RSHOW === 'all' || x.group === RSHOW; });
    if (!list.length) return '<div class="tx-empty">' + (RSHOW === 'diff' ? '✓ ไม่มี SKU ที่ยอดต่าง' : 'ไม่มี SKU ในกลุ่มนี้') + '</div>';
    return table([['#', 'num'], ['SKU'], ['ชื่อสินค้า'], ['ระบบ WH-02', 'num'], ['TRcloud', 'num'], ['ต่าง', 'num'], ['ระบบ QA', 'num'], ['TRcloud', 'num'], ['ต่าง', 'num'], ['รอลง', 'num']],
      list.map(function (x, i) {
        return '<tr><td class="c-no num">' + (i + 1) + '</td><td class="c-sku" title="' + esc(x.conv.length ? 'รวม SKU แปลง ' + x.conv.join(', ') : '') + '">' + esc(x.sku) + (x.conv.length ? ' *' : '') + '</td>' +
          '<td class="c-nm" title="' + esc(x.name) + '">' + esc(x.name) + '</td>' +
          '<td class="num">' + f(x.s02) + '</td><td class="num c-sub">' + f(x.t02) + '</td>' + dcell(x.d02) +
          '<td class="num">' + f(x.sqa) + '</td><td class="num c-sub">' + f(x.tqa) + '</td>' + dcell(x.dqa) +
          '<td class="num">' + (x.wait ? '<span class="c-warn" title="เอกสารรอลง TRcloud ที่มี SKU นี้">' + f(x.wait) + '</span>' : '') + '</td></tr>';
      }));
  }
  async function reconExcel() {
    try {
      var X = await xlsxLib(), wb = X.utils.book_new();
      T().trcBook(R.cmp, R.trc).forEach(function (s) {
        var ws = X.utils.aoa_to_sheet(s.aoa);
        ws['!cols'] = s.cols.map(function (w) { return { wch: w }; });
        X.utils.book_append_sheet(wb, ws, s.name);
      });
      X.writeFile(wb, 'กระทบยอดTRcloud_' + R.trc.day + '.xlsx');
    } catch (e) { NOTE = { kind: 'bad', html: 'Export ไม่สำเร็จ: ' + esc(e.message) }; renderAll(); }
  }

  /* ── นำเข้า (หัวหน้า) ── */

  function impIn() {
    var m = FIRE.masters(), html = '';
    var last = R && R.trc;
    html += '<span class="bk-chip' + (last ? '' : ' zero') + '">ยอด TRcloud ล่าสุด <b>' + (last ? esc(last.day) : '—') + '</b>' + (last ? ' ' + f(last.n) + ' SKU' : '') + '</span>' +
      '<span class="bk-chip' + (m.sup ? '' : ' zero') + '" title="' + esc(m.sup ? m.sup.tab + ' · ' + m.sup.name + ' ' + when(m.sup.at) : '') + '">PO → Supplier <b>' + f(m.sup ? m.sup.n : 0) + '</b> PO</span>' +
      '<span class="bk-chip' + (m.conv ? '' : ' zero') + '" title="' + esc(m.conv ? m.conv.tab + ' · ' + m.conv.name + ' ' + when(m.conv.at) : '') + '">แปลงสินค้า <b>' + f(m.conv ? m.conv.n : 0) + '</b> คู่</span>' +
      '<span class="bk-chip' + (m.cap ? '' : ' zero') + '" title="' + esc(m.cap ? m.cap.tab + ' · ' + m.cap.name + ' ' + when(m.cap.at) : '') + '">ความจุพาเลท <b>' + f(m.cap ? m.cap.n : 0) + '</b> SKU</span>';
    if (IMP) {
      var p = IMP.parsed;
      html += '<span class="bk-sep"></span><span>อ่านจาก <b>' + esc(IMP.files) + '</b>:</span>' +
        (p.stock ? '<span class="bk-chip c-ok">Stock <b>' + f(p.stock.list.length) + '</b> SKU</span>' : '') +
        (p.loss ? '<span class="bk-chip">WH-Loss <b>' + f(p.loss.list.length) + '</b></span>' : '') +
        (p.cost ? '<span class="bk-chip">ราคาทุน <b>' + f(p.cost.list.length) + '</b></span>' : '') +
        (p.sup ? '<span class="bk-chip c-ok">PO. Truck <b>' + f(p.sup.rows.length) + '</b>' + (p.sup.dup.length ? ' · ซ้ำ ' + f(p.sup.dup.length) : '') + '</span>' : '') +
        (p.conv ? '<span class="bk-chip c-ok">แปลงสินค้า <b>' + f(p.conv.pairs.length) + '</b> คู่</span>' : '') +
        (p.cap ? '<span class="bk-chip c-ok">ความจุพาเลท <b>' + f(p.cap.rows.length) + '</b> SKU</span>' : '') +
        (p.bad.length ? '<span class="bk-chip c-red">อ่านไม่ได้ <b>' + f(p.bad.length) + '</b></span>' : '') +
        (p.skipped.length ? '<span class="bk-chip zero" title="' + esc(p.skipped.join(', ')) + '">ข้ามชีต <b>' + f(p.skipped.length) + '</b></span>' : '');
    }
    return html;
  }
  function impAct() {
    var dis = BUSY ? ' disabled' : '', html = '';
    html += '<button class="tx-opt' + (IMP ? '' : ' p') + '" id="tiPick"' + dis + '>📂 เลือกไฟล์</button><input type="file" class="bk-file" id="tiFile" accept=".xlsx,.xls,.csv" multiple>';
    if (!IMP) return html + '<span class="g-hint">หรือลากไฟล์มาวาง · ไฟล์จาก TRcloud (ชีต Stock, WH-Loss, ราคาทุน) · ตารางหลัก (PO. Truck, MASTER แปลงสินค้า, ความจุต่อพาเลท) ส่งไปตรวจที่หน้า ข้อมูลหลัก</span>';
    var p = IMP.parsed;
    if (p.stock) {
      html += '<label class="g-hint">ยอดของวันที่ <input type="date" class="bk-date" id="tiDay" value="' + esc(IMP.day) + '"></label>' +
        '<button class="bk-save" id="tiTrc"' + dis + '>💾 บันทึกยอด TRcloud ' + f(p.stock.list.length) + ' SKU</button>';
    }
    if (p.sup || p.conv || p.cap) {
      /* ตารางหลักแก้ / บันทึกที่หน้า ข้อมูลหลัก (ตรวจก่อน เห็นที่เปลี่ยน มีประวัติ) */
      var what = [p.sup ? 'Supplier ' + f(p.sup.rows.length) + ' PO' : '', p.conv ? 'แปลงสินค้า ' + f(p.conv.pairs.length) + ' คู่' : '', p.cap ? 'ความจุ ' + f(p.cap.rows.length) + ' SKU' : ''].filter(Boolean).join(' · ');
      html += '<button class="tx-opt p" id="tiMaster"' + dis + ' title="เปิดหน้า ข้อมูลหลัก พร้อมตารางจากไฟล์นี้ ตรวจที่เปลี่ยนแล้วกด 💾 บันทึกที่นั่น">🗂 ตรวจใน ข้อมูลหลัก: ' + what + '</button>';
    }
    html += '<button class="bk-link" id="tiX">ไม่ใช้</button>';
    return html;
  }
  function impBody() {
    if (!IMP) {
      return '<div class="tx-empty">ยอดคงเหลือจาก TRcloud: export รายงานสินค้าคงเหลือ (ต้องมีคอลัมน์ SKU / รหัสสินค้า และ NEW WH, QA) ' +
        'ใส่ชีต WH-Loss กับ ราคาทุน ในไฟล์เดียวกันได้<br>ตารางหลัก: ชีต PO. Truck (PO. กับ Truck/Supplier) · MASTER แปลงสินค้า (SKU ตอนซื้อ กับ SKU หลังแปลง) · ความจุต่อพาเลท (SKU หรือ Product ID กับ STD / pallet) → ตรวจและบันทึกที่หน้า 🗂 ข้อมูลหลัก</div>';
    }
    var p = IMP.parsed, rows = [];
    var kinds = [['stock', 'ยอดคงเหลือ (Stock)'], ['loss', 'WH-Loss'], ['cost', 'ราคาทุน'], ['sup', 'PO → Supplier'], ['conv', 'แปลงสินค้า'], ['cap', 'ความจุต่อพาเลท']];
    kinds.forEach(function (k) {
      var x = p[k[0]];
      if (!x) return;
      var n = k[0] === 'sup' || k[0] === 'cap' ? x.rows.length : k[0] === 'conv' ? x.pairs.length : x.list.length;
      var cols = k[0] === 'stock' || k[0] === 'cap' ? x.cols.filter(Boolean).join(' · ') : k[0] === 'conv' ? x.cols.join(' → ') : x.col || '';
      var note = k[0] === 'sup' && x.dup.length ? 'PO ซ้ำต่าง Supplier ' + x.dup.slice(0, 5).join(', ') + (x.dup.length > 5 ? ' …' : '') + ' (ใช้แถวแรก)'
        : k[0] === 'conv' && x.blank ? 'แถวช่องว่าง ' + x.blank : k[0] === 'cap' && x.blank ? 'ช่องความจุว่าง ' + x.blank + ' แถว (ข้าม)' : '';
      rows.push('<tr><td>' + esc(x.tab) + '</td><td>' + k[1] + '</td><td class="num">' + f(n) + '</td><td class="c-sub">' + esc(cols) + '</td><td class="c-sub">' + esc(note) + '</td></tr>');
    });
    p.bad.forEach(function (b) { rows.push('<tr class="r-bad"><td>' + esc(b.tab) + '</td><td>—</td><td></td><td></td><td class="c-red">' + esc(b.why) + '</td></tr>'); });
    var html = table([['ชีต'], ['ใช้เป็น'], ['แถว', 'num'], ['คอลัมน์ที่ใช้'], ['หมายเหตุ']], rows);
    if (p.stock) {
      html += '<div class="bk-dh s-gap"><b>ตัวอย่างยอด TRcloud</b> 50 แถวแรก</div>' +
        table([['#', 'num'], ['SKU'], ['ชื่อสินค้า'], ['WH-02', 'num'], ['WH-QA', 'num']], p.stock.list.slice(0, 50).map(function (r, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td class="c-sku">' + esc(r[0]) + '</td><td class="c-nm" title="' + esc(r[1]) + '">' + esc(r[1]) + '</td>' +
            '<td class="num">' + f(r[2]) + '</td><td class="num">' + f(r[3]) + '</td></tr>';
        }));
    }
    return html;
  }

  function sheetsOf(X, wb, file) {
    var base = file.name.replace(/\.[^.]+$/, '');
    return wb.SheetNames.map(function (n) {
      var name = wb.SheetNames.length === 1 && /^(sheet\d*|แผ่นงาน\d*)$/i.test(n.trim()) ? base : n;
      return { name: name, grid: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }) };
    });
  }
  function useSheets(sheets, files) {
    var p = T().readSheets(sheets);
    if (p.error) { NOTE = { kind: 'bad', html: esc(files) + ': ' + esc(p.error) }; IMP = null; renderAll(); return; }
    IMP = { parsed: p, files: files, day: today() };
    NOTE = null;
    renderAll();
  }
  async function readFiles(list) {
    try {
      var X = await xlsxLib(), sheets = [];
      for (var i = 0; i < list.length; i++) {
        var wb = X.read(await list[i].arrayBuffer(), { type: 'array', cellDates: false });
        sheets = sheets.concat(sheetsOf(X, wb, list[i]));
      }
      useSheets(sheets, list.map(function (x) { return x.name; }).join(', '));
    } catch (e) {
      NOTE = { kind: 'bad', html: 'อ่านไฟล์ไม่ได้: ' + esc(e.message) };
      renderAll();
    }
  }

  async function saveTrc() {
    var day = $('tiDay') ? $('tiDay').value : IMP.day;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { NOTE = { kind: 'bad', html: 'เลือกวันที่ของยอดก่อน' }; renderAll(); return; }
    if (!confirm('บันทึกยอด TRcloud วันที่ ' + day + ' (' + f(IMP.parsed.stock.list.length) + ' SKU)?\nทุกเครื่องจะเทียบกับยอดชุดนี้')) return;
    BUSY = 'กำลังบันทึกยอด TRcloud…'; NOTE = null; renderAll();
    var r = await FIRE.trcSave(IMP.parsed, day, IMP.files);
    BUSY = '';
    if (r.error) { NOTE = { kind: 'bad', html: 'บันทึกไม่ได้: ' + esc(r.error) }; renderAll(); return; }
    R = { trc: r.trc, cmp: r.cmp }; R_AT = Date.now();
    var t = r.cmp.tot;
    NOTE = { kind: t.diff ? 'warn' : 'ok', html: '✅ บันทึกยอด TRcloud ' + esc(day) + ' แล้ว ' + f(r.n) + ' SKU · ตรง ' + f(t.ok) + ' · ต่าง ' + f(t.diff) + ' SKU (ดู ⚖️ กระทบยอด)' };
    if (!IMP.parsed.sup && !IMP.parsed.conv && !IMP.parsed.cap) IMP = null;
    else IMP.parsed.stock = null;
    renderAll();
  }
  /** ตารางหลักในไฟล์ → หน้า ข้อมูลหลัก (แทนร่างของตารางนั้น ตรวจแล้วบันทึกที่นั่น) · ยอด TRcloud ในไฟล์เดียวกันค้างไว้ที่นี่ */
  function toMaster() {
    if (!IMP || !window.BookMaster || typeof setMode !== 'function') return;
    var p = IMP.parsed, part = { sup: p.sup, conv: p.conv, cap: p.cap };
    var files = IMP.files;
    p.sup = p.conv = p.cap = null;
    if (!p.stock) IMP = null;
    NOTE = null;
    setMode('master');
    window.BookMaster.take(part, files);
  }

  /* ── วาด ── */

  var TIPS = {
    wait: 'รอลง TRcloud = เอกสารที่ต้องมีใน TRcloud ยังไม่มีเลข\nรับของ แปลง คืน: สร้างเอกสารใน TRcloud แล้วพิมพ์เลขในช่อง Enter\n' +
      'ย้ายเข้า/ออก QA และปรับยอด: ติ๊กแล้วกด ไฟล์ปรับยอด นำเข้า TRcloud แล้วพิมพ์เลข\nไม่ต้องลง: เลือกในช่องสถานะ (เช่น ลงไปแล้วด้วยวิธีอื่น)\n' +
      'ยกเลิกเอกสารก่อนลง TRcloud = ไม่ต้องลงทั้งคู่ · ยกเลิกหลังลงแล้ว = ใบกลับรายการขึ้นรอลง',
    recon: 'หัวหน้านำเข้ายอดคงเหลือจาก TRcloud (แท็บ นำเข้า)\nเทียบกับยอดในระบบ ณ สิ้นวันของไฟล์ ราย SKU\nQA, IQA = WH-QA ที่เหลือ (รวม RIB) = WH-02\n* = รวม SKU ที่แปลงแล้วเข้า SKU ตอนซื้อ',
    imp: 'ยอดคงเหลือ TRcloud: ไฟล์ export ที่มีคอลัมน์ SKU (หรือ รหัสสินค้า) NEW WH และ QA ชื่อรายงานด้านบนได้\nชีต WH-Loss กับ ราคาทุน ในไฟล์เดียวกันจะเก็บไว้ด้วย\nPO. Truck = PO กับ Supplier · MASTER แปลงสินค้า = SKU ตอนซื้อกับ SKU หลังแปลง · ความจุต่อพาเลท\nตารางหลักส่งไปตรวจที่หน้า ข้อมูลหลัก (เห็นที่เปลี่ยน มีประวัติ) แล้วบันทึกที่นั่น',
  };
  function renderIn() {
    var s = sec();
    var chips = secs().map(function (x) { return '<button class="bk-chip' + (s === x[0] ? ' on' : '') + '" data-tsec="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">TRcloud</span>' + chips +
      '<button type="button" class="g-tip" title="' + esc(TIPS[s]) + '" aria-label="คำอธิบาย">ⓘ</button><span class="sp"></span>' +
      (BUSY ? '<span>⏳ ' + esc(BUSY) + '</span>' : '<button class="tx-opt" id="ttRefresh">🔄</button>') + '</div>';
  }
  function render() {
    var s = sec();
    renderIn();
    $('sum').innerHTML = s === 'wait' ? waitIn() : s === 'recon' ? reconIn() : impIn();
    renderAct();
    $('body').innerHTML = s === 'wait' ? waitBody() : s === 'recon' ? reconBody() : impBody();
    need();
  }
  function renderAct() {
    var s = sec();
    var html = s === 'wait' ? waitAct() : s === 'recon' ? reconAct() : impAct();
    if (NOTE) html += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = html;
  }

  /* ── ปุ่มและช่อง (ทำงานเฉพาะแท็บ TRcloud ของระบบใหม่) ── */

  function active() { return typeof MODE !== 'undefined' && MODE === 'trc' && window.BookFire && USER; }

  document.addEventListener('click', function (e) {
    if (!active()) return;
    var t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.tsec) setSec(t.dataset.tsec);
    else if (t.dataset.tshow) { SHOW = t.dataset.tshow; TYPE = ''; renderAll(); }
    else if (t.dataset.ttype !== undefined) { TYPE = t.dataset.ttype; renderAll(); }
    else if (t.dataset.trshow) { RSHOW = t.dataset.trshow; renderAll(); }
    else if (t.dataset.topen) { OPEN = OPEN === t.dataset.topen ? '' : t.dataset.topen; renderAll(); }
    else if (t.id === 'ttRefresh') { NOTE = null; if (sec() === 'wait') { LIST = null; loadList(); } else { R = null; loadRecon(); } }
    else if (t.id === 'ttSave') saveNums();
    else if (t.id === 'ttUndo') { EDIT = {}; NOTE = null; renderAll(); }
    else if (t.id === 'ttFile') makeFile();
    else if (t.id === 'ttPickX') { PICK = {}; renderAll(); }
    else if (t.id === 'trExcel') reconExcel();
    else if (t.id === 'tiPick') $('tiFile').click();
    else if (t.id === 'tiX') { IMP = null; NOTE = null; renderAll(); }
    else if (t.id === 'tiTrc') saveTrc();
    else if (t.id === 'tiMaster') toMaster();
  });

  document.addEventListener('input', function (e) {
    if (!active()) return;
    var no = e.target.dataset && e.target.dataset.ttr;
    if (!no) return;
    var x = (LIST || []).filter(function (y) { return y.no === no; })[0];
    if (!x) return;
    var v = e.target.value.trim(), c = cur(x);
    /* พิมพ์เลข = ลงแล้ว · ลบเลขของใบที่ลงแล้ว = กลับเป็นรอลง */
    var state = v ? 'done' : c.state === 'done' ? 'wait' : c.state;
    EDIT[no] = { tr: v, state: state };
    var sel = document.querySelector('select[data-tst="' + CSS.escape(no) + '"]');
    if (sel) sel.value = state;
    renderAct();
  });

  document.addEventListener('change', function (e) {
    if (!active()) return;
    var el = e.target;
    if (el.id === 'tiFile' && el.files.length) { readFiles(Array.prototype.slice.call(el.files)); el.value = ''; return; }
    if (el.dataset && el.dataset.tpick) { if (el.checked) PICK[el.dataset.tpick] = 1; else delete PICK[el.dataset.tpick]; renderAct(); return; }
    var no = el.dataset && el.dataset.tst;
    if (no) {
      var x = (LIST || []).filter(function (y) { return y.no === no; })[0];
      if (!x) return;
      var c = cur(x);
      EDIT[no] = { tr: c.tr, state: el.value };
      renderAct();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!active() || e.key !== 'Enter') return;
    var no = e.target.dataset && e.target.dataset.ttr;
    if (no) { e.preventDefault(); saveNums(no); }
  });

  window.BookFireTrc = {
    render: render,
    opened: function () { LIST_AT = 0; R_AT = 0; need(); },
    /** เปิดส่วนนี้ไว้ก่อนสลับหน้า (การ์ดในหน้าวันนี้) */
    pick: function (s) { if (secs().some(function (x) { return x[0] === s; })) { SEC = s; NOTE = null; try { localStorage.setItem(SEC_KEY, s); } catch (e) {} } },
    /** ใส่เลข TRcloud จากหน้าเอกสารแล้ว: รายการรอลงต้องโหลดใหม่ตอนเปิดแท็บ */
    stale: function () { LIST = null; },
    /** Ctrl+V ในแท็บ TRcloud = ตารางยอด TRcloud หรือตารางหลัก (หัวหน้า) */
    paste: function (text) {
      if (!head()) return;
      if (sec() !== 'imp') { SEC = 'imp'; try { localStorage.setItem(SEC_KEY, 'imp'); } catch (e) {} }
      var now = new Date();
      useSheets([{ name: 'วาง', grid: WmsBook.gridOf(text) }], 'วางจากคลิปบอร์ด ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'));
    },
    /** ลากไฟล์มาวางในแท็บ TRcloud = ไฟล์ยอด TRcloud / ตารางหลัก (หัวหน้า) */
    files: function (list) {
      if (!head() || !list.length) return;
      if (sec() !== 'imp') { SEC = 'imp'; try { localStorage.setItem(SEC_KEY, 'imp'); } catch (e) {} }
      readFiles(list);
    },
  };
})();
