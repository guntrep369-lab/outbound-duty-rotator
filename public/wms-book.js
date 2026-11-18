/**
 * @file wms-book.js — สมุดสต๊อก ขั้น 1: ตัดขายจากไฟล์ออเดอร์ (ตรรกะล้วน ไม่แตะหน้าจอ)
 *
 * ไฟล์ export สองระบบ
 *   JST  InoutManageItems….xlsx  หมายเลขออเดอร์ภายใน + รหัสสินค้า + จำนวนสินค้า + วันที่ออกจากคลังสินค้า
 *   CRM  อัพโหลดออเดอร์ ….xlsx    Order ID + SKU + จำนวน + วันที่ (Tue, Nov 10)
 * หนึ่งบรรทัดออเดอร์ = ระบบ + เลขออเดอร์ + SKU ใช้กันตัดซ้ำ (book-api.gs เก็บไว้)
 *
 * กองที่ตัด มาจากคำตอบ tx-fifo ของ tx-api.gs (อ่านอย่างเดียว) กติกายอดเดียวกับ balances_
 *   เข้าที่ Location รับทุกประเภท ออกที่ Location เบิกเฉพาะเบิกกับขาย
 *   กอง = SKU + LOT + PO ตัวเต็ม (ไม่ตัด -01 ทิ้ง) + Location · กองเปิด = แถวรับเข้าล่าสุดของกองนั้นเป็น Status เปิด
 * ลำดับที่ตัด: LOT 0 ก่อน (ของคืน แบบแท็บช่วยเดิม) → วันรับเข้าแรกของ LOT/PO นั้นเก่าสุด → โลพื้น/ชั้นวาง → LOT → PO
 * ไม่ตัดจาก QA IQA RIB OFFICE จอง · บรรทัดที่ของเปิดไม่พอทั้งบรรทัด ไม่ตัดเลย (ขาดของ) ไว้ตัดรอบหน้า
 *
 * แถวที่คัดลอกไปวางในชีต Transaction เดิม คอลัมน์ A–N:
 *   A SKU · B C ว่าง (สูตร) · D LOT · E PO · F Location เบิก · G ว่าง · H ชิ้น · I ขาย · J วันที่ · K เปิด · L ว่าง (สูตร) · M NAME · N เลขที่
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsBook
 */
(function () {
  'use strict';

  /* ต้องตรงกับ VERSION ใน apps-script/book-api.gs */
  var API_V = 1;

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function round(n) { return Math.round(n * 1000) / 1000; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dayNo(s) { var p = String(s).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }

  /** โลที่ไม่ตัดขายออก: ของรอตรวจ ของรอซ่อม ของในออฟฟิศ ของที่จองไว้ */
  function cuttable(loc) {
    var L = up(loc);
    return !!L && !/^(QA|IQA|RIB)\b/.test(L) && !/^OFFICE/.test(L) && !/^จอง/.test(L);
  }
  /** โลพื้น A–D กับชั้นวาง S ที่คนหยิบของขายประจำ */
  function pickZone(loc) { return /^[A-DS]-/.test(up(loc)); }

  /* ── อ่านไฟล์ออเดอร์ ─────────────────────────────────────────────────── */

  function cellText(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  /** หาคอลัมน์จากหัวตาราง ชื่อตรงตัวก่อน (กัน สถานะ ชนกับ สถานะขนส่ง) แล้วค่อยแบบมีคำนั้น */
  function col(head, names) {
    var h = head.map(function (v) { return cellText(v).toLowerCase(); });
    for (var i = 0; i < names.length; i++) {
      var j = h.indexOf(names[i].toLowerCase());
      if (j >= 0) return j;
    }
    return -1;
  }

  var SPEC = {
    JST: {
      need: { order: ['หมายเลขออเดอร์ภายใน'], sku: ['รหัสสินค้า'], qty: ['จำนวนสินค้า'] },
      opt: { ref: ['หมายเลขคำสั่งซื้อออนไลน์'], status: ['สถานะ'], out: ['วันที่ออกจากคลังสินค้า'], name: ['ชื่อสินค้า'],
        carrier: ['บริษัทขนส่ง'], wh: ['คลัง'] },
    },
    CRM: {
      need: { order: ['Order ID'], sku: ['SKU'], qty: ['จำนวน'] },
      opt: { date: ['วันที่'], carrier: ['ขนส่ง'], brand: ['แบรนด์'], size: ['ขนาด'] },
    },
  };

  /** แถวหัวตารางกับระบบ ดูแค่ 10 แถวแรก ไม่เจอคืน null */
  function findHead(grid) {
    for (var r = 0; r < Math.min(grid.length, 10); r++) {
      var head = grid[r] || [];
      for (var sys in SPEC) {
        var need = SPEC[sys].need, ok = true, cols = {};
        for (var k in need) { cols[k] = col(head, need[k]); if (cols[k] < 0) ok = false; }
        if (!ok) continue;
        for (var o in SPEC[sys].opt) cols[o] = col(head, SPEC[sys].opt[o]);
        return { row: r, sys: sys, cols: cols };
      }
    }
    return null;
  }

  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /**
   * วันที่ในไฟล์ → yyyy-mm-dd อ่านไม่ได้ ''
   * รับ 2026-11-10 17:15:43, 10/11/2026, เลขวันที่ของ Excel, Date, และ Tue, Nov 10 (ไม่มีปี: ใช้ปีที่ทำให้ไม่ไกลจาก today)
   */
  function dateOf(v, today) {
    if (v instanceof Date && !isNaN(v.getTime())) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 30000 && v < 80000) {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    var s = cellText(v), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return ymd(+m[3] > 2400 ? +m[3] - 543 : +m[3], +m[2], +m[1]);
    if ((m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/.exec(s)) && MON[m[1].toLowerCase()]) {
      var mo = MON[m[1].toLowerCase()], dd = +m[2];
      if (m[3]) return ymd(+m[3], mo, dd);
      var t = String(today || '');
      var y = /^\d{4}/.test(t) ? +t.slice(0, 4) : new Date().getFullYear();
      var out = ymd(y, mo, dd);
      if (t && dayNo(out) - dayNo(t) > 31) out = ymd(y - 1, mo, dd);
      return out;
    }
    return '';
  }

  function qtyOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = cellText(v).replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : NaN;
  }

  /** เลขออเดอร์จากเซลล์ เลขล้วนที่ Excel เก็บเป็นตัวเลขไม่ให้มี .0 ต่อท้าย */
  function orderOf(v) {
    if (typeof v === 'number' && isFinite(v)) return String(Math.round(v));
    return up(cellText(v));
  }

  /**
   * ตารางจากไฟล์ (แถว × ช่อง) → บรรทัดออเดอร์
   * @returns {{sys, cols, head, lines:[{sys, order, ref, sku, qty, date, at, n, name, carrier}], skipped:[{n, why}], dates:{}, error?}}
   */
  function parseOrders(grid, opt) {
    var o = opt || {};
    grid = Array.isArray(grid) ? grid : [];
    var h = findHead(grid);
    if (!h) return { error: 'ไม่เจอหัวตารางของไฟล์ JST (หมายเลขออเดอร์ภายใน รหัสสินค้า จำนวนสินค้า) หรือ CRM (Order ID SKU จำนวน)', lines: [], skipped: [], dates: {} };
    var c = h.cols, lines = [], skipped = [], dates = {}, whs = {};
    for (var r = h.row + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      if (!row.some(function (v) { return cellText(v); })) continue;
      var n = r + 1;
      var sku = up(cellText(row[c.sku])), order = orderOf(row[c.order]), qty = qtyOf(row[c.qty]);
      if (!sku || !order) { skipped.push({ n: n, why: 'ไม่มี ' + (!order ? 'เลขออเดอร์' : 'SKU') }); continue; }
      if (!(qty > 0)) { skipped.push({ n: n, why: 'จำนวนไม่ใช่ตัวเลขที่มากกว่า 0 (' + cellText(row[c.qty]) + ')' }); continue; }
      var date = '', at = '';
      if (h.sys === 'JST') {
        var st = c.status >= 0 ? cellText(row[c.status]) : '';
        if (st && st !== 'จัดส่งแล้ว') { skipped.push({ n: n, why: 'สถานะ ' + st }); continue; }
        var out = c.out >= 0 ? row[c.out] : '';
        date = dateOf(out, o.today);
        at = typeof out === 'string' ? cellText(out) : date;
        if (c.wh >= 0) { var w = cellText(row[c.wh]); if (w) whs[w] = (whs[w] || 0) + 1; }
      } else {
        date = c.date >= 0 ? dateOf(row[c.date], o.today) : '';
        at = date;
      }
      if (date) dates[date] = (dates[date] || 0) + 1;
      lines.push({
        sys: h.sys, order: order, ref: c.ref >= 0 ? orderOf(row[c.ref]) : '', sku: sku, qty: qty, date: date, at: at, n: n,
        name: c.name >= 0 ? cellText(row[c.name]) : [cellText(row[c.brand]), cellText(row[c.size])].filter(Boolean).join(' '),
        carrier: c.carrier >= 0 ? cellText(row[c.carrier]) : '',
      });
    }
    return { sys: h.sys, cols: c, head: h.row, lines: lines, skipped: skipped, dates: dates, whs: whs };
  }

  /** ข้อความที่คัดลอกจาก Excel (แท็บคั่น) → ตาราง */
  function gridOf(text) {
    return String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.split('\t'); });
  }

  function key(l) { return l.sys + '|' + l.order + '|' + l.sku; }

  /** หลายไฟล์รวมกัน บรรทัดระบบ + ออเดอร์ + SKU เดียวกันรวมชิ้น (ไฟล์ CRM มีบรรทัดซ้ำในออเดอร์เดียว) */
  function merge(files) {
    var byKey = {}, list = [], dupLines = 0;
    (files || []).forEach(function (f) {
      (f.lines || []).forEach(function (l) {
        var k = key(l);
        var e = byKey[k];
        if (e) { e.qty = round(e.qty + l.qty); e.dup++; dupLines++; return; }
        e = byKey[k] = { sys: l.sys, order: l.order, ref: l.ref, sku: l.sku, qty: l.qty, date: l.date, at: l.at, n: l.n,
          name: l.name, carrier: l.carrier, file: f.name || '', dup: 0, key: k };
        list.push(e);
      });
    });
    return { lines: list, dup: dupLines };
  }

  /** วันที่ที่มีบรรทัดมากสุดในทุกไฟล์ (ค่าเริ่มของวันที่ตัด) */
  function mainDate(files) {
    var t = {};
    (files || []).forEach(function (f) { Object.keys(f.dates || {}).forEach(function (d) { t[d] = (t[d] || 0) + f.dates[d]; }); });
    var best = '';
    Object.keys(t).forEach(function (d) { if (!best || t[d] > t[best] || (t[d] === t[best] && d > best)) best = d; });
    return best;
  }

  /* ── กองสต๊อก ────────────────────────────────────────────────────────── */

  var TYPE_NO = { 'ขาย': 2, 'เบิก': 1 };

  /**
   * คำตอบ tx-fifo (+ แถวของชุดที่บันทึกหลังดึงสต๊อก) → กองต่อ SKU
   * extra = [[SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status]] แบบที่ book-api.gs เก็บ
   * @returns {{skus, open:{s:[pile]}, reserve:{s:[pile]}, code(sku)→s|-1, supOf(po), unknown}}
   */
  function stock(res, extra) {
    var skus = res.skus || [], pos = (res.pos || []).slice(), locs = (res.locs || []).slice(), days = res.days || [];
    var byCode = {}, poIdx = {}, locIdx = {}, supMap = {};
    skus.forEach(function (t, i) { [t[1], t[0]].forEach(function (k) { k = up(k); if (k && byCode[k] === undefined) byCode[k] = i; }); });
    pos.forEach(function (p, i) { var k = up(p); if (poIdx[k] === undefined) poIdx[k] = i; });
    locs.forEach(function (l, i) { var k = up(l); if (locIdx[k] === undefined) locIdx[k] = i; });
    ((res.sup && res.sup.rows) || []).forEach(function (r) {
      var k = basePo(r[0]);
      if (k && supMap[k] === undefined) supMap[k] = String(r[1] == null ? '' : r[1]).trim();
    });
    function idxOf(map, list, v) {
      var k = up(v);
      if (!k) return -1;
      if (map[k] === undefined) { map[k] = list.length; list.push(String(v).trim()); }
      return map[k];
    }

    var bal = {}, isOpen = {}, first = {};
    function apply(s, lot, po, from, to, qty, t, open, day) {
      var base = s + '|' + lot + '|' + po + '|';
      if (to >= 0) {
        bal[base + to] = (bal[base + to] || 0) + qty;
        isOpen[base + to] = open;
        var pk = s + '|' + lot + '|' + po;
        if (day && (!first[pk] || day < first[pk])) first[pk] = day;
      }
      if (from >= 0 && t) bal[base + from] = (bal[base + from] || 0) - qty;
    }
    (res.rows || []).forEach(function (x) {
      apply(x[1], up(x[2]), x[3], x[4], x[5], typeof x[6] === 'number' ? x[6] : 0, x[7], !!(x[9] & 1), x[8] >= 0 ? days[x[8]] : '');
    });
    var unknown = 0;
    (extra || []).forEach(function (e) {
      var s = byCode[up(e[1])] !== undefined ? byCode[up(e[1])] : byCode[up(e[0])];
      if (s === undefined) { unknown++; return; }
      var t = TYPE_NO[String(e[7] || '').trim()] || 0;
      var from = t ? idxOf(locIdx, locs, e[4]) : -1, to = idxOf(locIdx, locs, e[5]);
      apply(s, up(e[2]), idxOf(poIdx, pos, e[3]), from, to, +e[6] || 0, t, String(e[9] || '').trim() === 'เปิด', '');
    });

    var open = {}, reserve = {};
    Object.keys(bal).forEach(function (k) {
      var q = round(bal[k]);
      if (!(q > 0)) return;
      var p = k.split('|'), s = +p[0], loc = locs[+p[3]], po = pos[+p[2]];
      var L = up(loc);
      if (/^(QA|IQA)\b/.test(L)) return;
      var pile = {
        s: s, lot: p[1], po: po, loc: loc, qty: q, open: !!isOpen[k], first: first[s + '|' + p[1] + '|' + p[2]] || '',
        sup: supMap[basePo(po)] || '', id: k,
      };
      if (pile.open && cuttable(loc)) (open[s] || (open[s] = [])).push(pile);
      else if (!pile.open) (reserve[s] || (reserve[s] = [])).push(pile);
    });
    Object.keys(open).forEach(function (s) { open[s].sort(fifo); });
    Object.keys(reserve).forEach(function (s) { reserve[s].sort(fifo); });

    return {
      skus: skus, open: open, reserve: reserve, unknown: unknown,
      code: function (sku) { var i = byCode[up(sku)]; return i === undefined ? -1 : i; },
      supOf: function (po) { return supMap[basePo(po)] || ''; },
      hasSup: Object.keys(supMap).length > 0,
      convert: (res.convert && res.convert.pairs) || [],
    };
  }

  function basePo(v) { var s = up(v); var m = /^(\d{6,})-\d{1,3}$/.exec(s); return m ? m[1] : s; }
  function lotNo(l) { var n = parseFloat(l); return isNaN(n) ? 1e9 : n; }

  /** ลำดับตัดของกองใน SKU เดียวกัน (ดูหัวไฟล์) */
  function fifo(a, b) {
    var a0 = lotNo(a.lot) === 0 ? 0 : 1, b0 = lotNo(b.lot) === 0 ? 0 : 1;
    if (a0 !== b0) return a0 - b0;
    if (a.first !== b.first) return !a.first ? 1 : !b.first ? -1 : a.first < b.first ? -1 : 1;
    var az = pickZone(a.loc) ? 0 : 1, bz = pickZone(b.loc) ? 0 : 1;
    if (az !== bz) return az - bz;
    if (lotNo(a.lot) !== lotNo(b.lot)) return lotNo(a.lot) - lotNo(b.lot);
    if (String(a.po) !== String(b.po)) return String(a.po).localeCompare(String(b.po), 'en', { numeric: true });
    return String(a.loc).localeCompare(String(b.loc), 'en', { numeric: true });
  }

  /* ── ตัด ─────────────────────────────────────────────────────────────── */

  /**
   * บรรทัดออเดอร์ (merge) × กองเปิด → ผลตัด
   * opt.seen = { คีย์: เลขที่ } บรรทัดที่ตัดไปแล้ว · บรรทัดเรียงตามเวลาออกจากคลัง ของไม่พอให้บรรทัดที่ออกก่อนได้ก่อน
   * @returns {{lines, rows, short, sup, total}}
   *   lines[i].st = 'ok' | 'short' | 'done' | 'nosku' · lines[i].take = [[pile, ชิ้น]]
   *   rows = แถวลงสมุดรวมต่อกอง [{s, sku, long, name, lot, po, loc, qty, orders, sup}]
   */
  function allocate(lines, st, opt) {
    var o = opt || {}, seen = o.seen || {};
    var left = {};
    var order = (lines || []).map(function (l, i) { return { l: l, i: i }; });
    order.sort(function (a, b) {
      var x = String(a.l.at || ''), y = String(b.l.at || '');
      if (x !== y) return !x ? 1 : !y ? -1 : x < y ? -1 : 1;
      return a.i - b.i;
    });
    var out = order.map(function (e) {
      var l = e.l;
      var r = { line: l, st: '', take: [], doc: '', s: -1 };
      if (seen[l.key || key(l)]) { r.st = 'done'; r.doc = seen[l.key || key(l)]; return r; }
      var s = st.code(l.sku);
      r.s = s;
      if (s < 0) { r.st = 'nosku'; return r; }
      var piles = st.open[s] || [];
      var have = 0;
      piles.forEach(function (p) { have += left[p.id] === undefined ? p.qty : left[p.id]; });
      if (round(have) < l.qty) { r.st = 'short'; return r; }
      var need = l.qty;
      for (var j = 0; j < piles.length && need > 1e-9; j++) {
        var p = piles[j];
        var can = left[p.id] === undefined ? p.qty : left[p.id];
        if (!(can > 1e-9)) continue;
        var q = Math.min(can, need);
        left[p.id] = round(can - q);
        need = round(need - q);
        r.take.push([p, q]);
      }
      r.st = 'ok';
      return r;
    });
    /* กลับไปลำดับเดิมของไฟล์ หน้าจอจะได้เรียงเหมือนที่คนเห็นในไฟล์ */
    var res = new Array(out.length);
    order.forEach(function (e, k) { res[e.i] = out[k]; });

    var rowsBy = {}, rows = [];
    res.forEach(function (r) {
      if (r.st !== 'ok') return;
      r.take.forEach(function (t) {
        var p = t[0];
        var e = rowsBy[p.id];
        if (!e) {
          var sk = st.skus[p.s] || [];
          e = rowsBy[p.id] = { s: p.s, sku: sk[0] || '', long: sk[1] || '', name: sk[2] || '', lot: p.lot, po: p.po, loc: p.loc,
            qty: 0, orders: 0, sup: p.sup, pile: p };
          rows.push(e);
        }
        e.qty = round(e.qty + t[1]);
        e.orders++;
      });
    });
    rows.sort(function (a, b) {
      if (a.sku !== b.sku) return a.sku.localeCompare(b.sku, 'en', { numeric: true });
      return fifo(a.pile, b.pile);
    });

    var shortBy = {}, short = [];
    res.forEach(function (r) {
      if (r.st !== 'short') return;
      var e = shortBy[r.s];
      if (!e) {
        var sk = st.skus[r.s] || [];
        var openLeft = 0;
        (st.open[r.s] || []).forEach(function (p) { openLeft += left[p.id] === undefined ? p.qty : left[p.id]; });
        e = shortBy[r.s] = {
          s: r.s, sku: sk[0] || r.line.sku, long: sk[1] || r.line.sku, name: sk[2] || r.line.name, need: 0, lines: 0, left: round(openLeft),
          reserve: (st.reserve[r.s] || []).slice(0, 4).map(function (p) { return { loc: p.loc, lot: p.lot, po: p.po, qty: p.qty, sup: p.sup }; }),
          conv: convFrom(st, r.s, left),
        };
        short.push(e);
      }
      e.need = round(e.need + r.line.qty);
      e.lines++;
    });
    short.sort(function (a, b) { return b.need - a.need; });

    /* SKU ที่ตัดจากกองของสอง Supplier ในชุดเดียว = เปิดขายคนละ Supplier พร้อมกัน (ผิดกติกา PO. Truck) */
    var supBy = {}, sup = [];
    rows.forEach(function (r) {
      if (!r.sup) return;
      var e = supBy[r.s] || (supBy[r.s] = { s: r.s, sku: r.sku, name: r.name, sups: {} });
      e.sups[r.sup] = (e.sups[r.sup] || 0) + r.qty;
    });
    Object.keys(supBy).forEach(function (s) { if (Object.keys(supBy[s].sups).length > 1) sup.push(supBy[s]); });

    var total = { lines: res.length, qty: 0, ok: 0, okQty: 0, short: 0, shortQty: 0, done: 0, doneQty: 0, nosku: 0, nosQty: 0, rows: rows.length, orders: 0 };
    var orders = {};
    res.forEach(function (r) {
      var q = r.line.qty;
      total.qty = round(total.qty + q);
      if (r.st === 'ok') { total.ok++; total.okQty = round(total.okQty + q); orders[r.line.sys + '|' + r.line.order] = 1; }
      else if (r.st === 'short') { total.short++; total.shortQty = round(total.shortQty + q); }
      else if (r.st === 'done') { total.done++; total.doneQty = round(total.doneQty + q); }
      else { total.nosku++; total.nosQty = round(total.nosQty + q); }
    });
    total.orders = Object.keys(orders).length;
    return { lines: res, rows: rows, short: short, sup: sup, total: total };
  }

  /** SKU ตอนซื้อที่แปลงเป็น SKU นี้ได้ (MASTER แปลงสินค้า) และยังมีของเปิดเหลือ */
  function convFrom(st, s, left) {
    var long = up((st.skus[s] || [])[1]);
    var out = [];
    (st.convert || []).forEach(function (p) {
      if (up(p[0]) !== long) return;
      var b = st.code(p[1]);
      if (b < 0) return;
      var q = 0;
      (st.open[b] || []).forEach(function (x) { q += left[x.id] === undefined ? x.qty : left[x.id]; });
      var sk = st.skus[b] || [];
      out.push({ sku: sk[0] || p[1], long: sk[1] || p[1], name: sk[2] || p[2] || '', open: round(q) });
    });
    return out;
  }

  /* ── แถวลงสมุด ───────────────────────────────────────────────────────── */

  /** ผลตัด → แถวที่ book-api.gs เก็บ [SKU, SKU เต็ม, LOT, PO, โลเบิก, โลรับ, ชิ้น, ประเภท, Note, Status] */
  function copyRows(cut, date) {
    return cut.rows.map(function (r) { return [r.sku, r.long, r.lot, String(r.po), r.loc, '', r.qty, 'ขาย', date, 'เปิด']; });
  }

  /** ผลตัด → บรรทัดออเดอร์ที่ book-api.gs เก็บ (เฉพาะที่ตัดได้) */
  function cutLines(cut) {
    return cut.lines.filter(function (r) { return r.st === 'ok'; }).map(function (r) {
      return {
        sys: r.line.sys, order: r.line.order, ref: r.line.ref || '', sku: r.line.sku, qty: r.line.qty,
        piles: r.take.map(function (t) { return [t[0].loc, t[0].lot, String(t[0].po), t[1]]; }),
      };
    });
  }

  /**
   * แถวที่เก็บ → ข้อความวางในชีต Transaction ตั้งแต่คอลัมน์ A ถึง N (แท็บคั่น)
   * B C L ปล่อยว่างให้สูตรของชีตเติมเอง · M ชื่อคนลง · N เลขที่เอกสาร
   */
  function tsv(copy, who, doc) {
    return (copy || []).map(function (c) {
      return [c[0], '', '', c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], '', who || '', doc || ''].map(function (v) {
        return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
      }).join('\t');
    }).join('\n');
  }

  /* ── ชุดที่บันทึกแล้ว ─────────────────────────────────────────────────── */

  /** เวลาในชีต 'yyyy-MM-dd HH:mm:ss' (เวลาไทย) → มิลลิวินาที */
  function stampMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    if (!m) return 0;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 7 * 3600000;
  }

  /**
   * ชุดที่บันทึกแล้ว วางในชีตเดิมแล้วหรือยัง ดูจากแถวขายในสต๊อกที่ดึงมา (tx-fifo)
   * ไม่ดูจากเวลา เพราะไฟล์สำเนาของ tx-api ดึงจากชีตจริงช้ากว่าจริงได้ เวลาดึงสต๊อกจึงไม่ได้บอกว่าเห็นแถวถึงไหน
   * ชุดที่ทุกแถวเจอเป็นแถวขาย (SKU LOT PO โล ชิ้น วันที่ ตรงกัน) = วางแล้ว แถวที่เจอถูกใช้แล้วจะไม่นับให้ชุดอื่นอีก
   * ชุดที่ยังไม่เจอครบ = ยังไม่อยู่ในสต๊อกที่เห็น ต้องหักเอง ไม่งั้นตัดกองเดิมซ้ำ (วางไปครึ่งเดียวก็หักทั้งชุด ของขาดดีกว่าตัดเกิน)
   * ชุดที่ยกเลิกไม่นับ
   * @returns {{done: [doc], wait: [doc]}}
   */
  function reflect(res, docs) {
    var skus = res.skus || [], pos = res.pos || [], locs = res.locs || [], days = res.days || [];
    var byCode = {};
    skus.forEach(function (t, i) { [t[1], t[0]].forEach(function (k) { k = up(k); if (k && byCode[k] === undefined) byCode[k] = i; }); });
    var have = {};
    (res.rows || []).forEach(function (x) {
      if (x[7] !== 2 || !(x[9] & 8) || x[4] < 0 || x[8] < 0) return;
      var k = [x[1], up(x[2]), up(pos[x[3]]), up(locs[x[4]]), +x[6], days[x[8]]].join('|');
      have[k] = (have[k] || 0) + 1;
    });
    var done = [], wait = [];
    (docs || []).filter(function (d) { return d.status !== 'ยกเลิก'; })
      .sort(function (a, b) { return stampMs(a.at) - stampMs(b.at); })
      .forEach(function (d) {
        var need = {}, ok = (d.copy || []).length > 0;
        (d.copy || []).forEach(function (c) {
          var s = byCode[up(c[1])] !== undefined ? byCode[up(c[1])] : byCode[up(c[0])];
          if (s === undefined || String(c[7]) !== 'ขาย') { ok = false; return; }
          var k = [s, up(c[2]), up(c[3]), up(c[4]), +c[6], String(c[8])].join('|');
          need[k] = (need[k] || 0) + 1;
        });
        Object.keys(need).forEach(function (k) { if ((have[k] || 0) < need[k]) ok = false; });
        if (ok) { Object.keys(need).forEach(function (k) { have[k] -= need[k]; }); done.push(d); }
        else wait.push(d);
      });
    return { done: done, wait: wait };
  }

  function extraOf(docs) {
    var out = [];
    (docs || []).forEach(function (d) { (d.copy || []).forEach(function (c) { out.push(c); }); });
    return out;
  }

  function uuid() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  window.WmsBook = {
    API_V: API_V,
    up: up, cuttable: cuttable, pickZone: pickZone, dateOf: dateOf, findHead: findHead, parseOrders: parseOrders, gridOf: gridOf,
    key: key, merge: merge, mainDate: mainDate, stock: stock, fifo: fifo, allocate: allocate, copyRows: copyRows, cutLines: cutLines,
    tsv: tsv, stampMs: stampMs, reflect: reflect, extraOf: extraOf, uuid: uuid, basePo: basePo,
  };
})();
