/**
 * ระบบใหม่บน Firebase ขั้น 1: public/wms-fire-core.js + public/wms-fire.js กับ store จำลอง
 *
 * หลักของเทสต์ชุดนี้: ส่งคำขอเดียวกันเข้า apps-script/book-api.gs ตัวจริง (โหมดบันทึก) กับ WmsFire (store จำลอง)
 * คำตอบต้องเหมือนกันทุกช่อง (เลขที่ error แถวที่ผิด กองไม่พอ) ยอดคงเหลือทุกกองต้องเท่ากัน
 * และ fifo() ของ WmsFire ต้องได้แถวเดียวกับ tx-api.gs อ่านแท็บ Transaction ของสมุดใหม่ (fifoFromBook) ทุกช่อง
 * เพิ่มเคสของระบบใหม่: สองเครื่องบันทึกชนกัน เอกสารแยกส่วน ดึงเฉพาะของใหม่ สำเนารุ่นไม่ตรง ตรวจยอด สิทธิ์แบบ Rules
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ ไม่มีการเรียก Firebase จริง
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadBook, fifoFromBook, txFromBook, fakeFireGcp } from '../dev/fake-gas.js';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let B, C, W, S, TR, DOC, PR, IT, TX;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fire-core.js', 'wms-fire-trc.js', 'wms-fire-docs.js', 'wms-fire-item.js', 'wms-fire-tx.js', 'wms-fire-print.js', 'wms-fire.js', 'wms-stocktake.js'].forEach((f) => new Function('window', read(f))(win));
  B = win.WmsBook;
  PR = win.WmsFirePrint;
  IT = win.WmsFireItem;
  TX = win.WmsFireTx;
  C = win.WmsFireCore;
  TR = win.WmsFireTrc;
  DOC = win.WmsFireDocs;
  W = win.WmsFire;
  S = win.WmsStocktake;
  /* wms-fire.js เรียก window.WmsFireTrc ตอนใช้งาน: ฟังก์ชันขั้น 3 ต้องเห็นตัวเดียวกัน */
  globalThis.window = globalThis.window || win;
  globalThis.window.WmsFireTrc = TR;
  globalThis.window.WmsFireCore = globalThis.window.WmsFireCore || C;
});

const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);   // 10 พ.ย. 2569 10:00 เวลาไทย
const DAY = 86400000;
const ME = { who: 'ทดลอง', pin: '1111' };
const HEAD = { who: 'หัวหน้าทดลอง', pin: '9999' };
const DOMAIN = 'example.test';
const STAFF_EMAIL = 'staff@example.test', HEAD_EMAIL = 'head@example.test', VIEW_EMAIL = 'view@example.test';
const QA_EMAIL = 'qa@example.test', STAFF2_EMAIL = 'staff2@example.test';   // เพิ่มเข้าสมุดเฉพาะเทสต์ที่ใช้ (x.join)
const USERS = {
  ['users/' + STAFF_EMAIL]: { name: 'ทดลอง', role: 'staff', active: true },
  ['users/' + HEAD_EMAIL]: { name: 'หัวหน้าทดลอง', role: 'head', active: true },
  ['users/' + VIEW_EMAIL]: { name: 'ดูอย่างเดียวทดลอง', role: 'viewer', active: true },
  'users/off@example.test': { name: 'ปิดแล้ว', role: 'staff', active: false },
};
const JOIN = {
  [QA_EMAIL]: { name: 'คิวเอทดลอง', role: 'staff', active: true, team: 'qa' },
  [STAFF2_EMAIL]: { name: 'คลังทดลอง', role: 'staff', active: true },
};
const ACCOUNTS = Object.keys(USERS).map((p) => ({ email: p.slice(6), name: USERS[p].name }))
  .concat(Object.keys(JOIN).map((email) => ({ email, name: JOIN[email].name })));

/** ค่าใน public/wms-fire-config.js (สวิตช์ โดเมน web config) */
function fireConfig() { const w = {}; new Function('window', read('wms-fire-config.js'))(w); return w.WMS_FIRE_CONFIG; }
/** localStorage จำลอง */
function memLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }

/* ยอดยกมาสมมติ [SKU, SKU เต็ม, ชื่อ, LOT, PO, โล, ชิ้น, Status, วันรับ, ไตรมาส] */
const OPEN = [
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'A-01-01', 20, 'เปิด', '2026-10-02', ''],
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', 'P1', 'R01-01-01', 10, '', '2026-10-02', ''],
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '9', 'P2', 'A-01-02', 6, 'เปิด', '', 'Q3/26'],
  ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2', '7', 'P5', 'A-03-01', 4, 'เปิด', '2026-09-01', ''],
  ['CCC004', 'CCC0000000004', 'หมอนสมมติ 4', '0', '0', 'QA', 3, '', '', ''],
];
const NAMES = { AAA0000000001: 'ที่นอนสมมติ 1', BBB0000000002: 'ท็อปเปอร์สมมติ 2', CCC0000000004: 'หมอนสมมติ 4' };

/** book-api.gs ตัวจริง (โหมดบันทึก) กับ WmsFire สองเครื่อง (ลงรายการ / หัวหน้า) บน store จำลองเดียวกัน */
async function both(opt = {}) {
  let t = opt.now || NOW;
  const clock = () => t;
  const gas = loadBook({ now: clock });
  gas.users([['ทดลอง', '1111', 'ลงรายการ'], ['หัวหน้าทดลอง', '9999', 'หัวหน้า']]);
  const store = W.memStore({ now: clock, domain: DOMAIN });
  store.seed(USERS);
  const device = async (email, extra = {}) => {
    const f = W.open({ store: store.connect(), auth: W.fakeAuth(ACCOUNTS), now: clock, partBytes: opt.partBytes, ...extra });
    const r = await f.login(email);
    if (r.error) throw new Error(r.error);
    return f;
  };
  const staff = await device(STAFF_EMAIL), head = await device(HEAD_EMAIL);
  const as = { me: [ME, staff], head: [HEAD, head] };
  const x = {
    gas, store, staff, head, device, clock,
    tick: (ms) => { t += ms; },
    /** เพิ่มคนเข้ารายชื่อแล้วล็อกอิน (QA_EMAIL = ทีม QA · STAFF2_EMAIL = คลัง / Inbound อีกคน) */
    join: (email) => { store.seed({ ['users/' + email]: JOIN[email] }); return device(email); },
    /** ส่งคำขอเดียวกันทั้งสองระบบ คำตอบต้องเหมือนกันทุกช่อง */
    async same(who, op, body) {
      const g = gas.post({ op, ...as[who][0], ...body });
      const f = await as[who][1].post(op, body);
      expect(f, `${op} ${JSON.stringify(body).slice(0, 80)}`).toEqual(g);
      return f;
    },
    async open() {
      await x.same('head', 'bk-open', { batch: 'o-1', asOf: 900, rows: OPEN });
      expect(gas.post({ op: 'bk-mode', ...HEAD, mode: 'book' }).mode).toBe('book');
    },
  };
  return x;
}

const saleLine = (order, qty, loc = 'A-01-01', lot = '8', po = 'P1', sku = 'AAA0000000001') =>
  ({ sys: 'JST', order, ref: 'ON' + order, track: 'TH' + order, sku, qty, piles: [[loc, lot, po, qty]] });
function cutBody(batch, lines, date = '2026-11-10') {
  const copy = [];
  lines.forEach((l) => l.piles.forEach((p) => copy.push([l.sku === 'AAA0000000001' ? 'AAA001' : l.sku.slice(0, 3) + '00' + l.sku.slice(-1), l.sku, p[1], p[2], p[0], '', p[3], 'ขาย', date, 'เปิด'])));
  return { batch, date, base: 900, names: NAMES, lines, copy };
}
const body = (batch, copy, extra = {}) => ({ batch, date: '2026-11-10', base: 900, names: NAMES, copy, ...extra });

/** ยอดทุกกอง ระบบเดิม (แท็บยอดคงเหลือ) เทียบกับระบบใหม่ (ยอดต่อกองที่คิดในเครื่องหลังดึงใหม่) */
async function sameBalance(x, f = x.head) {
  await f.sync();
  const norm = (list) => list.map((r) => r.join('|')).sort();
  const gas = x.gas.ss.getSheetByName('ยอดคงเหลือ').grid.slice(1).filter((r) => r && r[0]);
  const fire = Object.values(C.allPiles(f.local())).map((p) => [p.loc, p.sku, p.long, p.lot, p.po, p.qty, p.status, p.first, p.last || '']);
  expect(norm(fire)).toEqual(norm(gas));
}

/** fifo() ของระบบใหม่ = tx-api.gs อ่านแท็บ Transaction ของสมุดใหม่ ทุกแถวทุกช่อง */
async function sameFifo(x, f = x.head) {
  await f.sync();
  const g = fifoFromBook(x.gas.ss), n = f.fifo();
  /* last ไม่เทียบ: tx-api.gs ใช้วันที่จริงของเครื่อง ส่วนเทสต์เลื่อนเวลาได้ (เช็คแยกในเทสต์ตัดขาย) */
  ['skus', 'pos', 'locs', 'days', 'rows', 'cgr', 'cq'].forEach((k) => expect(n[k], k).toEqual(g[k]));
  return n;
}

/** ชุดที่บันทึก (ไม่นับยอดยกมา: ระบบเดิมเก็บแถวสมุดเดิมไว้ในช่อง base) ทุกช่องเหมือนกัน */
async function sameRecent(x) {
  const g = x.gas.post({ op: 'bk-recent', ...HEAD, days: 7 }).docs.filter((d) => d.type !== 'ยอดยกมา');
  const f = (await x.head.post('bk-recent', { days: 7 })).docs.filter((d) => d.type !== 'ยอดยกมา');
  expect(f).toEqual(g);
  return f;
}

async function sameAll(x) {
  await sameBalance(x);
  await sameBalance(x, x.staff);
  await sameBalance(x, await x.device(VIEW_EMAIL));   // เครื่องใหม่ คิดยอดจากเอกสารที่ดึงมาทั้งหมด
  const res = await sameFifo(x);
  const docs = await sameRecent(x);
  const st = B.stock(res);
  expect(B.compareStock(st, (await x.head.post('bk-stock', {})).piles)).toMatchObject({ same: true });
  /* ทุกชุดอยู่ในคำตอบ fifo แล้ว หน้า book จึงไม่หักซ้ำ */
  expect(B.reflect(res, docs).wait.map((d) => d.doc)).toEqual([]);
  expect((await x.head.post('bk-rebuild', {})).same).toBe(true);
}

/* ── ตรงกับ book-api.gs ──────────────────────────────────────────────── */

describe('WmsFire ตอบเหมือน book-api.gs (โหมดบันทึก)', () => {
  it('ยอดยกมา: เลขที่ ยอดทุกกอง วันรับ (cgr) ไตรมาส (cq) และแถวแบบ tx-fifo ตรงกัน', async () => {
    const x = await both();
    await x.open();
    await sameAll(x);
    const res = x.head.fifo();
    expect(res.cgr.map((c) => c[1])).toEqual(['2026-10-02', '2026-10-02', '2026-09-01']);
    expect(res.cq).toEqual([['2026-09-01', 4, 4], ['2026-12-01', 6, 6]]);
    expect((await x.head.post('bk-state', {})).open).toMatchObject({ doc: 'T2611-0001', rows: 5, qty: 43 });
  });

  it('ตัดขาย: เลขที่รันต่อ ส่งซ้ำได้เลขเดิม ตัดซ้ำไม่รับ ตรวจรูปแบบ กองไม่พอ ยกเลิกแล้วตัดใหม่ได้ ข้ามเดือนเลขเริ่มใหม่', async () => {
    const x = await both();
    await x.open();
    await x.same('me', 'bk-cut', cutBody('c-1', [saleLine('1', 2), saleLine('2', 1)]));
    await x.same('me', 'bk-cut', cutBody('c-1', [saleLine('1', 2), saleLine('2', 1)]));    // ส่งซ้ำ
    await x.same('me', 'bk-cut', cutBody('c-2', [saleLine('9', 1), saleLine('1', 2)]));    // ตัดซ้ำ
    await x.same('me', 'bk-seen', { date: '2026-11-10', keys: ['JST|1|AAA0000000001', 'JST|9|AAA0000000001'] });
    await x.same('me', 'bk-cut', cutBody('x', [{ ...saleLine('3', 2), piles: [['A-01-01', '8', 'P1', 1]] }]));
    await x.same('me', 'bk-cut', cutBody('x', [{ ...saleLine('3', 1), sys: 'SHOPEE' }]));
    await x.same('me', 'bk-cut', { ...cutBody('x', [saleLine('3', 1)]), copy: [['AAA001', '', '8', 'P1', 'A-01-01', '', 5, 'ขาย', '', 'เปิด']] });
    await x.same('me', 'bk-cut', { ...cutBody('x', [saleLine('3', 1)]), date: '2026-09-01' });
    await x.same('me', 'bk-cut', cutBody('x', [saleLine('3', 50)]));                      // กองไม่พอ
    await x.same('me', 'bk-cut', cutBody('c-3', [saleLine('3', 1, 'A-01-02', '9', 'P2')]));
    await x.same('me', 'bk-void', { doc: 'T2611-0002', why: 'ผิด' });                     // ไม่ใช่หัวหน้า
    await x.same('head', 'bk-void', { doc: 'T2611-0002' });
    await x.same('head', 'bk-void', { doc: 'T2611-0002', why: 'ไฟล์ผิดวัน' });
    await x.same('head', 'bk-void', { doc: 'T2611-0002', why: 'ซ้ำ' });
    await x.same('head', 'bk-void', { doc: 'T2611-0004', why: 'x' });                    // ชุดกลับรายการ
    await x.same('head', 'bk-void', { doc: 'T2611-0001', why: 'x' });                    // ยอดยกมา
    await x.same('me', 'bk-cut', cutBody('c-4', [saleLine('1', 2)]));                     // ตัดใหม่ได้
    await sameAll(x);
    x.tick(25 * DAY);   // 5 ธ.ค.
    await x.same('me', 'bk-cut', cutBody('c-5', [saleLine('1', 1)], '2026-12-05'));        // ตัดแล้วเดือนก่อน
    const r = await x.same('me', 'bk-cut', cutBody('c-6', [saleLine('5', 1)], '2026-12-05'));
    expect(r.doc).toBe('T2612-0001');
    await sameAll(x);
    expect(x.head.fifo().last).toBe('2026-12-05');
  });

  it('ย้าย รับของ แปลง ปรับยอด ตารางเดิม: แถวผิด สิทธิ์ ยอดเปลี่ยนระหว่างนับ ตรงกันทุกช่อง', async () => {
    const x = await both();
    await x.open();
    const mv = (over = {}) => Object.assign(['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 4, 'เบิก', 'โอนย้าย', 'เปิด'], over);
    await x.same('me', 'bk-move', body('m-1', [mv(), mv({ 6: 1, 5: 'RIB', 8: 'โอนย้าย QA', 9: '' })]));
    await x.same('me', 'bk-move', body('m-1', [mv()]));
    for (const bad of [mv({ 5: 'R01-01-01' }), mv({ 5: '' }), mv({ 7: 'ขาย' }), mv({ 8: 'RETURN' }), mv({ 9: 'ปิด' }), mv({ 3: '' }), mv({ 6: 0 })]) {
      await x.same('me', 'bk-move', body('x', [mv(), bad]));
    }
    await x.same('me', 'bk-move', body('x', [mv({ 6: 99 })]));
    const GR = ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', '', 'GR6911-0001'];
    await x.same('me', 'bk-gr', body('g-1', [GR, GR.slice(0, 10)]));
    await x.same('me', 'bk-gr', body('x', [Object.assign(GR.slice(), { 8: 'GR 9-11-26' })]));
    const CONV = [
      ['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
      ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR6911-0002'],
    ];
    await x.same('me', 'bk-conv', body('x', [CONV[0]]));
    await x.same('me', 'bk-conv', body('x', [CONV[1], CONV[0]]));
    await x.same('me', 'bk-conv', body('v-1', CONV));
    const adj = [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', '']];
    const lines = [{ loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 24, count: 22 }];
    await x.same('me', 'bk-adj', body('a', adj, { lines }));
    await x.same('head', 'bk-adj', body('a-1', adj, { lines: [{ ...lines[0], have: 20 }] }));   // ยอดเปลี่ยนแล้ว
    await x.same('head', 'bk-adj', body('a-1', adj, { lines: [] }));
    await x.same('head', 'bk-adj', body('a-2', adj, { lines }));
    const rows = [['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 1, 'ขาย', '2026-11-09', ''], ['AAA001', 'AAA0000000001', '0', '0', '', 'RIB', 1, 'รับ', 'RETURN', '']];
    await x.same('me', 'bk-rows', body('r', rows, { ref: 'แก้มือ' }));
    await x.same('head', 'bk-rows', body('r-1', rows, { ref: 'แก้มือ' }));
    await x.same('head', 'bk-rows', body('x', [Object.assign(rows[0].slice(), { 8: 'ขายหน้าร้าน' })]));
    await sameAll(x);
    /* ยกเลิก: ย้ายกลับ รับ → เบิก แปลงถอยทั้งคู่ ของที่รับเข้าถูกใช้แล้วยกเลิกไม่ได้ */
    await x.same('head', 'bk-void', { doc: 'T2611-0002', why: 'ย้ายผิด' });
    await x.same('me', 'bk-move', body('m-2', [mv({ 2: '10', 3: 'P9', 4: 'R01-02-01', 6: 3 })]));
    await x.same('head', 'bk-void', { doc: 'T2611-0003', why: 'รับผิด PO' });
    await x.same('head', 'bk-void', { doc: 'T2611-0004', why: 'แปลงผิด' });
    await sameAll(x);
    /* ใบโอนเข้า QA แยกใบ (ระบบใหม่ไม่ให้ปนกับย้ายในคลัง): เลขที่ ยอด แถวยังตรงกัน */
    await x.same('me', 'bk-move', body('m-qa', [mv({ 6: 1, 5: 'QA', 8: 'โอนย้าย QA', 9: '' })]));
    await sameAll(x);
  });

  it('คืนของ: หาออเดอร์ คืนตามเลขที่ตัด คืนเกินไม่รับ ยกเลิกชุดคืนแล้วคืนใหม่ได้ คืนแบบไม่รู้ออเดอร์', async () => {
    const x = await both();
    await x.open();
    await x.same('me', 'bk-cut', cutBody('c-1', [saleLine('1001', 3), saleLine('1002', 1, 'A-01-02', '9', 'P2')]));
    await x.same('me', 'bk-find', { date: '2026-11-10', keys: ['1001', 'on1002', 'th1001', '9999'] });
    const ret = (batch, qty, extra = {}) => x.same('me', 'bk-return', {
      batch, date: '2026-11-10', base: 900,
      lines: [{ sys: 'JST', order: '1001', ref: 'ON1001', track: 'TH1001', sku: 'AAA0000000001', qty, cut: 'T2611-0002', cutQty: 3, piles: [['A-01-01', '8', 'P1', qty]], ...extra }],
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', '', 'A-01-01', qty, 'รับ', 'RETURN', 'เปิด']],
    });
    await ret('r-1', 2);
    await x.same('me', 'bk-find', { date: '2026-11-10', keys: ['1001'] });
    await ret('r-2', 2);                                                                 // คืนเกิน
    await x.same('head', 'bk-void', { doc: 'T2611-0003', why: 'คืนผิดออเดอร์' });
    await x.same('me', 'bk-find', { date: '2026-11-10', keys: ['1001'] });
    await ret('r-3', 3);
    await x.same('me', 'bk-return', {
      batch: 'r-4', date: '2026-11-10', base: 900,
      lines: [{ sys: '', order: '', sku: 'BBB0000000002', qty: 1, piles: [['RIB', '0', '0', 1]] }],
      copy: [['BBB002', 'BBB0000000002', '0', '0', '', 'RIB', 1, 'รับ', 'RETURN', '']],
    });
    await x.same('me', 'bk-return', { batch: 'x', date: '2026-11-10', lines: [{ sys: 'JST', order: '1', sku: 'A', qty: 1, cut: 'T1', piles: [['RIB', '0', '0', 1]] }],
      copy: [['A', 'A', '0', '0', '', 'RIB', 1, 'รับ', 'RETURN', '']] });
    await sameAll(x);
  });

  it('LOT 0 ขายแล้วยกเลิก ของกลับกองเดิม · คืนข้ามเดือนนับชิ้นที่คืนเดือนก่อน · ยกเลิกชุดตัดที่คืนไปบางส่วนแล้ว', async () => {
    const x = await both();
    await x.open();
    /* กอง LOT 0 / PO 0 ที่โลขาย (ของคืนที่ไม่รู้ LOT) */
    expect((await x.same('head', 'bk-rows', body('r-0', [['CCC004', 'CCC0000000004', '0', '0', '', 'A-05-01', 4, 'รับ', 'RETURN', 'เปิด']], { ref: 'ของคืน' }))).doc).toBe('T2611-0002');
    const lot0 = (order, qty) => saleLine(order, qty, 'A-05-01', '0', '0', 'CCC0000000004');
    expect((await x.same('me', 'bk-cut', cutBody('c-0', [lot0('3001', 3)]))).doc).toBe('T2611-0003');
    expect((await x.same('head', 'bk-void', { doc: 'T2611-0003', why: 'ไฟล์ซ้ำ' })).reversed).toBe('T2611-0004');
    expect((await x.same('me', 'bk-cut', cutBody('c-1', [lot0('3001', 4), saleLine('3002', 5)]))).doc).toBe('T2611-0005');
    expect((await x.same('me', 'bk-cut', cutBody('x', [lot0('3003', 1)]))).error).toMatch(/^ยอดในสมุดไม่พอ/);   // LOT 0 หมดแล้ว
    await sameAll(x);
    /* เดือนถัดไป: คืนออเดอร์ที่ตัดเดือนก่อน */
    x.tick(25 * DAY);
    const ret = (batch, qty) => x.same('me', 'bk-return', {
      batch, date: '2026-12-05', base: 900,
      lines: [{ sys: 'JST', order: '3002', ref: 'ON3002', track: 'TH3002', sku: 'AAA0000000001', qty, cut: 'T2611-0005', cutQty: 5, piles: [['A-01-01', '8', 'P1', qty]] }],
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', '', 'A-01-01', qty, 'รับ', 'RETURN', 'เปิด']],
    });
    await x.same('me', 'bk-find', { date: '2026-12-05', keys: ['3002', 'ON3001'] });
    expect((await ret('r-1', 2)).doc).toBe('T2612-0001');
    expect((await ret('r-2', 4)).error).toMatch(/^คืนเกินชิ้นที่ตัด/);   // รวมเกิน 5
    expect((await ret('r-3', 3)).doc).toBe('T2612-0002');
    await x.same('me', 'bk-find', { date: '2026-12-05', keys: ['3002'] });
    expect((await x.same('head', 'bk-void', { doc: 'T2611-0005', why: 'ตัดผิดไฟล์' })).reversed).toBe('T2612-0003');   // ข้ามเดือน ของคืนแล้ว
    expect((await x.same('me', 'bk-cut', cutBody('c-2', [saleLine('3002', 1)], '2026-12-05'))).doc).toBe('T2612-0004');   // ยกเลิกแล้วตัดใหม่ได้
    await sameAll(x);
  });
});

/* ── เคสของระบบใหม่ ──────────────────────────────────────────────────── */

describe('WmsFire: สองเครื่อง สำเนาในเครื่อง เอกสารใหญ่', () => {
  it('สองเครื่องบันทึกชนกัน: transaction ลองใหม่ ดึงของเครื่องอื่นก่อน เลขที่ไม่ซ้ำ กองหักครบทั้งสองชุด', async () => {
    const x = await both();
    await x.open();
    await x.staff.sync();
    await x.head.sync();
    const before = x.store.stats().retries;
    /* ระหว่างเครื่องแรกอยู่ใน transaction เครื่องที่สองบันทึกเสร็จก่อน */
    x.store.hook(async () => {
      const r = await x.head.post('bk-move', body('h-1', [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', 'B-01-01', 15, 'เบิก', 'โอนย้าย', 'เปิด']]));
      expect(r.doc).toBe('T2611-0002');
    });
    const a = await x.staff.post('bk-cut', cutBody('c-1', [saleLine('1', 5)]));
    expect(a).toMatchObject({ doc: 'T2611-0003', book: 1 });
    expect(x.store.stats().retries).toBeGreaterThan(before);
    /* เหลือ 20 − 15 − 5 = 0 · ชุดที่สามตัดอีกชิ้นต้องไม่ผ่าน */
    const c = await x.head.post('bk-cut', cutBody('c-2', [saleLine('2', 1)]));
    expect(c.error).toMatch(/^ยอดในสมุดไม่พอ 1 แถว/);
    expect(C.allPiles(x.staff.local())['A-01-01|AAA0000000001|8|P1']).toBeUndefined();
  });

  it('เอกสารใหญ่แยกส่วน (~2, ~3) เครื่องใหม่ดึงแล้วต่อกลับได้ครบ ส่งซ้ำได้เลขเดิม', async () => {
    const x = await both({ partBytes: 9000 });
    await x.open();
    const lines = Array.from({ length: 300 }, (_, i) => saleLine(String(5000 + i), 0.05));
    const r = await x.staff.post('bk-cut', cutBody('big', lines));
    expect(r).toMatchObject({ doc: 'T2611-0002', lines: 300, rows: 300, qty: 15 });
    const parts = Object.keys(x.store.dump()).filter((p) => p.startsWith('docs/big~'));
    expect(parts.length).toBeGreaterThan(1);
    /* ขนาดแบบที่ Firestore นับ: ชื่อฟิลด์ + ไบต์ UTF-8 ของข้อความ + 1 ตัวเลข 8 ไบต์ */
    const size = (d) => 32 + Object.keys(d).reduce((a, k) => a + C.byteLen(k) + 1 + (typeof d[k] === 'string' ? C.byteLen(d[k]) + 1 : 8), 0);
    expect(Math.max(...Object.keys(x.store.dump()).filter((p) => p.startsWith('docs/')).map((p) => size(x.store.dump()[p])))).toBeLessThanOrEqual(9000);
    const fresh = await x.device(HEAD_EMAIL);
    await fresh.sync();
    const d = fresh.local().docs.find((y) => y.id === 'big');
    /* จำนวนส่วนในสำเนาของเครื่องที่บันทึก = ที่เครื่องอื่นดึงไป */
    expect(x.staff.local().docs.find((y) => y.id === 'big').part).toBe(parts.length + 1);
    expect(d.part).toBe(parts.length + 1);
    expect([d.rows.length, d.lines.length, d.lines[299].order]).toEqual([300, 300, '5299']);
    expect((await fresh.post('bk-recent', { days: 1 })).docs[0].copy).toHaveLength(300);
    expect(await x.staff.post('bk-cut', cutBody('big', lines))).toMatchObject({ doc: 'T2611-0002', again: true });
    expect(C.allPiles(fresh.local())['A-01-01|AAA0000000001|8|P1'].qty).toBe(5);
  });

  it('ดึงเฉพาะของใหม่: เปิดหน้าอีกครั้งอ่านแค่ meta + เอกสารใหม่ · สำเนารุ่นไม่ตรงล้างแล้วโหลดใหม่', async () => {
    const x = await both();
    await x.open();
    const cache = W.memCache();
    const third = await x.device(STAFF_EMAIL, { cache });
    await third.sync();
    expect(third.local().seq).toBe(1);
    await x.head.post('bk-move', body('m-1', [['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', 'B-02-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]));
    const r0 = x.store.stats().reads;
    const s = await third.sync();
    expect(s).toEqual({ seq: 2, added: 1 });
    expect(x.store.stats().reads - r0).toBe(2);   // meta + เอกสารใหม่ 1 (ยอดต่อกองคิดในเครื่อง)
    expect(C.allPiles(third.local())['B-02-01|BBB0000000002|7|P5'].qty).toBe(1);
    expect(await third.sync()).toEqual({ seq: 2, added: 0 });

    /* เปิดหน้าใหม่บนเครื่องเดิม: อ่านสำเนาจาก cache ไม่ดึงเอกสารเก่าซ้ำ */
    const again = await x.device(STAFF_EMAIL, { cache });
    const r1 = x.store.stats().reads;
    expect(await again.sync()).toEqual({ seq: 2, added: 0 });
    expect(x.store.stats().reads - r1).toBe(1);

    /* สำเนารุ่นเก่า (v ไม่ตรง) = ทิ้งแล้วโหลดใหม่ทั้งหมด */
    const old = W.memCache();
    await old.put({ v: 0, seq: 99, meta: null, docs: [{ id: 'zz', seq: 99, rows: [] }], piles: {}, master: {}, mv: 0 });
    const z = await x.device(STAFF_EMAIL, { cache: old });
    expect(await z.sync()).toEqual({ seq: 2, added: 2 });
    expect(z.local().docs.map((d) => d.no)).toEqual(['T2611-0001', 'T2611-0002']);
  });

  it('ตรวจยอด: คิดใหม่จากเอกสารทั้งหมดเทียบยอดในเครื่อง ต่างกันบอกกองที่ต่าง', async () => {
    const x = await both();
    await x.open();
    await x.staff.post('bk-cut', cutBody('c-1', [saleLine('1', 2)]));
    expect(await x.head.post('bk-rebuild', {})).toMatchObject({ same: true, rows: 6, piles: 5, neg: 0 });
    expect((await x.staff.post('bk-rebuild', {})).error).toBe('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
    /* สำเนาในเครื่องเพี้ยน (เช่นแก้ใน DevTools) */
    delete x.head.local().piles['A-01-01|AAA0000000001|8|P1'];
    const r = await x.head.post('bk-rebuild', {});
    expect(r.same).toBe(false);
    expect(r.diff).toContainEqual(['A-01-01', 'AAA001', '8', 'P1', 18, 0]);
    /* ซ่อมจากเอกสารให้แล้ว ตรวจรอบถัดไปตรง */
    expect(r.fixed).toBe(1);
    expect(C.allPiles(x.head.local())['A-01-01|AAA0000000001|8|P1'].qty).toBe(18);
    expect(await x.head.post('bk-rebuild', {})).toMatchObject({ same: true });
  });

  it('ยอดยกมาลงใหม่ได้เฉพาะก่อนมีเอกสารอื่น ลงซ้ำต้องกด ลงใหม่ · ลงใหม่แล้วเลขแถวเริ่ม 2 ชุดเก่าเป็นยกเลิก', async () => {
    const x = await both();
    await x.open();
    expect((await x.head.post('bk-open', { batch: 'o-2', rows: OPEN })).error).toBe('มียอดยกมาแล้ว (T2611-0001) จะลงใหม่ต้องกด ลงใหม่');
    const r = await x.head.post('bk-open', { batch: 'o-2', rows: OPEN.slice(0, 2), replace: true });
    expect(r).toMatchObject({ doc: 'T2611-0002', rows: 2, qty: 30, replaced: ['T2611-0001'] });
    const res = x.head.fifo();
    expect(res.rows.map((y) => y[0])).toEqual([2, 3]);
    const docs = (await x.head.post('bk-recent', { days: 1 })).docs;
    expect(docs.find((d) => d.doc === 'T2611-0001')).toMatchObject({ status: 'ยกเลิก', why: 'ลงยอดยกมาใหม่' });
    expect(Object.keys(C.allPiles(x.head.local()))).toHaveLength(2);
    await x.staff.post('bk-cut', cutBody('c-1', [saleLine('1', 1)]));
    expect((await x.head.post('bk-open', { batch: 'o-3', rows: OPEN, replace: true })).error).toMatch(/^มีเอกสารอื่นหลังยอดยกมาแล้ว 1 ชุด \(T2611-0003\)/);
    expect((await x.staff.post('bk-open', { batch: 'o-4', rows: OPEN })).error).toBe('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
  });

  it('ล็อกอิน: บัญชีที่ไม่มีหรือปิดสิทธิ์เข้าไม่ได้ ดูอย่างเดียวบันทึกไม่ได้ แต่อ่านยอดได้', async () => {
    const x = await both();
    await x.open();
    const f = W.open({ store: x.store.connect(), auth: W.fakeAuth(ACCOUNTS), now: x.clock });
    expect((await f.login('nobody@example.test')).error).toMatch(/ยังไม่มีสิทธิ์/);
    expect((await f.login('off@example.test')).error).toMatch(/ยังไม่มีสิทธิ์/);
    const v = await f.login(VIEW_EMAIL);
    expect(v).toMatchObject({ who: 'ดูอย่างเดียวทดลอง', role: 'ดูอย่างเดียว', mode: 'book' });
    expect((await f.post('bk-move', body('m', [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]))).error).toBe('บัญชีนี้ดูได้อย่างเดียว');
    expect((await f.post('bk-stock', {})).piles).toHaveLength(5);
    expect((await x.staff.post('bk-login', {}))).toMatchObject({ who: 'ทดลอง', role: 'ลงรายการ', v: 4, app: 'book' });
  });
});

/* ── กฎแบบ firestore.rules (store จำลองเช็คแบบเดียวกัน) ─────────────── */

describe('WmsFire: สิทธิ์แบบ Rules', () => {
  async function ready() {
    const x = await both();
    await x.open();
    return x;
  }
  const meta = (x) => x.store.dump()['meta/head'];
  const as = (x, email) => { x.store.setUser({ email, verified: true }); return x.store; };
  const nextMeta = (m, id, over = {}) => ({ ...m, seq: m.seq + 1, next: m.next + 1, rows: m.rows + 1, last: id, at: C.TIME, ...over });
  const doc = (m, id, over = {}) => ({ v: 1, no: 'T2611-' + String(m.next).padStart(4, '0'), seq: m.seq + 1, row: m.rows + 2, n: 1, type: 'ย้าย', date: '2026-11-10',
    by: STAFF_EMAIL, name: 'ทดลอง', at: C.TIME, stamp: '', ref: '', link: '', why: '', qty: 1, tr: '', trState: 'none', rows: '', names: '', orders: '', part: 1, ...over });

  it('เอกสารใหม่ต้องมากับ meta ที่ seq +1 เลขที่ตรงเดือนเซิร์ฟเวอร์ by เป็นคนล็อกอิน ประเภทของหัวหน้าต้องเป็นหัวหน้า', async () => {
    const x = await ready();
    const m = meta(x), s = as(x, STAFF_EMAIL);
    await expect(s.commit([['docs/a', doc(m, 'a')], ['meta/head', nextMeta(m, 'a')]])).resolves.toBeUndefined();
    const m2 = meta(x);
    await expect(s.commit([['docs/b', doc(m2, 'b')]])).rejects.toThrow(/meta ที่ seq เพิ่ม 1/);
    await expect(s.commit([['docs/b', doc(m2, 'b')], ['meta/head', nextMeta(m2, 'b', { seq: m2.seq + 2 })]])).rejects.toThrow(/seq เพิ่ม 1/);
    await expect(s.commit([['docs/b', doc(m2, 'b', { by: HEAD_EMAIL })], ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/by ต้องเป็นอีเมล/);
    await expect(s.commit([['docs/b', doc(m2, 'b', { at: 123 })], ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/เวลาเซิร์ฟเวอร์/);
    await expect(s.commit([['docs/b', doc(m2, 'b', { type: 'ปรับยอด' })], ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/ลงไม่ได้ด้วยสิทธิ์นี้/);
    await expect(s.commit([['docs/b', doc(m2, 'b', { no: 'T2612-0001' })], ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/เลขเอกสาร/);
    await expect(s.commit([['docs/b', doc(m2, 'b')], ['meta/head', nextMeta(m2, 'zz')]])).rejects.toThrow(/meta.last/);
    await expect(s.commit([['bal/00', { v: 9, p: '' }]])).rejects.toThrow(/เขียน bal ไม่ได้/);
    await expect(s.commit([['cut/2026-11-10', { k: '' }]])).rejects.toThrow(/เขียน cut ไม่ได้/);
    await expect(s.commit([['meta/head', { ...m2, rows: 1 }]])).rejects.toThrow(/เฉพาะตอนบันทึกเอกสาร/);
  });

  it('Rules อ่านเอกสารประกอบได้ไม่เกิน 20 ครั้งต่อคำขอ: ชุดใหญ่สุดที่ยอม (PARTS_MAX ส่วน) ยังผ่าน · เกินนั้นแอปบอกให้แบ่งชุด', async () => {
    const x = await ready();
    const m = meta(x), s = as(x, STAFF_EMAIL);
    const parts = (n) => Array.from({ length: n - 1 }, (_, i) => ['docs/a~' + (i + 2), { v: 1, of: 'a', seq: m.seq + 1, i: i + 2, rows: '', orders: '' }]);
    /* เอกสารหลัก 2 + meta 2 + ส่วนละ 2 */
    await expect(s.commit([['docs/a', doc(m, 'a', { part: C.PARTS_MAX })], ...parts(C.PARTS_MAX), ['meta/head', nextMeta(m, 'a')]])).resolves.toBeUndefined();
    const m2 = meta(x);
    const parts2 = Array.from({ length: 9 }, (_, i) => ['docs/b~' + (i + 2), { v: 1, of: 'b', seq: m2.seq + 1, i: i + 2, rows: '', orders: '' }]);
    /* เกิน 7 ส่วนกันตรง ๆ ไม่พึ่งเพดานการอ่าน (Rules จริงอาจไม่นับการอ่านที่ซ้ำ) */
    await expect(s.commit([['docs/b', doc(m2, 'b', { part: 10 })], ...parts2, ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/รูปเอกสาร|ส่วนแยกผิดรูป/);
    const more = [1, 2, 3, 4, 5, 6].map((d) => ['use/2026-01-0' + d, { dev: { r: 1, w: 1, by: 'x' } }]);
    await expect(s.commit([['docs/b', doc(m2, 'b', { part: 7 })], ...parts2.slice(0, 6), ['meta/head', nextMeta(m2, 'b')], ...more]))
      .rejects.toThrow(/Rules อ่านเอกสารประกอบ 22 ครั้ง เกิน 20/);
    /* ส่วนแยกที่ไม่ได้มากับเอกสารหลักในคำขอเดียวกัน (เติมแถวให้เอกสารล่าสุดทีหลัง) ไม่ได้ แม้ meta.last ยังชี้เอกสารนั้น */
    await expect(s.commit([['docs/a~9', { v: 1, of: 'a', seq: m.seq + 1, i: 9, rows: 'x', orders: '' }]])).rejects.toThrow(/ส่วนแยกของเอกสารไม่ตรง/);
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), mv: 2, at: C.TIME }], ['docs/a~9', { v: 1, of: 'a', seq: m.seq + 1, i: 9, rows: 'x', orders: '' }]]))
      .rejects.toThrow(/แค่ mv|ส่วนแยกของเอกสารไม่ตรง/);

    /* แอปไม่ส่งชุดที่เกิน: แยกได้เกิน PARTS_MAX ส่วน = บอกให้แบ่งชุด */
    const y = await both({ partBytes: 2000 });
    await y.open();
    const lines = Array.from({ length: 300 }, (_, i) => saleLine(String(7000 + i), 0.05));
    const r = await y.staff.post('bk-cut', cutBody('huge', lines));
    expect(r.error).toMatch(/^ชุดนี้ใหญ่เกินที่บันทึกได้ในครั้งเดียว \(\d+ ส่วน เกิน 7\) แบ่งเป็นหลายชุด$/);
    expect(Object.keys(y.store.dump()).filter((k) => k.startsWith('docs/huge'))).toEqual([]);
  });

  it('เอกสารเดิมแก้ได้เฉพาะเลข TRcloud · users กับ master เขียนได้เฉพาะหัวหน้า · ดูอย่างเดียวเขียนไม่ได้ · นอกโดเมนไม่ได้', async () => {
    const x = await ready();
    const d = x.store.dump()['docs/o-1'], s = as(x, STAFF_EMAIL);
    await expect(s.commit([['docs/o-1', { ...d, tr: 'GR1', trState: 'done', trBy: STAFF_EMAIL, trAt: C.TIME }]])).resolves.toBeUndefined();
    await expect(s.commit([['docs/o-1', { ...d, tr: 'GR1', trState: 'ลงแล้ว', trBy: STAFF_EMAIL, trAt: C.TIME }]])).rejects.toThrow(/สถานะ TRcloud ไม่ถูก/);
    await expect(s.commit([['docs/o-1', { ...d, tr: 'GR1', trState: 'done', trBy: STAFF_EMAIL, trAt: 1 }]])).rejects.toThrow(/สถานะ TRcloud ไม่ถูก/);
    await expect(s.commit([['docs/o-1', { ...d, qty: 999, trBy: STAFF_EMAIL }]])).rejects.toThrow(/แก้ได้เฉพาะเลข TRcloud/);
    await expect(s.commit([['users/x@example.test', { name: 'x', role: 'head', active: true }]])).rejects.toThrow(/เฉพาะหัวหน้า/);
    await expect(as(x, HEAD_EMAIL).commit([['master/sup', { rows: 'P1\tผู้ผลิตสมมติ' }]])).resolves.toBeUndefined();
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), mv: 1 }]])).resolves.toBeUndefined();
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), rows: 50 }]])).rejects.toThrow(/แค่ mv กับ trc/);
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), seq: 50 }]])).rejects.toThrow(/seq ต้องเพิ่มทีละ 1/);
    await expect(as(x, VIEW_EMAIL).commit([['docs/o-1', { ...d, tr: 'x', trBy: VIEW_EMAIL }]])).rejects.toThrow(/ดูได้อย่างเดียว/);
    await expect(as(x, 'staff@other.test').commit([['docs/o-1', { ...d, tr: 'x' }]])).rejects.toThrow(/นอกโดเมน/);
    x.store.setUser(null);
    await expect(x.store.commit([['docs/o-1', { ...d, tr: 'x' }]])).rejects.toThrow(/ยังไม่ได้ล็อกอิน/);
    /* master ที่หัวหน้าเปลี่ยน (mv) ทุกเครื่องดึงใหม่ แล้ว fifo มี Supplier */
    await x.staff.sync();
    expect(x.staff.fifo().sup.rows).toEqual([['P1', 'ผู้ผลิตสมมติ']]);
  });
});

/* ── ขั้น 2: คนใช้ เข้าสู่ระบบ ตัวนับโควตา ยอดยกมาจากไฟล์นับสต๊อก ─────── */

describe('WmsFire ขั้น 2: รายชื่อคนใช้และการเข้า', () => {
  async function ready() {
    const x = await both();
    await x.open();
    return x;
  }
  const dev = (x, extra = {}) => W.open({ store: x.store.connect(), auth: W.fakeAuth(ACCOUNTS), now: x.clock, domain: DOMAIN, ...extra });

  it('หัวหน้าดูรายชื่อได้ (เรียงคนใช้งาน → สิทธิ์ → ชื่อ) คนลงรายการดูไม่ได้ทั้งในแอปและแบบ Rules', async () => {
    const x = await ready();
    const r = await x.head.users();
    expect(r.users.map((u) => [u.email, u.role, u.active])).toEqual([
      [HEAD_EMAIL, 'head', true], [STAFF_EMAIL, 'staff', true], [VIEW_EMAIL, 'viewer', true], ['off@example.test', 'staff', false]]);
    expect((await x.staff.users()).error).toBe('รายชื่อดูได้เฉพาะหัวหน้า');
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    await expect(x.store.list('users')).rejects.toThrow(/รายชื่อดูได้เฉพาะหัวหน้า/);
  });

  it('เพิ่มคนด้วยอีเมลบริษัท แล้วคนนั้นเข้าได้ทันที · ปิดแล้วเข้าไม่ได้ · กันอีเมลนอกโดเมน ซ้ำ สิทธิ์แปลก', async () => {
    const x = await ready();
    const h = dev(x);
    await h.login(HEAD_EMAIL);
    expect((await h.saveUser('new@gmail.test', { name: 'ใหม่', role: 'staff' })).error).toBe('ต้องเป็นอีเมล @example.test เท่านั้น');
    expect((await h.saveUser('not-an-email', { name: 'ใหม่', role: 'staff' })).error).toBe('อีเมลไม่ถูกรูปแบบ');
    expect((await h.saveUser('new@example.test', { name: '', role: 'staff' })).error).toBe('ต้องใส่ชื่อ');
    expect((await h.saveUser('new@example.test', { name: 'ใหม่', role: 'boss' })).error).toMatch(/^สิทธิ์ต้องเป็น/);
    const add = await h.saveUser(' New@Example.test ', { name: '=ใหม่ทดลอง', role: 'staff', add: true });
    expect(add).toMatchObject({ added: true, user: { email: 'new@example.test', name: 'ใหม่ทดลอง', role: 'staff', active: true } });
    expect((await h.saveUser('new@example.test', { name: 'ซ้ำ', role: 'staff', add: true })).error).toBe('new@example.test มีในรายชื่อแล้ว (ใหม่ทดลอง)');
    expect(x.store.dump()['users/new@example.test']).toMatchObject({ by: HEAD_EMAIL, at: NOW });

    const n = dev(x);
    expect(await n.login('new@example.test')).toMatchObject({ who: 'ใหม่ทดลอง', role: 'ลงรายการ', email: 'new@example.test' });
    /* ปิดบัญชี: ชื่อยังอยู่ เข้าใหม่ไม่ได้ */
    expect((await h.saveUser('new@example.test', { name: 'ใหม่ทดลอง', role: 'staff', active: false })).user.active).toBe(false);
    expect((await dev(x).login('new@example.test')).error).toBe('new@example.test ยังไม่มีสิทธิ์ ติดต่อหัวหน้า Inventory ให้เพิ่มชื่อในหน้าตั้งค่า');
    /* นอกโดเมน: ไม่ถึงขั้นอ่านรายชื่อ */
    expect(await dev(x).login('someone@gmail.test')).toMatchObject({ error: 'someone@gmail.test ไม่ใช่อีเมลบริษัท ใช้บัญชี @example.test เท่านั้น', noRight: 1 });
  });

  it('หัวหน้าลดสิทธิ์หรือปิดตัวเองไม่ได้ · ต้องเหลือหัวหน้าที่ใช้งานอย่างน้อย 1 คน', async () => {
    const x = await ready();
    expect((await x.head.saveUser(HEAD_EMAIL, { name: 'หัวหน้าทดลอง', role: 'staff' })).error).toBe('ลดสิทธิ์หรือปิดบัญชีตัวเองไม่ได้ ให้หัวหน้าอีกคนทำ');
    expect((await x.head.saveUser(HEAD_EMAIL, { name: 'หัวหน้าทดลอง', role: 'head', active: false })).error).toMatch(/^ลดสิทธิ์หรือปิดบัญชีตัวเอง/);
    /* หัวหน้าคนที่สอง → ลดสิทธิ์คนแรกได้ แต่คนที่สองลดตัวเองไม่ได้ และถ้าเหลือคนเดียวก็ลดไม่ได้ */
    expect((await x.head.saveUser(STAFF_EMAIL, { name: 'ทดลอง', role: 'head' })).user.role).toBe('head');
    const s = await x.device(STAFF_EMAIL);
    expect((await s.saveUser(HEAD_EMAIL, { name: 'หัวหน้าทดลอง', role: 'viewer' })).user.role).toBe('viewer');
    const users = (await s.users()).users;
    expect(users.filter((u) => u.role === 'head' && u.active).map((u) => u.email)).toEqual([STAFF_EMAIL]);
    expect((await x.staff.saveUser(VIEW_EMAIL, { name: 'x', role: 'head' })).error).toBe('แก้รายชื่อได้เฉพาะหัวหน้า');
  });

  it('เวลาเข้าล่าสุด: เขียนตอนเข้าไม่เกินชั่วโมงละครั้ง ทุกคนแก้ได้แค่ช่องนี้ของตัวเอง (Rules)', async () => {
    const x = await ready();
    const users = () => x.store.dump();
    expect(users()['users/' + STAFF_EMAIL].last).toBe(NOW);
    x.tick(10 * 60000);
    await dev(x).login(STAFF_EMAIL);
    expect(users()['users/' + STAFF_EMAIL].last).toBe(NOW);   // ยังไม่ถึงชั่วโมง ไม่เขียน
    x.tick(60 * 60000);
    await dev(x).login(STAFF_EMAIL);
    expect(users()['users/' + STAFF_EMAIL].last).toBe(NOW + 70 * 60000);
    /* ดูอย่างเดียวก็เขียนเวลาเข้าของตัวเองได้ แต่แก้สิทธิ์ตัวเองหรือเวลาของคนอื่นไม่ได้ */
    const s = x.store;
    s.setUser({ email: VIEW_EMAIL, verified: true });
    await expect(s.patch('users/' + VIEW_EMAIL, { last: C.TIME })).resolves.toBeUndefined();
    await expect(s.patch('users/' + VIEW_EMAIL, { role: 'head' })).rejects.toThrow(/เขียน users ได้เฉพาะหัวหน้า/);
    await expect(s.patch('users/' + VIEW_EMAIL, { last: 5 })).rejects.toThrow(/เขียน users ได้เฉพาะหัวหน้า/);
    await expect(s.patch('users/' + STAFF_EMAIL, { last: C.TIME })).rejects.toThrow(/เขียน users ได้เฉพาะหัวหน้า/);
    s.setUser({ email: 'off@example.test', verified: true });
    await expect(s.patch('users/off@example.test', { last: C.TIME })).rejects.toThrow(/ยังไม่มีสิทธิ์/);
  });
});

describe('WmsFire ขั้น 2: ตัวนับโควตา', () => {
  /** ตัวนับของเครื่องเก็บใน meter (หน้าเว็บใช้ localStorage) */
  async function setup(at = NOW) {
    const x = await both({ now: at });
    await x.open();
    return x;
  }

  it('นับอ่าน/เขียนของเครื่องนี้ (ไม่รวมเครื่องอื่น) เอกสารที่บันทึกวันนี้ทั้งระบบ และส่งยอดไปรวมที่ use/{วัน}', async () => {
    const x = await setup();
    const meter = W.memMeter();
    const a = await x.device(STAFF_EMAIL, { meter, domain: DOMAIN });
    await a.sync();
    const q1 = await a.quota();
    expect(q1.day).toBe('2026-11-09');   // 10 พ.ย. 10:00 ไทย = 9 พ.ย. 19:00 แปซิฟิก
    expect(q1.limits).toEqual({ reads: 50000, writes: 20000 });
    expect(q1.reads).toBeGreaterThan(0);
    const r0 = q1.reads, w0 = q1.writes;
    /* อีกเครื่องบันทึก: ไม่นับในเครื่องนี้ */
    await x.head.post('bk-move', body('m-1', [['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', 'B-02-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]));
    const q2 = await a.quota();
    expect(q2.reads).toBe(r0 + 3);       // ดึงของใหม่ก่อน (meta + เอกสารใหม่ 1) + use/{วัน} · ที่เครื่องอื่นอ่านเขียนไม่นับ
    expect(q2.docs).toBe(2);
    expect(q2.docWrites).toBe(4);        // เอกสาร + meta ต่อชุด
    /* เครื่องนี้บันทึกเอง: เขียน 2 (เอกสาร + meta) */
    await a.post('bk-move', body('m-2', [['BBB002', 'BBB0000000002', '7', 'P5', 'B-02-01', 'C-02-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]));
    const q3 = await a.quota();
    expect(q3.writes - w0).toBeGreaterThanOrEqual(2);
    expect(q3.docs).toBe(3);             // ชุดที่เครื่องนี้เพิ่งบันทึกนับด้วย (ยังไม่ได้ดึงกลับจากฐาน)
    expect(q3.all.list.find((d) => d.me)).toMatchObject({ by: 'ทดลอง', r: q3.reads, w: q3.writes });
    expect(Object.keys(x.store.dump()).filter((k) => k.startsWith('use/'))).toEqual(['use/2026-11-09']);
  });

  it('ทุกเครื่องรวมกันที่ use/{วัน} · ขึ้นวันใหม่ตามเวลาแปซิฟิก ตัวนับเริ่ม 0', async () => {
    const x = await setup();
    const a = await x.device(STAFF_EMAIL, { meter: W.memMeter() });
    const b = await x.device(HEAD_EMAIL, { meter: W.memMeter() });
    await a.quota();
    const qb = await b.quota();
    /* เครื่องหัวหน้าของ both() ส่งยอดตอนลงยอดยกมาแล้ว + a + b = เครื่องละช่อง */
    expect(qb.all.list).toHaveLength(3);
    expect([...new Set(qb.all.list.map((d) => d.by))].sort()).toEqual(['ทดลอง', 'หัวหน้าทดลอง']);
    expect(qb.all.list.filter((d) => d.me)).toHaveLength(1);
    expect(qb.all.reads).toBe(qb.all.list.reduce((s, d) => s + d.r, 0));
    /* รีเซ็ตเที่ยงคืนแปซิฟิก = 15:00 ไทยช่วงเวลามาตรฐาน (พ.ย.) */
    expect(new Date(qb.resetAt + 7 * 3600000).toISOString().slice(11, 16)).toBe('15:00');
    x.tick(qb.resetAt - NOW + 60000);
    const q = await b.quota();
    expect(q.day).toBe('2026-11-10');
    expect(q.reads).toBeLessThan(5);
    expect(q.docs).toBe(0);
  });

  it('Rules: use/{วัน} เติมได้ครั้งละช่องเดียว ชื่อต้องเป็นวันที่ คนที่ปิดแล้วเขียนไม่ได้', async () => {
    const x = await setup();
    const s = x.store;
    s.setUser({ email: VIEW_EMAIL, verified: true });
    await expect(s.patch('use/2026-11-09', { d1: { r: 1, w: 1, by: 'x' } })).resolves.toBeUndefined();
    await expect(s.patch('use/2026-11-09', { d2: { r: 1, w: 1 }, d3: { r: 1, w: 1 } })).rejects.toThrow(/ครั้งละเครื่อง/);
    await expect(s.patch('use/today', { d1: { r: 1, w: 1 } })).rejects.toThrow(/use ต้องเป็นวันที่/);
    s.setUser({ email: 'off@example.test', verified: true });
    await expect(s.patch('use/2026-11-09', { d9: { r: 1, w: 1 } })).rejects.toThrow(/ยังไม่มีสิทธิ์/);
  });
});

describe('WmsFire ขั้น 2: ยอดยกมาจากไฟล์ตั้งต้นสมุดของหน้านับสต๊อกใหญ่', () => {
  /* fixture เดียวกับ stocktake.test.js: สมุดเดิมมีแถว GR สามรอบของ AAA หนึ่งรอบของ BBB */
  const FIFO = {
    skus: [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ'], ['BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ']],
    pos: ['9900000001', '9900000002', '9900000003'],
    locs: ['R1-01-01', 'A-01-01', 'R1-01-02'],
    days: ['2026-09-01', '2026-10-02', '2026-11-03'],
    rows: [
      [2, 0, 8, 0, -1, 0, 20, 0, 0, 2 + 8],
      [3, 0, 10, 1, -1, 0, 15, 0, 1, 2 + 8],
      [4, 0, 11, 2, -1, 0, 6, 0, 2, 2 + 8],
      [5, 1, 9, 1, -1, 2, 5, 0, 1, 2 + 8],
      [6, 0, 8, 0, 0, 1, 3, 1, 1, 1],
    ],
  };
  const PILES0 = [['A-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 3, 1]];
  const ln = (loc, sku, lot, po, final, src = 'รอบ 1') => ({
    loc, sku: `${sku}001`, long: `${sku}0000000001`, name: sku === 'AAA' ? 'ที่นอนสมมติ' : 'ท็อปเปอร์สมมติ', lot, po, final, src,
  });
  const LINES0 = [
    ln('A-01-01', 'AAA', '8', '9900000001', 5),
    ln('R1-01-01', 'AAA', '11', '9900000003', 2),
    ln('R1-01-01', 'AAA', '0', '0', 7),
    ln('R1-01-02', 'AAA', '10', '0', 2),
    ln('R1-01-02', 'BBB', '', '', 8),
    ln('A-01-01', 'BBB', '9', '9900000002', 0),
    ln('R1-01-02', 'AAA', '8', '9900000001', 1, 'สมุด'),
  ];

  it('ชีต ยอดตั้งต้น ของ openingBook → bk-open → ยอดทุกกองเท่าที่นับ · วันรับจาก GR · ไม่รู้ LOT/PO ลงเป็น 0', async () => {
    const res = S.openingRows({ lines: LINES0, fifo: FIFO, piles: PILES0, note: 'Stock Count Q4/26', name: 'หัวหน้าสมมติ' });
    const sheet = S.openingBook(res, { id: 'R-1', approvedBy: 'หัวหน้าสมมติ', note: 'Stock Count Q4/26', moves: [] })[0];
    expect(sheet.name).toBe('ยอดตั้งต้น');
    const p = C.openingFromSheet(sheet.aoa);
    expect(p.bad).toEqual([]);
    /* ที่ต้องได้: กองละแถวของ res.rows (LOT/PO ว่าง → 0 แถวซ้ำรวมกัน) */
    const want = {};
    res.rows.forEach((r) => {
      const k = [r[6], r[1], r[3] || '0', r[4] || '0'].join('|');
      want[k] = Math.round(((want[k] || 0) + r[7]) * 1000) / 1000;
    });
    expect(p.tot).toMatchObject({ piles: Object.keys(want).length, qty: 25, open: 1 });
    expect(p.tot.zero).toBe(res.rows.filter((r) => !r[3] || !r[4]).length);
    expect(p.tot.est).toBe(res.info.filter((i) => i.kind === 'est').length);
    const a01 = p.rows.find((r) => r[5] === 'A-01-01' && r[3] === '8');
    expect(a01).toEqual(['AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 'A-01-01', 5, 'เปิด', '2026-09-01', 'Q4/26']);

    const x = await both();
    const r = await x.head.post('bk-open', { batch: 'st-1', rows: p.rows });
    expect(r).toMatchObject({ doc: 'T2611-0001', rows: p.rows.length, qty: 25 });
    const got = {};
    Object.values(C.allPiles(x.head.local())).forEach((q) => { got[[q.loc, q.long, q.lot, q.po].join('|')] = q.qty; });
    expect(got).toEqual(want);
    /* Note ของแถวในสมุด: GR ของกองที่รู้วันรับ ไตรมาสของกองที่ไม่รู้ (ปีของ LOT ตามกติกาเดิม) */
    const notes = x.head.fifo();
    expect(notes.rows.length).toBe(p.rows.length);
    expect(x.head.local().docs[0].rows.find((y) => y[5] === 'A-01-01')[8]).toBe('ยอดยกมา T2611-0001 · GR 01-09-26');
  });

  it('วางจาก Excel (ข้อความล้วน ไม่มีหัวตาราง) ได้ · แถวผิดบอกเลขแถว · กองซ้ำรวม · ชิ้น 0 ข้าม · ไม่ใช่ชีตนี้บอกชัด', () => {
    const grid = B.gridOf([
      'AAA001\tAAA0000000001\tที่นอนสมมติ\t8\tP1\t\tA-01-01\t5\tรับ\tStock Count Q4/26 · GR 02-10-26\tเปิด\tหัวหน้าสมมติ',
      'AAA001\tAAA0000000001\tที่นอนสมมติ\t8\tP1\t\tA-01-01\t2\tรับ\tStock Count Q4/26 · GR 01-09-26\t\tหัวหน้าสมมติ',
      'BBB001\tBBB0000000001\tท็อปเปอร์สมมติ\t\t\t\tR1-01-02\t3\tรับ\tStock Count Q4/26\t\tหัวหน้าสมมติ',
      'CCC001\tCCC0000000001\tหมอนสมมติ\t1\tP9\t\tR1-01-03\t0\tรับ\tStock Count Q4/26\t\tหัวหน้าสมมติ',
      'DDD001\tDDD0000000001\tผ้าห่มสมมติ\t1\tP9\tA-09-09\tR1-01-04\t1\tเบิก\tStock Count Q4/26\t\tหัวหน้าสมมติ',
      '\t\tไม่มี SKU\t1\tP9\t\tR1-01-05\t1\tรับ\t\t\t',
      'EEE001\tEEE0000000001\tสมมติ\t1\tP9\t\tR1-01-06\t-1\tรับ\t\t\t',
    ].join('\n'));
    const p = C.openingFromSheet(grid);
    expect(p.rows).toEqual([
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', 'P1', 'A-01-01', 7, 'เปิด', '2026-09-01', 'Q4/26'],
      ['BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ', '0', '0', 'R1-01-02', 3, '', '', 'Q4/26'],
    ]);
    expect(p.tot).toMatchObject({ piles: 2, qty: 10, merged: 1, skipped: 1, zero: 1, noGr: 1, open: 1, skus: 2, locs: 2 });
    expect(p.bad.map((b) => [b.n, b.why])).toEqual([[5, 'ไม่ใช่แถวรับ (ยอดตั้งต้นต้องเป็นแถวรับเข้าโลเท่านั้น)'], [6, 'ไม่มี SKU'], [7, 'QTY ติดลบ']]);
    expect(C.openingFromSheet([['ออเดอร์', 'SKU', 'จำนวน'], ['1', 'AAA001', 2]]).error).toMatch(/^ไม่ใช่ชีต ยอดตั้งต้น/);
    expect(C.openingFromSheet([C.OPEN_SHEET]).error).toBe('ไม่มีแถวยอดในชีตนี้');
  });

  it('วันของโควตาตามเวลาแปซิฟิก มีเวลาออมแสง (มี.ค.–พ.ย. รีเซ็ต 14:00 ไทย นอกนั้น 15:00)', () => {
    const th = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    expect(C.pacificDay(Date.UTC(2026, 10, 10, 7, 59))).toBe('2026-11-09');
    expect(C.pacificDay(Date.UTC(2026, 10, 10, 8, 0))).toBe('2026-11-10');
    expect(th(C.pacificReset(Date.UTC(2026, 10, 10, 3, 0)))).toBe('2026-11-10 15:00');
    expect(th(C.pacificReset(Date.UTC(2026, 6, 1, 3, 0)))).toBe('2026-07-01 14:00');
  });
});

/* ── ขั้น 3: TRcloud ช่วงเปลี่ยนผ่าน สำรอง ──────────────────────────────── */

const mv3 = (over = {}) => Object.assign(['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด'], over);
const QA_MV = mv3({ 5: 'QA', 8: 'โอนย้าย QA', 9: '' });
const GR3 = ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', ''];
const ADJ3 = ['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', ''];
const ADJ_LINES = [{ loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 20, count: 18 }];
const stOf = (x, no) => Object.values(x.store.dump()).find((d) => d && d.no === no).trState;
const ok = (r) => { expect(r.error, JSON.stringify(r).slice(0, 200)).toBeUndefined(); return r; };

describe('WmsFire ขั้น 3: รอลง TRcloud', () => {
  async function ready() {
    const x = await both();
    await x.open();
    ok(await x.staff.post('bk-move', body('m-1', [mv3()])));                  // T2611-0002 ย้ายในคลัง
    ok(await x.staff.post('bk-move', body('m-2', [QA_MV])));                  // 0003 เข้า QA
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));                      // 0004 รับของ ไม่มีเลข
    ok(await x.staff.post('bk-gr', body('g-2', [[...GR3, 'GR6911-0001']])));  // 0005 รับของ มีเลข
    ok(await x.staff.post('bk-cut', cutBody('c-1', [saleLine('1', 1)])));     // 0006 ตัดขาย
    ok(await x.head.post('bk-adj', body('a-1', [ADJ3], { lines: ADJ_LINES }))); // 0007 ปรับยอด
    return x;
  }

  it('สถานะตอนบันทึก: ย้ายในคลัง/ขาย/ยอดยกมา ไม่ต้องลง · เข้า QA รับของไม่มีเลข ปรับยอด รอลง · มีเลขมาด้วย ลงแล้ว', async () => {
    const x = await ready();
    const nos = ['T2611-0001', 'T2611-0002', 'T2611-0003', 'T2611-0004', 'T2611-0005', 'T2611-0006', 'T2611-0007'];
    expect(nos.map((n) => stOf(x, n))).toEqual(['none', 'none', 'wait', 'wait', 'done', 'none', 'wait']);
    const r = ok(await x.staff.trList());
    expect(r.list.map((d) => [d.no, d.state, d.kind])).toEqual([
      ['T2611-0007', 'wait', 'file'], ['T2611-0005', 'done', 'number'], ['T2611-0004', 'wait', 'number'],
      ['T2611-0003', 'wait', 'file'], ['T2611-0002', 'none', 'file'],
    ]);
    const qa = r.list.find((d) => d.no === 'T2611-0003');
    expect(qa.wh.slice().sort()).toEqual([['AAA0000000001', 'WH-02', -1], ['AAA0000000001', 'WH-QA', 1]]);
    expect(r.list.find((d) => d.no === 'T2611-0005').tr).toBe('GR6911-0001');
    /* RIB อยู่คลัง WH-02 (แบบหน้านับสต๊อก) · QA IQA = WH-QA */
    expect(['QA', 'IQA-01', 'qa', 'RIB', 'QAX-1', 'A-01-01'].map(C.whOf)).toEqual(['WH-QA', 'WH-QA', 'WH-QA', 'WH-02', 'WH-02', 'WH-02']);
    expect(['QA', 'IQA-01', 'RIB', 'A-01-01'].map(C.whOf)).toEqual(['QA', 'IQA-01', 'RIB', 'A-01-01'].map(S.whOf));
  });

  it('ใส่เลข TRcloud: บันทึกครั้งละไม่เกิน 10 · ลงแล้วต้องมีเลข · เครื่องอื่นเห็นในรอบดึงถัดไป (tv + trAt) · ดูอย่างเดียวใส่ไม่ได้', async () => {
    const x = await ready();
    expect((await x.staff.trSave([{ no: 'T2611-0004', tr: '', state: 'done' }])).error).toMatch(/ลงแล้วต้องมีเลข TRcloud/);
    expect((await x.staff.trSave(Array.from({ length: 11 }, () => ({ no: 'T2611-0004', tr: 'x', state: 'done' })))).error).toMatch(/ไม่เกิน 10 เอกสาร/);
    expect((await x.staff.trSave([{ no: 'T2611-0006', tr: 'x', state: 'done' }])).error).toMatch(/ตัดขายไม่ต้องลง/);
    expect((await x.staff.trSave([{ no: 'T2611-9999', tr: 'x', state: 'done' }])).error).toMatch(/ไม่พบเลขที่นี้/);
    expect((await x.staff.trSave([{ no: 'T2611-0004', tr: 'x', state: 'ลงแล้ว' }])).error).toMatch(/สถานะต้องเป็น/);
    expect((await (await x.device(VIEW_EMAIL)).trSave([{ no: 'T2611-0004', tr: 'x', state: 'done' }])).error).toMatch(/ดูได้อย่างเดียว/);
    expect(x.store.dump()['meta/head'].tv || 0).toBe(0);

    await x.head.trList();   // เครื่องหัวหน้ามีสำเนาก่อนใส่เลข
    x.tick(60000);
    const r = ok(await x.staff.trSave([{ no: 'T2611-0004', tr: 'GR6911-0002', state: 'done' }, { no: 'T2611-0002', tr: '', state: 'wait' }]));
    expect(r.saved).toBe(2);
    expect(r.states['T2611-0004']).toBe('done');
    const d4 = Object.values(x.store.dump()).find((d) => d && d.no === 'T2611-0004');
    expect(d4).toMatchObject({ tr: 'GR6911-0002', trState: 'done', trBy: STAFF_EMAIL, trAt: NOW + 60000 });
    expect(x.store.dump()['meta/head'].tv).toBe(1);
    const h = ok(await x.head.trList());
    expect(h.list.find((d) => d.no === 'T2611-0004')).toMatchObject({ state: 'done', tr: 'GR6911-0002', trBy: STAFF_EMAIL });
    expect(h.list.find((d) => d.no === 'T2611-0002').state).toBe('wait');
    /* เครื่องใหม่ได้สถานะจากเอกสารที่ดึงมาเลย */
    const v = ok(await (await x.device(VIEW_EMAIL)).trList());
    expect(v.list.find((d) => d.no === 'T2611-0004').tr).toBe('GR6911-0002');

    /* Rules: tv / ov เพิ่มทีละ 1 เท่านั้น ทีละตัว */
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    const m = x.store.dump()['meta/head'];
    await expect(x.store.commit([['meta/head', { ...m, tv: 5 }]])).rejects.toThrow(/tv ต้องเพิ่มทีละ 1/);
    await expect(x.store.commit([['meta/head', { ...m, tv: 2 }]])).resolves.toBeUndefined();
    await expect(x.store.commit([['meta/head', { ...m, tv: 2, ov: 3 }]])).rejects.toThrow(/ov ต้องเพิ่มทีละ 1/);
    await expect(x.store.commit([['meta/head', { ...m, tv: 3, ov: 1 }]])).rejects.toThrow(/เฉพาะตอนบันทึกเอกสาร/);
    await expect(x.store.commit([['meta/head', { ...m, tv: 2, ov: 1 }]])).resolves.toBeUndefined();
  });

  it('ยกเลิก: ก่อนลง TRcloud ไม่ต้องลงทั้งคู่ · หลังลงแล้ว เอกสารกลับรายการรอลง (ชนิดเดียวกับเอกสารเดิม)', async () => {
    const x = await ready();
    ok(await x.head.post('bk-void', { doc: 'T2611-0007', why: 'นับผิด' }));       // 0008 ปรับยอดยังไม่ลง
    ok(await x.head.post('bk-void', { doc: 'T2611-0005', why: 'รับผิด PO' }));    // 0009 รับของลงแล้ว
    ok(await x.head.okSave(['T2611-0003'], 'both'));                              // ใบเข้า QA ใส่เลขได้หลังรับและอนุมัติ
    ok(await x.staff.trSave([{ no: 'T2611-0003', tr: 'ADJ-0003', state: 'done' }]));
    ok(await x.head.post('bk-void', { doc: 'T2611-0003', why: 'ย้ายผิด' }));       // 0010 เข้า QA ลงแล้ว
    const r = ok(await x.staff.trList());
    const row = (no) => r.list.find((d) => d.no === no);
    expect(['T2611-0007', 'T2611-0008'].map((n) => row(n).state)).toEqual(['none', 'none']);
    expect(row('T2611-0007')).toMatchObject({ voided: true, link: 'T2611-0008' });
    expect([row('T2611-0005').state, row('T2611-0009').state, row('T2611-0009').kind]).toEqual(['done', 'wait', 'number']);
    expect([row('T2611-0003').state, row('T2611-0010').state, row('T2611-0010').kind, row('T2611-0010').link]).toEqual(['done', 'wait', 'file', 'T2611-0003']);
    /* เอกสารกลับรายการ: ไฟล์ปรับยอดกลับเครื่องหมาย */
    const f = x.staff.trFile(['T2611-0010']);
    expect(f.aoa.slice(1).sort()).toEqual([
      ['AAA0000000001', '2026-11-10', '', 1, '', '', 'T2611-0010', 'IV', 'WH-QA', ''],
      ['AAA0000000001', '2026-11-10', 1, '', '', '', 'T2611-0010', 'IV', 'WH-02', ''],
    ]);
    /* ใส่เลขให้กลับรายการ / กดไม่ต้องลงเองได้ */
    ok(await x.staff.trSave([{ no: 'T2611-0009', tr: 'GR6911-0001-R', state: 'done' }, { no: 'T2611-0010', tr: '', state: 'none' }]));
    const r2 = ok(await x.head.trList());
    expect(['T2611-0009', 'T2611-0010'].map((n) => r2.list.find((d) => d.no === n).state)).toEqual(['done', 'none']);
  });

  it('ไฟล์ปรับยอดลง TRcloud: หัวตารางตรงกับไฟล์ของหน้าเช็คตัดสต๊อกและหน้านับสต๊อก · แถวละ SKU + คลัง · เอกสารที่ต้องใส่เลขไม่อยู่ในไฟล์', async () => {
    const x = await ready();
    expect(TR.TRC_HEAD).toEqual(S.TRC_HEAD);
    const line = (src) => /var TRC_HEAD = (\[[^\]]+\]);/.exec(src)[1];
    expect(line(read('wms-cut.js'))).toBe(line(read('wms-fire-trc.js')));
    await x.staff.trList();   // หน้ารอลงดึงของใหม่ก่อน (ปรับยอดของหัวหน้า) ไฟล์คิดจากสำเนาในเครื่อง
    /* ใบย้ายเข้า QA ที่ยังไม่อนุมัติ: ยอดในสมุดเปลี่ยนแล้ว แต่ยังไม่ลงไฟล์ปรับยอด (ปุ่มติ๊กล็อก) */
    expect((await x.staff.trList()).list.find((d) => d.no === 'T2611-0003').ok).toBe('check');
    const h = x.staff.trFile(['T2611-0003', 'T2611-0007']);
    expect([h.docs, h.hold]).toEqual([['T2611-0007'], ['T2611-0003']]);
    ok(await x.head.okSave(['T2611-0003'], 'both'));   // staff ทำ หัวหน้าตรวจ + อนุมัติ
    expect((await x.staff.trList()).list.find((d) => d.no === 'T2611-0003').ok).toBe('done');
    const f = x.staff.trFile(['T2611-0003', 'T2611-0007', 'T2611-0004', 'T2611-0002', 'T2611-0099']);
    expect(f.aoa[0]).toEqual(S.TRC_HEAD);
    expect(f.aoa.slice(1)).toEqual([
      ...x.staff.trFile(['T2611-0003']).aoa.slice(1),
      ['AAA0000000001', '2026-11-10', '', 2, '', '', 'T2611-0007', 'IV', 'WH-02', ''],
    ]);
    expect(f.aoa.slice(1, 3).map((r) => [r[2], r[3], r[8]]).sort()).toEqual([['', 1, 'WH-02'], [1, '', 'WH-QA']]);
    expect(f.docs).toEqual(['T2611-0003', 'T2611-0007']);
    expect(f.skip).toEqual(['T2611-0004', 'T2611-0002']);   // รับของ = ใส่เลข · ย้ายในคลังไม่เปลี่ยนคลัง
    expect(f.hold).toEqual([]);
    expect(f.widths).toHaveLength(10);
  });
});

describe('WmsFire ขั้น 3: นำเข้ายอด TRcloud ตารางหลัก กระทบยอด', () => {
  const STOCK = [
    ['รายงานสินค้าคงเหลือ (ข้อมูลสมมติ)'],
    [],
    ['รหัสสินค้า', 'ชื่อสินค้า', 'NEW WH', 'QA', 'รวม'],
    ['AAA0000000001', 'ที่นอนสมมติ 1', '34', 0, 34],
    ['BBB0000000001', 'ท็อปเปอร์สมมติ 1', 4, 0, 4],
    ['CCC0000000004', 'หมอนสมมติ 4', 0, 3, 3],
    ['ZZZ0000000009', 'ของสมมติ 9', 2, '', 2],
    ['AAA0000000001', '', '1', '', ''],
  ];
  const LOSS = [['SKU', 'ชื่อ', 'WH-Loss'], ['AAA0000000001', 'ที่นอนสมมติ 1', 2], ['AAA0000000001', '', 1]];
  const COST = [['รหัสสินค้า', 'ราคาทุน'], ['AAA0000000001', '1,500'], ['BBB0000000001', 800], ['ZZZ0000000009', 100]];
  const SUP = [['Truck', 'PO.'], ['ผู้ผลิตสมมติ ก', 'P1'], ['ผู้ผลิตสมมติ ข', 'p 5'], ['ผู้ผลิตสมมติ ค', 'P1'], ['', 'P7']];
  const CONV = [['SKU ตอนซื้อ', 'SKU หลังแปลง'], ['BBB0000000001', 'BBB0000000002'], ['', 'XXX0000000001'], ['AAA0000000001', 'AAA0000000001']];
  const FILES = [{ name: 'Stock', grid: STOCK }, { name: 'WH-Loss', grid: LOSS }, { name: 'ราคาทุน', grid: COST }, { name: 'Sheet9', grid: [['อื่น ๆ']] }];

  it('อ่านไฟล์: หัวตารางไม่อยู่แถวแรกได้ · SKU ซ้ำรวม · ผลเท่าที่หน้านับสต๊อกอ่าน (trcParse) · ชีตที่ไม่รู้จักข้าม · ไม่มี NEW WH บอกชัด', () => {
    const p = TR.readSheets(FILES);
    expect(p.tabs).toEqual({ stock: 'Stock', loss: 'WH-Loss', cost: 'ราคาทุน' });
    expect(p.skipped).toEqual(['Sheet9']);
    expect(p.stock.list).toEqual([
      ['AAA0000000001', 'ที่นอนสมมติ 1', 35, 0], ['BBB0000000001', 'ท็อปเปอร์สมมติ 1', 4, 0], ['CCC0000000004', 'หมอนสมมติ 4', 0, 3], ['ZZZ0000000009', 'ของสมมติ 9', 2, 0],
    ]);
    expect(p.loss.list).toEqual([['AAA0000000001', 3]]);
    expect(p.cost.list).toEqual([['AAA0000000001', 1500], ['BBB0000000001', 800], ['ZZZ0000000009', 100]]);
    /* หน้านับสต๊อกอ่านไฟล์เดียวกันผ่าน stock-api.gs (แถวเป็นวัตถุตามหัวตาราง) ต้องได้ยอดเท่ากัน */
    const objs = (grid) => { const t = TR.tabRows(grid); return t.rows.map((r) => Object.fromEntries(t.head.map((h, j) => [h, r[j] === undefined ? '' : r[j]]))); };
    const old = S.trcParse({ v: 3, at: 1, stock: objs(STOCK), loss: objs(LOSS), cost: objs(COST), tabs: {} });
    const mine = TR.trcIn(TR.trcDoc(p, { day: '2026-11-10', by: HEAD_EMAIL, name: 'หัวหน้าทดลอง', files: 'สมมติ.xlsx' }).data);
    expect(mine.stock).toEqual(old.stock);
    expect(mine.loss).toEqual(old.loss);
    expect(mine.cost).toEqual(old.cost);
    expect(TR.readSheets([{ name: 'Stock', grid: [['SKU', 'จำนวน'], ['A', 1]] }])).toMatchObject({ error: expect.stringMatching(/NEW WH/) });
    expect(TR.readSheets([{ name: 'อื่น', grid: [['ก', 'ข']] }]).error).toMatch(/ไม่เจอชีต Stock/);
    expect(TR.trcDoc(p, { day: '10/11/2026' }).error).toMatch(/yyyy-mm-dd/);
    expect(TR.trcDoc({ ...p, stock: null }, { day: '2026-11-10' }).error).toMatch(/ไม่มีชีต Stock/);
  });

  it('PO. Truck → Supplier กับ MASTER แปลงสินค้า: แบบ tx-api.gs · หัวหน้านำเข้า ทุกเครื่องได้ใน fifo()', async () => {
    const x = await both();
    await x.open();
    const p = TR.readSheets([{ name: 'PO. Truck', grid: SUP }, { name: 'MASTER แปลงสินค้า', grid: CONV }]);
    expect(p.sup).toMatchObject({ rows: [['P1', 'ผู้ผลิตสมมติ ก'], ['P5', 'ผู้ผลิตสมมติ ข']], dup: ['P1'] });
    expect(p.conv).toMatchObject({ pairs: [['BBB0000000002', 'BBB0000000001']], blank: 1 });
    expect((await x.staff.masterSave('sup', p.sup)).error).toMatch(/เฉพาะหัวหน้า/);
    ok(await x.head.masterSave('sup', p.sup));
    ok(await x.head.masterSave('conv', p.conv));
    expect(x.store.dump()['meta/head'].mv).toBe(2);
    await x.staff.sync();
    const f = x.staff.fifo();
    expect(f.sup.rows).toEqual([['P1', 'ผู้ผลิตสมมติ ก'], ['P5', 'ผู้ผลิตสมมติ ข']]);
    expect(f.convert.pairs).toEqual([['BBB0000000002', 'BBB0000000001', '']]);
    expect(x.staff.masters()).toMatchObject({ sup: { n: 2, tab: 'PO. Truck', dup: 1 }, conv: { n: 1, blank: 1 } });
  });

  it('ความจุต่อพาเลท: ชื่อชีตหรือหัวตาราง · ช่องว่างนับไว้ · หัวหน้านำเข้า ทุกเครื่องได้ใน fifo() · หน้า สินค้า / โล เห็นความจุ', async () => {
    const CAP = [['ตารางความจุ (สมมติ)'], ['SKU', 'Product ID', 'STD / pallet'], ['AAA001', 'AAA0000000001', 10], ['BBB002', '', ''], ['', 'CCC0000000004', 0], ['AAA001', 'AAA0000000001', 12]];
    const p = TR.readSheets([{ name: 'ความจุต่อพาเลท', grid: CAP }]);
    expect(p.cap).toMatchObject({ rows: [['AAA001', 'AAA0000000001', 10], ['', 'CCC0000000004', 0]], blank: 1, cols: ['SKU', 'Product ID', 'STD / pallet'], tab: 'ความจุต่อพาเลท' });
    expect(TR.readSheets([{ name: 'Sheet1', grid: CAP.slice(1) }]).cap.rows).toHaveLength(2);           // ชื่อชีตอื่น ดูจากหัวตาราง
    expect(TR.readSheets([{ name: 'ความจุต่อพาเลท', grid: [['SKU', 'จำนวน']] }]).error).toMatch(/STD \/ pallet/);
    expect(TR.masterDoc('cap', null, {}).error).toMatch(/ความจุต่อพาเลท/);
    const x = await both();
    await x.open();
    expect((await x.staff.masterSave('cap', p.cap)).error).toMatch(/เฉพาะหัวหน้า/);
    ok(await x.head.masterSave('cap', p.cap));
    await x.staff.sync();
    const f = x.staff.fifo();
    expect(f.cap.rows).toEqual([['AAA001', 'AAA0000000001', 10], ['', 'CCC0000000004', 0]]);
    expect(x.staff.masters()).toMatchObject({ cap: { n: 2, tab: 'ความจุต่อพาเลท', blank: 1 } });
    const st = B.stock(f), ix = IT.index(st, '2026-11-10');
    expect(IT.detail(ix, f, st, 'AAA001')).toMatchObject({ cap: 10, pallets: 3.6 });
    expect(IT.detail(ix, f, st, 'CCC004')).toMatchObject({ cap: 0, pallets: null });
    expect(IT.detail(ix, f, st, 'BBB002').cap).toBeNull();
  });

  it('กระทบยอด: ยอดระบบ ณ สิ้นวันของไฟล์ · จับคู่ SKU แปลง · ตรง ต่าง ไม่มีใน TRcloud TRcloud มีระบบไม่มี · มูลค่าต่าง · เอกสารรอลง', async () => {
    const x = await both();
    await x.open();
    const p = TR.readSheets(FILES);
    ok(await x.head.masterSave('conv', TR.readSheets([{ name: 'MASTER แปลงสินค้า', grid: CONV }]).conv));
    ok(await x.staff.post('bk-gr', body('g-1', [['DDD005', 'DDD0000000005', '11', 'P8', '', 'R01-03-01', 3, 'รับ', 'GR 10-11-26', '']])));   // รอลง
    x.tick(DAY);
    ok(await x.staff.post('bk-gr', body('g-2', [GR3], { date: '2026-11-11' })));   // หลังวันของไฟล์ ไม่นับ
    expect((await x.staff.trcSave(p, '2026-11-10', 'สมมติ.xlsx')).error).toMatch(/เฉพาะหัวหน้า/);
    const s = ok(await x.head.trcSave(p, '2026-11-10', 'สมมติ.xlsx'));
    expect(s).toMatchObject({ saved: '2026-11-10', n: 4 });
    expect(x.store.dump()['meta/head'].trc).toBe('2026-11-10#1');
    ok(await x.head.trcSave(p, '2026-11-10', 'สมมติ.xlsx'));
    expect(x.store.dump()['meta/head'].trc).toBe('2026-11-10#2');

    const r = ok(await x.staff.trc());
    expect(r.trc).toMatchObject({ day: '2026-11-10', name: 'หัวหน้าทดลอง', files: 'สมมติ.xlsx', n: 4 });
    const by = Object.fromEntries(r.cmp.items.map((i) => [i.sku, i]));
    /* AAA: ระบบ 36 (20 + 10 + 6) TRcloud 35 */
    expect(by.AAA0000000001).toMatchObject({ group: 'diff', s02: 36, t02: 35, d02: 1, loss: 3, cost: 1500, value: 1500, wait: 1 });   // g-2 รอลง (หลังวันของไฟล์ แต่ยังรอ)
    expect(by.BBB0000000001).toMatchObject({ group: 'ok', s02: 4, t02: 4, conv: ['BBB0000000002'] });
    expect(by.CCC0000000004).toMatchObject({ group: 'ok', sqa: 3, tqa: 3 });
    expect(by.ZZZ0000000009).toMatchObject({ group: 'nosys', t02: 2, value: -200 });
    expect(by.DDD0000000005).toMatchObject({ group: 'notrc', s02: 3, wait: 1, cost: null });
    expect(r.cmp.items.map((i) => i.group)).toEqual(['diff', 'nosys', 'notrc', 'ok', 'ok']);
    expect(r.cmp.tot).toMatchObject({ skus: 5, ok: 2, diff: 1, notrc: 1, nosys: 1, value: 1300, noCost: 1 });
    const book = TR.trcBook(r.cmp, r.trc);
    expect(book.map((b) => b.name)).toEqual(['เทียบราย SKU', 'สรุป']);
    expect(book[0].aoa).toHaveLength(6);

    /* Rules: trc เขียนได้เฉพาะหัวหน้า · meta.trc หัวหน้าเท่านั้น */
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    await expect(x.store.commit([['trc/2026-11-11', { v: 1 }]])).rejects.toThrow(/เขียน trc ได้เฉพาะหัวหน้า/);
  });

  it('รหัสที่มีอักษรไทย (ของใช้ภายใน) TRcloud ไม่มี = ไม่เทียบ', async () => {
    const x = await both();
    await x.open();
    const local = JSON.parse(JSON.stringify(x.head.local()));
    local.docs.push({ ...local.docs[0], id: 'z', no: 'T2611-0099', seq: 99, row: 99, type: 'ตารางเดิม', date: '2026-11-10',
      rows: [['ถุงมือ', 'ถุงมือ', '0', '0', '', 'A-09-09', 5, 'รับ', 'ของใช้', '', '']] });
    const trc = TR.trcIn(TR.trcDoc(TR.readSheets(FILES), { day: '2026-11-10' }).data);
    const res = TR.trcCompare(local, trc, NOW);
    expect(res.tot.internal).toBe(1);
    expect(res.items.find((i) => /ถุงมือ/.test(i.sku))).toBeUndefined();
  });
});

describe('WmsFire ขั้น 3: วางแถวลงชีต Transaction เดิม (ช่วงเปลี่ยนผ่าน)', () => {
  it('วันละครั้ง: แถวตามลำดับที่บันทึกรูปเดียวกับ WmsBook.tsv · ยอดยกมาไม่ต้องวาง · วางแล้วมีเพิ่มคัดลอกเฉพาะส่วนที่เพิ่ม', async () => {
    const x = await both();
    await x.open();
    ok(await x.staff.post('bk-move', body('m-1', [mv3()])));
    ok(await x.staff.post('bk-move', body('m-2', [QA_MV, mv3({ 4: 'A-01-01', 5: 'QA', 6: 2, 8: 'โอนย้าย QA', 9: '' })])));
    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-3', [mv3({ 6: 3 })])));
    const d1 = ok(await x.staff.xferDays()).days;
    expect(d1.map((d) => [d.day, d.docs, d.rows, d.first, d.last, d.done, d.more])).toEqual([
      ['2026-11-11', 1, 1, 'T2611-0004', 'T2611-0004', null, false],
      ['2026-11-10', 2, 3, 'T2611-0002', 'T2611-0003', null, false],
    ]);
    const t = x.staff.xferText('2026-11-10');
    const docs = x.staff.local().docs.filter((d) => d.no === 'T2611-0002' || d.no === 'T2611-0003');
    expect(t).toMatchObject({ docs: 2, rows: 3, last: 'T2611-0003' });
    expect(t.text).toBe(docs.map((d) => B.tsv(d.rows, 'ทดลอง', d.no)).join('\n'));
    const cols = t.text.split('\n').map((l) => l.split('\t'));
    expect(cols.every((c) => c.length === 14 && c[12] === 'ทดลอง')).toBe(true);
    expect(cols.map((c) => [c[0], c[5], c[6], c[7], c[13]])).toEqual([
      ['AAA001', 'R01-01-01', 'A-01-01', '1', 'T2611-0002'], ['AAA001', 'R01-01-01', 'QA', '1', 'T2611-0003'], ['AAA001', 'A-01-01', 'QA', '2', 'T2611-0003'],
    ]);

    /* เลข TRcloud ที่ใส่ทีหลังในหน้ารอลง ลงคอลัมน์ N แทนเลขที่ (แถวที่มีเลขของตัวเองใช้เลขของแถว) */
    ok(await x.head.okSave(['T2611-0003'], 'both'));
    ok(await x.staff.trSave([{ no: 'T2611-0003', tr: 'ADJ-9', state: 'done' }]));
    expect(x.staff.xferText('2026-11-10').text.split('\n').map((l) => l.split('\t')[13])).toEqual(['T2611-0002', 'ADJ-9', 'ADJ-9']);
    ok(await x.staff.xferMark('2026-11-10', { rows: 3, last: 'T2611-0003' }));
    ok(await x.staff.xferMark('2026-11-11', { rows: 1, last: 'T2611-0004' }));
    ok(await x.staff.post('bk-move', body('m-4', [mv3({ 6: 4 })])));
    const d2 = ok(await x.head.xferDays()).days;
    expect(d2[0]).toMatchObject({ day: '2026-11-11', docs: 2, last: 'T2611-0005', more: true, done: { by: 'ทดลอง', n: 1, last: 'T2611-0004' } });
    expect(d2[1]).toMatchObject({ day: '2026-11-10', more: false, done: { by: 'ทดลอง', n: 3 } });
    const more = x.head.xferText('2026-11-11', 'T2611-0004');
    expect(more).toMatchObject({ docs: 1, rows: 1, last: 'T2611-0005' });
    expect(more.text.split('\t')[13]).toBe('T2611-0005');

    expect((await (await x.device(VIEW_EMAIL)).xferMark('2026-11-11', { rows: 1 })).error).toMatch(/ดูได้อย่างเดียว/);
    expect((await x.staff.xferMark('11/11/2026', { rows: 1 })).error).toMatch(/yyyy-mm-dd/);
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    await expect(x.store.patch('xfer/log', { '2026-11-12': { n: 1 }, '2026-11-13': { n: 1 } })).rejects.toThrow(/ครั้งละวัน/);
    await expect(x.store.patch('xfer/other', { '2026-11-12': { n: 1 } })).rejects.toThrow(/ครั้งละวัน/);
  });
});

/* Firestore REST จำลอง (ไม่ต่อเน็ต) สำหรับ apps-script/fire-backup.gs */
const TIME3 = ['at', 'trAt', 'last', 'ckAt', 'apAt', 'okAt'];   // = TIME_KEYS ของ fire-backup.gs
function toRest(v, key) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (key && TIME3.includes(key)) return { timestampValue: new Date(v).toISOString().replace('Z', '456Z') };   // ไมโครวินาทีแบบ Firestore
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((y) => toRest(y)) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, y]) => [k, toRest(y)])) } };
}
function fromRest(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue.replace(/(\.\d{3})\d+/, '$1'));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromRest);
  return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, y]) => [k, fromRest(y)]));
}
const restDoc = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toRest(v, k)]));
const plainDoc = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromRest(v)]));
const noUse = (dump) => Object.fromEntries(Object.entries(dump).filter(([p]) => !p.startsWith('use/')));

function fakeGcp() {
  const projects = {}, calls = [];
  const proj = (id) => projects[id] || (projects[id] = {});
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function fetch(url, opt) {
    const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents(.*)$/.exec(url);
    if (!m) throw new Error('ห้ามเรียก ' + url);
    const [, p, rest] = m;
    if (opt.headers.Authorization !== 'Bearer token-ทดลอง' || opt.headers['X-Goog-User-Project'] !== p) return resp(403, { error: 'auth' });
    calls.push([opt.method, p, rest]);
    const db = proj(p), name = (path) => `projects/${p}/databases/(default)/documents/${path}`;
    if (rest === ':commit') {
      JSON.parse(opt.payload).writes.forEach((w) => { db[w.update.name.split('/documents/')[1]] = w.update.fields; });
      return resp(200, { commitTime: 'x' });
    }
    if (rest === ':runQuery') {
      const q = JSON.parse(opt.payload).structuredQuery, coll = q.from[0].collectionId;
      let list = Object.keys(db).filter((k) => k.split('/')[0] === coll).map((k) => ({ path: k, f: db[k] }));
      const f = q.where && q.where.fieldFilter, field = f ? f.field.fieldPath : '';
      if (f) {
        const want = fromRest(f.value);
        list = list.filter((d) => d.f[field] && (f.op === 'GREATER_THAN' ? fromRest(d.f[field]) > want : fromRest(d.f[field]) >= want));
        list.sort((a, b) => cmp(fromRest(a.f[field]), fromRest(b.f[field])) || cmp(name(a.path), name(b.path)));
      } else list.sort((a, b) => cmp(a.path, b.path));
      if (q.startAt) {
        const [cv, cr] = q.startAt.values, c = fromRest(cv);
        list = list.filter((d) => { const v = fromRest(d.f[field]); return v > c || (v === c && name(d.path) > cr.referenceValue); });
      }
      list = list.slice(0, q.limit || list.length);
      return resp(200, list.length ? list.map((d) => ({ document: { name: name(d.path), fields: d.f }, readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    const lm = /^\/([^/?]+)\?pageSize=(\d+)(?:&pageToken=(\d+))?$/.exec(rest);
    if (lm) {
      const all = Object.keys(db).filter((k) => k.split('/')[0] === lm[1]).sort(), from = +(lm[3] || 0), size = +lm[2];
      const page = all.slice(from, from + size);
      const out = { documents: page.map((k) => ({ name: name(k), fields: db[k] })) };
      if (from + size < all.length) out.nextPageToken = String(from + size);
      return resp(200, page.length ? out : {});
    }
    const path = rest.slice(1).split('/').map(decodeURIComponent).join('/');
    return db[path] ? resp(200, { name: name(path), fields: db[path] }) : resp(404, { error: { code: 404 } });
  }
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const folders = [];
  let n = 0;
  const mkFolder = (fname) => {
    const f = { id: 'folder' + ++n, name: fname, files: [] };
    Object.assign(f, {
      getId: () => f.id, isTrashed: () => false, getFiles: () => iter(f.files.slice()),
      createFile: (name, content) => { const file = { id: 'file' + ++n, name, content, getId: () => file.id, getName: () => file.name, getBlob: () => ({ getDataAsString: () => file.content }) }; f.files.push(file); return file; },
    });
    folders.push(f);
    return f;
  };
  const props = {}, triggers = [], logs = [];
  const env = {
    UrlFetchApp: { fetch },
    ScriptApp: {
      getOAuthToken: () => 'token-ทดลอง',
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (h) => { const t = { h, getHandlerFunction: () => h }; const c = { timeBased: () => c, atHour: (x) => { t.hour = x; return c; }, everyDays: (x) => { t.days = x; return c; }, create: () => { triggers.push(t); return t; } }; return c; },
    },
    DriveApp: {
      getFolderById: (id) => { const f = folders.find((x) => x.id === id); if (!f) throw new Error('ไม่มีโฟลเดอร์'); return f; },
      getFoldersByName: (fname) => iter(folders.filter((f) => f.name === fname)),
      createFolder: mkFolder,
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
    Utilities: { formatDate: (d, tz, fmt) => { expect([tz, fmt]).toEqual(['Asia/Bangkok', 'yyyy-MM-dd-HHmm']); const s = new Date(d.getTime() + 7 * 3600000).toISOString(); return s.slice(0, 10) + '-' + s.slice(11, 13) + s.slice(14, 16); } },
    Logger: { log: (s) => logs.push(String(s)) },
  };
  const GS = fs.readFileSync(path.resolve(__dirname, '../../apps-script/fire-backup.gs'), 'utf8');
  const load = (over = {}) => {
    let src = GS.replace("var FIREBASE_PROJECT_ID = '';", "var FIREBASE_PROJECT_ID = 'demo-src';");
    Object.entries(over).forEach(([k, v]) => { src = src.replace(new RegExp(`var ${k} = [^;]+;`), `var ${k} = ${v};`); });
    return new Function(...Object.keys(env), `${src}\nreturn { installBackup, stopBackup, backupNightly, backupFull, restoreAll };`)(...Object.values(env));
  };
  return {
    GS, env, load, projects, calls, folders, props, triggers, logs,
    /** ใส่ข้อมูลของ memStore ลงโปรเจกต์ demo-src แบบที่ Firestore เก็บ (เวลาเป็น timestamp) */
    mirror: (dump) => { projects['demo-src'] = Object.fromEntries(Object.entries(noUse(dump)).map(([p, d]) => [p, restDoc(d)])); },
    files: () => (folders[0] ? folders[0].files.map((f) => ({ name: f.name, b: JSON.parse(f.content) })) : []),
    plain: (id) => Object.fromEntries(Object.entries(projects[id] || {}).map(([p, f]) => [p, plainDoc(f)])),
  };
}

describe('WmsFire ขั้น 3: สำรองและกู้คืน', () => {
  /** ข้อมูลทดลองครบทุกคอลเลกชัน: เอกสารแยกส่วน เลข TRcloud ยอด TRcloud ตารางหลัก ชีตเดิม */
  async function filled() {
    const x = await both({ partBytes: 3000 });
    await x.open();
    ok(await x.staff.post('bk-cut', cutBody('big', Array.from({ length: 40 }, (_, i) => saleLine(String(5000 + i), 0.25)))));
    ok(await x.staff.post('bk-move', body('m-1', [QA_MV])));
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));
    ok(await x.staff.trSave([{ no: 'T2611-0004', tr: 'GR6911-0005', state: 'done' }]));
    ok(await x.head.trcSave(TR.readSheets([{ name: 'Stock', grid: [['SKU', 'NEW WH', 'QA'], ['AAA0000000001', 30, 1]] }]), '2026-11-10', 'สมมติ.xlsx'));
    ok(await x.head.masterSave('sup', TR.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตสมมติ', 'P1']] }]).sup));
    ok(await x.staff.xferMark('2026-11-10', { rows: 2, last: 'T2611-0003' }));
    expect(Object.keys(x.store.dump()).filter((k) => /^docs\/big~\d$/.test(k)).length).toBeGreaterThan(0);
    return x;
  }
  /** ระบบที่กู้แล้วต้องได้ยอดทุกกอง fifo และหน้ารอลง TRcloud เท่าของเดิม */
  async function sameAfterRestore(x, data) {
    const s2 = W.memStore({ now: x.clock, domain: DOMAIN });
    s2.replace(data);
    const f = W.open({ store: s2.connect(), auth: W.fakeAuth(ACCOUNTS), now: x.clock });
    ok(await f.login(HEAD_EMAIL));
    await f.sync();
    await x.head.sync();
    expect(C.allPiles(f.local())).toEqual(C.allPiles(x.head.local()));
    const a = f.fifo(), b = x.head.fifo();
    ['skus', 'pos', 'locs', 'days', 'rows', 'cgr', 'cq', 'sup'].forEach((k) => expect(a[k], k).toEqual(b[k]));
    expect((await f.trList()).list).toEqual((await x.head.trList()).list);
    expect((await f.trc()).cmp).toEqual((await x.head.trc()).cmp);
    expect((await f.post('bk-state', {})).open).toEqual((await x.head.post('bk-state', {})).open);
  }

  it('ไฟล์สำรองจากเครื่องหัวหน้า = ข้อมูลในฐานทุกช่อง (รวมส่วนแยก ~2) · กู้ลงฐานว่างได้ยอดเท่าเดิม · คนลงรายการดาวน์โหลดไม่ได้', async () => {
    const x = await filled();
    expect((await x.staff.backup()).error).toMatch(/เฉพาะหัวหน้า/);
    const r = ok(await x.head.backup());
    const chk = TR.readBackup(JSON.stringify(r.backup));
    expect(chk.error).toBeUndefined();
    const b = chk.backup;
    expect(b).toMatchObject({ kind: 'wms-fire-backup', v: 1, from: 'browser', made: NOW, docs: 4 });
    const want = noUse(x.store.dump());
    expect(Object.keys(b.data).sort()).toEqual(Object.keys(want).sort());
    Object.keys(want).forEach((p) => expect(b.data[p], p).toEqual(want[p]));
    await sameAfterRestore(x, b.data);
  });

  it('อ่านไฟล์สำรอง: ไม่ใช่ JSON · ไม่ใช่ไฟล์ของระบบ · ที่เก็บแปลก · ไม่มี meta/head · หลายไฟล์ไฟล์หลังทับไฟล์ก่อน', () => {
    expect(TR.readBackup('{oops').error).toBe('ไม่ใช่ไฟล์ JSON');
    expect(TR.readBackup({ kind: 'อื่น', v: 1, data: {} }).error).toMatch(/ไม่ใช่ไฟล์สำรอง/);
    expect(TR.readBackup({ kind: 'wms-fire-backup', v: 1, data: { 'meta/head': {}, 'use/2026-11-10': {} } }).error).toMatch(/ที่เก็บที่ไม่รู้จัก use\/2026-11-10/);
    expect(TR.readBackup({ kind: 'wms-fire-backup', v: 1, data: { 'docs/a': {} } }).error).toMatch(/ไม่มี meta\/head/);
    const merged = TR.mergeBackups([{ made: 2, data: { 'docs/a': { tr: 'ใหม่' } } }, { made: 1, data: { 'docs/a': { tr: '' }, 'docs/b': { n: 1 } } }]);
    expect(merged).toEqual({ 'docs/a': { tr: 'ใหม่' }, 'docs/b': { n: 1 } });
  });

  it('fire-backup.gs: คืนแรกทั้งหมด = ไฟล์จากเครื่อง · คืนถัดไปเฉพาะของใหม่และเลข TRcloud ที่เปลี่ยน · ตั้งเวลาตี 2 · ไม่มีชีต', async () => {
    const x = await filled();
    const g = fakeGcp();
    expect(g.GS).toContain("var FIREBASE_PROJECT_ID = '';");
    expect(g.GS).toContain("var RESTORE_PROJECT_ID = '';");
    expect(g.GS).not.toMatch(/SpreadsheetApp|getActiveSpreadsheet|openById|openByUrl/);
    expect(g.GS.match(/https:\/\/[^'"\s)]+/g).filter((u) => !u.startsWith('https://firestore.googleapis.com/v1/') && !u.startsWith('https://www.googleapis.com/auth/'))).toEqual([]);
    expect(() => new Function(...Object.keys(g.env), `${g.GS}\nreturn backupNightly();`)(...Object.values(g.env))).toThrow(/ใส่ FIREBASE_PROJECT_ID ก่อน/);

    g.mirror(x.store.dump());
    const gs = g.load();
    g.triggers.push({ h: 'backupNightly', getHandlerFunction: () => 'backupNightly' });   // ตั้งไว้แล้วรอบก่อน: ไม่ซ้อน
    const r1 = gs.installBackup();
    expect(g.triggers.map((t) => [t.h, t.hour, t.days])).toEqual([['backupNightly', 2, 1]]);
    expect(g.folders.map((f) => f.name)).toEqual(['WMS ระบบใหม่ สำรอง']);
    const [f1] = g.files();
    expect(f1.name).toMatch(/^wms-fire-backup-\d{4}-\d{2}-\d{2}-\d{4}-full\.json$/);
    expect(f1.b).toMatchObject({ kind: 'wms-fire-backup', v: 1, from: 'full', since: 0, more: false, docs: 4 });
    expect(TR.readBackup(f1.b).error).toBeUndefined();
    expect(r1).toMatchObject({ docs: 4, more: false });
    const browser = ok(await x.head.backup()).backup.data;
    expect(Object.keys(f1.b.data).sort()).toEqual(Object.keys(browser).sort());
    Object.keys(browser).forEach((p) => expect(f1.b.data[p], p).toEqual(browser[p]));

    /* วันถัดไป: เอกสารใหม่ 1 + ใส่เลข TRcloud ให้เอกสารเก่า 1 */
    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-2', [mv3()])));
    ok(await x.head.okSave(['T2611-0003'], 'both'));
    ok(await x.staff.trSave([{ no: 'T2611-0003', tr: 'ADJ-1', state: 'done' }]));
    g.mirror(x.store.dump());
    const before = g.calls.length;
    const r2 = gs.backupNightly();
    expect(r2).toMatchObject({ docs: 1, more: false });
    const f2 = g.files()[1];
    expect(f2.name).not.toMatch(/-full/);
    expect(f2.b.from).toBe('nightly');
    const docKeys = Object.keys(f2.b.data).filter((k) => k.startsWith('docs/')).sort();
    const id = (no) => Object.keys(x.store.dump()).find((k) => x.store.dump()[k].no === no);
    /* 0004 ใส่เลขไว้ก่อนคืนแรก อ่านซ้ำเพราะย้อน 10 นาทีกันพลาด (ทับด้วยค่าเดิม ไม่เสียหาย) */
    expect(docKeys).toEqual([id('T2611-0003'), id('T2611-0004'), id('T2611-0005')].sort());
    expect(f2.b.data[id('T2611-0003')]).toMatchObject({ tr: 'ADJ-1', trState: 'done', trBy: STAFF_EMAIL });
    expect(Object.keys(f2.b.data).filter((k) => !k.startsWith('docs/')).sort()).toEqual(
      ['meta/head', 'master/sup', 'trc/2026-11-10', 'xfer/log', ...Object.keys(USERS)].sort());
    expect(g.calls.length - before).toBeLessThan(12);   // ไม่กี่คำขอ ไม่อ่านเอกสารเก่าซ้ำ
    expect(g.logs.join('\n')).toMatch(/เอกสารใหม่ 1 ใบ/);
  });

  it('fire-backup.gs: ตรวจ / อนุมัติทีหลัง คืนถัดไปเก็บใบนั้น (ดึงตาม okAt จำไว้ที่ fb.ok) · กู้คืนได้ช่องตรวจ / อนุมัติเป็น timestamp', async () => {
    const x = await filled();
    const g = fakeGcp();
    expect(g.GS).toContain(`var TIME_KEYS = ${JSON.stringify(TR.TIME_KEYS).replace(/,/g, ', ').replace(/"/g, "'")};`);
    g.mirror(x.store.dump());
    const gs = g.load();
    gs.backupNightly();   // คืนแรก ทั้งหมด
    expect(g.props['fb.ok']).toBe('0');
    x.tick(DAY);
    ok(await x.head.okSave(['T2611-0003'], 'both'));   // ใบย้ายเข้า QA ของคนลงรายการ หัวหน้าตรวจ + อนุมัติ
    g.mirror(x.store.dump());
    expect(gs.backupNightly()).toMatchObject({ docs: 0, more: false });
    const f2 = g.files()[1];
    const id = Object.keys(x.store.dump()).find((k) => x.store.dump()[k].no === 'T2611-0003');
    expect(f2.b.data[id]).toMatchObject({ ck: HEAD_EMAIL, ckName: 'หัวหน้าทดลอง', ap: HEAD_EMAIL, ckAt: NOW + DAY, apAt: NOW + DAY, okAt: NOW + DAY });
    expect(+g.props['fb.ok']).toBe(NOW + DAY);
    /* กู้คืน: ไฟล์หลังทับไฟล์ก่อน ได้เท่าฐานเดิมทุกช่อง เวลาตรวจ / อนุมัติเป็น timestamp */
    expect(gs.restoreAll('demo-ok')).toMatchObject({ ok: true, files: 2 });
    expect(g.plain('demo-ok')).toEqual(noUse(x.store.dump()));
    for (const k of ['ckAt', 'apAt', 'okAt']) expect(Object.keys(g.projects['demo-ok'][id][k]), k).toEqual(['timestampValue']);
    await sameAfterRestore(x, g.plain('demo-ok'));
  });

  it('fire-backup.gs กู้คืน: รวมทุกไฟล์ลงโปรเจกต์ว่าง ได้ข้อมูลเท่าฐานเดิมทุกช่อง (เวลาเป็น timestamp) · มีข้อมูลแล้วไม่ทับ · เกินเวลาทำต่อได้', async () => {
    const x = await filled();
    const g = fakeGcp();
    g.mirror(x.store.dump());
    const gs = g.load();
    gs.backupNightly();
    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-2', [mv3()])));
    ok(await x.head.okSave(['T2611-0003'], 'both'));
    ok(await x.staff.trSave([{ no: 'T2611-0003', tr: 'ADJ-1', state: 'done' }]));
    g.mirror(x.store.dump());
    gs.backupNightly();
    /* ไฟล์ที่ไม่ใช่ไฟล์สำรองในโฟลเดอร์ข้ามไป */
    g.folders[0].createFile('บันทึก.json', '{"kind":"อื่น"}');
    g.folders[0].createFile('อ่านก่อน.txt', 'x');

    expect(() => gs.restoreAll('')).toThrow(/RESTORE_PROJECT_ID/);
    const r = gs.restoreAll('demo-new');
    expect(r).toMatchObject({ ok: true, files: 2, docs: 5 });
    expect(g.logs.join('\n')).toMatch(/ข้าม บันทึก\.json/);
    const want = noUse(x.store.dump());
    expect(g.plain('demo-new')).toEqual(want);
    const raw = g.projects['demo-new'];
    expect(Object.keys(raw['meta/head'].at)).toEqual(['timestampValue']);
    expect(Object.keys(raw[`users/${STAFF_EMAIL}`].last)).toEqual(['timestampValue']);
    expect(Object.keys(raw['meta/head'].seq)).toEqual(['integerValue']);
    expect(Object.keys(raw['xfer/log']['2026-11-10'].mapValue.fields.at)).toEqual(['integerValue']);   // เวลาในบันทึกชีตเดิมเป็นตัวเลขอยู่แล้ว
    await sameAfterRestore(x, g.plain('demo-new'));
    expect(() => gs.restoreAll('demo-new')).toThrow(/มีข้อมูลแล้ว/);

    /* เกินเวลา: หยุดหลังเขียนแต่ละครั้ง จำว่าถึงไหน meta/head เขียนสุดท้าย */
    const slow = g.load({ STOP_MS: -1, WRITE_MAX: 4 });
    const p1 = slow.restoreAll('demo-b');
    expect(p1).toMatchObject({ more: true, done: 4 });
    expect(g.projects['demo-b']['meta/head']).toBeUndefined();
    let p = p1, runs = 1;
    while (p.more) { p = slow.restoreAll('demo-b'); runs++; }
    expect(runs).toBe(Math.ceil(p.total / 4));
    expect(g.plain('demo-b')).toEqual(want);
    expect(Object.keys(g.props).filter((k) => k.startsWith('fr.'))).toEqual([]);
  });
});

/* ── ตรรกะล้วน ───────────────────────────────────────────────────────── */

describe('wms-fire-core.js', () => {
  it('applyDoc: ยอดยกมาเริ่มใหม่ กองที่เหลือ 0 หายไป วันรับแรกเก็บไว้ เบิกเฉพาะประเภท เบิก/ขาย', () => {
    const row = (from, to, qty, type, note = '', st = '') => ['A1', 'A1-LONG', '8', 'P1', from, to, qty, type, note, st, ''];
    let m = C.applyDoc({ old: { qty: 1 } }, { type: 'ยอดยกมา', row: 2, rows: [row('', 'A-01', 5, 'รับ', 'ยอดยกมา T1 · GR 02-10-26', 'เปิด')] });
    expect(Object.keys(m)).toEqual(['A-01|A1-LONG|8|P1']);
    expect(m['A-01|A1-LONG|8|P1']).toMatchObject({ qty: 5, status: 'เปิด', first: '2026-10-02', last: 2 });
    m = C.applyDoc(m, { type: 'ย้าย', row: 3, rows: [row('A-01', 'B-01', 5, 'เบิก', 'โอนย้าย')] });
    expect(Object.keys(m)).toEqual(['B-01|A1-LONG|8|P1']);
    m = C.applyDoc(m, { type: 'คืน', row: 4, rows: [row('B-01', 'C-01', 1, 'รับ', 'RETURN')] });
    expect([m['B-01|A1-LONG|8|P1'].qty, m['C-01|A1-LONG|8|P1'].qty]).toEqual([5, 1]);
  });

  it('TSV ไม่พังเมื่อข้อความมีแท็บหรือขึ้นบรรทัด · เวลาไทยข้ามวันข้ามเดือนถูก', () => {
    expect(C.dec(C.enc([['a\tb', 'c\nd', 1]]))).toEqual([['a b', 'c d', '1']]);
    const late = Date.UTC(2026, 10, 30, 17, 30, 0);   // 1 ธ.ค. 00:30 เวลาไทย
    expect([C.today(late), C.stamp(late), C.yymm(late)]).toEqual(['2026-12-01', '2026-12-01 00:30:00', '2612']);
  });

  it('firestore.rules ตรงกับกฎของ store จำลอง: ประเภทเอกสารต่อสิทธิ์ ฟิลด์ TRcloud ที่แก้ได้ เพดานส่วน · โดเมนตรงกับ wms-fire-config.js', () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    const list = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
    const m = /\(d\.type in \[([^\]]+)\]\) \? \(u\.role == 'head'\)\s*: \(d\.type in \[([^\]]+)\]\)/.exec(rules);
    expect([list(m[1]), list(m[2])]).toEqual([C.HEAD_TYPES, C.STAFF_TYPES]);
    expect(rules).toContain("hasOnly(['tr', 'trState', 'trBy', 'trAt', 'trLog'])");
    expect(rules).toContain('ไม่เกิน ' + C.PARTS_MAX + ' ส่วน (PARTS_MAX) = ' + (4 + 2 * (C.PARTS_MAX - 1)));
    expect(4 + 2 * (C.PARTS_MAX - 1)).toBeLessThanOrEqual(20);
    const cfg = fireConfig();
    expect(rules).toContain("matches('.*@" + cfg.domain.replace(/\./g, '[.]') + "')");
    expect(rules.match(/matches\('\.\*@/g)).toHaveLength(1);
    /* ขั้น 2: ดูทั้งรายชื่อได้เฉพาะหัวหน้า · แก้ตัวเองได้แค่ last · use เติมทีละช่อง */
    expect(rules).toContain('allow list: if signedIn() && isHead(profile());');
    expect(rules).toContain("affectedKeys().hasOnly(['last'])");
    expect(rules).toMatch(/match \/use\/\{day\}[\s\S]*affectedKeys\(\)\.size\(\) == 1/);
    expect(rules).not.toMatch(/allow (delete|write): if true|allow [a-z, ]+: if request\.auth != null;/);
    /* ขั้น 3: เลข TRcloud สถานะต้องถูก · tv เพิ่มทีละ 1 · หัวหน้าแก้ได้แค่ mv trc · xfer/log เติมทีละวัน */
    expect(rules).toContain("d.trState in ['wait', 'done', 'none']");
    expect(rules).toContain("d.tv == (('tv' in old) ? old.tv : 0) + 1");
    expect(rules).toContain("d.ov == (('ov' in old) ? old.ov : 0) + 1");
    expect(rules).toContain("&& d.get('ov', 0) == (old == null ? 0 : old.get('ov', 0))");
    expect(rules).toContain("hasOnly(['mv', 'trc'])");
    expect(rules).toMatch(/match \/xfer\/\{id\}[\s\S]*id == 'log'[\s\S]*affectedKeys\(\)\.size\(\) == 1/);
    expect(C.TR_STATES).toEqual(['wait', 'done', 'none']);
    const idx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.indexes.json'), 'utf8'));
    expect(idx.fieldOverrides.filter((f) => f.collectionGroup === 'docs').map((f) => f.fieldPath)).toEqual(expect.arrayContaining(['rows', 'orders', 'names']));
    expect(idx.fieldOverrides.map((f) => f.fieldPath)).not.toContain('seq');
  });

  it('ไฟล์ไม่มี URL key หรือ config ของ Firebase จริง SDK ตรึงรุ่นจาก gstatic เท่านั้น · dev server ห้ามต่อของจริง', () => {
    const src = read('wms-fire.js') + read('wms-fire-core.js') + read('wms-fire-trc.js') + read('book/book-fire.js') + read('book/book-fire-set.js') + read('book/book-fire-trc.js');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src.match(/https:\/\/[^'"\s)]+/g).filter((u) => !u.startsWith('https://www.gstatic.com/firebasejs/'))).toEqual([]);
    expect(W.SDK_V).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read('wms-fire.js')).toMatch(/dev server ห้ามต่อ Firebase จริง/);
  });

  it('wms-fire-config.js: มีแค่สวิตช์ โดเมน และ web config (ไม่มีรหัสลับ) · เปิดสวิตช์ได้เมื่อ config ครบ · โหลดก่อน book-fire.js', () => {
    const src = read('wms-fire-config.js');
    const cfg = fireConfig();
    expect(Object.keys(cfg).sort()).toEqual(['domain', 'firebase', 'on']);
    expect(typeof cfg.on).toBe('boolean');
    expect(cfg.domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(cfg.domain).not.toMatch(/example|gmail/);
    const f = cfg.firebase;
    const need = ['apiKey', 'authDomain', 'projectId', 'appId'];
    need.forEach((k) => expect(typeof f[k]).toBe('string'));
    const filled = need.filter((k) => f[k]);
    expect([0, 4]).toContain(filled.length);   // ว่างทั้งหมด หรือครบทั้งหมด
    if (filled.length) {
      expect(f.apiKey).toMatch(/^AIza[0-9A-Za-z_-]{30,}$/);
      expect(f.authDomain).toBe(f.projectId + '.firebaseapp.com');
      expect(f.appId).toMatch(/^1:\d+:web:[0-9a-f]+$/);
    }
    if (cfg.on) expect(filled.length).toBe(4);
    expect(src).not.toMatch(/private_key|client_secret|BEGIN [A-Z ]*PRIVATE|service_account|password\s*:|token\s*:/i);
    expect(src.match(/https?:\/\/[^'"\s)]+/g) || []).toEqual([]);
    /* หน้าสมุดสต๊อกโหลด config ก่อน book-fire.js (เลือกโหมดตอนโหลด) */
    const html = read('book/index.html');
    expect(html.indexOf('<script src="../wms-fire-config.js"></script>')).toBeGreaterThan(0);
    expect(html.indexOf('../wms-fire-config.js')).toBeLessThan(html.indexOf('book-fire.js'));
  });

  it('เลือกโหมด: สวิตช์ปิด/ไม่มี config = ระบบเดิม · localhost ไม่ต่อของจริงเด็ดขาด · ?fire=off ต่อเครื่อง · ?fire=live หัวหน้าเปิดแม้สวิตช์ปิด · ?fire=demo ทุกที่', () => {
    const WEB = 'someone.github.io';
    const load = (search, cfg, ls) => {
      const w = { WMS_FIRE_CONFIG: cfg };
      new Function('window', 'location', 'localStorage', read('book/book-fire.js'))(w, { hostname: WEB, search }, ls || memLS());
      return w;
    };
    const win = load('', fireConfig());
    expect(win.BookFire).toBe(null);   // config ที่ commit ไว้ยังไม่มี web config: หน้าที่ deploy ใช้ระบบเดิม
    const pick = win.BookFireMode;
    const full = { on: true, domain: 'co.test', firebase: { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: '1:2:web:3' } };
    const off = { ...full, on: false }, empty = { on: true, domain: 'co.test', firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' } };
    const m = (host, q, cfg, flag) => { const r = pick(host, q, cfg, flag); return r.mode + (r.override ? '!' : '') + (r.reset ? '*' : ''); };
    expect([
      m(WEB, '', full), m(WEB, '', off), m(WEB, '', empty), m(WEB, '?fire=live', empty),
      m(WEB, '?fire=off', full), m(WEB, '', full, '1'), m(WEB, '?fire=on', full, '1'),
      m(WEB, '?fire=live', off), m(WEB, '?fire=live', full, '1'), m(WEB, '?fire=live', full),
      m(WEB, '?fire=demo', off), m(WEB, '?x=1&fire=demo-reset', empty), m(WEB, '?fire=dev', full), m(WEB, '?fire=reset', full),
      m('localhost', '', full), m('127.0.0.1', '?fire=live', full), m('localhost', '?fire=dev', full), m('localhost', '?fire=reset', empty), m('localhost', '?fire=demo', empty),
      m(WEB, '?fire=demox', full), m(WEB, '?fire=offline', off),
    ]).toEqual([
      'live', '', '', '',
      '', '', 'live',
      'live!', 'live!', 'live',
      'demo', 'demo*', 'live', 'live',
      '', '', 'dev', 'dev*', 'demo',
      'live', '',
    ]);
    /* ?fire=off จำในเครื่อง ?fire=on ล้าง */
    const ls = memLS();
    load('?fire=off', off, ls);
    expect(ls.getItem('wms:fire:off')).toBe('1');
    load('?fire=on', off, ls);
    expect(ls.getItem('wms:fire:off')).toBe(null);
    /* ร่างและชุดรอส่งแยกต่อโหมด: ซ้อม/ทดลองไม่ใช้กุญแจเดียวกับระบบจริง (ระบบจริงใช้กุญแจเดียวกับระบบเดิม ชุดค้างตอนสลับไม่หาย) */
    expect(read('book/index.html')).toContain("const DRAFT = 'wms:book:draft' + (window.BookFire && window.BookFire.ns ? ':' + window.BookFire.ns : '');");
    expect(read('book/book-grid.js')).toMatch(/function keyOf\(mode\) \{ var ns = window\.BookFire && window\.BookFire\.ns; return KEY\[mode\] \+ \(ns \? ':' \+ ns : ''\); \}/);
    expect(read('book/book-grid.js')).not.toMatch(/[rw]j\(KEY\[mode\]/);
    expect(read('book/book-fire.js')).toMatch(/live: \{ key: '', idb: 'wms-fire', domain: String\(CFG\.domain \|\| ''\)\.toLowerCase\(\), ns: ''/);
  });

  it('เน็ตหลุดระหว่างบันทึก = net (หน้าเก็บเป็นชุดรอส่งแล้วส่งซ้ำเอง) · ถูกปฏิเสธไม่ใช่ net · ส่งซ้ำรหัสชุดเดิมได้เลขเดิม', async () => {
    const store = W.memStore({ now: () => NOW, domain: DOMAIN });
    store.seed(USERS);
    let cut = null;
    const flaky = Object.assign({}, store, { tx: (fn) => (cut ? Promise.reject(cut) : store.tx(fn)) });
    const f = W.open({ store: flaky, auth: W.fakeAuth(ACCOUNTS), now: () => NOW, domain: DOMAIN });
    expect((await f.login(HEAD_EMAIL)).error).toBeUndefined();
    expect((await f.post('bk-open', { batch: 'o-1', rows: OPEN })).error).toBeUndefined();
    const mv = body('m-1', [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]);
    cut = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
    expect(await f.post('bk-move', mv)).toMatchObject({ net: 1 });
    cut = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    expect((await f.post('bk-move', mv)).net).toBeUndefined();
    cut = new Error('TypeError: Failed to fetch');
    expect(await f.post('bk-move', mv)).toMatchObject({ net: 1 });
    cut = null;
    const a = await f.post('bk-move', mv), b = await f.post('bk-move', mv);
    expect([a.doc, b.doc, b.again]).toEqual(['T2611-0002', 'T2611-0002', true]);
  });

  it('ฟัง meta/head: เริ่มฟังอ่าน 1 ครั้ง ทุกการบันทึกอ่าน 1 ครั้งต่อเครื่องที่ฟัง · แจ้งเฉพาะ seq ที่ยังไม่มีในเครื่อง · เลิกฟังแล้วไม่นับ', async () => {
    const x = await both();
    await x.open();
    const v = await x.device(VIEW_EMAIL);
    await v.sync();
    const got = [];
    const r0 = v.store.mine().reads;
    const stop = v.watch((m) => got.push(m.seq));
    await Promise.resolve();
    expect(v.store.mine().reads - r0).toBe(1);   // ตอนเริ่มฟัง
    expect(got).toEqual([]);                     // seq เท่าในเครื่อง ไม่แจ้ง
    const move = (b) => x.staff.post('bk-move', body(b, [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]));
    expect((await move('m-1')).error).toBeUndefined();
    expect(got).toEqual([2]);
    expect(v.store.mine().reads - r0).toBe(2);
    await v.sync();
    stop();
    const r1 = v.store.mine().reads;
    expect((await move('m-2')).error).toBeUndefined();
    expect([got, v.store.mine().reads - r1]).toEqual([[2], 0]);
  });

  it('โหมดจริงต่อสายครบ (Firestore/Google จำลอง): สวิตช์ปิด + ?fire=live เข้าได้เฉพาะหัวหน้า · ฟัง meta แทนถามทุกนาที · เน็ตหลุดโยน error ให้หน้าเก็บรอส่ง', async () => {
    const CO = 'co.test';
    const store = W.memStore({ now: () => NOW, domain: CO });
    store.seed({ ['users/head@' + CO]: { name: 'หัวหน้าสมมติ', role: 'head', active: true }, ['users/staff@' + CO]: { name: 'พนักงานสมมติ', role: 'staff', active: true } });
    let cut = null, who = null, signedIn = null, seenCfg = null;
    const client = store.connect();
    const flaky = Object.assign({}, client, { tx: (fn) => (cut ? Promise.reject(cut) : client.tx(fn)) });
    const fakeW = Object.assign({}, W, {
      firestoreStore: async (cfg) => { seenCfg = cfg; return { store: flaky, app: {}, sdk: {} }; },
      googleAuth: (fs, domain) => ({
        kind: 'google',
        current: () => signedIn,
        ready: async () => signedIn,
        signIn: async () => { signedIn = { email: who, verified: true, name: who }; return signedIn; },
        signOut: async () => { signedIn = null; },
      }),
    });
    const cfg = { on: false, domain: CO, firebase: { apiKey: 'k', authDomain: 'p.firebaseapp.com', projectId: 'p', appId: '1:2:web:3' } };
    /* หัว Date ของเว็บ = เวลาเซิร์ฟเวอร์ (NOW) นาฬิกาเครื่องจริงต่างไปเท่าไรก็ได้ ระบบใช้เวลาเว็บ */
    let asked = null;
    const win = { WMS_FIRE_CONFIG: cfg, fetch: async (url, o) => { asked = [url, o]; return { headers: { get: (k) => (k === 'Date' ? new Date(NOW).toUTCString() : null) } }; } };
    const doc = { createElement: () => ({}), head: { appendChild: (s) => {
      if (/wms-fire-core\.js$/.test(s.src)) win.WmsFireCore = C;
      if (/wms-fire-trc\.js$/.test(s.src)) win.WmsFireTrc = TR;
      if (/wms-fire\.js$/.test(s.src)) win.WmsFire = fakeW;
      setTimeout(() => s.onload());
    } } };
    new Function('window', 'location', 'localStorage', 'document', read('book/book-fire.js'))(win, { hostname: 'someone.github.io', pathname: '/x/book/', search: '?fire=live' }, memLS(), doc);
    const F = win.BookFire;
    expect([F.mode, F.override, F.pick, F.ns, F.domain, F.demoOrders, F.restoreDev]).toEqual(['live', true, false, '', CO, null, null]);
    await F.ready;
    expect(seenCfg).toBe(cfg.firebase);
    expect(asked[0]).toMatch(/^\/x\/book\/\?clock=\d+$/);
    expect(asked[1]).toEqual({ method: 'HEAD', cache: 'no-store' });
    const skew = NOW + 500 - Date.now();
    expect(Math.abs(F.clock() - (Math.abs(skew) >= 30000 ? skew : 0))).toBeLessThan(5000);
    expect(await F.restore()).toBe(null);   // ยังไม่เคยเข้า

    who = 'staff@' + CO;
    const s = await F.signIn();
    expect(s.error).toMatch(/สวิตช์ระบบใหม่ปิดอยู่/);
    expect([signedIn, F.user()]).toEqual([null, null]);
    who = 'head@' + CO;
    const h = await F.signIn();
    expect(h).toMatchObject({ who: 'หัวหน้าสมมติ', role: C.ROLE_HEAD });
    expect((await F.restore()).who).toBe('หัวหน้าสมมติ');   // Google จำไว้ เปิดหน้าใหม่เข้าเอง
    expect((await F.post('bk-open', { batch: 'o-1', rows: OPEN })).doc).toBe('T2611-0001');
    await F.fifo();
    await Promise.resolve();
    expect(await F.changed()).toBe(false);

    /* อีกเครื่องบันทึก → แท็บนี้รู้จากการฟัง ไม่ต้องอ่าน meta ทุกนาที */
    const other = W.open({ store: store.connect(), auth: W.fakeAuth([{ email: 'staff@' + CO, name: 'พนักงานสมมติ' }]), now: () => NOW, domain: CO });
    expect((await other.login('staff@' + CO)).error).toBeUndefined();
    const mv = (b) => body(b, [['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 1, 'เบิก', 'โอนย้าย', 'เปิด']]);
    expect((await other.post('bk-move', mv('m-1'))).doc).toBe('T2611-0002');
    const r0 = client.mine().reads;
    expect(await F.changed()).toBe(true);
    expect(client.mine().reads).toBe(r0);
    await F.fifo();
    expect(await F.changed()).toBe(false);
    /* บันทึกเอง: หน้าใช้ fifoNow ไม่ต้องดึงซ้ำ */
    expect((await F.post('bk-move', mv('m-2'))).doc).toBe('T2611-0003');
    F.fifoNow();
    expect(await F.changed()).toBe(false);
    /* เน็ตหลุด = โยน error (หน้าเก็บเป็นชุดรอส่ง) · ส่งซ้ำได้เลขเดิม */
    cut = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
    await expect(F.post('bk-move', mv('m-3'))).rejects.toThrow(/offline/);
    cut = null;
    expect((await F.post('bk-move', mv('m-3'))).doc).toBe('T2611-0004');
    expect((await F.post('bk-move', mv('m-3'))).again).toBe(true);
    /* ฐานจริงไม่รับ (ไม่บอกเหตุผล) = บอกทางแก้ ไม่ใช่เน็ตหลุด */
    cut = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const den = await F.post('bk-move', mv('m-4'));
    expect(den.error).toMatch(/ฐานข้อมูลไม่รับการบันทึกนี้ \(Missing or insufficient permissions\.\) · กดส่งใหม่อีกครั้ง ถ้ายังไม่ได้ให้ตรวจนาฬิกาเครื่อง/);
    expect(den.net).toBeUndefined();
    cut = null;
    F.logout();
    expect(F.user()).toBe(null);
  });
});

/* ── ปิดเดือน: เอกสารของเดือนที่จบแล้วรวมเป็นก้อน arch/… ─────────────────── */

describe('WmsFire ปิดเดือน', () => {
  const OCT = Date.UTC(2026, 9, 20, 3, 0, 0);   // 20 ต.ค. 2569 10:00 เวลาไทย
  const grRow = (note, tr) => ['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', note, '', ...(tr ? [tr] : [])];
  const at = (day) => ({ date: day });
  const MIN = 60000;

  /** ต.ค. 8 เอกสาร (มีเอกสารแยกส่วน ~2) แล้วเลื่อนไป 5 พ.ย. บันทึกอีก 2 */
  async function octNov(opt = {}) {
    const x = await both({ now: OCT, partBytes: 3000 });
    await x.open();                                                                                           // T2610-0001
    ok(await x.staff.post('bk-cut', cutBody('big', Array.from({ length: 40 }, (_, i) => saleLine(String(5000 + i), 0.25)), '2026-10-20')));  // 0002 แยกส่วน
    ok(await x.staff.post('bk-move', body('m-1', [QA_MV], at('2026-10-20'))));                                // 0003 เข้า QA
    ok(await x.staff.post('bk-gr', body('g-1', [grRow('GR 19-10-26')], at('2026-10-20'))));                   // 0004 รอลง
    ok(await x.staff.post('bk-gr', body('g-2', [grRow('GR 19-10-26')], at('2026-10-20'))));                   // 0005 รอลง
    ok(await x.staff.post('bk-gr', body('g-3', [grRow('GR 19-10-26', 'GR6910-0001')], at('2026-10-20'))));    // 0006 มีเลข
    ok(await x.staff.post('bk-move', body('m-2', [mv3()], at('2026-10-20'))));                                // 0007
    ok(await x.staff.post('bk-cut', cutBody('c-1', [saleLine('1', 1)], '2026-10-20')));                       // 0008
    if (opt.stopOct) return x;
    x.tick(16 * DAY);
    ok(await x.staff.post('bk-move', body('m-3', [mv3()], at('2026-11-05'))));                                // T2611-0001
    ok(await x.staff.post('bk-gr', body('g-4', [grRow('GR 04-11-26')], at('2026-11-05'))));                   // T2611-0002
    return x;
  }
  /** เครื่องใหม่ (ดูอย่างเดียว) ล็อกอินแล้วซิงก์ คืน { f, reads } อ่านเฉพาะตอนซิงก์ */
  async function freshDevice(x, extra) {
    const f = await x.device(VIEW_EMAIL, extra);
    const r0 = x.store.stats().reads;
    await f.sync();
    return { f, reads: x.store.stats().reads - r0 };
  }
  /** เครื่องที่มองไม่เห็นก้อนปิดเดือน = ดึงทีละเอกสารเสมอ (ไว้เทียบ) */
  async function plainDevice(x) {
    const client = x.store.connect();
    const blind = Object.assign({}, client, { get: (p) => (p.startsWith('arch/') ? Promise.resolve(null) : client.get(p)) });
    const f = await x.device(VIEW_EMAIL, { store: blind });
    await f.sync();
    return f;
  }
  const docsOnly = (d) => Object.fromEntries(Object.entries(d).filter(([p]) => p.startsWith('docs/')));
  async function sameCopy(a, b) {
    expect(a.local().docs).toEqual(b.local().docs);
    expect(C.allPiles(a.local())).toEqual(C.allPiles(b.local()));
    const fa = a.fifo(), fb = b.fifo();
    ['skus', 'pos', 'locs', 'days', 'rows', 'cgr', 'cq'].forEach((k) => expect(fa[k], k).toEqual(fb[k]));
    expect((await a.trList()).list).toEqual((await b.trList()).list);
  }

  it('เดือนปัจจุบันปิดไม่ได้ · ปิดทีละเดือนตามลำดับ · เฉพาะหัวหน้า (แอปและ Rules) · เครื่องใหม่อ่านจากก้อนได้สำเนาเท่าดึงทีละเอกสารทุกช่อง', async () => {
    const early = await octNov({ stopOct: true });
    expect((await early.head.archClose()).error).toMatch(/เดือน ต\.ค\. 69 ยังไม่จบ ปิดได้ตั้งแต่วันที่ 1 เดือนถัดไป/);
    expect(ok(await early.head.archInfo()).next).toMatchObject({ wait: '2610' });
    expect(early.store.dump()['arch/index']).toBeUndefined();

    const x = await octNov();
    expect((await x.staff.archClose()).error).toMatch(/เฉพาะหัวหน้า/);
    expect((await x.staff.archInfo()).error).toMatch(/เฉพาะหัวหน้า/);
    const info = ok(await x.head.archInfo());
    expect(info.months).toEqual([]);
    expect(info.next).toMatchObject({ m: '2610', label: 'ต.ค. 69', from: 1, to: 8, docs: 8 });

    const full = await freshDevice(x);   // ยังไม่ปิด = ดึงทีละเอกสาร
    const before = docsOnly(x.store.dump());
    const c = ok(await x.head.archClose());
    expect(c).toMatchObject({ closed: '2610', label: 'ต.ค. 69', docs: 8, chunks: 1, skip: 0, fix: 0 });
    expect(docsOnly(x.store.dump())).toEqual(before);   // เอกสารเดิมไม่ถูกแก้
    const idx = x.store.dump()['arch/index'];
    expect(idx.months).toEqual([expect.objectContaining({ m: '2610', from: 1, to: 8, docs: 8, n: 1, skip: [], by: 'หัวหน้าทดลอง' })]);
    expect(x.store.dump()['arch/2610-1']).toMatchObject({ m: '2610', k: 1, n: 8 });
    expect(c.sum.next).toMatchObject({ wait: '2611' });
    expect((await x.head.archClose()).error).toMatch(/เดือน พ\.ย\. 69 ยังไม่จบ/);

    const fr = await freshDevice(x);
    await sameCopy(fr.f, full.f);
    /* meta + index + 1 ก้อน + เอกสาร พ.ย. 2 + เลข TRcloud หลังปิด (ว่าง) + ตรวจ / อนุมัติหลังปิด (ว่าง) + ตารางหลัก 7 (นำเข้า 3 + ข้อมูลหลัก 4) */
    expect(fr.reads).toBe(1 + 1 + 1 + 2 + 1 + 1 + 7);
    expect(fr.reads).toBeLessThan(full.reads);
    expect(fr.f.local().docs.find((d) => d.id === 'big').cut.length).toBeGreaterThan(1);   // แยกส่วนตรงกับในฐาน (ไฟล์สำรองยังตรง)
    expect(TR.backupOf(fr.f.local(), {}, NOW).data['docs/big~2']).toEqual(x.store.dump()['docs/big~2']);

    /* Rules: คนลงรายการเขียนก้อนไม่ได้ · ชื่อก้อนต้องถูกรูป */
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    await expect(x.store.commit([['arch/2610-1', { m: '2610', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/ปิดเดือนได้เฉพาะหัวหน้า/);
    x.store.setUser({ email: HEAD_EMAIL, verified: true });
    await expect(x.store.commit([['arch/oops', { t: '[]' }]])).rejects.toThrow(/ชื่อก้อนปิดเดือนไม่ถูก/);
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    expect(rules).toMatch(/match \/arch\/\{id\} \{\s*allow read: if signedIn\(\) && isActive\(profile\(\)\);\s*allow create: if signedIn\(\) && isHead\(profile\(\)\)[^;]*;\s*allow update: if signedIn\(\) && isHead\(profile\(\)\)/);
    const ix = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.indexes.json'), 'utf8'));
    expect(ix.fieldOverrides.filter((f) => f.collectionGroup === 'arch').map((f) => f.fieldPath)).toContain('t');
  });

  it('เลข TRcloud ที่ใส่หลังปิดเดือน: เครื่องใหม่เห็นครบ (ดึงหลังวันปิด + ก้อนเลขที่ใส่หลังปิดเดือนก่อน ๆ)', async () => {
    const x = await octNov();
    ok(await x.head.archClose());                                                         // ปิด ต.ค.
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: 'T2610-0004', tr: 'GR6910-0002', state: 'done' }]));   // เอกสารในก้อน ต.ค.
    const full = await plainDevice(x);
    const a = await freshDevice(x);
    await sameCopy(a.f, full);
    expect((await a.f.trList()).list.find((d) => d.no === 'T2610-0004')).toMatchObject({ state: 'done', tr: 'GR6910-0002' });

    x.tick(28 * DAY);   // 3 ธ.ค.
    ok(await x.staff.post('bk-move', body('m-4', [mv3()], at('2026-12-03'))));            // T2612-0001
    const c = ok(await x.head.archClose());                                               // ปิด พ.ย.
    expect(c).toMatchObject({ closed: '2611', docs: 2, fix: 1 });
    expect(x.store.dump()['arch/index'].ov).toMatchObject({ n: 1, fix: 1 });
    expect(JSON.parse(x.store.dump()['arch/ov-2611-1'].t)).toEqual([['g-1', 'GR6910-0002', 'done', STAFF_EMAIL, OCT + 16 * DAY + MIN]]);
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: 'T2610-0005', tr: 'GR6910-0003', state: 'done' }]));   // หลังปิด พ.ย.
    await full.sync();
    const b = await freshDevice(x);
    await sameCopy(b.f, full);
    const list = (await b.f.trList()).list;
    expect(['T2610-0004', 'T2610-0005', 'T2611-0002'].map((no) => list.find((d) => d.no === no).state)).toEqual(['done', 'done', 'wait']);
  });

  it('ตรวจ / อนุมัติหลังปิดเดือน: เครื่องใหม่เห็นครบ (ดึงหลังวันปิด + ก้อนของที่แก้หลังปิดเดือนก่อน ๆ) เท่ากับดึงทีละเอกสาร', async () => {
    const x = await octNov();
    ok(await x.head.archClose());                                       // ปิด ต.ค.
    x.tick(MIN);
    const T1 = OCT + 16 * DAY + MIN;
    ok(await x.head.okSave(['T2610-0003'], 'check'));                  // ใบในก้อน ต.ค. ตรวจหลังปิด
    const st = (f, no) => C.okState(f.local().docs.find((d) => d.no === no), C.voids(f.local()));
    const full = await plainDevice(x);
    const a = await freshDevice(x);
    await sameCopy(a.f, full);
    expect(st(a.f, 'T2610-0003')).toBe('approve');

    x.tick(28 * DAY);   // 3 ธ.ค.
    ok(await x.staff.post('bk-move', body('m-4', [mv3()], at('2026-12-03'))));   // T2612-0001
    const c = ok(await x.head.archClose());                             // ปิด พ.ย.
    expect(c).toMatchObject({ closed: '2611', docs: 2, fix: 1 });
    /* ก้อนของที่แก้หลังปิด: ใบที่ตรวจหลังปิด ต.ค. ต่อท้ายช่องตรวจ / อนุมัติ (ไม่มีเลข TRcloud ใหม่ = ช่อง TRcloud ค่าเดิม) */
    expect(JSON.parse(x.store.dump()['arch/ov-2611-1'].t)).toEqual([['m-1', '', 'wait', '', 0, HEAD_EMAIL, 'หัวหน้าทดลอง', T1, '', '', 0, T1]]);
    expect(x.store.dump()['arch/index'].ov).toMatchObject({ n: 1, fix: 1, okAt: T1 });
    x.tick(MIN);
    ok(await x.head.okSave(['T2610-0003'], 'approve'));                // อนุมัติหลังปิด พ.ย.
    ok(await x.head.okSave(['T2611-0001'], 'both'));
    await full.sync();
    const b = await freshDevice(x);
    await sameCopy(b.f, full);
    expect(['T2610-0003', 'T2610-0007', 'T2611-0001', 'T2612-0001'].map((no) => st(b.f, no))).toEqual(['done', 'check', 'done', 'check']);
    expect(b.f.local().docs.find((d) => d.no === 'T2610-0003')).toMatchObject({ ck: HEAD_EMAIL, ckAt: T1, ap: HEAD_EMAIL, apAt: T1 + 28 * DAY + MIN });
  });

  it('ดึงเลข TRcloud นับจากก่อนดึงรอบนี้: เอกสารเก่าที่ใส่เลขก่อนเอกสารใหม่ที่ใส่เลขทีหลัง ไม่หลุด', async () => {
    const x = await octNov({ stopOct: true });
    const v = await x.device(VIEW_EMAIL);
    await v.sync();
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: 'T2610-0004', tr: 'GR6910-0002', state: 'done' }]));
    x.tick(MIN);
    ok(await x.staff.post('bk-gr', body('g-9', [grRow('GR 19-10-26')], at('2026-10-20'))));   // T2610-0009
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: 'T2610-0009', tr: 'GR6910-0009', state: 'done' }]));
    await v.sync();
    const list = (await v.trList()).list;
    expect(['T2610-0004', 'T2610-0009'].map((no) => list.find((d) => d.no === no).tr)).toEqual(['GR6910-0002', 'GR6910-0009']);
  });

  it('เอกสารใหญ่เกินก้อน = skip เครื่องใหม่อ่านทีละเอกสาร (หลัก + ~2 ~3) · เน็ตหลุดตอนเขียน index = ยังไม่ปิด กดใหม่ได้', async () => {
    const x = await octNov();
    let cut = null;
    const client = x.store.connect();
    const flaky = Object.assign({}, client, { tx: (fn) => (cut ? Promise.reject(cut) : client.tx(fn)) });
    const h = await x.device(HEAD_EMAIL, { store: flaky, archBytes: 2500 });
    cut = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
    const bad = await h.archClose();
    expect(bad).toMatchObject({ net: 1 });
    expect(x.store.dump()['arch/2610-1']).toBeDefined();
    expect(x.store.dump()['arch/index']).toBeUndefined();   // index = จุดยืนยัน ยังไม่ปิด
    cut = null;
    const c = ok(await h.archClose());
    expect(c).toMatchObject({ closed: '2610', docs: 8, skip: 1 });
    expect(c.chunks).toBeGreaterThan(1);
    expect(x.store.dump()['arch/index'].months[0].skip).toEqual(['big']);
    Object.keys(x.store.dump()).filter((p) => p.startsWith('arch/2610-')).forEach((p) => expect(C.byteLen(x.store.dump()[p].t)).toBeLessThanOrEqual(2500));
    const full = await plainDevice(x);
    const fr = await freshDevice(x);
    await sameCopy(fr.f, full);
    /* meta + index + ก้อน + เอกสารใหญ่ (หลัก + ส่วนแยก) + เอกสาร พ.ย. 2 + เลข TRcloud หลังปิด + ตรวจ / อนุมัติหลังปิด + ตารางหลัก 7 */
    const parts = Object.keys(x.store.dump()).filter((p) => p.startsWith('docs/big~')).length;
    expect(parts).toBeGreaterThan(0);
    expect(fr.reads).toBe(1 + 1 + c.chunks + 1 + parts + 2 + 1 + 1 + 7);
  });

  it('เอกสารที่หัวหน้าบันทึกจากเครื่องตัวเอง (สำเนาตอนบันทึกใช้เวลาเครื่อง) ก่อนรวมก้อนดึงจากฐานใหม่ ก้อนตรงกับในฐาน', async () => {
    const x = await both({ now: OCT, partBytes: 3000 });
    const hs = await x.device(HEAD_EMAIL, { now: () => x.clock() + 7000 });
    ok(await hs.post('bk-open', { batch: 'o-1', rows: OPEN }));
    ok(await hs.post('bk-cut', cutBody('big', Array.from({ length: 40 }, (_, i) => saleLine(String(5000 + i), 0.25)), '2026-10-20')));
    ok(await hs.post('bk-move', body('m-1', [mv3()], at('2026-10-20'))));
    x.tick(16 * DAY);
    const own = hs.local().docs.find((d) => d.id === 'big');
    expect(own.at).toBe(OCT + 7000);   // สำเนาตอนบันทึก (เวลาเครื่อง)
    expect(ok(await hs.archClose())).toMatchObject({ closed: '2610', docs: 3, skip: 0 });
    const full = await plainDevice(x), fr = await freshDevice(x);
    await sameCopy(fr.f, full);
    expect(fr.f.local().docs.map((d) => d.at)).toEqual([OCT, OCT, OCT]);   // เวลาเซิร์ฟเวอร์
    expect(hs.local().docs.find((d) => d.id === 'big').at).toBe(OCT);
  });

  it('เดือนถัดไปที่ปิดได้ ตามลำดับ seq · เอกสารเดือนเก่าที่โผล่ทีหลัง (นาฬิกาเครื่องผิด) ไปก้อนถัดไป · เครื่องตามหลังอ่านก้อนเฉพาะที่คุ้ม', () => {
    const d = (seq, no) => ({ seq, no });
    const local = { docs: [d(1, 'T2610-0001'), d(2, 'T2611-0001'), d(3, 'T2610-0009'), d(4, 'T2611-0002'), d(5, 'T2612-0001')] };
    const dec5 = Date.UTC(2026, 11, 5, 3);
    expect(TR.archNext(local, null, dec5)).toMatchObject({ m: '2610', from: 1, to: 1 });
    expect(TR.archNext(local, { months: [{ m: '2610', from: 1, to: 1 }] }, dec5)).toMatchObject({ m: '2611', from: 2, to: 4 });
    expect(TR.archNext(local, { months: [{ m: '2610', to: 1 }, { m: '2611', to: 4 }] }, dec5)).toMatchObject({ wait: '2612' });
    expect(TR.archNext({ docs: [d(1, 'T2610-0001'), d(3, 'T2610-0003')] }, null, dec5).error).toMatch(/ขาดเอกสารลำดับที่ 2/);
    expect(TR.archNext({ docs: [] }, null, dec5)).toMatchObject({ none: 1 });
    expect(['2612', '2701', '2609'].map(TR.monthTh)).toEqual(['ธ.ค. 69', 'ม.ค. 70', 'ก.ย. 69']);
    const idx = { months: [{ m: '2612', from: 1, to: 900, n: 3, skip: [] }, { m: '2701', from: 901, to: 2000, n: 4, skip: ['x'] }] };
    expect(TR.archUse(idx, 0).map((m) => m.m)).toEqual(['2612', '2701']);
    expect(TR.archUse(idx, 500).map((m) => m.m)).toEqual(['2612', '2701']);
    expect(TR.archUse(idx, 899).map((m) => m.m)).toEqual([]);   // ขาดอีกเอกสารเดียว ดึงทีละเอกสารคุ้มกว่า
    expect(TR.archUse(idx, 900).map((m) => m.m)).toEqual(['2701']);
    expect(TR.archUse(idx, 1995).map((m) => m.m)).toEqual([]);
    expect(TR.archUse(null, 0)).toEqual([]);
    expect(TR.archFloor(null)).toBe(null);
    expect(TR.archFloor({ months: [{ trAt: 5000000 }], ov: { trAt: 9000000 } })).toBe(9000000 - TR.TR_MARGIN);
    expect(W.ARCH_BATCH).toBeLessThanOrEqual(9);
  });
});

/* ── เลขเอกสารคร่อมเที่ยงคืนสิ้นเดือน ─────────────────────────────────── */

describe('WmsFire เลขเอกสารคร่อมเที่ยงคืนสิ้นเดือน', () => {
  const END = Date.UTC(2026, 10, 30, 16, 59, 59, 500);   // 30 พ.ย. 2569 23:59:59.5 เวลาไทย
  const MIN = 60000;
  const mv = (b) => body(b, [mv3()], { date: '2026-11-30' });
  /** ยอดยกมาวันก่อน แล้วเลื่อนเวลาเซิร์ฟเวอร์ไปที่ at */
  async function nearEnd(at) {
    const x = await both({ now: END - DAY });
    await x.open();                     // T2611-0001
    x.tick(at - (END - DAY));
    return x;
  }
  const skewed = (x, ms) => x.device(STAFF_EMAIL, { now: () => x.clock() + ms });
  const noOf = (x, batch) => x.store.dump()['docs/' + batch].no;

  it('กดก่อนเที่ยงคืน ถึงฐานหลังเที่ยงคืน (นาฬิกาตรง) บันทึกได้ เลขเดือนเดิมรันต่อ · นาฬิกาช้าเกิน 10 นาที ไม่ผ่าน จนมีเครื่องเริ่มเดือนใหม่ แล้วรันต่อได้', async () => {
    const x = await nearEnd(END);
    x.store.hook(async () => x.tick(1000));   // ระหว่างคำนวณกับเขียน เวลาเซิร์ฟเวอร์ข้ามเที่ยงคืน
    expect(ok(await x.staff.post('bk-move', mv('m-1'))).doc).toBe('T2611-0002');
    expect(C.today(x.clock())).toBe('2026-12-01');

    x.tick(20 * MIN);                           // 1 ธ.ค. 00:20
    const slow = await skewed(x, -30 * MIN);    // ยังเห็นเป็น 30 พ.ย. 23:50
    expect((await slow.post('bk-move', mv('s-1'))).error).toMatch(/เดือนของเลขเอกสารไม่ตรงกับเวลาเซิร์ฟเวอร์/);
    expect(ok(await x.staff.post('bk-move', body('m-2', [mv3()], { date: '2026-12-01' }))).doc).toBe('T2612-0001');
    expect(ok(await slow.post('bk-move', mv('s-1'))).doc).toBe('T2612-0002');   // เดือนไม่ย้อน ใช้เดือนของ meta
    expect(x.store.dump()['meta/head']).toMatchObject({ month: '2612', next: 3 });
  });

  it('เครื่องนาฬิกาเร็วเริ่มเดือนใหม่ก่อนเที่ยงคืนเซิร์ฟเวอร์ เครื่องอื่นรันต่อเดือนใหม่ (ไม่ซ้ำ ไม่ย้อน) · Rules ห้ามเดือนย้อนแม้อยู่ในช่วงเผื่อ', async () => {
    const x = await nearEnd(END - MIN);         // 23:58:59.5
    const fast = await skewed(x, 2 * MIN), slow = await skewed(x, -5 * MIN);
    expect(ok(await fast.post('bk-move', body('f-1', [mv3()], { date: '2026-12-01' }))).doc).toBe('T2612-0001');
    expect(ok(await x.staff.post('bk-move', mv('m-1'))).doc).toBe('T2612-0002');
    expect(ok(await slow.post('bk-move', mv('s-1'))).doc).toBe('T2612-0003');
    const nos = Object.values(x.store.dump()).filter((d) => d && d.no && !d.of).map((d) => d.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos.sort()).toEqual(['T2611-0001', 'T2612-0001', 'T2612-0002', 'T2612-0003']);

    /* เขียนตรง: meta กลับเป็น พ.ย. เริ่มเลข 1 (= T2611-0001 ซ้ำ) ถูกกฎกัน */
    const m = x.store.dump()['meta/head'];
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    const d = { v: 1, no: 'T2611-0001', seq: m.seq + 1, row: m.rows + 2, n: 1, type: 'ย้าย', date: '2026-11-30', by: STAFF_EMAIL, name: 'ทดลอง', at: C.TIME,
      stamp: '', ref: '', link: '', why: '', qty: 1, tr: '', trState: 'none', rows: '', names: '', orders: '', part: 1 };
    await expect(x.store.commit([['docs/back', d], ['meta/head', { ...m, seq: m.seq + 1, month: '2611', next: 2, last: 'back', at: C.TIME }]])).rejects.toThrow(/ย้อนเดือนเดิมไม่ได้/);
  });

  it('ช่วงเผื่อ ±10 นาทีตรงกันทั้งแอป store จำลอง และ firestore.rules · เดือนเลขเอกสารไม่ย้อน', () => {
    expect(C.MONTH_TOL).toBe(10 * MIN);
    expect(C.monthsOk(END)).toEqual(['2611', '2612']);
    expect(C.monthsOk(END - 11 * MIN)).toEqual(['2611']);
    expect(C.monthsOk(END + 11 * MIN)).toEqual(['2612']);
    expect(C.monthsOk(Date.UTC(2026, 11, 31, 17, 5))).toEqual(['2612', '2701']);   // ข้ามปี
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    expect(rules.match(/duration\.value\(10, 'm'\)/g)).toHaveLength(3);   // monthOk 2 + monthDone (เดือนที่ปิดได้) 1
    expect(rules).toContain('monthOk(m.month) && d.no ==');
    expect(rules).toContain('monthOk(d.month) && d.month >= prevMonth && d.next == prevNext + 1');
    expect(rules).not.toMatch(/thaiMonth\(\)/);
  });
});

describe('แอปสมุดสต๊อก: หน้าวันนี้ ค้นเอกสาร ดูทีละใบ (wms-fire-docs.js)', () => {
  /* T2611-0001 ยอดยกมา · 0002 ย้าย · 0003 เข้า QA · 0004 รับของ ไม่มีเลข · 0005 รับของ มีเลข · 0006 ตัดขาย · 0007 ปรับยอด */
  async function ready() {
    const x = await both();
    await x.open();
    ok(await x.staff.post('bk-move', body('m-1', [mv3()])));
    ok(await x.staff.post('bk-move', body('m-2', [QA_MV])));
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));
    ok(await x.staff.post('bk-gr', body('g-2', [[...GR3, 'GR6911-0001']])));
    ok(await x.staff.post('bk-cut', cutBody('c-1', [saleLine('77', 1)])));
    ok(await x.head.post('bk-adj', body('a-1', [ADJ3], { lines: ADJ_LINES })));
    await x.head.sync();
    return x;
  }

  it('สรุปทุกใบ ใหม่สุดก่อน พร้อมสถานะ TRcloud จำนวนออเดอร์ และคำไว้ค้น', async () => {
    const x = await ready();
    const list = DOC.index(x.head.local());
    expect(list.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0006', 'T2611-0005', 'T2611-0004', 'T2611-0003', 'T2611-0002', 'T2611-0001']);
    expect(list.map((d) => d.state)).toEqual(['wait', 'none', 'done', 'wait', 'wait', 'none', 'none']);
    const sale = list.find((d) => d.no === 'T2611-0006');
    expect(sale).toMatchObject({ type: 'ตัดขาย', name: 'ทดลอง', by: STAFF_EMAIL, rows: 1, qty: 1, orders: 1, voided: null, link: '' });
    expect(sale.text).toContain('on77');
    expect(sale.text).toContain('th77');
    expect(list.find((d) => d.no === 'T2611-0005').text).toContain('gr6911-0001');
  });

  it('ค้น: ทุกคำต้องเจอ · ประเภท · รอลง TRcloud · ของฉัน · ช่วงวัน · นับต่อชิปให้ถูก', async () => {
    const x = await ready();
    const list = DOC.index(x.head.local());
    const q = (o) => DOC.search(list, o, NOW);
    expect(q({ text: 'TH77' }).list.map((d) => d.no)).toEqual(['T2611-0006']);
    expect(q({ text: 'r01-02-01 p9' }).list.map((d) => d.no)).toEqual(['T2611-0005', 'T2611-0004']);
    expect(q({ text: 'r01-02-01 gr6911' }).list.map((d) => d.no)).toEqual(['T2611-0005']);
    expect(q({ text: 'ไม่มีคำนี้' }).total).toBe(0);
    expect(q({ type: 'รับของ' }).list.map((d) => d.no)).toEqual(['T2611-0005', 'T2611-0004']);
    expect(q({ status: 'wait' }).list.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0004']);   // 0003 โอน QA ยังไม่อนุมัติ ยังลง TRcloud ไม่ได้
    expect(q({ status: 'mine', email: HEAD_EMAIL }).list.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0001']);
    const all = q({ status: 'wait' });
    expect(all.types).toEqual({ 'ปรับยอด': 1, 'รับของ': 1 });
    expect(all.states).toEqual({ wait: 2, recv: 1, check: 1, approve: 0, reject: 0, void: 0, mine: 0 });   // ใบย้ายรอตรวจ 1 ใบโอน QA รอรับ 1
    expect(q({ type: 'รับของ', email: STAFF_EMAIL }).states).toEqual({ wait: 1, recv: 0, check: 0, approve: 0, reject: 0, void: 0, mine: 2 });
    expect(q({ status: 'recv' }).list.map((d) => d.no)).toEqual(['T2611-0003']);
    /* ช่วงวันดูวันที่ของเอกสาร (ชุดนี้ลงวันที่ 10 พ.ย.) */
    expect(q({ range: 'today' }).total).toBe(7);
    expect(q({ range: 'today' }).from).toBe('2026-11-10');
    expect(DOC.search(list, { range: 'today' }, NOW + 2 * DAY).total).toBe(0);
    expect(DOC.search(list, { range: 'd7' }, NOW + 2 * DAY).total).toBe(7);
    expect(DOC.rangeOf('month', NOW)).toEqual(['2026-11-01', '2026-11-10']);
    expect(DOC.rangeOf('d30', NOW)).toEqual(['2026-10-12', '2026-11-10']);
    expect(DOC.rangeOf('all', NOW)).toEqual(['', '']);
    expect(DOC.search(list, { max: 2 }, NOW)).toMatchObject({ total: 7, all: 7 });
    expect(DOC.search(list, { max: 2 }, NOW).list).toHaveLength(2);
  });

  it('ดูทีละใบ: ขั้นตอน ประวัติ สิ่งที่ต้องทำใน TRcloud · ยกเลิกแล้วเห็นใบกลับรายการ และใบกลับรายการชี้กลับใบเดิม', async () => {
    const x = await ready();
    const gr = DOC.view(x.head.local(), 'T2611-0004');
    expect(gr).toMatchObject({ type: 'รับของ', state: 'wait', kind: 'number', canVoid: true, voided: null, back: null, orig: null });
    expect(gr.need).toMatch(/สร้าง GR ใน TRcloud/);
    expect(gr.steps.map((s) => [s.k, s.state])).toEqual([['save', 'done'], ['tr', 'now']]);
    expect(gr.rows).toHaveLength(1);
    expect(DOC.view(x.head.local(), 'T2611-0006').steps.map((s) => s.k)).toEqual(['save']);   // ตัดขายไม่เกี่ยวกับ TRcloud ของคลัง
    expect(DOC.view(x.head.local(), 'T2611-0006').lines[0]).toMatchObject({ order: '77', ref: 'ON77', track: 'TH77' });
    expect(DOC.view(x.head.local(), 'T2611-0001')).toMatchObject({ open: true, canVoid: false });
    expect(DOC.view(x.head.local(), 'T2611-9999')).toBe(null);

    x.tick(60000);
    ok(await x.staff.trSave([{ no: 'T2611-0004', tr: 'GR6911-0002', state: 'done' }]));
    ok(await x.head.post('bk-void', { doc: 'T2611-0004', why: 'รับผิด PO' }));   // 0008
    await x.head.sync();
    const v = DOC.view(x.head.local(), 'T2611-0004');
    expect(v).toMatchObject({ state: 'done', tr: 'GR6911-0002', canVoid: false, back: { no: 'T2611-0008', name: 'หัวหน้าทดลอง' } });
    expect(v.voided).toMatchObject({ by: 'หัวหน้าทดลอง', why: 'รับผิด PO', link: 'T2611-0008' });
    expect(v.steps.map((s) => [s.k, s.state])).toEqual([['save', 'done'], ['tr', 'done'], ['void', 'void']]);
    expect(v.steps[1]).toMatchObject({ tr: 'GR6911-0002', who: STAFF_EMAIL });
    expect(v.history.map((h) => h.what)).toEqual(['บันทึกรับของ · 1 แถว 3 ชิ้น', 'ใส่เลข TRcloud GR6911-0002', 'ยกเลิก · รับผิด PO']);
    expect(v.history[2]).toMatchObject({ link: 'T2611-0008', linkTh: 'ลงกลับเป็น' });
    expect(v.history[1].at).toBe(C.stamp(NOW + 60000));
    const r = DOC.view(x.head.local(), 'T2611-0008');
    expect(r).toMatchObject({ rev: true, canVoid: false, state: 'wait', kind: 'number', orig: { no: 'T2611-0004', type: 'รับของ' } });
    expect(r.need).toMatch(/สร้าง GR/);
    expect(r.steps[0].label).toBe('ลงกลับ');
    expect(r.history[0]).toMatchObject({ what: 'ลงกลับรายการ · รับผิด PO · 1 แถว 3 ชิ้น', link: 'T2611-0004', linkTh: 'ของ' });
    /* หน้าวันนี้: ใบที่ยกเลิกไม่นับในงานของประเภทนั้น (นับแยก) */
    expect(DOC.home(x.head.local(), NOW + 60000, HEAD_EMAIL).types['รับของ']).toEqual({ n: 1, qty: 3, void: 1 });
    /* ในรายการ: ใบเดิมมีป้ายยกเลิก ใบกลับรายการมีลิงก์ใบเดิม · ชิปยกเลิกแล้วนับถูก */
    const list = DOC.index(x.head.local());
    expect(list.find((d) => d.no === 'T2611-0004').voided.link).toBe('T2611-0008');
    expect(list.find((d) => d.no === 'T2611-0008').link).toBe('T2611-0004');
    expect(DOC.search(list, { status: 'void' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0004']);
    expect(DOC.search(list, { text: 'T2611-0004' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0008', 'T2611-0004']);
  });

  it('หน้าวันนี้: ใบที่บันทึกวันนี้ต่อประเภท ของฉัน รอลง TRcloud เก่าสุดกี่วัน ไม่นับยอดยกมา', async () => {
    const x = await ready();
    const h = DOC.home(x.head.local(), NOW, STAFF_EMAIL);
    expect(h).toMatchObject({ day: '2026-11-10', total: 6, mine: 5, open: true, trcDay: '' });
    expect(h.types).toEqual({ 'ย้าย': { n: 2, qty: 2, void: 0 }, 'รับของ': { n: 2, qty: 6, void: 0 }, 'ตัดขาย': { n: 1, qty: 1, void: 0 }, 'ปรับยอด': { n: 1, qty: 2, void: 0 } });
    expect(h.wait).toEqual({ n: 2, oldest: '2026-11-10', days: 0, file: 1, number: 1 });
    expect(h.last.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0006', 'T2611-0005', 'T2611-0004', 'T2611-0003', 'T2611-0002']);
    const later = DOC.home(x.head.local(), NOW + 3 * DAY, HEAD_EMAIL);
    expect(later).toMatchObject({ total: 0, mine: 0, last: [] });
    expect(later.wait).toMatchObject({ n: 2, days: 3 });
    expect(later.ok).toMatchObject({ recv: 1, check: 1, recvDays: 3 });
  });

  it('BookFire โหลด wms-fire-docs.js ก่อน wms-fire.js และเปิด home / docs / doc ให้หน้าแอป', () => {
    const js = read('book/book-fire.js');
    expect(js.indexOf("script('../wms-fire-docs.js')")).toBeGreaterThan(js.indexOf("script('../wms-fire-trc.js')"));
    expect(js.indexOf("script('../wms-fire-docs.js')")).toBeLessThan(js.indexOf("script('../wms-fire.js')"));
    for (const k of ['home: function', 'docs: function', 'doc: function']) expect(js).toContain(k);
  });
});

describe('แอปสมุดสต๊อก: หน้าเว็บ เมนูของแอป ป้ายรหัสเครื่อง ติดตั้งเป็นแอป', () => {
  const html = () => read('book/index.html');
  const head = () => html().split('</head>')[0];

  it('ระบบใหม่ข้ามป้ายรหัสเครื่อง (เข้าด้วย Google แทน) · ระบบเดิมยังมีป้ายเหมือนเดิม', () => {
    const h = head();
    const at = (s) => h.indexOf(s);
    expect(at('<script src="../wms-fire-config.js"></script>')).toBeGreaterThan(0);
    expect(at('<script src="../wms-fire-config.js"></script>')).toBeLessThan(at('<script src="book-fire.js"></script>'));
    expect(at('<script src="book-fire.js"></script>')).toBeLessThan(at('window.WMS_GATE_OFF = 1'));
    expect(at('window.WMS_GATE_OFF = 1')).toBeLessThan(at('<script src="../wms-gate.js"></script>'));
    expect(h).toContain("<script>if (window.BookFire) { window.WMS_GATE_OFF = 1; document.documentElement.classList.add('bk-app'); }</script>");
    /* โหลดครั้งเดียว ไม่ซ้ำในท้ายหน้า */
    expect(html().match(/book-fire\.js/g)).toHaveLength(1);
    expect(html().match(/wms-fire-config\.js/g)).toHaveLength(1);
    /* ป้ายรหัสเครื่องหยุดก่อนล็อกหน้า เฉพาะหน้าที่ตั้ง WMS_GATE_OFF */
    const gate = read('wms-gate.js');
    expect(gate.indexOf('if (window.WMS_GATE_OFF) return;')).toBeGreaterThan(0);
    expect(gate.indexOf('if (window.WMS_GATE_OFF) return;')).toBeLessThan(gate.indexOf("classList.add('wms-locked')"));
    const others = ['stock-location/index.html', 'fifo/index.html', 'cut-check/index.html'];
    for (const p of others) expect(read(p), p).not.toContain('WMS_GATE_OFF');
  });

  it('สคริปต์ของแอปโหลดหลังแท็บ TRcloud ก่อนสคริปต์ในหน้า · เมนูของแอปมีที่วาง · หน้าเดิมใช้แท็บเดิมเมื่อไม่ใช่ระบบใหม่', () => {
    const s = html();
    expect(s.indexOf('<script src="book-fire-trc.js"></script>')).toBeLessThan(s.indexOf('<script src="book-app.js"></script>'));
    expect(s.indexOf('<script src="book-app.js"></script>')).toBeLessThan(s.indexOf('const $ = id =>'));
    expect(s).toContain('<nav class="bk-nav" id="bkNav" hidden aria-label="เมนูสมุดสต๊อก"></nav>');
    expect(s).toContain("const APP = window.BookApp && window.BookApp.on ? window.BookApp : null;");
    expect(s).toContain('if (APP) return APP.tabs();');
    const app = read('book/book-app.js');
    expect(app).toContain('var ON = !!window.BookFire;');
    /* เมนูของหัวหน้า */
    for (const k of ["{ k: 'adj', t: 'ปรับยอด', head: 1 }", "{ k: 'rows', t: 'ตารางแบบเดิม', head: 1 }", "{ k: 'close', t: 'ปิดวัน / เดือน', head: 1 }"]) expect(app).toContain(k);
    /* ปิดวัน / เดือน = ตรวจยอด ชีตเดิม ปิดเดือน · ตั้งค่าไม่มีสามอย่างนี้แล้ว */
    const set = read('book/book-fire-set.js');
    expect(set).toContain("[['check', '① ตรวจยอด'], ['xfer', '② วางชีตเดิม'], ['arch', '③ ปิดเดือน']]");
    expect(set).toContain("[['users', '👥 คนใช้และสิทธิ์'], ['open', '📥 ยอดยกมา'], ['backup', '💾 สำรอง'], ['quota', '📊 โควตาฟรี']]");
  });

  it('ติดตั้งเป็นแอปได้: manifest ชี้ไอคอน 192 กับ 512 ที่มีจริง เปิดแบบหน้าต่างแอปในขอบเขตหน้าสมุด', () => {
    expect(head()).toContain('<link rel="manifest" href="manifest.webmanifest">');
    const m = JSON.parse(read('book/manifest.webmanifest'));
    expect(m).toMatchObject({ start_url: './', scope: './', display: 'standalone', short_name: 'สมุดสต๊อก' });
    expect(m.icons.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const i of m.icons) {
      const f = path.resolve(__dirname, '../../public/book', i.src);
      expect(fs.existsSync(f), i.src).toBe(true);
      const b = fs.readFileSync(f);
      expect(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, i.src).toBe(i.sizes);
    }
  });

  it('ไฟล์ใหม่ของแอปไม่มี URL key หรือ config ของ Firebase จริง', () => {
    const src = read('wms-fire-docs.js') + read('book/book-app.js');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src.match(/https?:\/\/[^'"\s)]+/g) || []).toEqual([]);
  });
});

/* ── ตรวจ / อนุมัติ ใบย้าย / แปลง · ใบพิมพ์ ─────────────────────────────── */

describe('ตรวจ / อนุมัติ ใบย้าย / แปลง (ผู้จัดทำ → ผู้ตรวจสอบ → ผู้อนุมัติ) · ใบพิมพ์ A5', () => {
  const CONV2 = [
    ['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
    ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR6911-0002'],
  ];
  /* T2611-0001 ยอดยกมา · 0002 เข้า QA (คนลงรายการ) · 0003 แปลง (คนลงรายการ) · 0004 รับของ · 0005 ย้าย (หัวหน้า) */
  async function ready() {
    const x = await both();
    await x.open();
    ok(await x.staff.post('bk-move', body('m-1', [QA_MV])));
    ok(await x.staff.post('bk-conv', body('v-1', CONV2)));
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));
    ok(await x.head.post('bk-move', body('m-2', [mv3()])));
    return x;
  }
  const raw = (x, no) => Object.values(x.store.dump()).find((d) => d && d.no === no);
  const pathOf = (x, no) => Object.keys(x.store.dump()).find((k) => x.store.dump()[k] && x.store.dump()[k].no === no);
  const stOf = async (f, no) => { await f.sync(); return C.okState(f.local().docs.find((d) => d.no === no), C.voids(f.local())); };
  const err = async (f, nos, act) => (await f.okSave(nos, act)).error;

  it('ยอดเปลี่ยนตั้งแต่บันทึก · คนทำตรวจใบตัวเองไม่ได้ · อนุมัติเฉพาะหัวหน้าหลังมีผู้ตรวจ · หัวหน้าอนุมัติใบที่ตัวเองทำได้ · ใบอื่นไม่ต้องตรวจ', async () => {
    const x = await ready();
    await x.head.sync();
    expect(Object.values(C.allPiles(x.head.local())).find((p) => p.loc === 'QA' && p.long === 'AAA0000000001').qty).toBe(1);   // ยังไม่ตรวจ ยอดก็เปลี่ยนแล้ว
    expect(await Promise.all(['T2611-0001', 'T2611-0002', 'T2611-0003', 'T2611-0004', 'T2611-0005'].map((n) => stOf(x.head, n)))).toEqual(['', 'check', 'check', '', 'check']);
    expect(await err(x.staff, ['T2611-0002'], 'check')).toBe('T2611-0002 คนทำรับใบของตัวเองไม่ได้');
    expect(await err(x.staff, ['T2611-0003'], 'check')).toBe('T2611-0003 คนทำตรวจใบของตัวเองไม่ได้');
    expect(await err(x.staff, ['T2611-0005'], 'approve')).toBe('อนุมัติได้เฉพาะหัวหน้า');
    expect(await err(x.staff, ['T2611-0005'], 'both')).toBe('อนุมัติได้เฉพาะหัวหน้า');
    expect(await err(await x.device(VIEW_EMAIL), ['T2611-0002'], 'check')).toMatch(/ดูได้อย่างเดียว/);
    expect(await err(x.head, ['T2611-0002'], 'approve')).toBe('T2611-0002 ยังไม่มีคนรับ');
    expect(await err(x.head, ['T2611-0003'], 'approve')).toBe('T2611-0003 ยังไม่มีผู้ตรวจ');
    expect(await err(x.head, ['T2611-0004'], 'check')).toBe('T2611-0004 รับของไม่ต้องตรวจ / อนุมัติ');
    expect(await err(x.head, ['T2611-0005'], 'check')).toBe('T2611-0005 คนทำตรวจใบของตัวเองไม่ได้');
    expect(await err(x.head, ['T2611-0002', 'T2611-0002'], 'check')).toBe('1 ใบทำไม่ได้ · T2611-0002 ซ้ำในรายการ');
    expect(await err(x.head, ['T2611-0002', 'T2611-9999'], 'check')).toBe('1 ใบทำไม่ได้ · T2611-9999 ไม่พบเลขที่นี้');
    expect(await err(x.head, Array.from({ length: 11 }, () => 'T2611-0002'), 'check')).toMatch(/ไม่เกิน 10 ใบ/);
    expect(await err(x.head, ['T2611-0002'], 'ok')).toMatch(/ไม่รู้จักคำสั่ง/);
    expect(x.store.dump()['meta/head'].ov || 0).toBe(0);   // ใบไหนไม่ผ่าน ไม่เขียนสักใบ

    x.tick(60000);
    expect(ok(await x.head.okSave(['T2611-0002'], 'check')).saved).toBe(1);   // หัวหน้าตรวจใบของคนลงรายการ
    expect(raw(x, 'T2611-0002')).toMatchObject({ ck: HEAD_EMAIL, ckName: 'หัวหน้าทดลอง', ckAt: NOW + 60000, okAt: NOW + 60000 });
    expect(raw(x, 'T2611-0002').ap).toBeUndefined();
    expect(x.store.dump()['meta/head'].ov).toBe(1);   // ov ของการตรวจ / อนุมัติ แยกจาก tv ของเลข TRcloud
    expect(x.store.dump()['meta/head'].tv || 0).toBe(0);
    expect(await stOf(x.staff, 'T2611-0002')).toBe('approve');
    expect(await err(x.staff, ['T2611-0002'], 'check')).toBe('T2611-0002 รับแล้ว');
    ok(await x.head.okSave(['T2611-0002'], 'approve'));   // หัวหน้าคนเดียวกันตรวจแล้วอนุมัติได้
    expect(raw(x, 'T2611-0002')).toMatchObject({ ck: HEAD_EMAIL, ap: HEAD_EMAIL, apName: 'หัวหน้าทดลอง', apAt: NOW + 60000 });
    expect(await stOf(x.head, 'T2611-0002')).toBe('done');
    expect(await err(x.head, ['T2611-0002'], 'approve')).toBe('T2611-0002 อนุมัติแล้ว');
    /* ใบของหัวหน้า: คนอื่นตรวจ แล้วหัวหน้าอนุมัติเองได้ */
    ok(await x.staff.okSave(['T2611-0005'], 'check'));
    ok(await x.head.okSave(['T2611-0005'], 'approve'));
    expect(raw(x, 'T2611-0005')).toMatchObject({ ck: STAFF_EMAIL, ckName: 'ทดลอง', ap: HEAD_EMAIL });
    /* หัวหน้าตรวจ + อนุมัติในครั้งเดียว */
    ok(await x.head.okSave(['T2611-0003'], 'both'));
    expect(raw(x, 'T2611-0003')).toMatchObject({ ck: HEAD_EMAIL, ap: HEAD_EMAIL, ckAt: NOW + 60000, apAt: NOW + 60000, okAt: NOW + 60000 });
    expect(x.store.dump()['meta/head'].ov).toBe(5);
    /* ยกเลิกก่อนอนุมัติ = ไม่ต้องตรวจแล้ว (ใบกลับรายการก็ไม่ต้อง) · ยกเลิกหลังอนุมัติ ยังเห็นว่าอนุมัติแล้ว */
    ok(await x.staff.post('bk-move', body('m-3', [mv3()])));                 // T2611-0006
    ok(await x.head.post('bk-void', { doc: 'T2611-0006', why: 'ลงผิด' }));   // 0007
    ok(await x.head.post('bk-void', { doc: 'T2611-0002', why: 'ย้ายผิด' })); // 0008
    expect(await Promise.all(['T2611-0006', 'T2611-0007', 'T2611-0002', 'T2611-0008'].map((n) => stOf(x.head, n)))).toEqual(['', '', 'done', '']);
    expect(await err(x.head, ['T2611-0006'], 'check')).toBe('T2611-0006 ใบนี้ยกเลิกแล้ว');
    /* ยอดไม่เปลี่ยนเพราะการตรวจ / อนุมัติ */
    expect((await x.head.post('bk-rebuild', {})).same).toBe(true);
  });

  it('Rules: ช่องตรวจ / อนุมัติแก้ได้ตามขั้น เฉพาะใบย้าย / แปลง · ปนกับช่องอื่นไม่ได้ · firestore.rules ตรงกัน', async () => {
    const x = await ready();
    const as = (email) => { x.store.setUser({ email, verified: true }); return x.store; };
    const d2 = raw(x, 'T2611-0002'), p2 = pathOf(x, 'T2611-0002');
    const nm = (email) => x.store.dump()['users/' + email].name;
    const ck = (email, name = nm(email)) => ({ ck: email, ckName: name, ckAt: C.TIME, okAt: C.TIME });
    const ap = (email, name = nm(email)) => ({ ap: email, apName: name, apAt: C.TIME, okAt: C.TIME });
    await expect(as(STAFF_EMAIL).commit([[p2, { ...d2, ...ck(STAFF_EMAIL) }]])).rejects.toThrow(/คนทำตรวจใบของตัวเองไม่ได้/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(STAFF_EMAIL) }]])).rejects.toThrow(/ผู้ตรวจต้องเป็นคนที่ล็อกอิน/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL), ckAt: 5 }]])).rejects.toThrow(/ช่องผู้ตรวจไม่ถูก/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL, 'ก'.repeat(61)) }]])).rejects.toThrow(/ช่องผู้ตรวจไม่ถูก/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL), okAt: 5 }]])).rejects.toThrow(/okAt ต้องเป็นเวลาเซิร์ฟเวอร์/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ap(HEAD_EMAIL) }]])).rejects.toThrow(/ต้องมีผู้ตรวจก่อนอนุมัติ/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL), tr: 'ADJ-1' }]])).rejects.toThrow(/แก้ได้เฉพาะเลข TRcloud/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL), qty: 99 }]])).rejects.toThrow(/แก้ได้เฉพาะเลข TRcloud/);
    await expect(as(VIEW_EMAIL).commit([[p2, { ...d2, ...ck(VIEW_EMAIL) }]])).rejects.toThrow(/ดูได้อย่างเดียว/);
    const g = raw(x, 'T2611-0004');
    await expect(as(HEAD_EMAIL).commit([[pathOf(x, 'T2611-0004'), { ...g, ...ck(HEAD_EMAIL) }]])).rejects.toThrow(/เฉพาะใบย้ายกับแปลง/);
    /* คนลงรายการตรวจได้ อนุมัติไม่ได้ · ตรวจแล้วเปลี่ยนผู้ตรวจไม่ได้ */
    await expect(as(STAFF_EMAIL).commit([[pathOf(x, 'T2611-0005'), { ...raw(x, 'T2611-0005'), ...ck(STAFF_EMAIL), ...ap(STAFF_EMAIL) }]])).rejects.toThrow(/อนุมัติได้เฉพาะหัวหน้า/);
    await expect(as(STAFF_EMAIL).commit([[p2, { ...d2, tr: 'ADJ-1', trState: 'done', trBy: STAFF_EMAIL, trAt: C.TIME }]])).rejects.toThrow(/ยังไม่อนุมัติ/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2, ...ck(HEAD_EMAIL), ...ap(HEAD_EMAIL) }]])).resolves.toBeUndefined();   // หัวหน้าตรวจ + อนุมัติคำขอเดียว
    const d2b = raw(x, 'T2611-0002');
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2b, ...ck(HEAD_EMAIL, 'ใหม่') }]])).rejects.toThrow(/ใบนี้ตรวจแล้ว/);
    await expect(as(HEAD_EMAIL).commit([[p2, { ...d2b, ...ap(HEAD_EMAIL, 'ใหม่') }]])).rejects.toThrow(/ใบนี้อนุมัติแล้ว/);
    /* เลข TRcloud ยังใส่ได้หลังอนุมัติ (คนละช่องกัน) */
    await expect(as(STAFF_EMAIL).commit([[p2, { ...d2b, tr: 'ADJ-1', trState: 'done', trBy: STAFF_EMAIL, trAt: C.TIME }]])).resolves.toBeUndefined();
    /* firestore.rules: ประเภท ช่อง และขั้นเดียวกับ store จำลอง */
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    const fn = /function okUpdate\(d, old, u\) \{([\s\S]*?)\n  \}/.exec(rules)[1];
    expect(fn).toContain(`old.type in [${C.OK_TYPES.map((t) => `'${t}'`).join(', ')}]`);
    expect(fn).toContain(`keys.hasOnly([${C.OK_KEYS.map((k) => `'${k}'`).join(', ')}])`);
    for (const k of ["d.ck != old.by", "d.ck == email()", "isHead(u)", "d.get('ck', '') != ''", "old.get('ck', '') == ''", "old.get('ap', '') == ''", 'd.okAt == request.time', 'd.ckName.size() <= 60', 'd.apName.size() <= 60'])
      expect(fn, k).toContain(k);
    expect(rules).toMatch(/allow update: if signedIn\(\) && docUpdate\(request\.resource\.data, resource\.data, profile\(\)\);/);
    expect(rules).toContain("function docUpdate(d, old, u) { return !('of' in old) && (trUpdate(d, old, u) || okUpdate(d, old, u)); }");
  });

  it('เครื่องอื่นเห็นการตรวจ / อนุมัติในรอบดึงถัดไป (tv + okAt) · อ่านเพิ่มแค่ใบที่เปลี่ยน · เลข TRcloud กับการอนุมัติไม่ทับกัน', async () => {
    const x = await ready();
    const v = await x.device(VIEW_EMAIL);
    await v.sync();
    x.tick(60000);
    ok(await x.head.okSave(['T2611-0002', 'T2611-0003'], 'both'));
    x.tick(60000);
    ok(await x.staff.trSave([{ no: 'T2611-0002', tr: 'ADJ-1', state: 'done' }]));
    const r0 = x.store.stats().reads;
    await v.sync();
    expect(x.store.stats().reads - r0).toBe(1 + 1 + 2);   // meta + เลข TRcloud 1 ใบ + ตรวจ / อนุมัติ 2 ใบ
    const d = v.local().docs.find((y) => y.no === 'T2611-0002');
    expect(d).toMatchObject({ tr: 'ADJ-1', trState: 'done', ck: HEAD_EMAIL, ap: HEAD_EMAIL, okAt: NOW + 60000, trAt: NOW + 120000 });
    expect(v.local().okAt).toBe(NOW + 60000);
    /* ไม่มีอะไรเปลี่ยน = อ่าน meta อย่างเดียว */
    const r1 = x.store.stats().reads;
    await v.sync();
    expect(x.store.stats().reads - r1).toBe(1);
    /* ตรวจ / อนุมัติอย่างเดียว: เครื่องอื่นดึงเฉพาะการตรวจ / อนุมัติ ไม่ดึงเลข TRcloud ซ้ำ (ov แยกจาก tv) */
    x.tick(60000);
    ok(await x.staff.okSave(['T2611-0005'], 'check'));
    const r2 = x.store.stats().reads;
    await v.sync();
    expect(x.store.stats().reads - r2).toBe(1 + 3);   // meta + ตรวจ / อนุมัติ (2 ใบรอบก่อน ย้อนเวลาเดิม + 1 ใบใหม่) · ไม่ดึงเลข TRcloud
    x.tick(60000);
    ok(await x.staff.trSave([{ no: 'T2611-0003', tr: 'MR-1', state: 'done' }]));
    const r3 = x.store.stats().reads;
    await v.sync();
    expect(x.store.stats().reads - r3).toBe(1 + 2);   // meta + เลข TRcloud (1 ใบรอบก่อน + 1 ใบใหม่) · ไม่ดึงการตรวจ / อนุมัติ
    /* เครื่องใหม่ได้ช่องตรวจ / อนุมัติมากับเอกสารเลย · หน้าเอกสารเห็นขั้น ผู้ตรวจ ผู้อนุมัติ */
    const n = await x.device(VIEW_EMAIL);
    await n.sync();
    expect(n.local().docs.find((y) => y.no === 'T2611-0003')).toMatchObject({ ck: HEAD_EMAIL, ap: HEAD_EMAIL });
    const view = DOC.view(n.local(), 'T2611-0002');
    expect(view).toMatchObject({ ok: 'done', okTh: 'อนุมัติแล้ว', ck: { email: HEAD_EMAIL, name: 'หัวหน้าทดลอง' }, ap: { email: HEAD_EMAIL, name: 'หัวหน้าทดลอง' } });
    expect(view.steps.map((s) => [s.k, s.state])).toEqual([['save', 'done'], ['check', 'done'], ['approve', 'done'], ['tr', 'done']]);
    expect(view.history.map((h) => h.what).slice(1)).toEqual(['รับแล้ว', 'อนุมัติ', 'ใส่เลข TRcloud ADJ-1']);   // เรียงตามเวลา
    expect(n.local().ov).toBe(2);
    expect(v.local().ov).toBe(2);
  });

  it('หน้าเอกสาร: ชิป รอตรวจ / รออนุมัติ นับถูก · ปุ่มของแต่ละคน (okCan ตรงกับ okSet) · หน้าวันนี้นับงานรอตรวจทุกวัน', async () => {
    const x = await ready();
    ok(await x.staff.okSave(['T2611-0005'], 'check'));
    await x.head.sync();
    const l = x.head.local(), list = DOC.index(l);
    expect(list.filter((d) => d.ok).map((d) => [d.no, d.ok])).toEqual([['T2611-0005', 'approve'], ['T2611-0003', 'check'], ['T2611-0002', 'check']]);
    const r = DOC.search(list, { email: STAFF_EMAIL }, NOW);
    expect(r.states).toMatchObject({ recv: 1, check: 1, approve: 1 });
    expect(DOC.search(list, { status: 'recv' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0002']);
    expect(DOC.search(list, { status: 'check' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0003']);
    expect(DOC.search(list, { status: 'approve' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0005']);
    expect(DOC.search(list, { text: 'ทดลอง', status: 'approve' }, NOW).list.map((d) => d.no)).toEqual(['T2611-0005']);   // ค้นชื่อผู้ตรวจได้
    const staff = { email: STAFF_EMAIL, role: 'staff' }, head = { email: HEAD_EMAIL, role: 'head' }, viewer = { email: VIEW_EMAIL, role: 'viewer' };
    const can = (no, u) => DOC.okCan(DOC.view(l, no), u);
    expect(can('T2611-0002', staff)).toMatchObject({ check: false, both: false, reject: false, why: 'คนทำรับใบของตัวเองไม่ได้ ให้คนอื่นรับ' });
    expect(can('T2611-0002', head)).toMatchObject({ check: true, both: true, approve: false });
    expect(can('T2611-0005', staff)).toMatchObject({ approve: false, why: 'รอหัวหน้าอนุมัติ' });
    expect(can('T2611-0005', head)).toMatchObject({ approve: true, check: false });
    expect(can('T2611-0002', viewer)).toMatchObject({ check: false, why: 'บัญชีนี้ดูได้อย่างเดียว' });
    expect(can('T2611-0004', head)).toEqual({ check: false, approve: false, both: false, reject: false, why: '' });   // รับของ ไม่มีปุ่ม
    /* okCan บอกว่ากดได้ = okSet ผ่านจริง */
    const users = { staff: [staff, x.staff], head: [head, x.head] };
    for (const no of ['T2611-0002', 'T2611-0003', 'T2611-0005']) for (const who of ['staff', 'head']) {
      const c = can(no, users[who][0]);
      for (const act of ['check', 'approve', 'both', 'reject']) expect(!C.okSet(l, [no], { ...users[who][0], name: 'x' }, act, 'ของไม่ครบ').error, `${no} ${who} ${act}`).toBe(!!c[act]);
    }
    /* หน้าวันนี้: รอตรวจ (คนอื่นทำ = เราตรวจได้) รออนุมัติ นับทุกวัน ไม่ใช่แค่วันนี้ */
    const h = DOC.home(l, NOW + 3 * DAY, HEAD_EMAIL);
    expect(h.ok).toEqual({ check: 1, toCheck: 1, approve: 1, oldest: '2026-11-10', days: 3, recv: 1, toRecv: 1, recvDays: 3, sent: 0, sentDays: 0, reject: 0 });
    expect(DOC.home(l, NOW, STAFF_EMAIL).ok).toMatchObject({ check: 1, toCheck: 0, approve: 1, recv: 1, toRecv: 0, sent: 1 });
  });

  it('ใบพิมพ์ A5 แบบเอกสารคลังสินค้า: หัวใบ ตาราง ช่องเซ็น 3 ช่องตามขั้น · แถวเกินขึ้นแผ่นใหม่ · ใบยกเลิกมีตรา · ไม่มีไฟล์ภายนอก', async () => {
    const x = await ready();
    /* ใบย้าย 23 แถว = 3 แผ่น (แผ่นละ 10) */
    const many = Array.from({ length: 23 }, () => mv3({ 6: 0.25 }));
    ok(await x.staff.post('bk-move', body('m-9', many)));                  // T2611-0006
    await x.head.sync();
    const l = x.head.local();
    const mv = DOC.view(l, 'T2611-0006');
    expect(PR.can(mv)).toBe(true);
    expect(PR.pages(mv).map((p) => p.length)).toEqual([10, 10, 3]);
    const h1 = PR.html(mv, { logo: '', printed: '10/11/69 10:00' });
    expect(h1).toMatch(/^<!doctype html>/);
    expect(h1.match(/<section class="pg">/g)).toHaveLength(3);
    expect(h1).toContain('Transfer Request Form');
    expect(h1).toContain('( ใบโอนย้ายสินค้า )');
    expect(h1.match(/>ผู้จัดทำ</g)).toHaveLength(3);   // ช่องเซ็นซ้ำทุกแผ่น
    for (const k of ['>ผู้ตรวจสอบ<', '>ผู้อนุมัติ<', 'ทดลอง · 10/11/69 10:00', 'แผ่น 3/3', 'ยกไปแผ่นถัดไป', '>รวม<', '5.75', 'ที่นอนสมมติ 1', 'โอนข้าม Location', '@page{size:210mm 148mm']) expect(h1, k).toContain(k);
    expect(h1).toContain('รอตรวจ');
    expect(h1).not.toMatch(/https?:\/\/|<script|<link/);   // พิมพ์จาก iframe ไม่ต้องโหลดอะไร
    /* ใบเข้า QA: จุดประสงค์ QA จาก / ไป คลัง · ตรวจ + อนุมัติแล้ว ชื่อและเวลาขึ้นในช่องเซ็น */
    x.tick(60000);
    ok(await x.head.okSave(['T2611-0002'], 'both'));
    await x.head.sync();
    const qa = DOC.view(x.head.local(), 'T2611-0002');
    const h2 = PR.html(qa, {});
    for (const k of ['ตรวจสอบสินค้า (QA)', 'WH-02', 'WH-QA', 'หัวหน้าทดลอง · 10/11/69 10:01', 'อนุมัติแล้ว', 'แผ่น 1/1']) expect(h2, k).toContain(k);
    expect(h2).not.toContain('( .............................. )');   // ครบสามช่อง ไม่เหลือช่องว่าง
    /* ใบแปลง: คู่ เบิก → รับ เป็นแถวเดียว แผ่นละ 9 คู่ */
    const cv = DOC.view(x.head.local(), 'T2611-0003');
    expect(PR.items(cv)).toEqual([{ sku: 'BBB002', name: 'ท็อปเปอร์สมมติ 2', sku2: 'CCC004', name2: 'หมอนสมมติ 4', lot: '7', po: 'P5', loc: 'A-03-01', qty: 2 }]);
    const h3 = PR.html(cv, {});
    for (const k of ['Code Conversion', '( ใบขอแปลงรหัสสินค้า )', 'MR6911-0001', 'SKU ปลายทาง']) expect(h3, k).toContain(k);
    expect(h3.match(/<td class="no">/g)).toHaveLength(9);
    /* ใบยกเลิก: ตรา ยกเลิก + เลขใบกลับรายการ · ใบกลับรายการ / ตัดขาย ไม่มีใบพิมพ์ */
    ok(await x.head.post('bk-void', { doc: 'T2611-0006', why: 'ลงผิด' }));   // 0007
    await x.head.sync();
    const vd = DOC.view(x.head.local(), 'T2611-0006');
    expect(PR.html(vd, {})).toContain('<div class="stamp">ยกเลิก</div>');
    expect(PR.html(vd, {})).toContain('(ลงกลับเป็น T2611-0007)');
    expect(PR.can(DOC.view(x.head.local(), 'T2611-0007'))).toBe(false);
    expect(PR.can(DOC.view(x.head.local(), 'T2611-0004'))).toBe(false);
    expect(PR.html(DOC.view(x.head.local(), 'T2611-0004'), {})).toBe('');
    /* ชื่อสินค้าที่มีอักษรพิเศษไม่ทำหน้าพัง */
    expect(PR.html({ ...qa, names: { AAA0000000001: '<b>"x"</b>' } }, {})).toContain('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });

  it('หน้าแอปต่อสาย: โหลดใบพิมพ์ก่อน wms-fire.js · ปุ่มตรวจ / อนุมัติเรียก okSave ทีละไม่เกิน 10 ใบ · พิมพ์ผ่าน iframe · หน้ารอลง TRcloud ล็อกใบที่ยังไม่อนุมัติ', () => {
    const bf = read('book/book-fire.js');
    expect(bf.indexOf("script('../wms-fire-print.js')")).toBeGreaterThan(bf.indexOf("script('../wms-fire-docs.js')"));
    expect(bf.indexOf("script('../wms-fire-print.js')")).toBeLessThan(bf.indexOf("script('../wms-fire.js')"));
    expect(bf).toContain('okSave: async function (nos, act, why)');
    expect(bf).toContain('i += max');
    expect(bf).toContain('okOf: function (no)');
    const app = read('book/book-app.js');
    for (const k of ['FIRE.okSave(nos, act, why)', 'WmsFireDocs.okCan(v, me())', 'P.html(v, {', 'fr.srcdoc = html', "['check', 'รอตรวจ', 'c-warn']", "['approve', 'รออนุมัติ', 'c-warn']"]) expect(app, k).toContain(k);
    expect(read('book/index.html')).toContain('data-print="${esc(LAST.doc)}"');
    expect(read('book/index.html')).toContain('APP.okMode(MODE)');
    expect(read('book/book-fire-trc.js')).toContain('function held(x) { return !!x.lock; }');
    expect(read('book/index.html')).toContain('../wms-settings.js');   // โลโก้ของใบพิมพ์มาจากหน้าตั้งค่า
    const src = read('wms-fire-print.js');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src.match(/https?:\/\/[^'"\s)]+/g) || []).toEqual([]);
  });
});

describe('หน้า สินค้า / โล: อยู่โลไหน คงเหลือ สต๊อกการ์ด (wms-fire-item.js)', () => {
  /* T2611-0001 ยอดยกมา · 0002 ย้าย R01-01-01 → A-01-01 · 0003 เข้า QA · 0004 รับของ R01-02-01 · 0005 ตัดขาย A-01-01 · 0006 ปรับยอด A-01-01 −2 */
  async function ready() {
    const x = await both();
    await x.open();
    ok(await x.staff.post('bk-move', body('m-1', [mv3()])));
    ok(await x.staff.post('bk-move', body('m-2', [QA_MV])));
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));
    ok(await x.staff.post('bk-cut', cutBody('c-1', [saleLine('77', 1)])));
    ok(await x.head.post('bk-adj', body('a-1', [ADJ3], { lines: ADJ_LINES })));
    await x.head.sync();
    const res = x.head.fifo();
    res.cap = { rows: [['AAA001', '', 10]] };
    res.convert = { pairs: [['BBB0000000002', 'AAA0000000001', 'ที่นอนสมมติ 1']] };   // BBB แปลงมาจาก AAA
    res.sup = { rows: [['P1', 'ผู้ขายสมมติ ก']] };
    const st = B.stock(res);
    return { x, res, st, ix: IT.index(st, '2026-11-10') };
  }
  const item = (ix, long) => ix.list.find((it) => it.long === long);

  it('ทุก SKU: รวม เปิดขาย สำรอง QA โลที่มีของ Supplier วันรับเก่าสุด · ชิปนับถูก', async () => {
    const { ix } = await ready();
    expect(ix.list.map((it) => it.sku)).toEqual(['AAA001', 'BBB002', 'CCC004']);
    expect(item(ix, 'AAA0000000001')).toMatchObject({
      name: 'ที่นอนสมมติ 1', total: 36, have: 36, open: 24, reserve: 11, qa: 1, neg: 0, nNeg: 0,
      openLocs: ['A-01-01', 'A-01-02'], sups: ['ผู้ขายสมมติ ก'], first: '2026-10-02', age: 39,
    });
    expect(item(ix, 'AAA0000000001').locs.sort()).toEqual(['A-01-01', 'A-01-02', 'QA', 'R01-01-01', 'R01-02-01']);
    expect(item(ix, 'CCC0000000004')).toMatchObject({ total: 3, qa: 3, open: 0 });
    expect(ix.skus).toBe(3);
    const r = IT.search(ix, '', 'have');
    expect(r.counts).toEqual({ have: 3, open: 2, qa: 2, neg: 0, zero: 0, all: 3 });
    expect(IT.search(ix, '', 'qa').list.map((it) => it.sku)).toEqual(['AAA001', 'CCC004']);
    expect(IT.search(ix, '', 'แปลก').chip).toBe('have');
  });

  it('ค้น: ทุกคำต้องเจอ · LOT พิมพ์ lot10 · ชื่อ · Supplier · ชื่อโล = ของในโลนั้น (ตรงตัว หรือต้นชื่อที่มี -)', async () => {
    const { ix } = await ready();
    const skus = (q, chip = 'all') => IT.search(ix, q, chip).list.map((it) => it.sku);
    expect(skus('ท็อปเปอร์')).toEqual(['BBB002']);
    expect(skus('lot10')).toEqual(['AAA001']);
    expect(skus('ผู้ขายสมมติ')).toEqual(['AAA001']);
    expect(skus('ที่นอน a-03')).toEqual([]);
    expect(skus('a-01-02')).toEqual(['AAA001']);
    const qa = IT.search(ix, 'qa', 'all').loc;
    expect(qa).toMatchObject({ q: 'QA', locs: ['QA'], total: 4 });
    expect(qa.piles.map((p) => [p.s, p.qty, p.st])).toEqual([[0, 1, 'qa'], [2, 3, 'qa']]);
    const r01 = IT.search(ix, 'R01', 'all').loc;
    expect(r01).toBeNull();                                                                   // ไม่มี - ไม่เดาเป็นต้นชื่อโล
    const r0 = IT.search(ix, 'r01-0', 'all').loc;
    expect(r0.locs).toEqual(['R01-01-01', 'R01-02-01']);
    expect(r0.total).toBe(11);
    expect(IT.search(ix, 'a-01 ที่นอน', 'all').loc).toBeNull();                                // หลายคำ = ค้น SKU
  });

  it('SKU เดียว: ลำดับตัด FIFO ตัดก่อน วันรับ อายุ Supplier ความจุต่อพาเลท คู่แปลงพร้อมยอด', async () => {
    const { ix, res, st } = await ready();
    const d = IT.detail(ix, res, st, 'AAA001');
    expect(d).toMatchObject({ sku: 'AAA001', long: 'AAA0000000001', total: 36, cap: 10, pallets: 3.6 });
    expect(d.piles.map((p) => p.loc + '|' + p.lot + '|' + p.po)).toEqual(st.all[0].map((p) => p.loc + '|' + p.lot + '|' + p.po));   // ลำดับตัดเดียวกับหน้าตัดขาย
    const a = d.piles.find((p) => p.loc === 'A-01-01');
    expect(a).toMatchObject({ lot: '8', po: 'P1', qty: 18, st: 'open', first: '2026-10-02', age: 39, sup: 'ผู้ขายสมมติ ก' });
    expect(d.piles.find((p) => p.loc === 'R01-02-01')).toMatchObject({ qty: 3, st: 'reserve', first: '2026-11-09', age: 1 });
    expect(d.piles.find((p) => p.loc === 'QA')).toMatchObject({ qty: 1, st: 'qa' });
    expect(d.piles[d.next].st).toBe('open');
    expect(d.piles.slice(0, d.next).every((p) => p.st !== 'open')).toBe(true);
    expect(d.from).toEqual([]);
    expect(d.to).toEqual([{ code: 'BBB0000000002', s: 1, sku: 'BBB002', name: 'ท็อปเปอร์สมมติ 2', total: 4 }]);
    const b = IT.detail(ix, res, st, 'BBB0000000002');
    expect(b.from).toEqual([{ code: 'AAA0000000001', s: 0, sku: 'AAA001', name: 'ที่นอนสมมติ 1', total: 36 }]);
    expect(b.cap).toBeNull();
    expect(IT.detail(ix, res, st, 'ZZZ999')).toBeNull();
  });

  it('สต๊อกการ์ด: ทุกแถวตั้งแต่ยอดยกมา คงเหลือสุดท้ายเท่ายอดรวม · เฉพาะโล · ใบที่ยกเลิกกับใบกลับรายการหักล้างกัน', async () => {
    const { x, ix } = await ready();
    const c = IT.card(x.head.local(), 'AAA0000000001', { sku: 'AAA001' });
    expect(c.rows.map((r) => [r.no, r.kind, r.delta, r.bal])).toEqual([
      ['T2611-0001', 'in', 20, 20], ['T2611-0001', 'in', 10, 30], ['T2611-0001', 'in', 6, 36],
      ['T2611-0002', 'move', 0, 36], ['T2611-0003', 'move', 0, 36], ['T2611-0004', 'in', 3, 39],
      ['T2611-0005', 'out', -1, 38], ['T2611-0006', 'out', -2, 36],
    ]);
    expect(c.bal).toBe(item(ix, 'AAA0000000001').total);
    expect([c.inQ, c.outQ]).toEqual([39, 3]);
    expect(c.rows[3]).toMatchObject({ type: 'ย้าย', from: 'R01-01-01', to: 'A-01-01', qty: 1, open: true, who: 'ทดลอง', date: '2026-11-10' });
    const r = IT.card(x.head.local(), 'AAA0000000001', { loc: 'r01-01-01' });
    expect(r.loc).toBe('R01-01-01');
    expect(r.rows.map((y) => [y.no, y.kind, y.delta, y.bal])).toEqual([['T2611-0001', 'in', 10, 10], ['T2611-0002', 'out', -1, 9], ['T2611-0003', 'out', -1, 8]]);
    expect(IT.card(x.head.local(), 'AAA0000000001', { loc: 'A-01-01' }).bal).toBe(18);
    expect(IT.card(x.head.local(), 'AAA0000000001', { loc: 'QA' }).rows.map((y) => [y.kind, y.bal])).toEqual([['in', 1]]);
    expect(IT.card(x.head.local(), 'CCC0000000004').bal).toBe(3);

    ok(await x.head.post('bk-void', { doc: 'T2611-0006', why: 'ลงผิด' }));
    const v = IT.card(x.head.local(), 'AAA0000000001');
    expect(v.rows.slice(-2).map((y) => [y.no, y.voided, y.rev, y.delta, y.bal])).toEqual([['T2611-0006', true, false, -2, 36], ['T2611-0007', false, true, 2, 38]]);
    const res = x.head.fifo();
    expect(IT.index(B.stock(res), '2026-11-10').list[0].total).toBe(38);
  });

  it('กองติดลบนับในยอดรวม (เท่าการ์ด) · ชิปติดลบ / หมดแล้ว · SKU ที่ไม่มีของ', () => {
    const p = (o) => Object.assign({ s: 0, lot: '1', po: 'P', loc: 'A-01', qty: 5, open: true, first: '2026-11-01', sup: '' }, o);
    const st = {
      skus: [['X1', 'X0000000001', 'สินค้า X'], ['Y2', 'Y0000000002', 'สินค้า Y'], ['Z3', 'Z0000000003', 'สินค้า Z']],
      all: { 0: [p({}), p({ loc: 'R01-01', open: false, qty: 7, first: '' })] },
      neg: [p({ s: 1, loc: 'A-02', qty: -2 })],
      code: (c) => ({ X1: 0, X0000000001: 0, Y2: 1, Z3: 2 }[String(c).toUpperCase()] ?? -1),
    };
    const ix = IT.index(st, '2026-11-10');
    expect(ix.by[0]).toMatchObject({ total: 12, open: 5, reserve: 7, age: 9, first: '2026-11-01' });
    expect(ix.by[0].piles[1].age).toBeNull();
    expect(ix.by[1]).toMatchObject({ total: -2, have: 0, neg: -2, nNeg: 1, locs: ['A-02'] });
    expect(ix.by[2]).toMatchObject({ total: 0, have: 0, nNeg: 0 });
    expect(IT.search(ix, '', 'have').counts).toEqual({ have: 1, open: 1, qa: 0, neg: 1, zero: 1, all: 3 });
    expect(IT.search(ix, '', 'zero').list.map((it) => it.sku)).toEqual(['Z3']);
    expect(IT.search(ix, 'a-02', 'all').loc.piles.map((x) => [x.s, x.qty, x.st])).toEqual([[1, -2, 'neg']]);
    const d = IT.detail(ix, {}, st, 'Y2');
    expect(d.piles.map((x) => x.st)).toEqual(['neg']);
    expect(d.next).toBe(-1);
    expect(d.pallets).toBeNull();
  });

  it('แอป: เมนู สินค้า / โล ทุกคนเห็น · BookFire โหลด wms-fire-item.js และเปิด card · ลิงก์ #sku= · ‹ กลับ จากใบที่เปิดจากการ์ด', () => {
    const app = read('book/book-app.js'), bf = read('book/book-fire.js'), page = read('book/index.html'), ui = read('book/book-item.js');
    expect(app).toContain("{ k: 'item', t: 'สินค้า / โล' }");
    expect(app).not.toMatch(/k: 'item'[^}]*head/);
    expect(bf.indexOf("script('../wms-fire-item.js')")).toBeGreaterThan(bf.indexOf("script('../wms-fire-docs.js')"));
    expect(bf.indexOf("script('../wms-fire-item.js')")).toBeLessThan(bf.indexOf("script('../wms-fire.js')"));
    expect(bf).toContain('window.WmsFireItem.card(fire.local(), code, opt)');
    expect(page.indexOf('<script src="book-item.js"></script>')).toBeGreaterThan(page.indexOf('<script src="book-app.js"></script>'));
    expect(page).toContain("const APP_PAGES = { home: 1, docs: 1, item: 1, close: 1, master: 1 }");
    expect(app).toContain("if (no && MODE === 'item') BACK = 'item';");
    expect(app).toContain("BookItem.fromHash() ? 'item' : 'home'");
    for (const k of ['#sku=', 'FIRE.card(d.long || d.sku, { sku: d.sku, loc: S.loc })', 'data-doc="', 'copyText(']) expect(ui, k).toContain(k);
    const src = read('wms-fire-item.js') + ui;
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src).not.toMatch(/\.get\(|\.commit\(|store\./);                                  // ไม่อ่านไม่เขียนฐาน คิดจากสำเนาในเครื่อง
  });
});

describe('หน้ารายงานอ่านจากระบบใหม่ (wms-fire-tx.js · wms-fire-src.js)', () => {
  /** สมุดที่มีครบทุกแบบ: ยอดยกมา ขาย ย้าย รับของ แปลง ปรับยอด แถวขายแก้มือ รับคืน ยกเลิก (ทั้งสองระบบได้ชุดเดียวกัน) */
  async function busyBook() {
    const x = await both();
    await x.open();
    await x.same('me', 'bk-cut', cutBody('c-1', [saleLine('1', 2), saleLine('2', 1)]));
    const mv = ['AAA001', 'AAA0000000001', '8', 'P1', 'R01-01-01', 'A-01-01', 4, 'เบิก', 'โอนย้าย', 'เปิด'];
    await x.same('me', 'bk-move', body('m-1', [mv, Object.assign(mv.slice(), { 6: 1, 5: 'RIB', 8: 'โอนย้าย QA', 9: '' })]));
    await x.same('me', 'bk-gr', body('g-1', [['AAA001', 'AAA0000000001', '10', 'P9', '', 'R01-02-01', 3, 'รับ', 'GR 09-11-26', '', 'GR6911-0001']]));
    await x.same('me', 'bk-conv', body('v-1', [
      ['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
      ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR6911-0002'],
    ]));
    await x.same('head', 'bk-adj', body('a-2', [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', '']],
      { lines: [{ loc: 'A-01-01', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 21, count: 19 }] }));
    await x.same('head', 'bk-rows', body('r-1', [['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 1, 'ขาย', '2026-11-09', ''],
      ['AAA001', 'AAA0000000001', '0', '0', '', 'RIB', 1, 'รับ', 'RETURN', '']], { ref: 'แก้มือ' }));
    await x.same('me', 'bk-cut', cutBody('c-2', [saleLine('3', 1, 'A-01-02', '9', 'P2')]));
    await x.same('head', 'bk-void', { doc: 'T2611-0008', why: 'ตัดผิด' });
    await x.head.sync();
    expect(x.head.local().docs.map((d) => d.type)).toEqual(['ยอดยกมา', 'ตัดขาย', 'ย้าย', 'รับของ', 'แปลง', 'ปรับยอด', 'ตารางเดิม', 'ตัดขาย', 'กลับรายการ']);
    return x;
  }
  const noDoc = (h) => ({ ...h, items: h.items.map(({ doc, ...it }) => it) });

  it('tx-summary tx-daily tx-history คิดจากสำเนาในเครื่อง = tx-api.gs อ่านแท็บ Transaction ของสมุดใหม่ ทุกช่อง', async () => {
    const x = await busyBook();
    const local = x.head.local(), now = Date.now();   // tx-api.gs ใช้วันที่จริงของเครื่อง
    const tx = (p) => txFromBook(x.gas.ss, p, { nameInL: true });   // ชื่อคนบันทึกอยู่ช่อง L แบบชีตเดิม
    /* สมุดใหม่ช่อง L ว่าง: tx-api.gs อ่านตรง ๆ จะว่าทุกแถวไม่มีชื่อคนกรอก ระบบใหม่รู้คนบันทึกทุกใบ */
    expect(txFromBook(x.gas.ss, { api: 'tx-summary' }).issues.counts.incomplete).toBe(TX.rows(local).length);
    expect(TX.summary(local, now).issues.counts.incomplete).toBeUndefined();
    expect([...new Set(TX.rows(local).map((r) => r.who))].sort()).toEqual(['ทดลอง', 'หัวหน้าทดลอง']);
    const gs = tx({ api: 'tx-summary' }), fs_ = TX.summary(local, now);
    for (const k of ['rows', 'lastRow', 'lastDate', 'saleDays', 'sold', 'skus', 'locs', 'keys', 'issues', 'sup']) expect(fs_[k], k).toEqual(gs[k]);
    expect(fs_).toMatchObject({ app: 'transaction', fire: 1, sheet: null, backup: null });
    expect(fs_.keys.length).toBeGreaterThan(5);
    expect(fs_.sold.length).toBeGreaterThan(0);

    const gd = tx({ api: 'tx-daily', from: '2026-11-01', to: '2026-11-30' }), fd = TX.daily(local, now, '2026-11-01', '2026-11-30');
    for (const k of ['from', 'to', 'last', 'noDate', 'noSku', 'future', 'badQty', 'skus', 'days', 'cells', 'locs', 'whos', 'lines', 'convert', 'sup']) expect(fd[k], k).toEqual(gd[k]);
    expect(fd.days).toEqual(['2026-11-09', '2026-11-10']);
    const g1 = tx({ api: 'tx-daily', from: '2026-11-10', to: '2026-11-10' }), f1 = TX.daily(local, now, '2026-11-10', '2026-11-10');
    for (const k of ['days', 'cells', 'lines', 'last']) expect(f1[k], k).toEqual(g1[k]);

    for (const sku of ['AAA001', 'BBB0000000002', 'NOPE']) {
      const gh = tx({ api: 'tx-history', sku }), fh = TX.history(local, sku);
      expect({ ...noDoc(fh), sheet: undefined, fire: undefined }).toEqual({ ...gh, sheet: undefined, fire: undefined });
    }
    const h = TX.history(local, 'AAA001');
    expect(h.items[0].doc).toMatch(/^T2611-/);                                         // ระบบใหม่บอกเลขที่เอกสารด้วย
    expect(TX.history(local, '')).toEqual({ error: 'ไม่ได้ระบุ SKU' });
  });

  it('MASTER ที่นำเข้าในระบบใหม่ (แปลงสินค้า · PO. Truck) ขึ้นใน tx-daily / tx-summary รูปเดียวกับแท็บในชีต', async () => {
    const x = await busyBook();
    const local = { ...x.head.local(), master: {
      conv: { tab: 'MASTER แปลงสินค้า', cols: ['SKU หลังแปลง', 'SKU ตอนซื้อ'], blank: 1, rows: C.enc([['CCC0000000004', 'BBB0000000002'], ['ccc0000000004', 'BBB0000000002'], ['X', 'X']]) },
      sup: { tab: 'PO. Truck', dup: ['P9'], rows: C.enc([['p1', 'โรงงานสมมติ ก'], ['P9', 'โรงงานสมมติ ข']]) },
    } };
    const d = TX.daily(local, NOW, '', '');
    expect(d.convert).toEqual({ tab: 'MASTER แปลงสินค้า', cols: ['SKU หลังแปลง', 'SKU ตอนซื้อ'], pairs: [['CCC0000000004', 'BBB0000000002', 'ท็อปเปอร์สมมติ 2']], blank: 1 });
    expect(d.sup).toEqual({ tab: 'PO. Truck', rows: [['P1', 'โรงงานสมมติ ก'], ['P9', 'โรงงานสมมติ ข']], dup: ['P9'], missing: '' });
    expect(TX.summary(local, NOW).sup).toEqual(d.sup);
    /* ตรงกับ tx-fifo ของระบบใหม่ (หน้าอื่นใช้ convert / sup จาก tx-fifo) */
    const f = C.fifo(local, NOW);
    expect(d.convert.pairs).toEqual(f.convert.pairs);
    expect(d.sup.rows).toEqual(f.sup.rows);
  });

  /* ── wms-fire-src.js: หน้ารายงานส่ง URL 'fire:tx' ผ่าน WmsGas / WmsShared ── */

  function fakeFire(local, o = {}) {
    const st = { snaps: 0, changed: false, user: 'user' in o ? o.user : { who: 'หัวหน้าทดลอง', email: HEAD_EMAIL }, signed: [] };
    return {
      st, mode: o.mode || 'dev', label: 'ฐานทดลอง', pick: o.pick !== false,
      accounts: () => [{ email: HEAD_EMAIL, name: 'หัวหน้าทดลอง' }],
      restore: async () => st.user,
      signIn: async (e) => { st.signed.push(e === undefined ? 'google' : e); return o.signErr ? { error: o.signErr } : { who: 'x', email: e }; },
      snap: async () => { st.snaps++; return { local, now: NOW }; },
      changed: async () => st.changed,
    };
  }
  /** หน้ารายงานจำลอง: wms-settings (URL เดิม) → wms-gas → wms-shared → BookFire → wms-fire-src */
  function page(fire, oldUrl = '') {
    const calls = [];
    const node = () => ({ className: '', innerHTML: '', id: '', setAttribute() {}, addEventListener(t, f) { this.click = f; } });
    const body = { firstChild: null, insertBefore(n) { this.bar = n; } };
    const doc = { readyState: 'complete', body, head: { appendChild() {} }, createElement: node, getElementById: () => null, addEventListener() {} };
    const win = { WmsSettings: { txUrl: () => oldUrl }, WmsFireCore: C, WmsFireTx: TX, BookFire: fire };
    new Function('window', read('wms-gas.js'))(win);
    const realJson = win.WmsGas.json, realPost = win.WmsGas.post;
    win.WmsGas.json = (url, api, op) => (String(url).startsWith('fire:') ? realJson(url, api, op) : (calls.push(['get', url, api]), Promise.resolve({ app: 'transaction', old: 1 })));
    win.WmsGas.post = (url, b, op) => (String(url).startsWith('fire:') ? realPost(url, b, op) : (calls.push(['post', url, b.op]), Promise.resolve({ app: 'transaction', old: 1 })));
    new Function('window', 'localStorage', read('wms-shared.js'))(win, memLS());
    const loc = { reloads: 0, reload() { this.reloads++; } };
    new Function('window', 'document', 'location', read('wms-fire-src.js'))(win, doc, loc);
    const click = (attr, val) => body.bar.click({ target: { closest: () => ({ hasAttribute: (a) => a === attr, getAttribute: () => val }) } });
    return { win, calls, bar: () => body.bar, loc, click, url: () => win.WmsSettings.txUrl() };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('ระบบใหม่เปิด: URL ของหน้า = fire:tx · tx-fifo tx-summary tx-daily tx-history ได้คำตอบจากสำเนาในเครื่อง (อ่าน กดดึงใหม่ ประวัติ)', async () => {
    const x = await busyBook();
    const local = x.head.local(), fire = fakeFire(local), p = page(fire, 'https://old.example/exec');
    const { WmsGas: G, WmsShared: SH, WmsFireSrc: F } = p.win;
    expect(p.url()).toBe('fire:tx');
    expect(F.oldUrl()).toBe('https://old.example/exec');
    expect(await SH.read(p.url(), 'tx-fifo', {})).toEqual(C.fifo(local, NOW));
    expect(await SH.press(p.url(), 'tx-fifo', null, {})).toEqual(C.fifo(local, NOW));
    expect(await G.json(p.url(), 'tx-summary&shared=1', {})).toEqual(TX.summary(local, NOW));
    expect(await SH.press(p.url(), 'tx-summary', null, {})).toEqual(TX.summary(local, NOW));
    expect(await SH.read(p.url(), 'tx-daily&from=2026-11-01&to=2026-11-30', {})).toEqual(TX.daily(local, NOW, '2026-11-01', '2026-11-30'));
    expect(await SH.press(p.url(), 'tx-daily', { from: '2026-11-10', to: '2026-11-10' }, {})).toEqual(TX.daily(local, NOW, '2026-11-10', '2026-11-10'));
    expect(await G.json(p.url() + '?sku=' + encodeURIComponent('AAA001'), 'tx-history', {})).toEqual(TX.history(local, 'AAA001'));
    expect(fire.st.snaps).toBe(7);                      // ทุกครั้งดึงเอกสารใหม่ก่อนคิด
    expect(p.calls).toEqual([]);                        // ไม่แตะสคริปต์เดิมเลย
    let said = -1;
    await G.json(p.url(), 'tx-fifo', { onProgress: (s) => { said = s; } });
    expect(said).toBe(0);
    expect(p.bar().className).toBe('fsrc');
    expect(p.bar().innerHTML).toContain('อ่านจากระบบใหม่');
    expect(p.bar().innerHTML).toContain('หัวหน้าทดลอง');
    expect(p.bar().innerHTML).toContain('ไม่ใช่ข้อมูลจริง');
  });

  it('ป้ายข้อมูลกลาง: มีเอกสารใหม่หลังโหลด = ทุกชุดที่หน้าโหลดไว้ขึ้นว่ามีชุดใหม่ (ช่วงวันที่ตรง) · โหลดแล้วหาย', async () => {
    const x = await busyBook();
    const fire = fakeFire(x.head.local()), p = page(fire);
    const { WmsShared: SH } = p.win;
    let st = await SH.status(p.url());
    expect(SH.knows(st, 'transaction')).toBe(true);
    expect(st.shared).toEqual({});
    const fifo = await SH.read(p.url(), 'tx-fifo', {});
    const per = { from: '2026-11-01', to: '2026-11-30' };
    const daily = await SH.read(p.url(), 'tx-daily&from=2026-11-01&to=2026-11-30', {});
    st = await SH.status(p.url());
    expect(SH.newer(st, 'tx-fifo', fifo)).toBe(false);
    fire.st.changed = true;
    st = await SH.status(p.url());
    expect(SH.newer(st, 'tx-fifo', fifo)).toBe(true);
    expect(SH.newer(st, 'tx-daily', daily, per)).toBe(true);
    expect(SH.newer(st, 'tx-daily', daily, { from: '2026-10-01', to: '2026-10-31' })).toBe(false);
    expect(SH.running(st, 'tx-fifo')).toBeNull();
    fire.st.changed = false;
    const again = await SH.read(p.url(), 'tx-fifo', {});   // หน้าโหลดชุดใหม่แล้ว
    st = await SH.status(p.url());
    expect(SH.newer(st, 'tx-fifo', again)).toBe(false);
    expect(SH.newer(st, 'tx-daily', daily, per)).toBe(true);   // ชุดที่ยังไม่โหลดยังรออยู่
  });

  it('ยังไม่เข้าระบบ: คำตอบบอกให้เข้าก่อน · แถบมีปุ่ม → เลือกบัญชี (ทดลอง) / Google (ระบบจริง) → โหลดหน้าใหม่ · เข้าไม่ได้บอกเหตุ', async () => {
    const fire = fakeFire({ docs: [], meta: {} }, { user: null }), p = page(fire);
    const r = await p.win.WmsGas.json(p.url(), 'tx-fifo', {});
    expect(r).toMatchObject({ login: 1 });
    expect(r.error).toContain('เข้าสู่ระบบ');
    expect(fire.st.snaps).toBe(0);
    expect(await p.win.WmsShared.status(p.url())).toMatchObject({ shared: {} });
    expect(p.bar().className).toBe('fsrc need');
    expect(p.bar().innerHTML).toContain('data-fsrc-in');
    p.click('data-fsrc-in');
    expect(p.bar().innerHTML).toContain(`data-fsrc-acc="${HEAD_EMAIL}"`);
    p.click('data-fsrc-acc', HEAD_EMAIL);
    await flush();
    expect(fire.st.signed).toEqual([HEAD_EMAIL]);
    expect(p.loc.reloads).toBe(1);

    const live = fakeFire({ docs: [], meta: {} }, { user: null, pick: false, mode: 'live', signErr: 'x@gmail.test ไม่ใช่อีเมลบริษัท' }), q = page(live);
    await q.win.WmsFireSrc.ready();
    expect(q.bar().innerHTML).toContain('เข้าสู่ระบบด้วย Google');
    expect(q.bar().innerHTML).not.toContain('ไม่ใช่ข้อมูลจริง');
    q.click('data-fsrc-in');
    await flush();
    expect(live.st.signed).toEqual(['google']);
    expect(q.loc.reloads).toBe(0);
    expect(q.bar().innerHTML).toContain('ไม่ใช่อีเมลบริษัท');
  });

  it('ส่วนที่ยังอยู่สคริปต์เดิม (นับสต๊อกรายวัน) ส่งต่อไป URL เดิมของเครื่อง · ไม่มี URL บอกตรง ๆ · ระบบใหม่ปิด = ไม่เปลี่ยนอะไร', async () => {
    const fire = fakeFire({ docs: [], meta: {} });
    const p = page(fire, 'https://old.example/exec');
    expect(await p.win.WmsGas.json(p.url(), 'tx-count&peek=1', {})).toEqual({ app: 'transaction', old: 1 });
    expect(await p.win.WmsGas.post(p.url(), { op: 'count-save', items: [] }, {})).toEqual({ app: 'transaction', old: 1 });
    expect(p.calls).toEqual([['get', 'https://old.example/exec', 'tx-count&peek=1'], ['post', 'https://old.example/exec', 'count-save']]);
    const q = page(fakeFire({ docs: [], meta: {} }));
    expect((await q.win.WmsGas.json(q.url(), 'tx-count', {})).error).toContain('สคริปต์เดิม');
    expect((await q.win.WmsGas.post(q.url(), { op: 'count-add' }, {})).error).toContain('สคริปต์เดิม');
    expect(q.calls).toEqual([]);
    const off = page(null, 'https://old.example/exec');
    expect(off.win.WmsFireSrc).toBeNull();
    expect(off.url()).toBe('https://old.example/exec');
    expect(off.bar()).toBeUndefined();
  });

  it('หน้ารายงาน 8 หน้าโหลด config → book-fire → wms-fire-src หลัง wms-shared ก่อนสคริปต์ในหน้า · นับสต๊อกใหญ่ / ลิงก์แชร์ยังเหมือนเดิม', () => {
    const pages = ['balance/index.html', 'fifo/index.html', 'lot-po/index.html', 'dashboard/index.html', 'putaway/index.html', 'stock-location/index.html', 'mfg/index.html', 'cut-check/index.html'];
    for (const f of pages) {
      const s = read(f), at = (t) => s.indexOf(t);
      expect(at('<script src="../wms-settings.js"></script>'), f).toBeGreaterThan(0);
      expect(at('<script src="../wms-shared.js"></script>'), f).toBeGreaterThan(at('<script src="../wms-gas.js"></script>'));
      expect(at('<script src="../wms-fire-config.js"></script>'), f).toBeGreaterThan(at('<script src="../wms-shared.js"></script>'));
      expect(at('<script src="../book/book-fire.js"></script>'), f).toBeGreaterThan(at('<script src="../wms-fire-config.js"></script>'));
      expect(at('<script src="../wms-fire-src.js"></script>'), f).toBeGreaterThan(at('<script src="../book/book-fire.js"></script>'));
      expect(s.match(/wms-fire-src\.js/g), f).toHaveLength(1);
      expect(s, f).not.toContain('WMS_GATE_OFF');            // ป้ายรหัสเครื่องยังอยู่
    }
    /* นับสต๊อกใหญ่ 19–20 ธ.ค. และไฟล์ตั้งต้นสมุดยังอ่านสมุดเดิม · ลิงก์ไม่ต้องเข้าระบบอ่านชุดแชร์ของ fire-backup.gs (ไม่ใช้ wms-fire-src) */
    for (const f of ['stocktake/index.html', 'fifo/share.html', 'mfg/boss.html', 'book/index.html']) expect(read(f), f).not.toContain('wms-fire-src.js');
    const bf = read('book/book-fire.js');
    expect(bf.indexOf("script('../wms-fire-tx.js')")).toBeGreaterThan(bf.indexOf("script('../wms-fire-item.js')"));
    expect(bf.indexOf("script('../wms-fire-tx.js')")).toBeLessThan(bf.indexOf("script('../wms-fire.js')"));
    expect(bf).toMatch(/snap: async function \(\) \{\s+await ready;\s+await fire\.sync\(\);/);
    const gas = read('wms-gas.js');
    expect(gas).toContain('if (fire(url)) return window.WmsFireSrc.json(url, api, o);');
    expect(gas).toContain('if (fire(url)) return window.WmsFireSrc.post(url, payload, o);');
    /* ระบบใหม่ไม่มี Backup ของชีตเดิม: ไม่ขึ้นเตือน installBackup */
    expect(read('stock-location/index.html')).toContain("if (RAW.fire) return '';");
    expect(read('dashboard/index.html')).toContain("if (!SUM || SUM.fire) return '';");
    /* วางชีตเดิมไม่บังคับแล้ว: หน้า วันนี้ เตือนเฉพาะตอนยังวางกันอยู่ (ไม่มีช่วงเปลี่ยนผ่านบังคับ 35 วัน) */
    const app = read('book/book-app.js');
    expect(app).not.toContain('XFER_DAYS');
    expect(app).toMatch(/function xferLeft\(\) \{\s+if \(!HX \|\| !HX\.xfer\) return \[\];\s+var day = [^\n]+\n\s+var recent = [^\n]+\n\s+if \(!recent\) return \[\];/);
    expect(read('book/book-fire-set.js')).toContain("xfer: 'ไม่บังคับ: หน้ารายงาน");
    /* ยังไม่มีตาราง MASTER: ระบบใหม่บอกให้ตั้งที่หน้า ข้อมูลหลัก ไม่ใช่เพิ่มแท็บในชีตเดิม */
    for (const f of ['wms-sup.js', 'balance/index.html', 'lot-po/index.html', 'putaway/index.html']) {
      expect(read(f), f).toContain('ระบบใหม่ยังไม่ได้นำเข้าตาราง');
      expect(read(f), f).toContain('สมุดสต๊อก → ข้อมูลหลัก');
    }
    const src = read('wms-fire-src.js') + read('wms-fire-tx.js');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src).not.toMatch(/\.commit\(|store\.|\.patch\(/);   // อ่านอย่างเดียว ไม่เขียนฐาน
  });
});

describe('ลิงก์ Supply chain อ่านชุดแชร์ของระบบใหม่ (fire-backup.gs shareRefresh · doGet · wms-fire-share.js)', () => {
  let SH;
  beforeAll(() => {
    const win = { WmsFireCore: C };
    new Function('window', read('wms-fire-share.js'))(win);
    SH = win.WmsFireShare;
  });

  /** สมุดสมมติ: ยอดยกมา ขายใบใหญ่ (แยกส่วน ~2 ~3) ย้ายเข้า QA รับของ ตารางหลักครบสามตาราง */
  async function shareBook() {
    const x = await both({ partBytes: 3000 });
    await x.open();
    ok(await x.staff.post('bk-cut', cutBody('big', Array.from({ length: 40 }, (_, i) => saleLine(String(5000 + i), 0.25)))));
    ok(await x.staff.post('bk-move', body('m-1', [QA_MV])));
    ok(await x.staff.post('bk-gr', body('g-1', [GR3])));
    ok(await x.head.masterSave('sup', TR.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตสมมติ', 'P1'], ['ผู้ผลิตสมมติ 2', 'P9']] }]).sup));
    ok(await x.head.masterSave('conv', TR.readSheets([{ name: 'MASTER แปลงสินค้า', grid: [['SKU ตอนซื้อ', 'SKU หลังแปลง'], ['BBB0000000001', 'BBB0000000002']] }]).conv));
    ok(await x.head.masterSave('cap', TR.readSheets([{ name: 'ความจุต่อพาเลท', grid: [['SKU', 'Product ID', 'STD / pallet'], ['AAA001', 'AAA0000000001', 10]] }]).cap));
    expect(Object.keys(x.store.dump()).filter((k) => /^docs\/big~\d$/.test(k)).length).toBeGreaterThan(0);
    return x;
  }
  /** ชุดแชร์ที่หน้าแชร์คิดได้ = fifo() ของเครื่องหัวหน้าทุกช่อง (ไม่นับเวลา: ชุดแชร์ใช้เวลาที่ทำชุด) */
  async function sameAsApp(x, g) {
    await x.head.sync();
    const res = g.get({ api: 'tx-fifo', shared: '1' });
    expect(res).toMatchObject({ app: 'fire-share', v: 1 });
    const got = await SH.fifo(res), want = x.head.fifo();
    expect(got.error).toBeUndefined();
    expect(got).toMatchObject({ app: 'transaction', fire: 1, sheet: null, shared: { at: res.made, auto: 1 } });
    ['skus', 'pos', 'locs', 'days', 'rows', 'cgr', 'cq', 'last', 'convert', 'sup', 'cap'].forEach((k) => expect(got[k], k).toEqual(want[k]));
    return { res, got };
  }
  /** แตกชุดแชร์ในไฟล์ดูข้างใน */
  async function snapOf(res) { return JSON.parse(await SH.unzip(res.gz)); }

  it('installShare: ตั้งเวลาทุก 2 ชั่วโมง ทำชุดแรกทันที · หน้าแชร์คิด FIFO ได้เท่าหน้าในแอปทุกช่อง · ชุดแชร์ไม่มีชื่อคน อีเมล ออเดอร์', async () => {
    const x = await shareBook();
    const g = fakeFireGcp();
    expect(g.get({ api: 'tx-fifo' })).toEqual({ app: 'fire-share', error: 'ข้อมูลยังไม่พร้อม แจ้งคนที่ส่งลิงก์ให้' });
    expect(g.get({ api: 'shared-at' })).toEqual({ app: 'transaction', fire: 1, shared: {}, run: {} });
    expect(g.gs.shareRefresh()).toEqual({ empty: true });   // ยังไม่มีอะไรในฐาน
    g.mirror(x.store.dump());
    g.triggers.push({ h: 'shareRefresh', getHandlerFunction: () => 'shareRefresh' });   // ตั้งไว้แล้วรอบก่อน: ไม่ซ้อน
    g.triggers.push({ h: 'backupNightly', getHandlerFunction: () => 'backupNightly' });
    const r = g.gs.installShare();
    expect(g.triggers.map((t) => [t.h, t.hours])).toEqual([['backupNightly', undefined], ['shareRefresh', 2]]);
    expect(r).toMatchObject({ added: 4, docs: 4, more: false });
    expect(g.folders.map((f) => f.name)).toEqual(['WMS ระบบใหม่ สำรอง']);
    expect(g.folders[0].files.map((f) => f.name)).toEqual(['wms-fire-share.txt']);
    const { res } = await sameAsApp(x, g);
    expect(g.get({ api: 'shared-at' })).toEqual({ app: 'transaction', fire: 1, shared: { 'tx-fifo': { at: res.made, auto: 1 } }, run: {} });
    expect(+g.props['fs.made']).toBe(res.made);

    const snap = await snapOf(res);
    expect(snap).toMatchObject({ kind: 'wms-fire-share', v: 1, project: 'demo-src', seq: 4, upto: 4, open: 1 });
    Object.values(snap.docs).forEach((d) => expect(Object.keys(d).sort()).toEqual(['names', 'row', 'rows', 'seq', 'type']));
    Object.values(snap.master).forEach((m) => expect(Object.keys(m).every((k) => ['tab', 'cols', 'rows', 'dup', 'blank', 'n'].includes(k))).toBe(true));
    expect(Object.keys(snap.master).sort()).toEqual(['cap', 'conv', 'sup']);
    const text = JSON.stringify(snap);
    for (const s of ['@example.test', 'หัวหน้าทดลอง', 'TH5000', 'ON5000']) expect(text).not.toContain(s);
    /* ใบใหญ่ต่อส่วนแยกครบ: แถวเท่าในเครื่อง */
    const big = x.head.local().docs.find((d) => d.type === 'ตัดขาย');
    expect(snap.docs[big.id].rows.split('\n')).toHaveLength(big.rows.length);
    expect(g.logs.join('\n')).toMatch(/เอกสารใหม่ 4 ใบ/);
  });

  it('รอบต่อไปอ่านเฉพาะของใหม่ · ไม่มีอะไรใหม่อ่าน 1 ครั้ง · ตารางหลักเปลี่ยนอ่านตารางหลักใหม่ · ลงยอดยกมาใหม่ตัดเอกสารเก่าออก', async () => {
    const x = await shareBook();
    const g = fakeFireGcp();
    g.mirror(x.store.dump());
    g.gs.shareRefresh();
    let before = g.calls.length;
    expect(g.gs.shareRefresh()).toMatchObject({ same: true, docs: 4, reads: 1 });
    expect(g.calls.length - before).toBe(1);
    const file = g.folders[0].files[0], writes = file.writes;

    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-2', [mv3()], { date: '2026-11-11' })));
    ok(await x.staff.post('bk-cut', cutBody('c-2', [saleLine('7001', 1, 'A-01-02', '9', 'P2')], '2026-11-11')));
    g.mirror(x.store.dump());
    before = g.calls.length;
    expect(g.gs.shareRefresh()).toMatchObject({ added: 2, docs: 6, more: false });
    expect(g.calls.length - before).toBe(2);   // meta/head + เอกสารใหม่ (ตารางหลักเดิม ไม่อ่าน)
    expect(file.writes).toBe(writes + 1);       // ไฟล์เดิม เขียนทับ ไม่สร้างใหม่
    expect(g.folders[0].files).toHaveLength(1);
    await sameAsApp(x, g);

    ok(await x.head.masterSave('sup', TR.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตใหม่สมมติ', 'P2']] }]).sup));
    g.mirror(x.store.dump());
    before = g.calls.length;
    expect(g.gs.shareRefresh()).toMatchObject({ added: 0, docs: 6 });
    expect(g.calls.slice(before).map((c) => c[2].split('?')[0])).toEqual(['/meta/head', ':runQuery', '/master']);
    const { got } = await sameAsApp(x, g);
    expect(got.sup.rows).toEqual([['P2', 'ผู้ผลิตใหม่สมมติ']]);

    /* ลงยอดยกมาใหม่ (ลงผิด ลงใหม่ก่อนมีเอกสารอื่น): ยอดยกมาใบเก่าไม่นับในหน้ารายงาน ชุดแชร์ก็ตัดออก */
    const y = await both();
    await y.open();
    const g2 = fakeFireGcp();
    g2.mirror(y.store.dump());
    expect(g2.gs.shareRefresh()).toMatchObject({ added: 1, docs: 1 });
    ok(await y.head.post('bk-open', { batch: 'o-2', asOf: 900, rows: OPEN.slice(0, 2), replace: true }));
    g2.mirror(y.store.dump());
    expect(g2.gs.shareRefresh()).toMatchObject({ added: 1, docs: 1 });
    const again = await sameAsApp(y, g2);
    expect(again.got.rows).toHaveLength(2);
    expect((await snapOf(again.res)).open).toBe(2);
  });

  it('เกินเวลา: หยุดกลางทางแล้วรอบหน้าทำต่อ ใบใหญ่ไม่เข้าชุดครึ่งใบ · ไฟล์เสียทำใหม่ทั้งหมด · โปรเจกต์อื่นไม่ปน', async () => {
    const x = await shareBook();
    /* หน้าละ (ส่วนของใบใหญ่ + 1) แบบของจริง (หน้าละ 40 > 7 ส่วน): ทุกหน้าได้ใบใหม่อย่างน้อยหนึ่งใบ */
    const parts = Object.keys(x.store.dump()).filter((k) => /^docs\/big(~\d+)?$/.test(k)).length;
    const g = fakeFireGcp({ over: { STOP_MS: -1, PAGE: parts + 1 } });
    g.mirror(x.store.dump());
    const runs = [];
    let r = g.gs.shareRefresh();
    runs.push(r);
    while (r.more) { r = g.gs.shareRefresh(); runs.push(r); }
    expect(runs.length).toBeGreaterThan(2);
    expect(r).toMatchObject({ docs: 4, more: false, seq: 4 });
    const big = x.head.local().docs.find((d) => d.type === 'ตัดขาย');
    /* ทุกรอบระหว่างทาง: ใบใหญ่ไม่มีก็มีครบ ไม่มีครึ่งใบ */
    expect(runs.every((y) => y.seq <= 4)).toBe(true);
    const { res } = await sameAsApp(x, g);
    expect((await snapOf(res)).docs[big.id].rows.split('\n')).toHaveLength(big.rows.length);

    /* ไฟล์ชุดแชร์เสีย (มีคนแก้ใน Drive) → รอบหน้าทำใหม่ทั้งหมด */
    const g2 = fakeFireGcp();
    g2.mirror(x.store.dump());
    g2.gs.shareRefresh();
    g2.folders[0].files[0].setContent('{"app":"fire-share","gz":"เสีย"}');
    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-2', [mv3()], { date: '2026-11-11' })));
    g2.mirror(x.store.dump());
    expect(g2.gs.shareRefresh()).toMatchObject({ added: 5, docs: 5 });
    expect(g2.logs.join('\n')).toMatch(/อ่านชุดแชร์เดิมไม่ได้/);
    await sameAsApp(x, g2);
    const bad = await SH.fifo({ app: 'fire-share', v: 1, made: 1, gz: Buffer.from('ไม่ใช่ gzip').toString('base64') });
    expect(bad.error).toMatch(/ลิงก์นี้ใช้ไม่ได้/);
    expect((await SH.fifo({ app: 'transaction' })).error).toMatch(/ลิงก์นี้ใช้ไม่ได้/);
    expect((await SH.fifo({ app: 'fire-share', error: 'ข้อมูลยังไม่พร้อม แจ้งคนที่ส่งลิงก์ให้' })).error).toMatch(/ยังไม่พร้อม/);

    /* เปลี่ยน FIREBASE_PROJECT_ID (กู้ไปโปรเจกต์ใหม่): ชุดแชร์ของโปรเจกต์เดิมไม่ปน */
    const g3 = fakeFireGcp({ project: 'demo-new' });
    Object.assign(g3.props, g2.props);
    g3.folders.push(...g2.folders);
    g3.files.push(...g2.files);
    g3.mirror(x.store.dump());
    expect(g3.gs.shareRefresh()).toMatchObject({ added: 5, docs: 5 });
  });

  it('เว็บแอปตอบแค่ชุดแชร์: คำสั่งอื่นไม่รู้จัก · กู้คืนข้ามไฟล์ชุดแชร์ · ไม่มีชีต ไม่มี URL อื่น · ค่าตั้งว่างใน repo', async () => {
    const x = await shareBook();
    const g = fakeFireGcp();
    g.mirror(x.store.dump());
    g.gs.backupNightly();
    g.gs.shareRefresh();
    for (const api of ['', 'tx-summary', 'backup', 'restore', 'st-boss']) expect(g.get({ api }), api).toEqual({ error: 'ไม่รู้จักคำสั่งนี้' });
    expect(g.get({ api: 'tx-fifo' })).toMatchObject({ app: 'fire-share', v: 1 });
    expect(g.gs.restoreAll('demo-copy')).toMatchObject({ ok: true, files: 1 });
    expect(g.logs.join('\n')).not.toMatch(/ข้าม wms-fire-share/);

    const gs = read('../apps-script/fire-backup.gs');
    expect(gs).toContain("var FIREBASE_PROJECT_ID = '';");
    expect(gs).toContain("var SHARE_FILE = 'wms-fire-share.txt';");
    expect(gs).not.toMatch(/SpreadsheetApp|openById|openByUrl|doPost/);
    const body = /function doGet\(e\) \{[\s\S]*?\n\}\n/.exec(gs.replace(/\r\n/g, '\n'))[0] + /function shareGet_\(api\) \{[\s\S]*?\n\}\n/.exec(gs.replace(/\r\n/g, '\n'))[0];
    expect(body).not.toMatch(/shareRefresh|backup_|restoreAll|rest_\(|setContent|createFile|setProperty/);   // อ่านอย่างเดียว
    expect(body).toContain('shared-at');
    const page = read('wms-fire-share.js');
    expect(page).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|localStorage|fetch\(/);
  });

  it('ติดตั้งก่อนยอดยกมา: ยังไม่มีไฟล์ ไม่มีโฟลเดอร์ · ลงยอดแล้วรอบแรกได้ตารางที่ตั้งล่วงหน้าครบ', async () => {
    const x = await both();
    ok(await x.head.masterSave('sup', TR.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตสมมติ', 'P1']] }]).sup));
    ok(await x.head.masterSave('conv', TR.readSheets([{ name: 'MASTER แปลงสินค้า', grid: [['SKU ตอนซื้อ', 'SKU หลังแปลง'], ['BBB0000000001', 'BBB0000000002']] }]).conv));
    ok(await x.head.masterSave('cap', TR.readSheets([{ name: 'ความจุต่อพาเลท', grid: [['SKU', 'Product ID', 'STD / pallet'], ['AAA001', 'AAA0000000001', 10]] }]).cap));
    x.store.seed({ 'master/loc': { rows: 'A-01-01' }, 'master/sku': { rows: 'AAA001' }, 'master/grp': { rows: 'm6' }, 'master/zone': { rows: 'R02' } });

    const b = fakeGcp(), g = fakeFireGcp();
    b.mirror(x.store.dump());
    g.mirror(x.store.dump());
    const backup = b.load();
    expect(backup.installBackup()).toEqual({ empty: true });
    expect(g.gs.installShare()).toEqual({ empty: true });
    expect(b.triggers.map((t) => t.h)).toEqual(['backupNightly']);
    expect(g.triggers.map((t) => t.h)).toEqual(['shareRefresh']);
    expect([b.folders.length, g.folders.length]).toEqual([0, 0]);
    expect(b.logs.join('\n')).toContain('ตั้งเวลาสำรองทุกคืน 2:00 แล้ว');
    expect(g.logs.join('\n')).toContain('ยังไม่มีอะไรให้แชร์');

    await x.open();
    b.mirror(x.store.dump());
    g.mirror(x.store.dump());
    expect(backup.backupNightly()).toMatchObject({ docs: 1, more: false });
    const file = b.files()[0];
    expect(file.name).toMatch(/-full\.json$/);
    expect(Object.keys(file.b.data).filter((p) => p.startsWith('master/')).sort())
      .toEqual(['cap', 'conv', 'grp', 'loc', 'sku', 'sup', 'zone'].map((k) => 'master/' + k));
    expect(g.gs.shareRefresh()).toMatchObject({ added: 1, docs: 1 });
    expect(Object.keys((await snapOf((await sameAsApp(x, g)).res)).master).sort()).toEqual(['cap', 'conv', 'sup']);
  });

  it('หน้าแชร์โหลด wms-fire-core → wms-fire-share ก่อน fifo-page (ไม่ต้องเข้าระบบ) · หน้า FIFO ระบบใหม่ทำลิงก์จาก URL เว็บแอปที่ตั้งไว้', () => {
    const s = read('fifo/share.html'), at = (t) => s.indexOf(t);
    expect(at('<script src="../wms-fire-core.js"></script>')).toBeGreaterThan(at('<script src="../wms-fifo.js"></script>'));
    expect(at('<script src="../wms-fire-share.js"></script>')).toBeGreaterThan(at('<script src="../wms-fire-core.js"></script>'));
    expect(at('<script src="fifo-page.js"></script>')).toBeGreaterThan(at('<script src="../wms-fire-share.js"></script>'));
    for (const t of ['wms-fire-src.js', 'book-fire.js', 'wms-fire-config.js', 'wms-gate.js']) expect(s, t).not.toContain(t);
    const fp = read('fifo/fifo-page.js');
    expect(fp).toContain('if (window.WmsFireShare && WmsFireShare.owns(res)) res = await WmsFireShare.fifo(res);');
    expect(fp).toContain("const FIRE = () => !SHARE && !!(window.WmsFireSrc && window.WmsFireSrc.owns(WmsSettings.txUrl()));");
    expect(fp).toContain('const base = FIRE() ? WmsSettings.shareUrl() : txUrl();');
    expect(fp).toMatch(/st\.app !== 'transaction' \|\| !st\.fire/);   // URL สคริปต์ Transaction เดิมใช้ทำลิงก์ระบบใหม่ไม่ได้
    const w = { localStorage: memLS() };
    new Function('window', 'localStorage', read('wms-settings.js'))(w, w.localStorage);
    expect(w.WmsSettings.KEYS.shareUrl).toBe('wms:fire:share-url');
    expect(w.WmsSettings.setShareUrl(' https://example.test/exec ')).toBe(true);
    expect(w.WmsSettings.shareUrl()).toBe('https://example.test/exec');
    expect(w.WmsSettings.kindOf('wms:fire:share-url')).toBe('key');   // อยู่ไฟล์กุญแจ ไม่อยู่ไฟล์ข้อมูลที่ส่งต่อได้
  });
});

describe('IQA ของสุ่มตรวจ: ระบุ LOT/PO · ขาดใบโอนเข้าไม่ให้ปรับยอดแทน · วันที่ออกไม่ก่อนของเข้า', () => {
  const SKU = ['AAA001', 'AAA0000000001'], NM = 'ที่นอนสมมติ 1';
  const pile = (lot, po, loc, qty) => [...SKU, NM, lot, po, loc, qty, '', '2026-10-02', ''];
  const row = (lot, po, from, to, qty, type = 'เบิก', note = 'โอนย้าย QA') => [...SKU, lot, po, from, to, qty, type, note, ''];
  const inIqa = (qty = 2) => row('11', 'PNEW', 'RIB', 'IQA', qty);
  const outIqa = (qty = 2, to = 'QA') => row('11', 'PNEW', 'IQA', to, qty);
  const line = (over = {}) => ({ sku: SKU[0], from: 'IQA', to: 'QA', qty: '2', lot: '11', po: 'PNEW', ...over });
  const NEED = 'ออกจาก IQA ต้องใส่ LOT และ PO ของชิ้นที่ตรวจ ระบบไม่เลือกกองแทน';
  const ON = { iqa: true };

  async function world(opening = [pile('11', 'PNEW', 'RIB', 10)], opt = {}) {
    const x = await both(opt);
    let n = 0;
    expect((await x.head.post('bk-open', { batch: 'o-1', asOf: 900, rows: opening })).error).toBeUndefined();
    x.qa = await x.join(QA_EMAIL);
    x.send = async (who, op, copy, date = '2026-11-10', more = {}) => {
      await x[who].sync();
      return x[who].post(op, body('iqa-' + ++n, copy, { date, ...more }));
    };
    x.ok = async (...a) => { const r = await x.send(...a); expect(r.error).toBeUndefined(); return r; };
    /* Inbound ทำใบเข้า แล้ว QA กดรับ จึงโอนออกได้ */
    x.put = async (copy, date) => { const r = await x.ok('staff', 'bk-move', copy, date); ok(await x.qa.okSave([r.doc], 'check')); return r; };
    x.cancel = async (doc) => { await x.head.sync(); return x.head.post('bk-void', { doc, why: 'ผิดใบ' }); };
    x.st = async () => { await x.staff.sync(); return B.stock(x.staff.fifo()); };
    return x;
  }

  it('ก: เว้น LOT หรือ PO = แถวผิด ไม่เอากองเก่าแทน · หน้าเดิมและโลอื่นคิดแบบเดิม', async () => {
    const x = await world([pile('11', 'PNEW', 'RIB', 10), pile('10', 'POLD', 'IQA', 5), pile('10', 'POLD', 'IQA-01', 5),
      pile('10', 'POLD', 'IQAX', 5), pile('0', '0', 'IQA2', 3), pile('9', 'PQ', 'QA', 4)]);
    const st = await x.st(), one = (over) => B.planMoves([line(over)], st, ON);
    for (const over of [{ lot: '', po: '' }, { lot: '10', po: '' }, { lot: '', po: 'POLD' }, { from: 'iqa-01', lot: '', po: '' }]) {
      const p = one(over);
      expect(p.lines[0]).toMatchObject({ st: 'bad', why: NEED });
      expect(p.rows).toEqual([]);
      expect(p.total.bad).toBe(1);
    }
    expect(one({ lot: '10', po: 'POLD' }).rows).toMatchObject([{ lot: '10', po: 'POLD', qty: 2 }]);
    expect(one({ from: 'IQA2', lot: '0', po: '0' }).lines[0].st).toBe('ok');
    for (const from of ['RIB', 'QA', 'IQAX']) expect(one({ from, to: 'A-01-01', lot: '', po: '' }).lines[0].st, from).toBe('ok');
    expect(B.planMoves([line({ lot: '', po: '' })], st).rows).toMatchObject([{ lot: '10', po: 'POLD' }]);

    const old = { sku: SKU[0], lot: '', po: '', from: 'IQA', to: 'QA', qty: '1', type: 'เบิก', note: 'โอนย้าย QA' };
    expect(B.planRows([old], st, { date: '2026-11-10', iqa: true }).lines[0]).toMatchObject({ st: 'bad', why: NEED });
    expect(B.planRows([old], st, { date: '2026-11-10' }).lines[0].st).toBe('ok');

    const chain = B.planMoves([line({ from: 'RIB', to: 'IQA', lot: '', po: '' }), line()], st, ON);
    expect(chain.lines.map((o) => o.st)).toEqual(['ok', 'ok']);
  });

  it('ข: ไม่มียอดใน IQA บอกให้แจ้ง Inbound ไม่บอกให้ปรับยอด · เพิ่มยอดที่ IQA เตือนแต่ไม่ห้าม', async () => {
    const x = await world([pile('11', 'PNEW', 'RIB', 10), pile('10', 'POLD', 'IQA', 5)]);
    const st = await x.st(), ask = ' · เช็ค LOT / PO ถ้าถูกแล้ว แจ้ง Inbound ทำใบโอนเข้า อย่าปรับยอด';
    expect(B.planMoves([line()], st, ON).lines[0].why).toBe('ที่ IQA (LOT 11 PNEW) มี 0 ชิ้น' + ask);
    expect(B.planMoves([line()], st).lines[0].why).toBe('ที่ IQA (LOT 11 PNEW) มี 0 ชิ้น');
    const g = { ...line(), type: 'เบิก', note: 'โอนย้าย QA' };
    expect(B.planRows([g], st, ON).lines[0].why).toBe('กองไม่พอ: IQA LOT 11 PO PNEW มี 0' + ask);

    const none = await x.send('staff', 'bk-move', [outIqa()]);
    expect(none.error).toBe('ยอดใน IQA ไม่พอ 1 แถว เช็ค LOT / PO ถ้าถูกแล้ว แจ้ง Inbound ทำใบโอนเข้าก่อน อย่าปรับยอด');
    expect(none.short).toMatchObject([{ loc: 'IQA', have: 0, need: 2 }]);
    expect((await x.send('staff', 'bk-move', [outIqa(), row('9', 'PQ', 'QA', 'A-01-01', 1)])).error).toMatch(/ต้องลงรับของ.* · ส่วน IQA 1 แถว ให้แจ้ง Inbound/);
    expect((await x.send('staff', 'bk-move', [row('9', 'PQ', 'QA', 'A-01-01', 1)])).error).toBe('ยอดในสมุดไม่พอ 1 แถว ต้องลงรับของ หรือให้หัวหน้าปรับยอดก่อน');

    const adj = (over, opt) => B.planAdj([{ loc: 'IQA', sku: SKU[0], lot: '10', po: 'POLD', count: '7', why: 'ลงผิด', ...over }], st, opt);
    const up = adj({}, ON);
    expect(up.lines[0].st).toBe('ok');
    expect(up.lines[0].warn.join()).toMatch(/ให้ Inbound ทำใบโอน .*ยอดซ้ำ/);
    expect(up.total).toMatchObject({ warn: 1, bad: 0, rows: 1 });
    expect(adj({ lot: '11', po: 'PNEW' }, ON).lines[0].warn.join()).toMatch(/Inbound/);
    expect(adj({ count: '3' }, ON).lines[0].warn).toEqual([]);
    expect(adj({ loc: 'RIB', lot: '11', po: 'PNEW', count: '12' }, ON).lines[0].warn).toEqual([]);
    expect(adj({}).lines[0].warn).toEqual([]);
    expect(adj({ lot: '11', po: '' }, ON).lines[0].why).toMatch(/แจ้ง Inbound ทำใบโอน อย่าปรับยอด/);
    const add = B.planRows([{ sku: SKU[0], lot: '11', po: 'PNEW', to: 'IQA', qty: '2', type: 'รับ', note: 'เจอเพิ่ม' }], st, ON);
    expect(add.lines[0]).toMatchObject({ st: 'ok' });
    expect(add.total.warn).toBe(1);
  });

  it('ค: ออกก่อนวันที่เข้าไม่ให้บันทึก · วันเดียวกันได้ (คนละใบ รับก่อน)', async () => {
    const x = await world();
    await x.put([inIqa()], '2026-11-09');
    const r = await x.send('qa', 'bk-move', [outIqa()], '2026-11-08');
    expect(r.error).toBe('ออกวันที่ 08/11/2026 ไม่ได้ ที่ IQA (LOT 11 PNEW) มีให้ออก 0 ชิ้น ณ วันนั้น · ใช้วันที่ 09/11/2026 ขึ้นไป');
    expect(r.short).toMatchObject([{ n: 1, loc: 'IQA', lot: '11', po: 'PNEW', have: 0, need: 2 }]);
    await x.ok('qa', 'bk-move', [outIqa()], '2026-11-09');
    expect((await x.send('staff', 'bk-move', [inIqa(1), outIqa(1)], '2026-11-05')).error).toMatch(/^1 ใบโอนได้แบบเดียว/);   // รับก่อนจึงออกได้
    await x.put([inIqa(1)], '2026-11-05');
    await x.ok('qa', 'bk-move', [outIqa(1)], '2026-11-05');
  });

  it('ค: ย้อนวันไปกินของที่ใบออกทีหลังใช้แล้วไม่ได้ · ใบออกที่ยกเลิกแล้วไม่นับ', async () => {
    const x = await world();
    await x.put([inIqa(2)], '2026-11-03');
    const used = await x.ok('qa', 'bk-move', [outIqa(2)], '2026-11-06');
    await x.put([inIqa(2)], '2026-11-08');
    expect((await x.send('qa', 'bk-move', [outIqa(1)], '2026-11-04')).error).toMatch(/มีให้ออก 0 ชิ้น .* ใช้วันที่ 08\/11\/2026 ขึ้นไป/);
    expect((await x.cancel(used.doc)).error).toBeUndefined();
    await x.ok('qa', 'bk-move', [outIqa(1)], '2026-11-04');
  });

  it('ค: ใบเข้าที่ยกเลิกแล้วไม่นับเป็นของเข้า', async () => {
    const x = await world();
    const first = await x.ok('staff', 'bk-move', [inIqa()], '2026-11-03');
    expect((await x.cancel(first.doc)).error).toBeUndefined();
    await x.put([inIqa()], '2026-11-09');
    expect((await x.send('qa', 'bk-move', [outIqa()], '2026-11-05')).error).toMatch(/มีให้ออก 0 ชิ้น .* ใช้วันที่ 09\/11\/2026/);
  });

  it('ค: ยอดยกมา = มีตั้งแต่ต้น · คนละ PO ไม่เอามารวม · โลอื่นไม่ตรวจวันที่', async () => {
    const x = await world([pile('11', 'PNEW', 'RIB', 10), pile('10', 'POLD', 'IQA', 5)]);
    await x.ok('qa', 'bk-move', [row('10', 'POLD', 'IQA', 'QA', 1)], '2026-11-01');
    await x.put([inIqa(), row('11', 'PNEW', 'RIB', 'QA', 1)], '2026-11-09');
    expect((await x.send('qa', 'bk-move', [outIqa()], '2026-11-07')).error).toMatch(/ใช้วันที่ 09\/11\/2026/);
    await x.ok('qa', 'bk-move', [row('11', 'PNEW', 'QA', 'A-01-01', 1)], '2026-11-07');
  });

  it('ค: แปลง ปรับลด ตารางแบบเดิม ก็ออกก่อนของเข้าไม่ได้', async () => {
    const x = await world();
    await x.put([inIqa()], '2026-11-09');
    const conv = [row('11', 'PNEW', 'IQA', '', 1, 'เบิก', 'แปลงสินค้า'), ['BBB002', 'BBB0000000002', '11', 'PNEW', '', 'IQA', 1, 'รับ', 'แปลงสินค้า', '']];
    expect((await x.send('staff', 'bk-conv', conv, '2026-11-08')).error).toMatch(/^ออกวันที่/);
    const lines = [{ loc: 'IQA', sku: SKU[1], lot: '11', po: 'PNEW', have: 2, count: 1 }];
    expect((await x.send('head', 'bk-adj', [row('11', 'PNEW', 'IQA', '', 1, 'เบิก', 'ปรับยอด หาย')], '2026-11-08', { lines, why: 'หาย' })).error).toMatch(/^ออกวันที่/);
    expect((await x.send('head', 'bk-rows', [row('11', 'PNEW', 'IQA', '', 1, 'ขาย', '2026-11-08')], '2026-11-08')).error).toMatch(/^ออกวันที่/);
    expect((await x.send('head', 'bk-rows', [outIqa(1)], '2026-11-08')).error).toMatch(/^ออกวันที่/);
  });

  it('ค: ยกเลิกใบเข้าที่ทำให้ใบออกค้างก่อนวันเข้าไม่ได้ · ยกเลิกใบออกก่อนแล้วจึงได้', async () => {
    const x = await world();
    const first = await x.put([inIqa()], '2026-11-03');
    const out = await x.ok('qa', 'bk-move', [outIqa()], '2026-11-04');
    await x.put([inIqa()], '2026-11-09');
    expect((await x.cancel(first.doc)).error).toBe(`ยกเลิก ${first.doc} ไม่ได้ ใบออกจาก IQA ${out.doc} วันที่ 04/11/2026 ใช้ของชุดนี้ (LOT 11 PNEW) ยกเลิกใบออกก่อน`);
    expect((await x.cancel(out.doc)).error).toBeUndefined();
    expect((await x.cancel(first.doc)).error).toBeUndefined();
  });

  it('ค: หน้าขึ้นแถวแดงก่อนกดบันทึก ตามวันที่ของใบ · แถวอื่นไม่แดง', async () => {
    const x = await world();
    await x.put([inIqa()], '2026-11-09');
    const st = await x.st();
    const check = (day) => C.iqaCheck(B.planMoves([line({ from: 'RIB', to: 'A-01-01', qty: '1' }), line()], st, ON), x.staff.local(), day);
    const early = check('2026-11-08');
    expect(early.lines.map((o) => o.st)).toEqual(['ok', 'bad']);
    expect(early.lines[1].why).toMatch(/ใช้วันที่ 09\/11\/2026 ขึ้นไป/);
    expect(early.total).toMatchObject({ ok: 1, bad: 1 });
    const good = check('2026-11-09');
    expect(good.total).toMatchObject({ ok: 2, bad: 0 });
    /* ย้ายในคลังกับโอนใน QA แยกคนละใบ */
    await x.ok('qa', 'bk-move', B.moveCopy(good).filter((r) => r[4] === 'IQA'), '2026-11-09');

    const src = read('book/book-grid.js');
    expect(src).toContain('B.planMoves(g.rows, ST, { iqa: iqa })');
    expect(src).toContain('B.planAdj(g.rows, ST, { iqa: iqa })');
    expect(src).toContain('window.BookFire.iqaCheck(p, g.date)');
    expect(src).toContain('window.BookFire.xferCheck(p, mode)');
    expect(src).toContain("function trAfter(mode) { return mode === 'move' && !!window.BookFire; }");
    expect(src).toContain('updateOut(mode);   // แผนขึ้นกับวันที่');
    const lao = new RegExp('[' + String.fromCharCode(0xe80) + '-' + String.fromCharCode(0xeff) + ']');
    ['wms-book.js', 'wms-fire-core.js', 'book/book-fire.js'].forEach((f) => expect(lao.test(read(f)), f).toBe(false));
  });

  it('ค: เครื่องใหม่หลังปิดเดือนยังรู้วันที่ของใบเข้า', async () => {
    const x = await world(undefined, { now: Date.UTC(2026, 9, 20, 3, 0, 0) });
    await x.put([inIqa()], '2026-10-20');
    x.tick(16 * DAY);
    await x.head.sync();
    expect((await x.head.archClose()).error).toBeUndefined();
    x.qa = await x.device(QA_EMAIL);
    expect((await x.send('qa', 'bk-move', [outIqa()], '2026-10-19')).error).toMatch(/ใช้วันที่ 20\/10\/2026 ขึ้นไป/);
    await x.ok('qa', 'bk-move', [outIqa()], '2026-11-05');
  });
});

/* ── ใบโอน QA แบบรับก่อนใช้ต่อ ─────────────────────────────────────── */

describe('รับก่อนใช้ต่อ: ใบโอนเข้า / ออก QA', () => {
  const SKU = ['AAA001', 'AAA0000000001', '8', 'P1'];
  const leg = (from, to, qty = 1, note = 'โอนย้าย QA') => [...SKU, from, to, qty, 'เบิก', note, ''];
  const toQa = (qty = 2) => leg('A-01-01', 'QA', qty);
  const fromQa = (qty = 1, to = 'A-01-03') => leg('QA', to, qty);
  const HELD = /^ของรอรับยังใช้ต่อไม่ได้/;

  async function world(opt) {
    const x = await both(opt);
    const at = () => C.today(x.clock());
    ok(await x.head.post('bk-open', { batch: 'o-1', asOf: 900, rows: OPEN }));
    x.qa = await x.join(QA_EMAIL);
    x.staff2 = await x.join(STAFF2_EMAIL);
    let n = 0;
    x.move = (who, rows) => x[who].post('bk-move', body('xf-' + ++n, rows, { date: at() }));
    x.rows = (rows) => x.head.post('bk-rows', body('xr-' + ++n, rows, { date: at(), ref: 'แก้มือ' }));
    x.sell = (who, loc) => x[who].post('bk-cut', cutBody('xc-' + ++n, [saleLine('9', 1, loc)], at()));
    x.doc = (no) => Object.values(x.store.dump()).find((d) => d && d.no === no);
    x.path = (no) => Object.keys(x.store.dump()).find((k) => x.store.dump()[k] && x.store.dump()[k].no === no);
    x.free = async (loc) => {
      await x.staff.sync();
      const st = B.stock(x.staff.fifo(), undefined, C.holdList(x.staff.local()));
      const p = (st.all[st.code('AAA0000000001')] || []).find((q) => q.loc === loc);
      return p ? [p.qty, B.freeQty(p)] : null;
    };
    return x;
  }

  it('ครบทาง: เข้า → QA รับ → โอนออก → ปลายทางรับ → อนุมัติเข้าก่อนออก → ใส่เลข TRcloud', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa(2)])).doc;
    expect(x.doc(a)).toMatchObject({ xf: 'in', trState: 'wait', tr: '' });
    expect(await x.free('QA')).toEqual([2, 0]);                                   // ของอยู่ QA แล้ว แต่ใช้ต่อไม่ได้
    expect((await x.move('qa', [fromQa()])).error).toMatch(HELD);
    expect((await x.move('qa', [fromQa()])).error).toContain(a);
    expect((await x.staff2.okSave([a], 'check')).error).toMatch(/ทีม QA หรือหัวหน้ารับ/);
    ok(await x.qa.okSave([a], 'check'));
    expect(await x.free('QA')).toEqual([2, 2]);                                   // ไม่ต้องรอหัวหน้า

    const b = ok(await x.move('qa', [fromQa()])).doc;
    expect(x.doc(b)).toMatchObject({ xf: 'out', trState: 'wait', tr: '' });
    expect(await x.free('A-01-03')).toEqual([1, 0]);
    expect((await x.sell('staff', 'A-01-03')).error).toMatch(HELD);
    expect((await x.move('staff', [leg('A-01-03', 'B-01-01', 1, 'โอนย้าย')])).error).toMatch(HELD);
    expect((await x.qa.okSave([b], 'check')).error).toBe(`${b} คนทำรับใบของตัวเองไม่ได้`);
    ok(await x.staff.okSave([b], 'check'));
    ok(await x.sell('staff2', 'A-01-03'));

    expect((await x.staff.trSave([{ no: a, tr: 'TR-1', state: 'done' }])).error).toMatch(/ยังไม่อนุมัติ/);
    expect((await x.staff.trSave([{ no: a, tr: '', state: 'none' }])).error).toMatch(/ยังไม่อนุมัติ/);
    await x.staff.trList();
    expect(x.staff.trFile([a, b])).toMatchObject({ docs: [], hold: [a, b] });
    expect((await x.head.okSave([b], 'approve')).error).toBe(`${b} ต้องอนุมัติใบเข้า ${a} ก่อน หรือเลือกพร้อมกัน`);
    ok(await x.head.okSave([b, a], 'approve'));
    ok(await x.staff.trSave([{ no: a, tr: 'TR-1', state: 'done' }, { no: b, tr: 'TR-2', state: 'done' }]));
    expect([x.doc(a).trState, x.doc(b).trState]).toEqual(['done', 'done']);
  });

  it('เติมในคลังขายไม่ต้องรอรับ: ย้ายแล้วขายหรือย้ายต่อได้ทันที', async () => {
    const x = await world();
    const m = ok(await x.move('staff', [leg('R01-01-01', 'A-01-03', 3, 'โอนย้าย'), leg('A-01-03', 'A-01-04', 1, 'โอนย้าย')])).doc;
    expect(x.doc(m).xf).toBeUndefined();
    expect(await x.free('A-01-03')).toEqual([2, 2]);
    ok(await x.sell('staff', 'A-01-03'));
  });

  it('ทีม: คลัง / Inbound ทำใบเข้า · QA ทำใบออก · คนทำรับเองไม่ได้ · หัวหน้าทำและรับแทนได้', async () => {
    const x = await world();
    expect((await x.move('qa', [toQa()])).error).toMatch(/ใบโอนเข้า QA ให้คลัง \/ Inbound ทำ/);
    expect((await x.move('staff', [leg('QA', 'A-01-03').map((v, i) => (i < 4 ? ['CCC004', 'CCC0000000004', '0', '0'][i] : v))])).error)
      .toMatch(/โอนออกจาก QA ให้ทีม QA หรือหัวหน้าทำ/);
    const a = ok(await x.move('head', [toQa()])).doc;
    expect((await x.head.okSave([a], 'check')).error).toBe(a + ' คนทำรับใบของตัวเองไม่ได้');
    ok(await x.qa.okSave([a], 'check'));
    const q = ok(await x.move('qa', [leg('QA', 'IQA-01')])).doc;
    expect(x.doc(q)).toMatchObject({ xf: 'qa', trState: 'none' });
    expect(await x.free('IQA-01')).toEqual([1, 0]);
    expect((await x.qa.okSave([q], 'check')).error).toBe(q + ' คนทำรับใบของตัวเองไม่ได้');
    ok(await x.head.okSave([q], 'check'));
    expect(await x.free('IQA-01')).toEqual([1, 1]);
  });

  it('1 ใบ = แบบเดียว · ไม่รับเลข TRcloud ตอนบันทึก · ตารางแบบเดิมโอน QA ไม่ได้', async () => {
    const x = await world();
    expect((await x.move('staff', [leg('R01-01-01', 'A-01-03', 1, 'โอนย้าย'), toQa()])).error).toMatch(/^1 ใบโอนได้แบบเดียว/);
    expect((await x.move('staff', [[...toQa(), 'TR-9']])).error).toMatch(/ใส่เลข TRcloud หลังหัวหน้าอนุมัติ/);
    expect((await x.rows([toQa()])).error).toMatch(/ตารางแบบเดิมลงไม่ได้/);
    const apart = [[...SKU, 'A-01-01', '', 1, 'เบิก', 'โอน', ''], [...SKU, '', 'QA', 1, 'รับ', 'โอน', '']];
    expect((await x.rows(apart)).error).toMatch(/ตารางแบบเดิมลงไม่ได้/);
    expect(x.store.dump()['meta/head'].seq).toBe(1);
  });

  it('ไม่รับ: ต้องมีเหตุผล · ของยังล็อกจนหัวหน้ายกเลิก · รับหรืออนุมัติไม่ได้อีก', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa()])).doc;
    expect((await x.qa.okSave([a], 'reject', '  ')).error).toBe('ใส่เหตุผลที่ไม่รับ');
    expect((await x.staff2.okSave([a], 'reject', 'ไม่มีของ')).error).toMatch(/ทีม QA หรือหัวหน้ารับ/);
    ok(await x.qa.okSave([a], 'reject', 'ไม่มีของมา'));
    expect(x.doc(a)).toMatchObject({ rj: QA_EMAIL, rjName: 'คิวเอทดลอง', rjWhy: 'ไม่มีของมา', okAt: NOW });
    expect(x.doc(a).ck).toBeUndefined();
    await x.staff.sync();
    expect(C.okState(x.staff.local().docs.find((d) => d.no === a), {})).toBe('reject');
    expect((await x.head.okSave([a], 'both')).error).toMatch(/ผู้รับไม่รับ/);
    expect((await x.move('qa', [fromQa()])).error).toMatch(/ไม่รับ .*ให้หัวหน้ายกเลิกใบ/);
    const rev = ok(await x.head.post('bk-void', { doc: a, why: 'ของไม่มา' })).reversed;
    expect(await x.free('QA')).toBeNull();
    expect(await x.free('A-01-01')).toEqual([20, 20]);
    const list = ok(await x.staff.trList()).list;
    expect([a, rev].map((no) => list.find((d) => d.no === no).state)).toEqual(['none', 'none']);
    expect((await x.staff.trSave([{ no: rev, tr: 'R-1', state: 'done' }])).error).toMatch(/ยกเลิกก่อนอนุมัติ ไม่ต้องลง TRcloud/);
    expect(x.staff.trFile([a, rev])).toMatchObject({ docs: [], hold: [], skip: [a, rev] });
  });

  it('กินชิ้นรอรับทางอื่นไม่ได้: แปลง ปรับลด ยกเลิกใบอื่น · ยอดของรายงานยังเป็นของจริง', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa(2)])).doc;
    ok(await x.qa.okSave([a], 'check'));
    ok(await x.move('staff', [toQa(3)]));
    expect(await x.free('QA')).toEqual([5, 2]);
    const conv = [[...SKU, 'QA', '', 3, 'เบิก', 'แปลงสินค้า', ''], ['BBB002', 'BBB0000000002', '8', 'P1', '', 'QA', 3, 'รับ', 'แปลงสินค้า', '']];
    expect((await x.staff.post('bk-conv', body('v-x', conv))).error).toMatch(HELD);
    await x.head.sync();
    const adj = await x.head.post('bk-adj', body('a-x', [[...SKU, 'QA', '', 4, 'เบิก', 'ปรับยอด หาย', '']],
      { lines: [{ loc: 'QA', sku: 'AAA0000000001', lot: '8', po: 'P1', have: 5, count: 1 }] }));
    expect(adj.error).toMatch(/อย่าปรับยอด/);
    const b = ok(await x.move('qa', [fromQa(1)])).doc;
    expect((await x.head.post('bk-void', { doc: a, why: 'ผิด' })).error).toMatch(/ถูกใช้ไปแล้ว/);
    ok(await x.head.post('bk-void', { doc: b, why: 'ผิด' }));
    ok(await x.head.post('bk-void', { doc: a, why: 'ผิด' }));
    await x.staff.sync();
    const plain = B.stock(x.staff.fifo());
    const phys = plain.all[plain.code('AAA0000000001')].find((p) => p.loc === 'QA');
    expect([phys.qty, B.freeQty(phys)]).toEqual([3, 3]);                           // ไม่ส่งของรอรับ = คิดแบบเดิม
  });

  it('แผนของหน้า: ใช้เฉพาะชิ้นที่ว่าง บอกเลขใบที่รอรับ · ปนแบบหรือผิดทีมขึ้นแถวแดง', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa(2)])).doc;
    await x.qa.sync();
    const st = B.stock(x.qa.fifo(), undefined, C.holdList(x.qa.local()));
    const line = { sku: 'AAA001', from: 'QA', to: 'A-01-03', qty: '1', lot: '8', po: 'P1' };
    const p = B.planMoves([line], st, { iqa: true });
    expect(p.lines[0].st).not.toBe('ok');
    expect(p.lines[0].why).toContain(a);
    expect(p.rows).toEqual([]);

    const plan = () => B.planMoves([{ ...line, from: 'R01-01-01' }, { ...line, from: 'A-01-01', to: 'QA' }], st, { iqa: true });
    const mixed = C.xferCheck(plan(), { role: 'staff', team: '' }, 'move');
    expect(mixed.lines.map((o) => o.st)).toEqual(['ok', 'bad']);
    expect(mixed.lines[1].why).toMatch(/แยกบันทึกคนละใบ/);
    const wrong = C.xferCheck(B.planMoves([{ ...line, from: 'A-01-01', to: 'QA' }], st), { role: 'staff', team: 'qa' }, 'move');
    expect(wrong.lines[0].why).toMatch(/ให้คลัง \/ Inbound ทำ/);
    const grid = C.xferCheck(B.planRows([{ ...line, from: 'A-01-01', to: 'QA', type: 'เบิก', note: 'โอนย้าย QA' }], st, { date: '2026-11-10' }), { role: 'head' }, 'rows');
    expect(grid.lines[0].why).toMatch(/ตารางแบบเดิมลงไม่ได้/);
  });

  it('เครื่องอื่นรู้ทันทีเมื่อมีคนกดรับ (ov เปลี่ยน seq เท่าเดิม) และใช้ของได้', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa()])).doc;
    await x.staff.sync();
    const woke = [];
    const stop = x.staff.watch((m) => woke.push(m.ov || 0));
    ok(await x.qa.okSave([a], 'check'));
    await new Promise((r) => setTimeout(r, 0));
    expect(woke).toContain(1);
    expect(await x.free('QA')).toEqual([2, 2]);
    /* รับครบแล้ว อนุมัติอย่างเดียวไม่เปลี่ยนของที่ใช้ได้ = ไม่ปลุกทุกเครื่องให้อ่าน */
    await x.staff.sync();
    woke.length = 0;
    ok(await x.head.okSave([a], 'approve'));
    await new Promise((r) => setTimeout(r, 0));
    expect(woke).toEqual([]);
    stop();
  });

  it('Rules: ทีม ไม่รับ และเลข TRcloud ก่อนอนุมัติ บังคับที่ฐานข้อมูลด้วย', async () => {
    const x = await world();
    const a = ok(await x.move('staff', [toQa()])).doc;
    const as = (email) => { x.store.setUser({ email, verified: true }); return x.store; };
    const d = x.doc(a), p = x.path(a), m = x.store.dump()['meta/head'];
    const rj = (email, why = 'ไม่มีของ') => [[p, { ...d, rj: email, rjName: x.store.dump()['users/' + email].name, rjWhy: why, okAt: C.TIME }]];
    await expect(as(STAFF2_EMAIL).commit([[p, { ...d, ck: STAFF2_EMAIL, ckName: 'x', ckAt: C.TIME, okAt: C.TIME }]])).rejects.toThrow(/ทีมนี้รับใบโอนแบบนี้ไม่ได้/);
    await expect(as(STAFF2_EMAIL).commit(rj(STAFF2_EMAIL))).rejects.toThrow(/ทีมนี้รับใบโอนแบบนี้ไม่ได้/);
    await expect(as(STAFF_EMAIL).commit(rj(STAFF_EMAIL))).rejects.toThrow(/คนทำไม่รับใบของตัวเองไม่ได้/);
    await expect(as(QA_EMAIL).commit(rj(QA_EMAIL, ''))).rejects.toThrow(/ช่องไม่รับไม่ถูก/);
    await expect(as(STAFF_EMAIL).commit([[p, { ...d, tr: 'TR-1', trState: 'done', trBy: STAFF_EMAIL, trAt: C.TIME }]])).rejects.toThrow(/ยังไม่อนุมัติ/);
    const make = (email, over) => {
      const doc = { ...d, no: 'T2611-' + String(m.next).padStart(4, '0'), seq: m.seq + 1, row: m.rows + 2, by: email, at: C.TIME, ...over };
      return as(email).commit([['docs/new', doc], ['meta/head', { ...m, seq: m.seq + 1, next: m.next + 1, rows: m.rows + doc.n, last: 'new', at: C.TIME }]]);
    };
    await expect(make(QA_EMAIL, {})).rejects.toThrow(/ทีมนี้ทำใบโอนแบบนี้ไม่ได้/);
    await expect(make(STAFF_EMAIL, { tr: 'TR-1', trState: 'done' })).rejects.toThrow(/ต้องเริ่มที่รอลง/);
    await expect(make(STAFF_EMAIL, { xf: '' })).rejects.toThrow(/ต้องเป็นใบโอน QA/);
    await expect(as(QA_EMAIL).commit(rj(QA_EMAIL))).resolves.toBeUndefined();
    await expect(as(HEAD_EMAIL).commit([[p, { ...x.doc(a), ck: HEAD_EMAIL, ckName: 'หัวหน้าทดลอง', ckAt: C.TIME, okAt: C.TIME }]])).rejects.toThrow(/ไม่รับแล้ว/);

    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    for (const k of ["(d.type != 'ย้าย' || moveOk(d, u))", "(x in ['in', 'out']) ? (d.trState == 'wait' && d.tr == '')",
      "(x == 'in' ? !qa : qa)", "(x == 'out' ? !qa : qa)", '((!ck && !rj) || takeOk(old, u))', "old.get('rj', '') == ''", 'd.rj != old.by',
      `d.rjWhy.size() <= ${C.WHY_MAX}`, "old.get('trState', '') != 'wait' || old.get('ap', '') != ''"]) expect(rules, k).toContain(k);
  });

  it('หัวหน้าตั้งทีมในรายชื่อ · แก้ชื่อโดยไม่ส่งทีม = คงทีมเดิม', async () => {
    const x = await world();
    ok(await x.head.saveUser(STAFF2_EMAIL, { name: 'ย้ายทีม', role: 'staff', team: 'qa' }));
    ok(await x.head.saveUser(STAFF2_EMAIL, { name: 'ย้ายทีม 2', role: 'staff' }));
    expect(x.store.dump()['users/' + STAFF2_EMAIL].team).toBe('qa');
    expect((await x.head.users()).users.find((u) => u.email === STAFF2_EMAIL)).toMatchObject({ team: 'qa', name: 'ย้ายทีม 2' });
    expect((await x.head.saveUser(STAFF2_EMAIL, { name: 'x', role: 'staff', team: 'x' })).error).toMatch(/ทีมต้องเป็น/);
    ok(await x.head.saveUser(STAFF2_EMAIL, { name: 'กลับคลัง', role: 'staff', team: '' }));
    expect(x.store.dump()['users/' + STAFF2_EMAIL].team).toBe('');
  });

  it('สำรอง กู้คืน และปิดเดือน เก็บ xf เหตุผลไม่รับ และทีม', async () => {
    const x = await world({ now: Date.UTC(2026, 9, 20, 3) });
    const a = ok(await x.move('staff', [toQa()])).doc;
    const g = fakeGcp();
    g.mirror(x.store.dump());
    const gs = g.load();
    gs.backupNightly();
    x.tick(16 * DAY);
    ok(await x.head.archClose());                                                 // ปิด ต.ค.
    x.tick(60000);
    ok(await x.qa.okSave([a], 'reject', 'ผิด LOT'));                              // ไม่รับหลังปิดเดือน
    g.mirror(x.store.dump());
    gs.backupNightly();
    gs.restoreAll('demo-new');
    const back = g.plain('demo-new');
    expect(back[x.path(a)]).toMatchObject({ xf: 'in', rj: QA_EMAIL, rjWhy: 'ผิด LOT' });
    expect(back['users/' + QA_EMAIL].team).toBe('qa');
    const copy = ok(await x.head.backup()).backup.data;
    expect(copy[x.path(a)]).toMatchObject({ xf: 'in', rj: QA_EMAIL, rjWhy: 'ผิด LOT' });
    expect(copy['users/' + QA_EMAIL].team).toBe('qa');

    ok(await x.move('staff', [leg('R01-01-01', 'A-01-03', 1, 'โอนย้าย')]));   // เอกสารของ พ.ย.
    x.tick(29 * DAY);
    ok(await x.head.archClose());                                                 // ปิด พ.ย. การไม่รับอยู่ในก้อนของที่แก้หลังปิด
    const f = await x.device(VIEW_EMAIL);
    await f.sync();
    expect(f.local().docs.find((d) => d.no === a)).toMatchObject({ rj: QA_EMAIL, rjName: 'คิวเอทดลอง', rjWhy: 'ผิด LOT' });
    expect(C.holdList(f.local())).toMatchObject([{ loc: 'QA', qty: 2, docs: [{ no: a, rj: true }] }]);
  });
});

/* ── ขั้น 0: คำสั่งเขียนที่ประกอบเอง (ไม่ผ่านหน้าเว็บ) ───────────────────── */

describe('ขั้น 0: ปิดช่องเขียนปลอม', () => {
  const MIN = 60000;
  const ok = (r) => { expect(r.error, JSON.stringify(r).slice(0, 300)).toBeUndefined(); return r; };
  const head = (x) => x.store.dump()['meta/head'];
  const docOf = (x, no) => Object.entries(x.store.dump()).find(([p, d]) => p.startsWith('docs/') && d.no === no);
  const as = (x, email) => { const c = x.store.connect(); c.setUser({ email, verified: true }); return c; };
  const row = (over = []) => Object.assign(['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', 'A-01-02', 1, 'เบิก', 'โอนย้าย', 'เปิด', ''], over);
  const mv = (n = 1, from = 'A-01-01', to = 'A-01-02', note = 'โอนย้าย') => ['AAA001', 'AAA0000000001', '8', 'P1', from, to, n, 'เบิก', note, 'เปิด'];
  const inQa = (n = 1) => mv(n, 'A-01-01', 'QA', 'โอนย้าย QA');
  async function world(opt = {}) {
    const x = await both(opt);
    ok(await x.head.post('bk-open', { batch: 'o-1', rows: OPEN }));
    x.day = () => C.today(x.clock());
    x.move = (batch, copy, f = x.staff) => f.post('bk-move', { batch, date: x.day(), copy });
    return x;
  }
  /** เอกสาร + meta ที่ประกอบเอง ถูกกฎทุกข้อ ยกเว้นช่องที่เทสต์ตั้งใจแก้ */
  function forge(x, { id = 'fk-1', by = STAFF_EMAIL, rows = [row()], d: dd = {}, m: mm = {} } = {}) {
    const old = head(x), month = C.yymm(x.clock()), next = old && old.month === month ? old.next : 1;
    const base = old ? old.rows : 0, seq = (old ? old.seq : 0) + 1;
    const d = {
      v: 1, no: 'T' + month + '-' + String(next).padStart(4, '0'), seq, row: base + 2, n: rows.length, type: 'ย้าย', date: C.today(x.clock()),
      by, name: x.store.dump()['users/' + by].name, at: C.TIME, stamp: C.stamp(x.clock()), ref: '', link: '', why: '', qty: rows.reduce((a, r) => a + Math.abs(+r[6] || 0), 0),
      tr: '', trState: 'none', rows: C.enc(rows), names: '', orders: '', part: 1, ...dd,
    };
    const m = { v: 1, mv: 0, tv: 0, open: null, ...old, seq, month, next: next + 1, last: id, rows: base + (typeof d.n === 'object' ? rows.length : d.n), at: C.TIME, ...mm };
    return { id, d, m, send: (extra = []) => as(x, by).commit([['docs/' + id, d], ...extra, ['meta/head', m]]) };
  }
  const rulesText = () => fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');

  it('ชุดที่ประกอบเองถูกกฎทุกข้อยังผ่าน (ตัวเทียบของเคสปลอม)', async () => {
    const x = await world();
    await expect(forge(x).send()).resolves.toBeUndefined();
    await x.staff.sync();
    expect(x.staff.local().meta.open.id).toBe('o-1');
  });

  it('1 เอกสารใหม่มีช่องรับ อนุมัติ เลขย้อนหลัง หรือช่องแปลกไม่ได้', async () => {
    const x = await world();
    const bad = [
      { ck: STAFF_EMAIL }, { ckName: 'ทดลอง' }, { ckAt: C.TIME }, { ap: STAFF_EMAIL }, { apName: 'ทดลอง' }, { apAt: C.TIME }, { okAt: C.TIME },
      { rj: STAFF_EMAIL }, { rjWhy: 'x' }, { trBy: STAFF_EMAIL }, { trAt: C.TIME }, { trLog: [] }, { hidden: 1 },
    ];
    for (const d of bad) await expect(forge(x, { d }).send(), JSON.stringify(d)).rejects.toThrow(/เอกสารใหม่มีช่องที่ใส่ไม่ได้/);
    const f = forge(x, { d: { part: 2 } });
    const part = { v: 1, of: f.id, seq: f.d.seq, i: 2, rows: '', orders: '', ck: STAFF_EMAIL };
    await expect(f.send([['docs/' + f.id + '~2', part]])).rejects.toThrow(/ส่วนแยกมีช่องที่ใส่ไม่ได้/);
    delete part.ck;
    await expect(f.send([['docs/' + f.id + '~2', part]])).resolves.toBeUndefined();
  });

  it('2 ชื่อคนทำ รับ ไม่รับ อนุมัติ ต้องตรงรายชื่อ', async () => {
    const x = await world();
    for (const name of ['หัวหน้าทดลอง', '', 5]) await expect(forge(x, { d: { name } }).send(), String(name)).rejects.toThrow(/ชื่อคนทำไม่ตรงรายชื่อ/);
    const qa = await x.join(QA_EMAIL);
    const no = ok(await x.move('m-1', [inQa()])).doc, [p, d] = docOf(x, no);
    await expect(as(x, QA_EMAIL).commit([[p, { ...d, ck: QA_EMAIL, ckName: 'หัวหน้าทดลอง', ckAt: C.TIME, okAt: C.TIME }]])).rejects.toThrow(/ชื่อผู้ตรวจไม่ตรงรายชื่อ/);
    await expect(as(x, QA_EMAIL).commit([[p, { ...d, rj: QA_EMAIL, rjName: 'คนอื่น', rjWhy: 'ไม่มีของ', okAt: C.TIME }]])).rejects.toThrow(/ชื่อผู้ไม่รับไม่ตรงรายชื่อ/);
    ok(await qa.okSave([no], 'check'));
    const d2 = docOf(x, no)[1];
    await expect(as(x, HEAD_EMAIL).commit([[p, { ...d2, ap: HEAD_EMAIL, apName: 'คนอื่น', apAt: C.TIME, okAt: C.TIME }]])).rejects.toThrow(/ชื่อผู้อนุมัติไม่ตรงรายชื่อ/);
  });

  it('2 เปลี่ยนชื่อระหว่างเปิดหน้า = ลงต่อได้ด้วยชื่อใหม่ · ไม่มีชื่อ = อีเมล ไม่ใช่ชื่อจาก Google', async () => {
    const x = await world();
    const qa = await x.join(QA_EMAIL);
    ok(await x.head.saveUser(STAFF_EMAIL, { name: 'ชื่อใหม่', role: 'staff' }));
    const no = ok(await x.move('m-1', [inQa()])).doc;
    expect(docOf(x, no)[1].name).toBe('ชื่อใหม่');
    ok(await x.head.saveUser(QA_EMAIL, { name: 'คิวเอชื่อใหม่', role: 'staff' }));
    ok(await qa.okSave([no], 'check'));
    expect(docOf(x, no)[1].ckName).toBe('คิวเอชื่อใหม่');
    ok(await x.head.saveUser(HEAD_EMAIL, { name: 'หัวหน้าชื่อใหม่', role: 'head' }));
    expect(x.head.user().name).toBe('หัวหน้าชื่อใหม่');
    ok(await x.head.okSave([no], 'approve'));
    x.store.seed({ ['users/' + STAFF2_EMAIL]: { role: 'staff', active: true } });
    const f = await x.device(STAFF2_EMAIL);
    const b = ok(await x.move('m-2', [mv()], f)).doc;
    expect(docOf(x, b)[1].name).toBe(STAFF2_EMAIL);
  });

  it('3 วันที่เอกสาร: ย้อนไม่เกิน 45 วัน ล่วงหน้าไม่เกิน 1 วัน เท่าหน้าเว็บ (เผื่อเที่ยงคืน 10 นาที)', async () => {
    const x = await world();
    for (const date of ['2026-09-25', '2026-11-12', '1999-01-01', '2099-01-01', '2026-11-1', '2026-11-99', '2026-13-01', '', 'x', 20261110])
      await expect(forge(x, { d: { date } }).send(), String(date)).rejects.toThrow(/วันที่เอกสาร/);
    for (const date of ['2026-09-26', '2026-11-11']) {
      const w = await world();
      await expect(forge(w, { d: { date } }).send(), date).resolves.toBeUndefined();
    }
    const at0 = Date.UTC(2026, 10, 10, 17, 4);   // 11 พ.ย. 00:04 เวลาไทย
    expect(C.dayOk('2026-09-26', at0)).toBe(true);
    expect(C.dayOk('2026-09-25', at0)).toBe(false);
    expect(C.dayOk('2026-09-26', at0 + 7 * MIN)).toBe(false);
    for (let gap = -3; gap <= 47; gap++) {
      const day = C.today(NOW - gap * DAY);
      expect(C.dayOk(day, NOW), day).toBe(!C.prep('bk-gr', { batch: 'g', date: day, copy: [['A', '', '1', 'P', '', 'A-1', 1, 'รับ', 'GR 01-11-26', '']] }, NOW).error);
    }
  });

  it('7 meta: เปลี่ยน / ล้างตัวชี้ยอดยกมา แถวรวม รุ่น ช่องแปลก ไม่ได้', async () => {
    const x = await world();
    const open = head(x).open;
    const bad = [
      [{ open: { id: 'fk-1', no: 'T2611-0002', seq: 2 } }, /ตัวชี้ยอดยกมา/],
      [{ open: { ...open, seq: 99 } }, /ตัวชี้ยอดยกมา/],
      [{ open: null }, /ตัวชี้ยอดยกมา/],
      [{ rows: 0 }, /แถวรวม/], [{ rows: 999999 }, /แถวรวม/],
      [{ v: 2 }, /รุ่นหรือช่องของ meta/], [{ extra: 1 }, /รุ่นหรือช่องของ meta/],
    ];
    for (const [m, why] of bad) {
      await expect(forge(x, { m }).send(), JSON.stringify(m)).rejects.toThrow(why);
      await expect(forge(x, { m, by: HEAD_EMAIL }).send(), JSON.stringify(m)).rejects.toThrow(why);
    }
    const gone = forge(x);
    delete gone.m.open;
    await expect(gone.send()).rejects.toThrow(/ตัวชี้ยอดยกมา/);
    await expect(forge(x, { d: { row: 2 } }).send()).rejects.toThrow(/แถวแรก/);
    await expect(forge(x, { d: { n: -1 }, m: { rows: head(x).rows - 1 } }).send()).rejects.toThrow(/แถวรวม/);
    await expect(forge(x, { d: { n: 40001 }, m: { rows: head(x).rows + 40001 } }).send()).rejects.toThrow(/แถวรวม/);
    expect(head(x).open).toEqual(open);
    ok(await x.move('m-1', [mv()]));
  });

  it('7 ยอดยกมา: หัวหน้าเท่านั้น ชี้ตัวเอง ลงใหม่ได้จนกว่าจะมีเอกสารหลังยอด', async () => {
    const x = await world();
    const opening = (over = {}) => {
      const f = forge(x, { by: HEAD_EMAIL, d: { type: 'ยอดยกมา', row: 2 } });
      Object.assign(f.m, { rows: f.d.n, open: { id: f.id, no: f.d.no, seq: f.d.seq } }, over);
      return f;
    };
    for (const open of [null, head(x).open, { id: 'x', no: opening().d.no, seq: opening().d.seq }])
      await expect(opening({ open }).send()).rejects.toThrow(/ตัวชี้ยอดยกมา/);
    ok(await x.head.post('bk-open', { batch: 'o-2', rows: OPEN.slice(0, 2), replace: true }));
    expect(head(x)).toMatchObject({ rows: 2, open: { id: 'o-2', seq: 2 } });
    const no = ok(await x.move('m-1', [mv()])).doc;
    await expect(opening().send()).rejects.toThrow(/มีเอกสารหลังยอดยกมา/);
    ok(await x.head.post('bk-void', { doc: no, why: 'ผิด' }));
    expect(head(x)).toMatchObject({ rows: 4, open: { id: 'o-2' } });
    x.tick(22 * DAY);   // 2 ธ.ค. เดือนใหม่
    expect(ok(await x.move('m-2', [mv()])).doc).toBe('T2612-0001');
    expect(head(x)).toMatchObject({ rows: 5, open: { id: 'o-2' } });
  });

  it('7 ฐานว่าง: สร้างตัวชี้เองไม่ได้ · บันทึกโดยไม่มียอดยกมาไม่ถูกล็อกที่ Rules (ผู้ใช้ยังไม่เอา)', async () => {
    const x = await both();
    await expect(forge(x, { m: { open: { id: 'fk-1', no: 'T2611-0001', seq: 1 } } }).send()).rejects.toThrow(/ตัวชี้ยอดยกมา/);
    await expect(forge(x).send()).resolves.toBeUndefined();
    expect(head(x)).toMatchObject({ rows: 1, open: null });
  });

  it('5 เปลี่ยนเลข TRcloud ต้องต่อประวัติ: เลขเดิม คนแก้ เวลา · ลบหรือแก้ประวัติไม่ได้', async () => {
    const x = await world();
    const gr = ['AAA001', 'AAA0000000001', '8', 'P7', '', 'A-01-01', 2, 'รับ', 'GR 10-11-26', 'เปิด'];
    const no = ok(await x.staff.post('bk-gr', { batch: 'g-1', date: x.day(), copy: [gr] })).doc;
    const set = (over) => { const [p, d] = docOf(x, no); return [[p, { ...d, trBy: STAFF_EMAIL, trAt: C.TIME, trState: 'done', ...over }]]; };
    await expect(as(x, STAFF_EMAIL).commit(set({ tr: 'GR-1', trLog: [{ tr: 'ปลอม', state: 'done', by: HEAD_EMAIL, at: 1 }] }))).rejects.toThrow(/ประวัติเลข TRcloud/);
    ok(await x.staff.trSave([{ no, tr: 'GR-1', state: 'done' }]));
    expect(docOf(x, no)[1].trLog).toBeUndefined();   // ครั้งแรกยังไม่มีค่าเดิม
    const T1 = docOf(x, no)[1].trAt, was = { tr: 'GR-1', state: 'done', by: STAFF_EMAIL, at: T1 };
    x.tick(MIN);
    for (const trLog of [undefined, [], [{ ...was, tr: 'GR-9' }], [{ ...was, by: HEAD_EMAIL }], [{ ...was, state: 'wait' }], [{ ...was, at: T1 - 5000 }], [{ ...was, memo: 1 }], [was, was]]) {
      const w = set({ tr: 'GR-2', trLog });
      if (!trLog) delete w[0][1].trLog;
      await expect(as(x, STAFF_EMAIL).commit(w), JSON.stringify(trLog)).rejects.toThrow(/ประวัติเลข TRcloud/);
    }
    ok(await x.head.trSave([{ no, tr: 'GR-2', state: 'done' }]));
    expect(docOf(x, no)[1].trLog).toEqual([was]);
    expect(x.head.local().docs.find((d) => d.no === no).trLog).toEqual([was]);
    x.tick(MIN);
    ok(await x.staff.trSave([{ no, tr: '', state: 'wait' }]));
    expect(docOf(x, no)[1].trLog.map((e) => [e.tr, e.by])).toEqual([['GR-1', STAFF_EMAIL], ['GR-2', HEAD_EMAIL]]);
    await expect(as(x, STAFF_EMAIL).commit(set({ tr: 'GR-3', trLog: [{ tr: '', state: 'wait', by: STAFF_EMAIL, at: x.clock() }] }))).rejects.toThrow(/ประวัติเลข TRcloud/);
    const z = await x.device(VIEW_EMAIL);
    await z.sync();
    const doc = z.local().docs.find((d) => d.no === no);
    expect(doc.trLog).toHaveLength(2);
    expect(C.docOut(doc).trLog).toEqual(doc.trLog);
    const v = DOC.view(z.local(), no, x.clock());
    expect(v.history.map((h) => h.what).filter((w) => /TRcloud/.test(w))).toEqual(['ใส่เลข TRcloud GR-1', 'ใส่เลข TRcloud GR-2', 'ตั้งกลับเป็นรอลง TRcloud']);
    expect(DOC.index(z.local()).find((d) => d.no === no).text).toContain('gr-1');
    expect(ok(await x.head.backup()).backup.data['docs/g-1'].trLog).toEqual(docOf(x, no)[1].trLog);
  });

  it('5 เลขที่มากับแถวตอนบันทึก และสองเครื่องแก้พร้อมกัน ไม่เสียเลขเดิม', async () => {
    const x = await world();
    const gr = ['AAA001', 'AAA0000000001', '8', 'P7', '', 'A-01-01', 2, 'รับ', 'GR 10-11-26', 'เปิด', 'GR-A'];
    const no = ok(await x.staff.post('bk-gr', { batch: 'g-1', date: x.day(), copy: [gr] })).doc, saved = docOf(x, no)[1].at;
    x.tick(MIN);
    await x.staff.sync();
    x.staff.store.hook(async () => { ok(await x.head.trSave([{ no, tr: 'GR-B', state: 'done' }])); });
    ok(await x.staff.trSave([{ no, tr: 'GR-C', state: 'done' }]));
    const d = docOf(x, no)[1];
    expect(d.tr).toBe('GR-C');
    expect(d.trLog).toEqual([{ tr: 'GR-A', state: 'done', by: STAFF_EMAIL, at: saved }, { tr: 'GR-B', state: 'done', by: HEAD_EMAIL, at: saved + MIN }]);
    const full = Array.from({ length: C.TR_LOG_MAX }, () => d.trLog[0]);
    x.store.seed({ 'docs/g-1': { ...d, trLog: full } });
    const z = await x.device(HEAD_EMAIL);
    expect((await z.trSave([{ no, tr: 'GR-D', state: 'done' }])).error).toMatch(/ประวัติเลข TRcloud เต็ม/);
    expect(docOf(x, no)[1].tr).toBe('GR-C');
  });

  async function closed() {
    const x = await world({ now: Date.UTC(2026, 9, 20, 3) });
    const gr = ['AAA001', 'AAA0000000001', '8', 'P7', '', 'A-01-01', 2, 'รับ', 'GR 20-10-26', 'เปิด'];
    x.gr = ok(await x.staff.post('bk-gr', { batch: 'g-1', date: x.day(), copy: [gr] })).doc;
    ok(await x.staff.trSave([{ no: x.gr, tr: 'GR-1', state: 'done' }]));
    x.tick(16 * DAY);   // 5 พ.ย.
    ok(await x.move('m-1', [mv()]));
    ok(await x.head.archClose());
    return x;
  }

  it('4 เดือนที่ปิดแล้ว: ก้อน รายชื่อเดือน และก้อนเลขหลังปิด เขียนทับไม่ได้', async () => {
    const x = await closed(), h = as(x, HEAD_EMAIL), a = (p) => x.store.dump()['arch/' + p];
    await expect(h.commit([['arch/2610-1', { m: '2610', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/เดือนนี้ปิดแล้ว/);
    await expect(h.commit([['arch/2610-9', { m: '2610', k: 9, n: 0, t: '[]' }]])).rejects.toThrow(/เดือนนี้ปิดแล้ว/);
    await expect(h.commit([['arch/ov-2610-1', { m: '2610', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/เดือนนี้ปิดแล้ว/);
    await expect(h.commit([['arch/2611-1', { m: '2611', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/เดือนยังไม่จบ/);
    await expect(h.commit([['arch/2610-2', { m: '2611', k: 2, n: 0, t: '[]' }]])).rejects.toThrow(/ชื่อก้อนปิดเดือนไม่ถูก/);
    await expect(h.commit([['arch/ov-1', { k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/ชื่อก้อนปิดเดือนไม่ถูก/);
    const idx = a('index'), mo = idx.months[0];
    for (const months of [[], [{ ...mo, to: 99 }], [mo, { ...mo }], [{ ...mo, by: 'x' }, { ...mo, m: '2609' }]])
      await expect(h.commit([['arch/index', { ...idx, months }]]), JSON.stringify(months)).rejects.toThrow(/รายชื่อเดือนที่ปิด/);
    await expect(h.commit([['arch/index', { ...idx, extra: 1 }]])).rejects.toThrow(/รายชื่อเดือนที่ปิด/);
    await expect(h.commit([['arch/index', { ...idx, months: [mo, { ...mo, m: '2611' }], ov: { ...idx.ov, m: '2611' } }]])).rejects.toThrow(/เดือนยังไม่จบ/);
  });

  it('4 ปิดเดือนถัดไป + ประวัติเลขในก้อนหลังปิด เครื่องใหม่ได้ครบ', async () => {
    const x = await closed();
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: x.gr, tr: 'GR-2', state: 'done' }]));   // หลังปิด ต.ค.
    x.tick(28 * DAY);
    ok(await x.move('m-2', [mv()]));
    expect(ok(await x.head.archClose())).toMatchObject({ closed: '2611', fix: 1 });
    const idx = x.store.dump()['arch/index'];
    expect(idx.ov).toMatchObject({ m: '2611', n: 1 });
    const e = JSON.parse(x.store.dump()['arch/ov-2611-1'].t)[0];
    expect([e.length, e[15]]).toEqual([16, docOf(x, x.gr)[1].trLog]);
    const z = await x.device(VIEW_EMAIL);
    await z.sync();
    expect(z.local().docs.find((d) => d.no === x.gr)).toMatchObject({ tr: 'GR-2', trLog: [{ tr: 'GR-1' }] });
    await expect(as(x, HEAD_EMAIL).commit([['arch/ov-2611-1', { m: '2611', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/เดือนนี้ปิดแล้ว/);
    expect(W.ARCH_BATCH * 3).toBeLessThanOrEqual(20);
  });

  /* 6 แถวปลอมกันที่ Rules ไม่ได้: สคริปต์ของเจ้าของโปรเจกต์ตรวจแล้วแจ้งหัวหน้า */
  function auditor(x, over) {
    const g = fakeFireGcp({ over });
    return {
      g,
      run() {
        g.mirror(x.store.dump());
        const r = g.gs.auditRefresh();
        return { ...r, last: plainFire(g.projects['demo-src']['audit/last']) };
      },
    };
  }
  const plainFire = (f) => {
    const val = (v) => ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue
      : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? Date.parse(v.timestampValue)
      : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : 'mapValue' in v ? plainFire(v.mapValue.fields) : null);
    return Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
  };

  it('6 งานปกติทุกประเภท รวมยกเลิก เอกสารแยกส่วน ยอดยกมาใหม่ ไม่เตือนผิด', async () => {
    const x = await world({ partBytes: 900 });
    ok(await x.head.post('bk-open', { batch: 'o-2', rows: OPEN, replace: true }));
    const date = x.day(), post = async (f, op, b) => ok(await f.post(op, { date, ...b })).doc;
    const qa = await x.join(QA_EMAIL);
    const nos = [];
    nos.push(await post(x.staff, 'bk-move', { batch: 'big', copy: Array.from({ length: 14 }, () => mv(0.5)) }));
    nos.push(await post(x.staff, 'bk-cut', cutBody('c-1', [saleLine('J1', 2)], date)));
    nos.push(await post(x.staff, 'bk-gr', { batch: 'g-1', copy: [['AAA001', 'AAA0000000001', '11', 'P7', '', 'A-01-01', 3, 'รับ', 'GR 10-11-26', 'เปิด']] }));
    nos.push(await post(x.staff, 'bk-conv', { batch: 'v-1', copy: [
      ['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 1, 'เบิก', 'แปลงสินค้า', ''], ['BBB002', 'BBB0000000002', '8', 'P1', '', 'A-03-01', 1, 'รับ', 'แปลงสินค้า', 'เปิด'],
    ] }));
    nos.push(await post(x.staff, 'bk-return', { batch: 'r-1', lines: [{ sku: 'AAA0000000001', qty: 1, piles: [['A-01-01', '8', 'P1', 1]] }],
      copy: [['AAA001', 'AAA0000000001', '8', 'P1', '', 'A-01-01', 1, 'รับ', 'RETURN', 'เปิด']] }));
    nos.push(await post(x.head, 'bk-rows', { batch: 't-1', copy: [['BBB002', 'BBB0000000002', '7', 'P5', 'A-03-01', '', 1, 'เบิก', 'เคลม', '']] }));
    await x.head.sync();
    const have = Object.values(C.allPiles(x.head.local())).find((p) => p.loc === 'QA').qty;
    nos.push(await post(x.head, 'bk-adj', { batch: 'a-1', lines: [{ loc: 'QA', sku: 'CCC0000000004', lot: '0', po: '0', have, count: have - 1 }],
      copy: [['CCC004', 'CCC0000000004', '0', '0', 'QA', '', 1, 'เบิก', 'ปรับยอด นับใหม่', '']] }));
    const q = await post(x.staff, 'bk-move', { batch: 'q-1', copy: [inQa(2)] });
    ok(await qa.okSave([q], 'check'));
    await post(qa, 'bk-move', { batch: 'q-2', copy: [mv(1, 'QA', 'A-01-02', 'โอนย้าย QA')] });
    expect(x.store.dump()['docs/big'].part).toBeGreaterThan(1);
    const a = auditor(x);
    let r = a.run();
    expect(r.last.list, JSON.stringify(r.last.list)).toEqual([]);
    expect(r.last.n).toBe(0);
    for (const no of nos.slice().reverse()) ok(await x.head.post('bk-void', { doc: no, why: 'ทดลองยกเลิก' }));
    r = a.run();
    expect(r.last.list, JSON.stringify(r.last.list)).toEqual([]);
    expect(r.last).toMatchObject({ v: 1, n: 0, seq: head(x).seq });
  });

  it('6 แถวเสกยอด ติดลบ โอน QA แฝง แถวไม่ตรงหัวใบ ถูกจับและบอกเลขที่', async () => {
    const x = await world();
    const cases = [
      [{ rows: [row({ 4: '', 7: 'รับ' })] }, /ย้าย/],
      [{ rows: [row({ 7: 'รับ' })] }, /ย้าย/],
      [{ rows: [row({ 6: 999 })] }, /ติดลบ/],
      [{ rows: [row({ 5: 'QA' })] }, /QA/],
      [{ rows: [row({ 6: -5 })] }, /ชิ้น/],
      [{ rows: [row()], d: { n: 3 }, m: { rows: undefined } }, /จำนวนแถว/],
      [{ rows: [row()], d: { qty: 500 } }, /ยอดรวม/],
      [{ rows: [row({ 4: '', 7: 'รับ', 5: 'A-01-02', 8: 'GR 10-11-26' }), row({ 4: '', 7: 'รับ' })], d: { type: 'แปลง', trState: 'wait' } }, /คู่แปลง/],
    ];
    const want = [];
    for (let i = 0; i < cases.length; i++) {
      const [c, why] = cases[i];
      const f = forge(x, { id: 'bad-' + i, ...c, m: {} });
      f.m.rows = head(x).rows + f.d.n;
      await f.send();   // Rules อ่านแถวไม่ได้ จึงผ่าน
      want.push([f.d.no, why]);
    }
    const r = auditor(x).run();
    for (const [no, why] of want) expect((r.last.list.find((e) => e.no === no) || {}).why, no).toMatch(why);
    expect(r.last.n).toBe(cases.length);
    expect(JSON.stringify(r.last)).not.toContain('@example.test');
  });

  it('6 ใบกลับรายการที่ไม่ตรงใบเดิมถูกจับ · ยกเลิกถูกต้องแล้วการเตือนหาย', async () => {
    const x = await world();
    const f = forge(x, { id: 'bad', rows: [row({ 4: '', 7: 'รับ', 6: 3 })] });
    await f.send();
    const a = auditor(x);
    expect(a.run().last.list.map((e) => e.no)).toEqual([f.d.no]);
    ok(await x.head.post('bk-void', { doc: f.d.no, why: 'ใบปลอม' }));
    expect(a.run().last.n).toBe(0);
    const no = ok(await x.move('m-1', [mv()])).doc;
    const rev = forge(x, { id: 'rev|' + no, by: HEAD_EMAIL, rows: [row({ 4: '', 5: 'A-01-01', 6: 50, 7: 'รับ' })], d: { type: 'กลับรายการ', link: no, trState: '' } });
    await rev.send();
    expect(a.run().last.list).toMatchObject([{ no: rev.d.no, why: expect.stringMatching(/กลับรายการ/) }]);
  });

  it('6 อ่านเฉพาะของใหม่ · เกินเวลาทำต่อ · ล้างฐานแล้วเริ่มใหม่ · หัวหน้ารับทราบแล้วไม่ค้าง', async () => {
    const x = await world();
    for (let i = 0; i < 45; i++) ok(await x.move('m-' + i, [mv(0.1)]));
    const a = auditor(x);
    expect(a.run().reads).toBeGreaterThan(45);
    expect(a.run().reads).toBeLessThanOrEqual(3);
    ok(await x.move('m-new', [mv(0.1)]));
    expect(a.run().reads).toBeLessThanOrEqual(5);

    const slow = auditor(x, { STOP_MS: -1 });
    expect(slow.run().last).toMatchObject({ more: true, n: 0 });
    let r;
    for (let i = 0; i < 4; i++) r = slow.run();
    expect(r.last).toMatchObject({ more: false, n: 0, seq: head(x).seq });

    const bad = forge(x, { id: 'bad', rows: [row({ 4: '', 7: 'รับ' })] });
    await bad.send();
    expect(a.run().last.n).toBe(1);
    a.g.gs.auditSeen();
    expect(plainFire(a.g.projects['demo-src']['audit/last']).n).toBe(0);
    expect(a.run().last.n).toBe(0);

    const y = await both();   // ล้าง docs กับ meta แล้วลงยอดใหม่
    ok(await y.head.post('bk-open', { batch: 'new', rows: OPEN }));
    a.g.mirror(y.store.dump());
    a.g.gs.auditRefresh();
    expect(plainFire(a.g.projects['demo-src']['audit/last'])).toMatchObject({ n: 0, seq: 1 });
  });

  it('6 ตั้งเวลาไม่ซ้ำ · ฐานว่างก็เขียนว่าตัวตรวจทำงาน · เว็บแอปไม่ส่งผลตรวจ', async () => {
    const g = fakeFireGcp();
    g.mirror({});
    g.gs.installShare();
    g.gs.installAudit();
    g.gs.installAudit();
    expect(g.triggers.map((t) => [t.h, t.hours])).toEqual([['shareRefresh', 2], ['auditRefresh', 2]]);
    expect(plainFire(g.projects['demo-src']['audit/last'])).toMatchObject({ n: 0, seq: 0 });
    expect(g.projects['demo-src']['audit/last'].at.timestampValue).toBeTruthy();
    expect(g.get({ api: 'audit' }).error).toBe('ไม่รู้จักคำสั่งนี้');
    g.gs.stopAudit();
    expect(g.triggers.map((t) => t.h)).toEqual(['shareRefresh']);
  });

  it('6 ผลตรวจ: หัวหน้าอ่านอย่างเดียว · การ์ดบอกผิด หยุด และยังไม่ติดตั้ง', async () => {
    const x = await world();
    const at = x.clock();
    x.store.seed({ 'audit/last': { v: 1, at, n: 1, seq: 1, list: [{ no: 'T2611-0002', why: 'ยอดติดลบ' }] } });
    expect((await x.head.auditInfo()).audit.n).toBe(1);
    expect((await x.staff.auditInfo()).error).toBeTruthy();
    await expect(as(x, STAFF_EMAIL).get('audit/last')).rejects.toThrow(/เฉพาะหัวหน้า/);
    for (const e of [STAFF_EMAIL, HEAD_EMAIL]) await expect(as(x, e).commit([['audit/last', { v: 1, n: 0 }]])).rejects.toThrow(/เขียน audit ไม่ได้/);
    const audit = x.store.dump()['audit/last'], card = (o) => DOC.auditCard({ open: true, now: at, ...o });
    expect(card({ audit })).toMatchObject({ tone: 'bad', n: 1 });
    expect(card({ audit: { ...audit, n: 0, list: [] } })).toBe(null);
    expect(card({ audit: { ...audit, n: 0, list: [] }, now: at + 6 * 3600000 }).title).toMatch(/หยุด/);
    expect(card({ audit: null }).title).toMatch(/ยังไม่/);
    expect(card({ error: 'ไม่มีสิทธิ์' }).title).toMatch(/อ่าน/);
    expect(card({ audit: null, open: false })).toBe(null);
    expect(rulesText()).toMatch(/match \/audit\/\{id\} \{\s*allow read: if signedIn\(\) && isHead\(profile\(\)\);\s*allow write: if false;/);
  });

  /* 8 ใบเดียวทำแอปทุกเครื่องล่ม · 9 ใบเดียวทำทุกเครื่องอ่านฐานเป็นพันครั้ง */
  const MAP = { toString: '', valueOf: '' };   // แปลงเป็นข้อความหรือตัวเลขแล้ว throw
  const NL = String.fromCharCode(10), TAB = String.fromCharCode(9);
  const protoNames = () => Object.getOwnPropertyNames(Object.prototype).filter((k) => !k.startsWith('__'));
  const partDoc = (f, i, over = {}) => ['docs/' + f.id + '~' + i, { v: 1, of: f.id, seq: f.d.seq, i, rows: '', orders: '', ...over }];
  /** ใบที่ค้างอยู่ในฐานแล้ว (ลงก่อนวาง Rules ชุดนี้ หรือเจ้าของโปรเจกต์เขียน) ไม่ผ่านกฎ */
  function plant(x, opt = {}) {
    const f = forge(x, opt), at = x.clock();
    x.store.seed({ ['docs/' + f.id]: { ...f.d, at }, ...(opt.extra || {}), 'meta/head': { ...f.m, at } });
    return f;
  }
  /** เครื่องใหม่ดึงแล้วเปิดทุกหน้าที่คิดจากสำเนา */
  async function openAll(x, email = HEAD_EMAIL) {
    const c = x.store.connect(), f = await x.device(email, { store: c });
    await f.sync();
    const reads = c.mine().reads, l = f.local(), day = x.day();
    f.fifo();
    DOC.home(l, x.clock(), f.user());
    DOC.search(DOC.index(l), { q: 'x' }, x.clock());
    l.docs.forEach((d) => { const v = DOC.view(l, d.no); if (v && PR.can(v)) PR.html(v, { logo: '', printed: '' }); });
    IT.card(l, 'AAA0000000001', {});
    TX.summary(l, x.clock()); TX.daily(l, x.clock(), day, day); TX.history(l, 'AAA0000000001');
    await f.trList();
    ok(await f.xferDays()); ok(await f.quota());
    f.xferText(day);
    return { f, l, reads };
  }

  it('8 รหัสชุดต้องเป็นแบบที่แอปออก · ใบยกเลิกผูกกับเลขที่ใบเดิม', async () => {
    const bad = [...protoNames(), '__proto__', '.x', '-x', 'x~2', 'rev|T2611-0009', 'a b', 'ก', 'x'.repeat(61)];
    const x = await world();
    for (const id of bad) await expect(forge(x, { id }).send(), id).rejects.toThrow(/รหัสชุด/);
    for (const batch of ['constructor', 'toString', 'a b', 'x~2', 'a|b', '.x']) expect((await x.move(batch, [mv()])).error, batch).toMatch(/รหัสชุด/);
    const good = ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'bmhabc12xyz90', 'dev-open2', 'm.1_a', 'x'.repeat(60)];
    for (const id of good) await expect(forge(x, { id }).send(), id).resolves.toBeUndefined();

    const y = await world();
    const rev = (id, link) => forge(y, { id, by: HEAD_EMAIL, d: { type: 'กลับรายการ', link, trState: '' } });
    await expect(rev('rv-1', 'T2611-0002').send()).rejects.toThrow(/รหัสชุด/);
    await expect(rev('rev|T2611-0002', MAP).send()).rejects.toThrow(/รหัสชุด/);
    const doc = ok(await y.move('v-me', [mv()])).doc;
    ok(await y.head.post('bk-void', { doc, why: 'ทดสอบ' }));
    expect(y.store.dump()['docs/rev|' + doc].link).toBe(doc);

    const text = rulesText();
    expect(text).toContain("id.matches('" + C.ID_RE.source.slice(1, -1) + "')");
    protoNames().forEach((k) => expect(text).toContain("'" + k + "'"));
  });

  it('8 ช่องหัวใบผิดชนิดไม่รับ', async () => {
    const x = await world();
    const cases = [{ v: 2 }, { qty: '3' }, { qty: MAP }, { trState: 'later', type: 'รับของ' }, { xf: 7, type: 'รับของ' }];
    for (const k of ['stamp', 'ref', 'link', 'why', 'tr', 'rows', 'names', 'orders']) for (const v of [MAP, [MAP], 7, null]) cases.push({ type: 'รับของ', [k]: v });
    for (const d of cases) await expect(forge(x, { d }).send(), JSON.stringify(d)).rejects.toThrow(/รูปเอกสาร/);
    const f = forge(x);
    delete f.d.orders;
    await expect(f.send()).rejects.toThrow(/รูปเอกสาร/);
  });

  it('9 จำนวนส่วนเกิน 7 หรือผิดชนิดไม่รับ · ส่วนแยกแก้เลข TRcloud ไม่ได้', async () => {
    const x = await world();
    for (const part of [0, -1, 2.5, '2', null, MAP, 8, 2000, 20000]) await expect(forge(x, { d: { part } }).send(), JSON.stringify(part)).rejects.toThrow(/รูปเอกสาร/);
    for (const i of [1, 8, 2000, 2.5]) {
      const f = forge(x, { d: { part: 2 } });
      await expect(f.send([partDoc(f, i)]), String(i)).rejects.toThrow(/ส่วนแยก/);
    }
    for (const over of [{ rows: MAP }, { orders: 5 }, { rows: undefined }, { i: '2' }, { of: MAP }]) {
      const f = forge(x, { d: { part: 2 } }), p = partDoc(f, 2, over);
      Object.keys(over).forEach((k) => { if (over[k] === undefined) delete p[1][k]; });
      await expect(f.send([p]), JSON.stringify(over)).rejects.toThrow(/ส่วนแยก/);
    }
    const f = forge(x, { d: { part: 7 } });
    await expect(f.send([2, 3, 4, 5, 6, 7].map((i) => partDoc(f, i)))).resolves.toBeUndefined();
    const [p, d] = partDoc(f, 2);
    const edit = { ...d, tr: 'TR-1', trState: 'done', trBy: STAFF_EMAIL, trAt: C.TIME };
    await expect(as(x, STAFF_EMAIL).commit([[p, edit]])).rejects.toThrow(/ส่วนแยก/);
    expect(rulesText()).toMatch(/d\.part is int && d\.part >= 1 && d\.part <= 7/);
    expect(rulesText()).toMatch(/d\.i is int && d\.i >= 2 && d\.i <= 7/);
    expect(rulesText()).toMatch(/!\('of' in old\)/);
    expect(C.PARTS_MAX).toBe(7);
  });

  it('8 ใบผิดรูปที่ค้างในฐาน ทุกเครื่องยังดึงและเปิดทุกหน้าได้', async () => {
    const cases = protoNames().concat('__proto__').map((id) => ({ id }));
    for (const k of ['no', 'type', 'date', 'name', 'stamp', 'ref', 'link', 'why', 'tr', 'trState', 'rows', 'names', 'orders', 'row', 'n', 'qty', 'part', 'xf', 'by']) {
      for (const v of [MAP, [MAP], 7, true]) cases.push({ d: { [k]: v } });
    }
    for (const word of ['constructor', '__proto__', 'toString']) {
      for (const c of [4, 5, 8]) cases.push({ rows: [row({ [c]: word })] });
      cases.push({ rows: [row({ 7: 'ขาย', 5: '', 8: word })], d: { type: 'ตัดขาย', trState: 'wait' } });
      cases.push({ d: { type: 'ตัดขาย', trState: 'wait', orders: ['JST', '1', 'AAA0000000001', '1', word, word, word + '|8|P1|1', ''].join(TAB) } });
    }
    cases.push({ extra: { 'docs/zz~2': { v: 1, of: 'constructor', seq: 2, i: 2, rows: '', orders: '' } } });
    cases.push({ extra: { 'docs/zz~2': { v: 1, of: MAP, seq: 2, i: MAP, rows: MAP, orders: MAP } } });
    for (const c of cases) {
      const x = await world(), p = plant(x, c), label = JSON.stringify(c).slice(0, 160);
      let got;
      try { got = await openAll(x); } catch (e) { throw new Error(label + ' → ' + e.message); }
      expect(got.l.seq, label).toBe(p.d.seq);
      ok(await got.f.post('bk-move', { batch: 'next', date: x.day(), copy: [mv(1, 'R01-01-01', 'A-01-02')] }));
    }
  }, 60000);

  it('8 บันทึก Note ชื่อชน เครื่องคนบันทึกเห็นเท่าเครื่องอื่น', async () => {
    const x = await world();
    ok(await x.head.post('bk-rows', { batch: 't-note', date: x.day(), copy: [['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', '', 1, 'เบิก', 'constructor', 'เปิด']] }));
    const mine = x.head.local().docs.find((d) => d.id === 't-note');
    TX.summary(x.head.local(), x.clock());
    const { l } = await openAll(x);
    expect(mine.rows).toEqual(l.docs.find((d) => d.id === 't-note').rows);
  });

  it('8 ใบเต็มขนาดกับข้อความยาว อ่านเท่าที่แอปบันทึกได้จริง ไม่ค้าง', async () => {
    const d1 = C.docIn('a', { rows: NL.repeat(C.OPEN_MAX + 50), orders: NL.repeat(C.LINES_MAX + 50), names: '', part: 1 }, []);
    expect(d1.rows.length).toBe(C.OPEN_MAX);
    expect(d1.lines.length).toBe(C.LINES_MAX);
    const piles = Array.from({ length: 500 }, () => 'A|8|P1|1').join(';');
    const d2 = C.docIn('b', { names: 'K' + TAB + 'y'.repeat(5000), rows: row({ 8: 'z'.repeat(5000) }).join(TAB),
      orders: ['JST', '1', 'S', '1', '', '', piles, ''].join(TAB), part: 1 }, []);
    expect(d2.rows[0][8].length).toBe(C.CELL_MAX);
    expect(d2.names.K.length).toBe(C.CELL_MAX);
    expect(d2.lines[0].piles.split(';').length).toBe(20);

    const long = 'GR' + ' '.repeat(20000) + 'x', t0 = Date.now();
    expect(C.ownDate(long)).toBe('');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(C.plainDate('2026-11-10 08:30:00')).toBe('2026-11-10');
    expect(C.plainDate('2026-11-10   08:30')).toBe('2026-11-10');
  });

  it('9 ใบอ้างส่วนเป็นพัน อ่านเพิ่มไม่เกิน 6 · ใช้เฉพาะส่วนในช่วงที่หัวใบบอก', async () => {
    const x = await world();
    const base = (await openAll(x)).reads;
    plant(x, { d: { part: 20000 } });
    const a = await openAll(x, STAFF_EMAIL);
    expect(a.reads - base).toBeLessThanOrEqual(1 + 6);
    expect(a.l.docs.find((d) => d.id === 'fk-1').part).toBe(7);

    x.store.seed({ 'arch/index': { v: 1, months: [{ m: '2610', from: 1, to: 2, n: 0, skip: ['o-1', 'fk-1'] }], ov: { m: '2610', n: 0 } } });
    expect((await openAll(x)).reads - base).toBeLessThanOrEqual(1 + 6 + 5);

    const y = await world(), f = plant(y);
    y.store.seed({ ['docs/' + f.id + '~2']: { v: 1, of: f.id, seq: f.d.seq, i: 2, rows: C.enc([row()]), orders: '' } });
    expect((await openAll(y)).l.docs.find((d) => d.id === f.id).rows.length).toBe(1);
  });

  it('9 หน้าที่มีแต่ส่วนกำพร้าไม่ทำให้ค้าง', async () => {
    const z = await world(), old = head(z), seq = old.seq + 1, page = {};
    for (let i = 2; i < 320; i++) page['docs/lost~' + i] = { v: 1, of: 'lost', seq, i, rows: '', orders: '' };
    z.store.seed({ ...page, 'docs/next': { ...forge(z).d, seq: seq + 1, at: z.clock() }, 'meta/head': { ...old, seq: seq + 1 } });
    const f = await z.device(STAFF_EMAIL);
    await f.sync();
    expect(f.local().seq).toBe(seq + 1);
    expect(f.local().docs.map((d) => d.id)).toContain('next');
  });

  it('9 ส่วนที่ถูกแก้เลขไว้ก่อนวาง Rules ไม่ถูกอ่านซ้ำทุกรอบ', async () => {
    const y = await world();
    ok(await y.move('m-1', [mv()]));
    const c = y.store.connect(), dev = await y.device(STAFF_EMAIL, { store: c });
    await dev.sync();
    const parts = {}, at = y.clock() + 1000;
    for (let i = 0; i < 30; i++) parts['docs/p' + i + '~2'] = { v: 1, of: 'p' + i, seq: 1, i: 2, rows: '', orders: '', trAt: i < 29 ? at : at + 1 };
    y.store.seed({ ...parts, 'meta/head': { ...head(y), tv: 1 } });
    await dev.sync();
    const before = c.mine().reads;
    y.store.seed({ 'meta/head': { ...head(y), tv: 2 } });
    await dev.sync();
    expect(c.mine().reads - before).toBeLessThan(6);
  });

  it('8 ตัวนับโควตากับบันทึกชีตเดิมผิดรูป หน้าไม่พัง', async () => {
    const x = await world();
    ok(await x.move('m-1', [mv()]));
    const day = x.day();
    x.store.seed({ 'xfer/log': { [day]: { by: MAP, at: 1e30, n: MAP, last: MAP } }, ['use/' + C.pacificDay(x.clock())]: { bad: { r: MAP, w: [MAP], by: MAP } } });
    const { f } = await openAll(x);
    const done = (await f.xferDays()).days.find((d) => d.day === day).done;
    expect(done).toMatchObject({ by: '', at: 0, last: '' });
    expect((await f.quota()).all.list.find((d) => d.dev === 'bad')).toMatchObject({ r: 0, w: 0, by: '' });
  });

  it('8 ตัวตรวจกับชุดแชร์ทนใบผิดรูป และยังแจ้งหัวหน้า', async () => {
    const cases = [];
    for (const k of ['no', 'type', 'date', 'name', 'stamp', 'link', 'rows', 'names', 'orders', 'n', 'qty', 'part', 'row', 'xf']) cases.push({ d: { [k]: MAP } }, { d: { [k]: [MAP] } });
    cases.push({ id: 'constructor' }, { d: { part: 20000 } }, { rows: [row({ 8: 'z'.repeat(5000) })] }, { d: { rows: NL.repeat(45000) } });
    for (const c of cases) {
      const x = await world();
      plant(x, c);
      const label = JSON.stringify(c).slice(0, 90);
      let last, share;
      try {
        last = auditor(x).run().last;
        const g = fakeFireGcp();
        g.mirror(x.store.dump());
        share = g.gs.shareRefresh();
      } catch (e) { throw new Error(label + ' → ' + e.message); }
      expect(last.n, label).toBeGreaterThan(0);
      expect(last.seq, label).toBe(2);
      expect(last.list.map((b) => b.why).join(' '), label).not.toMatch(/ตรวจใบนี้ไม่ได้/);
      expect(share.seq, label).toBe(2);
    }
  }, 60000);

  it('8 ยกเลิกใบผิดรูปแล้วการเตือนหาย · ใบที่ตรวจไม่ได้ไม่หยุดตัวตรวจ', async () => {
    for (const c of [{ 8: 'z'.repeat(5000) }, { 5: 'L'.repeat(400) }, { 5: 'constructor', 8: 'z'.repeat(400) }]) {
      const x = await world(), f = plant(x, { rows: [row(c)] }), a = auditor(x);
      expect(a.run().last.n).toBe(1);
      await x.head.sync();
      ok(await x.head.post('bk-void', { doc: f.d.no, why: 'ทดสอบ' }));
      expect(a.run().last.n, Object.keys(c).join()).toBe(0);
    }
    const x = await world();
    ok(await x.move('m-1', [mv()]));
    const src = fs.readFileSync(path.resolve(__dirname, '../../apps-script/fire-backup.gs'), 'utf8');
    const g = fakeFireGcp({ source: src.replace('function auditRow_(type, r) {', () => 'function auditRow_(type, r) { if (type === "ย้าย") throw new Error("ทดสอบ");') });
    g.mirror(x.store.dump());
    g.gs.auditRefresh();
    const last = plainFire(g.projects['demo-src']['audit/last']);
    expect(last).toMatchObject({ n: 1, seq: 2 });
    expect(last.list[0].why).toMatch(/ตรวจใบนี้ไม่ได้/);
  });

  it('8 รหัสชนช่องในตัวไม่ทำให้รวมไฟล์สำรองและกู้คืนล้ม', async () => {
    const x = await world(), g = fakeFireGcp();
    plant(x, { id: 'constructor' });
    g.mirror(x.store.dump());
    g.gs.backupFull();
    expect(g.gs.restoreAll('demo-new').ok).toBe(true);
    const data = { 'docs/constructor': { seq: 1 }, 'docs/toString~2': { seq: 2 } };
    expect(TR.mergeBackups([{ made: 1, data }])).toEqual(data);
  });

  it('9 สำรองรายคืนไม่อ่านตามจำนวนส่วนปลอม', async () => {
    const x = await world(), g = fakeFireGcp();
    g.mirror(x.store.dump());
    g.gs.backupFull();
    plant(x, { d: { part: 20000, trAt: x.clock() + 1000 } });
    g.mirror(x.store.dump());
    g.calls.length = 0;
    g.gs.backupNightly();
    expect(g.calls.length).toBeLessThan(40);
  });
});
