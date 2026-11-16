/**
 * public/wms-shifts.js — ค่าตั้งกะ: ชื่อ เวลา และมีผลตั้งแต่คาบไหน
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const win = {};
new Function('window', fs.readFileSync(path.resolve(__dirname, '../../public/wms-shifts.js'), 'utf8'))(win);
const S = win.WmsShifts;

// คาบที่เริ่ม 13 ธ.ค. เปลี่ยนกะที่ 2 จากกะบ่ายเป็นกะสาย 10:00-19:00
const LATE = {
  from: '2026-12-13',
  shifts: {
    morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
    evening: { name: 'กะสาย', start: '10:00', end: '19:00' },
  },
};
const DEFS = [LATE];
const T = (d, h, m = 0) => new Date(2026, 11, d, h, m);

describe('ค่าตั้งของแต่ละวัน', () => {
  it('ยังไม่ตั้งอะไร ใช้ค่าเริ่มต้น — กะเช้า 07:00-16:00 กะบ่าย 16:00-24:00', () => {
    for (const defs of [undefined, null, [], 'x']) {
      const d = S.at(defs, '2026-10-24');
      expect(d.shifts.morning).toMatchObject({ name: 'กะเช้า', short: 'เช้า', start: '07:00', end: '16:00' });
      expect(d.shifts.evening).toMatchObject({ name: 'กะบ่าย', short: 'บ่าย', start: '16:00', end: '24:00' });
    }
  });

  it('คาบก่อนวันเริ่มยังเป็นกะบ่ายเวลาเดิม ตั้งแต่วันเริ่มเป็นกะสาย — ไม่เปลี่ยนย้อนหลัง', () => {
    expect(S.name(DEFS, '2026-12-12', 'evening')).toBe('กะบ่าย');
    expect(S.timeText(S.shift(DEFS, '2026-12-12', 'evening'))).toBe('16:00-24:00');
    expect(S.name(DEFS, '2026-12-13', 'evening')).toBe('กะสาย');
    expect(S.timeText(S.shift(DEFS, '2027-03-01', 'evening'))).toBe('10:00-19:00');
    expect(S.timeShort(S.shift(DEFS, '2027-03-01', 'evening'))).toBe('10–19');
    expect(S.name(DEFS, '2027-03-01', 'morning')).toBe('กะเช้า');
  });

  it('กลับไปมีกะบ่ายอีกได้ — เพิ่มรายการใหม่ที่เริ่มทีหลัง ลำดับในรายการไม่สำคัญ', () => {
    const back = { from: '2027-02-07', shifts: { morning: LATE.shifts.morning, evening: { name: 'กะบ่าย', start: '16:00', end: '24:00' } } };
    const defs = [back, LATE];
    expect(S.list(defs).map((d) => d.from)).toEqual(['', '2026-12-13', '2027-02-07']);
    expect(S.name(defs, '2027-02-06', 'evening')).toBe('กะสาย');
    expect(S.name(defs, '2027-02-07', 'evening')).toBe('กะบ่าย');
  });

  it('กติกาวันสุดท้ายคาบ 10-19 มีเฉพาะกะบ่ายของค่าเริ่มต้น ค่าที่ตั้งใหม่ไม่มี', () => {
    const old = S.shift(DEFS, '2026-12-12', 'evening');
    expect(old.last).toMatchObject({ skipOff: 6 });
    expect(S.hoursLabel(old.last)).toBe('10-19');
    expect(S.shift(DEFS, '2026-12-12', 'morning').last).toBe(null);
    expect(S.shift(DEFS, '2026-12-13', 'evening').last).toBe(null);
    // รายการใหม่ตั้งต้นจากค่าที่ใช้อยู่ แต่ไม่พากติกานี้มาด้วย
    expect(S.blank(S.at([], '2026-12-13'))).toEqual({
      morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
      evening: { name: 'กะบ่าย', start: '16:00', end: '24:00' },
    });
  });

  it('รายการที่ข้อมูลเพี้ยนข้ามไป ไม่ทำให้หน้าที่อ่านพัง', () => {
    const bad = [null, { from: 'x', shifts: LATE.shifts }, { from: '2026-12-01' },
      { from: '2026-12-02', shifts: { morning: LATE.shifts.morning, evening: { name: '', start: '10:00', end: '19:00' } } },
      { from: '2026-12-03', shifts: { morning: LATE.shifts.morning, evening: { name: 'กะสาย', start: '25:00', end: '19:00' } } }];
    expect(S.list(bad).map((d) => d.from)).toEqual(['']);
    expect(S.name(bad.concat(LATE), '2026-12-20', 'evening')).toBe('กะสาย');
  });

  it('รหัสกะที่ไม่รู้จักนับเป็นกะที่ 2', () => {
    expect(S.name(DEFS, '2026-12-20', 'night')).toBe('กะสาย');
  });

  it('ชื่อกะของเดือนที่คร่อมวันเปลี่ยนกะ มีทั้งชื่อเก่าและใหม่', () => {
    expect(S.names(DEFS, '2026-11-01', '2026-11-30')).toEqual(['กะเช้า', 'กะบ่าย']);
    expect(S.names(DEFS, '2026-12-01', '2026-12-31')).toEqual(['กะเช้า', 'กะบ่าย', 'กะสาย']);
    expect(S.names(DEFS, '2027-01-01', '2027-01-31')).toEqual(['กะเช้า', 'กะสาย']);
  });
});

describe('กะของเวลานี้', () => {
  const at = (h, m) => S.now([], new Date(2026, 9, 24, h, m || 0));

  it('ค่าเริ่มต้นเหมือนเดิมทุกอย่าง — 07:00 กะเช้า · 16:00 กะบ่าย · ก่อน 07:00 กะบ่ายของเมื่อวาน', () => {
    expect(at(7)).toEqual({ date: '2026-10-24', shift: 'morning' });
    expect(at(15, 59)).toEqual({ date: '2026-10-24', shift: 'morning' });
    expect(at(16)).toEqual({ date: '2026-10-24', shift: 'evening' });
    expect(at(0, 30)).toEqual({ date: '2026-10-23', shift: 'evening' });
  });

  it('กะสาย 10:00-19:00 — นับตามเวลาเข้างาน: 07:00–09:59 กะเช้า · 10:00 เป็นต้นไปกะสาย', () => {
    expect(S.now(DEFS, T(14, 7))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.now(DEFS, T(14, 9, 59))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.now(DEFS, T(14, 10))).toEqual({ date: '2026-12-14', shift: 'evening' });
    expect(S.now(DEFS, T(14, 23))).toEqual({ date: '2026-12-14', shift: 'evening' });
    expect(S.now(DEFS, T(15, 6, 59))).toEqual({ date: '2026-12-14', shift: 'evening' });
  });

  it('คืนก่อนวันเปลี่ยนกะ ยังเป็นกะบ่ายของคาบเก่า', () => {
    expect(S.now(DEFS, T(13, 2))).toEqual({ date: '2026-12-12', shift: 'evening' });
    expect(S.name(DEFS, '2026-12-12', 'evening')).toBe('กะบ่าย');
  });

  it('วันเดียวกัน กะที่เข้าก่อนมาก่อน — เรียงตามเวลาเข้า ไม่ใช่ตามรหัส', () => {
    expect(S.before(DEFS, { date: '2026-12-14', shift: 'morning' }, { date: '2026-12-14', shift: 'evening' })).toBe(true);
    expect(S.before(DEFS, { date: '2026-12-14', shift: 'evening' }, { date: '2026-12-14', shift: 'morning' })).toBe(false);
    expect(S.before(DEFS, { date: '2026-12-13', shift: 'evening' }, { date: '2026-12-14', shift: 'morning' })).toBe(true);
    // กะที่ 2 เข้าก่อนกะที่ 1 ก็ได้
    const flip = [{ from: '2026-12-13', shifts: { morning: { name: 'กะดึก', start: '20:00', end: '05:00' }, evening: { name: 'กะเช้า', start: '07:00', end: '16:00' } } }];
    expect(S.order(flip, '2026-12-14')).toEqual(['evening', 'morning']);
    expect(S.before(flip, { date: '2026-12-14', shift: 'evening' }, { date: '2026-12-14', shift: 'morning' })).toBe(true);
    expect(S.now(flip, T(14, 21))).toEqual({ date: '2026-12-14', shift: 'morning' });
    const list = [{ date: '2026-12-14', shift: 'morning' }, { date: '2026-12-14', shift: 'evening' }, { date: '2026-12-13', shift: 'morning' }];
    expect(list.sort(S.sorter(flip)).map((e) => e.date.slice(8) + e.shift[0])).toEqual(['13m', '14e', '14m']);
  });
});

describe('กะไหนต้องรับทราบงานต่อ', () => {
  it('กะเช้า/กะบ่ายต่อกันไม่ทับ — ต้องรับทั้งสองกะ เหมือนเดิม', () => {
    const d = S.at([], '2026-10-24');
    expect([d.shifts.morning.ack, d.shifts.evening.ack]).toEqual([true, true]);
    for (const t of [new Date(2026, 9, 24, 8), new Date(2026, 9, 24, 16, 5), new Date(2026, 9, 25, 1)]) {
      expect(S.receiver([], t)).toEqual(S.now([], t));
    }
  });

  it('กะสายเข้ามาตอนกะเช้ายังอยู่ ไม่ต้องรับ — กะเช้าต้องรับงานที่กะสายฝากไว้ตอน 19:00', () => {
    const d = S.at(DEFS, '2026-12-14');
    expect([d.shifts.morning.ack, d.shifts.evening.ack]).toEqual([true, false]);
    // ทั้งวันจนถึงก่อน 07:00 ของวันรุ่งขึ้น คนที่ต้องรับคือกะเช้าของวันนั้น
    expect(S.receiver(DEFS, T(14, 7))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.receiver(DEFS, T(14, 15))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.receiver(DEFS, T(14, 22))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.receiver(DEFS, T(15, 6))).toEqual({ date: '2026-12-14', shift: 'morning' });
    expect(S.receiver(DEFS, T(15, 7))).toEqual({ date: '2026-12-15', shift: 'morning' });
  });

  it('ติ๊กเองแล้วใช้ตามที่ติ๊ก — ให้กะสายรับด้วย หรือไม่ให้ใครรับเลยก็ได้', () => {
    const both = [{ from: '2026-12-13', shifts: { morning: LATE.shifts.morning, evening: { ...LATE.shifts.evening, ack: true } } }];
    expect(S.receiver(both, T(14, 11))).toEqual({ date: '2026-12-14', shift: 'evening' });
    const none = [{ from: '2026-12-13', shifts: { morning: { ...LATE.shifts.morning, ack: false }, evening: LATE.shifts.evening } }];
    expect(S.receiver(none, T(14, 11))).toBe(null);
    // คืนแรกของค่าใหม่ยังเป็นกะบ่ายของคาบเก่าที่ต้องรับ
    expect(S.receiver(none, T(13, 3))).toEqual({ date: '2026-12-12', shift: 'evening' });
  });

  it('สองกะเข้าพร้อมกัน — ให้กะแรกเป็นคนรับ ไม่ใช่ไม่มีใครรับ', () => {
    const same = [{ from: '2026-12-13', shifts: { morning: { name: 'กะ A', start: '08:00', end: '17:00' }, evening: { name: 'กะ B', start: '08:00', end: '17:00' } } }];
    const d = S.at(same, '2026-12-14');
    expect([d.shifts.morning.ack, d.shifts.evening.ack]).toEqual([true, false]);
  });
});

describe('เวลาที่คนพิมพ์', () => {
  it('รับได้หลายแบบ เก็บเป็น HH:MM', () => {
    expect(S.parseTime('10')).toBe('10:00');
    expect(S.parseTime('7')).toBe('07:00');
    expect(S.parseTime('10.00')).toBe('10:00');
    expect(S.parseTime('19.00น.')).toBe('19:00');
    expect(S.parseTime(' 7:30 ')).toBe('07:30');
    expect(S.parseTime('0730')).toBe('07:30');
  });
  it('เวลาออกเป็น 24:00 ได้ เวลาเข้าไม่ได้ · ที่อ่านไม่ออกคืนค่าว่าง', () => {
    expect(S.parseTime('24:00', true)).toBe('24:00');
    expect(S.parseTime('24', false)).toBe('');
    expect(S.parseTime('24:30', true)).toBe('');
    for (const bad of ['', 'เช้า', '25', '7:60', '7:5', '-1', null, undefined]) expect(S.parseTime(bad)).toBe('');
  });
  it('ตรวจค่าก่อนเก็บ — ชื่อว่าง เวลาผิด เข้าออกเวลาเดียวกัน ชื่อซ้ำ', () => {
    const ok = LATE.shifts;
    expect(S.check(ok)).toBe('');
    expect(S.check({ ...ok, evening: { ...ok.evening, name: ' ' } })).toContain('กะที่ 2');
    expect(S.check({ ...ok, morning: { ...ok.morning, start: '7:00' } })).toContain('เวลาเข้า');
    expect(S.check({ ...ok, evening: { ...ok.evening, end: '19.00' } })).toContain('เวลาออก');
    expect(S.check({ ...ok, evening: { ...ok.evening, end: '10:00' } })).toContain('เวลาเดียวกัน');
    expect(S.check({ ...ok, evening: { ...ok.evening, name: 'กะเช้า' } })).toContain('ซ้ำ');
    expect(S.check({ morning: ok.morning })).toContain('กะที่ 2');
    expect(S.check(null)).toBeTruthy();
  });
});

describe('ค่าตั้งในเครื่อง', () => {
  it('อ่านจากข้อมูลตารางกะ — ไม่มีหรืออ่านไม่ได้ก็ได้รายการว่าง', () => {
    const store = (v) => ({ getItem: () => v });
    expect(S.local(store(JSON.stringify({ shiftDefs: DEFS })))).toEqual(DEFS);
    expect(S.local(store(JSON.stringify({ employees: [] })))).toEqual([]);
    expect(S.local(store('{oops'))).toEqual([]);
    expect(S.local(store(null))).toEqual([]);
    expect(S.local()).toEqual([]);
  });
});
