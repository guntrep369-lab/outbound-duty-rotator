/**
 * @file wms-fire-trc.js — ระบบใหม่บน Firebase ขั้น 3: TRcloud ช่วงเปลี่ยนผ่าน และสำรองข้อมูล (ตรรกะล้วน ไม่แตะ Firebase ไม่แตะหน้าจอ)
 *
 * รอลง TRcloud
 *   ทุกเอกสารมี trState: wait = ต้องลง TRcloud ยังไม่มีเลข · done = ลงแล้ว (มีเลข) · none = ไม่ต้องลง
 *   ตอนบันทึก plan() ใส่ให้ตามประเภท (WmsFireCore.trNeed) ใส่เลข TRcloud มาด้วย = ลงแล้วเลย
 *   ทีม inbound / inventory สร้างเอกสารใน TRcloud เอง (รับของ GR, เบิก MR, แปลง, คืน) แล้วมาใส่เลขในหน้ารอลง (trSet)
 *   ย้ายเข้า/ออก QA กับปรับยอด ออกไฟล์ปรับยอดแบบเดียวกับหน้าเช็คตัดสต๊อก / หน้านับสต๊อก (TRC_HEAD) แล้วนำเข้า TRcloud (trFile)
 *   ยกเลิกก่อนลง TRcloud = ไม่ต้องลงทั้งคู่ · ยกเลิกหลังลงแล้ว = เอกสารกลับรายการต้องลงกลับใน TRcloud
 * กระทบยอด
 *   หัวหน้านำเข้าไฟล์ยอดคงเหลือจาก TRcloud (แท็บ Stock: NEW WH = WH-02, QA = WH-QA · WH-Loss · ราคาทุน แบบที่ stock-api.gs อ่าน)
 *   เก็บที่ trc/{วันที่} แล้วเทียบกับยอดในระบบ ณ สิ้นวันนั้น (คิดจากเอกสารที่วันที่ไม่เกินวันนั้น) ราย SKU ราย คลัง
 *   PO → Supplier (แท็บ PO. Truck) กับ MASTER แปลงสินค้า นำเข้าเป็น master/sup และ master/conv แบบที่ tx-api.gs อ่าน
 * ชีตเดิม (ช่วงเปลี่ยนผ่าน 1 เดือน)
 *   แถวของเอกสารที่บันทึกในวันหนึ่ง เป็นข้อความวางต่อท้ายชีต Transaction เดิม รูปเดียวกับ WmsBook.tsv (คอลัมน์ A–N)
 *   หน้ารายงานเดิมที่ยังอ่านชีตเดิมจะได้ใช้ต่อ ยอดยกมาไม่ต้องวาง (ชีตเดิมมียอดนับของตัวเองแล้ว)
 * สำรอง
 *   ไฟล์ JSON รูปเดียวกันทั้งจากเครื่อง (backupOf) และจาก apps-script/fire-backup.gs:
 *   { kind: 'wms-fire-backup', v: 1, made, from, seq, data: { 'docs/…': ข้อมูลในฐาน, 'meta/head': …, 'users/…': …, 'master/…': …, 'trc/…': … } }
 *   ช่องเวลา (at, trAt, last) เก็บเป็นมิลลิวินาที กู้คืนแปลงกลับเป็นเวลาของ Firestore
 *
 * โหลดหลัง wms-fire-core.js เปิดเป็น window.WmsFireTrc
 */
(function () {
  'use strict';

  var C = window.WmsFireCore;

  /* หัวตารางตามไฟล์ที่ทีมใช้ลง TRcloud อยู่แล้ว (WmsCut.trcSheet, WmsStocktake.TRC_HEAD) สองช่องที่หัวว่างคงไว้ */
  var TRC_HEAD = ['SKU', 'วันที่', 'จำนวนที่เพิ่มขึ้น', 'จำนวนที่ลดลง', '', '', 'ออเดอร์', 'แผนก', 'คลังสินค้า', 'ขนส่ง'];
  var TRC_WIDTHS = [16, 12, 16, 14, 6, 6, 14, 8, 12, 14];
  var TRC_DEPT = 'IV';            // แผนกปรับยอดคลัง แบบ ADJUST_DEPT ใน cut-api.gs
  var TR_MAX = 10;                // เอกสารต่อการบันทึกเลข TRcloud หนึ่งครั้ง (Rules อ่าน users ทีละเอกสาร เพดาน 20)
  var TR_DAYS = 60;               // ลงแล้ว / ไม่ต้องลง แสดงย้อนหลังกี่วัน (รอลงแสดงทั้งหมด)
  var TRC_MAX = 20000;            // SKU ต่อไฟล์ยอด TRcloud
  var MASTER_MAX = 20000;
  var DOC_BYTES = 900000;         // trc / master เอกสารเดียว (Firestore รับ 1 MiB)
  var FILE_TYPES = [C.TYPE_MOVE, C.TYPE_ADJ, C.TYPE_ROWS];   // คลังเปลี่ยน → ไฟล์ปรับยอด · ที่เหลือทีมสร้างใน TRcloud แล้วใส่เลข
  var TIME_KEYS = ['at', 'trAt', 'last', 'ckAt', 'apAt', 'okAt'];   // ตรงกับ fire-backup.gs
  var BACKUP_KIND = 'wms-fire-backup';
  var THAI = /[฀-๿]/;

  var text = C.text, up = C.up, round3 = C.round3;
  function clone(o) { return o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)); }
  function cell(v) { return String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' '); }
  /** รหัสแบบหน้านับสต๊อก: ตัวพิมพ์ใหญ่ ช่องว่างเดียว ตัด 0 นำหน้าตัวเลข */
  function norm(v) { return up(v).replace(/\s+/g, ' ').replace(/^0+(?=\d)/, ''); }
  function key(s) { return String(s || '').toLowerCase().replace(/[\s\-_.]/g, ''); }
  function numOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/[,\s฿]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isNum(v) {
    if (typeof v === 'number') return isFinite(v);
    var s = String(v == null ? '' : v).replace(/[,\s฿]/g, '');
    return s !== '' && isFinite(s);
  }
  function byNo(local) { var m = {}; (local.docs || []).forEach(function (d) { m[d.no] = d; }); return m; }

  /* ── รอลง TRcloud ─────────────────────────────────────────────────────── */

  /** สถานะที่เก็บ (เอกสารก่อนขั้น 3 ไม่มี = คิดจากประเภท) */
  function baseState(d) {
    if (C.TR_STATES.indexOf(d.trState) >= 0) return d.trState;
    return C.trNeed(d.type, d.rows) ? (d.tr ? C.TR_DONE : C.TR_WAIT) : C.TR_NONE;
  }

  /**
   * ล็อก TRcloud จนหัวหน้าอนุมัติ: ใบย้ายที่ต้องลง TRcloud ยังไม่อนุมัติ และใบกลับรายการของใบแบบนั้น
   * (trUpdate ใน firestore.rules คุมใบย้ายเอง ใบกลับรายการคุมในแอป เพราะ Rules ไม่เห็นใบเดิม)
   */
  function trLocked(d, by) {
    var o = d && d.type === C.TYPE_REV ? by[d.link] : d;
    return !!o && o.type === C.TYPE_MOVE && !o.ap && baseState(o) === C.TR_WAIT;
  }

  /**
   * สถานะลง TRcloud ของทุกเอกสาร { เลขที่: wait | done | none }
   * ยกเลิกก่อนอนุมัติ = ไม่ต้องลงทั้งคู่เสมอ
   * ยกเลิกก่อนลง TRcloud = ไม่ต้องลงทั้งคู่ · ยกเลิกหลังลงแล้ว = กลับรายการต้องลง (จนกว่าจะใส่เลขหรือกดไม่ต้องลง)
   */
  function trStates(local) {
    var vd = C.voids(local), by = byNo(local), out = {};
    (local.docs || []).forEach(function (d) {
      var s;
      if (d.type === C.TYPE_REV) {
        var o = by[d.link];
        if (trLocked(d, by)) s = C.TR_NONE;
        else if (d.trBy && C.TR_STATES.indexOf(d.trState) >= 0) s = d.trState;
        else s = o && baseState(o) === C.TR_DONE ? C.TR_WAIT : C.TR_NONE;
      } else {
        s = baseState(d);
        if (vd[d.no] && s === C.TR_WAIT && (!d.trBy || trLocked(d, by))) s = C.TR_NONE;
      }
      out[d.no] = s;
    });
    return out;
  }

  /** file = ออกไฟล์ปรับยอดได้ (ย้าย QA ปรับยอด ตารางเดิม และกลับรายการของพวกนี้) · number = สร้างใน TRcloud แล้วใส่เลข */
  function kindOf(d, by) {
    var t = d.type === C.TYPE_REV && by[d.link] ? by[d.link].type : d.type;
    return FILE_TYPES.indexOf(t) >= 0 ? 'file' : 'number';
  }

  /**
   * รายการหน้ารอลง TRcloud ใหม่สุดก่อน: รอลงทั้งหมด + ลงแล้ว / ไม่ต้องลง ย้อน TR_DAYS วัน (ไม่นับตัดขายกับยอดยกมา)
   * [{id, no, type, date, stamp, name, n, qty, tr, state, kind, voided, link, wh: [[SKU, คลัง, ±ชิ้น]], skus, trBy, trAt, rows, ok, xf, lock}]
   * ok = ตรวจ / อนุมัติ (okState) · xf = ใบโอน QA (ตรวจ = รับ) · lock = ออกไฟล์ / ใส่เลข / เปลี่ยนสถานะไม่ได้ (trLocked)
   */
  function trList(local, now, days) {
    var st = trStates(local), vd = C.voids(local), by = byNo(local);
    var from = C.dayNo(C.today(now)) - (days || TR_DAYS);
    return (local.docs || []).filter(function (d) {
      if (d.type === C.TYPE_SALE || d.type === C.TYPE_OPEN) return false;
      return st[d.no] === C.TR_WAIT || (d.stamp && C.dayNo(d.stamp.slice(0, 10)) >= from);
    }).sort(function (a, b) { return b.seq - a.seq; }).map(function (d) {
      var skus = {};
      d.rows.forEach(function (r) { var s = up(r[1] || r[0]); if (s) skus[s] = 1; });
      return {
        id: d.id, no: d.no, type: d.type, date: d.date, stamp: d.stamp, name: d.name, n: d.n, qty: d.qty, tr: d.tr || '',
        state: st[d.no], kind: kindOf(d, by), voided: !!vd[d.no], link: d.type === C.TYPE_REV ? d.link : (vd[d.no] && vd[d.no].link) || '',
        wh: C.whLines(d.rows), skus: Object.keys(skus), trBy: d.trBy || '', trAt: d.trAt || 0, rows: d.rows,
        ok: C.okState(d, vd), xf: C.xfKind(d), lock: trLocked(d, by),
      };
    });
  }

  /**
   * บันทึกเลข TRcloud / สถานะ (op bk-tr) items = [{no, tr, state}] → { writes: [[path, ช่องที่แก้]] } หรือ { error, bad }
   * แก้ได้เฉพาะ tr trState trBy trAt และต่อประวัติ trLog (เติมใน transaction จากค่าในฐาน · Rules บังคับ) ลงแล้วต้องมีเลข · ตัดขายกับยอดยกมาไม่เกี่ยวกับ TRcloud ของคลัง
   * ใบย้ายที่ต้องลง TRcloud แต่ยังไม่อนุมัติ = แก้ไม่ได้ (trLocked)
   */
  function trSet(local, items, user) {
    if (!Array.isArray(items) || !items.length) return { error: 'ไม่มีเอกสารที่จะบันทึก' };
    if (items.length > TR_MAX) return { error: 'บันทึกเลข TRcloud ได้ครั้งละไม่เกิน ' + TR_MAX + ' เอกสาร' };
    var by = byNo(local), vd = C.voids(local), seen = {}, bad = [], writes = [];
    items.forEach(function (it) {
      it = it || {};
      var no = text(it.no), d = by[no], st = text(it.state), tr = C.plain(it.tr, 100);
      var why = !d ? 'ไม่พบเลขที่นี้' : seen[no] ? 'ซ้ำในรายการ'
        : d.type === C.TYPE_SALE || d.type === C.TYPE_OPEN ? d.type + 'ไม่ต้องลง TRcloud ของคลัง'
        : C.TR_STATES.indexOf(st) < 0 ? 'สถานะต้องเป็น รอลง ลงแล้ว หรือ ไม่ต้องลง'
        : trLocked(d, by) ? (d.type === C.TYPE_REV || vd[d.no] ? 'ยกเลิกก่อนอนุมัติ ไม่ต้องลง TRcloud' : 'ยังไม่อนุมัติ ใส่เลข / เปลี่ยนสถานะ TRcloud ไม่ได้')
        : st === C.TR_DONE && !tr ? 'ลงแล้วต้องมีเลข TRcloud'
        : C.trLogFull(d) ? 'ประวัติเลข TRcloud เต็ม ' + C.TR_LOG_MAX + ' ครั้ง แก้อีกไม่ได้ แจ้งหัวหน้า' : '';
      if (why) { bad.push({ no: no, why: why }); return; }
      seen[no] = 1;
      writes.push(['docs/' + d.id, { tr: tr, trState: st, trBy: user.email, trAt: C.TIME }]);
    });
    if (bad.length) return { error: 'บันทึกไม่ได้ ' + bad.length + ' เอกสาร: ' + bad.slice(0, 3).map(function (b) { return (b.no || '?') + ' ' + b.why; }).join(' · '), bad: bad };
    return { writes: writes };
  }

  /**
   * ไฟล์ปรับยอดลง TRcloud ของเอกสารที่เลือก (เฉพาะชนิด file) แถวละ SKU + คลัง ต่อเอกสาร
   * เพิ่ม = ช่องจำนวนที่เพิ่มขึ้น · ลด = ช่องจำนวนที่ลดลง · ออเดอร์ = เลขที่เอกสาร (ตามกลับได้) · วันที่ = วันที่ของเอกสาร
   * ใบย้ายที่ยังไม่อนุมัติ (รอรับ / ไม่รับ / รออนุมัติ) ไม่ลงไฟล์ → hold · ยกเลิกก่อนอนุมัติ กับใบกลับรายการของมัน → skip
   * → { name, aoa, widths, docs, skip, hold, lines }
   */
  function trFile(local, nos) {
    var by = byNo(local), vd = C.voids(local), rows = [], used = [], skip = [], hold = [];
    (nos || []).forEach(function (no) {
      var d = by[no];
      if (!d) return;
      var lines = C.whLines(d.rows);
      if (kindOf(d, by) !== 'file' || !lines.length) { skip.push(no); return; }
      if (trLocked(d, by)) { (d.type === C.TYPE_REV || vd[d.no] ? skip : hold).push(no); return; }
      lines.forEach(function (l) { rows.push([l[0], d.date, l[2] > 0 ? l[2] : '', l[2] < 0 ? -l[2] : '', '', '', d.no, TRC_DEPT, l[1], '']); });
      used.push(no);
    });
    return { name: 'TRcloud', aoa: [TRC_HEAD.slice()].concat(rows), widths: TRC_WIDTHS.slice(), docs: used, skip: skip, hold: hold, lines: rows.length };
  }

  /* ── อ่านไฟล์จาก TRcloud และตารางหลัก ───────────────────────────────── */

  /** แถวเป็นวัตถุตามหัวตาราง แบบ tab_ ของ stock-api.gs: หัว = แถวแรกใน 10 แถวบนที่มีช่อง SKU หรือ รหัสสินค้า ไม่เจอใช้แถวแรก */
  function tabRows(grid) {
    grid = (grid || []).filter(function (r) { return Array.isArray(r); });
    var h = 0;
    for (var i = 0; i < Math.min(10, grid.length); i++) {
      if (grid[i].some(function (v) { return /^(sku|รหัสสินค้า)$/i.test(text(v)); })) { h = i; break; }
    }
    if (!grid.length) return { head: [], rows: [] };
    var head = grid[h].map(function (v, j) { return text(v) || 'col' + (j + 1); });
    var at = head.findIndex(function (v) { return /^(sku|รหัสสินค้า)$/i.test(v); });
    if (at < 0) at = 0;
    return { head: head, at: at, rows: grid.slice(h + 1).filter(function (r) { return text(r[at]) !== ''; }) };
  }
  /** คอลัมน์แรกที่หัวตรง re ตามลำดับ (ไม่ใช่ skip) ไม่เจอ = -1 */
  function colOf(head, res, skip) {
    for (var i = 0; i < res.length; i++) {
      for (var j = 0; j < head.length; j++) if (j !== skip && res[i].test(head[j])) return j;
    }
    return -1;
  }
  /** ไม่เจอจากหัว = คอลัมน์แรกที่ไม่ใช่ skip และแถวแรกเป็นตัวเลข (แบบ colOf ของหน้านับสต๊อก) */
  function numCol(head, rows, res, skip) {
    var c = colOf(head, res, skip);
    if (c >= 0 || !rows.length) return c;
    for (var j = 0; j < head.length; j++) if (j !== skip && isNum(rows[0][j])) return j;
    return -1;
  }

  /** ชนิดของชีต: ตามชื่อก่อน (Stock, WH-Loss, ราคาทุน, PO. Truck, MASTER แปลงสินค้า) แล้วดูจากหัวตาราง */
  function sheetKind(name, head) {
    var k = key(name);
    if (k === 'stock') return 'stock';
    if (k === 'whloss' || /loss/i.test(k)) return 'loss';
    if (k === key('ราคาทุน') || /^cost/.test(k)) return 'cost';
    if (/^potruck$/.test(k)) return 'sup';
    if (k === key('MASTER แปลงสินค้า')) return 'conv';
    if (k === key('ความจุต่อพาเลท')) return 'cap';
    var has = function (re) { return head.some(function (h) { return re.test(h); }); };
    if (has(/new.*wh|^wh-?02$/i)) return 'stock';
    if (has(/ราคาทุน|^cost/i)) return 'cost';
    if (has(/loss/i)) return 'loss';
    if (has(/truck|supplier/i) && has(/^po/i)) return 'sup';
    if (has(/ซื้อ/) && has(/แปลง|ขาย/)) return 'conv';
    if (has(/std|pallet|พาเลท|ความจุ/i) && has(/^sku$|^รหัสสินค้า$|product\s*id|รหัสยาว/i)) return 'cap';
    return '';
  }

  /** แท็บ Stock → { list: [[รหัส, ชื่อ, WH-02, WH-QA]], cols } SKU ซ้ำบวกรวม (แบบ trcParse ของหน้านับสต๊อก) */
  function readStock(t) {
    var cs = colOf(t.head, [/^sku$/i, /^รหัสสินค้า$/, /รหัส/], -1);
    var cn = colOf(t.head, [/new.*wh/i, /^wh-?02$/i], cs);
    var cq = colOf(t.head, [/^qa$/i, /\bqa\b/i], cn);
    var cd = colOf(t.head, [/desc|ชื่อสินค้า|ชื่อ|product\s*name/i], cs);
    if (cs < 0) return { error: 'ไม่มีคอลัมน์ SKU หรือ รหัสสินค้า' };
    if (cn < 0) return { error: 'ชีต Stock ไม่มีคอลัมน์ NEW WH (คลัง WH-02)' };
    var by = {}, list = [];
    t.rows.forEach(function (r) {
      var c = text(r[cs]);
      if (!c) return;
      var k = norm(c), x = by[k];
      if (!x) { x = by[k] = [c, cd >= 0 ? text(r[cd]) : '', 0, 0]; list.push(x); }
      x[2] = round3(x[2] + numOf(r[cn]));
      x[3] = round3(x[3] + (cq >= 0 ? numOf(r[cq]) : 0));
    });
    return { list: list, cols: [t.head[cs], t.head[cn], cq >= 0 ? t.head[cq] : '', cd >= 0 ? t.head[cd] : ''] };
  }
  /** แท็บ WH-Loss / ราคาทุน → { list: [[รหัส, ค่า]], col } รหัสซ้ำ: Loss บวกรวม ราคาใช้แถวแรก */
  function readSide(t, res, sum) {
    var cs = colOf(t.head, [/^sku$/i, /^รหัสสินค้า$/, /รหัส/], -1);
    if (cs < 0) return { error: 'ไม่มีคอลัมน์ SKU หรือ รหัสสินค้า' };
    var cv = numCol(t.head, t.rows, res, cs);
    if (cv < 0) return { error: 'หาคอลัมน์ตัวเลขไม่เจอ' };
    var by = {}, list = [];
    t.rows.forEach(function (r) {
      var c = text(r[cs]);
      if (!c || !isNum(r[cv])) return;
      var k = norm(c);
      if (by[k]) { if (sum) by[k][1] = round3(by[k][1] + numOf(r[cv])); return; }
      by[k] = [c, numOf(r[cv])];
      list.push(by[k]);
    });
    return { list: list, col: t.head[cv] };
  }
  /** แท็บ PO. Truck → { rows: [[PO, Supplier]], dup } แบบ sup_ ของ tx-api.gs (PO ซ้ำต่าง Supplier เก็บแถวแรก) */
  function readSup(grid) {
    var g = (grid || []).filter(function (r) { return Array.isArray(r) && r.some(function (v) { return text(v) !== ''; }); });
    if (!g.length) return { error: 'ชีตว่าง' };
    var c = { po: -1, sup: -1 };
    g[0].forEach(function (v, j) {
      var t = text(v);
      if (c.po < 0 && /^po\.?$|^po\s*no|^เลข\s*po/i.test(t)) c.po = j;
      else if (c.sup < 0 && /truck|supplier|^รถ|ผู้ผลิต|บริษัท/i.test(t)) c.sup = j;
    });
    if (c.po < 0 || c.sup < 0) return { error: 'หาหัวตาราง Truck กับ PO. ไม่เจอ' };
    var seen = {}, rows = [], dup = [];
    g.slice(1).forEach(function (r) {
      var po = up(r[c.po]).replace(/\s+/g, ''), sup = text(r[c.sup]);
      if (!po || !sup) return;
      if (seen[po] !== undefined) { if (seen[po].toUpperCase() !== sup.toUpperCase() && dup.indexOf(po) < 0) dup.push(po); return; }
      seen[po] = sup;
      rows.push([po, sup]);
    });
    return { rows: rows, dup: dup };
  }
  /** MASTER แปลงสินค้า → { pairs: [[SKU หลังแปลง, SKU ตอนซื้อ]], cols, blank } แบบ convert_ ของ tx-api.gs */
  function readConv(grid) {
    var g = (grid || []).filter(function (r) { return Array.isArray(r); });
    if (!g.length) return { error: 'ชีตว่าง' };
    var head = g[0].map(text);
    function find(re, skip) {
      for (var i = 0; i < head.length; i++) if (i !== skip && re.test(head[i]) && /SKU|รหัส/i.test(head[i])) return i;
      return -1;
    }
    var buy = find(/ซื้อ/, -1), after = find(/แปลง|ขาย/, buy);
    if (buy < 0 || after < 0) { buy = 0; after = 1; }
    var seen = {}, pairs = [], blank = 0;
    g.slice(1).forEach(function (r) {
      var b = up(r[buy]).replace(/\s+/g, ''), a = up(r[after]).replace(/\s+/g, '');
      if (!a && !b) return;
      if (!a || !b) { blank++; return; }
      if (a === b || seen[a + '|' + b]) return;
      seen[a + '|' + b] = 1;
      pairs.push([a, b]);
    });
    return { pairs: pairs, cols: [head[buy] || '', head[after] || ''], blank: blank };
  }

  /**
   * แท็บ ความจุต่อพาเลท → { rows: [[SKU, Product ID, ชิ้นต่อพาเลท]], cols, blank } แบบ WmsPutaway.capFromRows
   * มีคอลัมน์ ขึ้นแร็ค = เพิ่ม rack: [[SKU, Product ID, ที่พิมพ์]] (ไม่มีคอลัมน์ = ไม่มีคีย์ rack)
   * หัวตารางอยู่ใน 10 แถวแรก: SKU หรือ Product ID + STD / pallet · ช่องความจุว่าง / ไม่ใช่ตัวเลข นับใน blank · 0 เก็บไว้
   */
  function readCap(grid) {
    var g = (grid || []).filter(function (r) { return Array.isArray(r); });
    if (!g.length) return { error: 'ชีตว่าง' };
    var hi = -1, c = null;
    for (var i = 0; i < Math.min(g.length, 10) && hi < 0; i++) {
      var x = { sku: -1, pid: -1, cap: -1, rack: -1 };
      g[i].forEach(function (v, j) {
        var h = text(v);
        if (/^ขึ้นแร็ค/.test(h)) { if (x.rack < 0) x.rack = j; }
        else if (x.cap < 0 && /std|pallet|พาเลท|ความจุ/i.test(h)) x.cap = j;
        else if (x.pid < 0 && /product\s*id|รหัสยาว/i.test(h)) x.pid = j;
        else if (x.sku < 0 && /^sku$|^รหัสสินค้า$/i.test(h)) x.sku = j;
      });
      if (x.cap >= 0 && (x.sku >= 0 || x.pid >= 0)) { hi = i; c = x; }
    }
    if (hi < 0) return { error: 'หาหัวตาราง SKU กับ STD / pallet ไม่เจอ' };
    var rows = [], blank = 0, seen = {}, rack = [], seenRack = {};
    g.slice(hi + 1).forEach(function (r) {
      var sku = c.sku >= 0 ? up(r[c.sku]).replace(/\s+/g, '') : '', pid = c.pid >= 0 ? up(r[c.pid]).replace(/\s+/g, '') : '';
      if (!sku && !pid) return;
      var k = sku + '|' + pid, rv = c.rack >= 0 ? text(r[c.rack]) : '';
      if (rv && !seenRack[k]) { seenRack[k] = 1; rack.push([sku, pid, rv]); }
      if (!isNum(r[c.cap]) || numOf(r[c.cap]) < 0) {
        if (!rv || text(r[c.cap])) blank++;   // ตั้งขึ้นแร็คอย่างเดียว ไม่นับว่าช่องว่าง
        return;
      }
      if (seen[k]) return;
      seen[k] = 1;
      rows.push([sku, pid, numOf(r[c.cap])]);
    });
    var head = g[hi].map(text);
    var res = { rows: rows, cols: [c.sku >= 0 ? head[c.sku] : '', c.pid >= 0 ? head[c.pid] : '', head[c.cap]].filter(Boolean), blank: blank };
    if (c.rack >= 0) res.rack = rack;
    return res;
  }

  /**
   * ชีตจากไฟล์ที่วาง [{name, grid}] (ไฟล์เดียวหลายชีต หรือหลายไฟล์) → แยกตามชนิด
   * { stock, loss, cost, sup, conv, cap, tabs: {ชนิด: ชื่อชีต}, skipped: [ชื่อชีต], bad: [{tab, why}] } ไม่มีอะไรใช้ได้ = { error }
   */
  function readSheets(sheets) {
    var out = { stock: null, loss: null, cost: null, sup: null, conv: null, cap: null, tabs: {}, skipped: [], bad: [] };
    (sheets || []).forEach(function (s) {
      var t = tabRows(s.grid), kind = sheetKind(s.name, t.head);
      if (!kind || out[kind]) { out.skipped.push(s.name); return; }
      var r = kind === 'stock' ? readStock(t)
        : kind === 'loss' ? readSide(t, [/loss/i, /คงเหลือ|จำนวน|qty|total|ยอด/i], true)
        : kind === 'cost' ? readSide(t, [/ราคาทุน|ทุน|cost/i, /ราคา|price/i], false)
        : kind === 'sup' ? readSup(s.grid) : kind === 'cap' ? readCap(s.grid) : readConv(s.grid);
      if (r.error) { out.bad.push({ tab: s.name, why: r.error }); return; }
      r.tab = s.name;
      out[kind] = r;
      out.tabs[kind] = s.name;
    });
    if (out.stock && out.stock.list.length > TRC_MAX) return { error: 'ยอด TRcloud ต้องมีไม่เกิน ' + TRC_MAX + ' SKU' };
    if (!out.stock && !out.loss && !out.cost && !out.sup && !out.conv && !out.cap) {
      return { error: out.bad.length ? out.bad.map(function (b) { return b.tab + ': ' + b.why; }).join(' · ') : 'ไม่เจอชีต Stock, WH-Loss, ราคาทุน, PO. Truck, MASTER แปลงสินค้า หรือ ความจุต่อพาเลท' };
    }
    return out;
  }

  /**
   * ยอด TRcloud ที่อ่านแล้ว → เอกสาร trc/{วันที่} (TSV ประหยัดที่)
   * info = {day, by, name, files} · ต้องมีชีต Stock (Loss กับราคาทุนไม่มีได้ ใช้ของไฟล์ก่อนหน้าไม่ได้ ต้องอยู่ในไฟล์เดียวกัน)
   */
  function trcDoc(parsed, info) {
    if (!parsed || !parsed.stock) return { error: 'ไม่มีชีต Stock (ยอดคงเหลือ TRcloud ต้องมีคอลัมน์ NEW WH)' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(info.day || ''))) return { error: 'วันที่ของยอดต้องเป็น yyyy-mm-dd' };
    var d = {
      v: 1, day: info.day, at: C.TIME, by: info.by || '', name: info.name || '', files: C.plain(info.files, 300),
      tabs: { stock: parsed.tabs.stock || '', loss: parsed.tabs.loss || '', cost: parsed.tabs.cost || '' },
      n: parsed.stock.list.length,
      rows: C.enc(parsed.stock.list),
      loss: parsed.loss ? C.enc(parsed.loss.list) : '',
      cost: parsed.cost ? C.enc(parsed.cost.list) : '',
      hasLoss: !!parsed.loss, hasCost: !!parsed.cost,
    };
    var size = C.byteLen(JSON.stringify(d));
    if (size > DOC_BYTES) return { error: 'ไฟล์ยอด TRcloud ใหญ่เกิน (' + Math.round(size / 1000) + ' KB เกิน ' + DOC_BYTES / 1000 + ' KB)' };
    return { data: d };
  }
  /** เอกสาร trc → { day, at, by, name, files, tabs, n, stock: {รหัส: {sku, name, main, qa}}, loss, cost } */
  function trcIn(d) {
    if (!d) return null;
    var stock = {};
    C.dec(d.rows).forEach(function (r) { if (r[0]) stock[norm(r[0])] = { sku: r[0], name: r[1] || '', main: +r[2] || 0, qa: +r[3] || 0 }; });
    function side(s, has) {
      if (!has) return null;
      var m = {};
      C.dec(s).forEach(function (r) { if (r[0]) m[norm(r[0])] = +r[1] || 0; });
      return m;
    }
    return { day: d.day || '', at: +d.at || 0, by: d.by || '', name: d.name || '', files: d.files || '', tabs: d.tabs || {}, n: +d.n || 0,
      stock: stock, loss: side(d.loss, d.hasLoss), cost: side(d.cost, d.hasCost) };
  }

  /** PO → Supplier / MASTER แปลงสินค้า / ความจุต่อพาเลท ที่อ่านแล้ว → เอกสาร master/sup, master/conv, master/cap (รูปที่ fifo() อ่าน) */
  function masterDoc(kind, part, info) {
    if (!part) return { error: kind === 'sup' ? 'ไม่มีชีต PO. Truck' : kind === 'cap' ? 'ไม่มีชีต ความจุต่อพาเลท' : 'ไม่มีชีต MASTER แปลงสินค้า' };
    var list = kind === 'conv' ? part.pairs : part.rows;
    if (!list.length) return { error: 'ชีต ' + part.tab + ' ไม่มีแถวที่ใช้ได้' };
    if (list.length > MASTER_MAX) return { error: 'ตารางหลักต้องมีไม่เกิน ' + MASTER_MAX + ' แถว' };
    var d = kind === 'sup'
      ? { tab: part.tab, rows: C.enc(list), dup: part.dup.slice(0, 200), n: list.length }
      : { tab: part.tab, cols: part.cols, rows: C.enc(list), blank: part.blank, n: list.length };   // conv · cap
    d.by = info.by || '';
    d.name = info.name || '';
    d.at = C.TIME;
    if (C.byteLen(JSON.stringify(d)) > DOC_BYTES) return { error: 'ตารางหลักใหญ่เกินที่เก็บได้' };
    return { data: d };
  }

  /* ── กระทบยอด ─────────────────────────────────────────────────────────── */

  /** ยอดต่อกอง ณ สิ้นวัน day (เอกสารที่วันที่ไม่เกินวันนั้น ตามลำดับ seq) · ไม่ส่ง day = ตอนนี้ */
  function pilesAsOf(local, day) {
    var map = {};
    C.liveDocs(local).slice().sort(function (a, b) { return a.seq - b.seq; }).forEach(function (d) {
      if (!day || d.type === C.TYPE_OPEN || d.date <= day) map = C.applyDoc(map, d);
    });
    return map;
  }

  /**
   * ยอดในระบบ (สิ้นวันของไฟล์) เทียบยอด TRcloud ราย SKU ราย คลัง
   * จับคู่: SKU เต็ม → SKU → SKU ตอนซื้อ (MASTER แปลงสินค้า) · รหัสมีอักษรไทยและ TRcloud ไม่มี = ของใช้ภายใน ไม่เทียบ
   * กลุ่ม ok ตรง · diff ต่าง · notrc ไม่มีใน TRcloud · nosys TRcloud มีของ ระบบไม่มี
   * wait = จำนวนเอกสารรอลง TRcloud ที่มี SKU นี้ (ส่วนต่างมักมาจากตรงนี้)
   */
  function trcCompare(local, trc, now) {
    var T = trc.stock || {}, L = trc.loss || {}, P = trc.cost || {};
    var piles = pilesAsOf(local, trc.day);
    var buy = {};
    var conv = local.master && local.master.conv;
    if (conv) C.dec(conv.rows).forEach(function (r) { if (r[0] && r[1]) buy[norm(r[0])] = norm(r[1]); });
    var names = {};
    (local.docs || []).forEach(function (d) { Object.keys(d.names || {}).forEach(function (k) { names[norm(k)] = d.names[k]; }); });
    var waitBy = {};
    trList(local, now).forEach(function (x) {
      if (x.state !== C.TR_WAIT) return;
      x.skus.forEach(function (s) { var k = norm(s); waitBy[k] = (waitBy[k] || 0) + 1; });
    });
    var by = {}, order = [], internal = {};
    function slot(k, code) {
      if (!by[k]) { by[k] = { key: k, sku: T[k] ? T[k].sku : code, name: (T[k] && T[k].name) || names[k] || '', s02: 0, sqa: 0, conv: {} }; order.push(k); }
      return by[k];
    }
    Object.keys(piles).forEach(function (pk) {
      var p = piles[pk];
      if (!p.qty) return;
      var a = norm(p.long), b = norm(p.sku), k = '', from = '';
      if (a && T[a]) k = a;
      else if (b && T[b]) k = b;
      else if (a && buy[a] && T[buy[a]]) { k = buy[a]; from = p.long; }
      else if (b && buy[b] && T[buy[b]]) { k = buy[b]; from = p.sku; }
      else if (THAI.test(p.sku + p.long)) { internal[a || b] = 1; return; }
      else k = a || b;
      var x = slot(k, p.long || p.sku);
      if (from) x.conv[from] = 1;
      if (C.whOf(p.loc) === C.WH_QA) x.sqa = round3(x.sqa + p.qty); else x.s02 = round3(x.s02 + p.qty);
    });
    Object.keys(T).forEach(function (k) { if (!by[k] && (T[k].main || T[k].qa)) slot(k, T[k].sku); });
    var tot = { skus: 0, ok: 0, diff: 0, notrc: 0, nosys: 0, internal: Object.keys(internal).length, s02: 0, sqa: 0, t02: 0, tqa: 0, value: 0, noCost: 0 };
    var items = order.map(function (k) {
      var x = by[k], t = T[k];
      x.t02 = t ? t.main : 0;
      x.tqa = t ? t.qa : 0;
      x.d02 = round3(x.s02 - x.t02);
      x.dqa = round3(x.sqa - x.tqa);
      x.loss = L[k] || 0;
      x.cost = P[k] !== undefined ? P[k] : null;
      x.wait = waitBy[k] || 0;
      x.conv = Object.keys(x.conv);
      x.group = !t ? 'notrc' : !x.s02 && !x.sqa ? 'nosys' : Math.abs(x.d02) < 1e-9 && Math.abs(x.dqa) < 1e-9 ? 'ok' : 'diff';
      x.value = x.cost !== null ? Math.round((x.d02 + x.dqa) * x.cost * 100) / 100 : null;
      tot.skus++;
      tot[x.group]++;
      tot.s02 = round3(tot.s02 + x.s02); tot.sqa = round3(tot.sqa + x.sqa);
      tot.t02 = round3(tot.t02 + x.t02); tot.tqa = round3(tot.tqa + x.tqa);
      if (x.group !== 'ok') { if (x.value === null) tot.noCost++; else tot.value = Math.round((tot.value + x.value) * 100) / 100; }
      return x;
    });
    items.sort(function (a, b) {
      var g = { diff: 0, nosys: 1, notrc: 2, ok: 3 };
      return g[a.group] - g[b.group] || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
    });
    return { day: trc.day, items: items, tot: tot };
  }

  /** ไฟล์ Excel ของการกระทบยอด: ราย SKU + สรุป */
  function trcBook(res, trc) {
    var GR = { ok: 'ตรง', diff: 'ต่าง', notrc: 'ไม่มีใน TRcloud', nosys: 'TRcloud มี ระบบไม่มี' };
    var head = ['SKU', 'ชื่อสินค้า', 'ระบบ WH-02', 'TRcloud WH-02', 'ต่าง WH-02', 'ระบบ WH-QA', 'TRcloud WH-QA', 'ต่าง WH-QA', 'WH-Loss', 'ราคาทุน', 'มูลค่าต่าง', 'รอลง TRcloud', 'ผล', 'SKU แปลงที่รวมเข้า'];
    var a1 = [head].concat(res.items.map(function (x) {
      return [x.sku, x.name, x.s02, x.t02, x.d02, x.sqa, x.tqa, x.dqa, x.loss || '', x.cost === null ? '' : x.cost, x.value === null ? '' : x.value, x.wait || '', GR[x.group], x.conv.join(', ')];
    }));
    var t = res.tot;
    var a2 = [['หัวข้อ', 'ค่า'], ['ยอด TRcloud วันที่', trc.day], ['นำเข้าโดย', trc.name], ['ไฟล์', trc.files],
      ['SKU ที่เทียบ', t.skus], ['ตรง', t.ok], ['ต่าง', t.diff], ['ไม่มีใน TRcloud', t.notrc], ['TRcloud มี ระบบไม่มี', t.nosys], ['ของใช้ภายใน (ไม่เทียบ)', t.internal],
      ['ระบบ WH-02 / TRcloud WH-02', t.s02 + ' / ' + t.t02], ['ระบบ WH-QA / TRcloud WH-QA', t.sqa + ' / ' + t.tqa],
      ['มูลค่าต่างรวม (บาท)', t.value], ['SKU ที่ต่างแต่ไม่มีราคาทุน', t.noCost],
      ['หมายเหตุ', 'ยอดในระบบคิดจากเอกสารที่วันที่ไม่เกินวันของไฟล์ · Location QA, IQA = WH-QA ที่เหลือ (รวม RIB) = WH-02']];
    return [{ name: 'เทียบราย SKU', aoa: a1, cols: [16, 30, 11, 13, 11, 11, 13, 11, 9, 9, 11, 11, 16, 20] }, { name: 'สรุป', aoa: a2, cols: [30, 40] }];
  }

  /* ── ชีตเดิม (ช่วงเปลี่ยนผ่าน) ───────────────────────────────────────── */

  /**
   * แถวของเอกสาร → ข้อความวางในชีต Transaction เดิม รูปเดียวกับ WmsBook.tsv(แถวที่คัดลอก, ชื่อคนลง, เลขที่)
   * คอลัมน์ N (RUNNUMBER): เลข TRcloud ของแถว → เลขที่ใส่ทีหลังในหน้ารอลง → เลขที่เอกสาร
   */
  function sheetTsv(d) {
    var typed = d.trBy && d.tr ? d.tr : '';
    return d.rows.map(function (c) {
      return [c[0], '', '', c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], '', d.name || '', c[10] || typed || d.no || ''].map(cell).join('\t');
    }).join('\n');
  }
  /** เอกสารของวันที่บันทึก day (วันที่ไทย) ตามลำดับที่บันทึก ไม่นับยอดยกมา */
  function xferDocs(local, day) {
    return C.liveDocs(local).filter(function (d) { return d.type !== C.TYPE_OPEN && d.stamp && d.stamp.slice(0, 10) === day; })
      .sort(function (a, b) { return a.seq - b.seq; });
  }
  /**
   * วันที่มีเอกสาร ใหม่สุดก่อน { day, docs, rows, first, last, done } · log = xfer/log { วัน: {by, at, n, last} }
   * วางแล้วแต่มีเอกสารเพิ่มหลังวาง (เลขที่สุดท้ายไม่ตรง) = more บอกให้วางส่วนที่เพิ่ม
   */
  function xferDays(local, log) {
    var by = {};
    C.liveDocs(local).forEach(function (d) {
      if (d.type === C.TYPE_OPEN || !d.stamp) return;
      var day = d.stamp.slice(0, 10), x = by[day] || (by[day] = { day: day, docs: 0, rows: 0, first: '', last: '', firstSeq: Infinity, lastSeq: -1 });
      x.docs++;
      x.rows += d.rows.length;
      if (d.seq < x.firstSeq) { x.firstSeq = d.seq; x.first = d.no; }
      if (d.seq > x.lastSeq) { x.lastSeq = d.seq; x.last = d.no; }
    });
    return Object.keys(by).sort().reverse().map(function (k) {
      var x = by[k], e = log && Object.prototype.hasOwnProperty.call(log, k) ? log[k] : null;
      var done = e && typeof e === 'object' ? { by: C.safeText(e.by), at: C.safeTime(e.at), n: C.safeNum(e.n), last: C.safeText(e.last) } : null;
      return { day: k, docs: x.docs, rows: x.rows, first: x.first, last: x.last, done: done, more: !!(done && done.last && done.last !== x.last) };
    });
  }
  /** ข้อความวางชีตเดิมของวันหนึ่ง after = เลขที่ที่วางไปแล้ว (เอาเฉพาะที่บันทึกหลังจากนั้น) */
  function xferText(local, day, after) {
    var list = xferDocs(local, day);
    if (after) {
      var i = list.findIndex(function (d) { return d.no === after; });
      if (i >= 0) list = list.slice(i + 1);
    }
    var parts = list.map(sheetTsv).filter(Boolean);
    return { text: parts.join('\n'), docs: list.length, rows: list.reduce(function (a, d) { return a + d.rows.length; }, 0), last: list.length ? list[list.length - 1].no : '' };
  }

  /* ── สำรองข้อมูล ──────────────────────────────────────────────────────── */

  /**
   * ไฟล์สำรองจากสำเนาในเครื่อง (หัวหน้า) extra = { users: [{email, …}], trc: {id, data}, xfer: ข้อมูล xfer/log }
   * เอกสารแยกส่วนใหม่ด้วย splitDoc แบบตอนบันทึก ได้ข้อมูลรูปเดียวกับในฐาน
   */
  function backupOf(local, extra, now) {
    extra = extra || {};
    var data = {};
    (local.docs || []).forEach(function (d) {
      var out = C.docOut(d);
      var parts = (d.cut && d.cut.length > 1 && C.splitByCut(d.id, out, d.cut)) || C.splitDoc(d.id, out, C.PART_BYTES);
      data['docs/' + d.id] = parts.main;
      parts.rest.forEach(function (x) { data['docs/' + x.id] = x.data; });
    });
    if (local.meta) data['meta/head'] = clone(local.meta);
    Object.keys(local.master || {}).forEach(function (n) { data['master/' + n] = clone(local.master[n]); });
    (extra.users || []).forEach(function (u) {
      var o = { name: u.name, role: u.role, active: u.active === true };
      if (u.team) o.team = u.team;
      if (u.by) o.by = u.by;
      if (u.at) o.at = u.at;
      if (u.last) o.last = u.last;
      data['users/' + u.email] = o;
    });
    if (extra.trc && extra.trc.id) data['trc/' + extra.trc.id] = clone(extra.trc.data);
    if (extra.xfer) data['xfer/log'] = clone(extra.xfer);
    return { kind: BACKUP_KIND, v: 1, made: now, from: 'browser', seq: local.seq || 0, docs: (local.docs || []).length, data: data };
  }

  /** อ่านไฟล์สำรอง (ข้อความ JSON หรือวัตถุ) → { backup } หรือ { error } */
  function readBackup(src) {
    var b = src;
    if (typeof src === 'string') { try { b = JSON.parse(src); } catch (e) { return { error: 'ไม่ใช่ไฟล์ JSON' }; } }
    if (!b || b.kind !== BACKUP_KIND || +b.v !== 1 || !b.data || typeof b.data !== 'object') return { error: 'ไม่ใช่ไฟล์สำรองของระบบใหม่ (wms-fire-backup)' };
    var bad = Object.keys(b.data).filter(function (p) { return !/^(docs|meta|users|master|trc|xfer)\/[^/]+$/.test(p); });
    if (bad.length) return { error: 'ไฟล์สำรองมีที่เก็บที่ไม่รู้จัก ' + bad.slice(0, 3).join(', ') };
    if (!b.data['meta/head']) return { error: 'ไฟล์สำรองไม่มี meta/head' };
    return { backup: b };
  }

  /**
   * รวมไฟล์สำรองหลายไฟล์ (เรียงตามเวลาที่ทำ ไฟล์หลังทับไฟล์ก่อน) → data เดียว
   * เอกสารหลักกับส่วนแยก (~2 ~3) ไปด้วยกัน: ไฟล์หลังมีเอกสารหลัก ส่วนแยกจากไฟล์ก่อนทิ้ง (แบบ restoreAll ของ fire-backup.gs)
   */
  function mergeBackups(list) {
    var data = {}, partsOf = Object.create(null);   // รหัสชุดชนชื่อในตัวของ JS ได้
    list.slice().sort(function (a, b) { return (+a.made || 0) - (+b.made || 0); }).forEach(function (b) {
      Object.keys(b.data).forEach(function (p) {
        var m = /^docs\/([^~]+)$/.exec(p);
        if (m && partsOf[m[1]]) { partsOf[m[1]].forEach(function (q) { delete data[q]; }); delete partsOf[m[1]]; }
      });
      Object.keys(b.data).forEach(function (p) {
        data[p] = b.data[p];
        var m = /^docs\/([^~]+)~\d+$/.exec(p);
        if (m) (partsOf[m[1]] = partsOf[m[1]] || []).push(p);
      });
    });
    return data;
  }

  /* ── ปิดเดือน: รวมเอกสารของเดือนที่จบแล้วเป็นก้อน (เครื่องใหม่อ่านไม่กี่ก้อนแทนทีละเอกสาร) ─────── */

  var ARCH_BYTES = 900000;      // ข้อความในก้อนเดียว (Firestore รับ 1 MiB)
  var TR_MARGIN = 600000;       // เผื่อเวลาเซิร์ฟเวอร์ 10 นาที ตอนดึงเลข TRcloud ที่ใส่หลังปิดเดือน
  var TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /** 'ปปดด' (ปี ค.ศ. 2 หลัก) → 'พ.ย. 69' */
  function monthTh(m) {
    m = String(m || '');
    if (!/^\d{4}$/.test(m)) return m;
    return (TH_MON[+m.slice(2) - 1] || m.slice(2)) + ' ' + String((2000 + +m.slice(0, 2) + 543) % 100);
  }
  /** เดือนของเอกสารจากเลขที่ T{ปปดด}-{ลำดับ} */
  function monthOfDoc(d) { var x = /^T(\d{4})-/.exec(d && d.no || ''); return x ? x[1] : ''; }

  /**
   * เอกสารหนึ่งฉบับในก้อน = [{id, data}, …ส่วนแยก] ข้อมูลแบบที่เก็บใน docs (เวลาเป็นมิลลิวินาที)
   * เอกสารที่เคยแยกส่วน แยกตามจุดตัดเดิม docIn() อ่านกลับได้ตรงกับดึงจากฐานทีละเอกสาร
   */
  function archGroup(d) {
    var out = C.docOut(d);
    var parts = d.cut && d.cut.length > 1 && C.splitByCut(d.id, out, d.cut);
    if (!parts) return [{ id: d.id, data: out }];
    return [{ id: d.id, data: parts.main }].concat(parts.rest);
  }
  function groupDoc(g) { return C.docIn(g[0].id, g[0].data, g.slice(1).map(function (p) { return p.data; })); }

  /** แบ่งรายการเป็นก้อน ข้อความ JSON ไม่เกิน limit ไบต์ · ชิ้นที่ใหญ่เกินก้อนเดียว → big */
  function pack(items, limit) {
    var chunks = [], cur = [], size = 2, big = [];
    items.forEach(function (it) {
      var s = C.byteLen(JSON.stringify(it));
      if (s + 2 > limit) { big.push(it); return; }
      if (cur.length && size + s + 1 > limit) { chunks.push(cur); cur = []; size = 2; }
      cur.push(it);
      size += s + 1;
    });
    if (cur.length) chunks.push(cur);
    return { chunks: chunks, big: big };
  }

  /**
   * เดือนถัดไปที่ปิดได้ (ต่อจากเดือนล่าสุดที่ปิด ตามลำดับ seq ไม่ข้ามเดือน)
   * → { m, from, to, docs } หรือ { error, none | wait }
   * เดือนที่ยังไม่จบ (เดือนปัจจุบันตามเวลาไทย) ปิดไม่ได้ · เอกสารต้องครบทุก seq (ซิงก์ก่อน)
   * เอกสารเดือนเก่าที่โผล่หลังปิดไปแล้ว (นาฬิกาเครื่องผิด) ไปอยู่ในก้อนเดือนถัดไป ลำดับ seq ไม่ขาด
   */
  function archNext(local, idx, now) {
    var months = (idx && idx.months) || [], last = months.length ? months[months.length - 1] : null;
    var after = last ? +last.to : 0, cur = C.yymm(now);
    var docs = (local.docs || []).filter(function (d) { return d.seq > after; }).sort(function (a, b) { return a.seq - b.seq; });
    if (!docs.length) return { error: 'ยังไม่มีเอกสารใหม่ให้ปิดเดือน', none: 1 };
    var from = last ? after + 1 : docs[0].seq;
    if (docs[0].seq !== from) return { error: 'สำเนาในเครื่องขาดเอกสารลำดับที่ ' + from + ' กดโหลดใหม่ทั้งหมดแล้วลองอีกครั้ง' };
    var m = '';
    for (var i = 0; i < docs.length && !m; i++) {
      var mo = monthOfDoc(docs[i]);
      if (mo && (!last || mo > last.m)) m = mo;
    }
    if (!m) return { error: 'ยังไม่มีเอกสารเดือนใหม่ให้ปิด', none: 1 };
    if (m >= cur) return { error: 'เดือน ' + monthTh(m) + ' ยังไม่จบ ปิดได้ตั้งแต่วันที่ 1 เดือนถัดไป', wait: m };
    var run = [];
    for (var j = 0; j < docs.length; j++) {
      var dm = monthOfDoc(docs[j]) || m;
      if (dm > m) break;
      if (docs[j].seq !== from + run.length) return { error: 'สำเนาในเครื่องขาดเอกสารลำดับที่ ' + (from + run.length) + ' กดโหลดใหม่ทั้งหมดแล้วลองอีกครั้ง' };
      run.push(docs[j]);
    }
    return { m: m, from: from, to: run[run.length - 1].seq, docs: run };
  }

  /**
   * แผนปิดเดือน → { m, entry, chunks: [[path, data]], ov: [[path, data]], index } หรือ { error }
   * arch/{ปปดด}-{k} = { m, k, n, t: JSON [[{id, data}, …ส่วนแยก], …] } · เอกสารใหญ่เกินก้อน = skip (เครื่องใหม่อ่านทีละเอกสาร)
   * arch/ov-{ปปดด}-{k} = เลข TRcloud ที่ใส่หลังปิดเดือนก่อน ๆ [[id, tr, trState, trBy, trAt], …] ชุดใหม่ทุกครั้งที่ปิด (ชุดที่ยืนยันแล้ว Rules ไม่ให้ทับ)
   *              ใบที่ตรวจ / อนุมัติหลังปิดเดือนนั้น ต่อท้าย [.., ck, ckName, ckAt, ap, apName, apAt, okAt]
   *              ใบที่ไม่รับ ต่อท้ายอีก [.., rj, rjName, rjWhy]
   *              ใบที่เคยเปลี่ยนเลข ช่องที่ 16 (ดัชนี 15) = trLog ช่องที่ไม่มีค่าเว้นว่าง
   * arch/index = { v, months: [{m, from, to, docs, n, skip, bytes, at, by, trAt, okAt}], ov: {m, n, fix, trAt, okAt, at} } เขียนสุดท้าย (จุดยืนยัน)
   * trAt / okAt = เวลาเซิร์ฟเวอร์ล่าสุดที่เครื่องหัวหน้าเห็นเลข TRcloud / การตรวจอนุมัติ (เครื่องใหม่ดึงที่แก้หลังจากนี้)
   */
  function archPlan(local, idx, now, opt) {
    opt = opt || {};
    var nx = archNext(local, idx, now);
    if (nx.error) return nx;
    var limit = opt.bytes || ARCH_BYTES, months = ((idx && idx.months) || []).slice();
    var packed = pack(nx.docs.map(archGroup), limit);
    var bytes = 0;
    var chunks = packed.chunks.map(function (c, i) {
      var t = JSON.stringify(c);
      bytes += C.byteLen(t);
      return ['arch/' + nx.m + '-' + (i + 1), { m: nx.m, k: i + 1, n: c.length, t: t }];
    });
    var trAt = +local.trAt || 0, okAt = +local.okAt || 0;
    var entry = {
      m: nx.m, from: nx.from, to: nx.to, docs: nx.docs.length, n: chunks.length,
      skip: packed.big.map(function (g) { return g[0].id; }), bytes: bytes, at: now, by: opt.by || '', trAt: trAt, okAt: okAt,
    };
    /* เลข TRcloud ของเดือนที่ปิดไปแล้วที่ใส่หลังวันปิด (ก้อนเก่ายังเป็นค่าตอนปิด) */
    var fix = [];
    if (months.length) {
      var lastTo = +months[months.length - 1].to;
      (local.docs || []).forEach(function (d) {
        if (d.seq > lastTo || !(d.trAt > 0 || d.okAt > 0)) return;
        var mo = null;
        for (var i = 0; i < months.length && !mo; i++) if (d.seq >= months[i].from && d.seq <= months[i].to) mo = months[i];
        if (!mo) return;
        var tr = d.trAt > 0 && d.trAt > (+mo.trAt || 0) - TR_MARGIN, ok = d.okAt > 0 && d.okAt > (+mo.okAt || 0) - TR_MARGIN;
        if (!tr && !ok) return;
        var e = [d.id, d.tr || '', d.trState || '', d.trBy || '', d.trAt || 0];
        if (ok) e.push(d.ck || '', d.ckName || '', d.ckAt || 0, d.ap || '', d.apName || '', d.apAt || 0, d.okAt);
        if (ok && d.rj) e.push(d.rj, d.rjName || '', d.rjWhy || '');
        if (tr && d.trLog && d.trLog.length) { while (e.length < 15) e.push(''); e.push(d.trLog); }
        fix.push(e);
      });
    }
    var ovp = pack(fix, limit);
    if (ovp.big.length) return { error: 'รายการเลข TRcloud ยาวผิดปกติ ' + ovp.big[0][0] };
    var ov = ovp.chunks.map(function (c, i) { return ['arch/ov-' + nx.m + '-' + (i + 1), { m: nx.m, k: i + 1, n: c.length, t: JSON.stringify(c) }]; });
    months.push(entry);
    var index = { v: 1, months: months, ov: { m: nx.m, n: ov.length, fix: fix.length, trAt: trAt, okAt: okAt, at: now } };
    return { m: nx.m, entry: entry, chunks: chunks, ov: ov, index: index };
  }

  /**
   * เดือนที่ปิดแล้วที่เครื่องนี้ควรอ่านเป็นก้อน (seq = เอกสารล่าสุดในเครื่อง)
   * ต่อจากที่มีโดยไม่ข้าม และคุ้มกว่าอ่านทีละเอกสาร
   */
  function archUse(idx, seq) {
    var out = [], at = seq;
    ((idx && idx.months) || []).forEach(function (mo) {
      if (+mo.to <= at || +mo.from > at + 1) return;
      if (+mo.to - at <= (+mo.n || 0) + 2 * (mo.skip || []).length) return;
      out.push(mo);
      at = +mo.to;
    });
    return out;
  }
  /** ก้อนจากฐาน → เอกสารรูปในเครื่อง (อ่านไม่ได้ = null) */
  function archDocs(chunk) {
    var a;
    try { a = JSON.parse(chunk && chunk.t); } catch (e) { return null; }
    if (!Array.isArray(a)) return null;
    try { return a.map(groupDoc); } catch (e) { return null; }
  }
  /** ก้อนเลข TRcloud → [[id, tr, trState, trBy, trAt (, ck, ckName, ckAt, ap, apName, apAt, okAt (, rj, rjName, rjWhy))]] */
  function archFix(chunk) {
    try { var a = JSON.parse(chunk && chunk.t); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  /** จุดเริ่มดึงเลข TRcloud (key trAt) / การตรวจอนุมัติ (key okAt) หลังอ่านก้อน (ms) · ยังไม่เคยปิด = null */
  function archFloor(idx, key) {
    var ms = (idx && idx.months) || [];
    key = key || 'trAt';
    if (!ms.length) return null;
    var w = idx.ov && idx.ov[key] !== undefined ? +idx.ov[key] : +ms[ms.length - 1][key];
    return (w || 0) - TR_MARGIN;
  }

  /** สรุปหน้าปิดเดือน: เดือนที่ปิดแล้ว + เดือนถัดไปที่ปิดได้ + ประมาณการอ่านของเครื่องใหม่ */
  function archSummary(local, idx, now) {
    var months = ((idx && idx.months) || []).map(function (mo) {
      return { m: mo.m, label: monthTh(mo.m), from: mo.from, to: mo.to, docs: mo.docs, n: mo.n, skip: (mo.skip || []).length, bytes: mo.bytes, at: mo.at, by: mo.by };
    });
    var nx = archNext(local, idx, now);
    var next = nx.error ? { error: nx.error, wait: nx.wait || '', none: !!nx.none } : { m: nx.m, label: monthTh(nx.m), from: nx.from, to: nx.to, docs: nx.docs.length };
    var archived = months.reduce(function (a, mo) { return a + (+mo.docs || 0); }, 0);
    var reads = months.reduce(function (a, mo) { return a + (+mo.n || 0) + (+mo.skip || 0); }, 0) + ((idx && idx.ov && +idx.ov.n) || 0);
    var total = (local.docs || []).length;
    return {
      months: months, next: next, fix: (idx && idx.ov && +idx.ov.fix) || 0,
      fresh: { before: total, after: Math.max(0, total - archived) + reads + (months.length ? 1 : 0) },
    };
  }

  window.WmsFireTrc = {
    TRC_HEAD: TRC_HEAD, TRC_DEPT: TRC_DEPT, TR_MAX: TR_MAX, TR_DAYS: TR_DAYS, FILE_TYPES: FILE_TYPES, TIME_KEYS: TIME_KEYS, BACKUP_KIND: BACKUP_KIND,
    norm: norm, trStates: trStates, trLocked: trLocked, trList: trList, trSet: trSet, trFile: trFile, kindOf: kindOf,
    tabRows: tabRows, sheetKind: sheetKind, readSheets: readSheets, trcDoc: trcDoc, trcIn: trcIn, masterDoc: masterDoc,
    pilesAsOf: pilesAsOf, trcCompare: trcCompare, trcBook: trcBook,
    sheetTsv: sheetTsv, xferDocs: xferDocs, xferDays: xferDays, xferText: xferText,
    backupOf: backupOf, readBackup: readBackup, mergeBackups: mergeBackups,
    ARCH_BYTES: ARCH_BYTES, TR_MARGIN: TR_MARGIN, monthTh: monthTh, monthOfDoc: monthOfDoc, archGroup: archGroup,
    archNext: archNext, archPlan: archPlan, archUse: archUse, archDocs: archDocs, archFix: archFix, archFloor: archFloor, archSummary: archSummary,
  };
})();
