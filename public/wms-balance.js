/**
 * @file wms-balance.js — สินค้าคงเหลือ ณ วันที่ที่เลือก ราย SKU × LOT × PO จากสมุด Transaction
 *
 * ผู้ใช้ขอ 2026-11-06: เลือกวันที่เองได้ และโหลดเป็นไฟล์ Report ได้ เลือกยอด ณ วันเดียว ระดับ SKU × LOT × PO
 *
 * ข้อมูลคือคำตอบ tx-fifo ชุดเดียวกับหน้า FIFO สต๊อก (ทุกแถวของสมุด) เดินแถวด้วย WmsFifo.parse / apply
 * กติกาเดียวกับชีตยอด: เข้าที่ Location รับทุกประเภท ออกที่ Location เบิกเฉพาะเบิกกับขาย
 *
 * ยอด ณ วันที่ D นับแถวที่วันที่ไม่เกิน D วันที่ของแถวคือวันที่ของแถวเอง ถ้าไม่มีใช้วันที่ของแถวด้านบนที่ใกล้สุด
 * (เหมือนยอดสิ้นเดือนของหน้า FIFO) แถวบนสุดที่ยังไม่มีวันที่เลย (แถวนับสต๊อก) นับเสมอ
 *
 * ยอดของบรรทัดคือยอดสุทธิของกองนั้นทุก Location รวมกัน ไม่ใช่เฉพาะ Location ที่เป็นบวก
 * ย้ายของแล้วลง Location เบิกผิด ที่หนึ่งจะติดลบอีกที่จะเกิน แต่ยอดรวมของกองยังถูก
 * กองที่สุทธิติดลบคือสมุดลงออกเกินที่รับ ไม่นับรวมในยอดคงเหลือ แยกให้เห็นไว้
 *
 * PO ที่ลง -01 -02 ท้ายเลขคือ PO เดียวกันที่ทยอยรับ (WmsFifo.basePo) รวมเป็นบรรทัดเดียว เหมือนรายงาน LOT / PO
 *
 * โหลดเป็น classic script ต่อจาก wms-fifo.js เปิดเป็น window.WmsBalance
 */
(function (window) {
  'use strict';

  var HEAD = ['SKU', 'ชื่อสินค้า', 'LOT', 'เดือนของ LOT', 'PO', 'รับเข้า', 'คงเหลือ', 'Location', 'หมายเหตุ'];

  function F() { return window.WmsFifo; }
  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  /* ไม่รู้ LOT / PO นิยามเดียวกับรายงาน LOT / PO ที่ขายออก: LOT 0 หรือว่าง PO 0 หรือว่าง */
  function noLot(v) { return text(v) === '' || +v === 0; }
  function noPo(v) { return /^0*$/.test(text(v)); }
  /* ยอดที่บวกลบทศนิยมกันหลายรอบ ตัดเศษเล็กๆ ที่เกิดจากเลขทศนิยมของเครื่องทิ้ง */
  function clean(n) { return Math.round(n * 1000) / 1000; }
  function isDay(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }

  /**
   * วันที่เลือกได้ ตั้งแต่วันแรกที่มีวันที่ในสมุดถึงวันนี้
   * last = วันที่ลงขายล่าสุด หลังวันนั้นยอดอาจยังไม่ครบ หน้าใช้บอกไว้
   */
  function span(res) {
    var today = res.today || '';
    var days = (res.days || []).filter(function (d) { return isDay(d) && (!today || d <= today); }).sort();
    return { min: days[0] || today, max: today || days[days.length - 1] || '', last: res.last || '' };
  }

  /** วันสุดท้ายของเดือนก่อนหน้าวันที่ d (yyyy-mm-dd) ใช้กับปุ่มสิ้นเดือนที่แล้ว */
  function lastMonthEnd(d) {
    var y = +d.slice(0, 4), m = +d.slice(5, 7);
    var e = new Date(Date.UTC(y, m - 1, 0));
    return e.getUTCFullYear() + '-' + ('0' + (e.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + e.getUTCDate()).slice(-2);
  }

  /**
   * ยอดคงเหลือ ณ สิ้นวัน date
   *   rows = F().parse(res) ส่งมาได้ หน้าเว็บเปลี่ยนวันที่บ่อย ไม่ต้องแปลงแถวใหม่ทุกครั้ง
   * คืน { date, lines, neg, totals, counted, later }
   *   lines = บรรทัดที่ยอดสุทธิมากกว่า 0 เรียง SKU แล้วกองเก่าไปใหม่ LOT ที่ไม่รู้อยู่ท้าย
   *   neg = บรรทัดที่ยอดสุทธิติดลบ
   */
  function asOf(res, date, rows) {
    var fifo = F();
    var ym = date.slice(0, 7), ref = fifo.refKey(ym);
    var st = fifo.newState();
    var counted = 0, later = 0;
    (rows || fifo.parse(res)).forEach(function (r) {
      if (r.d && r.d > date) { later++; return; }
      counted++;
      fifo.apply(st, r);
    });

    var by = {};
    Object.keys(st.bal).forEach(function (k) {
      var q = clean(st.bal[k]);
      if (!q) return;
      var cut = k.lastIndexOf('|');
      var b = k.slice(0, cut), loc = +k.slice(cut + 1);
      var x = by[b] || (by[b] = { b: b, qty: 0, locs: [], bad: [] });
      x.qty += q;
      (q > 0 ? x.locs : x.bad).push({ loc: res.locs[loc] || '', qty: q, open: !!st.open[k] });
    });

    var lines = [], neg = [];
    Object.keys(by).forEach(function (b) {
      var x = by[b];
      var qty = clean(x.qty);
      if (!qty) return;
      var p = b.split('|');
      var s = res.skus[+p[0]] || [];
      var lot = p[1], po = p[2];
      var lm = fifo.lotMonth(lot, ym);
      x.locs.sort(function (a, c) { return c.qty - a.qty; });
      var line = {
        sku: +p[0], code: text(s[1]), name: text(s[2]), lot: lot, lm: lm, age: lm ? ref - lm.key : null, po: po,
        recv: st.recv[b] || '', rounds: fifo.rounds(st, b), qty: qty, locs: x.locs, bad: x.bad,
        noLot: noLot(lot), noPo: noPo(po),
      };
      (qty > 0 ? lines : neg).push(line);
    });

    function order(a, c) {
      if (a.code !== c.code) return a.code < c.code ? -1 : 1;
      if (!a.lm || !c.lm) return a.lm ? -1 : c.lm ? 1 : c.qty - a.qty;
      return a.lm.key - c.lm.key || (a.recv || '9').localeCompare(c.recv || '9') || a.po.localeCompare(c.po);
    }
    lines.sort(order);
    neg.sort(order);
    return { date: date, lines: lines, neg: neg, totals: totals(lines, neg), counted: counted, later: later };
  }

  function totals(lines, neg) {
    var t = { qty: 0, skus: 0, lines: lines.length, unknown: { qty: 0, lines: 0 }, neg: { qty: 0, lines: (neg || []).length } };
    var seen = {};
    lines.forEach(function (l) {
      t.qty += l.qty;
      if (!seen[l.sku]) { seen[l.sku] = 1; t.skus++; }
      if (l.noLot || l.noPo) { t.unknown.qty += l.qty; t.unknown.lines++; }
    });
    (neg || []).forEach(function (l) { t.neg.qty += l.qty; });
    t.qty = clean(t.qty);
    t.unknown.qty = clean(t.unknown.qty);
    t.neg.qty = clean(t.neg.qty);
    return t;
  }

  /**
   * ตัวกรองบนหน้า only = '' | unknown | neg (neg ใช้บรรทัดติดลบแทนบรรทัดปกติ)
   * ค้นได้ทั้ง SKU ชื่อ LOT PO และ Location  ค้นด้วย PO ที่มี -05 ท้ายก็เจอ
   */
  function filter(bal, o) {
    o = o || {};
    var list = o.only === 'neg' ? bal.neg : bal.lines;
    if (o.only === 'unknown') list = list.filter(function (l) { return l.noLot || l.noPo; });
    var q = up(o.q || '');
    if (!q) return list;
    var qp = F().basePo(q);
    return list.filter(function (l) {
      if (up(l.code).indexOf(q) >= 0 || up(l.name).indexOf(q) >= 0 || up(l.po).indexOf(qp) >= 0) return true;
      if (up(l.lot) === q) return true;
      return l.locs.concat(l.bad).some(function (x) { return up(x.loc).indexOf(q) >= 0; });
    });
  }

  function locText(list) { return list.map(function (x) { return x.loc + ' (' + x.qty + ')'; }).join(', '); }

  function notes(l) {
    var out = [];
    if (l.qty < 0) out.push('ยอดติดลบ สมุดลงออกเกินที่รับ');
    if (l.noLot) out.push('ไม่รู้ LOT');
    if (l.noPo) out.push('ไม่รู้ PO');
    if (l.qty > 0 && l.bad.length) out.push('มี Location ติดลบ ' + locText(l.bad));
    var r = F().roundsText(l);
    if (r) out.push('รับเข้า ' + r);
    return out.join(' · ');
  }

  /** ตารางรายงาน แถวแรกเป็นหัวตาราง ทุกแถวมี SKU ครบ กรองหรือทำ Pivot ต่อได้ */
  function table(lines) {
    var out = [HEAD.slice()];
    lines.forEach(function (l) {
      out.push([l.code, l.name, l.lot, l.lm ? F().monthText(l.lm) : '', l.po, F().recvText(l.recv), l.qty,
        locText(l.qty > 0 ? l.locs : l.bad), notes(l)]);
    });
    return out;
  }

  /* วางใน Excel: ตัวเลขยาวเกิน 15 หลักจะถูกปัด ข้อความที่ขึ้นต้นด้วย = + @ จะกลายเป็นสูตร */
  function cell(v) {
    if (typeof v === 'number') return String(v);
    var s = text(v).replace(/[\t\r\n]+/g, ' ');
    if (/^\d{16,}$/.test(s)) return '="' + s + '"';
    return /^[=+@]/.test(s) || /^-\D/.test(s) ? "'" + s : s;
  }
  function tsv(t) { return t.map(function (r) { return r.map(cell).join('\t'); }).join('\n'); }

  window.WmsBalance = {
    HEAD: HEAD, span: span, lastMonthEnd: lastMonthEnd, asOf: asOf, totals: totals, filter: filter,
    table: table, notes: notes, tsv: tsv, noLot: noLot, noPo: noPo,
  };
})(window);
