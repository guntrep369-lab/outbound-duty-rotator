/**
 * เช็ครายการตัดสต๊อก: apps-script/cut-api.gs
 *
 * รันสคริปต์จริงกับชีตปลอม เพราะคนจะไปแก้ยอดสต๊อกตามตัวเลขนี้ ถ้าจัดประเภทผิดคือแก้ผิดของจริง
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/cut-api.gs'), 'utf8');

const HEADS = {
  tx: ['Date', 'Sup', 'เลขออเดอร์ก่อนที่จะแยกบิล', 'เลขภายใน', 'เลขคำสั่งซื้อออนไลน์', 'SKU', 'แบรนด์', 'ขนาด', 'SUM of', ''],
  tr: ['วันที่', 'SYS ID', 'DT', 'รหัสสินค้า', 'อธิบายรายการ', 'หน่วย', 'Serial / Lot', 'กลุ่มสินค้า', 'หมวดสินค้า', 'Location', 'พนักงาน', 'แผนก', 'โครงการ', 'คลังสินค้า', 'Engine', 'รับเข้า (ปริมาณ)', 'เบิกออก (ปริมาณ)'],
  jst: ['หมายเลขคำสั่งซื้อออนไลน์', 'หมายเลขออเดอร์ภายใน', 'สถานะ', 'บริษัทขนส่ง', 'หมายเลขพัสดุ', 'สถานะขนส่ง', 'คลัง', 'วันที่ออกจากคลังสินค้า', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนสินค้า', 'รหัสแบบสินค้า', 'รูปแบบสินค้า'],
  crm: ['วันที่', 'ขนส่ง', 'Order ID', 'SKU', 'แบรนด์', 'ขนาด', 'จำนวน'],
  /* ลำดับเดียวกับรายงานจริง มีคอลัมน์จำนวนอื่นอยู่ก่อนช่องที่ต้องใช้ */
  tf: ['หมายเลขใบโอนย้ายสินค้า', 'เลขใบส่งออก', 'สถานะออกจากคลัง', 'โอนเข้าคลัง', 'จำนวนโอนย้ายทั้งหมด', 'จำนวนออกคลัง', 'วันที่จัดส่ง', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนการโอนย้ายสินค้า'],
};
/* ไม่มีแถวในแท็บโอนย้าย คือเหมือนไฟล์ที่ยังไม่มีแท็บนี้ */
const NAMES = { tx: 'ตัดสต๊อกระบบ Transaction', tr: 'ตัดสต๊อกระบบ TRcloud', jst: 'Report order ระบบJST', crm: 'Report order ระบบ CRM', tf: 'Report order ระบบโอนย้าย' };

const A = 'AAA0000000001';
const B = 'BBB0000000002';
const C = 'CCC0000000003';
const DAY = '2026-03-05';

const when = (s) => new Date(`${s}T12:00:00Z`);
const jst = (ref, sku, qty, o = {}) => [
  o.online ?? `ON${ref}`, ref, 'จัดส่งแล้ว', o.sup ?? 'ขนส่งเอ', o.track ?? `TRK${ref}`, o.ship ?? 'จัดส่งแล้ว', 'คลังเอ',
  o.date ?? when(DAY), sku, o.name ?? `สินค้า ${sku}`, qty, sku, '',
];
const crm = (ref, sku, qty, o = {}) => [o.date ?? when(DAY), o.sup ?? 'ขนส่งบี', ref, sku, o.name ?? 'แบรนด์', o.size ?? '', qty];
const tx = (ref, sku, qty, o = {}) => [o.date ?? DAY, o.sup ?? 'ขนส่งเอ', '', ref, '', sku, o.name ?? 'แบรนด์', o.size ?? '', qty, o.src ?? 'JST'];
const tf = (slip, sku, qty, o = {}) => [
  slip, `EX${slip}`, 'จัดส่งแล้ว', o.store ?? 'Store_สมมติ', 99, qty, o.date ?? when(DAY), sku, o.name ?? `สินค้า ${sku}`, qty,
];
const tr = (ref, sku, out, o = {}) => [
  o.date ?? when(DAY), 1, when(DAY), sku, ref, 'Unit', o.lot ?? 'ขนส่งเอ', '', '', '', '', o.dept ?? 'OB', '', 'WH', 'import', o.inq ?? 0, out,
];

function sheet(rows) {
  /* มีแต่เมธอดอ่าน ถ้าโค้ดเผลอเขียนลงชีต เทสต์จะล้มทันที */
  return {
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] ? rows[0].length : 0),
    getRange: (r, c, nr, nc) => {
      if (r + nr - 1 > rows.length || c + nc - 1 > rows[0].length) throw new Error(`อ่านเกินขอบชีต ${r},${c},${nr},${nc}`);
      return { getValues: () => rows.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)) };
    },
  };
}

function api(book) {
  const ss = {
    getSheetByName: (n) => (book[n] ? sheet(book[n]) : null),
    getSpreadsheetTimeZone: () => 'Asia/Bangkok',
  };
  const env = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    ContentService: { createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  };
  return new Function(...Object.keys(env), `${GS}\nreturn { doGet: doGet };`)(...Object.values(env));
}

const bookOf = (d) => Object.fromEntries(Object.keys(NAMES).map((k) => [NAMES[k], [HEADS[k], ...(d[k] || [])]]));

function raw(d) { return api(bookOf(d)).doGet({ parameter: { api: 'cut-check' } }).text; }

/** ทุกเทสต์ต้องกระทบยอดลงตัว ถ้าไม่ลงตัวแปลว่ามีแถวตกหล่นหรือถูกนับสองถัง */
function run(d) {
  const r = JSON.parse(raw(d));
  if (r.error) throw new Error(r.error);
  expect(r.recon.okTx, 'ยอด Transaction ไม่ลงตัว').toBe(true);
  expect(r.recon.okTr, 'ยอด TRcloud ไม่ลงตัว').toBe(true);
  return r;
}

const rowsOf = (r, kind) => r.rows.filter((x) => x.k === kind);

/* แถวของออเดอร์ที่ตรงกันทุกฝั่ง ใส่เป็นฉากหลังให้แท็บไม่ว่าง */
const fine = (ref, sku = A, qty = 1) => ({ jst: [jst(ref, sku, qty)], tx: [tx(ref, sku, qty)], tr: [tr(ref, sku, qty)] });
const join = (...parts) => {
  const out = { jst: [], crm: [], tx: [], tr: [], tf: [] };
  for (const p of parts) for (const k of Object.keys(p)) out[k].push(...p[k]);
  return out;
};

/** ยอดรายวันแบบอ่านง่าย { 'วัน|SKU': จำนวน } */
function dailyOf(r, side) {
  const out = {};
  for (const [d, s, q] of r.daily[side]) out[`${r.daily.days[d]}|${r.daily.skus[s][0]}`] = q;
  return out;
}

describe('cut-api.gs — ยอดรายวันไว้เทียบกับแถวขาย', () => {
  const OTHER = '2026-03-06';

  it('รวมราย SKU ราย วัน แยกสองแหล่ง', () => {
    const r = run({
      jst: [jst('5001', A, 3), jst('5002', B, 1), jst('5003', A, 2, { date: when(OTHER) })],
      tx: [tx('5001', A, 3), tx('5002', B, 1), tx('5003', A, 2, { date: OTHER })],
      tr: [tr('5001', A, 3), tr('5002', B, 1), tr('5003', A, 2, { date: when(OTHER) })],
    });
    const want = { [`${DAY}|${A}`]: 3, [`${DAY}|${B}`]: 1, [`${OTHER}|${A}`]: 2 };
    expect(dailyOf(r, 'x')).toEqual(want);
    expect(dailyOf(r, 't')).toEqual(want);
  });

  it('รวมงานโอนย้ายด้วย เพราะแถวขายในสมุดรวมอยู่แล้ว', () => {
    const r = run(join(fine('5001', A, 1), { tx: [tx('TF-1', A, 7, { src: 'โอนย้าย' })], tr: [tr('TF-1', A, 7)] }));
    expect(dailyOf(r, 'x')).toEqual({ [`${DAY}|${A}`]: 8 });
    expect(dailyOf(r, 't')).toEqual({ [`${DAY}|${A}`]: 8 });
  });

  it('รวมแถวนอกช่วงของ Report ด้วย หน้าเว็บเป็นคนเลือกช่วงเอง', () => {
    const r = run(join(fine('5001', A, 1), { tx: [tx('6001', A, 4, { date: '2026-04-01' })], tr: [tr('6001', A, 4, { date: when('2026-04-01') })] }));
    expect(dailyOf(r, 'x')[`2026-04-01|${A}`]).toBe(4);
    expect(dailyOf(r, 't')[`2026-04-01|${A}`]).toBe(4);
  });

  it('TRcloud คิดเบิกออกลบรับเข้า และไม่รวมแผนกปรับยอดคลัง', () => {
    const r = run(join(fine('5001', A, 5), {
      tr: [tr('5001', A, 0, { inq: 2 }), tr('ADJ-1', A, 100, { dept: 'IV' })],
    }));
    expect(dailyOf(r, 't')).toEqual({ [`${DAY}|${A}`]: 3 });
  });

  it('เบิกออกกับรับเข้าหักกันจนเป็นศูนย์ ไม่ต้องส่งช่องนั้น', () => {
    const r = run(join(fine('5001', A, 1), { tr: [tr('5001', A, 0, { inq: 1 })] }));
    expect(dailyOf(r, 't')).toEqual({});
  });

  it('ยอดรวมรายวันกับยอดรวมทั้งแท็บต้องเท่ากัน ไม่มีแถวตกหล่น', () => {
    const r = run(join(fine('5001', A, 2), fine('5002', B, 3), {
      tx: [tx('TF-1', A, 7, { src: 'โอนย้าย' }), tx('6001', B, 1, { date: '2026-04-01' })],
      tr: [tr('TF-1', A, 7), tr('5001', A, 0, { inq: 1 })],
    }));
    const sum = (side) => Object.values(dailyOf(r, side)).reduce((a, b) => a + b, 0);
    expect(sum('x')).toBe(r.totals.tx);
    expect(sum('t')).toBe(r.totals.tr);
  });

  it('แถวที่ไม่มีวันที่หรือ SKU นับแยกไว้ ไม่หายเงียบ', () => {
    const r = run(join(fine('5001', A, 1), { tx: [tx('6001', A, 2, { date: '' }), tx('6002', '', 3)] }));
    expect(r.daily.skippedX).toEqual({ rows: 2, qty: 5 });
    expect(dailyOf(r, 'x')).toEqual({ [`${DAY}|${A}`]: 1 });
  });

  it('ชื่อสินค้าติดไปกับรหัส', () => {
    const r = run({ jst: [jst('5001', A, 1, { name: 'โต๊ะสมมติ' })], tx: [tx('5001', A, 1)], tr: [tr('5001', A, 1)] });
    expect(r.daily.skus).toEqual([[A, 'โต๊ะสมมติ']]);
  });

  it('ยอดควรออกตาม Report ลงวันที่ออกจากคลัง ไม่นับที่ไม่ควรออก แต่บวกงานโอนย้าย', () => {
    const r = run({
      jst: [
        jst('5001', A, 3),
        jst('5002', B, 2, { date: when(OTHER) }),
        jst('5003', A, 4, { ship: 'ยกเลิกแล้ว' }),
        jst('5004', A, 5, { ship: 'ยกเลิกแล้ว' }),
        jst('5005', A, 6, { ship: '' }),
        jst('5006', 'STR0001', 1),
      ],
      crm: [crm('7001', C, 1, { date: when(OTHER) })],
      tx: [tx('5001', A, 3), tx('5004', A, 5), tx('TF-1', B, 7, { src: 'โอนย้าย' })],
      tr: [tr('5001', A, 3), tr('5004', A, 5), tr('TF-1', B, 7)],
    });
    /* 5002 กับ 7001 ยังไม่ตัดแต่ยังควรออก ยกเลิก สถานะว่าง และรหัสที่ไม่ใช่ของในคลังไม่ควรออก แม้จะตัดไปแล้ว */
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 3, [`${DAY}|${B}`]: 7, [`${OTHER}|${B}`]: 2, [`${OTHER}|${C}`]: 1 });
  });

  it('รายการใน Report ที่ไม่มีวันที่ นับแยกไว้ ไม่หายเงียบ', () => {
    const r = run(join(fine('5001', A, 1), { jst: [jst('5002', B, 2, { date: '' })] }));
    expect(r.daily.skippedR).toEqual({ rows: 1, qty: 2 });
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 1 });
  });

  it('ออเดอร์เดียวกันส่งสองรอบ ยอดควรออกลงทั้งสองวันตาม Report ไม่รวมไปวันสุดท้าย', () => {
    const r = run({
      crm: [crm('7001', A, 4), crm('7001', B, 1), crm('7001', A, 4, { date: when(OTHER) })],
      tx: [tx('7001', A, 4, { src: 'CRM' }), tx('7001', B, 1, { src: 'CRM' }), tx('7001', A, 4, { date: OTHER, src: 'CRM' })],
      tr: [tr('7001', A, 4), tr('7001', B, 1), tr('7001', A, 4, { date: when(OTHER) })],
    });
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 4, [`${DAY}|${B}`]: 1, [`${OTHER}|${A}`]: 4 });
    expect(r.daily.detail).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it('ส่งสองรอบแต่วันหนึ่งมีแถวไม่มีวันที่ ส่วนนั้นนับเป็นยอดที่ข้าม', () => {
    const r = run(join(fine('5001', A, 1), {
      crm: [crm('7001', B, 2), crm('7001', B, 3, { date: '' })],
      tx: [tx('7001', B, 5, { src: 'CRM' })], tr: [tr('7001', B, 5)],
    }));
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 1, [`${DAY}|${B}`]: 2 });
    expect(r.daily.skippedR).toEqual({ rows: 1, qty: 3 });
  });
});

describe('cut-api.gs — รายออเดอร์ของช่องรายวันที่ไม่ตรง', () => {
  const OTHER = '2026-03-06';
  /** { 'วัน|SKU': [ตรงกี่ออเดอร์, ตรงกี่ชิ้น, ไม่ได้ส่งกี่ออเดอร์, ออเดอร์, กลุ่มลงคนละวัน] } */
  function detailOf(r) {
    const out = {};
    for (const [d, s, ...rest] of r.daily.detail) out[`${r.daily.days[d]}|${r.daily.skus[s][0]}`] = rest;
    return out;
  }

  it('ส่งเฉพาะออเดอร์ที่ยอดวันนั้นไม่เท่ากัน ที่ตรงส่งแค่จำนวน และไม่ส่งช่องที่ตรงทั้งช่อง', () => {
    const r = run(join(fine('5001', A, 2), fine('5002', A, 1), fine('5004', B, 1), {
      jst: [jst('5003', A, 1)], tx: [tx('5003', A, 3)], tr: [tr('5003', A, 3)],
    }));
    expect(detailOf(r)).toEqual({
      [`${DAY}|${A}`]: [2, 3, 0, [['5003', 'JST', 3, 3, 1, 'over', [], [], []]], []],
    });
  });

  it('ออเดอร์ที่ยอดตรงแต่ลงคนละวัน รวมเป็นกลุ่มตามวันที่ ทั้งวันใน Report และวันที่ตัด', () => {
    const r = run({
      jst: [jst('5001', A, 2), jst('5002', A, 1)],
      tx: [tx('5001', A, 2, { date: OTHER }), tx('5002', A, 1, { date: OTHER })],
      tr: [tr('5001', A, 2, { date: when(OTHER) }), tr('5002', A, 1, { date: when(OTHER) })],
    });
    expect(detailOf(r)).toEqual({
      [`${DAY}|${A}`]: [0, 0, 0, [], [[[], [OTHER], [OTHER], 2, 0, 0, 3, ['5001', '5002']]]],
      [`${OTHER}|${A}`]: [0, 0, 0, [], [[[DAY], [], [], 2, 3, 3, 0, ['5001', '5002']]]],
    });
  });

  it('ออเดอร์ส่งสองรอบที่รอบหลังลืมตัดใน Upload ชี้ที่วันรอบหลัง พร้อมบอกวันอื่นใน Report', () => {
    const r = run({
      crm: [crm('7001', A, 4), crm('7001', A, 4, { date: when(OTHER) })],
      tx: [tx('7001', A, 4, { src: 'CRM' })],
      tr: [tr('7001', A, 4), tr('7001', A, 4, { date: when(OTHER) })],
    });
    /* วันแรกตัดครบทุกแหล่ง ไม่ต้องส่ง */
    expect(detailOf(r)).toEqual({
      [`${OTHER}|${A}`]: [0, 0, 0, [['7001', 'CRM', 0, 4, 4, 'under', [DAY], [DAY], [DAY]]], []],
    });
  });

  it('ยอดควรออกของรายการที่ไม่ควรออกเป็นศูนย์ เช่นขนส่งยกเลิกแต่ตัดแล้ว', () => {
    const r = run({ jst: [jst('5001', A, 2, { ship: 'ยกเลิกแล้ว' })], tx: [tx('5001', A, 2)], tr: [tr('5001', A, 2)] });
    expect(detailOf(r)[`${DAY}|${A}`][3]).toEqual([['5001', 'JST', 2, 2, 0, 'cancel', [], [], []]]);
  });

  it('ไม่มีรายงานโอนย้าย ยอดควรออกของงานโอนย้ายคือยอดที่ Upload ตัด', () => {
    /* 5009 ทำให้ Report ครอบสองวัน แถว TRcloud วันถัดไปจึงไม่ใช่แถวนอกช่วง */
    const r = run(join(fine('5001', A, 1), {
      jst: [jst('5009', B, 1, { date: when(OTHER) })], tx: [tx('5009', B, 1, { date: OTHER })], tr: [tr('5009', B, 1, { date: when(OTHER) })],
    }, {
      tx: [tx('TF-1', A, 3, { src: 'โอนย้าย' })], tr: [tr('TF-1', A, 3, { date: when(OTHER) })],
    }));
    expect(detailOf(r)[`${DAY}|${A}`]).toEqual([1, 1, 0, [], [[[], [], [OTHER], 1, 3, 0, 3, ['TF-1']]]]);
  });

  it('ออเดอร์เกินเพดานต่อช่อง ส่งที่หนักสุดแล้วบอกจำนวนที่เหลือ', () => {
    const ghosts = Array.from({ length: 45 }, (_, i) => `G${100 + i}`);
    const r = run(join(fine('5001', A, 1), {
      tx: ghosts.map((g, i) => tx(g, A, i === 44 ? 9 : 1)), tr: ghosts.map((g, i) => tr(g, A, i === 44 ? 9 : 1)),
    }));
    const [ok, , more, orders] = detailOf(r)[`${DAY}|${A}`];
    expect(ok).toBe(1);
    expect(more).toBe(5);
    expect(orders).toHaveLength(40);
    /* ไม่มีใน Report ระบบคือที่มาที่แท็บตัดบอกไว้ */
    expect(orders[0]).toEqual(['G144', 'JST', 9, 9, 0, 'ghost', [], [], []]);
  });
});

describe('cut-api.gs — ยอดที่ตรงกัน', () => {
  it('ทุกฝั่งเท่ากันไม่ขึ้นรายการเลย', () => {
    const r = run(join(fine('5001'), fine('5002', B, 2)));
    expect(r.rows).toEqual([]);
    expect(r.gaps).toEqual([]);
    expect(r.info.matched).toEqual({ lines: 2, qty: 3 });
    expect(r.totals).toMatchObject({ report: 3, tx: 3, tr: 3 });
  });

  it('เลขออเดอร์เป็นตัวเลขฝั่งหนึ่ง ข้อความอีกฝั่ง และตัวพิมพ์ต่างกัน ยังเป็นออเดอร์เดียวกัน', () => {
    const r = run({ jst: [jst(5001, A, 1)], crm: [crm('ab-77', B, 1)], tx: [tx('5001', A.toLowerCase(), 1), tx('AB-77', B, 1, { src: 'CRM' })], tr: [tr(5001.0, A, 1), tr(' ab-77 ', B, 1)] });
    expect(r.rows).toEqual([]);
    expect(r.info.matched.lines).toBe(2);
  });

  it('เลขออเดอร์ที่มีวันที่ต่อท้ายคือออเดอร์เดิม ลงซ้ำแบบนี้ต้องจับได้ ไม่ใช่กลายเป็นออเดอร์ใหม่', () => {
    const r = run({ crm: [crm('AB-1', A, 1)], tx: [tx('AB-1', A, 1, { src: 'CRM' }), tx(`AB-1 · ${DAY}`, A, 1, { src: 'CRM' })], tr: [tr('AB-1', A, 1), tr(`AB-1 · ${DAY}`, A, 1)] });
    expect(rowsOf(r, 'over')).toHaveLength(1);
    expect(rowsOf(r, 'over')[0]).toMatchObject({ ref: 'AB-1', r: 1, x: 2, t: 2 });
    expect(rowsOf(r, 'ghost')).toEqual([]);
  });

  it('Report กับรายการตัดแตกแถวไม่เท่ากัน ถ้ายอดรวมตรงกันคือถูก', () => {
    const r = run({ jst: [jst('5001', A, 5), jst('5001', A, 26)], tx: [tx('5001', A, 31)], tr: [tr('5001', A, 30), tr('5001', A, 1)] });
    expect(r.rows).toEqual([]);
  });

  it('วันที่ในชีตเป็นได้ทั้งวันที่จริงและข้อความ', () => {
    const r = run({ jst: [jst('5001', A, 1, { date: `${DAY} 18:30:00` })], tx: [tx('5001', A, 1, { date: when(DAY) })], tr: [tr('5001', A, 1, { date: DAY })] });
    expect(r.rows).toEqual([]);
    expect(r.period).toEqual({ from: DAY, to: DAY });
  });
});

describe('cut-api.gs — ตัดผิดและตัดเกิน', () => {
  it('ตัดเกินทั้งสองระบบ', () => {
    const r = run({ jst: [jst('5001', A, 2)], tx: [tx('5001', A, 4)], tr: [tr('5001', A, 4)] });
    expect(rowsOf(r, 'over')[0]).toMatchObject({ ref: '5001', sku: A, sys: 'JST', r: 2, x: 4, t: 4, goal: 2, side: 'both' });
    expect(r.kinds.over).toMatchObject({ lines: 1, orders: 1, dx: 2, dt: 2, qty: 2 });
  });

  it('ตัดเกินแค่ฝั่งเดียว บอกให้ถูกฝั่ง', () => {
    const r = run({ jst: [jst('5001', A, 1), jst('5002', A, 1)], tx: [tx('5001', A, 1), tx('5002', A, 2)], tr: [tr('5001', A, 3), tr('5002', A, 1)] });
    const by = Object.fromEntries(rowsOf(r, 'over').map((x) => [x.ref, x.side]));
    expect(by).toEqual({ 5001: 'tr', 5002: 'tx' });
  });

  it('ตัดวันเดียวกันสองรอบ เห็นวันที่ตัดครบ', () => {
    const r = run({ jst: [jst('5001', A, 1)], tx: [tx('5001', A, 1, { date: '2026-03-04' }), tx('5001', A, 1, { date: '2026-03-05' })], tr: [tr('5001', A, 2)] });
    expect(rowsOf(r, 'over')[0].xd).toEqual(['2026-03-04', '2026-03-05']);
  });

  it('ออเดอร์มีใน Report แต่ SKU นี้ไม่อยู่ในออเดอร์', () => {
    const r = run({ crm: [crm('ME-1', A, 5)], tx: [tx('ME-1', A, 5, { src: 'CRM' }), tx('ME-1', B, 2, { src: 'CRM' })], tr: [tr('ME-1', A, 5), tr('ME-1', B, 2)] });
    expect(rowsOf(r, 'wrong')).toHaveLength(1);
    expect(rowsOf(r, 'wrong')[0]).toMatchObject({ sku: B, r: 0, x: 2, t: 2, goal: 0, side: 'both', sys: 'CRM' });
  });

  it('ตัดแต่เลขออเดอร์ไม่มีใน Report', () => {
    const r = run(join(fine('5001'), { tx: [tx('9999', A, 2)], tr: [tr('9999', A, 2)] }));
    expect(rowsOf(r, 'ghost')[0]).toMatchObject({ ref: '9999', sys: 'JST', x: 2, t: 2, side: 'both', date: DAY, sup: 'ขนส่งเอ' });
  });

  it('TRcloud คืนยอดแล้วแต่ Transaction ยังค้าง ชี้ฝั่ง Transaction และแนบเหตุผล', () => {
    const r = run(join(fine('5001'), {
      tx: [tx('9999', A, 1, { src: 'CRM' })],
      tr: [tr('9999', A, 1), tr('9999', A, 0, { inq: 1, lot: 'แจ้งยกเลิก ของไม่ได้ออก' })],
    }));
    expect(rowsOf(r, 'ghost')[0]).toMatchObject({ x: 1, t: 0, inq: 1, side: 'tx', note: 'แจ้งยกเลิก ของไม่ได้ออก' });
  });

  it('มีแต่ TRcloud ฝั่งเดียว ก็ต้องจับได้', () => {
    const r = run(join(fine('5001'), { tr: [tr('9999', A, 1)] }));
    expect(rowsOf(r, 'ghost')[0]).toMatchObject({ x: 0, t: 1, side: 'tr' });
  });

  it('เรียงเรื่องใหญ่ขึ้นก่อน', () => {
    const r = run({ jst: [jst('5001', A, 1), jst('5002', A, 1), jst('5003', A, 1)], tx: [tx('5001', A, 2), tx('5002', A, 9), tx('5003', A, 4)], tr: [tr('5001', A, 2), tr('5002', A, 9), tr('5003', A, 4)] });
    expect(rowsOf(r, 'over').map((x) => x.ref)).toEqual(['5002', '5003', '5001']);
  });
});

describe('cut-api.gs — สถานะขนส่ง', () => {
  it('ขนส่งยกเลิกแต่ตัดแล้ว ยอดเท่า Report ก็ยังผิด', () => {
    const r = run({ jst: [jst('5001', A, 1, { ship: 'ยกเลิกแล้ว' })], tx: [tx('5001', A, 1)], tr: [tr('5001', A, 1)] });
    expect(rowsOf(r, 'cancel')[0]).toMatchObject({ ship: 'ยกเลิกแล้ว', goal: 0, side: 'both' });
    expect(r.kinds.cancel.qty).toBe(1);
  });

  it('ขนส่งยกเลิกและไม่ได้ตัด ถูกต้องแล้ว ไม่ขึ้นรายการ', () => {
    const r = run(join(fine('5002'), { jst: [jst('5001', A, 2, { ship: 'ยกเลิกแล้ว' })] }));
    expect(r.rows).toEqual([]);
    expect(r.info.cancelOk).toEqual({ lines: 1, qty: 2 });
  });

  it('สถานะว่างและไม่ได้ตัด ไม่นับว่าผิด เพราะน่าจะยังไม่ออกจริง', () => {
    const r = run(join(fine('5002'), { jst: [jst('5001', A, 2, { ship: '' })] }));
    expect(r.rows).toEqual([]);
    expect(r.info.blankOk).toEqual({ lines: 1, qty: 2 });
  });

  it('สถานะว่างแต่ตัดแล้ว ขึ้นให้เช็ค', () => {
    const r = run({ jst: [jst('5001', A, 1, { ship: '' })], tx: [tx('5001', A, 1)], tr: [tr('5001', A, 1)] });
    expect(rowsOf(r, 'blankCut')[0]).toMatchObject({ ref: '5001', goal: 0 });
  });

  it('CRM ไม่มีช่องสถานะขนส่ง จึงไม่เข้าเงื่อนไขสถานะว่าง', () => {
    const r = run(join(fine('5002'), { crm: [crm('AB-1', B, 1)] }));
    expect(rowsOf(r, 'under')[0]).toMatchObject({ ref: 'AB-1', r: 1, x: 0, t: 0, side: 'both', sys: 'CRM' });
    expect(r.info.blankOk.lines).toBe(0);
  });
});

describe('cut-api.gs — ยังไม่ตัด', () => {
  it('ส่งแล้วแต่ไม่ถูกตัดเลยทั้งสองระบบ', () => {
    const r = run(join(fine('5002'), { jst: [jst('5001', B, 3, { ship: 'แสกนรับสำเร็จ' })] }));
    expect(rowsOf(r, 'under')[0]).toMatchObject({ ref: '5001', sku: B, r: 3, x: 0, t: 0, side: 'both' });
    expect(r.kinds.under).toMatchObject({ lines: 1, dx: -3, dt: -3, qty: 3 });
  });

  it('ขาดฝั่งเดียว ชี้ฝั่งที่ขาด', () => {
    const r = run({ jst: [jst('5001', A, 2), jst('5002', A, 2)], tx: [tx('5001', A, 2), tx('5002', A, 1)], tr: [tr('5001', A, 1), tr('5002', A, 2)] });
    const by = Object.fromEntries(rowsOf(r, 'under').map((x) => [x.ref, x.side]));
    expect(by).toEqual({ 5001: 'tr', 5002: 'tx' });
  });

  it('ทั้งวันไม่ลงฝั่งเดียว รวมเป็นก้อนเดียว ไม่ท่วมตาราง', () => {
    const day2 = when('2026-03-06');
    const orders = ['AB-1', 'AB-2', 'AB-3', 'AB-4', 'AB-5'];
    const r = run(join(fine('5001'), {
      crm: orders.map((o) => crm(o, A, 2, { date: day2, sup: 'ขนส่งบี' })),
      tr: orders.map((o) => tr(o, A, 2, { date: day2 })),
    }));
    expect(rowsOf(r, 'under')).toEqual([]);
    expect(r.gaps).toEqual([{ date: '2026-03-06', sys: 'CRM', side: 'tx', orders: 5, lines: 5, qty: 10, carriers: { ขนส่งบี: 10 }, refs: orders }]);
    expect(r.recon.parts.find((p) => p.id === 'gap')).toMatchObject({ dx: -10, dt: 0 });
  });

  it('ยังไม่ถึงเกณฑ์ขาดทั้งวัน แสดงเป็นรายการปกติ', () => {
    const orders = ['AB-1', 'AB-2', 'AB-3', 'AB-4'];
    const r = run(join(fine('5001'), { crm: orders.map((o) => crm(o, A, 1)), tr: orders.map((o) => tr(o, A, 1)) }));
    expect(r.gaps).toEqual([]);
    expect(rowsOf(r, 'under')).toHaveLength(4);
  });

  it('รายการที่อีกฝั่งก็ไม่ตรงด้วย ต้องไม่ถูกกลืนไปกับก้อนขาดทั้งวัน', () => {
    const orders = ['AB-1', 'AB-2', 'AB-3', 'AB-4', 'AB-5'];
    const r = run(join(fine('5001'), {
      crm: orders.map((o) => crm(o, A, 2)),
      tr: orders.map((o) => tr(o, A, o === 'AB-5' ? 1 : 2)),
    }));
    expect(r.gaps[0]).toMatchObject({ orders: 4, lines: 4 });
    expect(rowsOf(r, 'under').map((x) => x.ref)).toEqual(['AB-5']);
  });

  it('ออเดอร์ที่ขาดทั้งใบหลาย SKU เหลือแถวเดียว', () => {
    const skus = ['AAA0000000011', 'AAA0000000012', 'AAA0000000013', 'AAA0000000014', 'AAA0000000015'];
    const r = run(join(fine('5001'), {
      crm: skus.map((s) => crm('ME-1', s, 2)),
      tr: skus.map((s) => tr('ME-1', s, 2)),
    }));
    expect(rowsOf(r, 'under')).toHaveLength(1);
    expect(rowsOf(r, 'under')[0]).toMatchObject({ ref: 'ME-1', sku: '', lines: 5, r: 10, x: 0, t: 10, goal: 10, side: 'tx' });
    expect(r.kinds.under).toMatchObject({ lines: 5, orders: 1, total: 1, qty: 10 });
  });

  it('ออเดอร์ที่ขาดแค่บาง SKU ยังแสดงทีละ SKU', () => {
    const skus = ['AAA0000000011', 'AAA0000000012', 'AAA0000000013', 'AAA0000000014', 'AAA0000000015', 'AAA0000000016'];
    const r = run(join(fine('5001'), {
      crm: skus.map((s) => crm('ME-1', s, 2)),
      tx: [tx('ME-1', skus[5], 2, { src: 'CRM' })],
      tr: skus.map((s) => tr('ME-1', s, 2)),
    }));
    expect(rowsOf(r, 'under')).toHaveLength(5);
    expect(rowsOf(r, 'under').every((x) => x.sku)).toBe(true);
  });
});

describe('cut-api.gs — สิ่งที่ไม่ใช่ข้อผิดพลาด', () => {
  it('รหัสที่ไม่ใช่ของในคลังและไม่ได้ตัด แยกออกมา ไม่ขึ้นรายการ', () => {
    const r = run(join(fine('5001'), {
      jst: [jst('5002', 'STR0000000001', 1)],
      crm: [crm('AB-1', '', 3), crm('AB-2', 'ข้อความที่ถูกตัดคำ', 1)],
    }));
    expect(r.rows).toEqual([]);
    expect(r.info.nonStock).toEqual({ lines: 1, qty: 1 });
    expect(r.info.badSku).toEqual({ lines: 2, qty: 4 });
  });

  it('รหัส STR ที่ถูกตัดจริง ต้องขึ้นรายการตามปกติ ไม่ถูกซ่อน', () => {
    const r = run({ jst: [jst('5002', 'STR0000000001', 1)], tx: [tx('5002', 'STR0000000001', 3)], tr: [tr('5002', 'STR0000000001', 3)] });
    expect(rowsOf(r, 'over')).toHaveLength(1);
  });

  it('งานโอนย้ายไม่มีใน Report ไม่ใช่ตัดผิด', () => {
    const r = run(join(fine('5001'), { tx: [tx('1200', A, 4, { src: 'โอนย้าย' })], tr: [tr('1200', A, 4)] }));
    expect(r.rows).toEqual([]);
    expect(r.info.transfer).toEqual({ refs: 1, lines: 1, qty: 4 });
    expect(r.totals.txTransfer).toBe(4);
  });

  it('งานโอนย้ายที่สองระบบไม่เท่ากัน ต้องขึ้นรายการ', () => {
    const r = run(join(fine('5001'), { tx: [tx('1200', A, 4, { src: 'โอนย้าย' })], tr: [tr('1200', A, 3)] }));
    expect(rowsOf(r, 'transferDiff')[0]).toMatchObject({ ref: '1200', x: 4, t: 3 });
  });

  it('แถวหลังช่วงของ Report ที่ออเดอร์ไม่อยู่ใน Report ยังเทียบไม่ได้ จึงไม่ใช่ตัดผิด', () => {
    const r = run(join(fine('5001'), { tx: [tx('8001', A, 2, { date: '2026-04-01' }), tx('8002', A, 1, { date: '2026-04-01' })] }));
    expect(r.rows).toEqual([]);
    expect(r.info.outsideTx).toEqual({ rows: 2, qty: 3, from: '2026-04-01', to: '2026-04-01', orders: 2 });
  });

  it('แถวหลังช่วงของออเดอร์ที่อยู่ใน Report ยังนับเป็นการตัดของออเดอร์นั้น', () => {
    const r = run({ jst: [jst('5001', A, 1)], tx: [tx('5001', A, 1), tx('5001', A, 1, { date: '2026-04-01' })], tr: [tr('5001', A, 1)] });
    expect(rowsOf(r, 'over')[0]).toMatchObject({ x: 2, side: 'tx' });
  });

  it('แผนก IV ปรับยอดคลังเอง ไม่เกี่ยวกับออเดอร์', () => {
    const r = run(join(fine('5001'), { tr: [tr('โอนคลัง', A, 0, { dept: 'IV', inq: 8 }), tr('', A, 2, { dept: 'IV' })] }));
    expect(r.rows).toEqual([]);
    expect(r.info.adjust).toEqual({ rows: 2, inq: 8, outq: 2 });
    expect(r.recon.parts.find((p) => p.id === 'adjust')).toMatchObject({ dx: 0, dt: -6 });
  });

  it('ตัดแล้วกลับรายการจนเป็นศูนย์ เรียบร้อยแล้ว ไม่ขึ้นรายการ', () => {
    const r = run(join(fine('5001'), {
      tr: [tr('9999', A, 2), tr('9999', A, 0, { inq: 2 }), tr('5001', B, 1), tr('5001', B, 0, { inq: 1 })],
    }));
    expect(r.rows).toEqual([]);
    expect(r.info.reversedCount).toBe(2);
    expect(r.info.reversedRefs).toEqual(['5001', '9999']);
  });
});

describe('cut-api.gs — กระทบยอด', () => {
  it('ทุกประเภทปนกัน รวมยอดต่างแล้วต้องเท่ายอดจริงพอดี', () => {
    const r = run(join(
      fine('5001'),
      { jst: [jst('5002', A, 1)], tx: [tx('5002', A, 3)], tr: [tr('5002', A, 3)] },
      { crm: [crm('ME-1', A, 5)], tx: [tx('ME-1', A, 5, { src: 'CRM' }), tx('ME-1', B, 2, { src: 'CRM' })], tr: [tr('ME-1', A, 5), tr('ME-1', B, 2)] },
      { tx: [tx('9999', A, 1)], tr: [tr('9998', A, 1)] },
      { jst: [jst('5003', A, 1, { ship: 'ยกเลิกแล้ว' }), jst('5004', A, 1, { ship: '' }), jst('5005', 'STR0000000001', 1), jst('5006', A, 2, { ship: 'แสกนรับสำเร็จ' })] },
      { tx: [tx('1200', A, 4, { src: 'โอนย้าย' }), tx('8001', A, 2, { date: '2026-04-01' })], tr: [tr('1200', A, 4), tr('โอนคลัง', A, 0, { dept: 'IV', inq: 8 })] },
    ));
    expect(r.recon.report + r.recon.dx).toBe(r.totals.tx);
    expect(r.recon.report + r.recon.dt).toBe(r.totals.tr);
    expect(r.totals.tr).toBe(r.totals.trOut - r.totals.trIn);
    expect(r.recon.parts.map((p) => p.id).sort()).toEqual(['adjust', 'blankOk', 'cancelOk', 'ghost', 'nonstock', 'outside', 'over', 'transfer', 'under', 'wrong']);
  });

  it('แยกยอด Transaction ตามที่มา', () => {
    const r = run({ jst: [jst('5001', A, 1)], crm: [crm('AB-1', A, 2)], tx: [tx('5001', A, 1), tx('AB-1', A, 2, { src: 'CRM' }), tx('1200', A, 4, { src: 'โอนย้าย' })], tr: [tr('5001', A, 1)] });
    expect(r.totals).toMatchObject({ txJst: 1, txCrm: 2, txTransfer: 4, jst: 1, crm: 2, report: 3 });
  });

  it('รายการเกินเพดานบอกจำนวนจริง และยังกระทบยอดครบ', () => {
    const many = Array.from({ length: 1005 }, (_, i) => [`G-${i}`, A]);
    const r = run(join(fine('5001'), { tx: many.map(([o, s]) => tx(o, s, 1)), tr: many.map(([o, s]) => tr(o, s, 1)) }));
    expect(r.kinds.ghost).toMatchObject({ lines: 1005, total: 1005, shown: 1000, dx: 1005 });
    expect(rowsOf(r, 'ghost')).toHaveLength(1000);
  });
});

describe('cut-api.gs — คำเตือน', () => {
  const blank = HEADS.tx.map(() => '');

  it('แท็บ Transaction เต็มพอดีก้อนสูตร อาจโดนตัดทิ้ง', () => {
    const fill = Array.from({ length: 19998 }, () => blank);
    const r = run({ jst: [jst('5001', A, 1)], tx: [tx('5001', A, 1), ...fill], tr: [tr('5001', A, 1)] });
    expect(r.tabs.tx.lastRow).toBe(20000);
    expect(r.warnings.join()).toContain('20,000');
    expect(r.tabs.tx.rows).toBe(1);
  });

  it('ยังไม่เต็มไม่ต้องเตือน', () => {
    expect(run(fine('5001')).warnings).toEqual([]);
  });

  it('ข้อมูลตัดสต๊อกสั้นกว่า Report ต้องบอก ไม่งั้นจะดูเหมือนยังไม่ตัดทั้งหมด', () => {
    const r = run({ jst: [jst('5001', A, 1), jst('5002', A, 1, { date: when('2026-03-20') })], tx: [tx('5001', A, 1)], tr: [tr('5001', A, 1)] });
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('Transaction');
    expect(r.warnings[1]).toContain('TRcloud');
  });

  it('Report สองระบบคนละเดือน', () => {
    const r = run({ jst: [jst('5001', A, 1)], crm: [crm('AB-1', A, 1, { date: when('2026-02-10') })], tx: [tx('5001', A, 1), tx('AB-1', A, 1)], tr: [tr('5001', A, 1), tr('AB-1', A, 1)] });
    expect(r.warnings.join()).toContain('คนละเดือน');
  });
});

describe('cut-api.gs — อ่านชีต', () => {
  it('ไม่ใส่ api ตอบว่าเป็นสคริปต์นี้ และไม่แตะชีต', () => {
    const res = api({}).doGet({ parameter: {} });
    expect(JSON.parse(res.text)).toEqual({ app: 'cut' });
  });

  it('หาคอลัมน์จากหัวตาราง คนแทรกคอลัมน์แล้วยังอ่านถูก', () => {
    const d = fine('5001');
    const book = bookOf(d);
    book[NAMES.jst] = book[NAMES.jst].map((row, i) => [i ? 'เพิ่มมา' : 'คอลัมน์ใหม่', ...row]);
    const r = JSON.parse(api(book).doGet({ parameter: { api: 'cut-check' } }).text);
    expect(r.rows).toEqual([]);
    expect(r.info.matched.lines).toBe(1);
  });

  it('ไม่พบแท็บ บอกชื่อแท็บที่หาย', () => {
    const book = bookOf(fine('5001'));
    delete book[NAMES.tr];
    const r = JSON.parse(api(book).doGet({ parameter: { api: 'cut-check' } }).text);
    expect(r.error).toContain(NAMES.tr);
  });

  it('หัวตารางหาย ต้องล้ม ไม่ใช่อ่านผิดคอลัมน์เงียบ ๆ', () => {
    const book = bookOf(fine('5001'));
    book[NAMES.jst][0] = book[NAMES.jst][0].map((h) => (h === 'จำนวนสินค้า' ? 'qty' : h));
    const r = JSON.parse(api(book).doGet({ parameter: { api: 'cut-check' } }).text);
    expect(r.error).toContain(NAMES.jst);
  });

  it('สูตรดึงข้อมูลพังจนหัวตารางเป็น error ก็ต้องบอก', () => {
    const book = bookOf(fine('5001'));
    book[NAMES.tx] = [['#REF!', ...HEADS.tx.slice(1).map(() => '')]];
    const r = JSON.parse(api(book).doGet({ parameter: { api: 'cut-check' } }).text);
    expect(r.error).toContain(NAMES.tx);
  });

  it('Report ว่าง และแท็บตัดสต๊อกว่าง บอกตรง ๆ', () => {
    expect(JSON.parse(raw({ tx: [tx('5001', A, 1)], tr: [tr('5001', A, 1)] })).error).toContain('Report');
    expect(JSON.parse(raw({ jst: [jst('5001', A, 1)], tr: [tr('5001', A, 1)] })).error).toContain('Transaction');
    expect(JSON.parse(raw({ jst: [jst('5001', A, 1)], tx: [tx('5001', A, 1)] })).error).toContain('TRcloud');
  });

  it('ข้ามแถวว่างคั่นระหว่างก้อนสูตร ไม่นับเป็นรายการ', () => {
    const blank = HEADS.tx.map(() => '');
    const r = run({ jst: [jst('5001', A, 1)], tx: [tx('5001', A, 1), blank, blank], tr: [tr('5001', A, 1)] });
    expect(r.tabs.tx.rows).toBe(1);
    expect(r.rows).toEqual([]);
  });

  it('สคริปต์อ่านอย่างเดียว ไม่มีคำสั่งเขียนลงชีตเลย', () => {
    expect(GS).not.toMatch(/\.(setValue|setValues|appendRow|insertSheet|deleteRow|deleteRows|clear|clearContent|setFormula)\b/);
    expect(GS).not.toMatch(/function doPost/);
  });

  it('ไม่ส่งเลขคำสั่งซื้อออนไลน์กับเลขพัสดุออกไป ไม่จำเป็นต่อการเทียบ', () => {
    const text = raw({ jst: [jst('5001', A, 1, { online: 'ONLINE-SECRET', track: 'TRACK-SECRET' })], tx: [tx('5001', A, 2)], tr: [tr('5001', A, 2)] });
    expect(text).toContain('5001');
    expect(text).not.toContain('ONLINE-SECRET');
    expect(text).not.toContain('TRACK-SECRET');
  });
});

describe('cut-api.gs — รายงานโอนย้าย', () => {
  const move = (slip, sku, qty, o = {}) => ({ tx: [tx(slip, sku, qty, { src: 'โอนย้าย', ...o })], tr: [tr(slip, sku, qty)] });

  it('ใบโอนย้ายที่ตัดตรงกับรายงาน นับเป็นตรงเหมือนออเดอร์', () => {
    const r = run(join({ tf: [tf(1201, A, 3)] }, move('1201', A, 3)));
    expect(r.rows).toEqual([]);
    expect(r.info.matched).toEqual({ lines: 1, qty: 3 });
    expect(r.totals).toMatchObject({ report: 3, tf: 3, jst: 0, crm: 0 });
    expect(r.tabs.tf.rows).toBe(1);
  });

  it('ตัดเกินรายงานโอนย้าย ขึ้นเป็นตัดเกิน พร้อมคลังปลายทาง', () => {
    const r = run(join({ tf: [tf(1201, A, 3, { store: 'Store_DT_สมมติ' })] }, move('1201', A, 5)));
    expect(rowsOf(r, 'over')[0]).toMatchObject({ ref: '1201', sys: 'โอนย้าย', sup: 'Store_DT_สมมติ', r: 3, x: 5, t: 5 });
  });

  it('ใบโอนย้ายที่ไม่อยู่ในรายงาน ขึ้นเป็นตัดแต่ไม่มีใน Report', () => {
    const r = run(join({ tf: [tf(1201, A, 1)] }, move('1201', A, 1), move('1202', B, 4)));
    expect(rowsOf(r, 'ghost')[0]).toMatchObject({ ref: '1202', sys: 'โอนย้าย', x: 4, t: 4, goal: 0 });
    expect(r.kinds.transferDiff.total).toBe(0);
  });

  it('รหัส STR ในรายงานเป็นออเดอร์แฝงของงานโอนย้าย ไม่ได้ตัดก็ถูก และไม่นับเป็นยอดควรออก', () => {
    const r = run(join({ tf: [tf(1201, A, 2), tf(1201, 'STR0000000022', 1)] }, move('1201', A, 2)));
    expect(r.rows).toEqual([]);
    expect(r.info.nonStock).toEqual({ lines: 1, qty: 1 });
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 2 });
  });

  it('ยอดควรออกใช้รายงานโอนย้ายตามวันที่จัดส่ง ไม่ใช่วันที่ตัด', () => {
    const r = run(join({ tf: [tf(1201, A, 4, { date: when('2026-03-09') })] }, move('1201', A, 4)));
    expect(dailyOf(r, 'r')).toEqual({ [`2026-03-09|${A}`]: 4 });
    expect(dailyOf(r, 'x')).toEqual({ [`${DAY}|${A}`]: 4 });
  });

  it('วันที่เป็นข้อความแบบมีตัว T คั่นเวลาก็อ่านได้', () => {
    const r = run(join({ tf: [tf(1201, A, 1, { date: '2026-03-05T20:12:39' })] }, move('1201', A, 1)));
    expect(r.tabs.tf).toMatchObject({ from: DAY, to: DAY });
  });

  it('แท็บที่มีแต่หัวตาราง ทำเหมือนยังไม่มีแท็บ งานโอนย้ายเทียบแค่สองระบบ', () => {
    const r = run(join(fine('5001'), move('1200', A, 4)));
    expect(r.rows).toEqual([]);
    expect(r.info.transfer).toMatchObject({ refs: 1, qty: 4 });
    expect(dailyOf(r, 'r')).toEqual({ [`${DAY}|${A}`]: 5 });
  });

  it('ไม่มีแท็บโอนย้ายเลยก็ตรวจได้', () => {
    const book = bookOf(join(fine('5001'), move('1200', A, 4)));
    delete book[NAMES.tf];
    const r = JSON.parse(api(book).doGet({ parameter: { api: 'cut-check' } }).text);
    expect(r.error).toBeUndefined();
    expect(r.totals.tf).toBe(0);
  });

  it('รายงานโอนย้ายคนละเดือนกับ JST มีคำเตือน', () => {
    const r = run(join(fine('5001'), { tf: [tf(1201, A, 1, { date: when('2026-04-02') })] }, move('1201', A, 1)));
    expect(r.warnings.some((x) => x.includes('Report โอนย้าย'))).toBe(true);
  });
});

describe('cut-api.gs — ชื่อสินค้า', () => {
  it('ชื่อจาก JST มาก่อน ถ้าไม่มีใช้จาก Transaction แล้วค่อยจาก CRM ซึ่งชื่อมักถูกตัดคำ', () => {
    const r = run({
      jst: [jst('5001', A, 1, { name: 'ชื่อเต็ม' })],
      crm: [crm('AB-1', A, 1, { name: 'ชื่อตัดคำ' }), crm('AB-2', B, 1, { name: 'ชื่อตัดคำ', size: 'King' }), crm('AB-3', C, 1, { name: 'ชื่อตัดคำ' })],
      tx: [tx('5001', A, 2), tx('AB-1', A, 2, { src: 'CRM', name: 'ชื่อ Tx' }), tx('AB-2', B, 2, { src: 'CRM', name: 'ชื่อ Tx' }), tx('AB-3', C, 0, { src: 'CRM', name: '' })],
      tr: [tr('5001', A, 2), tr('AB-1', A, 2), tr('AB-2', B, 2), tr('AB-3', C, 2)],
    });
    expect(r.names[A]).toBe('ชื่อเต็ม');
    expect(r.names[B]).toBe('ชื่อ Tx');
    expect(r.names[C]).toBe('ชื่อตัดคำ');
  });
});
