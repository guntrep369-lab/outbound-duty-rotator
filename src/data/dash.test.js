/**
 * ภาพรวมสต๊อก: public/wms-dash.js
 *
 * หน้านี้ต้องได้เลขเดียวกับหน้าที่เป็นเจ้าของเรื่อง เทสต์จึงรันของจริงทั้ง wms-tx.js กับ wms-fifo.js
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let D, F, T;
beforeAll(() => {
  const win = {};
  const store = { getItem: () => null, setItem() {} };
  for (const f of ['wms-tx.js', 'wms-fifo.js', 'wms-dash.js']) new Function('window', 'sessionStorage', 'localStorage', read(f))(win, store, store);
  D = win.WmsDash;
  F = win.WmsFifo;
  T = win.WmsTx;
});

/* ── ยอดคงเหลือแบบย่อที่ tx-summary ส่งมา ── */
const SUMMARY = {
  app: 'transaction', at: 1, saleDays: 10, lastDate: '2026-10-30',
  skus: [['AAA001', 'LONG-AAA001', 'สินค้า ก'], ['BBB001', 'LONG-BBB001', 'สินค้า ข'], ['CCC001', 'LONG-CCC001', 'สินค้า ค']],
  locs: ['P1-01', 'R1-01-01', 'QA', 'P2-01', 'P3-01'],
  keys: [
    [0, 8, '9900000001', 0, 5, 1],    // ก โลเปิด 5 ขายวันละ 5 เหลือ 1 วัน มีสำรอง → ไปดึงมาเติม
    [0, 8, '9900000001', 1, 40, 0],
    [1, 8, '9900000002', 3, 2, 1],    // ข โลเปิด 2 ขายวันละ 3 ไม่มีสำรอง (QA ไม่นับ) → ไม่มีสำรองให้เติม
    [1, 8, '9900000002', 2, 3, 0],
    [1, 8, '9900000002', 1, -4, 0],   // ติดลบ หักใน net
    [2, 8, '9900000003', 4, 50, 1],   // ค ขายวันละ 2 พอขาย 25 วัน
  ],
  sold: [[0, 50], [1, 30], [2, 20]],
  issues: { counts: { negative: 1, mixed: 2, brandnew: 1 }, list: [] },
  backup: { at: Date.parse('2026-10-30T20:00:00Z') },
};

/* ── แถวสมุดแบบย่อที่ tx-fifo ส่งมา ชุดเดียวกับใน fifo.test.js ── */
const TYPE = { รับ: 0, เบิก: 1, ขาย: 2 };
function ledger(list, o = {}) {
  const skus = [], pos = [], locs = [], days = [];
  const no = (arr, v) => { if (!arr.includes(v)) arr.push(v); return arr.indexOf(v); };
  const rows = list.map((x, i) => {
    const sku = x.sku || 'AAA0000000001';
    if (!skus.some((s) => s[1] === sku)) skus.push([sku.slice(0, 6), sku, `ชื่อ ${sku}`]);
    const t = TYPE[x.type || 'รับ'];
    const flag = (x.open ? 1 : 0) + (x.gr ? 2 : 0) + (x.count ? 4 : 0) + 8;
    return [10 + i, skus.findIndex((s) => s[1] === sku), x.lot ?? 8, no(pos, String(x.po ?? '9900000001')),
      t && x.from ? no(locs, x.from) : -1, x.to ? no(locs, x.to) : -1, x.qty ?? 1, t, x.d ? no(days, x.d) : -1, flag];
  });
  return { app: 'transaction', today: o.today || '2026-11-05', last: o.last || '2026-10-30', skus, pos, locs, days, rows };
}
const gr = (o) => ({ type: 'รับ', gr: true, to: 'R1-01-01', ...o });
const refill = (o) => ({ type: 'เบิก', from: 'R1-01-01', to: 'P1-01', open: true, ...o });
const sale = (o) => ({ type: 'ขาย', from: 'P1-01', open: true, ...o });

/** สองกอง LOT 3 (เก่า) กับ LOT 9 ในโลขายทั้งคู่ ขาย LOT 9 ตอนที่ LOT 3 ยังอยู่ = ข้าม LOT */
function twoLots(days) {
  return ledger([
    gr({ lot: 3, po: '9900000001', qty: 100, d: '2026-09-01' }),
    gr({ lot: 9, po: '9900000002', qty: 100, d: '2026-09-02' }),
    refill({ lot: 3, po: '9900000001', qty: 50, d: '2026-09-03' }),
    refill({ lot: 9, po: '9900000002', qty: 50, d: '2026-09-03' }),
    ...days.map(([d, lot, qty]) => sale({ lot, po: lot === 3 ? '9900000001' : '9900000002', qty, d })),
  ]);
}

describe('stockNow — ตัวเลขเดียวกับหน้าสต๊อกราย Location', () => {
  it('ยอดรวม ต้องเติมภายใน 3 วัน แยกมีสำรอง / ไม่มีสำรอง เหมือนแท็บต้องเติม', () => {
    const n = D.stockNow(SUMMARY, Date.parse('2026-10-31T08:00:00Z'));
    const r = T.refill(T.expand(SUMMARY), 3);
    expect(n.refill).toEqual({ days: 3, ready: r.ready.length, none: r.none.length, saleDays: 10 });
    expect(n.refill).toMatchObject({ ready: 1, none: 1 });
    expect(n).toMatchObject({ net: 96, open: 57, reserve: 40, special: 3 });
    expect(n.backup).toEqual({ ok: true, days: 0 });
  });

  it('ข้อมูลผิดรวมทุกเรื่องเหมือนป้ายเลขบนแท็บ เรื่องที่หน้านี้ยังไม่รู้จักก็ยังนับ', () => {
    const n = D.stockNow(SUMMARY, 0);
    expect(n.issues.total).toBe(4);
    expect(n.issues.kinds.map((k) => [k.label, k.n])).toEqual([['Status ปนกัน', 2], ['ยอดติดลบ', 1], ['brandnew', 1]]);
  });
});

describe('month — สรุปเดือนจากผลของหน้า FIFO สต๊อก', () => {
  const res = twoLots([['2026-10-02', 9, 4], ['2026-10-02', 3, 6], ['2026-10-05', 3, 10]]);

  it('ยอดหยิบขายและร้อยละตาม FIFO ตรงกับ WmsFifo.analyze', () => {
    const an = F.analyze(res, '2026-10');
    const m = D.month(an, res.last);
    expect(m.sale).toMatchObject({ qty: 20, judged: 20, ok: 16, lot: 4, po: 0, skip: 4, pct: an.totals.sale.pct });
    expect(m.sale.pct).toBe(80);
  });

  it('รายวันมีครบทุกวันจนถึงวันที่สมุดลงขายล่าสุด วันที่ไม่มีขายเป็นศูนย์', () => {
    const m = D.month(F.analyze(res, '2026-10'), '2026-10-06');
    expect(m.days.map((d) => d.d)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
    expect(m.days[1]).toEqual({ d: '2026-10-02', ok: 6, po: 0, lot: 4, unknown: 0, qty: 10 });
    expect(m.days[0].qty).toBe(0);
    expect(m.saleDays).toBe(2);
    expect(m.perDay).toBe(10);
    /* เดือนที่จบแล้ววาดถึงสิ้นเดือน */
    expect(D.month(F.analyze(res, '2026-10'), '2026-11-04').days).toHaveLength(31);
  });

  it('อายุสต๊อกเป็นสี่ช่วงเดียวกับสีบนหน้า FIFO ของ LOT ไม่รู้แยกไว้ ไม่นับในร้อยละ', () => {
    const r = ledger([
      gr({ lot: 9, qty: 30, d: '2026-09-02' }),          // อายุ 1 เดือน
      gr({ lot: 3, po: '9900000002', qty: 10, d: '2026-09-02' }),   // อายุ 7 เดือน
      gr({ lot: 0, po: '9900000003', qty: 5, d: '2026-09-02' }),    // ไม่รู้ LOT
    ]);
    const a = D.month(F.analyze(r, '2026-10'), r.last).ages;
    expect(a.parts.map((p) => [p.cls, p.qty])).toEqual([['a1', 30], ['a2', 0], ['a3', 0], ['a4', 10], ['u', 5]]);
    expect(a).toMatchObject({ total: 45, known: 40, old: 10, oldPct: 25 });
  });
});

describe('comparable / change — เทียบกับเดือนก่อน', () => {
  const m = (saleDays, perDay) => ({ saleDays, perDay });

  it('สมุดเริ่มปลายเดือนหรือเดือนเพิ่งเริ่ม ไม่เทียบ ไม่ขึ้นเลขอย่าง +900%', () => {
    expect(D.comparable(m(30, 3800), m(3, 3500))).toBe(false);
    expect(D.comparable(m(5, 3800), m(30, 3500))).toBe(false);
    expect(D.comparable(m(7, 3800), m(7, 3500))).toBe(true);
    expect(D.comparable(m(30, 3800), null)).toBe(false);
  });

  it('ชิ้นเทียบเป็นร้อยละ ร้อยละเทียบเป็นจุด', () => {
    expect(D.change(3853, 3500)).toEqual({ d: 10.1, unit: '%' });
    expect(D.change(90.5, 92.3, 'pt')).toEqual({ d: -1.8, unit: 'pt' });
    expect(D.change(5, 0)).toBeNull();
    expect(D.change(null, 3)).toBeNull();
  });
});

describe('countMonth / countNow — ผลนับจาก tx-count&peek=1', () => {
  const peek = {
    app: 'transaction', peek: true, today: '2026-11-05',
    todays: { total: 20, done: 12 }, last: { sample: 40, match: 39 },
    months: { '2026-10': { counted: 300, off: 9, sample: 200, match: 197 }, '2026-11': { counted: 2, off: 2, sample: 0, match: 0 } },
  };

  it('ความแม่นยำปัดแบบเดียวกับแท็บนับสต๊อก นับเฉพาะรายการสุ่ม', () => {
    expect(D.countMonth(peek, '2026-10')).toEqual({ counted: 300, off: 9, sample: 200, match: 197, pct: 99 });
    expect(D.countMonth(peek, '2026-11').pct).toBeNull();
    expect(D.countMonth(peek, '2026-09')).toBeNull();
    expect(D.countMonth(null, '2026-10')).toBeNull();
  });

  it('วันนี้ นับแล้วกี่รายการ กับความแม่นยำ 30 วัน', () => {
    expect(D.countNow(peek)).toEqual({ total: 20, done: 12, sample: 40, match: 39, pct: 98 });
    expect(D.countNow(null)).toBeNull();
  });
});

describe('cut — ผลตรวจตัดสต๊อก', () => {
  const kind = (lines, total, qty = lines) => ({ lines, orders: lines, dx: 0, dt: 0, qty, shown: total, total });
  const raw = {
    app: 'cut', period: { from: '2026-10-01', to: '2026-10-31' },
    kinds: { over: kind(8, 8, 41), wrong: kind(3, 3), ghost: kind(13, 13), cancel: kind(0, 0), blankCut: kind(5, 5), transferDiff: kind(0, 0), under: kind(60, 19, 108) },
    gaps: [{ date: '2026-10-04' }],
    info: { matched: { lines: 9911, qty: 12000 } },
  };

  it('นับเท่าป้ายเลขบนแท็บตัดผิด / ตัดเกิน กับยังไม่ตัด ร้อยละตรงปัดลง ไม่ขึ้น 100% ทั้งที่มีผิด', () => {
    const c = D.cut(raw, null);
    expect(c).toMatchObject({ ym: '2026-10', fix: 29, under: 20, todo: 49, okLines: 9911, okPct: 99.1, marks: null });
    expect(c.kinds.map((k) => k.label)).toEqual(['ตัดเกิน', 'ตัดผิด SKU', 'ตัดแต่ไม่มีใน Report', 'สถานะขนส่งว่างแต่ตัดแล้ว', 'ยังไม่ตัดหรือตัดไม่ครบ', 'ขาดทั้งวัน']);
    const almost = D.cut({ ...raw, kinds: { ...raw.kinds, over: kind(1, 1), wrong: kind(0, 0), ghost: kind(0, 0), blankCut: kind(0, 0), under: kind(0, 0) }, gaps: [], info: { matched: { lines: 99999 } } });
    expect(almost.okPct).toBe(99.9);
  });

  it('ช่วงที่คร่อมสองเดือนไม่ผูกกับเดือนไหน', () => {
    expect(D.cut({ ...raw, period: { from: '2026-10-25', to: '2026-11-03' } }).ym).toBe('');
  });

  it('บันทึกการแก้นับตามที่กดล่าสุดของแต่ละรายการ', () => {
    const log = { log: [
      { key: 'a', act: 'แก้แล้ว' }, { key: 'b', act: 'แก้แล้ว' }, { key: 'b', act: 'ยกเลิก' },
      { key: 'c', act: 'แก้แล้ว' }, { key: 'c', act: 'ตรวจแล้วหาย' },
    ] };
    expect(D.cut(raw, log).marks).toEqual({ fixed: 1, gone: 1 });
  });
});

describe('briefText — ข้อความสรุปส่งหัวหน้า', () => {
  it('มีครบทุกเรื่องที่มีข้อมูล เดือนที่เทียบไม่ได้ไม่ใส่ร้อยละเปลี่ยน', () => {
    const res = twoLots([['2026-10-02', 9, 4], ['2026-10-02', 3, 6]]);
    const m = D.month(F.analyze(res, '2026-10'), res.last);
    const text = D.briefText({
      ym: '2026-10', m, prev: null,
      count: { counted: 300, off: 9, sample: 200, match: 197, pct: 99 },
      cut: { okPct: 99.9, todo: 49, marks: { fixed: 12, gone: 0 } },
      now: { net: 173000, skus: 500 }, asOf: '5/11 10:32',
    });
    expect(text.split('\n')).toEqual([
      'สรุปสต๊อก ตุลาคม 2569',
      '• หยิบขาย 10 ชิ้น ใน 1 วัน เฉลี่ยวันละ 10',
      '• หยิบขายตาม FIFO 60%',
      '• สต๊อกอายุ 7 เดือนขึ้นไป 94 ชิ้น (49.4% ของที่รู้ LOT)',   // LOT 3 รับ 100 ขายไป 6 จากทั้งหมด 190
      '• นับสต๊อก 300 รายการ · สุ่มนับตรง 99% (197/200)',
      '• ตัดสต๊อกตรงกับ Report 99.9% · ต้องแก้ 49 รายการ (กดแก้แล้ว 12)',
      '• คงเหลือตอนนี้ 173,000 ชิ้น 500 SKU',
      'ข้อมูลเมื่อ 5/11 10:32',
    ]);
  });

  it('เทียบได้ใส่ร้อยละเปลี่ยนของยอดเฉลี่ยต่อวัน', () => {
    const fake = (saleDays, perDay) => ({
      saleDays, perDay, sale: { qty: saleDays * perDay, pct: null }, refill: { pct: null }, ages: { known: 0 },
    });
    const text = D.briefText({ ym: '2026-10', m: fake(30, 4400), prev: fake(30, 4000) });
    expect(text).toContain('เฉลี่ยวันละ 4,400 (+10% จาก ก.ย. 69)');
  });
});

describe('monthName / months', () => {
  it('ชื่อเดือนเต็มกับแบบสั้น ปี พ.ศ.', () => {
    expect(D.monthName('2026-10')).toBe('ตุลาคม 2569');
    expect(D.monthShort('2027-01')).toBe('ม.ค. 70');
    expect(D.prevMonth('2027-01')).toBe('2026-12');
  });

  it('WmsFifo.months ใหม่ไปเก่า ไม่ก่อนวันแรกในสมุด ไม่เกินสิบสองเดือน', () => {
    expect(F.months({ today: '2026-11-05', last: '2026-11-04', days: ['2026-09-28', '2026-11-04', 'bad'] })).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(F.months({ today: '2027-03-01', last: '2027-02-27', days: ['2026-11-01'] })).toEqual(['2027-02', '2027-01', '2026-12', '2026-11']);
    expect(F.months({ today: '2027-12-01', last: '2027-11-27', days: ['2020-01-01'] })).toHaveLength(12);
  });
});
