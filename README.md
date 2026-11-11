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
| คลังสินค้า | สต๊อกคงเหลือ · สรุปหยิบของ · เบิกตามออเดอร์ · เอกสารคลังสินค้า · จัดที่เก็บ | `stock/` · `picking/` · `order-sheet/` · `warehouse-forms/` · `putaway/` |
| สินค้าคงคลัง | ภาพรวมสต๊อก · สต๊อกราย Location · เช็ครายการตัดสต๊อก · LOT / PO ที่ขายออก · จับคู่ Invoice · FIFO สต๊อก · สินค้าคงเหลือ ณ วันที่ | `dashboard/` · `stock-location/` · `cut-check/` · `lot-po/` · `invoice-match/` · `fifo/` · `balance/` |
| ขนส่ง | ทำใบงานขนส่ง · เอกสารขนส่ง | `transport-docs/` · `transport-forms/` |
| ขนส่ง (hidden) | ประเภทงานรถ · ผังงานรถวันนี้ | `jobs/` · `loadplan/` |
| ทีมและระบบ | **ตารางกะ · Shift Schedule** · ตั้งค่า | `roster/` · `settings/` |

The site root redirects to `roster/`, so the main link opens the shift schedule.

สรุปเช้า, ย้อนหลัง, ประเภทงานรถ, and ผังงานรถวันนี้ are marked `hidden: true`. They're left out of the sidebar, but the pages still
work by their links, and the sidebar shows them while you're on them. Remove `hidden` to put them
back.

Groups in the sidebar fold. Only one is open at a time, so the menu fits on a laptop screen without
scrolling. Each folded group shows how many pages it holds. Click a group's head to see its pages;
opening one group closes the one that was open. The group of the page you're on opens by
itself, and if you fold it shut, a purple mark shows you're still in it. A page with no group
(สมุดกะ) keeps whichever group was open on the page before, so the menu doesn't jump while the
page changes. On a phone the groups are chips in the menu strip. Tap one and it slides to the
left with its pages after it.

Moving between modules uses a page transition in Chrome, Edge, and Safari 18.2+. The sidebar stays
still while the new page fades and slides in, and the sidebar keeps its scroll position. Other
browsers, and devices set to reduce motion, switch pages the normal way. The styles are in
`wms-theme.css`. `wms-shell.js` fills the sidebar placeholder in place rather than replacing it,
because replacing it cuts the transition off halfway.

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

## 📍 Stock by Location (`/stock-location`)

Reads the team's hand-entered Transaction sheet through
[`apps-script/tx-api.gs`](apps-script/tx-api.gs) and works out balances by SKU, LOT, PO, and Location.
The script never writes to the Transaction sheet, so the worst a bug can do there is show a wrong
number. The one thing it writes is its own `นับสต๊อก` tab, which holds the stock count.

| Tab | What it answers |
| --- | --- |
| ต้องเติม | Which SKUs will run out of the open locations within 2 or 3 days, and where to pull from (oldest LOT first, LOT 0 last) |
| นับสต๊อก | Today's 20 lines to count, and how accurate the stock is |
| เทียบสต๊อก | Which SKUs differ between the company system and this sheet, and by how much |
| หาของ | Where a SKU is, or what is in a Location |
| ข้อมูลผิด | Rows that look wrong, two short lines each: what and where, then which row to fix, with a hint |
| ประวัติ | Every movement of one SKU, with a running total |

**Suppliers.** Some SKUs come from different factories with different quality, so two suppliers' stock
must never be on sale together. The tab `PO. Truck` (header Truck, PO.) in the ledger file says which
supplier each PO is from, matched on the PO without its `-01` receiving suffix. With that tab:

- หาของ shows a Supplier column for each pile and Location, and says whose stock is open.
- ต้องเติม pulls only from reserve of the supplier that's open now (or reserve whose supplier isn't known).
  When the only reserve is another supplier's, the SKU moves to ไม่มีสำรองให้เติม with a note to wait until
  the open supplier's stock is gone.
- A red box at the top of ต้องเติม lists SKUs that already have two suppliers open, with each supplier's
  Locations.

Without the tab (or with an older script) nothing is blocked and the page says why under the list.

**How balances are worked out.** Same as the balance sheet's SUMIFS, keyed on column B + LOT + PO +
Location: in = any row with a Location รับ, out = rows with a Location เบิก and type เบิก or ขาย. There is
one deliberate difference: Status isn't part of the key. The sheet's formula splits the in-side by
Status but not the out-side, so a spot that was received both blank and เปิด subtracts its out-rows
twice. These spots show up under ข้อมูลผิด as "Status ปนกัน". Status only decides whether a spot counts
as open, using its latest in-row. QA, IQA, and RIB never count as open or as reserve.

**How the ข้อมูลผิด tab points at a row.** Each problem takes two lines in one list per kind, like a table:

- Line one is the SKU, its name, LOT · PO · Location, the amount, and ✓ เช็คแล้ว. A problem with no SKU
  shows what was typed instead.
- Line two says what to fix and which row: a row button (`8438 ↗`) that opens the row in the sheet, that
  row's details (type, qty, date, who), how many other rows there are, and a short 💡 hint. For Status
  ปนกัน it also says what the Status should become, to match the other in-rows.
- ดูเพิ่ม ▾ opens the full sentence, every row behind it, the full hint, and links to the SKU's history
  and to all its piles.

- **Negative balance.** The script walks the pile's rows in sheet order and points at the row where the
  balance last went below zero and never came back. Rows before that aren't the cause of today's
  shortfall.
- **Out rows only.** Points at the first out row.
- **Mixed Status.** Points only at the in-rows whose Status differs from the rest. On a tie, it goes by
  the latest in-row.
- **💡 hint.** For negative balances and out-only piles, the page looks at the same SKU's other piles:
  - The same LOT/PO at another Location suggests the out row has the wrong Location.
  - The same Location with another LOT/PO suggests the wrong LOT/PO.
  - A pile holding exactly the shortfall comes first.
  - Piles that the problem rows transferred into themselves are skipped.
  - If the whole SKU is negative, the hint says an in-row is probably missing instead.
  - It's a hint, not a fix: check the shelf before editing the sheet.
- **✓ เช็คแล้ว.** Hides a card on this device only, in `localStorage`. If the card's numbers change after a
  refresh, it comes back. Ticks older than 90 days are forgotten.
- **Older script.** The row details need the current `tx-api.gs`. With an older one, the cards show row
  numbers only, plus a note asking for a redeploy.
- **Ledger tab copied in with IMPORTRANGE.** You can't type in a copy, so a row link should open the
  team's real sheet. Put the link of the real sheet's Transaction tab (copied from the address bar, with
  `#gid=`) in `REAL_SHEET_URL` at the top of `tx-api.gs`. Every row link on every page then opens the
  same row number in the real sheet. The script only uses that link: it never opens or reads the real
  sheet. Until it's set, the note under the ข้อมูลผิด tab says the links still open the copy. Row numbers
  stay the same because the copy's formula sits on the same row it imports from (header typed in row 1,
  formula in A2 importing from A2).
- **IMPORTRANGE range nearly full.** A range like `Transaction!A2:O30000` stops at row 30,000, and
  rows after it never reach the copy, with no error anywhere. Within 3,000 rows of that end, the top
  bar shows a yellow pill with how many rows are left. Raise the number at the end of the range in
  the formula.

**How the stock count works.** The first person to open the นับสต๊อก tab each day gets a list of 20 lines,
one per SKU + LOT + PO + Location, and everyone else that day sees the same list. To send it straight to
a counter's phone, use `/stock-location/?tab=count`.

- Up to 10 lines are recounts and risky spots: last count didn't match, then negative balances, sales from
  a closed location, and mixed Status. The rest are random lines from reserve racks.
- The counter doesn't see the system balance until after sending, so they count what's on the shelf.
- The balance is worked out when the count is sent, so goods moved earlier that day don't show as a
  mismatch. Sale rows entered late still can, which is why open locations aren't picked at random.
- A mismatch comes back for a recount the next day. If the recount doesn't match either, fix it with a row
  in the Transaction sheet; the app doesn't change that sheet. Counted lines rest for 30 days.
- Stock accuracy counts only the random lines, because risky lines were picked for being likely wrong.
- A result can be written once. Anyone with the URL can fill in today's blank results and send SKUs from the
  เทียบสต๊อก tab, but can't change a result that's already saved.

**How the stock comparison works.** The company system knows one number per SKU, not the Location, so the
เทียบสต๊อก tab compares the two sides per SKU. It reads the same URL as สต๊อกคงเหลือ (`/stock`) and changes
neither side.

- Difference = company system − Transaction. The Transaction side includes negative spots, because a wrong
  LOT shows as plus in one spot and minus in another while the SKU total stays right.
- SKUs match on the sheet's long code first, then its short code. If fewer than half of the sheet's SKUs are
  found, the tab warns that the two sides may use different codes.
- Each row can show clues: rows that change the SKU's total (QTY that isn't a number, incomplete rows),
  negative spots, and a Location whose balance equals the difference.
- A warning appears when the two sides were pulled more than an hour apart. The times shown are when the app
  read the data, not when the company system last updated it.
- QA and NEW WH are shown but not compared, because the company's QA warehouse may not line up with the
  sheet's QA Location.
- Internal supplies aren't compared, because they never enter the company system. A SKU counts as internal
  when its code contains Thai letters and the company system has no stock of it. These SKUs are left out of
  every figure and listed in a folded section under the table. If the company system ever shows stock for one,
  it's compared like any other SKU.

**Finding out which side is wrong.** Tick SKUs in the เทียบสต๊อก tab and press ส่งเข้าใบนับ. The script adds
one line per Location that has a balance, plus a ที่อื่น line for stock the sheet doesn't know about. Each
line counts every LOT and PO together, because the company system can only be compared at SKU level. Once
every line is counted, the tab shows the result:

| Result | Meaning | What to do |
| --- | --- | --- |
| Transaction ผิด | The real stock matches the company system | Fix the Transaction sheet |
| ระบบบริษัทผิด | The real stock matches Transaction | Tell whoever looks after the company system |
| ไม่ตรงทั้งคู่ | The real stock matches neither side | Count again, and if the number holds, fix both sides |

- The app compares differences, not totals, so sales recorded on both sides after the count don't change the
  result.
- A round that isn't fully counted by the end of the day shows as นับไม่ครบ, and the SKU can be sent again. A
  fully counted SKU can be sent again the same day.
- These lines don't count toward the daily 20 or the accuracy figure, and they don't come back as recounts.
- The app adds at most 300 of these lines a day, and the script refuses a send that would go over.
- Results are stored in the นับสต๊อก tab of the Transaction file. This feature needs the current `tx-api.gs`,
  so redeploy it as described under "After changing the script".

**Setup (once):**

1. Open the Transaction file, then Extensions → Apps Script. Replace the sample code with `tx-api.gs`.
   If the file's script already has a `doGet`, create a new project from
   [script.google.com](https://script.google.com) instead and change `getActiveSpreadsheet()` to
   `openById(...)`, because a project has only one `doGet`.
2. Choose `installBackup` in the toolbar and press Run. Allow the Drive and Sheets permissions. This
   sets a nightly copy of the whole file into the Drive folder `WMS Transaction Backup` and makes the
   first copy right away. The newest 30 are kept; older ones go to the Drive trash.
   In the copy, a tab that pulls data from outside the file (`IMPORTRANGE` and the other import
   formulas) is overwritten with the values it showed at that moment. Otherwise the backup would hold
   only the formula and show whatever the source has on the day you open it. Only the copy is written;
   this file and the import's source sheet are not touched. The values go in 5,000 rows at a time,
   with retries if Google fails. If it still fails, the copy is renamed with `(ไม่ครบ)` at the end and
   doesn't count as the latest backup. The 💾 pill's tooltip lists the tabs stored as values.
3. Choose `installShared` and press Run. This refreshes the shared copy on a timer (see "Everyone sees
   the same numbers" below). It's optional: without it, the copy changes only when someone presses ดึงใหม่.
4. Deploy → New deployment → Web app. Execute as **Me**, Who has access **Anyone**. Copy the URL that
   ends in `/exec`.
5. On each device: ตั้งค่า → **Apps Script URL — Transaction**, paste the URL, press ทดสอบ, then
   บันทึก URL.

The URL works like a key: anyone who has it can read the balances, so keep it out of this repo. Keep
the balance sheet running until the two agree, and compare the spots listed under "Status ปนกัน" first.

**After changing the script:** saving isn't enough, because the web app keeps running the old version.
Go to Deploy → Manage deployments → the pencil icon → Version: **New version** → Deploy. The URL stays
the same.

**Everyone sees the same numbers (ข้อมูลกลาง).** The script keeps its last result as one shared copy, and
every device reads that copy. Before this, each device read the sheet on its own, so two people could be
looking at numbers from different times.

- Opening the page loads the shared copy, which is much faster than reading the sheet. If the copy is
  more than an hour old, the script reads the sheet again first.
- 🔄 ดึงใหม่ reads the sheet again and replaces the shared copy. The bar says when and who:
  `ดึงเมื่อ 10:32 · ชื่อคนกด`, or `อัตโนมัติ` for the timer.
- Each open page asks the script once a minute whether a newer copy exists. The reply is a few hundred
  characters. When there is one, the page loads it without anyone pressing a button. It waits while someone
  is typing, so a count being entered isn't lost.
- If someone is already reading the sheet, ดึงใหม่ waits for their copy instead of starting a second read.
- The copy is a JSON file in the Drive folder `WMS ข้อมูลกลาง` of the script's owner. The script still
  doesn't write to the Transaction sheet. Don't move or rename the file; if it's deleted, the next read makes
  a new one.

`installShared` refreshes the copy every 30 minutes from 8:00 to before 18:00 (the file's time zone). It
also refreshes the ยอดขายรายวัน copy for the period the Stock Cut Check page used last, and the FIFO copy
(see FIFO Stock) every 2 hours. `stopShared` turns the timer off. Each run takes about as long as pressing ดึงใหม่. A free Google account gets 90 minutes of
timer runs a day across all scripts, so keep an eye on it if more timers are added.

Until the new `tx-api.gs` is deployed, the page works as before, with each device reading on its own.

---

## ⚖️ Stock Cut Check (`/cut-check`)

Compares what was cut from stock with the month-end order reports, to find wrong and duplicate cuts.
[`apps-script/cut-api.gs`](apps-script/cut-api.gs) reads a Google Sheet with four tabs, works everything
out on the server, and returns only the summary and the lines that differ. It never changes the four
tabs. The only thing it writes is the fix log (บันทึกการแก้, below), in a tab of its own.

| Tab in the sheet | What it holds |
| --- | --- |
| `ตัดสต๊อกระบบ Transaction` | Cuts in the team's system. The column after `SUM of` has no header and says where the row came from (`JST`, `CRM`, or `โอนย้าย`) |
| `ตัดสต๊อกระบบ TRcloud` | Cuts in the company system. The cut amount is `เบิกออก` minus `รับเข้า`, because a correction is entered as a receipt on the same order |
| `Report order ระบบJST` | Shipped orders from JST, with the order status (`สถานะ`, optional) and the shipping status |
| `Report order ระบบ CRM` | Shipped orders from CRM |
| `Report order ระบบโอนย้าย` | Optional. The transfer report (allocate-out export), pasted with its header row |

Columns are found by their header, so moving a column is fine. Renaming a tab or a header makes the
check stop with a message rather than read the wrong column.

Lines are matched on order number + SKU. Online order IDs can't be used, because the sheet rounds some
of them into scientific notation. An order number with ` · date` on the end counts as the same order.

**Transfers:** a transfer to a store shows up in three places. JST has a placeholder order whose SKU
starts with `STR` (named `Store_DT_…`) and is never cut. The goods themselves are cut as `โอนย้าย` rows,
whose `เลขภายใน` (Transaction) and `อธิบายรายการ` (TRcloud) hold the transfer slip number. The transfer
report lists each slip's SKUs under `หมายเลขใบโอนย้ายสินค้า`, the same slip number, with
`จำนวนการโอนย้ายสินค้า` and `วันที่จัดส่ง`.

- With the transfer tab, each slip + SKU is matched like an order line, so a transfer cut too much,
  too little, or for a slip the report doesn't have is listed with the other mistakes. The destination
  store (`โอนเข้าคลัง`) is shown where an order shows its carrier.
- Without it, or while it only has a header row, transfers are only checked against each other: the two
  systems should agree.

**Shipped, then cancelled:** a JST line whose `สถานะ` is `จัดส่งแล้ว` but whose `สถานะขนส่ง` is
`ยกเลิกแล้ว` left the warehouse before the customer cancelled, and the goods came back. It must still
be cut on its warehouse-out date, so it is checked like any shipped line. Not cut is listed under
ยังไม่ตัด, and a correct cut counts as matching. A `ยกเลิกแล้ว` line with any other `สถานะ` was cancelled
before it left, so it should not be cut. Without the `สถานะ` column, every `ยกเลิกแล้ว` line is treated
that way.

**Tab ตัดผิด / ตัดเกิน:**

| Type | Meaning |
| --- | --- |
| ตัดเกิน | Cut more than the report's quantity. The dates show if it was cut twice |
| ตัดผิด SKU | The order is in the report, but this SKU isn't part of it |
| ตัดแต่ไม่มีใน Report | Cut, but the order number isn't in either report |
| ขนส่งยกเลิกแต่ตัดแล้ว | The report says the order was cancelled before it left the warehouse, yet stock was cut |
| สถานะขนส่งว่างแต่ตัดแล้ว | A blank shipping status means the order hasn't shipped, yet stock was cut. The cut should be reversed |
| โอนย้ายไม่ตรงกัน | A transfer whose quantity differs between the two systems |

**Export the orders you pick:** each row on this tab has a tick box, and ticking one row picks the whole
order. **เลือกทั้งหมด** next to a heading picks every order of that type that the search and filters show.
A bar at the bottom counts the orders and has **⬇️ Export Excel**. Up to 500 orders go in one file:

- Sheet `สรุปปัญหา` lists every problem line of those orders, including lines from ยังไม่ตัด, with the
  numbers and dates shown on the page.
- Sheets `Report JST`, `Report CRM` and `Report โอนย้าย` hold those orders' rows from the report tabs, with
  every column. The first column, `ปัญหา`, names the problem for that SKU. A blank means that SKU is fine.
  An order that isn't in any report only shows in the summary.

The report rows come from a new script call, so an older `cut-api.gs` gives the summary sheet only, and
the page says so.

**Tab ยังไม่ตัด:** lines where the report has more than was cut. If a whole day of a system (at least 5
orders) is missing from one side, those lines are grouped into one notice. An order missing entirely
from one side with 5 or more SKUs becomes one row.

**Tab ที่มาของยอด:** starts from the report's total and adds each cause until it reaches the real total
of each system. Every row in the sheet falls into exactly one cause, so the two must meet to the piece.
If they don't, the page says the numbers shouldn't be trusted.

**Tab เทียบรายวัน:** checks the quantity that left per SKU per day in three places: the rows marked `ขาย`
in the `รับ/เบิก` column of the Stock by Location ledger, the Transaction cut tab, and TRcloud. The ledger's
column B is the code that matches the cut tabs' SKU. On the page the three columns are labelled UAT (the
ledger), Uploadยิงออก (the Transaction cut tab) and TRcloud. The ตัดผิด / ตัดเกิน and ยังไม่ตัด tabs use
the same Uploadยิงออก label for the Transaction cut tab.

- The list is one row per day. Press a day that differs to see its SKUs in a window over the blurred
  page, or switch to ราย SKU รวมทั้งช่วง for the SKUs whose totals over the whole period still differ. Red marks the number that differs from the
  other two, and orange means all three differ.
- A gap in one direction on a day and the opposite direction on the next day is labelled น่าจะลงคนละวัน,
  because the same goods were entered a day apart. Totals over the two days agree. A row only gets this
  label if nothing else is left over after taking the shift out.
- Days after the ledger's last sale date aren't compared. The page lists them with the other figures,
  so they don't look like a shortage.
- A fourth column, Report ควรออก, shows how much should have left that day. It is the JST and CRM reports
  by their warehouse-out date and the transfer report by its `วันที่จัดส่ง`, each report line on its own
  date, so an order shipped in two rounds counts on both days. Lines that shouldn't leave are taken off (a
  cancelled shipment, a blank shipping status, or a code that isn't warehouse stock, whether or not it was
  cut). Without the transfer tab, transfers are taken from the Transaction cut tab instead.
- The three systems are still judged against each other first, and the tab's count is that result. The
  เทียบกับ Report column is a second check. Some orders are cut on a different day from their report date,
  so the same น่าจะลงคนละวัน rule applies to it, and a day only counts as matching the report if every SKU
  matches.
- Press a SKU in a day's window (or a row in the search results) to see what makes up that cell, in the
  same window with a button back to the day's SKUs. ✕, Esc or a click outside the window closes it. The
  first line says where to look: if UAT is the odd one out, the ledger rows; if Uploadยิงออก or TRcloud
  is, the orders; if all three agree but miss the report, the orders too, for a status change or a
  different date.
- The orders part lists each order whose cut that day differs from what it should be, with what kind of
  problem it is and, where it was entered on another day, which day. Orders that were cut in full but on
  another day are grouped by date with a count and a few order numbers, because a day entered a day late
  holds hundreds of them. Orders that match are a count. The script only sends this for cells where
  Uploadยิงออก, TRcloud and Report ควรออก differ, and at most 40 orders per cell.
- The ledger part lists that day's `ขาย` rows for the SKU: row number, Location, LOT, PO, quantity and
  who entered it. The ledger has no order numbers, so this is as close as it gets. The row number opens
  the sheet at that row.

**Tab TRcloud เทียบ Report:** compares what TRcloud cut each day with what the report says should have left
that day (the same Report ควรออก as เทียบรายวัน), one row per order + SKU + day. Each day shows the pieces
short and over, and that day's totals for both sides. Three cards split the rows; press one to show only
that group:

- TRcloud ตัดขาด · ต้องตัดเพิ่ม: TRcloud cut less than the report, or nothing.
- TRcloud ตัดเกิน · ต้องคืน: TRcloud cut more than the report. This includes wrong SKUs, orders that aren't in
  the report, and orders cancelled before they left.
- ตัดคนละวันกับ Report: the month total is right, but TRcloud entered it on another day. The row says which.
  Fixing it takes two rows, one on each day.

This tab only looks at TRcloud. A row where Uploadยิงออก is wrong but TRcloud is right doesn't appear.

Tick rows, a whole day (เลือกทั้งวัน) or everything the filters show (เลือกทุกรายการที่เห็น), then press
**⬇️ Excel ลง TRcloud**. The file has one sheet in the team's TRcloud layout: `SKU`, `วันที่`,
`จำนวนที่เพิ่มขึ้น`, `จำนวนที่ลดลง`, two blank columns, `ออเดอร์`, `แผนก`, `คลังสินค้า`, `ขนส่ง`.

- A short row goes in `จำนวนที่ลดลง` (cut more). An over row goes in `จำนวนที่เพิ่มขึ้น` (give stock back).
- `วันที่` is the day that differs, not today, so TRcloud's daily totals line up with the report.
- `แผนก`, `คลังสินค้า` and `ขนส่ง` come from that order's TRcloud rows. An order TRcloud doesn't have yet gets the
  department and warehouse TRcloud uses most for cuts, and the report's carrier.

The rows come from a newer `cut-api.gs`. With an older script, the tab says to paste the new one and press
ตรวจใหม่.

**Tab แก้แยกตามระบบ:** everything from the other tabs, sorted by the system where it has to be fixed rather
than by JST or CRM, so each list can go to whoever looks after that system. Each item says how many pieces
to add (+) or take back (−), and the copy button puts the list on the clipboard as columns to paste into a
sheet or a chat. The lists are sorted by date, then the largest first.

- Uploadยิงออก and TRcloud: every order line whose cut in that system isn't what the report says, plus
  whole days that were never entered. TRcloud's take-back is a receipt (`รับเข้า`) on the same order.
- ชีตทีม (UAT) has no order numbers, so its list comes from the daily comparison in two ways: a day + SKU
  where the ledger differs from the other two systems, which agree with each other, and an order that
  Uploadยิงออก or TRcloud got wrong where the ledger, on every day that order was cut, has the same number
  as the system that's wrong. That means the ledger carries the same mistake. Entries made a day apart
  aren't listed, since the two days already add up. A day + SKU where all three differ is only counted,
  because it can't tell which one is wrong.
- A row whose day + SKU differs somewhere opens the same window as เทียบรายวัน. The ledger list needs the
  sales pulled first (ดึงยอดขาย).

**ดูที่มา (why the ledger didn't cut):** Uploadยิงออก and TRcloud cut whatever is on the order without
checking the ledger, but the team can only cut what the ledger has at a location. When the ledger cut less
than the other two systems (which agree), the window for that day + SKU has a **🔍 ดูที่มา** button. In
the ชีตทีม list those rows say so. The button reads the whole ledger once, from the same `?api=tx-fifo`
shared copy the FIFO page uses. It then shows:

- The SKU's balance in the ledger before that day and now. Balances follow the same rules as the stock
  page.
- If there was enough, the ledger simply missed the sale, and the window suggests one ขาย row.
- If there wasn't, it looks for the real product the code is made from. Most often this is a gift code
  (`FRE…`): the same item as a real SKU, picked from the real SKU's shelf without a แปลงสินค้า entry. The
  pair comes from tab `MASTER แปลงสินค้า` first. Next come past แปลงสินค้า rows in the ledger (a เบิก
  of one SKU next to a รับ of another with the same LOT, PO and quantity). Last is a product with the same
  name once the word แถม is removed.
- It also shows how much of the real product the ledger cut that day compared with Uploadยิงออก, and where
  the real product sits now. It suggests three rows: เบิก the real SKU, รับ the gift code, ขาย the gift
  code. They copy as columns A to L to paste into the ledger. The person entering them fills in the name
  column and checks the real stock first.
- If no pair turns up, the window says so and asks for the pair to be added to `MASTER แปลงสินค้า`.

Finding pairs from past แปลงสินค้า rows needs a `tx-api.gs` that marks those rows (`conv: 1` in
`?api=tx-fifo`). With an older script, the window still matches by `MASTER แปลงสินค้า` and by name, and
says the script is out of date.

**บันทึกการแก้ (fix log):** once an item is fixed in its system, press **✓ แก้แล้ว** on that row. The press
goes into tab `บันทึกการแก้` of the cut workbook, with the time, who pressed it (the name signed in on
the device), and the amount that needed fixing. The script makes the tab the first time. Every device
reads the same tab, so two people don't fix the same item twice (returning stock twice, say). The tab only
grows: ยกเลิก adds a row that cancels the last แก้แล้ว, rather than deleting it.

Press ตรวจใหม่ after the fixes. Each marked item then shows one of these:

| Status | Meaning |
| --- | --- |
| รอตรวจใหม่ | Marked, but no check has run since. The row is dimmed and left out of the copy. |
| ยังไม่หาย | Checked again and the same amount (or more) still needs fixing. |
| แก้ไปบางส่วน | Checked again and less is left. |
| ยอดกลับข้าง | Checked again and the sign flipped, e.g. +1 became −1. It was probably fixed twice. |

An item that no longer appears after the check is recorded as `ตรวจแล้วหาย` without anyone pressing
anything, and moves to the ✓ ตรวจแล้วหาย list under the table, with the name of whoever fixed it. If it
comes back later, it's marked as back again. The filters (ทั้งหมด / ยังไม่แก้ / รอตรวจใหม่ / ต้องดูซ้ำ)
narrow the table, the copy button takes only the items that aren't waiting for a check, and
**✓ แก้แล้วทั้ง N รายการ** marks every unmarked item in the list at once, after a second press to confirm.
An item is matched on system, date, order and SKU, so an over-cut that turns into an under-cut is still
the same item. Items over the result's size limit can't be judged gone, so they stay as they were.

The two scripts belong to different files and don't know each other, since linking them would put a file
ID in this public repo. The page calls both and compares the answers. It needs **Apps Script URL —
Transaction** set too. ดึงยอดขายใหม่ re-reads only the ledger, so a fix there can be checked in seconds.

These aren't errors, so they appear only under ที่มาของยอด:

- Codes that aren't warehouse stock, as long as they weren't cut: a code starting with `STR` (the
  placeholder for a store transfer), or one that doesn't match three letters + ten digits. If one of these
  was cut, it's listed as usual.
- A report line with no shipping status or a cancelled shipment that wasn't cut. A blank shipping status
  means the order hasn't shipped.
- Without the transfer tab, transfers that match in both systems.
- Cuts dated outside the report's period, for orders that aren't in the report. They wait for next
  month's report.
- TRcloud rows from department `IV`, which adjust stock and have nothing to do with orders.
- Cuts that were reversed back to zero.

The page warns when the Transaction tab ends on an exact multiple of 20,000 rows, because the tab's
formula joins chunks of that size and may be cutting off newer rows. It also warns when a cut tab stops
before the report does, since those orders would otherwise all look uncut.

**Setup (once):**

1. Open the Google Sheet, then Extensions → Apps Script. Replace the sample code with `cut-api.gs`.
2. Deploy → New deployment → Web app. Execute as **Me**, Who has access **Anyone**. Copy the URL that
   ends in `/exec`.
3. On each device: ตั้งค่า → **Apps Script URL — เช็ครายการตัดสต๊อก**, paste the URL, press ทดสอบ, then
   บันทึก URL. The test reads all four tabs, so it can take a few minutes.

**Updating to a version with เทียบรายวัน:** both `cut-api.gs` and `tx-api.gs` have new code. In each script
project, paste the new file, then Deploy → Manage deployments → pencil icon → Version: New version → Deploy.
The URLs stay the same. Until then, the tab says which script is out of date and the other tabs keep working.
The Report ควรออก column needs the newer `cut-api.gs` as well. With an older one, the tab compares the
three systems only and says to paste the script again. Reading `Report order ระบบโอนย้าย` needs the
same update, and ที่มาของยอด says so until it's done. The order and ledger-row breakdown of a cell needs
both newer scripts. Until each is updated, the panel says which one, then press ตรวจใหม่ or ดึงยอดขายใหม่.
An older `cut-api.gs` also puts all of an order's Report ควรออก on its last report date, so an order shipped
in two rounds looks short on the first day and over on the last. Paste the new one and press ตรวจใหม่.

**Updating to a version with บันทึกการแก้:** paste the new `cut-api.gs` and deploy a new version as above.
Until then, the แก้แยกตามระบบ tab says the script is out of date and hides the แก้แล้ว buttons. The rest of
the page works as before.

The URL works like a key: anyone who has it can read the order numbers and SKUs in the result, and can add
rows to the fix log, so keep it out of this repo. The check result leaves out online order IDs and tracking
numbers. The Export call returns whole report rows, those included, but only for the orders you picked.

**Everyone sees the same result (ข้อมูลกลาง).** This works the same way as on Stock by Location:

- Opening the page loads the shared result when it is newer than the one on the device. The page never
  starts a check by itself, because a check takes minutes.
- 🔄 ตรวจใหม่ checks again, replaces the shared result, then reads the ledger again for the same period.
  The bar says `ตรวจเมื่อ … · ชื่อคนกด`.
- Each open page asks once a minute. It loads a newer result, a newer ledger copy for the same period, or
  new fix-log rows when someone presses แก้แล้ว on another device. It waits while a popup is open or someone
  is typing in the search box.
- While someone else's check is running, the bar says who started it and the button waits for that result.

To check on a timer too, choose `installShared` in the cut file's script and press Run once. It checks every
2 hours from 8:00 to before 18:00. The first run takes as long as a normal check. This script now saves a file
in Drive and runs on a timer, so Google asks for those permissions the first time. Until the new `cut-api.gs`
is deployed, ตรวจใหม่ works as before and only that device sees the result.

The last result also stays on the device, so reopening the page doesn't wait. The Lot & PO Out page reads it
from there.

**When the file gets too big to check.** Apps Script stops any run at 6 minutes without saying why, so the
script times itself:

- It stops by itself after about 5 minutes and says which tab it was on, how far it got, and how many seconds
  each tab took to read and to work through. The fix is to move closed months out of the file.
- A check that fails, or one Apps Script cut off, shows on every device as `ตรวจไม่สำเร็จ … ⓘ` with its time
  (`รอบอัตโนมัติไม่สำเร็จ` for a timer run). Press it to read why. It goes away after the next check that
  succeeds.
- A check that works carries the same timings. Hover over `ตรวจเมื่อ` to see seconds and rows per tab, so
  you can tell how close the file is to the limit.
- Dates are formatted once per 15 minutes of clock time, not once per row. Formatting a date is a call to a
  Google service, which is slow when made for each of several hundred thousand rows.

---

## 🏷️ Lot & PO Out (`/lot-po`)

The report for accounting: on each day, which LOT and PO every SKU that was sold came from. It reads
the ledger's `ขาย` rows through the same `tx-daily` call that เทียบรายวัน uses, with the Transaction URL
from the settings page. It never writes to the sheet.

**Date range:** pick a whole month from the list, or set your own first and last day. Accounting's
Report for a month runs a few days into the next month, so the report has to cover the same days.

- After a check on the cut-check page, a button sets the range to that Report's dates
  (`ใช้ช่วงของ Report 1/3 ถึง 3/4`) and fetches straight away. With no data fetched yet, the page starts
  on that range, otherwise on this month.
- Changing a date doesn't fetch on its own. The page says which range is picked and which one is still
  shown until you press ดึงข้อมูล.
- A range can be up to 62 days, about one month plus the start of the next. Longer ranges get too big
  to keep on the device.
- The by-order view fetches the same range from the cut workbook.

- Rows with the same day, SKU (column B), LOT and PO become one line. The location isn't part of the
  line, but it's shown, with links to the ledger rows behind it.
- A SKU that went out from several LOT/PO on one day gets one line for each, oldest LOT first.
- A PO written with `-01`, `-02` and so on at the end (`9900000001-05`) is the same PO, received over
  several days. The two digits are the day it came in. The report drops them, so accounting sees the
  real PO, and rounds in the same LOT become one line. The page shows which rounds a line holds
  (`รวมรอบ -05 -20`). Searching with the ending still finds the line.
- `LOT 0`, `PO 0` or a blank one means the LOT or PO isn't known (mostly stock from the last count). These
  lines are marked and can be listed on their own.
- A quantity typed as text isn't added, the same as the balance sheet's SUMIFS, and the line says so.
- Copy pastes into Excel as columns (วันที่, SKU, SKU ที่ขาย, ชื่อสินค้า, LOT, PO, Supplier, จำนวน, หมายเหตุ), with the SKU on
  every line. Download gives the same table as a CSV that Excel opens in Thai. Both take the whole
  selection, even when the page only draws the first 500 lines.

**By order (รายออเดอร์):** the ledger sells per SKU per day and has no order numbers. This view takes
the day's orders from the cut workbook's `ตัดสต๊อกระบบ Transaction` tab, through `cut-api.gs`
`?api=cut-orders` (the cut-check URL in the settings page), then hands the day's LOT/PO to them: oldest
LOT first, to orders in the tab's row order. It's an allocation, not a record of which order took
which lot. On a day where เทียบรายวัน matches, every piece gets a LOT/PO. Otherwise the rest shows as
ยอดไม่ลงกัน, either an order the ledger didn't sell or a sale with no order. Days after the ledger's last
sale date are left out until the ledger reaches them. Copy and the CSV get วันที่, ระบบ, เลขออเดอร์,
หมายเลขคำสั่งซื้อออนไลน์, บริษัทขนส่ง, SKU, SKU ที่ขาย, ชื่อสินค้า, LOT, PO, Supplier, จำนวน, หมายเหตุ. The orders are fetched
when the view is opened (about 4 MB a month) and aren't kept on the device.

- The online order number and carrier come from the same tab: columns `เลขคำสั่งซื้อออนไลน์` and `Sup`.
  CRM orders and transfers have no online number, so that cell is blank.
- An online number is 16–18 digits, and Excel turns any number longer than 15 digits into
  `9.9E+17`, losing the last digits. So the file writes it as `="…"`, which Excel and Google Sheets
  keep as text.
- Some cells in the cut tab were already rounded by the sheet. Those digits can't be recovered, so the
  file shows them the way the sheet does (`9.90123E+17`) and says so in หมายเหตุ. The page says how many
  orders this hit. To stop it, set that column to Plain text before pasting the next month's data.
- The search box finds online numbers too. This needs the `cut-api.gs` version that sends `refs`;
  until it's deployed, the page says so and the two columns are blank.

**Back to the purchase SKU (แปลงคืน):** some goods are bought under one SKU and converted to another
before they're sold, but accounting wants the SKU they were bought as. Add a tab named
`MASTER แปลงสินค้า` to the Transaction ledger file (the one `tx-api.gs` is attached to). Row 1 is the
header, then one pair per row:

| SKU ตอนซื้อ | SKU หลังแปลง |
|---|---|
| ABC-1001 | ABC-1001-S |

- One piece after converting is one piece as bought (1 to 1), so quantities don't change.
- The script finds the columns by their headers: a SKU header with ซื้อ is the purchase SKU, one with
  แปลง or ขาย is the converted SKU. If it can't tell, it uses A as the purchase SKU and B as the
  converted one, and the page says so.
- Lines are matched to orders with the SKU that was sold, then turned back. The SKU column shows the
  purchase SKU and the name the ledger has for it. The SKU as sold moves to the SKU ที่ขาย column, which
  stays blank on lines that weren't converted.
- A chain (bought as A, converted to B, then to C) goes all the way back to A.
- A converted SKU paired with more than one purchase SKU isn't turned back, since there's no telling
  which one. Its lines are flagged.
- The แปลงคืน filter lists the converted lines and the flagged ones.

**Estimated LOT for LOT 0 (ประมาณ LOT):** LOT 0 PO 0 comes from goods returned by customers, which
can't be told apart by lot, and from the Q3 count, where pillows, bedding sets and duvets had no LOT or
PO printed on them. `public/wms-lot0.js` reads the whole ledger (the shared `tx-fifo` copy) and gives
each LOT 0 sale an estimated LOT/PO from where its goods came in.

- Each SKU + location's LOT 0 pile is a queue. Sales and issues take from the front, first in first
  out. A transfer moves its part of the queue to the new location.
- A return (Note has `RETURN` or `คืน`) or an `M/E` receipt is taken to be what that SKU shipped most
  recently: the LOT/PO of the sales rows above it, newest first. Each sold piece can be claimed by one
  return only.
- A product conversion (แปลงสินค้า) takes the LOT/PO of the source SKU in its pair.
- Stock-count pieces need the balance from before the count, which isn't in the ledger. Add a tab
  named `ยอดก่อนนับ` to the Transaction file (the same file as `MASTER แปลงสินค้า`) and paste one of:
  - the old ledger as it was, headers included (columns A..L like the Transaction sheet). The script
    adds receipts and takes off issues and sales per SKU + LOT + PO, and dates each lot by its GR row;
  - or a table with headers `SKU` · `LOT` · `PO` · `จำนวน`, plus `วันที่รับ` if known. Header names
    can vary a little (`รหัส`, `ล็อต`, `qty`, `คงเหลือ`, `ยอด`, `date`).

  Counted pieces with a known LOT are taken off their own lot first. The rest of the count's LOT 0 is
  split over the remaining lots newest first (latest receive date, then latest LOT month), because
  older goods should have shipped first. If the tab lacks a SKU or has too little, those pieces stay
  unknown and the box names the SKUs. Without the tab, the box shows these steps.
- Pieces with no source (the ledger sold more LOT 0 than it received) stay unknown.
- Estimated pieces become their own lines with a `ประมาณ` tag, never merged with lines the ledger
  recorded. The หมายเหตุ column starts with `ประมาณจาก…` and the row it came from, so accounting can
  filter them in Excel. A box above the table says how much was estimated and what the rest is
  waiting for. The `LOT ประมาณ` filter lists the estimated lines, and the box can turn estimating off.
- The ledger isn't changed. Only the estimates for the month's sales rows are kept on the device.
- The month's sales rows and the whole ledger are read at different times. If someone inserts or deletes
  a row in between, every row number below it shifts. So sales rows are matched to the whole-ledger
  copy by SKU + quantity + date, in sheet order, not by row number, and the box says how many rows
  were matched that way. A sales row that isn't in the copy at all (entered after it was read, or
  edited since) says so and isn't estimated.
- A `ยอดก่อนนับ` tab pasted as an old ledger has the same headers as the Transaction sheet. The script
  never takes it for the ledger, even if it's moved in front of the Transaction tab.
- This needs the `tx-api.gs` version that flags return (32) and M/E (64) rows and reads the
  `ยอดก่อนนับ` tab (`lot0: 1` and `before` in `tx-fifo`). Until it's deployed, the box says the script
  is out of date and the report shows LOT 0 as recorded.

**Updating to a version with รายออเดอร์ and แปลงคืน:** paste the new `cut-api.gs` (รายออเดอร์) and the
new `tx-api.gs` (แปลงคืน), each into its own Apps Script project. Then for each one, Deploy → Manage
deployments → pencil icon → Version: New version → Deploy. Until then the page says which script is out
of date.

**Is the day ready to send?** The report is only as right as the ledger. The page reads the last
เทียบรายวัน result saved on this device by the cut-check page, then marks each day ✓ (matches all
three systems and the Report), ! (only cut on different days) or ✕ (still differs). If the ledger has
changed since that check, the day says so. Fix the day in เช็ครายการตัดสต๊อก first, then send it.

The fetched month stays on the device. Press ดึงใหม่ after the ledger changes.

**Supplier.** Each line shows the supplier of its PO under the PO number, from the ledger file's
`PO. Truck` tab (sent with `tx-daily`). Both files get a Supplier column right after PO, and the search box
finds a supplier's name. In the per-order view the existing บริษัทขนส่ง column is still the delivery
company; Supplier is the maker of the stock.

---

## 🧱 FIFO Stock (`/fifo`)

The monthly report for Supply chain, and a daily view for the Inventory team. It shows what's left in
the warehouse with the oldest goods first, and every pick or refill that took newer goods while older
ones were still there. It reads the whole ledger through `tx-api.gs` `?api=tx-fifo` (the Transaction URL
from the settings page) and never writes to the sheet. The data stays in memory only. It isn't kept on
the device.

**Shared copy (ข้อมูลกลาง):** opening the page loads the copy the script kept, the same one the Stock
Overview page uses, so it doesn't wait for the whole ledger to be read. The bar says when and who
(`ดึงเมื่อ 05/11 10:00 · อัตโนมัติ`). 🔄 ดึงใหม่ reads the ledger again and replaces the copy for every
device. The timer from `installShared` refreshes it every 2 hours from 8:00 to before 18:00. If nobody
refreshes it for a whole day, the next page opened reads the ledger again first. An open page loads a
newer copy by itself, but waits while you're typing in the search box or have a SKU open.

**How old is a batch:**

- A batch is one SKU (column B) + LOT + PO.
- The LOT is the month the goods are from. `1`–`12` is that month this year, and a LOT bigger than the
  report month is from last year. `0.11` is November of last year.
- `LOT 0`, a blank LOT or anything else is ไม่รู้ LOT. It's listed but can't be put in order.
- Inside one LOT, the PO that came in first is older. Its date is the first `GR` row of that
  SKU + LOT + PO. Stock from the stock count comes before every receipt. Two POs received on the same
  day are the same age.
- A PO written with `-01`, `-02` and so on at the end (`9900000001-05`) is the same PO, received over
  several days. The two digits are the day it came into the warehouse. The page drops them and treats
  every round as one batch: any round can go out first, and it never counts as ข้าม PO. The batch's
  receive date is its first round, and the page lists every round. Rounds entered with different LOTs
  stay separate batches, so the older LOT still goes first.
- QA / IQA / RIB locations aren't counted, either as the goods that went out or as older goods left
  behind.

**Where the goods are:** a location is a selling location (ในโลขาย) when its Status is `เปิด`, whatever
its letter. The rest is split in two:

- **บนแร็ค:** only `R` locations followed by a number (`R16-12-03`) are racks.
- **ตั้งพื้น:** A, B, C, D and every other location are floor stacks. Here that means the floor stacks that
  aren't open for selling.

**What counts as skipping FIFO (ข้าม FIFO):**

- **หยิบขาย (a `ขาย` row):** an older batch of the same SKU was in an open (`เปิด`) location at that time.
- **เติมของ (a `เบิก` row into an open location):** an older batch was still in a location that isn't
  open, on a rack or on the floor.
- ข้าม LOT means an older LOT month was there. ข้าม PO means the same LOT, but a PO received earlier.
- Goods with an unknown LOT are counted on their own as ตรวจไม่ได้, not as right or wrong.
- A row with no date of its own uses the date of the row above it, and the page marks it โดยประมาณ.

**The page:**

- Pick the month at the top. It lists up to 12 months, ending at the ledger's last sale date. The two
  first tiles give the % of pieces that followed FIFO that month for หยิบขาย and เติมของ, split into
  ตาม FIFO / ข้าม PO / ข้าม LOT.
- **คงเหลือราย LOT:** stock as of the month's last day, split into work queues. Four cards at the top
  pick the queue and show how many SKUs are in each. The page opens on the first queue that has work.
  - **ต้องเติมของเก่า**: an older batch isn't in any selling location (it's on a rack or on the floor),
    and every batch in the selling locations is newer. The row says which LOT to move, from which
    locations, and into which selling location, for example `เอา LOT 4 เข้าโลขายก่อน`.
  - **บอกคนหยิบ**: the selling locations hold batches of different ages. The row says which batch to
    pick first and where it is. It adds the PO only when the same LOT has more than one batch there.
  - **ไม่รู้ LOT**: stock with LOT 0 or no LOT. The row says how many pieces and where.
  - **ดูทั้งหมด**: a short table of every SKU with its stock, LOT count, oldest age, and its most
    urgent state, or `✓ ตาม FIFO` when nothing needs doing.
  - One SKU can sit in more than one queue, because each queue is a different person's job.
  - Each row in a queue lists its batches oldest to newest as tags: LOT, age, pieces, and where the
    batch is (`● โลขาย` means it's in a selling location). The batches to act on are in red (move) or
    blue (pick first).
  - Age uses three colors, each with its age written next to it: gray for 0–3 months, amber for 4–6,
    and red for 7 or more. The age tab uses the same colors.
  - Open a row to see each batch's order, LOT, PO, receive date (with every round, such as
    `รับ 3 รอบ 29/9 · 5/10 · 7/10`), how much is in the selling locations, on the floor and on racks,
    and the locations.
- **เบิกข้าม FIFO:** the month's picks and refills that skipped, grouped by SKU, biggest first. Each line
  shows what went out, the older goods that were there, and a link to the ledger row.
- **อายุสต๊อก:** pieces per LOT month, oldest first, and the SKUs holding the oldest goods.
- A negative balance (more out than in) isn't counted as stock. The page shows how many there are. Fix
  them in สต๊อกราย Location, แท็บข้อมูลผิด.
- Copy pastes the open tab into Excel as columns. **⬇️ Excel ส่ง Supply chain** downloads
  `fifo-YYYY-MM.xlsx` with four sheets: สรุป, คงเหลือราย LOT, เบิกข้าม FIFO and อายุสต๊อก.

**Updating to a version with FIFO:** paste the new `tx-api.gs` into the Transaction ledger file's Apps
Script, then Deploy → Manage deployments → pencil icon → Version: New version → Deploy. Until then the
page says the script has no FIFO yet.

**Supplier.** The supplier of each pile shows under its PO, from the `PO. Truck` tab. In เบิกข้าม FIFO the
older stock is tagged "คนละ Supplier" when it's from a different supplier than what went out, since two
suppliers can't be open together. The Excel file has a Supplier column in both sheets.

---

## 📦 Stock as of Date (`/balance`)

The stock left at the end of a day you pick, one line per SKU × LOT × PO, with an Excel download. It
reads the same shared copy of the whole Transaction ledger as FIFO สต๊อก (`tx-fifo`). Changing the date recalculates on the page straight away. It never writes to the sheet.

- **The date:** pick any day from the first dated row in the ledger up to today. **ล่าสุด** jumps to
  today and **สิ้นเดือนที่แล้ว** to the end of last month, the usual date for a monthly report. A row
  counts when its date is on or before that day. A row without its own date takes the date of the
  nearest dated row above it, the same as FIFO's month-end balance. The stock-count rows at the top,
  which have no date, always count.
- **The balance rule** is the balance sheet's: in at Location รับ for every type, out at Location เบิก
  for เบิก and ขาย only.
- **A line's quantity is the pile's net across every Location.** A move entered with the wrong
  Location เบิก leaves one Location negative and another too high, but the pile's total is still right.
  The line lists the Locations that hold it, with selling Locations in green. A negative one is shown in
  red and in หมายเหตุ.
- **A pile whose net is below zero** (more out than in) isn't counted as stock. The page says how many
  there are, and the ยอดติดลบ button lists them.
- A PO ending `-01`, `-02` and so on is one PO received over several days, so its rounds merge into one
  line (the same rule as the LOT / PO report). `LOT 0`, `PO 0` or blank count as unknown.
- **Converted SKUs go back into the purchase SKU,** using the `MASTER แปลงสินค้า` tab in the ledger file
  (the same tab and rule as the LOT / PO report; one converted piece is one bought piece). Their balance
  adds into the purchase SKU's pile with the same LOT and PO, so a conversion doesn't move pieces
  anywhere. The line says which converted SKUs it holds and how many. A converted SKU the master gives
  more than one purchase SKU stays as it is and says so. This needs the `tx-api.gs` version that sends
  the tab with `tx-fifo`; until it's deployed, the page warns that converted SKUs are still separate.
- Lines are sorted by SKU, then oldest LOT first. A LOT above the date's month is last year's, and 0.11
  is November last year.
- If the date is after the last sale the ledger has, the page says that sales after that day aren't
  taken off yet. It turns into a yellow warning when the gap is more than one day.
- **⬇️ โหลด Report (Excel)** downloads `สินค้าคงเหลือ-YYYY-MM-DD.xlsx`, one sheet named with the date:
  SKU, ชื่อสินค้า, SKU ที่แปลงมารวม, LOT, เดือนของ LOT, PO, Supplier, รับเข้า, คงเหลือ, Location, หมายเหตุ. It follows the search and
  the filter, and holds every line even when the page draws only the first 500. Copy gives the same
  table for pasting into Excel.
- **Supplier.** Each line shows its PO's supplier from the `PO. Truck` tab, the file has a Supplier column
  after PO, and the search box finds a supplier's name.

---

## 🧾 Invoice Match (`/invoice-match`)

Accounting has a file that says which document (Invoice) each order went out on. This page puts it next
to the order × LOT/PO file, so every line the warehouse cut gets its document number, and lists what
doesn't line up. You drop the two files in. Nothing goes to Apps Script, nothing is stored: the files are
read in the browser and are gone when the page closes, because they hold accounting numbers and customer
order numbers.

- **Which file is which comes from the header row,** not the tab name or the slot you dropped it in. One
  workbook holding both tabs fills both slots. A file dropped in the wrong slot moves to the right one.
  The header can be a few rows down, and spaces, line breaks and letter case in it don't matter.
  - The warehouse side needs เลขออเดอร์, SKU and จำนวน. LOT, PO, หมายเลขคำสั่งซื้อออนไลน์ and
    เลขออเดอร์ก่อนที่จะแยกบิล help. The per-order Excel from LOT / PO ที่ขายออก works as it is.
  - The accounting side needs เลขที่เอกสาร, รหัสสินค้า, จำนวน and ออเดอร์ภายใน or คำสั่งซื้อออนไลน์.
- **How an order finds its document,** in this order: the order number, then the order's pre-split number
  (accounting billed the order once before it was split), then the online order number. Accounting lines
  with only an online number join the order that has the same online number.
- **Quantities are compared per SKU over the whole order,** using SKU ที่ขาย when there is one (the
  document is billed by the sold SKU, not the purchase SKU a conversion turned it back into). Split orders
  that share one document are compared as a group. Accounting codes that never appear in the warehouse
  file (shipping, service fees) aren't compared; the page lists them so a real product hiding there shows.
- **An order with several documents** whose total doesn't match, but where exactly one document matches,
  uses that one and names the others in หมายเหตุ (a credit note quoting the order, for example).
- The results: ตรงกัน, จำนวนไม่ตรง, ยังไม่มี Invoice, มีแต่ในไฟล์บัญชี (a document quoting an order the
  warehouse file doesn't have) and บัญชียังไม่ใส่เลขออเดอร์ (grouped by document). An order with no Invoice
  dated after the accounting file's last document is marked ยังไม่ถึงรอบบัญชี rather than missing.
- **กระทบรายวัน** shows one box per day, coloured by whether that day is done: ครบ (every warehouse order
  has a document and the quantities match), ขาด Invoice with how many orders, จำนวนไม่ตรง with how many, or
  ยังไม่ถึงรอบบัญชี for days after the accounting file's last document. Warehouse orders count on the date in
  the warehouse file; accounting lines with no warehouse match count on their document date, so a day
  holding only those is marked มีแต่ฝั่งบัญชี. Hovering a box gives its numbers. Clicking a day turns the
  tiles, the filters and the list into that day only; clicking it again, or ✕, goes back to every day.
- The tiles at the top filter the list; search takes an order, online, document number or SKU.
- A long number Excel already turned into `1.23E+17` has lost its last digits and can't match. The page
  counts them per column so the source can be fixed (format the column as Text before pasting).
- **⬇️ โหลดผล (Excel)** downloads five sheets with every row, whatever the day or filter: สรุปรายวัน (one row
  per day with its status and counts), LOT-PO + เลขเอกสาร (every warehouse line in file order with
  เลขที่เอกสาร, วันที่เอกสาร, จับคู่ด้วย, ผลเทียบจำนวน and หมายเหตุ), ยอดไม่ตรง (one row per SKU that
  differs), ยังไม่มี Invoice and มีแต่ในไฟล์บัญชี. Copy gives the list for the chosen day and filter, one row
  per order.

---

## 📊 Stock Overview (`/dashboard`)

One page for the stock's health now and a monthly summary for the boss. It doesn't have rules of its own:
every number comes from the page that owns it, using the same shared copies (ข้อมูลกลาง), so the boss sees
the same numbers as the team. It's read-only, and never asks the cut-check script to run a check.

**ตอนนี้ (now):** six tiles. Each one opens the page and tab it comes from.

| Tile | Comes from |
| --- | --- |
| สต๊อกในคลัง: pieces, SKUs, locations, open / reserve / QA·IQA·RIB | Stock by Location |
| ต้องเติมภายใน 3 วัน: with reserve to pull, and with no reserve | Stock by Location, tab ต้องเติม (3 days) |
| ข้อมูลผิดในชีต: total, the three biggest kinds | Stock by Location, tab ข้อมูลผิด |
| อายุสต๊อก: share of stock with a LOT 7 months or older, split by age | FIFO Stock, tab อายุสต๊อก |
| นับสต๊อกวันนี้: counted / listed today, random-count accuracy over 30 days | Stock by Location, tab นับสต๊อก |
| ตัดสต๊อก: lines to fix (ตัดผิด / ตัดเกิน and ยังไม่ตัด), % matching the Report, fixes marked | Stock Cut Check |

A tile with something to do carries a label like `! ต้องแก้`. The bar at the top says when each copy is
from, and the backup state.

**สรุปรายเดือน (monthly):** pick the month. Early in a month the page opens on last month, since a
summary is about a finished month.

- หยิบขาย pieces, sale days, and the average per sale day. Compared with the month before only when both
  months have at least 7 sale days, as a daily average. The ledger started on 28 September, so September
  isn't compared.
- FIFO ตอนหยิบขาย and ตอนเติมของเข้าโลขาย, the same % as FIFO Stock.
- อายุสต๊อก as of the month's last day.
- นับสต๊อก: random counts that matched, and every count that month.
- ตัดสต๊อกเทียบ Report: only for the month of the cut file set in Settings.
- A chart of pieces picked each day, split into ตาม FIFO / ข้าม PO / ข้าม LOT / ไม่รู้ LOT. Point at or tap
  a bar for its numbers. ดูเป็นตาราง shows them all.
- เทียบรายเดือน: every month side by side.
- **📋 คัดลอกสรุปส่งหัวหน้า** copies a short summary to paste into LINE.

**Needs:** the new `tx-api.gs` (shared FIFO copy and the read-only count summary `?api=tx-count&peek=1`)
and, for the cut tile, the new `cut-api.gs`. With an older `tx-api.gs`, the page shows stock and FIFO but
not counts. An older script would make today's count list just by being asked, so the page doesn't ask.
With an older `cut-api.gs`, the cut tiles use the last result on this device, if Stock Cut Check was opened
here.

---

## 📥 Putaway (`/putaway`)

Plans where today's incoming goods go. Paste the day's plan (the INPUT tab), and the page proposes a
Location for every pallet from the real free space in the Transaction ledger, each SKU's pallet capacity,
and the warehouse's rules. Every row can be changed. Then copy the rows into the OUTPUT tab or download
Excel. It reads the same shared copy of the ledger as FIFO สต๊อก (`tx-fifo`) and never writes to the sheet.

- **Pasting:** copy the rows in Google Sheets and press Ctrl+V anywhere on the page (or 📋 วาง). The plan
  shows as a spreadsheet: row numbers on the left, column letters on top with what each column was read as
  (the ones used for planning in the main colour), and skipped rows struck through. Pasting a new plan
  plans straight away; there's no separate button.
- **The plan:** copy the rows from Google Sheets, header or not. With a header, columns are found by name
  (NO., Product ID, LOT, PO, SKU, Product Name, QTY, Truck, REMARK). Without one, the columns are worked
  out from what the data looks like (a 13-character Product ID, a short SKU, a 10-digit PO, a number after
  the name), so a helper column inserted in the tab doesn't shift everything; the page says which columns
  it used. Blank rows, rows with no code (a total row), and rows whose QTY isn't above 0 are skipped and
  listed. If nothing at all can be read, the page says why instead of staying blank. Each line is named by
  its NO., so it matches the sheet.
- **Pallet capacity** comes from a tab named `ความจุต่อพาเลท` in the file the Transaction script is
  bound to (header SKU, Product ID, STD / pallet; either code matches). An Excel file dropped on the
  settings line under the plan works too and takes over from the tab until you switch back. A SKU with no capacity, or 0,
  is left for you to place.
- **The rules, in order, per line:**
  1. ของแถม (a name starting แถม, or a FRE code) goes to zone D: on top of the same PO if it's there,
     otherwise the first empty D location.
  2. **OPEN:** incoming stock goes straight into the SKU's open location when it's out of stock, or when
     what's in the open location lasts less than the set number of days of sales (default **3**,
     changeable on the page and kept on this device) **and there's no reserve to refill it from**. With
     reserve left, FIFO says refill from the reserve first, so the card says so and the new stock is put
     away as usual. It sends enough to last the set days, rounded up to pallets, at least one. The open
     location is the one holding open (เปิด) stock now, the biggest on the floor or shelves first (floor
     open locations move to the next location when one runs out); with nothing open, the last open
     location that received stock, then the one refilled most often. Open, reserve and total are counted
     the same way as Stock by Location.
  3. Full pallets go to empty R locations, near where the SKU already sits. R level 1 (`-01`) is for 5FT and
     6FT mattresses only; everything else goes on level 2 and up. One SKU per location; no topping up.
  4. The remainder that doesn't fill a pallet:
     - the same PO already in the open location → into the open location;
     - 3.5FT mattresses and toppers → RIB. When what's in RIB plus today's makes a full pallet, the page
       moves them together to the rack and adds a ย้ายจาก RIB row;
     - 5FT / 6FT → the SKU's own empty level-1 location, else an empty floor location (A–D) near it;
     - anything else → an empty level-2+ location.
  5. What still has nowhere to go is marked เลือกเอง.
- **The result is one table, one row per Location,** like the OUTPUT tab: NO., SKU, name, PO and the
  plan's QTY on the first row of each line, then Location, QTY, OPEN, the result tag and REMARK, all
  editable in place. Red rows break a rule (the reason shows next to the tag), orange rows go to RIB, and
  a ⚠️ by the plan QTY means the rows don't add up. Explanations stay out of the way: hover the tag, or press
  ⓘ (💡 when there's advice) to open a row under the line with the kind, capacity, supplier, open location,
  sales per day, days it lasts, reserve, RIB, stock in the warehouse, and why each row went where it did.
- **The summary bar** (แร็ค, เข้าโลเปิด, RIB, พื้น, เลือกเอง, ผิดกติกา) filters the table to that group when
  pressed.
- **Changing a row** (Location, QTY, OPEN, REMARK), adding or deleting one keeps that line as you set it;
  other lines are worked out again around it, so they don't take the same location. ✎ marks such a line;
  ↺ undoes one line, and คืนค่าทั้งหมด at the top undoes all. The plan and your changes stay on
  this device until you clear them.
- **Checks on every row:** another SKU already in an R location or in another line's row there (red; on
  the floor it's only a warning, since many floor locations already hold several SKUs, and rows ticked
  OPEN or freebies in zone D aren't warned), R level 1 used by something other than 5FT / 6FT, over capacity, a Location the ledger has never had, a floor
  location holding another PO of the same SKU, and a line whose rows don't add up to its QTY.
- **📋 คัดลอกไปวางในชีต** copies the rows in the OUTPUT tab's order with OPEN as TRUE/FALSE.
  **⬇️ โหลด Excel** downloads `จัดที่เก็บ-YYYY-MM-DD.xlsx` with one sheet named OUTPUT.

- **One supplier open at a time.** Some SKUs come from different factories with different quality, so two
  suppliers' stock must never be on sale together. A tab named `PO. Truck` in the same file (header Truck,
  PO.) says which supplier (truck) each PO is from; a PO not in the tab takes the plan's Truck column.
  - When the SKU's open stock is from another supplier, nothing from this truck goes into the open
    location, even when it's low or the PO matches; the card's 💡 note says to keep it apart until the
    other supplier's open stock is gone.
  - "Reserve to use first" counts only reserve from the supplier that's open now (plus reserve whose
    supplier isn't known), so another supplier's reserve doesn't block topping up from the same supplier.
  - A row ticked OPEN while another supplier is open (in the ledger or in another line of the plan) is
    red. The card names the incoming supplier and the open location's, and flags a SKU that already has
    two suppliers open. A PO listed under two suppliers is shown; the first row is used.

**Needs:** the new `tx-api.gs` (it sends the capacity tab with `tx-fifo`, and `PO. Truck` with `tx-fifo`,
`tx-summary` and `tx-daily`). With an older
script the page still plans if you drop the capacity file, and says the script needs deploying.

---

## 🗂️ Project structure

```
index.html                 # redirects to roster/
public/
├─ wms-modules.js          # the module list + brand + sidebar icons
├─ wms-shell.js            # renders the sidebar from that list
├─ wms-theme.css           # shared look
├─ wms-gate.js / .css      # opening animation + per-device sign-in (not access control)
│                          #   intro: the logo springs in over a parcel belt, then glides into the card's header
│                          #   (wms-gate-bg.jpg: the photo behind the sign-in card)
├─ wms-logo.png            # app logo (sidebar, sign-in, intro); wms-icon-32 / -180.png are the tab and home-screen icons
│                          # every page links all three in its <head>, checked by src/data/icons.test.js
├─ icons/                  # module header icons (same style as the logo); hidden modules still use emoji
│                          #   tab-*.png: the section tabs of stock-location and cut-check
│                          #   empty-*.png: empty-state art, chosen with the .art-* classes in wms-theme.css
├─ wms-settings.js         # settings backup / restore
├─ wms-shared.js           # ข้อมูลกลาง: read the shared copy, refresh it, ask every minute for a newer one
├─ wms-sup.js              # PO → Supplier from the PO. Truck tab (stock-location, fifo, balance, lot-po)
├─ wms-*.js                # shared helpers (dates, stock, picking, trucks, search…)
├─ roster/                 # ตารางกะ (+ roster-sync.js: sharing through the sheet,
│                          #   roster-people.js: group / day off by date, leave counts)
├─ stock-location/         # สต๊อกราย Location, from the Transaction sheet (+ wms-tx.js: grouping, refill list)
├─ cut-check/              # เช็ครายการตัดสต๊อก, cuts compared with the month-end order reports (+ wms-cut.js: per-day match with the ledger)
├─ lot-po/                 # LOT / PO ที่ขายออก, the daily SKU × LOT × PO report for accounting (+ wms-lotpo.js, wms-lot0.js)
├─ invoice-match/          # จับคู่ Invoice, order × LOT/PO file matched with accounting's document numbers (+ wms-invmatch.js)
├─ fifo/                   # FIFO สต๊อก, stock by LOT oldest first + picks that skipped FIFO (+ wms-fifo.js)
├─ balance/                # สินค้าคงเหลือ ณ วันที่, SKU × LOT × PO balance at the end of a chosen day (+ wms-balance.js)
├─ putaway/                # จัดที่เก็บ, proposes a Location for each incoming pallet from free space + capacity (+ wms-putaway.js)
├─ dashboard/              # ภาพรวมสต๊อก, stock health now + monthly summary from the shared copies (+ wms-dash.js)
├─ summary/ history/ order-compare/ order-lookup/ stock/ picking/ order-sheet/
├─ shiftlog/               # สมุดกะ (+ logis.html: the read-only page for Logis)
├─ warehouse-forms/ jobs/ loadplan/ transport-docs/ transport-forms/ settings/
apps-script/
├─ roster-api.gs           # the shared schedule sheet's script (pasted into Apps Script, not served)
├─ tx-api.gs               # balances from the Transaction sheet, stock count, nightly backup, shared copy
└─ cut-api.gs              # compares stock cuts with the order reports, keeps the fix log and the shared result
src/
├─ data/                   # tests for the shared helpers + page-wide checks
└─ transport/              # tests for the transport helpers
```
