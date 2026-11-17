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
import { loadStocktake, fakeFifo, loadStockApi, fakeStockTabs } from '../dev/fake-gas.js';

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
    expect(loadStocktake().get({})).toEqual({ app: 'stocktake', v: S.API_V });
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

  it('ปิดรอบผ่านการเปลี่ยนสถานะไม่ได้ ต้องอนุมัติด้วย st-close', () => {
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

describe('stocktake-api.gs — แผนรอบ 2 นับรอบ 2 และปิดรอบ', () => {
  const PLAN = [
    ['R1-01-01', 'R1', 'Inv≠Audit 1', 'INV2', ['สมชาย'], 'INV1', 'R'],
    ['B-09-09', 'B-09', 'หัวหน้าเพิ่ม', 'INV1', [], '', 'B'],
  ];
  const ROW = ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 10, 10, 9, 9, 9, -1, 'ขาด', 'ยอดจากรอบ 2', 'ทีม 2', 'มานะ'];
  const analyzing = (api) => { const id = ready(api); api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }); return id; };

  it('แผนรอบ 2: ทำได้หลังปิดรับรอบ 1 ทีมต้องเป็นทีม Inventory รอบ 1 โลซ้ำไม่ได้', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-plan', t: HEAD, round: id, plan: PLAN }).error).toMatch(/หลังปิดรับ/);
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' });
    expect(api.post({ op: 'st-plan', round: id, plan: PLAN }).error).toMatch(/รหัสหัวหน้า/);
    expect(api.post({ op: 'st-plan', t: HEAD, round: id, plan: [[...PLAN[0].slice(0, 3), 'AUD1', [], '', 'R']] }).error).toMatch(/ไม่มีทีม Inventory AUD1/);
    expect(api.post({ op: 'st-plan', t: HEAD, round: id, plan: [PLAN[0], PLAN[0]] }).error).toMatch(/ซ้ำ/);
  });

  it('บันทึกแผน: ทีมรอบนับ 2 ได้รายการโล คนเดิม ทีมรอบ 1 อยู่ครบ โลใหม่เพิ่มในแท็บ Location บันทึกซ้ำแทนชุดเดิม', () => {
    const api = loadStocktake();
    const id = analyzing(api);
    const res = api.post({ op: 'st-plan', t: HEAD, round: id, plan: PLAN, opts: { minQty: 2 }, by: 'หัวหน้าสมมติ' });
    expect(res.error).toBeUndefined();
    expect(res.plan).toEqual([['R1-01-01', 'R1', 'Inv≠Audit 1', 'INV2', ['สมชาย'], 'INV1'], ['B-09-09', 'B-09', 'หัวหน้าเพิ่ม', 'INV1', [], '']]);
    const t2 = res.teams.filter((t) => t.pass === 2);
    expect(t2).toEqual([
      expect.objectContaining({ id: 'INV2', kind: 'Inventory', name: 'ทีม 2', members: ['มานะ'], zones: ['R1-01-01'], locs: 1 }),
      expect.objectContaining({ id: 'INV1', kind: 'Inventory', name: 'ทีม 1', members: ['สมชาย', 'สมหญิง'], zones: ['B-09-09'], locs: 1 }),
    ]);
    expect(res.teams.filter((t) => t.pass === 1)).toHaveLength(3);
    expect(res.added).toBe(1);
    expect(api.ss.tab('Location').grid.find((r) => r[1] === 'B-09-09')).toEqual([id, 'B-09-09', 'B', 'B-09', 'รอบ 2']);
    expect(res.round.settings).toMatchObject({ r2: { minQty: 2 }, planRows: 2, planBy: 'หัวหน้าสมมติ', auditMin: 20 });
    const again = api.post({ op: 'st-plan', t: HEAD, round: id, plan: [PLAN[0]] });
    expect(again.plan).toHaveLength(1);
    expect(again.added).toBe(0);
    expect(again.teams.filter((t) => t.pass === 2).map((t) => t.id)).toEqual(['INV2']);
    expect(api.get({ api: 'st-head', t: HEAD, round: id }).plan).toHaveLength(1);
  });

  it('นับรอบ 2: ต้องมีแผนก่อน เปิดแล้วรอบนับเป็น 2 กลับไปนับรอบ 1 ไม่ได้ ปิดรับแล้วกลับมาวิเคราะห์ได้', () => {
    const api = loadStocktake();
    const id = analyzing(api);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 2' }).error).toMatch(/แผน/);
    api.post({ op: 'st-plan', t: HEAD, round: id, plan: PLAN });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 2' }).round).toMatchObject({ status: 'นับรอบ 2', pass: 2 });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).round).toMatchObject({ status: 'วิเคราะห์', pass: 2 });
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' }).error).toMatch(/รอบ 2/);
  });

  it('รอบ 2: คนที่นับโลนั้นในรอบ 1 ส่งไม่ได้ คนอื่นส่งได้ หน้ากรอกได้แค่โลกับชื่อที่ห้าม ไม่มีเหตุผล', () => {
    const api = loadStocktake();
    const id = analyzing(api);
    api.post({ op: 'st-plan', t: HEAD, round: id, plan: [['R1-01-01', 'R1', 'ขาด 3', 'INV1', ['สมชาย'], 'INV1', 'R']] });
    const it2 = (o) => item({ pass: 2, ...o });
    expect(api.post({ op: 'st-count', round: id, items: [it2({ uid: 'p2-0', who: 'สมหญิง' })] }).rejected[0].why).toMatch(/รอบนับ 2 ยังไม่เปิด/);
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 2' });
    const res = api.post({ op: 'st-count', round: id, items: [it2({ uid: 'p2-1', who: 'สมชาย' }), it2({ uid: 'p2-2', who: 'สมหญิง' }), item({ uid: 'p1-late', who: 'สมชาย' })] });
    expect(res.saved).toBe(2);
    expect(res.rejected).toEqual([{ uid: 'p2-1', why: 'สมชาย นับโล R1-01-01 ในรอบ 1 แล้ว ให้คนอื่นนับ' }]);
    const view = api.get({ api: 'st-round', round: id });
    expect(view.plan).toEqual([['R1-01-01', ['สมชาย']]]);
    expect(JSON.stringify(view)).not.toContain('ขาด 3');
    expect(view.teams.find((t) => t.pass === 2)).toMatchObject({ id: 'INV1', zones: ['R1-01-01'] });
  });

  it('ปิดรอบ: ต้องมีชื่อคนอนุมัติ ทำได้หลังปิดรับรอบ 1 เก็บยอดสุดท้ายในผลสรุป หน้าหัวหน้าได้ผลสรุปกลับไป', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-close', t: HEAD, round: id, approver: 'หัวหน้าสมมติ', lines: [ROW] }).error).toMatch(/หลังปิดรับ/);
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' });
    expect(api.post({ op: 'st-close', t: HEAD, round: id, lines: [ROW] }).error).toMatch(/ชื่อคนอนุมัติ/);
    expect(api.post({ op: 'st-close', t: HEAD, round: id, approver: 'หัวหน้าสมมติ', lines: [ROW.slice(0, 15)] }).error).toMatch(/16 ช่อง/);
    expect(api.post({ op: 'st-close', t: HEAD, round: id, approver: 'หัวหน้าสมมติ', lines: [] }).error).toMatch(/ไม่มียอดสุดท้าย/);
    const res = api.post({ op: 'st-close', t: HEAD, round: id, approver: 'หัวหน้าสมมติ', by: 'เครื่องหัวหน้า', lines: [ROW], totals: { lines: 1, adjLines: 1, book: 10, final: 9, plus: 0, minus: 1, net: -1, junk: 'x' } });
    expect(res.round).toMatchObject({ status: 'ปิดแล้ว', approvedBy: 'หัวหน้าสมมติ' });
    expect(res.round.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(res.round.settings.closeTotals).toEqual({ lines: 1, adjLines: 1, book: 10, final: 9, plus: 0, minus: 1, net: -1 });
    const head = api.get({ api: 'st-head', t: HEAD, round: id });
    expect(head.sum).toEqual([ROW]);
    expect(api.ss.tab('รอบนับ').grid[1].slice(15, 17)).toEqual(['หัวหน้าสมมติ', res.round.approvedAt]);
  });

  it('ปิดแล้ว: ส่งผลนับ แผน ทีม สถานะ ยอดตั้งต้น และอนุมัติซ้ำ ไม่ได้ทั้งหมด หน้ากรอกขึ้นว่าปิดแล้ว', () => {
    const api = loadStocktake();
    const id = analyzing(api);
    api.post({ op: 'st-close', t: HEAD, round: id, approver: 'หัวหน้าสมมติ', lines: [ROW] });
    expect(api.post({ op: 'st-count', round: id, items: [item({ uid: 'after' })] }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-plan', t: HEAD, round: id, plan: PLAN }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-teams', t: HEAD, round: id, pass: 1, teams: TEAMS }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-baseline', t: HEAD, round: id, piles: PILES }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-summary', t: HEAD, round: id, lines: [ROW] }).error).toMatch(/ปิดแล้ว/);
    expect(api.post({ op: 'st-close', t: HEAD, round: id, approver: 'คนอื่น', lines: [ROW] }).error).toMatch(/อนุมัติโดย หัวหน้าสมมติ/);
    expect(api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, id } }).error).toMatch(/ปิดแล้ว/);
    expect(api.get({ api: 'st-round', round: id }).round.status).toBe('ปิดแล้ว');
  });
});

describe('stocktake-api.gs — ใครเปิดโลไหนอยู่ (กันสองคนนับโลเดียวกัน)', () => {
  const op = (api, o) => api.post({ op: 'st-open', round: 'ST1', pass: 1, kind: 'Inventory', ...o });

  it('คนที่สองเปิดโลเดียวกัน เห็นคนแรก · คนแรกไม่เห็นตัวเอง', () => {
    const api = loadStocktake();
    expect(op(api, { device: 'd1', who: 'สมชาย', loc: 'r1-01-01' }).others).toEqual([]);
    expect(op(api, { device: 'd2', who: 'สมหญิง', loc: 'R1-01-01' }).others).toEqual([{ who: 'สมชาย', ago: 0 }]);
    expect(op(api, { device: 'd1', who: 'สมชาย', loc: 'R1-01-01' }).others).toEqual([{ who: 'สมหญิง', ago: 0 }]);
  });

  it('ไปโลอื่นหรือออกจากโล โลเดิมว่าง · คนละรอบนับ / Audit ไม่นับว่าซ้ำ · ชื่อเดียวกันสองเครื่องไม่เตือน', () => {
    const api = loadStocktake();
    op(api, { device: 'd1', who: 'สมชาย', loc: 'R1-01-01' });
    op(api, { device: 'd1', who: 'สมชาย', loc: 'R1-01-02' });
    expect(op(api, { device: 'd2', who: 'สมหญิง', loc: 'R1-01-01' }).others).toEqual([]);
    op(api, { device: 'd2', who: 'สมหญิง', loc: '' });
    expect(op(api, { device: 'd3', who: 'มานะ', loc: 'R1-01-01' }).others).toEqual([]);
    expect(op(api, { device: 'd4', who: 'วิไล', kind: 'Audit', loc: 'R1-01-02' }).others).toEqual([]);
    expect(op(api, { device: 'd5', who: 'ปรีชา', pass: 2, loc: 'R1-01-02' }).others).toEqual([]);
    expect(op(api, { device: 'd6', who: 'สมชาย', loc: 'R1-01-02' }).others).toEqual([]);
  });

  it('เปิดค้างเกิน 15 นาทีถือว่าออกไปแล้ว · บอกกี่นาทีก่อน · ไม่แตะชีต', () => {
    const api = loadStocktake();
    let t = 1_800_000_000_000;
    api.ctx.now_ = () => t;
    op(api, { device: 'd1', who: 'สมชาย', loc: 'R1-01-01' });
    t += 4 * 60000;
    expect(op(api, { device: 'd2', who: 'สมหญิง', loc: 'R1-01-01' }).others).toEqual([{ who: 'สมชาย', ago: 4 }]);
    t += 16 * 60000;
    expect(op(api, { device: 'd3', who: 'มานะ', loc: 'R1-01-01' }).others).toEqual([]);
    expect(api.lock.waits).toBe(0);
    expect(api.ss.getSheets().length).toBe(0);
  });

  it('ต้องมีรหัสลิงก์ถ้าตั้งไว้ และต้องบอกรอบกับเครื่อง', () => {
    expect(op(loadStocktake({ count: 'nab' }), { device: 'd1', loc: 'R1-01-01' }).error).toMatch(/ลิงก์นับไม่ถูก/);
    expect(op(loadStocktake(), { device: '', loc: 'R1-01-01' }).error).toBeTruthy();
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

  it('ทุกคำตอบบอกรุ่นสคริปต์ ตรงกับรุ่นที่หน้าเว็บต้องใช้ · ไม่มีเลขรุ่น = รุ่นเก่า', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.get({ api: 'st-round', round: id }).v).toBe(S.API_V);
    expect(api.get({ api: 'st-head', round: id, t: HEAD }).v).toBe(S.API_V);
    expect(api.post({ op: 'ไม่มี' })).toMatchObject({ error: expect.any(String), v: S.API_V });
    expect(S.oldScript(api.get({ api: 'st-round', round: id }))).toBe(null);
    expect(S.oldScript({ app: 'stocktake' })).toEqual({ have: 0, need: S.API_V });
    expect(S.oldScript({ v: S.API_V - 1 })).toEqual({ have: S.API_V - 1, need: S.API_V });
    expect(S.oldScript(null)).toBe(null);
  });

  it('PO เก็บ SKU กับ LOT ที่เคยรับ ส่งให้หน้ากรอกเป็นรายการ (ไม่มียอด) หัวตารางชีตเก่าถูกเขียนใหม่ให้ครบ', () => {
    const api = loadStocktake();
    const id = ready(api);
    const sheet = api.ss.getSheetByName('รายการสินค้า');
    sheet.getRange(1, 1, 1, 7).setValues([['รหัสรอบ', 'ชนิด', 'รหัส', 'รหัสเต็ม / Supplier', 'ชื่อสินค้า', '', '']]);
    api.post({ op: 'st-baseline', t: HEAD, round: id, piles: PILES, skus: [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ']],
      pos: [['9900000001', 'ผู้ผลิต ก สมมติ', ['AAA0000000001', 'BBB0000000001'], ['8', '9']], ['9900000002', '', [], []], ['9900000003', 'ค']] });
    const v = api.get({ api: 'st-round', round: id });
    expect(v.pos).toEqual([
      ['9900000001', 'ผู้ผลิต ก สมมติ', ['AAA0000000001', 'BBB0000000001'], ['8', '9']],
      ['9900000002', '', [], []],
      ['9900000003', 'ค', [], []],
    ]);
    expect(sheet.getRange(1, 1, 1, 7).getValues()[0].slice(5)).toEqual(['SKU ที่เคยรับ', 'LOT ที่เคยรับ']);
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
    expect(b.pos[0].slice(0, 2)).toEqual(['9900000001', 'sup-9900000001']);
    expect(b.locs.find((l) => l.loc === 'DOCKLOAD').piles).toBe(0);
  });

  it('PO บอก SKU กับ LOT ที่เคยรับ (ไม่มียอด) ทุกกองในสมุดอยู่ใน PO ของตัวเอง', () => {
    const b = S.baseline(fakeFifo());
    const po = new Map(b.pos.map((p) => [p[0], p]));
    expect(b.pos.every((p) => Array.isArray(p[2]) && Array.isArray(p[3]))).toBe(true);
    expect(b.pos[0][2].length).toBeGreaterThan(0);
    for (const p of b.piles.filter((x) => x[5])) {
      expect(po.get(p[5])[2], `${p[0]} ${p[2]} PO ${p[5]}`).toContain(p[2]);
      if (p[4]) expect(po.get(p[5])[3], `${p[0]} LOT ${p[4]} PO ${p[5]}`).toContain(p[4]);
    }
    expect(b.pos.flat(2).some((x) => typeof x === 'number')).toBe(false);
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

  it('ช่องกรอกที่ยังไม่ได้บันทึก: กองใหม่มีอะไรพิมพ์ไว้ / กองที่แก้ต่างจากเดิม', () => {
    const blank = { sku: '', long: '', lot: '', po: '', qty: '' };
    expect(S.formDirty(blank, null)).toBe(false);
    expect(S.formDirty({ ...blank, sku: '  ' }, null)).toBe(false);
    expect(S.formDirty({ ...blank, sku: 'AAA001' }, null)).toBe(true);
    expect(S.formDirty({ ...blank, qty: '5' }, null)).toBe(true);
    expect(S.formDirty(undefined, null)).toBe(false);
    const pile = { sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: '9900000001', qty: 10 };
    const same = { sku: 'aaa001', lot: ' 8', po: '9900000001', qty: '10' };
    expect(S.formDirty(same, pile)).toBe(false);
    expect(S.formDirty({ ...same, sku: 'AAA0000000001' }, pile)).toBe(false);
    expect(S.formDirty({ ...same, qty: '1,0' }, pile)).toBe(false);
    expect(S.formDirty({ ...same, qty: '12' }, pile)).toBe(true);
    expect(S.formDirty({ ...same, lot: '9' }, pile)).toBe(true);
    expect(S.formDirty({ ...same, po: '9900000002' }, pile)).toBe(true);
    expect(S.formDirty({ ...same, sku: 'BBB001' }, pile)).toBe(true);
  });

  it('เตือนตอนกรอก: ไม่ใส่ LOT / PO, ไม่มี PO นี้, PO ไม่เคยรับ SKU นี้, LOT ไม่ตรงกับ PO', () => {
    const SK = [['AAA001', 'AAA0000000001', 'ก'], ['BBB001', 'BBB0000000001', 'ข'], ['CCC001', 'CCC0000000001', 'ค']];
    const PO = [['9900000001', 'ผู้ผลิต ก', ['AAA0000000001', 'BBB0000000001'], ['8', '9']], ['9900000002', '', [], []]];
    const w = (o, typing) => S.pileWarn({ sku: 'AAA001', long: 'AAA0000000001', lot: '8', po: '9900000001', ...o }, PO, SK, typing);
    expect(w({})).toEqual([]);
    expect(w({ sku: 'aaa001', long: '', po: ' 9900000001 ' })).toEqual([]);
    expect(w({ lot: '', po: '' })).toEqual(['ไม่ได้ใส่ LOT และ PO (ไม่มีป้าย ให้ใส่ 0)']);
    expect(w({ lot: '' })).toEqual(['ไม่ได้ใส่ LOT (ไม่มีป้าย ให้ใส่ 0)']);
    expect(w({ po: '' })).toEqual(['ไม่ได้ใส่ PO (ไม่มีป้าย ให้ใส่ 0)']);
    expect(w({ lot: '', po: '' }, true)).toEqual([]);
    expect(w({ lot: '0', po: '0' })).toEqual([]);
    expect(w({ po: '9900000009' })).toEqual(['ไม่พบ PO 9900000009 ในสมุด']);
    expect(w({ po: '990' }, true)).toEqual([]);
    expect(w({ sku: 'CCC001', long: 'CCC0000000001' })).toEqual(['PO 9900000001 ไม่เคยรับ CCC001 (เคยรับ AAA001, BBB001)']);
    expect(w({ lot: '7' })).toEqual(['LOT 7 ไม่ตรงกับ PO 9900000001 (PO นี้มี LOT 8, 9)']);
    expect(w({ sku: 'CCC001', long: 'CCC0000000001', lot: '7' })).toHaveLength(2);
    expect(w({ sku: 'CCC001', long: 'CCC0000000001', po: '9900000002', lot: '1' })).toEqual([]);
    expect(S.pileWarn({ sku: 'X', lot: '1', po: '9900000001' }, [['9900000001', 'ก']], SK)).toEqual([]);
    expect(S.pileWarn({ sku: 'X', lot: '1', po: '1' }, [], SK)).toEqual([]);
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
    expect(link.split('#')[0]).toBe('https://x.github.io/app/stocktake/count.html?openExternalBrowser=1');
    expect(S.parseLink(link.split('#')[1])).toEqual({ url: 'https://script.google.com/macros/s/ABC/exec', key: 'nab', round: 'ST261115-1' });
    expect(S.countLink('p', 'u', '', 'r')).not.toContain('k=');
  });

  it('ลิงก์คนนับเปิดนอกแอป LINE: มี openExternalBrowser=1 ครั้งเดียว ต่อท้าย ? เดิมได้', () => {
    expect(S.countLink('https://x/count.html?a=1', 'u', 'k', 'r').split('#')[0]).toBe('https://x/count.html?a=1&openExternalBrowser=1');
    const twice = S.countLink(S.countLink('https://x/count.html', 'u', 'k', 'r'), 'u', 'k', 'r');
    expect(twice.split('#')[0].match(/openExternalBrowser/g)).toHaveLength(1);
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

  /* ── ขั้นที่ 3: แผนรอบ 2 ยอดสุดท้าย และไฟล์ปรับยอด ── */

  it('หลายคนนับโลเดียวกัน: ติดธงแยก Inventory / Audit ทีมอื่นที่ไม่เอามารวมไม่นับ', () => {
    expect(R.multi).toEqual([]);
    const R3 = S.analyze({ piles: PILES2, teams: T2, locs: LOCS2, skus: SKUS, skip: ['RIB'], pass: 1, entries: ENTRIES.concat([
      E({ loc: 'R1-03-01', sku: 'AAA001', qty: 1, who: 'สมหญิง' }),
      E({ loc: 'A-01-02', sku: 'AAA002', qty: 1, ...AUD, who: 'ปรีชา' }),
    ]) });
    expect(R3.multi).toHaveLength(2);
    expect(R3.multi).toEqual(expect.arrayContaining([
      { loc: 'R1-03-01', kind: 'Inventory', who: ['สมชาย', 'สมหญิง'] },
      { loc: 'A-01-02', kind: 'Audit', who: ['ปรีชา', 'วิไล'] },
    ]));
    const p = S.plan2(R3, { teams: T2, locs: LOCS2 });
    const r3 = p.locs.find((l) => l.loc === 'R1-03-01');
    expect(r3.tags).toContain('หลายคนนับ');
    expect(r3.why).toContain('หลายคนนับ (สมชาย, สมหญิง)');
    expect(p.locs.find((l) => l.loc === 'A-01-02').tags).not.toContain('หลายคนนับ');
    const off = S.plan2(R3, { teams: T2, locs: LOCS2, opts: { multi: false } });
    expect(off.opts.multi).toBe(false);
    expect(off.locs.find((l) => l.loc === 'R1-03-01').tags).not.toContain('หลายคนนับ');
  });

  describe('ขั้นที่ 3 — แผนรอบ 2', () => {
    const one = (p, loc) => p.locs.find((l) => l.loc === loc);

    it('ค่าเริ่มต้น: ทุกกลุ่มปัญหา ต่าง ≥ 1 ได้ทุกโลที่มีปัญหา พร้อมเหตุผลสั้น ๆ', () => {
      const p = S.plan2(R, { teams: T2, locs: LOCS2 });
      expect(p.opts).toMatchObject({ groups: S.GROUPS, minQty: 1, hotPct: 30, hotMin: 2 });
      expect(p.locs.map((l) => [l.loc, l.why])).toEqual([
        ['R1-01-01', 'Inv≠Audit 1'],
        ['R1-01-02', 'LOT/PO ผิด 6'],
        ['R1-02-01', 'วางผิดโล 5 คู่ A-01-01'],
        ['R1-02-02', 'น่าจะพิมพ์ผิด 9'],
        ['R1-03-01', 'น่าจะพิมพ์ผิด 4'],
        ['A-01-01', 'วางผิดโล 5 คู่ R1-02-01 · เกิน 3'],
        ['A-01-02', 'ขาด 2 · น่าจะพิมพ์ผิด 1'],
        ['A-01-03', 'ยังไม่นับ'],
      ]);
      expect(p.counts).toMatchObject({ all: 8, picked: 8, dropped: 0 });
      expect(p.warn).toEqual([]);
    });

    it('ทีมรอบ 2 ไม่ใช่ทีมที่นับรอบ 1 และห้ามคนที่นับโลนั้นในรอบ 1', () => {
      const p = S.plan2(R, { teams: T2, locs: LOCS2 });
      expect(one(p, 'R1-01-01')).toMatchObject({ r1team: 'INV1', team: 'INV2', forbid: ['สมชาย'] });
      expect(one(p, 'R1-02-01')).toMatchObject({ r1team: 'INV1', team: 'INV2', forbid: ['สมชาย'] });
      expect(one(p, 'A-01-01')).toMatchObject({ r1team: 'INV2', team: 'INV1', forbid: ['มานะ'] });
      expect(one(p, 'A-01-03')).toMatchObject({ r1team: 'INV2', team: 'INV1', forbid: [] });
      expect(p.locs.every((l) => l.team !== l.r1team)).toBe(true);
      expect(p.teams.map((t) => [t.id, t.pass, t.zones.length])).toEqual([['INV1', 2, 3], ['INV2', 2, 5]]);
    });

    it('ปรับค่าได้: ต่างน้อยไม่นับซ้ำ แถวที่ Audit ผิดบ่อยนับทั้งแถว ตัดออก เพิ่มเอง เลือกทีมเอง', () => {
      const p = S.plan2(R, { teams: T2, locs: LOCS2, opts: { minQty: 3, hotMin: 1, drop: ['r1-02-02'], add: ['B-01-01'], set: { 'A-01-03': 'INV2' } } });
      expect(one(p, 'A-01-02')).toBeUndefined();
      expect(one(p, 'R1-01-01').why).toBe('ทั้งแถว R1 (Audit ไม่ตรง 1/1 โล)');
      expect(one(p, 'R1-01-02').why).toBe('LOT/PO ผิด 6 · ทั้งแถว R1 (Audit ไม่ตรง 1/1 โล)');
      expect(one(p, 'R1-02-02')).toMatchObject({ drop: true, team: '' });
      expect(one(p, 'B-01-01')).toMatchObject({ why: 'หัวหน้าเพิ่ม', r1team: '', team: 'INV1' });
      expect(one(p, 'A-01-03')).toMatchObject({ team: 'INV2', auto: 'INV1' });
      expect(p.hot[0]).toMatchObject({ row: 'R1', checked: 1, bad: 1, pct: 100, on: true });
      expect(p.counts).toMatchObject({ all: 8, picked: 7, dropped: 1 });
      const rows = S.planRows(p);
      expect(rows).toHaveLength(7);
      expect(rows.find((r) => r[0] === 'A-01-03')).toEqual(['A-01-03', 'A-01', 'ยังไม่นับ', 'INV2', [], 'INV2', 'A']);
      expect(rows.some((r) => r[0] === 'R1-02-02')).toBe(false);
    });

    it('ค่าที่ส่งมาผิดใช้ค่าเริ่มต้น กลุ่มที่ไม่รู้จักตัดทิ้ง', () => {
      expect(S.r2Opts({ minQty: '', hotPct: 'x', hotMin: 0, groups: ['ขาด', 'อะไร'] })).toMatchObject({ minQty: 1, hotPct: 30, hotMin: 1, groups: ['ขาด'] });
      expect(S.plan2(R, { teams: T2, locs: LOCS2, opts: { groups: ['ยังไม่นับ'] } }).locs.map((l) => l.loc)).toEqual(['A-01-03']);
    });

    it('มีทีม Inventory ทีมเดียว: ใช้ทีมเดิม เตือน และบอกโลที่ทุกคนในทีมนับไปแล้ว', () => {
      const solo = [{ pass: 1, id: 'INV1', kind: 'Inventory', name: 'ทีม 1', members: ['สมชาย'], zones: ['R1', 'A-01'] }];
      const p = S.plan2(R, { teams: solo, locs: LOCS2 });
      expect(p.locs.every((l) => l.team === 'INV1')).toBe(true);
      expect(p.warn[0]).toMatch(/ทีมเดียว/);
      expect(p.warn).toContain('R1-01-01: ทุกคนใน ทีม 1 นับโลนี้ในรอบ 1 แล้ว เลือกทีมอื่น');
      expect(p.warn.some((w) => w.startsWith('A-01-01'))).toBe(false);
    });
  });

  describe('ขั้นที่ 3 — รอบ 2 ยอดสุดท้าย และไฟล์ปรับยอด', () => {
    let plan, planLocs, res2, fin;
    const R2E = { pass: 2, team: 'INV2', who: 'มานะ' }, R2F = { pass: 2, team: 'INV1', who: 'สมหญิง' };
    const E2 = () => [
      E({ loc: 'R1-01-01', sku: 'AAA001', qty: 9, ...R2E }),
      E({ loc: 'R1-02-01', type: 'ว่าง', qty: 0, sku: '', ...R2E }),
      E({ loc: 'R1-03-01', sku: 'AAA001', qty: 4, ...R2E }),
      E({ loc: 'A-01-01', sku: 'BBB001', po: '9900000002', qty: 5, ...R2F }),
      E({ loc: 'A-01-01', sku: 'CCC001', lot: '9', qty: 3, ...R2F }),
      E({ loc: 'A-01-03', sku: 'CCC001', qty: 2, ...R2F }),
    ];
    beforeAll(() => {
      plan = S.plan2(R, { teams: T2, locs: LOCS2 });
      planLocs = S.planRows(plan).map((r) => ({ loc: r[0], team: r[3] }));
      const entries = ENTRIES.concat(E2());
      res2 = S.analyze({ piles: PILES2, entries, teams: T2.concat(plan.teams), locs: planLocs, skus: SKUS, pass: 2, only: planLocs.map((l) => l.loc) });
      fin = S.finalLines(R, res2, planLocs, {});
    });
    const line = (loc, sku, lot) => fin.find((l) => l.loc === loc && l.sku === sku && (lot === undefined || l.lot === String(lot)));

    it('ความคืบหน้ารอบ 2 ตามแผนที่บันทึก แยกทีม บอกโลที่เหลือ', () => {
      const p = S.progress2(planLocs, ENTRIES.concat(E2()));
      expect(p).toMatchObject({ total: 8, done: 5, pct: 63, left: ['R1-01-02', 'R1-02-02', 'A-01-02'], extra: [] });
      expect(p.teams).toEqual([{ id: 'INV2', n: 5, done: 3, pct: 60 }, { id: 'INV1', n: 3, done: 2, pct: 67 }]);
    });

    it('รอบ 2 คิดเฉพาะโลในแผน ทีมรอบ 2 เป็นเจ้าของโลตามรายการโล', () => {
      expect(res2.lines.every((l) => planLocs.some((p) => p.loc === l.loc))).toBe(true);
      expect(res2.done).toEqual(['R1-01-01', 'R1-02-01', 'R1-03-01', 'A-01-01', 'A-01-03']);
      expect(res2.lines.find((l) => l.loc === 'R1-02-01')).toMatchObject({ group: 'วางผิดโล', team: 'INV2', who: ['มานะ'] });
    });

    it('ยอดสุดท้าย: นับรอบ 2 แล้วใช้รอบ 2 ทั้งโล ยังไม่นับรอบ 2 ใช้รอบ 1 และขึ้นว่าค้าง', () => {
      expect(fin).toHaveLength(12);
      expect(line('R1-01-01', 'AAA001')).toMatchObject({ book: 10, r1: 10, aud: 9, r2: 9, final: 9, adj: -1, src: 'รอบ 2', flag: 'สามค่าไม่ตรง', group: 'ขาด' });
      expect(line('R1-02-01', 'BBB001')).toMatchObject({ book: 5, r1: 0, r2: 0, final: 0, adj: -5, src: 'รอบ 2', flag: '', group: 'วางผิดโล' });
      expect(line('R1-03-01', 'AAA008')).toMatchObject({ book: 0, r1: 4, r2: 0, final: 0, adj: 0, group: 'ตรง' });
      expect(line('R1-01-02', 'AAA002', 9)).toMatchObject({ book: 0, r1: 6, r2: null, final: 6, adj: 6, src: 'รอบ 1', flag: 'ค้างรอบ 2', group: 'LOT/PO ผิด' });
      expect(line('A-01-03', 'CCC001')).toMatchObject({ book: 2, r1: null, r2: 2, final: 2, adj: 0, group: 'ตรง', flag: '' });
    });

    it('ไม่มีใครนับเลยใช้ยอดในสมุด ขึ้นว่าไม่ได้นับ', () => {
      const f2 = S.finalLines(R, res2, [], {});
      expect(f2.find((l) => l.loc === 'A-01-03')).toMatchObject({ r1: null, r2: null, final: 2, adj: 0, src: 'สมุด', flag: 'ไม่ได้นับ', group: 'ยังไม่นับ' });
      expect(f2.find((l) => l.loc === 'R1-01-01')).toMatchObject({ r2: null, src: 'รอบ 1', flag: '' });
    });

    it('หัวหน้าแก้ตัวเลขทับได้ ใส่ค่าเท่าที่ระบบคิดไม่นับว่าแก้', () => {
      const a = line('A-01-02', 'AAA002'), c = line('R1-02-02', 'CCC001'), x = line('R1-01-01', 'AAA001');
      const f2 = S.finalLines(R, res2, planLocs, { [a.id]: 2, [c.id]: 12, [x.id]: 9 });
      expect(f2.find((l) => l.id === a.id)).toMatchObject({ auto: 1, final: 2, adj: -1, src: 'หัวหน้าแก้', group: 'หัวหน้าแก้' });
      expect(f2.find((l) => l.id === c.id)).toMatchObject({ auto: 21, final: 12, adj: 0, src: 'หัวหน้าแก้', group: 'ตรง' });
      expect(f2.find((l) => l.id === x.id)).toMatchObject({ final: 9, src: 'รอบ 2' });
    });

    it('ยอดรวม: สมุด ยอดสุดท้าย ปรับเพิ่ม ปรับลด สุทธิ และนับธงแต่ละแบบ', () => {
      expect(S.finalTotals(fin)).toMatchObject({
        lines: 12, adjLines: 9, book: 42, final: 52, plus: 24, minus: 14, net: 10,
        src: { 'รอบ 2': 7, 'รอบ 1': 5 }, flag: { 'สามค่าไม่ตรง': 1, 'ค้างรอบ 2': 5 },
      });
    });

    it('แถวปิดรอบ 16 ช่อง: ยอดจากไหน ธง ทีมรอบ 2 และคนนับทั้งสองรอบ', () => {
      const rows = S.closeRows(fin, R.teamName);
      expect(rows.every((r) => r.length === 16)).toBe(true);
      expect(rows[0]).toEqual(['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', '9900000001', 10, 10, 9, 9, 9, -1, 'ขาด',
        'ยอดจากรอบ 2 · สามค่าไม่ตรง · ขาด 1', 'ทีม 2', 'รอบ 2: มานะ · รอบ 1: สมชาย']);
      expect(rows.find((r) => r[0] === 'A-01-03').slice(6, 12)).toEqual([2, '', '', 2, 2, 0]);
    });

    it('ไฟล์ปรับยอด: เฉพาะรายการที่ต้องปรับ จับคู่แก้ LOT/PO กับย้ายโล และสรุปพร้อมคนอนุมัติ', () => {
      const rows = S.closeRows(fin, R.teamName);
      const [adj, pairs, sum] = S.adjustBook(rows, { id: 'ST261115-1', name: 'นับใหญ่สมมติ', approvedBy: 'หัวหน้าสมมติ', approvedAt: '2026-11-16 09:00:00' });
      expect([adj.name, pairs.name, sum.name]).toEqual(['ปรับยอด', 'จับคู่ย้ายโล-แก้ LOT', 'สรุป']);
      expect(adj.aoa).toHaveLength(10);
      expect(adj.aoa[1].slice(0, 10)).toEqual(['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ 1', '8', '9900000001', 10, 9, -1, 'ปรับลด']);
      expect(pairs.aoa.slice(1)).toEqual([
        ['แก้ LOT/PO', 'R1-01-02', 'R1-01-02', 'AAA002', 'AAA0000000002', 'ที่นอนสมมติ 2', '8', '9900000001', '9', '9900000001', 6],
        ['ย้ายโล', 'R1-02-01', 'A-01-01', 'BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ', '8', '9900000002', '8', '9900000002', 5],
      ]);
      const kv = Object.fromEntries(sum.aoa.slice(1));
      expect(kv).toMatchObject({ 'อนุมัติโดย': 'หัวหน้าสมมติ', 'รายการทั้งหมด': 12, 'รายการที่ต้องปรับ': 9, 'ปรับเพิ่มรวม': 24, 'ปรับลดรวม': 14, 'สุทธิ': 10, 'จับคู่ย้ายโล': 1 });
      expect(S.adjustBook(rows, {})[2].aoa.find((r) => r[0] === 'อนุมัติโดย')[1]).toMatch(/ร่าง/);
      expect(sum.aoa.every((r) => r.length === 2) && adj.aoa.every((r) => r.length === 15)).toBe(true);
    });
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

/* หน้ามือถือ: ส่งผลนับเบื้องหลังเสร็จ (ราว 1.5 วิหลังเพิ่มกอง) เคยวาดทั้งหน้าใหม่ ช่องที่กำลังพิมพ์กองถัดไปหลุด คีย์บอร์ดหุบ */
describe('count.html — งานเบื้องหลังไม่วาดฟอร์มที่กำลังพิมพ์ใหม่', () => {
  const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
  const body = (name) => {
    const at = HTML.indexOf(`async function ${name}(`);
    expect(at, `ไม่มี ${name}()`).toBeGreaterThan(-1);
    return HTML.slice(at, HTML.indexOf('\n}\n', at));
  };
  for (const name of ['flush', 'pull']) {
    it(`${name}() วาดผ่าน bgPaint เท่านั้น`, () => {
      const src = body(name);
      expect(src).toMatch(/bgPaint\(\)/);
      expect(src).not.toMatch(/(^|[^a-zA-Z])paint\(\)/m);
    });
  }
  it('bgPaint ในหน้าโลแตะแค่รายการกองกับคำเตือน', () => {
    const at = HTML.indexOf('function bgPaint(');
    const src = HTML.slice(at, HTML.indexOf('\n}\n', at));
    expect(src).toMatch(/\$\('piles'\)/);
    expect(src).not.toMatch(/\$\('main'\)/);
  });
});

/* แป้นตัวเลขของหน้ามือถือ: ช่องจำนวนคูณ / บวกได้ และปุ่มเลือก PO / LOT จากยอดตั้งต้น */
describe('แป้นตัวเลข — คูณจำนวน และปุ่มเลือก PO / LOT', () => {
  it('qtyOf: ตัวเลขธรรมดา คูณ บวก จุลภาค และค่าที่ผิดรูป', () => {
    expect(S.qtyOf('12')).toBe(12);
    expect(S.qtyOf('1,250')).toBe(1250);
    expect(S.qtyOf('4×6×3')).toBe(72);
    expect(S.qtyOf('4x6')).toBe(24);
    expect(S.qtyOf('2.5*4')).toBe(10);
    expect(S.qtyOf(' 3 × 0.5 ')).toBe(1.5);
    expect(S.qtyOf('4×6×3+5'), 'คูณก่อนบวก').toBe(77);
    expect(S.qtyOf('10+2.5')).toBe(12.5);
    expect(S.qtyOf('2+3×4')).toBe(14);
    for (const bad of ['', '×', '4×', '×4', '4××6', 'abc', '4×a', '1.2.3', '+5', '5+', '5++2', '5+×2']) expect(S.qtyOf(bad), bad).toBeNaN();
  });
  it('formDirty: แก้กองแล้วพิมพ์จำนวนเป็นตัวคูณที่ได้ค่าเดิม ไม่นับว่าแก้', () => {
    const pile = { sku: 'AAA001', long: 'AAA0000000001', lot: '9', po: '9900000001', qty: 24 };
    expect(S.formDirty({ sku: 'AAA001', lot: '9', po: '9900000001', qty: '4×6' }, pile)).toBe(false);
    expect(S.formDirty({ sku: 'AAA001', lot: '9', po: '9900000001', qty: '4×7' }, pile)).toBe(true);
  });
  const skus = [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ'], ['BBB002', 'BBB0000000002', 'ท็อปเปอร์สมมติ']];
  const pos = [
    ['9900000001', 'ผู้ผลิต ก สมมติ', ['AAA0000000001'], ['8', '9']],
    ['9900000002', 'ผู้ผลิต ข สมมติ', ['AAA0000000001', 'BBB0000000002'], ['10']],
    ['9900000003', 'ผู้ผลิต ค สมมติ', ['BBB0000000002'], ['9']],
  ];
  it('poChoices: PO ที่เคยรับ SKU นี้ (พิมพ์ SKU สั้นหรือเต็มก็ได้) ใหม่สุดก่อน ใส่ LOT แล้วเหลือ PO ที่มี LOT นั้น', () => {
    expect(S.poChoices(pos, skus, 'AAA001', '')).toEqual([['9900000002', 'ผู้ผลิต ข สมมติ'], ['9900000001', 'ผู้ผลิต ก สมมติ']]);
    expect(S.poChoices(pos, skus, 'aaa0000000001', '').map((p) => p[0])).toEqual(['9900000002', '9900000001']);
    expect(S.poChoices(pos, skus, 'AAA001', '9').map((p) => p[0])).toEqual(['9900000001']);
    expect(S.poChoices(pos, skus, 'AAA001', '7').map((p) => p[0]), 'LOT ไม่ตรงสักใบ = ขึ้นทั้งหมด').toEqual(['9900000002', '9900000001']);
    expect(S.poChoices(pos, skus, '', '')).toEqual([]);
    expect(S.poChoices([['9900000001', 'ผู้ผลิต ก สมมติ']], skus, 'AAA001', ''), 'ยอดตั้งต้นแบบเก่า').toEqual([]);
  });
  it('lotChoices: ใส่ PO แล้ว = LOT ของ PO นั้น · ยังไม่ใส่ = LOT ทุกใบที่เคยรับ SKU นี้ เรียงตัวเลขใหม่สุดก่อน', () => {
    expect(S.lotChoices(pos, skus, 'AAA001', '9900000001')).toEqual(['9', '8']);
    expect(S.lotChoices(pos, skus, 'AAA001', '')).toEqual(['10', '9', '8']);
    expect(S.lotChoices(pos, skus, 'BBB002', '0')).toEqual(['10', '9']);
    expect(S.lotChoices(pos, skus, 'AAA001', '99'), 'PO ยังพิมพ์ไม่ครบ ใช้ตาม SKU').toEqual(['10', '9', '8']);
  });
});

/* ฉากเปิดแอปของหน้ามือถือ: คลิปกับภาพนิ่งต้องมีจริง และไฟล์เล็กพอโหลดผ่านเน็ตมือถือ */
describe('count.html — ฉากเปิดแอป', () => {
  const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
  it('คลิปและภาพนิ่งที่ชี้ไปมีไฟล์ ขนาดไม่เกิน 600 KB', () => {
    const v = HTML.match(/<video src="([^"]+)" poster="([^"]+)"/);
    expect(v, 'ไม่มีวิดีโอเปิดแอป').not.toBe(null);
    for (const rel of [v[1], v[2]]) {
      const file = path.resolve(__dirname, '../../public/stocktake', rel);
      expect(fs.existsSync(file), `ไม่มีไฟล์ ${rel}`).toBe(true);
      expect(fs.statSync(file).size, `${rel} ใหญ่เกิน`).toBeLessThan(600 * 1024);
    }
  });
  it('ขึ้นครั้งเดียวต่อแท็บ และไม่ขึ้นเมื่อเครื่องตั้งลดการเคลื่อนไหว', () => {
    expect(HTML).toMatch(/sessionStorage\.getItem\('wms:st:intro'\)/);
    expect(HTML).toMatch(/prefers-reduced-motion: reduce\)'\)\.matches\) document\.documentElement\.classList\.add\('intro'\)/);
  });
});

/* ปุ่มที่น้อง ๆ ขอหลังลองใช้: สแกนบาร์โค้ดช่อง SKU (มีไว้เผื่อ) · เพิ่มโล (ของวางผิดที่ / โลที่ไม่มีในรายการ) */
describe('count.html — สแกนบาร์โค้ดกับเพิ่มโล', () => {
  const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
  const locs = [['R1-01-01', 'R1'], ['R1-01-02', 'R1'], ['R1-02-01', 'R1'], ['A-01-01', 'A-01'], ['A-01-02', 'A-01'], ['QA', 'QA']];
  const teams = [
    { id: 'INV1', pass: 1, kind: 'Inventory', name: 'ทีม 1', zones: ['R1'] },
    { id: 'AUD1', pass: 1, kind: 'Audit', name: 'Audit 1', zones: ['R1', 'A-01'] },
    { id: 'INV2', pass: 1, kind: 'Inventory', name: 'ทีม 2', zones: ['A-01'] },
    { id: 'R2T1', pass: 2, kind: 'Inventory', name: 'รอบ 2 ทีม 1', zones: ['QA'] },
  ];
  const chk = (q, team = 'INV1', pass = 1) => S.locCheck(q, locs, teams, team, pass);

  it('locCheck: ในรายการของทีมตัวเอง = mine', () => {
    expect(chk('r1-01-02')).toMatchObject({ loc: 'R1-01-02', kind: 'mine', team: '' });
    expect(chk('A-01-01', 'AUD1').kind, 'Audit มีแถวนี้ด้วย').toBe('mine');
  });
  it('locCheck: มีในคลังแต่เป็นของทีมอื่น = other บอกชื่อทีม Inventory ก่อน Audit', () => {
    expect(chk('A-01-02')).toMatchObject({ kind: 'other', team: 'ทีม 2' });
    expect(chk('QA'), 'รอบ 2 ไม่นับว่าเป็นเจ้าของในรอบ 1').toMatchObject({ kind: 'other', team: '' });
  });
  it('locCheck: ไม่มีในคลัง แยกชื่อรูปแบบโลจริง (new) กับพิมพ์มั่ว (odd)', () => {
    expect(chk('R9-01-01').kind).toBe('new');
    expect(chk('ZZZ').kind).toBe('odd');
    expect(chk('R').kind, 'พิมพ์ไม่ถึง 2 ตัว').toBe('');
  });
  it('locCheck: ปุ่มโลที่ขึ้นต้นเหมือนกัน เรียงตามทางเดิน ไม่ซ้ำกับที่พิมพ์ตรงตัว', () => {
    expect(chk('R1-0').sug).toEqual(['R1-01-01', 'R1-01-02', 'R1-02-01']);
    expect(chk('R1-01-01').sug).toEqual([]);
    expect(S.locCheck('R1', locs, teams, 'INV1', 1, 2).sug).toHaveLength(2);
  });
  it('scanSku: ตรงกับ SKU เต็ม → ใส่ SKU สั้น · ไม่พบ = ใส่ค่าที่อ่านได้ · ตัดตัวคั่นที่มองไม่เห็น', () => {
    const skus = [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ'], ['', '8850000000017', 'ของแถมสมมติ']];
    expect(S.scanSku(' AAA0000000001\n', skus)).toMatchObject({ code: 'AAA0000000001', sku: 'AAA001' });
    expect(S.scanSku('\u001d8850000000017', skus).sku, 'ไม่มี SKU สั้น ใช้ SKU เต็ม').toBe('8850000000017');
    expect(S.scanSku('08850000000017', skus).hit, 'UPC ที่มี 0 นำหน้า').not.toBe(null);
    expect(S.scanSku('4900000000000', skus)).toMatchObject({ code: '4900000000000', sku: '4900000000000', hit: null });
  });
  it('ปุ่มสแกนขึ้นเฉพาะเครื่องที่มีกล้อง ตัวอ่านสำรองล็อกเวอร์ชัน โหลดตอนกดเท่านั้น', () => {
    expect(HTML).toMatch(/\$\{CAM \? `<button type="button" class="ct-scanbtn" data-act="scan"/);
    expect(HTML).toMatch(/const SCAN_LIB = 'https:\/\/cdn\.jsdelivr\.net\/npm\/barcode-detector@\d+\.\d+\.\d+\/dist\/es\/ponyfill\.js'/);
    expect(HTML).not.toMatch(/<script[^>]+barcode-detector/);
    expect(HTML, 'ปิดกล้องตอนสลับแอป').toMatch(/document\.hidden && OV === 'scan'\) scanClose\(\)/);
  });
  it('ปุ่มเพิ่มโลขึ้นเฉพาะรอบ 1 (รอบ 2 นับเฉพาะโลที่แตกต่าง)', () => {
    expect(HTML).toMatch(/\$\{ME\.pass < 2 \? '<button type="button" class="ct-btn" data-act="addloc">\+ เพิ่มโล<\/button>' : ''\}/);
    for (const act of ['scan', 'scan-close', 'scan-torch', 'addloc', 'addloc-close', 'addloc-go']) expect(HTML, act).toContain(`case '${act}':`);
  });
});

/* เปลี่ยนทีม/ชื่อ กับ โหลดรายการใหม่ เคยอยู่ท้ายรายการโล ต้องเลื่อนลงไปหา ย้ายขึ้นแถบบนที่ติดจอ */
describe('count.html — ปุ่มเปลี่ยนทีม/โหลดใหม่อยู่แถบบน', () => {
  const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
  const top = HTML.slice(HTML.indexOf('function paintTop('), HTML.indexOf('\n}\n', HTML.indexOf('function paintTop(')));
  it('แถบบนมีชื่อที่แตะเปลี่ยนทีมได้ (หน้ารายการโล) กับปุ่มโหลดใหม่ (ไม่ขึ้นในหน้าโล)', () => {
    expect(top).toMatch(/t && VIEW === 'list'\s*\? `<button type="button" class="sw" data-act="who"/);
    expect(top).toMatch(/RD && VIEW !== 'loc' \? `<button type="button" class="ct-ico[^`]*data-act="reload"/);
  });
  it('ท้ายรายการโลไม่มีปุ่มซ้ำแล้ว · หน้าเลือกทีมมีปุ่มกลับไปนับต่อ', () => {
    expect(HTML).not.toMatch(/<div class="ct-foot"><button[^>]*data-act="who"/);
    expect(HTML).toContain("case 'who-cancel':");
  });
});

/* หน้างานเดินไม่ตรงลำดับในรายการ: เสร็จโลแล้วกลับไปรายการให้เลือกโลต่อเอง ระบบไม่เปิดโลถัดไปให้ */
describe('count.html — เสร็จโลแล้วเลือกโลต่อเอง', () => {
  const HTML = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
  const fn = (name) => {
    const at = HTML.indexOf(`function ${name}(`);
    expect(at, `ไม่มี ${name}()`).toBeGreaterThan(-1);
    return HTML.slice(at, HTML.indexOf('\n}\n', at));
  };
  it('ปุ่มล่างเป็น "เสร็จโลนี้" ไม่มี "โลถัดไป" และไม่มีโค้ดเปิดโลถัดไปเองแล้ว', () => {
    expect(fn('locBottom')).toContain('data-act="next">เสร็จโลนี้ ✓</button>');
    expect(HTML).not.toMatch(/โลถัดไป<\/button>/);
    expect(HTML).not.toMatch(/function nextLoc\(|nextLoc\(\)/);
    expect(fn('toList'), 'กลับรายการเสมอ ไม่เปิดโลอื่น').not.toMatch(/openLoc\(/);
  });
  it('เสร็จโล / โลนี้ว่าง / ปุ่มกลับ ไปที่รายการแล้วเลื่อนมาที่โลที่เพิ่งออกมา', () => {
    /* บันทึกกองที่พิมพ์ค้างก่อน (รอบ MFG ถาม SKU ที่ควรมีแต่ยังไม่กรอกตรงกลาง) แล้วกลับรายการ */
    expect(fn('doneLoc')).toMatch(/if \(!keepTyped\(\)\) return;/);
    expect(fn('doneLoc')).toMatch(/\n {2}toList\(loc\); cheer\(loc, before\);$/);
    expect(HTML).toMatch(/push\('ว่าง', \{\}\); toList\(loc\); cheer\(loc, before\);/);
    expect(HTML).toMatch(/case 'back': if \(VIEW !== 'loc' \|\| keepTyped\(\)\) toList\(LOC\); break;/);
    expect(fn('toList')).toMatch(/row\.scrollIntoView\(\{ block: 'center' \}\)/);
  });
  it('โลที่เพิ่งเสร็จยังโชว์ในรายการ "เหลือ" พร้อมแถบ (ยกเว้นนับครบแล้ว ให้ขึ้นข้อความนับครบ)', () => {
    const lv = fn('listView');
    expect(lv).toMatch(/const keep = \(l\) => l\.loc === NEAR && left > 0;/);
    expect(lv).toMatch(/!st\[l\.loc\] \|\| keep\(l\)/);
    expect(lv).toMatch(/ct-loc\$\{l\.loc === NEAR \? ' near' : ''\}/);
    expect(HTML).toMatch(/\.ct-loc\.near\{/);
  });
});

/* ลบรอบ: รอบทดลอง / ตั้งผิด หัวหน้าลบได้ ต้องพิมพ์ชื่อรอบยืนยัน รอบอื่นต้องไม่โดนแตะ และมือถือที่เปิดลิงก์เก่าต้องไม่เห็นของค้าง */
describe('ลบรอบ (st-round-del)', () => {
  const SUM = ['R1-01-01', 'AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', 10, 9, '', '', 9, -1, 'ขาด', 'ขาด 1', 'ทีม 1', 'สมชาย'];
  const of = (api, tab, id, col = 0) => api.ss.tab(tab).grid.slice(1).filter((r) => r && r[col] === id).length;
  const SETS = ['ทีมและโซน', 'Location', 'ยอดตั้งต้น', 'รายการสินค้า', 'ผลสรุป'];

  it('ต้องเป็นหัวหน้า และพิมพ์ชื่อรอบตรงทุกตัว', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-round-del', round: id, confirm: ROUND.name }).error).toMatch(/รหัสหัวหน้า/);
    expect(api.post({ op: 'st-round-del', t: HEAD, round: id, confirm: 'นับใหญ่' }).error).toMatch(/ไม่ตรง/);
    expect(api.post({ op: 'st-round-del', t: HEAD, round: id }).error).toMatch(/ไม่ตรง/);
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds.map((r) => r.id)).toEqual([id]);
  });

  it('เอาแถวของรอบนี้ออกทุกแท็บ รอบอื่นอยู่ครบ · ไม่ขึ้นในรายการรอบ · ลิงก์เก่าขึ้นว่าถูกลบ ส่งผลนับไม่ได้', () => {
    const api = loadStocktake();
    const a = ready(api), b = ready(api);
    api.post({ op: 'st-count', round: a, items: [item({ uid: 'a1' }), item({ uid: 'a2', loc: 'R1-01-02' })] });
    api.post({ op: 'st-count', round: b, items: [item({ uid: 'b1' })] });
    api.post({ op: 'st-summary', t: HEAD, round: a, lines: [SUM] });
    api.post({ op: 'st-summary', t: HEAD, round: b, lines: [SUM] });
    const res = api.post({ op: 'st-round-del', t: HEAD, round: a, confirm: ` ${ROUND.name} `, by: 'หัวหน้าสมมติ' });
    expect(res).toMatchObject({ deleted: a, inPlace: true });
    expect(res.rows['บันทึกนับ']).toBe(2);
    for (const tab of SETS) {
      expect(of(api, tab, a), tab).toBe(0);
      expect(of(api, tab, b), tab).toBeGreaterThan(0);
    }
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds.map((r) => r.id)).toEqual([b]);
    expect(api.get({ api: 'st-round', round: a }).error).toMatch(/ถูกหัวหน้าลบแล้ว/);
    expect(api.get({ api: 'st-head', t: HEAD, round: a }).error).toMatch(/ถูกหัวหน้าลบแล้ว/);
    expect(api.post({ op: 'st-count', round: a, items: [item({ uid: 'a3' })] }).error).toMatch(/ถูกหัวหน้าลบแล้ว/);
    expect(api.post({ op: 'st-round-del', t: HEAD, round: a, confirm: ROUND.name }).error, 'ลบซ้ำ').toMatch(/ถูกหัวหน้าลบแล้ว/);
    const row = api.ss.tab('รอบนับ').grid.slice(1).find((r) => r[0] === a);
    expect(row[4]).toBe('ลบแล้ว');
    expect(row[13]).toBe('หัวหน้าสมมติ');
  });

  it('บันทึกนับตอนมีรอบอื่นเปิดอยู่: ล้างในที่เดิม เลขแถวของรอบนั้นไม่ขยับ หน้ากรอกที่อ่านต่อจากแถวเดิมไม่พลาดแถวใหม่', () => {
    const api = loadStocktake();
    const a = ready(api), b = ready(api);
    api.post({ op: 'st-count', round: b, items: [item({ uid: 'b1' })] });
    api.post({ op: 'st-count', round: a, items: [item({ uid: 'a1' }), item({ uid: 'a2', loc: 'R1-01-02' })] });
    const seen = api.get({ api: 'st-mine', round: b, team: 'INV1', since: 0 });
    expect(seen.last).toBe(4);
    api.post({ op: 'st-round-del', t: HEAD, round: a, confirm: ROUND.name });
    const log = api.ss.tab('บันทึกนับ');
    expect(log.getLastRow(), 'แถวท้ายของรอบที่ลบไม่หาย').toBe(4);
    expect(log.grid[2][0]).toBe('ลบแล้ว');
    expect(log.grid[2].slice(1).every((v) => v === '')).toBe(true);
    api.post({ op: 'st-count', round: b, items: [item({ uid: 'b2', loc: 'R1-01-02' })] });
    const next = api.get({ api: 'st-mine', round: b, team: 'INV1', since: seen.last });
    expect(next.rows.map((r) => r[14])).toEqual(['b2']);
    expect(next.rows[0][0], 'ต่อท้ายแถว 4 ไม่ทับ').toBe(5);
  });

  it('ไม่มีรอบไหนเปิดอยู่: เอาแถวออกจริง · รอบที่ปิดแล้วก็ลบได้ · รหัสรอบไม่ถูกใช้ซ้ำ', () => {
    const api = loadStocktake();
    const a = ready(api);
    api.post({ op: 'st-count', round: a, items: [item({ uid: 'a1' }), item({ uid: 'a2', loc: 'R1-01-02' })] });
    api.post({ op: 'st-status', t: HEAD, round: a, status: 'วิเคราะห์' });
    api.post({ op: 'st-close', t: HEAD, round: a, approver: 'หัวหน้าสมมติ', lines: [SUM] });
    const res = api.post({ op: 'st-round-del', t: HEAD, round: a, confirm: ROUND.name });
    expect(res).toMatchObject({ deleted: a, inPlace: false });
    expect(api.ss.tab('บันทึกนับ').getLastRow(), 'เหลือแค่หัวตาราง').toBe(1);
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds).toEqual([]);
    const fresh = ready(api);
    expect(fresh).not.toBe(a);
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds.map((r) => r.id)).toEqual([fresh]);
  });

  it('ตั้งสถานะ "ลบแล้ว" ผ่าน st-status ไม่ได้', () => {
    const api = loadStocktake();
    const id = ready(api);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'ลบแล้ว' }).error).toBeTruthy();
    expect(api.get({ api: 'st-rounds', t: HEAD }).rounds).toHaveLength(1);
  });

  it('หน้าเว็บ: ปุ่มลบกดได้เมื่อพิมพ์ชื่อตรง · หน้ากรอกไม่ใช้ข้อมูลที่โหลดไว้ของรอบที่ถูกลบ', () => {
    const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');
    const CNT = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
    expect(IDX).toMatch(/data-act="del-go" disabled/);
    expect(IDX).toMatch(/g\.disabled = !!S\.old \|\| e\.target\.value\.trim\(\) !== r\.name/);
    expect(IDX).toMatch(/op: 'st-round-del', round: r\.id, confirm: typed/);
    expect(CNT).toMatch(/if \(\/ถูกหัวหน้าลบแล้ว\/\.test\(e\.message\)\) \{ RD = null;/);
  });
});

/*
 * นับ 2 วัน: วันแรกนับ R กับโลปิด (Outbound ยังส่งของจากโลเปิด) วันที่ 2 นับ S, A, B กับโลเปิด ตอนสต๊อกนิ่ง
 * ตัดยอดเช้าวันที่ 2 ครั้งเดียว โลวันแรกที่มีรายการในสมุดหลังเริ่มนับต้องนับใหม่
 */
describe('นับ 2 วัน', () => {
  const D2 = { zones: ['A'], locs: [], openToo: 0 };
  const day2 = (o) => S.day2Of({ day2: { ...D2, ...o } });

  it('day2Of / day2Test: ทั้งโซน + โลเปิดที่ระบุ · ไม่ได้ตั้ง = นับวันเดียว', () => {
    expect(S.day2Of({})).toBe(null);
    expect(S.day2Of({ day2: { zones: [], locs: [] } })).toBe(null);
    const d = S.day2Of({ day2: { zones: ['s', 'A', 'B'], locs: ['c-01-02'], openToo: 1, row1: 500 } });
    expect(d).toMatchObject({ zones: ['S', 'A', 'B'], locs: ['C-01-02'], row1: 500, on: 0, moved: [] });
    const is = S.day2Test(d);
    expect(['S-01-01', 'A-01-01', 'B-02-03', 'C-01-02'].every(is)).toBe(true);
    expect(['R1-01-01', 'C-01-03', 'D-01-01', 'QA', ''].some(is)).toBe(false);
    expect(S.day2Test(null)('A-01-01')).toBe(false);
  });

  it('day2Wait: ก่อนเปิดวันที่ 2 โลวันที่ 2 ยังนับไม่ได้ · เปิดแล้วนับได้ทุกโล', () => {
    expect(S.day2Wait(day2())('A-01-01')).toBe(true);
    expect(S.day2Wait(day2())('R1-01-01')).toBe(false);
    expect(S.day2Wait(day2({ on: 1, at: 5 }))('A-01-01')).toBe(false);
    expect(S.day2Wait(null)('A-01-01')).toBe(false);
  });

  it('day2Plan: โลเปิดขายนอกโซนที่เลือก นับวันที่ 2 ด้วย · โลปิดกับโลว่างเป็นวันแรก', () => {
    const piles = [
      ['C-01-02', 'AAA001', 'AAA0000000001', 'สมมติ', '8', '9900000001', 5, 1],
      ['C-01-02', 'BBB001', 'BBB0000000001', 'สมมติ', '8', '9900000001', 5, 0],
      ['C-01-03', 'AAA001', 'AAA0000000001', 'สมมติ', '8', '9900000001', 5, 0],
      ['A-01-01', 'AAA001', 'AAA0000000001', 'สมมติ', '8', '9900000001', 5, 1],
      ['D-02-01', 'AAA001', 'AAA0000000001', 'สมมติ', '8', '9900000001', 5, 1],
    ];
    expect(S.day2Plan(piles, ['s', 'A', 'B', 'A'], true)).toEqual({ zones: ['S', 'A', 'B'], locs: ['C-01-02', 'D-02-01'], openToo: 1 });
    expect(S.day2Plan(piles, ['A'], false)).toEqual({ zones: ['A'], locs: [], openToo: 0 });
  });

  it('voidMoved: โลวันแรกที่ขยับ ผลนับก่อนเปิดวันที่ 2 ไม่ใช้ · นับใหม่หลังเปิดอยู่ครบ · โลอื่นไม่โดน', () => {
    const at = Date.parse('2026-11-16T08:00:00+07:00');
    const d = day2({ on: 1, at, moved: ['R1-01-01'] });
    const e = (o) => ({ uid: o.uid, loc: 'R1-01-01', type: 'นับ', at: at - 20 * 3600000, clientAt: new Date(at - 20 * 3600000).toISOString(), ...o });
    const rows = [
      e({ uid: 'day1' }),
      e({ uid: 'other', loc: 'R1-01-02' }),
      e({ uid: 'late', at: at + 60000 }),                                              // นับวันแรก เครื่องออฟไลน์ ส่งถึงชีตวันที่ 2
      e({ uid: 'day2', at: at + 3600000, clientAt: new Date(at + 3590000).toISOString() }),
      e({ uid: 'skew', at: at + 600000, clientAt: new Date(at - 5 * 60000).toISOString() }),   // นาฬิกามือถือช้า 5 นาที
      e({ uid: 'local', at: new Date(at + 7200000).toISOString(), clientAt: undefined }),      // แถวในเครื่องยังไม่ได้ส่ง
      e({ uid: 'just', at: at - 60000, clientAt: new Date(at - 60000).toISOString() }),        // ชีตรับก่อนเปิดวันที่ 2 นาทีเดียว = ยังเป็นของวันแรก
    ];
    expect(S.voidMoved(rows, d).map((x) => x.uid)).toEqual(['other', 'day2', 'skew', 'local']);
    expect(S.voidMoved(rows, day2({ moved: ['R1-01-01'] })), 'ยังไม่เปิดวันที่ 2').toHaveLength(7);
    expect(S.voidMoved(rows, null)).toHaveLength(7);
  });

  it('day2Moved: แถวสมุดหลังเริ่มวันแรกที่แตะโลวันแรก = นับใหม่ · ขายจากโลเปิด (โลวันที่ 2) ไม่นับ', () => {
    const fifo = {
      skus: [['AAA001', 'AAA0000000001', 'ที่นอนสมมติ']], pos: ['9900000001'], days: ['2026-11-15'],
      locs: ['R1-01-01', 'R1-01-02', 'A-01-01', 'C-01-02', 'C-01-03', 'DOCKLOAD'],
      rows: [
        [500, 0, 8, 0, -1, 0, 10, 0, 0, 8],     // ก่อนเริ่มวันแรก
        [501, 0, 8, 0, 2, -1, 1, 2, 0, 8],      // ขายจาก A-01-01 (วันที่ 2) ปกติ
        [502, 0, 8, 0, 3, -1, 1, 2, 0, 8],      // ขายจาก C-01-02 (โลเปิด วันที่ 2) ปกติ
        [503, 0, 8, 0, 0, 2, 2, 1, 0, 9],       // เบิกจาก R1-01-01 ไปเติม A-01-01 → R1-01-01 ขยับ
        [504, 0, 8, 0, -1, 4, 3, 0, 0, 8],      // รับเข้า C-01-03 (โลปิด วันแรก) → ขยับ
        [505, 0, 8, 0, 4, 5, 1, 1, 0, 8],       // C-01-03 → DOCKLOAD (ไม่อยู่ในรายการนับ)
      ],
    };
    const d = S.day2Of({ day2: { zones: ['A'], locs: ['C-01-02'], row1: 500 } });
    const names = ['R1-01-01', 'R1-01-02', 'A-01-01', 'C-01-02', 'C-01-03'];
    const moved = S.day2Moved(fifo, d, names);
    expect(moved.map((m) => m.loc), 'เรียงตามทางเดิน').toEqual(['R1-01-01', 'C-01-03']);
    expect(moved[1].rows.map((r) => r.row)).toEqual([504, 505]);
    expect(S.day2Moved(fifo, S.day2Of({ day2: { zones: ['A'] } }), names), 'ยังไม่รู้แถวเริ่มวันแรก').toEqual([]);
  });

  it('analyze: โลที่รอวันที่ 2 ยังไม่เอามาคิด ทั้งยอดในสมุดและรายการโล · เปิดวันที่ 2 แล้วคิดครบ', () => {
    const piles = [PILES[0], PILES[1], PILES[2]];
    const locs = LOCS.map((l) => ({ loc: l[0], zone: l[1], group: l[2] }));
    const run = (d) => S.analyze({ piles, entries: [], teams: TEAMS.map((t) => ({ ...t, pass: 1 })), locs, skus: [], pass: 1, day2: d });
    const locsOf = (res) => [...new Set(res.lines.map((l) => l.loc))].sort();
    expect(locsOf(run(null))).toEqual(['A-01-01', 'A-01-02', 'R1-01-01', 'R1-01-02']);
    expect(locsOf(run(day2()))).toEqual(['R1-01-01', 'R1-01-02']);
    expect(locsOf(run(day2({ on: 1, at: 5 })))).toEqual(['A-01-01', 'A-01-02', 'R1-01-01', 'R1-01-02']);
  });

  /* ── สคริปต์ ── */
  const set = (api, id, d) => api.post({ op: 'st-day2', t: HEAD, round: id, day2: d });

  it('st-day2: หัวหน้าเท่านั้น ตั้งได้ตอนตั้งค่า / นับรอบ 1 ยกเลิกได้ · เริ่มนับแล้วจำแถวสุดท้ายในสมุด', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    expect(api.post({ op: 'st-day2', round: id, day2: D2 }).error).toMatch(/รหัสหัวหน้า/);
    expect(set(api, id, { zones: ['a', 'A'], locs: ['r1-01-02'], openToo: 1 }).round.settings.day2).toEqual({ zones: ['A'], locs: ['R1-01-02'], openToo: 1, row1: 0 });
    const started = api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' });
    expect(started.round.settings.day2.row1, 'แถวสุดท้ายตอนดึงยอดตั้งต้น').toBe(500);
    expect(set(api, id, null).round.settings.day2).toBeUndefined();
    expect(set(api, id, D2).round.settings.day2.row1, 'ตั้งหลังเริ่มนับ').toBe(500);
  });

  it('บันทึกรอบจากหน้าที่เปิดค้างไว้ไม่ทับค่าแบ่งวัน', () => {
    const api = loadStocktake();
    const id = ready(api);
    set(api, id, D2);
    const res = api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, id, settings: { auditMin: 30 } } });
    expect(res.round.settings).toMatchObject({ auditMin: 30, day2: { zones: ['A'], row1: 500 } });
  });

  it('วันแรก: หน้ากรอกไม่เห็นโลที่รอวันที่ 2 และสคริปต์ไม่รับผลนับของโลนั้น · ปิดรับนับไม่ได้จนกว่าจะเปิดวันที่ 2', () => {
    const api = loadStocktake();
    const id = ready(api);
    set(api, id, D2);
    const view = api.get({ api: 'st-round', round: id });
    expect(view.round.day).toBe(1);
    expect(view.locs.map((l) => l[0])).toEqual(['R1-01-01', 'R1-01-02']);
    expect(view.wait).toEqual([['A-01-01', 'A-01'], ['A-01-02', 'A-01']]);
    expect(view.day2).toMatchObject({ zones: ['A'], on: 0, moved: [] });
    const res = api.post({ op: 'st-count', round: id, team: 'INV1', items: [item({ uid: 'r1' }), item({ uid: 'a1', team: 'INV2', who: 'มานะ', loc: 'A-01-01' })] });
    expect(res.saved).toBe(1);
    expect(res.rejected).toEqual([{ uid: 'a1', why: expect.stringMatching(/นับวันที่ 2/) }]);
    expect(res.round.day).toBe(1);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).error).toMatch(/ยังไม่ได้เปิดนับวันที่ 2/);
  });

  it('เปิดวันที่ 2: ระหว่างนับรอบ 1 เท่านั้น เปิดซ้ำไม่ได้ · หน้ากรอกเห็นครบทุกโล รู้ว่าโลไหนต้องนับใหม่ · ส่งผลนับโลวันที่ 2 ได้', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    expect(api.post({ op: 'st-day2-open', t: HEAD, round: id, moved: [] }).error).toMatch(/ไม่ได้แบ่งนับ 2 วัน/);
    set(api, id, D2);
    expect(api.post({ op: 'st-day2-open', t: HEAD, round: id, moved: [] }).error).toMatch(/ระหว่างนับรอบ 1/);
    api.post({ op: 'st-status', t: HEAD, round: id, status: 'นับรอบ 1' });
    expect(api.post({ op: 'st-day2-open', round: id, moved: [] }).error).toMatch(/รหัสหัวหน้า/);
    const res = api.post({ op: 'st-day2-open', t: HEAD, round: id, moved: ['r1-01-02', 'R1-01-02'], by: 'หัวหน้าสมมติ' });
    expect(res.round.settings.day2).toMatchObject({ zones: ['A'], row1: 500, on: 1, moved: ['R1-01-02'], by: 'หัวหน้าสมมติ' });
    expect(res.round.settings.day2.at).toBeGreaterThan(0);
    expect(api.post({ op: 'st-day2-open', t: HEAD, round: id, moved: [] }).error).toMatch(/เปิดนับวันที่ 2 ไปแล้ว/);
    expect(set(api, id, null).error).toMatch(/เปลี่ยนการแบ่งวันไม่ได้/);
    const view = api.get({ api: 'st-round', round: id });
    expect(view.round.day).toBe(2);
    expect(view.locs).toHaveLength(4);
    expect(view.wait).toEqual([]);
    expect(view.day2).toMatchObject({ on: 1, moved: ['R1-01-02'] });
    expect(api.post({ op: 'st-count', round: id, items: [item({ uid: 'a1', team: 'INV2', who: 'มานะ', loc: 'A-01-01' })] }).saved).toBe(1);
    expect(api.get({ api: 'st-mine', round: id, team: 'INV2', since: 0 }).round.day).toBe(2);
    expect(api.post({ op: 'st-status', t: HEAD, round: id, status: 'วิเคราะห์' }).round.status).toBe('วิเคราะห์');
  });

  it('รอบที่ไม่ได้แบ่งวัน: หน้ากรอกได้ทุกโล day = 0 เหมือนเดิม', () => {
    const api = loadStocktake();
    const id = ready(api);
    const view = api.get({ api: 'st-round', round: id });
    expect(view.round.day).toBe(0);
    expect(view.locs).toHaveLength(4);
    expect(view.wait).toEqual([]);
    expect(view.day2).toBe(null);
  });
});

/* นับ 2 วัน: สายไฟของสองหน้า — หลุดเส้นใดเส้นหนึ่ง ตัวเลขจะผิดแบบเงียบ ๆ (โลที่ยังขายอยู่ถูกนับ / ผลนับวันแรกของโลที่ขยับถูกใช้) */
describe('นับ 2 วัน — หน้าหัวหน้าและหน้ากรอก', () => {
  const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');
  const CNT = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');

  it('หน้าหัวหน้า: ก่อนเปิดวันที่ 2 ความคืบหน้ากับผลวิเคราะห์ไม่รวมโลที่รอ · แถวที่ใช้คิดตัดผลนับวันแรกของโลที่ขยับ', () => {
    expect(IDX).toMatch(/function countLocs\(\) \{ const w = ST\.day2Wait\(day2\(\)\); return countLocsAll\(\)\.filter\(l => !w\(l\.loc\)\); \}/);
    expect(IDX).toMatch(/S\.log = ST\.voidMoved\(S\.raw, day2\(\)\);/);
    expect(IDX).toMatch(/ST\.analyze\(\{[^}]*pass: 1, day2: day2\(\) \}\)/);
  });

  it('หน้าหัวหน้า: เปิดวันที่ 2 = ดึงยอดสมุดใหม่ก่อน แล้วส่งโลวันแรกที่ขยับ · ปิดรับนับไม่ได้ถ้ายังไม่เปิดวันที่ 2', () => {
    const at = IDX.indexOf('async function openDay2(');
    const body = IDX.slice(at, IDX.indexOf('\n}\n', at));
    expect(body.indexOf('await pullCore(r)')).toBeGreaterThan(-1);
    expect(body.indexOf("op: 'st-day2-open'")).toBeGreaterThan(body.indexOf('await pullCore(r)'));
    expect(body).toMatch(/ST\.day2Moved\(fifo, d, /);
    expect(IDX).toMatch(/if \(d2 && !d2\.on\) \{ alert\('ยังไม่ได้เปิดนับวันที่ 2/);
  });

  it('หน้าหัวหน้า: เช็คสมุดวันแรกดูเฉพาะแถวที่แตะโลวันแรก (ขายจากโลเปิดเป็นเรื่องปกติ)', () => {
    expect(IDX).toMatch(/list = list\.filter\(m => mine\.has\(ST\.up\(m\.from\)\) \|\| mine\.has\(ST\.up\(m\.to\)\)\);/);
  });

  it('หน้าหัวหน้า: ดึงยอดตั้งต้นใหม่ตอนยังไม่เริ่มนับ อัปเดตโลเปิดที่นับวันที่ 2 ให้ · เริ่มนับแล้วไม่เปลี่ยน', () => {
    expect(IDX).toMatch(/d2 && !d2\.on && d2\.openToo && r\.status === 'ตั้งค่า' \? ST\.day2Plan\(b\.piles, d2\.zones, true\) : null/);
  });

  it('หน้ากรอก: ตัดผลนับวันแรกของโลที่ขยับ · กันเพิ่มโลที่รอวันที่ 2 · หัวหน้าเปิดวันที่ 2 แล้วโหลดรายการใหม่เอง', () => {
    expect(CNT).toMatch(/return ST\.voidMoved\(ST\.merge\(\(MINE && MINE\.rows\) \|\| \[\], local\), RD && RD\.day2\);/);
    expect(CNT).toMatch(/go\.disabled = !c\.kind \|\| wait;/);
    expect(CNT).toMatch(/if \(!c\.kind \|\| waitLoc\(c\.loc\)\) return;/);
    expect(CNT).toMatch(/RD\.round\.day !== day\) \{ DAY_MSG = RD\.round\.day === 2; setTimeout\(loadRound, 0\); \}/);
  });
});

/*
 * ห้องควบคุมการนับ: หัวหน้าดูหน้านี้ตัดสินใจระหว่างวันนับ (ย้ายคน เรียกทีมที่เงียบ สงสัยยอดตั้งต้น)
 * ตัวเลขผิดแล้วตัดสินใจผิดทั้งวัน: เวลาเสร็จ ความเร็ว ทีมเงียบ แถวที่ต่างกับสมุดผิดปกติ
 */
describe('ห้องควบคุมการนับ', () => {
  const T = Date.parse('2026-12-20T10:00:00+07:00');
  const M = 60000;
  const row = (g, n, zone = 'R') => Array.from({ length: n }, (_, i) => ({ loc: `${g}-01-${String(i + 1).padStart(2, '0')}`, group: g, zone }));
  const TM = [
    { id: 'INV1', pass: 1, kind: 'Inventory', name: 'ทีม 1', zones: ['R1'] },
    { id: 'INV2', pass: 1, kind: 'Inventory', name: 'ทีม 2', zones: ['R2'] },
    { id: 'AUD1', pass: 1, kind: 'Audit', name: 'วิไล', zones: ['R1', 'R2'] },
  ];
  /** แถวนับ: min = กี่นาทีก่อนตอนนี้ */
  const e = (loc, min, o) => ({ uid: `${loc}@${min}`, pass: 1, team: 'INV1', kind: 'Inventory', who: 'สมชาย', loc, type: 'นับ', qty: 1, at: T - min * M, ...o });
  const run = (o) => S.control({ teams: TM, now: T, counting: true, ...o });

  it('cellPos: แร็ค = ช่อง × ชั้น · พื้น = ตำแหน่ง (ชั้นถ้ามี) · ชื่อพิเศษ = ช่องเดียว', () => {
    expect(S.cellPos('r1-03-02')).toEqual({ col: 3, row: 2 });
    expect(S.cellPos('A-01-02')).toEqual({ col: 2, row: 1 });
    expect(S.cellPos('A-01-02-03')).toEqual({ col: 2, row: 3 });
    expect(S.cellPos('QA')).toEqual({ col: 1, row: 1 });
  });

  it('ความเร็วกับเวลาเสร็จ: คิดจากเวลาที่ใช้ต่อโล ทีมที่ช้าสุดคือเวลาเสร็จของทั้งรอบ ความเร็วรวม = ทุกทีมรวมกัน', () => {
    const locs = row('R1', 10).concat(row('R2', 20));
    const entries = [29, 24, 19, 14, 9, 4].map((m, i) => e(locs[i].loc, m))
      .concat([28, 20, 12, 4].map((m, i) => e(locs[10 + i].loc, m, { team: 'INV2', who: 'มานะ' })));
    const r = run({ locs, entries });
    expect(r).toMatchObject({ total: 30, done: 10, left: 20, pct: 33, paused: 0, active: 2, pace: 19.5 });
    const [a, b] = r.teams;
    expect(a, 'โลละ 5 นาที').toMatchObject({ id: 'INV1', done: 6, left: 4, pace: 12, idle: 4, here: 1, guess: false });
    expect((a.eta - T) / M).toBeCloseTo(20, 5);
    expect(b, 'โลละ 8 นาที').toMatchObject({ id: 'INV2', done: 4, left: 16, pace: 7.5 });
    expect((b.eta - T) / M).toBeCloseTo(128, 5);
    expect(r.etaTeam, 'ทีม 2 เหลือเยอะกว่าและช้ากว่า').toBe('INV2');
    expect(r.eta).toBe(b.eta);
    expect(r.teams.map((t) => t.id), 'Audit ไม่อยู่ในช่องทีม').toEqual(['INV1', 'INV2']);
    expect(r.alerts).toEqual([{ level: 'info', code: 'slow', team: 'INV2', text: 'ทีม 2 จะเสร็จช้ากว่า ทีม 1 ราว 108 นาที' }]);
  });

  it('เพิ่งเริ่มนับ: โลเดียวยังไม่รู้ว่าใช้เวลาเท่าไร ยังไม่บอกความเร็วกับเวลาเสร็จ · สองโลขึ้นไปถึงบอก', () => {
    const locs = row('R1', 10);
    const one = run({ locs, entries: [e(locs[0].loc, 1)] });
    expect(one.teams[0]).toMatchObject({ pace: 0, eta: 0, started: true });
    expect(one.eta, 'ไม่เดาเวลาเสร็จจากโลเดียว').toBe(0);
    expect(run({ locs, entries: [e(locs[0].loc, 10), e(locs[1].loc, 2)] }).teams[0].pace, 'โลละ 8 นาที').toBe(7.5);
  });

  it('โลที่กองเยอะ: ใช้เวลานานแต่มีแถวเข้ามาเรื่อย ๆ ยังเป็นเวลาทำงาน ไม่ถูกมองเป็นช่วงพัก', () => {
    const locs = row('R1', 10);
    const entries = [40, 35, 30, 25, 20].map((m) => e(locs[0].loc, m)).concat([e(locs[1].loc, 15)]);
    expect(run({ locs, entries }).teams[0].pace, 'หนึ่งโลใช้ 25 นาที').toBe(2.4);
  });

  it('พักเที่ยง: ช่วงที่ทีมไม่ส่งอะไรเลยเกิน 10 นาทีไม่นับเป็นเวลาทำงาน · ทั้งรอบหยุดบอกว่าหยุดกี่นาที ไม่เตือนรายทีม', () => {
    const locs = row('R1', 10).concat(row('R2', 10));
    const before = [70, 65, 60, 55, 50, 45].map((m, i) => e(locs[i].loc, m))
      .concat([62, 48].map((m, i) => e(locs[10 + i].loc, m, { team: 'INV2', who: 'มานะ' })));
    const r = run({ locs, entries: before });
    expect(r.paused).toBe(45);
    expect(r.active).toBe(0);
    expect(r.teams[0].pace, 'ความเร็วของช่วงก่อนพัก').toBe(12);
    expect(r.teams[1], 'สองโลห่างกัน 14 นาที ไม่มีแถวคั่น = ไม่รู้เวลาทำงานจริง ใช้ของทีมอื่นไปก่อน').toMatchObject({ pace: 0, guess: true });
    expect(r.eta).toBeGreaterThan(T);
    expect(r.alerts.map((x) => [x.level, x.code])).toEqual([['info', 'paused']]);
    expect(r.alerts[0].text).toBe('ทุกทีมหยุดนับ 45 นาที');
    /* กลับจากพักแล้วนับได้โลเดียว: ความเร็วยังเป็นของช่วงก่อนพัก ไม่ใช่หนึ่งโลใน 44 นาที (เคยขึ้นว่าเสร็จเกิน 12 ชม.) */
    const back = run({ locs, entries: before.concat([e(locs[6].loc, 1)]) });
    expect(back.paused).toBe(0);
    expect(back.teams[0]).toMatchObject({ done: 7, left: 3, pace: 12 });
    expect((back.teams[0].eta - T) / M).toBeCloseTo(15, 5);
  });

  it('หยุดข้ามคืน (เช้าวันที่ 2): บอกเป็นชั่วโมง ไม่ใช่ 890 นาที', () => {
    expect(S.spanText(45)).toBe('45 นาที');
    expect(S.spanText(119)).toBe('119 นาที');
    expect(S.spanText(900)).toBe('15 ชม.');
    const locs = row('R1', 10).concat(row('R2', 10));
    const r = run({ locs, entries: [e(locs[0].loc, 900), e(locs[1].loc, 895), e(locs[10].loc, 890, { team: 'INV2', who: 'มานะ' })] });
    expect(r.alerts.map((x) => x.text)).toEqual(['ทุกทีมหยุดนับ 15 ชม.']);
    expect(r.teams[0].pace, 'ความเร็วของเมื่อวานยังใช้ประมาณเวลาเสร็จของวันนี้ได้').toBe(12);
  });

  it('ทีมเงียบขณะที่ทีมอื่นยังนับ = เตือนพร้อมโลล่าสุด · ทีมที่ยังไม่เริ่มหลังคนอื่นเริ่มไป 20 นาที = เตือน', () => {
    const locs = row('R1', 10).concat(row('R2', 10));
    const quiet = run({ locs, entries: [e(locs[0].loc, 40), e(locs[1].loc, 25), e(locs[10].loc, 3, { team: 'INV2', who: 'มานะ' })] });
    expect(quiet.alerts.filter((x) => x.level === 'warn')).toEqual([
      { level: 'warn', code: 'idle', team: 'INV1', text: 'ทีม 1 เงียบ 25 นาที ล่าสุดที่ R1-01-02 (สมชาย)' },
    ]);
    const late = run({ locs, entries: [e(locs[0].loc, 30), e(locs[1].loc, 25), e(locs[2].loc, 2)] });
    expect(late.alerts.filter((x) => x.level === 'warn')).toEqual([{ level: 'warn', code: 'unstarted', team: 'INV2', text: 'ทีม 2 ยังไม่เริ่มนับ' }]);
    expect(late.teams[0].pace).toBe(12);
    expect(late.teams[1], 'ยังไม่มีความเร็วของตัวเอง ใช้ของทีมอื่นไปก่อน').toMatchObject({ started: false, pace: 0, guess: true });
    expect((late.teams[1].eta - T) / M).toBeCloseTo(50, 5);
    expect(late).toMatchObject({ etaTeam: 'INV2', etaGuess: true });
    const closed = run({ locs, counting: false, entries: [e(locs[0].loc, 40), e(locs[10].loc, 3, { team: 'INV2', who: 'มานะ' })] });
    expect(closed.alerts, 'ปิดรับนับแล้วไม่เตือนเรื่องทีมเงียบ').toEqual([]);
  });

  it('ทีมหนึ่งเสร็จแล้ว อีกทีมยังเหลืออีกนาน = บอกให้ย้ายไปช่วย', () => {
    const locs = row('R1', 2).concat(row('R2', 30));
    const entries = [e(locs[0].loc, 20), e(locs[1].loc, 15)].concat([25, 5].map((m, i) => e(locs[2 + i].loc, m, { team: 'INV2', who: 'มานะ' })));
    const r = run({ locs, entries });
    expect(r.teams[0]).toMatchObject({ left: 0, pct: 100, eta: 0 });
    expect(r.alerts.map((x) => x.code)).toEqual(['help']);
    expect(r.alerts[0].text).toBe('ทีม 1 เสร็จแล้ว ย้ายไปช่วย ทีม 2 ได้ (เหลือ 28 โล)');
  });

  it('ผัง: ยังไม่นับ / ตรง / ต่างกับสมุด / นับใหม่ / รอวันที่ 2 · จุดคนนับอยู่ที่โลล่าสุดใน 5 นาที · Audit ไม่นับว่านับแล้ว', () => {
    const locs = row('R1', 5);
    const wait = ['A-01-01', 'A-01-02'].map((loc) => ({ loc, group: 'A-01', zone: 'A' }));
    const entries = [
      e('R1-01-01', 30), e('R1-01-02', 12), e('R1-01-02', 3, { uid: 'again', who: 'สมหญิง' }),
      e('R1-01-04', 2, { team: 'AUD1', kind: 'Audit', who: 'วิไล' }),
      e('R1-01-05', 50, { uid: 'gone' }), e('R1-01-05', 49, { uid: 'cancel', type: 'ยกเลิก', ref: 'gone' }),
    ];
    const r = run({ locs, wait, entries, lines: [{ loc: 'R1-01-02', group: 'ขาด' }, { loc: 'R1-01-01', group: 'ตรง' }, { loc: 'R1-01-03', group: 'ยังไม่นับ' }], again: ['r1-01-03'] });
    expect(Object.fromEntries(Object.entries(r.cells).map(([l, c]) => [l, c.s]))).toEqual({
      'R1-01-01': 'ok', 'R1-01-02': 'bad', 'R1-01-03': 'again', 'R1-01-04': 'todo', 'R1-01-05': 'todo', 'A-01-01': 'wait', 'A-01-02': 'wait',
    });
    expect(r.cells['R1-01-02']).toMatchObject({ who: ['สมชาย', 'สมหญิง'], here: ['สมหญิง'], team: 'INV1', at: T - 12 * M });
    expect(r.cells['R1-01-04'].here, 'Audit ก็ขึ้นจุดบนผัง').toEqual(['วิไล']);
    expect(r).toMatchObject({ total: 5, done: 2, active: 2, acc: { checked: 2, ok: 1, pct: 50 } });
    expect(r.groups.map((g) => [g.group, g.total, g.done, g.bad, g.wait, g.team])).toEqual([['R1', 5, 2, 1, 0, 'INV1'], ['A-01', 0, 0, 0, 2, '']]);
    expect(r.alerts.map((x) => x.code)).toEqual(['again']);
  });

  it('แถวที่ต่างกับสมุดผิดปกติ: นับแล้ว 5 โลขึ้นไป ต่าง 3 โลและ 40% ขึ้นไป = เตือน (ติดป้ายว่าห้ามขึ้นจอคนนับ)', () => {
    const locs = row('R1', 10);
    const entries = [9, 8, 7, 6, 5].map((m, i) => e(locs[i].loc, m));
    const bad = (n) => locs.slice(0, n).map((l) => ({ loc: l.loc, group: 'เกิน' }));
    expect(run({ locs, entries, lines: bad(2) }).alerts).toEqual([]);
    const r = run({ locs, entries, lines: bad(3) });
    expect(r.alerts).toEqual([{ level: 'warn', code: 'spike', blind: true, group: 'R1', text: expect.stringMatching(/^แถว R1 ต่างกับสมุด 3 จาก 5 โล/) }]);
    expect(run({ locs, entries: entries.slice(0, 4), lines: bad(4) }).alerts, 'นับยังไม่ถึง 5 โล ยังไม่สรุป').toEqual([]);
  });

  it('ครบทุกโล = 100% กับข้อความนับครบ · เหลือโลเดียวจากพันโลยังไม่ขึ้น 100', () => {
    const locs = row('R1', 3);
    const done = run({ locs, entries: locs.map((l, i) => e(l.loc, 9 - i)) });
    expect(done).toMatchObject({ pct: 100, left: 0, eta: 0 });
    expect(done.alerts).toEqual([{ level: 'ok', code: 'done', text: 'นับครบทุกโลแล้ว' }]);
    const many = Array.from({ length: 1000 }, (_, i) => ({ loc: `R1-${String(i + 1).padStart(4, '0')}-01`, group: 'R1', zone: 'R' }));
    expect(run({ locs: many, entries: many.slice(0, 999).map((l) => e(l.loc, 5)) }).pct).toBe(99);
  });

  it('นาฬิกาเครื่องหัวหน้าช้ากว่าชีต: ไม่ขึ้นว่าทีมเงียบติดลบ ใช้เวลาของแถวล่าสุดเป็นตอนนี้', () => {
    const locs = row('R1', 4);
    const r = run({ locs, entries: [e(locs[0].loc, -7)] });
    expect(r.now).toBe(T + 7 * M);
    expect(r.teams[0]).toMatchObject({ idle: 0, here: 1 });
  });

  it('รอบ 2: ทีมได้เป็นรายโล ใช้แถวของรอบนับ 2 เท่านั้น', () => {
    const locs = row('R1', 3);
    const teams = TM.concat([{ id: 'INV2', pass: 2, kind: 'Inventory', name: 'ทีม 2', zones: ['R1-01-01', 'R1-01-02'] }]);
    const r = S.control({ locs: locs.slice(0, 2), teams, pass: 2, now: T, counting: true, entries: [e('R1-01-01', 20), e('R1-01-02', 3, { pass: 2, team: 'INV2', who: 'มานะ' })] });
    expect(r).toMatchObject({ total: 2, done: 1 });
    expect(r.teams.map((t) => [t.id, t.total, t.done])).toEqual([['INV2', 2, 1]]);
    expect(r.cells['R1-01-02']).toMatchObject({ s: 'ok', team: 'INV2' });
    expect(r.cells['R1-01-01'].s, 'นับในรอบ 1 ไม่นับว่ารอบ 2 นับแล้ว').toBe('todo');
  });
});

/* ห้องควบคุมบนหน้าหัวหน้า: จอทีวีเปิดให้คนนับเห็น ถ้าหลุดบอกว่าโลไหนต่างกับสมุด การนับแบบไม่รู้ยอดก็ไม่มีความหมาย */
describe('ห้องควบคุมการนับ — หน้าหัวหน้ากับจอทีวี', () => {
  const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');
  const fn = (name) => {
    const at = IDX.indexOf(`function ${name}(`);
    expect(at, `ไม่มี ${name}()`).toBeGreaterThan(-1);
    return IDX.slice(at, IDX.indexOf('\n}\n', at));
  };

  it('มีแท็บห้องควบคุม และดึงบันทึกนับเองทุก 20 วินาทีตอนเปิดแท็บนี้', () => {
    expect(IDX).toMatch(/\['control', 'ห้องควบคุม', '\.\.\/icons\/boxes\.png'\]/);
    expect(IDX).toMatch(/const LIVE_TABS = \['control', 'progress', 'analyze', 'round2', 'close', 'report'];/);
    expect(IDX).toMatch(/if \(\+\+POLL_N % 3 && TAB !== 'control'\) return;/);
    expect(IDX).toMatch(/\}, POLL_MS \/ 3\);/);
    expect(fs.existsSync(path.resolve(__dirname, '../../public/icons/boxes.png'))).toBe(true);
  });

  it('จอทีวี: ช่องที่ต่างกับสมุดแสดงเป็นนับแล้ว กดดูรายละเอียดไม่ได้ ไม่มีตัวเลขความแม่นยำ คำเตือนที่บอกผลต่างไม่ขึ้น', () => {
    expect(fn('ctShown')).toMatch(/return CT\.tv && s === 'bad' \? 'ok' : s;/);
    const cell = fn('ctCell');
    expect(cell, 'ข้อความกับสีของช่องมาจากสีที่แสดงจริง').toMatch(/CT_STATE\[shown\]/);
    expect(cell).not.toMatch(/CT_STATE\[c\.s\]/);
    expect(cell, 'จอทีวีไม่มีปุ่มในผัง').toMatch(/return CT\.tv \|\| c\.s === 'wait'\s*\? `<i class=/);
    expect(fn('ctSel')).toMatch(/if \(!c \|\| CT\.tv\) return '';/);
    const view = fn('controlView');
    expect(view).toMatch(/controlAlerts\(cm\)\.filter\(a => !\(tv && a\.blind\)\)/);
    expect(view, 'ช่องตรงกับสมุดมีเฉพาะหน้าหัวหน้า').toMatch(/\(tv \? kpi\('เหลือ'/);
    expect(fn('ctMap')).toMatch(/\$\{CT\.tv \? '' : key\('bad', 'ต่างกับสมุด'\)\}/);
  });

  it('จอทีวีซ่อนเมนูกับแท็บ จึงเปิดได้เฉพาะตอนมีรอบให้ดู และกดออกได้ทั้งปุ่มกับ Esc', () => {
    expect(IDX).toMatch(/classList\.toggle\('st-tv', CT\.tv && TAB === 'control' && !!S\.head && S\.rid !== 'new'/);
    expect(IDX).toMatch(/else if \(act === 'tv-exit'\) setTv\(false\);/);
    expect(IDX).toMatch(/e\.key === 'Escape' && CT\.tv && TAB === 'control' && !document\.fullscreenElement\) setTv\(false\)/);
  });
});

/* สำเนาสมุดพังครึ่งเดียวตอบมาเหมือนปกติ ยอดตั้งต้นจะขาดเป็นก้อน (16/11 สูตร IMPORTRANGE เพิ่งพังจริง) และลิงก์ที่เปิดในแอป LINE อาจทำผลนับในเครื่องหาย */
describe('กันยอดตั้งต้นผิดกับผลนับหาย', () => {
  const row = (n) => [n, 0, '8', 0, -1, 0, 1, 0, -1, 8];
  const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));
  const fifo = (o) => ({ rows: rows(2, 900), last: '2026-11-14', sheet: { end: 30000 }, ...o });

  it('สมุดครบ ไม่เตือนอะไร และบอกจำนวนแถวกับวันขายล่าสุด', () => {
    const c = S.ledgerCheck(fifo(), { cutoff: '2026-11-14 18:00' });
    expect(c.stop).toEqual([]);
    expect(c.ask).toEqual([]);
    expect(c.info).toMatchObject({ rows: 899, first: 2, lastRow: 900, lastDate: '2026-11-14' });
  });

  it('ไม่ดึง: ไม่มีแถว / แถวต้นสมุดหาย / แถวหายเป็นช่วงกลาง / สั้นลงจากชุดก่อนในรอบเดียวกัน', () => {
    expect(S.ledgerCheck(fifo({ rows: [] }), {}).stop[0]).toMatch(/ไม่มีแถว/);
    expect(S.ledgerCheck(fifo({ rows: rows(20001, 20500) }), {}).stop[0]).toMatch(/แถวต้นสมุดหาย.*20,001/);
    const mid = S.ledgerCheck(fifo({ rows: rows(2, 400).concat(rows(1500, 1600)) }), {});
    expect(mid.stop[0]).toMatch(/แถว 401–1,499 ว่างหมด \(1,099 แถว\)/);
    expect(S.ledgerCheck(fifo(), { prevRow: 950 }).stop[0]).toMatch(/สมุดสั้นลง.*950.*900/);
    expect(S.ledgerCheck(fifo(), { prevRow: 900 }).stop, 'ดึงซ้ำได้แถวเท่าเดิม = ปกติ').toEqual([]);
  });

  it('แถวว่างไม่กี่ร้อยแถวกลางสมุดยังดึงได้ (เกณฑ์ 500)', () => {
    expect(S.ledgerCheck(fifo({ rows: rows(2, 400).concat(rows(800, 900)) }), {}).stop).toEqual([]);
  });

  it('ถามก่อน: ขายล่าสุดห่างวันตัดยอดเกิน 2 วัน / ไม่มีวันขาย / ใกล้ท้ายช่วงที่สำเนาดึง', () => {
    expect(S.ledgerCheck(fifo(), { cutoff: '2026-11-16 18:00' }).ask).toEqual([]);
    expect(S.ledgerCheck(fifo(), { cutoff: '2026-11-17 18:00' }).ask[0]).toMatch(/ขายล่าสุดในสมุดคือ 14\/11 แต่ตัดยอด 17\/11 \(ห่าง 3 วัน\)/);
    expect(S.ledgerCheck(fifo({ last: '' }), { cutoff: '2026-11-14 18:00' }).ask[0]).toMatch(/ไม่เจอรายการขาย/);
    expect(S.ledgerCheck(fifo({ sheet: { end: 1000 } }), {}).ask[0]).toMatch(/สำเนาดึงถึงแถว 1,000 ตอนนี้ใช้ถึงแถว 900/);
    expect(S.ledgerCheck(fifo({ sheet: { end: 500 } }), {}).ask, 'แยกสูตรหลายช่วง แถวเกินช่วงแรก = มีช่วงต่อ').toEqual([]);
  });

  it('สมุดสมมติของ dev server ผ่านการเช็ค', () => {
    const f = fakeFifo();
    expect(S.ledgerCheck(f, {}).stop).toEqual([]);
  });

  it('หน้าหัวหน้าเช็คก่อนเก็บยอดตั้งต้น ทั้งดึงปกติและเปิดนับวันที่ 2', () => {
    const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');
    const core = IDX.slice(IDX.indexOf('async function pullCore('), IDX.indexOf('\n}\n', IDX.indexOf('async function pullCore(')));
    expect(core).toMatch(/ST\.ledgerCheck\(fifo, \{ cutoff: r\.cutoff, prevRow: r\.set \? r\.lastRow : 0 \}\)/);
    expect(core.indexOf('ledgerCheck'), 'เช็คก่อนส่งยอดไปชีต').toBeLessThan(core.indexOf("op: 'st-baseline'"));
    expect(core).toMatch(/if \(chk\.stop\.length\) throw new Error/);
    expect(IDX).toMatch(/const \{ fifo, locs \} = await pullCore\(r\);/);   // เปิดวันที่ 2 ผ่าน pullCore เหมือนกัน
  });

  it('ลิงก์จากแอป LINE: หน้ากรอกรู้ว่าอยู่ใน LINE ไม่ลบรหัสออกจากลิงก์ (เมนูเปิดเบราว์เซอร์อื่นพาไปด้วย) และขึ้นแถบเตือน', () => {
    const CNT = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
    expect(CNT).toContain('const IN_LINE = / Line' + String.fromCharCode(92) + '//i.test');
    expect(CNT).toMatch(/if \(!IN_LINE \|\| ext\) history\.replaceState/);
    expect(CNT).toMatch(/qs\.delete\('openExternalBrowser'\)/);
    expect(CNT).toMatch(/return \[bands\(\) \+ lineBand\(\) \+ listView\(\), ''\];/);
    expect(CNT).toMatch(/navigator\.storage\.persist\(\)/);
  });
});

/* ผลนับที่ค้างในมือถือ หัวหน้ามองไม่เห็น ปิดรับนับไปแล้วโลพวกนั้นขึ้นว่ายังไม่นับ */
describe('มือถือที่ยังค้างส่ง', () => {
  const NOW = Date.UTC(2026, 10, 17, 6, 0);
  const min = (m) => NOW - m * 60000;
  const dev = (o) => ({ device: 'D1', who: 'สมชาย', team: 'INV1', pass: 1, pend: 0, old: 0, at: min(1), ...o });

  it('แยกเครื่องที่ยังค้างส่ง กับเครื่องที่ส่งครบแล้วแต่เงียบเกิน 15 นาที เรียงจากติดต่อนานสุด', () => {
    const w = S.deviceWatch([
      dev({ device: 'A', pend: 12, at: min(3) }),
      dev({ device: 'B', pend: 2, at: min(40) }),
      dev({ device: 'C', at: min(20) }),
      dev({ device: 'D', at: min(5) }),
      dev({ device: 'E', pass: 2, pend: 9 }),
    ], NOW, { pass: 1 });
    expect(w.stuck.map((d) => d.device)).toEqual(['B', 'A']);
    expect(w.stuck[0]).toMatchObject({ pend: 2, min: 40, who: 'สมชาย' });
    expect(w.quiet.map((d) => d.device)).toEqual(['C']);
  });

  it('ไม่มีข้อมูลเครื่อง (สคริปต์รุ่นเก่า) ได้รายการว่าง', () => {
    expect(S.deviceWatch(null, NOW, {})).toEqual({ stuck: [], quiet: [] });
  });

  it('มือถือบอกสคริปต์ทุกครั้งที่ติดต่อ (ดึง ส่ง เปิดโล) ว่ายังค้างกี่แถว และส่งแบบ beacon ตอนสลับแอป/ปิดหน้า', () => {
    const CNT = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/count.html'), 'utf8');
    expect(CNT).toMatch(/function meta\(\) \{ return ME \? \{ device: DEV, who: ME\.who, pass: ME\.pass, pend: BOX\.out\.length, old: oldMin\(\) \}/);
    expect(CNT).toMatch(/urlOf\('st-mine', \{ team: t, since, \.\.\.meta\(\) \}\)/);
    expect(CNT).toMatch(/\{ op: 'st-count', k: CFG\.key, round: CFG\.round, \.\.\.meta\(\), team: t, since, items: sent\.map\(wire\) \}/);
    expect(CNT).toMatch(/\{ op: 'st-open', k: CFG\.key, round: CFG\.round, \.\.\.meta\(\),/);
    expect(CNT).toMatch(/if \(!document\.hidden\) \{ flush\(\); pull\(\); \} else beacon\(\);/);
    expect(CNT).toMatch(/navigator\.sendBeacon\(CFG\.url, new Blob\(\[JSON\.stringify\(body\)\], \{ type: 'text\/plain;charset=utf-8' \}\)\)/);
    expect(CNT, 'ค้างนาน 10 นาทีขึ้นแถบแดง').toMatch(/if \(BOX\.out\.length && om >= STUCK_MIN\)/);
  });

  it('หน้าหัวหน้า: ห้องควบคุมเตือนเครื่องที่ค้างส่ง และปุ่มปิดรับนับทั้งสองรอบบอกรายชื่อก่อนยืนยัน', () => {
    const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');
    expect(IDX).toMatch(/S\.devices = r\.devices \|\| null;/);
    expect(IDX).toMatch(/ST\.deviceWatch\(S\.devices, Date\.now\(\), \{ pass: cm\.pass \}\)\.stuck\.forEach/);
    expect(IDX).toMatch(/ย้อนกลับไปนับต่อได้' \+ unsentText\(1\)\)\) setStatus\('วิเคราะห์'\)/);
    expect(IDX).toMatch(/เปิดนับต่อได้' \+ unsentText\(2\)\)\) setStatus\('วิเคราะห์'\)/);
  });
});

describe('stocktake-api.gs — มือถือบอกว่ายังค้างส่งกี่แถว', () => {
  const devs = (api, id) => api.get({ api: 'st-log', t: HEAD, round: id, since: 0 }).devices;

  it('ส่งผลนับ: แถวที่สคริปต์เพิ่งรับไม่นับเป็นค้าง · หน้าหัวหน้าได้รายชื่อเครื่องใน st-log', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.post({ op: 'st-count', round: id, device: 'd1', who: 'สมชาย', team: 'INV1', pass: 1, pend: 5, old: 12, items: [item({ uid: 'a1' }), item({ uid: 'a2', qty: 3 })] });
    expect(devs(api, id)).toEqual([expect.objectContaining({ device: 'd1', who: 'สมชาย', team: 'INV1', pass: 1, pend: 3, old: 12 })]);
    api.post({ op: 'st-count', round: id, device: 'd1', who: 'สมชาย', team: 'INV1', pass: 1, pend: 3, old: 2, items: [item({ uid: 'a3' }), item({ uid: 'a4' }), item({ uid: 'a5' })] });
    expect(devs(api, id)[0]).toMatchObject({ pend: 0, old: 0 });
  });

  it('ดึงแถว (GET ค่าเป็นข้อความ) กับเปิดโลก็บันทึก · เปิดโลไม่ได้บอกทีม ใช้ทีมเดิม', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.get({ api: 'st-mine', round: id, team: 'INV1', since: '0', device: 'd2', who: 'มานะ', pass: '1', pend: '4', old: '15' });
    expect(devs(api, id)[0]).toMatchObject({ device: 'd2', team: 'INV1', pend: 4, old: 15 });
    api.post({ op: 'st-open', round: id, device: 'd2', who: 'มานะ', pass: 1, kind: 'Inventory', loc: 'R1-01-01', pend: 0, old: 0 });
    expect(devs(api, id)[0]).toMatchObject({ team: 'INV1', pend: 0 });
  });

  it('หน้ากรอกรุ่นเก่า (ไม่ส่ง pend) ไม่ถูกบันทึก', () => {
    const api = loadStocktake();
    const id = ready(api);
    api.post({ op: 'st-count', round: id, device: 'old', items: [item({ uid: 'o1' })] });
    expect(devs(api, id)).toEqual([]);
  });

  it('ส่งไม่ผ่าน (รอบปิดแล้ว) แถวยังค้างในเครื่อง', () => {
    const api = loadStocktake();
    const id = ready(api, { start: false });
    api.post({ op: 'st-count', round: id, device: 'd3', who: 'วิไล', team: 'INV2', pass: 1, pend: 7, items: [item({ uid: 'x1' })] });
    expect(devs(api, id)[0].pend).toBe(7);
  });

  it('ค่าเดิมไม่เขียนซ้ำภายใน 3 นาที (โควตา Properties) ค่าเปลี่ยนเขียนทันที', () => {
    const api = loadStocktake();
    const id = ready(api);
    let now = Date.UTC(2026, 10, 17, 3, 0);
    api.ctx.now_ = () => now;
    const ping = (pend) => api.get({ api: 'st-mine', round: id, team: 'INV1', since: '0', device: 'd1', who: 'สมชาย', pass: '1', pend: String(pend), old: '0' });
    ping(0);
    const at0 = devs(api, id)[0].at;
    now += 60000; ping(0);
    expect(devs(api, id)[0].at).toBe(at0);
    now += 60000; ping(2);
    expect(devs(api, id)[0]).toMatchObject({ pend: 2, at: now });
    now += 3 * 60000; ping(2);
    expect(devs(api, id)[0].at, 'ห่างเกิน 3 นาที อัปเดตเวลาติดต่อล่าสุด').toBe(now);
  });

  it('ลบรอบแล้วลบข้อมูลเครื่องของรอบนั้นทิ้ง รอบอื่นยังอยู่', () => {
    const api = loadStocktake();
    const a = ready(api);
    const b = api.post({ op: 'st-round-save', t: HEAD, round: { ...ROUND, name: 'รอบสอง สมมติ' } }).round.id;
    api.post({ op: 'st-open', round: a, device: 'd1', who: 'ก', pass: 1, kind: 'Inventory', loc: '', pend: 1 });
    api.post({ op: 'st-open', round: b, device: 'd1', who: 'ก', pass: 1, kind: 'Inventory', loc: '', pend: 1 });
    expect(api.post({ op: 'st-round-del', t: HEAD, round: a, confirm: ROUND.name }).error).toBeUndefined();
    expect([...api.props.keys()]).toEqual([`stv|${b}|d1`]);
  });
});

describe('รายงานปิดรอบ', () => {
  const L = (loc, sku, book, r1, r2, final, src, group, aud = null) =>
    ({ loc, sku, long: sku + '-LONG', name: 'สินค้าสมมติ ' + sku, lot: '8', po: '9900000001', book, r1, aud, r2, final, adj: final - book, src, group });
  const LINES = [
    L('R1-01-01', 'AAA001', 10, 10, null, 10, 'รอบ 1', 'ตรง', 10),
    L('R1-01-02', 'AAA001', 4, 6, 2, 2, 'รอบ 2', 'ขาด'),
    L('R1-02-01', 'BBB001', 0, 3, null, 3, 'รอบ 1', 'วางผิดโล'),
    L('A-01-01', 'BBB001', 3, 0, 0, 0, 'รอบ 2', 'วางผิดโล', 1),
    L('A-01-02', 'CCC001', 5, 5, null, 5, 'รอบ 1', 'ตรง'),
    L('A-01-03', 'CCC001', 2, null, null, 2, 'สมุด', 'ยังไม่นับ'),
    L('A-01-02', 'DDD001', 1, 1, null, 4, 'หัวหน้าแก้', 'หัวหน้าแก้'),
  ];
  const T0 = Date.UTC(2026, 10, 15, 1, 0), M = 60000;
  let n = 0;
  const E = (min, loc, team, who, x = {}) => ({ uid: 'r' + (++n), at: T0 + min * M, pass: 1, kind: 'Inventory', type: 'นับ', loc, team, who, sku: 'AAA001', qty: 1, ...x });
  const ENTRIES = [
    E(0, 'R1-01-01', 'INV1', 'สมชาย'), E(5, 'R1-01-02', 'INV1', 'สมหญิง'), E(10, 'R1-02-01', 'INV1', 'สมชาย'),
    E(70, 'R1-02-01', 'INV1', 'สมชาย'),
    E(2, 'A-01-01', 'INV2', 'มานะ'), E(8, 'A-01-02', 'INV2', 'มานะ'),
    E(15, 'R1-01-01', 'AUD1', 'วิไล', { kind: 'Audit' }),
    E(120, 'R1-01-02', 'INV2', 'มานะ', { pass: 2 }), E(125, 'A-01-01', 'INV1', 'สมหญิง', { pass: 2 }),
  ];
  /* ทีมรอบ 2 ต่อท้ายด้วยรหัสเดิม (แบบที่บันทึกแผนรอบ 2 แล้ว) ตารางทีมยังเรียงตามรอบ 1 */
  const TEAMS = [
    { id: 'INV1', kind: 'Inventory', name: 'ทีม 1', zones: ['R1'] },
    { id: 'INV2', kind: 'Inventory', name: 'ทีม 2', zones: ['A-01'] },
    { id: 'AUD1', kind: 'Audit', name: 'วิไล', zones: ['R1', 'A-01'] },
    { id: 'INV2', kind: 'Inventory', pass: 2, name: 'ทีม 2', zones: [] },
    { id: 'INV1', kind: 'Inventory', pass: 2, name: 'ทีม 1', zones: [] },
  ];
  const PRICES = { AAA001: 100, BBB001: 50 };

  it('ความแม่นยำคิดเฉพาะรายการที่มีคนนับ: Location / SKU (ของวางผิดโลหักกัน) / ยอดชิ้น / นับครั้งแรก / Audit', () => {
    const r = S.closeReport({ lines: LINES, entries: ENTRIES, teams: TEAMS });
    expect(r.counted).toEqual({ lines: 6, locs: 5 });
    expect(r.left).toBe(1);
    expect(r.acc.line).toEqual({ n: 6, ok: 2, pct: 33.3 });
    expect(r.acc.loc).toEqual({ n: 5, ok: 1, pct: 20 });
    expect(r.acc.sku).toEqual({ n: 4, ok: 2, pct: 50 });
    expect(r.acc).toMatchObject({ diff: 11, book: 23, qty: 52.2 });
    expect(r.first).toEqual({ n: 6, ok: 4, checked: 3, pct: 66.7 });
    expect(r.audit).toEqual({ n: 2, ok: 1, pct: 50 });
    expect(r.recount).toMatchObject({ locs: 2, pct: 40, entered: 2 });
    expect(r.tot).toMatchObject({ lines: 7, adjLines: 4, plus: 6, minus: 5, net: 1 });
  });

  it('กลุ่มปัญหาเรียงตามลำดับชิป โซนเรียงตามคลัง นับรายการที่ไม่ได้นับแยกไว้', () => {
    const r = S.closeReport({ lines: LINES, entries: ENTRIES, teams: TEAMS });
    expect(r.groups.map((g) => [g.group, g.n, g.qty])).toEqual([['ขาด', 1, 2], ['วางผิดโล', 2, 6], ['หัวหน้าแก้', 1, 3]]);
    expect(r.zones).toEqual([
      { zone: 'R', locs: 3, lines: 3, ok: 1, left: 0, plus: 3, minus: 2, net: 1, val: 0, pct: 33.3 },
      { zone: 'A', locs: 2, lines: 3, ok: 1, left: 1, plus: 3, minus: 3, net: 0, val: 0, pct: 33.3 },
    ]);
  });

  it('ทีม: โลที่นับรอบ 1 คนนับ นับครั้งแรกถูก ความเร็วจากเวลาทำงานจริง (หักช่วงพัก) โลรอบ 2 · Audit ไม่ขึ้นเป็นทีม', () => {
    const r = S.closeReport({ lines: LINES, entries: ENTRIES, teams: TEAMS });
    expect(r.teams).toEqual([
      { id: 'INV1', name: 'ทีม 1', locs: 3, r2: 1, people: ['สมชาย', 'สมหญิง'], lines: 3, wrong: 1, adj: 2, first: 66.7,
        start: T0, end: T0 + 70 * M, workMin: 10, pace: 18 },
      { id: 'INV2', name: 'ทีม 2', locs: 2, r2: 1, people: ['มานะ'], lines: 3, wrong: 1, adj: 2, first: 66.7,
        start: T0 + 2 * M, end: T0 + 8 * M, workMin: 6, pace: 20 },
    ]);
    expect(r.span).toEqual({ start: T0, end: T0 + 125 * M, workMin: 20, people: 4 });
  });

  it('มูลค่าคิดเมื่อมีราคา SKU ที่ไม่มีราคานับไว้ · SKU ต่างมากสุดเรียงตามมูลค่า ไม่มีราคาเรียงตามจำนวน', () => {
    const r = S.closeReport({ lines: LINES, entries: ENTRIES, teams: TEAMS, prices: PRICES });
    expect(r.value).toEqual({ has: true, plus: 150, minus: 350, net: -200, missing: 1, priced: 2 });
    expect(r.groups.find((g) => g.group === 'วางผิดโล').val).toBe(0);
    expect(r.zones.map((z) => z.val)).toEqual([-50, -150]);
    expect(r.top.map((t) => [t.sku, t.net, t.val, t.locs])).toEqual([['AAA001', -2, -200, 1], ['DDD001', 3, 0, 1]]);
    const r0 = S.closeReport({ lines: LINES, entries: ENTRIES, teams: TEAMS });
    expect(r0.value.has).toBe(false);
    expect(r0.top.map((t) => t.sku)).toEqual(['DDD001', 'AAA001']);
    expect(S.closeReport({ lines: LINES, top: 1 })).toMatchObject({ topMore: 1, teams: [] });
  });

  it('ไม่มีบันทึกนับ (แถวสรุปที่ปิดแล้วอย่างเดียว) ยังได้ตัวเลขหลัก ไม่มีผลนับเลยขึ้น null ไม่หารศูนย์', () => {
    const r = S.closeReport({ lines: LINES });
    expect(r.acc.loc.pct).toBe(20);
    expect(r.span).toEqual({ start: 0, end: 0, workMin: 0, people: 0 });
    const e = S.closeReport({ lines: [L('A-01-03', 'CCC001', 2, null, null, 2, 'สมุด', 'ยังไม่นับ')] });
    expect(e.acc.loc.pct).toBeNull();
    expect(e.acc.qty).toBeNull();
    expect(e.first.pct).toBeNull();
  });

  it('ยังไม่มีการตรวจซ้ำ (ไม่มีรอบ 2 ไม่มีหัวหน้าแก้) นับครั้งแรกถูกขึ้น null ไม่ใช่ 100%', () => {
    const only1 = LINES.filter((l) => l.r2 === null && l.src !== 'หัวหน้าแก้');
    const r = S.closeReport({ lines: only1, entries: ENTRIES, teams: TEAMS });
    expect(r.first).toMatchObject({ n: 3, ok: 3, checked: 0, pct: null });
    expect(r.teams.map((t) => t.first)).toEqual([null, null]);
  });

  it('วางราคาจาก Excel: แท็บ จุลภาค ช่องว่าง หลายคอลัมน์ ตัด ฿ กับจุลภาคหลักพัน ข้ามหัวตาราง', () => {
    expect(S.parsePrices('SKU\tราคา\nAAA001\t1,250.50\nbbb001\t฿80\nCCC001\tไม่มี\n0012\t5\n\n')).toEqual({ map: { AAA001: 1250.5, BBB001: 80, 12: 5 }, n: 3, bad: 1 });
    expect(S.parsePrices('AAA001,100\nBBB001 50\nCCC001\tที่นอนสมมติ\t120\tชิ้น').map).toEqual({ AAA001: 100, BBB001: 50, CCC001: 120 });
    expect(S.workMs([3 * M, 0, M, 30 * M], 10)).toBe(2 * M);
  });
});

describe('รายงานปิดรอบ — หน้าหัวหน้า', () => {
  const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');

  it('แท็บรายงานต่อจากปิดรอบ ใช้ยอดที่อนุมัติเมื่อปิดแล้ว ไม่งั้นร่างจากตัวเลขเดียวกับแท็บปิดรอบ', () => {
    expect(IDX).toMatch(/\['close', 'ปิดรอบ', '\.\.\/icons\/tab-fix\.png'\],\s*\['report', 'รายงาน'/);
    expect(IDX).toContain("else if (TAB === 'report') box.innerHTML = reportView();");
    expect(IDX).toContain("const fin = closed ? (S.head.sum || []).map(fromSum) : finals();\n  const rep = ST.closeReport(");
  });

  it('พิมพ์ได้หน้าเดียว (ซ่อนแถบรอบ แท็บ ปุ่ม) รูปสรุปคัดลอก / แชร์ / โหลด ราคาเก็บในเครื่อง วางที่ไหนก็ได้บนแท็บ', () => {
    expect(IDX).toMatch(/@media print\{\s*@page\{size:A4/);
    expect(IDX).toContain('.st-src,.tx-tabs,.rp-tools,.rp-price,.st-shot{display:none !important}');
    expect(IDX).toContain("else if (act === 'rp-print') window.print();");
    ['shotcopy', 'shotshare', 'shotsave', 'shotclose'].forEach((a) => expect(IDX).toContain(`act === '${a}'`));
    expect(IDX).toContain("const PRICE_KEY = 'wms:st:price';");
    expect(IDX).toContain("if (TAB !== 'report' || !S.head) return;");
    /* กำลังพิมพ์ราคาในกล่อง ดึงบันทึกนับรอบใหม่ต้องไม่วาดทับ */
    expect(IDX).toContain("(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')");
  });
});

describe('ตั้งต้นสมุด Transaction ใหม่จากยอดนับ', () => {
  /* สมุดเดิม: แถว GR สามรอบของ AAA หนึ่งรอบของ BBB กับแถวย้ายที่ไม่ใช่ GR (ต้องไม่ถูกนับเป็นของรับเข้า) */
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
    ln('R1-01-01', 'AAA', '0', '0', 7),            // ไม่มีป้าย
    ln('R1-01-02', 'AAA', '10', '0', 2),           // รู้ LOT ไม่รู้ PO
    ln('R1-01-02', 'BBB', '', '', 8),              // GR มีแค่ 5
    ln('A-01-01', 'BBB', '9', '9900000002', 0),    // ยอด 0 ไม่ลง
    ln('R1-01-02', 'AAA', '8', '9900000001', 1, 'สมุด'),
  ];
  const NOTE = 'Stock Count Q4/26';
  const run = () => S.openingRows({ lines: LINES0, fifo: FIFO, piles: PILES0, note: NOTE, name: 'หัวหน้าสมมติ' });
  const find = (rows, loc, sku, lot, po) => rows.filter((r) => r[6] === loc && r[0] === sku && r[3] === lot && r[4] === po);

  it('ชื่อรอบใน Note จากวันที่นับ วันรับแบบที่ทีมพิมพ์ และ LOT/PO ที่ไม่รู้', () => {
    expect(S.countLabel('2026-12-19')).toBe('Stock Count Q4/26');
    expect(S.countLabel('2026-08-02')).toBe('Stock Count Q3/26');
    expect(S.countLabel('')).toBe('Stock Count');
    expect(S.grText('2026-10-02')).toBe('02-10-26');
    expect(['', '0', '00', '0.0', null, ' 0 '].every(S.unknownCode)).toBe(true);
    expect(['0.11', '8', '9900000001'].some(S.unknownCode)).toBe(false);
    expect(S.OPEN_HEAD).toEqual(['SKU', 'SKU', 'Product Name', 'LOT', 'PO', 'Location เบิก', 'Location รับ', 'QTY', 'รับ/เบิก', 'Note', 'Status', 'NAME']);
  });

  it('กองที่รู้ LOT/PO ลงตรงตัว พ่วงวันรับแรกของ PO ไว้ใน Note โลเปิดได้ Status เปิด', () => {
    const { rows } = run();
    expect(find(rows, 'A-01-01', 'AAA001', '8', '9900000001')).toEqual([
      ['AAA001', 'AAA0000000001', 'ที่นอนสมมติ', '8', '9900000001', '', 'A-01-01', 5, 'รับ', 'Stock Count Q4/26 · GR 01-09-26', 'เปิด', 'หัวหน้าสมมติ'],
    ]);
    /* ยอดจากสมุด (ไม่มีใครนับ) ก็ลง เพราะสมุดใหม่ต้องมีของครบทุกกอง */
    expect(find(rows, 'R1-01-02', 'AAA001', '8', '9900000001')[0].slice(7, 11)).toEqual([1, 'รับ', 'Stock Count Q4/26 · GR 01-09-26', '']);
    expect(rows.some((r) => r[0] === 'BBB001' && r[6] === 'A-01-01')).toBe(false);
    /* ไม่มีแถวไหนขึ้นต้นด้วย GR (จะกลายเป็นแถวรับเข้าวันนั้น) และไม่มีช่อง Location เบิก */
    expect(rows.every((r) => !/^GR/i.test(r[9]) && /^Stock Count/.test(r[9]) && r[5] === '' && r[8] === 'รับ')).toBe(true);
  });

  it('ไม่รู้ LOT/PO เติมจาก GR ล่าสุดย้อนหลัง หักที่กองรู้ LOT/PO จองไว้ก่อน รู้ครึ่งเดียวได้ก่อนและเลือกได้แค่ที่ตรง', () => {
    const { rows, est } = run();
    /* AAA LOT 11 รับ 6 กองที่รู้จองไป 2 เหลือ 4 · LOT 10 รับ 15 กองที่รู้ LOT 10 ได้ไปก่อน 2 */
    expect(find(rows, 'R1-01-02', 'AAA001', '10', '9900000002').map((r) => [r[7], r[9]])).toEqual([[2, 'Stock Count Q4/26 · GR 02-10-26 · ประมาณ LOT/PO จาก GR']]);
    expect(find(rows, 'R1-01-01', 'AAA001', '11', '9900000003').map((r) => [r[7], r[9]])).toEqual([
      [2, 'Stock Count Q4/26 · GR 03-11-26'],
      [4, 'Stock Count Q4/26 · GR 03-11-26 · ประมาณ LOT/PO จาก GR'],
    ]);
    expect(find(rows, 'R1-01-01', 'AAA001', '10', '9900000002').map((r) => r[7])).toEqual([3]);
    expect(find(rows, 'R1-01-01', 'AAA001', '0', '0')).toEqual([]);
    /* BBB มี GR แค่ 5 ที่เหลือ 3 คง LOT/PO เดิม (ว่าง) ไม่มีวันรับ ไม่ขึ้นว่าประมาณ */
    expect(find(rows, 'R1-01-02', 'BBB001', '9', '9900000002').map((r) => r[7])).toEqual([5]);
    expect(find(rows, 'R1-01-02', 'BBB001', '', '').map((r) => [r[7], r[9]])).toEqual([[3, 'Stock Count Q4/26']]);
    expect(est.map((e) => [e.loc, e.sku, e.qty, e.to.map((t) => `${t.lot}/${t.po}:${t.qty}`).join(' '), e.left])).toEqual([
      ['R1-01-02', 'AAA001', 2, '10/9900000002:2', 0],
      ['R1-01-01', 'AAA001', 7, '11/9900000003:4 10/9900000002:3', 0],
      ['R1-01-02', 'BBB001', 8, '9/9900000002:5', 3],
    ]);
  });

  it('ยอดรวมแถวตั้งต้นเท่ายอดนับสุดท้ายพอดี บอกจำนวนที่ประมาณ ที่ยังไม่รู้ ที่มาจากสมุด และโลเปิด', () => {
    const { rows, tot } = run();
    expect(tot).toMatchObject({ rows: rows.length, qty: 25, lines: 6, book: 1, open: 1, noGr: 0, est: { lines: 3, qty: 14, left: 3 } });
    expect(rows.reduce((s, r) => s + r[7], 0)).toBe(LINES0.reduce((s, l) => s + l.final, 0));
    /* เรียงตามทางเดิน แบบเดียวกับหน้าอื่น */
    const locs = rows.map((r) => r[6]);
    expect(locs).toEqual(locs.slice().sort(S.locCmp));
  });

  it('วางลงสมุดใหม่แล้ว tx-api.gs ตัวจริงอ่านกลับได้ยอดเท่าที่นับทุกกอง แถวขายหลังเปิดคลังไม่นับในการเช็ค', () => {
    const { rows } = run();
    /* Excel แปลงตัวเลขที่เป็นข้อความเป็นตัวเลข แบบเดียวกับที่ทีมพิมพ์ลงสมุด */
    const num = (v) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    const sheet = rows.map((r) => r.map((v, i) => (i === 3 || i === 4 ? num(v) : v)));
    const tx = txApi([...sheet, L({ sku: 'AAA001', long: 'AAA0000000001', from: 'A-01-01', qty: 1, type: 'ขาย', note: '21/12/2026' })]);
    const fifo = JSON.parse(JSON.stringify(tx.fifo_()));
    const chk = S.openingCheck(fifo, rows);
    expect(chk).toMatchObject({ ok: true, rows: rows.length, want: 25, got: 25, diff: [] });
    /* วันรับที่พ่วงไว้ใน Note ส่งให้หน้า FIFO ด้วย แถวที่ไม่มีวันรับไม่ส่ง */
    expect(fifo.cgr.length).toBe(rows.filter((r) => / GR \d/.test(r[9])).length);
    expect(fifo.cgr[0]).toEqual([2, expect.stringMatching(/^2026-(09|10|11)-0[123]$/)]);
    /* แถวนับไม่ใช่แถวรับเข้า (ธง GR) รายงานรับเข้ารายเดือนไม่เพี้ยน */
    expect(fifo.rows.every((r) => !(r[9] & 2))).toBe(true);
  });

  it('เช็คสมุดใหม่เจอแถวที่วางขาด วางซ้ำ หรือยังไม่ได้วาง', () => {
    const { rows } = run();
    /* แถวแรกหาย แถวสุดท้ายวางซ้ำ */
    const tx = txApi(rows.slice(1).concat([rows[rows.length - 1]]));
    const chk = S.openingCheck(JSON.parse(JSON.stringify(tx.fifo_())), rows);
    expect(chk.ok).toBe(false);
    expect(chk.diff.map((d) => [d.loc, d.want - d.got])).toEqual(expect.arrayContaining([
      [rows[0][6], rows[0][7]],
      [rows[rows.length - 1][6], -rows[rows.length - 1][7]],
    ]));
    expect(S.openingCheck({ rows: [] }, rows)).toMatchObject({ ok: false, rows: 0, got: 0 });
  });

  it('ของเดิมยังลบไม่หมด (แถวโอนย้ายอยู่ก่อนแถวตั้งต้น) ไม่ผ่าน แม้ยอดแถวนับจะตรง', () => {
    const { rows, info } = run();
    const old = L({ sku: 'CCC001', long: 'CCC0000000001', to: 'QA', qty: 4, note: 'โอนย้าย' });
    const chk = S.openingCheck(JSON.parse(JSON.stringify(txApi([old, ...rows]).fifo_())), rows);
    expect(chk).toMatchObject({ ok: false, mixed: 1, first: 2, diff: [] });
    /* info คู่กับแถว: บอกว่าแถวไหนประมาณ แถวไหนยังไม่รู้ มาจากสมุด และโลเปิด */
    expect(info.length).toBe(rows.length);
    expect(info.filter((x) => x.kind === 'est').length).toBe(4);
    expect(info.filter((x) => x.kind === 'left').length).toBe(1);
    expect(info.filter((x) => x.src === 'สมุด').length).toBe(1);
    expect(info.filter((x) => x.open).length).toBe(1);
  });

  it('ไม่มีไฟล์ในเครื่อง เทียบแบบ Location × SKU กับยอดสุดท้ายได้ (ไม่สน LOT/PO ที่ประมาณ)', () => {
    const { rows } = run();
    const fifo = JSON.parse(JSON.stringify(txApi(rows).fifo_()));
    const plain = LINES0.filter((l) => l.final > 0).map((l) => [l.sku, l.long, '', l.lot, l.po, '', l.loc, l.final]);
    expect(S.openingCheck(fifo, plain).ok).toBe(false);   // LOT/PO ของกองที่ไม่รู้ถูกเติมแล้ว เทียบตรงตัวไม่ได้
    expect(S.openingCheck(fifo, plain, true)).toMatchObject({ ok: true, want: 25, got: 25 });
    const short = plain.map((r, i) => (i === 0 ? r.slice(0, 7).concat([r[7] + 1]) : r));
    expect(S.openingCheck(fifo, short, true).diff).toEqual([{ loc: 'A-01-01', sku: 'AAA001', lot: '', po: '', want: 6, got: 5 }]);
  });

  it('ยอดติดลบของโลที่ไม่ได้นับไม่ลง บอกจำนวนไว้', () => {
    const r = S.openingRows({ lines: [...LINES0, ln('R1-01-03', 'AAA', '8', '9900000001', -2, 'สมุด')], fifo: FIFO, note: NOTE });
    expect(r.tot.neg).toEqual({ lines: 1, qty: -2 });
    expect(r.rows.some((x) => x[6] === 'R1-01-03')).toBe(false);
  });

  it('Excel ตั้งต้นสมุด: ชีตแรกวางลงแท็บ Transaction ได้ทันที LOT/PO เป็นตัวเลข ร่างบอกห้ามวาง', () => {
    const res = run();
    const meta = { id: 'R-1', name: 'นับปลายปีสมมติ', date: '2026-12-19', note: NOTE, who: 'หัวหน้าสมมติ', final: 25, lastRow: 900,
      moves: [{ row: 901 }, { row: 905 }] };
    const book = S.openingBook(res, meta);
    expect(book.map((b) => b.name)).toEqual(['ยอดตั้งต้น', 'ประมาณ LOT-PO', 'วิธีวาง', 'สรุป']);
    const [a1, a2, a3, a4] = book.map((b) => b.aoa);
    expect(a1[0]).toEqual(S.OPEN_HEAD);
    expect(a1.length).toBe(res.rows.length + 1);
    const first = a1.find((r) => r[6] === 'A-01-01');
    expect(first.slice(3, 5)).toEqual([8, 9900000001]);
    expect(a1.find((r) => r[0] === 'BBB001' && r[3] === '').slice(3, 5)).toEqual(['', '']);
    expect(S.sheetNum('0.11')).toBe(0.11);
    expect(S.sheetNum('08')).toBe('08');
    expect(S.sheetNum('PO-1')).toBe('PO-1');
    /* ประมาณ: หนึ่งแถวต่อ LOT/PO ที่ได้ + แถวที่ยังไม่รู้ */
    expect(a2.length).toBe(1 + 4 + 1);
    expect(a2.find((r) => r[7] === 'ยังไม่รู้')).toEqual(['R1-01-02', 'BBB001', 'BBB0000000001', 'ท็อปเปอร์สมมติ', '', '', 8, 'ยังไม่รู้', 'ยังไม่รู้', 3, 'GR ในสมุดเดิมไม่พอ']);
    expect(a3[1][1]).toMatch(/ร่าง.*ห้ามวาง/);
    expect(a3.some((r) => /แถว 901 ถึง 905/.test(r[1]))).toBe(true);
    expect(a3.some((r) => new RegExp(`แถว 2 ถึง ${res.rows.length + 1}`).test(r[1]))).toBe(true);
    expect(a4.find((r) => r[0] === 'ชิ้นรวม')[1]).toBe(25);
    expect(a4.find((r) => r[0] === 'อนุมัติโดย')[1]).toMatch(/ร่าง/);
    const ok = S.openingBook(res, { ...meta, approvedBy: 'หัวหน้าสมมติ', moves: [] }).map((b) => b.aoa);
    expect(ok[2][1][1]).toMatch(/ก่อนเปิดคลัง/);
    expect(ok[2].some((r) => /ไม่ต้องคัดลอกอะไรต่อ/.test(r[1]))).toBe(true);
  });
});

describe('ตั้งต้นสมุด — หน้าหัวหน้า', () => {
  const IDX = fs.readFileSync(path.resolve(__dirname, '../../public/stocktake/index.html'), 'utf8');

  it('แท็บต่อจากรายงาน ไฟล์ Excel สี่ชีต เก็บแถวย่อไว้เช็คหลังวาง สมุดใหม่แล้วไม่คิดแถวซ้ำจากสมุดใหม่', () => {
    expect(IDX).toMatch(/\['report', 'รายงาน', '\.\.\/icons\/clipboard-list\.png'\],\s*\['trc', 'กระทบ TRcloud', '[^']+'\], \['opening', 'ตั้งต้นสมุด'/);
    expect(IDX).toContain("else if (TAB === 'trc') box.innerHTML = trcView();");
    expect(IDX).toContain("const json = await WmsGas.json(url, 'stock-all', { retries: 1 });");
    /* ราคาทุนจาก TRcloud ใช้ในรายงานด้วย ราคาที่วางเองทับ */
    expect(IDX).toContain('prices: { ...trcCost(), ...pm.map }');
    ['trc-xlsx', 'trc-load'].forEach((a) => expect(IDX).toContain(`act === '${a}'`));
    expect(IDX).toContain("else if (TAB === 'opening') box.innerHTML = openingView();");
    expect(IDX).toContain('ST.openingBook(o, {');
    expect(IDX).toContain("const OP_KEY = 'wms:st:open:';");
    expect(IDX).toContain('if (opReset(FIFO.data)) {');
    expect(IDX).toContain('const res = ST.openingCheck(fifo, rows, mode === \'sku\');');
    ['op-xlsx', 'op-check', 'op-fifo'].forEach((a) => expect(IDX).toContain(`act === '${a}'`));
  });
});

describe('กระทบ TRcloud — WH-02 / WH-QA ให้เท่ายอดนับ ส่วนต่างไป-กลับ WH-Loss', () => {
  const TABS = {
    Stock: [
      ['SKU', 'Description', 'QA', 'NEW WH', 'Total'],
      ['AAA0000000001', 'ที่นอนสมมติ', 0, 10, 10],
      ['BBB0000000001', 'ท็อปเปอร์สมมติ', 0, 10, 10],
      ['CCC0000000001', 'หมอนสมมติ', 5, 0, 5],
      ['DDD0000000001', 'ผ้าสมมติ', 2, 8, 10],
      ['EEE0000000001', 'ของหายสมมติ', 0, 4, 4],
      ['GGG0000000001', 'ของแปลงสมมติ', 0, 6, 6],
      ['III0000000001', 'ของเกินสมมติ', 0, 5, 5],
    ],
    'WH-Loss': [['รายงานคงเหลือ คลัง WH-Loss สมมติ'], [''], ['รหัสสินค้า', 'ชื่อสินค้า', 'คงเหลือ'],
      ['AAA0000000001', 'ที่นอนสมมติ', 2], ['BBB0000000001', 'ท็อปเปอร์สมมติ', -1], ['III0000000001', 'ของเกินสมมติ', 1], ['ZZZ0000000001', 'ค้างสมมติ', 5]],
    ราคาทุน: [['SKU', 'ราคาทุน'], ['AAA0000000001', 100], ['BBB0000000001', '50'], ['EEE0000000001', 20]],
  };
  const ln = (loc, long, final, sku = long.slice(0, 3) + '001') => ({ loc, sku, long, name: '', final });
  const LINES = [
    ln('R1-01-01', 'AAA0000000001', 12),
    ln('R1-01-02', 'BBB0000000001', 7),
    ln('A-01-01', 'CCC0000000001', 5),
    ln('RIB', 'DDD0000000001', 8),
    ln('IQA', 'DDD0000000001', 2),
    ln('R1-02-01', 'FFF0000000001', 3),
    ln('R1-02-02', 'GGG0000000002', 6, 'GGG002'),
    ln('S-01-01', 'ถุงมือ', 10, 'ถุงมือ'),
    ln('R1-03-01', 'III0000000001', 8),
    ln('R1-03-02', 'EEE0000000001', 0),
  ];
  const CONVERT = { pairs: [['GGG0000000002', 'GGG0000000001', 'ของแปลงสมมติ']] };
  let trc, res;
  beforeAll(() => {
    trc = S.trcParse(loadStockApi(TABS).get({ api: 'stock-all' }));
    res = S.trcRecon({ lines: LINES, trc, convert: CONVERT, date: '2026-12-19', ref: 'ST-1' });
  });
  const item = (sku) => res.items.find((x) => x.sku === sku);

  it('คลังของ Location: QA, IQA = WH-QA · RIB และที่เหลือ = WH-02', () => {
    expect(['QA', 'IQA', 'qa-01', 'IQA2'].map(S.whOf)).toEqual(['WH-QA', 'WH-QA', 'WH-QA', 'WH-QA']);
    expect(['RIB', 'R1-01-01', 'AQA', 'QAX', 'A-01-01'].map(S.whOf)).toEqual(['WH-02', 'WH-02', 'WH-02', 'WH-02', 'WH-02']);
  });

  it('stock-api.gs รุ่น 3: ?api=stock-all ส่งแท็บ Stock / WH-Loss / ราคาทุน · เรียกแบบเดิมยังได้ array แท็บ Stock เหมือน v2', () => {
    const api = loadStockApi(TABS);
    const old = api.get({ api: 'stock' });
    expect(Array.isArray(old)).toBe(true);
    expect(old[0]).toEqual({ SKU: 'AAA0000000001', Description: 'ที่นอนสมมติ', QA: 0, 'NEW WH': 10, Total: 10 });
    expect(api.get({})).toEqual(old);
    /* หัวตาราง WH-Loss อยู่แถว 3 (ไฟล์ export มีชื่อรายงานข้างบน) ชื่อแท็บพิมพ์ต่างได้ */
    const all = loadStockApi({ Stock: TABS.Stock, 'wh loss': TABS['WH-Loss'], ราคาทุน: TABS.ราคาทุน }).get({ api: 'stock-all' });
    expect(all.tabs).toEqual({ stock: 'Stock', loss: 'wh loss', cost: 'ราคาทุน' });
    expect(all.loss[0]).toEqual({ รหัสสินค้า: 'AAA0000000001', ชื่อสินค้า: 'ที่นอนสมมติ', คงเหลือ: 2 });
    expect(loadStockApi({ Stock: TABS.Stock }).get({ api: 'stock-all' })).toMatchObject({ v: 3, loss: null, cost: null });
    expect(loadStockApi({}).get({ api: 'stock-all' }).error).toMatch(/ไม่พบ Sheet/);
  });

  it('แปลงคำตอบ: NEW WH = WH-02, QA = WH-QA, WH-Loss บวก/ลบ, ราคาทุน · สคริปต์รุ่นเก่าไม่มี Loss', () => {
    expect(trc).toMatchObject({ v: 3, n: 7, cols: { loss: 'คงเหลือ', cost: 'ราคาทุน' } });
    expect(trc.stock['CCC0000000001']).toEqual({ sku: 'CCC0000000001', name: 'หมอนสมมติ', main: 0, qa: 5 });
    expect(trc.loss).toEqual({ AAA0000000001: 2, BBB0000000001: -1, III0000000001: 1, ZZZ0000000001: 5 });
    expect(trc.cost).toEqual({ AAA0000000001: 100, BBB0000000001: 50, EEE0000000001: 20 });
    const old = S.trcParse(loadStockApi(TABS).get({}));
    expect(old).toMatchObject({ v: 2, n: 7, loss: null, cost: null });
    expect(() => S.trcParse({ error: 'ไม่พบ Sheet: Stock' })).toThrow(/stock-api: ไม่พบ Sheet/);
    expect(() => S.trcParse([{ SKU: 'A', QA: 1 }])).toThrow(/NEW WH/);
  });

  it('แต่ละ SKU: เจอของที่เคยหาย / หายเพิ่มหักกับที่เคยเกิน / ย้าย QA ตรง / ไม่เจอในคลัง / ไม่มีใน TRcloud / แปลงรวมเข้า SKU ตอนซื้อ', () => {
    const pick = (x) => [x.group, x.moves.map((m) => `${m.from}>${m.to}:${m.qty}`).join(' '), x.lossAfter];
    expect(pick(item('AAA0000000001'))).toEqual(['เจอของที่เคยหาย', 'WH-Loss>WH-02:2', 0]);
    expect(pick(item('BBB0000000001'))).toEqual(['หายเพิ่ม', 'WH-02>WH-Loss:3', 2]);
    expect(item('BBB0000000001')).toMatchObject({ back: 1, lossNew: 2 });
    expect(pick(item('CCC0000000001'))).toEqual(['ย้าย QA ↔ WH-02', 'WH-QA>WH-02:5', 0]);
    expect(pick(item('DDD0000000001'))).toEqual(['ตรง', '', 0]);
    expect(item('DDD0000000001')).toMatchObject({ c02: 8, cqa: 2 });
    expect(pick(item('EEE0000000001'))).toEqual(['ไม่เจอในคลัง', 'WH-02>WH-Loss:4', 4]);
    expect(pick(item('FFF0000000001'))).toEqual(['ไม่มีในไฟล์ TRcloud', 'WH-Loss>WH-02:3', -3]);
    expect(pick(item('GGG0000000001'))).toEqual(['ตรง', '', 0]);
    expect(item('GGG0000000001').conv).toEqual(['GGG0000000002']);
    expect(pick(item('III0000000001'))).toEqual(['เจอของที่เคยหาย', 'WH-Loss>WH-02:3', -2]);
    expect(item('III0000000001')).toMatchObject({ found: 1, overNew: 2 });
    expect(res.internal).toEqual([{ sku: 'ถุงมือ', long: 'ถุงมือ', name: '', qty: 10, locs: [{ loc: 'S-01-01', qty: 10 }] }]);
    expect(res.items.some((x) => x.sku === 'ZZZ0000000001')).toBe(false);   // ค้างใน Loss อย่างเดียว ไม่ต้องทำอะไร
  });

  it('แถวไฟล์ TRcloud: หนึ่งการโอน = ลดต้นทาง + เพิ่มปลายทาง วันตัดยอด รหัสรอบ แผนก IV', () => {
    expect(res.rows.filter((r) => r[0] === 'AAA0000000001')).toEqual([
      ['AAA0000000001', '2026-12-19', '', 2, '', '', 'ST-1', 'IV', 'WH-Loss', ''],
      ['AAA0000000001', '2026-12-19', 2, '', '', '', 'ST-1', 'IV', 'WH-02', ''],
    ]);
    expect(res.rows.length).toBe(2 * 6);
    /* ทุกคลังรวมเพิ่ม = รวมลด (โอนอย่างเดียว ไม่มีของหายไปจากบริษัท) */
    const plus = res.rows.reduce((s, r) => s + (r[2] || 0), 0), minus = res.rows.reduce((s, r) => s + (r[3] || 0), 0);
    expect(plus).toBe(minus);
  });

  it('ยอดรวม: Loss เดิม → หลังปรับ เจอ / หายเพิ่ม / เกินเพิ่ม / หักกับที่เคยเกิน และมูลค่าจากราคาทุน', () => {
    expect(res.tot).toMatchObject({
      skus: 8, adj: 6, move: 5, lossBefore: 7, lossAfter: 6, found: 3, lossNew: 6, overNew: 5, back: 1, toLoss: 7, fromLoss: 8, internal: 1, conv: 1,
      wh: { 'WH-02': { plus: 13, minus: 7 }, 'WH-QA': { plus: 0, minus: 5 }, 'WH-Loss': { plus: 7, minus: 8 } },
      count: { main: 49, qa: 2 }, trc: { main: 43, qa: 7 },
    });
    expect(res.tot.value).toEqual({ has: true, missing: 2, lossNew: 180, found: 200, overNew: 0, net: 30 });
    /* ไม่มีราคาทุนใน TRcloud ใช้ราคาที่วางเองในแท็บรายงาน (SKU สั้นก็ได้) */
    const r2 = S.trcRecon({ lines: LINES, trc: { ...trc, cost: null }, prices: { FFF001: 10 }, date: '2026-12-19' });
    expect(r2.items.find((x) => x.sku === 'FFF0000000001').price).toBe(10);
  });

  it('Excel ลง TRcloud: ชีตแรกหัวตารางเดียวกับหน้าเช็คตัดสต๊อก ร่างบอกห้ามลง', () => {
    const CUT = fs.readFileSync(path.resolve(__dirname, '../../public/wms-cut.js'), 'utf8');
    const cutHead = /var TRC_HEAD = (\[[^\]]*\]);/.exec(CUT)[1];
    expect(JSON.stringify(S.TRC_HEAD)).toBe(JSON.stringify(eval(cutHead)));
    const book = S.trcBook(res, { id: 'ST-1', name: 'นับปลายปีสมมติ', date: '2026-12-19', tabs: trc.tabs });
    expect(book.map((b) => b.name)).toEqual(['TRcloud', 'เทียบราย SKU', 'ของใช้ภายใน', 'สรุป']);
    const [a1, a2, a3, a4] = book.map((b) => b.aoa);
    expect(a1.length).toBe(res.rows.length + 1);
    const b = a2.find((r) => r[0] === 'BBB0000000001');
    expect(b.slice(2, 16)).toEqual([7, 10, -3, 0, 0, 0, -1, 3, 2, 0, 2, 0, 1, 'หายเพิ่ม']);
    expect(b[17]).toBe(150);
    expect(a2.find((r) => r[0] === 'GGG0000000001')[19]).toMatch(/GGG0000000002/);
    expect(a2.find((r) => r[0] === 'FFF0000000001')[19]).toMatch(/ไม่มีในไฟล์ TRcloud/);
    expect(a3[1].slice(0, 4)).toEqual(['ถุงมือ', 'ถุงมือ', '', 10]);
    expect(a4.find((r) => r[0] === 'อนุมัติโดย')[1]).toMatch(/ร่าง/);
    expect(a4.find((r) => r[0] === 'มูลค่าสุทธิเข้า Loss')[1]).toBe(30);
  });

  it('ชีตสต๊อกสมมติของ dev server เข้ากับสมุดสมมติ', () => {
    const t = S.trcParse(loadStockApi(fakeStockTabs()).get({ api: 'stock-all' }));
    expect(t.n).toBeGreaterThan(20);
    expect(t.loss['YYY0000000001']).toBe(5);
  });
});
