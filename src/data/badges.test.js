/**
 * public/wms-badges.js — เลขงานค้างของสมุดกะบนเมนูข้าง
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shiftDay, countOpen, ageDays, pickCount, refreshFromSheet, renderBadge } from '../../public/wms-badges.js';

const URL = 'https://script.google.com/macros/s/x/exec';
const LOG = {
  a: { date: '2026-10-26', open: true },
  b: { date: '2026-10-24', open: true },
  c: { date: '2026-10-20', open: false },
  d: null,
};

describe('นับงานค้าง', () => {
  it('นับแค่ที่ยังเปิด และจำวันที่ของรายการที่เก่าสุด', () => {
    expect(countOpen(LOG)).toEqual({ n: 2, oldest: '2026-10-24' });
    expect(countOpen({})).toEqual({ n: 0, oldest: '' });
    expect(countOpen(undefined)).toEqual({ n: 0, oldest: '' });
  });

  it('ค้างกี่วัน นับถึงวันของกะ — ก่อน 7 โมงยังเป็นกะบ่ายของเมื่อวาน', () => {
    expect(shiftDay(new Date(2026, 9, 28, 6, 59))).toBe('2026-10-27');
    expect(shiftDay(new Date(2026, 9, 28, 7))).toBe('2026-10-28');
    expect(ageDays('2026-10-24', '2026-10-28')).toBe(4);
    expect(ageDays('', '2026-10-28')).toBe(0);
  });
});

describe('ใช้เลขจากที่ไหน', () => {
  const local = (rev, extra) => ({ log: LOG, sync: { url: URL, rev, ...extra } });
  const cache = { url: URL, rev: 12, n: 5, oldest: '2026-10-22' };

  it('ชีตมีฉบับใหม่กว่าเครื่องนี้ — ใช้เลขจากชีต', () => {
    expect(pickCount(local(11), cache, URL)).toEqual({ n: 5, oldest: '2026-10-22', needs: false });
  });

  it('ยังไม่มีใครรับทราบงานต่อ — เชื่อเลขจากชีตเฉพาะกะที่เช็คไว้ เปลี่ยนกะแล้วรอเช็คใหม่', () => {
    const c = { ...cache, shift: '2026-10-28-morning', needs: true };
    expect(pickCount(local(11), c, URL, new Date(2026, 9, 28, 10)).needs).toBe(true);
    expect(pickCount(local(11), c, URL, new Date(2026, 9, 28, 16)).needs).toBe(false);
  });

  it('นับจากในเครื่อง — ดูว่ากะนี้รับทราบงานต่อแล้วหรือยังจากในเครื่องด้วย', () => {
    const at = new Date(2026, 9, 28, 10);
    expect(pickCount(local(12), cache, URL, at).needs).toBe(true);
    const log = { ...LOG, 'ack-2026-10-28-morning': { kind: 'ack', date: '2026-10-28', shift: 'morning', at: at.getTime() } };
    expect(pickCount({ log, sync: null }, null, URL, at)).toEqual({ n: 2, oldest: '2026-10-24', needs: false });
  });

  it('เครื่องนี้มีฉบับเดียวกันหรือใหม่กว่า — นับจากในเครื่อง', () => {
    expect(pickCount(local(12), cache, URL).n).toBe(2);
    expect(pickCount(local(13), cache, URL).n).toBe(2);
  });

  it('เครื่องนี้แก้ค้างไว้ยังไม่ได้ส่ง — นับจากในเครื่อง มีงานที่เพิ่งบันทึกอยู่ในนั้น', () => {
    expect(pickCount(local(11, { dirty: true }), cache, URL).n).toBe(2);
  });

  it('เปลี่ยนไปใช้ชีตอื่นแล้ว — เลขของชีตเก่าไม่เอามาใช้', () => {
    expect(pickCount(local(11), cache, 'https://other/exec').n).toBe(2);
    expect(pickCount(local(11), null, URL).n).toBe(2);
  });

  it('ไม่เคยเชื่อมชีตในเครื่องนี้ แต่มีเลขจากชีตแล้ว — ใช้เลขจากชีต', () => {
    expect(pickCount({ log: {}, sync: null }, cache, URL).n).toBe(5);
  });
});

describe('เช็คชีต', () => {
  let store, calls;
  const post = (replies) => async (url, body) => { calls.push(body.op); return replies[body.op]; };
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 28, 10));
    store = {};
    calls = [];
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    globalThis.document = { querySelectorAll: () => [] };
    globalThis.window = {
      WmsSettings: { rosterUrl: () => URL, rosterToken: () => 't' },
      WmsGas: null,
    };
  });
  const cached = () => JSON.parse(store['wms:shiftlog:badge']);

  it('ฉบับบนชีตตรงกับในเครื่อง — ถามแค่ rev ไม่ต้องโหลดทั้งชุด', async () => {
    store['wms:roster'] = JSON.stringify({ shiftLog: LOG });
    store['wms:roster:sync'] = JSON.stringify({ url: URL, rev: 7 });
    window.WmsGas = { post: post({ rev: { app: 'roster', rev: 7 } }) };
    await refreshFromSheet();
    expect(calls).toEqual(['rev']);
    expect(cached()).toMatchObject({ url: URL, rev: 7, n: 2, oldest: '2026-10-24', shift: '2026-10-28-morning', needs: true });
  });

  it('ฉบับเดิมแต่เปลี่ยนกะแล้ว — โหลดมาดูว่ากะใหม่มีคนรับทราบงานต่อหรือยัง', async () => {
    store['wms:shiftlog:badge'] = JSON.stringify({ url: URL, rev: 9, n: 1, shift: '2026-10-27-evening', needs: false, at: 0 });
    window.WmsGas = { post: post({
      rev: { app: 'roster', rev: 9 },
      load: { app: 'roster', rev: 9, data: { shiftLog: { x: { date: '2026-10-27', shift: 'evening', open: true, at: 1 } } } },
    }) };
    await refreshFromSheet();
    expect(calls).toEqual(['rev', 'load']);
    expect(cached()).toMatchObject({ rev: 9, n: 1, shift: '2026-10-28-morning', needs: true });
  });

  it('อีกเครื่องบันทึกฉบับใหม่ — โหลดมานับ แต่ไม่เขียนทับตารางกะในเครื่อง', async () => {
    store['wms:roster'] = JSON.stringify({ shiftLog: {} });
    store['wms:roster:sync'] = JSON.stringify({ url: URL, rev: 7 });
    window.WmsGas = { post: post({
      rev: { app: 'roster', rev: 9 },
      load: { app: 'roster', rev: 9, data: { shiftLog: { x: { date: '2026-10-27', open: true } } } },
    }) };
    await refreshFromSheet();
    expect(calls).toEqual(['rev', 'load']);
    expect(cached()).toMatchObject({ rev: 9, n: 1, oldest: '2026-10-27' });
    expect(JSON.parse(store['wms:roster'])).toEqual({ shiftLog: {} });
  });

  it('เพิ่งเช็คไปไม่ถึง 3 นาที — ไม่ถามซ้ำ', async () => {
    store['wms:shiftlog:badge'] = JSON.stringify({ url: URL, rev: 9, n: 1, at: Date.now() - 60000 });
    window.WmsGas = { post: post({ rev: { app: 'roster', rev: 9 } }) };
    await refreshFromSheet();
    expect(calls).toEqual([]);
  });

  it('ชีตตอบ error (รหัสผิด) — ไม่เก็บเลขอะไร', async () => {
    window.WmsGas = { post: post({ rev: { error: 'รหัสไม่ตรงกับ ROSTER_TOKEN ใน Apps Script' } }) };
    await refreshFromSheet();
    expect(store['wms:shiftlog:badge']).toBeUndefined();
  });

  it('ยังไม่ได้ตั้งชีตตารางกะ — ไม่ยิงอะไรเลย', async () => {
    window.WmsSettings = { rosterUrl: () => '', rosterToken: () => '' };
    window.WmsGas = { post: post({}) };
    await refreshFromSheet();
    expect(calls).toEqual([]);
  });
});

describe('วาดเลขบนเมนู', () => {
  let store, link;
  // ลิงก์สมุดกะปลอม พอให้ renderBadge ใส่ / เอาเลขออกได้
  const fakeDoc = () => {
    link = { badge: null, title: '',
      querySelector: () => link.badge,
      appendChild: (b) => { link.badge = b; b.remove = () => { link.badge = null; }; },
      removeAttribute: () => { link.title = ''; } };
    return {
      querySelectorAll: () => [link],
      createElement: () => {
        const cls = new Set();
        return { textContent: '', classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) } };
      },
    };
  };
  const now = new Date(2026, 9, 28, 10);
  const draw = () => { renderBadge(fakeDoc(), now); return link; };
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    globalThis.window = { WmsSettings: { rosterUrl: () => URL, rosterToken: () => 't' } };
    store['wms:roster'] = JSON.stringify({ shiftLog: LOG });
    store['wms:roster:sync'] = JSON.stringify({ url: URL, rev: 7 });
  });

  it('โชว์จำนวนงานค้าง ค้างเกิน 2 วันเป็นสีแดง และบอกอายุใน title', () => {
    const a = draw();
    expect(a.badge.textContent).toBe('2');
    expect(a.badge.classList.contains('old')).toBe(true);
    expect(a.title).toBe('งานค้างในสมุดกะ 2 รายการ · เก่าสุดค้างมา 4 วัน · กะนี้ยังไม่มีใครกดรับทราบงานต่อ');
  });

  it('กะนี้ยังไม่มีใครรับทราบงานต่อ — เลขกะพริบ กดรับทราบแล้วหยุด', () => {
    const doc = fakeDoc();
    renderBadge(doc, now);
    expect(link.badge.classList.contains('ask')).toBe(true);
    const log = { ...LOG, 'ack-2026-10-28-morning': { kind: 'ack', date: '2026-10-28', shift: 'morning', by: 'สมชาย', at: now.getTime() } };
    store['wms:roster'] = JSON.stringify({ shiftLog: log });
    renderBadge(doc, now);
    expect(link.badge.classList.contains('ask')).toBe(false);
    expect(link.badge.textContent).toBe('2');
    expect(link.title).toBe('งานค้างในสมุดกะ 2 รายการ · เก่าสุดค้างมา 4 วัน');
  });

  it('ปิดงานค้างหมดแล้ว — เอาเลขออก', () => {
    const doc = fakeDoc();
    renderBadge(doc, now);
    expect(link.badge).not.toBe(null);
    store['wms:roster'] = JSON.stringify({ shiftLog: {} });
    renderBadge(doc, now);
    expect(link.badge).toBe(null);
    expect(link.title).toBe('');
  });

  it('หน้าที่ไม่ได้โหลดตั้งค่า — ใช้เลขจากชีตที่เช็คล่าสุด', () => {
    window.WmsSettings = undefined;
    store['wms:shiftlog:badge'] = JSON.stringify({ url: URL, rev: 9, n: 5, oldest: '2026-10-27' });
    const a = draw();
    expect(a.badge.textContent).toBe('5');
    expect(a.badge.classList.contains('old')).toBe(false);
  });

  it('ตั้งค่าไว้ว่าไม่ใช้ชีตแล้ว — ไม่เอาเลขชีตเก่ามาโชว์', () => {
    window.WmsSettings = { rosterUrl: () => '', rosterToken: () => '' };
    store['wms:shiftlog:badge'] = JSON.stringify({ url: URL, rev: 9, n: 5, oldest: '2026-10-27' });
    expect(draw().badge.textContent).toBe('2');
  });
});
