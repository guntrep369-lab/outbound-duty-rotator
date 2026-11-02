/**
 * @file wms-cut.js — เทียบยอดออกราย SKU ราย วัน ระหว่างสามแหล่ง
 *
 *   s  แถว "ขาย" ในสมุด Transaction ของหน้าสต๊อกราย Location (apps-script/tx-api.gs)
 *   x  แท็บตัดสต๊อกระบบ Transaction (apps-script/cut-api.gs)
 *   t  แท็บตัดสต๊อกระบบ TRcloud คิดเป็น เบิกออก − รับเข้า (apps-script/cut-api.gs)
 *
 * สองสคริปต์ผูกกับคนละไฟล์และไม่รู้จักกัน จะให้สคริปต์เปิดอีกไฟล์ได้ก็ต้องใส่รหัสไฟล์ลงในโค้ด
 * ซึ่ง repo นี้เป็นสาธารณะ หน้าเว็บจึงเป็นคนเอาสองคำตอบมาเทียบกัน
 *
 * ไม่ได้เทียบกับ Report เพราะวันที่ใน Report คือวันที่ขนส่งออก ไม่ใช่วันที่ลงตัดสต๊อก
 * และ Report ไม่มีงานโอนย้าย ซึ่งแถวขายในสมุดรวมอยู่ด้วย
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsCut
 */
(function () {
  'use strict';

  var LABEL = { s: 'UAT', x: 'Uploadยิงออก', t: 'TRcloud' };

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  function nextDay(ymd) {
    var p = ymd.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)).toISOString().slice(0, 10);
  }

  /** ช่องไหนที่ต่างจากอีกสองช่อง '' = ตรงกันหมด, 'all' = ไม่มีสองช่องไหนเท่ากันเลย */
  function oddOne(s, x, t) {
    if (s === x && x === t) return '';
    if (x === t) return 's';
    if (s === t) return 'x';
    if (s === x) return 't';
    return 'all';
  }

  /** อ่านแล้วต้องรู้เลยว่าฝั่งไหนต่างและต่างเท่าไร ไม่ต้องลบเลขเอง */
  function diffWords(s, x, t) {
    var odd = oddOne(s, x, t);
    if (!odd) return '';
    function gap(label, mine, rest) {
      return label + (mine < rest ? ' ขาด ' : ' เกิน ') + fmt(Math.abs(mine - rest));
    }
    if (odd === 'all') return gap(LABEL.x, x, s) + ' · ' + gap(LABEL.t, t, s) + ' จากยอด ' + LABEL.s;
    return odd === 's' ? gap(LABEL.s, s, x) : odd === 'x' ? gap(LABEL.x, x, s) : gap(LABEL.t, t, s);
  }

  /** ใส่ยอดของแหล่งหนึ่งลงตาราง วัน → SKU → {s, x, t} */
  function put(grid, side, days, skus, cells, nameOf) {
    cells.forEach(function (c) {
      var d = days[c[0]], sku = skus[c[1]][0], name = skus[c[1]][1];
      var byDay = grid[d] || (grid[d] = {});
      var cell = byDay[sku] || (byDay[sku] = { s: 0, x: 0, t: 0 });
      cell[side] += c[2];
      if (name && !nameOf[sku]) nameOf[sku] = name;
    });
  }

  /**
   * ยอดที่ต่างกันสวนทางกันในวันติดกัน เช่นฝั่งหนึ่งวันนี้ขาด 5 พรุ่งนี้เกิน 5 คือของชุดเดียวกันที่ลงคนละวัน
   * หักส่วนนี้ออกจาก diff แล้วบอกจำนวนที่หักกลับไป
   */
  function settle(dates, diff) {
    var moved = {};
    for (var i = 0; i + 1 < dates.length; i++) {
      var a = dates[i], b = dates[i + 1];
      if (!diff[a] || !diff[b] || diff[a] * diff[b] > 0) continue;
      var m = Math.min(Math.abs(diff[a]), Math.abs(diff[b]));
      diff[a] += diff[a] > 0 ? -m : m;
      diff[b] += diff[b] > 0 ? -m : m;
      moved[a] = (moved[a] || 0) + m;
      moved[b] = (moved[b] || 0) + m;
    }
    return moved;
  }

  /**
   * @param {{days:string[], skus:Array, x:Array, t:Array}} daily  ส่วน daily จาก ?api=cut-check
   * @param {{from:string, to:string}} period  ช่วงของ Report
   * @param {{days:string[], skus:Array, cells:Array, last:string}} ledger  คำตอบจาก ?api=tx-daily
   */
  function compareDaily(daily, period, ledger) {
    /* สมุดยังลงไม่ถึงวันไหน วันนั้นเทียบไม่ได้ ไม่ใช่ขาดจริง */
    var to = ledger.last && ledger.last < period.to ? ledger.last : period.to;
    var from = period.from;

    var grid = {}, nameOf = {};
    put(grid, 's', ledger.days, ledger.skus, ledger.cells, nameOf);
    put(grid, 'x', daily.days, daily.skus, daily.x, nameOf);
    put(grid, 't', daily.days, daily.skus, daily.t, nameOf);

    var calendar = [];
    for (var d = from; d && d <= to; d = nextDay(d)) calendar.push(d);

    /* วันที่อยู่ในช่วงของ Report แต่สมุดยังลงไม่ถึง บอกยอดอีกสองฝั่งไว้ให้เห็นว่าเหลืออีกเท่าไร */
    var waiting = [];
    if (to < period.to) {
      for (var w = to < from ? from : nextDay(to); w <= period.to; w = nextDay(w)) {
        var later = grid[w];
        if (!later) continue;
        var sum = { date: w, x: 0, t: 0 };
        Object.keys(later).forEach(function (sku) { sum.x += later[sku].x; sum.t += later[sku].t; });
        waiting.push(sum);
      }
    }

    var bySku = {};
    var keys = 0, equal = 0;
    calendar.forEach(function (date) {
      var byDay = grid[date];
      if (!byDay) return;
      Object.keys(byDay).forEach(function (sku) {
        var c = byDay[sku];
        keys++;
        if (c.s === c.x && c.x === c.t) equal++;
        var one = bySku[sku] || (bySku[sku] = { dx: {}, dt: {}, s: 0, x: 0, t: 0 });
        one.s += c.s; one.x += c.x; one.t += c.t;
        if (c.s !== c.x) one.dx[date] = c.s - c.x;
        if (c.s !== c.t) one.dt[date] = c.s - c.t;
      });
    });

    Object.keys(bySku).forEach(function (sku) {
      var one = bySku[sku];
      one.mx = settle(calendar, one.dx);
      one.mt = settle(calendar, one.dt);
    });

    var days = [], rows = [];
    var shiftKeys = 0;
    calendar.forEach(function (date) {
      var byDay = grid[date];
      if (!byDay) return;
      var day = { date: date, s: 0, x: 0, t: 0, status: 'ok', bad: 0, shift: 0, moved: 0 };
      Object.keys(byDay).forEach(function (sku) {
        var c = byDay[sku], one = bySku[sku];
        day.s += c.s; day.x += c.x; day.t += c.t;
        if (c.s === c.x && c.x === c.t) return;
        /* นับว่าลงคนละวันก็ต่อเมื่อหักแล้วเท่ากันทั้งสามช่อง ถ้ายังเหลือแปลว่ามีเรื่องอื่นปนอยู่ */
        var moved = one.dx[date] || one.dt[date] ? 0 : Math.max(one.mx[date] || 0, one.mt[date] || 0);
        if (moved) { day.shift++; day.moved += moved; shiftKeys++; }
        else day.bad++;
        rows.push({ date: date, sku: sku, name: nameOf[sku] || '', s: c.s, x: c.x, t: c.t, moved: moved });
      });
      day.status = day.bad ? 'bad' : day.shift ? 'shift' : 'ok';
      days.push(day);
    });

    /* ในวันเดียวกัน เรื่องที่ต่างจริงขึ้นก่อน แล้วเรียงจากเรื่องใหญ่ */
    function size(r) { return Math.max(Math.abs(r.s - r.x), Math.abs(r.s - r.t), Math.abs(r.x - r.t)); }
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.moved ? 1 : 0) - (b.moved ? 1 : 0) || size(b) - size(a) || (a.sku < b.sku ? -1 : 1);
    });

    var skus = Object.keys(bySku).map(function (sku) {
      var one = bySku[sku];
      return { sku: sku, name: nameOf[sku] || '', s: one.s, x: one.x, t: one.t };
    }).filter(function (r) { return oddOne(r.s, r.x, r.t); });
    skus.sort(function (a, b) { return size(b) - size(a) || (a.sku < b.sku ? -1 : 1); });

    return {
      from: from, to: to, last: ledger.last, waiting: waiting,
      days: days, rows: rows, skus: skus,
      counts: {
        daysOk: days.filter(function (x) { return x.status === 'ok'; }).length,
        daysShift: days.filter(function (x) { return x.status === 'shift'; }).length,
        daysBad: days.filter(function (x) { return x.status === 'bad'; }).length,
        keys: keys, equal: equal,
        shiftKeys: shiftKeys,
        skusBad: skus.length,
      },
      totals: days.reduce(function (t, x) {
        t.s += x.s; t.x += x.x; t.t += x.t;
        return t;
      }, { s: 0, x: 0, t: 0 }),
    };
  }

  window.WmsCut = { LABEL: LABEL, oddOne: oddOne, diffWords: diffWords, compareDaily: compareDaily };
})();
