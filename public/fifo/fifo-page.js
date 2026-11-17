/*
 * โค้ดหน้า FIFO สต๊อก ใช้ร่วมกันสองหน้า
 *   index.html — หน้าในแอป ดึงใหม่ได้ มีปุ่มคัดลอกลิงก์ Supply chain
 *   share.html — ลิงก์ Supply chain (body มี data-fifo-share) เปิดได้โดยไม่ต้องเข้าแอป
 *                อ่านชุดข้อมูลกลางอย่างเดียว ดาวน์โหลด Excel ได้ ไม่มีปุ่มดึงใหม่ ไม่มีลิงก์ไปชีต
 * ตัวเลขทุกตัวคิดด้วย WmsFifo ชุดเดียวกัน สองหน้าจึงเห็นตรงกัน
 */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const f = n => Math.round(n).toLocaleString('en-US');
const dm = d => { const p = String(d || '').split('-'); return p.length === 3 ? `${+p[2]}/${+p[1]}` : ''; };
const pad = n => String(n).padStart(2, '0');
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const SHOW_MAX = 150;   // SKU ต่อหน้าจอ ทั้งคลังมีห้าร้อยกว่า วาดหมดหน้าจะหน่วงบนมือถือ คัดลอกกับดาวน์โหลดยังได้ครบ

/*
 * ลิงก์ Supply chain: URL สคริปต์ Transaction มากับลิงก์หลัง # (ไม่ส่งไปกับการเปิดหน้า)
 * เก็บไว้ในเครื่อง เปิดจาก bookmark ที่ไม่มี # ก็ยังใช้ได้ ไม่ใช้ค่าในหน้าตั้งค่าของแอป
 */
const SHARE = document.body.hasAttribute('data-fifo-share');
const SHARE_KEY = 'wms:fifo:share-url';
const SHARE_URL = SHARE ? (() => {
  const u = WmsFifo.parseShareLink(location.hash);
  try {
    if (u) localStorage.setItem(SHARE_KEY, u);
    else return WmsFifo.parseShareLink('#u=' + encodeURIComponent(localStorage.getItem(SHARE_KEY) || ''));
  } catch (e) {}
  return u;
})() : '';
const txUrl = () => SHARE ? SHARE_URL : WmsSettings.txUrl();
const XLSX_LABEL = SHARE ? '⬇️ ดาวน์โหลด Excel' : '⬇️ Excel ส่ง Supply chain';
const SHARE_LABEL = '🔗 ลิงก์ Supply chain';
/* share.html อยู่โฟลเดอร์เดียวกับไฟล์นี้ ใช้ที่อยู่ของสคริปต์ ไม่ใช้ของหน้า (เปิด /fifo ไม่มี / ท้ายจะชี้ผิดโฟลเดอร์) */
const SHARE_PAGE = new URL('share.html', (document.currentScript && document.currentScript.src) || location.href).href;

/* แถวทั้งสมุดราวหนึ่งเมกะไบต์ เก็บแค่ในหน่วยความจำ ไม่ลงเครื่อง พื้นที่ในเครื่องใช้ร่วมกับหน้าอื่นที่เก็บของสำคัญกว่า */
let RES = null;     // คำตอบ tx-fifo
let AN = null;      // WmsFifo.analyze(RES, MONTH)
let MONTH = '';     // yyyy-mm
/* ?tab= มาจากลิงก์บนหน้าภาพรวมสต๊อก */
let TAB = ['stock', 'skip', 'age'].includes(new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') : 'stock';
let ONLY = SHARE ? '' : null;    // คิวงานของแท็บคงเหลือ (id ใน WmsFifo.QUEUES) null = ยังไม่ได้เลือก เปิดคิวแรกที่มีงาน · ลิงก์ Supply chain เปิดดูทั้งหมด
let SORT = 'need';  // need | code | old | qty
let HELP = false;   // กล่อง ⓘ อ่านยังไง ของแท็บคงเหลือ
let KIND = '';      // ตัวกรองแท็บข้าม FIFO: '' | sale | refill
let Q = '';
let BUSY = '';
let ERR = '';
let WAIT = null;    // ข้อมูลกลาง: มีคนกำลังดึงชุดใหม่อยู่ { at, by, auto }
let LOADING = false;

function monthName(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
}

/** เดือนที่เลือกได้ สิบสองเดือนถึงเดือนที่สมุดลงขายล่าสุด ไม่ก่อนวันแรกที่มีวันที่ในสมุด */
function months() { return RES ? WmsFifo.months(RES) : []; }

/** อายุเป็นสามช่วง ตรงกับคำอธิบายสีบนหน้า */
function ageCls(age) {
  if (age === null || age === undefined) return 'c-u';
  return age <= 3 ? 'c-a2' : age <= 6 ? 'c-a3' : 'c-a4';
}
const AGE_KEY = [['c-a4', '7 เดือนขึ้นไป'], ['c-a3', '4–6 เดือน'], ['c-a2', '0–3 เดือน'], ['c-u', 'ไม่รู้ LOT']];

const lotText = (x) => x.lm ? `LOT ${esc(x.lot)} · ${esc(WmsFifo.monthText(x.lm))}` : `<span class="tx-mid">LOT ${esc(x.lot || 'ว่าง')} · ไม่รู้ LOT</span>`;

/** วันรับเข้าของกอง PO ที่ลง -01 -02 รวมกันแล้ว บอกว่ารับกี่รอบ: รับ 3 รอบ 29/9 · 5/10 · 7/10 */
function recvWords(x) {
  const r = x.rounds || [];
  const count = x.recv === WmsFifo.COUNT_DAY;
  const many = r.length > 1 || (count && r.length);
  if (!many) return count ? 'ก่อนนับสต๊อก' : x.recv ? `รับ ${dm(x.recv)}` : 'ไม่มีวันรับ';
  const days = r.length === 1 ? dm(r[0].d) : r.length <= 3 && !count ? r.map((y) => dm(y.d)).join(' · ') : `${dm(r[0].d)}–${dm(r[r.length - 1].d)}`;
  if (count) return `ก่อนนับสต๊อก + รับเพิ่ม${r.length > 1 ? ` ${r.length} รอบ` : ''} ${days}`;
  return `รับ ${r.length} รอบ ${days}`;
}
const recvTitle = (x) => (x.rounds || []).length > 1 || (x.recv === WmsFifo.COUNT_DAY && (x.rounds || []).length)
  ? `PO เดียวกันที่ทยอยรับ ใช้รอบไหนก่อนก็ได้ — ${x.rounds.map((y) => `${dm(y.d)} รับเข้า ${f(y.qty)} ชิ้น`).join(', ')}` : '';
const loc = (i) => RES.locs[i] || '';
const rowLink = (row) => {
  const u = SHARE ? '' : WmsCut.rowUrl(RES.sheet, row);   // ลิงก์ Supply chain ไม่ชี้เข้าชีต
  return u ? `<a class="tx-row" href="${esc(u)}" target="_blank" rel="noopener">${row}</a>` : String(row);
};
/** เดือนที่ยังไม่จบ ยอดคือยอดล่าสุดในสมุด ไม่ใช่สิ้นเดือน */
const isNow = () => RES && AN && AN.to >= (RES.last || RES.today);
const asOf = () => isNow() ? `ล่าสุด (สมุดลงขายถึง ${dm(RES.last)})` : `ณ ${dm(AN.to)}`;

/**
 * ข้อมูลกลาง: เปิดหน้าอ่านชุดที่สคริปต์เก็บไว้ (หน้าภาพรวมสต๊อกใช้ชุดเดียวกัน) กดดึงใหม่ค่อยให้อ่านสมุดทั้งชีต
 * สคริปต์รุ่นก่อนไม่รู้จัก shared อ่านทั้งชีตให้เหมือนเดิม กดดึงใหม่ได้ OLD ก็ถอยไปเรียกแบบเดิม
 * quiet = ชุดใหม่ที่มาเองระหว่างเปิดดู ไม่ต้องขึ้นสายพานรอโหลด เดือนกับแท็บที่เลือกไว้ยังอยู่
 */
async function load(fresh, quiet) {
  const url = txUrl();
  if (LOADING || !url) return;
  LOADING = true;
  ERR = '';
  const say = (sec) => { BUSY = fresh ? `กำลังอ่านสมุด Transaction ทั้งชีต…${sec ? ` ${sec} วินาที` : ''}` : 'กำลังโหลดชุดล่าสุด…'; renderSrc(); };
  const opts = { retries: 1, timeoutMs: 240000, onProgress: quiet ? undefined : say };
  if (!quiet) { say(0); render(); }
  try {
    let res;
    if (fresh) {
      res = await WmsShared.press(url, 'tx-fifo', null, opts);
      if (res && res.error === WmsShared.OLD) res = await WmsGas.json(url, 'tx-fifo', opts);
    } else {
      res = await WmsShared.read(url, 'tx-fifo', opts);
    }
    if (res && res.busy && !res.rows) {
      WAIT = res.busy;
      WATCH.soon();
      BUSY = '';
      LOADING = false;
      render();
      return;
    }
    WAIT = null;
    if (res.error) throw new Error(res.error);
    if (res.app !== 'transaction') throw new Error(SHARE ? 'ลิงก์นี้ใช้ไม่ได้ ขอลิงก์ใหม่จากคนที่ส่งให้' : 'URL ของ Transaction ในหน้าตั้งค่าไม่ใช่สคริปต์ tx-api.gs');
    if (!res.rows) throw new Error(SHARE ? 'ข้อมูลยังไม่พร้อม แจ้งคนที่ส่งลิงก์ให้' : 'สคริปต์ tx-api.gs ยังเป็นรุ่นที่ไม่มี FIFO ให้วางโค้ดใหม่แล้ว Deploy เป็น New version');
    RES = res;
    const list = months();
    if (!list.includes(MONTH)) MONTH = list[0] || RES.today.slice(0, 7);
    AN = WmsFifo.analyze(RES, MONTH);
  } catch (e) {
    ERR = e.message;
    if (window.WmsMotion) setTimeout(() => window.WmsMotion.shake(document.querySelector('#src .tx-err')), 0);
  }
  BUSY = '';
  LOADING = false;
  render();
}

/* ── แถบบน ─────────────────────────────────────────────────────────────── */

function renderSrc() {
  const url = txUrl();
  let html = '';
  if (RES && !BUSY) {
    html += `<span class="pill">📅 <select id="month" aria-label="เดือนของรายงาน">${months().map((x) =>
      `<option value="${x}" ${x === MONTH ? 'selected' : ''}>${esc(monthName(x))}</option>`).join('')}</select></span>`;
    const when = new Date(WmsShared.stamp(RES)).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const who = WmsShared.who(RES);
    html += `<span class="pill" title="ทุกเครื่องเห็นชุดเดียวกัน รอบอัตโนมัติดึงใหม่ทุก 2 ชั่วโมงในเวลางาน">🕐 ดึงเมื่อ <b>${esc(when)}</b>${who ? ` · ${esc(who)}` : ''}</span>`;
    if (RES.last) html += `<span class="pill">สมุดลงขายถึง <b>${esc(dm(RES.last))}</b></span>`;
    if (!SHARE && RES.sheet && RES.sheet.url) html += `<span class="pill"><a href="${esc(RES.sheet.url)}" target="_blank" rel="noopener">เปิดชีต ↗</a></span>`;
    const neg = AN.stock.negative;
    if (neg.keys) html += `<span class="pill warn" title="ยอดติดลบ ${f(neg.qty)} ชิ้น ไม่นับเป็นของ${SHARE ? '' : ' — ดูที่หน้าสต๊อกราย Location แท็บข้อมูลผิด'}">ติดลบ ${f(neg.keys)} จุด ไม่นับ</span>`;
  }
  if (BUSY) html += `<span class="pill">⏳ ${esc(BUSY)}</span>`;
  if (WAIT && !BUSY) {
    const at = new Date(WAIT.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    html += `<span class="pill warn">⏳ ${esc(WmsShared.runner(WAIT))} กำลังดึงชุดใหม่ (เริ่ม ${esc(at)}) เสร็จแล้วขึ้นให้เอง</span>`;
  }
  html += '<span class="sp"></span>';
  const xlsx = RES && !BUSY ? `<button id="xlsxBtn" class="p" title="สรุป · คงเหลือราย LOT · เบิกข้าม FIFO · อายุสต๊อก ของเดือนที่เลือก">${XLSX_LABEL}</button>` : '';
  if (url && SHARE) {
    html += xlsx;
  } else if (url) {
    html += `<button id="loadBtn" class="${RES ? '' : 'p'}" ${BUSY || WAIT ? 'disabled' : ''}>${BUSY ? 'กำลังดึง…' : WAIT ? 'รอชุดใหม่…' : RES ? '🔄 ดึงใหม่' : '▶️ ดึงข้อมูล'}</button>`;
    html += `<button id="shareBtn" title="คัดลอกลิงก์ให้ Supply chain เปิดดูรายงานนี้และดาวน์โหลด Excel เองได้ ไม่ต้องเข้าแอป — ใครได้ลิงก์ก็เปิดดูได้ ส่งเฉพาะทีม">${SHARE_LABEL}</button>`;
    html += xlsx;
  } else if (SHARE) {
    html += '<span class="pill warn">ลิงก์ไม่ครบ — ขอลิงก์ใหม่จากคนที่ส่งให้</span>';
  } else {
    html += `<span class="pill">ยังไม่ได้ตั้ง Apps Script URL ของ Transaction — <a href="../settings/">ตั้งที่หน้าตั้งค่า</a></span>`;
  }
  if (ERR) html += `<div class="tx-err">ดึงข้อมูลไม่สำเร็จ: ${esc(ERR)}</div>`;
  $('src').innerHTML = html;
  const btn = $('loadBtn');
  if (btn) btn.onclick = () => load(!!RES);
  const x = $('xlsxBtn');
  if (x) x.onclick = downloadXlsx;
  const sh = $('shareBtn');
  if (sh) sh.onclick = copyShare;
  const m = $('month');
  if (m) m.onchange = (e) => {
    MONTH = e.target.value;
    AN = WmsFifo.analyze(RES, MONTH);
    render();
  };
}

/**
 * สรุปเดือนเป็นตารางเล็กสองตาราง แบบชีตสรุปที่ส่ง Supply chain (ผู้ใช้เลือกแบบนี้ 2026-11-17 แทนการ์ดสี่ใบ)
 * ช่องข้าม LOT / ข้าม PO กดไปแท็บเบิกข้าม FIFO ช่องไม่รู้ LOT ของสต๊อกกดไปคิวไม่รู้ LOT
 */
function renderSum() {
  if (!AN || BUSY) { $('sum').innerHTML = ''; return; }
  const t = AN.totals, s = AN.stock;
  const unkSku = s.list.filter((e) => e.unknown).length;
  const go = (n, to, tip, cls) => n ? `<button class="fi-go${cls ? ` ${cls}` : ''}" data-go="${to}" title="${esc(tip)}">${f(n)}</button>` : '0';
  const row = (label, g, kind) => `<tr><th scope="row">${label}</th><td class="pc">${g.pct === null ? '—' : `${g.pct}%`}</td><td>${f(g.judged)}</td><td>${f(g.ok)}</td>
      <td>${go(g.lot, `skip:${kind}`, `${label}ข้าม LOT ${f(g.lot)} ชิ้น · ดูรายการ`)}</td>
      <td>${go(g.po, `skip:${kind}`, `${label}ข้าม PO ${f(g.po)} ชิ้น · ดูรายการ`)}</td>
      <td>${f(g.unknown)}</td></tr>`;
  const head = isNow() ? `สต๊อกล่าสุด ${dm(RES.last)}` : `สต๊อก ณ ${dm(AN.to)}`;
  $('sum').innerHTML = `<div class="fi-mwrap"><table class="fi-mini" aria-label="การเบิกตาม FIFO ${esc(monthName(MONTH))} หน่วยเป็นชิ้น">
      <thead><tr><th>${esc(monthName(MONTH))} <span class="u">· ชิ้น</span></th><th>% ตาม FIFO</th><th>ตรวจได้</th><th>ตาม FIFO</th><th title="มี LOT เดือนเก่ากว่า">ข้าม LOT</th>
        <th title="LOT เดียวกัน แต่มี PO อื่นที่รับเข้าก่อน (PO -01 -02 เป็น PO เดียวกัน ไม่นับ)">ข้าม PO</th><th title="แถวที่ LOT เป็น 0 หรือว่าง ตรวจไม่ได้">ไม่รู้ LOT</th></tr></thead>
      <tbody>${row('หยิบขาย', t.sale, 'sale')}${row('เติมของ', t.refill, 'refill')}</tbody></table></div>
    <div class="fi-mwrap"><table class="fi-mini" aria-label="${esc(head)}">
      <thead><tr><th>${esc(head)}</th><th>ชิ้น</th><th>SKU</th></tr></thead>
      <tbody><tr><th scope="row">คงเหลือ</th><td>${f(s.total)}</td><td>${f(s.list.length)}</td></tr>
        <tr><th scope="row">ไม่รู้ LOT</th><td>${f(s.unknown)}</td><td>${go(unkSku, 'stock:unknown', 'ดูคิวไม่รู้ LOT', 'n')}</td></tr>
        ${s.special ? `<tr><th scope="row">QA / IQA / RIB</th><td>${f(s.special)}</td><td></td></tr>` : ''}</tbody></table></div>`;
}

function renderTabs() {
  if (!AN || BUSY) { $('tabs').innerHTML = ''; return; }
  const skips = WmsFifo.skipsBySku(RES, AN, {}).length;
  const list = [
    ['stock', 'คงเหลือราย LOT', 'คงเหลือ', '../icons/tab-count.png', AN.stock.list.length],
    ['skip', 'เบิกข้าม FIFO', 'ข้าม FIFO', '../icons/tab-error.png', skips],
    ['age', 'อายุสต๊อก', 'อายุ', '../icons/tab-history.png', AN.stock.aging.length],
  ];
  $('tabs').innerHTML = list.map(([id, label, short, icon, n]) =>
    `<button class="tx-tab ${id === TAB ? 'on' : ''}" role="tab" aria-selected="${id === TAB}" data-tab="${id}"><img src="${icon}" alt="" width="26" height="26">` +
    `<span class="lb">${label}</span><span class="sh">${short}</span> <span class="n">${f(n)}</span></button>`
  ).join('');
}

/* ── คงเหลือราย LOT: ชิปคิวงาน + ตารางเดียวแบบชีต หนึ่งแถวต่อกอง (SKU + LOT + PO) ─────
 * ผู้ใช้เลือกแบบนี้ 2026-11-17: เห็นทุกกองโดยไม่ต้องกดเปิดทีละ SKU หน้าตาเหมือนชีตคงเหลือราย LOT ใน Excel
 * คิวงานยังเป็นตัวกรองเดิม (WmsFifo.QUEUES) แถวที่ต้องทำมีสีและป้ายในช่องต้องทำ คำอธิบายอยู่หลังปุ่ม ⓘ */

const SORTS = { need: 'ต้องดูก่อน', code: 'SKU', old: 'ของเก่าสุด', qty: 'จำนวนมากสุด' };

function sortStock(list) {
  const by = {
    need: (a, b) => b.refill.length - a.refill.length || (b.mixed - a.mixed) || (b.oldest ?? -1) - (a.oldest ?? -1) || a.code.localeCompare(b.code),
    code: (a, b) => a.code.localeCompare(b.code),
    old: (a, b) => (b.oldest ?? -1) - (a.oldest ?? -1) || b.total - a.total,
    qty: (a, b) => b.total - a.total,
  };
  return list.slice().sort(by[SORT] || by.need);
}

function stockRows() { return sortStock(WmsFifo.filterStock(AN.stock.list, { only: ONLY || '', q: Q })); }

const QCLS = { refill: 'q-red', mixed: 'q-warn', unknown: '', '': '' };

/** วันรับเข้าแบบสั้นในช่องตาราง ทุกรอบอยู่ใน title: 29/9 +2 รอบ */
function recvShort(x) {
  const r = x.rounds || [];
  if (x.recv === WmsFifo.COUNT_DAY) return r.length ? `ก่อนนับสต๊อก +${r.length} รอบ` : 'ก่อนนับสต๊อก';
  if (!x.recv) return '—';
  return dm(x.recv) + (r.length > 1 ? ` +${r.length - 1} รอบ` : '');
}

/** Location ของกอง โลขายขึ้นก่อน: ● A-01-01 12, R1-06-01 3 */
const locsText = (x) => x.locs.slice().sort((a, b) => (b.open - a.open) || b.qty - a.qty)
  .map((l) => `${l.open && !l.special ? '● ' : ''}${loc(l.loc)} ${f(l.qty)}`).join(', ');
const n0 = (v) => v ? f(v) : '';

/**
 * กองนี้ต้องทำอะไร ตามคิวที่เลือก (ดูทั้งหมด = ทุกงาน) ได้ { cls, html, tip } ไม่มีงานได้ null
 * กองที่ต้องเติมไม่มีของในโลขาย กองที่ต้องหยิบอยู่ในโลขาย กองที่ไม่รู้ LOT ไม่ใช่ทั้งสองแบบ งานเลยไม่ซ้อนกัน
 */
function batchTask(e, x, hot, to) {
  const want = (id) => !ONLY || ONLY === id;
  if (hot.has(x) && want('refill')) return {
    cls: 'r-hot', html: `<span class="fi-tg t-red">เติมก่อน</span>${to ? ` <span class="sm">→ ${esc(to)}</span>` : ''}`,
    tip: 'กองนี้ยังอยู่บนแร็คหรือตั้งพื้น แต่โลขายมีแต่กองใหม่กว่า ให้เอากองนี้เข้าโลขายก่อน',
  };
  if (e.mixed && x === e.pick && want('mixed')) return {
    cls: 'r-pick', html: '<span class="fi-tg t-warn">หยิบก่อน</span>',
    tip: `โลขายมี ${f(e.batches.filter((y) => y.lm && y.open > 0).length)} กองปนกัน บอกคนหยิบให้หยิบกองนี้ก่อน`,
  };
  if (!x.lm && want('unknown')) return {
    cls: 'r-unk', html: '<span class="fi-tg t-gray">แก้ LOT</span>',
    tip: 'LOT เป็น 0 หรือว่าง เรียงอายุไม่ได้ ต้องแก้ LOT ในสมุดให้ตรงกับป้ายที่กอง',
  };
  return null;
}

/** แถวของหนึ่ง SKU: แถวแรกมี SKU กับชื่อ แถวที่สองบอกยอดรวม ถ้ามีหลายกอง */
function skuRows(e) {
  const hot = new Set(e.refill.map((r) => r.batch));
  const rt = e.refill.length ? WmsFifo.refillTask(RES, e) : null;
  const to = rt && rt.to.length ? rt.to[0] + (rt.to.length > 1 ? ` +${f(rt.to.length - 1)}` : '') : '';
  return e.batches.map((x, i) => {
    const t = batchTask(e, x, hot, to);
    const s = WmsFifo.sup(RES, x.po);
    const lt = locsText(x);
    const rw = recvTitle(x) || recvWords(x);
    const name = i === 0 ? `<td class="c-nm" title="${esc(e.name)}">${esc(e.name)}</td>`
      : `<td class="c-nm">${i === 1 ? `<span class="sm">รวม ${f(e.total)} ชิ้น</span>` : ''}</td>`;
    return `<tr class="${i ? '' : 'g1 '}${t ? t.cls : ''}">
      <td class="c-sku"${i ? '' : ` title="${esc(`${e.short} · รวม ${f(e.total)} ชิ้น`)}"`}>${i ? '' : esc(e.code)}</td>${name}
      <td class="num sm" title="ลำดับ FIFO">${x.rank || '—'}</td>
      <td title="${esc(x.lm ? `LOT ${x.lot} · ${WmsFifo.monthText(x.lm)}` : 'LOT 0 หรือว่าง เรียงอายุไม่ได้')}"><i class="fi-dot ${ageCls(x.age)}"></i>${esc(WmsFifo.lotName(x))} <span class="sm">· ${x.lm ? `${f(x.age)} เดือน` : 'ไม่รู้ LOT'}</span></td>
      <td class="c-pon">${WmsFifo.noPo(x.po) ? '<span class="sm">ไม่รู้ PO</span>' : esc(x.po)}</td>
      <td class="c-pon c-sup" title="${esc(s)}">${esc(s)}</td>
      <td class="sm" title="${esc(rw)}">${esc(recvShort(x))}</td>
      <td class="num"><b>${f(x.qty)}</b></td>
      <td class="num">${n0(x.open)}</td><td class="num">${n0(x.floor)}</td><td class="num">${n0(x.rack)}</td><td class="num">${n0(x.special)}</td>
      <td class="c-loc" title="${esc(lt)}">${esc(lt)}</td>
      <td${t ? ` title="${esc(t.cls === 'r-hot' && rt.to.length > 1 ? `${t.tip} · โลขาย ${rt.to.join(', ')}` : t.tip)}"` : ''}>${t ? t.html : ''}</td>
    </tr>`;
  }).join('');
}

const STOCK_HEAD = `<thead><tr><th class="c-sku">SKU</th><th>ชื่อสินค้า</th><th class="num" title="ลำดับ FIFO เก่าไปใหม่">#</th><th>LOT · อายุ</th>
  <th>PO</th><th>Supplier</th><th>รับเข้า</th><th class="num">คงเหลือ</th><th class="num" title="Location ที่ Status เปิด">โลขาย</th>
  <th class="num" title="ตั้งพื้น ยังไม่เปิดขาย">พื้น</th><th class="num" title="Location R ยังไม่เปิดขาย">แร็ค</th><th class="num" title="QA / IQA / RIB">QA</th>
  <th>Location</th><th>ต้องทำ</th></tr></thead>`;

function helpHtml() {
  const note = window.WmsSup && WmsSup.note(RES.sup);
  return `<div class="fi-help" id="help"${HELP ? '' : ' hidden'}>
      ${AGE_KEY.map(([c, t]) => `<span class="lg"><i class="sw ${c}"></i>${t}</span>`).join('')}· ● = อยู่ในโลขาย · # = ลำดับ FIFO<br>
      สต๊อก${esc(asOf())} เรียงกองเก่าไปใหม่ตาม <b>เดือนของ LOT</b> แล้ว <b>วันรับเข้าของ PO</b> · PO ที่ลง <b>-01 -02</b> รวมเป็นกองเดียว ใช้รอบไหนก่อนก็ได้ · ไม่นับ QA / IQA / RIB<br>
      <b>เติมก่อน</b> = กองเก่ายังอยู่บนแร็คหรือตั้งพื้น แต่โลขายมีแต่กองใหม่กว่า · <b>หยิบก่อน</b> = โลขายมีหลายกองปนกัน ให้หยิบกองนี้ก่อน · <b>แก้ LOT</b> = LOT 0 หรือว่าง<br>
      Supplier จากแท็บ PO. Truck ห้ามเปิดขายคนละ Supplier พร้อมกัน${note ? ` (${esc(note)})` : ''} · ปุ่มคัดลอกได้ทุก SKU ในคิวนี้ หนึ่งแถวต่อ SKU + LOT + PO</div>`;
}

function renderStock() {
  const all = AN.stock.list;
  if (ONLY === null) ONLY = WmsFifo.firstQueue(all);
  const chip = (x) => {
    const n = WmsFifo.filterStock(all, { only: x.id }).length;
    const on = x.id === ONLY;
    return `<button class="fi-qc ${QCLS[x.id]}${on ? ' on' : ''}${n ? '' : ' zero'}" data-only="${x.id}" aria-pressed="${on}" title="${esc(`${x.sub} — ${x.hint}`)}">${x.label} <b>${f(n)}</b></button>`;
  };
  $('body').innerHTML = `<div class="fi-tool">
      <span role="group" aria-label="คิวงาน" style="display:contents">${WmsFifo.QUEUES.map(chip).join('')}</span>
      <span class="sp"></span>
      <input id="q" class="fi-in" type="search" placeholder="ค้นหา SKU ชื่อ หรือ PO" value="${esc(Q)}" autocomplete="off">
      <select id="sort" class="fi-sel" aria-label="เรียงตาม">${Object.entries(SORTS).map(([k, t]) => `<option value="${k}" ${k === SORT ? 'selected' : ''}>เรียง: ${t}</option>`).join('')}</select>
      <button class="tx-opt" id="copyBtn" title="คัดลอกแล้ววางใน Excel ได้เลย หนึ่งแถวต่อ SKU + LOT + PO">📋 คัดลอก</button>
      <button class="fi-i${HELP ? ' on' : ''}" id="helpBtn" aria-expanded="${HELP}" aria-controls="help" aria-label="อ่านยังไง">i</button>
    </div>
    ${helpHtml()}
    <div id="list"></div>`;
  renderStockList();
}

function renderStockList() {
  const rows = stockRows();
  const copy = $('copyBtn');
  if (copy) { copy.textContent = `📋 คัดลอก ${f(rows.length)} SKU`; copy.disabled = !rows.length; }
  if (!rows.length) {
    $('list').innerHTML = Q ? '<div class="tx-empty art-search">ไม่พบ SKU ที่ตรงกับที่ค้น</div>'
      : ONLY ? '<div class="tx-empty art-done">คิวนี้ไม่มีงานค้าง</div>'
      : '<div class="tx-empty art-data">ไม่มีของคงเหลือในสมุด</div>';
    return;
  }
  const show = rows.slice(0, SHOW_MAX);
  $('list').innerHTML = `<div class="fi-wrap"><table class="fi-xl">${STOCK_HEAD}<tbody>${show.map(skuRows).join('')}</tbody></table>
    ${rows.length > SHOW_MAX ? `<div class="fi-more">แสดง ${f(SHOW_MAX)} จาก ${f(rows.length)} SKU — ค้นหาเพื่อดูส่วนที่เหลือ ปุ่มคัดลอกและดาวน์โหลดได้ครบ</div>` : ''}</div>`;
}

/* ── เบิกข้าม FIFO ─────────────────────────────────────────────────────── */

function skipRows() { return WmsFifo.skipsBySku(RES, AN, { kind: KIND, q: Q }); }

function skipDetail(e) {
  const rows = e.items.map((it) => {
    const mine = WmsFifo.sup(RES, it.po);
    const older = it.older.map((o) => {
      const s = WmsFifo.sup(RES, o.po);
      const other = s && mine && s !== mine;
      return `<span class="fi-loc${it.kind === 'sale' ? ' open' : ''}"${other ? ' title="ของที่เก่ากว่าเป็นคนละ Supplier ห้ามเปิดขายพร้อมกัน"' : ''}>LOT ${esc(o.lot)}${WmsFifo.noPo(o.po) ? '' : ` · PO ${esc(o.po)}`}${s ? ` · ${esc(s)}${other ? ' (คนละ Supplier)' : ''}` : ''} @ ${esc(loc(o.loc))} · ${f(o.qty)}</span>`;
    }).join('');
    const more = it.olderQty > it.older.reduce((a, o) => a + o.qty, 0) ? '<span class="tx-sub">และที่อื่น</span>' : '';
    return `<tr>
      <td class="nw k-date">${esc(dm(it.date))}${it.own ? '' : '<span class="tx-sub" title="แถวนี้ไม่มีวันที่ของตัวเอง ใช้วันที่ของแถวด้านบน">โดยประมาณ</span>'}</td>
      <td class="nw k-kind">${WmsFifo.KIND[it.kind]}<span class="tx-sub">${esc(loc(it.from))}${it.to >= 0 ? ` → ${esc(loc(it.to))}` : ''}</span></td>
      <td class="nw k-out">${lotText(it)}<span class="tx-sub">${WmsFifo.noPo(it.po) ? 'ไม่รู้ PO' : `PO ${esc(it.po)}`}${mine ? ` · ${esc(mine)}` : ''}${it.recv ? ` · รับ ${esc(it.recv === WmsFifo.COUNT_DAY ? 'ก่อนนับสต๊อก' : dm(it.recv))}` : ''}</span></td>
      <td class="num k-qty"><b>${f(it.qty)}</b><span class="tx-sub">ชิ้น</span></td>
      <td class="k-res"><span class="fi-tag ${it.state === 'lot' ? 't-lot' : 't-po'}">${WmsFifo.STATE[it.state]}</span></td>
      <td class="k-older" data-label="ของที่เก่ากว่าตอนนั้น"><div class="fi-locs">${older}</div>${more}</td>
      <td class="nw k-row" data-label="แถว">${rowLink(it.row)}</td>
    </tr>`;
  }).join('');
  return `<div class="tx-wrap"><table class="tx-tbl fi-dt dt-skip">
    <thead><tr><th>วันที่</th><th>ประเภท · จาก → ไป</th><th>ของที่ออก</th><th class="num">จำนวน</th><th>ผล</th><th>ของที่เก่ากว่าตอนนั้น</th><th>แถว</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function renderSkip() {
  const t = AN.totals;
  const opt = (v, label, n) => `<button class="tx-opt${KIND === v ? ' on' : ''}" data-kind="${v}">${label} ${f(n)} แถว</button>`;
  $('body').innerHTML = `<div class="tx-note"><b>หยิบขาย</b> = ขาย LOT หรือ PO ที่ใหม่กว่า ทั้งที่ของเก่ากว่ายังอยู่ในโลที่เปิดขาย ·
      <b>เติมของ</b> = เติมของใหม่กว่าเข้าโลขาย ทั้งที่ของเก่ากว่ายังอยู่บนแร็คหรือตั้งพื้น ·
      ไม่นับ QA / IQA / RIB และแถวที่ไม่รู้ LOT — ${esc(monthName(MONTH))}</div>
    <div class="tx-legend"><span><i class="sw c-lot"></i>ข้าม LOT = มี LOT เดือนเก่ากว่า</span><span><i class="sw c-po"></i>ข้าม PO = LOT เดียวกัน แต่มี PO อื่นที่รับเข้าก่อน (PO -01 -02 เป็น PO เดียวกัน ไม่นับ)</span></div>
    <div class="tx-bar">
      <input id="q" class="tx-input" type="search" placeholder="ค้นหา SKU หรือชื่อสินค้า" value="${esc(Q)}" autocomplete="off">
      ${opt('', 'ทั้งหมด', t.sale.skipRows + t.refill.skipRows)}${opt('sale', 'หยิบขาย', t.sale.skipRows)}${opt('refill', 'เติมของ', t.refill.skipRows)}
    </div>
    <div class="tx-bar fi-out">
      <button class="tx-opt" id="copyBtn">📋 คัดลอก</button>
      <span>คัดลอกแล้ววางใน Excel ได้เลย หนึ่งแถวต่อแถวในสมุด</span>
    </div>
    <div id="list"></div>`;
  renderSkipList();
}

function renderSkipList() {
  const rows = skipRows();
  const n = rows.reduce((a, e) => a + e.rows, 0);
  const copy = $('copyBtn');
  if (copy) { copy.textContent = `📋 คัดลอก ${f(n)} แถว`; copy.disabled = !n; }
  if (!rows.length) {
    const judged = KIND ? AN.totals[KIND].judged : AN.totals.sale.judged + AN.totals.refill.judged;
    $('list').innerHTML = Q ? '<div class="tx-empty art-search">ไม่พบ SKU ที่ตรงกับที่ค้น</div>'
      : judged ? `<div class="tx-empty art-done">${esc(monthName(MONTH))} เบิกตาม FIFO ทุกแถวที่ตรวจได้ — <b>เป็นเรื่องดี</b></div>`
      : `<div class="tx-empty art-data">${esc(monthName(MONTH))} ยังไม่มีแถวขายหรือเติมของที่ตรวจได้</div>`;
    return;
  }
  const show = rows.slice(0, SHOW_MAX);
  const part = (q, r, what) => q ? `<span>${what} <b>${f(q)}</b> ชิ้น · ${f(r)} ครั้ง</span>` : '';
  $('list').innerHTML = `<div class="fi-list">${show.map((e) => {
    const ok = e.judged - e.qty;
    const sale = e.items.filter((it) => it.kind === 'sale'), refill = e.items.filter((it) => it.kind === 'refill');
    return `<details class="fi-sku" data-skip="${e.sku}">
      <summary>
        <span class="fi-code"><b>${esc(e.code)}</b><span class="tx-sub">${esc(e.name)}</span></span>
        <span class="fi-bar" role="img" aria-label="${esc(`${e.code}: ตาม FIFO ${f(ok)} ชิ้น, ข้าม ${f(e.qty)} ชิ้น`)}">
          <span class="c-ok" style="flex:${ok}" title="ตาม FIFO ${f(ok)} ชิ้น"></span><span class="c-lot" style="flex:${e.qty}" title="ข้าม ${f(e.qty)} ชิ้น"></span></span>
        <span class="fi-tot"><b>${e.pct}%</b><span class="tx-sub">ตาม FIFO</span></span>
        <span class="fi-tags"><span class="fi-tag t-lot">ข้าม ${f(e.qty)} ชิ้น</span>
          <span class="tx-sub">${part(sale.reduce((a, x) => a + x.qty, 0), sale.length, 'หยิบขาย')}${sale.length && refill.length ? ' · ' : ''}${part(refill.reduce((a, x) => a + x.qty, 0), refill.length, 'เติมของ')}</span></span>
      </summary>
      <div class="fi-detail"></div>
    </details>`;
  }).join('')}
    ${rows.length > SHOW_MAX ? `<div class="fi-more">แสดง ${f(SHOW_MAX)} จาก ${f(rows.length)} SKU — ค้นหาเพื่อดูส่วนที่เหลือ ปุ่มคัดลอกและดาวน์โหลดได้ครบ</div>` : ''}</div>`;
}

/* ── อายุสต๊อก ──────────────────────────────────────────────────────────── */

function renderAge() {
  const s = AN.stock;
  const max = Math.max(1, ...s.aging.map((a) => a.qty), s.unknown);
  const row = (lab, sub, qty, skus, cls, title) => `<div class="fi-arow" title="${esc(title)}">
      <span class="fi-alab">${lab}<span class="tx-sub">${sub}</span></span>
      <span class="fi-atrack"><span class="fi-afill ${cls}" style="width:${(qty / max * 100).toFixed(2)}%"></span></span>
      <span class="fi-aval"><b>${f(qty)}</b> ชิ้น · ${pct(qty, s.total)}%<span class="tx-sub">${skus}</span></span>
    </div>`;
  const rows = s.aging.map((a) => row(`<b>${esc(WmsFifo.monthText(a.lm))}</b>`, `LOT ${esc(a.lots.join(', '))} · อายุ ${f(a.age)} เดือน`,
    a.qty, `${f(a.skus)} SKU`, ageCls(a.age), `${WmsFifo.monthText(a.lm)}: ${f(a.qty)} ชิ้น`)).join('')
    + (s.unknown ? row('<b>ไม่รู้ LOT</b>', 'LOT 0 หรือว่าง', s.unknown, 'เรียงอายุไม่ได้', 'c-u', `ไม่รู้ LOT: ${f(s.unknown)} ชิ้น`) : '');

  /* SKU ที่มีของเก่าที่สุด กองเก่าสุดของแต่ละ SKU */
  const old = s.list.filter((e) => e.oldest !== null).sort((a, b) => b.oldest - a.oldest || b.batches[0].qty - a.batches[0].qty).slice(0, 15);
  const oldRows = old.map((e) => {
    const x = e.batches[0];
    return `<tr>
      <td><b>${esc(e.code)}</b><span class="tx-sub">${esc(e.name)}</span></td>
      <td class="nw">${lotText(x)}<span class="tx-sub">อายุ ${f(x.age)} เดือน</span></td>
      <td class="num"><b>${f(x.qty)}</b><span class="tx-sub">จาก ${f(e.total)}</span></td>
      <td class="nw">${[x.open ? `ในโลขาย ${f(x.open)}` : '', x.floor ? `ตั้งพื้น ${f(x.floor)}` : '', x.rack ? `บนแร็ค ${f(x.rack)}` : '', x.special ? `QA ${f(x.special)}` : ''].filter(Boolean).join(' · ')}</td>
    </tr>`;
  }).join('');
  $('body').innerHTML = `<div class="tx-note">สต๊อก${esc(asOf())} รวมทั้งคลังตามเดือนของ LOT อายุนับจากเดือนของ LOT ถึง${esc(monthName(MONTH))}
      รวม <b>${f(s.total)}</b> ชิ้น</div>
    <div class="fi-age" role="list" aria-label="อายุสต๊อกตามเดือนของ LOT">${rows}</div>
    <div class="tx-bar fi-out" style="margin-top:12px"><button class="tx-opt" id="copyBtn">📋 คัดลอกตารางอายุสต๊อก</button></div>
    ${old.length ? `<h3 class="fi-h">SKU ที่มีของเก่าที่สุด</h3>
    <div class="tx-wrap"><table class="tx-tbl">
      <thead><tr><th>SKU</th><th>กองเก่าสุด</th><th class="num">ชิ้น</th><th>อยู่ที่</th></tr></thead>
      <tbody>${oldRows}</tbody></table></div>` : ''}`;
}

/* ── รวม ───────────────────────────────────────────────────────────────── */

function renderBody() {
  if (!txUrl()) {
    $('body').innerHTML = SHARE ? '<div class="tx-empty art-link">ลิงก์ไม่ครบ ขอลิงก์ใหม่จากคนที่ส่งให้</div>'
      : `<div class="tx-empty art-link">ยังไม่ได้ตั้ง Apps Script URL ของ Transaction — <a href="../settings/">ตั้งที่หน้าตั้งค่า</a><br>
      ใช้ URL เดียวกับหน้าสต๊อกราย Location</div>`;
    return;
  }
  if (BUSY) { $('body').innerHTML = ''; return; }
  if (!AN) {
    $('body').innerHTML = ERR ? '' : SHARE ? '<div class="tx-empty art-data">ยังไม่มีข้อมูล รอสักครู่ หน้านี้โหลดให้เอง</div>'
      : `<div class="tx-empty art-data">กด <b>ดึงข้อมูล</b> ด้านบน เพื่ออ่านสมุด Transaction ทั้งชีต</div>`;
    return;
  }
  if (TAB === 'skip') renderSkip();
  else if (TAB === 'age') renderAge();
  else renderStock();
}

function render() {
  renderSrc();
  renderSum();
  renderTabs();
  renderBody();
}

/* ── ส่งออก ────────────────────────────────────────────────────────────── */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    /* เบราว์เซอร์ที่ไม่ให้ใช้ clipboard ตรงๆ ใช้วิธีเลือกข้อความแล้วคัดลอกแทน */
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove();
    return ok;
  }
}

/** ตารางที่ปุ่มคัดลอกของแท็บนั้นจะได้ ตามตัวกรองที่เลือกอยู่ */
function tabTable() {
  if (TAB === 'age') return WmsFifo.agingTable(AN);
  if (TAB === 'skip') {
    const keep = new Set(skipRows().map((e) => e.sku));
    const all = WmsFifo.skipTable(RES, AN, KIND);
    const codes = new Set([...keep].map((s) => RES.skus[s][1]));
    return [all[0], ...all.slice(1).filter((r) => codes.has(r[2]))];
  }
  return WmsFifo.stockTable(RES, AN, stockRows());
}

let XLSX_LOAD = null;
function xlsxLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!XLSX_LOAD) {
    XLSX_LOAD = new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = () => ok(window.XLSX);
      s.onerror = () => { XLSX_LOAD = null; bad(new Error('โหลดตัวสร้างไฟล์ Excel ไม่ได้ ลองใหม่อีกครั้ง')); };
      document.head.appendChild(s);
    });
  }
  return XLSX_LOAD;
}

/** ไฟล์ส่ง Supply chain สี่ชีต ใช้ข้อมูลทั้งเดือนทั้งคลัง ไม่ขึ้นกับตัวกรองบนจอ */
async function downloadXlsx() {
  const btn = $('xlsxBtn');
  try {
    btn.disabled = true;
    btn.textContent = 'กำลังสร้างไฟล์…';
    const X = await xlsxLib();
    const wb = X.utils.book_new();
    const add = (name, aoa, widths) => {
      const ws = X.utils.aoa_to_sheet(aoa);
      ws['!cols'] = widths.map((w) => ({ wch: w }));
      if (aoa.length > 1 && aoa[0].length > 2) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
      X.utils.book_append_sheet(wb, ws, name);
    };
    const title = `รายงาน FIFO ${monthName(MONTH)} · สต๊อก${asOf()}`;
    add('สรุป', WmsFifo.summaryTable(AN, title), [34, 14, 14]);
    add('คงเหลือราย LOT', WmsFifo.stockTable(RES, AN), [16, 9, 40, 10, 6, 11, 10, 14, 14, 13, 9, 9, 9, 12, 40, 30]);
    add('เบิกข้าม FIFO', WmsFifo.skipTable(RES, AN), [11, 9, 16, 40, 9, 14, 14, 13, 8, 13, 13, 10, 50, 12, 9]);
    add('อายุสต๊อก', WmsFifo.agingTable(AN), [12, 12, 11, 10, 11, 8]);
    X.writeFile(wb, `fifo-${MONTH}.xlsx`);
    btn.textContent = 'ดาวน์โหลดแล้ว';
    window.WmsMotion?.saved(btn);
  } catch (e) {
    btn.textContent = e.message;
    window.WmsMotion?.shake(btn);
  }
  setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = XLSX_LABEL; } }, 2500);
}

/**
 * ลิงก์ Supply chain: คัดลอกแล้วส่งทาง LINE หรืออีเมลได้เลย คนได้ลิงก์ดูรายงานและดาวน์โหลด Excel เองได้ อ่านอย่างเดียว
 * ลิงก์มี URL สคริปต์ Transaction ใครได้ไปก็อ่านข้อมูลสมุดได้ (แก้ชีตไม่ได้) จะตัดต้อง Deploy สคริปต์เป็น URL ใหม่
 */
async function copyShare() {
  const btn = $('shareBtn');
  const link = WmsFifo.shareLink(SHARE_PAGE, txUrl());
  if (!(await copyText(link))) { prompt('คัดลอกลิงก์นี้ส่งให้ Supply chain', link); return; }
  btn.textContent = 'คัดลอกลิงก์แล้ว ส่งเฉพาะทีม Supply chain';
  window.WmsMotion?.saved(btn);
  setTimeout(() => { if (btn.isConnected) btn.textContent = SHARE_LABEL; }, 3000);
}

/* ── ปุ่มต่าง ๆ ────────────────────────────────────────────────────────── */

$('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (!t || t.dataset.tab === TAB) return;
  TAB = t.dataset.tab;
  Q = '';
  renderTabs();
  renderBody();
});

/* ตัวเลขในตารางสรุปที่กดได้: skip:sale / skip:refill ไปแท็บเบิกข้าม FIFO, stock:unknown ไปคิวไม่รู้ LOT */
$('sum').addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  const [tab, v] = g.dataset.go.split(':');
  TAB = tab;
  if (tab === 'skip') KIND = v; else ONLY = v;
  Q = '';
  renderTabs();
  renderBody();
  $('tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('body').addEventListener('click', (e) => {
  const only = e.target.closest('[data-only]');
  if (only) { ONLY = only.dataset.only; renderStock(); return; }
  const kind = e.target.closest('[data-kind]');
  if (kind) { KIND = kind.dataset.kind; renderSkip(); return; }
  const help = e.target.closest('#helpBtn');
  if (help) {
    HELP = !HELP;
    help.classList.toggle('on', HELP);
    help.setAttribute('aria-expanded', HELP);
    $('help').hidden = !HELP;
    return;
  }
  if (e.target.closest('#copyBtn')) {
    const btn = $('copyBtn');
    copyText(WmsFifo.tsv(tabTable())).then((ok) => {
      btn.textContent = ok ? 'คัดลอกแล้ว วางใน Excel ได้เลย' : 'คัดลอกไม่ได้ ลองกดอีกครั้ง';
      if (ok) window.WmsMotion?.saved(btn); else window.WmsMotion?.shake(btn);
    });
  }
});

/* รายละเอียดของแท็บเบิกข้าม FIFO วาดตอนเปิดครั้งแรก toggle ไม่ลอยขึ้นมา ต้องดักตอนขาลง */
$('body').addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.matches || !d.matches('details.fi-sku') || !d.open) return;
  const box = d.querySelector('.fi-detail');
  if (!box || box.childElementCount || d.dataset.skip === undefined) return;
  const s = skipRows().find((x) => String(x.sku) === d.dataset.skip);
  if (s) box.innerHTML = skipDetail(s);
}, true);

$('body').addEventListener('change', (e) => {
  if (e.target.id !== 'sort') return;
  SORT = e.target.value;
  renderStockList();
});

$('body').addEventListener('input', (e) => {
  if (e.target.id !== 'q') return;
  Q = e.target.value.trim();
  /* ไม่วาดช่องค้นใหม่ ไม่งั้นเคอร์เซอร์จะหลุดระหว่างพิมพ์ */
  if (TAB === 'skip') renderSkipList(); else renderStockList();
});

/**
 * ถามทุกนาทีว่ามีชุดใหม่ไหม มีแล้วโหลดเองโดยไม่ต้องกด
 * รอก่อนถ้ากำลังพิมพ์ค้นหาหรือเปิดดูรายละเอียดของ SKU ค้างอยู่ วาดใหม่ตอนนั้นกล่องที่เปิดไว้จะปิดเอง
 */
async function checkShared() {
  const url = txUrl();
  if (!url || LOADING) return false;
  const st = await WmsShared.status(url);
  if (!WmsShared.knows(st, 'transaction')) return false;
  const run = WmsShared.running(st, 'tx-fifo');
  const had = !!WAIT;
  WAIT = run;
  if (run) { if (!had) renderSrc(); return true; }
  if (!RES || !WmsShared.newer(st, 'tx-fifo', RES)) { if (had) renderSrc(); return false; }
  if (WmsShared.typing() || document.querySelector('#body details[open]')) { if (had) renderSrc(); return true; }
  await load(false, true);
  return false;
}

/* วางลิงก์ใหม่ลงแท็บที่เปิดค้างไว้ เบราว์เซอร์เปลี่ยนแค่ส่วนหลัง # ไม่โหลดหน้าใหม่ ต้องโหลดเองถึงจะใช้ URL ใหม่ */
if (SHARE) window.addEventListener('hashchange', () => location.reload());

render();
const WATCH = WmsShared.watch(checkShared);
if (txUrl()) load(false);
