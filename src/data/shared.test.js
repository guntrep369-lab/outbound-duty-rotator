/**
 * ข้อมูลกลาง ฝั่งหน้าเว็บ: public/wms-shared.js และการใช้ใน public/wms-tx.js
 *
 * ตัวที่ต้องไม่ผิดคือการตัดสินว่า "มีชุดใหม่ไหม" ถ้าผิดทางหนึ่ง เครื่องจะถอยกลับไปชุดเก่าแล้วคนเห็นตัวเลขย้อน
 * ผิดอีกทางหนึ่ง เครื่องจะโหลดซ้ำทุกนาทีไม่หยุด และต้องถอยไปใช้วิธีเดิมได้ตอนที่สคริปต์ยังเป็นรุ่นก่อน
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-shared.js'), 'utf8');
const TX = fs.readFileSync(path.resolve(__dirname, '../../public/wms-tx.js'), 'utf8');

function load({ gas = {}, session = { name: 'คนเอ' } } = {}) {
  const listeners = [];
  const doc = {
    hidden: false,
    body: { tagName: 'BODY' },
    activeElement: null,
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.push(fn); },
  };
  const store = { 'wms:session': JSON.stringify(session) };
  const win = { WmsGas: gas };
  new Function('window', 'document', 'localStorage', 'console', JS)(win, doc, {
    getItem: (k) => (k in store ? store[k] : null),
  }, { warn: () => {} });
  doc.activeElement = doc.body;
  return { S: win.WmsShared, win, doc, show: (hidden) => { doc.hidden = hidden; listeners.forEach((fn) => fn()); } };
}

describe('wms-shared.js — ชุดไหนใหม่กว่า', () => {
  const { S } = load();
  const st = (info) => ({ app: 'transaction', shared: { 'tx-summary': info }, run: {}, err: {} });

  it('ใช้เวลาของป้าย shared ถ้าไม่มี (สคริปต์รุ่นก่อน) ใช้เวลาที่คิด', () => {
    expect(S.stamp(null)).toBe(0);
    expect(S.stamp({ at: 50 })).toBe(50);
    expect(S.stamp({ at: 50, shared: { at: 60 } })).toBe(60);
  });

  it('ใหม่กว่าเท่านั้นถึงนับว่ามีชุดใหม่ เท่ากันหรือเก่ากว่าไม่โหลด ตัวเลขบนจอจะไม่ย้อน', () => {
    const mine = { at: 100, shared: { at: 100 } };
    expect(S.newer(st({ at: 101 }), 'tx-summary', mine)).toBe(true);
    expect(S.newer(st({ at: 100 }), 'tx-summary', mine)).toBe(false);
    expect(S.newer(st({ at: 99 }), 'tx-summary', mine)).toBe(false);
    expect(S.newer(st({ at: 1 }), 'tx-summary', null)).toBe(true);
    expect(S.newer({ app: 'transaction', shared: {} }, 'tx-summary', null)).toBe(false);
    expect(S.newer(null, 'tx-summary', null)).toBe(false);
  });

  it('ชุดที่ผูกกับช่วงวันที่ ช่วงไม่ตรงไม่นับว่าใหม่', () => {
    const s = { app: 'transaction', shared: { 'tx-daily': { at: 200, params: { from: '2026-03-01', to: '2026-03-31' } } } };
    expect(S.newer(s, 'tx-daily', { at: 100 }, { from: '2026-03-01', to: '2026-03-31' })).toBe(true);
    expect(S.newer(s, 'tx-daily', { at: 100 }, { from: '2026-02-01', to: '2026-02-28' })).toBe(false);
  });

  it('รู้ว่าเป็นสคริปต์ที่มีข้อมูลกลาง สคริปต์รุ่นก่อนตอบแค่ชื่อแอป', () => {
    expect(S.knows({ app: 'cut', shared: {} }, 'cut')).toBe(true);
    expect(S.knows({ app: 'cut' }, 'cut')).toBe(false);
    expect(S.knows({ app: 'transaction', shared: {} }, 'cut')).toBe(false);
    expect(S.knows(null, 'cut')).toBe(false);
  });

  it('ป้ายคนทำ: ชื่อคนกด หรือ อัตโนมัติ ชุดที่ไม่มีป้ายไม่บอกอะไร', () => {
    expect(S.who({ at: 1 })).toBe('');
    expect(S.who({ shared: { by: 'คนเอ', auto: false } })).toBe('คนเอ');
    expect(S.who({ shared: { by: '', auto: true } })).toBe('อัตโนมัติ');
    expect(S.who({ shared: { by: '', auto: false } })).toBe('ไม่ทราบชื่อ');
    expect(S.runner({ by: 'คนบี', auto: false })).toBe('คนบี');
    expect(S.runner({ by: '', auto: true })).toBe('รอบอัตโนมัติ');
    expect(S.running({ run: { x: { at: 1 } } }, 'x')).toEqual({ at: 1 });
    expect(S.running({ run: {} }, 'x')).toBeNull();
  });
});

describe('wms-shared.js — กำลังพิมพ์อยู่ไหม', () => {
  it('ช่องพิมพ์ ช่องเลือก และพื้นที่ข้อความ นับว่าพิมพ์อยู่ ปุ่มกับช่องติ๊กไม่นับ', () => {
    const { S, doc } = load();
    expect(S.typing()).toBe(false);
    doc.activeElement = { tagName: 'INPUT', type: 'search' };
    expect(S.typing()).toBe(true);
    doc.activeElement = { tagName: 'INPUT', type: 'number' };
    expect(S.typing()).toBe(true);
    doc.activeElement = { tagName: 'INPUT', type: 'checkbox' };
    expect(S.typing()).toBe(false);
    doc.activeElement = { tagName: 'TEXTAREA' };
    expect(S.typing()).toBe(true);
    doc.activeElement = { tagName: 'SELECT' };
    expect(S.typing()).toBe(true);
    doc.activeElement = { tagName: 'BUTTON' };
    expect(S.typing()).toBe(false);
  });
});

describe('wms-shared.js — คำขอไปสคริปต์', () => {
  it('อ่านชุดกลางต่อ &shared=1 ท้าย api เดิม ใช้ได้กับ api ที่มีพารามิเตอร์อยู่แล้ว', async () => {
    const json = vi.fn(async () => ({ ok: 1 }));
    const { S } = load({ gas: { json } });
    await S.read('U', 'tx-daily&from=2026-03-01&to=2026-03-31', { retries: 1 });
    expect(json).toHaveBeenCalledWith('U', 'tx-daily&from=2026-03-01&to=2026-03-31&shared=1', { retries: 1 });
  });

  it('กดดึงใหม่ส่งเป็น POST พร้อมชื่อคนที่ลงชื่อเข้าระบบ ไม่ใส่ชื่อใน URL', async () => {
    const post = vi.fn(async () => ({ ok: 1 }));
    const { S } = load({ gas: { post }, session: { name: 'คนเอ' } });
    await S.press('U', 'tx-daily', { from: '2026-03-01', to: '2026-03-31' }, { timeoutMs: 5 });
    expect(post).toHaveBeenCalledWith('U', { op: 'shared-fresh', api: 'tx-daily', by: 'คนเอ', from: '2026-03-01', to: '2026-03-31' }, { timeoutMs: 5 });
  });

  it('ถามสถานะเงียบ ๆ ไม่ลองซ้ำ ล้มได้ null ไม่โยน error ใส่หน้าเว็บ', async () => {
    const json = vi.fn(async () => { throw new Error('HTTP 500'); });
    const { S } = load({ gas: { json } });
    expect(await S.status('U')).toBeNull();
    expect(json).toHaveBeenCalledWith('U', 'shared-at', { retries: 0, timeoutMs: 30000 });
  });
});

describe('wms-shared.js — ถามทุกนาที', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ถามทุกนาที มีคนกำลังดึงอยู่ถามถี่ขึ้นเป็นทุก 15 วินาที', async () => {
    const { S } = load();
    let soon = false;
    const check = vi.fn(async () => soon);
    S.watch(check);
    await vi.advanceTimersByTimeAsync(59000);
    expect(check).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    soon = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('สลับไปแท็บอื่นไม่ถาม กลับมาดูถามทันที', async () => {
    const { S, show } = load();
    const check = vi.fn(async () => false);
    S.watch(check);
    show(true);
    await vi.advanceTimersByTimeAsync(300000);
    expect(check).toHaveBeenCalledTimes(0);
    show(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('รอบก่อนยังไม่เสร็จ ไม่เรียกซ้อน และ check ล้มก็ยังถามรอบต่อไป', async () => {
    const { S } = load();
    let release;
    const check = vi.fn(() => new Promise((r) => { release = r; }));
    const w = S.watch(check);
    w.now();
    await vi.advanceTimersByTimeAsync(0);
    w.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    release(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => { throw new Error('พัง'); });
    const w2 = S.watch(bad);
    w2.now();
    await vi.advanceTimersByTimeAsync(60000);
    expect(bad).toHaveBeenCalledTimes(2);
    w.stop(); w2.stop();
  });
});

describe('wms-tx.js — ดึงผ่านข้อมูลกลาง', () => {
  const DATA = { app: 'transaction', keys: [], skus: [], locs: [], sold: [], issues: { counts: {}, list: [] }, at: 5 };

  function tx(press, json) {
    const session = new Map();
    const win = {
      WmsShared: { OLD: 'ไม่รู้จักคำสั่งนี้', press: vi.fn(press), read: vi.fn(async () => ({ ...DATA, shared: { at: 9 } })) },
      WmsGas: { json: vi.fn(json || (async () => DATA)) },
    };
    new Function('window', 'sessionStorage', 'console', TX)(win, {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
    }, { warn: () => {} });
    return { T: win.WmsTx, win, session };
  }

  it('กดดึงใหม่สั่งให้สคริปต์คิดแล้วเก็บเป็นชุดกลาง', async () => {
    const { T, win, session } = tx(async () => ({ ...DATA, shared: { at: 7, by: 'คนเอ' } }));
    const s = await T.pull('U');
    expect(win.WmsShared.press).toHaveBeenCalledWith('U', 'tx-summary', null, undefined);
    expect(win.WmsGas.json).not.toHaveBeenCalled();
    expect(s.shared.by).toBe('คนเอ');
    expect(JSON.parse(session.get('wms:tx:summary')).shared.at).toBe(7);
  });

  it('สคริปต์รุ่นก่อนไม่รู้จักคำสั่ง ถอยไปดึงแบบเดิม', async () => {
    const { T, win } = tx(async () => ({ error: 'ไม่รู้จักคำสั่งนี้' }));
    const s = await T.pull('U', { retries: 1 });
    expect(win.WmsGas.json).toHaveBeenCalledWith('U', 'tx-summary', { retries: 1 });
    expect(s.at).toBe(5);
  });

  it('มีคนกำลังดึงอยู่ ได้ busy กลับไป ไม่เก็บทับแคช', async () => {
    const { T, session } = tx(async () => ({ app: 'transaction', busy: { at: 1, by: 'คนบี' } }));
    expect(await T.pull('U')).toEqual({ busy: { at: 1, by: 'คนบี' } });
    expect(session.has('wms:tx:summary')).toBe(false);
  });

  it('error อื่นจากสคริปต์ยังบอกให้เห็นเหมือนเดิม', async () => {
    const { T } = tx(async () => ({ error: 'ไม่พบชีต Transaction' }));
    await expect(T.pull('U')).rejects.toThrow('Apps Script error: ไม่พบชีต Transaction');
  });

  it('เปิดหน้าอ่านชุดที่เก็บไว้แล้วเก็บแคชของรอบนี้', async () => {
    const { T, session } = tx(async () => DATA);
    const s = await T.pullShared('U');
    expect(s.shared.at).toBe(9);
    expect(JSON.parse(session.get('wms:tx:summary')).shared.at).toBe(9);
  });
});
