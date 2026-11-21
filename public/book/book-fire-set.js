/**
 * book-fire-set.js — ระบบใหม่ ขั้น 2: แท็บ ⚙️ ตั้งค่า ของหน้า public/book/ (เฉพาะ ?fire=dev ตอนนี้)
 *
 *   👥 คนใช้และสิทธิ์ (หัวหน้า)  เพิ่มคนด้วยอีเมลบริษัท เปลี่ยนสิทธิ์ เปิด/ปิด แก้แล้วบันทึกทันที ไม่มีรหัสให้จำ
 *   📥 ยอดยกมา (หัวหน้า)        ไฟล์ตั้งต้นสมุดจากหน้านับสต๊อกใหญ่ (ชีต ยอดตั้งต้น) ลาก/เลือกไฟล์ หรือ Ctrl+V แล้วกดลง
 *   🔍 ตรวจยอด                 คิดยอดใหม่จากเอกสารทุกใบเทียบกับยอดในเครื่อง (หัวหน้า) · โหลดสำเนาเครื่องนี้ใหม่ (ทุกคน)
 *   📋 ชีตเดิม (หัวหน้า ขั้น 3)  ช่วงเปลี่ยนผ่าน: คัดลอกแถวของแต่ละวันไปวางต่อท้ายชีต Transaction เดิม แล้วกด วางแล้ว
 *   💾 สำรอง (หัวหน้า ขั้น 3)    ดาวน์โหลดไฟล์สำรองจากสำเนาในเครื่อง · ฐานทดลองกู้คืนจากไฟล์ได้ (ระบบจริงใช้ fire-backup.gs)
 *   🗄️ ปิดเดือน (หัวหน้า)       รวมเอกสารของเดือนที่จบแล้วเป็นก้อน เครื่องใหม่ / โหลดใหม่ทั้งหมด อ่านไม่กี่ก้อนแทนทีละเอกสาร
 *   📊 โควตาฟรี                อ่าน/เขียนวันนี้ของเครื่องนี้และทุกเครื่องที่ส่งยอดมา
 *
 * แอปสมุดสต๊อก: แยกเป็นสองเมนู
 *   🌙 ปิดวัน / เดือน (หัวหน้า)  ① ตรวจยอด ② วางชีตเดิม ③ ปิดเดือน — งานประจำวันและต้นเดือน
 *   ⚙️ ตั้งค่า                  คนใช้และสิทธิ์ ยอดยกมา สำรอง โควตาฟรี (คนลงรายการ: สำเนาเครื่องนี้ โควตาฟรี)
 * ใช้ตัวแปรและฟังก์ชันของสคริปต์ในหน้า (FIRE USER BSTATE BKBUSY RES esc f table isHead bookPost refreshState refreshDocs compute render xlsxLib)
 * ตอนถูกเรียกเท่านั้น ไฟล์นี้โหลดก่อนสคริปต์ในหน้า เปิดเป็น window.BookFireSet
 */
(function () {
  'use strict';

  var SEC_KEY = 'wms:book:fire:sec';
  var KEYS = { set: SEC_KEY, close: SEC_KEY + ':close' };
  var SECS = { set: lsGet(KEYS.set), close: lsGet(KEYS.close) };   // ส่วนที่เปิดค้างต่อเมนู
  var NOTE = null;        // { kind: ok|bad|warn, html }
  var BUSY = '';
  var USERS = null, USERS_FOR = '';
  var Q = null, Q_AT = 0; // โควตาล่าสุด
  var OPEN = null;        // ไฟล์ยอดตั้งต้นที่อ่านแล้ว ยังไม่ลง { rows, bad, tot, name, batch }
  var SHOW = 'rows';
  var CHECK = null, CHECK_AT = 0;
  var XFER = null, XFER_AT = 0;   // วันที่ต้องวางลงชีตเดิม
  var ARCH = null, ARCH_AT = 0;   // สรุปปิดเดือน { months, next, fix, fresh }
  var ADD = { name: '', email: '', role: 'staff' };
  var ROLE_TH = { head: 'หัวหน้า', staff: 'ลงรายการ', viewer: 'ดูอย่างเดียว' };

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function $(id) { return document.getElementById(id); }
  function head() { return isHead(); }
  /** เมนูที่เปิดอยู่: close = ปิดวัน / เดือน · set = ตั้งค่า */
  function grp() { return typeof MODE !== 'undefined' && MODE === 'close' ? 'close' : 'set'; }
  function C() { return window.WmsFireCore; }
  function when(ms) {
    return ms ? new Date(ms).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function hm(ms) { return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); }
  function secs(g) {
    if ((g || grp()) === 'close') return head() ? [['check', '① ตรวจยอด'], ['xfer', '② วางชีตเดิม'], ['arch', '③ ปิดเดือน']] : [['check', '🔍 สำเนาเครื่องนี้']];
    return head() ? [['users', '👥 คนใช้และสิทธิ์'], ['open', '📥 ยอดยกมา'], ['backup', '💾 สำรอง'], ['quota', '📊 โควตาฟรี']]
      : [['check', '🔍 สำเนาเครื่องนี้'], ['quota', '📊 โควตาฟรี']];
  }
  function sec() {
    var g = grp();
    if (!secs(g).some(function (s) { return s[0] === SECS[g]; })) SECS[g] = g === 'close' ? 'check' : head() ? (BSTATE && BSTATE.open ? 'users' : 'open') : 'quota';
    return SECS[g];
  }
  function keepSec(g, s) { SECS[g] = s; try { localStorage.setItem(KEYS[g], s); } catch (e) {} }
  function setSec(s) {
    keepSec(grp(), s); NOTE = null;
    renderAll();
    need();
  }
  function renderAll() { if (window.render) window.render(); }

  /* ── โหลดของแต่ละส่วนตอนเปิด ── */

  function need() {
    var s = sec();
    if (s === 'users' && head() && USERS_FOR !== USER.email && !BUSY) loadUsers();
    if (s === 'quota' && (!Q || Date.now() - Q_AT > 60000) && !BUSY) loadQuota();
    if (s === 'xfer' && head() && (!XFER || Date.now() - XFER_AT > 60000) && !BUSY) loadXfer();
    if (s === 'arch' && head() && (!ARCH || Date.now() - ARCH_AT > 60000) && !BUSY) loadArch();
  }

  async function loadArch() {
    BUSY = 'กำลังโหลด…'; renderAll();
    var r = await FIRE.archInfo();
    BUSY = '';
    if (r.error) NOTE = { kind: 'bad', html: 'โหลดไม่ได้: ' + esc(r.error) };
    else { ARCH = r; ARCH_AT = Date.now(); }
    renderAll();
  }

  async function loadXfer() {
    BUSY = 'กำลังโหลด…'; renderAll();
    var r = await FIRE.xferDays();
    BUSY = '';
    if (r.error) NOTE = { kind: 'bad', html: 'โหลดไม่ได้: ' + esc(r.error) };
    else { XFER = r.days; XFER_AT = Date.now(); }
    renderAll();
  }

  async function loadUsers() {
    BUSY = 'กำลังโหลดรายชื่อ…'; renderAll();
    var r = await FIRE.users();
    BUSY = '';
    if (r.error) { NOTE = { kind: 'bad', html: 'โหลดรายชื่อไม่ได้: ' + esc(r.error) }; USERS = null; }
    else { USERS = r.users; USERS_FOR = USER.email; }
    renderAll();
  }

  async function loadQuota() {
    BUSY = 'กำลังนับ…'; renderAll();
    try { Q = await FIRE.quota(); Q_AT = Date.now(); } catch (e) { NOTE = { kind: 'bad', html: 'นับโควตาไม่ได้: ' + esc(e.message) }; }
    BUSY = '';
    renderAll();
  }

  /* ── วาด ───────────────────────────────────────────────────────────── */

  var TIPS = {
    users: 'เข้าด้วย Google ของบริษัท ไม่มีรหัสให้จำ\nเพิ่มคน: ใส่ชื่อ อีเมลบริษัท เลือกสิทธิ์ แล้วกด เพิ่ม\nหัวหน้า = ทุกอย่าง + ยกเลิกเอกสาร ปรับยอด ยอดยกมา ตั้งค่า\nลงรายการ = ตัดขาย รับของ ย้าย คืน แปลง\nดูอย่างเดียว = ดูยอดได้ บันทึกไม่ได้\nคนที่ออก: เอาเครื่องหมายใช้งานออก (ไม่ลบ ชื่อในเอกสารเก่ายังอ่านได้)\nแก้แล้วบันทึกทันที',
    open: 'ลงยอดยกมา (วันเปิดระบบ)\n1 หน้านับสต๊อกใหญ่ › แท็บตั้งต้นสมุด › อนุมัติแล้วดาวน์โหลด Excel\n2 ลากไฟล์มาวางที่นี่ หรือเปิดชีต ยอดตั้งต้น คัดลอกทั้งตารางแล้วกด Ctrl+V\n3 ดูตัวเลข แถวผิดต้องเป็น 0 แล้วกด ลงยอดยกมา\n4 แท็บ ตรวจยอด ต้องขึ้น ✓\nลงใหม่ได้จนกว่าจะมีเอกสารอื่นต่อจากยอดยกมา หลังจากนั้นใช้ปรับยอดแทน',
    check: 'ตรวจยอด: คิดยอดใหม่จากเอกสารทุกใบในเครื่องนี้ เทียบกับยอดคงเหลือที่เครื่องเก็บไว้ ไม่ตรง = ซ่อมจากเอกสารให้เอง\nโหลดใหม่ทั้งหมด: ล้างสำเนาในเครื่องแล้วดึงเอกสารทุกใบจากฐานอีกครั้ง ใช้เมื่อสงสัยว่าเครื่องนี้ไม่ตรงกับเครื่องอื่น (อ่านเท่าจำนวนเอกสาร)',
    quota: '',
    xfer: 'ช่วงเปลี่ยนผ่าน (1 เดือนหลังเปิดระบบ): หน้ารายงานเดิม (FIFO, LOT/PO, Stock by Location, MFG, เช็คตัดสต๊อก) ยังอ่านชีต Transaction เดิม\n' +
      'วันละครั้ง กด คัดลอก ของวันก่อน วางที่แถวว่างแรกของชีต Transaction (คอลัมน์ A) แล้วกด ✓ วางแล้ว\n' +
      'แถวเรียงตามที่บันทึก รวมใบยกเลิก (แถวกลับ) · ยอดยกมาไม่ต้องวาง · วางแล้วมีเอกสารเพิ่ม กดคัดลอกอีกครั้งได้เฉพาะส่วนที่เพิ่ม',
    backup: 'Firebase แผนฟรีไม่มีระบบสำรองให้\nสำรองอัตโนมัติ: apps-script/fire-backup.gs ดึงเอกสารใหม่ลง Google Drive ทุกคืน (ตั้งตอนเปิดระบบจริง)\n' +
      'ปุ่มนี้: ดาวน์โหลดไฟล์สำรองจากสำเนาในเครื่องนี้ทันที (เอกสารทุกใบ รายชื่อ ตารางหลัก ยอด TRcloud ล่าสุด)\n' +
      'กู้คืน: โปรเจกต์ใหม่ที่ว่าง + fire-backup.gs ฟังก์ชัน restoreAll (อ่านไฟล์ทุกไฟล์ในโฟลเดอร์สำรอง)',
    arch: 'ปิดเดือน: รวมเอกสารของเดือนที่จบแล้วเป็นก้อน (ก้อนละไม่เกิน 900 KB)\n' +
      'เครื่องใหม่ หรือกด โหลดสำเนาเครื่องนี้ใหม่ทั้งหมด อ่านไม่กี่ก้อนแทนอ่านทีละเอกสาร ประหยัดโควตาอ่าน\n' +
      'ปิดทีละเดือนตามลำดับ เดือนปัจจุบันยังปิดไม่ได้ · ทำต้นเดือนถัดไป ทุกเดือน\n' +
      'เลข TRcloud ที่ใส่หลังปิด เครื่องใหม่ยังเห็นครบ (ดึงเพิ่มเอง)\n' +
      'ไม่แก้ ไม่ลบเอกสารเดิม ไฟล์สำรองยังครบ · เน็ตหลุดกลางทาง กดปิดเดือนใหม่ได้',
  };

  function renderIn() {
    var s = sec();
    var chips = secs().map(function (x) {
      return '<button class="bk-chip' + (s === x[0] ? ' on' : '') + '" data-fsec="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var tip = s === 'quota' && Q ? 'ฟรีวันละ อ่าน ' + f(Q.limits.reads) + ' · เขียน ' + f(Q.limits.writes) + '\nรีเซ็ตทุกวันเวลา ' + hm(Q.resetAt) + ' น. (เที่ยงคืนเวลาแปซิฟิก)\n' +
      'ทุกเครื่องส่งยอดของตัวเองชั่วโมงละครั้ง ตัวเลขรวมจึงช้ากว่าจริงได้ถึงหนึ่งชั่วโมง\nเครื่องที่ยังไม่ได้เปิดวันนี้ไม่มีในรายการ · ตัวเลขจริงทั้งระบบดูที่ Firebase console › Usage' : TIPS[s];
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">' + (grp() === 'close' ? 'ปิดวัน / เดือน' : 'ตั้งค่า') + '</span>' + chips +
      (tip ? '<button type="button" class="g-tip" title="' + esc(tip) + '" aria-label="คำอธิบาย">ⓘ</button>' : '') +
      '<span class="sp"></span>' + (BUSY ? '<span>⏳ ' + esc(BUSY) + '</span>' : '<button class="tx-opt" id="fsRefresh">🔄</button>') + '</div>';
  }

  function chip(cls, label, n, sub, show) {
    return '<' + (show ? 'button data-fshow="' + show + '"' : 'span') + ' class="bk-chip ' + cls + (show && SHOW === show ? ' on' : '') + (n ? '' : ' zero') + '">' +
      label + ' <b>' + f(n) + '</b>' + (sub ? ' ' + sub : '') + '</' + (show ? 'button' : 'span') + '>';
  }

  function renderSum() {
    var s = sec(), html = '';
    if (s === 'users' && USERS) {
      var on = USERS.filter(function (u) { return u.active; });
      var by = function (r) { return on.filter(function (u) { return u.role === r; }).length; };
      html = chip('c-ok', 'ใช้งาน', on.length, 'คน') + chip('', 'หัวหน้า', by('head')) + chip('', 'ลงรายการ', by('staff')) +
        chip('', 'ดูอย่างเดียว', by('viewer')) + chip('', 'ปิดแล้ว', USERS.length - on.length);
    } else if (s === 'open') {
      var op = BSTATE && BSTATE.open;
      html = '<span>ยอดยกมาในระบบ: ' + (op ? '<b>' + esc(op.doc) + '</b> · ' + f(op.rows) + ' กอง · ' + f(op.qty) + ' ชิ้น · ' + esc(String(op.at).slice(5, 16)) + ' · ' + esc(op.who) : '<b>ยังไม่ลง</b>') +
        (op && BSTATE.after ? ' · <span class="c-warn">มีเอกสารต่อแล้ว ' + f(BSTATE.after) + ' ชุด ลงใหม่ไม่ได้ (ใช้ปรับยอดแทน)</span>' : '') + '</span>';
      if (OPEN) {
        var t = OPEN.tot;
        html += '<span class="bk-sep"></span>' + chip('c-ok', 'กอง', t.piles, '· ' + f(t.qty) + ' ชิ้น', 'rows') + chip('', 'SKU', t.skus) + chip('', 'โลเปิด', t.open) +
          '<span class="bk-chip' + (t.noGr ? '' : ' zero') + '" title="ไม่มี GR วัน-เดือน-ปี ใน Note ลงไตรมาสของรอบนับแทน">ไม่รู้วันรับ <b>' + f(t.noGr) + '</b></span>' +
          '<span class="bk-chip' + (t.est ? '' : ' zero') + '" title="LOT/PO ประมาณจาก GR ล่าสุด (ดูชีต ประมาณ LOT-PO ในไฟล์)">ประมาณ LOT/PO <b>' + f(t.est) + '</b></span>' +
          '<span class="bk-chip' + (t.zero ? ' c-warn' : ' zero') + '" title="LOT หรือ PO ว่างในไฟล์ ลงเป็น 0">LOT/PO ว่าง → 0 <b>' + f(t.zero) + '</b></span>' +
          (t.merged ? '<span class="bk-chip" title="Location SKU LOT PO เดียวกันหลายแถว รวมชิ้นเป็นกองเดียว">รวมกองซ้ำ <b>' + f(t.merged) + '</b></span>' : '') +
          (t.skipped ? '<span class="bk-chip" title="แถวชิ้น 0 ไม่ลง">ข้าม 0 ชิ้น <b>' + f(t.skipped) + '</b></span>' : '') +
          chip('c-red', 'แถวผิด', OPEN.bad.length, '', 'bad');
      }
    } else if (s === 'quota' && Q) {
      html = '<span>วันที่ ' + esc(Q.day) + ' (เวลาแปซิฟิก) · รีเซ็ต <b>' + esc(hm(Q.resetAt)) + ' น.</b></span>';
    } else if (s === 'xfer' && XFER) {
      var left = XFER.filter(function (d) { return !d.done || d.more; });
      html = chip(left.length ? 'c-warn' : 'c-ok', 'ยังไม่วาง', left.length, 'วัน') + chip('', 'วางแล้ว', XFER.length - left.length, 'วัน') +
        '<span>วางต่อท้ายชีต Transaction เดิม วันละครั้ง ตามลำดับวัน</span>';
    } else if (s === 'arch' && ARCH) {
      var fr = ARCH.fresh;
      html = chip(ARCH.months.length ? 'c-ok' : '', 'ปิดแล้ว', ARCH.months.length, 'เดือน') +
        '<span title="ประมาณการอ่านของเครื่องที่ยังไม่มีสำเนา (เครื่องใหม่ / โหลดใหม่ทั้งหมด)">เครื่องใหม่อ่านประมาณ <b>' + f(fr.after) + '</b> ครั้ง' +
        (fr.after < fr.before ? ' <span class="c-sub">(ไม่ปิดเดือน ' + f(fr.before) + ')</span>' : '') + '</span>' +
        (ARCH.fix ? '<span class="c-sub" title="เลข TRcloud ที่ใส่หลังปิดเดือน เครื่องใหม่อ่านจากก้อนแยก">เลข TRcloud หลังปิด ' + f(ARCH.fix) + '</span>' : '');
    } else if (s === 'backup') {
      var cb = FIRE.copy();
      if (cb) html = '<span>สำเนาเครื่องนี้: <b>' + f(cb.docs) + '</b> เอกสาร · seq ' + f(cb.seq) + '</span>';
    } else if (s === 'check') {
      var cp = FIRE.copy();
      if (cp) html = '<span>สำเนาเครื่องนี้: <b>' + f(cp.docs) + '</b> เอกสาร · ' + f(cp.piles) + ' กอง' + (CHECK_AT ? ' · ตรวจล่าสุด ' + esc(when(CHECK_AT)) : '') + '</span>';
    }
    $('sum').innerHTML = html;
  }

  function renderAct() {
    var s = sec(), html = '', dis = BKBUSY || BUSY ? 'disabled' : '';
    if (s === 'open') {
      var op = BSTATE && BSTATE.open, blocked = !!(op && BSTATE.after);
      html += '<button class="tx-opt' + (OPEN ? '' : ' p') + '" id="fsPick" ' + dis + '>📂 เลือกไฟล์ยอดตั้งต้น</button>' +
        '<input type="file" class="bk-file" id="fsFile" accept=".xlsx,.xls,.csv">';
      if (OPEN) {
        var ok = !OPEN.bad.length && !blocked && OPEN.rows.length;
        html += '<button class="bk-save" id="fsOpen" ' + (ok && !BKBUSY ? '' : 'disabled') + '>' + (BKBUSY ? esc(BKBUSY)
          : (op ? '⟳ ลงใหม่ แทน ' + esc(op.doc) + ' ' : '📥 ลงยอดยกมา ') + f(OPEN.tot.piles) + ' กอง') + '</button>' +
          '<span>' + esc(OPEN.name) + '</span><button class="bk-link" id="fsOpenX">ไม่ลง</button>';
        if (OPEN.bad.length) html += '<span class="c-red">แก้แถวผิดในไฟล์ก่อน แล้ววางใหม่</span>';
      } else {
        html += '<span class="g-hint">หรือลากไฟล์มาวาง · คัดลอกชีต ยอดตั้งต้น แล้วกด Ctrl+V</span>';
      }
    } else if (s === 'check') {
      if (head()) html += '<button class="bk-save" id="fsCheck" ' + dis + '>🔍 ตรวจยอดตอนนี้</button>';
      var cp = FIRE.copy();
      html += '<button class="bk-link" id="fsReload" ' + dis + ' title="อ่านประมาณ ' + f(cp ? cp.docs + 1 : 0) + ' ครั้ง">⟳ โหลดสำเนาเครื่องนี้ใหม่ทั้งหมด</button>';
    } else if (s === 'users') {
      html += '<span class="g-hint">แก้ชื่อ สิทธิ์ หรือใช้งาน แล้วบันทึกทันที · คนที่ออก เอาเครื่องหมายใช้งานออก</span>';
    } else if (s === 'xfer') {
      html += '<span class="g-hint">📋 คัดลอก → วางที่แถวว่างแรกของชีต Transaction คอลัมน์ A → ✓ วางแล้ว</span>';
    } else if (s === 'arch' && ARCH) {
      var nx = ARCH.next;
      if (nx.m) html += '<button class="bk-save" id="fsArch" ' + dis + '>🗄️ ปิดเดือน ' + esc(nx.label) + ' · ' + f(nx.docs) + ' เอกสาร</button>';
      else html += '<span class="' + (nx.none || nx.wait ? 'g-hint' : 'c-warn') + '">' + esc(nx.error) + '</span>';
    } else if (s === 'backup') {
      html += '<button class="bk-save" id="fsBackup" ' + dis + '>⬇ ดาวน์โหลดไฟล์สำรอง</button>';
      if (FIRE.dev) html += '<button class="bk-link" id="fsRestore" ' + dis + '>♻️ กู้คืนจากไฟล์ (ฐานทดลอง)</button><input type="file" class="bk-file" id="fsRestoreFile" accept=".json">';
    }
    if (NOTE) html += '<div class="bk-msg ' + NOTE.kind + '">' + NOTE.html + '</div>';
    $('act').innerHTML = html;
  }

  function roleSel(attr, v) {
    return '<select class="fs-in" ' + attr + '>' + ['head', 'staff', 'viewer'].map(function (r) {
      return '<option value="' + r + '"' + (r === v ? ' selected' : '') + '>' + ROLE_TH[r] + '</option>';
    }).join('') + '</select>';
  }

  function renderUsers() {
    if (!USERS) return BUSY ? '' : '<div class="tx-empty">ยังโหลดรายชื่อไม่ได้ กด 🔄</div>';
    var dom = FIRE.domain ? '@' + FIRE.domain : '';
    var add = '<tr class="r-add"><td class="c-no num">+</td>' +
      '<td class="fs-c"><input class="fs-in" id="fsAddName" placeholder="ชื่อ" value="' + esc(ADD.name) + '" autocomplete="off"></td>' +
      '<td class="fs-c"><input class="fs-in" id="fsAddMail" type="email" placeholder="ชื่อ' + esc(dom) + '" value="' + esc(ADD.email) + '" autocomplete="off" style="min-width:200px"></td>' +
      '<td class="fs-c">' + roleSel('id="fsAddRole"', ADD.role) + '</td>' +
      '<td colspan="3"><button class="bk-btn" id="fsAdd" ' + (BUSY ? 'disabled' : '') + '>+ เพิ่ม</button></td></tr>';
    var me = USER.email;
    var rows = USERS.map(function (u, i) {
      var self = u.email === me;
      return '<tr' + (u.active ? '' : ' class="r-off"') + '><td class="c-no num">' + (i + 1) + '</td>' +
        '<td class="fs-c"><input class="fs-in" data-u="' + esc(u.email) + '" data-k="name" value="' + esc(u.name) + '" autocomplete="off"></td>' +
        '<td class="c-sub">' + esc(u.email) + (self ? ' <b>(คุณ)</b>' : '') + '</td>' +
        '<td class="fs-c">' + (self ? '<span style="padding:0 8px">' + ROLE_TH[u.role] + '</span>' : roleSel('data-u="' + esc(u.email) + '" data-k="role"', u.role)) + '</td>' +
        '<td style="text-align:center"><input type="checkbox" data-u="' + esc(u.email) + '" data-k="active"' + (u.active ? ' checked' : '') + (self ? ' disabled title="ปิดบัญชีตัวเองไม่ได้"' : '') + ' aria-label="ใช้งาน"></td>' +
        '<td class="c-sub">' + esc(when(u.last)) + '</td><td class="c-sub" title="' + esc(u.by) + '">' + esc(when(u.at)) + '</td></tr>';
    });
    return table([['#', 'num'], ['ชื่อ'], ['อีเมล'], ['สิทธิ์'], ['ใช้งาน'], ['เข้าล่าสุด'], ['แก้ล่าสุด']], [add].concat(rows));
  }

  function renderOpen() {
    if (!OPEN) {
      return '<div class="tx-empty">วางไฟล์ <b>ตั้งต้นสมุด</b> จากหน้านับสต๊อกใหญ่ (ชีต ยอดตั้งต้น) ตรงนี้<br>ระบบอ่านให้ดูก่อน ยังไม่ลงจนกว่าจะกดปุ่ม</div>';
    }
    if (SHOW === 'bad' && OPEN.bad.length) {
      return table([['#', 'num'], ['แถวในไฟล์', 'num'], ['SKU'], ['โล'], ['เหตุผล']], OPEN.bad.map(function (b, i) {
        return '<tr class="r-bad"><td class="c-no num">' + (i + 1) + '</td><td class="num">' + b.n + '</td><td class="c-sku">' + esc(b.sku) + '</td>' +
          '<td>' + esc(b.loc) + '</td><td class="c-red">' + esc(b.why) + '</td></tr>';
      }));
    }
    return table([['#', 'num'], ['โล'], ['SKU'], ['ชื่อสินค้า'], ['LOT'], ['PO'], ['ชิ้น', 'num'], ['Status'], ['วันรับ']], OPEN.rows.map(function (r, i) {
      return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(r[5]) + '</td><td class="c-sku">' + esc(r[0]) + '</td>' +
        '<td class="c-nm" title="' + esc(r[2]) + '">' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td class="c-sub">' + esc(r[4]) + '</td>' +
        '<td class="num">' + f(r[6]) + '</td><td>' + (r[7] ? '<span class="g-open">เปิด</span>' : '') + '</td><td class="c-sub">' + esc(r[8] || r[9]) + '</td></tr>';
    }));
  }

  function renderCheck() {
    var html = '';
    if (CHECK && CHECK.diff && CHECK.diff.length) {
      html += '<div class="bk-dh"><b>กองที่ยอดในเครื่องไม่ตรงกับเอกสาร</b> ซ่อมแล้ว ใช้ยอดที่คิดจากเอกสาร</div>' +
        table([['#', 'num'], ['โล'], ['SKU'], ['LOT'], ['PO'], ['คิดจากเอกสาร', 'num'], ['ในเครื่องเดิม', 'num']], CHECK.diff.map(function (d, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(d[0]) + '</td><td class="c-sku">' + esc(d[1]) + '</td><td>' + esc(d[2]) + '</td>' +
            '<td class="c-sub">' + esc(d[3]) + '</td><td class="num">' + f(d[4]) + '</td><td class="num c-red">' + f(d[5]) + '</td></tr>';
        }));
    }
    if (CHECK && CHECK.negList && CHECK.negList.length) {
      html += '<div class="bk-dh s-gap"><b>กองติดลบ</b> ' + f(CHECK.neg) + ' กอง ให้หัวหน้าปรับยอดหรือหาเอกสารที่ลงผิด</div>' +
        table([['#', 'num'], ['โล'], ['SKU'], ['LOT'], ['PO'], ['ยอด', 'num']], CHECK.negList.map(function (p, i) {
          return '<tr><td class="c-no num">' + (i + 1) + '</td><td>' + esc(p[0]) + '</td><td class="c-sku">' + esc(p[1]) + '</td><td>' + esc(p[2]) + '</td>' +
            '<td class="c-sub">' + esc(p[3]) + '</td><td class="num c-red">' + f(p[4]) + '</td></tr>';
        }));
    }
    return html || '<div class="tx-empty">' + (head() ? 'กด <b>ตรวจยอดตอนนี้</b> เพื่อคิดยอดใหม่จากเอกสารทุกใบในเครื่องนี้' : 'สำเนาเครื่องนี้ดึงเฉพาะเอกสารใหม่ทุกนาที ถ้าสงสัยว่ายอดไม่ตรงกับเครื่องอื่น กด โหลดสำเนาเครื่องนี้ใหม่ทั้งหมด') + '</div>';
  }

  function renderXfer() {
    if (!XFER) return BUSY ? '' : '<div class="tx-empty">กด 🔄 เพื่อโหลด</div>';
    if (!XFER.length) return '<div class="tx-empty">ยังไม่มีเอกสารหลังยอดยกมา</div>';
    var dis = BUSY ? ' disabled' : '';
    return table([['วันที่บันทึก'], ['เอกสาร', 'num'], ['แถว', 'num'], ['เลขที่'], ['วางแล้ว'], ['', 'c-act']], XFER.map(function (d) {
      var st = d.done ? '✓ ' + esc(d.done.by) + ' · ' + esc(when(d.done.at)) + (d.more ? ' <span class="c-warn">มีเอกสารเพิ่มหลังวาง</span>' : '') : '<span class="c-warn">ยังไม่วาง</span>';
      var todo = !d.done || d.more;
      return '<tr' + (todo ? '' : ' class="r-off"') + '><td>' + esc(d.day) + '</td><td class="num">' + f(d.docs) + '</td><td class="num">' + f(d.rows) + '</td>' +
        '<td class="c-sub">' + esc(d.first) + (d.last !== d.first ? ' – ' + esc(d.last) : '') + '</td><td>' + st + '</td>' +
        '<td style="white-space:nowrap"><button class="bk-btn" data-xcopy="' + esc(d.day) + '"' + dis + '>📋 คัดลอก' + (d.more ? 'ส่วนที่เพิ่ม' : '') + '</button> ' +
        (todo ? '<button class="bk-btn" data-xmark="' + esc(d.day) + '"' + dis + '>✓ วางแล้ว</button>' : '') + '</td></tr>';
    }));
  }

  function renderBackup() {
    var rows = [['เอกสารทุกใบ (รวมส่วนแยกของเอกสารใหญ่)', 'docs/…'], ['ตัวนับเลขเอกสาร ยอดยกมาล่าสุด', 'meta/head'], ['รายชื่อคนใช้และสิทธิ์', 'users/…'],
      ['ตารางหลัก PO → Supplier แปลงสินค้า', 'master/…'], ['ยอด TRcloud ล่าสุด', 'trc/…'], ['บันทึกการวางชีตเดิม', 'xfer/log']];
    return table([['ในไฟล์สำรอง'], ['ที่เก็บ']], rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="c-sub">' + r[1] + '</td></tr>'; })) +
      '<div class="tx-empty">ไม่มีตัวนับโควตา (use/…) ในไฟล์สำรอง · ไฟล์นี้ไม่มีรหัสผ่านหรือคีย์ แต่มีรายชื่อและยอดสต๊อกทั้งหมด เก็บในที่ที่คนนอกเข้าไม่ได้</div>';
  }

  function size(b) { return b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB'; }
  function renderArch() {
    if (!ARCH) return BUSY ? '' : '<div class="tx-empty">กด 🔄 เพื่อโหลด</div>';
    if (!ARCH.months.length) return '<div class="tx-empty">ยังไม่เคยปิดเดือน' + (ARCH.next.m ? ' · กดปุ่มด้านบนเพื่อปิดเดือน ' + esc(ARCH.next.label) : '') + '</div>';
    return table([['เดือน'], ['เอกสาร', 'num'], ['ลำดับ'], ['ก้อน', 'num'], ['ขนาด', 'num'], ['ใหญ่เกินก้อน', 'num'], ['ปิดเมื่อ'], ['โดย']], ARCH.months.slice().reverse().map(function (m) {
      return '<tr><td><b>' + esc(m.label) + '</b></td><td class="num">' + f(m.docs) + '</td><td class="c-sub">' + f(m.from) + ' – ' + f(m.to) + '</td>' +
        '<td class="num">' + f(m.n) + '</td><td class="num">' + size(m.bytes || 0) + '</td>' +
        '<td class="num' + (m.skip ? '' : ' c-sub') + '" title="เอกสารใหญ่เกินก้อนเดียว เครื่องใหม่อ่านทีละเอกสาร">' + f(m.skip) + '</td>' +
        '<td>' + esc(when(m.at)) + '</td><td>' + esc(m.by || '') + '</td></tr>';
    }));
  }

  function bar(v, max) {
    var p = max ? Math.min(1, v / max) : 0;
    return '<span class="fs-bar"><i class="' + (p > 0.85 ? 'r' : p > 0.6 ? 'w' : '') + '" style="width:' + Math.max(p * 100, v ? 2 : 0).toFixed(1) + '%"></i></span>';
  }
  function renderQuota() {
    if (!Q) return BUSY ? '' : '<div class="tx-empty">กด 🔄 เพื่อนับ</div>';
    var L = Q.limits, wrap = ' style="white-space:normal"';
    var cell = function (v, max) { return '<td class="num">' + bar(v, max) + f(v) + '</td>'; };
    var rows = ['<tr><td' + wrap + '><b>เครื่องนี้</b></td>' + cell(Q.reads, L.reads) + cell(Q.writes, L.writes) + '</tr>'];
    if (Q.all) {
      rows.push('<tr><td' + wrap + '><b>ทุกเครื่องที่ส่งยอด</b> <span class="c-sub">' + f(Q.all.list.length) + ' เครื่อง</span></td>' + cell(Q.all.reads, L.reads) + cell(Q.all.writes, L.writes) + '</tr>');
      Q.all.list.forEach(function (d) {
        rows.push('<tr><td class="c-sub"' + wrap + '>· ' + esc(d.by || d.dev) + (d.me ? ' (เครื่องนี้)' : '') + '</td><td class="num c-sub">' + f(d.r) + '</td><td class="num c-sub">' + f(d.w) + '</td></tr>');
      });
    }
    rows.push('<tr><td class="c-sub"' + wrap + '>เอกสารที่บันทึกวันนี้ทั้งระบบ ' + f(Q.docs) + ' ชุด</td><td class="num c-sub">—</td><td class="num c-sub">' + f(Q.docWrites) + '</td></tr>');
    return table([['วันนี้'], ['อ่าน / ' + f(L.reads), 'num'], ['เขียน / ' + f(L.writes), 'num']], rows);
  }

  function renderBody() {
    var s = sec();
    $('body').innerHTML = s === 'users' ? renderUsers() : s === 'open' ? renderOpen() : s === 'check' ? renderCheck()
      : s === 'xfer' ? renderXfer() : s === 'backup' ? renderBackup() : s === 'arch' ? renderArch() : renderQuota();
  }

  function render() {
    renderIn();
    renderSum();
    renderAct();
    renderBody();
    need();
  }

  /* ── คนใช้ ── */

  async function saveUser(email, patch, revert) {
    var u = (USERS || []).filter(function (x) { return x.email === email; })[0];
    if (!u) return;
    var data = { name: u.name, role: u.role, active: u.active };
    Object.keys(patch).forEach(function (k) { data[k] = patch[k]; });
    BUSY = 'กำลังบันทึก…'; NOTE = null; renderAll();
    var r = await FIRE.saveUser(email, data);
    BUSY = '';
    if (r.error) {
      NOTE = { kind: 'bad', html: 'บันทึกไม่ได้: ' + esc(r.error) };
      if (revert) revert();
    } else {
      Object.keys(r.user).forEach(function (k) { if (r.user[k] !== undefined && r.user[k] !== null) u[k] = r.user[k]; });
      NOTE = { kind: 'ok', html: 'บันทึก <b>' + esc(u.name) + '</b> แล้ว · ' + ROLE_TH[u.role] + (u.active ? '' : ' · ปิดแล้ว เข้าระบบไม่ได้') };
    }
    renderAll();
  }

  async function addUser() {
    ADD.name = $('fsAddName').value.trim();
    ADD.email = $('fsAddMail').value.trim().toLowerCase();
    ADD.role = $('fsAddRole').value;
    if (!ADD.name || !ADD.email) { NOTE = { kind: 'bad', html: 'ใส่ชื่อและอีเมลก่อน' }; renderAll(); return; }
    BUSY = 'กำลังเพิ่ม…'; NOTE = null; renderAll();
    var r = await FIRE.saveUser(ADD.email, { name: ADD.name, role: ADD.role, active: true, add: true });
    BUSY = '';
    if (r.error) { NOTE = { kind: 'bad', html: 'เพิ่มไม่ได้: ' + esc(r.error) }; renderAll(); return; }
    NOTE = { kind: 'ok', html: 'เพิ่ม <b>' + esc(r.user.name) + '</b> (' + esc(r.user.email) + ') เป็น' + ROLE_TH[r.user.role] + 'แล้ว · เข้าด้วย Google ของบริษัทได้เลย' };
    ADD = { name: '', email: '', role: ADD.role };
    USERS_FOR = '';
    await loadUsers();
  }

  /* ── ยอดยกมา ── */

  function useGrid(grid, name) {
    var p = C().openingFromSheet(grid);
    if (p.error) { NOTE = { kind: 'bad', html: esc(name) + ': ' + esc(p.error) }; OPEN = null; renderAll(); return false; }
    p.name = name;
    p.batch = WmsBook.uuid();
    OPEN = p;
    SHOW = p.bad.length ? 'bad' : 'rows';
    NOTE = null;
    renderAll();
    return true;
  }

  async function readFile(file) {
    try {
      var X = await xlsxLib();
      var wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      var tabs = wb.SheetNames.slice().sort(function (a, b) { return (b === 'ยอดตั้งต้น') - (a === 'ยอดตั้งต้น'); });
      var why = '';
      for (var i = 0; i < tabs.length; i++) {
        var grid = X.utils.sheet_to_json(wb.Sheets[tabs[i]], { header: 1, defval: '', raw: true });
        var p = C().openingFromSheet(grid);
        if (p.error) { why = why || p.error; continue; }
        return useGrid(grid, file.name + (tabs.length > 1 ? ' · ชีต ' + tabs[i] : ''));
      }
      NOTE = { kind: 'bad', html: 'อ่าน <b>' + esc(file.name) + '</b> ไม่ได้: ' + esc(why || 'ไฟล์ว่าง') };
    } catch (e) {
      NOTE = { kind: 'bad', html: 'อ่าน <b>' + esc(file.name) + '</b> ไม่ได้: ' + esc(e.message) };
    }
    renderAll();
  }

  async function putOpen() {
    if (!OPEN || BKBUSY || OPEN.bad.length) return;
    var op = BSTATE && BSTATE.open;
    var t = OPEN.tot;
    var msg = (op ? 'ลงยอดยกมาใหม่ แทน ' + op.doc + ' (ชุดเดิมเป็นยกเลิก)\n\n' : '') +
      'ลงยอดยกมา ' + f(t.piles) + ' กอง ' + f(t.qty) + ' ชิ้น · ' + f(t.skus) + ' SKU\nจาก ' + OPEN.name + '?';
    if (!confirm(msg)) return;
    BKBUSY = 'กำลังลงยอดยกมา…'; NOTE = null; renderAll();
    var r;
    try { r = await bookPost('bk-open', { batch: OPEN.batch, replace: !!op, rows: OPEN.rows }); }
    catch (e) { r = { error: e.message }; }
    BKBUSY = '';
    if (r.error) {
      var bad = (r.bad || []).slice(0, 8).map(function (b) { return '<li>กอง ' + b.n + ' ' + esc(b.sku) + ' ' + esc(b.loc) + ': ' + esc(b.why) + '</li>'; });
      NOTE = { kind: 'bad', html: 'ลงยอดยกมาไม่สำเร็จ: ' + esc(r.error) + (bad.length ? '<ol>' + bad.join('') + '</ol>' : '') };
      renderAll();
      return;
    }
    OPEN = null;
    await refreshState();
    await refreshDocs();   // ตารางชุดที่บันทึก: ยอดยกมาใหม่ ชุดเดิมเป็นยกเลิก
    var c = await bookPost('bk-rebuild', {});
    CHECK = c.error ? null : c;
    CHECK_AT = Date.now();
    NOTE = { kind: 'ok', html: '✅ ลงยอดยกมา <b>' + esc(r.doc) + '</b> แล้ว ' + f(r.rows) + ' กอง ' + f(r.qty) + ' ชิ้น' +
      (r.replaced && r.replaced.length ? ' (แทน ' + esc(r.replaced.join(', ')) + ')' : '') +
      (c.error ? '' : c.same ? ' · ตรวจยอด ✓ ตรงทุกกอง' : ' · ตรวจยอดไม่ตรง ดูแท็บตรวจยอด') };
    renderAll();
  }

  /* ── ตรวจยอด ── */

  async function check() {
    BUSY = 'กำลังตรวจยอด…'; NOTE = null; renderAll();
    var r = await bookPost('bk-rebuild', {});
    BUSY = '';
    if (r.error) { NOTE = { kind: 'bad', html: 'ตรวจยอดไม่ได้: ' + esc(r.error) }; renderAll(); return; }
    CHECK = r;
    CHECK_AT = Date.now();
    if (r.fixed) {
      RES = FIRE.fifoNow();
      compute();
    }
    NOTE = r.same && !r.neg ? { kind: 'ok', html: '✓ ตรงทุกกอง ' + f(r.piles) + ' กอง (คิดจาก ' + f(r.rows) + ' แถว)' }
      : r.same ? { kind: 'warn', html: '✓ ยอดในเครื่องตรงกับเอกสาร แต่มี <b>กองติดลบ ' + f(r.neg) + ' กอง</b> ดูตารางด้านล่าง' }
      : { kind: 'warn', html: 'ยอดในเครื่องไม่ตรงกับเอกสาร <b>' + f(r.diffCount) + ' กอง</b> ซ่อมจากเอกสารแล้ว ถ้าเกิดซ้ำ กด โหลดสำเนาเครื่องนี้ใหม่ทั้งหมด' };
    renderAll();
  }

  async function reload() {
    var cp = FIRE.copy();
    if (!confirm('ล้างสำเนาในเครื่องนี้แล้วดึงเอกสารทุกใบใหม่?\nอ่านประมาณ ' + f(cp ? cp.docs + 1 : 0) + ' ครั้ง (โควตาวันละ 50,000)')) return;
    BUSY = 'กำลังโหลดใหม่ทั้งหมด…'; NOTE = null; renderAll();
    try {
      RES = await FIRE.reload();
      compute();
      var n = FIRE.copy();
      NOTE = { kind: 'ok', html: 'โหลดใหม่แล้ว ' + f(n.docs) + ' เอกสาร · ' + f(n.piles) + ' กอง' };
    } catch (e) {
      NOTE = { kind: 'bad', html: 'โหลดใหม่ไม่ได้: ' + esc(e.message) };
    }
    BUSY = '';
    Q = null;
    renderAll();
  }

  /* ── ชีตเดิม ── */

  async function copyDay(day) {
    var d = (XFER || []).filter(function (x) { return x.day === day; })[0];
    if (!d) return;
    var t = FIRE.xferText(day, d.more ? d.done.last : '');
    if (!t.text) { NOTE = { kind: 'warn', html: 'ไม่มีแถวที่ต้องวาง' }; renderAll(); return; }
    var ok = await copyText(t.text);
    NOTE = ok ? { kind: 'ok', html: '📋 คัดลอก ' + f(t.rows) + ' แถว (' + f(t.docs) + ' เอกสาร ถึง ' + esc(t.last) + ') ของวันที่ ' + esc(day) + ' แล้ว · วางที่แถวว่างแรกของชีต Transaction คอลัมน์ A แล้วกด ✓ วางแล้ว' }
      : { kind: 'bad', html: 'คัดลอกไม่ได้ เบราว์เซอร์ไม่ให้เข้าคลิปบอร์ด' };
    renderAll();
  }

  async function markDay(day) {
    var d = (XFER || []).filter(function (x) { return x.day === day; })[0];
    if (!d) return;
    var older = XFER.filter(function (x) { return x.day < day && !x.done; });
    if (older.length && !confirm('ยังไม่ได้วางวันที่ ' + older.map(function (x) { return x.day; }).reverse().join(', ') + '\nแถวในชีตเดิมควรเรียงตามวัน ยืนยันว่าวางวันที่ ' + day + ' แล้ว?')) return;
    BUSY = 'กำลังบันทึก…'; NOTE = null; renderAll();
    var r = await FIRE.xferMark(day, { rows: d.rows, last: d.last });
    BUSY = '';
    NOTE = r.error ? { kind: 'bad', html: 'บันทึกไม่ได้: ' + esc(r.error) } : { kind: 'ok', html: '✓ วันที่ ' + esc(day) + ' วางลงชีตเดิมแล้ว' };
    XFER = null;
    await loadXfer();
  }

  /* ── สำรอง ── */

  async function downloadBackup() {
    BUSY = 'กำลังทำไฟล์สำรอง…'; NOTE = null; renderAll();
    var r = await FIRE.backup();
    BUSY = '';
    if (r.error) { NOTE = { kind: 'bad', html: 'ทำไฟล์สำรองไม่ได้: ' + esc(r.error) }; renderAll(); return; }
    var b = r.backup, d = new Date(b.made);
    var name = 'wms-fire-backup-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.json';
    var url = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    NOTE = { kind: 'ok', html: '⬇ ดาวน์โหลด <b>' + esc(name) + '</b> แล้ว · ' + f(b.docs) + ' เอกสาร · ' + f(Object.keys(b.data).length) + ' รายการในไฟล์' };
    renderAll();
  }

  async function restoreFile(file) {
    var text;
    try { text = await file.text(); } catch (e) { NOTE = { kind: 'bad', html: 'อ่านไฟล์ไม่ได้' }; renderAll(); return; }
    var chk = window.WmsFireTrc.readBackup(text);
    if (chk.error) { NOTE = { kind: 'bad', html: esc(file.name) + ': ' + esc(chk.error) }; renderAll(); return; }
    if (!confirm('ล้างฐานทดลองทั้งหมดแล้วใส่ข้อมูลจาก ' + file.name + ' แทน?\n' + f(chk.backup.docs || 0) + ' เอกสาร · ต้องเข้าระบบใหม่')) return;
    var r = await FIRE.restoreDev(text);
    if (r.error) { NOTE = { kind: 'bad', html: 'กู้คืนไม่ได้: ' + esc(r.error) }; renderAll(); return; }
    location.reload();
  }

  /* ── ปิดเดือน ── */

  async function closeArch() {
    var nx = ARCH && ARCH.next;
    if (!nx || !nx.m) return;
    if (!confirm('ปิดเดือน ' + nx.label + '?\nรวม ' + f(nx.docs) + ' เอกสาร (ลำดับ ' + f(nx.from) + ' – ' + f(nx.to) + ') เป็นก้อน\nไม่แก้ ไม่ลบเอกสารเดิม · ปิดแล้วย้อนไม่ได้ แต่ไม่กระทบยอด')) return;
    BUSY = 'กำลังปิดเดือน ' + nx.label + '…'; NOTE = null; renderAll();
    var r = await FIRE.archClose();
    BUSY = '';
    if (r.error) NOTE = { kind: 'bad', html: 'ปิดเดือนไม่ได้: ' + esc(r.error) + (r.net ? ' · เน็ตหลุด กดปิดเดือนใหม่ได้' : '') };
    else {
      NOTE = { kind: 'ok', html: '✓ ปิดเดือน <b>' + esc(r.label) + '</b> แล้ว · ' + f(r.docs) + ' เอกสาร → ' + f(r.chunks) + ' ก้อน (' + size(r.bytes) + ')' +
        (r.skip ? ' · ใหญ่เกินก้อน ' + f(r.skip) + ' เอกสาร' : '') };
      ARCH = r.sum; ARCH_AT = Date.now();
    }
    renderAll();
  }

  /* ── ปุ่มและช่อง (ทำงานเฉพาะแท็บตั้งค่าของระบบใหม่) ── */

  function active() { return typeof MODE !== 'undefined' && (MODE === 'set' || MODE === 'close') && window.BookFire && USER; }

  document.addEventListener('click', function (e) {
    if (!active()) return;
    var t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.fsec) setSec(t.dataset.fsec);
    else if (t.dataset.fshow) { SHOW = t.dataset.fshow; renderSum(); renderBody(); }
    else if (t.id === 'fsRefresh') {
      NOTE = null;
      if (sec() === 'users') USERS_FOR = '';
      if (sec() === 'quota') Q = null;
      if (sec() === 'xfer') XFER = null;
      if (sec() === 'arch') ARCH = null;
      refreshState().then(renderAll);
    }
    else if (t.id === 'fsAdd') addUser();
    else if (t.id === 'fsPick') $('fsFile').click();
    else if (t.id === 'fsOpen') putOpen();
    else if (t.id === 'fsOpenX') { OPEN = null; NOTE = null; renderAll(); }
    else if (t.id === 'fsCheck') check();
    else if (t.id === 'fsReload') reload();
    else if (t.dataset.xcopy) copyDay(t.dataset.xcopy);
    else if (t.dataset.xmark) markDay(t.dataset.xmark);
    else if (t.id === 'fsBackup') downloadBackup();
    else if (t.id === 'fsArch') closeArch();
    else if (t.id === 'fsRestore') $('fsRestoreFile').click();
  });

  document.addEventListener('change', function (e) {
    if (!active()) return;
    var el = e.target;
    if (el.id === 'fsFile' && el.files.length) { readFile(el.files[0]); el.value = ''; return; }
    if (el.id === 'fsRestoreFile' && el.files.length) { restoreFile(el.files[0]); el.value = ''; return; }
    var email = el.dataset && el.dataset.u, k = el.dataset && el.dataset.k;
    if (!email || !k) return;
    if (k === 'name') {
      var v = el.value.trim();
      if (!v) { NOTE = { kind: 'bad', html: 'ชื่อว่างไม่ได้' }; renderAll(); return; }
      saveUser(email, { name: v });
    } else if (k === 'role') {
      saveUser(email, { role: el.value });
    } else if (k === 'active') {
      if (!el.checked && !confirm('ปิดบัญชี ' + email + '?\nเข้าระบบไม่ได้จนกว่าจะเปิดอีกครั้ง ชื่อในเอกสารเก่ายังอยู่')) { el.checked = true; return; }
      saveUser(email, { active: el.checked }, function () { el.checked = !el.checked; });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (!active() || e.key !== 'Enter') return;
    if (e.target.id === 'fsAddName' || e.target.id === 'fsAddMail') { e.preventDefault(); addUser(); }
    else if (e.target.dataset && e.target.dataset.k === 'name') e.target.blur();
  });

  window.BookFireSet = {
    render: render,
    /** เปิดส่วนของเมนูนั้นไว้ก่อนสลับหน้า (การ์ดในหน้าวันนี้) g = set | close */
    pick: function (g, s) { if (KEYS[g] && secs(g).some(function (x) { return x[0] === s; })) { keepSec(g, s); NOTE = null; } },
    /** เปิดแท็บ (หลังอ่านสถานะใหม่): โหลดส่วนที่ต้องใช้ */
    opened: function () { if (sec() === 'quota') Q = null; need(); },
    /** Ctrl+V ในแท็บตั้งค่า = ตารางยอดตั้งต้น (หัวหน้า) */
    paste: function (text) {
      if (!head()) return;
      if (sec() !== 'open') keepSec('set', 'open');
      var now = new Date();
      useGrid(WmsBook.gridOf(text), 'วางจากคลิปบอร์ด ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'));
    },
    /** ลากไฟล์มาวางในแท็บตั้งค่า = ไฟล์ยอดตั้งต้น (หัวหน้า) */
    files: function (list) {
      if (!head() || !list.length) return;
      if (sec() !== 'open') keepSec('set', 'open');
      readFile(list[0]);
    },
  };
})();
