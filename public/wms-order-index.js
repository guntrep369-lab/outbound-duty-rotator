/**
 * @file wms-order-index.js — ออเดอร์ของวันนี้ เก็บไว้ให้หน้าอื่นค้นได้ทันที
 *
 * แท็บเทียบ Order ดึงข้อมูลจาก Apps Script อยู่แล้ว และการดึงแต่ละครั้งใช้เวลา
 * หลายวินาที ถ้าหน้าค้นหาต้องดึงเองทุกครั้งที่มีคนโทรมาถาม คนรับสายจะรอสายเปล่า
 * ทุกครั้ง ทั้งที่ข้อมูลชุดเดียวกันเพิ่งถูกดึงไปแล้วเมื่อเช้า
 *
 * WHY sessionStorage: ออเดอร์เป็นของวันเดียว ปิดเบราว์เซอร์แล้วต้องหายไป —
 * ความเสียหายที่แท้จริงคือการตอบลูกค้าด้วยรอบเมื่อวานโดยไม่รู้ตัว ไม่ใช่การ
 * ต้องกดดึงใหม่
 *
 * โหลดเป็น classic script (หน้าที่ใช้ไม่ได้เป็น module) เปิดเป็น window.OrderIndex
 */
(function () {
  'use strict';

  var KEY = 'wms:orders:today';

  /**
   * ฟิลด์ที่เก็บ — เท่าที่หน้าค้นหาต้องใช้ตอบคำถามทางโทรศัพท์
   * ไม่เก็บทั้งแถวดิบ เพราะ sessionStorage มีเพดาน และของที่ไม่ได้ใช้
   * ก็คือของที่ไม่มีใครสังเกตว่ามันผิด
   */
  var FIELDS = ['orderID', 'consign', 'sup', 'customer', 'address', 'phone1', 'phone2',
                'brand', 'size', 'qty1', 'giftRaw', 'qtyRaw', 'payment', 'remark', 'date',
                'apptTime'];

  function pick(row) {
    var o = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var v = row[FIELDS[i]];
      if (v !== '' && v != null) o[FIELDS[i]] = v;
    }
    return o;
  }

  /**
   * แปลง carriersData ของแท็บเทียบ Order เป็นดัชนีค้นหา
   *
   * เก็บทั้งรอบเช้า (Logis) และ CRM แต่ติดป้ายบอกที่มา — ออเดอร์ที่มีแต่ใน CRM
   * คือออเดอร์ที่เพิ่งเพิ่มเข้ามาหลังจัดรอบไปแล้ว ซึ่งเป็นคำตอบที่ต่างกันมาก
   * เวลาลูกค้าถามว่า "ของออกหรือยัง"
   *
   * @param {Array} carriersData [{ key, data1, data2 }]
   */
  function build(carriersData) {
    var rows = [];
    (carriersData || []).forEach(function (car) {
      var seen = Object.create(null);
      (car.data1 || []).forEach(function (r) {
        var o = pick(r); o.carrier = car.key; o.source = 'logis';
        if (r.orderID) seen[r.orderID] = true;
        rows.push(o);
      });
      // จาก CRM เอาเฉพาะออเดอร์ที่รอบเช้าไม่มี ไม่งั้นทุกออเดอร์จะขึ้นซ้ำสองครั้ง
      (car.data2 || []).forEach(function (r) {
        if (r.orderID && seen[r.orderID]) return;
        var o = pick(r); o.carrier = car.key; o.source = 'crm';
        rows.push(o);
      });
    });
    return rows;
  }


  // ══════════════════════════════════════════════════════════════════════
  // ดึงออเดอร์จาก Apps Script — ย้ายมาจากแท็บเทียบ Order เพื่อให้หน้าค้นหา
  // ดึงเองได้ด้วย โดยไม่ต้องมีตรรกะการดึงสองชุดที่ค่อย ๆ ต่างกัน
  // ══════════════════════════════════════════════════════════════════════


  /* ตัวยิง Apps Script ย้ายไปอยู่ wms-gas.js แล้ว เพราะโมดูลสต๊อกก็ต้องใช้ตัวเดียวกัน
     ห่อไว้ตรงนี้เพื่อให้ที่เรียก OrderIndex.withApi / .fetchWithRetry อยู่เดิมไม่พัง
     และเรียกผ่าน window ตอนใช้งานจริง ไม่ใช่ตอนโหลดไฟล์ ลำดับ <script> จึงไม่สำคัญ

     เรื่อง ?api=: order กับ stock อยู่ในโปรเจกต์ Apps Script เดียวกัน ซึ่งมี doGet
     ได้ตัวเดียว จึงรวมเป็น URL เดียวแล้วแยกงานด้วยพารามิเตอร์ — วาง URL เดียวกัน
     ได้ทั้งสองช่อง */
  function withApi(url, api) { return window.WmsGas.withApi(url, api); }
  function fetchWithRetry(url, opts) { return window.WmsGas.fetchWithRetry(url, opts); }

  /** ปีที่ทำให้วัน-เดือนนี้อยู่ใกล้วันนี้ที่สุด ใช้กับวันที่ที่ไม่ได้เขียนปีมา */
  function nearYear(month, day) {
    var now = new Date(), best = now.getFullYear(), gap = Infinity;
    for (var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) {
      var g = Math.abs(new Date(y, month, day).getTime() - now.getTime());
      if (g < gap) { gap = g; best = y; }
    }
    return best;
  }

  /** ค่าในช่องเวลานัด — "-" กับช่องว่างถือว่าไม่มี */
  function apptOf(v) {
    var t = String(v == null ? '' : v).trim();
    return /^-+$/.test(t) ? '' : t;
  }

  /** แถวดิบจากชีต → รูปแบบที่ทุกหน้าในระบบใช้ */
  function convertGASRows(rows) {
    return (rows || [])
      .filter(function (r) { return r['Order ID'] != null && String(r['Order ID']).trim() !== ''; })
      .map(function (r) {
        var keys = Object.keys(r);
        var qtyKeys = keys.filter(function (k) { return k.indexOf('จำนวน') === 0; });
        var qty1Key = qtyKeys[0] || 'จำนวน';
        var qty2Key = qtyKeys[1] || 'จำนวน_1';
        var rawD = r['Date'] || r['date'] || '';
        var dateStr = '';
        if (rawD) {
          var d = new Date(rawD);
          /* ใช้ส่วนประกอบแบบเวลาท้องถิ่น ไม่ใช่ toISOString ซึ่งลบ 7 ชั่วโมงออกแล้ว
             ทำให้ "Mon, Aug 17" ในชีตกลายเป็นวันที่ 16 — เลื่อนไปหนึ่งวันเงียบ ๆ */
          if (isNaN(d)) dateStr = String(rawD).slice(0, 10);
          else {
            var pad = function (n) { return String(n).padStart(2, '0'); };
            /* ชีตเขียนวันที่เป็น "Mon, Aug 17" ซึ่งไม่มีปี ตัวแปลของ JS เติมให้เป็น
               2001 — ใส่ปีที่ใกล้วันนี้ที่สุดแทน (ข้ามปลายปีขึ้นปีใหม่ได้ด้วย) */
            var yr = /\d{4}/.test(String(rawD)) ? d.getFullYear()
                                                : nearYear(d.getMonth(), d.getDate());
            dateStr = yr + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
          }
        }
        return {
          orderID:  String(r['Order ID']   || '').trim(),
          consign:  String(r['เลข consign'] || r['เลขconsign'] || r['Consign'] || '').trim(),
          sup:      String(r['Sup']        || '').trim(),
          brand:    String(r['แบรนด์']     || '').trim(),
          size:     String(r['ขนาด']       || '').trim(),
          qty1:     r[qty1Key] != null ? r[qty1Key] : 1,
          giftRaw:  String(r['ของแถม']    || '').trim(),
          qtyRaw:   r[qty2Key] != null ? String(r[qty2Key]).trim() : '',
          customer: String(r['ชื่อลูกค้า'] || '').trim(),
          address:  String(r['ที่อยู่']     || '').trim(),
          phone1:   String(r['Phone 1']    || '').trim(),
          phone2:   String(r['Phone 2']    || '').trim(),
          payment:  String(r['การเงิน']    || '').trim(),
          remark:   String(r['หมายเหตุ']   || '').trim(),
          date:     dateStr,
          /* เวลานัดอยู่ในชีตออเดอร์อยู่แล้ว (คอลัมน์ "เวลานัด" ของหน้า Logis)
             ทีมกรอกไว้ที่แถวแรกของออเดอร์ แถวถัด ๆ ไปใส่ "-" ไว้ ไม่ใช่ปล่อยว่าง
             จึงต้องตัด "-" ทิ้ง ไม่งั้นจะได้ขีดไปแสดงแทนเวลา */
          apptTime: apptOf(r['เวลานัด'] || r['เวลา'] || ''),
        };
      });
  }

  /**
   * JSON ที่ Apps Script ตอบมา → carriersData
   * รองรับสองรูปแบบ: หลายขนส่ง { carriers:[…] } และแบบเก่าชุดเดียว { sheet1, sheet2 }
   */
  function parsePayload(json) {
    if (json && json.error) throw new Error(json.error);
    var out;
    if (json && json.carriers && Array.isArray(json.carriers)) {
      out = json.carriers.map(function (car) {
        return {
          key: car.key,
          data1: convertGASRows(car.sheet1 || []),
          data2: convertGASRows(car.sheet2 || []),
          error1: car.error1 || null,
          error2: car.error2 || null,
          /* v4: วันที่มาจากชีต ไม่ใช่จากปฏิทิน ทีมทำงานล่วงหน้าเป็นเรื่องปกติ
             จึงต้องรู้ให้ได้ว่ากำลังเทียบของวันไหนอยู่ และสองหน้าตรงวันกันไหม
             สคริปต์รุ่นเก่าไม่ส่งมา ค่าจะเป็น '' / null แล้วหน้าเว็บไม่แสดงอะไร */
          date: car.date || '',
          dates1: car.dates1 || [],
          dates2: car.dates2 || [],
          warn: car.warn || null,
        };
      });
    } else if (json && (json.sheet1 || json.sheet2)) {
      out = [{ key: 'ออเดอร์', data1: convertGASRows(json.sheet1 || []), data2: convertGASRows(json.sheet2 || []) }];
    } else {
      throw new Error('รูปแบบไม่รองรับ — keys: [' + Object.keys(json || {}).join(', ') + ']');
    }
    if (!out.length) throw new Error('ไม่พบข้อมูลขนส่ง');
    return out;
  }

  /** ดึง + แปลง + เก็บดัชนี ในขั้นตอนเดียว สำหรับหน้าที่ไม่ได้ทำอะไรกับข้อมูลดิบต่อ */
  async function pull(url, opts) {
    var resp = await fetchWithRetry(withApi(url, 'order'), opts);
    var text = await resp.text();
    var json;
    try { json = JSON.parse(text); }
    catch (e) { throw new Error('ข้อมูลไม่ใช่ JSON: ' + text.slice(0, 120)); }
    var carriers = parsePayload(json);
    window.OrderIndex.save(carriers);
    return carriers;
  }

  window.OrderIndex = {
    KEY: KEY,
    build: build,
    withApi: withApi,
    fetchWithRetry: fetchWithRetry,
    convertGASRows: convertGASRows,
    parsePayload: parsePayload,
    pull: pull,

    /* URL เป็นของ WmsSettings — ที่นี่แค่ส่งต่อ เพื่อไม่ให้ชื่อคีย์อยู่สองไฟล์ */
    savedUrl: function () { return window.WmsSettings ? WmsSettings.orderUrl() : ''; },
    saveUrl: function (url) { if (window.WmsSettings) WmsSettings.setOrderUrl(url); },

    /**
     * carriersData เต็มของรอบล่าสุด — แท็บเทียบ Order ใช้กู้สถานะคืนหลังรีเฟรชหน้า
     * โดยไม่ต้องยิง Apps Script ใหม่ ซึ่งกินเวลาเป็นสิบวินาทีทุกครั้ง
     */
    getCarriers: function () {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        var o = JSON.parse(raw);
        return o && Array.isArray(o.carriers) && o.carriers.length ? o : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * ดัชนีค้นหา สร้างจากของเต็มตอนอ่าน ไม่ได้เก็บซ้ำอีกชุด
     * @returns {{at:number, rows:Array}|null}
     */
    get: function () {
      var o = window.OrderIndex.getCarriers();
      if (!o) return null;
      var rows = build(o.carriers);
      return rows.length ? { at: o.at, rows: rows } : null;
    },

    /** เก็บข้อมูลของรอบนี้ไว้ให้หน้าอื่นและให้หน้านี้เองใช้ตอนรีเฟรช */
    save: function (carriersData) {
      try {
        if (!carriersData || !carriersData.length) return;
        sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), carriers: carriersData }));
      } catch (e) {
        // เต็มโควตาหรืออยู่ในโหมดส่วนตัว — แท็บเทียบ Order ยังทำงานได้ตามปกติ
        // หน้าค้นหาจะขอให้กดดึงเอง ไม่คุ้มที่จะขัดจังหวะใคร
        console.warn('OrderIndex: เก็บข้อมูลวันนี้ไม่ได้ —', e.message);
      }
    },

    clear: function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
    },
  };
})();
