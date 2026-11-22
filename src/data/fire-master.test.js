/**
 * ระบบใหม่ ข้อมูลหลัก: public/wms-fire-setup.js + setupSave ของ wms-fire.js กับ store จำลอง
 * ขั้น ก Location · SKU · กลุ่มสินค้า · ขั้น ข แปลงสินค้า · Supplier (PO) · SKU : Pallet (รูปเก็บเดิม fifo อ่านเหมือนเดิม)
 * ขั้น ค โซนแร็ค + ระบบเลือกแร็คตอนรับของ
 * ตรวจตาราง · บันทึกทั้งตาราง (รุ่น ประวัติ สองคนแก้พร้อมกัน) · พบในสมุดแต่ยังไม่มีในตาราง · เตือน / ห้าม ตอนลงใบ
 * ข้อมูลทั้งหมดสมมติขึ้น repo นี้เป็นสาธารณะ ไม่มีการเรียก Firebase จริง
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let B, C, W, SU, TR;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fire-core.js', 'wms-fire-trc.js', 'wms-fire-setup.js', 'wms-fire.js'].forEach((f) => new Function('window', read(f))(win));
  B = win.WmsBook;
  C = win.WmsFireCore;
  W = win.WmsFire;
  SU = win.WmsFireSetup;
  TR = win.WmsFireTrc;
  /* wms-fire-setup.js กับ wms-fire.js เรียก window.WmsFireCore / WmsFireSetup ตอนใช้งาน */
  globalThis.window = globalThis.window || win;
  globalThis.window.WmsFireCore = globalThis.window.WmsFireCore || C;
  globalThis.window.WmsFireTrc = win.WmsFireTrc;
  globalThis.window.WmsFireSetup = SU;
});

const NOW = Date.UTC(2026, 10, 22, 3, 0, 0);
const DOMAIN = 'example.test';
const STAFF = 'staff@example.test', HEAD = 'head@example.test', HEAD2 = 'head2@example.test';
const USERS = {
  ['users/' + STAFF]: { name: 'ทดลอง', role: 'staff', active: true },
  ['users/' + HEAD]: { name: 'หัวหน้าทดลอง', role: 'head', active: true },
  ['users/' + HEAD2]: { name: 'รองหัวหน้าทดลอง', role: 'head', active: true },
};
const ACCOUNTS = Object.keys(USERS).map((p) => ({ email: p.slice(6), name: USERS[p].name }));
/* ยอดยกมาสมมติ [SKU, SKU เต็ม, ชื่อ, LOT, PO, โล, ชิ้น, Status, วันรับ, ไตรมาส] */
const OPEN = [
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 6 ฟุต', '8', 'P1', 'A-01-01', 20, 'เปิด', '2026-10-02', ''],
  ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 6 ฟุต', '8', 'P1', 'R01-01-1', 10, '', '2026-10-02', ''],
  ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 5FT', '7', 'P5', 'A-03-01', 4, 'เปิด', '2026-09-01', ''],
  ['CCC004', 'CCC0000000004', 'แถมหมอนสมมติ', '0', '0', 'QA', 3, '', '', ''],
];

function ok(r) { if (!r || r.error) throw new Error((r && r.error) + ''); return r; }
const loc = (code, pal = '', on = true, note = '') => ({ code, pal, on, note });
const sku = (s, l, name, grp, on = true) => ({ sku: s, long: l, name, grp, gift: false, vac: false, on });

async function setup() {
  let t = NOW;
  const clock = () => t;
  const store = W.memStore({ now: clock, domain: DOMAIN });
  store.seed(USERS);
  const device = async (email) => {
    const f = W.open({ store: store.connect(), auth: W.fakeAuth(ACCOUNTS), now: clock });
    ok(await f.login(email));
    return f;
  };
  const head = await device(HEAD), staff = await device(STAFF);
  return { store, head, staff, device, tick: (ms) => { t += ms; } };
}
async function opened() {
  const x = await setup();
  ok(await x.head.post('bk-open', { batch: 'o-1', asOf: 900, rows: OPEN }));
  return x;
}

describe('ตรวจตาราง', () => {
  it('ชนิดของโล', () => {
    expect(SU.locKind('r01-02-1')).toEqual({ t: 'R', rack: 1, bay: 2, lv: 1 });
    expect(SU.locKind('A-01-02').t).toBe('F');
    expect(SU.locKind('S-01-01').t).toBe('S');
    ['RIB', 'QA', 'IQA', 'QA-02', 'DOCKLOAD', 'ORDER OB', 'จอง'].forEach((c) => expect(SU.locKind(c), c).toEqual({ t: 'X' }));
    expect(SU.locKind('QAX')).toBe(null);
    expect(SU.locKind('ZZ9')).toBe(null);
  });

  it('แถว ↔ วัตถุ ไปกลับได้เท่าเดิม', () => {
    const r = ['R01-01-1', '1', '0', 'ซ่อม'];
    expect(SU.rowOut('loc', SU.rowIn('loc', r))).toEqual(r);
    const s = ['AAA001', 'AAA0000000001', 'ชื่อ', 'm6', '1', '', '1'];
    expect(SU.rowOut('sku', SU.rowIn('sku', s))).toEqual(s);
    expect(SU.defaults().map((g) => g.id)).toEqual(['m6', 'm5', 'm35', 'tp', 'pl', 'bd', 'sb', 'gf']);
  });

  it('Location: ซ้ำ / ว่าง = แดง · แร็คเกิน 1 พาเลท / ปิดใช้แต่มีของ = ส้ม · รูปแบบแปลก = ข้อมูล', () => {
    const v = SU.validate('loc', [loc('R01-01-1', '2'), loc('r01-01-1'), loc(''), loc('ZZ9'), loc('A-01-01', '', false)], null, { loc: { 'A-01-01': 20 }, sku: {} });
    expect(v.rows[0].map((w) => w.lv)).toEqual(['red', 'warn']);
    expect(v.rows[1][0]).toEqual({ lv: 'red', t: 'รหัสซ้ำกับแถวอื่น' });
    expect(v.rows[2][0].lv).toBe('red');
    expect(v.rows[3]).toEqual([{ lv: 'info', t: expect.stringMatching(/รูปแบบ/) }]);
    expect(v.rows[4][0].t).toMatch(/ปิดใช้ แต่ยังมีของ 20/);
    expect([v.bad, v.warn]).toEqual([3, 1]);
  });

  it('SKU: ซ้ำ = แดง · ไม่มีกลุ่ม / กลุ่มที่ลบแล้ว = ส้ม', () => {
    const t = { grp: { rows: SU.defaults() }, sku: { rows: [] } };
    const v = SU.validate('sku', [sku('AAA001', 'AAA0000000001', 'ก', 'm6'), sku('AAA001', 'aaa0000000001', 'ข', 'm6'), sku('BBB002', '', 'ค', ''), sku('CCC004', '', 'ง', 'old')], t);
    expect(v.rows[1][0].lv).toBe('red');
    expect(v.rows[2][0].t).toBe('ยังไม่เลือกกลุ่ม');
    expect(v.rows[3][0].t).toMatch(/ไม่มีกลุ่มนี้/);
  });

  it('กลุ่ม: ชื่อซ้ำ = แดง · ไม่ขึ้นแร็คแต่ให้ไป RIB = ส้ม · ยังไม่มี SKU = ข้อมูล', () => {
    const g = SU.defaults();
    g.push({ id: 'g1', name: 'ท็อปเปอร์', c: '#000000', rack: 'no', lv: '', rest: 'RIB', note: '' });
    const v = SU.validate('grp', g, { grp: { rows: g }, sku: { saved: true, rows: [sku('A', '', '', 'm6')] } });
    expect(v.rows[3].some((w) => w.lv === 'red' && /ชื่อกลุ่มซ้ำ/.test(w.t))).toBe(true);
    expect(v.rows[8].some((w) => w.lv === 'warn' && /RIB/.test(w.t))).toBe(true);
    expect(v.rows[0]).toEqual([]);
    expect(v.rows[1]).toEqual([{ lv: 'info', t: 'ยังไม่มี SKU ในกลุ่มนี้' }]);
  });

  it('เดากลุ่มจากชื่อ', () => {
    expect(SU.guessGroup('ที่นอนสมมติ 6 ฟุต')).toBe('m6');
    expect(SU.guessGroup('ที่นอนสมมติ 3.5FT')).toBe('m35');
    expect(SU.guessGroup('ผ้าปูที่นอน 6FT')).toBe('bd');
    expect(SU.guessGroup('ท็อปเปอร์สมมติ 5FT')).toBe('tp');
    expect(SU.guessGroup('แถมหมอนสมมติ')).toBe('gf');
    expect(SU.guessGroup('อะไรสักอย่าง', 'FRE001')).toBe('gf');
    expect(SU.guessGroup('กล่อง')).toBe('');
  });
});

describe('เอกสารที่จะบันทึก', () => {
  const opt = (base, extra = {}) => ({ by: HEAD, name: 'หัวหน้าทดลอง', at: NOW, base, ...extra });

  it('ครั้งแรก: รุ่น 1 ประวัติบอกจำนวน · แถวว่างตัดทิ้ง', () => {
    const r = SU.docOf('loc', [loc('A-01-01'), loc(''), loc('R01-01-1', '1')], opt(0), null);
    expect(r.error).toBeUndefined();
    expect(r.data.n).toBe(2);
    expect(r.data.ver).toBe(1);
    expect(r.data.strict).toBe(0);
    expect(r.data.hist[0]).toMatchObject({ by: HEAD, name: 'หัวหน้าทดลอง', at: NOW });
    expect(r.data.hist[0].text).toMatch(/^ตั้งตารางครั้งแรก 2 แถว · เพิ่ม 2/);
    expect(C.dec(r.data.rows)).toEqual([['A-01-01', '', '1', ''], ['R01-01-1', '1', '1', '']]);
  });

  it('รุ่นไม่ตรง = มีคนบันทึกก่อน · แถวแดง · ไม่มีอะไรเปลี่ยน = ไม่บันทึก', () => {
    const cur = SU.docOf('loc', [loc('A-01-01')], opt(0), null).data;
    expect(SU.docOf('loc', [loc('A-01-02')], opt(0), cur).error).toMatch(/มีคนบันทึกตาราง Location ก่อนแล้ว \(หัวหน้าทดลอง\)/);
    expect(SU.docOf('loc', [loc('A-01-02'), loc('a-01-02')], opt(1), cur).error).toMatch(/แก้แถวสีแดง 2 แถว/);
    expect(SU.docOf('loc', [loc('A-01-01')], opt(1), cur).error).toBe('ไม่มีอะไรเปลี่ยน');
  });

  it('แก้ / ลบ / ตั้งห้าม เขียนลงประวัติ ใหม่สุดก่อน ไม่เกิน HIST_MAX', () => {
    let cur = SU.docOf('loc', [loc('A-01-01'), loc('A-01-02')], opt(0), null).data;
    cur = SU.docOf('loc', [loc('A-01-01', '3'), loc('A-01-03')], opt(1, { strict: true }), cur).data;
    expect(cur.ver).toBe(2);
    expect(cur.strict).toBe(1);
    expect(cur.hist[0].text).toBe('เพิ่ม 1 (A-01-03) · แก้ 1 (A-01-01) · ลบ 1 (A-01-02) · ตั้งให้ ห้ามบันทึกใบที่ไม่มีในตาราง');
    expect(cur.hist.length).toBe(2);
    for (let i = 0; i < SU.HIST_MAX + 5; i++) cur = SU.docOf('loc', [loc('A-01-01', String(i + 10))], opt(cur.ver), cur).data;
    expect(cur.hist.length).toBe(SU.HIST_MAX);
    expect(cur.hist[0].text).toMatch(/แก้ 1/);
  });

  it('กลุ่มที่ยังไม่บันทึกเทียบกับค่าเริ่ม', () => {
    const g = SU.defaults();
    g[0].note = 'แก้แล้ว';
    const r = SU.docOf('grp', g, opt(0), null);
    expect(r.data.hist[0].text).toBe('ตั้งตารางครั้งแรก 8 แถว · แก้ 1 (ที่นอน 6 ฟุต)');
  });
});

describe('บันทึกข้อมูลหลัก (store จำลอง)', () => {
  it('เฉพาะหัวหน้า · ต้องมียอดยกมาก่อน', async () => {
    const x = await setup();
    expect((await x.staff.setupSave('loc', [loc('A-01-01')], { base: 0 })).error).toMatch(/เฉพาะหัวหน้า/);
    expect((await x.head.setupSave('loc', [loc('A-01-01')], { base: 0 })).error).toMatch(/ลงยอดยกมาก่อน/);
    expect((await x.head.setupSave('xxx', [], { base: 0 })).error).toMatch(/ไม่รู้จักตาราง/);
  });

  it('หัวหน้าบันทึก → meta.mv +1 → อีกเครื่องดึงแล้วเห็นตาราง · คนที่สองใช้รุ่นเก่า = ไม่ทับ', async () => {
    const x = await opened();
    const mv0 = +(await x.store.connect().get('meta/head')).mv || 0;
    const r = ok(await x.head.setupSave('loc', [loc('A-01-01'), loc('R01-01-1', '1')], { base: 0, strict: true }));
    expect(r).toMatchObject({ saved: 'loc', n: 2, ver: 1 });
    expect(+(await x.store.connect().get('meta/head')).mv).toBe(mv0 + 1);

    await x.staff.sync();
    const t = SU.read(x.staff.local());
    expect(t.loc).toMatchObject({ saved: true, strict: true, ver: 1, n: 2, name: 'หัวหน้าทดลอง' });
    expect(t.loc.rows.map((l) => l.code)).toEqual(['A-01-01', 'R01-01-1']);
    expect(t.sku.saved).toBe(false);
    expect(t.grp.rows.length).toBe(8);   // ค่าเริ่ม

    /* รองหัวหน้าเริ่มแก้จากรุ่น 0 (ก่อนหัวหน้าบันทึก) */
    const h2 = await x.device(HEAD2);
    expect((await h2.setupSave('loc', [loc('B-01-01')], { base: 0 })).error).toMatch(/มีคนบันทึกตาราง Location ก่อนแล้ว/);
    ok(await h2.setupSave('loc', [loc('A-01-01'), loc('R01-01-1', '1'), loc('B-01-01')], { base: 1, strict: true }));
    await x.head.sync();
    const t2 = SU.read(x.head.local());
    expect(t2.loc.ver).toBe(2);
    expect(t2.loc.hist.map((h) => h.name)).toEqual(['รองหัวหน้าทดลอง', 'หัวหน้าทดลอง']);
    /* ตารางหลักนำเข้าเดิม (conv sup cap) ยังดึงคู่กันได้ */
    expect(Object.keys(x.head.local().master).sort()).toEqual(['loc']);
  });

  it('พบในสมุดแต่ยังไม่มีในตาราง (ไม่นับใบที่ยกเลิก)', async () => {
    const x = await opened();
    await x.head.sync();
    const L = x.head.local();
    expect(SU.found('loc', [], L).map((o) => o.code)).toEqual(['A-01-01', 'A-03-01', 'QA', 'R01-01-1']);
    expect(SU.found('loc', [loc('a-01-01'), loc('QA')], L).map((o) => [o.code, o.qty])).toEqual([['A-03-01', 4], ['R01-01-1', 10]]);
    const fs2 = SU.found('sku', [sku('BBB002', '', '', '')], L);
    expect(fs2.map((o) => [o.sku, o.long, o.name, o.qty])).toEqual([
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 6 ฟุต', 30],
      ['CCC004', 'CCC0000000004', 'แถมหมอนสมมติ', 3],
    ]);
    expect(SU.found('grp', [], L)).toEqual([]);

    /* ย้ายไปโลใหม่ = พบ · หัวหน้ายกเลิกใบ = ไม่นับทั้งใบเดิมและใบกลับรายการ */
    const mv = ['AAA001', 'AAA0000000001', '8', 'P1', 'A-01-01', 'B-05-05', 2, 'เบิก', 'โอนย้าย', 'เปิด'];
    const r = ok(await x.staff.post('bk-move', { batch: 'm-1', date: '2026-11-22', base: 900, names: {}, copy: [mv] }));
    await x.head.sync();
    expect(SU.found('loc', [], x.head.local()).map((o) => o.code)).toContain('B-05-05');
    ok(await x.head.post('bk-void', { doc: r.doc, why: 'ลองยกเลิก' }));
    expect(SU.found('loc', [], x.head.local()).map((o) => o.code)).not.toContain('B-05-05');
  });
});

describe('ตอนลงใบ (ผลท้ายแถว)', () => {
  const line = (take, warn = []) => ({ st: 'ok', why: '', warn: warn.slice(), take });
  const planOf = (lines) => ({ lines, total: { ok: lines.length, bad: 0, warn: lines.filter((o) => o.warn.length).length } });
  const ixOf = (opt = {}) => {
    const t = {
      loc: { saved: !!opt.loc, strict: !!opt.strictLoc, rows: opt.loc || [] },
      sku: { saved: !!opt.sku, strict: !!opt.strictSku, rows: opt.sku || [] },
      grp: { saved: false, rows: SU.defaults() },
    };
    return SU.index(t);
  };
  const LOCS = [loc('A-01-01'), loc('R01-01-1', '1'), loc('R01-01-2', '1'), loc('A-09-09', '', false)];
  const SKUS = [sku('AAA001', 'AAA0000000001', 'ที่นอน', 'm6'), sku('BBB002', 'BBB0000000002', 'ท็อป', 'tp'), sku('DDD009', '', 'เลิกขาย', 'pl', false)];

  it('ยังไม่บันทึกตาราง = ไม่เปลี่ยนอะไร', () => {
    const p = planOf([line([{ sku: 'AAA001', long: 'AAA0000000001', from: 'A-01-01', to: 'ZZ-1' }])]);
    const before = JSON.stringify(p);
    expect(JSON.stringify(SU.check(p, 'move', ixOf()))).toBe(before);
  });

  it('ไม่มีในตาราง / ปิดใช้ = เตือน · ตั้งห้าม = แถวผิด บันทึกไม่ได้', () => {
    const take = [{ sku: 'DDD009', long: '', from: 'A-09-09', to: 'B-07-07' }];
    const p = SU.check(planOf([line(take)]), 'move', ixOf({ loc: LOCS, sku: SKUS }));
    expect(p.lines[0].st).toBe('ok');
    expect(p.lines[0].warn).toEqual(['โล A-09-09 ปิดใช้ในข้อมูลหลัก', 'ไม่มีโล B-07-07 ในข้อมูลหลัก', 'SKU DDD009 ปิดใช้ในข้อมูลหลัก']);
    expect(p.total).toMatchObject({ ok: 1, bad: 0, warn: 1 });

    const q = SU.check(planOf([line(take)]), 'move', ixOf({ loc: LOCS, sku: SKUS, strictLoc: true }));
    expect(q.lines[0].st).toBe('bad');
    expect(q.lines[0].why).toBe('โล A-09-09 ปิดใช้ในข้อมูลหลัก · ไม่มีโล B-07-07 ในข้อมูลหลัก (หัวหน้าตั้งให้ต้องมีในข้อมูลหลัก)');
    expect(q.lines[0].warn).toEqual(['SKU DDD009 ปิดใช้ในข้อมูลหลัก']);
    expect(q.total).toMatchObject({ ok: 0, bad: 1, warn: 1 });
  });

  it('มีตารางแล้ว: ข้อความ "ไม่เคยมีในสมุด" ของเดิมหายเมื่อโล / SKU อยู่ในตาราง', () => {
    const p = planOf([line([{ sku: 'BBB002', long: 'BBB0000000002', from: '', to: 'A-01-01' }], ['โล A-01-01 ไม่เคยมีในสมุด เช็คว่าพิมพ์ถูก', 'SKU ใหม่ ยังไม่เคยมีในสมุด'])]);
    SU.check(p, 'gr', ixOf({ loc: LOCS, sku: SKUS }));
    expect(p.lines[0].warn).toEqual([]);
    expect(p.total.warn).toBe(0);
  });

  it('กติกากลุ่มตอนลงแร็ค R = เตือนเสมอ (ไม่ห้าม) · ปรับยอด / แปลง ไม่เตือน', () => {
    const ix = ixOf({ loc: LOCS, sku: SKUS, strictLoc: true, strictSku: true });
    const p = SU.check(planOf([
      line([{ sku: 'AAA001', long: 'AAA0000000001', from: 'A-01-01', to: 'R01-01-2' }]),
      line([{ sku: 'BBB002', long: 'BBB0000000002', from: 'A-01-01', to: 'R01-01-1' }]),
      line([{ sku: 'AAA001', long: 'AAA0000000001', from: 'A-01-01', to: 'R01-01-1' }]),
    ]), 'move', ix);
    expect(p.lines.map((o) => o.st)).toEqual(['ok', 'ok', 'ok']);
    expect(p.lines[0].warn).toEqual(['ปกติ ที่นอน 6 ฟุต ลง R ชั้น 1']);
    expect(p.lines[1].warn).toEqual(['R ชั้น 1 ไม่ใช่ที่ของ ท็อปเปอร์']);
    expect(p.lines[2].warn).toEqual([]);
    const a = SU.check(planOf([line([{ sku: 'AAA001', long: 'AAA0000000001', from: '', to: 'R01-01-2' }])]), 'adj', ix);
    expect(a.lines[0].warn).toEqual([]);
    const c = SU.check(planOf([line([{ sku: 'BBB002', long: 'BBB0000000002', from: '', to: 'R01-01-1', type: 'รับ' }])]), 'conv', ix);
    expect(c.lines[0].warn).toEqual([]);
  });

  it('ใช้กับแผนจริงของ WmsBook (ย้าย · รับของ) ได้', async () => {
    const x = await opened();
    await x.head.sync();
    const st = B.stock(x.head.fifo());
    const ix = ixOf({ loc: LOCS, sku: SKUS });
    const mv = SU.check(B.trApply(B.planMoves([{ sku: 'AAA001', from: 'A-01-01', to: 'R01-01-2', qty: '2' }], st), 'move', {}), 'move', ix);
    expect(mv.lines[0].st).toBe('ok');
    expect(mv.lines[0].warn).toContain('ปกติ ที่นอน 6 ฟุต ลง R ชั้น 1');
    const gr = SU.check(B.trApply(B.planGr([{ sku: 'BBB002', lot: '11', po: 'P9', to: 'A-01-01', qty: '5' }], st, { date: '2026-11-22' }), 'gr', {}), 'gr', ix);
    expect(gr.lines[0].st).toBe('ok');
    expect(gr.lines[0].warn.filter((w) => /ข้อมูลหลัก|ไม่เคยมีในสมุด/.test(w))).toEqual([]);
    const bad = SU.check(B.trApply(B.planGr([{ sku: 'BBB002', lot: '11', po: 'P9', to: 'X-1', qty: '5' }], st, { date: '2026-11-22' }), 'gr', {}), 'gr',
      ixOf({ loc: LOCS, sku: SKUS, strictLoc: true }));
    expect(bad.lines[0].st).toBe('bad');
    expect(bad.total.bad).toBe(1);
  });
});

describe('ขั้น ข: แปลงสินค้า · Supplier (PO) · SKU : Pallet', () => {
  const opt = (base, extra = {}) => ({ by: HEAD, name: 'หัวหน้าทดลอง', at: NOW, base, ...extra });
  const conv = (after, buy) => ({ after, buy });
  const sup = (po, s) => ({ po, sup: s });
  const cap = (s, pid, n) => ({ sku: s, pid, cap: n });

  it('แถว ↔ วัตถุ: รูปเดียวกับไฟล์นำเข้า · รหัสตัดช่องว่าง ตัวใหญ่', () => {
    expect(SU.rowOut('conv', SU.rowIn('conv', ['BBB0000000002', 'BBB0000000001']))).toEqual(['BBB0000000002', 'BBB0000000001']);
    expect(SU.rowOut('sup', SU.rowIn('sup', [' p 1 ', ' ผู้ผลิตสมมติ ก ']))).toEqual(['P1', 'ผู้ผลิตสมมติ ก']);
    expect(SU.rowOut('cap', SU.rowIn('cap', ['aaa001', 'AAA0000000001', 10]))).toEqual(['AAA001', 'AAA0000000001', '10']);
    expect(SU.isBlank('sup', sup('', ''))).toBe(true);
    expect(SU.isBlank('cap', cap('', '', '3'))).toBe(false);
  });

  it('ตรวจ แปลงสินค้า: ไม่ครบ / SKU เดียวกัน / คู่ซ้ำ = แดง · ไม่มีในตาราง SKU = ข้อมูล · แถวว่างไม่เตือน', () => {
    const t = { sku: { rows: [sku('AAA001', 'AAA0000000001', '', 'm6'), sku('BBB001', '', '', 'tp')] } };
    const v = SU.validate('conv', [conv('AAA0000000001', 'BBB001'), conv('aaa0000000001', 'bbb001'), conv('CCC1', ''), conv('DDD1', 'DDD1'), conv('', '')], t);
    expect(v.rows[0]).toEqual([{ lv: 'red', t: 'คู่นี้ซ้ำกับแถวอื่น' }]);
    expect(v.rows[2]).toEqual([{ lv: 'red', t: 'ใส่ทั้ง SKU หลังแปลง และ SKU ตอนซื้อ' }]);
    expect(v.rows[3].map((w) => w.lv)).toEqual(['red', 'info', 'info']);
    expect(v.rows[4]).toEqual([]);
    expect([v.bad, v.warn]).toEqual([4, 0]);
  });

  it('ตรวจ Supplier: PO ซ้ำ / ไม่มี PO = แดง · ไม่ใส่ Supplier = ส้ม (ไม่บันทึก) · ชื่อเขียนต่างกัน = ข้อมูล', () => {
    const v = SU.validate('sup', [sup('P1', 'ผู้ผลิตสมมติ ก'), sup('p1', 'อื่น'), sup('P2', ''), sup('', 'ผู้ผลิตสมมติ ข'), sup('P3', 'ผู้ผลิตสมมติก')]);
    expect(v.rows[0].map((w) => w.lv)).toEqual(['red', 'info']);
    expect(v.rows[1][0].t).toBe('PO ซ้ำกับแถวอื่น');
    expect(v.rows[2]).toEqual([{ lv: 'warn', t: 'ยังไม่ใส่ Supplier (ไม่บันทึกแถวนี้)' }]);
    expect(v.rows[3]).toEqual([{ lv: 'red', t: 'ยังไม่ใส่ PO' }]);
    expect(v.rows[4]).toEqual([{ lv: 'info', t: 'Supplier เขียนต่างกัน: ผู้ผลิตสมมติ ก' }]);
  });

  it('ตรวจ ความจุ: ไม่มีรหัส / ซ้ำ / ไม่ใช่ตัวเลข = แดง · ว่าง = ส้ม (ไม่บันทึก)', () => {
    const v = SU.validate('cap', [cap('AAA001', 'AAA0000000001', '10'), cap('BBB002', '', ''), cap('CCC004', '', 'สิบ'), cap('', '', '5'), cap('DDD009', '', '1,200'), cap('aaa001', 'aaa0000000001', '12')]);
    expect(v.rows[0][0]).toEqual({ lv: 'red', t: 'SKU นี้ซ้ำกับแถวอื่น' });
    expect(v.rows[1]).toEqual([{ lv: 'warn', t: 'ยังไม่ใส่ชิ้นต่อพาเลท (ไม่บันทึกแถวนี้)' }]);
    expect(v.rows[2]).toEqual([{ lv: 'red', t: 'ชิ้นต่อพาเลทต้องเป็นตัวเลข' }]);
    expect(v.rows[3]).toEqual([{ lv: 'red', t: 'ใส่ SKU หรือ Product ID' }]);
    expect(v.rows[4]).toEqual([]);
  });

  it('เอกสาร: รูปเดิมของ masterDoc + รุ่น ประวัติ · ไม่มีสวิตช์ห้าม · Supplier / ความจุว่าง ไม่บันทึก', () => {
    const c = SU.docOf('conv', [conv('BBB0000000002', 'BBB0000000001'), conv('', '')], opt(0, { strict: true }), null);
    expect(c.data).toMatchObject({ tab: 'MASTER แปลงสินค้า', cols: ['SKU ตอนซื้อ', 'SKU หลังแปลง'], blank: 0, n: 1, ver: 1 });
    expect(c.data.strict).toBeUndefined();
    expect(C.dec(c.data.rows)).toEqual([['BBB0000000002', 'BBB0000000001']]);
    expect(c.data.hist[0].text).toBe('ตั้งตารางครั้งแรก 1 แถว · เพิ่ม 1 (BBB0000000002 ← BBB0000000001)');
    expect(SU.docOf('conv', [conv('BBB1', '')], opt(0), null).error).toMatch(/^แก้แถวสีแดง 1 แถวก่อน เช่น BBB1: ใส่ทั้ง/);

    const s2 = SU.docOf('sup', [sup('P1', 'ผู้ผลิตสมมติ ก'), sup('P2', '')], opt(0), null);
    expect(s2.data).toMatchObject({ tab: 'PO. Truck', dup: [], n: 1 });
    expect(s2.data.cols).toBeUndefined();
    expect(s2.data.hist[0].text).toBe('ตั้งตารางครั้งแรก 1 แถว · เพิ่ม 1 (P1) · ข้าม 1 แถวที่ยังไม่ครบ');
    expect(SU.docOf('sup', [sup('P1', 'ผู้ผลิตสมมติ ก'), sup('P2', '')], opt(1), s2.data).error).toBe('ไม่มีอะไรเปลี่ยน (ข้าม 1 แถวที่ยังไม่ครบ)');

    /* ตารางที่นำเข้าไฟล์ไว้แบบเดิม (ไม่มีรุ่น) แก้ต่อได้ เก็บชื่อชีต / หัวคอลัมน์เดิม */
    const old = { tab: 'ความจุ (ไฟล์สมมติ)', cols: ['SKU', 'Product ID', 'STD / pallet'], rows: C.enc([['AAA001', 'AAA0000000001', 10]]), blank: 2, n: 1 };
    const k = SU.docOf('cap', [cap('AAA001', 'AAA0000000001', '1,200'), cap('BBB002', '', '')], opt(0), old);
    expect(k.data).toMatchObject({ tab: 'ความจุ (ไฟล์สมมติ)', cols: ['SKU', 'Product ID', 'STD / pallet'], blank: 0, n: 1, ver: 1 });
    expect(C.dec(k.data.rows)).toEqual([['AAA001', 'AAA0000000001', '1200']]);
    expect(k.data.hist[0].text).toBe('แก้ 1 (AAA001) · ข้าม 1 แถวที่ยังไม่ครบ');
  });

  it('ไฟล์ที่อ่านแล้ว → แถวของตาราง', () => {
    const p = TR.readSheets([
      { name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตสมมติ', 'p 9']] },
      { name: 'MASTER แปลงสินค้า', grid: [['SKU ตอนซื้อ', 'SKU หลังแปลง'], ['BBB0000000001', 'BBB0000000002']] },
      { name: 'ความจุต่อพาเลท', grid: [['SKU', 'Product ID', 'STD / pallet'], ['AAA001', 'AAA0000000001', 10]] },
    ]);
    expect(SU.fromParsed('sup', p.sup)).toEqual([sup('P9', 'ผู้ผลิตสมมติ')]);
    expect(SU.fromParsed('conv', p.conv)).toEqual([conv('BBB0000000002', 'BBB0000000001')]);
    expect(SU.fromParsed('cap', p.cap)).toEqual([cap('AAA001', 'AAA0000000001', '10')]);
    expect(SU.fromParsed('sup', null)).toEqual([]);
  });

  it('บันทึกผ่านหน้า ข้อมูลหลัก → fifo() / masters() อ่านได้เหมือนนำเข้าไฟล์ · นำเข้าไฟล์ทับ = รุ่นใหม่ เก็บประวัติ', async () => {
    const x = await opened();
    ok(await x.head.setupSave('sup', [sup('P1', 'ผู้ผลิตสมมติ ก'), sup('P5', 'ผู้ผลิตสมมติ ข'), sup('P7', '')], { base: 0 }));
    ok(await x.head.setupSave('conv', [conv('BBB0000000002', 'BBB0000000001')], { base: 0 }));
    ok(await x.head.setupSave('cap', [cap('AAA001', 'AAA0000000001', '10')], { base: 0 }));
    expect((await x.staff.setupSave('cap', [cap('AAA001', '', '9')], { base: 1 })).error).toMatch(/เฉพาะหัวหน้า/);
    await x.staff.sync();
    const f = x.staff.fifo();
    expect(f.sup.rows).toEqual([['P1', 'ผู้ผลิตสมมติ ก'], ['P5', 'ผู้ผลิตสมมติ ข']]);
    expect(f.convert.pairs).toEqual([['BBB0000000002', 'BBB0000000001', '']]);
    expect(f.cap.rows).toEqual([['AAA001', 'AAA0000000001', 10]]);
    expect(x.staff.masters()).toMatchObject({ sup: { n: 2, tab: 'PO. Truck', dup: 0 }, conv: { n: 1, blank: 0 }, cap: { n: 1, tab: 'ความจุต่อพาเลท' } });
    expect(SU.read(x.staff.local()).sup).toMatchObject({ saved: true, ver: 1, n: 2 });

    /* หน้า TRcloud แบบเดิม (masterSave) ทับทั้งตาราง: รุ่น +1 ประวัติต่อจากเดิม · ร่างที่เริ่มจากรุ่นเก่าบันทึกไม่ผ่าน */
    ok(await x.head.masterSave('sup', TR.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], ['ผู้ผลิตสมมติ ค', 'P8']] }]).sup));
    await x.head.sync();
    const t = SU.read(x.head.local()).sup;
    expect(t.ver).toBe(2);
    expect(t.hist.map((h) => h.text)).toEqual(['นำเข้าไฟล์ PO. Truck 1 แถว (แทนทั้งตาราง)', 'ตั้งตารางครั้งแรก 2 แถว · เพิ่ม 2 (P1, P5) · ข้าม 1 แถวที่ยังไม่ครบ']);
    expect((await x.head.setupSave('sup', [sup('P1', 'ผู้ผลิตสมมติ ก')], { base: 1 })).error).toMatch(/มีคนบันทึกตาราง Supplier \(PO\) ก่อนแล้ว/);
    ok(await x.head.setupSave('sup', [sup('P8', 'ผู้ผลิตสมมติ ค'), sup('P1', 'ผู้ผลิตสมมติ ก')], { base: 2 }));
  });

  it('พบในสมุด: PO ที่ยังไม่มี Supplier · SKU ที่ยังไม่มีความจุ (ตาราง SKU ก่อน ไม่มี = SKU ที่มีของ)', async () => {
    const x = await opened();
    await x.head.sync();
    const L = x.head.local();
    expect(SU.found('sup', [], L)).toEqual([{ po: 'P1', qty: 30 }, { po: 'P5', qty: 4 }]);
    expect(SU.found('sup', [sup('p1', '')], L).map((o) => o.po)).toEqual(['P5']);
    expect(SU.found('cap', [], L).map((o) => [o.sku, o.pid, o.name, o.qty])).toEqual([
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 6 ฟุต', 30],
      ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ 5FT', 4],
      ['CCC004', 'CCC0000000004', 'แถมหมอนสมมติ', 3],
    ]);
    const skus = [sku('AAA001', 'AAA0000000001', 'ก', 'm6'), sku('DDD009', '', 'ง', 'pl'), sku('EEE001', '', 'เลิกขาย', 'pl', false)];
    expect(SU.found('cap', [cap('AAA001', '', '10')], L, skus)).toEqual([{ sku: 'DDD009', pid: '', name: 'ง', qty: 0 }]);
    expect(SU.found('conv', [], L)).toEqual([]);
    expect(SU.stockOf(L).po).toEqual({ P1: 30, P5: 4 });
  });
});

describe('ขั้น ค: โซนแร็ค + ระบบเลือกแร็ค', () => {
  const zr = (r1, r2, l1, l2, grp, note = '') => ({ r1, r2, l1, l2, grp, note });
  const RLOCS = [];
  [[1, 3], [2, 2]].forEach(([r, bays]) => {
    for (let b = 1; b <= bays; b++) for (let l = 1; l <= 2; l++) RLOCS.push(loc(`R0${r}-0${b}-${l}`, '1'));
  });
  const tables = (zone = [zr('R02', '', '1', '1', 'm6')]) => ({
    loc: { rows: RLOCS.concat([loc('R03-01-1', '1', false), loc('A-01-01', '4'), loc('A-01-02', '4'), loc('D-01-01')]) },
    sku: { rows: [sku('AAA001', 'AAA0000000001', 'ที่นอน', 'm6'), sku('BBB002', '', 'ท็อป', 'tp'), sku('CCC004', '', 'แถม', 'gf'),
      sku('EEE005', '', 'ที่นอน 3.5', 'm35'), sku('FFF006', '', 'โซฟา', 'sb'), sku('GGG007', '', 'ไม่มีกลุ่ม', '')] },
    grp: { rows: SU.defaults() },
    cap: { rows: [{ sku: 'AAA001', pid: 'AAA0000000001', cap: '10' }, { sku: 'BBB002', pid: '', cap: '20' }, { sku: 'FFF006', pid: '', cap: '1' }] },
    zone: { rows: zone },
  });
  const OCC = {
    'R01-01-1': { q: 10, piles: [{ sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: 'P1', q: 10 }] },
    'A-01-01': { q: 2, piles: [{ sku: 'FFF006', long: '', lot: '3', po: 'P9', q: 2 }] },
  };
  const go = (row, zone, opt) => SU.pick(SU.picker(tables(zone), OCC, opt), row);
  const where = (r) => r.lines.map((l) => [l.loc, l.qty, l.tag]);
  const said = (w) => w.map((x) => x.lv + ' ' + x.t).join(' | ');

  it('ช่วงแร็ค: แร็คถึงว่าง = แร็คเดียว · ชั้นว่าง = ทุกชั้น · อ่านไม่ออกไม่เดา', () => {
    expect(SU.rowOut('zone', SU.rowIn('zone', ['r1', '3', '', '', 'm6', 'x']))).toEqual(['R01', 'R03', '', '', 'm6', 'x']);
    expect(SU.zoneLabel(zr('R1', '3', '', '', 'm6'))).toBe('R01–R03 · ทุกชั้น');
    expect(SU.zoneLabel(zr('R08', '', '2', '', 'tp'))).toBe('R08 · ชั้น 2');
    expect(SU.span(zr('R01', '', '', '3', 'tp'))).toMatchObject({ r1: 1, r2: 1, l1: 3, l2: 3, ok: true });
    [zr('R01-R03', '', '', '', 'm6'), zr('R01', 'ท้ายแถว', '', '', 'm6'), zr('R01', '', '2-3', '', 'tp'), zr('R01', '', '0', '', 'tp')]
      .forEach((z) => expect(SU.span(z).ok, JSON.stringify(z)).toBe(false));
    expect(SU.rackText('R01-R03')).toBe('R01-R03');
  });

  it('ตรวจโซน: ช่วงผิด / กลุ่มไม่ขึ้นแร็ค = แดง · ผิดชั้น / ทับแถวบน = ส้ม', () => {
    const list = [zr('R01', 'R03', '1', '1', 'm6'), zr('R02', 'R04', '1', '2', 'm5'), zr('R05', '', '2', '3', 'sb'), zr('', 'R06', '2', '3', 'm35'),
      zr('R09', 'R07', '2', '3', 'm35'), zr('R10', '', '1', '1', 'm35'), zr('R11', 'R12', '', '', 'tp'), zr('R13', '', '', '', ''),
      zr('', '', '', '', ''), zr('R14', '', '2', '3', 'xx'), zr('R15', 'ท้ายแถว', '', '', 'tp'), zr('R16', '', '2-3', '', 'tp')];
    const v = SU.validate('zone', list, { grp: { rows: SU.defaults() }, loc: { rows: RLOCS } });
    const w = v.rows.map(said);
    expect(w[0]).toContain('info ทับกับ R02–R04');
    expect(w[1]).toContain('warn ทับกับ R01–R03');
    expect(w[1]).toContain('info ใช้แค่ชั้น 1');
    expect(w[2]).toContain('red Sofa Bed ไม่ขึ้นแร็ค');
    expect(w[3]).toContain('red ใส่แร็คจาก');
    expect(w[4]).toContain('red แร็คจาก มากกว่า แร็คถึง');
    expect(w[5]).toContain('warn ที่นอน 3.5 ฟุต ลงชั้น 1 ไม่ได้');
    expect(w[6]).toBe('info ยังไม่มี Location แร็คในช่วงนี้');
    expect(w[7]).toContain('red เลือกกลุ่ม');
    expect(w[8]).toBe('');
    expect(w[9]).toContain('warn ไม่มีกลุ่มนี้แล้ว');
    expect(w[10]).toContain('red แร็คถึง ใส่แบบ R03');
    expect(w[11]).toContain('red ชั้น ใส่เป็นตัวเลข');
    expect([v.bad, v.warn]).toEqual([6, 3]);
    const dup = SU.validate('zone', [zr('R01', 'R02', '1', '1', 'm6'), zr('r1', '2', '1', '', 'm5')]);
    expect(dup.bad).toBe(2);
  });

  it('โซนทุกชั้น กินเฉพาะชั้นที่กลุ่มใส่ได้: สองกลุ่มคนละชั้นในแร็คเดียวกันไม่ทับกัน', () => {
    const z = [zr('R02', '', '', '', 'm6'), zr('R02', '', '2', '', 'tp')];
    expect(said(SU.validate('zone', z, { grp: { rows: SU.defaults() } }).rows[1])).not.toContain('ทับ');
    const P = SU.picker(tables(z), {});
    expect(SU.zoneAt(P.zx, 2, 1).g.id).toBe('m6');
    expect(SU.zoneAt(P.zx, 2, 2).g.id).toBe('tp');
    expect(SU.zoneAt(P.zx, 1, 1)).toBe(null);
  });

  it('เอกสาร: แถวว่างตัดทิ้ง · คงลำดับแถว · สลับแถว = เปลี่ยน · แถวแดงไม่บันทึก', () => {
    const rows = [zr('R05', '', '', '', 'tp', 'ท็อป'), zr('', '', '', '', ''), zr('r1', '3', '1', '1', 'm6')];
    const d = SU.docOf('zone', rows, { by: HEAD, at: NOW, base: 0 }, null).data;
    expect(d).toMatchObject({ tab: 'โซนแร็ค', n: 2, strict: 0, ver: 1 });
    expect(C.dec(d.rows)).toEqual([['R05', '', '', '', 'tp', 'ท็อป'], ['R01', 'R03', '1', '1', 'm6', '']]);
    expect(SU.docOf('zone', [rows[0], rows[2]], { at: NOW, base: 1 }, d).error).toMatch(/ไม่มีอะไรเปลี่ยน/);
    expect(SU.docOf('zone', [rows[2], rows[0]], { at: NOW, base: 1 }, d).data.hist[0].text).toContain('เรียงลำดับใหม่');
    expect(SU.docOf('zone', [zr('', 'R02', '1', '1', 'm6')], { base: 0 }, null).error).toMatch(/แก้แถวสีแดง 1 แถว/);
    expect(SU.found('zone', [], { piles: {}, docs: [] })).toEqual([]);
  });

  it('ลำดับช่อง: โซนตัวเอง → ไม่ระบุกลุ่ม · เศษลงช่องของตัวเอง', () => {
    const r = go({ sku: 'AAA001', qty: '25' });
    expect([r.pcs, r.full, r.rem]).toEqual([10, 2, 5]);
    expect(where(r)).toEqual([['R02-01-1', 10, 1], ['R02-02-1', 10, 2], ['R01-02-1', 5, 3]]);
    expect(r.lines[0].why).toBe('โซน ที่นอน 6 ฟุต · ชั้น 1');
    expect(r.lines[2].why).toContain('ช่องไม่ระบุกลุ่ม');
  });

  it('ชั้น 2 ขึ้นไป เศษไป RIB · ไม่ขึ้นแร็คไปพื้นของกลุ่ม', () => {
    expect(where(go({ sku: 'BBB002', qty: '50' }))).toEqual([['R01-01-2', 20, 1], ['R01-02-2', 20, 2], ['RIB', 10, 'rib']]);
    expect(where(go({ sku: 'CCC004', qty: '3' }))).toEqual([['D-01-01', 3, 'flo']]);
  });

  it('ล้นไปโซนอื่นเมื่อจำเป็น · ปิดล้น = เหลือให้เลือกเอง · โล R ปิดใช้ / มีของ ไม่เลือก', () => {
    const z = [zr('R02', '', '1', '1', 'm6'), zr('R01', '', '1', '1', 'm5')];
    const r = go({ sku: 'AAA001', qty: '50' }, z);
    expect(where(r)).toEqual([['R02-01-1', 10, 1], ['R02-02-1', 10, 2], ['R01-02-1', 10, 3], ['R01-03-1', 10, 4], ['', 10, 'man']]);
    expect(r.lines[2].why).toContain('ล้นไปโซน ที่นอน 5 ฟุต');
    expect(where(go({ sku: 'AAA001', qty: '40' }, z, { over: false }))).toEqual([['R02-01-1', 10, 1], ['R02-02-1', 10, 2], ['', 20, 'man']]);
  });

  it('พื้น: รวมเฉพาะ LOT / PO เดียวกัน · ไม่เกินจุ', () => {
    const row = { sku: 'FFF006', lot: '3', po: 'P9' };
    expect(where(go({ ...row, qty: '1' }))).toEqual([['A-01-01', 1, 'flo']]);
    expect(where(go({ ...row, qty: '1', lot: '4' }))).toEqual([['A-01-02', 1, 'flo']]);
    expect(where(go({ ...row, qty: '9' }))).toEqual([['A-01-01', 2, 'flo'], ['A-01-02', 4, 'flo'], ['', 3, 'man']]);
  });

  it('ข้อมูลไม่พอ = บอกว่าขาดอะไร ไม่เดา', () => {
    expect(go({ sku: 'ZZZ', qty: '1' }).err).toBe('ไม่มี SKU ZZZ ในข้อมูลหลัก');
    expect(go({ sku: 'GGG007', qty: '1' }).err).toContain('ยังไม่มีกลุ่มสินค้า');
    expect(go({ sku: 'EEE005', qty: '1' }).err).toContain('ยังไม่ใส่ชิ้นต่อพาเลทของ EEE005');
    expect(go({ sku: 'AAA001', qty: '0' }).err).toBe('ใส่จำนวนชิ้น');
    expect(SU.pick(SU.picker({}, {}), { sku: 'AAA001', qty: '1' }).err).toContain('ยังไม่ได้ตั้งตาราง Location');
  });

  it('แท็บรับของ: แตกแถวต่อพาเลท · โลที่ใส่เองไม่เปลี่ยนและไม่ถูกเลือกซ้ำ', () => {
    const rows = [{ sku: 'BBB002', lot: '5', po: 'P7', qty: '40', tr: 'GR-1' }, { sku: 'BBB002', qty: '20', to: 'r01-01-2' }, { sku: 'ZZZ', qty: '5' }, { to: 'R01-03-2' }, {}];
    const before = JSON.stringify(rows);
    const r = SU.pickRows(SU.picker(tables(), OCC), rows);
    expect(r.rows.slice(0, 2)).toEqual([
      { sku: 'BBB002', lot: '5', po: 'P7', qty: '20', tr: 'GR-1', to: 'R01-02-2' },
      { sku: 'BBB002', lot: '5', po: 'P7', qty: '20', tr: 'GR-1', to: 'R02-01-2' },
    ]);
    expect(r.rows.slice(2)).toEqual(rows.slice(1));
    expect([r.done, r.lines, r.man, r.err.length, r.err[0].i]).toEqual([1, 2, 0, 1, 2]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('รับของเข้า R: ช่องมีของแล้ว / ซ้ำในใบ = เตือน', () => {
    const one = (n, to) => ({ n, st: 'ok', why: '', warn: [], take: [{ sku: 'AAA001', long: 'AAA0000000001', from: '', to }] });
    const t = tables();
    const ix = SU.index({ loc: { saved: true, rows: t.loc.rows }, sku: { saved: true, rows: t.sku.rows }, grp: t.grp });
    const p = SU.check({ lines: [one(1, 'R01-01-1'), one(2, 'R02-01-1'), one(3, 'R02-01-1'), one(4, 'R02-02-1')], total: { ok: 4, bad: 0, warn: 0 } }, 'gr', ix, OCC);
    expect(p.lines[0].warn.join()).toContain('มีของอยู่แล้ว (AAA001)');
    expect(p.lines[2].warn.join()).toContain('ซ้ำกับแถว 2');
    expect([p.lines[1].warn, p.lines[3].warn]).toEqual([[], []]);
    expect(p.total).toMatchObject({ warn: 2, bad: 0 });
    const m = SU.check({ lines: [one(1, 'R01-01-1')], total: { ok: 1, bad: 0, warn: 0 } }, 'move', ix, OCC);
    expect(m.lines[0].warn).toEqual([]);
  });

  it('บันทึกโซนจริง (store จำลอง) → เครื่องอื่นเห็น · เลือกช่องจากยอดในสมุด', async () => {
    const x = await opened();
    ok(await x.head.setupSave('loc', [loc('R01-01-1', '1'), loc('R01-02-1', '1'), loc('R02-01-1', '1')], { base: 0 }));
    ok(await x.head.setupSave('sku', [sku('AAA001', 'AAA0000000001', 'ที่นอนสมมติ 6 ฟุต', 'm6')], { base: 0 }));
    ok(await x.head.setupSave('cap', [{ sku: 'AAA001', pid: 'AAA0000000001', cap: '10' }], { base: 0 }));
    expect((await x.staff.setupSave('zone', [zr('R02', '', '', '', 'm6')], { base: 0 })).error).toMatch(/เฉพาะหัวหน้า/);
    ok(await x.head.setupSave('zone', [zr('R02', '', '', '', 'm6')], { base: 0 }));
    await x.staff.sync();
    const l = x.staff.local();
    expect(SU.read(l).zone).toMatchObject({ saved: true, ver: 1, n: 1 });
    expect(SU.occOf(l)['R01-01-1']).toMatchObject({ q: 10 });
    expect(where(SU.pick(SU.picker(SU.read(l), SU.occOf(l)), { sku: 'AAA001', qty: '20' }))).toEqual([['R02-01-1', 10, 1], ['R01-02-1', 10, 2]]);
  });

  it('สำเนาจากหน้ารุ่นเก่า (ยังไม่รู้จัก zone) = ดึงใหม่ครั้งเดียว แม้ mv เท่าเดิม', async () => {
    const x = await opened();
    ok(await x.head.setupSave('zone', [zr('R02', '', '', '', 'm6')], { base: 0 }));
    const cache = W.memCache();
    const open = async () => {
      const f = W.open({ store: x.store.connect(), auth: W.fakeAuth(ACCOUNTS), cache, now: () => NOW });
      ok(await f.login(STAFF));
      await f.sync();
      return f;
    };
    await open();
    const old = await cache.load();
    delete old.mk;
    delete old.master.zone;
    await cache.put(old);
    const f = await open();
    expect(f.local().master.zone).toBeTruthy();
    expect((await cache.load()).mk).toContain('zone');
    expect(read('wms-fire.js')).toContain("mk: local.mk || ''");   // IndexedDB ต้องเก็บด้วย ไม่งั้นดึงใหม่ทุกครั้งที่เปิดหน้า
  });

  it('ต่อสายในหน้า ข้อมูลหลัก และแท็บรับของ', () => {
    const bm = read('book/book-master.js');
    expect(bm).toContain("['zone', 'โซนแร็ค']");
    expect(bm).toContain("kind !== 'grp' && kind !== 'zone') rows = rows.slice().sort");
    expect(read('book/book-fire.js')).toContain('S.picker(t || su.t, B.setupOcc(), opt)');
    const bg = read('book/book-grid.js');
    expect(bg).toContain('id="gPick"');
    expect(bg).toContain('X.pickRows(P, body)');
    expect(bg).toContain('!ST ?');
  });
});

describe('ต่อสายในหน้า', () => {
  it('โหลด wms-fire-setup.js ก่อน wms-fire.js · หน้า ข้อมูลหลัก อยู่ในเมนูและแอป', () => {
    const bf = read('book/book-fire.js');
    expect(bf.indexOf("script('../wms-fire-setup.js')")).toBeGreaterThan(bf.indexOf("script('../wms-fire-core.js')"));
    expect(bf.indexOf("script('../wms-fire-setup.js')")).toBeLessThan(bf.indexOf("script('../wms-fire.js')"));
    const html = read('book/index.html');
    expect(html.indexOf('book-master.js')).toBeGreaterThan(html.indexOf('book-item.js'));
    expect(html).toMatch(/APP_PAGES = \{[^}]*master: 1/);
    expect(html).toMatch(/MODE === 'master'\) \{ if \(window\.BookMaster\) BookMaster\.paste\(text\)/);
    const app = read('book/book-app.js');
    expect(app).toMatch(/\{ k: 'master', t: 'ข้อมูลหลัก' \}/);
    expect(app).toMatch(/\n {4}master: '</);
    expect(read('book/book-grid.js')).toMatch(/WmsFireSetup\.check\(p, mode, su\.ix, /);
    expect(read('wms-fire.js')).toMatch(/var SETUP = \['loc', 'sku', 'grp', 'zone'\]/);
  });

  it('ขั้น ข: หน้า TRcloud ส่งตารางหลักไปตรวจที่ ข้อมูลหลัก · ลากไฟล์มาวางในหน้า ข้อมูลหลัก', () => {
    expect(read('wms-fire.js')).toContain('SETUP.indexOf(kind) < 0 && MASTERS.indexOf(kind) < 0');
    const trc = read('book/book-fire-trc.js');
    ['tiSup', 'tiConv', 'tiCap', 'saveMaster'].forEach((w) => expect(trc, w).not.toContain(w));
    expect(trc).toContain('id="tiMaster"');
    expect(trc).toContain("setMode('master');");
    expect(trc).toContain('window.BookMaster.take(part, files);');
    expect(read('book/index.html')).toContain("if (FIRE && MODE === 'master') { if (window.BookMaster) BookMaster.files([...e.dataTransfer.files]); return; }");
    const bm = read('book/book-master.js');
    expect(bm).toContain("['conv', 'แปลงสินค้า'], ['sup', 'Supplier'], ['cap', 'SKU : Pallet']");
    expect(bm).toContain('window.WmsFireTrc.readSheets(sheets)');
    expect(read('book/book-fire.js')).toContain('window.WmsFireSetup.found(kind, list, l, skus)');
  });

  it('ไม่มีอักษรลาว', () => {
    ['wms-fire-setup.js', 'book/book-master.js', 'book/book-fire-trc.js', 'book/book-grid.js'].forEach((f) => expect(/[\u0E80-\u0EFF]/.test(read(f)), f).toBe(false));
  });
});
