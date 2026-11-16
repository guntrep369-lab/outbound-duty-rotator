/**
 * สคริปต์ที่เขียนในหน้า (<script> ไม่มี src) ต้องอ่านออก — syntax ผิดตัวเดียวทั้งหน้าไม่ทำงาน
 *
 * ที่ต้องมีเทสต์นี้: ตอนเพิ่มปุ่มลิงก์ HR ในหน้าตารางกะ ข้อความ alert มีขึ้นบรรทัดใหม่จริงแทน \n
 * สคริปต์ทั้งก้อนของหน้าอ่านไม่ออก ตารางกะว่างทั้งหน้า แต่เทสต์ทั้งชุดผ่านหมด
 * เพราะเทสต์อื่นอ่านหน้าเป็นตัวหนังสือ ไม่มีตัวไหนลองแปลสคริปต์จริง
 *
 * เช็คแค่ว่าแปลได้ (new Function ไม่ได้รัน) · ข้าม type="module" เพราะ import แปลแบบนี้ไม่ได้
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { htmlPages } from './pages.js';

describe('สคริปต์ในหน้าอ่านออก', () => {
  for (const p of htmlPages()) {
    const html = fs.readFileSync(p.file, 'utf8');
    const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter((m) => !/type=["']?(module|application\/(ld\+)?json|text\/template)/.test(m[1]))
      .map((m) => m[2]);
    if (!blocks.some((b) => b.trim())) continue;
    it(p.name, () => {
      blocks.forEach((code, i) => {
        let err = null;
        try { new Function(code); } catch (e) { err = e.message; }
        expect(err, `${p.name} สคริปต์ก้อนที่ ${i + 1}`).toBe(null);
      });
    });
  }
});
