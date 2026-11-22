/**
 * fire-backup.gs — สำรองระบบใหม่ (Firebase) ลง Google Drive ทุกคืน กู้คืนลงโปรเจกต์ใหม่ที่ว่าง
 *                  ทำชุดแชร์ให้ลิงก์ Supply chain (รายงาน FIFO ไม่ต้องเข้าระบบ) ทุก 2 ชั่วโมง
 *                  และตรวจแถวเอกสาร (เสกยอด ติดลบ) แล้วแจ้งหัวหน้าทุกราว 2 ชั่วโมง
 *
 * Firebase แผนฟรี (Spark) ไม่มีระบบสำรองให้ สคริปต์นี้อ่านข้อมูลผ่าน Firestore REST ด้วยสิทธิ์ของบัญชีที่รัน
 * (ต้องเป็น Owner หรือ Editor ของโปรเจกต์ Firebase) ไม่ผ่าน Rules ของหน้าเว็บ
 * ไม่ใช้ Google Sheet ไม่เปิดไฟล์ชีตใดเลย · ไม่แก้เอกสาร: เขียนฐานที่ใช้งานแค่ audit/last (ผลตรวจแถว)
 *
 * ── ตั้งครั้งเดียว (ตอนเปิดระบบจริง) ──
 *  1. script.google.com → โปรเจกต์ใหม่ (ไม่ผูกกับชีต) → วางไฟล์นี้ทั้งไฟล์
 *  2. ⚙️ การตั้งค่าโปรเจกต์ → ติ๊ก "แสดงไฟล์ Manifest appsscript.json" → เปิด appsscript.json วางตามนี้
 *       {
 *         "timeZone": "Asia/Bangkok",
 *         "runtimeVersion": "V8",
 *         "exceptionLogging": "STACKDRIVER",
 *         "oauthScopes": [
 *           "https://www.googleapis.com/auth/datastore",
 *           "https://www.googleapis.com/auth/drive",
 *           "https://www.googleapis.com/auth/script.external_request",
 *           "https://www.googleapis.com/auth/script.scriptapp"
 *         ]
 *       }
 *  3. ใส่ FIREBASE_PROJECT_ID ข้างล่าง (รหัสโปรเจกต์ใน Firebase console → Project settings → Project ID)
 *  4. เลือกฟังก์ชัน installBackup → เรียกใช้ → อนุญาตสิทธิ์ ได้ตั้งเวลาทุกคืนตี 2 + สำรองครั้งแรกทันที (ทั้งหมด)
 *  5. เปิด Google Drive ต้องมีโฟลเดอร์ BACKUP_FOLDER และไฟล์ wms-fire-backup-….json
 *
 * ── แต่ละคืน ──
 *  คืนแรก = ทุกอย่าง · คืนต่อไป = เฉพาะเอกสารใหม่ + เอกสารที่ลงเลข TRcloud ใหม่ + ใบที่ตรวจ / อนุมัติใหม่ + meta/head คนใช้ ตารางหลัก
 *  ยอด TRcloud ล่าสุด และบันทึกการวางชีตเดิม (อ่านไม่กี่สิบครั้ง ไม่กินโควตาฟรี)
 *  สคริปต์ล้ม Google ส่งอีเมลแจ้งเจ้าของสคริปต์เอง · เกิน 4 นาทีครึ่ง หยุดเองแล้วทำต่อคืนถัดไป
 *  อยากได้ไฟล์ทั้งหมดอีกชุด (เช่น ก่อนนับสต๊อกใหญ่): เรียกใช้ backupFull (อ่านเท่าจำนวนเอกสาร ทำนอกเวลางาน)
 *  ปุ่ม ⬇ ดาวน์โหลดไฟล์สำรอง ในหน้าตั้งค่าของหน้าเว็บ ได้ไฟล์รูปเดียวกัน วางรวมในโฟลเดอร์นี้ได้
 *
 * ── กู้คืน (โปรเจกต์ใหม่ที่ว่าง) ──
 *  1. สร้างโปรเจกต์ Firebase ใหม่ → เปิด Firestore → วาง firebase/firestore.rules → บัญชีนี้เป็น Owner
 *  2. ใส่ RESTORE_PROJECT_ID แล้วเรียกใช้ restoreAll
 *     อ่านทุกไฟล์สำรองในโฟลเดอร์ เรียงตามเวลาที่ทำ ไฟล์หลังทับไฟล์ก่อน เขียน meta/head เป็นอย่างสุดท้าย
 *  3. ยังไม่ครบ (บันทึกบอก "ยังไม่ครบ") → เรียกใช้ restoreAll อีกครั้ง ทำต่อจากที่ค้าง
 *  4. ใส่ config ของโปรเจกต์ใหม่ในหน้าเว็บ ทุกเครื่องโหลดสำเนาใหม่เอง
 *  โปรเจกต์ที่มีเอกสารหรือ meta/head อยู่แล้ว สคริปต์ไม่เขียนทับ
 *
 * ── ลิงก์ Supply chain (รายงาน FIFO ไม่ต้องเข้าระบบ แทนลิงก์เดิมที่อ่านชีต Transaction) ──
 *  1. เลือกฟังก์ชัน installShare → เรียกใช้ ได้ตั้งเวลาทำชุดแชร์ทุก 2 ชั่วโมง + ทำครั้งแรกทันที
 *     (ไฟล์ SHARE_FILE ในโฟลเดอร์เดียวกับไฟล์สำรอง ครั้งแรกอ่านเท่าจำนวนเอกสาร ครั้งต่อไปเฉพาะเอกสารใหม่)
 *  2. ทำให้ (Deploy) → การทำให้ใช้งานได้รายการใหม่ (New deployment) → ประเภท เว็บแอป (Web app)
 *     ดำเนินการในฐานะ: ฉัน (Me) · ผู้มีสิทธิ์เข้าถึง: ทุกคน (Anyone) → คัดลอก URL ของเว็บแอป (ลงท้าย /exec)
 *  3. หน้า FIFO สต๊อก (ระบบใหม่) → ⚙ ข้างปุ่ม 🔗 ลิงก์ Supply chain → วาง URL → ทดสอบและบันทึก → กด 🔗 คัดลอกลิงก์ส่งทีม
 *  ลิงก์หลุดไปคนนอก: จัดการการทำให้ใช้งานได้ → เก็บถาวรตัวเดิม → ทำรายการใหม่ ได้ URL ใหม่ → วางใหม่ในหน้า FIFO แล้วส่งลิงก์ใหม่
 *  เว็บแอปตอบแค่ชุดแชร์ (doGet) ไม่มีคำสั่งเขียน ไม่ส่งไฟล์สำรอง ไม่ส่งผลตรวจแถว ชุดแชร์ไม่มีชื่อคน อีเมล ออเดอร์
 *
 * ── ตรวจแถว จับการเสกยอด (Rules อ่านแถวไม่ได้ จึงจับย้อนหลังได้อย่างเดียว กันไม่ได้) ──
 *  1. วาง firebase/firestore.rules ชุดล่าสุดก่อน (หัวหน้าจึงอ่านผลตรวจได้)
 *  2. เลือกฟังก์ชัน installAudit → เรียกใช้ ได้ตรวจทุก 2 ชั่วโมง + ตรวจครั้งแรกทันที (ทำก่อนลงยอดยกมาได้)
 *  3. เจอ = หน้า วันนี้ ของหัวหน้าขึ้นการ์ดแดงกับเลขที่ · ยกเลิกใบนั้นแล้วการ์ดหายรอบถัดไป
 *     ยกเลิกไม่ได้ (ของถูกใช้แล้ว) = ปรับยอด แล้วเจ้าของสคริปต์เรียกใช้ auditSeen
 *
 * ไฟล์สำรองมีรายชื่อคนใช้และยอดสต๊อกทั้งหมด (ไม่มีรหัสผ่านหรือคีย์) เก็บโฟลเดอร์ไว้ในที่ที่คนนอกเข้าไม่ได้
 */

var FIREBASE_PROJECT_ID = '';   // โปรเจกต์ที่สำรอง เช่น wms-xxxx — ว่างไว้ = ยังไม่ตั้ง
var RESTORE_PROJECT_ID = '';    // โปรเจกต์ใหม่ที่ว่าง ใช้ตอนกู้คืนเท่านั้น
var BACKUP_FOLDER = 'WMS ระบบใหม่ สำรอง';
var BACKUP_HOUR = 2;            // ตี 2 ทุกคืน
var TZ = 'Asia/Bangkok';

var KIND = 'wms-fire-backup';
var TIME_KEYS = ['at', 'trAt', 'last', 'ckAt', 'apAt', 'okAt'];   // ช่องเวลาเซิร์ฟเวอร์ระดับบนของเอกสาร (ในไฟล์เก็บเป็นมิลลิวินาที)
var PATH_OK = /^(docs|meta|users|master|trc|xfer)\/[^/]+$/;
var PAGE = 40;                  // เอกสารต่อหน้าเวลาอ่าน (เอกสารใหญ่ได้ถึง 700 KB)
var STOP_MS = 270000;           // 4 นาทีครึ่ง (Apps Script ให้รันได้ 6 นาที)
var TR_MARGIN = 600000;         // อ่านเลข TRcloud ย้อน 10 นาทีกันพลาด
var WRITE_MAX = 300;            // เขียนต่อครั้ง (Firestore รับ 500)
var WRITE_BYTES = 6000000;      // ขนาดต่อครั้ง (Firestore รับ 10 MiB)

var SHARE_FILE = 'wms-fire-share.txt';   // ชุดแชร์ของลิงก์ Supply chain (ไม่ใช่ไฟล์สำรอง restoreAll ไม่อ่าน)
var SHARE_KIND = 'wms-fire-share';
var SHARE_HOURS = 2;                     // ทำชุดแชร์ทุก 2 ชั่วโมง (ไม่มีเอกสารใหม่ = อ่าน 1 ครั้ง)
var AUDIT_FILE = 'wms-fire-audit.txt';   // ตัวสะสมของการตรวจแถว (ไม่ใช่ไฟล์สำรอง restoreAll ไม่อ่าน)
var AUDIT_KIND = 'wms-fire-audit';
var AUDIT_HOURS = 2;                     // ตรวจแถวทุก 2 ชั่วโมง (ไม่มีเอกสารใหม่ = อ่าน 2 ครั้ง เขียน 1 ครั้ง)
var AUDIT_LIST = 100;                    // ใบที่ส่งให้หน้าเว็บแสดง (ใหม่สุดก่อน)
var AUDIT_ROWS = 40000;                  // แถวต่อใบที่หน้าเว็บอ่าน (OPEN_MAX)
var AUDIT_TEXT = ['no', 'type', 'date', 'by', 'name', 'stamp', 'ref', 'link', 'why', 'tr', 'trState', 'rows', 'names', 'orders'];
var AUDIT_NUM = ['seq', 'row', 'n', 'qty', 'part'];
var PARTS_MAX = 7;                       // ส่วนต่อชุด (Rules) หัวใบบอกมากกว่านี้ก็ไม่อ่านตาม
var CELL_MAX = 300;                      // ตัวอักษรต่อช่องที่หน้าเว็บอ่าน
var BARE = {};                           // ชื่อในนี้ชนช่องในตัวของ JavaScript (constructor, toString, ...)
var SHARE_MASTERS = ['conv', 'sup', 'cap'];                          // ตารางหลักที่หน้า FIFO ใช้
var SHARE_MASTER_KEYS = ['tab', 'cols', 'rows', 'dup', 'blank', 'n'];   // ไม่เอาชื่อ / อีเมลคนนำเข้า

/* ── ตั้งเวลา ─────────────────────────────────────────────────────────── */

/** ตั้งเวลาสำรองทุกคืน แล้วสำรองครั้งแรกทันที */
function installBackup() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  stopBackup();
  ScriptApp.newTrigger('backupNightly').timeBased().atHour(BACKUP_HOUR).everyDays(1).create();
  log_('ตั้งเวลาสำรองทุกคืน ' + BACKUP_HOUR + ':00 แล้ว');
  return backupNightly();
}

/** เลิกสำรองอัตโนมัติ (ไฟล์เดิมใน Drive ยังอยู่) */
function stopBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupNightly') ScriptApp.deleteTrigger(t);
  });
}

/* ── สำรอง ───────────────────────────────────────────────────────────── */

/** สำรองของใหม่ตั้งแต่ครั้งก่อน (ครั้งแรก = ทั้งหมด) */
function backupNightly() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  var props = PropertiesService.getScriptProperties();
  var seq = +props.getProperty('fb.seq') || 0, tr = +props.getProperty('fb.tr') || 0, ok = +props.getProperty('fb.ok') || 0;
  return backup_(seq, tr, seq ? 'nightly' : 'full', ok);
}

/** สำรองทุกเอกสารอีกชุด (อ่านเท่าจำนวนเอกสาร) */
function backupFull() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  return backup_(0, 0, 'full', 0);
}

function backup_(since, trSince, from, okSince) {
  var t0 = Date.now(), p = FIREBASE_PROJECT_ID, props = PropertiesService.getScriptProperties();
  var meta = get_(p, 'meta/head');
  if (!meta) { log_('ยังไม่มี meta/head ในโปรเจกต์ ' + p + ' (ยังไม่ได้ลงยอดยกมา) ไม่มีอะไรให้สำรอง'); return { empty: true }; }
  var data = {}, reads = 1;
  data['meta/head'] = meta;

  // เอกสารเดิมที่แก้หลังครั้งก่อน (แก้ได้แค่ช่อง TRcloud กับการตรวจ / อนุมัติ) ดึงตามเวลาที่แก้
  var trMax = trSince, okMax = okSince || 0;
  if (from !== 'full') {
    [['trAt', trSince], ['okAt', okMax]].forEach(function (f) {
      var got = pages_(p, f[0], { timestampValue: iso_(Math.max(0, f[1] - TR_MARGIN)) }, 'GREATER_THAN_OR_EQUAL', t0);
      reads += got.reads;
      got.docs.forEach(function (d) {
        var had = !!data[d.path];
        data[d.path] = d.data;
        if (typeof d.data.trAt === 'number' && d.data.trAt > trMax) trMax = d.data.trAt;
        if (typeof d.data.okAt === 'number' && d.data.okAt > okMax) okMax = d.data.okAt;
        if (had) return;
        // เอกสารใหญ่: ส่วนแยกไม่มีช่องเวลาที่แก้ ดึงตามมาด้วย ไฟล์นี้จะได้มีเอกสารครบทุกส่วน
        for (var i = 2, last = partsOf_(d.data.part); i <= last; i++) {
          var pp = d.path + '~' + i, pd = get_(p, pp);
          reads++;
          if (pd) data[pp] = pd;
        }
      });
    });
  }

  // เอกสารใหม่ตาม seq (ส่วนแยก ~2 ~3 มี seq เดียวกับเอกสารหลัก)
  var got = pages_(p, 'seq', { integerValue: String(since) }, 'GREATER_THAN', t0);
  reads += got.reads;
  var seqMax = since, docs = 0;
  got.docs.forEach(function (d) {
    data[d.path] = d.data;
    if (d.path.indexOf('~') < 0) docs++;
    if (+d.data.seq > seqMax) seqMax = +d.data.seq;
    if (typeof d.data.trAt === 'number' && d.data.trAt > trMax) trMax = d.data.trAt;
    if (typeof d.data.okAt === 'number' && d.data.okAt > okMax) okMax = d.data.okAt;
  });
  // หยุดกลางทาง: seq สุดท้ายอาจยังได้ส่วนแยกไม่ครบ คืนถัดไปอ่าน seq นั้นใหม่
  var nextSeq = got.more ? Math.max(since, seqMax - 1) : seqMax;

  // ของเล็กที่อ่านทุกครั้ง
  var users = list_(p, 'users');
  reads += users.reads;
  users.docs.forEach(function (d) { data[d.path] = d.data; });
  var master = list_(p, 'master', 5);   // conv sup cap
  reads += master.reads;
  master.docs.forEach(function (d) { data[d.path] = d.data; });
  var xfer = get_(p, 'xfer/log');
  reads++;
  if (xfer) data['xfer/log'] = xfer;
  if (from === 'full') {
    var trc = list_(p, 'trc', 5);
    reads += trc.reads;
    trc.docs.forEach(function (d) { data[d.path] = d.data; });
  } else if (meta.trc) {
    var day = String(meta.trc).split('#')[0], td = get_(p, 'trc/' + day);
    reads++;
    if (td) data['trc/' + day] = td;
  }

  var made = Date.now();
  var file = {
    kind: KIND, v: 1, made: made, from: from, project: p, since: since, seq: +meta.seq || 0, upto: nextSeq,
    more: got.more, docs: docs, reads: reads, data: data,
  };
  var name = KIND + '-' + Utilities.formatDate(new Date(made), TZ, 'yyyy-MM-dd-HHmm') + (from === 'full' ? '-full' : '') + '.json';
  folder_(true).createFile(name, JSON.stringify(file), 'application/json');
  props.setProperty('fb.seq', String(nextSeq));
  props.setProperty('fb.tr', String(trMax));
  props.setProperty('fb.ok', String(okMax));
  log_('สำรอง ' + name + ' · เอกสารใหม่ ' + docs + ' ใบ · ทั้งไฟล์ ' + Object.keys(data).length + ' รายการ · อ่าน ' + reads + ' ครั้ง' +
    (got.more ? ' · ยังไม่ครบ (เกินเวลา) คืนถัดไปทำต่อจาก seq ' + nextSeq : ''));
  return { name: name, docs: docs, items: Object.keys(data).length, reads: reads, more: got.more, seq: nextSeq };
}

/** อ่าน docs ตามช่อง field แบบเรียงลำดับ ทีละหน้า → { docs: [{path, data}], reads, more } */
function pages_(p, field, value, op, t0) {
  var out = [], reads = 0, cursor = null;
  for (;;) {
    var q = {
      from: [{ collectionId: 'docs' }],
      where: { fieldFilter: { field: { fieldPath: field }, op: op, value: value } },
      orderBy: [{ field: { fieldPath: field }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: PAGE,
    };
    if (cursor) q.startAt = { values: cursor, before: false };
    var res = rest_(p, 'post', base_(p) + ':runQuery', { structuredQuery: q }) || [];
    var page = res.filter(function (r) { return r.document; }).map(function (r) { return r.document; });
    reads += Math.max(1, page.length);
    page.forEach(function (doc) { out.push({ path: pathOf_(doc.name), data: fields_(doc.fields || {}) }); });
    if (page.length < PAGE) return { docs: out, reads: reads, more: false };
    var last = page[page.length - 1];
    cursor = [last.fields[field], { referenceValue: last.name }];
    if (Date.now() - t0 > STOP_MS) return { docs: out, reads: reads, more: true };
  }
}

/** ทั้งคอลเลกชัน (users, trc) */
function list_(p, coll, size) {
  var out = [], reads = 0, token = '';
  for (;;) {
    var res = rest_(p, 'get', base_(p) + '/' + coll + '?pageSize=' + (size || 300) + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    var page = res.documents || [];
    reads += Math.max(1, page.length);
    page.forEach(function (doc) { out.push({ path: pathOf_(doc.name), data: fields_(doc.fields || {}) }); });
    if (!res.nextPageToken) return { docs: out, reads: reads };
    token = res.nextPageToken;
  }
}

/* ── กู้คืน ───────────────────────────────────────────────────────────── */

/**
 * อ่านทุกไฟล์สำรองในโฟลเดอร์ → เขียนลงโปรเจกต์ target ที่ว่าง (meta/head เขียนสุดท้าย)
 * เกินเวลา: จำว่าเขียนถึงไหน รันอีกครั้งทำต่อ (ไฟล์ในโฟลเดอร์ต้องเป็นชุดเดิม)
 */
function restoreAll(target) {
  target = String(target || RESTORE_PROJECT_ID || '').trim();
  need_(target, 'ใส่ RESTORE_PROJECT_ID (โปรเจกต์ใหม่ที่ว่าง) ก่อน');
  var t0 = Date.now(), props = PropertiesService.getScriptProperties();
  var files = backups_();
  if (!files.length) throw new Error('ไม่พบไฟล์สำรอง (' + KIND + ') ในโฟลเดอร์ ' + BACKUP_FOLDER);
  var data = merge_(files);
  var paths = Object.keys(data).filter(function (x) { return x !== 'meta/head'; }).sort();
  paths.push('meta/head');
  var sig = files.length + ':' + files[files.length - 1].b.made + ':' + paths.length;
  var key = 'fr.' + target, prog = null;
  try { prog = JSON.parse(props.getProperty(key) || 'null'); } catch (e) { prog = null; }
  var done = 0;
  if (prog && prog.sig === sig) done = +prog.done || 0;
  else if (!empty_(target)) throw new Error('โปรเจกต์ ' + target + ' มีข้อมูลแล้ว กู้คืนได้เฉพาะโปรเจกต์ว่าง');

  while (done < paths.length) {
    var writes = [], bytes = 0;
    while (done + writes.length < paths.length && writes.length < WRITE_MAX) {
      var path = paths[done + writes.length];
      var w = { update: { name: docName_(target, path), fields: fieldsOut_(data[path]) } };
      var size = byteLen_(JSON.stringify(w));
      if (writes.length && bytes + size > WRITE_BYTES) break;
      writes.push(w);
      bytes += size;
    }
    rest_(target, 'post', base_(target) + ':commit', { writes: writes });
    done += writes.length;
    props.setProperty(key, JSON.stringify({ sig: sig, done: done }));
    if (done < paths.length && Date.now() - t0 > STOP_MS) {
      log_('กู้คืนยังไม่ครบ ' + done + '/' + paths.length + ' รายการ · เรียกใช้ restoreAll อีกครั้งเพื่อทำต่อ');
      return { more: true, done: done, total: paths.length };
    }
  }
  props.deleteProperty(key);
  var docs = paths.filter(function (x) { return /^docs\/[^~]+$/.test(x); }).length;
  log_('กู้คืนครบ ' + paths.length + ' รายการ (' + docs + ' เอกสาร) จาก ' + files.length + ' ไฟล์ ลงโปรเจกต์ ' + target);
  return { ok: true, done: paths.length, total: paths.length, docs: docs, files: files.length };
}

/**
 * รวมไฟล์ตามลำดับเวลา ไฟล์หลังทับไฟล์ก่อน (แบบ mergeBackups ของหน้าเว็บ)
 * เอกสารหลักกับส่วนแยก (~2 ~3) ไปด้วยกัน: ไฟล์หลังมีเอกสารหลัก ส่วนแยกจากไฟล์ก่อนทิ้ง ไม่ปนกันคนละรุ่น
 */
function merge_(files) {
  var data = {}, partsOf = Object.create(null);
  files.forEach(function (f) {
    Object.keys(f.b.data).forEach(function (path) {
      var m = /^docs\/([^~]+)$/.exec(path);
      if (m && partsOf[m[1]]) { partsOf[m[1]].forEach(function (q) { delete data[q]; }); delete partsOf[m[1]]; }
    });
    Object.keys(f.b.data).forEach(function (path) {
      data[path] = f.b.data[path];
      var m = /^docs\/([^~]+)~\d+$/.exec(path);
      if (m) (partsOf[m[1]] = partsOf[m[1]] || []).push(path);
    });
  });
  return data;
}

/** ไฟล์สำรองที่อ่านได้ในโฟลเดอร์ เรียงตามเวลาที่ทำ (ไฟล์อื่นข้าม) */
function backups_() {
  var folder = folder_(false), out = [];
  if (!folder) return out;
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next(), name = f.getName();
    if (!/\.json$/i.test(name)) continue;
    var b = null;
    try { b = JSON.parse(f.getBlob().getDataAsString()); } catch (e) { b = null; }
    var why = check_(b);
    if (why) { log_('ข้าม ' + name + ': ' + why); continue; }
    out.push({ id: f.getId(), name: name, b: b });
  }
  return out.sort(function (a, b) { return (+a.b.made || 0) - (+b.b.made || 0) || (a.name < b.name ? -1 : 1); });
}

/** เช็คไฟล์สำรองแบบ readBackup ของหน้าเว็บ → '' หรือเหตุผล */
function check_(b) {
  if (!b || b.kind !== KIND || +b.v !== 1 || !b.data || typeof b.data !== 'object') return 'ไม่ใช่ไฟล์สำรองของระบบใหม่';
  var bad = Object.keys(b.data).filter(function (x) { return !PATH_OK.test(x); });
  if (bad.length) return 'มีที่เก็บที่ไม่รู้จัก ' + bad.slice(0, 3).join(', ');
  if (!b.data['meta/head']) return 'ไม่มี meta/head';
  return '';
}

/** โปรเจกต์ว่าง = ไม่มี meta/head และไม่มีเอกสาร */
function empty_(p) {
  if (get_(p, 'meta/head')) return false;
  var res = rest_(p, 'post', base_(p) + ':runQuery', { structuredQuery: { from: [{ collectionId: 'docs' }], limit: 1 } }) || [];
  return !res.some(function (r) { return r.document; });
}

/* ── ลิงก์ไม่ต้องเข้าระบบ (รายงาน FIFO ของ Supply chain) ─────────────── */

/*
 * ชุดแชร์ = เอกสารที่ยังนับ (ตั้งแต่ยอดยกมาล่าสุด) เฉพาะช่องที่ใช้คิด FIFO + ตารางหลัก (แปลงสินค้า · PO. Truck · ความจุต่อพาเลท)
 * ไม่มีชื่อคน อีเมล ออเดอร์ การตรวจ / อนุมัติ · เก็บเป็นไฟล์เดียว (บีบอัด) ในโฟลเดอร์สำรอง
 * แต่ละรอบอ่านเฉพาะเอกสารใหม่ต่อจากรอบก่อน เอกสารเดิมแก้แถวไม่ได้ (ยกเลิก = เอกสารกลับรายการใบใหม่) ชุดแชร์จึงไม่ต้องอ่านซ้ำ
 * หน้า fifo/share.html ขอผ่าน doGet แล้วคิดตัวเลขเองด้วย wms-fire-core.js ตัวเดียวกับหน้าในแอป (wms-fire-share.js)
 */

/** ตั้งเวลาทำชุดแชร์ทุก SHARE_HOURS ชั่วโมง แล้วทำครั้งแรกทันที */
function installShare() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  stopShare();
  ScriptApp.newTrigger('shareRefresh').timeBased().everyHours(SHARE_HOURS).create();
  log_('ตั้งเวลาทำชุดแชร์ทุก ' + SHARE_HOURS + ' ชั่วโมงแล้ว');
  return shareRefresh();
}

/** เลิกทำชุดแชร์อัตโนมัติ (ลิงก์ยังเปิดได้ เห็นชุดล่าสุดที่ทำไว้) */
function stopShare() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'shareRefresh') ScriptApp.deleteTrigger(t);
  });
}

/** ทำชุดแชร์จากของที่เพิ่มตั้งแต่รอบก่อน (ยังไม่มีไฟล์ = อ่านทั้งหมด) · เกินเวลาหยุดเอง รอบหน้าทำต่อ */
function shareRefresh() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  var t0 = Date.now(), p = FIREBASE_PROJECT_ID;
  var meta = get_(p, 'meta/head'), reads = 1;
  if (!meta) { log_('ยังไม่มี meta/head ในโปรเจกต์ ' + p + ' (ยังไม่ได้ลงยอดยกมา) ยังไม่มีอะไรให้แชร์'); return { empty: true }; }
  var seq = +meta.seq || 0, mv = +meta.mv || 0, open = meta.open ? +meta.open.seq || 0 : 0;
  var cur = shareLoad_();
  if (!cur || cur.project !== p) cur = { kind: SHARE_KIND, v: 1, project: p, upto: 0, seq: 0, mv: -1, open: 0, docs: {}, master: {} };
  if (cur.upto >= seq && cur.mv === mv && cur.open === open) {
    log_('ชุดแชร์เป็นปัจจุบันแล้ว (ไม่มีเอกสารใหม่) · อ่าน 1 ครั้ง');
    return { same: true, docs: Object.keys(cur.docs).length, reads: reads };
  }

  /* เอกสารใหม่ตาม seq · เอกสารใหญ่ต่อแถวของส่วนแยก (~2 ~3) ท้ายเอกสารหลัก แบบ docIn ของหน้าเว็บ */
  var got = pages_(p, 'seq', { integerValue: String(cur.upto) }, 'GREATER_THAN', t0);
  reads += got.reads;
  var seqMax = cur.upto, byId = {};
  got.docs.forEach(function (d) {
    var m = /^docs\/([^~]+)(?:~(\d+))?$/.exec(d.path);
    if (!m) return;
    if (+d.data.seq > seqMax) seqMax = +d.data.seq;
    var key = '$' + m[1], e = byId[key] || (byId[key] = { id: m[1], parts: [] });
    if (m[2]) e.parts.push({ i: +m[2], rows: raw_(d.data.rows) });
    else e.main = d.data;
  });
  /* หยุดกลางทาง: ใบสุดท้ายอาจยังได้ส่วนแยกไม่ครบ ไม่ใส่ รอบหน้าอ่านใบนั้นใหม่ */
  var upto = got.more ? Math.max(cur.upto, seqMax - 1) : seqMax, added = 0;
  Object.keys(byId).forEach(function (key) {
    var e = byId[key], d = e.main;
    if (!d || num_(d.seq) > upto) return;
    var rows = raw_(d.rows), last = partsOf_(d.part);
    e.parts.sort(function (a, b) { return a.i - b.i; }).forEach(function (x) {
      if (x.i >= 2 && x.i <= last && x.rows) rows = rows ? rows + '\n' + x.rows : x.rows;
    });
    cur.docs[e.id] = { seq: num_(d.seq), row: num_(d.row), type: str_(d.type), rows: rows, names: raw_(d.names) };
    added++;
  });
  /* ลงยอดยกมาใหม่ = เอกสารก่อนหน้าไม่นับแล้ว (แบบ liveDocs) */
  Object.keys(cur.docs).forEach(function (id) { if (cur.docs[id].seq < open) delete cur.docs[id]; });

  if (cur.mv !== mv) {
    var ms = list_(p, 'master', 5);
    reads += ms.reads;
    cur.master = {};
    ms.docs.forEach(function (d) {
      var name = d.path.split('/')[1];
      if (SHARE_MASTERS.indexOf(name) < 0) return;
      var o = {};
      SHARE_MASTER_KEYS.forEach(function (k) { if (d.data[k] !== undefined && d.data[k] !== null) o[k] = d.data[k]; });
      cur.master[name] = o;
    });
    cur.mv = mv;
  }
  cur.seq = seq;
  cur.open = open;
  cur.upto = upto;
  cur.made = Date.now();
  shareSave_(cur);
  PropertiesService.getScriptProperties().setProperty('fs.made', String(cur.made));
  var docs = Object.keys(cur.docs).length;
  log_('ชุดแชร์ ' + SHARE_FILE + ' · เอกสารใหม่ ' + added + ' ใบ · ทั้งชุด ' + docs + ' ใบ · อ่าน ' + reads + ' ครั้ง' +
    (got.more ? ' · ยังไม่ครบ (เกินเวลา) รอบหน้าทำต่อจาก seq ' + upto : ''));
  return { added: added, docs: docs, reads: reads, more: got.more, seq: upto };
}

/**
 * เว็บแอป (ผู้มีสิทธิ์เข้าถึง: ทุกคน) ตอบหน้า fifo/share.html อย่างเดียว
 *   ?api=shared-at  เวลาของชุดล่าสุด (หน้าแชร์ถามทุกนาที อ่านแค่ Script Properties ไม่เปิดไฟล์)
 *   ?api=tx-fifo    ชุดแชร์ตามที่เก็บในไฟล์ {app: 'fire-share', v, made, gz}
 * ไม่มีคำสั่งเขียน ไม่ส่งไฟล์สำรอง · ใครได้ URL ไปอ่านชุดแชร์ได้ ส่งเฉพาะทีมที่ใช้
 */
function doGet(e) {
  var api = String((e && e.parameter && e.parameter.api) || '');
  var text;
  try { text = shareGet_(api); }
  catch (err) { text = JSON.stringify({ error: String((err && err.message) || err) }); }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function shareGet_(api) {
  var made = +PropertiesService.getScriptProperties().getProperty('fs.made') || 0;
  if (api === 'shared-at') {
    var shared = {};
    if (made) shared['tx-fifo'] = { at: made, auto: 1 };
    return JSON.stringify({ app: 'transaction', fire: 1, shared: shared, run: {} });
  }
  if (api !== 'tx-fifo') return JSON.stringify({ error: 'ไม่รู้จักคำสั่งนี้' });
  var f = made ? shareFile_() : null;
  if (!f) return JSON.stringify({ app: 'fire-share', error: 'ข้อมูลยังไม่พร้อม แจ้งคนที่ส่งลิงก์ให้' });
  return f.getBlob().getDataAsString('UTF-8');
}

/** ชุดแชร์ที่ทำไว้ (แตกไฟล์แล้ว) · ไม่มีหรืออ่านไม่ได้ = null (รอบนี้ทำใหม่ทั้งหมด) */
function shareLoad_() {
  var f = shareFile_();
  if (!f) return null;
  try {
    var w = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
    var gz = Utilities.newBlob(Utilities.base64Decode(w.gz), 'application/x-gzip');
    var cur = JSON.parse(Utilities.ungzip(gz).getDataAsString('UTF-8'));
    return cur && cur.kind === SHARE_KIND && +cur.v === 1 && cur.docs ? cur : null;
  } catch (e) {
    log_('อ่านชุดแชร์เดิมไม่ได้ (' + e.message + ') ทำใหม่ทั้งหมด');
    return null;
  }
}

/** เก็บชุดแชร์เป็นไฟล์ข้อความ JSON ที่ doGet ส่งต่อได้ทันที (gz = ชุดแชร์บีบอัดแล้วเข้ารหัส base64) */
function shareSave_(cur) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(cur), 'application/json'));
  var text = JSON.stringify({ app: 'fire-share', v: 1, made: cur.made, gz: Utilities.base64Encode(gz.getBytes()) });
  var f = shareFile_();
  if (f) { f.setContent(text); return; }
  f = folder_(true).createFile(SHARE_FILE, text, 'text/plain');
  PropertiesService.getScriptProperties().setProperty('fs.file', f.getId());
}

/** ไฟล์ชุดแชร์ในโฟลเดอร์สำรอง (จำรหัสไว้) · ยังไม่มี = null */
function shareFile_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('fs.file'), f;
  if (id) { try { f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var folder = folder_(false);
  if (!folder) return null;
  var it = folder.getFilesByName(SHARE_FILE);
  if (!it.hasNext()) return null;
  f = it.next();
  props.setProperty('fs.file', f.getId());
  return f;
}

/* ── ตรวจแถว (เสกยอด ติดลบ) ────────────────────────────────────────── */

/*
 * Rules อ่านแถวในเอกสารไม่ได้ คนที่เขียนคำสั่งเองจึงเสกยอดได้ สคริปต์นี้จับย้อนหลัง ไม่ได้กัน และไม่แก้เอกสาร
 * ไล่เอกสารตาม seq ตั้งแต่ยอดยกมาล่าสุด ด้วยกติกาแถวเดียวกับ prep… / applyRows / revRow ใน public/wms-fire-core.js
 *   จับ   แถวผิดรูปของประเภท · ยอดติดลบ · หัวใบไม่ตรงแถว · โอน QA แฝง · คู่แปลงผิด · กลับรายการไม่ตรงใบเดิม · meta ไม่ตรง
 *   ไม่จับ รับของหรือคืนปลอมที่รูปแบบถูก (ต้องเทียบของจริงหรือ TRcloud) · ของรอรับที่ถูกใช้ก่อน · ช่วงระหว่างสองรอบ
 * ผลไปที่ audit/last (หัวหน้าอ่านอย่างเดียว ไม่มีอีเมล) หน้า วันนี้ ของหัวหน้าขึ้นการ์ด · doGet ไม่ส่งผลตรวจ
 * การเตือนหายเมื่อยกเลิกใบถูกต้อง ลงยอดยกมาใหม่ หรือเจ้าของสคริปต์เช็คแล้วเรียกใช้ auditSeen
 * ตัวสะสม (ยอดต่อกอง ลายเซ็นของใบ) อยู่ในไฟล์ AUDIT_FILE แต่ละรอบอ่านเฉพาะเอกสารใหม่
 */

/** ตั้งเวลาตรวจแถวทุก AUDIT_HOURS ชั่วโมง แล้วตรวจครั้งแรกทันที */
function installAudit() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  stopAudit();
  ScriptApp.newTrigger('auditRefresh').timeBased().everyHours(AUDIT_HOURS).create();
  log_('ตั้งเวลาตรวจแถวทุก ' + AUDIT_HOURS + ' ชั่วโมงแล้ว');
  return auditRefresh();
}

/** เลิกตรวจอัตโนมัติ (หน้า วันนี้ ของหัวหน้าจะเตือนว่าตัวตรวจหยุด) */
function stopAudit() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'auditRefresh') ScriptApp.deleteTrigger(t);
  });
}

/** ตรวจเอกสารที่เพิ่มตั้งแต่รอบก่อน · เกินเวลาหยุดเอง รอบหน้าทำต่อ */
function auditRefresh() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  var t0 = Date.now(), p = FIREBASE_PROJECT_ID;
  var meta = get_(p, 'meta/head'), reads = 1;
  if (!meta) {
    auditPut_(p, auditNew_(p));   // ให้หน้า วันนี้ รู้ว่าตัวตรวจตั้งแล้ว (ยังไม่สร้างไฟล์ใน Drive)
    log_('ยังไม่มี meta/head ในโปรเจกต์ ' + p + ' (ยังไม่ได้ลงยอดยกมา) ตัวตรวจทำงานแล้ว ยังไม่มีอะไรให้ตรวจ');
    return { empty: true, n: 0, reads: reads };
  }
  var seq = +meta.seq || 0, cur = auditLoad_(), changed = false;
  if (!cur || cur.project !== p || cur.upto > seq) { cur = auditNew_(p); changed = true; }
  else if (cur.tip) {
    /* ใบล่าสุดที่ตรวจแล้วยังเป็นใบเดิม ไม่ใช่ = ฐานถูกล้างแล้วเริ่มใหม่ */
    var tip = get_(p, 'docs/' + cur.tip.id);
    reads++;
    if (!tip || num_(tip.seq) !== cur.tip.seq || num_(tip.at) !== cur.tip.at) { cur = auditNew_(p); changed = true; }
  }

  var checked = 0;
  if (cur.upto < seq) {
    var got = pages_(p, 'seq', { integerValue: String(cur.upto) }, 'GREATER_THAN', t0);
    reads += got.reads;
    var mains = [], parts = {}, top = cur.upto, beyond = false;
    got.docs.forEach(function (x) {
      var d = x.data, s = num_(d.seq);
      if (s > seq) { beyond = true; return; }   // บันทึกหลังอ่าน meta รอบหน้าตรวจ
      if (s > top) top = s;
      if (has_(d, 'of')) {                      // ส่วนแยก ดูจากช่อง of ไม่ดูจากชื่อ
        var k = '$' + str_(d.of);
        (parts[k] = parts[k] || []).push(d);
      } else mains.push({ id: x.path.slice(5), d: d });
    });
    cur.more = got.more && !beyond;
    /* หยุดกลางทาง: seq สุดท้ายอาจยังได้ส่วนแยกไม่ครบ รอบหน้าอ่านใหม่ */
    var upto = cur.more ? Math.max(cur.upto, top - 1) : seq;
    mains.sort(function (a, b) { return num_(a.d.seq) - num_(b.d.seq); }).forEach(function (x) {
      var s = num_(x.d.seq);
      if (s > upto) return;
      try {
        auditDoc_(cur, x.id, x.d, parts['$' + x.id] || []);
      } catch (e) {
        /* ใบเดียวหยุดตัวตรวจไม่ได้: แจ้งใบนั้น แล้วตรวจใบถัดไป */
        cur.bad['$' + s] = { no: str_(x.d.no).slice(0, 20), seq: s, type: str_(x.d.type).slice(0, 20), date: '', name: str_(x.d.name).slice(0, 60),
          why: 'ตรวจใบนี้ไม่ได้ (' + String((e && e.message) || e).slice(0, 100) + ')' };
      }
      cur.tip = { id: x.id, seq: s, at: num_(x.d.at) };
      checked++;
    });
    cur.upto = upto;
    changed = true;
  } else if (cur.more) { cur.more = false; changed = true; }

  var metaWhy = cur.more ? '' : auditMeta_(cur, meta);
  if (metaWhy !== cur.metaWhy) { cur.metaWhy = metaWhy; changed = true; }
  if (changed) auditSave_(cur);
  var n = auditPut_(p, cur);
  log_('ตรวจแถว · เอกสารใหม่ ' + checked + ' ใบ · ผิดกติกา ' + n + ' · อ่าน ' + reads + ' ครั้ง' +
    (cur.more ? ' · ยังไม่ครบ (เกินเวลา) รอบหน้าทำต่อจาก seq ' + cur.upto : ''));
  return { n: n, reads: reads, more: cur.more, seq: cur.upto };
}

/** เจ้าของสคริปต์เช็คของจริงและจัดการแล้ว (ใช้เมื่อยกเลิกใบไม่ได้ ต้องปรับยอดแทน) ล้างการเตือนที่มีตอนนี้ ใบที่ผิดหลังจากนี้ยังเตือน */
function auditSeen() {
  need_(FIREBASE_PROJECT_ID, 'ใส่ FIREBASE_PROJECT_ID ก่อน');
  var cur = auditLoad_();
  if (!cur || cur.project !== FIREBASE_PROJECT_ID) { log_('ยังไม่มีผลตรวจให้รับทราบ'); return { seen: 0 }; }
  var nos = Object.keys(cur.bad).map(function (k) { return cur.bad[k].no; });
  cur.bad = {};
  auditSave_(cur);
  auditPut_(FIREBASE_PROJECT_ID, cur);
  log_('รับทราบแล้ว ' + nos.length + ' ใบ ' + nos.join(', '));
  return { seen: nos.length };
}

function auditNew_(p) {
  return { kind: AUDIT_KIND, v: 1, project: p, upto: 0, tip: null, more: false, open: null, rows: 0, piles: {}, docs: {}, bad: {}, metaWhy: '' };
}

/** แถวหนึ่งผิดรูปของประเภทตรงไหน '' = ถูก (ใบกลับรายการเทียบลายเซ็นกับใบเดิมแทน) */
function auditRow_(type, r) {
  if (!text_(r[0])) return 'ไม่มี SKU';
  if (!text_(r[2]) || !text_(r[3])) return 'ไม่มี LOT หรือ PO';
  if (r[9] && r[9] !== 'เปิด') return 'Status ต้องเป็น เปิด หรือว่าง';
  if (type === 'กลับรายการ') return '';
  if (!(r[6] > 0)) return 'ชิ้นต้องมากกว่า 0';
  var f = text_(r[4]), t = text_(r[5]), k = r[7];
  if (f !== r[4] || t !== r[5]) return 'ชื่อโลมีช่องว่างหัวท้าย';
  var isIn = k === 'รับ' && !!t && !f, isOut = k === 'เบิก' && !!f && !t, isSale = k === 'ขาย' && !!f && !t;
  var isMove = k === 'เบิก' && !!f && !!t && up_(f) !== up_(t);
  if (type === 'ตัดขาย') return isSale ? '' : 'แถวของใบตัดขายต้องเป็น ขาย ออกจากโลเดียว';
  if (type === 'ย้าย') return isMove ? '' : 'แถวของใบย้ายต้องเป็น เบิก จากโลหนึ่งไปอีกโล';
  if (type === 'คืน' || type === 'รับของ' || type === 'ยอดยกมา') return isIn ? '' : 'แถวของใบ' + type + 'ต้องเป็น รับ เข้าโลอย่างเดียว';
  if (type === 'แปลง' || type === 'ปรับยอด') return isIn || isOut ? '' : 'แถวของใบ' + type + 'ต้องเป็น เบิก หรือ รับ ขาเดียว';
  if (type === 'ตารางเดิม') return isIn || isOut || isSale || isMove ? '' : 'แถวของตารางเดิมผิดรูป';
  return 'ไม่รู้จักประเภท ' + type;
}

/** เอกสารหนึ่งใบ: ตรวจ แล้วเข้ายอดสะสมแบบ applyDoc ของหน้าเว็บ */
function auditDoc_(cur, id, d, parts) {
  var type = str_(d.type), no = cell_(str_(d.no)), seq = num_(d.seq), why = [];
  var opening = type === 'ยอดยกมา', rev = type === 'กลับรายการ';
  if (opening) {
    cur.piles = {}; cur.docs = {}; cur.bad = {}; cur.rows = 0;
    cur.open = { id: id, no: no, seq: seq };
  }
  cur.rows += typeof d.n === 'number' && isFinite(d.n) ? d.n : 0;

  if (id.indexOf('~') >= 0 || id in BARE) why.push('รหัสชุดผิดรูป');
  if (AUDIT_TEXT.some(function (k) { return typeof d[k] !== 'string'; }) || AUDIT_NUM.some(function (k) { return typeof d[k] !== 'number'; }) ||
    (has_(d, 'xf') && typeof d.xf !== 'string')) why.push('ช่องหัวใบผิดชนิด');
  parts = parts.slice().sort(function (a, b) { return num_(a.i) - num_(b.i); });
  if (num_(d.part) !== parts.length + 1 || num_(d.part) > PARTS_MAX || parts.some(function (x, i) { return x.i !== i + 2; })) why.push('ส่วนแยกไม่ครบหรือเกินจากหัวใบ');
  var last = partsOf_(d.part);   // เข้ายอดเฉพาะส่วนที่หน้าเว็บอ่าน
  parts = parts.filter(function (x) { return typeof x.i === 'number' && x.i % 1 === 0 && x.i >= 2 && x.i <= last; });
  var all = typeof d.rows === 'string' ? d.rows : '', notText = typeof d.rows !== 'string';
  parts.forEach(function (x) {
    if (typeof x.rows !== 'string') notText = true;
    else if (x.rows) all = all ? all + '\n' + x.rows : x.rows;
  });
  if (notText) why.push('แถวไม่ใช่ข้อความ');
  var lines = all ? all.split('\n', AUDIT_ROWS + 1) : [];
  if (lines.length > AUDIT_ROWS) { why.push('แถวเกิน ' + AUDIT_ROWS + ' ที่ระบบรับ'); lines.length = AUDIT_ROWS; }
  var rowBad = [], rows = lines.map(function (line, i) {
    var r = line.split('\t', 11), raw = String(r[6] === undefined ? '' : r[6]).trim(), q = Number(raw);
    var long = r.some(function (c) { return c.length > CELL_MAX; });
    r = r.map(cell_);   // อ่านแบบหน้าเว็บ ใบกลับรายการจึงเทียบกันได้
    while (r.length < 11) r.push('');
    r[6] = isFinite(q) ? q : 0;
    var w = long ? 'ช่องยาวเกิน ' + CELL_MAX + ' ตัวอักษร' : !raw || !isFinite(q) ? 'ชิ้นไม่ใช่ตัวเลข' : auditRow_(type, r);
    if (w) rowBad.push('แถว ' + (i + 1) + ' ' + w);
    return r;
  });
  if (rowBad.length) why.push(rowBad[0] + (rowBad.length > 1 ? ' (รวม ' + rowBad.length + ' แถว)' : ''));
  if (!rows.length || d.n !== rows.length) why.push('จำนวนแถวไม่ตรงหัวใบ (หัวใบ ' + str_(d.n) + ' · จริง ' + rows.length + ')');
  var sum = rows.reduce(function (a, r) { return a + Math.abs(r[6]); }, 0);
  if (type === 'แปลง') {
    sum /= 2;
    if (!pairsOk_(rows)) why.push('คู่แปลงไม่ถูก (เบิก SKU เดิม แล้วรับ SKU ใหม่ LOT PO ชิ้นเท่ากัน)');
  }
  if (typeof d.qty !== 'number' || Math.abs(sum - d.qty) > 0.01) why.push('ยอดรวมไม่ตรงแถว (หัวใบ ' + str_(d.qty) + ' · จริง ' + round3_(sum) + ')');
  if (!realDay_(str_(d.date))) why.push('วันที่ไม่มีจริง');

  var xf = str_(d.xf);
  if (type === 'ย้าย') {
    var kinds = [];
    rows.forEach(function (r) { var k = xferRow_(r); if (kinds.indexOf(k) < 0) kinds.push(k); });
    if (kinds.length > 1 || (kinds[0] || '') !== xf) why.push('โอน QA แฝง หรือชนิดใบโอนไม่ตรงแถว');
  } else if (xf) why.push('ช่องโอน QA อยู่ในใบที่ไม่ใช่ใบย้าย');
  if (type === 'ตารางเดิม' && gridXfer_(rows)) why.push('โอน QA ผ่านตารางเดิม');

  if (rev) {
    var ok = '$' + cell_(str_(d.link)), was = has_(cur.docs, ok) ? cur.docs[ok] : null;
    if (!was) why.push('กลับรายการของใบที่ไม่มี หรืออยู่ก่อนยอดยกมา');
    else if (was.x) why.push('กลับรายการซ้ำ');
    else if (sig_(rows) !== was.h) why.push('แถวกลับรายการไม่ตรงใบเดิม');
    else { was.x = 1; delete cur.bad['$' + was.s]; }   // ยกเลิกถูกต้อง การเตือนของใบเดิมหาย
  } else if (!opening) {
    if (has_(cur.docs, '$' + no)) why.push('เลขที่ซ้ำ');
    cur.docs['$' + no] = { s: seq, h: sig_(rows.slice().reverse().map(revRow_)) };
  }

  var short = auditApply_(cur.piles, rows);
  if (short) why.push(short);
  if (why.length) {
    cur.bad['$' + seq] = { no: no.slice(0, 20), seq: seq, type: type.slice(0, 20), date: str_(d.date).slice(0, 10), name: str_(d.name).slice(0, 60),
      why: why.join(' · ').slice(0, 300) };
  }
}

/** แถวเข้ายอดต่อกอง แบบ applyRows · คืนกองแรกที่ไม่พอ '' = พอ */
function auditApply_(piles, rows) {
  var short = '', touched = {};
  function key(loc, r) { return [loc, r[1] || r[0], r[2], r[3]].map(up_).join('|'); }
  rows.forEach(function (r) {
    if (!r[0] && !r[1]) return;
    var q = r[6], k;
    if (r[5]) {
      k = key(r[5], r);
      piles[k] = round3_((piles[k] || 0) + q);
      touched[k] = 1;
    }
    if (r[4] && (r[7] === 'เบิก' || r[7] === 'ขาย')) {
      k = key(r[4], r);
      var have = piles[k] || 0;
      if (!short && have + 1e-6 < q) short = 'ยอดติดลบ ที่ ' + r[4] + ' (LOT ' + r[2] + ' ' + r[3] + ') มี ' + have + ' ออก ' + q;
      piles[k] = round3_(have - q);
      touched[k] = 1;
    }
  });
  Object.keys(touched).forEach(function (k) { if (Math.abs(piles[k]) <= 1e-9) delete piles[k]; });
  return short;
}

/** meta ตรงกับเอกสารไหม (ตัวชี้ยอดยกมา แถวรวม) */
function auditMeta_(cur, meta) {
  var a = meta.open || null, b = cur.open, why = [];
  if (a || b) {
    if (!a || !b || a.id !== b.id || a.no !== b.no || +a.seq !== b.seq) why.push('ตัวชี้ยอดยกมาไม่ตรงใบยอดยกมาล่าสุด');
  }
  if ((+meta.rows || 0) !== cur.rows) why.push('แถวรวมไม่ตรงเอกสาร');
  return why.length ? 'หัวสมุด (meta) ' + why.join(' · ') : '';
}

/** เขียน audit/last → จำนวนที่ผิด */
function auditPut_(p, cur) {
  var list = Object.keys(cur.bad).map(function (k) { return cur.bad[k]; }).sort(function (a, b) { return b.seq - a.seq; });
  if (cur.metaWhy) list.unshift({ no: '', seq: 0, type: '', date: '', name: '', why: cur.metaWhy });
  var out = { v: 1, at: Date.now(), seq: cur.upto, n: list.length, more: !!cur.more, list: list.slice(0, AUDIT_LIST) };
  rest_(p, 'post', base_(p) + ':commit', { writes: [{ update: { name: docName_(p, 'audit/last'), fields: fieldsOut_(out) } }] });
  return list.length;
}

/** ตัวสะสมของรอบก่อน · ไม่มีหรืออ่านไม่ได้ = null (ตรวจใหม่ทั้งหมด) */
function auditLoad_() {
  var f = auditFile_();
  if (!f) return null;
  try {
    var gz = Utilities.newBlob(Utilities.base64Decode(f.getBlob().getDataAsString('UTF-8')), 'application/x-gzip');
    var cur = JSON.parse(Utilities.ungzip(gz).getDataAsString('UTF-8'));
    return cur && cur.kind === AUDIT_KIND && +cur.v === 1 && cur.docs && cur.piles && cur.bad ? cur : null;
  } catch (e) {
    log_('อ่านตัวสะสมของการตรวจแถวไม่ได้ (' + e.message + ') ตรวจใหม่ทั้งหมด');
    return null;
  }
}

function auditSave_(cur) {
  var gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(cur), 'application/json'));
  var text = Utilities.base64Encode(gz.getBytes()), f = auditFile_();
  if (f) { f.setContent(text); return; }
  f = folder_(true).createFile(AUDIT_FILE, text, 'text/plain');
  PropertiesService.getScriptProperties().setProperty('fa.file', f.getId());
}

function auditFile_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('fa.file'), f;
  if (id) { try { f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var folder = folder_(false);
  if (!folder) return null;
  var it = folder.getFilesByName(AUDIT_FILE);
  if (!it.hasNext()) return null;
  f = it.next();
  props.setProperty('fa.file', f.getId());
  return f;
}

/** แถวกลับของแถวหนึ่ง แบบ revRow (8 ช่องแรก ที่มีผลกับยอด) */
function revRow_(r) {
  if (r[7] === 'ขาย') return [r[0], r[1], r[2], r[3], r[4], '', -r[6], 'ขาย'];
  if (r[7] === 'เบิก' && r[5]) return [r[0], r[1], r[2], r[3], r[5], r[4], r[6], 'เบิก'];
  if (r[7] === 'เบิก') return [r[0], r[1], r[2], r[3], '', r[4], r[6], 'รับ'];
  return [r[0], r[1], r[2], r[3], r[5], '', r[6], 'เบิก'];
}

/** ลายเซ็นของแถวชุดหนึ่ง (เฉพาะช่องที่มีผลกับยอด) */
function sig_(rows) {
  var s = JSON.stringify(rows.map(function (r) { return r.slice(0, 8); }));
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

function pairsOk_(rows) {
  if (rows.length % 2) return false;
  for (var i = 0; i < rows.length; i += 2) {
    var a = rows[i], b = rows[i + 1];
    if (a[7] !== 'เบิก' || b[7] !== 'รับ' || (a[1] || a[0]) === (b[1] || b[0]) || a[2] !== b[2] || a[3] !== b[3] || Math.abs(a[6] - b[6]) > 1e-9) return false;
  }
  return true;
}

function atQa_(loc) { return /^I?QA(?![A-Z])/.test(up_(loc)); }

/** แบบของแถวย้าย แบบ xferRow: '' | in | out | qa */
function xferRow_(r) {
  if (!r[4] || !r[5] || r[7] !== 'เบิก') return '';
  var a = atQa_(r[4]), b = atQa_(r[5]);
  return a ? (b ? 'qa' : 'out') : b ? 'in' : '';
}

/** ตารางเดิมเป็นการโอน QA ไหม แบบ gridXfer: ย้ายข้ามคลังตรง หรือเบิกกับรับคนละคลังของ SKU เดียวในชุดเดียว */
function gridXfer_(rows) {
  if (rows.some(function (r) { return !!xferRow_(r); })) return true;
  var by = {}, sign = {};
  rows.forEach(function (r) {
    var sku = up_(r[1] || r[0]);
    if (!sku || r[7] === 'ขาย') return;
    var out = r[7] === 'เบิก' && !!r[4];
    if (out && r[5]) return;                    // ย้ายในคลังเดียวกัน ยอดคลังไม่เปลี่ยน
    if (!out && !r[5]) return;
    var k = (atQa_(out ? r[4] : r[5]) ? 'Q|' : 'M|') + sku;
    by[k] = round3_((by[k] || 0) + (out ? -r[6] : r[6]));
  });
  return Object.keys(by).some(function (k) {
    if (Math.abs(by[k]) <= 1e-9) return false;
    var s = '$' + k.slice(2), bit = by[k] > 0 ? 1 : 2;
    sign[s] = (sign[s] || 0) | bit;
    return sign[s] === 3;
  });
}

function realDay_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function has_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function text_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function up_(v) { return text_(v).toUpperCase(); }
function round3_(n) { return Math.round(n * 1000) / 1000; }

/* ค่าในเอกสารเชื่อไม่ได้ (map หรือ list แปลงเป็นข้อความแล้ว throw) ใบเดียวต้องหยุดสคริปต์ไม่ได้ */
function raw_(v) { return typeof v === 'string' ? v : ''; }
function str_(v) { return typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : ''; }
function num_(v) { var n = typeof v === 'number' || typeof v === 'string' ? +v : 0; return isFinite(n) ? n : 0; }
function partsOf_(v) { return Math.min(PARTS_MAX, Math.max(1, Math.floor(num_(v)))); }
/** หนึ่งช่องแบบที่หน้าเว็บอ่าน (str ใน wms-fire-core.js) */
function cell_(s) {
  var c = s.slice(0, CELL_MAX);
  return c && c.trim() in BARE ? c.toUpperCase() : c;
}

/* ── Firestore REST ──────────────────────────────────────────────────── */

function base_(p) {
  return 'https://firestore.googleapis.com/v1/projects/' + p + '/databases/(default)/documents';
}

function docName_(p, path) {
  return 'projects/' + p + '/databases/(default)/documents/' + path;
}

/** projects/…/documents/docs/ABC → docs/ABC */
function pathOf_(name) {
  var i = name.indexOf('/documents/');
  return name.slice(i + 11);
}

function get_(p, path) {
  var doc = rest_(p, 'get', base_(p) + '/' + path.split('/').map(encodeURIComponent).join('/'));
  return doc ? fields_(doc.fields || {}) : null;
}

/** เรียก Firestore ด้วยสิทธิ์ของบัญชีที่รันสคริปต์ · 404 → null */
function rest_(p, method, url, body) {
  var opt = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': p },
  };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(url, opt), code = res.getResponseCode(), text = res.getContentText();
  if (code === 404) return null;
  if (code < 200 || code >= 300) throw new Error('Firestore ' + code + ': ' + String(text).slice(0, 300));
  return text ? JSON.parse(text) : {};
}

/** ค่าจาก Firestore → ค่าธรรมดา (เวลา → มิลลิวินาที) */
function val_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(String(v.timestampValue).replace(/(\.\d{3})\d+/, '$1'));
  if ('mapValue' in v) return fields_(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val_);
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}

function fields_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { o[k] = val_(f[k]); });
  return o;
}

/** ค่าธรรมดา → ค่าของ Firestore (ช่องเวลาระดับบนที่เป็นตัวเลข → timestampValue) */
function enc_(v, key) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (key && TIME_KEYS.indexOf(key) >= 0) return { timestampValue: iso_(v) };
    return Math.floor(v) === v && Math.abs(v) < 9007199254740992 ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Object.prototype.toString.call(v) === '[object Array]') return { arrayValue: { values: v.map(function (x) { return enc_(x); }) } };
  var f = {};
  Object.keys(v).forEach(function (k) { f[k] = enc_(v[k]); });
  return { mapValue: { fields: f } };
}

function fieldsOut_(o) {
  var f = {};
  Object.keys(o).forEach(function (k) { f[k] = enc_(o[k], k); });
  return f;
}

/* ── อื่น ๆ ──────────────────────────────────────────────────────────── */

/** โฟลเดอร์สำรอง (จำรหัสไว้ ชื่อซ้ำก็ไม่หลง) · make = สร้างถ้ายังไม่มี */
function folder_(make) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('fb.folder');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = it.hasNext() ? it.next() : make ? DriveApp.createFolder(BACKUP_FOLDER) : null;
  if (folder) props.setProperty('fb.folder', folder.getId());
  return folder;
}

function iso_(ms) {
  return new Date(ms).toISOString();
}

function byteLen_(s) {
  return unescape(encodeURIComponent(s)).length;
}

function need_(v, msg) {
  if (!v) throw new Error(msg);
}

function log_(s) {
  Logger.log(s);
}
