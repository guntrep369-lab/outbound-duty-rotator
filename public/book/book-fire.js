/**
 * @file book-fire.js — หน้าสมุดสต๊อกกับระบบใหม่ (WmsFire) สามโหมด
 *
 *   live  ระบบจริง: Firestore + เข้าด้วย Google ของบริษัท ใช้เมื่อ wms-fire-config.js เปิดสวิตช์ (on: true) และใส่ config ครบ
 *         เครื่องเดียว: ?fire=off ใช้ระบบเดิมจนกว่าจะ ?fire=on · ?fire=live เปิดแม้สวิตช์ปิด (เฉพาะหัวหน้า ใช้ตอนถอยกลับ)
 *         ไม่ต่อบน localhost เด็ดขาด
 *   demo  โหมดซ้อมของทีม ?fire=demo (เว็บจริงหรือ dev server) ฐานจำลองใน localStorage ของเครื่องนี้ ไม่แตะฐานจริง
 *         เลือกบัญชีซ้อมแทนป๊อปอัป Google · ปุ่มออเดอร์ซ้อม · ?fire=demo-reset เริ่มซ้อมใหม่
 *   dev   ลองโค้ดบน dev server เท่านั้น ?fire=dev · ?fire=reset ล้างฐานทดลองแล้วเริ่มใหม่
 *         มีบัญชีนอกโดเมน บัญชีที่ยังไม่ถูกเพิ่ม บัญชีที่ปิดแล้ว ไว้ลองว่าถูกกันจริง
 *
 * ไม่เข้าโหมดไหน = window.BookFire = null หน้าใช้ Apps Script เดิมเหมือนก่อนมีระบบใหม่
 * ระบบจริงเทียบนาฬิกาเครื่องกับเวลาของเว็บ (หัว Date) ตอนเปิดและทุกชั่วโมง คลาดเกิน 30 วินาที = ใช้เวลาเว็บแทน
 * (เลขเอกสาร เวลาบันทึก วันที่ไม่ขึ้นกับนาฬิกาเครื่องที่ตั้งผิด)
 * ร่างงานที่วางค้างและชุดรอส่งของโหมดซ้อม/ทดลองเก็บแยก (ns) ไม่หลุดไปส่งเข้าระบบจริง
 * ข้อมูลซ้อมและข้อมูลทดลองสมมติขึ้นทั้งหมด
 */
(function () {
  'use strict';

  var CFG = window.WMS_FIRE_CONFIG || {};
  var OFF_KEY = 'wms:fire:off';   // เครื่องนี้ขอใช้ระบบเดิม (?fire=off) จนกว่าจะ ?fire=on

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  /** config ของ Firebase ครบพอจะต่อไหม */
  function cfgReady(c) {
    var f = (c && c.firebase) || {};
    return !!(c && c.domain && f.apiKey && f.authDomain && f.projectId && f.appId);
  }

  /**
   * เลือกโหมดจากที่อยู่เว็บ ?fire= สวิตช์ และค่าของเครื่อง → { mode: 'live'|'demo'|'dev'|'', reset, override }
   * เทสต์เรียกตรงผ่าน window.BookFireMode
   */
  function pickMode(host, search, cfg, off) {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);
    var m = /[?&]fire=(dev|reset|demo|demo-reset|live|off|on)(?:&|$)/.exec(search || '');
    var ask = m ? m[1] : '';
    if (ask === 'dev' || ask === 'reset') { if (local) return { mode: 'dev', reset: ask === 'reset' }; ask = ''; }   // นอก localhost ไม่สน
    if (ask === 'demo' || ask === 'demo-reset') return { mode: 'demo', reset: ask === 'demo-reset' };
    if (local || !cfgReady(cfg)) return { mode: '' };   // dev server ไม่ต่อของจริง · ยังไม่มี config = ระบบเดิม
    if (ask === 'live') return { mode: 'live', override: cfg.on !== true || !!off };
    if (ask === 'off' || (off && ask !== 'on')) return { mode: '' };
    return cfg.on === true ? { mode: 'live' } : { mode: '' };
  }
  window.BookFireMode = pickMode;

  var q = /[?&]fire=(off|on)(?:&|$)/.exec(location.search);
  if (q) lsSet(OFF_KEY, q[1] === 'off' ? '1' : '');
  var pick = pickMode(location.hostname, location.search, CFG, lsGet(OFF_KEY));
  if (!pick.mode) { window.BookFire = null; return; }
  var MODE = pick.mode;

  /* ── ค่าของแต่ละโหมด ── */
  var SET = {
    dev: { key: 'wms:fire:dev', idb: 'wms-fire-dev', domain: 'example.test', ns: 'dev', label: 'ฐานทดลอง' },
    demo: { key: 'wms:fire:demo', idb: 'wms-fire-demo', domain: 'demo.test', ns: 'demo', label: 'ฐานซ้อม' },
    live: { key: '', idb: 'wms-fire', domain: String(CFG.domain || '').toLowerCase(), ns: '', label: 'ระบบใหม่' },
  }[MODE];
  var KEY = SET.key, WHO = KEY + ':who', METER = MODE === 'live' ? 'wms:fire:meter' : KEY + ':meter', NO = KEY + ':no';
  var DOMAIN = SET.domain;

  var ACCOUNTS = MODE === 'dev' ? [
    { email: 'staff@' + DOMAIN, name: 'ทดลอง', role: 'staff' },
    { email: 'head@' + DOMAIN, name: 'หัวหน้าทดลอง', role: 'head' },
    { email: 'view@' + DOMAIN, name: 'ดูอย่างเดียวทดลอง', role: 'viewer' },
    { email: 'off@' + DOMAIN, name: 'ออกแล้วทดลอง', role: 'staff', off: true },
    { email: 'new@' + DOMAIN, name: 'คนใหม่ทดลอง', role: '' },
    { email: 'someone@gmail.test', name: 'บัญชีส่วนตัวทดลอง', role: '' },
  ] : MODE === 'demo' ? [
    { email: 'staff1@' + DOMAIN, name: 'พนักงานซ้อม 1', role: 'staff' },
    { email: 'staff2@' + DOMAIN, name: 'พนักงานซ้อม 2', role: 'staff' },
    { email: 'head@' + DOMAIN, name: 'หัวหน้าซ้อม', role: 'head' },
    { email: 'view@' + DOMAIN, name: 'ดูอย่างเดียวซ้อม', role: 'viewer' },
    { email: 'someone@gmail.test', name: 'บัญชีส่วนตัว (ลองว่าถูกกัน)', role: '' },
  ] : [];

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
  /* โหมดซ้อมมีของมากขึ้นให้ตัดได้ทั้งวัน (ยังเป็นของสมมติ) */
  if (MODE === 'demo') {
    OPEN = OPEN.concat([
      ['EEE006', 'EEE0000000006', 'ผ้าปูสมมติ 6', '10', 'P8', 'A-06-01', 40, 'เปิด', '2026-10-15', ''],
      ['EEE006', 'EEE0000000006', 'ผ้าปูสมมติ 6', '11', 'P10', 'R02-01-01', 60, '', '2026-11-05', ''],
      ['FFF007', 'FFF0000000007', 'หมอนข้างสมมติ 7', '9', 'P4', 'A-07-01', 25, 'เปิด', '2026-09-20', ''],
      ['GGG008', 'GGG0000000008', 'ที่นอนพับสมมติ 8', '11', 'P11', 'A-08-01', 8, 'เปิด', '2026-11-10', ''],
      ['GGG008', 'GGG0000000008', 'ที่นอนพับสมมติ 8', '11', 'P11', 'R02-02-01', 32, '', '2026-11-10', ''],
    ]);
    OPEN[1][6] = 80;   // R ของ AAA001 มากพอให้ซ้อมเติมหลายรอบ
  }

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
  function save(dump) { try { localStorage.setItem(KEY, JSON.stringify(dump)); } catch (e) { console.warn('เก็บ' + SET.label + 'ไม่ได้ —', e.message); } }
  function remember(email) { if (KEY) lsSet(WHO, email || ''); }
  function remembered() { return KEY ? lsGet(WHO) : ''; }

  var fire = null, shownSeq = -1;
  var watching = false, seen = -1, stopWatch = null;   // live: ฟัง meta/head (อ่าน 1 ครั้งต่อการบันทึก) แทนถามทุกนาที

  /** ฐานจำลองในเครื่อง (dev / demo) */
  async function startLocal(W) {
    if (pick.reset) {
      [KEY, WHO, METER, NO].forEach(function (k) { lsSet(k, ''); });
      try { await W.idbCache(SET.idb).clear(); } catch (e) {}
      history.replaceState(null, '', location.pathname + '?fire=' + MODE + location.hash);
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
    try { cache = window.indexedDB ? W.idbCache(SET.idb) : W.memCache(); } catch (e) { cache = W.memCache(); }
    fire = W.open({ store: store, auth: W.fakeAuth(ACCOUNTS), cache: cache, domain: DOMAIN, meter: W.storeMeter(METER) });
    if (!store.dump()['meta/head']) {
      var head = ACCOUNTS.filter(function (a) { return a.role === 'head'; })[0];
      await fire.login(head.email);
      var r = await fire.post('bk-open', { batch: MODE + '-open', rows: OPEN });
      if (r.error) console.warn('ลงยอดยกมาสมมติไม่ได้ —', r.error);
      await fire.logout();
    }
  }

  /* ── นาฬิกา: เวลาเว็บ − นาฬิกาเครื่อง (ms) ระบบจริงเท่านั้น ── */
  var SKEW = 0, SKEW_MIN = 30000, CLOCK_EVERY = 3600000, CLOCK_WAIT = 3000;
  function clockNow() { return Date.now() + SKEW; }
  /** ขอหัว Date ของหน้านี้ (ไม่ใช้ cache) เทียบกับนาฬิกาเครื่อง · ขอไม่ได้ = ใช้นาฬิกาเครื่องตามเดิม */
  async function checkClock() {
    var get = window.fetch;
    if (typeof get !== 'function') return;
    try {
      var t0 = Date.now();
      var r = await get((location.pathname || '/') + '?clock=' + t0, { method: 'HEAD', cache: 'no-store' });
      var t1 = Date.now(), h = r && r.headers;
      var d = Date.parse((h && h.get('Date')) || '');
      if (!isFinite(d)) return;
      var off = d + 500 + (+(h.get('Age') || 0) || 0) * 1000 - (t0 + t1) / 2;   // Date ปัดลงเป็นวินาที
      SKEW = Math.abs(off) >= SKEW_MIN ? Math.round(off) : 0;
    } catch (e) {}
  }

  /** Firestore จริง + Google ของบริษัท (เว็บที่ deploy เท่านั้น firestoreStore กัน localhost อีกชั้น) */
  async function startLive(W) {
    if (typeof window.fetch === 'function') {
      await Promise.race([checkClock(), new Promise(function (res) { setTimeout(res, CLOCK_WAIT); })]);
      if (typeof window.setInterval === 'function') window.setInterval(checkClock, CLOCK_EVERY);
    }
    var fs = await W.firestoreStore(CFG.firebase);
    var cache;
    try { cache = window.indexedDB ? W.idbCache(SET.idb) : W.memCache(); } catch (e) { cache = W.memCache(); }
    fire = W.open({ store: fs.store, auth: W.googleAuth(fs, DOMAIN), cache: cache, domain: DOMAIN, meter: W.storeMeter(METER), now: clockNow });
  }

  var ready = (async function () {
    await script('../wms-fire-core.js');
    await script('../wms-fire-trc.js');
    await script('../wms-fire-docs.js');
    await script('../wms-fire-print.js');
    await script('../wms-fire.js');
    if (MODE === 'live') await startLive(window.WmsFire);
    else await startLocal(window.WmsFire);
  })();

  function watchOn() {
    if (MODE !== 'live' || stopWatch || !fire) return;
    try {
      stopWatch = fire.watch(function (meta) { seen = Math.max(seen, +meta.seq || 0); }, function () { watching = false; stopWatch = null; });
      watching = true;
    } catch (e) { watching = false; stopWatch = null; }
  }
  function watchOff() {
    if (stopWatch) { try { stopWatch(); } catch (e) {} }
    stopWatch = null; watching = false; seen = -1;
  }

  /** เข้าแล้ว: แท็บที่เปิดแม้สวิตช์ปิด (?fire=live) ใช้ได้เฉพาะหัวหน้า */
  async function entered(r) {
    if (!r || r.error) return r;
    if (pick.override && r.role !== window.WmsFire.ROLE_TH.head) {
      remember('');
      await fire.logout();
      return { error: 'สวิตช์ระบบใหม่ปิดอยู่ ใช้หน้าสมุดสต๊อกแบบเดิม (เปิดแบบนี้ได้เฉพาะหัวหน้า)', noRight: 1 };
    }
    watchOn();
    return r;
  }

  /** op ที่บันทึกลงฐาน (หลังสำเร็จยอดในเครื่องเปลี่ยน) */
  function saves(op) { return !!(window.WmsFireCore && window.WmsFireCore.OPS[op]); }

  /** ออเดอร์ซ้อม (แบบไฟล์ CRM) เลขออเดอร์ไม่ซ้ำในเครื่องนี้ ตัดได้เรื่อย ๆ */
  function demoOrders(day) {
    var skus = OPEN.filter(function (r) { return r[7] === 'เปิด'; }).map(function (r) { return r[1]; })
      .filter(function (s, i, a) { return a.indexOf(s) === i; });
    var n = +lsGet(NO) || 0, out = ['Order ID\tSKU\tจำนวน\tวันที่\tขนส่ง'];
    var lines = 8 + Math.floor(Math.random() * 5);
    for (var i = 0; i < lines; i++) {
      n++;
      var id = 'SIM' + String(day || '').replace(/-/g, '').slice(2) + String(n).padStart(4, '0');
      var sku = skus[Math.floor(Math.random() * skus.length)];
      out.push([id, sku, Math.random() < 0.8 ? 1 : 2, day, ['ขนส่ง ก', 'ขนส่ง ข'][n % 2]].join('\t'));
      if (Math.random() < 0.2) out.push([id, skus[(skus.indexOf(sku) + 1) % skus.length], 1, day, ['ขนส่ง ก', 'ขนส่ง ข'][n % 2]].join('\t'));
    }
    lsSet(NO, String(n));
    return out.join('\n');
  }

  /* หน้า เอกสาร: สรุปทุกใบคิดใหม่เมื่อสำเนาในเครื่องเปลี่ยน (เอกสารใหม่ เลข TRcloud ใหม่) */
  var IDX = { key: '', list: [], by: null }, trVer = 0;
  function docList() {
    if (!fire || !window.WmsFireDocs) return [];
    var l = fire.local(), k = l.seq + ':' + l.docs.length + ':' + (l.trAt || 0) + ':' + (l.okAt || 0) + ':' + (l.tv || 0) + ':' + (l.ov || 0) + ':' + trVer;
    if (k !== IDX.key) IDX = { key: k, list: window.WmsFireDocs.index(l), by: null };
    return IDX.list;
  }
  /** สรุปของเลขที่นี้ (brief: ok ck ap state …) · ไม่พบ = null */
  function briefOf(no) {
    var list = docList();
    if (!IDX.by) { IDX.by = {}; list.forEach(function (x) { IDX.by[x.no] = x; }); }
    return IDX.by[no] || null;
  }

  window.BookFire = {
    ready: ready,
    mode: MODE,
    dev: MODE === 'dev',
    /** เลือกบัญชีในหน้าต่างของหน้าเอง (dev / ซ้อม) แทนป๊อปอัป Google */
    pick: MODE !== 'live',
    /** ร่างและชุดรอส่งในเครื่องเก็บแยกต่อโหมด ('' = ร่วมกับระบบเดิม ชุดค้างตอนสลับระบบไม่หาย) */
    ns: SET.ns,
    label: SET.label,
    /** แท็บนี้เปิดระบบใหม่ทั้งที่สวิตช์ปิด (?fire=live) */
    override: !!pick.override,
    domain: DOMAIN,
    /** นาฬิกาเครื่องคลาดจากเวลาเว็บกี่ ms (+ = เครื่องช้า) 0 = ตรง หรือไม่ใช่ระบบจริง */
    clock: function () { return SKEW; },
    accounts: function () { return ACCOUNTS.map(function (a) { return { email: a.email, name: a.name }; }); },
    demoOrders: MODE === 'live' ? null : demoOrders,
    /** เปิดหน้าใหม่: เข้าด้วยบัญชีที่ค้างไว้ (ระบบจริง Google จำให้) · ไม่มี = null */
    restore: async function () {
      await ready;
      if (MODE === 'live') return entered(await fire.restore());
      var e = remembered();
      if (!e) return null;
      var r = await fire.login(e);
      if (r.error) remember('');
      return entered(r);
    },
    signIn: async function (email) {
      await ready;
      var r = MODE === 'live' ? await fire.login() : await fire.login(email);
      remember(r.error ? '' : email);
      return entered(r);
    },
    logout: function () { remember(''); watchOff(); if (fire) fire.logout(); },
    user: function () { return fire ? fire.user() : null; },
    /** เน็ตหลุด = โยน error ให้หน้าเก็บเป็นชุดรอส่งแล้วส่งซ้ำเอง (รหัสชุดเดิม ไม่บันทึกซ้ำ) */
    post: async function (op, body) {
      await ready;
      var r = await fire.post(op, body);
      if (r && r.net) throw new Error(r.error);
      return r;
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
    /** มีเอกสารใหม่ที่หน้ายังไม่แสดงไหม (ระบบจริงฟังอยู่แล้ว ไม่ต้องอ่านฐานทุกนาที) */
    changed: async function () {
      await ready;
      if (watching) return seen > shownSeq;
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
    trSave: async function (items) { await ready; var r = await fire.trSave(items); trVer++; return r; },
    /**
     * ตรวจ / อนุมัติ nos = [เลขที่] act = check | approve | both · ส่งทีละ OK_MAX ใบ (Rules) ต่อกันจนครบ
     * พลาดกลางทาง = หยุดตรงนั้น บอกว่าทำไปแล้วกี่ใบ → { saved, error? }
     */
    okSave: async function (nos, act) {
      await ready;
      var max = window.WmsFireCore.OK_MAX, saved = 0;
      for (var i = 0; i < nos.length; i += max) {
        var r = await fire.okSave(nos.slice(i, i + max), act);
        trVer++;
        if (r.error) return { saved: saved, error: r.error, bad: r.bad };
        saved += r.saved || 0;
      }
      return { saved: saved };
    },
    trFile: function (nos) { return fire.trFile(nos); },
    /** สถานะตรวจ / อนุมัติของเลขที่นี้ { ok, ck, ap } (ชุดในตารางชุดที่บันทึก) */
    okOf: function (no) { var x = briefOf(no); return x ? { ok: x.ok, ck: x.ck, ap: x.ap } : null; },
    trc: async function () { await ready; return fire.trc(); },
    trcSave: async function (parsed, day, files) { await ready; return fire.trcSave(parsed, day, files); },
    masterSave: async function (kind, part) { await ready; return fire.masterSave(kind, part); },
    masters: function () { return fire ? fire.masters() : {}; },
    xferDays: async function () { await ready; return fire.xferDays(); },
    xferText: function (day, after) { return fire.xferText(day, after); },
    xferMark: async function (day, info) { await ready; return fire.xferMark(day, info); },
    backup: async function () { await ready; return fire.backup(); },
    /* แอปสมุดสต๊อก: หน้า วันนี้ / เอกสาร คิดจากสำเนาในเครื่อง ไม่อ่านฐาน (ยังไม่พร้อม = null / []) */
    home: function () { return fire && window.WmsFireDocs ? window.WmsFireDocs.home(fire.local(), clockNow(), (fire.user() || {}).email || '') : null; },
    docs: function (q) { return window.WmsFireDocs ? window.WmsFireDocs.search(docList(), Object.assign({ email: fire && fire.user() ? fire.user().email : '' }, q || {}), clockNow()) : null; },
    doc: function (no) { return fire && window.WmsFireDocs ? window.WmsFireDocs.view(fire.local(), no) : null; },
    archInfo: async function () { await ready; return fire.archInfo(); },
    archClose: async function () { await ready; return fire.archClose(); },
    /**
     * กู้คืนจากไฟล์สำรองลงฐานทดลอง (ล้างของเดิมทั้งหมด) แล้วโหลดหน้าใหม่ ต้องเข้าระบบใหม่ด้วยรายชื่อในไฟล์
     * ระบบจริงกู้คืนด้วย apps-script/fire-backup.gs (สิทธิ์เจ้าของโปรเจกต์ ลงโปรเจกต์ว่าง)
     */
    restoreDev: MODE !== 'dev' ? null : async function (text) {
      await ready;
      var r = window.WmsFireTrc.readBackup(text);
      if (r.error) return r;
      save(r.backup.data);
      try { await window.WmsFire.idbCache(SET.idb).clear(); } catch (e) {}
      remember('');
      return { ok: 1, docs: Object.keys(r.backup.data).filter(function (p) { return /^docs\/[^~]+$/.test(p); }).length };
    },
  };
})();
