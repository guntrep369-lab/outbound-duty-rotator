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
  };
})();
