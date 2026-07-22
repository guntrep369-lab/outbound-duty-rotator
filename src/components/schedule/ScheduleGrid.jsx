import React from 'react';
import { Plus, AlertTriangle, Pin } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import { SHIFT_LIST, WEEKDAYS, SHIFTS, getLeaveType, isExtraId } from '../../data/models.js';
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

/**
 * Weekly roster as a Days × Tasks matrix (grouped by shift), horizontally
 * scrollable on small screens.
 */
export function ScheduleGrid({ schedule, editable = false, onSlotClick, onAddClick }) {
  const { config, getTask, getEmployee } = useApp();
  const days = WEEKDAYS.filter((d) => schedule.grid[d.key]).map((d) => ({ ...d, cell: schedule.grid[d.key] }));

  if (days.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No working days configured for this week.</p>;
  }

  const renderCell = (dayKey, cell, shiftId, task) => {
    if (cell.closed) return <td key={dayKey} className="border border-slate-100 bg-slate-100/70" />;
    const res = cell[shiftId];
    const assigned = (res?.assignments?.[task.id]) || [];
    const need = Number(task.req?.[shiftId]) || 0;
    const missing = Math.max(0, need - assigned.length);
    return (
      <td key={dayKey} className="border border-slate-100 p-1.5 align-top">
        <div className="flex flex-wrap gap-1">
          {assigned.map((empId, idx) => (
            <EmpChip
              key={empId + idx}
              empId={empId}
              color={task.color}
              editable={editable}
              onClick={() => onSlotClick?.(dayKey, shiftId, task.id, idx, empId)}
            />
          ))}
          {Array.from({ length: missing }).map((_, i) =>
            editable ? (
              <button
                key={`add-${i}`}
                type="button"
                onClick={() => onAddClick?.(dayKey, shiftId, task.id)}
                className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-rose-300 bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-500 hover:bg-rose-100"
              >
                <Plus className="h-3 w-3" /> add
              </button>
            ) : (
              <span
                key={`gap-${i}`}
                className="inline-flex items-center rounded-md border border-dashed border-rose-300 bg-rose-50 px-1.5 py-0.5 text-xs text-rose-400"
              >
                empty
              </span>
            )
          )}
        </div>
      </td>
    );
  };

  const renderStandbyCell = (dayKey, cell, shiftId) => {
    if (cell.closed) return <td key={dayKey} className="border border-slate-100 bg-slate-100/70" />;
    const res = cell[shiftId];
    const list = res?.standby || [];
    return (
      <td key={dayKey} className="border border-slate-100 bg-slate-50/50 p-1.5 align-top">
        <div className="flex flex-wrap gap-1">
          {list.length === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : (
            list.map((empId, idx) => (
              <EmpChip
                key={empId + idx}
                empId={empId}
                color="#94a3b8"
                editable={false}
              />
            ))
          )}
        </div>
      </td>
    );
  };

  const renderUnavailableCell = (dayKey, cell, shiftId) => {
    if (cell.closed) return <td key={dayKey} className="border border-slate-100 bg-slate-100/70" />;
    const res = cell[shiftId];
    const list = res?.unavailable || [];
    const emp = (id) => getEmployee(id);
    return (
      <td key={dayKey} className="border border-slate-100 bg-rose-50/30 p-1.5 align-top">
        <div className="flex flex-wrap gap-1">
          {list.length === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : (
            list.map((u, idx) => {
              const e = emp(u.employeeId);
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
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-40 border border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Task \ Day
            </th>
            {days.map((d) => (
              <th
                key={d.key}
                className={`border border-slate-200 px-2 py-2 text-center text-xs font-semibold ${
                  d.cell.closed ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                }`}
                title={d.cell.closed ? `ปิดคลัง${d.cell.holidayName ? ' · ' + d.cell.holidayName : ''}` : undefined}
              >
                <div>{d.label}</div>
                <div className="font-normal text-slate-400">{d.cell.date?.slice(5)}</div>
                {d.cell.closed && <div className="mt-0.5 font-semibold text-rose-600">🔒 ปิด</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SHIFT_LIST.map((shift) => {
            const tasks = config.tasks.filter((t) => t.active && Number(t.req?.[shift.id]) > 0);
            return (
              <React.Fragment key={shift.id}>
                <tr>
                  <td
                    colSpan={days.length + 1}
                    className={`border border-slate-200 px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${shift.barBg} ${shift.text}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${shift.dot}`} />
                      {shift.label} · {shift.labelTh}
                    </span>
                  </td>
                </tr>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={days.length + 1} className="border border-slate-100 px-3 py-2 text-xs text-slate-400">
                      No tasks require staff on this shift.
                    </td>
                  </tr>
                )}
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left">
                      <div className="flex items-center gap-2">
                        <TaskDot color={task.color} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-700">{task.name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {task.nameTh} · need {task.req[shift.id]}
                          </div>
                        </div>
                      </div>
                    </th>
                    {days.map((d) => renderCell(d.key, d.cell, shift.id, task))}
                  </tr>
                ))}
                {/* Standby row */}
                <tr>
                  <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-400">
                    Standby / พัก
                  </th>
                  {days.map((d) => renderStandbyCell(d.key, d.cell, shift.id))}
                </tr>
                {/* Day-off / leave row (only if anyone is off this shift-week) */}
                {days.some((d) => (d.cell[shift.id]?.unavailable || []).length > 0) && (
                  <tr>
                    <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left text-xs font-medium text-rose-400">
                      หยุด/ลา · Off/Leave
                    </th>
                    {days.map((d) => renderUnavailableCell(d.key, d.cell, shift.id))}
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
