import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/wms-stock.js — one file decides, for the whole system,
 * what "เหลือน้อย" means and whether someone has to walk to the QA warehouse.
 *
 * Four places depend on it: the เช็คสต๊อก tab, the สต๊อกคงเหลือ module, the QA
 * requisition, and the product names the warehouse forms fill in. It had no
 * automated coverage at all — the rules were only ever checked by hand in a
 * browser, and those checks vanish when the tab closes.
 *
 * The shipped file is evaluated the way a browser would run it.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-stock.js'), 'utf8');

let WmsStock, session, local;

beforeEach(() => {
  session = new Map();
  local = new Map();
  const bind = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });
  const win = {};
  new Function('window', 'sessionStorage', 'localStorage', 'console', SRC)(
    win, bind(session), bind(local), { warn: () => {} }
  );
  WmsStock = win.WmsStock;
});

/** รูปแบบที่ stock-api.gs ตัวที่ใช้งานจริงตอบกลับมา: array of objects */
const arrayFormat = [
  { SKU: 'AAA10001', Description: 'ที่นอนสปริง 6 ฟุต', QA: 20, 'NEW WH': 3, Total: 23 },
  { SKU: 'AAA10002', Description: 'หมอนหนุน Emmas',   QA: 0,  'NEW WH': 2, Total: 2 },
  { SKU: 'AAA10003', Description: 'ท๊อปเปอร์ 5 ฟุต',  QA: 5,  'NEW WH': 0, Total: 5 },
];

describe('parse — อ่านคำตอบของ stock-api', () => {
  it('อ่านรูปแบบ array of objects ที่สคริปต์จริงส่งมา', () => {
    const { map, count } = WmsStock.parse(arrayFormat);
    expect(count).toBe(3);
    expect(map.AAA10001).toEqual({
      sku: 'AAA10001', description: 'ที่นอนสปริง 6 ฟุต', qa: 20, newwh: 3, total: 23,
    });
  });

  it('อ่านรูปแบบ headers/rows ได้เหมือนกันทุกค่า', () => {
    const { map } = WmsStock.parse({
      headers: ['SKU', 'Description', 'QA', 'NEW WH', 'Total'],
      rows: [['AAA10001', 'ที่นอนสปริง 6 ฟุต', 20, 3, 23]],
    });
    expect(map.AAA10001.qa).toBe(20);
    expect(map.AAA10001.newwh).toBe(3);
    expect(map.AAA10001.description).toBe('ที่นอนสปริง 6 ฟุต');
  });

  it('ช่องตัวเลขที่ว่างหรือเป็นข้อความ อ่านเป็น 0 ไม่ใช่ NaN', () => {
    // NaN จะทำให้การเทียบทุกอย่างเป็น false เงียบ ๆ แล้วของที่หมดจะดูเหมือนปกติ
    const { map } = WmsStock.parse([{ SKU: 'X1', Description: 'ก', QA: '', 'NEW WH': '-', Total: null }]);
    expect(map.X1).toMatchObject({ qa: 0, newwh: 0, total: 0 });
  });

  it('แถวที่ไม่มี SKU ถูกข้าม', () => {
    const { count } = WmsStock.parse(arrayFormat.concat([{ SKU: '  ', Description: 'ไม่มีรหัส' }]));
    expect(count).toBe(3);
  });

  it('error จากสคริปต์ต้องโยนออกมาพร้อมข้อความเดิม', () => {
    expect(() => WmsStock.parse({ error: 'ไม่พบ Sheet: Stock' })).toThrow(/ไม่พบ Sheet: Stock/);
  });

  it('ไม่มีคอลัมน์ SKU ต้องฟ้องพร้อมบอกหัวคอลัมน์ที่ได้มา', () => {
    expect(() => WmsStock.parse({ headers: ['รหัส', 'ชื่อ'], rows: [['A', 'B']] }))
      .toThrow(/รหัส, ชื่อ/);
  });

  it('รูปแบบที่ไม่รู้จัก และชีตที่ไม่มีแถวเลย ต้องฟ้อง ไม่ใช่คืน map ว่าง', () => {
    expect(() => WmsStock.parse({ nonsense: 1 })).toThrow(/รูปแบบไม่รองรับ/);
    expect(() => WmsStock.parse([])).toThrow(/ไม่พบข้อมูล SKU/);
  });
});

describe('กฎเบิก QA', () => {
  it('ของกองที่ QA มากกว่าที่หน้าคลัง = ต้องไปเบิก', () => {
    expect(WmsStock.needsQa({ qa: 20, newwh: 3 })).toBe(true);
  });

  it('เท่ากันไม่นับ — ตกลงกันไว้ว่า "มากกว่า"', () => {
    expect(WmsStock.needsQa({ qa: 5, newwh: 5 })).toBe(false);
  });

  it('หน้าคลังมีมากกว่า = หยิบได้เลย', () => {
    expect(WmsStock.needsQa({ qa: 1, newwh: 50 })).toBe(false);
  });

  it('ไม่มีข้อมูลสินค้าตัวนั้น = ไม่ใช่ "ต้องเบิก"', () => {
    // ไม่มีในไฟล์สต๊อกเป็นคนละเรื่องกับมีแต่อยู่ผิดคลัง อย่าเดาแทน
    expect(WmsStock.needsQa(null)).toBe(false);
    expect(WmsStock.needsQa(undefined)).toBe(false);
  });

  it('ใช้กับข้อมูลจริงแล้วได้เฉพาะตัวที่ควรได้', () => {
    const { map } = WmsStock.parse(arrayFormat);
    expect(Object.values(map).filter(WmsStock.needsQa).map((r) => r.sku))
      .toEqual(['AAA10001', 'AAA10003']);
  });
});

describe('เกณฑ์เหลือน้อย', () => {
  it('เป็นจำนวนชิ้นตรง ๆ ไม่ผูกกับยอดที่สั่งวันนี้', () => {
    expect(WmsStock.LOW_QTY).toBe(10);
  });

  it('ต่ำกว่าเกณฑ์เท่านั้นที่นับ ไม่รวมตัวที่เท่าพอดี', () => {
    const { map } = WmsStock.parse([
      { SKU: 'A', Description: 'ก', QA: 0, 'NEW WH': 9,  Total: 9 },
      { SKU: 'B', Description: 'ข', QA: 0, 'NEW WH': 10, Total: 10 },
    ]);
    const low = Object.values(map).filter((r) => r.total < WmsStock.LOW_QTY).map((r) => r.sku);
    expect(low).toEqual(['A']);
  });
});

describe('แคชสต๊อกของวันนี้', () => {
  it('เก็บแล้วอ่านกลับได้ พร้อมที่มาของข้อมูล', () => {
    const { map } = WmsStock.parse(arrayFormat);
    WmsStock.save(map, 1700000000000, { source: 'gas', url: 'https://x/exec' });
    const back = WmsStock.read();
    expect(back.at).toBe(1700000000000);
    expect(back.source).toBe('gas');
    expect(Object.keys(back.map)).toHaveLength(3);
  });

  it('ไม่มีอะไรเก็บไว้ = null', () => {
    expect(WmsStock.read()).toBeNull();
  });

  it('map ว่างไม่ถูกเก็บ — จะได้ไม่มีแคชที่ทำให้หน้าคิดว่าดึงแล้วแต่ไม่มีของ', () => {
    WmsStock.save({}, Date.now(), { source: 'gas' });
    expect(WmsStock.read()).toBeNull();
  });

  it('ยอดคงเหลืออยู่ใน sessionStorage เท่านั้น — ปิดเบราว์เซอร์แล้วต้องหาย', () => {
    WmsStock.save(WmsStock.parse(arrayFormat).map, Date.now(), { source: 'gas' });
    expect(session.has(WmsStock.KEY)).toBe(true);
    expect(local.has(WmsStock.KEY)).toBe(false);
  });
});

describe('ชื่อสินค้าที่ได้จากการดึงสต๊อก', () => {
  it('เก็บอัตโนมัติทุกครั้งที่ดึงสต๊อก ฟอร์มคลังจึงไม่ต้องอัปไฟล์ซ้ำ', () => {
    WmsStock.save(WmsStock.parse(arrayFormat).map, Date.now(), { source: 'gas' });
    const n = WmsStock.names();
    expect(n.count).toBe(3);
    expect(n.names.AAA10002).toBe('หมอนหนุน Emmas');
  });

  it('อยู่ใน localStorage ต่างจากยอดคงเหลือ — ชื่อสินค้าค้างข้ามวันได้ ยอดไม่ได้', () => {
    WmsStock.save(WmsStock.parse(arrayFormat).map, Date.now(), { source: 'gas' });
    expect(local.has(WmsStock.NAMES_KEY)).toBe(true);
    expect(session.has(WmsStock.NAMES_KEY)).toBe(false);
  });

  it('ไม่เก็บช่องชื่อที่ว่าง', () => {
    WmsStock.save(WmsStock.parse([
      { SKU: 'A', Description: 'มีชื่อ', QA: 1, 'NEW WH': 1, Total: 2 },
      { SKU: 'B', Description: '',       QA: 1, 'NEW WH': 1, Total: 2 },
    ]).map, Date.now(), { source: 'gas' });
    expect(Object.keys(WmsStock.names().names)).toEqual(['A']);
  });

  it('ไฟล์สต๊อกที่ไม่มีชื่อสินค้าเลย ต้องไม่ไปลบชื่อที่เก็บไว้แล้ว', () => {
    // ชีตที่หัวคอลัมน์ชื่อสินค้าเปลี่ยนไปจะอ่านชื่อไม่ได้ทั้งไฟล์ — ถ้าปล่อยให้เขียนทับ
    // ฟอร์มคลังทุกใบจะเลิกเติมชื่อพร้อมกันโดยไม่มีอะไรบอกว่าเกิดจากอะไร
    WmsStock.save(WmsStock.parse(arrayFormat).map, Date.now(), { source: 'gas' });
    WmsStock.save(WmsStock.parse([{ SKU: 'Z', Description: '', QA: 0, 'NEW WH': 0, Total: 0 }]).map,
                  Date.now(), { source: 'gas' });
    expect(WmsStock.names().count).toBe(3);
  });

  it('ยังไม่เคยดึง = null ไม่ใช่ object ว่าง', () => {
    expect(WmsStock.names()).toBeNull();
  });
});
