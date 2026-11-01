/**
 * สต๊อกราย Location: apps-script/tx-api.gs (คิดยอดจากสมุดรายการ) กับ public/wms-tx.js
 *
 * รันสคริปต์จริงกับชีตปลอม เพราะตัวเลขพวกนี้ต้องตรงกับสูตร SUMIFS ในชีตยอดของทีม
 * ถ้าเพี้ยนไปนิดเดียวคนจะเลิกเชื่อทั้งหน้า ข้อมูลในเทสต์นี้สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/tx-api.gs'), 'utf8');
const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-tx.js'), 'utf8');

const HEAD = ['SKU', 'SKU', 'Product Name', 'LOT', 'PO.', 'Location เบิก', 'Location รับ', 'QTY', 'รับ/เบิก', 'Note', 'Status', 'NAME'];

/** สร้างแถวชีตจากของที่สนใจ ช่องที่ไม่ใส่ได้ค่าปกติ */
function row(o) {
  const sku = o.sku ?? 'AAA001';
  return [
    sku, o.long ?? `LONG-${sku}`, o.name ?? `สินค้า ${sku}`, o.lot ?? 8, o.po ?? 9900000001,
    o.from ?? '', o.to ?? '', o.qty ?? 1, o.type ?? 'รับ', o.note ?? 'โอนย้าย', o.status ?? '', o.who ?? 'สมมติ',
  ];
}
const day = (s) => new Date(`${s}T12:00:00Z`);
const sale = (o) => row({ type: 'ขาย', status: 'เปิด', ...o });

/** แท็บที่สคริปต์เขียนลงได้ สมุดรายการไม่มีเมธอดเขียนเลย ถ้าโค้ดเผลอเขียนใส่เทสต์จะล้มทันที */
function writableTab() {
  const grid = [];
  const formats = [];
  return {
    grid,
    formats,
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] ? grid[0].length : 0),
    getMaxRows: () => 1000,
    insertRowsAfter: () => {},
    setFrozenRows: () => {},
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
      setNumberFormat: (f) => formats.push({ r, c, nr, nc, f, atRow: grid.length }),
      setValues: (vals) => vals.forEach((v, i) => {
        grid[r - 1 + i] = grid[r - 1 + i] || [];
        v.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; });
      }),
    }),
  };
}

function script(rows, { props = {}, extraSheets = [] } = {}) {
  const grid = [HEAD, ...rows];
  const sheet = {
    getLastRow: () => grid.length,
    getLastColumn: () => HEAD.length,
    getSheetId: () => 77,
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
    }),
  };
  const tabs = {};
  const ss = {
    getSheets: () => [...extraSheets, sheet, ...Object.values(tabs)],
    getSheetByName: (name) => tabs[name] || null,
    insertSheet: (name) => (tabs[name] = writableTab()),
    getSpreadsheetTimeZone: () => 'UTC',
    getUrl: () => 'https://docs.example/d/1/edit',
  };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    Utilities: { formatDate: (d, tz, f) => (f === 'HH:mm' ? d.toISOString().slice(11, 16) : d.toISOString().slice(0, 10)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: {}, ScriptApp: {},
  };
  const api = new Function(...Object.keys(env), GS + '\nreturn { doGet: doGet, doPost: doPost };')(...Object.values(env));
  const call = (parameter) => api.doGet({ parameter });
  call.post = (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
  call.tabs = tabs;
  call.ledger = grid;
  return call;
}

const summary = (rows, o) => script(rows, o)({ api: 'tx-summary' });

/** ยอดของคีย์หนึ่งจากคำตอบแบบย่อ */
function bal(s, sku, loc, lot = 8) {
  const k = s.keys.find((x) => s.skus[x[0]][0] === sku && s.locs[x[3]] === loc && x[1] === lot);
  return k ? k[4] : 0;
}

describe('tx-api.gs — คิดยอดแบบเดียวกับสูตรในชีตยอด', () => {
  it('รับบวกที่ Location รับ / ขายลบที่ Location เบิก / เบิกลบต้นทางบวกปลายทาง', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 100 }),
      row({ type: 'เบิก', from: 'A-01-01', to: 'S-01-01', qty: 30, status: 'เปิด' }),
      sale({ from: 'S-01-01', qty: 5, note: day('2026-01-10') }),
      row({ type: 'เบิก', from: 'A-01-01', qty: 7, note: 'ส่งเคลม' }),
    ]);
    expect(bal(s, 'AAA001', 'A-01-01')).toBe(63);
    expect(bal(s, 'AAA001', 'S-01-01')).toBe(25);
  });

  it('LOT กับ PO คนละค่าคือคนละกอง แม้อยู่ Location เดียวกัน', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 10, lot: 8 }),
      row({ to: 'A-01-01', qty: 20, lot: 9 }),
      row({ to: 'A-01-01', qty: 40, lot: 9, po: '9900000001-02' }),
    ]);
    expect(s.keys).toHaveLength(3);
    expect(bal(s, 'AAA001', 'A-01-01', 8)).toBe(10);
  });

  it('PO เลขล้วนกับ PO ที่พิมพ์เป็นข้อความคือกองเดียวกัน และ Location ไม่สนตัวพิมพ์เล็กใหญ่', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 10, po: 9900000001 }),
      row({ to: 'a-01-01', qty: 5, po: '9900000001' }),
    ]);
    expect(s.keys).toHaveLength(1);
    expect(s.keys[0][4]).toBe(15);
  });

  it('QTY ที่ไม่ใช่ตัวเลขไม่ถูกนับ เหมือน SUMIFS และขึ้นในรายการข้อมูลผิด', () => {
    const s = summary([row({ to: 'A-01-01', qty: 10 }), row({ to: 'A-01-01', qty: 'd' }), row({ to: 'A-01-01', qty: '5' })]);
    expect(bal(s, 'AAA001', 'A-01-01')).toBe(10);
    expect(s.issues.counts.qty).toBe(2);
    expect(s.issues.list.find((i) => i.kind === 'qty' && i.value === 'd').rows).toEqual([3]);
  });

  it('แถวที่ SKU คอลัมน์ B ว่างไม่ถูกนับ แต่ถูกรายงาน', () => {
    const s = summary([row({ to: 'A-01-01', qty: 10 }), row({ long: '', to: 'A-01-01', qty: 4 })]);
    expect(bal(s, 'AAA001', 'A-01-01')).toBe(10);
    expect(s.issues.list.find((i) => i.kind === 'incomplete').what).toContain('SKU คอลัมน์ B');
  });

  it('แถวว่างทั้งแถวถูกข้าม แต่เลขแถวยังตรงกับในชีต', () => {
    const blank = Array(HEAD.length).fill('');
    const s = summary([blank, row({ to: 'A-01-01', qty: -3 })]);
    expect(s.rows).toBe(1);
    expect(s.issues.list.find((i) => i.kind === 'negative').rows).toEqual([3]);
  });

  it('จุดที่รับเข้าทั้งแบบว่างและแบบเปิด ยอดยังถูก ไม่หักแถวออกซ้ำแบบชีตยอด', () => {
    const s = summary([
      row({ to: 'B-01-01', qty: 20 }),
      row({ to: 'B-01-01', qty: 400, status: 'เปิด' }),
      sale({ from: 'B-01-01', qty: 420, note: day('2026-01-10') }),
    ]);
    expect(bal(s, 'AAA001', 'B-01-01')).toBe(0);
    expect(s.issues.list.find((i) => i.kind === 'mixed')).toMatchObject({ blank: 20, open: 400, out: 420, bal: 0, rows: [2, 3] });
  });

  it('Status ปนกัน เรียงตามจำนวนที่ชีตยอดหักซ้ำ ไม่ใช่ยอดคงเหลือ', () => {
    const s = summary([
      row({ to: 'B-01-01', qty: 500 }),
      row({ to: 'B-01-01', qty: 1, status: 'เปิด' }),
      row({ to: 'B-01-02', qty: 20 }),
      row({ to: 'B-01-02', qty: 400, status: 'เปิด' }),
      sale({ from: 'B-01-02', qty: 420, note: day('2026-01-10') }),
    ]);
    expect(s.issues.list.filter((i) => i.kind === 'mixed').map((i) => i.loc)).toEqual(['B-01-02', 'B-01-01']);
  });

  it('พิมพ์เล็กใหญ่ต่างกันใน Location คนละกอง แต่ชื่อ Location ถูกยุบเป็นชื่อเดียว', () => {
    const s = summary([row({ to: 'A-01-01', qty: 1, lot: 8 }), row({ to: 'a-01-01', qty: 1, lot: 9 })]);
    expect(s.locs).toEqual(['A-01-01']);
  });

  it('Status ของจุดหนึ่งยึดตามแถวรับล่าสุด', () => {
    const s = summary([row({ to: 'B-01-01', qty: 1 }), row({ to: 'B-01-01', qty: 1, status: 'เปิด' })]);
    expect(s.keys[0][5]).toBe(1);
    const t = summary([row({ to: 'B-01-01', qty: 1, status: 'เปิด' }), row({ to: 'B-01-01', qty: 1 })]);
    expect(t.keys[0][5]).toBe(0);
  });

  it('ยอดเป็นศูนย์ไม่ถูกส่ง', () => {
    const s = summary([row({ to: 'A-01-01', qty: 5 }), sale({ from: 'A-01-01', qty: 5, note: day('2026-01-10') })]);
    expect(s.keys).toEqual([]);
  });
});

describe('tx-api.gs — ยอดขาย', () => {
  it('นับ 14 วันถึงวันขายล่าสุดในชีต ไม่ใช่ถึงวันนี้', () => {
    const rows = [row({ to: 'S-01-01', qty: 999, status: 'เปิด' })];
    rows.push(sale({ from: 'S-01-01', qty: 100, note: day('2026-01-01') }));   // เกินช่วง
    rows.push(sale({ from: 'S-01-01', qty: 7, note: day('2026-01-16') }));     // วันแรกของช่วง 14 วัน
    rows.push(sale({ from: 'S-01-01', qty: 7, note: day('2026-01-29') }));     // วันล่าสุด
    const s = summary(rows);
    expect(s.lastDate).toBe('2026-01-29');
    expect(s.saleDays).toBe(14);
    expect(s.sold[0][1]).toBe(14);
  });

  it('ชีตที่เพิ่งเริ่มมีไม่ถึง 14 วัน หารตามจำนวนวันที่มีจริง', () => {
    const s = summary([
      row({ to: 'S-01-01', qty: 99, status: 'เปิด' }),
      sale({ from: 'S-01-01', qty: 4, note: day('2026-01-01') }),
      sale({ from: 'S-01-01', qty: 4, note: day('2026-01-04') }),
    ]);
    expect(s.saleDays).toBe(4);
  });

  it.each([
    '30/01/2026', '30/1/26', '30-01-2026', '30.01.2026', '2026-01-30', '30/01/2569', '30/1/69',
    '30/01/2026 14:05:00', ' 30/01/2026 ', '1/30/2026',
  ])('วันที่ขายที่เป็นข้อความ "%s" อ่านได้และนับยอดขาย', (text) => {
    const s = summary([row({ to: 'S-01-01', qty: 9, status: 'เปิด' }), sale({ from: 'S-01-01', qty: 4, note: text })]);
    expect(s.lastDate).toBe('2026-01-30');
    expect(s.sold[0][1]).toBe(4);
    expect(s.issues.counts.incomplete).toBeUndefined();
    expect(s.issues.counts.baddate).toBeUndefined();
  });

  it('วันที่จริงที่ instanceof Date ไม่ผ่าน และวันที่จริงที่เก็บปี พ.ศ. ก็อ่านได้', () => {
    const other = vm.runInNewContext('new Date("2026-01-30T12:00:00Z")');
    expect(other instanceof Date).toBe(false);
    for (const note of [other, new Date('2569-01-30T12:00:00Z')]) {
      const s = summary([row({ to: 'S-01-01', qty: 9, status: 'เปิด' }), sale({ from: 'S-01-01', qty: 4, note })]);
      expect(s.lastDate).toBe('2026-01-30');
      expect(s.sold[0][1]).toBe(4);
    }
  });

  it('วันที่อ่านไม่ออกจับกลุ่มตามรูปแบบ มีตัวอย่างให้ดู และไม่ไหลเป็นรายการต่อแถว', () => {
    const s = summary([
      row({ to: 'S-01-01', qty: 9, status: 'เปิด' }),
      sale({ from: 'S-01-01', qty: 1, note: '30 ต.ค.' }),
      sale({ from: 'S-01-01', qty: 1, note: '29 ต.ค.' }),
      sale({ from: 'S-01-01', qty: 1, note: 'เมื่อวาน' }),
    ]);
    expect(s.saleDays).toBe(0);
    expect(s.issues.counts).toEqual({ baddate: 2 });
    expect(s.issues.list.find((i) => i.note === '30 ต.ค.')).toMatchObject({ kind: 'baddate', rows: [3, 4], rowCount: 2 });
  });

  it('ช่องวันที่ขายว่างคือแถวไม่ครบ ไม่ใช่วันที่อ่านไม่ออก', () => {
    const s = summary([sale({ from: 'S-01-01', qty: 1, note: '' })]);
    expect(s.issues.counts.baddate).toBeUndefined();
    expect(s.issues.list.find((i) => i.kind === 'incomplete').what).toContain('วันที่ขาย');
  });

  it('วันที่ไม่ไปซ้ำในช่องหมายเหตุของประวัติ แต่ GR ยังอยู่', () => {
    const r = script([row({ to: 'S-01-01', qty: 9, note: 'GR 02-01-26' }), sale({ from: 'S-01-01', qty: 1, note: '30/01/2026' })])({ api: 'tx-history', sku: 'AAA001' });
    expect(r.items.map((i) => [i.note, i.date])).toEqual([['', '2026-01-30'], ['GR 02-01-26', '2026-01-02']]);
  });

  it('วันที่ขายที่พิมพ์ปีผิดไปข้างหน้า ไม่ทำให้ยอดขายทั้งหมดหลุดช่วง และถูกรายงาน', () => {
    const s = summary([
      row({ to: 'S-01-01', qty: 99, status: 'เปิด' }),
      sale({ from: 'S-01-01', qty: 4, note: day('2026-01-10') }),
      sale({ from: 'S-01-01', qty: 50, note: day('2062-01-10') }),
    ]);
    expect(s.lastDate).toBe('2026-01-10');
    expect(s.sold[0][1]).toBe(4);
    expect(s.issues.list.find((i) => i.kind === 'date')).toMatchObject({ note: '2062-01-10', first: 4 });
  });

  it('SKU ที่ขายอยู่แต่ของหมดเกลี้ยง ยังส่งยอดขายมา', () => {
    const s = summary([row({ to: 'S-01-01', qty: 5, status: 'เปิด' }), sale({ from: 'S-01-01', qty: 5, note: day('2026-01-10') })]);
    expect(s.keys).toEqual([]);
    expect(s.skus[s.sold[0][0]][0]).toBe('AAA001');
  });
});

describe('tx-api.gs — จุดที่ข้อมูลผิด', () => {
  it('มีแต่แถวออก แยกจากยอดติดลบทั่วไป', () => {
    const s = summary([
      row({ type: 'เบิก', from: 'D-01-01', qty: 9, note: 'โอนย้าย' }),
      row({ to: 'D-01-02', qty: 1 }),
      row({ type: 'เบิก', from: 'D-01-02', qty: 3, note: 'โอนย้าย' }),
    ]);
    expect(s.issues.list.find((i) => i.kind === 'outonly')).toMatchObject({ loc: 'D-01-01', bal: -9, rows: [2] });
    expect(s.issues.list.find((i) => i.kind === 'negative')).toMatchObject({ loc: 'D-01-02', bal: -2, rows: [3, 4] });
  });

  it('ขายไปก่อนแล้วโลค่อยปิดทีหลัง ไม่ถือว่าผิด', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 9, status: 'เปิด' }),
      sale({ from: 'A-01-01', qty: 2, note: day('2026-01-10') }),
      row({ to: 'A-01-01', qty: 9 }),
    ]);
    expect(s.issues.counts.closedsale).toBeUndefined();
  });

  it('ขายจากโลที่ตอนนั้นไม่เปิด หรือจาก RIB', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 9 }),
      sale({ from: 'A-01-01', qty: 2, note: day('2026-01-10') }),
      row({ to: 'RIB', qty: 9, status: 'เปิด' }),
      sale({ from: 'RIB', qty: 1, note: day('2026-01-10') }),
      row({ to: 'S-01-01', qty: 9, status: 'เปิด' }),
      sale({ from: 'S-01-01', qty: 1, note: day('2026-01-10') }),
    ]);
    const list = s.issues.list.filter((i) => i.kind === 'closedsale');
    expect(list.map((i) => i.loc).sort()).toEqual(['A-01-01', 'RIB']);
  });

  it('ชื่อ Location ที่ต่างกันแค่ขีด ชี้ไปชื่อที่ใช้บ่อยกว่า', () => {
    const many = Array.from({ length: 3 }, () => row({ to: 'X01-02-03', qty: 1 }));
    const s = summary([...many, row({ to: 'X-01-02-03', qty: 1 })]);
    expect(s.issues.list.find((i) => i.kind === 'locname')).toMatchObject({ name: 'X-01-02-03', like: 'X01-02-03', rows: [5] });
  });

  it('ชื่อแปลกที่ใช้น้อยถูกรายงาน ส่วนชั้นวาง QA และชื่อที่ใช้บ่อยไม่ถูกรายงาน', () => {
    const often = Array.from({ length: 11 }, () => row({ to: 'DOCK', qty: 1 }));
    const s = summary([...often, row({ to: 'ทางเดินผิด', qty: 1 }), row({ to: 'QA', qty: 1 }), row({ to: 'OFFICE-01-01', qty: 1 }), row({ to: 'C-01-01-01', qty: 1 })]);
    expect(s.issues.list.filter((i) => i.kind === 'locname').map((i) => i.name)).toEqual(['ทางเดินผิด']);
  });

  it('GR ที่วันที่ห่างจากแถวขายรอบข้างมาก จับกลุ่มตามข้อความ', () => {
    const s = summary([
      row({ to: 'A-01-01', qty: 1, note: 'GR 01-08-26' }),
      sale({ from: 'A-01-01', qty: 1, note: day('2026-08-02') }),
      row({ to: 'A-01-01', qty: 1, note: 'GR 05-03-26' }),
      row({ to: 'A-01-01', qty: 1, note: 'GR 05-03-26' }),
      row({ to: 'A-01-01', qty: 1, note: 'GR 3-08-26' }),
    ]);
    const list = s.issues.list.filter((i) => i.kind === 'date');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note: 'GR 05-03-26', near: '2026-08-02', first: 4, last: 5, rowCount: 2 });
  });

  it('แถวไม่ครบบอกว่าขาดช่องไหน', () => {
    const s = summary([sale({ from: 'A-01-01', note: '', who: '' })]);
    const i = s.issues.list.find((x) => x.kind === 'incomplete');
    expect(i.what).toContain('วันที่ขาย');
    expect(i.what).toContain('ชื่อคนกรอก');
  });
});

describe('tx-api.gs — การตอบกลับ', () => {
  it('ไม่ใส่ api บอกแค่ว่าเป็นสคริปต์นี้ ไม่แตะข้อมูล', () => {
    expect(script([])({})).toEqual({ app: 'transaction' });
  });

  it('หาชีตจากหัวตาราง ข้ามชีตอื่น และบอกตรง ๆ ถ้าไม่เจอ', () => {
    const other = {
      getLastRow: () => 1, getLastColumn: () => 8,
      getRange: () => ({ getValues: () => [['อย่างอื่น', 'อย่างอื่น']] }),
    };
    expect(summary([row({ to: 'A-01-01' })], { extraSheets: [other] }).rows).toBe(1);

    const env = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [other] }) },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    };
    const api = new Function(...Object.keys(env), GS + '\nreturn { doGet: doGet };')(...Object.values(env));
    expect(api.doGet({ parameter: { api: 'tx-summary' } }).error).toContain('ไม่พบชีต Transaction');
  });

  it('บอกว่า Backup ครั้งล่าสุดเมื่อไหร่ และให้ข้อมูลทำลิงก์กลับไปที่แถว', () => {
    const s = summary([], { props: { backup: JSON.stringify({ at: 5, name: 'x' }) } });
    expect(s.backup.at).toBe(5);
    expect(s.sheet).toEqual({ url: 'https://docs.example/d/1/edit', gid: 77 });
  });

  it('ค่าที่ตั้งในไฟล์ของ repo ไม่มีชื่อชีตจริงติดมา', () => {
    expect(GS).toContain("var TX_SHEET = '';");
  });

  it('คำสั่งเขียนลงชีตมีเฉพาะในส่วนนับสต๊อก ส่วนที่อ่านสมุดรายการไม่มีเลย', () => {
    const start = GS.indexOf('/* ── นับสต๊อก');
    const end = GS.indexOf('/* ── Backup');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const WRITES = /\.(setValue|setValues|appendRow|clearContent|insertRows|deleteRow|setFormula)\w*\(/;
    expect(GS.slice(0, start)).not.toMatch(WRITES);
    expect(GS.slice(end)).not.toMatch(WRITES);
  });
});

describe('tx-api.gs — นับสต๊อก', () => {
  const COUNT = 'นับสต๊อก';
  /* ของบนชั้นสำรองที่ไม่มีอะไรผิด ใช้เป็นตัวเลือกของรายการสุ่ม */
  const shelf = (n, o = {}) => row({ sku: `RND${String(n).padStart(3, '0')}`, to: `B-01-${String(n).padStart(2, '0')}`, qty: 10, ...o });
  const onDay = (s) => vi.setSystemTime(new Date(`${s}T05:00:00Z`));
  const load = (api) => api({ api: 'tx-count' });
  const todo = (v) => v.lines.filter((l) => l.date === v.today && l.qty === undefined);
  const saveAll = (api, v, qty = 10, who = 'สมมติ') => api.post({
    op: 'count-save', date: v.today, who, items: todo(v).map((l) => ({ k: l.k, qty })),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    onDay('2026-03-10');
  });
  afterEach(() => vi.useRealTimers());

  it('เปิดครั้งแรกสร้างแท็บและออกรายการ โดยสมุดรายการไม่เปลี่ยนสักช่อง', () => {
    const api = script([shelf(1), shelf(2)]);
    const before = JSON.stringify(api.ledger);
    const v = load(api);
    expect(v.today).toBe('2026-03-10');
    expect(v.lines.map((l) => l.sku)).toEqual(['RND001', 'RND002']);
    expect(api.tabs[COUNT].grid[0]).toContain('นับได้');
    expect(JSON.stringify(api.ledger)).toBe(before);
    expect(load(api).lines.length).toBe(2);
  });

  it('แท็บนับสต๊อกไม่ทำให้สคริปต์สับสนว่าสมุดรายการคือแท็บไหน', () => {
    const api = script([shelf(1)]);
    load(api);
    expect(api({ api: 'tx-summary' }).keys.length).toBe(1);
  });

  it('รายการที่ยังไม่นับไม่มียอดในระบบหรือเหตุผลส่งไปด้วย', () => {
    const v = load(script([row({ to: 'A-01-01', qty: 1 }), sale({ from: 'A-01-01', qty: 5, note: day('2026-03-01') })]));
    expect(v.lines).toHaveLength(1);
    expect(Object.keys(v.lines[0]).sort()).toEqual(['date', 'k', 'loc', 'lot', 'name', 'po', 'sku', 'src'].sort());
    expect(v.lines[0].src).toBe('เสี่ยง');
  });

  it('วันเดียวกันได้รายการเดิม เปิดกี่รอบแถวก็ไม่เพิ่ม', () => {
    const api = script(Array.from({ length: 40 }, (_, i) => shelf(i + 1)));
    const a = load(api);
    const b = load(api);
    expect(b.lines.map((l) => l.k)).toEqual(a.lines.map((l) => l.k));
    expect(api.tabs[COUNT].grid).toHaveLength(21);
  });

  it('วันที่และรหัสตั้งเป็นข้อความก่อนเขียน และอ่านกลับได้แม้ชีตแปลงวันที่เอง', () => {
    const api = script([shelf(1, { lot: 0.11, po: 2603000236 })]);
    const v = load(api);
    const tab = api.tabs[COUNT];
    expect(tab.grid[1][0]).toBe('2026-03-10');
    expect(tab.grid[1][7]).toBe('0.11');
    expect(tab.grid[1][8]).toBe('2603000236');
    expect(tab.formats.filter((f) => f.f === '@').every((f) => f.atRow === 1)).toBe(true);
    expect(tab.formats.filter((f) => f.f === '@')[0]).toMatchObject({ r: 2, c: 1, nc: 9 });

    tab.grid[1][0] = day('2026-03-10');
    expect(load(api).lines.map((l) => l.k)).toEqual(v.lines.map((l) => l.k));
  });

  it('รายการเสี่ยงมาก่อน ยอดติดลบนำ แล้วขายจากโลไม่เปิด แล้ว Status ปนกัน และไม่เกินโควตา', () => {
    const neg = (n, qty) => {
      const loc = `A-01-${String(n).padStart(2, '0')}`;
      return [row({ sku: `NEG${n}`, to: loc, qty: 1 }), sale({ sku: `NEG${n}`, from: loc, qty, note: day('2026-03-01') })];
    };
    const v = load(script([
      ...neg(1, 3), ...neg(2, 9),
      row({ sku: 'CLS001', to: 'A-02-01', qty: 9 }), sale({ sku: 'CLS001', from: 'A-02-01', qty: 2, note: day('2026-03-01') }),
      row({ sku: 'MIX001', to: 'A-03-01', qty: 5 }), row({ sku: 'MIX001', to: 'A-03-01', qty: 5, status: 'เปิด' }),
    ]));
    expect(v.lines.map((l) => [l.sku, l.src])).toEqual([
      ['NEG1', 'เสี่ยง'], ['NEG2', 'เสี่ยง'], ['CLS001', 'เสี่ยง'], ['MIX001', 'เสี่ยง'],
    ]);

    const many = script(Array.from({ length: 15 }, (_, i) => neg(String(i).padStart(2, '0'), 5 + i)).flat()
      .concat(Array.from({ length: 30 }, (_, i) => shelf(i + 1))));
    const risky = load(many).lines.filter((l) => l.src === 'เสี่ยง');
    expect(risky).toHaveLength(10);
    /* หนักสุดถูกเลือกก่อน */
    expect(risky.map((l) => l.sku)).toContain('NEG14');
    expect(risky.map((l) => l.sku)).not.toContain('NEG00');
    expect(load(many).lines).toHaveLength(20);
  });

  it('รายการสุ่มเลือกเฉพาะชั้นวางสำรองที่มีของ ไม่เอาโลเปิด QA IQA RIB จุดที่ไม่ใช่ชั้นวาง และยอดศูนย์', () => {
    const v = load(script([
      shelf(1),
      row({ sku: 'OPN001', to: 'S-01-01', qty: 5, status: 'เปิด' }),
      row({ sku: 'SPC001', to: 'QA', qty: 5 }), row({ sku: 'SPC002', to: 'IQA', qty: 5 }), row({ sku: 'SPC003', to: 'RIB', qty: 5 }),
      row({ sku: 'ODD001', to: 'จุดสมมติ', qty: 5 }),
      row({ sku: 'ZER001', to: 'B-02-01', qty: 5 }), row({ sku: 'ZER001', type: 'เบิก', from: 'B-02-01', qty: 5 }),
    ]));
    expect(v.lines.map((l) => [l.sku, l.src])).toEqual([['RND001', 'สุ่ม']]);
  });

  it('สุ่มได้ผลเดิมถ้าข้อมูลกับวันเดิม คนละวันได้ชุดต่างกัน และเรียงตาม Location ให้เดินนับได้', () => {
    const rows = Array.from({ length: 60 }, (_, i) => shelf(i + 1));
    const a = load(script(rows)).lines.map((l) => l.loc);
    expect(load(script(rows)).lines.map((l) => l.loc)).toEqual(a);
    expect(a).toEqual([...a].sort());
    onDay('2026-03-11');
    expect(load(script(rows)).lines.map((l) => l.loc)).not.toEqual(a);
  });

  it('บันทึกผลนับเติมเฉพาะช่องผลนับ และคิดยอดในระบบ ณ ตอนส่ง', () => {
    const rows = [shelf(1)];
    const api = script(rows);
    const v = load(api);
    /* มีของออกหลังออกรายการแล้ว */
    api.ledger.push(row({ sku: 'RND001', type: 'เบิก', from: 'B-01-01', qty: 4 }));

    vi.setSystemTime(new Date('2026-03-10T07:30:00Z'));
    const r = api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k: v.lines[0].k, qty: 5 }] });
    expect(r.saved).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.lines[0]).toMatchObject({ qty: 5, exp: 6, diff: -1, who: 'สมมติ', at: '07:30', why: 'สุ่มตรวจ' });
    const saved = api.tabs[COUNT].grid[1];
    expect(saved.slice(9, 14)).toEqual([5, 6, -1, 'สมมติ', '07:30']);
    expect(saved.slice(3, 5)).toEqual(['B-01-01', 'RND001']);
  });

  it('LOT เป็นทศนิยมและ PO เป็นตัวเลขเทียบกับสมุดรายการตรง', () => {
    const api = script([shelf(1, { lot: 0.11, po: 2603000236 })]);
    const v = load(api);
    expect(saveAll(api, v, 10).lines[0]).toMatchObject({ exp: 10, diff: 0 });
  });

  it('ผลนับเขียนได้ครั้งเดียว รหัสที่ไม่อยู่ในรายการเพิ่มแถวไม่ได้', () => {
    const api = script([shelf(1)]);
    const v = load(api);
    const k = v.lines[0].k;
    api.post({ op: 'count-save', date: v.today, who: 'คนแรก', items: [{ k, qty: 10 }] });
    const size = api.tabs[COUNT].grid.length;
    const r = api.post({ op: 'count-save', date: v.today, who: 'คนสอง', items: [{ k, qty: 3 }, { k: 'X|Y|Z|W', qty: 1 }] });
    expect(r).toMatchObject({ saved: 0, skipped: 2 });
    expect(r.lines[0]).toMatchObject({ qty: 10, who: 'คนแรก' });
    expect(api.tabs[COUNT].grid).toHaveLength(size);
  });

  it('รหัสซ้ำในคำขอเดียวเก็บแค่ค่าแรก', () => {
    const api = script([shelf(1)]);
    const v = load(api);
    const k = v.lines[0].k;
    const r = api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k, qty: 10 }, { k, qty: 3 }] });
    expect(r).toMatchObject({ saved: 1, skipped: 1 });
    expect(r.lines[0].qty).toBe(10);
  });

  it.each([[-1], ['5'], [null], [Infinity]])('จำนวน %s ถูกปฏิเสธทั้งชุด ไม่มีอะไรถูกเขียน', (qty) => {
    const api = script([shelf(1), shelf(2)]);
    const v = load(api);
    const before = JSON.stringify(api.tabs[COUNT].grid);
    const r = api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k: v.lines[0].k, qty: 1 }, { k: v.lines[1].k, qty }] });
    expect(r.error).toBeTruthy();
    expect(JSON.stringify(api.tabs[COUNT].grid)).toBe(before);
  });

  it('คำขอที่ไม่มีรายการหรือคำสั่งไม่รู้จักตอบ error', () => {
    const api = script([shelf(1)]);
    expect(api.post({ op: 'count-save', date: '2026-03-10', items: [] }).error).toBeTruthy();
    expect(api.post({ op: 'อะไรก็ไม่รู้' }).error).toBeTruthy();
  });

  it('ชื่อคนนับที่ขึ้นต้นเหมือนสูตรไม่กลายเป็นสูตรในชีต', () => {
    const api = script([shelf(1)]);
    const v = load(api);
    api.post({ op: 'count-save', date: v.today, who: '=IMPORTXML("https://x.example","//a")', items: [{ k: v.lines[0].k, qty: 10 }] });
    expect(String(api.tabs[COUNT].grid[1][12]).startsWith('=')).toBe(false);
  });

  it('วันถัดไป: ไม่ตรงกลับมานับซ้ำ ตรงแล้วพัก 30 วัน', () => {
    const api = script([shelf(1), shelf(2), shelf(3)]);
    const v = load(api);
    const [a, b, c] = v.lines;
    api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k: a.k, qty: 7 }, { k: b.k, qty: 10 }] });

    onDay('2026-03-11');
    const d2 = load(api);
    const today = d2.lines.filter((l) => l.date === '2026-03-11');
    /* a ไม่ตรง นับซ้ำ / b ตรง พัก / c ยังไม่ได้นับ ถูกเลือกได้อีก */
    expect(today.map((l) => [l.k, l.src])).toEqual([[a.k, 'นับซ้ำ'], [c.k, 'สุ่ม']]);
    /* รายการของเมื่อวานที่ไม่ได้นับไม่ค้างอยู่ในหน้าเว็บ */
    expect(d2.lines.filter((l) => l.date === '2026-03-10').map((l) => l.k)).toEqual([a.k, b.k]);

    onDay('2026-04-09');
    expect(load(api).lines.filter((l) => l.date === '2026-04-09').map((l) => l.k)).toContain(b.k);
  });

  it('นับซ้ำแล้วยังไม่ตรงไม่เรียกซ้ำอีก จนครบเวลาพัก', () => {
    const api = script([shelf(1)]);
    const v = load(api);
    const k = v.lines[0].k;
    api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k, qty: 7 }] });
    onDay('2026-03-11');
    const d2 = load(api);
    expect(d2.lines.find((l) => l.date === '2026-03-11').src).toBe('นับซ้ำ');
    api.post({ op: 'count-save', date: d2.today, who: 'สมมติ', items: [{ k, qty: 7 }] });
    onDay('2026-03-12');
    expect(load(api).lines.filter((l) => l.date === '2026-03-12')).toEqual([]);
  });

  it('ผลนับเก่ากว่า 30 วันไม่ส่งไปหน้าเว็บ แต่ยังอยู่ในแท็บ', () => {
    const api = script([shelf(1)]);
    const v = load(api);
    saveAll(api, v);
    onDay('2026-04-20');
    const later = load(api);
    expect(later.lines.filter((l) => l.date === '2026-03-10')).toEqual([]);
    expect(api.tabs[COUNT].grid[1][0]).toBe('2026-03-10');
  });

  it('ไม่มีอะไรให้นับก็ตอบรายการว่าง ไม่ล้ม', () => {
    expect(load(script([])).lines).toEqual([]);
  });
});

describe('tx-api.gs — ประวัติ', () => {
  const rows = [
    row({ to: 'C-01-01', qty: 100, note: 'GR 01-01-26' }),
    row({ sku: 'BBB002', to: 'C-01-01', qty: 9 }),
    row({ type: 'เบิก', from: 'C-01-01', to: 'S-01-01', qty: 30, status: 'เปิด', note: 'โอนย้าย' }),
    sale({ from: 'S-01-01', qty: 5, note: day('2026-01-05') }),
    row({ to: 'S-01-01', qty: 1, note: 'RETURN' }),
  ];

  it('ใหม่สุดก่อน คงเหลือคิดสะสม โอนย้ายไม่เปลี่ยนยอดรวม', () => {
    const r = script(rows)({ api: 'tx-history', sku: 'AAA001' });
    expect(r.count).toBe(4);
    expect(r.left).toBe(96);
    expect(r.items.map((i) => [i.row, i.change, i.left])).toEqual([[6, 1, 96], [5, -5, 95], [4, 0, 100], [2, 100, 100]]);
  });

  it('แถวที่ไม่มีวันที่ของตัวเอง ยืมจากแถวก่อนหน้าและบอกว่าเป็นวันที่โดยประมาณ', () => {
    const r = script(rows)({ api: 'tx-history', sku: 'AAA001' });
    expect(r.items.find((i) => i.row === 4)).toMatchObject({ date: '2026-01-01', approx: true });
    expect(r.items.find((i) => i.row === 5)).toMatchObject({ date: '2026-01-05', approx: false });
  });

  it('ค้นด้วยรหัสยาวก็ได้ และตัดเหลือช่วงล่าสุดโดยคงเหลือยังถูก', () => {
    const many = Array.from({ length: 510 }, () => row({ to: 'C-01-01', qty: 1 }));
    const r = script(many)({ api: 'tx-history', sku: 'long-aaa001' });
    expect(r.count).toBe(510);
    expect(r.items).toHaveLength(500);
    expect(r.items[0].left).toBe(510);
  });

  it('ไม่ระบุ SKU บอกตรง ๆ', () => {
    expect(script(rows)({ api: 'tx-history' }).error).toBeTruthy();
  });
});

describe('tx-api.gs — Backup', () => {
  /** ไฟล์ในโฟลเดอร์ Backup: เรียงจากเก่าไปใหม่ตามลำดับที่ให้มา สำเนาใหม่ต่อท้ายเสมอ */
  function drive(names, { hasFolder = true } = {}) {
    const trashed = [];
    const props = {};
    const file = (name, i) => ({
      getName: () => name,
      getDateCreated: () => new Date(2026, 0, i + 1),
      setTrashed: (v) => { if (v) trashed.push(name); },
    });
    const files = names.map(file);
    const folder = {
      getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
    };
    let made = 0;
    const triggers = [{ name: 'backupNow' }, { name: 'อย่างอื่น' }];
    const deleted = [];
    const created = [];
    const env = {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'UTC', getId: () => 'id1', getName: () => 'Transaction' }) },
      Utilities: { formatDate: () => '2026-01-01 02:00' },
      PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => { props[k] = JSON.parse(v); } }) },
      ContentService: {},
      DriveApp: {
        getFoldersByName: () => { let left = hasFolder ? 1 : 0; return { hasNext: () => left > 0, next: () => { left--; return folder; } }; },
        createFolder: () => { made++; return folder; },
        getFileById: () => ({ makeCopy: (name, into) => { expect(into).toBe(folder); files.push(file(name, files.length)); } }),
      },
      ScriptApp: {
        getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.name, name: t.name })),
        deleteTrigger: (t) => deleted.push(t.name),
        newTrigger: (fn) => ({ timeBased: () => ({ everyDays: (d) => ({ atHour: (h) => ({ create: () => created.push([fn, d, h]) }) }) }) }),
      },
    };
    const api = new Function(...Object.keys(env), GS + '\nreturn { backupNow: backupNow, installBackup: installBackup };')(...Object.values(env));
    return { api, trashed, props, deleted, created, made: () => made, files };
  }
  const old = (n) => Array.from({ length: n }, (_, i) => `Backup ${String(i).padStart(2, '0')}`);

  it('เก็บ 30 ไฟล์ล่าสุด ไฟล์อื่นในโฟลเดอร์ไม่ถูกแตะ และลบแบบลงถังขยะเท่านั้น', () => {
    const d = drive(['งานคนอื่น', ...old(32)]);
    d.api.backupNow();
    expect(d.trashed).toEqual(['Backup 02', 'Backup 01', 'Backup 00']);
    expect(d.props.backup).toMatchObject({ kept: 30 });
    expect(d.props.backup.name).toContain('Transaction');
  });

  it('ยังมีไม่ครบ ไม่ลบอะไร และสร้างโฟลเดอร์ให้ถ้ายังไม่มี', () => {
    const d = drive([], { hasFolder: false });
    d.api.backupNow();
    expect(d.made()).toBe(1);
    expect(d.trashed).toEqual([]);
    expect(d.props.backup.kept).toBe(1);
  });

  it('ตั้งเวลาทับตัวเดิมของตัวเอง ไม่ซ้อนกัน และทำสำเนาแรกทันที', () => {
    const d = drive([]);
    d.api.installBackup();
    expect(d.deleted).toEqual(['backupNow']);
    expect(d.created).toEqual([['backupNow', 1, 2]]);
    expect(d.files).toHaveLength(1);
  });
});

describe('wms-tx.js', () => {
  let WmsTx, session;

  beforeEach(() => {
    session = new Map();
    const win = {};
    new Function('window', 'sessionStorage', 'console', JS)(win, {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
    }, { warn: () => {} });
    WmsTx = win.WmsTx;
  });

  const DATA = {
    app: 'transaction', saleDays: 10, lastDate: '2026-01-29', rows: 9,
    skus: [['AAA001', 'LONG-1', 'หมอน'], ['BBB002', 'LONG-2', 'ที่นอน'], ['CCC003', 'LONG-3', 'ผ้านวม'], ['DDD004', 'LONG-4', 'นาน ๆ ขายที']],
    locs: ['S-01-01', 'A-01-01', 'A-01-02', 'QA', 'RIB', 'หน้าโกดัง', 'S-02-01'],
    keys: [
      [0, 8, '100', 0, 20, 1],      // AAA001 โลเปิด 20
      [0, 9, '101', 1, 300, 0],     // สำรอง LOT 9
      [0, 8, '102', 2, 50, 0],      // สำรอง LOT 8 ต้องมาก่อน แม้น้อยกว่า
      [0, 0, '0', 1, 900, 0],       // LOT 0 ไม่รู้ LOT ต้องอยู่ท้ายสุด
      [0, 8, '103', 3, 40, 0],      // QA ไม่นับเป็นสำรอง
      [0, 8, '104', 4, 10, 1],      // RIB ไม่นับเป็นโลเปิดแม้ Status เปิด
      [0, 0, '0', 3, -2, 0],        // ติดลบ
      [1, 8, '200', 5, 5, 1],       // BBB002 จุดที่ไม่ใช่ชั้นวางแต่เปิด = โลเปิด
      [1, 8, '201', 3, 7, 0],       // มีแค่ใน QA = ไม่มีสำรอง
      [2, 8, '300', 6, 500, 1],     // CCC003 พอขายนาน
      [3, 8, '400', 1, 3, 0],       // DDD004 ขายน้อย
    ],
    sold: [[0, 100], [1, 50], [2, 10], [3, 2]],   // ต่อวัน 10, 5, 1, 0.2
    issues: { counts: {}, list: [] },
  };

  it('แยกกลุ่ม: เปิด สำรอง และ QA / IQA / RIB ที่ไม่นับเป็นสำรอง', () => {
    expect(WmsTx.bucketOf('A-01-01', 0)).toBe('reserve');
    expect(WmsTx.bucketOf('A-01-01', 1)).toBe('open');
    expect(WmsTx.bucketOf('หน้าโกดัง', 1)).toBe('open');
    expect(WmsTx.bucketOf('rib', 1)).toBe('RIB');
    expect(WmsTx.bucketOf('QA', 0)).toBe('QA');
  });

  it('ยอดรวมแยกกลุ่ม ยอดติดลบไม่ไปหักในกลุ่ม แต่หักในยอดสุทธิ', () => {
    const d = WmsTx.expand(DATA);
    expect(d.skus.AAA001).toMatchObject({ open: 20, reserve: 1250, QA: 40, RIB: 10, total: 1318, perDay: 10, cover: 2 });
    expect(d.totals).toMatchObject({ open: 525, reserve: 1253, QA: 47, RIB: 10, neg: -2, net: 1833, skus: 4, openLocs: 3 });
  });

  it('เรียงแถวของ SKU: โลเปิดก่อน แล้วสำรองจาก LOT เก่าไปใหม่ LOT 0 ท้ายกลุ่ม', () => {
    const rows = WmsTx.expand(DATA).skus.AAA001.rows.map((r) => [r.bucket, r.lot]);
    expect(rows.slice(0, 4)).toEqual([['open', 8], ['reserve', 8], ['reserve', 9], ['reserve', 0]]);
  });

  it('ดึงจาก: LOT เก่าสุดก่อน LOT 0 ท้ายสุด ไม่ดึงจาก QA หรือ RIB', () => {
    const d = WmsTx.expand(DATA);
    expect(WmsTx.source(d.skus.AAA001)).toEqual({ lot: 8, loc: 'A-01-02', qty: 50 });
    expect(WmsTx.source(d.skus.BBB002)).toBe(null);
  });

  it('รายการต้องเติม: แยกมีสำรอง/ไม่มีสำรอง เรียงตามที่จะหมดก่อน และนับรายการที่ซ่อน', () => {
    const d = WmsTx.expand(DATA);
    const r = WmsTx.refill(d, 3);
    expect(r.ready.map((x) => x.sku)).toEqual(['AAA001']);
    expect(r.none.map((x) => x.sku)).toEqual(['BBB002']);
    expect(r.hiddenReady).toBe(1);   // DDD004 ขายไม่ถึงวันละ 1
    expect(r.hiddenNone).toBe(0);
    expect(WmsTx.refill(d, 1).none.map((x) => x.sku)).toEqual([]);   // BBB002 พอขาย 1 วันพอดี
  });

  it('SKU ที่ขายอยู่แต่ของหมด ขึ้นในรายการไม่มีสำรอง', () => {
    const d = WmsTx.expand({ ...DATA, keys: [], sold: [[1, 50]] });
    expect(WmsTx.refill(d, 3).none.map((x) => x.sku)).toEqual(['BBB002']);
  });

  it('งานเติมของอ่านเป็นประโยค และบอกเมื่อยังมีของอยู่ที่ QA, IQA, RIB', () => {
    expect(WmsTx.coverText({ open: 44, cover: 1.76 })).toBe('เหลือขายอีก 1.8 วัน');
    expect(WmsTx.coverText({ open: 0, cover: 0 })).toBe('ของในโลเปิดหมดแล้ว');
    expect(WmsTx.noReserveText({ QA: 1, IQA: 0, RIB: 2 })).toBe('ไม่มีของบนชั้นวาง มีอยู่ที่ QA, IQA, RIB 3 ชิ้น');
    expect(WmsTx.noReserveText({ QA: 0, IQA: 0, RIB: 0 })).toBe('ไม่มีของบนชั้นวาง ต้องตามของเข้า');
  });

  it('ค้นได้ทั้งรหัส รหัสยาว ชื่อ และ Location', () => {
    const d = WmsTx.expand(DATA);
    expect(WmsTx.search(d, 'aaa').skus.map((x) => x.sku)).toEqual(['AAA001']);
    expect(WmsTx.search(d, 'long-2').skus.map((x) => x.sku)).toEqual(['BBB002']);
    expect(WmsTx.search(d, 'ที่นอน').skus.map((x) => x.sku)).toEqual(['BBB002']);
    expect(WmsTx.search(d, 'a-01').locs.map((l) => l.loc)).toEqual(['A-01-01', 'A-01-02']);
    expect(WmsTx.search(d, '  ')).toEqual({ skus: [], locs: [] });
  });

  it('URL ของสคริปต์อื่น ถูกบอกว่าใส่ผิดตัว', () => {
    expect(() => WmsTx.parse({ headers: [], rows: [] })).toThrow('tx-api.gs');
    expect(() => WmsTx.parse({ error: 'พัง' })).toThrow('พัง');
  });

  it('รายการข้อมูลผิดแยกเป็นช่องตามแต่ละเรื่อง', () => {
    const base = { sku: 'AAA001', lot: 8, po: '100', loc: 'A-01-01' };
    const kindOf = (kind) => WmsTx.ISSUES.find((k) => k.kind === kind);
    const heads = (kind) => kindOf(kind).cols.map((c) => c.label);
    const cells = (i) => kindOf(i.kind).cols.map((c) => c.value(i));

    expect(heads('closedsale')).toEqual(['SKU', 'Lot', 'PO', 'Location', 'ขายออก']);
    expect(cells({ ...base, kind: 'closedsale', sold: 1500 })).toEqual(['AAA001', '8', '100', 'A-01-01', '1,500']);
    expect(cells({ ...base, kind: 'mixed', blank: 20, open: 400, out: 420, bal: 0 }))
      .toEqual(['AAA001', '8', '100', 'A-01-01', '20', '400', '420', '0']);
    expect(cells({ ...base, kind: 'outonly', bal: -70 })).toEqual(['AAA001', '8', '100', 'A-01-01', '70']);
    expect(cells({ ...base, kind: 'negative', bal: -70 })).toEqual(['AAA001', '8', '100', 'A-01-01', '70']);
    expect(cells({ ...base, kind: 'qty', value: 'สิบ' })).toEqual(['AAA001', '8', 'A-01-01', 'สิบ']);
    expect(cells({ kind: 'incomplete', sku: '', what: 'QTY, Note' })).toEqual(['ไม่มีรหัส', 'QTY, Note']);
    expect(cells({ kind: 'baddate', note: '30 ต.ค.', rowCount: 1200 })).toEqual(['30 ต.ค.', '1,200']);
    expect(cells({ kind: 'locname', name: 'R-1', like: 'R1' })).toEqual(['R-1', 'น่าจะเป็นที่เดียวกับ R1']);
    expect(cells({ kind: 'locname', name: 'จุดแปลก', like: '', rowCount: 3 })).toEqual(['จุดแปลก', 'ใช้แค่ 3 แถว']);
    expect(cells({ kind: 'date', note: 'GR 05-03-26', rowCount: 9, near: '2026-08-02' })).toEqual(['GR 05-03-26', '9', '02/08']);
  });

  it('ช่องที่ไม่มีค่าแสดงเป็นขีด ไม่ใช่ช่องว่าง และ LOT 0 ยังเป็นเลข 0', () => {
    const closed = WmsTx.ISSUES.find((k) => k.kind === 'closedsale');
    expect(closed.cols.map((c) => c.value({ sku: 'AAA001', lot: 0, po: '0', loc: 'A-01-01', sold: 1 })))
      .toEqual(['AAA001', '0', '–', 'A-01-01', '1']);
    expect(closed.cols.map((c) => c.value({ sku: 'AAA001', lot: '', po: '', loc: 'A-01-01', sold: 1 })))
      .toEqual(['AAA001', '–', '–', 'A-01-01', '1']);
    for (const k of WmsTx.ISSUES) expect(k.cols.length).toBeGreaterThan(0);
  });

  it('ลิงก์เปิดชีตตรงแถว', () => {
    expect(WmsTx.rowUrl({ url: 'https://x/edit', gid: 7 }, 12)).toBe('https://x/edit#gid=7&range=A12');
    expect(WmsTx.rowUrl(null, 12)).toBe('');
  });

  it('Backup ที่หายไปเกินสองวัน หรือยังไม่เคยตั้ง ต้องเตือน', () => {
    const now = 10 * 86400000;
    expect(WmsTx.backupState(null, now)).toEqual({ ok: false, days: null });
    expect(WmsTx.backupState({ at: now - 86400000 }, now)).toEqual({ ok: true, days: 1 });
    expect(WmsTx.backupState({ at: now - 2 * 86400000 }, now)).toEqual({ ok: false, days: 2 });
  });

  it('M/E คืองาน Event', () => {
    expect(WmsTx.isEvent('M/E-00123')).toBe(true);
    expect(WmsTx.isEvent('RETURN M/E')).toBe(true);
    expect(WmsTx.isEvent('RETURN')).toBe(false);
  });

  it('ดึงแล้วเก็บลงแคชของรอบนี้ และยิงด้วย api ที่ถูก', async () => {
    const seen = [];
    const win = {};
    new Function('window', 'sessionStorage', 'console', JS)(win, {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
    }, { warn: () => {} });
    win.WmsGas = { json: async (url, api) => { seen.push([url, api]); return api === 'tx-summary' ? DATA : { app: 'transaction', items: [] }; } };
    await win.WmsTx.pull('https://x/exec');
    expect(win.WmsTx.read().rows).toBe(9);
    await win.WmsTx.pullHistory('https://x/exec', 'ผ้า 1');
    expect(seen).toEqual([['https://x/exec', 'tx-summary'], ['https://x/exec?sku=%E0%B8%9C%E0%B9%89%E0%B8%B2%201', 'tx-history']]);
  });

  it('แคชเสียหรือว่างไม่ทำให้หน้าพัง', () => {
    expect(WmsTx.read()).toBe(null);
    session.set(WmsTx.KEY, '{oops');
    expect(WmsTx.read()).toBe(null);
  });
});

describe('wms-tx.js — นับสต๊อก', () => {
  let WmsTx, win, store;

  beforeEach(() => {
    store = new Map();
    win = {};
    new Function('window', 'sessionStorage', 'localStorage', 'console', JS)(win, {
      getItem: () => null, setItem: () => {},
    }, {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    }, { warn: () => {} });
    WmsTx = win.WmsTx;
  });

  const TODAY = '2026-03-10';
  const line = (o) => ({ k: 'K1', date: TODAY, src: 'สุ่ม', loc: 'B-01-01', sku: 'AAA001', name: 'หมอน', lot: '8', po: '100', ...o });
  const done = (o) => line({ qty: 10, exp: 10, diff: 0, who: 'สมมติ', at: '09:00', why: 'สุ่มตรวจ', ...o });

  it('แยกรายการของวันนี้เป็นที่ยังไม่นับกับนับแล้ว', () => {
    const s = WmsTx.countStats({ today: TODAY, lines: [line({ k: 'A' }), done({ k: 'B' }), done({ k: 'C', date: '2026-03-01' })] });
    expect(s.total).toBe(2);
    expect(s.todo.map((l) => l.k)).toEqual(['A']);
    expect(s.done.map((l) => l.k)).toEqual(['B']);
  });

  it('ความแม่นยำคิดจากรายการสุ่มที่นับแล้วเท่านั้น', () => {
    const s = WmsTx.countStats({ today: TODAY, lines: [
      done({ k: 'A' }), done({ k: 'B' }), done({ k: 'C' }), done({ k: 'D', qty: 7, diff: -3 }),
      done({ k: 'E', src: 'เสี่ยง', qty: 0, diff: -10 }), done({ k: 'F', src: 'นับซ้ำ', qty: 0, diff: -10 }),
      line({ k: 'G' }),
    ] });
    expect(s).toMatchObject({ sample: 4, match: 3, accuracy: 75 });
  });

  it('ยังไม่มีรายการสุ่มที่นับแล้ว ความแม่นยำเป็น null ไม่ใช่ศูนย์', () => {
    const s = WmsTx.countStats({ today: TODAY, lines: [line({})] });
    expect(s.accuracy).toBe(null);
    expect(s.sample).toBe(0);
  });

  it('ไม่ตรงค้างอยู่ยึดผลล่าสุดของแต่ละรายการ ไม่รวมของวันนี้ และต่างมากขึ้นก่อน', () => {
    const s = WmsTx.countStats({ today: TODAY, lines: [
      done({ k: 'FIXED', date: '2026-03-01', qty: 7, diff: -3 }), done({ k: 'FIXED', date: '2026-03-02', src: 'นับซ้ำ', diff: 0 }),
      done({ k: 'SMALL', date: '2026-03-02', qty: 9, diff: -1 }),
      done({ k: 'BIG', date: '2026-03-02', src: 'นับซ้ำ', qty: 5, diff: -5 }),
      done({ k: 'NOW', qty: 1, diff: -9 }),
    ] });
    expect(s.off.map((l) => l.k)).toEqual(['BIG', 'SMALL']);
  });

  it('แก้ในชีตจนยอดเท่าที่นับได้แล้ว รายการหายจากที่ต้องตาม รวมถึงกรณีแก้จนยอดเป็นศูนย์', () => {
    const raw = {
      skus: [['AAA001', 'LONG-1', 'หมอน']], locs: ['B-01-01', 'B-01-02'],
      keys: [[0, 8, 100, 0, 7, 0], [0, 8, 100, 1, 50, 0]],
    };
    const k1 = 'LONG-1|8|100|B-01-01';
    const k2 = 'LONG-1|8|100|B-01-02';
    const k3 = 'LONG-1|8|100|B-01-03';
    const data = { today: TODAY, lines: [
      done({ k: k1, date: '2026-03-02', qty: 7, diff: -3 }),
      done({ k: k2, date: '2026-03-02', qty: 40, diff: -10 }),
      done({ k: k3, date: '2026-03-02', qty: 0, diff: -5 }),
    ] };
    expect(WmsTx.countStats(data).off).toHaveLength(3);
    expect(WmsTx.countStats(data, raw).off.map((l) => l.k)).toEqual([k2]);
  });

  it('แสดงผลต่างมีเครื่องหมาย', () => {
    expect(WmsTx.diffText(0)).toBe('ตรง');
    expect(WmsTx.diffText(3)).toBe('+3');
    expect(WmsTx.diffText(-1200)).toBe('-1,200');
  });

  it('ตัวเลขที่กรอกค้างใช้ได้กับวันเดียวกันเท่านั้น และข้อมูลเสียไม่ทำให้หน้าพัง', () => {
    expect(WmsTx.readDraft(TODAY)).toEqual({});
    WmsTx.saveDraft(TODAY, { K1: '5' });
    expect(WmsTx.readDraft(TODAY)).toEqual({ K1: '5' });
    expect(WmsTx.readDraft('2026-03-11')).toEqual({});
    store.set('wms:tx:count:draft', '{oops');
    expect(WmsTx.readDraft(TODAY)).toEqual({});
  });

  it('สคริปต์รุ่นเก่าหรือ error บอกให้รู้ว่าต้องทำอะไร', async () => {
    win.WmsGas = { json: async () => ({ app: 'transaction' }), post: async () => ({ error: 'ไม่รู้จักคำสั่งนี้' }) };
    await expect(WmsTx.pullCount('https://x/exec')).rejects.toThrow('New version');
    await expect(WmsTx.saveCount('https://x/exec', TODAY, [])).rejects.toThrow('ไม่รู้จักคำสั่งนี้');
  });

  it('ส่งผลนับพร้อมชื่อคนที่ลงชื่อเข้าระบบ', async () => {
    store.set('wms:session', JSON.stringify({ name: 'สมมติ', at: 1 }));
    const sent = [];
    win.WmsGas = { post: async (url, body) => { sent.push(body); return { lines: [] }; } };
    await WmsTx.saveCount('https://x/exec', TODAY, [{ k: 'K1', qty: 5 }]);
    expect(sent).toEqual([{ op: 'count-save', date: TODAY, who: 'สมมติ', items: [{ k: 'K1', qty: 5 }] }]);
  });
});
