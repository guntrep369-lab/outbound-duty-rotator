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
import { loadBook, fifoFromBook } from '../dev/fake-gas.js';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let B, C, W, S;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fire-core.js', 'wms-fire.js', 'wms-stocktake.js'].forEach((f) => new Function('window', read(f))(win));
  B = win.WmsBook;
  C = win.WmsFireCore;
  W = win.WmsFire;
  S = win.WmsStocktake;
});

const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);   // 10 พ.ย. 2569 10:00 เวลาไทย
const DAY = 86400000;
const ME = { who: 'ทดลอง', pin: '1111' };
const HEAD = { who: 'หัวหน้าทดลอง', pin: '9999' };
const DOMAIN = 'example.test';
const STAFF_EMAIL = 'staff@example.test', HEAD_EMAIL = 'head@example.test', VIEW_EMAIL = 'view@example.test';
const USERS = {
  ['users/' + STAFF_EMAIL]: { name: 'ทดลอง', role: 'staff', active: true },
  ['users/' + HEAD_EMAIL]: { name: 'หัวหน้าทดลอง', role: 'head', active: true },
  ['users/' + VIEW_EMAIL]: { name: 'ดูอย่างเดียวทดลอง', role: 'viewer', active: true },
  'users/off@example.test': { name: 'ปิดแล้ว', role: 'staff', active: false },
};
const ACCOUNTS = Object.keys(USERS).map((p) => ({ email: p.slice(6), name: USERS[p].name }));

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
    await x.same('me', 'bk-move', body('m-1', [mv(), mv({ 6: 1, 5: 'QA', 8: 'โอนย้าย QA', 9: '' })]));
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
  const nextMeta = (m, id, over = {}) => ({ ...m, seq: m.seq + 1, next: m.next + 1, last: id, at: C.TIME, ...over });
  const doc = (m, id, over = {}) => ({ v: 1, no: 'T2611-' + String(m.next).padStart(4, '0'), seq: m.seq + 1, row: m.rows + 2, n: 1, type: 'ย้าย', date: '2026-11-10',
    by: STAFF_EMAIL, name: 'ทดลอง', at: C.TIME, stamp: '', ref: '', link: '', why: '', qty: 1, tr: '', trState: '', rows: '', names: '', orders: '', part: 1, ...over });

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
    await expect(s.commit([['docs/b', doc(m2, 'b', { part: 10 })], ...parts2, ['meta/head', nextMeta(m2, 'b')]])).rejects.toThrow(/Rules อ่านเอกสารประกอบ 22 ครั้ง เกิน 20/);
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
    await expect(s.commit([['docs/o-1', { ...d, tr: 'GR1', trState: 'ลงแล้ว', trBy: STAFF_EMAIL, trAt: 1 }]])).resolves.toBeUndefined();
    await expect(s.commit([['docs/o-1', { ...d, qty: 999, trBy: STAFF_EMAIL }]])).rejects.toThrow(/แก้ได้เฉพาะเลข TRcloud/);
    await expect(s.commit([['users/x@example.test', { name: 'x', role: 'head', active: true }]])).rejects.toThrow(/เฉพาะหัวหน้า/);
    await expect(as(x, HEAD_EMAIL).commit([['master/sup', { rows: 'P1\tผู้ผลิตสมมติ' }]])).resolves.toBeUndefined();
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), mv: 1 }]])).resolves.toBeUndefined();
    await expect(as(x, HEAD_EMAIL).commit([['meta/head', { ...meta(x), rows: 50 }]])).rejects.toThrow(/แค่ mv/);
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

  it('firestore.rules ตรงกับกฎของ store จำลอง: ประเภทเอกสารต่อสิทธิ์ ฟิลด์ TRcloud ที่แก้ได้ เพดานส่วน · ยังเป็นโดเมนตัวอย่าง', () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    const list = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
    const m = /\(d\.type in \[([^\]]+)\]\) \? \(u\.role == 'head'\)\s*: \(d\.type in \[([^\]]+)\]\)/.exec(rules);
    expect([list(m[1]), list(m[2])]).toEqual([C.HEAD_TYPES, C.STAFF_TYPES]);
    expect(rules).toContain("hasOnly(['tr', 'trState', 'trBy', 'trAt'])");
    expect(rules).toContain('ไม่เกิน ' + C.PARTS_MAX + ' ส่วน (PARTS_MAX) = ' + (4 + 2 * (C.PARTS_MAX - 1)));
    expect(4 + 2 * (C.PARTS_MAX - 1)).toBeLessThanOrEqual(20);
    expect(rules).toMatch(/matches\('\.\*@example\[\.\]com'\)/);
    /* ขั้น 2: ดูทั้งรายชื่อได้เฉพาะหัวหน้า · แก้ตัวเองได้แค่ last · use เติมทีละช่อง */
    expect(rules).toContain('allow list: if signedIn() && isHead(profile());');
    expect(rules).toContain("affectedKeys().hasOnly(['last'])");
    expect(rules).toMatch(/match \/use\/\{day\}[\s\S]*affectedKeys\(\)\.size\(\) == 1/);
    expect(rules).not.toMatch(/allow (delete|write): if true|allow [a-z, ]+: if request\.auth != null;/);
    const idx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.indexes.json'), 'utf8'));
    expect(idx.fieldOverrides.filter((f) => f.collectionGroup === 'docs').map((f) => f.fieldPath)).toEqual(expect.arrayContaining(['rows', 'orders', 'names']));
    expect(idx.fieldOverrides.map((f) => f.fieldPath)).not.toContain('seq');
  });

  it('ไฟล์ไม่มี URL key หรือ config ของ Firebase จริง SDK ตรึงรุ่นจาก gstatic เท่านั้น · dev server ห้ามต่อของจริง', () => {
    const src = read('wms-fire.js') + read('wms-fire-core.js') + read('book/book-fire.js') + read('book/book-fire-set.js');
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|firebaseapp\.com|script\.google\.com|apiKey\s*:/);
    expect(src.match(/https:\/\/[^'"\s)]+/g).filter((u) => !u.startsWith('https://www.gstatic.com/firebasejs/'))).toEqual([]);
    expect(W.SDK_V).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read('wms-fire.js')).toMatch(/dev server ห้ามต่อ Firebase จริง/);
    /* หน้าที่ deploy ไม่เปิดโหมดทดลอง: ต้องเป็น localhost และมี ?fire= เท่านั้น */
    expect(read('book/book-fire.js')).toMatch(/if \(!local \|\| !m\) \{ window\.BookFire = null; return; \}/);
  });
});
