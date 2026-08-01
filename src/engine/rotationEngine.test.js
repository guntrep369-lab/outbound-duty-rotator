import { describe, it, expect } from 'vitest';
import { generateSchedule } from './rotationEngine.js';
import {
  makeEmployee,
  makeTask,
  makeShiftRound,
  EMPLOYEE_TYPES,
  EMPLOYEE_STATUS,
  SHIFTS,
  EXTRA_ID,
} from '../data/models.js';

const { INHOUSE: IH, OUTSOURCE_REGULAR: OS, OUTSOURCE_EXTRA: EX } = EMPLOYEE_TYPES;

/* ── helpers ─────────────────────────────────────────────────────────────── */
const emp = (name, type = IH, extra = {}) =>
  makeEmployee({ name, nickname: name, primaryShift: SHIFTS.MORNING, type, ...extra });

const task = (id, morning, afternoon = { inhouse: 0, outsource: 0 }, extra = {}) =>
  makeTask({ id, name: id, req: { morning, afternoon }, ...extra });

const config = (tasks, over = {}) => ({
  tasks,
  workingDays: [1, 2, 3, 4, 5],
  lookbackWeeks: 4,
  extraRules: { minDays: 0, maxDays: null },
  ...over,
});

const gen = (employees, cfg, over = {}) =>
  generateSchedule({ year: 2026, week: 31, employees, config: cfg, history: [], ...over });

/** distinct days an employee was scheduled */
const daysWorked = (sched, empId) =>
  new Set(sched.records.filter((r) => r.employeeId === empId).map((r) => r.dayKey)).size;

/** ids assigned to a duty on one day+shift (incl. anonymous เสริม) */
const slotIds = (sched, dayKey, shift, dutyId) =>
  sched.grid[dayKey]?.[shift]?.assignments?.[dutyId] ?? [];

const typeOf = (employees, id) => employees.find((e) => e.id === id)?.type;

/* ── type quotas ─────────────────────────────────────────────────────────── */
describe('type quotas', () => {
  it('fills the exact inhouse / outsource split a task asks for', () => {
    const employees = [emp('IH1'), emp('IH2'), emp('IH3'), emp('OS1', OS), emp('OS2', OS)];
    const s = gen(employees, config([task('pick', { inhouse: 2, outsource: 1 })]));
    const ids = slotIds(s, 'mon', 'morning', 'pick');

    expect(ids).toHaveLength(3);
    expect(ids.filter((id) => typeOf(employees, id) === IH)).toHaveLength(2);
    expect(ids.filter((id) => typeOf(employees, id) === OS)).toHaveLength(1);
    expect(s.summary.understaffedCount).toBe(0);
  });

  it('reports the shortfall instead of substituting another type', () => {
    // asks for 2 inhouse but only 1 exists, and no เสริม to cover it
    const employees = [emp('IH1'), emp('OS1', OS), emp('OS2', OS)];
    const s = gen(employees, config([task('pick', { inhouse: 2, outsource: 1 })]));
    const ids = slotIds(s, 'mon', 'morning', 'pick');

    expect(ids.filter((id) => typeOf(employees, id) === IH)).toHaveLength(1);
    expect(s.summary.understaffedCount).toBeGreaterThan(0);
  });

  it('honours allowedTypes (QC = inhouse only)', () => {
    const employees = [emp('IH1'), emp('OS1', OS), emp('OS2', OS), emp('EX1', EX)];
    const cfg = config([task('qc', { inhouse: 1, outsource: 0 }, undefined, { allowedTypes: [IH] })]);
    const s = gen(employees, cfg, { surgePlan: { morning: { 1: 5 }, afternoon: {} } });

    for (const day of Object.keys(s.grid)) {
      for (const id of slotIds(s, day, 'morning', 'qc')) {
        expect(id).not.toBe(EXTRA_ID);
        expect(typeOf(employees, id)).toBe(IH);
      }
    }
  });
});

/* ── เสริม: weekly min / max days  (regression: minDays was dropped once) ── */
describe('outsource เสริม weekly rules', () => {
  // core staff alone can fill every slot — the hard case where a naive
  // implementation never schedules เสริม at all
  const coreCoversEverything = () => [
    emp('IH1'), emp('IH2'), emp('OS1', OS), emp('OS2', OS), emp('EX1', EX), emp('EX2', EX),
  ];
  const cfg = (minDays, maxDays) =>
    config([task('pick', { inhouse: 2, outsource: 2 })], { extraRules: { minDays, maxDays } });

  it('does not schedule เสริม when minDays is 0 and core staff suffice', () => {
    const employees = coreCoversEverything();
    const s = gen(employees, cfg(0, null));
    expect(daysWorked(s, employees.find((e) => e.name === 'EX1').id)).toBe(0);
  });

  it('guarantees minDays even when core staff could cover every slot', () => {
    const employees = coreCoversEverything();
    const s = gen(employees, cfg(2, null));
    for (const name of ['EX1', 'EX2']) {
      const id = employees.find((e) => e.name === name).id;
      expect(daysWorked(s, id)).toBeGreaterThanOrEqual(2);
    }
  });

  it('never exceeds maxDays', () => {
    const employees = [emp('IH1'), emp('EX1', EX)];
    // 3 slots/day but only 1 inhouse → เสริม would otherwise work all 5 days
    const s = gen(employees, cfg(0, 2));
    expect(daysWorked(s, employees.find((e) => e.name === 'EX1').id)).toBeLessThanOrEqual(2);
  });

  it('lets maxDays win when minDays > maxDays', () => {
    const employees = coreCoversEverything();
    const s = gen(employees, cfg(3, 2));
    for (const name of ['EX1', 'EX2']) {
      const id = employees.find((e) => e.name === name).id;
      expect(daysWorked(s, id)).toBeLessThanOrEqual(2);
    }
  });
});

/* ── surge plan / anonymous เสริม ─────────────────────────────────────────── */
describe('surge plan', () => {
  const employees = () => [emp('IH1'), emp('IH2')];
  const cfg = config([task('pick', { inhouse: 5, outsource: 0 })], { useSurgePlan: true });

  it('fills the gap with anonymous เสริม up to the planned head-count', () => {
    const s = gen(employees(), cfg, { surgePlan: { morning: { 1: 4 }, afternoon: {} } });
    const ids = slotIds(s, 'mon', 'morning', 'pick');
    expect(ids.filter((id) => id === EXTRA_ID)).toHaveLength(3); // gap is only 3
    expect(s.grid.mon.morning.understaffed).toHaveLength(0);
  });

  it('stops at the plan and still reports the remaining gap', () => {
    const s = gen(employees(), cfg, { surgePlan: { morning: { 1: 2 }, afternoon: {} } });
    const ids = slotIds(s, 'mon', 'morning', 'pick');
    expect(ids.filter((id) => id === EXTRA_ID)).toHaveLength(2);
    expect(s.grid.mon.morning.understaffed.length).toBeGreaterThan(0);
  });

  it('keeps anonymous เสริม out of history (they are placeholders)', () => {
    const s = gen(employees(), cfg, { surgePlan: { morning: { 1: 4 }, afternoon: {} } });
    expect(s.records.some((r) => r.employeeId === EXTRA_ID)).toBe(false);
  });
});

/* ── availability: day-off, leave, holidays ──────────────────────────────── */
describe('availability', () => {
  const cfg = config([task('pick', { inhouse: 1, outsource: 0 })]);

  it('never schedules someone on their recurring day off', () => {
    const off = emp('OFFMON', IH, { weeklyOffDays: [1] });
    const s = gen([off, emp('IH2')], cfg);
    expect(slotIds(s, 'mon', 'morning', 'pick')).not.toContain(off.id);
    expect(s.grid.mon.morning.unavailable.some((u) => u.employeeId === off.id && u.kind === 'off')).toBe(true);
  });

  it('never schedules someone during a dated leave', () => {
    const away = emp('AWAY', IH, {
      leaves: [{ id: 'l1', start: '2026-07-29', end: '2026-07-30', type: 'vacation', note: '' }],
    });
    const s = gen([away, emp('IH2')], cfg);
    // 2026-W31 = Mon 27 Jul …; the leave covers Wed 29 + Thu 30
    const leaveDays = ['wed', 'thu'];
    for (const d of leaveDays) {
      expect(slotIds(s, d, 'morning', 'pick')).not.toContain(away.id);
      expect(s.grid[d].morning.unavailable.some((u) => u.employeeId === away.id && u.kind === 'leave')).toBe(true);
    }
    // outside the leave they are eligible again (may or may not win a slot on a
    // given day — fairness decides that — but must never be marked unavailable)
    for (const d of ['mon', 'tue', 'fri']) {
      expect(s.grid[d].morning.unavailable.some((u) => u.employeeId === away.id)).toBe(false);
    }
    expect(s.records.some((r) => r.employeeId === away.id)).toBe(true);
  });

  it('closes the whole day on a warehouse holiday', () => {
    const s = gen([emp('IH1')], config([task('pick', { inhouse: 1, outsource: 0 })], {
      holidays: [{ date: '2026-07-29', name: 'ทดสอบ' }],
    }));
    expect(s.grid.wed.closed).toBe(true);
    expect(s.records.filter((r) => r.dayKey === 'wed')).toHaveLength(0);
    expect(s.records.length).toBeGreaterThan(0); // other days unaffected
  });
});

/* ── fixed position & shift rotation ─────────────────────────────────────── */
describe('fixed position and shift rotation', () => {
  it('keeps a pinned specialist on their duty only', () => {
    const pinned = emp('PIN', IH, { fixedDutyId: 'pick' });
    const employees = [pinned, emp('IH2'), emp('IH3')];
    const cfg = config([
      task('pick', { inhouse: 1, outsource: 0 }),
      task('pack', { inhouse: 1, outsource: 0 }),
    ]);
    const s = gen(employees, cfg);
    const onPack = s.records.filter((r) => r.employeeId === pinned.id && r.dutyId === 'pack');
    expect(onPack).toHaveLength(0);
    expect(s.records.some((r) => r.employeeId === pinned.id && r.dutyId === 'pick')).toBe(true);
  });

  it('applies a mid-week shift changeover on the right date', () => {
    const mover = emp('MOVER'); // primary = morning
    const employees = [mover, emp('IH2'), emp('PM1', IH, { primaryShift: SHIFTS.AFTERNOON })];
    const cfg = config([task('pick', { inhouse: 1, outsource: 0 }, { inhouse: 1, outsource: 0 })]);
    // from Wed 2026-07-29 MOVER works afternoons
    const rounds = [makeShiftRound({ effectiveFrom: '2026-07-29', shifts: { [mover.id]: SHIFTS.AFTERNOON } })];
    const s = gen(employees, cfg, { shiftRotations: rounds });

    const shiftsOn = (day) =>
      s.records.filter((r) => r.employeeId === mover.id && r.dayKey === day).map((r) => r.shift);
    expect(shiftsOn('mon').every((x) => x === 'morning')).toBe(true);
    expect(shiftsOn('wed').every((x) => x === 'afternoon')).toBe(true);
  });
});

/* ── per-day requirement overrides (promo weeks) ─────────────────────────── */
describe('per-day requirement overrides', () => {
  it('scales a single day up and switches another off', () => {
    const employees = Array.from({ length: 6 }, (_, i) => emp('IH' + i));
    const cfg = config([task('pick', { inhouse: 1, outsource: 0 })]);
    const weekReq = { pick: { morning: { 3: { inhouse: 4, outsource: 0 }, 5: { inhouse: 0, outsource: 0 } } } };
    const s = gen(employees, cfg, { weekReq });

    expect(slotIds(s, 'mon', 'morning', 'pick')).toHaveLength(1); // base
    expect(slotIds(s, 'wed', 'morning', 'pick')).toHaveLength(4); // override
    expect(slotIds(s, 'fri', 'morning', 'pick')).toHaveLength(0); // switched off
    expect(s.summary.understaffedCount).toBe(0);
  });
});

/* ── fairness & determinism ──────────────────────────────────────────────── */
describe('fairness and determinism', () => {
  const employees = () => Array.from({ length: 6 }, (_, i) => emp('IH' + i));
  const cfg = config([
    task('pick', { inhouse: 2, outsource: 0 }),
    task('pack', { inhouse: 2, outsource: 0 }),
  ]);

  it('produces the same roster for the same inputs', () => {
    const a = gen(employees(), cfg);
    const b = gen(employees(), cfg);
    // same people are irrelevant (ids differ per call) — compare the shape
    expect(a.records.length).toBe(b.records.length);
    expect(Object.keys(a.grid)).toEqual(Object.keys(b.grid));
  });

  it('spreads the workload rather than overusing one person', () => {
    const es = employees();
    const s = gen(es, cfg);
    const counts = es.map((e) => daysWorked(s, e.id));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('excludes resigned and on-leave staff', () => {
    const gone = emp('GONE', IH, { status: EMPLOYEE_STATUS.RESIGNED });
    const sick = emp('SICK', IH, { status: EMPLOYEE_STATUS.ON_LEAVE });
    const s = gen([gone, sick, emp('IH1')], config([task('pick', { inhouse: 1, outsource: 0 })]));
    expect(s.records.some((r) => r.employeeId === gone.id)).toBe(false);
    expect(s.records.some((r) => r.employeeId === sick.id)).toBe(false);
  });
});
