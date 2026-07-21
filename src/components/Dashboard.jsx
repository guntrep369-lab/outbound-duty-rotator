import React, { useMemo } from 'react';
import {
  CalendarClock,
  Users,
  Coffee,
  ClipboardList,
  CalendarRange,
  ArrowRight,
  Armchair,
  PackageOpen,
} from 'lucide-react';
import { useApp } from '../context/useApp.js';
import {
  SHIFT_LIST,
  EMPLOYEE_STATUS,
  WEEKDAYS,
  isAvailableOn,
  unavailabilityOn,
  getLeaveType,
  effectiveShiftOn,
  holidayOn,
} from '../data/models.js';
import { getISOWeek, weekKey, formatShort } from '../utils/dateUtils.js';
import { TaskDot } from './ui/Badge.jsx';

function StatCard({ icon: Icon, label, value, tint, sub }) {
  return (
    <div className="card flex items-center gap-3 p-3.5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-slate-800">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

function ShiftColumn({ shift, tasks, byDuty, standby, getEmployee, getTask }) {
  const total = Object.values(byDuty).reduce((s, ids) => s + ids.length, 0);
  return (
    <div className={`card overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 ${shift.barBg}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${shift.dot}`} />
          <span className={`font-semibold ${shift.text}`}>
            {shift.label} · {shift.labelTh}
          </span>
        </div>
        <span className={`rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium ${shift.text}`}>
          {total} on duty
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {tasks.filter((t) => (byDuty[t.id] || []).length > 0).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No one scheduled.</p>
        ) : (
          tasks.map((t) => {
            const ids = byDuty[t.id] || [];
            if (!ids.length) return null;
            return (
              <div key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="flex w-28 shrink-0 items-center gap-2 pt-0.5">
                  <TaskDot color={t.color} />
                  <span className="text-sm font-medium text-slate-700">{t.name}</span>
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {ids.map((id) => {
                    const e = getEmployee(id);
                    return (
                      <span
                        key={id}
                        className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                        title={e?.name}
                      >
                        {e ? e.nickname || e.name : '—'}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
      {standby.length > 0 && (
        <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
          <Armchair className="mt-0.5 h-4 w-4 text-slate-400" />
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs font-medium text-slate-400">Standby:</span>
            {standby.map((e) => (
              <span key={e.id} className="rounded-md bg-white px-2 py-0.5 text-xs text-slate-500">
                {e.nickname || e.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Dashboard({ onNavigate }) {
  const { employees, config, history, shiftRotations, getEmployee, getTask } = useApp();

  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayYmd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const { year, week } = getISOWeek(today);
  const todayIso = today.getDay() === 0 ? 7 : today.getDay();
  const todayName = WEEKDAYS.find((d) => d.iso === todayIso);

  const stats = useMemo(() => {
    const activeEmps = employees.filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE);
    const onLeave = employees.filter((e) => e.status === EMPLOYEE_STATUS.ON_LEAVE).length;
    const tasks = config.tasks.filter((t) => t.active).length;
    // Breakdown of active staff by employment type (legacy records = inhouse).
    const byType = { inhouse: 0, outsource_regular: 0, outsource_extra: 0 };
    for (const e of activeEmps) byType[e.type || 'inhouse'] = (byType[e.type || 'inhouse'] || 0) + 1;
    const typeSub = `${byType.inhouse} inhouse · ${byType.outsource_regular} OS ประจำ · ${byType.outsource_extra} OS เสริม`;
    return { active: activeEmps.length, onLeave, tasks, working: config.workingDays.length, typeSub };
  }, [employees, config]);

  const todaysRecords = useMemo(() => history.filter((r) => r.date === todayYmd), [history, todayYmd]);

  const perShift = useMemo(() => {
    const map = {};
    for (const s of SHIFT_LIST) map[s.id] = {};
    for (const r of todaysRecords) {
      if (!map[r.shift]) map[r.shift] = {};
      (map[r.shift][r.dutyId] ||= []).push(r.employeeId);
    }
    return map;
  }, [todaysRecords]);

  const standbyByShift = useMemo(() => {
    const res = {};
    for (const s of SHIFT_LIST) {
      const assigned = new Set(todaysRecords.filter((r) => r.shift === s.id).map((r) => r.employeeId));
      res[s.id] = employees.filter(
        (e) =>
          e.status === EMPLOYEE_STATUS.ACTIVE &&
          effectiveShiftOn(e, todayYmd, shiftRotations) === s.id &&
          !assigned.has(e.id) &&
          // Not on a recurring day off or dated leave today.
          isAvailableOn(e, todayYmd, todayIso)
      );
    }
    return res;
  }, [todaysRecords, employees, todayYmd, todayIso, shiftRotations]);

  const todayHoliday = holidayOn(config.holidays, todayYmd);

  // Who is off / on leave today (across both shifts).
  const unavailableToday = useMemo(() => {
    const rows = [];
    for (const e of employees) {
      if (e.status !== EMPLOYEE_STATUS.ACTIVE) continue;
      const u = unavailabilityOn(e, todayYmd, todayIso);
      if (u) rows.push({ emp: e, ...u });
    }
    return rows;
  }, [employees, todayYmd, todayIso]);

  const hasToday = todaysRecords.length > 0;

  return (
    <div className="space-y-5">
      {/* Greeting / date */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-slate-700">
            <CalendarClock className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Today · {todayName ? `${todayName.label} (${todayName.labelTh})` : ''}</h2>
          </div>
          <p className="text-sm text-slate-500">
            {formatShort(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())))} · {weekKey(year, week)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => onNavigate?.('schedule')}>
            <CalendarRange className="h-4 w-4" /> Roster
          </button>
          <button className="btn-primary" onClick={() => onNavigate?.('settings')}>
            <Users className="h-4 w-4" /> Team
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} label="Active staff" value={stats.active} sub={stats.typeSub} tint="bg-emerald-100 text-emerald-600" />
        <StatCard icon={Coffee} label="On leave" value={stats.onLeave} tint="bg-amber-100 text-amber-600" />
        <StatCard icon={ClipboardList} label="Active tasks" value={stats.tasks} tint="bg-indigo-100 text-indigo-600" />
        <StatCard icon={CalendarRange} label="Working days/wk" value={stats.working} tint="bg-sky-100 text-sky-600" />
      </div>

      {/* Warehouse closed today */}
      {todayHoliday && (
        <div className="card flex items-center gap-3 border-rose-200 bg-rose-50 p-4">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="font-semibold text-rose-700">วันนี้คลังปิด — ไม่มีการจัดงาน</p>
            <p className="text-sm text-rose-600/80">{todayHoliday.name || 'วันหยุด'}</p>
          </div>
        </div>
      )}

      {/* Off / leave today */}
      {unavailableToday.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2 p-3.5">
          <span className="text-sm font-semibold text-slate-600">หยุด/ลาวันนี้:</span>
          {unavailableToday.map(({ emp, kind, leaveType }) => {
            const lt = kind === 'leave' ? getLeaveType(leaveType) : null;
            return (
              <span
                key={emp.id}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                  lt ? lt.badge : 'border-slate-300 bg-slate-100 text-slate-500'
                }`}
                title={lt ? lt.label : 'วันหยุดประจำ'}
              >
                {lt ? lt.emoji : '💤'} {emp.nickname || emp.name}
              </span>
            );
          })}
        </div>
      )}

      {/* Today's assignments */}
      {hasToday ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SHIFT_LIST.map((s) => (
            <ShiftColumn
              key={s.id}
              shift={s}
              tasks={config.tasks}
              byDuty={perShift[s.id] || {}}
              standby={standbyByShift[s.id] || []}
              getEmployee={getEmployee}
              getTask={getTask}
            />
          ))}
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 py-14 text-center text-slate-400">
          <PackageOpen className="h-10 w-10" />
          <div>
            <p className="text-sm font-medium text-slate-500">No saved roster for today ({todayYmd}).</p>
            <p className="text-xs">Generate this week's roster and save it to history to see today's duties here.</p>
          </div>
          <button className="btn-primary" onClick={() => onNavigate?.('schedule')}>
            <CalendarRange className="h-4 w-4" /> Go to Schedule <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
