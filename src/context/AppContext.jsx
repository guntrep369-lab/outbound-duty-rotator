/**
 * @file AppContext.jsx — single source of truth for app data (employees, duty
 * config, history) and all mutating actions. Every mutation updates React state
 * optimistically and then persists via dataStore (GitHub + local mirror).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadAll,
  saveCollection,
  loadSettings,
  saveSettings,
  isConfigured,
  testConnection as testConn,
} from '../services/dataStore.js';
import { describeGitHubError } from '../services/githubService.js';
import { makeEmployee, makeTask, makeLeave, defaultDutyConfig, demoEmployees, EMPLOYEE_STATUS } from '../data/models.js';
import { AppContext } from './useApp.js';
import { currentWeek, weekKey as makeWeekKey } from '../utils/dateUtils.js';

let toastSeq = 0;

/** Sample surge plan (matches the user's spreadsheet) for the demo team. */
function demoSurgePlanForCurrentWeek() {
  const { year, week } = currentWeek();
  return {
    [makeWeekKey(year, week)]: {
      morning: { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 10, 7: 7 },
      afternoon: { 1: 1, 2: 1, 3: 2, 4: 1, 5: 2, 6: 6, 7: 3 },
    },
  };
}

export function AppProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [config, setConfig] = useState(defaultDutyConfig());
  const [history, setHistory] = useState([]);
  const [plans, setPlans] = useState({}); // surge plan keyed by weekKey
  const [settings, setSettings] = useState(loadSettings());
  const [source, setSource] = useState('local'); // 'github' | 'local'
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const mounted = useRef(false);

  /* ------------------------------- toasts -------------------------------- */
  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback(
    (type, message, ttl = 4000) => {
      const id = ++toastSeq;
      setToasts((t) => [...t, { id, type, message }]);
      if (ttl) setTimeout(() => dismissToast(id), ttl);
      return id;
    },
    [dismissToast]
  );

  /* ------------------------------- loading ------------------------------- */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadAll();
      setEmployees(res.employees);
      setConfig(res.config);
      setHistory(res.history);
      setPlans(res.plans || {});
      setSource(res.source);
      setOnline(res.online);
      setSettings(loadSettings());
      res.warnings.forEach((w) => notify('warning', w, 6000));
      if (res.source === 'github') notify('success', 'Loaded data from GitHub.', 3000);
    } catch (err) {
      notify('error', `Failed to load data: ${describeGitHubError(err)}`);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    reload();
  }, [reload]);

  /* ------------------------------ persistence ---------------------------- */
  // Persist a collection in the background; surface errors as toasts.
  const persist = useCallback(
    async (name, data, message) => {
      setSyncing(true);
      try {
        const { savedTo } = await saveCollection(name, data, message);
        if (savedTo === 'github') setOnline(true);
      } catch (err) {
        notify(
          'error',
          `Saved locally, but GitHub sync failed: ${describeGitHubError(err)}`,
          7000
        );
        setOnline(false);
      } finally {
        setSyncing(false);
      }
    },
    [notify]
  );

  /* ---------------------------- employee actions ------------------------- */
  const commitEmployees = useCallback(
    (next, message) => {
      setEmployees(next);
      persist('employees', next, message);
    },
    [persist]
  );

  const addEmployee = useCallback(
    (data) => {
      const emp = makeEmployee(data);
      commitEmployees([...employees, emp], `chore(employees): add ${emp.nickname || emp.name}`);
      notify('success', `Added ${emp.nickname || emp.name}.`, 2500);
      return emp;
    },
    [employees, commitEmployees, notify]
  );

  const updateEmployee = useCallback(
    (id, patch) => {
      const next = employees.map((e) => (e.id === id ? { ...e, ...patch, id } : e));
      commitEmployees(next, `chore(employees): update ${id}`);
    },
    [employees, commitEmployees]
  );

  const setEmployeeStatus = useCallback(
    (id, status) => {
      const next = employees.map((e) => (e.id === id ? { ...e, status } : e));
      commitEmployees(next, `chore(employees): set ${id} → ${status}`);
    },
    [employees, commitEmployees]
  );

  const archiveEmployee = useCallback(
    (id) => setEmployeeStatus(id, EMPLOYEE_STATUS.RESIGNED),
    [setEmployeeStatus]
  );
  const restoreEmployee = useCallback(
    (id) => setEmployeeStatus(id, EMPLOYEE_STATUS.ACTIVE),
    [setEmployeeStatus]
  );

  const deleteEmployee = useCallback(
    (id) => {
      const next = employees.filter((e) => e.id !== id);
      commitEmployees(next, `chore(employees): delete ${id}`);
      notify('info', 'Employee permanently removed.', 2500);
    },
    [employees, commitEmployees, notify]
  );

  const addLeave = useCallback(
    (empId, leave) => {
      const record = makeLeave(leave);
      const next = employees.map((e) =>
        e.id === empId ? { ...e, leaves: [...(e.leaves || []), record] } : e
      );
      commitEmployees(next, `chore(employees): add leave for ${empId}`);
      notify('success', 'บันทึกวันลาแล้ว', 2500);
      return record;
    },
    [employees, commitEmployees, notify]
  );

  const removeLeave = useCallback(
    (empId, leaveId) => {
      const next = employees.map((e) =>
        e.id === empId ? { ...e, leaves: (e.leaves || []).filter((l) => l.id !== leaveId) } : e
      );
      commitEmployees(next, `chore(employees): remove leave ${leaveId}`);
      notify('info', 'ลบวันลาแล้ว', 2000);
    },
    [employees, commitEmployees, notify]
  );

  const loadDemoTeam = useCallback(() => {
    const team = demoEmployees();
    commitEmployees([...employees, ...team], 'chore(employees): load sample team');
    // Also seed a sample surge plan for the current week.
    const demoPlan = { ...plans, ...demoSurgePlanForCurrentWeek() };
    setPlans(demoPlan);
    persist('plans', demoPlan, 'chore(plans): demo surge plan');
    notify('success', `Loaded ${team.length} sample employees + surge plan.`, 3000);
  }, [employees, commitEmployees, plans, persist, notify]);

  /* ------------------------------ duty config ---------------------------- */
  const commitConfig = useCallback(
    (next, message) => {
      setConfig(next);
      persist('duties', next, message);
    },
    [persist]
  );

  const addTask = useCallback(
    (data) => {
      const task = makeTask(data);
      commitConfig({ ...config, tasks: [...config.tasks, task] }, `chore(duties): add task ${task.name}`);
      return task;
    },
    [config, commitConfig]
  );

  const updateTask = useCallback(
    (id, patch) => {
      const tasks = config.tasks.map((t) => (t.id === id ? makeTask({ ...t, ...patch, id }) : t));
      commitConfig({ ...config, tasks }, `chore(duties): update task ${id}`);
    },
    [config, commitConfig]
  );

  const removeTask = useCallback(
    (id) => {
      const tasks = config.tasks.filter((t) => t.id !== id);
      commitConfig({ ...config, tasks }, `chore(duties): remove task ${id}`);
    },
    [config, commitConfig]
  );

  const setWorkingDays = useCallback(
    (workingDays) => commitConfig({ ...config, workingDays }, 'chore(duties): working days'),
    [config, commitConfig]
  );

  const setLookbackWeeks = useCallback(
    (lookbackWeeks) => commitConfig({ ...config, lookbackWeeks }, 'chore(duties): lookback weeks'),
    [config, commitConfig]
  );

  const setExtraRules = useCallback(
    (patch) =>
      commitConfig(
        { ...config, extraRules: { ...(config.extraRules || {}), ...patch } },
        'chore(duties): outsource-เสริม rules'
      ),
    [config, commitConfig]
  );

  const setUseSurgePlan = useCallback(
    (on) => commitConfig({ ...config, useSurgePlan: !!on }, 'chore(duties): surge-plan toggle'),
    [config, commitConfig]
  );

  /* ------------------------------ surge plan ----------------------------- */
  // plans = { [weekKey]: { morning: { [iso]: n }, afternoon: { [iso]: n } } }
  const setSurgePlanCount = useCallback(
    (weekKey, shift, iso, value) => {
      const n = Math.max(0, Number(value) || 0);
      const week = plans[weekKey] || {};
      const shiftPlan = { ...(week[shift] || {}), [iso]: n };
      const next = { ...plans, [weekKey]: { ...week, [shift]: shiftPlan } };
      setPlans(next);
      persist('plans', next, `chore(plans): surge ${weekKey} ${shift} d${iso}=${n}`);
    },
    [plans, persist]
  );

  /* -------------------------------- history ------------------------------ */
  const saveScheduleToHistory = useCallback(
    (schedule) => {
      const filtered = history.filter((r) => r.weekKey !== schedule.weekKey);
      const next = [...filtered, ...schedule.records];
      setHistory(next);
      persist('history', next, `chore(history): save schedule ${schedule.weekKey}`);
      notify('success', `Saved schedule for ${schedule.weekKey} to history.`, 3000);
    },
    [history, persist, notify]
  );

  const deleteWeekFromHistory = useCallback(
    (weekKey) => {
      const next = history.filter((r) => r.weekKey !== weekKey);
      setHistory(next);
      persist('history', next, `chore(history): remove ${weekKey}`);
      notify('info', `Removed ${weekKey} from history.`, 2500);
    },
    [history, persist, notify]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    persist('history', [], 'chore(history): clear all');
    notify('info', 'History cleared.', 2500);
  }, [persist, notify]);

  /* ---------------------------- github settings -------------------------- */
  const connectGithub = useCallback(
    async (partial) => {
      const next = { ...loadSettings(), ...partial, enabled: true };
      saveSettings(next);
      setSettings(next);
      await reload();
    },
    [reload]
  );

  const disconnectGithub = useCallback(() => {
    const next = { ...loadSettings(), enabled: false };
    saveSettings(next);
    setSettings(next);
    setOnline(false);
    setSource('local');
    notify('info', 'GitHub sync disabled. Working from local data.', 3000);
  }, [notify]);

  const updateSettings = useCallback((partial) => {
    const next = { ...loadSettings(), ...partial };
    saveSettings(next);
    setSettings(next);
  }, []);

  /* ------------------------------ derived data --------------------------- */
  const employeeIndex = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const taskIndex = useMemo(() => new Map(config.tasks.map((t) => [t.id, t])), [config.tasks]);
  const savedWeeks = useMemo(() => new Set(history.map((r) => r.weekKey)), [history]);

  const value = {
    // state
    loading,
    employees,
    config,
    history,
    plans,
    settings,
    source,
    online,
    syncing,
    configured: isConfigured(settings),
    toasts,
    // derived
    employeeIndex,
    taskIndex,
    savedWeeks,
    getEmployee: (id) => employeeIndex.get(id),
    getTask: (id) => taskIndex.get(id),
    // actions
    reload,
    notify,
    dismissToast,
    addEmployee,
    updateEmployee,
    setEmployeeStatus,
    archiveEmployee,
    restoreEmployee,
    deleteEmployee,
    loadDemoTeam,
    addLeave,
    removeLeave,
    addTask,
    updateTask,
    removeTask,
    setWorkingDays,
    setLookbackWeeks,
    setExtraRules,
    setUseSurgePlan,
    setSurgePlanCount,
    saveScheduleToHistory,
    deleteWeekFromHistory,
    clearHistory,
    connectGithub,
    disconnectGithub,
    updateSettings,
    testConnection: testConn,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
