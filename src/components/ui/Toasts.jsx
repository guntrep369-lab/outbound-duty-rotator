import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useApp } from '../../context/useApp.js';

const STYLES = {
  success: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  error: { icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-800' },
  warning: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-800' },
};

/** Fixed-position toast stack driven by AppContext. */
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
      {toasts.map((t) => {
        const { icon: Icon, cls } = STYLES[t.type] || STYLES.info;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg ${cls}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex-1 text-sm font-medium leading-snug">{t.message}</p>
            <button
              onClick={() => dismissToast(t.id)}
              className="shrink-0 opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
