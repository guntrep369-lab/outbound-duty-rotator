/**
 * public/roster/roster-people.js — กลุ่ม/วันหยุดที่มีวันเริ่ม และการนับวันลา
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/roster/roster-people.js'), 'utf8');
const win = {};
new Function('window', SRC)(win);
const P = win.RosterPeople;

const person = () => ({ name: 'ก', group: 'A', dayOff: 1 });

describe('ย้ายกลุ่ม / เปลี่ยนวันหยุดตั้งแต่วันที่เลือก', () => {
  it('ก่อนวันเริ่มยังเป็นค่าเดิม ตั้งแต่วันเริ่มเป็นค่าใหม่', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'B', dayOff: 3 });
    expect(P.at(p, '2026-05-23')).toEqual({ group: 'A', dayOff: 1 });
    expect(P.at(p, '2026-06-19')).toEqual({ group: 'A', dayOff: 1 });
    expect(P.at(p, '2026-06-20')).toEqual({ group: 'B', dayOff: 3 });
    expect(P.at(p, '2026-12-01')).toEqual({ group: 'B', dayOff: 3 });
  });

  it('เปลี่ยนหลายครั้ง — แต่ละช่วงได้ค่าของช่วงนั้น', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'B', dayOff: 3 });
    P.setFrom(p, '2026-08-15', { group: 'A', dayOff: 5 });
    expect(p.changes.map((c) => c.from)).toEqual(['2026-06-20', '2026-08-15']);
    expect(P.at(p, '2026-07-01')).toEqual({ group: 'B', dayOff: 3 });
    expect(P.at(p, '2026-09-01')).toEqual({ group: 'A', dayOff: 5 });
  });

  it('เปลี่ยนแค่วันหยุดไว้ข้างหน้า แล้วย้ายกลุ่มก่อนหน้านั้น — ข้างหน้ายังอยู่กลุ่มใหม่', () => {
    const p = person();
    P.setFrom(p, '2026-08-15', { dayOff: 5 });
    P.setFrom(p, '2026-06-20', { group: 'B' });
    expect(P.at(p, '2026-07-01')).toEqual({ group: 'B', dayOff: 1 });
    expect(P.at(p, '2026-09-01')).toEqual({ group: 'B', dayOff: 5 });
  });

  it('เลือกค่าที่ใช้อยู่แล้ว ไม่เก็บเป็นประวัติ', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'A', dayOff: 1 });
    expect(p.changes).toBeUndefined();
  });

  it('ตั้งวันเดิมซ้ำ แทนที่ค่าเก่า — ตั้งกลับเป็นค่าก่อนหน้าแล้วรายการนั้นหายไป', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'B', dayOff: 3 });
    P.setFrom(p, '2026-06-20', { dayOff: 4 });
    expect(p.changes).toEqual([{ from: '2026-06-20', group: 'B', dayOff: 4 }]);
    P.setFrom(p, '2026-06-20', { group: 'A', dayOff: 1 });
    expect(p.changes).toBeUndefined();
  });

  it('ไม่ใส่วันเริ่ม = แก้ค่าตั้งต้น และลบเฉพาะค่านั้นออกจากประวัติ', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'B', dayOff: 3 });
    P.setFrom(p, '', { dayOff: 0 });
    expect(p.dayOff).toBe(0);
    expect(p.changes).toEqual([{ from: '2026-06-20', group: 'B' }]);
    expect(P.at(p, '2026-05-01')).toEqual({ group: 'A', dayOff: 0 });
    expect(P.at(p, '2026-07-01')).toEqual({ group: 'B', dayOff: 0 });
    P.setFrom(p, '', { group: 'B' });
    expect(p).toEqual({ name: 'ก', group: 'B', dayOff: 0 });
  });

  it('ลบการเปลี่ยนครั้งหนึ่ง ช่วงนั้นกลับไปใช้ค่าก่อนหน้า', () => {
    const p = person();
    P.setFrom(p, '2026-06-20', { group: 'B', dayOff: 3 });
    P.setFrom(p, '2026-08-15', { dayOff: 5 });
    P.unset(p, '2026-06-20');
    expect(P.at(p, '2026-07-01')).toEqual({ group: 'A', dayOff: 1 });
    expect(P.at(p, '2026-09-01')).toEqual({ group: 'A', dayOff: 5 });
    P.unset(p, '2026-08-15');
    expect(p.changes).toBeUndefined();
  });

  it('ข้อมูล OS รุ่นเก่าที่ไม่มีช่องวันหยุด นับเป็นไม่มีวันหยุด (-1)', () => {
    expect(P.at({ name: 'OS1', group: 'A' }, '2026-06-20')).toEqual({ group: 'A', dayOff: -1 });
  });

  it('OS ที่ไม่มีวันหยุด (-1) ใช้ได้เหมือนกัน', () => {
    const os = { name: 'OS1', group: 'A', dayOff: -1 };
    P.setFrom(os, '2026-06-20', { group: 'B', dayOff: -1 });
    expect(P.at(os, '2026-06-20')).toEqual({ group: 'B', dayOff: -1 });
    expect(os.changes).toEqual([{ from: '2026-06-20', group: 'B' }]);
  });
});

describe('วันลา', () => {
  const ov = {
    '2026-06-03|ก': 'SL', '2026-06-15|ก': 'PL', '2026-06-16|ก': 'PL',
    '2026-06-10|ข': 'VL', '2026-06-11|ข': 'H',
    '2026-07-01|ก': 'SL', '2026-05-31|ก': 'VL',
  };

  it('นับแยกประเภทและคน เฉพาะในช่วงที่ขอ ไม่นับ W/H', () => {
    const t = P.tally(ov, '2026-06-01', '2026-06-30');
    expect(t['ก']).toMatchObject({ SL: 1, PL: 2, VL: 0 });
    expect(t['ข']).toMatchObject({ SL: 0, PL: 0, VL: 1 });
    expect(t['ก'].days).toEqual([['2026-06-03', 'SL'], ['2026-06-15', 'PL'], ['2026-06-16', 'PL']]);
  });

  it('ทั้งปีรวมทุกเดือน', () => {
    const t = P.tally(ov, '2026-01-01', '2026-12-31');
    expect(t['ก']).toMatchObject({ SL: 2, PL: 2, VL: 1 });
  });

  it('ลาไม่นับเป็นคนมาทำงาน', () => {
    const v = ['W', '10-19', 'H', 'SL', 'PL', 'VL', 'toString'];
    expect(v.map(P.isWork)).toEqual([true, true, false, false, false, false, false]);
    expect(v.map(P.isLeave)).toEqual([false, false, false, true, true, true, false]);
  });
});
