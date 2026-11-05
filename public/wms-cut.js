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
 * ช่องที่ไม่ตรงแตกลงไปได้ถึงออเดอร์ (cut-api.gs) และถึงแถวในชีตทีม (tx-api.gs) ด้วย cellIndex
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

  function dayMonth(ymd) {
    var p = String(ymd || '').split('-');
    return p.length === 3 ? +p[2] + '/' + +p[1] : '';
  }

  /**
   * รายละเอียดของช่อง วัน + SKU: ออเดอร์จาก cut-api.gs และแถวขายในชีตทีมจาก tx-api.gs สร้างดัชนีครั้งเดียว
   * listed บอกว่า cut-api.gs ส่งรายออเดอร์ของช่องนี้มา ช่องที่ Upload, TRcloud และ Report เท่ากันจะไม่ถูกส่ง
   * hasOrders, hasRows เป็น false เมื่อสคริปต์ฝั่งนั้นยังเป็นรุ่นที่ไม่ส่งรายละเอียด
   */
  function cellIndex(daily, ledger) {
    var at = {};
    function blank() { return { listed: false, orders: [], moved: [], ok: { orders: 0, qty: 0 }, more: 0, rows: [] }; }
    function one(d, sku) {
      var id = d + '|' + sku;
      return at[id] || (at[id] = blank());
    }
    /* สคริปต์รุ่นก่อนส่งวันใน Report เป็นวันเดียว ('' คือไม่มี) รุ่นนี้ส่งเป็นรายการวัน */
    function days(v) { return [].concat(v || []); }
    (daily.detail || []).forEach(function (c) {
      var o = one(daily.days[c[0]], daily.skus[c[1]][0]);
      o.listed = true;
      o.ok = { orders: c[2], qty: c[3] };
      o.more = c[4];
      o.orders = c[5].map(function (e) {
        return { ref: e[0], sys: e[1], x: e[2], t: e[3], r: e[4], kind: e[5], od: days(e[6]), xo: e[7], to: e[8] };
      });
      o.moved = c[6].map(function (g) {
        return { od: days(g[0]), xo: g[1], to: g[2], orders: g[3], x: g[4], t: g[5], r: g[6], refs: g[7] };
      });
    });
    (ledger.lines || []).forEach(function (l) {
      one(ledger.days[l[0]], ledger.skus[l[1]][0]).rows.push({
        row: l[2], loc: ledger.locs[l[3]], lot: l[4], po: l[5], qty: l[6], who: ledger.whos[l[7]],
      });
    });
    var none = blank();
    return {
      hasOrders: !!daily.detail, hasRows: !!ledger.lines, sheet: ledger.sheet || null,
      get: function (d, sku) { return at[d + '|' + sku] || none; },
    };
  }

  /** ลงวันอื่นยังไง เช่น Report ลงวันที่ 12/10 หรือตัดวันที่ 13/10 ทั้งสองระบบ */
  function dateWords(e) {
    var out = [], od = e.od.map(dayMonth).join(', ');
    if (od) out.push('Report ลงวันที่ ' + od);
    var xo = e.xo.map(dayMonth).join(', '), to = e.to.map(dayMonth).join(', ');
    if (xo && xo === to) out.push('ตัดวันที่ ' + xo + ' ทั้งสองระบบ');
    else {
      if (xo) out.push(LABEL.x + ' ตัดวันที่ ' + xo);
      if (to) out.push(LABEL.t + ' ตัดวันที่ ' + to);
    }
    return out.join(' · ');
  }

  /** ช่องนี้ต้องไปดูที่ไหนก่อน ตัดสินจากแหล่งที่ต่างจากแหล่งอื่น */
  function fixHint(r, hasR) {
    var odd = oddOne(r.s, r.x, r.t);
    var offR = hasR && r.x !== r.r;
    if (odd === 's') {
      return LABEL.s + ' ต่างจาก ' + LABEL.x + ' และ ' + LABEL.t + ' ให้ดูแถวในชีตทีม' +
        (offR ? ' ส่วนสองระบบนั้นก็ไม่ตรง Report ให้ดูรายออเดอร์ด้วย' : '');
    }
    if (odd === 'x' || odd === 't') return LABEL[odd] + ' ต่างจากอีกสองแหล่ง ให้ดูรายออเดอร์';
    if (odd === 'all') return 'ทั้งสามแหล่งไม่เท่ากัน ให้ดูทั้งรายออเดอร์และแถวในชีตทีม';
    if (hasR && r.s !== r.r) return 'ทั้งสามแหล่งตรงกัน แต่ไม่ตรง Report ให้ดูรายออเดอร์ว่าเปลี่ยนสถานะหรือลงคนละวัน';
    return 'ตรงกันทุกแหล่ง';
  }

  var CUT_DAYS = { x: 'xd', t: 'td' };

  /**
   * ทุกเรื่องที่ต้องแก้ แยกตามระบบที่ต้องไปแก้ ไม่ใช่ตามระบบขาย ส่งต่อให้คนดูแลแต่ละระบบได้เลย
   * Upload กับ TRcloud มาจากรายออเดอร์ของ cut-api.gs ตรงๆ ชีตทีมไม่มีเลขออเดอร์ จึงมาจากเทียบรายวันสองทาง
   *   sheet  ช่องที่ชีตทีมต่างจากสองระบบที่ตรงกันเอง ให้ลงตามสองระบบนั้น ช่องที่ลงคนละวันไม่นับ ยอดรวมตรงแล้ว
   *   ออเดอร์ที่ Upload หรือ TRcloud ผิด แล้วชีตทีมทุกวันที่ตัดเท่ากับระบบที่ผิด แปลว่าชีตทีมลงผิดตามไปด้วย
   * need บวก = ต้องลงเพิ่ม ลบ = ต้องคืน
   * @param {Array} rows  rows จาก ?api=cut-check
   * @param {Array} gaps  gaps จาก ?api=cut-check
   * @param {Object} [c]  ผลของ compareDaily ไม่มีคือยังไม่ได้ดึงยอดขาย รายการของชีตทีมจะเป็น null
   * @param {Object} [cells]  ผลของ cellIndex ใช้บอกว่าช่องของชีตทีมมีออเดอร์ที่อีกสองระบบต้องแก้ปนอยู่
   */
  function fixLists(rows, gaps, c, cells) {
    var out = { s: c ? [] : null, x: [], t: [], unclear: 0 };
    var at = {};
    if (c) c.rows.forEach(function (r) { at[r.date + '|' + r.sku] = r; });
    /* ช่องที่เปิดดูรายละเอียดได้ในเทียบรายวัน ช่องที่สามแหล่งเท่ากันไม่มีให้เปิด */
    var cellOf = function (d, sku) { return sku && at[d + '|' + sku] ? d + '|' + sku : ''; };
    rows.forEach(function (r) {
      ['x', 't'].forEach(function (k) {
        if (r[k] === r.goal) return;
        var days = r[CUT_DAYS[k]];
        out[k].push({
          date: r.date, ref: r.ref, sku: r.sku, sys: r.sys, kind: r.k, need: r.goal - r[k], days: days, lines: r.lines || 0,
          cell: cellOf(days[0] || r.date, r.sku),
        });
      });
    });
    gaps.forEach(function (g) {
      (g.side === 'both' ? ['x', 't'] : [g.side === 'tx' ? 'x' : 't']).forEach(function (k) {
        out[k].push({ date: g.date, ref: '', sku: '', sys: g.sys, kind: 'gap', need: g.qty, days: [], lines: g.lines, orders: g.orders, refs: g.refs, cell: '' });
      });
    });
    if (c) {
      /* ช่องที่ไม่อยู่ในรายการของเทียบรายวันคือสามแหล่งเท่ากัน วันนอกช่วงที่เทียบได้บอกไม่ได้ */
      var same = function (d, sku, k) {
        if (!d || d < c.from || d > c.to) return false;
        var r = at[d + '|' + sku];
        return !r || r.s === r[k];
      };
      c.rows.forEach(function (r) {
        var odd = oddOne(r.s, r.x, r.t);
        if (r.moved || !odd) return;
        if (odd !== 's') {
          if (odd === 'all') out.unclear++;
          return;
        }
        var one = cells ? cells.get(r.date, r.sku) : null;
        out.s.push({
          date: r.date, ref: '', sku: r.sku, name: r.name, kind: 'sheet', need: r.x - r.s, days: [],
          cell: cellOf(r.date, r.sku), mixed: !!(one && one.orders.length),
        });
      });
      rows.forEach(function (r) {
        if (!r.sku) return;
        for (var i = 0; i < 2; i++) {
          var k = i ? 't' : 'x';
          var days = r[CUT_DAYS[k]].length ? r[CUT_DAYS[k]] : [r.date];
          if (r[k] === r.goal || !days.every(function (d) { return same(d, r.sku, k); })) continue;
          out.s.push({
            date: r.date, ref: r.ref, sku: r.sku, sys: r.sys, kind: r.k, need: r.goal - r[k], days: days, via: k,
            cell: cellOf(days[0], r.sku),
          });
          break;
        }
      });
    }
    ['s', 'x', 't'].forEach(function (k) {
      if (!out[k]) return;
      out[k].sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return Math.abs(b.need) - Math.abs(a.need) || (a.ref + a.sku < b.ref + b.sku ? -1 : 1);
      });
    });
    return out;
  }

  /**
   * คีย์ของรายการแก้ในบันทึกการแก้ ไม่ใส่ประเภท เพราะคืนยอดตัดเกินเกินไปจะกลายเป็นตัดไม่ครบ ต้องยังเป็นรายการเดิม
   * ก้อนขาดทั้งวันไม่มีออเดอร์และ SKU ใช้ระบบขายแทน
   */
  function fixKey(k, e) {
    return [k, e.date, e.ref || '', e.sku || '', e.ref || e.sku ? '' : e.sys || ''].join('|');
  }

  /**
   * สถานะของรายการแก้แต่ละรายการตามบันทึกการแก้ (cut-api.gs ?api=cut-fixlog) แถวหลังสุดของคีย์เดียวกันคือสถานะตอนนี้
   *   open   ยังไม่ได้กดแก้แล้ว (back = เคยตรวจแล้วหาย แต่กลับมาอีก)
   *   wait   กดแก้แล้ว ยังไม่ได้ตรวจใหม่หลังกด
   *   still  ตรวจใหม่หลังกดแล้วยังต้องแก้เท่าเดิมหรือมากกว่า
   *   part   ตรวจใหม่แล้วเหลือน้อยลง แก้ไปบางส่วน
   *   flip   ตรวจใหม่แล้วยอดกลับข้าง เช่นต้องคืน 2 กลายเป็นต้องลงเพิ่ม 2 น่าจะแก้ซ้ำสองรอบ
   * รายการที่กดแก้แล้วและตรวจรอบหลังไม่พบ อยู่ใน gone ให้หน้าเว็บส่งไปบันทึกว่าตรวจแล้วหาย
   * done คือรายการที่ตรวจแล้วหาย (รวม gone) ไว้แสดงเป็นประวัติ เป็นแถวที่กดแก้แล้ว จะได้บอกว่าใครแก้เมื่อไร
   * @param {Object} fx   ผลของ fixLists ระบบที่เป็น null ยังไม่รู้รายการ จึงไม่ตัดสินรายการของระบบนั้น
   * @param {Array} log   log จาก cut-fixlog เรียงตามที่บันทึก
   * @param {Object} seen เวลาที่ได้ข้อมูลของแต่ละระบบ { s, x, t } เป็นเวลาของสคริปต์ เทียบกับเวลาที่กดได้ตรง
   * @param {boolean} [capped] สคริปต์ส่งรายการไม่ครบบางประเภท รายการที่หายไปอาจแค่ไม่ได้ส่งมา ยังบอกไม่ได้ว่าหาย
   */
  function fixState(fx, log, seen, capped) {
    var last = {}, fixed = {};
    (log || []).forEach(function (r) {
      last[r.key] = r;
      if (r.act === 'แก้แล้ว') fixed[r.key] = r;
    });
    var by = {}, here = {}, gone = [], done = [];
    ['s', 'x', 't'].forEach(function (k) {
      (fx[k] || []).forEach(function (e) {
        var key = fixKey(k, e), m = last[key];
        here[key] = 1;
        if (!m || m.act !== 'แก้แล้ว') { by[key] = { state: 'open', back: !!m && m.act === 'ตรวจแล้วหาย' }; return; }
        var state = 'still';
        if (!(seen[k] > m.at)) state = 'wait';
        else if (e.need * m.need < 0) state = 'flip';
        else if (Math.abs(e.need) < Math.abs(m.need)) state = 'part';
        by[key] = { state: state, mark: m };
      });
    });
    Object.keys(last).forEach(function (key) {
      var m = last[key];
      if (here[key]) return;
      if (m.act === 'ตรวจแล้วหาย') done.push(fixed[key] || m);
      else if (m.act === 'แก้แล้ว' && fx[m.k] && seen[m.k] > m.at && !capped) { gone.push(m); done.push(m); }
    });
    done.sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.at - b.at; });
    return { by: by, gone: gone, done: done };
  }

  /** ลิงก์เปิดชีตตรงแถวนั้น แบบเดียวกับ WmsTx.rowUrl หน้านี้ไม่ได้โหลด wms-tx.js */
  function rowUrl(sheet, row) {
    if (!sheet || !sheet.url) return '';
    return String(sheet.url).split('#')[0] + '#gid=' + sheet.gid + '&range=A' + row;
  }

  /**
   * แถวในแท็บตัดผิด / ตัดเกิน ต่างจาก Report ยังไงและฝั่งไหน อ่านแล้วไม่ต้องลบเลขเอง
   * r = แถวจาก cut-check มี goal (ยอดที่ควรตัด) x (Uploadยิงออก) t (TRcloud)
   */
  function rowDiff(r) {
    var word = function (d) {
      if (r.goal === 0) return d > 0 ? 'ตัดอยู่ ' + fmt(d) : 'ติดลบ ' + fmt(-d);
      return d > 0 ? 'เกิน ' + fmt(d) : 'ขาด ' + fmt(-d);
    };
    var dx = r.x - r.goal, dt = r.t - r.goal;
    if (dx === dt) return dx ? word(dx) + ' ทั้งสองระบบ' : '';
    return [dx ? LABEL.x + ' ' + word(dx) : '', dt ? LABEL.t + ' ' + word(dt) : ''].filter(Boolean).join(' · ');
  }

  /* เลขออเดอร์แบบเดียวกับ ref_ ใน cut-api.gs บางแถวมีวันที่ต่อท้ายหลัง · */
  function refKey(v) { return String(v == null ? '' : v).split(' · ')[0].trim().toUpperCase(); }

  var EXPORT_HEAD = ['ออเดอร์', 'ระบบ', 'ขนส่ง', 'เรื่อง', 'SKU', 'ชื่อสินค้า', 'วันที่ Report', 'สถานะขนส่ง',
    'Report', LABEL.x, LABEL.t, 'ต่างกันยังไง', 'วันที่ตัด ' + LABEL.x, 'วันที่ตัด ' + LABEL.t, 'เหตุผลใน TRcloud'];
  var REPORT_SHEET = { JST: 'Report JST', CRM: 'Report CRM', 'โอนย้าย': 'Report โอนย้าย' };
  var SKU_HEAD = /^(รหัสสินค้า|SKU)/i;

  /** กว้างพอให้อ่านค่ายาวสุดใน 200 แถวแรก แต่ไม่เกิน 45 ตัวอักษร */
  function widthsOf(aoa) {
    var out = [];
    aoa.slice(0, 200).forEach(function (row) {
      row.forEach(function (v, i) { out[i] = Math.max(out[i] || 6, Math.min(45, String(v == null ? '' : v).length + 2)); });
    });
    return out;
  }

  /**
   * ชีตของไฟล์ Excel ออเดอร์ที่ติ๊กในแท็บตัดผิด / ตัดเกิน
   *   o.rows   แถวจาก cut-check ทุกเรื่อง (RAW.rows) ชีตสรุปเอาทุกแถวของออเดอร์ที่เลือก รวมยังไม่ตัดด้วย
   *   o.names  ชื่อสินค้าราย SKU
   *   o.refs   เลขออเดอร์ที่ติ๊ก เรียงตามที่จะลงในไฟล์
   *   o.kinds  ชื่อเรื่องราย k
   *   o.back   คำที่ใช้แทนสถานะขนส่ง เมื่อของส่งออกไปแล้วลูกค้ายกเลิกทีหลัง
   *   o.rep    คำตอบ report-rows จาก cut-api.gs ไม่มีคือสคริปต์รุ่นเก่า ได้แค่ชีตสรุป
   * ได้ [{ name, aoa, widths }] ชีตแรกสรุปปัญหา ชีตถัดไปแถวใน Report ทุกคอลัมน์ทีละแท็บ
   * คอลัมน์แรกของชีต Report บอกเรื่องของ SKU นั้น ช่องว่างคือ SKU นั้นในออเดอร์ไม่มีปัญหา
   */
  function exportSheets(o) {
    var order = {};
    o.refs.forEach(function (ref, i) { order[refKey(ref)] = i; });
    var mine = o.rows.filter(function (r) { return r.ref && order[refKey(r.ref)] !== undefined; })
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return order[refKey(a.r.ref)] - order[refKey(b.r.ref)] || a.i - b.i; })
      .map(function (x) { return x.r; });
    var label = function (r) { return (o.kinds[r.k] || r.k) + (r.sku ? '' : ' (ทั้งออเดอร์ ' + fmt(r.lines || 0) + ' SKU)'); };

    var summary = [EXPORT_HEAD].concat(mine.map(function (r) {
      return [r.ref, r.sys || '', r.sup || '', label(r), r.sku || '', r.sku ? (o.names[r.sku] || '') : '', r.date || '',
        r.back && o.back ? o.back : (r.ship || ''), r.r, r.x, r.t, rowDiff(r),
        (r.xd || []).join(', '), (r.td || []).join(', '), r.note || ''];
    }));
    var out = [{ name: 'สรุปปัญหา', aoa: summary, widths: widthsOf(summary) }];

    var tabs = (o.rep && o.rep.tabs) || [];
    tabs.forEach(function (tab) {
      if (!tab.rows || !tab.rows.length) return;
      var skuAt = -1;
      tab.head.forEach(function (h, i) { if (skuAt < 0 && SKU_HEAD.test(String(h))) skuAt = i; });
      var why = function (row) {
        var ref = refKey(row[tab.ref]);
        var sku = skuAt < 0 ? '' : String(row[skuAt] == null ? '' : row[skuAt]).trim().toUpperCase();
        var seen = {};
        return mine.filter(function (r) { return refKey(r.ref) === ref && (!r.sku || r.sku === sku); })
          .map(function (r) { return o.kinds[r.k] || r.k; })
          .filter(function (w) { return seen[w] ? false : (seen[w] = true); }).join(', ');
      };
      var body = tab.rows.map(function (row, i) { return { row: row, i: i }; })
        .sort(function (a, b) {
          var x = order[refKey(a.row[tab.ref])], y = order[refKey(b.row[tab.ref])];
          return (x === undefined ? 1e9 : x) - (y === undefined ? 1e9 : y) || a.i - b.i;
        })
        .map(function (x) { return [why(x.row)].concat(x.row); });
      var aoa = [['ปัญหา'].concat(tab.head)].concat(body);
      out.push({ name: REPORT_SHEET[tab.sys] || String(tab.name).slice(0, 31), aoa: aoa, widths: widthsOf(aoa) });
    });
    return out;
  }

  window.WmsCut = {
    LABEL: LABEL, oddOne: oddOne, diffWords: diffWords, reportWords: reportWords, compareDaily: compareDaily,
    cellIndex: cellIndex, dateWords: dateWords, fixHint: fixHint, rowUrl: rowUrl, fixLists: fixLists,
    fixKey: fixKey, fixState: fixState, rowDiff: rowDiff, exportSheets: exportSheets,
  };
})();
