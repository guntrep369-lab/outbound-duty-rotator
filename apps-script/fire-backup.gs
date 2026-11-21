/**
 * fire-backup.gs — สำรองระบบใหม่ (Firebase) ลง Google Drive ทุกคืน กู้คืนลงโปรเจกต์ใหม่ที่ว่าง
 *                  และทำชุดแชร์ให้ลิงก์ Supply chain (รายงาน FIFO ไม่ต้องเข้าระบบ) ทุก 2 ชั่วโมง
 *
 * Firebase แผนฟรี (Spark) ไม่มีระบบสำรองให้ สคริปต์นี้อ่านข้อมูลผ่าน Firestore REST ด้วยสิทธิ์ของบัญชีที่รัน
 * (ต้องเป็น Owner หรือ Editor ของโปรเจกต์ Firebase) ไม่ผ่าน Rules ของหน้าเว็บ
 * ไม่ใช้ Google Sheet ไม่เปิดไฟล์ชีตใดเลย
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
 *  เว็บแอปตอบแค่ชุดแชร์ (doGet) ไม่มีคำสั่งเขียน ไม่ส่งไฟล์สำรอง ชุดแชร์ไม่มีชื่อคน อีเมล ออเดอร์
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
        for (var i = 2; i <= (+d.data.part || 1); i++) {
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
  var data = {}, partsOf = {};
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
    var e = byId[m[1]] || (byId[m[1]] = { parts: [] });
    if (m[2]) e.parts.push({ i: +m[2], rows: d.data.rows || '' });
    else e.main = d.data;
  });
  /* หยุดกลางทาง: ใบสุดท้ายอาจยังได้ส่วนแยกไม่ครบ ไม่ใส่ รอบหน้าอ่านใบนั้นใหม่ */
  var upto = got.more ? Math.max(cur.upto, seqMax - 1) : seqMax, added = 0;
  Object.keys(byId).forEach(function (id) {
    var d = byId[id].main;
    if (!d || +d.seq > upto) return;
    var rows = d.rows || '';
    byId[id].parts.sort(function (a, b) { return a.i - b.i; }).forEach(function (x) {
      if (x.rows) rows = rows ? rows + '\n' + x.rows : x.rows;
    });
    cur.docs[id] = { seq: +d.seq || 0, row: +d.row || 0, type: d.type || '', rows: rows, names: d.names || '' };
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
