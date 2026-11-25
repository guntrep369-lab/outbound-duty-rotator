/**
 * @file wms-demo.js — โหมดทดลองของนับสต๊อกใหญ่ ให้คนนอกบริษัทลองเล่นได้โดยไม่มีข้อมูลจริง
 *
 * เปิดด้วยลิงก์ stocktake/demo.html (หรือ ?demo=1 ต่อท้ายหน้านับสต๊อก) · ออกด้วย ?demo=0
 *   - ไม่ต่อ Apps Script ตัวไหนเลย: รัน apps-script/stocktake-api.gs ตัวจริงในเบราว์เซอร์กับชีตจำลอง
 *     (vite.config.js คัดลอกสคริปต์ไปไว้ที่ wms-demo-api.gs ตอน build) สมุด Transaction ก็เป็นสมุดสมมติ
 *   - ทุกอย่างที่หน้าเว็บเก็บในเครื่อง ถูกเก็บแยกใต้ชื่อ wms:demo:… ไม่ทับค่าจริง
 *     เปิดลิงก์ทดลองในมือถือคนนับหรือคอมหัวหน้าที่ใช้งานจริง ผลนับที่ยังค้างส่งก็ไม่หาย
 *   - ข้อมูลสมมติทั้งหมด (repo นี้เป็นสาธารณะ) อยู่ในเบราว์เซอร์นี้เครื่องเดียว ปิดแท็บแล้วเปิดใหม่ยังอยู่ กด "เริ่มใหม่" ได้รอบตัวอย่างชุดเดิม
 *
 * ต้องโหลดเป็นสคริปต์แรกใน <head> (ก่อน wms-gate.js และก่อนสคริปต์ของหน้า) เพราะต้องสลับที่เก็บข้อมูลก่อนหน้าอ่านค่า
 * ไม่ได้อยู่ในโหมดทดลอง = ไม่ทำอะไรเลย
 */
(function () {
  'use strict';

  var PRE = 'wms:demo:';          // คีย์ของโหมดทดลองในที่เก็บจริง
  var FLAG = 'wms:demo';          // sessionStorage: แท็บนี้อยู่ในโหมดทดลอง (เปลี่ยนแท็บในหน้า / รีเฟรช ยังอยู่)
  var DB = '@db';                 // ชีตจำลองทั้งไฟล์
  var HEAD = 'demo-head';         // รหัสหัวหน้าของสคริปต์จำลอง
  var COUNT = 'demo-count';       // รหัสลิงก์คนนับ
  var ST_URL = 'demo:st';
  var TX_URL = 'demo:tx';
  var HERE = document.currentScript ? document.currentScript.src : location.href;

  function wanted() {
    if (window.WMS_DEMO_FORCE) return true;   // หน้า demo.html อยู่ในโหมดทดลองเสมอ
    var q = new URLSearchParams(location.search);
    if (q.get('demo') === '0') { try { sessionStorage.removeItem(FLAG); } catch (e) {} return false; }
    if (q.get('demo') === '1') return true;
    try {
      var u = new URLSearchParams(location.hash.replace(/^#/, '')).get('u');
      if (u && u.indexOf('demo:') === 0) return true;
    } catch (e) {}
    try { return sessionStorage.getItem(FLAG) === '1'; } catch (e) { return false; }
  }
  if (!wanted()) return;

  /* ── ที่เก็บข้อมูลแยก ─────────────────────────────────────────────────── */

  var real = null;
  try { real = window.localStorage; real.getItem(FLAG); } catch (e) { real = null; }
  var mem = {};                   // เบราว์เซอร์ที่ปิดที่เก็บไว้ (โหมดส่วนตัวบางแบบ) ใช้ในหน่วยความจำแทน หายตอนปิดหน้า
  function keys() {
    if (!real) return Object.keys(mem);
    var out = [];
    for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(PRE) === 0) out.push(k.slice(PRE.length)); }
    return out;
  }
  var store = {
    getItem: function (k) {
      k = String(k);
      if (!real) return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      return real.getItem(PRE + k);
    },
    setItem: function (k, v) { k = String(k); v = String(v); if (real) real.setItem(PRE + k, v); else mem[k] = v; },
    removeItem: function (k) { k = String(k); if (real) real.removeItem(PRE + k); else delete mem[k]; },
    key: function (i) { var k = keys()[i]; return k === undefined ? null : k; },
    clear: function () { keys().forEach(function (k) { store.removeItem(k); }); },
  };
  Object.defineProperty(store, 'length', { get: function () { return keys().length; } });

  try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: function () { return store; } }); } catch (e) { /* เช็คข้างล่าง */ }
  if (window.localStorage !== store) {
    /* สลับที่เก็บไม่ได้ = ห้ามเปิดหน้าต่อ ไม่งั้นหน้าเว็บจะเขียนทับค่าจริงในเครื่องนี้ */
    window.WMS_GATE_OFF = 1;
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<p style="font:16px sans-serif;padding:40px;text-align:center">เบราว์เซอร์นี้เปิดโหมดทดลองไม่ได้<br>ลองเปิดด้วย Chrome หรือ Safari รุ่นใหม่</p>';
    });
    window.stop && window.stop();
    return;
  }
  try { sessionStorage.setItem(FLAG, '1'); } catch (e) {}
  window.WMS_GATE_OFF = 1;        // ไม่มีหน้าเข้าระบบในโหมดทดลอง

  /* ค่าตั้งของหน้าหัวหน้า: ชี้ไปสคริปต์จำลอง */
  function preset(k, v) { if (!store.getItem(k)) store.setItem(k, v); }
  function presets() {
    preset('wms:st:url', ST_URL);
    preset('wms:st:token', HEAD);
    preset('wms:tx:url', TX_URL);
    preset('wms:me', 'หัวหน้า (ทดลอง)');
  }
  presets();

  /* ── ชีตจำลอง (แบบเดียวกับ src/dev/fake-gas.js) ──────────────────────────── */

  function pad(n) { return String(n).padStart(2, '0'); }

  function makeTab(name, grid, maxRows) {
    grid = grid || [];
    maxRows = maxRows || 1000;
    var cell = function (r, c) { return grid[r] && grid[r][c] !== undefined && grid[r][c] !== null ? grid[r][c] : ''; };
    function lastRow() {
      for (var r = grid.length - 1; r >= 0; r--) {
        if (grid[r] && grid[r].some(function (v) { return v !== '' && v !== undefined && v !== null; })) return r + 1;
      }
      return 0;
    }
    return {
      name: name,
      grid: grid,
      max: function () { return maxRows; },
      getName: function () { return name; },
      getLastRow: lastRow,
      getLastColumn: function () { return Math.max.apply(null, [0].concat(grid.map(function (r) { return r ? r.length : 0; }))); },
      getMaxRows: function () { return maxRows; },
      insertRowsAfter: function (_a, n) { maxRows += n; },
      setFrozenRows: function () {},
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        if (r < 1 || c < 1 || r + nr - 1 > maxRows) throw new Error('ช่วง ' + name + '!R' + r + 'C' + c + ' เกินขอบแท็บ');
        return {
          getValues: function () {
            var out = [];
            for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(cell(r - 1 + i, c - 1 + j)); out.push(row); }
            return out;
          },
          setValues: function (vals) {
            if (vals.length !== nr || vals.some(function (v) { return v.length !== nc; })) throw new Error('ขนาดข้อมูลไม่ตรงกับช่วง');
            vals.forEach(function (v, i) {
              grid[r - 1 + i] = grid[r - 1 + i] || [];
              v.forEach(function (x, j) { grid[r - 1 + i][c - 1 + j] = x instanceof Date ? new Date(x.getTime()) : x; });
            });
          },
          setNumberFormat: function () {},
          clearContent: function () {
            for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) if (grid[r - 1 + i]) grid[r - 1 + i][c - 1 + j] = '';
          },
        };
      },
    };
  }

  function makeSs(tabs) {
    return {
      tabs: tabs,
      getSheetByName: function (n) { return tabs.filter(function (t) { return t.name === n; })[0] || null; },
      insertSheet: function (n) { var t = makeTab(n); tabs.push(t); return t; },
      deleteSheet: function (t) { var i = tabs.indexOf(t); if (i >= 0) tabs.splice(i, 1); },
      getSheets: function () { return tabs.slice(); },
      getSpreadsheetTimeZone: function () { return 'Asia/Bangkok'; },
      getId: function () { return 'demo'; },
      getName: function () { return 'demo'; },
      getUrl: function () { return 'https://docs.example/d/demo/edit'; },
    };
  }

  /** Utilities.formatDate เท่าที่สคริปต์ใช้ เวลาไทย (+7) */
  function formatDate(d, _tz, fmt) {
    var t = new Date(d.getTime() + 7 * 3600000);
    var map = {
      yyyy: String(t.getUTCFullYear()), yy: String(t.getUTCFullYear()).slice(2), MM: pad(t.getUTCMonth() + 1),
      dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()),
    };
    return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, function (k) { return map[k]; });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  }

  /* วันที่เก็บเป็น {$d: ms} เพราะ JSON เก็บ Date ไม่ได้ */
  function pack(v) { return v instanceof Date ? { $d: v.getTime() } : v === undefined ? '' : v; }
  function unpack(v) { return v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v; }

  function loadDb() {
    try { return JSON.parse(store.getItem(DB) || 'null'); } catch (e) { return null; }
  }
  function saveDb(ss, props, cache) {
    var db = {
      v: 1,
      tabs: ss.tabs.map(function (t) {
        return { name: t.name, max: t.max(), grid: Array.from(t.grid, function (row) { return row ? Array.from(row, pack) : []; }) };
      }),
      props: props, cache: cache,
    };
    store.setItem(DB, JSON.stringify(db));
  }

  /* ── สคริปต์นับสต๊อกตัวจริงในเบราว์เซอร์ ──────────────────────────────────── */

  var SRC = null;                 // ข้อความสคริปต์ (โหลดครั้งเดียว)
  var LOADING = null;
  var CLOCK = { t: null };        // ตั้งเวลาย้อนหลังตอนสร้างรอบตัวอย่าง (null = เวลาจริง)
  function clock() { return CLOCK.t === null ? Date.now() : CLOCK.t; }

  function source() {
    if (SRC) return Promise.resolve(SRC);
    if (!LOADING) {
      LOADING = fetch(new URL('wms-demo-api.gs', HERE).href, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (t) {
          if (t.indexOf("var HEAD_TOKEN = '';") < 0) throw new Error('ไฟล์สคริปต์ไม่ถูก');
          SRC = t.replace("var HEAD_TOKEN = '';", 'var HEAD_TOKEN = ' + JSON.stringify(HEAD) + ';')
            .replace("var COUNT_TOKEN = '';", 'var COUNT_TOKEN = ' + JSON.stringify(COUNT) + ';');
          return SRC;
        })
        .catch(function (e) { LOADING = null; throw new Error('โหลดตัวทดลองไม่ได้ (' + e.message + ') ลองรีเฟรช'); });
    }
    return LOADING;
  }

  /** เวลาในสคริปต์ = clock() ของโหมดทดลอง (สร้างรอบตัวอย่างให้เหมือนนับมาแล้วสองชั่วโมง) */
  var DemoDate = (function () {
    /* คืนวันที่ตัวจริงเสมอ (prototype เดียวกับ Date) instanceof Date ทั้งในสคริปต์และในชีตจำลองจึงยังถูก */
    function D() {
      var a = Array.prototype.slice.call(arguments);
      return a.length ? new (Function.prototype.bind.apply(Date, [null].concat(a)))() : new Date(clock());
    }
    D.prototype = Date.prototype;
    D.now = clock;
    D.parse = Date.parse;
    D.UTC = Date.UTC;
    return D;
  })();

  var FACTORY = null;
  /** เรียกสคริปต์หนึ่งครั้งกับชีตล่าสุดในที่เก็บ แล้วเก็บกลับ (สองหน้าในจอเดียวกันเห็นข้อมูลชุดเดียวกัน) */
  function call(kind, arg) {
    if (!FACTORY) {
      FACTORY = new Function('SpreadsheetApp', 'LockService', 'Utilities', 'CacheService', 'PropertiesService', 'ContentService', 'Date',
        SRC + '\nreturn { doGet: doGet, doPost: doPost };');
    }
    var db = loadDb() || { tabs: [], props: {}, cache: {} };
    var tabs = db.tabs.map(function (t) {
      return makeTab(t.name, t.grid.map(function (row) { return row.map(unpack); }), t.max);
    });
    var ss = makeSs(tabs);
    var props = db.props || {}, cache = db.cache || {};
    var gs = FACTORY(
      { getActiveSpreadsheet: function () { return ss; }, flush: function () {} },
      { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
      { formatDate: formatDate, getUuid: uuid },
      {
        getScriptCache: function () {
          return {
            get: function (k) { var x = cache[k]; return x && x.u > clock() ? x.v : null; },
            put: function (k, v, ttl) { cache[k] = { v: String(v), u: clock() + (ttl || 600) * 1000 }; },
            remove: function (k) { delete cache[k]; },
          };
        },
      },
      {
        getScriptProperties: function () {
          return {
            getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
            setProperty: function (k, v) { props[k] = String(v); },
            deleteProperty: function (k) { delete props[k]; },
            getProperties: function () { return Object.assign({}, props); },
            getKeys: function () { return Object.keys(props); },
          };
        },
      },
      { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { text: s, setMimeType: function () { return this; } }; } },
      DemoDate
    );
    var out = kind === 'get' ? gs.doGet({ parameter: arg || {} }) : gs.doPost({ postData: { contents: JSON.stringify(arg || {}) } });
    Object.keys(cache).forEach(function (k) { if (!(cache[k].u > clock())) delete cache[k]; });
    saveDb(ss, props, cache);
    return JSON.parse(out.text);
  }

  /* ── สมุด Transaction สมมติ (รูปแบบคำตอบ tx-fifo ของ tx-api.gs) ───────────── */

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s % 100000) / 100000; };
  }
  function ymd(ms) { return formatDate(new Date(ms), '', 'yyyy-MM-dd'); }

  /**
   * คลังตัวอย่าง: แร็ค R1–R3 (6 ช่อง × 3 ชั้น) พื้น A-01..A-03, B-01..B-02 ชั้นวาง S-01 (4 ตำแหน่ง) กับ QA, RIB
   * ได้ข้อมูลเดิมทุกครั้ง วันที่นับถอยหลังจากวันนี้ (รับของ 2 เดือนก่อน ขายล่าสุดเมื่อวาน)
   */
  function demoFifo(now) {
    var r = rng(20261125);
    var skus = [];
    [['AAA', 'ที่นอนตัวอย่าง 5 ฟุต', 10], ['BBB', 'ท็อปเปอร์ตัวอย่าง', 8], ['CCC', 'หมอนตัวอย่าง', 6], ['FRE', 'ของแถม ผ้าปูตัวอย่าง', 6]].forEach(function (k) {
      for (var i = 1; i <= k[2]; i++) skus.push([k[0] + String(i).padStart(3, '0'), k[0] + '00000000' + pad(i), k[1] + ' รุ่น ' + i]);
    });
    var pos = [];
    for (var i = 1; i <= 12; i++) pos.push('99000000' + pad(i));
    var locs = [];
    for (var rk = 1; rk <= 3; rk++) for (var b = 1; b <= 6; b++) for (var l = 1; l <= 3; l++) locs.push('R' + rk + '-' + pad(b) + '-' + pad(l));
    ['A-01', 'A-02', 'A-03', 'B-01', 'B-02', 'S-01'].forEach(function (g) { for (var p = 1; p <= 4; p++) locs.push(g + '-' + pad(p)); });
    locs.push('QA', 'RIB', 'DOCKLOAD');
    var day = 864e5;
    var days = [ymd(now - 56 * day), ymd(now - 42 * day), ymd(now - 25 * day), ymd(now - day)];
    var m = +formatDate(new Date(now), '', 'MM');
    var lots = [1, 2, 3].map(function (k) { return String(((m - 1 - k + 12) % 12) + 1); });
    var rows = [];
    var row = 2;
    locs.forEach(function (loc, li) {
      if (loc === 'DOCKLOAD' || r() < 0.15) return;
      var piles = r() < 0.25 ? 2 : 1;
      for (var k = 0; k < piles; k++) {
        var s = Math.floor(r() * skus.length), po = Math.floor(r() * pos.length);
        var lot = lots[Math.floor(r() * 3)], qty = 4 + Math.floor(r() * 20);
        var open = /^[A-DS]-/.test(loc) ? 1 : 0;
        rows.push([row++, s, lot, po, -1, li, qty, 0, Math.floor(r() * 3), open + 2 + 8]);
      }
    });
    rows.slice().forEach(function (g) {
      if (!(g[9] & 1) || r() < 0.4) return;
      rows.push([row++, g[1], g[2], g[3], g[5], -1, 1 + Math.floor(r() * 3), 2, 3, 8]);
    });
    var sup = { tab: 'PO. Truck', rows: pos.map(function (p, i) { return [p, 'ผู้ผลิตตัวอย่าง ' + 'กขค'[i % 3]]; }), dup: [], missing: '' };
    return {
      app: 'transaction', at: now, today: ymd(now), last: days[3], conv: 1, lot0: 1, ob: 1,
      sheet: { url: 'https://docs.example/d/ledger/edit', gid: 0 },
      skus: skus, pos: pos, locs: locs, days: days, rows: rows, before: null, convert: null, cap: null, sup: sup,
    };
  }

  /* ── รอบตัวอย่าง: ตั้งรอบ ดึงยอด แบ่งทีม แล้วนับมาแล้วราวสองชั่วโมง ───────────── */

  var TEAMS = [
    { id: 'INV1', name: 'ทีม 1', members: ['สมชาย', 'สมศรี'], done: 1 },
    { id: 'INV2', name: 'ทีม 2', members: ['มานะ', 'มานี'], done: 0.6 },
    { id: 'INV3', name: 'ทีม 3', members: ['ปิติ', 'ชูใจ'], done: 0.3 },
    { id: 'INV4', name: 'ทีม 4', members: ['วีระ', 'ดวงใจ'], done: 0 },
  ];

  function seed() {
    var ST = window.WmsStocktake;
    if (!ST) throw new Error('ยังโหลดหน้าไม่ครบ');
    var now = Date.now();
    var fifo = demoFifo(now);
    var sm = {};
    fifo.sup.rows.forEach(function (x) { sm[x[0]] = x[1]; });
    var b = ST.baseline(fifo, function (po) { return sm[po] || ''; });
    var by = 'หัวหน้า (ทดลอง)';
    function post(o) {
      var res = call('post', Object.assign({ t: HEAD, by: by }, o));
      if (res.error) throw new Error('สร้างรอบตัวอย่างไม่ได้: ' + res.error);
      return res;
    }
    var start = now - 120 * 60000;   // เริ่มนับเมื่อสองชั่วโมงก่อน แถวสุดท้ายราว 2 นาทีก่อน ทีมที่ยังไม่เสร็จจึงขึ้นว่ากำลังนับ
    var span = 118 * 60000;
    CLOCK.t = start - 40 * 60000;
    try {
      var id = post({ op: 'st-round-save', round: { name: 'นับสต๊อกใหญ่ (ตัวอย่าง)', date: ymd(now), cutoff: ymd(now - 864e5) + 'T18:00', settings: { auditMin: 20 } } }).round.id;
      post({ op: 'st-baseline', round: id, piles: b.piles, skus: b.skus, pos: b.pos, lastRow: b.lastRow, lastDate: b.lastDate });
      var list = ST.locations(b);
      var locs = list.map(function (l) { return [l.loc, l.zone, l.group, l.src]; });
      var groups = [];
      list.forEach(function (l) { if (groups.indexOf(l.group) < 0) groups.push(l.group); });
      var rack = function (g) { return /^R\d/.test(g); };
      var teams = TEAMS.map(function (t, i) {
        var zones = i < 3 ? ['R' + (i + 1)] : groups.filter(function (g) { return !rack(g); });
        return { id: t.id, kind: 'Inventory', name: t.name, members: t.members, zones: zones };
      });
      teams.push({ id: 'AUD1', kind: 'Audit', name: 'ทีม Audit', members: ['วิไล'], zones: groups.slice() });
      teams.forEach(function (t) { t.locs = ST.teamLocs(t, list).length; });
      post({ op: 'st-teams', round: id, pass: 1, teams: teams, locs: locs });
      CLOCK.t = start - 5 * 60000;
      post({ op: 'st-status', round: id, status: 'นับรอบ 1' });

      /* ผลนับ: ตรงกับยอดเกือบทั้งหมด มีจุดผิดที่ตั้งใจใส่ไว้ให้หน้าวิเคราะห์มีเรื่องให้ดู */
      var at = {};
      b.piles.forEach(function (p) { (at[p[0]] = at[p[0]] || []).push(p); });
      var item = function (p, qty) { return { sku: p[1], long: p[2], lot: p[4], po: p[5], qty: qty === undefined ? p[6] : qty }; };
      var plan = [];       // [{team, loc, items, t}]
      var moved = null;    // กองที่ทีม 1 ไม่เจอ แต่ทีม 2 ไปเจออีกโล
      TEAMS.forEach(function (t, ti) {
        var mine = ST.teamLocs(teams[ti], list).map(function (l) { return l.loc; });
        var n = Math.round(mine.length * t.done);
        mine.slice(0, n).forEach(function (loc, i) {
          var ps = at[loc] || [];
          var items = ps.map(function (p) { return item(p); });
          var full = ps.length > 0;
          if (ti === 0 && full && i === 3) items[0].qty = Math.max(0, items[0].qty - 2);                 // ขาด 2
          if (ti === 0 && full && i === 7) items[0].po = items[0].po.slice(0, -1) + ((+items[0].po.slice(-1) + 1) % 10);   // พิมพ์ PO ผิดหลักเดียว
          if (ti === 0 && full && i === 10 && !moved) { moved = items.shift(); }                       // หากองนี้ไม่เจอ
          if (ti === 1 && i === 2 && moved) items.push(moved);                                            // เจอกองนั้นที่โลนี้
          if (ti === 1 && full && i === 5) items[0].qty += 3;                                             // เกิน 3
          var sp = t.done >= 1 ? span * 0.8 : span;   // ทีม 1 นับจบไปแล้วราว 25 นาที
          plan.push({ team: t, loc: loc, items: items, t: start + (i + 1) * (sp / Math.max(1, n)) - ti * 23000 });
        });
      });
      /* Audit สุ่มตรวจโลที่ทีม 1 นับแล้วทุกโลที่ 4 (ตรงยอดสมุด รวมโลที่ทีม 1 นับขาด → ขึ้น Inv≠Audit) */
      var aud = { id: 'AUD1', members: ['วิไล'] };
      plan.filter(function (p) { return p.team.id === 'INV1'; }).forEach(function (p, i) {
        if (i % 4 !== 3) return;
        plan.push({ team: aud, loc: p.loc, items: (at[p.loc] || []).map(function (x) { return item(x); }), t: p.t + 9 * 60000 });
      });
      plan.sort(function (a, c) { return a.t - c.t; });
      var seq = 0;
      plan.forEach(function (p) {
        if (p.t > now - 60000) p.t = now - 60000;
        CLOCK.t = p.t;
        var who = p.team.members[seq % p.team.members.length];
        var dev = 'demo-' + p.team.id + '-' + (seq % p.team.members.length);
        var hm = formatDate(new Date(p.t), '', 'HH:mm');
        var rows = p.items.length ? p.items.map(function (x) {
          return Object.assign({ uid: 'demo-' + (++seq), pass: 1, team: p.team.id, who: who, loc: p.loc, type: 'นับ', at: hm }, x);
        }) : [{ uid: 'demo-' + (++seq), pass: 1, team: p.team.id, who: who, loc: p.loc, type: 'ว่าง', qty: 0, at: hm }];
        var res = call('post', { op: 'st-count', k: COUNT, round: id, device: dev, who: who, pass: 1, pend: rows.length, old: 0, team: p.team.id, since: 0, items: rows });
        if (res.error) throw new Error('สร้างรอบตัวอย่างไม่ได้: ' + res.error);
      });
      store.setItem('@round', id);
      store.setItem('wms:st:round', id);
      return id;
    } finally {
      CLOCK.t = null;
    }
  }

  var READY = null;
  /** สคริปต์โหลดแล้ว และมีรอบตัวอย่างแล้ว → {round, key, link} */
  function ready() {
    if (!READY) {
      READY = source().then(function () {
        if (!loadDb() || !store.getItem('@round')) seed();
        var id = store.getItem('@round');
        return { round: id, key: COUNT, link: countLink(id) };
      }).catch(function (e) { READY = null; throw e; });
    }
    return READY;
  }

  function countLink(id) {
    return new URL('stocktake/count.html', HERE).href + '#u=' + encodeURIComponent(ST_URL) + '&k=' + COUNT + '&r=' + encodeURIComponent(id);
  }

  /* ── ต่อกับ WmsGas: URL demo:st กับ demo:tx ไม่ออกเน็ต ──────────────────── */

  function params(url, api) {
    var u = new URL(url);
    var p = {};
    u.searchParams.forEach(function (v, k) { p[k] = v; });
    if (api && !p.api) new URLSearchParams('api=' + api).forEach(function (v, k) { p[k] = v; });
    return { path: u.pathname, p: p };
  }
  var later = function (v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 120 + Math.random() * 180); }); };

  function json(url, api) {
    var q = params(url, api);
    if (q.path === 'tx') {
      if (q.p.api !== 'tx-fifo') return later({ app: 'transaction' });
      var d = demoFifo(Date.now());
      /* สมุดสมมติไม่เปลี่ยนหลังตัดยอด: แถวเท่าเดิม ไม่มีรายการขายหลังเริ่มนับ */
      if (q.p.shared) d.shared = { at: d.at, by: '', auto: true };
      return later(d);
    }
    return ready().then(function () {
      try { return later(call('get', q.p)); } catch (e) { return later({ error: 'โหมดทดลองขัดข้อง: ' + e.message }); }
    });
  }
  function post(url, body) {
    return ready().then(function () {
      try { return later(call('post', body)); } catch (e) { return later({ error: 'โหมดทดลองขัดข้อง: ' + e.message }); }
    });
  }

  /** ล้างข้อมูลทดลองทั้งหมดในเครื่องนี้ (ค่าจริงไม่ถูกแตะ) แล้วได้รอบตัวอย่างชุดใหม่ */
  function reset() {
    store.clear();
    try { sessionStorage.removeItem('wms:st:intro'); } catch (e) {}
    presets();
    READY = null;
  }

  window.WmsDemo = {
    on: true,
    HEAD: HEAD, COUNT: COUNT,
    hideTabs: ['trc', 'opening'],      // กระทบ TRcloud / ตั้งต้นสมุด ผูกกับระบบบัญชีของบริษัท ไม่มีในตัวทดลอง
    owns: function (url) { return /^demo:/.test(String(url || '')); },
    json: json,
    post: post,
    ready: ready,
    reset: reset,
    countLink: countLink,
    exitUrl: function () { return new URL('stocktake/?demo=0', HERE).href; },
    _fifo: demoFifo,
  };

  /* ── หน้าตาในโหมดทดลอง: ไม่มีเมนูระบบ มีป้ายบอกว่าเป็นตัวทดลอง ─────────────── */

  document.documentElement.classList.add('wms-demo');
  var css = document.createElement('style');
  css.textContent =
    'html.wms-demo [data-wms-shell],html.wms-demo .sysbar{display:none!important}' +
    'html.wms-demo .wms-shell,html.wms-demo .wms-main{display:block}' +
    '.wms-demo-pill{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;' +
    'border-radius:999px;background:#1E1B4B;color:#fff;font:600 12.5px/1.2 "Noto Sans Thai",system-ui,sans-serif;box-shadow:0 6px 20px rgba(30,27,75,.25)}' +
    '.wms-demo-pill a,.wms-demo-pill button{font:inherit;color:#C7D2FE;background:none;border:1px solid #4338CA;border-radius:999px;padding:3px 10px;cursor:pointer;text-decoration:none}' +
    '.wms-demo-pill a:hover,.wms-demo-pill button:hover{color:#fff;border-color:#818CF8}' +
    '@media print{.wms-demo-pill{display:none}}';
  document.head.appendChild(css);

  /* ในหน้าทดลองแบบสองจอ (demo.html) แถบบนของหน้านั้นทำหน้าที่นี้แล้ว · หน้ามือถือมีแถบบนเต็มแล้ว ไม่ใส่ป้าย */
  var framed = false;
  try { framed = window.top !== window; } catch (e) { framed = true; }
  var phone = /\/count\.html$/.test(location.pathname);
  if (!framed && !phone && !window.WMS_DEMO_FORCE) {
    document.addEventListener('DOMContentLoaded', function () {
      var el = document.createElement('div');
      el.className = 'wms-demo-pill';
      el.innerHTML = '<span>🧪 โหมดทดลอง · ข้อมูลสมมติ</span><button type="button" data-demo="reset">เริ่มใหม่</button>' +
        '<a href="' + WmsDemo.exitUrl() + '">ออก</a>';
      el.querySelector('[data-demo="reset"]').addEventListener('click', function () {
        if (!confirm('ล้างข้อมูลทดลองแล้วเริ่มรอบตัวอย่างใหม่?')) return;
        reset();
        location.href = location.pathname + '?tab=control';
      });
      document.body.appendChild(el);
    });
  }
})();
