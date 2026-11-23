/**
 * เดินงานจริงครบทางบน emulator: Rules ไฟล์จริงไม่แก้สักตัว + Firebase SDK รุ่นเดียวกับเว็บ + firestoreStore() ใน public/wms-fire.js
 * เวลาเป็นเวลาเซิร์ฟเวอร์ของ emulator (serverTimestamp จริง transaction จริง query จริง)
 *
 *   node flow.mjs --dry   ซ้อมสคริปต์กับ store จำลอง (ไม่ต้องมี Java) ไม่ใช่ผลของ Rules จริง
 *
 * คนและสินค้าสมมติทั้งหมด อีเมลประกอบตอนรันจากโดเมนใน wms-fire-config.js อยู่ใน emulator เท่านั้น
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as E from './emulator.mjs';

const read = (f) => fs.readFileSync(new URL('../../public/' + f, import.meta.url), 'utf8');
const DAY = 86400000;
const STEP_MS = 60000;
const IMPORT = "import(SDK_URL + m + '.js')";

/** โหลดโค้ดแอปหนึ่งเครื่อง mods = SDK ที่ชี้ emulator */
function loadApp(mods) {
  const win = {};
  for (const f of ['wms-book.js', 'wms-fire-core.js', 'wms-fire-trc.js', 'wms-fire-docs.js', 'wms-fire-setup.js', 'wms-fire.js']) {
    let src = read(f);
    if (f === 'wms-fire.js') {
      if (src.split(IMPORT).length !== 2) throw new Error('ไม่เจอจุดโหลด SDK ใน wms-fire.js');
      src = src.replace(IMPORT, () => 'Promise.resolve(__sdk[m])');
    }
    new Function('window', 'location', '__sdk', src)(win, { hostname: 'rules.test' }, mods || {});
  }
  return win;
}

function config() {
  const win = {};
  new Function('window', read('wms-fire-config.js'))(win);
  return win.WMS_FIRE_CONFIG;
}

/* ── ฐานสองแบบ ── */

async function emulatorBase() {
  const APP = await import('firebase/app');
  const FS = await import('firebase/firestore');
  const pinned = JSON.parse(fs.readFileSync(new URL('./node_modules/firebase/package.json', import.meta.url), 'utf8')).version;
  const used = loadApp().WmsFire.SDK_V;
  if (pinned !== used) throw new Error('SDK ของเทสต์ ' + pinned + ' ไม่ตรงกับเว็บ ' + used);
  FS.setLogLevel('silent');
  const { name, port } = E.host(), apps = [];
  let n = 0;
  return {
    async project(id, data) {
      const project = 'demo-wms-' + id;
      await E.loadRules(project, E.rulesText());
      await E.clear(project);
      await E.seed(project, data);
      /** user = {email, verified} | null */
      return async function connect(user) {
        const label = 'device' + ++n;
        const win = loadApp({
          'firebase-app': {
            getApps: () => [],
            initializeApp: (cfg) => { const a = APP.initializeApp(cfg, label); apps.push(a); return a; },
          },
          'firebase-firestore': {
            ...FS,
            getFirestore(app) {
              const db = FS.getFirestore(app);
              const token = user ? { mockUserToken: { sub: user.email, email: user.email, email_verified: user.verified } } : {};
              FS.connectFirestoreEmulator(db, name, port, token);
              return db;
            },
          },
          'firebase-auth': {},
        });
        const made = await win.WmsFire.firestoreStore({ projectId: project, apiKey: 'demo-key', appId: 'demo-app' });
        return { win, store: made.store };
      };
    },
    async close() { await Promise.all(apps.map((a) => APP.deleteApp(a).catch(() => {}))); },
  };
}

function dryBase(domain) {
  return {
    async project(id, data) {
      const win = loadApp(), db = win.WmsFire.memStore({ domain });
      db.seed(data);
      return async function connect(user) {
        const store = db.connect();
        store.setUser(user);
        return { win, store };
      };
    },
    async close() {},
  };
}

/* ── ผลทีละข้อ ── */

function must(r) {
  if (!r || r.error) throw new Error(r ? r.error : 'ไม่มีคำตอบ');
  return r;
}
function same(got, want, what) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(what + ' ได้ ' + JSON.stringify(got) + ' คาด ' + JSON.stringify(want));
}
async function refused(promise) {
  try { await promise; } catch (e) {
    if (e && e.code === 'permission-denied') return;
    throw new Error('ถูกปฏิเสธด้วยเหตุอื่น: ' + (e && (e.code + ' ' + e.message)));
  }
  throw new Error('ผ่าน ทั้งที่ต้องถูกปฏิเสธ');
}

export async function flow({ dry = false } = {}) {
  const domain = config().domain, at = (who) => 'rules-test-' + who + '@' + domain;
  const win0 = loadApp(), C = win0.WmsFireCore, W = win0.WmsFire, TIME = C.TIME;
  const base = dry ? dryBase(domain) : await emulatorBase();
  const now = Date.now(), today = C.today(now), done = [], failed = [];
  const dmy = (day) => day.slice(8, 10) + '-' + day.slice(5, 7) + '-' + day.slice(2, 4);
  const past = C.today(now - 100 * DAY);

  async function step(name, fn) {
    let timer;
    try {
      const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('ค้างเกิน 60 วินาที')), STEP_MS); });
      await Promise.race([fn(), late]);
      done.push(name);
    } catch (e) {
      failed.push({ name, why: String((e && e.message) || e).split(domain).join('example.test').slice(0, 700) });
    } finally {
      clearTimeout(timer);
    }
  }

  const PEOPLE = {
    head: { name: 'หัวหน้าทดลอง', role: 'head', active: true },
    staff: { name: 'ลงรายการทดลอง', role: 'staff', active: true },
    staff2: { name: 'คลังทดลอง', role: 'staff', active: true },
    qa: { name: 'คิวเอทดลอง', role: 'staff', team: 'qa', active: true },
    view: { name: 'ดูอย่างเดียวทดลอง', role: 'viewer', active: true },
    off: { name: 'ปิดแล้ว', role: 'staff', active: false },
  };
  const roster = () => Object.fromEntries(Object.entries(PEOPLE).map(([k, v]) => ['users/' + at(k), { ...v }]));
  const accounts = Object.keys(PEOPLE).map((k) => ({ email: at(k), name: PEOPLE[k].name }));

  async function open(connect, who, extra = {}) {
    const { win, store } = await connect({ email: at(who), verified: true });
    const fire = win.WmsFire.open({ store, auth: win.WmsFire.fakeAuth(accounts), domain, ...extra });
    return { fire, store, login: () => fire.login(at(who)) };
  }

  const A = ['AAA001', 'AAA0000000001'], B = ['BBB002', 'BBB0000000002'];
  const NAMES = { AAA0000000001: 'ที่นอนสมมติ 1', BBB0000000002: 'ท็อปเปอร์สมมติ 2', CCC0000000004: 'หมอนสมมติ 4' };
  const OPEN = [
    [...A, NAMES.AAA0000000001, '8', 'P1', 'A-01-01', 500, 'เปิด', past, ''],
    [...B, NAMES.BBB0000000002, '7', 'P5', 'A-03-01', 4, 'เปิด', past, ''],
  ];
  const leg = (from, to, qty = 1, note = 'โอนย้าย') => [...A, '8', 'P1', from, to, qty, 'เบิก', note, 'เปิด'];
  const toQa = (qty = 1) => leg('A-01-01', 'QA', qty, 'โอนย้าย QA');
  const gr = (day, i = 1) => [...A, '10', 'P9', '', 'R01-02-01', i, 'รับ', 'GR ' + dmy(day), ''];
  let n = 0;
  const post = async (f, op, body) => must(await f.fire.post(op, { batch: 't-' + ++n, date: today, names: NAMES, ...body }));

  /* ── A. ฐานว่าง → วันทำงานหนึ่งวัน ── */

  const dbA = await base.project('day', roster());
  const p = {};
  for (const who of ['head', 'staff', 'staff2', 'qa', 'view']) {
    p[who] = await open(dbA, who, who === 'staff' ? { partBytes: 9000 } : {});
    await step('เข้าระบบ + เวลาเข้าล่าสุด: ' + who, async () => {
      must(await p[who].login());
      if (!((await p[who].store.get('users/' + at(who))).last > 0)) throw new Error('เขียน last ไม่สำเร็จ');
    });
  }
  await step('คนที่ปิดแล้วเข้าไม่ได้', async () => {
    const off = await open(dbA, 'off');
    if (!(await off.login()).error) throw new Error('เข้าได้');
  });
  await step('ตั้งข้อมูลหลักก่อนยอดยกมา', async () => {
    await p.head.store.commit([['master/sup', { v: 1, rows: '[]' }]]);
    await refused(p.staff.store.commit([['master/sup', { v: 1, rows: '[]' }]]));
  });
  await step('หัวหน้าลงยอดยกมา (สร้าง meta)', async () => {
    must(await p.head.fire.sync());
    await post(p.head, 'bk-open', { rows: OPEN });
    if (!(await p.head.store.get('meta/head')).open) throw new Error('ไม่มีตัวชี้ยอดยกมา');
  });
  for (const who of ['staff', 'staff2', 'qa', 'view']) {
    await step('ดึงของใหม่ (query seq): ' + who, async () => {
      await p[who].fire.sync();
      same(p[who].fire.local().docs.length, 1, 'จำนวนเอกสาร');
    });
  }

  await step('รับของ + ย้ายในคลัง', async () => {
    await post(p.staff, 'bk-gr', { copy: [gr(today, 3)] });
    await post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-02')] });
  });
  await step('โอน QA ครบทาง: เข้า รับ ออก รับ อนุมัติ ใส่เลข', async () => {
    const a = (await post(p.staff, 'bk-move', { copy: [toQa(2)] })).doc;
    must(await p.qa.fire.okSave([a], 'check'));
    const b = (await post(p.qa, 'bk-move', { copy: [leg('QA', 'A-01-03', 1, 'โอนย้าย QA')] })).doc;
    must(await p.staff.fire.okSave([b], 'check'));
    must(await p.head.fire.okSave([b, a], 'approve'));
    must(await p.staff2.fire.trSave([{ no: a, tr: 'TR-1', state: 'done' }, { no: b, tr: 'TR-2', state: 'done' }]));
    must(await p.staff.fire.trSave([{ no: a, tr: 'TR-1A', state: 'done' }]));
  });
  await step('ไม่รับใบโอน QA', async () => {
    const a = (await post(p.staff, 'bk-move', { copy: [toQa()] })).doc;
    must(await p.qa.fire.okSave([a], 'reject', 'ผิด LOT'));
  });
  await step('แปลงสินค้า', async () => {
    await post(p.staff, 'bk-conv', { copy: [
      [...B, '7', 'P5', 'A-03-01', '', 2, 'เบิก', 'แปลงสินค้า', '', 'MR6911-0001'],
      ['CCC004', 'CCC0000000004', '7', 'P5', '', 'A-03-01', 2, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR6911-0002'],
    ] });
  });
  await step('ปรับยอด + ยกเลิก (รหัส rev|เลขที่)', async () => {
    await p.head.fire.sync();
    const have = Object.values(C.allPiles(p.head.fire.local())).find((x) => x.loc === 'A-01-01' && x.long === A[1]).qty;
    const no = (await post(p.head, 'bk-adj', {
      copy: [[...A, '8', 'P1', 'A-01-01', '', 2, 'เบิก', 'ปรับยอด หาย', '']],
      lines: [{ loc: 'A-01-01', sku: A[1], lot: '8', po: 'P1', have, count: have - 2 }],
    })).doc;
    await post(p.head, 'bk-void', { doc: no, why: 'ทดสอบ' });
  });
  await step('ตัดขายใบใหญ่ 7 ส่วน (ชุดอ่านประกอบมากสุด)', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => ({ sys: 'JST', order: 'S' + i, ref: 'ON' + i, track: 'TH' + i, sku: A[1], qty: 0.05, piles: [['A-01-01', '8', 'P1', 0.05]] }));
    const copy = lines.map(() => [...A, '8', 'P1', 'A-01-01', '', 0.05, 'ขาย', today, 'เปิด']);
    let body = { batch: 't-big', date: today, base: 900, names: NAMES, lines, copy };
    await p.staff.fire.sync();
    /* หา partBytes เล็กสุดที่ยังไม่เกิน 7 ส่วน */
    const local = p.staff.fire.local(), user = p.staff.fire.user(), P = C.prep('bk-cut', body, Date.now());
    let size = 0, parts = 0;
    for (let b = 1500; b <= 120000 && !size; b = Math.ceil(b * 1.04)) {
      const pl = C.plan(P, { meta: local.meta, local, user, now: Date.now(), partBytes: b });
      if (!pl.error) { size = b; parts = pl.writes.length - 1; }
    }
    if (!size) throw new Error('แบ่งส่วนไม่ได้');
    const big = await open(dbA, 'staff', { partBytes: size });
    must(await big.login());
    must(await big.fire.post('bk-cut', body));
    same(parts, C.PARTS_MAX, 'จำนวนส่วน');
    await p.view.fire.sync();
    same(p.view.fire.local().docs.find((d) => d.id === 't-big').part, parts, 'ส่วนที่เครื่องอื่นเห็น');
  });

  let ten = [];
  await step('ทำใบโอน QA 10 ใบ', async () => {
    for (let i = 0; i < C.OK_MAX; i++) ten.push((await post(p.staff, 'bk-move', { copy: [toQa()] })).doc);
  });
  await step('รับ 10 ใบในคำขอเดียว', async () => { must(await p.qa.fire.okSave(ten, 'check')); });
  await step('อนุมัติ 10 ใบในคำขอเดียว', async () => { must(await p.head.fire.okSave(ten, 'approve')); });
  await step('ใส่เลข TRcloud 10 ใบในคำขอเดียว', async () => {
    must(await p.staff2.fire.trSave(ten.map((no, i) => ({ no, tr: 'TR-X' + i, state: 'done' }))));
  });
  await step('แก้เลข 10 ใบพร้อมประวัติ (กฎหนักสุด)', async () => {
    must(await p.staff.fire.trSave(ten.map((no, i) => ({ no, tr: 'TR-Y' + i, state: 'done' }))));
  });
  await step('รับ + อนุมัติ 10 ใบในคำขอเดียว', async () => {
    const list = [];
    for (let i = 0; i < C.OK_MAX; i++) list.push((await post(p.staff, 'bk-move', { copy: [toQa()] })).doc);
    must(await p.head.fire.okSave(list, 'both'));
  });
  await step('สองเครื่องบันทึกพร้อมกัน ได้คนละเลข', async () => {
    await Promise.all([p.staff.fire.sync(), p.staff2.fire.sync()]);
    const [a, b] = await Promise.all([
      post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-04')] }),
      post(p.staff2, 'bk-move', { copy: [leg('A-01-01', 'A-01-05')] }),
    ]);
    if (a.doc === b.doc) throw new Error('เลขซ้ำ ' + a.doc);
  });

  /*
   * ชนแบบตั้งใจ: ระหว่างเครื่องหนึ่งอ่านกับ commit อีกเครื่องเขียนเสร็จก่อน (ไม่ต้องลุ้นจังหวะ)
   * ฐานตัดสิน Rules กับข้อมูลปัจจุบันก่อนเช็คชนรุ่น → ได้ permission-denied · store.tx ต้องเห็นว่าข้อมูลที่อ่านเปลี่ยนแล้วลองใหม่เอง
   */
  async function race(name, dev, outer, inner) {
    await step('ชนกัน: ' + name, async () => {
      const tx = dev.store.tx;
      let ran = false;
      dev.store.tx = (fn) => tx.call(dev.store, async (t) => {
        const out = await fn(t);
        if (!ran) { ran = true; await inner(); }
        return out;
      });
      try { await outer(); } finally { dev.store.tx = tx; }
      if (!ran) throw new Error('ไม่ได้ชน (ไม่มี transaction)');
    });
  }
  const qa2 = await open(dbA, 'qa');
  await step('เครื่องที่สองของ QA', async () => { must(await qa2.login()); });
  const sup = (name) => win0.WmsFireTrc.readSheets([{ name: 'PO. Truck', grid: [['Truck', 'PO.'], [name, 'P1']] }]).sup;
  let q = [], g = [];
  await step('เตรียมใบสำหรับชนกัน', async () => {
    for (let i = 0; i < 2; i++) q.push((await post(p.staff, 'bk-move', { copy: [toQa()] })).doc);
    for (let i = 0; i < 3; i++) g.push((await post(p.staff, 'bk-gr', { copy: [gr(today, 1)] })).doc);
    await Promise.all([p.staff, p.staff2, p.head, p.qa, qa2].map((d) => d.fire.sync()));
  });
  await race('บันทึก ระหว่างอีกเครื่องบันทึก', p.staff,
    async () => { const a = await post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-07')] }); if (!a.doc) throw new Error('ไม่ได้เลข'); },
    async () => { await post(p.staff2, 'bk-move', { copy: [leg('A-01-01', 'A-01-08')] }); });
  await race('บันทึก ระหว่างอีกเครื่องรับใบโอน QA', p.staff,
    () => post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-07')] }),
    async () => { must(await p.qa.fire.okSave([q[0]], 'check')); });
  await race('บันทึก ระหว่างอีกเครื่องใส่เลข TRcloud', p.staff,
    () => post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-07')] }),
    async () => { must(await p.staff2.fire.trSave([{ no: g[0], tr: 'TR-R0', state: 'done' }])); });
  await race('บันทึก ระหว่างหัวหน้าแก้ตารางหลัก', p.staff,
    () => post(p.staff, 'bk-move', { copy: [leg('A-01-01', 'A-01-07')] }),
    async () => { must(await p.head.fire.masterSave('sup', sup('ผู้ผลิตสมมติ ก'))); });
  await race('รับใบโอน QA สองเครื่องคนละใบ', p.qa,
    async () => { must(await p.qa.fire.okSave([q[1]], 'check')); },
    async () => { must(await post(p.staff, 'bk-move', { copy: [toQa()] }).then((r) => qa2.fire.sync().then(() => qa2.fire.okSave([r.doc], 'check')))); });
  await race('ใส่เลข TRcloud สองเครื่องคนละใบ', p.staff,
    async () => { must(await p.staff.fire.trSave([{ no: g[1], tr: 'TR-R1', state: 'done' }])); },
    async () => { must(await p.staff2.fire.trSave([{ no: g[2], tr: 'TR-R2', state: 'done' }])); });
  await race('หัวหน้าแก้ตารางหลัก ระหว่างอีกเครื่องบันทึก', p.head,
    async () => { must(await p.head.fire.masterSave('sup', sup('ผู้ผลิตสมมติ ข'))); },
    async () => { await post(p.staff2, 'bk-move', { copy: [leg('A-01-01', 'A-01-08')] }); });
  await step('หลังชนกัน ทุกเครื่องเห็นเอกสารเท่ากัน ยอดตรวจผ่าน', async () => {
    await Promise.all([p.staff, p.staff2, p.head].map((d) => d.fire.sync()));
    same(p.staff.fire.local().docs.length, p.head.fire.local().docs.length, 'จำนวนเอกสาร staff กับ head');
    same(p.staff2.fire.local().seq, p.head.fire.local().seq, 'seq staff2 กับ head');
    const sv = (await p.head.store.get('master/sup')) || {};
    if (!String(sv.rows || '').includes('ผู้ผลิตสมมติ ข')) throw new Error('ตารางหลักไม่ใช่ชุดล่าสุด');
  });
  await step('เปลี่ยนชื่อระหว่างเปิดหน้า แล้วส่งซ้ำเอง', async () => {
    must(await p.head.fire.saveUser(at('staff2'), { name: 'คลังชื่อใหม่', role: 'staff' }));
    await post(p.staff2, 'bk-move', { copy: [leg('A-01-01', 'A-01-06')] });
  });
  await step('ฟัง meta/head แบบหน้าเว็บ', async () => {
    let off = () => {};
    try {
      await new Promise((res, rej) => { off = p.view.store.onMeta((m) => { if (m && m.seq) res(); }, rej); });
    } finally {
      off();
    }
  });
  await step('query ตามเวลาแก้เลข / อนุมัติ', async () => {
    if (!(await p.view.store.trAfter(now - DAY)).length) throw new Error('trAfter ว่าง');
    if (!(await p.view.store.okAfter(now - DAY)).length) throw new Error('okAfter ว่าง');
  });
  await step('รายชื่อ โควตา ผลตรวจ สำรอง', async () => {
    must(await p.head.fire.users());
    must(await p.head.fire.quota());
    must(await p.head.fire.auditInfo());
    must(await p.head.fire.backup());
  });
  await step('ตัวนับโควตาของเครื่อง', async () => {
    const key = C.pacificDay(now);
    await p.view.store.patch('use/' + key, { dtest: { r: 1, w: 1, by: 'ทดสอบ' } });
    await refused(p.view.store.patch('use/' + key, { da: { r: 1 }, db: { r: 1 } }));
  });
  await step('บันทึกวางชีตเดิม', async () => { must(await p.staff.fire.xferMark(today, { rows: 1, last: 'ทดสอบ' })); });
  await step('นำเข้ายอด TRcloud: หัวหน้าเท่านั้น', async () => {
    await p.head.store.commit([['trc/' + today, { v: 1, rows: '[]' }]]);
    await refused(p.staff.store.commit([['trc/' + today, { v: 1, rows: '[]' }]]));
  });

  /* คำสั่งที่ประกอบเอง ไม่ผ่านหน้าเว็บ */
  async function forge(id, dd = {}, mm = {}, by = 'staff') {
    const old = await p.head.store.get('meta/head'), me = await p.head.store.get('users/' + at(by));
    const month = C.yymm(Date.now()), next = old.month === month ? old.next : 1, seq = old.seq + 1;
    const d = {
      v: 1, no: 'T' + month + '-' + String(next).padStart(4, '0'), seq, row: old.rows + 2, n: 1, type: 'ย้าย', date: today,
      by: at(by), name: me.name, at: TIME, stamp: C.stamp(Date.now()), ref: '', link: '', why: '', qty: 1, tr: '', trState: 'none',
      rows: C.enc([[...leg('A-01-01', 'A-01-07'), '']]), names: '', orders: '', part: 1, ...dd,
    };
    /* at ของ meta เดิมอ่านกลับมาเป็นตัวเลข จึงต้องใส่ตัวแทนเวลาใหม่ทุกครั้ง */
    const m = { ...old, seq, month, next: next + 1, last: id, rows: old.rows + 1, at: TIME, ...mm };
    return [['docs/' + id, d], ['meta/head', m]];
  }
  await step('ตัวคุม: ชุดประกอบเองที่ถูกทุกข้อผ่าน', async () => {
    await p.staff.store.commit(await forge('fk-good'));
  });
  const BAD = [
    ['ใบใหม่มีผู้รับมาแล้ว', { ck: at('staff') }],
    ['ใบใหม่มีผู้อนุมัติมาแล้ว', { ap: at('staff') }],
    ['ชื่อคนทำไม่ตรงรายชื่อ', { name: 'คนอื่น' }],
    ['by เป็นคนอื่น', { by: at('head') }],
    ['at ไม่ใช่เวลาเซิร์ฟเวอร์', { at: 5 }],
    ['ย้อนวันเกิน 45 วัน', { date: C.today(now - 47 * DAY) }],
    ['วันล่วงหน้าเกิน 1 วัน', { date: C.today(now + 3 * DAY) }],
    ['ช่องหัวใบผิดชนิด', { qty: 'มาก' }],
    ['จำนวนส่วนเกิน 7', { part: 8 }],
    ['คนลงรายการทำปรับยอด', { type: 'ปรับยอด' }],
    ['ช่องแปลก', { hidden: 1 }],
    ['เปลี่ยนตัวชี้ยอดยกมา', {}, { open: { id: 'fk-bad', no: 'T0000-0000', seq: 1 } }],
    ['แก้แถวรวม', {}, { rows: 1 }],
    ['ข้าม seq', {}, { seq: 99999 }],
  ];
  for (let i = 0; i < BAD.length; i++) {
    await step('ปฏิเสธ: ' + BAD[i][0], async () => {
      await refused(p.staff.store.commit(await forge('fk-bad' + i, BAD[i][1], BAD[i][2])));
    });
  }
  await step('ปฏิเสธ: รหัสชุดที่ทำหน้าเว็บล่ม', async () => { await refused(p.staff.store.commit(await forge('constructor'))); });
  await step('ปฏิเสธ: ผู้ดูอย่างเดียวบันทึก', async () => { await refused(p.view.store.commit(await forge('fk-view', {}, {}, 'view'))); });
  await step('ปฏิเสธ: แก้แถวของใบเดิม', async () => { await refused(p.staff.store.patch('docs/t-big', { rows: 'x' })); });
  await step('ปฏิเสธ: แก้ส่วนแยก', async () => { await refused(p.staff.store.patch('docs/t-big~2', { rows: 'x' })); });
  await step('ปฏิเสธ: เลื่อนสิทธิ์ตัวเอง', async () => { await refused(p.staff.store.patch('users/' + at('staff'), { role: 'head' })); });
  await step('ปฏิเสธ: เขียนผลตรวจ แม้เป็นหัวหน้า', async () => { await refused(p.head.store.commit([['audit/last', { n: 0 }]])); });
  await step('ปฏิเสธ: คอลเลกชันอื่น', async () => { await refused(p.head.store.commit([['bal/x', { q: 1 }]])); });

  /* การอ่าน: store จำลองไม่เช็คครบ จึงมีเฉพาะบน emulator */
  if (!dry) {
    await step('อ่านไม่ได้: คนลงรายการดูทั้งรายชื่อ', async () => { await refused(p.staff.store.list('users')); });
    await step('อ่านไม่ได้: คนลงรายการดูผลตรวจ', async () => { await refused(p.staff.store.get('audit/last')); });
    const strangers = [
      ['คนที่ปิดแล้ว', { email: at('off'), verified: true }],
      ['คนไม่มีในรายชื่อ', { email: at('nobody'), verified: true }],
      ['อีเมลยังไม่ยืนยัน', { email: at('head'), verified: false }],
      ['อีเมลนอกโดเมน', { email: 'head@example.test', verified: true }],
      ['ไม่ล็อกอิน', null],
    ];
    for (const [name, user] of strangers) {
      await step('อ่านไม่ได้: ' + name, async () => {
        const { store } = await dbA(user);
        await refused(store.get('meta/head'));
        await refused(store.docsAfter(0, 10));
        await refused(store.get('master/sup'));
      });
    }
  }

  /* ── B. มีประวัติเดือนก่อน → ขึ้นเดือนใหม่ ปิดเดือน ── */

  let dbB = null;
  await step('เตรียมประวัติเดือนก่อน', async () => {
    const then = now - 35 * DAY, day = C.today(then), mem = W.memStore({ now: () => then, domain });
    mem.seed(roster());
    const dev = async (who) => {
      const f = W.open({ store: mem.connect(), auth: W.fakeAuth(accounts), now: () => then, domain });
      must(await f.login(at(who)));
      return f;
    };
    const h = await dev('head');
    must(await h.post('bk-open', { batch: 'b-open', rows: OPEN, names: NAMES }));
    const s = await dev('staff');
    for (let i = 0; i < 24; i++) must(await s.post('bk-gr', { batch: 'b-' + i, date: day, names: NAMES, copy: [gr(day, 1)] }));
    dbB = await base.project('month', mem.dump());
  });
  if (dbB) {
    const h = await open(dbB, 'head', { archBytes: 1500 }), s = await open(dbB, 'staff');
    await step('เดือนใหม่เริ่มเลข 0001', async () => {
      must(await h.login());
      must(await s.login());
      const no = (await post(s, 'bk-gr', { copy: [gr(today)] })).doc;
      same(no.slice(-4), '0001', 'เลขเอกสาร');
    });
    await step('ปิดเดือนหลายก้อน', async () => {
      const r = must(await h.fire.archClose());
      if (r.chunks < 6) throw new Error('ได้ ' + r.chunks + ' ก้อน ไม่พอทดสอบชุดละ 6');
    });
    await step('ปฏิเสธ: เขียนทับเดือนที่ปิดแล้ว', async () => {
      const idx = await h.store.get('arch/index'), m = idx.months[0].m, key = 'arch/' + m + '-1';
      await refused(h.store.commit([[key, { ...(await h.store.get(key)), text: 'ทับ' }]]));
    });
    await step('เครื่องใหม่หลังปิดเดือน', async () => {
      const v = await open(dbB, 'view');
      must(await v.login());
      await v.fire.sync();
      await h.fire.sync();
      same(v.fire.local().docs.length, h.fire.local().docs.length, 'จำนวนเอกสาร');
    });
  }

  await base.close();
  return { done, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dry = process.argv.includes('--dry');
  const r = await flow({ dry });
  for (const f of r.failed) console.log('FAIL ' + f.name + ' : ' + f.why);
  console.log((dry ? 'ซ้อมกับ store จำลอง' : 'emulator') + ': ผ่าน ' + r.done.length + ' ตก ' + r.failed.length);
  process.exit(r.failed.length ? 1 : 0);
}
