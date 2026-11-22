/**
 * เทียบ Rules จริงกับตัวจำลอง: ยิงทุกเคสที่ record.mjs เก็บใส่ emulator คำตัดสินต้องตรงกัน
 *
 * เทสต์เดิมเดินนาฬิกาเอง จึงเปลี่ยน request.time เป็นเวลาที่อยู่ในโทเคนของเคส และโดเมนเป็นของเทสต์
 * เฉพาะสำเนาที่โหลดเข้า emulator (Rules ไฟล์จริงแบบไม่แก้สักตัวทดสอบใน flow.mjs)
 */
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import * as E from './emulator.mjs';

const TIME = '__server_time__';
const CAP = /^Rules อ่านเอกสารประกอบ/;   // ตัวจำลองนับเพดานการอ่านเอง emulator อาจไม่นับ
const LIMIT = /maximum of [\d,]+ expressions|too many (document|get)|call stack/i;
const WORKERS = 6;
const OPEN_RULES = "rules_version = '2';\nservice cloud.firestore { match /databases/{d}/documents { match /{p=**} { allow read, write: if true; } } }\n";

export function testRules(text, domain) {
  const dom = text.match(/matches\('\.\*@[^']+'\)/g) || [];
  if (dom.length !== 1) throw new Error('คาดว่ามีเช็คโดเมนที่เดียวใน Rules เจอ ' + dom.length);
  return text
    .replace(dom[0], () => "matches('.*" + (domain ? '@' + domain.split('.').join('[.]') : '') + "')")
    .split('request.time').join('timestamp.value(request.auth.token.test_now)');
}

/** คำขอของเคส: ตัวแทนเวลาเซิร์ฟเวอร์ = เวลาของเคส · ช่องเวลาเดิมที่ส่งกลับมาไม่แก้ = timestamp เดิม */
export function sent(c) {
  return c.writes.map(([p, d]) => {
    const old = Object.prototype.hasOwnProperty.call(c.before, p) ? c.before[p] : {};
    return [p, Object.fromEntries(Object.entries(d).map(([k, v]) => [k,
      v === TIME ? E.ts(c.now)
        : E.TIME_KEYS.includes(k) && Number.isFinite(v) && v === old[k] ? E.ts(v)
          : v]))];
  });
}

export async function each(dir, worker, pick) {
  async function* cases() {
    let at = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
      for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(dir, f)) })) {
        if (!line) continue;
        const c = JSON.parse(line);
        c.n = ++at;
        if (!pick || pick(c)) yield c;
      }
    }
  }
  const it = cases();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    for (;;) {
      const { value, done } = await it.next();
      if (done) return;
      await worker(value, w);
    }
  }));
}

async function verdict(project, c) {
  await E.clear(project);
  await E.seed(project, c.before);
  const auth = c.user && c.user.email
    ? E.token(project, c.user.email, c.user.verified, { test_now: c.now })
    : null;
  return E.commit(project, sent(c), auth);
}

function describe(c) {
  return c.writes.slice(0, 3).map(([p, d]) => {
    const old = c.before[p];
    const keys = old ? Object.keys(d).filter((k) => JSON.stringify(d[k]) !== JSON.stringify(old[k])).slice(0, 10).join(',') : 'ใหม่ ' + String(d.type || '');
    return p.slice(0, 50) + ' [' + keys + ']';
  }).join(' + ') + (c.writes.length > 3 ? ' + อีก ' + (c.writes.length - 3) : '');
}

export async function replay(dir) {
  const out = { cases: 0, allow: 0, deny: 0, cap: 0, capDenied: 0, limit: 0, open: 0, tried: 0, bad: new Map() };
  const text = E.rulesText(), ready = new Map();

  function miss(kind, c, r) {
    const why = kind + ' · ' + (c.why || 'ตัวจำลองให้ผ่าน') + ' · HTTP ' + r.status;
    const got = out.bad.get(why) || { n: 0, sample: '#' + c.n + ' ' + describe(c) + ' → ' + r.text.replace(/\s+/g, ' ').slice(0, 700) };
    got.n++;
    out.bad.set(why, got);
  }
  function project(domain, w) {
    const id = 'demo-wms-r' + w + '-' + (Buffer.from(domain).toString('hex') || 'any');
    if (!ready.has(id)) ready.set(id, E.loadRules(id, testRules(text, domain)).then(() => id));
    return ready.get(id);
  }

  await each(dir, async (c, w) => {
    const id = await project(c.domain, w);
    let r;
    try { r = await verdict(id, c); } catch (e) { return miss('ทดสอบเคสไม่ได้', c, { status: 0, text: String(e.message) }); }
    out.cases++;
    const pass = r.status === 200;
    if (!pass && LIMIT.test(r.text)) out.limit++;
    if (CAP.test(c.why)) {
      out.cap++;
      if (!pass) out.capDenied++;
      return;
    }
    if (c.why) out.deny++; else out.allow++;
    if (pass && c.why) miss('รั่ว Rules จริงให้ผ่าน', c, r);
    else if (!pass && !c.why) miss('งานปกติพัง Rules จริงไม่ให้ผ่าน', c, r);
    else if (!pass && r.status !== 403 && r.status !== 400) miss('ปฏิเสธผิดแบบ', c, r);
  });

  /* ตัวคุม: Rules เปิดหมดต้องปล่อยเคสที่ควรถูกปฏิเสธ ไม่งั้นที่ตกข้างบนคือคำขอเสีย ไม่ใช่กฎกัน */
  const controls = Array.from({ length: WORKERS }, (_, w) => 'demo-wms-open' + w);
  for (const id of controls) await E.loadRules(id, OPEN_RULES);
  await each(dir, async (c, w) => {
    out.tried++;
    try { if ((await verdict(controls[w], c)).status === 200) out.open++; } catch (e) { /* นับเป็นไม่ผ่าน */ }
  }, (c) => !!c.why);
  return out;
}
