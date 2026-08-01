/**
 * @file wms-gate.js — opening animation + sign-in shown before the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THIS IS A DOORPLATE, NOT A LOCK.
 *
 *  The site is static on GitHub Pages and this repo is public, so PASSCODE
 *  below is readable by anyone who opens the source or presses View Source.
 *  Someone who wants in can also just delete the overlay from the DOM.
 *
 *  What actually keeps the roster private is the GitHub token: without a valid
 *  PAT the app shows local demo data and no real employee records. Treat this
 *  screen as "who's using this machine", not as access control. If you ever
 *  need real protection, put Cloudflare Access (or similar) in front of the
 *  site — it cannot be done from inside a static page.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Loaded as a classic script in <head> so it can lock the page before the app
 * paints. Works for the React module and the static tools alike, because it
 * paints an overlay above them rather than integrating with either.
 */
(function () {
  'use strict';

  /** Shared passcode. Change it here; see the warning above about what it is. */
  var PASSCODE = 'hrz2026';

  /** Blank the passcode to ask only for a name. */
  var NEEDS_CODE = PASSCODE !== '';

  var SESSION_KEY = 'wms:session';
  var SESSION_HOURS = 12; // a shift's length — a shared PC shouldn't stay open overnight
  var INTRO_MS = 2200;

  /* ── Session ───────────────────────────────────────────────────────────── */
  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || !s.name || !s.at) return null;
      if (Date.now() - s.at > SESSION_HOURS * 3600 * 1000) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function writeSession(name) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ name: name, at: Date.now() }));
    } catch (e) {
      /* private mode — the gate still opens, it just won't be remembered */
    }
  }

  // Let the rest of the app ask who is signed in, and offer a way out.
  window.wmsGate = {
    user: function () {
      var s = readSession();
      return s ? s.name : null;
    },
    signOut: function () {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (e) {}
      location.reload();
    },
  };

  if (readSession()) return; // already signed in — no intro, straight to work

  // Hide the app immediately, before it has a chance to paint behind the gate.
  document.documentElement.classList.add('wms-locked');

  /* ── Markup ────────────────────────────────────────────────────────────── */
  var WAREHOUSE_ICON =
    '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>' +
    '<path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>';

  function introHTML() {
    return (
      '<div class="gate-intro">' +
      '<svg class="gate-svg" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      // conveyor belt
      '<line class="gate-belt" x1="20" y1="112" x2="180" y2="112" stroke="#334155" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="38" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      '<circle cx="100" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      '<circle cx="162" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      // parcels riding in
      '<g class="gate-box gate-box-1"><rect x="52" y="84" width="26" height="24" rx="3" fill="#4F46E5"/><line x1="65" y1="84" x2="65" y2="108" stroke="#A5B4FC" stroke-width="2"/></g>' +
      '<g class="gate-box gate-box-2"><rect x="86" y="84" width="26" height="24" rx="3" fill="#6366F1"/><line x1="99" y1="84" x2="99" y2="108" stroke="#C7D2FE" stroke-width="2"/></g>' +
      '<g class="gate-box gate-box-3"><rect x="120" y="84" width="26" height="24" rx="3" fill="#818CF8"/><line x1="133" y1="84" x2="133" y2="108" stroke="#E0E7FF" stroke-width="2"/></g>' +
      // the warehouse mark strokes on above them
      '<g class="gate-mark" transform="translate(76 8) scale(2)" stroke="#A5B4FC" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      WAREHOUSE_ICON +
      '</g>' +
      '</svg>' +
      '<div class="gate-title">WMS Management <span>by Gun</span></div>' +
      '<div class="gate-sub">ระบบบริหารคลังสินค้า</div>' +
      '<div class="gate-skip">แตะที่ใดก็ได้เพื่อข้าม</div>' +
      '</div>'
    );
  }

  function loginHTML() {
    return (
      '<div class="gate-login">' +
      '<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      WAREHOUSE_ICON +
      '</svg></div>' +
      '<h1>WMS Management <span>by Gun</span></h1>' +
      '<p class="hello">ยินดีต้อนรับ · กรอกข้อมูลเพื่อเข้าใช้งาน</p>' +
      '<form id="gate-form" autocomplete="off">' +
      '<div class="gate-field"><label for="gate-name">ชื่อผู้ใช้งาน</label>' +
      '<input id="gate-name" type="text" placeholder="เช่น กัน" autocomplete="off" required></div>' +
      (NEEDS_CODE
        ? '<div class="gate-field"><label for="gate-code">รหัสเข้าใช้งาน</label>' +
          '<input id="gate-code" type="password" placeholder="••••••••" autocomplete="off" required></div>'
        : '') +
      '<button class="gate-btn" type="submit">เข้าใช้งาน</button>' +
      '<div class="gate-err" id="gate-err"></div>' +
      '</form>' +
      '<p class="gate-note">หน้านี้ใช้ระบุผู้ใช้งานในเครื่องนี้เท่านั้น<br>ข้อมูลตารางจริงเข้าถึงได้ด้วย GitHub token ของแต่ละคน</p>' +
      '</div>'
    );
  }

  /* ── Flow ──────────────────────────────────────────────────────────────── */
  function start() {
    var gate = document.createElement('div');
    gate.id = 'wms-gate';
    gate.innerHTML = '<div class="stage">' + introHTML() + '</div>';
    document.body.appendChild(gate);

    var stage = gate.querySelector('.stage');
    var advanced = false;

    function showLogin() {
      if (advanced) return;
      advanced = true;
      var intro = stage.querySelector('.gate-intro');
      intro.classList.add('leaving');
      setTimeout(function () {
        stage.innerHTML = loginHTML();
        var name = stage.querySelector('#gate-name');
        if (name) name.focus();
        stage.querySelector('#gate-form').addEventListener('submit', submit);
      }, 380);
      gate.removeEventListener('click', showLogin);
      document.removeEventListener('keydown', onKey);
    }

    function onKey() {
      showLogin();
    }

    function submit(e) {
      e.preventDefault();
      var name = stage.querySelector('#gate-name').value.trim();
      var err = stage.querySelector('#gate-err');
      if (!name) {
        err.textContent = 'กรุณากรอกชื่อผู้ใช้งาน';
        return;
      }
      if (NEEDS_CODE && stage.querySelector('#gate-code').value !== PASSCODE) {
        err.textContent = 'รหัสเข้าใช้งานไม่ถูกต้อง';
        stage.querySelector('#gate-code').value = '';
        stage.querySelector('#gate-code').focus();
        return;
      }
      writeSession(name);
      gate.classList.add('opening');
      document.documentElement.classList.remove('wms-locked');
      setTimeout(function () {
        gate.remove();
      }, 450);
    }

    gate.addEventListener('click', showLogin);
    document.addEventListener('keydown', onKey);
    setTimeout(showLogin, INTRO_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
