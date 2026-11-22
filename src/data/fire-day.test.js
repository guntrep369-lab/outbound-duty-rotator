/**
 * ระบบใหม่บน Firebase ขั้น 4: ซ้อมทั้งวันด้วยข้อมูลทดลอง เช็คว่าโควตาฟรีพอ
 *
 * เดินโค้ดจริงของ public/wms-fire.js กับ store จำลอง (นับอ่าน/เขียนแบบ Firestore รวมการฟัง meta/head)
 * ประวัติ 30 วันหลังขึ้นระบบ แล้วจำลองวันทำงานปกติ 08:00–18:00 ทั้งบริษัท:
 *   18 เครื่อง (หัวหน้า 2 ลงรายการ 8 Inbound 3 QA 3 ดูอย่างเดียว 2) เปิดหน้าคนละ 3 รอบ ทุกเครื่องเปิดค้างฟังการบันทึกทั้งวัน (เผื่อสูงกว่าจริงที่ ~60%)
 *   ตัดขาย 6 รอบ × 500 บรรทัด (3,000 บรรทัดออเดอร์) ย้าย/เติม 40 เข้า QA 5 ออก QA 5 รับของ 12 คืน 15 แปลง 2 ปรับยอด 4
 *   หัวหน้า: รอลง TRcloud + ใส่เลข 5 รอบ วางชีตเดิม 1 ครั้ง ดูโควตา 3 ครั้ง ดูรายชื่อ ดาวน์โหลดสำรอง
 *   ใบโอน QA: ผู้รับกดรับทีละใบใน 20 นาที (เข้า = QA รับ · ออก = Inbound รับ) หัวหน้าอนุมัติแล้วจึงรอลง TRcloud
 *   ตรวจ / อนุมัติใบย้าย / แปลงของวัน: ลงรายการคนอื่นตรวจ 7 รอบ หัวหน้าอนุมัติ 7 รอบ (รอบสุดท้ายก่อนกลับ) (รอบละไม่เกิน 3 ครั้ง × 10 ใบ)
 *   เครื่องใหม่ 1 เครื่องโหลดประวัติทั้งหมด (โทรศัพท์ใหม่ / ล้างเบราว์เซอร์)
 * ปิดเดือน: ประวัติ 61 วัน (21 ธ.ค. – 19 ก.พ.) หัวหน้าปิด ธ.ค. กับ ม.ค. แล้วเครื่องใหม่อ่านก้อน อ่านน้อยลงมาก สำเนาเท่าเดิมทุกช่อง
 * เป้าวันปกติทั้งบริษัท: อ่าน < 15,000 เขียน < 2,000 · วันแคมเปญ (งาน × 3) ต้องไม่เกินโควตาฟรี อ่าน 50,000 เขียน 20,000
 * นับทั้งวันทำงานไทยเป็นวันเดียว (จริง ๆ โควตาเริ่มใหม่ตอน 15:00 ไทย แบ่งเป็นสองวัน) จึงเผื่อไว้แล้ว
 * ข้อมูลทั้งหมดสมมติขึ้น ไม่มีการเรียก Firebase จริง
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(__dirname, '../../public', f), 'utf8');

let C, W;
beforeAll(() => {
  const win = {};
  ['wms-book.js', 'wms-fire-core.js', 'wms-fire-trc.js', 'wms-fire.js'].forEach((f) => new Function('window', read(f))(win));
  C = win.WmsFireCore;
  W = win.WmsFire;
  globalThis.window = globalThis.window || win;
  globalThis.window.WmsFireTrc = win.WmsFireTrc;
});

const HOUR = 3600000, MIN = 60000, DAY = 86400000;
const DOMAIN = 'example.test';
const GO_LIVE = Date.UTC(2026, 11, 21, 1, 0, 0);   // 21 ธ.ค. 2569 08:00 ไทย
const SKUS = 60;

const pad = (n, w) => String(n).padStart(w, '0');
const long = (i) => 'SIM' + pad(i, 10);
const short = (i) => 'SIM' + pad(i, 3);
const name = (i) => 'สินค้าสมมติ ' + i;
const openLoc = (i) => 'A-' + pad(Math.floor(i / 10) + 1, 2) + '-' + pad((i % 10) + 1, 2);
const resLoc = (i) => 'R' + pad(Math.floor(i / 10) + 1, 2) + '-' + pad((i % 10) + 1, 2) + '-01';
const NAMES = Object.fromEntries(Array.from({ length: SKUS }, (_, i) => [long(i), name(i)]));

/** สุ่มแบบกำหนดผลได้ (ผลเทสต์เท่าเดิมทุกรอบ) */
function rnd(seed) {
  let s = seed >>> 0;
  return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; };
}

const USERS = [
  ...[1, 2].map((n) => ({ email: `head${n}@${DOMAIN}`, name: `หัวหน้าสมมติ ${n}`, role: 'head' })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ email: `staff${n}@${DOMAIN}`, name: `พนักงานสมมติ ${n}`, role: 'staff' })),
  ...[1, 2, 3].map((n) => ({ email: `inbound${n}@${DOMAIN}`, name: `Inbound สมมติ ${n}`, role: 'staff' })),
  ...[1, 2, 3].map((n) => ({ email: `qa${n}@${DOMAIN}`, name: `QA สมมติ ${n}`, role: 'staff', team: 'qa' })),
  ...[1, 2].map((n) => ({ email: `view${n}@${DOMAIN}`, name: `ดูอย่างเดียวสมมติ ${n}`, role: 'viewer' })),
  { email: `newphone@${DOMAIN}`, name: 'เครื่องใหม่สมมติ', role: 'staff' },
];

function ok(r) { if (!r || r.error) throw new Error((r && r.error) + ' ' + JSON.stringify(r && (r.bad || r.short || '')).slice(0, 300)); return r; }

async function setup() {
  let t = GO_LIVE - DAY;
  const clock = () => t;
  const store = W.memStore({ now: clock, domain: DOMAIN });
  const data = {};
  USERS.forEach((u) => { data['users/' + u.email] = Object.assign({ name: u.name, role: u.role, active: true }, u.team ? { team: u.team } : {}); });
  store.seed(data);
  /* เครื่องหนึ่ง = สำเนาในเครื่อง (cache) + ตัวนับ (meter) ที่อยู่ข้ามการเปิดหน้า · เปิดหน้าใหม่ = connection ใหม่ */
  /* สำเนาในเครื่องเก็บแบบอ้างถึง (memCache คัดลอกทั้งก้อนทุกครั้ง ช้าเกินในเทสต์ยาว) ไม่กระทบยอดอ่าน/เขียน */
  const refCache = () => { let saved = null; return { load: async () => saved, put: async (l) => { saved = l; }, clear: async () => { saved = null; } }; };
  const devices = USERS.map((u) => ({ u, cache: refCache(), meter: W.memMeter(), fire: null, stop: null, dirty: false }));
  async function openPage(d, watch) {
    if (d.stop) { d.stop(); d.stop = null; }
    d.fire = W.open({ store: store.connect(), auth: W.fakeAuth(USERS), cache: d.cache, meter: d.meter, now: clock, domain: DOMAIN });
    ok(await d.fire.login(d.u.email));
    await d.fire.sync();
    if (watch) d.stop = d.fire.watch(() => { d.dirty = true; });
    return d.fire;
  }
  const by = (email) => devices.find((d) => d.u.email === email);
  return { store, clock, devices, openPage, by, set: (ms) => { t = ms; }, tick: (ms) => { t += ms; } };
}

/** งานหนึ่งวัน k = กี่เท่าของวันปกติ · lines = บรรทัดต่อรอบตัด (ประวัติใช้น้อยลงให้เทสต์เร็ว จำนวนเอกสารเท่ากัน) */
function plan(day, k, lines, r) {
  const ymd = C.today(day);
  const dmy = ymd.slice(8, 10) + '-' + ymd.slice(5, 7) + '-' + ymd.slice(2, 4);
  const lot = String(+ymd.slice(5, 7));
  const jobs = [];
  const at = (h) => day + h * HOUR;   // ชั่วโมงหลัง 08:00
  for (let c = 0; c < 6 * k; c++) {
    const L = [], copy = [];
    for (let n = 0; n < lines; n++) {
      const i = r(SKUS), q = 1 + (r(5) === 0 ? 1 : 0);
      const order = 'O' + ymd.replace(/-/g, '') + pad(c, 2) + pad(n, 4);
      L.push({ sys: 'JST', order, ref: 'ON' + order, track: 'TH' + order, sku: long(i), qty: q, piles: [[openLoc(i), '11', 'P' + i, q]] });
      copy.push([short(i), long(i), '11', 'P' + i, openLoc(i), '', q, 'ขาย', ymd, 'เปิด']);
    }
    jobs.push({ at: at(0.5 + (9 / (6 * k)) * c), who: 'staff' + (1 + (c % 2)), op: 'bk-cut', body: { batch: `c-${ymd}-${c}`, date: ymd, base: 0, names: NAMES, lines: L, copy } });
  }
  const row = (i, from, to, q, type, note, st, tr) => [short(i), long(i), '11', 'P' + i, from, to, q, type, note, st].concat(tr ? [tr] : []);
  const spread = (n, f) => { for (let j = 0; j < n; j++) f(j, at(0.2 + (9.5 * j) / n)); };
  spread(40 * k, (j, ms) => { const i = r(SKUS); jobs.push({ at: ms, who: 'staff' + (3 + (j % 4)), op: 'bk-move', body: { batch: `m-${ymd}-${j}`, date: ymd, base: 0, names: NAMES, copy: [row(i, resLoc(i), openLoc(i), 5, 'เบิก', 'โอนย้าย', 'เปิด')] } }); });
  /* เข้า QA ช่วงเช้า ออกช่วงบ่าย ของชิ้นเดียวกัน (รับก่อนใช้ต่อ) · ผู้รับกดรับใน 20 นาที */
  for (let j = 0; j < 5 * k; j++) {
    const i = r(SKUS), batch = `${ymd}-${j}`;
    jobs.push({ at: at(0.2 + (4 * j) / (5 * k)), who: 'inbound' + (1 + (j % 2)), take: 'qa' + (1 + (j % 2)), op: 'bk-move',
      body: { batch: 'q-' + batch, date: ymd, base: 0, names: NAMES, copy: [row(i, openLoc(i), 'QA', 1, 'เบิก', 'โอนย้าย QA', '')] } });
    jobs.push({ at: at(5 + (4 * j) / (5 * k)), who: 'qa' + (1 + (j % 3)), take: 'inbound' + (1 + (j % 3)), op: 'bk-move',
      body: { batch: 'o-' + batch, date: ymd, base: 0, names: NAMES, copy: [row(i, 'QA', openLoc(i), 1, 'เบิก', 'โอนย้าย QA', 'เปิด')] } });
  }
  spread(12 * k, (j, ms) => {
    const i = r(SKUS);
    jobs.push({ at: ms, who: 'staff8', op: 'bk-gr', body: { batch: `g-${ymd}-${j}`, date: ymd, base: 0, names: NAMES,
      copy: [[short(i), long(i), lot, 'G' + i, '', resLoc(i).replace(/-01$/, '-02'), 50, 'รับ', 'GR ' + dmy, '']] } });
  });
  spread(15 * k, (j, ms) => {
    const i = r(SKUS);
    jobs.push({ at: ms, who: 'staff' + (5 + (j % 2)), op: 'bk-return', body: { batch: `r-${ymd}-${j}`, date: ymd, base: 0,
      lines: [{ sys: '', order: '', sku: long(i), qty: 1, piles: [['RIB', '0', '0', 1]] }], copy: [[short(i), long(i), '0', '0', '', 'RIB', 1, 'รับ', 'RETURN', '']] } });
  });
  spread(2 * k, (j, ms) => {
    const a = r(SKUS), b = (a + 1) % SKUS;
    jobs.push({ at: ms, who: 'staff8', op: 'bk-conv', body: { batch: `v-${ymd}-${j}`, date: ymd, base: 0, names: NAMES, copy: [
      [short(a), long(a), '11', 'P' + a, openLoc(a), '', 1, 'เบิก', 'แปลงสินค้า', '', 'MR' + j],
      [short(b), long(b), '11', 'P' + a, '', openLoc(b), 1, 'รับ', 'แปลงสินค้า', 'เปิด', 'GR' + j]] } });
  });
  spread(4 * k, (j, ms) => jobs.push({ at: ms, who: 'head' + (1 + (j % 2)), op: 'bk-adj', adj: r(SKUS), batch: `a-${ymd}-${j}`, ymd }));
  return jobs.sort((a, b) => a.at - b.at);
}

/** ปรับยอดต้องใส่ยอดที่เห็นในเครื่อง (ยอดเปลี่ยนระหว่างนับ = ไม่รับ) */
function adjBody(f, job) {
  const i = job.adj;
  const p = Object.values(C.allPiles(f.local())).find((x) => x.long === long(i) && x.loc === openLoc(i) && x.lot === '11' && x.po === 'P' + i);
  return { batch: job.batch, date: job.ymd, base: 0, names: NAMES,
    copy: [[short(i), long(i), '11', 'P' + i, openLoc(i), '', 1, 'เบิก', 'ปรับยอด หาย', '']],
    lines: [{ loc: openLoc(i), sku: long(i), lot: '11', po: 'P' + i, have: p.qty, count: p.qty - 1 }] };
}

async function runJob(env, f, job) {
  const body = job.op === 'bk-adj' ? adjBody(f, job) : job.body;
  return ok(await f.post(job.op, body));
}

/** ยอดยกมาวันขึ้นระบบ + ประวัติ n วัน (เครื่องเดียวบันทึก ไม่นับ) แล้วทุกเครื่องมีสำเนาถึงเมื่อวาน */
async function history(env, n) {
  const head = await env.openPage(env.by(`head1@${DOMAIN}`), false);
  const head2 = await env.openPage(env.by(`head2@${DOMAIN}`), false);
  const rows = [];
  for (let i = 0; i < SKUS; i++) {
    rows.push([short(i), long(i), name(i), '11', 'P' + i, openLoc(i), 200000, 'เปิด', '2026-11-01', '']);
    rows.push([short(i), long(i), name(i), '11', 'P' + i, resLoc(i), 200000, '', '2026-11-01', '']);
  }
  ok(await head.post('bk-open', { batch: 'open', rows }));
  const r = rnd(7);
  for (let d = 0; d < n; d++) {
    const day = GO_LIVE + d * DAY;
    for (const job of plan(day, 1, 40, r)) {
      env.set(job.at);
      const saved = await runJob(env, head, job);
      if (!job.take) continue;
      /* ใบโอน QA: หัวหน้าอีกคนรับ + อนุมัติ (คนทำรับเองไม่ได้ · รับก่อนจึงออกได้) */
      await head2.sync();
      ok(await head2.okSave([saved.doc], 'both'));
      await head.sync();
    }
    /* หัวหน้าใส่เลข TRcloud ท้ายวัน ให้รายการรอลงไม่พอกขึ้นเรื่อย ๆ */
    env.set(day + 9.8 * HOUR);
    await trRound(head, 10, 3);
  }
  env.set(GO_LIVE + n * DAY - 13 * HOUR);   // เมื่อวาน 19:00
  for (const d of env.devices) if (d.u.email !== `newphone@${DOMAIN}`) await env.openPage(d, false);
}

/** ใส่เลข TRcloud ครั้งละไม่เกิน 10 เอกสาร rounds รอบ */
async function trRound(f, per, rounds) {
  for (let k = 0; k < rounds; k++) {
    const list = ok(await f.trList()).list.filter((d) => d.state === 'wait' && !d.lock).slice(0, per);
    if (!list.length) return;
    ok(await f.trSave(list.map((d) => ({ no: d.no, tr: 'TR' + d.no.slice(1), state: 'done' }))));
  }
}

/**
 * ตรวจ / อนุมัติใบย้าย / แปลงของวันนี้ ทีละไม่เกิน 10 ใบ ไม่เกิน 3 ครั้งต่อรอบ
 * check: พนักงาน 8 ตรวจ (ใบที่พนักงาน 8 ทำเอง ให้พนักงาน 7 ตรวจ) · approve: หัวหน้า 1 อนุมัติ
 */
async function okRound(env, day, act) {
  const ymd = C.today(day);
  const who = act === 'check' ? [`staff8@${DOMAIN}`, `staff7@${DOMAIN}`] : [`head1@${DOMAIN}`];
  let calls = 0;
  for (const email of who) {
    const f = env.by(email).fire;
    await f.sync();   // หน้าเห็นของที่คนอื่นเพิ่งตรวจ (ฟัง meta อยู่แล้ว ปกติอ่านแค่ meta)
    while (calls < 3) {
      const l = f.local(), vd = C.voids(l), want = act === 'check' ? C.OK_CHECK : C.OK_APPROVE;
      const list = l.docs.filter((d) => (d.stamp || '').slice(0, 10) === ymd && C.okState(d, vd) === want && (act !== 'check' || (d.by !== email && !C.xfKind(d)))).slice(0, C.OK_MAX);
      if (!list.length) break;
      ok(await f.okSave(list.map((d) => d.no), act));
      calls++;
    }
  }
  return calls;
}

/** วันทำงานหนึ่งวัน คืนยอดอ่าน/เขียนทั้งระบบ แยกส่วน */
async function workDay(env, day, k) {
  const before = env.store.stats();
  const part = {};
  const mark = (key, s0) => { const s = env.store.stats(); part[key] = part[key] || { r: 0, w: 0 }; part[key].r += s.reads - s0.reads; part[key].w += s.writes - s0.writes; };
  const regular = env.devices.filter((d) => d.u.email !== `newphone@${DOMAIN}`);
  /* เปิดหน้า 3 รอบต่อคน: เช้า หลังพักเที่ยง และรีเฟรชอีกหนึ่งครั้ง */
  const opens = [0, 4.5, 7].map((h) => day + h * HOUR);
  const jobs = plan(day, k, 500, rnd(99 + k));
  const extra = [
    ...[1.5, 4, 6.5, 8.5, 9.5].map((h) => ({ at: day + h * HOUR, kind: 'tr' })),
    ...[1, 2.5, 4.2, 5.8, 7.5, 9.3, 9.95].map((h) => ({ at: day + h * HOUR, kind: 'check' })),
    ...[1.2, 3, 4.6, 6.2, 8, 9.4, 9.97].map((h) => ({ at: day + h * HOUR, kind: 'approve' })),
    { at: day + 9.6 * HOUR, kind: 'xfer' },
    ...[2, 6, 9.7].map((h) => ({ at: day + h * HOUR, kind: 'quota' })),
    { at: day + 3 * HOUR, kind: 'users' },
    { at: day + 9.9 * HOUR, kind: 'backup' },
    { at: day + 5 * HOUR, kind: 'fresh' },
  ];
  const takes = jobs.filter((j) => j.take).map((j) => ({ at: j.at + 20 * MIN, kind: 'recv', who: j.take, from: j.body.batch }));
  const doc = {};
  const events = [...opens.map((at) => ({ at, kind: 'open' })), ...jobs.map((j) => ({ ...j, kind: 'job' })), ...takes, ...extra].sort((a, b) => a.at - b.at);
  let saves = 0;
  for (const e of events) {
    env.set(e.at);
    const s0 = env.store.stats();
    if (e.kind === 'open') {
      for (const d of regular) await env.openPage(d, true);
      mark('เปิดหน้า (ล็อกอิน + ดึงของใหม่)', s0);
      continue;
    }
    if (e.kind === 'job') {
      const d = env.by(e.who + '@' + DOMAIN);
      const saved = await runJob(env, d.fire, e);
      if (e.take) doc[e.body.batch] = saved.doc;
      saves++;
      mark('บันทึก (transaction)', s0);
    } else if (e.kind === 'recv') {
      const f = env.by(e.who + '@' + DOMAIN).fire;
      await f.sync();
      ok(await f.okSave([doc[e.from]], 'check'));
      mark('ผู้รับกดรับใบโอน QA', s0);
    } else if (e.kind === 'tr') {
      const h = env.by(`head2@${DOMAIN}`).fire;
      await trRound(h, 10, 1);
      mark('หัวหน้า: รอลง + ใส่เลข TRcloud', s0);
    } else if (e.kind === 'check' || e.kind === 'approve') {
      await okRound(env, day, e.kind);
      mark('ตรวจ / อนุมัติใบย้าย แปลง', s0);
    } else if (e.kind === 'xfer') {
      const h = env.by(`head1@${DOMAIN}`).fire;
      const ds = ok(await h.xferDays()).days;
      const t = h.xferText(ds[0].day);
      ok(await h.xferMark(ds[0].day, { rows: t.rows, last: t.last }));
      mark('หัวหน้า: วางชีตเดิม', s0);
    } else if (e.kind === 'quota') {
      ok(await env.by(`head1@${DOMAIN}`).fire.quota());
      mark('หัวหน้า: ดูโควตา รายชื่อ สำรอง', s0);
    } else if (e.kind === 'users') {
      ok(await env.by(`head1@${DOMAIN}`).fire.users());
      mark('หัวหน้า: ดูโควตา รายชื่อ สำรอง', s0);
    } else if (e.kind === 'backup') {
      ok(await env.by(`head1@${DOMAIN}`).fire.backup());
      mark('หัวหน้า: ดูโควตา รายชื่อ สำรอง', s0);
    } else if (e.kind === 'fresh') {
      const f = await env.openPage(env.by(`newphone@${DOMAIN}`), true);
      part.freshDocs = f.local().docs.length;
      mark('เครื่องใหม่โหลดประวัติทั้งหมด', s0);
    }
    /* เครื่องอื่นที่ฟังอยู่เห็น meta เปลี่ยน → หน้าดึงของใหม่ (ทุกครั้ง ไม่รวบหลายชุดในนาทีเดียวกัน = เผื่อสูง) */
    const s1 = env.store.stats();
    for (const d of env.devices) {
      if (d.dirty && d.fire) { d.dirty = false; await d.fire.sync(); }
    }
    mark('เครื่องอื่นดึงชุดใหม่ (ฟัง meta + ดึง)', s1);
  }
  const after = env.store.stats();
  return { reads: after.reads - before.reads, writes: after.writes - before.writes, saves, part };
}

describe('ระบบใหม่ ขั้น 4: ซ้อมทั้งวัน โควตาฟรีพอ', () => {
  it('วันปกติหลังขึ้นระบบ 1 เดือน: 18 เครื่อง + เครื่องใหม่ อ่าน < 15,000 เขียน < 2,000 · วันแคมเปญ (งาน × 3) ไม่เกินโควตาฟรี', async () => {
    const env = await setup();
    await history(env, 30);
    const docsBefore = env.by(`head1@${DOMAIN}`).fire.local().docs.length;
    expect(docsBefore).toBeGreaterThan(30 * 80);

    const day = GO_LIVE + 30 * DAY;   // 20 ม.ค. 2570
    const r = await workDay(env, day, 1);
    /* ใบย้าย / แปลงของวันนี้ตรวจ + อนุมัติครบทุกใบ */
    const hl = env.by(`head1@${DOMAIN}`).fire;
    await hl.sync();
    const todays = hl.local().docs.filter((d) => (d.stamp || '').slice(0, 10) === C.today(day) && C.OK_TYPES.includes(d.type));
    expect(todays.length).toBeGreaterThan(40);
    expect(todays.filter((d) => C.okState(d, C.voids(hl.local())) !== C.OK_DONE).map((d) => d.no)).toEqual([]);
    console.log('วันปกติ', JSON.stringify({ reads: r.reads, writes: r.writes, saves: r.saves, freshDocs: r.part.freshDocs }),
      '\n' + Object.entries(r.part).filter(([k]) => k !== 'freshDocs').map(([k, v]) => `  ${k}: อ่าน ${v.r} เขียน ${v.w}`).join('\n'));
    expect(r.saves).toBe(6 + 40 + 5 + 5 + 12 + 15 + 2 + 4);
    expect(C.holdList(hl.local())).toEqual([]);   // ใบโอน QA รับครบ ไม่มีของค้างรอรับ
    expect(r.reads).toBeLessThan(15000);
    expect(r.writes).toBeLessThan(2000);
    expect(r.part.freshDocs).toBeGreaterThan(docsBefore);   // เครื่องใหม่ได้ประวัติครบ
    /* ทุกเครื่องเห็นยอดเท่ากันท้ายวัน */
    const piles = (d) => JSON.stringify(Object.values(C.allPiles(d.fire.local())).map((p) => [p.loc, p.long, p.lot, p.po, p.qty]).sort());
    const all = env.devices.filter((d) => d.fire);
    for (const d of all) await d.fire.sync();
    expect(new Set(all.map(piles)).size).toBe(1);

    const camp = await workDay(env, day + DAY, 3);
    console.log('วันแคมเปญ', JSON.stringify({ reads: camp.reads, writes: camp.writes, saves: camp.saves }));
    expect(camp.reads).toBeLessThan(W.LIMITS.reads);
    expect(camp.writes).toBeLessThan(W.LIMITS.writes);
  }, 240000);

  it('ปิดเดือน: ประวัติ 61 วัน ปิด ธ.ค. กับ ม.ค. แล้วเครื่องใหม่อ่านไม่ถึงครึ่ง · ใส่เลข TRcloud เอกสารในก้อนหลังปิดก็เห็น · สำเนาเท่าดึงทีละเอกสาร', async () => {
    const env = await setup();
    await history(env, 61);
    env.set(GO_LIVE + 61 * DAY);   // 20 ก.พ. 2570 08:00
    const fresh = async (blind) => {
      const client = env.store.connect();
      const store = blind ? Object.assign({}, client, { get: (p) => (p.startsWith('arch/') ? Promise.resolve(null) : client.get(p)) }) : client;
      const f = W.open({ store, auth: W.fakeAuth(USERS), cache: W.memCache(), now: env.clock, domain: DOMAIN });
      ok(await f.login(`newphone@${DOMAIN}`));
      const r0 = env.store.stats().reads;
      await f.sync();
      return { f, reads: env.store.stats().reads - r0 };
    };
    const before = await fresh(true);

    const head = env.by(`head1@${DOMAIN}`).fire;
    const dec = ok(await head.archClose()), jan = ok(await head.archClose());
    expect([dec.closed, jan.closed]).toEqual(['2612', '2701']);
    expect((await head.archClose()).error).toMatch(/ก\.พ\. 70 ยังไม่จบ/);
    /* ใส่เลข TRcloud ให้เอกสารเก่าสุดที่ยังรอ (อยู่ในก้อนแล้ว) */
    env.tick(MIN);
    const waits = ok(await head.trList()).list.filter((d) => d.state === 'wait' && !d.lock).slice(-10);
    expect(waits.some((d) => d.no.startsWith('T2612-') || d.no.startsWith('T2701-'))).toBe(true);
    ok(await head.trSave(waits.map((d) => ({ no: d.no, tr: 'TR' + d.no.slice(1), state: 'done' }))));

    const full = await fresh(true), after = await fresh(false);
    const docs = full.f.local().docs.length;
    console.log('ปิดเดือน', JSON.stringify({ docs, ก้อน: dec.chunks + jan.chunks, ขนาด: dec.bytes + jan.bytes, อ่านก่อนปิด: before.reads, อ่านไม่ใช้ก้อน: full.reads, อ่านหลังปิด: after.reads }));
    expect(docs).toBeGreaterThan(61 * 80);
    expect(dec.docs + jan.docs).toBeGreaterThan(docs * 0.6);
    expect(after.reads).toBeLessThan(full.reads * 0.5);
    expect(after.f.local().docs).toEqual(full.f.local().docs);
    expect(C.allPiles(after.f.local())).toEqual(C.allPiles(head.local()));
    expect(ok(await after.f.trList()).list).toEqual(ok(await full.f.trList()).list);
  }, 240000);
});
