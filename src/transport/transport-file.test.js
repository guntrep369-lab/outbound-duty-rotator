import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/transport-docs/transport-file.js.
 *
 * That file ships as a classic script because the tool pages are not modules,
 * so it is evaluated here the way a browser would — with a window stub — rather
 * than imported. This tests the file that actually ships, not a copy of it.
 */
let TransportFile;

beforeAll(() => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../public/transport-docs/transport-file.js'),
    'utf8'
  );
  const win = {};
  new Function('window', 'sessionStorage', 'console', src)(
    win,
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    { warn: () => {} }
  );
  TransportFile = win.TransportFile;
});

/** The layout every tool reads, straight from the column hints on the pages. */
const REAL_HEADER = [
  'ชื่อรถ', 'Date', 'Sup', 'เลขOrder', 'แบรนด์', 'ขนาด', 'จำนวน', 'ของแถม', 'จำนวน(แถม)',
  'ชื่อลูกค้า', 'Phone 1', 'Phone 2', 'ที่อยู่', 'เวลานัด', 'การเงิน', 'หมายเหตุ',
  'Platform_Order', 'เครื่องรูดบัตร',
];

describe('COLS', () => {
  it('maps every column the three tools use', () => {
    expect(TransportFile.COLS).toEqual({
      truck: 0, date: 1, sup: 2, order: 3, brand: 4, size: 5, qty: 6,
      gift: 7, giftQty: 8, customer: 9, phone1: 10, phone2: 11,
      address: 12, time: 13, payment: 14, remark: 15, platform: 16, cardMachine: 17,
    });
  });

  it('assigns each spreadsheet column exactly once', () => {
    const idx = Object.values(TransportFile.COLS);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('lines up with the header the team actually exports', () => {
    // A→truck … R→cardMachine. If this fails the file changed, not the code.
    const C = TransportFile.COLS;
    expect(REAL_HEADER[C.truck]).toBe('ชื่อรถ');
    expect(REAL_HEADER[C.brand]).toBe('แบรนด์');
    expect(REAL_HEADER[C.customer]).toBe('ชื่อลูกค้า');
    expect(REAL_HEADER[C.address]).toBe('ที่อยู่');
    expect(REAL_HEADER[C.cardMachine]).toBe('เครื่องรูดบัตร');
  });
});

describe('checkHeader', () => {
  it('accepts the real export', () => {
    expect(TransportFile.checkHeader(REAL_HEADER).ok).toBe(true);
  });

  it('REGRESSION: catches a column inserted mid-table', () => {
    // The failure this exists for: everything after the insert shifts by one,
    // nothing throws, and the delivery note prints the wrong person's address.
    const shifted = [...REAL_HEADER];
    shifted.splice(4, 0, 'คอลัมน์ใหม่');
    const r = TransportFile.checkHeader(shifted);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.col)).toContain('brand');
  });

  it('reports what it found, so the message can name it', () => {
    const bad = [...REAL_HEADER];
    bad[TransportFile.COLS.address] = 'เบอร์โทร';
    const r = TransportFile.checkHeader(bad);
    expect(r.problems).toEqual([{ col: 'address', expected: 'ที่อยู่', found: 'เบอร์โทร' }]);
  });

  it('tolerates wording changes that do not move anything', () => {
    const reworded = [...REAL_HEADER];
    reworded[0] = 'ชื่อรถ / ทะเบียน';
    reworded[9] = 'ชื่อลูกค้า (ผู้รับ)';
    reworded[12] = 'ที่อยู่จัดส่ง';
    expect(TransportFile.checkHeader(reworded).ok).toBe(true);
  });

  it('accepts an English export', () => {
    const en = [...REAL_HEADER];
    en[0] = 'Truck'; en[3] = 'Order No'; en[4] = 'Brand';
    en[9] = 'Customer'; en[12] = 'Address';
    expect(TransportFile.checkHeader(en).ok).toBe(true);
  });

  it('stays quiet on a blank cell rather than guessing', () => {
    const gap = [...REAL_HEADER];
    gap[TransportFile.COLS.brand] = '';
    expect(TransportFile.checkHeader(gap).ok).toBe(true);
  });

  it('does not throw on a missing or malformed header', () => {
    for (const h of [null, undefined, [], 'not an array']) {
      expect(() => TransportFile.checkHeader(h)).not.toThrow();
      expect(TransportFile.checkHeader(h).ok).toBe(true); // cannot check ≠ wrong
    }
  });
});

/**
 * ชีต Logis เพิ่มคอลัมน์จนเกือบเท่าไฟล์รถแล้ว เหลือต่างกันแค่ "เครื่องรูดบัตร"
 * fromOrders แปลงข้อมูลที่ดึงมาให้อยู่รูปเดียวกับไฟล์ หน้าใบงานขนส่งกับหน้าแจ้ง
 * คนขับที่เขียนไว้กับตำแหน่งคอลัมน์จึงใช้ได้โดยไม่ต้องแก้
 */
describe('fromOrders — ข้อมูลจากการดึงออเดอร์ ให้หน้าที่เขียนไว้กับไฟล์ใช้ได้', () => {
  const C = () => TransportFile.COLS;

  const orderRow = (over = {}) => ({
    truck: 'คัน21 .บัณฑิต', date: '2026-08-19', sup: 'Lunio', orderID: 'M/E-00109',
    brand: 'Lunio Gen 4 (LNO0000000213)', size: 'King', qty1: 2,
    giftRaw: 'แถม-หมอนหนุน', qtyRaw: '1', customer: 'เสือ ธนากร',
    phone1: '083-8187834', phone2: '', address: 'โรบินสัน ศรีสมาน',
    apptTime: '22.00น', payment: 'จ่ายแล้ว', remark: 'งาน Event',
    platform: '98988,', cardMachine: '', ...over,
  });

  it('วางค่าลงตรงตำแหน่งเดียวกับที่อ่านจากไฟล์', () => {
    const [r] = TransportFile.fromOrders([orderRow()]);
    const c = C();
    expect(r[c.truck]).toBe('คัน21 .บัณฑิต');
    expect(r[c.order]).toBe('M/E-00109');
    expect(r[c.brand]).toBe('Lunio Gen 4 (LNO0000000213)');
    expect(r[c.qty]).toBe(2);
    expect(r[c.customer]).toBe('เสือ ธนากร');
    expect(r[c.address]).toBe('โรบินสัน ศรีสมาน');
    expect(r[c.time]).toBe('22.00น');
    expect(r[c.payment]).toBe('จ่ายแล้ว');
    expect(r[c.remark]).toBe('งาน Event');
    expect(r[c.platform]).toBe('98988,');
  });

  it('ยาวเท่าจำนวนคอลัมน์จริง และไม่มีช่อง undefined ให้หน้าอื่นไปเจอ', () => {
    const [r] = TransportFile.fromOrders([orderRow()]);
    expect(r).toHaveLength(Object.keys(C()).length);
    expect(r.every((v) => v !== undefined)).toBe(true);
  });

  it('ตัดแถวที่ไม่รู้คันรถทิ้ง — ขนส่งเจ้าอื่นไม่ใช่งานของรถบริษัท', () => {
    const rows = TransportFile.fromOrders([
      orderRow(), orderRow({ truck: '', orderID: 'KX-1' }), orderRow({ orderID: 'M/E-2' }),
    ]);
    expect(rows.map((r) => r[C().order])).toEqual(['M/E-00109', 'M/E-2']);
  });

  it('ไม่มีแถวเลยก็ต้องไม่พัง', () => {
    expect(TransportFile.fromOrders([])).toEqual([]);
    expect(TransportFile.fromOrders(null)).toEqual([]);
  });

  it('hasCardMachine บอกตรง ๆ ว่าชีตให้ข้อมูลเครื่องรูดบัตรมาหรือยัง', () => {
    expect(TransportFile.hasCardMachine([orderRow()])).toBe(false);
    expect(TransportFile.hasCardMachine([orderRow({ cardMachine: 'เครื่อง 3' })])).toBe(true);
    expect(TransportFile.hasCardMachine([])).toBe(false);
  });
});
