/**
 * @file ISO-8601 week helpers. Weeks start on Monday; week 1 is the week
 * containing the year's first Thursday. All functions are timezone-safe by
 * operating on UTC dates.
 */

/** Zero-pad a number to 2 digits. */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Return the ISO week-numbering {year, week} for a given Date.
 * @param {Date} date
 * @returns {{year:number, week:number}}
 */
export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday of the current week decides the ISO year.
  const dayNum = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** "2026-W07" style key. */
export function weekKey(year, week) {
  return `${year}-W${pad2(week)}`;
}

/** Parse "2026-W07" back into {year, week}. Returns null if malformed. */
export function parseWeekKey(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ''));
  if (!m) return null;
  return { year: Number(m[1]), week: Number(m[2]) };
}

/**
 * Date (UTC midnight) of the Monday that starts the given ISO week.
 * @param {number} year
 * @param {number} week
 * @returns {Date}
 */
export function isoWeekMonday(year, week) {
  // Jan 4th is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

/**
 * The 7 dates (Mon..Sun) of an ISO week as { iso, date, ymd }.
 * @param {number} year
 * @param {number} week
 */
export function datesOfISOWeek(year, week) {
  const monday = isoWeekMonday(year, week);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setUTCDate(monday.getUTCDate() + i);
    return {
      iso: i + 1, // Mon=1 … Sun=7
      date: dt,
      ymd: `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
    };
  });
}

/** {year, week} of today. */
export function currentWeek() {
  return getISOWeek(new Date());
}

/**
 * Produce the list of the N week keys ending at (and excluding) the target week.
 * Used by the rotation engine to look back over history.
 * @returns {string[]} e.g. ["2026-W26","2026-W27","2026-W28","2026-W29"]
 */
export function previousWeekKeys(year, week, count) {
  const keys = [];
  const monday = isoWeekMonday(year, week);
  for (let i = count; i >= 1; i--) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() - i * 7);
    const w = getISOWeek(d);
    keys.push(weekKey(w.year, w.week));
  }
  return keys;
}

/**
 * The calendar month a given ISO week "belongs" to — using its Thursday, the
 * day that defines the ISO week — as "YYYY-MM". Used to pick the monthly shift
 * plan for a roster week.
 */
export function monthKeyOfWeek(year, week) {
  const thu = datesOfISOWeek(year, week)[3].date; // index 3 = Thursday
  return `${thu.getUTCFullYear()}-${pad2(thu.getUTCMonth() + 1)}`;
}

/** How many ISO weeks `key` is before the reference {year, week} (0 = same week). */
export function weeksAgo(refYear, refWeek, key) {
  const parsed = parseWeekKey(key);
  if (!parsed) return Infinity;
  const refMon = isoWeekMonday(refYear, refWeek);
  const keyMon = isoWeekMonday(parsed.year, parsed.week);
  return Math.round((refMon - keyMon) / (7 * 86400000));
}

/** Human short date "Mon 20 Jul". */
export function formatShort(date) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}
