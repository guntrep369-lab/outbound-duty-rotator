/**
 * ทุกคลาสที่เขียนไว้ใน markup ต้องมีกฎ CSS รองรับจริง
 *
 * ที่ต้องมีเทสต์นี้: ตอนย้ายแท็บสรุปหยิบของออกไปเป็นโมดูลของตัวเอง CSS ของ
 * แถบดึงข้อมูล (.dbar .dpanel .dnote …) ถูกลบติดไปกับ .ps-* ที่ตั้งใจลบ
 * ผลคือแถบบนหน้าเทียบ Order กลายเป็นข้อความเปล่าเรียงกัน — แต่ไฟล์ยัง syntax ถูก
 * เทสต์ 208 ตัวผ่านหมด และ build ก็ผ่าน ไม่มีอะไรส่งเสียงเลย
 * ต้องให้คนเปิดหน้าเว็บดูถึงจะรู้ ซึ่งแปลว่ารู้ตอนขึ้น production แล้ว
 *
 * เช็คทางเดียว: markup → CSS (คลาสที่เขียนแล้วไม่มีสไตล์ = ของหาย)
 * ไม่เช็คทางกลับ เพราะคลาสที่ JS สร้างตอน runtime ไม่มีทางเห็นจากไฟล์ static
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve(__dirname, '../../public');

/** คลาสที่ตั้งใจไม่มี CSS — เป็นที่เกาะให้ JS หรือ data attribute เท่านั้น */
const ALLOW = new Set([]);

function read(p) { return fs.readFileSync(p, 'utf8'); }

/** ชื่อคลาสที่เขียนไว้ใน class="…" ของ markup (ไม่รวมที่อยู่ในสตริงของ JS) */
function classesInMarkup(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const out = new Set();
  for (const m of body.matchAll(/\bclass="([^"{}]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  }
  return out;
}

/** ชื่อคลาสที่มีกฎ CSS — จากทั้ง <style> ในหน้า และ .css ที่หน้านั้น link ไว้ */
function classesInCss(html, dir) {
  const css = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
    const f = path.resolve(dir, m[1]);
    if (fs.existsSync(f)) css.push(read(f));
  }
  const out = new Set();
  for (const block of css) {
    // ตัดเนื้อในวงเล็บปีกกาทิ้ง เหลือแต่ selector
    for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([\w-]+)/g)) out.add(m[1]);
  }
  return out;
}

const pages = fs.readdirSync(PUB, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(PUB, d.name, 'index.html')))
  .map((d) => ({ name: d.name, file: path.join(PUB, d.name, 'index.html') }));

describe('คลาสใน markup ต้องมี CSS จริง', () => {
  it('เจอหน้าโมดูลครบ', () => {
    expect(pages.length).toBeGreaterThan(3);
  });

  for (const p of pages) {
    it(p.name, () => {
      const html = read(p.file);
      const styled = classesInCss(html, path.dirname(p.file));
      const orphans = [...classesInMarkup(html)]
        .filter((c) => !styled.has(c) && !ALLOW.has(c));
      expect(orphans, `${p.name}: คลาสนี้เขียนใน markup แต่ไม่มีกฎ CSS ที่ไหนเลย`).toEqual([]);
    });
  }
});
