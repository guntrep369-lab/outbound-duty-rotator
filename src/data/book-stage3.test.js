/**
 * สมุดสต๊อก ขั้น 3: สมุดใหม่ (แท็บ Transaction + ยอดคงเหลือ) ยอดยกมา สลับโหมดคัดลอก → บันทึก ตารางแบบเดิม Backup
 * public/wms-book.js กับ apps-script/book-api.gs และ tx-api.gs ตัวจริงที่อ่านแท็บ Transaction ของสมุดใหม่
 *
 * สิ่งที่ต้องไม่พัง: ยอดยกมาไม่ตรงสมุดเดิม กองติดลบในสมุดใหม่ ชุดที่กองไม่พอถูกลงครึ่งเดียว
 * สลับโหมดตอนยังมีชุดที่อยู่แค่ในชีตเดิม และหน้า FIFO / ปีของ LOT หายหลังตั้งต้นสมุดใหม่
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadBook, fifoFromBook } from '../dev/fake-gas.js';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-book.js'), 'utf8');
const TX = fs.readFileSync(path.resolve(__dirname, '../../apps-script/tx-api.gs'), 'utf8');

let B;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  B = win.WmsBook;
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

/* สมุดเดิมสมมติ: รับ GR → ย้ายไปพื้น · แถวนับ Q3/26 ไม่รู้ LOT/PO · แถวนับที่มีวันรับ (cgr) แล้วขายเกินจนติดลบ */
const OLD = () => fifo([
  { row: 2, s: 0, lot: 8, po: 'P1', to: 'R01-01-01', qty: 10, d: '2026-10-02', flag: 2 + 8 },
  { row: 3, s: 0, lot: 8, po: 'P1', from: 'R01-01-01', to: 'A-01-01', qty: 4, t: 'เบิก', open: 1 },
  { row: 4, s: 1, lot: '', po: '', to: 'QA', qty: 2, flag: 4 },
  { row: 5, s: 1, lot: '0', po: '0', to: 'QA', qty: 1, flag: 4 },
  { row: 6, s: 2, lot: 9, po: 'P2', to: 'B-01-01', qty: 5, flag: 4 },
  { row: 7, s: 2, lot: 9, po: 'P2', from: 'B-01-01', qty: 7, t: 'ขาย', d: '2026-11-01' },
], { cgr: [[6, '2026-08-15']], cq: [['2026-09-01', 4, 4]] });

/* ── wms-book.js ──────────────────────────────────────────────────────── */

describe('ยอดยกมา (หน้าเว็บคิดจากสมุดเดิม)', () => {
  it('กองละแถว LOT/PO ว่างเป็น 0 รวมกับกอง 0 เดิม วันรับจากแถว GR ไม่รู้วันรับใช้ไตรมาสของรอบนับ กองติดลบไม่ลงแต่บอก', () => {
    const res = OLD();
    const o = B.openingRows(res, B.stock(res));
    expect(o.rows).toEqual([
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'A-01-01', 4, 'เปิด', '2026-10-02', ''],
      ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '0', '0', 'QA', 3, '', '', 'Q3/26'],
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'R01-01-01', 6, '', '2026-10-02', ''],
    ]);
    expect(o.neg).toEqual([{ sku: 'FRE003', long: 'FRE0000000003', lot: '9', po: 'P2', loc: 'B-01-01', qty: -2 }]);
    expect(o.asOf).toBe(7);
    expect(o.total).toEqual({ piles: 3, qty: 13, open: 1, noGr: 1, blank: 1, neg: 1, negQty: -2 });
  });

  it('แถวนับ / ยอดยกมาที่มีวันรับ (cgr) ได้วันรับนั้นเป็นวันแรกของกอง FIFO ไม่หาย', () => {
    const res = fifo([
      { row: 2, s: 0, lot: 8, po: 'P1', to: 'R01-01-01', qty: 5, flag: 4 },
      { row: 3, s: 0, lot: 9, po: 'P2', to: 'R01-02-01', qty: 5, d: '2026-10-20', flag: 2 + 8 },
    ], { cgr: [[2, '2026-08-15']] });
    const st = B.stock(res);
    expect(st.all[0].map((p) => [p.loc, p.first])).toEqual([['R01-01-01', '2026-08-15'], ['R01-02-01', '2026-10-20']]);
    expect(B.openingRows(res, st).rows.map((r) => r[8])).toEqual(['2026-08-15', '2026-10-20']);
  });

  it('เทียบยอด: ตรงกันทุกกอง (กองติดลบของสมุดเดิมนับเป็น 0) · ต่างกันบอกกองที่ต่าง', () => {
    const st = B.stock(OLD());
    const piles = [
      ['A-01-01', 'AAA001', 'AAA0000000001', '8', 'P1', 4, 'เปิด'],
      ['QA', 'BBB002', 'BBB0000000002', '0', '0', 3, ''],
      ['R01-01-01', 'AAA001', 'AAA0000000001', '8', 'P1', 6, ''],
    ];
    expect(B.compareStock(st, piles)).toMatchObject({ same: true, diff: [], piles: 3, oldQty: 13, bookQty: 13 });
    piles[2][5] = 5;
    piles.push(['S-01-01', 'CCC004', 'CCC0000000004', '1', 'P3', 2, '']);
    expect(B.compareStock(st, piles).diff).toEqual([
      { loc: 'R01-01-01', sku: 'AAA001', lot: '8', po: 'P1', old: 6, book: 5 },
      { loc: 'S-01-01', sku: 'CCC004', lot: '1', po: 'P3', old: 0, book: 2 },
    ]);
  });

  it('รู้ว่า tx-api อ่านสมุดใหม่แล้วหรือยัง: แถว 2 ตรงกับแถวแรกของ Transaction ในสมุดใหม่', () => {
    const res = OLD();
    const first = { sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: 'P1', to: 'R01-01-01', qty: 10 };
    expect(B.readsBook(res, first)).toBe(true);
    expect(B.readsBook(res, { ...first, qty: 9 })).toBe(false);
    expect(B.readsBook(res, { ...first, to: 'A-01-01' })).toBe(false);
    expect(B.readsBook(res, null)).toBe(false);
  });
});

describe('ตารางแบบสมุดเดิม', () => {
  it('กติกาแถว: เบิก/ขายไม่ใส่ LOT ใช้กองเดียวที่โลนั้น หลายกองต้องใส่ กองไม่พอผิด แถวก่อนหน้าในชุดเปลี่ยนยอดแล้ว แถวขาย Note = วันที่ขาย', () => {
    const st = B.stock(OLD());
    const plan = B.planRows([
      { sku: 'aaa001', from: 'r01-01-01', to: 'a-01-01', qty: 2, type: 'เบิก', note: 'โอนย้าย' },
      { sku: 'AAA001', from: 'R01-01-01', qty: 5, type: 'ขาย', note: '18/11/2026' },
      { sku: 'ZZZ', to: 'A-01-01', qty: 1, type: 'รับ', note: 'x' },
      { sku: 'AAA001', to: 'R01-02-01', qty: 3, type: 'in', note: 'GR 09-11-26', lot: '10', po: 'P9' },
      { sku: 'AAA001', to: 'R01-02-01', qty: 3, type: 'รับ', note: 'x' },
      {},
      { sku: 'AAA001', from: 'A-01-01', qty: 1, type: 'ขาย' },
      { sku: 'AAA001', to: 'A-01-01', lot: '9', po: 'P3', qty: 1, type: 'รับ', note: 'M/E-001' },
      { sku: 'AAA001', from: 'A-01-01', qty: 1, type: 'ขาย', note: '2026-11-18' },
      { sku: 'AAA001', from: 'A-01-01', to: 'A-01-01', lot: '8', po: 'P1', qty: 1, type: 'เบิก', note: 'x' },
      { sku: 'AAA001', to: 'A-01-01', lot: '8', po: 'P1', qty: 1, type: 'รับ' },
      { sku: 'AAA001', from: 'A-01-01', lot: '8', po: 'P1', qty: 1, type: 'ขาย', note: 'ขายหน้าร้าน' },
    ], st, { date: '2026-11-19' });
    const st8 = plan.lines.map((l) => (l.st === 'bad' ? l.why : l.st));
    expect(st8).toEqual([
      'ok',
      'กองไม่พอ: R01-01-01 LOT 8 PO P1 มี 4',
      'ไม่รู้จัก SKU ZZZ ในสมุด',
      'ok',
      'แถวรับต้องใส่ LOT และ PO',
      'blank',
      'ok',
      'ok',
      'โล A-01-01 มี SKU นี้ 2 กอง ต้องใส่ LOT และ PO',
      'โลเบิกกับโลรับเป็นที่เดียวกัน',
      'ใส่ Note ว่าเป็นงานอะไร',
      'แถวขาย Note ต้องเป็นวันที่ขาย เช่น 19/11/2026 (ว่างไว้ = วันที่ของชุด)',
    ]);
    expect(plan.lines[3].warn).toEqual(['โล R01-02-01 ไม่เคยมีในสมุด']);
    expect(plan.total).toEqual({ rows: 4, qty: 7, ok: 4, bad: 7, warn: 1, lines: 11 });
    const copy = B.rowsCopy(plan);
    expect(copy[0]).toEqual(['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 2, 'เบิก', 'โอนย้าย', 'เปิด']);
    expect(copy[1]).toEqual(['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', '']);
    expect(copy[2]).toEqual(['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 1, 'ขาย', '2026-11-19', '']);
    expect(B.namesOf(st, copy)).toEqual({ AAA0000000001: 'ที่นอนสมมติ 1' });
  });
});

/* ── book-api.gs ──────────────────────────────────────────────────────── */

describe('book-api.gs ขั้น 3', () => {
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
    ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '0', '0', 'QA', 3, '', '', 'Q3/26'],
    ['CCC004', 'CCC0000000004', 'หมอนสมมติ 4', '9', '2603000075', 'B-01-01', 4, 'เปิด', '', ''],
  ];
  const open = (api, batch = 'o-1', extra = {}) => api.post({ op: 'bk-open', ...head, batch, asOf: 900, rows: OPEN, ...extra });
  const tx = (api) => api.ss.getSheetByName('Transaction').grid.slice(1).filter((r) => r && r.some((v) => v !== ''));
  const bal = (api) => api.ss.getSheetByName('ยอดคงเหลือ').grid.slice(1).filter((r) => r && r[0]);
  const docRows = (api) => api.ss.getSheetByName('เลขที่เอกสาร').getLastRow() - 1;
  const sale = (order, piles) => ({ sys: 'JST', order, ref: 'ON' + order, track: 'TH' + order, sku: 'AAA0000000001',
    qty: piles.reduce((a, p) => a + p[3], 0), piles });
  function cut(api, batch, lines) {
    const copy = [];
    lines.forEach((l) => l.piles.forEach((p) => copy.push(['AAA001', 'AAA0000000001', p[1], p[2], p[0], '', p[3], 'ขาย', '2026-11-10', 'เปิด'])));
    return api.post({ op: 'bk-cut', ...me, batch, date: '2026-11-10', base: 900, lines, copy, names: { AAA0000000001: 'ที่นอนสมมติ 1' } });
  }
  const bookMode = (api) => api.post({ op: 'bk-mode', ...head, mode: 'book' });

  it('คำสั่งตั้งค่าสมุดใหม่ใช้ได้เฉพาะหัวหน้า คนลงรายการดูสถานะได้', () => {
    const api = setup();
    ['bk-open', 'bk-mode', 'bk-rows', 'bk-rebuild', 'bk-backup'].forEach((op) => {
      expect(api.post({ op, ...me, batch: 'x' }).error).toBe('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
    });
    expect(api.post({ op: 'bk-state', ...me })).toMatchObject({ mode: 'copy', rows: 0, open: null });
    expect(api.post({ op: 'bk-login', ...head })).toMatchObject({ v: 3, mode: 'copy' });
  });

  it('ลงยอดยกมา: กองละแถวรับ Note บอกเลขที่กับวันรับ (ไม่รู้ = ไตรมาส) LOT/PO ตัวเลขเป็นตัวเลข ยอดคงเหลือครบ', () => {
    const api = setup();
    const r = open(api);
    expect(r).toMatchObject({ doc: 'T2611-0001', rows: 4, qty: 22, replaced: [] });
    const t = tx(api);
    expect(t[0]).toEqual(['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', 8, 'P1', '', 'A-01-01', 5, 'รับ', 'ยอดยกมา T2611-0001 · GR 02-10-26', 'เปิด', '',
      'หัวหน้าทดลอง', 'T2611-0001', '2026-11-10 10:00:00', 'ยอดยกมา', 'สมุดเดิมถึงแถว 900', 'o-1']);
    expect(t.map((x) => [x[3], x[4], x[9]])).toEqual([
      [8, 'P1', 'ยอดยกมา T2611-0001 · GR 02-10-26'],
      [8, 'P1', 'ยอดยกมา T2611-0001 · GR 02-10-26'],
      [0, 0, 'ยอดยกมา T2611-0001 · Q3/26'],
      [9, 2603000075, 'ยอดยกมา T2611-0001 · Q4/26'],
    ]);
    expect(bal(api)).toEqual([
      ['A-01-01', 'AAA001', 'AAA0000000001', '8', 'P1', 5, 'เปิด', '2026-10-02', 2],
      ['B-01-01', 'CCC004', 'CCC0000000004', '9', '2603000075', 4, 'เปิด', '', 5],
      ['QA', 'BBB002', 'BBB0000000002', '0', '0', 3, '', '', 4],
      ['R01-01-01', 'AAA001', 'AAA0000000001', '8', 'P1', 10, '', '2026-10-02', 3],
    ]);
    expect(api.post({ op: 'bk-state', ...head })).toMatchObject({
      mode: 'copy', rows: 4, piles: 4, after: 0,
      open: { doc: 'T2611-0001', rows: 4, qty: 22, asOf: 900, who: 'หัวหน้าทดลอง' },
      first: { sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: 'P1', to: 'A-01-01', qty: 5 },
    });
    /* ส่งซ้ำรหัสชุดเดิม = เลขเดิม ไม่ลงซ้ำ */
    expect(open(api)).toMatchObject({ doc: 'T2611-0001', again: true });
    expect(tx(api)).toHaveLength(4);
  });

  it('ยอดยกมาที่แถวไม่ถูกไม่รับทั้งชุด · ลงซ้ำต้องกดลงใหม่ ลงใหม่ล้างของเดิมและยกเลิกเลขที่เดิม · ยอดยกมายกเลิกเองไม่ได้', () => {
    const api = setup();
    const bad = (row) => api.post({ op: 'bk-open', ...head, batch: 'b', rows: [OPEN[0], row] }).bad[0].why;
    expect(bad(['', 'X', '', '1', 'P', 'A-01-01', 1])).toBe('ไม่มี SKU');
    expect(bad(['AAA001', 'AAA0000000001', '', '1', 'P', '', 1])).toBe('ไม่มีโล');
    expect(bad(['AAA001', 'AAA0000000001', '', '1', 'P', 'A-01-02', 0])).toBe('ชิ้นต้องมากกว่า 0');
    expect(bad(['AAA001', 'AAA0000000001', '', '', 'P', 'A-01-02', 1])).toBe('ไม่มี LOT หรือ PO');
    expect(bad(OPEN[0])).toBe('กองซ้ำ');
    expect(api.post({ op: 'bk-open', ...head, batch: 'b', rows: [] }).error).toMatch(/1–40000 กอง/);
    expect(tx(api)).toHaveLength(0);

    open(api);
    expect(open(api, 'o-2').error).toMatch(/มียอดยกมาแล้ว \(T2611-0001\)/);
    const r = open(api, 'o-2', { replace: true, rows: OPEN.slice(0, 2) });
    expect(r).toMatchObject({ doc: 'T2611-0002', rows: 2, qty: 15, replaced: ['T2611-0001'] });
    expect(tx(api).map((x) => x[13])).toEqual(['T2611-0002', 'T2611-0002']);
    expect(bal(api).map((x) => x[0])).toEqual(['A-01-01', 'R01-01-01']);
    const docs = api.post({ op: 'bk-recent', ...head, days: 2 }).docs;
    expect(docs.map((d) => [d.doc, d.status])).toEqual([['T2611-0002', ''], ['T2611-0001', 'ยกเลิก']]);
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'x' }).error).toMatch(/ยอดยกมายกเลิกไม่ได้/);
  });

  it('สลับโหมดบันทึก: ต้องมียอดยกมา ชุดที่บันทึกหลังยอดยกมาต้องลงยอดยกมาใหม่ก่อน ถอยกลับต้องมีเหตุผล', () => {
    const api = setup();
    expect(bookMode(api).error).toBe('ยังไม่ได้ลงยอดยกมา');
    open(api);
    api.tick(60e3);
    cut(api, 'c-1', [sale('1', [['A-01-01', '8', 'P1', 1]])]);
    expect(bookMode(api).error).toMatch(/มี 1 ชุดที่บันทึกหลังลงยอดยกมา \(T2611-0002\)/);
    open(api, 'o-2', { replace: true });
    expect(api.post({ op: 'bk-state', ...head }).after).toBe(0);
    expect(bookMode(api)).toMatchObject({ mode: 'book', at: '2026-11-10 10:01:00' });
    expect(bookMode(api)).toMatchObject({ mode: 'book', same: true });
    expect(open(api, 'o-3', { replace: true }).error).toMatch(/โหมดบันทึกอยู่/);
    expect(api.post({ op: 'bk-login', ...me }).mode).toBe('book');
    expect(api.post({ op: 'bk-mode', ...head, mode: 'copy' }).error).toBe('ถอยกลับโหมดคัดลอกต้องใส่เหตุผล');
    expect(api.post({ op: 'bk-mode', ...head, mode: 'copy', why: 'ทดลองถอย' })).toMatchObject({ mode: 'copy' });
    expect(JSON.parse(api.props.get('modeLog')).map((h) => [h[1], h[2], h[3]])).toEqual([
      ['หัวหน้าทดลอง', 'book', ''], ['หัวหน้าทดลอง', 'copy', 'ทดลองถอย'],
    ]);
  });

  it('โหมดบันทึก: ตัดขายลงแท็บ Transaction กับยอดคงเหลือทันที ไม่มีแถวให้คัดลอก ชุดที่บันทึกอ่านแถวจาก Transaction', () => {
    const api = setup();
    open(api);
    bookMode(api);
    const r = cut(api, 'c-1', [sale('1', [['A-01-01', '8', 'P1', 2]])]);
    expect(r).toMatchObject({ doc: 'T2611-0002', rows: 1, book: 1, txAt: 6 });
    expect(tx(api)[4]).toEqual(['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', 8, 'P1', 'A-01-01', '', 2, 'ขาย', '2026-11-10', 'เปิด', '',
      'ทดลอง', 'T2611-0002', '2026-11-10 10:00:00', 'ตัดขาย', '', 'c-1']);
    expect(bal(api)[0]).toEqual(['A-01-01', 'AAA001', 'AAA0000000001', '8', 'P1', 3, 'เปิด', '2026-10-02', 6]);
    expect(api.ss.getSheetByName('แถวที่คัดลอก').getLastRow()).toBe(1);
    const d = api.post({ op: 'bk-recent', ...me, days: 1 }).docs[0];
    expect(d).toMatchObject({ doc: 'T2611-0002', base: 5, book: 1 });
    expect(d.copy).toEqual([['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'ขาย', '2026-11-10', 'เปิด']]);
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'ผิด' }).error).toMatch(/ลงแท็บ Transaction ไปแล้ว/);
    /* ย้ายกับคืนก็ลงสมุดเหมือนกัน */
    const mv = api.post({ op: 'bk-move', ...me, batch: 'm-1', date: '2026-11-10', base: 900,
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 4, 'เบิก', 'โอนย้าย', 'เปิด']] });
    expect(mv).toMatchObject({ book: 1, txAt: 7 });
    const ret = api.post({ op: 'bk-return', ...me, batch: 'r-1', date: '2026-11-10',
      lines: [{ sys: '', order: '', sku: 'CCC0000000004', qty: 2, piles: [['QA', '0', '0', 2]] }],
      copy: [['CCC004', 'CCC0000000004', '0', '0', '', 'QA', 2, 'รับ', 'M/E-00304', '']] });
    expect(ret).toMatchObject({ book: 1, txAt: 8 });
    expect(bal(api).map((x) => `${x[0]}:${x[1]}:${x[5]}`)).toEqual([
      'A-01-01:AAA001:7', 'B-01-01:CCC004:4', 'QA:BBB002:3', 'QA:CCC004:2', 'R01-01-01:AAA001:6',
    ]);
  });

  it('โหมดบันทึก: กองในสมุดไม่พอ ไม่รับทั้งชุด บอกกองที่ไม่พอ ไม่เขียนอะไรเลย (รวมแถวก่อนหน้าในชุดเดียวกัน)', () => {
    const api = setup();
    open(api);
    bookMode(api);
    const before = [tx(api).length, docRows(api)];
    const r = cut(api, 'c-1', [sale('1', [['A-01-01', '8', 'P1', 3]]), sale('2', [['A-01-01', '8', 'P1', 3]])]);
    expect(r.error).toMatch(/ยอดในสมุดไม่พอ 1 แถว/);
    expect(r.short).toEqual([{ n: 2, loc: 'A-01-01', sku: 'AAA001', lot: '8', po: 'P1', have: 2, need: 3 }]);
    expect([tx(api).length, docRows(api)]).toEqual(before);
    expect(bal(api)[0][5]).toBe(5);
    /* กองที่ไม่มีในสมุดเลย */
    const none = api.post({ op: 'bk-move', ...me, batch: 'm', date: '2026-11-10',
      copy: [['AAA001', 'AAA0000000001', '7', 'P0', 'R01-09-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']] });
    expect(none.short[0]).toMatchObject({ loc: 'R01-09-01', have: 0, need: 1 });
  });

  it('ตารางแบบเดิม: กติกาประเภท · โหมดคัดลอกเก็บแถวไว้คัดลอก · โหมดบันทึกลงสมุดและวันรับ GR เข้ายอดคงเหลือ', () => {
    const api = setup();
    const save = (batch, copy, extra = {}) => api.post({ op: 'bk-rows', ...head, batch, date: '2026-11-10', base: 900, copy, ...extra });
    const gr = ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', ''];
    const why = (row) => save('x', [row]).bad[0].why;
    expect(why({ ...gr, 7: 'ปรับ' })).toBe('ประเภทต้องเป็น รับ เบิก ขาย');
    expect(why(Object.assign(gr.slice(), { 4: 'A-01-01' }))).toBe('แถวรับมีแค่โลรับ');
    expect(why(Object.assign(gr.slice(), { 7: 'เบิก' }))).toBe('แถวเบิกต้องมีโลเบิก');
    expect(why(Object.assign(gr.slice(), { 4: 'A-01-01', 7: 'ขาย' }))).toBe('แถวขายมีแค่โลเบิก');
    expect(why(Object.assign(gr.slice(), { 8: '' }))).toBe('ต้องมี Note บอกว่าเป็นงานอะไร');
    expect(why(Object.assign(gr.slice(), { 4: 'A-01-01', 5: '', 7: 'ขาย', 8: 'ขายหน้าร้าน' }))).toBe('แถวขาย Note ต้องเป็นวันที่ขาย (yyyy-mm-dd)');

    expect(save('g-0', [gr], { ref: 'GR สมมติ' })).toMatchObject({ doc: 'T2611-0001', rows: 1, qty: 3 });
    expect(api.post({ op: 'bk-recent', ...head, days: 1 }).docs[0]).toMatchObject({ type: 'ตารางเดิม', base: 900 });
    expect(api.post({ op: 'bk-recent', ...head, days: 1 }).docs[0].copy).toEqual([gr]);
    expect(tx(api)).toHaveLength(0);

    open(api, 'o-1', { replace: true });
    bookMode(api);
    expect(save('g-1', [gr], { ref: 'GR สมมติ', names: { AAA0000000001: 'ที่นอนสมมติ 1' } })).toMatchObject({ book: 1, txAt: 6 });
    expect(tx(api)[4].slice(0, 11)).toEqual(['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', 10, 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', '']);
    expect(tx(api)[4].slice(15)).toEqual(['ตารางเดิม', 'GR สมมติ', 'g-1']);
    expect(bal(api).find((x) => x[0] === 'R01-02-01')).toEqual(['R01-02-01', 'AAA001', 'AAA0000000001', '10', 'P9', 3, '', '2026-11-09', 6]);
    /* แปลงสินค้า: เบิกออกกองหนึ่ง (ไม่มีโลรับ) */
    expect(save('g-2', [['AAA001', 'AAA0000000001', '10', 'P9', 'R01-02-01', '', 5, 'เบิก', 'แปลง', '']]).short[0]).toMatchObject({ have: 3, need: 5 });
  });

  it('คิดยอดคงเหลือใหม่จาก Transaction ทั้งแท็บ (คนแก้แท็บด้วยมือ) บอกกองติดลบ', () => {
    const api = setup();
    open(api);
    const t = api.ss.getSheetByName('Transaction');
    t.getRange(3, 8, 1, 1).setValues([[7]]);
    t.getRange(6, 1, 1, 11).setValues([['AAA001', 'AAA0000000001', '', 8, 'P1', 'A-01-01', '', 9, 'ขาย', '2026-11-10', 'เปิด']]);
    const r = api.post({ op: 'bk-rebuild', ...head });
    expect(r).toMatchObject({ rows: 5, piles: 4, neg: 1, negList: [['A-01-01', 'AAA001', '8', 'P1', -4]] });
    expect(bal(api).find((x) => x[0] === 'A-01-01')[5]).toBe(-4);
    expect(bal(api).find((x) => x[0] === 'R01-01-01')[5]).toBe(7);
  });

  it('Backup: ต่อท้ายเฉพาะแถวใหม่ลงไฟล์ไตรมาสที่สร้างเอง ลงยอดยกมาใหม่ = เริ่มใหม่ · ตั้งเวลาซ้ำได้ตัวเดียว', () => {
    const api = setup();
    open(api);
    expect(api.ctx.backup()).toMatchObject({ rows: 4, upTo: 5, more: 0 });
    const file = api.files.get(api.props.get('bak|2026Q4'));
    expect(file.title).toBe('WMS สมุดสต๊อก · สำรอง Transaction 2026 Q4');
    const grid = () => file.getSheetByName('2026-11').grid.slice(1).filter((r) => r && r[0]);
    expect(grid().map((r) => [r[0], r[1], r[14]])).toEqual([[2, 'AAA001', 'T2611-0001'], [3, 'AAA001', 'T2611-0001'],
      [4, 'BBB002', 'T2611-0001'], [5, 'CCC004', 'T2611-0001']]);
    expect(api.post({ op: 'bk-backup', ...head })).toMatchObject({ rows: 0, upTo: 5 });
    bookMode(api);
    cut(api, 'c-1', [sale('1', [['A-01-01', '8', 'P1', 1]])]);
    expect(api.post({ op: 'bk-backup', ...head })).toMatchObject({ rows: 1, upTo: 6 });
    expect(grid().map((r) => r[0])).toEqual([2, 3, 4, 5, 6]);
    api.post({ op: 'bk-mode', ...head, mode: 'copy', why: 'ลงยอดยกมาใหม่' });
    open(api, 'o-2', { replace: true, rows: OPEN.slice(0, 1) });
    expect(api.ctx.backup()).toMatchObject({ rows: 1, upTo: 2 });
    expect(api.post({ op: 'bk-state', ...head }).backup).toMatchObject({ row: 2, at: '2026-11-10 10:00:00' });

    api.ctx.installBackup();
    api.ctx.installBackup();
    expect(api.triggers.map((t) => [t.fn, t.every, t.hour])).toEqual([['backup', 1, 1]]);
  });

  it('สคริปต์ยังเปิดไฟล์ได้ที่เดียว (ไฟล์ที่ตัวเองสร้าง) ทั้งไฟล์บันทึกและไฟล์สำรอง', () => {
    const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/book-api.gs'), 'utf8');
    expect(GS.match(/openById\(/g)).toHaveLength(1);
    expect(GS).not.toMatch(/openByUrl|DriveApp|UrlFetchApp|docs\.google\.com/);
  });
});

/* ── tx-api.gs อ่านสมุดใหม่ (ตอนตัดรอบเปลี่ยน IMPORTRANGE) ─────────────── */

describe('tx-api.gs อ่านแท็บ Transaction ของสมุดใหม่', () => {
  const head = { who: 'หัวหน้าทดลอง', pin: '9999' };
  const OPEN = [
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'R01-01-01', 10, '', '2026-10-02', ''],
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'A-01-01', 4, 'เปิด', '2026-10-02', ''],
    ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '0', '0', 'QA', 3, '', '', 'Q3/26'],
  ];

  it('สคริปต์รุ่นนี้บอก ob = 1 และแถวยอดยกมาได้ธง 4 วันรับจาก GR ใน Note (cgr) ไม่รู้วันรับได้ไตรมาส (cq)', () => {
    expect(TX).toMatch(/stock\\s\*count\|ยอดยกมา/);
    const api = loadBook({ now: () => Date.UTC(2026, 10, 10, 3, 0, 0) });
    api.users([['หัวหน้าทดลอง', '9999', 'หัวหน้า']]);
    api.post({ op: 'bk-open', ...head, batch: 'o', asOf: 7, rows: OPEN });
    const res = fifoFromBook(api.ss);
    expect(res.ob).toBe(1);
    expect(res.rows.map((x) => x[9] & 4)).toEqual([4, 4, 4]);
    expect(res.cgr).toEqual([[2, '2026-10-02'], [3, '2026-10-02']]);
    expect(res.cq).toEqual([['2026-09-01', 4, 4]]);
  });

  it('หลังตัดรอบ: หน้าเว็บรู้ว่าอ่านสมุดใหม่แล้ว ยอดตรงกับแท็บยอดคงเหลือ ยอดยกมาคิดซ้ำได้แบบเดิม FIFO ใช้วันรับเดิม', () => {
    const api = loadBook({ now: () => Date.UTC(2026, 10, 10, 3, 0, 0) });
    api.users([['ทดลอง', '1111', 'ลงรายการ'], ['หัวหน้าทดลอง', '9999', 'หัวหน้า']]);
    api.post({ op: 'bk-open', ...head, batch: 'o', asOf: 7, rows: OPEN });
    api.post({ op: 'bk-mode', ...head, mode: 'book' });
    api.post({ op: 'bk-cut', who: 'ทดลอง', pin: '1111', batch: 'c', date: '2026-11-10', base: 0,
      lines: [{ sys: 'JST', order: '9', ref: 'ON9', track: 'TH9', sku: 'AAA0000000001', qty: 1, piles: [['A-01-01', '8', 'P1', 1]] }],
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 1, 'ขาย', '2026-11-10', 'เปิด']] });
    const res = fifoFromBook(api.ss);
    const state = api.post({ op: 'bk-state', ...head });
    expect(B.readsBook(res, state.first)).toBe(true);
    const st = B.stock(res);
    expect(B.compareStock(st, api.post({ op: 'bk-stock', ...head }).piles)).toMatchObject({ same: true, oldQty: 16, bookQty: 16 });
    expect(st.open[0].map((p) => [p.loc, p.qty, p.first])).toEqual([['A-01-01', 3, '2026-10-02']]);
    const again = B.openingRows(res, st).rows;
    expect(again.map((r) => [r[5], r[3], r[4], r[6], r[8], r[9]])).toEqual([
      ['A-01-01', '8', 'P1', 3, '2026-10-02', ''],
      ['QA', '0', '0', 3, '', 'Q3/26'],
      ['R01-01-01', '8', 'P1', 10, '2026-10-02', ''],
    ]);
    /* ชุดที่บันทึกในโหมดบันทึกถูกนับว่าอยู่ในสมุดแล้ว (แถวตรงตำแหน่งที่ลง) */
    const docs = api.post({ op: 'bk-recent', ...head, days: 1 }).docs.filter((d) => d.type !== 'ยอดยกมา');
    expect(B.reflect(res, docs).done.map((d) => d.doc)).toEqual(['T2611-0002']);
  });
});
