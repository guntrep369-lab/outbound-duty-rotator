import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarRange,
  History as HistoryIcon,
  Settings as SettingsIcon,
  PackageOpen,
  Cloud,
  CloudOff,
  HardDrive,
  Loader2,
} from 'lucide-react';
import { useApp } from './context/useApp.js';
import { Toasts } from './components/ui/Toasts.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { ScheduleGenerator } from './components/ScheduleGenerator.jsx';
import { HistoryViewer } from './components/HistoryViewer.jsx';
import { Settings } from './components/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', labelTh: 'หน้าหลัก', icon: LayoutDashboard },
  { id: 'schedule', label: 'Schedule', labelTh: 'จัดตาราง', icon: CalendarRange },
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

export default function App() {
  const { loading } = useApp();
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col">
      {/* Header */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <PackageOpen className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold text-slate-800 sm:text-base">Outbound Duty Rotator</h1>
              <p className="hidden text-xs text-slate-500 sm:block">ระบบจัดตารางหมุนเวียนงานพนักงานคลังขาออก</p>
            </div>
          </div>
          <SyncStatus />
        </div>

        {/* Tabs */}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-1">
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
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-5">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading data…</p>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
            {tab === 'schedule' && <ScheduleGenerator />}
            {tab === 'history' && <HistoryViewer />}
            {tab === 'settings' && <Settings />}
          </>
        )}
      </main>

      <footer className="no-print border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
        Outbound Duty Rotator · Fair history-aware rotation · Data stored in GitHub or your browser
      </footer>

      <Toasts />
    </div>
  );
}
