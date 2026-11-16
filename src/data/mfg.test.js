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

describe('เตือน LOT ในหน้ากรอกมือถือ', () => {
  it('อ่านเดือนของรอบจากชื่อรอบ (หน้ากรอกได้แค่ชื่อ) · ชื่อรอบนับสต๊อกใหญ่ไม่ใช่ MFG', () => {
    ['2026-11', '2027-01', '2026-12'].forEach((ym) => expect(M.ymFromName(M.roundName(ym))).toBe(ym));
    expect(M.ymFromName('นับสต๊อกใหญ่ Q4')).toBe('');
    expect(M.ymFromName('MFG ทดลอง 69')).toBe('');
    expect(M.ymFromName('')).toBe('');
  });

  it('รอบ พ.ย. 69: LOT 9–11 ใหม่กว่าที่ต้องนับ · LOT 12 = ธ.ค. 68 ต้องนับ · 0 = NO LOT · อ่านไม่ออกถามก่อน', () => {
    const ym = '2026-11';
    const at = (lot) => M.lotCheck(lot, ym);
    expect(at('9')).toMatchObject({ level: 'new' });
    expect(at('9').hint).toContain('นับ LOT 8 ลงไป');
    expect(at('9').ask).toContain('ไม่ต้องนับ');
    expect(at('11').level).toBe('new');
    expect(at('8')).toEqual({ level: 'ok', hint: '✓ LOT 8 (' + M.monthText({ y: 2026, m: 8 }) + ') ต้องนับ', ask: '' });
    expect(at('12').hint).toContain(M.monthText({ y: 2025, m: 12 }));
    expect(at('12').level).toBe('ok');
    expect(at('0')).toMatchObject({ level: 'none', ask: '' });
    expect(at('ABC')).toMatchObject({ level: 'bad' });
    expect(at('ABC').ask).toContain('NO LOT');
    expect(at('13').level).toBe('bad');
    expect(at(' ')).toEqual({ level: 'blank', hint: '', ask: '' });
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

describe('เทียบกับรอบเดือนก่อน', () => {
  const LIST = [['AAA0000000001', 'Mattress'], ['BBB0000000001', 'Topper'], ['CCC0000000001', 'Pillow & Bolster'], ['EEE0000000001', 'Pet Bed']];
  const pile = (loc, i, lot, qty) => [loc, SKUS[i][0], SKUS[i][1], SKUS[i][2], lot, '9900000001', qty, 0];
  /* ต.ค. 69: เสี่ยงมาก = LOT 4 ลงไป · พ.ย. 69: เสี่ยงมาก = LOT 5 ลงไป */
  const OCT = [pile('R1-01-01', 0, '4', 20), pile('R1-01-02', 0, '6', 5), pile('R2-01-01', 1, '3', 8), pile('R3-01-01', 2, '5', 6)];
  const NOV = [pile('R1-01-01', 0, '4', 12), pile('R1-01-02', 0, '6', 5), pile('R3-01-01', 2, '5', 6), pile('A-01-01', 5, '8', 3)];
  const rep = (ym, book, list) => M.report({ ym, today: ym + '-16', list: list || LIST, skus: SKUS, book, entries: [], mode: 'book', locs: [] });

  it('รอบที่ใช้เทียบ: เดือนเก่ากว่าที่ใกล้ที่สุด เดือนเดียวกันหลายรอบเอารอบหลัง', () => {
    const rounds = [
      { id: 'A', settings: { ym: '2026-09' } }, { id: 'B', settings: { ym: '2026-10' }, at: '2026-10-05 10:00:00' },
      { id: 'C', settings: { ym: '2026-10' }, at: '2026-10-20 09:00:00' }, { id: 'D', settings: { ym: '2026-11' } }, { id: 'E', settings: { ym: '2026-12' } },
    ];
    expect(M.prevRound(rounds, rounds[3]).id).toBe('C');
    expect(M.prevRound(rounds, rounds[0])).toBeNull();
    expect(M.prevRound(rounds, { id: 'X', settings: {} })).toBeNull();
  });

  it('เพิ่งเข้าเสี่ยงมาก / ค้างเสี่ยงมาก / หลุดเสี่ยงแล้ว และ LOT เดิมลดไปกี่ชิ้น', () => {
    const c = M.compare(rep('2026-11', NOV), rep('2026-10', OCT));
    expect(c.bySku.AAA0000000001).toMatchObject({ tag: 'still', riskNow: 12, riskPrev: 20, out: 8 });
    expect(c.bySku.CCC0000000001).toMatchObject({ tag: 'new', riskNow: 6, riskPrev: 0, out: 0, prevSt: 'watch' });
    expect(c.bySku.BBB0000000001).toMatchObject({ tag: 'gone', riskNow: 0, riskPrev: 8, out: 8 });
    expect(c.bySku.EEE0000000001.tag).toBe('');
    expect(c.gone).toEqual([{ sku: 'BBB0000000001', short: 'BBB001', name: SKUS[1][2], type: 'Topper', riskPrev: 8, left: 0, out: 8, dPrev: null }]);
    expect(c.totals).toEqual({ new: { skus: 1, qty: 6 }, still: { skus: 1, qty: 12 }, gone: { skus: 1, qty: 8 }, out: 16, todo: { skus: 0, qty: 0 } });
    expect(M.cmpText(c.bySku.AAA0000000001)).toBe('ค้าง · ลด 8');
    expect(M.cmpText(c.bySku.EEE0000000001)).toBe('');
  });

  it('SKU ที่เอาออกจากรายชื่อเดือนนี้แล้ว ไม่ขึ้นว่าหลุดเสี่ยง', () => {
    const list = LIST.filter((x) => x[0] !== 'BBB0000000001');
    const c = M.compare(rep('2026-11', NOV, list), rep('2026-10', OCT), M.listMap(list, SKUS));
    expect(c.bySku.BBB0000000001).toBeUndefined();
    expect(c.totals.gone.skus).toBe(0);
  });

  it('Excel: ช่องเทียบเดือนก่อนอยู่หน้า Remark · มีชีตเทียบแยกกลุ่ม · ข้อความ LINE บอกสรุปเทียบ', () => {
    const cur = rep('2026-11', NOV);
    const c = M.compare(cur, rep('2026-10', OCT));
    const sh = M.sheet(cur, { ym: '2026-11', cmp: c });
    const n = 3 + cur.cols.length;
    expect(sh.aoa[1].slice(n, n + 4)).toEqual(['Total MFG', 'สถานะ', 'เทียบ ' + M.ymText('2026-10'), 'Remark']);
    const aaa = sh.aoa.find((r) => r[0] === 'AAA0000000001');
    expect(aaa[n + 2]).toBe('ค้าง · ลด 8');
    expect(sh.cols.length).toBe(sh.aoa[1].length);
    const plain = M.sheet(cur, { ym: '2026-11' });
    expect(plain.aoa[1].length).toBe(sh.aoa[1].length - 1);

    const cs = M.compareSheet(c, cur);
    expect(cs.aoa.slice(2).map((r) => [r[0], r[1], r[4], r[5], r[6]])).toEqual([
      ['เพิ่งเข้าเสี่ยงมาก', 'CCC0000000001', '', 6, ''],
      ['ค้างเสี่ยงมาก', 'AAA0000000001', 20, 12, 8],
      ['หลุดเสี่ยงแล้ว', 'BBB0000000001', 8, '', 8],
      ['รวม', '', '', '', 16],
    ]);

    const text = M.lineText(cur, { ym: '2026-11', cmp: c });
    expect(text).toContain('เพิ่งเข้าเสี่ยงมาก 1 SKU (6 ชิ้น)');
    expect(text).toContain('หลุดเสี่ยงแล้ว 1 SKU');
    expect(text).toContain('ลดไป 16 ชิ้น');
    expect(M.lineText(cur, { ym: '2026-11' })).not.toContain('เทียบ');
  });

  it('คำตัดสิน: เก็บแบบย่อ ใส่แต่หมายเหตุ = อื่นๆ เลือกว่าง = ลบ', () => {
    const raw = M.applyDecide({ aaa0000000001: ['wait', 'ดูเดือนหน้า', 'สมชาย', '2026-11-16 10:00'], X: ['bogus', ''] }, {
      BBB0000000001: ['', '  โอนไป   สาขา  ', 'สมศรี', '2026-11-16 11:00'],
      CCC0000000001: ['open', 'x'.repeat(80), 'สมศรี', '2026-11-16 11:00'],
    });
    expect(Object.keys(raw).sort()).toEqual(['AAA0000000001', 'BBB0000000001', 'CCC0000000001']);
    expect(raw.BBB0000000001.slice(0, 2)).toEqual(['other', 'โอนไป สาขา']);
    expect(raw.CCC0000000001[1].length).toBe(M.NOTE_MAX);
    expect(Object.keys(M.applyDecide(raw, { AAA0000000001: null, BBB0000000001: ['', '', 'ก', ''] }))).toEqual(['CCC0000000001']);
    const map = M.decideOf(raw);
    expect(map.AAA0000000001).toEqual({ code: 'wait', note: 'ดูเดือนหน้า', by: 'สมชาย', at: '2026-11-16 10:00' });
    expect(M.decideText(map.AAA0000000001)).toBe('รอเดือนหน้า · ดูเดือนหน้า');
    expect(M.decideText(map.BBB0000000001)).toBe('โอนไป สาขา');
    expect(M.decideText(null)).toBe('');
    expect(M.decideOf('เสีย')).toEqual({});
  });

  it('สรุปคำตัดสิน กับชิปกรอง: SKU เสี่ยงมากที่ยังไม่ตัดสิน', () => {
    const cur = rep('2026-11', NOV);
    const map = M.decideOf({ AAA0000000001: ['open', 'แกะขายหน้าร้าน', 'ก', ''], EEE0000000001: ['wait', '', 'ก', ''] });
    const s = M.decideSum(cur, map);
    expect(s.any).toBe(true);
    expect([s.open.skus, s.open.qty, s.wait.skus, s.wait.qty, s.none.skus]).toEqual([1, 17, 1, 3, 1]);
    expect(s.none.list.map((x) => x.short)).toEqual(['CCC001']);
    expect(M.byDecide(cur.rows, map, 'none').map((r) => r.short)).toEqual(['CCC001']);
    expect(M.byDecide(cur.rows, map, 'open').map((r) => r.short)).toEqual(['AAA001']);
    expect(M.byDecide(cur.rows, map, '').length).toBe(cur.rows.length);
    expect(M.decideSum(cur, {}).any).toBe(false);
  });

  it('เดือนถัดไป: สั่งแกะแล้วแต่ LOT เดิมยังเหลือ = ยังค้าง · ลงช่อง Excel ชีตเทียบ และข้อความ LINE', () => {
    const prevDec = M.decideOf({ AAA0000000001: ['open', '', 'ก', ''], BBB0000000001: ['sell', '', 'ก', ''], CCC0000000001: ['wait', '', 'ก', ''] });
    const cur = rep('2026-11', NOV);
    const c = M.compare(cur, rep('2026-10', OCT), null, prevDec);
    expect(c.bySku.AAA0000000001).toMatchObject({ held: 12, todo: true });
    expect(c.bySku.BBB0000000001).toMatchObject({ held: 0, todo: false });
    expect(c.bySku.CCC0000000001).toMatchObject({ todo: false });
    expect(c.bySku.CCC0000000001.dPrev.code).toBe('wait');
    expect(c.totals.todo).toEqual({ skus: 1, qty: 12 });
    expect(c.gone[0].dPrev.code).toBe('sell');
    expect(M.prevDecText(c.bySku.AAA0000000001)).toBe('แกะ · ยังค้าง 12');

    const map = M.decideOf({ AAA0000000001: ['open', 'รอบสอง', 'ก', ''] });
    const sh = M.sheet(cur, { ym: '2026-11', cmp: c, decide: map });
    const n = 3 + cur.cols.length;
    const aaa = sh.aoa.find((r) => r[0] === 'AAA0000000001');
    expect(aaa[n + 2]).toBe('ค้าง · ลด 8 · เดือนก่อน: แกะ · ยังค้าง 12');
    expect(aaa[n + 3]).toBe('แกะ · รอบสอง');
    expect(sh.styles).toContainEqual([sh.aoa.indexOf(aaa), n + 2, 'c-todo']);
    expect(M.sheet(cur, { ym: '2026-11' }).aoa.find((r) => r[0] === 'AAA0000000001').pop()).toBe('');

    const cs = M.compareSheet(c, cur);
    expect(cs.aoa[1][7]).toBe('เดือนก่อนสั่ง');
    expect(cs.aoa.find((r) => r[1] === 'AAA0000000001')[7]).toBe('แกะ · ยังค้าง 12');
    expect(cs.aoa.find((r) => r[1] === 'BBB0000000001')[7]).toBe('ขายด่วน');
    expect(cs.aoa[cs.aoa.length - 1][7]).toBe('สั่งแล้วยังค้าง 1 SKU');
    expect(cs.cols.length).toBe(cs.aoa[1].length);

    const text = M.lineText(cur, { ym: '2026-11', cmp: c, decide: map });
    expect(text).toContain('⚠️ เดือนก่อนสั่งแกะ/ขายด่วน แต่ยังค้าง 1 SKU (12 ชิ้น): AAA001 12');
    expect(text).toContain('คำตัดสิน:');
    expect(text).toContain('✂️ แกะ 1 SKU (17 ชิ้น): AAA001 (รอบสอง)');
    expect(text).toContain('❓ เสี่ยงมากที่ยังไม่ตัดสิน 1 SKU');
    expect(M.lineText(cur, { ym: '2026-11', decide: {} })).not.toContain('คำตัดสิน');
  });

  it('การ์ดรูปให้เจ้านาย: สามกล่องบน แยกประเภท เสี่ยงมาก LOT เก่าสุดก่อน คำตัดสิน และเทียบเดือนก่อน', () => {
    const prevDec = M.decideOf({ AAA0000000001: ['open', '', 'ก', ''] });
    const cur = rep('2026-11', NOV);
    const c = M.compare(cur, rep('2026-10', OCT), null, prevDec);
    const map = M.decideOf({ AAA0000000001: ['open', 'รอบสอง', 'ก', ''] });
    const k = M.card(cur, { ym: '2026-11', at: '16/11/2569 10:00', cmp: c, decide: map });
    expect(k.title).toBe('ความเสี่ยง MFG ' + M.ymText('2026-11'));
    expect([k.status, k.partial, k.total]).toEqual(['ยอดในสมุด (ยังไม่ได้นับ)', true, 26]);
    /* เสี่ยงมาก 18 ชิ้น เดือนก่อน 28 (AAA 20 + BBB 8) = ลด 36% · ไม่มี NO LOT กล่องที่สามเป็น ปกติ */
    expect(k.tiles.map((t) => [t.k, t.skus, t.qty])).toEqual([['risk', 2, 18], ['watch', 1, 5], ['ok', 1, 3]]);
    expect([k.tiles[0].prev, k.tiles[0].pct]).toEqual([28, -36]);
    expect(k.types.map((t) => [t.type, t.risk, t.watch, t.ok, t.total])).toEqual([
      ['Mattress', 12, 5, 0, 17], ['Pillow & Bolster', 6, 0, 0, 6], ['Pet Bed', 0, 0, 3, 3],
    ]);
    const lot4 = cur.cols.find((x) => x.label === 'Lot 4');
    expect(k.top.map((t) => [t.sku, t.lot, t.qty, t.total, t.dec, t.todo])).toEqual([
      ['AAA001', 'Lot 4', 12, 17, 'แกะ', true], ['CCC001', 'Lot 5', 6, 6, '', false],
    ]);
    expect(k.top[0].age).toBe(lot4.age);
    expect([k.more, k.riskSkus]).toEqual([0, 2]);
    expect(k.decide).toEqual({ list: [{ k: 'open', label: 'แกะ', skus: 1, qty: 17 }], none: 1 });
    expect(k.cmp).toEqual({ prev: M.ymText('2026-10'), new: 1, still: 1, gone: 1, out: 16, todo: { skus: 1, qty: 12, list: ['AAA001'] } });

    const plain = M.card(cur, { ym: '2026-11', top: 1 });
    expect([plain.cmp, plain.decide, plain.tiles[0].pct, plain.more]).toEqual([null, null, undefined, 1]);
    expect(M.decideShort({ code: 'other', note: 'โอนสาขา' })).toBe('โอนสาขา');
    expect(M.decideShort({ code: 'other', note: '' })).toBe('อื่นๆ');
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

  it('คำตัดสินบันทึกในค่าตั้งของรอบได้หลังปิดรับผลนับ ไม่ต้องแก้สคริปต์ ค่าตั้งเดิมอยู่ครบ', () => {
    const api = loadStocktake({ head: HEAD, count: 'nab' });
    const s = M.scope(BASE, LIST, '2026-11');
    const settings = { kind: 'mfg', ym: '2026-11', list: M.packList(LIST) };
    const id = api.post({ op: 'st-round-save', t: HEAD, round: { name: M.roundName('2026-11'), date: '2026-11-16', cutoff: '2026-11-16 08:00', settings } }).round.id;
    api.post({ op: 'st-baseline', t: HEAD, round: id, piles: s.piles, skus: s.skus, pos: s.pos, lastRow: 99, lastDate: '2026-11-15' });
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: M.teams(s.locs, 1), locs: s.locs.map((l) => [l.loc, l.zone, l.group, l.src]) });
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).round.status).toBe('วิเคราะห์');

    /* แบบที่หน้าเว็บทำ: อ่านค่าตั้งล่าสุด ใส่คำตัดสินทับ แล้วบันทึกรอบเดิม */
    const fresh = api.get({ api: 'st-rounds', t: HEAD }).rounds.find((x) => x.id === id);
    const decide = M.applyDecide(fresh.settings.decide, { AAA0000000001: ['open', 'แกะ 5 ชิ้นก่อน', 'หัวหน้า', '2026-11-20 10:00'] });
    const saved = api.post({ op: 'st-round-save', t: HEAD, by: 'หัวหน้า', round: { id, name: fresh.name, date: fresh.date, cutoff: fresh.cutoff, settings: { ...fresh.settings, decide } } });
    expect(saved.error).toBeUndefined();

    const head = api.get({ api: 'st-head', round: id, t: HEAD });
    expect(head.round.status).toBe('วิเคราะห์');
    expect(head.round.settings).toMatchObject({ kind: 'mfg', ym: '2026-11' });
    expect(M.unpackList(head.round.settings.list)).toEqual(LIST);
    expect(M.decideOf(head.round.settings.decide).AAA0000000001).toMatchObject({ code: 'open', note: 'แกะ 5 ชิ้นก่อน' });
  });
});
