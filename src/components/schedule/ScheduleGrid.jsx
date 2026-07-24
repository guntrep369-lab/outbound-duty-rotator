import React, { useMemo } from 'react';
import { Plus, Pin } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import { SHIFT_LIST, WEEKDAYS, getLeaveType, isExtraId } from '../../data/models.js';
import { datesOfISOWeek } from '../../utils/dateUtils.js';
import { TaskDot } from '../ui/Badge.jsx';

/** Chip for an anonymous surge worker (เสริมนิรนาม). */
function ExtraChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-pink-300 bg-pink-50 px-1.5 py-0.5 text-xs font-medium text-pink-600">
      <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
      เสริม
    </span>
  );
}

/** Chip for one assigned employee. Clickable in edit mode to swap. */
function EmpChip({ empId, color, editable, onClick }) {
  const { getEmployee } = useApp();
  if (isExtraId(empId)) return <ExtraChip />;
  const emp = getEmployee(empId);
  const label = emp ? emp.nickname || emp.name : '—';
  const pinned = !!emp?.fixedDutyId;
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={onClick}
      title={emp ? `${emp.name}${pinned ? ' · ตำแหน่งประจำ (fixed)' : ''}` : 'Unknown'}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${
        editable ? 'cursor-pointer hover:ring-2 hover:ring-indigo-300' : 'cursor-default'
      }`}
      style={{ borderColor: (color || '#94a3b8') + '55', backgroundColor: (color || '#94a3b8') + '14' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color || '#94a3b8' }} />
      <span className="truncate">{label}</span>
      {pinned && <Pin className="h-2.5 w-2.5 shrink-0 opacity-60" />}
    </button>
  );
}

function todayYmd() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/**
 * Weekly roster as a Days × Tasks matrix (grouped by shift). Shows the FULL
 * week (Mon–Sun); non-working days are greyed. Holidays show 🔒 ปิด.
 */
export function ScheduleGrid({ schedule, editable = false, onSlotClick, onAddClick }) {
  const { config, getTask, getEmployee } = useApp();

  // Build all 7 days of the ISO week; attach the grid cell for working days.
  const days = useMemo(() => {
    const today = todayYmd();
    const dates =
      schedule.year && schedule.week
        ? datesOfISOWeek(schedule.year, schedule.week)
        : WEEKDAYS.filter((d) => schedule.grid[d.key]).map((d) => ({ iso: d.iso, ymd: schedule.grid[d.key]?.date || '' }));
    return dates.map((d) => {
      const wd = WEEKDAYS.find((w) => w.iso === d.iso);
      const cell = schedule.grid[wd.key];
      return {
        iso: d.iso,
        key: wd.key,
        labelTh: wd.labelTh,
        label: wd.label,
        ymd: d.ymd,
        working: !!cell,
        weekend: d.iso >= 6,
        today: d.ymd === today,
        cell,
      };
    });
  }, [schedule]);

  const colCount = days.length + 1;

  // Total people assigned on a day+shift (across all tasks, incl. anonymous เสริม).
  const headcount = (cell, shiftId) => {
    const res = cell?.[shiftId];
    if (!res) return 0;
    return Object.values(res.assignments || {}).reduce((s, ids) => s + ids.length, 0);
  };

  const renderCell = (day, shiftId, task) => {
    if (!day.working) return <td key={day.key} className="border border-slate-100 bg-slate-50" />;
    const cell = day.cell;
    if (cell.closed) return <td key={day.key} className="border border-slate-100 bg-rose-50/50" />;
    const res = cell[shiftId];
    const assigned = res?.assignments?.[task.id] || [];
    const need = Number(task.req?.[shiftId]) || 0;
    const missing = Math.max(0, need - assigned.length);
    return (
      <td key={day.key} className={`border border-slate-100 p-1.5 align-top ${day.today ? 'bg-indigo-50/40' : ''}`}>
        <div className="flex flex-wrap gap-1">
          {assigned.map((empId, idx) => (
            <EmpChip
              key={empId + idx}
              empId={empId}
              color={task.color}
              editable={editable}
              onClick={() => onSlotClick?.(day.key, shiftId, task.id, idx, empId)}
            />
          ))}
          {Array.from({ length: missing }).map((_, i) =>
            editable ? (
              <button
                key={`add-${i}`}
                type="button"
                onClick={() => onAddClick?.(day.key, shiftId, task.id)}
                className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-rose-300 bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-500 hover:bg-rose-100"
              >
                <Plus className="h-3 w-3" /> เพิ่ม
              </button>
            ) : (
              <span
                key={`gap-${i}`}
                className="inline-flex items-center rounded-md border border-dashed border-rose-300 bg-rose-50 px-1.5 py-0.5 text-xs text-rose-400"
              >
                ว่าง
              </span>
            )
          )}
        </div>
      </td>
    );
  };

  const renderStandbyCell = (day, shiftId) => {
    if (!day.working) return <td key={day.key} className="border border-slate-100 bg-slate-50" />;
    if (day.cell.closed) return <td key={day.key} className="border border-slate-100 bg-rose-50/50" />;
    const list = day.cell[shiftId]?.standby || [];
    return (
      <td key={day.key} className="border border-slate-100 bg-slate-50/50 p-1.5 align-top">
        <div className="flex flex-wrap gap-1">
          {list.length === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : (
            list.map((empId, idx) => <EmpChip key={empId + idx} empId={empId} color="#94a3b8" editable={false} />)
          )}
        </div>
      </td>
    );
  };

  const renderUnavailableCell = (day, shiftId) => {
    if (!day.working) return <td key={day.key} className="border border-slate-100 bg-slate-50" />;
    if (day.cell.closed) return <td key={day.key} className="border border-slate-100 bg-rose-50/50" />;
    const list = day.cell[shiftId]?.unavailable || [];
    return (
      <td key={day.key} className="border border-slate-100 bg-rose-50/20 p-1.5 align-top">
        <div className="flex flex-wrap gap-1">
          {list.length === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : (
            list.map((u, idx) => {
              const e = getEmployee(u.employeeId);
              const label = e ? e.nickname || e.name : '—';
              const isLeave = u.kind === 'leave';
              const lt = isLeave ? getLeaveType(u.leaveType) : null;
              return (
                <span
                  key={u.employeeId + idx}
                  title={isLeave ? `${lt.label}${u.note ? ' · ' + u.note : ''}` : 'วันหยุดประจำ'}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${
                    isLeave ? lt.badge : 'border-slate-300 bg-slate-100 text-slate-500'
                  }`}
                >
                  <span>{isLeave ? lt.emoji : '💤'}</span>
                  <span className="truncate">{label}</span>
                </span>
              );
            })
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 w-40 border border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-500">
              หน้าที่ \ วัน
            </th>
            {days.map((d) => (
              <th
                key={d.key}
                className={`border border-slate-200 px-2 py-2 text-center text-xs font-semibold ${
                  d.cell?.closed
                    ? 'bg-rose-100 text-rose-700'
                    : d.today
                    ? 'bg-indigo-100 text-indigo-700'
                    : !d.working
                    ? 'bg-slate-50 text-slate-300'
                    : d.weekend
                    ? 'bg-slate-100 text-slate-400'
                    : 'bg-slate-100 text-slate-600'
                }`}
                title={d.cell?.closed ? `ปิดคลัง${d.cell.holidayName ? ' · ' + d.cell.holidayName : ''}` : undefined}
              >
                <div>{d.labelTh}</div>
                <div className="font-normal opacity-70">{d.ymd?.slice(5)}</div>
                {d.cell?.closed ? (
                  <div className="mt-0.5 font-semibold text-rose-600">🔒 ปิด</div>
                ) : !d.working ? (
                  <div className="mt-0.5 text-[10px] font-normal">หยุด</div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SHIFT_LIST.map((shift) => {
            const tasks = config.tasks.filter((t) => t.active && Number(t.req?.[shift.id]) > 0);
            const needPerDay = tasks.reduce((s, t) => s + Number(t.req[shift.id] || 0), 0);
            return (
              <React.Fragment key={shift.id}>
                <tr>
                  <td
                    colSpan={colCount}
                    className={`border border-slate-200 px-3 py-1.5 text-xs font-bold ${shift.barBg} ${shift.text}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${shift.dot}`} />
                      {shift.label} · {shift.labelTh}
                      <span className="font-normal opacity-70">· ต้องการ {needPerDay} คน/วัน</span>
                    </span>
                  </td>
                </tr>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="border border-slate-100 px-3 py-2 text-xs text-slate-400">
                      ไม่มีงานที่ต้องใช้คนในกะนี้
                    </td>
                  </tr>
                )}
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-slate-50/40">
                    <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left">
                      <div className="flex items-center gap-2">
                        <TaskDot color={task.color} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-700">{task.name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {task.nameTh} · {task.req[shift.id]} คน
                          </div>
                        </div>
                      </div>
                    </th>
                    {days.map((d) => renderCell(d, shift.id, task))}
                  </tr>
                ))}
                {/* Standby */}
                <tr>
                  <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-400">
                    Standby / พัก
                  </th>
                  {days.map((d) => renderStandbyCell(d, shift.id))}
                </tr>
                {/* Day-off / leave (only if anyone off this shift-week) */}
                {days.some((d) => (d.cell?.[shift.id]?.unavailable || []).length > 0) && (
                  <tr>
                    <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left text-xs font-medium text-rose-400">
                      หยุด/ลา
                    </th>
                    {days.map((d) => renderUnavailableCell(d, shift.id))}
                  </tr>
                )}
                {/* Per-day headcount total */}
                <tr>
                  <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-3 py-1 text-left text-xs font-bold text-slate-500">
                    รวมคน/วัน
                  </th>
                  {days.map((d) => {
                    if (!d.working || d.cell?.closed)
                      return <td key={d.key} className="border border-slate-100 bg-slate-50 text-center text-slate-300">—</td>;
                    const got = headcount(d.cell, shift.id);
                    const enough = got >= needPerDay;
                    return (
                      <td
                        key={d.key}
                        className={`border border-slate-200 px-1 py-1 text-center text-xs font-bold ${
                          enough ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}
                        title={`จัดได้ ${got} / ต้องการ ${needPerDay}`}
                      >
                        {got}/{needPerDay}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
