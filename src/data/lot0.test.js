/**
 * ประมาณ LOT ให้ของ LOT 0: public/wms-lot0.js และส่วนที่ public/wms-lotpo.js ใช้ค่าประมาณ
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

const A = 'AAA0000000001';
const F = 'FRE0000000001';
const P1 = '9900000001';
const P2 = '9900000002';

let Z, L;
beforeAll(() => {
  const win = {};
  new Function('window', read('wms-lot0.js'))(win);
  new Function('window', read('wms-lotpo.js'))(win);
  Z = win.WmsLot0;
  L = win.WmsLotPo;
});

const TYPE = { รับ: 0, เบิก: 1, ขาย: 2 };
const FLAG = { count: 4, conv: 16, return: 32, me: 64 };

/** แถวอ่านง่ายเป็นรูปที่ tx-fifo ส่งมา ไม่บอก lot/po คือ LOT 0 PO 0 */
function fifo(list, extra = { lot0: 1 }) {
  const skus = [], longs = [], pos = [], locs = [], days = [];
  const at = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const rows = list.map((x) => {
    if (!longs.includes(x.sku || A)) { longs.push(x.sku || A); skus.push([x.short || '', x.sku || A, `ชื่อ ${x.sku || A}`]); }
    return [x.row, longs.indexOf(x.sku || A), x.lot ?? 0, at(pos, String(x.po ?? 0)),
      x.from ? at(locs, x.from) : -1, x.to ? at(locs, x.to) : -1, x.qty, TYPE[x.type || 'รับ'], x.date ? at(days, x.date) : -1, FLAG[x.src] || 0];
  });
  return { app: 'transaction', at: 5, skus, pos, locs, days, rows, ...extra };
}

const sale = (o) => ({ type: 'ขาย', from: 'P-01-01', ...o });
const run = (list, extra) => Z.run(fifo(list, extra));

describe('WmsLot0.run', () => {
  it('รับคืนได้ LOT/PO ของแถวขาย SKU เดียวกันที่อยู่ล่าสุดก่อนหน้า', () => {
    const e = run([
      sale({ row: 11, lot: 7, po: P1, qty: 3 }),
      sale({ row: 12, lot: 8, po: P2, qty: 2 }),
      { row: 13, to: 'G-01-01', qty: 1, src: 'return' },
      sale({ row: 14, from: 'G-01-01', qty: 1 }),
    ]);
    expect(e.ok).toBe(true);
    expect(e.rows[14]).toEqual({ s: A, q: 1, d: '', p: [[8, P2, 1, 'return', 13, 12]] });
    expect(e.rows[11]).toBeUndefined();   // แถวที่รู้ล็อตแล้วไม่ต้องประมาณ
  });

  it('ชิ้นที่ขายไปแล้วยกให้รับคืนได้ครั้งเดียว รับคืนครั้งถัดไปย้อนขึ้นไปอีก', () => {
    const e = run([
      sale({ row: 11, lot: 7, po: P1, qty: 2 }),
      sale({ row: 12, lot: 8, po: P2, qty: 1 }),
      { row: 13, to: 'G-01-01', qty: 2, src: 'return' },
      sale({ row: 14, from: 'G-01-01', qty: 2 }),
      { row: 15, to: 'G-01-01', qty: 1, src: 'return' },
      sale({ row: 16, from: 'G-01-01', qty: 1 }),
    ]);
    expect(e.rows[14].p).toEqual([[8, P2, 1, 'return', 13, 12], [7, P1, 1, 'return', 13, 11]]);
    expect(e.rows[16].p).toEqual([[8, P2, 1, 'return', 15, 14]]);
  });

  it('ของนับสต๊อกยังไม่รู้ล็อต ขายออกจากหัวคิวก่อน ของรับคืนต่อท้าย', () => {
    const e = run([
      { row: 10, to: 'G-01-01', qty: 2, src: 'count' },
      sale({ row: 11, lot: 7, po: P1, qty: 1 }),
      { row: 12, to: 'G-01-01', qty: 1, src: 'return' },
      sale({ row: 13, from: 'G-01-01', qty: 3 }),
    ]);
    expect(e.rows[13].p).toEqual([['', '', 2, 'count', 10, 0], [7, P1, 1, 'return', 12, 11]]);
  });

  it('โอนย้ายพาของในคิวไปกองปลายทาง ขายเกินที่มีในกองส่วนที่ขาดเป็น none', () => {
    const e = run([
      { row: 10, to: 'P-01-01', qty: 2, src: 'count' },
      { row: 11, type: 'เบิก', from: 'P-01-01', to: 'G-01-01', qty: 2 },
      sale({ row: 12, from: 'G-01-01', qty: 3 }),
      sale({ row: 13, from: 'P-01-01', qty: 1 }),
    ]);
    expect(e.rows[12].p).toEqual([['', '', 2, 'count', 10, 0], ['', '', 1, 'none', 12, 0]]);
    expect(e.rows[13].p).toEqual([['', '', 1, 'none', 13, 0]]);
  });

  it('รับคืนของที่ขายจากกองนับสต๊อก ยังไม่รู้และบอกว่ามาจากนับ รับคืนที่ไม่มีแถวขายก่อนหน้าบอกไว้ต่างหาก', () => {
    const e = run([
      { row: 10, to: 'G-01-01', qty: 1, src: 'return' },
      { row: 11, to: 'P-01-01', qty: 1, src: 'count' },
      sale({ row: 12, from: 'P-01-01', qty: 1 }),
      { row: 13, to: 'G-01-01', qty: 1, src: 'return' },
      sale({ row: 14, from: 'G-01-01', qty: 2 }),
    ]);
    expect(e.rows[14].p).toEqual([['', '', 1, 'return', 10, 0], ['', '', 1, 'count', 11, 12]]);
  });

  it('M/E ใช้กติกาเดียวกับรับคืน', () => {
    const e = run([
      sale({ row: 11, lot: 7, po: P1, qty: 2 }),
      { row: 12, to: 'G-01-01', qty: 2, src: 'me' },
      sale({ row: 13, from: 'G-01-01', qty: 2 }),
    ]);
    expect(e.rows[13].p).toEqual([[7, P1, 2, 'me', 12, 11]]);
  });

  it('แปลงสินค้าจาก SKU ที่รู้ล็อต ได้ล็อตของ SKU ต้นทาง', () => {
    const e = run([
      { row: 10, sku: A, type: 'เบิก', from: 'P-01-01', lot: 7, po: P1, qty: 1, src: 'conv' },
      { row: 11, sku: F, to: 'G-01-01', qty: 1, src: 'conv' },
      sale({ row: 12, sku: F, from: 'G-01-01', qty: 1 }),
    ]);
    expect(e.rows[12]).toEqual({ s: F, q: 1, d: '', p: [[7, P1, 1, 'conv', 11, 10]] });
  });

  it('แปลงสินค้าจากกอง LOT 0 ส่งที่มาเดิมต่อ แม้แถวรับมาก่อนแถวเบิก และไม่หยิบซ้ำ', () => {
    const e = run([
      sale({ row: 10, lot: 8, po: P2, qty: 1 }),
      { row: 11, to: 'P-01-01', qty: 1, src: 'return' },
      { row: 12, sku: F, to: 'G-01-01', qty: 1, src: 'conv' },
      { row: 13, sku: A, type: 'เบิก', from: 'P-01-01', qty: 1, src: 'conv' },
      sale({ row: 14, sku: F, from: 'G-01-01', qty: 1 }),
      sale({ row: 15, from: 'P-01-01', qty: 1 }),
    ]);
    expect(e.rows[14].p).toEqual([[8, P2, 1, 'return', 11, 10]]);
    expect(e.rows[15].p).toEqual([['', '', 1, 'none', 15, 0]]);
  });

  it('แถวรับที่ไม่บอกที่มาเป็น other สคริปต์รุ่นที่ไม่ส่งธงรับคืนได้ ok = false', () => {
    const list = [{ row: 10, to: 'G-01-01', qty: 1 }, sale({ row: 11, from: 'G-01-01', qty: 1 })];
    expect(run(list).rows[11].p).toEqual([['', '', 1, 'other', 10, 0]]);
    expect(run(list, {}).ok).toBe(false);
  });

  const tab = (layers) => ({ tab: 'ยอดก่อนนับ', mode: 'table', rows: layers.length, skip: 0, missing: [], cols: [], layers });

  it('ของนับที่ไม่รู้ LOT แบ่งตามยอดก่อนนับ ล็อตที่เข้าหลังสุดก่อน ส่วนที่นับแล้วรู้ล็อตหักออกก่อน', () => {
    const e = run([
      { row: 10, to: 'P-01-01', lot: 8, po: P2, qty: 1, src: 'count' },
      { row: 11, to: 'G-01-01', qty: 6, src: 'count' },
      sale({ row: 12, from: 'G-01-01', qty: 6 }),
    ], { lot0: 1, before: tab([[A, 7, P1, 5, ''], [A, 8, P2, 4, '']]) });
    expect(e.rows[12].p).toEqual([[8, P2, 3, 'before', 11, 0], [7, P1, 3, 'before', 11, 0]]);
    expect(e.before).toMatchObject({ tab: 'ยอดก่อนนับ', skus: 1, layers: 2, used: 6, short: 0, missN: 0 });
  });

  it('LOT เป็นเดือน: เลขที่มากกว่าเดือนที่นับเป็นปีก่อน 0.12 คือ ธ.ค. ปีก่อน วันที่รับมีก็ใช้วันที่ก่อน', () => {
    const list = [{ row: 10, to: 'G-01-01', qty: 5, src: 'count' }, sale({ row: 11, from: 'G-01-01', qty: 5 })];
    const p = fifo(list, { lot0: 1, before: tab([[A, 11, P1, 2, ''], [A, 9, P2, 2, ''], [A, 0.12, '9900000003', 2, '']]) });
    p.days = ['2026-10-02', '2026-09-28'];
    expect(Z.run(p).rows[11].p.map((x) => [x[0], x[2]])).toEqual([[9, 2], [0.12, 2], [11, 1]]);
    const q = fifo(list, { lot0: 1, before: tab([[A, 9, P2, 2, '2026-08-01'], [A, 8, P1, 4, '2026-08-20']]) });
    expect(Z.run(q).rows[11].p.map((x) => [x[0], x[2]])).toEqual([[8, 4], [9, 1]]);
  });

  it('แท็บไม่มี SKU นี้หรือมีไม่พอ ส่วนที่ขาดเป็น short หา SKU ด้วยรหัสสั้นได้ รหัสที่สมุดไม่มีบอกไว้', () => {
    const e = run([
      { row: 10, short: 'AAA001', to: 'G-01-01', qty: 3, src: 'count' },
      { row: 11, sku: F, to: 'G-01-01', qty: 1, src: 'count' },
      sale({ row: 12, from: 'G-01-01', qty: 3 }),
      sale({ row: 13, sku: F, from: 'G-01-01', qty: 1 }),
    ], { lot0: 1, before: tab([['aaa001', 7, P1, 2, ''], ['ZZZ999', 1, P1, 5, ''], [A, 0, 0, 9, '']]) });
    expect(e.rows[12].p).toEqual([[7, P1, 2, 'before', 10, 0], ['', '', 1, 'short', 10, 0]]);
    expect(e.rows[13].p).toEqual([['', '', 1, 'short', 11, 0]]);
    expect(e.before).toMatchObject({ skus: 1, layers: 1, used: 2, short: 2, miss: ['ZZZ999'], missN: 1 });
  });

  it('ไม่มีแท็บ (before null) ของนับยังเป็น count สคริปต์รุ่นที่ไม่ส่ง before ได้ undefined', () => {
    const list = [{ row: 10, to: 'G-01-01', qty: 1, src: 'count' }, sale({ row: 11, from: 'G-01-01', qty: 1 })];
    const e = run(list, { lot0: 1, before: null });
    expect(e.before).toBeNull();
    expect(e.rows[11].p).toEqual([['', '', 1, 'count', 10, 0]]);
    expect(run(list).before).toBeUndefined();
    expect(Z.only(e, ledger([{ date: '', sku: A, lot: 0, po: 0, qty: 1, row: 11 }])).before).toBeNull();
  });
});

describe('WmsLot0.only — เก็บเฉพาะแถวขาย LOT 0 ของเดือน ใช้เลขแถวของแถวขายที่ดึงไว้', () => {
  const D1 = '2026-10-02', D2 = '2026-10-03';

  it('เลขแถวตรงกัน เก็บเฉพาะแถวที่หน้าใช้', () => {
    const e = run([
      { row: 10, to: 'G-01-01', qty: 2, src: 'count' },
      sale({ row: 11, from: 'G-01-01', qty: 1, date: D1 }),
      sale({ row: 12, from: 'G-01-01', qty: 1, date: D2 }),
    ]);
    expect(e.rows[12].d).toBe(D2);
    const s = Z.only(e, ledger([{ date: D2, sku: A, lot: 0, po: 0, qty: 1, row: 12 }, { date: D2, sku: A, lot: 0, po: 0, qty: 4, row: 99 }]));
    expect(Object.keys(s.rows)).toEqual(['12']);
    expect([s.v, s.ok, s.at, s.moved]).toEqual([2, true, 5, 0]);
  });

  it('มีคนแทรกแถวระหว่างอ่านสองครั้ง เลขแถวเลื่อน ยังจับคู่ได้ด้วย SKU จำนวน วันที่ ตามลำดับแถว', () => {
    /* สมุดทั้งชีตอ่านหลังแทรกแถวที่ 11 แถวขายของเดือนอ่านก่อนแทรก (แถวรับคืน 12 ไม่ใช่แถวขาย ไม่อยู่ในแถวขายของเดือน) */
    const e = run([
      sale({ row: 10, lot: 7, po: P1, qty: 9, date: D1 }),
      { row: 12, to: 'G-01-01', qty: 5, src: 'return' },
      sale({ row: 13, from: 'G-01-01', qty: 1, date: D1 }),
      sale({ row: 14, from: 'G-01-01', qty: 1, date: D1 }),
      sale({ row: 15, from: 'G-01-01', qty: 2, date: D2 }),
    ]);
    const led = ledger([
      { date: D1, sku: A, lot: 7, po: P1, qty: 9, row: 10 },
      { date: D1, sku: A, lot: 0, po: 0, qty: 1, row: 12 },
      { date: D1, sku: A, lot: 0, po: 0, qty: 1, row: 13 },
      { date: D2, sku: A, lot: 0, po: 0, qty: 2, row: 14 },
    ]);
    const s = Z.only(e, led);
    expect(Object.keys(s.rows)).toEqual(['12', '13', '14']);
    expect(s.rows[12]).toBe(e.rows[13]);
    expect(s.rows[13]).toBe(e.rows[14]);
    expect(s.rows[14]).toBe(e.rows[15]);
    expect(s.moved).toBe(3);
    const t = L.totals(L.build(led, s));
    expect(t.why).toEqual({});
    expect(t.guess.qty).toBe(4);
  });

  it('แถวที่ไม่มีในสมุดทั้งชีต (ลงหลังเวลาที่อ่าน) ไม่ได้ค่าประมาณของแถวอื่น', () => {
    const e = run([sale({ row: 11, from: 'G-01-01', qty: 1, date: D1 })]);
    const led = ledger([
      { date: D1, sku: A, lot: 0, po: 0, qty: 1, row: 11 },
      { date: D2, sku: A, lot: 0, po: 0, qty: 1, row: 12 },
      { date: D1, sku: F, lot: 0, po: 0, qty: 1, row: 13 },
    ]);
    const s = Z.only(e, led);
    expect(Object.keys(s.rows)).toEqual(['11']);
    expect(L.totals(L.build(led, s)).why).toEqual({ none: 1, stale: 2 });
  });
});

/** แปลงแถวอ่านง่ายเป็นรูปที่ tx-daily ส่งมา */
function ledger(list) {
  const days = [...new Set(list.map((x) => x.date))].sort();
  const skus = [], locs = ['G-01-01'];
  const lines = list.map((x) => {
    if (!skus.some((s) => s[0] === x.sku)) skus.push([x.sku, `ชื่อ ${x.sku}`]);
    return [days.indexOf(x.date), skus.findIndex((s) => s[0] === x.sku), x.row, 0, x.lot, x.po, x.qty, 0];
  });
  return { days, skus, locs, lines, sheet: null };
}

const D = '2026-03-05';
const est = (rows) => ({ ok: true, at: 5, rows });

describe('WmsLotPo.build กับค่าประมาณ', () => {
  const led = ledger([
    { date: D, sku: A, lot: 8, po: P2, qty: 2, row: 20 },
    { date: D, sku: A, lot: 0, po: 0, qty: 3, row: 21 },
  ]);

  it('แยกบรรทัด LOT 0 ตามค่าประมาณ ไม่รวมกับบรรทัดที่สมุดลงล็อตไว้จริง', () => {
    const rows = L.build(led, est({ 21: { s: A, q: 3, p: [[8, P2, 1, 'return', 15, 12], ['', '', 2, 'count', 10, 0]] } }));
    expect(rows.map((r) => [r.lot, r.po, r.qty, r.guess, r.why, r.from, r.rows])).toEqual([
      ['8', P2, 2, '', '', [], [20]],
      ['8', P2, 1, 'return', '', [15], [21]],
      ['0', '0', 2, '', 'count', [10], [21]],
    ]);
    expect(rows[1].noLot).toBe(false);
    expect(rows[2].noLot && rows[2].noPo).toBe(true);
    expect(rows.every((r) => r.split === 3)).toBe(true);

    const t = L.totals(rows);
    expect(t.qty).toBe(5);
    expect(t.unknown).toEqual({ lines: 1, qty: 2 });
    expect(t.guess).toEqual({ lines: 1, qty: 1, by: { return: 1 } });
    expect(t.why).toEqual({ count: 2 });
    expect(L.filter(rows, { only: 'guess' })).toEqual([rows[1]]);
    expect(L.note(rows[1])).toBe('ประมาณจากรับคืน ใช้ LOT/PO ที่ขายออกล่าสุดก่อนรับคืน (แถว 15)');
    expect(L.note(rows[2])).toBe('ไม่รู้ LOT และ PO · มาจากนับสต๊อก ต้องใช้ยอดก่อนวันนับมาประมาณ (แถว 10)');
  });

  it('ไม่มีค่าประมาณของแถวนั้น หรือ SKU กับจำนวนไม่ตรง (แถวในชีตเลื่อน) ไม่ประมาณ และบอกว่าสมุดที่อ่านไว้เก่ากว่า', () => {
    for (const e of [est({}), est({ 21: { s: F, q: 3, p: [[8, P2, 3, 'return', 15, 12]] } }), est({ 21: { s: A, q: 2, p: [] } })]) {
      const rows = L.build(led, e);
      expect(rows.map((r) => [r.lot, r.qty, r.guess, r.why])).toEqual([['8', 2, '', ''], ['0', 3, '', 'stale']]);
      expect(L.note(rows[1])).toBe('ไม่รู้ LOT และ PO · ยังไม่ได้ประมาณ แถวนี้ไม่มีในสมุดทั้งชีตที่อ่านไว้ (ลงหลังเวลาที่อ่าน หรือถูกแก้ทีหลัง)');
    }
  });

  it('ไม่ส่งค่าประมาณทำงานเหมือนเดิม แถวที่จำนวนพิมพ์เป็นข้อความไม่ประมาณ', () => {
    const rows = L.build(led);
    expect(rows.map((r) => [r.lot, r.qty, r.guess, r.why])).toEqual([['8', 2, '', ''], ['0', 3, '', '']]);
    const bad = L.build(ledger([{ date: D, sku: A, lot: 0, po: 0, qty: 'สาม', row: 22 }]), est({}));
    expect(bad.map((r) => [r.why, r.bad])).toEqual([['', ['สาม']]]);
  });

  it('รายออเดอร์ได้ป้ายประมาณติดไปด้วย และหมายเหตุในไฟล์ส่งออกขึ้นต้นด้วย ประมาณ', () => {
    const rows = L.build(led, est({ 21: { s: A, q: 3, p: [[8, P2, 3, 'me', 16, 12]] } }));
    const cut = { days: [D], skus: [[A, 'ชื่อ']], srcs: ['TRcloud'], lines: [[0, '9900000077', 0, 5, 0]] };
    const out = L.allocate(rows, cut);
    expect(out.map((r) => [r.ref, r.lot, r.qty, r.guess])).toEqual([['9900000077', '8', 2, ''], ['9900000077', '8', 3, 'me']]);
    const tsv = L.tsv(out, true).split('\n');
    expect(tsv[2].split('\t').pop()).toBe('ประมาณจาก M/E ใช้ LOT/PO ที่ขายออกล่าสุดก่อนรับเข้า (แถว 16)');
  });
});
