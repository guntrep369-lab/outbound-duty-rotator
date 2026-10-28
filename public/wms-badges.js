/**
 * @file wms-badges.js — ตัวเลขแจ้งเตือนบนเมนูข้าง: สมุดกะมีงานค้างกี่รายการ
 *
 * ทุกหน้าที่มีเมนูข้างเห็นเลขนี้ คนที่มาเข้ากะจะรู้ทันทีว่ากะก่อนส่งงานต่อไว้ โดยไม่ต้องเปิดสมุดกะเอง
 *
 * นับจากสองที่ แล้วใช้ที่ใหม่กว่า
 * - ข้อมูลในเครื่อง (wms:roster) — หน้าสมุดกะ / ตารางกะบันทึกไว้ เห็นทันทีไม่ต้องรอเน็ต
 * - ชีตส่วนกลาง — เช็คฉบับ (rev) ทุก 3 นาที ถ้าอีกกะเพิ่งบันทึกจากเครื่องอื่น ค่อยโหลดมานับ
 *   แล้วเก็บแค่ตัวเลขไว้ (wms:shiftlog:badge) ไม่เขียนทับข้อมูลตารางกะในเครื่อง
 *
 * wms-shell.js เรียก mountBadges() หลังวาดเมนู
 */

const LOG_KEY = 'wms:roster';
const SYNC_KEY = 'wms:roster:sync';
const CACHE_KEY = 'wms:shiftlog:badge';
const FRESH_MS = 3 * 60 * 1000;
// สองหน้านี้ดึงชีตเองทุกนาทีอยู่แล้ว ข้อมูลในเครื่องจึงใหม่สุด ไม่ต้องเช็คซ้ำ
const SELF_SYNCED = ['shiftlog', 'roster'];

const pad = (n) => (n < 10 ? '0' : '') + n;
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = (s) => { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };

/** วันของกะตอนนี้ — ก่อน 7 โมงยังเป็นกะบ่ายของเมื่อวาน (แบบเดียวกับ ShiftLog.shiftAt) */
export function shiftDay(now) {
  const d = now.getHours() < 7 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
  return ymd(d);
}

/** งานที่ยังเปิดอยู่กี่รายการ กับวันที่ของรายการที่เก่าสุด */
export function countOpen(log) {
  let n = 0, oldest = '';
  for (const id in log || {}) {
    const e = log[id];
    if (!e || typeof e !== 'object' || !e.open) continue;
    n++;
    if (e.date && (!oldest || e.date < oldest)) oldest = String(e.date);
  }
  return { n, oldest };
}

/** ค้างมากี่วันแล้ว นับถึงวันของกะตอนนี้ */
export function ageDays(oldest, today) {
  if (!oldest) return 0;
  return Math.max(0, Math.round((pd(today) - pd(oldest)) / 86400000));
}

/**
 * เลขที่จะโชว์ — ข้อมูลในเครื่อง หรือตัวเลขจากชีต ถ้าชีตมีฉบับที่ใหม่กว่าที่เครื่องนี้มี
 * เครื่องนี้แก้ค้างไว้ยังไม่ได้ส่งขึ้นชีต (dirty) ใช้ของในเครื่อง — มีงานที่เพิ่งบันทึกอยู่ในนั้น
 * @param {{log:object, sync:object|null}} local
 * @param {{url, rev, n, oldest}|null} cache
 * @param {string} url ชีตตารางกะที่ตั้งไว้ตอนนี้
 */
export function pickCount(local, cache, url) {
  const mine = countOpen(local.log);
  const s = local.sync || {};
  if (!cache || !url || cache.url !== url || s.dirty) return mine;
  const localRev = s.url === url ? Number(s.rev) || 0 : 0;
  if (Number(cache.rev) > localRev) return { n: Number(cache.n) || 0, oldest: cache.oldest || '' };
  return mine;
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* เต็มหรือโหมดส่วนตัว — แค่ไม่มีเลขจากชีต */ }
}
function readLocal() {
  const d = readJSON(LOG_KEY);
  return { log: (d && d.shiftLog) || {}, sync: readJSON(SYNC_KEY) };
}
function settings() {
  const S = window.WmsSettings;
  return S ? { url: S.rosterUrl(), token: S.rosterToken() } : { url: '', token: '' };
}

/** วาดเลขบนเมนูสมุดกะ — 0 ไม่โชว์ · ค้าง 2 วันขึ้นไปเป็นสีแดงเหมือนในรายการค้าง */
export function renderBadge(doc = document, now = new Date()) {
  const links = doc.querySelectorAll('.sysmod[data-mod="shiftlog"]');
  if (!links.length) return;
  const cache = readJSON(CACHE_KEY);
  // หน้าที่ไม่ได้โหลด wms-settings.js (ย้อนหลัง, เอกสารขนส่ง) ไม่รู้ว่าตั้งชีตไหนไว้ — ใช้ชีตที่เช็คล่าสุด
  const url = window.WmsSettings ? settings().url : (cache && cache.url) || '';
  const { n, oldest } = pickCount(readLocal(), cache, url);
  const age = ageDays(oldest, shiftDay(now));
  links.forEach((a) => {
    let b = a.querySelector('.sysmod-badge');
    if (!n) { if (b) b.remove(); a.removeAttribute('title'); return; }
    if (!b) { b = doc.createElement('b'); b.className = 'sysmod-badge'; a.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('old', age >= 2);
    a.title = 'งานค้างในสมุดกะ ' + n + ' รายการ' + (age ? ' · เก่าสุดค้างมา ' + age + ' วัน' : '');
  });
}

let busy = false;
/** เช็คชีตว่ามีฉบับใหม่ไหม — มีก็โหลดมานับ ไม่มีก็จบที่คำขอเล็ก ๆ ครั้งเดียว */
export async function refreshFromSheet(force) {
  const { url, token } = settings();
  if (busy || !url || !token || !window.WmsGas) return;
  const cache = readJSON(CACHE_KEY);
  if (!force && cache && cache.url === url && Date.now() - (cache.at || 0) < FRESH_MS) return;
  busy = true;
  try {
    const r = await window.WmsGas.post(url, { op: 'rev', token }, { timeoutMs: 30000 });
    if (!r || r.app !== 'roster' || r.error) return;
    const local = readLocal(), s = local.sync || {};
    let c;
    if (s.url === url && Number(s.rev) === Number(r.rev) && !s.dirty) c = countOpen(local.log);
    else if (cache && cache.url === url && Number(cache.rev) === Number(r.rev)) c = cache;
    else {
      const full = await window.WmsGas.post(url, { op: 'load', token }, { timeoutMs: 60000 });
      if (!full || full.app !== 'roster' || full.error) return;
      c = countOpen((full.data && full.data.shiftLog) || {});
    }
    writeJSON(CACHE_KEY, { url, rev: Number(r.rev) || 0, n: c.n, oldest: c.oldest, at: Date.now() });
    renderBadge();
  } catch (e) {
    // เน็ตหลุดหรือชีตช้า — ใช้เลขเดิมไปก่อน รอบหน้าค่อยลองใหม่
  } finally {
    busy = false;
  }
}

/**
 * เรียกครั้งเดียวหลังวาดเมนู
 * หน้าสมุดกะบันทึกแล้วส่ง 'wms:shiftlog' มาให้วาดใหม่ แท็บอื่นบันทึกก็รู้จาก storage event
 */
export function mountBadges(activeId) {
  renderBadge();
  window.addEventListener('wms:shiftlog', () => renderBadge());
  window.addEventListener('storage', (e) => {
    if (e.key === LOG_KEY || e.key === SYNC_KEY || e.key === CACHE_KEY) renderBadge();
  });
  if (SELF_SYNCED.includes(activeId)) return;
  refreshFromSheet();
  setInterval(() => { if (!document.hidden) refreshFromSheet(); }, FRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderBadge(); refreshFromSheet(); } });
}
