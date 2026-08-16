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
     * @param {Array} [header] แถวหัวตาราง ใช้ตรวจว่าคอลัมน์ยังเรียงเหมือนเดิม
     * @param {object} [origin] มาจากไหน — {from:'central', at, by, id} ถ้าดึงจากส่วนกลาง
     */
    save: function (fileName, rows, header, origin) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify({
          fileName: fileName || '', rows: rows, header: header || null, at: Date.now(),
          origin: origin || { from: 'upload' },
        }));
        // แถบส่วนกลางบอกว่าไฟล์นี้เครื่องอื่นเห็นแล้วหรือยัง จึงต้องอัปเดตทันทีที่
        // ไฟล์เปลี่ยน ไม่ใช่รอโหลดหน้าใหม่ — คนเพิ่งอัปเสร็จคือคนที่ควรเห็นปุ่มบันทึก
        if (window.TransportFile.renderCentral) window.TransportFile.renderCentral();
      } catch (e) {
        // Quota or private mode: the tool you are on still works, the others
        // will just ask for the file again. Not worth interrupting anyone over.
        console.warn('TransportFile: ไม่สามารถแชร์ไฟล์ข้ามหน้าได้ —', e.message);
      }
    },

    clear: function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      if (window.TransportFile.renderCentral) window.TransportFile.renderCentral();
    },

    // ══════════════════════════════════════════════════════════════════
    // ไฟล์ส่วนกลาง — ให้คนละเครื่องใช้ไฟล์เดียวกัน
    //
    // sessionStorage ข้างบนแชร์ไฟล์ได้แค่ "ข้ามหน้าในเบราว์เซอร์เดียวกัน" ทีมขนส่ง
    // อัปที่เครื่องเขา เด็กคลังเปิดคนละเครื่องจึงไม่เห็นอะไรเลย ทั้งที่ต้องใช้เวลา
    // จัดส่งเพื่อเช็คงาน — จะแชร์ข้ามเครื่องได้ ไฟล์ต้องไปอยู่ที่ที่ทั้งสองเครื่อง
    // เรียกถึง ที่นี่ใช้ Google Sheet ผ่าน Apps Script ตัวเดียวกับออเดอร์และสต๊อก
    // ══════════════════════════════════════════════════════════════════
    central: {
      url: function () { return window.WmsSettings ? window.WmsSettings.transportUrl() : ''; },
      on: function () { return !!window.TransportFile.central.url(); },

      /** บันทึกไฟล์ที่โหลดอยู่ขึ้นส่วนกลาง @returns {Promise<object>} */
      push: async function (opts) {
        var f = read();
        if (!f) throw new Error('ยังไม่มีไฟล์ให้บันทึก');
        var url = window.TransportFile.central.url();
        if (!url) throw new Error('ยังไม่ได้ตั้ง URL ไฟล์รถบริษัทในหน้าตั้งค่า');
        var r = await window.WmsGas.post(url, {
          token: window.WmsSettings ? window.WmsSettings.transportToken() : '',
          fileName: f.fileName, rows: f.rows, header: f.header,
          by: window.WmsSettings ? window.WmsSettings.me() : '',
        }, opts);
        if (r && r.error) throw new Error(r.error);
        return r;
      },

      /** รายการไฟล์ที่บันทึกไว้ ใหม่สุดขึ้นก่อน (ไม่รวมเนื้อไฟล์) */
      list: async function (opts) {
        var url = window.TransportFile.central.url();
        if (!url) throw new Error('ยังไม่ได้ตั้ง URL ไฟล์รถบริษัทในหน้าตั้งค่า');
        var r = await window.WmsGas.json(url, 'transport', opts);
        if (r && r.error) throw new Error(r.error);
        return (r && r.files) || [];
      },

      /** ดึงไฟล์หนึ่งมาใช้ที่เครื่องนี้ */
      load: async function (id, opts) {
        var url = window.TransportFile.central.url();
        var r = await window.WmsGas.json(
          window.WmsGas.withApi(url, 'transport') + '&id=' + encodeURIComponent(id), 'transport', opts);
        if (r && r.error) throw new Error(r.error);
        if (!r || !r.file || !r.file.data || !r.file.data.length) throw new Error('ไฟล์นี้ไม่มีข้อมูล');
        window.TransportFile.save(r.file.fileName, r.file.data, r.file.header,
          { from: 'central', at: r.file.at, by: r.file.by, id: r.file.id });
        return r.file;
      },
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

  // ══════════════════════════════════════════════════════════════════════
  // แถบไฟล์ส่วนกลาง — ขึ้นเองทุกหน้าในโมดูล
  //
  // ติดไว้ที่นี่ไม่ใช่ในแต่ละหน้า เพราะสี่หน้าใช้ไฟล์เดียวกันและต้องเห็นเรื่องเดียวกัน
  // ว่าตอนนี้ใช้ไฟล์ไหนอยู่ — ก๊อปแถบนี้ไปสี่ที่คือรอวันที่สี่ที่ไม่ตรงกัน
  // ══════════════════════════════════════════════════════════════════════

  var C = window.TransportFile.central;
  var AUTO_FLAG = 'wms:transport:autotried';

  /**
   * แถบนี้เป็นของโมดูลทำใบงานขนส่งเท่านั้น
   *
   * ไฟล์นี้ถูกโหลดในหน้าค้นหาออเดอร์ด้วย เพราะที่นั่นใช้ข้อมูลรถตอบว่าออเดอร์ไป
   * กับคันไหน แต่ตอนแรกผมให้แถบแปะตัวเองลงทุกหน้าที่มี .mod-head ผลคือปุ่ม
   * "บันทึกให้ทีมคลังใช้" ไปโผล่ในหน้าค้นหา แบบไม่มีสไตล์ด้วย เพราะ CSS ผูกกับ
   * data-wms-module="transport" — และที่หนักกว่านั้นคือ autoLoad ก็ทำงานตาม
   * ไปด้วย แล้วจบด้วย location.reload() กลางหน้าที่คนกำลังพิมพ์ค้นหาให้ลูกค้า
   *
   * การอ่าน/เขียนไฟล์ยังใช้ได้ทุกหน้าเหมือนเดิม ที่กั้นคือส่วนที่แสดงผลกับที่
   * โหลดหน้าใหม่เท่านั้น
   */
  function onTransportPage() {
    return typeof document !== 'undefined' && document.body &&
           document.body.getAttribute('data-wms-module') === 'transport';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /** "วันนี้ 08:15" / "14 ส.ค. 08:15" — เวลาจากสคริปต์เป็น 'YYYY-MM-DD HH:mm' */
  function whenLabel(at) {
    var s = String(at || '');
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(s);
    if (!m) return s;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return 'วันนี้ ' + m[4] + ' น.';
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + m[4] + ' น.';
  }

  function isToday(at) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at || ''));
    if (!m) return false;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime() === t.getTime();
  }

  function host() {
    var found = document.getElementById('tc-bar');
    if (found) return found;
    var head = document.querySelector('.mod-head');
    if (!head) return null;
    var h = el('div', 'tc-bar');
    h.id = 'tc-bar';
    head.parentNode.insertBefore(h, head.nextSibling);
    return h;
  }

  function say(h, cls, text) {
    var s = el('span', cls, text);
    h.appendChild(s);
    return s;
  }

  function button(h, cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    h.appendChild(b);
    return b;
  }

  function renderCentral() {
    // ส่วนบนของไฟล์นี้ (COLS, checkHeader, save/get) ตั้งใจให้ไม่แตะ DOM เลย
    // เทสต์จึงโหลดมันได้ด้วย window ปลอมโดยไม่ต้องมีเบราว์เซอร์ — ส่วน UI ตรงนี้
    // ต้องเคารพข้อตกลงเดิมนั้น ไม่ใช่บังคับให้ทุกคนที่ import ต้องมี document
    if (!onTransportPage()) return;
    var h = host();
    if (!h) return;
    h.innerHTML = '';
    if (!C.on()) { h.style.display = 'none'; return; }
    h.style.display = 'flex';

    var f = read();
    var fromCentral = f && f.origin && f.origin.from === 'central';

    if (fromCentral) {
      say(h, 'tc-ic', '☁️');
      say(h, 'tc-txt', 'ใช้ไฟล์ที่บันทึกไว้ส่วนกลาง' +
        (f.origin.by ? ' โดย ' + f.origin.by : '') + ' · ' + whenLabel(f.origin.at));
    } else if (f) {
      say(h, 'tc-ic', '📄');
      say(h, 'tc-txt', 'ไฟล์นี้ยังอยู่แค่ในเครื่องนี้ — เครื่องอื่นยังไม่เห็น');
      button(h, 'tc-btn primary', '☁️ บันทึกให้ทีมคลังใช้', doPush);
    } else {
      say(h, 'tc-ic', '☁️');
      say(h, 'tc-txt', 'ยังไม่ได้เลือกไฟล์');
    }

    button(h, 'tc-btn', '📥 ไฟล์จากส่วนกลาง', openPicker);
  }

  async function doPush(e) {
    var btn = e.currentTarget;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    try {
      var r = await C.push({ onProgress: function (s) { btn.textContent = 'กำลังบันทึก… ' + s + ' วินาที'; } });
      btn.textContent = '✓ บันทึกแล้ว ' + (r.rows || '') + ' แถว';
      // ไฟล์ที่เพิ่งบันทึกคือไฟล์เดียวกับที่ถืออยู่ ทำเครื่องหมายว่าอยู่ส่วนกลางแล้ว
      // ไม่งั้นแถบจะยังชวนให้กดบันทึกซ้ำ แล้วชีตจะมีไฟล์เดียวกันสองแถว
      var f = read();
      if (f) window.TransportFile.save(f.fileName, f.rows, f.header,
        { from: 'central', at: nowLocal(), by: window.WmsSettings ? window.WmsSettings.me() : '', id: r.id });
      setTimeout(renderCentral, 1600);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      alert('บันทึกไม่สำเร็จ — ' + err.message);
    }
  }

  function nowLocal() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function openPicker() {
    var back = el('div', 'tc-back');
    var box = el('div', 'tc-box');
    var head = el('div', 'tc-head');
    head.appendChild(el('b', null, 'เลือกไฟล์รถบริษัท'));
    head.appendChild(el('span', 'tc-sub', 'ไฟล์ที่ทีมขนส่งบันทึกไว้ ใหม่สุดอยู่บนสุด'));
    var list = el('div', 'tc-list', 'กำลังโหลด…');
    var foot = el('div', 'tc-foot');
    button(foot, 'tc-btn', 'ปิด', function () { back.remove(); });

    box.appendChild(head); box.appendChild(list); box.appendChild(foot);
    back.appendChild(box);
    back.addEventListener('click', function (ev) { if (ev.target === back) back.remove(); });
    document.body.appendChild(back);

    C.list().then(function (files) {
      list.innerHTML = '';
      if (!files.length) {
        list.appendChild(el('div', 'tc-empty', 'ยังไม่มีไฟล์ที่บันทึกไว้ — ให้ทีมขนส่งอัปไฟล์แล้วกด “บันทึกให้ทีมคลังใช้”'));
        return;
      }
      files.forEach(function (fl) {
        var row = el('div', 'tc-row');
        var main = el('div', 'tc-rmain');
        main.appendChild(el('div', 'tc-rname', fl.fileName || '(ไม่มีชื่อไฟล์)'));
        main.appendChild(el('div', 'tc-rmeta',
          whenLabel(fl.at) + ' · ' + fl.rows + ' แถว' + (fl.by ? ' · ' + fl.by : '')));
        row.appendChild(main);
        var use = el('button', 'tc-btn primary', 'ใช้ไฟล์นี้');
        use.type = 'button';
        use.addEventListener('click', function () {
          use.disabled = true; use.textContent = 'กำลังโหลด…';
          C.load(fl.id).then(function () { location.reload(); })
                       .catch(function (err) { use.disabled = false; use.textContent = 'ใช้ไฟล์นี้';
                                               alert('โหลดไม่สำเร็จ — ' + err.message); });
        });
        row.appendChild(use);
        list.appendChild(row);
      });
    }).catch(function (err) {
      list.innerHTML = '';
      list.appendChild(el('div', 'tc-empty', 'ดึงรายการไม่สำเร็จ — ' + err.message));
    });
  }

  /**
   * เปิดหน้ามาแล้วมีไฟล์รออยู่เลย โดยไม่ต้องไปตามขอใคร
   *
   * โหลดให้เองเฉพาะไฟล์ของ "วันนี้" เท่านั้น ไฟล์ของเมื่อวานไม่โหลดให้แม้จะเป็น
   * ไฟล์ล่าสุด เพราะความผิดพลาดที่แพงที่สุดของโมดูลนี้คือทำงานจากไฟล์เก่าโดยไม่รู้ตัว
   * (เหตุผลเดียวกับที่ไฟล์นี้เลือก sessionStorage ตั้งแต่ต้น) — ของเก่ายังเลือกเองได้
   * จากปุ่มไฟล์จากส่วนกลาง ซึ่งเป็นการตัดสินใจที่มีคนกดจริง
   *
   * ยิงครั้งเดียวต่อรอบเบราว์เซอร์ ล้มแล้วไม่ยิงซ้ำทุกหน้าที่เปิด
   */
  function autoLoad() {
    if (!onTransportPage()) return;
    if (!C.on() || read()) return;
    try { if (sessionStorage.getItem(AUTO_FLAG)) return; sessionStorage.setItem(AUTO_FLAG, '1'); } catch (e) {}
    C.list().then(function (files) {
      var newest = files[0];
      if (!newest || !isToday(newest.at)) { renderCentral(); return; }
      return C.load(newest.id).then(function () { location.reload(); });
    }).catch(function () { /* ตั้ง URL ผิดหรือเน็ตล่ม — หน้ายังอัปไฟล์เองได้ตามปกติ */ });
  }

  window.TransportFile.renderCentral = renderCentral;
  window.TransportFile.openPicker = openPicker;

  // nav เป็น type="module" จึงรันหลังหน้าถูก parse แต่ก่อน DOMContentLoaded
  // ตรงนี้จึงเจอ .mod-head ที่ nav วางไว้แล้วเสมอ
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      renderCentral();
      autoLoad();
    });
  }
})();
