/**
 * ทดสอบ firestore.rules กับ Firestore Emulator (GitHub Actions: .github/workflows/rules-test.yml)
 *
 *   1. flow.mjs    Rules ไฟล์จริง + SDK จริง + โค้ดแอปจริง เดินงานครบทาง
 *   2. replay.mjs  ทุกการตัดสินของ store จำลองในเทสต์เดิม ยิงซ้ำใส่ Rules จริง ต้องตรงกัน
 *
 * ผลออกเป็น annotation ของรอบรัน (อ่านได้โดยไม่ต้องเปิด log) ตกข้อไหน = exit 1
 * ไม่พิสูจน์: การล็อกอิน Google จริง และเพดานของ Firestore จริงที่ emulator ไม่บังคับ
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flow } from './flow.mjs';
import { replay } from './replay.mjs';
import { host } from './emulator.mjs';

const MIN_ALLOW = 3000, MIN_DENY = 150;   // น้อยกว่านี้ = ตัวเก็บเคสหลุด ผลเขียวเชื่อไม่ได้
const esc = (s) => String(s).split('%').join('%25').split('\r').join('%0D').split('\n').join('%0A');
const problems = [], notes = [];

function problem(title, text) {
  problems.push(title);
  console.log('::error title=' + esc(title).split(',').join(' ').split(':').join(' ') + '::' + esc(text));
}
function note(title, text) {
  notes.push(title + ': ' + text);
  console.log('::notice title=' + esc(title) + '::' + esc(text));
}
/** GitHub เก็บ annotation ขั้นละ 10 อัน จึงรวมเป็นก้อน */
function list(title, lines, max) {
  let cur = '', k = 0;
  for (const line of lines.concat([''])) {
    if (cur && (!line || cur.length + line.length > 3500)) {
      if (++k > max) return;
      problem(title + ' ' + k, cur);
      cur = '';
    }
    cur += line ? line + '\n' : '';
  }
}

async function part(name, fn) {
  try { await fn(); } catch (e) { problem(name + ' รันไม่จบ', String((e && e.stack) || e).slice(0, 3000)); }
}

host();   // ไม่มี emulator ในเครื่อง = หยุดก่อนทำอย่างอื่น

await part('เดินงานจริง', async () => {
  const r = await flow();
  note('เดินงานจริง', 'ผ่าน ' + r.done.length + ' ข้อ ตก ' + r.failed.length + ' ข้อ (Rules ไฟล์จริงไม่แก้ + SDK จริง)');
  list('เดินงานจริงตก', r.failed.map((f) => f.name + ' : ' + f.why), 3);
});

await part('เทียบตัวจำลอง', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-rules-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const rec = spawnSync(process.execPath, [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    '--config', fileURLToPath(new URL('./record.config.mjs', import.meta.url)),
  ], { cwd: root, env: { ...process.env, RULES_REC_DIR: dir }, stdio: 'inherit', timeout: 600000 });
  if (rec.status !== 0) return problem('เก็บเคสไม่สำเร็จ', 'เทสต์ระบบใหม่ตกหรือหมดเวลา ระหว่างเก็บเคส (exit ' + rec.status + ')');

  const r = await replay(dir);
  const wrong = [...r.bad.values()].reduce((a, b) => a + b.n, 0);
  note('เทียบตัวจำลอง', [
    'เคส ' + r.cases + ' (ควรผ่าน ' + r.allow + ' ควรตก ' + r.deny + ')',
    'ไม่ตรง ' + wrong,
    'ตัวคุม Rules เปิดหมดปล่อย ' + r.open + '/' + r.tried,
    'ชนเพดานนิพจน์ ' + r.limit,
    'เพดานการอ่าน: emulator ปฏิเสธ ' + r.capDenied + '/' + r.cap,
  ].join(' · '));
  if (r.allow < MIN_ALLOW || r.deny < MIN_DENY) problem('เคสน้อยผิดปกติ', 'ควรผ่าน ' + r.allow + ' ควรตก ' + r.deny + ' ตัวเก็บเคสอาจหลุด');
  if (r.open < r.tried * 0.9) problem('ตัวคุมไม่ผ่าน', 'Rules เปิดหมดยังตก ' + (r.tried - r.open) + '/' + r.tried + ' เคส คำขอของตัวเทสต์อาจผิดรูป');
  list('Rules จริงไม่ตรงตัวจำลอง', [...r.bad].sort((a, b) => b[1].n - a[1].n).map(([why, b]) => b.n + 'x ' + why + ' | ' + b.sample), 4);
});

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## Firestore Rules บน Emulator\n\n' + notes.map((x) => '- ' + x).join('\n') + '\n\n' + (problems.length ? '**ตก:** ' + problems.join(' · ') : '**ผ่านทุกข้อ**') + '\n');
}
console.log(problems.length ? 'FAILED ' + problems.length : 'PASSED');
process.exit(problems.length ? 1 : 0);
