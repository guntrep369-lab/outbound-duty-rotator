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

describe('PO ที่ลง -01 -02 ต่อท้ายคือ PO เดียวกันที่รับคนละวัน', () => {
  it('ตัดส่วนท้ายสองหลัก เลขแบบอื่นไม่ตัด', () => {
    expect(L.basePo('9900000001-05')).toBe('9900000001');
    expect(L.basePo('99000001-7')).toBe('99000001');
    for (const v of ['9900000001', 'PO-111', 'PO-111-01', '12-03', '9900000001-123', '0', '']) expect(L.basePo(v)).toBe(v);
  });

  it('รอบ -05 กับ -20 ใน LOT เดียวกันรวมเป็นบรรทัดเดียว ใช้เลข PO และบอกว่ารวมรอบไหน', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 9, po: '9900000001-20', qty: 2, row: 10 },
      { date: '2026-03-05', sku: A, lot: 9, po: '9900000001-05', qty: 3, row: 11 },
      { date: '2026-03-05', sku: A, lot: 9, po: '9900000001', qty: 1, row: 12 },
      { date: '2026-03-05', sku: A, lot: 10, po: '9900000001-14', qty: 4, row: 13 },
    ]));
    expect(rows.map((r) => [r.lot, r.po, r.qty, r.parts, r.split])).toEqual([
      ['9', '9900000001', 6, ['-05', '-20'], 2],
      ['10', '9900000001', 4, ['-14'], 2],
    ]);
    expect(L.table(rows)[1]).toEqual(['2026-03-05', A, '', `ชื่อ ${A}`, '9', '9900000001', 6, '']);
    expect(L.filter(rows, { q: '9900000001-20' })).toHaveLength(2);
  });

  it('รายออเดอร์ปันจากบรรทัดที่รวมแล้ว และพารอบที่รวมไปด้วย', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 9, po: '9900000001-05', qty: 2 },
      { date: '2026-03-05', sku: A, lot: 9, po: '9900000001-20', qty: 2 },
    ]));
    const out = L.allocate(rows, { days: ['2026-03-05'], skus: [[A, 'x']], srcs: ['WEB'], lines: [[0, 'ORD-1', 0, 3, 0]] });
    expect(out.map((r) => [r.ref, r.po, r.qty, r.miss])).toEqual([['ORD-1', '9900000001', 3, ''], ['', '9900000001', 1, 'order']]);
    expect(out[0].parts).toEqual(['-05', '-20']);
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

/** แปลงแถวออเดอร์อ่านง่ายเป็นรูปที่ cut-orders ส่งมา เรียงตามแถวในแท็บ */
function orders(list) {
  const days = [], skus = [], srcs = [];
  const at = (arr, v, item = v) => { let i = arr.findIndex((x) => (Array.isArray(x) ? x[0] : x) === v); if (i < 0) { i = arr.length; arr.push(item); } return i; };
  const lines = list.map((o) => [at(days, o.date), o.ref, at(skus, o.sku, [o.sku, `แบรนด์ ${o.sku}`]), o.qty, at(srcs, o.src || 'JST')]);
  return { days, skus, srcs, lines, span: { from: '2026-03-01', to: '2026-03-31' } };
}

describe('allocate ปันล็อตให้ออเดอร์', () => {
  const D = '2026-03-05';

  it('ล็อตเก่าก่อน ให้ออเดอร์ตามลำดับแถว ออเดอร์ที่ข้ามล็อตแยกเป็นสองบรรทัด', () => {
    const rows = L.build(ledger([
      { date: D, sku: A, lot: 0, po: '0', qty: 1 },
      { date: D, sku: A, lot: 5, po: 'PO-5', qty: 2 },
      { date: D, sku: A, lot: 3, po: 'PO-3', qty: 2 },
    ]));
    const out = L.allocate(rows, orders([
      { date: D, ref: 'R2', sku: A, qty: 3 },
      { date: D, ref: 'R1', sku: A, qty: 2, src: 'CRM' },
    ]));
    expect(out.map((r) => [r.ref, r.src, r.lot, r.po, r.qty, r.split, r.miss])).toEqual([
      ['R2', 'JST', '3', 'PO-3', 2, 2, ''],
      ['R2', 'JST', '5', 'PO-5', 1, 2, ''],
      ['R1', 'CRM', '5', 'PO-5', 1, 2, ''],
      ['R1', 'CRM', '0', '0', 1, 2, ''],
    ]);
    expect(out[3]).toMatchObject({ noLot: true, noPo: true, name: `ชื่อ ${A}` });
  });

  it('บรรทัดของออเดอร์เดียวกันอยู่ติดกัน แม้ SKU ต่างกัน', () => {
    const rows = L.build(ledger([
      { date: D, sku: A, lot: 1, po: 'PO-1', qty: 2 },
      { date: D, sku: B, lot: 2, po: 'PO-2', qty: 2 },
    ]));
    const out = L.allocate(rows, orders([
      { date: D, ref: 'R1', sku: B, qty: 1 },
      { date: D, ref: 'R2', sku: A, qty: 1 },
      { date: D, ref: 'R1', sku: A, qty: 1 },
      { date: D, ref: 'R2', sku: B, qty: 1 },
    ]));
    expect(out.map((r) => `${r.ref}:${r.sku[0]}`)).toEqual(['R1:A', 'R1:B', 'R2:A', 'R2:B']);
    expect(L.totals(out)).toMatchObject({ qty: 4, orders: 2, gap: { lines: 0, qty: 0 } });
  });

  it('สมุดลงขายไม่ถึง: ส่วนที่เหลือของออเดอร์ไม่มีล็อต', () => {
    const rows = L.build(ledger([{ date: D, sku: A, lot: 1, po: 'PO-1', qty: 1 }]));
    const out = L.allocate(rows, orders([{ date: D, ref: 'R1', sku: A, qty: 3 }]));
    expect(out.map((r) => [r.ref, r.lot, r.qty, r.miss])).toEqual([['R1', '1', 1, ''], ['R1', '', 2, 'ledger']]);
    expect(L.note(out[1])).toContain('สมุดลงขายไม่ถึง');
  });

  it('สมุดลงขายเกิน: ส่วนที่ไม่มีออเดอร์ไปอยู่ท้ายวัน', () => {
    const rows = L.build(ledger([
      { date: D, sku: A, lot: 1, po: 'PO-1', qty: 4 },
      { date: D, sku: B, lot: 2, po: 'PO-2', qty: 1 },
    ]));
    const out = L.allocate(rows, orders([{ date: D, ref: 'R1', sku: A, qty: 1 }, { date: D, ref: 'R2', sku: B, qty: 1 }]));
    expect(out.map((r) => [r.ref, r.sku, r.qty, r.miss])).toEqual([['R1', A, 1, ''], ['R2', B, 1, ''], ['', A, 3, 'order']]);
    expect(L.totals(out)).toMatchObject({ qty: 5, orders: 2, gap: { lines: 1, qty: 3 } });
    expect(L.filter(out, { only: 'gap' })).toHaveLength(1);
  });

  it('SKU ที่มีแต่ในออเดอร์ ใช้ชื่อจากแท็บตัด ยอดติดลบไม่ปันล็อต', () => {
    const out = L.allocate([], orders([{ date: D, ref: 'R1', sku: B, qty: 2 }, { date: D, ref: 'R9', sku: A, qty: -1 }]));
    expect(out.map((r) => [r.ref, r.name, r.qty, r.miss])).toEqual([['R1', `แบรนด์ ${B}`, 2, 'ledger'], ['R9', `แบรนด์ ${A}`, -1, 'minus']]);
  });

  it('คนละวันไม่ปันข้ามกัน', () => {
    const rows = L.build(ledger([{ date: '2026-03-06', sku: A, lot: 1, po: 'PO-1', qty: 1 }]));
    const out = L.allocate(rows, orders([{ date: D, ref: 'R1', sku: A, qty: 1 }]));
    expect(out.map((r) => [r.date, r.ref, r.miss])).toEqual([[D, 'R1', 'ledger'], ['2026-03-06', '', 'order']]);
  });

  it('ค้นด้วยเลขออเดอร์ได้ และส่งออกมีคอลัมน์ระบบกับเลขออเดอร์', () => {
    const rows = L.build(ledger([{ date: D, sku: A, lot: 1, po: 'PO-1', qty: 2 }]));
    const out = L.allocate(rows, orders([{ date: D, ref: 'X-77', sku: A, qty: 2, src: 'โอนย้าย' }]));
    expect(L.filter(out, { q: 'x-7' })).toHaveLength(1);
    expect(L.table(out, true)).toEqual([
      ['วันที่', 'ระบบ', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'บริษัทขนส่ง', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'],
      [D, 'โอนย้าย', 'X-77', '', '', A, '', `ชื่อ ${A}`, '1', 'PO-1', 2, ''],
    ]);
    expect(L.tsv(out, true).split('\n')[1].split('\t')).toHaveLength(12);
  });

  it('ส่งออกมีเลขคำสั่งซื้อออนไลน์กับบริษัทขนส่ง เลขยาว Excel ไม่ปัด เลขที่ชีตปัดไปแล้วบอกในหมายเหตุ', () => {
    const rows = L.build(ledger([{ date: D, sku: A, lot: 1, po: 'PO-1', qty: 3 }]));
    const cut = Object.assign(orders([
      { date: D, ref: 'R1', sku: A, qty: 1 },
      { date: D, ref: 'R2', sku: A, qty: 1 },
      { date: D, ref: 'R3', sku: A, qty: 1, src: 'CRM' },
    ]), { refs: { R1: ['990000000000000001', 1], R2: ['9.9E+17', 0], R3: ['', -1] }, sups: ['ขนส่งเอ', 'ขนส่งบี'] });
    const out = L.allocate(rows, cut);
    expect(out.map((r) => [r.ref, r.online, r.sup])).toEqual([['R1', '990000000000000001', 'ขนส่งบี'], ['R2', '9.9E+17', 'ขนส่งเอ'], ['R3', '', '']]);
    expect(L.filter(out, { q: '990000000000000001' }).map((r) => r.ref)).toEqual(['R1']);
    expect(L.note(out[1])).toBe('เลขคำสั่งซื้อออนไลน์ในแท็บตัดถูกชีตปัดเป็นเลขยกกำลัง ดูเลขจริงในระบบ JST');
    expect(L.note(out[0])).toBe('');
    const tsv = L.tsv(out, true).split('\n').map((l) => l.split('\t'));
    expect(tsv[1].slice(2, 5)).toEqual(['R1', '="990000000000000001"', 'ขนส่งบี']);
    expect(L.csv(out, true).split('\r\n')[1]).toContain(',R1,"=""990000000000000001""",ขนส่งบี,');
    /* แปลงคืน SKU ไม่ทำให้สองช่องนี้หาย */
    expect(L.convert(out, { pairs: [[A, 'BUY-1', 'ซื้อ']] })[0]).toMatchObject({ sku: 'BUY-1', online: '990000000000000001', sup: 'ขนส่งบี' });
  });
});

describe('ส่งออก', () => {
  it('ตารางมีหัวคอลัมน์และ SKU ครบทุกบรรทัด', () => {
    const rows = L.build(ledger([
      { date: '2026-03-05', sku: A, lot: 1, po: 'PO-1', qty: 5 },
      { date: '2026-03-05', sku: A, lot: 0, po: '0', qty: 3 },
    ]));
    expect(L.table(rows)).toEqual([
      ['วันที่', 'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน', 'หมายเหตุ'],
      ['2026-03-05', A, '', `ชื่อ ${A}`, '1', 'PO-1', 5, ''],
      ['2026-03-05', A, '', `ชื่อ ${A}`, '0', '0', 3, 'ไม่รู้ LOT และ PO'],
    ]);
  });

  it('TSV วางใน Excel ได้ แท็บกับขึ้นบรรทัดในช่องไม่ทำให้คอลัมน์เลื่อน', () => {
    const led = ledger([{ date: '2026-03-05', sku: A, lot: 1, po: 'PO\t1', qty: 5 }]);
    led.skus[0][1] = 'ชื่อ\nสองบรรทัด';
    const lines = L.tsv(L.build(led)).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1].split('\t')).toEqual(['2026-03-05', A, '', 'ชื่อ สองบรรทัด', '1', 'PO 1', '5', '']);
  });

  it('CSV มี BOM ครอบช่องที่มีจุลภาค และกันช่องที่ Excel จะอ่านเป็นสูตร', () => {
    const led = ledger([{ date: '2026-03-05', sku: A, lot: 1, po: '=1+1', qty: 5 }]);
    led.skus[0][1] = 'ผ้า, สีขาว "ใหญ่"';
    const text = L.csv(L.build(led));
    expect(text.startsWith('﻿')).toBe(true);
    const row = text.split('\r\n')[1];
    expect(row).toBe(`2026-03-05,${A},,"ผ้า, สีขาว ""ใหญ่""",1,'=1+1,5,`);
  });

  it('จำนวนติดลบยังเป็นตัวเลข ไม่ถูกใส่ เครื่องหมายนำหน้า', () => {
    const rows = L.build(ledger([{ date: '2026-03-05', sku: A, lot: 1, po: 'PO-1', qty: -2 }]));
    expect(L.tsv(rows).split('\n')[1].split('\t')[6]).toBe('-2');
  });
});

describe('convert คืน SKU ที่แปลงแล้วเป็น SKU ตอนซื้อ', () => {
  const D = '2026-03-05';
  const AS = `${A}-S`, AM = `${A}-M`;

  it('แปลงคืนตาม MASTER เก็บ SKU ที่ขายไว้ เรียงตาม SKU ตอนซื้อ ไม่แก้บรรทัดเดิม', () => {
    const rows = L.build(ledger([
      { date: D, sku: AS, lot: 2, po: 'PO-2', qty: 4 },
      { date: D, sku: B, lot: 1, po: 'PO-1', qty: 1 },
      { date: D, sku: A, lot: 1, po: 'PO-1', qty: 3 },
    ]));
    const out = L.convert(rows, { pairs: [[AS, A, 'ชื่อตอนซื้อ']] });
    expect(out.map((r) => [r.sku, r.sold || '', r.name, r.qty])).toEqual([
      [A, '', `ชื่อ ${A}`, 3],
      [A, AS, 'ชื่อตอนซื้อ', 4],
      [B, '', `ชื่อ ${B}`, 1],
    ]);
    expect(rows.find((r) => r.qty === 4).sku).toBe(AS);
    expect(L.table(out)[2]).toEqual([D, A, AS, 'ชื่อตอนซื้อ', '2', 'PO-2', 4, '']);
    expect(L.totals(out).conv).toEqual({ lines: 1, qty: 4 });
    expect(L.filter(out, { only: 'conv' })).toHaveLength(1);
    expect(L.filter(out, { q: '-s' })).toHaveLength(1);
  });

  it('สมุดไม่มีชื่อ SKU ตอนซื้อ ใช้ชื่อของ SKU ที่ขาย ไม่มี MASTER ก็ไม่แปลง', () => {
    const rows = L.build(ledger([{ date: D, sku: AS, lot: 2, po: 'PO-2', qty: 4 }]));
    expect(L.convert(rows, { pairs: [[AS, A, '']] })[0]).toMatchObject({ sku: A, sold: AS, name: `ชื่อ ${AS}` });
    expect(L.convert(rows, null)[0]).toMatchObject({ sku: AS });
    expect(L.convert(rows, undefined)[0].sold).toBeUndefined();
  });

  it('แปลงหลายทอดย้อนถึงตัวที่ซื้อ SKU ตอนซื้อหลายตัวไม่แปลงแต่ติดป้าย', () => {
    const rows = L.build(ledger([
      { date: D, sku: AM, lot: 1, po: 'PO-1', qty: 2 },
      { date: D, sku: B, lot: 1, po: 'PO-1', qty: 5 },
    ]));
    const out = L.convert(rows, { pairs: [[AM, AS, ''], [AS, A, 'ชื่อตอนซื้อ'], [B, 'P-1', ''], [B, 'P-2', ''], [B, 'p-1', '']] });
    expect(out[0]).toMatchObject({ sku: A, sold: AM, name: 'ชื่อตอนซื้อ' });
    expect(out[1]).toMatchObject({ sku: B, many: ['P-1', 'P-2'] });
    expect(out[1].sold).toBeUndefined();
    expect(L.note(out[1])).toContain('P-1, P-2');
    expect(L.totals(out).many).toEqual({ lines: 1, qty: 5 });
    expect(L.filter(out, { only: 'conv' })).toHaveLength(2);
  });

  it('MASTER วนกลับหาตัวเองไม่ค้าง', () => {
    const rows = L.build(ledger([{ date: D, sku: AS, lot: 1, po: 'PO-1', qty: 1 }]));
    expect(L.convert(rows, { pairs: [[AS, A, ''], [A, AS, '']] })[0].sku).toBe(A);
  });

  it('รายออเดอร์ปันล็อตด้วย SKU ที่ขาย แล้วค่อยแปลงคืน ลำดับออเดอร์คงเดิม', () => {
    const rows = L.build(ledger([{ date: D, sku: AS, lot: 1, po: 'PO-1', qty: 3 }]));
    const out = L.convert(L.allocate(rows, orders([
      { date: D, ref: 'R2', sku: AS, qty: 1 },
      { date: D, ref: 'R1', sku: AS, qty: 2 },
    ])), { pairs: [[AS, A, 'ชื่อตอนซื้อ']] });
    expect(out.map((r) => [r.ref, r.sku, r.sold, r.qty, r.miss])).toEqual([['R2', A, AS, 1, ''], ['R1', A, AS, 2, '']]);
    expect(L.table(out, true)[1]).toEqual([D, 'JST', 'R2', '', '', A, AS, 'ชื่อตอนซื้อ', '1', 'PO-1', 1, '']);
  });
});
