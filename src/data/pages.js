/**
 * รายชื่อหน้าเว็บทั้งหมดใน public/ สำหรับเทสต์ที่ตรวจทุกหน้า
 *
 * เดินทุกชั้นและเอาไฟล์ .html ทุกไฟล์ ไม่ใช่แค่ index.html ชั้นเดียว —
 * รุ่นแรกของตัวตรวจดูแค่ public/<dir>/index.html จึงมองข้าม
 * transport-docs/delivery/ กับ warehouse-forms/requisition.html ไปทั้งหมด
 * แล้วรายงานว่า "ผ่านทุกหน้า" ทั้งที่หน้าที่พังจริงไม่เคยถูกเปิดอ่าน
 */
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve(__dirname, '../../public');

export function htmlPages() {
  const out = [];
  (function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.endsWith('.html')) {
        out.push({ name: path.relative(PUB, full).replace(/\\/g, '/'), file: full });
      }
    }
  })(PUB);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
