/**
 * @file wms-fire-tx.js — คำตอบแบบ tx-api.gs (tx-summary tx-daily tx-history) คิดจากสำเนาในเครื่องของระบบใหม่
 *
 * หน้ารายงานเดิมอ่านสมุด Transaction ผ่าน tx-api.gs พอขึ้นระบบใหม่ สมุดคือเอกสารในฐาน (WmsFire)
 * ไฟล์นี้แปลงเอกสารเป็นแถวแบบชีตแล้วคิดด้วยกติกาเดียวกับสคริปต์ทุกบรรทัด หน้ารายงานได้คำตอบรูปเดิม ไม่ต้องแก้หน้า
 * tx-fifo มีใน WmsFireCore.fifo อยู่แล้ว
 *
 *   rows(local)                     แถวแบบ readRows_ (row sku long name lot po from to qty badQty type note date near open who)
 *                                   who = คนบันทึกเอกสาร (ชีตเดิมคือช่อง L NAME) + doc = เลขที่เอกสาร
 *   summary(local, now)             แบบ summary_ ยอดคงเหลือ ยอดขาย จุดที่ข้อมูลผิด
 *   daily(local, now, from, to)     แบบ daily_ แถวขายรายวันในช่วง
 *   history(local, sku)             แบบ history_ ความเคลื่อนไหวของ SKU เดียว
 *
 * ต่างจากสคริปต์: sheet = null (ไม่มีชีต) · backup = null (สำรองด้วย fire-backup.gs) · fire = 1
 * โหลดเป็น classic script หลัง wms-fire-core.js เปิดเป็น window.WmsFireTx
 */
(function () {
  'use strict';

  var SALE_DAYS = 14;    // ตรงกับ tx-api.gs
  var LATE_DAYS = 14;
  var RARE_ROWS = 10;
  var RACK = /^[A-Z]+\d{0,2}-\d{2}-\d{2}(-\d{2})?$/;
  var ISSUE_ROWS = 6;
  var ISSUE_MAX = 200;
  var HISTORY_MAX = 500;

  function C() { return window.WmsFireCore; }
  function same(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }
  function dayNo(d) { return C().dayNo(d); }

  /** เอกสารที่ยังนับ (หลังยอดยกมาล่าสุด) เรียงตามลำดับบันทึก → แถวแบบชีต (เลขแถวเดียวกับ tx-fifo) */
  function rows(local) {
    var K = C(), near = '', out = [];
    K.liveDocs(local).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      d.rows.forEach(function (c, i) {
        var own = K.ownDate(c[8]);
        if (own) near = own;
        var lot = K.sheetNum(c[2]);
        out.push({
          row: d.row + i, doc: d.no,
          sku: K.text(c[0]), long: K.text(c[1]), name: (d.names && (d.names[c[1]] || d.names[c[0]])) || '',
          lot: lot === '' ? '' : lot,
          po: K.text(K.sheetNum(c[3])),
          from: K.text(c[4]), to: K.text(c[5]),
          qty: typeof c[6] === 'number' ? c[6] : 0,
          badQty: typeof c[6] === 'number' ? null : String(c[6]),
          type: K.text(c[7]),
          note: K.plainDate(c[8]) ? '' : K.text(c[8]),
          date: own, near: near,
          open: K.text(c[9]) === 'เปิด',
          who: d.name || '',   // คนบันทึกเอกสาร (ช่อง NAME ของชีต) · c[10] คือเลขที่อ้างอิง ไม่ใช่ชื่อ
        });
      });
    });
    return out;
  }

  /* ── คิดยอด (balances_ sales_) ── */

  function keyOf(long, lot, po, loc) { return [same(long), same(lot), same(po), same(loc)].join('|'); }

  function balances(R) {
    var keys = {};
    function at(r, loc) {
      var k = keyOf(r.long, r.lot, r.po, loc);
      return keys[k] || (keys[k] = { long: r.long, sku: r.sku, lot: r.lot, po: r.po, loc: loc, inBlank: 0, inOpen: 0, out: 0, inRows: [], outRows: [], open: false });
    }
    R.forEach(function (r) {
      if (!r.long) return;
      if (r.to) {
        var a = at(r, r.to);
        if (r.open) a.inOpen += r.qty; else a.inBlank += r.qty;
        a.open = r.open;
        a.inRows.push(r.row);
      }
      if (r.from && (r.type === 'เบิก' || r.type === 'ขาย')) {
        var b = at(r, r.from);
        b.out += r.qty;
        b.outRows.push(r.row);
      }
    });
    return Object.keys(keys).map(function (k) { var x = keys[k]; x.bal = x.inBlank + x.inOpen - x.out; return x; });
  }

  function sales(R, today) {
    var first = '', last = '';
    R.forEach(function (r) {
      if (r.type !== 'ขาย' || !r.date || r.date > today) return;
      if (!first || r.date < first) first = r.date;
      if (r.date > last) last = r.date;
    });
    var out = { first: first, last: last, days: 0, bySku: {} };
    if (!last) return out;
    var end = dayNo(last);
    out.days = Math.min(SALE_DAYS, end - dayNo(first) + 1);
    R.forEach(function (r) {
      if (r.type !== 'ขาย' || !r.date || !r.long || r.date > today) return;
      if (end - dayNo(r.date) >= out.days) return;
      var k = same(r.long);
      out.bySku[k] = (out.bySku[k] || 0) + r.qty;
    });
    return out;
  }

  /* ── จุดที่ข้อมูลผิด (issues_) ── */

  function merge(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
  function someRows(list) { return { rows: list.slice(0, ISSUE_ROWS), rowCount: list.length }; }
  function special(loc) { return /^(QA|IQA|RIB)$/.test(same(loc)); }

  function closedSales(R) {
    var closed = {}, lastIn = {};
    R.forEach(function (r) {
      if (r.long && r.to) lastIn[keyOf(r.long, r.lot, r.po, r.to)] = r.open;
      if (r.type === 'ขาย' && r.from && r.long) {
        var k = keyOf(r.long, r.lot, r.po, r.from);
        if (k in lastIn && (!lastIn[k] || special(r.from))) {
          var c = closed[k] || (closed[k] = { sku: r.sku, long: r.long, lot: r.lot, po: r.po, loc: r.from, sold: 0, list: [] });
          c.sold += r.qty;
          c.list.push(r.row);
        }
      }
    });
    return closed;
  }

  function dip(x, byRow) {
    var ev = x.inRows.map(function (n) { return [n, 1]; }).concat(x.outRows.map(function (n) { return [n, -1]; }));
    ev.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var run = 0, at = 0, before = 0;
    ev.forEach(function (e, i) {
      var prev = run;
      run += e[1] * byRow[e[0]].qty;
      if (run < -1e-9 && prev >= -1e-9) { at = i; before = prev; }
    });
    var seen = {}, list = [];
    ev.slice(at).forEach(function (e) { if (!seen[e[0]]) { seen[e[0]] = 1; list.push(e[0]); } });
    return { at: list[0], before: before, rows: list };
  }

  function oddStatus(x, byRow) {
    var open = [], blank = [];
    x.inRows.forEach(function (n) { (byRow[n].open ? open : blank).push(n); });
    var oddOpen = open.length === blank.length ? !x.open : open.length < blank.length;
    return { oddOpen: oddOpen, openN: open.length, blankN: blank.length, rows: oddOpen ? open : blank };
  }

  function locationIssues(locs, add) {
    var groups = {};
    Object.keys(locs).forEach(function (name) {
      var g = name.toUpperCase().replace(/[\s-]/g, '');
      (groups[g] = groups[g] || []).push(name);
    });
    var flagged = {};
    Object.keys(groups).forEach(function (g) {
      var names = groups[g];
      if (names.length < 2) return;
      names.sort(function (a, b) { return locs[b].length - locs[a].length; });
      names.slice(1).forEach(function (name) {
        flagged[name] = 1;
        add('locname', merge({ name: name, like: names[0] }, someRows(locs[name])));
      });
    });
    Object.keys(locs).forEach(function (name) {
      if (flagged[name] || RACK.test(name) || locs[name].length > RARE_ROWS) return;
      if (/^(QA|IQA|RIB)$/i.test(name)) return;
      add('locname', merge({ name: name, like: '' }, someRows(locs[name])));
    });
  }

  function dateIssues(R, add, today) {
    var latest = '', odd = {};
    R.forEach(function (r) {
      if (!r.date) return;
      if (r.type === 'ขาย' && r.date <= today && r.date > latest) latest = r.date;
      var far = r.type !== 'ขาย' && latest && Math.abs(dayNo(latest) - dayNo(r.date)) > LATE_DAYS;
      if (r.date > today || far) {
        var g = r.note || r.date;
        (odd[g] = odd[g] || { note: g, near: latest, list: [] }).list.push(r.row);
      }
    });
    Object.keys(odd).forEach(function (k) {
      var g = odd[k];
      add('date', merge({ note: g.note, near: g.near, first: g.list[0], last: g.list[g.list.length - 1] }, someRows(g.list)));
    });
  }

  function issues(R, bals, today) {
    var out = [], byRow = {};
    R.forEach(function (r) { byRow[r.row] = r; });
    function add(kind, o) { o.kind = kind; out.push(o); }
    function head(x) { return { sku: x.sku, long: x.long, lot: x.lot, po: x.po, loc: x.loc }; }
    function detail(list) {
      var o = someRows(list);
      o.info = o.rows.map(function (n) {
        var r = byRow[n];
        return [r.type, r.qty, r.date || r.near, r.date ? 0 : 1, r.who, r.from, r.to];
      });
      return o;
    }
    bals.forEach(function (x) {
      if (x.inBlank && x.inOpen) {
        var odd = oddStatus(x, byRow);
        add('mixed', merge(merge(head(x), {
          blank: x.inBlank, open: x.inOpen, out: x.out, bal: x.bal, oddOpen: odd.oddOpen, openN: odd.openN, blankN: odd.blankN,
        }), detail(odd.rows)));
      } else if (!x.inRows.length) {
        if (x.out) add('outonly', merge(merge(head(x), { bal: x.bal, at: x.outRows[0], before: 0 }), detail(x.outRows)));
      } else if (x.bal < 0) {
        var d = dip(x, byRow);
        add('negative', merge(merge(head(x), { bal: x.bal, at: d.at, before: d.before, inQty: x.inBlank + x.inOpen, out: x.out }), detail(d.rows)));
      }
    });
    var closed = closedSales(R), locs = {}, unread = {};
    R.forEach(function (r) {
      [r.from, r.to].forEach(function (l) { if (l) (locs[l] = locs[l] || []).push(r.row); });
      if (r.badQty) add('qty', { sku: r.sku, lot: r.lot, loc: r.to || r.from, value: r.badQty, rows: [r.row], rowCount: 1 });
      var miss = [];
      if (!r.long) miss.push('SKU คอลัมน์ B');
      if (r.badQty === '') miss.push('QTY');
      if (r.type !== 'รับ' && r.type !== 'เบิก' && r.type !== 'ขาย') miss.push('ประเภท');
      if (r.type === 'รับ' && !r.to) miss.push('Location รับ');
      if ((r.type === 'เบิก' || r.type === 'ขาย') && !r.from) miss.push('Location เบิก');
      if (r.type === 'ขาย' && !r.date && !r.note) miss.push('วันที่ขาย');
      if (r.type === 'ขาย' && !r.date && r.note) {
        var shape = r.note.replace(/\d/g, '9');
        (unread[shape] = unread[shape] || { note: r.note, list: [] }).list.push(r.row);
      }
      if (r.type !== 'ขาย' && !r.date && !r.note) miss.push('Note');
      if (!r.who) miss.push('ชื่อคนกรอก');
      if (miss.length) add('incomplete', { sku: r.sku, what: miss.join(', '), rows: [r.row], rowCount: 1 });
    });
    Object.keys(closed).forEach(function (k) {
      var c = closed[k];
      add('closedsale', merge({ sku: c.sku, long: c.long, lot: c.lot, po: c.po, loc: c.loc, sold: c.sold }, detail(c.list)));
    });
    Object.keys(unread).forEach(function (k) { add('baddate', merge({ note: unread[k].note }, someRows(unread[k].list))); });
    locationIssues(locs, add);
    dateIssues(R, add, today);
    function weight(o) { return o.kind === 'mixed' ? o.out : Math.abs(o.bal || 0); }
    var counts = {};
    out.sort(function (a, b) { return weight(b) - weight(a); });
    return {
      counts: counts,
      list: out.filter(function (o) { counts[o.kind] = (counts[o.kind] || 0) + 1; return counts[o.kind] <= ISSUE_MAX; }),
    };
  }

  /* ── MASTER จากฐาน (รูปเดียวกับ convert_ sup_) ── */

  function supOf(local) {
    var m = (local.master || {}).sup;
    if (!m) return null;
    return { tab: m.tab || 'PO. Truck', rows: C().dec(m.rows || '').map(function (r) { return [same(r[0]), C().text(r[1])]; }), dup: m.dup || [], missing: '' };
  }

  function convertOf(local, R) {
    var m = (local.master || {}).conv;
    if (!m) return null;
    var names = {}, seen = {};
    R.forEach(function (r) { if (r.long && r.name && !names[same(r.long)]) names[same(r.long)] = r.name; });
    var out = { tab: m.tab || 'MASTER แปลงสินค้า', cols: m.cols || ['', ''], pairs: [], blank: +m.blank || 0 };
    C().dec(m.rows || '').forEach(function (r) {
      var a = same(r[0]), b = same(r[1]);
      if (!a || !b || a === b || seen[a + '|' + b]) return;
      seen[a + '|' + b] = 1;
      out.pairs.push([a, b, names[b] || '']);
    });
    return out;
  }

  /* ── คำตอบ ── */

  /** แบบ summary_ : keys = [ลำดับ SKU, LOT, PO, ลำดับโล, ยอด, เปิด 1/0] เฉพาะกองที่ยอดไม่เป็นศูนย์ */
  function summary(local, now) {
    var today = C().today(now), R = rows(local), bals = balances(R), sold = sales(R, today);
    var known = {}, skuIdx = {}, skus = [], locIdx = {}, locs = [];
    R.forEach(function (r) {
      if (!r.long) return;
      var k = same(r.long);
      var s = known[k] || (known[k] = [r.sku, r.long, '']);
      if (!s[2] && r.name) s[2] = r.name;
    });
    function skuNo(k) {
      if (skuIdx[k] === undefined) { skuIdx[k] = skus.length; skus.push(known[k]); }
      return skuIdx[k];
    }
    function locNo(l) {
      var k = same(l);
      if (locIdx[k] === undefined) { locIdx[k] = locs.length; locs.push(l); }
      return locIdx[k];
    }
    var keys = [];
    bals.forEach(function (x) {
      if (x.bal === 0) return;
      keys.push([skuNo(same(x.long)), x.lot, x.po, locNo(x.loc), x.bal, x.open ? 1 : 0]);
    });
    return {
      app: 'transaction', fire: 1, at: now,
      rows: R.length,
      lastRow: R.length ? R[R.length - 1].row : 0,
      lastDate: sold.last,
      saleDays: sold.days,
      sold: Object.keys(sold.bySku).map(function (k) { return [skuNo(k), sold.bySku[k]]; }),
      sheet: null,
      backup: null,
      skus: skus,
      locs: locs,
      keys: keys,
      issues: issues(R, bals, today),
      sup: supOf(local),
    };
  }

  /** แบบ daily_ : lines = [ลำดับวัน, ลำดับ SKU, เลขแถว, ลำดับโล, LOT, PO, จำนวน, ลำดับคนลง] */
  function daily(local, now, from, to) {
    var today = C().today(now), R = rows(local);
    var out = {
      app: 'transaction', fire: 1, at: now, from: from || '', to: to || '', last: '',
      noDate: { rows: 0, qty: 0 }, noSku: { rows: 0, qty: 0 }, future: { rows: 0, qty: 0 }, badQty: { rows: 0 },
      sheet: null,
      skus: [], days: [], cells: [], locs: [], whos: [], lines: [],
    };
    function skip(part, r) { part.rows++; part.qty += r.qty; }
    function no(idx, list, v) {
      if (idx[v] === undefined) { idx[v] = list.length; list.push(v); }
      return idx[v];
    }
    var tally = {}, skuIdx = {}, locIdx = {}, whoIdx = {};
    R.forEach(function (r) {
      if (r.type !== 'ขาย') return;
      if (!r.date) return skip(out.noDate, r);
      if (r.date > today) return skip(out.future, r);
      if (r.date > out.last) out.last = r.date;
      if ((from && r.date < from) || (to && r.date > to)) return;
      if (!r.long) return skip(out.noSku, r);
      if (r.badQty !== null) out.badQty.rows++;
      var k = same(r.long);
      if (skuIdx[k] === undefined) { skuIdx[k] = out.skus.length; out.skus.push([k, r.name]); }
      var day = tally[r.date] || (tally[r.date] = {});
      day[k] = (day[k] || 0) + r.qty;
      out.lines.push([r.date, skuIdx[k], r.row, no(locIdx, out.locs, r.from), r.lot, r.po,
        r.badQty !== null ? r.badQty : r.qty, no(whoIdx, out.whos, r.who)]);
    });
    out.days = Object.keys(tally).sort();
    var dayIdx = {};
    out.days.forEach(function (d, i) {
      dayIdx[d] = i;
      Object.keys(tally[d]).forEach(function (k) { if (tally[d][k]) out.cells.push([i, skuIdx[k], tally[d][k]]); });
    });
    out.lines.forEach(function (l) { l[0] = dayIdx[l[0]]; });
    out.convert = convertOf(local, R);
    out.sup = supOf(local);
    return out;
  }

  /** แบบ history_ : items ใหม่สุดก่อน ไม่เกิน HISTORY_MAX แถว · doc = เลขที่เอกสาร */
  function history(local, sku) {
    if (!sku) return { error: 'ไม่ได้ระบุ SKU' };
    var want = same(sku);
    var mine = rows(local).filter(function (r) { return r.long && (same(r.sku) === want || same(r.long) === want); });
    var total = 0;
    var list = mine.map(function (r) {
      var inQ = r.to ? r.qty : 0;
      var outQ = r.from && (r.type === 'เบิก' || r.type === 'ขาย') ? r.qty : 0;
      total += inQ - outQ;
      return {
        row: r.row, doc: r.doc, date: r.date || r.near, approx: !r.date, type: r.type, note: r.note,
        from: r.from, to: r.to, lot: r.lot, po: r.po, qty: r.qty, change: inQ - outQ, left: total, who: r.who,
      };
    });
    return {
      app: 'transaction', fire: 1,
      sku: mine.length ? mine[0].sku : sku,
      name: mine.length ? (mine.filter(function (r) { return r.name; })[0] || {}).name || '' : '',
      count: list.length,
      left: total,
      items: list.slice(-HISTORY_MAX).reverse(),
      sheet: null,
    };
  }

  window.WmsFireTx = {
    SALE_DAYS: SALE_DAYS, ISSUE_MAX: ISSUE_MAX, HISTORY_MAX: HISTORY_MAX,
    rows: rows, balances: balances, sales: sales, issues: issues,
    summary: summary, daily: daily, history: history, supOf: supOf, convertOf: convertOf,
  };
})();
