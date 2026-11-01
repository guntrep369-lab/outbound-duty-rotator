/**
 * @file wms-tx.js — สต๊อกราย Location จากสมุดรายการ Transaction
 *
 * คนละเรื่องกับ wms-stock.js: ตัวนั้นรู้แค่ยอดรวมต่อ SKU แยก QA / NEW WH จากชีตสต๊อก
 * ตัวนี้รู้ว่าของอยู่ Location, LOT, PO ไหน และคิดต่อว่าโลเปิดจะพอขายอีกกี่วัน
 *
 * ยอดคงเหลือคิดฝั่ง Apps Script (apps-script/tx-api.gs) เพราะชีตมีหลายหมื่นแถว
 * ส่งแค่ผลลัพธ์เล็กกว่าส่งแถวดิบหลายเท่า ที่นี่แค่จัดกลุ่มและคิดสิ่งที่หน้าเว็บต้องใช้
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsTx (ต้องโหลด wms-gas.js ก่อน)
 */
(function () {
  'use strict';

  /**
   * โลที่มีความหมายเฉพาะ จึงไม่นับเป็นของสำรองที่ดึงมาเติมได้
   *   QA  — คลัง QA
   *   IQA — ของที่ลงจากตู้แล้วแบ่งให้ QA ตรวจ
   *   RIB — ของเศษพาเลทที่รอตู้รอบถัดไปมาเติมให้เต็มก่อนเก็บขึ้นชั้น
   */
  var SPECIAL = ['QA', 'IQA', 'RIB'];

  /** ขายต่ำกว่านี้ต่อวันไม่ขึ้นในรายการต้องเติม ของที่นาน ๆ ขายทีจะกลบตัวที่กำลังจะขาดจริง */
  var MIN_PER_DAY = 1;

  /**
   * Status เปิดคือโลที่สูตรตัดขายวิ่งไปตัดก่อน จึงเชื่อค่านี้ทุก Location รวมถึงจุดที่
   * ชื่อไม่เหมือนชั้นวาง เพราะในข้อมูลจริงมีแถวขายจากที่พวกนั้นเหมือนกัน
   */
  function bucketOf(loc, open) {
    var u = String(loc || '').trim().toUpperCase();
    if (SPECIAL.indexOf(u) !== -1) return u;
    return open ? 'open' : 'reserve';
  }

  /** LOT เลขน้อย = ของเก่า ทีมโอนและขายตาม FIFO — LOT 0 คือไม่รู้ LOT จึงอยู่ท้ายสุด */
  function lotRank(lot) {
    var n = Number(lot);
    return !lot || isNaN(n) ? Infinity : n;
  }

  function parse(json) {
    if (json && json.error) throw new Error('Apps Script error: ' + json.error);
    if (!json || json.app !== 'transaction' || !Array.isArray(json.keys)) {
      throw new Error('ต่อได้ แต่ไม่ใช่สคริปต์ Transaction — ตัวนี้ต้องเป็น tx-api.gs ที่ผูกกับชีต Transaction');
    }
    return json;
  }

  /**
   * คำตอบแบบย่อ → ของที่หน้าเว็บใช้ต่อ
   * @returns {{skus:Object, locs:Object, totals:Object}} skus กับ locs
   *   ใช้รหัส SKU สั้นและชื่อ Location เป็นคีย์ ยอดติดลบไม่เข้ากลุ่มไหน แต่หักอยู่ใน net
   */
  function expand(s) {
    var skus = {}, locs = {};
    var totals = { open: 0, reserve: 0, QA: 0, IQA: 0, RIB: 0, neg: 0, net: 0 };
    var openLocs = {}, reserveLocs = {}, stocked = 0;

    function skuOf(i) {
      var t = s.skus[i];
      var k = t[0] || t[1];
      return skus[k] || (skus[k] = {
        sku: k, long: t[1], name: t[2], perDay: 0, total: 0, rows: [],
        open: 0, reserve: 0, QA: 0, IQA: 0, RIB: 0,
      });
    }

    (s.sold || []).forEach(function (p) {
      if (s.saleDays) skuOf(p[0]).perDay += p[1] / s.saleDays;
    });

    s.keys.forEach(function (k) {
      var row = {
        lot: k[1], po: k[2], loc: s.locs[k[3]], qty: k[4], open: !!k[5],
        bucket: bucketOf(s.locs[k[3]], k[5]),
      };
      var sku = skuOf(k[0]);
      row.sku = sku.sku;
      sku.rows.push(row);
      sku.total += row.qty;
      totals.net += row.qty;
      if (row.qty < 0) totals.neg += row.qty;
      else {
        sku[row.bucket] += row.qty;
        totals[row.bucket] += row.qty;
        if (row.bucket === 'open') openLocs[row.loc] = 1;
        if (row.bucket === 'reserve') reserveLocs[row.loc] = 1;
      }
      var l = locs[row.loc] || (locs[row.loc] = { loc: row.loc, qty: 0, rows: [] });
      l.qty += row.qty;
      l.rows.push(row);
    });

    Object.keys(skus).forEach(function (k) {
      var x = skus[k];
      x.cover = x.perDay > 0 ? x.open / x.perDay : Infinity;
      x.rows.sort(function (a, b) {
        return order(a.bucket) - order(b.bucket) || lotRank(a.lot) - lotRank(b.lot) ||
          String(a.loc).localeCompare(String(b.loc)) || String(a.po).localeCompare(String(b.po));
      });
      if (x.total > 0) stocked++;
    });
    Object.keys(locs).forEach(function (k) {
      locs[k].rows.sort(function (a, b) { return b.qty - a.qty; });
    });

    totals.openLocs = Object.keys(openLocs).length;
    totals.reserveLocs = Object.keys(reserveLocs).length;
    totals.skus = stocked;
    totals.locs = Object.keys(locs).filter(function (k) { return locs[k].rows.some(function (r) { return r.qty > 0; }); }).length;
    return { skus: skus, locs: locs, totals: totals };
  }

  function order(bucket) { return ['open', 'reserve', 'QA', 'IQA', 'RIB'].indexOf(bucket); }

  /** ควรไปดึงจากที่ไหนก่อน: LOT เก่าสุดในของสำรอง ถ้า LOT เท่ากันเอาจุดที่มีมากสุด */
  function source(sku) {
    var g = {};
    sku.rows.forEach(function (r) {
      if (r.bucket !== 'reserve' || r.qty <= 0) return;
      var k = r.lot + '|' + r.loc;
      (g[k] = g[k] || { lot: r.lot, loc: r.loc, qty: 0 }).qty += r.qty;
    });
    var list = Object.keys(g).map(function (k) { return g[k]; });
    list.sort(function (a, b) { return lotRank(a.lot) - lotRank(b.lot) || b.qty - a.qty; });
    return list[0] || null;
  }

  /**
   * รายการต้องเติม: SKU ที่ของในโลเปิดพอขายไม่ถึงกี่วัน แยกตามว่ายังมีของสำรองให้เติมไหม
   * เรียงจากที่จะหมดก่อน และนับจำนวนที่ซ่อนไว้ให้คนรู้ว่ามีอยู่
   */
  function refill(data, days) {
    var ready = [], none = [], hiddenReady = 0, hiddenNone = 0;
    Object.keys(data.skus).forEach(function (k) {
      var x = data.skus[k];
      if (!(x.perDay > 0) || x.cover >= days) return;
      var low = x.perDay < MIN_PER_DAY;
      if (x.reserve > 0) { if (low) hiddenReady++; else ready.push(x); }
      else if (low) hiddenNone++;
      else none.push(x);
    });
    var byCover = function (a, b) { return a.cover - b.cover; };
    return { ready: ready.sort(byCover), none: none.sort(byCover), hiddenReady: hiddenReady, hiddenNone: hiddenNone };
  }

  /** ประโยคบอกความเร่งด่วนของงานเติมหนึ่งข้อ */
  function coverText(x) {
    return x.open > 0 ? 'เหลือขายอีก ' + x.cover.toFixed(1) + ' วัน' : 'ของในโลเปิดหมดแล้ว';
  }

  /** งานของ SKU ที่ไม่มีของสำรอง QA, IQA, RIB ไม่ใช่ที่ดึงมาเติมตามปกติ แต่คนควรรู้ว่ายังมีของอยู่ตรงนั้น */
  function noReserveText(x) {
    var other = x.QA + x.IQA + x.RIB;
    return other > 0 ? 'ไม่มีของบนชั้นวาง มีอยู่ที่ QA, IQA, RIB ' + fmt(other) + ' ชิ้น' : 'ไม่มีของบนชั้นวาง ต้องตามของเข้า';
  }

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ''); }

  /** ค้นได้ทั้งรหัส ชื่อสินค้า และ Location @returns {{skus:Array, locs:Array}} */
  function search(data, q) {
    var n = norm(q);
    if (!n) return { skus: [], locs: [] };
    return {
      skus: Object.keys(data.skus).map(function (k) { return data.skus[k]; }).filter(function (x) {
        return norm(x.sku).indexOf(n) !== -1 || norm(x.long).indexOf(n) !== -1 || norm(x.name).indexOf(n) !== -1;
      }),
      locs: Object.keys(data.locs).map(function (k) { return data.locs[k]; }).filter(function (l) {
        return norm(l.loc).indexOf(n) !== -1;
      }),
    };
  }

  /* ── จุดที่ข้อมูลผิด ──────────────────────────────────────────────────── */

  /** เรียงตามที่กระทบยอดมากไปน้อย ลำดับนี้คือลำดับที่แสดงบนหน้าเว็บด้วย */
  var ISSUES = [
    { kind: 'mixed',      label: 'Status ปนกัน',       note: 'จุดเดียวกันเคยรับเข้าทั้งแบบว่างและแบบเปิด สูตรในชีตยอดจะหักแถวออกซ้ำ ยอดในแอปรวมให้ถูกแล้ว' },
    { kind: 'outonly',    label: 'มีแต่แถวออก',        note: 'เบิกหรือขายออกจากจุดที่ไม่เคยมีแถวรับเข้าเลย ชีตยอดอาจไม่แสดงจุดนี้' },
    { kind: 'negative',   label: 'ยอดติดลบ',           note: 'ออกมากกว่าเข้า มักเป็นเบิกผิด Location หรือยังไม่ได้กรอกโอนเข้า' },
    { kind: 'qty',        label: 'QTY ไม่ใช่ตัวเลข',   note: 'SUMIFS ไม่นับแถวพวกนี้ ยอดจึงขาดไป' },
    { kind: 'incomplete', label: 'แถวไม่ครบ',          note: 'ช่องที่จำเป็นว่างอยู่ ถ้าเป็นแถวที่กำลังกรอกอยู่ก็ข้ามได้' },
    { kind: 'closedsale', label: 'ขายจากโลไม่เปิด',    note: 'ขายจากจุดที่ตอนนั้นไม่ได้เปิดขาย หรือจาก QA, IQA, RIB' },
    { kind: 'locname',    label: 'ชื่อ Location แปลก', note: 'ชื่อที่เขียนต่างจากชื่ออื่นแค่ขีดหรือเว้นวรรค หรือชื่อที่ไม่ตรงรูปแบบชั้นวางและใช้น้อยมาก' },
    { kind: 'date',       label: 'วันที่น่าสงสัย',     note: 'วันที่ GR ห่างจากแถวขายรอบข้างมากผิดปกติ มักเป็นเดือนหรือปีที่พิมพ์ผิด' },
  ];

  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

  function where(i) {
    return i.sku + ' lot ' + i.lot + (i.po && i.po !== '0' ? ' PO ' + i.po : '') + ' ที่ ' + i.loc;
  }

  /** ข้อความของรายการหนึ่งบรรทัด */
  function describeIssue(i) {
    switch (i.kind) {
      case 'mixed': return where(i) + ' เข้าแบบว่าง ' + fmt(i.blank) + ' แบบเปิด ' + fmt(i.open) + ' ออก ' + fmt(i.out) + ' ยอดจริงคือ ' + fmt(i.bal);
      case 'outonly':
      case 'negative': return where(i) + ' ติดลบ ' + fmt(Math.abs(i.bal));
      case 'qty': return i.sku + ' lot ' + i.lot + ' ที่ ' + i.loc + ' กรอกว่า "' + i.value + '"';
      case 'incomplete': return (i.sku || 'ไม่มีรหัส') + ' ไม่มี ' + i.what;
      case 'closedsale': return where(i) + ' ขายออก ' + fmt(i.sold);
      case 'locname': return i.like ? i.name + ' น่าจะเป็นที่เดียวกับ ' + i.like : i.name + ' ใช้แค่ ' + i.rowCount + ' แถว';
      case 'date': return i.note + ' ' + i.rowCount + ' แถว อยู่ปนกับแถวขายวันที่ ' + shortDate(i.near);
      default: return '';
    }
  }

  /** ลิงก์เปิดชีตตรงแถวนั้น แปะ #range ต่อท้าย URL ของไฟล์ได้โดยไม่ต้องรู้รหัสอื่น */
  function rowUrl(sheet, row) {
    if (!sheet || !sheet.url) return '';
    return String(sheet.url).split('#')[0] + '#gid=' + sheet.gid + '&range=A' + row;
  }

  /** 2026-10-30 → 30/10 ปีซ้ำกันเกือบทุกแถว จึงไม่ต้องกินที่บนจอ */
  function shortDate(ymd) {
    var p = String(ymd || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] : '';
  }

  /** M/E คือเลขออเดอร์งาน Event ที่รับเข้าเพื่อให้ตัดสต๊อกชนกัน ไม่ใช่การรับของจริงจากตู้ */
  function isEvent(note) { return /M\/E/i.test(String(note || '')); }

  /** Backup ตั้งไว้ทุกคืน ถ้าหายไปเกินสองวันแปลว่าตัวตั้งเวลาน่าจะหยุด ต้องบอกก่อนถึงวันที่ต้องใช้จริง */
  function backupState(backup, now) {
    if (!backup || !backup.at) return { ok: false, days: null };
    var days = Math.floor((now - backup.at) / 86400000);
    return { ok: days < 2, days: days };
  }

  /* ── แคชของรอบนี้ ───────────────────────────────────────────────────────
     sessionStorage ด้วยเหตุผลเดียวกับสต๊อก: ยอดเป็นตัวเลขของ "ตอนนี้" ปิดเบราว์เซอร์แล้วต้องหาย */
  var KEY = 'wms:tx:summary';

  function read() {
    try {
      var o = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return o && Array.isArray(o.keys) ? o : null;
    } catch (e) { return null; }
  }

  function save(s) {
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); }
    catch (e) { console.warn('เก็บยอด Transaction ไม่ได้ —', e.message); }
  }

  async function pull(url, opts) {
    var s = parse(await window.WmsGas.json(url, 'tx-summary', opts));
    save(s);
    return s;
  }

  /** ประวัติดึงทีละ SKU ตอนกดดู ส่งแถวของทุก SKU มาตั้งแต่แรกจะหนักเกินจำเป็น */
  async function pullHistory(url, sku, opts) {
    var u = String(url).trim();
    var full = u + (u.indexOf('?') === -1 ? '?' : '&') + 'sku=' + encodeURIComponent(sku);
    var r = await window.WmsGas.json(full, 'tx-history', opts);
    if (r && r.error) throw new Error('Apps Script error: ' + r.error);
    return r;
  }

  window.WmsTx = {
    SPECIAL: SPECIAL,
    MIN_PER_DAY: MIN_PER_DAY,
    ISSUES: ISSUES,
    KEY: KEY,
    bucketOf: bucketOf,
    lotRank: lotRank,
    parse: parse,
    expand: expand,
    source: source,
    refill: refill,
    coverText: coverText,
    noReserveText: noReserveText,
    search: search,
    describeIssue: describeIssue,
    rowUrl: rowUrl,
    shortDate: shortDate,
    isEvent: isEvent,
    backupState: backupState,
    read: read,
    save: save,
    pull: pull,
    pullHistory: pullHistory,
    savedUrl: function () { return window.WmsSettings ? WmsSettings.txUrl() : ''; },
  };
})();
