/**
 * @file wms-lot0.js — ประมาณ LOT/PO ให้ของที่สมุดลงไว้เป็น LOT 0 PO 0 (ไม่รู้ล็อต)
 *
 * ที่มาของ LOT 0 (ผู้ใช้บอก 2026-11-06)
 *   - ของที่ลูกค้าส่งคืน ดูจากตัวสินค้าไม่ได้ว่าล็อตไหน
 *   - ตอนนับสต๊อก Q3 หมอน ชุดเครื่องนอน ผ้านวม ไม่มีเลข LOT PO ที่ตัวสินค้า
 *
 * อ่านทุกแถวของสมุดจาก ?api=tx-fifo (ช่อง rows รูปแบบอยู่ที่ fifo_ ใน apps-script/tx-api.gs) เดินตามลำดับแถวในชีต
 * กอง LOT 0 ของแต่ละ SKU + Location เป็นคิว ของที่เข้ากองได้ LOT/PO ประมาณตามที่มา
 *   รับคืน (ธง 32) และ M/E (ธง 64): ของที่คืนมาคือของที่เพิ่งส่งออกไป ใช้ LOT/PO ของแถวขาย SKU เดียวกัน
 *     ที่อยู่เหนือขึ้นไป ใหม่สุดก่อน ชิ้นที่ขายไปแล้วยกให้รับคืนได้ครั้งเดียว
 *     แถวขายที่หยิบจากกอง LOT 0 เองก็ใช้ค่าประมาณของแถวนั้นต่อ
 *   แปลงสินค้า (ธง 16): ตามของที่เบิกออกจาก SKU ต้นทางในคู่เดียวกัน
 *   นับสต๊อก (ธง 4): แบ่งตามยอดก่อนวันนับจากแท็บ ยอดก่อนนับ (ช่อง before ของ tx-fifo) ล็อตที่เข้าหลังสุดก่อน
 *     ถ้าของออกตาม FIFO ของที่ยังเหลือตอนนับคือของที่เข้ามาหลังสุด ส่วนที่นับแล้วรู้ล็อตหักออกจากล็อตนั้นก่อน
 *     ไม่มีแท็บ หรือยอดของ SKU นั้นไม่พอ ส่วนที่เหลือยังไม่รู้
 * ขายหรือเบิกออกจากกอง LOT 0 หยิบจากหัวคิว เข้าก่อนออกก่อน โอนย้ายพาของในคิวไปกองปลายทาง
 * กองไม่พอให้หยิบ (สมุดลงขายเกินที่รับเข้า) ส่วนที่ขาดไม่มีที่มา
 *
 * เป็นค่าประมาณ ไม่ใช่ของที่บันทึกไว้ หน้า LOT / PO ที่ขายออกติดป้ายประมาณทุกบรรทัด สมุดไม่ถูกแก้
 *
 * ผลของ run เก็บเฉพาะแถวขายที่เป็น LOT 0
 *   rows[เลขแถว] = { s: SKU คอลัมน์ B ตัวใหญ่, q: จำนวน, p: [[LOT, PO, จำนวน, ที่มา, แถวต้นทาง, แถวขายที่ย้อนไปดู]] }
 *   ที่มา: return | me | conv | before คือประมาณได้ (LOT/PO ไม่ว่าง)
 *          count (ไม่มีแท็บยอดก่อนนับ) | short (แท็บไม่มี SKU นี้หรือมีไม่พอ) | other | none
 *          หรือ return | me | conv ที่ LOT/PO ว่าง คือยังไม่รู้ และบอกว่าเพราะอะไร
 * before = สรุปแท็บยอดก่อนนับ (undefined = สคริปต์รุ่นที่ไม่อ่านแท็บนี้, null = ไม่มีแท็บ)
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsLot0
 */
(function () {
  'use strict';

  var NEAR = 40;   // แถวแปลงสินค้าคู่กันอยู่ห่างไม่เกินนี้ กติกาเดียวกับ wms-why.js

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  /** กติกาเดียวกับ wms-lotpo.js: LOT ว่างหรือ 0, PO ว่างหรือมีแต่ 0 */
  function noLot(v) { return text(v) === '' || +v === 0; }
  function noPo(v) { return /^0*$/.test(text(v)); }
  function unknown(lot, po) { return noLot(lot) && noPo(po); }
  function known(p) { return !unknown(p.lot, p.po); }

  function piece(lot, po, qty, src, from, via) {
    return { lot: lot, po: po, qty: qty, src: src, from: from || 0, via: via || 0 };
  }
  function copy(p) { return piece(p.lot, p.po, p.qty, p.src, p.from, p.via); }

  /** หยิบจากหัวคิว ส่วนที่กองไม่พอเป็น none */
  function take(queue, qty, row) {
    var out = [], need = qty;
    while (need > 0 && queue.length) {
      var p = queue[0], k = Math.min(need, p.qty);
      out.push(piece(p.lot, p.po, k, p.src, p.from, p.via));
      p.qty -= k;
      need -= k;
      if (p.qty <= 0) queue.shift();
    }
    if (need > 0) out.push(piece('', '', need, 'none', row, 0));
    return out;
  }

  /**
   * ของที่รับคืนมาคือของที่ SKU นี้ส่งออกไปล่าสุด ย้อนแถวขายขึ้นไปทีละแถว ใหม่สุดก่อน
   * ชิ้นที่ขายแล้วถูกยกให้รับคืนไปแล้วไม่ถูกยกซ้ำ ย้อนจนหมดแล้วยังไม่พอ ส่วนที่เหลือไม่รู้ (ไม่มีแถวขายให้ดู)
   * ชิ้นที่ขายไปตอนนั้นเองก็ไม่รู้ล็อต (เช่นของนับสต๊อก) ส่งต่อที่มาเดิม จะได้รู้ว่ารออะไรอยู่
   */
  function back(list, qty, row, src) {
    var out = [], need = qty;
    for (var i = list.length - 1; i >= 0 && need > 0; i--) {
      var e = list[i];
      for (var j = 0; j < e.p.length && need > 0; j++) {
        var p = e.p[j];
        if (p.qty <= 0) continue;
        var k = Math.min(need, p.qty);
        p.qty -= k;
        need -= k;
        out.push(known(p) ? piece(p.lot, p.po, k, src, row, e.row)
          : piece('', '', k, p.src, p.from || row, e.row));
      }
    }
    if (need > 0) out.push(piece('', '', need, src, row, 0));
    return out;
  }

  /** 9900000001-05 คือ PO 9900000001 รับรอบวันที่ 5 กติกาเดียวกับ wms-lotpo.js */
  function basePo(v) { var s = text(v); var m = /^(\d{6,})-\d{1,2}$/.exec(s); return m ? m[1] : s; }

  /**
   * LOT คือเดือนของสินค้า ลำดับเดือนเทียบกับเดือนที่นับ (ref yyyy-mm-dd) กติกาเดียวกับ lotMonth ใน wms-fifo.js
   * 1–12 ที่มากกว่าเดือนที่นับเป็นของปีก่อน 0.11 คือ พ.ย. ปีก่อน อ่านไม่ได้ได้ -Infinity (เก่าสุด)
   */
  function lotKey(lot, ref) {
    var n = Number(text(lot)), ry = +ref.slice(0, 4), rm = +ref.slice(5, 7);
    if (!(n > 0) || !ry) return -Infinity;
    if (n < 1) return (ry - 1) * 12 + Math.round(n * 100);
    if (n === Math.floor(n) && n <= 12) return (n <= rm ? ry : ry - 1) * 12 + n;
    return -Infinity;
  }

  /**
   * ยอดก่อนนับราย SKU เรียงล็อตที่เข้าหลังสุดก่อน (วันที่รับ ถ้าไม่มีใช้เดือนของ LOT แล้ว PO เลขมากก่อน)
   * หักส่วนที่นับแล้วรู้ล็อต (แถวนับสต๊อกที่ลง LOT/PO ไว้) ออกจากล็อตเดียวกันก่อน
   * SKU ในแท็บหาด้วยรหัสเต็มก่อน แล้วรหัสสั้น
   */
  function layers(fifo, before) {
    var skus = fifo.skus || [], pos = fifo.pos || [], rows = fifo.rows || [];
    var byLong = {}, byShort = {}, by = {}, miss = {}, ref = '';
    skus.forEach(function (s, i) {
      if (text(s[1])) byLong[text(s[1]).toUpperCase()] = i;
      if (text(s[0]) && byShort[text(s[0]).toUpperCase()] === undefined) byShort[text(s[0]).toUpperCase()] = i;
    });
    (fifo.days || []).forEach(function (d) { if (d && (!ref || d < ref)) ref = d; });
    if (!ref) ref = text(fifo.today);
    var info = { tab: before.tab, mode: before.mode, rows: before.rows || 0, missing: before.missing || [],
      cols: before.cols || [], skus: 0, layers: 0, miss: [], missN: 0, used: 0, short: 0 };
    (before.layers || []).forEach(function (x) {
      var code = text(x[0]).toUpperCase();
      var s = byLong[code] !== undefined ? byLong[code] : byShort[code];
      if (s === undefined) { if (!miss[code]) { miss[code] = 1; info.missN++; if (info.miss.length < 20) info.miss.push(text(x[0])); } return; }
      if (unknown(x[1], x[2])) return;   // ยอดก่อนนับที่ไม่รู้ล็อตเองช่วยประมาณไม่ได้
      if (!by[s]) { by[s] = []; info.skus++; }
      by[s].push({ lot: x[1], po: text(x[2]), qty: +x[3] || 0, date: text(x[4]), key: lotKey(x[1], ref) });
      info.layers++;
    });
    rows.forEach(function (r) {
      var po = pos[r[3]];
      if (!(r[9] & 4) || !by[r[1]] || unknown(r[2], po) || !(r[6] > 0)) return;
      var left = r[6];
      by[r[1]].forEach(function (x) {
        if (left <= 0 || text(x.lot).toUpperCase() !== text(r[2]).toUpperCase() || basePo(x.po).toUpperCase() !== basePo(po).toUpperCase()) return;
        var k = Math.min(left, x.qty);
        x.qty -= k;
        left -= k;
      });
    });
    Object.keys(by).forEach(function (s) {
      by[s] = by[s].filter(function (x) { return x.qty > 0; }).sort(function (a, b) {
        if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.key !== b.key) return a.key < b.key ? 1 : -1;
        return a.po < b.po ? 1 : a.po > b.po ? -1 : 0;
      });
    });
    return { by: by, info: info };
  }

  /** แถวรับของแปลงสินค้า (มีแต่ Location รับ) → แถวเบิกคู่ของมัน (มีแต่ Location เบิก) SKU ต่างกัน จำนวนเท่ากัน ใกล้สุด */
  function pairs(rows) {
    var outs = [], at = {}, used = {};
    rows.forEach(function (r, i) { if (r[9] & 16 && r[7] === 1 && r[4] >= 0 && r[5] < 0) outs.push(i); });
    rows.forEach(function (r, i) {
      if (!(r[9] & 16) || r[5] < 0 || r[4] >= 0) return;
      var best = -1;
      outs.forEach(function (j) {
        if (used[j] || rows[j][1] === r[1] || rows[j][6] !== r[6] || Math.abs(j - i) > NEAR) return;
        if (best < 0 || Math.abs(j - i) < Math.abs(best - i)) best = j;
      });
      if (best >= 0) { used[best] = 1; at[i] = best; }
    });
    return at;
  }

  function run(fifo) {
    fifo = fifo || {};
    var rows = fifo.rows || [], skus = fifo.skus || [], pos = fifo.pos || [], days = fifo.days || [];
    var pool = {}, sold = {}, done = {}, out = {};
    var conv = pairs(rows);
    var pre = fifo.before ? layers(fifo, fifo.before) : null;

    /** ของนับสต๊อกที่ไม่รู้ล็อต แบ่งจากยอดก่อนนับของ SKU นั้น ล็อตที่เข้าหลังสุดก่อน */
    function counted(s, qty, row) {
      var list = pre && pre.by[s], got = [], need = qty;
      while (list && list.length && need > 0) {
        var x = list[0], k = Math.min(need, x.qty);
        got.push(piece(x.lot, x.po, k, 'before', row, 0));
        x.qty -= k;
        need -= k;
        if (x.qty <= 0) list.shift();
      }
      if (pre) { pre.info.used += qty - need; pre.info.short += need; }
      if (need > 0) got.push(piece('', '', need, pre ? 'short' : 'count', row, 0));
      return got;
    }

    function queue(s, loc) { var k = s + '|' + loc; return pool[k] || (pool[k] = []); }
    function sales(s) { return sold[s] || (sold[s] = []); }
    /* หยิบของออกจากกองต้นทางของแถว i ครั้งเดียว แถวรับของคู่แปลงอาจมาถึงก่อนแถวเบิก */
    function takeOut(i) {
      var r = rows[i];
      return done[i] || (done[i] = take(queue(r[1], r[4]), r[6], r[0]));
    }
    function convIn(i, j) {
      var r = rows[j], po = pos[r[3]];
      if (!unknown(r[2], po)) return [piece(r[2], po, rows[i][6], 'conv', rows[i][0], r[0])];
      return takeOut(j).map(copy);
    }

    rows.forEach(function (r, i) {
      var s = r[1], lot = r[2], po = pos[r[3]], from = r[4], to = r[5], qty = r[6], t = r[7], flag = r[9];
      if (!(qty > 0)) return;
      if (!unknown(lot, po)) {
        if (t === 2) sales(s).push({ row: r[0], p: [piece(lot, po, qty, 'real', 0, 0)] });
        return;
      }
      var took = t === 2 || (t === 1 && from >= 0) ? takeOut(i) : null;
      if (t === 2) {
        out[r[0]] = { s: text((skus[s] || [])[1]).toUpperCase(), q: qty, d: text(days[r[8]]),
          p: took.map(function (p) { return [p.lot, p.po, p.qty, p.src, p.from, p.via]; }) };
        sales(s).push({ row: r[0], p: took.map(copy) });
        return;
      }
      if (to < 0) return;
      var add;
      if (took) add = took.map(copy);   // โอนย้าย ของในคิวย้ายไปกองปลายทางทั้งที่มา
      else if (flag & 16 && conv[i] !== undefined) add = convIn(i, conv[i]);
      else if (flag & 32) add = back(sales(s), qty, r[0], 'return');
      else if (flag & 64) add = back(sales(s), qty, r[0], 'me');
      else if (flag & 4) add = counted(s, qty, r[0]);
      else add = [piece('', '', qty, flag & 16 ? 'conv' : 'other', r[0], 0)];
      var q = queue(s, to);
      add.forEach(function (p) { q.push(p); });
    });

    return { ok: fifo.lot0 === 1, at: fifo.at || 0, sheet: fifo.sheet || null, rows: out,
      before: fifo.before === undefined ? undefined : pre ? pre.info : null };
  }

  function num(a, b) { return a - b; }

  /**
   * เก็บลงเครื่องเฉพาะแถวขาย LOT 0 ของเดือนที่หน้ากำลังใช้ ทั้งชีตใหญ่เกินที่เบราว์เซอร์ให้เก็บ
   * led คือคำตอบ tx-daily ของเดือน ผลที่ได้ใช้เลขแถวของ led
   * แถวขายของเดือนกับสมุดทั้งชีตอ่านคนละเวลา ระหว่างนั้นมีคนแทรกหรือลบแถว เลขแถวจะเลื่อนทั้งท้ายชีต
   * (เจอจริง 2026-11-06 แทรกแถวต้นเดือนแถวเดียว แถวขายเดือนนั้นเกือบทั้งเดือนหาค่าประมาณไม่เจอ)
   * จึงจับคู่ด้วย SKU + จำนวน + วันที่ แถวที่เหมือนกันทั้งสามอย่างจับกันตามลำดับแถวในชีต (แทรกหรือลบไม่ทำให้ลำดับสลับ)
   * แถวที่ไม่มีคู่ในสมุดทั้งชีต (ลงหลังเวลาที่อ่าน) ไม่ได้ค่าประมาณ moved = จำนวนแถวที่เลขแถวไม่ตรงแต่จับคู่ได้
   */
  function only(est, led) {
    var rows = {}, want = {}, have = {}, moved = 0;
    var lines = (led && led.lines) || [], days = (led && led.days) || [], skus = (led && led.skus) || [];
    function key(s, q, d) { return s + '|' + q + '|' + d; }
    lines.forEach(function (l) {
      if (typeof l[6] !== 'number' || !unknown(l[4], l[5])) return;
      var k = key(text((skus[l[1]] || [])[0]).toUpperCase(), l[6], text(days[l[0]]));
      (want[k] = want[k] || []).push(l[2]);
    });
    Object.keys(est.rows).forEach(function (n) {
      var e = est.rows[n], k = key(e.s, e.q, text(e.d));
      if (want[k]) (have[k] = have[k] || []).push(+n);
    });
    Object.keys(want).forEach(function (k) {
      var a = want[k].sort(num), b = (have[k] || []).sort(num);
      for (var i = 0; i < a.length && i < b.length; i++) {
        rows[a[i]] = est.rows[b[i]];
        if (a[i] !== b[i]) moved++;
      }
    });
    return { v: 2, ok: est.ok, at: est.at, sheet: est.sheet, rows: rows, before: est.before, moved: moved };
  }

  window.WmsLot0 = { run: run, only: only, unknown: unknown };
})();
