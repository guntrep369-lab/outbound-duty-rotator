import React from 'react';
import { getShift, getStatus } from '../../data/models.js';

/** Coloured badge marking the Morning / Afternoon shift. */
export function ShiftBadge({ shiftId, showTh = true, className = '' }) {
  const s = getShift(shiftId);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.badge} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {showTh && <span className="font-normal opacity-80">· {s.labelTh}</span>}
    </span>
  );
}

/** Status pill: Active / On Leave / Resigned. */
export function StatusBadge({ status, showTh = true, className = '' }) {
  const s = getStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.badge} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {showTh && <span className="font-normal opacity-80">· {s.labelTh}</span>}
    </span>
  );
}

/** Small coloured dot used next to a task name. */
export function TaskDot({ color, className = '' }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`}
      style={{ backgroundColor: color || '#94a3b8' }}
    />
  );
}
