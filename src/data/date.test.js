import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/wms-date.js — how the whole system writes a date on screen.
 *
 * The rule it exists for: print the year only when it is not the current one.
 * Four pages used to format dates themselves and all of them dropped the year,
 * which made a real failure invisible — the order sheet writes "Mon, Aug 17"
 * with no year, JS filled in 2001, and the screen said "17 ส.ค.", which looks
 * exactly like a correct answer. Anything not from this year has to announce
 * itself.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-date.js'), 'utf8');

let WmsDate;
beforeEach(() => {
  const win = {};
  new Function('window', SRC)(win);
  WmsDate = win.WmsDate;
});

const p = (n) => String(n).padStart(2, '0');
const off = (k) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const thisYear = new Date().getFullYear();

describe('thai — วันที่แบบสั้น', () => {
  it('ปีปัจจุบันไม่ต้องเขียนปี', () => {
    expect(WmsDate.thai(`${thisYear}-08-17`)).toBe('17 ส.ค.');
    expect(WmsDate.thai(`${thisYear}-01-05`)).toBe('5 ม.ค.');
    expect(WmsDate.thai(`${thisYear}-12-31`)).toBe('31 ธ.ค.');
  });

  it('ปีอื่นต้องเขียนปี — นี่คือเหตุผลทั้งหมดที่ไฟล์นี้มีอยู่', () => {
    // 2001 คือปีที่ JS เดาให้เมื่อชีตเขียนวันที่มาโดยไม่มีปี
    expect(WmsDate.thai('2001-08-17')).toBe('17 ส.ค. 2001');
    expect(WmsDate.thai(`${thisYear + 1}-01-05`)).toBe(`5 ม.ค. ${thisYear + 1}`);
    expect(WmsDate.thai(`${thisYear - 1}-12-31`)).toBe(`31 ธ.ค. ${thisYear - 1}`);
  });

  it('ใช้ ค.ศ. ไม่ใช่ พ.ศ. — ให้ตรงกับที่ Apps Script ส่งกลับมา', () => {
    expect(WmsDate.thai('2001-08-17')).toContain('2001');
    expect(WmsDate.thai('2001-08-17')).not.toContain('2544');
  });

  it('อ่านไม่ออกก็คืนของเดิม ไม่แต่งวันที่ขึ้นมา', () => {
    expect(WmsDate.thai('ไม่ใช่วันที่')).toBe('ไม่ใช่วันที่');
    expect(WmsDate.thai('')).toBe('');
    expect(WmsDate.thai(null)).toBe('');
  });
});

describe('when — เวลาที่บันทึกไฟล์', () => {
  it('วันนี้ เมื่อวาน พรุ่งนี้ เขียนเป็นคำ', () => {
    expect(WmsDate.when(off(0) + ' 08:15')).toBe('วันนี้ 08:15 น.');
    expect(WmsDate.when(off(-1) + ' 17:30')).toBe('เมื่อวาน 17:30 น.');
    expect(WmsDate.when(off(1) + ' 09:00')).toBe('พรุ่งนี้ 09:00 น.');
  });

  it('ไกลกว่านั้นบอกวันที่ และติดปีตามกติกาเดียวกัน', () => {
    expect(WmsDate.when('2001-08-16 08:15')).toBe('16 ส.ค. 2001 08:15 น.');
    expect(WmsDate.when(off(-9))).toBe(WmsDate.thai(off(-9)));
  });

  it('ไม่มีเวลาต่อท้ายก็ได้', () => {
    expect(WmsDate.when(off(0))).toBe('วันนี้');
  });
});

describe('range — ช่วงวันของงานในไฟล์', () => {
  it('วันเดียว สองวัน และช่วงยาว เขียนคนละแบบ', () => {
    expect(WmsDate.range(['2001-08-17'])).toBe('17 ส.ค. 2001');
    expect(WmsDate.range(['2001-08-17', '2001-08-16'])).toBe('16 ส.ค. 2001, 17 ส.ค. 2001');
    expect(WmsDate.range(['2001-08-16', '2001-08-18', '2001-08-17'])).toBe('16 ส.ค. 2001–18 ส.ค. 2001');
  });

  it('ไม่มีวันเลย = ข้อความว่าง ไม่ใช่ขีดหรือคำว่า undefined', () => {
    expect(WmsDate.range([])).toBe('');
    expect(WmsDate.range(null)).toBe('');
    expect(WmsDate.range(['', null])).toBe('');
  });

  it('ไม่ไปแก้ array ที่ส่งเข้ามา', () => {
    const src = ['2026-08-18', '2026-08-16'];
    WmsDate.range(src);
    expect(src).toEqual(['2026-08-18', '2026-08-16']);
  });
});

describe('isToday / todayYmd', () => {
  it('รู้ว่าอันไหนคือวันนี้', () => {
    expect(WmsDate.isToday(off(0))).toBe(true);
    expect(WmsDate.isToday(off(0) + ' 23:59')).toBe(true);
    expect(WmsDate.isToday(off(-1))).toBe(false);
    expect(WmsDate.isToday(off(1))).toBe(false);
  });

  it('วันเดียวกันแต่คนละปี ไม่ใช่วันนี้', () => {
    // ตรงนี้คือกับดักของบั๊กปี 2001 — วันกับเดือนตรงแต่ปีไม่ตรง
    const [, mo, d] = off(0).split('-');
    expect(WmsDate.isToday(`2001-${mo}-${d}`)).toBe(false);
  });

  it('อ่านไม่ออก = ไม่ใช่วันนี้ ไม่ใช่ผ่านไปเงียบ ๆ', () => {
    expect(WmsDate.isToday('')).toBe(false);
    expect(WmsDate.isToday('Mon, Aug 17')).toBe(false);
  });

  it('todayYmd ใช้เทียบกับ isToday ได้ตรงกัน', () => {
    expect(WmsDate.isToday(WmsDate.todayYmd())).toBe(true);
  });
});
