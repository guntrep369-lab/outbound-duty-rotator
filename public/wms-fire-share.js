/**
 * @file wms-fire-share.js — ลิงก์ไม่ต้องเข้าระบบ (fifo/share.html) อ่านชุดแชร์ของระบบใหม่
 *
 * apps-script/fire-backup.gs ทำชุดแชร์ทุก 2 ชั่วโมง (shareRefresh) แล้วตอบผ่านเว็บแอป (doGet)
 *   ?api=tx-fifo   → { app: 'fire-share', v: 1, made, gz }   gz = ชุดแชร์ JSON บีบอัด gzip เข้ารหัส base64
 *   ?api=shared-at → { app: 'transaction', fire: 1, shared: { 'tx-fifo': { at: made, auto: 1 } } }
 * ชุดแชร์ = { kind: 'wms-fire-share', v: 1, seq, open, docs: { รหัสชุด: {seq, row, type, rows, names} }, master: {conv, sup, cap} }
 * ไฟล์นี้แตกชุดแชร์ → สำเนาแบบในเครื่อง → WmsFireCore.fifo ตัวเดียวกับหน้า FIFO ในแอป ตัวเลขจึงตรงกัน
 *
 * โหลดเป็น classic script หลัง wms-fire-core.js เปิดเป็น window.WmsFireShare
 */
(function () {
  'use strict';

  var KIND = 'wms-fire-share';
  var BAD = 'ลิงก์นี้ใช้ไม่ได้ ขอลิงก์ใหม่จากคนที่ส่งให้';
  var OLD_BROWSER = 'เบราว์เซอร์นี้เปิดรายงานไม่ได้ ลองเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่';

  function bytes(b64) {
    var s = atob(String(b64 || '')), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /** base64 ของ gzip → ข้อความ */
  async function unzip(b64) {
    var stream = new Blob([bytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  /** ชุดแชร์ → สำเนาแบบในเครื่อง { meta, docs (รูป docIn เรียงตาม seq), master } */
  function local(snap) {
    var C = window.WmsFireCore, all = (snap && snap.docs) || {};
    var docs = Object.keys(all).map(function (id) { return C.docIn(id, all[id], []); })
      .sort(function (a, b) { return a.seq - b.seq; });
    var open = +(snap && snap.open) || 0;
    return { meta: { seq: +(snap && snap.seq) || 0, open: open ? { seq: open } : null }, docs: docs, master: (snap && snap.master) || {} };
  }

  /**
   * คำตอบของเว็บแอป → คำตอบรูป tx-fifo (มีป้าย shared ให้ WmsShared รู้เวลาของชุด)
   * ใช้ไม่ได้ → { error }
   */
  async function fifo(res) {
    if (!res || res.app !== 'fire-share') return { error: BAD };
    if (res.error) return { error: res.error };
    if (+res.v !== 1 || !res.gz) return { error: BAD };
    if (typeof DecompressionStream === 'undefined') return { error: OLD_BROWSER };
    var snap;
    try { snap = JSON.parse(await unzip(res.gz)); }
    catch (e) { return { error: BAD }; }
    if (!snap || snap.kind !== KIND || +snap.v !== 1 || !snap.docs) return { error: BAD };
    var made = +res.made || +snap.made || Date.now();
    var out = window.WmsFireCore.fifo(local(snap), made);
    out.shared = { at: made, auto: 1 };
    return out;
  }

  /** คำตอบนี้มาจากเว็บแอปของ fire-backup.gs ไหม */
  function owns(res) { return !!(res && res.app === 'fire-share'); }

  window.WmsFireShare = { KIND: KIND, unzip: unzip, local: local, fifo: fifo, owns: owns };
})();
