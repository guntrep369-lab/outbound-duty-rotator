/**
 * @file wms-fire.js — ระบบใหม่บน Firebase: store (จริง/จำลอง) ล็อกอิน สำเนาในเครื่อง op แบบ book-api รายชื่อคนใช้ ตัวนับโควตา
 *
 *   store   interface เดียว: get, getMany, docsAfter, list, tx, commit, patch, onMeta, setUser, stats, mine (ของเครื่องนี้)
 *           memStore()        ในหน่วยความจำ ทำตัวแบบ Firestore: transaction ลองใหม่เมื่อชน, สร้างได้อย่างเดียว, เช็คสิทธิ์แบบ firestore.rules
 *           firestoreStore()  Firestore จริง โหลด SDK จาก www.gstatic.com (ใช้เฉพาะเว็บที่ deploy ห้ามเรียกจากเทสต์และ dev)
 *   auth    fakeAuth() เลือกบัญชีทดลอง · googleAuth() ป๊อปอัป Google ของบริษัท (signInWithPopup + hd)
 *   cache   memCache() · idbCache() สำเนาใน IndexedDB ต่อท้ายเฉพาะเอกสารใหม่
 *   open()  ตัวสมุด: login / restore, sync (ดึงเฉพาะเอกสารใหม่ ยอดต่อกองคิดในเครื่อง), fifo() รูป tx-fifo, post('bk-…') คำตอบรูปเดิม
 *           users / saveUser (หัวหน้า), quota() อ่าน/เขียนวันนี้ (เครื่องนี้ + ทุกเครื่องที่ส่งยอดมาที่ use/{วัน}), reload() ล้างสำเนาแล้วดึงใหม่
 *
 * ตรรกะทั้งหมดอยู่ใน wms-fire-core.js (ต้องโหลดก่อน) โหลดเป็น classic script เปิดเป็น window.WmsFire
 */
(function () {
  'use strict';

  var C = window.WmsFireCore;
  var SDK_V = '12.4.0';   // ตรึงรุ่น Firebase JS SDK
  var SDK_URL = 'https://www.gstatic.com/firebasejs/' + SDK_V + '/';
  var TX_TRIES = 5;       // transaction ชนกันลองใหม่กี่ครั้ง (แบบ Firestore)
  var RACE_TRIES = 3;     // ฐานไม่รับเพราะเครื่องอื่นเขียนแทรก (Rules ตัดสินก่อนเช็คชนรุ่น) เปิด transaction ใหม่กี่รอบ
  var STALE_TRIES = 4;    // สำเนาในเครื่องตามไม่ทันระหว่างบันทึก ดึงใหม่แล้วลองกี่ครั้ง
  var PAGE = 300;         // เอกสารต่อการดึงหนึ่งครั้ง
  var MASTERS = ['conv', 'sup', 'cap'];
  var SETUP = ['loc', 'sku', 'grp', 'zone'];   // ข้อมูลหลักที่หัวหน้าแก้ในหน้า ข้อมูลหลัก (wms-fire-setup.js) · MASTERS ก็แก้ที่หน้านั้นด้วย (ขั้น ข) · zone = โซนแร็ค (ขั้น ค)
  var ROLE_TH = { head: C.ROLE_HEAD, staff: C.ROLE_USER, viewer: C.ROLE_VIEW };
  var NO_RIGHT = 'บัญชีนี้ยังไม่มีสิทธิ์ ติดต่อหัวหน้า Inventory ให้เพิ่มชื่อในหน้าตั้งค่า';
  var ROLES = ['head', 'staff', 'viewer'];
  var LIMITS = { reads: 50000, writes: 20000 };   // โควตาฟรีต่อวันของ Firestore (Spark)
  var LAST_EVERY = 3600000;     // บันทึกเวลาเข้าล่าสุดไม่ถี่กว่าชั่วโมงละครั้ง
  var REPORT_EVERY = 3600000;   // ส่งยอดอ่าน/เขียนของเครื่องนี้ไปรวมที่ use/{วัน} ชั่วโมงละครั้ง
  var ARCH_GAP = 300;           // ตามหลังเกินนี้ (หรือเครื่องใหม่) ลองอ่านก้อนปิดเดือนแทนทีละเอกสาร
  var ARCH_BATCH = 6;           // ก้อนต่อการเขียนหนึ่งครั้ง (ก้อนละไม่เกิน 900 KB · Rules อ่านก้อนละ 3 = users + exists + get index เพดาน 20)

  function clone(o) { return o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)); }
  /** ข้อความเทียบค่า ลำดับช่องไม่มีผล (ฐานจริงส่งช่องของ map มาลำดับไหนก็ได้) */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  var RACE_ERR = 'บันทึกชนกับเครื่องอื่นหลายครั้งติดกัน ลองกดส่งใหม่';
  function diffKeys(a, b) {
    a = a || {}; b = b || {};
    var ks = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ks[k] = 1; });
    return Object.keys(ks);
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /** ที่อยู่ของส่วนแยกที่ยังไม่มี (หัวใบบอกกี่ส่วนก็อ่านไม่เกิน PARTS_MAX) */
  function partPaths(id, part, have) {
    var out = [], n = C.partsOf(part);
    for (var i = 2; i <= n; i++) if (!have.some(function (p) { return p.i === i; })) out.push('docs/' + id + '~' + i);
    return out;
  }
  function only(d, keys) { return Object.keys(d).every(function (k) { return keys.indexOf(k) >= 0; }); }
  /** เท่ากันแบบ == ของ Rules (map ไม่สนลำดับช่อง) */
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    var ks = Object.keys(a);
    return ks.length === Object.keys(b).length && ks.every(function (k) { return has(b, k) && same(a[k], b[k]); });
  }
  function pad2(n) { return (+n < 10 ? '0' : '') + (+n); }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  /* ── สิทธิ์แบบ firestore.rules (store จำลองใช้ ตัวจริงเช็คที่ Rules) ─────── */

  var TR_KEYS = ['tr', 'trState', 'trBy', 'trAt', 'trLog'];
  /** เพดานการอ่านเอกสารประกอบของ Rules (get / getAfter / exists) ต่อคำขอ: เขียนเอกสารเดียว 10 · transaction หรือ batch 20 นับรวมทุกเอกสาร */
  var RULE_CALLS_ONE = 10;
  var RULE_CALLS_MANY = 20;

  /**
   * ชุดเขียนหนึ่งชุด (transaction หรือ batch) ผ่านกฎไหม '' = ผ่าน
   * เช็คทีละเอกสารแบบเดียวกับ firestore.rules (แต่ละเอกสารเห็นแค่ของตัวเองก่อนเขียน กับของอื่นหลังเขียนผ่าน getAfter)
   * และนับการอ่านเอกสารประกอบแบบที่ Rules จริงใช้ ตามตารางใน firestore.rules
   * u = {email, verified} · before = ข้อมูลก่อนเขียน { path: data } · writes = [[path, data]] · now = เวลาเซิร์ฟเวอร์ (ms)
   */
  function rulesError(u, before, writes, domain, now) {
    if (!u || !u.email) return 'ยังไม่ได้ล็อกอิน';
    if (!u.verified) return 'อีเมลยังไม่ยืนยัน';
    var email = String(u.email).toLowerCase();
    if (domain && email.slice(-(domain.length + 1)) !== '@' + domain) return 'อีเมลนอกโดเมนบริษัท';
    var me = before['users/' + email];
    if (!me || me.active !== true) return NO_RIGHT;
    /* ข้อมูลหลังเขียน (getAfter) = ที่เขียนในคำขอนี้ ทับของเดิม (ไม่คัดลอกทั้งฐาน ฐานใหญ่แล้วช้า) */
    var over = {};
    writes.forEach(function (w) { over[w[0]] = w[1]; });
    var after = function (p) { return Object.prototype.hasOwnProperty.call(over, p) ? over[p] : before[p]; };
    var ma = after('meta/head') || null;
    var head = me.role === 'head', staff = head || me.role === 'staff';
    var months = C.monthsOk(now), calls = 0;
    for (var i = 0; i < writes.length; i++) {
      var path = writes[i][0], d = writes[i][1], seg = path.split('/'), col = seg[0], id = seg[1], old = before[path];
      if (seg.length !== 2) return 'ที่เขียนไม่ถูก ' + path;
      calls += 1;   // get(users/{อีเมล}) ทุกเอกสาร
      if (col === 'users') {
        if (head) continue;
        /* ทุกคนแก้ได้แค่เวลาเข้าล่าสุดของตัวเอง เป็นเวลาเซิร์ฟเวอร์ */
        var ch = path === 'users/' + email && old && old.active === true ? diffKeys(d, old) : [];
        if (ch.length === 1 && ch[0] === 'last' && d.last === C.TIME) continue;
        return 'เขียน users ได้เฉพาะหัวหน้า';
      }
      if (col === 'use') {
        /* ยอดอ่าน/เขียนรายวัน ทุกเครื่องเติมช่องของตัวเอง ครั้งละช่องเดียว */
        if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return 'use ต้องเป็นวันที่';
        if (diffKeys(d, old).length !== 1) return 'use แก้ได้ครั้งละเครื่อง';
        continue;
      }
      if (col === 'master' || col === 'trc') { if (!head) return 'เขียน ' + col + ' ได้เฉพาะหัวหน้า'; continue; }
      if (col === 'arch') {
        /* ปิดเดือน: หัวหน้าเขียน ก้อนของเดือนที่อยู่ใน index แล้วทับไม่ได้ · index ต่อท้ายครั้งละเดือน */
        if (!head) return 'ปิดเดือนได้เฉพาะหัวหน้า';
        if (id !== 'index') calls += 2;   // exists + get(arch/index)
        var archWhy = archRule(id, d, old, before['arch/index'], now);
        if (archWhy) return archWhy;
        continue;
      }
      if (!staff) return 'บัญชีนี้ดูได้อย่างเดียว';
      if (col === 'xfer') {
        /* บันทึกว่าวางแถวลงชีตเดิมแล้ว ครั้งละวันเดียว */
        if (id !== 'log' || diffKeys(d, old).length !== 1) return 'xfer แก้ได้ครั้งละวัน';
        continue;
      }
      if (col === 'docs') {
        if (old) {
          if (has(old, 'of')) return 'ส่วนแยกแก้ไม่ได้';
          var changed = Object.keys(d).concat(Object.keys(old)).filter(function (k) { return JSON.stringify(d[k]) !== JSON.stringify(old[k]); });
          if (changed.length && changed.every(function (k) { return C.OK_KEYS.indexOf(k) >= 0; })) {
            var okWhy = okRule(d, old, changed, email, me, head);
            if (okWhy) return okWhy;
            continue;
          }
          if (changed.some(function (k) { return TR_KEYS.indexOf(k) < 0; }) || d.trBy !== email) return 'เอกสารแก้ได้เฉพาะเลข TRcloud';
          if (C.TR_STATES.indexOf(d.trState) < 0 || d.trAt !== C.TIME || typeof d.tr !== 'string' || d.tr.length > 100) return 'สถานะ TRcloud ไม่ถูก';
          if (old.type === C.TYPE_MOVE && old.trState === C.TR_WAIT && !old.ap && (d.trState !== C.TR_WAIT || d.tr !== '')) return 'ใบย้ายยังไม่อนุมัติ ใส่เลข TRcloud ไม่ได้';
          var logWhy = trLogRule(d, old);
          if (logWhy) return logWhy;
          continue;
        }
        calls += 1;   // getAfter(meta/head)
        /* เอกสารหลัก: meta.last = เอกสารนี้ แปลว่า meta ถูกเขียนในคำขอเดียวกัน เพราะเอกสารเดิมสร้างซ้ำไม่ได้
           ส่วนแยก: meta.at = เวลาของคำขอนี้ (เวลาเซิร์ฟเวอร์) แปลว่า meta เพิ่ง seq +1 ในคำขอนี้ ไม่ใช่เติมส่วนให้เอกสารเก่า */
        if (has(d, 'of')) {
          if (!ma || ma.at !== C.TIME || typeof d.of !== 'string' || !Number.isInteger(d.i) || ma.last !== d.of || ma.seq !== d.seq || d.of + '~' + d.i !== id) return 'ส่วนแยกของเอกสารไม่ตรงกับเอกสารหลัก';
          if (!only(d, C.PART_KEYS)) return 'ส่วนแยกมีช่องที่ใส่ไม่ได้';
          if (d.i < 2 || d.i > C.PARTS_MAX || typeof d.rows !== 'string' || typeof d.orders !== 'string') return 'ส่วนแยกผิดรูป';
          continue;
        }
        if (!ma || ma.seq !== d.seq) return 'เอกสารใหม่ต้องมากับ meta ที่ seq เพิ่ม 1';
        if (ma.last !== id) return 'meta.last ไม่ใช่เอกสารนี้';
        if (d.by !== email) return 'by ต้องเป็นอีเมลคนที่ล็อกอิน';
        if (d.at !== C.TIME) return 'at ต้องเป็นเวลาเซิร์ฟเวอร์';
        if (C.HEAD_TYPES.indexOf(d.type) >= 0 ? !head : C.STAFF_TYPES.indexOf(d.type) < 0) return 'ประเภท ' + C.safeText(d.type) + ' ลงไม่ได้ด้วยสิทธิ์นี้';
        if (months.indexOf(ma.month) < 0) return 'เดือนของเลขเอกสารไม่ตรงกับเวลาเซิร์ฟเวอร์ (นาฬิกาเครื่องคลาดเกิน 10 นาที?)';
        if (d.no !== 'T' + ma.month + '-' + pad4(ma.next - 1)) return 'เลขเอกสารไม่ตรงกับเลขถัดไปใน meta';
        if (d.type === C.TYPE_MOVE) {
          var mvWhy = moveRule(d, me, head);
          if (mvWhy) return mvWhy;
        }
        var newWhy = newRule(d, me, email, now) || idRule(id, d) || shapeRule(d);
        if (newWhy) return newWhy;
        continue;
      }
      if (col === 'meta') {
        if (id !== 'head') return 'meta มีแค่ head';
        var mb = old || null;
        if (!mb || d.seq !== mb.seq) {
          if (d.seq !== (mb ? +mb.seq || 0 : 0) + 1) return 'meta seq ต้องเพิ่มทีละ 1 (เอกสารใหม่ต้องมากับ meta ที่ seq เพิ่ม 1)';
          calls += 1;   // getAfter(docs/{meta.last})
          var last = after('docs/' + d.last);
          if (!last || last.seq !== d.seq) return 'meta ต้องมากับเอกสารใหม่ seq เดียวกัน';
          /* เดือนตามเวลาเซิร์ฟเวอร์ (±MONTH_TOL รอบเที่ยงคืนสิ้นเดือน) ไม่ย้อนเดือนเดิม · เลขรันต่อในเดือนเดียวกัน เดือนใหม่เริ่ม 1 */
          var pm = mb ? String(mb.month || '') : '';
          if (months.indexOf(d.month) < 0) return 'เดือนของเลขเอกสารไม่ตรงกับเวลาเซิร์ฟเวอร์ (นาฬิกาเครื่องคลาดเกิน 10 นาที?)';
          if (d.month < pm) return 'เดือนของเลขเอกสารย้อนเดือนเดิมไม่ได้';
          if (d.next !== (mb && pm === d.month ? +mb.next || 1 : 1) + 1) return 'เลขถัดไปใน meta ไม่ถูก';
          if (d.at !== C.TIME) return 'at ต้องเป็นเวลาเซิร์ฟเวอร์';
          if ((+d.mv || 0) !== (mb ? +mb.mv || 0 : 0) || (+d.tv || 0) !== (mb ? +mb.tv || 0 : 0) || (+d.ov || 0) !== (mb ? +mb.ov || 0 : 0) ||
            (d.trc || '') !== (mb ? mb.trc || '' : '')) {
            return 'บันทึกเอกสารต้องคง mv tv ov trc ของ meta เดิม';
          }
          var bookWhy = bookRule(d, mb, last, head);
          if (bookWhy) return bookWhy;
          continue;
        }
        var diff = diffKeys(d, mb);
        /* ใส่เลข TRcloud: tv +1 ให้เครื่องอื่นรู้ว่าต้องดึงเลขใหม่ (ทุกคนที่ลงรายการได้) */
        if (diff.length === 1 && diff[0] === 'tv') {
          if (d.tv !== (+mb.tv || 0) + 1) return 'tv ต้องเพิ่มทีละ 1';
          continue;
        }
        /* ตรวจ / อนุมัติ: ov +1 (แยกจาก tv เครื่องอื่นดึงเฉพาะของที่เปลี่ยน) */
        if (diff.length === 1 && diff[0] === 'ov') {
          if (d.ov !== (+mb.ov || 0) + 1) return 'ov ต้องเพิ่มทีละ 1';
          continue;
        }
        if (!head) return 'meta เขียนได้เฉพาะตอนบันทึกเอกสาร';
        if (diff.some(function (k) { return k !== 'mv' && k !== 'trc'; })) return 'หัวหน้าแก้ meta ได้แค่ mv กับ trc';
        continue;
      }
      return 'เขียน ' + col + ' ไม่ได้';
    }
    var cap = writes.length > 1 ? RULE_CALLS_MANY : RULE_CALLS_ONE;
    if (calls > cap) return 'Rules อ่านเอกสารประกอบ ' + calls + ' ครั้ง เกิน ' + cap + ' ต่อคำขอ';
    return '';
  }

  function nameOf(me, email) { return has(me, 'name') && me.name !== '' ? me.name : email; }

  /** เอกสารใหม่ แบบ newOk ใน firestore.rules */
  function newRule(d, me, email, now) {
    if (!only(d, C.DOC_KEYS)) return 'เอกสารใหม่มีช่องที่ใส่ไม่ได้ (รับ อนุมัติ แก้เลขทีหลังเท่านั้น)';
    if (d.name !== nameOf(me, email)) return 'ชื่อคนทำไม่ตรงรายชื่อ';
    if (!C.dayOk(d.date, now)) return 'วันที่เอกสารต้องย้อนไม่เกิน ' + C.BACK_DAYS + ' วัน และไม่ล่วงหน้าเกิน 1 วัน';
    return '';
  }

  /** รหัสชุด แบบ idOk ใน firestore.rules */
  function idRule(id, d) {
    var fine = d.type === C.TYPE_REV ? typeof d.link === 'string' && id === 'rev|' + d.link : C.idOk(id);
    return fine ? '' : 'รหัสชุดใช้ไม่ได้';
  }

  /** ชนิดของช่องหัวใบ แบบ shapeOk ใน firestore.rules */
  var TEXT_KEYS = ['stamp', 'ref', 'link', 'why', 'tr', 'rows', 'names', 'orders'];
  function shapeRule(d) {
    var fine = d.v === C.V && Number.isInteger(d.part) && d.part >= 1 && d.part <= C.PARTS_MAX && typeof d.qty === 'number' &&
      TEXT_KEYS.every(function (k) { return typeof d[k] === 'string'; }) && (d.trState === '' || C.TR_STATES.indexOf(d.trState) >= 0) &&
      (d.xf === undefined || typeof d.xf === 'string');
    return fine ? '' : 'รูปเอกสารผิด (ชนิดช่อง หรือจำนวนส่วน)';
  }

  /** meta ของเอกสารใหม่ md แบบ bookOk ใน firestore.rules */
  function bookRule(d, old, md, head) {
    if (d.v !== C.V || !only(d, C.META_KEYS)) return 'รุ่นหรือช่องของ meta ไม่ถูก';
    var opening = md.type === C.TYPE_OPEN;
    var base = opening || !old ? 0 : has(old, 'rows') ? old.rows : 0;
    if (!Number.isInteger(md.n) || md.n < 0 || md.n > C.OPEN_MAX || d.rows !== base + md.n) return 'แถวรวมใน meta ไม่ตรงกับเอกสารใหม่';
    if (md.row !== base + 2) return 'แถวแรกของเอกสารไม่ต่อจากแถวรวม';
    var was = old && old.open !== undefined ? old.open : null;
    if (!opening) return same(d.open === undefined ? null : d.open, was) ? '' : 'ตัวชี้ยอดยกมาเปลี่ยนได้เฉพาะตอนหัวหน้าลงยอดยกมา';
    if (!head || !same(d.open, { id: d.last, no: md.no, seq: d.seq })) return 'ตัวชี้ยอดยกมาต้องชี้เอกสารยอดยกมาใบนี้ของหัวหน้า';
    if (was && old.seq !== was.seq) return 'ลงยอดยกมาใหม่ไม่ได้ มีเอกสารหลังยอดยกมาแล้ว';
    return '';
  }

  /** ประวัติเลข TRcloud แบบ trLogOk + trWasOk ใน firestore.rules (เวลาใน store จำลองเป็นมิลลิวินาที) */
  function trLogRule(d, old) {
    var was = old.trLog === undefined ? [] : old.trLog, log = d.trLog === undefined ? [] : d.trLog;
    var bad = 'ประวัติเลข TRcloud ต้องเป็นของเดิม + ค่าก่อนแก้ 1 รายการ';
    if (!old.trBy && !old.tr) return same(log, was) ? '' : bad;
    if (!Array.isArray(was) || !Array.isArray(log) || was.length >= C.TR_LOG_MAX || log.length !== was.length + 1 || !same(log.slice(0, was.length), was)) return bad;
    var e = log[was.length], t = Math.floor(old.trBy ? old.trAt : old.at);
    if (!e || typeof e !== 'object' || !only(e, ['tr', 'state', 'by', 'at'])) return bad;
    if (e.tr !== (old.tr || '') || e.state !== (old.trState || '') || e.by !== (old.trBy || old.by)) return bad;
    return typeof e.at === 'number' && Math.abs(e.at - t) <= 1 ? '' : bad;
  }

  /** ปิดเดือน แบบ archChunkOk archFirst archAdd ใน firestore.rules · idx = arch/index ก่อนเขียน */
  function archRule(id, d, old, idx, now) {
    var limit = C.yymm(now + C.MONTH_TOL);
    if (id !== 'index') {
      var at = /^(?:ov-)?(\d{4})-\d{1,3}$/.exec(id);
      if (!at || d.m !== at[1]) return 'ชื่อก้อนปิดเดือนไม่ถูก ' + id;
      if (d.m >= limit) return 'เดือนยังไม่จบ ปิดไม่ได้';
      if (idx && d.m <= idx.months[idx.months.length - 1].m) return 'เดือนนี้ปิดแล้ว เขียนทับไม่ได้';
      return '';
    }
    var bad = 'รายชื่อเดือนที่ปิดต่อท้ายได้ครั้งละเดือน ของเดิมแก้ไม่ได้';
    var was = old ? old.months : [], list = d.months;
    if (!only(d, ['v', 'months', 'ov']) || !Array.isArray(list) || list.length !== was.length + 1 || !same(list.slice(0, was.length), was)) return bad;
    var add = list[was.length] || {};
    if (typeof add.m !== 'string' || !/^\d{4}$/.test(add.m) || !d.ov || d.ov.m !== add.m || (was.length && add.m <= was[was.length - 1].m)) return bad;
    return add.m >= limit ? 'เดือนยังไม่จบ ปิดไม่ได้' : '';
  }

  /** ใบย้ายใหม่ แบบ moveOk ใน firestore.rules: ใบโอน QA เริ่มที่ รอลง ไม่มีเลข · คนทำถูกทีม */
  function moveRule(d, me, head) {
    var x = d.xf || '', qa = me.team === C.TEAM_QA;
    if (x === C.XF_IN || x === C.XF_OUT) {
      if (d.trState !== C.TR_WAIT || d.tr !== '') return 'ใบโอน QA ต้องเริ่มที่รอลง TRcloud ไม่มีเลข';
    } else if ((x && x !== C.XF_QA) || d.trState !== C.TR_NONE) return 'ใบย้ายข้ามคลังต้องเป็นใบโอน QA (xf)';
    if (head || !x) return '';
    return (x === C.XF_IN) !== qa ? '' : 'ทีมนี้ทำใบโอนแบบนี้ไม่ได้';
  }

  /** ทีมนี้รับ / ไม่รับใบนี้ได้ไหม แบบ takeOk ใน firestore.rules */
  function takeRule(old, me, head) {
    var x = old.xf || '';
    if (head || !x) return true;
    return (x !== C.XF_OUT) === (me.team === C.TEAM_QA);
  }

  /** ตรวจ / รับ / ไม่รับ / อนุมัติทีหลัง แบบ okUpdate ใน firestore.rules (คนเรียกเช็คแล้วว่าเป็นคนลงรายการได้) */
  function okRule(d, old, changed, email, me, head) {
    var ck = ['ck', 'ckName', 'ckAt'].some(function (k) { return changed.indexOf(k) >= 0; });
    var ap = ['ap', 'apName', 'apAt'].some(function (k) { return changed.indexOf(k) >= 0; });
    var rj = ['rj', 'rjName', 'rjWhy'].some(function (k) { return changed.indexOf(k) >= 0; });
    if (C.OK_TYPES.indexOf(old.type) < 0) return 'ตรวจ / อนุมัติได้เฉพาะใบย้ายกับแปลง';
    if (!ck && !ap && !rj) return 'ไม่มีการตรวจหรืออนุมัติ';
    if (d.okAt !== C.TIME) return 'okAt ต้องเป็นเวลาเซิร์ฟเวอร์';
    if (old.rj) return 'ใบนี้ผู้รับไม่รับแล้ว';
    if (rj) {
      if (ck || ap || old.ck) return 'ไม่รับได้ก่อนรับเท่านั้น';
      if (old.type !== C.TYPE_MOVE || !old.xf) return 'ไม่รับได้เฉพาะใบโอน QA';
      if (d.rj !== email) return 'ผู้ไม่รับต้องเป็นคนที่ล็อกอิน';
      if (d.rj === old.by) return 'คนทำไม่รับใบของตัวเองไม่ได้';
      if (typeof d.rjName !== 'string' || d.rjName.length > 60 || typeof d.rjWhy !== 'string' || !d.rjWhy || d.rjWhy.length > C.WHY_MAX) return 'ช่องไม่รับไม่ถูก';
      if (!takeRule(old, me, head)) return 'ทีมนี้รับใบโอนแบบนี้ไม่ได้';
      if (d.rjName !== nameOf(me, email)) return 'ชื่อผู้ไม่รับไม่ตรงรายชื่อ';
    }
    if (ck) {
      if (old.ck) return 'ใบนี้ตรวจแล้ว';
      if (d.ck !== email) return 'ผู้ตรวจต้องเป็นคนที่ล็อกอิน';
      if (d.ck === old.by) return 'คนทำตรวจใบของตัวเองไม่ได้';
      if (d.ckAt !== C.TIME || typeof d.ckName !== 'string' || d.ckName.length > 60) return 'ช่องผู้ตรวจไม่ถูก';
      if (!takeRule(old, me, head)) return 'ทีมนี้รับใบโอนแบบนี้ไม่ได้';
      if (d.ckName !== nameOf(me, email)) return 'ชื่อผู้ตรวจไม่ตรงรายชื่อ';
    }
    if (ap) {
      if (!head) return 'อนุมัติได้เฉพาะหัวหน้า';
      if (old.ap) return 'ใบนี้อนุมัติแล้ว';
      if (d.ap !== email) return 'ผู้อนุมัติต้องเป็นคนที่ล็อกอิน';
      if (!d.ck) return 'ต้องมีผู้ตรวจก่อนอนุมัติ';
      if (d.apAt !== C.TIME || typeof d.apName !== 'string' || d.apName.length > 60) return 'ช่องผู้อนุมัติไม่ถูก';
      if (d.apName !== nameOf(me, email)) return 'ชื่อผู้อนุมัติไม่ตรงรายชื่อ';
    }
    return '';
  }

  /* ── store จำลองในหน่วยความจำ ─────────────────────────────────────────── */

  /**
   * opt = { data: { path: data } เริ่มต้น, now(), domain, rules (false = ไม่เช็ค), onCommit(dump) }
   * คืนการเชื่อมต่อหนึ่งเครื่อง · connect() = อีกเครื่องที่ใช้ฐานเดียวกัน (ล็อกอินแยกกันแบบคนละเบราว์เซอร์)
   * hook(fn) ให้ fn ทำงานหนึ่งครั้งก่อน transaction ถัดไป commit (เทสต์สองเครื่องบันทึกชนกัน)
   */
  function memStore(opt) {
    opt = opt || {};
    var now = opt.now || Date.now;
    var docs = {};
    var plain = {};   // path → data ชุดเดียวกับ docs (ให้เช็คกฎโดยไม่ต้องสร้างใหม่ทุกครั้ง ห้ามแก้จากข้างนอก)
    var counts = { reads: 0, writes: 0, tx: 0, retries: 0, raced: 0 };
    var listeners = [];
    var hook = null;
    function put(p, d, ver) { docs[p] = { ver: ver, d: d }; plain[p] = d; }
    Object.keys(opt.data || {}).forEach(function (p) { put(p, clone(opt.data[p]), 1); });

    function snapshot() { var o = {}; Object.keys(plain).forEach(function (p) { o[p] = plain[p]; }); return o; }
    /* counts = ทั้งฐาน · own = ของเครื่องนั้น (ตัวนับโควตาของเครื่อง) */
    function read(p, own) { counts.reads++; own.reads++; return docs[p] ? clone(docs[p].d) : null; }
    function apply(writes, own) {
      var t = now(), metaHit = false;
      writes.forEach(function (w) {
        var d = clone(w[1]);
        Object.keys(d).forEach(function (k) { if (d[k] === C.TIME) d[k] = t; });
        put(w[0], d, (docs[w[0]] ? docs[w[0]].ver : 0) + 1);
        if (w[0] === 'meta/head') metaHit = true;
      });
      counts.writes += writes.length;
      own.writes += writes.length;
      if (metaHit) listeners.forEach(function (cb) { cb(clone(docs['meta/head'].d)); });
      if (opt.onCommit) opt.onCommit(snapshot());
    }
    /** เช็คแบบ Rules กับข้อมูลก่อนเขียน (at ที่เก็บแล้วเป็นเวลา ส่วนที่ส่งมาเป็นตัวแทนเวลาเซิร์ฟเวอร์) */
    function check(user, writes) {
      if (opt.rules === false) return '';
      return rulesError(user, plain, writes, opt.domain || '', now());
    }
    function denied(why) { var e = new Error('ไม่มีสิทธิ์เขียน: ' + why); e.code = 'permission-denied'; return e; }

    /** หนึ่งเครื่อง = หนึ่งการเชื่อมต่อ ล็อกอินของใครของมัน */
    function client() {
      var user = null;
      var own = { reads: 0, writes: 0 };
      /** ผลตรวจแถว อ่านได้เฉพาะหัวหน้า (get อื่นไม่จำลอง allow read) */
      function getError(p) {
        if (opt.rules === false || p.indexOf('audit/') !== 0) return '';
        var me = user && docs['users/' + user.email];
        return me && me.d.active === true && me.d.role === 'head' ? '' : 'ผลตรวจดูได้เฉพาะหัวหน้า';
      }
      /** อ่านทั้งคอลเลกชันได้ไหม (แบบ allow list ใน firestore.rules) */
      function listError(col) {
        if (opt.rules === false) return '';
        if (!user) return 'ยังไม่ได้ล็อกอิน';
        var me = docs['users/' + user.email];
        if (!me || me.d.active !== true) return NO_RIGHT;
        if (col === 'users' && me.d.role !== 'head') return 'รายชื่อดูได้เฉพาะหัวหน้า';
        if (col === 'audit' && me.d.role !== 'head') return 'ผลตรวจดูได้เฉพาะหัวหน้า';
        return '';
      }
      return {
        kind: 'mem',
        setUser: function (u) { user = u ? { email: String(u.email || '').toLowerCase(), verified: u.verified !== false } : null; },
        user: function () { return user; },
        get: function (p) { var why = getError(p); return why ? Promise.reject(denied(why)) : Promise.resolve(read(p, own)); },
        getMany: function (ps) { return Promise.resolve(ps.map(function (p) { return read(p, own); })); },
        docsAfter: function (seq, limit) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && +docs[p].d.seq > seq; })
            .sort(function (a, b) { return docs[a].d.seq - docs[b].d.seq || (a < b ? -1 : 1); }).slice(0, limit || PAGE);
          counts.reads += Math.max(1, list.length);
          own.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        /** เอกสารที่แก้เลข TRcloud ตั้งแต่เวลา ms (trAt >= ms) [{id, data}] */
        trAfter: function (ms) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && typeof docs[p].d.trAt === 'number' && docs[p].d.trAt >= ms; });
          counts.reads += Math.max(1, list.length);
          own.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        /** เอกสารที่ตรวจ / อนุมัติตั้งแต่เวลา ms (okAt >= ms) [{id, data}] */
        okAfter: function (ms) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && typeof docs[p].d.okAt === 'number' && docs[p].d.okAt >= ms; });
          counts.reads += Math.max(1, list.length);
          own.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        /** ทุกเอกสารในคอลเลกชัน [{id, data}] */
        list: function (col) {
          var why = listError(col);
          if (why) return Promise.reject(denied(why));
          var ps = Object.keys(docs).filter(function (p) { return p.indexOf(col + '/') === 0 && p.split('/').length === 2; }).sort();
          counts.reads += Math.max(1, ps.length);
          own.reads += Math.max(1, ps.length);
          return Promise.resolve(ps.map(function (p) { return { id: p.slice(col.length + 1), data: clone(docs[p].d) }; }));
        },
        /*
         * ลำดับแบบฐานจริง (emulator): Rules ตัดสินกับข้อมูลปัจจุบันก่อนเช็คชนรุ่น · update = ช่องที่แก้ทับเอกสารปัจจุบัน
         * ชนรุ่นแล้ว Rules ไม่รับ = ฐานจริงตอบ permission-denied แล้ว firestoreStore.tx เห็นว่าเอกสารที่อ่านเปลี่ยน จึงเปิดใหม่ (raced)
         * ชนรุ่นแล้ว Rules รับ = SDK ลองใหม่เอง (aborted) · ทั้งสองทางจึงลองใหม่ แต่นับแยกให้เทสต์รู้ว่าผ่านทางไหน
         */
        tx: async function (fn) {
          counts.tx++;
          for (var a = 0; a < TX_TRIES; a++) {
            var seen = {}, writes = [];
            var t = {
              get: function (p) { counts.reads++; own.reads++; seen[p] = docs[p] ? docs[p].ver : 0; return Promise.resolve(docs[p] ? clone(docs[p].d) : null); },
              set: function (p, d) { writes.push([p, clone(d)]); },
              /** แก้บางช่องของเอกสารที่มีอยู่ (update) ไม่มีเอกสาร = ผิดแบบ Firestore */
              patch: function (p, fields) {
                if (!docs[p]) throw new Error('ไม่พบเอกสาร ' + p);
                var d = clone(docs[p].d);
                Object.keys(fields).forEach(function (k) { d[k] = clone(fields[k]); });
                writes.push([p, d, clone(fields)]);
              },
            };
            var out = await fn(t);
            if (hook) { var h = hook; hook = null; await h(); }
            var clash = Object.keys(seen).some(function (p) { return (docs[p] ? docs[p].ver : 0) !== seen[p]; });
            if (clash) {
              var gone = writes.some(function (w) { return w[2] && !docs[w[0]]; });
              var cur = writes.map(function (w) {
                if (!w[2] || gone) return [w[0], w[1]];
                var d = clone(docs[w[0]].d);
                Object.keys(w[2]).forEach(function (k) { d[k] = clone(w[2][k]); });
                return [w[0], d];
              });
              if (writes.length && !gone && check(user, cur)) counts.raced++;
              counts.retries++;
              continue;
            }
            if (writes.length) {
              writes = writes.map(function (w) { return [w[0], w[1]]; });
              var why = check(user, writes);
              if (why) throw denied(why);
              apply(writes, own);
            }
            return out;
          }
          throw new Error('บันทึกชนกับเครื่องอื่นเกิน ' + TX_TRIES + ' ครั้ง ลองกดส่งใหม่');
        },
        commit: function (writes) {
          var why = check(user, writes);
          if (why) return Promise.reject(denied(why));
          apply(writes, own);
          return Promise.resolve();
        },
        /** เขียนเฉพาะบางช่อง ช่องอื่นคงเดิม (setDoc merge) */
        patch: function (p, fields) {
          var d = docs[p] ? clone(docs[p].d) : {};
          Object.keys(fields).forEach(function (k) { d[k] = clone(fields[k]); });
          return this.commit([[p, d]]);
        },
        /** ฟัง meta/head แบบ onSnapshot: ตอนเริ่มอ่าน 1 ครั้ง และทุกครั้งที่ meta เปลี่ยนอ่าน 1 ครั้ง (นับเข้าเครื่องที่ฟัง) */
        onMeta: function (cb) {
          var l = function (m) { counts.reads++; own.reads++; cb(m); };
          listeners.push(l);
          Promise.resolve().then(function () { if (listeners.indexOf(l) >= 0 && docs['meta/head']) l(clone(docs['meta/head'].d)); else { counts.reads++; own.reads++; } });
          return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
        },
        hook: function (fn) { hook = fn; },
        stats: function () { return clone(counts); },
        mine: function () { return clone(own); },
        dump: snapshot,
        connect: client,
        /** เขียนตรงไม่ผ่านกฎ ใช้ตั้งข้อมูลทดลองเท่านั้น */
        seed: function (data) { Object.keys(data).forEach(function (p) { put(p, clone(data[p]), (docs[p] ? docs[p].ver : 0) + 1); }); },
        /** ล้างฐานแล้วใส่ data แทนทั้งหมด (กู้คืนจากไฟล์สำรองในฐานทดลอง เหมือนสคริปต์กู้คืนที่ใช้สิทธิ์เจ้าของโปรเจกต์) */
        replace: function (data) {
          Object.keys(docs).forEach(function (p) { delete docs[p]; delete plain[p]; });
          Object.keys(data || {}).forEach(function (p) { put(p, clone(data[p]), 1); });
          if (opt.onCommit) opt.onCommit(snapshot());
        },
      };
    }
    return client();
  }

  /* ── Firestore จริง (เฉพาะเว็บที่ deploy) ─────────────────────────────── */

  var sdk = null;
  function loadSdk() {
    if (!sdk) {
      sdk = Promise.all(['firebase-app', 'firebase-firestore', 'firebase-auth'].map(function (m) { return import(SDK_URL + m + '.js'); }))
        .then(function (mods) { return { app: mods[0], fs: mods[1], auth: mods[2] }; });
    }
    return sdk;
  }

  /** config = Firebase web config ของโปรเจกต์บริษัท · คืน { store, app } หลังโหลด SDK */
  async function firestoreStore(config) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) throw new Error('dev server ห้ามต่อ Firebase จริง ใช้ store จำลอง');
    var m = await loadSdk(), F = m.fs;
    var app = m.app.getApps().length ? m.app.getApp() : m.app.initializeApp(config);
    var db = F.getFirestore(app);
    var counts = { reads: 0, writes: 0, tx: 0, retries: 0 };
    function ref(p) { return F.doc(db, p); }
    function out(snap) {
      counts.reads++;
      if (!snap.exists()) return null;
      var d = snap.data();
      Object.keys(d).forEach(function (k) { if (d[k] && typeof d[k].toMillis === 'function') d[k] = d[k].toMillis(); });
      return d;
    }
    function inn(d) {
      var o = {};
      Object.keys(d).forEach(function (k) { o[k] = d[k] === C.TIME ? F.serverTimestamp() : d[k]; });
      return o;
    }
    /** เอกสารที่ transaction อ่านไว้ (path → stable ของค่าที่อ่าน) ตอนนี้ในฐานต่างไปไหม · อ่านจากเซิร์ฟเวอร์ ไม่ใช้แคช · อ่านไม่ได้ = ถือว่าไม่ต่าง */
    async function moved(seen) {
      var ps = Object.keys(seen);
      if (!ps.length) return false;
      var get = F.getDocFromServer || F.getDoc;
      try {
        var cur = await Promise.all(ps.map(function (p) { return get(ref(p)).then(out); }));
        return ps.some(function (p, i) { return stable(cur[i]) !== seen[p]; });
      } catch (e) { return false; }
    }
    var store = {
      kind: 'firestore',
      setUser: function () {},
      get: function (p) { return F.getDoc(ref(p)).then(out); },
      getMany: function (ps) { return Promise.all(ps.map(function (p) { return F.getDoc(ref(p)).then(out); })); },
      docsAfter: function (seq, limit) {
        var q = F.query(F.collection(db, 'docs'), F.where('seq', '>', seq), F.orderBy('seq'), F.limit(limit || PAGE));
        return F.getDocs(q).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      trAfter: function (ms) {
        var q = F.query(F.collection(db, 'docs'), F.where('trAt', '>=', F.Timestamp.fromMillis(ms)));
        return F.getDocs(q).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      okAfter: function (ms) {
        var q = F.query(F.collection(db, 'docs'), F.where('okAt', '>=', F.Timestamp.fromMillis(ms)));
        return F.getDocs(q).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      /*
       * SDK ลองใหม่เองเมื่อชนรุ่น (aborted) แต่ฐานตัดสิน Rules กับข้อมูลปัจจุบันก่อนเช็คชนรุ่น (เห็นจาก emulator)
       * เครื่องอื่นเขียนแทรกระหว่างอ่านกับ commit → ได้ permission-denied (เช่น meta.seq ต้อง +1 จากค่าปัจจุบัน) ซึ่ง SDK ไม่ลองใหม่
       * ถูกปฏิเสธ + เอกสารที่ transaction อ่านเปลี่ยนไปแล้ว = ชน ไม่ใช่ไม่มีสิทธิ์ → เปิด transaction ใหม่ (fn คิดจากข้อมูลใหม่)
       * เอกสารที่อ่านไม่เปลี่ยน = ปฏิเสธจริง ส่งต่อให้หน้าเหมือนเดิม (ชื่อเปลี่ยน ทีมเปลี่ยน ไม่มีสิทธิ์) · อ่านเพิ่มเฉพาะตอนถูกปฏิเสธ
       */
      tx: async function (fn) {
        counts.tx++;
        for (var a = 0; ; a++) {
          var seen = {};
          try {
            return await F.runTransaction(db, function (t) {
              seen = {};
              return fn({
                get: function (p) { return t.get(ref(p)).then(function (s) { var d = out(s); seen[p] = stable(d); return d; }); },
                set: function (p, d) { counts.writes++; t.set(ref(p), inn(d)); },
                patch: function (p, d) { counts.writes++; t.update(ref(p), inn(d)); },
              });
            });
          } catch (e) {
            if (!e || e.code !== 'permission-denied' || !(await moved(seen))) throw e;
            if (a + 1 >= RACE_TRIES) { var x = new Error(RACE_ERR); x.code = 'aborted'; throw x; }
            counts.retries++;
          }
        }
      },
      list: function (col) {
        return F.getDocs(F.collection(db, col)).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      commit: function (writes) {
        var b = F.writeBatch(db);
        writes.forEach(function (w) { b.set(ref(w[0]), inn(w[1])); });
        counts.writes += writes.length;
        return b.commit();
      },
      patch: function (p, fields) {
        counts.writes++;
        return F.setDoc(ref(p), inn(fields), { merge: true });
      },
      onMeta: function (cb, err) {
        return F.onSnapshot(ref('meta/head'), function (snap) { var d = out(snap); if (d) cb(d); }, function (e) { if (err) err(e); });
      },
      stats: function () { return clone(counts); },
      mine: function () { return clone(counts); },
    };
    return { store: store, app: app, sdk: m };
  }

  /* ── ล็อกอิน ──────────────────────────────────────────────────────────── */

  /** บัญชีทดลอง (dev / เทสต์) list = [{email, name}] */
  function fakeAuth(list) {
    var cur = null;
    return {
      kind: 'fake',
      list: function () { return (list || []).slice(); },
      current: function () { return cur; },
      signIn: function (email) {
        var e = String(email || '').toLowerCase();
        cur = { email: e, verified: true, name: ((list || []).filter(function (x) { return x.email === e; })[0] || {}).name || e };
        return Promise.resolve(cur);
      },
      signOut: function () { cur = null; return Promise.resolve(); },
    };
  }

  /** Google ของบริษัท ป๊อปอัปเท่านั้น (redirect พังบน GitHub Pages) · domain = โดเมนอีเมลบริษัท */
  function googleAuth(fire, domain) {
    var a = fire.sdk.auth, auth = a.getAuth(fire.app), cur = null;
    return {
      kind: 'google',
      current: function () { return cur; },
      ready: function () {
        return new Promise(function (res) {
          var off = a.onAuthStateChanged(auth, function (u) {
            off();
            cur = u ? { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified, name: u.displayName || u.email } : null;
            res(cur);
          });
        });
      },
      signIn: function () {
        var p = new a.GoogleAuthProvider();
        p.setCustomParameters(domain ? { hd: domain, prompt: 'select_account' } : { prompt: 'select_account' });
        return a.signInWithPopup(auth, p).then(function (r) {
          var u = r.user;
          cur = { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified, name: u.displayName || u.email };
          return cur;
        });
      },
      signOut: function () { cur = null; return a.signOut(auth); },
    };
  }

  /* ── สำเนาในเครื่อง ──────────────────────────────────────────────────── */

  /* tv = รุ่นเลข TRcloud ที่เครื่องนี้ดึงแล้ว (null = ยังไม่เคย) · trAt = เวลาแก้เลข TRcloud ล่าสุดที่เห็น · trc = ยอด TRcloud ล่าสุด {key, id, data}
     ov / okAt = รุ่นการตรวจ / อนุมัติที่ดึงแล้ว / เวลาตรวจ / อนุมัติล่าสุดที่เห็น */
  function emptyLocal() { return { v: C.V, seq: 0, meta: null, docs: [], piles: {}, master: {}, mv: -1, tv: null, ov: null, trAt: 0, okAt: 0, trc: null }; }

  function memCache() {
    var saved = null;
    return {
      load: function () { return Promise.resolve(saved ? clone(saved) : null); },
      put: function (local) { saved = clone(local); return Promise.resolve(); },
      clear: function () { saved = null; return Promise.resolve(); },
    };
  }

  /** IndexedDB: เอกสารเก็บทีละรายการ (ต่อท้ายเฉพาะของใหม่) ที่เหลือเก็บเป็นก้อนเดียว */
  function idbCache(name) {
    var dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise(function (res, rej) {
          var r = indexedDB.open(name || 'wms-fire', 1);
          r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('docs', { keyPath: 'id' }); d.createObjectStore('kv'); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      }
      return dbp;
    }
    function done(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error); }; }); }
    function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
    return {
      load: async function () {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readonly');
        var kv = await req(tx.objectStore('kv').get('state'));
        var list = await req(tx.objectStore('docs').getAll());
        if (!kv) return null;
        kv.docs = list.sort(function (a, b) { return a.seq - b.seq; });
        return kv;
      },
      put: async function (local, added) {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readwrite'), ds = tx.objectStore('docs');
        (added || local.docs).forEach(function (x) { ds.put(x); });
        tx.objectStore('kv').put({ v: local.v, seq: local.seq, meta: local.meta, piles: local.piles, master: local.master, mv: local.mv, mk: local.mk || '',
          tv: local.tv === undefined ? null : local.tv, ov: local.ov === undefined ? null : local.ov, trAt: local.trAt || 0, okAt: local.okAt || 0, trc: local.trc || null }, 'state');
        return done(tx);
      },
      clear: async function () {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readwrite');
        tx.objectStore('docs').clear();
        tx.objectStore('kv').clear();
        return done(tx);
      },
    };
  }

  /** ที่เก็บตัวนับโควตาของเครื่อง (ค่าเริ่มต้นในหน่วยความจำ หน้าเว็บใช้ storeMeter ใน localStorage) */
  function memMeter() {
    var v = null;
    return { load: function () { return clone(v); }, save: function (o) { v = clone(o); } };
  }
  function storeMeter(key) {
    return {
      load: function () { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
      save: function (o) { try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {} },
    };
  }

  /* ── ตัวสมุด ──────────────────────────────────────────────────────────── */

  /**
   * opt = { store, auth, cache, now(), partBytes, domain โดเมนอีเมลบริษัท, meter ที่เก็บตัวนับโควตา }
   * คืน fire: login, logout, sync, fifo, post, local, user, watch, usage, users, saveUser, quota, reload
   */
  function open(opt) {
    var store = opt.store, auth = opt.auth || fakeAuth([]), cache = opt.cache || memCache();
    var now = opt.now || Date.now;
    var domain = String(opt.domain || '').toLowerCase();
    var meter = opt.meter || memMeter();
    var local = emptyLocal(), loaded = false, user = null, syncing = null;
    var checked = false;   // ถามฐานแล้วอย่างน้อยหนึ่งครั้ง (ก่อนนั้นยังไม่รู้ว่ามียอดยกมาหรือยัง)
    var mark = (function () { var s = store.mine ? store.mine() : store.stats(); return { reads: s.reads, writes: s.writes }; })();

    /* ── ตัวนับโควตาของเครื่องนี้ (วันตามเวลาแปซิฟิกแบบ Firebase) ── */
    function used() { return store.mine ? store.mine() : store.stats(); }
    function tally() {
      var s = used(), day = C.pacificDay(now());
      var m = meter.load() || {};
      if (!m.dev) m.dev = 'd' + Math.random().toString(36).slice(2, 10);
      if (m.day !== day) { m.day = day; m.reads = 0; m.writes = 0; m.sent = 0; m.sentAt = 0; }
      if (mark) { m.reads += Math.max(0, s.reads - mark.reads); m.writes += Math.max(0, s.writes - mark.writes); }
      mark = { reads: s.reads, writes: s.writes };
      meter.save(m);
      return m;
    }
    /** ส่งยอดของเครื่องนี้ไปรวมที่ use/{วัน} (ชั่วโมงละครั้ง หรือทันทีตอนเปิดหน้าโควตา) เขียนพลาดไม่เป็นไร */
    async function report(force) {
      if (!user) return;
      var m = tally();
      if (!force && now() - (m.sentAt || 0) < REPORT_EVERY) return;
      if (m.reads + m.writes === m.sent) return;
      var entry = {};
      entry[m.dev] = { r: m.reads, w: m.writes + 1, by: user.name };
      try {
        await store.patch('use/' + m.day, entry);
        m = tally();
        m.sent = m.reads + m.writes;
        m.sentAt = now();
        meter.save(m);
      } catch (e) {}
    }

    function reply(o) { if (o && typeof o === 'object' && !Array.isArray(o)) { o.v = C.API_V; if (!o.error) o.app = 'book'; } return o; }
    function fail(msg, extra) { var o = { error: msg }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return reply(o); }

    async function ensureLoaded() {
      if (loaded) return;
      loaded = true;
      try {
        var got = await cache.load();
        if (got && got.v === C.V) local = got;
      } catch (e) { local = emptyLocal(); }
    }

    /** ตารางหลักทุกชนิดจากฐาน { kind: เอกสาร } (อ่านชนิดละ 1 ครั้ง) */
    async function readMasters() {
      var all = MASTERS.concat(SETUP), out = {};
      var ms = await store.getMany(all.map(function (n) { return 'master/' + n; }));
      all.forEach(function (n, j) { if (ms[j]) out[n] = ms[j]; });
      return out;
    }

    /**
     * ดึงเฉพาะของใหม่: เอกสารที่ seq ใหม่กว่า (เข้ายอดต่อกองในเครื่องตามลำดับ) master ที่ mv เปลี่ยน
     * ก่อนลงยอดยกมา (ไม่มี meta) ยังไม่มีเลขรุ่นให้เทียบ: อ่านตารางหลักทุกครั้งที่ดึง
     */
    /** เครื่องนี้มีของรอรับไหม (ไม่นับใบที่ไม่รับแล้ว รอหัวหน้ายกเลิก) */
    function waiting() { return C.holdList(local).some(function (h) { return h.docs.some(function (e) { return !e.rj; }); }); }

    async function syncNow() {
      await ensureLoaded();
      var meta = await store.get('meta/head');
      var added = [];
      if (!meta) {
        if (local.seq) { local = emptyLocal(); await cache.clear(); }
        local.meta = null;
        checked = true;
        if (!user) return { seq: 0, added: 0 };   // ยังไม่เข้าระบบ อ่านตารางหลักไม่ได้
        var early = await readMasters();
        /* mv -1 = ลงยอดยกมาเมื่อไร (mv เริ่มที่ 0) ดึงใหม่อีกรอบเสมอ เผื่อมีคนแก้หลังรอบนี้ */
        var moved = local.mv !== -1 || JSON.stringify(early) !== JSON.stringify(local.master || {});
        local.mv = -1;
        if (moved) {
          local.master = early;
          try { await cache.put(local, []); } catch (e) {}
        }
        return { seq: 0, added: 0 };
      }
      checked = true;
      if (meta.v !== C.V || local.v !== C.V || meta.seq < local.seq) { local = emptyLocal(); try { await cache.clear(); } catch (e) {} }
      var fresh = !local.seq, trFrom = local.trAt || 0, okFrom = local.okAt || 0, trFloor = null, okFloor = null;
      /* เครื่องใหม่ / ตามหลังมาก: อ่านเดือนที่ปิดแล้วเป็นก้อน (ทีละไม่กี่ร้อย KB) แทนทีละเอกสาร */
      if ((fresh || meta.seq - local.seq > ARCH_GAP) && window.WmsFireTrc) {
        var ar = await fromArch();
        added = added.concat(ar.added);
        trFloor = ar.floor;
        okFloor = ar.okFloor === undefined ? null : ar.okFloor;
      }
      var guard = 0;
      while (local.seq < meta.seq && guard++ < 10000) {
        var list = await store.docsAfter(local.seq, PAGE);
        if (!list.length) break;
        var mains = [], parts = Object.create(null), was = local.seq, top = was;
        list.forEach(function (x) {
          top = Math.max(top, C.safeNum(x.data.seq));
          if (!has(x.data, 'of')) mains.push(x);
          else if (typeof x.data.of === 'string') (parts[x.data.of] || (parts[x.data.of] = [])).push(x.data);
        });
        for (var i = 0; i < mains.length; i++) {
          var m = mains[i], have = parts[m.id] || [], miss = partPaths(m.id, m.data.part, have);
          if (miss.length) (await store.getMany(miss)).forEach(function (p) { if (p) have.push(p); });
          var d = C.docIn(m.id, m.data, have);
          local.docs.push(d);
          local.piles = C.applyDoc(local.piles || {}, d);
          added.push(d);
          local.seq = Math.max(local.seq, d.seq);
          if (d.trAt > (local.trAt || 0)) local.trAt = d.trAt;
          if (d.okAt > (local.okAt || 0)) local.okAt = d.okAt;
        }
        /* หน้าที่มีแต่ส่วนกำพร้า: ข้ามไป ไม่หยุดทุกเครื่องไว้ตรงนั้น */
        if (local.seq <= was) {
          if (top <= was) break;
          local.seq = top;
        }
      }
      /*
       * เลข TRcloud ที่มีคนใส่ทีหลัง (แก้เอกสารเก่า seq ไม่เปลี่ยน): tv ใน meta เปลี่ยน = ดึงเอกสารที่ trAt ใหม่กว่าที่เคยเห็น
       * นับจากก่อนดึงรอบนี้ (เอกสารใหม่ในรอบนี้อาจมี trAt ใหม่กว่าเอกสารเก่าที่เพิ่งแก้) · อ่านก้อนปิดเดือน = ดึงตั้งแต่วันปิดล่าสุด
       */
      var tv = +meta.tv || 0, ov = +meta.ov || 0, byId = null;
      var ids = function () {
        if (!byId) { byId = Object.create(null); local.docs.forEach(function (x) { byId[x.id] = x; }); }
        return byId;
      };
      if (local.tv === null || local.tv === undefined) local.tv = fresh && trFloor === null ? tv : -1;
      if (local.ov === null || local.ov === undefined) local.ov = fresh && trFloor === null ? ov : -1;
      if (local.tv !== tv || trFloor !== null) {
        ids();
        var floor = trFloor === null ? trFrom : fresh ? trFloor : Math.min(trFloor, trFrom);
        (await store.trAfter(floor)).forEach(function (x) {
          var d = byId[x.id], t = C.safeTime(x.data.trAt);
          if (t > (local.trAt || 0)) local.trAt = t;   // ใบที่ข้ามก็ขยับจุดเริ่ม ไม่อ่านซ้ำทุกครั้งที่มีคนแก้เลข
          if (!d || has(x.data, 'of')) return;
          d.tr = C.safeText(x.data.tr);
          d.trState = C.safeText(x.data.trState);
          d.trBy = C.safeText(x.data.trBy);
          d.trAt = t;
          delete d.trLog;
          C.trLogIn(d, x.data);
          if (added.indexOf(d) < 0) added.push(d);
        });
        local.tv = tv;
      }
      /* ตรวจ / อนุมัติที่มีคนกดทีหลัง (ov ใน meta +1) ดึงตาม okAt แบบเดียวกับเลข TRcloud · อ่านก้อนปิดเดือน = ดึงตั้งแต่วันปิดล่าสุด */
      if (store.okAfter && (local.ov !== ov || trFloor !== null)) {
        ids();
        var of = okFloor === null ? trFloor : okFloor;
        var oFloor = trFloor === null ? okFrom : fresh ? of : Math.min(of, okFrom);
        (await store.okAfter(oFloor)).forEach(function (x) {
          var d = byId[x.id], t = C.safeTime(x.data.okAt);
          if (t > (local.okAt || 0)) local.okAt = t;
          if (!d || has(x.data, 'of')) return;
          C.OK_KEYS.forEach(function (k) { delete d[k]; });
          C.okIn(d, x.data);
          if (added.indexOf(d) < 0) added.push(d);
        });
        local.ov = ov;
      }
      /* ยอด TRcloud ล่าสุดที่หัวหน้านำเข้า (meta.trc = 'วันที่#รุ่น') ดึงเมื่อเปลี่ยน */
      if (meta.trc && (!local.trc || local.trc.key !== meta.trc)) {
        var id = String(meta.trc).split('#')[0];
        var td = await store.get('trc/' + id);
        local.trc = td ? { key: meta.trc, id: id, data: td } : null;
      }
      /* mk = ชนิดตารางที่สำเนานี้ดึงไว้: รุ่นหน้าใหม่มีชนิดเพิ่ม (เช่น zone) = ดึงใหม่ครั้งเดียว แม้ mv เท่าเดิม */
      var all = MASTERS.concat(SETUP), mk = all.join(' '), mv = +meta.mv || 0;
      /* ตารางที่ตั้งก่อนยอดยกมา mv ยังเป็น 0 ก็ต้องตามชนิดใหม่เหมือนกัน */
      if (mv !== local.mv || (local.mk !== mk && (mv > 0 || Object.keys(local.master || {}).length))) {
        local.master = await readMasters();
        local.mv = mv;
        local.mk = mk;
      }
      local.meta = meta;
      try { await cache.put(local, added); } catch (e) {}
      return { seq: local.seq, added: added.length };
    }

    /**
     * อ่านเดือนที่ปิดแล้วต่อจากเอกสารล่าสุดในเครื่อง (arch/index → ก้อน → เอกสารใหญ่ที่ไม่อยู่ในก้อน → เลข TRcloud หลังปิด)
     * ก้อนหาย / อ่านไม่ได้ / seq ไม่ต่อกัน = หยุดตรงนั้น ที่เหลือดึงทีละเอกสารตามเดิม
     * → { added, floor } floor = เวลาที่ต้องดึงเลข TRcloud ต่อ (null = ไม่ได้อ่านก้อน)
     */
    async function fromArch() {
      var none = { added: [], floor: null };
      var idx = null;
      try { idx = await store.get('arch/index'); } catch (e) { return none; }
      var use = T().archUse(idx, local.seq);
      if (!use.length) return none;
      var added = [], byId = Object.create(null);
      for (var u = 0; u < use.length; u++) {
        var mo = use[u], list = [], ok = true;
        var ids = [];
        for (var k = 1; k <= +mo.n; k++) ids.push('arch/' + mo.m + '-' + k);
        var got = await store.getMany(ids);
        for (var g = 0; g < got.length && ok; g++) {
          var ds = got[g] ? T().archDocs(got[g]) : null;
          if (!ds) ok = false;
          else list = list.concat(ds);
        }
        for (var s = 0; s < (mo.skip || []).length && ok; s++) {
          var main = await store.get('docs/' + mo.skip[s]);
          if (!main) { ok = false; break; }
          var have = [], pids = partPaths(mo.skip[s], main.part, have);
          if (pids.length) (await store.getMany(pids)).forEach(function (p) { if (p) have.push(p); });
          list.push(C.docIn(mo.skip[s], main, have));
        }
        if (!ok) break;
        list = list.filter(function (d) { return d.seq > local.seq; }).sort(function (a, b) { return a.seq - b.seq; });
        var run = list.every(function (d, i) { return d.seq === local.seq + 1 + i; }) && list.length && list[list.length - 1].seq === +mo.to;
        if (!run) break;
        list.forEach(function (d) {
          local.docs.push(d);
          local.piles = C.applyDoc(local.piles || {}, d);
          added.push(d);
          byId[d.id] = d;
        });
        local.seq = +mo.to;
      }
      if (!added.length) return none;
      /* เลข TRcloud ที่ใส่หลังปิดเดือนก่อน ๆ (ก้อนเก่าเป็นค่าตอนปิด) */
      var on = idx.ov ? +idx.ov.n || 0 : 0;
      if (on) {
        var ovIds = [];
        var ovBase = 'arch/ov-' + (idx.ov.m ? idx.ov.m + '-' : '');   // ไม่มี m = ปิดก่อนแยกชุดตามเดือน
        for (var o = 1; o <= on; o++) ovIds.push(ovBase + o);
        (await store.getMany(ovIds)).forEach(function (c) {
          T().archFix(c).forEach(function (e) {
            var d = byId[e[0]];
            if (!d) return;
            if (+e[4] >= (d.trAt || 0)) {
              d.tr = e[1] || ''; d.trState = e[2] || ''; d.trBy = e[3] || ''; d.trAt = +e[4] || 0;
              if (e[15]) C.trLogIn(d, { trLog: e[15] });
            }
            /* ตรวจ / อนุมัติหลังปิดเดือน [.., ck, ckName, ckAt, ap, apName, apAt, okAt (, rj, rjName, rjWhy (, trLog))] · มีแต่ประวัติเลข = okAt ว่าง */
            if (e.length > 5 && +e[11] > 0 && +e[11] >= (d.okAt || 0)) {
              C.OK_KEYS.forEach(function (k) { delete d[k]; });
              C.okIn(d, { ck: e[5], ckName: e[6], ckAt: +e[7] || 0, ap: e[8], apName: e[9], apAt: +e[10] || 0, okAt: +e[11] || 0, rj: e[12], rjName: e[13], rjWhy: e[14] });
            }
          });
        });
      }
      return { added: added, floor: T().archFloor(idx), okFloor: T().archFloor(idx, 'okAt') };
    }

    function sync() {
      if (!syncing) {
        syncing = syncNow().finally(function () { syncing = null; tally(); report(false); });
      }
      return syncing;
    }

    /** ดึงรอบใหม่ที่เริ่มหลังการบันทึก (รอบที่ค้างอยู่อาจอ่านไปก่อนบันทึกเสร็จ) */
    async function syncAfter() {
      if (syncing) { try { await syncing; } catch (e) {} }
      return sync();
    }

    function inDomain(e) { return !domain || e.slice(-(domain.length + 1)) === '@' + domain; }

    /** เข้าด้วยบัญชีที่ auth ให้มา (Google ป๊อปอัป / บัญชีทดลอง) แล้วเช็ครายชื่อใน users/{อีเมล} */
    async function enter(u) {
      if (!u || !u.email) return fail('ยังไม่ได้เลือกบัญชี');
      if (!inDomain(u.email)) {
        try { await auth.signOut(); } catch (e) {}
        return fail(u.email + ' ไม่ใช่อีเมลบริษัท ใช้บัญชี @' + domain + ' เท่านั้น', { noRight: 1 });
      }
      if (u.verified === false) { try { await auth.signOut(); } catch (e) {} return fail('อีเมลนี้ยังไม่ยืนยันกับ Google'); }
      store.setUser(u);
      var prof = null;
      try { prof = await store.get('users/' + u.email); } catch (e) { prof = null; }
      if (!prof || prof.active !== true) {
        user = null; store.setUser(null);
        try { await auth.signOut(); } catch (e) {}
        return fail(u.email + ' ' + NO_RIGHT.replace('บัญชีนี้', ''), { noRight: 1 });
      }
      user = { email: u.email, name: prof.name || u.email, role: ROLES.indexOf(prof.role) >= 0 ? prof.role : 'viewer', team: prof.team === C.TEAM_QA ? C.TEAM_QA : '' };
      /* เวลาเข้าล่าสุด หัวหน้าเห็นในหน้าตั้งค่า เขียนไม่เกินชั่วโมงละครั้ง พลาดไม่เป็นไร */
      if (!(+prof.last > 0) || now() - prof.last > LAST_EVERY) { try { await store.patch('users/' + u.email, { last: C.TIME }); } catch (e) {} }
      tally();
      return reply({ who: user.name, role: ROLE_TH[user.role], mode: 'book', email: user.email });
    }

    async function login(email) {
      var u;
      try { u = typeof email === 'string' ? await auth.signIn(email) : await auth.signIn(); }
      catch (e) { return fail(/popup|cancel/i.test(String(e && (e.code || e.message))) ? 'ปิดหน้าต่างเลือกบัญชีก่อนเลือก ลองกดอีกครั้ง' : String(e && e.message || e)); }
      return enter(u);
    }
    /** เปิดหน้าใหม่: บัญชีที่ค้างไว้ในเบราว์เซอร์ (Google จำให้) เข้าให้เองโดยไม่เด้งหน้าต่าง · ไม่มี = null */
    async function restore() {
      var u = auth.ready ? await auth.ready() : auth.current();
      return u ? enter(u) : null;
    }

    function logout() { user = null; store.setUser(null); return auth.signOut(); }

    /* ── รายชื่อคนใช้ (หัวหน้า) ── */

    function userRow(id, d) {
      d = d || {};
      return { email: id, name: d.name || '', role: ROLES.indexOf(d.role) >= 0 ? d.role : 'viewer', team: d.team === C.TEAM_QA ? C.TEAM_QA : '', active: d.active === true, last: +d.last || 0, by: d.by || '', at: +d.at || 0 };
    }
    async function users() {
      if (!user || user.role !== 'head') return fail('รายชื่อดูได้เฉพาะหัวหน้า');
      var list;
      try { list = await store.list('users'); } catch (e) { return fail(String(e && e.message || e)); }
      tally();
      var order = { head: 0, staff: 1, viewer: 2 };
      var out = list.map(function (x) { return userRow(x.id, x.data); }).sort(function (a, b) {
        return (+b.active - +a.active) || (order[a.role] - order[b.role]) || a.name.localeCompare(b.name, 'th') || (a.email < b.email ? -1 : 1);
      });
      return reply({ users: out, domain: domain });
    }
    /** เพิ่มหรือแก้คน (ชื่อ สิทธิ์ ทีม เปิด/ปิด) ไม่ลบ: คนที่ออกให้ปิดไว้ ชื่อในเอกสารเก่ายังอ่านได้ · ไม่ส่ง team = คงทีมเดิม */
    async function saveUser(email, data) {
      if (!user || user.role !== 'head') return fail('แก้รายชื่อได้เฉพาะหัวหน้า');
      data = data || {};
      var e = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fail('อีเมลไม่ถูกรูปแบบ');
      if (!inDomain(e)) return fail('ต้องเป็นอีเมล @' + domain + ' เท่านั้น');
      var name = C.plain(data.name, 60);
      if (!name) return fail('ต้องใส่ชื่อ');
      if (ROLES.indexOf(data.role) < 0) return fail('สิทธิ์ต้องเป็น หัวหน้า ลงรายการ หรือ ดูอย่างเดียว');
      if (data.team !== undefined && C.TEAMS.indexOf(data.team) < 0) return fail('ทีมต้องเป็น คลัง / Inbound หรือ QA');
      var active = data.active !== false;
      if (e === user.email && (data.role !== 'head' || !active)) return fail('ลดสิทธิ์หรือปิดบัญชีตัวเองไม่ได้ ให้หัวหน้าอีกคนทำ');
      var list;
      try { list = await store.list('users'); } catch (err) { return fail(String(err && err.message || err)); }
      var old = null, heads = 0;
      list.forEach(function (x) {
        if (x.id === e) old = x.data;
        else if (x.data && x.data.active === true && x.data.role === 'head') heads++;
      });
      if (!(data.role === 'head' && active) && !heads) return fail('ต้องมีหัวหน้าที่ใช้งานได้อย่างน้อย 1 คน');
      if (old && data.add) return fail(e + ' มีในรายชื่อแล้ว (' + (old.name || '') + ')');
      var fields = { name: name, role: data.role, active: active, by: user.email, at: C.TIME };
      var team = data.team !== undefined ? data.team : (old && old.team) || '';
      if (team || (old && old.team)) fields.team = team;
      try {
        await store.patch('users/' + e, fields);
      } catch (err) { return fail(String(err && err.message || err)); }
      if (e === user.email) user.name = name;   // แก้ชื่อตัวเอง เอกสารถัดไปใช้ชื่อใหม่ (Rules เทียบกับรายชื่อ)
      tally();
      return reply({ user: userRow(e, { name: name, role: data.role, team: team, active: active, last: old && old.last, by: user.email, at: now() }), added: !old });
    }

    /** ถูกปฏิเสธเพราะหัวหน้าแก้ชื่อระหว่างเปิดหน้าไหม (Rules เทียบชื่อในเอกสารกับรายชื่อ) ใช่ = ใช้ชื่อใหม่แล้วลองอีกครั้ง */
    async function renamed(e) {
      if (!user || !e || e.code !== 'permission-denied') return false;
      var prof;
      try { prof = await store.get('users/' + user.email); } catch (err) { return false; }
      var name = prof && prof.active === true ? prof.name || user.email : '';
      if (!name || name === user.name) return false;
      user.name = name;
      return true;
    }

    /* ── โควตา ── */

    /** วันนี้ (เวลาแปซิฟิก): เครื่องนี้ · ทุกเครื่องที่ส่งยอดมา (use/{วัน}) · เอกสารที่บันทึกวันนี้ทั้งระบบ */
    async function quota() {
      if (user) { try { await sync(); } catch (e) {} }   // เอกสารวันนี้นับจากสำเนา ดึงของใหม่ก่อน
      await report(true);
      var m = tally(), day = m.day;
      var docs = 0, dw = 0;
      (local.docs || []).forEach(function (d) { if (d.at && C.pacificDay(d.at) === day) { docs++; dw += (d.part || 1) + 1; } });
      var all = null;
      if (user) {
        try {
          var u = await store.get('use/' + day);
          m = tally();   // ช่องของเครื่องนี้ใช้ยอดล่าสุด (รวมการอ่านครั้งนี้)
          if (u) {
            all = { reads: 0, writes: 0, list: [] };
            Object.keys(u).forEach(function (k) {
              var x = u[k] || {};
              if (k === m.dev) x = { r: m.reads, w: m.writes, by: x.by };
              var r = C.safeNum(x.r), w = C.safeNum(x.w);   // ทุกคนในรายชื่อเขียนช่องนี้ได้
              all.reads += r;
              all.writes += w;
              all.list.push({ dev: k, me: k === m.dev, by: C.safeText(x.by), r: r, w: w });
            });
            all.list.sort(function (a, b) { return (b.r + b.w) - (a.r + a.w); });
          }
        } catch (e) { all = null; }
      }
      m = tally();
      return { day: day, reads: m.reads, writes: m.writes, limits: clone(LIMITS), docs: docs, docWrites: dw, all: all, resetAt: C.pacificReset(now()) };
    }

    /** ล้างสำเนาในเครื่องแล้วดึงใหม่ทั้งหมด (อ่านเท่าจำนวนเอกสาร) */
    async function reload() {
      if (syncing) { try { await syncing; } catch (e) {} }
      local = emptyLocal();
      loaded = true;
      try { await cache.clear(); } catch (e) {}
      return sync();
    }

    /* ── ขั้น 3: รอลง TRcloud กระทบยอด ตารางหลัก ชีตเดิม สำรอง (ตรรกะอยู่ใน wms-fire-trc.js) ── */

    function T() { if (!window.WmsFireTrc) throw new Error('ยังไม่ได้โหลด wms-fire-trc.js'); return window.WmsFireTrc; }
    function errOf(e) { return String(e && e.message || e); }
    /** เน็ตหลุด / เซิร์ฟเวอร์ไม่ตอบ (ยังไม่รู้ว่าถึงฐานไหม) ต่างจากถูกปฏิเสธ หน้าเก็บเป็นชุดรอส่งแล้วส่งซ้ำเอง */
    function netOf(e) {
      if (/unavailable|deadline-exceeded|network-request-failed/.test(String(e && e.code || ''))) return { net: 1 };
      return /offline|network|failed to fetch/i.test(errOf(e)) ? { net: 1 } : null;
    }

    /** รายการหน้ารอลง TRcloud (ดึงของใหม่ก่อน) */
    async function trList() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      return reply({ list: T().trList(local, now()), today: C.today(now()) });
    }

    /**
     * ใส่เลข TRcloud / เปลี่ยนสถานะ items = [{no, tr, state}] ไม่เกิน TR_MAX ต่อครั้ง
     * transaction เดียว: อ่านเอกสารจากฐาน → แก้ช่อง tr + ต่อประวัติค่าก่อนแก้ + meta.tv +1 (เครื่องอื่นเห็นภายในรอบดึงถัดไป)
     * ประวัติคิดจากฐาน ไม่ใช่สำเนา: สำเนาของคนบันทึกเป็นเวลาของเครื่อง และอีกเครื่องอาจเพิ่งแก้
     */
    async function trSave(items) {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      if (user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      await sync();
      var chk = T().trSet(local, items, user);
      if (chk.error) return reply(chk);
      var wrote = [];
      try {
        await store.tx(async function (t) {
          wrote = [];
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ยังไม่มีสมุด');
          var cur = await Promise.all(chk.writes.map(function (w) { return t.get(w[0]); }));
          chk.writes.forEach(function (w, i) {
            if (!cur[i]) throw new Error('ไม่พบเอกสาร ' + w[0]);
            if (C.trLogFull(cur[i])) throw new Error('ประวัติเลข TRcloud เต็ม ' + C.TR_LOG_MAX + ' ครั้ง แก้อีกไม่ได้ ' + (cur[i].no || '') + ' แจ้งหัวหน้า');
            var fields = clone(w[1]), log = C.trLogNext(cur[i]);
            if (log) fields.trLog = log;
            wrote.push([w[0], fields]);
          });
          wrote.forEach(function (w) { t.patch(w[0], w[1]); });
          t.patch('meta/head', { tv: (+meta.tv || 0) + 1 });
        });
      } catch (e) {
        if (e && e.code === 'permission-denied' && !/ไม่มีสิทธิ์เขียน:/.test(errOf(e))) {
          return fail('ฐานข้อมูลไม่รับ (' + errOf(e) + ') · ดึงใหม่แล้วลองอีกครั้ง ถ้ายังไม่ได้ แจ้งหัวหน้าเช็ค Firestore Rules ชุดล่าสุด');
        }
        return fail(errOf(e));
      }
      var at = now(), changed = [];
      wrote.forEach(function (w) {
        var d = local.docs.filter(function (x) { return 'docs/' + x.id === w[0]; })[0];
        if (!d) return;
        d.tr = w[1].tr; d.trState = w[1].trState; d.trBy = user.email; d.trAt = at;
        if (w[1].trLog) d.trLog = w[1].trLog;
        changed.push(d);
      });
      try { await cache.put(local, changed); } catch (e) {}
      tally();
      return reply({ saved: changed.length, states: T().trStates(local) });
    }

    /**
     * ตรวจ / รับ / อนุมัติ nos = [เลขที่] ไม่เกิน OK_MAX · act = check | approve | both | reject (reason = เหตุผลที่ไม่รับ)
     * transaction เดียว: แก้ช่องตรวจ / อนุมัติของเอกสาร + meta.ov +1 (เครื่องอื่นเห็นในรอบดึงถัดไป ดึงเฉพาะการตรวจ / อนุมัติ)
     */
    async function okSave(nos, act, reason, retried) {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      if (user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      await sync();
      var chk = C.okSet(local, nos, user, act, reason);
      if (chk.error) return reply(chk);
      try {
        await store.tx(async function (t) {
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ยังไม่มีสมุด');
          chk.writes.forEach(function (w) { t.patch(w[0], w[1]); });
          t.patch('meta/head', { ov: (+meta.ov || 0) + 1 });
        });
      } catch (e) {
        if (!retried && (await renamed(e))) return okSave(nos, act, reason, true);
        /* ฐานจริงไม่บอกเหตุผล: คนอื่นกดก่อน ทีมเพิ่งเปลี่ยน หรือยังไม่วาง Rules ชุดที่มีปุ่มไม่รับ */
        if (e && e.code === 'permission-denied' && !/ไม่มีสิทธิ์เขียน:/.test(errOf(e))) {
          return fail('ฐานข้อมูลไม่รับ (' + errOf(e) + ') · ดึงใหม่แล้วลองอีกครั้ง ถ้ายังไม่ได้ แจ้งหัวหน้าเช็คทีมของบัญชีนี้ และ Firestore Rules ชุดล่าสุด');
        }
        return fail(errOf(e));
      }
      var at = now(), changed = [];
      chk.writes.forEach(function (w) {
        var d = local.docs.filter(function (x) { return 'docs/' + x.id === w[0]; })[0];
        if (!d) return;
        Object.keys(w[1]).forEach(function (k) { d[k] = w[1][k] === C.TIME ? at : w[1][k]; });
        changed.push(d);
      });
      try { await cache.put(local, changed); } catch (e) {}
      tally();
      return reply({ saved: changed.length });
    }

    /** ไฟล์ปรับยอดลง TRcloud ของเอกสารที่เลือก */
    function trFile(nos) { return T().trFile(local, nos); }

    /** ยอด TRcloud ล่าสุดที่นำเข้า (จากสำเนาในเครื่อง ดึงเมื่อหัวหน้านำเข้าใหม่) + ผลเทียบกับยอดในระบบ */
    async function trc() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      var x = local.trc && T().trcIn(local.trc.data);
      if (!x) return reply({ trc: null });
      return reply({ trc: x, cmp: T().trcCompare(local, x, now()) });
    }

    /** หัวหน้านำเข้ายอด TRcloud: trc/{วันที่} + meta.trc = 'วันที่#รุ่น' ใน transaction เดียว */
    async function trcSave(parsed, day, files) {
      if (!user || user.role !== 'head') return fail('นำเข้ายอด TRcloud ได้เฉพาะหัวหน้า');
      var made = T().trcDoc(parsed, { day: day, by: user.email, name: user.name, files: files });
      if (made.error) return reply(made);
      try {
        await store.tx(async function (t) {
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ลงยอดยกมาก่อน แล้วค่อยนำเข้ายอด TRcloud');
          var old = String(meta.trc || '').split('#');
          t.set('trc/' + day, made.data);
          t.patch('meta/head', { trc: day + '#' + ((old[0] === day ? +old[1] || 0 : 0) + 1) });
        });
      } catch (e) { return fail(errOf(e)); }
      local.trc = null;   // ดึงตัวที่เก็บแล้ว (เวลาเซิร์ฟเวอร์) ในรอบนี้
      var r = await trc();
      return r.error ? r : reply({ saved: day, n: made.data.n, trc: r.trc, cmp: r.cmp });
    }

    /**
     * transaction ของตารางหลัก: fn(t) อ่าน / เขียน master/{kind} คืน true = เขียนแล้ว → meta.mv +1
     * ก่อนยอดยกมา transaction ไม่อ่าน meta/head: เอกสารที่อ่านแต่ไม่เขียนจะติดไปเช็คตอน commit และ meta สร้างได้ตอนบันทึกเอกสารเท่านั้น
     * ถามอีกครั้งหลังเขียน: มีคนลงยอดยกมาแทรก = mv +1 ตาม ทุกเครื่องที่ดึงไปก่อนจะดึงใหม่
     */
    async function masterTx(fn) {
      var had = await store.get('meta/head'), wrote = false;
      await store.tx(async function (t) {
        var meta = had ? await t.get('meta/head') : null;
        wrote = await fn(t);
        if (wrote && meta) t.patch('meta/head', { mv: (+meta.mv || 0) + 1 });
      });
      if (had || !wrote || !(await store.get('meta/head'))) return;
      await store.tx(async function (t) {
        var meta = await t.get('meta/head');
        if (meta) t.patch('meta/head', { mv: (+meta.mv || 0) + 1 });
      });
    }

    /** หัวหน้านำเข้าตารางหลัก kind = sup (PO → Supplier) | conv (MASTER แปลงสินค้า) | cap (ความจุต่อพาเลท) + meta.mv +1 ให้ทุกเครื่องดึงใหม่ · ก่อนยอดยกมาเขียนแต่ตาราง */
    async function masterSave(kind, part) {
      if (!user || user.role !== 'head') return fail('แก้ตารางหลักได้เฉพาะหัวหน้า');
      if (MASTERS.indexOf(kind) < 0) return fail('ไม่รู้จักตาราง ' + kind);
      var made = T().masterDoc(kind, part, { by: user.email, name: user.name });
      if (made.error) return reply(made);
      try {
        await masterTx(async function (t) {
          /* นำเข้าทั้งไฟล์ = รุ่นใหม่ของตาราง เก็บประวัติเดิมไว้ (หน้า ข้อมูลหลัก ที่แก้ค้างจะรู้ว่ามีคนบันทึกก่อน) */
          var cur = await t.get('master/' + kind);
          made.data.ver = (+(cur && cur.ver) || 0) + 1;
          if (kind === 'cap' && cur && cur.rk) made.data.rk = cur.rk;   // ไฟล์ความจุไม่ทับ ขึ้นแร็คราย SKU
          made.data.hist = [{ at: now(), by: user.email, name: user.name, text: 'นำเข้าไฟล์ ' + (made.data.tab || '') + ' ' + made.data.n + ' แถว (แทนทั้งตาราง)' }]
            .concat(Array.isArray(cur && cur.hist) ? cur.hist : []).slice(0, 60);
          t.set('master/' + kind, made.data);
          return true;
        });
      } catch (e) { return fail(errOf(e)); }
      await syncAfter();
      return reply({ saved: kind, n: made.data.n });
    }

    /**
     * หัวหน้าบันทึกข้อมูลหลักทั้งตาราง kind = loc | sku | grp | conv | sup | cap | zone · rows = แถวแบบวัตถุ (WmsFireSetup.rowIn)
     * opt = { base: รุ่นที่เริ่มแก้, strict } · รุ่นในฐานไม่ตรง base = มีคนบันทึกก่อน ไม่เขียนทับ
     * ตั้งก่อนลงยอดยกมาได้: เขียนแต่ master/{kind} (meta/head สร้างได้ตอนบันทึกเอกสารเท่านั้น)
     * มีคนลงยอดยกมาระหว่างบันทึก = masterTx บวก mv ตามให้
     */
    async function setupSave(kind, rows, opt) {
      opt = opt || {};
      if (!user || user.role !== 'head') return fail('แก้ข้อมูลหลักได้เฉพาะหัวหน้า');
      if (SETUP.indexOf(kind) < 0 && MASTERS.indexOf(kind) < 0) return fail('ไม่รู้จักตาราง ' + kind);
      var S = window.WmsFireSetup;
      if (!S) return fail('ยังไม่ได้โหลด wms-fire-setup.js');
      var made = null, stale = false;
      try {
        await masterTx(async function (t) {
          var cur = await t.get('master/' + kind);
          stale = (+(cur && cur.ver) || 0) !== (+opt.base || 0);
          made = S.docOf(kind, rows, { by: user.email, name: user.name, at: now(), strict: opt.strict, base: opt.base }, cur);
          if (made.error) return false;
          t.set('master/' + kind, made.data);
          return true;
        });
      } catch (e) { return fail(errOf(e)); }
      if (made && made.error) {
        /* คนอื่นบันทึกก่อน: ดึงรุ่นของเขามา หน้าจะมีปุ่ม โหลดตารางใหม่ / ใช้ร่างของฉันทับ ให้กด */
        if (stale) { try { await syncAfter(); } catch (e) {} }
        return reply({ error: made.error });
      }
      await syncAfter();
      return reply({ saved: kind, n: made.kept, ver: made.data.ver, text: made.data.hist[0].text });
    }

    /** ตารางหลักที่มีอยู่ { sup: {n, tab, at, name}, conv: {…} } */
    function masters() {
      var out = {};
      MASTERS.forEach(function (n) {
        var m = local.master && local.master[n];
        if (m) out[n] = { n: +m.n || C.dec(m.rows).length, tab: m.tab || '', at: +m.at || 0, name: m.name || '', dup: (m.dup || []).length, blank: +m.blank || 0 };
      });
      return out;
    }

    /** วันที่ต้องวางแถวลงชีตเดิม + ใครวางแล้ว (xfer/log อ่าน 1 ครั้ง) */
    async function xferDays() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      var log = null;
      try { log = await store.get('xfer/log'); } catch (e) { log = null; }
      tally();
      return reply({ days: T().xferDays(local, log || {}) });
    }
    function xferText(day, after) { return T().xferText(local, day, after); }
    /** วางลงชีตเดิมแล้ว: เติมวันนั้นใน xfer/log (ครั้งละวัน) */
    async function xferMark(day, info) {
      if (!user || user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return fail('วันที่ต้องเป็น yyyy-mm-dd');
      var entry = {};
      entry[day] = { by: user.name, at: now(), n: +(info && info.rows) || 0, last: String(info && info.last || '') };
      try { await store.patch('xfer/log', entry); } catch (e) { return fail(errOf(e)); }
      tally();
      return reply({ day: day, done: entry[day] });
    }

    /** ไฟล์สำรองจากสำเนาในเครื่อง + รายชื่อ + ยอด TRcloud ล่าสุด + บันทึกชีตเดิม (หัวหน้า) */
    async function backup() {
      if (!user || user.role !== 'head') return fail('ดาวน์โหลดสำรองได้เฉพาะหัวหน้า');
      await sync();
      var us = await users();
      if (us.error) return us;
      var xf = null;
      try { xf = await store.get('xfer/log'); } catch (e) { xf = null; }
      tally();
      return reply({ backup: T().backupOf(local, { users: us.users, trc: local.trc, xfer: xf }, now()) });
    }

    /** ผลตรวจแถวล่าสุดของ fire-backup.gs (อ่าน 1 ครั้ง หัวหน้าเท่านั้น) · ยังไม่เคยตรวจ = audit null */
    async function auditInfo() {
      if (!user || user.role !== 'head') return fail('ผลตรวจดูได้เฉพาะหัวหน้า');
      var a;
      try { a = await store.get('audit/last'); } catch (e) { return fail(errOf(e), netOf(e)); }
      tally();
      return reply({ audit: a || null });
    }

    /** หน้าปิดเดือน: เดือนที่ปิดแล้ว เดือนถัดไปที่ปิดได้ ประมาณการอ่านของเครื่องใหม่ (หัวหน้า · อ่าน arch/index 1 ครั้ง) */
    async function archInfo() {
      if (!user || user.role !== 'head') return fail('ปิดเดือนได้เฉพาะหัวหน้า');
      await sync();
      var idx = null;
      try { idx = await store.get('arch/index'); } catch (e) { return fail(errOf(e), netOf(e)); }
      tally();
      return reply(T().archSummary(local, idx, now()));
    }

    /**
     * เอกสารที่บัญชีนี้บันทึก สำเนาในเครื่องเป็นแบบตอนบันทึก (เวลาของเครื่อง ไม่ใช่เวลาเซิร์ฟเวอร์)
     * ก่อนรวมเป็นก้อน ดึงจากฐานใหม่ (หลัก + ส่วนแยก) ก้อนจะตรงกับดึงทีละเอกสารทุกช่อง
     */
    async function refreshOwn(docs) {
      var mine = docs.filter(function (d) { return d.by === user.email; }), done = [];
      for (var i = 0; i < mine.length; i += PAGE) {
        var part = mine.slice(i, i + PAGE);
        var mains = await store.getMany(part.map(function (d) { return 'docs/' + d.id; }));
        for (var k = 0; k < part.length; k++) {
          var m = mains[k];
          if (!m) continue;
          var have = [], ids = partPaths(part[k].id, m.part, have);
          if (ids.length) (await store.getMany(ids)).forEach(function (p) { if (p) have.push(p); });
          var fresh = C.docIn(part[k].id, m, have), at = local.docs.indexOf(part[k]);
          if (at >= 0) { local.docs[at] = fresh; done.push(fresh); }
        }
      }
      if (done.length) { try { await cache.put(local, done); } catch (e) {} }
    }

    /**
     * ปิดเดือนถัดไป: ซิงก์ให้ครบ → เขียนก้อน (ครั้งละ ARCH_BATCH) → ก้อนเลข TRcloud → arch/index ใน transaction (จุดยืนยัน)
     * เขียนไม่ครบ = index ยังเป็นของเดิม กดใหม่ได้ (ก้อนที่ยังไม่ยืนยันถูกเขียนทับ · ยืนยันแล้ว Rules ไม่ให้ทับ) · ไม่แก้ docs เดิม (ไฟล์สำรองยังครบ)
     */
    async function archClose() {
      if (!user || user.role !== 'head') return fail('ปิดเดือนได้เฉพาะหัวหน้า');
      await sync();
      var idx = null, plan;
      try {
        idx = await store.get('arch/index');
        var nx = T().archNext(local, idx, now());
        if (!nx.error) await refreshOwn(nx.docs);
        plan = T().archPlan(local, idx, now(), { bytes: opt.archBytes, by: user.name });
        if (plan.error) return reply(plan);
        for (var i = 0; i < plan.chunks.length; i += ARCH_BATCH) await store.commit(plan.chunks.slice(i, i + ARCH_BATCH));
        for (var j = 0; j < plan.ov.length; j += ARCH_BATCH) await store.commit(plan.ov.slice(j, j + ARCH_BATCH));
        var had = idx ? (idx.months || []).length : 0;
        await store.tx(async function (t) {
          var cur = await t.get('arch/index');
          if ((cur ? (cur.months || []).length : 0) !== had) throw new Error('มีคนปิดเดือนพร้อมกัน เปิดหน้าปิดเดือนใหม่แล้วดูอีกครั้ง');
          t.set('arch/index', plan.index);
        });
      } catch (e) {
        return fail(errOf(e), netOf(e));
      }
      tally();
      var e = plan.entry;
      return reply({ closed: e.m, label: T().monthTh(e.m), docs: e.docs, chunks: e.n, skip: e.skip.length, bytes: e.bytes, fix: plan.index.ov.fix, sum: T().archSummary(local, plan.index, now()) });
    }

    /** ฐานจริงไม่บอกเหตุผลที่ไม่รับ (Missing or insufficient permissions) บอกทางแก้ที่พบบ่อยแทน */
    function saveErr(e) {
      var msg = errOf(e);
      if (!(e && e.code === 'permission-denied') || /ไม่มีสิทธิ์เขียน:/.test(msg)) return msg;
      return 'ฐานข้อมูลไม่รับการบันทึกนี้ (' + msg + ') · กดส่งใหม่อีกครั้ง ถ้ายังไม่ได้ให้ตรวจนาฬิกาเครื่อง (ตั้งเวลาอัตโนมัติ) แล้วแจ้งหัวหน้า';
    }

    function docByNo(no) { return local.docs.filter(function (d) { return d.no === no; })[0] || null; }

    /** บันทึกหนึ่งชุด = transaction เดียว: อ่าน meta + docs/{รหัสชุด} เช็คกับสำเนาในเครื่อง (seq ตรงแล้ว) แล้วเขียนเอกสาร + meta */
    async function save(op, body) {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      var spec = C.OPS[op];
      if (user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      if (spec.head && user.role !== 'head') return fail(op === 'bk-void' ? 'ยกเลิกชุดได้เฉพาะหัวหน้ากับรองหัวหน้า' : 'คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
      /*
       * ยังไม่มียอดยกมา = ไม่รับเอกสาร ตอบก่อนเช็ครูปข้อมูล (ชุดค้างเก่าวันที่เกินจะไม่ถูกหน้าทิ้ง)
       * และก่อนเปิด transaction (อ่านแล้วไม่เขียน) · C.plan เช็คซ้ำกับ meta ในฐาน
       */
      if (C.openLock(op, local.meta)) {
        await syncAfter();   // รอบที่ค้างอยู่อาจอ่านก่อนมีคนลงยอดยกมา
        var lock = C.openLock(op, local.meta);
        if (lock) return reply(lock);
      }
      var P = C.prep(op, body, now());
      if (P.error) return reply(P);
      await sync();
      var retried = false;
      for (var tries = 0; tries < STALE_TRIES; tries++) {
        var res;
        try {
          res = await store.tx(async function (t) {
            var meta = await t.get('meta/head');
            var had = await t.get('docs/' + P.batch);
            if (had) return { again: had };
            if ((meta ? +meta.seq || 0 : 0) !== local.seq) return { stale: true };
            var pl = C.plan(P, { meta: meta, local: local, user: user, now: now(), partBytes: opt.partBytes });
            if (pl.error) return { fail: pl };
            pl.writes.forEach(function (w) { t.set(w[0], w[1]); });
            return { plan: pl };
          });
        } catch (e) {
          if (!retried && (await renamed(e))) { retried = true; continue; }
          return fail(saveErr(e), netOf(e));
        }
        if (res.stale) { await sync(); continue; }
        if (res.again) {
          if (op === 'bk-void') return fail(P.voidNo + ' ถูกยกเลิกไปแล้ว');
          await sync();
          var vd = C.voids(local)[res.again.no];
          return reply({ doc: res.again.no, again: true, at: res.again.stamp, status: vd ? vd.status : '', book: 1 });
        }
        if (res.fail) return reply(res.fail);
        var pl = res.plan;
        /* เวลาเซิร์ฟเวอร์ยังไม่รู้ ใช้เวลาเครื่องไปก่อน (ตัวนับเอกสารวันนี้) · ส่วนแยก = เอกสารที่เขียนลบ meta */
        pl.doc.at = now();
        pl.doc.part = pl.writes.length - 1;
        local.docs.push(pl.doc);
        local.seq = pl.meta.seq;
        local.meta = clone(pl.meta);
        local.meta.at = now();
        local.piles = C.applyDoc(local.piles || {}, pl.doc);
        try { await cache.put(local, [pl.doc]); } catch (e) {}
        return reply(pl.reply);
      }
      return fail('มีคนบันทึกพร้อมกันหลายครั้ง ลองกดส่งใหม่');
    }

    /** op แบบ bookPost ของหน้า book */
    async function post(op, body) {
      body = body || {};
      try {
        if (op === 'bk-login') return user ? reply({ who: user.name, role: ROLE_TH[user.role], mode: 'book', email: user.email }) : fail('ยังไม่ได้ล็อกอิน');
        if (C.OPS[op]) { var sv = await save(op, body); tally(); return sv; }
        if (!user) return fail('ยังไม่ได้ล็อกอิน');
        await sync();
        var t = now();
        if (op === 'bk-state') return reply(C.state(local, t));
        if (op === 'bk-stock') return reply(C.stock(local));
        if (op === 'bk-recent') return reply(C.recent(local, body, t));
        if (op === 'bk-seen') return reply(C.seen(local, body, t));
        if (op === 'bk-find') return reply(C.find(local, body, t));
        if (op === 'bk-rebuild') {
          if (user.role !== 'head') return fail('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
          /* ยอดในเครื่องไม่ตรงกับที่คิดจากเอกสาร (สำเนาเสียหรือถูกแก้) = ใช้ยอดที่คิดใหม่ แล้วบอกว่าซ่อมแล้ว */
          var rb = C.rebuild(local);
          if (!rb.same) {
            local.piles = C.pilesFromDocs(local).map;
            try { await cache.put(local, []); } catch (e) {}
            rb.fixed = 1;
          }
          return reply(rb);
        }
        if (op === 'bk-mode') return body.mode === 'book' ? reply({ mode: 'book', same: true }) : fail('ระบบใหม่ลงสมุดตรงเสมอ ไม่มีโหมดคัดลอก');
        if (op === 'bk-backup') return fail('ระบบใหม่สำรองทุกคืนด้วย fire-backup.gs');
        return fail('ไม่รู้จักคำสั่งนี้');
      } catch (e) {
        return fail(errOf(e), netOf(e));
      }
    }

    return {
      store: store, auth: auth, domain: domain,
      login: login, restore: restore, logout: logout, sync: sync, post: post,
      users: users, saveUser: saveUser, quota: quota, reload: reload,
      trList: trList, trSave: trSave, okSave: okSave, trFile: trFile, trc: trc, trcSave: trcSave, masterSave: masterSave, masters: masters, setupSave: setupSave,
      xferDays: xferDays, xferText: xferText, xferMark: xferMark, backup: backup, auditInfo: auditInfo, archInfo: archInfo, archClose: archClose,
      user: function () { return user; },
      local: function () { return local; },
      /** ถามฐานแล้วและยังไม่มียอดยกมา (ช่วงตั้งข้อมูลหลักล่วงหน้า) */
      preOpen: function () { return checked && !(local.meta && local.meta.open); },
      fifo: function () { return C.fifo(local, now()); },
      /**
       * มีคนบันทึก หรือกดรับตอนเครื่องนี้มีของรอรับ → cb(meta) · ฟังไม่ได้ (หลุดสิทธิ์ ฯลฯ) → err(e) · คืนฟังก์ชันเลิกฟัง
       * ไม่มีของรอรับ = การตรวจ / อนุมัติไม่เปลี่ยนของที่ใช้ได้ รอดึงพร้อมรอบถัดไป ไม่ให้ทุกเครื่องอ่านตามทุกครั้งที่อนุมัติ
       */
      watch: function (cb, err) {
        return store.onMeta(function (meta) { if (meta && (+meta.seq !== local.seq || ((+meta.ov || 0) !== (+local.ov || 0) && waiting()))) cb(meta); }, err);
      },
      usage: function () { return store.stats(); },
    };
  }

  window.WmsFire = {
    SDK_V: SDK_V, LIMITS: LIMITS, ROLES: ROLES, ROLE_TH: ROLE_TH,
    memStore: memStore, firestoreStore: firestoreStore, rulesError: rulesError,
    fakeAuth: fakeAuth, googleAuth: googleAuth, memCache: memCache, idbCache: idbCache, memMeter: memMeter, storeMeter: storeMeter,
    ARCH_GAP: ARCH_GAP, ARCH_BATCH: ARCH_BATCH,
    open: open,
  };
})();
