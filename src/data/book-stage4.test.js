/**
 * สมุดสต๊อก ขั้น 4: รับของ แปลงสินค้า ปรับยอด เลข TRcloud และยกเลิกชุดในสมุดใหม่ด้วยแถวกลับรายการ
 * public/wms-book.js กับ apps-script/book-api.gs + tx-api.gs ตัวจริง และหน้า FIFO / LOT 0 / LOT-PO ที่ต้องอ่านแถวขายติดลบเป็นการยกเลิก
 *
 * สิ่งที่ต้องไม่พัง: รับของลง Note GR ผิดรูป (หน้า FIFO / ปีของ LOT หาย) แปลงสินค้าแล้วชิ้นสองฝั่งไม่เท่ากัน
 * ปรับยอดทับยอดที่เพิ่งมีคนลง ยกเลิกชุดที่ของถูกใช้ไปแล้วจนกองติดลบ และรายงานนับแถวที่ถูกยกเลิกเป็นของขายจริง
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadBook, fifoFromBook } from '../dev/fake-gas.js';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let B, F, Z, L;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fifo.js', 'wms-lot0.js', 'wms-lotpo.js'].forEach((f) => new Function('window', read(f))(win));
  B = win.WmsBook;
  F = win.WmsFifo;
  Z = win.WmsLot0;
  L = win.WmsLotPo;
});

const SKUS = [
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1'],
  ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2'],
  ['FRE003', 'FRE0000000003', 'แถม-หมอนสมมติ 3'],
  ['CCC004', 'CCC0000000004', 'หมอนสมมติ 4'],
];

/** คำตอบ tx-fifo ปลอม แถว = { s, lot, po, from, to, qty, t: 'รับ'|'เบิก'|'ขาย', d, open, row, flag } */
function fifo(list, extra = {}) {
  const res = { skus: SKUS, pos: [], locs: [], days: [], rows: [], ...extra };
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  list.forEach((r, n) => {
    const t = r.t === 'ขาย' ? 2 : r.t === 'เบิก' ? 1 : 0;
    res.rows.push([r.row || n + 2, r.s, r.lot, idx(res.pos, r.po), r.from ? idx(res.locs, r.from) : -1, r.to ? idx(res.locs, r.to) : -1,
      r.qty, t, r.d ? idx(res.days, r.d) : -1, (r.open ? 1 : 0) + (r.d && t === 2 ? 8 : 0) + (r.flag || 0)]);
  });
  return res;
}

/* สต๊อกสมมติ: ที่นอนเปิดขายที่ A-01-01 สำรองที่ R · ท็อปเปอร์เปิดสองกองสอง LOT · หมอนสองกองที่โลเดียวกัน */
const BASE = (extra) => fifo([
  { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 5, open: 1, d: '2026-10-02', flag: 2 + 8 },
  { s: 0, lot: 8, po: 'P1', to: 'R01-01-01', qty: 10, d: '2026-10-02', flag: 2 + 8 },
  { s: 1, lot: 7, po: 'P5', to: 'A-03-01', qty: 2, open: 1, d: '2026-09-01', flag: 2 + 8 },
  { s: 1, lot: 8, po: 'P6', to: 'A-04-01', qty: 5, open: 1, d: '2026-10-01', flag: 2 + 8 },
  { s: 3, lot: 9, po: 'P7', to: 'B-01-01', qty: 4, open: 1 },
  { s: 3, lot: 10, po: 'P8', to: 'B-01-01', qty: 1, open: 1 },
], extra);

/* ── wms-book.js ──────────────────────────────────────────────────────── */

describe('รับของ (หน้าเว็บ)', () => {
  const OUT = [
    ['ย้ายจาก RIB', 'A-01-01', 'TRUE', '8', 'P1', 'AAA001', 'ที่นอนสมมติ 1', '2'],
    ['', 'R01-02-01', 'FALSE', '10', 'P9', 'AAA001', 'ที่นอนสมมติ 1', '6'],
    ['', 'A-02-01', 'TRUE', '?', 'P9', 'NEW005', 'สินค้าใหม่สมมติ', '3'],
  ];
  const WANT = {
    rows: [
      { sku: 'AAA001', long: '', name: 'ที่นอนสมมติ 1', lot: '10', po: 'P9', to: 'R01-02-01', qty: '6', status: '-' },
      { sku: 'NEW005', long: '', name: 'สินค้าใหม่สมมติ', lot: '', po: 'P9', to: 'A-02-01', qty: '3', status: 'เปิด' },
    ],
    moves: [{ sku: 'AAA001', from: 'RIB', to: 'A-01-01', qty: '2', lot: '8', po: 'P1' }],
  };
  const tsv = (grid) => grid.map((l) => l.join('\t')).join('\n');

  it('Note GR วว-ดด-ปป จากวันที่ของชุด แบบที่ทีมพิมพ์ในสมุด', () => {
    expect(B.grNote('2026-11-19')).toBe('GR 19-11-26');
    expect(B.grNote('')).toBe('');
    expect(B.grNote('19/11/2026')).toBe('');
  });

  it('วางตาราง OUTPUT ของหน้าจัดที่เก็บ มีหัวตารางหรือไม่มีก็ได้ · แถวย้ายจาก RIB แยกเป็นงานย้าย · LOT ? = ว่าง · ไม่ใช่รูปนี้ = null', () => {
    const head = ['REMARK', 'Location', 'OPEN', 'LOT', 'PO.', 'SKU', 'Product Name', 'QTY'];
    expect(B.grFromOutput(tsv([head, ...OUT]))).toEqual(WANT);
    expect(B.grFromOutput(tsv(OUT) + '\n\n')).toEqual(WANT);
    expect(B.grFromOutput('SKU\tชิ้น\nAAA001\t2')).toBe(null);
    expect(B.grFromOutput('')).toBe(null);
  });

  it('กติกาแถวรับ: LOT 1–12 (0 ได้แต่เตือน) ต้องมี PO โล ชิ้น วันที่ · SKU ใหม่ / โลใหม่รับได้แต่เตือน · Status ว่างตามโล', () => {
    const st = B.stock(BASE());
    const plan = B.planGr([
      { sku: 'aaa001', lot: '10', po: 'p9', to: 'r01-02-01', qty: '6' },
      { sku: 'NEW005', long: 'new0000000005', name: 'สินค้าใหม่สมมติ', lot: '0', po: 'P9', to: 'A-02-01', qty: 3, status: 'เปิด', tr: 'gr-own' },
      { sku: 'AAA001', lot: '13', po: 'P9', to: 'R01-02-01', qty: 1 },
      { sku: 'AAA001', lot: '10', po: '', to: 'R01-02-01', qty: 1 },
      {},
    ], st, { date: '2026-11-19' });
    expect(plan.lines.map((o) => (o.st === 'bad' ? o.why : o.st))).toEqual(['ok', 'ok', 'LOT ต้องเป็นเดือน 1–12 ที่เห็นบนของ', 'ใส่ PO', 'blank']);
    expect(plan.lines[0].warn).toEqual(['โล R01-02-01 ไม่เคยมีในสมุด เช็คว่าพิมพ์ถูก']);
    expect(plan.lines[1].warn).toEqual(['SKU ใหม่ ยังไม่เคยมีในสมุด', 'LOT 0 = ไม่รู้ LOT', 'โล A-02-01 ไม่เคยมีในสมุด เช็คว่าพิมพ์ถูก']);
    expect(plan.total).toMatchObject({ rows: 2, qty: 9, ok: 2, bad: 2, lines: 4 });
    expect(B.planGr([{ sku: 'AAA001', lot: '1', po: 'P', to: 'A-01-01', qty: 1 }], st, {}).lines[0].why).toBe('เลือกวันที่รับก่อน');

    /* เลข TRcloud: ช่องของแถวก่อน ไม่มีใช้เลขของชุด · รับของไม่บังคับเลข */
    B.trApply(plan, 'gr', { tr: 'gr6911-0001' });
    expect(plan.total.noTr).toBe(0);
    const copy = B.grCopy(plan);
    expect(copy).toEqual([
      ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 6, 'รับ', 'GR 19-11-26', '', 'GR6911-0001'],
      ['NEW005', 'NEW0000000005', '0', 'P9', '', 'A-02-01', 3, 'รับ', 'GR 19-11-26', 'เปิด', 'GR-OWN'],
    ]);
    expect(B.namesOf(st, copy, plan.rows)).toEqual({ AAA0000000001: 'ที่นอนสมมติ 1', NEW0000000005: 'สินค้าใหม่สมมติ' });
    /* วางในชีตเดิม: คอลัมน์ N = เลข TRcloud ไม่มีใช้เลขที่เอกสาร */
    const lines = B.tsv([copy[0], copy[0].slice(0, 10)], 'ทดลอง', 'T2611-0009').split('\n').map((l) => l.split('\t'));
    expect(lines.map((l) => [l.length, l[12], l[13]])).toEqual([[14, 'ทดลอง', 'GR6911-0001'], [14, 'ทดลอง', 'T2611-0009']]);
  });

  it('รับของเปิดขาย Supplier ที่สองของ SKU ที่เปิดขายอยู่ = เตือน', () => {
    const st = B.stock(BASE({ sup: { rows: [['P1', 'บริษัทสมมติ ก'], ['P9', 'บริษัทสมมติ ข']] } }));
    const plan = B.planGr([{ sku: 'AAA001', lot: '10', po: 'P9', to: 'A-01-01', qty: 1, status: 'เปิด' }], st, { date: '2026-11-19' });
    expect(plan.lines[0].warn).toEqual(['เปิดสอง Supplier พร้อมกัน (บริษัทสมมติ ก / บริษัทสมมติ ข)']);
  });
});

describe('แปลงสินค้า (หน้าเว็บ)', () => {
  const PAIRS = { pairs: [['CCC0000000004', 'FRE0000000003', 'หมอนสมมติ 4'], ['CCC0000000004', 'BBB0000000002', 'หมอนสมมติ 4']] };

  it('ไม่ใส่ SKU ตอนซื้อ = ไล่คู่ใน MASTER ที่มีของพอ · หยิบกองเปิดขาย FIFO แบ่งหลายกอง · คู่ เบิก/รับ โลเดียว LOT PO เดิม', () => {
    const st = B.stock(BASE({ convert: PAIRS }));
    const plan = B.planConv([
      { sku: 'ccc004', qty: 4 },
      { sku: 'CCC004', buy: 'AAA001', qty: 1 },
      { sku: 'CCC004', qty: 9 },
      { sku: 'CCC004', from: 'a-04-01', qty: 3, mr: 'mr-1', gr: 'gr-1' },
      { sku: 'BBB002', qty: 1 },
      { sku: 'CCC004', buy: 'CCC004', qty: 1 },
    ], st);
    expect(plan.lines.map((o) => (o.st === 'bad' ? o.why : o.st))).toEqual([
      'ok',
      'คู่นี้ไม่อยู่ใน MASTER แปลงสินค้า',
      'โลเปิดขาย มี SKU ตอนซื้อ 3 ชิ้น',
      'ok',
      'ไม่มีใน MASTER แปลงสินค้า ใส่ SKU ตอนซื้อเอง',
      'คู่นี้ไม่อยู่ใน MASTER แปลงสินค้า',
    ]);
    expect(plan.lines[0]).toMatchObject({ buy: 'BBB002', autoBuy: true });
    expect(plan.lines[3]).toMatchObject({ buy: 'BBB002', autoBuy: true });

    B.trApply(plan, 'conv', { mr: 'MR6911-0001' });
    expect(B.convCopy(plan)).toEqual([
      ['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
      ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด'],
      ['BBB002', 'BBB0000000002', '8', 'P6', 'A-04-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
      ['CCC004', 'CCC0000000004', '8', 'P6', '', 'A-04-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด'],
      ['BBB002', 'BBB0000000002', '8', 'P6', 'A-04-01', '', 3, 'เบิก', 'แปลงสินค้า', '', 'MR-1'],
      ['CCC004', 'CCC0000000004', '8', 'P6', '', 'A-04-01', 3, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR-1'],
    ]);
    /* ชิ้นรวมนับฝั่งเบิกฝั่งเดียว · แถวแรกไม่มีเลข GR = เตือนสีส้ม (ไม่ห้ามบันทึก) */
    expect(plan.lines[0].warn).toEqual(['ไม่มีเลข MR / GR ของ TRcloud']);
    expect(plan.lines[3].warn).toEqual([]);
    expect(plan.total).toMatchObject({ rows: 6, qty: 7, ok: 2, bad: 4, warn: 1, noTr: 1, lines: 6 });
  });

  it('ไม่มี MASTER แปลงสินค้า ต้องใส่ SKU ตอนซื้อเอง · ใส่แล้วใช้ได้ทุกคู่', () => {
    const st = B.stock(BASE());
    expect(B.planConv([{ sku: 'CCC004', qty: 1 }], st).lines[0].why).toBe('ไม่มี MASTER แปลงสินค้า ใส่ SKU ตอนซื้อเอง');
    const plan = B.planConv([{ sku: 'CCC004', buy: 'AAA001', from: 'R01-01-01', qty: 2 }], st);
    expect(plan.rows.map((r) => [r.sku, r.from, r.to, r.qty, r.type, r.status])).toEqual([
      ['AAA001', 'R01-01-01', '', 2, 'เบิก', ''], ['CCC004', '', 'R01-01-01', 2, 'รับ', ''],
    ]);
  });
});

describe('ปรับยอด (หน้าเว็บ)', () => {
  it('ใส่ยอดที่นับได้ ขาด = เบิก เกิน = รับ ตรง = ไม่ลง · LOT/PO ว่างใช้กองเดียวของโล · ต้องมีเหตุผล · ของที่เจอใหม่ใส่ LOT PO', () => {
    const st = B.stock(BASE());
    const plan = B.planAdj([
      { loc: 'a-01-01', sku: 'AAA001', count: 3, why: 'หาย' },
      { loc: 'R01-01-01', sku: 'AAA001', count: '12', why: 'เจอเพิ่ม' },
      { loc: 'A-03-01', sku: 'BBB002', count: 2 },
      { loc: 'A-01-01', sku: 'AAA001', lot: '8', po: 'P1', count: 1, why: 'นับผิด' },
      { loc: 'B-01-01', sku: 'CCC004', lot: '9', po: 'P7', count: 2 },
      { loc: 'B-01-01', sku: 'CCC004', count: 2, why: 'หาย' },
      { loc: 'A-09-01', sku: 'AAA001', count: 1, why: 'เจอเพิ่ม' },
      { loc: 'A-09-01', sku: 'AAA001', lot: '9', po: 'P2', count: 1, why: 'เจอเพิ่ม' },
      { loc: 'A-01-01', sku: 'AAA001', why: 'หาย' },
    ], st);
    expect(plan.lines.map((o) => (o.st === 'bad' ? o.why : o.st))).toEqual([
      'ok', 'ok', 'same',
      'กองนี้ซ้ำกับแถว 1',
      'ใส่เหตุผล เช่น นับผิด ของเสีย หาย เจอเพิ่ม ลงผิด',
      'โล B-01-01 มี SKU นี้ 2 กอง ใส่ LOT และ PO',
      'โล A-09-01 ไม่มี SKU นี้ ของที่เจอใหม่ใส่ LOT และ PO',
      'ok',
      'ใส่ยอดที่นับได้ (0 ได้)',
    ]);
    expect(plan.lines[7].warn).toEqual(['กองใหม่ ไม่เคยมี LOT 9 · P2 ที่โลนี้']);
    B.trApply(plan, 'adj', {});
    expect(B.adjCopy(plan)).toEqual([
      ['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', ''],
      ['AAA001', 'AAA0000000001', '8', 'P1', '', 'R01-01-01', 2, 'รับ', 'ปรับยอด เจอเพิ่ม', ''],
      ['AAA001', 'AAA0000000001', '9', 'P2', '', 'A-09-01', 1, 'รับ', 'ปรับยอด เจอเพิ่ม', 'เปิด'],
    ]);
    /* ยอดที่เห็นตอนคิด สคริปต์ใช้เช็คว่าสมุดไม่เปลี่ยนระหว่างนั้น */
    expect(plan.check).toEqual([
      { loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 5, count: 3 },
      { loc: 'R01-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 10, count: 12 },
      { loc: 'A-03-01', sku: 'BBB0000000002', lot: '7', po: 'P5', have: 2, count: 2 },
      { loc: 'B-01-01', sku: 'CCC0000000004', lot: '9', po: 'P7', have: 4, count: 2 },
      { loc: 'A-09-01', sku: 'AAA0000000001', lot: '9', po: 'P2', have: 0, count: 1 },
    ]);
    expect(plan.total).toMatchObject({ rows: 3, qty: 5, ok: 3, same: 1, bad: 5, warn: 1, noTr: 0, lines: 9 });
  });

  it('กองติดลบของสมุดเดิมปรับให้เท่ายอดที่นับได้', () => {
    const st = B.stock(fifo([
      { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 1, open: 1 },
      { s: 0, lot: 8, po: 'P1', from: 'A-01-01', qty: 3, t: 'ขาย', d: '2026-11-01' },
    ]));
    const plan = B.planAdj([{ loc: 'A-01-01', sku: 'AAA001', count: 0, why: 'ลงผิด' }], st);
    expect(plan.lines[0]).toMatchObject({ st: 'ok', have: -2, diff: 2, warn: ['กองนี้ติดลบ -2 ในสมุด'] });
    expect(plan.rows[0]).toMatchObject({ type: 'รับ', to: 'A-01-01', qty: 2, status: 'เปิด' });
  });
});

describe('เลข TRcloud ที่ควรมี (เตือน ไม่บังคับ)', () => {
  it('โอนย้าย QA คืนของ แปลงสินค้า ตารางเดิมที่เป็นงาน QA / RETURN / M/E / แปลง · งานย้ายธรรมดาไม่เตือน', () => {
    const plan = (mode, notes) => B.trApply({
      lines: notes.map((note, i) => ({ n: i + 1, in: {}, st: 'ok', warn: [], take: [{ note, type: 'เบิก' }] })), total: { warn: 0 },
    }, mode, {});
    expect(plan('move', ['โอนย้าย', 'โอนย้าย QA']).lines.map((o) => o.warn)).toEqual([[], ['ไม่มีเลข TRcloud']]);
    expect(plan('ret', ['M/E-00304']).total).toEqual({ warn: 1, noTr: 1 });
    expect(plan('rows', ['GR 09-11-26', 'RETURN', 'แปลงสินค้า', 'ขายหน้าร้าน']).lines.map((o) => o.warn.length)).toEqual([0, 1, 1, 0]);
    expect(plan('cut', ['2026-11-10']).total.noTr).toBe(0);
    const ok = B.trApply({ lines: [{ n: 1, in: { tr: 'tr-1' }, st: 'ok', warn: [], take: [{ note: 'โอนย้าย QA' }] }], total: { warn: 0 } }, 'move', {});
    expect([ok.lines[0].take[0].tr, ok.total.noTr]).toEqual(['TR-1', 0]);
  });
});

/* ── book-api.gs ──────────────────────────────────────────────────────── */

describe('book-api.gs ขั้น 4', () => {
  const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);   // 10 พ.ย. 2569 10:00 เวลาไทย
  function setup() {
    let t = NOW;
    const api = loadBook({ now: () => t });
    api.users([['ทดลอง', '1111', 'ลงรายการ'], ['หัวหน้าทดลอง', '9999', 'หัวหน้า']]);
    api.tick = (ms) => { t += ms; };
    return api;
  }
  const me = { who: 'ทดลอง', pin: '1111' };
  const head = { who: 'หัวหน้าทดลอง', pin: '9999' };
  const OPEN = [
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'A-01-01', 5, 'เปิด', '2026-10-02', ''],
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'R01-01-01', 10, '', '2026-10-02', ''],
    ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '7', 'P5', 'A-03-01', 4, 'เปิด', '2026-09-01', ''],
  ];
  const NAMES = { AAA0000000001: 'ที่นอนสมมติ 1', BBB0000000002: 'ท็อปเปอร์สมมติ 2', CCC0000000004: 'หมอนสมมติ 4' };
  const open = (api) => api.post({ op: 'bk-open', ...head, batch: 'o-1', asOf: 900, rows: OPEN });
  const bookMode = (api) => api.post({ op: 'bk-mode', ...head, mode: 'book' });
  const tx = (api) => api.ss.getSheetByName('Transaction').grid.slice(1).filter((r) => r && r.some((v) => v !== ''));
  const bal = (api) => api.ss.getSheetByName('ยอดคงเหลือ').grid.slice(1).filter((r) => r && r[0]);
  const pile = (api, loc, sku = 'AAA001') => (bal(api).find((x) => x[0] === loc && x[1] === sku) || [])[5];
  const recent = (api) => api.post({ op: 'bk-recent', ...head, days: 2 }).docs;
  const GR = ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', '', 'GR6911-0001'];
  const CONV = [
    ['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
    ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR6911-0002'],
  ];
  const save = (api, op, batch, copy, extra = {}) => api.post({ op, ...me, batch, date: '2026-11-10', base: 900, names: NAMES, copy, ...extra });
  function sale(api, batch, order, loc, qty) {
    return api.post({ op: 'bk-cut', ...me, batch, date: '2026-11-10', base: 900, names: NAMES,
      lines: [{ sys: 'JST', order, ref: 'ON' + order, track: 'TH' + order, sku: 'AAA0000000001', qty, piles: [[loc, '8', 'P1', qty]] }],
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', loc, '', qty, 'ขาย', '2026-11-10', 'เปิด']] });
  }

  it('รับของ: แถวรับมีแค่โลรับ Note ต้องเป็น GR วว-ดด-ปป · โหมดคัดลอกเก็บเลข TRcloud ไว้กับแถว (ช่อง 11) และกับชุด', () => {
    const api = setup();
    const why = (row) => save(api, 'bk-gr', 'x', [row]).bad[0].why;
    expect(why(Object.assign(GR.slice(), { 8: 'GR 9-11-26' }))).toBe('Note ต้องเป็น GR วว-ดด-ปป');
    expect(why(Object.assign(GR.slice(), { 8: 'ยกเลิก T1 · GR 09-11-26' }))).toBe('Note ต้องเป็น GR วว-ดด-ปป');
    expect(why(Object.assign(GR.slice(), { 4: 'RIB' }))).toBe('แถวรับของมีแค่โลรับ');
    expect(why(Object.assign(GR.slice(), { 7: 'เบิก' }))).toBe('ประเภทต้องเป็น รับ');

    expect(save(api, 'bk-gr', 'g-1', [GR, GR.slice(0, 10)])).toMatchObject({ doc: 'T2611-0001', rows: 2, qty: 6 });
    const d = recent(api)[0];
    expect(d).toMatchObject({ type: 'รับของ', tr: 'GR6911-0001' });
    expect(d.copy).toEqual([GR, GR.slice(0, 10)]);
    expect(tx(api)).toHaveLength(0);
  });

  it('แปลงสินค้า: ต้องมาเป็นคู่ เบิก SKU ตอนซื้อแล้วรับ SKU ใหม่ LOT PO ชิ้นเท่ากัน · ชิ้นของชุด = ชิ้นที่แปลง · เลข MR / GR', () => {
    const api = setup();
    expect(save(api, 'bk-conv', 'x', [CONV[0]]).error).toBe('แถวแปลงต้องมาเป็นคู่ เบิก SKU ตอนซื้อ แล้วรับ SKU ใหม่');
    const pairs = (b) => save(api, 'bk-conv', 'x', [CONV[0], b]);
    expect(pairs(Object.assign(CONV[1].slice(), { 2: '8' }))).toMatchObject({ error: 'คู่แปลงไม่ถูก 1 คู่', bad: [{ n: 1, sku: 'CCC004', why: 'LOT / PO ของคู่ไม่ตรงกัน' }] });
    expect(pairs(Object.assign(CONV[1].slice(), { 6: 3 })).bad[0].why).toBe('ชิ้นของคู่ไม่ตรงกัน');
    expect(pairs(Object.assign(CONV[0].slice(), { 4: '', 5: 'A-03-01', 7: 'รับ', 9: '' })).bad[0].why).toBe('แปลงเป็น SKU เดิม');
    expect(save(api, 'bk-conv', 'x', [CONV[1], CONV[0]]).bad[0].why).toBe('คู่ต้องเป็นแถวเบิกแล้วแถวรับ');
    expect(save(api, 'bk-conv', 'x', [Object.assign(CONV[0].slice(), { 8: 'แปลง' }), CONV[1]]).bad[0].why).toBe('Note ต้องเป็น แปลงสินค้า');
    expect(save(api, 'bk-conv', 'c-1', CONV)).toMatchObject({ doc: 'T2611-0001', rows: 2, qty: 2 });
    expect(recent(api)[0]).toMatchObject({ type: 'แปลง', qty: 2, tr: 'MR6911-0001, GR6911-0002' });
  });

  it('ปรับยอดใช้ได้เฉพาะหัวหน้า Note ปรับยอด + เหตุผล · โหมดบันทึกยอดในสมุดต้องยังเท่าที่เห็นตอนนับ', () => {
    const api = setup();
    const adj = [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', '']];
    const lines = [{ loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 5, count: 3 }];
    expect(api.post({ op: 'bk-adj', ...me, batch: 'a', copy: adj, lines }).error).toBe('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
    const go = (batch, copy, l = lines) => api.post({ op: 'bk-adj', ...head, batch, date: '2026-11-10', base: 900, copy, lines: l, names: NAMES });
    expect(go('a', [Object.assign(adj[0].slice(), { 8: 'ปรับยอด ' })]).bad[0].why).toBe('Note ต้องเป็น ปรับยอด ตามด้วยเหตุผล');
    expect(go('a', [Object.assign(adj[0].slice(), { 5: 'A-02-01' })]).bad[0].why).toBe('แถวปรับลดมีแค่โลเบิก');

    open(api);
    bookMode(api);
    sale(api, 'c-1', '1', 'A-01-01', 1);   // มีคนตัดขายระหว่างที่หัวหน้านับ
    const stale = go('a-1', adj);
    expect(stale.error).toMatch(/^ยอดในสมุดเปลี่ยนไปแล้ว 1 กอง/);
    expect(stale.moved).toEqual([{ loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 5, now: 4 }]);
    expect(go('a-1', adj, []).error).toBe('ไม่มียอดที่นับ');
    expect(pile(api, 'A-01-01')).toBe(4);

    const r = go('a-2', [Object.assign(adj[0].slice(), { 6: 1 })], [{ ...lines[0], have: 4 }]);
    expect(r).toMatchObject({ doc: 'T2611-0003', rows: 1, qty: 1, book: 1 });
    expect(tx(api).at(-1).slice(5, 19)).toEqual(['A-01-01', '', 1, 'เบิก', 'ปรับยอด หาย', '', '', 'หัวหน้าทดลอง', 'T2611-0003',
      '2026-11-10 10:00:00', 'ปรับยอด', '', 'a-2', 'T2611-0003']);
    expect(pile(api, 'A-01-01')).toBe(3);
  });

  it('โหมดบันทึก: คอลัมน์ N = เลข TRcloud ของแถว (ไม่มีใช้เลขที่ระบบ) คอลัมน์ S = เลขที่ระบบเสมอ ชุดที่บันทึกอ่านแถวกลับได้ครบ', () => {
    const api = setup();
    open(api);
    bookMode(api);
    expect(save(api, 'bk-gr', 'g-1', [GR, Object.assign(GR.slice(0, 10), { 5: 'R01-03-01' })])).toMatchObject({ doc: 'T2611-0002', book: 1, txAt: 5 });
    expect(save(api, 'bk-conv', 'c-1', CONV)).toMatchObject({ doc: 'T2611-0003', qty: 2, book: 1 });
    const t = tx(api);
    expect(t.slice(3).map((x) => [x[0], x[2], x[9], x[13], x[15], x[18]])).toEqual([
      ['AAA001', 'ที่นอนสมมติ 1', 'GR 09-11-26', 'GR6911-0001', 'รับของ', 'T2611-0002'],
      ['AAA001', 'ที่นอนสมมติ 1', 'GR 09-11-26', 'T2611-0002', 'รับของ', 'T2611-0002'],
      ['BBB002', 'ท็อปเปอร์สมมติ 2', 'แปลงสินค้า', 'MR6911-0001', 'แปลง', 'T2611-0003'],
      ['CCC004', 'หมอนสมมติ 4', 'แปลงสินค้า', 'GR6911-0002', 'แปลง', 'T2611-0003'],
    ]);
    expect(bal(api).find((x) => x[0] === 'R01-02-01')).toEqual(['R01-02-01', 'AAA001', 'AAA0000000001', '10', 'P9', 3, '', '2026-11-09', 5]);
    expect(pile(api, 'A-03-01', 'BBB002')).toBe(2);
    expect(pile(api, 'A-03-01', 'CCC004')).toBe(2);
    const docs = recent(api);
    expect(docs.find((d) => d.doc === 'T2611-0002').copy).toEqual([GR, Object.assign(GR.slice(0, 10), { 5: 'R01-03-01' })]);
    expect(docs.find((d) => d.doc === 'T2611-0003').copy).toEqual(CONV);
  });

  it('ยกเลิกชุดในโหมดบันทึก = ลงชุดกลับรายการ: ขายติดลบวันเดิม ย้ายกลับ รับ → เบิก ยอดกลับเท่าเดิม ออเดอร์ตัดใหม่ได้', () => {
    const api = setup();
    open(api);
    bookMode(api);
    sale(api, 'c-1', '1', 'A-01-01', 2);                                                            // T2611-0002
    save(api, 'bk-move', 'm-1', [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 4, 'เบิก', 'โอนย้าย', 'เปิด']]);   // 0003
    save(api, 'bk-gr', 'g-1', [GR]);                                                                // 0004
    expect([pile(api, 'A-01-01'), pile(api, 'R01-01-01')]).toEqual([7, 6]);

    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0002' }).error).toBe('ต้องใส่เหตุผลที่ยกเลิก');
    const v = api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'ลูกค้ายกเลิก' });
    expect(v).toMatchObject({ doc: 'T2611-0002', status: 'ยกเลิก', reversed: 'T2611-0005', rows: 1, lines: 1 });
    expect(tx(api).at(-1)).toEqual(['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', 8, 'P1', 'A-01-01', '', -2, 'ขาย', '2026-11-10', 'เปิด', '',
      'หัวหน้าทดลอง', 'T2611-0005', '2026-11-10 10:00:00', 'กลับรายการ', 'ยกเลิก T2611-0002 · ลูกค้ายกเลิก', 'rev|T2611-0002', 'T2611-0005']);
    expect(pile(api, 'A-01-01')).toBe(9);
    /* บรรทัดออเดอร์ถูกยกเลิก ตัดออเดอร์เดิมใหม่ได้ */
    expect(sale(api, 'c-2', '1', 'A-01-01', 2)).toMatchObject({ doc: 'T2611-0006', rows: 1 });

    const m = api.post({ op: 'bk-void', ...head, doc: 'T2611-0003', why: 'ย้ายผิด' });
    expect(m).toMatchObject({ reversed: 'T2611-0007', rows: 1 });
    expect(tx(api).at(-1).slice(3, 11)).toEqual([8, 'P1', 'A-01-01', 'R01-01-01', 4, 'เบิก', 'ยกเลิก T2611-0003 · โอนย้าย', '']);
    expect([pile(api, 'A-01-01'), pile(api, 'R01-01-01')]).toEqual([3, 10]);

    const g = api.post({ op: 'bk-void', ...head, doc: 'T2611-0004', why: 'รับผิด PO' });
    expect(g).toMatchObject({ reversed: 'T2611-0008' });
    expect(tx(api).at(-1).slice(3, 11)).toEqual([10, 'P9', 'R01-02-01', '', 3, 'เบิก', 'ยกเลิก T2611-0004 · GR 09-11-26', '']);
    expect(bal(api).some((x) => x[0] === 'R01-02-01')).toBe(false);   // กองที่เหลือ 0 ไม่อยู่ในแท็บยอดคงเหลือ

    const docs = recent(api);
    const by = (doc) => docs.find((d) => d.doc === doc);
    expect(by('T2611-0002')).toMatchObject({ status: 'ยกเลิก', why: 'ลูกค้ายกเลิก', link: 'T2611-0005', book: 1 });
    expect(by('T2611-0005')).toMatchObject({ type: 'กลับรายการ', status: '', link: 'T2611-0002', qty: 2, book: 1 });
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0005', why: 'x' }).error).toMatch(/เป็นชุดลงแถวกลับของ T2611-0002 ยกเลิกซ้ำไม่ได้/);
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'x' }).error).toBe('T2611-0002 ถูกยกเลิกไปแล้ว');
  });

  it('ยกเลิกไม่ได้เมื่อของที่ชุดนี้รับเข้าถูกใช้ไปแล้ว (ให้ปรับยอดแทน) · โหมดคัดลอกยกเลิกชุดที่ลงสมุดใหม่แล้วไม่ได้', () => {
    const api = setup();
    open(api);
    bookMode(api);
    save(api, 'bk-gr', 'g-1', [GR]);                                                                // 0002
    save(api, 'bk-move', 'm-1', [['AAA001', 'AAA0000000001', '10', 'P9', 'R01-02-01', 'A-01-01', 2, 'เบิก', 'โอนย้าย', 'เปิด']]);  // 0003
    const before = tx(api).length;
    const r = api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'รับผิด' });
    expect(r.error).toBe('ยกเลิก T2611-0002 ไม่ได้ ของที่ชุดนี้รับหรือย้ายเข้าถูกใช้ไปแล้ว 1 แถว ให้หัวหน้าปรับยอดแทน');
    expect(r.short).toEqual([{ n: 1, loc: 'R01-02-01', sku: 'AAA001', lot: '10', po: 'P9', have: 1, need: 3 }]);
    expect(tx(api)).toHaveLength(before);
    expect(recent(api).find((d) => d.doc === 'T2611-0002').status).toBe('');

    api.post({ op: 'bk-mode', ...head, mode: 'copy', why: 'ทดลองถอย' });
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0003', why: 'x' }).error)
      .toBe('T2611-0003 ลงแท็บ Transaction ของสมุดใหม่แล้ว ยกเลิกได้ตอนอยู่โหมดบันทึกเท่านั้น');
  });

  it('หลังยกเลิก tx-api อ่านแถวกลับได้: ยอดตรงแท็บยอดคงเหลือ ชุดเดิมกับชุดกลับนับว่าอยู่ในสมุดแล้ว FIFO ไม่นับแถวขายที่ยกเลิก', () => {
    const api = setup();
    open(api);
    bookMode(api);
    sale(api, 'c-1', '1', 'A-01-01', 2);
    api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'ลูกค้ายกเลิก' });
    const res = fifoFromBook(api.ss);
    const neg = res.rows.filter((x) => x[6] < 0);
    expect(neg.map((x) => [x[7], x[6], res.days[x[8]], x[9] & 8])).toEqual([[2, -2, '2026-11-10', 8]]);
    const st = B.stock(res);
    expect(B.compareStock(st, api.post({ op: 'bk-stock', ...head }).piles)).toMatchObject({ same: true });
    expect(st.open[0].map((p) => [p.loc, p.qty])).toEqual([['A-01-01', 5]]);
    const docs = recent(api).filter((d) => d.type !== 'ยอดยกมา');
    expect(B.reflect(res, docs).done.map((d) => d.doc).sort()).toEqual(['T2611-0002', 'T2611-0003']);
    expect(F.analyze(res, '2026-11').issues.filter((i) => i.kind === 'sale')).toEqual([]);
  });
});

/* ── รายงานอ่านแถวขายติดลบเป็นการยกเลิก ─────────────────────────────── */

describe('FIFO / LOT 0 / LOT-PO กับแถวขายติดลบ (ยกเลิกในสมุดใหม่)', () => {
  const TYPE = { รับ: 0, เบิก: 1, ขาย: 2 };
  const A = 'AAA0000000001';
  const P1 = '9900000001', P2 = '9900000002';
  const D1 = '2026-11-10';

  /** รูปที่ tx-fifo ส่งมา (แบบเทสต์ lot0) ไม่บอก lot/po = LOT 0 PO 0 */
  function tf(list) {
    const skus = [[ 'AAA001', A, 'ที่นอนสมมติ 1' ]], pos = [], locs = [], days = [];
    const at = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
    const FLAG = { count: 4, return: 32 };
    const rows = list.map((x) => [x.row, 0, x.lot ?? 0, at(pos, String(x.po ?? 0)), x.from ? at(locs, x.from) : -1, x.to ? at(locs, x.to) : -1,
      x.qty, TYPE[x.type || 'รับ'], x.date ? at(days, x.date) : -1, (FLAG[x.src] || 0) + (x.open ? 1 : 0) + (x.type === 'ขาย' ? 8 : 0) + (x.gr ? 2 : 0)]);
    return { app: 'transaction', at: 5, lot0: 1, skus, pos, locs, days, rows };
  }
  /** รูปที่ tx-daily ส่งมา (บรรทัดขายของเดือน) */
  function daily(list) {
    const days = [...new Set(list.map((x) => x.date))].sort();
    return { days, skus: [[A, 'ที่นอนสมมติ 1']], locs: ['G-01-01'], sheet: null,
      lines: list.map((x) => [days.indexOf(x.date), 0, x.row, 0, x.lot, x.po, x.qty, 0]) };
  }
  const sale = (o) => ({ type: 'ขาย', from: 'G-01-01', date: D1, ...o });

  it('LOT 0: ขายจากกอง LOT 0 แล้วยกเลิก ของกลับหัวคิว ค่าประมาณของแถวติดลบ = ของแถวที่ยกเลิกแต่ติดลบ', () => {
    const e = Z.run(tf([
      { row: 10, to: 'G-01-01', qty: 2, src: 'count' },
      sale({ row: 11, qty: 1 }),
      sale({ row: 12, qty: -1 }),
      sale({ row: 13, qty: 2 }),
    ]));
    expect(e.rows[11]).toEqual({ s: A, q: 1, d: D1, p: [['', '', 1, 'count', 10, 0]] });
    expect(e.rows[12]).toEqual({ s: A, q: -1, d: D1, p: [['', '', -1, 'count', 10, 0]] });
    expect(e.rows[13].p).toEqual([['', '', 1, 'count', 10, 0], ['', '', 1, 'count', 10, 0]]);
  });

  it('LOT 0: แถวขายที่ถูกยกเลิกไม่ให้รับคืนย้อนไปหา รับคืนได้ LOT ของแถวขายก่อนหน้านั้น', () => {
    const e = Z.run(tf([
      sale({ row: 11, lot: 7, po: P1, qty: 1 }),
      sale({ row: 12, lot: 8, po: P2, qty: 1 }),
      sale({ row: 13, lot: 8, po: P2, qty: -1 }),
      { row: 14, to: 'G-01-01', qty: 1, src: 'return' },
      sale({ row: 15, qty: 1 }),
    ]));
    expect(e.rows[15].p).toEqual([[7, P1, 1, 'return', 14, 11]]);
  });

  it('LOT-PO: แถวขายกับแถวยกเลิกหักกันเหลือ 0 ไม่ขึ้นบรรทัด และไม่ทำให้วันนั้นนับว่าออกหลาย LOT', () => {
    const led = daily([
      { date: D1, lot: 8, po: P2, qty: 2, row: 20 },
      { date: D1, lot: 8, po: P2, qty: -2, row: 21 },
      { date: D1, lot: 7, po: P1, qty: 1, row: 22 },
    ]);
    const rows = L.build(led);
    expect(rows.map((r) => [r.lot, r.po, r.qty, r.split])).toEqual([['7', P1, 1, 1]]);
    /* ค่าประมาณของแถวติดลบหักกับแถวที่ยกเลิก */
    const e = Z.run(tf([
      { row: 10, to: 'G-01-01', qty: 2, src: 'count' },
      sale({ row: 11, qty: 1 }),
      sale({ row: 12, qty: -1 }),
    ]));
    const led0 = daily([{ date: D1, lot: 0, po: 0, qty: 1, row: 11 }, { date: D1, lot: 0, po: 0, qty: -1, row: 12 }]);
    const est = Z.only(e, led0);
    expect([est.rows[11].q, est.rows[12].q]).toEqual([1, -1]);
    expect(L.build(led0, est)).toEqual([]);
  });

  it('FIFO: แถวขายที่ถูกยกเลิกไม่ขึ้นในรายการตรวจ ยอดสิ้นเดือนกลับเท่าเดิม', () => {
    const base = [
      { row: 2, lot: 7, po: P1, to: 'P1-01', qty: 5, open: 1, gr: 1, type: 'รับ', date: '2026-09-02' },
      { row: 3, lot: 8, po: P2, to: 'P1-02', qty: 5, open: 1, gr: 1, type: 'รับ', date: '2026-09-20' },
      { row: 4, lot: 8, po: P2, from: 'P1-02', qty: 3, type: 'ขาย', date: D1 },
    ];
    const one = F.analyze(tf(base), '2026-11');
    expect(one.issues.map((i) => [i.kind, i.state, i.qty])).toEqual([['sale', 'lot', 3]]);
    const two = F.analyze(tf([...base, { row: 5, lot: 8, po: P2, from: 'P1-02', qty: -3, type: 'ขาย', date: D1 }]), '2026-11');
    expect(two.issues).toEqual([]);
    expect(two.totals.sale).toMatchObject({ judged: 0 });
  });
});
