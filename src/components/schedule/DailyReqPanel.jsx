import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronRight, Copy, Eraser, Info } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import { SHIFT_LIST, WEEKDAYS, resolveTaskReq, hasReqOverride, taskNeed } from '../../data/models.js';
import { datesOfISOWeek, weekKey as makeWeekKey, previousWeekKeys } from '../../utils/dateUtils.js';
import { TaskDot } from '../ui/Badge.jsx';

/**
 * Per-week, per-day head-count editor (ปรับจำนวนคนรายวัน). Each task/shift/day
 * can override the base requirement — for promo weeks (7.7, 8.8) where the
 * workload differs day by day. Blank/equal-to-base cells fall back to the base.
 */
export function DailyReqPanel({ year, week }) {
  const { config, reqOverrides, setReqOverride, setReqOverrideWeek } = useApp();
  const [open, setOpen] = useState(false);

  const wk = makeWeekKey(year, week);
  const prevWk = previousWeekKeys(year, week, 1)[0];
  const weekReq = reqOverrides[wk];
  const days = useMemo(() => datesOfISOWeek(year, week), [year, week]);
  const workingSet = new Set(config.workingDays || []);

  const hasThis = !!weekReq && Object.keys(weekReq).length > 0;
  const hasPrev = !!reqOverrides[prevWk] && Object.keys(reqOverrides[prevWk]).length > 0;
  const overrideCount = useMemo(() => {
    let n = 0;
    for (const t of Object.values(weekReq || {}))
      for (const byShift of Object.values(t || {})) n += Object.keys(byShift || {}).length;
    return n;
  }, [weekReq]);

  const copyPrev = () => {
    if (hasThis && !window.confirm(`เขียนทับค่าปรับของ ${wk} ด้วยของ ${prevWk}?`)) return;
    setReqOverrideWeek(wk, reqOverrides[prevWk]);
  };
  const clearWeek = () => {
    if (window.confirm(`ล้างค่าปรับรายวันของ ${wk} ทั้งหมด? (กลับไปใช้ค่าพื้นฐาน)`)) setReqOverrideWeek(wk, null);
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 font-semibold text-slate-700">
          <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
          ปรับจำนวนคนรายวัน · Daily head-count
          <span className="text-xs font-normal text-slate-400">{wk}</span>
          {overrideCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              ปรับแล้ว {overrideCount} ช่อง
            </span>
          )}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn-secondary !py-1.5 text-xs" onClick={copyPrev} disabled={!hasPrev} title={hasPrev ? '' : `ไม่มีค่าปรับของ ${prevWk}`}>
              <Copy className="h-3.5 w-3.5" /> คัดลอกจากสัปดาห์ก่อน ({prevWk})
            </button>
            <button className="btn-ghost !py-1.5 text-xs text-rose-500" onClick={clearWeek} disabled={!hasThis}>
              <Eraser className="h-3.5 w-3.5" /> ล้างค่าปรับสัปดาห์นี้
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-36 border border-slate-200 bg-slate-100 px-2 py-1.5 text-left font-semibold text-slate-500">
                    งาน (IH/OS)
                  </th>
                  {days.map((d) => {
                    const wd = WEEKDAYS.find((w) => w.iso === d.iso);
                    const working = workingSet.has(d.iso);
                    return (
                      <th
                        key={d.iso}
                        className={`border border-slate-200 px-1 py-1.5 text-center font-semibold ${
                          working ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-300'
                        }`}
                      >
                        <div>{wd?.labelTh}</div>
                        <div className="font-normal opacity-70">{d.ymd.slice(8)}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {SHIFT_LIST.map((shift) => {
                  const tasks = config.tasks.filter((t) => t.active);
                  return (
                    <React.Fragment key={shift.id}>
                      <tr>
                        <td
                          colSpan={days.length + 1}
                          className={`border border-slate-200 px-2 py-1 text-[11px] font-bold ${shift.barBg} ${shift.text}`}
                        >
                          {shift.label} · {shift.labelTh}
                        </td>
                      </tr>
                      {tasks.map((task) => (
                        <tr key={task.id}>
                          <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-1 text-left">
                            <div className="flex items-center gap-1.5">
                              <TaskDot color={task.color} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-slate-700">{task.name}</span>
                                <span className="block text-[10px] text-slate-400">พื้นฐาน {taskNeed(task, shift.id)} คน</span>
                              </span>
                            </div>
                          </th>
                          {days.map((d) => {
                            const r = resolveTaskReq(task, shift.id, d.iso, weekReq);
                            const isOv = hasReqOverride(task.id, shift.id, d.iso, weekReq);
                            const working = workingSet.has(d.iso);
                            return (
                              <td
                                key={d.iso}
                                className={`border p-0.5 text-center ${
                                  isOv ? 'border-indigo-300 bg-indigo-50' : working ? 'border-slate-100' : 'border-slate-100 bg-slate-50'
                                }`}
                                title={isOv ? 'ปรับเฉพาะวันนี้ (ต่างจากค่าพื้นฐาน)' : 'ใช้ค่าพื้นฐาน'}
                              >
                                <div className="flex items-center justify-center gap-0.5">
                                  <input
                                    type="number"
                                    min="0"
                                    value={r.inhouse}
                                    onChange={(e) => setReqOverride(wk, task.id, shift.id, d.iso, { inhouse: e.target.value })}
                                    className="w-8 rounded border border-sky-200 bg-white px-0.5 py-0.5 text-center text-[11px] font-semibold text-sky-700 focus:border-sky-500 focus:outline-none"
                                    title="inhouse"
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    value={r.outsource}
                                    onChange={(e) => setReqOverride(wk, task.id, shift.id, d.iso, { outsource: e.target.value })}
                                    className="w-8 rounded border border-violet-200 bg-white px-0.5 py-0.5 text-center text-[11px] font-semibold text-violet-700 focus:border-violet-500 focus:outline-none"
                                    title="outsource ประจำ"
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            แต่ละช่อง = <span className="font-medium text-sky-700">inhouse</span> /{' '}
            <span className="font-medium text-violet-700">outsource ประจำ</span> ของ<b>วันนั้น</b>. ช่องพื้นสีคราม = ปรับไว้เฉพาะสัปดาห์นี้
            (ค่าอื่นใช้ค่าพื้นฐานจาก Settings → Duties). เหมาะกับสัปดาห์โปร เช่น 7.7 / 8.8 — ตั้งเสร็จแล้วกด Generate ใหม่
          </p>
        </div>
      )}
    </div>
  );
}
