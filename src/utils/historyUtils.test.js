import { describe, it, expect } from 'vitest';
import {
  pruneHistory,
  historyBytes,
  historyHealth,
  formatBytes,
  HISTORY_KEEP_WEEKS,
  HISTORY_BUDGET_BYTES,
  HISTORY_WARN_BYTES,
  HISTORY_MAX_BYTES,
  RECORD_FIELDS,
  DAY_KEYS,
  slimRecord,
  slimHistory,
  recordYmd,
} from './historyUtils.js';
import { WEEKDAYS } from '../data/models.js';

/** n records for one week, shaped like the real ones. */
const week = (weekKey, n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${weekKey}:mon:morning:pick-bed:emp-${i}`,
    weekKey,
    dayKey: 'mon',
    date: '2026-01-05',
    shift: 'morning',
    dutyId: 'pick-bed',
    employeeId: `emp-${i}`,
  }));

const key = (y, w) => `${y}-W${String(w).padStart(2, '0')}`;

describe('pruneHistory', () => {
  it('leaves history alone while under the limit', () => {
    const recs = [...week(key(2026, 1)), ...week(key(2026, 2))];
    const { kept, dropped, droppedWeeks } = pruneHistory(recs, 52);
    expect(kept).toHaveLength(recs.length);
    expect(dropped).toHaveLength(0);
    expect(droppedWeeks).toEqual([]);
  });

  it('keeps exactly the newest N weeks and reports what went', () => {
    const recs = Array.from({ length: 5 }, (_, i) => week(key(2026, i + 1))).flat();
    const { kept, droppedWeeks } = pruneHistory(recs, 3);
    expect([...new Set(kept.map((r) => r.weekKey))].sort()).toEqual(['2026-W03', '2026-W04', '2026-W05']);
    expect(droppedWeeks).toEqual(['2026-W01', '2026-W02']);
  });

  it('drops whole weeks, never partial ones', () => {
    const recs = [...week(key(2026, 1), 4), ...week(key(2026, 2), 4), ...week(key(2026, 3), 4)];
    const { kept, dropped } = pruneHistory(recs, 2);
    expect(kept).toHaveLength(8);
    expect(dropped).toHaveLength(4);
    expect(dropped.every((r) => r.weekKey === '2026-W01')).toBe(true);
  });

  it('orders weeks by year, not just week number', () => {
    const recs = [...week(key(2025, 52)), ...week(key(2026, 1)), ...week(key(2026, 2))];
    const { droppedWeeks } = pruneHistory(recs, 2);
    expect(droppedWeeks).toEqual(['2025-W52']); // the 2025 week is the oldest
  });

  it('counts weeks present, not weeks elapsed — gaps cost nothing', () => {
    // A team that only saves every 4th week keeps a full year of real rosters.
    const recs = [1, 5, 9, 13].map((w) => week(key(2026, w))).flat();
    const { dropped } = pruneHistory(recs, 4);
    expect(dropped).toHaveLength(0);
  });

  it('is a no-op for an unset/invalid limit rather than wiping history', () => {
    const recs = week(key(2026, 1));
    for (const limit of [0, -1, null, undefined, NaN, 'x']) {
      expect(pruneHistory(recs, limit, 0).kept).toHaveLength(recs.length);
    }
  });

  it('sheds extra weeks when the week window still busts the byte budget', () => {
    const recs = Array.from({ length: 10 }, (_, i) => week(key(2026, i + 1), 50)).flat();
    const perWeek = historyBytes(week(key(2026, 1), 50));
    const { kept, droppedWeeks } = pruneHistory(recs, 10, perWeek * 3);
    expect(historyBytes(kept)).toBeLessThanOrEqual(perWeek * 3);
    expect(droppedWeeks.length).toBeGreaterThan(0);
    // whatever survives must be the NEWEST weeks
    expect(Math.min(...kept.map((r) => Number(r.weekKey.slice(-2))))).toBeGreaterThan(
      Math.max(...droppedWeeks.map((w) => Number(w.slice(-2))))
    );
  });

  it('keeps the newest week even if that single week busts the budget', () => {
    const recs = [...week(key(2026, 1), 200), ...week(key(2026, 2), 200)];
    const { kept, droppedWeeks } = pruneHistory(recs, 52, 10);
    expect(droppedWeeks).toEqual(['2026-W01']);
    expect(kept.every((r) => r.weekKey === '2026-W02')).toBe(true); // never empty
  });

  it('tolerates empty/missing input', () => {
    expect(pruneHistory([], 52).kept).toEqual([]);
    expect(pruneHistory(undefined, 52).kept).toEqual([]);
  });

  it('never returns more records than it was given', () => {
    const recs = Array.from({ length: 60 }, (_, i) => week(key(2026, i + 1), 2)).flat();
    const { kept, dropped } = pruneHistory(recs, HISTORY_KEEP_WEEKS);
    expect(kept.length + dropped.length).toBe(recs.length);
    expect(new Set(kept.map((r) => r.weekKey)).size).toBe(HISTORY_KEEP_WEEKS);
  });
});

describe('record shape', () => {
  const fat = {
    id: '2026-W02:wed:morning:qc-bed:emp-7',
    weekKey: '2026-W02',
    year: 2026,
    week: 2,
    dayKey: 'wed',
    date: '2026-01-07',
    shift: 'morning',
    dutyId: 'qc-bed',
    employeeId: 'emp-7',
  };

  it('stores only what cannot be recomputed', () => {
    expect(Object.keys(slimRecord(fat)).sort()).toEqual([...RECORD_FIELDS].sort());
  });

  it('keeps every stored value intact', () => {
    for (const f of RECORD_FIELDS) expect(slimRecord(fat)[f]).toBe(fat[f]);
  });

  it('is idempotent — slimming a slim row changes nothing', () => {
    expect(slimRecord(slimRecord(fat))).toEqual(slimRecord(fat));
  });

  it('recomputes the date the dropped field used to hold', () => {
    expect(recordYmd(slimRecord(fat))).toBe(fat.date);
  });

  it('derives the right date for every weekday of a week', () => {
    // 2026-W02 runs Mon 2026-01-05 … Sun 2026-01-11.
    const got = DAY_KEYS.map((dayKey) => recordYmd({ weekKey: '2026-W02', dayKey }));
    expect(got).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
      '2026-01-11',
    ]);
  });

  it('handles the year boundary, where weekKey and calendar year differ', () => {
    // ISO week 1 of 2026 starts Mon 2025-12-29.
    expect(recordYmd({ weekKey: '2026-W01', dayKey: 'mon' })).toBe('2025-12-29');
    expect(recordYmd({ weekKey: '2026-W01', dayKey: 'sun' })).toBe('2026-01-04');
  });

  it('falls back to a legacy row’s stored date if the key is unparseable', () => {
    expect(recordYmd({ weekKey: 'garbage', dayKey: 'mon', date: '2026-01-05' })).toBe('2026-01-05');
    expect(recordYmd({ weekKey: 'garbage', dayKey: 'mon' })).toBeNull();
  });

  it('DAY_KEYS matches WEEKDAYS in data/models.js', () => {
    // The two are duplicated to avoid a circular import; this keeps them honest.
    expect(DAY_KEYS).toEqual(WEEKDAYS.map((d) => d.key));
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('cuts the file down by roughly half', () => {
    const fatWeek = Array.from({ length: 140 }, () => fat);
    const saved = 1 - historyBytes(slimHistory(fatWeek)) / historyBytes(fatWeek);
    expect(saved).toBeGreaterThan(0.4);
  });

  it('lets a full year survive — the byte budget no longer has to bite', () => {
    // Same load that forced pruning down to 27 weeks with the old fat rows.
    const recs = Array.from({ length: HISTORY_KEEP_WEEKS }, (_, i) =>
      Array.from({ length: 140 }, (_, j) => slimRecord({ ...fat, weekKey: key(2026, i + 1), employeeId: `emp-${j}` }))
    ).flat();
    const { kept, droppedWeeks } = pruneHistory(recs);
    expect(droppedWeeks).toEqual([]); // all 52 weeks kept
    expect(historyBytes(kept)).toBeLessThanOrEqual(HISTORY_BUDGET_BYTES);
    // Still reads as "warn": a year IS the ceiling, and week 53 will age one out.
    expect(historyHealth(historyBytes(kept))).toBe('warn');
  });
});

describe('size reporting', () => {
  it('measures UTF-8 bytes, so Thai text is not undercounted', () => {
    expect(historyBytes([{ weekKey: 'กะเช้า' }])).toBeGreaterThan(JSON.stringify([{ weekKey: 'กะเช้า' }]).length);
  });

  it('flags the file before it hits the 1 MB API ceiling', () => {
    expect(historyHealth(100 * 1024)).toBe('ok');
    expect(historyHealth(800 * 1024)).toBe('warn');
    expect(historyHealth(1024 * 1024)).toBe('over');
  });

  it('warns while there is still room, so a backup is possible before pruning', () => {
    // A file sitting at the steady state (just under budget) must read as "warn",
    // otherwise the user only ever learns weeks were dropped after the fact.
    expect(HISTORY_WARN_BYTES).toBeLessThan(HISTORY_BUDGET_BYTES);
    expect(historyHealth(HISTORY_BUDGET_BYTES - 1)).toBe('warn');
  });

  it('formats readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });
});

describe('the file can never grow past what GitHub will hand back', () => {
  // 7 days × 2 shifts × 5 duties × 2 people ≈ 140 rows/week — the team's shape.
  // At that size a plain 52-week window is ~1.3 MB, so the byte budget must bite.
  it('caps a heavy year below the 1 MB API ceiling', () => {
    const recs = Array.from({ length: HISTORY_KEEP_WEEKS }, (_, i) => week(key(2026, i + 1), 140)).flat();
    expect(historyBytes(recs)).toBeGreaterThan(HISTORY_MAX_BYTES); // unpruned would break
    const { kept, droppedWeeks } = pruneHistory(recs);
    expect(historyHealth(historyBytes(kept))).not.toBe('over');
    expect(droppedWeeks.length).toBeGreaterThan(0);
  });

  it('stays bounded no matter how many weeks pile up', () => {
    // Small weeks against an explicit small budget. What this proves is that
    // repeated saves converge to a steady state instead of creeping upward —
    // the exact byte figures are the previous test's job. Sizing it down also
    // keeps the run fast: pruneHistory re-serializes the document once per
    // week it drops, so a full-size 200-week loop took ~4.9s and would time
    // out on a loaded machine.
    const BUDGET = 8000;
    let live = [];
    for (let w = 0; w < 200; w++) {
      const wk = key(2026 + Math.floor(w / 52), (w % 52) + 1); // always moves forward
      // mirror the real save path, which replaces the week being saved
      live = pruneHistory([...live.filter((r) => r.weekKey !== wk), ...week(wk, 5)], 52, BUDGET).kept;
      expect(historyBytes(live)).toBeLessThanOrEqual(BUDGET);
    }
    expect(live.length).toBeGreaterThan(0); // never prunes itself to nothing
  });
});
