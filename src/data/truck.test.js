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

/**
 * แยกใบสรุปหยิบของตามกลุ่มคนรถ — ทีมแบ่งกันหยิบตามช่วงเลขคัน
 *
 * ตัวหลอกสำคัญคือ "5 คัน" (28% ของแถวจริง) ซึ่งแปลว่าใช้รถ 5 คัน ไม่ใช่คันที่ 5
 * ถ้าดึงเลขมั่ว งาน Event ก้อนใหญ่จะไปโผล่ในใบของทีมที่ไม่ได้รับผิดชอบ
 */
describe('เลขคันจากชื่อรถ', () => {
  it('อ่านเลขที่ตามหลังคำว่า "คัน"', () => {
    expect(WmsTruck.numberOf('คัน21 .บัณฑิต')).toBe(21);
    expect(WmsTruck.numberOf('คัน2 .บี-แมน')).toBe(2);
    expect(WmsTruck.numberOf('คัน 41 ปัญญา + อุทัยวรรณ')).toBe(41);
  });

  it('"5 คัน" คือจำนวนคัน ไม่ใช่คันที่ 5', () => {
    expect(WmsTruck.numberOf('5 คัน')).toBeNull();
    expect(WmsTruck.numberOf('12 คัน')).toBeNull();
  });

  it('ไม่มีเลขหรือไม่มีค่า = ไม่รู้', () => {
    for (const v of ['', null, undefined, 'รถบริษัท', 'Mon, Aug 17']) {
      expect(WmsTruck.numberOf(v), String(v)).toBeNull();
    }
  });
});

describe('ช่วงเลขคัน', () => {
  it('อ่าน "1-20, 21-60" เป็นสองกลุ่ม', () => {
    expect(WmsTruck.parseRanges('1-20, 21-60')).toEqual([
      { from: 1, to: 20, label: 'คัน 1-20' },
      { from: 21, to: 60, label: 'คัน 21-60' },
    ]);
  });

  it('รับเว้นวรรค ขึ้นบรรทัดใหม่ และคำว่า "ถึง"', () => {
    expect(WmsTruck.parseRanges(' 1 - 20 \n21ถึง60 ').map((r) => r.label))
      .toEqual(['คัน 1-20', 'คัน 21-60']);
  });

  it('เลขเดี่ยวคือคันเดียว', () => {
    expect(WmsTruck.parseRanges('7')).toEqual([{ from: 7, to: 7, label: 'คัน 7' }]);
  });

  it('ช่วงกลับหัวหรือพิมพ์ไม่ครบ ทิ้งไป ไม่เดาให้', () => {
    expect(WmsTruck.parseRanges('20-1')).toEqual([]);
    expect(WmsTruck.parseRanges('1-, -20, abc, , 1--2')).toEqual([]);
  });

  it('ว่าง = ไม่แยกใบ', () => {
    for (const v of ['', '   ', null, undefined]) expect(WmsTruck.parseRanges(v)).toEqual([]);
  });
});

describe('จัดคันเข้ากลุ่ม', () => {
  const R = () => WmsTruck.parseRanges('1-20, 21-60');

  it('เข้าช่วงที่ถูก', () => {
    expect(WmsTruck.rangeIndex(2, R())).toBe(0);
    expect(WmsTruck.rangeIndex(20, R())).toBe(0);   // ขอบล่างต้องรวม
    expect(WmsTruck.rangeIndex(21, R())).toBe(1);   // ขอบบนต้องรวม
    expect(WmsTruck.rangeIndex(60, R())).toBe(1);
  });

  it('นอกทุกช่วง หรือไม่รู้เลขคัน = ไม่เข้ากลุ่มไหน', () => {
    expect(WmsTruck.rangeIndex(61, R())).toBe(-1);
    expect(WmsTruck.rangeIndex(0, R())).toBe(-1);
    expect(WmsTruck.rangeIndex(null, R())).toBe(-1);
  });

  it('ช่วงซ้อนกัน เข้าช่วงแรกที่เจอ ไม่ใช่นับซ้ำสองใบ', () => {
    const r = WmsTruck.parseRanges('1-30, 20-40');
    expect(WmsTruck.rangeIndex(25, r)).toBe(0);
  });
});

/**
 * ปุ่มล็อกกลุ่มรถในหน้าสรุปหยิบของ — รถบริษัท (คัน 1-20) กับ รถเสริม (คัน 21-60)
 *
 * ต้องแยกสี่ช่องจากกัน ไม่ใช่สาม: คันที่มีเลขแต่อยู่นอกทุกกลุ่ม (เช่น คัน75)
 * ไม่เหมือนคันที่ไม่มีเลขเลย ("5 คัน") ถ้ารวมกันแล้วติดป้าย "ไม่ระบุคัน"
 * คนอ่านจะเชื่อว่าคัน75 ไม่มีเลข ทั้งที่กลุ่มที่ตั้งไว้ยังไปไม่ถึงมัน
 */
describe('ปุ่มล็อกกลุ่มรถ', () => {
  it('กลุ่มตรงตามที่ทีมใช้เรียก', () => {
    expect(WmsTruck.TRUCK_TEAMS.map((t) => [t.label, t.from, t.to]))
      .toEqual([['รถบริษัท', 1, 20], ['รถเสริม', 21, 60]]);
  });

  it('จัดคันเข้าช่องถูก รวมขอบของช่วง', () => {
    expect(WmsTruck.bucketOf('คัน1 ก')).toBe('own');
    expect(WmsTruck.bucketOf('คัน20 ข')).toBe('own');
    expect(WmsTruck.bucketOf('คัน21 .บัณฑิต')).toBe('extra');
    expect(WmsTruck.bucketOf('คัน60 ค')).toBe('extra');
  });

  it('มีเลขแต่นอกกลุ่ม ≠ ไม่มีเลข', () => {
    expect(WmsTruck.bucketOf('คัน75 นอกกลุ่ม')).toBe('outside');
    expect(WmsTruck.bucketOf('คัน0 ศูนย์')).toBe('outside');
    expect(WmsTruck.bucketOf('5 คัน')).toBe('none');
    expect(WmsTruck.bucketOf('')).toBe('none');
  });

  it('teamOf คืนกลุ่มจริงเมื่ออยู่ในกลุ่ม และ null เมื่อไม่อยู่', () => {
    expect(WmsTruck.teamOf('คัน2 .บี-แมน').label).toBe('รถบริษัท');
    expect(WmsTruck.teamOf('คัน22 .ณัฐพล+มัสวินต์').label).toBe('รถเสริม');
    expect(WmsTruck.teamOf('คัน75 นอกกลุ่ม')).toBeNull();
    expect(WmsTruck.teamOf('5 คัน')).toBeNull();
  });

  it('ทุกคันตกลงช่องใดช่องหนึ่งเสมอ ไม่มีของหายระหว่างช่อง', () => {
    const names = ['คัน2 .บี-แมน', 'คัน21 .บัณฑิต', 'คัน75 นอกกลุ่ม', '5 คัน', ''];
    const ids = names.map((n) => WmsTruck.bucketOf(n));
    expect(ids.every((i) => ['own', 'extra', 'outside', 'none'].includes(i))).toBe(true);
    expect(ids).toEqual(['own', 'extra', 'outside', 'none', 'none']);
  });
});
