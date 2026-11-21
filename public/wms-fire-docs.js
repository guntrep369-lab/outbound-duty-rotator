/**
 * @file wms-fire-docs.js — ระบบใหม่: หน้า วันนี้ กับหน้า เอกสาร ของแอปสมุดสต๊อก
 *
 * คิดจากสำเนาในเครื่องทั้งหมด ไม่อ่านฐานเพิ่ม (ไม่กินโควตา)
 *   index(local)              ทุกเอกสาร ใหม่สุดก่อน + สถานะ (TRcloud · ยกเลิกแล้ว · ใบกลับรายการ) + ข้อความไว้ค้น
 *   search(list, q, now)      ค้นด้วย เลขที่ SKU โล LOT PO ออเดอร์ เลขอ้างอิง เลขพัสดุ เลข TRcloud ชื่อคนลง Note
 *                             กรองประเภท สถานะ ช่วงวัน · นับต่อประเภท / สถานะให้ชิปบนหน้า
 *   view(local, no)           เอกสารใบเดียว: หัว แถว ออเดอร์ ขั้นตอน ประวัติ ใบเดิม ↔ ใบกลับรายการ
 *   home(local, now, email)   งานวันนี้: ใบที่บันทึกวันนี้ต่อประเภท ของฉัน รอลง TRcloud รอตรวจ / อนุมัติ ใบล่าสุด
 *   okCan(v, user)            ปุ่มตรวจ / อนุมัติของคนนี้ บนเอกสารใบนี้ (ตรงกับ okSet ใน wms-fire-core.js)
 * เปิดเป็น window.WmsFireDocs ต้องโหลด wms-fire-core.js กับ wms-fire-trc.js ก่อน
 */
(function () {
  'use strict';

  var LIST_MAX = 300;     // แถวที่ส่งให้หน้าวาดต่อครั้ง
  var LAST_MAX = 8;       // ใบล่าสุดบนหน้าวันนี้
  var RANGES = { today: 0, d7: 6, d30: 29 };
  var ST_TH = { wait: 'รอลง TRcloud', done: 'ลง TRcloud แล้ว', none: 'ไม่ต้องลง TRcloud' };
  var OK_TH = { check: 'รอตรวจ', approve: 'รออนุมัติ', done: 'อนุมัติแล้ว' };
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

  /** สรุปหนึ่งใบสำหรับตาราง (ไม่มีข้อความค้น) */
  function brief(d, vd, st) {
    var v = vd[d.no] || null;
    return {
      no: d.no, id: d.id, seq: d.seq, type: d.type, date: d.date, stamp: d.stamp, name: d.name, by: d.by,
      rows: d.rows.length, qty: d.qty, orders: orderCount(d), tr: d.tr || '', state: st[d.no] || 'none',
      voided: v ? { by: v.voidBy, at: v.voidAt, why: v.why, link: v.link } : null,
      link: d.type === C().TYPE_REV ? d.link : '',
      ok: C().okState(d, vd), ck: d.ckName || '', ap: d.apName || '',
    };
  }

  /** คำที่ใช้ค้นของเอกสาร ไม่ซ้ำ ตัวเล็ก */
  function words(d) {
    var seen = {}, out = [];
    function add(v) { var s = lc(v).trim(); if (s && !seen[s]) { seen[s] = 1; out.push(s); } }
    [d.no, d.type, d.name, d.by, d.tr, d.date, d.ref, d.link, d.why, d.ckName, d.apName].forEach(add);
    d.rows.forEach(function (r) { add(r[0]); add(r[1]); add(r[2]); add(r[3]); add(r[4]); add(r[5]); add(r[8]); add(r[10]); });
    (d.lines || []).forEach(function (l) { add(l.order); add(l.ref); add(l.track); add(l.sku); });
    Object.keys(d.names || {}).forEach(function (k) { add(d.names[k]); });
    return out.join(' ');
  }

  /** ทุกเอกสาร ใหม่สุดก่อน [{...brief, text}] */
  function index(local) {
    var vd = C().voids(local), st = T().trStates(local);
    return (local.docs || []).slice().sort(function (a, b) { return b.seq - a.seq; }).map(function (d) {
      var x = brief(d, vd, st);
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

  /** ตรงสถานะไหม: wait รอลง TRcloud · check รอตรวจ · approve รออนุมัติ · void ยกเลิกแล้ว · mine ของฉัน */
  function stOk(x, status, email) {
    if (!status) return true;
    if (status === 'wait') return x.state === 'wait';
    if (status === 'check' || status === 'approve') return x.ok === status;
    if (status === 'void') return !!x.voided;
    if (status === 'mine') return !!email && x.by === email;
    return true;
  }

  /**
   * ค้นเอกสาร q = { text, type, status, range, email, max }
   * ทุกคำในช่องค้นต้องเจอ (ค้นทีละหลายคำได้ เช่น SKU กับโล) · ช่วงวันดูวันที่ของเอกสาร
   * → { list, total, types: {ประเภท: n}, states: {wait, check, approve, void, mine}, from, to }
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
    var types = {}, states = { wait: 0, check: 0, approve: 0, void: 0, mine: 0 };
    base.forEach(function (x) {
      if (stOk(x, q.status, q.email)) types[x.type] = (types[x.type] || 0) + 1;
      if (!q.type || x.type === q.type) {
        if (x.state === 'wait') states.wait++;
        if (x.ok === 'check') states.check++;
        if (x.ok === 'approve') states.approve++;
        if (x.voided) states.void++;
        if (q.email && x.by === q.email) states.mine++;
      }
    });
    var out = base.filter(function (x) { return (!q.type || x.type === q.type) && stOk(x, q.status, q.email); });
    return { list: out.slice(0, q.max || LIST_MAX), total: out.length, all: base.length, types: types, states: states, from: from, to: to };
  }

  /**
   * เอกสารใบเดียว (null = ไม่มีในเครื่องนี้)
   * steps: บันทึก → ตรวจ → อนุมัติ (ใบย้าย / แปลง) → TRcloud → ยกเลิก (ถ้ามี) · state = done | now | wait | skip | void
   * history: ใหม่สุดท้าย [{at, who, what, link}]
   */
  function view(local, no) {
    var c = C(), by = byNo(local), d = by[no];
    if (!d) return null;
    var vd = c.voids(local), st = T().trStates(local), x = brief(d, vd, st);
    var rev = d.type === c.TYPE_REV, open = d.type === c.TYPE_OPEN;
    var orig = rev && by[d.link] ? by[d.link] : null;
    var back = x.voided && x.voided.link && by[x.voided.link] ? by[x.voided.link] : null;
    var baseType = orig ? orig.type : d.type;
    var trAt = stampOf(d.trAt);

    var steps = [{ k: 'save', label: open ? 'ลงยอดยกมา' : rev ? 'ลงกลับ' : 'บันทึก', state: 'done', at: d.stamp, who: d.name }];
    var okNeed = c.OK_TYPES.indexOf(d.type) >= 0, ckAt = stampOf(d.ckAt), apAt = stampOf(d.apAt);
    if (okNeed) {
      steps.push(d.ck ? { k: 'check', label: 'ตรวจแล้ว', state: 'done', at: ckAt, who: d.ckName }
        : x.ok ? { k: 'check', label: 'รอตรวจ', state: 'now', hint: 'คนอื่นที่ไม่ใช่คนทำ เช็คของจริงแล้วกด ตรวจแล้ว' }
        : { k: 'check', label: 'ไม่ได้ตรวจ', state: 'skip' });
      steps.push(d.ap ? { k: 'approve', label: 'อนุมัติแล้ว', state: 'done', at: apAt, who: d.apName }
        : x.ok === c.OK_APPROVE ? { k: 'approve', label: 'รออนุมัติ', state: 'now', hint: 'หัวหน้ากด อนุมัติ' }
        : x.ok ? { k: 'approve', label: 'รออนุมัติ', state: 'wait' }
        : { k: 'approve', label: 'ไม่ได้อนุมัติ', state: 'skip' });
    }
    if (!open && d.type !== c.TYPE_SALE) {
      steps.push(x.state === 'wait' ? { k: 'tr', label: 'รอลง TRcloud', state: 'now', hint: NEED[baseType] || 'ลงใน TRcloud แล้วใส่เลข' }
        : x.state === 'done' ? { k: 'tr', label: 'ลง TRcloud แล้ว', state: 'done', at: trAt, who: d.trBy, tr: d.tr }
        : { k: 'tr', label: 'ไม่ต้องลง TRcloud', state: 'skip', at: trAt, who: d.trBy });
    }
    if (x.voided) steps.push({ k: 'void', label: 'ยกเลิกแล้ว', state: 'void', at: x.voided.at, who: x.voided.by, why: x.voided.why, link: x.voided.link });

    /* link = เลขที่ที่เกี่ยวข้อง (หน้าแอปทำเป็นปุ่ม ต่อท้ายด้วย linkTh) */
    var history = [{ at: d.stamp, who: d.name, what: (rev ? 'ลงกลับรายการ' + (d.why ? ' · ' + d.why : '') : 'บันทึก' + d.type) +
      ' · ' + d.rows.length + ' แถว ' + c.round3(d.qty) + ' ชิ้น', link: rev ? d.link : '', linkTh: rev ? 'ของ' : '' }];
    if (d.ck) history.push({ at: ckAt, who: d.ckName || d.ck, what: 'ตรวจแล้ว', link: '', linkTh: '' });
    if (d.ap) history.push({ at: apAt, who: d.apName || d.ap, what: 'อนุมัติ', link: '', linkTh: '' });
    if (d.trBy) {
      history.push({ at: trAt, who: d.trBy, what: d.trState === c.TR_DONE ? 'ใส่เลข TRcloud ' + d.tr : d.trState === c.TR_NONE ? 'ตั้งว่าไม่ต้องลง TRcloud' : 'ตั้งกลับเป็นรอลง TRcloud', link: '', linkTh: '' });
    }
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
      need: x.state === 'wait' ? (NEED[baseType] || '') : '',
      ok: x.ok, okTh: OK_TH[x.ok] || '',
      ck: d.ck ? { email: d.ck, name: d.ckName || d.ck, at: ckAt } : null,
      ap: d.ap ? { email: d.ap, name: d.apName || d.ap, at: apAt } : null,
      steps: steps, history: history,
    };
  }

  /**
   * ปุ่มตรวจ / อนุมัติของ user ({email, role}) บนเอกสาร v (จาก view) → { check, approve, both, why }
   * check = กด ตรวจแล้ว · approve = กด อนุมัติ (มีผู้ตรวจแล้ว) · both = หัวหน้าตรวจและอนุมัติในครั้งเดียว
   * why = ทำไมกดไม่ได้ (บอกบนหน้า)
   */
  function okCan(v, user) {
    var out = { check: false, approve: false, both: false, why: '' };
    if (!v || !v.ok || v.ok === 'done') return out;
    var role = user && user.role, email = user && user.email;
    if (role !== 'head' && role !== 'staff') { out.why = 'บัญชีนี้ดูได้อย่างเดียว'; return out; }
    if (v.ok === 'check') {
      if (v.by === email) out.why = role === 'head' ? 'คนทำตรวจใบของตัวเองไม่ได้ ให้คนอื่นตรวจก่อน แล้วค่อยอนุมัติ' : 'คนทำตรวจใบของตัวเองไม่ได้ ให้คนอื่นตรวจ';
      else { out.check = true; out.both = role === 'head'; }
    } else if (v.ok === 'approve') {
      if (role === 'head') out.approve = true;
      else out.why = 'รอหัวหน้าอนุมัติ';
    }
    return out;
  }

  /**
   * งานวันนี้ของหน้าแรก (วันตามเวลาไทย ดูจากเวลาที่บันทึก)
   * types ไม่นับใบที่ยกเลิกแล้ว (นับแยกใน void) · total นับทุกใบที่บันทึกวันนี้ รวมใบกลับรายการ
   * ok = ใบย้าย / แปลงที่ยังไม่อนุมัติ (ทุกวัน) { check, toCheck คนอื่นทำ (เราตรวจได้), approve, oldest, days }
   * → { day, total, mine, types: {ประเภท: {n, qty, void}}, wait: {n, oldest, days, file, number}, ok, last: [brief], open, trcDay, seq }
   */
  function home(local, now, email) {
    var c = C(), day = c.today(now), vd = c.voids(local), st = T().trStates(local), by = byNo(local);
    var types = {}, total = 0, mine = 0, today = [];
    var wait = { n: 0, oldest: '', days: 0, file: 0, number: 0 };
    var ok = { check: 0, toCheck: 0, approve: 0, oldest: '', days: 0 };
    (local.docs || []).forEach(function (d) {
      var os = c.okState(d, vd);
      if (os === c.OK_CHECK || os === c.OK_APPROVE) {
        if (os === c.OK_CHECK) { ok.check++; if (d.by !== email) ok.toCheck++; } else ok.approve++;
        var od = (d.stamp || d.date || '').slice(0, 10);
        if (od && (!ok.oldest || od < ok.oldest)) ok.oldest = od;
      }
      if (st[d.no] === c.TR_WAIT) {
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
      last: today.slice(0, LAST_MAX).map(function (d) { return brief(d, vd, st); }),
      open: !!(local.meta && local.meta.open), trcDay: (local.trc && local.trc.data && local.trc.data.day) || '', seq: local.seq || 0,
    };
  }

  window.WmsFireDocs = { LIST_MAX: LIST_MAX, LAST_MAX: LAST_MAX, ST_TH: ST_TH, OK_TH: OK_TH, NEED: NEED, index: index, search: search, rangeOf: rangeOf, view: view, okCan: okCan, home: home };
})();
