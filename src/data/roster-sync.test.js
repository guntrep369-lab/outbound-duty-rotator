/**
 * public/roster/roster-sync.js — ตารางกะชุดเดียวกันทุกเครื่อง
 *
 * ชีตปลอมข้างล่างทำตามกติกาเดียวกับ apps-script/roster-api.gs: นับฉบับทุกครั้งที่บันทึก
 * และไม่รับการบันทึกที่แก้ต่อจากฉบับเก่า แต่ส่งฉบับล่าสุดกลับไปแทน
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/roster/roster-sync.js'), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

function lib() {
  const win = {};
  new Function('window', SRC)(win);
  return win.RosterSync;
}

const START = {
  employees: [{ name: 'ก', group: 'A' }, { name: 'ข', group: 'B' }],
  outsource: [], periods: [{ id: 1, start: '2026-05-23', groupA: 'morning' }],
  holidays: [], extraPro: [], overrides: {}, kpiData: {}, minStaff: {}, osExtra: {},
};

function sheet() {
  const s = { rev: 0, data: null, at: 0, by: '', ops: [], down: false, onSave: null };
  const pub = () => ({ app: 'roster', rev: s.rev, at: s.at, by: s.by });
  s.post = async (url, body) => {
    s.ops.push(body.op);
    if (s.down) throw new TypeError('Failed to fetch');
    if (body.token !== 'T') return { error: 'รหัสไม่ตรงกับ ROSTER_TOKEN ใน Apps Script' };
    if (body.op === 'rev') return pub();
    if (body.op === 'load') return { ...pub(), data: clone(s.data) };
    if (body.op === 'save') {
      if (s.onSave) { const f = s.onSave; s.onSave = null; f(); }
      if (body.baseRev !== s.rev) return { ...pub(), conflict: true, data: clone(s.data) };
      s.rev++; s.data = clone(body.data); s.at = 1000 + s.rev; s.by = body.by;
      return { ok: true, ...pub() };
    }
    return { error: 'ไม่รู้จักคำสั่ง' };
  };
  return s;
}

function device(sh, data, opts = {}) {
  const store = opts.store || new Map();
  const d = {
    data: clone(data), asked: [], answers: [...(opts.answers || [])], states: [],
    local: opts.hasLocal ?? true, uiBusy: false, token: 'T', store,
  };
  d.sync = lib().create({
    key: 'wms:roster:sync',
    store: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    url: () => opts.url || 'https://sheet/exec', token: () => d.token, me: () => opts.me || 'เครื่อง',
    identify: async () => opts.identify ?? true,
    post: sh.post,
    get: () => ({ ...clone(d.data), savedAt: Date.now() }),
    put: (x) => { d.data = clone(x); return { migrated: false }; },
    hasLocal: () => d.local,
    describe: (x) => (x.employees || []).length + ' คน',
    ask: (m) => { d.asked.push(m); return d.answers.length ? d.answers.shift() : true; },
    canApply: () => !d.uiBusy,
    status: (s, info) => d.states.push(info.error ? s + ': ' + info.error : s),
    later: () => {},                       // เทสสั่ง sync() เอง ไม่รอเวลา
  });
  d.edit = (fn) => { fn(d.data); d.sync.changed(); };
  d.last = () => d.states[d.states.length - 1];
  return d;
}

/** ชีตที่มีตารางกะอยู่แล้ว กับสองเครื่องที่ซิงก์ไว้แล้วทั้งคู่ */
async function twoDevices() {
  const sh = sheet();
  const a = device(sh, START, { me: 'A' });
  await a.sync.sync();
  const b = device(sh, {}, { me: 'B', hasLocal: false });
  await b.sync.sync();
  return { sh, a, b };
}

describe('merge3 — รวมสิ่งที่สองเครื่องแก้จากฉบับเดียวกัน', () => {
  const { merge3 } = lib();

  it('แก้คนละช่องในส่วนที่เป็นช่อง ๆ — ได้ทั้งสองช่อง', () => {
    const r = merge3(START,
      { ...START, osExtra: { '2026-06-01|morning': { req: 3 } } },
      { ...START, osExtra: { '2026-06-02|evening': { req: 1 } } });
    expect(r.data.osExtra).toEqual({ '2026-06-01|morning': { req: 3 }, '2026-06-02|evening': { req: 1 } });
    expect(r.clash).toEqual([]);
  });

  it('แก้ช่องเดียวกันทั้งคู่ — เอาของเครื่องนี้ ไม่ต้องถาม', () => {
    const base = { ...START, overrides: { '2026-06-01|ก': 'H' } };
    const r = merge3(base,
      { ...START, overrides: { '2026-06-01|ก': 'W' } },
      { ...START, overrides: { '2026-06-01|ก': '10-19' } });
    expect(r.data.overrides).toEqual({ '2026-06-01|ก': 'W' });
    expect(r.clash).toEqual([]);
  });

  it('ฝั่งหนึ่งลบช่อง อีกฝั่งไม่ได้แตะ — ช่องนั้นหายไป', () => {
    const base = { ...START, osExtra: { 'x|morning': { req: 2 }, 'y|morning': { req: 4 } } };
    const r = merge3(base,
      { ...START, osExtra: { 'y|morning': { req: 4 } } },
      { ...START, osExtra: { 'x|morning': { req: 2 }, 'y|morning': { req: 4 }, 'z|evening': { req: 1 } } });
    expect(r.data.osExtra).toEqual({ 'y|morning': { req: 4 }, 'z|evening': { req: 1 } });
  });

  it('รายการที่แก้ฝั่งเดียว เอาฝั่งที่แก้ — แก้ทั้งคู่ต่างกัน ต้องให้คนเลือก', () => {
    const one = merge3(START, START, { ...START, holidays: [{ date: '2026-06-03', name: 'วันหยุด' }] });
    expect(one.data.holidays).toEqual([{ date: '2026-06-03', name: 'วันหยุด' }]);
    expect(one.clash).toEqual([]);

    const both = merge3(START,
      { ...START, employees: [...START.employees, { name: 'ค', group: 'A' }] },
      { ...START, employees: [START.employees[0]] });
    expect(both.clash).toEqual(['employees']);
    expect(both.data.employees.map((e) => e.name)).toEqual(['ก', 'ข', 'ค']);
  });

  it('แก้รายการเหมือนกันทั้งสองฝั่ง ไม่นับว่าชนกัน', () => {
    const same = { ...START, periods: [...START.periods, { id: 2, start: '2026-06-20', groupA: 'evening' }] };
    expect(merge3(START, same, clone(same)).clash).toEqual([]);
  });
});

describe('เชื่อมชีตครั้งแรก', () => {
  it('ชีตว่าง — ถามก่อน แล้วส่งตารางกะในเครื่องขึ้นไปเป็นชุดตั้งต้น', async () => {
    const sh = sheet();
    const a = device(sh, START, { me: 'A' });
    await a.sync.sync();
    expect(a.asked[0]).toContain('ยังว่าง');
    expect(sh.rev).toBe(1);
    expect(sh.data.employees).toEqual(START.employees);
    expect(sh.by).toBe('A');
    expect(a.last()).toBe('saved');
  });

  it('ชีตว่างแล้วตอบว่าไม่ส่ง — ไม่มีอะไรขึ้นชีต แก้ต่อก็ยังไม่ส่ง', async () => {
    const sh = sheet();
    const a = device(sh, START, { answers: [false] });
    await a.sync.sync();
    expect(sh.rev).toBe(0);
    expect(a.last()).toBe('declined');
    a.edit((x) => { x.minStaff.morning = 5; });
    await a.sync.sync();
    expect(sh.ops).not.toContain('save');
  });

  it('เครื่องใหม่ที่ยังไม่มีข้อมูล ใช้ของชีตเลยโดยไม่ถาม', async () => {
    const { sh, b } = await twoDevices();
    expect(b.asked).toEqual([]);
    expect(b.data.employees).toEqual(sh.data.employees);
    expect(b.last()).toBe('pulled');
  });

  it('เครื่องที่มีข้อมูลอยู่แล้ว ถามก่อน — ตอบ OK ใช้ของชีต', async () => {
    const sh = sheet();
    await device(sh, START).sync.sync();
    const c = device(sh, { ...START, employees: [{ name: 'อื่น', group: 'A' }] });
    await c.sync.sync();
    expect(c.asked[0]).toContain('มีตารางกะอยู่แล้ว');
    expect(c.data.employees).toEqual(START.employees);
    expect(sh.rev).toBe(1);
  });

  it('ไม่ใช้ของชีต แต่ยืนยันส่งของเครื่องนี้ — ชีตได้ข้อมูลของเครื่องนี้แทน', async () => {
    const sh = sheet();
    await device(sh, START).sync.sync();
    const mine = { ...START, employees: [{ name: 'อื่น', group: 'A' }] };
    const c = device(sh, mine, { answers: [false, true] });
    await c.sync.sync();
    expect(sh.rev).toBe(2);
    expect(sh.data.employees).toEqual(mine.employees);
  });

  it('URL ที่ไม่ใช่สคริปต์ตารางกะ — ไม่ยิง POST สักครั้ง', async () => {
    const sh = sheet();
    const a = device(sh, START, { identify: false });
    await a.sync.sync();
    expect(sh.ops).toEqual([]);
    expect(a.last()).toMatch(/^error: URL นี้ไม่ใช่สคริปต์ตารางกะ/);
  });
});

describe('ใช้งานพร้อมกันหลายเครื่อง', () => {
  it('เครื่องหนึ่งแก้ อีกเครื่องเช็คแล้วเห็นของใหม่', async () => {
    const { sh, a, b } = await twoDevices();
    a.edit((x) => { x.osExtra['2026-06-01|morning'] = { req: 3 }; });
    await a.sync.sync();
    expect(sh.data.osExtra).toEqual({ '2026-06-01|morning': { req: 3 } });
    await b.sync.sync();
    expect(b.data.osExtra).toEqual({ '2026-06-01|morning': { req: 3 } });
    expect(b.last()).toBe('pulled');
  });

  it('ไม่มีใครแก้ — เช็คแค่เลขฉบับ ไม่โหลดทั้งชุด', async () => {
    const { sh, b } = await twoDevices();
    sh.ops = [];
    await b.sync.sync();
    expect(sh.ops).toEqual(['rev']);
    expect(b.last()).toBe('synced');
  });

  it('แก้คนละวันพร้อมกัน — รวมกันเองโดยไม่ถาม และทั้งสองเครื่องได้ครบ', async () => {
    const { sh, a, b } = await twoDevices();
    a.edit((x) => { x.osExtra['2026-06-01|morning'] = { req: 3 }; });
    b.edit((x) => { x.osExtra['2026-06-02|evening'] = { req: 1, got: 1 }; });
    await a.sync.sync();
    await b.sync.sync();                               // ชนฉบับของ A → รวม → ส่งใหม่
    const both = { '2026-06-01|morning': { req: 3 }, '2026-06-02|evening': { req: 1, got: 1 } };
    expect(sh.data.osExtra).toEqual(both);
    expect(b.asked).toEqual([]);
    await a.sync.sync();
    expect(a.data.osExtra).toEqual(both);
  });

  it('แก้รายชื่อพนักงานต่างกันทั้งสองเครื่อง — ถาม แล้วตอบยกเลิก = ใช้ของเครื่องอื่น', async () => {
    const { sh, a, b } = await twoDevices();
    a.edit((x) => { x.employees.push({ name: 'ค', group: 'A' }); });
    b.edit((x) => { x.employees.push({ name: 'ง', group: 'B' }); x.minStaff.morning = 4; });
    await a.sync.sync();
    b.answers = [false];
    await b.sync.sync();
    expect(b.asked[0]).toContain('รายชื่อพนักงาน');
    expect(b.asked[0]).toContain('A');
    expect(sh.data.employees.map((e) => e.name)).toEqual(['ก', 'ข', 'ค']);
    expect(sh.data.minStaff).toEqual({ morning: 4 });       // ส่วนที่ไม่ชนยังรวมให้
  });

  it('แก้เพิ่มระหว่างกำลังส่ง — ส่งซ้ำให้อีกรอบ ของล่าสุดไม่ตกหล่น', async () => {
    const { sh, a } = await twoDevices();
    a.edit((x) => { x.minStaff.morning = 5; });
    sh.onSave = () => a.edit((x) => { x.minStaff.evening = 6; });
    await a.sync.sync();
    expect(sh.data.minStaff).toEqual({ morning: 5, evening: 6 });
    expect(a.sync.state().dirty).toBe(false);
  });

  it('มีช่องแก้ไขเปิดค้าง — ยังไม่ดึงของใหม่ทับ รอบหน้าค่อยดึง', async () => {
    const { a, b } = await twoDevices();
    a.edit((x) => { x.minStaff.morning = 7; });
    await a.sync.sync();
    b.uiBusy = true;
    await b.sync.sync();
    expect(b.data.minStaff).toEqual({});
    b.uiBusy = false;
    await b.sync.sync();
    expect(b.data.minStaff).toEqual({ morning: 7 });
  });
});

describe('ต่อชีตไม่ได้', () => {
  it('เน็ตหลุด — เก็บไว้ว่ายังไม่ได้ส่ง ต่อได้เมื่อไหร่ส่งให้', async () => {
    const { sh, a } = await twoDevices();
    sh.down = true;
    a.edit((x) => { x.minStaff.morning = 5; });
    await a.sync.sync();
    expect(a.last()).toBe('offline: Failed to fetch');
    expect(a.sync.state().dirty).toBe(true);
    sh.down = false;
    await a.sync.sync();
    expect(sh.data.minStaff).toEqual({ morning: 5 });
    expect(a.last()).toBe('saved');
  });

  it('รหัสผิด — บอกเหตุผลจากสคริปต์ตรง ๆ', async () => {
    const { a } = await twoDevices();
    a.token = 'ผิด';
    a.edit((x) => { x.minStaff.morning = 5; });
    await a.sync.sync();
    expect(a.last()).toBe('error: รหัสไม่ตรงกับ ROSTER_TOKEN ใน Apps Script');
  });

  it('ปิดหน้าไปตอนยังไม่ได้ส่ง เปิดใหม่แล้วส่งต่อจากเดิม ไม่ถามซ้ำ', async () => {
    const { sh, a } = await twoDevices();
    sh.down = true;
    a.edit((x) => { x.minStaff.morning = 5; });
    await a.sync.sync();
    sh.down = false;
    const again = device(sh, a.data, { store: a.store });
    await again.sync.sync();
    expect(again.asked).toEqual([]);
    expect(sh.data.minStaff).toEqual({ morning: 5 });
  });
});
