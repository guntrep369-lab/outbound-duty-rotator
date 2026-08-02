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
    /** Rows + file name of the loaded file, or null. */
    get: read,

    /**
     * Remember the file every tool will use.
     * @param {string} fileName
     * @param {Array<Array>} rows data rows, header already removed
     */
    save: function (fileName, rows) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ fileName: fileName || '', rows: rows, at: Date.now() }));
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
    },
  };
})();
