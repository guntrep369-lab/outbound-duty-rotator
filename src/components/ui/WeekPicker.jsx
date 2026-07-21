import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, CalendarDays } from 'lucide-react';
import {
  isoWeekMonday,
  getISOWeek,
  datesOfISOWeek,
  formatShort,
  weekKey,
  currentWeek,
} from '../../utils/dateUtils.js';
import { WEEKDAYS } from '../../data/models.js';

/**
 * ISO week selector: prev/next arrows, a clearly-readable "Week N · YYYY"
 * display, and a click-to-pick month calendar popover (click any week row/day
 * to jump straight to that week — no repeated nudging).
 */
export function WeekPicker({ year, week, onChange }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const mon = isoWeekMonday(year, week);
    return { y: mon.getUTCFullYear(), m: mon.getUTCMonth() };
  });

  // Re-centre the popover on the selected week each time it opens.
  useEffect(() => {
    if (open) {
      const mon = isoWeekMonday(year, week);
      setView({ y: mon.getUTCFullYear(), m: mon.getUTCMonth() });
    }
  }, [open, year, week]);

  const shift = (deltaWeeks) => {
    const mon = isoWeekMonday(year, week);
    mon.setUTCDate(mon.getUTCDate() + deltaWeeks * 7);
    const w = getISOWeek(mon);
    onChange(w.year, w.week);
  };
  const shiftMonth = (delta) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  const dates = datesOfISOWeek(year, week);
  const range = `${formatShort(dates[0].date)} – ${formatShort(dates[6].date)}`;
  const now = currentWeek();

  // Six Monday-first week rows covering the viewed month.
  const rows = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const firstIso = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
    const start = new Date(first);
    start.setUTCDate(1 - (firstIso - 1));
    return Array.from({ length: 6 }, (_, w) => {
      const mon = new Date(start);
      mon.setUTCDate(start.getUTCDate() + w * 7);
      const iso = getISOWeek(mon);
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon);
        d.setUTCDate(mon.getUTCDate() + i);
        return d;
      });
      return { iso, days, key: `${iso.year}-${iso.week}` };
    });
  }, [view]);

  const monthLabel = new Date(Date.UTC(view.y, view.m, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const pick = (iso) => {
    onChange(iso.year, iso.week);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary !px-2" onClick={() => shift(-1)} aria-label="สัปดาห์ก่อน">
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left hover:border-indigo-400"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-indigo-500" />
          <span className="leading-tight">
            <span className="block text-sm font-bold text-slate-800">
              Week {week} · {year}
            </span>
            <span className="block text-xs text-slate-500">
              {weekKey(year, week)} · {range}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <>
            {/* click-away backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <button className="btn-ghost !p-1.5" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อน">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-slate-800">{monthLabel}</span>
                <button className="btn-ghost !p-1.5" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-[1.75rem_repeat(7,1fr)] gap-0.5 pb-1 text-center text-[10px] font-semibold text-slate-400">
                <div>Wk</div>
                {WEEKDAYS.map((d) => (
                  <div key={d.iso}>{d.label.charAt(0)}</div>
                ))}
              </div>

              <div className="space-y-0.5">
                {rows.map((row) => {
                  const selected = row.iso.year === year && row.iso.week === week;
                  const isNow = row.iso.year === now.year && row.iso.week === now.week;
                  return (
                    <button
                      key={row.key}
                      onClick={() => pick(row.iso)}
                      title={`เลือกสัปดาห์ ${weekKey(row.iso.year, row.iso.week)}`}
                      className={`grid w-full grid-cols-[1.75rem_repeat(7,1fr)] items-center gap-0.5 rounded-lg px-0.5 py-0.5 text-center text-xs transition ${
                        selected
                          ? 'bg-indigo-600 text-white'
                          : `text-slate-600 hover:bg-indigo-50 ${isNow ? 'ring-1 ring-inset ring-indigo-300' : ''}`
                      }`}
                    >
                      <span className={`text-[10px] font-bold ${selected ? 'text-white' : 'text-indigo-500'}`}>
                        {row.iso.week}
                      </span>
                      {row.days.map((d, i) => {
                        const inMonth = d.getUTCMonth() === view.m;
                        return (
                          <span
                            key={i}
                            className={`py-0.5 ${selected ? '' : inMonth ? '' : 'text-slate-300'}`}
                          >
                            {d.getUTCDate()}
                          </span>
                        );
                      })}
                    </button>
                  );
                })}
              </div>

              <button
                className="mt-2 w-full rounded-lg bg-slate-100 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                onClick={() => {
                  onChange(now.year, now.week);
                  setOpen(false);
                }}
              >
                ไปสัปดาห์นี้ · This week
              </button>
            </div>
          </>
        )}
      </div>

      <button className="btn-secondary !px-2" onClick={() => shift(1)} aria-label="สัปดาห์ถัดไป">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
