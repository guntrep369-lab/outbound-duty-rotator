/**
 * @file wms-fire-docs.js — ระบบใหม่: หน้า วันนี้ กับหน้า เอกสาร ของแอปสมุดสต๊อก
 *
 * คิดจากสำเนาในเครื่องทั้งหมด ไม่อ่านฐานเพิ่ม (ไม่กินโควตา)
 *   index(local)              ทุกเอกสาร ใหม่สุดก่อน + สถานะ (TRcloud · ยกเลิกแล้ว · ใบกลับรายการ) + ข้อความไว้ค้น
 *   search(list, q, now)      ค้นด้วย เลขที่ SKU โล LOT PO ออเดอร์ เลขอ้างอิง เลขพัสดุ เลข TRcloud ชื่อคนลง Note
 *                             กรองประเภท สถานะ ช่วงวัน · นับต่อประเภท / สถานะให้ชิปบนหน้า
 *   view(local, no)           เอกสารใบเดียว: หัว แถว ออเดอร์ ขั้นตอน ประวัติ ใบเดิม ↔ ใบกลับรายการ
 *   home(local, now, user)    งานวันนี้: ใบที่บันทึกวันนี้ต่อประเภท ของฉัน รอลง TRcloud รอรับ / รอตรวจ / อนุมัติ ใบล่าสุด
 *   queue(local, now, user)   งานของฉันทีละใบ: ต้องทำ · รอคนอื่น · ที่ฉันทำเสร็จวันนี้
 *   okCan(v, user)            ปุ่มรับ / ไม่รับ / ตรวจ / อนุมัติของคนนี้ บนเอกสารใบนี้ (ตรงกับ okSet ใน wms-fire-core.js)
 * ใบโอน QA (xf) ใช้ขั้นตรวจเป็น รับ: รอรับ → รับแล้ว → อนุมัติ → TRcloud
 * เปิดเป็น window.WmsFireDocs ต้องโหลด wms-fire-core.js กับ wms-fire-trc.js ก่อน
 */
(function () {
  'use strict';

  var LIST_MAX = 300;     // แถวที่ส่งให้หน้าวาดต่อครั้ง
  var LAST_MAX = 8;       // ใบล่าสุดบนหน้าวันนี้
  var QUEUE_MAX = 100;    // แถวต่อตัวกรองของงานของฉัน
  var FIRST_MAX = 200;    // ใบรออนุมัติที่เช็คใบเข้าก่อนให้ (มีเป็นพันเครื่องไม่ค้าง)
  var RANGES = { today: 0, d7: 6, d30: 29 };
  var ST_TH = { wait: 'รอลง TRcloud', done: 'ลง TRcloud แล้ว', none: 'ไม่ต้องลง TRcloud' };
  var OK_TH = { check: 'รอตรวจ', approve: 'รออนุมัติ', done: 'อนุมัติแล้ว', reject: 'ไม่รับ' };
  var TAKE_HINT = {
    in: 'ทีม QA หรือหัวหน้า นับของจริงแล้วกด รับ · ก่อนรับ โอนออกไม่ได้',
    out: 'คลัง / Inbound หรือหัวหน้า นับของจริงแล้วกด รับ · ก่อนรับ ขายหรือย้ายต่อไม่ได้',
    qa: 'ทีม QA อีกคนหรือหัวหน้า นับของจริงแล้วกด รับ · ก่อนรับ ใช้ต่อไม่ได้',
  };
  function okTh(ok, xf) { return ok === 'check' && xf ? 'รอรับ' : OK_TH[ok] || ''; }
  /* สิ่งที่ต้องทำใน TRcloud ต่อประเภท (ใบกลับรายการดูจากใบเดิม) */
  var NEED = {
    'รับของ': 'สร้าง GR ใน TRcloud แล้วใส่เลข', 'แปลง': 'สร้าง MR + GR ใน TRcloud แล้วใส่เลข', 'คืน': 'สร้างรับคืนใน TRcloud แล้วใส่เลข',
    'ย้าย': 'ออกไฟล์ปรับยอดที่หน้า TRcloud ลงแล้วใส่เลข', 'ปรับยอด': 'ออกไฟล์ปรับยอดที่หน้า TRcloud ลงแล้วใส่เลข',
    'ตารางเดิม': 'ออกไฟล์ปรับยอดที่หน้า TRcloud ลงแล้วใส่เลข',
  };

  function C() { return window.WmsFireCore; }
  function T() { return window.WmsFireTrc; }
  function lc(v) { return String(v === null || v === undefined ? '' : v).toLowerCase(); }
  function byNo(local) { var m = {}; (local.docs || []).forEach(function (d) { m[d.no] = d; }); return m; }
  function orderCount(d) {
    var seen = {}, n = 0;
    (d.lines || []).forEach(function (l) { var k = (l.sys || '') + '|' + (l.order || l.ref || l.track || ''); if (k !== '|' && !seen[k]) { seen[k] = 1; n++; } });
    return n;
  }
  /** เวลาเซิร์ฟเวอร์ (ms) → 'yyyy-mm-dd HH:MM:SS' เวลาไทย แบบช่อง stamp · 0 = '' */
  function stampOf(ms) { return typeof ms === 'number' && ms > 0 ? C().stamp(ms) : ''; }

  var AUDIT_OLD = 5 * 3600000;   // ตัวตรวจรันทุกราว 2 ชม. เงียบเกินนี้ = หยุด
  /**
   * การ์ดผลตรวจแถวของหัวหน้า (audit/last จาก fire-backup.gs) → { tone, title, sub, n? } | null
   * o = { audit, error, open มียอดยกมาแล้ว, now, practice ฐานทดลอง / ซ้อม ไม่มีสคริปต์ จึงไม่เตือนให้ติดตั้ง }
   */
  function auditCard(o) {
    var a = o.audit, at = a ? +a.at || 0 : 0, old = !!a && o.now - at > AUDIT_OLD;
    var st = stampOf(at), when = st ? st.slice(8, 10) + '/' + st.slice(5, 7) + ' ' + st.slice(11, 16) : '';
    if (a && +a.n > 0) {
      return { tone: 'bad', n: +a.n, title: 'พบเอกสารผิดกติกา',
        sub: 'เช็คของจริง แล้วยกเลิกใบหรือปรับยอด · ตรวจเมื่อ ' + when + (old ? ' (ตัวตรวจหยุดหลังจากนั้น)' : '') };
    }
    if (!o.open || o.practice) return null;
    if (o.error) return { tone: 'warn', title: 'อ่านผลตรวจเสกยอดไม่ได้', sub: 'เช็คเน็ต และ Firestore Rules ชุดล่าสุด (คู่มือข้อ 1.3)' };
    if (!a) return { tone: 'warn', title: 'ยังไม่ตั้งตัวตรวจเสกยอด', sub: 'เจ้าของสคริปต์เรียกใช้ installAudit ใน fire-backup.gs (คู่มือข้อ 1.10)' };
    if (old) return { tone: 'warn', title: 'ตัวตรวจเสกยอดหยุด', sub: 'ตรวจล่าสุด ' + when + ' · เช็คบันทึกการดำเนินการของ fire-backup.gs' };
    if (a.more) return { tone: 'info', title: 'ตัวตรวจเสกยอดยังตรวจไม่ครบ', sub: 'ตรวจต่อเองรอบถัดไป (ทุกราว 2 ชั่วโมง)' };
    return null;
  }

  /** สรุปหนึ่งใบสำหรับตาราง (ไม่มีข้อความค้น) */
  function brief(d, vd, st, by) {
    var v = vd[d.no] || null;
    return {
      no: d.no, id: d.id, seq: d.seq, type: d.type, date: d.date, stamp: d.stamp, name: d.name, by: d.by,
      rows: d.rows.length, qty: d.qty, orders: orderCount(d), tr: d.tr || '', state: st[d.no] || 'none',
      voided: v ? { by: v.voidBy, at: v.voidAt, why: v.why, link: v.link } : null,
      link: d.type === C().TYPE_REV ? d.link : '',
      ok: C().okState(d, vd), ck: d.ckName || '', ap: d.apName || '',
      xf: C().xfKind(d), rj: d.rjName || '', rjWhy: d.rjWhy || '', lock: T().trLocked(d, by),
    };
  }

  /** คำที่ใช้ค้นของเอกสาร ไม่ซ้ำ ตัวเล็ก */
  function words(d) {
    var seen = {}, out = [];
    function add(v) { var s = lc(v).trim(); if (s && !seen[s]) { seen[s] = 1; out.push(s); } }
    [d.no, d.type, d.name, d.by, d.tr, d.date, d.ref, d.link, d.why, d.ckName, d.apName, d.rjName, d.rjWhy].forEach(add);
    (d.trLog || []).forEach(function (e) { add(e.tr); });
    var xf = C().xfKind(d);
    if (xf) add(C().XF_TH[xf]);
    d.rows.forEach(function (r) { add(r[0]); add(r[1]); add(r[2]); add(r[3]); add(r[4]); add(r[5]); add(r[8]); add(r[10]); });
    (d.lines || []).forEach(function (l) { add(l.order); add(l.ref); add(l.track); add(l.sku); });
    Object.keys(d.names || {}).forEach(function (k) { add(d.names[k]); });
    return out.join(' ');
  }

  /** ทุกเอกสาร ใหม่สุดก่อน [{...brief, text}] */
  function index(local) {
    var vd = C().voids(local), st = T().trStates(local), by = byNo(local);
    return (local.docs || []).slice().sort(function (a, b) { return b.seq - a.seq; }).map(function (d) {
      var x = brief(d, vd, st, by);
      x.text = words(d);
      return x;
    });
  }

  /** ช่วงวัน → [ตั้งแต่, ถึง] ('' = ไม่จำกัด) · month = ตั้งแต่วันที่ 1 ของเดือนนี้ */
  function rangeOf(range, now) {
    var c = C(), day = c.today(now);
    if (range === 'month') return [day.slice(0, 8) + '01', day];
    if (RANGES[range] === undefined) return ['', ''];
    var from = new Date((c.dayNo(day) - RANGES[range]) * 86400000);
    return [from.getUTCFullYear() + '-' + String(from.getUTCMonth() + 1).padStart(2, '0') + '-' + String(from.getUTCDate()).padStart(2, '0'), day];
  }

  /** ตรงสถานะไหม: wait รอลง TRcloud (ใส่เลขได้แล้ว) · recv รอรับ · check รอตรวจ · approve รออนุมัติ · todo สามอย่างนี้รวมกัน · reject ไม่รับ · void ยกเลิกแล้ว · mine ของฉัน */
  function stOk(x, status, email) {
    if (!status) return true;
    if (status === 'wait') return x.state === 'wait' && !x.lock;
    if (status === 'todo') return x.ok === 'check' || x.ok === 'approve';
    if (status === 'recv') return x.ok === 'check' && !!x.xf;
    if (status === 'check') return x.ok === 'check' && !x.xf;
    if (status === 'approve' || status === 'reject') return x.ok === status;
    if (status === 'void') return !!x.voided;
    if (status === 'mine') return !!email && x.by === email;
    return true;
  }

  /**
   * ค้นเอกสาร q = { text, type, status, range, email, max }
   * ทุกคำในช่องค้นต้องเจอ (ค้นทีละหลายคำได้ เช่น SKU กับโล) · ช่วงวันดูวันที่ของเอกสาร
   * → { list, total, types: {ประเภท: n}, states: {wait, recv, check, approve, reject, void, mine}, from, to }
   */
  function search(list, q, now) {
    q = q || {};
    var ws = lc(q.text).split(/\s+/).filter(Boolean);
    var r = rangeOf(q.range || 'all', now), from = r[0], to = r[1];
    var base = (list || []).filter(function (x) {
      if (from && (x.date < from || x.date > to)) return false;
      for (var i = 0; i < ws.length; i++) if (x.text.indexOf(ws[i]) < 0) return false;
      return true;
    });
    var types = {}, states = { wait: 0, recv: 0, check: 0, approve: 0, reject: 0, void: 0, mine: 0 };
    base.forEach(function (x) {
      if (stOk(x, q.status, q.email)) types[x.type] = (types[x.type] || 0) + 1;
      if (!q.type || x.type === q.type) {
        if (x.state === 'wait' && !x.lock) states.wait++;
        if (x.ok === 'check') { if (x.xf) states.recv++; else states.check++; }
        if (x.ok === 'approve') states.approve++;
        if (x.ok === 'reject') states.reject++;
        if (x.voided) states.void++;
        if (q.email && x.by === q.email) states.mine++;
      }
    });
    var out = base.filter(function (x) { return (!q.type || x.type === q.type) && stOk(x, q.status, q.email); });
    return { list: out.slice(0, q.max || LIST_MAX), total: out.length, all: base.length, types: types, states: states, from: from, to: to };
  }

  /**
   * เอกสารใบเดียว (null = ไม่มีในเครื่องนี้)
   * steps: บันทึก → รับ หรือ ตรวจ → อนุมัติ (ใบย้าย / แปลง) → TRcloud → ยกเลิก (ถ้ามี) · state = done | now | wait | skip | void
   * history: ใหม่สุดท้าย [{at, who, what, link}]
   */
  function view(local, no) {
    var c = C(), by = byNo(local), d = by[no];
    if (!d) return null;
    var vd = c.voids(local), st = T().trStates(local), x = brief(d, vd, st, by), xf = x.xf;
    var first = x.ok === c.OK_CHECK || x.ok === c.OK_APPROVE ? c.apFirst(local, d, vd) : '';
    var rev = d.type === c.TYPE_REV, open = d.type === c.TYPE_OPEN;
    var orig = rev && by[d.link] ? by[d.link] : null;
    var back = x.voided && x.voided.link && by[x.voided.link] ? by[x.voided.link] : null;
    var baseType = orig ? orig.type : d.type;
    var trAt = stampOf(d.trAt);

    var steps = [{ k: 'save', label: open ? 'ลงยอดยกมา' : rev ? 'ลงกลับ' : 'บันทึก', state: 'done', at: d.stamp, who: d.name }];
    var okNeed = c.OK_TYPES.indexOf(d.type) >= 0, ckAt = stampOf(d.ckAt), apAt = stampOf(d.apAt);
    if (okNeed) {
      steps.push(d.ck ? { k: 'check', label: xf ? 'รับแล้ว' : 'ตรวจแล้ว', state: 'done', at: ckAt, who: d.ckName }
        : d.rj ? { k: 'check', label: 'ไม่รับ', state: 'void', at: stampOf(d.okAt), who: d.rjName, why: d.rjWhy, hint: x.ok ? 'ของยังล็อก ให้หัวหน้ายกเลิกใบ แล้วทำใบใหม่' : '' }
        : x.ok ? { k: 'check', label: okTh(c.OK_CHECK, xf), state: 'now', hint: xf ? TAKE_HINT[xf] : 'คนอื่นที่ไม่ใช่คนทำ เช็คของจริงแล้วกด ตรวจแล้ว' }
        : { k: 'check', label: xf ? 'ไม่ได้รับ' : 'ไม่ได้ตรวจ', state: 'skip' });
      steps.push(d.ap ? { k: 'approve', label: 'อนุมัติแล้ว', state: 'done', at: apAt, who: d.apName }
        : x.ok === c.OK_APPROVE ? { k: 'approve', label: 'รออนุมัติ', state: 'now', hint: first ? 'อนุมัติใบเข้า ' + first + ' ก่อน' : 'หัวหน้ากด อนุมัติ' }
        : x.ok && !d.rj ? { k: 'approve', label: 'รออนุมัติ', state: 'wait' }
        : { k: 'approve', label: 'ไม่ได้อนุมัติ', state: 'skip' });
    }
    if (!open && d.type !== c.TYPE_SALE) {
      steps.push(x.state === 'wait' && x.lock ? { k: 'tr', label: 'ลง TRcloud หลังอนุมัติ', state: 'wait' }
        : x.state === 'wait' ? { k: 'tr', label: 'รอลง TRcloud', state: 'now', hint: NEED[baseType] || 'ลงใน TRcloud แล้วใส่เลข' }
        : x.state === 'done' ? { k: 'tr', label: 'ลง TRcloud แล้ว', state: 'done', at: trAt, who: d.trBy, tr: d.tr }
        : { k: 'tr', label: 'ไม่ต้องลง TRcloud', state: 'skip', at: trAt, who: d.trBy });
    }
    if (x.voided) steps.push({ k: 'void', label: 'ยกเลิกแล้ว', state: 'void', at: x.voided.at, who: x.voided.by, why: x.voided.why, link: x.voided.link });

    /* link = เลขที่ที่เกี่ยวข้อง (หน้าแอปทำเป็นปุ่ม ต่อท้ายด้วย linkTh) */
    var history = [{ at: d.stamp, who: d.name, what: (rev ? 'ลงกลับรายการ' + (d.why ? ' · ' + d.why : '') : 'บันทึก' + d.type) +
      ' · ' + d.rows.length + ' แถว ' + c.round3(d.qty) + ' ชิ้น', link: rev ? d.link : '', linkTh: rev ? 'ของ' : '' }];
    if (d.ck) history.push({ at: ckAt, who: d.ckName || d.ck, what: xf ? 'รับแล้ว' : 'ตรวจแล้ว', link: '', linkTh: '' });
    if (d.rj) history.push({ at: stampOf(d.okAt), who: d.rjName || d.rj, what: 'ไม่รับ · ' + (d.rjWhy || ''), link: '', linkTh: '' });
    if (d.ap) history.push({ at: apAt, who: d.apName || d.ap, what: 'อนุมัติ', link: '', linkTh: '' });
    /* ทุกครั้งที่ตั้งเลข: ค่าก่อนแก้จาก trLog แล้วตามด้วยค่าปัจจุบัน */
    var trSay = function (at, who, state, tr) {
      history.push({ at: at, who: who, what: state === c.TR_DONE ? 'ใส่เลข TRcloud ' + tr : state === c.TR_NONE ? 'ตั้งว่าไม่ต้องลง TRcloud' : 'ตั้งกลับเป็นรอลง TRcloud', link: '', linkTh: '' });
    };
    (d.trLog || []).forEach(function (e) { trSay(stampOf(e.at), e.by, e.state, e.tr); });
    if (d.trBy) trSay(trAt, d.trBy, d.trState, d.tr);
    if (x.voided) {
      history.push({ at: x.voided.at, who: x.voided.by, what: 'ยกเลิก' + (x.voided.why ? ' · ' + x.voided.why : ''), link: x.voided.link, linkTh: x.voided.link ? 'ลงกลับเป็น' : '' });
    }
    history.sort(function (a, b) { return String(a.at || '9').localeCompare(String(b.at || '9')); });

    return {
      no: d.no, id: d.id, seq: d.seq, type: d.type, date: d.date, stamp: d.stamp, name: d.name, by: d.by, ref: d.ref, why: d.why,
      qty: d.qty, rows: d.rows, lines: d.lines || [], names: d.names || {}, orders: x.orders, tr: d.tr || '', state: x.state, stateTh: ST_TH[x.state],
      kind: T().kindOf(d, by), wh: c.whLines(d.rows), voided: x.voided, open: open, rev: rev,
      orig: orig ? { no: orig.no, type: orig.type, date: orig.date, name: orig.name } : (rev ? { no: d.link, type: '', date: '', name: '', gone: true } : null),
      back: back ? { no: back.no, stamp: back.stamp, name: back.name } : null,
      canVoid: !open && !rev && !x.voided && !(local.meta && local.meta.open && d.seq < local.meta.open.seq),
      need: x.state === 'wait' && !x.lock ? (NEED[baseType] || '') : '',
      ok: x.ok, okTh: okTh(x.ok, xf), xf: xf, xfTh: xf ? c.XF_TH[xf] : '', first: first, lock: x.lock,
      rj: d.rj ? { email: d.rj, name: d.rjName || d.rj, at: stampOf(d.okAt), why: d.rjWhy || '' } : null,
      ck: d.ck ? { email: d.ck, name: d.ckName || d.ck, at: ckAt } : null,
      ap: d.ap ? { email: d.ap, name: d.apName || d.ap, at: apAt } : null,
      steps: steps, history: history,
    };
  }

  /**
   * ปุ่มรับ / ไม่รับ / ตรวจ / อนุมัติของ user ({email, role, team}) บนเอกสาร v (จาก view) → { check, approve, both, reject, why }
   * check = กด รับ (ใบโอน QA) หรือ ตรวจแล้ว · reject = กด ไม่รับ · approve = กด อนุมัติ · both = หัวหน้ารับ / ตรวจและอนุมัติในครั้งเดียว
   * why = ทำไมกดไม่ได้ (บอกบนหน้า)
   */
  function okCan(v, user) {
    var out = { check: false, approve: false, both: false, reject: false, why: '' };
    if (!v || !v.ok || v.ok === 'done') return out;
    var role = user && user.role, email = user && user.email, head = role === 'head';
    if (!head && role !== 'staff') { out.why = 'บัญชีนี้ดูได้อย่างเดียว'; return out; }
    var first = v.first ? 'อนุมัติได้หลังอนุมัติใบเข้า ' + v.first : '';
    if (v.ok === 'check') {
      var verb = v.xf ? 'รับ' : 'ตรวจ';
      if (v.by === email) out.why = 'คนทำ' + verb + 'ใบของตัวเองไม่ได้ ให้คนอื่น' + verb + (head ? 'ก่อน แล้วค่อยอนุมัติ' : '');
      else {
        out.why = v.xf ? C().takeWhy(v.xf, user) : '';
        if (!out.why) {
          out.check = true;
          out.reject = !!v.xf;
          out.both = head && !first;
          if (head && first) out.why = first;
        }
      }
    } else if (v.ok === 'approve') {
      if (!head) out.why = 'รอหัวหน้าอนุมัติ';
      else if (first) out.why = first;
      else out.approve = true;
    } else if (v.ok === 'reject') {
      out.why = head ? 'ผู้รับไม่รับ · กด ยกเลิกเอกสารนี้ แล้วให้คนทำลงใบใหม่' : 'ผู้รับไม่รับ · รอหัวหน้ายกเลิกใบ';
    }
    return out;
  }

  /**
   * งานวันนี้ของหน้าแรก (วันตามเวลาไทย ดูจากเวลาที่บันทึก)
   * types ไม่นับใบที่ยกเลิกแล้ว (นับแยกใน void) · total นับทุกใบที่บันทึกวันนี้ รวมใบกลับรายการ
   * ok = ใบย้าย / แปลงที่ยังไม่จบ (ทุกวัน) { check, toCheck คนอื่นทำ (เราตรวจได้), approve, oldest, days (รอตรวจ / รออนุมัติ / รอรับ),
   *      recv รอรับ, toRecv เรารับได้, recvDays ใบเก่าสุดที่เรารับได้ ค้างกี่วัน,
   *      sent ใบโอนของเราที่ยังไม่มีคนรับ, sentDays, reject ไม่รับที่เราต้องตาม (หัวหน้า = ทุกใบ) }
   * → { day, total, mine, types: {ประเภท: {n, qty, void}}, wait: {n, oldest, days, file, number}, ok, last: [brief], open, trcDay, seq }
   */
  function home(local, now, user) {
    var u = typeof user === 'string' ? { email: user } : user || {}, email = u.email || '';
    var c = C(), day = c.today(now), vd = c.voids(local), st = T().trStates(local), by = byNo(local);
    var types = {}, total = 0, mine = 0, today = [];
    var wait = { n: 0, oldest: '', days: 0, file: 0, number: 0 };
    var ok = { check: 0, toCheck: 0, approve: 0, oldest: '', days: 0, recv: 0, toRecv: 0, recvDays: 0, sent: 0, sentDays: 0, reject: 0 };
    (local.docs || []).forEach(function (d) {
      var os = c.okState(d, vd);
      if (os === c.OK_REJECT && (u.role === 'head' || d.by === email)) ok.reject++;
      if (os === c.OK_CHECK || os === c.OK_APPROVE) {
        var od = (d.stamp || d.date || '').slice(0, 10), age = od ? c.dayNo(day) - c.dayNo(od) : 0;
        var xf = os === c.OK_CHECK ? c.xfKind(d) : '';
        if (xf) {
          ok.recv++;
          if (d.by === email) { ok.sent++; ok.sentDays = Math.max(ok.sentDays, age); }
          else if (!c.takeWhy(xf, u)) { ok.toRecv++; ok.recvDays = Math.max(ok.recvDays, age); }
        } else if (os === c.OK_CHECK) { ok.check++; if (d.by !== email) ok.toCheck++; } else ok.approve++;
        if (od && (!ok.oldest || od < ok.oldest)) ok.oldest = od;
      }
      if (st[d.no] === c.TR_WAIT && !T().trLocked(d, by)) {   // ยังไม่อนุมัติ = งานของคนรับ / หัวหน้า ยังไม่ใช่งาน TRcloud
        wait.n++;
        var s = (d.stamp || d.date || '').slice(0, 10);
        if (s && (!wait.oldest || s < wait.oldest)) wait.oldest = s;
        wait[T().kindOf(d, by)]++;
      }
      if ((d.stamp || '').slice(0, 10) !== day || d.type === c.TYPE_OPEN) return;
      total++;
      if (email && d.by === email) mine++;
      var t = types[d.type] || (types[d.type] = { n: 0, qty: 0, void: 0 });
      if (vd[d.no]) t.void++;
      else { t.n++; t.qty = c.round3(t.qty + d.qty); }
      today.push(d);
    });
    if (wait.oldest) wait.days = c.dayNo(day) - c.dayNo(wait.oldest);
    if (ok.oldest) ok.days = c.dayNo(day) - c.dayNo(ok.oldest);
    today.sort(function (a, b) { return b.seq - a.seq; });
    return {
      day: day, total: total, mine: mine, types: types, wait: wait, ok: ok,
      last: today.slice(0, LAST_MAX).map(function (d) { return brief(d, vd, st, by); }),
      open: !!(local.meta && local.meta.open), trcDay: (local.trc && local.trc.data && local.trc.data.day) || '', seq: local.seq || 0,
    };
  }

  /**
   * งานของฉันของหน้าแรก ทีละใบ · คิดจากสำเนาในเครื่อง ไม่อ่านฐาน
   * todo เก่าสุดก่อน: step recv เรารับได้ · check เราตรวจได้ · approve เราอนุมัติได้ · void หัวหน้ายกเลิกใบที่ไม่รับ · redo ใบเราที่ไม่รับ
   * wait เก่าสุดก่อน: recv / check / approve ใบของเราที่รอคนอื่น · first หัวหน้ารอใบเข้าใบ first ก่อน
   * done ใหม่สุดก่อน: ที่คนนี้ทำวันนี้ save · recv · check · approve · reject (ใบละแถว ขั้นล่าสุด)
   * → { day, todo, wait, done: [{no, type, xf, name, qty, rows, sku, po, stamp, age, step, first}], n: { todo, wait, done } }
   */
  function queue(local, now, user) {
    var c = C(), u = user || {}, email = u.email || '', head = u.role === 'head', can = head || u.role === 'staff';
    var day = c.today(now), vd = c.voids(local), all = { todo: [], wait: [], done: [] }, checked = 0;
    function put(k, d, step, at, first) { all[k].push({ d: d, step: step, at: at, first: first || '' }); }
    (local.docs || []).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      var st = c.okState(d, vd), mine = !!email && d.by === email, xf = st ? c.xfKind(d) : '', at = d.stamp || d.date || '';
      if (can) {
        if (st === c.OK_REJECT) {
          if (head) put('todo', d, 'void', at);
          else if (mine) put('todo', d, 'redo', at);
        } else if (st === c.OK_CHECK) {
          var step = xf ? 'recv' : 'check';
          if (mine) put('wait', d, step, at);
          else if (!xf || !c.takeWhy(xf, u)) put('todo', d, step, at);
        } else if (st === c.OK_APPROVE) {
          if (head) {
            var first = checked++ < FIRST_MAX ? c.apFirst(local, d, vd) : '';
            put(first ? 'wait' : 'todo', d, first ? 'first' : 'approve', at, first);
          } else if (mine) put('wait', d, 'approve', at);
        }
      }
      if (!email || d.type === c.TYPE_OPEN) return;
      var last = null, saw = function (step, t) { if (String(t || '').slice(0, 10) === day && (!last || String(t) >= String(last[1]))) last = [step, t]; };
      if (mine && !vd[d.no]) saw('save', d.stamp);
      if (d.ck === email) saw(c.xfKind(d) ? 'recv' : 'check', stampOf(d.ckAt));
      if (d.rj === email) saw('reject', stampOf(d.okAt));
      if (d.ap === email) saw('approve', stampOf(d.apAt));
      if (last) put('done', d, last[0], last[1]);
    });
    all.done.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) || b.d.seq - a.d.seq; });
    function row(e) {
      var d = e.d, r = (d.rows || [])[0] || [], from = String(d.stamp || d.date || '').slice(0, 10);
      var age = /^\d{4}-\d{2}-\d{2}$/.test(from) ? c.dayNo(day) - c.dayNo(from) : 0;
      return { no: d.no, type: d.type, xf: c.xfKind(d) || '', name: d.name, qty: d.qty, rows: (d.rows || []).length,
        sku: r[0] || r[1] || '', po: r[3] || '', stamp: e.at, age: age > 0 ? age : 0, step: e.step, first: e.first };
    }
    var out = { day: day, n: {} };
    ['todo', 'wait', 'done'].forEach(function (k) { out.n[k] = all[k].length; out[k] = all[k].slice(0, QUEUE_MAX).map(row); });
    return out;
  }

  window.WmsFireDocs = { LIST_MAX: LIST_MAX, QUEUE_MAX: QUEUE_MAX, queue: queue, LAST_MAX: LAST_MAX, ST_TH: ST_TH, OK_TH: OK_TH, NEED: NEED, index: index, search: search, rangeOf: rangeOf, view: view, okCan: okCan, home: home, auditCard: auditCard };
})();
