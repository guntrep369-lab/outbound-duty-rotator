/**
 * book-keys.js — ค้นหาทั้งระบบและคีย์ลัดของแอปสมุดสต๊อก (ระบบใหม่เท่านั้น)
 *
 *   Ctrl K    ค้นเมนู · SKU · โล · เอกสาร จากสำเนาในเครื่อง (ไม่อ่านฐาน) รหัสตรงตัวขึ้นก่อน
 *   ← → Tab   เลื่อนช่อง (← → ออกจากช่องเมื่ออยู่ขอบหรือเลือกทั้งช่อง) · ↑ ↓ Enter อยู่ในตารางของแต่ละหน้า
 *   F2 · Esc  แก้ช่องต่อจากท้าย · คืนค่าก่อนแก้
 *   Ctrl S    คิดแผนใหม่แล้วถามก่อน จึงกดปุ่มบันทึกปกติของหน้านั้น
 *             ไม่แตะ ยอดยกมา ปิดเดือน รับ / อนุมัติ ยกเลิกใบ · ไม่มีทางเขียนฐานของตัวเอง
 *
 * ใช้ BookApp BookItem BookGrid BookMaster กับตัวแปรของสคริปต์ในหน้า (FIRE USER MODE esc f) ตอนถูกเรียกเท่านั้น
 * เปิดเป็น window.BookKeys · ระบบเดิม = null
 */
(function () {
  'use strict';

  if (!window.BookFire) { window.BookKeys = null; return; }

  var HITS = 8;               // ผลต่อกลุ่ม
  var CELL = '#gTable input, #mdTbl input[data-mf], input[data-ttr]';
  var SAVE = { cut: 'saveBtn', gr: 'gSave', move: 'gSave', ret: 'gSave', conv: 'gSave', adj: 'gSave', rows: 'gSave', master: 'mdSave', trc: 'ttSave' };
  var LIST = [], SEL = 0, SHOWN = null, BACK = null, WAIT = null, SAY_T = null;
  var WAS = null;             // ค่าของช่องก่อนแก้ { key, value }

  function $(id) { return document.getElementById(id); }
  function active() { return !!(window.BookFire && typeof USER !== 'undefined' && USER && window.BookApp); }
  function plain(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  /** ข้อความสั้นมุมล่าง (อ่านออกเสียงได้) */
  function say(text) {
    var el = $('bkSay');
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(SAY_T);
    SAY_T = setTimeout(function () { el.classList.remove('on'); el.textContent = ''; }, 4000);
  }

  /* ── Ctrl K ─────────────────────────────────────────────────────────── */

  /** [{ group, title, sub, run }] */
  function find(text) {
    var q = String(text || '').trim(), U = q.toUpperCase(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var menu = BookApp.menu().filter(function (m) {
      var hay = (m.t + ' ' + m.area).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).map(function (m) {
      return { group: 'เมนู', title: m.t, sub: m.area + (m.away ? ' · แท็บใหม่' : ''), run: function () { BookApp.openNav(m.id); } };
    });
    if (q.length < 2) return menu;
    menu = menu.slice(0, HITS);

    var hit = window.BookItem ? BookItem.find(q, HITS) : { skus: [], loc: null, exact: false };
    var goods = hit.skus.map(function (it) {
      return { group: 'สินค้า', title: it.sku || it.code, sub: [it.name, f(it.total) + ' ชิ้น'].filter(Boolean).join(' · '), run: function () { BookItem.open(it.code); } };
    });
    var locs = hit.loc ? [{
      group: 'โล', title: hit.loc.q + (hit.loc.n > 1 ? ' …' : ''), sub: (hit.loc.n > 1 ? f(hit.loc.n) + ' โล · ' : '') + f(hit.loc.total) + ' ชิ้น',
      run: function () { BookItem.view({ q: hit.loc.q, chip: 'all' }); },
    }] : [];
    var r = FIRE.docs({ text: q, range: 'all', max: HITS }), found = r ? r.list : [];
    var docs = found.map(function (x) {
      return { group: 'เอกสาร', title: x.no, sub: [x.type, x.date.split('-').reverse().join('/'), x.name].filter(Boolean).join(' · '), no: x.no, run: function () { BookApp.openDoc(x.no); } };
    });
    var exactDoc = docs.filter(function (d) { return String(d.no).toUpperCase() === U; });
    if (exactDoc.length) docs = exactDoc.concat(docs.filter(function (d) { return exactDoc.indexOf(d) < 0; }));
    if (r && r.total > found.length) {
      docs.push({ group: 'เอกสาร', title: 'ดูทั้งหมด ' + f(r.total) + ' ใบ', sub: 'หน้าเอกสารทั้งหมด', run: function () { BookApp.searchDocs(q); } });
    }
    if (exactDoc.length) return docs.concat(goods, locs, menu);
    if (hit.exact) return goods.concat(locs, docs, menu);
    if (locs.length) return locs.concat(goods, docs, menu);
    return menu.concat(goods, docs);
  }

  function draw() {
    var input = $('bqIn'), box = $('bqList');
    if (!input || !box) return;
    SHOWN = input.value;
    LIST = find(SHOWN);
    SEL = 0;
    var group = '', html = '';
    LIST.forEach(function (x, i) {
      if (x.group !== group) { group = x.group; html += '<div class="bq-g" role="presentation">' + esc(group) + '</div>'; }
      html += '<div class="bq-it" role="option" id="bq-' + i + '" data-bq="' + i + '" aria-selected="' + (i === 0) + '"><b>' + esc(x.title) + '</b><span>' + esc(x.sub || '') + '</span></div>';
    });
    box.innerHTML = html || '<div class="bq-none" role="presentation">ไม่พบ ' + esc(SHOWN) + '</div>';
    box.scrollTop = 0;
    if (LIST.length) input.setAttribute('aria-activedescendant', 'bq-0'); else input.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    if (!LIST.length) return;
    SEL = (i + LIST.length) % LIST.length;
    Array.prototype.forEach.call($('bqList').querySelectorAll('.bq-it'), function (el, n) { el.setAttribute('aria-selected', String(n === SEL)); });
    $('bqIn').setAttribute('aria-activedescendant', 'bq-' + SEL);
    $('bq-' + SEL).scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!active()) return;
    if ($('bqIn')) { $('bqIn').focus(); $('bqIn').select(); return; }
    BACK = document.activeElement;
    var el = document.createElement('div');
    el.className = 'bq-back';
    el.id = 'bqBack';
    el.innerHTML = '<div class="bq" role="dialog" aria-modal="true" aria-label="ค้นหาทั้งระบบ">' +
      '<input id="bqIn" type="text" role="combobox" aria-expanded="true" aria-controls="bqList" aria-autocomplete="list" aria-label="ค้นหาเมนู SKU โล เอกสาร"' +
        ' placeholder="ค้นหาเมนู SKU โล เอกสาร" autocomplete="off" spellcheck="false" enterkeyhint="go" maxlength="100">' +
      '<div class="bq-list" id="bqList" role="listbox" aria-label="ผลค้นหา"></div>' +
      '<div class="bq-foot"><span>↑ ↓ เลือก</span><span>Enter เปิด</span><span>Esc ปิด</span></div></div>';
    document.body.appendChild(el);
    draw();
    $('bqIn').focus();
  }

  function close(restore) {
    var el = $('bqBack');
    clearTimeout(WAIT);
    if (!el) return;
    el.remove();
    LIST = [];
    if (restore && BACK && BACK.isConnected && BACK.focus) BACK.focus();
    BACK = null;
  }

  function run(i) {
    var x = LIST[i];
    if (!x) return;
    close(false);
    x.run();
  }

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'bqIn') return;
    clearTimeout(WAIT);
    WAIT = setTimeout(draw, 160);
  });
  document.addEventListener('click', function (e) {
    if (!$('bqBack') || !e.target.closest) return;
    if (e.target.id === 'bqBack') { close(true); return; }
    var it = e.target.closest('[data-bq]');
    if (it) run(+it.dataset.bq);
  });

  function searchKey(e) {
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(true); }
    else if (k === 'Tab') { e.preventDefault(); $('bqIn').focus(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); pick(SEL + (k === 'ArrowDown' ? 1 : -1)); }
    else if (k === 'Enter') {
      e.preventDefault();
      if ($('bqIn').value !== SHOWN) { clearTimeout(WAIT); draw(); }   // สแกนบาร์โค้ดส่ง Enter ก่อนผลค้นขึ้น
      run(SEL);
    } else return;
    e.stopPropagation();
  }

  /* ── ช่องในตาราง ─────────────────────────────────────────────────────── */

  function keyOf(el) {
    if (!el || !el.matches || !el.matches(CELL) || el.type === 'checkbox' || el.type === 'color') return '';
    var d = el.dataset;
    return d.ttr !== undefined ? 't|' + d.ttr : d.mf !== undefined ? 'm|' + d.mi + '|' + d.mf : MODE + '|' + d.r + '|' + d.c;
  }

  document.addEventListener('focusin', function (e) {
    var key = keyOf(e.target);
    if (key && (!WAS || WAS.key !== key)) WAS = { key: key, value: e.target.value };
  });
  document.addEventListener('focusout', function (e) {
    var key = keyOf(e.target);
    if (!key) return;
    /* ตารางวาดใหม่ระหว่างพิมพ์ ช่องเดิมได้โฟกัสคืนทันที ค่าก่อนแก้ยังใช้ต่อ */
    setTimeout(function () { if (WAS && WAS.key === key && keyOf(document.activeElement) !== key) WAS = null; }, 0);
  });

  function cellKey(e) {
    var el = e.target, key = keyOf(el);
    if (!key || el.disabled || el.readOnly) return;
    var n = el.value.length;
    if (e.key === 'F2') {
      e.preventDefault();
      try { el.setSelectionRange(n, n); } catch (err) {}
    } else if (e.key === 'Escape') {
      if (!WAS || WAS.key !== key || el.value === WAS.value) return;
      e.preventDefault(); e.stopPropagation();
      el.value = WAS.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      say('ยกเลิกการแก้ช่องนี้แล้ว');
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      var a = el.selectionStart, b = el.selectionEnd, right = e.key === 'ArrowRight';
      if (a === null || !((a === 0 && b === n) || (a === b && a === (right ? n : 0)))) return;
      var row = el.closest('tr');
      var cells = Array.prototype.filter.call(row ? row.querySelectorAll('input') : [], function (x) { return keyOf(x) && !x.disabled; });
      var next = cells[cells.indexOf(el) + (right ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); next.select(); }
    }
  }

  /* ── Ctrl S ─────────────────────────────────────────────────────────── */

  function saveId() {
    if (MODE === 'docs') return $('baTr') && $('baTr').value.trim() ? 'baTrSave' : '';
    return Object.prototype.hasOwnProperty.call(SAVE, MODE) ? SAVE[MODE] : '';
  }

  function checkSave() {
    var id = saveId();
    if (!id || !$(id)) { say('หน้านี้ไม่มีรายการรอบันทึก'); return; }
    var a = document.activeElement, main = document.querySelector('.wms-main');
    var typed = a && main && main.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) ? a : null;
    if (typed) typed.blur();                                   // ช่องที่พิมพ์อยู่จบก่อน
    if (id === 'gSave' && window.BookGrid) BookGrid.flush(MODE);   // แผนล่าสุด ไม่รอหน่วงหลังพิมพ์
    if (id === 'mdSave' && window.BookMaster) BookMaster.flush();
    var back = function () { if (typed && typed.isConnected) typed.focus(); };
    var btn = $(id);
    if (!btn) { back(); return; }
    if (btn.disabled) {
      var bad = document.querySelector('#body tr.r-bad input:not([disabled])');
      if (bad) bad.focus(); else back();
      say('ยังบันทึกไม่ได้ · ' + (btn.title || plain(document.querySelector('#act .c-red')) || (bad ? 'แก้แถวที่ผิดก่อน' : 'ยังไม่มีรายการที่พร้อมบันทึก')));
      return;
    }
    var label = plain(btn).replace(/^[^A-Za-zก-๙]+/, '');
    var info = id === 'baTrSave' ? 'เลข TRcloud ' + $('baTr').value.trim() : Array.prototype.map.call($('sum').querySelectorAll('.bk-chip:not(.zero)'), plain).join(' · ');
    if (!confirm('ตรวจแล้ว ' + label + '?' + (info ? '\n' + info : ''))) { back(); return; }
    btn = $(id);
    if (btn && !btn.disabled) btn.click();
  }

  document.addEventListener('keydown', function (e) {
    if (!active() || e.isComposing) return;
    var mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey, k = String(e.key || '').toLowerCase();
    /* แป้นไทยส่ง key เป็นอักษรไทย ดู code ด้วย */
    if (mod && (e.code === 'KeyK' || k === 'k')) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) open(); return; }
    if (mod && (e.code === 'KeyS' || k === 's')) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && !$('bqBack')) checkSave();
      return;
    }
    if ($('bqBack')) { searchKey(e); return; }
    cellKey(e);
  }, true);

  window.BookKeys = { open: open, close: function () { close(false); }, say: say };
})();
