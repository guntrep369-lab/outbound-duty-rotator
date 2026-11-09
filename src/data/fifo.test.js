/**
 * FIFO สต๊อก: public/wms-fifo.js
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-fifo.js'), 'utf8');

let F;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  F = win.WmsFifo;
});

const TYPE = { รับ: 0, เบิก: 1, ขาย: 2 };

/**
 * แถวอ่านง่ายเป็นรูปที่ tx-fifo ส่งมา
 * { sku, lot, po, from, to, qty, type, d, open, gr, count }
 */
function ledger(list) {
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
  return { app: 'transaction', skus, pos, locs, days, rows };
}

/* ชิ้นส่วนที่ใช้บ่อย: รับเข้าแร็ค เติมเข้าโลขาย ขายจากโลขาย */
const gr = (o) => ({ type: 'รับ', gr: true, to: 'R1-01-01', ...o });
const refill = (o) => ({ type: 'เบิก', from: 'R1-01-01', to: 'P1-01', open: true, ...o });
const sale = (o) => ({ type: 'ขาย', from: 'P1-01', open: true, ...o });

describe('lotMonth — LOT คือเดือนของสินค้า', () => {
  it('LOT เลขเต็มเป็นเดือนของปีนี้ 0.11 / 0.12 เป็นของปีก่อน', () => {
    expect(F.lotMonth(9, '2026-10')).toMatchObject({ y: 2026, m: 9 });
    expect(F.lotMonth('10', '2026-10')).toMatchObject({ y: 2026, m: 10 });
    expect(F.lotMonth(0.11, '2026-10')).toMatchObject({ y: 2025, m: 11 });
    expect(F.lotMonth('0.12', '2026-10')).toMatchObject({ y: 2025, m: 12 });
    expect(F.lotMonth(0.1, '2026-10')).toMatchObject({ y: 2025, m: 10 });
  });

  it('LOT ที่มากกว่าเดือนของรายงาน เป็นของปีก่อน รายงานเดือนมกราเห็น LOT 12 เก่ากว่า LOT 1', () => {
    expect(F.lotMonth(12, '2027-01')).toMatchObject({ y: 2026, m: 12 });
    expect(F.lotMonth(1, '2027-01').key).toBeGreaterThan(F.lotMonth(12, '2027-01').key);
    expect(F.lotMonth(0.11, '2026-10').key).toBeLessThan(F.lotMonth(3, '2026-10').key);
  });

  it('LOT 0 ว่าง หรือเลขที่ไม่ใช่เดือน คือไม่รู้', () => {
    for (const v of [0, '0', '', null, 13, 7.5, 'A', 0.5]) expect(F.lotMonth(v, '2026-10')).toBe(null);
  });

  it('ป้ายเดือนเป็นปี พ.ศ. สองหลัก', () => {
    expect(F.monthText(F.lotMonth(9, '2026-10'))).toBe('ก.ย. 69');
    expect(F.monthText(F.lotMonth(0.12, '2026-10'))).toBe('ธ.ค. 68');
    expect(F.monthText(null)).toBe('ไม่รู้ LOT');
  });
});

describe('analyze — หยิบขาย', () => {
  it('หยิบ LOT เก่าสุดคือตาม FIFO', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'P1-01', open: true, qty: 5, d: '2026-09-02' }),
      gr({ lot: 8, to: 'P1-01', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 7, qty: 2, d: '2026-10-03' }),
    ]), '2026-10');
    expect(an.issues).toHaveLength(1);
    expect(an.issues[0]).toMatchObject({ kind: 'sale', state: 'ok' });
    expect(an.totals.sale).toMatchObject({ judged: 2, ok: 2, skip: 0, pct: 100 });
  });

  it('หยิบ LOT ใหม่ทั้งที่ LOT เก่ายังอยู่ในโลขาย คือข้าม LOT และบอกว่าของเก่าอยู่ที่ไหนกี่ชิ้น', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'P1-01', open: true, qty: 5, d: '2026-09-02' }),
      gr({ lot: 8, to: 'P1-02', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 8, from: 'P1-02', qty: 3, d: '2026-10-03', row: 50 }),
    ]), '2026-10');
    const it0 = an.issues[0];
    expect(it0).toMatchObject({ state: 'lot', row: 50, qty: 3, olderQty: 5 });
    expect(it0.older[0]).toMatchObject({ lot: '7', qty: 5, by: 'lot' });
    expect(an.totals.sale).toMatchObject({ judged: 3, ok: 0, lot: 3, skip: 3, skipRows: 1, pct: 0 });
  });

  it('ของเก่าอยู่แต่บนแร็ค ไม่นับเป็นหยิบข้าม คนหยิบไม่เห็นของเก่า', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, qty: 5, d: '2026-09-02' }),
      gr({ lot: 8, to: 'P1-01', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 8, qty: 1, d: '2026-10-03' }),
    ]), '2026-10');
    expect(an.issues[0].state).toBe('ok');
  });

  it('ของเก่าที่หมดแล้ว หรืออยู่ใน QA / IQA / RIB ไม่ทำให้ข้าม', () => {
    const an = F.analyze(ledger([
      gr({ lot: 6, to: 'P1-01', open: true, qty: 2, d: '2026-09-01' }),
      sale({ lot: 6, qty: 2, d: '2026-09-15' }),
      gr({ lot: 5, to: 'QA', open: true, qty: 9, d: '2026-09-02' }),
      gr({ lot: 4, to: 'RIB', open: true, qty: 9, d: '2026-09-02' }),
      gr({ lot: 8, to: 'P1-01', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 8, qty: 1, d: '2026-10-03' }),
    ]), '2026-10');
    expect(an.issues.map((x) => x.state)).toEqual(['ok']);
  });

  it('ขายจาก QA / IQA / RIB ไม่ตรวจ เพราะไม่ได้เดินตาม FIFO อยู่แล้ว', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'P1-01', open: true, qty: 5, d: '2026-09-02' }),
      gr({ lot: 8, to: 'QA', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 8, from: 'QA', qty: 1, d: '2026-10-03' }),
    ]), '2026-10');
    expect(an.issues).toHaveLength(0);
  });

  it('ขาย LOT ที่ไม่รู้ ตรวจไม่ได้ และของ LOT ไม่รู้ไม่นับเป็นของที่เก่ากว่า', () => {
    const an = F.analyze(ledger([
      gr({ lot: 0, to: 'P1-01', open: true, qty: 5, count: true, gr: false }),
      gr({ lot: 8, to: 'P1-01', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 0, qty: 2, d: '2026-10-03' }),
      sale({ lot: 8, qty: 1, d: '2026-10-03' }),
    ]), '2026-10');
    expect(an.issues.map((x) => x.state)).toEqual(['unknown', 'ok']);
    expect(an.totals.sale).toMatchObject({ qty: 3, judged: 1, unknown: 2, unknownRows: 1 });
  });

  it('LOT 0.11 ของปีก่อนเก่ากว่า LOT 3', () => {
    const an = F.analyze(ledger([
      gr({ lot: 0.11, to: 'P1-01', open: true, qty: 1, d: '2026-09-01' }),
      gr({ lot: 3, to: 'P1-01', open: true, qty: 1, d: '2026-09-01' }),
      sale({ lot: 3, qty: 1, d: '2026-10-01' }),
    ]), '2026-10');
    expect(an.issues[0]).toMatchObject({ state: 'lot' });
    expect(an.issues[0].older[0].lot).toBe('0.11');
  });
});

describe('analyze — PO ใน LOT เดียวกัน เรียงตามวันที่รับเข้า', () => {
  it('PO ที่รับก่อนยังอยู่ในโลขาย หยิบ PO ที่รับทีหลังคือข้าม PO', () => {
    const an = F.analyze(ledger([
      gr({ lot: 9, po: 'PO-A', to: 'P1-01', open: true, qty: 4, d: '2026-09-05' }),
      gr({ lot: 9, po: 'PO-B', to: 'P1-01', open: true, qty: 4, d: '2026-09-25' }),
      sale({ lot: 9, po: 'PO-B', qty: 1, d: '2026-10-02' }),
      sale({ lot: 9, po: 'PO-A', qty: 1, d: '2026-10-02' }),
    ]), '2026-10');
    expect(an.issues.map((x) => x.state)).toEqual(['po', 'ok']);
    expect(an.issues[0].older[0]).toMatchObject({ po: 'PO-A', recv: '2026-09-05', by: 'po' });
    expect(an.totals.sale).toMatchObject({ po: 1, lot: 0, ok: 1 });
  });

  it('วันรับคือ GR แถวแรกของ SKU + LOT + PO นั้น รับเพิ่มทีหลังไม่ทำให้ใหม่ขึ้น', () => {
    const an = F.analyze(ledger([
      gr({ lot: 9, po: 'PO-A', to: 'P1-01', open: true, qty: 4, d: '2026-09-05' }),
      gr({ lot: 9, po: 'PO-B', to: 'P1-01', open: true, qty: 4, d: '2026-09-10' }),
      gr({ lot: 9, po: 'PO-A', to: 'P1-01', open: true, qty: 4, d: '2026-09-28' }),
      sale({ lot: 9, po: 'PO-B', qty: 1, d: '2026-10-02' }),
    ]), '2026-10');
    expect(an.issues[0].state).toBe('po');
  });

  it('PO จากแถวนับสต๊อกรับก่อนทุก GR และ PO ที่รับวันเดียวกันเก่าเท่ากัน', () => {
    const an = F.analyze(ledger([
      { type: 'รับ', lot: 9, po: 'PO-C', to: 'P1-01', open: true, qty: 4, count: true },
      gr({ lot: 9, po: 'PO-D', to: 'P1-01', open: true, qty: 4, d: '2026-09-05' }),
      gr({ lot: 9, po: 'PO-E', to: 'P1-01', open: true, qty: 4, d: '2026-09-05' }),
      sale({ lot: 9, po: 'PO-D', qty: 1, d: '2026-10-02' }),
    ]), '2026-10');
    expect(an.issues[0].state).toBe('po');
    expect(an.issues[0].older.map((o) => o.po)).toEqual(['PO-C']);
    expect(F.recvText(an.issues[0].older[0].recv)).toBe('ก่อนนับสต๊อก');
  });

  it('PO 0 หรือ PO ที่ไม่มีวันรับ เทียบในระดับ PO ไม่ได้', () => {
    const an = F.analyze(ledger([
      gr({ lot: 9, po: '0', to: 'P1-01', open: true, qty: 4, d: '2026-09-01' }),
      { type: 'รับ', lot: 9, po: 'PO-R', to: 'P1-01', open: true, qty: 4, d: '2026-09-02' },   // RETURN ไม่มี GR
      gr({ lot: 9, po: 'PO-F', to: 'P1-01', open: true, qty: 4, d: '2026-09-20' }),
      sale({ lot: 9, po: 'PO-F', qty: 1, d: '2026-10-02' }),
    ]), '2026-10');
    expect(an.issues[0].state).toBe('ok');
  });
});

describe('analyze — PO ที่ลง -01 -02 ต่อท้ายคือ PO เดียวกันที่รับคนละวัน', () => {
  it('ส่วนท้ายสองหลักคือวันที่รับเข้า ตัดออกเหลือเลข PO เลขแบบอื่นไม่ตัด', () => {
    expect(F.basePo('9900000001-01')).toBe('9900000001');
    expect(F.basePo(' 9900000001-2 ')).toBe('9900000001');
    expect(F.basePo('99000001-15')).toBe('99000001');
    for (const v of ['9900000001', 'PO-A', 'PO-A-01', '12-03', '9900000001-123', '0']) expect(F.basePo(v)).toBe(v);
  });

  it('หยิบรอบ -02 ทั้งที่รอบ -01 ยังอยู่ในโลขาย ไม่นับเป็นข้าม PO แต่ PO อื่นที่รับก่อนยังนับ', () => {
    const an = F.analyze(ledger([
      gr({ lot: 9, po: '9900000002', to: 'P1-01', open: true, qty: 4, d: '2026-09-03' }),
      gr({ lot: 9, po: '9900000001-05', to: 'P1-01', open: true, qty: 4, d: '2026-09-05' }),
      gr({ lot: 9, po: '9900000001-20', to: 'P1-02', open: true, qty: 4, d: '2026-09-20' }),
      sale({ lot: 9, po: '9900000001-20', from: 'P1-02', qty: 1, d: '2026-10-02' }),
      sale({ lot: 9, po: '9900000002', qty: 4, d: '2026-10-03' }),
      sale({ lot: 9, po: '9900000001-20', from: 'P1-02', qty: 1, d: '2026-10-04' }),
    ]), '2026-10');
    expect(an.issues.map((x) => [x.po, x.state])).toEqual([['9900000001', 'po'], ['9900000002', 'ok'], ['9900000001', 'ok']]);
    expect(an.issues[0].older.map((o) => o.po)).toEqual(['9900000002']);
  });

  it('คงเหลือรวมเป็นกองเดียว วันรับคือรอบแรก และบอกทุกรอบที่รับเข้า', () => {
    const s = F.analyze(ledger([
      gr({ lot: 9, po: '9900000001-05', to: 'R1-01-01', qty: 6, d: '2026-09-05' }),
      gr({ lot: 9, po: '9900000001-05', to: 'P1-01', open: true, qty: 2, d: '2026-09-05' }),
      gr({ lot: 9, po: '9900000001-20', to: 'R1-01-01', qty: 3, d: '2026-09-20' }),
      gr({ lot: 9, po: '9900000003', to: 'P1-01', open: true, qty: 1, d: '2026-09-10' }),
    ]), '2026-10').stock;
    const bs = s.list[0].batches;
    expect(bs.map((x) => [x.po, x.recv, x.qty])).toEqual([['9900000001', '2026-09-05', 11], ['9900000003', '2026-09-10', 1]]);
    expect(bs[0].rounds).toEqual([{ d: '2026-09-05', qty: 8 }, { d: '2026-09-20', qty: 3 }]);
    expect(F.roundsText(bs[0])).toBe('2 รอบ: 5/9/2026, 20/9/2026');
    expect(F.roundsText(bs[1])).toBe('');
    expect(F.roundsText({ recv: F.COUNT_DAY, rounds: [{ d: '2026-10-03', qty: 6 }] })).toBe('ก่อนนับสต๊อก + 1 รอบ: 3/10/2026');
    expect(bs[0].locs.map((l) => l.qty)).toEqual([9, 2]);
    expect(F.filterStock(s.list, { q: '9900000001-20' })).toHaveLength(1);
  });

  it('ขายลงรอบ -20 จากจุดที่มีแต่รอบ -05 ยอดหักกันได้ ไม่ติดลบ', () => {
    const s = F.analyze(ledger([
      gr({ lot: 9, po: '9900000001-05', to: 'P1-01', open: true, qty: 5, d: '2026-09-05' }),
      gr({ lot: 9, po: '9900000001-20', to: 'R1-01-01', qty: 5, d: '2026-09-20' }),
      sale({ lot: 9, po: '9900000001-20', qty: 2, d: '2026-10-02' }),
    ]), '2026-10').stock;
    expect(s.negative).toEqual({ keys: 0, qty: 0 });
    expect(s.list[0].batches[0]).toMatchObject({ qty: 8, open: 3, rack: 5 });
  });

  it('รอบที่ลง LOT ต่างกันยังเป็นคนละกอง LOT เก่ากว่าต้องออกก่อน', () => {
    const an = F.analyze(ledger([
      gr({ lot: 9, po: '9900000001-28', to: 'P1-01', open: true, qty: 4, d: '2026-09-28' }),
      gr({ lot: 10, po: '9900000001-14', to: 'P1-02', open: true, qty: 4, d: '2026-10-14' }),
      sale({ lot: 10, po: '9900000001-14', from: 'P1-02', qty: 1, d: '2026-10-20' }),
    ]), '2026-10');
    expect(an.issues[0].state).toBe('lot');
    expect(an.stock.list[0].batches.map((x) => [x.lot, x.po])).toEqual([['9', '9900000001'], ['10', '9900000001']]);
  });
});

describe('analyze — เติมของ', () => {
  it('เติม LOT ใหม่เข้าโลขาย ทั้งที่ LOT เก่ายังอยู่บนแร็ค คือเติมข้าม', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'R1-01-01', qty: 10, d: '2026-09-02' }),
      gr({ lot: 8, to: 'R2-01-01', qty: 10, d: '2026-09-20' }),
      refill({ lot: 8, from: 'R2-01-01', qty: 6, d: '2026-10-05' }),
      refill({ lot: 7, from: 'R1-01-01', qty: 6, d: '2026-10-06' }),
    ]), '2026-10');
    expect(an.issues.map((x) => [x.kind, x.state])).toEqual([['refill', 'lot'], ['refill', 'ok']]);
    expect(an.totals.refill).toMatchObject({ judged: 12, ok: 6, lot: 6, pct: 50 });
  });

  it('ของเก่าที่อยู่ในโลขายอยู่แล้ว ไม่ทำให้การเติมผิด และการย้ายเข้าที่ไม่เปิดขายไม่ตรวจ', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'P1-01', open: true, qty: 10, d: '2026-09-02' }),
      gr({ lot: 8, to: 'DOCK', qty: 10, d: '2026-09-20' }),
      { type: 'เบิก', lot: 8, from: 'DOCK', to: 'R2-01-01', qty: 10, d: '2026-10-01' },
      refill({ lot: 8, from: 'R2-01-01', qty: 6, d: '2026-10-05' }),
    ]), '2026-10');
    expect(an.issues.map((x) => [x.kind, x.state])).toEqual([['refill', 'ok']]);
  });

  it('เติมจาก QA / IQA / RIB ไม่ตรวจ', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'R1-01-01', qty: 10, d: '2026-09-02' }),
      gr({ lot: 8, to: 'IQA', qty: 10, d: '2026-09-20' }),
      refill({ lot: 8, from: 'IQA', qty: 6, d: '2026-10-05' }),
    ]), '2026-10');
    expect(an.issues).toHaveLength(0);
  });
});

describe('analyze — เดือนของรายงาน', () => {
  it('ตรวจเฉพาะแถวที่วันที่อยู่ในเดือน และยอดคงเหลือคิดถึงวันสุดท้ายของเดือน', () => {
    const an = F.analyze(ledger([
      gr({ lot: 8, to: 'P1-01', open: true, qty: 10, d: '2026-09-20' }),
      sale({ lot: 8, qty: 1, d: '2026-09-30' }),
      sale({ lot: 8, qty: 2, d: '2026-10-31' }),
      sale({ lot: 8, qty: 4, d: '2026-11-01' }),
    ]), '2026-10');
    expect(an.issues.map((x) => x.qty)).toEqual([2]);
    expect(an.to).toBe('2026-10-31');
    expect(an.stock.total).toBe(7);
  });

  it('แถวที่ไม่มีวันที่ของตัวเองใช้วันที่ของแถวด้านบน (สคริปต์ส่งมาแล้ว) และบอกว่าเป็นวันโดยประมาณ', () => {
    const an = F.analyze(ledger([
      gr({ lot: 7, to: 'R1-01-01', qty: 10, d: '2026-09-02' }),
      gr({ lot: 8, to: 'R2-01-01', qty: 10, d: '2026-09-20' }),
      refill({ lot: 8, from: 'R2-01-01', qty: 6, d: '2026-10-05', own: false }),
    ]), '2026-10');
    expect(an.issues[0]).toMatchObject({ date: '2026-10-05', own: false });
  });
});

describe('analyze — ยอดคงเหลือราย LOT', () => {
  const res = ledger([
    gr({ sku: 'BBB0000000002', lot: 9, po: 'PO-2', to: 'P1-01', open: true, qty: 3, d: '2026-09-25' }),
    gr({ sku: 'BBB0000000002', lot: 9, po: 'PO-1', to: 'R1-01-01', qty: 4, d: '2026-09-05' }),
    gr({ sku: 'BBB0000000002', lot: 0.12, po: 'PO-0', to: 'R1-01-02', qty: 2, d: '2026-09-01' }),
    gr({ sku: 'BBB0000000002', lot: 0, po: '0', to: 'R1-01-03', qty: 5, count: true, gr: false }),
    gr({ sku: 'BBB0000000002', lot: 8, po: 'PO-3', to: 'QA', qty: 1, d: '2026-09-01' }),
    gr({ sku: 'AAA0000000001', lot: 9, to: 'P1-02', open: true, qty: 2, d: '2026-09-01' }),
    gr({ sku: 'AAA0000000001', lot: 10, to: 'P1-03', open: true, qty: 2, d: '2026-10-02' }),
    sale({ sku: 'AAA0000000001', lot: 7, from: 'P1-09', qty: 1, d: '2026-10-03' }),
  ]);

  it('เรียงกองเก่าไปใหม่ เดือนของ LOT แล้ววันรับของ PO LOT ที่ไม่รู้อยู่ท้าย พร้อมลำดับ FIFO และอายุ', () => {
    const s = F.analyze(res, '2026-10').stock;
    const b = s.list.find((e) => e.code === 'BBB0000000002');
    expect(b.batches.map((x) => `${x.lot}/${x.po}`)).toEqual(['0.12/PO-0', '8/PO-3', '9/PO-1', '9/PO-2', '0/0']);
    expect(b.batches.map((x) => x.rank)).toEqual([1, 2, 3, 4, 0]);
    expect(b.batches.map((x) => x.age)).toEqual([10, 2, 1, 1, null]);
    expect(b).toMatchObject({ total: 15, unknown: 5, lots: 3, oldest: 10 });
    expect(b.batches[1]).toMatchObject({ special: 1, open: 0, rack: 0 });
  });

  it('กองเก่าอยู่แต่บนแร็คขณะที่กองใหม่กว่าอยู่ในโลขายแล้ว ขึ้นว่าควรเติมกองเก่าก่อน', () => {
    const s = F.analyze(res, '2026-10').stock;
    const b = s.list.find((e) => e.code === 'BBB0000000002');
    expect(b.refill.map((f) => `${f.batch.lot}/${f.batch.po}`)).toEqual(['0.12/PO-0', '9/PO-1']);
    expect(b.mixed).toBe(false);
    const a = s.list.find((e) => e.code === 'AAA0000000001');
    expect(a.refill).toHaveLength(0);
    expect(a.mixed).toBe(true);
    expect(a.pick.lot).toBe('9');
  });

  it('ในโลขายมีกองที่เก่าเท่ากันอยู่แล้ว กองบนแร็คไม่ต้องขึ้นว่าควรเติม', () => {
    const s = F.analyze(ledger([
      { type: 'รับ', lot: 7, po: 'PO-A', to: 'P1-01', open: true, qty: 3, count: true },
      { type: 'รับ', lot: 7, po: 'PO-B', to: 'R1-01-01', qty: 9, count: true },
      gr({ lot: 9, po: 'PO-C', to: 'P1-02', open: true, qty: 5, d: '2026-09-20' }),
    ]), '2026-10').stock;
    expect(s.list[0].refill).toHaveLength(0);
    expect(s.list[0].pick.po).toBe('PO-A');
  });

  it('ของที่ยังไม่เปิดขายแยกเป็นบนแร็ค (Location R) กับตั้งพื้น กองตั้งพื้นก็ขึ้นว่าควรเติมได้', () => {
    const s = F.analyze(ledger([
      gr({ lot: 7, po: 'PO-A', to: 'R1-01-01', qty: 4, d: '2026-07-02' }),
      gr({ lot: 7, po: 'PO-B', to: 'D-01-01', qty: 6, d: '2026-07-03' }),
      gr({ lot: 9, po: 'PO-C', to: 'P1-01', open: true, qty: 5, d: '2026-09-20' }),
      gr({ lot: 9, po: 'PO-C', to: 'D-01-02', qty: 2, d: '2026-09-21' }),
    ]), '2026-10').stock;
    const e = s.list[0];
    expect(e.batches.map((x) => [x.po, x.open, x.floor, x.rack, x.store])).toEqual([
      ['PO-A', 0, 0, 4, 4], ['PO-B', 0, 6, 0, 6], ['PO-C', 5, 2, 0, 2],
    ]);
    expect(e.batches[0].locs[0]).toMatchObject({ rack: true, open: false });
    expect(e.batches[1].locs[0]).toMatchObject({ rack: false, open: false });
    expect(e.refill.map((f) => f.batch.po)).toEqual(['PO-A', 'PO-B']);
  });

  it('ยอดติดลบไม่นับเป็นของ แต่นับจุดไว้ อายุสต๊อกรวมตามเดือน', () => {
    const s = F.analyze(res, '2026-10').stock;
    expect(s.negative).toEqual({ keys: 1, qty: -1 });
    expect(s.total).toBe(19);
    expect(s.unknown).toBe(5);
    expect(s.special).toBe(1);
    expect(s.aging.map((a) => [F.monthText(a.lm), a.qty, a.skus])).toEqual([
      ['ธ.ค. 68', 2, 1], ['ส.ค. 69', 1, 1], ['ก.ย. 69', 9, 2], ['ต.ค. 69', 2, 1],
    ]);
  });

  it('ตัวกรอง ควรเติม หลาย LOT ไม่รู้ LOT หลายกองในโลขาย และค้นหา PO', () => {
    const list = F.analyze(res, '2026-10').stock.list;
    const codes = (o) => F.filterStock(list, o).map((e) => e.code);
    expect(codes({ only: 'refill' })).toEqual(['BBB0000000002']);
    expect(codes({ only: 'multi' })).toEqual(['AAA0000000001', 'BBB0000000002']);
    expect(codes({ only: 'unknown' })).toEqual(['BBB0000000002']);
    expect(codes({ only: 'mixed' })).toEqual(['AAA0000000001']);
    expect(codes({ q: 'po-3' })).toEqual(['BBB0000000002']);
  });

  it('คิวงาน: เปิดหน้ามาอยู่คิวแรกที่มีงาน ไม่มีงานเลยไปดูทั้งหมด สถานะเลือกงานที่ด่วนที่สุด', () => {
    const list = F.analyze(res, '2026-10').stock.list;
    const a = list.find((e) => e.code === 'AAA0000000001');
    const b = list.find((e) => e.code === 'BBB0000000002');
    expect(F.QUEUES.map((q) => q.id)).toEqual(['refill', 'mixed', 'unknown', '']);
    expect(F.firstQueue(list)).toBe('refill');
    expect(F.firstQueue([a])).toBe('mixed');
    expect(F.stockState(b)).toBe('refill');
    expect(F.stockState(a)).toBe('mixed');
    const calm = F.analyze(ledger([gr({ lot: 9, to: 'P1-01', open: true, qty: 3, d: '2026-09-25' })]), '2026-10').stock.list;
    expect(F.firstQueue(calm)).toBe('');
    expect(F.stockState(calm[0])).toBe('ok');
  });

  it('งานเติมของเก่า: เอากองไหน จาก Location ไหน มากไปน้อย เข้าโลขายไหน ที่ตอนนี้มี LOT อะไร', () => {
    const b = F.analyze(res, '2026-10').stock.list.find((e) => e.code === 'BBB0000000002');
    const t = F.refillTask(res, b);
    expect(t.what).toBe('LOT 0.12, LOT 9 PO PO-1');
    expect(t.from).toEqual([{ loc: 'R1-01-01', qty: 4, rack: true }, { loc: 'R1-01-02', qty: 2, rack: true }]);
    expect(t.to).toEqual(['P1-01']);
    expect(t.now).toBe('LOT 9');
    expect(t.qty).toBe(6);
    expect(t.batches.map((x) => x.po)).toEqual(['PO-0', 'PO-1']);
    expect(F.refillTask(res, F.analyze(res, '2026-10').stock.list[0])).toBe(null);
  });

  it('งานบอกคนหยิบ: กองในโลขายเก่าไปใหม่ บอก PO เฉพาะตอน LOT เดียวกันมีหลายกองในโลขาย', () => {
    const a = F.analyze(res, '2026-10').stock.list.find((e) => e.code === 'AAA0000000001');
    expect(F.pickTask(res, a)).toMatchObject({ lot: '9', po: '', qty: 2, at: ['P1-02'] });
    expect(F.pickTask(res, a).batches.map((x) => x.lot)).toEqual(['9', '10']);
    const two = ledger([
      gr({ lot: 8, po: '9900000002', to: 'P1-01', open: true, qty: 4, d: '2026-09-20' }),
      gr({ lot: 8, po: '9900000001', to: 'P1-01', open: true, qty: 3, d: '2026-09-02' }),
    ]);
    const e = F.analyze(two, '2026-10').stock.list[0];
    expect(F.pickTask(two, e)).toMatchObject({ lot: '8', po: '9900000001', qty: 3, at: ['P1-01'] });
  });

  it('งานแก้ LOT: LOT ที่ไม่รู้เดือนกับ Location ที่อยู่ มากไปน้อย', () => {
    const b = F.analyze(res, '2026-10').stock.list.find((e) => e.code === 'BBB0000000002');
    expect(F.unknownTask(res, b)).toEqual({ lots: ['0'], qty: 5, at: [{ loc: 'R1-01-03', qty: 5 }] });
    expect(F.lotName({ lot: '' })).toBe('ว่าง');
    expect(F.lotName({ lot: '0' })).toBe('0');
  });

  it('คำสั้นของกอง: รวม PO ของ LOT เดียวกัน LOT ไม่ซ้ำ กองอยู่ตรงไหนบ้าง', () => {
    expect(F.batchWords([{ lot: '8', po: 'A' }, { lot: '8', po: 'B' }, { lot: '9', po: 'C' }])).toBe('LOT 8 (2 PO), LOT 9');
    expect(F.batchWords([{ lot: '8', po: 'A' }], [{ lot: '8', po: 'B' }])).toBe('LOT 8 PO A');
    expect(F.batchWords([{ lot: '8', po: '0' }], [{ lot: '8', po: 'B' }])).toBe('LOT 8');
    expect(F.lotWords([{ lot: '8' }, { lot: '8' }, { lot: '9' }])).toBe('LOT 8, LOT 9');
    expect(F.placeWords({ open: 5, floor: 2, rack: 0, special: 0 })).toEqual(['โลขาย', 'ตั้งพื้น']);
    expect(F.placeWords({ open: 0, floor: 0, rack: 4, special: 1 })).toEqual(['บนแร็ค', 'QA']);
  });
});

describe('ส่งออก', () => {
  const res = ledger([
    gr({ lot: 7, to: 'P1-01', open: true, qty: 5, d: '2026-09-02' }),
    gr({ lot: 8, to: 'P1-02', open: true, qty: 5, d: '2026-09-20' }),
    sale({ lot: 8, from: 'P1-02', qty: 3, d: '2026-10-03', row: 50 }),
    sale({ lot: 7, from: 'P1-01', qty: 1, d: '2026-10-04', row: 51 }),
  ]);

  it('ข้ามราย SKU บอก % ตาม FIFO ของ SKU นั้น ใหม่สุดขึ้นก่อน', () => {
    const an = F.analyze(res, '2026-10');
    const s = F.skipsBySku(res, an, {});
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ code: 'AAA0000000001', sale: 3, refill: 0, rows: 1, judged: 4, pct: 25 });
    expect(F.skipsBySku(res, an, { kind: 'refill' })).toHaveLength(0);
  });

  it('ตารางคงเหลือ ตารางเบิกข้าม อายุสต๊อก และสรุป มีหัวตารางและแถวครบ', () => {
    const an = F.analyze(res, '2026-10');
    const st = F.stockTable(res, an);
    expect(st[0]).toContain('ลำดับ FIFO');
    expect(st[0].slice(7, 15)).toEqual(['PO', 'Supplier', 'รับเข้า', 'รอบรับเข้า', 'คงเหลือ', 'ในโลขาย', 'ตั้งพื้น (ไม่เปิดขาย)', 'บนแร็ค']);
    expect(st.every((r) => r.length === st[0].length)).toBe(true);
    expect(st).toHaveLength(3);
    const sk = F.skipTable(res, an);
    expect(sk).toHaveLength(2);
    expect(sk[1]).toEqual(expect.arrayContaining(['3/10/2026', 'หยิบขาย', 'ข้าม LOT', 'LOT 7 PO 9900000001 @P1-01 5', 50]));
    expect(F.agingTable(an).map((r) => r[1])).toEqual(['เดือน', 'ก.ค. 69', 'ส.ค. 69']);
    const sum = F.summaryTable(an);
    expect(sum.find((r) => r[0] === 'ตาม FIFO (%)')).toEqual(['ตาม FIFO (%)', 25, '']);
  });

  it('คัดลอกเป็นคอลัมน์ แท็บและขึ้นบรรทัดในข้อความไม่ทำให้คอลัมน์เลื่อน', () => {
    expect(F.tsv([['a\tb', 'c\nd'], [1, null]])).toBe('a b\tc d\n1\t');
  });
});

describe('ส่งออก — ชื่อ Supplier (แท็บ PO. Truck)', () => {
  it('ใส่ Supplier ของแต่ละกองและของที่เก่ากว่า เมื่อโหลด wms-sup.js', () => {
    const win = {};
    new Function('window', fs.readFileSync(path.resolve(__dirname, '../../public/wms-sup.js'), 'utf8'))(win);
    new Function('window', JS)(win);
    const G = win.WmsFifo;
    const res = ledger([
      gr({ lot: 7, po: '9900000001-01', to: 'P1-01', open: true, qty: 5, d: '2026-09-02' }),
      gr({ lot: 8, po: '9900000002-01', to: 'P1-02', open: true, qty: 5, d: '2026-09-20' }),
      sale({ lot: 8, po: '9900000002-01', from: 'P1-02', qty: 3, d: '2026-10-03', row: 50 }),
    ]);
    res.sup = { tab: 'PO. Truck', rows: [['9900000001', 'รถเอ'], ['9900000002', 'รถบี']], dup: [], missing: '' };
    const an = G.analyze(res, '2026-10');
    const st = G.stockTable(res, an);
    const i = st[0].indexOf('Supplier');
    expect(st.slice(1).map((r) => [r[7], r[i]])).toEqual([['9900000001', 'รถเอ'], ['9900000002', 'รถบี']]);
    const sk = G.skipTable(res, an);
    expect(sk[1][sk[0].indexOf('Supplier ที่ออก')]).toBe('รถบี');
    expect(sk[1]).toContain('LOT 7 PO 9900000001 (รถเอ) @P1-01 5');
    expect(G.sup(res, '0')).toBe('');
  });

  it('ไม่ได้โหลด wms-sup.js คอลัมน์ Supplier ว่าง ไม่พัง', () => {
    const res = ledger([gr({ lot: 7, to: 'P1-01', open: true, qty: 5, d: '2026-09-02' })]);
    res.sup = { tab: 'PO. Truck', rows: [['9900000001', 'รถเอ']], dup: [], missing: '' };
    const st = F.stockTable(res, F.analyze(res, '2026-10'));
    expect(st[1][st[0].indexOf('Supplier')]).toBe('');
  });
});
