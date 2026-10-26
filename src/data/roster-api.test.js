/**
 * apps-script/roster-api.gs — หน้าดูของ Logis (op: 'view')
 *
 * รันสคริปต์จริงกับชีตปลอม เพราะสิ่งที่ต้องแน่ใจคือรหัสดูไม่เคยได้ข้อมูลส่วนอื่นของตารางกะ
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../apps-script/roster-api.gs'), 'utf8');

function script({ view = 'see', roster = 'full', data } = {}) {
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
    .replace("var ROSTER_TOKEN = '';", `var ROSTER_TOKEN = '${roster}';`);
  const api = new Function(...Object.keys(env), src + '\nreturn { doPost: doPost };')(...Object.values(env));
  return (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
}

const now = Date.now();
const DATA = {
  employees: [{ name: 'นายวุฒิชัย นะรานรัมย์', nick: 'ปู' }],
  overrides: { '2026-10-24|นายวุฒิชัย นะรานรัมย์': 'SL' },
  shiftLog: {
    a: { kind: 'order', order: 'CR-1', reason: 'split', logis: true, open: true, by: 'กัน', secret: 'x' },
    b: { kind: 'order', order: 'CR-2', open: false, result: 'shipped', closedAt: now - 3600000 },
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
    expect(r.items.find((e) => e.id === 'a')).toEqual(
      { id: 'a', order: 'CR-1', reason: 'split', logis: true, open: true, by: 'กัน' });
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
  });
});
