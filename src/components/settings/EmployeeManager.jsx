import React, { useMemo, useState } from 'react';
import {
  UserPlus,
  Search,
  Pencil,
  Archive,
  RotateCcw,
  Trash2,
  Coffee,
  CircleCheck,
  Users,
  CalendarOff,
} from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import {
  SHIFT_LIST,
  STATUS_LIST,
  TYPE_LIST,
  EMPLOYEE_STATUS,
  EMPLOYEE_TYPES,
  SHIFTS,
  WEEKDAYS,
  taskAllowsType,
  getType,
} from '../../data/models.js';
import { ShiftBadge, StatusBadge, TypeBadge } from '../ui/Badge.jsx';
import { Pin } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: EMPLOYEE_STATUS.ACTIVE, label: 'Active' },
  { id: EMPLOYEE_STATUS.ON_LEAVE, label: 'On Leave' },
  { id: EMPLOYEE_STATUS.RESIGNED, label: 'Archived' },
];

function EmployeeForm({ initial, onSubmit, onCancel }) {
  const { config } = useApp();
  const [form, setForm] = useState({
    name: initial?.name || '',
    nickname: initial?.nickname || '',
    primaryShift: initial?.primaryShift || SHIFTS.MORNING,
    status: initial?.status || EMPLOYEE_STATUS.ACTIVE,
    type: initial?.type || EMPLOYEE_TYPES.INHOUSE,
    fixedDutyId: initial?.fixedDutyId || '',
    weeklyOffDays: Array.isArray(initial?.weeklyOffDays) ? initial.weeklyOffDays : [],
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleOff = (iso) =>
    setForm((f) => ({
      ...f,
      weeklyOffDays: f.weeklyOffDays.includes(iso)
        ? f.weeklyOffDays.filter((d) => d !== iso)
        : [...f.weeklyOffDays, iso].sort((a, b) => a - b),
    }));
  const valid = form.name.trim().length > 0;

  // Tasks that actually need staff on the chosen shift.
  const shiftTasks = config.tasks.filter((t) => t.active && Number(t.req?.[form.primaryShift]) > 0);
  const fixedTask = config.tasks.find((t) => t.id === form.fixedDutyId) || null;
  // Warn if pinning to a task whose type-restriction excludes this employee.
  const fixedTypeConflict = fixedTask && !taskAllowsType(fixedTask, form.type);

  return (
    <form
      id="employee-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ ...form, fixedDutyId: form.fixedDutyId || null, weeklyOffDays: form.weeklyOffDays });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Full name · ชื่อ-สกุล *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. สมชาย ใจดี"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Nickname · ชื่อเล่น</label>
          <input
            className="input"
            value={form.nickname}
            onChange={(e) => set('nickname', e.target.value)}
            placeholder="e.g. ชาย"
          />
        </div>
      </div>

      <div>
        <label className="label">Primary shift · กะหลัก</label>
        <div className="grid grid-cols-2 gap-2">
          {SHIFT_LIST.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => set('primaryShift', s.id)}
              className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-left text-sm transition ${
                form.primaryShift === s.id
                  ? `${s.barBorder} ${s.barBg} ${s.text} font-semibold`
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
              <span>
                {s.label}
                <span className="block text-xs font-normal opacity-70">{s.labelTh}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Employment type · ประเภทพนักงาน</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TYPE_LIST.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('type', t.id)}
              className={`flex items-center justify-center gap-2 rounded-lg border-2 px-2 py-2 text-sm transition ${
                form.type === t.id
                  ? `${t.badge} font-semibold`
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${t.dot}`} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Status · สถานะ</label>
        <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
          {STATUS_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.labelTh}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">
          <span className="inline-flex items-center gap-1.5">
            <Pin className="h-3.5 w-3.5" /> Fixed duty · ตำแหน่งประจำ (optional)
          </span>
        </label>
        <select
          className="input"
          value={form.fixedDutyId}
          onChange={(e) => set('fixedDutyId', e.target.value)}
        >
          <option value="">🔄 Rotate all duties · หมุนเวียนทุกงาน (default)</option>
          {shiftTasks.map((t) => (
            <option key={t.id} value={t.id}>
              📌 {t.name}
              {t.nameTh ? ` · ${t.nameTh}` : ''}
            </option>
          ))}
        </select>
        {form.fixedDutyId ? (
          <p className="mt-1.5 text-xs text-slate-400">
            คนนี้จะถูกจัดให้ทำ <b>เฉพาะงานนี้เท่านั้น</b> ไม่หมุนเวียนงานอื่น (เหมาะกับคนที่ชำนาญเฉพาะทาง)
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-400">
            เว้นว่าง = หมุนเวียนงานปกติตามอัลกอริทึม
          </p>
        )}
        {fixedTypeConflict && (
          <p className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
            ⚠ งาน “{fixedTask.name}” จำกัดเฉพาะ {fixedTask.allowedTypes.map((id) => getType(id).label).join(', ')} —
            พนักงานประเภท {getType(form.type).label} จะทำงานนี้ไม่ได้ (จะถูกพักแทน)
          </p>
        )}
      </div>

      <div>
        <label className="label">Weekly day off · วันหยุดประจำสัปดาห์</label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = form.weeklyOffDays.includes(d.iso);
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => toggleOff(d.iso)}
                title={d.labelTh}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  on ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          เลือกวันที่หยุดประจำ (เช่น inhouse/outsource ประจำ หยุดสัปดาห์ละ 1 วัน) — ระบบจะไม่จัดคนนี้ลงงานในวันนั้นทุกสัปดาห์
        </p>
      </div>
    </form>
  );
}

export function EmployeeManager() {
  const {
    employees,
    addEmployee,
    updateEmployee,
    setEmployeeStatus,
    archiveEmployee,
    restoreEmployee,
    deleteEmployee,
    loadDemoTeam,
    getTask,
  } = useApp();

  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const counts = useMemo(() => {
    const c = { all: employees.length };
    for (const s of STATUS_LIST) c[s.id] = employees.filter((e) => e.status === s.id).length;
    return c;
  }, [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees
      .filter((e) => (filter === 'all' ? true : e.status === filter))
      .filter((e) => (typeFilter === 'all' ? true : (e.type || EMPLOYEE_TYPES.INHOUSE) === typeFilter))
      .filter((e) =>
        q ? `${e.name} ${e.nickname}`.toLowerCase().includes(q) : true
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [employees, filter, typeFilter, query]);

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (emp) => {
    setEditing(emp);
    setModalOpen(true);
  };
  const submit = (form) => {
    if (editing) updateEmployee(editing.id, form);
    else addEmployee(form);
    setModalOpen(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <Users className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Employees · ระบบจัดการพนักงาน</h2>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <UserPlus className="h-4 w-4" /> Add employee
        </button>
      </div>

      {/* Filters + search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                filter === f.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            className="input sm:w-44"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by employment type"
          >
            <option value="all">ทุกประเภท (all types)</option>
            {TYPE_LIST.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search name / nickname…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-12 text-slate-400">
          <Users className="h-8 w-8" />
          <p className="text-sm">No employees here. Add your first teammate.</p>
          {employees.length === 0 && filter === 'all' && !query && (
            <button className="btn-secondary" onClick={loadDemoTeam}>
              <UserPlus className="h-4 w-4" /> Load a sample team (22 people)
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((emp) => (
            <li key={emp.id} className="card flex items-center gap-3 p-3.5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  emp.primaryShift === SHIFTS.MORNING
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                {(emp.nickname || emp.name || '?').slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-slate-800">
                    {emp.nickname || emp.name}
                  </p>
                </div>
                <p className="truncate text-xs text-slate-500">{emp.name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <ShiftBadge shiftId={emp.primaryShift} showTh={false} />
                  <TypeBadge typeId={emp.type} />
                  <StatusBadge status={emp.status} showTh={false} />
                  {emp.fixedDutyId && getTask(emp.fixedDutyId) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      <Pin className="h-3 w-3" />
                      {getTask(emp.fixedDutyId).name}
                    </span>
                  )}
                  {Array.isArray(emp.weeklyOffDays) && emp.weeklyOffDays.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">
                      <CalendarOff className="h-3 w-3" />
                      {emp.weeklyOffDays.map((iso) => WEEKDAYS.find((d) => d.iso === iso)?.label).join(',')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-0.5">
                  <button className="btn-ghost !p-1.5" title="Edit" onClick={() => openEdit(emp)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  {emp.status === EMPLOYEE_STATUS.RESIGNED ? (
                    <button
                      className="btn-ghost !p-1.5 text-emerald-600"
                      title="Restore"
                      onClick={() => restoreEmployee(emp.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      className="btn-ghost !p-1.5 text-slate-500"
                      title="Archive (Resigned)"
                      onClick={() => archiveEmployee(emp.id)}
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {emp.status !== EMPLOYEE_STATUS.RESIGNED && (
                  <div className="flex gap-0.5">
                    {emp.status === EMPLOYEE_STATUS.ACTIVE ? (
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs text-amber-600"
                        onClick={() => setEmployeeStatus(emp.id, EMPLOYEE_STATUS.ON_LEAVE)}
                      >
                        <Coffee className="mr-1 h-3.5 w-3.5" /> Leave
                      </button>
                    ) : (
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs text-emerald-600"
                        onClick={() => setEmployeeStatus(emp.id, EMPLOYEE_STATUS.ACTIVE)}
                      >
                        <CircleCheck className="mr-1 h-3.5 w-3.5" /> Activate
                      </button>
                    )}
                  </div>
                )}
                {emp.status === EMPLOYEE_STATUS.RESIGNED && (
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs text-rose-500"
                    onClick={() => {
                      if (window.confirm(`Permanently delete ${emp.nickname || emp.name}? This cannot be undone.`))
                        deleteEmployee(emp.id);
                    }}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit employee' : 'Add employee'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" type="submit" form="employee-form">
              {editing ? 'Save changes' : 'Add employee'}
            </button>
          </>
        }
      >
        <EmployeeForm initial={editing} onSubmit={submit} onCancel={() => setModalOpen(false)} />
      </Modal>
    </section>
  );
}
