/**
 * ของปลอมของ Google สำหรับนับสต๊อกใหญ่ ใช้สองที่
 *   - เทสต์ (src/data/stocktake.test.js) รัน apps-script/stocktake-api.gs ตัวจริงกับชีตในหน่วยความจำ
 *   - dev server (vite.config.js) ตอบ /__fake/stocktake กับ /__fake/tx ให้ลองหน้าเว็บได้โดยไม่มี Apps Script
 * ข้อมูลทั้งหมดสมมติขึ้น (repo นี้เป็นสาธารณะ) ไม่ใช่ไฟล์เทสต์ vitest จึงไม่รันตรง ๆ
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GS = path.resolve(HERE, '../../apps-script/stocktake-api.gs');

/** เวลาแก้ไฟล์ stocktake-api.gs ล่าสุด dev server ใช้รู้ว่าต้องโหลดสคริปต์ใหม่ (ชีตเดิมอยู่ครบ) */
export function stocktakeMtime() {
  try { return fs.statSync(GS).mtimeMs; } catch (e) { return 0; }
}

/** แท็บในหน่วยความจำ ทำเท่าที่สคริปต์ใช้ ช่องที่ยังไม่เคยเขียนอ่านได้ '' แบบชีตจริง */
export function fakeTab(name) {
  const grid = [];
  let maxRows = 1000;
  const formats = [];
  const cell = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : '');
  const lastRow = () => {
    for (let r = grid.length - 1; r >= 0; r--) {
      if (grid[r] && grid[r].some((v) => v !== '' && v !== undefined && v !== null)) return r + 1;
    }
    return 0;
  };
  const tab = {
    name,
    grid,
    formats,
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: () => Math.max(0, ...grid.map((r) => (r ? r.length : 0))),
    getMaxRows: () => maxRows,
    insertRowsAfter: (_after, n) => { maxRows += n; },
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => {
      if (r < 1 || c < 1 || r + nr - 1 > maxRows) throw new Error(`ช่วง ${name}!R${r}C${c}:${nr}x${nc} เกินขอบแท็บ (${maxRows} แถว)`);
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r - 1 + i, c - 1 + j))),
        setValues: (vals) => {
          if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('ขนาดข้อมูลไม่ตรงกับช่วง');
          /* Google Sheet รับข้อความช่องละไม่เกิน 50,000 ตัวอักษร */
          if (vals.some((v) => v.some((x) => typeof x === 'string' && x.length > 50000))) throw new Error('ข้อความในช่องเกิน 50000 ตัวอักษร');
          vals.forEach((v, i) => {
            grid[r - 1 + i] = grid[r - 1 + i] || [];
            v.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x instanceof Date ? new Date(x.getTime()) : x; });
          });
        },
        setNumberFormat: (f) => { formats.push({ r, c, nr, nc, f }); },
        clearContent: () => {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (grid[r - 1 + i]) grid[r - 1 + i][c - 1 + j] = '';
        },
      };
    },
  };
  return tab;
}

export function fakeSpreadsheet(tz = 'Asia/Bangkok', id = 'fake') {
  const tabs = [];
  return {
    tabs,
    tab: (name) => tabs.find((t) => t.name === name) || null,
    getSheetByName: (name) => tabs.find((t) => t.name === name) || null,
    insertSheet: (name) => { const t = fakeTab(name); tabs.push(t); return t; },
    deleteSheet: (t) => { const i = tabs.indexOf(t); if (i >= 0) tabs.splice(i, 1); },
    getSheets: () => tabs.slice(),
    getSpreadsheetTimeZone: () => tz,
    getId: () => id,
    getName: () => id,
    getUrl: () => `https://docs.example/d/${id}/edit`,
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** Utilities.formatDate เท่าที่สคริปต์ใช้ เวลาไทย (+7) ตายตัว */
function formatDate(d, _tz, fmt) {
  const t = new Date(d.getTime() + 7 * 3600000);
  const map = {
    yyyy: String(t.getUTCFullYear()), yy: String(t.getUTCFullYear()).slice(2), MM: pad(t.getUTCMonth() + 1),
    dd: pad(t.getUTCDate()), HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()),
  };
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

/**
 * โหลด stocktake-api.gs ตัวจริง ใส่รหัสตามที่ขอ แล้วคืนตัวเรียก get / post ที่ตอบเป็น object
 * now = ฟังก์ชันคืนเวลา (เทสต์ตั้งเวลาเองได้) lockLog = นับการขอล็อก ใช้เช็คว่าเขียนภายใต้ล็อก
 */
export function loadStocktake({ head = 'head-secret', count = '', ss = fakeSpreadsheet(), source } = {}) {
  let src = source || fs.readFileSync(GS, 'utf8');
  src = src.replace("var HEAD_TOKEN = '';", `var HEAD_TOKEN = ${JSON.stringify(head)};`);
  src = src.replace("var COUNT_TOKEN = '';", `var COUNT_TOKEN = ${JSON.stringify(count)};`);
  const lock = { held: false, waits: 0, flushes: 0 };
  const cache = new Map();
  const props = new Map();
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => { lock.flushes++; } },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (lock.held) throw new Error('ล็อกซ้อน'); lock.held = true; lock.waits++; },
        releaseLock: () => { lock.held = false; },
      }),
    },
    Utilities: { formatDate, getUuid: () => globalThis.crypto.randomUUID() },
    /* CacheService แบบในหน่วยความจำ หมดอายุตาม ttl (วินาที) เทียบกับ now_() ของสคริปต์ */
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const x = cache.get(k); return x && x.until > ctx.now_() ? x.v : null; },
        put: (k, v, ttl) => { cache.set(k, { v: String(v), until: ctx.now_() + (ttl || 600) * 1000 }); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    /* Script Properties แบบในหน่วยความจำ (เก็บค่าถาวร ไม่หมดอายุ) */
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
        getProperties: () => Object.fromEntries(props),
        getKeys: () => [...props.keys()],
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const parse = (o) => JSON.parse(o.text);
  return {
    ss,
    lock,
    ctx,
    cache,
    props,
    get: (params) => parse(ctx.doGet({ parameter: params || {} })),
    post: (body) => parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
  };
}

/* ── สมุดสต๊อก (apps-script/book-api.gs) ────────────────────────────────── */

const BOOK_GS = path.resolve(HERE, '../../apps-script/book-api.gs');

/** เวลาแก้ไฟล์ book-api.gs ล่าสุด dev server ใช้รู้ว่าต้องโหลดสคริปต์ใหม่ (ชีตเดิมอยู่ครบ) */
export function bookMtime() {
  try { return fs.statSync(BOOK_GS).mtimeMs; } catch (e) { return 0; }
}

/**
 * โหลด book-api.gs ตัวจริงกับไฟล์ชีตในหน่วยความจำ
 *   files = ไฟล์ที่สคริปต์สร้างเอง (SpreadsheetApp.create) เปิดคืนได้ด้วย openById เท่านั้น
 *   openByUrl ไม่มีให้เรียก — สคริปต์นี้ต้องไม่เปิดไฟล์อื่นนอกจากที่ตัวเองสร้าง
 *   now = ฟังก์ชันคืนเวลา (เทสต์ตั้งเวลาเองได้)
 */
export function loadBook({ ss = fakeSpreadsheet('Asia/Bangkok', 'book'), files = new Map(), props = new Map(), now, source } = {}) {
  const src = source || fs.readFileSync(BOOK_GS, 'utf8');
  const lock = { held: false, waits: 0, flushes: 0 };
  const cache = new Map();
  const opened = [];
  const triggers = [];
  let made = 0;
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush: () => { lock.flushes++; },
      create: (name) => {
        const f = fakeSpreadsheet('Asia/Bangkok', `log${++made}`);
        f.title = name;
        f.insertSheet('Sheet1');
        files.set(f.getId(), f);
        return f;
      },
      openById: (id) => {
        opened.push(id);
        if (!files.has(id)) throw new Error(`ไม่มีไฟล์ ${id}`);
        return files.get(id);
      },
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (lock.held) throw new Error('ล็อกซ้อน'); lock.held = true; lock.waits++; },
        releaseLock: () => { lock.held = false; },
      }),
    },
    Utilities: {
      formatDate,
      getUuid: () => globalThis.crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      /* Apps Script คืนไบต์แบบมีเครื่องหมาย (-128..127) */
      computeDigest: (alg, s) => [...crypto.createHash(alg).update(String(s), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const x = cache.get(k); return x && x.until > ctx.now_() ? x.v : null; },
        put: (k, v, ttl) => { cache.set(k, { v: String(v), until: ctx.now_() + (ttl || 600) * 1000 }); },
        remove: (k) => { cache.delete(k); },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
    },
    /* ตัวตั้งเวลาสำรองข้อมูลทุกคืน (installBackup) เก็บไว้ในตัวแปรให้เทสต์เปิดดู */
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (fn) => {
        const t = { fn, every: 0, hour: -1, getHandlerFunction: () => fn };
        const b = {
          timeBased: () => b,
          everyDays: (n) => { t.every = n; return b; },
          atHour: (h) => { t.hour = h; return b; },
          create: () => { triggers.push(t); return t; },
        };
        return b;
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  if (now) ctx.now_ = now;
  const parse = (o) => JSON.parse(o.text);
  return {
    ss, files, props, lock, cache, ctx, opened, triggers,
    get: (params) => parse(ctx.doGet({ parameter: params || {} })),
    post: (body) => parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
    /** ใส่รายชื่อคนในแท็บผู้ใช้แบบที่หัวหน้าพิมพ์เอง [[ชื่อ, รหัส, สิทธิ์, ใช้งาน]] */
    users: (list) => {
      ctx.setup();
      const t = ss.getSheetByName('ผู้ใช้');
      t.getRange(2, 1, list.length, 4).setValues(list.map((u) => [u[0], u[1], u[2] || '', u[3] || '']));
    },
  };
}

/* ── สมุดสมมติ (คำตอบ tx-fifo) ───────────────────────────────────────────── */

/** สุ่มแบบได้ผลเดิมทุกครั้ง ข้อมูลตัวอย่างจะได้เหมือนกันทุกรอบที่เปิด dev server */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s % 100000) / 100000; };
}

/**
 * คลังสมมติ: แร็ค R1–R3 (6 ช่อง × 3 ชั้น) พื้น A-01..A-03, B-01..B-02 (4 ตำแหน่ง) ชั้นวาง S-01 กับ QA, RIB
 * SKU สมมติ AAA/BBB/CCC/FRE, PO 99000000xx, Supplier สมมติ
 * แถวรับเข้าแล้วขาย / ย้ายบางส่วน รูปแบบเดียวกับ tx-api.gs fifo_
 */
export function fakeFifo({ extraRows = [] } = {}) {
  const r = rng(20261109);
  const skus = [];
  const kinds = [['AAA', 'ที่นอน 5FT สมมติ', 10], ['BBB', 'ท็อปเปอร์ สมมติ', 8], ['CCC', 'หมอนสมมติ', 6], ['FRE', 'แถม-ผ้าสมมติ', 6]];
  kinds.forEach(([p, nm, n]) => {
    for (let i = 1; i <= n; i++) skus.push([`${p}${pad(i).padStart(3, '0')}`, `${p}00000000${pad(i)}`, `${nm} รุ่น ${i}`]);
  });
  const pos = [];
  for (let i = 1; i <= 12; i++) pos.push(`99000000${pad(i)}`);
  const locs = [];
  for (let rk = 1; rk <= 3; rk++) for (let b = 1; b <= 6; b++) for (let l = 1; l <= 3; l++) locs.push(`R${rk}-${pad(b)}-${pad(l)}`);
  ['A-01', 'A-02', 'A-03', 'B-01', 'B-02', 'S-01'].forEach((g) => { for (let p = 1; p <= 4; p++) locs.push(`${g}-${pad(p)}`); });
  locs.push('QA', 'RIB', 'DOCKLOAD');
  const days = ['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-08'];
  const rows = [];
  let row = 2;
  /* รับเข้า: เกือบทุกโลมีของ บางโลว่าง */
  locs.forEach((loc, li) => {
    if (loc === 'DOCKLOAD' || r() < 0.15) return;
    const piles = r() < 0.25 ? 2 : 1;
    for (let k = 0; k < piles; k++) {
      const s = Math.floor(r() * skus.length);
      const po = Math.floor(r() * pos.length);
      const lot = 8 + Math.floor(r() * 3);
      const qty = 4 + Math.floor(r() * 20);
      const open = /^[A-DS]-/.test(loc) ? 1 : 0;
      rows.push([row++, s, lot, po, -1, li, qty, 0, 0, open + 2 + 8]);
    }
  });
  /* ขายออกจากโลเปิด (พื้นกับชั้นวาง) */
  rows.slice().forEach((g) => {
    if (!(g[9] & 1) || r() < 0.4) return;
    rows.push([row++, g[1], g[2], g[3], g[5], -1, 1 + Math.floor(r() * 3), 2, 2 + Math.floor(r() * 2), 8]);
  });
  /* ย้ายบางกองจากแร็คไปพื้น */
  rows.slice(0, 30).forEach((g) => {
    if (g[7] !== 0 || r() < 0.8) return;
    rows.push([row++, g[1], g[2], g[3], g[5], locs.indexOf('A-01-01'), 2, 1, 3, 1 + 8]);
  });
  extraRows.forEach((x) => rows.push([row++, ...x]));
  const sup = { tab: 'PO. Truck', rows: pos.map((p, i) => [p, `ผู้ผลิต ${'กขค'[i % 3]} สมมติ`]), dup: [], missing: '' };
  return {
    app: 'transaction', at: Date.now(), today: '2026-11-09', last: '2026-11-08', conv: 1, lot0: 1, ob: 1,
    sheet: { url: 'https://docs.example/d/ledger/edit', gid: 0 },
    skus, pos, locs, days, rows, before: null, convert: null, cap: null, sup,
  };
}

const TX_GS = path.resolve(HERE, '../../apps-script/tx-api.gs');

/**
 * คำตอบ tx-fifo จากแท็บ Transaction ของสมุดใหม่สมมติ (ไฟล์ของ loadBook)
 * รัน tx-api.gs ตัวจริงกับไฟล์ที่มีแท็บนั้นแท็บเดียว เหมือนตอนตัดรอบที่เปลี่ยน IMPORTRANGE ในไฟล์สำเนาไปอ่านสมุดใหม่
 * แท็บถูกห่อให้อ่านได้อย่างเดียว ถ้าสคริปต์เผลอเขียนจะ error
 */
export function fifoFromBook(bookSs) { return txFromBook(bookSs, { api: 'tx-fifo' }); }

/**
 * แบบเดียวกับ fifoFromBook แต่ส่งคำขออื่นได้ เช่น { api: 'tx-summary' } { api: 'tx-daily', from, to } { api: 'tx-history', sku }
 * nameInL: ให้ tx-api.gs เห็นชื่อคนบันทึกในช่อง L แบบชีต Transaction เดิม (สมุดใหม่เก็บ NAME ไว้ช่อง M · L ว่าง)
 */
export function txFromBook(bookSs, parameter, { nameInL = false } = {}) {
  const tx = bookSs.getSheetByName('Transaction');
  const shown = (v) => (v instanceof Date ? formatDate(v, '', 'dd/MM/yyyy') : String(v ?? ''));
  const ro = tx && {
    getName: () => 'Transaction',
    getSheetId: () => 1,
    getLastRow: () => tx.getLastRow(),
    getLastColumn: () => tx.getLastColumn(),
    getRange: (r, c, nr = 1, nc = 1) => {
      const vals = () => {
        const g = tx.getRange(r, c, nr, nc).getValues();
        if (!nameInL || c > 12 || c + nc - 1 < 12) return g;
        const m = tx.getRange(r, 13, nr, 1).getValues();
        return g.map((row, i) => { const x = row.slice(); x[12 - c] = r + i === 1 ? 'NAME' : m[i][0]; return x; });
      };
      return { getValues: vals, getDisplayValues: () => vals().map((x) => x.map(shown)) };
    },
  };
  const ss = {
    getSheets: () => (ro ? [ro] : []),
    getSheetByName: (n) => (ro && n === 'Transaction' ? ro : null),
    insertSheet: () => { throw new Error('ไฟล์สำเนาสมมติ: ห้ามเพิ่มแท็บ'); },
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    getUrl: () => 'https://docs.example/d/book-copy/edit',
    getName: () => 'สำเนาสมุดใหม่สมมติ',
    getId: () => 'book-copy',
  };
  const no = () => { throw new Error('ห้ามเปิดไฟล์อื่น'); };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: no, openByUrl: no },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Utilities: { formatDate },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: {}, ScriptApp: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(TX_GS, 'utf8'), ctx);
  return JSON.parse(ctx.doGet({ parameter }).text);
}

/* ── ชีตสต๊อก TRcloud สมมติ (apps-script/stock-api.gs) ───────────────────── */

const STOCK_GS = path.resolve(HERE, '../../apps-script/stock-api.gs');

/** เวลาแก้ไฟล์ stock-api.gs ล่าสุด */
export function stockMtime() {
  try { return fs.statSync(STOCK_GS).mtimeMs; } catch (e) { return 0; }
}

/**
 * รัน stock-api.gs ตัวจริงกับแท็บในหน่วยความจำ
 * tabs = { ชื่อแท็บ: [[หัวตาราง...], [แถว...]] } ช่องว่างเป็น ''
 */
export function loadStockApi(tabs = fakeStockTabs()) {
  const sheet = (name) => ({
    getName: () => name,
    getDataRange: () => ({ getValues: () => tabs[name].map((r) => r.slice()) }),
  });
  const ss = {
    getSheetByName: (n) => (tabs[n] ? sheet(n) : null),
    getSheets: () => Object.keys(tabs).map(sheet),
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(STOCK_GS, 'utf8'), ctx);
  return { get: (params) => JSON.parse(ctx.doGet({ parameter: params || {} }).getContent()) };
}

/**
 * ชีตสต๊อกสมมติที่เข้ากับสมุดสมมติ (fakeFifo): ยอดในสมุดราย SKU แยก QA กับคลังหลัก แล้วทำให้ต่างบ้าง
 *   ทุก 5 SKU (เริ่ม 1) TRcloud น้อยกว่าสมุด 2 + เคยโอนเข้า WH-Loss ไว้ 2  → เจอของที่เคยหาย
 *   ทุก 6 SKU (เริ่ม 2) TRcloud มากกว่าสมุด 3 + เคยเกิน (Loss −1)        → หายเพิ่ม หักกับที่เคยเกินก่อน
 *   SKU 3 TRcloud อยู่ QA 2 ชิ้นที่สมุดอยู่คลังหลัก · SKU 7 ไม่มีใน TRcloud · ZZZ มีแต่ใน TRcloud
 * แท็บ WH-Loss มีชื่อรายงานสองแถวบนแบบไฟล์ export ของ TRcloud
 */
export function fakeStockTabs() {
  const f = fakeFifo();
  const bal = f.skus.map(() => ({ qa: 0, main: 0 }));
  f.rows.forEach((r) => {
    const add = (loc, q) => { if (loc >= 0) bal[r[1]][/^I?QA$/.test(f.locs[loc]) ? 'qa' : 'main'] += q; };
    add(r[5], r[6]);
    if (r[7]) add(r[4], -r[6]);
  });
  const stock = [['SKU', 'Description', 'QA', 'NEW WH', 'Total']];
  const loss = [['รายงานสินค้าคงเหลือ คลัง WH-Loss (สมมติ)'], [''], ['รหัสสินค้า', 'ชื่อสินค้า', 'คงเหลือ']];
  const cost = [['SKU', 'ราคาทุน']];
  f.skus.forEach((s, i) => {
    let { qa, main } = bal[i];
    if (i === 7) return;
    if (i % 5 === 1) { main -= 2; loss.push([s[1], s[2], 2]); }
    if (i % 6 === 2) { main += 3; loss.push([s[1], s[2], -1]); }
    if (i === 3) { qa += 2; main -= 2; }
    stock.push([s[1], s[2], qa, Math.max(0, main), qa + Math.max(0, main)]);
    if (i % 4 !== 3) cost.push([s[1], 100 + i * 10]);
  });
  stock.push(['ZZZ0000000001', 'สินค้าที่มีแต่ใน TRcloud สมมติ', 0, 4, 4]);
  loss.push(['YYY0000000001', 'ของค้างใน Loss สมมติ', 5]);
  return { Stock: stock, 'WH Loss': loss, ราคาทุน: cost };
}

/* ── สคริปต์สำรองระบบใหม่ (apps-script/fire-backup.gs) ──────────────────── */

const FIRE_GS = path.resolve(HERE, '../../apps-script/fire-backup.gs');
const FIRE_TIME = ['at', 'trAt', 'last', 'ckAt', 'apAt', 'okAt'];   // = TIME_KEYS ของ fire-backup.gs

/** เวลาแก้ไฟล์ fire-backup.gs ล่าสุด dev server ใช้รู้ว่าต้องโหลดสคริปต์ใหม่ (ข้อมูลเดิมอยู่ครบ) */
export function fireBackupMtime() {
  try { return fs.statSync(FIRE_GS).mtimeMs; } catch (e) { return 0; }
}

/** ค่าธรรมดา (รูป memStore.dump) → ค่าของ Firestore REST (ช่องเวลาระดับบน → timestamp มีไมโครวินาทีแบบของจริง) */
function fireRest(v, key) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (key && FIRE_TIME.includes(key)) return { timestampValue: new Date(v).toISOString().replace('Z', '456Z') };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((y) => fireRest(y)) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, y]) => [k, fireRest(y)])) } };
}
function firePlain(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue.replace(/(\.\d{3})\d+/, '$1'));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(firePlain);
  return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, y]) => [k, firePlain(y)]));
}

/**
 * โหลด fire-backup.gs ตัวจริงกับ Firestore REST จำลอง (ไม่ต่อเน็ต) และ Drive ในหน่วยความจำ ใช้สองที่
 *   - เทสต์ชุดแชร์ (src/data/fire.test.js) · dev server /__fake/fire-share (ลองลิงก์ Supply chain ของระบบใหม่)
 * project = รหัสโปรเจกต์ที่ใส่ใน FIREBASE_PROJECT_ID · over = ค่าคงที่ที่อยากเปลี่ยน เช่น { STOP_MS: -1 }
 * คืน { gs: ฟังก์ชันของสคริปต์, mirror(dump), get(params) → JSON ของ doGet, calls, props, triggers, logs, folders, reload() }
 * ห้ามเรียก URL อื่นนอกจาก Firestore REST จำลอง · ไม่มี SpreadsheetApp
 */
export function fakeFireGcp({ project = 'demo-src', over = {}, source } = {}) {
  const projects = {}, calls = [];
  const proj = (id) => projects[id] || (projects[id] = {});
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function fetch(url, opt) {
    const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents(.*)$/.exec(url);
    if (!m) throw new Error('ห้ามเรียก ' + url);
    const [, p, rest] = m;
    if (opt.headers.Authorization !== 'Bearer token-ทดลอง' || opt.headers['X-Goog-User-Project'] !== p) return resp(403, { error: 'auth' });
    calls.push([opt.method, p, rest]);
    const db = proj(p), name = (x) => `projects/${p}/databases/(default)/documents/${x}`;
    if (rest === ':commit') {
      JSON.parse(opt.payload).writes.forEach((w) => { db[w.update.name.split('/documents/')[1]] = w.update.fields; });
      return resp(200, { commitTime: 'x' });
    }
    if (rest === ':runQuery') {
      const q = JSON.parse(opt.payload).structuredQuery, coll = q.from[0].collectionId;
      let list = Object.keys(db).filter((k) => k.split('/')[0] === coll).map((k) => ({ path: k, f: db[k] }));
      const f = q.where && q.where.fieldFilter, field = f ? f.field.fieldPath : '';
      if (f) {
        const want = firePlain(f.value);
        list = list.filter((d) => d.f[field] && (f.op === 'GREATER_THAN' ? firePlain(d.f[field]) > want : firePlain(d.f[field]) >= want));
        list.sort((a, b) => cmp(firePlain(a.f[field]), firePlain(b.f[field])) || cmp(name(a.path), name(b.path)));
      } else list.sort((a, b) => cmp(a.path, b.path));
      if (q.startAt) {
        const [cv, cr] = q.startAt.values, c = firePlain(cv);
        list = list.filter((d) => { const v = firePlain(d.f[field]); return v > c || (v === c && name(d.path) > cr.referenceValue); });
      }
      list = list.slice(0, q.limit || list.length);
      return resp(200, list.length ? list.map((d) => ({ document: { name: name(d.path), fields: d.f }, readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    const lm = /^\/([^/?]+)\?pageSize=(\d+)(?:&pageToken=(\d+))?$/.exec(rest);
    if (lm) {
      const all = Object.keys(db).filter((k) => k.split('/')[0] === lm[1]).sort(), from = +(lm[3] || 0), size = +lm[2];
      const page = all.slice(from, from + size);
      const out = { documents: page.map((k) => ({ name: name(k), fields: db[k] })) };
      if (from + size < all.length) out.nextPageToken = String(from + size);
      return resp(200, page.length ? out : {});
    }
    const docPath = rest.slice(1).split('/').map(decodeURIComponent).join('/');
    return db[docPath] ? resp(200, { name: name(docPath), fields: db[docPath] }) : resp(404, { error: { code: 404 } });
  }

  /* Blob แบบ Apps Script เท่าที่สคริปต์ใช้ (ข้อความเป็น UTF-8) */
  const blob = (data, type = '') => {
    const bytes = Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    return { bytes, getBytes: () => bytes, getContentType: () => type, getDataAsString: () => bytes.toString('utf8') };
  };
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const folders = [], files = [];
  let n = 0;
  const mkFile = (fname, content, type) => {
    const file = { id: 'file' + ++n, name: fname, content: String(content), type, writes: 1 };
    Object.assign(file, {
      getId: () => file.id, getName: () => file.name, isTrashed: () => false, getBlob: () => blob(file.content, file.type),
      setContent: (c) => { file.content = String(c); file.writes++; return file; },
    });
    files.push(file);
    return file;
  };
  const mkFolder = (fname) => {
    const f = { id: 'folder' + ++n, name: fname, files: [] };
    Object.assign(f, {
      getId: () => f.id, isTrashed: () => false, getFiles: () => iter(f.files.slice()),
      getFilesByName: (x) => iter(f.files.filter((y) => y.name === x)),
      createFile: (x, content, type) => { const file = mkFile(x, content, type); f.files.push(file); return file; },
    });
    folders.push(f);
    return f;
  };
  const props = {}, triggers = [], logs = [];
  const ctx = {
    UrlFetchApp: { fetch },
    ScriptApp: {
      getOAuthToken: () => 'token-ทดลอง',
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (h) => {
        const t = { h, getHandlerFunction: () => h };
        const c = { timeBased: () => c, atHour: (x) => { t.hour = x; return c; }, everyDays: (x) => { t.days = x; return c; },
          everyHours: (x) => { t.hours = x; return c; }, create: () => { triggers.push(t); return t; } };
        return c;
      },
    },
    DriveApp: {
      getFolderById: (id) => { const f = folders.find((x) => x.id === id); if (!f) throw new Error('ไม่มีโฟลเดอร์'); return f; },
      getFileById: (id) => { const f = files.find((x) => x.id === id); if (!f) throw new Error('ไม่มีไฟล์'); return f; },
      getFoldersByName: (x) => iter(folders.filter((f) => f.name === x)),
      createFolder: mkFolder,
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
    Utilities: {
      formatDate,
      newBlob: blob,
      gzip: (b) => blob(zlib.gzipSync(b.bytes), 'application/x-gzip'),
      ungzip: (b) => blob(zlib.gunzipSync(b.bytes)),
      base64Encode: (x) => Buffer.from(x).toString('base64'),
      base64Decode: (s) => Buffer.from(String(s), 'base64'),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    Logger: { log: (s) => logs.push(String(s)) },
  };
  const NAMES = ['installBackup', 'stopBackup', 'backupNightly', 'backupFull', 'restoreAll', 'installShare', 'stopShare', 'shareRefresh', 'doGet'];
  const out = { projects, calls, folders, files, props, triggers, logs, gs: null };
  out.reload = () => {
    let src = (source || fs.readFileSync(FIRE_GS, 'utf8')).replace("var FIREBASE_PROJECT_ID = '';", `var FIREBASE_PROJECT_ID = '${project}';`);
    Object.entries(over).forEach(([k, v]) => { src = src.replace(new RegExp(`var ${k} = [^;]+;`), `var ${k} = ${v};`); });
    const c = vm.createContext({ ...ctx });
    vm.runInContext(src, c);
    out.gs = Object.fromEntries(NAMES.map((k) => [k, c[k]]));
    return out.gs;
  };
  /** ใส่ข้อมูลรูป memStore.dump() ลงโปรเจกต์ (ไม่เอาตัวนับการใช้ use/) แทนของเดิมทั้งหมด */
  out.mirror = (dump) => {
    projects[project] = Object.fromEntries(Object.entries(dump || {}).filter(([k]) => !k.startsWith('use/'))
      .map(([k, d]) => [k, Object.fromEntries(Object.entries(d).map(([f, v]) => [f, fireRest(v, f)]))]));
  };
  /** doGet ของเว็บแอป → ข้อความที่ตอบ (JSON) */
  out.text = (params = {}) => out.gs.doGet({ parameter: params }).text;
  out.get = (params = {}) => JSON.parse(out.text(params));
  out.reload();
  return out;
}
