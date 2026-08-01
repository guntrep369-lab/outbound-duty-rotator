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

/** Weeks of history we'd LIKE to keep — a year of browsable rosters. */
export const HISTORY_KEEP_WEEKS = 52;

/**
 * Hard size budget. This, not the week count, is the real guarantee: how many
 * bytes a week costs depends on head-count and duty count, so a fixed week
 * limit alone can't promise the file stays readable.
 */
export const HISTORY_BUDGET_BYTES = 700 * 1024;

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
