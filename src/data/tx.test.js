/**
 * สต๊อกราย Location: apps-script/tx-api.gs (คิดยอดจากสมุดรายการ) กับ public/wms-tx.js
 *
 * รันสคริปต์จริงกับชีตปลอม เพราะตัวเลขพวกนี้ต้องตรงกับสูตร SUMIFS ในชีตยอดของทีม
 * ถ้าเพี้ยนไปนิดเดียวคนจะเลิกเชื่อทั้งหน้า ข้อมูลในเทสต์นี้สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
  const ss = {
    getSheets: () => [...extraSheets, sheet],
    getSheetByName: () => sheet,
    getSpreadsheetTimeZone: () => 'UTC',
    getUrl: () => 'https://docs.example/d/1/edit',
  };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    DriveApp: {}, ScriptApp: {},
  };
  const api = new Function(...Object.keys(env), GS + '\nreturn { doGet: doGet };')(...Object.values(env));
  return (parameter) => api.doGet({ parameter });
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

  it('สคริปต์ไม่มีคำสั่งเขียนลงชีต', () => {
    expect(GS).not.toMatch(/\.(setValue|setValues|appendRow|clearContent|insertRows|deleteRow|setFormula)\w*\(/);
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

  it('ข้อความของรายการข้อมูลผิดอ่านรู้เรื่องทุกชนิด', () => {
    const base = { sku: 'AAA001', lot: 8, po: '100', loc: 'A-01-01' };
    expect(WmsTx.describeIssue({ ...base, kind: 'mixed', blank: 20, open: 400, out: 420, bal: 0 }))
      .toBe('AAA001 lot 8 PO 100 ที่ A-01-01 เข้าแบบว่าง 20 แบบเปิด 400 ออก 420 ยอดจริงคือ 0');
    expect(WmsTx.describeIssue({ ...base, po: '0', kind: 'outonly', bal: -70 })).toBe('AAA001 lot 8 ที่ A-01-01 ติดลบ 70');
    expect(WmsTx.describeIssue({ kind: 'locname', name: 'R-1', like: 'R1' })).toBe('R-1 น่าจะเป็นที่เดียวกับ R1');
    expect(WmsTx.describeIssue({ kind: 'locname', name: 'จุดแปลก', like: '', rowCount: 3 })).toBe('จุดแปลก ใช้แค่ 3 แถว');
    expect(WmsTx.describeIssue({ kind: 'date', note: 'GR 05-03-26', rowCount: 9, near: '2026-08-02' })).toContain('02/08');
    for (const { kind } of WmsTx.ISSUES) expect(WmsTx.describeIssue({ ...base, kind, what: 'x', note: 'n', name: 'n' })).not.toBe('');
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
