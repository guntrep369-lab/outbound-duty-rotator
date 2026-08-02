/**
 * @file transport-file.js — the one uploaded Excel, shared by all three
 * รถบริษัท tools (Picklist Label · ใบนำส่งสินค้า · แจ้งงานคนรถ).
 *
 * All three read the same file the same way — first sheet, header:1, drop the
 * header row — so making each one ask for it separately was three uploads of
 * the same thing. Whichever tool you upload on now stores the parsed rows, and
 * the other two pick them up when you switch to them.
 *
 * WHY sessionStorage: the file is a day's work. sessionStorage dies with the
 * browser, so tomorrow morning cannot silently open on yesterday's deliveries —
 * the failure mode that matters here is working from a stale file without
 * noticing, not having to upload again.
 *
 * Loaded as a classic script (the tool pages are not modules), exposing
 * window.TransportFile.
 */
(function () {
  'use strict';

  var KEY = 'wms:transport:file';

  /**
   * ตำแหน่งคอลัมน์ของไฟล์ออเดอร์ — ชุดเดียวที่ทั้งสามเครื่องมือใช้
   *
   * เดิมแต่ละหน้าประกาศเอง (picklist 2 ชุด, delivery 1, notify 1) ทั้งที่บรรยาย
   * ไฟล์เดียวกัน ถ้าชีตแทรกคอลัมน์กลางตาราง ทั้งสามไฟล์จะอ่านเพี้ยนแยกกันโดย
   * ไม่มี error — แค่พิมพ์ที่อยู่ผิดคนออกมา
   */
  var COLS = {
    truck: 0, date: 1, sup: 2, order: 3, brand: 4, size: 5, qty: 6,
    gift: 7, giftQty: 8, customer: 9, phone1: 10, phone2: 11,
    address: 12, time: 13, payment: 14, remark: 15, platform: 16, cardMachine: 17,
  };

  /**
   * คำที่ควรเจอในหัวคอลัมน์ ใช้ตรวจว่าไฟล์ยังเรียงเหมือนเดิม
   * เลือกเฉพาะคอลัมน์ที่ผิดแล้วเสียหายจริง และใช้คำสั้น ๆ ที่ไม่น่าเปลี่ยน
   * เพื่อไม่ให้เตือนพร่ำเพรื่อเวลาหัวตารางถูกแก้เล็กน้อย
   */
  var HEADER_HINTS = [
    { col: 'truck',    any: ['รถ', 'truck'] },
    { col: 'order',    any: ['order', 'ออเดอร์'] },
    { col: 'brand',    any: ['แบรนด์', 'brand'] },
    { col: 'customer', any: ['ลูกค้า', 'customer', 'ผู้รับ'] },
    { col: 'address',  any: ['ที่อยู่', 'address'] },
  ];

  var norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/\s|_/g, ''); };

  /**
   * ไฟล์ยังเรียงคอลัมน์เหมือนที่ COLS คาดไว้หรือเปล่า
   * @param {Array} header แถวหัวตาราง (แถวแรกของไฟล์)
   * @returns {{ok:boolean, problems:Array<{col:string, expected:string, found:string}>}}
   */
  function checkHeader(header) {
    var problems = [];
    if (!Array.isArray(header) || !header.length) return { ok: true, problems: problems }; // ไม่มีหัว = ตรวจไม่ได้
    HEADER_HINTS.forEach(function (h) {
      var cell = norm(header[COLS[h.col]]);
      if (!cell) return;                       // ช่องว่าง ปล่อยผ่าน ไม่เดา
      var ok = h.any.some(function (w) { return cell.indexOf(norm(w)) !== -1; });
      if (!ok) {
        problems.push({
          col: h.col,
          expected: h.any[0],
          found: String(header[COLS[h.col]]).trim(),
        });
      }
    });
    return { ok: problems.length === 0, problems: problems };
  }

  function read() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && Array.isArray(o.rows) && o.rows.length ? o : null;
    } catch (e) {
      return null;
    }
  }

  window.TransportFile = {
    /** ตำแหน่งคอลัมน์ชุดเดียวของทั้งโมดูล */
    COLS: COLS,
    checkHeader: checkHeader,

    /** Rows + file name of the loaded file, or null. */
    get: read,

    /**
     * Remember the file every tool will use.
     * @param {string} fileName
     * @param {Array<Array>} rows data rows, header already removed
     */
    save: function (fileName, rows, header) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify({
          fileName: fileName || '', rows: rows, header: header || null, at: Date.now(),
        }));
      } catch (e) {
        // Quota or private mode: the tool you are on still works, the others
        // will just ask for the file again. Not worth interrupting anyone over.
        console.warn('TransportFile: ไม่สามารถแชร์ไฟล์ข้ามหน้าได้ —', e.message);
      }
    },

    clear: function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
    },

    /**
     * Bar shown above a tool once a file is loaded: which file, and the way to
     * swap it. Without this the pages would silently share a file nobody can
     * see the name of.
     * @param {HTMLElement} host  where to render
     * @param {Function} onChange called when the user asks for a different file
     */
    renderBar: function (host, onChange) {
      var f = read();
      if (!host || !f) return;
      host.className = 'tf-bar';
      host.innerHTML =
        '<span class="tf-ic">📄</span>' +
        '<span class="tf-name"></span>' +
        '<span class="tf-rows"></span>' +
        '<button type="button" class="tf-change">เปลี่ยนไฟล์</button>';
      host.querySelector('.tf-name').textContent = f.fileName || 'ไฟล์ที่อัปโหลด';
      host.querySelector('.tf-rows').textContent = f.rows.length + ' แถว';
      host.querySelector('.tf-change').addEventListener('click', function () {
        window.TransportFile.clear();
        if (onChange) onChange();
        else location.reload();
      });
      host.style.display = 'flex';

      // ชีตเรียงคอลัมน์เปลี่ยนไปแล้วหรือเปล่า — ผิดตรงนี้ไม่มี error
      // แต่จะพิมพ์ที่อยู่ผิดคนออกมา จึงต้องบอกให้เห็น
      var chk = checkHeader(f.header);
      if (!chk.ok) {
        var warn = document.createElement('div');
        warn.className = 'tf-warn';
        // textContent ไม่ใช่ innerHTML — ข้อความนี้ประกอบจากหัวตารางในไฟล์ที่ผู้ใช้อัปมา
        var b = document.createElement('b');
        b.textContent = '⚠️ คอลัมน์ในไฟล์อาจไม่ตรงกับที่ระบบคาดไว้';
        warn.appendChild(b);
        warn.appendChild(document.createTextNode(
          ' — ' + chk.problems.map(function (x) {
            return 'ช่องที่ควรเป็น "' + x.expected + '" อ่านได้ "' + (x.found || '(ว่าง)') + '"';
          }).join(' · ') + ' · ตรวจไฟล์ก่อนพิมพ์'
        ));
        host.parentNode.insertBefore(warn, host.nextSibling);
      }
    },
  };
})();
