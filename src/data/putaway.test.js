/**
 * ตัวช่วยจัดที่เก็บ: public/wms-putaway.js
 *
 * คนจะเอาแผนนี้ไปยกของขึ้นชั้นจริง ถ้าเสนอช่องที่มีของอยู่แล้วหรือผิดชั้นคือของปนกันหน้างาน
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-putaway.js'), 'utf8');

let P;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  P = win.WmsPutaway;
});

/* SKU สมมติ: ที่นอน 5 ฟุต 3.5 ฟุต ท็อปเปอร์ ของแถม และของอื่น */
const SKUS = [
  ['AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ รุ่นหนึ่ง'],
  ['AAA002', 'AAA0000000002', 'ที่นอน 3.5FT สมมติ รุ่นสอง'],
  ['BBB003', 'BBB0000000003', 'ท็อปเปอร์ 6FT สมมติ'],
  ['FRE004', 'FRE0000000004', 'แถม-หมอนสมมติ'],
  ['CCC005', 'CCC0000000005', 'ผ้ารองกันเปื้อนที่นอน 5FT สมมติ'],
];
const CAP = { AAA001: 16, AAA002: 19, BBB003: 10, CCC005: 0 };

/**
 * ทำคำตอบ tx-fifo ปลอมจากแถวอ่านง่าย
 * แถว = { s, lot, po, from, to, qty, t: 'รับ'|'เบิก'|'ขาย', d, open, gr }
 */
function fifo(list, extraLocs = []) {
  const res = { skus: SKUS, pos: [], locs: [], days: [], rows: [], last: '' };
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  extraLocs.forEach((l) => idx(res.locs, l));
  list.forEach((r, n) => {
    const t = r.t === 'ขาย' ? 2 : r.t === 'เบิก' ? 1 : 0;
    const flag = (r.open ? 1 : 0) + (r.gr ? 2 : 0) + (r.d ? 8 : 0);
    res.rows.push([n + 2, r.s, r.lot ?? 1, idx(res.pos, r.po ?? '9900000001'), r.from ? idx(res.locs, r.from) : -1,
      r.to ? idx(res.locs, r.to) : -1, r.qty, t, r.d ? idx(res.days, r.d) : -1, flag]);
    if (t === 2 && r.d && r.d > res.last) res.last = r.d;
  });
  return res;
}
const recv = (s, to, qty, o = {}) => ({ s, to, qty, t: 'รับ', ...o });
const move = (s, from, to, qty, o = {}) => ({ s, from, to, qty, t: 'เบิก', ...o });
const sell = (s, from, qty, d) => ({ s, from, qty, t: 'ขาย', d, open: true });
const line = (sku, qty, o = {}) => ({ n: o.n ?? 1, ...(o.label ? { label: o.label } : {}), pid: '', sku, lot: '', po: o.po ?? '9900000002-09', name: o.name ?? '', qty, truck: '', remark: '' });

/* ช่องที่เคยใช้แล้วตอนนี้ว่าง: ชั้น 1 สองช่อง ชั้น 2 สามช่อง พื้น A หนึ่งโล โซน D สองโล */
const EMPTY = ['R01-01-01', 'R01-02-01', 'R02-01-02', 'R02-02-02', 'R02-03-03', 'A-01-03', 'D-02-01', 'D-02-02'];
const WAS = EMPTY.map((l) => recv(4, l, 1)).concat(EMPTY.map((l) => move(4, l, 'X-TRASH', 1)));

function setup(more = []) {
  const res = fifo([...WAS, ...more]);
  const snap = P.stock(res);
  const cap = P.capMap(Object.entries(CAP).map(([k, v]) => [k, '', v]));
  return { res, snap, cap };
}

describe('wms-putaway.js — อ่านแพลนที่คัดลอกจากชีต', () => {
  it('มีหัวตารางแบบแท็บ INPUT ข้ามแถวว่างกับแถวที่ไม่มีจำนวน', () => {
    const text = [
      ['NO.', 'Product ID', 'LOT', 'PO', 'SKU', 'Product Name', 'QTY', 'Truck', 'REMARK'],
      ['1', 'AAA0000000001', '', '9900000002-09', 'AAA001', 'ที่นอน 5FT สมมติ', '1,015', 'รถสมมติ', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['30', '', '', '', '', '', '', '', ''],
      ['31', 'FRE0000000004', '', '9900000003', 'FRE004', 'แถม-หมอนสมมติ', '0', 'รถสมมติ', ''],
    ].map((r) => r.join('\t')).join('\n');
    const r = P.parsePlan(text);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ pid: 'AAA0000000001', sku: 'AAA001', po: '9900000002-09', qty: 1015, n: 2, no: '1', label: 'NO. 1' });
    expect(r.skipped).toEqual([
      { n: 4, label: 'NO. 30', why: 'ไม่มีรหัสสินค้า' },
      { n: 5, label: 'NO. 31', why: 'จำนวนไม่ใช่ตัวเลขที่มากกว่า 0', code: 'FRE004' },
    ]);
  });

  it('ไม่มีหัวตาราง ใช้ลำดับแบบแท็บ INPUT ทั้งแบบมีและไม่มีช่อง NO.', () => {
    const withNo = P.parsePlan('1\tAAA0000000001\t\t9900000002-09\tAAA001\tที่นอน\t15\tรถ\t');
    expect(withNo.lines[0]).toMatchObject({ sku: 'AAA001', qty: 15, label: 'NO. 1' });
    const noNo = P.parsePlan('AAA0000000001\t\t9900000002-09\tAAA001\tที่นอน\t15\tรถ\t');
    expect(noNo.lines[0]).toMatchObject({ pid: 'AAA0000000001', sku: 'AAA001', qty: 15, no: '', label: 'แถว 1' });
  });
});

describe('wms-putaway.js — ประเภทสินค้าและความจุ', () => {
  it('แยกที่นอนตามขนาด ท็อปเปอร์ ของแถม และของที่ใช้กับที่นอน', () => {
    expect(P.kindOf('ที่นอน 5FT สมมติ')).toMatchObject({ kind: 'mattress', level1: true, rib: false });
    expect(P.kindOf('ที่นอน 6FT สมมติ').level1).toBe(true);
    expect(P.kindOf('ที่นอน 3.5FT สมมติ')).toMatchObject({ level1: false, rib: true, label: 'ที่นอน 3.5 ฟุต' });
    expect(P.kindOf('ท็อปเปอร์พับ 3FT สมมติ')).toMatchObject({ kind: 'topper', rib: true });
    expect(P.kindOf('แถม - ชุดเครื่องนอน 5FT')).toMatchObject({ kind: 'free', level1: false, rib: false });
    expect(P.kindOf('หมอน', 'FRE001').kind).toBe('free');
    expect(P.kindOf('ผ้ารองกันเปื้อนที่นอน 5FT')).toMatchObject({ kind: 'other', level1: false });
  });

  it('อ่านตารางความจุจากหัวตาราง เก็บ 0 ไว้ นับช่องว่าง รหัสซ้ำใช้แถวแรก', () => {
    const r = P.capFromRows([
      ['SKU', 'Product ID', 'Description', 'STD / pallet'],
      ['AAA001', 'AAA0000000001', 'ที่นอน', 16],
      ['AAA002', 'AAA0000000002', 'ที่นอน', ''],
      ['AAA003', 'AAA0000000003', 'ที่นอน', 0],
      ['AAA001', 'AAA0000000001', 'ซ้ำ', 99],
      ['', '', '', ''],
    ]);
    expect(r).toEqual({ rows: [['AAA001', 'AAA0000000001', 16], ['AAA003', 'AAA0000000003', 0], ['AAA001', 'AAA0000000001', 99]], blank: 1, missing: '' });
    const m = P.capMap(r.rows);
    expect(m).toMatchObject({ AAA001: 16, AAA0000000001: 16, AAA003: 0 });
    expect(P.capFromRows([['a', 'b'], ['1', '2']]).missing).toMatch(/หาหัวตาราง/);
  });
});

describe('wms-putaway.js — สต๊อกตอนนี้', () => {
  it('ช่องที่เคยใช้แต่ว่างแล้วคือช่องว่าง โลเปิดประจำคือโลที่เติมบ่อยสุด ยอดขายต่อวันคิดจากวันขาย', () => {
    const { snap } = setup([
      recv(0, 'R05-01-01', 16), recv(0, 'R05-02-01', 16),
      recv(0, 'B-01-01', 10, { open: true }), recv(0, 'A-09-09', 3, { open: true }),
      move(0, 'R05-01-01', 'B-01-01', 16, { open: true }),
      move(0, 'R05-02-01', 'A-09-09', 8, { open: true }),
      move(0, 'R05-02-01', 'B-01-01', 8, { open: true }),
      sell(0, 'B-01-01', 7, '2026-03-01'), sell(0, 'B-01-01', 7, '2026-03-07'),
      recv(1, 'RIB', 7),
    ]);
    const x = snap.info[0];
    expect(x.regular).toBe('B-01-01');
    expect(x.openQty).toBe(10 + 16 + 8 - 14 + 3 + 8);
    expect(x.perDay).toBeCloseTo(14 / 7);
    expect(snap.info[1].rib).toBe(7);
    expect(snap.emptyR).toEqual(['R01-01-01', 'R01-02-01', 'R02-01-02', 'R02-02-02', 'R02-03-03', 'R05-01-01', 'R05-02-01']);
    expect(snap.emptyFloor.D).toEqual(['D-02-01', 'D-02-02']);
  });
});

describe('wms-putaway.js — จัดที่เก็บตามกติกา', () => {
  const rows = (o) => o.rows.map((r) => [r.loc, r.qty, r.tag]);

  it('ที่นอน 5 ฟุตลงชั้น 1 เท่านั้น เศษลงช่องว่างชั้น 1 ช่องของตัวเอง', () => {
    const { snap, cap } = setup();
    const [o] = P.plan([line('AAA001', 35)], snap, cap);
    /* ชั้น 1 มีแค่สองช่อง เศษไม่มีช่องชั้น 1 แล้ว ลงพื้นว่างแทน ไม่มีของเดิมให้อ้างก็เอาโลว่างแรก */
    expect(rows(o)).toEqual([['R01-01-01', 16, 'rack'], ['R01-02-01', 16, 'rack'], ['A-01-03', 3, 'floor']]);
    expect(o.rows[2].why).toBe('ชั้น 1 เต็ม ลงโลพื้นว่าง');
    const { snap: s2 } = setup([recv(0, 'A-01-01', 5)]);
    const [o2] = P.plan([line('AAA001', 35)], s2, cap);
    expect(rows(o2)[2]).toEqual(['A-01-03', 3, 'floor']);
    expect(o2.rows[2].why).toMatch(/ใกล้ A-01-01/);
  });

  it('ที่นอน 3.5 ฟุตไม่ลงชั้น 1 เศษไป RIB', () => {
    const { snap, cap } = setup();
    const [o] = P.plan([line('AAA002', 25)], snap, cap);
    expect(rows(o)).toEqual([['R02-01-02', 19, 'rack'], ['RIB', 6, 'rib']]);
  });

  it('เศษ 3.5 ฟุตรวมกับเศษใน RIB ครบพาเลทแล้วขึ้นแร็ค พร้อมแถวย้ายออกจาก RIB', () => {
    const { snap, cap } = setup([recv(1, 'RIB', 7)]);
    const [o] = P.plan([line('AAA002', 14)], snap, cap);
    expect(o.rows.map((r) => [r.loc, r.qty, r.tag, !!r.move])).toEqual([
      ['R02-01-02', 12, 'rack', false], ['R02-01-02', 7, 'move', true], ['RIB', 2, 'rib', false],
    ]);
    /* สองบรรทัด SKU เดียวกัน บรรทัดหลังเห็นเศษที่บรรทัดแรกเพิ่งส่งเข้า RIB */
    const { snap: s2 } = setup();
    const two = P.plan([line('AAA002', 10, { n: 1 }), line('AAA002', 10, { n: 2 })], s2, cap);
    expect(rows(two[0])).toEqual([['RIB', 10, 'rib']]);
    expect(rows(two[1])).toEqual([['R02-01-02', 9, 'rack'], ['R02-01-02', 10, 'move'], ['RIB', 1, 'rib']]);
  });

  it('โลเปิดเหลือขายไม่ถึงเกณฑ์ ส่ง 1 พาเลทเข้าโลเปิดประจำ ติ๊ก OPEN เกณฑ์ปรับได้', () => {
    const base = [
      recv(0, 'R09-01-01', 30),
      move(0, 'R09-01-01', 'B-01-01', 10, { open: true }),
      sell(0, 'B-01-01', 2, '2026-03-01'), sell(0, 'B-01-01', 2, '2026-03-02'),
    ];
    const { snap, cap } = setup(base);
    /* เหลือ 6 ขายวันละ 2 = 3 วัน ไม่ต่ำกว่า 3 */
    expect(P.plan([line('AAA001', 16)], snap, cap)[0].rows[0].tag).toBe('rack');
    const [o] = P.plan([line('AAA001', 20)], snap, cap, { coverDays: 4 });
    expect(rows(o)).toEqual([['B-01-01', 16, 'open'], ['R01-01-01', 4, 'rack']]);
    expect(o.rows[0].open).toBe(true);
    expect(o.rows[0].why).toMatch(/เหลือขายอีก 3\.0 วัน/);
  });

  it('ของหมดทั้งคลัง เข้าโลเปิดเลย', () => {
    const { snap, cap } = setup([
      recv(0, 'B-01-01', 4, { open: true }), sell(0, 'B-01-01', 4, '2026-03-01'),
    ]);
    const [o] = P.plan([line('AAA001', 10)], snap, cap);
    expect(rows(o)).toEqual([['B-01-01', 10, 'open']]);
    expect(o.rows[0].why).toBe('ของหมดทั้งคลัง เข้าโลเปิดเลย');
  });

  it('เศษ PO เดียวกับที่อยู่ในโลเปิด เติมเข้าโลเปิดได้', () => {
    const { snap, cap } = setup([
      recv(0, 'B-01-01', 40, { open: true, po: '9900000002' }),
    ]);
    const [o] = P.plan([line('AAA001', 20, { po: '9900000002-09' })], snap, cap);
    expect(rows(o)).toEqual([['R01-01-01', 16, 'rack'], ['B-01-01', 4, 'open']]);
  });

  it('ของแถมไปโซน D ช่องว่างใกล้โลเดิมของ SKU นั้น PO เดียวกันเติมโลเดิม', () => {
    const { snap, cap } = setup([recv(3, 'D-02-05', 50, { po: '9900000009' })]);
    const [o] = P.plan([line('FRE004', 360, { po: '9900000010' })], snap, cap);
    expect(rows(o)).toEqual([['D-02-02', 360, 'floor']]);
    const [same] = P.plan([line('FRE004', 360, { po: '9900000009' })], snap, cap);
    expect(rows(same)).toEqual([['D-02-05', 360, 'floor']]);
  });

  it('ไม่มีความจุหรือความจุเป็น 0 ให้เลือกเอง', () => {
    const { snap, cap } = setup();
    const out = P.plan([line('CCC005', 5), line('ZZZ999', 5)], snap, cap);
    expect(out[0].rows[0]).toMatchObject({ loc: '', tag: 'manual', why: expect.stringMatching(/เป็น 0/) });
    expect(out[1].rows[0]).toMatchObject({ loc: '', tag: 'manual', why: expect.stringMatching(/ไม่มีความจุ/) });
  });

  it('คนละบรรทัดไม่ได้ช่องเดียวกัน แถวที่คนแก้เองจองช่องไว้ก่อน', () => {
    const { snap, cap } = setup();
    const lines = [line('AAA002', 19, { n: 1 }), line('BBB003', 10, { n: 2 })];
    const auto = P.plan(lines, snap, cap);
    expect(auto.map((o) => o.rows[0].loc)).toEqual(['R02-01-02', 'R02-02-02']);
    const out = P.plan(lines, snap, cap, {}, { 1: [{ loc: 'R02-01-02', qty: 10, tag: 'rack' }] });
    expect(out[0].rows[0].loc).toBe('R02-02-02');
    expect(out[1].manual).toBe(true);
  });

  it('ช่องว่างไม่พอ ที่เหลือรวมเป็นแถวเดียวให้เลือกเอง', () => {
    const { snap, cap } = setup();
    const [o] = P.plan([line('AAA001', 64)], snap, cap);
    expect(rows(o)).toEqual([['R01-01-01', 16, 'rack'], ['R01-02-01', 16, 'rack'], ['', 32, 'manual']]);
  });
});

describe('wms-putaway.js — ตรวจแผนที่แก้แล้ว', () => {
  it('จับปน SKU ผิดชั้น เกินความจุ ยอดไม่ครบ และโลที่ไม่เคยมี', () => {
    const { snap, cap } = setup([recv(0, 'R03-01-02', 5)]);
    const lines = [line('AAA002', 19, { n: 1 }), line('BBB003', 10, { n: 2 })];
    const out = [
      { rows: [{ loc: 'R03-01-02', qty: 19, tag: 'rack' }] },                 // มี AAA001 อยู่แล้ว
      { rows: [{ loc: 'R01-01-01', qty: 8, tag: 'rack' }, { loc: 'Z-99', qty: 1, tag: 'rack' }] },
    ];
    const r = P.check(lines, out, snap, cap);
    expect(r.lines[0].rows[0].map((x) => x.level)).toContain('red');
    expect(r.lines[1].rows[0].map((x) => x.text)).toContain('R ชั้น 1 ใส่ได้แค่ที่นอน 5 ฟุตกับ 6 ฟุต');
    expect(r.lines[1].issues).toEqual(['ลงไว้ 9 จาก 10 ชิ้น ยังขาด 1']);
    expect(r.lines[1].rows[1].map((x) => x.text)).toContain('ไม่เคยมีโลนี้ในสมุด ตรวจว่าพิมพ์ถูก');
    const over = P.check([line('AAA002', 25)], [{ rows: [{ loc: 'R02-01-02', qty: 25, tag: 'rack' }] }], snap, cap);
    expect(over.lines[0].rows[0].map((x) => x.text)).toContain('รวมแล้ว 25 ชิ้น เกินความจุพาเลท 19');
  });

  it('สองบรรทัดคนละ SKU ใส่ช่องเดียวกันเป็นสีแดง แผนที่ระบบเสนอเองไม่มีสีแดง', () => {
    const { snap, cap } = setup();
    const lines = [line('AAA002', 19, { n: 1 }), line('BBB003', 10, { n: 2 })];
    const dup = P.check(lines, [{ rows: [{ loc: 'R02-01-02', qty: 19 }] }, { rows: [{ loc: 'R02-01-02', qty: 10 }] }], snap, cap);
    expect(dup.red).toBe(2);
    expect(dup.lines[0].rows[0].map((x) => x.text)).toContain('ซ้ำกับ แถว 2 คนละ SKU (ปน SKU)');
    const labelled = [line('AAA002', 19, { n: 2, label: 'NO. 1' }), line('BBB003', 10, { n: 3, label: 'NO. 2' })];
    const dup2 = P.check(labelled, [{ rows: [{ loc: 'R02-01-02', qty: 19 }] }, { rows: [{ loc: 'R02-01-02', qty: 10 }] }], snap, cap);
    expect(dup2.lines[0].rows[0].map((x) => x.text)).toContain('ซ้ำกับ NO. 2 คนละ SKU (ปน SKU)');
    const auto = P.plan([...lines, line('AAA001', 35, { n: 3 }), line('FRE004', 9, { n: 4 })], snap, cap);
    expect(P.check([...lines, line('AAA001', 35, { n: 3 }), line('FRE004', 9, { n: 4 })], auto, snap, cap).red).toBe(0);
  });
});

describe('wms-putaway.js — ส่งออก', () => {
  it('หน้าตาแท็บ OUTPUT ช่อง OPEN เป็น TRUE/FALSE ตอนคัดลอกไปชีต แถวย้ายจาก RIB มีหมายเหตุ', () => {
    const lines = [line('AAA002', 14)];
    const out = [{ name: 'ที่นอน 3.5FT สมมติ', rows: [
      { loc: 'B-01-01', qty: 12, open: true, tag: 'open' },
      { loc: 'B-01-01', qty: 7, tag: 'move', move: true, from: 'RIB' },
      { loc: 'RIB', qty: 2, tag: 'rib', remark: 'รอตู้' },
    ] }];
    const sheet = P.exportRows(lines, out, true);
    expect(sheet[0]).toEqual(['REMARK', 'Location', 'OPEN', 'LOT', 'PO.', 'SKU', 'Product Name', 'QTY', 'สถานะ']);
    expect(sheet.slice(1).map((r) => [r[0], r[1], r[2], r[3], r[7], r[8]])).toEqual([
      ['', 'B-01-01', 'TRUE', '?', 12, 'เข้าโลเปิด'],
      ['ย้ายจาก RIB', 'B-01-01', 'FALSE', '?', 7, 'ย้ายจาก RIB'],
      ['รอตู้', 'RIB', 'FALSE', '?', 2, 'เศษเข้า RIB'],
    ]);
    expect(P.exportRows(lines, out, false)[1][2]).toBe('✓');
  });
});
