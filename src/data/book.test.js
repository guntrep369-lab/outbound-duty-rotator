/**
 * สมุดสต๊อก ขั้น 1: ตัดขายจากไฟล์ออเดอร์ (public/wms-book.js) กับ apps-script/book-api.gs
 *
 * สิ่งที่ต้องไม่พัง: ตัดกองผิด (PO ตัวเต็มปนกัน กองที่ปิดแล้วถูกตัด) ตัดออเดอร์เดิมซ้ำ และแถวที่คัดลอกไปวาง
 * ไม่ตรงคอลัมน์ของชีตเดิม · สคริปต์ต้องไม่เปิดไฟล์อื่นนอกจากที่ตัวเองสร้าง
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadBook } from '../dev/fake-gas.js';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-book.js'), 'utf8');
const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/book-api.gs'), 'utf8');

let B;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  B = win.WmsBook;
});

const JST_HEAD = ['หมายเลขคำสั่งซื้อออนไลน์', 'หมายเลขออเดอร์ภายใน', 'สถานะ', 'บริษัทขนส่ง', 'หมายเลขพัสดุ', 'สถานะขนส่ง', 'คลัง',
  'วันที่ออกจากคลังสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนสินค้า', 'รหัสแบบสินค้า', 'รูปแบบสินค้า'];
const jst = (online, internal, sku, qty, out = '2026-11-10 10:00:00', status = 'จัดส่งแล้ว') =>
  [online, internal, status, 'ขนส่งสมมติ', 'P1', 'จัดส่งแล้ว', 'คลังสมมติ', out, sku, 'สินค้าสมมติ', qty, sku, null];
const CRM_HEAD = ['วันที่', 'ขนส่ง', 'Order ID', 'SKU', 'แบรนด์', 'ขนาด', 'จำนวน'];

/* SKU สมมติ [สั้น, เต็ม, ชื่อ] */
const SKUS = [
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1'],
  ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2'],
  ['FRE003', 'FRE0000000003', 'แถม-หมอนสมมติ 3'],
  ['CCC004', 'CCC0000000004', 'หมอนสมมติ 4'],
];

/**
 * คำตอบ tx-fifo ปลอมจากแถวอ่านง่าย
 * แถว = { s, lot, po, from, to, qty, t: 'รับ'|'เบิก'|'ขาย', d, open }
 */
function fifo(list, extra = {}) {
  const res = { skus: SKUS, pos: [], locs: [], days: [], rows: [], ...extra };
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  list.forEach((r, n) => {
    const t = r.t === 'ขาย' ? 2 : r.t === 'เบิก' ? 1 : 0;
    res.rows.push([n + 2, r.s, r.lot, idx(res.pos, r.po), r.from ? idx(res.locs, r.from) : -1, r.to ? idx(res.locs, r.to) : -1,
      r.qty, t, r.d ? idx(res.days, r.d) : -1, (r.open ? 1 : 0) + (r.d ? 8 : 0)]);
  });
  return res;
}

describe('อ่านไฟล์ออเดอร์', () => {
  it('ไฟล์ JST: หัวตารางตามชื่อ เลขออเดอร์ภายในเป็นตัวเลขไม่มี .0 วันที่จากวันออกจากคลัง', () => {
    const p = B.parseOrders([JST_HEAD, jst('261109AAA', 1094166, 'aaa0000000001', 1, '2026-11-10 17:15:43')], { today: '2026-11-18' });
    expect(p.sys).toBe('JST');
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ sys: 'JST', order: '1094166', ref: '261109AAA', track: 'P1', sku: 'AAA0000000001', qty: 1, date: '2026-11-10' });
    expect(p.dates).toEqual({ '2026-11-10': 1 });
  });

  it('ไฟล์ JST: สถานะที่ไม่ใช่ จัดส่งแล้ว ข้ามและบอกเหตุผล ไม่สับสนกับคอลัมน์ สถานะขนส่ง', () => {
    const p = B.parseOrders([JST_HEAD, jst('1', 2, 'AAA0000000001', 1, undefined, 'ยกเลิก'), jst('3', 4, 'AAA0000000001', 0)], {});
    expect(p.lines).toHaveLength(0);
    expect(p.skipped.map((s) => s.why)).toEqual(['สถานะ ยกเลิก', expect.stringMatching(/จำนวน/)]);
    expect(p.skipped[0].n).toBe(2);
  });

  it('ไฟล์ CRM: วันที่ไม่มีปีใช้ปีของวันนี้ ข้ามปีได้ หัวตารางไม่ต้องอยู่แถวแรก', () => {
    const grid = [['รายงานสมมติ'], CRM_HEAD, ['Tue, Nov 10', 'ขนส่งสมมติ', 'AA-90001', 'AAA0000000001', 'แบรนด์', 'King', 2],
      ['Wed, Dec 31', 'ขนส่งสมมติ', 'M/E-90002', 'BBB0000000002', 'แบรนด์', '', '1']];
    const p = B.parseOrders(grid, { today: '2027-01-02' });
    expect(p.sys).toBe('CRM');
    expect(p.head).toBe(1);
    expect(p.lines.map((l) => [l.order, l.date, l.qty])).toEqual([['AA-90001', '2026-11-10', 2], ['M/E-90002', '2026-12-31', 1]]);
    expect(B.dateOf('Tue, Nov 10', '2026-11-18')).toBe('2026-11-10');
  });

  it('ไม่ใช่ไฟล์ออเดอร์ บอกว่าต้องมีหัวตารางอะไร', () => {
    expect(B.parseOrders([['a', 'b'], [1, 2]], {}).error).toMatch(/JST.*CRM/);
  });

  it('รวมไฟล์: ระบบ + ออเดอร์ + SKU เดียวกันรวมชิ้น ออเดอร์เลขเดียวกันคนละระบบไม่รวม', () => {
    const a = B.parseOrders([CRM_HEAD, ['Tue, Nov 10', '', 'AA-1', 'FRE0000000003', '', '', 1], ['Tue, Nov 10', '', 'AA-1', 'FRE0000000003', '', '', 2]], { today: '2026-11-18' });
    const b = B.parseOrders([JST_HEAD, jst('x', 'AA-1', 'FRE0000000003', 1)], {});
    const m = B.merge([a, b]);
    expect(m.lines.map((l) => [l.key, l.qty])).toEqual([['CRM|AA-1|FRE0000000003', 3], ['JST|AA-1|FRE0000000003', 1]]);
    expect(m.dup).toBe(1);
    expect(B.mainDate([a, b])).toBe('2026-11-10');
  });

  it('ข้อความที่คัดลอกจาก Excel อ่านได้แบบไฟล์', () => {
    const text = CRM_HEAD.join('\t') + '\r\nTue, Nov 10\tขนส่ง\tAA-7\tAAA0000000001\tแบรนด์\tKing\t1\r\n';
    expect(B.parseOrders(B.gridOf(text), { today: '2026-11-18' }).lines).toHaveLength(1);
  });
});

describe('กองสต๊อกจาก tx-fifo', () => {
  it('PO ตัวเต็มแยกกอง (9900000001 กับ 9900000001-02 ไม่รวมกัน) และกองเปิดตามแถวรับเข้าล่าสุด', () => {
    const st = B.stock(fifo([
      { s: 0, lot: 8, po: '9900000001', to: 'A-01-01', qty: 5, d: '2026-10-01', open: 1 },
      { s: 0, lot: 8, po: '9900000001-02', to: 'A-01-01', qty: 3, d: '2026-10-02', open: 1 },
      { s: 0, lot: 9, po: '9900000003', to: 'B-01-01', qty: 4, d: '2026-10-03', open: 1 },
      { s: 0, lot: 9, po: '9900000003', to: 'B-01-01', qty: 1, d: '2026-10-05', open: 0 },   // แถวรับล่าสุดไม่เปิด = กองปิด
    ]));
    expect(st.open[0].map((p) => [p.po, p.qty])).toEqual([['9900000001', 5], ['9900000001-02', 3]]);
    expect(st.reserve[0].map((p) => [p.loc, p.qty])).toEqual([['B-01-01', 5]]);
  });

  it('ขายและเบิกหักที่โลเบิก ไม่ตัดจาก QA RIB OFFICE จอง', () => {
    const st = B.stock(fifo([
      { s: 1, lot: 8, po: 'P1', to: 'S-01-01', qty: 6, d: '2026-10-01', open: 1 },
      { s: 1, lot: 8, po: 'P1', from: 'S-01-01', qty: 2, t: 'ขาย', d: '2026-10-02' },
      { s: 1, lot: 8, po: 'P1', from: 'S-01-01', to: 'RIB', qty: 1, t: 'เบิก', d: '2026-10-02', open: 1 },
      { s: 1, lot: 8, po: 'P1', to: 'OFFICE', qty: 4, d: '2026-10-01', open: 1 },
      { s: 1, lot: 8, po: 'P1', to: 'จองลูกค้า', qty: 4, d: '2026-10-01', open: 1 },
      { s: 1, lot: 8, po: 'P1', to: 'QA', qty: 4, d: '2026-10-01', open: 1 },
    ]));
    expect(st.open[1].map((p) => [p.loc, p.qty])).toEqual([['S-01-01', 3]]);
    expect(B.cuttable('RIB')).toBe(false);
    expect(B.cuttable('B-07-06')).toBe(true);
  });

  it('ลำดับตัด: LOT 0 ก่อน แล้ววันรับแรกเก่าสุด (LOT 1 ปีหน้าไม่แซง LOT 11 ปีนี้) แล้วโลพื้น', () => {
    const st = B.stock(fifo([
      { s: 0, lot: 1, po: 'P-NEW', to: 'A-01-01', qty: 2, d: '2027-01-05', open: 1 },
      { s: 0, lot: 11, po: 'P-OLD', to: 'DOCKLOAD', qty: 2, d: '2026-11-05', open: 1 },
      { s: 0, lot: 11, po: 'P-OLD', to: 'B-02-01', qty: 2, d: '2026-11-06', open: 1 },
      { s: 0, lot: 0, po: '0', to: 'S-03-01', qty: 1, d: '2027-01-10', open: 1 },
    ]));
    expect(st.open[0].map((p) => `${p.lot}/${p.loc}`)).toEqual(['0/S-03-01', '11/B-02-01', '11/DOCKLOAD', '1/A-01-01']);
  });

  it('แถวของชุดที่ยังไม่วางในชีตเดิมหักออกจากกอง', () => {
    const res = fifo([{ s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 5, d: '2026-10-01', open: 1 }]);
    const st = B.stock(res, [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 3, 'ขาย', '2026-11-10', 'เปิด']]);
    expect(st.open[0][0].qty).toBe(2);
    expect(B.stampMs('2026-11-10 07:00:00')).toBe(Date.UTC(2026, 10, 10, 0, 0, 0));
  });

  it('ชุดไหนวางในชีตเดิมแล้ว ดูจากแถวขายในสต๊อก ไม่ดูจากเวลา แถวเดียวกันไม่นับให้สองชุด', () => {
    const row = (qty) => ['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', qty, 'ขาย', '2026-11-10', 'เปิด'];
    const res = fifo([
      { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 9, d: '2026-10-01', open: 1 },
      { s: 0, lot: 8, po: 'P1', from: 'A-01-01', qty: 2, t: 'ขาย', d: '2026-11-10' },   // วางแล้วของชุด a
    ]);
    const a = { doc: 'T1', at: '2026-11-10 09:00:00', status: '', copy: [row(2)] };
    const b = { doc: 'T2', at: '2026-11-10 09:30:00', status: '', copy: [row(2)] };   // หน้าตาเหมือนกัน ยังไม่วาง
    const c = { doc: 'T3', at: '2026-11-10 08:00:00', status: 'ยกเลิก', copy: [row(1)] };
    const r = B.reflect(res, [b, c, a]);
    expect(r.done.map((d) => d.doc)).toEqual(['T1']);
    expect(r.wait.map((d) => d.doc)).toEqual(['T2']);
    expect(B.stock(res, B.extraOf(r.wait)).open[0][0].qty).toBe(5);
  });
});

describe('ตัด', () => {
  const res = () => fifo([
    { s: 0, lot: 8, po: 'P1', to: 'A-01-01', qty: 2, d: '2026-10-01', open: 1 },
    { s: 0, lot: 9, po: 'P2', to: 'A-01-01', qty: 5, d: '2026-10-09', open: 1 },
    { s: 0, lot: 9, po: 'P2', to: 'R1-01-01', qty: 20, d: '2026-10-09' },
    { s: 3, lot: 8, po: 'P3', to: 'S-01-01', qty: 9, d: '2026-10-01', open: 1 },
  ], { convert: { pairs: [['FRE0000000003', 'CCC0000000004', '']] } });
  const line = (sys, order, sku, qty, at) => ({ sys, order, sku, qty, at, ref: '', key: `${sys}|${order}|${sku}` });

  it('บรรทัดเดียวข้ามสองกองได้ ออกจากคลังก่อนได้ของก่อน ของไม่พอทั้งบรรทัดไม่ตัดเลย', () => {
    const st = B.stock(res());
    const cut = B.allocate([
      line('JST', '2', 'AAA0000000001', 4, '2026-11-10 12:00:00'),
      line('JST', '1', 'AAA0000000001', 3, '2026-11-10 09:00:00'),
      line('JST', '3', 'AAA0000000001', 1, '2026-11-10 13:00:00'),
    ], st);
    expect(cut.lines.map((r) => r.st)).toEqual(['ok', 'ok', 'short']);
    expect(cut.lines[1].take.map(([p, q]) => [p.po, q])).toEqual([['P1', 2], ['P2', 1]]);
    expect(cut.lines[0].take.map(([p, q]) => [p.po, q])).toEqual([['P2', 4]]);
    expect(cut.rows.map((r) => [r.sku, r.lot, r.po, r.loc, r.qty, r.orders])).toEqual([
      ['AAA001', '8', 'P1', 'A-01-01', 2, 1], ['AAA001', '9', 'P2', 'A-01-01', 5, 2]]);
    expect(cut.short[0]).toMatchObject({ sku: 'AAA001', need: 1, lines: 1, left: 0 });
    expect(cut.short[0].reserve).toEqual([{ loc: 'R1-01-01', lot: '9', po: 'P2', qty: 20, sup: '' }]);
    expect(cut.total).toMatchObject({ lines: 3, ok: 2, okQty: 7, short: 1, shortQty: 1, rows: 2, orders: 2 });
  });

  it('บรรทัดที่ตัดแล้วข้าม SKU ที่ไม่มีในสมุดบอกแยก แถมไม่มีของบอกว่าแปลงจากอะไรได้', () => {
    const st = B.stock(res());
    const cut = B.allocate([
      line('CRM', 'AA-1', 'AAA0000000001', 1, '2026-11-10'),
      line('CRM', 'AA-2', 'ZZZ0000000009', 1, '2026-11-10'),
      line('CRM', 'AA-3', 'FRE0000000003', 2, '2026-11-10'),
    ], st, { seen: { 'CRM|AA-1|AAA0000000001': 'T2611-0001' } });
    expect(cut.lines.map((r) => [r.st, r.doc])).toEqual([['done', 'T2611-0001'], ['nosku', ''], ['short', '']]);
    expect(cut.short[0].conv).toEqual([{ sku: 'CCC004', long: 'CCC0000000004', name: 'หมอนสมมติ 4', open: 9 }]);
    expect(cut.rows).toEqual([]);
  });

  it('ตัดจากสอง Supplier ในชุดเดียวขึ้นเตือน', () => {
    const r = res();
    r.sup = { rows: [['P1', 'ผู้ผลิต ก'], ['P2', 'ผู้ผลิต ข']] };
    const cut = B.allocate([line('JST', '1', 'AAA0000000001', 3, '1')], B.stock(r));
    expect(cut.sup).toHaveLength(1);
    expect(cut.sup[0].sups).toEqual({ 'ผู้ผลิต ก': 2, 'ผู้ผลิต ข': 1 });
  });

  it('แถวที่คัดลอกตรงคอลัมน์ A–N ของชีต Transaction: B C G L ว่าง M ชื่อ N เลขที่', () => {
    const st = B.stock(res());
    const cut = B.allocate([line('JST', '1', 'AAA0000000001', 3, '1')], st);
    const copy = B.copyRows(cut, '2026-11-10');
    expect(copy[0]).toEqual(['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'ขาย', '2026-11-10', 'เปิด']);
    const lines = B.tsv(copy, 'ทดลอง', 'T2611-0007').split('\n');
    expect(lines[0].split('\t')).toEqual(['AAA001', '', '', '8', 'P1', 'A-01-01', '', '2', 'ขาย', '2026-11-10', 'เปิด', '', 'ทดลอง', 'T2611-0007']);
    expect(lines).toHaveLength(2);
    expect(B.cutLines(cut)).toEqual([{ sys: 'JST', order: '1', ref: '', track: '', sku: 'AAA0000000001', qty: 3,
      piles: [['A-01-01', '8', 'P1', 2], ['A-01-01', '9', 'P2', 1]] }]);
  });
});

/* ── book-api.gs ──────────────────────────────────────────────────────── */

describe('book-api.gs', () => {
  const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);   // 10 พ.ย. 2569 10:00 เวลาไทย
  function setup() {
    let t = NOW;
    const api = loadBook({ now: () => t });
    api.users([['ทดลอง', '1111', 'ลงรายการ'], ['หัวหน้าทดลอง', '9999', 'รองหัวหน้า'], ['ปิดแล้ว', '2222', '', 'ไม่']]);
    api.tick = (ms) => { t += ms; };
    return api;
  }
  const me = { who: 'ทดลอง', pin: '1111' };
  const head = { who: 'หัวหน้าทดลอง', pin: '9999' };
  const cutReq = (batch, lines, extra = {}) => ({
    op: 'bk-cut', ...me, batch, date: '2026-11-10',
    lines, copy: [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', lines.reduce((a, l) => a + l.qty, 0), 'ขาย', '2026-11-10', 'เปิด']],
    ...extra,
  });
  const ln = (order, qty = 1, sku = 'AAA0000000001') => ({ sys: 'JST', order, ref: 'R' + order, sku, qty, piles: [['A-01-01', '8', 'P1', qty]] });

  it('ไม่มีที่เปิดไฟล์อื่นนอกจากไฟล์ที่ตัวเองสร้าง ไม่มี URL หรือรหัสไฟล์ใดในโค้ด', () => {
    expect(GS).not.toMatch(/openByUrl|REAL_SHEET|docs\.google\.com|DriveApp/);
    expect(GS.match(/openById\(/g)).toHaveLength(1);
    expect(GS).toMatch(/var id = props\.getProperty\(key\);\n\s+var file = null;\n\s+if \(id\) file = SpreadsheetApp\.openById\(id\);/);
  });

  it('รายชื่อไม่มีรหัส คนที่ปิดสิทธิ์ไม่ขึ้น ล็อกอินครั้งแรกรหัสในแท็บกลายเป็นรหัสลับ', () => {
    const api = setup();
    expect(api.get({ api: 'bk-names' }).names).toEqual(['ทดลอง', 'หัวหน้าทดลอง']);
    const r = api.post({ op: 'bk-login', ...me });
    expect(r).toMatchObject({ who: 'ทดลอง', role: 'ลงรายการ', v: 3, mode: 'copy' });
    const cell = api.ss.getSheetByName('ผู้ใช้').grid[1][1];
    expect(cell).toMatch(/^#[0-9a-f]{64}$/);
    expect(api.post({ op: 'bk-login', ...me }).error).toBeUndefined();
    expect(api.post({ op: 'bk-login', ...head }).role).toBe('หัวหน้า');
    expect(api.post({ op: 'bk-login', who: 'ปิดแล้ว', pin: '2222' }).error).toMatch(/ไม่มีชื่อ/);
  });

  it('รหัสผิด 5 ครั้งพัก 10 นาที แม้รหัสถูกก็เข้าไม่ได้จนครบเวลา', () => {
    const api = setup();
    for (let i = 0; i < 5; i++) expect(api.post({ op: 'bk-login', who: 'ทดลอง', pin: '0000' }).error).toMatch(/รหัสไม่ถูก/);
    expect(api.post({ op: 'bk-login', ...me }).error).toMatch(/รอ 10 นาที/);
    api.tick(11 * 60000);
    expect(api.post({ op: 'bk-login', ...me }).who).toBe('ทดลอง');
  });

  it('ไม่มีรายชื่อคน บอกให้หัวหน้าใส่ในแท็บผู้ใช้', () => {
    const api = loadBook({ now: () => NOW });
    expect(api.post({ op: 'bk-login', ...me }).error).toMatch(/แท็บ ผู้ใช้/);
  });

  it('บันทึกชุด: เลขที่รันต่อเดือน บรรทัดลงไฟล์ไตรมาสแยก แท็บเดือน ส่งซ้ำรหัสชุดเดิมได้เลขเดิม', () => {
    const api = setup();
    const a = api.post(cutReq('b-1', [ln('1'), ln('2', 2)]));
    expect(a).toMatchObject({ doc: 'T2611-0001', lines: 2, rows: 1, qty: 3 });
    expect(api.lock.waits).toBe(1);
    const again = api.post(cutReq('b-1', [ln('1'), ln('2', 2)]));
    expect(again).toMatchObject({ doc: 'T2611-0001', again: true });
    expect(api.post(cutReq('b-2', [ln('3')])).doc).toBe('T2611-0002');

    expect([...api.props.keys()]).toContain('log|2026Q4');
    const file = api.files.get(api.props.get('log|2026Q4'));
    expect(file.title).toBe('WMS สมุดสต๊อก · ออเดอร์ที่ตัด 2026 Q4');
    expect(file.getSheets().map((t) => t.getName())).toEqual(['2026-11']);
    const log = file.getSheetByName('2026-11').grid;
    expect(log.slice(1).map((r) => r.slice(0, 9))).toEqual([
      ['T2611-0001', '', 'JST', '1', 'AAA0000000001', 1, '2026-11-10', 'R1', 'A-01-01|8|P1|1'],
      ['T2611-0001', '', 'JST', '2', 'AAA0000000001', 2, '2026-11-10', 'R2', 'A-01-01|8|P1|2'],
      ['T2611-0002', '', 'JST', '3', 'AAA0000000001', 1, '2026-11-10', 'R3', 'A-01-01|8|P1|1'],
    ]);
    const docs = api.ss.getSheetByName('เลขที่เอกสาร').grid;
    expect(docs[1].slice(0, 9)).toEqual(['T2611-0001', 'ตัดขาย', '2026-11-10', 'ทดลอง', '2026-11-10 10:00:00', 1, 3, 2, '']);
    expect(docs[1][14]).toBe('@2+1');
    expect(api.ss.getSheetByName('แถวที่คัดลอก').grid[1]).toEqual(['T2611-0001', 'AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 3, 'ขาย', '2026-11-10', 'เปิด']);
  });

  it('บรรทัดที่ตัดไปแล้ว (เดือนนี้หรือเดือนก่อน) ไม่รับทั้งชุด บอกเลขที่เดิม', () => {
    const api = setup();
    api.post(cutReq('b-1', [ln('1')]));
    const r = api.post(cutReq('b-2', [ln('9'), ln('1')]));
    expect(r.error).toMatch(/ตัดไปแล้ว 1 บรรทัด/);
    expect(r.dup).toEqual([{ key: 'JST|1|AAA0000000001', doc: 'T2611-0001' }]);
    expect(api.post({ op: 'bk-seen', ...me, date: '2026-11-10', keys: ['JST|1|AAA0000000001', 'JST|9|AAA0000000001'] }).seen)
      .toEqual({ 'JST|1|AAA0000000001': 'T2611-0001' });
    api.tick(25 * 86400000);   // 5 ธ.ค. ตัดออเดอร์ของต้นเดือน ยังเห็นของเดือน พ.ย.
    expect(api.post({ ...cutReq('b-3', [ln('1')]), date: '2026-12-05' }).dup).toHaveLength(1);
  });

  it('ตรวจชุดก่อนเขียน: ชิ้นในกองไม่เท่าออเดอร์ ระบบไม่รู้จัก ชิ้นรวมไม่เท่าแถวที่คัดลอก วันที่ย้อนเกิน', () => {
    const api = setup();
    expect(api.post(cutReq('x', [{ ...ln('1', 2), piles: [['A-01-01', '8', 'P1', 1]] }])).bad[0].why).toMatch(/ไม่เท่ากับ/);
    expect(api.post(cutReq('x', [{ ...ln('1'), sys: 'SHOPEE' }])).bad[0].why).toMatch(/JST หรือ CRM/);
    expect(api.post({ ...cutReq('x', [ln('1')]), copy: [['AAA001', '', '8', 'P1', 'A-01-01', '', 5, 'ขาย', '', 'เปิด']] }).error).toMatch(/ไม่เท่ากับชิ้นในออเดอร์/);
    expect(api.post({ ...cutReq('x', [ln('1')]), date: '2026-09-01' }).error).toMatch(/ย้อนหลังเกิน/);
    expect(api.post({ ...cutReq('x', [ln('1')]), pin: '1234' }).error).toMatch(/รหัสไม่ถูก/);
    expect(api.ss.getSheetByName('เลขที่เอกสาร').getLastRow()).toBe(1);
    expect(api.files.size).toBe(0);
  });

  it('ยกเลิกชุดได้เฉพาะหัวหน้า ต้องมีเหตุผล บรรทัดของชุดนั้นตัดใหม่ได้ ชุดอื่นไม่โดน', () => {
    const api = setup();
    api.post(cutReq('b-1', [ln('1'), ln('2')]));
    api.post(cutReq('b-2', [ln('3')]));
    expect(api.post({ op: 'bk-void', ...me, doc: 'T2611-0001', why: 'ผิด' }).error).toMatch(/เฉพาะหัวหน้า/);
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0001' }).error).toMatch(/เหตุผล/);
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0001', why: 'ไฟล์ผิดวัน' })).toMatchObject({ status: 'ยกเลิก', lines: 2 });
    const log = api.files.get(api.props.get('log|2026Q4')).getSheetByName('2026-11').grid;
    expect(log.slice(1).map((r) => r[1])).toEqual(['ยกเลิก', 'ยกเลิก', '']);
    expect(api.post(cutReq('b-3', [ln('1')])).doc).toBe('T2611-0003');
    expect(api.post({ op: 'bk-void', ...head, doc: 'T2611-0001', why: 'ซ้ำ' }).error).toMatch(/ยกเลิกไปแล้ว/);
    const recent = api.post({ op: 'bk-recent', ...me, days: 2 });
    expect(recent.docs.map((d) => [d.doc, d.status])).toEqual([['T2611-0003', ''], ['T2611-0002', ''], ['T2611-0001', 'ยกเลิก']]);
    expect(recent.docs[0].copy).toHaveLength(1);
  });

  it('เดือนใหม่เลขที่เริ่ม 0001 ไตรมาสใหม่ได้ไฟล์ใหม่', () => {
    const api = setup();
    api.post(cutReq('b-1', [ln('1')]));
    api.tick(52 * 86400000);   // 1 ม.ค. 2570
    const r = api.post({ ...cutReq('b-2', [ln('2')]), date: '2027-01-01' });
    expect(r.doc).toBe('T2701-0001');
    expect(api.props.has('log|2027Q1')).toBe(true);
    expect(api.files.size).toBe(2);
  });
});
