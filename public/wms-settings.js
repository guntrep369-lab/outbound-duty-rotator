/**
 * @file wms-settings.js — ค่าที่ตั้งครั้งเดียวแล้วทั้งระบบใช้ร่วมกัน
 *
 * ก่อนหน้านี้ค่าพวกนี้อยู่ในหน้าที่บังเอิญเป็นคนใช้มันคนแรก: Apps Script URL อยู่
 * ในแท็บเทียบ Order, โลโก้บริษัทอยู่ในหน้าใบนำส่งสินค้า พอมีหน้าที่สองที่ต้องใช้
 * ค่าเดียวกัน ทางเลือกมีแค่ประกาศคีย์ซ้ำหรือ import ข้ามโมดูล ทั้งสองทางแย่
 *
 * ไฟล์นี้เป็นเจ้าของชื่อคีย์ทั้งหมดแต่ผู้เดียว หน้าไหนอยากอ่านหรือเขียนก็ผ่านตรงนี้
 *
 * คีย์สองตัวแรกขึ้นต้นด้วย orderapp_ ไม่ใช่ wms: เพราะตั้งไว้ตั้งแต่ก่อนระบบรวมเป็น
 * WMS — เปลี่ยนชื่อตอนนี้เท่ากับล้าง URL ที่ทุกเครื่องตั้งไว้แล้วโดยไม่ได้อะไรกลับมา
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsSettings
 */
(function () {
  'use strict';

  var KEYS = {
    orderUrl: 'orderapp_order_gas_url',
    stockUrl: 'orderapp_gas_url',
    logo:     'wms:transport:logo',
    transportUrl:   'wms:transport:url',
    transportToken: 'wms:transport:token',
    me:             'wms:me',
  };

  function read(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  /**
   * @returns {boolean} เขียนสำเร็จไหม — โหมดส่วนตัวหรือพื้นที่เต็มจะเขียนไม่ได้
   * และผู้เรียกต้องบอกผู้ใช้เอง ไม่ใช่ล้มเงียบแล้วให้ค่าหายตอนรีเฟรช
   */
  function write(key, value) {
    try {
      var v = String(value == null ? '' : value).trim();
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.WmsSettings = {
    KEYS: KEYS,

    /** Apps Script URL ของออเดอร์ — ใช้ทั้งแท็บเทียบ Order และหน้าค้นหาออเดอร์ */
    orderUrl: function () { return read(KEYS.orderUrl); },
    setOrderUrl: function (v) { return write(KEYS.orderUrl, v); },

    /** Apps Script URL ของสต๊อก — คนละ deployment กับออเดอร์ได้ */
    stockUrl: function () { return read(KEYS.stockUrl); },
    setStockUrl: function (v) { return write(KEYS.stockUrl, v); },

    /** โลโก้บริษัทเป็น data URL — ใช้บนใบนำส่งสินค้า */
    logo: function () { return read(KEYS.logo); },
    setLogo: function (v) { return write(KEYS.logo, v); },

    /**
     * Apps Script URL ของไฟล์รถบริษัทส่วนกลาง
     *
     * เป็นคนละ deployment กับออเดอร์และสต๊อกเสมอ ไม่ใช่ URL เดียวกัน: ทั้งสองตัวนั้น
     * ผูกกับชีตของตัวเองและใช้ doGet ของตัวเองไปแล้ว ซึ่ง Apps Script มีได้
     * โปรเจกต์ละตัว — ตัวนี้จึงอยู่ในชีตแยกของมันเอง (ดู transport-api.gs)
     */
    transportUrl: function () { return read(KEYS.transportUrl); },
    setTransportUrl: function (v) { return write(KEYS.transportUrl, v); },

    /** รหัสสั้น ๆ ที่ต้องตรงกับ TRANSPORT_TOKEN ใน Apps Script — เว้นว่างได้ */
    transportToken: function () { return read(KEYS.transportToken); },
    setTransportToken: function (v) { return write(KEYS.transportToken, v); },

    /**
     * ชื่อคนที่ใช้เครื่องนี้ — ติดไปกับไฟล์ที่บันทึกขึ้นส่วนกลาง
     *
     * ไม่ใช่การล็อกอินและไม่ได้กันอะไร แค่ให้เด็กคลังที่มาเลือกไฟล์รู้ว่าใครอัปมา
     * ไฟล์สองไฟล์ของวันเดียวกันจะได้ไม่ต้องเดาว่าอันไหนคือตัวจริง
     */
    me: function () { return read(KEYS.me); },
    setMe: function (v) { return write(KEYS.me, v); },

    // ══════════════════════════════════════════════════════════════════
    // สำรอง / กู้คืน
    //
    // ทุกอย่างที่ตั้งไว้อยู่ในเบราว์เซอร์เครื่องเดียว ไม่มีเซิร์ฟเวอร์เก็บให้
    // เปิดเครื่องใหม่ = ตั้งใหม่ทั้งหมดด้วยมือ ล้าง cache = หายเหมือนกัน
    // และที่หนักคือรายชื่อสินค้า 1,500 กว่ารายการกับรายชื่อผู้ใช้ ซึ่งกู้เองไม่ได้
    // ══════════════════════════════════════════════════════════════════

    /**
     * คีย์ที่ห้ามใส่ในไฟล์สำรอง
     *
     * session คือการล็อกอินของคนที่กดสำรอง ไม่ใช่การตั้งค่า — ใส่ไปแล้วใครเอาไฟล์
     * ไปกู้ก็จะกลายเป็นล็อกอินเป็นคนนั้นทันที
     * ส่วน orders/stock/transport:file เป็นข้อมูลของวัน กู้ข้ามวันมาแล้วอันตราย
     *
     * wms:me คือชื่อคนที่นั่งเครื่องนี้ ไม่ใช่การตั้งค่าของระบบ — เอาไฟล์ไปกู้อีกเครื่อง
     * แล้วไฟล์ที่อัปจากเครื่องนั้นจะขึ้นชื่อคนอื่น ซึ่งแย่กว่าไม่มีชื่อเลย เพราะเด็กคลัง
     * ที่มาเลือกไฟล์จะเชื่อชื่อที่เห็น
     */
    SKIP: ['wms:session', 'wms:orders', 'wms:stock', 'wms:transport:file', 'wms:me'],

    /**
     * ไฟล์สำรองแยกเป็นสองชนิด ตามสิ่งที่ "หลุดแล้วเสียหายต่างกัน"
     *
     * KEY  — กุญแจ: Apps Script URL ทั้งสามตัว, รหัสเขียนไฟล์รถ, และรายชื่อผู้ใช้
     *   พร้อมรหัสเข้าระบบ ใครได้ไฟล์นี้ไปอ่านออเดอร์ได้ทั้งหมด รวมชื่อ ที่อยู่
     *   เบอร์โทรลูกค้าทุกคน และเขียนทับรายการจัดส่งที่เด็กคลังจะทำตามได้ด้วย
     *   ไฟล์นี้เท่ากับสิทธิ์เข้าถึงระบบ ไม่ใช่แค่การตั้งค่า
     *
     * DATA — ข้อมูลอ้างอิง: รายชื่อสินค้า คู่รหัสขาย↔แถม โลโก้ เป็นของภายในบริษัท
     *   แต่ไม่ได้เปิดประตูอะไรให้ใคร ส่งให้เพื่อนร่วมทีมตั้งเครื่องใหม่ได้โดยไม่ต้อง
     *   ยื่นกุญแจไปด้วย ซึ่งเป็นเหตุผลทั้งหมดที่แยกสองไฟล์
     *
     * แยกด้วยรายการที่เขียนไว้ตรง ๆ ไม่ใช่กฎอัตโนมัติ เพราะการเดาผิดข้างเดียว
     * แปลว่ากุญแจหลุดไปอยู่ในไฟล์ที่คนตั้งใจส่งต่อ — คีย์ใหม่ที่ไม่ได้อยู่ในรายการ
     * จะถูกนับเป็น KEY ไว้ก่อนเสมอ
     */
    DATA_KEYS: ['wms:wh:sku', 'wms:sku:names', 'wms:transport:logo'],

    /** @returns {'key'|'data'} คีย์นี้อยู่ไฟล์ไหน */
    kindOf: function (k) {
      return window.WmsSettings.DATA_KEYS.indexOf(k) === -1 ? 'key' : 'data';
    },

    /**
     * เก็บทุกคีย์ที่เป็นการตั้งค่า ไม่ใช่รายการที่เขียนไว้ตายตัว
     * — ถ้าเขียนรายชื่อไว้ พอมีการตั้งค่าใหม่เพิ่มทีหลังมันจะไม่ถูกสำรองโดยไม่มีใครรู้
     *   จนถึงวันที่ต้องกู้จริง
     */
    exportAll: function (kind) {
      var self = window.WmsSettings, data = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!/^(wms:|orderapp_)/.test(k)) continue;
          if (self.SKIP.some(function (p) { return k === p || k.indexOf(p) === 0; })) continue;
          if (kind && self.kindOf(k) !== kind) continue;
          data[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return {
        app: 'WMS Management by gun',
        kind: 'settings-backup',
        /* part บอกว่าไฟล์นี้เป็นชนิดไหน ไฟล์เก่าที่ไม่มีช่องนี้ = ไฟล์รวมแบบเดิม
           ยังกู้คืนได้ตามปกติ ไม่งั้นไฟล์ที่ทุกคนเก็บไว้จะใช้ไม่ได้ทันทีที่อัปเดต */
        part: kind || 'all',
        at: Date.now(), data: data,
      };
    },

    /** สรุปว่าในไฟล์/ในเครื่องมีอะไรบ้าง ใช้ให้คนดูก่อนกดทับ */
    describe: function (data) {
      var d = data || {};
      var users = 0, skus = 0;
      try { users = (JSON.parse(d['wms:users'] || '[]') || []).length; } catch (e) {}
      try { skus = ((JSON.parse(d['wms:wh:sku'] || 'null') || {}).items || []).length; } catch (e) {}
      var names = 0;
      try { names = Object.keys((JSON.parse(d['wms:sku:names'] || 'null') || {}).names || {}).length; } catch (e) {}
      return {
        orderUrl: !!d[KEYS.orderUrl], stockUrl: !!d[KEYS.stockUrl],
        transportUrl: !!d[KEYS.transportUrl], logo: !!d[KEYS.logo],
        token: !!d[KEYS.transportToken],
        users: users, skus: skus, names: names,
        /* มีกุญแจอยู่ในไฟล์ไหม — ใช้เตือนตอนคนกำลังจะส่งไฟล์ต่อ */
        hasKeys: Object.keys(d).some(function (k) { return window.WmsSettings.kindOf(k) === 'key'; }),
        others: Object.keys(d).filter(function (k) {
          return [KEYS.orderUrl, KEYS.stockUrl, KEYS.transportUrl, KEYS.logo,
                  'wms:users', 'wms:wh:sku'].indexOf(k) === -1;
        }).length,
        keys: Object.keys(d).length,
      };
    },

    /**
     * เขียนทับของเดิมทั้งชุด — ผู้เรียกต้องให้คนยืนยันก่อน โดยเทียบกับ describe()
     * ของเครื่องปัจจุบันให้เห็นว่ากำลังทับอะไรอยู่
     * @returns {{ok:boolean, written?:number, error?:string}}
     */
    /**
     * เขียนทับเฉพาะคีย์ที่มีอยู่ในไฟล์ คีย์อื่นในเครื่องไม่ถูกแตะ
     *
     * สำคัญตอนแยกสองไฟล์: กู้ไฟล์ข้อมูลสินค้าแล้ว URL กับรายชื่อผู้ใช้ในเครื่อง
     * ต้องอยู่ครบเหมือนเดิม ไม่ใช่หายไปเพราะไฟล์นั้นไม่มีมันอยู่
     */
    importAll: function (file) {
      if (!file || file.kind !== 'settings-backup' || !file.data || typeof file.data !== 'object') {
        return { ok: false, error: 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ' };
      }
      var self = window.WmsSettings, n = 0;
      try {
        for (var k in file.data) {
          if (!/^(wms:|orderapp_)/.test(k)) continue;
          if (self.SKIP.some(function (p) { return k === p || k.indexOf(p) === 0; })) continue;
          localStorage.setItem(k, String(file.data[k]));
          n++;
        }
      } catch (e) {
        return { ok: false, error: 'เขียนไม่ได้ — พื้นที่เต็มหรือโหมดส่วนตัว (กู้ไปแล้ว ' + n + ' รายการ)' };
      }
      return { ok: true, written: n };
    },
  };
})();
