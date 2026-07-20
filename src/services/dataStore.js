/**
 * @file dataStore.js — persistence abstraction. Reads/writes the three JSON
 * "tables" (employees / duties / history) to a GitHub repo when configured,
 * and always keeps a LocalStorage mirror so the app works fully offline / in a
 * demo without any GitHub connection.
 */

import { GitHubService, describeGitHubError } from './githubService.js';
import { defaultDutyConfig, makeTask } from '../data/models.js';

const KEYS = {
  settings: 'odr:settings',
  employees: 'odr:employees',
  duties: 'odr:duties',
  history: 'odr:history',
  sha: (file) => `odr:sha:${file}`,
};

/** Logical collection name → repo filename. */
export const FILES = {
  employees: 'employees.json',
  duties: 'duties.json',
  history: 'history.json',
};

/* ------------------------------- local layer ------------------------------ */

function localGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function localSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('LocalStorage write failed', err);
  }
}

/* ------------------------------- settings --------------------------------- */

/** @returns {{token:string, owner:string, repo:string, branch:string, dir:string, enabled:boolean}} */
export function loadSettings() {
  const s = localGet(KEYS.settings, {});
  return {
    token: s.token || '',
    owner: s.owner || '',
    repo: s.repo || '',
    branch: s.branch || 'main',
    dir: s.dir || 'data',
    enabled: !!s.enabled,
  };
}

export function saveSettings(settings) {
  localSet(KEYS.settings, settings);
  return settings;
}

export function isConfigured(settings = loadSettings()) {
  return !!(settings.token && settings.owner && settings.repo);
}

function buildService(settings = loadSettings()) {
  if (!isConfigured(settings)) return null;
  return new GitHubService(settings);
}

/* --------------------------- shape normalisation -------------------------- */

/** Ensure the duty document always has the fields the app expects. */
export function normalizeDutyDoc(doc) {
  const base = defaultDutyConfig();
  if (!doc || typeof doc !== 'object') return base;
  const tasks = Array.isArray(doc.tasks) && doc.tasks.length
    ? doc.tasks.map((t) => makeTask(t))
    : base.tasks;
  const workingDays = Array.isArray(doc.workingDays) && doc.workingDays.length
    ? doc.workingDays.filter((d) => d >= 1 && d <= 7)
    : base.workingDays;
  const lookbackWeeks = Number(doc.lookbackWeeks) > 0 ? Number(doc.lookbackWeeks) : base.lookbackWeeks;
  return { tasks, workingDays, lookbackWeeks };
}

/* ------------------------------- load / save ------------------------------ */

/**
 * Load all three collections. Prefers GitHub when sync is enabled + configured,
 * falling back to the LocalStorage mirror on any failure.
 * @returns {Promise<{employees:any[], config:any, history:any[], source:'github'|'local', online:boolean, warnings:string[]}>}
 */
export async function loadAll() {
  const settings = loadSettings();
  let employees = localGet(KEYS.employees, []);
  let dutyDoc = localGet(KEYS.duties, defaultDutyConfig());
  let history = localGet(KEYS.history, []);
  const warnings = [];
  let source = 'local';
  let online = false;

  const svc = settings.enabled ? buildService(settings) : null;
  if (svc) {
    try {
      const [e, d, h] = await Promise.all([
        svc.getJson(FILES.employees),
        svc.getJson(FILES.duties),
        svc.getJson(FILES.history),
      ]);
      online = true;
      source = 'github';

      if (e.data) {
        employees = e.data;
        localSet(KEYS.employees, employees);
      } else {
        warnings.push('employees.json not found in the repo yet — it will be created on first save.');
      }
      localSet(KEYS.sha(FILES.employees), e.sha);

      if (d.data) {
        dutyDoc = d.data;
        localSet(KEYS.duties, dutyDoc);
      } else {
        warnings.push('duties.json not found in the repo yet — it will be created on first save.');
      }
      localSet(KEYS.sha(FILES.duties), d.sha);

      if (h.data) {
        history = h.data;
        localSet(KEYS.history, history);
      } else {
        warnings.push('history.json not found in the repo yet — it will be created on first save.');
      }
      localSet(KEYS.sha(FILES.history), h.sha);
    } catch (err) {
      warnings.push(`GitHub load failed — using local data. (${describeGitHubError(err)})`);
      source = 'local';
      online = false;
    }
  }

  return {
    employees: Array.isArray(employees) ? employees : [],
    config: normalizeDutyDoc(dutyDoc),
    history: Array.isArray(history) ? history : [],
    source,
    online,
    warnings,
  };
}

/**
 * Persist one collection. Always writes the local mirror; also writes GitHub
 * when sync is enabled. Retries once on a 409 (stale SHA).
 * @param {'employees'|'duties'|'history'} name
 * @returns {Promise<{savedTo:'github'|'local'}>}
 */
export async function saveCollection(name, data, message) {
  localSet(KEYS[name], data);
  const settings = loadSettings();
  if (!settings.enabled) return { savedTo: 'local' };
  const svc = buildService(settings);
  if (!svc) return { savedTo: 'local' };

  const file = FILES[name];
  const shaKey = KEYS.sha(file);
  let sha = localGet(shaKey, null);
  try {
    const res = await svc.putJson(file, data, sha, message);
    localSet(shaKey, res.sha);
    return { savedTo: 'github' };
  } catch (err) {
    if (err.status === 409 || err.status === 422) {
      // SHA went stale — refetch and retry once.
      const cur = await svc.getJson(file);
      const res = await svc.putJson(file, data, cur.sha, message);
      localSet(shaKey, res.sha);
      return { savedTo: 'github' };
    }
    throw err;
  }
}

/** Used by the setup UI to validate credentials before enabling sync. */
export async function testConnection(settings) {
  const svc = new GitHubService(settings);
  return svc.testConnection();
}

/** Wipe the stored PAT (keeps other settings). */
export function forgetToken() {
  const s = loadSettings();
  saveSettings({ ...s, token: '', enabled: false });
}
