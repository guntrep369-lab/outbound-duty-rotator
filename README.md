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
| — | สมุดกะ · Shift Log | `shiftlog/` |
| — (hidden) | สรุปเช้า · Morning Brief · ย้อนหลัง · History | `summary/` · `history/` |
| ออเดอร์ | เทียบ Order · ค้นหาออเดอร์ | `order-compare/` · `order-lookup/` |
| คลังสินค้า | สต๊อกคงเหลือ · สรุปหยิบของ · เบิกตามออเดอร์ · เอกสารคลังสินค้า | `stock/` · `picking/` · `order-sheet/` · `warehouse-forms/` |
| ขนส่ง | ทำใบงานขนส่ง · เอกสารขนส่ง | `transport-docs/` · `transport-forms/` |
| ขนส่ง (hidden) | ประเภทงานรถ · ผังงานรถวันนี้ | `jobs/` · `loadplan/` |
| ทีมและระบบ | **ตารางกะ · Shift Schedule** · ตั้งค่า | `roster/` · `settings/` |

The site root redirects to `roster/`, so the main link opens the shift schedule.

สรุปเช้า, ย้อนหลัง, ประเภทงานรถ, and ผังงานรถวันนี้ are marked `hidden: true`. They're left out of the sidebar, but the pages still
work by their links, and the sidebar shows them while you're on them. Remove `hidden` to put them
back.

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
  (ลก), พักร้อน (ลพ), ขาดงาน (ขาด), or ↺ ตามตาราง to go back to the computed value. Each leave type has its own
  color. "ล้างแก้ไข" clears the W / H edits in the current period and keeps leave and ขาดงาน, which count
  toward the year. Click a name, nickname, day off, or shift badge to edit it in place.
- **มาสาย and OT.** The same menu has two number fields: minutes late and OT hours for that day.
  A value saves when you leave the field or press Enter. Late only applies to a work day (the field
  is greyed out otherwise, and choosing หยุด, a leave type, or ขาด clears it); OT works on any day,
  including a day off. The cell gets an amber corner for late and a blue corner for OT, and its
  tooltip gives the numbers. They're stored apart from the W / H edits (`late` and `ot`, keyed
  `date|name`), so two devices can record late and OT for the same day without overwriting each
  other.
- **การลา:** for the chosen month, how many days of each leave type each person took, the team
  total, the year's total per person, and which dates. It also counts each person's ขาดงาน days,
  late days (with total minutes), and OT hours.
- **KPI:** 8 monthly metrics per person, each with a target, plus team pass rate and a
  per-person score chart. **Attendance** and **OT Rate** fill in from the schedule:
  - Attendance = (1 − (ขาด days + late days) ÷ days due) × 100. Days due are work days plus ขาด
    days. Leave and days off don't count.
  - OT Rate = OT hours ÷ (work days × 8 hours) × 100.
  - Both count up to today, so the current month is the month so far.
  - A computed value has a dashed border, and its tooltip and the input box say what it came from.
    A value typed in by hand still wins. Clear it (ล้าง) to go back to the computed one.
  - Months before the first ขาด / late mark (for Attendance) or the first OT entry (for OT Rate)
    stay empty. Nobody recorded those then, so a computed 100% / 0% would be wrong.

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
  (manual edits, late / OT, OS เสริม numbers, KPI, minimums) merge on their own; if both devices changed the same
  cell, the one saving now wins. If both changed the same list (staff, outsource, periods, holidays,
  extra promo days), the page asks which device's list to keep.
- The `log` tab in the sheet records who saved and when.
- After changing the script: Deploy → Manage deployments → edit → Version: New version. The URL
  stays the same.
- After a site update that adds a new kind of data (like late / OT), reload ตารางกะ and สมุดกะ on
  every device. A page still open from before doesn't know the new data, and its next save would
  drop it.

> 🔒 The built-in team list is in the page source, and this repo is public. Anyone can read it
> on GitHub.

---

## 📓 Shift log (`/shiftlog`)

[`public/shiftlog/index.html`](public/shiftlog/index.html) is where one shift hands unfinished
work to the next: mostly orders that couldn't ship yet. It replaces the team's Google Sheet of
stuck orders. It has three tabs: ต่องาน (what's still open), ย้อนดูรายวัน (each shift's entries for
a day), and สรุปเดือน.

**Adding an entry:** the two buttons at the top of ต่องาน, **＋ ออเดอร์ติดปัญหา** and **＋ เรื่องอื่น**,
open a form in a popup (full screen on a phone). It shows only what you fill in every time. What
the page already knows is one line you can tap to change: the carrier and consign number, and the
date and shift it's saved under. Esc or ✕ closes it, and it asks first if you've typed something.

- **ออเดอร์ติดปัญหา:** type the Order ID and the page fills in the carrier (ขนส่ง) and consign
  number from today's pulled orders. It lists the order's products with size, quantity, and SKU,
  and you tick the ones that are stuck. Nothing is ticked for you, even when the order has only
  one product, and you can tick several. If a SKU is in today's stock, its row shows คลัง / QA
  counts. Saving with nothing ticked asks first. That case is for a problem with the whole order,
  such as ไม่มีใบปะหน้า.
- Older orders that aren't in today's pull: the form opens **เพิ่มสินค้าเอง** and the carrier
  fields on its own. For one product, type it and save. For more, press **+ เพิ่มสินค้านี้** after
  each one.
- **ติดเพราะ** is a set of buttons in four groups. Tap one; nothing is picked for you.
- **เรื่องอื่น:** anything else the next shift has to follow up. It's just a note.

**Reasons (ติดเพราะ), grouped:**

| Group | Reasons |
|---|---|
| ของ / สต๊อก | หมด / รอเติม · สินค้าจอง · เสียหาย · ไม่มี SKU · แปลงสินค้า |
| ต้องไปรับของ | รับที่ IN · รับที่ QA · รับที่บัญชี · รับสินค้าจาก return |
| ต้องแจ้ง Logis | แจ้งแตกล็อต · เพิ่ม / เปลี่ยนกล่อง · เพิ่ม / เปลี่ยนสินค้า · ยกเลิกของแถม · ไม่มีใบปะหน้า · ขนส่งแจ้งยกเลิก |
| อื่น ๆ | อื่น ๆ |

A reason from the ต้องแจ้ง Logis group ticks **Logis** on its own. แจ้งแตกล็อต is for a bill that
Logis made for 1 box when packing actually needs 2.

**รับทราบงานต่อ:** when open items from earlier shifts are waiting, ต่องาน shows an amber bar at the
top with how many were handed over and a **✓ รับทราบงานต่อ** button. The person starting the shift
reads the list and presses it. The bar turns green and shows who took the handover and when.
ย้อนดูรายวัน shows the same next to each shift.

- It's one record per shift (`ack-<date>-<shift>` in `shiftLog`), so it goes through the shared
  sheet like the other entries. It isn't an item: it never shows in the lists or the month summary.
- If an earlier shift's item arrives after the press (another device saved it late), the bar comes
  back and asks again.
- The name is the one in ตั้งค่า, or the sign-in name. With neither, it asks.

**The ค้างอยู่ list:**

- Everything still open, grouped as รอ Logis ดำเนินการ, รอของ / กำลังตาม, and เรื่องอื่น. Oldest
  comes first, with how many days it has waited. Two days or more is marked red.
- **✓ ส่งออกแล้ว** closes an order. **📝 อัปเดต** adds a dated line (for example "โทรแจ้ง Logis
  แล้ว") without changing the entry. **✎ แก้ไข** opens it in the form, where **ยกเลิกออเดอร์**
  closes it as cancelled. **↺ ยังไม่เสร็จ** opens a closed entry again.
- **📋 คัดลอกส่ง LINE** copies the open list as text for the team chat.
- New entries start on the shift running now: กะเช้า 07:00–16:00, กะบ่าย 16:00 onwards. Between
  midnight and 07:00 counts as the previous day's กะบ่าย.
- Each entry records who wrote it and when (the name in ตั้งค่า, or the sign-in name). It also
  records who updated, edited, or closed it.

**สรุปเดือน:** stuck orders by reason group, reason, carrier, and shift. It also shows the products
that got stuck most, how many orders shipped or were cancelled, how many are still waiting, and
how many days an order takes to close on average. It prints.

**สรุปเช้า** shows a งานค้างในสมุดกะ card with the open count, how many wait on Logis, and the
oldest item's age. When the schedule sheet is set up, it reads the sheet's copy (read-only).

**Sidebar count:** สมุดกะ sits near the top of the sidebar on every page, with the open count next
to it (amber; red once the oldest item has waited two days or more). It pulses while nobody on the
current shift has pressed รับทราบงานต่อ. Hover it for the oldest item's age. The count comes from
[`public/wms-badges.js`](public/wms-badges.js):

- It updates as soon as an entry is saved on this device.
- On other pages it asks the schedule sheet for its version every 3 minutes while the tab is open.
  It downloads the log only when another device has saved something newer, or once after the
  shift changes. It never changes this device's schedule.
- Pages that don't load the sheet settings (ย้อนหลัง, the transport and warehouse forms) don't
  check the sheet. They show the newer of this device's count and the last sheet check.

### Storage

The log is stored in the schedule's data (`shiftLog` in `wms:roster`). It travels with the
schedule's shared sheet, export file, and backup, so there's no separate sheet to set up. Two
devices adding or closing entries at the same time merge without asking. A device that has never
had the schedule can't start the sheet with only log entries. Open ตารางกะ on a device with the
real data first.

> After updating the site, reload ตารางกะ on every device. A schedule page still open from before
> the log existed doesn't know about it, and its next save would remove the log entries.

### Logis view (`/shiftlog/logis.html`)

[`public/shiftlog/logis.html`](public/shiftlog/logis.html) is a read-only page for the Logis team.
It shows three lists: what Logis has to act on, other open orders (for their information), and
orders closed in the last 3 days. It has a search box and refreshes every 2 minutes.

It uses its own passcode, `VIEW_TOKEN`, not the schedule's `ROSTER_TOKEN`. The script filters
before sending: Logis gets only order entries. It gets no staff schedule and no เรื่องอื่น
notes.

**One-time setup:**

1. Open the schedule sheet's Apps Script and paste in the current
   [`roster-api.gs`](apps-script/roster-api.gs).
2. Set `VIEW_TOKEN` to a passcode of its own. It must be different from `ROSTER_TOKEN`. Leaving it
   empty turns the Logis page off.
3. Save, then Deploy → Manage deployments → edit → Version: **New version**. The URL stays the
   same.
4. In สมุดกะ, press **🔗 หน้าสำหรับ Logis** and enter the `VIEW_TOKEN`. The page copies a link to
   send to Logis. The URL and passcode are in the part after `#`, which the browser doesn't send
   to any server. The Logis page saves them on that device and removes them from the address bar.

To stop sharing, change `VIEW_TOKEN` and deploy a new version. Old links then ask for the new
passcode.

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
├─ shiftlog/               # สมุดกะ (+ logis.html: the read-only page for Logis)
├─ warehouse-forms/ jobs/ loadplan/ transport-docs/ transport-forms/ settings/
apps-script/
└─ roster-api.gs           # the shared schedule sheet's script (pasted into Apps Script, not served)
src/
├─ data/                   # tests for the shared helpers + page-wide checks
└─ transport/              # tests for the transport helpers
```
