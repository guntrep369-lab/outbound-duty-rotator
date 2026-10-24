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

[`public/roster/index.html`](public/roster/index.html) has six tabs: ตารางกะ, พนักงาน, การลา,
คาบเปลี่ยนกะ, วันหยุด, KPI.

- **Two groups, two shifts.** Permanent staff are in group A or B. Each period (คาบ, normally
  28 days) puts one group on กะเช้า 07:00–16:00 and the other on กะบ่าย 16:00–24:00; the next
  period swaps them. A period ends on its end date (วันสุดท้ายคาบ) when one is set; otherwise it
  ends the day before the next one starts, and a last period runs 28 days. Periods can't overlap,
  and the period list warns about days that fall between two periods.
- **Last day of a period:** the afternoon shift works 10:00–19:00 (shown as `10-19`), except
  people whose day off is Saturday.
- **Outsource ประจำ** are named people in group A or B. They rotate with their group, like
  permanent staff, and can have a weekly day off. Data from before groups existed (each outsource on
  a fixed shift) puts each person in the group that works their shift in the period running when
  the page first opens, so that period looks the same.
- **Outsource เสริม** have no names, because who comes isn't known in advance. Each shift has two
  rows of numbers per day: ขอ (how many were requested) and มาจริง (how many came, filled in later).
  Click a number to change it, or use วางแผน OS เสริม to fill in a whole week (Monday to Sunday). It
  can copy the requested numbers from the week before. A day where fewer came than were requested
  turns red.
- **Days off.** Each person has one weekly day off. Holidays (วันหยุดพิเศษ) are `H` for everyone.
- **Moving group or changing a day off from a date.** A move or a new day off applies from the
  date you choose, and the periods before it stay as they were. In the edit window (พนักงาน →
  แก้ไข), pick the date under มีผลตั้งแต่. It starts at the period running today, and the window
  lists earlier changes, each with a delete button. Tick แก้ย้อนหลังทุกคาบ to fix a value that was
  wrong from the start. Clicking the day off or the shift badge in the schedule applies from the
  period on screen. Each change records only what changed, so moving someone's group doesn't undo
  a day-off change already planned for later. Someone who moves group mid-period shows in both
  shifts that period, with striped cells on the days they belong to the other group.
- **Promo days** are highlighted automatically (the double dates 2/2 to 12/12, and the 15th, 25th,
  and 28th of every month), and you can add extra dates.
- **Headcount row.** Under each shift, a มาทำงาน row counts who works each day: staff and
  outsource ประจำ on W or 10-19 (not on leave), plus outsource เสริม (มาจริง once filled in, otherwise ขอ). Click ตั้งขั้นต่ำ to set that shift's minimum. Days below it turn red, except
  holidays, and the period summary says how many days are short.
- **Manual edits and leave.** Clicking a cell opens a menu: W ทำงาน, H หยุด, ลาป่วย (ลป), ลากิจ
  (ลก), พักร้อน (ลพ), or ↺ ตามตาราง to go back to the computed value. Each leave type has its own
  color. "ล้างแก้ไข" clears the W / H edits in the current period and keeps leave, which counts
  toward the year. Click a name, nickname, day off, or shift badge to edit it in place.
- **การลา:** for the chosen month, how many days of each leave type each person took, the team
  total, the year's total per person, and which dates.
- **KPI:** 8 monthly metrics per person, each with a target, plus team pass rate and a
  per-person score chart.

### Where the data lives

Everything is stored in the browser under the localStorage key `wms:roster` and saved as soon
as you change something. Without a shared sheet (below), the same device and browser keeps it,
and another machine starts from the built-in team list until you bring the data over:

- **⬇ ส่งออกไฟล์ / ⬆ นำเข้าไฟล์** on the page exports a `.json` file and reads it back.
  Import also accepts a `shift-program.html` saved from the old standalone schedule program
  (its data is embedded on the `var SAVED_DATA = …;` line) and a Settings backup file.
- **ตั้งค่า → สำรอง** includes `wms:roster` in the key backup file, along with every other
  `wms:` setting.

Names are the identity of a person: manual edits, leave, and KPI values are keyed by name, so renaming
someone moves their data along, and two people can't share a name.

### Sharing the schedule across devices

With a Google Sheet behind [`apps-script/roster-api.gs`](apps-script/roster-api.gs), every device
that has its URL and passcode sees the same schedule. Each device still saves to its own browser
first, so the page keeps working without a connection and sends the changes when it can.

**Setup (once):**

1. Create a new Google Sheet just for this. It can't share a script with the order, stock, or
   transport sheets, because an Apps Script project has only one `doGet` / `doPost`.
2. In the sheet: Extensions → Apps Script. Replace the sample code with `roster-api.gs`.
3. Set `ROSTER_TOKEN` to a passcode of your own, long and hard to guess, then save. The script
   refuses every request until it is set, because the schedule has staff names in it.
4. Deploy → New deployment → Web app. Execute as **Me**, Who has access **Anyone**. Allow the
   permissions it asks for, and copy the URL that ends in `/exec`.
5. On each device: ตั้งค่า → **Apps Script URL — ตารางกะ**, paste the URL and the passcode, fill in
   your name (it shows who saved last), press ทดสอบ, then บันทึก URL.
6. Open ตารางกะ on the device that has the real data first. The sheet is empty, so it asks to send
   this device's schedule up as the starting copy. Devices that connect after that take the
   sheet's copy. A device that already has a schedule of its own asks first.

**How it behaves:**

- The status next to the buttons says what happened: บันทึกขึ้นชีตแล้ว, ตรงกับชีต, ดึงฉบับล่าสุดจากชีตแล้ว, or a
  warning you can tap to try again.
- The page checks for other devices' changes every minute while it's open, and right away when you
  come back to its tab. It doesn't replace what's on screen while an edit popup or window is open.
- The sheet numbers every save. A device that edited an older copy gets the newer one back and
  merges before saving again, so nobody's work is overwritten silently. Edits to different cells
  (manual edits, OS เสริม numbers, KPI, minimums) merge on their own; if both devices changed the same
  cell, the one saving now wins. If both changed the same list (staff, outsource, periods, holidays,
  extra promo days), the page asks which device's list to keep.
- The `log` tab in the sheet records who saved and when.
- After changing the script: Deploy → Manage deployments → edit → Version: New version. The URL
  stays the same.

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
├─ roster/                 # ตารางกะ (+ roster-sync.js: sharing through the sheet,
│                          #   roster-people.js: group / day off by date, leave counts)
├─ summary/ history/ order-compare/ order-lookup/ stock/ picking/ order-sheet/
├─ warehouse-forms/ jobs/ loadplan/ transport-docs/ transport-forms/ settings/
apps-script/
└─ roster-api.gs           # the shared schedule sheet's script (pasted into Apps Script, not served)
src/
├─ data/                   # tests for the shared helpers + page-wide checks
└─ transport/              # tests for the transport helpers
```
