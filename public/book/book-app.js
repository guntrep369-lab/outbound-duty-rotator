/**
 * book-app.js — แอปสมุดสต๊อกของทีม Inventory (ระบบใหม่เท่านั้น: จริง · ซ้อม · ทดลอง)
 *
 *   เมนูของแอปแทนเมนู WMS   แถบบน 8 หมวด · เมนูซ้ายเฉพาะหมวดนั้น (ไม่เกิน 8) · มีแค่หน้า WMS ที่อ่านระบบใหม่
 *                          มือถือ = แถบบน กด ☰ เปิดหมวดกับเมนู · ค้นหา Ctrl K และคีย์ลัดอยู่ book-keys.js
 *   🏠 วันนี้              ตารางงานของฉัน: ต้องทำ · รอคนอื่น · เสร็จวันนี้ ขั้นต่อไปปุ่มเดียวต่อแถว · ใบล่าสุดของวันนี้
 *   📦 สินค้า / โล         อยู่โลไหน คงเหลือ ลำดับตัด วันรับ Supplier ความจุพาเลท คู่แปลง สต๊อกการ์ด (book-item.js)
 *   🔎 เอกสาร             ค้นทุกใบในสำเนาเครื่องนี้ · กดเลขที่ = ดูทีละใบ: ขั้นตอน ประวัติ แถว ออเดอร์
 *                          ใส่เลข TRcloud · ยกเลิก (หัวหน้า) · ใบเดิม ↔ ใบกลับรายการ ลิงก์ถึงกัน · ลิงก์ #doc=เลขที่ ส่งต่อได้
 *   ✓ ตรวจ / อนุมัติ       ใบย้ายกับแปลง: ผู้จัดทำ → ผู้ตรวจสอบ (ไม่ใช่คนทำ) → ผู้อนุมัติ (หัวหน้า) ทีละใบหรือติ๊กหลายใบ
 *                          ใบโอน QA: ผู้จัดทำ → ผู้รับตามทีม (รับก่อนจึงใช้ของต่อได้ · ไม่รับมีเหตุผล) → ผู้อนุมัติ → TRcloud
 *   🖨 พิมพ์ใบ              ใบย้าย / แปลง พิมพ์เป็นใบโอน / ใบขอแปลง A5 แบบเอกสารคลังสินค้าเดิม (wms-fire-print.js) ใบอื่นพิมพ์หน้าจอ
 *   คิดจากสำเนาในเครื่อง ไม่อ่านฐานเพิ่ม ยกเว้นหัวหน้าเปิดหน้าวันนี้: xfer/log กับ arch/index อย่างละ 1 ครั้ง (เก็บไว้ 10 นาที)
 *
 * ระบบเดิม (Apps Script) ไม่ใช้ไฟล์นี้ หน้าเหมือนเดิมทุกอย่าง (แผนถอยกลับ)
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (FIRE USER MODE PENDING FILES MERGED SEEN BKBUSY esc f table isHead setMode render
 * voidDoc copyText) กับ BookGrid BookFireSet BookFireTrc ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า เปิดเป็น window.BookApp
 */
(function () {
  'use strict';

  var ON = !!window.BookFire;
  var Q_KEY = 'wms:book:app:q';
  var HX_MS = 600000;         // ข้อมูลหัวหน้าของหน้าวันนี้ (ชีตเดิม ปิดเดือน) เก็บไว้กี่ ms
  var TRC_OLD = 7;            // ยอด TRcloud เก่ากว่านี้ (วัน) เตือนหัวหน้า
  var ROWS_MAX = 500;         // แถวต่อตารางในหน้าดูทีละใบ

  /* ไอคอนเฉพาะปุ่มของแถบบน (เมนูเป็นตัวหนังสือล้วน) */
  var ICON = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    find: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  };
  function ic(k) {
    return '<svg class="bn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>';
  }

  /*
   * เมนู 8 หมวด (แบบ WMS Desktop ที่เลือก) · g = หมวด
   * k = หน้าของแอป · to = ทางลัดไปหน้าเดิมพร้อมตัวกรอง (id) · href = หน้า WMS อื่น นับจากรากเว็บ
   * head = เฉพาะหัวหน้า · src = หน้ารายงานที่อ่านระบบใหม่ได้ · sim = อ่านอย่างเดียว เปิดตอนซ้อมได้ไม่ต้องเตือน
   *
   * เหลือเฉพาะหน้าที่ใช้ข้อมูลระบบใหม่ (ผู้ใช้ขอ 2026-11-23: หน้าที่ยังไม่เกี่ยวกับระบบใหม่ทำให้สับสนว่าต้องกดอะไร)
   * หน้า WMS อื่นต้องมี src (โหลด wms-fire-src.js) · หน้าเดิมที่เอาออก (สมุดกะ สต๊อกคงเหลือ เอกสารคลัง ขาออกของ Outbound
   * ขนส่ง นับสต๊อกใหญ่ จับคู่ Invoice ตารางกะ ตั้งค่าระบบ หน้า WMS เดิม) ยังอยู่ในเมนู WMS เดิมเหมือนเดิม
   */
  var NAV = [
    { g: 'today', t: 'วันนี้' },
    { k: 'home', t: 'งานของฉัน' },
    { id: 'todo', to: 'docs', t: 'รอรับ / รออนุมัติ' },
    { g: 'in', t: 'ขาเข้า' },
    { k: 'gr', t: 'รับของ' },
    { href: 'putaway/', t: 'จัดที่เก็บ', src: 1 },
    { k: 'ret', t: 'คืนของ' },
    { g: 'qc', t: 'คุณภาพ' },
    { id: 'qamove', to: 'move', t: 'โอนเข้า / ออก QA' },
    { id: 'qastock', to: 'item', t: 'ของใน QA / IQA' },
    { href: 'mfg/', t: 'ความเสี่ยง MFG', src: 1 },
    { g: 'stock', t: 'ในคลัง' },
    { k: 'move', t: 'ย้าย / เติม' },
    { k: 'conv', t: 'แปลงสินค้า' },
    { k: 'item', t: 'สินค้า / โล' },
    { href: 'stock-location/', t: 'สต๊อกราย Location', src: 1 },
    { g: 'out', t: 'ขาออก' },
    { k: 'cut', t: 'ตัดขาย' },
    { g: 'ctrl', t: 'ควบคุม' },
    { k: 'adj', t: 'ปรับยอด', head: 1 },
    { href: 'cut-check/', t: 'เช็คตัดสต๊อก', src: 1 },
    { k: 'trc', t: 'TRcloud' },
    { k: 'docs', t: 'เอกสารทั้งหมด' },
    { k: 'close', t: 'ปิดวัน / เดือน', head: 1 },
    { k: 'rows', t: 'ตารางแบบเดิม', head: 1 },
    { g: 'report', t: 'รายงาน' },
    { href: 'dashboard/', t: 'ภาพรวมสต๊อก', src: 1, sim: 1 },
    { href: 'balance/', t: 'คงเหลือ ณ วันที่', src: 1, sim: 1 },
    { href: 'fifo/', t: 'FIFO สต๊อก', src: 1, sim: 1 },
    { href: 'lot-po/', t: 'LOT / PO ขายออก', src: 1, sim: 1 },
    { g: 'setup', t: 'ตั้งค่า' },
    { k: 'master', t: 'ข้อมูลหลัก' },
    { k: 'set', t: 'คนใช้และสิทธิ์' },
  ];
  var AREAS = [];
  NAV.forEach(function (n) {
    if (n.g) AREAS.push({ g: n.g, t: n.t, items: [] });
    else {
      var a = AREAS[AREAS.length - 1];
      n.area = a.g;
      n.id = n.id || n.k || 'x:' + n.href;
      a.items.push(n);
    }
  });
  var WEEK = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var TODO_ST = ['todo', 'recv', 'check', 'approve', 'reject'];   // ตัวกรองของเมนู รอรับ / รออนุมัติ
  var TYPE_OF = { cut: 'ตัดขาย', gr: 'รับของ', move: 'ย้าย', ret: 'คืน', conv: 'แปลง', adj: 'ปรับยอด', rows: 'ตารางเดิม' };
  var TYPES = ['ตัดขาย', 'รับของ', 'ย้าย', 'คืน', 'แปลง', 'ปรับยอด', 'ตารางเดิม', 'กลับรายการ', 'ยอดยกมา'];
  var RANGES = [['today', 'วันนี้'], ['d7', '7 วัน'], ['d30', '30 วัน'], ['month', 'เดือนนี้'], ['all', 'ทั้งหมด']];

  var NAV_OPEN = false;
  var VIEW = null;            // เมนูที่กดเข้ามา (หน้าเดียวอยู่ได้สองหมวด เช่น ย้าย กับ โอน QA)
  var AREA = '';              // หมวดที่เปิดอยู่ตอนหมวดนั้นมีแต่หน้า WMS อื่น (MODE = area)
  var HOME_F = 'todo';        // ตัวกรองหน้า งานของฉัน: todo | wait | done
  var AT = '';                // หน้าที่วาดล่าสุด เปลี่ยนหน้า = เลื่อนขึ้นบนสุด
  var NAV_HTML = '';
  var HX = null, HX_AT = 0, HX_BUSY = false, HX_FOR = '';   // { xfer: [วัน] | null, arch: สรุปปิดเดือน | null, audit: {audit} | {error} ผลตรวจแถว }
  var Q = (function () {
    var q = { text: '', type: '', status: '', range: 'd7' };
    try { var s = JSON.parse(localStorage.getItem(Q_KEY) || 'null'); if (s) { q.type = s.type || ''; q.status = s.status || ''; q.range = s.range || 'd7'; } } catch (e) {}
    return q;
  })();
  var DOC = docFromHash();    // เลขที่ที่เปิดดูอยู่ ('' = รายการ)
  var NOTE = null;            // { kind, html } ของหน้าเอกสาร
  var BUSY = '';
  var SEL = {};               // ใบที่ติ๊กไว้รับ / ตรวจ / อนุมัติ { เลขที่: 1 }
  var PICK_ST = ['recv', 'check', 'approve'];   // ตัวกรองที่ติ๊กหลายใบได้
  var BACK = '';              // เปิดใบมาจากหน้า สินค้า / โล: ‹ กลับ = กลับไปหน้านั้น
  var TYPING = null;

  function $(id) { return document.getElementById(id); }
  function head() { return isHead(); }
  function viewer() { return !USER || USER.role === 'ดูอย่างเดียว'; }
  /** บัญชีที่เข้าอยู่ { email, name, role: head | staff | viewer } (สิทธิ์แบบที่ระบบใหม่ใช้) */
  function me() { return (FIRE && FIRE.user && FIRE.user()) || { email: '', role: 'viewer' }; }
  function C() { return window.WmsFireCore; }
  function docFromHash() { var m = /^#doc=([A-Za-z0-9-]{1,20})$/.exec(location.hash || ''); return m ? m[1].toUpperCase() : ''; }
  function saveQ() { try { localStorage.setItem(Q_KEY, JSON.stringify({ type: Q.type, status: Q.status, range: Q.range })); } catch (e) {} }
  function p2(v) { return ('0' + v).slice(-2); }
  /** 2026-11-23 → 23/11/2026 · จันทร์ 23/11/2026 (week) */
  function ddmm(day, week) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!m) return '';
    var d = p2(m[3]) + '/' + p2(m[2]) + '/' + m[1];
    return week ? (WEEK[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] || '') + ' ' + d : d;
  }
  /** ค้างตั้งแต่: วันนี้ = เวลา · วันก่อน = วัน/เดือน */
  function since(stamp, day) {
    var s = String(stamp || ''), d = s.slice(0, 10);
    return d === day ? hm(s) : ddmm(d).slice(0, 5);
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
      if (!n.k || !TYPE_OF[n.k] || !allowed(n)) return;
      if (n.k === 'cut') {
        if (PENDING) out.push({ k: 'cut', t: n.t, sent: true, held: isHeld(PENDING), rows: PENDING.copy ? PENDING.copy.length : 0 });
        else if (FILES.length) {
          /* ไฟล์ที่ลงสมุดแล้วยังค้างบนแท็บให้ดูผล: นับเฉพาะบรรทัดที่ยังไม่ตัด */
          var left = MERGED.lines.filter(function (l) { return !SEEN[l.key]; }).length;
          if (left) out.push({ k: 'cut', t: n.t, sent: false, rows: left, files: FILES.length });
        }
      } else if (BookGrid.pending(n.k)) out.push({ k: n.k, t: n.t, sent: true, held: BookGrid.held(n.k), rows: 0 });
      else if (BookGrid.filled && BookGrid.filled(n.k)) out.push({ k: n.k, t: n.t, sent: false, rows: BookGrid.filled(n.k) });
    });
    return out;
  }
  /**
   * วันที่ยังไม่วางลงชีตเดิม · หน้ารายงานอ่านจากระบบใหม่แล้ว (wms-fire-src.js) การวางชีตเดิมไม่บังคับ
   * เตือนเฉพาะตอนยังวางกันอยู่ (มีวันที่กด ✓ วางแล้ว ใน 10 วันล่าสุด) ไม่เคยวาง = ไม่เตือน
   */
  function xferLeft() {
    if (!HX || !HX.xfer) return [];
    var day = FIRE.home() ? FIRE.home().day : '';
    var recent = HX.xfer.some(function (d) { return d.done && day && C().dayNo(day) - C().dayNo(d.day) <= 10; });
    if (!recent) return [];
    return HX.xfer.filter(function (d) { return (!d.done || d.more) && d.day < day; });
  }
  function archDue() { return HX && HX.arch && HX.arch.next && HX.arch.next.m ? HX.arch.next : null; }

  /** ข้อมูลหัวหน้าของหน้าวันนี้ (อ่านฐานอย่างละ 1 ครั้ง เก็บไว้ HX_MS) */
  async function loadHx(force) {
    if (!head() || HX_BUSY) return;
    if (!force && HX && HX_FOR === USER.email && Date.now() - HX_AT < HX_MS) return;
    HX_BUSY = true;
    var x = null, a = null, au = null;
    try { var r1 = await FIRE.xferDays(); if (!r1.error) x = r1.days; } catch (e) {}
    try { var r3 = await FIRE.auditInfo(); au = r3.error ? { error: r3.error } : { audit: r3.audit }; } catch (e) { au = { error: String(e && e.message || e) }; }
    try { var r2 = await FIRE.archInfo(); if (!r2.error) a = r2; } catch (e) {}
    HX = { xfer: x, arch: a, audit: au }; HX_AT = Date.now(); HX_FOR = USER.email; HX_BUSY = false;
    if (window.render) window.render();
  }

  /* ── เมนู ──────────────────────────────────────────────────────────── */

  function allowed(n) { return !!n && (!n.head || head()); }
  /** หน้าที่เปิดได้ (หน้า area = รายการเมนูของหมวดที่มีแต่หน้า WMS อื่น) */
  function tabs() {
    return NAV.filter(function (n) { return n.k && allowed(n); }).map(function (n) { return [n.k, n.t]; }).concat([['area', 'เมนู']]);
  }
  function byId(id) { return NAV.filter(function (n) { return n.id === id && allowed(n); })[0] || null; }
  function areaOf(g) { return AREAS.filter(function (a) { return a.g === g; })[0] || AREAS[0]; }

  /** เมนูที่ตรงกับหน้าที่เปิดอยู่ */
  function here() {
    if (MODE === 'area') return null;
    if (MODE === 'docs' && DOC && BACK) return byId(BACK === 'item' && VIEW && VIEW.to === 'item' ? VIEW.id : BACK);
    if (MODE === 'docs' && !DOC && Q.status === 'todo') return byId('todo');
    if (VIEW && allowed(VIEW) && (VIEW.k || VIEW.to) === MODE && (VIEW.id !== 'todo' || TODO_ST.indexOf(Q.status) >= 0)) return VIEW;
    return byId(MODE);
  }

  /** หน้า WMS อื่น · โหมดซ้อม / ทดลอง / สวิตช์ปิด เปิดแท็บใหม่ แอปจะได้ไม่หลุดโหมด */
  function away() { return FIRE.mode !== 'live' || !!FIRE.override; }
  function hrefOf(n) { return '../' + n.href + (n.src && away() ? '?fire=' + FIRE.mode : ''); }
  function simWarn(n) { return FIRE.mode !== 'live' && n.href && !n.sim; }
  var SIM_ASK = 'หน้านี้ไม่มีโหมดซ้อมครบ สิ่งที่บันทึกในหน้านี้อาจลงระบบจริง';
  function linkHtml(n, cls, cur) {
    if (n.href === undefined) {
      return '<button type="button" class="' + cls + '" data-nav="' + esc(n.id) + '"' + (cur ? ' aria-current="page"' : '') + '>' + esc(n.t) + '</button>';
    }
    return '<a class="' + cls + '" data-nav="' + esc(n.id) + '" href="' + esc(hrefOf(n)) + '"' + (away() ? ' target="_blank" rel="noopener"' : '') +
      (simWarn(n) ? ' title="' + esc(SIM_ASK) + '"' : '') + '>' + esc(n.t) + '</a>';
  }

  function go(mode) { if (MODE === mode) render(); else setMode(mode); }

  /** เปิดเมนู (ปุ่มในเมนู · ค้นหา Ctrl K) */
  function openNav(id) {
    var n = byId(id);
    if (!n) return;
    NAV_OPEN = false;
    if (n.href !== undefined) {
      if (simWarn(n) && !confirm(SIM_ASK + '\nเปิดไหม?')) return;
      if (away()) window.open(hrefOf(n), '_blank', 'noopener'); else location.href = hrefOf(n);
      return;
    }
    var mode = n.k || n.to;
    VIEW = n;
    if (mode === 'docs') {
      if (n.id === 'todo') { Q.status = 'todo'; Q.type = ''; Q.text = ''; Q.range = 'all'; }
      else if (Q.status === 'todo') Q.status = '';
      saveQ(); SEL = {}; NOTE = null; BACK = '';
      if (DOC) openDoc(''); else go('docs');
    } else if (mode === 'item' && window.BookItem) {
      BookItem.view({ chip: n.id === 'qastock' ? 'qa' : '' });
    } else {
      if (mode === 'set' && MODE !== 'set' && window.BookFireSet) BookFireSet.pick('set', 'users');
      go(mode);
    }
    toTop();
  }

  /** กดหมวด = หน้าแรกของหมวดที่อยู่ในแอป · หมวดที่มีแต่หน้า WMS อื่น = หน้ารายการเมนู */
  function openArea(g) {
    var first = areaOf(g).items.filter(function (n) { return n.href === undefined && allowed(n); })[0];
    if (first) { openNav(first.id); return; }
    NAV_OPEN = false;
    VIEW = null; AREA = g;
    go('area');
    toTop();
  }

  /** พื้นที่เลื่อนของหน้า กับตำแหน่งบนสุด */
  function toTop() {
    var el = $('bkScroll');
    if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
    window.scrollTo(0, 0);
  }

  function renderNav() {
    var el = $('bkNav'), root = document.documentElement;
    if (!el) return;
    if (!ON || !USER) {
      el.hidden = true; NAV_HTML = ''; NAV_OPEN = false; el.innerHTML = '';
      root.classList.remove('bk-in');
      if (window.BookKeys) BookKeys.close();
      return;
    }
    el.hidden = false;
    root.classList.add('bk-in');
    var cur = here(), g = cur ? cur.area : MODE === 'area' && AREA ? AREA : 'today', area = areaOf(g);
    var mode = FIRE.mode === 'demo' ? 'โหมดซ้อม' : FIRE.mode === 'dev' ? 'ฐานทดลอง' : FIRE.override ? 'สวิตช์ปิด' : '';
    var team = me().team === 'qa' ? ' · ทีม QA' : '';
    var html =
      '<button type="button" class="bn-skip" id="bnSkip">ข้ามไปที่งาน</button>' +
      '<div class="bn-top">' +
        '<button type="button" class="bn-burger" id="bnBurger" aria-expanded="' + NAV_OPEN + '" aria-controls="bnList" aria-label="เมนู">' + ic(NAV_OPEN ? 'x' : 'menu') + '</button>' +
        '<button type="button" class="bn-brand" data-nav="home"><b>WMS</b>' +
          (mode ? '<span class="bn-mode">' + mode + '</span>' : '<span>สมุดสต๊อก</span>') + '</button>' +
        '<div class="bn-areas" role="group" aria-label="งานหลัก">' + AREAS.map(function (a) {
          return '<button type="button" class="bn-area" data-area="' + a.g + '"' + (a.g === g ? ' aria-current="true"' : '') + '>' + esc(a.t) + '</button>';
        }).join('') + '</div>' +
        '<button type="button" class="bn-find" id="bnFind" aria-label="ค้นหาเมนู SKU โล เอกสาร Ctrl K" aria-keyshortcuts="Control+K">' + ic('find') + '<span>ค้นหา SKU โล เอกสาร</span><kbd>Ctrl K</kbd></button>' +
        '<div class="bn-me" title="' + esc(USER.email || '') + '"><span><b>' + esc(USER.who) + '</b>' + esc(USER.role) + team + '</span>' +
          '<button type="button" class="bn-off" id="bkOut">ออก</button></div>' +
      '</div>' +
      '<div class="bn-side" id="bnList">' +
        '<div class="bn-areas-m" role="group" aria-label="เลือกหมวดงาน">' + AREAS.map(function (a) {
          return '<button type="button" class="bn-area-m" data-area="' + a.g + '"' + (a.g === g ? ' aria-current="true"' : '') + '>' + esc(a.t) + '</button>';
        }).join('') + '</div>' +
        '<h2 id="bnAreaT">' + esc(area.t) + '</h2>' +
        '<ul aria-labelledby="bnAreaT">' + area.items.filter(allowed).map(function (n) {
          return '<li>' + linkHtml(n, 'bn-it', n === cur) + '</li>';
        }).join('') + '</ul>' +
        '<div class="bn-who"><span><b>' + esc(USER.who) + '</b>' + esc(USER.role) + team + '</span><button type="button" class="bn-off" id="bkOut2">ออก</button></div>' +
      '</div>';
    el.className = 'bk-nav' + (NAV_OPEN ? ' open' : '');
    if (html !== NAV_HTML) {
      /* วาดใหม่แล้วแป้นพิมพ์ยังอยู่ที่ปุ่มเดิม และหมวดบนไม่เด้งกลับซ้าย */
      var f0 = el.contains(document.activeElement) ? document.activeElement : null;
      var sel = !f0 ? '' : f0.id ? '#' + f0.id : f0.dataset.area ? '.' + f0.className + '[data-area="' + f0.dataset.area + '"]'
        : f0.dataset.nav ? '[data-nav="' + f0.dataset.nav + '"]' : '';
      var strip = el.querySelector('.bn-areas'), left = strip ? strip.scrollLeft : 0;
      NAV_HTML = html;
      el.innerHTML = html;
      if (el.querySelector('.bn-areas')) el.querySelector('.bn-areas').scrollLeft = left;
      var f1 = sel ? el.querySelector(sel) : null;
      if (f1) f1.focus({ preventScroll: true });
    }
    var at = MODE + '|' + g + '|' + DOC;
    if (at !== AT) { AT = at; toTop(); }
  }

  /** หมวดที่มีแต่หน้า WMS อื่น */
  function renderArea() {
    var a = areaOf(AREA);
    $('act').innerHTML = ''; $('sum').innerHTML = ''; $('docs').innerHTML = '';
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">' + esc(a.t) + '</span></div>';
    $('body').innerHTML = table([['หน้า'], ['เปิด']], a.items.filter(allowed).map(function (n) {
      return '<tr><td>' + linkHtml(n, 'bh-link', false) + '</td><td class="c-sub">' + (away() ? 'แท็บใหม่' : 'หน้า WMS') + (simWarn(n) ? ' · ไม่มีโหมดซ้อมครบ' : '') + '</td></tr>';
    }));
  }

  /* ── สถานะเอกสาร (ชิป) ───────────────────────────────────────────────── */

  /** ชิปรับ / ตรวจ / อนุมัติ (x.ok จาก brief หรือ view) */
  function okChip(x) {
    if (!x || !x.ok) return '';
    if (x.ok === 'check') return x.xf ? '<span class="ba-st wait" title="ยังใช้ของต่อไม่ได้จนกว่าผู้รับกด รับ">รอรับ</span>' : '<span class="ba-st wait">รอตรวจ</span>';
    if (x.ok === 'reject') {
      var r = x.rj && x.rj.name !== undefined ? x.rj : { name: x.rj || '', why: x.rjWhy || '' };
      return '<span class="ba-st void" title="' + esc(r.name + ' · ' + r.why + ' · ของยังล็อกจนหัวหน้ายกเลิกใบ') + '">ไม่รับ</span>';
    }
    if (x.ok === 'approve') return '<span class="ba-st apv" title="' + (x.xf ? 'รับ' : 'ตรวจ') + 'โดย ' + esc(x.ck && x.ck.name !== undefined ? x.ck.name : x.ck || '') + '">รออนุมัติ</span>';
    return '<span class="ba-st ok" title="อนุมัติโดย ' + esc(x.ap && x.ap.name !== undefined ? x.ap.name : x.ap || '') + '">✓ อนุมัติแล้ว</span>';
  }

  function stChips(x) {
    var out = '';
    if (x.voided) out += '<span class="ba-st void" title="' + esc((x.voided.by || '') + ' · ' + (x.voided.why || '')) + '">ยกเลิกแล้ว' + (x.voided.link ? ' → ' + esc(x.voided.link) : '') + '</span>';
    if (x.link) out += '<span class="ba-st rev" title="ใบนี้ลงกลับรายการของ ' + esc(x.link) + '">↩ ' + esc(x.link) + '</span>';
    if (x.type === 'ยอดยกมา') out += '<span class="ba-st sub">จุดเริ่มสมุด</span>';
    out += okChip(x);
    if (x.state === 'wait') out += x.lock ? '<span class="ba-st sub" title="ใส่เลขได้หลังหัวหน้าอนุมัติ">🔒 TRcloud</span>' : '<span class="ba-st wait">รอลง TRcloud</span>';
    else if (x.state === 'done') out += '<span class="ba-st ok" title="เลข TRcloud">TRcloud ' + esc(x.tr) + '</span>';
    if (!out) out = '<span class="ba-st okk">✓ บันทึกแล้ว</span>';
    return out;
  }
  function backText() { return BACK === 'item' ? '‹ กลับไปหน้าสินค้า' : BACK === 'home' ? '‹ กลับไปงานของฉัน' : '‹ กลับไปรายการ'; }
  function docBtn(no) { return '<button type="button" class="ba-no" data-doc="' + esc(no) + '">' + esc(no) + '</button>'; }

  /* ── 🏠 วันนี้ ──────────────────────────────────────────────────────── */

  /** แถวที่สคริปต์ตรวจว่าผิดกติกา (หัวหน้า) */
  function auditList() {
    var a = head() && HX && HX.audit && HX.audit.audit;
    return a && +a.n > 0 && Array.isArray(a.list) ? a.list : [];
  }
  function auditSec() {
    var list = auditList();
    if (!list.length) return '';
    return '<section class="ba-sec"><h3>เอกสารผิดกติกา <span>สคริปต์ตรวจเจอ</span></h3>' +
      table([['เลขที่'], ['วันที่'], ['ประเภท'], ['ผู้ลง'], ['ผิดตรงไหน']], list.map(function (x) {   // คิวขึ้นแถวเดียว รายใบอยู่ตรงนี้
        return '<tr><td class="c-act">' + (x.no ? docBtn(x.no) : '—') + '</td><td class="c-sub">' + esc(x.date ? dmy(x.date) : '') + '</td><td>' + esc(x.type || '') + '</td>' +
          '<td>' + esc(x.name || '') + '</td><td>' + esc(x.why || '') + '</td></tr>';
      })) + '</section>';
  }

  /**
   * งานที่ไม่ใช่ใบรับ / ตรวจ / อนุมัติ (แถวละเรื่อง) · top = ขึ้นก่อนใบ
   * { tone, title ชื่องาน, ref เอกสาร, sub, qty, at ค้างตั้งแต่, word สถานะ, go, sec, act, doc }
   */
  function cards(h) {
    var out = [], mine = local();
    if (head() && HX && HX.audit && window.WmsFireDocs) {
      var ac = WmsFireDocs.auditCard({ audit: HX.audit.audit, error: HX.audit.error, open: h.open, now: Date.now(), practice: FIRE.mode !== 'live' }), bad1 = auditList()[0];
      if (ac) {
        ac.top = 1;
        ac.go = 'home';
        ac.ref = ac.n ? f(ac.n) + ' ใบ' : '';
        ac.word = ac.tone === 'bad' ? '! ผิดกติกา' : ac.tone === 'warn' ? '! ต้องเช็ค' : 'กำลังตรวจ';
        ac.act = bad1 && bad1.no ? 'เปิดใบ' : 'เช็คใหม่';
        if (bad1 && bad1.no) ac.doc = bad1.no;
        out.push(ac);
      }
    }
    mine.filter(function (p) { return p.sent; }).forEach(function (p) {
      out.push(p.held
        ? { top: 1, tone: 'warn', title: 'ชุดพักส่ง · ' + p.t, sub: heldNote(), word: 'พักส่ง', go: p.k, act: 'ไปดู' }
        : { top: 1, tone: 'bad', title: 'ชุดรอส่ง · ' + p.t, sub: 'ระบบส่งซ้ำเองทุก 30 วินาที ไม่บันทึกซ้ำ', word: '! ส่งไม่สำเร็จ', go: p.k, act: 'ไปดู' });
    });
    if (head() && !h.open) {
      /* สวิตช์ยังปิด (?fire=live) = ช่วงเตรียม ไม่เร่งให้ลงยอดก่อนนับเสร็จ */
      out.push({ tone: FIRE.override ? 'warn' : 'bad', title: 'ยังไม่ลงยอดยกมา',
        sub: 'ลงหลังนับใหญ่เสร็จเท่านั้น · ระหว่างรอ ตั้งข้อมูลหลักได้', word: 'ลงเอกสารยังล็อก', go: 'set', sec: 'open', act: 'ลงยอด' });
    }
    if (h.wait.n && !viewer()) {
      out.push({ tone: h.wait.days >= 2 ? 'bad' : 'warn', title: 'ใส่เลข TRcloud', ref: f(h.wait.n) + ' ใบ',
        sub: [h.wait.file ? 'ออกไฟล์ปรับยอด ' + f(h.wait.file) : '', h.wait.number ? 'ใส่เลข ' + f(h.wait.number) : ''].filter(Boolean).join(' · '),
        at: ddmm(h.wait.oldest).slice(0, 5), word: h.wait.days >= 2 ? '! ค้าง ' + h.wait.days + ' วัน' : 'รอเลข', go: 'trc', sec: 'wait', act: 'ใส่เลข' });
    }
    if (head()) {
      var xl = xferLeft();
      if (xl.length) {
        out.push({ tone: 'warn', title: 'วางแถวลงชีตเดิม', ref: f(xl.length) + ' วัน',
          sub: xl.slice(0, 3).map(function (d) { return ddmm(d.day); }).join(', ') + (xl.length > 3 ? ' …' : ''),
          at: ddmm(xl.map(function (d) { return d.day; }).sort()[0]).slice(0, 5), word: 'ยังไม่วาง', go: 'close', sec: 'xfer', act: 'คัดลอก' });
      }
      var ad = archDue();
      if (ad) out.push({ tone: 'info', title: 'ปิดเดือน', ref: ad.label, sub: f(ad.docs) + ' เอกสาร · ปิดแล้วเครื่องใหม่โหลดเร็วขึ้น', word: 'ถึงรอบปิด', go: 'close', sec: 'arch', act: 'ปิดเดือน' });
      if (h.open) {
        var old = h.trcDay ? C().dayNo(h.day) - C().dayNo(h.trcDay) : -1;
        if (old < 0 || old > TRC_OLD) {
          out.push({ tone: 'info', title: 'นำเข้ายอด TRcloud', ref: 'ไฟล์ Stock', sub: 'นำเข้าแล้วกระทบยอดราย SKU',
            at: h.trcDay ? ddmm(h.trcDay).slice(0, 5) : '', word: h.trcDay ? 'ยอดเก่า ' + old + ' วัน' : 'ยังไม่นำเข้า', go: 'trc', sec: 'imp', act: 'นำเข้า' });
        }
      }
    }
    mine.filter(function (p) { return !p.sent; }).forEach(function (p) {
      out.push({ tone: 'none', title: 'ร่างค้าง · ' + p.t, ref: 'ยังไม่มีเลข',
        sub: (p.files ? f(p.files) + ' ไฟล์ · ' : '') + f(p.rows) + (p.k === 'cut' ? ' บรรทัดออเดอร์' : ' แถว') + ' ยังไม่บันทึก', word: 'ร่าง', go: p.k, act: 'ทำต่อ' });
    });
    return out;
  }

  /** แถวของหนึ่งใบในคิว (x จาก FIRE.queue) */
  function docJob(x, side, day) {
    var qa = x.xf ? C().XF_TH[x.xf] || 'โอน QA' : x.type, tone = 'warn', title, word, act = 'ดูใบ';
    var late = function (n, w) { return x.age >= n ? '! ค้าง ' + x.age + ' วัน' : w; };
    if (side === 'done') {
      tone = x.step === 'reject' ? 'bad' : 'ok';
      title = { save: 'บันทึก', recv: 'รับ', check: 'ตรวจ', approve: 'อนุมัติ', reject: 'ไม่รับ' }[x.step] + ' · ' + qa;
      word = { save: '✓ บันทึกแล้ว', recv: '✓ รับแล้ว', check: '✓ ตรวจแล้ว', approve: '✓ อนุมัติแล้ว', reject: 'ไม่รับ' }[x.step];
    } else if (side === 'wait') {
      title = qa;
      if (x.step === 'first') { word = 'รอใบเข้า ' + x.first; }
      else if (x.step === 'recv') { tone = x.age ? 'warn' : 'info'; word = late(1, 'รอคนรับ'); }
      else { tone = x.age >= 2 ? 'warn' : 'info'; word = late(2, x.step === 'check' ? 'รอคนตรวจ' : 'รอหัวหน้าอนุมัติ'); }
    } else if (x.step === 'void' || x.step === 'redo') {
      tone = 'bad'; word = '! ไม่รับ';
      title = x.step === 'void' ? 'ยกเลิกใบที่ไม่รับ' : 'แจ้งหัวหน้ายกเลิกใบ';
      act = x.step === 'void' ? 'ดูและยกเลิก' : 'ดูเหตุผล';
    } else if (x.step === 'recv') {
      if (x.age >= 1) tone = 'bad';
      title = 'รับ · ' + qa; word = late(1, 'รอรับ'); act = 'ตรวจรับ';
    } else if (x.step === 'check') {
      if (x.age >= 2) tone = 'bad';
      title = 'ตรวจ · ' + qa; word = late(2, 'รอตรวจ'); act = 'ตรวจ';
    } else {
      if (x.age >= 2) tone = 'bad';
      title = 'อนุมัติ · ' + qa; word = late(2, 'รออนุมัติ'); act = 'ดูและอนุมัติ';
    }
    var sub = [x.sku, x.po && String(x.po) !== '0' ? 'PO ' + x.po : '', x.rows > 1 ? f(x.rows) + ' แถว' : '', x.name ? 'โดย ' + x.name : ''].filter(Boolean).join(' · ');
    return { tone: tone, title: title, doc: x.no, sub: sub, qty: +x.qty || 0, at: since(x.stamp, day), word: word, act: act };
  }

  /** แถวของตารางงานตามตัวกรอง · n = จำนวนบนตัวกรอง */
  function jobs(h, q) {
    var side = HOME_F, cs = cards(h), n = { todo: cs.length + q.n.todo, wait: q.n.wait, done: q.n.done };
    var list = q[side].map(function (x) { return docJob(x, side, h.day); });
    if (side === 'todo') {
      var rank = { bad: 0, warn: 1, info: 2, none: 3 };
      list = cs.filter(function (c) { return c.top; }).concat(list, cs.filter(function (c) { return !c.top; }))
        .map(function (c, i) { return [c, i]; })
        .sort(function (a, b) { return (rank[a[0].tone] || 0) - (rank[b[0].tone] || 0) || a[1] - b[1]; })
        .map(function (p) { return p[0]; });
    }
    var more = q.n[side] - q[side].length;
    if (more > 0) list.push({ tone: 'none', title: 'อีก ' + f(more) + ' ใบ', word: 'ดูในหน้าเอกสาร', go: 'docs', sec: side === 'done' ? '' : 'todo', act: 'ดูทั้งหมด' });
    return { list: list, n: n };
  }

  function jobRow(c, i) {
    var main = HOME_F === 'todo' && i === 0;
    return '<tr><td class="bh-k">' + esc(c.title) + '</td>' +
      '<td>' + (c.doc ? docBtn(c.doc) : c.ref ? esc(c.ref) : '<span class="c-sub">–</span>') + '</td>' +
      '<td class="bh-sub" title="' + esc(c.sub || '') + '">' + esc(c.sub || '') + '</td>' +
      '<td class="num">' + (c.qty !== undefined ? f(c.qty) : '<span class="c-sub">–</span>') + '</td>' +
      '<td class="bh-at">' + esc(c.at || '–') + '</td>' +
      '<td><span class="bh-st t-' + c.tone + '">' + esc(c.word || '') + '</span></td>' +
      '<td class="bh-act"><button type="button" class="bh-go' + (main ? ' main' : '') + '"' +
        (c.doc ? ' data-doc="' + esc(c.doc) + '"' : ' data-go="' + esc(c.go) + '"' + (c.sec ? ' data-sec="' + esc(c.sec) + '"' : '')) + '>' + esc(c.act) + '</button></td></tr>';
  }

  function renderHome() {
    var h = FIRE.home(), q = h && FIRE.queue();
    $('act').innerHTML = '';
    $('docs').innerHTML = '';
    if (!h || !q) {
      $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">งานของฉัน</span></div>';
      $('sum').innerHTML = '';
      $('body').innerHTML = '<div class="tx-empty">กำลังเปิดสมุด…</div>';
      return;
    }
    var a = document.activeElement, keep = a && a.id === 'baRefresh' ? '#baRefresh' : a && a.dataset && a.dataset.hf ? '[data-hf="' + a.dataset.hf + '"]' : '';
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">งานของฉัน</span><span class="bh-day">' + esc(ddmm(h.day, 1)) + '</span><span class="sp"></span>' +
      '<button type="button" class="tx-opt" id="baRefresh" title="ดึงเอกสารใหม่และเช็คงานค้าง"' + (HX_BUSY ? ' disabled' : '') + '>' + (HX_BUSY ? 'กำลังเช็ค…' : 'เช็คงานใหม่') + '</button></div>';

    var j = jobs(h, q);
    $('sum').innerHTML = [['todo', 'ต้องทำ'], ['wait', 'รอคนอื่น'], ['done', 'เสร็จวันนี้']].map(function (x) {
      return '<button type="button" class="bh-fl" data-hf="' + x[0] + '" aria-pressed="' + (HOME_F === x[0]) + '">' + x[1] + ' <b>' + f(j.n[x[0]]) + '</b></button>';
    }).join('') + (viewer() ? '<span class="bh-note">บัญชีนี้ดูได้อย่างเดียว</span>' : '');

    var none = { todo: '✓ ไม่มีงานค้าง', wait: 'ไม่มีใบของคุณที่รอคนอื่น', done: 'วันนี้คุณยังไม่มีงานที่ทำเสร็จ' }[HOME_F];
    var work = table([['งาน'], ['เอกสาร'], ['รายละเอียด'], ['ชิ้น', 'num'], [HOME_F === 'done' ? 'เวลา' : 'ค้างตั้งแต่'], ['สถานะ'], ['ขั้นต่อไป', 'bh-act']],
      j.list.length ? j.list.map(jobRow) : ['<tr><td colspan="7" class="bh-none' + (HOME_F === 'todo' ? ' ok' : '') + '">' + none + '</td></tr>']);

    /* ยอดของทั้งคลังวันนี้ต่อประเภท (เดิมอยู่บนการ์ดงานประจำวัน) */
    var byType = TYPES.filter(function (t) { var x = h.types[t]; return x && (x.n || x.void); }).map(function (t) {
      var x = h.types[t];
      return esc(t) + ' ' + f(x.n) + ' ใบ ' + f(x.qty) + ' ชิ้น' + (x.void ? ' (ยกเลิก ' + f(x.void) + ')' : '');
    }).join(' · ');
    var last = table([['เลขที่'], ['เวลา'], ['งาน'], ['ผู้ทำ'], ['แถว', 'num'], ['ชิ้น', 'num'], ['สถานะ']], h.last.length ? h.last.map(function (x) {
      return '<tr' + (x.voided ? ' class="r-void"' : '') + '><td class="c-act">' + docBtn(x.no) + '</td><td>' + esc(hm(x.stamp)) + '</td><td>' + esc(x.xf ? C().XF_TH[x.xf] || x.type : x.type) + '</td>' +
        '<td>' + esc(x.name) + '</td><td class="num">' + f(x.rows) + '</td><td class="num">' + f(x.qty) + '</td><td class="c-act">' + stChips(x) + '</td></tr>';
    }) : ['<tr><td colspan="7" class="bh-none">วันนี้ยังไม่มีเอกสาร</td></tr>']);

    $('body').innerHTML = '<div class="bh">' +
      '<section class="bh-queue" aria-label="ตารางงานของฉัน">' + work + '</section>' + auditSec() +
      '<section class="bh-last"><div class="bh-cap"><h2>บันทึกล่าสุดวันนี้</h2>' +
        (h.total ? '<span>ทั้งหมด ' + f(h.total) + ' ใบ · ของฉัน ' + f(h.mine) + (byType ? ' · ' + byType : '') + '</span>' : '') +
        '<button type="button" class="bk-link" data-nav="docs">เอกสารทั้งหมด</button></div>' + last + '</section></div>';
    if (keep && document.querySelector(keep)) document.querySelector(keep).focus({ preventScroll: true });
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
    r.states = Object.assign({}, r.states, { todo: (r.states.recv || 0) + (r.states.check || 0) + (r.states.approve || 0) });
    var st = [['todo', 'รอรับ / รออนุมัติ', 'c-warn'], ['recv', 'รอรับ', 'c-warn'], ['check', 'รอตรวจ', 'c-warn'], ['approve', 'รออนุมัติ', 'c-warn'], ['reject', 'ไม่รับ', 'c-red'], ['wait', 'รอลง TRcloud', 'c-warn'], ['void', 'ยกเลิกแล้ว', 'c-red'], ['mine', 'ของฉัน', '']];
    var stChipsHtml = st.map(function (s) {
      var n = r.states[s[0]] || 0;
      return '<button type="button" class="bk-chip ' + s[2] + (Q.status === s[0] ? ' on' : '') + (n || Q.status === s[0] ? '' : ' zero') + '" data-qs="' + s[0] + '">' + s[1] + ' <b>' + f(n) + '</b></button>';
    }).join('');
    $('sum').innerHTML = typeChips + '<span class="bk-sep"></span>' + stChipsHtml;
    /* ตัวกรอง รอรับ / รอตรวจ / รออนุมัติ: ติ๊กหลายใบแล้วกดทีเดียว (เฉพาะใบที่เรากดได้) */
    var u = me(), pick = PICK_ST.indexOf(Q.status) >= 0;
    var mayOk = function (x) {
      if (!pick || viewer()) return false;
      if (Q.status === 'approve') return x.ok === 'approve' && head();
      if (x.ok !== 'check' || x.by === u.email) return false;
      return Q.status === 'recv' ? !!x.xf && !C().takeWhy(x.xf, u) : !x.xf;
    };
    var can = pick ? r.list.filter(mayOk) : [];
    Object.keys(SEL).forEach(function (no) { if (!can.some(function (x) { return x.no === no; })) delete SEL[no]; });
    renderOkBar(can, r);
    if (!r.total) {
      $('body').innerHTML = '<div class="tx-empty">' + (pick && !Q.text ? '✓ ไม่มีใบ' + { recv: 'รอรับ', check: 'รอตรวจ', approve: 'รออนุมัติ' }[Q.status] + (Q.range !== 'all' ? ' ในช่วงนี้ ลองเลือก ทั้งหมด' : '')
        : Q.status === 'todo' && !Q.text ? '✓ ไม่มีใบรอรับ / รอตรวจ / รออนุมัติ'
        : r.all ? 'ไม่มีเอกสารตรงกับตัวกรอง' : Q.text ? 'ไม่พบ <b>' + esc(Q.text) + '</b> ในช่วงนี้ ลองเลือก ทั้งหมด' : 'ช่วงนี้ยังไม่มีเอกสาร') + '</div>';
      return;
    }
    var rows = r.list.map(function (x) {
      var at = String(x.stamp || '').slice(0, 10) === x.date ? hm(x.stamp) : when(x.stamp);   // บันทึกวันเดียวกับวันที่เอกสาร = เวลาอย่างเดียว
      var box = !can.length ? '' : '<td class="c-act">' + (mayOk(x)
        ? '<input type="checkbox" class="ba-ck" data-sel="' + esc(x.no) + '"' + (SEL[x.no] ? ' checked' : '') + ' aria-label="เลือก ' + esc(x.no) + '">'
        : '<span class="c-sub" title="' + esc(x.by === u.email ? 'ใบของคุณ ให้คนอื่น' + (x.xf ? 'รับ' : 'ตรวจ') : x.xf ? C().takeWhy(x.xf, u) : '') + '">—</span>') + '</td>';
      return '<tr' + (x.voided ? ' class="r-void"' : SEL[x.no] ? ' class="r-sel"' : '') + '>' + box + '<td class="c-act">' + docBtn(x.no) + '</td><td>' + esc(dmy(x.date)) + '</td><td class="c-sub">' + esc(at) + '</td>' +
        '<td>' + esc(x.type) + (x.xf ? ' <span class="c-sub">' + esc(C().XF_TH[x.xf]) + '</span>' : '') + '</td><td>' + esc(x.name) + '</td><td class="num">' + f(x.rows) + '</td><td class="num">' + f(x.qty) + '</td>' +
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
    if (PICK_ST.indexOf(Q.status) >= 0) {
      var take = Q.status === 'recv', verb = take ? 'รับ' : 'ตรวจ';
      if (can.length) {
        var all = n === can.length;
        out += '<button type="button" class="tx-opt" id="baSelAll">' + (all ? 'ไม่เลือก' : 'เลือกทั้งหมด ' + f(can.length) + ' ใบ') + '</button>';
        if (Q.status !== 'approve') {
          out += '<button type="button" class="bk-save" data-ok="check"' + (n && !BUSY ? '' : ' disabled') + '>' + (BUSY ? esc(BUSY) : '✓ ' + (take ? 'รับ ' : 'ตรวจแล้ว ') + f(n) + ' ใบ') + '</button>';
          if (head()) out += '<button type="button" class="bk-btn" data-ok="both"' + (n && !BUSY ? '' : ' disabled') + ' title="หัวหน้า' + verb + 'และอนุมัติในครั้งเดียว">✓ ' + verb + ' + อนุมัติ</button>';
        } else {
          out += '<button type="button" class="bk-save" data-ok="approve"' + (n && !BUSY ? '' : ' disabled') + '>' + (BUSY ? esc(BUSY) : '✓ อนุมัติ ' + f(n) + ' ใบ') + '</button>';
        }
        out += '<span class="c-sub">' + (take ? 'ติ๊กใบที่นับของครบแล้ว · ของไม่ครบหรือผิด เปิดใบแล้วกด ไม่รับ'
          : Q.status === 'check' ? 'ติ๊กใบที่เช็คของจริงแล้ว · ใบที่ตัวเองทำ ให้คนอื่นตรวจ' : 'ติ๊กใบที่รับ / ตรวจแล้วและยอดถูก') + '</span>';
      } else if (r.total) {
        out += '<span class="c-sub">' + (viewer() ? 'บัญชีนี้ดูได้อย่างเดียว' : take ? 'ใบที่เหลือเป็นของคุณ หรือเป็นของอีกทีมรับ'
          : Q.status === 'check' ? 'ใบที่เหลือเป็นของคุณ ให้คนอื่นตรวจ' : 'รอหัวหน้าอนุมัติ') + '</span>';
      }
    }
    if (NOTE) out += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = out ? '<div class="ba-okbar">' + out + '</div>' : '';
  }

  /** รับ / ไม่รับ / ตรวจ / อนุมัติ nos ทีเดียว (ส่งทีละ 10 ใบต่อกัน) · why = เหตุผลที่ไม่รับ */
  async function okRun(nos, act, why) {
    if (!nos.length || BUSY) return;
    var verb = nos.every(function (no) { var o = FIRE.okOf(no); return o && o.xf; }) ? 'รับ' : 'ตรวจ';
    var word = act === 'reject' ? 'ไม่รับ' : act === 'check' ? verb : act === 'approve' ? 'อนุมัติ' : verb + 'และอนุมัติ';
    if (nos.length > 1 && !confirm(word + ' ' + nos.length + ' ใบ ในชื่อ ' + (USER.who || '') + '?')) return;
    BUSY = 'กำลัง' + word + '…'; NOTE = null; render();
    var r;
    try { r = await FIRE.okSave(nos, act, why); } catch (e) { r = { saved: 0, error: e.message }; }
    BUSY = '';
    SEL = {};
    if (r.saved && window.stockNow) window.stockNow();   // ชิ้นที่ใช้ต่อได้เปลี่ยนเมื่อกดรับ
    NOTE = r.error
      ? { kind: 'bad', html: (r.saved ? word + 'แล้ว ' + f(r.saved) + ' ใบ · ' : '') + 'ที่เหลือทำไม่ได้: ' + esc(r.error) }
      : { kind: 'ok', html: '✓ ' + word + 'แล้ว ' + f(r.saved) + ' ใบ' + (nos.length === 1 ? ' (' + esc(nos[0]) + ')' : '') };
    render();
  }

  /** ไม่รับ: ต้องบอกเหตุผล คนทำใบกับหัวหน้าเห็น */
  function askReject(no) {
    var why = prompt('ไม่รับ ' + no + ' ทั้งใบ\nของจะล็อกไว้จนหัวหน้ายกเลิกใบ แล้วคนทำลงใบใหม่\n\nเหตุผล:');
    if (why === null) return;
    if (!why.trim()) { NOTE = { kind: 'bad', html: 'ไม่รับ ต้องใส่เหตุผล' }; render(); return; }
    okRun([no], 'reject', why.trim());
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
      $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="baBack">' + backText() + '</button><span class="bk-h">' + esc(DOC) + '</span></div>';
      $('sum').innerHTML = ''; $('act').innerHTML = '';
      $('body').innerHTML = '<div class="tx-empty">' + (FIRE.home() ? 'ไม่พบเลขที่ <b>' + esc(DOC) + '</b> ในสำเนาเครื่องนี้<br>เอกสารใหม่จากเครื่องอื่น กด ดึงข้อมูลใหม่ ในกล่องสถานะ' : 'กำลังเปิดสมุด…') + '</div>';
      return;
    }
    $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="baBack">' + backText() + '</button>' +
      '<span class="bk-h">' + esc(v.no) + '</span><span class="ba-ty">' + esc(v.xfTh || v.type) + '</span>' +
      '<span>วันที่ ' + esc(dmy(v.date)) + ' · ' + esc(v.name) + ' · บันทึก ' + esc(when(v.stamp)) + '</span><span class="sp"></span>' +
      '<button type="button" class="tx-opt" id="baPrint" title="' + (window.WmsFirePrint && WmsFirePrint.can(v) ? 'พิมพ์ใบ' + (v.type === 'แปลง' ? 'ขอแปลงรหัสสินค้า' : 'โอนย้ายสินค้า') + ' A5' : 'พิมพ์หน้านี้') + '">🖨 พิมพ์ใบ</button></div>';
    $('sum').innerHTML = stChips({ voided: v.voided, link: v.rev ? (v.orig && v.orig.no) : '', type: v.type, state: v.state, tr: v.tr, ok: v.ok, ck: v.ck, ap: v.ap, xf: v.xf, rj: v.rj, lock: v.lock }) +
      '<span class="bk-chip">แถว <b>' + f(v.rows.length) + '</b></span><span class="bk-chip">ชิ้น <b>' + f(v.qty) + '</b></span>' +
      (v.orders ? '<span class="bk-chip">ออเดอร์ <b>' + f(v.orders) + '</b></span>' : '');

    var act = '<button type="button" class="tx-opt" id="baCopy">📋 คัดลอกแถว</button>';
    var oc = window.WmsFireDocs ? WmsFireDocs.okCan(v, me()) : {};
    if (oc.check || oc.approve) {
      var verb = v.xf ? 'รับ' : 'ตรวจ', dis = BUSY ? ' disabled' : '';
      act += '<span class="bk-sep"></span>' + (oc.check ? '<button type="button" class="bk-save" data-ok1="check"' + dis + '>✓ ' + (v.xf ? 'รับ' : 'ตรวจแล้ว') + '</button>' : '') +
        (oc.both ? '<button type="button" class="bk-btn" data-ok1="both"' + dis + ' title="หัวหน้า' + verb + 'และอนุมัติในครั้งเดียว">✓ ' + verb + ' + อนุมัติ</button>' : '') +
        (oc.reject ? '<button type="button" class="bk-btn x" data-rj1="1"' + dis + ' title="ของไม่มา ไม่ครบ หรือผิด SKU / LOT / PO">✕ ไม่รับ</button>' : '') +
        (oc.approve ? '<button type="button" class="bk-save" data-ok1="approve"' + dis + '>✓ อนุมัติ</button>' : '') +
        (oc.why ? '<span class="c-sub">' + esc(oc.why) + '</span>' : '');
    } else if (oc.why && v.ok && v.ok !== 'done') act += '<span class="bk-sep"></span><span class="c-sub">' + esc(oc.why) + '</span>';
    if (v.state === 'wait' && v.lock) {
      if (v.ok !== 'reject') act += '<span class="bk-sep"></span><span class="c-sub">🔒 ใส่เลข TRcloud หลังหัวหน้าอนุมัติ</span>';
    } else if (v.state === 'wait' && !viewer()) {
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
    if (!no && BACK && MODE === 'docs') {
      var b = BACK, bh = b === 'item' && window.BookItem ? BookItem.hash() : '';
      BACK = ''; DOC = '';
      try { history.pushState(null, '', bh || location.pathname + location.search); } catch (e) { location.hash = bh; }
      setMode(b);
      window.scrollTo(0, 0);
      return;
    }
    if (no && MODE === 'item') BACK = 'item';
    else if (no && MODE !== 'docs') BACK = MODE === 'home' ? 'home' : '';
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
    if (t.id === 'bkOut2') { logout(); return; }
    if (t.id === 'bnSkip') {
      var main = document.querySelector('.wms-main');
      if (main) { var first = main.querySelector('#inp input, #body input:not([disabled]), #body button:not([disabled])'); (first || main).focus(); }
      return;
    }
    if (t.id === 'bnFind') { if (window.BookKeys) BookKeys.open(); return; }
    if (t.dataset.area) { openArea(t.dataset.area); return; }
    if (t.dataset.nav) {
      var n = byId(t.dataset.nav);
      if (n && n.href !== undefined) {
        /* ลิงก์จริง เปิดตามปกติ (Ctrl คลิก คัดลอกลิงก์ได้) */
        if (simWarn(n) && !confirm(SIM_ASK + '\nเปิดไหม?')) e.preventDefault();
        return;
      }
      openNav(t.dataset.nav);
      return;
    }
    if (t.dataset.hf) { HOME_F = t.dataset.hf; renderHome(); return; }
    if (t.id === 'bnBurger') { NAV_OPEN = !NAV_OPEN; renderNav(); return; }
    if (t.dataset.mode && NAV_OPEN) { NAV_OPEN = false; renderNav(); }   // เลือกเมนูแล้วพับ (หน้าเปลี่ยนตาม data-mode ของหน้า)
    if (t.dataset.mode === 'docs' && MODE === 'docs' && DOC) { openDoc(''); return; }
    if (t.dataset.doc) { e.preventDefault(); openDoc(t.dataset.doc); return; }
    if (t.dataset.go === 'docs') {
      /* แถวงานที่พาไปรายการเอกสาร: เปิดตัวกรองนั้น ทุกช่วงวัน */
      Q.status = t.dataset.sec || ''; Q.type = ''; Q.text = ''; if (Q.status) Q.range = 'all';
      VIEW = TODO_ST.indexOf(Q.status) >= 0 ? byId('todo') : null;
      saveQ(); SEL = {}; NOTE = null;
      if (DOC) openDoc(''); else if (MODE === 'docs') render(); else setMode('docs');
      return;
    }
    if (t.dataset.go === 'home') { loadHx(true); render(); return; }
    if (t.dataset.go) {
      var sec = t.dataset.sec || '';
      if (sec && (t.dataset.go === 'set' || t.dataset.go === 'close') && window.BookFireSet && BookFireSet.pick) BookFireSet.pick(t.dataset.go, sec);
      if (sec && t.dataset.go === 'trc' && window.BookFireTrc && BookFireTrc.pick) BookFireTrc.pick(sec);
      if (MODE === t.dataset.go) render(); else setMode(t.dataset.go);
      return;
    }
    if (t.id === 'baRefresh') { loadHx(true); load(true); return; }   // เหมือนปุ่ม ดึงสต๊อกใหม่ + งานของหัวหน้า
    if (t.id === 'baBack') { openDoc(''); return; }
    if (t.id === 'baPrint') { printDoc(DOC); return; }
    if (t.dataset.print) { printDoc(t.dataset.print); return; }
    if (t.dataset.ok) { okRun(Object.keys(SEL), t.dataset.ok); return; }
    if (t.dataset.ok1) { if (DOC) okRun([DOC], t.dataset.ok1); return; }
    if (t.dataset.rj1) { if (DOC) askReject(DOC); return; }
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
    if (t.dataset.qs) { Q.status = Q.status === t.dataset.qs ? '' : t.dataset.qs; SEL = {}; NOTE = null; saveQ(); renderDocList(); renderNav(); return; }
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
    if (!no && BACK === 'home' && MODE === 'docs') { BACK = ''; setMode('home'); return; }   // ย้อนกลับจากใบที่เปิดจากงานของฉัน
    if (no && MODE !== 'docs') setMode('docs'); else if (window.render) window.render();
  });

  /* ── โครงหน้า (ครั้งเดียวตอนโหลด · ระบบเดิมไม่ทำ) ──────────────────── */

  function boot() {
    var main = document.querySelector('.wms-main'), body = $('body'), docs = $('docs'), act = $('act'), inp = $('inp');
    if (!main || !body || !docs || !act || !inp) return;
    var box = document.createElement('div');
    box.className = 'bk-scroll';
    box.id = 'bkScroll';
    box.tabIndex = 0;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'พื้นที่งาน');
    main.insertBefore(box, body);
    box.appendChild(body);
    box.appendChild(docs);
    main.appendChild(act);                // แถบลงมืออยู่ท้ายจริง ลำดับ Tab ตรงกับที่เห็น
    main.setAttribute('role', 'main');
    main.tabIndex = -1;
    var say = document.createElement('div');
    say.id = 'bkSay';
    say.className = 'bk-say';
    say.setAttribute('role', 'status');
    document.body.appendChild(say);
    /* ชื่อหน้าของทุกโมดูล = หัวเรื่องระดับ 1 */
    var title = function () {
      var h = inp.querySelector('.bk-top .bk-h');
      if (!h) return;
      h.setAttribute('role', 'heading'); h.setAttribute('aria-level', '1');
      if (typeof USER === 'undefined' || !USER || (MODE !== 'cut' && MODE !== 'move')) return;
      var n = here();   // ชื่อหน้าตรงกับเมนูที่กด (ย้าย กับ โอน QA เป็นหน้าเดียวกัน)
      if (n && h.textContent !== n.t) h.textContent = n.t;
    };
    if (window.MutationObserver) new MutationObserver(title).observe(inp, { childList: true });
  }
  if (ON) boot();

  window.BookApp = {
    on: ON,
    tabs: tabs,
    /** หน้าแรกตอนเปิดแอป: ลิงก์ #doc= = หน้าเอกสาร · ไม่งั้น วันนี้ */
    start: function () { return DOC ? 'docs' : window.BookItem && BookItem.fromHash() ? 'item' : 'home'; },
    nav: renderNav,
    render: function (mode) {
      if (mode === 'home') renderHome();
      else if (mode === 'docs') renderDocsPage();
      else if (mode === 'item' && window.BookItem) BookItem.render();
      else if (mode === 'area') renderArea();
    },
    opened: function (mode) {
      if (VIEW && (VIEW.k || VIEW.to) !== mode && !(mode === 'docs' && DOC)) VIEW = null;
      if (mode === 'home') loadHx(false);
      if (mode !== 'docs') BACK = '';
      if (mode !== 'docs' && DOC) { DOC = ''; NOTE = null; }
      /* เปลี่ยนเมนู = ที่อยู่หน้าไม่ค้าง #doc / #sku กดรีเฟรชแล้วไม่เด้งกลับใบเดิม */
      if (mode !== 'docs' && mode !== 'item' && /^#(doc|sku)=/.test(location.hash || '')) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      }
    },
    /** ประเภทเอกสารของแท็บงาน (ตารางชุดที่บันทึกด้านล่างแสดงเฉพาะของแท็บนั้น) */
    typeOf: function (mode) { return TYPE_OF[mode] || ''; },
    openDoc: openDoc,
    openNav: openNav,
    top: toTop,
    /** เมนูที่คนนี้เห็น (ค้นหา Ctrl K) */
    menu: function () {
      return NAV.filter(function (n) { return !n.g && allowed(n); }).map(function (n) {
        return { id: n.id, t: n.t, area: areaOf(n.area).t, away: n.href !== undefined && away() };
      });
    },
    /** เปิดหน้าเอกสารพร้อมคำค้น */
    searchDocs: function (text) {
      Q.text = String(text || ''); Q.type = ''; Q.status = ''; Q.range = 'all';
      saveQ(); SEL = {}; NOTE = null; BACK = ''; VIEW = null;
      if (DOC) openDoc(''); else go('docs');
      toTop();
    },
    okChip: okChip,
    /** แท็บนี้มีใบพิมพ์ + ตรวจ / อนุมัติไหม (ย้าย / เติม / QA · แปลงสินค้า) */
    okMode: function (mode) { return !!(window.WmsFireCore && WmsFireCore.OK_TYPES.indexOf(TYPE_OF[mode] || '') >= 0); },
  };
})();
