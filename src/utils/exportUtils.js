/**
 * @file exportUtils.js — turn a generated schedule into CSV / plain-text summary,
 * plus small browser helpers for downloading and copying.
 */

import { SHIFTS, getShift, WEEKDAYS, isExtraId } from '../data/models.js';

const CSV_MIME = 'text/csv;charset=utf-8;';

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function empLabel(emp) {
  if (!emp) return '(unknown)';
  return emp.nickname ? `${emp.nickname}` : emp.name;
}

/** Resolve a chip id to a label, including anonymous เสริม placeholders. */
function idLabel(id, getEmployee) {
  return isExtraId(id) ? 'เสริม' : empLabel(getEmployee(id));
}

/** Ordered day cells that actually exist in the schedule grid. */
function orderedDays(schedule) {
  return WEEKDAYS.filter((d) => schedule.grid[d.key]).map((d) => ({
    ...d,
    cell: schedule.grid[d.key],
  }));
}

/**
 * @param {object} schedule
 * @param {{getEmployee:(id:string)=>any, getTask:(id:string)=>any}} lookups
 */
export function scheduleToCSV(schedule, { getEmployee, getTask }) {
  const rows = [['Day', 'Date', 'Shift', 'Task', 'Required', 'Assigned', 'Employees']];
  for (const day of orderedDays(schedule)) {
    for (const shiftId of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = day.cell[shiftId];
      if (!res) continue;
      const shift = getShift(shiftId);
      for (const [dutyId, empIds] of Object.entries(res.assignments || {})) {
        const task = getTask(dutyId);
        const under = (res.understaffed || []).find((u) => u.dutyId === dutyId);
        rows.push([
          day.label,
          day.cell.date,
          shift.label,
          task ? task.name : dutyId,
          under ? under.needed : empIds.length,
          empIds.length,
          empIds.map((id) => idLabel(id, getEmployee)).join(', '),
        ]);
      }
      if ((res.standby || []).length) {
        rows.push([
          day.label,
          day.cell.date,
          shift.label,
          'Standby / Rest',
          '',
          res.standby.length,
          res.standby.map((id) => empLabel(getEmployee(id))).join(', '),
        ]);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Human-readable text summary suitable for pasting into chat/LINE. */
export function scheduleToText(schedule, { getEmployee, getTask }) {
  const lines = [`📦 Outbound Duty Roster — ${schedule.weekKey}`, ''];
  for (const day of orderedDays(schedule)) {
    lines.push(`▶ ${day.label} (${day.cell.date})`);
    for (const shiftId of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = day.cell[shiftId];
      if (!res) continue;
      const shift = getShift(shiftId);
      lines.push(`  ${shift.short} ${shift.label} / ${shift.labelTh}`);
      for (const [dutyId, empIds] of Object.entries(res.assignments || {})) {
        if (!empIds.length) continue;
        const task = getTask(dutyId);
        lines.push(
          `    • ${task ? task.name : dutyId}: ${empIds
            .map((id) => idLabel(id, getEmployee))
            .join(', ')}`
        );
      }
      if ((res.standby || []).length) {
        lines.push(
          `    • Standby: ${res.standby.map((id) => empLabel(getEmployee(id))).join(', ')}`
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** Trigger a client-side file download. */
export function downloadFile(filename, content, mime = CSV_MIME) {
  const blob = new Blob(['﻿' + content], { type: mime }); // BOM → Excel reads Thai correctly
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Copy text to clipboard with a legacy fallback. Returns a promise<boolean>. */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
