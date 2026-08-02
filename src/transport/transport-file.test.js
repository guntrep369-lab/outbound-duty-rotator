import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Tests for public/transport-docs/transport-file.js.
 *
 * That file ships as a classic script because the tool pages are not modules,
 * so it is evaluated here the way a browser would — with a window stub — rather
 * than imported. This tests the file that actually ships, not a copy of it.
 */
let TransportFile;

beforeAll(() => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../public/transport-docs/transport-file.js'),
    'utf8'
  );
  const win = {};
  new Function('window', 'sessionStorage', 'console', src)(
    win,
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    { warn: () => {} }
  );
  TransportFile = win.TransportFile;
});

/** The layout every tool reads, straight from the column hints on the pages. */
const REAL_HEADER = [
  'ชื่อรถ', 'Date', 'Sup', 'เลขOrder', 'แบรนด์', 'ขนาด', 'จำนวน', 'ของแถม', 'จำนวน(แถม)',
  'ชื่อลูกค้า', 'Phone 1', 'Phone 2', 'ที่อยู่', 'เวลานัด', 'การเงิน', 'หมายเหตุ',
  'Platform_Order', 'เครื่องรูดบัตร',
];

describe('COLS', () => {
  it('maps every column the three tools use', () => {
    expect(TransportFile.COLS).toEqual({
      truck: 0, date: 1, sup: 2, order: 3, brand: 4, size: 5, qty: 6,
      gift: 7, giftQty: 8, customer: 9, phone1: 10, phone2: 11,
      address: 12, time: 13, payment: 14, remark: 15, platform: 16, cardMachine: 17,
    });
  });

  it('assigns each spreadsheet column exactly once', () => {
    const idx = Object.values(TransportFile.COLS);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('lines up with the header the team actually exports', () => {
    // A→truck … R→cardMachine. If this fails the file changed, not the code.
    const C = TransportFile.COLS;
    expect(REAL_HEADER[C.truck]).toBe('ชื่อรถ');
    expect(REAL_HEADER[C.brand]).toBe('แบรนด์');
    expect(REAL_HEADER[C.customer]).toBe('ชื่อลูกค้า');
    expect(REAL_HEADER[C.address]).toBe('ที่อยู่');
    expect(REAL_HEADER[C.cardMachine]).toBe('เครื่องรูดบัตร');
  });
});

describe('checkHeader', () => {
  it('accepts the real export', () => {
    expect(TransportFile.checkHeader(REAL_HEADER).ok).toBe(true);
  });

  it('REGRESSION: catches a column inserted mid-table', () => {
    // The failure this exists for: everything after the insert shifts by one,
    // nothing throws, and the delivery note prints the wrong person's address.
    const shifted = [...REAL_HEADER];
    shifted.splice(4, 0, 'คอลัมน์ใหม่');
    const r = TransportFile.checkHeader(shifted);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.col)).toContain('brand');
  });

  it('reports what it found, so the message can name it', () => {
    const bad = [...REAL_HEADER];
    bad[TransportFile.COLS.address] = 'เบอร์โทร';
    const r = TransportFile.checkHeader(bad);
    expect(r.problems).toEqual([{ col: 'address', expected: 'ที่อยู่', found: 'เบอร์โทร' }]);
  });

  it('tolerates wording changes that do not move anything', () => {
    const reworded = [...REAL_HEADER];
    reworded[0] = 'ชื่อรถ / ทะเบียน';
    reworded[9] = 'ชื่อลูกค้า (ผู้รับ)';
    reworded[12] = 'ที่อยู่จัดส่ง';
    expect(TransportFile.checkHeader(reworded).ok).toBe(true);
  });

  it('accepts an English export', () => {
    const en = [...REAL_HEADER];
    en[0] = 'Truck'; en[3] = 'Order No'; en[4] = 'Brand';
    en[9] = 'Customer'; en[12] = 'Address';
    expect(TransportFile.checkHeader(en).ok).toBe(true);
  });

  it('stays quiet on a blank cell rather than guessing', () => {
    const gap = [...REAL_HEADER];
    gap[TransportFile.COLS.brand] = '';
    expect(TransportFile.checkHeader(gap).ok).toBe(true);
  });

  it('does not throw on a missing or malformed header', () => {
    for (const h of [null, undefined, [], 'not an array']) {
      expect(() => TransportFile.checkHeader(h)).not.toThrow();
      expect(TransportFile.checkHeader(h).ok).toBe(true); // cannot check ≠ wrong
    }
  });
});
