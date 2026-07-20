# 📦 Outbound Duty Rotator

A web app for managing **weekly job assignments** for an Outbound logistics team, with a
**fair, history-aware rotation algorithm** — no random shuffling. Built with **React (Vite)**,
**Tailwind CSS**, **Lucide** icons, and **Octokit**, using a **GitHub repository as the database**
(with an automatic LocalStorage fallback for offline/demo use).

ระบบจัดตารางหมุนเวียนงานพนักงานคลังสินค้าขาออก แบบ “ยุติธรรม–ดูประวัติย้อนหลัง”
เก็บข้อมูลผ่าน GitHub repo และทำงานออฟไลน์ได้ด้วย LocalStorage

---

## ✨ Features

| Area | What it does |
| --- | --- |
| **Employees** | Add / edit / archive (soft-delete) / reactivate. Primary shift + status (Active / On Leave / Resigned). Built for high turnover. |
| **Duties & Shifts** | Two shifts (กะเช้า / กะบ่าย). Configurable Outbound tasks (Pick, Pack, Manifest/Audit, Loading, Replenishment, Sorting…) with **per-shift head-count limits**. Configurable working days + rotation look-back window. |
| **Fair rotation engine** | Looks back over the last _N_ weeks of history and prioritises duties each person **hasn't done recently**, while **balancing total workload** within each shift. Deterministic (stable) but varies as history grows. Handles head-count changes gracefully. |
| **Weekly schedule** | Pick any ISO week/year → generate a **Days × Tasks × Employees** grid. **Manual swaps / overrides** by clicking any name. **Standby/rest** rotates automatically. |
| **Export** | CSV (Excel-friendly, UTF-8 BOM so Thai renders), copy text summary, and a print-friendly view. |
| **Dashboard** | Today's assignments per shift, plus team stats. |
| **History** | Browse past weeks and a **duty-distribution heat-table** (employee × task) — the exact signal the engine uses. |
| **GitHub persistence** | Stores `employees.json`, `duties.json`, `history.json` in a repo via a Personal Access Token. Offline/demo fallback to LocalStorage. |

---

## 🧮 How the fair rotation works

For every **working day** and **shift** the engine assigns employees by minimising a cost:

1. **Recency of duty** — for each employee it counts how often (recency-weighted) they've done
   each task over the last `lookbackWeeks` weeks. Tasks done recently cost more, so people are
   steered toward tasks they **haven't** done lately.
2. **Workload balance** — a running per-employee workload counter (shared across the whole week)
   means busy people are picked last and **rest (standby) rotates fairly**.
3. **Deterministic tie-breaks** — a seeded hash keeps results stable across regenerations of the
   same week, yet naturally different week-to-week.

**Employment types** (ประเภทพนักงาน): each employee is `inhouse`, `outsource ประจำ`, or
`outsource เสริม`. The first two rotate as the core workforce; **outsource เสริม are surge
staff** — they only receive duties on days when the core staff can't fill every slot, and
otherwise sit on standby. Two policy controls refine this:

- **Task type restrictions** — each task can be limited to specific employment types
  (e.g. QC ที่นอน → inhouse only). Restricted tasks are only offered to allowed types, in both
  auto-generation and the manual swap dialog. No restriction = any type may do it.
- **Weekly min / max days for outsource เสริม** — `extraRules.minDays` guarantees each surge
  worker at least _N_ working days (the engine force-schedules them on the days they'd otherwise
  miss the target), and `extraRules.maxDays` caps them at most _N_ days. If min > max, the cap wins.

If there are **more required slots than eligible staff**, the shortfall is flagged (empty slots)
instead of silently dropping tasks. If there are **more staff than slots**, the extras go to
Standby, and who rests rotates by workload. New hires and resignations are handled automatically
because the pool is recomputed from current `Active` employees every time.

The core lives in [`src/engine/rotationEngine.js`](src/engine/rotationEngine.js).

---

## 🚀 Getting started (local)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

Open the app → **Settings → Employees → “Load a sample team”** to explore immediately, then
**Schedule → Generate roster**. Everything is saved to your browser until you connect GitHub.

---

## 🔗 Connecting GitHub (using a repo as the database)

1. Create a **data repository** (can be private), e.g. `outbound-duty-data`.
2. Create a **fine-grained Personal Access Token** with **Contents: Read and write** on that repo
   (or a classic token with the `repo` scope).
3. In the app: **Settings → GitHub Sync** → paste the token, owner, repo, branch (`main`),
   and data folder (`data`) → **Test connection** → **Connect & enable sync**.

The app reads/writes `data/employees.json`, `data/duties.json`, and `data/history.json`,
tracking file SHAs and retrying on conflicts.

> 🔒 **Security:** the token is stored **only in your browser's LocalStorage** and is sent
> directly to GitHub's API — it never touches any third-party server, and it's git-ignored so it
> can't be committed. Revoke it any time from GitHub settings.

---

## ☁️ Deploying to GitHub Pages (free)

This repo ships a workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Push the project to a GitHub repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main` — the action builds and publishes `dist/`.

`vite.config.js` uses `base: './'`, so the build works whether it's served from a **user page**
(`user.github.io`) or a **project page** (`user.github.io/repo/`) — no extra config needed.

> Tip: keep the app repo and the **data repo** separate. The public Pages site never contains your
> token; each user enters their own in their browser.

---

## 🗂️ Project structure

```
src/
├─ data/models.js            # enums, factories, defaults, demo data
├─ engine/rotationEngine.js  # the fair, history-aware algorithm
├─ services/
│  ├─ githubService.js       # Octokit wrapper (repo-as-DB, UTF-8/base64, SHAs)
│  └─ dataStore.js           # GitHub ⇄ LocalStorage persistence + fallback
├─ context/AppContext.jsx    # single source of truth + all actions
├─ utils/                    # ISO-week math, schedule edits, CSV/text export
└─ components/
   ├─ Dashboard.jsx          # today's assignments
   ├─ ScheduleGenerator.jsx  # generate / preview / swap / export
   ├─ HistoryViewer.jsx      # past weeks + distribution heat-table
   ├─ Settings.jsx           # tabs → Employees / Duties / GitHub
   ├─ settings/…             # EmployeeManager, DutyManager, GitHubSync
   ├─ schedule/ScheduleGrid.jsx
   └─ ui/…                   # Badge, Modal, Toasts, WeekPicker
```

---

## 🧾 Data files (the "database")

- **`employees.json`** — array of `{ id, name, nickname, primaryShift, status, type, createdAt }`
  (`type`: `inhouse` | `outsource_regular` | `outsource_extra`; older records without `type` count as inhouse)
- **`duties.json`** — `{ tasks: [{ id, name, nameTh, color, req:{morning,afternoon}, active, allowedTypes[] }], workingDays, lookbackWeeks, extraRules:{ minDays, maxDays } }`
  (`allowedTypes`: empty = any type; `extraRules` applies to `outsource_extra` only)
- **`history.json`** — array of `{ id, weekKey, year, week, dayKey, date, shift, dutyId, employeeId }`

All three are plain JSON you can read, diff, and edit directly on GitHub.
