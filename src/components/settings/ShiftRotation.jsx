import React, { useMemo, useState } from 'react';
import { Repeat, Plus, Pencil, Trash2, ArrowLeftRight, CalendarClock } from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import {
  SHIFTS,
  SHIFT_LIST,
  EMPLOYEE_STATUS,
  isSwapEligible,
  effectiveShiftOn,
  getShift,
} from '../../data/models.js';
import { Modal } from '../ui/Modal.jsx';
import { ShiftPreview } from './ShiftPreview.jsx';

const pad = (n) => String(n).padStart(2, '0');
function todayYmd() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function fmtThai(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Date-based shift rotation (สลับกะ): the supervisor defines rotation "rounds",
 * each effective from a chosen date (mid-week is fine). Only inhouse +
 * outsource ประจำ swap; เสริม always keep their primary shift.
 */
export function ShiftRotation() {
  const { employees, shiftRotations, addShiftRound, updateShiftRound, removeShiftRound } = useApp();
  const [editor, setEditor] = useState(null); // { id?, effectiveFrom, shifts }

  const people = useMemo(
    () =>
      employees
        .filter((e) => e.status === EMPLOYEE_STATUS.ACTIVE && isSwapEligible(e))
        .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name, 'th')),
    [employees]
  );

  const today = todayYmd();
  // The round in effect right now (latest with effectiveFrom <= today).
  const currentRound = useMemo(() => {
    let best = null;
    for (const r of shiftRotations) {
      if (r.effectiveFrom && r.effectiveFrom <= today && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
    }
    return best;
  }, [shiftRotations, today]);

  const countFor = (round) => {
    const c = { morning: 0, afternoon: 0 };
    for (const e of people) {
      const s = round.shifts?.[e.id] || e.primaryShift;
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  };

  // Build the editor draft with a full snapshot for every swap-eligible person.
  const openNew = () => {
    const date = today;
    const shifts = {};
    for (const e of people) shifts[e.id] = effectiveShiftOn(e, date, shiftRotations);
    setEditor({ effectiveFrom: date, shifts });
  };
  const openEdit = (round) => {
    const shifts = {};
    for (const e of people) shifts[e.id] = round.shifts?.[e.id] || e.primaryShift;
    setEditor({ id: round.id, effectiveFrom: round.effectiveFrom, shifts });
  };

  const setDraftShift = (empId, shift) =>
    setEditor((d) => ({ ...d, shifts: { ...d.shifts, [empId]: shift } }));
  const swapAllDraft = () =>
    setEditor((d) => {
      const shifts = {};
      for (const e of people) {
        const cur = d.shifts[e.id] || e.primaryShift;
        shifts[e.id] = cur === SHIFTS.MORNING ? SHIFTS.AFTERNOON : SHIFTS.MORNING;
      }
      return { ...d, shifts };
    });

  const save = () => {
    if (!editor.effectiveFrom) return;
    if (editor.id) updateShiftRound(editor.id, { effectiveFrom: editor.effectiveFrom, shifts: editor.shifts });
    else addShiftRound(editor.effectiveFrom, editor.shifts);
    setEditor(null);
  };

  const draftCounts = editor
    ? people.reduce(
        (c, e) => {
          const s = editor.shifts[e.id] || e.primaryShift;
          c[s] += 1;
          return c;
        },
        { morning: 0, afternoon: 0 }
      )
    : null;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <Repeat className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">สลับกะ · Shift Rotation</h2>
        </div>
        <button className="btn-primary" onClick={openNew} disabled={people.length === 0}>
          <Plus className="h-4 w-4" /> เพิ่มรอบสลับกะ
        </button>
      </div>

      <p className="text-xs text-slate-400">
        กำหนด “รอบสลับกะ” โดยระบุ<b>วันที่เริ่มใช้กะใหม่</b> (เปลี่ยนกลางสัปดาห์ได้). ระบบจะใช้กะตามรอบล่าสุดที่มีผล ณ วันนั้น
        เฉพาะ inhouse + outsource ประจำ (เสริมไม่สลับ).
      </p>

      {/* Rounds timeline */}
      {shiftRotations.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 py-10 text-slate-400">
          <CalendarClock className="h-8 w-8" />
          <p className="text-sm">ยังไม่มีรอบสลับกะ — ทุกคนใช้กะหลัก (primary)</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shiftRotations.map((r) => {
            const c = countFor(r);
            const isCurrent = currentRound && currentRound.id === r.id;
            const upcoming = r.effectiveFrom > today;
            return (
              <li key={r.id} className={`card flex flex-wrap items-center gap-3 p-3.5 ${isCurrent ? 'ring-2 ring-indigo-400' : ''}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">
                    ตั้งแต่ {fmtThai(r.effectiveFrom)}
                    {isCurrent && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">ใช้อยู่ตอนนี้</span>}
                    {upcoming && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">กำลังจะถึง</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    กะเช้า {c.morning} · กะบ่าย {c.afternoon}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost !p-1.5" title="แก้ไข" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="btn-ghost !p-1.5 text-rose-500"
                    title="ลบ"
                    onClick={() => {
                      if (window.confirm(`ลบรอบสลับกะที่เริ่ม ${r.effectiveFrom}?`)) removeShiftRound(r.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Forward-looking preview of the resulting shift schedule */}
      <ShiftPreview />

      {/* Editor modal */}
      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? 'แก้ไขรอบสลับกะ' : 'เพิ่มรอบสลับกะ'}
        maxWidth="max-w-lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditor(null)}>
              ยกเลิก
            </button>
            <button className="btn-primary" onClick={save} disabled={!editor?.effectiveFrom}>
              บันทึก
            </button>
          </>
        }
      >
        {editor && (
          <div className="space-y-4">
            <div>
              <label className="label">วันที่เริ่มใช้กะนี้ (effective from)</label>
              <input
                type="date"
                className="input"
                value={editor.effectiveFrom}
                onChange={(e) => setEditor((d) => ({ ...d, effectiveFrom: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate-400">กะชุดนี้จะมีผลตั้งแต่วันนี้เป็นต้นไป จนกว่าจะมีรอบใหม่</p>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-500">
                กะเช้า <b className="text-amber-700">{draftCounts.morning}</b> · กะบ่าย{' '}
                <b className="text-indigo-700">{draftCounts.afternoon}</b>
              </div>
              <button className="btn-secondary !py-1.5 text-xs" onClick={swapAllDraft}>
                <ArrowLeftRight className="h-3.5 w-3.5" /> สลับทั้งหมด
              </button>
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {people.map((emp) => {
                const cur = editor.shifts[emp.id] || emp.primaryShift;
                const swapped = cur !== emp.primaryShift;
                return (
                  <div key={emp.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800">{emp.nickname || emp.name}</span>
                      <span className="ml-1.5 text-xs text-slate-400">
                        (กะหลัก {getShift(emp.primaryShift).labelTh}){swapped && <span className="ml-1 text-indigo-600">·สลับ</span>}
                      </span>
                    </div>
                    <div className="flex overflow-hidden rounded-lg border border-slate-200">
                      {SHIFT_LIST.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setDraftShift(emp.id, s.id)}
                          className={`px-3 py-1 text-xs font-semibold transition ${
                            cur === s.id ? `${s.dot} text-white` : 'bg-white text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {s.labelTh}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
