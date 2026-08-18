/**
 * public/wms-truck.js — งานไปกับรถคันไหน และเป็นจุดที่เท่าไหร่
 *
 * เขียนจากข้อมูลจริงของชีต รถบริษัท (หน้าLogis) 167 แถว:
 *   • ชื่อรถซ้ำทุกแถวของคันเดียวกัน (คัน2 .บี-แมน 84 แถว)
 *   • ออเดอร์เดียวกินหลายแถว และลูกค้าคนเดียวมีได้หลายออเดอร์
 *   • 46 แถวเขียนว่า "5 คัน" แทนชื่อคัน เพราะเป็นงาน Event ที่ใช้รถ 5 คัน
 *     ส่งลูกค้ารายเดียว — 27% ของแถวทั้งหมด ไม่ใช่เคสหลุด
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-truck.js'), 'utf8');

let WmsTruck;
beforeEach(() => {
  const win = {};
  new Function('window', SRC)(win);
  WmsTruck = win.WmsTruck;
});

const read = (r) => r;
const row = (truck, order, customer, time = '') => ({ truck, order, customer, time });

describe('isCount — "5 คัน" ไม่ใช่ชื่อรถ', () => {
  it('รู้จักรูปแบบจำนวนคัน', () => {
    for (const s of ['5 คัน', '5คัน', ' 12  คัน ', '1 คัน']) {
      expect(WmsTruck.isCount(s), s).toBe(true);
    }
  });

  it('ชื่อรถจริงต้องไม่โดนเหมารวม แม้จะมีคำว่าคันกับตัวเลขอยู่ในชื่อ', () => {
    for (const s of ['คัน2 .บี-แมน', 'คัน21 .บัณฑิต', 'คัน22 .ณัฐพล+มัสวินต์', '', null]) {
      expect(WmsTruck.isCount(s), String(s)).toBe(false);
    }
  });
});

describe('stopMap — ลำดับจุดส่ง', () => {
  it('ลูกค้าคนเดียวหลายแถว = จุดเดียว คนขับแวะครั้งเดียว', () => {
    const m = WmsTruck.stopMap([
      row('คัน2 .บี-แมน', 'PY-1', 'คุณเอ'),
      row('คัน2 .บี-แมน', 'PY-1', 'คุณเอ'),
      row('คัน2 .บี-แมน', 'PY-2', 'คุณบี'),
    ], read);
    expect(m.get('PY-1')).toMatchObject({ seq: 1, stops: 2 });
    expect(m.get('PY-2')).toMatchObject({ seq: 2, stops: 2 });
  });

  it('ลูกค้าคนเดียวสองออเดอร์ ยังเป็นจุดเดียว', () => {
    const m = WmsTruck.stopMap([
      row('คัน21 .บัณฑิต', 'M/E-00109', 'เสือ ธนากร'),
      row('คัน21 .บัณฑิต', 'M/E-00106', 'เสือ ธนากร'),
    ], read);
    expect(m.get('M/E-00109')).toMatchObject({ seq: 1, stops: 1 });
    expect(m.get('M/E-00106')).toMatchObject({ seq: 1, stops: 1 });
  });

  it('นับแยกกันคนละคัน ไม่ใช่นับรวมทั้งวัน', () => {
    const m = WmsTruck.stopMap([
      row('คัน2 .บี-แมน', 'A1', 'คุณเอ'),
      row('คัน21 .บัณฑิต', 'B1', 'คุณบี'),
      row('คัน21 .บัณฑิต', 'B2', 'คุณซี'),
    ], read);
    expect(m.get('A1')).toMatchObject({ truck: 'คัน2 .บี-แมน', seq: 1, stops: 1 });
    expect(m.get('B2')).toMatchObject({ truck: 'คัน21 .บัณฑิต', seq: 2, stops: 2 });
  });

  it('"5 คัน" ยังจัดกลุ่มได้ แต่ต้องไม่อ้างลำดับจุดที่ไม่มีอยู่จริง', () => {
    const m = WmsTruck.stopMap([
      row('5 คัน', 'M/E-00109', 'เสือ ธนากร', '22.00น'),
      row('5 คัน', 'M/E-00106', 'เสือ ธนากร'),
      row('คัน2 .บี-แมน', 'PY-1', 'คุณเอ'),
    ], read);
    expect(m.get('M/E-00109').truck).toBe('5 คัน');
    expect(m.get('M/E-00109').numbered).toBe(false);
    expect(m.get('M/E-00106').numbered).toBe(false);
    // รถที่ระบุคันได้ต้องยังนับจุดตามปกติ
    expect(m.get('PY-1').numbered).toBe(true);
  });

  it('แถวไม่มีเลขออเดอร์ ไม่เข้าแผนที่ แต่ยังนับเป็นจุดของลูกค้านั้น', () => {
    const m = WmsTruck.stopMap([
      row('คัน2 .บี-แมน', '', 'คุณเอ'),
      row('คัน2 .บี-แมน', 'PY-2', 'คุณบี'),
    ], read);
    expect(m.has('')).toBe(false);
    expect(m.get('PY-2')).toMatchObject({ seq: 2, stops: 2 });
  });

  it('ไม่มีชื่อรถ = "ไม่ระบุ" ไม่ใช่หายไปจากแผนที่', () => {
    const m = WmsTruck.stopMap([row('', 'PY-1', 'คุณเอ')], read);
    expect(m.get('PY-1').truck).toBe('ไม่ระบุ');
  });

  it('ไม่มีแถวเลยก็ต้องไม่พัง', () => {
    expect(WmsTruck.stopMap([], read).size).toBe(0);
    expect(WmsTruck.stopMap(null, read).size).toBe(0);
  });
});
