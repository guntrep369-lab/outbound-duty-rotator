/**
 * โหมดทดลองนับสต๊อกใหญ่ (public/wms-demo.js): หน้าเว็บคนนอกลองเล่นได้โดยไม่มีข้อมูลจริง
 *
 * สิ่งที่พังแล้วเสียหายจริง: เปิดลิงก์ทดลองในเครื่องที่ใช้งานจริง แล้วค่าตั้ง / ผลนับที่ค้างส่งถูกเขียนทับ
 * และแก้ stocktake-api.gs แล้วรอบตัวอย่างสร้างไม่ได้ (คนนอกเปิดมาเจอหน้าเปล่า) จึงรันสคริปต์ตัวจริงที่นี่ด้วย
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const DEMO = fs.readFileSync(path.join(ROOT, 'public/wms-demo.js'), 'utf8');
const ST_JS = fs.readFileSync(path.join(ROOT, 'public/wms-stocktake.js'), 'utf8');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script/stocktake-api.gs'), 'utf8');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** เปิดหน้าจำลอง: url = ที่อยู่หน้า, real = ค่าที่มีอยู่ในเครื่องก่อนเปิด */
function open(url, real) {
  const local = memStorage(real);
  const session = memStorage();
  const loc = new URL(url);
  const win = { localStorage: local, location: loc };
  win.top = win;
  const doc = {
    currentScript: { src: new URL('/wms-demo.js', loc).href },
    documentElement: { classList: { add() {} } },
    head: { appendChild() {} },
    createElement: () => ({ style: {} }),
    addEventListener() {},
  };
  const fetchGs = async () => ({ ok: true, text: async () => GS });
  new Function('window', 'document', 'location', 'sessionStorage', 'fetch', ST_JS + '\n' + DEMO)(win, doc, loc, session, fetchGs);
  return { win, local, session };
}

describe('wms-demo.js — โหมดทดลอง', () => {
  it('ลิงก์ปกติไม่เข้าโหมดทดลอง ไม่แตะที่เก็บข้อมูลเลย', () => {
    const { win, local } = open('https://x.test/stocktake/', { 'wms:st:url': 'https://script.example/real' });
    expect(win.WmsDemo).toBeUndefined();
    expect(win.localStorage).toBe(local);
    expect([...local.m.keys()]).toEqual(['wms:st:url']);
  });

  it('โหมดทดลองเก็บทุกอย่างใต้ wms:demo: ค่าจริงและผลนับที่ค้างส่งในเครื่องไม่ถูกแตะ', () => {
    const real = { 'wms:st:url': 'https://script.example/real', 'wms:st:cfg': '{"round":"ST1"}', 'wms:st:out:ST1': '[{"uid":"a"}]' };
    const { win, local, session } = open('https://x.test/stocktake/?demo=1', real);
    expect(win.WmsDemo.on).toBe(true);
    expect(session.getItem('wms:demo')).toBe('1');
    /* หน้าเว็บเห็นค่าของโหมดทดลอง */
    expect(win.localStorage.getItem('wms:st:url')).toBe('demo:st');
    win.localStorage.setItem('wms:st:cfg', '{"round":"DEMO"}');
    expect(win.localStorage.getItem('wms:st:cfg')).toBe('{"round":"DEMO"}');
    /* ที่เก็บจริง: ของเดิมครบ ของทดลองอยู่ใต้ wms:demo: */
    Object.entries(real).forEach(([k, v]) => expect(local.getItem(k)).toBe(v));
    expect(local.getItem('wms:demo:wms:st:cfg')).toBe('{"round":"DEMO"}');
    win.localStorage.clear();
    Object.entries(real).forEach(([k, v]) => expect(local.getItem(k)).toBe(v));
  });

  it('ลิงก์คนนับที่ชี้ demo:st เข้าโหมดทดลองเอง', () => {
    const { win } = open('https://x.test/stocktake/count.html#u=demo%3Ast&k=demo-count&r=ST1');
    expect(win.WmsDemo && win.WmsDemo.on).toBe(true);
  });

  it('สร้างรอบตัวอย่างด้วย stocktake-api.gs ตัวจริง: นับรอบ 1 มีผลนับ ทีม 4 ว่างไว้ให้ลอง', async () => {
    const { win } = open('https://x.test/stocktake/demo.html?demo=1');
    const d = await win.WmsDemo.ready();
    expect(d.round).toMatch(/^ST\d{6}-1$/);
    expect(d.link).toContain('#u=demo%3Ast&k=demo-count&r=' + d.round);
    const head = await win.WmsDemo.json('demo:st?api=st-head&t=demo-head&round=' + d.round);
    expect(head.error).toBeUndefined();
    expect(head.round.status).toBe('นับรอบ 1');
    expect(head.piles.length).toBeGreaterThan(50);
    const log = await win.WmsDemo.json('demo:st?api=st-log&t=demo-head&round=' + d.round + '&since=0');
    const rows = log.rows || [];
    const teams = new Set(rows.map((r) => r[3]));
    expect(rows.length).toBeGreaterThan(30);
    expect([...teams].sort()).toEqual(['AUD1', 'INV1', 'INV2', 'INV3']);
    /* คนนับส่งผลจากหน้ามือถือได้ แล้วหน้าหัวหน้าเห็น */
    const sent = await win.WmsDemo.post('demo:st', {
      op: 'st-count', k: 'demo-count', round: d.round, device: 'd1', who: 'วีระ', pass: 1, team: 'INV4', since: 0,
      items: [{ uid: 'u1', pass: 1, team: 'INV4', who: 'วีระ', loc: 'A-01-01', type: 'ว่าง', qty: 0, at: '10:00' }],
    });
    expect(sent.saved).toBe(1);
    /* หน้าที่สองในเบราว์เซอร์เดียวกัน (จอหัวหน้า) อ่านชีตชุดเดียวกัน */
    const again = await win.WmsDemo.ready();
    expect(again.round).toBe(d.round);
  });

  it('wms-gas.js รุ่นเก่าในแคช (ไม่รู้จัก demo:) ก็ยังตอบจากตัวทดลอง ไม่ออกเน็ต', async () => {
    const { win } = open('https://x.test/stocktake/?demo=1');
    const net = [];
    win.WmsGas = {
      json: (url) => { net.push(url); return Promise.reject(new Error('Failed to fetch')); },
      post: (url) => { net.push(url); return Promise.reject(new Error('Failed to fetch')); },
    };
    const f = await win.WmsGas.json('demo:tx', 'tx-fifo');
    expect(f.app).toBe('transaction');
    const r = await win.WmsGas.json('demo:st?api=st-rounds&t=demo-head');
    expect(r.rounds.length).toBe(1);
    await win.WmsGas.json('https://script.example/real', 'x').catch(() => {});
    expect(net).toEqual(['https://script.example/real']);
  });

  it('สมุดสมมติไม่มีรายการหลังตัดยอด และตอบรูปแบบ tx-fifo', async () => {
    const { win } = open('https://x.test/stocktake/?demo=1');
    const f = await win.WmsDemo.json('demo:tx', 'tx-fifo&shared=1');
    expect(f.app).toBe('transaction');
    expect(f.rows.length).toBeGreaterThan(50);
    expect(f.shared).toBeTruthy();
    expect(f.last < f.today).toBe(true);
  });
});
