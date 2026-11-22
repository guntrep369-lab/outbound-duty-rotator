/**
 * ตัวเก็บเคส (setupFiles ของ vitest): เทสต์ระบบใหม่ทุกครั้งที่ store จำลองตัดสินว่าเขียนได้ไหม
 * เก็บ ข้อมูลก่อนเขียน + คำขอ + คำตัดสิน ไว้ให้ replay.mjs ยิงซ้ำใส่ Rules จริง
 * แก้แค่ข้อความที่เทสต์อ่านในหน่วยความจำ ไม่แตะ public/wms-fire.js
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const SEAM = "return rulesError(user, plain, writes, opt.domain || '', now());";
const TAP = "var T = now(), why = rulesError(user, plain, writes, opt.domain || '', T); globalThis.__rulesRec(user, plain, writes, opt.domain || '', T, why); return why;";

const read = fs.readFileSync;
fs.readFileSync = function (file) {
  const out = read.apply(this, arguments);
  if (typeof out !== 'string' || !String(file).endsWith('wms-fire.js')) return out;
  if (out.split(SEAM).length !== 2) throw new Error('ไม่เจอจุดเช็คกฎของ store จำลองใน wms-fire.js แก้ SEAM ใน record.mjs');
  return out.replace(SEAM, () => TAP);
};

const seen = new Set();
const out = path.join(process.env.RULES_REC_DIR, crypto.randomBytes(6).toString('hex') + '.jsonl');
const plainNumber = (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? { __num: String(v) } : v);

globalThis.__rulesRec = (user, plain, writes, domain, now, why) => {
  /* เท่าที่ Rules อ่านได้ในคำขอเดียว: คนใช้ meta/head arch/index ที่เขียน และ docs/{meta.last} */
  const paths = new Set(['meta/head', 'arch/index', ...writes.map((w) => w[0])]);
  if (user) paths.add('users/' + user.email);
  writes.forEach(([p, d]) => { if (p === 'meta/head' && d && typeof d.last === 'string') paths.add('docs/' + d.last); });
  const before = {};
  paths.forEach((p) => { if (Object.prototype.hasOwnProperty.call(plain, p)) before[p] = plain[p]; });
  const line = JSON.stringify({ user, domain, now: Math.floor(now), before, writes, why }, plainNumber);
  const hash = crypto.createHash('sha1').update(line).digest('hex');
  if (seen.has(hash)) return;
  seen.add(hash);
  fs.appendFileSync(out, line + '\n');
};
