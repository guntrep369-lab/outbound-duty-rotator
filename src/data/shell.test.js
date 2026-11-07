/**
 * public/wms-shell.js — เมนูข้าง: โมดูลที่ซ่อนไว้ และหมวดที่พับเก็บได้
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

let sidebarHTML;
let MODULES;
beforeAll(async () => {
  // wms-shell.js วาดเมนูทันทีที่โหลด — ให้หน้าว่าง ๆ ไว้ก่อน
  vi.useFakeTimers();
  globalThis.document = { querySelectorAll: () => [], addEventListener: () => {} };
  globalThis.window = { addEventListener: () => {} };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  ({ sidebarHTML } = await import('../../public/wms-shell.js'));
  ({ MODULES } = await import('../../public/wms-modules.js'));
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

/** หมวดในเมนู: { หมวด: { open, here, n, items, hidden } } */
function groups(html) {
  const out = {};
  for (const m of html.matchAll(/<div class="sysgrp([^"]*)" data-grp="([^"]+)">(.*?)<\/div><\/div>/g)) {
    const [, cls, id, body] = m;
    out[id] = {
      open: cls.includes('open'),
      here: cls.includes('here'),
      expanded: /aria-expanded="true"/.test(body),
      hidden: /class="sysgrp-items"[^>]* hidden>/.test(body),
      n: Number(body.match(/class="sysgrp-n"[^>]*>(\d+)</)[1]),
      items: mods(body),
    };
  }
  return out;
}

describe('หมวดในเมนูพับเก็บได้', () => {
  it('เปิดเฉพาะหมวดของหน้าที่อยู่ หมวดอื่นพับไว้ แต่ทุกหน้ายังอยู่ในเมนู', () => {
    const html = sidebarHTML('fifo', '../');
    const g = groups(html);
    expect(Object.keys(g)).toEqual(['order', 'warehouse', 'inventory', 'transport', 'system']);
    expect(g.inventory).toMatchObject({ open: true, here: true, expanded: true, hidden: false });
    expect(g.inventory.items).toEqual(['dashboard', 'txstock', 'cutcheck', 'lotpo', 'invmatch', 'fifo', 'balance']);
    for (const id of ['order', 'warehouse', 'transport', 'system']) {
      expect(g[id], id).toMatchObject({ open: false, here: false, expanded: false, hidden: true });
    }
    const all = MODULES.filter((m) => !m.hidden).map((m) => m.id);
    expect(mods(html).sort()).toEqual(all.sort());
  });

  it('หัวหมวดบอกว่ามีกี่หน้า ไม่นับหน้าที่ซ่อน', () => {
    const g = groups(sidebarHTML('stock', '../'));
    expect(g.transport.n).toBe(2);
    expect(g.transport.items).toEqual(['transport', 'forms']);
    expect(g.warehouse.n).toBe(4);
  });

  it('เปิดหน้าที่ซ่อนในหมวด — หมวดนั้นเปิดและมีหน้านั้นเพิ่มมา', () => {
    const g = groups(sidebarHTML('jobs', '../'));
    expect(g.transport).toMatchObject({ open: true, here: true, n: 3 });
    expect(g.transport.items[0]).toBe('jobs');
  });

  it('หน้าที่ไม่มีหมวด (สมุดกะ) เปิดหมวดเดิมจากหน้าก่อน ไม่มีก็พับหมด', () => {
    const kept = groups(sidebarHTML('shiftlog', '../', 'transport'));
    expect(kept.transport).toMatchObject({ open: true, here: false });
    expect(Object.values(kept).filter((x) => x.open)).toHaveLength(1);
    const none = groups(sidebarHTML('shiftlog', '../'));
    expect(Object.values(none).some((x) => x.open)).toBe(false);
  });

  it('หน้าที่มีหมวด เปิดหมวดของตัวเองเสมอ ไม่สนหมวดที่ค้างจากหน้าก่อน', () => {
    const g = groups(sidebarHTML('order', '../', 'transport'));
    expect(g.order.open).toBe(true);
    expect(g.transport.open).toBe(false);
  });

  it('หัวหมวดเป็นปุ่มที่ชี้ไปกล่องของหมวดตัวเอง', () => {
    const html = sidebarHTML('fifo', '../');
    for (const id of ['order', 'inventory']) {
      expect(html).toMatch(new RegExp(`<button type="button" class="sysgrp-head" aria-expanded="(true|false)" aria-controls="sysgrp-${id}">`));
      expect(html).toContain(`<div class="sysgrp-items" id="sysgrp-${id}"`);
    }
  });
});
