/**
 * เทียบยอดออกรายวัน: public/wms-cut.js
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-cut.js'), 'utf8');

const A = 'AAA0000000001';
const B = 'BBB0000000002';
const PERIOD = { from: '2026-03-01', to: '2026-03-31' };

let WmsCut;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  WmsCut = win.WmsCut;
});

/** แปลงรูปอ่านง่าย { '2026-03-05': { [A]: 5 } } เป็นแบบย่อที่สคริปต์ส่งมา */
function pack(table) {
  const days = Object.keys(table).sort();
  const skus = [];
  const cells = [];
  days.forEach((d, i) => {
    for (const sku of Object.keys(table[d])) {
      if (!skus.some((s) => s[0] === sku)) skus.push([sku, `ชื่อ ${sku}`]);
      cells.push([i, skus.findIndex((s) => s[0] === sku), table[d][sku]]);
    }
  });
  return { days, skus, cells };
}

/** ไม่ใส่ r คือ cut-api.gs รุ่นก่อนที่ยังไม่ส่งยอดควรออก */
function compare({ s = {}, x = {}, t = {}, r, last, period = PERIOD }) {
  const led = pack(s);
  /* สคริปต์ส่ง x, t, r ด้วยตารางวันและ SKU ชุดเดียวกัน จึงต้องรวมก่อน */
  const days = [...new Set([x, t, r || {}].flatMap((table) => Object.keys(table)))].sort();
  const skus = [];
  const cellsOf = (table) => {
    const out = [];
    for (const d of Object.keys(table)) {
      for (const sku of Object.keys(table[d])) {
        if (!skus.some((a) => a[0] === sku)) skus.push([sku, '']);
        out.push([days.indexOf(d), skus.findIndex((a) => a[0] === sku), table[d][sku]]);
      }
    }
    return out;
  };
  const daily = { days, skus, x: cellsOf(x), t: cellsOf(t) };
  if (r) daily.r = cellsOf(r);
  const lastDay = last ?? led.days[led.days.length - 1] ?? '';
  return WmsCut.compareDaily(daily, period, { ...led, last: lastDay });
}

const same = (table) => compare({ s: table, x: table, t: table });
const dayOf = (c, date) => c.days.find((d) => d.date === date);

describe('wms-cut.js — ตรงกัน', () => {
  it('สามแหล่งเท่ากันทุก SKU ทุกวัน ไม่มีรายการต่าง', () => {
    const c = same({ '2026-03-05': { [A]: 5, [B]: 2 }, '2026-03-06': { [A]: 1 } });
    expect(c.rows).toEqual([]);
    expect(c.skus).toEqual([]);
    expect(c.counts).toMatchObject({ daysOk: 2, daysBad: 0, daysShift: 0, keys: 3, equal: 3, skusBad: 0 });
    expect(c.totals).toEqual({ r: 0, s: 8, x: 8, t: 8 });
    expect(c.hasR).toBe(false);
    expect(c.days.every((d) => d.rep === null)).toBe(true);
  });

  it('วันที่ไม่มีข้อมูลเลยไม่ขึ้นในตาราง ไม่ถูกนับเป็นวันที่ตรง', () => {
    const c = same({ '2026-03-05': { [A]: 5 }, '2026-03-07': { [A]: 1 } });
    expect(c.days.map((d) => d.date)).toEqual(['2026-03-05', '2026-03-07']);
  });

  it('เทียบเฉพาะในช่วงของ Report แถวก่อนหรือหลังช่วงไม่นับ', () => {
    const c = compare({
      s: { '2026-02-28': { [A]: 9 }, '2026-03-05': { [A]: 5 } },
      x: { '2026-03-05': { [A]: 5 }, '2026-04-01': { [A]: 7 } },
      t: { '2026-03-05': { [A]: 5 }, '2026-04-01': { [A]: 7 } },
    });
    expect(c.days.map((d) => d.date)).toEqual(['2026-03-05']);
    expect(c.rows).toEqual([]);
  });
});

describe('wms-cut.js — ไม่ตรง', () => {
  it('สมุดขาดฝั่งเดียว บอกว่าฝั่งไหนขาดเท่าไร', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 3 } },
      x: { '2026-03-05': { [A]: 5 } },
      t: { '2026-03-05': { [A]: 5 } },
    });
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ date: '2026-03-05', sku: A, name: 'ชื่อ ' + A, s: 3, x: 5, t: 5, moved: 0 });
    expect(dayOf(c, '2026-03-05')).toMatchObject({ status: 'bad', bad: 1, shift: 0 });
    expect(c.skus).toEqual([{ sku: A, name: 'ชื่อ ' + A, r: 0, s: 3, x: 5, t: 5 }]);
  });

  it('SKU ที่มีแค่ฝั่งเดียวก็ต้องขึ้น ไม่ใช่หายไปเพราะอีกฝั่งไม่มีแถว', () => {
    const c = compare({ s: { '2026-03-05': { [A]: 1 } }, x: { '2026-03-05': { [B]: 1 } }, t: { '2026-03-05': { [B]: 1 } } });
    expect(c.rows.map((r) => [r.sku, r.s, r.x, r.t]).sort()).toEqual([[A, 1, 0, 0], [B, 0, 1, 1]]);
  });

  it('ยอดรวมของวันเท่ากัน แต่รายตัวสลับกัน ต้องนับเป็นวันที่ไม่ตรง', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 2, [B]: 1 } },
      x: { '2026-03-05': { [A]: 1, [B]: 2 } },
      t: { '2026-03-05': { [A]: 1, [B]: 2 } },
    });
    const d = dayOf(c, '2026-03-05');
    expect([d.s, d.x, d.t]).toEqual([3, 3, 3]);
    expect(d).toMatchObject({ status: 'bad', bad: 2 });
  });

  it('เรื่องใหญ่ขึ้นก่อนในวันเดียวกัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 1, [B]: 1 } },
      x: { '2026-03-05': { [A]: 2, [B]: 9 } },
      t: { '2026-03-05': { [A]: 2, [B]: 9 } },
    });
    expect(c.rows.map((r) => r.sku)).toEqual([B, A]);
  });

  it('TRcloud ติดลบจากการกลับรายการ เทียบได้ตามปกติ', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 0 } },
      x: { '2026-03-05': { [A]: 0 } },
      t: { '2026-03-05': { [A]: -1 } },
    });
    expect(c.rows[0]).toMatchObject({ s: 0, x: 0, t: -1 });
  });
});

describe('wms-cut.js — ลงคนละวัน', () => {
  it('ฝั่งหนึ่งลงช้าไปหนึ่งวัน ขึ้นเป็นน่าจะลงคนละวัน และรวมทั้งช่วงแล้วไม่ต่าง', () => {
    const c = compare({
      s: { '2026-03-12': { [A]: 40 }, '2026-03-13': { [A]: 300 } },
      x: { '2026-03-13': { [A]: 340 } },
      t: { '2026-03-12': { [A]: 40 }, '2026-03-13': { [A]: 300 } },
    });
    expect(c.rows.map((r) => [r.date, r.moved])).toEqual([['2026-03-12', 40], ['2026-03-13', 40]]);
    expect(dayOf(c, '2026-03-12')).toMatchObject({ status: 'shift', bad: 0, shift: 1, moved: 40 });
    expect(c.skus).toEqual([]);
    expect(c.counts).toMatchObject({ daysShift: 2, daysBad: 0, shiftKeys: 2 });
  });

  it('สมุดเป็นฝั่งที่ลงคนละวันก็จับได้เหมือนกัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 15 } },
      x: { '2026-03-04': { [A]: 10 }, '2026-03-05': { [A]: 5 } },
      t: { '2026-03-04': { [A]: 10 }, '2026-03-05': { [A]: 5 } },
    });
    expect(c.rows.every((r) => r.moved === 10)).toBe(true);
    expect(c.counts.daysBad).toBe(0);
  });

  it('ห่างกันเกินหนึ่งวันไม่นับเป็นลงคนละวัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 5 } },
      x: { '2026-03-07': { [A]: 5 } },
      t: { '2026-03-07': { [A]: 5 } },
      last: '2026-03-31',
    });
    expect(c.rows.every((r) => r.moved === 0)).toBe(true);
    expect(c.counts.daysBad).toBe(2);
  });

  it('ข้ามเดือนยังเป็นวันติดกัน', () => {
    const c = compare({
      s: { '2026-03-31': { [A]: 2 }, '2026-04-01': { [A]: 0 } },
      x: { '2026-04-01': { [A]: 2 } },
      t: { '2026-03-31': { [A]: 2 } },
      last: '2026-04-01',
      period: { from: '2026-03-31', to: '2026-04-01' },
    });
    expect(c.rows.map((r) => r.moved)).toEqual([2, 2]);
  });

  it('ยอดสวนทางกันแต่ไม่เท่ากัน ส่วนที่เหลือยังนับเป็นต่างจริง', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 10 }, '2026-03-06': { [A]: 0 } },
      x: { '2026-03-05': { [A]: 7 }, '2026-03-06': { [A]: 5 } },
      t: { '2026-03-05': { [A]: 7 }, '2026-03-06': { [A]: 5 } },
    });
    /* วันแรกหักหมด 3 ชิ้น วันที่สองเหลือต่างจริงอีก 2 */
    expect(dayOf(c, '2026-03-05').status).toBe('shift');
    expect(dayOf(c, '2026-03-06').status).toBe('bad');
    expect(c.skus[0]).toMatchObject({ s: 10, x: 12, t: 12 });
  });

  it('ต่างไปทางเดียวกันสองวันติดกันไม่ใช่ลงคนละวัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 1 }, '2026-03-06': { [A]: 1 } },
      x: { '2026-03-05': { [A]: 3 }, '2026-03-06': { [A]: 3 } },
      t: { '2026-03-05': { [A]: 3 }, '2026-03-06': { [A]: 3 } },
    });
    expect(c.counts).toMatchObject({ daysBad: 2, daysShift: 0 });
  });

  it('แถวที่ฝั่งหนึ่งลงคนละวันแต่อีกฝั่งต่างเรื่องอื่น ต้องไม่ถูกซ่อนเป็นลงคนละวัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 5 }, '2026-03-06': { [A]: 5 } },
      x: { '2026-03-06': { [A]: 10 } },
      t: { '2026-03-05': { [A]: 8 }, '2026-03-06': { [A]: 5 } },
    });
    expect(dayOf(c, '2026-03-05').status).toBe('bad');
  });
});

describe('wms-cut.js — สมุดยังลงไม่ถึง', () => {
  it('หลังวันสุดท้ายของสมุดไม่นับว่าขาด แต่บอกว่ายังเหลือยอดเท่าไร', () => {
    const c = compare({
      s: { '2026-03-30': { [A]: 1 } },
      x: { '2026-03-30': { [A]: 1 }, '2026-03-31': { [A]: 4, [B]: 2 } },
      t: { '2026-03-30': { [A]: 1 }, '2026-03-31': { [A]: 6 } },
    });
    expect(c.to).toBe('2026-03-30');
    expect(c.rows).toEqual([]);
    expect(c.waiting).toEqual([{ date: '2026-03-31', r: 0, x: 6, t: 6 }]);
  });

  it('สมุดลงถึงวันเลยช่วงไปแล้ว เทียบถึงวันสุดท้ายของ Report', () => {
    const c = compare({ s: { '2026-03-31': { [A]: 1 } }, x: { '2026-03-31': { [A]: 1 } }, t: { '2026-03-31': { [A]: 1 } }, last: '2026-04-03' });
    expect(c.to).toBe('2026-03-31');
    expect(c.waiting).toEqual([]);
  });

  it('สมุดไม่มีแถวของเดือนนี้เลย ไม่เทียบ และทุกวันอยู่ในรายการรอ', () => {
    const c = compare({ x: { '2026-03-05': { [A]: 1 } }, t: { '2026-03-05': { [A]: 1 } }, last: '2026-02-20' });
    expect(c.days).toEqual([]);
    expect(c.waiting).toEqual([{ date: '2026-03-05', r: 0, x: 1, t: 1 }]);
  });

  it('วันที่รอ บอกยอดควรออกตาม Report ด้วย', () => {
    const c = compare({
      s: { '2026-03-30': { [A]: 1 } },
      x: { '2026-03-30': { [A]: 1 }, '2026-03-31': { [A]: 4 } },
      t: { '2026-03-30': { [A]: 1 }, '2026-03-31': { [A]: 4 } },
      r: { '2026-03-30': { [A]: 1 }, '2026-03-31': { [A]: 5 } },
    });
    expect(c.waiting).toEqual([{ date: '2026-03-31', r: 5, x: 4, t: 4 }]);
  });
});

describe('wms-cut.js — เทียบกับ Report ควรออก', () => {
  it('ทุกระบบเท่ากับ Report ขึ้นว่าตรง', () => {
    const table = { '2026-03-05': { [A]: 5, [B]: 2 } };
    const c = compare({ s: table, x: table, t: table, r: table });
    expect(c.hasR).toBe(true);
    expect(dayOf(c, '2026-03-05')).toMatchObject({ r: 7, status: 'ok', rep: { status: 'ok', bad: 0, shift: 0 } });
    expect(c.rows).toEqual([]);
    expect(c.counts).toMatchObject({ repOk: 1, repBad: 0, repShift: 0 });
    expect(c.totals).toEqual({ r: 7, s: 7, x: 7, t: 7 });
  });

  it('สามระบบตรงกันเองแต่เกิน Report วันนั้นยังตรงกันเอง แต่ไม่ตรงกับ Report', () => {
    const sys = { '2026-03-05': { [A]: 5, [B]: 3 } };
    const c = compare({ s: sys, x: sys, t: sys, r: { '2026-03-05': { [A]: 5, [B]: 1 } } });
    const d = dayOf(c, '2026-03-05');
    expect(d.status).toBe('ok');
    expect(d.rep).toMatchObject({ status: 'bad', bad: 1, shift: 0, split: 0, s: 2, x: 2, t: 2 });
    expect(c.rows[0].rl).toBeNull();
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ sku: B, r: 1, s: 3, x: 3, t: 3, moved: 0, rmoved: 0 });
    expect(c.counts).toMatchObject({ daysOk: 1, daysBad: 0, repBad: 1, skusBad: 0 });
    /* รายการรวมทั้งช่วงขึ้นด้วย แต่ไม่นับเป็น SKU ที่สามระบบไม่ตรงกัน */
    expect(c.skus).toEqual([{ sku: B, name: 'ชื่อ ' + B, r: 1, s: 3, x: 3, t: 3 }]);
  });

  it('ระบบเดียวที่ขาด บอกว่าระบบนั้นขาดจาก Report', () => {
    const ok = { '2026-03-05': { [A]: 10 } };
    const c = compare({ s: ok, x: { '2026-03-05': { [A]: 6 } }, t: ok, r: ok });
    const p = dayOf(c, '2026-03-05').rep;
    expect(p).toMatchObject({ status: 'bad', bad: 1, s: 0, x: -4, t: 0 });
    expect(WmsCut.reportWords(0, p.s, p.x, p.t)).toBe('Uploadยิงออก ขาด 4');
  });

  it('Report มีแต่ไม่มีระบบไหนตัดเลย วันนั้นต้องขึ้น ไม่ใช่หายไป', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 1 } }, x: { '2026-03-05': { [A]: 1 } }, t: { '2026-03-05': { [A]: 1 } },
      r: { '2026-03-05': { [A]: 1 }, '2026-03-06': { [B]: 4 } },
      last: '2026-03-31',
    });
    expect(dayOf(c, '2026-03-06')).toMatchObject({ r: 4, s: 0, x: 0, t: 0, status: 'ok', rep: { status: 'bad', s: -4, x: -4, t: -4 } });
    /* ช่องที่มีแต่ Report ไม่นับเป็นรายการที่สามระบบเทียบกัน */
    expect(c.counts).toMatchObject({ keys: 1, equal: 1 });
  });

  it('ทุกระบบตัดวันถัดจากวันออกใน Report ขึ้นว่าน่าจะลงคนละวัน', () => {
    const sys = { '2026-03-13': { [A]: 300, [B]: 40 } };
    const c = compare({ s: sys, x: sys, t: sys, r: { '2026-03-12': { [A]: 300 }, '2026-03-13': { [B]: 40 } } });
    expect(dayOf(c, '2026-03-12').rep).toMatchObject({ status: 'shift', shift: 1, moved: 300 });
    expect(dayOf(c, '2026-03-13').rep).toMatchObject({ status: 'shift', shift: 1, moved: 300 });
    expect(c.rows.map((r) => [r.date, r.sku, r.rmoved])).toEqual([['2026-03-12', A, 300], ['2026-03-13', A, 300]]);
    expect(c.skus).toEqual([]);
  });

  it('หักที่ลงคนละวันแล้วยังเหลือ ส่วนที่เหลือนับเป็นต่างจริง', () => {
    const c = compare({
      s: { '2026-03-13': { [A]: 300 } }, x: { '2026-03-13': { [A]: 290 } }, t: { '2026-03-13': { [A]: 300 } },
      r: { '2026-03-12': { [A]: 300 } },
    });
    /* ที่ขาดอยู่ตกที่วันของ Report วันถัดไปหักกันหมดแล้ว */
    expect(dayOf(c, '2026-03-12').rep).toMatchObject({ status: 'bad', bad: 1, shift: 0, split: 1, s: 0, x: -10, t: 0 });
    expect(dayOf(c, '2026-03-13').rep.status).toBe('shift');
    /* ยอดดิบขาด 300 แต่ที่ขาดจริงคือ 10 */
    expect(c.rows.find((r) => r.date === '2026-03-12').rl).toEqual({ s: 0, x: -10, t: 0 });
    expect(c.rows.find((r) => r.date === '2026-03-13')).toMatchObject({ rmoved: 300, rl: null });
  });

  it('งานต่างจริงขึ้นก่อนงานที่ลงคนละวันในวันเดียวกัน', () => {
    const c = compare({
      s: { '2026-03-05': { [A]: 1 }, '2026-03-06': { [A]: 50, [B]: 2 } },
      x: { '2026-03-05': { [A]: 1 }, '2026-03-06': { [A]: 50, [B]: 2 } },
      t: { '2026-03-05': { [A]: 1 }, '2026-03-06': { [A]: 50, [B]: 2 } },
      r: { '2026-03-05': { [A]: 51 }, '2026-03-06': { [B]: 1 } },
    });
    expect(c.rows.filter((r) => r.date === '2026-03-06').map((r) => r.sku)).toEqual([B, A]);
  });
});

describe('wms-cut.js — คำอธิบาย', () => {
  it('บอกช่องที่ต่างจากอีกสองช่อง', () => {
    expect(WmsCut.diffWords(3, 5, 5)).toBe('UAT ขาด 2');
    expect(WmsCut.diffWords(120, 100, 100)).toBe('UAT เกิน 20');
    expect(WmsCut.diffWords(5, 3, 5)).toBe('Uploadยิงออก ขาด 2');
    expect(WmsCut.diffWords(5, 5, 1234)).toBe('TRcloud เกิน 1,229');
  });

  it('เท่ากันหมดไม่มีคำอธิบาย ไม่เท่ากันเลยบอกต่างจาก UAT เท่าไร', () => {
    expect(WmsCut.diffWords(5, 5, 5)).toBe('');
    expect(WmsCut.diffWords(500, 490, 530)).toBe('Uploadยิงออก ขาด 10 · TRcloud เกิน 30 จากยอด UAT');
    expect(WmsCut.oddOne(5, 5, 5)).toBe('');
    expect(WmsCut.oddOne(1, 2, 3)).toBe('all');
    expect(WmsCut.oddOne(1, 2, 2)).toBe('s');
    expect(WmsCut.oddOne(2, 1, 2)).toBe('x');
    expect(WmsCut.oddOne(2, 2, 1)).toBe('t');
  });

  it('เทียบกับ Report: สามระบบต่างเท่ากันพูดครั้งเดียว ไม่งั้นบอกทีละระบบ', () => {
    expect(WmsCut.reportWords(5, 5, 5, 5)).toBe('');
    expect(WmsCut.reportWords(3481, 3493, 3493, 3493)).toBe('ทั้งสามระบบ เกิน 12');
    expect(WmsCut.reportWords(3038, 3038, 2667, 3038)).toBe('Uploadยิงออก ขาด 371');
    expect(WmsCut.reportWords(10, 7, 10, 12)).toBe('UAT ขาด 3 · TRcloud เกิน 2');
    expect(WmsCut.LABEL.r).toBe('Report ควรออก');
  });
});

describe('wms-cut.js — แตกช่องที่ไม่ตรงลงถึงออเดอร์และแถวในชีต', () => {
  /* รูปเดียวกับที่ cut-api.gs กับ tx-api.gs ส่งมา */
  const daily = {
    days: ['2026-03-05', '2026-03-06'],
    skus: [[A, 'ชื่อ A'], [B, 'ชื่อ B']],
    detail: [
      [0, 0, 2, 3, 0,
        [['5003', 'JST', 3, 3, 1, 'over', '', [], []]],
        [['', ['2026-03-06'], ['2026-03-06'], 4, 0, 0, 5, ['6001', '6002', '6003']]]],
    ],
  };
  const ledger = {
    days: ['2026-03-05'], skus: [[A, 'ชื่อ A']],
    locs: ['A-01-01', 'B-02-02'], whos: ['คนเอ'],
    lines: [[0, 0, 12, 0, 3, 'PO-1', 2, 0], [0, 0, 15, 1, 0, '', 'สอง', 0]],
    sheet: { url: 'https://docs.example/d/1/edit#gid=0', gid: 77 },
  };

  it('อ่านรายออเดอร์ กลุ่มที่ลงคนละวัน และแถวในชีตของช่องเดียวกัน', () => {
    const idx = WmsCut.cellIndex(daily, ledger);
    const one = idx.get('2026-03-05', A);
    expect(idx.hasOrders).toBe(true);
    expect(idx.hasRows).toBe(true);
    expect(one.listed).toBe(true);
    expect(one.ok).toEqual({ orders: 2, qty: 3 });
    expect(one.orders).toEqual([{ ref: '5003', sys: 'JST', x: 3, t: 3, r: 1, kind: 'over', od: [], xo: [], to: [] }]);
    expect(one.moved).toEqual([{ od: [], xo: ['2026-03-06'], to: ['2026-03-06'], orders: 4, x: 0, t: 0, r: 5, refs: ['6001', '6002', '6003'] }]);
    expect(one.rows).toEqual([
      { row: 12, loc: 'A-01-01', lot: 3, po: 'PO-1', qty: 2, who: 'คนเอ' },
      { row: 15, loc: 'B-02-02', lot: 0, po: '', qty: 'สอง', who: 'คนเอ' },
    ]);
  });

  it('วันใน Report อ่านได้ทั้งรายการวันจากสคริปต์รุ่นนี้ และวันเดียวจากรุ่นก่อน', () => {
    const one = (od) => WmsCut.cellIndex({
      days: ['2026-03-05'], skus: [[A, 'ชื่อ A']],
      detail: [[0, 0, 0, 0, 0, [['5003', 'CRM', 4, 4, 0, 'ok', od, [], []]], [[od, [], [], 1, 2, 2, 0, ['5004']]]]],
    }, {}).get('2026-03-05', A);
    expect(one(['2026-03-03', '2026-03-07']).orders[0].od).toEqual(['2026-03-03', '2026-03-07']);
    expect(one(['2026-03-03', '2026-03-07']).moved[0].od).toEqual(['2026-03-03', '2026-03-07']);
    expect(one('2026-03-07').orders[0].od).toEqual(['2026-03-07']);
    expect(one('').moved[0].od).toEqual([]);
  });

  it('ช่องที่สคริปต์ไม่ได้ส่งมาคือ Upload, TRcloud และ Report ตรงกันวันนั้น', () => {
    const one = WmsCut.cellIndex(daily, ledger).get('2026-03-06', B);
    expect(one.listed).toBe(false);
    expect(one.orders).toEqual([]);
    expect(one.rows).toEqual([]);
  });

  it('สคริปต์รุ่นเก่าที่ไม่ส่งรายละเอียด บอกได้ว่าฝั่งไหนยังไม่มี', () => {
    const idx = WmsCut.cellIndex({ days: [], skus: [] }, { days: [], skus: [] });
    expect(idx.hasOrders).toBe(false);
    expect(idx.hasRows).toBe(false);
    expect(idx.get('2026-03-05', A).listed).toBe(false);
  });

  it('บอกวันที่ที่ลงต่างไป', () => {
    expect(WmsCut.dateWords({ od: [], xo: ['2026-03-06'], to: ['2026-03-06'] })).toBe('ตัดวันที่ 6/3 ทั้งสองระบบ');
    expect(WmsCut.dateWords({ od: ['2026-03-04'], xo: [], to: [] })).toBe('Report ลงวันที่ 4/3');
    expect(WmsCut.dateWords({ od: ['2026-03-03', '2026-03-07'], xo: [], to: [] })).toBe('Report ลงวันที่ 3/3, 7/3');
    expect(WmsCut.dateWords({ od: [], xo: ['2026-03-06'], to: ['2026-03-05', '2026-03-07'] }))
      .toBe('Uploadยิงออก ตัดวันที่ 6/3 · TRcloud ตัดวันที่ 5/3, 7/3');
    expect(WmsCut.dateWords({ od: [], xo: [], to: [] })).toBe('');
  });

  it('ชี้ว่าต้องดูฝั่งไหนก่อน', () => {
    expect(WmsCut.fixHint({ r: 5, s: 3, x: 5, t: 5 }, true)).toBe('UAT ต่างจาก Uploadยิงออก และ TRcloud ให้ดูแถวในชีตทีม');
    expect(WmsCut.fixHint({ r: 4, s: 3, x: 5, t: 5 }, true)).toContain('ไม่ตรง Report ให้ดูรายออเดอร์ด้วย');
    expect(WmsCut.fixHint({ r: 5, s: 5, x: 2, t: 5 }, true)).toBe('Uploadยิงออก ต่างจากอีกสองแหล่ง ให้ดูรายออเดอร์');
    expect(WmsCut.fixHint({ r: 5, s: 1, x: 2, t: 3 }, true)).toBe('ทั้งสามแหล่งไม่เท่ากัน ให้ดูทั้งรายออเดอร์และแถวในชีตทีม');
    expect(WmsCut.fixHint({ r: 4, s: 5, x: 5, t: 5 }, true)).toContain('ทั้งสามแหล่งตรงกัน แต่ไม่ตรง Report');
  });

  it('ลิงก์เปิดชีตตรงแถว ไม่มี URL ของชีตก็ไม่ทำลิงก์', () => {
    expect(WmsCut.rowUrl(ledger.sheet, 12)).toBe('https://docs.example/d/1/edit#gid=77&range=A12');
    expect(WmsCut.rowUrl(null, 12)).toBe('');
  });
});

describe('wms-cut.js — รายการแก้แยกตามระบบที่ต้องไปแก้', () => {
  const D1 = '2026-03-05', D2 = '2026-03-06';
  /* แถวแบบที่ cut-api.gs ส่งมา goal คือยอดที่ถูก xd, td คือวันที่ตัดของแต่ละระบบ */
  const row = (o) => ({ k: 'over', ref: '5001', sku: A, sys: 'JST', date: D1, r: 2, x: 2, t: 2, goal: 2, xd: [D1], td: [D1], ...o });
  /* ผลของ compareDaily: มีแต่ช่องที่ไม่ตรง ช่องที่ไม่อยู่ในนี้คือสามแหล่งเท่ากัน */
  const daily = (rows) => ({ from: PERIOD.from, to: D2, rows: rows.map((r) => ({ name: '', r: 0, moved: 0, ...r })) });

  it('ออเดอร์ไปอยู่ในระบบที่ยอดไม่เท่ากับที่ควรตัด บวกคือต้องลงเพิ่ม ลบคือต้องคืน', () => {
    const out = WmsCut.fixLists([
      row({ ref: '5001', x: 4, t: 4 }),
      row({ ref: '5002', k: 'under', x: 0, xd: [] }),
      row({ ref: '5003', k: 'ghost', goal: 0, r: 0, x: 0, t: 3, xd: [], td: [D2] }),
    ], []);
    expect(out.s).toBe(null);
    expect(out.x.map((e) => [e.ref, e.need, e.days])).toEqual([['5001', -2, [D1]], ['5002', 2, []]]);
    /* วันที่ใน Report วันเดียวกัน เรื่องใหญ่ขึ้นก่อน */
    expect(out.t.map((e) => [e.ref, e.need, e.days])).toEqual([['5003', -3, [D2]], ['5001', -2, [D1]]]);
  });

  it('ขาดทั้งวันไปอยู่ในระบบที่ขาด ขาดทั้งสองระบบอยู่ทั้งคู่', () => {
    const gap = (side) => ({ date: D1, sys: 'CRM', side, orders: 6, lines: 9, qty: 12, refs: ['7001', '7002'] });
    const one = WmsCut.fixLists([], [gap('tx')]);
    expect(one.x).toEqual([{ date: D1, ref: '', sku: '', sys: 'CRM', kind: 'gap', need: 12, days: [], lines: 9, orders: 6, refs: ['7001', '7002'], cell: '' }]);
    expect(one.t).toEqual([]);
    const both = WmsCut.fixLists([], [gap('both')]);
    expect([both.x.length, both.t.length]).toEqual([1, 1]);
  });

  it('ชีตทีม: ช่องที่ต่างจากอีกสองระบบที่ตรงกันเอง ให้ลงตามสองระบบนั้น ช่องที่ลงคนละวันไม่นับ', () => {
    const c = daily([
      { date: D1, sku: A, name: 'ชื่อ A', s: 3, x: 5, t: 5 },
      { date: D1, sku: B, s: 9, x: 7, t: 7, moved: 2 },
      { date: D2, sku: B, s: 1, x: 2, t: 3 },
    ]);
    const cells = { get: (d, sku) => ({ orders: sku === A ? [{ ref: '5009' }] : [] }) };
    const out = WmsCut.fixLists([], [], c, cells);
    expect(out.s).toEqual([{ date: D1, ref: '', sku: A, name: 'ชื่อ A', kind: 'sheet', need: 2, days: [], cell: `${D1}|${A}`, mixed: true }]);
    /* สามแหล่งไม่เท่ากันเลย บอกไม่ได้ว่าใครผิด นับไว้บอกเฉยๆ */
    expect(out.unclear).toBe(1);
  });

  it('ชีตทีม: ออเดอร์ที่ระบบหนึ่งผิด แล้วชีตทีมทุกวันที่ตัดเท่ากับระบบนั้น ชีตทีมผิดตามด้วย', () => {
    const rows = [
      row({ ref: '5001', x: 4, t: 4, xd: [D1], td: [D1] }),
      row({ ref: '5002', sku: B, k: 'under', x: 0, t: 2, xd: [], td: [D1] }),
    ];
    /* วันที่ D1 ของ A สามแหล่งเท่ากัน (ไม่อยู่ในรายการ) ส่วน B ชีตทีมเท่ากับ Upload ที่ขาด */
    const out = WmsCut.fixLists(rows, [], daily([{ date: D1, sku: B, s: 5, x: 5, t: 7 }]));
    expect(out.s.map((e) => [e.ref, e.need, e.via, e.cell])).toEqual([['5001', -2, 'x', ''], ['5002', 2, 'x', `${D1}|${B}`]]);
    /* แถวของ Upload ก็เปิดช่องเดียวกันได้ ถ้าช่องนั้นมีในเทียบรายวัน */
    expect(out.x.map((e) => [e.ref, e.cell])).toEqual([['5001', ''], ['5002', `${D1}|${B}`]]);
  });

  it('ชีตทีมไม่เท่ากับระบบที่ผิด หรือวันที่ตัดเลยช่วงที่ชีตทีมลงถึง ไม่นับว่าชีตทีมผิดตาม', () => {
    const rows = [
      row({ ref: '5001', x: 4, t: 4 }),
      row({ ref: '5003', x: 3, t: 3, date: '2026-03-09', xd: ['2026-03-09'], td: ['2026-03-09'] }),
    ];
    const out = WmsCut.fixLists(rows, [], daily([{ date: D1, sku: A, s: 2, x: 4, t: 4 }]));
    /* 5001: ชีตทีมเป็น 2 ไม่เท่ากับที่ Upload ตัดเกินไว้ จึงไปขึ้นเป็นช่องที่ชีตทีมต่างแทน */
    expect(out.s.map((e) => [e.kind, e.ref, e.need])).toEqual([['sheet', '', 2]]);
  });

  it('เรียงตามวันที่ แล้วเรื่องใหญ่ขึ้นก่อน', () => {
    const out = WmsCut.fixLists([
      row({ ref: '5001', date: D2, x: 3 }),
      row({ ref: '5002', x: 9 }),
      row({ ref: '5003', x: 3 }),
    ], []);
    expect(out.x.map((e) => e.ref)).toEqual(['5002', '5003', '5001']);
  });
});
