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

/** Special sentinel duty id used when an eligible employee is not assigned a task. */
export const STANDBY = 'standby';

/**
 * Default Outbound tasks. `req` = required head-count per shift.
 * Users can edit these, add more, or set a requirement to 0 to disable a task on a shift.
 */
export const DEFAULT_TASKS = [
  { id: 'pick_mattress', name: 'Pick Mattress', nameTh: 'Pick ที่นอน', color: '#0ea5e9', req: { morning: 2, afternoon: 2 }, active: true },
  { id: 'pick_small', name: 'Pick Small', nameTh: 'Pick ชิ้นเล็ก', color: '#8b5cf6', req: { morning: 2, afternoon: 2 }, active: true },
  { id: 'qc_mattress', name: 'QC Mattress', nameTh: 'QC ที่นอน', color: '#f43f5e', req: { morning: 1, afternoon: 1 }, active: true },
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
    tasks: DEFAULT_TASKS.map((t) => ({ ...t, req: { ...t.req } })),
    workingDays: [1, 2, 3, 4, 5], // Mon–Fri
    lookbackWeeks: 4,
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
 * @property {string} [createdAt]
 */

/** @returns {Employee} */
export function makeEmployee(partial = {}) {
  return {
    id: partial.id || uid('emp'),
    name: partial.name || '',
    nickname: partial.nickname || '',
    primaryShift: partial.primaryShift || SHIFTS.MORNING,
    status: partial.status || EMPLOYEE_STATUS.ACTIVE,
    createdAt: partial.createdAt || new Date().toISOString(),
  };
}

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} name
 * @property {string} nameTh
 * @property {string} color
 * @property {{morning:number, afternoon:number}} req
 * @property {boolean} active
 */

/** @returns {Task} */
export function makeTask(partial = {}) {
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
  };
}

/**
 * A ready-made sample team so the app is explorable on first run without any
 * data entry. Names are illustrative Thai nicknames.
 * @returns {Employee[]}
 */
export function demoEmployees() {
  // Sized to roughly match the default task requirements (Morning ≈ 11/day,
  // Afternoon ≈ 9/day) so a fresh demo fills the grid with a little standby.
  const raw = [
    // Morning (12)
    ['สมชาย ใจดี', 'ชาย', SHIFTS.MORNING],
    ['สมหญิง รักงาน', 'หญิง', SHIFTS.MORNING],
    ['อนุชา ขยัน', 'นุ', SHIFTS.MORNING],
    ['ปรียา ตั้งใจ', 'ปุ๊ก', SHIFTS.MORNING],
    ['วีระ มานะ', 'ต้น', SHIFTS.MORNING],
    ['กมล สุขใจ', 'กล', SHIFTS.MORNING],
    ['ธนา ทองดี', 'นา', SHIFTS.MORNING],
    ['ศิริพร ยิ้มแย้ม', 'พร', SHIFTS.MORNING],
    ['วิชัย ตรงเวลา', 'ชัย', SHIFTS.MORNING],
    ['กนกพร ใจเย็น', 'นก', SHIFTS.MORNING],
    ['ประเสริฐ ทำดี', 'เสริฐ', SHIFTS.MORNING],
    ['อารีย์ เอื้อเฟื้อ', 'รี', SHIFTS.MORNING],
    // Afternoon (10)
    ['ณัฐพล เก่งกล้า', 'พล', SHIFTS.AFTERNOON],
    ['สุดา อ่อนหวาน', 'ดา', SHIFTS.AFTERNOON],
    ['ชัยวัฒน์ ทรงพล', 'ตุ้ย', SHIFTS.AFTERNOON],
    ['เมธี คิดไว', 'ธี', SHIFTS.AFTERNOON],
    ['พิมพ์ใจ งามงด', 'พิม', SHIFTS.AFTERNOON],
    ['รัตนา เพียรดี', 'นา2', SHIFTS.AFTERNOON],
    ['ภูวดล แข็งแรง', 'ภู', SHIFTS.AFTERNOON],
    ['จิราพร สดใส', 'จิ', SHIFTS.AFTERNOON],
    ['สมศักดิ์ อดทน', 'ศักดิ์', SHIFTS.AFTERNOON],
    ['เบญจา ว่องไว', 'เบน', SHIFTS.AFTERNOON],
  ];
  return raw.map(([name, nickname, primaryShift]) =>
    makeEmployee({ name, nickname, primaryShift, status: EMPLOYEE_STATUS.ACTIVE })
  );
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
