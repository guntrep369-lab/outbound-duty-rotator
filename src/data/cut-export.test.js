/**
 * ไฟล์ Excel ของออเดอร์ที่ติ๊กในแท็บตัดผิด / ตัดเกิน: public/wms-cut.js (exportSheets)
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-cut.js'), 'utf8');

const A = 'AAA0000000001';
const B = 'BBB0000000002';
const C = 'CCC0000000003';
const KINDS = { over: 'ตัดเกิน', wrong: 'ตัดผิด SKU', ghost: 'ตัดแต่ไม่มีใน Report', under: 'ยังไม่ตัดหรือตัดไม่ครบ', cancel: 'ขนส่งยกเลิกแต่ตัดแล้ว' };
const BACK = 'ส่งออกแล้ว ลูกค้ายกเลิก ตีกลับคลัง';

let WmsCut;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  WmsCut = win.WmsCut;
});

const row = (o) => ({
  ref: '5001', sku: A, sys: 'JST', sup: 'ขนส่งเอ', date: '2026-03-05', r: 2, x: 2, t: 2, goal: 2,
  xd: ['2026-03-05'], td: ['2026-03-05'], ship: 'จัดส่งแล้ว', back: false, note: '', lines: 0, k: 'over', ...o,
});

const ROWS = [
  row({ x: 4, t: 2, xd: ['2026-03-05', '2026-03-06'] }),                                   // 5001 A ตัดเกินใน Uploadยิงออก
  row({ ref: '5002', sku: C, r: 0, x: 1, t: 1, goal: 0, k: 'wrong' }),                      // 5002 ตัด C ซึ่งไม่อยู่ในออเดอร์
  row({ ref: '5003', sku: '', r: 0, x: 3, t: 3, goal: 0, k: 'ghost', lines: 6 }),           // ทั้งออเดอร์ไม่มีใน Report
  row({ ref: '5001', sku: B, r: 1, x: 0, t: 1, goal: 1, k: 'under' }),                      // 5001 B ยังไม่ตัดใน Uploadยิงออก
  row({ ref: '5009', sku: A, k: 'cancel', ship: 'ยกเลิก', back: true }),                    // ไม่ได้เลือก
];
const NAMES = { [A]: 'สินค้าเอ', [B]: 'สินค้าบี', [C]: 'สินค้าซี' };
const JST_HEAD = ['หมายเลขคำสั่งซื้อออนไลน์', 'หมายเลขออเดอร์ภายใน', 'สถานะ', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนสินค้า'];
const REP = {
  app: 'cut', refs: 3, cut: false,
  tabs: [
    {
      name: 'Report order ระบบJST', sys: 'JST', head: JST_HEAD, ref: 1, rows: [
        ['ON5002', '5002', 'จัดส่งแล้ว', A, 'สินค้าเอ', 1],
        ['ON5001', '5001', 'จัดส่งแล้ว', A, 'สินค้าเอ', 2],
        ['ON5001', '5001', 'จัดส่งแล้ว', B, 'สินค้าบี', 1],
        ['ON5001', '5001', 'จัดส่งแล้ว', 'DDD0000000004', 'สินค้าดี', 5],
      ],
    },
    { name: 'Report order ระบบ CRM', sys: 'CRM', head: ['Order ID', 'SKU', 'จำนวน'], ref: 0, rows: [] },
  ],
};

const build = (refs, rep = REP, rows = ROWS) => WmsCut.exportSheets({ rows, names: NAMES, refs, kinds: KINDS, back: BACK, rep });

describe('exportSheets — ชีตสรุปปัญหา', () => {
  it('มีทุกแถวของออเดอร์ที่เลือก รวมเรื่องยังไม่ตัด เรียงตามที่เลือก ออเดอร์ที่ไม่ได้เลือกไม่ลง', () => {
    const [sum] = build(['5002', '5001', '5003']);
    expect(sum.name).toBe('สรุปปัญหา');
    expect(sum.aoa[0][0]).toBe('ออเดอร์');
    expect(sum.aoa.slice(1).map((r) => [r[0], r[3], r[4]])).toEqual([
      ['5002', 'ตัดผิด SKU', C],
      ['5001', 'ตัดเกิน', A],
      ['5001', 'ยังไม่ตัดหรือตัดไม่ครบ', B],
      ['5003', 'ตัดแต่ไม่มีใน Report (ทั้งออเดอร์ 6 SKU)', ''],
    ]);
  });

  it('ตัวเลข คำว่าต่างกันยังไง และวันที่ตัดของแต่ละระบบ ตรงกับบนจอ', () => {
    const [sum] = build(['5001']);
    const a = Object.fromEntries(sum.aoa[0].map((h, i) => [h, sum.aoa[1][i]]));
    expect(a).toMatchObject({
      'ชื่อสินค้า': 'สินค้าเอ', Report: 2, 'Uploadยิงออก': 4, TRcloud: 2,
      'ต่างกันยังไง': 'Uploadยิงออก เกิน 2',
      'วันที่ตัด Uploadยิงออก': '2026-03-05, 2026-03-06', 'วันที่ตัด TRcloud': '2026-03-05',
    });
    expect(WmsCut.rowDiff(row({ x: 1, t: 1, goal: 0 }))).toBe('ตัดอยู่ 1 ทั้งสองระบบ');
  });

  it('ของส่งออกไปแล้วลูกค้ายกเลิก ใช้คำเดียวกับบนจอแทนสถานะขนส่ง', () => {
    const [sum] = build(['5009']);
    expect(sum.aoa[1][sum.aoa[0].indexOf('สถานะขนส่ง')]).toBe(BACK);
  });
});

describe('exportSheets — ชีตแถวใน Report', () => {
  it('ทุกคอลัมน์ของ Report มีคอลัมน์ปัญหานำหน้า SKU ที่ไม่มีปัญหาเว้นว่าง', () => {
    const sheets = build(['5001', '5002']);
    expect(sheets.map((s) => s.name)).toEqual(['สรุปปัญหา', 'Report JST']);   // CRM ไม่มีแถว ไม่ต้องมีชีต
    const j = sheets[1].aoa;
    expect(j[0]).toEqual(['ปัญหา', ...JST_HEAD]);
    /* เรียงตามออเดอร์ที่เลือก 5001 ก่อน 5002 */
    expect(j.slice(1).map((r) => [r[0], r[2], r[4]])).toEqual([
      ['ตัดเกิน', '5001', A],
      ['ยังไม่ตัดหรือตัดไม่ครบ', '5001', B],
      ['', '5001', 'DDD0000000004'],
      /* 5002 ตัด C ผิด แต่ A ในออเดอร์ไม่มีปัญหา */
      ['', '5002', A],
    ]);
  });

  it('ปัญหาทั้งออเดอร์ลงทุกแถวของออเดอร์นั้น เลขใน Report มีวันที่ต่อท้ายก็จับคู่ได้', () => {
    const rows = [row({ sku: '', k: 'cancel', lines: 3 })];
    const rep = { tabs: [{ sys: 'JST', head: JST_HEAD, ref: 1, rows: [['ON', '5001 · 2026-03-05', '', A, '', 1], ['ON', '5001', '', B, '', 1]] }] };
    const j = build(['5001'], rep, rows)[1].aoa;
    expect(j.slice(1).map((r) => r[0])).toEqual(['ขนส่งยกเลิกแต่ตัดแล้ว', 'ขนส่งยกเลิกแต่ตัดแล้ว']);
  });

  it('สคริปต์รุ่นเก่าไม่ส่งแถว Report มา ได้แค่ชีตสรุป', () => {
    expect(build(['5001'], null).map((s) => s.name)).toEqual(['สรุปปัญหา']);
  });

  it('ความกว้างคอลัมน์ไม่เกิน 45 ตัวอักษร', () => {
    const [sum] = build(['5001'], null, [row({ note: 'ย'.repeat(200) })]);
    expect(Math.max(...sum.widths)).toBe(45);
    expect(sum.widths).toHaveLength(sum.aoa[0].length);
  });
});
