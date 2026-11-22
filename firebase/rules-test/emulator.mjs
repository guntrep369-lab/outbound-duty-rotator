/**
 * ต่อ Firestore Emulator ในเครื่องเท่านั้น (โปรเจกต์ demo-* = เครื่องมือ Firebase ไม่ต่อของจริง)
 * ข้อมูลทั้งหมดสมมติ ไม่มี key token หรือบัญชีจริง
 */
import fs from 'node:fs';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';

export function host() {
  const m = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(HOST);
  if (!m) throw new Error('FIRESTORE_EMULATOR_HOST ต้องเป็น emulator ในเครื่อง (รันผ่าน firebase emulators:exec)');
  return { name: m[1], port: +m[2] };
}

function projectUrl(project, rest) {
  host();
  if (!/^demo-[a-z0-9-]+$/.test(project)) throw new Error('ใช้ได้เฉพาะโปรเจกต์ demo-*: ' + project);
  return 'http://' + HOST + rest;
}

export function rulesText() {
  return fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
}

async function call(url, opt) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, opt);
    const text = await r.text();
    if ((r.status < 500 && r.status !== 429) || i === 2) return { status: r.status, text };
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
}

/** โหลด Rules เข้า emulator ผิดไวยากรณ์ = หยุดพร้อมบรรทัดที่ผิด */
export async function loadRules(project, content) {
  const r = await call(projectUrl(project, '/emulator/v1/projects/' + project + ':securityRules'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (r.status !== 200 || /"severity":\s*"ERROR"/.test(r.text)) throw new Error('Rules คอมไพล์ไม่ผ่าน: ' + r.text.slice(0, 3000));
}

export async function clear(project) {
  const r = await call(projectUrl(project, '/emulator/v1/projects/' + project + '/databases/(default)/documents'), { method: 'DELETE' });
  if (r.status !== 200) throw new Error('ล้างฐานทดลองไม่ได้ ' + r.status + ' ' + r.text.slice(0, 300));
}

/* ── ค่า JS → REST ── */

const TS = Symbol('timestamp');
export const ts = (ms) => ({ [TS]: ms });
/** ช่องที่ฐานเก็บเป็น timestamp (เหมือน TIME3 ในเทสต์ = TIME_KEYS ของ fire-backup.gs) */
export const TIME_KEYS = ['at', 'trAt', 'last', 'ckAt', 'apAt', 'okAt'];

export function value(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (TS in v) return { timestampValue: new Date(v[TS]).toISOString() };
  if (v.__num) return { doubleValue: v.__num };   // NaN / Infinity จาก JSON ของตัวเก็บเคส
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: fields(v) } };
}

export function fields(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
}

/** เอกสารที่อยู่ในฐานแล้วของ store จำลอง (เวลา = มิลลิวินาที) → แบบที่ Firestore เก็บ */
export function stored(d) {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, TIME_KEYS.includes(k) && Number.isFinite(v) ? ts(v) : v]));
}

/** โทเคนแบบ emulator (ไม่มีลายเซ็น ใช้กับของจริงไม่ได้) */
export function token(project, email, verified, extra = {}) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  return part({ alg: 'none', type: 'JWT' }) + '.' + part({
    iss: 'https://securetoken.google.com/' + project, aud: project, iat, auth_time: iat, exp: iat + 3600,
    sub: email, user_id: email, email, email_verified: verified,
    firebase: { sign_in_provider: 'custom', identities: {} }, ...extra,
  }) + '.';
}

/** เขียนหนึ่งชุด auth = 'owner' (ข้าม Rules ไว้ตั้งข้อมูล) | โทเคน | null */
export async function commit(project, writes, auth) {
  const root = 'projects/' + project + '/databases/(default)/documents';
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + auth;
  return call(projectUrl(project, '/v1/' + root + ':commit'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes: writes.map(([p, d]) => ({ update: { name: root + '/' + p, fields: fields(d) } })) }),
  });
}

export async function seed(project, data) {
  const all = Object.entries(data).map(([p, d]) => [p, stored(d)]);
  for (let i = 0; i < all.length; i += 100) {
    const r = await commit(project, all.slice(i, i + 100), 'owner');
    if (r.status !== 200) throw new Error('ตั้งข้อมูลทดลองไม่ได้ ' + r.status + ' ' + r.text.slice(0, 300));
  }
}
