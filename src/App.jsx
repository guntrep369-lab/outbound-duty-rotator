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
} from 'lucide-react';
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

/** Top-level modules of the WMS system. Each is its own page. */
const MODULES = [
  { id: 'roster', label: 'จัดตารางงาน', labelEn: 'Duty Roster', icon: CalendarRange, href: './' },
  { id: 'order', label: 'เทียบ Order', labelEn: 'Order Compare', icon: ClipboardCheck, href: './order-compare/' },
];

/** Dark system chrome shared by every module (mirrored in order-compare). */
function SystemBar({ active }) {
  return (
    <div className="no-print bg-slate-900 text-white">
      <div className="mx-auto w-full max-w-6xl px-4">
        {/* Brand row */}
        <div className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 shadow-sm">
              <Warehouse className="h-4 w-4" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="flex items-baseline gap-1.5">
                <h1 className="truncate text-sm font-bold tracking-tight sm:text-base">WMS Management</h1>
                <span className="shrink-0 text-[11px] font-medium text-indigo-300">by Gun</span>
              </div>
              <p className="hidden truncate text-[11px] text-slate-400 sm:block">
                ระบบบริหารคลังสินค้า · Warehouse Management System
              </p>
            </div>
          </div>
          <SyncStatus />
        </div>

        {/* Module tabs */}
        <nav className="flex gap-1 overflow-x-auto pb-1.5">
          {MODULES.map((m) => {
            const Icon = m.icon;
            const on = m.id === active;
            return (
              <a
                key={m.id}
                href={on ? undefined : m.href}
                aria-current={on ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  on ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{m.label}</span>
                <span className="hidden text-[11px] opacity-70 sm:inline">{m.labelEn}</span>
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export default function App() {
  const { loading } = useApp();
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="flex min-h-screen w-full flex-col">
      {/* System chrome */}
      <div className="no-print sticky top-0 z-40">
        <SystemBar active="roster" />
      </div>

      {/* Module header + sub-nav */}
      <header className="no-print border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 pt-3">
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">
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

      <Toasts />
    </div>
  );
}
