import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarRange,
  CalendarDays,
  History as HistoryIcon,
  Settings as SettingsIcon,
  PackageOpen,
  Cloud,
  CloudOff,
  HardDrive,
  Loader2,
  ClipboardCheck,
  Warehouse,
  Truck,
  FileText,
  Search,
  Settings2,
  Boxes,
  Package,
} from 'lucide-react';
import { MODULES, BRAND } from '../public/wms-modules.js';
import { useApp } from './context/useApp.js';
import { Toasts } from './components/ui/Toasts.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { ScheduleGenerator } from './components/ScheduleGenerator.jsx';
import { CalendarView } from './components/Calendar.jsx';
import { HistoryViewer } from './components/HistoryViewer.jsx';
import { Settings } from './components/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', labelTh: 'หน้าหลัก', icon: LayoutDashboard },
  { id: 'schedule', label: 'Schedule', labelTh: 'จัดตาราง', icon: CalendarRange },
  { id: 'calendar', label: 'Calendar', labelTh: 'ปฏิทิน', icon: CalendarDays },
  { id: 'history', label: 'History', labelTh: 'ประวัติ', icon: HistoryIcon },
  { id: 'settings', label: 'Settings', labelTh: 'ตั้งค่า', icon: SettingsIcon },
];

function SyncStatus() {
  const { source, online, syncing, settings } = useApp();
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
      </span>
    );
  }
  if (settings.enabled && online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
        <Cloud className="h-3.5 w-3.5" /> GitHub synced
      </span>
    );
  }
  if (settings.enabled && !online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
        <CloudOff className="h-3.5 w-3.5" /> Offline (local)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
      <HardDrive className="h-3.5 w-3.5" /> Local demo
    </span>
  );
}

/**
 * Signed-in user from wms-gate.js, with a way out. Renders nothing when the
 * gate isn't loaded, so the app still works if the script is ever removed.
 */
function GateUser() {
  const gate = typeof window !== 'undefined' ? window.wmsGate : null;
  const name = gate?.user?.();
  if (!name) return null;
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-xs text-slate-300" title={name}>
        👤 {name}
      </span>
      <button
        type="button"
        onClick={() => gate.signOut()}
        className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
      >
        ออก
      </button>
    </div>
  );
}

/** Icon name (from wms-modules.js) → the lucide component that draws it. */
const MODULE_ICONS = { calendar: CalendarRange, clipboard: ClipboardCheck, truck: Truck, warehouse: Warehouse, file: FileText, search: Search, settings: Settings2, boxes: Boxes, package: Package };

/**
 * Dark system chrome. Left sidebar on desktop, collapsing to a top bar on small
 * screens. The static modules render the same thing from the same MODULES list
 * via public/wms-shell.js — keep the two in visual sync.
 */
function SystemSidebar({ active }) {
  const LogoIcon = MODULE_ICONS[BRAND.logo];
  return (
    <aside className="no-print sticky top-0 z-40 shrink-0 bg-slate-900 text-white lg:h-screen lg:w-60">
      {/* Brand */}
      {/* Geometry mirrors .sysbar-brand in wms-theme.css / the static modules:
          logo beside the text on mobile, stacked above it from lg up. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block">
        <div className="flex min-w-0 items-center gap-2.5 lg:block">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 shadow-sm lg:mb-2">
            <LogoIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="tracking-[-0.01em]">
              <h1 className="inline text-[15px] font-bold">{BRAND.name}</h1>
              <span className="ml-1 text-[11px] font-medium text-indigo-300">{BRAND.by}</span>
            </div>
            <p className="hidden text-[11px] text-slate-400 lg:block">{BRAND.sub}</p>
          </div>
        </div>
        <div className="lg:hidden">
          <SyncStatus />
        </div>
      </div>

      {/* Modules — horizontal on mobile, vertical on desktop */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible lg:px-3">
        <p className="hidden px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:block">
          โมดูล · Modules
        </p>
        {MODULES.map((m) => {
          const Icon = MODULE_ICONS[m.icon];
          const on = m.id === active;
          return (
            <a
              key={m.id}
              // This module IS the site root, so a module path is already relative to it.
              href={on ? undefined : `./${m.path}`}
              aria-current={on ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full ${
                on ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{m.label}</span>
              <span className="hidden text-[11px] opacity-70 lg:inline">{m.labelEn}</span>
            </a>
          );
        })}
      </nav>

      {/* Signed-in user + sync status, pinned to the bottom on desktop.
          Mirrors .sysbar-user in wms-theme.css, which the static modules use. */}
      <div className="hidden px-4 lg:absolute lg:bottom-4 lg:left-0 lg:right-0 lg:block">
        <GateUser />
        <SyncStatus />
      </div>
    </aside>
  );
}

/** Sticky banner shown when a save was rejected because someone else saved first. */
function ConflictBanner() {
  const { conflict, reload, syncing } = useApp();
  if (!conflict) return null;
  return (
    <div className="no-print border-b border-rose-200 bg-rose-50 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-3 text-sm text-rose-800">
        <span className="font-semibold">⚠️ การบันทึกล่าสุดถูกยกเลิก</span>
        <span className="text-rose-700">
          มีคนอื่นแก้ <code className="rounded bg-rose-100 px-1">{conflict.file}</code> ก่อนหน้า —
          ข้อมูลที่เห็นบนจอตอนนี้ <b>ยังไม่ถูกบันทึก</b>
        </span>
        <button className="btn-danger !py-1.5 text-xs" onClick={reload} disabled={syncing}>
          โหลดข้อมูลล่าสุด
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { loading } = useApp();
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      <SystemSidebar active="roster" />

      {/* Module column */}
      <div className="flex min-w-0 flex-1 flex-col">
      <ConflictBanner />
      {/* Module header + sub-nav */}
      <header className="no-print border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="w-full px-5 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <PackageOpen className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h2 className="text-sm font-bold text-slate-800 sm:text-base">จัดตารางงาน · Outbound Duty Roster</h2>
              <p className="hidden text-xs text-slate-500 sm:block">ระบบจัดตารางหมุนเวียนงานพนักงานคลังขาออก</p>
            </div>
          </div>

        {/* Tabs */}
          <nav className="mt-2 flex gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  <span className="hidden text-xs text-slate-400 sm:inline">{item.labelTh}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="w-full flex-1 px-5 py-5">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading data…</p>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
            {tab === 'schedule' && <ScheduleGenerator />}
            {tab === 'calendar' && <CalendarView />}
            {tab === 'history' && <HistoryViewer />}
            {tab === 'settings' && <Settings />}
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
        WMS Management <span className="text-slate-500">by Gun</span> · จัดตารางงาน — หมุนเวียนงานยุติธรรมโดยดูประวัติ ·
        ข้อมูลเก็บใน GitHub หรือเบราว์เซอร์
      </footer>
      </div>

      <Toasts />
    </div>
  );
}
