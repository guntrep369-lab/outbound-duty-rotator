/**
 * @file scheduleUtils.js — pure helpers for manual overrides/swaps on a generated
 * schedule and for recomputing its derived data (records + fairness summary).
 * All functions return NEW objects (immutable-friendly for React state).
 */

import { SHIFTS, EXTRA_ID } from '../data/models.js';
import { buildSummary } from '../engine/rotationEngine.js';

/** Deep-ish clone of a schedule grid (structure is plain JSON). */
export function cloneSchedule(schedule) {
  return JSON.parse(JSON.stringify(schedule));
}

/** Find where an employee sits within a day+shift cell. */
function locate(cell, shift, empId) {
  const res = cell[shift];
  if (!res) return null;
  for (const [dutyId, empIds] of Object.entries(res.assignments || {})) {
    const index = empIds.indexOf(empId);
    if (index !== -1) return { type: 'duty', dutyId, index };
  }
  const sIdx = (res.standby || []).indexOf(empId);
  if (sIdx !== -1) return { type: 'standby', index: sIdx };
  return null;
}

/**
 * Reassign the slot (dayKey, shift, dutyId, index) to `newEmpId`. If that
 * employee is already placed elsewhere in the same day+shift, the two swap.
 * @returns {Object} a new schedule
 */
export function reassignSlot(schedule, dayKey, shift, dutyId, index, newEmpId) {
  const next = cloneSchedule(schedule);
  const cell = next.grid[dayKey];
  if (!cell || !cell[shift]) return next;
  const res = cell[shift];
  const slotArr = res.assignments[dutyId];
  if (!slotArr || index < 0 || index >= slotArr.length) return next;

  const currentEmp = slotArr[index];
  if (currentEmp === newEmpId) return next;

  const from = locate(cell, shift, newEmpId);
  // Place the new employee into the target slot.
  slotArr[index] = newEmpId;

  if (!from) {
    // New employee was not on this shift at all: displaced person goes standby.
    res.standby = [...(res.standby || []), currentEmp];
  } else if (from.type === 'duty') {
    res.assignments[from.dutyId][from.index] = currentEmp; // swap
  } else {
    // New employee came from standby: swap the standby seat with the displaced.
    res.standby[from.index] = currentEmp;
  }
  return next; // caller runs refreshDerived(next, employees, config)
}

/**
 * Fill an (understaffed) duty by adding `empId`, pulling them out of standby or
 * whatever slot they currently occupy in the same day+shift.
 */
export function addToSlot(schedule, dayKey, shift, dutyId, empId) {
  const next = cloneSchedule(schedule);
  const cell = next.grid[dayKey];
  if (!cell || !cell[shift]) return next;
  const res = cell[shift];
  const from = locate(cell, shift, empId);
  if (from?.type === 'duty') res.assignments[from.dutyId].splice(from.index, 1);
  if (from?.type === 'standby') res.standby.splice(from.index, 1);
  if (!res.assignments[dutyId]) res.assignments[dutyId] = [];
  res.assignments[dutyId].push(empId);
  return next;
}

/** Move an assigned employee to standby (rest). */
export function benchEmployee(schedule, dayKey, shift, dutyId, index) {
  const next = cloneSchedule(schedule);
  const res = next.grid[dayKey]?.[shift];
  if (!res) return next;
  const arr = res.assignments[dutyId];
  if (!arr || index < 0 || index >= arr.length) return next;
  const [empId] = arr.splice(index, 1);
  res.standby = [...(res.standby || []), empId];
  return next;
}

/** Recompute records + understaffed flags + summary from the (edited) grid. */
export function refreshDerived(schedule, employees, config) {
  const records = [];
  for (const [dayKey, cell] of Object.entries(schedule.grid)) {
    for (const shift of [SHIFTS.MORNING, SHIFTS.AFTERNOON]) {
      const res = cell[shift];
      if (!res) continue;
      // Recompute understaffed against configured requirements if we have config.
      if (config?.tasks) {
        res.understaffed = [];
        for (const task of config.tasks) {
          if (!task.active) continue;
          const need = Number(task.req?.[shift]) || 0;
          if (need <= 0) continue;
          const got = (res.assignments[task.id] || []).length;
          if (got < need) res.understaffed.push({ dutyId: task.id, needed: need, got });
        }
      }
      for (const [dutyId, empIds] of Object.entries(res.assignments || {})) {
        for (const employeeId of empIds) {
          if (employeeId === EXTRA_ID) continue; // anonymous เสริม not tracked in history
          records.push({
            id: `${schedule.weekKey}:${dayKey}:${shift}:${dutyId}:${employeeId}`,
            weekKey: schedule.weekKey,
            year: schedule.year,
            week: schedule.week,
            dayKey,
            date: cell.date,
            shift,
            dutyId,
            employeeId,
          });
        }
      }
    }
  }
  schedule.records = records;
  if (employees && config) {
    schedule.summary = buildSummary({
      grid: schedule.grid,
      workingDays: schedule.workingDays,
      employees,
      config,
    });
  }
  return schedule;
}
