/**
 * public/shiftlog/shiftlog.js — สมุดกะ
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');
const win = {};
new Function('window', read('wms-pick.js'))(win);
new Function('window', read('wms-shifts.js'))(win);
new Function('window', read('shiftlog/shiftlog.js'))(win);
const L = win.ShiftLog;

// คาบที่เริ่ม 13 ธ.ค. กะที่ 2 เปลี่ยนจากกะบ่ายเป็นกะสาย 10:00-19:00 (ทำงานทับกับกะเช้า 10:00–16:00)
const LATE = [{
  from: '2026-12-13',
  shifts: { morning: { name: 'กะเช้า', start: '07:00', end: '16:00' }, evening: { name: 'กะสาย', start: '10:00', end: '19:00' } },
}];

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

describe('รับทราบงานต่อ', () => {
  // กะเช้า 28 ต.ค. 08:00 — งานจากกะบ่ายเมื่อวานกับก่อนหน้า ส่งต่อมาถึงกะนี้
  const now = new Date(2026, 9, 28, 8);
  const T = (d, h) => new Date(2026, 9, d, h).getTime();
  const base = () => ({
    a: { kind: 'order', date: '2026-10-27', shift: 'evening', open: true, at: T(27, 17) },
    b: { kind: 'handover', date: '2026-10-26', shift: 'morning', open: true, at: T(26, 9) },
    c: { kind: 'order', date: '2026-10-27', shift: 'morning', open: false, at: T(27, 9) },
    d: { kind: 'order', date: '2026-10-28', shift: 'morning', open: true, at: T(28, 7) },
  });
  const ack = (at, by = 'สมชาย') => ({ kind: 'ack', date: '2026-10-28', shift: 'morning', by, at });

  it('งานค้างจากกะก่อน ๆ คืองานส่งต่อ — งานที่กะนี้เพิ่งบันทึกเองกับงานที่ปิดแล้วไม่นับ', () => {
    const s = L.handover(base(), now);
    expect(s).toMatchObject({ date: '2026-10-28', shift: 'morning', ack: null, needs: true });
    expect(s.items.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('กดรับทราบแล้ว — ไม่ต้องเตือน · ใครกด กดเมื่อไหร่ เก็บไว้ที่กะนั้น', () => {
    const log = base();
    log[L.ackId('2026-10-28', 'morning')] = ack(T(28, 7));
    const s = L.handover(log, now);
    expect(s.needs).toBe(false);
    expect(s.ack.by).toBe('สมชาย');
    expect(L.ackOf(log, '2026-10-28', 'evening')).toBe(null);
  });

  it('มีงานของกะก่อนเข้ามาหลังกดรับทราบ (อีกเครื่องเพิ่งส่งขึ้นชีต) — ต้องรับทราบใหม่', () => {
    const log = base();
    log[L.ackId('2026-10-28', 'morning')] = ack(T(27, 16));
    expect(L.handover(log, now).needs).toBe(true);
  });

  it('ไม่มีงานส่งต่อมา — ไม่ต้องกดอะไร', () => {
    const log = { d: base().d };
    expect(L.handover(log, now)).toMatchObject({ items: [], needs: false });
  });

  it('กะบ่ายรับงานของกะเช้าวันเดียวกันด้วย — และหลังเที่ยงคืนยังเป็นกะบ่าย', () => {
    const s = L.handover(base(), new Date(2026, 9, 28, 16, 5));
    expect(s.shift).toBe('evening');
    expect(s.items.map((e) => e.id)).toEqual(['b', 'a', 'd']);
    expect(L.handover(base(), new Date(2026, 9, 29, 1)).date).toBe('2026-10-28');
  });

  it('รายการรับทราบไม่ใช่งาน — ไม่ขึ้นในงานค้าง รายวัน หรือสรุปเดือน', () => {
    const log = base();
    log[L.ackId('2026-10-28', 'morning')] = ack(T(28, 7));
    expect(L.openItems(log).map((e) => e.id)).toEqual(['b', 'a', 'd']);
    expect(L.day(log, '2026-10-28').morning.map((e) => e.id)).toEqual(['d']);
    expect(L.month(log, '2026-10')).toMatchObject({ orders: 3, handovers: 1 });
  });

  it('เลขบนเมนูใช้กฎเดียวกับหน้าสมุดกะ', async () => {
    const { needsAck } = await import('../../public/wms-badges.js');
    const late = base(); late[L.ackId('2026-10-28', 'morning')] = ack(T(27, 16));
    const done = base(); done[L.ackId('2026-10-28', 'morning')] = ack(T(28, 7));
    const cases = [base(), late, done, { d: base().d }, {}];
    const times = [now, new Date(2026, 9, 28, 16, 5), new Date(2026, 9, 29, 1), new Date(2026, 9, 28, 6, 59)];
    for (const log of cases) for (const t of times) {
      expect(needsAck(log, t)).toBe(L.handover(log, t).needs);
    }
  });
});

describe('เปลี่ยนกะที่ 2 เป็นกะสาย 10:00-19:00 (ค่าตั้งกะ)', () => {
  const D = (d, h, m = 0) => new Date(2026, 11, d, h, m);
  const T = (d, h, m = 0) => D(d, h, m).getTime();
  // 12 ธ.ค. ยังเป็นคาบเก่า (กะบ่าย) · 13 ธ.ค. เป็นต้นไปกะสาย
  const log = () => ({
    old: { kind: 'order', date: '2026-12-12', shift: 'evening', open: true, at: T(12, 20) },
    m14: { kind: 'order', date: '2026-12-14', shift: 'morning', open: true, at: T(14, 8) },
    l14: { kind: 'order', date: '2026-12-14', shift: 'evening', open: true, at: T(14, 18) },
  });

  it('ชื่อกะของรายการคือชื่อที่ใช้ ณ วันนั้น — รายการก่อนเปลี่ยนยังเป็นกะบ่าย', () => {
    const l = log();
    expect(L.shiftName(l.old, LATE)).toBe('กะบ่าย');
    expect(L.shiftName(l.l14, LATE)).toBe('กะสาย');
    expect(L.shiftName(l.m14, LATE)).toBe('กะเช้า');
    expect(L.shiftName(l.l14, [])).toBe('กะบ่าย');
    expect(L.shiftsOn('2026-12-14', LATE).map((s) => s.name + ' ' + s.start)).toEqual(['กะเช้า 07:00', 'กะสาย 10:00']);
    expect(L.shiftsOn('2026-12-12', LATE).map((s) => s.name + ' ' + s.start)).toEqual(['กะเช้า 07:00', 'กะบ่าย 16:00']);
  });

  it('รายการใหม่ลงกะที่เข้างานล่าสุด — 10:00 เป็นต้นไปเป็นกะสาย', () => {
    expect(L.shiftAt(D(14, 9, 59), LATE)).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(L.shiftAt(D(14, 10), LATE)).toEqual({ date: '2026-12-14', shift: 'evening' });
    expect(L.shiftAt(D(15, 3), LATE)).toEqual({ date: '2026-12-14', shift: 'evening' });
  });

  it('กะสายไม่ต้องรับทราบงานต่อ — ทั้งวันเป็นกะเช้าที่ต้องกด และรับเฉพาะงานของวันก่อน ๆ', () => {
    // 11:00 กะสายเข้ามาแล้ว แต่คนที่ต้องรับยังเป็นกะเช้าของวันนี้
    const s = L.handover(log(), D(14, 11), LATE);
    expect(s).toMatchObject({ date: '2026-12-14', shift: 'morning', ack: null, needs: true });
    // งานที่บันทึกวันนี้ทั้งสองกะยังไม่ใช่งานส่งต่อ — สองกะทำงานอยู่ด้วยกัน
    expect(s.items.map((e) => e.id)).toEqual(['old']);
  });

  it('กะเช้ากดแล้วเงียบทั้งวัน — เช้าวันรุ่งขึ้นงานที่กะสายฝากไว้ตอน 19:00 ถึงมาให้รับ', () => {
    const l = log();
    l[L.ackId('2026-12-14', 'morning')] = { kind: 'ack', date: '2026-12-14', shift: 'morning', by: 'สมชาย', at: T(14, 7, 5) };
    expect(L.handover(l, D(14, 11), LATE).needs).toBe(false);
    expect(L.handover(l, D(14, 20), LATE).needs).toBe(false);
    expect(L.handover(l, D(15, 6), LATE)).toMatchObject({ date: '2026-12-14', needs: false });
    const next = L.handover(l, D(15, 7), LATE);
    expect(next).toMatchObject({ date: '2026-12-15', shift: 'morning', ack: null, needs: true });
    expect(next.items.map((e) => e.id)).toEqual(['old', 'm14', 'l14']);
  });

  it('ยังไม่ตั้งค่ากะ — เหมือนเดิม กะบ่ายยังต้องรับงานของกะเช้า', () => {
    const s = L.handover(log(), D(14, 16, 5), []);
    expect(s).toMatchObject({ date: '2026-12-14', shift: 'evening', needs: true });
    expect(s.items.map((e) => e.id)).toEqual(['old', 'm14']);
  });

  it('ตั้งไว้ว่าไม่มีกะไหนต้องรับ — ไม่มีอะไรให้กด', () => {
    const none = [{ from: '2026-12-13', shifts: { morning: { ...LATE[0].shifts.morning, ack: false }, evening: LATE[0].shifts.evening } }];
    expect(L.handover(log(), D(14, 11), none)).toMatchObject({ date: '2026-12-14', shift: 'evening', items: [], needs: false });
  });

  it('สรุปเดือนที่เปลี่ยนกะกลางเดือน — นับแยกตามชื่อกะ กะบ่ายกับกะสายไม่ปนกัน', () => {
    const s = L.month(log(), '2026-12', LATE);
    expect(s.byName).toEqual([{ name: 'กะเช้า', n: 1 }, { name: 'กะบ่าย', n: 1 }, { name: 'กะสาย', n: 1 }]);
    expect(s.byShift).toEqual({ morning: 1, evening: 2 });
    expect(L.month(log(), '2027-01', LATE).byName).toEqual([{ name: 'กะเช้า', n: 0 }, { name: 'กะสาย', n: 0 }]);
    expect(L.month(LOG, '2026-10').byName).toEqual([{ name: 'กะเช้า', n: 1 }, { name: 'กะบ่าย', n: 3 }]);
  });

  it('เลขบนเมนูใช้กฎเดียวกับหน้าสมุดกะ ทั้งก่อนและหลังเปลี่ยนกะ', async () => {
    const { needsAck } = await import('../../public/wms-badges.js');
    const acked = log();
    acked[L.ackId('2026-12-14', 'morning')] = { kind: 'ack', date: '2026-12-14', shift: 'morning', at: T(14, 7, 5) };
    const times = [D(13, 3), D(14, 6, 59), D(14, 8), D(14, 11), D(14, 20), D(15, 6), D(15, 7)];
    for (const l of [log(), acked, {}]) for (const t of times) for (const defs of [LATE, []]) {
      expect(needsAck(l, t, defs)).toBe(L.handover(l, t, defs).needs);
    }
  });
});
