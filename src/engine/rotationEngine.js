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

import {
  SHIFTS,
  EMPLOYEE_STATUS,
  EMPLOYEE_TYPES,
  EXTRA_ID,
  STATUS_LIST,
  taskAllowsType,
  resolveTaskReq,
  reqTotal,
  isAvailableOn,
  unavailabilityOn,
  effectiveShiftOn,
  holidayOn,
} from '../data/models.js';
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
  totalDays,
  dayKey,
  ymd,
  iso,
  shift,
  eligible,
  tasks,
  hist,
  genWorkload,
  genDuty,
  extraRules,
  surgeCap,
  weekReq,
  seed,
}) {
  const assignments = {}; // dutyId -> [empId]
  const needs = {}; // dutyId -> { inhouse, outsource, total } resolved for THIS day
  const understaffed = []; // { dutyId, needed, got }
  const assignedToday = new Set();
  let extraAssigned = 0; // how many outsource เสริม placed today (for the surge cap)

  // Remove anyone unavailable on this calendar day (recurring day-off or on
  // leave). They are reported separately so the roster can explain the gap.
  const unavailable = eligible
    .filter((e) => !isAvailableOn(e, ymd, iso))
    .map((e) => ({ employeeId: e.id, ...unavailabilityOn(e, ymd, iso) }));
  const present = eligible.filter((e) => isAvailableOn(e, ymd, iso));

  // Duties needing people on this shift. Fill TYPE-RESTRICTED tasks first so
  // their scarce allowed-type staff aren't used up by open tasks. Within each
  // group, rotate the order by day so the "first pick" rotates fairly.
  // Requirement for THIS calendar day (week overrides beat the base config).
  const needOf = (t) => {
    if (!needs[t.id]) {
      const r = resolveTaskReq(t, shift, iso, weekReq);
      needs[t.id] = { ...r, total: reqTotal(r) };
    }
    return needs[t.id];
  };
  const active = tasks.filter((t) => t.active && needOf(t).total > 0);
  const rotate = (arr) => (arr.length ? arr.map((_, i) => arr[(i + dayIndex) % arr.length]) : arr);
  const restricted = active.filter((t) => Array.isArray(t.allowedTypes) && t.allowedTypes.length > 0);
  const openTasks = active.filter((t) => !(Array.isArray(t.allowedTypes) && t.allowedTypes.length > 0));
  const rotated = [...rotate(restricted), ...rotate(openTasks)];

  // Cost of putting `emp` on `duty` right now. Lower = better.
  const dutyCost = (empId, dutyId) => {
    const weighted = hist.dutyWeighted.get(empId)?.get(dutyId) || 0;
    const genRepeat = genDuty.get(empId)?.get(dutyId) || 0;
    return genRepeat * 1000 + weighted * 10;
  };
  const workloadCost = (empId) => (genWorkload.get(empId) || 0) * 100 + (hist.workload.get(empId) || 0);

  const maxDays = extraRules?.maxDays == null ? null : Math.max(0, Number(extraRules.maxDays) || 0);
  const minDays = Math.max(0, Number(extraRules?.minDays) || 0);
  const isExtra = (emp) => emp.type === EMPLOYEE_TYPES.OUTSOURCE_EXTRA;
  const daysWorked = (empId) => genWorkload.get(empId) || 0;

  /**
   * An outsource-เสริม who can no longer reach their weekly minimum unless they
   * work today (days still needed >= working days left, incl. today). These are
   * placed BEFORE the core quota, so the guarantee holds even on days when
   * inhouse + outsource-ประจำ could have covered every slot on their own.
   */
  const remainingDays = totalDays - dayIndex;
  const mustWorkToday = (e) => {
    if (!isExtra(e) || minDays <= 0) return false;
    if (maxDays != null && daysWorked(e.id) >= maxDays) return false;
    const needMore = minDays - daysWorked(e.id);
    return needMore > 0 && needMore >= remainingDays;
  };

  // Pick the best candidate from a pool for a duty slot (pin → recency → workload).
  const sortPool = (pool, dutyId, slot) =>
    pool.sort((a, b) => {
      const pin = (a.fixedDutyId === dutyId ? 0 : 1) - (b.fixedDutyId === dutyId ? 0 : 1);
      if (pin !== 0) return pin;
      const c = dutyCost(a.id, dutyId) - dutyCost(b.id, dutyId);
      if (c !== 0) return c;
      const w = workloadCost(a.id) - workloadCost(b.id);
      if (w !== 0) return w;
      return hashStr(`${seed}:${dutyId}:${slot}:${a.id}`) - hashStr(`${seed}:${dutyId}:${slot}:${b.id}`);
    });

  const place = (empId, dutyId) => {
    assignedToday.add(empId);
    genWorkload.set(empId, (genWorkload.get(empId) || 0) + 1);
    if (!genDuty.has(empId)) genDuty.set(empId, new Map());
    const gd = genDuty.get(empId);
    gd.set(dutyId, (gd.get(dutyId) || 0) + 1);
  };

  for (const duty of rotated) assignments[duty.id] = [];
  const roomLeft = (duty) => needOf(duty).total - assignments[duty.id].length;

  // ── Guaranteed minimum for เสริม (runs first — may take a slot the core
  //    staff would otherwise have filled; that is what "ขั้นต่ำ" means). ─────
  for (const e of present.filter(mustWorkToday)) {
    if (surgeCap != null && extraAssigned >= surgeCap) break;
    const duty = rotated.find(
      (d) =>
        roomLeft(d) > 0 &&
        taskAllowsType(d, EMPLOYEE_TYPES.OUTSOURCE_EXTRA) &&
        (!e.fixedDutyId || e.fixedDutyId === d.id)
    );
    if (!duty) break; // no room anywhere today
    assignments[duty.id].push(e.id);
    place(e.id, duty.id);
    extraAssigned += 1;
  }

  // ── Base fill: hard type quotas (inhouse + outsource ประจำ) ──────────────
  for (const duty of rotated) {
    const dutyNeed = needOf(duty);
    for (const bt of [EMPLOYEE_TYPES.INHOUSE, EMPLOYEE_TYPES.OUTSOURCE_REGULAR]) {
      const bneed = bt === EMPLOYEE_TYPES.INHOUSE ? dutyNeed.inhouse : dutyNeed.outsource;
      for (let slot = 0; slot < bneed; slot++) {
        if (roomLeft(duty) <= 0) break; // a must-work เสริม already took the slot
        const pool = present.filter(
          (e) =>
            e.type === bt &&
            !assignedToday.has(e.id) &&
            taskAllowsType(duty, e.type) &&
            (!e.fixedDutyId || e.fixedDutyId === duty.id)
        );
        if (pool.length === 0) break;
        sortPool(pool, duty.id, slot);
        assignments[duty.id].push(pool[0].id);
        place(pool[0].id, duty.id);
      }
    }
  }

  // ── เสริม overflow: top up gaps up to taskNeed. Named เสริม first (surge —
  //    fills whenever core is short; capped by the Surge Plan if enabled), then
  //    ANONYMOUS เสริม (only when a Surge Plan number is set). ─────────────────
  const underCap = () => surgeCap == null || extraAssigned < surgeCap;
  // (a) named เสริม
  for (const duty of rotated) {
    if (!underCap()) break;
    if (!taskAllowsType(duty, EMPLOYEE_TYPES.OUTSOURCE_EXTRA)) continue;
    const need = needOf(duty).total;
    while (assignments[duty.id].length < need && underCap()) {
      const pool = present.filter(
        (e) =>
          isExtra(e) &&
          !assignedToday.has(e.id) &&
          taskAllowsType(duty, e.type) &&
          (maxDays == null || daysWorked(e.id) < maxDays) &&
          (!e.fixedDutyId || e.fixedDutyId === duty.id)
      );
      if (pool.length === 0) break;
      sortPool(pool, duty.id, assignments[duty.id].length);
      assignments[duty.id].push(pool[0].id);
      place(pool[0].id, duty.id);
      extraAssigned += 1;
    }
  }
  // (b) anonymous เสริม (needs a Surge Plan count to know how many to add)
  if (surgeCap != null) {
    for (const duty of rotated) {
      if (extraAssigned >= surgeCap) break;
      if (!taskAllowsType(duty, EMPLOYEE_TYPES.OUTSOURCE_EXTRA)) continue;
      const need = needOf(duty).total;
      while (assignments[duty.id].length < need && extraAssigned < surgeCap) {
        assignments[duty.id].push(EXTRA_ID);
        extraAssigned += 1;
      }
    }
  }

  // Understaffed = slots still short of the total requirement.
  for (const duty of rotated) {
    const need = needOf(duty).total;
    const got = (assignments[duty.id] || []).length;
    if (got < need) understaffed.push({ dutyId: duty.id, needed: need, got });
  }

  // Whoever is present but not placed today rests (standby).
  const standby = present.filter((e) => !assignedToday.has(e.id)).map((e) => e.id);

  // `needs` is persisted so the UI (and manual edits) know this day's targets
  // without having to re-resolve overrides.
  return { assignments, needs, standby, understaffed, unavailable };
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
export function generateSchedule({ year, week, employees, config, history, surgePlan, shiftRotations, weekReq }) {
  const wk = makeWeekKey(year, week);
  const useSurgePlan = !!config.useSurgePlan && !!surgePlan;
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

  const grid = {};
  const records = [];

  workingDays.forEach((iso, dayIndex) => {
    const wd = WEEKDAYS.find((d) => d.iso === iso);
    if (!wd) return;
    const dateInfo = weekDates.find((d) => d.iso === iso);
    const dayCell = { iso, date: dateInfo?.ymd || '', label: wd.label, labelTh: wd.labelTh };

    // Warehouse holiday → the whole day is closed, no assignments.
    const holiday = holidayOn(config.holidays, dayCell.date);
    if (holiday) {
      dayCell.closed = true;
      dayCell.holidayName = holiday.name || '';
      grid[wd.key] = dayCell;
      return;
    }

    // Resolve each person's shift for THIS DATE (rotation can change mid-week).
    const byShift = {
      [SHIFTS.MORNING]: eligibleAll.filter((e) => effectiveShiftOn(e, dayCell.date, shiftRotations) === SHIFTS.MORNING),
      [SHIFTS.AFTERNOON]: eligibleAll.filter((e) => effectiveShiftOn(e, dayCell.date, shiftRotations) === SHIFTS.AFTERNOON),
    };

    for (const shift of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = assignShiftDay({
        dayIndex,
        totalDays: workingDays.length,
        dayKey: wd.key,
        ymd: dayCell.date,
        iso,
        shift,
        eligible: byShift[shift],
        tasks: config.tasks,
        hist,
        genWorkload,
        genDuty,
        extraRules: config.extraRules,
        surgeCap: useSurgePlan ? (surgePlan?.[shift]?.[iso] ?? null) : null,
        weekReq,
        seed: `${wk}:${wd.key}`,
      });
      dayCell[shift] = res;

      // Flatten real duty assignments into history records.
      // Anonymous เสริม (EXTRA_ID) are placeholders — not tracked in history.
      for (const [dutyId, empIds] of Object.entries(res.assignments)) {
        for (const employeeId of empIds) {
          if (employeeId === EXTRA_ID) continue;
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
          if (empId === EXTRA_ID) continue; // anonymous เสริม aren't tracked per-person
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
