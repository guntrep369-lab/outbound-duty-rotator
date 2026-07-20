import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Save,
  RefreshCw,
  FileDown,
  ClipboardCopy,
  Printer,
  Scale,
  AlertTriangle,
  Users,
  Armchair,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/useApp.js';
import { generateSchedule } from '../engine/rotationEngine.js';
import { reassignSlot, addToSlot, benchEmployee, refreshDerived } from '../utils/scheduleUtils.js';
import { scheduleToCSV, scheduleToText, downloadFile, copyToClipboard } from '../utils/exportUtils.js';
import { currentWeek } from '../utils/dateUtils.js';
import { EMPLOYEE_STATUS, getShift } from '../data/models.js';
import { WeekPicker } from './ui/WeekPicker.jsx';
import { ScheduleGrid } from './schedule/ScheduleGrid.jsx';
import { ShiftBadge } from './ui/Badge.jsx';
import { Modal } from './ui/Modal.jsx';

/** Where an employee currently sits within a day+shift. */
function placementLabel(cell, shiftId, empId, getTask) {
  const res = cell?.[shiftId];
  if (!res) return 'not scheduled';
  for (const [dutyId, ids] of Object.entries(res.assignments || {})) {
    if (ids.includes(empId)) return getTask(dutyId)?.name || dutyId;
  }
  if ((res.standby || []).includes(empId)) return 'Standby';
  return 'not scheduled';
}

function FairnessPanel({ schedule }) {
  const { getEmployee, getTask } = useApp();
  const [open, setOpen] = useState(false);
  const s = schedule.summary;
  const rows = Object.entries(s.byEmployee)
    .map(([empId, r]) => ({ empId, ...r }))
    .sort((a, b) => b.total - a.total);

  const scoreColor =
    s.fairnessScore >= 85 ? 'text-emerald-600' : s.fairnessScore >= 65 ? 'text-amber-600' : 'text-rose-600';

  return (
    <div className="card p-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className={`text-2xl font-bold ${scoreColor}`}>{s.fairnessScore}</div>
          <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
            <Scale className="h-3.5 w-3.5" /> Fairness
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-700">{s.employeeCount}</div>
          <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" /> Rostered
          </div>
        </div>
        <div>
          <div className={`text-2xl font-bold ${s.understaffedCount ? 'text-rose-600' : 'text-emerald-600'}`}>
            {s.understaffedCount}
          </div>
          <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5" /> Empty slots
          </div>
        </div>
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 w-full rounded-lg bg-slate-50 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
      >
        {open ? 'Hide' : 'Show'} per-person workload
      </button>

      {open && (
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {rows.map((r) => {
            const emp = getEmployee(r.empId);
            const duties = Object.entries(r.byDuty)
              .map(([d, n]) => `${getTask(d)?.name || d}×${n}`)
              .join(', ');
            return (
              <div key={r.empId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs">
                <span className="font-medium text-slate-700">{emp ? emp.nickname || emp.name : r.empId}</span>
                <span className="flex-1 truncate text-slate-400">{duties || '—'}</span>
                <span className="flex items-center gap-2 text-slate-500">
                  <span className="inline-flex items-center gap-0.5">
                    <Armchair className="h-3 w-3" />
                    {r.standby}
                  </span>
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">{r.total}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ScheduleGenerator() {
  const app = useApp();
  const { employees, config, history, getEmployee, getTask, notify, saveScheduleToHistory, savedWeeks } = app;

  const now = currentWeek();
  const [year, setYear] = useState(now.year);
  const [week, setWeek] = useState(now.week);
  const [schedule, setSchedule] = useState(null);
  const [edit, setEdit] = useState(null); // {dayKey, shiftId, dutyId, index|null, currentEmpId|null}

  const activeCount = useMemo(
    () => employees.filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE).length,
    [employees]
  );

  const generate = () => {
    if (activeCount === 0) {
      notify('warning', 'Add and activate some employees first (Settings → Employees).', 5000);
      return;
    }
    const sched = generateSchedule({ year, week, employees, config, history });
    setSchedule(sched);
    notify('success', `Generated roster for ${sched.weekKey}.`, 2500);
  };

  const applyEdit = (op) => {
    const next = refreshDerived(op, employees, config);
    setSchedule({ ...next });
  };

  const onSlotClick = (dayKey, shiftId, dutyId, index, currentEmpId) =>
    setEdit({ dayKey, shiftId, dutyId, index, currentEmpId });
  const onAddClick = (dayKey, shiftId, dutyId) =>
    setEdit({ dayKey, shiftId, dutyId, index: null, currentEmpId: null });

  const pickEmployee = (empId) => {
    if (!edit) return;
    const { dayKey, shiftId, dutyId, index } = edit;
    const op =
      index == null
        ? addToSlot(schedule, dayKey, shiftId, dutyId, empId)
        : reassignSlot(schedule, dayKey, shiftId, dutyId, index, empId);
    applyEdit(op);
    setEdit(null);
  };

  const benchCurrent = () => {
    if (!edit || edit.index == null) return;
    applyEdit(benchEmployee(schedule, edit.dayKey, edit.shiftId, edit.dutyId, edit.index));
    setEdit(null);
  };

  /* exports */
  const doCSV = () => {
    downloadFile(`roster-${schedule.weekKey}.csv`, scheduleToCSV(schedule, { getEmployee, getTask }));
    notify('success', 'CSV downloaded.', 2000);
  };
  const doCopy = async () => {
    const ok = await copyToClipboard(scheduleToText(schedule, { getEmployee, getTask }));
    notify(ok ? 'success' : 'error', ok ? 'Text summary copied to clipboard.' : 'Copy failed.', 2500);
  };
  const doPrint = () => window.print();

  const editCell = edit ? schedule.grid[edit.dayKey] : null;
  const editShift = edit ? getShift(edit.shiftId) : null;
  const candidates = useMemo(() => {
    if (!edit) return [];
    return employees
      .filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE && e.primaryShift === edit.shiftId)
      .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th'));
  }, [edit, employees]);

  const isSaved = schedule && savedWeeks.has(schedule.weekKey);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="no-print card flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-700">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Generate weekly roster</h2>
          </div>
          <WeekPicker year={year} week={week} onChange={(y, w) => { setYear(y); setWeek(w); }} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={generate}>
            {schedule ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {schedule ? 'Regenerate' : 'Generate roster'}
          </button>
          {schedule && (
            <>
              <button className="btn-primary !bg-emerald-600 hover:!bg-emerald-700" onClick={() => saveScheduleToHistory(schedule)}>
                <Save className="h-4 w-4" /> Save to history
              </button>
              <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
              <button className="btn-secondary" onClick={doCSV}>
                <FileDown className="h-4 w-4" /> CSV
              </button>
              <button className="btn-secondary" onClick={doCopy}>
                <ClipboardCopy className="h-4 w-4" /> Copy text
              </button>
              <button className="btn-secondary" onClick={doPrint}>
                <Printer className="h-4 w-4" /> Print
              </button>
            </>
          )}
        </div>

        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Scale className="h-3.5 w-3.5" />
          Fair rotation looks back {config.lookbackWeeks} weeks and prioritises duties each person hasn't done recently.
          Click any name in the grid to swap or bench.
        </p>
      </div>

      {/* Preview */}
      {!schedule ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-slate-400">
          <Sparkles className="h-10 w-10" />
          <p className="text-sm">Pick a week and press <b>Generate roster</b> to preview assignments.</p>
          <p className="text-xs">{activeCount} active employee{activeCount === 1 ? '' : 's'} available.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
            <div className="card overflow-hidden p-3 print-area">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="font-semibold text-slate-700">
                  Roster · {schedule.weekKey}
                  {isSaved && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> saved
                    </span>
                  )}
                </h3>
                <div className="hidden gap-2 sm:flex">
                  <ShiftBadge shiftId="morning" showTh={false} />
                  <ShiftBadge shiftId="afternoon" showTh={false} />
                </div>
              </div>
              <ScheduleGrid schedule={schedule} editable onSlotClick={onSlotClick} onAddClick={onAddClick} />
            </div>
            <div className="no-print">
              <FairnessPanel schedule={schedule} />
            </div>
          </div>
        </div>
      )}

      {/* Swap / assign modal */}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Swap / assign"
        maxWidth="max-w-md"
      >
        {edit && (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {editShift && <ShiftBadge shiftId={edit.shiftId} showTh={false} />}
                <span className="font-medium text-slate-700">{getTask(edit.dutyId)?.name || edit.dutyId}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {schedule.grid[edit.dayKey]?.label} · {schedule.grid[edit.dayKey]?.date}
                {edit.currentEmpId && (
                  <>
                    {' '}· currently{' '}
                    <b>{getEmployee(edit.currentEmpId)?.nickname || getEmployee(edit.currentEmpId)?.name}</b>
                  </>
                )}
              </p>
            </div>

            <p className="text-xs font-medium text-slate-500">
              {edit.index == null ? 'Assign someone to this slot:' : 'Reassign this slot to:'}
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {candidates.map((c) => {
                const where = placementLabel(editCell, edit.shiftId, c.id, getTask);
                const isCurrent = c.id === edit.currentEmpId;
                return (
                  <button
                    key={c.id}
                    disabled={isCurrent}
                    onClick={() => pickEmployee(c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                      isCurrent
                        ? 'cursor-default border-indigo-200 bg-indigo-50'
                        : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    <span className="font-medium text-slate-700">
                      {c.nickname || c.name}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">{c.name}</span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{where}</span>
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">No active employees on this shift.</p>
              )}
            </div>

            {edit.index != null && (
              <button className="btn-secondary w-full" onClick={benchCurrent}>
                <Armchair className="h-4 w-4" /> Send current person to standby
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
