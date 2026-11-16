/**
 * เช็คความเสี่ยง MFG: public/wms-mfg.js (ใช้ WmsFifo.lotMonth กับเครื่องนับของ WmsStocktake)
 *
 * รอบ MFG วิ่งบน apps-script/stocktake-api.gs ตัวจริง (ชีตในหน่วยความจำ) เพราะสิ่งที่ต้องไม่พังคือ
 * คนนับเห็นแค่โลกับ SKU ที่ต้องนับ และไม่เห็นยอดในสมุด ข้อมูลทั้งหมดสมมติ repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadStocktake } from '../dev/fake-gas.js';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let M, ST;
beforeAll(() => {
  const win = {};
  new Function('window', read('wms-fifo.js'))(win);
  new Function('window', read('wms-stocktake.js'))(win);
  new Function('window', read('wms-mfg.js'))(win);
  M = win.WmsMfg;
  ST = win.WmsStocktake;
});

const SKUS = [
  ['AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ Mattress'],
  ['BBB001', 'BBB0000000001', 'ท็อปเปอร์ 3.5FT สมมติ Topper'],
  ['CCC001', 'CCC0000000001', 'หมอนสุขภาพ สมมติ Pillow'],
  ['DDD001', 'DDD0000000001', 'ผ้าปูที่นอน สมมติ'],
  ['FRE001', 'FRE0000000001', 'แถม-หมอนสมมติ'],
  ['EEE001', 'EEE0000000001', 'ที่นอนสัตว์เลี้ยง สมมติ Pet Bed'],
];

/* ยอดตั้งต้นทั้งคลังแบบที่ WmsStocktake.baseline คืน (รอบ พ.ย. 69: นับ LOT 8 ลงไป) */
const BASE = {
  piles: [
    ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ Mattress', '4', '9900000001', 10, 0],
    ['R1-01-02', 'AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ Mattress', '6', '9900000002', 5, 0],
    ['R1-01-02', 'AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ Mattress', '9', '9900000003', 7, 0],
    ['R2-01-01', 'BBB001', 'BBB0000000001', 'ท็อปเปอร์ 3.5FT สมมติ Topper', '8', '9900000004', 12, 0],
    ['A-01-01', 'BBB001', 'BBB0000000001', 'ท็อปเปอร์ 3.5FT สมมติ Topper', '10', '9900000004', 3, 1],
    ['A-01-02', 'CCC001', 'CCC0000000001', 'หมอนสุขภาพ สมมติ Pillow', '0', '0', 4, 1],
    ['A-01-03', 'DDD001', 'DDD0000000001', 'ผ้าปูที่นอน สมมติ', '4', '9900000005', 20, 1],
    ['B-01-01', 'AAA001', 'AAA0000000001', 'ที่นอน 5FT สมมติ Mattress', '0.12', '9900000006', -2, 0],
  ],
  skus: SKUS,
  pos: [
    ['9900000001', 'ผู้ผลิต ก สมมติ', ['AAA0000000001'], ['4']],
    ['9900000004', 'ผู้ผลิต ข สมมติ', ['BBB0000000001'], ['8', '10']],
    ['9900000005', 'ผู้ผลิต ค สมมติ', ['DDD0000000001'], ['4']],
  ],
  lastRow: 99, lastDate: '2026-11-15',
};

describe('ประเภทสินค้าบีบสูญญากาศ', () => {
  it('เดาจากชื่อ: ที่นอน ท็อปเปอร์ หมอน ที่นอนสัตว์เลี้ยง · ผ้า/ชุด/ปลอก และของแถมไม่ใช่', () => {
    expect(SKUS.map((s) => M.typeOf(s[2], s[0]))).toEqual(['Mattress', 'Topper', 'Pillow & Bolster', '', '', 'Pet Bed']);
    expect(M.typeOf('ปลอกหมอน สมมติ', 'ZZZ001')).toBe('');
    expect(M.typeOf('หมอนข้าง สมมติ Bolster', 'ZZZ002')).toBe('Pillow & Bolster');
  });

  it('รายชื่อเดาจากสมุดได้ SKU เต็มกับประเภท', () => {
    expect(M.guessList(SKUS)).toEqual([
      ['AAA0000000001', 'Mattress'], ['BBB0000000001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster'], ['EEE0000000001', 'Pet Bed'],
    ]);
  });

  it('วางตารางจากชีตของทีม (มีหัว SKU / Product Name / Type) ข้ามแถว Total กับ SKU ซ้ำ', () => {
    const raw = [
      'SKU\tProduct Name\tType\tNO LOT\tLot 4\tTotal MFG',
      'AAA0000000001\tที่นอน 5FT สมมติ\tMattress\t\t28\t28',
      'BBB0000000001\tท็อปเปอร์ สมมติ\tTopper\t\t\t0',
      'CCC0000000001\tหมอน สมมติ\tPillow & Bolster\t\t\t0',
      'AAA0000000001\tซ้ำ\tMattress',
      'Total\t\t\t\t28\t28',
    ].join('\r\n');
    const r = M.parseList(raw);
    expect(r.head).toBe(true);
    expect(r.rows).toEqual([['AAA0000000001', 'Mattress'], ['BBB0000000001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster']]);
    expect(r.skip).toBe(2);
  });

  it('วางแบบไม่มีหัว: หา SKU กับ Type เอง ไม่มี Type เดาจากชื่อ', () => {
    const r = M.parseList('EEE0000000001\tที่นอนสัตว์เลี้ยง Large สมมติ\tPet Bed\nBBB0000000001\tท็อปเปอร์ 6FT สมมติ Topper');
    expect(r.head).toBe(false);
    expect(r.rows).toEqual([['EEE0000000001', 'Pet Bed'], ['BBB0000000001', 'Topper']]);
  });

  it('เก็บในค่าตั้งของรอบเป็นรหัสสั้น แล้วอ่านกลับได้ประเภทเดิม', () => {
    const list = [['aaa0000000001', 'Mattress'], ['EEE0000000001', 'Pet Bed'], ['ZZZ0000000009', 'Duvet']];
    const packed = M.packList(list);
    expect(packed).toEqual([['AAA0000000001', 'M'], ['EEE0000000001', 'B'], ['ZZZ0000000009', 'Duvet']]);
    expect(M.unpackList(packed)).toEqual([['AAA0000000001', 'Mattress'], ['EEE0000000001', 'Pet Bed'], ['ZZZ0000000009', 'Duvet']]);
  });
});

describe('LOT ตัดและสถานะ (เดือนนี้ลบ 3)', () => {
  it('รอบ พ.ย. 69: นับ LOT 8 ลงไป · LOT 6 เฝ้าระวัง · LOT 5 ลงไปเสี่ยงมาก', () => {
    const r = M.rule('2026-11');
    expect(r.text).toBe('นับ LOT 8 ลงไป');
    expect([r.okText, r.watchText, r.riskText]).toEqual(['LOT 7–8', 'LOT 6', 'LOT 5 ลงไป']);
    expect(M.roundName('2026-11')).toBe('MFG พ.ย. 69 · นับ LOT 8 ลงไป');
    const st = (lot) => M.statusOf(lot, '2026-11').st;
    expect(['8', '7', '6', '5', '4', '08'].map(st)).toEqual(['ok', 'ok', 'watch', 'risk', 'risk', 'ok']);
    expect(['9', '10', '11'].map(st)).toEqual(['new', 'new', 'new']);
    /* LOT 12 ในเดือน พ.ย. คือ ธ.ค. ปีก่อน (กติกาเดียวกับหน้า FIFO) 0.11 ก็ปีก่อน */
    expect(['12', '0.11', '0.12'].map(st)).toEqual(['risk', 'risk', 'risk']);
    expect(['0', '', '00'].map(st)).toEqual(['nolot', 'nolot', 'nolot']);
    expect(M.statusOf('A1', '2026-11')).toMatchObject({ st: 'nolot', bad: true });
  });

  it('ข้ามปี: รอบ ก.พ. 70 นับ LOT 11 (พ.ย. 69) ลงไป', () => {
    const st = (lot) => M.statusOf(lot, '2027-02').st;
    expect(M.rule('2027-02').text).toBe('นับ LOT 11 ลงไป');
    expect(['1', '2', '12', '11', '0.11', '9', '8'].map(st)).toEqual(['new', 'new', 'new', 'ok', 'ok', 'watch', 'risk']);
  });

  it('อายุนับจากวันที่ 1 ของเดือน LOT', () => {
    expect(M.ageDays({ y: 2026, m: 8 }, '2026-11-16')).toBe(107);
    expect(M.ageDays(null, '2026-11-16')).toBe(null);
  });

  it('เดือนที่เปิดรอบได้: เดือนก่อน เดือนนี้ เดือนหน้า', () => {
    expect(M.months('2026-12-31')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('สมุดที่ใช้ตั้งรอบ', () => {
  const ok = { app: 'transaction', at: 1000, rows: [[2, 0, 4, 0, -1, 0, 5, 0, -1, 10]], skus: [SKUS[0]], sheet: { url: 'https://docs.example/d/x/edit', gid: 7 } };

  it('สมุดว่าง (สคริปต์เห็นแท็บสมุดแค่หัวตาราง) ใช้ไม่ได้ และบอกว่าเป็นเพราะอะไร', () => {
    expect(M.ledgerProblem(ok)).toBe('');
    expect(M.ledgerProblem({ ...ok, rows: [], skus: [] })).toMatch(/0 แถว/);
    expect(M.ledgerProblem({ error: 'ไม่พบชีต Transaction' })).toMatch(/ไม่พบชีต Transaction/);
    expect(M.ledgerProblem({ app: 'transaction' })).toMatch(/ไม่ได้ตอบสมุด/);
    expect(M.ledgerProblem({ app: 'stocktake', rows: [] })).toMatch(/ไม่ได้ตอบสมุด/);
    expect(M.ledgerProblem(null)).toBeTruthy();
  });

  it('เวลาของสมุด: ชุดกลางใช้เวลาที่เก็บ อ่านสดใช้เวลาที่คิด · ลิงก์ไปแท็บสมุด', () => {
    expect(M.ledgerTime(ok)).toBe(1000);
    expect(M.ledgerTime({ ...ok, shared: { at: 2000 } })).toBe(2000);
    expect(M.ledgerLink(ok)).toBe('https://docs.example/d/x/edit#gid=7');
    expect(M.ledgerLink({ sheet: { url: 'javascript:alert(1)' } })).toBe('');
    expect(M.ledgerLink({})).toBe('');
  });
});

describe('ลิงก์คนนับของรอบ MFG', () => {
  it('ใช้หน้ากรอกของนับสต๊อกใหญ่ แต่ลิงก์บอกว่าเป็นรอบ MFG (หน้ากรอกเปลี่ยนชื่อหัวตาม) ลิงก์นับสต๊อกใหญ่ไม่มีป้ายนี้', () => {
    const link = ST.countLink('https://x.github.io/app/stocktake/count.html', 'https://script.google.com/macros/s/ABC/exec', 'nab', 'ST261116-1', 'mfg');
    expect(ST.parseLink(link.split('#')[1])).toEqual({ url: 'https://script.google.com/macros/s/ABC/exec', key: 'nab', round: 'ST261116-1', kind: 'mfg' });
    const big = ST.countLink('p', 'u', 'nab', 'r');
    expect(big).not.toContain('m=');
    expect(ST.parseLink(big.split('#')[1])).not.toHaveProperty('kind');
  });
});

describe('ของที่ต้องนับ', () => {
  const LIST = [['AAA0000000001', 'Mattress'], ['BBB001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster'], ['XYZ0000000001', 'Mattress']];

  it('เหลือเฉพาะ SKU ในรายชื่อ LOT ไม่ใหม่กว่า LOT ตัด ยอดมากกว่า 0 (รวม LOT 0)', () => {
    const s = M.scope(BASE, LIST, '2026-11');
    expect(s.piles.map((p) => p[0] + ' ' + p[1] + ' ' + p[4])).toEqual([
      'R1-01-01 AAA001 4', 'R1-01-02 AAA001 6', 'R2-01-01 BBB001 8', 'A-01-02 CCC001 0',
    ]);
    expect(s.locs.map((l) => l.loc)).toEqual(['R1-01-01', 'R1-01-02', 'R2-01-01', 'A-01-02']);
    expect(s.locs[0]).toMatchObject({ zone: 'R', group: 'R1', piles: 1 });
    /* รหัสสั้นที่วางมา (BBB001) จับกับรหัสเต็มของสมุดได้ · รหัสที่สมุดไม่มีบอกไว้ */
    expect(s.skus.map((k) => k[0])).toEqual(['AAA001', 'BBB001', 'CCC001']);
    expect(s.missing).toEqual(['XYZ0000000001']);
    expect(s.pos.map((p) => p[0])).toEqual(['9900000001', '9900000004']);
    expect(s.totals).toMatchObject({ piles: 4, locs: 4, qty: 31, skus: 3 });
    expect(s.totals.by).toMatchObject({ risk: { qty: 10, piles: 1 }, watch: { qty: 5 }, ok: { qty: 12 }, nolot: { qty: 4 } });
  });

  it('แบ่งทีมตามแถว ทีมเดียวได้ทุกแถว', () => {
    const s = M.scope(BASE, LIST, '2026-11');
    expect(M.teams(s.locs, 1)).toEqual([{ id: 'MFG1', kind: 'Inventory', name: 'ทีม MFG', members: [], zones: ['R1', 'R2', 'A-01'], locs: 4 }]);
    const two = M.teams(s.locs, 2);
    expect(two.map((t) => t.zones)).toEqual([['R1'], ['R2', 'A-01']]);
  });
});

/* แถวบันทึกนับแบบ WmsStocktake.fromRow */
let seq = 0;
function e(loc, sku, lot, qty, x) {
  seq++;
  return { row: seq + 1, at: seq, pass: 1, team: 'MFG1', kind: 'Inventory', who: 'สมชาย', loc, sku, long: '', lot, po: '', qty, type: 'นับ', ref: '', uid: 'u' + seq, ...x };
}

describe('รายงาน', () => {
  const LIST = [['AAA0000000001', 'Mattress'], ['BBB0000000001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster']];
  const book = () => M.scope(BASE, LIST, '2026-11');

  it('โหมดสมุด: คอลัมน์ NO LOT ก่อน แล้ว LOT เก่าไปใหม่ เรียงแถวเสี่ยงสุดก่อน', () => {
    const s = book();
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries: [], mode: 'book', locs: s.locs });
    expect(rep.cols.map((c) => [c.label, c.st])).toEqual([['NO LOT', 'nolot'], ['Lot 4', 'risk'], ['Lot 6', 'watch'], ['Lot 8', 'ok']]);
    expect(rep.cols[1].age).toBe(229);
    expect(rep.rows.map((r) => [r.sku, r.st, r.total.book])).toEqual([
      ['AAA0000000001', 'risk', 15], ['CCC0000000001', 'nolot', 4], ['BBB0000000001', 'ok', 12],
    ]);
    expect(rep.totals.book).toBe(31);
    expect(rep.by.risk).toEqual({ qty: 10, skus: 1 });
    expect(rep.by.watch).toEqual({ qty: 5, skus: 1 });
    expect(rep.done).toBe(0);
    expect(rep.total).toBe(4);
  });

  it('โหมดนับ: ใช้ที่นับได้ · LOT ใหม่กว่าที่กำหนดกับ SKU นอกรายชื่อไม่นับ แยกไว้ · แถวที่ถูกแก้ใช้ตัวล่าสุด', () => {
    const s = book();
    const first = e('R1-01-01', 'AAA001', '4', 9);
    const entries = [
      first,
      e('R1-01-01', 'AAA001', '4', 8, { ref: first.uid }),       // แก้กองเดิม 9 → 8
      e('R1-01-02', 'AAA001', '6', 5),
      e('R1-01-02', 'AAA001', '9', 7),                            // LOT 9 ใหม่กว่า LOT ตัด
      e('R1-01-02', 'AAA001', '5', 2),                            // เจอ LOT 5 ที่สมุดไม่มี
      e('A-01-02', 'CCC001', '0', 4),
      e('A-01-02', 'DDD001', '4', 1),                             // ไม่ใช่ของบีบสูญญากาศ
      e('A-01-02', 'CCC001', 'X', 1),                             // LOT อ่านไม่ออก → NO LOT
    ];
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries, mode: 'count', locs: s.locs });
    expect(rep.cols.map((c) => c.label)).toEqual(['NO LOT', 'Lot 4', 'Lot 5', 'Lot 6', 'Lot 8']);
    const a = rep.rows.find((r) => r.short === 'AAA001');
    expect(a.cells[rep.cols[1].key]).toMatchObject({ book: 10, count: 8 });
    expect(a.cells[rep.cols[2].key]).toMatchObject({ book: 0, count: 2 });
    expect(a.total).toEqual({ book: 15, count: 15 });
    expect(a.st).toBe('risk');
    expect(a.cells[rep.cols[1].key].locs['R1-01-01']).toEqual({ book: 10, count: 8 });
    const c = rep.rows.find((r) => r.short === 'CCC001');
    expect(c.cells.N).toMatchObject({ book: 4, count: 5 });
    expect(Object.keys(c.cells.N.raw)).toEqual(['X']);
    /* BBB ยังไม่มีใครไปนับโล R2-01-01 */
    const b = rep.rows.find((r) => r.short === 'BBB001');
    expect(b).toMatchObject({ st: 'wait', left: ['R2-01-01'] });
    expect(rep.rows.map((r) => r.short)).toEqual(['AAA001', 'CCC001', 'BBB001']);
    expect(rep.ignored.newer).toEqual([{ loc: 'R1-01-02', sku: 'AAA001', lot: '9', qty: 7, who: 'สมชาย' }]);
    expect(rep.ignored.other.map((x) => x.sku)).toEqual(['DDD001']);
    expect(rep.done).toBe(3);
    expect(rep.by.risk).toEqual({ qty: 10, skus: 1 });
  });

  it('นับโลครบแต่ไม่เจอของ = ไม่พบของ · ตัวกรองตามสถานะ ประเภท และคำค้น', () => {
    const s = book();
    const entries = [e('R2-01-01', '', '', 0, { type: 'ว่าง' }), e('R1-01-01', 'AAA001', '4', 10)];
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries, mode: 'count', locs: s.locs });
    expect(rep.rows.find((r) => r.short === 'BBB001').st).toBe('none');
    expect(M.filter(rep, { st: 'risk' }).map((r) => r.short)).toEqual(['AAA001']);
    expect(M.filter(rep, { st: 'none' }).map((r) => r.short)).toEqual(['BBB001']);
    expect(M.filter(rep, { type: 'Pillow & Bolster' }).map((r) => r.short)).toEqual(['CCC001']);
    expect(M.filter(rep, { q: 'r1-01-02' }).map((r) => r.short)).toEqual(['AAA001']);
  });

  it('ชีต Excel หน้าตาเดียวกับรายงานของทีม: หัวปี Lot อายุ ยอดรวมทั้งหมด แถวรวมท้าย', () => {
    const s = book();
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries: [], mode: 'book', locs: s.locs });
    const sh = M.sheet(rep, { ym: '2026-11' });
    expect(sh.aoa[0][0]).toMatch(/^เช็คความเสี่ยง MFG พ\.ย\. 69 · นับ LOT 8 ลงไป · ยอดในสมุด/);
    expect(sh.aoa[1].slice(0, 7)).toEqual(['SKU', 'Product Name', 'Type', 'NO LOT', '2026', '', '']);
    expect(sh.aoa[1].slice(7)).toEqual(['Total MFG', 'สถานะ', 'Remark']);
    expect(sh.aoa[2].slice(4, 8)).toEqual(['Lot 4', 'Lot 6', 'Lot 8', 31]);
    expect(sh.aoa[3].slice(4, 7)).toEqual(['229 วัน', '168 วัน', '107 วัน']);
    expect(sh.aoa[4]).toEqual(['AAA0000000001', 'ที่นอน 5FT สมมติ Mattress', 'Mattress', '', 10, 5, '', 15, 'เสี่ยงมาก', '']);
    expect(sh.aoa[sh.aoa.length - 1]).toEqual(['รวม', '', '', 4, 10, 5, 12, 31, '', '']);
    expect(sh.merges).toContainEqual({ s: { r: 1, c: 4 }, e: { r: 1, c: 6 } });
    expect(sh.styles).toContainEqual([2, 4, 'st-risk']);
    expect(sh.styles).toContainEqual([4, 5, 'c-watch']);
  });

  it('ข้ามปี: หัวปีแยกช่องตามปีของ LOT', () => {
    const base = { ...BASE, piles: [
      ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอน', '0.12', '1', 3, 0],
      ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอน', '2', '1', 4, 0],
    ] };
    const s = M.scope(base, LIST, '2026-11');
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries: [], mode: 'book', locs: s.locs });
    const sh = M.sheet(rep, {});
    expect(sh.aoa[1].slice(3, 5)).toEqual(['2025', '2026']);
    expect(sh.aoa[2].slice(3, 5)).toEqual(['Lot 12', 'Lot 2']);
  });

  it('ข้อความวาง LINE บอกเกณฑ์ ชิ้น และ SKU ที่เสี่ยงสุด', () => {
    const s = book();
    const rep = M.report({ ym: '2026-11', today: '2026-11-16', list: LIST, skus: SKUS, book: s.piles, entries: [], mode: 'book', locs: s.locs });
    const t = M.lineText(rep, { ym: '2026-11' });
    expect(t).toContain('เช็คความเสี่ยง MFG พ.ย. 69 (นับ LOT 8 ลงไป)');
    expect(t).toContain('🔴 เสี่ยงมาก (LOT 5 ลงไป): 10 ชิ้น 1 SKU');
    expect(t).toContain('🟡 เฝ้าระวัง (LOT 6): 5 ชิ้น 1 SKU');
    expect(t).toContain('⚪ NO LOT ต้องตรวจสอบ: 4 ชิ้น 1 SKU');
    expect(t).toContain('• AAA001 ที่นอน 5FT สมมติ Mattress — Lot 4 10');
  });
});

describe('รอบ MFG บนสคริปต์นับสต๊อกตัวจริง', () => {
  const HEAD = 'head-secret';
  const LIST = [['AAA0000000001', 'Mattress'], ['BBB0000000001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster']];

  it('คนนับเห็นแค่โลกับ SKU ที่ต้องนับ ไม่มียอดในสมุด · ผลนับกลับมาเป็นรายงานได้', () => {
    const api = loadStocktake({ head: HEAD, count: 'nab' });
    const s = M.scope(BASE, LIST, '2026-11');
    const settings = { kind: 'mfg', ym: '2026-11', list: M.packList(LIST) };
    const id = api.post({ op: 'st-round-save', t: HEAD, round: { name: M.roundName('2026-11'), date: '2026-11-16', cutoff: '2026-11-16 08:00', settings } }).round.id;
    api.post({ op: 'st-baseline', t: HEAD, round: id, piles: s.piles, skus: s.skus, pos: s.pos, lastRow: 99, lastDate: '2026-11-15' });
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: M.teams(s.locs, 1), locs: s.locs.map((l) => [l.loc, l.zone, l.group, l.src]) });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).round.status).toBe('นับรอบ 1');

    const view = api.get({ api: 'st-round', round: id, k: 'nab' });
    expect(view.round.name).toBe('MFG พ.ย. 69 · นับ LOT 8 ลงไป');
    expect(view.locs.map((l) => l[0])).toEqual(['R1-01-01', 'R1-01-02', 'R2-01-01', 'A-01-02']);
    expect(view.skus.map((k) => k[0])).toEqual(['AAA001', 'BBB001', 'CCC001']);
    expect(JSON.stringify(view)).not.toMatch(/"piles"/);

    const item = (x) => ({ pass: 1, team: 'MFG1', who: 'สมชาย', sku: 'AAA001', long: 'AAA0000000001', po: '9900000001', type: 'นับ', at: '2026-11-16T09:00:00', ...x });
    expect(api.post({ op: 'st-count', k: 'nab', round: id, device: 'd1', items: [
      item({ uid: 'm1', loc: 'R1-01-01', lot: '4', qty: 10 }),
      item({ uid: 'm2', loc: 'R1-01-02', lot: '6', qty: 4 }),
    ] }).saved).toBe(2);

    const head = api.get({ api: 'st-head', round: id, t: HEAD });
    expect(head.round.settings).toMatchObject({ kind: 'mfg', ym: '2026-11' });
    expect(M.unpackList(head.round.settings.list)).toEqual(LIST);
    const log = api.get({ api: 'st-log', round: id, since: 0, t: HEAD }).rows.map(ST.fromRow);
    const rep = M.report({ ym: head.round.settings.ym, today: '2026-11-16', list: M.unpackList(head.round.settings.list), skus: head.skus,
      book: head.piles, entries: log, mode: 'count', locs: head.locs });
    const a = rep.rows.find((r) => r.short === 'AAA001');
    expect(a.total).toEqual({ book: 15, count: 14 });
    expect(rep.done).toBe(2);
    expect(rep.total).toBe(4);
  });
});
