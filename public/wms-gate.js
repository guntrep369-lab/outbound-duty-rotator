/**
 * @file wms-gate.js — opening animation + per-user sign-in shown before the app.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THIS IS A DOORPLATE, NOT A LOCK.
 *
 *  The site is static on GitHub Pages, so everything here runs in the browser
 *  and anyone can delete the overlay from the DOM to get past it. Accounts are
 *  stored in localStorage, which means they live PER DEVICE PER BROWSER: a code
 *  created on the office PC does not exist on someone's phone.
 *
 *  What actually keeps the roster private is the GitHub token: without a valid
 *  PAT the app shows local demo data and no real employee records. Treat this
 *  screen as "who is using this machine", not as access control. Real
 *  protection needs something in FRONT of the site (Cloudflare Access or
 *  similar) — it cannot be built inside a static page.
 *
 *  Passcodes are still salted and hashed rather than stored raw. Not because
 *  that makes this secure, but because people reuse codes they use elsewhere,
 *  and a plaintext one sitting in localStorage would leak beyond this app.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Loaded as a classic script in <head> so it can lock the page before the app
 * paints. Works for the React module and the static tools alike, because it
 * paints an overlay above them rather than integrating with either.
 */
(function () {
  'use strict';

  var USERS_KEY = 'wms:users';
  var SESSION_KEY = 'wms:session';
  var SESSION_HOURS = 12; // a shift's length — a shared PC shouldn't stay open overnight
  var INTRO_MS = 2200;
  var MIN_CODE = 4;

  /* ── Storage ───────────────────────────────────────────────────────────── */
  function readUsers() {
    try {
      var u = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return Array.isArray(u) ? u.filter(function (x) { return x && x.name && x.hash; }) : [];
    } catch (e) {
      return [];
    }
  }

  function writeUsers(users) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
      return true;
    } catch (e) {
      return false; // private mode / quota — caller reports it
    }
  }

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
    } catch (e) {}
  }

  /* ── Passcode hashing ──────────────────────────────────────────────────── */
  function randomSalt() {
    var a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = (Math.random() * 256) | 0; });
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /**
   * SHA-256 of salt+code. Needs a secure context (https or localhost), which is
   * where this app runs; if it is ever served over plain http the fallback keeps
   * the gate working, and the comment at the top explains why that is tolerable.
   */
  function hashCode(code, salt) {
    var subtle = (window.crypto || {}).subtle;
    if (!subtle) {
      var h = 2166136261; // FNV-1a — obfuscation only, not a digest
      var s = salt + code;
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      return Promise.resolve('fnv:' + h.toString(16));
    }
    return subtle.digest('SHA-256', new TextEncoder().encode(salt + code)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  var sameName = function (a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); };

  /* ── Public surface ────────────────────────────────────────────────────── */
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

    /* ── จัดการผู้ใช้จากหน้าตั้งค่า ─────────────────────────────────────────
       เปิดออกมาแทนที่จะให้หน้าตั้งค่าอ่าน localStorage เอง เพราะการสร้างรหัส
       ต้องใช้ salt และวิธี hash ชุดเดียวกับตอนล็อกอินเป๊ะ ๆ ถ้าสองที่คำนวณ
       ต่างกันแม้นิดเดียว จะได้ผู้ใช้ที่สร้างสำเร็จแต่ล็อกอินไม่ได้ */

    /** รายชื่อผู้ใช้ — ไม่คืน salt/hash ออกไป หน้าอื่นไม่มีเหตุต้องเห็น */
    users: function () {
      return readUsers().map(function (u) {
        return { name: u.name, createdAt: u.createdAt || 0 };
      });
    },

    /** @returns {Promise<{ok:boolean, error?:string}>} */
    addUser: function (name, code) {
      name = String(name == null ? '' : name).trim();
      code = String(code == null ? '' : code);
      if (!name) return Promise.resolve({ ok: false, error: 'ใส่ชื่อก่อน' });
      if (code.length < MIN_CODE) {
        return Promise.resolve({ ok: false, error: 'รหัสต้องยาวอย่างน้อย ' + MIN_CODE + ' ตัว' });
      }
      var users = readUsers();
      var taken = users.some(function (u) { return sameName(u.name, name); });
      if (taken) return Promise.resolve({ ok: false, error: 'มีชื่อนี้อยู่แล้ว' });

      var salt = randomSalt();
      return hashCode(code, salt).then(function (h) {
        var ok = writeUsers(users.concat([{ name: name, salt: salt, hash: h, createdAt: Date.now() }]));
        return ok ? { ok: true } : { ok: false, error: 'บันทึกไม่ได้ (พื้นที่เต็มหรือโหมดส่วนตัว)' };
      });
    },

    /** @returns {{ok:boolean, error?:string}} */
    removeUser: function (name) {
      var users = readUsers();
      var left = users.filter(function (u) { return !sameName(u.name, name); });
      if (left.length === users.length) return { ok: false, error: 'ไม่พบชื่อนี้' };
      return writeUsers(left) ? { ok: true } : { ok: false, error: 'บันทึกไม่ได้' };
    },
  };

  if (readSession()) return; // already signed in — no intro, straight to work

  // Hide the app immediately, before it has a chance to paint behind the gate.
  document.documentElement.classList.add('wms-locked');

  /* ── Markup ────────────────────────────────────────────────────────────── */
  var WAREHOUSE_ICON =
    '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>' +
    '<path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function introHTML() {
    return (
      '<div class="gate-intro">' +
      '<svg class="gate-svg" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<line class="gate-belt" x1="20" y1="112" x2="180" y2="112" stroke="#334155" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="38" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      '<circle cx="100" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      '<circle cx="162" cy="122" r="7" fill="none" stroke="#334155" stroke-width="2.5"/>' +
      '<g class="gate-box gate-box-1"><rect x="52" y="84" width="26" height="24" rx="3" fill="#4F46E5"/><line x1="65" y1="84" x2="65" y2="108" stroke="#A5B4FC" stroke-width="2"/></g>' +
      '<g class="gate-box gate-box-2"><rect x="86" y="84" width="26" height="24" rx="3" fill="#6366F1"/><line x1="99" y1="84" x2="99" y2="108" stroke="#C7D2FE" stroke-width="2"/></g>' +
      '<g class="gate-box gate-box-3"><rect x="120" y="84" width="26" height="24" rx="3" fill="#818CF8"/><line x1="133" y1="84" x2="133" y2="108" stroke="#E0E7FF" stroke-width="2"/></g>' +
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

  function header(sub) {
    return (
      '<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      WAREHOUSE_ICON +
      '</svg></div>' +
      '<h1>WMS Management <span>by Gun</span></h1>' +
      '<p class="hello">' + sub + '</p>'
    );
  }

  function loginHTML(users) {
    return (
      '<div class="gate-login">' +
      header('เลือกชื่อของคุณ แล้วใส่รหัสเพื่อเข้าใช้งาน') +
      '<form id="gate-form" autocomplete="off">' +
      '<div class="gate-field"><label for="gate-who">ชื่อในระบบ</label>' +
      '<select id="gate-who">' +
      users.map(function (u) { return '<option value="' + esc(u.name) + '">' + esc(u.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="gate-field"><label for="gate-code">รหัสของคุณ</label>' +
      '<input id="gate-code" type="password" placeholder="••••••" autocomplete="off"></div>' +
      '<button class="gate-btn" type="submit">เข้าใช้งาน</button>' +
      '<div class="gate-err" id="gate-err"></div>' +
      '</form>' +
      '<button class="gate-link" id="gate-to-register" type="button">＋ สร้างรหัสใหม่</button>' +
      '<p class="gate-note">รหัสเก็บไว้ในเครื่องนี้เท่านั้น · ลืมรหัสให้สร้างชื่อใหม่ได้เลย</p>' +
      '</div>'
    );
  }

  function registerHTML(hasUsers) {
    return (
      '<div class="gate-login">' +
      header('ตั้งชื่อและรหัสของคุณเอง ใช้เข้าระบบครั้งต่อไป') +
      '<form id="gate-form" autocomplete="off">' +
      '<div class="gate-field"><label for="gate-name">ชื่อที่จะใช้ในระบบ</label>' +
      '<input id="gate-name" type="text" placeholder="เช่น กัน" autocomplete="off"></div>' +
      '<div class="gate-field"><label for="gate-code">ตั้งรหัส (อย่างน้อย ' + MIN_CODE + ' ตัว)</label>' +
      '<input id="gate-code" type="password" placeholder="••••••" autocomplete="new-password"></div>' +
      '<div class="gate-field"><label for="gate-code2">ยืนยันรหัสอีกครั้ง</label>' +
      '<input id="gate-code2" type="password" placeholder="••••••" autocomplete="new-password"></div>' +
      '<button class="gate-btn" type="submit">สร้างรหัส แล้วเข้าใช้งาน</button>' +
      '<div class="gate-err" id="gate-err"></div>' +
      '</form>' +
      (hasUsers ? '<button class="gate-link" id="gate-to-login" type="button">← กลับไปหน้าเข้าใช้งาน</button>' : '') +
      '<p class="gate-note">รหัสถูกเข้ารหัสก่อนเก็บ และเก็บไว้ในเครื่องนี้เท่านั้น<br>อย่าใช้รหัสเดียวกับบัญชีอื่นของคุณ</p>' +
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

    function unlock(name) {
      writeSession(name);
      gate.classList.add('opening');
      document.documentElement.classList.remove('wms-locked');
      setTimeout(function () { gate.remove(); }, 450);
    }

    var fail = function (msg, focusId) {
      stage.querySelector('#gate-err').textContent = msg;
      if (focusId) {
        var el = stage.querySelector(focusId);
        if (el) { el.value = ''; el.focus(); }
      }
    };

    function showLogin() {
      var users = readUsers();
      if (!users.length) return showRegister();
      stage.innerHTML = loginHTML(users);
      stage.querySelector('#gate-code').focus();
      stage.querySelector('#gate-to-register').addEventListener('click', showRegister);
      stage.querySelector('#gate-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = stage.querySelector('#gate-who').value;
        var user = users.filter(function (u) { return sameName(u.name, name); })[0];
        if (!user) return fail('ไม่พบชื่อนี้ในเครื่องนี้');
        hashCode(stage.querySelector('#gate-code').value, user.salt).then(function (h) {
          if (h !== user.hash) return fail('รหัสไม่ถูกต้อง', '#gate-code');
          unlock(user.name);
        });
      });
    }

    function showRegister() {
      var users = readUsers();
      stage.innerHTML = registerHTML(users.length > 0);
      stage.querySelector('#gate-name').focus();
      var back = stage.querySelector('#gate-to-login');
      if (back) back.addEventListener('click', showLogin);

      stage.querySelector('#gate-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = stage.querySelector('#gate-name').value.trim();
        var code = stage.querySelector('#gate-code').value;
        var code2 = stage.querySelector('#gate-code2').value;

        if (!name) return fail('กรุณากรอกชื่อที่จะใช้ในระบบ');
        if (users.some(function (u) { return sameName(u.name, name); })) return fail('ชื่อนี้ถูกใช้ไปแล้วในเครื่องนี้');
        if (code.length < MIN_CODE) return fail('รหัสต้องยาวอย่างน้อย ' + MIN_CODE + ' ตัว');
        if (code !== code2) return fail('รหัสสองช่องไม่ตรงกัน', '#gate-code2');

        var salt = randomSalt();
        hashCode(code, salt).then(function (h) {
          var ok = writeUsers(users.concat([{ name: name, salt: salt, hash: h, createdAt: Date.now() }]));
          if (!ok) return fail('บันทึกไม่ได้ — เบราว์เซอร์ปิดการเก็บข้อมูลไว้');
          unlock(name);
        });
      });
    }

    function advance() {
      if (advanced) return;
      advanced = true;
      var intro = stage.querySelector('.gate-intro');
      intro.classList.add('leaving');
      setTimeout(showLogin, 380);
      gate.removeEventListener('click', advance);
      document.removeEventListener('keydown', advance);
    }

    gate.addEventListener('click', advance);
    document.addEventListener('keydown', advance);
    setTimeout(advance, INTRO_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
