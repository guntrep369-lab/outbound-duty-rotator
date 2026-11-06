/**
 * สินค้าคงเหลือ ณ วันที่: public/wms-balance.js (ใช้ WmsFifo เดินสมุด)
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FIFO = fs.readFileSync(path.resolve(__dirname, '../../public/wms-fifo.js'), 'utf8');
const LOTPO = fs.readFileSync(path.resolve(__dirname, '../../public/wms-lotpo.js'), 'utf8');
const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-balance.js'), 'utf8');

let B;
beforeAll(() => {
  const win = {};
  new Function('window', FIFO)(win);
  new Function('window', LOTPO)(win);
  new Function('window', JS)(win);
  B = win.WmsBalance;
});

const TYPE = { รับ: 0, เบิก: 1, ขาย: 2 };

/** แถวอ่านง่ายเป็นรูปที่ tx-fifo ส่งมา { sku, lot, po, from, to, qty, type, d, open, gr, count } */
function ledger(list, extra) {
  const skus = [], pos = [], locs = [], days = [];
  const no = (arr, v) => { if (!arr.includes(v)) arr.push(v); return arr.indexOf(v); };
  const rows = list.map((x, i) => {
    const sku = x.sku || 'AAA0000000001';
    if (!skus.some((s) => s[1] === sku)) skus.push([sku.slice(0, 6), sku, `ชื่อ ${sku}`]);
    const t = TYPE[x.type || 'รับ'];
    const flag = (x.open ? 1 : 0) + (x.gr ? 2 : 0) + (x.count ? 4 : 0) + (x.own === false ? 0 : 8);
    return [x.row || 10 + i, skus.findIndex((s) => s[1] === sku), x.lot ?? 8, no(pos, String(x.po ?? '9900000001')),
      t && x.from ? no(locs, x.from) : -1, x.to ? no(locs, x.to) : -1, x.qty ?? 1, t, x.d ? no(days, x.d) : -1, flag];
  });
  return { app: 'transaction', today: '2026-11-06', last: '2026-11-05', skus, pos, locs, days, rows, ...extra };
}

const count = (o) => ({ type: 'รับ', count: true, to: 'R1-01-01', ...o });
const gr = (o) => ({ type: 'รับ', gr: true, to: 'R1-01-01', ...o });
const refill = (o) => ({ type: 'เบิก', from: 'R1-01-01', to: 'P-01-01', open: true, ...o });
const sale = (o) => ({ type: 'ขาย', from: 'P-01-01', open: true, ...o });

describe('asOf — ยอด ณ สิ้นวันที่เลือก', () => {
  const res = ledger([
    count({ qty: 50, lot: 9 }),                               // แถวนับสต๊อก ไม่มีวันที่ นับเสมอ
    gr({ qty: 30, lot: 10, po: '9900000002', d: '2026-10-20' }),
    refill({ qty: 20, lot: 9, d: '2026-10-25' }),
    sale({ qty: 5, lot: 9, d: '2026-10-31' }),
    sale({ qty: 7, lot: 9, d: '2026-11-03' }),
  ]);

  it('นับแถวที่วันที่ไม่เกินวันที่เลือก แถวหลังจากนั้นไม่นับ', () => {
    const a = B.asOf(res, '2026-10-31');
    expect(a.totals.qty).toBe(75);
    expect(a.counted).toBe(4);
    expect(a.later).toBe(1);
    const b = B.asOf(res, '2026-11-06');
    expect(b.totals.qty).toBe(68);
    expect(b.later).toBe(0);
  });

  it('ก่อนวันรับเข้า กองนั้นยังไม่มี เหลือแต่ยอดนับสต๊อก', () => {
    const a = B.asOf(res, '2026-10-19');
    expect(a.lines.map((l) => [l.lot, l.qty])).toEqual([['9', 50]]);
  });

  it('หนึ่งบรรทัดต่อ SKU × LOT × PO ยอดรวมทุก Location บอก Location ที่มีของ เรียงมากไปน้อย', () => {
    const a = B.asOf(res, '2026-10-31');
    const l9 = a.lines.find((l) => l.lot === '9');
    expect(l9.qty).toBe(45);
    expect(l9.locs.map((x) => [x.loc, x.qty, x.open])).toEqual([['R1-01-01', 30, false], ['P-01-01', 15, true]]);
    expect(l9.recv).toBe('0000-00-00');
  });

  it('ส่งแถวที่แปลงแล้วมาใช้ซ้ำได้ ผลเท่ากับให้แปลงเอง', () => {
    const win = {};
    new Function('window', FIFO)(win);
    const rows = win.WmsFifo.parse(res);
    expect(B.asOf(res, '2026-10-31', rows)).toEqual(B.asOf(res, '2026-10-31'));
  });
});

describe('asOf — ยอดสุทธิของกอง', () => {
  it('ย้ายของแล้วลง Location เบิกผิด ที่หนึ่งติดลบ ยอดของกองยังถูก และบอกไว้ในหมายเหตุ', () => {
    const res = ledger([
      gr({ qty: 10, to: 'R1-01-01', d: '2026-10-01' }),
      refill({ qty: 4, from: 'R2-01-01', to: 'P-01-01', d: '2026-10-02' }),
    ]);
    const a = B.asOf(res, '2026-10-31');
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0].qty).toBe(10);
    expect(a.lines[0].bad).toEqual([{ loc: 'R2-01-01', qty: -4, open: false }]);
    expect(B.notes(a.lines[0])).toContain('มี Location ติดลบ R2-01-01 (-4)');
  });

  it('กองที่ออกเกินที่รับแยกไว้ ไม่นับรวมในยอดคงเหลือ', () => {
    const res = ledger([
      gr({ qty: 10, lot: 9, d: '2026-10-01' }),
      gr({ qty: 3, lot: 10, po: '9900000002', d: '2026-10-01' }),
      { type: 'ขาย', from: 'R1-01-01', qty: 5, lot: 10, po: '9900000002', d: '2026-10-02' },
    ]);
    const a = B.asOf(res, '2026-10-31');
    expect(a.totals.qty).toBe(10);
    expect(a.totals.lines).toBe(1);
    expect(a.totals.neg).toEqual({ qty: -2, lines: 1 });
    expect(a.neg[0]).toMatchObject({ lot: '10', qty: -2 });
    expect(B.notes(a.neg[0])).toContain('ยอดติดลบ');
  });

  it('รับเข้าที่ใส่ Location เบิกไว้ไม่หักออก กติกาเดียวกับชีตยอด', () => {
    const res = ledger([{ type: 'รับ', from: 'R9-01-01', to: 'R1-01-01', qty: 6, d: '2026-10-01' }]);
    const a = B.asOf(res, '2026-10-31');
    expect(a.lines.map((l) => [l.qty, l.bad.length])).toEqual([[6, 0]]);
  });

  it('กองที่ยอดเป็นศูนย์ไม่ขึ้น', () => {
    const res = ledger([gr({ qty: 4, d: '2026-10-01' }), sale({ from: 'R1-01-01', qty: 4, d: '2026-10-02' })]);
    expect(B.asOf(res, '2026-10-31').lines).toEqual([]);
  });
});

describe('asOf — PO หลายรอบ ลำดับ และไม่รู้ LOT / PO', () => {
  it('PO ที่ลง -01 -02 รวมเป็นบรรทัดเดียว หมายเหตุบอกรอบรับเข้า', () => {
    const res = ledger([
      gr({ qty: 10, po: '9900000001-05', d: '2026-10-05' }),
      gr({ qty: 6, po: '9900000001-20', d: '2026-10-20' }),
    ]);
    const a = B.asOf(res, '2026-10-31');
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]).toMatchObject({ po: '9900000001', qty: 16, recv: '2026-10-05' });
    expect(B.notes(a.lines[0])).toBe('รับเข้า 2 รอบ: 5/10/2026, 20/10/2026');
  });

  it('เรียง SKU แล้วกองเก่าไปใหม่ 0.11 เก่ากว่า 9 LOT ที่ไม่รู้อยู่ท้าย', () => {
    const res = ledger([
      gr({ sku: 'BBB0000000002', qty: 1, lot: 9, d: '2026-10-01' }),
      gr({ qty: 2, lot: 0, po: '0', d: '2026-10-01' }),
      gr({ qty: 3, lot: 9, d: '2026-10-01' }),
      gr({ qty: 4, lot: 0.11, po: '9900000003', d: '2026-10-01' }),
    ]);
    const a = B.asOf(res, '2026-10-31');
    expect(a.lines.map((l) => [l.code, l.lot])).toEqual([
      ['AAA0000000001', '0.11'], ['AAA0000000001', '9'], ['AAA0000000001', '0'], ['BBB0000000002', '9'],
    ]);
    expect(a.lines[0].lm).toMatchObject({ y: 2025, m: 11 });
    expect(a.lines[0].age).toBe(11);
    expect(a.totals).toMatchObject({ qty: 10, skus: 2, lines: 4, unknown: { qty: 2, lines: 1 } });
  });

  it('LOT 0 หรือว่าง กับ PO 0 หรือว่าง นับเป็นไม่รู้ นิยามเดียวกับรายงาน LOT / PO', () => {
    expect(['', '0', 0, '0.0'].map(B.noLot)).toEqual([true, true, true, true]);
    expect(['9', '0.11'].map(B.noLot)).toEqual([false, false]);
    expect(['', '0', '000'].map(B.noPo)).toEqual([true, true, true]);
    expect(B.noPo('9900000001')).toBe(false);
  });
});

describe('filter — ค้นหาและตัวกรอง', () => {
  const res = ledger([
    gr({ qty: 5, lot: 9, to: 'G-01-01', d: '2026-10-01' }),
    gr({ qty: 2, lot: 0, po: '0', to: 'R1-01-01', d: '2026-10-01' }),
    gr({ sku: 'BBB0000000002', qty: 3, lot: 10, po: '9900000002-07', d: '2026-10-07' }),
    { type: 'ขาย', sku: 'BBB0000000002', from: 'R1-01-01', qty: 9, lot: 8, po: '9900000009', d: '2026-10-08' },
  ]);
  let a;
  beforeAll(() => { a = B.asOf(res, '2026-10-31'); });

  it('ไม่รู้ LOT/PO กับยอดติดลบ', () => {
    expect(B.filter(a, { only: 'unknown' }).map((l) => l.lot)).toEqual(['0']);
    expect(B.filter(a, { only: 'neg' }).map((l) => [l.code, l.qty])).toEqual([['BBB0000000002', -9]]);
  });

  it('ค้นด้วย SKU ชื่อ Location และ PO ที่มีรอบต่อท้าย', () => {
    expect(B.filter(a, { q: 'bbb' }).map((l) => l.lot)).toEqual(['10']);
    expect(B.filter(a, { q: 'g-01' }).map((l) => l.lot)).toEqual(['9']);
    expect(B.filter(a, { q: '9900000002-07' }).map((l) => l.po)).toEqual(['9900000002']);
    expect(B.filter(a, { q: '10' }).map((l) => l.lot)).toContain('10');
  });
});

describe('span และ lastMonthEnd — วันที่เลือกได้', () => {
  it('ตั้งแต่วันแรกที่มีวันที่ในสมุดถึงวันนี้ วันที่เกินวันนี้ (พิมพ์ผิด) ไม่นับเป็นวันแรก', () => {
    const res = ledger([
      count({ qty: 1 }),
      gr({ qty: 1, d: '2026-09-15' }),
      gr({ qty: 1, d: '2027-01-01' }),
      gr({ qty: 1, d: '2026-08-02' }),
    ]);
    expect(B.span(res)).toEqual({ min: '2026-08-02', max: '2026-11-06', last: '2026-11-05' });
  });

  it('สิ้นเดือนก่อนหน้า ข้ามปีได้', () => {
    expect(B.lastMonthEnd('2026-11-06')).toBe('2026-10-31');
    expect(B.lastMonthEnd('2026-03-01')).toBe('2026-02-28');
    expect(B.lastMonthEnd('2027-01-15')).toBe('2026-12-31');
  });
});

describe('table / tsv — ไฟล์ Report', () => {
  it('หัวตารางกับบรรทัดครบทุกคอลัมน์', () => {
    const res = ledger([
      gr({ qty: 5, lot: 9, to: 'G-01-01', d: '2026-10-01' }),
      gr({ qty: 2, lot: 9, to: 'P-01-01', open: true, d: '2026-10-01' }),
    ]);
    const t = B.table(B.asOf(res, '2026-10-31').lines);
    expect(t[0]).toEqual(['SKU', 'ชื่อสินค้า', 'SKU ที่แปลงมารวม', 'LOT', 'เดือนของ LOT', 'PO', 'รับเข้า', 'คงเหลือ', 'Location', 'หมายเหตุ']);
    expect(t[1]).toEqual(['AAA0000000001', 'ชื่อ AAA0000000001', '', '9', 'ก.ย. 69', '9900000001', '2026-10-01', 7, 'G-01-01 (5), P-01-01 (2)', '']);
  });

  it('วางใน Excel: เลขยาวเกิน 15 หลักไม่ถูกปัด ข้อความขึ้นต้นด้วย = ไม่กลายเป็นสูตร', () => {
    const out = B.tsv([['990000000000000001', '=X', 'a\tb', 7]]);
    expect(out).toBe('="990000000000000001"\t\'=X\ta b\t7');
  });
});

describe('SKU ที่แปลง — รวมยอดคืนเข้า SKU ตอนซื้อตามแท็บ MASTER แปลงสินค้า', () => {
  const A = 'AAA0000000001', S = 'AAA0000000001-S';
  /* แปลงสินค้า: เบิก SKU ตอนซื้อออกจากแร็ค แล้วรับเข้าเป็น SKU ใหม่ LOT PO เดิม แล้วขาย SKU ใหม่ */
  const rows = [
    gr({ sku: A, qty: 10, lot: 9, d: '2026-10-01' }),
    { type: 'เบิก', sku: A, from: 'R1-01-01', qty: 4, lot: 9, d: '2026-10-02' },
    { type: 'รับ', sku: S, to: 'P-01-01', open: true, qty: 4, lot: 9, d: '2026-10-02' },
    sale({ sku: S, qty: 1, lot: 9, d: '2026-10-03' }),
  ];
  const master = (pairs) => ({ tab: 'MASTER แปลงสินค้า', cols: ['SKU ตอนซื้อ', 'SKU หลังแปลง'], pairs, blank: 0 });

  it('ยอดของ SKU ที่แปลงบวกกลับเข้ากองเดียวกันของ SKU ตอนซื้อ ยอดรวมเท่าเดิม', () => {
    const a = B.asOf(ledger(rows, { convert: master([[S, A, 'ชื่อตอนซื้อ']]) }), '2026-10-31');
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]).toMatchObject({ code: A, lot: '9', qty: 9, conv: [{ sku: S, qty: 3 }], many: null });
    expect(a.lines[0].locs.map((x) => [x.loc, x.qty])).toEqual([['R1-01-01', 6], ['P-01-01', 3]]);
    expect(a.totals).toMatchObject({ qty: 9, skus: 1, lines: 1, conv: { qty: 3, lines: 1 } });
    expect(B.table(a.lines)[1].slice(0, 3)).toEqual([A, 'ชื่อ AAA0000000001', 'AAA0000000001-S (3)']);
  });

  it('ไม่มีแท็บ หรือสคริปต์รุ่นที่ยังไม่ส่งแท็บ ไม่แปลง แยกบรรทัดตาม SKU ในสมุด', () => {
    for (const convert of [null, undefined]) {
      const a = B.asOf(ledger(rows, { convert }), '2026-10-31');
      expect(a.lines.map((l) => [l.code, l.qty])).toEqual([[A, 6], [S, 3]]);
      expect(a.totals.qty).toBe(9);
    }
  });

  it('SKU ที่แปลงลง LOT PO คนละชุด เป็นบรรทัดของ SKU ตอนซื้อแยกกอง ชื่อจาก MASTER ถ้าสมุดไม่มี SKU ตอนซื้อ', () => {
    const res = ledger([{ type: 'รับ', sku: S, to: 'P-01-01', qty: 5, lot: 0, po: '0', d: '2026-10-02' }],
      { convert: master([[S, A, 'ชื่อจาก MASTER']]) });
    const a = B.asOf(res, '2026-10-31');
    expect(a.lines.map((l) => [l.code, l.name, l.lot, l.qty, l.conv])).toEqual([[A, 'ชื่อจาก MASTER', '0', 5, [{ sku: S, qty: 5 }]]]);
  });

  it('MASTER ให้ SKU ตอนซื้อไว้หลายตัว ไม่แปลง บอกไว้ในบรรทัด', () => {
    const a = B.asOf(ledger(rows, { convert: master([[S, A, ''], [S, 'BBB0000000002', '']]) }), '2026-10-31');
    const s = a.lines.find((l) => l.code === S);
    expect(s.many).toEqual([A, 'BBB0000000002']);
    expect(B.notes(s)).toContain('ยังไม่แปลงคืน');
    expect(a.totals.many).toEqual({ qty: 3, lines: 1 });
  });

  it('ค้นด้วย SKU ที่แปลงเจอบรรทัดที่รวมไว้ ตัวกรองรวม SKU ที่แปลง', () => {
    const res = ledger(rows.concat([gr({ sku: 'BBB0000000002', qty: 2, d: '2026-10-01' })]), { convert: master([[S, A, '']]) });
    const a = B.asOf(res, '2026-10-31');
    expect(B.filter(a, { q: '-s' }).map((l) => l.code)).toEqual([A]);
    expect(B.filter(a, { only: 'conv' }).map((l) => l.code)).toEqual([A]);
  });
});
