/**
 * public/wms-shell.js — เมนูข้าง: โมดูลที่ซ่อนไว้
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

let sidebarHTML;
beforeAll(async () => {
  // wms-shell.js วาดเมนูทันทีที่โหลด — ให้หน้าว่าง ๆ ไว้ก่อน
  vi.useFakeTimers();
  globalThis.document = { querySelectorAll: () => [], addEventListener: () => {} };
  globalThis.window = { addEventListener: () => {} };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  ({ sidebarHTML } = await import('../../public/wms-shell.js'));
  vi.useRealTimers();
});

const mods = (html) => [...html.matchAll(/data-mod="([^"]+)"/g)].map((m) => m[1]);

describe('เมนูข้าง', () => {
  it('สรุปเช้ากับย้อนหลังไม่ขึ้นในเมนู สมุดกะอยู่บนสุด', () => {
    const ids = mods(sidebarHTML('stock', '../'));
    expect(ids).not.toContain('summary');
    expect(ids).not.toContain('history');
    expect(ids[0]).toBe('shiftlog');
    expect(ids).toContain('settings');
  });

  it('เปิดหน้าที่ซ่อนอยู่ — เมนูยังโชว์หน้านั้นเป็นหน้าปัจจุบัน', () => {
    const html = sidebarHTML('summary', '../');
    expect(mods(html)).toContain('summary');
    expect(mods(html)).not.toContain('history');
    expect(html).toMatch(/class="sysmod active" aria-current="page" data-mod="summary"/);
  });
});
