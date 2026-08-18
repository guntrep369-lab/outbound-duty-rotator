import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/wms-pick.js — the counting and grouping behind the picking
 * sheet, now shared with the stock-check tab after สรุปหยิบของ moved out into
 * its own module.
 *
 * The order of the grouping rules is load-bearing and easy to break by
 * "tidying": ท๊อปเปอร์ before ที่นอน, เครื่องนวด before หมอน, ปลอกหมอน before
 * หมอน. Each of those is a case here, because a name matching the wrong rule
 * moves an item to the wrong part of the sheet and someone walks to the wrong
 * shelf.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-pick.js'), 'utf8');

let P;
beforeEach(() => {
  const win = {};
  new Function('window', SRC)(win);
  P = win.WmsPick;
});

const row = (over = {}) => Object.assign({
  orderID: 'A1', brand: 'ที่นอนสปริง 6 ฟุต (AAA10001)', qty1: 2,
  giftRaw: '', qtyRaw: '', customer: 'คุณเอ', sup: 'Lunio',
}, over);

describe('extractSKU', () => {
  it('อ่านรหัสในวงเล็บท้ายชื่อ', () => {
    expect(P.extractSKU('แถม - หมอนสุขภาพ Lunio Moon Breeze Pillow (FRE0000000216)')).toBe('FRE0000000216');
  });
  it('ไม่มีวงเล็บ = ไม่มีรหัส ไม่ใช่เดา', () => {
    expect(P.extractSKU('ที่นอน 6 ฟุต')).toBeNull();
    expect(P.extractSKU('')).toBeNull();
  });
});

describe('aggregateSKUDemand — นับของที่ต้องหยิบ', () => {
  it('รวมจำนวนของ SKU เดียวกันข้ามออเดอร์', () => {
    const d = P.aggregateSKUDemand([
      row({ orderID: 'A1', qty1: 2 }),
      row({ orderID: 'A2', qty1: 3 }),
    ]);
    expect(d.AAA10001.qty).toBe(5);
    expect(Object.keys(d.AAA10001.orderMap).sort()).toEqual(['A1', 'A2']);
  });

  it('ของแถมหลายรายการในเซลล์เดียว แตกตามบรรทัดและจับคู่จำนวนถูกบรรทัด', () => {
    // แถวจริงจากชีต: ของแถม 6 รายการ จำนวน 2/1/2/2/1/1 คั่นด้วยขึ้นบรรทัด
    const d = P.aggregateSKUDemand([row({
      giftRaw: 'แถม - หมอนสุขภาพ (FRE0000000216)\nแถม - หมอนพิงหลัง (FRE0000000139)\nLong Only (FRE0000000172)',
      qtyRaw: '2\n1\n2',
    })]);
    expect(d.FRE0000000216.qty).toBe(2);
    expect(d.FRE0000000139.qty).toBe(1);
    expect(d.FRE0000000172.qty).toBe(2);
    expect(d.FRE0000000216.type).toBe('gift');
  });

  it('จำนวนของแถมที่ขาดบรรทัด นับเป็น 1 ไม่ใช่ 0 หรือ NaN', () => {
    const d = P.aggregateSKUDemand([row({ giftRaw: 'หมอน (FRE0000000216)', qtyRaw: '' })]);
    expect(d.FRE0000000216.qty).toBe(1);
  });

  it('ของที่ไม่มีรหัสในชื่อ ไม่ถูกนับเข้าใบ', () => {
    const d = P.aggregateSKUDemand([row({ brand: 'ที่นอนไม่มีรหัส' })]);
    expect(Object.keys(d)).toHaveLength(0);
  });

  it('เก็บลูกค้าและ Sup ไว้กับแต่ละออเดอร์ ใช้บอกว่าของกองนี้ของใคร', () => {
    const d = P.aggregateSKUDemand([row({ customer: 'คุณโสภา', sup: 'Nooz' })]);
    expect(d.AAA10001.orderMap.A1).toMatchObject({ customer: 'คุณโสภา', sup: 'Nooz', qty: 2 });
  });
});

describe('จัดกลุ่ม — ลำดับกฎมีความหมาย', () => {
  const cat = (name, type = 'bed') => P.categoryOf({ sku: 'X', name, type }, {}).label;

  it('ท๊อปเปอร์มาก่อนที่นอน แม้ชื่อจะมีคำว่าที่นอนอยู่ด้วย', () => {
    expect(cat('ท๊อปเปอร์ที่นอน 5 ฟุต')).toContain('ท๊อปเปอร์');
    expect(cat('Mattress Topper 6FT')).toContain('ท๊อปเปอร์');
    expect(cat('ที่นอนสปริง 6 ฟุต')).toContain('ที่นอน');
  });

  it('เครื่องนวดมาก่อนหมอน ไม่งั้น "หมอนนวด" ตกกลุ่มหมอน', () => {
    expect(cat('เครื่องนวดคอ', 'gift')).toContain('เครื่องนวด');
    expect(cat('ปืนนวดกล้ามเนื้อ', 'gift')).toContain('เครื่องนวด');
  });

  it('ปลอกหมอนมาก่อนหมอน', () => {
    expect(cat('แถม - ปลอกหมอนข้าง (1 pcs)', 'gift')).toBe('ปลอกหมอน');
    expect(cat('แถม - หมอนสุขภาพ', 'gift')).toBe('หมอน');
  });

  it('รับได้ทั้ง โน๊ตบุ๊ค และ โน้ตบุ๊ค', () => {
    for (const n of ['ที่วางโน๊ตบุ๊ค', 'ที่วางโน้ตบุ๊ค', 'แขนจับจอ']) {
      expect(cat(n, 'gift')).toContain('แขนจับจอ');
    }
  });

  it('ของที่ไม่เข้ากฎไหนเลย ไปอยู่ "อื่น ๆ" ไม่ใช่หายไปจากใบ', () => {
    expect(cat('ของแปลกที่ไม่เคยมีใครเห็น', 'gift')).toBe('อื่น ๆ');
  });

  it('ชื่อจากสต๊อกชนะชื่อจากไฟล์ออเดอร์ เพราะระบุประเภทชัดกว่า', () => {
    const item = { sku: 'A1', name: 'ของอะไรก็ไม่รู้', type: 'gift' };
    const stock = { A1: { description: 'แถม - ปลอกหมอนข้าง' } };
    expect(P.categoryOf(item, stock).label).toBe('ปลอกหมอน');
    expect(P.categoryOf(item, {}).label).toBe('อื่น ๆ');
  });
});

describe('ลำดับกลุ่มบนใบ', () => {
  it('กลุ่มที่ทำเครื่องหมาย last ไว้ ลงท้ายสุดเสมอ — ต่ำกว่า "อื่น ๆ" ด้วย', () => {
    const chair = P.GIFT_CATS.find((c) => c.last);
    expect(chair).toBeTruthy();
    expect(P.rankOf(chair, P.GIFT_CATS)).toBe(999);
    expect(P.rankOf({ label: 'อื่น ๆ', re: null }, P.GIFT_CATS)).toBe(99);
    expect(P.rankOf(P.GIFT_CATS[0], P.GIFT_CATS)).toBe(0);
  });
});

describe('pickSize', () => {
  it('อ่านขนาดฟุตจากชื่อ', () => {
    expect(P.pickSize('ที่นอน 6FT')).toBe(6);
    expect(P.pickSize('ท๊อปเปอร์ 3.5 ฟุต')).toBe(3.5);
    expect(P.pickSize('หมอน')).toBeNull();
  });
});

/**
 * โซนหยิบ FRE — ของรหัสขึ้นต้น FRE เก็บอยู่ติดกันในคลัง
 *
 * ในข้อมูลจริง 151 บรรทัดของแถม เป็น FRE 98 บรรทัด (65%) และปนอยู่ในหลายประเภท:
 * กลุ่ม "หมอน" มี FRE 40 ปนกับรหัสอื่น 14 · "ผ้านวม/ผ้าห่ม" ปนเกือบครึ่งต่อครึ่ง
 * การแบ่งตามประเภทอย่างเดียวจึงแยกโซนให้ไม่ได้
 */
describe('โซนหยิบ FRE', () => {
  const item = (sku) => ({ sku });

  it('รหัสขึ้นต้น FRE คือของในโซน', () => {
    expect(P.inFreZone(item('FRE0000000021'))).toBe(true);
    expect(P.inFreZone(item('FRE0000000190'))).toBe(true);
  });

  it('รหัสอื่นไม่ใช่ — รวมถึงรหัสที่มี FRE อยู่กลางคำ', () => {
    for (const s of ['LNO0000000213', 'LEG0000000012', 'ZCP0000000001',
                     'DAM0000000002', 'MNS0000000001', 'XFRE0000000021']) {
      expect(P.inFreZone(item(s)), s).toBe(false);
    }
  });

  it('ไม่มีรหัสก็ไม่ใช่ ไม่ใช่พังหรือเดาให้', () => {
    for (const v of [item(''), item(null), item(undefined), {}, null]) {
      expect(P.inFreZone(v)).toBe(false);
    }
  });

  it('แยกโซนแล้วของต้องครบเท่าเดิม ไม่หายไม่ซ้ำ', () => {
    const list = ['FRE1000001', 'LNO1000002', 'FRE1000003', 'LEG1000004'].map(item);
    const fre = list.filter((x) => P.inFreZone(x));
    const rest = list.filter((x) => !P.inFreZone(x));
    expect(fre).toHaveLength(2);
    expect(rest).toHaveLength(2);
    expect(fre.length + rest.length).toBe(list.length);
  });
});
