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
} from './historyUtils.js';

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
    let live = [];
    for (let w = 1; w <= 200; w++) {
      live = pruneHistory([...live, ...week(key(2026 + Math.floor(w / 53), (w % 52) + 1), 140)]).kept;
      expect(historyBytes(live)).toBeLessThanOrEqual(HISTORY_BUDGET_BYTES);
    }
  });
});
