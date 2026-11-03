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
 * จำนวนที่พิมพ์เป็นข้อความไม่ถูกบวก ให้ตรงกับ SUMIFS ในชีตยอดและยอดในแท็บเทียบรายวัน
 * แต่ติดป้ายไว้ให้เห็นว่ามีแถวที่ยอดหายไป
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsLotPo
 */
(function () {
  'use strict';

  var HEAD = ['วันที่', 'SKU', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'];

  /** LOT 0 คือไม่รู้ล็อต (ของที่ลงไว้ตอนนับสต๊อกก่อนเริ่มแยกล็อต) ช่องว่างก็ไม่รู้เหมือนกัน */
  function noLot(v) { return v === '' || +v === 0; }
  function noPo(v) { return /^0*$/.test(v); }

  /** ล็อตเลขน้อยคือของเก่า 0.11 คือล็อต 11 ของปีก่อน เรียงตามตัวเลขได้ตรง ล็อตที่ไม่รู้ไปท้ายสุด */
  function lotNo(r) {
    var n = parseFloat(r.lot);
    return r.noLot || isNaN(n) ? Infinity : n;
  }

  function text(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function build(ledger) {
    var at = {}, rows = [];
    var days = ledger.days || [], skus = ledger.skus || [], locs = ledger.locs || [];
    (ledger.lines || []).forEach(function (l) {
      var date = days[l[0]], s = skus[l[1]] || [];
      var lot = text(l[4]), po = text(l[5]);
      /* พิมพ์เล็กใหญ่ต่างกันคือล็อตเดียวกัน เหมือนที่ชีตยอดใช้ SUMIFS */
      var k = [date, s[0], lot.toUpperCase(), po.toUpperCase()].join('|');
      var r = at[k];
      if (!r) {
        r = at[k] = { date: date, sku: s[0] || '', name: s[1] || '', lot: lot, po: po, qty: 0,
          rows: [], locs: [], bad: [], noLot: noLot(lot), noPo: noPo(po), split: 1 };
        rows.push(r);
      }
      if (typeof l[6] === 'number') r.qty += l[6]; else r.bad.push(text(l[6]));
      r.rows.push(l[2]);
      var loc = locs[l[3]];
      if (loc && r.locs.indexOf(loc) < 0) r.locs.push(loc);
    });

    /* วันเดียวกัน SKU เดียวกันออกมากี่ LOT/PO บัญชีต้องแบ่งต้นทุนตามนี้ */
    var n = {};
    rows.forEach(function (r) { n[r.date + '|' + r.sku] = (n[r.date + '|' + r.sku] || 0) + 1; });
    rows.forEach(function (r) { r.split = n[r.date + '|' + r.sku]; });

    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
      var la = lotNo(a), lb = lotNo(b);
      if (la !== lb) return la < lb ? -1 : 1;
      return a.po < b.po ? -1 : a.po > b.po ? 1 : 0;
    });
    return rows;
  }

  function totals(rows) {
    /* split นับเป็น SKU ต่อวัน splitLines นับเป็นบรรทัด ตัวหลังเท่ากับจำนวนที่ตัวกรอง split ได้ */
    var t = { qty: 0, lines: rows.length, skus: 0, split: 0, splitLines: 0, unknown: { lines: 0, qty: 0 }, bad: 0 };
    var sku = {}, split = {};
    rows.forEach(function (r) {
      t.qty += r.qty;
      sku[r.sku] = 1;
      if (r.split > 1) { split[r.date + '|' + r.sku] = 1; t.splitLines++; }
      if (r.noLot || r.noPo) { t.unknown.lines++; t.unknown.qty += r.qty; }
      t.bad += r.bad.length;
    });
    t.skus = Object.keys(sku).length;
    t.split = Object.keys(split).length;
    return t;
  }

  /**
   * only: '' ทั้งหมด | 'split' SKU ที่ออกหลาย LOT/PO ในวันเดียว | 'unknown' ไม่รู้ LOT หรือ PO
   * q ค้นใน SKU ชื่อ LOT PO ไม่สนตัวพิมพ์เล็กใหญ่
   */
  function filter(rows, o) {
    var q = text(o && o.q).toUpperCase(), date = o && o.date, only = o && o.only;
    return rows.filter(function (r) {
      if (date && r.date !== date) return false;
      if (only === 'split' && r.split < 2) return false;
      if (only === 'unknown' && !r.noLot && !r.noPo) return false;
      if (!q) return true;
      return [r.sku, r.name, r.lot, r.po].some(function (v) { return v.toUpperCase().indexOf(q) >= 0; });
    });
  }

  function note(r) {
    var out = [];
    if (r.noLot && r.noPo) out.push('ไม่รู้ LOT และ PO');
    else if (r.noLot) out.push('ไม่รู้ LOT');
    else if (r.noPo) out.push('ไม่รู้ PO');
    if (r.bad.length) out.push('จำนวนพิมพ์ไม่ใช่ตัวเลข ' + r.bad.length + ' แถว ไม่ได้นับ');
    return out.join(' · ');
  }

  /** ตารางเรียบ ๆ ทุกบรรทัดมี SKU ครบ วางใน Excel แล้วกรองหรือทำ Pivot ต่อได้ทันที */
  function table(rows) {
    return [HEAD].concat(rows.map(function (r) {
      return [r.date, r.sku, r.name, r.lot, r.po, r.qty, note(r)];
    }));
  }

  /** ช่องที่ขึ้นต้นด้วย = + @ Excel จะอ่านเป็นสูตร ใส่ ' นำหน้าให้เป็นข้อความ */
  function cell(v) {
    if (typeof v === 'number') return v;
    var s = String(v).replace(/[\t\r\n]+/g, ' ');
    return /^[=+@]/.test(s) || /^-\D/.test(s) ? "'" + s : s;
  }

  function tsv(rows) {
    return table(rows).map(function (l) { return l.map(cell).join('\t'); }).join('\n');
  }

  /** ใส่ BOM ไว้หน้าไฟล์ ไม่งั้น Excel เปิดแล้วภาษาไทยเป็นตัวอ่านไม่ออก */
  function csv(rows) {
    return '﻿' + table(rows).map(function (l) {
      return l.map(function (v) {
        var s = String(cell(v));
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  window.WmsLotPo = { HEAD: HEAD, build: build, totals: totals, filter: filter, note: note, table: table, tsv: tsv, csv: csv };
})();
