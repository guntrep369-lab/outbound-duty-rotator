/**
 * @file useApp.js — the app context object + hook, kept separate from the
 * provider component so that AppContext.jsx exports only a component (which lets
 * Vite/React Fast Refresh hot-reload it cleanly during development).
 */

import { createContext, useContext } from 'react';

export const AppContext = createContext(null);

/** Access the shared app state + actions. Must be used within <AppProvider>. */
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}
