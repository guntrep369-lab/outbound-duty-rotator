import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/wms-order-index.js — the code every module's order data
 * passes through on its way from the sheet to a screen.
 *
 * Every order-side defect found this week lived in this file and was caught by
 * hand in a browser, where the check disappears the moment the tab closes:
 *   • "Mon, Aug 17" has no year, so JS supplied 2001
 *   • toISOString() shifted UTC+7 back a day, turning Aug 17 into Aug 16
 *   • เวลานัด repeats as "-" on an order's continuation rows
 *   • the sheet's two quantity columns are "จำนวน 1" and "จำนวน", and which one
 *     is the product depends on their order in the header row
 * Each of those is a case below, written against the headers of the real
 * รถบริษัท (หน้าLogis) sheet rather than headers I invented.
 *
 * The shipped file is evaluated the way a browser would run it, so this tests
 * what deploys rather than a copy.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-order-index.js'), 'utf8');

let OrderIndex;
let store;

beforeEach(() => {
  store = new Map();
  const win = {};
  new Function('window', 'sessionStorage', 'console', SRC)(
    win,
    {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    { warn: () => {} }
  );
  OrderIndex = win.OrderIndex;
});

/**
 * หัวคอลัมน์จริงของชีต รถบริษัท (หน้าLogis) — A ถึง Q ตามลำดับในชีต
 *
 * ลำดับคีย์สำคัญ ไม่ใช่แค่ชื่อ: convertGASRows หา "จำนวน 1" กับ "จำนวน" ด้วยการ
 * ไล่คีย์ตามลำดับที่ Apps Script ใส่มา ซึ่งคือลำดับคอลัมน์ในชีต ถ้าสลับกันเมื่อไหร่
 * จำนวนสินค้ากับจำนวนของแถมจะสลับกันทันทีโดยไม่มีอะไรฟ้อง
 *
 * ชีตนี้ไม่มีคอลัมน์ "เลข consign" — รถบริษัทไม่มีเลขติดตามของขนส่งภายนอก
 * ช่อง Q คือ Platform_Order ซึ่งเป็นเลขออเดอร์ฝั่งแพลตฟอร์มขาย คนละเรื่องกัน
 */
const sheetRow = (over = {}) => ({
  'ชื่อรถ': 'คัน21 .บัณฑิต',
  'Date': 'Mon, Aug 17',
  'Sup': 'Lunio',
  'Order ID': 'AA-92876',
  'แบรนด์': 'Lunio Gen 4 (LNO0000000213)',
  'ขนาด': 'King',
  'จำนวน 1': 1,
  'ของแถม': 'แถม - หมอนสุขภาพ',
  'จำนวน': 2,
  'ชื่อลูกค้า': 'คุณโสภา',
  'Phone 1': '064-7915965',
  'Phone 2': '',
  'ที่อยู่': 'บ้านเลขที่ 37/14',
  'เวลานัด': '13.00น',
  'การเงิน': 'โอนจ่ายปลายทาง',
  'หมายเหตุ': 'ขอช่วงบ่าย',
  'Platform_Order': '98988,',
  ...over,
});

const thisYear = new Date().getFullYear();

describe('convertGASRows — อ่านชีตจริง', () => {
  it('อ่านทุกฟิลด์ที่หน้าอื่นใช้ ด้วยหัวคอลัมน์ของชีตจริง', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow()]);
    expect(r.orderID).toBe('AA-92876');
    // ชีตนี้ไม่มีคอลัมน์ consign — รถบริษัทไม่มีเลขติดตามของขนส่งภายนอก
    // ต้องได้ค่าว่าง ไม่ใช่ไปหยิบคอลัมน์อื่นมาแทนเพราะ "น่าจะใช่"
    expect(r.consign).toBe('');
    expect(r.customer).toBe('คุณโสภา');
    expect(r.address).toBe('บ้านเลขที่ 37/14');
    expect(r.phone1).toBe('064-7915965');
    expect(r.brand).toBe('Lunio Gen 4 (LNO0000000213)');
    expect(r.size).toBe('King');
    expect(r.payment).toBe('โอนจ่ายปลายทาง');
    expect(r.remark).toBe('ขอช่วงบ่าย');
  });

  it('แยกจำนวนสินค้ากับจำนวนของแถมตามลำดับคอลัมน์ในชีต', () => {
    // "จำนวน 1" มาก่อน "จำนวน" ในชีต ตัวแรกคือจำนวนสินค้า ตัวหลังคือของแถม
    const [r] = OrderIndex.convertGASRows([sheetRow({ 'จำนวน 1': 4, 'จำนวน': 9 })]);
    expect(r.qty1).toBe(4);
    expect(r.qtyRaw).toBe('9');
  });

  it('ตัดแถวที่ไม่มีเลขออเดอร์ทิ้ง', () => {
    const rows = OrderIndex.convertGASRows([sheetRow(), sheetRow({ 'Order ID': '' }), sheetRow({ 'Order ID': '  ' })]);
    expect(rows).toHaveLength(1);
  });
});

describe('เวลานัด', () => {
  it('อ่านเวลานัดจากชีตออเดอร์ ไม่ต้องมีไฟล์รถ', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow()]);
    expect(r.apptTime).toBe('13.00น');
  });

  it('"-" ในแถวต่อของออเดอร์เดียวกัน ไม่ใช่เวลานัด', () => {
    // ทีมกรอกเวลาไว้ที่แถวแรก แถวถัดไปใส่ขีด ถ้าไม่ตัดทิ้งจะเอาขีดไปแสดงแทนเวลา
    for (const dash of ['-', '--', ' - ']) {
      const [r] = OrderIndex.convertGASRows([sheetRow({ 'เวลานัด': dash })]);
      expect(r.apptTime).toBe('');
    }
  });

  it('ช่องว่างก็ถือว่าไม่มี', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow({ 'เวลานัด': '' })]);
    expect(r.apptTime).toBe('');
  });
});

/**
 * คอลัมน์ "ชื่อรถ" ถูกแทรกเป็นคอลัมน์แรกของหน้า Logis เพื่อให้รู้คันรถตั้งแต่ตอน
 * ดึงออเดอร์ ไม่ต้องรอทีมขนส่งอัปไฟล์รถก่อน
 *
 * รูปแบบตามไฟล์ตัวอย่างจริง: ชื่อรถซ้ำทุกแถวของคันเดียวกัน และออเดอร์เดียวกิน
 * ได้หลายแถว (M/E-00104 มี 4 แถว) ส่วนชีต CRM กับขนส่งเจ้าอื่นไม่มีคอลัมน์นี้
 */
describe('ชื่อรถ', () => {
  it('อ่านจากคอลัมน์ "ชื่อรถ"', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow()]);
    expect(r.truck).toBe('คัน21 .บัณฑิต');
  });

  it('ติดครบทุกแถวของออเดอร์เดียวกัน และไม่ไปยุ่งกับเวลานัดที่มีแค่แถวแรก', () => {
    const rows = OrderIndex.convertGASRows([
      sheetRow({ 'Order ID': 'M/E-00104', 'เวลานัด': '9.00น' }),
      sheetRow({ 'Order ID': 'M/E-00104', 'เวลานัด': '-' }),
      sheetRow({ 'Order ID': 'M/E-00104', 'เวลานัด': '' }),
    ]);
    expect(rows.map((r) => r.truck)).toEqual(Array(3).fill('คัน21 .บัณฑิต'));
    expect(rows.map((r) => r.apptTime)).toEqual(['9.00น', '', '']);
  });

  it('ชีตที่ไม่มีคอลัมน์นี้ได้ค่าว่าง แล้วดัชนีค้นหาไม่พาคีย์เปล่าไปด้วย', () => {
    const noTruck = sheetRow();
    delete noTruck['ชื่อรถ'];
    const [r] = OrderIndex.convertGASRows([noTruck]);
    expect(r.truck).toBe('');
    const idx = OrderIndex.build([{ key: 'KEX', data1: [r], data2: [] }]);
    expect('truck' in idx[0]).toBe(false);
  });

  it('ขีดกลางแปลว่ายังไม่ระบุ ไม่ใช่รถที่ชื่อว่า "-"', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow({ 'ชื่อรถ': '-' })]);
    expect(r.truck).toBe('');
  });

  it('ดัชนีค้นหาพาชื่อรถไปด้วย ไม่งั้นหน้าค้นหาออเดอร์มองไม่เห็น', () => {
    const rows = OrderIndex.convertGASRows([sheetRow({ 'ชื่อรถ': 'คัน36 วรวิทย์+วนิดา' })]);
    const idx = OrderIndex.build([{ key: 'รถบริษัท', data1: rows, data2: [] }]);
    expect(idx[0].truck).toBe('คัน36 วรวิทย์+วนิดา');
  });
});

/**
 * แถวหัวในชีตเลื่อนไป 2 ช่องโดยข้อมูลไม่เลื่อนตาม ทุกป้ายจึงติดผิดช่องพร้อมกัน
 * ระบบอ่านได้ปกติ ไม่มี error แต่ทุกหน้าแสดงข้อมูลผิดหมด — เคสนี้เกิดขึ้นจริง
 * และไม่มีอะไรจับได้เลยจนมีคนมาอ่านแล้วเอะใจ
 */
describe('จับตอนอ่านผิดช่อง', () => {
  /** แถวแบบที่ได้ตอนหัวเลื่อน: ชื่อลูกค้าตกไปช่องว่าง เวลานัดได้หมายเหตุมาแทน */
  const shifted = (over = {}) => ({
    'ชื่อรถ': 'คัน21 .บัณฑิต',
    'Date': 'Mon, Aug 17',
    'Sup': 'Lunio',
    'Order ID': 'AA-92876',
    'เลข consign': 'Lunio Gen 4 (LNO0000000213)',  // ที่จริงคือแบรนด์
    'Invoice': 'King',                              // ที่จริงคือขนาด
    'แบรนด์': 2,                                    // ที่จริงคือจำนวน
    'ของแถม': 'คุณโสภา',                            // ที่จริงคือชื่อลูกค้า
    'ชื่อลูกค้า': '',                               // ช่องที่เลื่อนมาชนคือช่องว่าง
    'เวลานัด': 'ส่งสินค้า เวลา 09.00 น. /// รบกวนนำของในลิสต์พร้อมมาให้ครบตามใบเบิกด้วยครับ///',
    ...over,
  });

  const carriersOf = (rows) => OrderIndex.parsePayload({
    carriers: [{ key: 'รถบริษัท', sheet1: rows, sheet2: [] }],
  });

  it('ฟ้องเมื่อชื่อลูกค้าว่างทุกแถว', () => {
    const msgs = OrderIndex.sanity(carriersOf([shifted(), shifted({ 'Order ID': 'AA-2' })]));
    expect(msgs.join(' ')).toMatch(/ชื่อลูกค้า.*ว่างทั้ง 2 แถว/);
  });

  it('ฟ้องเมื่อเวลานัดได้ข้อความยาวแบบหมายเหตุ', () => {
    const msgs = OrderIndex.sanity(carriersOf([shifted(), shifted({ 'Order ID': 'AA-2' })]));
    expect(msgs.join(' ')).toMatch(/เวลานัด.*ยาวผิดปกติ/);
  });

  it('ข้อมูลที่หัวตรงกับข้อมูล ต้องเงียบสนิท — เตือนพร่ำเพรื่อแล้วคนจะเลิกอ่าน', () => {
    expect(OrderIndex.sanity(carriersOf([sheetRow(), sheetRow({ 'Order ID': 'AA-2' })]))).toEqual([]);
  });

  /**
   * รุ่นแรกของตัวตรวจนี้รวมทุกชีตมานับด้วยกัน พอ CRM ปกติ (มีชื่อลูกค้า)
   * เงื่อนไข "ว่างทุกแถว" ก็ไม่จริง คำเตือนเลยเงียบทั้งที่ Logis พังอยู่ —
   * ซึ่งคือสภาพจริงบนหน้าจอ: การ์ดโชว์ข้อมูลสลับช่องโดยไม่มีอะไรเตือนเลย
   */
  it('Logis พังแต่ CRM ปกติ ต้องยังฟ้อง และบอกด้วยว่าชีตไหน', () => {
    const msgs = OrderIndex.sanity(OrderIndex.parsePayload({
      carriers: [{
        key: 'รถบริษัท',
        sheet1: [shifted(), shifted({ 'Order ID': 'AA-2' })],
        sheet2: [sheetRow({ 'Order ID': 'AA-9' })],
      }],
    }));
    expect(msgs.join(' ')).toMatch(/รถบริษัท · Logis.*ชื่อลูกค้า.*ว่างทั้ง 2 แถว/);
    expect(msgs.join(' ')).not.toMatch(/CRM/);
  });

  it('ขนส่งเจ้าที่ยังดี ต้องไม่โดนหางเลขจากเจ้าที่พัง', () => {
    const msgs = OrderIndex.sanity(OrderIndex.parsePayload({
      carriers: [
        { key: 'รถบริษัท', sheet1: [shifted()], sheet2: [] },
        { key: 'KEX', sheet1: [sheetRow({ 'Order ID': 'KX-1' })], sheet2: [] },
      ],
    }));
    expect(msgs.every((m) => m.startsWith('รถบริษัท'))).toBe(true);
  });

  it('รายงานหัวคอลัมน์ บอกหัวคู่กับค่าที่อยู่ใต้มันจริง แยกตามชีต', () => {
    const rep = OrderIndex.columnReport(OrderIndex.parsePayload({
      carriers: [{
        key: 'รถบริษัท',
        sheet1: [{ 'ชื่อรถ': 'คัน21', 'Order ID': 'AA-1', 'ชื่อลูกค้า': '' }],
        sheet2: [{ 'Order ID': 'AA-1', 'ชื่อลูกค้า': 'คุณโสภา' }],
      }],
    }));
    expect(rep.map((s) => s.sheet)).toEqual(['รถบริษัท · Logis', 'รถบริษัท · CRM']);
    // ลำดับคอลัมน์ต้องตรงกับที่ชีตส่งมา ไม่งั้นตัวอักษร A/B/C ที่แสดงจะชี้ผิดช่อง
    expect(rep[0].cols.map((c) => c.header)).toEqual(['ชื่อรถ', 'Order ID', 'ชื่อลูกค้า']);
    expect(rep[0].cols[0].values).toEqual(['คัน21']);
    expect(rep[0].cols[2].values).toEqual([]);   // ว่างต้องเห็นว่าว่าง
    expect(rep[1].cols[1].values).toEqual(['คุณโสภา']);
  });

  it('ยังไม่มีข้อมูลก็ไม่ใช่เรื่องผิด', () => {
    expect(OrderIndex.sanity([])).toEqual([]);
    expect(OrderIndex.sanity(carriersOf([]))).toEqual([]);
  });

  it('ลูกค้าบางแถวว่างเป็นเรื่องปกติ ต้องไม่ฟ้อง — ฟ้องเฉพาะตอนว่างครบทุกแถว', () => {
    const msgs = OrderIndex.sanity(carriersOf([
      sheetRow(), sheetRow({ 'Order ID': 'AA-2', 'ชื่อลูกค้า': '' }),
    ]));
    expect(msgs).toEqual([]);
  });
});

describe('วันที่', () => {
  it('"Mon, Aug 17" ไม่มีปี — ต้องเติมปีที่ใกล้วันนี้ ไม่ใช่ 2001 ที่ JS เดาให้', () => {
    const [r] = OrderIndex.convertGASRows([sheetRow({ Date: 'Mon, Aug 17' })]);
    expect(r.date).toBe(`${thisYear}-08-17`);
  });

  it('ไม่เลื่อนวันตามโซนเวลา — Aug 17 ต้องไม่กลายเป็น Aug 16', () => {
    // toISOString() ลบ 7 ชั่วโมงออกจากเวลาไทย แล้ววันที่ถอยไปหนึ่งวันเงียบ ๆ
    const [r] = OrderIndex.convertGASRows([sheetRow({ Date: 'Mon, Aug 17' })]);
    expect(r.date.endsWith('-08-17')).toBe(true);
  });

  it('เขียนปีมาเองก็ใช้ปีนั้น ไม่ไปเดาทับ', () => {
    expect(OrderIndex.convertGASRows([sheetRow({ Date: '2024-03-09' })])[0].date).toBe('2024-03-09');
    expect(OrderIndex.convertGASRows([sheetRow({ Date: 'Sat, Mar 9 2024' })])[0].date).toBe('2024-03-09');
  });

  it('อ่านไม่ออกก็ไม่พัง', () => {
    expect(OrderIndex.convertGASRows([sheetRow({ Date: '' })])[0].date).toBe('');
    expect(() => OrderIndex.convertGASRows([sheetRow({ Date: 'ไม่ใช่วันที่' })])).not.toThrow();
  });
});

describe('parsePayload', () => {
  const payload = (over = {}) => ({
    carriers: [{ key: 'รถบริษัท', sheet1: [sheetRow()], sheet2: [], ...over }],
  });

  it('อ่านรูปแบบหลายขนส่ง', () => {
    const out = OrderIndex.parsePayload(payload());
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('รถบริษัท');
    expect(out[0].data1).toHaveLength(1);
    expect(out[0].data2).toHaveLength(0);
  });

  it('รับฟิลด์ของสคริปต์ v4 — วันที่และคำเตือนวันไม่ตรง', () => {
    const out = OrderIndex.parsePayload(payload({
      date: '2026-08-17', dates1: ['2026-08-17'], dates2: ['2026-08-16'],
      warn: 'วันที่ไม่ตรงกัน', error1: null, error2: null,
    }));
    expect(out[0].date).toBe('2026-08-17');
    expect(out[0].dates2).toEqual(['2026-08-16']);
    expect(out[0].warn).toBe('วันที่ไม่ตรงกัน');
  });

  it('สคริปต์รุ่นเก่าที่ไม่ส่งฟิลด์ใหม่มา ต้องไม่พังและไม่แต่งค่าขึ้นเอง', () => {
    const out = OrderIndex.parsePayload(payload());
    expect(out[0].date).toBe('');
    expect(out[0].warn).toBeNull();
    expect(out[0].dates1).toEqual([]);
  });

  it('ส่งต่อ error ของชีตที่หายไป โดยไม่ทิ้งข้อมูลของขนส่งนั้น', () => {
    const out = OrderIndex.parsePayload(payload({ error2: 'ไม่พบ Sheet: รถบริษัท (หน้าCRM)' }));
    expect(out[0].error2).toBe('ไม่พบ Sheet: รถบริษัท (หน้าCRM)');
    expect(out[0].data1).toHaveLength(1);
  });

  it('รูปแบบเก่าชุดเดียวก็ยังอ่านได้', () => {
    const out = OrderIndex.parsePayload({ sheet1: [sheetRow()], sheet2: [] });
    expect(out[0].key).toBe('ออเดอร์');
    expect(out[0].data1).toHaveLength(1);
  });

  it('error จากสคริปต์ต้องโยนออกมา ไม่ใช่กลืนแล้วคืนค่าว่าง', () => {
    expect(() => OrderIndex.parsePayload({ error: 'ไม่พบ Sheet' })).toThrow('ไม่พบ Sheet');
  });

  it('รูปแบบที่ไม่รู้จักต้องฟ้องพร้อมบอก keys ที่ได้มา', () => {
    expect(() => OrderIndex.parsePayload({ nonsense: 1 })).toThrow(/nonsense/);
  });
});

describe('build — ดัชนีค้นหา', () => {
  const carriers = [{
    key: 'รถบริษัท',
    data1: OrderIndex_rows(['A1', 'A2']),
    data2: OrderIndex_rows(['A2', 'A3']),
  }];
  function OrderIndex_rows(ids) {
    return ids.map((id) => ({ orderID: id, customer: 'ลูกค้า ' + id, apptTime: '10.00น' }));
  }

  it('ออเดอร์ที่อยู่ทั้งสองหน้า ขึ้นครั้งเดียว', () => {
    const rows = OrderIndex.build(carriers);
    expect(rows.map((r) => r.orderID)).toEqual(['A1', 'A2', 'A3']);
  });

  it('ติดป้ายว่ามาจากรอบเช้าหรือ CRM — คนละคำตอบเวลาลูกค้าถามว่าของออกหรือยัง', () => {
    const rows = OrderIndex.build(carriers);
    expect(rows.find((r) => r.orderID === 'A2').source).toBe('logis');
    expect(rows.find((r) => r.orderID === 'A3').source).toBe('crm');
  });

  it('ติดชื่อขนส่งไปด้วย', () => {
    expect(OrderIndex.build(carriers)[0].carrier).toBe('รถบริษัท');
  });

  it('เก็บเวลานัดไว้ในดัชนีด้วย ไม่งั้นหน้าค้นหาจะไม่มีอะไรให้แสดง', () => {
    expect(OrderIndex.build(carriers)[0].apptTime).toBe('10.00น');
  });
});

describe('แคชของวันนี้', () => {
  it('เก็บแล้วอ่านกลับได้ครบ', () => {
    const carriers = OrderIndex.parsePayload({ carriers: [{ key: 'รถบริษัท', sheet1: [sheetRow()], sheet2: [] }] });
    OrderIndex.save(carriers);
    const back = OrderIndex.getCarriers();
    expect(back.carriers[0].data1[0].orderID).toBe('AA-92876');
    expect(back.at).toBeGreaterThan(0);
  });

  it('ไม่มีอะไรเก็บไว้ = null ไม่ใช่ object ว่างที่ทำให้หน้าเชื่อว่ามีข้อมูล', () => {
    expect(OrderIndex.getCarriers()).toBeNull();
    expect(OrderIndex.get()).toBeNull();
  });

  it('ล้างแล้วต้องหายจริง', () => {
    OrderIndex.save([{ key: 'x', data1: [{ orderID: 'A1' }], data2: [] }]);
    OrderIndex.clear();
    expect(OrderIndex.getCarriers()).toBeNull();
  });
});
