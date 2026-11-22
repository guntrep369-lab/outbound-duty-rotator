/**
 * book-master.js — หน้า 🗂 ข้อมูลหลัก ของแอปสมุดสต๊อก (ระบบใหม่เท่านั้น)
 *
 *   แท็บ Location · SKU · กลุ่มสินค้า (ขั้น ก) · แปลงสินค้า · Supplier (PO) · SKU : Pallet (ขั้น ข) · โซนแร็ค (ขั้น ค)
 *   = ตารางเดียวแก้ได้แบบ Excel (หัวหน้า) · คนอื่นดูอย่างเดียว
 *   โซนแร็ค: ช่องว่างต่อโซน · 🎯 ลองเลือกแร็ค (SKU + ชิ้น → ช่องต่อพาเลท จากร่างทุกตาราง) · 🗺️ ผังแร็ค สีตามโซน
 *   📂 นำเข้าไฟล์ / ลากไฟล์มาวาง: ชีต PO. Truck · MASTER แปลงสินค้า · ความจุต่อพาเลท แทนตารางในร่าง (ตรวจก่อนบันทึก)
 *   ชิปกรอง + ช่องค้น · ⚠ เตือนรายแถว (แดง = บันทึกไม่ได้) · พบในสมุดแต่ยังไม่มีในตาราง → + เพิ่มทั้งหมด
 *   ⚡ สร้างหลายช่อง (แร็ค R) · Ctrl+V วางจาก Excel (ในช่อง = ทับจากช่องนั้นลงไป · นอกช่อง = เพิ่ม / อัปเดตตามรหัส)
 *   📋 คัดลอกไป Excel · ใบที่ไม่มีในตาราง: เตือน | ห้ามบันทึก (ต่อตาราง) · 🕘 ประวัติ
 *   ร่างค้างในเครื่องนี้จนกด 💾 บันทึก หรือ ยกเลิกที่แก้ · บันทึกทั้งตาราง (BookFire.setupSave → master/{kind})
 * ตรรกะอยู่ใน wms-fire-setup.js · ใช้ตัวแปรของสคริปต์ในหน้า (FIRE USER MODE esc f isHead copyText xlsxLib) ตอนถูกเรียกเท่านั้น
 * เปิดเป็น window.BookMaster
 */
(function () {
  'use strict';

  if (!window.BookFire) { window.BookMaster = null; return; }

  var STEP = 300;                         // แถวที่วาดต่อครั้ง (กด แสดงเพิ่ม)
  var DRAFT_KEY = 'wms:book:master:';     // + kind (+ :ns ของโหมดซ้อม / ทดลอง)
  var KIND_KEY = 'wms:book:master:kind';
  var KINDS = [['loc', 'Location'], ['sku', 'SKU'], ['grp', 'กลุ่มสินค้า'], ['conv', 'แปลงสินค้า'], ['sup', 'Supplier'], ['cap', 'SKU : Pallet'], ['zone', 'โซนแร็ค']];
  var IMP = { conv: 1, sup: 1, cap: 1 };   // ตารางหลักเดิม (นำเข้าไฟล์ได้ ไม่มีสวิตช์ห้าม)
  var CHIPS = {
    loc: [['all', 'ทั้งหมด'], ['R', 'แร็ค R'], ['F', 'พื้น A–D'], ['S', 'ชั้นวาง S'], ['X', 'อื่น ๆ'], ['off', 'ปิดใช้'], ['fix', '⚠ ต้องแก้']],
    sku: [['all', 'ทั้งหมด'], ['nogrp', 'ยังไม่มีกลุ่ม'], ['gift', 'ของแถม'], ['vac', 'สุญญากาศ'], ['off', 'ปิดใช้'], ['fix', '⚠ ต้องแก้']],
    grp: [],
    conv: [['all', 'ทั้งหมด'], ['fix', '⚠ ต้องแก้']],
    sup: [['all', 'ทั้งหมด'], ['stock', 'มีของ'], ['fix', '⚠ ต้องแก้']],
    cap: [['all', 'ทั้งหมด'], ['stock', 'มีของ'], ['fix', '⚠ ต้องแก้']],
    zone: [],
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
    conv: [
      { k: 'buy', t: 'SKU ตอนซื้อ', w: 16, up: 1 },
      { k: 'after', t: 'SKU หลังแปลง', w: 16, up: 1 },
    ],
    sup: [
      { k: 'po', t: 'PO', w: 14, up: 1 },
      { k: 'sup', t: 'Supplier', w: 26 },
    ],
    cap: [
      { k: 'sku', t: 'SKU', w: 12, up: 1 },
      { k: 'pid', t: 'Product ID', w: 18, up: 1 },
      { k: 'cap', t: 'ชิ้นต่อพาเลท', w: 6, num: 1 },
    ],
    zone: [
      { k: 'r1', t: 'แร็คจาก', w: 5, rack: 1 },
      { k: 'r2', t: 'แร็คถึง', w: 5, rack: 1 },
      { k: 'l1', t: 'ชั้นจาก', w: 3, num: 1 },
      { k: 'l2', t: 'ชั้นถึง', w: 3, num: 1 },
      { k: 'grp', t: 'โฟกัสกลุ่ม', sel: 'zgrp' },
      { k: 'note', t: 'หมายเหตุ', w: 22 },
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
      'ระบบเลือกแร็ค (แท็บ โซนแร็ค · ปุ่ม 🎯 ในแท็บรับของ) ใช้กติกาของกลุ่มนี้',
    conv: 'SKU ที่แปลงแล้ว (เช่นแพ็กใหม่) ผูกกลับไปที่ SKU ตอนซื้อ 1 ต่อ 1 · รายงาน LOT/PO, FIFO, กระทบยอด TRcloud ใช้ตารางนี้รวมยอด\n' +
      'แทนชีต MASTER แปลงสินค้า เดิม · นำเข้าไฟล์ได้ (📂) หรือวางจาก Excel: SKU ตอนซื้อ · SKU หลังแปลง',
    sup: 'PO ไหนมาจาก Supplier ไหน (แทนชีต PO. Truck) · รายงานและหน้าจัดที่เก็บใช้ดูว่า SKU หนึ่งเปิดกี่ Supplier\n' +
      'PO ที่ยังไม่ใส่ Supplier ไม่บันทึก · นำเข้าไฟล์ได้ (📂) หรือวางจาก Excel: PO · Supplier',
    cap: 'SKU หนึ่งวางได้กี่ชิ้นต่อพาเลท (แทนชีต ความจุต่อพาเลท) · หน้าจัดที่เก็บกับหน้า สินค้า / โล ใช้คิดจำนวนพาเลท\n' +
      'ช่องว่าง = ไม่บันทึกแถวนั้น · นำเข้าไฟล์ได้ (📂) หรือวางจาก Excel: SKU · Product ID · ชิ้นต่อพาเลท',
    zone: 'ช่วงแร็คที่โฟกัสกลุ่มสินค้า: ระบบเลือกช่องในโซนของกลุ่มให้ก่อน → ช่องที่ไม่อยู่ในโซนไหน → โซนกลุ่มอื่น (ไม่ได้ห้าม)\n' +
      'แร็คถึงว่าง = แร็คเดียว · ชั้นว่างทั้งสองช่อง = ทุกชั้น (ตามกติกาชั้นของกลุ่ม) · ทับกัน = แถวบนใช้ก่อน\n' +
      'ช่องว่าง = โล R ที่ใช้งานในตาราง Location และไม่มีของ · พาเลทเต็มตาม SKU : Pallet · เศษตามกลุ่ม (RIB / ช่องตัวเอง / พื้น)\n' +
      'วางจาก Excel ได้: แร็คจาก · แร็คถึง · ชั้นจาก · ชั้นถึง · กลุ่ม (ชื่อหรือรหัส) · หมายเหตุ',
  };

  var S = {
    kind: (function () { try { var k = localStorage.getItem(KIND_KEY); return /^(loc|sku|grp|conv|sup|cap|zone)$/.test(k || '') ? k : 'loc'; } catch (e) { return 'loc'; } })(),
    chip: 'all', q: '', more: STEP, msg: null, busy: false, hist: false, gen: null, showFound: false,
    pk: { sku: '', qty: '', over: true }, map: true,   // แท็บโซนแร็ค: 🎯 ลองเลือกแร็ค · 🗺️ ผังแร็ค
  };
  var D = {};                 // ร่างต่อตาราง { base, strict, rows, dirty, fresh: {รหัส: 1} แถวใหม่ }
  var GEN = { loc: 0, sku: 0, grp: 0, conv: 0, sup: 0, cap: 0, zone: 0 };   // เปลี่ยนทุกครั้งที่แก้ (ตรวจใหม่)
  var VAL = {};               // ผลตรวจที่เก็บไว้ { kind: { g, v } }
  var FOUND = {};             // พบในสมุด { kind: { key, list } }
  var VIS = [];               // ลำดับแถว (index ในร่าง) ที่แสดงอยู่
  var SAVE_T = {}, CHECK_T = null, TYPING = null;   // SAVE_T ต่อตาราง (นำเข้าไฟล์เปลี่ยนหลายตารางพร้อมกัน)
  var NAMES = null;           // ชื่อสินค้า { รหัส: ชื่อ } จากตาราง SKU (ร่าง) + เอกสารในสมุด

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
    clearTimeout(SAVE_T[kind]);
    SAVE_T[kind] = setTimeout(function () {
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

  function hasStrict(kind) { return kind === 'loc' || kind === 'sku'; }
  /** แถวที่จะส่งไปบันทึก (ตัดแถวว่าง) · kept = เฉพาะที่จะเก็บจริง (Supplier / ความจุ ที่ยังไม่ใส่ ไม่เก็บ) */
  function sendRows(kind, rows, kept) {
    return rows.filter(function (r) {
      if (kind === 'zone') return !X().isBlank(kind, r);
      if (!IMP[kind]) return X().keyOf(kind, r) || (kind === 'grp' && txt(r.name));
      if (X().isBlank(kind, r)) return false;
      if (kept && kind === 'sup') return !!X().keyOf(kind, r) && !!txt(r.sup);
      if (kept && kind === 'cap') return !!X().keyOf(kind, r) && txt(r.cap) !== '';
      return true;
    });
  }
  /** ที่เปลี่ยนจากตารางที่บันทึก { n, text, strict } */
  function changes(kind) {
    var d = draft(kind), t = table(kind);
    if (!d.dirty) return { n: 0, text: '' };
    var dd = X().diff(kind, t.rows, sendRows(kind, d.rows, true));
    var st = hasStrict(kind) && !!d.strict !== !!t.strict;
    return { n: dd.add + dd.chg + dd.del + (st ? 1 : 0), text: [dd.text, st ? (d.strict ? 'ห้ามบันทึกใบที่ไม่มีในตาราง' : 'เตือนอย่างเดียว') : ''].filter(Boolean).join(' · ') };
  }

  /** ตารางสำหรับตรวจ (ใช้ร่างของกลุ่ม / SKU / Location ที่กำลังแก้) */
  function checkTables() {
    return { grp: { rows: draft('grp').rows }, sku: { saved: draft('sku').rows.length > 0, rows: draft('sku').rows }, loc: { rows: draft('loc').rows } };
  }
  /** ตารางทั้งหมดจากร่าง (ลองเลือกแร็คก่อนบันทึก) */
  function draftTables() {
    var t = {};
    ['loc', 'sku', 'grp', 'cap', 'zone'].forEach(function (k) { t[k] = { rows: draft(k).rows }; });
    return t;
  }
  function val(kind) {
    var c = VAL[kind], g = KINDS.map(function (k) { return GEN[k[0]]; }).join('|'), st = FIRE.setupStock();
    if (c && c.g === g && c.d === draft(kind) && c.st === st) return c.v;
    var v = X().validate(kind, draft(kind).rows, checkTables(), st);
    VAL[kind] = { g: g, d: draft(kind), st: st, v: v };
    return v;
  }
  function found(kind) {
    if (kind === 'grp' || kind === 'conv' || kind === 'zone') return [];
    var key = GEN[kind] + '|' + draft(kind).rows.length + (kind === 'cap' ? '|' + GEN.sku : ''), st = FIRE.setupStock();
    var c = FOUND[kind];
    if (c && c.key === key && c.st === st) return c.list;
    var list = FIRE.setupFound(kind, draft(kind).rows, kind === 'cap' ? draft('sku').rows : null);
    FOUND[kind] = { key: key, st: st, list: list };
    return list;
  }
  function stockOf(kind, r) {
    var st = FIRE.setupStock();
    if (kind === 'loc') return st.loc[up(r.code)] || 0;
    if (kind === 'sku') return st.sku[up(r.long)] || st.sku[up(r.sku)] || 0;
    if (kind === 'cap') return st.sku[up(r.pid)] || st.sku[up(r.sku)] || 0;
    if (kind === 'sup') return (st.po && st.po[up(r.po)]) || 0;
    if (kind === 'conv') return st.sku[up(r.after)] || 0;
    return 0;
  }
  /** ชื่อสินค้าของรหัส (ตาราง SKU ที่กำลังแก้ก่อน แล้วชื่อในเอกสาร) */
  function nameOf(code) {
    var g = GEN.sku, base = FIRE.setupNames ? FIRE.setupNames() : {};
    if (!NAMES || NAMES.g !== g || NAMES.base !== base) {
      var m = {};
      Object.keys(base).forEach(function (k) { m[k] = base[k]; });
      draft('sku').rows.forEach(function (x) { if (x.name) { if (x.sku) m[up(x.sku)] = x.name; if (x.long) m[up(x.long)] = x.name; } });
      NAMES = { g: g, base: base, m: m };
    }
    return NAMES.m[up(code)] || '';
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
    } else if (kind === 'sup' || kind === 'cap') {
      if (stockOf(kind, r) > 0) out.stock = 1;
    }
    if (r.on === false) out.off = 1;
    if (w && w.some(function (x) { return x.lv === 'red' || x.lv === 'warn'; })) out.fix = 1;
    return out;
  }
  function hit(kind, r, q) {
    if (!q) return true;
    var hay = (kind === 'loc' ? [r.code, r.note] : kind === 'sku' ? [r.sku, r.long, r.name]
      : kind === 'conv' ? [r.buy, r.after, nameOf(r.buy), nameOf(r.after)] : kind === 'sup' ? [r.po, r.sup]
        : kind === 'cap' ? [r.sku, r.pid, nameOf(r.pid) || nameOf(r.sku)] : [r.name, r.note, r.rest]).join(' ').toUpperCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  /* ── วาด ───────────────────────────────────────────────────────────── */

  function render() {
    if (!X()) { $('body').innerHTML = '<div class="tx-empty">กำลังเปิด…</div>'; return; }
    var a = document.activeElement, keepF = a && a.dataset && a.dataset.mf !== undefined && a.closest && a.closest('#mdTbl')
      ? { i: a.dataset.mi, k: a.dataset.mf, s: a.selectionStart, e: a.selectionEnd } : null;
    var keepQ = a && /^(mdQ|mdPkS|mdPkQ)$/.test(a.id) ? { id: a.id, s: a.selectionStart } : null;
    renderTop();
    renderSum();
    renderAct();
    renderBody();
    $('docs').innerHTML = '';
    if (keepQ && $(keepQ.id)) { $(keepQ.id).focus(); try { $(keepQ.id).setSelectionRange(keepQ.s, keepQ.s); } catch (e) {} }
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
      : S.kind === 'grp' ? 'ใช้ค่าเริ่ม ยังไม่บันทึก' : IMP[S.kind] ? 'ยังไม่ได้นำเข้า' : 'ยังไม่ได้ตั้ง';
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">ข้อมูลหลัก</span><span class="md-tabs" role="tablist">' + tabs + '</span>' +
      '<button type="button" class="g-tip" aria-label="คำอธิบาย" title="' + esc(TIP[S.kind]) + '">ⓘ</button>' +
      '<span class="sp"></span><span class="c-sub md-info">' + info + '</span>' +
      (t.hist.length ? '<button type="button" class="tx-opt md-sm' + (S.hist ? ' on' : '') + '" id="mdHist">🕘 ประวัติ ' + f(t.hist.length) + '</button>' : '') +
      '</div>' + (d.dirty && d.base !== t.ver ? conflictHtml(t) : '');
    /* จอแคบ แท็บเลื่อนข้างได้: ให้แท็บที่เปิดอยู่เห็นเสมอ */
    var box = document.querySelector('.md-tabs'), cur = box && box.querySelector('.md-tab.on');
    if (box && cur && box.scrollWidth > box.clientWidth) {
      var br = box.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      if (cr.left < br.left || cr.right > br.right) box.scrollLeft += cr.left - br.left - 8;
    }
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
      html += '<span class="c-sub">' + f(rows.length) + (kind === 'zone' ? ' โซน' : ' กลุ่ม') + '</span>';
    }
    if (kind !== 'grp' && kind !== 'zone') {
      html += '<input class="bk-field md-q" id="mdQ" type="search" autocomplete="off" spellcheck="false" aria-label="ค้นหา" placeholder="ค้น ' +
        (kind === 'loc' ? 'Location · หมายเหตุ' : kind === 'sup' ? 'PO · Supplier' : 'SKU · ชื่อ') + '" value="' + esc(S.q) + '">';
    }
    $('sum').innerHTML = html;
  }

  function renderAct() {
    var kind = S.kind, d = draft(kind), v = val(kind), ch = changes(kind), edit = canEdit();
    var html = '';
    if (edit) {
      html += '<button type="button" class="tx-opt" id="mdAdd">+ แถว</button>';
      if (kind === 'loc') html += '<button type="button" class="tx-opt' + (S.gen ? ' on' : '') + '" id="mdGen">⚡ สร้างหลายช่อง</button>';
      if (IMP[kind]) {
        html += '<button type="button" class="tx-opt" id="mdPick" title="' + esc('ไฟล์ Excel ที่มีชีต PO. Truck · MASTER แปลงสินค้า · ความจุต่อพาเลท (ชีตไหนมี ตารางนั้นเปลี่ยน)\nแทนตารางในร่างทั้งตาราง · ตรวจแล้วกด 💾 บันทึก · ลากไฟล์มาวางก็ได้') + '">📂 นำเข้าไฟล์</button>' +
          '<input type="file" class="bk-file" id="mdFile" accept=".xlsx,.xls,.csv" multiple hidden>';
      }
      html += '<button type="button" class="g-tip md-paste" title="' + esc('Ctrl+V ตรงไหนก็ได้ (ไม่อยู่ในช่อง) = เพิ่มแถว / อัปเดตแถวที่รหัสตรง\nวางในช่อง = ทับจากช่องนั้นลงไปแบบ Excel') + '" aria-label="วิธีวาง">📋</button>';
    }
    if (kind === 'zone') html += '<button type="button" class="tx-opt' + (S.map ? ' on' : '') + '" id="mdMap">🗺️ ผังแร็ค</button>';
    html += '<button type="button" class="tx-opt" id="mdCopy">คัดลอกไป Excel</button>';
    if (hasStrict(kind)) {
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
      var head = kind === 'sup' ? 'PO ในสมุด <b>' + f(fd.length) + ' PO</b> ยังไม่มี Supplier'
        : kind === 'cap' ? 'SKU <b>' + f(fd.length) + ' ตัว</b> ยังไม่มีชิ้นต่อพาเลท'
          : 'พบในสมุด <b>' + f(fd.length) + ' ' + (kind === 'loc' ? 'โล' : 'SKU') + '</b> ที่ยังไม่มีในตาราง';
      html += '<div class="bk-warn md-found">' + head +
        (canEdit() ? ' <button type="button" class="tx-opt md-sm" id="mdFoundAdd">+ เพิ่มทั้งหมด</button>' : '') +
        ' <button type="button" class="bk-link" id="mdFoundShow">' + (S.showFound ? 'ซ่อน' : 'ดูรายชื่อ') + '</button>' +
        (S.showFound ? '<div class="md-fl">' + fd.slice(0, 60).map(function (x) {
          return '<span>' + esc(x.code || x.po || x.sku || x.long) + (x.name ? ' <i>' + esc(x.name) + '</i>' : '') + (x.qty ? ' · ' + f(x.qty) : '') + '</span>';
        }).join('') + (fd.length > 60 ? '<span>… อีก ' + f(fd.length - 60) + '</span>' : '') + '</div>' : '') + '</div>';
    }
    html += tableHtml();
    if (kind === 'zone') html += zoneHtml();
    $('body').innerHTML = html;
    if (kind === 'zone') drawZone();
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
      var opts = c.sel === 'grp' || c.sel === 'zgrp'
        ? [['', '—']].concat(draft('grp').rows.filter(function (g) { return g.id && (c.sel === 'grp' || g.rack !== 'no'); }).map(function (g) { return [g.id, g.name || g.id]; }))
        : c.sel === 'rack' ? [['yes', 'ขึ้นได้'], ['no', 'ไม่ขึ้น']]
          : c.sel === 'lv' ? [['', '—']].concat(X().LV)
            : [['', '—']].concat(X().REST.map(function (x) { return [x, x]; }));
      var cur = txt(r[c.k]), gz = c.sel === 'zgrp' ? grpOf(cur) : null;
      if (cur && !opts.some(function (o) { return o[0] === cur; })) opts.push([cur, cur + (gz ? ' (ไม่ขึ้นแร็ค)' : ' (ไม่มีแล้ว)')]);
      return '<td class="g-in"' + (gz ? ' style="box-shadow:inset 4px 0 0 ' + colorOf(gz.c) + '"' : '') + '><select' + at + ' aria-label="' + esc(c.t) + '">' + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></td>';
    }
    return '<td class="g-in' + (c.num ? ' num' : '') + (c.up || c.rack ? ' md-mono' : '') + '"><input' + at.replace(' disabled', ' readonly') + ' size="' + c.w + '" maxlength="' + (c.k === 'name' || c.k === 'note' ? 120 : 40) +
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
  function palOf(r) {
    var qc = stockOf('cap', r), cap = X().isNum(r.cap) ? +txt(r.cap).replace(/,/g, '') : 0;
    return qc && cap > 0 ? f(Math.ceil(qc / cap)) : '';
  }
  /* ── โซนแร็ค: ช่องว่างต่อโซน · 🎯 ลองเลือกแร็ค · 🗺️ ผังแร็ค (ใช้ร่างทุกตาราง ยังไม่บันทึกก็ลองได้) ── */

  var TIP_PK = 'ระบบเลือกตามร่างตอนนี้ของทุกแท็บ (ยังไม่บันทึกก็ลองได้)\n' +
    'กลุ่มของ SKU → ชั้นแร็ค · SKU : Pallet → พาเลทเต็ม + เศษ · โซนแร็ค → ลำดับช่อง (โซนตัวเอง → ไม่ระบุกลุ่ม → โซนอื่น)\n' +
    'ช่องว่าง = โล R ในตาราง Location ที่ใช้งาน และไม่มีของในสมุด\n' +
    'เศษตามกลุ่ม: RIB · ช่องของตัวเอง (แร็คเต็มลงพื้น A–C) · พื้น A–C · พื้น D · พื้นรวมกองเดิมได้เมื่อ SKU LOT PO เดียวกัน\n' +
    'แท็บ รับของ กด 🎯 เลือกโลให้ = ใช้ตารางที่บันทึกแล้ว';
  var ZP = null;              // ตัวเลือกแร็คจากร่าง (นับช่องว่างต่อโซน) { g, occ, P }
  function grpOf(id) { return id ? draft('grp').rows.filter(function (g) { return g.id === id; })[0] || null : null; }
  function colorOf(c) { return /^#[0-9a-f]{3,8}$/i.test(txt(c)) ? txt(c) : '#94A3B8'; }
  function zp() {
    var ks = ['loc', 'sku', 'grp', 'cap', 'zone'], ds = ks.map(draft), g = ks.map(function (k) { return GEN[k]; }).join('|'), occ = FIRE.setupOcc();
    if (!ZP || ZP.g !== g || ZP.occ !== occ || ds.some(function (d, i) { return ZP.ds[i] !== d; })) ZP = { g: g, ds: ds, occ: occ, P: FIRE.setupPicker(draftTables(), {}) };
    return ZP.P;
  }
  function slotText(r) {
    var P = zp(), s = X().span(r), g = grpOf(r.grp), all = 0, free = 0;
    if (!P || !s.ok) return '';
    P.slots.forEach(function (x) {
      if (x.k.rack < s.r1 || x.k.rack > s.r2 || x.k.lv < s.l1 || x.k.lv > s.l2 || (g && !X().lvOk(g.lv, x.k.lv))) return;
      all++;
      if (!(P.occ[x.code] && P.occ[x.code].q > 1e-9)) free++;
    });
    return all ? f(free) + ' / ' + f(all) : '<span class="c-sub">—</span>';
  }
  function zoneHtml() {
    var p = S.pk;
    var opts = draft('sku').rows.filter(function (s) { return s.sku || s.long; }).slice(0, 3000).map(function (s) {
      return '<option value="' + esc(s.sku || s.long) + '">' + esc(s.name || s.long || '') + '</option>';
    }).join('');
    return '<div class="md-zone" id="mdZone"><div class="md-pk"><b>🎯 ลองเลือกแร็ค</b>' +
      '<label>SKU <input class="bk-field md-pks" id="mdPkS" list="mdPkL" maxlength="40" autocomplete="off" spellcheck="false" value="' + esc(p.sku) + '"></label>' +
      '<label>รับเข้า <input class="bk-field md-n" id="mdPkQ" inputmode="numeric" maxlength="8" placeholder="ชิ้น" value="' + esc(p.qty) + '"></label>' +
      '<label class="md-ckl"><input type="checkbox" id="mdPkO"' + (p.over ? ' checked' : '') + '> ล้นไปโซนกลุ่มอื่นได้</label>' +
      '<button type="button" class="g-tip" aria-label="คำอธิบาย" title="' + esc(TIP_PK) + '">ⓘ</button>' +
      '<datalist id="mdPkL">' + opts + '</datalist></div><div id="mdPkR"></div><div id="mdMapBox"></div></div>';
  }
  /** ผลลองเลือก + ผังแร็ค (วาดใหม่เฉพาะสองส่วนนี้ ช่องที่พิมพ์ไม่หลุด) */
  function drawZone() {
    if (S.kind !== 'zone' || !$('mdZone')) return;
    var p = S.pk, P = FIRE.setupPicker(draftTables(), { over: p.over }), res = null, picks = {};
    if (!P) return;
    if (txt(p.sku) || txt(p.qty)) res = X().pick(P, { sku: p.sku, qty: p.qty });
    if (res && res.lines) res.lines.forEach(function (l) { if (typeof l.tag === 'number') picks[l.loc] = l.tag; });
    $('mdPkR').innerHTML = pickHtml(res);
    $('mdMapBox').innerHTML = S.map ? mapHtml(P, picks) : '';
  }
  function pickHtml(res) {
    if (!res) return '<div class="c-sub md-pkh">ใส่ SKU กับจำนวนที่รับเข้า ระบบบอกว่าวางช่องไหน (ตามร่างตอนนี้)</div>';
    if (res.err) return '<div class="bk-warn md-pkh">⚠ ' + esc(res.err) + '</div>';
    var g = res.g;
    var tag = function (t) {
      return typeof t === 'number' ? '<span class="md-tag">' + t + '</span>' : t === 'rib' ? '<span class="md-tag rib">RIB</span>'
        : t === 'man' ? '<span class="md-tag man">!</span>' : '<span class="md-tag flo">พื้น</span>';
    };
    return '<div class="md-pkr"><div class="md-pks2"><span class="md-gc" style="--c:' + colorOf(g.c) + '">' + esc(g.name) + '</span> ' +
      (res.pcs ? f(res.pcs) + ' ชิ้น/พาเลท → เต็ม <b>' + f(res.full) + '</b> พาเลท' + (res.rem ? ' + เศษ <b>' + f(res.rem) + '</b> ชิ้น' : '') : 'ไม่ขึ้นแร็ค') + '</div>' +
      '<table class="md-pt"><thead><tr><th></th><th>ไปที่</th><th class="num">ชิ้น</th><th>เหตุผล</th></tr></thead><tbody>' +
      res.lines.map(function (l) {
        return '<tr><td>' + tag(l.tag) + '</td><td class="md-l">' + (l.loc ? esc(l.loc) : '<span class="c-sub">—</span>') + '</td><td class="num">' + f(l.qty) + '</td><td class="c-sub">' + esc(l.why) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function mapHtml(P, picks) {
    var head = '<div class="md-mapt"><b>🗺️ ผังแร็ค</b> <span class="c-sub">สีตามโซน · สี่เหลี่ยมเล็ก = ช่อง (ทึบ = มีของ)</span></div>';
    if (!P.slots.length) return '<div class="md-mapc">' + head + '<div class="tx-empty">ยังไม่มี Location แร็ค R ที่ใช้งาน · ตั้งในแท็บ Location (⚡ สร้างหลายช่อง)</div></div>';
    var racks = [], lvs = [], by = {};
    P.slots.forEach(function (x) {
      var k = x.k.rack + '|' + x.k.lv;
      if (racks.indexOf(x.k.rack) < 0) racks.push(x.k.rack);
      if (lvs.indexOf(x.k.lv) < 0) lvs.push(x.k.lv);
      (by[k] || (by[k] = [])).push(x);
    });
    racks.sort(function (a, b) { return a - b; });
    lvs.sort(function (a, b) { return b - a; });
    var full = function (x) { var o = P.occ[x.code]; return !!(o && o.q > 1e-9); };
    var h = '<div class="md-mapw"><div class="md-map" style="grid-template-columns:48px repeat(' + racks.length + ',max-content)"><div></div>' +
      racks.map(function (rk) { return '<div class="md-mh">R' + pad(rk, 2) + '</div>'; }).join('');
    lvs.forEach(function (lv) {
      h += '<div class="md-ml">ชั้น ' + lv + '</div>';
      racks.forEach(function (rk) {
        var cell = by[rk + '|' + lv];
        if (!cell) { h += '<div class="md-mc none"></div>'; return; }
        var g = cell[0].z ? cell[0].z.g : null, free = cell.filter(function (x) { return !full(x); }).length;
        h += '<div class="md-mc' + (g ? '' : ' nz') + '" style="--c:' + (g ? colorOf(g.c) : '#94A3B8') + '" title="' +
          esc('R' + pad(rk, 2) + ' ชั้น ' + lv + ' · ' + (g ? g.name : 'ไม่ระบุกลุ่ม') + ' · ว่าง ' + free + '/' + cell.length) + '">' +
          '<div class="md-mt"><span>' + esc(g ? g.name : 'ไม่ระบุ') + '</span><span class="md-mf">' + free + '/' + cell.length + '</span></div><div class="md-bays">' +
          cell.map(function (x) {
            var o = P.occ[x.code], pk = picks[x.code];
            var what = full(x) ? o.piles.map(function (q) { return q.sku || q.long; }).filter(function (v, j, a) { return a.indexOf(v) === j; }).join(', ') + ' ' + f(o.q) : 'ว่าง';
            return '<i class="' + (pk ? 'pk' : full(x) ? 'oc' : '') + '" title="' + esc(x.code + ' · ' + what) + '">' + (pk || '') + '</i>';
          }).join('') + '</div></div>';
      });
    });
    h += '</div></div>';
    var lg = draft('grp').rows.filter(function (g) { return g.id && g.rack !== 'no'; }).map(function (g) {
      return '<span class="md-gc" style="--c:' + colorOf(g.c) + '">' + esc(g.name || g.id) + '</span>';
    }).join('') + '<span class="md-gc nz">ไม่ระบุ</span><span class="md-lgi"><i class="oc"></i>มีของ</span><span class="md-lgi"><i></i>ว่าง</span>' +
      (Object.keys(picks).length ? '<span class="md-lgi"><i class="pk">1</i>ระบบเลือก</span>' : '');
    return '<div class="md-mapc">' + head + h + '<div class="md-lg">' + lg + '</div></div>';
  }

  function extraHtml(kind, r, cnt, i) {
    if (kind === 'conv') {
      var nm = nameOf(r.after) || nameOf(r.buy), qa = stockOf(kind, r);
      return '<td class="c-nm md-nm" title="' + esc(nm) + '">' + esc(nm) + '</td><td class="num">' + (qa ? f(qa) : '') + '</td>';
    }
    if (kind === 'sup') { var qp = stockOf(kind, r); return '<td class="num">' + (qp ? f(qp) : '') + '</td>'; }
    if (kind === 'cap') {
      var nc = nameOf(r.pid) || nameOf(r.sku), qc = stockOf(kind, r);
      return '<td class="c-nm md-nm" title="' + esc(nc) + '">' + esc(nc) + '</td><td class="num">' + (qc ? f(qc) : '') + '</td>' +
        '<td class="num" id="mp-' + i + '">' + palOf(r) + '</td>';
    }
    if (kind === 'loc') {
      var k = X().locKind(r.code), q = stockOf(kind, r);
      var label = !k ? '?' : k.t === 'R' ? 'แร็ค ชั้น ' + k.lv : k.t === 'F' ? 'พื้น ' + k.zone : k.t === 'S' ? 'ชั้นวาง' : 'พิเศษ';
      return '<td class="c-sub">' + label + '</td><td class="num">' + (q ? f(q) : '') + '</td>';
    }
    if (kind === 'sku') { var s = stockOf(kind, r); return '<td class="num">' + (s ? f(s) : '') + '</td>'; }
    if (kind === 'zone') return '<td class="num" id="mz-' + i + '">' + slotText(r) + '</td>';
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
      if (kind === 'zone') {
        return '<div class="tx-empty">ยังไม่มีโซนแร็ค · ไม่ตั้งก็ได้ ระบบเลือกช่องตามกติกาชั้นของกลุ่มอย่างเดียว' +
          (edit ? '<br>กด <b>+ แถว</b> หรือวางจาก Excel (Ctrl+V): แร็คจาก · แร็คถึง · ชั้นจาก · ชั้นถึง · กลุ่ม · หมายเหตุ' : '') + '</div>';
      }
      if (IMP[kind]) {
        var none = kind === 'conv' ? 'ยังไม่มีคู่แปลงสินค้า' : kind === 'sup' ? 'ยังไม่มี PO → Supplier' : 'ยังไม่มีชิ้นต่อพาเลท';
        var sheet = X().SHEET[kind];
        return '<div class="tx-empty">' + none + (edit ? '<br>กด <b>📂 นำเข้าไฟล์</b> (ชีต ' + esc(sheet) + ') หรือลากไฟล์มาวาง · วางจาก Excel (Ctrl+V)' +
          (kind !== 'conv' ? ' · หรือ <b>+ เพิ่มทั้งหมด</b> ด้านบน' : '') : '') + '</div>';
      }
      return '<div class="tx-empty">' + (kind === 'loc' ? 'ยังไม่มี Location' : 'ยังไม่มี SKU') + (edit ? '<br>กด <b>+ เพิ่มทั้งหมด</b> (ด้านบน) เพื่อเติมจากสมุด · วางจาก Excel (Ctrl+V)' + (kind === 'loc' ? ' · หรือ <b>⚡ สร้างหลายช่อง</b>' : '') : '') + '</div>';
    }
    if (!VIS.length) return '<div class="tx-empty">ไม่มีแถวที่ตรงกับที่เลือก</div>';
    var cols = COLS[kind];
    var extra = kind === 'loc' ? '<th>ชนิด</th><th class="num">ของตอนนี้</th>' : kind === 'sku' || kind === 'sup' ? '<th class="num">ของตอนนี้</th>'
      : kind === 'conv' ? '<th>ชื่อสินค้า</th><th class="num" title="ของตอนนี้ของ SKU หลังแปลง">ของ (หลังแปลง)</th>'
        : kind === 'cap' ? '<th>ชื่อสินค้า</th><th class="num">ของตอนนี้</th><th class="num" title="ของตอนนี้ ÷ ชิ้นต่อพาเลท ปัดขึ้น">≈ พาเลท</th>'
          : kind === 'zone' ? '<th class="num" title="ช่อง R ในช่วงนี้ที่ไม่มีของ / ทั้งหมด (ตาราง Location ที่ใช้งาน)">ช่องว่าง</th>' : '<th class="num">SKU</th>';
    var html = '<div class="bk-wrap md-wrap"><table class="bk-xl g-xl md-xl" id="mdTbl"><thead><tr><th class="c-no">#</th>' +
      cols.map(function (c) { return '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.t) + '</th>'; }).join('') + extra + '<th>⚠</th>' + (edit ? '<th class="c-act"></th>' : '') + '</tr></thead><tbody>';
    VIS.slice(0, S.more).forEach(function (i, n) {
      var r = d.rows[i], w = v.rows[i], k = X().keyOf(kind, r);
      var lock = edit && (kind === 'grp' ? cnt[r.id] > 0 : !IMP[kind] && stockOf(kind, r) > 0);
      html += '<tr class="' + rowCls(w) + (d.fresh[k] || r._new ? ' md-new' : '') + '" data-row="' + i + '"><td class="c-no">' + (n + 1) + '</td>' +
        cols.map(function (c) { return cellHtml(kind, c, r, i, edit); }).join('') + extraHtml(kind, r, cnt, i) +
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
      if (kind === 'cap' && $('mp-' + i)) $('mp-' + i).innerHTML = palOf(draft(kind).rows[i]);
      if (kind === 'zone' && $('mz-' + i)) $('mz-' + i).innerHTML = slotText(draft(kind).rows[i]);
      var tr = cell.parentNode;
      tr.classList.remove('r-bad', 'r-warn');
      var c = rowCls(v.rows[i]);
      if (c) tr.classList.add(c);
    });
    if (!(document.activeElement && document.activeElement.id === 'mdQ')) renderSum();
    renderAct();
    renderTop();
    if (kind === 'zone') drawZone();
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
    if (c.rack) return X().rackText(s);
    if (c.up) return u;
    if (c.sel === 'grp' || c.sel === 'zgrp') {
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
  var HEAD_RE = /^(LOCATION|โล|SKU|รหัส|กลุ่ม|ชื่อกลุ่ม|แร็ค)|^(PO\.?|PO\s*NO\.?|เลข\s*PO|TRUCK|SUPPLIER|PRODUCT\s*ID)$/i;

  /** วางตารางหลักที่มีหัวตาราง (เช่นคัดลอกทั้งชีต PO. Truck): อ่านตามหัวแบบนำเข้าไฟล์ → แถว | null */
  function parsedPaste(kind, g) {
    var T = window.WmsFireTrc;
    if (!IMP[kind] || !T || !g.length || !HEAD_RE.test(txt(g[0][0])) && !g[0].some(function (v) { return /truck|supplier|std|pallet|ซื้อ/i.test(txt(v)); })) return null;
    var p = T.readSheets([{ name: X().SHEET[kind], grid: g }]);
    return p && !p.error && p[kind] ? X().fromParsed(kind, p[kind]) : null;
  }

  /** วางนอกช่อง: รหัสที่มีแล้ว = อัปเดตช่องที่วางมา (ไม่ว่าง) · ไม่มี = เพิ่มแถวบนสุด */
  function paste(text) {
    if (!on()) return;
    if (!canEdit()) { S.msg = { kind: 'warn', html: 'แก้ข้อมูลหลักได้เฉพาะหัวหน้า' }; renderAct(); return; }
    var kind = S.kind, g = gridOf(text), cols = pasteCols(kind);
    var pre = parsedPaste(kind, g);
    if (pre) {
      /* อ่านตามหัวตารางแล้ว: เป็นแถวของช่องตามลำดับ cols */
      g = pre.map(function (r) { return cols.map(function (c) { return r[c.k]; }); });
    } else if (g.length && HEAD_RE.test(txt(g[0][0]))) g.shift();
    if (!g.length) return;
    var d = draft(kind), by = {}, add = [], upd = 0;
    d.rows.forEach(function (r, i) { var k = X().keyOf(kind, r) || (kind === 'grp' ? up(r.name) : ''); if (k) by[k] = i; if (kind === 'grp' && up(r.name)) by[up(r.name)] = i; });
    g.forEach(function (cells) {
      var r = newRow(kind);
      cols.forEach(function (c, j) { if (j < cells.length) r[c.k] = parseCell(kind, c, cells[j]); });
      var k = kind === 'grp' ? up(r.name) : X().keyOf(kind, r);
      if (!k) { if (kind === 'zone' && !X().isBlank(kind, r)) add.push(r); return; }   // ช่วงอ่านไม่ออก = เข้าเป็นแถวแดง ไม่หายเงียบ
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
    if (add.length) addRows(kind, add, kind !== 'zone'); else if (upd) touch(kind);
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
      else if (kind === 'sup') r.po = x.po;
      else if (kind === 'cap') { r.sku = x.sku || x.pid; r.pid = x.pid && x.pid !== r.sku ? x.pid : ''; }
      else { r.sku = x.sku || x.long; r.long = x.long || ''; r.name = x.name || ''; r.grp = guess(r); r.gift = r.grp === 'gf'; }
      return r;
    });
    addRows(kind, rows, true);
    S.chip = 'all'; S.q = ''; S.showFound = false;
    var next = kind === 'sup' ? ' · ใส่ Supplier (แถวที่ยังว่างไม่บันทึก)' : kind === 'cap' ? ' · ใส่ชิ้นต่อพาเลท (แถวที่ยังว่างไม่บันทึก)' : kind === 'sku' ? ' · กลุ่มเดาจากชื่อ ช่วยตรวจ' : '';
    S.msg = { kind: 'ok', html: 'เพิ่ม <b>' + f(rows.length) + '</b> แถวจากสมุด (แถบฟ้าด้านซ้าย)' + next + ' · ตรวจแล้วกด 💾 บันทึก' };
    render();
  }

  /* ── 📂 นำเข้าไฟล์ (ตารางหลักเดิม) ─────────────────────────────────── */

  function sheetsOf(XL, wb, file) {
    var base = file.name.replace(/\.[^.]+$/, '');
    return wb.SheetNames.map(function (n) {
      var name = wb.SheetNames.length === 1 && /^(sheet\d*|แผ่นงาน\d*)$/i.test(n.trim()) ? base : n;
      return { name: name, grid: XL.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }) };
    });
  }
  async function readFiles(list) {
    if (!canEdit()) { S.msg = { kind: 'warn', html: 'แก้ข้อมูลหลักได้เฉพาะหัวหน้า' }; renderAct(); return; }
    S.msg = { kind: 'warn', html: 'กำลังอ่านไฟล์…' }; renderAct();
    try {
      var XL = await xlsxLib(), sheets = [];
      for (var i = 0; i < list.length; i++) {
        var wb = XL.read(await list[i].arrayBuffer(), { type: 'array', cellDates: false });
        sheets = sheets.concat(sheetsOf(XL, wb, list[i]));
      }
      take(window.WmsFireTrc.readSheets(sheets), list.map(function (x) { return x.name; }).join(', '));
    } catch (e) {
      S.msg = { kind: 'bad', html: 'อ่านไฟล์ไม่ได้: ' + esc(e && e.message || e) };
      render();
    }
  }
  /**
   * ไฟล์ที่อ่านแล้ว (WmsFireTrc.readSheets) → แทนร่างของตารางที่มีในไฟล์ (sup · conv · cap) ยังไม่บันทึก
   * ชีต Stock / WH-Loss / ราคาทุน = ยอด TRcloud ใช้หน้า TRcloud → นำเข้า
   */
  function take(p, files) {
    if (!canEdit()) { S.msg = { kind: 'warn', html: 'แก้ข้อมูลหลักได้เฉพาะหัวหน้า' }; render(); return; }
    if (!p || p.error) { S.msg = { kind: 'bad', html: esc(files || '') + ': ' + esc(p ? p.error : 'อ่านไฟล์ไม่ได้') }; render(); return; }
    var got = [];
    ['sup', 'conv', 'cap'].forEach(function (k) {
      var part = p[k];
      if (!part) return;
      var rows = X().fromParsed(k, part), d = draft(k), saved = {};
      table(k).rows.forEach(function (r) { var key = X().keyOf(k, r); if (key) saved[key] = 1; });
      d.rows = rows;
      d.fresh = {};
      rows.forEach(function (r) { var key = X().keyOf(k, r); if (key && !saved[key]) d.fresh[key] = 1; });
      touch(k);
      var dd = X().diff(k, table(k).rows, rows);
      var note = k === 'sup' && part.dup && part.dup.length ? 'PO ซ้ำต่าง Supplier ' + part.dup.length + ' (ใช้แถวแรก)'
        : part.blank ? (k === 'cap' ? 'ช่องความจุว่าง ' : 'แถวไม่ครบ ') + part.blank + ' (ข้าม)' : '';
      got.push({ k: k, n: rows.length, dd: dd, note: note });
    });
    var trc = p.stock || p.loss || p.cost;
    if (!got.length) {
      S.msg = trc ? { kind: 'warn', html: 'ไฟล์นี้เป็นยอด TRcloud (ชีต Stock / WH-Loss / ราคาทุน) · นำเข้าที่หน้า TRcloud → นำเข้า' }
        : { kind: 'bad', html: 'ไม่เจอชีต PO. Truck · MASTER แปลงสินค้า · ความจุต่อพาเลท' };
      render();
      return;
    }
    if (!got.some(function (x) { return x.k === S.kind; })) { S.kind = got[0].k; try { localStorage.setItem(KIND_KEY, S.kind); } catch (e) {} }
    S.chip = 'all'; S.q = ''; S.more = STEP; S.hist = false; S.showFound = false; S.gen = null;
    var unit = { sup: 'PO', conv: 'คู่', cap: 'SKU' };
    S.msg = { kind: 'ok', html: '📂 ' + esc(files || 'ไฟล์') + ' → ' + got.map(function (x) {
      var dd = [x.dd.add ? 'เพิ่ม ' + f(x.dd.add) : '', x.dd.chg ? 'แก้ ' + f(x.dd.chg) : '', x.dd.del ? 'ลบ ' + f(x.dd.del) : ''].filter(Boolean).join(' ');
      return '<b>' + esc(X().TAB[x.k]) + '</b> ' + f(x.n) + ' ' + unit[x.k] + (dd ? ' (' + dd + ')' : ' (เหมือนเดิม)') + (x.note ? ' · ' + esc(x.note) : '');
    }).join(' · ') + ' · แทนตารางเดิมในร่าง ยังไม่บันทึก · ตรวจแล้วกด 💾 บันทึก ทีละแท็บ' + (trc ? ' · ชีตยอด TRcloud ในไฟล์นี้นำเข้าที่หน้า TRcloud' : '') };
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
        if (c.sel === 'grp' || c.sel === 'zgrp') return gname[v] || v || '';
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
    var rows = sendRows(kind, d.rows, false);
    if (kind !== 'grp' && kind !== 'zone') rows = rows.slice().sort(function (a, b) { return String(X().keyOf(kind, a)).localeCompare(String(X().keyOf(kind, b)), 'en', { numeric: true }); });
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
      case 'mdAdd': {
        var low = S.kind === 'zone';   // แถวบนใช้ก่อน: โซนใหม่ต่อท้าย ไม่แซงโซนเดิม
        addRows(S.kind, [newRow(S.kind)], !low); S.chip = 'all'; S.q = ''; render();
        var first = document.querySelector('#mdTbl tbody tr' + (low ? ':last-child' : '') + ' input:not([type=checkbox]):not([type=color])');
        if (first) first.focus();
        return;
      }
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
      case 'mdMap': S.map = !S.map; renderAct(); drawZone(); return;
      case 'mdPick': if ($('mdFile')) $('mdFile').click(); return;
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
    if (el.id === 'mdPkS' || el.id === 'mdPkQ') {
      S.pk[el.id === 'mdPkS' ? 'sku' : 'qty'] = el.value;
      clearTimeout(TYPING);
      TYPING = setTimeout(drawZone, 160);
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
    if (el.id === 'mdFile') { if (el.files && el.files.length) readFiles(Array.prototype.slice.call(el.files)); el.value = ''; return; }
    if (el.id === 'mdPkO') { S.pk.over = el.checked; drawZone(); return; }
    if (!el.dataset || el.dataset.mf === undefined || !canEdit()) return;
    var kind = S.kind, c = COLS[kind].filter(function (x) { return x.k === el.dataset.mf; })[0];
    if (!c) return;
    var v = c.ck ? el.checked : c.rack ? X().rackText(el.value) : c.up ? up(el.value) : el.type === 'color' ? el.value : txt(el.value);
    if ((c.up || c.rack) && el.value !== v) el.value = v;
    setField(kind, +el.dataset.mi, c.k, v);
    if (kind === 'zone' && c.k === 'grp') { render(); return; }
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
    /** ลากไฟล์มาวางในหน้า ข้อมูลหลัก (หัวหน้า) */
    files: function (list) { if (on() && list && list.length) readFiles(list); },
    /** ไฟล์ที่อ่านแล้วจากหน้า TRcloud → นำเข้า (ส่งต่อมาตรวจที่นี่) */
    take: take,
    /** เปิดหน้า: ดึงตารางใหม่จากฐาน (คนอื่นเพิ่งบันทึก) แล้ววาดใหม่ */
    opened: function () {
      S.msg = null;
      FIRE.sync().then(function () { if (on()) render(); }).catch(function () {});
    },
  };
})();
