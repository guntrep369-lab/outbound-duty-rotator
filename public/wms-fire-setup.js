/**
 * @file wms-fire-setup.js — ระบบใหม่ ข้อมูลหลัก ขั้น ก: Location · SKU · กลุ่มสินค้า (ตรรกะล้วน ไม่แตะฐาน ไม่แตะหน้าจอ)
 *
 * ที่เก็บ master/{loc|sku|grp} หัวหน้าแก้ทั้งตารางแล้วบันทึกทีละครั้ง (แบบตารางหลักเดิม · meta.mv +1 ทุกเครื่องดึงใหม่)
 *   {tab, cols, rows TSV, n, strict, ver, hist, by, name, at}
 *   loc  rows = [Location, จุ (พาเลท), ใช้งาน 1|0, หมายเหตุ]
 *   sku  rows = [SKU, SKU เต็ม, ชื่อสินค้า, รหัสกลุ่ม, ของแถม 1|'', สุญญากาศ 1|'', ใช้งาน 1|0]
 *   grp  rows = [รหัสกลุ่ม, ชื่อกลุ่ม, สี, ขึ้นแร็ค yes|no, ชั้นแร็ค 1|2+|all|'', เศษ / ไม่ขึ้นแร็ค ไปที่, หมายเหตุ]
 *   strict  1 = ใบที่ใช้ Location / SKU ที่ไม่มีในตาราง (หรือปิดใช้) บันทึกไม่ได้ · 0 = เตือนอย่างเดียว (ค่าเริ่ม)
 *   ver     รุ่นของตาราง: บันทึกได้เมื่อรุ่นในฐานยังเป็นรุ่นที่เริ่มแก้ (สองคนแก้พร้อมกัน คนหลังต้องโหลดใหม่)
 *   hist    ประวัติ HIST_MAX ครั้งล่าสุด ใหม่สุดก่อน [{at, by, name, text}]
 *
 * ยังไม่บันทึกตาราง loc / sku = ไม่เตือนอะไรตอนบันทึกใบ (ขึ้นระบบได้ก่อนตั้งข้อมูลหลักครบ)
 * กลุ่มสินค้ายังไม่บันทึก = ใช้ค่าเริ่มตามกติกาที่เก็บของหัวหน้าคลัง 9 พ.ย. (เหมือน wms-putaway.js)
 *
 *   read(local)              ตารางทั้งสามจากสำเนาในเครื่อง
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

  var KINDS = ['loc', 'sku', 'grp'];
  var TAB = { loc: 'Location', sku: 'SKU', grp: 'กลุ่มสินค้า' };
  var COLS = {
    loc: ['Location', 'จุ (พาเลท)', 'ใช้งาน', 'หมายเหตุ'],
    sku: ['SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'กลุ่มสินค้า', 'ของแถม', 'สุญญากาศ', 'ใช้งาน'],
    grp: ['รหัส', 'กลุ่ม', 'สี', 'ขึ้นแร็ค', 'ชั้นแร็ค', 'เศษ / ไม่ขึ้นแร็ค ไปที่', 'หมายเหตุ'],
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

  function rowIn(kind, r) {
    r = r || [];
    if (kind === 'loc') return { code: up(r[0]), pal: text(r[1]), on: text(r[2]) !== '0', note: text(r[3]) };
    if (kind === 'sku') return { sku: up(r[0]), long: up(r[1]), name: text(r[2]), grp: text(r[3]), gift: flag(r[4]), vac: flag(r[5]), on: text(r[6]) !== '0' };
    return { id: text(r[0]), name: text(r[1]), c: text(r[2]) || PALETTE[0], rack: text(r[3]) === 'no' ? 'no' : 'yes', lv: text(r[4]), rest: text(r[5]), note: text(r[6]) };
  }
  function rowOut(kind, o) {
    if (kind === 'loc') return [up(o.code), text(o.pal), o.on === false ? '0' : '1', text(o.note)];
    if (kind === 'sku') return [up(o.sku), up(o.long), text(o.name), text(o.grp), o.gift ? '1' : '', o.vac ? '1' : '', o.on === false ? '0' : '1'];
    return [text(o.id), text(o.name), text(o.c), o.rack === 'no' ? 'no' : 'yes', text(o.lv), text(o.rest), text(o.note)];
  }
  function keyOf(kind, o) { return kind === 'loc' ? up(o.code) : kind === 'sku' ? up(o.long) || up(o.sku) : text(o.id); }
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

  /** ตารางทั้งสามจากสำเนาในเครื่อง → { loc, sku, grp } ตัวละ { saved, rows, strict, ver, hist, at, name, n } */
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

  /** ยอดในเครื่องต่อโล / ต่อ SKU (กองที่ยังมีของ) */
  function stockOf(local) {
    var loc = {}, sku = {};
    Object.keys((local && local.piles) || {}).forEach(function (k) {
      var p = local.piles[k];
      if (!p || Math.abs(+p.qty || 0) <= 1e-9) return;
      loc[p.loc] = Math.round(((loc[p.loc] || 0) + p.qty) * 1000) / 1000;
      [p.long, p.sku].forEach(function (c) { if (c) sku[c] = Math.round(((sku[c] || 0) + p.qty) * 1000) / 1000; });
    });
    return { loc: loc, sku: sku };
  }

  /* ── ตรวจตาราง ─────────────────────────────────────────────────────── */

  /**
   * เตือนรายแถว → { rows: [[{lv, t}]] ตามลำดับ list, bad: แถวสีแดง (บันทึกไม่ได้), warn: แถวสีส้ม }
   * t = ตารางทั้งสาม (ชื่อกลุ่ม) · stock = stockOf(local) (ปิดใช้แต่ยังมีของ)
   */
  function validate(kind, list, t, stock) {
    stock = stock || { loc: {}, sku: {} };
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
  function found(kind, list, local) {
    if (!local || kind === 'grp') return [];
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
    var label = function (k) { return kind === 'grp' ? (b[k] || a[k]).name || k : k; };
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
    list = (list || []).filter(function (r) { return keyOf(kind, r) || (kind === 'grp' && text(r.name)); });
    if (list.length > ROWS_MAX) return { error: 'ตาราง ' + TAB[kind] + ' ต้องมีไม่เกิน ' + ROWS_MAX + ' แถว' };
    var v = validate(kind, list, null, null);
    var red = v.rows.map(function (w, i) { return w.some(function (x) { return x.lv === 'red'; }) ? i : -1; }).filter(function (i) { return i >= 0; });
    if (red.length) {
      var r0 = list[red[0]], w0 = v.rows[red[0]].filter(function (x) { return x.lv === 'red'; })[0];
      return { error: 'แก้แถวสีแดง ' + red.length + ' แถวก่อน เช่น ' + (keyOf(kind, r0) || text(r0.name) || 'แถวว่าง') + ': ' + w0.t };
    }
    var before = cur && cur.rows ? dec(cur.rows).map(function (r) { return rowIn(kind, r); }) : (kind === 'grp' ? defaults() : []);
    var dd = diff(kind, before, list);
    var strict = opt.strict ? 1 : 0, was = cur ? +cur.strict || 0 : 0;
    var words = [];
    if (dd.text) words.push(dd.text);
    if (strict !== was && kind !== 'grp') words.push(strict ? 'ตั้งให้ ห้ามบันทึกใบที่ไม่มีในตาราง' : 'ตั้งให้ เตือนอย่างเดียว');
    if (!cur) words.unshift('ตั้งตารางครั้งแรก ' + list.length + ' แถว');
    if (!words.length) return { error: 'ไม่มีอะไรเปลี่ยน' };
    var hist = [{ at: +opt.at || 0, by: text(opt.by), name: text(opt.name), text: words.join(' · ').slice(0, 600) }]
      .concat(Array.isArray(cur && cur.hist) ? cur.hist : []).slice(0, HIST_MAX);
    var d = {
      tab: TAB[kind], cols: COLS[kind], rows: enc(list.map(function (r) { return rowOut(kind, r); })), n: list.length,
      strict: kind === 'grp' ? 0 : strict, ver: now + 1, hist: hist, by: text(opt.by), name: text(opt.name), at: C().TIME,
    };
    if (C().byteLen(JSON.stringify(d)) > DOC_BYTES) return { error: 'ตาราง ' + TAB[kind] + ' ใหญ่เกินที่เก็บได้' };
    return { data: d, diff: dd };
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
    KINDS: KINDS, TAB: TAB, COLS: COLS, REST: REST, LV: LV, PALETTE: PALETTE, SPECIAL: SPECIAL, ROWS_MAX: ROWS_MAX, HIST_MAX: HIST_MAX,
    locKind: locKind, rowIn: rowIn, rowOut: rowOut, keyOf: keyOf, blank: blank, defaults: defaults, newGroupId: newGroupId, guessGroup: guessGroup,
    read: read, index: index, stockOf: stockOf, validate: validate, found: found, diff: diff, docOf: docOf,
    rackRule: rackRule, check: check,
  };
})();
