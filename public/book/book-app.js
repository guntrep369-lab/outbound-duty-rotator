/**
 * book-app.js — แอปสมุดสต๊อกของทีม Inventory (ระบบใหม่เท่านั้น: จริง · ซ้อม · ทดลอง)
 *
 *   เมนูของแอปแทนเมนู WMS   วันนี้ · ขาออก · ขาเข้า · ในคลัง · คุมยอด · ค้นหา · ตั้งค่า พร้อมตัวเลขงานค้าง
 *                          จอกว้าง = แถบซ้าย · มือถือ = แถบบน กด ☰ เปิดเมนู
 *   🏠 วันนี้              การ์ดงานค้าง (ชุดรอส่ง รอลง TRcloud ยอดยกมา วางชีตเดิม ปิดเดือน ร่างค้าง) · งานประจำวัน · ใบล่าสุดของวันนี้
 *   🔎 เอกสาร             ค้นทุกใบในสำเนาเครื่องนี้ · กดเลขที่ = ดูทีละใบ: ขั้นตอน ประวัติ แถว ออเดอร์
 *                          ใส่เลข TRcloud · ยกเลิก (หัวหน้า) · ใบเดิม ↔ ใบกลับรายการ ลิงก์ถึงกัน · ลิงก์ #doc=เลขที่ ส่งต่อได้
 *   ✓ ตรวจ / อนุมัติ       ใบย้ายกับแปลง: ผู้จัดทำ → ผู้ตรวจสอบ (ไม่ใช่คนทำ) → ผู้อนุมัติ (หัวหน้า) ทีละใบหรือติ๊กหลายใบ
 *   🖨 พิมพ์ใบ              ใบย้าย / แปลง พิมพ์เป็นใบโอน / ใบขอแปลง A5 แบบเอกสารคลังสินค้าเดิม (wms-fire-print.js) ใบอื่นพิมพ์หน้าจอ
 *   คิดจากสำเนาในเครื่อง ไม่อ่านฐานเพิ่ม ยกเว้นหัวหน้าเปิดหน้าวันนี้: xfer/log กับ arch/index อย่างละ 1 ครั้ง (เก็บไว้ 10 นาที)
 *
 * ระบบเดิม (Apps Script) ไม่ใช้ไฟล์นี้ หน้าเหมือนเดิมทุกอย่าง (แผนถอยกลับ)
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (FIRE USER MODE PENDING FILES MERGED SEEN BSTATE BKBUSY esc f table isHead setMode render
 * voidDoc copyText) กับ BookGrid BookFireSet BookFireTrc ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า เปิดเป็น window.BookApp
 */
(function () {
  'use strict';

  var ON = !!window.BookFire;
  var Q_KEY = 'wms:book:app:q';
  var HX_MS = 600000;         // ข้อมูลหัวหน้าของหน้าวันนี้ (ชีตเดิม ปิดเดือน) เก็บไว้กี่ ms
  var XFER_DAYS = 35;         // ช่วงเปลี่ยนผ่าน: นับจากวันลงยอดยกมา
  var TRC_OLD = 7;            // ยอด TRcloud เก่ากว่านี้ (วัน) เตือนหัวหน้า
  var ROWS_MAX = 500;         // แถวต่อตารางในหน้าดูทีละใบ

  /* ไอคอนเส้น (แบบ Lucide) ตัวเดียวกันทั้งเมนูและหน้าวันนี้ */
  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    cut: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    gr: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    ret: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    move: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    conv: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    trc: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
    adj: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M3 7h18"/><path d="m6 7-3 7a3 3 0 0 0 6 0z"/><path d="m18 7-3 7a3 3 0 0 0 6 0z"/>',
    rows: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    close: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    docs: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3v5h5"/><path d="M19 8v3"/><circle cx="16.5" cy="16.5" r="3"/><path d="m21 21-2.4-2.4"/>',
    set: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    wms: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  function ic(k, cls) {
    return '<svg class="' + (cls || 'bn-ic') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>';
  }

  /* เมนูของแอป เรียงตามงานในวันหนึ่ง · head = เฉพาะหัวหน้า */
  var NAV = [
    { k: 'home', t: 'วันนี้' },
    { g: 'ขาออก' }, { k: 'cut', t: 'ตัดขาย' },
    { g: 'ขาเข้า' }, { k: 'gr', t: 'รับของ' }, { k: 'ret', t: 'คืนของ' },
    { g: 'ในคลัง' }, { k: 'move', t: 'ย้าย / เติม / QA' }, { k: 'conv', t: 'แปลงสินค้า' },
    { g: 'คุมยอด' }, { k: 'trc', t: 'TRcloud' }, { k: 'adj', t: 'ปรับยอด', head: 1 }, { k: 'rows', t: 'ตารางแบบเดิม', head: 1 },
    { k: 'close', t: 'ปิดวัน / เดือน', head: 1 },
    { g: 'ค้นหา' }, { k: 'docs', t: 'เอกสาร' },
    { g: '' }, { k: 'set', t: 'ตั้งค่า' },
  ];
  var TYPE_OF = { cut: 'ตัดขาย', gr: 'รับของ', move: 'ย้าย', ret: 'คืน', conv: 'แปลง', adj: 'ปรับยอด', rows: 'ตารางเดิม' };
  var FLOW = ['cut', 'gr', 'move', 'ret', 'conv'];
  var TYPES = ['ตัดขาย', 'รับของ', 'ย้าย', 'คืน', 'แปลง', 'ปรับยอด', 'ตารางเดิม', 'กลับรายการ', 'ยอดยกมา'];
  var RANGES = [['today', 'วันนี้'], ['d7', '7 วัน'], ['d30', '30 วัน'], ['month', 'เดือนนี้'], ['all', 'ทั้งหมด']];

  var NAV_OPEN = false;
  var HX = null, HX_AT = 0, HX_BUSY = false, HX_FOR = '';   // { xfer: [วัน] | null, arch: สรุปปิดเดือน | null }
  var Q = (function () {
    var q = { text: '', type: '', status: '', range: 'd7' };
    try { var s = JSON.parse(localStorage.getItem(Q_KEY) || 'null'); if (s) { q.type = s.type || ''; q.status = s.status || ''; q.range = s.range || 'd7'; } } catch (e) {}
    return q;
  })();
  var DOC = docFromHash();    // เลขที่ที่เปิดดูอยู่ ('' = รายการ)
  var NOTE = null;            // { kind, html } ของหน้าเอกสาร
  var BUSY = '';
  var SEL = {};               // ใบที่ติ๊กไว้ตรวจ / อนุมัติ { เลขที่: 1 }
  var TYPING = null;

  function $(id) { return document.getElementById(id); }
  function head() { return isHead(); }
  function viewer() { return !USER || USER.role === 'ดูอย่างเดียว'; }
  /** บัญชีที่เข้าอยู่ { email, name, role: head | staff | viewer } (สิทธิ์แบบที่ระบบใหม่ใช้) */
  function me() { return (FIRE && FIRE.user && FIRE.user()) || { email: '', role: 'viewer' }; }
  function C() { return window.WmsFireCore; }
  function docFromHash() { var m = /^#doc=([A-Za-z0-9-]{1,20})$/.exec(location.hash || ''); return m ? m[1].toUpperCase() : ''; }
  function saveQ() { try { localStorage.setItem(Q_KEY, JSON.stringify({ type: Q.type, status: Q.status, range: Q.range })); } catch (e) {} }
  function thDate(day) {
    var p = String(day || '').split('-');
    if (p.length !== 3) return '';
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 5)).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function dmy(day) { var p = String(day || '').split('-'); return p.length === 3 ? +p[2] + '/' + +p[1] + '/' + p[0].slice(2) : ''; }
  function hm(stamp) { return String(stamp || '').slice(11, 16); }
  function when(stamp) { var s = String(stamp || ''); return s ? dmy(s.slice(0, 10)) + ' ' + s.slice(11, 16) : ''; }
  /** ชื่อคน: อีเมลของเราเอง / ของคนลงใบนั้น = ชื่อ · อีเมลอื่น = ส่วนหน้า @ */
  function who(s, v) {
    s = String(s || '');
    if (s.indexOf('@') < 0) return s;
    if (USER && s === USER.email) return USER.who;
    if (v && s === v.by && v.name) return v.name;
    return s.slice(0, s.indexOf('@'));
  }

  /* ── งานค้างในเครื่องนี้ ─────────────────────────────────────────────── */

  /** [{k, t, sent, rows}] โหมดที่มีชุดรอส่ง (sent) หรือร่างที่ยังไม่บันทึก */
  function local() {
    var out = [];
    NAV.forEach(function (n) {
      if (!TYPE_OF[n.k] || (n.head && !head())) return;
      if (n.k === 'cut') {
        if (PENDING) out.push({ k: 'cut', t: n.t, sent: true, rows: PENDING.copy ? PENDING.copy.length : 0 });
        else if (FILES.length) {
          /* ไฟล์ที่ลงสมุดแล้วยังค้างบนแท็บให้ดูผล: นับเฉพาะบรรทัดที่ยังไม่ตัด */
          var left = MERGED.lines.filter(function (l) { return !SEEN[l.key]; }).length;
          if (left) out.push({ k: 'cut', t: n.t, sent: false, rows: left, files: FILES.length });
        }
      } else if (BookGrid.pending(n.k)) out.push({ k: n.k, t: n.t, sent: true, rows: 0 });
      else if (BookGrid.filled && BookGrid.filled(n.k)) out.push({ k: n.k, t: n.t, sent: false, rows: BookGrid.filled(n.k) });
    });
    return out;
  }
  function xferLeft() {
    if (!HX || !HX.xfer) return [];
    var op = BSTATE && BSTATE.open, from = op ? String(op.at || '').slice(0, 10) : '';
    var day = FIRE.home() ? FIRE.home().day : '';
    if (!from || !day || C().dayNo(day) - C().dayNo(from) > XFER_DAYS) {
      /* หลังช่วงเปลี่ยนผ่าน: เตือนเฉพาะตอนยังวางกันอยู่ (มีวันที่วางแล้วใน 10 วันล่าสุด) */
      var recent = HX.xfer.some(function (d) { return d.done && day && C().dayNo(day) - C().dayNo(d.day) <= 10; });
      if (!recent) return [];
    }
    return HX.xfer.filter(function (d) { return (!d.done || d.more) && d.day < day; });
  }
  function archDue() { return HX && HX.arch && HX.arch.next && HX.arch.next.m ? HX.arch.next : null; }
  function closeDue() { return head() ? xferLeft().length + (archDue() ? 1 : 0) : 0; }

  /** ข้อมูลหัวหน้าของหน้าวันนี้ (อ่านฐานอย่างละ 1 ครั้ง เก็บไว้ HX_MS) */
  async function loadHx(force) {
    if (!head() || HX_BUSY) return;
    if (!force && HX && HX_FOR === USER.email && Date.now() - HX_AT < HX_MS) return;
    HX_BUSY = true;
    var x = null, a = null;
    try { var r1 = await FIRE.xferDays(); if (!r1.error) x = r1.days; } catch (e) {}
    try { var r2 = await FIRE.archInfo(); if (!r2.error) a = r2; } catch (e) {}
    HX = { xfer: x, arch: a }; HX_AT = Date.now(); HX_FOR = USER.email; HX_BUSY = false;
    if (window.render) window.render();
  }

  /* ── เมนู ──────────────────────────────────────────────────────────── */

  function tabs() {
    return NAV.filter(function (n) { return n.k && (!n.head || head()); }).map(function (n) { return [n.k, n.t]; });
  }
  function title(k) { var n = NAV.filter(function (x) { return x.k === k; })[0]; return n ? n.t : ''; }

  /** ใบที่รอเรา: ตรวจได้ (คนอื่นทำ) + อนุมัติได้ (หัวหน้า) */
  function okTodo(h) { return h && h.ok && !viewer() ? h.ok.toCheck + (head() ? h.ok.approve : 0) : 0; }

  function badge(k, h, mine) {
    if (k === 'trc' && h && h.wait.n && !viewer()) return '<span class="bn-n' + (h.wait.days >= 2 ? ' bad' : '') + '" title="รอลง TRcloud">' + f(h.wait.n) + '</span>';
    if (k === 'docs' && okTodo(h)) return '<span class="bn-n' + (h.ok.days >= 2 ? ' bad' : '') + '" title="รอตรวจ / อนุมัติ">' + f(okTodo(h)) + '</span>';
    if (k === 'close') { var n = closeDue(); return n ? '<span class="bn-n">' + f(n) + '</span>' : ''; }
    var p = mine.filter(function (x) { return x.k === k; })[0];
    if (p) return '<span class="bn-dot' + (p.sent ? ' bad' : '') + '" title="' + (p.sent ? 'มีชุดรอส่ง' : 'มีร่างยังไม่บันทึก') + '"></span>';
    return '';
  }

  function renderNav() {
    var el = $('bkNav');
    if (!el) return;
    if (!ON || !USER) { el.hidden = true; document.documentElement.classList.remove('bk-in'); return; }
    el.hidden = false;
    document.documentElement.classList.add('bk-in');
    var h = FIRE.home(), mine = local(), alerts = 0, html = '';
    NAV.forEach(function (n) {
      if (n.g !== undefined) { html += n.g ? '<div class="bn-g">' + esc(n.g) + '</div>' : '<div class="bn-sp"></div>'; return; }
      if (n.head && !head()) return;
      var b = badge(n.k, h, mine);
      if (b) alerts++;
      html += '<button type="button" class="bn-it' + (MODE === n.k ? ' on' : '') + '" data-mode="' + n.k + '"' + (MODE === n.k ? ' aria-current="page"' : '') + '>' +
        ic(n.k) + '<span class="bn-t">' + esc(n.t) + '</span>' + b + '</button>';
    });
    var mode = FIRE.mode === 'demo' ? '<span class="bn-mode">โหมดซ้อม</span>' : FIRE.mode === 'dev' ? '<span class="bn-mode">ฐานทดลอง</span>' : '';
    el.className = 'bk-nav' + (NAV_OPEN ? ' open' : '');
    el.innerHTML =
      '<div class="bn-top">' +
        '<button type="button" class="bn-burger" id="bnBurger" aria-expanded="' + NAV_OPEN + '" aria-controls="bnList" aria-label="เมนู">' + ic(NAV_OPEN ? 'x' : 'menu') +
          (alerts && !NAV_OPEN ? '<span class="bn-alert"></span>' : '') + '</button>' +
        '<img class="bn-logo" src="../icons/notebook.png" alt="" width="28" height="28">' +
        '<div class="bn-brand"><b>สมุดสต๊อก</b><span>Inventory</span>' + mode + '</div>' +
        '<span class="bn-cur">' + esc(title(MODE)) + '</span>' +
      '</div>' +
      '<div class="bn-list" id="bnList">' + html +
        '<a class="bn-it bn-out" href="../">' + ic('wms') + '<span class="bn-t">เมนู WMS อื่น</span></a>' +
        '<div class="bn-me" title="' + esc(USER.email || '') + '"><span><b>' + esc(USER.who) + '</b>' + esc(USER.role) + '</span><button type="button" class="bn-off" id="bkOut">ออก</button></div>' +
      '</div>';
  }

  /* ── สถานะเอกสาร (ชิป) ───────────────────────────────────────────────── */

  /** ชิปตรวจ / อนุมัติ (x.ok จาก brief หรือ view) */
  function okChip(x) {
    if (!x || !x.ok) return '';
    if (x.ok === 'check') return '<span class="ba-st wait">รอตรวจ</span>';
    if (x.ok === 'approve') return '<span class="ba-st apv" title="ตรวจโดย ' + esc(x.ck && x.ck.name !== undefined ? x.ck.name : x.ck || '') + '">รออนุมัติ</span>';
    return '<span class="ba-st ok" title="อนุมัติโดย ' + esc(x.ap && x.ap.name !== undefined ? x.ap.name : x.ap || '') + '">✓ อนุมัติแล้ว</span>';
  }

  function stChips(x) {
    var out = '';
    if (x.voided) out += '<span class="ba-st void" title="' + esc((x.voided.by || '') + ' · ' + (x.voided.why || '')) + '">ยกเลิกแล้ว' + (x.voided.link ? ' → ' + esc(x.voided.link) : '') + '</span>';
    if (x.link) out += '<span class="ba-st rev" title="ใบนี้ลงกลับรายการของ ' + esc(x.link) + '">↩ ' + esc(x.link) + '</span>';
    if (x.type === 'ยอดยกมา') out += '<span class="ba-st sub">จุดเริ่มสมุด</span>';
    out += okChip(x);
    if (x.state === 'wait') out += '<span class="ba-st wait">รอลง TRcloud</span>';
    else if (x.state === 'done') out += '<span class="ba-st ok" title="เลข TRcloud">TRcloud ' + esc(x.tr) + '</span>';
    if (!out) out = '<span class="ba-st okk">✓ บันทึกแล้ว</span>';
    return out;
  }
  function docBtn(no) { return '<button type="button" class="ba-no" data-doc="' + esc(no) + '">' + esc(no) + '</button>'; }

  /* ── 🏠 วันนี้ ──────────────────────────────────────────────────────── */

  function cards(h) {
    var out = [], mine = local();
    mine.filter(function (p) { return p.sent; }).forEach(function (p) {
      out.push({ tone: 'bad', title: 'ชุดรอส่ง · ' + p.t, sub: 'ส่งไม่สำเร็จ ระบบส่งซ้ำเองทุก 30 วินาที ไม่บันทึกซ้ำ', go: p.k, act: 'ไปดู' });
    });
    if (h.ok && h.ok.toCheck && !viewer()) {
      out.push({ tone: 'warn', n: h.ok.toCheck, title: 'รอตรวจ', sub: 'ใบย้าย / แปลง ที่คนอื่นทำ · เช็คของจริงแล้วกด ตรวจแล้ว', go: 'docs', sec: 'check', act: 'ตรวจ' });
    }
    if (h.ok && h.ok.approve && head()) {
      out.push({ tone: h.ok.days >= 2 ? 'bad' : 'warn', n: h.ok.approve, title: 'รออนุมัติ',
        sub: 'ตรวจแล้ว รอหัวหน้ากด อนุมัติ · เก่าสุด ' + (h.ok.days ? h.ok.days + ' วันก่อน' : 'วันนี้'), go: 'docs', sec: 'approve', act: 'อนุมัติ' });
    }
    if (head() && !h.open) out.push({ tone: 'bad', title: 'ยังไม่ลงยอดยกมา', sub: 'ลงก่อนเริ่มใช้สมุด · ไฟล์จากหน้านับสต๊อกใหญ่', go: 'set', sec: 'open', act: 'ลงยอด' });
    if (h.wait.n && !viewer()) {
      out.push({ tone: h.wait.days >= 2 ? 'bad' : 'warn', n: h.wait.n, title: 'รอลง TRcloud',
        sub: 'เก่าสุด ' + (h.wait.days ? h.wait.days + ' วันก่อน' : 'วันนี้') + (h.wait.file ? ' · ออกไฟล์ปรับยอด ' + f(h.wait.file) : '') + (h.wait.number ? ' · ใส่เลข ' + f(h.wait.number) : ''),
        go: 'trc', sec: 'wait', act: 'ใส่เลข' });
    }
    if (head()) {
      var xl = xferLeft();
      if (xl.length) out.push({ tone: 'warn', n: xl.length, title: 'วางแถวลงชีตเดิม', sub: 'ช่วงเปลี่ยนผ่าน · ' + xl.slice(0, 3).map(function (d) { return dmy(d.day); }).join(', ') + (xl.length > 3 ? ' …' : ''), go: 'close', sec: 'xfer', act: 'คัดลอก' });
      var ad = archDue();
      if (ad) out.push({ tone: 'info', title: 'ปิดเดือน ' + ad.label + ' ได้แล้ว', sub: f(ad.docs) + ' เอกสาร · เครื่องใหม่โหลดเร็วขึ้น ประหยัดโควตา', go: 'close', sec: 'arch', act: 'ปิดเดือน' });
      if (h.open) {
        var old = h.trcDay ? C().dayNo(h.day) - C().dayNo(h.trcDay) : -1;
        if (old < 0 || old > TRC_OLD) out.push({ tone: 'info', title: h.trcDay ? 'ยอด TRcloud เก่า ' + old + ' วัน' : 'ยังไม่นำเข้ายอด TRcloud', sub: 'นำเข้าไฟล์ยอดคงเหลือ แล้วกระทบยอดราย SKU', go: 'trc', sec: 'imp', act: 'นำเข้า' });
      }
    }
    mine.filter(function (p) { return !p.sent; }).forEach(function (p) {
      out.push({ tone: 'info', title: 'ร่างค้าง · ' + p.t, sub: (p.files ? f(p.files) + ' ไฟล์ · ' : '') + f(p.rows) + (p.k === 'cut' ? ' บรรทัดออเดอร์' : ' แถว') + ' ยังไม่บันทึก', go: p.k, act: 'ทำต่อ' });
    });
    return out;
  }

  function renderHome() {
    var h = FIRE.home();
    $('act').innerHTML = '';
    $('docs').innerHTML = '';
    if (!h) {
      $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">วันนี้</span></div>';
      $('sum').innerHTML = '';
      $('body').innerHTML = '<div class="tx-empty">กำลังเปิดสมุด…</div>';
      return;
    }
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">วันนี้</span><span>' + esc(thDate(h.day)) + '</span>' +
      '<span class="ba-hi">สวัสดี ' + esc(USER.who) + '</span><span class="sp"></span>' +
      (HX_BUSY ? '<span>⏳</span>' : '<button type="button" class="tx-opt" id="baRefresh" title="เช็คงานค้างใหม่">🔄</button>') + '</div>';
    $('sum').innerHTML = '<span class="bk-chip' + (h.total ? '' : ' zero') + '">บันทึกวันนี้ <b>' + f(h.total) + '</b> ใบ</span>' +
      '<span class="bk-chip' + (h.mine ? '' : ' zero') + '">ของฉัน <b>' + f(h.mine) + '</b></span>' +
      (h.wait.n ? '<span class="bk-chip c-warn">รอลง TRcloud <b>' + f(h.wait.n) + '</b></span>' : '');

    var cs = cards(h);
    var cardHtml = cs.length ? cs.map(function (c) {
      return '<button type="button" class="ba-card t-' + c.tone + '" data-go="' + c.go + '"' + (c.sec ? ' data-sec="' + c.sec + '"' : '') + '>' +
        (c.n ? '<span class="ba-cn">' + f(c.n) + '</span>' : '<span class="ba-cn ba-ci">!</span>') +
        '<span class="ba-ct"><b>' + esc(c.title) + '</b><span>' + esc(c.sub) + '</span></span><span class="ba-cgo">' + esc(c.act) + ' ›</span></button>';
    }).join('') : '<div class="ba-clear"><b>✓ ไม่มีงานค้าง</b><span>ชุดที่บันทึกถึงฐานครบ' + (viewer() ? '' : ' · เลข TRcloud ครบ') + '</span></div>';

    /* เลขบนการ์ด = ลำดับงานของวัน (ไม่ใช้ลูกศร จอแคบขึ้นบรรทัดใหม่แล้วลูกศรค้างท้ายแถว) */
    var step = 0;
    function tile(k, label, sub, cls) {
      step++;
      return '<button type="button" class="ba-tile' + (cls || '') + '" data-mode="' + k + '"><span class="ba-tn">' + step + '</span>' + ic(k, 'ba-ti') +
        '<b>' + esc(label) + '</b><span>' + sub + '</span></button>';
    }
    var flow = FLOW.map(function (k) {
      var t = h.types[TYPE_OF[k]];
      return tile(k, title(k), t && (t.n || t.void) ? 'วันนี้ ' + f(t.n) + ' ใบ · ' + f(t.qty) + ' ชิ้น' + (t.void ? ' <i>ยกเลิก ' + f(t.void) + '</i>' : '') : 'วันนี้ยังไม่มี');
    }).join('') +
      tile('trc', 'ใส่เลข TRcloud', h.wait.n ? 'รอลง ' + f(h.wait.n) + ' ใบ' : 'ครบแล้ว', h.wait.n ? ' t-warn' : '') +
      (head() ? tile('close', 'ปิดวัน', closeDue() ? 'มี ' + f(closeDue()) + ' งาน' : 'ตรวจยอด · ชีตเดิม') : '');

    var last = h.last.length ? table([['เลขที่'], ['เวลา'], ['ประเภท'], ['ผู้ลง'], ['แถว', 'num'], ['ชิ้น', 'num'], ['สถานะ']], h.last.map(function (x) {
      return '<tr' + (x.voided ? ' class="r-void"' : '') + '><td class="c-act">' + docBtn(x.no) + '</td><td class="c-sub">' + esc(hm(x.stamp)) + '</td><td>' + esc(x.type) + '</td>' +
        '<td>' + esc(x.name) + '</td><td class="num">' + f(x.rows) + '</td><td class="num">' + f(x.qty) + '</td><td class="c-act">' + stChips(x) + '</td></tr>';
    })) : '<div class="ba-none">วันนี้ยังไม่มีเอกสาร</div>';

    $('body').innerHTML = '<div class="ba-home">' +
      '<section class="ba-sec"><h3>งานค้าง</h3><div class="ba-cards">' + cardHtml + '</div></section>' +
      '<section class="ba-sec"><h3>งานประจำวัน <span>กดเพื่อเริ่ม</span></h3><div class="ba-flow">' + flow + '</div></section>' +
      '<section class="ba-sec"><h3>บันทึกล่าสุดวันนี้ <button type="button" class="bk-link" data-mode="docs">ดูเอกสารทั้งหมด ›</button></h3>' + last + '</section>' +
      '</div>';
  }

  /* ── 🔎 เอกสาร: รายการ ───────────────────────────────────────────────── */

  function renderDocsPage() {
    if (DOC) { renderDoc(); return; }
    var copy = FIRE.copy();
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">เอกสาร</span>' +
      '<input class="bk-field ba-q" id="baQ" type="search" autocomplete="off" aria-label="ค้นหาเอกสาร" placeholder="ค้นหา เลขที่ · SKU · โล · LOT · PO · ออเดอร์ · เลขพัสดุ · เลข TRcloud · ชื่อ" value="' + esc(Q.text) + '">' +
      RANGES.map(function (r) { return '<button type="button" class="bk-chip' + (Q.range === r[0] ? ' on' : '') + '" data-qr="' + r[0] + '">' + r[1] + '</button>'; }).join('') +
      '<button type="button" class="g-tip" aria-label="คำอธิบาย" title="' + esc('ค้นได้หลายคำพร้อมกัน เว้นวรรค เช่น SKU กับโล\nช่วงวันดูวันที่ของเอกสาร\nค้นจากสำเนาในเครื่องนี้ ไม่กินโควตา\nกดเลขที่ = ดูทีละใบ ใส่เลข TRcloud ยกเลิก คัดลอก พิมพ์') + '">ⓘ</button>' +
      '<span class="sp"></span>' + (copy ? '<span class="c-sub">ในเครื่อง ' + f(copy.docs) + ' ใบ</span>' : '') + '</div>';
    $('act').innerHTML = '';
    $('docs').innerHTML = '';
    renderDocList();
  }

  function renderDocList() {
    var r = FIRE.docs({ text: Q.text, type: Q.type, status: Q.status, range: Q.range });
    if (!r) { $('sum').innerHTML = ''; $('body').innerHTML = '<div class="tx-empty">กำลังเปิดสมุด…</div>'; return; }
    var all = Object.keys(r.types).reduce(function (a, k) { return a + r.types[k]; }, 0);
    var typeChips = '<button type="button" class="bk-chip' + (!Q.type ? ' on' : '') + '" data-qt="">ทุกประเภท <b>' + f(all) + '</b></button>' +
      TYPES.filter(function (t) { return r.types[t] || Q.type === t; }).map(function (t) {
        return '<button type="button" class="bk-chip' + (Q.type === t ? ' on' : '') + '" data-qt="' + esc(t) + '">' + esc(t) + ' <b>' + f(r.types[t] || 0) + '</b></button>';
      }).join('');
    var st = [['check', 'รอตรวจ', 'c-warn'], ['approve', 'รออนุมัติ', 'c-warn'], ['wait', 'รอลง TRcloud', 'c-warn'], ['void', 'ยกเลิกแล้ว', 'c-red'], ['mine', 'ของฉัน', '']];
    var stChipsHtml = st.map(function (s) {
      var n = r.states[s[0]] || 0;
      return '<button type="button" class="bk-chip ' + s[2] + (Q.status === s[0] ? ' on' : '') + (n || Q.status === s[0] ? '' : ' zero') + '" data-qs="' + s[0] + '">' + s[1] + ' <b>' + f(n) + '</b></button>';
    }).join('');
    $('sum').innerHTML = typeChips + '<span class="bk-sep"></span>' + stChipsHtml;
    /* ตัวกรอง รอตรวจ / รออนุมัติ: ติ๊กหลายใบแล้วกดทีเดียว (เฉพาะใบที่เรากดได้) */
    var u = me(), pick = Q.status === 'check' || Q.status === 'approve';
    var mayOk = function (x) {
      if (x.ok !== Q.status || viewer()) return false;
      return Q.status === 'check' ? x.by !== u.email : head();
    };
    var can = pick ? r.list.filter(mayOk) : [];
    Object.keys(SEL).forEach(function (no) { if (!can.some(function (x) { return x.no === no; })) delete SEL[no]; });
    renderOkBar(can, r);
    if (!r.total) {
      $('body').innerHTML = '<div class="tx-empty">' + (pick && !Q.text ? (Q.status === 'check' ? '✓ ไม่มีใบรอตรวจ' : '✓ ไม่มีใบรออนุมัติ') + (Q.range !== 'all' ? ' ในช่วงนี้ ลองเลือก ทั้งหมด' : '')
        : r.all ? 'ไม่มีเอกสารตรงกับตัวกรอง' : Q.text ? 'ไม่พบ <b>' + esc(Q.text) + '</b> ในช่วงนี้ ลองเลือก ทั้งหมด' : 'ช่วงนี้ยังไม่มีเอกสาร') + '</div>';
      return;
    }
    var rows = r.list.map(function (x) {
      var at = String(x.stamp || '').slice(0, 10) === x.date ? hm(x.stamp) : when(x.stamp);   // บันทึกวันเดียวกับวันที่เอกสาร = เวลาอย่างเดียว
      var box = !can.length ? '' : '<td class="c-act">' + (mayOk(x)
        ? '<input type="checkbox" class="ba-ck" data-sel="' + esc(x.no) + '"' + (SEL[x.no] ? ' checked' : '') + ' aria-label="เลือก ' + esc(x.no) + '">'
        : '<span class="c-sub" title="' + (x.by === u.email ? 'ใบของคุณ ให้คนอื่นตรวจ' : '') + '">—</span>') + '</td>';
      return '<tr' + (x.voided ? ' class="r-void"' : SEL[x.no] ? ' class="r-sel"' : '') + '>' + box + '<td class="c-act">' + docBtn(x.no) + '</td><td>' + esc(dmy(x.date)) + '</td><td class="c-sub">' + esc(at) + '</td>' +
        '<td>' + esc(x.type) + '</td><td>' + esc(x.name) + '</td><td class="num">' + f(x.rows) + '</td><td class="num">' + f(x.qty) + '</td>' +
        '<td class="num">' + (x.orders ? f(x.orders) : '') + '</td><td class="c-act">' + stChips(x) + '</td></tr>';
    });
    var cols = [['เลขที่'], ['วันที่'], ['บันทึกเมื่อ'], ['ประเภท'], ['ผู้ลง'], ['แถว', 'num'], ['ชิ้น', 'num'], ['ออเดอร์', 'num'], ['สถานะ']];
    if (can.length) cols.unshift(['', 'c-act']);
    $('body').innerHTML = table(cols, rows,
      r.total > r.list.length ? '<div class="bk-more">แสดง ' + f(r.list.length) + ' จาก ' + f(r.total) + ' ใบ · พิมพ์ค้นให้แคบลง</div>' : '');
  }

  /** แถบตรวจ / อนุมัติหลายใบ (หน้าเอกสาร ตัวกรอง รอตรวจ / รออนุมัติ) */
  function renderOkBar(can, r) {
    var n = Object.keys(SEL).length, out = '';
    if (Q.status === 'check' || Q.status === 'approve') {
      if (can.length) {
        var all = n === can.length;
        out += '<button type="button" class="tx-opt" id="baSelAll">' + (all ? 'ไม่เลือก' : 'เลือกทั้งหมด ' + f(can.length) + ' ใบ') + '</button>';
        if (Q.status === 'check') {
          out += '<button type="button" class="bk-save" data-ok="check"' + (n && !BUSY ? '' : ' disabled') + '>' + (BUSY ? esc(BUSY) : '✓ ตรวจแล้ว ' + f(n) + ' ใบ') + '</button>';
          if (head()) out += '<button type="button" class="bk-btn" data-ok="both"' + (n && !BUSY ? '' : ' disabled') + ' title="หัวหน้าตรวจและอนุมัติในครั้งเดียว">✓ ตรวจ + อนุมัติ</button>';
        } else {
          out += '<button type="button" class="bk-save" data-ok="approve"' + (n && !BUSY ? '' : ' disabled') + '>' + (BUSY ? esc(BUSY) : '✓ อนุมัติ ' + f(n) + ' ใบ') + '</button>';
        }
        out += '<span class="c-sub">' + (Q.status === 'check' ? 'ติ๊กใบที่เช็คของจริงแล้ว · ใบที่ตัวเองทำ ให้คนอื่นตรวจ' : 'ติ๊กใบที่ตรวจแล้วและยอดถูก') + '</span>';
      } else if (r.total) {
        out += '<span class="c-sub">' + (viewer() ? 'บัญชีนี้ดูได้อย่างเดียว' : Q.status === 'check' ? 'ใบที่เหลือเป็นของคุณ ให้คนอื่นตรวจ' : 'รอหัวหน้าอนุมัติ') + '</span>';
      }
    }
    if (NOTE) out += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = out ? '<div class="ba-okbar">' + out + '</div>' : '';
  }

  /** ตรวจ / อนุมัติ nos ทีเดียว (ส่งทีละ 10 ใบต่อกัน) */
  async function okRun(nos, act) {
    if (!nos.length || BUSY) return;
    var word = act === 'check' ? 'ตรวจ' : act === 'approve' ? 'อนุมัติ' : 'ตรวจและอนุมัติ';
    if (nos.length > 1 && !confirm(word + ' ' + nos.length + ' ใบ ในชื่อ ' + (USER.who || '') + '?')) return;
    BUSY = 'กำลัง' + word + '…'; NOTE = null; render();
    var r;
    try { r = await FIRE.okSave(nos, act); } catch (e) { r = { saved: 0, error: e.message }; }
    BUSY = '';
    SEL = {};
    NOTE = r.error
      ? { kind: 'bad', html: (r.saved ? word + 'แล้ว ' + f(r.saved) + ' ใบ · ' : '') + 'ที่เหลือทำไม่ได้: ' + esc(r.error) }
      : { kind: 'ok', html: '✓ ' + word + 'แล้ว ' + f(r.saved) + ' ใบ' + (nos.length === 1 ? ' (' + esc(nos[0]) + ')' : '') };
    render();
  }

  /* ── 🖨 พิมพ์ใบ ─────────────────────────────────────────────────────── */

  /** ใบย้าย / แปลง = ใบพิมพ์ A5 แบบเอกสารคลังสินค้า (iframe ซ่อน) · ใบอื่น = พิมพ์หน้าจอนี้ */
  function printDoc(no) {
    var P = window.WmsFirePrint, v = FIRE.doc(no);
    if (!v || !P || !P.can(v)) { window.print(); return; }
    var logo = '';
    try { logo = window.WmsSettings && WmsSettings.logo ? WmsSettings.logo() || '' : ''; } catch (e) {}
    var html = P.html(v, { logo: logo, printed: when(C().stamp(Date.now())) });
    var fr = $('baFrame');
    if (fr) fr.remove();
    fr = document.createElement('iframe');
    fr.id = 'baFrame';
    fr.title = 'ใบพิมพ์ ' + v.no;
    fr.setAttribute('aria-hidden', 'true');
    fr.tabIndex = -1;
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    fr.onload = function () {
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.print(); }
    };
    document.body.appendChild(fr);
    fr.srcdoc = html;
  }

  /* ── 🔎 เอกสาร: ดูทีละใบ ─────────────────────────────────────────────── */

  function stepHtml(s) {
    var mark = s.state === 'done' ? '✓' : s.state === 'void' ? '✕' : s.state === 'skip' ? '–' : '●';
    var sub = [];
    if (s.tr) sub.push('เลข ' + esc(s.tr));
    if (s.at) sub.push(esc(when(s.at)));
    if (s.who) sub.push(esc(who(s.who, CUR)));
    if (s.why) sub.push(esc(s.why));
    if (s.hint) sub.push(esc(s.hint));
    if (s.link) sub.push('ลงกลับเป็น ' + docBtn(s.link));
    return '<li class="ba-step s-' + s.state + '"><span class="ba-sm">' + mark + '</span><span><b>' + esc(s.label) + '</b><span>' + sub.join(' · ') + '</span></span></li>';
  }

  var CUR = null;   // ใบที่กำลังวาด (ชื่อคนในขั้นตอน)
  function renderDoc() {
    var v = CUR = FIRE.doc(DOC);
    $('docs').innerHTML = '';
    if (!v) {
      $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="baBack">‹ กลับไปรายการ</button><span class="bk-h">' + esc(DOC) + '</span></div>';
      $('sum').innerHTML = ''; $('act').innerHTML = '';
      $('body').innerHTML = '<div class="tx-empty">' + (FIRE.home() ? 'ไม่พบเลขที่ <b>' + esc(DOC) + '</b> ในสำเนาเครื่องนี้<br>เอกสารใหม่จากเครื่องอื่น กด 🔄 ดึงสต๊อกใหม่ ที่แถบบน' : 'กำลังเปิดสมุด…') + '</div>';
      return;
    }
    $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="baBack">‹ กลับไปรายการ</button>' +
      '<span class="bk-h">' + esc(v.no) + '</span><span class="ba-ty">' + esc(v.type) + '</span>' +
      '<span>วันที่ ' + esc(dmy(v.date)) + ' · ' + esc(v.name) + ' · บันทึก ' + esc(when(v.stamp)) + '</span><span class="sp"></span>' +
      '<button type="button" class="tx-opt" id="baPrint" title="' + (window.WmsFirePrint && WmsFirePrint.can(v) ? 'พิมพ์ใบ' + (v.type === 'แปลง' ? 'ขอแปลงรหัสสินค้า' : 'โอนย้ายสินค้า') + ' A5' : 'พิมพ์หน้านี้') + '">🖨 พิมพ์ใบ</button></div>';
    $('sum').innerHTML = stChips({ voided: v.voided, link: v.rev ? (v.orig && v.orig.no) : '', type: v.type, state: v.state, tr: v.tr, ok: v.ok, ck: v.ck, ap: v.ap }) +
      '<span class="bk-chip">แถว <b>' + f(v.rows.length) + '</b></span><span class="bk-chip">ชิ้น <b>' + f(v.qty) + '</b></span>' +
      (v.orders ? '<span class="bk-chip">ออเดอร์ <b>' + f(v.orders) + '</b></span>' : '');

    var act = '<button type="button" class="tx-opt" id="baCopy">📋 คัดลอกแถว</button>';
    var oc = window.WmsFireDocs ? WmsFireDocs.okCan(v, me()) : {};
    if (oc.check || oc.approve) {
      act += '<span class="bk-sep"></span>' + (oc.check ? '<button type="button" class="bk-save" data-ok1="check"' + (BUSY ? ' disabled' : '') + '>✓ ตรวจแล้ว</button>' : '') +
        (oc.both ? '<button type="button" class="bk-btn" data-ok1="both"' + (BUSY ? ' disabled' : '') + ' title="หัวหน้าตรวจและอนุมัติในครั้งเดียว">✓ ตรวจ + อนุมัติ</button>' : '') +
        (oc.approve ? '<button type="button" class="bk-save" data-ok1="approve"' + (BUSY ? ' disabled' : '') + '>✓ อนุมัติ</button>' : '');
    } else if (oc.why && v.ok && v.ok !== 'done') act += '<span class="bk-sep"></span><span class="c-sub">' + esc(oc.why) + '</span>';
    if (v.state === 'wait' && !viewer()) {
      act += '<span class="bk-sep"></span><input class="bk-field ba-tr" id="baTr" placeholder="เลข TRcloud" aria-label="เลข TRcloud" maxlength="100" autocomplete="off">' +
        '<button type="button" class="bk-save" id="baTrSave" ' + (BUSY ? 'disabled' : '') + '>' + (BUSY ? esc(BUSY) : 'บันทึกเลข') + '</button>' +
        '<button type="button" class="bk-link" id="baTrNone">ไม่ต้องลง</button>' +
        (v.kind === 'file' ? '<button type="button" class="bk-link" data-go="trc" data-sec="wait">ออกไฟล์ปรับยอดที่หน้า TRcloud ›</button>' : '');
    }
    if (v.canVoid && head()) act += '<span class="sp"></span><button type="button" class="bk-btn x" data-void="' + esc(v.no) + '">↩ ยกเลิกเอกสารนี้</button>';
    if (NOTE) act += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = act;

    var rel = '';
    if (v.rev && v.orig) rel = '<div class="ba-rel">↩ ใบนี้ลงกลับรายการของ ' + (v.orig.gone ? '<b>' + esc(v.orig.no) + '</b> (ไม่มีในเครื่องนี้)' : docBtn(v.orig.no) + ' ' + esc(v.orig.type) + ' วันที่ ' + esc(dmy(v.orig.date)) + ' · ' + esc(v.orig.name)) +
      (v.why ? ' · เหตุผล: ' + esc(v.why) : '') + '</div>';
    if (v.back) rel = '<div class="ba-rel bad">ใบนี้ถูกยกเลิกแล้ว · ลงกลับเป็น ' + docBtn(v.back.no) + ' เมื่อ ' + esc(when(v.back.stamp)) + ' โดย ' + esc(v.back.name) +
      (v.voided && v.voided.why ? ' · เหตุผล: ' + esc(v.voided.why) : '') + '</div>';

    var rowsHtml = table([['#', 'num'], ['SKU'], ['SKU เต็ม'], ['ชื่อสินค้า'], ['LOT'], ['PO'], ['โลเบิก'], ['โลรับ'], ['ชิ้น', 'num'], ['ประเภท'], ['Note'], ['Status'], ['เลข TRcloud']],
      v.rows.slice(0, ROWS_MAX).map(function (r, i) {
        var nm = v.names[r[1]] || v.names[r[0]] || '';
        return '<tr><td class="num c-no">' + (i + 1) + '</td><td class="c-sku">' + esc(r[0]) + '</td><td class="c-sub">' + esc(r[1]) + '</td><td class="c-nm" title="' + esc(nm) + '">' + esc(nm) + '</td>' +
          '<td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + esc(r[4]) + '</td><td>' + esc(r[5]) + '</td><td class="num">' + f(+r[6] || 0) + '</td>' +
          '<td>' + esc(r[7]) + '</td><td class="c-sub">' + esc(r[8]) + '</td><td class="c-sub">' + esc(r[9]) + '</td><td class="c-sub">' + esc(r[10] || '') + '</td></tr>';
      }), v.rows.length > ROWS_MAX ? '<div class="bk-more">แสดง ' + f(ROWS_MAX) + ' จาก ' + f(v.rows.length) + ' แถว · กดคัดลอกแถวได้ครบ</div>' : '');
    var linesHtml = v.lines.length ? '<h3 class="ba-h3">ออเดอร์ ' + f(v.lines.length) + ' บรรทัด</h3>' +
      table([['ระบบ'], ['ออเดอร์'], ['เลขอ้างอิง'], ['เลขพัสดุ'], ['SKU'], ['ชิ้น', 'num']], v.lines.slice(0, ROWS_MAX).map(function (l) {
        return '<tr><td class="c-sub">' + esc(l.sys) + '</td><td class="c-sku">' + esc(l.order) + '</td><td>' + esc(l.ref) + '</td><td>' + esc(l.track) + '</td><td>' + esc(l.sku) + '</td><td class="num">' + f(+l.qty || 0) + '</td></tr>';
      }), v.lines.length > ROWS_MAX ? '<div class="bk-more">แสดง ' + f(ROWS_MAX) + ' จาก ' + f(v.lines.length) + ' บรรทัด</div>' : '') : '';
    var hist = '<ol class="ba-hist">' + v.history.map(function (x) {
      return '<li><span class="c-sub">' + esc(when(x.at) || '—') + '</span><b>' + esc(who(x.who, v)) + '</b><span>' + esc(x.what) +
        (x.link ? ' · ' + esc(x.linkTh || '') + ' ' + docBtn(x.link) : '') + '</span></li>';
    }).join('') + '</ol>';

    $('body').innerHTML = '<div class="ba-doc">' + rel +
      '<div class="ba-dtop"><ol class="ba-steps">' + v.steps.map(stepHtml).join('') + '</ol>' +
      '<div class="ba-hbox"><h3 class="ba-h3">ประวัติ</h3>' + hist + '</div></div>' +
      (v.ref && !v.rev ? '<div class="ba-ref c-sub">อ้างอิง: ' + esc(v.ref) + '</div>' : '') +
      '<h3 class="ba-h3">แถวในสมุด</h3>' + rowsHtml + linesHtml + '</div>';
  }

  function openDoc(no) {
    no = String(no || '').toUpperCase();
    NOTE = null;
    DOC = no;
    var h = no ? '#doc=' + no : '';
    if (location.hash !== h) {
      try { history.pushState(null, '', h || location.pathname + location.search); } catch (e) { location.hash = h; }
    }
    if (MODE !== 'docs') setMode('docs'); else render();
    window.scrollTo(0, 0);
  }

  async function saveTr(state) {
    var v = FIRE.doc(DOC);
    if (!v || BUSY) return;
    var tr = state === 'done' ? ($('baTr') ? $('baTr').value.trim() : '') : '';
    if (state === 'done' && !tr) { NOTE = { kind: 'bad', html: 'ใส่เลข TRcloud ก่อน หรือกด ไม่ต้องลง' }; render(); return; }
    BUSY = 'กำลังบันทึก…'; render();
    var r;
    try { r = await FIRE.trSave([{ no: v.no, tr: tr, state: state }]); } catch (e) { r = { error: e.message }; }
    BUSY = '';
    NOTE = r.error ? { kind: 'bad', html: 'บันทึกไม่ได้: ' + esc(r.error) } : { kind: 'ok', html: state === 'done' ? '✓ บันทึกเลข TRcloud <b>' + esc(tr) + '</b> แล้ว' : '✓ ตั้งว่าไม่ต้องลง TRcloud แล้ว' };
    if (!r.error && window.BookFireTrc && BookFireTrc.stale) BookFireTrc.stale();
    render();
  }

  async function copyRows() {
    var v = FIRE.doc(DOC);
    if (!v) return;
    var head = ['SKU', 'SKU เต็ม', 'LOT', 'PO', 'โลเบิก', 'โลรับ', 'ชิ้น', 'ประเภท', 'Note', 'Status', 'เลข TRcloud'].join('\t');
    var ok = await copyText([head].concat(v.rows.map(function (r) { return r.slice(0, 11).map(function (c) { return c === undefined || c === null ? '' : c; }).join('\t'); })).join('\n'));
    NOTE = ok ? { kind: 'ok', html: '✓ คัดลอก ' + f(v.rows.length) + ' แถวแล้ว วางใน Excel ได้เลย' } : { kind: 'bad', html: 'คัดลอกไม่ได้ เบราว์เซอร์ไม่อนุญาต' };
    render();
  }

  /* ── ปุ่มและช่อง (ทำงานเฉพาะแอประบบใหม่ที่เข้าแล้ว) ── */

  function active() { return ON && USER; }

  document.addEventListener('click', function (e) {
    if (!active()) return;
    var t = e.target.closest && e.target.closest('button, a');
    if (!t) { if (NAV_OPEN && !e.target.closest('.bk-nav')) { NAV_OPEN = false; renderNav(); } return; }
    if (t.id === 'bnBurger') { NAV_OPEN = !NAV_OPEN; renderNav(); return; }
    if (t.dataset.mode && NAV_OPEN) { NAV_OPEN = false; renderNav(); }   // เลือกเมนูแล้วพับ (หน้าเปลี่ยนตาม data-mode ของหน้า)
    if (t.dataset.mode === 'docs' && MODE === 'docs' && DOC) { openDoc(''); return; }
    if (t.dataset.doc) { e.preventDefault(); openDoc(t.dataset.doc); return; }
    if (t.dataset.go === 'docs') {
      /* การ์ด รอตรวจ / รออนุมัติ: เปิดรายการตัวกรองนั้น ทุกช่วงวัน */
      Q.status = t.dataset.sec || ''; Q.type = ''; Q.text = ''; if (Q.status) Q.range = 'all';
      saveQ(); SEL = {}; NOTE = null;
      if (DOC) openDoc(''); else if (MODE === 'docs') render(); else setMode('docs');
      return;
    }
    if (t.dataset.go) {
      var sec = t.dataset.sec || '';
      if (sec && (t.dataset.go === 'set' || t.dataset.go === 'close') && window.BookFireSet && BookFireSet.pick) BookFireSet.pick(t.dataset.go, sec);
      if (sec && t.dataset.go === 'trc' && window.BookFireTrc && BookFireTrc.pick) BookFireTrc.pick(sec);
      if (MODE === t.dataset.go) render(); else setMode(t.dataset.go);
      return;
    }
    if (t.id === 'baRefresh') { loadHx(true); render(); return; }
    if (t.id === 'baBack') { openDoc(''); return; }
    if (t.id === 'baPrint') { printDoc(DOC); return; }
    if (t.dataset.print) { printDoc(t.dataset.print); return; }
    if (t.dataset.ok) { okRun(Object.keys(SEL), t.dataset.ok); return; }
    if (t.dataset.ok1) { if (DOC) okRun([DOC], t.dataset.ok1); return; }
    if (t.id === 'baSelAll') {
      var boxes = Array.prototype.slice.call(document.querySelectorAll('.ba-ck'));
      var on = boxes.some(function (b) { return !b.checked; });
      SEL = {};
      if (on) boxes.forEach(function (b) { SEL[b.dataset.sel] = 1; });
      renderDocList();
      return;
    }
    if (t.id === 'baCopy') { copyRows(); return; }
    if (t.id === 'baTrSave') { saveTr('done'); return; }
    if (t.id === 'baTrNone') { if (confirm('ตั้งว่า ' + DOC + ' ไม่ต้องลง TRcloud?')) saveTr('none'); return; }
    if (t.dataset.qr) { Q.range = t.dataset.qr; saveQ(); renderDocsPage(); return; }
    if (t.dataset.qt !== undefined) { Q.type = t.dataset.qt; saveQ(); renderDocList(); return; }
    if (t.dataset.qs) { Q.status = Q.status === t.dataset.qs ? '' : t.dataset.qs; SEL = {}; NOTE = null; saveQ(); renderDocList(); return; }
  });

  document.addEventListener('change', function (e) {
    if (!active() || !e.target.classList || !e.target.classList.contains('ba-ck')) return;
    if (e.target.checked) SEL[e.target.dataset.sel] = 1; else delete SEL[e.target.dataset.sel];
    renderDocList();
  });

  document.addEventListener('input', function (e) {
    if (!active() || e.target.id !== 'baQ') return;
    Q.text = e.target.value;
    clearTimeout(TYPING);
    TYPING = setTimeout(renderDocList, 160);
  });

  document.addEventListener('keydown', function (e) {
    if (!active()) return;
    if (e.key === 'Escape' && NAV_OPEN) { NAV_OPEN = false; renderNav(); }
    if (e.key === 'Enter' && e.target.id === 'baTr') { e.preventDefault(); saveTr('done'); }
    if (e.key === 'Enter' && e.target.id === 'baQ') {
      /* ค้นด้วยเลขที่ตรงตัว = เปิดใบนั้นเลย */
      var v = String(e.target.value || '').trim().toUpperCase();
      if (/^T\d{4}-\d{4}$/.test(v) && FIRE.doc(v)) openDoc(v);
    }
  });

  window.addEventListener('popstate', function () {
    if (!ON) return;
    var no = docFromHash();
    if (no === DOC) return;
    DOC = no; NOTE = null;
    if (no && MODE !== 'docs') setMode('docs'); else if (window.render) window.render();
  });

  window.BookApp = {
    on: ON,
    tabs: tabs,
    /** หน้าแรกตอนเปิดแอป: ลิงก์ #doc= = หน้าเอกสาร · ไม่งั้น วันนี้ */
    start: function () { return DOC ? 'docs' : 'home'; },
    nav: renderNav,
    render: function (mode) {
      if (mode === 'home') renderHome();
      else if (mode === 'docs') renderDocsPage();
    },
    opened: function (mode) {
      if (mode === 'home') loadHx(false);
      if (mode !== 'docs' && DOC) { DOC = ''; NOTE = null; }
    },
    /** ประเภทเอกสารของแท็บงาน (ตารางชุดที่บันทึกด้านล่างแสดงเฉพาะของแท็บนั้น) */
    typeOf: function (mode) { return TYPE_OF[mode] || ''; },
    openDoc: openDoc,
    okChip: okChip,
    /** แท็บนี้มีใบพิมพ์ + ตรวจ / อนุมัติไหม (ย้าย / เติม / QA · แปลงสินค้า) */
    okMode: function (mode) { return !!(window.WmsFireCore && WmsFireCore.OK_TYPES.indexOf(TYPE_OF[mode] || '') >= 0); },
  };
})();
