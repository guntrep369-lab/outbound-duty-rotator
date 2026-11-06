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
import { sharedMocks } from './gas-shared-mock.js';

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

function script(rows, { props = {}, extraSheets = [], named = {}, env: more = {} } = {}) {
  const grid = [HEAD, ...rows];
  const sheet = {
    getLastRow: () => grid.length,
    getLastColumn: () => HEAD.length,
    getSheetId: () => 77,
    getName: () => 'Transaction',
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)),
    }),
  };
  const tabs = { ...named };
  const ss = {
    getSheets: () => [...extraSheets, sheet, ...Object.values(tabs)],
    getSheetByName: (name) => tabs[name] || null,
    insertSheet: (name) => (tabs[name] = writableTab()),
    getSpreadsheetTimeZone: () => 'UTC',
    getUrl: () => 'https://docs.example/d/1/edit',
    getName: () => 'สมุดสมมติ',
  };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    Utilities: { formatDate: (d, tz, f) => (f === 'H' ? String(d.getUTCHours()) : f === 'HH:mm' ? d.toISOString().slice(11, 16) : d.toISOString().slice(0, 10)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    DriveApp: {}, ScriptApp: {},
    ...more,
  };
  const api = new Function(...Object.keys(env), GS + '\nreturn { doGet: doGet, doPost: doPost, sharedTick: sharedTick, installShared: installShared, stopShared: stopShared };')(...Object.values(env));
  const call = (parameter) => api.doGet({ parameter });
  call.post = (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
  call.api = api;
  call.tabs = tabs;
  call.ledger = grid;
  return call;
}

const summary = (rows, o) => script(rows, o)({ api: 'tx-summary' });

/** แท็บที่ทีมกรอกเอง สคริปต์อ่านเป็นข้อความที่เห็นบนจอ */
function masterTab(grid) {
  return {
    getLastRow: () => grid.length,
    getLastColumn: () => (grid[0] ? grid[0].length : 0),
    getRange: (r, c, nr, nc) => ({
      getDisplayValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => Array.from({ length: nc }, (_, j) => String(x[c - 1 + j] ?? ''))),
    }),
  };
}

/** ยอดของคีย์หนึ่งจากคำตอบแบบย่อ */
function bal(s, sku, loc, lot = 8) {
  const k = s.keys.find((x) => s.skus[x[0]][0] === sku && s.locs[x[3]] === loc && x[1] === lot);
  return k ? k[4] : 0;
}

describe('tx-api.gs — ยอดขายรายวัน', () => {
  const daily = (rows, parameter = {}) => script(rows)({ api: 'tx-daily', ...parameter });
  /* ยอดแบบอ่านง่าย { 'วัน|SKU': จำนวน } */
  const cells = (r) => Object.fromEntries(r.cells.map(([d, s, q]) => [`${r.days[d]}|${r.skus[s][0]}`, q]));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('รวมแถวขายราย SKU ราย วัน ใช้รหัสเต็มในคอลัมน์ B', () => {
    const r = daily([
      sale({ long: 'AAA0000000001', qty: 2, note: day('2026-01-10') }),
      sale({ long: 'AAA0000000001', qty: 3, note: day('2026-01-10') }),
      sale({ long: 'AAA0000000001', qty: 1, note: day('2026-01-11') }),
      sale({ long: 'BBB0000000002', qty: 4, note: day('2026-01-10') }),
    ]);
    expect(cells(r)).toEqual({
      '2026-01-10|AAA0000000001': 5,
      '2026-01-11|AAA0000000001': 1,
      '2026-01-10|BBB0000000002': 4,
    });
    expect(r.last).toBe('2026-01-11');
  });

  it('นับเฉพาะแถวขาย แถวรับและเบิกไม่เกี่ยว', () => {
    const r = daily([
      sale({ qty: 2, note: day('2026-01-10') }),
      row({ type: 'รับ', to: 'A-01-01', qty: 9, note: day('2026-01-10') }),
      row({ type: 'เบิก', from: 'A-01-01', to: 'B-01-01', qty: 9, note: day('2026-01-10') }),
    ]);
    expect(Object.values(cells(r))).toEqual([2]);
  });

  it('พิมพ์เล็กใหญ่ต่างกันคือ SKU เดียวกัน', () => {
    const r = daily([
      sale({ long: 'aaa0000000001', qty: 1, note: day('2026-01-10') }),
      sale({ long: 'AAA0000000001 ', qty: 1, note: day('2026-01-10') }),
    ]);
    expect(cells(r)).toEqual({ '2026-01-10|AAA0000000001': 2 });
  });

  it('ส่งเฉพาะช่วงที่ขอ แต่บอกวันสุดท้ายของทั้งชีต', () => {
    const r = daily([
      sale({ qty: 1, note: day('2026-01-09') }),
      sale({ qty: 2, note: day('2026-01-10') }),
      sale({ qty: 3, note: day('2026-02-01') }),
    ], { from: '2026-01-10', to: '2026-01-31' });
    expect(r.days).toEqual(['2026-01-10']);
    expect(r.from).toBe('2026-01-10');
    expect(r.to).toBe('2026-01-31');
    expect(r.last).toBe('2026-02-01');
    expect(r.lines.map((l) => l[2])).toEqual([3]);
  });

  it('ส่งแถวขายทีละแถวพร้อมเลขแถว ให้หน้าเว็บชี้กลับไปที่ชีตได้', () => {
    const r = daily([
      row({ type: 'รับ', to: 'A-01-01', qty: 9, note: day('2026-01-10') }),
      sale({ long: 'AAA0000000001', from: 'A-01-01', lot: 3, po: 'PO-1', qty: 2, who: 'คนเอ', note: day('2026-01-10') }),
      sale({ long: 'AAA0000000001', from: 'B-02-02', lot: 4, po: 'PO-2', qty: 'สอง', who: 'คนบี', note: day('2026-01-11') }),
    ]);
    const lines = r.lines.map(([d, s, n, loc, lot, po, qty, who]) => [r.days[d], r.skus[s][0], n, r.locs[loc], lot, po, qty, r.whos[who]]);
    expect(lines).toEqual([
      ['2026-01-10', 'AAA0000000001', 3, 'A-01-01', 3, 'PO-1', 2, 'คนเอ'],
      ['2026-01-11', 'AAA0000000001', 4, 'B-02-02', 4, 'PO-2', 'สอง', 'คนบี'],
    ]);
    expect(r.sheet).toEqual({ url: 'https://docs.example/d/1/edit', gid: 77 });
  });

  it('แถวที่นับไม่ได้บอกจำนวนกลับไป ไม่หายเงียบ', () => {
    const r = daily([
      sale({ qty: 1, note: day('2026-01-10') }),
      sale({ qty: 2, note: '' }),
      sale({ long: '', qty: 3, note: day('2026-01-10') }),
      sale({ qty: 4, note: day('2062-01-10') }),
      sale({ qty: 'สอง', note: day('2026-01-10') }),
    ]);
    expect(r.noDate).toEqual({ rows: 1, qty: 2 });
    expect(r.noSku).toEqual({ rows: 1, qty: 3 });
    expect(r.future).toEqual({ rows: 1, qty: 4 });
    expect(r.badQty).toEqual({ rows: 1 });
    expect(r.last).toBe('2026-01-10');
  });

  it('ไม่เขียนอะไรลงชีต', () => {
    const call = script([sale({ qty: 1, note: day('2026-01-10') })]);
    call({ api: 'tx-daily' });
    expect(Object.keys(call.tabs)).toEqual([]);
  });

  it('ไม่มีแท็บ MASTER แปลงสินค้า ส่ง convert เป็น null', () => {
    expect(daily([sale({ qty: 1, note: day('2026-01-10') })]).convert).toBeNull();
  });

  it('อ่านคู่ SKU จากหัวตาราง ชื่อ SKU ตอนซื้อเอาจากสมุด แถวไม่ครบนับไว้', () => {
    const master = masterTab([
      ['ชื่อสินค้าตอนซื้อ', 'SKU หลังแปลง', 'SKU ตอนซื้อ'],
      ['ชุดตัวอย่าง', 'aaa0000000001-s ', 'AAA0000000001'],
      ['', 'AAA0000000001-M', 'AAA0000000001'],
      ['', 'AAA0000000001-M', 'aaa0000000001'],
      ['', 'BBB0000000002', 'BBB0000000002'],
      ['', 'CCC0000000003-S', ''],
      ['', '', ''],
    ]);
    const r = script([
      row({ long: 'AAA0000000001', name: 'สินค้าตอนซื้อ', to: 'A-01-01', qty: 9 }),
      sale({ long: 'AAA0000000001-S', name: 'สินค้าแปลงแล้ว', qty: 1, note: day('2026-01-10') }),
    ], { named: { 'MASTER แปลงสินค้า': master } })({ api: 'tx-daily' });
    expect(r.convert).toEqual({
      tab: 'MASTER แปลงสินค้า', cols: ['SKU ตอนซื้อ', 'SKU หลังแปลง'], blank: 1,
      pairs: [['AAA0000000001-S', 'AAA0000000001', 'สินค้าตอนซื้อ'], ['AAA0000000001-M', 'AAA0000000001', 'สินค้าตอนซื้อ']],
    });
  });

  it('หัวตารางไม่บอกว่าคอลัมน์ไหนเป็นอะไร ใช้ A เป็น SKU ตอนซื้อ B เป็น SKU หลังแปลง', () => {
    const master = masterTab([['รหัส 1', 'รหัส 2'], ['AAA0000000001', 'AAA0000000001-S']]);
    const r = script([sale({ qty: 1, note: day('2026-01-10') })], { named: { 'MASTER แปลงสินค้า': master } })({ api: 'tx-daily' });
    expect(r.convert.cols).toEqual(['รหัส 1', 'รหัส 2']);
    expect(r.convert.pairs).toEqual([['AAA0000000001-S', 'AAA0000000001', '']]);
  });
});

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

describe('tx-api.gs — แถวทั้งสมุดให้หน้า FIFO สต๊อก', () => {
  const fifo = (rows) => script(rows)({ api: 'tx-fifo' });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('ส่งทุกแถวแบบย่อพร้อมเลขแถว ชื่อ PO และ Location เป็นลำดับ', () => {
    const r = fifo([
      row({ sku: 'AAA001', long: 'AAA0000000001', lot: 9, po: 9900000001, to: 'R1-01-01', qty: 5, note: 'GR 05-09-26' }),
      row({ sku: 'AAA001', long: 'AAA0000000001', lot: 9, po: 9900000001, from: 'R1-01-01', to: 'p1-01', qty: 2, type: 'เบิก', status: 'เปิด', note: '' }),
      sale({ sku: 'AAA001', long: 'AAA0000000001', lot: 9, po: 9900000001, from: 'P1-01', qty: 1, note: day('2026-10-03') }),
    ]);
    expect(r.app).toBe('transaction');
    expect(r.skus).toEqual([['AAA001', 'AAA0000000001', 'สินค้า AAA001']]);
    expect(r.pos).toEqual(['9900000001']);
    expect(r.locs).toEqual(['R1-01-01', 'p1-01']);
    expect(r.days).toEqual(['2026-09-05', '2026-10-03']);
    expect(r.rows).toEqual([
      [2, 0, 9, 0, -1, 0, 5, 0, 0, 2 + 8],
      [3, 0, 9, 0, 0, 1, 2, 1, 0, 1],
      [4, 0, 9, 0, 1, -1, 1, 2, 1, 1 + 8],
    ]);
    expect(r.last).toBe('2026-10-03');
    expect(r.sheet).toEqual({ url: 'https://docs.example/d/1/edit', gid: 77 });
  });

  it('แถวนับสต๊อกมีธง Location เบิกของแถวรับไม่ส่ง จำนวนที่เป็นข้อความเป็น 0 แถวที่ B ว่างไม่ส่ง', () => {
    const r = fifo([
      row({ lot: 0, po: 0, to: 'R1-01-01', qty: 4, note: 'Stock Count Q3/26' }),
      row({ from: 'X1', to: 'R1-01-02', qty: 'สิบ', note: 'RETURN' }),
      row({ long: '', to: 'R1-01-03', qty: 9 }),
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0][9]).toBe(4);
    expect(r.rows[1][4]).toBe(-1);
    expect(r.rows[1][6]).toBe(0);
    expect(r.rows[1][8]).toBe(-1);
  });

  it('แถวแปลงสินค้ามีธง 16 และบอกว่าสคริปต์รุ่นนี้ส่งธงนี้แล้ว ให้หน้าเช็ครายการตัดสต๊อกจับคู่ SKU', () => {
    const r = fifo([
      row({ long: 'AAA0000000001', from: 'P-01-01', qty: 1, type: 'เบิก', status: 'เปิด', note: 'แปลงสินค้า' }),
      row({ long: 'FRE0000000001', to: 'G-01-01', qty: 1, status: 'เปิด', note: 'แปลงสินค้า' }),
      row({ long: 'AAA0000000001', from: 'R1-01-01', to: 'P-01-01', qty: 5, type: 'เบิก', note: 'โอนย้าย' }),
    ]);
    expect(r.conv).toBe(1);
    expect(r.rows.map((x) => x[9])).toEqual([1 + 16, 1 + 16, 0]);
  });

  it('แถวรับคืนมีธง 32 แถว M/E มีธง 64 และบอกว่าสคริปต์รุ่นนี้ส่งสองธงนี้แล้ว ให้หน้า LOT / PO ประมาณ LOT 0', () => {
    const r = fifo([
      row({ lot: 0, po: 0, to: 'G-01-01', qty: 1, note: 'RETURN' }),
      row({ lot: 0, po: 0, to: 'G-01-01', qty: 1, note: 'RETURN M/E' }),
      row({ lot: 0, po: 0, to: 'G-01-01', qty: 1, note: 'คืนสต็อก' }),
      row({ lot: 0, po: 0, to: 'P-01-01', qty: 2, note: 'M/E-00001' }),
      row({ lot: 0, po: 0, to: 'P-01-01', qty: 2, note: 'Stock Count Q3/26' }),
    ]);
    expect(r.lot0).toBe(1);
    expect(r.rows.map((x) => x[9])).toEqual([32, 32 + 64, 32, 64, 4]);
  });
});

describe('tx-api.gs — แท็บยอดก่อนนับ (tx-fifo ช่อง before)', () => {
  /** แท็บที่ผู้ใช้วางเอง สคริปต์อ่านค่าจริง (getValues) ขอเกินคอลัมน์ที่มีได้ช่องว่าง */
  const valueTab = (grid) => ({
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map((x) => x.length)),
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => Array.from({ length: nc }, (_, j) => x[c - 1 + j] ?? '')),
    }),
  });
  const before = (grid) => script([row({ to: 'P-01-01' })], { named: { 'ยอดก่อนนับ': valueTab(grid) } })({ api: 'tx-fifo' }).before;

  it('ไม่มีแท็บส่ง null', () => {
    expect(script([row({ to: 'P-01-01' })])({ api: 'tx-fifo' }).before).toBeNull();
  });

  it('วางสมุดรอบก่อนทั้งชีต คิดยอดคงเหลือราย SKU LOT PO เอง วันที่รับเอาจากแถว GR แรก', () => {
    const b = before([
      HEAD,
      row({ sku: 'AAA001', lot: 7, po: 9900000001, to: 'P-01-01', qty: 10, note: 'GR 05-07-26' }),
      row({ sku: 'AAA001', lot: 7, po: 9900000001, to: 'P-01-02', qty: 5, note: 'GR 01-07-26' }),
      sale({ sku: 'AAA001', lot: 7, po: 9900000001, from: 'P-01-01', qty: 4, note: day('2026-07-20') }),
      row({ sku: 'AAA001', lot: 8, po: 9900000002, to: 'P-01-01', qty: 6, note: 'GR 02-08-26' }),
      row({ sku: 'AAA001', lot: 8, po: 9900000002, from: 'P-01-01', to: 'G-01-01', qty: 3, type: 'เบิก', note: 'โอนย้าย' }),
      row({ sku: 'AAA001', lot: 9, po: 9900000003, to: 'P-01-01', qty: 2, note: 'GR 01-09-26' }),
      sale({ sku: 'AAA001', lot: 9, po: 9900000003, from: 'P-01-01', qty: 2, note: day('2026-09-10') }),
      row({ long: '', to: 'P-01-01', qty: 9 }),
    ]);
    expect(b.mode).toBe('ledger');
    expect(b.rows).toBe(7);
    expect(b.skip).toBe(1);
    expect(b.layers).toEqual([
      ['LONG-AAA001', 7, '9900000001', 11, '2026-07-01'],
      ['LONG-AAA001', 8, '9900000002', 6, '2026-08-02'],
    ]);
  });

  it('วางเป็นตาราง หาคอลัมน์จากหัวตาราง SKU LOT PO เดียวกันบวกรวม แถวที่ไม่มี SKU หรือจำนวนไม่ถึง 1 ข้าม', () => {
    const b = before([
      ['รหัสสินค้า', 'LOT', 'PO', 'จำนวน', 'วันที่รับ'],
      ['AAA001', 7, '9900000001', 5, day('2026-07-05')],
      ['AAA001', 7, '9900000001', '1,003', ''],
      ['', 1, 1, 1, ''],
      ['BBB002', 8, '9900000002', 0, ''],
    ]);
    expect(b.mode).toBe('table');
    expect(b.cols).toEqual(['รหัสสินค้า', 'LOT', 'PO', 'จำนวน', 'วันที่รับ']);
    expect([b.rows, b.skip]).toEqual([2, 2]);
    expect(b.layers).toEqual([['AAA001', 7, '9900000001', 1008, '2026-07-05']]);
  });

  it('แท็บยอดก่อนนับที่วางสมุดรอบก่อนถูกลากไปไว้หน้าแท็บสมุด ทุกหน้ายังอ่านแท็บสมุด ไม่อ่านสมุดเก่าแทน', () => {
    const old = Object.assign(valueTab([HEAD, row({ sku: 'OLD001', lot: 7, po: 9900000001, to: 'P-01-01', qty: 3, note: 'GR 05-07-26' })]),
      { getName: () => 'ยอดก่อนนับ' });
    const r = script([row({ sku: 'NEW001', to: 'P-01-01' })], { extraSheets: [old], named: { 'ยอดก่อนนับ': old } })({ api: 'tx-fifo' });
    expect(r.skus.map((s) => s[0])).toEqual(['NEW001']);
    expect(r.before.layers).toEqual([['LONG-OLD001', 7, '9900000001', 3, '2026-07-05']]);
  });

  it('หาคอลัมน์ไม่เจอ บอกว่าขาดอะไร', () => {
    const b = before([['สินค้า', 'จำนวน'], ['AAA001', 5]]);
    expect(b.missing).toEqual(['sku', 'lot', 'po']);
    expect(b.layers).toEqual([]);
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

  it('peek อ่านผลนับรวมรายเดือนอย่างเดียว ไม่สร้างแท็บ ไม่ออกรายการของวันนี้', () => {
    const api = script([shelf(1), shelf(2), shelf(3)]);
    const peek = () => api({ api: 'tx-count', peek: '1' });
    expect(peek()).toEqual({
      app: 'transaction', peek: true, today: '2026-03-10', todays: { total: 0, done: 0 }, last: { sample: 0, match: 0 }, months: {},
    });
    expect(api.tabs[COUNT]).toBeUndefined();

    const v = load(api);
    expect(peek().todays).toEqual({ total: 3, done: 0 });
    api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: todo(v).map((l, i) => ({ k: l.k, qty: i === 2 ? 9 : 10 })) });
    const mar = { '2026-03': { counted: 3, off: 1, sample: 3, match: 2 } };
    expect(peek()).toMatchObject({ todays: { total: 3, done: 3 }, last: { sample: 3, match: 2 }, months: mar });

    onDay('2026-03-11');
    const rows = api.tabs[COUNT].grid.length;
    expect(peek()).toMatchObject({ today: '2026-03-11', todays: { total: 0, done: 0 }, months: mar });
    expect(api.tabs[COUNT].grid).toHaveLength(rows);

    /* ความแม่นยำของหน้าสต๊อกนับย้อนหลัง 30 วัน รายเดือนยังอยู่ครบ */
    onDay('2026-04-20');
    expect(peek()).toMatchObject({ last: { sample: 0, match: 0 }, months: mar });
  });

  it('peek นับความแม่นยำเฉพาะรายการสุ่ม รายการเสี่ยงนับแล้วอยู่ใน counted กับ off', () => {
    const api = script([row({ sku: 'NEG1', to: 'A-01-01', qty: 1 }), sale({ sku: 'NEG1', from: 'A-01-01', qty: 3, note: day('2026-03-01') }), shelf(1)]);
    const v = load(api);
    expect(v.lines.map((l) => l.src).sort()).toEqual(['สุ่ม', 'เสี่ยง']);
    saveAll(api, v, 10);
    expect(api({ api: 'tx-count', peek: '1' }).months['2026-03']).toEqual({ counted: 2, off: 1, sample: 1, match: 1 });
  });

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

describe('tx-api.gs — ส่ง SKU จากแท็บเทียบสต๊อกเข้าใบนับ', () => {
  const COUNT = 'นับสต๊อก';
  const SRC = 'เทียบระบบ';
  const onDay = (s) => vi.setSystemTime(new Date(`${s}T05:00:00Z`));
  const add = (api, items) => api.post({ op: 'count-add', items });
  const item = (sku = 'AAA001', o = {}) => ({ sku, longs: [`LONG-${sku}`], name: 'ชื่อจากเว็บ', ...o });
  const mine = (v) => v.lines.filter((l) => l.src === SRC);
  const open = (v) => mine(v).filter((l) => l.qty === undefined && l.date === v.today);
  const save = (api, v, qtys) => api.post({
    op: 'count-save', date: v.today, who: 'สมมติ', items: open(v).map((l) => ({ k: l.k, qty: qtys[l.loc] })),
  });
  /* LOT และ PO ต่างกันในจุดเดียว กับอีกจุดหนึ่ง */
  const LEDGER = [
    row({ to: 'A-01-01', qty: 10, lot: 8, po: 1 }),
    row({ to: 'A-01-01', qty: 5, lot: 9, po: 2 }),
    row({ to: 'B-01-01', qty: 7, lot: 8, po: 1 }),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    onDay('2026-03-10');
  });
  afterEach(() => vi.useRealTimers());

  it('ออกแถวต่อ Location รวมทุก LOT ทุก PO พร้อมแถวที่อื่น โดยสมุดรายการไม่เปลี่ยนสักช่อง', () => {
    const api = script(LEDGER);
    const before = JSON.stringify(api.ledger);
    const v = add(api, [item()]);
    expect(mine(v).map((l) => [l.loc, l.sku, l.lot, l.po, l.long])).toEqual([
      ['A-01-01', 'AAA001', 'ทุก', 'ทุก', 'LONG-AAA001'],
      ['B-01-01', 'AAA001', 'ทุก', 'ทุก', 'LONG-AAA001'],
      ['ที่อื่น', 'AAA001', 'ทุก', 'ทุก', 'LONG-AAA001'],
    ]);
    expect(v).toMatchObject({ added: 1, addedLines: 3, skipped: 0 });
    expect(JSON.stringify(api.ledger)).toBe(before);
  });

  it('ไม่บอกยอดในระบบกับคนนับ เหมือนรายการอื่น', () => {
    const line = mine(add(script(LEDGER), [item()]))[0];
    expect(Object.keys(line).sort()).toEqual(['date', 'k', 'loc', 'long', 'lot', 'name', 'po', 'sku', 'src'].sort());
  });

  it('จุดที่ยอดเป็นศูนย์ไม่ต้องนับ จุดที่ติดลบต้องนับ เพราะของจริงอาจอยู่ตรงนั้น', () => {
    const v = add(script([
      row({ to: 'A-01-01', qty: 5 }),
      row({ type: 'เบิก', from: 'A-01-01', qty: 5 }),
      row({ to: 'B-01-01', qty: 1 }),
      row({ type: 'เบิก', from: 'B-01-01', qty: 3 }),
    ]), [item()]);
    expect(mine(v).map((l) => l.loc)).toEqual(['B-01-01', 'ที่อื่น']);
  });

  it('ใช้ชื่อสินค้าจากชีต ไม่ใช่ที่เว็บส่งมา ถ้าชีตรู้จัก SKU นั้น', () => {
    expect(mine(add(script(LEDGER), [item()]))[0].name).toBe('สินค้า AAA001');
  });

  it('SKU ที่ชีตไม่รู้จัก มีแค่แถวที่อื่น ใช้รหัสและชื่อที่ส่งมา', () => {
    const v = add(script(LEDGER), [{ sku: 'ZZZ999', longs: [], name: 'มีแค่ในระบบบริษัท' }]);
    expect(mine(v).map((l) => [l.loc, l.sku, l.long, l.name])).toEqual([['ที่อื่น', 'ZZZ999', 'ZZZ999', 'มีแค่ในระบบบริษัท']]);
  });

  it('เว็บบอก Location เองไม่ได้ และรหัสเต็มที่ชีตไม่รู้จักไม่มีผล', () => {
    const v = add(script(LEDGER), [{ sku: 'AAA001', longs: ['ไม่มีจริง'], loc: 'แอบใส่', name: 'x' }]);
    expect(mine(v).map((l) => l.loc)).toEqual(['ที่อื่น']);
  });

  it('รหัสสั้นเดียวมีรหัสเต็มสองตัว นับทุกจุดของทั้งสองตัว และยอดในระบบรวมทั้งสองตัว', () => {
    const api = script([
      row({ long: 'L1', to: 'A-01-01', qty: 10 }),
      row({ long: 'L2', to: 'A-01-01', qty: 4 }),
      row({ long: 'L2', to: 'B-01-01', qty: 6 }),
    ]);
    const v = add(api, [{ sku: 'AAA001', longs: ['L1', 'L2'] }]);
    expect(mine(v).map((l) => [l.loc, l.long])).toEqual([['A-01-01', 'L1,L2'], ['B-01-01', 'L1,L2'], ['ที่อื่น', 'L1,L2']]);
    const r = save(api, v, { 'A-01-01': 14, 'B-01-01': 5, 'ที่อื่น': 0 });
    expect(mine(r).map((l) => l.exp)).toEqual([14, 6, 0]);
  });

  it('ยอดในระบบรวมทุก LOT ทุก PO ของ Location คิดตอนส่งผล แถวที่อื่นเป็น 0', () => {
    const api = script(LEDGER);
    const r = save(api, add(api, [item()]), { 'A-01-01': 12, 'B-01-01': 7, 'ที่อื่น': 2 });
    expect(mine(r).map((l) => [l.loc, l.qty, l.exp, l.diff])).toEqual([
      ['A-01-01', 12, 15, -3], ['B-01-01', 7, 7, 0], ['ที่อื่น', 2, 0, 2],
    ]);
  });

  it('SKU ที่ยังรอนับอยู่ไม่ออกซ้ำ นับครบแล้วส่งใหม่ได้ และผลรอบแรกยังอยู่', () => {
    const api = script(LEDGER);
    const v = add(api, [item()]);
    const again = add(api, [item()]);
    expect(again).toMatchObject({ added: 0, addedLines: 0, skipped: 1 });
    expect(mine(again)).toHaveLength(3);

    save(api, v, { 'A-01-01': 12, 'B-01-01': 7, 'ที่อื่น': 0 });
    const round2 = add(api, [item()]);
    expect(round2).toMatchObject({ added: 1, addedLines: 3 });
    expect(open(round2)).toHaveLength(3);

    const r = save(api, round2, { 'A-01-01': 15, 'B-01-01': 7, 'ที่อื่น': 0 });
    expect(mine(r).filter((l) => l.loc === 'A-01-01').map((l) => l.qty)).toEqual([12, 15]);
  });

  it('ส่ง SKU เดียวกันซ้ำในคำขอเดียว ออกรอบเดียว', () => {
    expect(add(script(LEDGER), [item(), item()])).toMatchObject({ added: 1, addedLines: 3, skipped: 1 });
  });

  it('ส่งก่อนเปิดใบนับครั้งแรกของวัน รายการประจำวันยังออกตามปกติและไม่ซ้ำ', () => {
    const shelf = row({ sku: 'RND001', to: 'B-02-01', qty: 10 });
    const api = script([...LEDGER, shelf]);
    add(api, [item()]);
    const v = api({ api: 'tx-count' });
    expect(v.lines.filter((l) => l.src !== SRC).length).toBeGreaterThan(0);
    const again = api({ api: 'tx-count' });
    expect(again.lines.length).toBe(v.lines.length);
  });

  it('ไม่ถูกดึงไปนับซ้ำเองในวันถัดไป แม้ผลไม่ตรง', () => {
    const api = script(LEDGER);
    save(api, add(api, [item()]), { 'A-01-01': 1, 'B-01-01': 1, 'ที่อื่น': 1 });
    onDay('2026-03-11');
    const v = api({ api: 'tx-count' });
    expect(v.lines.filter((l) => l.date === v.today).map((l) => l.src)).not.toContain('นับซ้ำ');
    expect(v.lines.filter((l) => l.date === v.today).map((l) => l.src)).not.toContain(SRC);
  });

  it('รอบของวันก่อนที่นับไม่ครบยังส่งไปทั้งรอบ หน้าเว็บจะได้รู้ว่าไม่ครบ', () => {
    const api = script(LEDGER);
    const v = add(api, [item()]);
    api.post({ op: 'count-save', date: v.today, who: 'สมมติ', items: [{ k: open(v)[0].k, qty: 15 }] });
    onDay('2026-03-11');
    const next = api({ api: 'tx-count' });
    expect(mine(next).map((l) => [l.loc, l.qty])).toEqual([['A-01-01', 15], ['B-01-01', undefined], ['ที่อื่น', undefined]]);
    expect(open(next)).toEqual([]);
  });

  it('ส่งเกินเพดานต่อวัน ไม่เพิ่มสักแถวและบอกตัวเลข', () => {
    const many = Array.from({ length: 300 }, (_, i) => row({ sku: 'AAA001', to: `B-${String(i % 90 + 10)}-${String(i % 97 + 1).padStart(2, '0')}`, qty: 1 }));
    const api = script(many);
    const r = add(api, [item()]);
    expect(r.error).toContain('300');
    expect(api.tabs[COUNT].grid).toHaveLength(1);
  });

  it('ข้อความจากเว็บไม่กลายเป็นสูตรในชีต และค่าแปลก ๆ ไม่ทำให้สคริปต์ล้ม', () => {
    const api = script(LEDGER);
    add(api, [{ sku: '=HYPERLINK("x")', name: "+1-1" }, null, { sku: '' }, { longs: 'ไม่ใช่รายการ', sku: 'ZZZ1' }]);
    const grid = api.tabs[COUNT].grid.slice(1);
    expect(grid.map((g) => g[4])).toEqual(['HYPERLINK("x")', 'ZZZ1']);
    expect(grid[0][6]).toBe('1-1');
  });

  it('ไม่มีรายการ = บอกตรง ๆ', () => {
    expect(add(script(LEDGER), []).error).toBeTruthy();
    expect(script(LEDGER).post({ op: 'count-add' }).error).toBeTruthy();
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

describe('tx-api.gs — ข้อมูลกลาง', () => {
  const T0 = new Date('2026-03-10T10:00:00Z');   // 10 โมงตามเวลาของไฟล์ชีตปลอม (UTC) อยู่ในเวลางานของรอบตั้งเวลา
  const rows = () => [row({ to: 'A-01-01', qty: 5 }), sale({ from: 'A-01-01', qty: 2, note: day('2026-03-09') })];
  const at = (ms) => vi.setSystemTime(new Date(T0.getTime() + ms));
  const MIN = 60000;

  /** สมุดปลอมพร้อม Drive กับ Script Properties ปลอม เพิ่มแถวในสมุดได้ภายหลังผ่าน api.ledger */
  function setup(o = {}) {
    const g = sharedMocks(o);
    const api = script(o.rows || rows(), { env: g.env });
    return { g, api };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('ไม่ใส่ shared คิดใหม่ทุกครั้งเหมือนเดิม ไม่แตะ Drive', () => {
    const { g, api } = setup();
    const r = api({ api: 'tx-summary' });
    expect(r.keys.length).toBeGreaterThan(0);
    expect(r.shared).toBeUndefined();
    expect(g.files).toEqual({});
    expect(g.info('tx-summary')).toBeNull();
  });

  it('เปิดหน้าครั้งแรกยังไม่มีชุดกลาง คิดแล้วเก็บเป็นไฟล์ในโฟลเดอร์ WMS ข้อมูลกลาง', () => {
    const { g, api } = setup();
    const r = api({ api: 'tx-summary', shared: '1' });
    expect(r.shared).toMatchObject({ at: T0.getTime(), by: '', auto: true, params: null });
    const ids = Object.keys(g.files);
    expect(ids).toHaveLength(1);
    expect(g.files[ids[0]]).toMatchObject({ folder: 'WMS ข้อมูลกลาง', mime: 'text/plain' });
    expect(g.files[ids[0]].name).toContain('tx-summary');
    expect(g.info('tx-summary')).toMatchObject({ file: ids[0], at: T0.getTime() });
    expect(g.content('tx-summary').keys).toEqual(r.keys);
  });

  it('ยังไม่มีโฟลเดอร์ สร้างให้', () => {
    const { g, api } = setup({ folder: false });
    api({ api: 'tx-summary', shared: '1' });
    expect(g.folders.map((f) => f.name)).toEqual(['WMS ข้อมูลกลาง']);
  });

  it('เครื่องที่สองได้ชุดเดียวกับเครื่องแรก แม้สมุดจะมีแถวเพิ่มแล้ว จนกว่าจะมีคนกดดึงใหม่', () => {
    const { api } = setup();
    const first = api({ api: 'tx-summary', shared: '1' });
    api.ledger.push(row({ to: 'A-01-01', qty: 100 }));
    at(10 * MIN);
    const second = api({ api: 'tx-summary', shared: '1' });
    expect(second).toEqual(first);
    const pressed = api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' });
    expect(pressed.rows).toBe(first.rows + 1);
    expect(pressed.shared).toMatchObject({ by: 'คนเอ', auto: false, at: T0.getTime() + 10 * MIN });
    at(11 * MIN);
    expect(api({ api: 'tx-summary', shared: '1' }).rows).toBe(first.rows + 1);
  });

  it('กดดึงใหม่เขียนทับไฟล์เดิม ไม่สร้างไฟล์ใหม่ทุกครั้ง', () => {
    const { g, api } = setup();
    api({ api: 'tx-summary', shared: '1' });
    api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' });
    api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนบี' });
    const ids = Object.keys(g.files);
    expect(ids).toHaveLength(1);
    expect(g.files[ids[0]].writes).toBe(3);
  });

  it('ไฟล์ถูกลบทิ้ง ถือว่ายังไม่มีชุดกลาง คิดใหม่แล้วสร้างไฟล์ใหม่', () => {
    const { g, api } = setup();
    api({ api: 'tx-summary', shared: '1' });
    g.files[g.info('tx-summary').file].trashed = true;
    api.ledger.push(row({ to: 'A-01-01', qty: 1 }));
    at(MIN);
    const r = api({ api: 'tx-summary', shared: '1' });
    expect(r.shared.at).toBe(T0.getTime() + MIN);
    expect(Object.keys(g.files)).toHaveLength(2);
  });

  it('ชุดที่เก็บไว้เก่ากว่าชั่วโมง เปิดหน้าแล้วคิดใหม่ให้', () => {
    const { api } = setup();
    api({ api: 'tx-summary', shared: '1' });
    api.ledger.push(row({ to: 'A-01-01', qty: 1 }));
    at(59 * MIN);
    expect(api({ api: 'tx-summary', shared: '1' }).shared.at).toBe(T0.getTime());
    at(61 * MIN);
    expect(api({ api: 'tx-summary', shared: '1' }).shared).toMatchObject({ at: T0.getTime() + 61 * MIN, auto: true });
  });

  it('มีคนกำลังคิดอยู่ กดซ้ำได้ busy ไม่คิดซ้อน ป้ายที่ค้างเกิน 7 นาทีถือว่าตายแล้ว', () => {
    const { g, api } = setup();
    g.running('tx-summary', 2 * MIN, 'คนบี');
    expect(api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' })).toEqual({
      app: 'transaction', busy: { at: T0.getTime() - 2 * MIN, by: 'คนบี', auto: false },
    });
    expect(g.files).toEqual({});
    g.running('tx-summary', 8 * MIN, 'คนบี');
    expect(api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' }).keys).toBeDefined();
    expect(g.store['shared-run:tx-summary']).toBeUndefined();
  });

  it('เปิดหน้าตอนมีคนกำลังคิดชุดใหม่ ได้ชุดเก่าไปก่อนแม้จะเกินชั่วโมง ไม่ต้องรอ', () => {
    const { g, api } = setup();
    const first = api({ api: 'tx-summary', shared: '1' });
    at(90 * MIN);
    g.running('tx-summary', MIN);
    expect(api({ api: 'tx-summary', shared: '1' })).toEqual(first);
  });

  it('คิดล้ม ไม่เก็บอะไร ป้ายกำลังคิดถูกลบ และคนกดได้ข้อความผิดพลาด', () => {
    const { g, api } = setup();
    api.ledger.length = 0;   // ไม่มีหัวตาราง หาชีต Transaction ไม่เจอ
    const r = api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' });
    expect(r.error).toContain('ไม่พบชีต Transaction');
    expect(g.store['shared-run:tx-summary']).toBeUndefined();
    expect(g.info('tx-summary')).toBeNull();
    expect(g.store['shared-err:tx-summary']).toBeUndefined();   // คนกดเห็นข้อความเองแล้ว เก็บเฉพาะรอบอัตโนมัติ
  });

  it('ชื่อคนกดถูกตัดตัวที่ทำให้เป็นสูตร และยาวไม่เกิน 60 ตัว', () => {
    const { api } = setup();
    const r = api.post({ op: 'shared-fresh', api: 'tx-summary', by: '=HYPERLINK("x")' + 'ก'.repeat(100) });
    expect(r.shared.by.startsWith('HYPERLINK')).toBe(true);
    expect(r.shared.by.length).toBe(60);
  });

  it('ยอดขายรายวันใช้ชุดกลางได้เฉพาะช่วงวันที่เดียวกัน ช่วงอื่นคิดใหม่แล้วเก็บแทน', () => {
    const { g, api } = setup();
    const mar = api({ api: 'tx-daily', from: '2026-03-01', to: '2026-03-31', shared: '1' });
    expect(mar.shared.params).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    api.ledger.push(sale({ from: 'A-01-01', qty: 1, note: day('2026-03-09') }));
    at(MIN);
    expect(api({ api: 'tx-daily', from: '2026-03-01', to: '2026-03-31', shared: '1' })).toEqual(mar);
    const feb = api({ api: 'tx-daily', from: '2026-02-01', to: '2026-02-28', shared: '1' });
    expect(feb.shared).toMatchObject({ at: T0.getTime() + MIN, params: { from: '2026-02-01', to: '2026-02-28' } });
    expect(g.info('tx-daily').params).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('กดดึงยอดขายใหม่ต้องส่งวันที่ที่ถูกรูปแบบ', () => {
    const { api } = setup();
    expect(api.post({ op: 'shared-fresh', api: 'tx-daily', from: '1/3/2026', to: '', by: 'คนเอ' }).error).toBe('ช่วงวันที่ไม่ถูกต้อง');
    expect(api.post({ op: 'shared-fresh', api: 'tx-history', by: 'คนเอ' }).error).toBe('ไม่รู้จักข้อมูลชุดนี้');
    const r = api.post({ op: 'shared-fresh', api: 'tx-daily', from: '2026-03-01', to: '2026-03-31', by: 'คนเอ' });
    expect(r.shared).toMatchObject({ by: 'คนเอ', params: { from: '2026-03-01', to: '2026-03-31' } });
  });

  it('shared-at ตอบสั้น ๆ ว่าชุดไหนเป็นของเวลาไหน ใครกำลังคิด ไม่ส่งเลขไฟล์ออกไป', () => {
    const { g, api } = setup();
    expect(api({ api: 'shared-at' })).toEqual({ app: 'transaction', at: T0.getTime(), shared: {}, run: {}, err: {} });
    api.post({ op: 'shared-fresh', api: 'tx-summary', by: 'คนเอ' });
    g.running('tx-daily', MIN, 'คนบี');
    const st = api({ api: 'shared-at' });
    expect(st.shared['tx-summary']).toEqual({ at: T0.getTime(), by: 'คนเอ', auto: false, ms: 0, params: null });
    expect(st.run).toEqual({ 'tx-daily': { at: T0.getTime() - MIN, by: 'คนบี', auto: false } });
    expect(JSON.stringify(st)).not.toContain('file');
  });

  it('รอบตั้งเวลาทำงานเฉพาะ 8:00 ถึงก่อน 18:00 คิดยอดคงเหลือกับยอดขายช่วงล่าสุดที่มีคนเปิดดู', () => {
    const { g, api } = setup();
    api({ api: 'tx-daily', from: '2026-03-01', to: '2026-03-31', shared: '1' });
    vi.setSystemTime(new Date('2026-03-10T07:30:00Z'));   // 7:30
    api.api.sharedTick();
    expect(g.info('tx-summary')).toBeNull();
    vi.setSystemTime(new Date('2026-03-10T18:00:00Z'));   // 18:00
    api.api.sharedTick();
    expect(g.info('tx-summary')).toBeNull();
    vi.setSystemTime(new Date('2026-03-10T08:00:00Z'));
    api.api.sharedTick();
    expect(g.info('tx-summary')).toMatchObject({ auto: true, by: '' });
    expect(g.info('tx-daily')).toMatchObject({ at: Date.parse('2026-03-10T08:00:00Z'), auto: true, params: { from: '2026-03-01', to: '2026-03-31' } });
  });

  it('รอบตั้งเวลาล้ม เก็บข้อความไว้ให้หน้าเว็บบอก รอบถัดไปสำเร็จแล้วล้างทิ้ง', () => {
    const { g, api } = setup();
    const saved = api.ledger.splice(0);
    api.api.sharedTick();
    const st = api({ api: 'shared-at' });
    expect(st.err['tx-summary'].msg).toContain('ไม่พบชีต Transaction');
    api.ledger.push(...saved);
    api.api.sharedTick();
    expect(api({ api: 'shared-at' }).err).toEqual({});
  });

  it('ชุด FIFO เปิดหน้าแล้วใช้ชุดที่มีได้ถึงหนึ่งวัน กดดึงใหม่ได้ ไม่ใส่ shared ไม่แตะ Drive', () => {
    const { g, api } = setup();
    expect(api({ api: 'tx-fifo' }).shared).toBeUndefined();
    expect(g.files).toEqual({});
    const first = api({ api: 'tx-fifo', shared: '1' });
    expect(first.rows).toHaveLength(2);
    expect(g.files[g.info('tx-fifo').file].name).toBe('tx-fifo · สมุดสมมติ.json');
    api.ledger.push(row({ to: 'A-01-01', qty: 1 }));
    at(23 * 60 * MIN);
    expect(api({ api: 'tx-fifo', shared: '1' })).toEqual(first);
    at(25 * 60 * MIN);
    expect(api({ api: 'tx-fifo', shared: '1' }).rows).toHaveLength(3);
    api.ledger.push(row({ to: 'A-01-01', qty: 1 }));
    const pressed = api.post({ op: 'shared-fresh', api: 'tx-fifo', by: 'คนเอ' });
    expect(pressed.rows).toHaveLength(4);
    expect(api({ api: 'shared-at' }).shared['tx-fifo']).toMatchObject({ by: 'คนเอ', auto: false });
  });

  it('รอบตั้งเวลาคิดชุด FIFO เมื่อยังไม่มีหรือเก่าถึง 2 ชั่วโมง รอบอื่นคิดแค่ยอดคงเหลือ', () => {
    const { g, api } = setup();
    api.api.sharedTick();
    expect(g.info('tx-fifo')).toMatchObject({ at: T0.getTime(), auto: true });
    at(30 * MIN);
    api.api.sharedTick();
    expect(g.info('tx-summary').at).toBe(T0.getTime() + 30 * MIN);
    expect(g.info('tx-fifo').at).toBe(T0.getTime());
    at(90 * MIN);
    api.api.sharedTick();
    expect(g.info('tx-fifo').at).toBe(T0.getTime());
    at(120 * MIN);
    api.api.sharedTick();
    expect(g.info('tx-fifo').at).toBe(T0.getTime() + 120 * MIN);
  });

  it('installShared ตั้งเวลาทุก 30 นาทีทับตัวเดิมของตัวเอง ไม่แตะตัวตั้งเวลาอื่น และเก็บชุดแรกทันที', () => {
    const { g, api } = setup();
    g.triggers.push({ fn: 'backupNow', days: 1 }, { fn: 'sharedTick', minutes: 5 });
    const msg = api.api.installShared();
    expect(g.triggers).toEqual([{ fn: 'backupNow', days: 1 }, { fn: 'sharedTick', minutes: 30 }]);
    expect(g.info('tx-summary')).toMatchObject({ auto: true });
    expect(msg).toContain('ยอดคงเหลือ');
    expect(msg).toContain('FIFO');
    api.api.stopShared();
    expect(g.triggers).toEqual([{ fn: 'backupNow', days: 1 }]);
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

describe('wms-tx.js — เทียบกับระบบบริษัท', () => {
  let WmsTx;

  beforeEach(() => {
    const win = {};
    new Function('window', 'sessionStorage', 'console', JS)(win, { getItem: () => null, setItem: () => {} }, { warn: () => {} });
    WmsTx = win.WmsTx;
  });

  const co = (sku, total, qa = 0, newwh = total) => ({ sku, description: `ชื่อ ${sku}`, qa, newwh, total });
  const map = (...list) => Object.fromEntries(list.map((s) => [s.sku, s]));
  const raw = (o) => ({
    skus: [['AAA001', 'LONG-1', 'หมอน'], ['BBB002', 'LONG-2', 'ที่นอน'], ['CCC003', 'LONG-3', 'ผ้านวม']],
    locs: ['A-01-01', 'A-01-02', 'จุดรอส่ง', 'QA'],
    keys: [],
    issues: { counts: {}, list: [] },
    ...o,
  });
  const LEDGER = raw({ keys: [[0, 8, '1', 0, 100, 0], [1, 8, '2', 0, 50, 0], [2, 8, '3', 0, 30, 0]] });
  const rowOf = (r, sku) => r.rows.find((x) => x.sku === sku);

  it('ต่าง = ระบบบริษัท − Transaction เรียงจากต่างมากสุด และตัวที่ตรงไม่อยู่ในรายการ', () => {
    const r = WmsTx.compareStock(LEDGER, map(co('LONG-1', 100), co('LONG-2', 55), co('LONG-3', 10)));
    expect(r.rows.map((x) => [x.sku, x.sys, x.tx, x.diff])).toEqual([['CCC003', 10, 30, -20], ['BBB002', 55, 50, 5]]);
    expect(r.same).toBe(1);
    expect(r).toMatchObject({ sys: 165, tx: 180, off: 25 });
  });

  it('แยกทิศทาง: ฝั่งไหนมากกว่า และตัวที่มีแค่ฝั่งเดียว', () => {
    const r = WmsTx.compareStock(LEDGER, map(co('LONG-1', 120), co('LONG-2', 40), co('ZZZ999', 7)));
    expect(Object.fromEntries(r.rows.map((x) => [x.sku, x.kind]))).toEqual({
      AAA001: 'more', BBB002: 'less', CCC003: 'txonly', ZZZ999: 'sysonly',
    });
    expect(r.counts).toEqual({ more: 1, less: 1, sysonly: 1, txonly: 1 });
  });

  describe('ของใช้ภายใน', () => {
    const SKUS = [['AAA001', 'LONG-1', 'หมอน'], ['ถุงทดสอบ', 'ถุงทดสอบ', 'ถุงขนาดเล็ก'], ['กล่อง X', 'กล่อง X', 'กล่องเล็ก'], ['DDD004', 'ของแถมหนึ่ง', 'ของแถม']];
    const led = (...keys) => raw({ skus: SKUS, keys });

    it('รหัสไทยที่ระบบบริษัทไม่มียอด แยกออกมา ไม่นับเป็นรายการไม่ตรง และไม่รวมในยอดทั้งคลัง', () => {
      const r = WmsTx.compareStock(led([0, 8, '1', 0, 100, 0], [1, 0, '', 1, 50, 0], [2, 0, '', 1, 500, 0]), map(co('LONG-1', 100)));
      expect(r.rows).toEqual([]);
      expect(r.internal).toEqual([
        { sku: 'กล่อง X', name: 'กล่องเล็ก', tx: 500 },
        { sku: 'ถุงทดสอบ', name: 'ถุงขนาดเล็ก', tx: 50 },
      ]);
      expect(r).toMatchObject({ same: 1, sys: 100, tx: 100, off: 0, ledger: 1, found: 1 });
      expect(r.counts.txonly).toBe(0);
    });

    it('รหัสสั้นเป็นอังกฤษแต่รหัสเต็มเป็นไทย ก็นับเป็นของใช้ภายใน', () => {
      const r = WmsTx.compareStock(led([3, 0, '', 1, 9, 0]), {});
      expect(r.internal.map((x) => x.sku)).toEqual(['DDD004']);
    });

    it('ยอดติดลบไม่ถูกทิ้ง ยังอยู่ในรายการให้เห็น แต่ไม่มาปนกับยอดเทียบ', () => {
      const r = WmsTx.compareStock(led([1, 0, '', 1, -3, 0]), {});
      expect(r.internal[0].tx).toBe(-3);
      expect(r.rows).toEqual([]);
    });

    it('ยอดเป็น 0 ไม่ต้องแสดง', () => {
      expect(WmsTx.compareStock(led([1, 0, '', 1, 5, 0], [1, 0, '', 2, -5, 0]), {}).internal).toEqual([]);
    });

    it('พอระบบบริษัทมียอดของรหัสนี้ ก็กลับมาเทียบตามปกติ', () => {
      const r = WmsTx.compareStock(led([1, 0, '', 1, 50, 0]), map(co('ถุงทดสอบ', 40)));
      expect(r.internal).toEqual([]);
      expect(rowOf(r, 'ถุงทดสอบ')).toMatchObject({ sys: 40, tx: 50, diff: -10, kind: 'less' });
    });

    it('รหัสอังกฤษที่มีแค่ใน Transaction ยังเป็นรายการไม่ตรง เพราะอาจเป็นสินค้าจริงที่ระบบบริษัทตัดไปแล้ว', () => {
      const r = WmsTx.compareStock(led([0, 8, '1', 0, 30, 0]), {});
      expect(r.internal).toEqual([]);
      expect(rowOf(r, 'AAA001').kind).toBe('txonly');
    });
  });

  it('จุดติดลบหักในยอด SKU เพราะกรอก LOT ผิดจะบวกจุดหนึ่ง ลบอีกจุดหนึ่ง', () => {
    const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 9, '1', 1, -10, 0]] });
    const r = WmsTx.compareStock(s, map(co('LONG-1', 90)));
    expect(r.rows).toEqual([]);
    expect(r.same).toBe(1);
  });

  it('จับคู่ด้วยรหัสเต็มหรือรหัสสั้นก็ได้ ตัวพิมพ์เล็กใหญ่และเว้นวรรคไม่มีผล', () => {
    expect(WmsTx.compareStock(LEDGER, map(co('AAA001', 100), co('bbb 002', 50), co('long-3', 30))).same).toBe(3);
  });

  it('รหัสสั้นเดียวมีรหัสเต็มสองตัว ถ้าระบบบริษัทใช้รหัสสั้นต้องรวมเป็นแถวเดียว', () => {
    const s = raw({ skus: [['AAA001', 'LONG-1', 'หมอน'], ['AAA001', 'LONG-9', 'หมอน']], keys: [[0, 8, '1', 0, 10, 0], [1, 8, '1', 1, 5, 0]] });
    const r = WmsTx.compareStock(s, map(co('AAA001', 15)));
    expect(r.rows).toEqual([]);
    expect(r.same).toBe(1);
  });

  it('SKU ที่ขายอยู่แต่ชีตเหลือ 0 แล้วระบบบริษัทยังมีของ ต้องขึ้นรายการและกดดูในชีตได้', () => {
    const r = WmsTx.compareStock(raw({ skus: [['AAA001', 'LONG-1', 'หมอน']] }), map(co('LONG-1', 4)));
    expect(r.rows[0]).toMatchObject({ sku: 'AAA001', ledger: 'AAA001', name: 'หมอน', sys: 4, tx: 0, kind: 'sysonly' });
  });

  it('SKU ที่มีแค่ในระบบบริษัท ใช้รหัสและชื่อจากระบบบริษัท และไม่มีให้กดดูในชีต', () => {
    const r = WmsTx.compareStock(raw(), map(co('ZZZ999', 4)));
    expect(r.rows[0]).toMatchObject({ sku: 'ZZZ999', ledger: '', name: 'ชื่อ ZZZ999' });
  });

  it('ศูนย์ทั้งสองฝั่งไม่นับเป็นตรงกัน ไม่งั้นเปอร์เซ็นต์ความตรงจะสูงเกินจริง', () => {
    const r = WmsTx.compareStock(raw(), map(co('ZZZ999', 0)));
    expect(r.same).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('แสดงยอดแยก QA / NEW WH ของระบบบริษัท และไฟล์ที่ไม่มีช่อง Total ใช้ผลบวกแทน', () => {
    const r = WmsTx.compareStock(raw(), map(co('ZZZ999', 0, 3, 4)));
    expect(r.rows[0]).toMatchObject({ sys: 7, qa: 3, newwh: 4 });
  });

  it('นับว่ารหัสสองฝั่งเจอกันกี่ตัว เพื่อเตือนเมื่อสองฝั่งใช้รหัสคนละแบบ', () => {
    const r = WmsTx.compareStock(LEDGER, map(co('LONG-1', 100), co('XXX', 5)));
    expect(r).toMatchObject({ found: 1, ledger: 3 });
  });

  describe('เบาะแส', () => {
    it('นับจุดติดลบของ SKU', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 9, '1', 1, -3, 0], [0, 7, '1', 3, -2, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 60))).rows[0].neg).toBe(2);
    });

    it('แถวที่ทำให้ยอดเพี้ยนจริงติดมาด้วยพร้อมเลขแถว เรื่องที่ไม่กระทบยอดรวมไม่เอามา', () => {
      const s = raw({
        keys: LEDGER.keys,
        issues: { counts: {}, list: [
          { kind: 'qty', sku: 'AAA001', rows: [12], rowCount: 1 },
          { kind: 'incomplete', sku: 'aaa001', what: 'QTY', rows: [13], rowCount: 1 },
          { kind: 'closedsale', sku: 'AAA001', rows: [14], rowCount: 1 },
          { kind: 'qty', sku: 'ไม่มีใน skus', rows: [15], rowCount: 1 },
        ] },
      });
      expect(rowOf(WmsTx.compareStock(s, map(co('LONG-1', 90))), 'AAA001').breaks).toEqual([
        { label: 'QTY ไม่ใช่ตัวเลข', rows: [12] }, { label: 'แถวไม่ครบ', rows: [13] },
      ]);
    });

    it('ชีตมากกว่าเท่ากับยอดของ Location หนึ่งพอดี บอกว่าเป็นที่ไหน', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 8, '1', 2, 6, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 100))).rows[0].equalsAt).toEqual(['จุดรอส่ง']);
    });

    it('ระบบบริษัทมากกว่าเท่ากับจุดติดลบพอดี ก็บอกเหมือนกัน', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 9, '1', 1, -6, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 100))).rows[0].equalsAt).toEqual(['A-01-02']);
    });

    it('หลาย LOT รวมกันใน Location เดียวเท่ายอดที่ต่าง ก็นับ', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 8, '1', 2, 4, 0], [0, 9, '1', 2, 2, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 100))).rows[0].equalsAt).toEqual(['จุดรอส่ง']);
    });

    it('ทิศทางไม่เข้ากันไม่นับ: ระบบบริษัทมากกว่า 6 ไม่ได้แปลว่าเกี่ยวกับจุดที่มีของ 6 ชิ้น', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 100, 0], [0, 8, '1', 2, 6, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 112))).rows[0].equalsAt).toEqual([]);
    });

    it('ระบบบริษัทเป็น 0 ทุกจุดในชีตคือส่วนที่ต่าง ไม่ต้องบอกว่าเท่าจุดไหน', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 6, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 0))).rows[0].equalsAt).toEqual([]);
    });

    it('ต่าง 1 ชิ้นเท่ากันได้ทุกที่ ไม่แสดง', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 10, 0], [0, 8, '1', 2, 1, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 10))).rows[0].equalsAt).toEqual([]);
    });

    it('เท่ากันหลายจุดเกินไปบอกไม่ได้ว่าจุดไหน ไม่แสดง', () => {
      const s = raw({ keys: [[0, 8, '1', 0, 5, 0], [0, 8, '1', 1, 5, 0], [0, 8, '1', 2, 5, 0]] });
      expect(WmsTx.compareStock(s, map(co('LONG-1', 10))).rows[0].equalsAt).toEqual([]);
    });
  });

  it('แถวมีรหัสสำหรับส่งเข้าใบนับ และจำนวนจุดที่ต้องไปนับ', () => {
    const s = raw({ keys: [[0, 8, '1', 0, 5, 0], [0, 9, '2', 0, 5, 0], [0, 8, '1', 1, 5, 0]] });
    const r = WmsTx.compareStock(s, map(co('ZZZ 999', 4), co('LONG-1', 1)));
    expect(rowOf(r, 'AAA001')).toMatchObject({ id: 'LONG-1', longs: ['LONG-1'], spots: 2 });
    expect(rowOf(r, 'ZZZ 999')).toMatchObject({ id: 'ZZZ999', longs: [], spots: 0 });
  });

  it('ระบบบริษัทใช้รหัสสั้น รหัสเต็มสองตัวของชีตรวมเป็นรหัสเดียวกับที่สคริปต์เก็บ', () => {
    const s = raw({ skus: [['AAA001', 'L1', 'หมอน'], ['AAA001', 'L2', 'หมอน']], keys: [[0, 8, '1', 0, 10, 0], [1, 8, '1', 1, 5, 0]] });
    expect(WmsTx.compareStock(s, map(co('AAA001', 1))).rows[0]).toMatchObject({ id: 'L1,L2', longs: ['L1', 'L2'] });
  });

  describe('ผลจากการส่งไปนับ', () => {
    const TODAY = '2026-03-10';
    const line = (o) => ({ src: 'เทียบระบบ', long: 'LONG-1', sku: 'AAA001', date: TODAY, loc: 'A-01-01', lot: 'ทุก', po: 'ทุก', k: 'K', ...o });
    const counted = (qty, exp, o) => line({ qty, exp, diff: qty - exp, ...o });
    /* ระบบบริษัท 90 แต่ Transaction 100 */
    const row = () => WmsTx.compareStock(raw({ keys: [[0, 8, '1', 0, 100, 0]] }), map(co('LONG-1', 90))).rows;
    const verdict = (lines, today = TODAY) => WmsTx.attachCounts(row(), { today, lines })[0].count;

    it('ไม่เคยส่งนับ = null ยังไม่โหลดผลนับก็เหมือนกัน', () => {
      expect(verdict([])).toBeNull();
      expect(WmsTx.attachCounts(row(), null)[0].count).toBeNull();
    });

    it('ของจริงเท่าระบบบริษัท = Transaction ผิด', () => {
      const v = verdict([counted(90, 100), counted(0, 0, { loc: 'ที่อื่น' })]);
      expect(v).toMatchObject({ state: 'sheet', qty: 90, off: -10, done: 2, total: 2 });
    });

    it('ของจริงเท่า Transaction = ระบบบริษัทผิด', () => {
      expect(verdict([counted(100, 100), counted(0, 0, { loc: 'ที่อื่น' })])).toMatchObject({ state: 'company', qty: 100, off: 0 });
    });

    it('ไม่เท่าทั้งคู่', () => {
      expect(verdict([counted(95, 100)])).toMatchObject({ state: 'both', qty: 95, off: -5 });
    });

    it('รวมหลายจุดและแถวที่อื่นก่อนตัดสิน', () => {
      expect(verdict([counted(60, 80), counted(25, 20, { loc: 'B-01-01' }), counted(5, 0, { loc: 'ที่อื่น' })])).toMatchObject({ state: 'sheet', qty: 90 });
    });

    it('เทียบจากผลต่าง: ขายหลังนับแล้วยอดสองฝั่งลดเท่ากัน ผลยังเหมือนเดิม', () => {
      /* วันที่นับ Transaction 120 ระบบบริษัท 110 นับได้ 110 วันนี้ขายไปแล้วทั้งสองฝั่งเหลือ 100 กับ 90 */
      expect(verdict([counted(110, 120, { date: '2026-03-08' })])).toMatchObject({ state: 'sheet', qty: 110, date: '2026-03-08' });
    });

    it('วันนี้ยังนับไม่ครบ = รอนับ และยังไม่สรุปผลจากแค่บางจุด', () => {
      const v = verdict([counted(90, 100), line({ loc: 'ที่อื่น' })]);
      expect(v).toMatchObject({ state: 'wait', done: 1, total: 2 });
      expect(v.qty).toBeUndefined();
    });

    it('รอบวันก่อนนับไม่ครบ = นับไม่ครบ ไม่ใช่รอนับ เพราะรายการหมดอายุแล้ว', () => {
      const v = verdict([counted(90, 100, { date: '2026-03-09' }), line({ loc: 'ที่อื่น', date: '2026-03-09' })]);
      expect(v).toMatchObject({ state: 'late', done: 1, total: 2, date: '2026-03-09' });
    });

    it('ส่งซ้ำวันใหม่ ใช้รอบล่าสุด แถวของรอบเก่าไม่เอามารวม', () => {
      const v = verdict([counted(95, 100, { date: '2026-03-09' }), counted(1, 1, { loc: 'จุดเก่า', date: '2026-03-09' }), counted(90, 100)]);
      expect(v).toMatchObject({ state: 'sheet', total: 1, qty: 90 });
    });

    it('ส่งซ้ำวันเดียวกัน ใช้แถวหลังสุดของแต่ละจุด', () => {
      expect(verdict([counted(95, 100), counted(90, 100)])).toMatchObject({ state: 'sheet', qty: 90, total: 1 });
      expect(verdict([counted(95, 100), line()])).toMatchObject({ state: 'wait', done: 0, total: 1 });
    });

    it('รายการนับปกติของ SKU เดียวกันไม่เกี่ยว', () => {
      expect(verdict([counted(1, 1, { src: 'สุ่ม', long: undefined })])).toBeNull();
    });

    it('รหัสตรงกันแบบไม่สนตัวพิมพ์และเว้นวรรค', () => {
      expect(verdict([counted(90, 100, { long: 'long -1' })]).state).toBe('sheet');
    });

    it('ตัวที่รอนับอยู่ส่งซ้ำไม่ได้ ตัวอื่นส่งได้', () => {
      const send = (lines) => WmsTx.canSend(WmsTx.attachCounts(row(), { today: TODAY, lines })[0]);
      expect(send([])).toBe(true);
      expect(send([line()])).toBe(false);
      expect(send([counted(90, 100)])).toBe(true);
      expect(send([line({ date: '2026-03-09' })])).toBe(true);
    });

    it('กรองตามผลนับได้ และ none คือยังไม่เคยส่ง', () => {
      const rows = WmsTx.compareStock(LEDGER, map(co('LONG-1', 90), co('LONG-2', 40), co('LONG-3', 10)));
      WmsTx.attachCounts(rows.rows, { today: TODAY, lines: [counted(90, 100), line({ long: 'LONG-2', sku: 'BBB002' })] });
      const skus = (state) => WmsTx.filterDiff(rows.rows, '', '', state).map((r) => r.sku).sort();
      expect(skus('sheet')).toEqual(['AAA001']);
      expect(skus('wait')).toEqual(['BBB002']);
      expect(skus('none')).toEqual(['CCC003']);
      expect(skus('')).toEqual(['AAA001', 'BBB002', 'CCC003']);
    });

    it('รหัสในใบนับต้องเป็นรหัสเดียวกับที่สคริปต์สร้างจากแถวนี้', () => {
      const r = WmsTx.compareStock(raw({ skus: [['AAA001', 'L1', 'หมอน'], ['AAA001', 'L2', 'หมอน']], keys: [[0, 8, '1', 0, 10, 0], [1, 8, '1', 1, 5, 0]] }), map(co('AAA001', 1))).rows;
      expect(WmsTx.attachCounts(r, { today: TODAY, lines: [line({ long: 'L1,L2' })] })[0].count.state).toBe('wait');
    });
  });

  it('รายการเทียบระบบไม่ปนในความแม่นยำและรายการไม่ตรงค้างอยู่ แต่ขึ้นเป็นงานของวันนี้', () => {
    const line = (o) => ({ k: 'K', date: '2026-03-10', src: 'เทียบระบบ', loc: 'A', ...o });
    const s = WmsTx.countStats({ today: '2026-03-10', lines: [
      line({ k: 'A' }),
      line({ k: 'B', qty: 1, exp: 5, diff: -4 }),
      line({ k: 'C', qty: 1, exp: 5, diff: -4, date: '2026-03-09' }),
      line({ k: 'D', date: '2026-03-09' }),
    ] });
    expect(s.todo.map((l) => l.k)).toEqual(['A']);
    expect(s.done.map((l) => l.k)).toEqual(['B']);
    expect(s.off).toEqual([]);
    expect(s.accuracy).toBeNull();
  });

  describe('ส่งเข้าใบนับ', () => {
    let win;
    const loadWith = (reply) => {
      win = { WmsGas: { post: async (url, body) => { win.sent = { url, body }; return reply; } } };
      new Function('window', 'sessionStorage', 'console', JS)(win, { getItem: () => null, setItem: () => {} }, { warn: () => {} });
      return win.WmsTx;
    };
    const rows = [{ sku: 'AAA001', longs: ['LONG-1'], name: 'หมอน', sys: 5, tx: 1, diff: 4, id: 'LONG-1' }];

    it('ส่งแค่รหัสกับชื่อ ไม่ส่งตัวเลข เพราะสคริปต์คิด Location เอง', async () => {
      const r = await loadWith({ lines: [], added: 1 }).addCount('u', rows);
      expect(win.sent.body).toEqual({ op: 'count-add', items: [{ sku: 'AAA001', longs: ['LONG-1'], name: 'หมอน' }] });
      expect(r.added).toBe(1);
    });

    it('สคริปต์รุ่นเก่าไม่รู้จักคำสั่ง ต้องบอกให้ Deploy ใหม่', async () => {
      await expect(loadWith({ error: 'ไม่รู้จักคำสั่งนี้' }).addCount('u', rows)).rejects.toThrow('New version');
    });

    it('ข้อความอื่นจากสคริปต์ส่งต่อตามจริง', async () => {
      await expect(loadWith({ error: 'ส่งได้ไม่เกินวันละ 300 จุด' }).addCount('u', rows)).rejects.toThrow('300 จุด');
    });
  });

  it('กรองตามแบบและคำค้น ค้นได้ทั้งรหัสสองแบบและชื่อ', () => {
    const { rows } = WmsTx.compareStock(LEDGER, map(co('LONG-1', 120), co('LONG-2', 40)));
    expect(WmsTx.filterDiff(rows, '', '').length).toBe(3);
    expect(WmsTx.filterDiff(rows, 'more', '').map((r) => r.sku)).toEqual(['AAA001']);
    expect(WmsTx.filterDiff(rows, '', 'long-2').map((r) => r.sku)).toEqual(['BBB002']);
    expect(WmsTx.filterDiff(rows, '', 'ccc003').map((r) => r.sku)).toEqual(['CCC003']);
    expect(WmsTx.filterDiff(rows, '', 'ที่ นอน').map((r) => r.sku)).toEqual(['BBB002']);
    expect(WmsTx.filterDiff(rows, 'more', 'ที่นอน')).toEqual([]);
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
