/**
 * @file wms-cut.js — เทียบยอดออกราย SKU ราย วัน ระหว่างสามแหล่ง และกับยอดที่ควรออกตาม Report
 *
 *   s  แถว "ขาย" ในสมุด Transaction ของหน้าสต๊อกราย Location (apps-script/tx-api.gs)
 *   x  แท็บตัดสต๊อกระบบ Transaction (apps-script/cut-api.gs)
 *   t  แท็บตัดสต๊อกระบบ TRcloud คิดเป็น เบิกออก − รับเข้า (apps-script/cut-api.gs)
 *   r  ยอดที่ควรออกตาม Report JST + CRM ตามวันที่ออกจากคลัง บวกงานโอนย้าย (apps-script/cut-api.gs)
 *
 * สองสคริปต์ผูกกับคนละไฟล์และไม่รู้จักกัน จะให้สคริปต์เปิดอีกไฟล์ได้ก็ต้องใส่รหัสไฟล์ลงในโค้ด
 * ซึ่ง repo นี้เป็นสาธารณะ หน้าเว็บจึงเป็นคนเอาสองคำตอบมาเทียบกัน
 *
 * สามแหล่งแรกเทียบกันเองเป็นหลัก Report เทียบแยกอีกชุด เพราะวันที่ใน Report คือวันที่ออกจากคลัง
 * ซึ่งบางออเดอร์ลงตัดสต๊อกคนละวัน cut-api.gs รุ่นก่อนไม่ส่ง r มา ตอนนั้นเทียบแค่สามแหล่ง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsCut
 */
(function () {
  'use strict';

  var LABEL = { s: 'UAT', x: 'Uploadยิงออก', t: 'TRcloud', r: 'Report ควรออก' };
  var SIDES = ['s', 'x', 't'];

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

  function gap(label, mine, goal) {
    return label + (mine < goal ? ' ขาด ' : ' เกิน ') + fmt(Math.abs(mine - goal));
  }

  /** อ่านแล้วต้องรู้เลยว่าฝั่งไหนต่างและต่างเท่าไร ไม่ต้องลบเลขเอง */
  function diffWords(s, x, t) {
    var odd = oddOne(s, x, t);
    if (!odd) return '';
    if (odd === 'all') return gap(LABEL.x, x, s) + ' · ' + gap(LABEL.t, t, s) + ' จากยอด ' + LABEL.s;
    return odd === 's' ? gap(LABEL.s, s, x) : odd === 'x' ? gap(LABEL.x, x, s) : gap(LABEL.t, t, s);
  }

  /** ต่างจาก Report ยังไง ถ้าสามระบบต่างเท่ากันพูดครั้งเดียว */
  function reportWords(r, s, x, t) {
    if (s === r && x === r && t === r) return '';
    if (s === x && x === t) return gap('ทั้งสามระบบ', s, r);
    var v = { s: s, x: x, t: t };
    return SIDES.filter(function (k) { return v[k] !== r; })
      .map(function (k) { return gap(LABEL[k], v[k], r); }).join(' · ');
  }

  /** ใส่ยอดของแหล่งหนึ่งลงตาราง วัน → SKU → {r, s, x, t} */
  function put(grid, side, days, skus, cells, nameOf) {
    cells.forEach(function (c) {
      var d = days[c[0]], sku = skus[c[1]][0], name = skus[c[1]][1];
      var byDay = grid[d] || (grid[d] = {});
      var cell = byDay[sku] || (byDay[sku] = { r: 0, s: 0, x: 0, t: 0, sys: false });
      cell[side] += c[2];
      /* ช่องที่มีแต่ Report ไม่นับในจำนวนรายการที่สามระบบเทียบกัน */
      if (side !== 'r') cell.sys = true;
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

  function offReport(c) { return c.s !== c.r || c.x !== c.r || c.t !== c.r; }

  /**
   * @param {{days:string[], skus:Array, x:Array, t:Array, r?:Array}} daily  ส่วน daily จาก ?api=cut-check
   * @param {{from:string, to:string}} period  ช่วงของ Report
   * @param {{days:string[], skus:Array, cells:Array, last:string}} ledger  คำตอบจาก ?api=tx-daily
   */
  function compareDaily(daily, period, ledger) {
    /* สมุดยังลงไม่ถึงวันไหน วันนั้นเทียบไม่ได้ ไม่ใช่ขาดจริง */
    var to = ledger.last && ledger.last < period.to ? ledger.last : period.to;
    var from = period.from;
    var hasR = !!daily.r;

    var grid = {}, nameOf = {};
    put(grid, 's', ledger.days, ledger.skus, ledger.cells, nameOf);
    put(grid, 'x', daily.days, daily.skus, daily.x, nameOf);
    put(grid, 't', daily.days, daily.skus, daily.t, nameOf);
    if (hasR) put(grid, 'r', daily.days, daily.skus, daily.r, nameOf);

    var calendar = [];
    for (var d = from; d && d <= to; d = nextDay(d)) calendar.push(d);

    /* วันที่อยู่ในช่วงของ Report แต่สมุดยังลงไม่ถึง บอกยอดอีกสองฝั่งไว้ให้เห็นว่าเหลืออีกเท่าไร */
    var waiting = [];
    if (to < period.to) {
      for (var w = to < from ? from : nextDay(to); w <= period.to; w = nextDay(w)) {
        var later = grid[w];
        if (!later) continue;
        var sum = { date: w, r: 0, x: 0, t: 0 };
        Object.keys(later).forEach(function (sku) { sum.r += later[sku].r; sum.x += later[sku].x; sum.t += later[sku].t; });
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
        if (c.sys) {
          keys++;
          if (c.s === c.x && c.x === c.t) equal++;
        }
        var one = bySku[sku] || (bySku[sku] = { dx: {}, dt: {}, rd: { s: {}, x: {}, t: {} }, r: 0, s: 0, x: 0, t: 0 });
        one.r += c.r; one.s += c.s; one.x += c.x; one.t += c.t;
        if (c.s !== c.x) one.dx[date] = c.s - c.x;
        if (c.s !== c.t) one.dt[date] = c.s - c.t;
        if (hasR) SIDES.forEach(function (k) { if (c[k] !== c.r) one.rd[k][date] = c[k] - c.r; });
      });
    });

    Object.keys(bySku).forEach(function (sku) {
      var one = bySku[sku];
      one.mx = settle(calendar, one.dx);
      one.mt = settle(calendar, one.dt);
      one.rm = {};
      SIDES.forEach(function (k) { one.rm[k] = settle(calendar, one.rd[k]); });
    });

    var days = [], rows = [];
    var shiftKeys = 0;
    calendar.forEach(function (date) {
      var byDay = grid[date];
      if (!byDay) return;
      var day = { date: date, r: 0, s: 0, x: 0, t: 0, status: 'ok', bad: 0, shift: 0, moved: 0, rep: null };
      /* เทียบกับ Report: s, x, t คือยอดที่ยังต่างหลังหักที่ลงคนละวันแล้ว split คือ SKU ที่หักได้แค่บางส่วน */
      var rep = hasR ? { status: 'ok', bad: 0, shift: 0, moved: 0, split: 0, s: 0, x: 0, t: 0 } : null;
      Object.keys(byDay).forEach(function (sku) {
        var c = byDay[sku], one = bySku[sku];
        day.r += c.r; day.s += c.s; day.x += c.x; day.t += c.t;
        var three = !!oddOne(c.s, c.x, c.t), off = hasR && offReport(c);
        if (!three && !off) return;
        /* นับว่าลงคนละวันก็ต่อเมื่อหักแล้วเท่ากันทั้งสามช่อง ถ้ายังเหลือแปลว่ามีเรื่องอื่นปนอยู่ */
        var moved = 0, rmoved = 0, rl = null;
        if (three) {
          moved = one.dx[date] || one.dt[date] ? 0 : Math.max(one.mx[date] || 0, one.mt[date] || 0);
          if (moved) { day.shift++; day.moved += moved; shiftKeys++; }
          else day.bad++;
        }
        if (off) {
          var left = { s: one.rd.s[date] || 0, x: one.rd.x[date] || 0, t: one.rd.t[date] || 0 };
          var part = Math.max.apply(null, SIDES.map(function (k) { return one.rm[k][date] || 0; }));
          if (!left.s && !left.x && !left.t) { rmoved = part; rep.shift++; rep.moved += part; }
          else {
            rep.bad++;
            SIDES.forEach(function (k) { rep[k] += left[k]; });
            /* ส่วนใหญ่อาจเป็นของที่ลงคนละวัน ต้องบอกยอดที่เหลือจริง ไม่ใช่ยอดดิบ */
            if (part) { rep.split++; rl = left; }
          }
        }
        rows.push({ date: date, sku: sku, name: nameOf[sku] || '', r: c.r, s: c.s, x: c.x, t: c.t, moved: moved, rmoved: rmoved, rl: rl });
      });
      day.status = day.bad ? 'bad' : day.shift ? 'shift' : 'ok';
      if (rep) rep.status = rep.bad ? 'bad' : rep.shift ? 'shift' : 'ok';
      day.rep = rep;
      days.push(day);
    });

    /* ในวันเดียวกัน เรื่องที่ต่างจริงขึ้นก่อน แล้วเรียงจากเรื่องใหญ่ */
    function size(r) {
      var m = Math.max(Math.abs(r.s - r.x), Math.abs(r.s - r.t), Math.abs(r.x - r.t));
      return hasR ? Math.max(m, Math.abs(r.s - r.r), Math.abs(r.x - r.r), Math.abs(r.t - r.r)) : m;
    }
    function settled(r) {
      return (!oddOne(r.s, r.x, r.t) || r.moved ? 1 : 0) && (!hasR || !offReport(r) || r.rmoved ? 1 : 0);
    }
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return settled(a) - settled(b) || size(b) - size(a) || (a.sku < b.sku ? -1 : 1);
    });

    var skus = Object.keys(bySku).map(function (sku) {
      var one = bySku[sku];
      return { sku: sku, name: nameOf[sku] || '', r: one.r, s: one.s, x: one.x, t: one.t };
    }).filter(function (r) { return oddOne(r.s, r.x, r.t) || (hasR && offReport(r)); });
    skus.sort(function (a, b) { return size(b) - size(a) || (a.sku < b.sku ? -1 : 1); });

    function countOf(list, test) { return list.filter(test).length; }
    return {
      from: from, to: to, last: ledger.last, waiting: waiting, hasR: hasR,
      days: days, rows: rows, skus: skus,
      counts: {
        daysOk: countOf(days, function (x) { return x.status === 'ok'; }),
        daysShift: countOf(days, function (x) { return x.status === 'shift'; }),
        daysBad: countOf(days, function (x) { return x.status === 'bad'; }),
        keys: keys, equal: equal,
        shiftKeys: shiftKeys,
        skusBad: countOf(skus, function (r) { return oddOne(r.s, r.x, r.t); }),
        repOk: countOf(days, function (x) { return x.rep && x.rep.status === 'ok'; }),
        repShift: countOf(days, function (x) { return x.rep && x.rep.status === 'shift'; }),
        repBad: countOf(days, function (x) { return x.rep && x.rep.status === 'bad'; }),
      },
      totals: days.reduce(function (t, x) {
        t.r += x.r; t.s += x.s; t.x += x.x; t.t += x.t;
        return t;
      }, { r: 0, s: 0, x: 0, t: 0 }),
    };
  }

  window.WmsCut = { LABEL: LABEL, oddOne: oddOne, diffWords: diffWords, reportWords: reportWords, compareDaily: compareDaily };
})();
