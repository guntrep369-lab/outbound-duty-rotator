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

  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

  /** แต่ละเรื่องมีคอลัมน์ของตัวเอง ให้กวาดตาลงทีละช่องได้ ไม่ต้องไล่อ่านทีละประโยค ช่องที่ไม่มีค่าแสดงเป็นขีด */
  function col(label, pick, num) {
    return {
      label: label,
      num: !!num,
      value: function (i) {
        var v = pick(i);
        return v === '' || v === undefined || v === null ? '–' : String(v);
      },
    };
  }
  function field(label, key) { return col(label, function (i) { return i[key]; }); }
  function amount(label, key) { return col(label, function (i) { return fmt(i[key]); }, true); }

  var SKU = field('SKU', 'sku');
  var LOT = field('Lot', 'lot');
  var LOC = field('Location', 'loc');
  var WHERE = [SKU, LOT, col('PO', function (i) { return i.po === '0' ? '' : i.po; }), LOC];
  var NEGATIVE = WHERE.concat(col('ติดลบ', function (i) { return fmt(Math.abs(i.bal)); }, true));

  /** เรียงตามที่กระทบยอดมากไปน้อย ลำดับนี้คือลำดับที่แสดงบนหน้าเว็บด้วย */
  var ISSUES = [
    { kind: 'baddate',    label: 'วันที่ขายอ่านไม่ออก', note: 'ยอดขายของแถวพวกนี้ไม่ถูกนับ รายการต้องเติมจึงอาจขาดไป',
      cols: [field('กรอกว่า', 'note'), amount('จำนวนแถว', 'rowCount')] },
    { kind: 'mixed',     label: 'Status ปนกัน',       note: 'จุดเดียวกันเคยรับเข้าทั้งแบบว่างและแบบเปิด สูตรในชีตยอดจะหักแถวออกซ้ำ ยอดในแอปรวมให้ถูกแล้ว',
      cols: WHERE.concat(amount('เข้าแบบว่าง', 'blank'), amount('เข้าแบบเปิด', 'open'), amount('ออก', 'out'), amount('ยอดจริง', 'bal')) },
    { kind: 'outonly',    label: 'มีแต่แถวออก',        note: 'เบิกหรือขายออกจากจุดที่ไม่เคยมีแถวรับเข้าเลย ชีตยอดอาจไม่แสดงจุดนี้',
      cols: NEGATIVE },
    { kind: 'negative',   label: 'ยอดติดลบ',           note: 'ออกมากกว่าเข้า มักเป็นเบิกผิด Location หรือยังไม่ได้กรอกโอนเข้า',
      cols: NEGATIVE },
    { kind: 'qty',        label: 'QTY ไม่ใช่ตัวเลข',   note: 'SUMIFS ไม่นับแถวพวกนี้ ยอดจึงขาดไป',
      cols: [SKU, LOT, LOC, field('กรอกว่า', 'value')] },
    { kind: 'incomplete', label: 'แถวไม่ครบ',          note: 'ช่องที่จำเป็นว่างอยู่ ถ้าเป็นแถวที่กำลังกรอกอยู่ก็ข้ามได้',
      cols: [col('SKU', function (i) { return i.sku || 'ไม่มีรหัส'; }), field('ช่องที่ขาด', 'what')] },
    { kind: 'closedsale', label: 'ขายจากโลไม่เปิด',    note: 'ขายจากจุดที่ตอนนั้นไม่ได้เปิดขาย หรือจาก QA, IQA, RIB',
      cols: WHERE.concat(amount('ขายออก', 'sold')) },
    { kind: 'locname',    label: 'ชื่อ Location แปลก', note: 'ชื่อที่เขียนต่างจากชื่ออื่นแค่ขีดหรือเว้นวรรค หรือชื่อที่ไม่ตรงรูปแบบชั้นวางและใช้น้อยมาก',
      cols: [field('ชื่อ', 'name'), col('พบว่า', function (i) {
        return i.like ? 'น่าจะเป็นที่เดียวกับ ' + i.like : 'ใช้แค่ ' + fmt(i.rowCount) + ' แถว';
      })] },
    { kind: 'date',       label: 'วันที่น่าสงสัย',     note: 'วันที่ GR ห่างจากแถวขายรอบข้างมากผิดปกติ มักเป็นเดือนหรือปีที่พิมพ์ผิด',
      cols: [field('Note', 'note'), amount('จำนวนแถว', 'rowCount'), col('แถวขายรอบข้าง', function (i) { return shortDate(i.near); })] },
  ];

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

  /* ── นับสต๊อก ───────────────────────────────────────────────────────────── */

  var DIFF_SRC = 'เทียบระบบ';    // ที่มาของรายการที่ส่งจากแท็บเทียบสต๊อก ต้องตรงกับ COUNT_DIFF_SRC ในสคริปต์
  var ELSEWHERE = 'ที่อื่น';      // ต้องตรงกับ COUNT_ELSEWHERE ในสคริปต์

  function isCounted(l) { return typeof l.qty === 'number'; }

  /**
   * สรุปผลนับ
   *
   * ความแม่นยำคิดจากรายการสุ่มเท่านั้น รายการเสี่ยงเลือกมาจากจุดที่น่าจะผิดอยู่แล้ว ส่วนรายการนับซ้ำ
   * คือของที่เคยไม่ตรง เอามารวมตัวเลขจะต่ำกว่าความจริงของทั้งคลัง
   *
   * off คือรายการวันก่อนที่ผลล่าสุดยังไม่ตรง ถ้าส่ง raw มาด้วยและยอดตอนนี้เท่าที่นับได้แล้ว
   * แปลว่าแก้ในชีตเรียบร้อย จึงเอาออกจากรายการที่ต้องตาม
   */
  function countStats(data, raw) {
    var lines = data.lines;
    var todays = lines.filter(function (l) { return l.date === data.today; });
    var sample = lines.filter(function (l) { return isCounted(l) && l.src === 'สุ่ม'; });
    var match = sample.filter(function (l) { return l.diff === 0; }).length;

    /* รายการเทียบระบบมีผลของตัวเองที่แท็บเทียบสต๊อก ไม่ใช่งานที่รอนับซ้ำหรือรอแก้แบบรายการอื่น */
    var latest = {};
    lines.filter(function (l) { return isCounted(l) && l.src !== DIFF_SRC; }).forEach(function (l) { latest[l.k] = l; });
    var now = raw ? balanceMap(raw) : null;
    var off = Object.keys(latest).map(function (k) { return latest[k]; }).filter(function (l) {
      if (l.diff === 0 || l.date === data.today) return false;
      return !now || (now[l.k] || 0) !== l.qty;
    }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });

    return {
      total: todays.length,
      todo: todays.filter(function (l) { return !isCounted(l); }),
      done: todays.filter(isCounted),
      sample: sample.length,
      match: match,
      accuracy: sample.length ? Math.round(match / sample.length * 100) : null,
      off: off,
    };
  }

  /** ยอดปัจจุบันตามคีย์เดียวกับสคริปต์ คีย์ที่ยอดเป็นศูนย์ไม่ถูกส่งมา จึงไม่มีในตารางนี้ */
  function balanceMap(raw) {
    var map = {};
    function same(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }
    raw.keys.forEach(function (x) {
      map[[same(raw.skus[x[0]][1]), same(x[1]), same(x[2]), same(raw.locs[x[3]])].join('|')] = x[4];
    });
    return map;
  }

  /** 3 → +3, -3 → -3, 0 → ตรง */
  function diffText(n) { return n === 0 ? 'ตรง' : (n > 0 ? '+' : '') + fmt(n); }

  /** ตัวเลขที่กรอกค้างไว้ อยู่ข้ามการรีเฟรชหรือมือถือปิดแท็บเอง แต่ใช้ได้แค่กับรายการของวันเดียวกัน */
  var DRAFT_KEY = 'wms:tx:count:draft';

  function readDraft(date) {
    try {
      var o = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      return o && o.date === date && o.items ? o.items : {};
    } catch (e) { return {}; }
  }

  function saveDraft(date, items) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ date: date, items: items })); }
    catch (e) { console.warn('เก็บตัวเลขที่กรอกค้างไม่ได้ —', e.message); }
  }

  var OLD_SCRIPT = 'สคริปต์ยังเป็นรุ่นเก่า — วาง tx-api.gs รุ่นล่าสุดแล้ว Deploy เป็น New version';

  function countReply(r) {
    if (r && r.error) throw new Error('Apps Script error: ' + r.error);
    if (!r || !Array.isArray(r.lines)) throw new Error(OLD_SCRIPT);
    return r;
  }

  async function pullCount(url, opts) {
    return countReply(await window.WmsGas.json(url, 'tx-count', opts));
  }

  async function saveCount(url, date, items, opts) {
    return countReply(await window.WmsGas.post(url, { op: 'count-save', date: date, who: counterName(), items: items }, opts));
  }

  /** ส่ง SKU ที่ไม่ตรงเข้าใบนับ @param rows แถวจาก compareStock */
  async function addCount(url, rows, opts) {
    var items = rows.map(function (r) { return { sku: r.sku, longs: r.longs, name: r.name }; });
    var r = await window.WmsGas.post(url, { op: 'count-add', items: items }, opts);
    if (r && r.error === 'ไม่รู้จักคำสั่งนี้') throw new Error(OLD_SCRIPT);
    return countReply(r);
  }

  /** ชื่อที่ลงชื่อเข้าระบบไว้บนเครื่องนี้ ตัวจับเวลาหมดอายุเป็นเรื่องของ wms-gate */
  function counterName() {
    try { return JSON.parse(localStorage.getItem('wms:session') || '{}').name || ''; }
    catch (e) { return ''; }
  }

  /* ── เทียบกับระบบบริษัท ──────────────────────────────────────────────────── */

  function code(s) { return String(s === null || s === undefined ? '' : s).toUpperCase().replace(/\s+/g, ''); }

  /** ทิศทางของยอดที่ต่าง พร้อมสาเหตุที่น่าจะเป็น ลำดับนี้คือลำดับที่แสดงบนหน้าเว็บ */
  var DIFFS = [
    { kind: 'more',    label: 'ระบบบริษัทมากกว่า',   note: 'ชีตตัดออกเกินหรือรับเข้าไม่ครบ หรือระบบบริษัทยังไม่ได้ตัด' },
    { kind: 'less',    label: 'Transaction มากกว่า', note: 'ระบบบริษัทตัดไปแล้วแต่ชีตยังไม่ลง หรือชีตรับเข้าซ้ำ' },
    { kind: 'sysonly', label: 'มีแค่ในระบบบริษัท',   note: 'ชีตเหลือ 0 หรือไม่มี SKU นี้ ทั้งที่ระบบบริษัทยังมีของ' },
    { kind: 'txonly',  label: 'มีแค่ใน Transaction', note: 'ชีตยังมีของ แต่ระบบบริษัทเหลือ 0 หรือไม่มีรหัสนี้' },
  ];

  /** ปัญหาในชีตที่ทำให้ยอดรวมของ SKU เพี้ยนได้จริง เรื่องอื่นใน ISSUES ไม่กระทบยอดรวม */
  var BREAKS = ['qty', 'incomplete'];

  /** ต่างแค่ 1 ชิ้น มีจุดที่เหลือ 1 ชิ้นเท่ากันได้ทุก SKU เบาะแสจึงไม่มีความหมาย */
  var MIN_CLUE = 2;
  /** ถ้าเท่ากันหลายจุดเกินนี้ก็บอกไม่ได้ว่าจุดไหน ไม่ต้องแสดง */
  var MAX_CLUE_LOCS = 2;

  /** ของใช้ภายในไม่ได้เข้าสต๊อกระบบบริษัท และรหัสในชีตเป็นคำไทยที่ตั้งกันเอง ส่วนสินค้าจริงใช้รหัสอังกฤษกับเลข */
  var THAI = /[฀-๿]/;

  /** Location ที่ถ้าตัดออกจากยอดชีตแล้วสองฝั่งเท่ากันพอดี เช่นของที่ระบบบริษัทตัดแล้วแต่ในชีตยังวางอยู่จุดรอส่ง */
  function equalsAt(lines, diff) {
    if (Math.abs(diff) < MIN_CLUE) return [];
    var sums = {}, hit = {};
    lines.forEach(function (l) {
      sums[l.loc] = (sums[l.loc] || 0) + l.qty;
      if (l.qty === -diff) hit[l.loc] = 1;
    });
    Object.keys(sums).forEach(function (loc) { if (sums[loc] === -diff) hit[loc] = 1; });
    var list = Object.keys(hit);
    return list.length > MAX_CLUE_LOCS ? [] : list;
  }

  /**
   * ชนยอดสต๊อกคงเหลือจากระบบบริษัทกับยอดจากชีต Transaction ราย SKU
   *
   * ระบบบริษัทรู้แค่ตัวเลข ไม่รู้ Location จึงเทียบได้แค่ยอดรวมของ SKU และต้องหักจุดติดลบด้วย
   * เพราะกรอก LOT ผิดจะเป็นบวกจุดหนึ่ง ลบอีกจุดหนึ่งของของชิ้นเดียวกัน ยอดรวมยังถูก
   *
   * ชีตมีรหัสสองคอลัมน์ จึงจับคู่ทีละ SKU ลองรหัสเต็มก่อนแล้วค่อยรหัสสั้น
   * ยังไม่เทียบแยก QA / NEW WH เพราะคลัง QA ในระบบบริษัทไม่ได้ตรงกับ Location QA ในชีตเสมอไป
   *
   * @param raw คำตอบ tx-summary
   * @param stock map จาก WmsStock คือ sku → {sku,description,qa,newwh,total}
   * @returns {{rows:Array, internal:Array, same:number, counts:Object, sys:number, tx:number, off:number, found:number, ledger:number}}
   *   rows คือ SKU ที่ไม่ตรง เรียงจากต่างมากสุด ส่วน found / ledger คือ SKU ที่มียอดในชีตและหาเจอในระบบบริษัท
   *   internal คือของใช้ภายในที่ไม่นำมาเทียบ ไม่รวมในตัวเลขอื่นทั้งหมด
   */
  function compareStock(raw, stock) {
    var sys = {};
    Object.keys(stock).forEach(function (k) { sys[code(k)] = stock[k]; });

    var groups = {};
    function groupOf(t) {
      var c = sys[code(t[1])] ? code(t[1]) : sys[code(t[0])] ? code(t[0]) : code(t[0] || t[1]);
      return groups[c] || (groups[c] = { ledger: t[0] || t[1], long: t[1], longs: [], name: t[2], tx: 0, neg: 0, lines: [], breaks: [] });
    }

    var byShort = {};
    raw.skus.forEach(function (t) {
      var g = groupOf(t);
      byShort[code(t[0] || t[1])] = g;
      if (t[1]) g.longs.push(t[1]);
    });
    raw.keys.forEach(function (k) {
      var g = groupOf(raw.skus[k[0]]);
      g.tx += k[4];
      if (k[4] < 0) g.neg++;
      g.lines.push({ loc: raw.locs[k[3]], qty: k[4] });
    });
    raw.issues.list.forEach(function (i) {
      var g = byShort[code(i.sku)];
      if (!g || BREAKS.indexOf(i.kind) === -1) return;
      var def = ISSUES.filter(function (x) { return x.kind === i.kind; })[0];
      g.breaks.push({ label: def.label, rows: i.rows });
    });
    Object.keys(sys).forEach(function (c) {
      if (!groups[c]) groups[c] = { ledger: '', long: '', longs: [], name: '', tx: 0, neg: 0, lines: [], breaks: [] };
    });

    var out = { rows: [], internal: [], same: 0, counts: { more: 0, less: 0, sysonly: 0, txonly: 0 }, sys: 0, tx: 0, off: 0, found: 0, ledger: 0 };
    Object.keys(groups).forEach(function (c) {
      var g = groups[c], s = sys[c];
      var n = s ? (s.total || s.qa + s.newwh) : 0;
      /* วันไหนระบบบริษัทมียอดของรหัสนี้ ก็กลับมาเทียบตามปกติ */
      if (!n && g.tx && (THAI.test(g.ledger) || THAI.test(g.long))) {
        out.internal.push({ sku: g.ledger, name: g.name, tx: g.tx });
        return;
      }
      out.sys += n;
      out.tx += g.tx;
      if (g.tx !== 0) { out.ledger++; if (s) out.found++; }
      if (!n && !g.tx) return;
      var diff = n - g.tx;
      if (!diff) { out.same++; return; }
      var kind = !g.tx ? 'sysonly' : !n ? 'txonly' : diff > 0 ? 'more' : 'less';
      out.counts[kind]++;
      out.off += Math.abs(diff);
      var spots = {};
      g.lines.forEach(function (l) { spots[l.loc] = 1; });
      out.rows.push({
        sku: g.ledger || s.sku, ledger: g.ledger, long: g.long, longs: g.longs, name: g.name || (s ? s.description : ''),
        id: code(g.longs.join(',') || g.ledger || s.sku), spots: Object.keys(spots).length,
        sys: n, qa: s ? s.qa : 0, newwh: s ? s.newwh : 0, tx: g.tx, diff: diff, kind: kind,
        /* ระบบบริษัทเป็น 0 ทุกจุดในชีตคือส่วนที่ต่าง การบอกว่าเท่าจุดไหนจึงไม่ได้ช่วยแคบลง */
        neg: g.neg, breaks: g.breaks, equalsAt: n ? equalsAt(g.lines, diff) : [],
      });
    });
    out.rows.sort(function (a, b) {
      return Math.abs(b.diff) - Math.abs(a.diff) || String(a.sku).localeCompare(String(b.sku));
    });
    out.internal.sort(function (a, b) { return b.tx - a.tx; });
    return out;
  }

  /** ผลของการส่งไปนับ ลำดับนี้คือลำดับที่แสดงบนหน้าเว็บ งานที่ต้องตามต่อมาก่อน */
  var COUNT_STATES = [
    { state: 'sheet',   label: 'Transaction ผิด', todo: 'ของจริงตรงกับระบบบริษัท แก้ในชีต Transaction' },
    { state: 'company', label: 'ระบบบริษัทผิด',   todo: 'ของจริงตรงกับ Transaction แจ้งคนดูแลระบบบริษัท' },
    { state: 'both',    label: 'ไม่ตรงทั้งคู่',    todo: 'นับซ้ำอีกรอบ ถ้ายังเท่าเดิมค่อยแก้ทั้งสองฝั่ง' },
    { state: 'wait',    label: 'รอนับ',           todo: '' },
    { state: 'late',    label: 'นับไม่ครบ',       todo: 'รอบนี้หมดอายุแล้ว ส่งเข้าใบนับใหม่' },
  ];

  /** รอบล่าสุดของแต่ละ SKU: ใช้วันล่าสุด และถ้าวันเดียวกันส่งซ้ำ ใช้แถวหลังสุดของแต่ละจุด */
  function diffBatches(lines) {
    var out = {};
    lines.forEach(function (l) {
      if (l.src !== DIFF_SRC) return;
      var id = code(l.long);
      var b = out[id];
      if (!b || l.date > b.date) b = out[id] = { date: l.date, spots: {} };
      if (l.date === b.date) b.spots[l.loc] = l;
    });
    return out;
  }

  /**
   * ของจริงตรงกับฝั่งไหน
   *
   * เทียบผลต่างแทนยอดตรง ๆ เพราะยอดของวันที่นับกับยอดตอนเปิดดูอาจห่างกัน ขายหลังนับแล้วสองฝั่งลดเท่ากัน
   * ผลรวมช่องต่าง = ของจริง − Transaction ถ้าเป็น 0 ของจริงเท่า Transaction
   * ถ้าเท่า ระบบบริษัท − Transaction ของจริงก็เท่าระบบบริษัท
   */
  function countVerdict(row, b, today) {
    var spots = Object.keys(b.spots).map(function (k) { return b.spots[k]; });
    var done = spots.filter(isCounted);
    var v = { date: b.date, done: done.length, total: spots.length };
    if (done.length < spots.length) {
      v.state = b.date === today ? 'wait' : 'late';
      return v;
    }
    v.qty = done.reduce(function (a, l) { return a + l.qty; }, 0);
    v.off = done.reduce(function (a, l) { return a + l.diff; }, 0);
    v.state = v.off === 0 ? 'company' : v.off === row.diff ? 'sheet' : 'both';
    return v;
  }

  /** ติดผลนับให้แถวจาก compareStock แถวที่ไม่เคยส่งนับได้ count เป็น null */
  function attachCounts(rows, data) {
    var batches = data ? diffBatches(data.lines) : {};
    rows.forEach(function (r) {
      var b = batches[r.id];
      r.count = b ? countVerdict(r, b, data.today) : null;
    });
    return rows;
  }

  /** ตัวที่รอนับอยู่ส่งซ้ำไม่ได้ ตัวอื่นส่งได้ รวมถึงตัวที่นับแล้วและอยากนับอีกรอบ */
  function canSend(r) { return !r.count || r.count.state !== 'wait'; }

  /**
   * กรองรายการที่ไม่ตรงตามแบบ คำค้น และผลนับ ค้นได้ทั้งรหัสสองแบบและชื่อสินค้า
   * @param state 'none' คือยังไม่เคยส่งนับ ที่เหลือคือค่าใน COUNT_STATES
   */
  function filterDiff(rows, kind, q, state) {
    var n = norm(q);
    return rows.filter(function (r) {
      if (kind && r.kind !== kind) return false;
      if (state && (r.count ? r.count.state : 'none') !== state) return false;
      return !n || norm(r.sku).indexOf(n) !== -1 || norm(r.long).indexOf(n) !== -1 || norm(r.name).indexOf(n) !== -1;
    });
  }

  window.WmsTx = {
    DIFFS: DIFFS,
    DIFF_SRC: DIFF_SRC,
    ELSEWHERE: ELSEWHERE,
    COUNT_STATES: COUNT_STATES,
    compareStock: compareStock,
    attachCounts: attachCounts,
    canSend: canSend,
    filterDiff: filterDiff,
    addCount: addCount,
    countStats: countStats,
    diffText: diffText,
    readDraft: readDraft,
    saveDraft: saveDraft,
    pullCount: pullCount,
    saveCount: saveCount,
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
