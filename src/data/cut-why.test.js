/**
 * ปุ่มดูที่มา ชีตทีมตัดน้อยกว่าสองระบบ ทำไมถึงไม่ได้ตัด: public/wms-why.js
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-why.js'), 'utf8');

let W;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  W = win.WmsWhy;
});

const A = 'AAA0000000001', GA = 'FRE0000000001';
const B = 'BBB0000000002', GB = 'FRE0000000002';
const C = 'CCC0000000003', GC = 'FRE0000000003';
const D = 'DDD0000000004';
const OPEN = 1, COUNT = 4, OWN = 8, CONV = 16;

/* แถวแบบที่ tx-fifo ส่งมา [เลขแถว, SKU, LOT, PO, Location เบิก, Location รับ, จำนวน, ประเภท, วันที่, ธง] */
const FIFO = {
  app: 'transaction', at: 1, conv: 1, sheet: { url: 'https://docs.example/d/1/edit', gid: 7 },
  skus: [
    ['AAA001', A, 'ผ้ารองกันเปื้อน 6FT สมมติ'],
    ['FRE001', GA, 'แถม - ผ้ารองกันเปื้อน 6FT สมมติ'],
    ['BBB002', B, 'หมอนสมมติ'],
    ['DDD004', D, 'สินค้าดีสมมติ'],
    ['CCC003', C, 'เก้าอี้สมมติ'],
  ],
  pos: ['9900000001', '9900000002'],
  locs: ['R1-01-01', 'P-01-01', 'G-01-01', 'P-02-01', 'QA'],
  days: ['2026-03-01', '2026-03-05', '2026-03-10', '2026-03-12'],
  rows: [
    [2, 0, 7, 0, -1, 0, 100, 0, -1, COUNT],          // นับสต๊อก A 100 บนชั้น
    [3, 0, 7, 0, 0, 1, 50, 1, 0, OPEN],              // โอน A 50 ลงจุดหยิบ
    [4, 0, 7, 0, 1, -1, 1, 1, 1, OPEN + CONV],       // แปลง: เบิก A 1
    [5, 2, 3, 1, -1, 3, 20, 0, -1, OPEN + COUNT],    // นับสต๊อก B 20
    [6, 1, 7, 0, -1, 2, 1, 0, 1, OPEN + CONV],       // แปลง: รับของแถม A 1
    [7, 1, 7, 0, 2, -1, 1, 2, 1, OPEN + OWN],        // ขายของแถม A 1 วันที่ 5
    [9, 3, 5, 1, -1, 1, 4, 0, -1, OPEN + COUNT],     // นับสต๊อก D 4
    [10, 0, 7, 0, 1, -1, 3, 2, 3, OPEN + OWN],       // ขาย A 3 วันที่ 12
    [11, 0, 8, 1, -1, 4, 9, 0, 2, 0],                // A 9 ชิ้นเข้า QA
    [12, 3, 5, 1, 1, -1, 2, 2, 3, OPEN + OWN],       // ขาย D 2 วันที่ 12
  ],
};

const SALES = { [`2026-03-12|${A}`]: [{ row: 10, loc: 'P-01-01', lot: 7, po: '9900000001', qty: 3, who: 'คนเอ' }] };
const sales = (d, sku) => SALES[`${d}|${sku}`] || [];
const totals = (d, sku) => (sku === A ? { s: 3, x: 3, t: 3 } : { s: 0, x: 0, t: 0 });
const ask = (ix, o) => W.explain(ix, { date: '2026-03-12', need: 1, sales, totals, ...o });

describe('index — จับคู่จากแถวแปลงสินค้า', () => {
  it('เบิก SKU หนึ่งกับรับอีก SKU LOT PO จำนวนเดียวกัน แถวใกล้กัน คือการแปลงครั้งเดียวกัน', () => {
    const ix = W.index(FIFO);
    expect(ix.pairs[GA]).toEqual({ [A]: { n: 1, rows: [[4, 6]] } });
    expect(ix.conv).toBe(true);
    expect(ix.giftLoc).toBe('G-01-01');
  });

  it('จำนวนไม่เท่ากัน หรือห่างกันเกินไป ไม่ใช่คู่กัน', () => {
    const far = { ...FIFO, rows: FIFO.rows.map((r) => (r[0] === 6 ? [90, ...r.slice(1)] : r)) };
    expect(W.index(far).pairs[GA]).toBeUndefined();
    const other = { ...FIFO, rows: FIFO.rows.map((r) => (r[0] === 6 ? [6, 1, 7, 0, -1, 2, 2, 0, 1, OPEN + CONV] : r)) };
    expect(W.index(other).pairs[GA]).toBeUndefined();
  });
});

describe('explain — ชีตไม่มีของพอ ของแถมหยิบจากสินค้าจริง', () => {
  it('ยอดก่อนวันนั้นเป็นศูนย์ บอกสินค้าจริงที่เคยแปลง จุดที่วันนั้นขายสินค้าจริง และสามแถวที่ควรลง', () => {
    const w = ask(W.index(FIFO), { sku: GA });
    expect(w).toMatchObject({ verdict: 'convert', before: 0, now: 0, known: true, missing: 1, home: 'G-01-01', into: 'G-01-01' });
    expect(w.cands.map((c) => [c.sku, c.src])).toEqual([[A, 'conv']]);
    expect(w.real.day).toEqual({ s: 3, x: 3, t: 3 });
    expect(w.real.from).toEqual({ loc: 'P-01-01', lot: 7, po: '9900000001', row: 10 });
    expect(w.lines).toEqual([
      ['AAA001', A, 'ผ้ารองกันเปื้อน 6FT สมมติ', 7, '9900000001', 'P-01-01', '', 1, 'เบิก', 'แปลงสินค้า', 'เปิด', ''],
      ['FRE001', GA, 'แถม - ผ้ารองกันเปื้อน 6FT สมมติ', 7, '9900000001', '', 'G-01-01', 1, 'รับ', 'แปลงสินค้า', 'เปิด', ''],
      ['FRE001', GA, 'แถม - ผ้ารองกันเปื้อน 6FT สมมติ', 7, '9900000001', 'G-01-01', '', 1, 'ขาย', '12/03/2026', 'เปิด', ''],
    ]);
  });

  it('จุดที่มีสินค้าจริง เปิดขายขึ้นก่อน QA ไม่นับเป็นที่หยิบของ', () => {
    const w = ask(W.index(FIFO), { sku: GA });
    expect(w.real.keys.map((k) => [k.loc, k.bal, k.open])).toEqual([['P-01-01', 46, true], ['R1-01-01', 50, false]]);
  });

  it('รหัสที่ไม่เคยมีในสมุด ใช้ชื่อจากไฟล์ตัดสต๊อกหาคู่ รหัสสั้นทำเอง จุดรับใช้จุดที่รับของแถมจากการแปลงบ่อยสุด', () => {
    const w = ask(W.index(FIFO), { sku: GB, name: 'แถม - หมอนสมมติ' });
    expect(w).toMatchObject({ verdict: 'convert', known: false, short: 'FRE002', home: '', into: 'G-01-01' });
    expect(w.cands.map((c) => [c.sku, c.src])).toEqual([[B, 'name']]);
    /* วันนั้นไม่มีแถวขายสินค้าจริง ใช้จุดที่มีของมากสุด */
    expect(w.real.from).toEqual({ loc: 'P-02-01', lot: 3, po: '9900000002', row: 0 });
    expect(w.lines[1].slice(0, 3)).toEqual(['FRE002', GB, 'แถม - หมอนสมมติ']);
  });

  it('แท็บ MASTER แปลงสินค้ามาก่อน คู่จากชื่อเป็นตัวเลือกถัดไป', () => {
    const master = { pairs: [[GB, C, 'เก้าอี้สมมติ']] };
    const w = ask(W.index(FIFO), { sku: GB, name: 'แถม - หมอนสมมติ', master });
    expect(w.cands.map((c) => [c.sku, c.src])).toEqual([[C, 'master'], [B, 'name']]);
    expect(w.lines[0][1]).toBe(C);
  });

  it('สคริปต์รุ่นก่อนไม่มีธงแปลงสินค้า ยังหาคู่จากชื่อได้ และบอกว่ารุ่นเก่า', () => {
    const old = { ...FIFO, conv: undefined, rows: FIFO.rows.map((r) => [...r.slice(0, 9), r[9] & ~CONV]) };
    const w = ask(W.index(old), { sku: GA });
    expect(w.conv).toBe(false);
    expect(w.cands.map((c) => [c.sku, c.src])).toEqual([[A, 'name']]);
  });

  it('มีของอยู่บ้างแต่ไม่พอ ขายจากของเดิมก่อน แล้วแปลงเพิ่มเฉพาะส่วนที่ขาด', () => {
    const more = { ...FIFO, rows: [...FIFO.rows, [13, 1, 6, 1, -1, 2, 1, 0, 2, OPEN]] };   // ของแถม A รับเข้าอีก 1 วันที่ 10
    const w = ask(W.index(more), { sku: GA, need: 3 });
    expect(w).toMatchObject({ before: 1, missing: 2 });
    expect(w.lines.map((l) => [l[1], l[3], l[7], l[8]])).toEqual([
      [GA, 6, 1, 'ขาย'], [A, 7, 2, 'เบิก'], [GA, 7, 2, 'รับ'], [GA, 7, 2, 'ขาย'],
    ]);
  });

  it('ยอดติดลบอยู่แล้ว แปลงเท่าที่ต้องตัดวันนี้ ไม่ขายจากของที่ไม่มี', () => {
    const neg = { ...FIFO, rows: [...FIFO.rows, [14, 1, 7, 0, 2, -1, 1, 2, 2, OPEN + OWN]] };   // ขายของแถม A ซ้ำวันที่ 10
    const w = ask(W.index(neg), { sku: GA });
    expect(w).toMatchObject({ before: -1, missing: 1 });
    expect(w.lines.map((l) => l[8])).toEqual(['เบิก', 'รับ', 'ขาย']);
  });
});

describe('explain — กรณีอื่น', () => {
  it('ชีตมีของพอให้ตัดแต่ไม่ได้ลงขาย เสนอแถวขายแถวเดียวจากจุดที่มีของ', () => {
    const w = ask(W.index(FIFO), { sku: D, need: 2 });
    expect(w).toMatchObject({ verdict: 'stock', before: 4, now: 2 });
    expect(w.lines).toEqual([['DDD004', D, 'สินค้าดีสมมติ', 5, '9900000002', 'P-01-01', '', 2, 'ขาย', '12/03/2026', 'เปิด', '']]);
  });

  it('หาคู่ไม่เจอเลย บอกว่าไม่รู้ ไม่เดาแถวให้', () => {
    const w = ask(W.index(FIFO), { sku: GC, name: 'แถม-ของขวัญที่ไม่มีคู่' });
    expect(w).toMatchObject({ verdict: 'unknown', known: false, lines: [] });
  });

  it('ความเคลื่อนไหวล่าสุดขึ้นก่อน มีคงเหลือหลังแต่ละแถว บอกว่าเป็นแถวแปลงสินค้าหรือนับสต๊อก', () => {
    const w = ask(W.index(FIFO), { sku: GA });
    expect(w.hist.map((h) => [h.row, h.what, h.tag, h.change, h.left, h.loc])).toEqual([
      [7, 'ขาย', '', -1, 0, 'G-01-01'],
      [6, 'รับ', 'แปลงสินค้า', 1, 1, 'G-01-01'],
    ]);
  });
});

describe('ตัวช่วย', () => {
  it('รหัสสั้นแบบคอลัมน์ A', () => {
    expect(W.shortOf('FRE0000000220')).toBe('FRE220');
    expect(W.shortOf('FRE0000000042')).toBe('FRE042');
    expect(W.shortOf('XYZ0000001234')).toBe('XYZ1234');
  });

  it('คัดลอกเป็นแถวคั่นด้วย tab วางในชีตแล้วแตกเป็นคอลัมน์ ข้อความที่มี tab ไม่ทำให้คอลัมน์เลื่อน', () => {
    expect(W.tsv([['a', 'b\tc', 1], ['d', '', 2]])).toBe('a\tb c\t1\nd\t\t2');
  });

  it('ยอดรายวันของสามแหล่ง ไม่สนตัวพิมพ์เล็กใหญ่ของ SKU', () => {
    const daily = { days: ['2026-03-12'], skus: [[A, '']], x: [[0, 0, 3]], t: [[0, 0, 2]] };
    const ledger = { days: ['2026-03-12'], skus: [[A, '']], cells: [[0, 0, 3]] };
    const get = W.dayTotals(daily, ledger);
    expect(get('2026-03-12', A.toLowerCase())).toEqual({ s: 3, x: 3, t: 2 });
    expect(get('2026-03-13', A)).toEqual({ s: 0, x: 0, t: 0 });
  });
});
