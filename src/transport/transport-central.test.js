import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for the central-file half of public/transport-docs/transport-file.js —
 * the part that lets a file uploaded by the transport team on one machine reach
 * the warehouse team on another.
 *
 * The path under test is the one warehouse staff hit every morning: open a tool
 * page, have today's file already there. It runs on page load with no one
 * watching it, so a mistake here is not a visible error — it is a page that
 * quietly opens on the wrong day's deliveries, or on nothing at all.
 *
 * Like transport-file.test.js this evaluates the shipped file rather than a
 * copy, with just enough of a browser around it to reach the load handler.
 */
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../public/transport-docs/transport-file.js'),
  'utf8'
);

/* transport-file.js เขียนวันที่ผ่าน ../wms-date.js เพื่อให้ทุกหน้าในระบบเขียน
   เหมือนกัน — โหลดตัวจริงเข้าไปด้วย ไม่ใช่ทำ stub ปลอม ๆ ขึ้นมา ไม่งั้นเทสต์จะ
   ผ่านกับกติกาวันที่ที่ไม่มีอยู่จริง */
const DATE_SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-date.js'), 'utf8');

const ROWS = [['รถ1', '16/08/2026', '', 'SO-1', 'แบรนด์A', '6ฟุต', 1, '', '',
               'คุณเอ', '0812345678', '', 'กรุงเทพ', '09:00']];

function ymd(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 08:15`;
}

/**
 * @param {Array} files what the central store holds, newest first
 * @returns {{fire:Function, store:Map, reloads:{n:number}, calls:Array}}
 */
function boot(files, opts = {}) {
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const handlers = [];
  const document = {
    addEventListener: (kind, fn) => { if (kind === 'DOMContentLoaded') handlers.push(fn); },
    getElementById: () => null,
    querySelector: () => null,          // ไม่มี .mod-head → แถบไม่วาด ทดสอบเฉพาะการตัดสินใจ
    // โมดูลของหน้า: ส่วนกลางทำงานเฉพาะในโมดูลทำใบงานขนส่ง หน้าอื่นที่โหลดไฟล์นี้
    // (เช่น ค้นหาออเดอร์ ซึ่งใช้ข้อมูลรถตอบว่าออเดอร์ไปกับคันไหน) ต้องไม่ถูกแตะ
    body: { getAttribute: (k) => (k === 'data-wms-module'
      ? (opts.module === undefined ? 'transport' : opts.module) : null) },
  };

  const reloads = { n: 0 };
  const location = { reload: () => { reloads.n++; } };

  const calls = [];
  const win = {
    WmsSettings: {
      transportUrl: () => (opts.url === undefined ? 'https://script.example/exec' : opts.url),
      transportToken: () => '',
      me: () => 'กัน',
    },
    WmsGas: {
      withApi: (u, api) => (/[?&]api=/.test(u) ? u : u + '?api=' + api),
      json: async (url) => {
        calls.push(url);
        if (opts.fail) throw new Error('เน็ตล่ม');
        const m = /[?&]id=([^&]+)/.exec(url);
        if (!m) return { files: files.map((f) => ({ id: f.id, at: f.at, fileName: f.fileName, by: f.by, rows: f.rows })) };
        const f = files.find((x) => x.id === decodeURIComponent(m[1]));
        return f ? { file: f } : { error: 'ไม่พบไฟล์' };
      },
    },
  };

  new Function('window', DATE_SRC)(win);
  new Function('window', 'sessionStorage', 'console', 'document', 'location', SRC)(
    win, sessionStorage, { warn: () => {} }, document, location
  );

  return {
    TransportFile: win.TransportFile,
    fire: async () => { for (const h of handlers) await h(); await new Promise((r) => setTimeout(r, 0)); },
    store, reloads, calls,
  };
}

const fileOf = (at, id = '1000') => ({
  id, at, fileName: 'งานรถ.xlsx', by: 'กัน', rows: ROWS.length, data: ROWS,
  header: ['ชื่อรถ', 'Date', 'Sup', 'เลขOrder', 'แบรนด์', 'ขนาด', 'จำนวน', 'ของแถม',
           'จำนวน(แถม)', 'ชื่อลูกค้า', 'Phone 1', 'Phone 2', 'ที่อยู่', 'เวลานัด'],
});

describe('เปิดหน้ามาแล้วดึงไฟล์ให้เอง', () => {
  it('โหลดไฟล์ของวันนี้ให้ แล้วโหลดหน้าใหม่เพื่อให้เครื่องมือใช้ไฟล์นั้น', async () => {
    const t = boot([fileOf(ymd(0))]);
    await t.fire();

    const f = t.TransportFile.get();
    expect(f).not.toBeNull();
    expect(f.fileName).toBe('งานรถ.xlsx');
    expect(f.origin.from).toBe('central');
    expect(f.origin.by).toBe('กัน');
    expect(t.reloads.n).toBe(1);
  });

  it('ไม่โหลดไฟล์ของเมื่อวานให้ แม้จะเป็นไฟล์ล่าสุด', async () => {
    const t = boot([fileOf(ymd(-1))]);
    await t.fire();

    // ทำงานจากไฟล์เก่าโดยไม่รู้ตัวคือความผิดพลาดที่แพงที่สุดของโมดูลนี้
    // ของเก่ายังเลือกเองได้ แต่ต้องมีคนกด ไม่ใช่ระบบหยิบมาให้เงียบ ๆ
    expect(t.TransportFile.get()).toBeNull();
    expect(t.reloads.n).toBe(0);
  });

  it('ไฟล์ในเครื่องมีอยู่แล้ว ไม่ไปทับ', async () => {
    const t = boot([fileOf(ymd(0), '2000')]);
    t.TransportFile.save('ไฟล์ที่เพิ่งอัปเอง.xlsx', ROWS, null);
    await t.fire();

    expect(t.TransportFile.get().fileName).toBe('ไฟล์ที่เพิ่งอัปเอง.xlsx');
    expect(t.calls.length).toBe(0);
    expect(t.reloads.n).toBe(0);
  });

  it('ยังไม่ได้ตั้ง URL = ไม่ยิงอะไรเลย โมดูลทำงานเหมือนเดิม', async () => {
    const t = boot([fileOf(ymd(0))], { url: '' });
    await t.fire();

    expect(t.calls.length).toBe(0);
    expect(t.TransportFile.get()).toBeNull();
  });

  it('ส่วนกลางยังว่าง ไม่พังและไม่ค้าง', async () => {
    const t = boot([]);
    await t.fire();

    expect(t.TransportFile.get()).toBeNull();
    expect(t.reloads.n).toBe(0);
  });

  it('ดึงไม่สำเร็จก็ไม่ขัดจังหวะใคร — หน้ายังอัปไฟล์เองได้', async () => {
    const t = boot([fileOf(ymd(0))], { fail: true });
    await t.fire();

    expect(t.TransportFile.get()).toBeNull();
    expect(t.reloads.n).toBe(0);
  });

  /**
   * กันไม่ให้บั๊กที่เคยเกิดกลับมา
   *
   * ตอนแรกส่วนกลางแปะตัวเองลงทุกหน้าที่โหลดไฟล์นี้ หน้าค้นหาออเดอร์จึงมีปุ่ม
   * "บันทึกให้ทีมคลังใช้" โผล่มาแบบไม่มีสไตล์ และ autoLoad ก็ทำงานที่นั่นด้วย
   * แล้วจบด้วยการโหลดหน้าใหม่กลางคันตอนคนกำลังพิมพ์ค้นหาให้ลูกค้าที่โทรมา
   */
  it('หน้าที่ไม่ใช่โมดูลขนส่ง ต้องไม่ถูกแตะเลย', async () => {
    const t = boot([fileOf(ymd(0))], { module: 'lookup' });
    await t.fire();

    expect(t.calls.length).toBe(0);        // ไม่ยิง Apps Script
    expect(t.reloads.n).toBe(0);           // ไม่โหลดหน้าใหม่ใส่คนที่กำลังใช้งาน
    expect(t.TransportFile.get()).toBeNull();
  });

  it('แต่ยังอ่านเขียนไฟล์ได้ตามปกติในหน้าอื่น', async () => {
    const t = boot([fileOf(ymd(0))], { module: 'lookup' });
    t.TransportFile.save('อัปเอง.xlsx', ROWS, null);
    await t.fire();

    expect(t.TransportFile.get().fileName).toBe('อัปเอง.xlsx');
    expect(t.TransportFile.COLS.time).toBe(13);
  });

  it('ยิงครั้งเดียวต่อรอบเบราว์เซอร์ ไม่ถล่มสคริปต์ทุกหน้าที่เปิด', async () => {
    const t = boot([fileOf(ymd(-1))]);     // ของเมื่อวาน จึงไม่โหลดและไม่ reload
    await t.fire();
    await t.fire();
    await t.fire();

    expect(t.calls.length).toBe(1);
  });
});

describe('ข้อมูลที่วิ่งข้ามเครื่อง', () => {
  it('เบอร์โทรกับวันที่กลับมาเป็นข้อความเดิม ไม่ถูกแปลงชนิด', async () => {
    const t = boot([fileOf(ymd(0))]);
    await t.fire();

    const C = t.TransportFile.COLS;
    const row = t.TransportFile.get().rows[0];
    expect(row[C.phone1]).toBe('0812345678');   // ศูนย์นำหน้าต้องอยู่ครบ
    expect(row[C.date]).toBe('16/08/2026');
    expect(row[C.customer]).toBe('คุณเอ');
    expect(row[C.time]).toBe('09:00');
  });

  it('หัวตารางติดมาด้วย ตัวตรวจคอลัมน์จึงยังทำงานที่ปลายทาง', async () => {
    const t = boot([fileOf(ymd(0))]);
    await t.fire();

    expect(t.TransportFile.checkHeader(t.TransportFile.get().header).ok).toBe(true);
  });
});
