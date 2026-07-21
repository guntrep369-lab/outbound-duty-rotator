import React, { useState } from 'react';
import { Users, ClipboardList, Github, Repeat } from 'lucide-react';
import { EmployeeManager } from './settings/EmployeeManager.jsx';
import { DutyManager } from './settings/DutyManager.jsx';
import { ShiftRotation } from './settings/ShiftRotation.jsx';
import { GitHubSync } from './settings/GitHubSync.jsx';

const SUBTABS = [
  { id: 'employees', label: 'Employees', labelTh: 'พนักงาน', icon: Users },
  { id: 'duties', label: 'Duties & Shifts', labelTh: 'กะ & หน้าที่', icon: ClipboardList },
  { id: 'shifts', label: 'Shift Rotation', labelTh: 'สลับกะ', icon: Repeat },
  { id: 'github', label: 'GitHub Sync', labelTh: 'ซิงก์', icon: Github },
];

export function Settings() {
  const [sub, setSub] = useState('employees');
  return (
    <div className="space-y-5">
      <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {SUBTABS.map((s) => {
          const Icon = s.icon;
          const active = sub === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={`flex flex-1 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {sub === 'employees' && <EmployeeManager />}
      {sub === 'duties' && <DutyManager />}
      {sub === 'shifts' && <ShiftRotation />}
      {sub === 'github' && <GitHubSync />}
    </div>
  );
}
