/**
 * @file wms-stock.js — สต๊อกของวันนี้ กติกาและตัวเลขทั้งหมดอยู่ที่นี่ที่เดียว
 *
 * WHY: ก่อนหน้านี้ทั้งเลข "เหลือน้อย" และกฎ "ต้องเบิก QA" เขียนฝังอยู่ในแท็บ
 * เช็คสต๊อกของโมดูลเทียบ Order พอมีหน้าสต๊อกทั้งคลังเพิ่มมาอีกหน้า ตัวเลขเดียวกัน
 * จะอยู่สองที่ทันที และแบบที่เจอมาหลายรอบในโปรเจกต์นี้แล้วคือแก้ที่หนึ่งลืมอีกที่
 * แล้วสองหน้าจะบอกคนละเรื่องเกี่ยวกับของกล่องเดียวกัน
 *
 * แท็บเช็คสต๊อกกับหน้าสต๊อกตอบคนละคำถามกันโดยตั้งใจ:
 *   • เช็คสต๊อก (ในเทียบ Order) — "ของที่สั่งวันนี้ มีพอไหม" มองผ่านออเดอร์วันนี้
 *   • หน้าสต๊อก                  — "ทั้งคลังตอนนี้เป็นยังไง" ไม่สนว่าวันนี้มีใครสั่ง
 * ข้อมูลชุดเดียวกัน คนละมุม จึงต้องแชร์ทั้งตัวดึง ตัวแปลง แคช และกติกา
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsStock (ต้องโหลด wms-gas.js ก่อน)
 */
(function () {
  'use strict';

  /**
   * ต่ำกว่านี้ถือว่าเหลือน้อย
   *
   * เป็นจำนวนชิ้นตรง ๆ ตามที่ทีมใช้จริง ไม่ใช่สัดส่วนของยอดที่สั่งวันนี้แบบเดิม
   * (need × 1.5) เพราะเกณฑ์แบบสัดส่วนทำให้ของที่เหลือ 3 ชิ้นแต่วันนี้สั่ง 1 ชิ้น
   * ขึ้นว่า "พอ" ทั้งที่พรุ่งนี้ก็หมดแล้ว
   */
  var LOW_QTY = 10;

  /**
   * ต้องไปเบิกจากคลัง QA ไหม
   *
   * ของกองอยู่ที่ QA มากกว่าที่ NEW WH แปลว่าที่หน้าคลังหยิบไม่พอ ต้องไปขนมา
   * ไม่ได้ดูยอดรวม เพราะยอดรวมพออาจแปลว่าของอยู่ผิดที่ทั้งกอง
   */
  function needsQa(s) {
    return !!s && s.qa > s.newwh;
  }

  /* ── แปลงข้อมูลที่ Apps Script ตอบมา ─────────────────────────────────── */

  var DESC_RE = /desc|ชื่อสินค้า|ชื่อ|รายละเอียด|product\s*name|item\s*name|^name$/i;

  /**
   * JSON → { map, count }
   * รองรับสองรูปแบบ: { headers, rows } ของสคริปต์เรา และ array of objects
   * @returns {{map:Object, count:number}} map คือ sku → {sku,description,qa,newwh,total}
   */
  function parse(json) {
    if (json && json.error) throw new Error('Apps Script error: ' + json.error);

    var map = {};
    var count = 0;

    if (Array.isArray(json)) {
      json.forEach(function (r) {
        var keys = Object.keys(r);
        var skuKey  = keys.find(function (k) { return /^sku$/i.test(k.trim()); });
        var descKey = keys.find(function (k) { return k !== skuKey && DESC_RE.test(k); });
        var qaKey   = keys.find(function (k) { return /\bqa\b/i.test(k); });
        var nwKey   = keys.find(function (k) { return /new.*wh|คลัง\s*new/i.test(k); });
        var totKey  = keys.find(function (k) { return /total/i.test(k); });
        if (!skuKey) return;
        var sku = String(r[skuKey] || '').trim();
        if (!sku) return;
        map[sku] = {
          sku: sku,
          description: descKey ? String(r[descKey] || '') : '',
          qa:    parseFloat(r[qaKey]  || 0) || 0,
          newwh: parseFloat(r[nwKey]  || 0) || 0,
          total: parseFloat(r[totKey] || 0) || 0,
        };
        count++;
      });
    } else if (json && json.headers && json.rows) {
      var h = json.headers.map(function (x) { return String(x).toLowerCase().replace(/\s/g, ''); });
      var iSku  = h.findIndex(function (x) { return /^sku$/.test(x); });
      var iDesc = h.findIndex(function (x, i) { return i !== iSku && DESC_RE.test(x); });
      var iQA   = h.findIndex(function (x) { return /\bqa\b/.test(x); });
      var iNW   = h.findIndex(function (x) { return x.indexOf('new') >= 0 || (x.indexOf('wh') >= 0 && !/qa/.test(x)); });
      var iTot  = h.findIndex(function (x) { return x.indexOf('total') >= 0; });
      if (iSku < 0) throw new Error('ไม่พบคอลัมน์ SKU ใน headers: [' + json.headers.join(', ') + ']');
      json.rows.forEach(function (row) {
        var sku = String(row[iSku] || '').trim();
        if (!sku) return;
        map[sku] = {
          sku: sku,
          description: iDesc >= 0 ? String(row[iDesc] || '') : '',
          qa:    parseFloat(row[iQA]  || 0) || 0,
          newwh: parseFloat(row[iNW]  || 0) || 0,
          total: parseFloat(row[iTot] || 0) || 0,
        };
        count++;
      });
    } else {
      throw new Error('รูปแบบไม่รองรับ — keys ที่ได้: [' + Object.keys(json || {}).join(', ') + ']');
    }

    if (!count) throw new Error('ไม่พบข้อมูล SKU ใน response');
    return { map: map, count: count };
  }

  /* ── แคชของรอบนี้ ───────────────────────────────────────────────────────
     sessionStorage ไม่ใช่ localStorage: สต๊อกเป็นตัวเลขของ "ตอนนี้" ปิดเบราว์เซอร์
     แล้วต้องหายไป ไม่งั้นพรุ่งนี้เปิดมาจะเห็นยอดเมื่อวานโดยไม่มีอะไรบอก */
  var KEY = 'wms:stock:today';

  /** @returns {{at:number, map:Object, source:string, url:string, filename:string}|null} */
  function read() {
    var o = null;
    try { o = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!o || !o.map || !Object.keys(o.map).length) return null;
    return o;
  }

  function save(map, at, meta) {
    try {
      if (!map || !Object.keys(map).length) return;
      var m = meta || {};
      sessionStorage.setItem(KEY, JSON.stringify({
        at: at || Date.now(), map: map,
        source: m.source || null, url: m.url || '', filename: m.filename || '',
      }));
    } catch (e) {
      console.warn('เก็บสต๊อกของวันนี้ไม่ได้ —', e.message);
    }
  }

  /** ดึง + แปลง + เก็บแคช สำหรับหน้าที่แค่อยากได้ข้อมูลมาแสดง */
  async function pull(url, opts) {
    var json = await window.WmsGas.json(url, 'stock', opts);
    var r = parse(json);
    var at = Date.now();
    save(r.map, at, { source: 'gas', url: url });
    return { map: r.map, count: r.count, at: at };
  }

  window.WmsStock = {
    LOW_QTY: LOW_QTY,
    KEY: KEY,
    needsQa: needsQa,
    parse: parse,
    read: read,
    save: save,
    pull: pull,

    /* URL เป็นของ WmsSettings — ที่นี่แค่ส่งต่อ เพื่อไม่ให้ชื่อคีย์อยู่สองไฟล์ */
    savedUrl: function () { return window.WmsSettings ? WmsSettings.stockUrl() : ''; },
    saveUrl: function (url) { if (window.WmsSettings) WmsSettings.setStockUrl(url); },
  };
})();
