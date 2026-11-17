/**
 * apps-script/roster-api.gs — หน้าดูของ Logis (op: 'view')
 *
 * apps-script/roster-api.gs — หน้าดูของ HR (op: 'hr')
 *
 * รันสคริปต์จริงกับชีตปลอม เพราะสิ่งที่ต้องแน่ใจคือรหัสดูไม่เคยได้ข้อมูลส่วนอื่นของตารางกะ
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../apps-script/roster-api.gs'), 'utf8');

function script({ view = 'see', roster = 'full', hr = 'staff', data } = {}) {
  const text = 'j' + JSON.stringify(data);
  const props = { rev: '3', at: '1000', by: 'กัน', col: '1', chunks: '1' };
  const sheet = { getRange: () => ({ getValues: () => [[text]] }) };
  const env = {
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => props }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
    LockService: {},
  };
  const src = SRC.replace("var VIEW_TOKEN = '';", `var VIEW_TOKEN = '${view}';`)
    .replace("var ROSTER_TOKEN = '';", `var ROSTER_TOKEN = '${roster}';`)
    .replace("var HR_TOKEN = '';", `var HR_TOKEN = '${hr}';`);
  const api = new Function(...Object.keys(env), src + '\nreturn { doPost: doPost };')(...Object.values(env));
  return (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
}

const now = Date.now();
const DATA = {
  employees: [{ name: 'นายวุฒิชัย นะรานรัมย์', nick: 'ปู' }],
  overrides: { '2026-10-24|นายวุฒิชัย นะรานรัมย์': 'SL' },
  shiftLog: {
    a: { kind: 'order', order: 'CR-1', reason: 'split', logis: true, open: true, by: 'กัน', secret: 'x',
      items: [{ product: 'หมอน', qty: 2 }, { sku: 'LEG0000000032' }] },
    b: { kind: 'order', order: 'CR-2', open: false, result: 'shipped', closedAt: now - 3600000, product: 'ผ้าหุ้ม', sku: 'LEG0000000032' },
    c: { kind: 'order', order: 'CR-3', open: false, result: 'shipped', closedAt: now - 5 * 86400000 },
    d: { kind: 'handover', text: 'คนไม่พอ', open: true },
  },
};

describe('หน้าดูของ Logis', () => {
  it('ได้แค่ออเดอร์ที่ค้างกับที่เพิ่งปิด — ไม่มีรายชื่อ วันลา หรือเรื่องภายในทีม', () => {
    const r = script({ data: DATA })({ op: 'view', token: 'see' });
    expect(r.app).toBe('roster');
    expect(r.items.map((e) => e.id).sort()).toEqual(['a', 'b']);
    // ช่องที่ไม่ได้อยู่ในรายการที่อนุญาต (secret) ไม่ถูกส่งออกไป
    expect(r.items.find((e) => e.id === 'a')).toEqual({
      id: 'a', order: 'CR-1', reason: 'split', logis: true, open: true, by: 'กัน',
      items: [{ product: 'หมอน', qty: 2 }, { sku: 'LEG0000000032' }],
    });
    // รายการรุ่นแรกที่มีสินค้าตัวเดียวก็ยังเห็นสินค้า
    expect(r.items.find((e) => e.id === 'b')).toMatchObject({ product: 'ผ้าหุ้ม', sku: 'LEG0000000032' });
    const text = JSON.stringify(r);
    expect(text).not.toContain('นายวุฒิชัย');
    expect(text).not.toContain('คนไม่พอ');
  });

  it('รหัสดูใช้แทนรหัสตารางกะไม่ได้ และรหัสตารางกะใช้เปิดหน้าดูไม่ได้', () => {
    const call = script({ data: DATA });
    expect(call({ op: 'load', token: 'see' }).error).toBeTruthy();
    expect(call({ op: 'view', token: 'full' }).error).toBeTruthy();
    expect(call({ op: 'load', token: 'full' }).data.employees).toHaveLength(1);
  });

  it('ยังไม่ตั้ง VIEW_TOKEN = ปิดอยู่ แม้ส่งรหัสว่างมา', () => {
    const r = script({ view: '', data: DATA })({ op: 'view', token: '' });
    expect(r.error).toContain('VIEW_TOKEN');
    expect(r.items).toBeUndefined();
  });

  it('ชีตยังว่าง ได้รายการว่าง', () => {
    const call = script({ data: null });
    expect(call({ op: 'view', token: 'see' }).items).toEqual([]);
    expect(call({ op: 'view', token: 'see' }).shiftDefs).toEqual([]);
  });

  it('ส่งชื่อกับเวลากะไปด้วย — เฉพาะชื่อ เวลา และรับงานต่อ ช่องอื่นไม่ออกไป', () => {
    const defs = [{ from: '2026-12-13', note: 'x', shifts: {
      morning: { name: 'กะเช้า', start: '07:00', end: '16:00', secret: 1 },
      evening: { name: 'กะสาย', start: '10:00', end: '19:00', ack: true } } }, null, { from: 5 }];
    const r = script({ data: { ...DATA, shiftDefs: defs } })({ op: 'view', token: 'see' });
    expect(r.shiftDefs).toEqual([{ from: '2026-12-13', shifts: {
      morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
      evening: { name: 'กะสาย', start: '10:00', end: '19:00', ack: true } } }]);
    // ข้อมูลจากหน้าตารางกะรุ่นก่อนไม่มีค่าตั้งกะ — ได้รายการว่าง หน้า Logis ใช้ชื่อตั้งต้น
    expect(script({ data: DATA })({ op: 'view', token: 'see' }).shiftDefs).toEqual([]);
  });
});

// ข้อมูลสมมติ — ไม่ใช่รายชื่อจริง
const FULL = {
  employees: [
    { name: 'สมชาย ทดสอบ', nick: 'ชาย', group: 'A', dayOff: 0, salary: 1, changes: [{ from: '2026-12-13', group: 'B', note: 'x' }] },
    { name: 'สมหญิง ทดสอบ', nick: 'หญิง', group: 'B', dayOff: 6 },
  ],
  outsource: [{ name: 'OS ทดสอบ', nick: 'โอ', group: 'A', dayOff: 3 }],
  periods: [{ id: 'p1', start: '2026-11-15', groupA: 'morning', secret: 1 }],
  holidays: [{ date: '2026-12-05', name: 'วันพ่อ' }],
  extraPro: [{ date: '2026-11-20' }],
  overrides: { '2026-11-16|สมชาย ทดสอบ': 'SL', '2026-11-17|คนที่ลาออกแล้ว': 'PL' },
  late: { '2026-11-18|สมหญิง ทดสอบ': 15, '2026-11-18|คนที่ลาออกแล้ว': 5 },
  ot: { '2026-11-19|OS ทดสอบ': 2 },
  kpiData: { '2026-11': { 'สมชาย ทดสอบ': { pickRate: 30 } } },
  minStaff: { morning: 6 },
  osExtra: { '2026-11-16|morning': { req: 2 }, '2026-11-16|evening': { req: 3, got: 2, note: 'x' }, bad: { req: 1 }, '2026-11-17|morning': { req: '4' } },
  shiftLog: DATA.shiftLog,
  shiftDefs: [{ from: '2026-12-13', shifts: {
    morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
    evening: { name: 'กะสาย', start: '10:00', end: '19:00' } } }],
};

describe('หน้าดูของ HR', () => {
  it('ได้ตารางกะ วันลา และแผน OS เสริม — ไม่มี KPI สมุดกะ หรือคนขั้นต่ำ', () => {
    const r = script({ data: FULL })({ op: 'hr', token: 'staff' });
    expect(r.hr).toBe(true);
    expect(Object.keys(r.data).sort()).toEqual(['employees', 'extraPro', 'holidays', 'late', 'osExtra', 'ot', 'outsource', 'overrides', 'periods', 'shiftDefs']);
    const text = JSON.stringify(r);
    expect(text).not.toContain('pickRate');
    expect(text).not.toContain('CR-1');
    expect(text).not.toContain('คนไม่พอ');
    expect(r.data.shiftDefs[0].shifts.evening.name).toBe('กะสาย');
    expect(r.data.minStaff).toBeUndefined();
  });

  it('แผน OS เสริม — HR เห็นจำนวนที่ขอกับที่มาจริง เฉพาะตัวเลข', () => {
    const r = script({ data: FULL })({ op: 'hr', token: 'staff' });
    expect(r.data.osExtra).toEqual({ '2026-11-16|morning': { req: 2 }, '2026-11-16|evening': { req: 3, got: 2 } });
  });

  it('คนแต่ละคนได้แค่ชื่อ ชื่อเล่น กลุ่ม วันหยุด และวันที่ย้ายกลุ่ม', () => {
    const r = script({ data: FULL })({ op: 'hr', token: 'staff' });
    expect(r.data.employees[0]).toEqual({ name: 'สมชาย ทดสอบ', nick: 'ชาย', group: 'A', dayOff: 0,
      changes: [{ from: '2026-12-13', group: 'B' }] });
    expect(r.data.periods).toEqual([{ id: 'p1', start: '2026-11-15', groupA: 'morning' }]);
    expect(r.data.outsource).toHaveLength(1);
  });

  it('วันลา สาย OT ส่งเฉพาะของคนที่ยังอยู่ในรายชื่อ', () => {
    const r = script({ data: FULL })({ op: 'hr', token: 'staff' });
    expect(r.data.overrides).toEqual({ '2026-11-16|สมชาย ทดสอบ': 'SL' });
    expect(r.data.late).toEqual({ '2026-11-18|สมหญิง ทดสอบ': 15 });
    expect(r.data.ot).toEqual({ '2026-11-19|OS ทดสอบ': 2 });
    expect(JSON.stringify(r)).not.toContain('คนที่ลาออกแล้ว');
  });

  it('รหัส HR ใช้โหลด บันทึก หรือเปิดหน้า Logis ไม่ได้ — และรหัสอื่นเปิดหน้า HR ไม่ได้', () => {
    const call = script({ data: FULL });
    expect(call({ op: 'load', token: 'staff' }).error).toBeTruthy();
    expect(call({ op: 'save', token: 'staff', data: { employees: [] } }).error).toBeTruthy();
    expect(call({ op: 'view', token: 'staff' }).error).toBeTruthy();
    expect(call({ op: 'hr', token: 'full' }).error).toBeTruthy();
    expect(call({ op: 'hr', token: 'see' }).error).toBeTruthy();
  });

  it('ยังไม่ตั้ง HR_TOKEN = ปิดอยู่ แม้ส่งรหัสว่างมา', () => {
    const r = script({ hr: '', data: FULL })({ op: 'hr', token: '' });
    expect(r.error).toContain('HR_TOKEN');
    expect(r.data).toBeUndefined();
  });

  it('ตั้ง HR_TOKEN ซ้ำกับรหัสตารางกะ = ไม่ยอมเปิด', () => {
    const r = script({ hr: 'full', data: FULL })({ op: 'hr', token: 'full' });
    expect(r.error).toContain('ไม่ซ้ำ');
    expect(r.data).toBeUndefined();
  });

  it('ชีตยังว่าง ได้ข้อมูลว่าง', () => {
    const r = script({ data: null })({ op: 'hr', token: 'staff' });
    expect(r.data.employees).toEqual([]);
    expect(r.data.overrides).toEqual({});
    expect(r.data.osExtra).toEqual({});
  });

  it('กติกาวันสุดท้ายของกะบ่ายรุ่นเดิมไปด้วย หน้า HR จะเห็นช่อง 10-19 เหมือนตารางกะ', () => {
    const defs = [{ from: '2026-11-15', shifts: {
      morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
      evening: { name: 'กะบ่าย', start: '16:00', end: '24:00', last: { start: '10:00', end: '19:00', skipOff: 6, x: 1 } } } }];
    const r = script({ data: { ...FULL, shiftDefs: defs } })({ op: 'hr', token: 'staff' });
    expect(r.data.shiftDefs[0].shifts.evening.last).toEqual({ start: '10:00', end: '19:00', skipOff: 6 });
  });
});
