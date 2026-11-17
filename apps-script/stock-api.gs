// ════════════════════════════════════════════════════
// Google Apps Script — Stock API v3
// วิธีใช้:
// 1. เปิด Google Sheet สต๊อก
// 2. Extensions → Apps Script → วางโค้ดนี้ทับของเดิม → Save
// 3. แก้ SHEET_NAME ให้ตรงกับชื่อ Sheet
// 4. Deploy → Manage deployments → แก้ไข (ดินสอ) → Version: New version → Deploy
//    (URL เดิมใช้ต่อได้ ไม่ต้องเปลี่ยนในระบบ)
//
// เรียกแบบเดิม (หน้าเทียบ Order หน้าสต๊อก) ได้ array ของแท็บ Stock เหมือน v2 ทุกอย่าง
// ?api=stock-all  ให้หน้านับสต๊อกใหญ่ แท็บกระทบ TRcloud:
//   { app: 'stock', v: 3, at, stock: [...], loss: [...] | null, cost: [...] | null, tabs: {stock, loss, cost} }
//   loss = แท็บ WH-Loss (ยอดคงเหลือในคลัง WH-Loss จาก TRcloud: SKU กับจำนวน)
//   cost = แท็บ ราคาทุน (SKU กับราคาทุนต่อชิ้น)
//   ไม่มีแท็บ = null · ชื่อแท็บพิมพ์ต่างนิดหน่อยได้ (WH Loss, wh-loss)
//   หัวตารางไม่ต้องอยู่แถว 1 (ไฟล์ export จาก TRcloud มักมีชื่อรายงานอยู่ข้างบน) หาแถวที่มีคำว่า SKU หรือ รหัสสินค้า
// สคริปต์อ่านอย่างเดียว ไม่เขียนอะไรลงชีต
// ════════════════════════════════════════════════════

const SHEET_NAME = 'Stock';     // ← แก้ชื่อ Sheet ตรงนี้
const LOSS_SHEET = 'WH-Loss';
const COST_SHEET = 'ราคาทุน';
const VERSION = 3;

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (p.api === 'stock-all') {
      const stock = tab_(ss, SHEET_NAME);
      if (!stock) return respond({ error: 'ไม่พบ Sheet: ' + SHEET_NAME });
      const loss = tab_(ss, LOSS_SHEET);
      const cost = tab_(ss, COST_SHEET);
      return respond({
        app: 'stock', v: VERSION, at: Date.now(),
        stock: stock.rows, loss: loss ? loss.rows : null, cost: cost ? cost.rows : null,
        tabs: { stock: stock.name, loss: loss ? loss.name : '', cost: cost ? cost.name : '' },
      });
    }

    const ws  = ss.getSheetByName(SHEET_NAME);
    if (!ws) return respond({ error: 'ไม่พบ Sheet: ' + SHEET_NAME });

    const data = ws.getDataRange().getValues();
    if (data.length < 2) return respond({ error: 'Sheet ว่างเปล่า' });

    const headers = data[0].map(h => String(h).trim());

    // ส่งเป็น array of objects — ง่ายต่อการ parse
    const rows = data.slice(1)
      .filter(row => row[0] !== '' && row[0] !== null)
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] === null ? '' : row[i]; });
        return obj;
      });

    return respond(rows);

  } catch (err) {
    return respond({ error: err.message });
  }
}

/** ชื่อแท็บแบบไม่สนตัวพิมพ์ ช่องว่าง ขีด: WH-Loss = WH Loss = whloss */
function key_(s) { return String(s || '').toLowerCase().replace(/[\s\-_.]/g, ''); }

/**
 * แท็บเป็น array of objects ตามหัวตาราง ไม่มีแท็บ = null
 * หัวตาราง = แถวแรก (ใน 10 แถวบน) ที่มีช่อง SKU หรือ รหัสสินค้า ไม่เจอใช้แถว 1
 * แถวที่ช่อง SKU ว่างข้าม
 */
function tab_(ss, name) {
  let ws = ss.getSheetByName(name);
  if (!ws) {
    const want = key_(name);
    ws = ss.getSheets().find(s => key_(s.getName()) === want) || null;
  }
  if (!ws) return null;
  const data = ws.getDataRange().getValues();
  let h = 0;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    if (data[i].some(v => /^(sku|รหัสสินค้า)$/i.test(String(v).trim()))) { h = i; break; }
  }
  if (!data.length) return { name: ws.getName(), rows: [] };
  const headers = data[h].map((v, i) => String(v).trim() || ('col' + (i + 1)));
  let at = headers.findIndex(v => /^(sku|รหัสสินค้า)$/i.test(v));
  if (at < 0) at = 0;
  const rows = data.slice(h + 1)
    .filter(row => row[at] !== '' && row[at] !== null)
    .map(row => {
      const obj = {};
      headers.forEach((k, i) => { obj[k] = row[i] === null ? '' : row[i]; });
      return obj;
    });
  return { name: ws.getName(), rows: rows };
}

function respond(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
