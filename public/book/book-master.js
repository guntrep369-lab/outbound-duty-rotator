/**
 * book-master.js — หน้า 🗂 ข้อมูลหลัก ของแอปสมุดสต๊อก (ระบบใหม่เท่านั้น) ขั้น ก
 *
 *   แท็บ Location · SKU · กลุ่มสินค้า = ตารางเดียวแก้ได้แบบ Excel (หัวหน้า) · คนอื่นดูอย่างเดียว
 *   ชิปกรอง + ช่องค้น · ⚠ เตือนรายแถว (แดง = บันทึกไม่ได้) · พบในสมุดแต่ยังไม่มีในตาราง → + เพิ่มทั้งหมด
 *   ⚡ สร้างหลายช่อง (แร็ค R) · Ctrl+V วางจาก Excel (ในช่อง = ทับจากช่องนั้นลงไป · นอกช่อง = เพิ่ม / อัปเดตตามรหัส)
 *   📋 คัดลอกไป Excel · ใบที่ไม่มีในตาราง: เตือน | ห้ามบันทึก (ต่อตาราง) · 🕘 ประวัติ
 *   ร่างค้างในเครื่องนี้จนกด 💾 บันทึก หรือ ยกเลิกที่แก้ · บันทึกทั้งตาราง (BookFire.setupSave → master/{loc|sku|grp})
 * ตรรกะอยู่ใน wms-fire-setup.js · ใช้ตัวแปรของสคริปต์ในหน้า (FIRE USER MODE esc f isHead copyText) ตอนถูกเรียกเท่านั้น
 * เปิดเป็น window.BookMaster
 */
(function () {
  'use strict';

  if (!window.BookFire) { window.BookMaster = null; return; }

  var STEP = 300;                         // แถวที่วาดต่อครั้ง (กด แสดงเพิ่ม)
  var DRAFT_KEY = 'wms:book:master:';     // + kind (+ :ns ของโหมดซ้อม / ทดลอง)
  var KIND_KEY = 'wms:book:master:kind';
  var KINDS = [['loc', 'Location'], ['sku', 'SKU'], ['grp', 'กลุ่มสินค้า']];
  var CHIPS = {
    loc: [['all', 'ทั้งหมด'], ['R', 'แร็ค R'], ['F', 'พื้น A–D'], ['S', 'ชั้นวาง S'], ['X', 'อื่น ๆ'], ['off', 'ปิดใช้'], ['fix', '⚠ ต้องแก้']],
    sku: [['all', 'ทั้งหมด'], ['nogrp', 'ยังไม่มีกลุ่ม'], ['gift', 'ของแถม'], ['vac', 'สุญญากาศ'], ['off', 'ปิดใช้'], ['fix', '⚠ ต้องแก้']],
    grp: [],
  };
  /* ช่องที่แก้ได้ เรียงตามคอลัมน์ (วาง / คัดลอก Excel ใช้ลำดับเดียวกัน ยกเว้นสี) */
  var COLS = {
    loc: [
      { k: 'code', t: 'Location', w: 12, up: 1 },
      { k: 'pal', t: 'จุ (พาเลท)', w: 5, num: 1 },
      { k: 'on', t: 'ใช้งาน', ck: 1 },
      { k: 'note', t: 'หมายเหตุ', w: 18 },
    ],
    sku: [
      { k: 'sku', t: 'SKU', w: 11, up: 1 },
      { k: 'long', t: 'SKU เต็ม', w: 18, up: 1 },
      { k: 'name', t: 'ชื่อสินค้า', w: 30 },
      { k: 'grp', t: 'กลุ่มสินค้า', sel: 'grp' },
      { k: 'gift', t: 'ของแถม', ck: 1 },
      { k: 'vac', t: 'สุญญากาศ', ck: 1 },
      { k: 'on', t: 'ใช้งาน', ck: 1 },
    ],
    grp: [
      { k: 'c', t: 'สี', color: 1 },
      { k: 'name', t: 'กลุ่ม', w: 16 },
      { k: 'rack', t: 'ขึ้นแร็ค', sel: 'rack' },
      { k: 'lv', t: 'ชั้นแร็ค', sel: 'lv' },
      { k: 'rest', t: 'เศษ / ไม่ขึ้นแร็ค ไปที่', sel: 'rest' },
      { k: 'note', t: 'หมายเหตุ', w: 26 },
    ],
  };
  var TIP = {
    loc: 'ทุกโลในคลัง · แร็ค R ช่องละ 1 พาเลท (รูปแบบ R00-00-0) · พื้น A–D (A-00-00) · ชั้นวาง S (S-00-00) · ชื่อพิเศษ RIB QA IQA DOCKLOAD ORDER OB …\n' +
      'จุ = กี่พาเลท (ว่าง = ไม่จำกัด) · เอาติ๊ก ใช้งาน ออก = เลิกใช้โลนี้ (ลบไม่ได้ถ้ายังมีของ)\n' +
      'วางจาก Excel ได้: Location · จุ · ใช้งาน (1/0) · หมายเหตุ',
    sku: 'ทุก SKU ที่คลังเก็บ · กลุ่มสินค้าบอกกติกาที่เก็บ (แท็บ กลุ่มสินค้า)\n' +
      'Supplier ไม่อยู่ที่นี่ (ผูกกับ PO ตามตาราง PO. Truck)\n' +
      'วางจาก Excel ได้: SKU · SKU เต็ม · ชื่อ · กลุ่ม (ชื่อหรือรหัส) · ของแถม · สุญญากาศ · ใช้งาน · รหัสที่มีแล้ว = อัปเดตช่องที่วางมา',
    grp: 'กติกาที่เก็บของแต่ละกลุ่ม ค่าเริ่มมาจากกติกาหัวหน้าคลัง 9 พ.ย.\n' +
      'ตอนลงใบ ถ้าวางของเข้าแร็ค R ผิดกติกา ระบบเตือน (ไม่ห้าม)\n' +
      'ขั้นต่อไป: ระบบเลือกแร็คให้เองตามกลุ่มนี้',
  };

  var S = {
    kind: (function () { try { var k = localStorage.getItem(KIND_KEY); return /^(loc|sku|grp)$/.test(k || '') ? k : 'loc'; } catch (e) { return 'loc'; } })(),
    chip: 'all', q: '', more: STEP, msg: null, busy: false, hist: false, gen: null, showFound: false,
  };
  var D = {};                 // ร่างต่อตาราง { base, strict, rows, dirty, fresh: {รหัส: 1} แถวใหม่ }
  var GEN = { loc: 0, sku: 0, grp: 0 };   // เปลี่ยนทุกครั้งที่แก้ (ตรวจใหม่)
  var VAL = {};               // ผลตรวจที่เก็บไว้ { kind: { g, v } }
  var FOUND = {};             // พบในสมุด { kind: { key, list } }
  var VIS = [];               // ลำดับแถว (index ในร่าง) ที่แสดงอยู่
  var SAVE_T = null, CHECK_T = null, TYPING = null;

  function $(id) { return document.getElementById(id); }
  function X() { return window.WmsFireSetup; }
  function on() { return !!(window.BookFire && USER && MODE === 'master'); }
  function canEdit() { return !!(USER && isHead()); }
  function up(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }
  function txt(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function ns() { return FIRE && FIRE.ns ? ':' + FIRE.ns : ''; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function when(ms) {
    if (!(+ms > 0)) return '';
    var d = new Date(+ms);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }
  function tables() { var su = FIRE.setup(); return su ? su.t : X().read(null); }
  function table(kind) { return tables()[kind]; }

  /* ── ร่าง ─────────────────────────────────────────────────────────── */

  function copyRows(kind, rows) { return rows.map(function (r) { return X().rowIn(kind, X().rowOut(kind, r)); }); }
  function stored(kind) {
    try {
      var s = JSON.parse(localStorage.getItem(DRAFT_KEY + kind + ns()) || 'null');
      if (!s || !Array.isArray(s.rows)) return null;
      return { base: +s.base || 0, strict: !!s.strict, rows: s.rows.map(function (r) { return X().rowIn(kind, r); }), dirty: true, fresh: s.fresh || {} };
    } catch (e) { return null; }
  }
  function keep(kind) {
    clearTimeout(SAVE_T);
    SAVE_T = setTimeout(function () {
      var d = D[kind];
      try {
        if (!d || !d.dirty) localStorage.removeItem(DRAFT_KEY + kind + ns());
        else localStorage.setItem(DRAFT_KEY + kind + ns(), JSON.stringify({ base: d.base, strict: d.strict, fresh: d.fresh, rows: d.rows.map(function (r) { return X().rowOut(kind, r); }) }));
      } catch (e) {}
    }, 300);
  }
  /** ร่างของตาราง: ร่างที่ค้างในเครื่อง → ไม่งั้นสำเนาของตารางที่บันทึก (ตารางเปลี่ยนจากเครื่องอื่น = ร่างที่ยังไม่แก้ตามไปด้วย) */
  function draft(kind) {
    var t = table(kind), d = D[kind];
    if (!d) d = D[kind] = stored(kind);
    if (d && d.dirty) return d;
    if (!d || d.base !== t.ver || d.src !== t) d = D[kind] = { base: t.ver, strict: t.strict, rows: copyRows(kind, t.rows), dirty: false, fresh: {}, src: t };
    return d;
  }
  function touch(kind) { var d = draft(kind); d.dirty = true; GEN[kind]++; keep(kind); }
  function drop(kind) {
    D[kind] = null; GEN[kind]++;
    try { localStorage.removeItem(DRAFT_KEY + kind + ns()); } catch (e) {}
  }

  /** ที่เปลี่ยนจากตารางที่บันทึก { n, text, strict } */
  function changes(kind) {
    var d = draft(kind), t = table(kind);
    if (!d.dirty) return { n: 0, text: '' };
    var rows = d.rows.filter(function (r) { return X().keyOf(kind, r) || (kind === 'grp' && txt(r.name)); });
    var dd = X().diff(kind, t.rows, rows);
    var st = kind !== 'grp' && !!d.strict !== !!t.strict;
    return { n: dd.add + dd.chg + dd.del + (st ? 1 : 0), text: [dd.text, st ? (d.strict ? 'ห้ามบันทึกใบที่ไม่มีในตาราง' : 'เตือนอย่างเดียว') : ''].filter(Boolean).join(' · ') };
  }

  /** ตารางสำหรับตรวจ (ใช้ร่างของกลุ่ม / SKU ที่กำลังแก้) */
  function checkTables() {
    return { grp: { rows: draft('grp').rows }, sku: { saved: draft('sku').rows.length > 0, rows: draft('sku').rows } };
  }
  function val(kind) {
    var c = VAL[kind], g = GEN.loc + '|' + GEN.sku + '|' + GEN.grp, st = FIRE.setupStock();
    if (c && c.g === g && c.d === draft(kind) && c.st === st) return c.v;
    var v = X().validate(kind, draft(kind).rows, checkTables(), st);
    VAL[kind] = { g: g, d: draft(kind), st: st, v: v };
    return v;
  }
  function found(kind) {
    if (kind === 'grp') return [];
    var key = GEN[kind] + '|' + draft(kind).rows.length, st = FIRE.setupStock();
    var c = FOUND[kind];
    if (c && c.key === key && c.st === st) return c.list;
    var list = FIRE.setupFound(kind, draft(kind).rows);
    FOUND[kind] = { key: key, st: st, list: list };
    return list;
  }
  function stockOf(kind, r) {
    var st = FIRE.setupStock();
    if (kind === 'loc') return st.loc[up(r.code)] || 0;
    if (kind === 'sku') return st.sku[up(r.long)] || st.sku[up(r.sku)] || 0;
    return 0;
  }
  function skuCount() {
    var n = {};
    draft('sku').rows.forEach(function (s) { if (s.grp) n[s.grp] = (n[s.grp] || 0) + 1; });
    return n;
  }

  /* ── กรอง ─────────────────────────────────────────────────────────── */

  function chipOf(kind, r, w) {
    var out = { all: 1 };
    if (kind === 'loc') {
      var k = X().locKind(r.code);
      out[k ? k.t : 'X'] = 1;
    } else if (kind === 'sku') {
      if (!r.grp) out.nogrp = 1;
      if (r.gift) out.gift = 1;
      if (r.vac) out.vac = 1;
    }
    if (r.on === false) out.off = 1;
    if (w && w.some(function (x) { return x.lv === 'red' || x.lv === 'warn'; })) out.fix = 1;
    return out;
  }
  function hit(kind, r, q) {
    if (!q) return true;
    var hay = (kind === 'loc' ? [r.code, r.note] : kind === 'sku' ? [r.sku, r.long, r.name] : [r.name, r.note, r.rest]).join(' ').toUpperCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /* ── วาด ───────────────────────────────────────────────────────────── */

  function render() {
    if (!X()) { $('body').innerHTML = '<div class="tx-empty">กำลังเปิด…</div>'; return; }
    var a = document.activeElement, keepF = a && a.dataset && a.dataset.mf !== undefined && a.closest && a.closest('#mdTbl')
      ? { i: a.dataset.mi, k: a.dataset.mf, s: a.selectionStart, e: a.selectionEnd } : null;
    var keepQ = a && a.id === 'mdQ' ? a.selectionStart : null;
    renderTop();
    renderSum();
    renderAct();
    renderBody();
    $('docs').innerHTML = '';
    if (keepQ !== null && $('mdQ')) { $('mdQ').focus(); try { $('mdQ').setSelectionRange(keepQ, keepQ); } catch (e) {} }
    if (keepF) {
      var el = document.querySelector('#mdTbl [data-mi="' + keepF.i + '"][data-mf="' + keepF.k + '"]');
      if (el) { el.focus(); try { if (keepF.s !== null) el.setSelectionRange(keepF.s, keepF.e); } catch (e) {} }
    }
  }

  function renderTop() {
    var t = table(S.kind), d = draft(S.kind);
    var tabs = KINDS.map(function (k) {
      var v = val(k[0]), n = v.bad + v.warn, dd = draft(k[0]).dirty;
      return '<button type="button" class="md-tab' + (S.kind === k[0] ? ' on' : '') + '" data-mk="' + k[0] + '">' + k[1] +
        (n ? '<span class="n' + (v.bad ? ' bad' : '') + '" title="แถวที่ต้องแก้">' + f(n) + '</span>' : '') +
        (dd ? '<span class="dot" title="มีที่แก้ยังไม่บันทึก"></span>' : '') + '</button>';
    }).join('');
    var info = t.saved
      ? 'บันทึก ' + esc(when(t.at)) + (t.name ? ' · ' + esc(t.name) : '') + ' · ' + f(t.n || t.rows.length) + ' แถว'
      : S.kind === 'grp' ? 'ใช้ค่าเริ่ม ยังไม่บันทึก' : 'ยังไม่ได้ตั้ง';
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">ข้อมูลหลัก</span><span class="md-tabs" role="tablist">' + tabs + '</span>' +
      '<button type="button" class="g-tip" aria-label="คำอธิบาย" title="' + esc(TIP[S.kind]) + '">ⓘ</button>' +
      '<span class="sp"></span><span class="c-sub md-info">' + info + '</span>' +
      (t.hist.length ? '<button type="button" class="tx-opt md-sm' + (S.hist ? ' on' : '') + '" id="mdHist">🕘 ประวัติ ' + f(t.hist.length) + '</button>' : '') +
      '</div>' + (d.dirty && d.base !== t.ver ? conflictHtml(t) : '');
  }
  function conflictHtml(t) {
    return '<div class="bk-warn">มีคนบันทึกตาราง <b>' + esc(X().TAB[S.kind]) + '</b> หลังคุณเริ่มแก้' + (t.name ? ' (' + esc(t.name) + ' ' + esc(when(t.at)) + ')' : '') +
      ' · ร่างของคุณยังอยู่ แต่บันทึกจะไม่ผ่าน ' +
      (canEdit() ? '<button type="button" class="bk-link" id="mdReload">โหลดตารางใหม่ (ที่แก้ไว้หาย)</button> · <button type="button" class="bk-link" id="mdOver">ใช้ร่างของฉันทับ</button>' : '') + '</div>';
  }

  function renderSum() {
    var kind = S.kind, chips = CHIPS[kind], v = val(kind), rows = draft(kind).rows;
    var html = '';
    if (chips.length) {
      var n = {};
      rows.forEach(function (r, i) { var c = chipOf(kind, r, v.rows[i]); Object.keys(c).forEach(function (k) { n[k] = (n[k] || 0) + 1; }); });
      html += chips.map(function (c) {
        var cnt = n[c[0]] || 0, tone = c[0] === 'fix' ? (v.bad ? ' c-red' : ' c-warn') : '';
        return '<button type="button" class="bk-chip' + tone + (S.chip === c[0] ? ' on' : '') + (cnt || S.chip === c[0] ? '' : ' zero') + '" data-mc="' + c[0] + '">' + c[1] + ' <b>' + f(cnt) + '</b></button>';
      }).join('');
    } else {
      html += '<span class="c-sub">' + f(rows.length) + ' กลุ่ม</span>';
    }
    if (kind !== 'grp') {
      html += '<input class="bk-field md-q" id="mdQ" type="search" autocomplete="off" spellcheck="false" aria-label="ค้นหา" placeholder="ค้น ' +
        (kind === 'loc' ? 'Location · หมายเหตุ' : 'SKU · ชื่อ') + '" value="' + esc(S.q) + '">';
    }
    $('sum').innerHTML = html;
  }

  function renderAct() {
    var kind = S.kind, d = draft(kind), v = val(kind), ch = changes(kind), edit = canEdit();
    var html = '';
    if (edit) {
      html += '<button type="button" class="tx-opt" id="mdAdd">+ แถว</button>';
      if (kind === 'loc') html += '<button type="button" class="tx-opt' + (S.gen ? ' on' : '') + '" id="mdGen">⚡ สร้างหลายช่อง</button>';
      html += '<button type="button" class="g-tip md-paste" title="' + esc('Ctrl+V ตรงไหนก็ได้ (ไม่อยู่ในช่อง) = เพิ่มแถว / อัปเดตแถวที่รหัสตรง\nวางในช่อง = ทับจากช่องนั้นลงไปแบบ Excel') + '" aria-label="วิธีวาง">📋</button>';
    }
    html += '<button type="button" class="tx-opt" id="mdCopy">คัดลอกไป Excel</button>';
    if (kind !== 'grp') {
      var tip = 'ใบ รับของ ย้าย คืน แปลง ปรับยอด ที่ใช้ ' + (kind === 'loc' ? 'โล' : 'SKU') + ' ที่ไม่มีในตารางนี้ (หรือปิดใช้)\nเตือน = บันทึกได้ ขึ้นสีส้ม · ห้ามบันทึก = แถวแดง ต้องแก้ก่อน\nแนะนำ: เตือนไปก่อนจนตารางครบ แล้วค่อยเปลี่ยนเป็นห้าม';
      html += '<span class="md-seg" title="' + esc(tip) + '"><span class="c-sub">ไม่มีในตาราง:</span>' +
        '<button type="button" class="tx-opt' + (!d.strict ? ' on' : '') + '" data-ms="0"' + (edit ? '' : ' disabled') + '>เตือน</button>' +
        '<button type="button" class="tx-opt' + (d.strict ? ' on' : '') + '" data-ms="1"' + (edit ? '' : ' disabled') + '>ห้ามบันทึก</button></span>';
    }
    html += '<span class="sp"></span>';
    if (!edit) html += '<span class="c-sub">ดูอย่างเดียว · แก้ได้เฉพาะหัวหน้า</span>';
    else {
      if (ch.n) html += '<span class="md-ch" title="' + esc(ch.text) + '">แก้ <b>' + f(ch.n) + '</b> รายการ</span><button type="button" class="bk-link" id="mdUndo">ยกเลิกที่แก้</button>';
      var why = S.busy ? 'กำลังบันทึก…' : v.bad ? 'แก้แถวสีแดงก่อน' : !ch.n ? 'ยังไม่มีอะไรเปลี่ยน' : '';
      html += '<button type="button" class="bk-save" id="mdSave"' + (why ? ' disabled title="' + esc(why) + '"' : '') + '>' + (S.busy ? 'กำลังบันทึก…' : '💾 บันทึก') + '</button>';
    }
    if (S.msg) html += '<div class="bk-msg ' + S.msg.kind + '">' + S.msg.html + '</div>';
    $('act').innerHTML = html;
  }

  function renderBody() {
    var kind = S.kind, html = '';
    if (S.hist) html += histHtml();
    if (S.gen && kind === 'loc' && canEdit()) html += genHtml();
    var fd = found(kind);
    if (fd.length) {
      var word = kind === 'loc' ? 'โล' : 'SKU';
      html += '<div class="bk-warn md-found">พบในสมุด <b>' + f(fd.length) + ' ' + word + '</b> ที่ยังไม่มีในตาราง' +
        (canEdit() ? ' <button type="button" class="tx-opt md-sm" id="mdFoundAdd">+ เพิ่มทั้งหมด</button>' : '') +
        ' <button type="button" class="bk-link" id="mdFoundShow">' + (S.showFound ? 'ซ่อน' : 'ดูรายชื่อ') + '</button>' +
        (S.showFound ? '<div class="md-fl">' + fd.slice(0, 60).map(function (x) {
          return '<span>' + esc(x.code || x.sku || x.long) + (x.name ? ' <i>' + esc(x.name) + '</i>' : '') + (x.qty ? ' · ' + f(x.qty) : '') + '</span>';
        }).join('') + (fd.length > 60 ? '<span>… อีก ' + f(fd.length - 60) + '</span>' : '') + '</div>' : '') + '</div>';
    }
    html += tableHtml();
    $('body').innerHTML = html;
  }

  function histHtml() {
    var t = table(S.kind);
    return '<div class="md-hist"><b>ประวัติตาราง ' + esc(X().TAB[S.kind]) + '</b> <span class="c-sub">ล่าสุด ' + f(t.hist.length) + ' ครั้ง (เก็บ ' + X().HIST_MAX + ' ครั้ง)</span><ul>' +
      t.hist.map(function (h) { return '<li><b>' + esc(when(h.at)) + '</b> ' + esc(h.name || h.by || '') + ' — ' + esc(h.text || '') + '</li>'; }).join('') + '</ul></div>';
  }

  /* ⚡ สร้างหลายช่อง: แร็ค R จาก–ถึง × ช่อง × ชั้น · จำนวนหลักตามตัวอย่างรหัส */
  function genSample() {
    var r = draft('loc').rows.filter(function (x) { return X().locKind(x.code) && X().locKind(x.code).t === 'R'; })[0];
    return r ? r.code : 'R01-01-1';
  }
  function genPlan() {
    var g = S.gen, m = /^R(\d+)-(\d+)-(\d+)$/.exec(up(g.sample));
    if (!m) return { error: 'ตัวอย่างรหัสต้องเป็นแบบ R01-01-1' };
    var w = [m[1].length, m[2].length, m[3].length];
    var rng = function (a, b) { a = parseInt(a, 10); b = parseInt(b, 10); if (!(a >= 0) || !(b >= a)) return null; return [a, b]; };
    var R = rng(g.r1, g.r2), B = rng(g.b1, g.b2), L = rng(g.l1, g.l2);
    if (!R || !B || !L) return { error: 'ใส่ตัวเลข จาก ≤ ถึง ให้ครบ' };
    var n = (R[1] - R[0] + 1) * (B[1] - B[0] + 1) * (L[1] - L[0] + 1);
    if (n > 3000) return { error: 'ครั้งละไม่เกิน 3,000 ช่อง' };
    var have = {}, codes = [], dup = 0;
    draft('loc').rows.forEach(function (r) { have[up(r.code)] = 1; });
    for (var a = R[0]; a <= R[1]; a++) for (var b = B[0]; b <= B[1]; b++) for (var c = L[0]; c <= L[1]; c++) {
      var code = 'R' + pad(a, w[0]) + '-' + pad(b, w[1]) + '-' + pad(c, w[2]);
      if (have[code]) dup++; else codes.push(code);
    }
    return { codes: codes, dup: dup };
  }
  function genHtml() {
    var g = S.gen, p = genPlan();
    var box = function (k, ph) { return '<input class="bk-field md-n" data-mg="' + k + '" inputmode="numeric" maxlength="3" placeholder="' + ph + '" value="' + esc(g[k]) + '">'; };
    return '<div class="md-gen"><b>⚡ สร้างช่องแร็ค</b>' +
      '<label>ตัวอย่างรหัส <input class="bk-field md-s" data-mg="sample" maxlength="20" value="' + esc(g.sample) + '"></label>' +
      '<label>แร็ค ' + box('r1', 'จาก') + '–' + box('r2', 'ถึง') + '</label>' +
      '<label>ช่อง ' + box('b1', 'จาก') + '–' + box('b2', 'ถึง') + '</label>' +
      '<label>ชั้น ' + box('l1', 'จาก') + '–' + box('l2', 'ถึง') + '</label>' +
      '<span class="md-gp" id="mdGp">' + genText(p) + '</span>' +
      '<button type="button" class="tx-opt p" id="mdGenGo"' + (p.error || !p.codes.length ? ' disabled' : '') + '>+ เพิ่ม</button></div>';
  }
  function genText(p) {
    return (p.error ? '<span class="c-warn">' + esc(p.error) + '</span>'
        : (p.codes.length ? esc(p.codes[0]) + (p.codes.length > 1 ? ' … ' + esc(p.codes[p.codes.length - 1]) : '') + ' · <b>' + f(p.codes.length) + '</b> ช่อง' : 'ไม่มีช่องใหม่') +
          (p.dup ? ' · มีแล้ว ' + f(p.dup) + ' ข้าม' : ''));
  }

  function cellHtml(kind, c, r, i, edit) {
    var at = ' data-mi="' + i + '" data-mf="' + c.k + '"' + (edit ? '' : ' disabled');
    if (c.ck) return '<td class="g-in md-ck"><input type="checkbox"' + at + (r[c.k] ? ' checked' : '') + ' aria-label="' + esc(c.t) + '"></td>';
    if (c.color) return '<td class="g-in md-ck"><input type="color" class="md-sw"' + at + ' value="' + esc(/^#[0-9a-f]{6}$/i.test(r.c) ? r.c : '#64748B') + '" aria-label="สี"></td>';
    if (c.sel) {
      var opts = c.sel === 'grp' ? [['', '—']].concat(draft('grp').rows.filter(function (g) { return g.id; }).map(function (g) { return [g.id, g.name || g.id]; }))
        : c.sel === 'rack' ? [['yes', 'ขึ้นได้'], ['no', 'ไม่ขึ้น']]
          : c.sel === 'lv' ? [['', '—']].concat(X().LV)
            : [['', '—']].concat(X().REST.map(function (x) { return [x, x]; }));
      var cur = txt(r[c.k]);
      if (cur && !opts.some(function (o) { return o[0] === cur; })) opts.push([cur, cur + ' (ไม่มีแล้ว)']);
      return '<td class="g-in"><select' + at + ' aria-label="' + esc(c.t) + '">' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></td>';
    }
    return '<td class="g-in' + (c.num ? ' num' : '') + (c.up ? ' md-mono' : '') + '"><input' + at.replace(' disabled', ' readonly') + ' size="' + c.w + '" maxlength="' + (c.k === 'name' || c.k === 'note' ? 120 : 40) +
      '" autocomplete="off" spellcheck="false" value="' + esc(r[c.k]) + '" aria-label="' + esc(c.t) + '"' + (c.num ? ' inputmode="decimal"' : '') + '></td>';
  }
  function warnHtml(w) {
    if (!w || !w.length) return '';
    return w.map(function (x) { return '<span class="' + (x.lv === 'red' ? 'c-red' : x.lv === 'warn' ? 'c-warn' : 'c-sub') + '">' + esc(x.t) + '</span>'; }).join(' · ');
  }
  function rowCls(w) {
    if (w && w.some(function (x) { return x.lv === 'red'; })) return 'r-bad';
    if (w && w.some(function (x) { return x.lv === 'warn'; })) return 'r-warn';
    return '';
  }
  function extraHtml(kind, r, cnt) {
    if (kind === 'loc') {
      var k = X().locKind(r.code), q = stockOf(kind, r);
      var label = !k ? '?' : k.t === 'R' ? 'แร็ค ชั้น ' + k.lv : k.t === 'F' ? 'พื้น ' + k.zone : k.t === 'S' ? 'ชั้นวาง' : 'พิเศษ';
      return '<td class="c-sub">' + label + '</td><td class="num">' + (q ? f(q) : '') + '</td>';
    }
    if (kind === 'sku') { var s = stockOf(kind, r); return '<td class="num">' + (s ? f(s) : '') + '</td>'; }
    return '<td class="num">' + (cnt[r.id] ? f(cnt[r.id]) : '') + '</td>';
  }
  function tableHtml() {
    var kind = S.kind, d = draft(kind), v = val(kind), edit = canEdit(), q = up(S.q);
    var cnt = kind === 'grp' ? skuCount() : null;
    VIS = [];
    d.rows.forEach(function (r, i) {
      if (S.chip !== 'all' && !chipOf(kind, r, v.rows[i])[S.chip]) return;
      if (!hit(kind, r, q)) return;
      VIS.push(i);
    });
    if (!d.rows.length) {
      return '<div class="tx-empty">' + (kind === 'loc' ? 'ยังไม่มี Location' : 'ยังไม่มี SKU') + (edit ? '<br>กด <b>+ เพิ่มทั้งหมด</b> (ด้านบน) เพื่อเติมจากสมุด · วางจาก Excel (Ctrl+V)' + (kind === 'loc' ? ' · หรือ <b>⚡ สร้างหลายช่อง</b>' : '') : '') + '</div>';
    }
    if (!VIS.length) return '<div class="tx-empty">ไม่มีแถวที่ตรงกับที่เลือก</div>';
    var cols = COLS[kind];
    var extra = kind === 'loc' ? '<th>ชนิด</th><th class="num">ของตอนนี้</th>' : kind === 'sku' ? '<th class="num">ของตอนนี้</th>' : '<th class="num">SKU</th>';
    var html = '<div class="bk-wrap md-wrap"><table class="bk-xl g-xl md-xl" id="mdTbl"><thead><tr><th class="c-no">#</th>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.t) + '</th>'; }).join('') + extra + '<th>⚠</th>' + (edit ? '<th class="c-act"></th>' : '') + '</tr></thead><tbody>';
    VIS.slice(0, S.more).forEach(function (i, n) {
      var r = d.rows[i], w = v.rows[i], k = X().keyOf(kind, r);
      var lock = edit && (kind === 'grp' ? cnt[r.id] > 0 : stockOf(kind, r) > 0);
      html += '<tr class="' + rowCls(w) + (d.fresh[k] || r._new ? ' md-new' : '') + '" data-row="' + i + '"><td class="c-no">' + (n + 1) + '</td>' +
        cols.map(function (c) { return cellHtml(kind, c, r, i, edit); }).join('') + extraHtml(kind, r, cnt) +
        '<td class="g-out md-w" id="mw-' + i + '">' + warnHtml(w) + '</td>' +
        (edit ? '<td class="c-act"><button type="button" class="bk-x" data-mdel="' + i + '"' +
          (lock ? ' disabled title="' + (kind === 'grp' ? 'มี SKU ในกลุ่มนี้ ย้าย SKU ไปกลุ่มอื่นก่อน' : 'ยังมีของอยู่ เอาติ๊ก ใช้งาน ออกแทน') + '"' : ' title="ลบแถว"') + ' aria-label="ลบแถว">✕</button></td>' : '') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (VIS.length > S.more) html += '<div class="bk-more">แสดง ' + f(S.more) + ' จาก ' + f(VIS.length) + ' แถว <button type="button" class="bk-link" id="mdMore">แสดงเพิ่ม</button></div>';
    return html;
  }

  /** หลังพิมพ์: ตรวจใหม่แล้วแก้เฉพาะช่องเตือน สีแถว ชิป ปุ่ม (ไม่วาดตารางใหม่ ช่องที่พิมพ์ไม่หลุด) */
  function refresh() {
    var kind = S.kind, v = val(kind);
    VIS.slice(0, S.more).forEach(function (i) {
      var cell = $('mw-' + i);
      if (!cell) return;
      cell.innerHTML = warnHtml(v.rows[i]);
      var tr = cell.parentNode;
      tr.classList.remove('r-bad', 'r-warn');
      var c = rowCls(v.rows[i]);
      if (c) tr.classList.add(c);
    });
    if (!(document.activeElement && document.activeElement.id === 'mdQ')) renderSum();
    renderAct();
    renderTop();
  }
  function soon() { clearTimeout(CHECK_T); CHECK_T = setTimeout(refresh, 150); }

  /* ── แก้ ───────────────────────────────────────────────────────────── */

  function newRow(kind) {
    var r = X().blank(kind);
    if (kind === 'grp') {
      r.id = X().newGroupId(draft('grp').rows);
      r.c = X().PALETTE[draft('grp').rows.length % X().PALETTE.length];
      r.rack = 'yes';
    }
    if (kind === 'loc') r.on = true;
    if (kind === 'sku') r.on = true;
    r._new = true;
    return r;
  }
  /** กลุ่มใหม่หลายแถวพร้อมกัน: รหัสกลุ่มไม่ซ้ำกันเอง */
  function uniqueIds(kind, have, rows) {
    if (kind !== 'grp') return;
    var all = have.slice();
    rows.forEach(function (r) { if (!r.id || all.some(function (x) { return x.id === r.id; })) r.id = X().newGroupId(all); all.push(r); });
  }
  function addRows(kind, rows, top) {
    var d = draft(kind);
    uniqueIds(kind, d.rows, rows);
    rows.forEach(function (r) { r._new = true; var k = X().keyOf(kind, r); if (k) d.fresh[k] = 1; });
    d.rows = top ? rows.concat(d.rows) : d.rows.concat(rows);
    touch(kind);
  }
  function setField(kind, i, k, value) {
    var d = draft(kind), r = d.rows[i];
    if (!r) return;
    r[k] = value;
    touch(kind);
  }

  /** ค่าจากที่วาง → ค่าของช่อง */
  function parseCell(kind, c, v) {
    var s = txt(v), u = s.toUpperCase();
    if (c.ck) {
      if (c.k === 'on') return !/^(0|N|NO|FALSE|ไม่|ปิด|✗|X)$/.test(u);
      return /^(1|Y|YES|TRUE|✓|ใช่)$/.test(u);
    }
    if (c.up) return u;
    if (c.sel === 'grp') {
      if (!s) return '';
      var g = draft('grp').rows.filter(function (x) { return x.id === s || up(x.name) === u; })[0];
      return g ? g.id : s;
    }
    if (c.sel === 'rack') return /^(NO|N|0|ไม่|ไม่ขึ้น|ไม่ได้)/.test(u) ? 'no' : 'yes';
    if (c.sel === 'lv') return /ALL|ทุก/.test(u) ? 'all' : /2/.test(u) ? '2+' : /1/.test(u) ? '1' : '';
    if (c.sel === 'rest') {
      var hitR = X().REST.filter(function (x) { return up(x) === u; })[0] || X().REST.filter(function (x) { return u && up(x).indexOf(u) === 0; })[0];
      return hitR || s;
    }
    return s;
  }
  function pasteCols(kind) { return COLS[kind].filter(function (c) { return !c.color; }); }
  function gridOf(text) {
    return String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; }).map(function (l) { return l.split('\t'); });
  }
  var HEAD_RE = /^(LOCATION|โล|SKU|รหัส|กลุ่ม|ชื่อกลุ่ม)/i;

  /** วางนอกช่อง: รหัสที่มีแล้ว = อัปเดตช่องที่วางมา (ไม่ว่าง) · ไม่มี = เพิ่มแถวบนสุด */
  function paste(text) {
    if (!on()) return;
    if (!canEdit()) { S.msg = { kind: 'warn', html: 'แก้ข้อมูลหลักได้เฉพาะหัวหน้า' }; renderAct(); return; }
    var kind = S.kind, g = gridOf(text), cols = pasteCols(kind);
    if (g.length && HEAD_RE.test(txt(g[0][0]))) g.shift();
    if (!g.length) return;
    var d = draft(kind), by = {}, add = [], upd = 0;
    d.rows.forEach(function (r, i) { var k = X().keyOf(kind, r) || (kind === 'grp' ? up(r.name) : ''); if (k) by[k] = i; if (kind === 'grp' && up(r.name)) by[up(r.name)] = i; });
    g.forEach(function (cells) {
      var r = newRow(kind);
      cols.forEach(function (c, j) { if (j < cells.length) r[c.k] = parseCell(kind, c, cells[j]); });
      var k = kind === 'grp' ? up(r.name) : X().keyOf(kind, r);
      if (kind === 'sku' && !k) return;
      if (kind === 'loc' && !k) return;
      if (kind === 'grp' && !k) return;
      var at = by[k];
      if (at === undefined && kind === 'sku' && up(r.sku)) {
        /* วางมาแค่ SKU สั้น: ตรงกับแถวที่มี SKU สั้นเดียวกัน */
        d.rows.forEach(function (x, i) { if (at === undefined && up(x.sku) === up(r.sku) && !up(r.long)) at = i; });
      }
      if (at !== undefined) {
        var cur = d.rows[at];
        cols.forEach(function (c, j) { if (j < cells.length && txt(cells[j]) !== '') cur[c.k] = parseCell(kind, c, cells[j]); });
        upd++;
      } else {
        if (kind === 'loc' && r.pal === '' && X().locKind(r.code) && X().locKind(r.code).t === 'R') r.pal = '1';
        if (kind === 'sku' && !r.grp) r.grp = guess(r);
        by[k] = -1;
        add.push(r);
      }
    });
    if (add.length) addRows(kind, add, true); else if (upd) touch(kind);
    S.chip = 'all'; S.q = '';
    S.msg = { kind: 'ok', html: 'วางแล้ว · เพิ่ม <b>' + f(add.length) + '</b> · อัปเดต <b>' + f(upd) + '</b> แถว · ตรวจแล้วกด 💾 บันทึก' };
    render();
  }
  /** วางในช่อง: ทับจากช่องนั้นลงไป (ตามแถวที่แสดง) เกินแถวสุดท้าย = เพิ่มแถว */
  function pasteInto(el, text) {
    var kind = S.kind, g = gridOf(text), cols = pasteCols(kind);
    var i = +el.dataset.mi, start = cols.map(function (c) { return c.k; }).indexOf(el.dataset.mf);
    if (start < 0) return false;
    var pos = VIS.indexOf(i), d = draft(kind), add = [];
    g.forEach(function (cells, j) {
      var at = pos + j < VIS.length ? VIS[pos + j] : -1;
      var r = at >= 0 ? d.rows[at] : newRow(kind);
      cells.forEach(function (v, m) { var c = cols[start + m]; if (c) r[c.k] = parseCell(kind, c, v); });
      if (at < 0) add.push(r);
    });
    if (add.length) { uniqueIds(kind, d.rows, add); d.rows = d.rows.concat(add); add.forEach(function (r) { var k = X().keyOf(kind, r); if (k) d.fresh[k] = 1; }); S.more = Math.max(S.more, VIS.length + add.length); }
    touch(kind);
    render();
    return true;
  }
  function guess(r) {
    var gid = X().guessGroup(r.name, r.long || r.sku);
    return gid && draft('grp').rows.some(function (g) { return g.id === gid; }) ? gid : '';
  }

  function addFound() {
    var kind = S.kind, fd = found(kind);
    if (!fd.length) return;
    var rows = fd.map(function (x) {
      var r = newRow(kind);
      if (kind === 'loc') { r.code = x.code; var k = X().locKind(x.code); if (k && k.t === 'R') r.pal = '1'; }
      else { r.sku = x.sku || x.long; r.long = x.long || ''; r.name = x.name || ''; r.grp = guess(r); r.gift = r.grp === 'gf'; }
      return r;
    });
    addRows(kind, rows, true);
    S.chip = 'all'; S.q = ''; S.showFound = false;
    S.msg = { kind: 'ok', html: 'เพิ่ม <b>' + f(rows.length) + '</b> แถวจากสมุด (แถบฟ้าด้านซ้าย)' + (kind === 'sku' ? ' · กลุ่มเดาจากชื่อ ช่วยตรวจ' : '') + ' · ตรวจแล้วกด 💾 บันทึก' };
    render();
  }

  function copyAll() {
    var kind = S.kind, cols = pasteCols(kind), d = draft(kind);
    var gname = {};
    draft('grp').rows.forEach(function (g) { gname[g.id] = g.name; });
    var lines = [cols.map(function (c) { return c.t; }).join('\t')].concat(d.rows.map(function (r) {
      return cols.map(function (c) {
        var v = r[c.k];
        if (c.ck) return v ? '1' : (c.k === 'on' ? '0' : '');
        if (c.sel === 'grp') return gname[v] || v || '';
        return String(v === undefined || v === null ? '' : v).replace(/[\t\n]/g, ' ');
      }).join('\t');
    }));
    copyText(lines.join('\n')).then(function () {
      S.msg = { kind: 'ok', html: 'คัดลอก ' + f(d.rows.length) + ' แถวแล้ว · วางใน Excel ได้เลย' };
      renderAct();
    });
  }

  async function save() {
    var kind = S.kind, d = draft(kind);
    if (S.busy || !canEdit()) return;
    var rows = d.rows.filter(function (r) { return X().keyOf(kind, r) || (kind === 'grp' && txt(r.name)); });
    if (kind !== 'grp') rows = rows.slice().sort(function (a, b) { return String(X().keyOf(kind, a)).localeCompare(String(X().keyOf(kind, b)), 'en', { numeric: true }); });
    S.busy = true; S.msg = null; renderAct();
    var r;
    try { r = await FIRE.setupSave(kind, rows, { base: d.base, strict: d.strict }); }
    catch (e) { r = { error: String(e && e.message || e) }; }
    S.busy = false;
    if (r.error) {
      S.msg = { kind: 'bad', html: 'บันทึกไม่สำเร็จ: ' + esc(r.error) };
      render();
      return;
    }
    drop(kind);
    S.msg = { kind: 'ok', html: '✅ บันทึกตาราง ' + esc(X().TAB[kind]) + ' แล้ว · ' + f(r.n) + ' แถว' + (r.text ? ' · ' + esc(r.text) : '') + ' · ทุกเครื่องได้ตารางใหม่ตอนดึงรอบถัดไป' };
    render();
  }

  /* ── ปุ่มและช่อง ── */

  document.addEventListener('click', function (e) {
    if (!on()) return;
    var t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.mk) {
      if (S.kind === t.dataset.mk) return;
      S.kind = t.dataset.mk; S.chip = 'all'; S.q = ''; S.more = STEP; S.msg = null; S.hist = false; S.showFound = false;
      if (S.kind !== 'loc') S.gen = null;
      try { localStorage.setItem(KIND_KEY, S.kind); } catch (err) {}
      render();
      return;
    }
    if (t.dataset.mc) { S.chip = t.dataset.mc; S.more = STEP; render(); return; }
    if (t.dataset.ms !== undefined) {
      if (!canEdit()) return;
      var d = draft(S.kind), want = t.dataset.ms === '1';
      if (d.strict === want) return;
      d.strict = want; touch(S.kind);
      S.msg = want ? { kind: 'warn', html: 'ห้ามบันทึกใบที่ใช้ ' + (S.kind === 'loc' ? 'โล' : 'SKU') + ' ที่ไม่มีในตาราง (มีผลหลังกด 💾 บันทึก) · เช็คว่าตารางครบก่อน ไม่งั้นทีมลงใบไม่ได้' } : null;
      renderAct();
      return;
    }
    if (t.dataset.mdel !== undefined) {
      var i = +t.dataset.mdel, dd = draft(S.kind);
      if (!dd.rows[i]) return;
      dd.rows.splice(i, 1); touch(S.kind); render();
      return;
    }
    switch (t.id) {
      case 'mdAdd': addRows(S.kind, [newRow(S.kind)], true); S.chip = 'all'; S.q = ''; render();
        var first = document.querySelector('#mdTbl tbody tr input:not([type=checkbox]):not([type=color])');
        if (first) first.focus();
        return;
      case 'mdGen':
        S.gen = S.gen ? null : { sample: genSample(), r1: '', r2: '', b1: '1', b2: '', l1: '1', l2: '' };
        render(); return;
      case 'mdGenGo': {
        var p = genPlan();
        if (p.error || !p.codes.length) return;
        addRows('loc', p.codes.map(function (c) { var r = newRow('loc'); r.code = c; r.pal = '1'; return r; }), true);
        S.msg = { kind: 'ok', html: 'เพิ่ม <b>' + f(p.codes.length) + '</b> ช่อง' + (p.dup ? ' · มีแล้ว ' + f(p.dup) + ' ข้าม' : '') + ' · ตรวจแล้วกด 💾 บันทึก' };
        S.chip = 'all'; S.q = '';
        render(); return;
      }
      case 'mdCopy': copyAll(); return;
      case 'mdHist': S.hist = !S.hist; render(); return;
      case 'mdFoundAdd': if (canEdit()) addFound(); return;
      case 'mdFoundShow': S.showFound = !S.showFound; render(); return;
      case 'mdMore': S.more += STEP * 3; render(); return;
      case 'mdUndo':
        if (!window.confirm('ยกเลิกที่แก้ทั้งหมดของตาราง ' + X().TAB[S.kind] + ' ?')) return;
        drop(S.kind); S.msg = null; render(); return;
      case 'mdReload': drop(S.kind); S.msg = null; render(); return;
      case 'mdOver': { var t0 = table(S.kind); draft(S.kind).base = t0.ver; keep(S.kind); S.msg = { kind: 'warn', html: 'กด 💾 บันทึก แล้วตารางในฐานจะเป็นแบบร่างของคุณ (ที่คนอื่นเพิ่งแก้จะหาย)' }; render(); return; }
      case 'mdSave': save(); return;
    }
  });

  document.addEventListener('input', function (e) {
    if (!on()) return;
    var el = e.target;
    if (el.id === 'mdQ') {
      S.q = el.value; S.more = STEP;
      clearTimeout(TYPING);
      TYPING = setTimeout(function () { renderBody(); }, 160);
      return;
    }
    if (el.dataset && el.dataset.mg) {
      if (!S.gen) return;
      S.gen[el.dataset.mg] = el.value;
      var p = genPlan();
      if ($('mdGp')) $('mdGp').innerHTML = genText(p);
      if ($('mdGenGo')) $('mdGenGo').disabled = !!(p.error || !p.codes.length);
      return;
    }
    if (!el.dataset || el.dataset.mf === undefined || !canEdit()) return;
    if (el.type === 'checkbox' || el.tagName === 'SELECT') return;   // ใช้ change
    setField(S.kind, +el.dataset.mi, el.dataset.mf, el.value);
    soon();
  });

  document.addEventListener('change', function (e) {
    if (!on()) return;
    var el = e.target;
    if (!el.dataset || el.dataset.mf === undefined || !canEdit()) return;
    var kind = S.kind, c = COLS[kind].filter(function (x) { return x.k === el.dataset.mf; })[0];
    if (!c) return;
    var v = c.ck ? el.checked : c.up ? up(el.value) : el.type === 'color' ? el.value : txt(el.value);
    if (c.up && el.value !== v) el.value = v;
    setField(kind, +el.dataset.mi, c.k, v);
    if (kind === 'grp' && c.k === 'rack' && v === 'no') { var r = draft('grp').rows[+el.dataset.mi]; if (r && r.lv) { r.lv = ''; render(); return; } }
    soon();
  });

  document.addEventListener('keydown', function (e) {
    if (!on()) return;
    var el = e.target;
    if (!el.dataset || el.dataset.mf === undefined || el.tagName !== 'INPUT' || el.type === 'checkbox' || el.type === 'color') return;
    var dir = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    var pos = VIS.indexOf(+el.dataset.mi) + dir;
    if (pos < 0 || pos >= Math.min(VIS.length, S.more)) return;
    var next = document.querySelector('#mdTbl [data-mi="' + VIS[pos] + '"][data-mf="' + el.dataset.mf + '"]');
    if (next) { e.preventDefault(); next.focus(); try { next.select(); } catch (err) {} }
  });

  /* วางหลายช่องในช่องของตาราง (หน้าเว็บไม่รับ เพราะกำลังพิมพ์) */
  document.addEventListener('paste', function (e) {
    if (!on() || !canEdit()) return;
    var el = e.target;
    if (!el.dataset || el.dataset.mf === undefined || !el.closest('#mdTbl')) return;
    var text = e.clipboardData && e.clipboardData.getData('text');
    if (!text || (text.indexOf('\t') < 0 && text.replace(/\r?\n$/, '').indexOf('\n') < 0)) return;   // ค่าเดียว = วางในช่องตามปกติ
    e.preventDefault();
    pasteInto(el, text);
  });

  window.BookMaster = {
    render: render,
    paste: paste,
    /** เปิดหน้า: ดึงตารางใหม่จากฐาน (คนอื่นเพิ่งบันทึก) แล้ววาดใหม่ */
    opened: function () {
      S.msg = null;
      FIRE.sync().then(function () { if (on()) render(); }).catch(function () {});
    },
  };
})();
