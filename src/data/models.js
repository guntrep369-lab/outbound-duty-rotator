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
    type: partial.type || EMPLOYEE_TYPES.INHOUSE,
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
  return raw.map(([name, nickname, primaryShift, type]) =>
    makeEmployee({ name, nickname, primaryShift, type, status: EMPLOYEE_STATUS.ACTIVE })
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
