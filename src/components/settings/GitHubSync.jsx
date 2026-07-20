import React, { useState } from 'react';
import {
  Github,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Cloud,
  CloudOff,
  ShieldCheck,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/useApp.js';
import { describeGitHubError } from '../../services/githubService.js';

export function GitHubSync() {
  const { settings, connectGithub, disconnectGithub, updateSettings, testConnection, online, source } = useApp();
  const [form, setForm] = useState({
    token: settings.token || '',
    owner: settings.owner || '',
    repo: settings.repo || '',
    branch: settings.branch || 'main',
    dir: settings.dir || 'data',
  });
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // {ok, ...} | {error}
  const [connecting, setConnecting] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const complete = form.token && form.owner && form.repo;

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await testConnection(form);
      setResult({ ok: true, ...res });
    } catch (err) {
      setResult({ ok: false, error: describeGitHubError(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    // Persist field edits (dir/branch/owner/repo/token) and enable sync + reload.
    updateSettings(form);
    await connectGithub(form);
    setConnecting(false);
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2 text-slate-700">
        <Github className="h-5 w-5 text-indigo-600" />
        <h2 className="text-lg font-semibold">GitHub Sync · บันทึกข้อมูลผ่าน GitHub</h2>
      </div>

      {/* Current status */}
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          settings.enabled && online
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : settings.enabled
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        {settings.enabled && online ? (
          <Cloud className="h-5 w-5" />
        ) : settings.enabled ? (
          <CloudOff className="h-5 w-5" />
        ) : (
          <CloudOff className="h-5 w-5" />
        )}
        <div className="flex-1 text-sm">
          <p className="font-semibold">
            {settings.enabled && online
              ? `Connected — reading & writing ${settings.owner}/${settings.repo}`
              : settings.enabled
              ? 'Sync enabled but currently offline — using local data'
              : 'GitHub sync is off — running in local/demo mode'}
          </p>
          <p className="opacity-80">Active data source: {source === 'github' ? 'GitHub repository' : 'Browser LocalStorage'}</p>
        </div>
        {settings.enabled && (
          <button className="btn-secondary !py-1.5 text-xs" onClick={disconnectGithub}>
            Disable
          </button>
        )}
      </div>

      {/* Form */}
      <div className="card space-y-4 p-4">
        <div>
          <label className="label">
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Personal Access Token (PAT)
            </span>
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              className="input pr-10 font-mono"
              value={form.token}
              onChange={(e) => set('token', e.target.value)}
              placeholder="github_pat_… or ghp_…"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowToken((s) => !s)}
              aria-label="Toggle token visibility"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            Fine-grained token with <span className="font-medium">Contents: Read &amp; write</span> on the target repo
            (or a classic token with the <span className="font-mono">repo</span> scope).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Repo owner · เจ้าของ</label>
            <input
              className="input"
              value={form.owner}
              onChange={(e) => set('owner', e.target.value)}
              placeholder="your-username"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Repo name · ชื่อ repo</label>
            <input
              className="input"
              value={form.repo}
              onChange={(e) => set('repo', e.target.value)}
              placeholder="outbound-duty-data"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Branch</label>
            <input className="input" value={form.branch} onChange={(e) => set('branch', e.target.value)} placeholder="main" />
          </div>
          <div>
            <label className="label">Data folder</label>
            <input className="input" value={form.dir} onChange={(e) => set('dir', e.target.value)} placeholder="data" />
          </div>
        </div>

        {/* Test result */}
        {result && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
              result.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            {result.ok ? (
              <span>
                Connected to <b>{result.fullName}</b> ({result.private ? 'private' : 'public'}). Default branch{' '}
                <b>{result.defaultBranch}</b>.{' '}
                {result.canWrite ? 'Write access confirmed.' : '⚠ Token appears read-only — writes will fail.'}
              </span>
            ) : (
              <span>{result.error}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={handleTest} disabled={!complete || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Test connection
          </button>
          <button className="btn-primary" onClick={handleConnect} disabled={!complete || connecting}>
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
            {settings.enabled ? 'Save & re-sync' : 'Connect & enable sync'}
          </button>
          {settings.token && (
            <button
              className="btn-ghost text-rose-500"
              onClick={() => {
                set('token', '');
                updateSettings({ token: '', enabled: false });
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear token
            </button>
          )}
        </div>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Your token is stored <b>only in this browser</b> (LocalStorage) and is sent directly to GitHub's API — it never
          touches any third-party server. Use a fine-grained token scoped to a single data repo, and revoke it any time
          from GitHub settings.
        </p>
      </div>
    </section>
  );
}
