import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ClipboardList, CalendarDays, Users2, AlertTriangle, Lock, UserCog } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import { SHIFT_LIST, SHIFTS, WEEKDAYS, TYPE_LIST, EMPLOYEE_STATUS, EMPLOYEE_TYPES, getType } from '../../data/models.js';
import { TaskDot } from '../ui/Badge.jsx';
import { Modal } from '../ui/Modal.jsx';

const PALETTE = ['#0ea5e9', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981', '#14b8a6', '#ec4899', '#64748b'];

function TaskForm({ initial, onSubmit }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    nameTh: initial?.nameTh || '',
    color: initial?.color || PALETTE[0],
    morning: initial?.req?.morning ?? 1,
    afternoon: initial?.req?.afternoon ?? 1,
    allowedTypes: Array.isArray(initial?.allowedTypes) ? initial.allowedTypes : [],
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleType = (id) =>
    setForm((f) => ({
      ...f,
      allowedTypes: f.allowedTypes.includes(id)
        ? f.allowedTypes.filter((x) => x !== id)
        : [...f.allowedTypes, id],
    }));

  return (
    <form
      id="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim()) return;
        onSubmit({
          name: form.name.trim(),
          nameTh: form.nameTh.trim(),
          color: form.color,
          req: { morning: Math.max(0, Number(form.morning) || 0), afternoon: Math.max(0, Number(form.afternoon) || 0) },
          allowedTypes: form.allowedTypes,
        });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Task name (EN) *</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Pack" autoFocus />
        </div>
        <div>
          <label className="label">ชื่องาน (TH)</label>
          <input className="input" value={form.nameTh} onChange={(e) => set('nameTh', e.target.value)} placeholder="แพ็คสินค้า" />
        </div>
      </div>

      <div>
        <label className="label">Colour</label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set('color', c)}
              className={`h-8 w-8 rounded-lg ring-2 ring-offset-2 transition ${
                form.color === c ? 'ring-slate-800' : 'ring-transparent'
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {SHIFT_LIST.map((s) => (
          <div key={s.id}>
            <label className="label">
              {s.label} · {s.labelTh}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                className="input"
                value={s.id === SHIFTS.MORNING ? form.morning : form.afternoon}
                onChange={(e) => set(s.id === SHIFTS.MORNING ? 'morning' : 'afternoon', e.target.value)}
              />
              <span className="whitespace-nowrap text-sm text-slate-500">people</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">Set a shift requirement to 0 to disable this task on that shift.</p>

      <div>
        <label className="label">Restrict to employment types · จำกัดประเภทพนักงาน</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TYPE_LIST.map((t) => {
            const on = form.allowedTypes.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleType(t.id)}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 px-2 py-2 text-sm transition ${
                  on ? `${t.badge} font-semibold` : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          {form.allowedTypes.length === 0
            ? 'ไม่เลือก = ทุกประเภททำงานนี้ได้ (no restriction).'
            : `เฉพาะประเภทที่เลือกเท่านั้นที่จะถูกจัดลงงานนี้ (${form.allowedTypes.length} selected).`}
        </p>
      </div>
    </form>
  );
}

function CapacityBar({ shift }) {
  const { config, employees } = useApp();
  const required = config.tasks
    .filter((t) => t.active)
    .reduce((sum, t) => sum + (Number(t.req?.[shift.id]) || 0), 0);
  const available = employees.filter(
    (e) => e.status === EMPLOYEE_STATUS.ACTIVE && e.primaryShift === shift.id
  ).length;
  const ok = available >= required;
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 ${shift.barBorder} ${shift.barBg}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${shift.dot}`} />
        <span className={`text-sm font-semibold ${shift.text}`}>
          {shift.label} · {shift.labelTh}
        </span>
      </div>
      <div className={`flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-slate-600' : 'text-rose-600'}`}>
        {!ok && <AlertTriangle className="h-4 w-4" />}
        <span>
          {available} avail / {required} needed per day
        </span>
      </div>
    </div>
  );
}

export function DutyManager() {
  const { config, addTask, updateTask, removeTask, setWorkingDays, setLookbackWeeks, setExtraRules } = useApp();
  const extraRules = config.extraRules || { minDays: 0, maxDays: null };
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const toggleDay = (iso) => {
    const set = new Set(config.workingDays);
    if (set.has(iso)) set.delete(iso);
    else set.add(iso);
    setWorkingDays([...set].sort((a, b) => a - b));
  };

  const submit = (data) => {
    if (editing) updateTask(editing.id, data);
    else addTask(data);
    setModalOpen(false);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Duties &amp; Shifts · กะและหน้าที่</h2>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add task
        </button>
      </div>

      {/* Capacity */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SHIFT_LIST.map((s) => (
          <CapacityBar key={s.id} shift={s} />
        ))}
      </div>

      {/* Tasks table */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <div className="col-span-5">Task</div>
          <div className="col-span-2 text-center">กะเช้า</div>
          <div className="col-span-2 text-center">กะบ่าย</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>
        {config.tasks.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No tasks configured yet.</p>
        )}
        {config.tasks.map((t) => (
          <div
            key={t.id}
            className={`grid grid-cols-12 items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-0 ${
              t.active ? '' : 'opacity-50'
            }`}
          >
            <div className="col-span-5 flex items-center gap-2.5">
              <TaskDot color={t.color} />
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{t.name}</p>
                {t.nameTh && <p className="truncate text-xs text-slate-500">{t.nameTh}</p>}
                {Array.isArray(t.allowedTypes) && t.allowedTypes.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <Lock className="h-3 w-3 text-slate-400" />
                    {t.allowedTypes.map((id) => (
                      <span key={id} className={`rounded border px-1.5 py-px font-medium ${getType(id).badge}`}>
                        {getType(id).label}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
            <div className="col-span-2 text-center text-sm font-semibold text-amber-700">
              {t.req.morning || <span className="text-slate-300">—</span>}
            </div>
            <div className="col-span-2 text-center text-sm font-semibold text-indigo-700">
              {t.req.afternoon || <span className="text-slate-300">—</span>}
            </div>
            <div className="col-span-3 flex items-center justify-end gap-1">
              <label className="mr-1 inline-flex cursor-pointer items-center" title="Active">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={t.active}
                  onChange={(e) => updateTask(t.id, { active: e.target.checked })}
                />
                <span className="h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500" />
                <span className="-ml-8 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
              </label>
              <button
                className="btn-ghost !p-1.5"
                title="Edit"
                onClick={() => {
                  setEditing(t);
                  setModalOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                className="btn-ghost !p-1.5 text-rose-500"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete task "${t.name}"?`)) removeTask(t.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Working days + lookback */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-700">
            <CalendarDays className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold">Working days · วันทำงาน</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = config.workingDays.includes(d.iso);
              return (
                <button
                  key={d.iso}
                  onClick={() => toggleDay(d.iso)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                  title={d.labelTh}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-700">
            <Users2 className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold">Rotation memory · หน่วยความจำการหมุนเวียน</h3>
          </div>
          <label className="label">Look back over the last</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="12"
              className="input w-24"
              value={config.lookbackWeeks}
              onChange={(e) => setLookbackWeeks(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="text-sm text-slate-500">weeks when avoiding repeats</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            The engine gives priority to duties a person has not done within this window.
          </p>
        </div>
      </div>

      {/* Outsource เสริม weekly rules */}
      <div className="card p-4">
        <div className="mb-1 flex items-center gap-2 text-slate-700">
          <UserCog className="h-4 w-4 text-pink-500" />
          <h3 className="text-sm font-semibold">Outsource เสริม rules · กติกากำลังเสริม</h3>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          กำลังเสริมจะถูกจัดงานเฉพาะเมื่อกำลังหลักไม่พอ — ตั้งค่าจำนวนวันทำงานต่อสัปดาห์ได้ที่นี่
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Minimum days / week · ขั้นต่ำ (วัน)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max={config.workingDays.length}
                className="input w-24"
                value={extraRules.minDays ?? 0}
                onChange={(e) =>
                  setExtraRules({ minDays: Math.max(0, Math.min(config.workingDays.length, Number(e.target.value) || 0)) })
                }
              />
              <span className="text-sm text-slate-500">รับประกันอย่างน้อยกี่วัน (0 = ไม่การันตี)</span>
            </div>
          </div>
          <div>
            <label className="label">Maximum days / week · สูงสุด (วัน)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max={config.workingDays.length}
                placeholder="∞"
                className="input w-24"
                value={extraRules.maxDays ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setExtraRules({
                    maxDays: v === '' ? null : Math.max(0, Math.min(config.workingDays.length, Number(v) || 0)),
                  });
                }}
              />
              <span className="text-sm text-slate-500">เพดานสูงสุด (เว้นว่าง = ไม่จำกัด)</span>
            </div>
          </div>
        </div>
        {extraRules.maxDays != null && (extraRules.minDays ?? 0) > extraRules.maxDays && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" /> ขั้นต่ำมากกว่าสูงสุด — ระบบจะยึดเพดานสูงสุดเป็นหลัก
          </p>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit task' : 'Add task'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" type="submit" form="task-form">
              {editing ? 'Save changes' : 'Add task'}
            </button>
          </>
        }
      >
        <TaskForm initial={editing} onSubmit={submit} />
      </Modal>
    </section>
  );
}
