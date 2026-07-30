# Order Comparison System — Handoff Document

## Overview
Single-file HTML app (`order-comparison.html`) สำหรับทีม Logistics
เชื่อมกับ Google Sheets ผ่าน Google Apps Script (GAS)

---

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (no framework) — single file
- **Data source**: Google Apps Script Web App → JSON
- **Libraries**: SheetJS (xlsx) via CDN สำหรับอ่านไฟล์ Excel
- **Storage**: localStorage เก็บ GAS URL ระหว่าง session

---

## 5 Tabs

| Tab | ID | หน้าที่ |
|-----|----|---------|
| 🔄 เทียบ Order | `tab-compare` | เทียบ Sheet Daily Logis vs CRM แยกขนส่ง |
| 📦 เช็คสต๊อก | `tab-stock` | Sum SKU ทุกขนส่ง เทียบกับสต๊อก |
| 👤 เทียบข้อมูลลูกค้า | `tab-customer` | เทียบ ชื่อ/ที่อยู่/Phone/การเงิน/หมายเหตุ |
| 🔍 ตรวจ Order ซ้ำ | `tab-dupcheck` | 1 Order ID → ลูกค้าได้แค่ 1 คน |
| 📦 ตรวจเลข Consign | `tab-consigncheck` | 1 Consign → ลูกค้าได้แค่ 1 คน (Logis only) |

---

## Data Flow

```
Google Sheets
    │
    ├── order-api.gs  → GAS Web App → loadOrderFromGAS()
    │   returns: { carriers: [ { key, sheet1:[], sheet2:[] } ] }
    │
    └── stock-api.gs  → GAS Web App → loadStockFromGAS()
        returns: [ { SKU, Description, คลัง QA, คลัง NEW WH, Total } ]
```

### Row object structure (หลัง parse)
```js
{
  orderID, consign, sup, brand, size,
  qty1, giftRaw, qtyRaw,
  customer, address, phone1, phone2,
  payment, remark, date
}
```

### Global state
```js
let carriersData = [];  // [ { key, data1:[], data2:[] } ]
let data1 = [];         // Sheet Daily Logis (active carrier)
let data2 = [];         // Sheet Daily CRM (active carrier)
let data2raw = [];      // Sheet Daily CRM (for stock check)
let stockMap = {};      // { [sku]: { sku, description, qa, newwh, total } }
let diffResults = [];   // compare results
let stockResults = [];  // stock check results
let custResults = [];   // customer compare results
```

---

## Key Functions

### Parsing
- `sheetToRows(ws)` — แปลง XLSX sheet → row objects (file upload path)
- `convertGASRows(rows)` — แปลง GAS JSON → row objects
- `normalizeOrder(rows)` — รวม multi-row order → `{ products:[], gifts:[] }` keyed by SKU
- `extractSKU(text)` — ดึง SKU code จากชื่อสินค้า เช่น `FRE0000000216`

### Compare (Tab 1)
- `runCompare()` — validate date → diff orders → render
- `diffOrders(n1, n2)` → array of `{ type, ... }` diffs
- `buildDetailHTML(r)` — render expand row detail + stock panel

### Stock (Tab 2)
- `aggregateSKUDemand(rows)` — Sum qty ต่อ SKU จากทุก order/แถว
- `runStockCheck()` — รวมทุก carrier → demand vs stockMap

### Customer (Tab 3)
- `runCustomerCompareWith(d1, d2, carrierName)` — core compare logic
- `normText(s)` — ตัด invisible chars, normalize whitespace
- `normKey(s)` — ตัด prefix (คุณ/นาย/นาง) สำหรับเทียบชื่อ

### Duplicate checks (Tab 4 & 5)
- `isSamePerson(a, b)` — เทียบ normKey(customer) + normAddr(address)
- `findDuplicateOrders(rows)` — group by orderID → หา > 1 คน
- `findDuplicateConsign(rows)` — group by consign → หา > 1 คน

---

## Apps Script Files

### `order-api.gs`
- ตั้งค่า `CARRIERS` array (key, logis sheet, crm sheet)
- Returns: `{ carriers: [ { key, sheet1:[], sheet2:[], error1, error2 } ] }`
- Auto-detect header row (หา row ที่มี "Order ID")

### `stock-api.gs`
- ตั้งค่า `SHEET_NAME`
- Returns: `[ { SKU, Description, ... } ]` — array of objects

---

## GSheet Column Mapping (Order sheets)

| Col | Header | Field |
|-----|--------|-------|
| A | Date | `date` |
| B | Sup | `sup` |
| C | Order ID | `orderID` |
| D | เลข consign | `consign` |
| E | Invoice | — |
| F | แบรนด์ | `brand` |
| G | ขนาด | `size` |
| H | จำนวน (1) | `qty1` |
| I | ของแถม | `giftRaw` |
| J | จำนวน (2) | `qtyRaw` |
| K | ชื่อลูกค้า | `customer` |
| L | ที่อยู่ | `address` |
| M | Phone 1 | `phone1` |
| N | Phone 2 | `phone2` |
| O | การเงิน | `payment` |
| P | หมายเหตุ | `remark` |

---

## Known Limitations / TODO

1. **ไม่มี auto-run** หลังดึง GAS — ต้องกดปุ่มทุก Tab เอง
2. **Tab ลูกค้า** ยังต้องกดเลือกขนส่งทีละอัน ไม่มีปุ่ม "เทียบทั้งหมด"
3. **ไม่มี timestamp ออเดอร์** — มีแค่ stock timestamp
4. **ไม่มี Export** — ต้อง screenshot หรือ copy เอง
5. **ไม่มี retry** เมื่อ GAS timeout

---

## Multi-row Order Logic (สำคัญมาก)

Order เดียวกันมีหลายแถวได้ (สินค้าหลายชิ้น + ของแถม)

**Row Type A** — มี `แบรนด์` = สินค้าหลัก  
→ SKU จาก field แบรนด์, ของแถมอยู่ใน `ของแถม` cell (newline-separated, zip กับ `จำนวน` ตาม raw index)

**Row Type B** — ไม่มี `แบรนด์` = แถวสินค้าหรือของแถม  
→ อ่านจาก `ของแถม` cell, จำแนกด้วย SKU prefix:  
- `FRE*` = ของแถม  
- อื่นๆ = สินค้าหลัก

**Key insight**: zip gift lines กับ qty lines ตาม raw index (ไม่ filter blank ก่อน) เพราะ blank lines ปรากฏในทั้งสอง column พร้อมกัน
