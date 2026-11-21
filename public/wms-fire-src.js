/**
 * @file wms-fire-src.js — หน้ารายงานอ่านสมุดจากระบบใหม่ แทน tx-api.gs (ชีต Transaction เดิม)
 *
 * โหลดต่อจาก wms-settings.js wms-gas.js wms-fire-config.js book/book-fire.js
 * ระบบใหม่เปิดอยู่ (window.BookFire มีค่า: สวิตช์เปิด · ?fire=demo · ?fire=dev บน localhost) →
 *   - WmsSettings.txUrl() ของหน้านี้ = 'fire:tx' หน้ารายงานไม่ต้องมี URL Transaction อีก
 *   - WmsGas.json / post ที่ส่งไป 'fire:tx' มาที่ไฟล์นี้ (ดู wms-gas.js) คิดคำตอบรูปเดิมจากสำเนาในเครื่อง:
 *       tx-fifo     WmsFireCore.fifo        tx-summary  WmsFireTx.summary
 *       tx-daily    WmsFireTx.daily         tx-history  WmsFireTx.history
 *       shared-at   ป้ายข้อมูลกลาง: มีเอกสารใหม่ = บอกหน้าว่ามีชุดใหม่ให้โหลด
 *       shared-fresh (กดดึงใหม่) ของ 4 อย่างข้างบน = ดึงเอกสารใหม่แล้วคิดใหม่
 *   - คำสั่งอื่น (นับสต๊อกรายวัน tx-count count-save …) ยังส่งไปสคริปต์เดิมถ้าเครื่องนี้ตั้ง URL ไว้
 *   - แถบบนสุดบอกว่าอ่านจากระบบใหม่ ยังไม่เข้าระบบ = ปุ่มเข้าสู่ระบบ (บัญชีเดียวกับหน้าสมุดสต๊อก)
 * ระบบใหม่ปิด = window.WmsFireSrc = null ทุกอย่างเหมือนเดิม
 */
(function () {
  'use strict';

  var F = window.BookFire;
  if (!F) { window.WmsFireSrc = null; return; }

  var URL = 'fire:tx';
  var NEED = 'ยังไม่ได้เข้าสู่ระบบใหม่ — กดปุ่ม เข้าสู่ระบบ ที่แถบบนสุด';
  var OLD_ONLY = 'ส่วนนี้ยังใช้สคริปต์เดิม (tx-api.gs) — ใส่ URL Transaction ในหน้าตั้งค่า';
  var NAMES = { 'tx-fifo': 1, 'tx-summary': 1, 'tx-daily': 1, 'tx-history': 1 };

  var S = window.WmsSettings;
  var realTx = S && S.txUrl ? S.txUrl.bind(S) : function () { return ''; };
  if (S) S.txUrl = function () { return URL; };

  var who = null, tried = null, done = false, why = '';   // done = เช็คบัญชีที่ค้างไว้เสร็จแล้ว
  var held = {}, dirty = {};   // ชุดที่หน้านี้โหลดไปแล้ว (ชื่อ → ช่วงวันที่) · ชุดที่มีเอกสารใหม่หลังโหลด

  function owns(url) { return String(url || '').indexOf(URL) === 0; }

  /** 'tx-daily&from=…&to=…&shared=1' + พารามิเตอร์ใน URL (?sku=) → { name, p } */
  function parse(url, api) {
    var parts = String(api || '').split('&'), p = {};
    var q = String(url || '').split('?')[1] || '';
    parts.slice(1).concat(q ? q.split('&') : []).forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { try { p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { p[kv.slice(0, i)] = kv.slice(i + 1); } }
    });
    return { name: parts[0], p: p };
  }

  /** เข้าด้วยบัญชีที่ค้างไว้ (ครั้งเดียวต่อหน้า) → ผู้ใช้ หรือ null */
  function ensure() {
    if (!tried) {
      tried = F.restore().then(function (r) {
        done = true;
        who = r && !r.error ? r : null;
        why = r && r.error ? r.error : '';
        paint();
        return who;
      }, function (e) { done = true; who = null; why = String(e && e.message || e); paint(); return null; });
    }
    return tried;
  }

  async function run(name, p, o) {
    var u = await ensure();
    if (!u) return { error: why || NEED, login: 1 };
    if (o && o.onProgress) o.onProgress(0);
    var s = await F.snap();
    held[name] = { from: p.from || '', to: p.to || '' };
    delete dirty[name];
    var C = window.WmsFireCore, T = window.WmsFireTx;
    if (name === 'tx-fifo') return C.fifo(s.local, s.now);
    if (name === 'tx-summary') return T.summary(s.local, s.now);
    if (name === 'tx-daily') return T.daily(s.local, s.now, p.from || '', p.to || '');
    return T.history(s.local, p.sku || '');
  }

  /** ป้ายข้อมูลกลาง: มีเอกสารใหม่หลังหน้านี้โหลด = ทุกชุดที่โหลดไปแล้วมีชุดใหม่ */
  async function status() {
    var out = { app: 'transaction', fire: 1, shared: {}, run: {} };
    if (!who) return out;
    var ch = false;
    try { ch = await F.changed(); } catch (e) { ch = false; }
    if (ch) Object.keys(held).forEach(function (n) { dirty[n] = 1; });
    var at = Date.now() + 1;
    Object.keys(dirty).forEach(function (n) { out.shared[n] = { at: at, params: held[n] }; });
    return out;
  }

  function oldUrl() { return realTx(); }

  async function json(url, api, o) {
    var a = parse(url, api);
    if (a.name === 'shared-at') return status();
    if (NAMES[a.name]) return run(a.name, a.p, o);
    var real = oldUrl();
    if (!real) return { error: OLD_ONLY };
    return window.WmsGas.json(real + String(url).slice(URL.length), api, o);
  }

  async function post(url, body, o) {
    var b = body || {};
    if (b.op === 'shared-fresh' && NAMES[b.api]) return run(b.api, b, o);
    var real = oldUrl();
    if (!real) return { error: OLD_ONLY };
    return window.WmsGas.post(real, b, o);
  }

  /* ── แถบบนสุด ── */

  var bar = null, picking = false;

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function style() {
    if (document.getElementById('fsrcCss')) return;
    var st = document.createElement('style');
    st.id = 'fsrcCss';
    st.textContent = [
      '.fsrc{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:5px 16px;font:12.5px/1.4 var(--wms-font,system-ui,sans-serif);',
      'background:var(--wms-primary-light,#EEF2FF);color:var(--wms-text,#1E293B);border-bottom:1px solid var(--wms-border,#E2E8F0)}',
      '.fsrc b{font-weight:600}.fsrc .fsrc-sub{color:var(--wms-muted,#64748B)}',
      '.fsrc.need{background:#FEF3C7;color:#78350F;border-bottom-color:#FCD34D;font-size:13.5px;padding:8px 16px}',
      '.fsrc button{font:inherit;font-weight:600;padding:4px 12px;border-radius:8px;border:1px solid var(--wms-primary,#4F46E5);',
      'background:var(--wms-primary,#4F46E5);color:#fff;cursor:pointer}',
      '.fsrc button.ghost{background:transparent;color:inherit;border-color:currentColor;font-weight:500}',
      '.fsrc .fsrc-err{color:var(--wms-danger,#E11D48);flex-basis:100%}',
      '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .fsrc{background:#1E1B4B;color:#E2E8F0;border-bottom-color:#312E81}',
      ':root:not([data-theme="light"]) .fsrc .fsrc-sub{color:#94A3B8}',
      ':root:not([data-theme="light"]) .fsrc.need{background:#451A03;color:#FDE68A;border-bottom-color:#92400E}}',
      ':root[data-theme="dark"] .fsrc{background:#1E1B4B;color:#E2E8F0;border-bottom-color:#312E81}',
      ':root[data-theme="dark"] .fsrc .fsrc-sub{color:#94A3B8}',
      ':root[data-theme="dark"] .fsrc.need{background:#451A03;color:#FDE68A;border-bottom-color:#92400E}',
      '@media print{.fsrc{display:none}}',
    ].join('');
    document.head.appendChild(st);
  }

  function modeTag() {
    return F.mode === 'dev' ? ' · <span class="fsrc-sub">🧪 ' + esc(F.label) + ' (ไม่ใช่ข้อมูลจริง)</span>'
      : F.mode === 'demo' ? ' · <span class="fsrc-sub">🎓 ' + esc(F.label) + '</span>' : '';
  }

  function paint() {
    if (!document.body) return;
    style();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fsrc';
      bar.setAttribute('role', 'status');
      document.body.insertBefore(bar, document.body.firstChild);
      bar.addEventListener('click', onClick);
    }
    if (who) {
      bar.className = 'fsrc';
      bar.innerHTML = '📒 <b>อ่านจากระบบใหม่</b>' + modeTag() + ' <span class="fsrc-sub">· ' + esc(who.who || who.email || '') + '</span>';
      return;
    }
    bar.className = 'fsrc need';
    var acc = picking && F.pick ? F.accounts().map(function (a) {
      return '<button class="ghost" data-fsrc-acc="' + esc(a.email) + '">' + esc(a.name) + '</button>';
    }).join('') : '';
    bar.innerHTML = done
      ? '📒 รายงานนี้อ่านจาก<b>ระบบใหม่</b>' + modeTag() + ' — ต้องเข้าสู่ระบบก่อน (บัญชีเดียวกับหน้าสมุดสต๊อก) '
        + (acc || '<button data-fsrc-in>เข้าสู่ระบบ' + (F.pick ? '' : 'ด้วย Google') + '</button>')
        + (why ? '<span class="fsrc-err">' + esc(why) + '</span>' : '')
      : '📒 กำลังเข้า<b>ระบบใหม่</b>…' + modeTag();
  }

  async function signIn(email) {
    var r;
    try { r = await F.signIn(email); } catch (e) { r = { error: String(e && e.message || e) }; }
    if (r && !r.error) { location.reload(); return; }
    why = (r && r.error) || 'เข้าสู่ระบบไม่สำเร็จ';
    picking = false;
    paint();
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-fsrc-in')) {
      if (F.pick) { picking = true; why = ''; paint(); } else signIn();
    } else if (t.hasAttribute('data-fsrc-acc')) {
      signIn(t.getAttribute('data-fsrc-acc'));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(); ensure(); });
  else { paint(); ensure(); }

  window.WmsFireSrc = {
    URL: URL,
    owns: owns,
    json: json,
    post: post,
    status: status,
    parse: parse,
    /** URL Transaction ที่ตั้งไว้ในเครื่องนี้จริง (สำหรับส่วนที่ยังใช้สคริปต์เดิม) */
    oldUrl: oldUrl,
    user: function () { return who; },
    ready: ensure,
  };
})();
