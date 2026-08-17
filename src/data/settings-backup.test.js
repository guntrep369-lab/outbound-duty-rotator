import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for the backup split in public/wms-settings.js.
 *
 * One file used to carry both the Apps Script URLs and the product catalogue,
 * so passing a colleague the product names to set up their forms also handed
 * over read access to every order — customer names, addresses, phone numbers —
 * and write access to the transport store. Two files, split by what leaking
 * them costs.
 *
 * The case that matters most is the quiet one: restoring the shareable file
 * must not remove the keys already on the machine.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../../public/wms-settings.js'), 'utf8');

let S, store;
const FULL = {
  'orderapp_order_gas_url': 'https://order/exec',
  'orderapp_gas_url': 'https://stock/exec',
  'wms:transport:url': 'https://transport/exec',
  'wms:transport:token': 'secret-token',
  'wms:users': '[{"name":"กัน","code":"1111"}]',
  'wms:wh:sku': '{"items":[{"sku":"A"}],"pairs":[]}',
  'wms:sku:names': '{"names":{"A":"ก"}}',
  'wms:transport:logo': 'data:image/png;base64,xx',
  'wms:me': 'กัน',
};

beforeEach(() => {
  store = new Map(Object.entries(FULL));
  const local = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i],
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {};
  new Function('window', 'localStorage', 'console', SRC)(win, local, { warn: () => {} });
  S = win.WmsSettings;
});

describe('แยกไฟล์ตามสิ่งที่หลุดแล้วเสียหายต่างกัน', () => {
  it('ไฟล์กุญแจมี URL รหัส และผู้ใช้', () => {
    expect(Object.keys(S.exportAll('key').data).sort()).toEqual([
      'orderapp_gas_url', 'orderapp_order_gas_url',
      'wms:transport:token', 'wms:transport:url', 'wms:users',
    ]);
  });

  it('ไฟล์ข้อมูลมีแค่รายชื่อสินค้า คู่รหัส และโลโก้', () => {
    expect(Object.keys(S.exportAll('data').data).sort())
      .toEqual(['wms:sku:names', 'wms:transport:logo', 'wms:wh:sku']);
  });

  it('ไฟล์ที่ตั้งใจส่งต่อ ต้องไม่มีอะไรที่เป็นกุญแจติดไปเลย', () => {
    const text = JSON.stringify(S.exportAll('data'));
    for (const secret of ['/exec', 'secret-token', '1111']) {
      expect(text).not.toContain(secret);
    }
    expect(S.describe(S.exportAll('data').data).hasKeys).toBe(false);
    expect(S.describe(S.exportAll('key').data).hasKeys).toBe(true);
  });

  it('คีย์ที่ไม่รู้จักถูกนับเป็นกุญแจไว้ก่อน ไม่หลุดไปอยู่ไฟล์ที่ส่งต่อได้', () => {
    // เดาผิดข้างเดียวแปลว่ากุญแจไปโผล่ในไฟล์ที่คนตั้งใจส่งให้คนอื่น
    expect(S.kindOf('wms:ของใหม่ที่ยังไม่มีใครคิดถึง')).toBe('key');
    store.set('wms:something-new', 'x');
    expect(Object.keys(S.exportAll('data').data)).not.toContain('wms:something-new');
    expect(Object.keys(S.exportAll('key').data)).toContain('wms:something-new');
  });

  it('ทั้งสองไฟล์ยังเคารพ SKIP — ไม่มีข้อมูลของวันหรือชื่อคนที่นั่งเครื่อง', () => {
    for (const kind of ['key', 'data']) {
      expect(Object.keys(S.exportAll(kind).data)).not.toContain('wms:me');
    }
  });

  it('ไฟล์บอกชนิดตัวเอง และไม่ระบุชนิด = ไฟล์รวมแบบเดิม', () => {
    expect(S.exportAll('key').part).toBe('key');
    expect(S.exportAll('data').part).toBe('data');
    expect(S.exportAll().part).toBe('all');
    expect(Object.keys(S.exportAll().data)).toHaveLength(8);
  });
});

describe('กู้คืน', () => {
  it('กู้ไฟล์ข้อมูล แล้วกุญแจในเครื่องต้องอยู่ครบ', () => {
    const data = S.exportAll('data');
    store.set('wms:sku:names', '{"names":{"Z":"ของเก่า"}}');
    expect(S.importAll(data).ok).toBe(true);
    expect(store.get('orderapp_order_gas_url')).toBe('https://order/exec');
    expect(store.get('wms:users')).toContain('1111');
    expect(store.get('wms:sku:names')).toContain('"A"');
  });

  it('กู้ไฟล์กุญแจ แล้วรายชื่อสินค้าในเครื่องต้องอยู่ครบ', () => {
    const key = S.exportAll('key');
    store.set('wms:wh:sku', '{"items":[{"sku":"ของเดิม"}]}');
    expect(S.importAll(key).ok).toBe(true);
    expect(store.get('wms:wh:sku')).toContain('ของเดิม');
  });

  it('ไฟล์รวมแบบเดิมที่ไม่มี part ยังกู้ได้ — ของที่ทุกคนเก็บไว้ต้องไม่ใช้ไม่ได้', () => {
    const old = { app: 'WMS Management by gun', kind: 'settings-backup', at: 1,
                  data: { 'orderapp_gas_url': 'https://old/exec' } };
    expect(S.importAll(old).ok).toBe(true);
    expect(store.get('orderapp_gas_url')).toBe('https://old/exec');
  });

  it('ไฟล์อื่นที่ไม่ใช่ของระบบ ต้องปฏิเสธ', () => {
    expect(S.importAll({ kind: 'อะไรก็ไม่รู้', data: {} }).ok).toBe(false);
    expect(S.importAll(null).ok).toBe(false);
  });
});
