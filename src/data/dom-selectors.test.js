/**
 * ทุก #id ที่ JS ไปหยิบ ต้องมีอยู่จริงบนหน้านั้น
 *
 * ที่ต้องมีเทสต์นี้: ตอนย้ายสรุปหยิบของออกมาเป็นโมดูลของตัวเอง JS ถูกคัดลอกมา
 * ทั้งดุ้น รวมถึง querySelectorAll('#tab-picksum .ps-opt') ที่ผูกกับ id ของแท็บ
 * สมัยยังอยู่ในเทียบ Order หน้าใหม่ไม่มี #tab-picksum แล้ว selector จึงคืนค่าว่าง
 * ไม่มีใครถูกถอด active ปุ่มเลยติดสีค้างสะสมจนม่วงทั้งแถบ
 *
 * เงียบสนิททุกทาง: ไม่ throw เพราะ forEach บน NodeList ว่างคือ no-op,
 * ปุ่มยังกดได้และผลลัพธ์ยังถูก ผิดแค่สี — เทสต์เดิมกับ build ไม่มีทางเห็น
 *
 * เช็คเฉพาะ id ที่เขียนตรง ๆ ใน querySelector/querySelectorAll/getElementById
 * ส่วน id ที่หน้านั้นสร้างเองตอน runtime ถือว่ามีจริง
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { htmlPages } from './pages.js';

const PUB = path.resolve(__dirname, '../../public');

function read(p) { return fs.readFileSync(p, 'utf8'); }

function scripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).join('\n');
}

/** id ที่มีตัวตนบนหน้า: เขียนใน markup, อยู่ในสตริงที่ JS ใช้ต่อ HTML, หรือ .id = '…' */
function idsPresent(html) {
  const out = new Set();
  for (const m of html.matchAll(/\bid="([\w-]+)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/\bid=\\?["']([\w-]+)\\?["']/g)) out.add(m[1]);
  for (const m of html.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) out.add(m[1]);
  return out;
}

/** id ที่ JS ไปหยิบ พร้อมเลขบรรทัดไว้ชี้ที่ผิด */
function idsQueried(js) {
  const out = new Map();
  const lines = js.split('\n');
  lines.forEach((ln, i) => {
    /* getElementById ต้องปิดวงเล็บทันที — เจอ + ต่อท้ายแปลว่าชื่อประกอบตอน runtime
       เช่น getElementById('panel-' + n) ดูจากไฟล์เฉย ๆ ไม่มีทางรู้ชื่อเต็ม */
    for (const m of ln.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
      if (!out.has(m[1])) out.set(m[1], i + 1);
    }
    /* querySelector รับสตริงที่ถูกต่อด้วย + ต่อท้ายด้วย เพราะ #id ที่อยู่ต้นสตริง
       รู้ได้แน่นอนอยู่ดี — '#tab-picksum .ps-opt[data-' + attr + ']' ก็ยังฟ้องได้
       ตัดเฉพาะ #id ที่จ่อท้ายสตริงพอดี เพราะนั่นคือท่อนหน้าของชื่อที่จะต่อทีหลัง */
    for (const m of ln.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g)) {
      const lit = m[1];
      for (const id of lit.matchAll(/#([\w-]+)/g)) {
        const ปลายสตริง = id.index + id[0].length === lit.length;
        if (!ปลายสตริง && !out.has(id[1])) out.set(id[1], i + 1);
      }
    }
  });
  return out;
}

const pages = htmlPages();

describe('#id ที่ JS หยิบ ต้องมีอยู่จริงบนหน้านั้น', () => {
  for (const p of pages) {
    it(p.name, () => {
      const html = read(p.file);
      const present = idsPresent(html);
      const missing = [...idsQueried(scripts(html))]
        .filter(([id]) => !present.has(id))
        .map(([id, line]) => `#${id} (บรรทัด ~${line} ในสคริปต์)`);
      expect(missing, `${p.name}: JS หยิบ id ที่ไม่มีบนหน้านี้ — selector จะคืนค่าว่างแบบเงียบ ๆ`)
        .toEqual([]);
    });
  }
});
