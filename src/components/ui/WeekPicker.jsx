import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isoWeekMonday, getISOWeek, datesOfISOWeek, formatShort, weekKey } from '../../utils/dateUtils.js';

/** Compact ISO week selector with prev/next and a readable date range. */
export function WeekPicker({ year, week, onChange }) {
  const shift = (deltaWeeks) => {
    const mon = isoWeekMonday(year, week);
    mon.setUTCDate(mon.getUTCDate() + deltaWeeks * 7);
    const w = getISOWeek(mon);
    onChange(w.year, w.week);
  };

  const dates = datesOfISOWeek(year, week);
  const range = `${formatShort(dates[0].date)} – ${formatShort(dates[6].date)}`;

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary !px-2" onClick={() => shift(-1)} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5">
        <div className="text-center">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-slate-400">Week</span>
            <input
              type="number"
              min="1"
              max="53"
              value={week}
              onChange={(e) => onChange(year, Math.min(53, Math.max(1, Number(e.target.value) || 1)))}
              className="w-12 border-0 p-0 text-lg font-bold text-slate-800 focus:outline-none focus:ring-0"
            />
            <span className="text-slate-300">/</span>
            <input
              type="number"
              value={year}
              onChange={(e) => onChange(Number(e.target.value) || year, week)}
              className="w-16 border-0 p-0 text-lg font-bold text-slate-800 focus:outline-none focus:ring-0"
            />
          </div>
          <div className="text-xs text-slate-500">
            {weekKey(year, week)} · {range}
          </div>
        </div>
      </div>

      <button className="btn-secondary !px-2" onClick={() => shift(1)} aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
