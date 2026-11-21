/**
 * @file wms-fire-setup.js — ระบบใหม่ ข้อมูลหลัก (ตรรกะล้วน ไม่แตะฐาน ไม่แตะหน้าจอ)
 *   ขั้น ก: Location · SKU · กลุ่มสินค้า · ขั้น ข: แปลงสินค้า · Supplier (PO) · SKU : Pallet (ตารางหลักที่เดิมนำเข้าในหน้า TRcloud)
 *
 * ที่เก็บ master/{kind} หัวหน้าแก้ทั้งตารางแล้วบันทึกทีละครั้ง (meta.mv +1 ทุกเครื่องดึงใหม่)
 *   {tab, cols, rows TSV, n, strict, ver, hist, by, name, at}
 *   loc  rows = [Location, จุ (พาเลท), ใช้งาน 1|0, หมายเหตุ]
 *   sku  rows = [SKU, SKU เต็ม, ชื่อสินค้า, รหัสกลุ่ม, ของแถม 1|'', สุญญากาศ 1|'', ใช้งาน 1|0]
 *   grp  rows = [รหัสกลุ่ม, ชื่อกลุ่ม, สี, ขึ้นแร็ค yes|no, ชั้นแร็ค 1|2+|all|'', เศษ / ไม่ขึ้นแร็ค ไปที่, หมายเหตุ]
 *   conv rows = [SKU หลังแปลง, SKU ตอนซื้อ]      + cols, blank   รูปเดิมของ masterDoc (fifo / รายงาน / ชุดแชร์ อ่านเหมือนเดิม)
 *   sup  rows = [PO, Supplier]                   + dup
 *   cap  rows = [SKU, Product ID, ชิ้นต่อพาเลท]    + cols, blank
 *   strict  1 = ใบที่ใช้ Location / SKU ที่ไม่มีในตาราง (หรือปิดใช้) บันทึกไม่ได้ · 0 = เตือนอย่างเดียว (ค่าเริ่ม)
 *   ver     รุ่นของตาราง: บันทึกได้เมื่อรุ่นในฐานยังเป็นรุ่นที่เริ่มแก้ (สองคนแก้พร้อมกัน คนหลังต้องโหลดใหม่)
 *   hist    ประวัติ HIST_MAX ครั้งล่าสุด ใหม่สุดก่อน [{at, by, name, text}]
 *
 * ยังไม่บันทึกตาราง loc / sku = ไม่เตือนอะไรตอนบันทึกใบ (ขึ้นระบบได้ก่อนตั้งข้อมูลหลักครบ)
 * กลุ่มสินค้ายังไม่บันทึก = ใช้ค่าเริ่มตามกติกาที่เก็บของหัวหน้าคลัง 9 พ.ย. (เหมือน wms-putaway.js)
 *
 *   read(local)              ทุกตารางจากสำเนาในเครื่อง
 *   fromParsed(kind, part)   แถวจากไฟล์ที่อ่านด้วย WmsFireTrc.readSheets (PO. Truck · MASTER แปลงสินค้า · ความจุต่อพาเลท)
 *   index(tables)            ตัวค้นเร็ว (โล SKU สั้น/เต็ม กลุ่ม) + สวิตช์ห้าม
 *   validate(kind, list, t)  เตือนรายแถว (ซ้ำ ว่าง รูปแบบ แร็คเกิน 1 พาเลท ปิดใช้แต่มีของ ไม่มีกลุ่ม …)
 *   found(kind, list, local) Location / SKU ที่มีในสมุดแต่ยังไม่มีในตาราง (เติมตอนตั้งครั้งแรก)
 *   docOf(kind, list, opt, cur)  เอกสาร master ที่จะเขียน (รุ่น ประวัติ) หรือ {error}
 *   check(plan, mode, ix)    ผลท้ายแถวของแท็บลงรายการ (book-grid): เตือน / ห้ามตามข้อมูลหลัก
 *
 * โหลดเป็น classic script หลัง wms-fire-core.js เปิดเป็น window.WmsFireSetup
 */
(function () {
  'use strict';

  var KINDS = ['loc', 'sku', 'grp', 'conv', 'sup', 'cap'];
  var IMPORTED = ['conv', 'sup', 'cap'];   // ตารางหลักเดิม: เก็บรูปเดิม ไม่มีสวิตช์ห้าม
  var TAB = { loc: 'Location', sku: 'SKU', grp: 'กลุ่มสินค้า', conv: 'แปลงสินค้า', sup: 'Supplier (PO)', cap: 'SKU : Pallet' };
  /* ชื่อชีตเดิมของตารางหลัก (รายงานแสดงว่ามาจากตารางไหน) */
  var SHEET = { conv: 'MASTER แปลงสินค้า', sup: 'PO. Truck', cap: 'ความจุต่อพาเลท' };
  var COLS = {
    loc: ['Location', 'จุ (พาเลท)', 'ใช้งาน', 'หมายเหตุ'],
    sku: ['SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'กลุ่มสินค้า', 'ของแถม', 'สุญญากาศ', 'ใช้งาน'],
    grp: ['รหัส', 'กลุ่ม', 'สี', 'ขึ้นแร็ค', 'ชั้นแร็ค', 'เศษ / ไม่ขึ้นแร็ค ไปที่', 'หมายเหตุ'],
    conv: ['SKU ตอนซื้อ', 'SKU หลังแปลง'],
    cap: ['SKU', 'Product ID', 'STD / pallet'],
  };
  var ROWS_MAX = 20000;        // แถวต่อตาราง (แบบ MASTER_MAX ของตารางหลักเดิม)
  var DOC_BYTES = 900000;      // เอกสารเดียวไม่เกินนี้ (Firestore รับ 1 MiB)
  var HIST_MAX = 60;
  var HIST_SHOW = 8;           // รหัสที่ยกมาให้ดูในประวัติต่อครั้ง
  var SPECIAL = ['RIB', 'QA', 'IQA', 'DOCKLOAD', 'ORDER OB', 'OFFICE', 'MKT', 'จอง'];
  var REST = ['แร็คช่องตัวเอง', 'RIB', 'พื้น A–C', 'พื้น D', 'ชั้นวาง S'];
  var LV = [['1', 'ชั้น 1'], ['2+', 'ชั้น 2 ขึ้นไป'], ['all', 'ทุกชั้น']];
  var PALETTE = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#64748B', '#14B8A6', '#84CC16', '#F97316'];
  /* ค่าเริ่ม: กติกาที่เก็บของหัวหน้าคลัง 9 พ.ย. (wms-putaway.js) · หมอน เครื่องนอน Sofa Bed รอหัวหน้ายืนยัน */
  var GROUPS = [
    ['m6', 'ที่นอน 6 ฟุต', '#4F46E5', 'yes', '1', 'แร็คช่องตัวเอง', 'ชั้น 1 เต็ม เศษลงพื้น A–C'],
    ['m5', 'ที่นอน 5 ฟุต', '#0EA5E9', 'yes', '1', 'แร็คช่องตัวเอง', 'ชั้น 1 เต็ม เศษลงพื้น A–C'],
    ['m35', 'ที่นอน 3.5 ฟุต', '#10B981', 'yes', '2+', 'RIB', ''],
    ['tp', 'ท็อปเปอร์', '#F59E0B', 'yes', '2+', 'RIB', ''],
    ['pl', 'หมอน', '#EC4899', 'yes', '2+', 'แร็คช่องตัวเอง', 'รอยืนยัน'],
    ['bd', 'เครื่องนอน', '#8B5CF6', 'yes', '2+', 'แร็คช่องตัวเอง', 'ผ้าปู ผ้านวม · รอยืนยัน'],
    ['sb', 'Sofa Bed', '#64748B', 'no', '', 'พื้น A–C', 'รอยืนยัน'],
    ['gf', 'ของแถม', '#14B8A6', 'no', '', 'พื้น D', ''],
  ];
  /* ข้อความเดิมของ wms-book.js ที่ข้อมูลหลักตอบแทนได้ (มีตารางแล้ว = ใช้ข้อความของข้อมูลหลักแทน) */
  var OLD_LOC = /^โล (.+) ไม่เคยมีในสมุด/;
  var OLD_SKU = /^SKU ใหม่ ยังไม่เคยมีในสมุด/;

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  function flag(v) { var s = up(v); return s === '1' || s === 'Y' || s === 'TRUE' || s === '✓'; }
  function nat(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }
  function C() { return window.WmsFireCore; }
  function enc(rows) { return C().enc(rows); }
  function dec(s) { return C().dec(s); }
  function W(lv, t) { return { lv: lv, t: t }; }

  /** ชนิดของโล: R แร็ค-ช่อง-ชั้น · พื้น A–D โซน-แถว-ตำแหน่ง · S ชั้นวาง · ชื่อพิเศษ · ไม่รู้จัก = null */
  function locKind(code) {
    var u = up(code), m;
    if (!u) return null;
    if ((m = /^R(\d+)-(\d+)-(\d+)$/.exec(u))) return { t: 'R', rack: +m[1], bay: +m[2], lv: +m[3] };
    if ((m = /^([A-D])-(\d+)-(\d+)$/.exec(u))) return { t: 'F', zone: m[1], row: +m[2], pos: +m[3] };
    if ((m = /^S-(\d+)-(\d+)$/.exec(u))) return { t: 'S', row: +m[1], pos: +m[2] };
    if (SPECIAL.indexOf(u) >= 0 || /^I?QA(?![A-Z])/.test(u)) return { t: 'X' };
    return null;
  }

  /* ── แถว ↔ วัตถุ ───────────────────────────────────────────────────── */

  function code(v) { return up(v).replace(/\s+/g, ''); }
  function isNum(v) { var s = text(v).replace(/,/g, ''); return s !== '' && !isNaN(+s); }

  function rowIn(kind, r) {
    r = r || [];
    if (kind === 'conv') return { after: code(r[0]), buy: code(r[1]) };
    if (kind === 'sup') return { po: code(r[0]), sup: text(r[1]) };
    if (kind === 'cap') return { sku: code(r[0]), pid: code(r[1]), cap: text(r[2]) };
    if (kind === 'loc') return { code: up(r[0]), pal: text(r[1]), on: text(r[2]) !== '0', note: text(r[3]) };
    if (kind === 'sku') return { sku: up(r[0]), long: up(r[1]), name: text(r[2]), grp: text(r[3]), gift: flag(r[4]), vac: flag(r[5]), on: text(r[6]) !== '0' };
    return { id: text(r[0]), name: text(r[1]), c: text(r[2]) || PALETTE[0], rack: text(r[3]) === 'no' ? 'no' : 'yes', lv: text(r[4]), rest: text(r[5]), note: text(r[6]) };
  }
  function rowOut(kind, o) {
    if (kind === 'conv') return [code(o.after), code(o.buy)];
    if (kind === 'sup') return [code(o.po), text(o.sup)];
    if (kind === 'cap') return [code(o.sku), code(o.pid), text(o.cap)];
    if (kind === 'loc') return [up(o.code), text(o.pal), o.on === false ? '0' : '1', text(o.note)];
    if (kind === 'sku') return [up(o.sku), up(o.long), text(o.name), text(o.grp), o.gift ? '1' : '', o.vac ? '1' : '', o.on === false ? '0' : '1'];
    return [text(o.id), text(o.name), text(o.c), o.rack === 'no' ? 'no' : 'yes', text(o.lv), text(o.rest), text(o.note)];
  }
  function keyOf(kind, o) {
    if (kind === 'conv') return code(o.after) && code(o.buy) ? code(o.after) + '|' + code(o.buy) : '';
    if (kind === 'sup') return code(o.po);
    if (kind === 'cap') return code(o.sku) || code(o.pid) ? code(o.sku) + '|' + code(o.pid) : '';
    return kind === 'loc' ? up(o.code) : kind === 'sku' ? up(o.long) || up(o.sku) : text(o.id);
  }
  /** แถวว่างทั้งแถว (ไม่บันทึก ไม่เตือน) */
  function isBlank(kind, o) {
    if (kind === 'loc') return !up(o.code) && !text(o.pal) && !text(o.note);
    if (kind === 'sku') return !up(o.sku) && !up(o.long) && !text(o.name) && !text(o.grp);
    if (kind === 'grp') return !text(o.name) && !text(o.note);
    return rowOut(kind, o).every(function (v) { return v === ''; });
  }
  function blank(kind) { return rowIn(kind, []); }
  function defaults() { return GROUPS.map(function (g) { return rowIn('grp', g); }); }
  /**
   * เดากลุ่มจากชื่อสินค้า (ตอนเติม SKU ที่พบในสมุด หัวหน้าตรวจก่อนบันทึก) · เดาไม่ได้ = ''
   * แบบเดียวกับ kindOf ของ wms-putaway.js: ชื่อขึ้นต้น ผ้า ชุด ปลอก = เครื่องนอน ไม่ใช่ตัวที่นอน
   */
  function guessGroup(name, sku) {
    var n = text(name), u = n.toUpperCase(), m = /(\d+(?:\.\d+)?)\s*(?:FT|ฟุต)/.exec(u), size = m ? m[1] : '';
    if (/^แถม/.test(n) || /^FRE/.test(up(sku))) return 'gf';
    if (/ท็อปเปอร์|ท๊อปเปอร์|TOPPER/.test(u)) return 'tp';
    if (/SOFA\s*BED|โซฟาเบด/.test(u)) return 'sb';
    if (/^(ผ้า|ชุด|ปลอก)/.test(n)) return 'bd';
    if (/ที่นอน/.test(n)) return size === '6' ? 'm6' : size === '5' ? 'm5' : size === '3.5' ? 'm35' : '';
    if (/^หมอน/.test(n)) return 'pl';
    return '';
  }

  /** รหัสกลุ่มใหม่ที่ยังไม่ซ้ำ */
  function newGroupId(list) {
    var used = {}, n = 1;
    (list || []).forEach(function (g) { used[g.id] = 1; });
    while (used['g' + n]) n++;
    return 'g' + n;
  }

  /** แถวจากไฟล์ที่อ่านแล้ว (WmsFireTrc.readSheets: sup.rows · conv.pairs · cap.rows) → แถวของตาราง */
  function fromParsed(kind, part) {
    if (!part) return [];
    var list = kind === 'conv' ? part.pairs : part.rows;
    return (list || []).map(function (r) { return rowIn(kind, r); });
  }

  /** ทุกตารางจากสำเนาในเครื่อง → { loc, sku, grp, conv, sup, cap } ตัวละ { saved, rows, strict, ver, hist, at, name, n } */
  function read(local) {
    var m = (local && local.master) || {}, out = {};
    KINDS.forEach(function (k) {
      var d = m[k];
      out[k] = d
        ? { saved: true, rows: dec(d.rows).map(function (r) { return rowIn(k, r); }), strict: +d.strict === 1, ver: +d.ver || 0,
          hist: Array.isArray(d.hist) ? d.hist : [], at: +d.at || 0, name: d.name || '', n: +d.n || 0 }
        : { saved: false, rows: k === 'grp' ? defaults() : [], strict: false, ver: 0, hist: [], at: 0, name: '', n: 0 };
    });
    return out;
  }

  /** ตัวค้นเร็ว: โล → แถว · SKU (เต็มหรือสั้น) → แถว · รหัสกลุ่ม → กลุ่ม */
  function index(t) {
    var ix = {
      loc: {}, sku: {}, grp: {},
      hasLoc: !!(t && t.loc.saved && t.loc.rows.length), hasSku: !!(t && t.sku.saved && t.sku.rows.length),
      strictLoc: !!(t && t.loc.saved && t.loc.strict), strictSku: !!(t && t.sku.saved && t.sku.strict),
    };
    if (!t) return ix;
    t.loc.rows.forEach(function (r) { var k = up(r.code); if (k && !ix.loc[k]) ix.loc[k] = r; });
    t.sku.rows.forEach(function (r) { [r.long, r.sku].forEach(function (c) { c = up(c); if (c && !ix.sku[c]) ix.sku[c] = r; }); });
    t.grp.rows.forEach(function (g) { if (g.id) ix.grp[g.id] = g; });
    return ix;
  }

  /** ยอดในเครื่องต่อโล / ต่อ SKU / ต่อ PO (กองที่ยังมีของ) */
  function stockOf(local) {
    var loc = {}, sku = {}, po = {};
    var add = function (m, k, q) { m[k] = Math.round(((m[k] || 0) + q) * 1000) / 1000; };
    Object.keys((local && local.piles) || {}).forEach(function (k) {
      var p = local.piles[k];
      if (!p || Math.abs(+p.qty || 0) <= 1e-9) return;
      add(loc, p.loc, p.qty);
      [p.long, p.sku].forEach(function (c) { if (c) add(sku, c, p.qty); });
      var P = code(p.po);
      if (P && P !== '0') add(po, P, p.qty);
    });
    return { loc: loc, sku: sku, po: po };
  }

  /** ชื่อสินค้าจากเอกสารในสมุด (รหัสเต็มและรหัสสั้น → ชื่อ) */
  function namesOf(local) {
    var out = {};
    ((local && local.docs) || []).forEach(function (d) {
      var nm = d.names || {};
      Object.keys(nm).forEach(function (k) { if (nm[k]) out[up(k)] = nm[k]; });
      (d.rows || []).forEach(function (r) { var n = nm[r[1]] || nm[r[0]]; if (n && r[0] && !out[up(r[0])]) out[up(r[0])] = n; });
    });
    return out;
  }

  /* ── ตรวจตาราง ─────────────────────────────────────────────────────── */

  /**
   * เตือนรายแถว → { rows: [[{lv, t}]] ตามลำดับ list, bad: แถวสีแดง (บันทึกไม่ได้), warn: แถวสีส้ม }
   * t = ตารางทั้งสาม (ชื่อกลุ่ม) · stock = stockOf(local) (ปิดใช้แต่ยังมีของ)
   */
  function validate(kind, list, t, stock) {
    stock = stock || { loc: {}, sku: {}, po: {} };
    var out = list.map(function () { return []; });
    var seen = {};
    function dupOf(k, i) { if (!k) return; (seen[k] || (seen[k] = [])).push(i); }
    if (kind === 'loc') {
      list.forEach(function (r, i) { dupOf(up(r.code), i); });
      list.forEach(function (r, i) {
        var w = out[i], u = up(r.code), k = locKind(u);
        if (!u) { w.push(W('red', 'ยังไม่ใส่รหัส')); return; }
        if (seen[u].length > 1) w.push(W('red', 'รหัสซ้ำกับแถวอื่น'));
        if (!k) w.push(W('info', 'รูปแบบไม่ตรง R00-00-0 · A-00-00 · S-00-00'));
        if (r.pal !== '' && !(+r.pal >= 0)) w.push(W('warn', 'จุ ต้องเป็นตัวเลข'));
        else if (k && k.t === 'R' && +r.pal > 1) w.push(W('warn', 'แร็ค R ช่องละ 1 พาเลท'));
        if (!r.on && stock.loc[u]) w.push(W('warn', 'ปิดใช้ แต่ยังมีของ ' + stock.loc[u] + ' ชิ้น'));
      });
    } else if (kind === 'sku') {
      var shorts = {};
      list.forEach(function (r, i) {
        dupOf(up(r.long) || up(r.sku), i);
        if (up(r.long) && up(r.sku)) (shorts[up(r.sku)] || (shorts[up(r.sku)] = [])).push(i);
      });
      var grp = {};
      ((t && t.grp.rows) || []).forEach(function (g) { grp[g.id] = g; });
      list.forEach(function (r, i) {
        var w = out[i], key = up(r.long) || up(r.sku);
        if (!key) { w.push(W('red', 'ยังไม่ใส่ SKU')); return; }
        if (seen[key].length > 1) w.push(W('red', 'SKU ซ้ำกับแถวอื่น'));
        else if (up(r.sku) && shorts[up(r.sku)] && shorts[up(r.sku)].length > 1) w.push(W('warn', 'SKU สั้นซ้ำกับอีกแถว'));
        if (!r.grp) w.push(W('warn', 'ยังไม่เลือกกลุ่ม'));
        else if (!grp[r.grp]) w.push(W('warn', 'ไม่มีกลุ่มนี้แล้ว เลือกใหม่'));
        if (!r.name) w.push(W('info', 'ยังไม่ใส่ชื่อ'));
        var have = stock.sku[up(r.long)] || stock.sku[up(r.sku)];
        if (!r.on && have) w.push(W('warn', 'ปิดใช้ แต่ยังมีของ ' + have + ' ชิ้น'));
      });
    } else if (IMPORTED.indexOf(kind) >= 0) {
      var known = null;
      if (t && t.sku && t.sku.rows && t.sku.rows.length) {
        known = {};
        t.sku.rows.forEach(function (x) { if (up(x.sku)) known[up(x.sku)] = 1; if (up(x.long)) known[up(x.long)] = 1; });
      }
      var spell = {};
      list.forEach(function (r, i) {
        dupOf(keyOf(kind, r), i);
        if (kind === 'sup' && text(r.sup)) { var n = code(r.sup); (spell[n] || (spell[n] = {}))[text(r.sup)] = 1; }
      });
      list.forEach(function (r, i) {
        var w = out[i], k = keyOf(kind, r);
        if (isBlank(kind, r)) return;
        if (kind === 'conv') {
          if (!code(r.after) || !code(r.buy)) { w.push(W('red', 'ใส่ทั้ง SKU หลังแปลง และ SKU ตอนซื้อ')); return; }
          if (code(r.after) === code(r.buy)) w.push(W('red', 'SKU เดียวกันทั้งสองช่อง'));
          if (seen[k].length > 1) w.push(W('red', 'คู่นี้ซ้ำกับแถวอื่น'));
          if (known) [r.after, r.buy].forEach(function (c) { if (!known[code(c)]) w.push(W('info', 'ไม่มี ' + code(c) + ' ในตาราง SKU')); });
        } else if (kind === 'sup') {
          if (!code(r.po)) { w.push(W('red', 'ยังไม่ใส่ PO')); return; }
          if (seen[k].length > 1) w.push(W('red', 'PO ซ้ำกับแถวอื่น'));
          if (!text(r.sup)) w.push(W('warn', 'ยังไม่ใส่ Supplier (ไม่บันทึกแถวนี้)'));
          else {
            var alt = Object.keys(spell[code(r.sup)] || {}).filter(function (x) { return x !== text(r.sup); });
            if (alt.length) w.push(W('info', 'Supplier เขียนต่างกัน: ' + alt.slice(0, 2).join(' / ')));
          }
        } else {
          if (!k) { w.push(W('red', 'ใส่ SKU หรือ Product ID')); return; }
          if (seen[k].length > 1) w.push(W('red', 'SKU นี้ซ้ำกับแถวอื่น'));
          if (text(r.cap) === '') w.push(W('warn', 'ยังไม่ใส่ชิ้นต่อพาเลท (ไม่บันทึกแถวนี้)'));
          else if (!isNum(r.cap) || +text(r.cap).replace(/,/g, '') < 0) w.push(W('red', 'ชิ้นต่อพาเลทต้องเป็นตัวเลข'));
          if (known && !known[code(r.sku)] && !known[code(r.pid)]) w.push(W('info', 'ไม่มีในตาราง SKU'));
        }
      });
    } else {
      var names = {}, ids = {}, used = {};
      list.forEach(function (g, i) { var n = up(g.name); if (n) (names[n] || (names[n] = [])).push(i); if (g.id) (ids[g.id] || (ids[g.id] = [])).push(i); });
      ((t && t.sku.rows) || []).forEach(function (s) { if (s.grp) used[s.grp] = (used[s.grp] || 0) + 1; });
      list.forEach(function (g, i) {
        var w = out[i], n = up(g.name);
        if (!n) w.push(W('red', 'ยังไม่ใส่ชื่อกลุ่ม'));
        else if (names[n].length > 1) w.push(W('red', 'ชื่อกลุ่มซ้ำ'));
        if (!g.id || ids[g.id].length > 1) w.push(W('red', 'รหัสกลุ่มซ้ำ'));
        if (g.rack === 'yes' && !g.lv) w.push(W('warn', 'เลือกชั้นแร็ค'));
        if (g.rack === 'no' && (g.rest === 'แร็คช่องตัวเอง' || g.rest === 'RIB')) w.push(W('warn', 'ไม่ขึ้นแร็ค แต่ให้ไป ' + g.rest));
        if (!g.rest) w.push(W('warn', 'เลือกที่เก็บเศษ'));
        if (t && t.sku.saved && !used[g.id]) w.push(W('info', 'ยังไม่มี SKU ในกลุ่มนี้'));
      });
    }
    var bad = 0, warn = 0;
    out.forEach(function (w) {
      if (w.some(function (x) { return x.lv === 'red'; })) bad++;
      else if (w.some(function (x) { return x.lv === 'warn'; })) warn++;
    });
    return { rows: out, bad: bad, warn: warn };
  }

  /**
   * Location / SKU ที่มีในสมุด (เอกสารตั้งแต่ยอดยกมา ไม่นับใบที่ยกเลิกกับใบกลับรายการ) แต่ยังไม่มีในตาราง
   * loc → [{code, qty}] · sku → [{sku, long, name, qty}] เรียงตามรหัส
   */
  function found(kind, list, local, skus) {
    if (!local || kind === 'grp' || kind === 'conv') return [];
    if (kind === 'sup' || kind === 'cap') return foundMore(kind, list, local, skus);
    var have = {}, out = {}, st = stockOf(local), vd = C().voids(local);
    (list || []).forEach(function (r) {
      if (kind === 'loc') { if (up(r.code)) have[up(r.code)] = 1; }
      else { if (up(r.long)) have[up(r.long)] = 1; if (up(r.sku)) have[up(r.sku)] = 1; }
    });
    C().liveDocs(local).forEach(function (d) {
      if (d.type === C().TYPE_REV || vd[d.no]) return;
      (d.rows || []).forEach(function (r) {
        if (kind === 'loc') {
          [r[4], r[5]].forEach(function (L) { L = up(L); if (L && !have[L] && !out[L]) out[L] = { code: L, qty: st.loc[L] || 0 }; });
          return;
        }
        var s = up(r[0]), l = up(r[1]), key = l || s;
        if (!key || have[key] || (s && have[s])) return;   // ตารางมีแค่ SKU สั้น = นับว่ามี (แบบ check ตอนลงใบ)
        var o = out[key] || (out[key] = { sku: s, long: l, name: '', qty: st.sku[key] || 0 });
        if (!o.sku && s) o.sku = s;
        var nm = (d.names && (d.names[r[1]] || d.names[r[0]])) || '';
        if (nm) o.name = nm;
      });
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return nat(a.code || a.sku || a.long, b.code || b.sku || b.long); });
  }

  /**
   * sup → PO ในสมุด (ไม่นับ 0 ใบยกเลิก ใบกลับรายการ) ที่ยังไม่มี Supplier [{po, qty}]
   * cap → SKU ที่ใช้งานในตาราง SKU (ยังไม่ตั้งตาราง = SKU ที่มีของ) ที่ยังไม่มีความจุ [{sku, pid, name, qty}]
   */
  function foundMore(kind, list, local, skus) {
    var st = stockOf(local), out = [], have = {};
    if (kind === 'sup') {
      (list || []).forEach(function (r) { if (code(r.po)) have[code(r.po)] = 1; });
      var vd = C().voids(local), seenPo = {};
      C().liveDocs(local).forEach(function (d) {
        if (d.type === C().TYPE_REV || vd[d.no]) return;
        (d.rows || []).forEach(function (r) {
          var P = code(r[3]);
          if (!P || P === '0' || have[P] || seenPo[P]) return;
          seenPo[P] = 1;
          out.push({ po: P, qty: st.po[P] || 0 });
        });
      });
      return out.sort(function (a, b) { return nat(a.po, b.po); });
    }
    (list || []).forEach(function (r) { if (code(r.sku)) have[code(r.sku)] = 1; if (code(r.pid)) have[code(r.pid)] = 1; });
    var names = namesOf(local), cand = [];
    if (skus && skus.length) {
      cand = skus.filter(function (x) { return x.on !== false; }).map(function (x) { return { sku: up(x.sku), long: up(x.long), name: x.name }; });
    } else {
      var by = {};
      Object.keys(local.piles || {}).forEach(function (k) {
        var p = local.piles[k];
        if (!p || !(+p.qty > 1e-9)) return;
        var key = up(p.long) || up(p.sku);
        if (key && !by[key]) { by[key] = 1; cand.push({ sku: up(p.sku), long: up(p.long), name: '' }); }
      });
    }
    cand.forEach(function (x) {
      if ((x.sku && have[x.sku]) || (x.long && have[x.long])) return;
      if (x.sku) have[x.sku] = 1;
      if (x.long) have[x.long] = 1;
      out.push({ sku: x.sku || x.long, pid: x.long, name: x.name || names[x.long] || names[x.sku] || '', qty: st.sku[x.long] || st.sku[x.sku] || 0 });
    });
    return out.sort(function (a, b) { return nat(a.sku, b.sku); });
  }

  /* ── บันทึก ─────────────────────────────────────────────────────────── */

  /** เทียบตารางเดิมกับตารางใหม่ → { add, del, chg, keys: [รหัสที่เปลี่ยน], text } */
  function diff(kind, before, after) {
    var a = {}, b = {}, add = [], del = [], chg = [];
    (before || []).forEach(function (r) { var k = keyOf(kind, r); if (k) a[k] = r; });
    (after || []).forEach(function (r) { var k = keyOf(kind, r); if (k) b[k] = r; });
    Object.keys(b).forEach(function (k) {
      if (!a[k]) add.push(k);
      else if (rowOut(kind, a[k]).join('\t') !== rowOut(kind, b[k]).join('\t')) chg.push(k);
    });
    Object.keys(a).forEach(function (k) { if (!b[k]) del.push(k); });
    var label = function (k) {
      if (kind === 'grp') return (b[k] || a[k]).name || k;
      if (kind === 'conv') return k.replace('|', ' ← ');
      if (kind === 'cap') return k.split('|')[0] || k.split('|')[1];
      return k;
    };
    var part = function (word, list) {
      if (!list.length) return '';
      var show = list.slice(0, HIST_SHOW).map(label).join(', ');
      return word + ' ' + list.length + ' (' + show + (list.length > HIST_SHOW ? ' …' : '') + ')';
    };
    var txt = [part('เพิ่ม', add), part('แก้', chg), part('ลบ', del)].filter(Boolean).join(' · ');
    return { add: add.length, del: del.length, chg: chg.length, text: txt };
  }

  /**
   * เอกสาร master ที่จะเขียน → { data } | { error }
   * opt = { by, name, at (ms ของเครื่อง ใช้ในประวัติ), strict, base (รุ่นที่เริ่มแก้) } · cur = เอกสารในฐานตอนนี้ (อ่านใน transaction)
   */
  function docOf(kind, list, opt, cur) {
    opt = opt || {};
    if (KINDS.indexOf(kind) < 0) return { error: 'ไม่รู้จักตาราง ' + kind };
    var now = +((cur && cur.ver) || 0);
    if (now !== (+opt.base || 0)) {
      return { error: 'มีคนบันทึกตาราง ' + TAB[kind] + ' ก่อนแล้ว' + (cur && cur.name ? ' (' + cur.name + ')' : '') + ' · โหลดตารางใหม่แล้วแก้อีกครั้ง' };
    }
    var imp = IMPORTED.indexOf(kind) >= 0;
    list = (list || []).filter(function (r) { return imp ? !isBlank(kind, r) : keyOf(kind, r) || (kind === 'grp' && text(r.name)); });
    if (list.length > ROWS_MAX) return { error: 'ตาราง ' + TAB[kind] + ' ต้องมีไม่เกิน ' + ROWS_MAX + ' แถว' };
    var v = validate(kind, list, null, null);
    var red = v.rows.map(function (w, i) { return w.some(function (x) { return x.lv === 'red'; }) ? i : -1; }).filter(function (i) { return i >= 0; });
    if (red.length) {
      var r0 = list[red[0]], w0 = v.rows[red[0]].filter(function (x) { return x.lv === 'red'; })[0];
      var who = keyOf(kind, r0).replace('|', ' ').trim() || text(r0.name) || text(r0.after || r0.buy || r0.po || r0.sku || r0.pid) || 'แถวว่าง';
      return { error: 'แก้แถวสีแดง ' + red.length + ' แถวก่อน เช่น ' + who + ': ' + w0.t };
    }
    /* Supplier / ความจุ ที่ยังไม่ใส่ = ไม่บันทึกแถวนั้น (แบบนำเข้าไฟล์ที่ข้ามแถวว่าง) */
    var skip = 0;
    if (kind === 'sup' || kind === 'cap') {
      list = list.filter(function (r) { var ok = kind === 'sup' ? !!text(r.sup) : text(r.cap) !== ''; if (!ok) skip++; return ok; });
    }
    var before = cur && cur.rows ? dec(cur.rows).map(function (r) { return rowIn(kind, r); }) : (kind === 'grp' ? defaults() : []);
    var dd = diff(kind, before, list);
    var hasStrict = kind === 'loc' || kind === 'sku';
    var strict = hasStrict && opt.strict ? 1 : 0, was = cur ? +cur.strict || 0 : 0;
    var words = [];
    if (dd.text) words.push(dd.text);
    if (strict !== was && hasStrict) words.push(strict ? 'ตั้งให้ ห้ามบันทึกใบที่ไม่มีในตาราง' : 'ตั้งให้ เตือนอย่างเดียว');
    if (!cur) words.unshift('ตั้งตารางครั้งแรก ' + list.length + ' แถว');
    if (!words.length) return { error: 'ไม่มีอะไรเปลี่ยน' + (skip ? ' (ข้าม ' + skip + ' แถวที่ยังไม่ครบ)' : '') };
    if (skip) words.push('ข้าม ' + skip + ' แถวที่ยังไม่ครบ');
    var hist = [{ at: +opt.at || 0, by: text(opt.by), name: text(opt.name), text: words.join(' · ').slice(0, 600) }]
      .concat(Array.isArray(cur && cur.hist) ? cur.hist : []).slice(0, HIST_MAX);
    var rows = list.map(function (r) {
      var o = rowOut(kind, r);
      if (kind === 'cap') o[2] = +text(o[2]).replace(/,/g, '');
      return o;
    });
    var d;
    if (imp) {
      /* รูปเดิมของ masterDoc (WmsFireTrc) + รุ่น ประวัติ: fifo / รายงาน / ชุดแชร์ อ่านได้เหมือนเดิม */
      d = { tab: (cur && cur.tab) || SHEET[kind], rows: enc(rows), n: rows.length };
      if (kind === 'sup') d.dup = [];
      else { d.cols = cur && Array.isArray(cur.cols) && cur.cols.length ? cur.cols : COLS[kind]; d.blank = 0; }
    } else {
      d = { tab: TAB[kind], cols: COLS[kind], rows: enc(rows), n: rows.length, strict: kind === 'grp' ? 0 : strict };
    }
    d.ver = now + 1; d.hist = hist; d.by = text(opt.by); d.name = text(opt.name); d.at = C().TIME;
    if (C().byteLen(JSON.stringify(d)) > DOC_BYTES) return { error: 'ตาราง ' + TAB[kind] + ' ใหญ่เกินที่เก็บได้' };
    return { data: d, diff: dd, skip: skip };
  }

  /* ── ตอนลงรายการ (แท็บรับของ ย้าย คืน แปลง ปรับยอด ตารางเดิม) ─────────── */

  /** เตือนกติกาของกลุ่มเมื่อวางเข้าแร็ค R (ไม่ห้าม) */
  function rackRule(g, lv) {
    if (!g) return '';
    if (g.rack === 'no') return g.name + ' ไม่ขึ้นแร็ค (ปกติไป ' + (g.rest || 'พื้น') + ')';
    if (g.lv === '1' && lv !== 1) return 'ปกติ ' + g.name + ' ลง R ชั้น 1';
    if (g.lv === '2+' && lv === 1) return 'R ชั้น 1 ไม่ใช่ที่ของ ' + g.name;
    return '';
  }

  /**
   * ผลท้ายแถวของแผน (WmsBook.planX + trApply) + ข้อมูลหลัก: แก้ plan ในที่แล้วคืน plan
   * ไม่มีในตาราง / ปิดใช้ = เตือน (strict = แถวผิด บันทึกไม่ได้) · กติกากลุ่มตอนลง R = เตือนเสมอ
   * มีตารางแล้ว: ข้อความ "ไม่เคยมีในสมุด" ของเดิมใช้ข้อมูลหลักตอบแทน
   */
  function check(plan, mode, ix) {
    if (!plan || !plan.lines || !ix || (!ix.hasLoc && !ix.hasSku)) return plan;
    var place = mode !== 'adj' && mode !== 'conv';   // ปรับยอด / แปลงสินค้า ไม่ได้ย้ายของ ไม่เตือนกติกาแร็ค
    plan.lines.forEach(function (o) {
      if (!o || o.st !== 'ok' || !o.take || !o.take.length) return;
      var had = o.warn.length > 0, hard = [], soft = [];
      var add = function (list, t) { if (t && list.indexOf(t) < 0) list.push(t); };
      o.take.forEach(function (r) {
        [r.from, r.to].forEach(function (L) {
          L = up(L);
          if (!L || !ix.hasLoc) return;
          var row = ix.loc[L];
          if (!row) add(ix.strictLoc ? hard : soft, 'ไม่มีโล ' + L + ' ในข้อมูลหลัก');
          else if (!row.on) add(ix.strictLoc ? hard : soft, 'โล ' + L + ' ปิดใช้ในข้อมูลหลัก');
        });
        var code = up(r.long) || up(r.sku), shown = up(r.sku) || code;
        if (!code) return;
        var s = ix.sku[code] || ix.sku[up(r.sku)] || null;
        if (ix.hasSku) {
          if (!s) add(ix.strictSku ? hard : soft, 'ไม่มี SKU ' + shown + ' ในข้อมูลหลัก');
          else if (!s.on) add(ix.strictSku ? hard : soft, 'SKU ' + shown + ' ปิดใช้ในข้อมูลหลัก');
        }
        var k = place && r.to ? locKind(r.to) : null;
        if (s && k && k.t === 'R') add(soft, rackRule(ix.grp[s.grp], k.lv));
      });
      var keep = o.warn.filter(function (t) {
        if (ix.hasLoc && OLD_LOC.test(t)) return false;
        if (ix.hasSku && OLD_SKU.test(t)) return false;
        return true;
      });
      o.warn = keep.concat(soft.filter(function (t) { return keep.indexOf(t) < 0; }));
      if (hard.length) {
        o.st = 'bad';
        o.why = hard.join(' · ') + ' (หัวหน้าตั้งให้ต้องมีในข้อมูลหลัก)';
        plan.total.bad = (plan.total.bad || 0) + 1;
        if (plan.total.ok) plan.total.ok--;
      }
      var now = o.warn.length > 0;
      if (had && !now) plan.total.warn--;
      else if (!had && now) plan.total.warn = (plan.total.warn || 0) + 1;
    });
    return plan;
  }

  window.WmsFireSetup = {
    KINDS: KINDS, IMPORTED: IMPORTED, SHEET: SHEET, TAB: TAB, COLS: COLS, REST: REST, LV: LV, PALETTE: PALETTE, SPECIAL: SPECIAL, ROWS_MAX: ROWS_MAX, HIST_MAX: HIST_MAX,
    locKind: locKind, rowIn: rowIn, rowOut: rowOut, keyOf: keyOf, blank: blank, defaults: defaults, newGroupId: newGroupId, guessGroup: guessGroup,
    read: read, index: index, stockOf: stockOf, namesOf: namesOf, validate: validate, found: found, diff: diff, docOf: docOf,
    isBlank: isBlank, fromParsed: fromParsed, isNum: isNum, code: code,
    rackRule: rackRule, check: check,
  };
})();
