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

let B, C, W, S, TR, DOC;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fire-core.js', 'wms-fire-trc.js', 'wms-fire-docs.js', 'wms-fire.js', 'wms-stocktake.js'].forEach((f) => new Function('window', read(f))(win));
  B = win.WmsBook;
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
const USERS = {
  ['users/' + STAFF_EMAIL]: { name: 'ทดลอง', role: 'staff', active: true },
  ['users/' + HEAD_EMAIL]: { name: 'หัวหน้าทดลอง', role: 'head', active: true },
  ['users/' + VIEW_EMAIL]: { name: 'ดูอย่างเดียวทดลอง', role: 'viewer', active: true },
  'users/off@example.test': { name: 'ปิดแล้ว', role: 'staff', active: false },
};
const ACCOUNTS = Object.keys(USERS).map((p) => ({ email: p.slice(6), name: USERS[p].name }));

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

    /* Rules: tv เพิ่มทีละ 1 เท่านั้น */
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    const m = x.store.dump()['meta/head'];
    await expect(x.store.commit([['meta/head', { ...m, tv: 5 }]])).rejects.toThrow(/tv ต้องเพิ่มทีละ 1/);
    await expect(x.store.commit([['meta/head', { ...m, tv: 2 }]])).resolves.toBeUndefined();
  });

  it('ยกเลิก: ก่อนลง TRcloud ไม่ต้องลงทั้งคู่ · หลังลงแล้ว เอกสารกลับรายการรอลง (ชนิดเดียวกับเอกสารเดิม)', async () => {
    const x = await ready();
    ok(await x.head.post('bk-void', { doc: 'T2611-0007', why: 'นับผิด' }));       // 0008 ปรับยอดยังไม่ลง
    ok(await x.head.post('bk-void', { doc: 'T2611-0005', why: 'รับผิด PO' }));    // 0009 รับของลงแล้ว
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
    const f = x.staff.trFile(['T2611-0003', 'T2611-0007', 'T2611-0004', 'T2611-0002', 'T2611-0099']);
    expect(f.aoa[0]).toEqual(S.TRC_HEAD);
    expect(f.aoa.slice(1)).toEqual([
      ...x.staff.trFile(['T2611-0003']).aoa.slice(1),
      ['AAA0000000001', '2026-11-10', '', 2, '', '', 'T2611-0007', 'IV', 'WH-02', ''],
    ]);
    expect(f.aoa.slice(1, 3).map((r) => [r[2], r[3], r[8]]).sort()).toEqual([['', 1, 'WH-02'], [1, '', 'WH-QA']]);
    expect(f.docs).toEqual(['T2611-0003', 'T2611-0007']);
    expect(f.skip).toEqual(['T2611-0004', 'T2611-0002']);   // รับของ = ใส่เลข · ย้ายในคลังไม่เปลี่ยนคลัง
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
    ok(await x.staff.post('bk-move', body('m-2', [QA_MV, mv3({ 4: 'A-01-01', 5: 'B-01-01', 6: 2 })])));
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
      ['AAA001', 'R01-01-01', 'A-01-01', '1', 'T2611-0002'], ['AAA001', 'R01-01-01', 'QA', '1', 'T2611-0003'], ['AAA001', 'A-01-01', 'B-01-01', '2', 'T2611-0003'],
    ]);

    /* เลข TRcloud ที่ใส่ทีหลังในหน้ารอลง ลงคอลัมน์ N แทนเลขที่ (แถวที่มีเลขของตัวเองใช้เลขของแถว) */
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
const TIME3 = ['at', 'trAt', 'last'];
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

  it('fire-backup.gs กู้คืน: รวมทุกไฟล์ลงโปรเจกต์ว่าง ได้ข้อมูลเท่าฐานเดิมทุกช่อง (เวลาเป็น timestamp) · มีข้อมูลแล้วไม่ทับ · เกินเวลาทำต่อได้', async () => {
    const x = await filled();
    const g = fakeGcp();
    g.mirror(x.store.dump());
    const gs = g.load();
    gs.backupNightly();
    x.tick(DAY);
    ok(await x.staff.post('bk-move', body('m-2', [mv3()])));
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
    expect(rules).toContain("hasOnly(['tr', 'trState', 'trBy', 'trAt'])");
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
    /* meta + index + 1 ก้อน + เอกสาร พ.ย. 2 + เลข TRcloud หลังปิด (ว่าง) + ตารางหลัก 3 */
    expect(fr.reads).toBe(1 + 1 + 1 + 2 + 1 + 3);
    expect(fr.reads).toBeLessThan(full.reads);
    expect(fr.f.local().docs.find((d) => d.id === 'big').cut.length).toBeGreaterThan(1);   // แยกส่วนตรงกับในฐาน (ไฟล์สำรองยังตรง)
    expect(TR.backupOf(fr.f.local(), {}, NOW).data['docs/big~2']).toEqual(x.store.dump()['docs/big~2']);

    /* Rules: คนลงรายการเขียนก้อนไม่ได้ · ชื่อก้อนต้องถูกรูป */
    x.store.setUser({ email: STAFF_EMAIL, verified: true });
    await expect(x.store.commit([['arch/2610-1', { m: '2610', k: 1, n: 0, t: '[]' }]])).rejects.toThrow(/ปิดเดือนได้เฉพาะหัวหน้า/);
    x.store.setUser({ email: HEAD_EMAIL, verified: true });
    await expect(x.store.commit([['arch/oops', { t: '[]' }]])).rejects.toThrow(/ชื่อก้อนปิดเดือนไม่ถูก/);
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    expect(rules).toMatch(/match \/arch\/\{id\} \{\s*allow read: if signedIn\(\) && isActive\(profile\(\)\);\s*allow create, update: if signedIn\(\) && isHead\(profile\(\)\)/);
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
    expect(JSON.parse(x.store.dump()['arch/ov-1'].t)).toEqual([['g-1', 'GR6910-0002', 'done', STAFF_EMAIL, OCT + 16 * DAY + MIN]]);
    x.tick(MIN);
    ok(await x.staff.trSave([{ no: 'T2610-0005', tr: 'GR6910-0003', state: 'done' }]));   // หลังปิด พ.ย.
    await full.sync();
    const b = await freshDevice(x);
    await sameCopy(b.f, full);
    const list = (await b.f.trList()).list;
    expect(['T2610-0004', 'T2610-0005', 'T2611-0002'].map((no) => list.find((d) => d.no === no).state)).toEqual(['done', 'done', 'wait']);
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
    /* meta + index + ก้อน + เอกสารใหญ่ (หลัก + ส่วนแยก) + เอกสาร พ.ย. 2 + เลข TRcloud หลังปิด + ตารางหลัก 3 */
    const parts = Object.keys(x.store.dump()).filter((p) => p.startsWith('docs/big~')).length;
    expect(parts).toBeGreaterThan(0);
    expect(fr.reads).toBe(1 + 1 + c.chunks + 1 + parts + 2 + 1 + 3);
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
      stamp: '', ref: '', link: '', why: '', qty: 1, tr: '', trState: '', rows: '', names: '', orders: '', part: 1 };
    await expect(x.store.commit([['docs/back', d], ['meta/head', { ...m, seq: m.seq + 1, month: '2611', next: 2, last: 'back', at: C.TIME }]])).rejects.toThrow(/ย้อนเดือนเดิมไม่ได้/);
  });

  it('ช่วงเผื่อ ±10 นาทีตรงกันทั้งแอป store จำลอง และ firestore.rules · เดือนเลขเอกสารไม่ย้อน', () => {
    expect(C.MONTH_TOL).toBe(10 * MIN);
    expect(C.monthsOk(END)).toEqual(['2611', '2612']);
    expect(C.monthsOk(END - 11 * MIN)).toEqual(['2611']);
    expect(C.monthsOk(END + 11 * MIN)).toEqual(['2612']);
    expect(C.monthsOk(Date.UTC(2026, 11, 31, 17, 5))).toEqual(['2612', '2701']);   // ข้ามปี
    const rules = fs.readFileSync(path.resolve(__dirname, '../../firebase/firestore.rules'), 'utf8');
    expect(rules.match(/duration\.value\(10, 'm'\)/g)).toHaveLength(2);
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
    expect(q({ status: 'wait' }).list.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0004', 'T2611-0003']);
    expect(q({ status: 'mine', email: HEAD_EMAIL }).list.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0001']);
    const all = q({ status: 'wait' });
    expect(all.types).toEqual({ 'ปรับยอด': 1, 'รับของ': 1, 'ย้าย': 1 });
    expect(all.states).toEqual({ wait: 3, void: 0, mine: 0 });
    expect(q({ type: 'รับของ', email: STAFF_EMAIL }).states).toEqual({ wait: 1, void: 0, mine: 2 });
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
    expect(h.wait).toEqual({ n: 3, oldest: '2026-11-10', days: 0, file: 2, number: 1 });
    expect(h.last.map((d) => d.no)).toEqual(['T2611-0007', 'T2611-0006', 'T2611-0005', 'T2611-0004', 'T2611-0003', 'T2611-0002']);
    const later = DOC.home(x.head.local(), NOW + 3 * DAY, HEAD_EMAIL);
    expect(later).toMatchObject({ total: 0, mine: 0, last: [] });
    expect(later.wait).toMatchObject({ n: 3, days: 3 });
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
