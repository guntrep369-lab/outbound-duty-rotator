/**
 * public/shiftlog/shiftlog.js — สมุดกะ
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');
const win = {};
new Function('window', read('wms-pick.js'))(win);
new Function('window', read('shiftlog/shiftlog.js'))(win);
const L = win.ShiftLog;

describe('กะของเวลาที่บันทึก', () => {
  const at = (h, m = 0) => L.shiftAt(new Date(2026, 9, 24, h, m));

  it('07:00–15:59 เป็นกะเช้า 16:00 ขึ้นไปเป็นกะบ่าย', () => {
    expect(at(7)).toEqual({ date: '2026-10-24', shift: 'morning' });
    expect(at(15, 59)).toEqual({ date: '2026-10-24', shift: 'morning' });
    expect(at(16)).toEqual({ date: '2026-10-24', shift: 'evening' });
    expect(at(23, 59)).toEqual({ date: '2026-10-24', shift: 'evening' });
  });

  it('หลังเที่ยงคืนก่อน 7 โมง ยังเป็นกะบ่ายของเมื่อวาน — ข้ามเดือนก็ถูก', () => {
    expect(at(0, 30)).toEqual({ date: '2026-10-23', shift: 'evening' });
    expect(L.shiftAt(new Date(2026, 10, 1, 1))).toEqual({ date: '2026-10-31', shift: 'evening' });
  });

  it('วันที่แบบไทย', () => {
    expect(L.dayText('2026-10-24')).toBe('ส. 24 ต.ค. 2569');
  });

  it('ค้างมากี่วัน — ข้ามเดือนก็นับถูก', () => {
    expect(L.age({ date: '2026-10-24' }, '2026-10-24')).toBe(0);
    expect(L.age({ date: '2026-10-30' }, '2026-11-02')).toBe(3);
  });
});

describe('รหัสรายการ', () => {
  it('เวลาเดียวกันแต่เลขสุ่มต่างกัน ได้รหัสต่างกัน', () => {
    const t = new Date(2026, 9, 24, 8);
    expect(L.newId(t, 0.1)).not.toBe(L.newId(t, 0.2));
  });
});

describe('สาเหตุ', () => {
  it('ทุกตัวมีหมวด และเรื่องที่ต้องแจ้ง Logis อยู่หมวด Logis', () => {
    const groups = L.GROUPS.map((g) => g.id);
    L.REASONS.forEach((r) => expect(groups).toContain(r.group));
    expect(L.REASONS.filter((r) => r.logis).every((r) => r.group === 'logis')).toBe(true);
    expect(L.reasonOf('split')).toMatchObject({ label: 'แจ้งแตกล็อต', logis: true });
  });

  it('รหัสที่ไม่รู้จัก (รุ่นเก่า หรือพิมพ์ผิด) นับเป็นอื่น ๆ', () => {
    expect(L.reasonLabel('ไม่รู้ๆ')).toBe('อื่น ๆ');
    expect(L.reasonOf(undefined).id).toBe('other');
  });
});

describe('สินค้าที่ติดของรายการ', () => {
  it('ติ๊กได้หลายตัว — ตัวที่ว่างทุกช่องไม่นับ', () => {
    const e = { items: [{ product: 'หมอน', qty: 2 }, {}, { sku: 'LEG0000000032' }, { product: '' }] };
    expect(L.itemsOf(e)).toEqual([{ product: 'หมอน', qty: 2 }, { sku: 'LEG0000000032' }]);
  });

  it('รายการรุ่นแรกที่เก็บสินค้าตัวเดียวไว้ที่ตัวรายการ ได้เป็นรายการเดียว', () => {
    expect(L.itemsOf({ product: 'ผ้าหุ้ม', size: '', qty: 1, sku: 'LEG0000000032', order: 'CR-1' }))
      .toEqual([{ product: 'ผ้าหุ้ม', qty: 1, sku: 'LEG0000000032' }]);
  });

  it('ไม่ระบุสินค้า (ติดทั้งออเดอร์) ได้รายการว่าง', () => {
    expect(L.itemsOf({ order: 'CR-1', reason: 'nolabel' })).toEqual([]);
    expect(L.itemsOf({ items: [] })).toEqual([]);
    expect(L.itemsOf(null)).toEqual([]);
  });
});

const LOG = {
  a: { date: '2026-10-23', shift: 'evening', kind: 'order', order: 'CR-1', sup: 'KEX HRZ', sku: 'LEG0000000032', product: 'ผ้าหุ้ม', reason: 'out', open: true, at: 3 },
  b: { date: '2026-10-24', shift: 'morning', kind: 'order', order: 'AA-2', sup: 'KEX HRZ', items: [{ sku: 'LEG0000000032' }, { sku: 'LEG0000000032', size: 'King' }, { product: 'ผ้าห่ม' }], reason: 'at_in', open: false, result: 'shipped', at: 5, closedAt: new Date(2026, 9, 26, 10).getTime() },
  c: { date: '2026-10-24', shift: 'morning', kind: 'handover', text: 'รถ Kerry ยังไม่มารับ', open: true, at: 2 },
  d: { date: '2026-10-24', shift: 'evening', kind: 'order', order: 'TP-3', sup: 'Flash', items: [{ product: 'หมอน' }], reason: 'split', logis: true, open: true, at: 9 },
  e: { date: '2026-10-10', shift: 'evening', kind: 'order', order: 'CR-4', sup: 'KEX HRZ', product: 'หมอน', reason: 'carrier', open: false, result: 'cancelled', at: 1, closedAt: new Date(2026, 9, 10, 20).getTime() },
  f: { date: '2026-09-30', shift: 'morning', kind: 'order', order: 'CR-5', reason: 'damaged', open: false, at: 1 },
};

describe('เรื่องที่ค้าง', () => {
  it('ทุกวันที่ยังเปิดอยู่ เก่าสุดขึ้นก่อน — กะเช้าก่อนกะบ่ายในวันเดียวกัน', () => {
    expect(L.openItems(LOG).map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });

  it('ปิดแล้วหายจากรายการค้าง', () => {
    expect(L.openItems({ ...LOG, a: { ...LOG.a, open: false } }).map((e) => e.id)).toEqual(['c', 'd']);
  });
});

describe('รายการของวันหนึ่ง', () => {
  it('แยกกะ เรียงตามเวลาที่บันทึก', () => {
    const d = L.day(LOG, '2026-10-24');
    expect(d.morning.map((e) => e.id)).toEqual(['c', 'b']);
    expect(d.evening.map((e) => e.id)).toEqual(['d']);
    expect(L.day(LOG, '2026-10-25')).toEqual({ morning: [], evening: [] });
  });
});

describe('สรุปเดือน', () => {
  it('นับออเดอร์แยกสาเหตุ หมวด ขนส่ง และผลลัพธ์ — เรื่องอื่นนับแยก', () => {
    const s = L.month(LOG, '2026-10');
    expect(s).toMatchObject({ orders: 4, handovers: 1, open: 2, openOther: 1, shipped: 1, cancelled: 1 });
    expect(s.byReason).toEqual({ out: 1, at_in: 1, split: 1, carrier: 1 });
    expect(s.byGroup).toEqual({ stock: 1, fetch: 1, logis: 2 });
    expect(s.bySup).toEqual({ 'KEX HRZ': 3, Flash: 1 });
    expect(s.byShift).toEqual({ morning: 1, evening: 3 });
    expect(s.list.map((e) => e.id)).toEqual(['e', 'a', 'b', 'd']);
  });

  it('สินค้าที่ติดบ่อยขึ้นก่อน — SKU เดียวกันรวมกัน ชื่อมาจากแถวที่มีชื่อ', () => {
    const s = L.month(LOG, '2026-10');
    // ออเดอร์ AA-2 ติ๊ก LEG สองแถว (คนละขนาด) นับเป็นหนึ่งออเดอร์
    expect(s.products[0]).toEqual({ key: 'LEG0000000032', sku: 'LEG0000000032', product: 'ผ้าหุ้ม', n: 2 });
    expect(s.products.find((p) => p.key === 'หมอน').n).toBe(2);
    expect(s.products.find((p) => p.key === 'ผ้าห่ม').n).toBe(1);
  });

  it('เวลาจนปิดงาน — ปิดวันเดียวกันนับ 0 วัน', () => {
    expect(L.month(LOG, '2026-10').closeDays).toEqual({ n: 2, avg: 1 });
  });

  it('เดือนอื่นไม่ปน', () => {
    const s = L.month(LOG, '2026-09');
    expect(s.orders).toBe(1);
    expect(s.byReason).toEqual({ damaged: 1 });
    expect(s.closeDays).toEqual({ n: 0, avg: 0 });
  });
});

describe('เติมข้อมูลจากเลขออเดอร์', () => {
  const rows = [
    { orderID: 'CR-94576', sup: 'KEX HRZ', consign: 'KEX2210690014', brand: 'ผ้าหุ้ม Lunio Gen 4 ขนาด 6FT (LEG0000000032)', size: 'King', qty1: 1 },
    { orderID: 'CR-94576', sup: 'KEX HRZ', consign: 'KEX2210690014', brand: 'หมอน (FRE0000000216)', size: '', qty1: '2' },
    { orderID: 'CR-94576', sup: 'KEX HRZ', consign: 'KEX2210690014', brand: 'หมอน (FRE0000000216)', size: '', qty1: '2' },
    { orderID: 'AA-1', sup: 'Flash', brand: 'ที่นอน', qty1: 1 },
  ];

  it('ได้ทุกสินค้าของออเดอร์ แถวซ้ำ (รอบเช้ากับ CRM) เหลือแถวเดียว และแยก SKU จากชื่อ', () => {
    expect(L.orderLines(rows, ' cr-94576 ')).toEqual([
      { sup: 'KEX HRZ', consign: 'KEX2210690014', product: 'ผ้าหุ้ม Lunio Gen 4 ขนาด 6FT (LEG0000000032)', size: 'King', qty: 1, sku: 'LEG0000000032' },
      { sup: 'KEX HRZ', consign: 'KEX2210690014', product: 'หมอน (FRE0000000216)', size: '', qty: 2, sku: 'FRE0000000216' },
    ]);
  });

  it('ชื่อที่ไม่มีรหัสในวงเล็บ SKU ว่าง · ไม่เจอออเดอร์ได้รายการว่าง', () => {
    expect(L.orderLines(rows, 'AA-1')[0]).toMatchObject({ sup: 'Flash', product: 'ที่นอน', sku: '', consign: '' });
    expect(L.orderLines(rows, 'XX-9')).toEqual([]);
    expect(L.orderLines(null, 'AA-1')).toEqual([]);
    expect(L.orderLines(rows, '')).toEqual([]);
  });
});
