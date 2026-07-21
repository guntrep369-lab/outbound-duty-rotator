import React, { useMemo, useState } from 'react';
import { Repeat, ChevronLeft, ChevronRight, ArrowLeftRight, Copy, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import {
  SHIFTS,
  SHIFT_LIST,
  EMPLOYEE_STATUS,
  isSwapEligible,
  effectiveShift,
  getShift,
} from '../../data/models.js';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m) => `${y}-${pad(m + 1)}`;

/**
 * Monthly shift rotation (สลับกะ): the supervisor sets which shift each
 * swap-eligible employee (inhouse + outsource ประจำ) works in a given month.
 * เสริม never swap.
 */
export function ShiftRotation() {
  const { employees, shiftPlans, setShiftPlanFor, setShiftPlanMonth } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const monthKey = keyOf(ym.y, ym.m);
  const prevKey = keyOf(ym.m === 0 ? ym.y - 1 : ym.y, ym.m === 0 ? 11 : ym.m - 1);
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  const shiftMonth = (delta) =>
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  // Swap-eligible, active employees, sorted by name.
  const people = useMemo(
    () =>
      employees
        .filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE && isSwapEligible(e))
        .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th')),
    [employees]
  );

  const shiftOf = (emp) => effectiveShift(emp, monthKey, shiftPlans);
  const counts = SHIFT_LIST.map((s) => ({
    ...s,
    n: people.filter((e) => shiftOf(e) === s.id).length,
  }));
  const hasPrev = !!shiftPlans[prevKey] && Object.keys(shiftPlans[prevKey]).length > 0;
  const hasThis = !!shiftPlans[monthKey] && Object.keys(shiftPlans[monthKey]).length > 0;

  const swapAll = () => {
    const map = {};
    for (const e of people) {
      map[e.id] = shiftOf(e) === SHIFTS.MORNING ? SHIFTS.AFTERNOON : SHIFTS.MORNING;
    }
    setShiftPlanMonth(monthKey, map);
  };
  const copyPrev = () => {
    if (hasThis && !window.confirm(`เขียนทับแผนกะเดือน ${monthKey} ด้วยของ ${prevKey}?`)) return;
    setShiftPlanMonth(monthKey, shiftPlans[prevKey]);
  };
  const reset = () => {
    if (window.confirm(`รีเซ็ตกลับใช้กะหลัก (primary) ทั้งหมดสำหรับ ${monthKey}?`)) setShiftPlanMonth(monthKey, null);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <Repeat className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">สลับกะรายเดือน · Shift Rotation</h2>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary !px-2" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อน">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[9rem] text-center text-base font-semibold text-slate-800">{monthLabel}</span>
          <button className="btn-secondary !px-2" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Shift counts */}
      <div className="grid grid-cols-2 gap-2">
        {counts.map((s) => (
          <div key={s.id} className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 ${s.barBorder} ${s.barBg}`}>
            <span className={`flex items-center gap-2 text-sm font-semibold ${s.text}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
              {s.label} · {s.labelTh}
            </span>
            <span className={`text-lg font-bold ${s.text}`}>{s.n}</span>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={swapAll} disabled={people.length === 0}>
          <ArrowLeftRight className="h-4 w-4" /> สลับทั้งหมด (เช้า ↔ บ่าย)
        </button>
        <button className="btn-secondary" onClick={copyPrev} disabled={!hasPrev} title={hasPrev ? '' : `ไม่มีแผนของ ${prevKey}`}>
          <Copy className="h-4 w-4" /> คัดลอกจากเดือนก่อน ({prevKey})
        </button>
        <button className="btn-ghost text-slate-500" onClick={reset} disabled={!hasThis}>
          <RotateCcw className="h-4 w-4" /> รีเซ็ต (ใช้กะหลัก)
        </button>
      </div>

      <p className="text-xs text-slate-400">
        เฉพาะ inhouse และ outsource ประจำ เท่านั้นที่สลับกะได้ (outsource เสริม ใช้กะหลักเสมอ). แผนนี้จะถูกใช้ตอน generate
        ตารางของสัปดาห์ที่อยู่ในเดือนนั้น.
      </p>

      {/* Per-person */}
      {people.length === 0 ? (
        <div className="card py-10 text-center text-sm text-slate-400">ยังไม่มีพนักงาน inhouse / outsource ประจำ ที่ active</div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {people.map((emp) => {
            const cur = shiftOf(emp);
            const swapped = cur !== emp.primaryShift;
            return (
              <li key={emp.id} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">{emp.nickname || emp.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {emp.name} · กะหลัก {getShift(emp.primaryShift).labelTh}
                    {swapped && <span className="ml-1 font-medium text-indigo-600">(สลับ)</span>}
                  </p>
                </div>
                <div className="flex overflow-hidden rounded-lg border border-slate-200">
                  {SHIFT_LIST.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setShiftPlanFor(monthKey, emp.id, s.id)}
                      className={`px-3 py-1.5 text-xs font-semibold transition ${
                        cur === s.id ? `${s.dot} text-white` : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {s.labelTh}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
