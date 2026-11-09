/**
 * นับสต๊อกใหญ่: apps-script/stocktake-api.gs (ชีตเก็บผลนับ) กับ public/wms-stocktake.js (ตรรกะของหน้าเว็บ)
 *
 * รันสคริปต์ตัวจริงกับชีตในหน่วยความจำ (src/dev/fake-gas.js) เพราะสิ่งที่พังแล้วเสียหายจริงอยู่ฝั่งชีต:
 * แถวนับหาย ถูกเขียนทับ ส่งซ้ำแล้วนับเบิ้ล หรือคนนับเห็นยอดในสมุด
 * ยอดตั้งต้นต้องตรงกับยอดของ tx-api.gs ทุกกอง จึงรันสคริปต์นั้นเทียบด้วย ข้อมูลทั้งหมดสมมติ repo นี้เป็นสาธารณะ
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadStocktake, fakeFifo } from '../dev/fake-gas.js';

const JS = fs.readFileSync(path.resolve(__dirname, '../../public/wms-stocktake.js'), 'utf8');
const TX = fs.readFileSync(path.resolve(__dirname, '../../apps-script/tx-api.gs'), 'utf8');

let S;
beforeAll(() => {
  const win = {};
  new Function('window', JS)(win);
  S = win.WmsStocktake;
});

const HEAD = 'head-secret';
const ROUND = { name: 'นับใหญ่ พ.ย. สมมติ', date: '2026-11-15', cutoff: '2026-11-14T18:00', settings: { auditMin: 20 } };
const PILES = [
  ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 10, 0],
  ['R1-01-02', 'BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ', '9', '9900000002', 4, 0],
  ['A-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 3, 1],
];
const LOCS = [['R1-01-01', 'R', 'R1', 'สมุด'], ['R1-01-02', 'R', 'R1', 'สมุด'], ['A-01-01', 'A', 'A-01', 'สมุด'], ['A-01-02', 'A', 'A-01', 'สมุด (ว่าง)']];
const TEAMS = [
  { id: 'INV1', kind: 'Inventory', name: 'ทีม 1', members: ['สมชาย', 'สมหญิง'], zones: ['R1'], locs: 2 },
  { id: 'INV2', kind: 'Inventory', name: 'ทีม 2', members: ['มานะ'], zones: ['A-01'], locs: 2 },
  { id: 'AUD1', kind: 'Audit', name: 'วิไล', members: ['วิไล'], zones: ['R1', 'A-01'], locs: 4 },
];

/** รอบที่พร้อมนับ: ตั้งรอบ ส่งยอดตั้งต้น บันทึกทีม แล้วเริ่มนับรอบ 1 */
function ready(api, { start = true } = {}) {
  const id = api.post({ op: 'st-round-save', t: HEAD, round: ROUND, by: 'หัวหน้าสมมติ' }).round.id;
  api.post({ op: 'st-baseline', t: HEAD, round: id, piles: PILES, skus: [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ']], pos: [['9900000001', 'ผู้ผลิต ก สมมติ']], lastRow: 500, lastDate: '2026-11-14' });
  api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS, locs: LOCS });
  if (start) expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).error).toBeUndefined();
  return id;
}

const item = (o) => ({ uid: o.uid, pass: 1, team: 'INV1', who: 'สมชาย', loc: 'R1-01-01', sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: '9900000001', qty: 10, type: 'นับ', at: '10:00', ...o });

describe('stocktake-api.gs — รหัสและรอบนับ', () => {
  it('ไม่ใส่ api บอกว่าเป็นสคริปต์นับสต๊อก', () => {
    expect(loadStocktake().get({})).toEqual({ app: 'stocktake' });
  });

  it('ยังไม่ตั้ง HEAD_TOKEN ไม่ให้ใครใช้หน้าหัวหน้า แม้ส่งรหัสว่างมา', () => {
    const api = loadStocktake({ head: '' });
    expect(api.get({ api: 'st-rounds', t: '' }).error).toMatch(/HEAD_TOKEN/);
    expect(api.post({ op: 'st-round-save', t: '', round: ROUND }).error).toMatch(/HEAD_TOKEN/);
  });

  it('รหัสหัวหน้าผิดใช้ไม่ได้', () => {
    const api = loadStocktake();
    expect(api.get({ api: 'st-rounds', t: 'เดา' }).error).toBe('รหัสหัวหน้าไม่ถูก');
  });

  it('สร้างรอบแล้วได้รหัส ST+ปีเดือนวัน และสร้างแท็บครบ 8 แท็บพร้อมหัวตาราง', () => {
    const api = loadStocktake();
    const a = api.post({ op: 'st-round-save', t: HEAD, round: ROUND, by: 'หัวหน้าสมมติ' });
    const b = api.post({ op: 'st-round-save', t: HEAD, round: ROUND });
    expect(a.round.id).toMatch(/^ST\d{6}-1$/);
    expect(b.round.id).toMatch(/^ST\d{6}-2$/);
    expect(a.round).toMatchObject({ status: 'ตั้งค่า', pass: 0, set: 0, cutoff: '2026-11-14 18:00', settings: { auditMin: 20 } });
    api.get({ api: 'st-rounds', t: HEAD });
    expect(api.ss.tabs.map((t) => t.name)).toEqual(['รอบนับ', 'ทีมและโซน', 'Location', 'ยอดตั้งต้น', 'รายการสินค้า', 'บันทึกนับ', 'ผลสรุป', 'แผนนับรอบ 2']);
    expect(api.ss.tab('บันทึกนับ').grid[0]).toContain('รหัสแถว');
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds.map((r) => r.id)).toEqual([b.round.id, a.round.id]);
  });

  it('ไม่มีชื่อ วันที่ผิดรูป หรือเวลาตัดยอดไม่ครบ บอกว่าผิดตรงไหน', () => {
    const api = loadStocktake();
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, name: ' ' } }).error).toBe('ตั้งชื่อรอบก่อน');
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, date: '15/11/2026' } }).error).toMatch(/วันที่นับ/);
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, cutoff: '2026-11-14' } }).error).toMatch(/เวลาตัดยอด/);
  });

  it('เริ่มนับแล้วเปลี่ยนเวลาตัดยอดไม่ได้ แต่แก้ชื่อได้', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, id, cutoff: '2026-11-14T20:00' } }).error).toMatch(/เปลี่ยนวันที่/);
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, id, name: 'ชื่อใหม่' } }).round.name).toBe('ชื่อใหม่');
  });
});

describe('stocktake-api.gs — ยอดตั้งต้น ทีม และสถานะ', () => {
  it('ดึงยอดใหม่ได้ชุดที่ 2 ชุดแรกยังอยู่ในแท็บ หน้าหัวหน้าได้เฉพาะชุดล่าสุด', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    const r2 = api.post({ op: 'st-baseline', t: HEAD, round: id, piles: PILES.slice(0, 1), skus: [], pos: [], lastRow: 510 });
    expect(r2.round).toMatchObject({ set: 2, lastRow: 510 });
    expect(api.ss.tab('ยอดตั้งต้น').getLastRow()).toBe(1 + 3 + 1);
    const h = api.get({ api: 'st-head', round: id, t: HEAD });
    expect(h.piles).toEqual([PILES[0]]);
    expect(h.skus).toEqual([]);   // รายการสินค้าแทนชุดเดิมทั้งชุด
  });

  it('LOT กับ PO ถูกตั้งเป็นข้อความก่อนเขียน ชีตจะไม่ตัด 0 นำหน้าหรือแปลงเป็นตัวเลข', () => {
    const api = loadStocktake();
    ready(api, { start: false });
    const f = api.ss.tab('ยอดตั้งต้น').formats.filter((x) => x.r === 2).map((x) => x.c);
    expect(f).toEqual(expect.arrayContaining([3, 7, 8]));
    expect(f).not.toContain(9);   // ยอดยังเป็นตัวเลข
  });

  it('ยอดตั้งต้นที่ไม่มี Location หรือยอดไม่ใช่ตัวเลข ไม่รับทั้งชุด', () => {
    const api = loadStocktake();
    const id = api.post({ op: 'st-round-save', t: HEAD, round: ROUND }).round.id;
    expect(api.post({ op: 'st-baseline', t: HEAD, round: id, piles: [['', 'A', 'A', '', '', '', 1, 0]] }).error).toMatch(/ไม่ครบ/);
    expect(api.post({ op: 'st-baseline', t: HEAD, round: id, piles: [['R1-01-01', 'A', 'A', '', '', '', '5', 0]] }).error).toMatch(/ไม่ครบ/);
  });

  it('บันทึกทีมซ้ำแทนชุดเดิมของรอบนับนั้น ทีมรอบนับอื่นอยู่ครบ', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 2, teams: [{ id: 'INV9', kind: 'Inventory', zones: ['R1'] }] });
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS.slice(0, 2) });
    const t = api.get({ api: 'st-head', round: id, t: HEAD }).teams;
    expect(t.map((x) => `${x.pass}:${x.id}`).sort()).toEqual(['1:INV1', '1:INV2', '2:INV9']);
    expect(api.get({ api: 'st-head', round: id, t: HEAD }).locs).toHaveLength(4);   // ไม่ส่ง locs = ใช้ชุดเดิม
  });

  it('แถวที่ตั้งไม่นับเก็บในค่าตั้งของรอบ โลยังอยู่ ไม่ส่ง skip = ใช้ค่าเดิม ค่าอื่นของรอบไม่หาย', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS, skip: ['RIB', 'dockload'] });
    let h = api.get({ api: 'st-head', round: id, t: HEAD });
    expect(h.round.settings.skip).toEqual(['RIB', 'DOCKLOAD']);
    expect(h.round.settings.auditMin).toBe(ROUND.settings.auditMin);
    expect(h.locs).toHaveLength(4);
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS });
    h = api.get({ api: 'st-head', round: id, t: HEAD });
    expect(h.round.settings.skip).toEqual(['RIB', 'DOCKLOAD']);
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS, skip: [] });
    expect(api.get({ api: 'st-head', round: id, t: HEAD }).round.settings.skip).toEqual([]);
  });

  it('รหัสทีมซ้ำ หรือประเภทไม่ใช่ Inventory / Audit ไม่รับ', () => {
    const api = loadStocktake();
    const id = api.post({ op: 'st-round-save', t: HEAD, round: ROUND }).round.id;
    expect(api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: [TEAMS[0], TEAMS[0]] }).error).toMatch(/ซ้ำ/);
    expect(api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: [{ id: 'X', kind: 'QA' }] }).error).toMatch(/Inventory หรือ Audit/);
  });

  it('ชื่อที่ขึ้นต้นด้วยเครื่องหมายสูตรถูกตัดออก ไม่กลายเป็นสูตรในชีต', () => {
    const api = loadStocktake();
    const id = api.post({ op: 'st-round-save', t: HEAD, round: ROUND }).round.id;
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: [{ id: 'INV1', kind: 'Inventory', name: '=HYPERLINK("x")', members: ['+สมชาย'] }] });
    const row = api.ss.tab('ทีมและโซน').grid[1];
    expect(row[4]).toBe('HYPERLINK("x")');
    expect(row[5]).toBe('สมชาย');
  });

  it('เริ่มนับไม่ได้ถ้ายังไม่มียอดตั้งต้น ทีม Inventory หรือรายการ Location', () => {
    const api = loadStocktake();
    const id = api.post({ op: 'st-round-save', t: HEAD, round: ROUND }).round.id;
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).error).toMatch(/ยอดตั้งต้น/);
    api.post({ op: 'st-baseline', t: HEAD, round: id, piles: PILES });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).error).toMatch(/ทีม Inventory/);
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).error).toMatch(/Location/);
    api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS, locs: LOCS });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).round).toMatchObject({ status: 'นับรอบ 1', pass: 1 });
  });

  it('ขั้นนี้ยังเปลี่ยนเป็นปิดรอบไม่ได้', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'ปิดแล้ว' }).error).toMatch(/ไม่ได้/);
  });

  it('นับรอบ 1 ↔ วิเคราะห์ ได้ แต่ข้ามจากตั้งค่าไปวิเคราะห์ไม่ได้ ระหว่างวิเคราะห์ยังรับผลที่ค้างส่ง', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).error).toMatch(/ไม่ได้/);
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).round.status).toBe('วิเคราะห์');
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'ตั้งค่า' }).error).toMatch(/ไม่ได้/);
    expect(api.post({ op: 'st-count', k: HEAD, round: id, items: [item({ uid: 'late-1' })] }).saved).toBe(1);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).round.status).toBe('นับรอบ 1');
  });

  it('ผลสรุป: แทนชุดเดิมของรอบ ตัดสูตร ช่องตัวเลขต้องเป็นตัวเลข บันทึกเวลาไว้ในรอบ', () => {
    const api = loadStocktake();
    const id = ready(api);
    const row = ['R1-01-01', 'AAA001', 'AAA0000000001', '=HYPERLINK("x")', '8', '9900000001', 10, 9, '', '', 9, -1, 'ขาด', 'ขาด 1', 'ทีม 1', 'สมชาย'];
    expect(api.post({ op: 'st-summary', round: id, lines: [row] }).error).toMatch(/รหัสหัวหน้า/);
    expect(api.post({ op: 'st-summary', t: HEAD, round: id, lines: [row.slice(0, 15)] }).error).toMatch(/16 ช่อง/);
    expect(api.post({ op: 'st-summary', t: HEAD, round: id, lines: [[...row.slice(0, 6), '10', ...row.slice(7)]] }).error).toMatch(/ตัวเลข/);
    expect(api.post({ op: 'st-summary', t: HEAD, round: id, lines: [row, row] }).saved).toBe(2);
    const res = api.post({ op: 'st-summary', t: HEAD, round: id, lines: [row], by: 'หัวหน้า' });
    expect(res.saved).toBe(1);
    expect(res.round.settings).toMatchObject({ summaryBy: 'หัวหน้า', summaryRows: 1 });
    const tab = api.ss.tab('ผลสรุป');
    expect(tab.getLastRow()).toBe(2);
    expect(tab.grid[1].slice(0, 5)).toEqual([id, 'R1-01-01', 'AAA001', 'AAA0000000001', 'HYPERLINK("x")']);
    expect(tab.grid[1].slice(7, 10)).toEqual([10, 9, '']);
    expect(tab.grid[1][11]).toBe(9);
  });
});

describe('stocktake-api.gs — หน้ากรอกของคนนับ', () => {
  it('หน้ากรอกไม่ได้ยอดในสมุดเลย ไม่มีช่องยอดแม้แต่ช่องเดียว', () => {
    const api = loadStocktake();
    const id = ready(api);
    const v = api.get({ api: 'st-round', round: id });
    expect(v.piles).toBeUndefined();
    expect(v.countKey).toBeUndefined();
    expect(v.round.lastRow).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/"qty"|ยอดในสมุด/);
    expect(v.locs).toEqual([['R1-01-01', 'R1'], ['R1-01-02', 'R1'], ['A-01-01', 'A-01'], ['A-01-02', 'A-01']]);
    expect(v.round.auditMin).toBe(20);
    expect(v.skus).toEqual([['AAA001', 'AAA0000000001', 'ที่นอนสมมติ']]);
  });

  it('ตั้ง COUNT_TOKEN แล้ว ลิงก์ที่ไม่มีรหัสใช้ไม่ได้ รหัสหัวหน้าใช้แทนได้', () => {
    const api = loadStocktake({ count: 'nab' });
    const id = ready(api);
    expect(api.get({ api: 'st-round', round: id }).error).toMatch(/ลิงก์นับไม่ถูก/);
    expect(api.get({ api: 'st-round', round: id, k: 'nab' }).round.id).toBe(id);
    expect(api.get({ api: 'st-round', round: id, k: HEAD }).round.id).toBe(id);
    expect(api.get({ api: 'st-head', round: id, t: HEAD }).countKey).toBe('nab');
  });

  it('ยังไม่เริ่มนับ ส่งผลนับไม่ได้', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    expect(api.post({ op: 'st-count', round: id, items: [item({ uid: 'a1' })] }).error).toMatch(/ยังไม่เปิดนับ/);
  });

  it('ส่งชุดเดิมซ้ำ (เน็ตหลุดก่อนได้คำตอบ) แถวไม่ถูกเขียนซ้ำ', () => {
    const api = loadStocktake();
    const id = ready(api);
    const items = [item({ uid: 'd1-a' }), item({ uid: 'd1-b', loc: 'R1-01-02', qty: 0, type: 'ว่าง' })];
    expect(api.post({ op: 'st-count', round: id, device: 'd1', items })).toMatchObject({ saved: 2, dup: 0 });
    expect(api.post({ op: 'st-count', round: id, device: 'd1', items })).toMatchObject({ saved: 0, dup: 2 });
    expect(api.ss.tab('บันทึกนับ').getLastRow()).toBe(3);
  });

  it('หลายเครื่องส่งพร้อมกัน แถวต่อกันครบ ไม่มีแถวไหนทับกัน และทุกครั้งเขียนภายใต้ล็อก', () => {
    const api = loadStocktake();
    const id = ready(api);
    const before = api.lock.waits;
    for (let d = 1; d <= 15; d++) {
      const items = Array.from({ length: 10 }, (_, i) => item({ uid: `dev${d}-${i}`, who: `คน${d}`, qty: i }));
      expect(api.post({ op: 'st-count', round: id, device: `dev${d}`, items }).saved).toBe(10);
    }
    const uids = api.ss.tab('บันทึกนับ').grid.slice(1).map((r) => r[14]);
    expect(uids).toHaveLength(150);
    expect(new Set(uids).size).toBe(150);
    expect(api.lock.waits - before).toBe(15);
    expect(api.lock.held).toBe(false);
  });

  it('แถวที่ผิด (ทีมไม่มี จำนวนติดลบ ไม่มี SKU ยกเลิกไม่บอกแถว) ถูกตีกลับทีละแถว แถวที่ถูกในชุดเดียวกันยังเข้า', () => {
    const api = loadStocktake();
    const id = ready(api);
    const res = api.post({
      op: 'st-count', round: id, items: [
        item({ uid: 'ok' }),
        item({ uid: 'x1', team: 'INV99' }),
        item({ uid: 'x2', qty: -1 }),
        item({ uid: 'x3', sku: '', long: '' }),
        item({ uid: 'x4', type: 'ยกเลิก', ref: '' }),
        item({ uid: 'x5', pass: 2 }),
        item({ uid: '' }),
      ],
    });
    expect(res.saved).toBe(1);
    expect(res.rejected.map((r) => r.uid)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5', '']);
    expect(res.rejected[4].why).toMatch(/รอบนับ 2 ยังไม่เปิด/);
  });

  it('แก้กองเป็นแถวใหม่ที่ชี้แถวเดิม แถวเดิมยังอยู่ครบ', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.post({ op: 'st-count', round: id, items: [item({ uid: 'p1', qty: 10 })] });
    api.post({ op: 'st-count', round: id, items: [item({ uid: 'p2', qty: 12, ref: 'p1' }), item({ uid: 'p3', type: 'ยกเลิก', ref: 'p2', qty: '' })] });
    const g = api.ss.tab('บันทึกนับ').grid;
    expect(g.slice(1).map((r) => [r[14], r[11], r[12], r[13]])).toEqual([['p1', 10, 'นับ', ''], ['p2', 12, 'นับ', 'p1'], ['p3', '', 'ยกเลิก', 'p2']]);
  });

  it('คำตอบตอนส่งมีแถวของทีมตัวเองที่ใหม่กว่า since เท่านั้น ไม่เห็นตัวเลขของ Audit', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.post({ op: 'st-count', round: id, items: [item({ uid: 'aud', team: 'AUD1', who: 'วิไล', qty: 9 })] });
    api.post({ op: 'st-count', round: id, items: [item({ uid: 'mate', who: 'สมหญิง', loc: 'R1-01-02', qty: 4 })] });
    const res = api.post({ op: 'st-count', round: id, team: 'INV1', since: 0, items: [item({ uid: 'me' })] });
    expect(res.rows.map((r) => r[14])).toEqual(['mate', 'me']);
    expect(res.last).toBe(4);
    const mine = api.get({ api: 'st-mine', round: id, team: 'INV1', since: 3 });
    expect(mine.rows.map((r) => r[14])).toEqual(['me']);
    expect(api.get({ api: 'st-mine', round: id }).error).toMatch(/ทีม/);
  });

  it('หัวหน้าอ่านต่อจากแถวที่ since ได้ทุกทีม', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.post({ op: 'st-count', round: id, items: [item({ uid: 'a' }), item({ uid: 'b', team: 'AUD1' })] });
    const all = api.get({ api: 'st-log', round: id, since: 0, t: HEAD });
    expect(all.rows.map((r) => r[14])).toEqual(['a', 'b']);
    expect(all.rows[0]).toEqual([2, expect.any(Number), 1, 'INV1', 'Inventory', 'สมชาย', 'R1-01-01', 'AAA001', 'AAA0000000001', '8', '9900000001', 10, 'นับ', '', 'a', '10:00']);
    expect(api.get({ api: 'st-log', round: id, since: 2, t: HEAD }).rows.map((r) => r[14])).toEqual(['b']);
    expect(api.get({ api: 'st-log', round: id, since: 3, t: HEAD }).rows).toEqual([]);
  });
});

/* ── ตรรกะของหน้าเว็บ ─────────────────────────────────────────────────── */

/** โหลด tx-api.gs ตัวจริงกับแถวสมุดสมมติ ไว้เทียบยอดกับ WmsStocktake.baseline */
function txApi(rows) {
  const HEADS = ['SKU', 'SKU', 'Product Name', 'LOT', 'PO.', 'Location เบิก', 'Location รับ', 'QTY', 'รับ/เบิก', 'Note', 'Status', 'NAME'];
  const grid = [HEADS, ...rows];
  const sheet = {
    getLastRow: () => grid.length, getLastColumn: () => HEADS.length, getSheetId: () => 1, getName: () => 'Transaction',
    getRange: (r, c, nr, nc) => ({ getValues: () => grid.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)) }),
  };
  const ss = {
    getSheets: () => [sheet], getSheetByName: () => null, getSpreadsheetTimeZone: () => 'UTC',
    getUrl: () => 'https://docs.example/d/1/edit',
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  };
  vm.createContext(ctx);
  vm.runInContext(TX, ctx);
  return ctx;
}

const L = (o) => [o.sku ?? 'AAA001', o.long ?? `L-${o.sku ?? 'AAA001'}`, 'สินค้าสมมติ', o.lot ?? 8, o.po ?? 9900000001,
  o.from ?? '', o.to ?? '', o.qty ?? 1, o.type ?? 'รับ', o.note ?? 'โอนย้าย', o.status ?? '', 'สมมติ'];

describe('WmsStocktake.baseline — ยอดตั้งต้นตรงกับ tx-api.gs ทุกกอง', () => {
  it('รับ ขาย ย้าย ติดลบ LOT เป็นข้อความ/ตัวเลข และ Location พิมพ์เล็กใหญ่ต่างกัน ได้ยอดเท่าหน้าสต๊อกราย Location', () => {
    const rows = [
      L({ to: 'R1-01-01', qty: 10 }),
      L({ to: 'r1-01-01', qty: 2, lot: '8' }),             // LOT ข้อความ "8" กับตัวเลข 8 คือกองเดียวกัน
      L({ from: 'R1-01-01', to: 'A-01-01', qty: 3, type: 'เบิก', status: 'เปิด' }),
      L({ from: 'A-01-01', qty: 1, type: 'ขาย', note: '01/11/2026' }),
      L({ from: 'A-01-01', qty: 5, type: 'ขาย', note: '02/11/2026' }),   // ขายเกิน → ติดลบ
      L({ sku: 'BBB001', to: 'R1-01-02', qty: 4, po: 9900000002 }),
      L({ sku: 'BBB001', from: 'R1-01-02', to: 'R1-01-03', qty: 4, type: 'รับ' }),   // ประเภทรับ: ไม่หักต้นทาง แบบเดียวกับสูตรชีต
      L({ sku: 'CCC001', to: 'QA', qty: 7, lot: '' }),
      L({ sku: 'CCC001', from: 'QA', qty: 7, type: 'เบิก' }),   // หมดเป็น 0 ไม่ส่ง
    ];
    const tx = txApi(rows);
    const sum = tx.summary_();
    const want = sum.keys.map((k) => {
      const s = sum.skus[k[0]];
      return `${String(sum.locs[k[3]]).toUpperCase()}|${s[1]}|${k[1] === '' ? '' : String(k[1])}|${k[2]}|${k[4]}|${k[5]}`;
    }).sort();
    const b = S.baseline(JSON.parse(JSON.stringify(tx.fifo_())));
    const got = b.piles.map((p) => `${p[0]}|${p[2]}|${p[4]}|${p[5]}|${p[6]}|${p[7]}`).sort();
    expect(got).toEqual(want);
    expect(got).toContain('A-01-01|L-AAA001|8|9900000001|-3|1');
    expect(b.lastRow).toBe(10);
  });

  it('สมุดสมมติทั้งคลัง: ทุกกองมี SKU และ Location และไม่มีกองยอด 0', () => {
    const b = S.baseline(fakeFifo(), (po) => `sup-${po}`);
    expect(b.piles.length).toBeGreaterThan(40);
    expect(b.piles.every((p) => p[0] && p[2] && p[6] !== 0)).toBe(true);
    expect(b.pos[0]).toEqual(['9900000001', 'sup-9900000001']);
    expect(b.locs.find((l) => l.loc === 'DOCKLOAD').piles).toBe(0);
  });
});

describe('WmsStocktake — Location โซน แถว', () => {
  it('แยกโซน แถว ชั้นจากชื่อ Location', () => {
    expect(S.parseLoc('R1-03-02')).toEqual({ zone: 'R', group: 'R1', level: 2 });
    expect(S.parseLoc('r12-01-04')).toEqual({ zone: 'R', group: 'R12', level: 4 });
    expect(S.parseLoc('A-01-05')).toEqual({ zone: 'A', group: 'A-01', level: 0 });
    expect(S.parseLoc('S-02-01').group).toBe('S-02');
    expect(S.parseLoc('QA')).toEqual({ zone: 'QA', group: 'QA', level: 0 });
    expect(S.parseLoc('DOCKLOAD')).toEqual({ zone: 'อื่นๆ', group: 'อื่นๆ', level: 0 });
  });

  it('เรียงตามทางเดิน: แร็คก่อนพื้น เลขเรียงแบบตัวเลข', () => {
    const list = ['A-02-01', 'R10-01-01', 'QA', 'R2-01-02', 'DOCKLOAD', 'A-01-03', 'R2-01-01', 'S-01-01'];
    expect(list.sort(S.locCmp)).toEqual(['R2-01-01', 'R2-01-02', 'R10-01-01', 'A-01-03', 'A-02-01', 'S-01-01', 'QA', 'DOCKLOAD']);
    expect(['A-01', 'R10', 'อื่นๆ', 'R2', 'QA'].sort(S.groupCmp)).toEqual(['R2', 'R10', 'A-01', 'QA', 'อื่นๆ']);
  });

  it('รายการโล: โลที่มีของ + ที่เก็บจริงที่ว่าง + ที่วางเพิ่ม ไม่เอาชื่อแปลกที่ว่าง', () => {
    const base = { locs: [{ loc: 'R1-01-01', piles: 2 }, { loc: 'R1-01-02', piles: 0 }, { loc: 'R1-0l-03', piles: 0 }, { loc: 'OFFICE', piles: 1 }] };
    const list = S.locations(base, S.parseLocList('R1-01-09\nr1-01-01\n\nR1-01-10, R1-01-11'));
    expect(list.map((l) => `${l.loc}:${l.src}`)).toEqual([
      'R1-01-01:สมุด', 'R1-01-02:สมุด (ว่าง)', 'R1-01-09:เพิ่มเอง', 'R1-01-10:เพิ่มเอง', 'R1-01-11:เพิ่มเอง', 'OFFICE:สมุด',
    ]);
  });

  it('แบ่งอัตโนมัติ: ทุกแถวมีทีม แถวติดกันอยู่ทีมเดียวกัน จำนวนโลใกล้กัน', () => {
    const g = S.groups(S.locations(S.baseline(fakeFifo())));
    const split = S.autoSplit(g, ['T1', 'T2', 'T3']);
    expect(g.every((x) => split[x.group])).toBe(true);
    const seq = g.map((x) => split[x.group]);
    expect(seq.filter((t, i) => i && t !== seq[i - 1])).toHaveLength(2);   // เปลี่ยนทีมแค่ 2 ครั้ง = ติดกัน
    const n = (t) => g.filter((x) => split[x.group] === t).reduce((s, x) => s + x.n, 0);
    const sizes = ['T1', 'T2', 'T3'].map(n);
    const biggest = Math.max(...g.map((x) => x.n));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(biggest);
  });
});

describe('WmsStocktake — บันทึกนับในเครื่อง', () => {
  const e = (o) => ({ pass: 1, team: 'INV1', kind: 'Inventory', who: 'สมชาย', loc: 'R1-01-01', long: 'A', qty: 1, type: 'นับ', ...o });

  it('แก้ซ้อนแก้เหลือตัวล่าสุด ยกเลิกแล้วหายไป แถวว่างนับเป็นไปแล้ว', () => {
    const list = [e({ uid: 'a', qty: 5 }), e({ uid: 'b', qty: 6, ref: 'a' }), e({ uid: 'c', qty: 7, ref: 'b' }),
      e({ uid: 'd' }), e({ uid: 'x', type: 'ยกเลิก', ref: 'd' }), e({ uid: 'v', loc: 'R1-01-02', type: 'ว่าง', qty: 0 })];
    expect(S.effective(list).map((x) => x.uid)).toEqual(['c', 'v']);
    expect(S.atLoc(list, 'r1-01-01', 'INV1').map((x) => x.qty)).toEqual([7]);
  });

  it('ส่งแล้วเอาออกจากคิว แถวที่ถูกตีกลับแยกไว้พร้อมเหตุผล ไม่หาย', () => {
    const out = [e({ uid: 'a' }), e({ uid: 'b' }), e({ uid: 'c' })];
    const sent = S.batch(out, 2);
    const res = S.ack(out, sent, { rejected: [{ uid: 'b', why: 'ไม่มีทีม' }] });
    expect(res.outbox.map((x) => x.uid)).toEqual(['c']);
    expect(res.rejected).toEqual([expect.objectContaining({ uid: 'b', why: 'ไม่มีทีม' })]);
  });

  it('รวมแถวจากสคริปต์กับในเครื่อง ไม่ซ้ำ', () => {
    expect(S.merge([e({ uid: 'a' })], [e({ uid: 'a' }), e({ uid: 'b' })]).map((x) => x.uid)).toEqual(['a', 'b']);
  });

  it('รหัสแถวไม่ซ้ำแม้กดเร็วในมิลลิวินาทีเดียวกัน', () => {
    const ids = new Set(Array.from({ length: 500 }, () => S.uid('dev1', 1700000000000)));
    expect(ids.size).toBe(500);
  });

  it('ความคืบหน้า: โลที่นับแล้ว ทีม และ Audit ต่ำกว่า 20% ขึ้นเตือน', () => {
    const locs = S.locations({ locs: [], }, ['R1-01-01', 'R1-01-02', 'R1-01-03', 'R1-01-04', 'R1-01-05', 'A-01-01', 'A-01-02']);
    const teams = TEAMS.map((t) => ({ ...t, pass: 1 }));
    const entries = [
      e({ uid: '1', loc: 'R1-01-01' }), e({ uid: '2', loc: 'R1-01-02', type: 'ว่าง' }),
      e({ uid: '3', loc: 'A-01-01', team: 'INV2', who: 'มานะ' }),
      e({ uid: '4', loc: 'A-01-01', team: 'AUD1', kind: 'Audit', who: 'วิไล' }),
      e({ uid: '5', loc: 'R1-01-03' }), e({ uid: '6', type: 'ยกเลิก', ref: '5' }),
      e({ uid: '7', loc: 'X-99' }),
    ];
    const p = S.progress(locs, teams, entries, { auditMin: 20 });
    expect(p).toMatchObject({ total: 7, done: 3, pct: 43 });
    const r1 = p.groups.find((g) => g.group === 'R1');
    expect(r1).toMatchObject({ n: 5, done: 2, team: 'INV1', auditDone: 0, auditPct: 0, auditLow: true });
    expect(r1.left).toEqual(['R1-01-03', 'R1-01-04', 'R1-01-05']);
    expect(p.groups.find((g) => g.group === 'A-01')).toMatchObject({ auditDone: 1, auditPct: 50, auditLow: false });
    expect(p.teams.find((t) => t.id === 'AUD1')).toMatchObject({ n: 7, done: 1, pct: 14 });
    expect(p.audit).toMatchObject({ n: 7, done: 1, pct: 14, min: 20 });
    expect(p.extra).toEqual([{ loc: 'X-99', n: 1 }]);
  });

  it('ทีมเห็นเฉพาะโลในแถวของตัวเอง เรียงตามทางเดิน', () => {
    expect(S.teamLocs(TEAMS[1], [['A-01-02', 'A-01'], ['R1-01-01', 'R1'], ['A-01-01', 'A-01']]).map((l) => l.loc)).toEqual(['A-01-01', 'A-01-02']);
  });
});

describe('WmsStocktake — ช่องพิมพ์และลิงก์', () => {
  const SK = [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ'], ['AAA010', 'AAA0000000010', 'ที่นอนอีกรุ่น'], ['BBB001', 'BBB0000000001', 'ท็อปเปอร์ AAA']];

  it('SKU ที่ขึ้นต้นตรงมาก่อน ชื่อที่มีคำนี้มาท้าย', () => {
    expect(S.skuSearch(SK, 'aaa0').map((s) => s[0])).toEqual(['AAA001', 'AAA010']);
    expect(S.skuSearch(SK, 'AAA').map((s) => s[0])).toEqual(['AAA001', 'AAA010', 'BBB001']);
    expect(S.skuSearch(SK, '')).toEqual([]);
    expect(S.skuExact(SK, ' aaa0000000010 ')[0]).toBe('AAA010');
    expect(S.skuExact(SK, 'AAA00')).toBe(null);
  });

  it('PO ขึ้นต้นด้วยที่พิมพ์ พร้อมชื่อ Supplier', () => {
    expect(S.poSearch([['9900000001', 'ก'], ['9900000012', 'ข'], ['1200000001', 'ค']], '990000001')).toEqual([['9900000012', 'ข']]);
    expect(S.poSearch([['9900000001', 'ก']], '9')).toEqual([]);
  });

  it('LOT 08 กับ 8 เทียบเท่ากัน', () => {
    expect(S.norm(' 08 ')).toBe(S.norm(8));
    expect(S.norm('lot  0')).toBe('LOT 0');
  });

  it('ลิงก์คนนับ: URL สคริปต์และรหัสอยู่หลัง # อ่านกลับได้ครบ', () => {
    const link = S.countLink('https://x.github.io/app/stocktake/count.html#old', 'https://script.google.com/macros/s/ABC/exec', 'nab', 'ST261115-1');
    expect(link.split('#')[0]).toBe('https://x.github.io/app/stocktake/count.html');
    expect(S.parseLink(link.split('#')[1])).toEqual({ url: 'https://script.google.com/macros/s/ABC/exec', key: 'nab', round: 'ST261115-1' });
    expect(S.countLink('p', 'u', '', 'r')).not.toContain('k=');
  });

  it('แถวสมุดหลังดึงยอด: แยกก่อนตัดยอด / วันตัดยอด / ระหว่างนับ', () => {
    const f = fakeFifo({ extraRows: [[0, 8, 0, 66, -1, 1, 2, 2, 8], [1, 8, 0, 67, -1, 1, 2, 5, 8], [2, 8, 0, -1, 0, 5, 0, -1, 0]] });
    f.days.push('2026-11-14', '2026-11-15');
    const lastRow = f.rows[f.rows.length - 4][0];
    const m = S.movesAfter(f, lastRow, '2026-11-14 18:00');
    expect(m.map((x) => x.when)).toEqual(['ก่อนตัดยอด', 'ระหว่างนับ', 'ไม่มีวันที่']);
    expect(m[0]).toMatchObject({ type: 'ขาย', qty: 1, sku: 'AAA001' });
  });
});

/* ── ขั้นที่ 2: วิเคราะห์ผลนับ ─────────────────────────────────────────────── */

describe('WmsStocktake.analyze — แยกกลุ่มปัญหา', () => {
  const SKUS = [
    ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1'], ['AAA002', 'AAA0000000002', 'ที่นอนสมมติ 2'],
    ['AAA008', 'AAA0000000008', 'ที่นอนสมมติ 8'], ['BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ'], ['CCC001', 'CCC0000000001', 'หมอนสมมติ'],
  ];
  const long = (s) => (SKUS.find((x) => x[0] === s) || [])[1] || s;
  const P = (loc, sku, lot, po, qty) => [loc, sku, long(sku), '', String(lot), po, qty, 0];
  const PILES2 = [
    P('R1-01-01', 'AAA001', 8, '9900000001', 10),
    P('R1-01-02', 'AAA002', 8, '9900000001', 6),
    P('R1-02-01', 'BBB001', 8, '9900000002', 5),
    P('R1-02-02', 'CCC001', 8, '9900000001', 12),
    P('R1-03-01', 'AAA001', 8, '9900000001', 4),
    P('A-01-02', 'AAA002', 8, '9900000001', 3),
    P('A-01-03', 'CCC001', 8, '9900000001', 2),
    P('RIB', 'AAA001', 8, '9900000001', 7),
  ];
  const LOCS2 = ['R1-01-01', 'R1-01-02', 'R1-02-01', 'R1-02-02', 'R1-03-01', 'A-01-01', 'A-01-02', 'A-01-03']
    .map((loc) => (loc[0] === 'R' ? { loc, zone: 'R', group: 'R1' } : { loc, zone: 'A', group: 'A-01' }));
  const T2 = [
    { pass: 1, id: 'INV1', kind: 'Inventory', name: 'ทีม 1', zones: ['R1'] },
    { pass: 1, id: 'INV2', kind: 'Inventory', name: 'ทีม 2', zones: ['A-01'] },
    { pass: 1, id: 'AUD1', kind: 'Audit', name: 'วิไล', zones: ['R1', 'A-01'] },
  ];
  let n = 0;
  const E = (o) => ({
    uid: o.uid || 'e' + (++n), ref: '', pass: 1, team: 'INV1', kind: 'Inventory', who: 'สมชาย', type: 'นับ', lot: '8', po: '9900000001',
    ...o, long: o.long !== undefined ? o.long : long(o.sku || ''),
  });
  const INV2 = { team: 'INV2', who: 'มานะ' };
  const AUD = { team: 'AUD1', kind: 'Audit', who: 'วิไล' };
  const ENTRIES = [
    E({ uid: 'u1', loc: 'R1-01-01', sku: 'AAA001', qty: 11 }),
    E({ loc: 'R1-01-01', sku: 'AAA001', qty: 10, ref: 'u1' }),                 // แก้ 11 → 10
    E({ loc: 'R1-01-01', sku: 'AAA001', qty: 10, ...INV2 }),                   // ทีมอื่นนับซ้ำ ไม่เอามารวม
    E({ loc: 'R1-01-02', sku: 'AAA002', lot: '9', qty: 6 }),
    E({ loc: 'R1-02-01', type: 'ว่าง', qty: 0, sku: '' }),
    E({ loc: 'R1-02-02', sku: 'CCC001', qty: 21 }),
    E({ loc: 'R1-03-01', sku: 'AAA008', qty: 4 }),
    E({ loc: 'A-01-01', sku: 'BBB001', po: '9900000002', qty: 5, ...INV2 }),
    E({ loc: 'A-01-01', sku: 'CCC001', lot: '9', qty: 3, ...INV2 }),
    E({ loc: 'A-01-02', sku: 'AAA002', qty: 1, ...INV2 }),
    E({ loc: 'A-01-02', sku: 'ZZZ999', long: '', qty: 1, ...INV2 }),
    E({ loc: 'R1-01-01', sku: 'AAA001', qty: 9, ...AUD }),
    E({ loc: 'A-01-02', sku: 'AAA002', qty: 1, ...AUD }),
    E({ loc: 'A-01-02', sku: 'ZZZ999', long: '', qty: 1, ...AUD }),
  ];
  let R;
  beforeAll(() => { R = S.analyze({ piles: PILES2, entries: ENTRIES, teams: T2, locs: LOCS2, skus: SKUS, skip: ['RIB'], pass: 1 }); });
  const at = (loc, sku, lot) => R.lines.find((l) => l.loc === loc && l.sku === sku && (lot === undefined || l.lot === String(lot)));

  it('นับตรงกับสมุด = ตรง ใช้ยอดที่แก้แล้ว และไม่บวกทีมอื่นที่นับซ้ำ', () => {
    expect(at('R1-01-01', 'AAA001')).toMatchObject({ group: 'ตรง', book: 10, inv: 10, diff: 0, team: 'INV1', who: ['สมชาย'] });
  });

  it('LOT/PO ผิด: SKU เดียวกันในโลเดียวกัน ย้าย LOT', () => {
    expect(at('R1-01-02', 'AAA002', 8)).toMatchObject({ group: 'LOT/PO ผิด', diff: -6 });
    expect(at('R1-01-02', 'AAA002', 9)).toMatchObject({ group: 'LOT/PO ผิด', diff: 6 });
    expect(at('R1-01-02', 'AAA002', 8).fix).toMatch(/ป้าย LOT\/PO/);
  });

  it('วางผิดโล: ขาดที่หนึ่ง เกินอีกที่ บอกโลคู่และวิธีแก้', () => {
    const s = at('R1-02-01', 'BBB001'), x = at('A-01-01', 'BBB001');
    expect(s).toMatchObject({ group: 'วางผิดโล', diff: -5 });
    expect(x).toMatchObject({ group: 'วางผิดโล', diff: 5 });
    expect(s.note).toContain('เจอที่ A-01-01 5');
    expect(s.fix).toContain('ลงสมุดย้าย R1-02-01 → A-01-01 × 5');
    expect(x.note).toContain('น่าจะมาจาก R1-02-01');
  });

  it('พิมพ์ผิด: จำนวนสลับหลัก SKU เกือบเหมือน และ SKU ที่ไม่มีในคลัง', () => {
    expect(at('R1-02-02', 'CCC001')).toMatchObject({ group: 'น่าจะพิมพ์ผิด', typo: 'จำนวน' });
    expect(at('R1-02-02', 'CCC001').fix).toContain('น่าจะเป็น 12');
    expect(at('R1-03-01', 'AAA008')).toMatchObject({ group: 'น่าจะพิมพ์ผิด' });
    expect(at('R1-03-01', 'AAA008').fix).toContain('น่าจะเป็น AAA001');
    expect(at('R1-03-01', 'AAA001')).toMatchObject({ group: 'น่าจะพิมพ์ผิด' });
    expect(at('R1-03-01', 'AAA001').fix).toContain('อาจกรอกเป็น AAA008');
    expect(at('A-01-02', 'ZZZ999')).toMatchObject({ group: 'น่าจะพิมพ์ผิด', typo: 'SKU' });
  });

  it('ที่อธิบายไม่ได้ = ขาด / เกิน', () => {
    expect(at('A-01-02', 'AAA002')).toMatchObject({ group: 'ขาด', diff: -2 });
    expect(at('A-01-01', 'CCC001')).toMatchObject({ group: 'เกิน', diff: 3 });
  });

  it('ยังไม่นับ: บอกทีมที่ต้องไป แถวที่ตั้งไม่นับไม่เอามาคิด', () => {
    expect(at('A-01-03', 'CCC001')).toMatchObject({ group: 'ยังไม่นับ', inv: null, book: 2 });
    expect(at('A-01-03', 'CCC001').fix).toBe('ส่ง ทีม 2 ไปนับ');
    expect(R.lines.some((l) => l.loc === 'RIB')).toBe(false);
  });

  it('Inv≠Audit แยกรายการ และนับว่าใครต่างกับ Audit บ่อย', () => {
    expect(R.audit).toHaveLength(1);
    expect(R.audit[0]).toMatchObject({ loc: 'R1-01-01', sku: 'AAA001', inv: 10, aud: 9, book: 10, auditor: ['วิไล'] });
    expect(R.people[0]).toMatchObject({ who: 'สมชาย', teamName: 'ทีม 1', checked: 1, bad: 1, pct: 100 });
    expect(R.people.find((p) => p.who === 'มานะ')).toMatchObject({ checked: 1, bad: 0, pct: 0 });
  });

  it('สรุปจำนวนต่อกลุ่ม จุดที่ผิดบ่อย และยอดรวม', () => {
    expect(R.counts['น่าจะพิมพ์ผิด'].n).toBe(4);
    expect(R.counts['วางผิดโล'].n).toBe(2);
    expect(R.counts['ยังไม่นับ'].locs).toBe(1);
    expect(R.hot[0]).toMatchObject({ row: 'R1', level: 1, n: 4 });
    expect(R.totals).toMatchObject({ locs: 8, counted: 7, book: 40, inv: 51, diff: 11 });
  });

  it('แถวผลสรุปลงชีต: ยอดสุดท้ายใช้ที่นับ โลที่ยังไม่นับใช้ยอดในสมุด Inv≠Audit ติดกลุ่มไว้', () => {
    const rows = S.summaryRows(R);
    const r1 = rows.find((r) => r[0] === 'R1-01-01' && r[1] === 'AAA001');
    expect(r1).toEqual(['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', '9900000001', 10, 10, 9, '', 10, 0, 'Inv≠Audit', 'Inventory 10 · Audit 9', 'ทีม 1', 'สมชาย']);
    const left = rows.find((r) => r[0] === 'A-01-03');
    expect(left.slice(6, 13)).toEqual([2, '', '', '', 2, 0, 'ยังไม่นับ']);
    expect(rows.every((r) => r.length === 16)).toBe(true);
  });

  it('แถวสมุดที่น่าสงสัย: แถวล่าสุดของ SKU นี้ที่เข้าออกโลนี้หรือโลคู่', () => {
    const fifo = {
      skus: [['BBB001', 'BBB0000000001', ''], ['AAA001', 'AAA0000000001', '']], pos: ['9900000002'],
      locs: ['R1-02-01', 'A-01-01', 'B-01-01'], days: ['2026-11-01'],
      rows: [[2, 0, 8, 0, -1, 0, 5, 0, 0, 10], [3, 1, 8, 0, -1, 0, 1, 0, 0, 8], [4, 0, 8, 0, 0, 1, 5, 1, 0, 8], [5, 0, 8, 0, -1, 2, 1, 0, 0, 8]],
    };
    const s = S.suspects(fifo, at('R1-02-01', 'BBB001'));
    expect(s.map((x) => x.row)).toEqual([4, 2]);
    expect(s[0]).toMatchObject({ type: 'เบิก', from: 'R1-02-01', to: 'A-01-01', qty: 5, date: '2026-11-01', po: '9900000002' });
  });
});

describe('WmsStocktake — หน้าตาพิมพ์ผิด', () => {
  it('จำนวน: สลับหลัก ศูนย์เกิน กดผิดหลักหน้า แต่หลักสุดท้ายหรือเลขหลักเดียวไม่นับ', () => {
    expect(S.qtyTypo(12, 21)).toBe(true);
    expect(S.qtyTypo(5, 50)).toBe(true);
    expect(S.qtyTypo(25, 85)).toBe(true);
    expect(S.qtyTypo(15, 12)).toBe(false);   // หลักสุดท้ายต่าง = ขาดจริงมากกว่า
    expect(S.qtyTypo(123, 132)).toBe(true);
    expect(S.qtyTypo(3, 8)).toBe(false);
    expect(S.qtyTypo(12, 30)).toBe(false);
    expect(S.qtyTypo(10, 10)).toBe(false);
  });

  it('SKU: ต่างกันหนึ่งตัว (สองตัวถ้ารหัสยาว)', () => {
    expect(S.similarCode('AAA001', 'AAA008')).toBe(true);
    expect(S.similarCode('AAA0000000001', 'AAA0000000010')).toBe(true);
    expect(S.similarCode('AAA001', 'BBB001')).toBe(false);
    expect(S.similarCode('AAA001', 'AAA001')).toBe(false);
  });
});
