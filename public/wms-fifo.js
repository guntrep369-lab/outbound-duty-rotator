/**
 * @file wms-fifo.js — สต๊อกคงเหลือเรียงเก่าไปใหม่ และการเบิกที่ข้ามของเก่า สำหรับรายงานส่ง Supply chain
 *
 * อ่านทุกแถวของสมุด Transaction ที่ apps-script/tx-api.gs ส่งมาใน ?api=tx-fifo แล้วเดินตามลำดับแถว
 *   row = [เลขแถว, ลำดับ SKU, LOT, ลำดับ PO, ลำดับ Location เบิก, ลำดับ Location รับ, จำนวน, ประเภท, ลำดับวันที่, ธง]
 * กติกาทั้งหมดอยู่ที่ไฟล์นี้ สคริปต์แค่ส่งแถว ปรับกติกาแล้วไม่ต้องวางสคริปต์ใหม่
 *
 * ลำดับเก่าไปใหม่ (ผู้ใช้ยืนยัน 2026-11-04)
 *   1. LOT คือเดือนของสินค้า 1–12 = เดือนของปีนี้, 0.11 / 0.12 = พ.ย. / ธ.ค. ของปีก่อน, 0 หรือว่าง = ไม่รู้
 *      LOT เลขเต็มที่มากกว่าเดือนของรายงาน เป็นของปีก่อน (รายงาน ม.ค. เห็น LOT 12 คือ ธ.ค. ปีก่อน)
 *   2. LOT เดียวกัน เรียงตาม PO ตามวันที่รับเข้า คือวันที่ GR แถวแรกของ SKU + LOT + PO นั้น
 *      PO ที่อยู่ในแถวนับสต๊อกถือว่ารับก่อนทุก GR ในสมุด PO ที่รับวันเดียวกันถือว่าเก่าเท่ากัน
 *      PO 0 หรือ PO ที่ไม่มีวันรับ (มาจาก RETURN หรือแปลงสินค้าอย่างเดียว) เทียบในระดับ PO ไม่ได้
 *
 * การเบิกที่ตรวจ (ไม่นับ QA / IQA / RIB เพราะไม่ได้เดินตาม FIFO อยู่แล้ว ผู้ใช้ยืนยัน)
 *   หยิบขาย  แถวขาย ข้าม = ตอนนั้นมีของที่เก่ากว่าอยู่ในโลที่เปิดขาย
 *   เติมของ  แถวเบิกเข้าโลที่เปิดขาย ข้าม = ตอนนั้นมีของที่เก่ากว่าอยู่ในโลที่ไม่เปิด (แร็ค)
 *   ขายของใหม่ตอนที่ของเก่าอยู่แต่บนแร็ค ไม่นับเป็นหยิบข้าม คนหยิบไม่เห็นของเก่า พลาดตั้งแต่ตอนเติมของ
 *   แถวที่ LOT ไม่รู้ ตรวจไม่ได้ ของที่ LOT ไม่รู้ก็ไม่นับเป็นของที่เก่ากว่า
 *
 * Status ของจุดหนึ่งยึดแถวรับล่าสุด และยอดคิดแบบเดียวกับ balances_ ใน tx-api.gs
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsFifo
 */
(function () {
  'use strict';

  var SPECIAL = /^(QA|IQA|RIB)$/;
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var COUNT_DAY = '0000-00-00';   // วันรับของ PO ที่อยู่ในแถวนับสต๊อก ก่อนทุกวันที่จริง
  var OLDER_MAX = 5;              // ของที่เก่ากว่าที่แนบไปต่อหนึ่งรายการ

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  function noPo(v) { return /^0*$/.test(text(v)); }

  /** เดือนของ LOT เทียบกับเดือนของรายงาน (yyyy-mm) ไม่รู้ได้ null  key = ปี × 12 + เดือน ใช้เรียงและคิดอายุ */
  function lotMonth(lot, ref) {
    var s = text(lot);
    var n = s === '' ? NaN : Number(s);
    if (!(n > 0)) return null;
    var ry = +ref.slice(0, 4), rm = +ref.slice(5, 7);
    var y, m;
    if (n < 1) { m = Math.round(n * 100); y = ry - 1; }
    else if (n === Math.floor(n) && n <= 12) { m = n; y = n <= rm ? ry : ry - 1; }
    else return null;
    if (m < 1 || m > 12) return null;
    return { key: y * 12 + m - 1, y: y, m: m };
  }

  /** ป้ายเดือนแบบสั้น ปี พ.ศ. สองหลัก เช่น ก.ย. 69 */
  function monthText(lm) { return lm ? MONTHS[lm.m - 1] + ' ' + String(lm.y + 543).slice(-2) : 'ไม่รู้ LOT'; }

  function refKey(ref) { return +ref.slice(0, 4) * 12 + +ref.slice(5, 7) - 1; }

  function lastDay(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return ym + '-' + ('0' + new Date(Date.UTC(y, m, 0)).getUTCDate()).slice(-2);
  }

  /** แถวแบบย่อเป็นออบเจกต์ ชื่อ Location ยุบตัวพิมพ์เล็กใหญ่ไว้ที่สคริปต์แล้ว */
  function parse(res) {
    return res.rows.map(function (x) {
      return {
        row: x[0], sku: x[1], lot: up(x[2]), po: up(res.pos[x[3]]), from: x[4], to: x[5],
        qty: typeof x[6] === 'number' ? x[6] : 0, t: x[7], d: x[8] >= 0 ? res.days[x[8]] : '',
        open: !!(x[9] & 1), gr: !!(x[9] & 2), count: !!(x[9] & 4), own: !!(x[9] & 8),
      };
    });
  }

  function newState() { return { bal: {}, open: {}, recv: {}, keys: {} }; }

  /** ใส่แถวหนึ่งลงยอด กติกาเดียวกับ balances_: เข้าที่ Location รับทุกประเภท ออกที่ Location เบิกเฉพาะเบิกกับขาย */
  function apply(st, r) {
    var b = r.sku + '|' + r.lot + '|' + r.po;
    if (r.to >= 0) {
      var k = b + '|' + r.to;
      st.bal[k] = (st.bal[k] || 0) + r.qty;
      st.open[k] = r.open;
      (st.keys[r.sku] = st.keys[r.sku] || {})[k] = 1;
      var day = r.count ? COUNT_DAY : r.gr ? r.d : '';
      if (day && (!st.recv[b] || day < st.recv[b])) st.recv[b] = day;
    }
    if (r.from >= 0 && r.t) {
      var o = b + '|' + r.from;
      st.bal[o] = (st.bal[o] || 0) - r.qty;
      (st.keys[r.sku] = st.keys[r.sku] || {})[o] = 1;
    }
  }

  /**
   * ของ a เก่ากว่า b ไหม ตอบ 'lot' ถ้า LOT เก่ากว่า, 'po' ถ้า LOT เดียวกันแต่ PO รับก่อน, '' ถ้าไม่ใช่หรือบอกไม่ได้
   * a, b = { lm, po, recv }
   */
  function older(a, b) {
    if (!a.lm || !b.lm) return '';
    if (a.lm.key < b.lm.key) return 'lot';
    if (a.lm.key > b.lm.key) return '';
    if (a.po === b.po || noPo(a.po) || noPo(b.po) || !a.recv || !b.recv) return '';
    return a.recv < b.recv ? 'po' : '';
  }

  /**
   * เดินทุกแถวตามลำดับในชีต
   *   ym = เดือนของรายงาน (yyyy-mm) ตรวจการเบิกที่วันที่อยู่ในเดือนนี้ และคิดยอดคงเหลือ ณ วันสุดท้ายของเดือน
   *   ถ้าเป็นเดือนที่ยังไม่จบ ยอดคงเหลือคือยอดล่าสุดในสมุด
   * ยอด ณ สิ้นเดือนนับแถวที่วันที่ (ของแถวเองหรือแถวด้านบนที่ใกล้สุด) ไม่เกินวันนั้น
   */
  function analyze(res, ym) {
    var from = ym + '-01', to = lastDay(ym);
    var rows = parse(res);
    var walk = newState(), snap = newState();
    var issues = [];
    var meta = {};   // ลำดับ LOT ของ sku|lot|po คิดครั้งเดียว
    function info(st, b) {
      var m = meta[b];
      if (!m) {
        var p = b.split('|');
        m = meta[b] = { lot: p[1], po: p[2], lm: lotMonth(p[1], ym) };
      }
      return { lot: m.lot, po: m.po, lm: m.lm, recv: st.recv[b] || '' };
    }

    rows.forEach(function (r) {
      var judged = r.d >= from && r.d <= to && r.t && r.from >= 0 && !SPECIAL.test(up(res.locs[r.from]));
      var kind = !judged ? '' : r.t === 2 ? 'sale' : r.to >= 0 && r.open && !SPECIAL.test(up(res.locs[r.to])) ? 'refill' : '';
      if (kind) {
        var me = info(walk, r.sku + '|' + r.lot + '|' + r.po);
        var item = {
          row: r.row, date: r.d, own: r.own, sku: r.sku, kind: kind, lot: r.lot, po: r.po, lm: me.lm, recv: me.recv,
          qty: r.qty, from: r.from, to: r.to, state: me.lm ? 'ok' : 'unknown', older: [],
        };
        if (me.lm) {
          var ks = walk.keys[r.sku] || {};
          Object.keys(ks).forEach(function (k) {
            var q = walk.bal[k];
            if (!(q > 0)) return;
            var loc = +k.slice(k.lastIndexOf('|') + 1);
            if (SPECIAL.test(up(res.locs[loc]))) return;
            /* หยิบขายดูของในโลเปิด เติมของดูของบนแร็ค */
            if (!!walk.open[k] !== (kind === 'sale')) return;
            var o = info(walk, k.slice(0, k.lastIndexOf('|')));
            var by = older(o, me);
            if (by) item.older.push({ lot: o.lot, po: o.po, lm: o.lm, recv: o.recv, loc: loc, qty: q, by: by });
          });
          if (item.older.length) {
            item.state = item.older.some(function (o) { return o.by === 'lot'; }) ? 'lot' : 'po';
            item.olderQty = item.older.reduce(function (a, o) { return a + o.qty; }, 0);
            item.older.sort(function (a, b) { return a.lm.key - b.lm.key || (a.recv < b.recv ? -1 : a.recv > b.recv ? 1 : 0) || b.qty - a.qty; });
            item.older = item.older.slice(0, OLDER_MAX);
          }
        }
        issues.push(item);
      }
      apply(walk, r);
      if (!r.d || r.d <= to) apply(snap, r);
    });

    return { ym: ym, from: from, to: to, issues: issues, stock: stock(res, snap, ym, info), totals: totals(issues) };
  }

  /**
   * ยอดคงเหลือราย SKU แต่ละกอง (LOT + PO) เรียงเก่าไปใหม่ LOT ที่ไม่รู้อยู่ท้าย
   * ยอดติดลบไม่นับเป็นของ แต่บอกจำนวนไว้ เป็นจุดที่สมุดลงผิด
   */
  function stock(res, st, ym, info) {
    var ref = refKey(ym);
    var by = {}, neg = { keys: 0, qty: 0 };
    Object.keys(st.bal).forEach(function (k) {
      var q = st.bal[k];
      if (q < 0) { neg.keys++; neg.qty += q; }
      if (!(q > 0)) return;
      var cut = k.lastIndexOf('|');
      var b = k.slice(0, cut), loc = +k.slice(cut + 1);
      var s = +b.slice(0, b.indexOf('|'));
      var e = by[s] || (by[s] = { sku: s, batches: {} });
      var x = e.batches[b];
      if (!x) {
        var i = info(st, b);
        x = e.batches[b] = { lot: i.lot, po: i.po, lm: i.lm, recv: i.recv, qty: 0, open: 0, rack: 0, special: 0, locs: [] };
      }
      var sp = SPECIAL.test(up(res.locs[loc]));
      var isOpen = !!st.open[k];
      x.qty += q;
      if (sp) x.special += q; else if (isOpen) x.open += q; else x.rack += q;
      x.locs.push({ loc: loc, qty: q, open: isOpen, special: sp });
    });

    var list = Object.keys(by).map(function (s) {
      var e = by[s];
      var bs = Object.keys(e.batches).map(function (b) { return e.batches[b]; });
      bs.forEach(function (x) { x.locs.sort(function (a, b) { return b.qty - a.qty; }); });
      bs.sort(function (a, b) {
        if (!a.lm || !b.lm) return a.lm ? -1 : b.lm ? 1 : b.qty - a.qty;
        return a.lm.key - b.lm.key || (a.recv || '9').localeCompare(b.recv || '9') || a.po.localeCompare(b.po);
      });
      var known = bs.filter(function (x) { return x.lm; });
      var total = 0, unknown = 0;
      bs.forEach(function (x, i) {
        total += x.qty;
        if (!x.lm) unknown += x.qty;
        x.age = x.lm ? ref - x.lm.key : null;
        x.rank = x.lm ? i + 1 : 0;
      });
      /*
       * ควรเติมของเก่า: กองที่อยู่แต่บนแร็ค ขณะที่ทุกกองในโลขายใหม่กว่ากองนั้น
       * ถ้าในโลขายมีกองที่เก่าเท่ากันอยู่แล้ว (เช่น PO อื่นของ LOT เดียวกันจากนับสต๊อก) คนหยิบยังหยิบของเก่าได้ ไม่ต้องเติม
       */
      var openKnown = known.filter(function (x) { return x.open > 0; });
      var refill = [];
      known.forEach(function (o) {
        if (!(o.rack > 0) || o.open > 0 || !openKnown.length) return;
        if (openKnown.every(function (n) { return older(o, n); })) refill.push({ batch: o, newer: openKnown });
      });
      /* หลายกองอยู่ในโลขายพร้อมกัน คนหยิบต้องเลือกกองเก่าก่อน pick คือกองที่ควรหยิบก่อน */
      var mixed = openKnown.length > 1 && openKnown.some(function (a) { return openKnown.some(function (b) { return older(a, b); }); });
      var pick = mixed ? openKnown[0] : null;
      var lots = {};
      known.forEach(function (x) { lots[x.lot] = 1; });
      var sk = res.skus[s];
      return {
        sku: +s, code: sk[1], short: sk[0], name: sk[2], total: total, unknown: unknown, batches: bs,
        lots: Object.keys(lots).length, oldest: known.length ? known[0].age : null, refill: refill, mixed: mixed, pick: pick,
      };
    });
    list.sort(function (a, b) { return a.code.localeCompare(b.code); });

    /* อายุสต๊อก รวมทั้งคลังตามเดือนของ LOT */
    var ages = {}, unknownQty = 0, specialQty = 0, total = 0;
    list.forEach(function (e) {
      e.batches.forEach(function (x) {
        total += x.qty;
        specialQty += x.special;
        if (!x.lm) { unknownQty += x.qty; return; }
        var a = ages[x.lm.key] || (ages[x.lm.key] = { lm: x.lm, age: x.age, qty: 0, skus: {}, lots: {} });
        a.qty += x.qty;
        a.skus[e.sku] = 1;
        a.lots[x.lot] = 1;
      });
    });
    var aging = Object.keys(ages).map(function (k) {
      var a = ages[k];
      return { lm: a.lm, age: a.age, qty: a.qty, skus: Object.keys(a.skus).length, lots: Object.keys(a.lots) };
    }).sort(function (a, b) { return a.lm.key - b.lm.key; });

    return { list: list, aging: aging, total: total, unknown: unknownQty, special: specialQty, negative: neg };
  }

  /** ยอดรวมของการเบิกในเดือน แยกหยิบขายกับเติมของ นับทั้งชิ้นและแถว */
  function totals(issues) {
    function blank() { return { rows: 0, qty: 0, judged: 0, judgedRows: 0, ok: 0, lot: 0, po: 0, skipRows: 0, unknown: 0, unknownRows: 0 }; }
    var out = { sale: blank(), refill: blank(), skus: {} };
    issues.forEach(function (it) {
      var g = out[it.kind];
      g.rows++;
      g.qty += it.qty;
      if (it.state === 'unknown') { g.unknown += it.qty; g.unknownRows++; return; }
      g.judged += it.qty;
      g.judgedRows++;
      g[it.state] += it.qty;
      if (it.state === 'ok') return;
      g.skipRows++;
      var s = out.skus[it.sku] || (out.skus[it.sku] = { sale: 0, saleRows: 0, refill: 0, refillRows: 0 });
      s[it.kind] += it.qty;
      s[it.kind + 'Rows']++;
    });
    ['sale', 'refill'].forEach(function (k) {
      var g = out[k];
      g.skip = g.lot + g.po;
      g.pct = g.judged ? Math.round(g.ok / g.judged * 1000) / 10 : null;
    });
    return out;
  }

  /** ตัวกรองแท็บคงเหลือ only = '' | refill | multi | unknown | mixed */
  function filterStock(list, o) {
    var q = up(o.q || '');
    return list.filter(function (e) {
      if (o.only === 'refill' && !e.refill.length) return false;
      if (o.only === 'multi' && e.lots < 2) return false;
      if (o.only === 'unknown' && !e.unknown) return false;
      if (o.only === 'mixed' && !e.mixed) return false;
      if (!q) return true;
      return up(e.code).indexOf(q) >= 0 || up(e.short).indexOf(q) >= 0 || up(e.name).indexOf(q) >= 0 ||
        e.batches.some(function (x) { return up(x.po).indexOf(q) >= 0; });
    });
  }

  /** รายการเบิกที่ข้ามของเก่า ราย SKU เรียงตามชิ้นที่ข้ามมากไปน้อย kind = '' | sale | refill */
  function skipsBySku(res, an, o) {
    o = o || {};
    var q = up(o.q || '');
    var by = {};
    an.issues.forEach(function (it) {
      if (it.state !== 'lot' && it.state !== 'po') return;
      if (o.kind && it.kind !== o.kind) return;
      var e = by[it.sku] || (by[it.sku] = { sku: it.sku, items: [], sale: 0, refill: 0, rows: 0, qty: 0 });
      e.items.push(it);
      e[it.kind] += it.qty;
      e.rows++;
      e.qty += it.qty;
    });
    var judged = {};
    an.issues.forEach(function (it) {
      if (it.state === 'unknown' || (o.kind && it.kind !== o.kind)) return;
      var j = judged[it.sku] || (judged[it.sku] = { qty: 0, ok: 0 });
      j.qty += it.qty;
      if (it.state === 'ok') j.ok += it.qty;
    });
    return Object.keys(by).map(function (s) {
      var e = by[s], sk = res.skus[s];
      e.code = sk[1];
      e.short = sk[0];
      e.name = sk[2];
      e.judged = judged[s].qty;
      e.pct = Math.round(judged[s].ok / judged[s].qty * 1000) / 10;
      e.items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.row - a.row; });
      return e;
    }).filter(function (e) {
      return !q || up(e.code).indexOf(q) >= 0 || up(e.short).indexOf(q) >= 0 || up(e.name).indexOf(q) >= 0;
    }).sort(function (a, b) { return b.qty - a.qty || a.code.localeCompare(b.code); });
  }

  /* ── ส่งออก ─────────────────────────────────────────────────────────────── */

  var KIND = { sale: 'หยิบขาย', refill: 'เติมของ' };
  var STATE = { ok: 'ตาม FIFO', lot: 'ข้าม LOT', po: 'ข้าม PO', unknown: 'ตรวจไม่ได้ (ไม่รู้ LOT)' };

  function recvText(v) { return v === COUNT_DAY ? 'ก่อนนับสต๊อก' : v || ''; }
  function dmy(d) { var p = String(d || '').split('-'); return p.length === 3 ? +p[2] + '/' + +p[1] + '/' + p[0] : ''; }

  /** ตารางคงเหลือราย LOT หนึ่งแถวต่อ SKU + LOT + PO */
  function stockTable(res, an, list) {
    var head = ['SKU', 'SKU สั้น', 'ชื่อสินค้า', 'ลำดับ FIFO', 'LOT', 'เดือนของ LOT', 'อายุ (เดือน)', 'PO', 'รับเข้า',
      'คงเหลือ', 'ในโลขาย', 'บนแร็ค', 'QA / IQA / RIB', 'Location', 'หมายเหตุ'];
    var out = [head];
    (list || an.stock.list).forEach(function (e) {
      e.batches.forEach(function (x) {
        var notes = [];
        if (!x.lm) notes.push('ไม่รู้ LOT');
        if (x.lm && noPo(x.po)) notes.push('ไม่รู้ PO');
        if (e.refill.some(function (f) { return f.batch === x; })) notes.push('ควรเติมกองนี้ก่อน กองใหม่กว่าอยู่ในโลขายแล้ว');
        out.push([e.code, e.short, e.name, x.rank || '', x.lot, x.lm ? monthText(x.lm) : '', x.age === null ? '' : x.age,
          x.po, recvText(x.recv), x.qty, x.open, x.rack, x.special,
          x.locs.map(function (l) { return res.locs[l.loc] + ' (' + l.qty + ')'; }).join(', '), notes.join(' · ')]);
      });
    });
    return out;
  }

  /** ตารางการเบิกที่ข้ามของเก่า หนึ่งแถวต่อแถวในสมุด */
  function skipTable(res, an, kind) {
    var head = ['วันที่', 'ประเภท', 'SKU', 'ชื่อสินค้า', 'LOT ที่ออก', 'PO ที่ออก', 'รับเข้า', 'จำนวน', 'จาก Location', 'ไป Location',
      'ผล', 'ของที่เก่ากว่าตอนนั้น', 'ชิ้นที่เก่ากว่า', 'แถวในชีต'];
    var out = [head];
    an.issues.forEach(function (it) {
      if (it.state !== 'lot' && it.state !== 'po') return;
      if (kind && it.kind !== kind) return;
      var sk = res.skus[it.sku];
      out.push([dmy(it.date), KIND[it.kind], sk[1], sk[2], it.lot, it.po, recvText(it.recv), it.qty,
        res.locs[it.from] || '', it.to >= 0 ? res.locs[it.to] : '', STATE[it.state],
        it.older.map(function (o) { return 'LOT ' + o.lot + ' PO ' + o.po + ' @' + res.locs[o.loc] + ' ' + o.qty; }).join(', '),
        it.olderQty, it.row]);
    });
    return out;
  }

  function agingTable(an) {
    var s = an.stock;
    var out = [['LOT', 'เดือน', 'อายุ (เดือน)', 'ชิ้น', '% ของคลัง', 'SKU']];
    s.aging.forEach(function (a) {
      out.push([a.lots.join(', '), monthText(a.lm), a.age, a.qty, s.total ? Math.round(a.qty / s.total * 1000) / 10 : 0, a.skus]);
    });
    if (s.unknown) out.push(['0', 'ไม่รู้ LOT', '', s.unknown, s.total ? Math.round(s.unknown / s.total * 1000) / 10 : 0, '']);
    return out;
  }

  function summaryTable(an, title) {
    var t = an.totals, s = an.stock;
    var pct = function (g) { return g.pct === null ? '' : g.pct; };
    return [
      [title || 'รายงาน FIFO'],
      ['เดือน', an.ym],
      ['ยอดคงเหลือ ณ วันที่', dmy(an.to)],
      [],
      ['เรื่อง', 'หยิบขาย', 'เติมของ'],
      ['ชิ้นที่ตรวจได้', t.sale.judged, t.refill.judged],
      ['ตาม FIFO (ชิ้น)', t.sale.ok, t.refill.ok],
      ['ตาม FIFO (%)', pct(t.sale), pct(t.refill)],
      ['ข้าม LOT (ชิ้น)', t.sale.lot, t.refill.lot],
      ['ข้าม PO ใน LOT เดียวกัน (ชิ้น)', t.sale.po, t.refill.po],
      ['แถวที่ข้าม', t.sale.skipRows, t.refill.skipRows],
      ['ตรวจไม่ได้ ไม่รู้ LOT (ชิ้น)', t.sale.unknown, t.refill.unknown],
      [],
      ['สต๊อกคงเหลือ (ชิ้น)', s.total],
      ['SKU ที่มีของ', s.list.length],
      ['ไม่รู้ LOT (ชิ้น)', s.unknown],
      ['อยู่ใน QA / IQA / RIB (ชิ้น)', s.special],
      [],
      ['หยิบขาย = แถวขายที่ตอนนั้นมี LOT หรือ PO ที่เก่ากว่าอยู่ในโลที่เปิดขาย'],
      ['เติมของ = แถวเบิกเข้าโลที่เปิดขาย ที่ตอนนั้นมีของเก่ากว่าอยู่บนแร็ค'],
      ['ลำดับเก่าไปใหม่ = เดือนของ LOT แล้ววันที่รับเข้าของ PO ไม่นับ QA / IQA / RIB'],
    ];
  }

  function cell(v) { return v === null || v === undefined ? '' : String(v).replace(/[\t\r\n]+/g, ' '); }
  function tsv(table) { return table.map(function (l) { return l.map(cell).join('\t'); }).join('\n'); }

  window.WmsFifo = {
    lotMonth: lotMonth, monthText: monthText, lastDay: lastDay, analyze: analyze, older: older, noPo: noPo,
    filterStock: filterStock, skipsBySku: skipsBySku, recvText: recvText,
    stockTable: stockTable, skipTable: skipTable, agingTable: agingTable, summaryTable: summaryTable, tsv: tsv,
    KIND: KIND, STATE: STATE, COUNT_DAY: COUNT_DAY,
  };
})();
