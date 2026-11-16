/**
 * public/roster/roster-calc.js — ค่าช่องในตารางกะ ที่หน้าตารางกะกับหน้า HR ใช้ร่วมกัน
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const win = {};
const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');
new Function('window', read('wms-shifts.js'))(win);
new Function('window', read('roster/roster-calc.js'))(win);
const C = win.RosterCalc;
const BASE = win.WmsShifts.at([], '2026-11-15');
const LATE = win.WmsShifts.at([{ from: '2026-12-13', shifts: {
  morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
  evening: { name: 'กะสาย', start: '10:00', end: '19:00' } } }], '2026-12-13');

describe('คาบ', () => {
  const sp = C.sorted([{ id: 'b', start: '2026-12-13', groupA: 'evening' }, { id: 'a', start: '2026-11-15', groupA: 'morning' }]);
  it('เรียงตามวันเริ่ม จบวันก่อนคาบถัดไป คาบสุดท้ายครบ 28 วัน', () => {
    expect(sp.map((p) => p.id)).toEqual(['a', 'b']);
    expect(C.perEnd(sp[0], sp)).toBe('2026-12-12');
    expect(C.perEnd(sp[1], sp)).toBe('2027-01-09');
    expect(C.datesOf(sp[0], sp)).toHaveLength(28);
  });
  it('คาบปัจจุบัน = คาบล่าสุดที่เริ่มแล้ว', () => {
    expect(C.currentIdx(sp, '2026-11-01')).toBe(0);
    expect(C.currentIdx(sp, '2026-12-20')).toBe(1);
  });
  it('กลุ่มกับกะสลับกันตาม groupA', () => {
    expect(C.shiftOf(sp[0], 'A')).toBe('morning');
    expect(C.shiftOf(sp[1], 'A')).toBe('evening');
    expect(C.groupOf(sp[1], 'morning')).toBe('B');
  });
});

describe('ค่าช่องตามตาราง', () => {
  const hols = [{ date: '2026-12-05', name: 'วันพ่อ' }];
  it('วันหยุดพิเศษ / วันหยุดประจำ = H นอกนั้น W', () => {
    expect(C.avOf(hols, { dayOff: 0 }, '2026-12-05', 'morning', '2026-12-12', BASE)).toBe('H');
    expect(C.avOf(hols, { dayOff: 0 }, '2026-11-22', 'morning', '2026-12-12', BASE)).toBe('H'); // อาทิตย์
    expect(C.avOf(hols, { dayOff: 0 }, '2026-11-23', 'morning', '2026-12-12', BASE)).toBe('W');
  });
  it('กะบ่ายรุ่นเดิม วันสุดท้ายคาบ = 10-19 ยกเว้นคนหยุดเสาร์', () => {
    expect(C.lastOf(BASE)).toBe('10-19');
    expect(C.avOf([], { dayOff: 1 }, '2026-12-12', 'evening', '2026-12-12', BASE)).toBe('10-19');
    expect(C.avOf([], { dayOff: 6 }, '2026-12-12', 'evening', '2026-12-12', BASE)).toBe('H');
    expect(C.avOf([], { dayOff: 1 }, '2026-12-12', 'morning', '2026-12-12', BASE)).toBe('W');
  });
  it('ชุดกะที่ตั้งใหม่ไม่มีกติกาวันสุดท้าย', () => {
    expect(C.lastOf(LATE)).toBe('');
    expect(C.avOf([], { dayOff: 1 }, '2027-01-09', 'evening', '2027-01-09', LATE)).toBe('W');
  });
  it('วันโปรฯ — เลขเบิ้ล (ยกเว้น 1/1) กับวันที่ 15 · 25 · 28', () => {
    expect(['2026-12-12', '2026-11-15', '2026-11-25', '2026-11-28'].every(C.isPro)).toBe(true);
    expect(C.isPro('2027-01-01')).toBe(false);
    expect(C.isPro('2026-11-16')).toBe(false);
  });
});
