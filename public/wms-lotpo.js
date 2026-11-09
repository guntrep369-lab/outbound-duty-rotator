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
 * ประมาณ LOT 0 (build รับ est): แถวขายที่สมุดลงเป็น LOT 0 PO 0 แยกเป็นบรรทัดตาม LOT/PO ที่ public/wms-lot0.js
 * ประมาณจากแถวรับคืน M/E และแปลงสินค้า บรรทัดเหล่านี้มี guess และหมายเหตุขึ้นต้นด้วย ประมาณ
 * ส่วนที่ยังประมาณไม่ได้ (เช่นของนับสต๊อก) ยังเป็น LOT 0 แต่บอกเหตุไว้ใน why
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsLotPo
 */
(function () {
  'use strict';

  var HEAD = ['วันที่', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'Supplier', 'จำนวน', 'หมายเหตุ'];

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

  /**
   * ค่าประมาณของแถวนี้ WmsLot0.only จับคู่ให้เลขแถวตรงกับแถวขายของเดือนแล้ว แม้แถวในชีตจะเลื่อน
   * เช็ก SKU กับจำนวนซ้ำ กันค่าที่ส่งมาไม่ผ่าน only หรือแถวถูกแก้ทีหลัง
   */
  function guessOf(est, l, sku) {
    var e = est.rows[l[2]];
    return e && e.s === text(sku).toUpperCase() && e.q === l[6] ? e : null;
  }

  /**
   * est คือผลของ WmsLot0.run (ไม่ส่งก็ไม่ประมาณ) แถวขาย LOT 0 PO 0 แยกเป็นบรรทัดตามค่าประมาณ
   *   guess = ที่มาของ LOT/PO ที่ประมาณได้ (return | me | conv)
   *   why   = ยังไม่รู้เพราะอะไร (count | short | other | none | return | me | conv)
   *           stale = ยังไม่ได้ประมาณ แถวนี้ไม่มีในสมุดทั้งชีตที่อ่านไว้
   *   from  = แถวในชีตที่เป็นต้นทางของค่าประมาณ (แถวรับคืน แถวนับสต๊อก)
   * บรรทัดประมาณไม่รวมกับบรรทัดที่สมุดลงล็อตไว้จริง บัญชีจะได้แยกได้
   */
  function build(ledger, est) {
    var at = {}, rows = [];
    var days = ledger.days || [], skus = ledger.skus || [], locs = ledger.locs || [];
    /* ชื่อ Supplier ของ PO (แท็บ PO. Truck ส่งมากับ tx-daily ต้องโหลด wms-sup.js)
       ช่อง sup ของบรรทัดรายออเดอร์คือบริษัทขนส่งอยู่แล้ว จึงเก็บชื่อ Supplier ไว้ที่ maker */
    var S = window.WmsSup, supm = S ? S.map(ledger.sup) : {};
    function add(l, date, s, lot, raw, qty, tag) {
      var po = basePo(raw);
      /* พิมพ์เล็กใหญ่ต่างกันคือล็อตเดียวกัน เหมือนที่ชีตยอดใช้ SUMIFS */
      var k = [date, s[0], lot.toUpperCase(), po.toUpperCase(), tag.guess ? 'g' + tag.guess : tag.why ? 'u' + tag.why : ''].join('|');
      var r = at[k];
      if (!r) {
        r = at[k] = { date: date, sku: s[0] || '', name: s[1] || '', lot: lot, po: po, maker: S && !noPo(po) ? S.of(supm, po) : '', qty: 0,
          rows: [], locs: [], bad: [], parts: [], noLot: noLot(lot), noPo: noPo(po), split: 1,
          guess: tag.guess || '', why: tag.why || '', from: [] };
        rows.push(r);
      }
      /* รอบรับที่รวมไว้ในบรรทัดนี้ -05 -20 (เลขที่ไม่มีส่วนท้ายไม่นับเป็นรอบ) */
      var part = raw.length > po.length ? raw.slice(po.length) : '';
      if (part && r.parts.indexOf(part) < 0) r.parts.push(part);
      if (typeof qty === 'number') r.qty += qty; else r.bad.push(text(qty));
      if (r.rows.indexOf(l[2]) < 0) r.rows.push(l[2]);
      if (tag.from && r.from.indexOf(tag.from) < 0) r.from.push(tag.from);
      var loc = locs[l[3]];
      if (loc && r.locs.indexOf(loc) < 0) r.locs.push(loc);
    }
    (ledger.lines || []).forEach(function (l) {
      var date = days[l[0]], s = skus[l[1]] || [];
      var lot = text(l[4]), raw = text(l[5]);
      if (!est || typeof l[6] !== 'number' || !noLot(lot) || !noPo(raw)) return add(l, date, s, lot, raw, l[6], {});
      var e = guessOf(est, l, s[0]);
      if (!e) return add(l, date, s, lot, raw, l[6], { why: 'stale' });
      e.p.forEach(function (p) {
        var plot = text(p[0]), praw = text(p[1]), ok = !noLot(plot) || !noPo(praw);
        add(l, date, s, ok ? plot : lot, ok ? praw : raw, p[2], ok ? { guess: p[3], from: p[4] } : { why: p[3], from: p[4] });
      });
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
      if (a.po !== b.po) return a.po < b.po ? -1 : 1;
      /* ล็อตเดียวกัน ที่สมุดลงไว้จริงขึ้นก่อนที่ประมาณ */
      return (a.guess ? 1 : 0) - (b.guess ? 1 : 0);
    });
    return rows;
  }

  /**
   * rows คือผลของ build cut คือคำตอบ ?api=cut-orders ของช่วงเดียวกัน
   * miss บอกบรรทัดที่หาคู่ไม่ได้ ledger = ออเดอร์ตัดแต่สมุดลงขายไม่ถึง, order = สมุดลงขายแต่ไม่มีออเดอร์ตัด
   * split = ออเดอร์ + SKU นี้ได้ของจากกี่ LOT/PO
   * online, sup = เลขคำสั่งซื้อออนไลน์กับบริษัทขนส่งของออเดอร์ (ช่อง refs ของ cut-orders สคริปต์รุ่นก่อนไม่มี ได้ค่าว่าง)
   */
  function allocate(rows, cut) {
    var need = {}, have = {}, keys = [], seq = {}, orders = 0;
    function key(k) { if (!need[k] && !have[k]) keys.push(k); }
    var days = cut.days || [], skus = cut.skus || [], srcs = cut.srcs || [], refs = cut.refs || {}, sups = cut.sups || [];
    (cut.lines || []).forEach(function (l) {
      var date = days[l[0]], s = skus[l[2]] || [], info = refs[l[1]] || ['', -1];
      var k = date + '|' + s[0];
      if (seq[date + '|' + l[1]] === undefined) seq[date + '|' + l[1]] = orders++;
      key(k);
      (need[k] = need[k] || []).push({ ref: l[1], src: srcs[l[4]] || '', qty: l[3], name: s[1] || '',
        online: text(info[0]), sup: info[1] >= 0 ? text(sups[info[1]]) : '' });
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
        ref: o ? o.ref : '', src: o ? o.src : '', online: o ? o.online : '', sup: o ? o.sup : '',
        seq: o ? seq[date + '|' + o.ref] : Infinity,
        lot: lot ? lot.lot : '', po: lot ? lot.po : '', maker: (lot && lot.maker) || '', parts: lot ? lot.parts : [], qty: qty,
        noLot: lot ? lot.noLot : false, noPo: lot ? lot.noPo : false, miss: miss || '', split: 1,
        guess: (lot && lot.guess) || '', why: (lot && lot.why) || '', from: (lot && lot.from) || [],
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
    /* guess = LOT/PO ที่ประมาณได้ แยกตามที่มา, why = ชิ้นที่ยังไม่รู้ แยกตามเหตุ (นับเฉพาะ LOT 0 PO 0) */
    var t = { qty: 0, lines: rows.length, skus: 0, split: 0, splitLines: 0, unknown: { lines: 0, qty: 0 }, bad: 0,
      orders: 0, gap: { lines: 0, qty: 0 }, conv: { lines: 0, qty: 0 }, many: { lines: 0, qty: 0 },
      guess: { lines: 0, qty: 0, by: {} }, why: {} };
    var sku = {}, split = {}, orders = {};
    rows.forEach(function (r) {
      t.qty += r.qty;
      sku[r.sku] = 1;
      if (r.split > 1) { split[r.date + '|' + (r.ref || '') + '|' + r.sku] = 1; t.splitLines++; }
      if (r.noLot || r.noPo) { t.unknown.lines++; t.unknown.qty += r.qty; }
      if (r.guess) { t.guess.lines++; t.guess.qty += r.qty; t.guess.by[r.guess] = (t.guess.by[r.guess] || 0) + r.qty; }
      if (r.why && r.noLot && r.noPo) t.why[r.why] = (t.why[r.why] || 0) + r.qty;
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
   *       | 'conv' แปลงคืนเป็น SKU ตอนซื้อ หรือแปลงไม่ได้เพราะ MASTER มีหลายตัว | 'guess' LOT/PO ประมาณจากแถวรับคืน M/E หรือแปลงสินค้า
   * q ค้นใน SKU (ทั้งตอนซื้อและที่ขาย) ชื่อ LOT PO Supplier เลขออเดอร์ และเลขคำสั่งซื้อออนไลน์ ไม่สนตัวพิมพ์เล็กใหญ่
   */
  function filter(rows, o) {
    var q = text(o && o.q).toUpperCase(), date = o && o.date, only = o && o.only;
    var qp = basePo(q);   // ค้น 9900000001-02 ก็เจอบรรทัด PO 9900000001
    return rows.filter(function (r) {
      if (date && r.date !== date) return false;
      if (only === 'split' && r.split < 2) return false;
      if (only === 'unknown' && !r.noLot && !r.noPo) return false;
      if (only === 'guess' && !r.guess) return false;
      if (only === 'gap' && !r.miss) return false;
      if (only === 'conv' && !r.sold && !r.many) return false;
      if (!q) return true;
      return r.po.toUpperCase().indexOf(qp) >= 0 ||
        [r.sku, r.sold || '', r.name, r.lot, r.po, r.maker || '', r.ref || '', r.online || ''].some(function (v) { return v.toUpperCase().indexOf(q) >= 0; });
    });
  }

  var MISS = {
    ledger: 'สมุดลงขายไม่ถึงยอดที่ออเดอร์ตัด ไม่มีล็อตให้ปัน',
    order: 'สมุดลงขายแต่ไม่มีออเดอร์ตัดในแท็บ Transaction',
    minus: 'ยอดติดลบในแท็บ Transaction ไม่ได้ปันล็อต',
  };

  /** LOT/PO ประมาณมาจากไหน ข้อความขึ้นต้นด้วยคำว่า ประมาณ บัญชีกรองใน Excel ได้ */
  var GUESS = {
    return: 'ประมาณจากรับคืน ใช้ LOT/PO ที่ขายออกล่าสุดก่อนรับคืน',
    me: 'ประมาณจาก M/E ใช้ LOT/PO ที่ขายออกล่าสุดก่อนรับเข้า',
    conv: 'ประมาณจากแปลงสินค้า ใช้ LOT/PO ของ SKU ต้นทาง',
    before: 'ประมาณจากยอดก่อนนับ ของนับที่ไม่รู้ LOT แบ่งตามล็อตที่เข้าหลังสุดก่อน',
  };

  /** ของ LOT 0 ที่ยังประมาณไม่ได้ เพราะอะไร */
  var WHY = {
    count: 'มาจากนับสต๊อก ต้องใช้ยอดก่อนวันนับมาประมาณ',
    short: 'มาจากนับสต๊อก แต่แท็บยอดก่อนนับไม่มี SKU นี้หรือมีไม่พอ',
    return: 'รับคืนแต่ไม่มีแถวขายก่อนหน้าให้ย้อนดู',
    me: 'M/E แต่ไม่มีแถวขายก่อนหน้าให้ย้อนดู',
    conv: 'แปลงสินค้าแต่หาแถวเบิกคู่ไม่เจอ',
    other: 'รับเข้าจากแถวที่ไม่บอกว่ามาจากไหน',
    none: 'สมุดขายจากกอง LOT 0 เกินที่รับเข้า',
    stale: 'ยังไม่ได้ประมาณ แถวนี้ไม่มีในสมุดทั้งชีตที่อ่านไว้ (ลงหลังเวลาที่อ่าน หรือถูกแก้ทีหลัง)',
  };

  function note(r) {
    var out = [];
    var from = r.from && r.from.length ? ' (แถว ' + r.from.slice(0, 3).join(', ') + (r.from.length > 3 ? ' +' + (r.from.length - 3) : '') + ')' : '';
    if (r.miss) out.push(MISS[r.miss]);
    else if (r.guess) out.push((GUESS[r.guess] || 'ประมาณ') + from);
    else if (r.noLot && r.noPo) out.push('ไม่รู้ LOT และ PO' + (r.why ? ' · ' + (WHY[r.why] || '') + (r.why === 'stale' || r.why === 'none' ? '' : from) : ''));
    else if (r.noLot) out.push('ไม่รู้ LOT');
    else if (r.noPo) out.push('ไม่รู้ PO');
    if (r.many) out.push('MASTER แปลงสินค้ามี SKU ตอนซื้อหลายตัว (' + r.many.join(', ') + ') ยังไม่แปลงคืน');
    if (/E\+/i.test(r.online || '')) out.push('เลขคำสั่งซื้อออนไลน์ในแท็บตัดถูกชีตปัดเป็นเลขยกกำลัง ดูเลขจริงในระบบ ' + (r.src || 'ต้นทาง'));
    if (r.bad && r.bad.length) out.push('จำนวนพิมพ์ไม่ใช่ตัวเลข ' + r.bad.length + ' แถว ไม่ได้นับ');
    return out.join(' · ');
  }

  var ORDER_HEAD = ['วันที่', 'ระบบ', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'บริษัทขนส่ง', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'Supplier', 'จำนวน', 'หมายเหตุ'];

  /** ตารางเรียบ ๆ ทุกบรรทัดมี SKU ครบ วางใน Excel แล้วกรองหรือทำ Pivot ต่อได้ทันที SKU ที่ขายว่างไว้ถ้าไม่ได้แปลง */
  function table(rows, byOrder) {
    if (byOrder) {
      return [ORDER_HEAD].concat(rows.map(function (r) {
        return [r.date, r.src, r.ref, r.online || '', r.sup || '', r.sku, r.sold || '', r.name, r.lot, r.po, r.maker || '', r.qty, note(r)];
      }));
    }
    return [HEAD].concat(rows.map(function (r) {
      return [r.date, r.sku, r.sold || '', r.name, r.lot, r.po, r.maker || '', r.qty, note(r)];
    }));
  }

  /**
   * ช่องที่ขึ้นต้นด้วย = + @ Excel จะอ่านเป็นสูตร ใส่ ' นำหน้าให้เป็นข้อความ
   * ตัวเลขล้วนเกิน 15 หลัก (เลขคำสั่งซื้อออนไลน์) Excel แปลงเป็นตัวเลขแล้วปัดหลักท้ายทิ้งเป็น 9.9E+17
   * แบบเดียวกับที่เกิดในแท็บตัด จึงส่งเป็น ="…" ให้ Excel กับ Google Sheets เก็บเป็นข้อความครบทุกหลัก
   */
  function cell(v) {
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[\t\r\n]+/g, ' ');
    if (/^\d{16,}$/.test(s)) return '="' + s + '"';
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
    HEAD: HEAD, ORDER_HEAD: ORDER_HEAD, GUESS: GUESS, WHY: WHY, basePo: basePo, build: build, allocate: allocate, convert: convert,
    totals: totals, filter: filter, note: note, table: table, tsv: tsv, csv: csv,
    /* หน้าสินค้าคงเหลือ ณ วันที่ใช้แปลง SKU คืนด้วยกติกาเดียวกัน */
    buyMap: buyMap,
  };
})();
