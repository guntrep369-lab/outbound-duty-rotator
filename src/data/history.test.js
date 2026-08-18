/**
 * public/wms-history.js — ความจำข้ามวัน
 *
 * เดิมระบบไม่เก็บอะไรข้ามวันเลย ตัวเลขที่คำนวณทุกเช้า (ออเดอร์ ชิ้น งานแทรก
 * จำนวนคัน) หายไปพร้อมการปิดแท็บ จึงตอบไม่ได้ว่าวันนี้หนักกว่าปกติไหม
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-history.js'), 'utf8');

let H;
beforeEach(() => {
  const store = new Map();
  const win = {};
  new Function('window', 'localStorage', SRC)(win, {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  H = win.WmsHistory;
});

describe('บันทึกวันทำงาน', () => {
  it('เก็บแล้วอ่านกลับได้', () => {
    H.record('2026-08-19', { orders: 180, pieces: 340 });
    expect(H.read()['2026-08-19']).toMatchObject({ orders: 180, pieces: 340 });
  });

  /* แต่ละหน้าบันทึกคนละตัวเลขของวันเดียวกัน ถ้าทับทิ้งจะเหลือของหน้าสุดท้าย */
  it('บันทึกซ้ำวันเดิมคือรวมกัน ไม่ใช่ทับทิ้ง', () => {
    H.record('2026-08-19', { orders: 180 });
    H.record('2026-08-19', { added: 12 });
    expect(H.read()['2026-08-19']).toMatchObject({ orders: 180, added: 12 });
  });

  it('ดึงข้อมูลซ้ำวันเดิมคืออัปเดตค่าเดิม ไม่ใช่เพิ่มวันใหม่', () => {
    H.record('2026-08-19', { orders: 100 });
    H.record('2026-08-19', { orders: 180 });
    expect(H.days()).toEqual(['2026-08-19']);
    expect(H.read()['2026-08-19'].orders).toBe(180);
  });

  it('รับเฉพาะตัวเลขจริง — ค่าที่อ่านไม่ได้ต้องไม่กลายเป็นสถิติ', () => {
    H.record('2026-08-19', { orders: 180, bad: NaN, worse: 'สิบ', gone: null, inf: Infinity });
    const d = H.read()['2026-08-19'];
    expect(d.orders).toBe(180);
    for (const k of ['bad', 'worse', 'gone', 'inf']) expect(k in d).toBe(false);
  });

  it('วันที่ผิดรูปแบบไม่บันทึก — ประวัติที่คีย์มั่วเรียงลำดับไม่ได้', () => {
    for (const d of ['19/08/2026', 'Mon, Aug 19', '', null, '2026-8-9']) {
      expect(H.record(d, { orders: 1 }), String(d)).toBe(false);
    }
    expect(H.days()).toEqual([]);
  });

  it('ตัดวันเก่าทิ้งเมื่อเกินเพดาน เก็บวันใหม่ไว้', () => {
    for (let i = 0; i < H.MAX_DAYS + 10; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      H.record(d, { orders: i });
    }
    const days = H.days();
    expect(days).toHaveLength(H.MAX_DAYS);
    expect(days[days.length - 1]).toBe('2026-04-10');   // วันล่าสุดยังอยู่
    expect(days[0]).not.toBe('2026-01-01');             // วันแรกถูกตัด
  });
});

describe('ค่าปกติ', () => {
  const fill = (vals) => vals.forEach((v, i) =>
    H.record('2026-08-' + String(i + 1).padStart(2, '0'), { orders: v }));

  it('ข้อมูลน้อยเกินไปยังไม่บอกค่าปกติ — พูดไปก็เป็นการเดา', () => {
    fill([100, 110, 120, 130]);            // 4 วัน < MIN_BASE
    expect(H.baseline('orders')).toBeNull();
    fill([100, 110, 120, 130, 140]);
    expect(H.baseline('orders')).not.toBeNull();
  });

  it('ใช้ค่ากลาง ไม่ใช่ค่าเฉลี่ย — วันงาน Event วันเดียวไม่ควรลากค่าปกติขึ้น', () => {
    fill([100, 100, 100, 100, 2000]);
    expect(H.baseline('orders').median).toBe(100);
  });

  it('ไม่นับวันที่กำลังถามถึง — ไม่งั้นวันนี้เจือจางความต่างของตัวเอง', () => {
    fill([100, 100, 100, 100, 100, 1000]);   // 2026-08-06 = 1000
    expect(H.baseline('orders', '2026-08-06').median).toBe(100);
    expect(H.compare('orders', '2026-08-06')).toMatchObject({ pct: 900, median: 100 });
  });

  it('ฟิลด์ที่ไม่เคยบันทึกไม่มีค่าปกติ', () => {
    fill([100, 100, 100, 100, 100]);
    expect(H.baseline('ไม่มีฟิลด์นี้')).toBeNull();
    expect(H.compare('ไม่มีฟิลด์นี้', '2026-08-01')).toBeNull();
  });
});

describe('เทียบกับปกติ', () => {
  const fill = (vals) => vals.forEach((v, i) =>
    H.record('2026-08-' + String(i + 1).padStart(2, '0'), { orders: v }));

  /* เคสที่อยากให้จับได้จริง: หัวคอลัมน์ในชีตเลื่อน ระบบอ่านได้แค่เศษเดียว
     ตัวเลขจะร่วงฮวบเทียบกับวันก่อน ๆ ซึ่งเป็นสัญญาณก่อนที่คนจะทันสังเกต */
  it('ข้อมูลหายไปเกือบหมดต้องเห็นเป็นตัวเลขติดลบชัด ๆ', () => {
    fill([180, 175, 190, 185, 178, 40]);
    expect(H.compare('orders', '2026-08-06').pct).toBeLessThan(-70);
  });

  it('วันปกติต้องไม่ตื่นตูม', () => {
    fill([180, 175, 190, 185, 178, 182]);
    expect(Math.abs(H.compare('orders', '2026-08-06').pct)).toBeLessThan(10);
  });

  it('ยังไม่มีประวัติพอ = ไม่เทียบ ไม่ใช่เทียบกับศูนย์', () => {
    H.record('2026-08-19', { orders: 180 });
    expect(H.compare('orders', '2026-08-19')).toBeNull();
  });
});

describe('ทนของเสีย', () => {
  it('อ่านค่าที่พังใน storage แล้วต้องไม่ล้ม', () => {
    const store = new Map([['wms:history', '{ไม่ใช่ json']]);
    const win = {};
    new Function('window', 'localStorage', SRC)(win, {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
    expect(win.WmsHistory.read()).toEqual({});
    expect(win.WmsHistory.days()).toEqual([]);
  });

  it('ล้างแล้วหายจริง', () => {
    H.record('2026-08-19', { orders: 180 });
    H.clear();
    expect(H.days()).toEqual([]);
  });
});
