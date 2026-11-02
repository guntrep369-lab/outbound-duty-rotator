/**
 * สายพานรอโหลดกับตัวเลขที่วิ่ง (public/wms-gas.js + public/wms-motion.js)
 *
 * สายพานต้องขึ้นเฉพาะตอนที่คนนั่งรออยู่ และต้องหายเสมอเมื่อคำขอจบ ไม่ว่าจะสำเร็จหรือพัง
 * ค้างอยู่ทั้งที่ไม่มีอะไรโหลดแล้ว คนจะคิดว่าระบบยังทำงานอยู่
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const GAS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-gas.js'), 'utf8');

/** โหลด wms-gas.js ใส่หน้าต่างปลอม เก็บทุกสัญญาณ wms:busy ที่ส่งออกมา */
function loadGas(fetchImpl) {
  const events = [];
  const win = { dispatchEvent: (e) => events.push(e.detail) };
  class Ev { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  new Function('window', 'fetch', 'CustomEvent', GAS)(win, fetchImpl, Ev);
  return { gas: win.WmsGas, events };
}

const ok = (body) => () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });

describe('สายพานรอโหลด — สัญญาณจาก wms-gas.js', () => {
  it('ดึงข้อมูลที่หน้าเว็บบอกคนว่ากำลังรอ: ขึ้นตอนเริ่ม หายตอนอ่านข้อมูลเสร็จ', async () => {
    const { gas, events } = loadGas(ok('{"app":"cut"}'));
    const p = gas.json('https://x/exec', 'cut-check', { onProgress: () => {} });
    expect(events).toEqual([{ n: 1, mode: 'get' }]);
    expect(gas.waiting()).toBe(1);
    expect(await p).toEqual({ app: 'cut' });
    expect(events.at(-1)).toEqual({ n: 0, mode: 'get' });
    expect(gas.waiting()).toBe(0);
  });

  it('เช็คเงียบ ๆ เบื้องหลัง (ไม่ส่ง onProgress) ไม่ทำให้สายพานโผล่', async () => {
    const { gas, events } = loadGas(ok('{}'));
    await gas.post('https://x/exec', { op: 'rev' }, { timeoutMs: 30000 });
    await gas.fetchWithRetry('https://x/exec', {});
    expect(events).toEqual([]);
  });

  it('บันทึกที่ขอให้โชว์ (busy:true) บอกว่าเป็นการส่งข้อมูล', async () => {
    const { gas, events } = loadGas(ok('{"ok":true}'));
    await gas.post('https://x/exec', { op: 'save' }, { busy: true });
    expect(events.map((e) => e.mode)).toEqual(['post', 'post']);
    expect(events.at(-1).n).toBe(0);
  });

  it('คำขอพังก็ต้องหาย ไม่ค้างว่ายังโหลดอยู่', async () => {
    const { gas, events } = loadGas(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(gas.json('https://x/exec', 'stock', { onProgress: () => {}, retries: 0 })).rejects.toThrow('HTTP 500');
    expect(events.at(-1).n).toBe(0);
  });

  it('สองคำขอพร้อมกัน สายพานหายเมื่อจบครบทั้งสอง', async () => {
    let release;
    const slow = new Promise((r) => { release = r; });
    let calls = 0;
    const { gas, events } = loadGas(() => (++calls === 1 ? slow : ok('{}')()));
    const a = gas.json('https://x/exec', 'order', { onProgress: () => {} });
    await gas.json('https://x/exec', 'stock', { onProgress: () => {} });
    expect(gas.waiting()).toBe(1);
    release({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    await a;
    expect(events.map((e) => e.n)).toEqual([1, 2, 1, 0]);
  });
});

describe('ตัวเลขที่วิ่ง — wms-motion.js', () => {
  let M;
  beforeAll(async () => {
    M = await import('../../public/wms-motion.js');
    /* ลดการเคลื่อนไหว: ไม่ต้องรอเฟรม ผลที่ได้คือคลาสที่ใส่ */
    M.mountMotion({}, '../', { matchMedia: () => ({ matches: true }) });
  });

  /** ตัวเลขปลอมหนึ่งช่อง */
  const num = (count, key) => {
    const cls = new Set();
    return {
      dataset: key ? { count: String(count), countKey: key } : { count: String(count) },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) },
      offsetWidth: 0,
      textContent: String(count),
    };
  };
  const root = (els) => ({
    querySelectorAll: (sel) => (sel.includes('[data-count-key]') ? els.filter((e) => e.dataset.countKey) : els),
  });

  it('จำค่าเดิมได้เฉพาะตัวเลขที่มีชื่อ', () => {
    const els = [num(47, 'tab-fix'), num(304, 'tab-sys'), num(110251)];
    expect(M.counts(root(els))).toEqual({ 'tab-fix': 47, 'tab-sys': 304 });
  });

  it('ตัวที่ลดลงจากรอบก่อนกะพริบเขียว ตัวที่เพิ่มหรือไม่มีค่าเดิมไม่กะพริบ', () => {
    const fix = num(40, 'tab-fix'), sys = num(310, 'tab-sys'), total = num(100);
    M.countUp(root([fix, sys, total]), { 'tab-fix': 47, 'tab-sys': 304 });
    expect(fix.classList.has('wms-drop')).toBe(true);
    expect(sys.classList.has('wms-drop')).toBe(false);
    expect(total.classList.has('wms-drop')).toBe(false);
    /* ลดการเคลื่อนไหว ตัวเลขคงค่าจริงไว้ ไม่วิ่ง */
    expect(fix.textContent).toBe('40');
  });

  it('ข้อความบนสายพานแยกดึงกับส่ง', () => {
    expect(M.busyLabel('get')).toMatch(/หยิบข้อมูล/);
    expect(M.busyLabel('post')).toMatch(/ส่งข้อมูล/);
  });
});
