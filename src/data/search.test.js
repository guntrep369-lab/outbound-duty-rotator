/**
 * public/wms-search.js — กฎว่าผลค้นหาอะไรควรขึ้นก่อนอะไร
 *
 * กฎพวกนี้เคยอยู่ใน <script> กลางหน้า order-lookup ซึ่งเทสต์แตะไม่ถึง และเคยพัง
 * เงียบมาแล้วจริง: เงื่อนไข "ข้อความบางส่วน" ถูกวางก่อน "เลขคันตรงตัว" ทำให้
 * ค้น "คัน21" ได้ "คัน210" ติดมาด้วย ทั้งที่เป็นคนละคันคนละคนขับ
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SEARCH_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../public/wms-search.js'), 'utf8');
const TRUCK_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../public/wms-truck.js'), 'utf8');

let S;
beforeEach(() => {
  // โหลด WmsTruck เข้า window ตัวเดียวกัน เพราะ score() เรียกใช้ตอนเทียบเลขคัน
  const win = {};
  win.window = win;
  new Function('window', TRUCK_SRC)(win);
  new Function('window', SEARCH_SRC)(win);
  S = win.WmsSearch;
});

const row = (o = {}) => ({
  orderID: 'AA-92876', consign: 'CN-1', customer: 'คุณโสภา',
  phone1: '083-8187834', phone2: '', address: 'บ้านเลขที่ 37/14',
  brand: 'ที่นอน 5FT Lunio Gen 4 (LNO0000000215)', truck: 'คัน21 .บัณฑิต', ...o,
});

/** ให้คะแนนแบบเดียวกับที่หน้าเว็บเรียก */
const hit = (r, raw) => S.score(r, S.norm(raw), S.digits(raw));

describe('ลำดับความสำคัญ', () => {
  it('เลขออเดอร์ตรงเป๊ะมาก่อนทุกอย่าง', () => {
    expect(hit(row(), 'AA-92876')).toBe(100);
  });

  it('ตรงเป๊ะต้องชนะตรงบางส่วน — ไม่งั้นออเดอร์ที่ใช่จะจมอยู่ใต้ออเดอร์ที่คล้าย', () => {
    expect(hit(row(), 'AA-92876')).toBeGreaterThan(hit(row({ orderID: 'AA-928761' }), 'AA-92876'));
  });

  it('เลข consign ค้นได้ ทั้งเป๊ะและบางส่วน', () => {
    expect(hit(row(), 'CN-1')).toBe(95);
    expect(hit(row({ consign: 'CN-1234' }), 'CN-12')).toBe(75);
  });

  it('ชื่อลูกค้าที่ขึ้นต้นตรง มาก่อนที่เจอกลางคำ', () => {
    expect(hit(row({ customer: 'โสภา ก' }), 'โสภา'))
      .toBeGreaterThan(hit(row({ customer: 'คุณโสภา' }), 'โสภา'));
  });

  it('ที่อยู่กับแบรนด์อยู่ท้ายสุด — ตรงกว้าง ไม่ควรแย่งที่คำตอบที่เจาะจงกว่า', () => {
    const addr = hit(row({ orderID: '', consign: '', customer: '', truck: '' }), '37/14');
    const brand = hit(row({ orderID: '', consign: '', customer: '', truck: '' }), 'lunio');
    expect(addr).toBe(30);
    expect(brand).toBe(20);
    expect(hit(row(), 'AA-92876')).toBeGreaterThan(addr);
  });

  it('ไม่ตรงอะไรเลยได้ 0 ไม่ใช่คะแนนติดลบหรือ undefined', () => {
    expect(hit(row(), 'ไม่มีคำนี้ที่ไหน')).toBe(0);
  });
});

describe('เบอร์โทร', () => {
  it('เบอร์ตรงเป๊ะได้คะแนนสูง แม้เขียนคนละรูปแบบ', () => {
    expect(hit(row(), '0838187834')).toBe(90);
  });

  it('เทียบ Phone 2 ด้วย ไม่ใช่แต่ Phone 1', () => {
    expect(hit(row({ phone1: '', phone2: '094-8956168' }), '0948956168')).toBe(90);
  });

  /* พิมพ์ "TP-1001" ไม่ควรไปโดนเบอร์ที่บังเอิญมี 1001 อยู่ข้างใน จึงเทียบเบอร์
     เฉพาะตอนที่คำค้นเป็นตัวเลขล้วน */
  it('คำค้นที่มีตัวอักษรปนต้องไม่ไปเทียบกับเบอร์', () => {
    const r = row({ orderID: 'ZZ-1', consign: '', customer: '', address: '', brand: '',
                    truck: '', phone1: '0812100199' });
    expect(hit(r, 'TP-1001')).toBe(0);
  });

  it('ตัวเลขสั้นเกินไปไม่เทียบเบอร์ — 2 ตัวจะไปโดนเบอร์เกือบทุกเบอร์', () => {
    const r = row({ orderID: 'ZZ-1', consign: '', customer: '', address: '', brand: '',
                    truck: '', phone1: '0838187834' });
    expect(hit(r, '83')).toBe(0);
  });
});

describe('ชื่อรถ', () => {
  /* ล้างช่องอื่นให้หมด เพื่อวัดกฎชื่อรถล้วน ๆ — ไม่งั้นค้น "21" จะไปโดน
     "LNO0000000215" ในชื่อแบรนด์ แล้วได้คะแนนจากกฎคนละข้อโดยไม่รู้ตัว */
  const t = (truck) => ({ orderID: '', consign: '', customer: '', phone1: '', phone2: '',
                          address: '', brand: '', truck });

  it('ค้นด้วยเลขคัน ได้คันนั้น', () => {
    expect(hit(t('คัน21 .บัณฑิต'), 'คัน21')).toBe(45);
    expect(hit(t('คัน21 .บัณฑิต'), '21')).toBe(45);
  });

  /* จุดที่เคยพังจริง — ลำดับสองเงื่อนไขในโค้ดเป็นตัวชี้ขาด */
  it('เลขคันต้องตรงตัว ไม่ใช่ข้อความบางส่วน', () => {
    expect(hit(t('คัน210 ทดสอบ'), 'คัน21')).toBe(0);
    expect(hit(t('คัน210 ทดสอบ'), '21')).toBe(0);
    expect(hit(t('คัน21 .บัณฑิต'), 'คัน2')).toBe(0);
    expect(hit(t('คัน210 ทดสอบ'), 'คัน210')).toBe(45);
  });

  it('ค้นด้วยชื่อคนขับได้ เพราะคนจำชื่อได้มากกว่าเลข', () => {
    expect(hit(t('คัน21 .บัณฑิต'), 'บัณฑิต')).toBe(45);
    expect(hit(t('คัน2 .บี-แมน'), 'บี-แมน')).toBe(45);
  });

  it('"5 คัน" ไม่มีเลขคัน ค้นด้วยเลขจึงไม่เจอ แต่ค้นด้วยข้อความเจอ', () => {
    expect(hit(t('5 คัน'), '5')).toBe(0);
    expect(hit(t('5 คัน'), 'คัน')).toBe(45);
  });

  it('แถวที่ไม่มีชื่อรถต้องไม่พัง', () => {
    expect(hit(t(''), 'คัน21')).toBe(0);
    expect(hit(t(undefined), 'บัณฑิต')).toBe(0);
  });
});

describe('norm / digits', () => {
  it('ตัดช่องว่างและพิมพ์เล็กใหญ่', () => {
    expect(S.norm(' AA 928 76 ')).toBe('aa92876');
    expect(S.norm(null)).toBe('');
  });

  it('digits เหลือแต่ตัวเลข', () => {
    expect(S.digits('083-818 7834')).toBe('0838187834');
    expect(S.digits(null)).toBe('');
  });
});
