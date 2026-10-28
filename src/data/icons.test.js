/**
 * ทุกหน้ามีไอคอนแท็บ / หน้าจอหลัก และไฟล์ที่ชี้ไปมีอยู่จริง
 *
 * ไอคอนต้องใส่ใน <head> ของทุกหน้าเอง เว็บอยู่ใต้ /outbound-duty-rotator/ บน GitHub Pages
 * เบราว์เซอร์จึงไปหา /favicon.ico ที่รากโดเมนซึ่งไม่ใช่ของเรา — หน้าที่ลืมใส่จะขึ้นไอคอนว่าง
 * ทั้งที่หน้าอื่นมีโลโก้ และกด "เพิ่มไปที่หน้าจอหลัก" จากหน้านั้นจะได้ภาพหน้าจอแทนโลโก้
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { htmlPages } from './pages.js';

const ICONS = ['wms-icon-32.png', 'wms-logo.png', 'wms-icon-180.png'];

describe('ไอคอนของทุกหน้า', () => {
  for (const p of htmlPages()) {
    it(p.name, () => {
      const head = fs.readFileSync(p.file, 'utf8').split('</head>')[0];
      for (const name of ICONS) {
        const m = head.match(new RegExp(`<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]*${name.replace('.', '\\.')})"`));
        expect(m, `${p.name} ไม่มีลิงก์ ${name}`).not.toBe(null);
        expect(fs.existsSync(path.resolve(path.dirname(p.file), m[1])), `${p.name} ชี้ไป ${m[1]} ที่ไม่มีอยู่`).toBe(true);
      }
    });
  }
});

/**
 * ไอคอนหัวโมดูล (public/icons/) ที่หน้าเว็บกับสคริปต์หัวโมดูลชี้ไป ต้องมีไฟล์จริง
 * ชี้ผิดชื่อแล้วหัวหน้าจะเป็นกรอบว่าง ไม่มีอะไรเตือน
 */
const PUB = path.resolve(__dirname, '../../public');
const NAVS = ['transport-docs/transport-nav.js', 'transport-forms/forms-nav.js', 'warehouse-forms/wh-nav.js'];

describe('ไอคอนหัวโมดูล', () => {
  for (const p of htmlPages()) {
    const srcs = [...fs.readFileSync(p.file, 'utf8').matchAll(/<img src="([^"]*icons\/[^"]+)"/g)].map((m) => m[1]);
    if (!srcs.length) continue;
    it(p.name, () => {
      for (const s of srcs) expect(fs.existsSync(path.resolve(path.dirname(p.file), s)), `${p.name} ชี้ไป ${s} ที่ไม่มีอยู่`).toBe(true);
    });
  }
  for (const nav of NAVS) {
    it(nav, () => {
      const m = fs.readFileSync(path.join(PUB, nav), 'utf8').match(/new URL\('([^']+)', import\.meta\.url\)/);
      expect(m, `${nav} ไม่ได้ใช้ไอคอนรูป`).not.toBe(null);
      expect(fs.existsSync(path.resolve(path.dirname(path.join(PUB, nav)), m[1])), `${nav} ชี้ไป ${m[1]} ที่ไม่มีอยู่`).toBe(true);
    });
  }
});
