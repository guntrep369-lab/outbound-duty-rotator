# 📦 WMS Management by Gun

Web tools for an outbound warehouse team, hosted free on GitHub Pages: the shift schedule,
order checks, picking sheets, warehouse forms, and transport documents. Every module is a plain
HTML/CSS/JS page in [`public/`](public/) with no framework, and they share one sidebar, theme, and
sign-in screen.

ระบบบริหารคลังสินค้าขาออก — ตารางกะ เทียบออเดอร์ สรุปหยิบของ เอกสารคลัง และเอกสารขนส่ง

---

## 🧭 Modules

The list lives in [`public/wms-modules.js`](public/wms-modules.js) (the one place to add a module).

| Group | Module | Path |
| --- | --- | --- |
| — | สรุปเช้า · Morning Brief | `summary/` |
| — | ย้อนหลัง · History | `history/` |
| ออเดอร์ | เทียบ Order · ค้นหาออเดอร์ | `order-compare/` · `order-lookup/` |
| คลังสินค้า | สต๊อกคงเหลือ · สรุปหยิบของ · เบิกตามออเดอร์ · เอกสารคลังสินค้า | `stock/` · `picking/` · `order-sheet/` · `warehouse-forms/` |
| ขนส่ง | ประเภทงานรถ · ผังงานรถวันนี้ · ทำใบงานขนส่ง · เอกสารขนส่ง | `jobs/` · `loadplan/` · `transport-docs/` · `transport-forms/` |
| ทีมและระบบ | **ตารางกะ · Shift Schedule** · ตั้งค่า | `roster/` · `settings/` |

The site root redirects to `roster/`, so the main link opens the shift schedule.

---

## 📅 Shift schedule (`/roster`)

[`public/roster/index.html`](public/roster/index.html) has five tabs: ตารางกะ, พนักงาน,
คาบเปลี่ยนกะ, วันหยุด, KPI.

- **Two groups, two shifts.** Permanent staff are in group A or B. Each period (คาบ, normally
  28 days) puts one group on กะเช้า 07:00–16:00 and the other on กะบ่าย 16:00–24:00; the next
  period swaps them. A period ends on its end date (วันสุดท้ายคาบ) when one is set; otherwise it
  ends the day before the next one starts, and a last period runs 28 days. Periods can't overlap,
  and the period list warns about days that fall between two periods.
- **Last day of a period:** the afternoon shift works 10:00–19:00 (shown as `10-19`), except
  people whose day off is Saturday.
- **Outsource** keep a fixed shift and never rotate. They can have a weekly day off.
- **Days off.** Each person has one weekly day off. Holidays (วันหยุดพิเศษ) are `H` for everyone.
- **Promo days** are highlighted automatically (2/2 to 6/6, and the 15th, 25th, and 28th of every
  month), and you can add extra dates.
- **Manual edits.** Clicking a cell overrides it (W → H, or H / 10-19 → W); keep clicking to step
  back to the computed value. "ล้างแก้ไข" clears the edits in the current period.
  Click a name, nickname, day off, or shift badge to edit it in place.
- **KPI:** 8 monthly metrics per person, each with a target, plus team pass rate and a
  per-person score chart.

### Where the data lives

Everything is stored in the browser under the localStorage key `wms:roster` and saved as soon
as you change something. The same device and browser keeps it; another machine starts from the
built-in team list until you bring the data over:

- **⬇ ส่งออกไฟล์ / ⬆ นำเข้าไฟล์** on the page exports a `.json` file and reads it back.
  Import also accepts a `shift-program.html` saved from the old standalone schedule program
  (its data is embedded on the `var SAVED_DATA = …;` line) and a Settings backup file.
- **ตั้งค่า → สำรอง** includes `wms:roster` in the key backup file, along with every other
  `wms:` setting.

Names are the identity of a person: manual edits and KPI values are keyed by name, so renaming
someone moves their data along, and two people can't share a name.

> 🔒 The built-in team list is in the page source, and this repo is public. Anyone can read it
> on GitHub.

---

## 🚀 Getting started (local)

```bash
npm install
npm run dev      # http://localhost:5173 → redirects to /roster/
npm test         # vitest — includes checks that run over every page in public/
npm run build    # production build → dist/
```

Vite serves `public/` as-is; there is no bundling step for the modules.

---

## ☁️ Deploying to GitHub Pages

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and publishes `dist/` on
every push to `main` (Settings → Pages → Source: **GitHub Actions**). `vite.config.js` uses
`base: './'`, so the build works from a user page or a project page.

---

## 📋 Order Compare (`/order-compare`)

Compares the Daily Logis vs CRM order sheets, checks stock, compares customer details and finds
duplicate Order IDs / consignment numbers, reading from Google Sheets via a Google Apps Script web
app (or an uploaded `.xlsx`). **The Apps Script URL is entered by the user and kept in
localStorage — it is not stored in this repo.** See
[`HANDOFF.md`](public/order-compare/HANDOFF.md) for its internals.

---

## 🗂️ Project structure

```
index.html                 # redirects to roster/
public/
├─ wms-modules.js          # the module list + brand + sidebar icons
├─ wms-shell.js            # renders the sidebar from that list
├─ wms-theme.css           # shared look
├─ wms-gate.js / .css      # opening animation + per-device sign-in (not access control)
├─ wms-settings.js         # settings backup / restore
├─ wms-*.js                # shared helpers (dates, stock, picking, trucks, search…)
├─ roster/                 # ตารางกะ
├─ summary/ history/ order-compare/ order-lookup/ stock/ picking/ order-sheet/
├─ warehouse-forms/ jobs/ loadplan/ transport-docs/ transport-forms/ settings/
src/
├─ data/                   # tests for the shared helpers + page-wide checks
└─ transport/              # tests for the transport helpers
```
