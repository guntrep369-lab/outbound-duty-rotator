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
     */
    SKIP: ['wms:session', 'wms:orders', 'wms:stock', 'wms:transport:file'],

    /**
     * เก็บทุกคีย์ที่เป็นการตั้งค่า ไม่ใช่รายการที่เขียนไว้ตายตัว
     * — ถ้าเขียนรายชื่อไว้ พอมีการตั้งค่าใหม่เพิ่มทีหลังมันจะไม่ถูกสำรองโดยไม่มีใครรู้
     *   จนถึงวันที่ต้องกู้จริง
     */
    exportAll: function () {
      var self = window.WmsSettings, data = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!/^(wms:|orderapp_)/.test(k)) continue;
          if (self.SKIP.some(function (p) { return k === p || k.indexOf(p) === 0; })) continue;
          data[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return { app: 'WMS Management by gun', kind: 'settings-backup', at: Date.now(), data: data };
    },

    /** สรุปว่าในไฟล์/ในเครื่องมีอะไรบ้าง ใช้ให้คนดูก่อนกดทับ */
    describe: function (data) {
      var d = data || {};
      var users = 0, skus = 0;
      try { users = (JSON.parse(d['wms:users'] || '[]') || []).length; } catch (e) {}
      try { skus = ((JSON.parse(d['wms:wh:sku'] || 'null') || {}).items || []).length; } catch (e) {}
      return {
        orderUrl: !!d[KEYS.orderUrl], stockUrl: !!d[KEYS.stockUrl], logo: !!d[KEYS.logo],
        users: users, skus: skus,
        others: Object.keys(d).filter(function (k) {
          return [KEYS.orderUrl, KEYS.stockUrl, KEYS.logo, 'wms:users', 'wms:wh:sku'].indexOf(k) === -1;
        }).length,
        keys: Object.keys(d).length,
      };
    },

    /**
     * เขียนทับของเดิมทั้งชุด — ผู้เรียกต้องให้คนยืนยันก่อน โดยเทียบกับ describe()
     * ของเครื่องปัจจุบันให้เห็นว่ากำลังทับอะไรอยู่
     * @returns {{ok:boolean, written?:number, error?:string}}
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
