/**
 * LOT / PO ที่ขายออก: public/wms-lotpo.js
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-lotpo.js'), 'utf8');

const A = 'AAA0000000001';
const B = 'BBB0000000002';

let L;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  L = win.WmsLotPo;
});

/** แปลงแถวอ่านง่ายเป็นรูปที่ tx-daily ส่งมา */
function ledger(list) {
  const days = [...new Set(list.map((x) => x.date))].sort();
  const skus = [], locs = [];
  const lines = list.map((x, i) => {
    if (!skus.some((s) => s[0] === x.sku)) skus.push([x.sku, `ชื่อ ${x.sku}`]);
    if (!locs.includes(x.loc || 'A1-01-01')) locs.push(x.loc || 'A1-01-01');
    return [days.indexOf(x.date), skus.findIndex((s) => s[0] === x.sku), x.row || 100 + i,
      locs.indexOf(x.loc || 'A1-01-01'), x.lot, x.po, x.qty, 0];
  });
  return { days, skus, locs, lines };
}

describe('build', () => {
  it('รวมแถวที่ วัน SKU LOT PO เดียวกัน ไม่สน Location', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 3, po: 'PO-111', qty: 2, loc: 'A1-01-01', row: 10 },
      { date: '2026-03-05', sku: A, lot: 3, po: 'PO-111', qty: 5, loc: 'B2-02-02', row: 11 },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-03-05', sku: A, name: `ชื่อ ${A}`, lot: '3', po: 'PO-111', qty: 7, split: 1 });
    expect(rows[0].rows).toEqual([10, 11]);
    expect(rows[0].locs).toEqual(['A1-01-01', 'B2-02-02']);
  });

  it('SKU เดียวออกหลาย LOT/PO ในวันเดียว แยกบรรทัด เรียงล็อตเก่าก่อน ล็อตที่ไม่รู้ไว้ท้าย', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 0, po: '0', qty: 1 },
      { date: '2026-03-05', sku: A, lot: 7, po: 'PO-222', qty: 4 },
      { date: '2026-03-05', sku: A, lot: 0.11, po: 'PO-100', qty: 3 },
      { date: '2026-03-05', sku: A, lot: 7, po: 'PO-201', qty: 2 },
    ]));
    expect(rows.map((r) => `${r.lot}/${r.po}`)).toEqual(['0.11/PO-100', '7/PO-201', '7/PO-222', '0/0']);
    expect(rows.every((r) => r.split === 4)).toBe(true);
  });

  it('วันต่างกันแยกบรรทัด และนับ split แยกวัน', () => {
    const rows = L.build(ledger([
      { date: '2026-03-06', sku: A, lot: 2, po: 'PO-1', qty: 1 },
      { date: '2026-03-05', sku: A, lot: 2, po: 'PO-1', qty: 1 },
      { date: '2026-03-05', sku: A, lot: 3, po: 'PO-2', qty: 1 },
      { date: '2026-03-05', sku: B, lot: 1, po: 'PO-3', qty: 9 },
    ]));
    expect(rows.map((r) => [r.date.slice(8), r.sku, r.split])).toEqual([
      ['05', A, 2], ['05', A, 2], ['05', B, 1], ['06', A, 1],
    ]);
  });

  it('LOT 0 หรือว่าง และ PO 0 หรือว่าง ถือว่าไม่รู้', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 0, po: '0', qty: 1 },
      { date: '2026-03-05', sku: B, lot: '', po: 'PO-9', qty: 1 },
      { date: '2026-03-06', sku: B, lot: 4, po: '', qty: 1 },
      { date: '2026-03-07', sku: B, lot: 4, po: 'PO-9', qty: 1 },
    ]));
    expect(rows.map((r) => [r.noLot, r.noPo])).toEqual([[true, true], [true, false], [false, true], [false, false]]);
  });

  it('พิมพ์เล็กใหญ่ต่างกันคือ LOT/PO เดียวกัน', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 2, po: 'po-1', qty: 1 },
      { date: '2026-03-05', sku: A, lot: 2, po: 'PO-1 ', qty: 2 },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(3);
  });

  it('จำนวนที่พิมพ์เป็นข้อความไม่ถูกบวก แต่จำไว้ว่ามี', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 2, po: 'PO-1', qty: 4 },
      { date: '2026-03-05', sku: A, lot: 2, po: 'PO-1', qty: '3 ชิ้น' },
    ]));
    expect(rows[0].qty).toBe(4);
    expect(rows[0].bad).toEqual(['3 ชิ้น']);
    expect(L.note(rows[0])).toContain('1 แถว ไม่ได้นับ');
  });

  it('สคริปต์รุ่นเก่าไม่มี lines ก็ไม่พัง', () => {
    expect(L.build({ days: [], skus: [] })).toEqual([]);
  });
});

describe('totals และ filter', () => {
  const list = [
    { date: '2026-03-05', sku: A, lot: 1, po: 'PO-1', qty: 5 },
    { date: '2026-03-05', sku: A, lot: 2, po: 'PO-2', qty: 3 },
    { date: '2026-03-05', sku: B, lot: 0, po: '0', qty: 2 },
    { date: '2026-03-06', sku: B, lot: 5, po: 'XY-77', qty: 6 },
  ];

  it('ยอดรวม', () => {
    const t = L.totals(L.build(ledger(list)));
    expect(t).toMatchObject({ qty: 16, lines: 4, skus: 2, split: 1, splitLines: 2, unknown: { lines: 1, qty: 2 }, bad: 0 });
  });

  it('กรองตามวัน หลาย LOT/PO ไม่รู้ LOT/PO และคำค้น', () => {
    const rows = L.build(ledger(list));
    expect(L.filter(rows, { date: '2026-03-06' })).toHaveLength(1);
    expect(L.filter(rows, { only: 'split' }).map((r) => r.lot)).toEqual(['1', '2']);
    expect(L.filter(rows, { only: 'unknown' }).map((r) => r.sku)).toEqual([B]);
    expect(L.filter(rows, { q: 'xy-7' }).map((r) => r.po)).toEqual(['XY-77']);
    expect(L.filter(rows, { q: 'ชื่อ BBB' })).toHaveLength(2);
    expect(L.filter(rows, {})).toHaveLength(4);
  });
});

describe('ส่งออก', () => {
  it('ตารางมีหัวคอลัมน์และ SKU ครบทุกบรรทัด', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 1, po: 'PO-1', qty: 5 },
      { date: '2026-03-05', sku: A, lot: 0, po: '0', qty: 3 },
    ]));
    expect(L.table(rows)).toEqual([
      ['วันที่', 'SKU', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'],
      ['2026-03-05', A, `ชื่อ ${A}`, '1', 'PO-1', 5, ''],
      ['2026-03-05', A, `ชื่อ ${A}`, '0', '0', 3, 'ไม่รู้ LOT และ PO'],
    ]);
  });

  it('TSV วางใน Excel ได้ แท็บกับขึ้นบรรทัดในช่องไม่ทำให้คอลัมน์เลื่อน', () => {
    const led = ledger([{ date: '2026-03-05', sku: A, lot: 1, po: 'PO\t1', qty: 5 }]);
    led.skus[0][1] = 'ชื่อ\nสองบรรทัด';
    const lines = L.tsv(L.build(led)).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1].split('\t')).toEqual(['2026-03-05', A, 'ชื่อ สองบรรทัด', '1', 'PO 1', '5', '']);
  });

  it('CSV มี BOM ครอบช่องที่มีจุลภาค และกันช่องที่ Excel จะอ่านเป็นสูตร', () => {
    const led = ledger([{ date: '2026-03-05', sku: A, lot: 1, po: '=1+1', qty: 5 }]);
    led.skus[0][1] = 'ผ้า, สีขาว "ใหญ่"';
    const text = L.csv(L.build(led));
    expect(text.startsWith('﻿')).toBe(true);
    const row = text.split('\r\n')[1];
    expect(row).toBe(`2026-03-05,${A},"ผ้า, สีขาว ""ใหญ่""",1,'=1+1,5,`);
  });

  it('จำนวนติดลบยังเป็นตัวเลข ไม่ถูกใส่ เครื่องหมายนำหน้า', () => {
    const rows = L.build(ledger([{ date: '2026-03-05', sku: A, lot: 1, po: 'PO-1', qty: -2 }]));
    expect(L.tsv(rows).split('\n')[1].split('\t')[5]).toBe('-2');
  });
});
