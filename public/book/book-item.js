/**
 * book-item.js — หน้า 📦 สินค้า / โล ของแอปสมุดสต๊อก (ระบบใหม่เท่านั้น)
 *
 *   รายการ   ช่องค้น SKU · ชื่อ · โล · LOT · PO · Supplier (สแกนบาร์โค้ดใส่ช่องได้) · ชิป มีของ เปิดขาย QA ติดลบ หมดแล้ว ทั้งหมด
 *            พิมพ์ชื่อโล = ของในโลนั้น · Enter เมื่อเหลือ SKU เดียว = เปิดเลย
 *   SKU      ยอดรวม เปิดขาย สำรอง QA ติดลบ · Supplier · ความจุต่อพาเลท · คู่แปลง (กดไป SKU คู่)
 *            อยู่ที่ไหน: ทุกกองเรียงลำดับตัด (FIFO) วันรับ อายุ · สต๊อกการ์ด ใหม่สุดก่อน คงเหลือหลังแต่ละแถว
 *            กด การ์ด ที่กอง = สต๊อกการ์ดเฉพาะโลนั้น · เลขที่ = เปิดใบ (‹ กลับ มาหน้านี้) · 📋 คัดลอกการ์ดไปวาง Excel
 *   ลิงก์ #sku=รหัส ส่งต่อได้ · คิดจากสำเนาในเครื่อง ไม่อ่านฐาน (wms-fire-item.js)
 * ใช้ตัวแปรของสคริปต์ในหน้า (FIRE USER MODE RES ST esc f table copyText setMode) ตอนถูกเรียกเท่านั้น
 * เปิดเป็น window.BookItem
 */
(function () {
  'use strict';

  if (!window.BookFire) { window.BookItem = null; return; }

  var CHIP_KEY = 'wms:book:item:chip';
  var CARD_STEP = 150;      // แถวสต๊อกการ์ดที่แสดงต่อครั้ง
  var CHIP_TH = { have: 'มีของ', open: 'เปิดขาย', qa: 'มี QA', neg: 'ติดลบ', zero: 'หมดแล้ว', all: 'ทั้งหมด' };
  var ST_CLS = { open: 'ok', reserve: 'sub', qa: 'apv', neg: 'void' };

  var S = {
    q: '', code: codeFromHash(), loc: '', more: CARD_STEP, note: null,
    chip: (function () { try { return localStorage.getItem(CHIP_KEY) || 'have'; } catch (e) { return 'have'; } })(),
  };
  var IX = { st: null, ix: null, day: '' };
  var TYPING = null;

  function $(id) { return document.getElementById(id); }
  function X() { return window.WmsFireItem; }
  function codeFromHash() {
    var m = /^#sku=([^&]{1,40})$/.exec(location.hash || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1]).trim().toUpperCase(); } catch (e) { return ''; }
  }
  function dmy(day) { var p = String(day || '').split('-'); return p.length === 3 ? +p[2] + '/' + +p[1] + '/' + p[0].slice(2) : ''; }
  function on() { return !!(window.BookFire && USER && MODE === 'item'); }
  function num(n, cls) { return '<td class="num' + (cls ? ' ' + cls : '') + '">' + f(n) + '</td>'; }

  /** ดัชนีทุก SKU คิดใหม่เมื่อยอดเปลี่ยน (ST ตัวใหม่) */
  function ix() {
    if (!ST || !X()) return null;
    var day = FIRE.today();
    if (IX.st !== ST || IX.day !== day) IX = { st: ST, day: day, ix: X().index(ST, day) };
    return IX.ix;
  }

  function setHash(code) {
    var h = code ? '#sku=' + encodeURIComponent(code) : '';
    if (location.hash === h) return;
    try { history.pushState(null, '', h || location.pathname + location.search); } catch (e) { location.hash = h; }
  }

  /** เปิดรายการจากเมนู / ค้นหา · chip = ตัวกรองครั้งนี้ ไม่ทับตัวที่จำไว้ · ไม่มี q = คำค้นเดิม */
  function view(v) {
    v = v || {};
    S.code = ''; S.loc = ''; S.note = null;
    if (v.q !== undefined) S.q = v.q;
    else if (v.chip) S.q = '';
    var saved = 'have';
    try { saved = localStorage.getItem(CHIP_KEY) || 'have'; } catch (e) {}
    S.chip = v.chip || saved;
    setHash('');
    if (MODE !== 'item') setMode('item'); else window.render();
    if (window.BookApp) BookApp.top();
  }

  /** ค้นให้ Ctrl K: รหัสตรงตัวก่อน */
  function find(q, max) {
    var x = ix();
    if (!x) return { skus: [], loc: null, exact: false };
    var r = X().search(x, q, 'all'), U = String(q).trim().toUpperCase();
    var same = function (it) { return String(it.sku).toUpperCase() === U || String(it.long).toUpperCase() === U; };
    var top = r.list.filter(same);
    return {
      exact: top.length > 0,
      skus: top.concat(r.list.filter(function (it) { return !same(it); })).slice(0, max).map(function (it) {
        return { code: it.long || it.sku, sku: it.sku, name: it.name, total: it.total };
      }),
      loc: r.loc ? { q: r.loc.q, n: r.loc.locs.length, total: r.loc.total } : null,
    };
  }

  /** เปิด SKU (รหัสยาวหรือสั้น) · '' = กลับรายการ */
  function open(code) {
    S.code = String(code || '').toUpperCase();
    S.loc = ''; S.more = CARD_STEP; S.note = null;
    setHash(S.code);
    if (MODE !== 'item') setMode('item'); else render();
    if (window.BookApp) BookApp.top();
  }

  function render() {
    var x = ix();
    if (S.code) renderSku(x); else renderList(x);
  }

  /* ── รายการ ───────────────────────────────────────────────────────── */

  function renderList(x) {
    var had = document.activeElement && document.activeElement.id === 'itQ';
    var pos = had ? document.activeElement.selectionStart : null;
    $('inp').innerHTML = '<div class="bk-top"><span class="bk-h">สินค้า / โล</span>' +
      '<input class="bk-field ba-q" id="itQ" type="search" autocomplete="off" enterkeyhint="search" aria-label="ค้นหาสินค้าหรือโล" placeholder="ค้น SKU · ชื่อ · โล · LOT · PO · Supplier" value="' + esc(S.q) + '">' +
      '<button type="button" class="g-tip" aria-label="คำอธิบาย" title="' + esc('ค้นได้หลายคำพร้อมกัน เว้นวรรค เช่น ชื่อกับโล\nพิมพ์ชื่อโลตรงตัว (หรือต้นชื่อ เช่น R01-02) = ของในโลนั้น\nLOT พิมพ์ lot8 · สแกนบาร์โค้ดใส่ช่องนี้ได้\nEnter เมื่อเหลือ SKU เดียว = เปิดเลย\nคิดจากสำเนาในเครื่องนี้ ไม่กินโควตา') + '">ⓘ</button>' +
      '<span class="sp"></span>' + (x ? '<span class="c-sub">ในเครื่อง ' + f(x.skus) + ' SKU · ' + f(x.piles) + ' กอง</span>' : '') + '</div>';
    if (had && $('itQ')) { $('itQ').focus(); try { $('itQ').setSelectionRange(pos, pos); } catch (e) {} }
    $('act').innerHTML = '';
    $('docs').innerHTML = '';
    renderResults(x);
  }

  function renderResults(x) {
    x = x || ix();
    if (!x) { $('sum').innerHTML = ''; $('body').innerHTML = '<div class="tx-empty">กำลังเปิดสมุด…</div>'; return; }
    var r = X().search(x, S.q, S.chip);
    $('sum').innerHTML = X().CHIPS.map(function (c) {
      var n = r.counts[c] || 0, tone = c === 'neg' ? ' c-red' : c === 'qa' ? ' c-warn' : '';
      return '<button type="button" class="bk-chip' + tone + (r.chip === c ? ' on' : '') + (n || r.chip === c ? '' : ' zero') + '" data-itc="' + c + '">' + CHIP_TH[c] + ' <b>' + f(n) + '</b></button>';
    }).join('');
    var html = '';
    if (r.loc) html += locTable(x, r.loc);
    if (!r.total) {
      if (!r.loc) {
        html += '<div class="tx-empty">' + (S.q ? 'ไม่พบ <b>' + esc(S.q) + '</b>' + (r.counts.all ? ' ในชิป ' + CHIP_TH[r.chip] + ' ลองกด ทั้งหมด' : '') : r.counts.all ? 'ไม่มี SKU ในชิปนี้' : 'สมุดยังไม่มีสินค้า') + '</div>';
      }
      $('body').innerHTML = html;
      return;
    }
    var sup = x.list.some(function (it) { return it.sups.length; });   // ยังไม่มีแท็บ PO. Truck = ไม่มีคอลัมน์ Supplier
    var rows = r.list.map(function (it) {
      var ol = it.openLocs.slice(0, 2).join(', ') + (it.openLocs.length > 2 ? ' +' + (it.openLocs.length - 2) : '');
      return '<tr><td class="c-act"><button type="button" class="ba-no" data-it="' + esc(it.long || it.sku) + '">' + esc(it.sku || it.long) + '</button></td>' +
        '<td class="c-nm" title="' + esc(it.name) + '">' + esc(it.name) + '</td>' +
        num(it.total, it.nNeg ? 'c-red' : it.total > 0 ? 'c-sku' : 'c-sub') + num(it.open) + num(it.reserve) +
        '<td class="num' + (it.qa ? ' c-warn' : '') + '">' + (it.qa ? f(it.qa) : '') + '</td>' +
        '<td>' + esc(ol) + '</td><td class="num">' + f(it.piles.length + it.nNeg) + '</td><td class="c-sub">' + esc(it.long) + '</td>' +
        (sup ? '<td class="c-sub">' + esc(it.sups.join(', ')) + '</td>' : '') +
        '<td class="c-sub">' + (it.first ? esc(dmy(it.first)) + (it.age !== null ? ' · ' + f(it.age) + ' วัน' : '') : '') + '</td></tr>';
    });
    html += (r.loc ? '<h3 class="it-h">SKU ที่ตรงกับ <b>' + esc(S.q) + '</b></h3>' : '') +
      table([['SKU'], ['ชื่อสินค้า'], ['รวม', 'num'], ['เปิดขาย', 'num'], ['สำรอง', 'num'], ['QA', 'num'], ['โลเปิดขาย'], ['กอง', 'num'], ['SKU เต็ม']]
        .concat(sup ? [['Supplier']] : [], [['รับเก่าสุด']]), rows);
    $('body').innerHTML = html;
  }

  /** ของในโลที่พิมพ์ (ตรงตัว หรือทุกโลที่ขึ้นต้นด้วยคำนั้น) */
  function locTable(x, L) {
    var rows = L.piles.map(function (p) {
      var it = x.by[p.s];
      return '<tr><td><b>' + esc(p.loc) + '</b></td><td class="c-act"><button type="button" class="ba-no" data-it="' + esc(it.long || it.sku) + '">' + esc(it.sku || it.long) + '</button></td>' +
        num(p.qty, p.st === 'neg' ? 'c-red' : 'c-sku') + '<td>' + stPill(p.st) + '</td>' +
        '<td class="c-nm" title="' + esc(it.name) + '">' + esc(it.name) + '</td><td>' + esc(p.lot) + '</td><td>' + esc(p.po) + '</td>' +
        '<td class="c-sub">' + esc(dmy(p.first)) + '</td><td class="num c-sub">' + (p.age !== null ? f(p.age) : '') + '</td></tr>';
    });
    var head = L.locs.length === 1 ? 'โล <b>' + esc(L.locs[0]) + '</b>' : 'โลที่ขึ้นต้นด้วย <b>' + esc(L.q) + '</b> · ' + f(L.locs.length) + ' โล';
    return '<h3 class="it-h">' + head + ' <span>' + f(L.piles.length) + ' กอง · รวม ' + f(L.total) + ' ชิ้น</span></h3>' +
      table([['โล'], ['SKU'], ['ยอด', 'num'], ['สถานะ'], ['ชื่อสินค้า'], ['LOT'], ['PO'], ['วันรับ'], ['อายุ (วัน)', 'num']], rows);
  }

  function stPill(st) { return '<span class="ba-st ' + ST_CLS[st] + '">' + X().ST_TH[st] + '</span>'; }

  /* ── SKU เดียว ────────────────────────────────────────────────────── */

  function renderSku(x) {
    $('docs').innerHTML = '';
    var d = x ? X().detail(x, RES, ST, S.code) : null;
    if (!d) {
      $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="itBack">‹ กลับ</button><span class="bk-h">' + esc(S.code) + '</span></div>';
      $('sum').innerHTML = ''; $('act').innerHTML = '';
      $('body').innerHTML = '<div class="tx-empty">' + (x ? 'ไม่พบ SKU <b>' + esc(S.code) + '</b> ในสมุด' : 'กำลังเปิดสมุด…') + '</div>';
      return;
    }
    $('inp').innerHTML = '<div class="bk-top"><button type="button" class="tx-opt" id="itBack">‹ กลับ</button>' +
      '<span class="bk-h">' + esc(d.sku || d.long) + '</span>' + (d.sku && d.long ? '<span class="c-sub">' + esc(d.long) + '</span>' : '') +
      '<span class="it-nm">' + esc(d.name) + '</span><span class="sp"></span>' +
      '<button type="button" class="tx-opt" id="itCopy" title="สต๊อกการ์ดที่แสดงอยู่ทั้งหมด วางใน Excel ได้">📋 คัดลอกการ์ด</button></div>';

    var sum = '<span class="bk-chip on">รวม <b>' + f(d.total) + '</b></span>' +
      '<span class="bk-chip c-ok">เปิดขาย <b>' + f(d.open) + '</b></span>' +
      '<span class="bk-chip">สำรอง <b>' + f(d.reserve) + '</b></span>' +
      (d.qa ? '<span class="bk-chip c-warn">QA <b>' + f(d.qa) + '</b></span>' : '') +
      (d.nNeg ? '<span class="bk-chip c-red" title="กองติดลบ = ลงเบิกเกินของที่มี ต้องหาแถวที่ผิด">ติดลบ <b>' + f(d.neg) + '</b> · ' + f(d.nNeg) + ' กอง</span>' : '') +
      (d.cap ? '<span class="bk-chip">ความจุ <b>' + f(d.cap) + '</b>/พาเลท' + (d.pallets !== null ? ' ≈ ' + f(d.pallets) + ' พาเลท' : '') + '</span>' : '') +
      (d.sups.length ? '<span class="bk-chip">Supplier <b>' + esc(d.sups.join(', ')) + '</b></span>' : '');
    var pairs = d.from.map(function (p) { return pairChip('แปลงมาจาก', p); }).concat(d.to.map(function (p) { return pairChip('แปลงเป็น', p); }));
    if (pairs.length) sum += '<span class="bk-sep"></span>' + pairs.join('');
    $('sum').innerHTML = sum;
    $('act').innerHTML = S.note ? '<div class="bk-msg ' + S.note.kind + '">' + S.note.html + '</div>' : '';

    /* อยู่ที่ไหน: ลำดับตัด FIFO (กองเปิดขายกองแรก = ตัดก่อน) กองติดลบท้ายสุด */
    var sup = d.piles.some(function (p) { return p.sup; });
    var prow = d.piles.map(function (p, i) {
      var me = S.loc && S.loc === String(p.loc).toUpperCase();
      return '<tr' + (me ? ' class="r-sel"' : '') + '><td><b>' + esc(p.loc) + '</b></td>' + num(p.qty, p.st === 'neg' ? 'c-red' : 'c-sku') +
        '<td>' + stPill(p.st) + (i === d.next ? ' <span class="c-sub">ตัดก่อน</span>' : '') + '</td>' +
        '<td>' + esc(p.lot) + '</td><td>' + esc(p.po) + '</td>' + (sup ? '<td class="c-sub">' + esc(p.sup) + '</td>' : '') +
        '<td class="c-sub">' + esc(dmy(p.first)) + '</td><td class="num c-sub">' + (p.age !== null ? f(p.age) : '') + '</td>' +
        '<td class="c-act"><button type="button" class="tx-opt it-cb' + (me ? ' on' : '') + '" data-itloc="' + esc(p.loc) + '">การ์ด</button></td></tr>';
    });
    var where = prow.length
      ? table([['โล'], ['ยอด', 'num'], ['สถานะ'], ['LOT'], ['PO']].concat(sup ? [['Supplier']] : [], [['วันรับ'], ['อายุ (วัน)', 'num'], ['', 'c-act']]), prow)
      : '<div class="ba-none">ตอนนี้ไม่มีของ SKU นี้ในคลัง</div>';

    var c = FIRE.card(d.long || d.sku, { sku: d.sku, loc: S.loc });
    var cardHtml = '<div class="ba-none">กำลังเปิดสมุด…</div>', head = '';
    if (c) {
      var list = c.rows.slice().reverse(), shown = list.slice(0, S.more);
      var crow = shown.map(function (r) {
        var sign = r.kind === 'move' ? '⇄ ' + f(r.qty) : (r.delta > 0 ? '+' : r.delta < 0 ? '−' : '') + f(Math.abs(r.delta));
        var tag = r.voided ? ' <span class="ba-st void">ยกเลิก</span>' : r.rev ? ' <span class="ba-st rev">กลับรายการ</span>' : '';
        return '<tr' + (r.voided || r.rev ? ' class="r-void"' : '') + '><td>' + esc(dmy(r.date)) + '</td>' +
          '<td class="c-act"><button type="button" class="ba-no" data-doc="' + esc(r.no) + '">' + esc(r.no) + '</button></td>' +
          '<td class="num it-' + r.kind + '">' + sign + '</td><td class="num c-sku">' + f(r.bal) + '</td>' +
          '<td>' + esc(r.type) + tag + '</td><td>' + esc(r.lot) + '</td><td>' + esc(r.po) + '</td>' +
          '<td class="c-sub">' + esc(r.from) + '</td><td class="c-sub">' + esc(r.to) + (r.open ? ' <span class="c-ok">เปิด</span>' : '') + '</td>' +
          '<td class="c-sub">' + esc(r.who) + '</td><td class="c-sub it-note" title="' + esc(r.note) + '">' + esc(r.note) + '</td></tr>';
      });
      cardHtml = crow.length
        ? table([['วันที่'], ['เลขที่'], ['จำนวน', 'num'], ['คงเหลือ', 'num'], ['ประเภท'], ['LOT'], ['PO'], ['จากโล'], ['ไปโล'], ['ผู้ลง'], ['Note']], crow,
          list.length > shown.length ? '<div class="bk-more">แสดง ' + f(shown.length) + ' จาก ' + f(list.length) + ' แถว <button type="button" class="tx-opt" data-itmore="1">แสดงเพิ่ม</button></div>' : '')
        : '<div class="ba-none">ยังไม่มีรายการของ SKU นี้' + (S.loc ? 'ที่โล ' + esc(S.loc) : '') + '</div>';
      head = ' <span>เข้า ' + f(c.inQ) + ' · ออก ' + f(c.outQ) + ' · คงเหลือ <b>' + f(c.bal) + '</b>' + (S.loc ? ' ที่โล ' + esc(S.loc) : '') + '</span>' +
        (S.loc ? ' <button type="button" class="bk-chip on" data-itloc="" title="ดูทุกโล">โล ' + esc(S.loc) + ' ✕</button>' : '');
    }
    $('body').innerHTML = '<div class="ba-home it-page">' +
      '<section class="ba-sec"><h3>อยู่ที่ไหน <span>' + f(d.piles.length) + ' กอง · เรียงตามลำดับตัด เก่าสุดก่อน</span></h3>' + where + '</section>' +
      '<section class="ba-sec"><h3>สต๊อกการ์ด' + head + '</h3>' + cardHtml + '</section></div>';
  }

  function pairChip(word, p) {
    var label = word + ' <b>' + esc(p.sku || p.code) + '</b>' + (p.s >= 0 ? ' · คงเหลือ ' + f(p.total) : ' · ยังไม่เคยมีในสมุด');
    return p.s >= 0
      ? '<button type="button" class="bk-chip" data-it="' + esc(p.code) + '" title="' + esc(p.name || p.code) + '">' + label + '</button>'
      : '<span class="bk-chip" title="' + esc(p.name || p.code) + '">' + label + '</span>';
  }

  async function copyCard() {
    var x = ix(), d = x ? X().detail(x, RES, ST, S.code) : null;
    var c = d ? FIRE.card(d.long || d.sku, { sku: d.sku, loc: S.loc }) : null;
    if (!c) return;
    var head = ['วันที่', 'เลขที่', 'ประเภท', 'SKU', 'SKU เต็ม', 'LOT', 'PO', 'จากโล', 'ไปโล', 'เข้า', 'ออก', 'คงเหลือ', 'ผู้ลง', 'Note', 'สถานะใบ'];
    var lines = c.rows.map(function (r) {
      return [r.date, r.no, r.type, d.sku, d.long, r.lot, r.po, r.from, r.to,
        r.kind === 'in' || r.kind === 'move' ? r.qty : '', r.kind === 'out' || r.kind === 'move' ? r.qty : '', r.bal, r.who, r.note,
        r.voided ? 'ยกเลิก' : r.rev ? 'กลับรายการ' : ''].map(function (v) { return String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' '); }).join('\t');
    });
    var ok = await copyText([head.join('\t')].concat(lines).join('\n'));
    S.note = ok ? { kind: 'ok', html: '✓ คัดลอกสต๊อกการ์ด ' + f(c.rows.length) + ' แถวแล้ว' + (S.loc ? ' (โล ' + esc(S.loc) + ')' : '') + ' วางใน Excel ได้เลย' }
      : { kind: 'bad', html: 'คัดลอกไม่ได้ เบราว์เซอร์ไม่อนุญาต' };
    render();
  }

  /* ── ปุ่มและช่อง ── */

  document.addEventListener('click', function (e) {
    if (!on()) return;
    var t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.it !== undefined) { open(t.dataset.it); return; }
    if (t.dataset.itc) { S.chip = t.dataset.itc; try { localStorage.setItem(CHIP_KEY, S.chip); } catch (err) {} renderResults(); return; }
    if (t.dataset.itloc !== undefined) {
      var L = String(t.dataset.itloc || '').toUpperCase();
      S.loc = S.loc === L ? '' : L; S.more = CARD_STEP; S.note = null;
      render();
      return;
    }
    if (t.dataset.itmore) { S.more += CARD_STEP * 2; render(); return; }
    if (t.id === 'itBack') { open(''); return; }
    if (t.id === 'itCopy') { copyCard(); return; }
  });

  document.addEventListener('input', function (e) {
    if (!on() || e.target.id !== 'itQ') return;
    S.q = e.target.value;
    clearTimeout(TYPING);
    TYPING = setTimeout(function () { renderResults(); }, 160);
  });

  document.addEventListener('keydown', function (e) {
    if (!on() || e.key !== 'Enter' || e.target.id !== 'itQ') return;
    e.preventDefault();
    S.q = e.target.value;
    var x = ix();
    if (!x) return;
    var q = S.q.trim().toUpperCase();
    /* รหัสตรงตัว (สแกนบาร์โค้ด) หรือเหลือ SKU เดียว = เปิดเลย */
    var exact = q && ST.code(q) >= 0 ? q : '';
    var r = X().search(x, S.q, S.chip);
    if (exact && !r.loc) open(exact);
    else if (r.total === 1 && !r.loc) open(r.list[0].long || r.list[0].sku);
    else renderResults(x);
  });

  window.addEventListener('popstate', function () {
    if (!window.BookFire || !USER) return;
    var code = codeFromHash();
    if (code) { S.code = code; S.loc = ''; S.more = CARD_STEP; S.note = null; if (MODE !== 'item') setMode('item'); else render(); return; }
    if (MODE === 'item' && S.code && !/^#doc=/.test(location.hash || '')) { S.code = ''; render(); }
  });

  window.BookItem = {
    render: render,
    /** เปิดหน้าด้วยลิงก์ #sku= */
    fromHash: function () { return !!codeFromHash(); },
    /** ลิงก์ของหน้าที่เปิดอยู่ (กลับจากใบที่เปิดจากสต๊อกการ์ด) */
    hash: function () { return S.code ? '#sku=' + encodeURIComponent(S.code) : ''; },
    open: open,
    view: view,
    find: find,
  };
})();
