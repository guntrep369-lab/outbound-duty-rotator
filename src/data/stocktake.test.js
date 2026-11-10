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
