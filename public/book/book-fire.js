/**
 * @file book-fire.js — ลองหน้าสมุดสต๊อกกับระบบใหม่ (WmsFire) บน dev server เท่านั้น
 *
 * เปิด http://localhost:5173/book/?fire=dev   ฐานจำลองเก็บใน localStorage ของเครื่องนี้ ไม่ต่อ Firebase จริง
 *      ?fire=reset  ล้างฐานทดลองแล้วเริ่มใหม่ (ลงยอดยกมาสมมติให้)
 * บัญชีทดลองเลือกชื่อแล้วกดเข้า ไม่ต้องใส่รหัส (ระบบจริงเข้าด้วย Google ของบริษัท)
 * เปิดสองแท็บได้ แท็บหนึ่งบันทึก อีกแท็บเห็นภายในหนึ่งนาที (หรือกดดึงสต๊อกใหม่)
 *
 * หน้าเว็บที่ deploy ไม่โหลดอะไรเพิ่ม: นอก localhost หรือไม่มี ?fire= ได้ window.BookFire = null
 * ข้อมูลทั้งหมดสมมติขึ้น
 */
(function () {
  'use strict';

  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var m = /[?&]fire=(dev|reset)(?:&|$)/.exec(location.search);
  if (!local || !m) { window.BookFire = null; return; }

  var KEY = 'wms:fire:dev';
  var IDB = 'wms-fire-dev';
  var DOMAIN = 'example.test';
  var ACCOUNTS = [
    { email: 'staff@' + DOMAIN, name: 'ทดลอง', role: 'staff' },
    { email: 'head@' + DOMAIN, name: 'หัวหน้าทดลอง', role: 'head' },
    { email: 'view@' + DOMAIN, name: 'ดูอย่างเดียวทดลอง', role: 'viewer' },
  ];
  /* ยอดยกมาสมมติ [SKU, SKU เต็ม, ชื่อ, LOT, PO, โล, ชิ้น, Status, วันรับ, ไตรมาส] */
  var OPEN = [
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'A-01-01', 20, 'เปิด', '2026-10-02', ''],
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'R01-01-01', 30, '', '2026-10-02', ''],
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '9', 'P2', 'A-01-02', 6, 'เปิด', '', 'Q3/26'],
    ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '7', 'P5', 'A-03-01', 12, 'เปิด', '2026-09-01', ''],
    ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '10', 'P9', 'R01-02-01', 24, '', '2026-10-20', ''],
    ['CCC004', 'CCC0000000004', 'หมอนสมมติ 4', '0', '0', 'QA', 3, '', '', ''],
    ['DDD005', 'DDD0000000005', 'ผ้าห่มสมมติ 5', '11', 'P7', 'A-05-01', 15, 'เปิด', '2026-11-03', ''],
  ];

  function script(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('โหลด ' + src + ' ไม่ได้')); };
      document.head.appendChild(s);
    });
  }
  function readSaved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(dump) { try { localStorage.setItem(KEY, JSON.stringify(dump)); } catch (e) { console.warn('เก็บฐานทดลองไม่ได้ —', e.message); } }

  var fire = null, shownSeq = -1;

  var ready = (async function () {
    await script('../wms-fire-core.js');
    await script('../wms-fire.js');
    var W = window.WmsFire;
    if (m[1] === 'reset') {
      try { localStorage.removeItem(KEY); } catch (e) {}
      try { await W.idbCache(IDB).clear(); } catch (e) {}
      history.replaceState(null, '', location.pathname + '?fire=dev' + location.hash);
    }
    var data = readSaved();
    if (!data) {
      data = {};
      ACCOUNTS.forEach(function (a) { data['users/' + a.email] = { name: a.name, role: a.role, active: true }; });
    }
    var store = W.memStore({ data: data, domain: DOMAIN, onCommit: save });
    save(store.dump());
    /* อีกแท็บบันทึก → ฐานในแท็บนี้ได้ของใหม่ (เครื่องนี้ดึงตอนเช็ครอบหน้า) */
    window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue) store.seed(JSON.parse(e.newValue)); });
    var cache;
    try { cache = window.indexedDB ? W.idbCache(IDB) : W.memCache(); } catch (e) { cache = W.memCache(); }
    fire = W.open({ store: store, auth: W.fakeAuth(ACCOUNTS), cache: cache });
    await fire.sync();
    if (!fire.local().meta) {
      await fire.login(ACCOUNTS[1].email);
      var r = await fire.post('bk-open', { batch: 'demo-open', rows: OPEN });
      if (r.error) console.warn('ลงยอดยกมาสมมติไม่ได้ —', r.error);
      await fire.logout();
    }
  })();

  /** op ที่บันทึกลงฐาน (หลังสำเร็จยอดในเครื่องเปลี่ยน) */
  function saves(op) { return !!(window.WmsFireCore && window.WmsFireCore.OPS[op]); }

  window.BookFire = {
    ready: ready,
    names: async function () { await ready; return ACCOUNTS.map(function (a) { return a.name; }); },
    /** bookPost ของหน้า: เข้าสมุดด้วยชื่อ (หน้าโหลดใหม่ เข้าให้เองจากชื่อที่จำไว้ในแท็บ) */
    post: async function (op, body, who) {
      await ready;
      if (op === 'bk-login' || (!fire.user() && who)) {
        var a = ACCOUNTS.filter(function (x) { return x.name === who; })[0];
        if (!a) return { error: 'ไม่มีชื่อนี้ในบัญชีทดลอง', v: window.WmsFireCore.API_V };
        var r = await fire.login(a.email);
        if (op === 'bk-login' || r.error) return r;
      }
      return fire.post(op, body);
    },
    saves: saves,
    /** คำตอบรูป tx-fifo จากสำเนาในเครื่อง (ดึงเอกสารใหม่ก่อน) */
    fifo: async function () {
      await ready;
      await fire.sync();
      shownSeq = fire.local().seq;
      return fire.fifo();
    },
    /** หลังบันทึกสำเร็จ: สำเนาในเครื่องรวมชุดใหม่แล้ว ไม่ต้องดึง */
    fifoNow: function () { shownSeq = fire.local().seq; return fire.fifo(); },
    /** มีเอกสารใหม่ที่หน้ายังไม่แสดงไหม */
    changed: async function () {
      await ready;
      await fire.sync();
      return fire.local().seq !== shownSeq;
    },
    logout: function () { if (fire) fire.logout(); },
    usage: function () { return fire ? fire.usage() : null; },
  };
})();
