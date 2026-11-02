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

function compare({ s = {}, x = {}, t = {}, last, period = PERIOD }) {
  const led = pack(s);
  const px = pack(x);
  const pt = pack(t);
  /* สคริปต์ส่ง x กับ t ด้วยตารางวันและ SKU ชุดเดียวกัน จึงต้องรวมก่อน */
  const days = [...new Set([...px.days, ...pt.days])].sort();
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
    expect(c.totals).toEqual({ s: 8, x: 8, t: 8 });
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
    expect(c.skus).toEqual([{ sku: A, name: 'ชื่อ ' + A, s: 3, x: 5, t: 5 }]);
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
    expect(c.waiting).toEqual([{ date: '2026-03-31', x: 6, t: 6 }]);
  });

  it('สมุดลงถึงวันเลยช่วงไปแล้ว เทียบถึงวันสุดท้ายของ Report', () => {
    const c = compare({ s: { '2026-03-31': { [A]: 1 } }, x: { '2026-03-31': { [A]: 1 } }, t: { '2026-03-31': { [A]: 1 } }, last: '2026-04-03' });
    expect(c.to).toBe('2026-03-31');
    expect(c.waiting).toEqual([]);
  });

  it('สมุดไม่มีแถวของเดือนนี้เลย ไม่เทียบ และทุกวันอยู่ในรายการรอ', () => {
    const c = compare({ x: { '2026-03-05': { [A]: 1 } }, t: { '2026-03-05': { [A]: 1 } }, last: '2026-02-20' });
    expect(c.days).toEqual([]);
    expect(c.waiting).toEqual([{ date: '2026-03-05', x: 1, t: 1 }]);
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
});
