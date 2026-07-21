import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  CalendarOff,
  Plane,
  Lock,
  LockOpen,
} from 'lucide-react';
import { useApp } from '../context/useApp.js';
import {
  EMPLOYEE_STATUS,
  LEAVE_TYPES,
  getLeaveType,
  WEEKDAYS,
  isDayOff,
  leaveOn,
  holidayOn,
} from '../data/models.js';
import { Modal } from './ui/Modal.jsx';

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const isoOf = (date) => (date.getDay() === 0 ? 7 : date.getDay());

function todayYmd() {
  const t = new Date();
  return ymdOf(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Nice Thai date label from a YYYY-MM-DD string. */
function fmtThai(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Add-leave form used inside the day modal. */
function AddLeaveForm({ activeEmployees, defaultDate, onAdd }) {
  const [form, setForm] = useState({
    empId: activeEmployees[0]?.id || '',
    start: defaultDate,
    end: defaultDate,
    type: 'vacation',
    note: '',
  });
  const set = (k, v) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      // keep end >= start
      if (k === 'start' && next.end < v) next.end = v;
      return next;
    });
  const valid = form.empId && form.start && form.end && form.end >= form.start;

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onAdd(form.empId, { start: form.start, end: form.end, type: form.type, note: form.note.trim() });
      }}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Plus className="h-4 w-4" /> เพิ่มวันลา
      </p>
      <div>
        <label className="label">พนักงาน</label>
        <select className="input" value={form.empId} onChange={(e) => set('empId', e.target.value)}>
          {activeEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nickname || e.name} · {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">ตั้งแต่</label>
          <input type="date" className="input" value={form.start} onChange={(e) => set('start', e.target.value)} />
        </div>
        <div>
          <label className="label">ถึง</label>
          <input type="date" className="input" min={form.start} value={form.end} onChange={(e) => set('end', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">ประเภท</label>
        <div className="grid grid-cols-3 gap-2">
          {LEAVE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('type', t.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2 text-sm transition ${
                form.type === t.id ? `${t.badge} font-semibold` : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              <span>{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">หมายเหตุ (optional)</label>
        <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="เช่น ไปต่างจังหวัด" />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={!valid}>
        <Plus className="h-4 w-4" /> บันทึกวันลา
      </button>
    </form>
  );
}

export function CalendarView() {
  const { employees, config, addLeave, removeLeave, addHoliday, removeHoliday } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() }); // month 0-based
  const [openYmd, setOpenYmd] = useState(null);
  const [holidayName, setHolidayName] = useState('');
  const holidays = config.holidays || [];

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE)
        .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th')),
    [employees]
  );

  const shiftMonth = (delta) => {
    setYm(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  // Build the month grid (Mon-first).
  const cells = useMemo(() => {
    const { year, month } = ym;
    const first = new Date(year, month, 1);
    const leading = isoOf(first) - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr = [];
    for (let i = 0; i < leading; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      arr.push({ day: d, ymd: ymdOf(year, month, d), iso: isoOf(date) });
    }
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [ym]);

  const today = todayYmd();

  // Who's off / on leave on a given day.
  const dayInfo = (ymd, iso) => {
    const leaves = [];
    const off = [];
    for (const e of activeEmployees) {
      const lv = leaveOn(e, ymd);
      if (lv) leaves.push({ emp: e, leave: lv });
      else if (isDayOff(e, iso)) off.push(e);
    }
    return { leaves, off };
  };

  // Upcoming leaves (end >= today), flattened + sorted.
  const upcoming = useMemo(() => {
    const rows = [];
    for (const e of employees) {
      for (const l of e.leaves || []) {
        if (l.end >= today) rows.push({ emp: e, leave: l });
      }
    }
    return rows.sort((a, b) => a.leave.start.localeCompare(b.leave.start)).slice(0, 30);
  }, [employees, today]);

  const monthLabel = new Date(ym.year, ym.month, 1).toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric',
  });

  // ISO weekday for the currently-open day.
  const openIso = openYmd ? isoOf(new Date(Number(openYmd.slice(0, 4)), Number(openYmd.slice(5, 7)) - 1, Number(openYmd.slice(8, 10)))) : null;
  const openInfo = openYmd ? dayInfo(openYmd, openIso) : null;
  const openHoliday = openYmd ? holidayOn(holidays, openYmd) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <CalendarDays className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">ปฏิทินวันหยุด-ลา · Calendar</h2>
        </div>
        <button className="btn-primary" onClick={() => setOpenYmd(today)}>
          <Plus className="h-4 w-4" /> เพิ่มวันลา
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {LEAVE_TYPES.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} /> {t.emoji} {t.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> 💤 วันหยุดประจำ
        </span>
      </div>

      {/* Month grid */}
      <div className="card p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <button className="btn-secondary !px-2" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อน">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-base font-semibold text-slate-800">{monthLabel}</h3>
          <button className="btn-secondary !px-2" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div key={d.iso} className="pb-1 text-center text-xs font-semibold text-slate-400">
              {d.label}
            </div>
          ))}
          {cells.map((c, i) => {
            if (!c) return <div key={`b-${i}`} className="min-h-[68px] rounded-lg bg-slate-50/40" />;
            const { leaves, off } = dayInfo(c.ymd, c.iso);
            const isToday = c.ymd === today;
            const isWeekend = c.iso >= 6;
            const hol = holidayOn(holidays, c.ymd);
            return (
              <button
                key={c.ymd}
                onClick={() => setOpenYmd(c.ymd)}
                className={`flex min-h-[68px] flex-col gap-1 rounded-lg border p-1.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 ${
                  hol
                    ? 'border-rose-300 bg-rose-50'
                    : isToday
                    ? 'border-indigo-400 bg-indigo-50/60'
                    : isWeekend
                    ? 'border-slate-100 bg-slate-50/50'
                    : 'border-slate-100'
                }`}
              >
                <span className={`text-xs font-semibold ${isToday ? 'text-indigo-700' : 'text-slate-500'}`}>{c.day}</span>
                <div className="flex flex-wrap gap-0.5">
                  {hol && (
                    <span
                      title={`ปิดคลัง${hol.name ? ' · ' + hol.name : ''}`}
                      className="inline-block max-w-full truncate rounded bg-rose-200 px-1 text-[10px] font-semibold leading-4 text-rose-800"
                    >
                      🔒 {hol.name || 'ปิดคลัง'}
                    </span>
                  )}
                  {leaves.slice(0, 3).map(({ emp, leave }) => {
                    const lt = getLeaveType(leave.type);
                    return (
                      <span
                        key={emp.id}
                        title={`${emp.nickname || emp.name} · ${lt.label}`}
                        className={`inline-block max-w-full truncate rounded px-1 text-[10px] font-medium leading-4 ${lt.badge}`}
                      >
                        {lt.emoji}
                        {emp.nickname || emp.name}
                      </span>
                    );
                  })}
                  {leaves.length > 3 && (
                    <span className="rounded bg-slate-100 px-1 text-[10px] leading-4 text-slate-500">+{leaves.length - 3}</span>
                  )}
                  {off.length > 0 && (
                    <span className="rounded bg-slate-100 px-1 text-[10px] leading-4 text-slate-400" title={`หยุดประจำ ${off.length} คน`}>
                      💤{off.length}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Upcoming leaves */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-slate-700">
          <Plane className="h-4 w-4 text-indigo-600" />
          <h3 className="text-sm font-semibold">วันลาที่จะถึง · Upcoming leaves</h3>
        </div>
        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีวันลาที่บันทึกไว้</p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map(({ emp, leave }) => {
              const lt = getLeaveType(leave.type);
              return (
                <li key={leave.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${lt.badge}`}>
                    {lt.emoji} {lt.label}
                  </span>
                  <span className="font-medium text-slate-700">{emp.nickname || emp.name}</span>
                  <span className="text-slate-400">
                    {leave.start === leave.end ? leave.start : `${leave.start} → ${leave.end}`}
                  </span>
                  {leave.note && <span className="truncate text-xs text-slate-400">· {leave.note}</span>}
                  <button
                    className="btn-ghost !ml-auto !p-1.5 text-rose-500"
                    title="ลบ"
                    onClick={() => removeLeave(emp.id, leave.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Day detail + add-leave modal */}
      <Modal open={!!openYmd} onClose={() => setOpenYmd(null)} title={openYmd ? fmtThai(openYmd) : ''} maxWidth="max-w-lg">
        {openYmd && openInfo && (
          <div className="space-y-4">
            {/* Warehouse holiday (closed day) */}
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              {openHoliday ? (
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-rose-600" />
                  <span className="flex-1 text-sm font-semibold text-rose-700">
                    วันนี้คลังปิด{openHoliday.name ? ` · ${openHoliday.name}` : ''}
                  </span>
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => removeHoliday(openYmd)}>
                    <LockOpen className="h-3.5 w-3.5" /> เปิดคลัง (ยกเลิก)
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Lock className="h-4 w-4 text-rose-500" />
                  <span className="text-sm font-medium text-slate-600">ตั้งเป็นวันหยุด (ปิดคลัง ไม่จัดงาน):</span>
                  <input
                    className="input h-8 flex-1 !py-1 text-sm"
                    placeholder="ชื่อวันหยุด (เช่น วันแม่)"
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                  />
                  <button
                    className="btn-danger !py-1.5 text-xs"
                    onClick={() => {
                      addHoliday(openYmd, holidayName.trim());
                      setHolidayName('');
                    }}
                  >
                    <Lock className="h-3.5 w-3.5" /> ปิดคลังวันนี้
                  </button>
                </div>
              )}
            </div>

            {/* Leaves that day */}
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                <Plane className="h-4 w-4" /> ลาวันนี้ ({openInfo.leaves.length})
              </p>
              {openInfo.leaves.length === 0 ? (
                <p className="text-sm text-slate-400">— ไม่มี —</p>
              ) : (
                <ul className="space-y-1">
                  {openInfo.leaves.map(({ emp, leave }) => {
                    const lt = getLeaveType(leave.type);
                    return (
                      <li key={leave.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${lt.badge}`}>
                          {lt.emoji} {lt.label}
                        </span>
                        <span className="font-medium text-slate-700">{emp.nickname || emp.name}</span>
                        <span className="text-xs text-slate-400">
                          {leave.start === leave.end ? '' : `${leave.start}→${leave.end}`}
                        </span>
                        <button
                          className="btn-ghost !ml-auto !p-1 text-rose-500"
                          title="ลบ"
                          onClick={() => removeLeave(emp.id, leave.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recurring day-off that day */}
            {openInfo.off.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                  <CalendarOff className="h-4 w-4" /> หยุดประจำวันนี้ ({openInfo.off.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {openInfo.off.map((e) => (
                    <span key={e.id} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      💤 {e.nickname || e.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {activeEmployees.length > 0 ? (
              <AddLeaveForm
                activeEmployees={activeEmployees}
                defaultDate={openYmd}
                onAdd={(empId, leave) => {
                  addLeave(empId, leave);
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">ยังไม่มีพนักงานที่ทำงานอยู่</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
