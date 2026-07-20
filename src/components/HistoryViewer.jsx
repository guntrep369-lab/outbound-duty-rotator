import React, { useMemo, useState } from 'react';
import { History as HistoryIcon, Trash2, FileDown, BarChart3, CalendarX2, Layers } from 'lucide-react';
import { useApp } from '../context/useApp.js';
import { WEEKDAYS } from '../data/models.js';
import { parseWeekKey } from '../utils/dateUtils.js';
import { scheduleToCSV, downloadFile } from '../utils/exportUtils.js';
import { ScheduleGrid } from './schedule/ScheduleGrid.jsx';
import { TaskDot } from './ui/Badge.jsx';

/** Rebuild a read-only schedule object (grid) from flat history records. */
function scheduleFromRecords(wk, recs) {
  const parsed = parseWeekKey(wk);
  const grid = {};
  for (const r of recs) {
    const wd = WEEKDAYS.find((d) => d.key === r.dayKey);
    if (!grid[r.dayKey]) {
      grid[r.dayKey] = {
        iso: wd?.iso,
        date: r.date,
        label: wd?.label,
        labelTh: wd?.labelTh,
        morning: { assignments: {}, standby: [], understaffed: [] },
        afternoon: { assignments: {}, standby: [], understaffed: [] },
      };
    }
    const cell = grid[r.dayKey][r.shift];
    if (cell) (cell.assignments[r.dutyId] ||= []).push(r.employeeId);
  }
  const workingDays = [...new Set(recs.map((r) => WEEKDAYS.find((d) => d.key === r.dayKey)?.iso).filter(Boolean))].sort(
    (a, b) => a - b
  );
  return { weekKey: wk, year: parsed?.year, week: parsed?.week, grid, workingDays, records: recs };
}

/** Distribution heat-table: employee × task counts over the chosen scope. */
function DistributionTable({ scopeRecords }) {
  const { config, getEmployee, getTask } = useApp();

  const { rows, cols, max } = useMemo(() => {
    const dist = new Map(); // empId -> {dutyId: count, total}
    const dutySet = new Set();
    let mx = 0;
    for (const r of scopeRecords) {
      dutySet.add(r.dutyId);
      if (!dist.has(r.employeeId)) dist.set(r.employeeId, { total: 0 });
      const d = dist.get(r.employeeId);
      d[r.dutyId] = (d[r.dutyId] || 0) + 1;
      d.total += 1;
      if (d[r.dutyId] > mx) mx = d[r.dutyId];
    }
    const cols = config.tasks.filter((t) => dutySet.has(t.id));
    // include any duty ids not in current config (renamed/removed tasks)
    for (const id of dutySet) if (!cols.find((c) => c.id === id)) cols.push({ id, name: id, color: '#94a3b8' });
    const rows = [...dist.entries()]
      .map(([empId, d]) => ({ empId, ...d }))
      .sort((a, b) => b.total - a.total);
    return { rows, cols, max: mx };
  }, [scopeRecords, config.tasks]);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No assignments in this scope yet.</p>;
  }

  const cellBg = (n) => {
    if (!n) return 'transparent';
    const alpha = 0.12 + 0.6 * (n / (max || 1));
    return `rgba(79, 70, 229, ${alpha.toFixed(2)})`; // indigo
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-500">
              Employee
            </th>
            {cols.map((c) => (
              <th key={c.id} className="border border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-600">
                <div className="flex items-center justify-center gap-1">
                  <TaskDot color={c.color} />
                  <span className="whitespace-nowrap">{c.name}</span>
                </div>
              </th>
            ))}
            <th className="border border-slate-200 bg-slate-100 px-2 py-2 text-xs font-semibold text-slate-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const emp = getEmployee(r.empId);
            return (
              <tr key={r.empId}>
                <th className="sticky left-0 z-10 border border-slate-100 bg-white px-3 py-1.5 text-left font-medium text-slate-700">
                  {emp ? emp.nickname || emp.name : r.empId}
                </th>
                {cols.map((c) => {
                  const n = r[c.id] || 0;
                  return (
                    <td
                      key={c.id}
                      className="border border-slate-100 px-2 py-1.5 text-center font-medium text-slate-700"
                      style={{ backgroundColor: cellBg(n) }}
                    >
                      {n || <span className="text-slate-300">·</span>}
                    </td>
                  );
                })}
                <td className="border border-slate-100 bg-slate-50 px-2 py-1.5 text-center font-bold text-indigo-700">
                  {r.total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryViewer() {
  const { history, getEmployee, getTask, deleteWeekFromHistory, clearHistory, notify } = useApp();

  const weeks = useMemo(() => {
    const set = [...new Set(history.map((r) => r.weekKey))];
    return set.sort((a, b) => b.localeCompare(a)); // newest first
  }, [history]);

  const [selected, setSelected] = useState(weeks[0] || null);
  const [scope, setScope] = useState('all'); // 'all' | 'recent'

  // Keep selection valid as history changes.
  const activeWeek = selected && weeks.includes(selected) ? selected : weeks[0] || null;

  const selectedRecords = useMemo(
    () => history.filter((r) => r.weekKey === activeWeek),
    [history, activeWeek]
  );
  const selectedSchedule = useMemo(
    () => (activeWeek ? scheduleFromRecords(activeWeek, selectedRecords) : null),
    [activeWeek, selectedRecords]
  );

  const recentWeeks = weeks.slice(0, 4);
  const scopeRecords = useMemo(
    () => (scope === 'recent' ? history.filter((r) => recentWeeks.includes(r.weekKey)) : history),
    [history, scope, recentWeeks]
  );

  if (history.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 py-16 text-center text-slate-400">
        <CalendarX2 className="h-10 w-10" />
        <div>
          <p className="text-sm font-medium text-slate-500">No history yet.</p>
          <p className="text-xs">Generate a roster and press “Save to history” to start building rotation history.</p>
        </div>
      </div>
    );
  }

  const exportWeek = () => {
    downloadFile(`roster-${activeWeek}.csv`, scheduleToCSV(selectedSchedule, { getEmployee, getTask }));
    notify('success', 'CSV downloaded.', 2000);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <HistoryIcon className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">History · ประวัติการหมุนเวียนงาน</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Layers className="h-4 w-4" />
          {weeks.length} week{weeks.length === 1 ? '' : 's'} · {history.length} assignments
          <button
            className="btn-ghost !px-2 !py-1 text-xs text-rose-500"
            onClick={() => {
              if (window.confirm('Clear ALL history? This cannot be undone.')) clearHistory();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear all
          </button>
        </div>
      </div>

      {/* Week selector */}
      <div className="flex flex-wrap gap-1.5">
        {weeks.map((wk) => (
          <button
            key={wk}
            onClick={() => setSelected(wk)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              wk === activeWeek ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {wk}
          </button>
        ))}
      </div>

      {/* Selected week grid */}
      {selectedSchedule && (
        <div className="card overflow-hidden p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="font-semibold text-slate-700">Roster · {activeWeek}</h3>
            <div className="flex gap-2">
              <button className="btn-secondary !py-1.5 text-xs" onClick={exportWeek}>
                <FileDown className="h-3.5 w-3.5" /> CSV
              </button>
              <button
                className="btn-ghost !py-1.5 text-xs text-rose-500"
                onClick={() => {
                  if (window.confirm(`Remove ${activeWeek} from history?`)) deleteWeekFromHistory(activeWeek);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete week
              </button>
            </div>
          </div>
          <ScheduleGrid schedule={selectedSchedule} editable={false} />
        </div>
      )}

      {/* Distribution analysis */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-700">
            <BarChart3 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold">Duty distribution · how often each person did each task</h3>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
            <button
              onClick={() => setScope('recent')}
              className={`rounded-md px-2.5 py-1 font-medium ${scope === 'recent' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
            >
              Recent 4 wks
            </button>
            <button
              onClick={() => setScope('all')}
              className={`rounded-md px-2.5 py-1 font-medium ${scope === 'all' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
            >
              All time
            </button>
          </div>
        </div>
        <DistributionTable scopeRecords={scopeRecords} />
        <p className="mt-2 text-xs text-slate-400">
          Darker cells = performed more often. The rotation engine uses exactly this signal to steer people toward tasks
          they've done least recently.
        </p>
      </div>
    </div>
  );
}
