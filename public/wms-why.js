/**
 * @file wms-why.js — ชีตทีมตัดน้อยกว่า Uploadยิงออก และ TRcloud ทำไมถึงไม่ได้ตัด (ปุ่มดูที่มา หน้าเช็ครายการตัดสต๊อก)
 *
 * Uploadยิงออก กับ TRcloud ตัดตามรายการในออเดอร์ ไม่ได้ดูว่าชีตทีมมีของเหลือไหม
 * ชีตทีม (สมุด Transaction) ตัดจากของที่มีจริงราย Location ยอดเป็นศูนย์ทีมก็ตัดไม่ได้
 * ที่เจอบ่อยคือของแถม (FRE…) ซึ่งเป็นของชิ้นเดียวกับสินค้าจริง หยิบสินค้าจริงไปส่งแต่ไม่ได้ลงแปลงสินค้า
 *
 * ใช้ทุกแถวของสมุดจาก ?api=tx-fifo (ชุดเดียวกับหน้า FIFO สต๊อก) คิดยอดแบบเดียวกับ balances_ ใน tx-api.gs
 *   เข้า = แถวที่มี Location รับ, ออก = แถวเบิกหรือขายที่มี Location เบิก, คีย์ = SKU + LOT + PO + Location
 * สินค้าจริงที่คู่กันหาจากสามทาง เรียงจากแน่นอนที่สุด
 *   1. แท็บ MASTER แปลงสินค้า (convert ใน ?api=tx-daily)
 *   2. แถวแปลงสินค้าในสมุด: เบิก SKU หนึ่งออกแล้วรับอีก SKU เข้า LOT PO จำนวนเดียวกัน แถวใกล้กัน (ธง 16 ของ tx-fifo)
 *   3. ชื่อเดียวกันเมื่อตัดคำว่า แถม ข้างหน้าออก
 * ไม่แก้ชีต บอกแค่ว่าควรลงแถวไหน ให้คนดูของจริงแล้วลงเอง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsWhy
 */
(function () {
  'use strict';

  var GIFT = /^\s*(ของ\s*แถม|แถม|เเถม|reward|free)\s*[-–:]?\s*/i;
  var SPECIAL = /^(QA|IQA|RIB)$/i;
  var NEAR = 40;    // แถวเบิกกับแถวรับของการแปลงครั้งเดียวกันห่างกันไม่เกินนี้
  var HIST = 8;     // ความเคลื่อนไหวล่าสุดที่แสดง
  var KEYS = 4;     // จุดที่มีของของสินค้าจริงที่แสดง
  var NOTE = 'แปลงสินค้า';

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function norm(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function isGift(name) { return GIFT.test(String(name || '')); }
  function bare(name) { return norm(String(name || '').replace(GIFT, '')); }

  /** รหัสสั้นแบบคอลัมน์ A ของทีม เช่น FRE0000000220 → FRE220 ใช้เมื่อสมุดไม่เคยมี SKU นี้ */
  function shortOf(long) {
    var m = /^([A-Z]+)0*(\d+)$/.exec(up(long));
    if (!m) return up(long);
    var d = m[2];
    while (d.length < 3) d = '0' + d;
    return m[1] + d;
  }

  /** วันที่ในช่อง Note แบบที่ทีมกรอก วัน/เดือน/ปี */
  function dmy(ymd) {
    var p = String(ymd || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
  }

  /**
   * ดัชนีจากคำตอบของ tx-fifo สร้างครั้งเดียว
   *   row = [เลขแถว, ลำดับ SKU, LOT, ลำดับ PO, ลำดับ Location เบิก, ลำดับ Location รับ, จำนวน, ประเภท, ลำดับวันที่, ธง]
   */
  function index(fifo) {
    var skus = (fifo.skus || []).map(function (s) {
      return { short: s[0] || '', long: s[1] || '', name: s[2] || '', rows: [] };
    });
    var by = {};
    skus.forEach(function (s) { by[up(s.long)] = s; });
    var rows = (fifo.rows || []).map(function (x) {
      var flag = x[9] || 0;
      return {
        row: x[0], s: x[1], lot: x[2], po: (fifo.pos || [])[x[3]],
        from: x[4] >= 0 ? fifo.locs[x[4]] : '', to: x[5] >= 0 ? fifo.locs[x[5]] : '',
        qty: typeof x[6] === 'number' ? x[6] : 0, t: x[7], day: x[8] >= 0 ? fifo.days[x[8]] : '',
        open: !!(flag & 1), gr: !!(flag & 2), count: !!(flag & 4), conv: !!(flag & 16),
      };
    });
    rows.forEach(function (r) { if (skus[r.s]) skus[r.s].rows.push(r); });

    /* แปลงหนึ่งครั้ง = แถวเบิก SKU เดิมคู่กับแถวรับ SKU ใหม่ LOT PO จำนวนเดียวกัน แถวที่ใกล้ที่สุดคือคู่กัน */
    var pairs = {}, used = {};
    var conv = rows.filter(function (r) { return r.conv; });
    conv.forEach(function (r) {
      if (r.t !== 0 || !r.to) return;
      var best = null;
      conv.forEach(function (o) {
        if (o.t !== 1 || !o.from || o.s === r.s || used[o.row]) return;
        if (up(o.lot) !== up(r.lot) || up(o.po) !== up(r.po) || o.qty !== r.qty) return;
        var gap = Math.abs(o.row - r.row);
        if (gap <= NEAR && (!best || gap < Math.abs(best.row - r.row))) best = o;
      });
      if (!best) return;
      used[best.row] = 1;
      var into = up(skus[r.s].long), src = up(skus[best.s].long);
      var p = pairs[into] || (pairs[into] = {});
      var one = p[src] || (p[src] = { n: 0, rows: [] });
      one.n++;
      one.rows.push([best.row, r.row]);
    });

    /* จุดรับของแถมที่ไม่เคยมีในสมุด ใช้จุดที่รับของแถมจากการแปลงบ่อยสุด ไม่มีการแปลงเลยใช้จุดรับของแถมบ่อยสุด
       ของแถมที่มาเป็นลังเก็บบนชั้นอีกที่ ไม่ใช่จุดที่แปลงทีละชิ้นไปส่ง */
    var byName = {}, fromConv = {}, fromAny = {};
    skus.forEach(function (s) {
      if (!s.name) return;
      if (!isGift(s.name)) { (byName[norm(s.name)] = byName[norm(s.name)] || []).push(s); return; }
      s.rows.forEach(function (r) {
        if (!r.to || SPECIAL.test(r.to)) return;
        fromAny[r.to] = (fromAny[r.to] || 0) + 1;
        if (r.conv) fromConv[r.to] = (fromConv[r.to] || 0) + 1;
      });
    });
    function most(m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); })[0] || ''; }
    var giftLoc = most(fromConv) || most(fromAny);

    return { by: by, pairs: pairs, byName: byName, giftLoc: giftLoc, conv: !!fifo.conv, at: fifo.at || 0, sheet: fifo.sheet || null };
  }

  /** ยอดราย LOT + PO + Location จากแถวที่ลงก่อนวันที่ before ('' = ทุกแถว) แถวที่ยังไม่มีวันที่อยู่บนสุดของสมุด นับเป็นก่อน */
  function keysOf(list, before) {
    var at = {}, order = [];
    function one(r, loc) {
      var k = up(r.lot) + '|' + up(r.po) + '|' + up(loc);
      if (!at[k]) { at[k] = { lot: r.lot, po: r.po, loc: loc, bal: 0, open: false }; order.push(k); }
      return at[k];
    }
    list.forEach(function (r) {
      if (before && r.day && r.day >= before) return;
      if (r.to) { var a = one(r, r.to); a.bal += r.qty; a.open = r.open; }
      if (r.from && (r.t === 1 || r.t === 2)) one(r, r.from).bal -= r.qty;
    });
    return order.map(function (k) { return at[k]; });
  }

  function total(keys) { return keys.reduce(function (t, k) { return t + k.bal; }, 0); }

  /** จุดที่มีของ จุดที่เปิดขายก่อน แล้วของมากก่อน QA IQA RIB ไม่ใช่ที่หยิบของไปส่ง */
  function stocked(keys) {
    return keys.filter(function (k) { return k.bal > 0 && !SPECIAL.test(k.loc); })
      .sort(function (a, b) { return (b.open ? 1 : 0) - (a.open ? 1 : 0) || b.bal - a.bal; });
  }

  /** ความเคลื่อนไหวล่าสุด ใหม่สุดขึ้นก่อน คงเหลือคิดจากทุกแถวของ SKU นั้น */
  function hist(list) {
    var left = 0;
    var all = list.map(function (r) {
      var change = (r.to ? r.qty : 0) - (r.from && (r.t === 1 || r.t === 2) ? r.qty : 0);
      left += change;
      return {
        row: r.row, day: r.day, what: r.t === 2 ? 'ขาย' : r.t === 1 ? 'เบิก' : r.to ? 'รับ' : 'อื่น ๆ',
        tag: r.conv ? NOTE : r.count ? 'นับสต๊อก' : r.gr ? 'GR' : '',
        loc: r.t ? r.from : r.to, lot: r.lot, po: r.po, change: change, left: left,
      };
    });
    return all.slice(-HIST).reverse();
  }

  /** Location ที่ SKU นี้เคยรับเข้าล่าสุด ของแถมเก็บรวมกันที่จุดเดียว */
  function homeOf(list) {
    for (var i = list.length - 1; i >= 0; i--) if (list[i].to && !SPECIAL.test(list[i].to)) return list[i].to;
    return '';
  }

  /** สินค้าจริงที่น่าจะคู่กัน เรียงจากแน่นอนที่สุด รายการเดียวกันจากหลายทางรวมเป็นอันเดียว */
  function candidates(ix, sku, name, master) {
    var out = [], seen = {}, self = up(sku);
    function add(long, src, extra) {
      var k = up(long);
      if (!k || k === self) return;
      if (seen[k]) {
        if (extra && extra.rows && !seen[k].rows.length) { seen[k].rows = extra.rows; seen[k].n = extra.n; }
        return;
      }
      var s = ix.by[k];
      seen[k] = {
        sku: s ? s.long : k, short: s ? s.short : shortOf(k), name: (s && s.name) || (extra && extra.name) || '',
        src: src, n: (extra && extra.n) || 0, rows: (extra && extra.rows) || [],
      };
      out.push(seen[k]);
    }
    ((master && master.pairs) || []).forEach(function (p) { if (up(p[0]) === self) add(p[1], 'master', { name: p[2] }); });
    var conv = ix.pairs[self] || {};
    Object.keys(conv).sort(function (a, b) { return conv[b].n - conv[a].n || (a < b ? -1 : 1); })
      .forEach(function (k) { add(k, 'conv', conv[k]); });
    if (isGift(name)) (ix.byName[bare(name)] || []).forEach(function (s) { add(s.long, 'name'); });
    return out;
  }

  /** หนึ่งแถวของชีตตามคอลัมน์ A ถึง L คนลง (L) ให้คนที่ลงจริงเติมเอง */
  function line(s, lot, po, from, to, qty, type, note) {
    return [s.short, s.sku, s.name, lot, po, from, to, qty, type, note, 'เปิด', ''];
  }

  function sell(self, keys, qty, date) {
    var out = [];
    keys.forEach(function (k) {
      if (qty <= 0) return;
      var q = Math.min(qty, k.bal);
      out.push(line(self, k.lot, k.po, k.loc, '', q, 'ขาย', dmy(date)));
      qty -= q;
    });
    return out;
  }

  /**
   * ทำไมชีตทีมไม่ได้ตัด SKU นี้ในวันนี้ และควรลงแถวไหน
   * @param {Object} ix ผลของ index
   * @param {{date:string, sku:string, name?:string, need:number, master?:Object, totals?:Function, sales?:Function}} q
   *   need = ยอดที่ชีตทีมยังขาดจากสองระบบ
   *   master = convert จาก tx-daily, totals(d, sku) → {s, x, t} ยอดของวันนั้น, sales(d, sku) → แถวขายในชีตทีมของวันนั้น
   * verdict
   *   stock    ชีตมีของพอให้ตัด แต่ไม่ได้ลงขาย
   *   convert  ชีตไม่มีของพอ เจอสินค้าจริงที่คู่กัน ของที่ส่งไปน่าจะหยิบจากตัวนั้นแล้วไม่ได้ลงแปลงสินค้า
   *   unknown  ชีตไม่มีของพอ และหาไม่เจอว่าแปลงมาจากตัวไหน
   */
  function explain(ix, q) {
    var me = ix.by[up(q.sku)] || null;
    var list = me ? me.rows : [];
    var keysBefore = keysOf(list, q.date);
    var self = { sku: me ? me.long : up(q.sku), short: me ? me.short : shortOf(q.sku), name: (me && me.name) || q.name || '' };
    var out = {
      sku: self.sku, short: self.short, name: self.name, need: q.need, known: !!me,
      before: total(keysBefore), now: total(keysOf(list, '')), hist: hist(list),
      cands: [], real: null, missing: 0, home: homeOf(list), into: '', lines: [], verdict: '', conv: ix.conv,
    };
    if (out.before >= q.need) {
      out.verdict = 'stock';
      out.lines = sell(self, stocked(keysBefore), q.need, q.date);
      return out;
    }
    out.missing = q.need - Math.max(out.before, 0);
    out.cands = candidates(ix, q.sku, self.name, q.master);
    if (!out.cands.length) { out.verdict = 'unknown'; return out; }

    var c = out.cands[0], a = ix.by[up(c.sku)];
    var sales = (q.sales ? q.sales(q.date, c.sku) : []).filter(function (x) { return typeof x.qty === 'number' && x.qty > 0; });
    var keys = a ? stocked(keysOf(a.rows, '')) : [];
    /* วันนั้นทีมขายสินค้าจริงจากจุดไหน ของแถมน่าจะหยิบจากจุดเดียวกัน ไม่มีแถวขายใช้จุดที่มีของมากสุด */
    var top = sales.slice().sort(function (x, y) { return y.qty - x.qty; })[0];
    var from = top ? { loc: top.loc, lot: top.lot, po: top.po, row: top.row }
      : keys[0] ? { loc: keys[0].loc, lot: keys[0].lot, po: keys[0].po, row: 0 } : null;
    out.real = {
      sku: c.sku, short: c.short, name: c.name, src: c.src, n: c.n, rows: c.rows,
      day: q.totals ? q.totals(q.date, c.sku) : null, keys: keys.slice(0, KEYS), from: from,
    };
    out.verdict = 'convert';
    /* home = จุดที่รหัสนี้เคยรับเข้า ไม่มีใช้จุดที่รับของแถมจากการแปลงบ่อยสุด */
    out.into = out.home || ix.giftLoc;
    var lot = from ? from.lot : '', po = from ? from.po : '';
    var lines = out.before > 0 ? sell(self, stocked(keysBefore), out.before, q.date) : [];
    lines.push(line(c, lot, po, from ? from.loc : '', '', out.missing, 'เบิก', NOTE));
    lines.push(line(self, lot, po, '', out.into, out.missing, 'รับ', NOTE));
    lines.push(line(self, lot, po, out.into, '', out.missing, 'ขาย', dmy(q.date)));
    out.lines = lines;
    return out;
  }

  /** ยอดของ SKU หนึ่งในวันหนึ่งจากสามแหล่ง ชุดเดียวกับที่เทียบรายวันใช้ */
  function dayTotals(daily, ledger) {
    var at = {};
    function put(side, part, cells) {
      if (!part) return;
      (cells || []).forEach(function (c) {
        var k = part.days[c[0]] + '|' + up(part.skus[c[1]][0]);
        var o = at[k] || (at[k] = { s: 0, x: 0, t: 0 });
        o[side] += c[2];
      });
    }
    put('s', ledger, ledger && ledger.cells);
    put('x', daily, daily && daily.x);
    put('t', daily, daily && daily.t);
    return function (d, sku) { return at[d + '|' + up(sku)] || { s: 0, x: 0, t: 0 }; };
  }

  /** วางลงชีตที่ช่อง A แล้วแตกเป็นคอลัมน์ A ถึง L ได้เลย */
  function tsv(lines) {
    return lines.map(function (l) {
      return l.map(function (v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); }).join('\t');
    }).join('\n');
  }

  window.WmsWhy = { index: index, explain: explain, dayTotals: dayTotals, tsv: tsv, shortOf: shortOf, isGift: isGift };
})();
