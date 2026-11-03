/**
 * @file wms-motion.js — การเคลื่อนไหวที่เป็นลายเซ็นของระบบ ใช้ร่วมทุกหน้า
 *
 * ฉากเปิดระบบ (wms-gate.css) คือสายพานที่มีกล่องวิ่ง ไฟล์นี้พาภาพนั้นเข้ามาในหน้างาน
 * พร้อมน้องกล่อง (icons/mascot-*.png) ให้ทั้งระบบดูเป็นของชุดเดียวกัน
 *
 *  - สายพานรอโหลด: ขึ้นกลางล่างจอระหว่างรอ Apps Script ทุกหน้า (wms-gas.js ส่งสัญญาณ wms:busy)
 *  - แท็บ .tx-tabs: สีม่วงกวาดเข้ามาจากฝั่งแท็บเดิม เนื้อหาใน .tx-body ไล่ขึ้นทีละก้อน
 *  - ตัวเลข [data-count]: วิ่งขึ้นจาก 0 ตอนเปิดหน้า หน้าเว็บสั่ง countUp เองตอนได้ข้อมูลใหม่
 *    ตัวไหนลดลงจากรอบก่อนจะกะพริบเขียว
 *  - popIn / popOut / celebrate / cheer ให้หน้าเว็บเรียกผ่าน window.WmsMotion
 *  - shake / saved / bump: สั่นตอนผิด, เครื่องหมายถูกวาดตัวเองตอนบันทึกสำเร็จ, ป้ายตัวเลขเด้งตอนเลขเปลี่ยน
 *    ช่องที่เบราว์เซอร์บอกว่ากรอกไม่ครบสั่นเอง เลขบนแท็บ .tx-tabs เด้งเองเมื่อวาดใหม่แล้วเลขเปลี่ยน
 *
 * wms-shell.js เรียก mountMotion ให้ทุกหน้า สคริปต์ในหน้าเว็บรันก่อนโมดูลนี้ จึงต้องเรียกผ่าน
 * window.WmsMotion?. เสมอ ไม่มีก็แค่ไม่ขยับ ข้อมูลยังขึ้นครบ
 * เครื่องที่ตั้ง "ลดการเคลื่อนไหว" ไว้ ทุกอย่างหยุดนิ่ง ตัวเลขขึ้นค่าจริงทันที
 * Styles live in wms-theme.css.
 */

const SHOW_AFTER = 350;   // คำขอที่เสร็จเร็วกว่านี้ไม่ต้องมีอะไรกะพริบขึ้นมา
const COUNT_MS = 700;

let WIN = typeof window !== 'undefined' ? window : null;

const still = () => !!WIN?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/* ── สายพานรอโหลด ───────────────────────────────────────────────────────── */

/** ข้อความบนสายพาน คำขอที่ส่งข้อมูลขึ้นไปพูดคนละอย่างกับคำขอที่ดึงลงมา */
export function busyLabel(mode) {
  return mode === 'post' ? 'น้องกล่องกำลังส่งข้อมูล' : 'น้องกล่องกำลังไปหยิบข้อมูลมาให้';
}

export function busyHTML(root) {
  return `<span class="wms-busy-belt" aria-hidden="true"><i></i><i></i><i></i>` +
    `<img src="${root}icons/mascot-walk.png" alt="" width="36" height="36"></span>` +
    `<span class="wms-busy-t"></span><span class="wms-busy-s" aria-hidden="true"></span>`;
}

function mountBusy(doc, root) {
  let el = null, wait = 0, tick = 0, since = 0, mode = 'get';
  /* วินาทีอยู่นอกส่วนที่โปรแกรมอ่านจอพูด ไม่งั้นจะพูดตัวเลขทุกวินาที */
  const paint = () => {
    el.querySelector('.wms-busy-t').textContent = busyLabel(mode);
    const sec = Math.floor((Date.now() - since) / 1000);
    el.querySelector('.wms-busy-s').textContent = sec >= 1 ? `${sec} วิ` : '';
  };
  const show = () => {
    wait = 0;
    if (!el) {
      el = doc.createElement('div');
      el.className = 'wms-busy';
      el.setAttribute('role', 'status');
      el.innerHTML = busyHTML(root);
    }
    el.classList.remove('out');
    doc.body.appendChild(el);
    paint();
    tick = WIN.setInterval(paint, 1000);
  };
  const hide = () => {
    WIN.clearTimeout(wait);
    WIN.clearInterval(tick);
    wait = tick = since = 0;
    if (!el || !el.isConnected) return;
    const gone = el;
    gone.classList.add('out');
    WIN.setTimeout(() => { if (gone.classList.contains('out')) gone.remove(); }, 260);
  };
  const on = (n, m) => {
    if (n > 0) {
      if (m) mode = m;
      if (!since) { since = Date.now(); wait = WIN.setTimeout(show, SHOW_AFTER); }
    } else hide();
  };
  WIN.addEventListener('wms:busy', (e) => on(e.detail.n, e.detail.mode));
  /* หน้าที่เริ่มดึงตั้งแต่ก่อนโมดูลนี้โหลด สัญญาณแรกผ่านไปแล้ว ถามยอดค้างเอา */
  const n = WIN.WmsGas?.waiting?.();
  if (n) on(n);
}

/* ── แท็บ ────────────────────────────────────────────────────────────────── */

/** ไล่ก้อนเนื้อหาขึ้นทีละก้อน ใช้ตอนเปลี่ยนแท็บเท่านั้น วาดซ้ำในแท็บเดิมไม่ขยับ */
export function enter(box) {
  if (!box || still()) return;
  box.classList.remove('wms-enter');
  void box.offsetWidth;   // ให้แอนิเมชันเริ่มใหม่ ถ้ากดแท็บรัว ๆ
  box.classList.add('wms-enter');
  WIN.clearTimeout(box._wmsEnter);
  box._wmsEnter = WIN.setTimeout(() => box.classList.remove('wms-enter'), 700);
}

/** เลขบนแต่ละแท็บ ตามชื่อแท็บ (data-tab) เลขที่กำลังวิ่งอยู่ใช้ค่าจริงใน data-count */
export function tabNums(tabs) {
  const out = {};
  for (const t of tabs.querySelectorAll('.tx-tab[data-tab]')) {
    const n = t.querySelector('.n');
    if (n) out[t.dataset.tab] = n.dataset.count ?? n.textContent;
  }
  return out;
}

/**
 * หน้าเว็บวาดแถบแท็บใหม่ทั้งแถบทุกครั้ง จึงดูจากผลที่วาดเสร็จแทนการผูกกับปุ่ม
 * แท็บที่เลือกเปลี่ยนตำแหน่งเมื่อไร สีม่วงกวาดเข้ามาจากฝั่งที่แท็บเดิมอยู่
 * เลขบนแท็บไหนต่างจากรอบที่แล้ว เลขนั้นเด้ง แท็บที่เพิ่งมีเลขครั้งแรกไม่เด้ง
 */
function watchTabs(doc) {
  const onAt = (tabs) => [...tabs.querySelectorAll('.tx-tab')].findIndex((t) => t.classList.contains('on'));
  for (const tabs of doc.querySelectorAll('.tx-tabs')) {
    /* หน้าเว็บวาดแท็บแรกไปแล้วก่อนโมดูลนี้โหลด */
    let last = onAt(tabs), had = tabNums(tabs);
    const body = tabs.nextElementSibling?.classList.contains('tx-body') ? tabs.nextElementSibling : null;
    new WIN.MutationObserver(() => {
      const all = [...tabs.querySelectorAll('.tx-tab')];
      const nums = tabNums(tabs);
      for (const id in nums) {
        if (id in had && had[id] !== nums[id]) bump(tabs.querySelector(`.tx-tab[data-tab="${id}"] .n`));
      }
      had = nums;
      const i = onAt(tabs);
      if (i < 0 || i === last) return;
      if (last >= 0 && !still()) {
        all[i].classList.add(i > last ? 'from-l' : 'from-r');
        enter(body);
      }
      last = i;
    }).observe(tabs, { childList: true });
  }
}

/* ── ตัวเลข ──────────────────────────────────────────────────────────────── */

/** ค่าที่ขึ้นอยู่ตอนนี้ของตัวเลขที่มีชื่อ เก็บไว้ก่อนวาดข้อมูลชุดใหม่ แล้วส่งให้ countUp */
export function counts(root) {
  const out = {};
  for (const el of root.querySelectorAll('[data-count][data-count-key]')) out[el.dataset.countKey] = Number(el.dataset.count);
  return out;
}

/**
 * ตัวเลขวิ่งจากค่าเดิมไปค่าจริง ข้อความในช่องต้องเป็นตัวเลขอย่างเดียว ค่าจริงอยู่ใน data-count
 * ไม่มีค่าเดิมเริ่มจาก 0 ตัวที่ลดลงจากค่าเดิมกะพริบเขียว = แก้ไปได้แล้ว
 * @param {ParentNode} root
 * @param {Object<string, number>} [from] จาก counts() ก่อนวาดข้อมูลชุดใหม่
 */
export function countUp(root, from = {}) {
  const runs = [];
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count), key = el.dataset.countKey;
    const had = key != null && key in from;
    const start = had ? from[key] : 0;
    if (!Number.isFinite(to) || start === to) continue;
    if (had && to < start) {
      el.classList.remove('wms-drop');
      void el.offsetWidth;
      el.classList.add('wms-drop');
    }
    if (!still()) runs.push({ el, start, to });
  }
  if (!runs.length) return;
  const t0 = WIN.performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / COUNT_MS), e = 1 - Math.pow(1 - p, 3);
    for (const r of runs) r.el.textContent = fmt(r.start + (r.to - r.start) * e);
    if (p < 1) WIN.requestAnimationFrame(step);
  };
  for (const r of runs) r.el.textContent = fmt(r.start);
  WIN.requestAnimationFrame(step);
}

/* ── หน้าต่างป๊อปอัป ─────────────────────────────────────────────────────── */

/** ขยายกล่องออกมาจากจุดที่กด จุดนี้คือที่ที่กล่องจะหดกลับไปตอนปิดด้วย */
export function popIn(box, at) {
  if (!box || still()) return;
  const r = box.getBoundingClientRect();
  const x = at ? at.x - r.left : r.width / 2, y = at ? at.y - r.top : r.height / 2;
  box.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
  box.classList.add('wms-pop-in');
  box.addEventListener('animationend', () => box.classList.remove('wms-pop-in'), { once: true });
}

/**
 * หดกล่องกลับไปที่จุดเดิม แล้วค่อยให้หน้าเว็บปิดจริง
 * at = จุดที่กดเปิด ส่งมาอีกครั้งเมื่อกล่องถูกวาดใหม่ระหว่างเปิดอยู่ (จุดที่ตั้งไว้หายไปกับกล่องเก่า)
 */
export function popOut(box, done, at) {
  if (!box || still()) { done(); return; }
  if (at) {
    const r = box.getBoundingClientRect();
    box.style.transformOrigin = `${Math.round(at.x - r.left)}px ${Math.round(at.y - r.top)}px`;
  }
  let fired = false;
  const end = () => { if (!fired) { fired = true; done(); } };
  box.classList.add('wms-pop-out');
  box.parentElement?.classList.add('wms-fading');
  box.addEventListener('animationend', end, { once: true });
  WIN.setTimeout(end, 320);   // แท็บอยู่เบื้องหลัง แอนิเมชันไม่วิ่ง ก็ยังต้องปิด
}

/* ── ผิด / สำเร็จ / ป้ายตัวเลข ───────────────────────────────────────────── */

/** ใส่คลาสให้แอนิเมชันเล่นหนึ่งรอบ มาซ้ำระหว่างที่ยังเล่นอยู่ก็เริ่มใหม่ */
function replay(el, cls, ms) {
  if (!el?.classList || !WIN || still()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  WIN.clearTimeout(el['_' + cls]);
  el['_' + cls] = WIN.setTimeout(() => el.classList.remove(cls), ms);
}

/** สั่นซ้ายขวาสั้น ๆ ตอนกรอกผิดหรือส่งไม่สำเร็จ ตาจะไปที่จุดนั้นเอง */
export function shake(el) { replay(el, 'wms-shake', 500); }

/** ป้ายตัวเลขเด้งขึ้นหนึ่งที ตอนเลขเปลี่ยน */
export function bump(el) { replay(el, 'wms-bump', 500); }

/* เครื่องหมายที่หน้าเว็บเขียนไว้หน้าข้อความสำเร็จ ไม่มีโมดูลนี้ก็ยังเห็นเครื่องหมายเดิม */
const MARK = /^\s*(?:✓|✅|☁️?)\s*/u;
const CHECK = '<svg class="wms-check" viewBox="0 0 20 20" aria-hidden="true">' +
  '<circle cx="10" cy="10" r="8.5" pathLength="1"/><path d="M6 10.4l2.7 2.7L14.2 7.4" pathLength="1"/></svg>';

/**
 * วงกลมกับเครื่องหมายถูกวาดตัวเองขึ้นหน้าข้อความ ตอนบันทึกหรือส่งสำเร็จ
 * ข้อความที่ขึ้นต้นด้วย ✓ ✅ ☁ อยู่แล้ว ตัวนั้นถูกแทนที่ ไม่ได้ซ้อนกันสองตัว
 * ลดการเคลื่อนไหวไว้ เครื่องหมายขึ้นนิ่ง ๆ เลย
 */
export function saved(el) {
  if (!el) return;
  el.querySelector(':scope > .wms-check')?.remove();
  const first = el.firstChild;
  if (first?.nodeType === 3) first.nodeValue = first.nodeValue.replace(MARK, '');
  el.insertAdjacentHTML('afterbegin', CHECK);
}

/* ── ฉลอง ────────────────────────────────────────────────────────────────── */

const CONFETTI = ['#6366F1', '#A5B4FC', '#22C55E', '#F59E0B', '#F472B6', '#38BDF8'];

/** พลุกระดาษแตกออกจากกลางกล่องที่ส่งมา กล่องต้องเป็น position:relative หรือ fixed */
export function celebrate(host) {
  if (!host || still()) return;
  const doc = host.ownerDocument;
  const burst = doc.createElement('span');
  burst.className = 'wms-confetti';
  burst.setAttribute('aria-hidden', 'true');
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const d = 70 + Math.random() * 80;
    const p = doc.createElement('i');
    p.style.cssText = `--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d * 0.8 - 40)}px;` +
      `--r:${Math.round(Math.random() * 600 - 300)}deg;background:${CONFETTI[i % CONFETTI.length]};` +
      `animation-delay:${Math.round(Math.random() * 90)}ms`;
    burst.appendChild(p);
  }
  host.appendChild(burst);
  WIN.setTimeout(() => burst.remove(), 1500);
}

let ROOT = './';

/**
 * การ์ดฉลองกลางล่างจอ ที่เดียวกับสายพานรอโหลด สายพานหายไปแล้วน้องกล่องกระโดดขึ้นมาแทน
 * @param {string} title ข้อความหลัก
 * @param {string} [sub] บรรทัดรอง
 */
export function cheer(title, sub = '') {
  const doc = WIN?.document;
  if (!doc?.body) return;
  doc.querySelector('.wms-cheer')?.remove();
  const el = doc.createElement('div');
  el.className = 'wms-cheer';
  el.setAttribute('role', 'status');
  el.innerHTML = `<img src="${ROOT}icons/mascot-cheer.png" alt="" width="56" height="56"><span><b></b><small></small></span>` +
    `<button type="button" aria-label="ปิด">✕</button>`;
  el.querySelector('b').textContent = title;
  el.querySelector('small').textContent = sub;
  const close = () => {
    el.classList.add('out');
    WIN.setTimeout(() => el.remove(), 260);
  };
  el.querySelector('button').addEventListener('click', close);
  /* สายพานรอโหลดอยู่ที่เดียวกันและกำลังหายไป รอให้หายก่อนค่อยขึ้น */
  WIN.setTimeout(() => {
    doc.body.appendChild(el);
    celebrate(el);
    WIN.setTimeout(close, 6000);
  }, doc.querySelector('.wms-busy') ? 280 : 0);
}

/**
 * @param {Document} doc
 * @param {string} root path back to the site root, same as wms-shell.js's data-root
 */
export function mountMotion(doc, root, win = WIN) {
  WIN = win;
  ROOT = root;
  win.WmsMotion = { counts, countUp, enter, popIn, popOut, celebrate, cheer, shake, saved, bump };
  if (!doc.body) return;   // เทสต์ที่ไม่มีหน้าเว็บจริง
  mountBusy(doc, root);
  watchTabs(doc);
  /* ช่องที่ติด required / pattern แล้วกดส่ง เบราว์เซอร์ขึ้นคำเตือนเอง เราแค่ให้ช่องนั้นสั่นด้วย */
  doc.addEventListener('invalid', (e) => shake(e.target), true);
  doc.documentElement.classList.add('wms-moving');   // ตัวเลขที่ซ่อนรอไว้ (wms-theme.css) เริ่มนับได้
  countUp(doc);
}
