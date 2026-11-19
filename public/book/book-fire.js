/**
 * @file book-fire.js — ลองหน้าสมุดสต๊อกกับระบบใหม่ (WmsFire) บน dev server เท่านั้น
 *
 * เปิด http://localhost:5173/book/?fire=dev   ฐานจำลองเก็บใน localStorage ของเครื่องนี้ ไม่ต่อ Firebase จริง
 *      ?fire=reset  ล้างฐานทดลองแล้วเริ่มใหม่ (ลงยอดยกมาสมมติให้)
 * กดเข้าสู่ระบบแล้วได้หน้าต่างเลือกบัญชีทดลองแทนป๊อปอัป Google (ระบบจริงเข้าด้วย Google ของบริษัท)
 * มีบัญชีนอกโดเมน บัญชีที่ยังไม่ถูกเพิ่ม และบัญชีที่ปิดแล้ว ไว้ลองว่าถูกกันจริง
 * เปิดสองแท็บได้ แท็บหนึ่งบันทึก อีกแท็บเห็นภายในหนึ่งนาที (หรือกดดึงสต๊อกใหม่)
 * ขั้น 3: แท็บ 🔁 TRcloud (รอลง กระทบยอด นำเข้า) · ตั้งค่า › ชีตเดิม / สำรอง · กู้คืนจากไฟล์สำรองได้เฉพาะฐานทดลองนี้
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
  var WHO = 'wms:fire:dev:who';       // บัญชีที่เข้าค้างไว้ (แบบ Google จำการเข้าในเบราว์เซอร์)
  var METER = 'wms:fire:dev:meter';   // ตัวนับโควตาของเครื่องนี้
  var IDB = 'wms-fire-dev';
  var DOMAIN = 'example.test';
  var ACCOUNTS = [
    { email: 'staff@' + DOMAIN, name: 'ทดลอง', role: 'staff' },
    { email: 'head@' + DOMAIN, name: 'หัวหน้าทดลอง', role: 'head' },
    { email: 'view@' + DOMAIN, name: 'ดูอย่างเดียวทดลอง', role: 'viewer' },
    { email: 'off@' + DOMAIN, name: 'ออกแล้วทดลอง', role: 'staff', off: true },
    { email: 'new@' + DOMAIN, name: 'คนใหม่ทดลอง', role: '' },
    { email: 'someone@gmail.test', name: 'บัญชีส่วนตัวทดลอง', role: '' },
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
  function remember(email) { try { if (email) localStorage.setItem(WHO, email); else localStorage.removeItem(WHO); } catch (e) {} }
  function remembered() { try { return localStorage.getItem(WHO) || ''; } catch (e) { return ''; } }

  var fire = null, shownSeq = -1;

  var ready = (async function () {
    await script('../wms-fire-core.js');
    await script('../wms-fire-trc.js');
    await script('../wms-fire.js');
    var W = window.WmsFire;
    if (m[1] === 'reset') {
      [KEY, WHO, METER].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      try { await W.idbCache(IDB).clear(); } catch (e) {}
      history.replaceState(null, '', location.pathname + '?fire=dev' + location.hash);
    }
    var data = readSaved();
    if (!data) {
      data = {};
      ACCOUNTS.forEach(function (a) { if (a.role) data['users/' + a.email] = { name: a.name, role: a.role, active: !a.off }; });
    }
    var store = W.memStore({ data: data, domain: DOMAIN, onCommit: save });
    save(store.dump());
    /* อีกแท็บบันทึก → ฐานในแท็บนี้ได้ของใหม่ (เครื่องนี้ดึงตอนเช็ครอบหน้า) */
    window.addEventListener('storage', function (e) { if (e.key === KEY && e.newValue) store.seed(JSON.parse(e.newValue)); });
    var cache;
    try { cache = window.indexedDB ? W.idbCache(IDB) : W.memCache(); } catch (e) { cache = W.memCache(); }
    fire = W.open({ store: store, auth: W.fakeAuth(ACCOUNTS), cache: cache, domain: DOMAIN, meter: W.storeMeter(METER) });
    if (!store.dump()['meta/head']) {
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
    dev: true,
    domain: DOMAIN,
    /** บัญชีให้เลือกในหน้าต่างทดลอง (แทนหน้าต่างเลือกบัญชีของ Google) */
    accounts: function () { return ACCOUNTS.map(function (a) { return { email: a.email, name: a.name }; }); },
    /** เปิดหน้าใหม่: เข้าด้วยบัญชีที่ค้างไว้ · ไม่มี = null */
    restore: async function () {
      await ready;
      var e = remembered();
      if (!e) return null;
      var r = await fire.login(e);
      if (r.error) remember('');
      return r;
    },
    signIn: async function (email) {
      await ready;
      var r = await fire.login(email);
      remember(r.error ? '' : email);
      return r;
    },
    logout: function () { remember(''); if (fire) fire.logout(); },
    user: function () { return fire ? fire.user() : null; },
    post: async function (op, body) { await ready; return fire.post(op, body); },
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
    users: async function () { await ready; return fire.users(); },
    saveUser: async function (email, data) { await ready; return fire.saveUser(email, data); },
    quota: async function () { await ready; return fire.quota(); },
    /** ล้างสำเนาเครื่องนี้แล้วดึงใหม่ทั้งหมด */
    reload: async function () { await ready; await fire.reload(); shownSeq = fire.local().seq; return fire.fifo(); },
    /** ขนาดสำเนาในเครื่อง { docs, seq, piles } */
    copy: function () {
      if (!fire) return null;
      var l = fire.local();
      return { docs: l.docs.length, seq: l.seq, piles: Object.keys(l.piles || {}).length };
    },
    usage: function () { return fire ? fire.usage() : null; },
    /* ขั้น 3 */
    trList: async function () { await ready; return fire.trList(); },
    trSave: async function (items) { await ready; return fire.trSave(items); },
    trFile: function (nos) { return fire.trFile(nos); },
    trc: async function () { await ready; return fire.trc(); },
    trcSave: async function (parsed, day, files) { await ready; return fire.trcSave(parsed, day, files); },
    masterSave: async function (kind, part) { await ready; return fire.masterSave(kind, part); },
    masters: function () { return fire ? fire.masters() : {}; },
    xferDays: async function () { await ready; return fire.xferDays(); },
    xferText: function (day, after) { return fire.xferText(day, after); },
    xferMark: async function (day, info) { await ready; return fire.xferMark(day, info); },
    backup: async function () { await ready; return fire.backup(); },
    /**
     * กู้คืนจากไฟล์สำรองลงฐานทดลอง (ล้างของเดิมทั้งหมด) แล้วโหลดหน้าใหม่ ต้องเข้าระบบใหม่ด้วยรายชื่อในไฟล์
     * ระบบจริงกู้คืนด้วย apps-script/fire-backup.gs (สิทธิ์เจ้าของโปรเจกต์ ลงโปรเจกต์ว่าง)
     */
    restoreDev: async function (text) {
      await ready;
      var r = window.WmsFireTrc.readBackup(text);
      if (r.error) return r;
      save(r.backup.data);
      try { await window.WmsFire.idbCache(IDB).clear(); } catch (e) {}
      remember('');
      return { ok: 1, docs: Object.keys(r.backup.data).filter(function (p) { return /^docs\/[^~]+$/.test(p); }).length };
    },
  };
})();
