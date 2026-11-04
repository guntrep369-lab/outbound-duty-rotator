/**
 * @file wms-lotpo.js — SKU ที่ขายออกแต่ละวันมาจาก LOT และ PO ไหน สำหรับทำรายงานส่งบัญชี
 *
 * อ่านแถว "ขาย" ทีละแถวที่ apps-script/tx-api.gs ส่งมาใน ?api=tx-daily (ช่อง lines)
 * ตัวเดียวกับที่หน้าเช็ครายการตัดสต๊อกใช้เทียบรายวัน สคริปต์จึงไม่ต้องแก้อะไร
 *   line = [ลำดับวัน, ลำดับ SKU, เลขแถว, ลำดับ Location, LOT, PO, จำนวน (ข้อความถ้าพิมพ์ไม่ใช่ตัวเลข), ลำดับคนลง]
 *
 * รวมแถวที่ วัน + SKU + LOT + PO เดียวกันเป็นบรรทัดเดียว Location ไม่อยู่ในคีย์
 * บัญชีอยากรู้ว่าของล็อตไหนออก ไม่ได้สนว่าหยิบจากชั้นไหน
 *
 * PO ที่ลง -01 -02 ต่อท้าย (เลขวันที่ที่รับเข้าคลัง) คือ PO เดียวกันที่ทยอยรับ (ผู้ใช้ยืนยัน 2026-11-04)
 * ตัดส่วนท้ายออกก่อนรวม บัญชีเห็นเลข PO จริง ส่วนท้ายที่รวมไว้อยู่ใน parts กติกาเดียวกับ basePo ใน wms-fifo.js
 *
 * จำนวนที่พิมพ์เป็นข้อความไม่ถูกบวก ให้ตรงกับ SUMIFS ในชีตยอดและยอดในแท็บเทียบรายวัน
 * แต่ติดป้ายไว้ให้เห็นว่ามีแถวที่ยอดหายไป
 *
 * รายออเดอร์ (allocate): สมุดลงขายรวมต่อ SKU ต่อวัน ไม่มีเลขออเดอร์ เลขออเดอร์มาจากแท็บตัดสต๊อกระบบ Transaction
 * ใน apps-script/cut-api.gs (?api=cut-orders) แล้วปันล็อตให้ ล็อตเก่าก่อน ให้ออเดอร์ตามลำดับแถวในแท็บนั้น
 * จึงเป็นการปันส่วน ไม่ใช่ของที่บันทึกไว้ว่าออเดอร์นี้หยิบจากล็อตนี้ วันที่ยอดสองฝั่งเท่ากันทุกชิ้นได้ล็อตครบ
 *
 * แปลงคืน (convert): บางสินค้าซื้อเข้ามาด้วย SKU หนึ่งแล้วแปลงเป็นอีก SKU ก่อนขาย บัญชีต้องการ SKU ตอนซื้อ
 * คู่ SKU มาจากแท็บ MASTER แปลงสินค้า ในไฟล์สมุด (ช่อง convert ของ tx-daily) ทำหลัง build และ allocate
 * เพราะสมุดกับแท็บตัดลงขายด้วย SKU หลังแปลง ต้องจับคู่กันด้วยรหัสนั้นก่อน
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsLotPo
 */
(function () {
  'use strict';

  var HEAD = ['วันที่', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'];

  /** LOT 0 คือไม่รู้ล็อต (ของที่ลงไว้ตอนนับสต๊อกก่อนเริ่มแยกล็อต) ช่องว่างก็ไม่รู้เหมือนกัน */
  function noLot(v) { return v === '' || +v === 0; }
  function noPo(v) { return /^0*$/.test(v); }

  /** ล็อตเลขน้อยคือของเก่า 0.11 คือล็อต 11 ของปีก่อน เรียงตามตัวเลขได้ตรง ล็อตที่ไม่รู้ไปท้ายสุด */
  function lotNo(r) {
    var n = parseFloat(r.lot);
    return r.noLot || isNaN(n) ? Infinity : n;
  }

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  /** 9900000001-01 กับ 9900000001-02 เป็น PO 9900000001 ส่วนท้ายคือวันที่รับเข้า ไม่ใช่อีก PO */
  function basePo(v) { var s = text(v); var m = /^(\d{6,})-\d{1,2}$/.exec(s); return m ? m[1] : s; }

  function build(ledger) {
    var at = {}, rows = [];
    var days = ledger.days || [], skus = ledger.skus || [], locs = ledger.locs || [];
    (ledger.lines || []).forEach(function (l) {
      var date = days[l[0]], s = skus[l[1]] || [];
      var lot = text(l[4]), raw = text(l[5]), po = basePo(raw);
      /* พิมพ์เล็กใหญ่ต่างกันคือล็อตเดียวกัน เหมือนที่ชีตยอดใช้ SUMIFS */
      var k = [date, s[0], lot.toUpperCase(), po.toUpperCase()].join('|');
      var r = at[k];
      if (!r) {
        r = at[k] = { date: date, sku: s[0] || '', name: s[1] || '', lot: lot, po: po, qty: 0,
          rows: [], locs: [], bad: [], parts: [], noLot: noLot(lot), noPo: noPo(po), split: 1 };
        rows.push(r);
      }
      /* รอบรับที่รวมไว้ในบรรทัดนี้ -05 -20 (เลขที่ไม่มีส่วนท้ายไม่นับเป็นรอบ) */
      var part = raw.length > po.length ? raw.slice(po.length) : '';
      if (part && r.parts.indexOf(part) < 0) r.parts.push(part);
      if (typeof l[6] === 'number') r.qty += l[6]; else r.bad.push(text(l[6]));
      r.rows.push(l[2]);
      var loc = locs[l[3]];
      if (loc && r.locs.indexOf(loc) < 0) r.locs.push(loc);
    });

    /* วันเดียวกัน SKU เดียวกันออกมากี่ LOT/PO บัญชีต้องแบ่งต้นทุนตามนี้ */
    var n = {};
    rows.forEach(function (r) { n[r.date + '|' + r.sku] = (n[r.date + '|' + r.sku] || 0) + 1; });
    rows.forEach(function (r) { r.split = n[r.date + '|' + r.sku]; r.parts.sort(); });

    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
      var la = lotNo(a), lb = lotNo(b);
      if (la !== lb) return la < lb ? -1 : 1;
      return a.po < b.po ? -1 : a.po > b.po ? 1 : 0;
    });
    return rows;
  }

  /**
   * rows คือผลของ build cut คือคำตอบ ?api=cut-orders ของช่วงเดียวกัน
   * miss บอกบรรทัดที่หาคู่ไม่ได้ ledger = ออเดอร์ตัดแต่สมุดลงขายไม่ถึง, order = สมุดลงขายแต่ไม่มีออเดอร์ตัด
   * split = ออเดอร์ + SKU นี้ได้ของจากกี่ LOT/PO
   */
  function allocate(rows, cut) {
    var need = {}, have = {}, keys = [], seq = {}, orders = 0;
    function key(k) { if (!need[k] && !have[k]) keys.push(k); }
    var days = cut.days || [], skus = cut.skus || [], srcs = cut.srcs || [];
    (cut.lines || []).forEach(function (l) {
      var date = days[l[0]], s = skus[l[2]] || [];
      var k = date + '|' + s[0];
      if (seq[date + '|' + l[1]] === undefined) seq[date + '|' + l[1]] = orders++;
      key(k);
      (need[k] = need[k] || []).push({ ref: l[1], src: srcs[l[4]] || '', qty: l[3], name: s[1] || '' });
    });
    rows.forEach(function (r) {
      var k = r.date + '|' + r.sku;
      key(k);
      (have[k] = have[k] || []).push(r);
    });

    var out = [];
    function push(date, sku, o, lot, qty, miss) {
      out.push({
        date: date, sku: sku, name: (lot && lot.name) || (o && o.name) || '',
        ref: o ? o.ref : '', src: o ? o.src : '', seq: o ? seq[date + '|' + o.ref] : Infinity,
        lot: lot ? lot.lot : '', po: lot ? lot.po : '', parts: lot ? lot.parts : [], qty: qty,
        noLot: lot ? lot.noLot : false, noPo: lot ? lot.noPo : false, miss: miss || '', split: 1,
      });
    }
    keys.forEach(function (k) {
      var at = k.indexOf('|'), date = k.slice(0, at), sku = k.slice(at + 1);
      var lots = (have[k] || []).map(function (r) { return { r: r, left: r.qty }; });
      var li = 0;
      (need[k] || []).forEach(function (o) {
        var left = o.qty;
        while (left > 0 && li < lots.length) {
          if (lots[li].left <= 0) { li++; continue; }
          var take = Math.min(left, lots[li].left);
          push(date, sku, o, lots[li].r, take);
          lots[li].left -= take;
          left -= take;
        }
        /* ยอดติดลบ (แก้ตัดย้อนหลัง) ไม่มีล็อตให้ปัน ขึ้นเป็นบรรทัดของมันเอง */
        if (left) push(date, sku, o, null, left, left < 0 ? 'minus' : 'ledger');
      });
      lots.forEach(function (x) { if (x.left > 0) push(date, sku, null, x.r, x.left, 'order'); });
    });

    var n = {};
    out.forEach(function (r) { if (r.ref) n[r.date + '|' + r.ref + '|' + r.sku] = (n[r.date + '|' + r.ref + '|' + r.sku] || 0) + 1; });
    out.forEach(function (r) { if (r.ref) r.split = n[r.date + '|' + r.ref + '|' + r.sku]; });

    /* ออเดอร์ตามลำดับในแท็บตัด ส่วนที่ไม่มีออเดอร์ไว้ท้ายวัน ใน SKU เดียวกันคงลำดับล็อตที่ปันไว้ */
    out.forEach(function (r, i) { r.i = i; });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
      if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
      return a.i - b.i;
    });
    out.forEach(function (r) { delete r.i; });
    return out;
  }

  /**
   * SKU หลังแปลง → { sku, name } ของ SKU ตอนซื้อ แปลงหลายทอด (ซื้อ A แปลงเป็น B แล้วเป็น C) ย้อนจนถึงตัวที่ซื้อ
   * SKU หลังแปลงที่ MASTER ให้ SKU ตอนซื้อมากกว่าหนึ่งตัว ไม่รู้ว่าคืนเป็นตัวไหน ได้ { many: [...] }
   */
  function buyMap(master) {
    var to = {}, many = {};
    ((master && master.pairs) || []).forEach(function (p) {
      var a = text(p[0]).toUpperCase(), b = text(p[1]).toUpperCase();
      if (!a || !b || a === b) return;
      if (!to[a]) { to[a] = { sku: b, name: text(p[2]) }; return; }
      if (to[a].sku === b) return;
      many[a] = many[a] || [to[a].sku];
      if (many[a].indexOf(b) < 0) many[a].push(b);
    });
    var map = {};
    Object.keys(to).forEach(function (a) {
      if (many[a]) { map[a] = { many: many[a] }; return; }
      var at = to[a], hop = {};
      hop[a] = 1;
      /* MASTER กรอกวนกลับหาตัวเอง หยุดก่อนถึงตัวที่ผ่านมาแล้ว */
      while (to[at.sku] && !many[at.sku] && !hop[to[at.sku].sku]) { hop[at.sku] = 1; at = to[at.sku]; }
      map[a] = at;
    });
    return map;
  }

  /**
   * rows คือผลของ build หรือ allocate master คือช่อง convert ของ tx-daily ไม่ได้แก้ rows เดิม
   * sold = SKU ที่ขาย มีเฉพาะบรรทัดที่แปลงคืน, many = SKU ตอนซื้อที่ MASTER ให้ไว้หลายตัว บรรทัดนั้นไม่แปลง
   * SKU ตอนซื้อที่สมุดไม่มีชื่อ ใช้ชื่อของ SKU ที่ขายไปก่อน
   */
  function convert(rows, master) {
    var map = buyMap(master);
    var out = rows.map(function (r, i) {
      var m = map[text(r.sku).toUpperCase()];
      var o = m ? Object.assign({}, r) : r;
      if (m && m.many) o.many = m.many;
      else if (m) { o.sold = r.sku; o.sku = m.sku; o.name = m.name || r.name; }
      return { r: o, i: i };
    });
    /* เรียงใหม่ด้วย SKU ตอนซื้อ รายออเดอร์ยังเรียงตามออเดอร์ก่อน ที่เหลือคงลำดับเดิม (ล็อตเก่าก่อน) */
    out.sort(function (x, y) {
      var a = x.r, b = y.r;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
      if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
      var sa = a.sold || '', sb = b.sold || '';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return x.i - y.i;
    });
    return out.map(function (x) { return x.r; });
  }

  function totals(rows) {
    /* split นับเป็น SKU ต่อวัน splitLines นับเป็นบรรทัด ตัวหลังเท่ากับจำนวนที่ตัวกรอง split ได้ */
    var t = { qty: 0, lines: rows.length, skus: 0, split: 0, splitLines: 0, unknown: { lines: 0, qty: 0 }, bad: 0,
      orders: 0, gap: { lines: 0, qty: 0 }, conv: { lines: 0, qty: 0 }, many: { lines: 0, qty: 0 } };
    var sku = {}, split = {}, orders = {};
    rows.forEach(function (r) {
      t.qty += r.qty;
      sku[r.sku] = 1;
      if (r.split > 1) { split[r.date + '|' + (r.ref || '') + '|' + r.sku] = 1; t.splitLines++; }
      if (r.noLot || r.noPo) { t.unknown.lines++; t.unknown.qty += r.qty; }
      if (r.miss) { t.gap.lines++; t.gap.qty += r.qty; }
      if (r.sold) { t.conv.lines++; t.conv.qty += r.qty; }
      if (r.many) { t.many.lines++; t.many.qty += r.qty; }
      if (r.ref) orders[r.date + '|' + r.ref] = 1;
      t.bad += r.bad ? r.bad.length : 0;
    });
    t.skus = Object.keys(sku).length;
    t.split = Object.keys(split).length;
    t.orders = Object.keys(orders).length;
    return t;
  }

  /**
   * only: '' ทั้งหมด | 'split' ออกหลาย LOT/PO | 'unknown' ไม่รู้ LOT หรือ PO | 'gap' รายออเดอร์ที่หาคู่ไม่ได้
   *       | 'conv' แปลงคืนเป็น SKU ตอนซื้อ หรือแปลงไม่ได้เพราะ MASTER มีหลายตัว
   * q ค้นใน SKU (ทั้งตอนซื้อและที่ขาย) ชื่อ LOT PO และเลขออเดอร์ ไม่สนตัวพิมพ์เล็กใหญ่
   */
  function filter(rows, o) {
    var q = text(o && o.q).toUpperCase(), date = o && o.date, only = o && o.only;
    var qp = basePo(q);   // ค้น 9900000001-02 ก็เจอบรรทัด PO 9900000001
    return rows.filter(function (r) {
      if (date && r.date !== date) return false;
      if (only === 'split' && r.split < 2) return false;
      if (only === 'unknown' && !r.noLot && !r.noPo) return false;
      if (only === 'gap' && !r.miss) return false;
      if (only === 'conv' && !r.sold && !r.many) return false;
      if (!q) return true;
      return r.po.toUpperCase().indexOf(qp) >= 0 ||
        [r.sku, r.sold || '', r.name, r.lot, r.po, r.ref || ''].some(function (v) { return v.toUpperCase().indexOf(q) >= 0; });
    });
  }

  var MISS = {
    ledger: 'สมุดลงขายไม่ถึงยอดที่ออเดอร์ตัด ไม่มีล็อตให้ปัน',
    order: 'สมุดลงขายแต่ไม่มีออเดอร์ตัดในแท็บ Transaction',
    minus: 'ยอดติดลบในแท็บ Transaction ไม่ได้ปันล็อต',
  };

  function note(r) {
    var out = [];
    if (r.miss) out.push(MISS[r.miss]);
    else if (r.noLot && r.noPo) out.push('ไม่รู้ LOT และ PO');
    else if (r.noLot) out.push('ไม่รู้ LOT');
    else if (r.noPo) out.push('ไม่รู้ PO');
    if (r.many) out.push('MASTER แปลงสินค้ามี SKU ตอนซื้อหลายตัว (' + r.many.join(', ') + ') ยังไม่แปลงคืน');
    if (r.bad && r.bad.length) out.push('จำนวนพิมพ์ไม่ใช่ตัวเลข ' + r.bad.length + ' แถว ไม่ได้นับ');
    return out.join(' · ');
  }

  var ORDER_HEAD = ['วันที่', 'ระบบ', 'เลขออเดอร์', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'];

  /** ตารางเรียบ ๆ ทุกบรรทัดมี SKU ครบ วางใน Excel แล้วกรองหรือทำ Pivot ต่อได้ทันที SKU ที่ขายว่างไว้ถ้าไม่ได้แปลง */
  function table(rows, byOrder) {
    if (byOrder) {
      return [ORDER_HEAD].concat(rows.map(function (r) {
        return [r.date, r.src, r.ref, r.sku, r.sold || '', r.name, r.lot, r.po, r.qty, note(r)];
      }));
    }
    return [HEAD].concat(rows.map(function (r) {
      return [r.date, r.sku, r.sold || '', r.name, r.lot, r.po, r.qty, note(r)];
    }));
  }

  /** ช่องที่ขึ้นต้นด้วย = + @ Excel จะอ่านเป็นสูตร ใส่ ' นำหน้าให้เป็นข้อความ */
  function cell(v) {
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[\t\r\n]+/g, ' ');
    return /^[=+@]/.test(s) || /^-\D/.test(s) ? "'" + s : s;
  }

  function tsv(rows, byOrder) {
    return table(rows, byOrder).map(function (l) { return l.map(cell).join('\t'); }).join('\n');
  }

  /** ใส่ BOM ไว้หน้าไฟล์ ไม่งั้น Excel เปิดแล้วภาษาไทยเป็นตัวอ่านไม่ออก */
  function csv(rows, byOrder) {
    return '﻿' + table(rows, byOrder).map(function (l) {
      return l.map(function (v) {
        var s = String(cell(v));
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  window.WmsLotPo = {
    HEAD: HEAD, ORDER_HEAD: ORDER_HEAD, basePo: basePo, build: build, allocate: allocate, convert: convert, totals: totals, filter: filter,
    note: note, table: table, tsv: tsv, csv: csv,
  };
})();
