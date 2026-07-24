import React, { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import {
  SHIFT_LIST,
  EMPLOYEE_STATUS,
  EMPLOYEE_TYPES,
  isSwapEligible,
  effectiveShiftOn,
  getShift,
  getType,
} from '../../data/models.js';
import { currentWeek, isoWeekMonday, getISOWeek, datesOfISOWeek, weekKey } from '../../utils/dateUtils.js';

/**
 * Read-only preview of the shift schedule over the coming weeks, based on the
 * saved rotation rounds. Weeks where a person changes shift mid-week are shown
 * as a transition (เช้า→บ่าย).
 */
export function ShiftPreview() {
  const { employees, config, shiftRotations } = useApp();
  const [numWeeks, setNumWeeks] = useState(8);

  const start = currentWeek();
  const workingSet = new Set(config.workingDays || []);

  const people = useMemo(
    () =>
      employees
        .filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE && isSwapEligible(e))
        .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th')),
    [employees]
  );

  const weeks = useMemo(() => {
    const mon0 = isoWeekMonday(start.year, start.week);
    return Array.from({ length: numWeeks }, (_, i) => {
      const mon = new Date(mon0);
      mon.setUTCDate(mon0.getUTCDate() + i * 7);
      const w = getISOWeek(mon);
      const dates = datesOfISOWeek(w.year, w.week);
      const workingYmds = dates.filter((d) => workingSet.has(d.iso)).map((d) => d.ymd);
      return { ...w, key: weekKey(w.year, w.week), monLabel: dates[0].ymd.slice(5), workingYmds };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.year, start.week, numWeeks, config.workingDays]);

  if (people.length === 0) return null;

  const cellFor = (emp, week) => {
    const ymds = week.workingYmds.length ? week.workingYmds : [`${week.key}`];
    const shifts = ymds.map((ymd) => effectiveShiftOn(emp, ymd, shiftRotations));
    const distinct = [...new Set(shifts)];
    if (distinct.length <= 1) return { type: 'single', shift: distinct[0] || emp.primaryShift };
    return { type: 'transition', from: shifts[0], to: shifts[shifts.length - 1] };
  };

  // Group members by home shift (กะหลัก) then employment type.
  const GROUP_TYPES = [EMPLOYEE_TYPES.INHOUSE, EMPLOYEE_TYPES.OUTSOURCE_REGULAR];
  const groups = [];
  for (const s of SHIFT_LIST) {
    for (const t of GROUP_TYPES) {
      const members = people.filter((e) => e.primaryShift === s.id && (e.type || 'inhouse') === t);
      if (members.length) groups.push({ shift: s, type: getType(t), members });
    }
  }

  const renderMemberRow = (emp) => (
    <tr key={emp.id}>
      <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1 pl-4 text-left font-medium text-slate-700">
        {emp.nickname || emp.name}
      </th>
      {weeks.map((w) => {
        const c = cellFor(emp, w);
        if (c.type === 'single') {
          const s = getShift(c.shift);
          return (
            <td key={w.key} className={`border border-slate-100 px-1 py-1 text-center font-semibold ${s.badge}`}>
              {s.labelTh}
            </td>
          );
        }
        const from = getShift(c.from);
        const to = getShift(c.to);
        return (
          <td
            key={w.key}
            className="border border-slate-100 bg-white px-1 py-1 text-center"
            title={`สลับกลางสัปดาห์: ${from.labelTh} → ${to.labelTh}`}
          >
            <span className={`rounded px-1 ${from.badge}`}>{from.labelTh}</span>
            <span className="mx-0.5 text-slate-400">→</span>
            <span className={`rounded px-1 ${to.badge}`}>{to.labelTh}</span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-700">
          <CalendarRange className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold">พรีวิวตารางกะล่วงหน้า · Shift preview</h3>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
          {[4, 8, 12].map((n) => (
            <button
              key={n}
              onClick={() => setNumWeeks(n)}
              className={`rounded-md px-2.5 py-1 font-medium ${numWeeks === n ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
            >
              {n} สัปดาห์
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-2 py-1.5 text-left font-semibold text-slate-500">
                พนักงาน
              </th>
              {weeks.map((w) => (
                <th key={w.key} className="border border-slate-200 bg-slate-100 px-1.5 py-1.5 text-center font-semibold text-slate-600">
                  <div>W{String(w.week).padStart(2, '0')}</div>
                  <div className="font-normal text-slate-400">{w.monLabel}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={`${g.shift.id}-${g.type.id}`}>
                <tr>
                  <td
                    colSpan={weeks.length + 1}
                    className={`sticky left-0 border border-slate-200 px-2 py-1 text-left text-[11px] font-bold ${g.shift.barBg} ${g.shift.text}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${g.shift.dot}`} />
                      กะหลัก {g.shift.labelTh} · {g.type.label} ({g.members.length})
                    </span>
                  </td>
                </tr>
                {g.members.map((emp) => renderMemberRow(emp))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        {SHIFT_LIST.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.labelTh}
          </span>
        ))}
        <span>· “เช้า→บ่าย” = สลับกลางสัปดาห์นั้น · เริ่มจากสัปดาห์ปัจจุบัน</span>
      </div>
    </div>
  );
}
