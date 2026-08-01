/**
 * @file historyUtils.js — keep history.json from growing without bound.
 *
 * WHY: every saved week appends ~7 days × 2 shifts × 5 duties × N people rows.
 * history.json is read and rewritten whole through the GitHub Contents API,
 * which stops returning inline content above 1 MB — so an unbounded file would
 * eventually break loading for everyone. The rotation engine only ever looks
 * back `lookbackWeeks` (4), so anything beyond a browsing window is dead weight.
 *
 * Pure functions — no React, no I/O.
 */

import { parseWeekKey, datesOfISOWeek } from './dateUtils.js';

/** Weeks of history we'd LIKE to keep — a year of browsable rosters. */
export const HISTORY_KEEP_WEEKS = 52;

/**
 * Hard size budget, comfortably under the API's 1 MB ceiling. This, not the
 * week count, is the real guarantee: bytes per week depend on head-count and
 * duty count, so a fixed week limit alone can't promise the file stays
 * readable. Sized so a full 52 weeks of this team's roster (~14 KB/week) fits
 * — the budget is the safety net for a bigger team, not the normal governor.
 */
export const HISTORY_BUDGET_BYTES = 800 * 1024;

/**
 * Meter thresholds shown in the History tab. The warning sits BELOW the budget
 * on purpose: it has to fire while there is still room, so the user can take a
 * backup before a save starts dropping weeks — not after.
 */
export const HISTORY_WARN_BYTES = Math.round(HISTORY_BUDGET_BYTES * 0.8);
export const HISTORY_MAX_BYTES = 1024 * 1024;

/**
 * Bound history so history.json stays small enough to read back.
 *
 * Two stages:
 *  1. keep the most recent `keepWeeks` DISTINCT weeks present — counting weeks
 *     that exist (not weeks elapsed) means a team that skips weeks never loses
 *     rosters early;
 *  2. keep dropping the oldest remaining week until the document fits
 *     `maxBytes`. Stage 2 is what actually guarantees the file stays usable.
 *
 * @param {Array<{weekKey:string}>} records
 * @param {number} keepWeeks
 * @param {number} maxBytes
 * @returns {{kept:Array, dropped:Array, droppedWeeks:string[]}}
 */
export function pruneHistory(records, keepWeeks = HISTORY_KEEP_WEEKS, maxBytes = HISTORY_BUDGET_BYTES) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return { kept: list, dropped: [], droppedWeeks: [] };

  const limit = Number(keepWeeks);
  const budget = Number(maxBytes);
  const noWeekLimit = !Number.isFinite(limit) || limit <= 0;
  const noBudget = !Number.isFinite(budget) || budget <= 0;
  if (noWeekLimit && noBudget) return { kept: list, dropped: [], droppedWeeks: [] };

  // weekKey is "YYYY-Www" with a zero-padded week, so it sorts lexicographically.
  let weeks = [...new Set(list.map((r) => r.weekKey))].sort((a, b) => b.localeCompare(a));
  const droppedWeeks = [];

  // 1 — week window
  if (!noWeekLimit && weeks.length > limit) {
    droppedWeeks.push(...weeks.slice(limit));
    weeks = weeks.slice(0, limit);
  }

  // 2 — size budget: shed the oldest week until it fits (always keep one week,
  // otherwise a single oversized week would wipe history entirely).
  if (!noBudget) {
    let keep = new Set(weeks);
    while (weeks.length > 1 && historyBytes(list.filter((r) => keep.has(r.weekKey))) > budget) {
      droppedWeeks.push(weeks.pop()); // oldest is last (weeks are newest-first)
      keep = new Set(weeks);
    }
  }

  if (droppedWeeks.length === 0) return { kept: list, dropped: [], droppedWeeks: [] };

  const keep = new Set(weeks);
  const kept = [];
  const dropped = [];
  for (const r of list) (keep.has(r.weekKey) ? kept : dropped).push(r);

  return { kept, dropped, droppedWeeks: droppedWeeks.sort() };
}

/* ─────────────────────────── record shape ─────────────────────────────────
   A history row stores ONLY what cannot be recomputed:

     { weekKey, dayKey, shift, dutyId, employeeId }

   Older files also carried `id` (a join of the other five), `year`/`week`
   (both inside weekKey) and `date` (weekKey + dayKey). They cost ~47% of the
   file for nothing, so they are dropped on the next save. Readers must derive
   instead — recordYmd() below does the date.
   ───────────────────────────────────────────────────────────────────────── */

/** The fields a history row actually stores. */
export const RECORD_FIELDS = ['weekKey', 'dayKey', 'shift', 'dutyId', 'employeeId'];

/** Strip a row down to the stored fields. Safe on rows already slim. */
export function slimRecord(rec) {
  return { weekKey: rec.weekKey, dayKey: rec.dayKey, shift: rec.shift, dutyId: rec.dutyId, employeeId: rec.employeeId };
}

/**
 * Normalise a whole history document. Applied on save so legacy rows shrink
 * as the file is rewritten — no separate migration step, no version flag.
 */
export function slimHistory(records) {
  return (Array.isArray(records) ? records : []).map(slimRecord);
}

/**
 * ISO weekday (1=Mon … 7=Sun) → dayKey, mirroring WEEKDAYS in data/models.js.
 * Duplicated rather than imported because models.js imports THIS file for its
 * default config — importing back would make the two modules circular.
 * historyUtils.test.js asserts the two lists stay in step.
 */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** weekKey → the week's seven ymd strings, keyed by dayKey. Cached: weeks repeat. */
const weekDatesCache = new Map();

function datesForWeek(weekKey) {
  let byDay = weekDatesCache.get(weekKey);
  if (byDay) return byDay;
  const parsed = parseWeekKey(weekKey);
  byDay = {};
  if (parsed) {
    for (const d of datesOfISOWeek(parsed.year, parsed.week)) byDay[DAY_KEYS[d.iso - 1]] = d.ymd;
  }
  weekDatesCache.set(weekKey, byDay);
  return byDay;
}

/**
 * Calendar date (YYYY-MM-DD) of a history row, derived from weekKey + dayKey.
 * Falls back to a legacy row's stored `date` if the key can't be parsed.
 */
export function recordYmd(rec) {
  return datesForWeek(rec.weekKey)[rec.dayKey] ?? rec.date ?? null;
}

/** Serialized size of the history document, in bytes. */
export function historyBytes(records) {
  return new TextEncoder().encode(JSON.stringify(records ?? [])).length;
}

/** 'ok' | 'warn' | 'over' — drives the meter in the History tab. */
export function historyHealth(bytes) {
  if (bytes >= HISTORY_MAX_BYTES) return 'over';
  if (bytes >= HISTORY_WARN_BYTES) return 'warn';
  return 'ok';
}

/** "412 KB" / "1.2 MB" */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
