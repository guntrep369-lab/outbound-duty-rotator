/**
 * ของปลอมของ Google สำหรับนับสต๊อกใหญ่ ใช้สองที่
 *   - เทสต์ (src/data/stocktake.test.js) รัน apps-script/stocktake-api.gs ตัวจริงกับชีตในหน่วยความจำ
 *   - dev server (vite.config.js) ตอบ /__fake/stocktake กับ /__fake/tx ให้ลองหน้าเว็บได้โดยไม่มี Apps Script
 * ข้อมูลทั้งหมดสมมติขึ้น (repo นี้เป็นสาธารณะ) ไม่ใช่ไฟล์เทสต์ vitest จึงไม่รันตรง ๆ
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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

export function fakeSpreadsheet(tz = 'Asia/Bangkok') {
  const tabs = [];
  return {
    tabs,
    tab: (name) => tabs.find((t) => t.name === name) || null,
    getSheetByName: (name) => tabs.find((t) => t.name === name) || null,
    insertSheet: (name) => { const t = fakeTab(name); tabs.push(t); return t; },
    getSheets: () => tabs.slice(),
    getSpreadsheetTimeZone: () => tz,
    getUrl: () => 'https://docs.example/d/fake/edit',
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
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => { lock.flushes++; } },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (lock.held) throw new Error('ล็อกซ้อน'); lock.held = true; lock.waits++; },
        releaseLock: () => { lock.held = false; },
      }),
    },
    Utilities: { formatDate },
    /* CacheService แบบในหน่วยความจำ หมดอายุตาม ttl (วินาที) เทียบกับ now_() ของสคริปต์ */
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const x = cache.get(k); return x && x.until > ctx.now_() ? x.v : null; },
        put: (k, v, ttl) => { cache.set(k, { v: String(v), until: ctx.now_() + (ttl || 600) * 1000 }); },
        remove: (k) => { cache.delete(k); },
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
    get: (params) => parse(ctx.doGet({ parameter: params || {} })),
    post: (body) => parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
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
    app: 'transaction', at: Date.now(), today: '2026-11-09', last: '2026-11-08', conv: 1, lot0: 1,
    sheet: { url: 'https://docs.example/d/ledger/edit', gid: 0 },
    skus, pos, locs, days, rows, before: null, convert: null, cap: null, sup,
  };
}
