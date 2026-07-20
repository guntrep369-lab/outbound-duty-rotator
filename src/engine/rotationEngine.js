/**
 * @file rotationEngine.js — the Fair, History-Aware Rotation Algorithm.
 *
 * This is intentionally NOT random. For every working day and shift it assigns
 * employees to Outbound duties by minimising a cost that rewards:
 *   1) duties the employee has NOT performed recently (last N weeks of history), and
 *   2) an even spread of total workload within the shift (busy people rest first).
 *
 * The algorithm is deterministic given the same inputs (a seeded tiebreak keeps
 * regenerations stable) yet varies naturally week-to-week as history accumulates.
 */

import { SHIFTS, EMPLOYEE_STATUS, EMPLOYEE_TYPES, STATUS_LIST } from '../data/models.js';
import { weekKey as makeWeekKey, previousWeekKeys, weeksAgo, datesOfISOWeek } from '../utils/dateUtils.js';
import { WEEKDAYS } from '../data/models.js';

/** Deterministic string hash → unsigned int, for stable tiebreaks. */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ELIGIBLE_STATUS = new Set(
  STATUS_LIST.filter((s) => s.eligible).map((s) => s.id)
);

/** Is an employee eligible to be placed into the rotation? */
export function isEligible(emp) {
  return !!emp && ELIGIBLE_STATUS.has(emp.status);
}

/**
 * Build per-employee history signals from the lookback window.
 * @returns {{
 *   dutyWeighted: Map<string, Map<string, number>>,  // emp -> duty -> recency-weighted count
 *   workload: Map<string, number>                    // emp -> plain duty count in window
 * }}
 */
function analyzeHistory(history, year, week, lookbackWeeks) {
  const windowKeys = new Set(previousWeekKeys(year, week, lookbackWeeks));
  const dutyWeighted = new Map();
  const workload = new Map();

  for (const rec of history || []) {
    if (!windowKeys.has(rec.weekKey)) continue;
    // Recency weight: most recent week counts the most.
    const ago = weeksAgo(year, week, rec.weekKey); // 1..lookbackWeeks
    const weight = Math.max(1, lookbackWeeks - ago + 1);

    if (!dutyWeighted.has(rec.employeeId)) dutyWeighted.set(rec.employeeId, new Map());
    const perDuty = dutyWeighted.get(rec.employeeId);
    perDuty.set(rec.dutyId, (perDuty.get(rec.dutyId) || 0) + weight);

    workload.set(rec.employeeId, (workload.get(rec.employeeId) || 0) + 1);
  }
  return { dutyWeighted, workload };
}

/**
 * Assign one shift on one day. Mutates `genWorkload` and `genDuty` counters so
 * fairness carries across the days of the week being generated.
 */
function assignShiftDay({
  dayIndex,
  dayKey,
  shift,
  eligible,
  tasks,
  hist,
  genWorkload,
  genDuty,
  seed,
}) {
  const assignments = {}; // dutyId -> [empId]
  const understaffed = []; // { dutyId, needed, got }
  const assignedToday = new Set();

  // Duties needing people on this shift, config order rotated by day so the
  // "first pick" of scarce staff rotates fairly across the week.
  const active = tasks
    .filter((t) => t.active && Number(t.req?.[shift]) > 0)
    .map((t) => t);
  const rotated = active.map(
    (_, i) => active[(i + dayIndex) % active.length]
  );

  // Cost of putting `emp` on `duty` right now. Lower = better.
  const dutyCost = (empId, dutyId) => {
    const weighted = hist.dutyWeighted.get(empId)?.get(dutyId) || 0;
    const genRepeat = genDuty.get(empId)?.get(dutyId) || 0;
    // genRepeat dominates so nobody repeats the same duty all week;
    // weighted history is the next strongest signal.
    return genRepeat * 1000 + weighted * 10;
  };

  // Total workload signal. Lower = should receive work first.
  const workloadCost = (empId) =>
    (genWorkload.get(empId) || 0) * 100 + (hist.workload.get(empId) || 0);

  // Outsource เสริม are surge staff: they only receive duties once every
  // inhouse / outsource-ประจำ person on the shift is already assigned that day.
  const typeRank = (emp) => (emp.type === EMPLOYEE_TYPES.OUTSOURCE_EXTRA ? 1 : 0);

  for (const duty of rotated) {
    const need = Number(duty.req[shift]) || 0;
    const chosen = [];
    for (let slot = 0; slot < need; slot++) {
      const pool = eligible.filter((e) => !assignedToday.has(e.id));
      if (pool.length === 0) break;

      pool.sort((a, b) => {
        // Policy first: regulars (inhouse + outsource ประจำ) before outsource เสริม.
        const t = typeRank(a) - typeRank(b);
        if (t !== 0) return t;
        const c = dutyCost(a.id, duty.id) - dutyCost(b.id, duty.id);
        if (c !== 0) return c;
        const w = workloadCost(a.id) - workloadCost(b.id);
        if (w !== 0) return w;
        // Deterministic, well-mixed tiebreak (varies per week+day+duty+slot).
        return (
          hashStr(`${seed}:${duty.id}:${slot}:${a.id}`) -
          hashStr(`${seed}:${duty.id}:${slot}:${b.id}`)
        );
      });

      const pick = pool[0];
      chosen.push(pick.id);
      assignedToday.add(pick.id);
      // Update live counters.
      genWorkload.set(pick.id, (genWorkload.get(pick.id) || 0) + 1);
      if (!genDuty.has(pick.id)) genDuty.set(pick.id, new Map());
      const gd = genDuty.get(pick.id);
      gd.set(duty.id, (gd.get(duty.id) || 0) + 1);
    }
    assignments[duty.id] = chosen;
    if (chosen.length < need) {
      understaffed.push({ dutyId: duty.id, needed: need, got: chosen.length });
    }
  }

  // Whoever is eligible but not placed today rests (standby). Because busy
  // people sort last for duties, standby naturally rotates by workload.
  const standby = eligible.filter((e) => !assignedToday.has(e.id)).map((e) => e.id);

  return { assignments, standby, understaffed };
}

/**
 * Generate a full weekly schedule.
 * @param {Object} args
 * @param {number} args.year
 * @param {number} args.week
 * @param {import('../data/models.js').Employee[]} args.employees
 * @param {{tasks:any[], workingDays:number[], lookbackWeeks:number}} args.config
 * @param {import('../data/models.js').HistoryRecord[]} args.history
 * @returns {Object} schedule
 */
export function generateSchedule({ year, week, employees, config, history }) {
  const wk = makeWeekKey(year, week);
  const lookbackWeeks = config.lookbackWeeks || 4;
  const hist = analyzeHistory(history, year, week, lookbackWeeks);
  const weekDates = datesOfISOWeek(year, week);
  const workingDays = (config.workingDays && config.workingDays.length ? config.workingDays : [1, 2, 3, 4, 5])
    .slice()
    .sort((a, b) => a - b);

  // Live fairness counters shared across all days of the week.
  const genWorkload = new Map();
  const genDuty = new Map();

  const eligibleAll = employees.filter(isEligible);
  const byShift = {
    [SHIFTS.MORNING]: eligibleAll.filter((e) => e.primaryShift === SHIFTS.MORNING),
    [SHIFTS.AFTERNOON]: eligibleAll.filter((e) => e.primaryShift === SHIFTS.AFTERNOON),
  };

  const grid = {};
  const records = [];

  workingDays.forEach((iso, dayIndex) => {
    const wd = WEEKDAYS.find((d) => d.iso === iso);
    if (!wd) return;
    const dateInfo = weekDates.find((d) => d.iso === iso);
    const dayCell = { iso, date: dateInfo?.ymd || '', label: wd.label, labelTh: wd.labelTh };

    for (const shift of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = assignShiftDay({
        dayIndex,
        dayKey: wd.key,
        shift,
        eligible: byShift[shift],
        tasks: config.tasks,
        hist,
        genWorkload,
        genDuty,
        seed: `${wk}:${wd.key}`,
      });
      dayCell[shift] = res;

      // Flatten real duty assignments into history records.
      for (const [dutyId, empIds] of Object.entries(res.assignments)) {
        for (const employeeId of empIds) {
          records.push({
            id: `${wk}:${wd.key}:${shift}:${dutyId}:${employeeId}`,
            weekKey: wk,
            year,
            week,
            dayKey: wd.key,
            date: dayCell.date,
            shift,
            dutyId,
            employeeId,
          });
        }
      }
    }
    grid[wd.key] = dayCell;
  });

  return {
    weekKey: wk,
    year,
    week,
    generatedAt: new Date().toISOString(),
    workingDays,
    grid,
    records,
    summary: buildSummary({ grid, workingDays, employees, config }),
  };
}

/**
 * Compute a fairness / distribution summary for a generated (or edited) schedule.
 * Recomputed from the grid so it stays correct after manual swaps.
 */
export function buildSummary({ grid, workingDays, employees, config }) {
  const empIndex = new Map(employees.map((e) => [e.id, e]));
  const byEmployee = {}; // empId -> { total, standby, byDuty }
  let understaffedCount = 0;

  const touch = (empId) => {
    if (!byEmployee[empId]) byEmployee[empId] = { total: 0, standby: 0, byDuty: {} };
    return byEmployee[empId];
  };

  for (const dayKey of Object.keys(grid)) {
    const cell = grid[dayKey];
    for (const shift of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = cell[shift];
      if (!res) continue;
      understaffedCount += (res.understaffed || []).reduce(
        (s, u) => s + (u.needed - u.got),
        0
      );
      for (const [dutyId, empIds] of Object.entries(res.assignments || {})) {
        for (const empId of empIds) {
          const rec = touch(empId);
          rec.total += 1;
          rec.byDuty[dutyId] = (rec.byDuty[dutyId] || 0) + 1;
        }
      }
      for (const empId of res.standby || []) {
        touch(empId).standby += 1;
      }
    }
  }

  // Fairness score: 100 = perfectly even workload among people who worked at all.
  const totals = Object.values(byEmployee)
    .map((r) => r.total)
    .filter((t) => t > 0);
  let fairnessScore = 100;
  if (totals.length > 1) {
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance =
      totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // coefficient of variation
    fairnessScore = Math.max(0, Math.round((1 - cv) * 100));
  }

  return {
    byEmployee,
    understaffedCount,
    fairnessScore,
    employeeCount: Object.keys(byEmployee).length,
    empIndex: undefined, // (kept out of serialized data)
  };
}
