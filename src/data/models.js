/**
 * @file Data models, enums, and factory helpers for the Outbound Duty Rotator.
 * Plain JavaScript with JSDoc typedefs for editor intellisense without a build step.
 */

/** Shift identifiers. */
export const SHIFTS = {
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
};

/** Ordered list of shifts, with bilingual labels and Tailwind accent classes. */
export const SHIFT_LIST = [
  {
    id: SHIFTS.MORNING,
    label: 'Morning Shift',
    labelTh: 'กะเช้า',
    short: 'AM',
    // color tokens used across badges / borders
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    ring: 'ring-amber-400',
    barBg: 'bg-amber-50',
    barBorder: 'border-amber-200',
    text: 'text-amber-700',
  },
  {
    id: SHIFTS.AFTERNOON,
    label: 'Afternoon Shift',
    labelTh: 'กะบ่าย',
    short: 'PM',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    dot: 'bg-indigo-500',
    ring: 'ring-indigo-400',
    barBg: 'bg-indigo-50',
    barBorder: 'border-indigo-200',
    text: 'text-indigo-700',
  },
];

/** Lookup a shift descriptor by id. */
export function getShift(shiftId) {
  return SHIFT_LIST.find((s) => s.id === shiftId) || SHIFT_LIST[0];
}

/** Employee lifecycle status. */
export const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  ON_LEAVE: 'on_leave',
  RESIGNED: 'resigned',
};

export const STATUS_LIST = [
  {
    id: EMPLOYEE_STATUS.ACTIVE,
    label: 'Active',
    labelTh: 'ทำงานปกติ',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500',
    // eligible for the rotation engine
    eligible: true,
  },
  {
    id: EMPLOYEE_STATUS.ON_LEAVE,
    label: 'On Leave',
    labelTh: 'ลา / หยุด',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    eligible: false,
  },
  {
    id: EMPLOYEE_STATUS.RESIGNED,
    label: 'Resigned',
    labelTh: 'ลาออก / เก็บถาวร',
    badge: 'bg-slate-200 text-slate-600 border-slate-300',
    dot: 'bg-slate-400',
    eligible: false,
  },
];

export function getStatus(statusId) {
  return STATUS_LIST.find((s) => s.id === statusId) || STATUS_LIST[0];
}

/** Employment type (ประเภทพนักงาน). */
export const EMPLOYEE_TYPES = {
  INHOUSE: 'inhouse',
  OUTSOURCE_REGULAR: 'outsource_regular',
  OUTSOURCE_EXTRA: 'outsource_extra',
};

export const TYPE_LIST = [
  {
    id: EMPLOYEE_TYPES.INHOUSE,
    label: 'Inhouse',
    labelTh: 'พนักงานบริษัท',
    short: 'IH',
    badge: 'bg-sky-100 text-sky-800 border-sky-300',
    dot: 'bg-sky-500',
  },
  {
    id: EMPLOYEE_TYPES.OUTSOURCE_REGULAR,
    label: 'Outsource ประจำ',
    labelTh: 'outsource ประจำ',
    short: 'OS',
    badge: 'bg-violet-100 text-violet-800 border-violet-300',
    dot: 'bg-violet-500',
  },
  {
    id: EMPLOYEE_TYPES.OUTSOURCE_EXTRA,
    label: 'Outsource เสริม',
    labelTh: 'outsource เสริม',
    short: 'OS+',
    badge: 'bg-pink-100 text-pink-800 border-pink-300',
    dot: 'bg-pink-500',
  },
];

/** Lookup an employment-type descriptor; missing/legacy data counts as Inhouse. */
export function getType(typeId) {
  return TYPE_LIST.find((t) => t.id === typeId) || TYPE_LIST[0];
}

/** Leave categories (ประเภทวันลา). */
export const LEAVE_TYPES = [
  {
    id: 'vacation',
    label: 'พักร้อน',
    labelEn: 'Vacation',
    color: '#0ea5e9',
    badge: 'bg-sky-100 text-sky-800 border-sky-300',
    dot: 'bg-sky-500',
    emoji: '🌴',
  },
  {
    id: 'sick',
    label: 'ลาป่วย',
    labelEn: 'Sick',
    color: '#f43f5e',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    dot: 'bg-rose-500',
    emoji: '🤒',
  },
  {
    id: 'personal',
    label: 'ลากิจ',
    labelEn: 'Personal',
    color: '#f59e0b',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
    emoji: '📋',
  },
];

export function getLeaveType(id) {
  return LEAVE_TYPES.find((t) => t.id === id) || LEAVE_TYPES[0];
}

/** Special sentinel duty id used when an eligible employee is not assigned a task. */
export const STANDBY = 'standby';

/**
 * Default Outbound tasks. `req` = required head-count per shift.
 * Users can edit these, add more, or set a requirement to 0 to disable a task on a shift.
 */
export const DEFAULT_TASKS = [
  { id: 'pick_mattress', name: 'Pick Mattress', nameTh: 'Pick ที่นอน', color: '#0ea5e9', req: { morning: 2, afternoon: 2 }, active: true },
  { id: 'pick_small', name: 'Pick Small', nameTh: 'Pick ชิ้นเล็ก', color: '#8b5cf6', req: { morning: 2, afternoon: 2 }, active: true },
  { id: 'qc_mattress', name: 'QC Mattress', nameTh: 'QC ที่นอน', color: '#f43f5e', req: { morning: 1, afternoon: 1 }, active: true, allowedTypes: [EMPLOYEE_TYPES.INHOUSE] },
  { id: 'pack_small', name: 'Pack Small', nameTh: 'Pack ชิ้นเล็ก', color: '#10b981', req: { morning: 2, afternoon: 2 }, active: true },
  { id: 'pack_mattress', name: 'Pack Mattress', nameTh: 'Pack ที่นอน', color: '#f59e0b', req: { morning: 2, afternoon: 2 }, active: true },
];

/** ISO weekday numbers (Mon=1 … Sun=7) with labels. */
export const WEEKDAYS = [
  { iso: 1, key: 'mon', label: 'Mon', labelTh: 'จันทร์' },
  { iso: 2, key: 'tue', label: 'Tue', labelTh: 'อังคาร' },
  { iso: 3, key: 'wed', label: 'Wed', labelTh: 'พุธ' },
  { iso: 4, key: 'thu', label: 'Thu', labelTh: 'พฤหัสบดี' },
  { iso: 5, key: 'fri', label: 'Fri', labelTh: 'ศุกร์' },
  { iso: 6, key: 'sat', label: 'Sat', labelTh: 'เสาร์' },
  { iso: 7, key: 'sun', label: 'Sun', labelTh: 'อาทิตย์' },
];

/** Default duty configuration document. */
export function defaultDutyConfig() {
  return {
    tasks: DEFAULT_TASKS.map((t) => makeTask(t)),
    workingDays: [1, 2, 3, 4, 5], // Mon–Fri
    lookbackWeeks: 4,
    // Weekly rules for outsource เสริม (surge staff):
    // minDays = guaranteed working days; maxDays = cap (null = unlimited).
    extraRules: { minDays: 0, maxDays: null },
    // When true, the weekly Surge Plan caps how many เสริม are scheduled per day.
    useSurgePlan: false,
  };
}

/** A short, collision-resistant id. */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @typedef {Object} Employee
 * @property {string} id
 * @property {string} name
 * @property {string} nickname
 * @property {'morning'|'afternoon'} primaryShift
 * @property {'active'|'on_leave'|'resigned'} status
 * @property {'inhouse'|'outsource_regular'|'outsource_extra'} type
 * @property {string|null} fixedDutyId  If set, always work this one task (no rotation).
 * @property {number[]} weeklyOffDays   Recurring days off (ISO 1-7); empty = none.
 * @property {Leave[]} leaves           Dated leave/vacation ranges.
 * @property {string} [createdAt]
 */

/**
 * @typedef {Object} Leave
 * @property {string} id
 * @property {string} start  ISO date "YYYY-MM-DD"
 * @property {string} end    ISO date "YYYY-MM-DD" (inclusive)
 * @property {'vacation'|'sick'|'personal'} type
 * @property {string} note
 */

/** @returns {Leave} */
export function makeLeave(partial = {}) {
  const start = partial.start || '';
  return {
    id: partial.id || uid('lv'),
    start,
    end: partial.end || start,
    type: partial.type || 'vacation',
    note: partial.note || '',
  };
}

/** @returns {Employee} */
export function makeEmployee(partial = {}) {
  return {
    id: partial.id || uid('emp'),
    name: partial.name || '',
    nickname: partial.nickname || '',
    primaryShift: partial.primaryShift || SHIFTS.MORNING,
    status: partial.status || EMPLOYEE_STATUS.ACTIVE,
    type: partial.type || EMPLOYEE_TYPES.INHOUSE,
    // Pin a specialist to a single duty (e.g. an outsource เสริม who only does
    // Pick). null/empty = rotate normally across duties.
    fixedDutyId: partial.fixedDutyId || null,
    // Recurring weekly day(s) off (ISO weekday numbers, Mon=1 … Sun=7).
    weeklyOffDays: Array.isArray(partial.weeklyOffDays)
      ? partial.weeklyOffDays.filter((d) => d >= 1 && d <= 7)
      : [],
    // Dated leave ranges (vacation / sick / personal).
    leaves: Array.isArray(partial.leaves) ? partial.leaves.map(makeLeave) : [],
    createdAt: partial.createdAt || new Date().toISOString(),
  };
}

/** True if the ISO weekday is one of the employee's recurring days off. */
export function isDayOff(emp, iso) {
  return Array.isArray(emp?.weeklyOffDays) && emp.weeklyOffDays.includes(iso);
}

/** Return the leave record covering `ymd` for this employee, or null. */
export function leaveOn(emp, ymd) {
  if (!Array.isArray(emp?.leaves)) return null;
  return emp.leaves.find((l) => l.start && l.end && l.start <= ymd && ymd <= l.end) || null;
}

/**
 * Is the employee available to be scheduled on a given calendar day?
 * (Ignores employment status — the engine already filters that separately.)
 * @param {Employee} emp
 * @param {string} ymd  "YYYY-MM-DD"
 * @param {number} iso  ISO weekday 1-7
 */
export function isAvailableOn(emp, ymd, iso) {
  return !isDayOff(emp, iso) && !leaveOn(emp, ymd);
}

/** Why an employee is unavailable on a day, or null if available. */
export function unavailabilityOn(emp, ymd, iso) {
  const leave = leaveOn(emp, ymd);
  if (leave) return { kind: 'leave', leaveType: leave.type, note: leave.note };
  if (isDayOff(emp, iso)) return { kind: 'off' };
  return null;
}

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} name
 * @property {string} nameTh
 * @property {string} color
 * @property {{morning:number, afternoon:number}} req
 * @property {boolean} active
 * @property {string[]} allowedTypes  Employment types allowed; empty = all types.
 */

const VALID_TYPE_IDS = new Set(Object.values(EMPLOYEE_TYPES));

/** @returns {Task} */
export function makeTask(partial = {}) {
  const allowed = Array.isArray(partial.allowedTypes)
    ? partial.allowedTypes.filter((t) => VALID_TYPE_IDS.has(t))
    : [];
  return {
    id: partial.id || uid('task'),
    name: partial.name || '',
    nameTh: partial.nameTh || '',
    color: partial.color || '#64748b',
    req: {
      morning: Number(partial.req?.morning ?? 1),
      afternoon: Number(partial.req?.afternoon ?? 1),
    },
    active: partial.active !== false,
    // Empty array means "any employment type". A non-empty list restricts the
    // task to only those types (e.g. QC ที่นอน → inhouse only).
    allowedTypes: allowed,
  };
}

/** Does an employee's type satisfy a task's allowedTypes restriction? */
export function taskAllowsType(task, employeeType) {
  const allowed = task?.allowedTypes;
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(employeeType || EMPLOYEE_TYPES.INHOUSE);
}

/**
 * A ready-made sample team so the app is explorable on first run without any
 * data entry. Names are illustrative Thai nicknames.
 * @returns {Employee[]}
 */
export function demoEmployees() {
  // Sized to roughly match the default task requirements (Morning ≈ 11/day,
  // Afternoon ≈ 9/day) so a fresh demo fills the grid with a little standby.
  const IH = EMPLOYEE_TYPES.INHOUSE;
  const OS = EMPLOYEE_TYPES.OUTSOURCE_REGULAR;
  const OX = EMPLOYEE_TYPES.OUTSOURCE_EXTRA;
  const raw = [
    // Morning (12): 6 inhouse, 4 outsource ประจำ, 2 outsource เสริม
    ['สมชาย ใจดี', 'ชาย', SHIFTS.MORNING, IH],
    ['สมหญิง รักงาน', 'หญิง', SHIFTS.MORNING, IH],
    ['อนุชา ขยัน', 'นุ', SHIFTS.MORNING, IH],
    ['ปรียา ตั้งใจ', 'ปุ๊ก', SHIFTS.MORNING, IH],
    ['วีระ มานะ', 'ต้น', SHIFTS.MORNING, IH],
    ['กมล สุขใจ', 'กล', SHIFTS.MORNING, IH],
    ['ธนา ทองดี', 'นา', SHIFTS.MORNING, OS],
    ['ศิริพร ยิ้มแย้ม', 'พร', SHIFTS.MORNING, OS],
    ['วิชัย ตรงเวลา', 'ชัย', SHIFTS.MORNING, OS],
    ['กนกพร ใจเย็น', 'นก', SHIFTS.MORNING, OS],
    ['ประเสริฐ ทำดี', 'เสริฐ', SHIFTS.MORNING, OX],
    ['อารีย์ เอื้อเฟื้อ', 'รี', SHIFTS.MORNING, OX],
    // Afternoon (10): 5 inhouse, 3 outsource ประจำ, 2 outsource เสริม
    ['ณัฐพล เก่งกล้า', 'พล', SHIFTS.AFTERNOON, IH],
    ['สุดา อ่อนหวาน', 'ดา', SHIFTS.AFTERNOON, IH],
    ['ชัยวัฒน์ ทรงพล', 'ตุ้ย', SHIFTS.AFTERNOON, IH],
    ['เมธี คิดไว', 'ธี', SHIFTS.AFTERNOON, IH],
    ['พิมพ์ใจ งามงด', 'พิม', SHIFTS.AFTERNOON, IH],
    ['รัตนา เพียรดี', 'นา2', SHIFTS.AFTERNOON, OS],
    ['ภูวดล แข็งแรง', 'ภู', SHIFTS.AFTERNOON, OS],
    ['จิราพร สดใส', 'จิ', SHIFTS.AFTERNOON, OS],
    ['สมศักดิ์ อดทน', 'ศักดิ์', SHIFTS.AFTERNOON, OX],
    ['เบญจา ว่องไว', 'เบน', SHIFTS.AFTERNOON, OX],
  ];
  const team = raw.map(([name, nickname, primaryShift, type]) =>
    makeEmployee({ name, nickname, primaryShift, type, status: EMPLOYEE_STATUS.ACTIVE })
  );
  // Showcase "fixed position": pin the surge (เสริม) specialists to a Pick station
  // so they always work Pick instead of rotating through every duty.
  const pin = (nickname, dutyId) => {
    const e = team.find((x) => x.nickname === nickname);
    if (e) e.fixedDutyId = dutyId;
  };
  pin('เสริฐ', 'pick_small');
  pin('รี', 'pick_mattress');
  pin('ศักดิ์', 'pick_small');
  pin('เบน', 'pick_mattress');

  // Showcase weekly day-off (staggered so coverage holds) …
  const off = (nickname, ...isos) => {
    const e = team.find((x) => x.nickname === nickname);
    if (e) e.weeklyOffDays = isos;
  };
  off('ชาย', 1); // จันทร์
  off('นุ', 3); // พุธ
  off('ต้น', 5); // ศุกร์
  off('พล', 2); // อังคาร
  off('ดา', 4); // พฤหัส

  // … and a couple of sample leaves near the demo week (2026-W30).
  const addLeave = (nickname, start, end, type, note) => {
    const e = team.find((x) => x.nickname === nickname);
    if (e) e.leaves.push(makeLeave({ start, end, type, note }));
  };
  addLeave('ปุ๊ก', '2026-07-22', '2026-07-24', 'vacation', 'พาครอบครัวเที่ยว');
  addLeave('จิ', '2026-07-21', '2026-07-21', 'sick', '');
  return team;
}

/**
 * @typedef {Object} HistoryRecord  A single (day, shift, duty) → employee assignment.
 * @property {string} id
 * @property {string} weekKey      e.g. "2026-W30"
 * @property {number} year
 * @property {number} week
 * @property {string} dayKey       e.g. "mon"
 * @property {string} date         ISO date "2026-07-20"
 * @property {'morning'|'afternoon'} shift
 * @property {string} dutyId
 * @property {string} employeeId
 */
