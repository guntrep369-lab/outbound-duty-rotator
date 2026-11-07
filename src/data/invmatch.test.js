/**
 * จับคู่ Invoice: public/wms-invmatch.js
 *
 * ข้อมูลในเทสต์สมมติขึ้นทั้งหมด repo นี้เป็นสาธารณะ
 * เลขออเดอร์ 99000000xx · เลขออนไลน์ 9900000000000000xx · SKU AAA/BBB/CCC · เลขเอกสาร DOC-xxxx
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-invmatch.js'), 'utf8');

let M;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  M = win.WmsInvMatch;
});

const A = 'AAA0000000001', B = 'BBB0000000002', C = 'CCC0000000003';

/* หัวตารางชุดเดียวกับไฟล์ออเดอร์ × LOT/PO ที่มีเลขก่อนแยกบิล */
const SH = ['วันที่', 'ระบบ', 'เลขออเดอร์ก่อนที่จะแยกบิล', 'เลขออเดอร์', 'หมายเลขคำสั่งซื้อออนไลน์', 'บริษัทขนส่ง',
  'SKU', 'SKU ที่ขาย', 'ชื่อสินค้า', 'LOT', 'PO', 'จำนวน'];
function stockRows(list) {
  return [SH].concat(list.map((x) => [x.d || '01/10/2026', x.sys || 'ระบบ ก', x.pre || '', x.o, x.on || '', x.c || '',
    x.sku || A, x.sold || '', x.name || 'สินค้า ก', x.lot || 'L1', x.po || 'PO-1', x.q]));
}
/* หัวตารางฝั่งบัญชี มีช่องที่หัวขึ้นบรรทัดใหม่เหมือนไฟล์จริง */
const AH = ['ออเดอร์ภายใน', 'ออเดอร์\nก่อนแยกบิล', 'คำสั่งซื้อออนไลน์', 'เลขที่เอกสาร', 'วันที่เอกสาร', 'วันที่ครบกำหนด',
  'เลขที่อ้างอิง', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน'];
function accRows(list) {
  return [AH].concat(list.map((x) => [x.o || '', x.pre || '', x.on || '', x.doc, x.d || '2026-10-01', '', '',
    x.code || A, x.name || 'สินค้า ก', x.q]));
}
const load = (rows) => M.read(rows, M.detect(rows));
const run = (s, a) => M.match(load(stockRows(s)), load(accRows(a)));
const byOrder = (res, o) => res.orders.find((x) => x.order === o);

describe('อ่านไฟล์', () => {
  it('ดูจากหัวตารางว่าเป็นฝั่งไหน ไม่สนช่องว่าง ขึ้นบรรทัด หรือตัวพิมพ์', () => {
    expect(M.detect(stockRows([])).kind).toBe('stock');
    const acc = M.detect(accRows([]));
    expect(acc.kind).toBe('acc');
    expect(acc.cols.pre).toBe(1);   // 'ออเดอร์\nก่อนแยกบิล'
    const loose = M.detect([['เลข ออเดอร์', 'sku', ' จำนวน ', 'lot', 'po']]);
    expect(loose.kind).toBe('stock');
  });

  it('หัวตารางไม่อยู่แถวแรกก็หาเจอ', () => {
    const rows = [['รายงานขาย'], [], ...stockRows([{ o: '9900000001', q: 1 }])];
    const det = M.detect(rows);
    expect(det).toMatchObject({ kind: 'stock', head: 2 });
    expect(M.read(rows, det).lines[0]).toMatchObject({ row: 4, order: '9900000001' });
  });

  it('ไฟล์ที่หน้านี้ส่งออกเอง (มีทั้ง LOT/PO และเลขที่เอกสาร) นับเป็นฝั่งคลัง', () => {
    expect(M.detect([M.LINE_HEAD]).kind).toBe('stock');
  });

  it('หัวตารางไม่ครบ บอกชื่อช่องที่ขาด', () => {
    expect(M.detect([['เลขที่เอกสาร', 'รหัสสินค้า', 'จำนวน']])).toEqual({ kind: '', missing: ['ออเดอร์ภายใน หรือ คำสั่งซื้อออนไลน์'] });
    expect(M.detect([['เลขออเดอร์', 'LOT', 'PO']])).toEqual({ kind: '', missing: ['SKU', 'จำนวน'] });
    expect(M.detect([['ชื่อ', 'อายุ']])).toEqual({ kind: '', missing: [] });
  });

  it('วันที่ทั้งแบบ วัน/เดือน/ปี ปี-เดือน-วัน เลขวันที่ของ Excel และ พ.ศ.', () => {
    expect(M.ymd('03/11/2026')).toBe('2026-11-03');
    expect(M.ymd('3/1/26')).toBe('2026-01-03');
    expect(M.ymd('2026-10-31')).toBe('2026-10-31');
    expect(M.ymd('2026-10-31 14:20:00')).toBe('2026-10-31');
    expect(M.ymd('03/11/2569')).toBe('2026-11-03');
    expect(M.ymd(46329)).toBe('2026-11-03');
    expect(M.ymd(new Date(2026, 10, 3))).toBe('2026-11-03');
    expect(M.ymd('ไม่ใช่วันที่')).toBe('');
    expect(M.ymd('31/13/2026')).toBe('');
    expect(M.dmy('2026-11-03')).toBe('03/11/2026');
  });

  it('ข้ามแถวว่าง นับจำนวนที่ไม่ใช่ตัวเลข แถวที่ไม่มีเลขให้จับคู่ และเลขยาวที่เสียหลักไปแล้ว', () => {
    const rows = stockRows([
      { o: '9900000001', q: 2 },
      { o: '9900000002', q: 'สอง' },
      { o: '', on: '', q: 1 },
      { o: '9900000003', on: '5.8E+17', q: 1 },
      { o: '9900000004', on: 990000000000000000000, q: 1 },
    ]);
    rows.push(['', '', '', '', '', '', '', '', '', '', '', '']);
    const src = load(rows);
    expect(src.lines.map((l) => l.order)).toEqual(['9900000001', '9900000002', '9900000003', '9900000004']);
    expect(src.lines[1].qty).toBe(0);
    expect(src).toMatchObject({ bad: 1, noId: 1, lossy: { 'หมายเลขคำสั่งซื้อออนไลน์': 2 } });
    expect(M.describe(src)).toMatchObject({ lines: 4, orders: 4, bad: 1, noId: 1, span: { min: '2026-10-01', max: '2026-10-01' } });
  });

  it('สรุปฝั่งบัญชีนับเอกสารและบรรทัดที่ไม่มีเลขออเดอร์', () => {
    const src = load(accRows([
      { o: '9900000001', doc: 'DOC-0001', q: 1, d: '2026-10-02' },
      { o: '9900000001', doc: 'DOC-0001', code: B, q: 1, d: '2026-10-02' },
      { doc: 'DOC-0002', q: 1, d: '2026-10-05' },
    ]));
    expect(M.describe(src)).toMatchObject({ lines: 3, orders: 1, docs: 2, noKey: 1, span: { min: '2026-10-02', max: '2026-10-05' } });
  });
});

describe('จับคู่', () => {
  it('เลขออเดอร์ตรงและชิ้นต่อ SKU เท่ากัน = ตรงกัน บรรทัดซ้ำในไฟล์บัญชีรวมกันก่อนเทียบ', () => {
    const res = run(
      [{ o: '9900000001', sku: A, lot: 'L1', q: 1 }, { o: '9900000001', sku: A, lot: 'L2', q: 2 }, { o: '9900000001', sku: B, q: 1 }],
      [{ o: '9900000001', doc: 'DOC-0001', code: A, q: 2 }, { o: '9900000001', doc: 'DOC-0001', code: A, q: 1 },
        { o: '9900000001', doc: 'DOC-0001', code: B, q: 1 }],
    );
    expect(byOrder(res, '9900000001')).toMatchObject({ state: 'ok', how: 'order' });
    expect(res.counts).toMatchObject({ ok: 1, diff: 0, none: 0, matched: 1, orders: 1 });
  });

  it('ชิ้นไม่เท่า = จำนวนไม่ตรง บอกทีละ SKU ต่างมากขึ้นก่อน', () => {
    const res = run(
      [{ o: '9900000001', sku: A, q: 1 }, { o: '9900000001', sku: B, q: 5 }, { o: '9900000002', sku: C, q: 1 }],
      [{ o: '9900000001', doc: 'DOC-0001', code: A, q: 2 }, { o: '9900000001', doc: 'DOC-0001', code: C, q: 1 }],
    );
    const b = byOrder(res, '9900000001').bill;
    expect(b.state).toBe('diff');
    expect(b.diffs).toEqual([
      { sku: B, name: 'สินค้า ก', stock: 5, acc: 0 },
      { sku: A, name: 'สินค้า ก', stock: 1, acc: 2 },
      { sku: C, name: 'สินค้า ก', stock: 0, acc: 1 },
    ]);
  });

  it('เทียบด้วย SKU ที่ขาย ไม่ใช่ SKU ตอนซื้อที่แปลงคืนมา', () => {
    const res = run(
      [{ o: '9900000001', sku: A, sold: B, q: 2 }],
      [{ o: '9900000001', doc: 'DOC-0001', code: B, q: 2 }, { o: '9900000002', doc: 'DOC-0002', code: A, q: 1 }],
    );
    expect(byOrder(res, '9900000001').state).toBe('ok');
  });

  it('ออเดอร์ที่แยกบิล จับด้วยเลขก่อนแยกบิล และเทียบรวมกันทั้งกลุ่ม', () => {
    const res = run(
      [{ o: '9900000011', pre: '9900000010', sku: A, q: 1 }, { o: '9900000012', pre: '9900000010', sku: A, q: 2 }],
      [{ o: '9900000010', doc: 'DOC-0001', code: A, q: 3 }],
    );
    expect(res.orders.map((o) => [o.order, o.how, o.state])).toEqual([['9900000011', 'pre', 'ok'], ['9900000012', 'pre', 'ok']]);
    expect(res.bills[0].stock).toHaveLength(2);
  });

  it('ไม่มีเลขออเดอร์ตรง ใช้เลขคำสั่งซื้อออนไลน์', () => {
    const res = run(
      [{ o: '9900000001', on: '990000000000000001', q: 1 }],
      [{ o: '9900000099', on: '990000000000000001', doc: 'DOC-0001', q: 1 }],
    );
    expect(byOrder(res, '9900000001')).toMatchObject({ how: 'online', state: 'ok' });
    expect(res.counts.acconly).toBe(0);
  });

  it('บรรทัดบัญชีที่มีแต่เลขออนไลน์ ไปรวมกับบิลที่มีเลขออนไลน์เดียวกัน ไม่ว่าจะอยู่ก่อนหรือหลังในไฟล์', () => {
    const res = run(
      [{ o: '9900000001', on: '990000000000000001', sku: A, q: 1 }, { o: '9900000001', on: '990000000000000001', sku: B, q: 1 }],
      [{ on: '990000000000000001', doc: 'DOC-0001', code: B, q: 1 }, { o: '9900000001', on: '990000000000000001', doc: 'DOC-0001', code: A, q: 1 }],
    );
    expect(res.bills).toHaveLength(1);
    expect(byOrder(res, '9900000001')).toMatchObject({ how: 'order', state: 'ok' });
  });

  it('ไม่พบในไฟล์บัญชี = ยังไม่มี Invoice วันที่หลังเอกสารใบสุดท้ายบอกว่ายังไม่ถึงรอบ', () => {
    const res = run(
      [{ o: '9900000001', q: 1, d: '01/10/2026' }, { o: '9900000002', q: 1, d: '05/10/2026' }, { o: '9900000003', q: 1, d: '09/10/2026' }],
      [{ o: '9900000001', doc: 'DOC-0001', q: 1, d: '2026-10-06' }],
    );
    expect(byOrder(res, '9900000002')).toMatchObject({ state: 'none', later: false });
    expect(byOrder(res, '9900000003')).toMatchObject({ state: 'none', later: true });
    expect(res.counts).toMatchObject({ ok: 1, none: 2, later: 1 });
  });

  it('เอกสารที่อ้างออเดอร์ที่ไม่มีในไฟล์คลัง กับเอกสารที่ไม่มีเลขออเดอร์ แยกกันคนละกอง', () => {
    const res = run(
      [{ o: '9900000001', q: 1 }],
      [{ o: '9900000001', doc: 'DOC-0001', q: 1 }, { o: '9900000002', doc: 'DOC-0002', q: 4 },
        { doc: 'DOC-0003', q: 1 }, { doc: 'DOC-0003', code: B, q: 2 }, { doc: 'DOC-0004', q: 1 }],
    );
    expect(res.acconly.map((b) => [b.order, b.qty])).toEqual([['9900000002', 4]]);
    expect(res.nokey.map((n) => [n.doc, n.lines.length, n.qty])).toEqual([['DOC-0003', 2, 3], ['DOC-0004', 1, 1]]);
    expect(res.counts).toMatchObject({ acconly: 1, nokey: 2, nokeyLines: 3 });
  });

  it('รหัสที่ไม่มีในไฟล์คลังเลย (ค่าส่ง) ไม่นำมาเทียบ แต่รวมไว้ให้เห็น', () => {
    const res = run(
      [{ o: '9900000001', q: 1 }],
      [{ o: '9900000001', doc: 'DOC-0001', q: 1 }, { o: '9900000001', doc: 'DOC-0001', code: 'XXX0000000009', name: 'ค่าส่ง', q: 1 },
        { o: '9900000002', doc: 'DOC-0002', code: 'XXX0000000009', name: 'ค่าส่ง', q: 1 }],
    );
    const o = byOrder(res, '9900000001');
    expect(o.state).toBe('ok');
    expect(o.bill.extra).toHaveLength(1);
    expect(res.extraCodes).toEqual([{ code: 'XXX0000000009', name: 'ค่าส่ง', lines: 2, qty: 2 }]);
  });

  it('ออเดอร์มีหลายเอกสาร รวมกันไม่ตรงแต่มีใบเดียวที่ตรงพอดี ใช้ใบนั้น', () => {
    const res = run(
      [{ o: '9900000001', q: 2 }],
      [{ o: '9900000001', doc: 'DOC-0001', q: 2 }, { o: '9900000001', doc: 'DOC-0009', q: 1 }],
    );
    const b = byOrder(res, '9900000001').bill;
    expect(b).toMatchObject({ state: 'ok', main: 'DOC-0001', docs: ['DOC-0001', 'DOC-0009'] });
    expect(res.counts.many).toBe(0);
    const item = M.items(res)[0];
    expect(item.doc).toBe('DOC-0001');
    expect(item.note).toContain('DOC-0009');
  });

  it('หลายเอกสารและไม่มีใบไหนตรง ยังเป็นจำนวนไม่ตรง', () => {
    const res = run(
      [{ o: '9900000001', q: 5 }],
      [{ o: '9900000001', doc: 'DOC-0001', q: 2 }, { o: '9900000001', doc: 'DOC-0009', q: 1 }],
    );
    expect(byOrder(res, '9900000001').bill).toMatchObject({ state: 'diff', main: '' });
    expect(res.counts.many).toBe(1);
  });

  it('เลขออเดอร์ไม่สนตัวพิมพ์และช่องว่าง', () => {
    const res = run([{ o: 'ab-0001 ', q: 1 }], [{ o: 'AB-0001', doc: 'DOC-0001', q: 1 }]);
    expect(res.orders[0].state).toBe('ok');
  });
});

describe('รายการบนหน้าเว็บ', () => {
  let res, items;
  beforeAll(() => {
    res = run(
      [
        { o: '9900000001', q: 1, d: '01/10/2026' },
        { o: '9900000002', sku: B, q: 3, d: '02/10/2026' },
        { o: '9900000003', q: 1, d: '03/10/2026' },
        { o: '9900000004', q: 1, d: '20/10/2026' },
      ],
      [
        { o: '9900000001', doc: 'DOC-0001', q: 1, d: '2026-10-02' },
        { o: '9900000002', doc: 'DOC-0002', code: B, q: 2, d: '2026-10-03' },
        { o: '9900000005', doc: 'DOC-0005', q: 1, d: '2026-10-04' },
        { doc: 'DOC-0006', q: 1, d: '2026-10-05' },
      ],
    );
    items = M.items(res);
  });

  it('เรื่องที่ต้องตามต่อขึ้นก่อน ตรงกันอยู่ท้าย', () => {
    expect(items.map((i) => [i.state, i.order || i.doc])).toEqual([
      ['diff', '9900000002'], ['none', '9900000003'], ['none', '9900000004'],
      ['acconly', '9900000005'], ['nokey', 'DOC-0006'], ['ok', '9900000001'],
    ]);
    expect(items[0]).toMatchObject({ doc: 'DOC-0002', stockQty: 3, accQty: 2, docDate: '2026-10-03' });
  });

  it('กรองตามผล ยังไม่ถึงรอบ และค้นด้วยเลขเอกสารหรือ SKU', () => {
    expect(M.filter(items, { only: 'none' }).map((i) => i.order)).toEqual(['9900000003', '9900000004']);
    expect(M.filter(items, { only: 'later' }).map((i) => i.order)).toEqual(['9900000004']);
    expect(M.filter(items, { q: 'doc-0005' }).map((i) => i.order)).toEqual(['9900000005']);
    expect(M.filter(items, { q: B }).map((i) => i.order)).toEqual(['9900000002']);
    expect(M.filter(items, { q: '00003' }).map((i) => i.order)).toEqual(['9900000003']);
  });

  it('ไฟล์ Excel ชีตแรกคือทุกบรรทัดฝั่งคลังตามลำดับในไฟล์ ต่อท้ายด้วยเลขที่เอกสาร', () => {
    const t = M.lineTable(res);
    expect(t[0]).toEqual(M.LINE_HEAD);
    expect(t.slice(1).map((r) => [r[3], r[12], r[13], r[14], r[15]])).toEqual([
      ['9900000001', 'DOC-0001', '02/10/2026', 'เลขออเดอร์', 'ตรง'],
      ['9900000002', 'DOC-0002', '03/10/2026', 'เลขออเดอร์', 'จำนวนไม่ตรง'],
      ['9900000003', '', '', '', 'ยังไม่มี Invoice'],
      ['9900000004', '', '', '', 'ยังไม่มี Invoice'],
    ]);
    expect(t[4][16]).toContain('05/10/2026');   // หลังเอกสารใบสุดท้าย บอกไว้ในหมายเหตุ
  });

  it('ชีตยอดไม่ตรง ยังไม่มี Invoice และมีแต่ในไฟล์บัญชี', () => {
    expect(M.diffTable(res).slice(1)).toEqual([['9900000002', '', 'DOC-0002', B, 'สินค้า ก', 3, 2, 1]]);
    expect(M.noneTable(res).slice(1).map((r) => [r[1], r[6], !!r[7]])).toEqual([['9900000003', 1, false], ['9900000004', 1, true]]);
    expect(M.accTable(res).slice(1).map((r) => [r[0], r[2], r[7], r[8]])).toEqual([
      ['9900000005', 'DOC-0005', 'ไม่พบออเดอร์นี้ในไฟล์คลัง', 4],
      ['', 'DOC-0006', 'บัญชียังไม่ใส่เลขออเดอร์', 5],
    ]);
  });

  it('ปุ่มคัดลอกได้หนึ่งบรรทัดต่อรายการ คั่นด้วยแท็บ', () => {
    const t = M.itemTable(M.filter(items, { only: 'diff' }));
    expect(t[1].slice(0, 9)).toEqual(['จำนวนไม่ตรง', '9900000002', '', '02/10/2026', 'DOC-0002', '03/10/2026', 'เลขออเดอร์', 3, 2]);
    expect(t[1][9]).toBe(`${B} คลัง 3 บัญชี 2`);
    expect(M.tsv([['ก\tข', 'ค\nง'], [1, null]])).toBe('ก ข\tค ง\n1\t');
  });
});
