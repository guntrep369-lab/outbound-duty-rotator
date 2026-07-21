import React, { useMemo, useState } from 'react';
import { Users2, ChevronDown, ChevronRight, Info, Copy, Eraser } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import {
  SHIFT_LIST,
  WEEKDAYS,
  EMPLOYEE_STATUS,
  EMPLOYEE_TYPES,
  isAvailableOn,
} from '../../data/models.js';
import { datesOfISOWeek, weekKey as makeWeekKey, previousWeekKeys } from '../../utils/dateUtils.js';

/**
 * Weekly "Surge Plan" grid (แผนกำลังเสริม): shows, per day and shift, the
 * auto-computed inhouse / outsource-ประจำ availability and an editable planned
 * เสริม head-count. Optionally caps how many เสริม the generator schedules.
 */
export function SurgePlanPanel({ year, week, schedule }) {
  const { employees, config, plans, getEmployee, setSurgePlanCount, setUseSurgePlan, setSurgePlanWeek } = useApp();
  const [open, setOpen] = useState(true);

  const wk = makeWeekKey(year, week);
  const days = useMemo(() => datesOfISOWeek(year, week), [year, week]);
  const weekPlan = plans[wk] || {};
  const workingSet = new Set(config.workingDays || []);

  // Previous week's plan (for the "copy" button).
  const prevWk = previousWeekKeys(year, week, 1)[0];
  const hasPrev = !!plans[prevWk] && Object.keys(plans[prevWk]).length > 0;
  const hasThis = Object.keys(weekPlan).length > 0;

  // Actual เสริม scheduled per shift/day (only when the generated roster is this week).
  const actualFor = (shiftId, iso) => {
    if (!schedule || schedule.weekKey !== wk) return null;
    const dayKey = WEEKDAYS.find((w) => w.iso === iso)?.key;
    const res = schedule.grid?.[dayKey]?.[shiftId];
    if (!res) return null;
    const ids = Object.values(res.assignments || {}).flat();
    return ids.filter((id) => getEmployee(id)?.type === EMPLOYEE_TYPES.OUTSOURCE_EXTRA).length;
  };
  const showActual = !!schedule && schedule.weekKey === wk;

  // Count active employees of a type on a shift who are available on a given day.
  const countAvail = (type, shiftId, ymd, iso) =>
    employees.filter(
      (e) =>
        e.status === EMPLOYEE_STATUS.ACTIVE &&
        e.type === type &&
        e.primaryShift === shiftId &&
        isAvailableOn(e, ymd, iso)
    ).length;

  const planVal = (shiftId, iso) => weekPlan?.[shiftId]?.[iso] ?? 0;

  const copyPrev = () => {
    if (hasThis && !window.confirm(`เขียนทับแผนของ ${wk} ด้วยแผนจาก ${prevWk}?`)) return;
    setSurgePlanWeek(wk, plans[prevWk]);
  };
  const clearWeek = () => {
    if (window.confirm(`ล้างแผนเสริมของ ${wk}?`)) setSurgePlanWeek(wk, null);
  };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-slate-700">
          <Users2 className="h-5 w-5 text-indigo-600" />
          แผนกำลังเสริม · Surge Plan
          <span className="text-xs font-normal text-slate-400">{wk}</span>
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-3">
          {/* Toggle */}
          <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={!!config.useSurgePlan}
              onChange={(e) => setUseSurgePlan(e.target.checked)}
            />
            <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600">
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
            </span>
            <span className="text-sm text-slate-700">
              ใช้แผนนี้คุมจำนวนเสริมตอน generate
              <span className="ml-1 text-xs text-slate-400">(เปิด = จัดเสริมไม่เกินจำนวนที่วางไว้ต่อวัน)</span>
            </span>
          </label>

          {/* Copy / clear */}
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn-secondary !py-1.5 text-xs" onClick={copyPrev} disabled={!hasPrev} title={hasPrev ? '' : `ไม่มีแผนของ ${prevWk}`}>
              <Copy className="h-3.5 w-3.5" /> คัดลอกจากสัปดาห์ก่อน ({prevWk})
            </button>
            <button className="btn-ghost !py-1.5 text-xs text-rose-500" onClick={clearWeek} disabled={!hasThis}>
              <Eraser className="h-3.5 w-3.5" /> ล้างแผนสัปดาห์นี้
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-24 border border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-semibold text-slate-500">
                    กะ / วัน
                  </th>
                  {days.map((d) => {
                    const wd = WEEKDAYS.find((w) => w.iso === d.iso);
                    const working = workingSet.has(d.iso);
                    return (
                      <th
                        key={d.iso}
                        className={`border border-slate-200 px-1.5 py-2 text-center text-xs font-semibold ${
                          working ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'
                        }`}
                      >
                        <div>{wd?.labelTh}</div>
                        <div className="font-normal text-slate-400">{d.ymd.slice(8)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {SHIFT_LIST.map((shift) => (
                  <React.Fragment key={shift.id}>
                    <tr>
                      <td
                        colSpan={days.length + 1}
                        className={`border border-slate-200 px-2 py-1 text-xs font-bold ${shift.barBg} ${shift.text}`}
                      >
                        {shift.label} · {shift.labelTh}
                      </td>
                    </tr>
                    {/* IH available */}
                    <tr>
                      <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-sky-700">
                        IH
                      </th>
                      {days.map((d) => (
                        <td key={d.iso} className="border border-slate-100 px-1 py-1 text-center text-slate-600">
                          {countAvail(EMPLOYEE_TYPES.INHOUSE, shift.id, d.ymd, d.iso)}
                        </td>
                      ))}
                    </tr>
                    {/* OS ประจำ available */}
                    <tr>
                      <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-violet-700">
                        OS
                      </th>
                      {days.map((d) => (
                        <td key={d.iso} className="border border-slate-100 px-1 py-1 text-center text-slate-600">
                          {countAvail(EMPLOYEE_TYPES.OUTSOURCE_REGULAR, shift.id, d.ymd, d.iso)}
                        </td>
                      ))}
                    </tr>
                    {/* เสริม planned (editable) */}
                    <tr>
                      <th className="sticky left-0 z-10 border border-sky-200 bg-sky-50 px-2 py-1.5 text-left text-xs font-semibold text-sky-700">
                        เสริม
                      </th>
                      {days.map((d) => {
                        const avail = countAvail(EMPLOYEE_TYPES.OUTSOURCE_EXTRA, shift.id, d.ymd, d.iso);
                        const val = planVal(shift.id, d.iso);
                        return (
                          <td key={d.iso} className="border border-sky-100 bg-sky-50/60 p-0.5 text-center">
                            <input
                              type="number"
                              min="0"
                              value={val}
                              onChange={(e) => setSurgePlanCount(wk, shift.id, d.iso, e.target.value)}
                              className="w-12 rounded border border-sky-200 bg-white px-1 py-0.5 text-center text-sm font-semibold text-sky-700 focus:border-sky-500 focus:outline-none"
                              title={`มีเสริมจริง ${avail} คนในวันนี้`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/* Actual เสริม scheduled (only after generating this week) */}
                    {showActual && (
                      <tr>
                        <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-slate-500">
                          จริง
                        </th>
                        {days.map((d) => {
                          const plan = planVal(shift.id, d.iso);
                          const act = actualFor(shift.id, d.iso);
                          const working = workingSet.has(d.iso);
                          if (!working || act == null) {
                            return (
                              <td key={d.iso} className="border border-slate-100 px-1 py-1 text-center text-slate-300">
                                —
                              </td>
                            );
                          }
                          const cls =
                            act === plan
                              ? 'bg-emerald-50 text-emerald-700'
                              : act < plan
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700';
                          const diff = act - plan;
                          return (
                            <td
                              key={d.iso}
                              className={`border border-slate-100 px-1 py-1 text-center text-xs font-semibold ${cls}`}
                              title={`วางแผน ${plan} · จัดจริง ${act}${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ' (ตรงแผน)'}`}
                            >
                              {act}
                              {diff !== 0 && <span className="ml-0.5 opacity-70">({diff > 0 ? '+' : ''}{diff})</span>}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                    {/* Total planned manpower */}
                    <tr>
                      <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1.5 text-left text-xs font-semibold text-slate-500">
                        รวม
                      </th>
                      {days.map((d) => {
                        const total =
                          countAvail(EMPLOYEE_TYPES.INHOUSE, shift.id, d.ymd, d.iso) +
                          countAvail(EMPLOYEE_TYPES.OUTSOURCE_REGULAR, shift.id, d.ymd, d.iso) +
                          planVal(shift.id, d.iso);
                        return (
                          <td key={d.iso} className="border border-slate-100 bg-slate-50 px-1 py-1 text-center font-bold text-slate-700">
                            {total}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            IH/OS คำนวณอัตโนมัติจากพนักงานที่พร้อมทำงานในแต่ละวัน (หักวันหยุด/ลาแล้ว). ช่อง “เสริม” คือจำนวนที่วางแผนไว้
            (กรอกเอง). แถว “จริง” จะขึ้นหลังกด Generate — เขียว = ตรงแผน, เหลือง = น้อยกว่าแผน, แดง = เกินแผน.
            วันที่เป็นสีจาง = ไม่ใช่วันทำงาน (การ generate จะข้าม — เปิดวันทำงานได้ที่ Settings → Duties).
          </p>
        </div>
      )}
    </div>
  );
}
