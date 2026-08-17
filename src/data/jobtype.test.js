import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/wms-jobtype.js — reading a sales note and saying what kind
 * of job it is.
 *
 * The cases are not invented. Seven come from the worked examples in the
 * classification rules this file implements (delivery-note-classifier skill),
 * answers included; four are the real notes in the sample
 * รถบริษัท (หน้าLogis) sheet, labelled by reading them.
 *
 * The rules warn that real notes are too ambiguous for keyword matching, and a
 * browser has no way to actually read language. So what is tested here is not
 * "does it always get it right" — it is that the clear cases come out right and
 * the unclear ones are marked needsReview instead of being guessed. A wrong
 * confident answer sends a truck out with no room for the item it must bring
 * back; "อ่านเอง" costs someone ten seconds.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-jobtype.js'), 'utf8');

let JT;
beforeEach(() => {
  const win = {};
  new Function('window', SRC)(win);
  JT = win.WmsJobType;
});

const flagIds = (r) => r.flags.map((f) => f.id).sort();

describe('ตัวอย่างที่เฉลยไว้ในกฎ', () => {
  it('1 — ส่งหลังใหม่ รับหลังเดิมกลับ เพราะผ้าหุ้มขาด = SWAP', () => {
    const r = JT.classify(
      'จัดส่งที่นอน Lunio Quantum Max 2 Mattress ขนาด 5 ฟุต ให้ลุกค้าใหม่ เนื่องจากผ้าหุ้มพบรอยขาด ' +
      'และรับ Lunio Quantum Max 2 Mattress ขนาด 5ฟุต หลังเดิมกลับ สินค้ากางแล้ว รบกวนนำถุงคลุมไปด้วยนะคะ ทาง cs ให้เคลมค่ะ');
    expect(r.type).toBe(2);
    expect(r.hasReturn).toBe('มี');
    expect(flagIds(r)).toContain('cover');       // ต้องเอาถุงคลุมไปด้วย
    expect(r.needsReview).toBe(false);
  });

  it('1 — คำสะกดผิด "ลุกค้า" ต้องไม่ทำให้แยกประเภทพลาด', () => {
    expect(JT.classify('จัดส่งที่นอนให้ลุกค้าใหม่ เนื่องจากผ้าหุ้มพบรอยขาด และรับหลังเดิมกลับ').type).toBe(2);
  });

  it('2 — ส่งของพร้อมของแถม นัดบ่าย โทรก่อนถึง = DELIVERY', () => {
    const r = JT.classify('จัดส่งที่นอน 6 ฟุต พร้อมหมอน 2 ใบ ลูกค้าสั่งใหม่ นัดส่งช่วงบ่าย โทรก่อนถึง 30 นาที');
    expect(r.type).toBe(1);
    expect(r.hasReturn).toBe('ไม่มี');
    expect(flagIds(r)).toContain('call');
    expect(r.needsReview).toBe(false);
  });

  it('3 — ส่ง จนท. เข้าตรวจเช็ค ไม่มีรับกลับ = SERVICE', () => {
    const r = JT.classify('รบกวนส่ง จนท. เข้าตรวจเช็คที่นอนลูกค้า แจ้งว่ายุบผิดปกติ ถ่ายรูปหน้างานส่ง cs ด้วยค่ะ');
    expect(r.type).toBe(3);
    expect(r.hasReturn).toBe('ไม่มี');
  });

  it('4 — ส่งช่าง ถ้าซ่อมไม่ได้ให้รับกลับ = SERVICE และรับกลับแบบมีเงื่อนไข', () => {
    const r = JT.classify('ส่งช่างเข้าดูหน้างาน ถ้าซ่อมหน้างานไม่ได้ให้รับกลับมาที่โรงงาน');
    expect(r.type).toBe(3);
    expect(r.hasReturn).toBe('ไม่แน่ใจ');
  });

  it('5 — รับที่นอนกลับจากงานถ่ายโฆษณาที่ studio = EVENT_PICKUP', () => {
    const r = JT.classify('รับที่นอน 4 หลังกลับจากงานถ่ายโฆษณาที่ studio ลาดพร้าว ของทีม marketing งานถ่ายเสร็จวันศุกร์');
    expect(r.type).toBe(4);
    expect(r.hasReturn).toBe('มี');
  });

  it('6 — เคสหลอก: ส่งของไปออกบูธ ไม่ใช่ไปรับกลับ = DELIVERY', () => {
    const r = JT.classify('จัดส่งที่นอน 10 หลังไปบูธงานแฟร์ที่ไบเทค ติดตั้งก่อน 8 โมง');
    expect(r.type).toBe(1);
    expect(r.hasReturn).toBe('ไม่มี');
    expect(flagIds(r)).toContain('install');
  });

  it('7 — เคสกำกวม: รับของกลับเฉย ๆ ต้องไม่เดา ต้องตั้งธงให้คนอ่าน', () => {
    const r = JT.classify('เข้าไปรับที่นอนลูกค้ากลับมาค่ะ');
    expect(r.needsReview).toBe(true);
    expect(r.confidence).toBe('ต่ำ');
    expect(r.why).toMatch(/อาจเป็นเคลมหรือรับกลับเฉย ๆ/);
  });
});

describe('หมายเหตุจริงจากชีต รถบริษัท (หน้าLogis)', () => {
  it('ขอให้เจ้าหน้าที่ช่วยประกอบ = งานส่งของ ไม่ใช่ส่งช่างไปตรวจ', () => {
    // กับดักตัวจริง: มีคำว่า "เจ้าหน้าที่" แต่เป็นการขอให้ช่วยประกอบตอนไปส่ง
    const r = JT.classify('**รบกวนเจ้าหน้าที่ประกอบสินค้าให้ลูกค้าด้วยนะคะ // https://maps.app.goo.gl/iEB3nMTjE57FB');
    expect(r.type).toBe(1);
    expect(flagIds(r)).toEqual(['install', 'map', 'staff']);
  });

  it('ส่งเจ้าหน้าที่ไปเปลี่ยนปลอกหุ้ม และรับชิ้นเดิมกลับ = SWAP', () => {
    const r = JT.classify('*ส่งเจ้าหน้าที่*จัดส่งเปลี่ยนปลอกหุ้มที่นอนGen4 3.5FT.//และรับชิ้นเดิมกลับค่ะ');
    expect(r.type).toBe(2);
    expect(r.hasReturn).toBe('มี');
  });

  it('ขอช่วงบ่าย พร้อมติดตั้ง = DELIVERY ที่ต้องเผื่อเวลาติดตั้ง', () => {
    const r = JT.classify('ขอช่วงบ่ายนะคะ // พร้อมติดตั้งให้ลูกค้า');
    expect(r.type).toBe(1);
    expect(flagIds(r)).toContain('install');
  });

  it('แกะ ประกอบ ติดตั้ง ยกเข้าตัวบ้าน = DELIVERY ที่กินเวลา', () => {
    const r = JT.classify('จ่ายแล้ว ลค.สะดวก 14.00-15.00น. แกะ ประกอบ ติดตั้ง ยกเข้าตัวบ้าน');
    expect(r.type).toBe(1);
    expect(flagIds(r)).toContain('install');
    expect(r.hasReturn).toBe('ไม่มี');
  });
});

describe('ยอมรับว่าไม่รู้ ดีกว่าเดา', () => {
  it('ไม่มีหมายเหตุเลย = ต้องตั้งธง ไม่ใช่นับเป็นงานส่งทั่วไปเงียบ ๆ', () => {
    const r = JT.classify('');
    expect(r.needsReview).toBe(true);
    expect(r.why).toMatch(/ไม่มีหมายเหตุ/);
    expect(JT.classify(null).needsReview).toBe(true);
  });

  it('พูดถึงเคลมแต่ไม่บอกว่ารับของเดิมกลับ = ต้องตั้งธง', () => {
    const r = JT.classify('จัดส่งที่นอนตัวใหม่ให้ลูกค้า ทาง cs ให้เคลม');
    expect(r.needsReview).toBe(true);
    expect(r.hasReturn).toBe('ไม่มี');
  });

  it('ทุกผลลัพธ์บอกเหตุผลได้เสมอ — ตัวเลขที่อธิบายที่มาไม่ได้ ไม่มีใครกล้าใช้', () => {
    for (const n of ['จัดส่งปกติ', 'ส่งช่างเข้าดู', 'รับกลับจากบูธ', '']) {
      expect(JT.classify(n).why.length).toBeGreaterThan(10);
    }
  });
});

describe('summarise — ตัวเลขที่ใช้จัดรถ', () => {
  it('นับแยกประเภท งานที่ต้องรับของกลับ และงานที่ต้องอ่านเอง', () => {
    const notes = [
      'จัดส่งที่นอน 6 ฟุต โทรก่อนถึง 30 นาที',
      'จัดส่งตัวใหม่ เนื่องจากชำรุด และรับหลังเดิมกลับ',
      'ส่งช่างเข้าตรวจเช็คหน้างาน',
      'รับที่นอนกลับจากงานถ่ายโฆษณาที่ studio',
      'เข้าไปรับที่นอนลูกค้ากลับมาค่ะ',
      'ขอช่วงบ่ายนะคะ // พร้อมติดตั้งให้ลูกค้า',
    ];
    const s = JT.summarise(notes.map(JT.classify));
    expect(s.total).toBe(6);
    expect(s.byType).toEqual({ 1: 2, 2: 1, 3: 2, 4: 1 });
    expect(s.withReturn).toBe(3);      // SWAP + EVENT + เคสกำกวมที่รับกลับ
    expect(s.needsReview).toBe(1);
    expect(s.flags.install).toBe(1);
    expect(s.flags.call).toBe(1);
  });

  it('ไม่มีงานเลยก็ไม่พัง', () => {
    expect(JT.summarise([]).total).toBe(0);
    expect(JT.summarise(null).byType).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
  });
});

describe('แถวสำหรับไฟล์ Excel', () => {
  const job = (over = {}) => Object.assign({
    id: 'CR-2', carrier: 'รถบริษัท', customer: 'คุณเวชยันต์', phone: '064-7915965',
    address: 'บ้านเลขที่ 37/14', apptTime: '11.00น', date: '2026-08-18',
    note: '*ส่งเจ้าหน้าที่*จัดส่งเปลี่ยนปลอกหุ้ม และรับชิ้นเดิมกลับค่ะ',
  }, over);
  const rowsOf = (list) => JT.exportRows(list.map((j) => Object.assign({}, j, { job: JT.classify(j.note) })));

  it('คอลัมน์เดิมมาก่อน คอลัมน์ที่ระบบเติมต่อท้าย ตามที่กฎกำหนด', () => {
    const r = rowsOf([job()])[0];
    expect(Object.keys(r)).toEqual(JT.EXPORT_HEADERS);
    expect(JT.EXPORT_HEADERS.indexOf('หมายเหตุ')).toBeLessThan(JT.EXPORT_HEADERS.indexOf('ประเภทงาน'));
  });

  it('เก็บผลการจัดประเภทครบ รวมเหตุผล', () => {
    const r = rowsOf([job()])[0];
    expect(r['ประเภทงาน']).toBe(2);
    expect(r['ชื่อประเภท']).toBe('ส่งเปลี่ยน/เคลม');
    expect(r['มีรับของกลับ']).toBe('มี');
    // ไฟล์ถูกส่งต่อให้คนที่ไม่ได้นั่งดูหน้าจอตอนจัดประเภท ตัวเลขที่อธิบายไม่ได้ไม่มีใครใช้
    expect(r['เหตุผลที่จัดประเภทนี้'].length).toBeGreaterThan(20);
  });

  it('งานที่ต้องอ่านเองถูกทำเครื่องหมายไว้ในไฟล์ด้วย', () => {
    const r = rowsOf([job({ note: '' })])[0];
    expect(r['ต้องอ่านเอง']).toBe('ใช่');
    expect(r['ความมั่นใจ']).toBe('ต่ำ');
  });

  it('ไม่มีงานเลยก็ไม่พัง', () => {
    expect(JT.exportRows([])).toEqual([]);
    expect(JT.exportRows(null)).toEqual([]);
  });

  it('ชีตสรุปนับตรงกับรายละเอียด', () => {
    const list = [
      job(),
      job({ id: 'MM-3', note: 'รับที่นอน 4 หลังกลับจากงานถ่ายโฆษณาที่ studio' }),
      job({ id: 'AA-1', note: 'จัดส่งที่นอน 6 ฟุต โทรก่อนถึง 30 นาที' }),
    ].map((j) => Object.assign({}, j, { job: JT.classify(j.note) }));
    const sum = JT.exportSummary(list);
    const get = (k) => sum.find((r) => r['รายการ'] === k)['จำนวน'];
    expect(get('รวมทั้งหมด')).toBe(3);
    expect(get('ต้องรับของกลับ')).toBe(2);
    expect(get('ส่งเปลี่ยน/เคลม')).toBe(1);
    expect(get('รับกลับจากงาน')).toBe(1);
    // ยอดรวมต้องเท่ากับจำนวนแถวในชีตรายละเอียดเสมอ
    expect(get('รวมทั้งหมด')).toBe(JT.exportRows(list).length);
  });
});
