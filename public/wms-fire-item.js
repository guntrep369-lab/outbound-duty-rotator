/**
 * @file wms-fire-item.js — ระบบใหม่: หน้า สินค้า / โล ของแอปสมุดสต๊อก
 *
 * คิดจากสำเนาในเครื่องทั้งหมด ไม่อ่านฐานเพิ่ม (ไม่กินโควตา)
 *   index(st, day)                 ทุก SKU: รวม เปิดขาย สำรอง QA ติดลบ โลที่มีของ Supplier วันรับเก่าสุด
 *   search(ix, q, chip)            ค้นหลายคำพร้อมกัน (SKU · SKU เต็ม · ชื่อ · โล · LOT · PO · Supplier) + ชิปกรอง
 *                                  พิมพ์ชื่อโลตรงตัว (หรือต้นชื่อที่มี - เช่น R01-02) = ของในโลนั้น
 *   detail(ix, res, st, code)      SKU เดียว: กองเรียงลำดับตัด (FIFO) วันรับ อายุ Supplier ความจุต่อพาเลท คู่แปลงพร้อมยอด
 *   card(local, code, opt)         สต๊อกการ์ด: ทุกแถวของ SKU นี้ตั้งแต่ยอดยกมา คงเหลือหลังแต่ละแถว
 *                                  opt.loc = เฉพาะโลนั้น · opt.sku = รหัสสั้น (แถวเก่าที่ไม่มี SKU เต็ม)
 * st = WmsBook.stock(res) · res = คำตอบรูป tx-fifo (WmsFireCore.fifo) · local = สำเนาในเครื่อง · day = วันนี้ yyyy-mm-dd
 * ยอดรวมของ SKU = ทุกกองรวมกัน (รวมกองติดลบ) เท่ากับคงเหลือสุดท้ายของสต๊อกการ์ด
 * เปิดเป็น window.WmsFireItem · card ต้องโหลด wms-fire-core.js ก่อน
 */
(function () {
  'use strict';

  var ST_TH = { open: 'เปิดขาย', reserve: 'สำรอง', qa: 'QA', neg: 'ติดลบ' };
  var KIND_TH = { in: 'เข้า', out: 'ออก', move: 'ย้าย' };
  var CHIPS = ['have', 'open', 'qa', 'neg', 'zero', 'all'];

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function up(v) { return text(v).toUpperCase(); }
  function lc(v) { return text(v).toLowerCase(); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function dayNo(d) { var p = String(d).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function nat(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }
  /** โล QA / IQA (QA-01, IQA2 ก็ได้) แบบ WmsFireCore.whOf */
  function qaLoc(loc) { return /^I?QA(?![A-Z])/.test(up(loc)); }
  function ageOf(first, day) { return first && day && /^\d{4}-\d{2}-\d{2}$/.test(first) ? Math.max(0, dayNo(day) - dayNo(first)) : null; }
  function uniq(list, v) { if (v && list.indexOf(v) < 0) list.push(v); }

  function pileOf(p, day, neg) {
    return {
      loc: text(p.loc), lot: text(p.lot), po: text(p.po), qty: r3(p.qty),
      st: neg ? 'neg' : qaLoc(p.loc) ? 'qa' : p.open ? 'open' : 'reserve',
      first: p.first || '', age: ageOf(p.first, day), sup: p.sup || '',
    };
  }

  /**
   * ทุก SKU ที่เคยมีในสมุด → { list (เรียงตาม SKU), by: { s: item }, locs: { โล: [กองพร้อม s] }, piles, skus }
   * item = { s, sku, long, name, total, have, open, reserve, qa, neg, nNeg, locs, openLocs, sups, first, age, piles, negs, text }
   */
  function index(st, day) {
    var list = [], by = {}, locs = {}, nPiles = 0;
    (st.skus || []).forEach(function (t, s) {
      var it = {
        s: s, sku: text(t[0]), long: text(t[1]), name: text(t[2]),
        total: 0, have: 0, open: 0, reserve: 0, qa: 0, neg: 0, nNeg: 0,
        locs: [], openLocs: [], sups: [], first: '', age: null, piles: [], negs: [], text: '',
      };
      ((st.all && st.all[s]) || []).forEach(function (p) {
        var x = pileOf(p, day, false);
        it.piles.push(x);
        it.have = r3(it.have + x.qty);
        it[x.st] = r3(it[x.st] + x.qty);
        uniq(it.locs, x.loc);
        if (x.st === 'open') uniq(it.openLocs, x.loc);
        uniq(it.sups, x.sup);
        if (x.first && (!it.first || x.first < it.first)) it.first = x.first;
        var L = up(x.loc);
        (locs[L] || (locs[L] = [])).push(Object.assign({ s: s }, x));
        nPiles++;
      });
      list.push(it);
      by[s] = it;
    });
    (st.neg || []).forEach(function (p) {
      var it = by[p.s];
      if (!it) return;
      var x = pileOf(p, day, true);
      it.negs.push(x);
      it.neg = r3(it.neg + x.qty);
      it.nNeg++;
      uniq(it.locs, x.loc);
      var L = up(x.loc);
      (locs[L] || (locs[L] = [])).push(Object.assign({ s: p.s }, x));
    });
    list.forEach(function (it) {
      it.total = r3(it.have + it.neg);
      it.age = ageOf(it.first, day);
      var words = [it.sku, it.long, it.name].concat(it.locs, it.sups);
      it.piles.concat(it.negs).forEach(function (x) { words.push('lot' + x.lot, x.po); });
      it.text = lc(words.join(' '));
    });
    list.sort(function (a, b) { return nat(a.sku || a.long, b.sku || b.long) || nat(a.long, b.long); });
    Object.keys(locs).forEach(function (L) {
      locs[L].sort(function (a, b) { return nat(by[a.s].sku || by[a.s].long, by[b.s].sku || by[b.s].long) || (b.qty - a.qty); });
    });
    return { list: list, by: by, locs: locs, piles: nPiles, skus: list.length };
  }

  function inChip(it, chip) {
    if (chip === 'open') return it.open > 0;
    if (chip === 'qa') return it.qa > 0;
    if (chip === 'neg') return it.nNeg > 0;
    if (chip === 'zero') return !(it.have > 0) && !it.nNeg;
    if (chip === 'all') return true;
    return it.have > 0;   // have
  }

  /**
   * ค้น → { list, total, counts: { have, open, qa, neg, zero, all }, loc: null | { q, locs, piles, total } }
   * คำค้นทุกคำต้องเจอ (คำ lot8 = LOT 8) · ชิปกรองหลังนับ · loc = พิมพ์ชื่อโล
   */
  function search(ix, q, chip) {
    chip = CHIPS.indexOf(chip) >= 0 ? chip : 'have';
    var words = lc(q).split(/\s+/).filter(Boolean);
    var hit = ix.list.filter(function (it) { return words.every(function (w) { return it.text.indexOf(w) >= 0; }); });
    var counts = {};
    CHIPS.forEach(function (c) { counts[c] = 0; });
    hit.forEach(function (it) { CHIPS.forEach(function (c) { if (inChip(it, c)) counts[c]++; }); });
    var list = hit.filter(function (it) { return inChip(it, chip); });
    var loc = null;
    if (words.length === 1) {
      var w = up(words[0]);
      var keys = ix.locs[w] ? [w] : /-/.test(w) && w.length >= 2 ? Object.keys(ix.locs).filter(function (L) { return L.indexOf(w) === 0; }) : [];
      if (keys.length) {
        keys.sort(nat);
        var piles = [], total = 0;
        keys.forEach(function (L) { ix.locs[L].forEach(function (x) { piles.push(x); total = r3(total + x.qty); }); });
        loc = { q: w, locs: keys, piles: piles, total: total };
      }
    }
    return { list: list, total: list.length, counts: counts, chip: chip, loc: loc };
  }

  /** ความจุต่อพาเลท [[SKU, Product ID, ชิ้น]] ของ SKU นี้ (รหัสยาวก่อน) · ไม่มี = null */
  function capOf(res, it) {
    var rows = (res && res.cap && res.cap.rows) || [], L = up(it.long), K = up(it.sku), hit = null;
    rows.forEach(function (r) {
      if (hit !== null) return;
      if ((L && (up(r[1]) === L || up(r[0]) === L)) || (K && up(r[0]) === K)) hit = +r[2];
    });
    return hit !== null && isFinite(hit) ? hit : null;
  }

  /**
   * SKU เดียว (รหัสยาวหรือสั้น) → null | item + { cap, pallets, next, from: [คู่], to: [คู่], piles รวมกองติดลบท้ายสุด }
   * MASTER แปลงสินค้า [SKU หลังแปลง, SKU ตอนซื้อ] · from = แปลงมาจาก · to = แปลงไปเป็น · คู่ = { code, s, sku, name, total }
   */
  function detail(ix, res, st, code) {
    var s = st.code(code);
    var it = s >= 0 ? ix.by[s] : null;
    if (!it) return null;
    var mine = {};
    [it.long, it.sku].forEach(function (k) { if (k) mine[up(k)] = 1; });
    function pair(c, nm) {
      var t = st.code(c), o = t >= 0 ? ix.by[t] : null;
      return { code: c, s: o ? o.s : -1, sku: o ? o.sku : '', name: (o && o.name) || nm || '', total: o ? o.total : 0 };
    }
    var from = [], to = [], seen = {};
    ((res && res.convert && res.convert.pairs) || []).forEach(function (p) {
      var a = up(p[0]), b = up(p[1]);
      if (!a || !b || a === b) return;
      if (mine[a] && !mine[b] && !seen['f' + b]) { seen['f' + b] = 1; from.push(pair(b, p[2])); }
      if (mine[b] && !mine[a] && !seen['t' + a]) { seen['t' + a] = 1; to.push(pair(a, '')); }
    });
    var cap = capOf(res, it);
    var next = -1;
    it.piles.forEach(function (x, i) { if (next < 0 && x.st === 'open') next = i; });
    return Object.assign({}, it, {
      piles: it.piles.concat(it.negs), cap: cap, pallets: cap > 0 && it.have > 0 ? Math.round(it.have / cap * 10) / 10 : null,
      next: next, from: from, to: to,
    });
  }

  /**
   * สต๊อกการ์ด (เก่าสุดก่อน) → { rows, bal, inQ, outQ, loc }
   * แถว = { no, seq, date, type, kind in|out|move, lot, po, from, to, qty, delta, bal, who, note, open, voided, rev }
   * กติกาเดียวกับยอดคงเหลือ (applyRows): เข้า = มีโลรับ · ออก = มีโลเบิกและเป็น เบิก / ขาย
   * ทั้ง SKU: ย้ายในคลัง = คงเหลือไม่เปลี่ยน · เฉพาะโล: ย้ายเข้าโลนี้ = เข้า ย้ายออก = ออก
   * ใบที่ยกเลิกกับใบกลับรายการแสดงทั้งคู่ (หักล้างกัน) ใบเดิมมีป้ายยกเลิก
   */
  function card(local, code, opt) {
    opt = opt || {};
    var C = window.WmsFireCore;
    var key = up(code), alt = up(opt.sku), L = up(opt.loc);
    var vd = C.voids(local), rows = [], bal = 0, inQ = 0, outQ = 0;
    C.liveDocs(local).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      (d.rows || []).forEach(function (r) {
        if (!r[0] && !r[1]) return;
        if (up(r[1] || r[0]) !== key && !(alt && !r[1] && up(r[0]) === alt)) return;
        var q = +r[6] || 0;
        var to = r[5] ? up(r[5]) : '', from = r[4] && (r[7] === 'เบิก' || r[7] === 'ขาย') ? up(r[4]) : '';
        if (!to && !from) return;   // แถวที่ไม่เปลี่ยนยอด
        if (L && to !== L && from !== L) return;
        var din = to && (!L || to === L) ? q : 0, dout = from && (!L || from === L) ? q : 0;
        var kind = din && dout ? 'move' : din ? 'in' : dout ? 'out' : to && from ? 'move' : to ? 'in' : 'out';
        var delta = r3(din - dout);
        bal = r3(bal + delta);
        if (kind === 'in') inQ = r3(inQ + q);
        if (kind === 'out') outQ = r3(outQ + q);
        rows.push({
          no: d.no, seq: d.seq, date: d.date || '', type: d.type, kind: kind,
          lot: text(r[2]), po: text(r[3]), from: text(r[4]), to: text(r[5]), qty: r3(q), delta: delta, bal: bal,
          who: d.name || '', note: text(r[8]), open: text(r[9]) === 'เปิด', voided: !!vd[d.no], rev: d.type === C.TYPE_REV,
        });
      });
    });
    return { rows: rows, bal: bal, inQ: inQ, outQ: outQ, loc: L };
  }

  window.WmsFireItem = {
    ST_TH: ST_TH, KIND_TH: KIND_TH, CHIPS: CHIPS,
    index: index, search: search, detail: detail, card: card, qaLoc: qaLoc, ageOf: ageOf,
  };
})();
