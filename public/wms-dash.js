/**
 * @file wms-dash.js — ตัวเลขของหน้าภาพรวมสต๊อก (public/dashboard)
 *
 * หน้าภาพรวมไม่มีกติกาของตัวเอง ทุกตัวเลขคิดด้วยกติกาเดียวกับหน้าที่เป็นเจ้าของเรื่องนั้น
 * หัวหน้าเปิดหน้านี้แล้วเปิดหน้าของทีมต่อ ต้องเห็นเลขเดียวกัน ไม่ใช่คนละเลขที่ต้องมานั่งอธิบาย
 *   สต๊อก ต้องเติม ข้อมูลผิด   WmsTx กับชุดกลาง tx-summary (หน้าสต๊อกราย Location)
 *   FIFO อายุสต๊อก ยอดออก     WmsFifo.analyze กับชุดกลาง tx-fifo (หน้า FIFO สต๊อก)
 *   นับสต๊อก                  tx-count&peek=1 ความแม่นยำนับเฉพาะรายการสุ่ม เหมือน WmsTx.countStats
 *   ตัดสต๊อก                  ผลตรวจชุดกลางของ cut-api.gs (หน้าเช็ครายการตัดสต๊อก)
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsDash (ต้องโหลด wms-tx.js กับ wms-fifo.js ก่อน)
 */
(function () {
  'use strict';

  var REFILL_DAYS = 3;   // ค่าเริ่มของแท็บต้องเติมในหน้าสต๊อกราย Location
  /* เทียบกับเดือนก่อนได้เมื่อทั้งสองเดือนมีวันขายอย่างน้อยเท่านี้ สมุดเริ่มกลางเดือนหรือเดือนเพิ่งเริ่ม
     เทียบไปก็ได้ตัวเลขอย่าง +900% ที่ไม่ได้แปลว่าอะไร ยอดชิ้นเทียบเป็นเฉลี่ยต่อวันที่มีขาย ไม่ใช่ยอดทั้งเดือน */
  var COMPARE_DAYS = 7;
  /* ถังของหน้าเช็ครายการตัดสต๊อก แท็บตัดผิด / ตัดเกิน กับแท็บยังไม่ตัด */
  var FIX_KINDS = ['over', 'wrong', 'ghost', 'cancel', 'blankCut', 'transferDiff'];
  var CUT_LABEL = {
    over: 'ตัดเกิน', wrong: 'ตัดผิด SKU', ghost: 'ตัดแต่ไม่มีใน Report', cancel: 'ขนส่งยกเลิกแต่ตัดแล้ว',
    blankCut: 'สถานะขนส่งว่างแต่ตัดแล้ว', transferDiff: 'โอนย้ายไม่ตรงกัน', under: 'ยังไม่ตัดหรือตัดไม่ครบ',
  };
  /* ช่วงอายุตรงกับสีบนหน้า FIFO สต๊อก (ageCls) */
  var AGES = [
    { cls: 'a1', label: '0–1 เดือน', max: 1 },
    { cls: 'a2', label: '2–3 เดือน', max: 3 },
    { cls: 'a3', label: '4–6 เดือน', max: 6 },
    { cls: 'a4', label: '7 เดือนขึ้นไป', max: Infinity },
  ];
  var MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function sum(list, fn) { return list.reduce(function (a, x) { return a + fn(x); }, 0); }
  /** ร้อยละทศนิยมหนึ่งตำแหน่ง ปัดลง เหลือผิดแม้แต่รายการเดียวต้องไม่ขึ้น 100% */
  function floorPct(a, b) { return b ? Math.floor(a / b * 1000) / 10 : null; }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  /** ตุลาคม 2569 */
  function monthName(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + (+ym.slice(0, 4) + 543); }
  /** ต.ค. 69 */
  function monthShort(ym) { return SHORT[+ym.slice(5, 7) - 1] + ' ' + String(+ym.slice(0, 4) + 543).slice(-2); }
  function prevMonth(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + ('0' + m).slice(-2);
  }

  /** สต๊อกตอนนี้ ตัวเลขเดียวกับหัวหน้าสต๊อกราย Location แท็บต้องเติม (3 วัน) และแท็บข้อมูลผิด */
  function stockNow(raw, now) {
    var data = window.WmsTx.expand(raw);
    var t = data.totals;
    var r = window.WmsTx.refill(data, REFILL_DAYS);
    var counts = (raw.issues && raw.issues.counts) || {};
    var known = {};
    var kinds = window.WmsTx.ISSUES.filter(function (k) { known[k.kind] = 1; return counts[k.kind] > 0; })
      .map(function (k) { return { kind: k.kind, label: k.label, n: counts[k.kind] }; });
    /* เรื่องที่สคริปต์รุ่นใหม่เพิ่มมาแต่หน้านี้ยังไม่รู้จัก ยังต้องนับในยอดรวม หน้าสต๊อกก็รวมทุกเรื่อง */
    Object.keys(counts).forEach(function (k) { if (!known[k] && counts[k] > 0) kinds.push({ kind: k, label: k, n: counts[k] }); });
    kinds.sort(function (a, b) { return b.n - a.n; });
    return {
      net: t.net, open: t.open, reserve: t.reserve, special: t.QA + t.IQA + t.RIB,
      skus: t.skus, locs: t.locs, openLocs: t.openLocs, reserveLocs: t.reserveLocs,
      refill: { days: REFILL_DAYS, ready: r.ready.length, none: r.none.length, saleDays: raw.saleDays || 0 },
      issues: { total: sum(kinds, function (k) { return k.n; }), kinds: kinds },
      backup: window.WmsTx.backupState(raw.backup, now),
    };
  }

  /** อายุสต๊อกเป็นสี่ช่วงกับไม่รู้ LOT จาก stock ของ WmsFifo.analyze */
  function ages(stock) {
    var parts = AGES.map(function (a) { return { cls: a.cls, label: a.label, qty: 0 }; });
    stock.aging.forEach(function (a) {
      for (var i = 0; i < AGES.length; i++) {
        if (a.age <= AGES[i].max) { parts[i].qty += a.qty; return; }
      }
    });
    parts.push({ cls: 'u', label: 'ไม่รู้ LOT', qty: stock.unknown });
    var known = sum(parts.slice(0, 4), function (p) { return p.qty; });
    var old = parts[3].qty;
    return { parts: parts, total: known + stock.unknown, known: known, old: old, oldPct: floorPct(old, known) };
  }

  function group(g) {
    return { qty: g.qty, rows: g.rows, judged: g.judged, ok: g.ok, po: g.po, lot: g.lot, skip: g.lot + g.po, unknown: g.unknown, pct: g.pct };
  }

  /**
   * สรุปเดือนจากผล WmsFifo.analyze ตัวเลขเดียวกับหัวหน้า FIFO สต๊อก
   * end = วันสุดท้ายที่จะวาดในกราฟรายวัน เดือนที่ยังไม่จบหยุดที่วันที่สมุดลงขายล่าสุด ไม่ใช่วาดวันว่างไปถึงสิ้นเดือน
   * days = ยอดหยิบขายรายวันแยกตามผล FIFO วันที่ไม่มีขายเป็นศูนย์ ไม่หายไปจากแกน
   * saleDays = จำนวนวันที่มีขาย perDay = ยอดหยิบขายเฉลี่ยต่อวันที่มีขาย
   */
  function month(an, end) {
    var by = {};
    an.issues.forEach(function (it) {
      if (it.kind !== 'sale') return;
      var d = by[it.date] || (by[it.date] = { ok: 0, po: 0, lot: 0, unknown: 0 });
      d[it.state] += it.qty;
    });
    var last = end && end < an.to ? end : an.to;
    var days = [];
    for (var n = 1; n <= 31; n++) {
      var d = an.ym + '-' + ('0' + n).slice(-2);
      if (d > last) break;
      var x = by[d] || { ok: 0, po: 0, lot: 0, unknown: 0 };
      days.push({ d: d, ok: x.ok, po: x.po, lot: x.lot, unknown: x.unknown, qty: x.ok + x.po + x.lot + x.unknown });
    }
    var saleDays = days.filter(function (x) { return x.qty > 0; }).length;
    var sale = group(an.totals.sale);
    return {
      ym: an.ym, sale: sale, refill: group(an.totals.refill), days: days, ages: ages(an.stock),
      saleDays: saleDays, perDay: saleDays ? Math.round(sale.qty / saleDays) : 0,
    };
  }

  /** สองเดือนนี้เทียบกันได้ไหม (ดู COMPARE_DAYS) */
  function comparable(m, prev) { return !!(m && prev && m.saleDays >= COMPARE_DAYS && prev.saleDays >= COMPARE_DAYS); }

  /** ผลนับของเดือน จากคำตอบ tx-count&peek=1  ไม่มีผลนับเลยได้ null */
  function countMonth(peek, ym) {
    var m = peek && peek.months && peek.months[ym];
    if (!m || !m.counted) return null;
    /* ปัดแบบเดียวกับ WmsTx.countStats ตัวเลขจะตรงกับแท็บนับสต๊อก */
    return { counted: m.counted, off: m.off, sample: m.sample, match: m.match, pct: m.sample ? Math.round(m.match / m.sample * 100) : null };
  }

  /** ผลนับตอนนี้: รายการวันนี้ กับความแม่นยำ 30 วันล่าสุด (ตัวเดียวกับแท็บนับสต๊อก) */
  function countNow(peek) {
    if (!peek) return null;
    var l = peek.last || { sample: 0, match: 0 };
    return {
      total: peek.todays.total, done: peek.todays.done,
      sample: l.sample, match: l.match, pct: l.sample ? Math.round(l.match / l.sample * 100) : null,
    };
  }

  /**
   * ผลตรวจตัดสต๊อก แท็บตัดผิด / ตัดเกิน กับยังไม่ตัด นับเท่ากับป้ายเลขบนแท็บของหน้าเช็ครายการตัดสต๊อก
   * ตรงกัน = บรรทัดที่ยอดตัดเท่า Report เทียบกับบรรทัดที่ตรงกันและที่ต้องแก้ทั้งหมด
   * ym = เดือนของไฟล์ตัดสต๊อก ช่วงที่คร่อมสองเดือนได้ '' ไม่ผูกกับเดือนไหน
   * log = บันทึกการแก้ (cut-fixlog) นับรายการที่ล่าสุดกดแก้แล้ว กับที่ตรวจซ้ำแล้วหายไป
   */
  function cut(raw, log) {
    var k = raw.kinds || {};
    var get = function (x, f) { return k[x] ? k[x][f] || 0 : 0; };
    var fix = sum(FIX_KINDS, function (x) { return get(x, 'total'); });
    var under = get('under', 'total') + (raw.gaps ? raw.gaps.length : 0);
    var badLines = sum(FIX_KINDS.concat('under'), function (x) { return get(x, 'lines'); });
    var ok = raw.info && raw.info.matched ? raw.info.matched.lines : 0;
    var p = raw.period || {};
    var from = String(p.from || ''), to = String(p.to || '');
    var marks = null;
    if (log && log.log) {
      var last = {};
      log.log.forEach(function (r) { last[r.key] = r.act; });
      marks = { fixed: 0, gone: 0 };
      Object.keys(last).forEach(function (key) {
        if (last[key] === 'แก้แล้ว') marks.fixed++;
        else if (last[key] === 'ตรวจแล้วหาย') marks.gone++;
      });
    }
    return {
      from: from, to: to, ym: from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : '',
      fix: fix, under: under, todo: fix + under,
      okLines: ok, okPct: floorPct(ok, ok + badLines),
      kinds: FIX_KINDS.concat('under').filter(function (x) { return get(x, 'total') > 0; })
        .map(function (x) { return { kind: x, label: CUT_LABEL[x], n: get(x, 'total'), qty: get(x, 'qty') }; })
        .concat(raw.gaps && raw.gaps.length ? [{ kind: 'gap', label: 'ขาดทั้งวัน', n: raw.gaps.length, qty: 0 }] : []),
      marks: marks,
    };
  }

  /** เปลี่ยนจากเดือนก่อน: ชิ้นเป็นร้อยละ ร้อยละเป็นจุด ไม่มีเดือนก่อนให้เทียบได้ null */
  function change(now, before, unit) {
    if (now === null || now === undefined || before === null || before === undefined) return null;
    if (unit === 'pt') return { d: Math.round((now - before) * 10) / 10, unit: 'pt' };
    if (!before) return null;
    return { d: Math.round((now - before) / before * 1000) / 10, unit: '%' };
  }

  /**
   * ข้อความสรุปเดือนให้หัวหน้า วางใน LINE ได้เลย บรรทัดที่ไม่มีข้อมูลไม่ใส่ ดีกว่าใส่ขีดให้ต้องถามต่อ
   * o = { ym, m: month(), prev: month() ของเดือนก่อน, count: countMonth(), cut: cut() ถ้าเป็นเดือนเดียวกัน, now: stockNow(), asOf }
   */
  function briefText(o) {
    var lines = ['สรุปสต๊อก ' + monthName(o.ym)];
    var m = o.m;
    if (m) {
      var ch = comparable(m, o.prev) ? change(m.perDay, o.prev.perDay) : null;
      lines.push('• หยิบขาย ' + fmt(m.sale.qty) + ' ชิ้น ใน ' + m.saleDays + ' วัน เฉลี่ยวันละ ' + fmt(m.perDay) +
        (ch ? ' (' + (ch.d > 0 ? '+' : '') + ch.d + '% จาก ' + monthShort(prevMonth(o.ym)) + ')' : ''));
      if (m.sale.pct !== null) lines.push('• หยิบขายตาม FIFO ' + m.sale.pct + '%' + (m.refill.pct !== null ? ' · เติมของตาม FIFO ' + m.refill.pct + '%' : ''));
      if (m.ages.known) lines.push('• สต๊อกอายุ 7 เดือนขึ้นไป ' + fmt(m.ages.old) + ' ชิ้น (' + m.ages.oldPct + '% ของที่รู้ LOT)');
    }
    if (o.count) {
      lines.push('• นับสต๊อก ' + fmt(o.count.counted) + ' รายการ' +
        (o.count.pct !== null ? ' · สุ่มนับตรง ' + o.count.pct + '% (' + fmt(o.count.match) + '/' + fmt(o.count.sample) + ')' : ''));
    }
    if (o.cut) {
      lines.push('• ตัดสต๊อกตรงกับ Report ' + o.cut.okPct + '% · ต้องแก้ ' + fmt(o.cut.todo) + ' รายการ' +
        (o.cut.marks ? ' (กดแก้แล้ว ' + fmt(o.cut.marks.fixed) + ')' : ''));
    }
    if (o.now) lines.push('• คงเหลือตอนนี้ ' + fmt(o.now.net) + ' ชิ้น ' + fmt(o.now.skus) + ' SKU');
    if (o.asOf) lines.push('ข้อมูลเมื่อ ' + o.asOf);
    return lines.join('\n');
  }

  window.WmsDash = {
    REFILL_DAYS: REFILL_DAYS,
    COMPARE_DAYS: COMPARE_DAYS,
    comparable: comparable,
    FIX_KINDS: FIX_KINDS,
    AGES: AGES,
    monthName: monthName,
    monthShort: monthShort,
    prevMonth: prevMonth,
    stockNow: stockNow,
    ages: ages,
    month: month,
    countMonth: countMonth,
    countNow: countNow,
    cut: cut,
    change: change,
    briefText: briefText,
  };
})();
