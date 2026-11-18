/**
 * สมุดสต๊อก ขั้น 2: ย้าย/เติม/QA กับคืนของ (public/wms-book.js) และ bk-move / bk-find / bk-return ของ apps-script/book-api.gs
 *
 * สิ่งที่ต้องไม่พัง: ย้ายของที่ไม่มีอยู่จริงที่โลต้นทาง ย้ายแล้ว LOT/PO หาย คืนของเกินที่ตัด คืนผิดกอง
 * และชุดที่บันทึกแล้วถูกนับว่าวางในชีตเดิมแล้วทั้งที่ยังไม่ได้วาง (จะทำให้หักกองซ้ำหรือไม่หัก)
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadBook } from '../dev/fake-gas.js';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-book.js'), 'utf8');

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

const pick = (rows) => rows.map((r) => [r.lot, r.po, r.from, r.to, r.qty, r.status, r.note]);

/* ── ย้าย ──────────────────────────────────────────────────────────────── */

describe('ย้าย / เติม / QA', () => {
  const res = (sup) => fifo([
    { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 2, d: '2026-10-01', open: 1 },
    { s: 0, lot: 8, po: 'P1', to: 'R01-01-01', qty: 10, d: '2026-10-01' },
    { s: 0, lot: 9, po: 'P2', to: 'R01-02-01', qty: 10, d: '2026-10-09' },
    { s: 0, lot: 9, po: 'P2', to: 'QA', qty: 3, d: '2026-10-09' },
    { s: 0, lot: 7, po: 'P0', to: 'QA', qty: 1, d: '2026-09-01' },
  ], sup ? { sup: { rows: sup } } : {});

  it('กองที่ QA อยู่ในกองทั้งหมดของ SKU (ตัดขายยังไม่เห็น) และรู้ว่าโลไหนเคยมีในสมุด', () => {
    const st = B.stock(res());
    expect(st.all[0].map((p) => `${p.loc}:${p.qty}`)).toEqual(['QA:1', 'A-01-01:2', 'R01-01-01:10', 'QA:3', 'R01-02-01:10']);
    expect(st.open[0].map((p) => p.loc)).toEqual(['A-01-01']);
    expect(st.known('r01-01-01')).toBe(true);
    expect(st.known('ORDER')).toBe(false);
  });

  it('ย้ายออกจาก QA ไม่บอก LOT: เอากองที่ QA ตามลำดับ FIFO แบ่งสองกอง ไปว่าง = โลที่เปิดขาย Note โอนย้าย QA', () => {
    const plan = B.planMoves([{ sku: 'aaa001', from: 'qa', qty: '4' }], B.stock(res()));
    expect(plan.lines[0]).toMatchObject({ st: 'ok', from: 'QA', to: 'A-01-01', autoTo: true });
    expect(pick(plan.rows)).toEqual([
      ['7', 'P0', 'QA', 'A-01-01', 1, 'เปิด', 'โอนย้าย QA'],
      ['9', 'P2', 'QA', 'A-01-01', 3, 'เปิด', 'โอนย้าย QA'],
    ]);
    expect(plan.total).toMatchObject({ rows: 2, qty: 4, ok: 1, bad: 0, lines: 1 });
  });

  it('เติมของ ใส่แค่ SKU กับชิ้น: เอาของสำรองที่ R กองเก่าสุด ของไม่พอบอกว่ามีเท่าไร', () => {
    const st = B.stock(res());
    expect(pick(B.planMoves([{ sku: 'AAA0000000001', qty: 12 }], st).rows)).toEqual([
      ['8', 'P1', 'R01-01-01', 'A-01-01', 10, 'เปิด', 'โอนย้าย'],
      ['9', 'P2', 'R01-02-01', 'A-01-01', 2, 'เปิด', 'โอนย้าย'],
    ]);
    const short = B.planMoves([{ sku: 'AAA001', qty: 25 }], st);
    expect(short.lines[0]).toMatchObject({ st: 'bad', why: 'ของสำรองที่ R มี 20 ชิ้น' });
    expect(short.rows).toEqual([]);
    expect(B.planMoves([{ sku: 'AAA001', from: 'R01-02-01', lot: '8', qty: 1 }], st).lines[0].why).toBe('ที่ R01-02-01 (LOT 8) มี 0 ชิ้น');
  });

  it('สถานะตามโลปลายทาง: QA R ทางเดิน ไม่เปิด โลขายเปิด พิมพ์ - ให้ไม่เปิดได้', () => {
    const st = B.stock(res());
    const plan = B.planMoves([
      { sku: 'AAA001', from: 'A-01-01', to: 'QA', qty: 1 },
      { sku: 'AAA001', from: 'R01-01-01', to: 'WALKWAY', qty: 1 },
      { sku: 'AAA001', from: 'R01-01-01', to: 'B-01-01', qty: 1, status: '-' },
      { sku: 'AAA001', from: 'R01-01-01', to: 'R02-01-01', qty: 1, status: 'เปิด' },
    ], st);
    expect(plan.rows.map((r) => [r.to, r.status, r.note])).toEqual([
      ['QA', '', 'โอนย้าย QA'], ['WALKWAY', '', 'โอนย้าย'], ['B-01-01', '', 'โอนย้าย'], ['R02-01-01', 'เปิด', 'โอนย้าย']]);
  });

  it('แถวหลังในชุดเดียวกันย้ายต่อจากโลที่แถวก่อนเพิ่งย้ายเข้าได้ แถวก่อนหักกองไปแล้ว โลใหม่ขึ้นเตือน', () => {
    const st = B.stock(res());
    const plan = B.planMoves([
      { sku: 'AAA001', from: 'QA', to: 'ORDER', qty: 3, lot: 9 },
      { sku: 'AAA001', from: 'ORDER', to: 'S-01-01', qty: 2 },
      { sku: 'AAA001', from: 'QA', qty: 2 },
    ], st);
    expect(plan.lines.map((o) => o.st)).toEqual(['ok', 'ok', 'bad']);
    expect(pick(plan.rows)).toEqual([
      ['9', 'P2', 'QA', 'ORDER', 3, 'เปิด', 'โอนย้าย QA'],
      ['9', 'P2', 'ORDER', 'S-01-01', 2, 'เปิด', 'โอนย้าย'],
    ]);
    expect(plan.lines[0].warn[0]).toMatch(/ORDER ไม่เคยมีในสมุด/);
    expect(plan.lines[2].why).toBe('ที่ QA มี 1 ชิ้น');
  });

  it('แถวผิด: SKU ไม่รู้จัก ไม่ใส่ชิ้น ต้นทางเท่าปลายทาง แถวว่างไม่นับ', () => {
    const plan = B.planMoves([
      { sku: 'ZZZ999', from: 'QA', qty: 1 }, { sku: 'AAA001', from: 'QA' }, { sku: 'AAA001', from: 'A-01-01', to: 'a-01-01', qty: 1 }, {},
      { sku: 'CCC004', from: 'R01-01-01', qty: 1 },
    ], B.stock(res()));
    expect(plan.lines.map((o) => [o.st, o.why])).toEqual([
      ['bad', 'ไม่รู้จัก SKU นี้'], ['bad', 'ใส่ชิ้น'], ['bad', 'ต้นทางกับปลายทางเป็นที่เดียวกัน'], ['blank', ''],
      ['bad', 'SKU นี้ไม่มีโลเปิดขาย ใส่โลปลายทาง']]);
    expect(plan.total).toMatchObject({ lines: 4, bad: 4, ok: 0 });
  });

  it('เติมของเลือก Supplier เดียวกับที่เปิดขายก่อน แม้มีกองเก่ากว่าของอีก Supplier ย้ายอีก Supplier เข้าโลขายขึ้นเตือน', () => {
    const r = fifo([
      { s: 0, lot: 9, po: 'P9', to: 'A-01-01', qty: 2, d: '2026-10-09', open: 1 },
      { s: 0, lot: 8, po: 'P8', to: 'R01-01-01', qty: 5, d: '2026-10-01' },
      { s: 0, lot: 9, po: 'P9', to: 'R01-02-01', qty: 5, d: '2026-10-09' },
    ], { sup: { rows: [['P8', 'ผู้ผลิต ข'], ['P9', 'ผู้ผลิต ก']] } });
    const st = B.stock(r);
    expect(pick(B.planMoves([{ sku: 'AAA001', qty: 3 }], st).rows)).toEqual([['9', 'P9', 'R01-02-01', 'A-01-01', 3, 'เปิด', 'โอนย้าย']]);
    const mix = B.planMoves([{ sku: 'AAA001', from: 'R01-01-01', qty: 1 }], st);
    expect(mix.lines[0].warn).toEqual(['เปิดสอง Supplier พร้อมกัน (ผู้ผลิต ก / ผู้ผลิต ข)']);
  });

  it('แถวที่คัดลอกของการย้ายตรงคอลัมน์ A–N: F โลเบิก G โลรับ I เบิก J โอนย้าย K สถานะ', () => {
    const plan = B.planMoves([{ sku: 'AAA001', qty: 5 }], B.stock(res()));
    const copy = B.moveCopy(plan);
    expect(copy).toEqual([['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 5, 'เบิก', 'โอนย้าย', 'เปิด']]);
    expect(B.tsv(copy, 'ทดลอง', 'T2611-0009').split('\t')).toEqual(
      ['AAA001', '', '', '8', 'P1', 'R01-01-01', 'A-01-01', '5', 'เบิก', 'โอนย้าย', 'เปิด', '', 'ทดลอง', 'T2611-0009']);
    /* ยังไม่วาง: หักต้นทาง เพิ่มปลายทาง */
    const st2 = B.stock(res(), copy);
    expect(st2.open[0].map((p) => `${p.lot}/${p.loc}:${p.qty}`)).toEqual(['8/A-01-01:7']);
    expect(st2.reserve[0].map((p) => `${p.loc}:${p.qty}`)).toEqual(['R01-01-01:5', 'R01-02-01:10']);
  });
});

/* ── คืนของ ────────────────────────────────────────────────────────────── */

describe('คืนของ', () => {
  const res = () => fifo([
    { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 2, d: '2026-10-01', open: 1 },
    { s: 3, lot: 8, po: 'P3', to: 'S-01-01', qty: 9, d: '2026-10-01', open: 1 },
  ]);
  const hit = (over = {}) => ({ sys: 'JST', order: '1001', ref: 'R1001', track: 'TH1', sku: 'AAA0000000001', qty: 3, date: '2026-11-10',
    doc: 'T2611-0001', piles: [['A-01-01', '8', 'P1', 2], ['A-01-01', '9', 'P2', 1]], back: 0, ...over });

  it('เจอออเดอร์ในบันทึกตัด ไม่ใส่ SKU ไม่ใส่ชิ้น: คืนทั้งบรรทัดเข้า LOT/PO เดิม ไล่จากกองท้าย ไปโลที่เปิดขาย', () => {
    const plan = B.planReturns([{ key: '1001' }], { found: { 1001: [hit()] } }, B.stock(res()));
    expect(plan.lines[0].st).toBe('ok');
    expect(pick(plan.rows)).toEqual([['9', 'P2', '', 'A-01-01', 1, 'เปิด', 'RETURN'], ['8', 'P1', '', 'A-01-01', 2, 'เปิด', 'RETURN']]);
    expect(plan.save).toEqual([{ sys: 'JST', order: '1001', ref: 'R1001', track: 'TH1', sku: 'AAA0000000001', qty: 3, cut: 'T2611-0001', cutQty: 3,
      piles: [['A-01-01', '9', 'P2', 1], ['A-01-01', '8', 'P1', 2]] }]);
    expect(B.returnCopy(plan)[0]).toEqual(['AAA001', 'AAA0000000001', '9', 'P2', '', 'A-01-01', 1, 'รับ', 'RETURN', 'เปิด']);
  });

  it('คืนไปแล้วบางส่วน: ข้ามชิ้นที่คืนแล้วจากกองท้าย คืนเกินที่ตัดเป็นแถวผิด แถวก่อนหน้าในชุดนับด้วย', () => {
    const st = B.stock(res());
    const look = { found: { 1001: [hit({ back: 1 })] } };
    expect(pick(B.planReturns([{ key: '1001' }], look, st).rows)).toEqual([['8', 'P1', '', 'A-01-01', 2, 'เปิด', 'RETURN']]);
    expect(B.planReturns([{ key: '1001', qty: 3 }], look, st).lines[0].why).toBe('คืนเกินที่ตัด (ตัด 3 คืนแล้ว 1)');
    const two = B.planReturns([{ key: '1001', qty: 1 }, { key: '1001', qty: 2 }], look, st);
    expect(two.lines.map((o) => o.st)).toEqual(['ok', 'bad']);
    expect(two.lines[1].why).toBe('คืนเกินที่ตัด (ตัด 3 คืนแล้ว 2)');
    expect(B.planReturns([{ key: '1001' }], { found: { 1001: [hit({ back: 3 })] } }, st).lines[0].why).toBe('คืนครบแล้ว (ตัด 3 ชิ้น)');
  });

  it('ออเดอร์มีหลาย SKU: ไม่ใส่ SKU คืนทั้งออเดอร์ ใส่ชิ้นต้องบอก SKU ด้วย ใส่ SKU คืนเฉพาะตัวนั้น', () => {
    const st = B.stock(res());
    const look = { found: { 1001: [hit(), hit({ sku: 'CCC0000000004', qty: 1, piles: [['S-01-01', '8', 'P3', 1]] })] } };
    expect(B.planReturns([{ key: '1001' }], look, st).rows.map((r) => [r.sku, r.lot, r.to, r.qty])).toEqual([
      ['AAA001', '9', 'A-01-01', 1], ['AAA001', '8', 'A-01-01', 2], ['CCC004', '8', 'S-01-01', 1]]);
    expect(B.planReturns([{ key: '1001', qty: 1 }], look, st).lines[0].why).toBe('ออเดอร์นี้มี 2 SKU ใส่ SKU ด้วย');
    expect(B.planReturns([{ key: '1001', sku: 'ccc004', qty: 1 }], look, st).rows.map((r) => r.sku)).toEqual(['CCC004']);
    expect(B.planReturns([{ key: '1001', sku: 'BBB002' }], look, st).lines[0].why).toBe('ออเดอร์นี้ไม่มี SKU BBB002');
  });

  it('ไม่เจอในบันทึกตัด (ตัดด้วยมือ): ต้องใส่ SKU กับชิ้น คืนเป็น LOT 0 / PO 0 · โลที่ใส่เองใช้ตามนั้น QA ไม่เปิด', () => {
    const st = B.stock(res());
    const look = { found: {}, miss: { 2002: 1 } };
    expect(B.planReturns([{ key: '2002' }], look, st).lines[0].why).toMatch(/ไม่พบออเดอร์นี้ในบันทึกตัด/);
    const plan = B.planReturns([{ key: '2002', sku: 'AAA001', qty: 1 }, { sku: 'CCC004', qty: 2, to: 'qa', note: 'm/e-00304' }], look, st);
    expect(plan.lines.map((o) => [o.st, o.lot0])).toEqual([['ok', true], ['ok', true]]);
    expect(pick(plan.rows)).toEqual([['0', '0', '', 'A-01-01', 1, 'เปิด', 'RETURN'], ['0', '0', '', 'QA', 2, '', 'M/E-00304']]);
    expect(plan.save.map((l) => [l.order, l.cut, l.piles])).toEqual([['2002', '', [['A-01-01', '0', '0', 1]]], ['', '', [['QA', '0', '0', 2]]]]);
    expect(plan.lines[0].warn).toEqual(['ไม่พบในบันทึกตัด คืนเป็น LOT 0 / PO 0']);
  });

  it('เลขที่ยังไม่ได้หา รอก่อน ไม่ลงสมุด · เลขที่ต้องหาไม่ซ้ำ ตัวพิมพ์ใหญ่', () => {
    const input = [{ key: 'th1' }, { key: 'TH1' }, { key: '1001' }, {}];
    const plan = B.planReturns(input, { found: { 1001: [hit()] } }, B.stock(res()));
    expect(plan.lines.map((o) => o.st)).toEqual(['wait', 'wait', 'ok', 'blank']);
    expect(plan.total).toMatchObject({ lines: 3, ok: 1, wait: 2 });
    expect(B.lookKeys(input, { found: { 1001: [] } })).toEqual(['TH1']);
  });
});

/* ── ชุดที่วางแล้ว ─────────────────────────────────────────────────────── */

describe('ชุดไหนวางในชีตเดิมแล้ว (ทุกประเภท)', () => {
  const mv = ['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 5, 'เบิก', 'โอนย้าย', 'เปิด'];
  const rt = ['AAA001', 'AAA0000000001', '0', '0', '', 'A-01-01', 1, 'รับ', 'RETURN', 'เปิด'];

  it('แถวย้ายกับแถวคืนไม่มีวันที่ นับเฉพาะแถวที่อยู่ล่างกว่าแถวสมุดตอนบันทึก แถวย้ายเก่าหน้าตาเดียวกันไม่นับ', () => {
    const res = fifo([
      { row: 100, s: 0, lot: 8, po: 'P1', from: 'R01-01-01', to: 'A-01-01', qty: 5, t: 'เบิก', open: 1 },   // ย้ายแบบเดียวกันเมื่อเดือนก่อน
      { row: 905, s: 0, lot: 8, po: 'P1', from: 'R01-01-01', to: 'A-01-01', qty: 5, t: 'เบิก', open: 1 },   // ชุด a ที่วางแล้ว
      { row: 906, s: 0, lot: '0', po: '0', to: 'A-01-01', qty: 1, open: 1, flag: 32 },
    ]);
    const a = { doc: 'T1', at: '2026-11-10 09:00:00', status: '', base: 900, copy: [mv, rt] };
    const b = { doc: 'T2', at: '2026-11-10 10:00:00', status: '', base: 900, copy: [mv] };
    const old = { doc: 'T0', at: '2026-11-09 10:00:00', status: '', copy: [mv] };   // รุ่น 1 ไม่รู้ base
    const r = B.reflect(res, [b, a, old]);
    expect(r.done.map((d) => d.doc)).toEqual(['T1']);
    expect(r.wait.map((d) => d.doc)).toEqual(['T0', 'T2']);
    expect(B.lastRow(res)).toBe(906);
  });

  it('แถวในชีตที่ถูกลบหลังบันทึก: แถวที่วางอยู่สูงกว่าแถวตอนบันทึกไม่เกิน 200 แถวยังนับ', () => {
    const res = fifo([{ row: 750, s: 0, lot: 8, po: 'P1', from: 'R01-01-01', to: 'A-01-01', qty: 5, t: 'เบิก' }]);
    expect(B.reflect(res, [{ doc: 'T1', at: '2026-11-10 09:00:00', base: 900, copy: [mv] }]).done).toHaveLength(1);
    expect(B.reflect(res, [{ doc: 'T1', at: '2026-11-10 09:00:00', base: 1000, copy: [mv] }]).done).toHaveLength(0);
  });
});

/* ── book-api.gs ──────────────────────────────────────────────────────── */

describe('book-api.gs ขั้น 2', () => {
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
  const mvRow = (over = {}) => Object.assign(['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 5, 'เบิก', 'โอนย้าย', 'เปิด'], over);
  const sale = (order, qty, piles, extra = {}) => ({ sys: 'JST', order, ref: 'ON' + order, track: 'TH' + order, sku: 'AAA0000000001', qty, piles, ...extra });
  function cut(api, batch, lines) {
    const copy = [];
    lines.forEach((l) => l.piles.forEach((p) => copy.push(['AAA001', 'AAA0000000001', p[1], p[2], p[0], '', p[3], 'ขาย', '2026-11-10', 'เปิด'])));
    return api.post({ op: 'bk-cut', ...me, batch, date: '2026-11-10', base: 500, lines, copy });
  }
  const logFile = (api) => api.files.get(api.props.get('log|2026Q4'));

  it('บันทึกชุดย้าย: เลขที่ชุดเดียวกับตัดขาย แถวลงแท็บแถวที่คัดลอก จำแถวสมุดตอนบันทึก ส่งซ้ำได้เลขเดิม', () => {
    const api = setup();
    cut(api, 'c-1', [sale('1', 1, [['A-01-01', '8', 'P1', 1]])]);
    const r = api.post({ op: 'bk-move', ...me, batch: 'm-1', date: '2026-11-10', base: 812, copy: [mvRow(), mvRow({ 2: '9', 3: 'P2', 6: 2 })] });
    expect(r).toMatchObject({ doc: 'T2611-0002', rows: 2, qty: 7 });
    expect(api.post({ op: 'bk-move', ...me, batch: 'm-1', date: '2026-11-10', copy: [mvRow()] })).toMatchObject({ doc: 'T2611-0002', again: true });
    const docs = api.ss.getSheetByName('เลขที่เอกสาร').grid;
    expect(docs[2].slice(0, 9)).toEqual(['T2611-0002', 'ย้าย', '2026-11-10', 'ทดลอง', '2026-11-10 10:00:00', 2, 7, 0, '']);
    expect(docs[2].slice(13)).toEqual(['', '@3+2', 812]);
    const recent = api.post({ op: 'bk-recent', ...me, days: 2 });
    expect(recent.docs.map((d) => [d.doc, d.type, d.base, d.copy.length])).toEqual([['T2611-0002', 'ย้าย', 812, 2], ['T2611-0001', 'ตัดขาย', 500, 1]]);
    expect(recent.docs[0].copy[1]).toEqual(['AAA001', 'AAA0000000001', '9', 'P2', 'R01-01-01', 'A-01-01', 2, 'เบิก', 'โอนย้าย', 'เปิด']);
  });

  it('ชุดย้ายที่แถวไม่ถูก ไม่รับทั้งชุด ไม่เขียนอะไร', () => {
    const api = setup();
    const bad = (row) => api.post({ op: 'bk-move', ...me, batch: 'x', date: '2026-11-10', copy: [mvRow(), row] });
    expect(bad(mvRow({ 5: 'R01-01-01' })).bad[0].why).toBe('โลเบิกกับโลรับเป็นที่เดียวกัน');
    expect(bad(mvRow({ 5: '' })).bad[0].why).toBe('ต้องมีทั้งโลเบิกและโลรับ');
    expect(bad(mvRow({ 7: 'ขาย' })).bad[0].why).toBe('ประเภทต้องเป็น เบิก');
    expect(bad(mvRow({ 8: 'RETURN' })).bad[0].why).toMatch(/Note ต้องเป็น/);
    expect(bad(mvRow({ 9: 'ปิด' })).bad[0].why).toMatch(/Status/);
    expect(bad(mvRow({ 3: '' })).bad[0].why).toBe('ไม่มี LOT หรือ PO');
    expect(bad(mvRow({ 6: 0 })).bad[0].why).toMatch(/ชิ้น/);
    expect(api.ss.getSheetByName('เลขที่เอกสาร').getLastRow()).toBe(1);
  });

  it('ชุดตัดขายใหญ่ (1,200 แถว) บันทึกได้ ไม่ติดขีด 50,000 ตัวอักษรต่อช่อง', () => {
    const api = setup();
    const lines = Array.from({ length: 1200 }, (_, i) => sale(String(10000 + i), 1, [[`A-${String(i).padStart(4, '0')}`, '8', '2603000075', 1]]));
    expect(cut(api, 'big', lines)).toMatchObject({ doc: 'T2611-0001', rows: 1200 });
    expect(api.post({ op: 'bk-recent', ...me, days: 1 }).docs[0].copy).toHaveLength(1200);
  });

  it('ชุดของรุ่น 1 (แถวที่คัดลอกเป็น JSON ในช่องเดียว) ยังอ่านได้', () => {
    const api = setup();
    api.ctx.setup();
    const t = api.ss.getSheetByName('เลขที่เอกสาร');
    t.getRange(2, 1, 1, 15).setValues([['T2611-0001', 'ตัดขาย', '2026-11-10', 'ทดลอง', '2026-11-10 09:00:00', 1, 2, 1, '', '', '', '', 'old',
      '2026-11', JSON.stringify([['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'ขาย', '2026-11-10', 'เปิด']])]]);
    const d = api.post({ op: 'bk-recent', ...me, days: 1 }).docs[0];
    expect(d).toMatchObject({ doc: 'T2611-0001', base: 0 });
    expect(d.copy[0][6]).toBe(2);
    expect(api.post({ op: 'bk-move', ...me, batch: 'm', date: '2026-11-10', copy: [mvRow()] }).doc).toBe('T2611-0002');
  });

  it('หาออเดอร์: จากเลขออเดอร์ เลขอ้างอิง หรือเลขพัสดุ (ตัวพิมพ์เล็กก็ได้) บอกกองที่ตัด ชุดที่ยกเลิกไม่เจอ', () => {
    const api = setup();
    cut(api, 'c-1', [sale('1001', 3, [['A-01-01', '8', 'P1', 2], ['A-01-01', '9', 'P2', 1]]), sale('1002', 1, [['A-01-01', '8', 'P1', 1]])]);
    cut(api, 'c-2', [sale('1003', 1, [['A-01-01', '8', 'P1', 1]])]);
    api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'ผิด' });
    const r = api.post({ op: 'bk-find', ...me, date: '2026-11-10', keys: ['1001', 'on1002', 'th1001', '1003', '9999'] });
    expect(Object.keys(r.found).sort()).toEqual(['1001', 'ON1002', 'TH1001']);
    expect(r.found['1001'][0]).toEqual({ sys: 'JST', order: '1001', ref: 'ON1001', track: 'TH1001', sku: 'AAA0000000001', qty: 3, date: '2026-11-10',
      doc: 'T2611-0001', piles: [['A-01-01', '8', 'P1', 2], ['A-01-01', '9', 'P2', 1]], back: 0 });
    expect(r.miss.sort()).toEqual(['1003', '9999']);
    expect(r.months).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(api.opened.every((id) => id === api.props.get('log|2026Q4'))).toBe(true);
  });

  it('บันทึกคืน: ลงแท็บเดือน คืน ในไฟล์ไตรมาส หาซ้ำเห็นชิ้นที่คืนแล้ว คืนเกินที่ตัดไม่รับทั้งชุด ยกเลิกชุดคืนแล้วคืนใหม่ได้', () => {
    const api = setup();
    cut(api, 'c-1', [sale('1001', 3, [['A-01-01', '8', 'P1', 2], ['A-01-01', '9', 'P2', 1]])]);
    const line = (qty, piles) => ({ sys: 'JST', order: '1001', ref: 'ON1001', track: 'TH1001', sku: 'AAA0000000001', qty, cut: 'T2611-0001', cutQty: 3, piles });
    const copyOf = (piles, note = 'RETURN') => piles.map((p) => ['AAA001', 'AAA0000000001', p[1], p[2], '', p[0], p[3], 'รับ', note, 'เปิด']);
    const ret = (batch, lines, copy) => api.post({ op: 'bk-return', ...me, batch, date: '2026-11-10', base: 900, lines, copy });

    const p1 = [['A-01-01', '9', 'P2', 1], ['A-01-01', '8', 'P1', 1]];
    expect(ret('r-1', [line(2, p1)], copyOf(p1))).toMatchObject({ doc: 'T2611-0002', lines: 1, rows: 2, qty: 2 });
    const tab = logFile(api).getSheetByName('2026-11 คืน');
    expect(tab.grid[0]).toEqual(['เลขที่', 'สถานะ', 'ระบบ', 'ออเดอร์', 'SKU', 'ชิ้น', 'วันที่คืน', 'เลขอ้างอิง', 'คืนเข้ากอง (โล|LOT|PO|ชิ้น)', 'ผู้ลง',
      'บันทึกเมื่อ', 'เลขพัสดุ', 'เลขที่ตัด']);
    expect(tab.grid[1].slice(0, 9)).toEqual(['T2611-0002', '', 'JST', '1001', 'AAA0000000001', 2, '2026-11-10', 'ON1001', 'A-01-01|9|P2|1; A-01-01|8|P1|1']);
    expect(api.post({ op: 'bk-find', ...me, date: '2026-11-10', keys: ['1001'] }).found['1001'][0].back).toBe(2);

    const p2 = [['A-01-01', '8', 'P1', 2]];
    const over = ret('r-2', [line(2, p2)], copyOf(p2));
    expect(over.error).toMatch(/คืนเกินชิ้นที่ตัด 1 บรรทัด/);
    expect(over.over).toEqual([{ key: 'JST|1001|AAA0000000001', cut: 3, back: 2, qty: 2 }]);

    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0002', why: 'คืนผิดออเดอร์' })).toMatchObject({ type: 'คืน', lines: 1 });
    expect(api.post({ op: 'bk-find', ...me, date: '2026-11-10', keys: ['1001'] }).found['1001'][0].back).toBe(0);
    expect(ret('r-3', [line(2, p2)], copyOf(p2)).doc).toBe('T2611-0003');
  });

  it('คืนแบบไม่รู้ออเดอร์ (LOT 0) ไม่ต้องมีเลขที่ตัด · แถวคืนผิดรูปแบบไม่รับ', () => {
    const api = setup();
    const piles = [['QA', '0', '0', 2]];
    const ok = api.post({ op: 'bk-return', ...me, batch: 'r', date: '2026-11-10',
      lines: [{ sys: '', order: '', sku: 'CCC0000000004', qty: 2, piles }],
      copy: [['CCC004', 'CCC0000000004', '0', '0', '', 'QA', 2, 'รับ', 'M/E-00304', '']] });
    expect(ok).toMatchObject({ doc: 'T2611-0001', qty: 2 });
    const bad = (row, lines) => api.post({ op: 'bk-return', ...me, batch: 'x', date: '2026-11-10',
      lines: lines || [{ sku: 'CCC0000000004', qty: 2, piles }], copy: [row] });
    const row = ['CCC004', 'CCC0000000004', '0', '0', '', 'QA', 2, 'รับ', 'RETURN', ''];
    expect(bad(Object.assign([...row], { 7: 'เบิก' })).bad[0].why).toBe('ประเภทต้องเป็น รับ');
    expect(bad(Object.assign([...row], { 4: 'A-01-01' })).bad[0].why).toBe('แถวคืนมีแค่โลรับ');
    expect(bad(Object.assign([...row], { 8: 'โอนย้าย' })).bad[0].why).toMatch(/RETURN หรือ M\/E/);
    expect(bad(row, [{ sku: 'CCC0000000004', qty: 2, cut: 'T2611-0001', cutQty: 2, piles }]).bad[0].why).toMatch(/ระบบกับเลขออเดอร์/);
    expect(bad(Object.assign([...row], { 6: 3 })).error).toMatch(/ไม่เท่ากับชิ้นที่คืน/);
  });
});
