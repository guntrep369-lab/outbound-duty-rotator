import { describe, it, expect } from 'vitest';
/**
 * Tests for public/transport-docs/carrier-label.js.
 *
 * The module lives under public/ because the static carrier pages load it
 * directly over HTTP; the test lives here because Vite copies public/ verbatim
 * into dist/, so a colocated test would ship to the live site and be collected
 * twice (once from source, once from the build).
 */
import { FIELDS, findHeaderRow, score, autoMap, resolveMapping, parseCod } from '../../public/transport-docs/carrier-label.js';

const field = (key) => FIELDS.find((f) => f.key === key);

/** Real-ish exports. Header text is the whole point of these tests. */
const THAI = ['Tracking No.', 'ชื่อผู้รับ', 'ที่อยู่จัดส่ง', 'เบอร์โทรศัพท์', 'Order No.', 'จำนวน', 'ยอด COD', 'หมายเหตุ'];
const ENGLISH = ['Waybill', 'Consignee Name', 'Delivery Address', 'Mobile', 'COD Amount'];
const MIXED = ['เลขที่ Consignment No.', 'ชื่อ-นามสกุลผู้รับ', 'ที่อยู่ผู้รับ', 'เบอร์ติดต่อ', 'เลขที่ใบสั่งขาย', 'ยอดเก็บเงินปลายทาง'];

describe('findHeaderRow', () => {
  it('skips a title row and blank rows above the real header', () => {
    expect(findHeaderRow([['รายงานพัสดุประจำวัน', ''], [''], THAI, ['A', 'B', 'C']])).toBe(2);
  });

  it('takes the first row when it is already the header', () => {
    expect(findHeaderRow([THAI, ['A', 'B', 'C']])).toBe(0);
  });

  it('needs three filled cells, so a two-cell title never wins', () => {
    expect(findHeaderRow([['ชื่อรายงาน', 'Kex'], ['a', 'b', 'c']])).toBe(1);
  });

  it('falls back to row 0 rather than throwing on a file it cannot read', () => {
    expect(findHeaderRow([])).toBe(0);
    expect(findHeaderRow([['only one']])).toBe(0);
  });
});

describe('score', () => {
  it('ranks exact above contains above reverse-contains', () => {
    const exact = score('เลขพัสดุ', field('tracking'));
    const contains = score('เลขพัสดุของลูกค้า', field('tracking'));
    expect(exact).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(0);
  });

  it('prefers the longer, more specific alias', () => {
    // "Consignee Name" contains `consignee` (9) and `consign` (7).
    expect(score('Consignee Name', field('customer'))).toBeGreaterThan(score('Consignee Name', field('tracking')));
  });

  it('ignores case, spaces and punctuation', () => {
    expect(score('TRACKING NO.', field('tracking'))).toBe(score('tracking_no', field('tracking')));
  });

  it('returns 0 for an unrelated or empty header', () => {
    expect(score('น้ำหนักรวม', field('phone'))).toBe(0);
    expect(score('', field('tracking'))).toBe(0);
  });
});

describe('autoMap', () => {
  it('maps a Thai-headed carrier export end to end', () => {
    expect(autoMap(THAI)).toEqual({
      tracking: 'Tracking No.',
      customer: 'ชื่อผู้รับ',
      address: 'ที่อยู่จัดส่ง',
      phone: 'เบอร์โทรศัพท์',
      order: 'Order No.',
      qty: 'จำนวน',
      cod: 'ยอด COD',
      remark: 'หมายเหตุ',
    });
  });

  it('maps an English-headed carrier export', () => {
    const m = autoMap(ENGLISH);
    expect(m.tracking).toBe('Waybill');
    expect(m.customer).toBe('Consignee Name');
  });

  it('REGRESSION: `consign` must not steal "Consignee Name" from ผู้รับ', () => {
    // The shipped bug: tracking was matched first and `consign` is a substring
    // of `consignee`, so the recipient column was consumed as a tracking number
    // and ผู้รับ came out blank. No tracking column here, so nothing can mask it
    // by matching earlier — this isolates the precedence rule itself.
    const m = autoMap(['Consignee Name', 'Address', 'Phone']);
    expect(m.customer).toBe('Consignee Name');
    expect(m.tracking).toBeUndefined();
  });

  it('REGRESSION: a weak match must not outrank a strong one elsewhere', () => {
    // "ยอดเงิน" is an exact COD alias; "เลขที่" only partially matches order.
    // Assignment is best-first, so neither can be stolen by declaration order.
    const m = autoMap(['ยอดเงิน', 'เลขที่ใบสั่งขาย']);
    expect(m.cod).toBe('ยอดเงิน');
    expect(m.order).toBe('เลขที่ใบสั่งขาย');
  });

  it('separates two headers that both start with "เลขที่"', () => {
    const m = autoMap(MIXED);
    expect(m.tracking).toBe('เลขที่ Consignment No.');
    expect(m.order).toBe('เลขที่ใบสั่งขาย');
  });

  it('never assigns one column to two fields', () => {
    for (const hdrs of [THAI, ENGLISH, MIXED]) {
      const used = Object.values(autoMap(hdrs));
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it('does not depend on the order the columns appear in', () => {
    const shuffled = [...ENGLISH].reverse();
    expect(autoMap(shuffled)).toEqual(autoMap(ENGLISH));
  });

  it('leaves a field unmapped rather than guessing wildly', () => {
    const m = autoMap(['เลขพัสดุ', 'ผู้รับ', 'ที่อยู่']);
    expect(m.cod).toBeUndefined();
    expect(m.remark).toBeUndefined();
  });

  it('copes with blank and duplicated header cells', () => {
    const m = autoMap(['เลขพัสดุ', '', 'ผู้รับ', '', 'ที่อยู่']);
    expect(m.tracking).toBe('เลขพัสดุ');
    expect(Object.values(m)).not.toContain('');
  });
});

describe('resolveMapping', () => {
  it('uses the guess when nothing has been saved yet', () => {
    const { mapping, autoMapped } = resolveMapping(THAI, {});
    expect(mapping.tracking).toBe('Tracking No.');
    expect(autoMapped.has('tracking')).toBe(true); // highlighted for checking
  });

  it('lets a saved choice override the guess, and stops highlighting it', () => {
    const { mapping, autoMapped } = resolveMapping(THAI, { remark: 'Order No.' });
    expect(mapping.remark).toBe('Order No.');
    expect(autoMapped.has('remark')).toBe(false);
  });

  it('REGRESSION: a field the user switched off stays off', () => {
    // '' is a decision, not a gap. Re-guessing it would put a column the user
    // deliberately hid back onto tomorrow's labels.
    const { mapping, autoMapped } = resolveMapping(THAI, { qty: '' });
    expect(mapping.qty).toBe('');
    expect(autoMapped.has('qty')).toBe(false);
  });

  it('re-guesses when the saved column is absent from this file', () => {
    const { mapping, autoMapped } = resolveMapping(ENGLISH, { tracking: 'Tracking No.' });
    expect(mapping.tracking).toBe('Waybill');
    expect(autoMapped.has('tracking')).toBe(true);
  });

  it('always returns every field, so the UI never renders an undefined select', () => {
    const { mapping } = resolveMapping(['a', 'b', 'c'], {});
    for (const f of FIELDS) expect(mapping).toHaveProperty(f.key);
    expect(Object.values(mapping).every((v) => typeof v === 'string')).toBe(true);
  });

  it('survives a corrupt saved mapping', () => {
    expect(() => resolveMapping(THAI, { tracking: null, qty: 42 })).not.toThrow();
  });
});

describe('parseCod', () => {
  it('reads amounts the way a carrier writes them', () => {
    expect(parseCod('1590.50')).toBe(1590.5);
    expect(parseCod('1,590.50')).toBe(1590.5);
    expect(parseCod('฿ 2,450')).toBe(2450);
  });

  it('returns null when there is nothing to collect', () => {
    // The label only draws the COD box for a non-null value — a ฿0.00 box on a
    // prepaid parcel invites the driver to collect money they shouldn't.
    for (const v of ['0', '0.00', '', '  ', null, undefined, '-50', 'ไม่เก็บ', 'N/A']) {
      expect(parseCod(v)).toBeNull();
    }
  });
});

describe('field definitions', () => {
  it('marks exactly the fields a label cannot be printed without', () => {
    expect(FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(['tracking', 'customer', 'address']);
  });

  it('has no duplicate keys or empty alias lists', () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FIELDS) expect(f.aliases.length).toBeGreaterThan(0);
  });
});
