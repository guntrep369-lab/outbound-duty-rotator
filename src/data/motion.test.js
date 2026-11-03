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

/** กล่องข้อความปลอม: ข้อความหนึ่งก้อน กับเครื่องหมายถูกที่ saved() ใส่ไว้ข้างหน้า */
function msg(text) {
  const el = {
    nodes: [{ nodeType: 3, nodeValue: text }],
    get firstChild() { return el.nodes[0]; },
    querySelector: () => (el.nodes[0].check ? { remove: () => el.nodes.shift() } : null),
    insertAdjacentHTML: (where, html) => el.nodes.unshift({ nodeType: 1, check: html }),
    get text() { return el.nodes.filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(''); },
  };
  return el;
}

describe('เครื่องหมายถูกตอนบันทึกสำเร็จ — saved()', () => {
  let M;
  beforeAll(async () => { M = await import('../../public/wms-motion.js'); });

  it('แทนเครื่องหมายที่หน้าเว็บเขียนไว้ ไม่ซ้อนกันสองตัว', () => {
    for (const t of ['✓ บันทึกแล้ว 3 พ.ย.', '✅ บันทึกแล้ว', '☁ บันทึกขึ้นชีตแล้ว', '☁️ บันทึกให้ทีมคลังใช้']) {
      const el = msg(t);
      M.saved(el);
      expect(el.nodes[0].check).toMatch(/class="wms-check"/);
      expect(el.text).not.toMatch(/^[✓✅☁]/u);
    }
  });

  it('ข้อความที่ไม่มีเครื่องหมาย ได้เครื่องหมายเพิ่มข้างหน้า ข้อความเดิมอยู่ครบ', () => {
    const el = msg('ส่งผลนับแล้ว 4 รายการ');
    M.saved(el);
    expect(el.nodes).toHaveLength(2);
    expect(el.text).toBe('ส่งผลนับแล้ว 4 รายการ');
  });

  it('เรียกซ้ำกับกล่องเดิม ยังมีเครื่องหมายตัวเดียว', () => {
    const el = msg('✓ บันทึกแล้ว');
    M.saved(el);
    M.saved(el);
    expect(el.nodes.filter((n) => n.check)).toHaveLength(1);
  });
});

describe('สั่นตอนผิด ป้ายเด้งตอนเลขเปลี่ยน — shake() / bump()', () => {
  let M, timers;
  const box = () => {
    const cls = new Set();
    return { offsetWidth: 0, cls, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } };
  };
  beforeAll(async () => {
    M = await import('../../public/wms-motion.js');
    timers = [];
    M.mountMotion({}, '../', {
      matchMedia: () => ({ matches: false }),
      setTimeout: (fn) => timers.push(fn), clearTimeout: () => {},
    });
  });

  it('ใส่คลาสให้เล่นหนึ่งรอบ แล้วเอาออกเองตอนจบ', () => {
    const a = box(), b = box();
    M.shake(a);
    M.bump(b);
    expect(a.cls.has('wms-shake')).toBe(true);
    expect(b.cls.has('wms-bump')).toBe(true);
    timers.forEach((fn) => fn());
    expect(a.cls.size + b.cls.size).toBe(0);
  });

  it('ไม่มีกล่องให้สั่น (หน้าเว็บหาไม่เจอ) ก็ไม่พัง', () => {
    expect(() => { M.shake(null); M.bump(undefined); }).not.toThrow();
  });

  it('ลดการเคลื่อนไหวไว้ ไม่สั่นไม่เด้ง', () => {
    M.mountMotion({}, '../', { matchMedia: () => ({ matches: true }), setTimeout: () => {}, clearTimeout: () => {} });
    const a = box();
    M.shake(a);
    M.bump(a);
    expect(a.cls.size).toBe(0);
  });

  it('เลขบนแท็บอ่านตามชื่อแท็บ เลขที่กำลังวิ่งใช้ค่าจริง', () => {
    const tab = (id, n) => ({ dataset: { tab: id }, querySelector: () => n });
    const tabs = {
      querySelectorAll: () => [
        tab('fix', { dataset: { count: '40' }, textContent: '12' }),
        tab('find', { dataset: {}, textContent: '7' }),
        tab('log', null),
      ],
    };
    expect(M.tabNums(tabs)).toEqual({ fix: '40', find: '7' });
  });
});
