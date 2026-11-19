/**
 * @file wms-fire.js — ระบบใหม่บน Firebase ขั้น 1: store (จริง/จำลอง) ล็อกอิน สำเนาในเครื่อง และ op แบบ book-api
 *
 *   store   interface เดียว: get, getMany, docsAfter, tx, commit, onMeta, setUser, stats
 *           memStore()        ในหน่วยความจำ ทำตัวแบบ Firestore: transaction ลองใหม่เมื่อชน, สร้างได้อย่างเดียว, เช็คสิทธิ์แบบ firestore.rules
 *           firestoreStore()  Firestore จริง โหลด SDK จาก www.gstatic.com (ใช้เฉพาะเว็บที่ deploy ห้ามเรียกจากเทสต์และ dev)
 *   auth    fakeAuth() เลือกบัญชีทดลอง · googleAuth() ป๊อปอัป Google ของบริษัท (signInWithPopup + hd)
 *   cache   memCache() · idbCache() สำเนาใน IndexedDB ต่อท้ายเฉพาะเอกสารใหม่
 *   open()  ตัวสมุด: login, sync (ดึงเฉพาะเอกสารใหม่ ยอดต่อกองคิดในเครื่อง), fifo() รูป tx-fifo, post('bk-…') คำตอบรูปเดิม
 *
 * ตรรกะทั้งหมดอยู่ใน wms-fire-core.js (ต้องโหลดก่อน) โหลดเป็น classic script เปิดเป็น window.WmsFire
 */
(function () {
  'use strict';

  var C = window.WmsFireCore;
  var SDK_V = '12.4.0';   // ตรึงรุ่น Firebase JS SDK
  var SDK_URL = 'https://www.gstatic.com/firebasejs/' + SDK_V + '/';
  var TX_TRIES = 5;       // transaction ชนกันลองใหม่กี่ครั้ง (แบบ Firestore)
  var STALE_TRIES = 4;    // สำเนาในเครื่องตามไม่ทันระหว่างบันทึก ดึงใหม่แล้วลองกี่ครั้ง
  var PAGE = 300;         // เอกสารต่อการดึงหนึ่งครั้ง
  var MASTERS = ['conv', 'sup', 'cap'];
  var ROLE_TH = { head: C.ROLE_HEAD, staff: C.ROLE_USER, viewer: C.ROLE_VIEW };
  var NO_RIGHT = 'บัญชีนี้ยังไม่มีสิทธิ์ ติดต่อหัวหน้า Inventory ให้เพิ่มชื่อในหน้าตั้งค่า';

  function clone(o) { return o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)); }
  function pad2(n) { return (+n < 10 ? '0' : '') + (+n); }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  /* ── สิทธิ์แบบ firestore.rules (store จำลองใช้ ตัวจริงเช็คที่ Rules) ─────── */

  var TR_KEYS = ['tr', 'trState', 'trBy', 'trAt'];
  /** เพดานการอ่านเอกสารประกอบของ Rules (get / getAfter / exists) ต่อคำขอ: เขียนเอกสารเดียว 10 · transaction หรือ batch 20 นับรวมทุกเอกสาร */
  var RULE_CALLS_ONE = 10;
  var RULE_CALLS_MANY = 20;

  /**
   * ชุดเขียนหนึ่งชุด (transaction หรือ batch) ผ่านกฎไหม '' = ผ่าน
   * เช็คทีละเอกสารแบบเดียวกับ firestore.rules (แต่ละเอกสารเห็นแค่ของตัวเองก่อนเขียน กับของอื่นหลังเขียนผ่าน getAfter)
   * และนับการอ่านเอกสารประกอบแบบที่ Rules จริงใช้ ตามตารางใน firestore.rules
   * u = {email, verified} · before = ข้อมูลก่อนเขียน { path: data } · writes = [[path, data]] · now = เวลาเซิร์ฟเวอร์ (ms)
   */
  function rulesError(u, before, writes, domain, now) {
    if (!u || !u.email) return 'ยังไม่ได้ล็อกอิน';
    if (!u.verified) return 'อีเมลยังไม่ยืนยัน';
    var email = String(u.email).toLowerCase();
    if (domain && email.slice(-(domain.length + 1)) !== '@' + domain) return 'อีเมลนอกโดเมนบริษัท';
    var me = before['users/' + email];
    if (!me || me.active !== true) return NO_RIGHT;
    var after = {};
    Object.keys(before).forEach(function (p) { after[p] = before[p]; });
    writes.forEach(function (w) { after[w[0]] = w[1]; });
    var ma = after['meta/head'] || null;
    var head = me.role === 'head', staff = head || me.role === 'staff';
    var month = C.yymm(now), calls = 0;
    for (var i = 0; i < writes.length; i++) {
      var path = writes[i][0], d = writes[i][1], seg = path.split('/'), col = seg[0], id = seg[1], old = before[path];
      if (seg.length !== 2) return 'ที่เขียนไม่ถูก ' + path;
      calls += 1;   // get(users/{อีเมล}) ทุกเอกสาร
      if (col === 'users' || col === 'master' || col === 'trc') { if (!head) return 'เขียน ' + col + ' ได้เฉพาะหัวหน้า'; continue; }
      if (!staff) return 'บัญชีนี้ดูได้อย่างเดียว';
      if (col === 'docs') {
        if (old) {
          var changed = Object.keys(d).concat(Object.keys(old)).filter(function (k) { return JSON.stringify(d[k]) !== JSON.stringify(old[k]); });
          if (changed.some(function (k) { return TR_KEYS.indexOf(k) < 0; }) || d.trBy !== email) return 'เอกสารแก้ได้เฉพาะเลข TRcloud';
          continue;
        }
        calls += 1;   // getAfter(meta/head)
        /* เอกสารหลัก: meta.last = เอกสารนี้ แปลว่า meta ถูกเขียนในคำขอเดียวกัน เพราะเอกสารเดิมสร้างซ้ำไม่ได้
           ส่วนแยก: meta.at = เวลาของคำขอนี้ (เวลาเซิร์ฟเวอร์) แปลว่า meta เพิ่ง seq +1 ในคำขอนี้ ไม่ใช่เติมส่วนให้เอกสารเก่า */
        if (d.of) {
          if (!ma || ma.at !== C.TIME || ma.last !== d.of || ma.seq !== d.seq || d.of + '~' + d.i !== id) return 'ส่วนแยกของเอกสารไม่ตรงกับเอกสารหลัก';
          continue;
        }
        if (!ma || ma.seq !== d.seq) return 'เอกสารใหม่ต้องมากับ meta ที่ seq เพิ่ม 1';
        if (ma.last !== id) return 'meta.last ไม่ใช่เอกสารนี้';
        if (d.by !== email) return 'by ต้องเป็นอีเมลคนที่ล็อกอิน';
        if (d.at !== C.TIME) return 'at ต้องเป็นเวลาเซิร์ฟเวอร์';
        if (C.HEAD_TYPES.indexOf(d.type) >= 0 ? !head : C.STAFF_TYPES.indexOf(d.type) < 0) return 'ประเภท ' + d.type + ' ลงไม่ได้ด้วยสิทธิ์นี้';
        if (ma.month !== month || d.no !== 'T' + month + '-' + pad4(ma.next - 1)) return 'เลขเอกสารไม่ตรงกับเดือนของเซิร์ฟเวอร์';
        continue;
      }
      if (col === 'meta') {
        if (id !== 'head') return 'meta มีแค่ head';
        var mb = old || null;
        if (!mb || d.seq !== mb.seq) {
          if (d.seq !== (mb ? +mb.seq || 0 : 0) + 1) return 'meta seq ต้องเพิ่มทีละ 1 (เอกสารใหม่ต้องมากับ meta ที่ seq เพิ่ม 1)';
          calls += 1;   // getAfter(docs/{meta.last})
          var last = after['docs/' + d.last];
          if (!last || last.seq !== d.seq) return 'meta ต้องมากับเอกสารใหม่ seq เดียวกัน';
          if (d.month !== month || d.next !== (mb && mb.month === month ? +mb.next || 1 : 1) + 1) return 'เลขถัดไปใน meta ไม่ถูก';
          if (d.at !== C.TIME) return 'at ต้องเป็นเวลาเซิร์ฟเวอร์';
          continue;
        }
        if (!head) return 'meta เขียนได้เฉพาะตอนบันทึกเอกสาร';
        var diff = Object.keys(d).concat(Object.keys(mb)).filter(function (k) { return JSON.stringify(d[k]) !== JSON.stringify(mb[k]); });
        if (diff.some(function (k) { return k !== 'mv'; })) return 'หัวหน้าแก้ meta ได้แค่ mv';
        continue;
      }
      return 'เขียน ' + col + ' ไม่ได้';
    }
    var cap = writes.length > 1 ? RULE_CALLS_MANY : RULE_CALLS_ONE;
    if (calls > cap) return 'Rules อ่านเอกสารประกอบ ' + calls + ' ครั้ง เกิน ' + cap + ' ต่อคำขอ';
    return '';
  }

  /* ── store จำลองในหน่วยความจำ ─────────────────────────────────────────── */

  /**
   * opt = { data: { path: data } เริ่มต้น, now(), domain, rules (false = ไม่เช็ค), onCommit(dump) }
   * คืนการเชื่อมต่อหนึ่งเครื่อง · connect() = อีกเครื่องที่ใช้ฐานเดียวกัน (ล็อกอินแยกกันแบบคนละเบราว์เซอร์)
   * hook(fn) ให้ fn ทำงานหนึ่งครั้งก่อน transaction ถัดไป commit (เทสต์สองเครื่องบันทึกชนกัน)
   */
  function memStore(opt) {
    opt = opt || {};
    var now = opt.now || Date.now;
    var docs = {};
    var counts = { reads: 0, writes: 0, tx: 0, retries: 0 };
    var listeners = [];
    var hook = null;
    Object.keys(opt.data || {}).forEach(function (p) { docs[p] = { ver: 1, d: clone(opt.data[p]) }; });

    function snapshot() { var o = {}; Object.keys(docs).forEach(function (p) { o[p] = docs[p].d; }); return o; }
    function read(p) { counts.reads++; return docs[p] ? clone(docs[p].d) : null; }
    function apply(writes) {
      var t = now(), metaHit = false;
      writes.forEach(function (w) {
        var d = clone(w[1]);
        Object.keys(d).forEach(function (k) { if (d[k] === C.TIME) d[k] = t; });
        docs[w[0]] = { ver: (docs[w[0]] ? docs[w[0]].ver : 0) + 1, d: d };
        if (w[0] === 'meta/head') metaHit = true;
      });
      counts.writes += writes.length;
      if (metaHit) listeners.forEach(function (cb) { cb(clone(docs['meta/head'].d)); });
      if (opt.onCommit) opt.onCommit(snapshot());
    }
    /** เช็คแบบ Rules กับข้อมูลก่อนเขียน (at ที่เก็บแล้วเป็นเวลา ส่วนที่ส่งมาเป็นตัวแทนเวลาเซิร์ฟเวอร์) */
    function check(user, writes) {
      if (opt.rules === false) return '';
      return rulesError(user, snapshot(), writes, opt.domain || '', now());
    }
    function denied(why) { var e = new Error('ไม่มีสิทธิ์เขียน: ' + why); e.code = 'permission-denied'; return e; }

    /** หนึ่งเครื่อง = หนึ่งการเชื่อมต่อ ล็อกอินของใครของมัน */
    function client() {
      var user = null;
      return {
        kind: 'mem',
        setUser: function (u) { user = u ? { email: String(u.email || '').toLowerCase(), verified: u.verified !== false } : null; },
        user: function () { return user; },
        get: function (p) { return Promise.resolve(read(p)); },
        getMany: function (ps) { return Promise.resolve(ps.map(read)); },
        docsAfter: function (seq, limit) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && +docs[p].d.seq > seq; })
            .sort(function (a, b) { return docs[a].d.seq - docs[b].d.seq || (a < b ? -1 : 1); }).slice(0, limit || PAGE);
          counts.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        tx: async function (fn) {
          counts.tx++;
          for (var a = 0; a < TX_TRIES; a++) {
            var seen = {}, writes = [];
            var t = {
              get: function (p) { counts.reads++; seen[p] = docs[p] ? docs[p].ver : 0; return Promise.resolve(docs[p] ? clone(docs[p].d) : null); },
              set: function (p, d) { writes.push([p, clone(d)]); },
            };
            var out = await fn(t);
            if (hook) { var h = hook; hook = null; await h(); }
            var clash = Object.keys(seen).some(function (p) { return (docs[p] ? docs[p].ver : 0) !== seen[p]; });
            if (clash) { counts.retries++; continue; }
            if (writes.length) {
              var why = check(user, writes);
              if (why) throw denied(why);
              apply(writes);
            }
            return out;
          }
          throw new Error('บันทึกชนกับเครื่องอื่นเกิน ' + TX_TRIES + ' ครั้ง ลองกดส่งใหม่');
        },
        commit: function (writes) {
          var why = check(user, writes);
          if (why) return Promise.reject(denied(why));
          apply(writes);
          return Promise.resolve();
        },
        onMeta: function (cb) {
          listeners.push(cb);
          return function () { listeners = listeners.filter(function (x) { return x !== cb; }); };
        },
        hook: function (fn) { hook = fn; },
        stats: function () { return clone(counts); },
        dump: snapshot,
        connect: client,
        /** เขียนตรงไม่ผ่านกฎ ใช้ตั้งข้อมูลทดลองเท่านั้น */
        seed: function (data) { Object.keys(data).forEach(function (p) { docs[p] = { ver: (docs[p] ? docs[p].ver : 0) + 1, d: clone(data[p]) }; }); },
      };
    }
    return client();
  }

  /* ── Firestore จริง (เฉพาะเว็บที่ deploy) ─────────────────────────────── */

  var sdk = null;
  function loadSdk() {
    if (!sdk) {
      sdk = Promise.all(['firebase-app', 'firebase-firestore', 'firebase-auth'].map(function (m) { return import(SDK_URL + m + '.js'); }))
        .then(function (mods) { return { app: mods[0], fs: mods[1], auth: mods[2] }; });
    }
    return sdk;
  }

  /** config = Firebase web config ของโปรเจกต์บริษัท · คืน { store, app } หลังโหลด SDK */
  async function firestoreStore(config) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) throw new Error('dev server ห้ามต่อ Firebase จริง ใช้ store จำลอง');
    var m = await loadSdk(), F = m.fs;
    var app = m.app.getApps().length ? m.app.getApp() : m.app.initializeApp(config);
    var db = F.getFirestore(app);
    var counts = { reads: 0, writes: 0, tx: 0, retries: 0 };
    function ref(p) { return F.doc(db, p); }
    function out(snap) {
      counts.reads++;
      if (!snap.exists()) return null;
      var d = snap.data();
      Object.keys(d).forEach(function (k) { if (d[k] && typeof d[k].toMillis === 'function') d[k] = d[k].toMillis(); });
      return d;
    }
    function inn(d) {
      var o = {};
      Object.keys(d).forEach(function (k) { o[k] = d[k] === C.TIME ? F.serverTimestamp() : d[k]; });
      return o;
    }
    var store = {
      kind: 'firestore',
      setUser: function () {},
      get: function (p) { return F.getDoc(ref(p)).then(out); },
      getMany: function (ps) { return Promise.all(ps.map(function (p) { return F.getDoc(ref(p)).then(out); })); },
      docsAfter: function (seq, limit) {
        var q = F.query(F.collection(db, 'docs'), F.where('seq', '>', seq), F.orderBy('seq'), F.limit(limit || PAGE));
        return F.getDocs(q).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      tx: function (fn) {
        counts.tx++;
        return F.runTransaction(db, function (t) {
          return fn({
            get: function (p) { return t.get(ref(p)).then(out); },
            set: function (p, d) { counts.writes++; t.set(ref(p), inn(d)); },
          });
        });
      },
      commit: function (writes) {
        var b = F.writeBatch(db);
        writes.forEach(function (w) { b.set(ref(w[0]), inn(w[1])); });
        counts.writes += writes.length;
        return b.commit();
      },
      onMeta: function (cb) {
        return F.onSnapshot(ref('meta/head'), function (snap) { var d = out(snap); if (d) cb(d); });
      },
      stats: function () { return clone(counts); },
    };
    return { store: store, app: app, sdk: m };
  }

  /* ── ล็อกอิน ──────────────────────────────────────────────────────────── */

  /** บัญชีทดลอง (dev / เทสต์) list = [{email, name}] */
  function fakeAuth(list) {
    var cur = null;
    return {
      kind: 'fake',
      list: function () { return (list || []).slice(); },
      current: function () { return cur; },
      signIn: function (email) {
        var e = String(email || '').toLowerCase();
        cur = { email: e, verified: true, name: ((list || []).filter(function (x) { return x.email === e; })[0] || {}).name || e };
        return Promise.resolve(cur);
      },
      signOut: function () { cur = null; return Promise.resolve(); },
    };
  }

  /** Google ของบริษัท ป๊อปอัปเท่านั้น (redirect พังบน GitHub Pages) · domain = โดเมนอีเมลบริษัท */
  function googleAuth(fire, domain) {
    var a = fire.sdk.auth, auth = a.getAuth(fire.app), cur = null;
    return {
      kind: 'google',
      current: function () { return cur; },
      ready: function () {
        return new Promise(function (res) {
          var off = a.onAuthStateChanged(auth, function (u) {
            off();
            cur = u ? { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified, name: u.displayName || u.email } : null;
            res(cur);
          });
        });
      },
      signIn: function () {
        var p = new a.GoogleAuthProvider();
        p.setCustomParameters(domain ? { hd: domain, prompt: 'select_account' } : { prompt: 'select_account' });
        return a.signInWithPopup(auth, p).then(function (r) {
          var u = r.user;
          cur = { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified, name: u.displayName || u.email };
          return cur;
        });
      },
      signOut: function () { cur = null; return a.signOut(auth); },
    };
  }

  /* ── สำเนาในเครื่อง ──────────────────────────────────────────────────── */

  function emptyLocal() { return { v: C.V, seq: 0, meta: null, docs: [], piles: {}, master: {}, mv: -1 }; }

  function memCache() {
    var saved = null;
    return {
      load: function () { return Promise.resolve(saved ? clone(saved) : null); },
      put: function (local) { saved = clone(local); return Promise.resolve(); },
      clear: function () { saved = null; return Promise.resolve(); },
    };
  }

  /** IndexedDB: เอกสารเก็บทีละรายการ (ต่อท้ายเฉพาะของใหม่) ที่เหลือเก็บเป็นก้อนเดียว */
  function idbCache(name) {
    var dbp = null;
    function db() {
      if (!dbp) {
        dbp = new Promise(function (res, rej) {
          var r = indexedDB.open(name || 'wms-fire', 1);
          r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('docs', { keyPath: 'id' }); d.createObjectStore('kv'); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      }
      return dbp;
    }
    function done(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error); }; }); }
    function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
    return {
      load: async function () {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readonly');
        var kv = await req(tx.objectStore('kv').get('state'));
        var list = await req(tx.objectStore('docs').getAll());
        if (!kv) return null;
        kv.docs = list.sort(function (a, b) { return a.seq - b.seq; });
        return kv;
      },
      put: async function (local, added) {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readwrite'), ds = tx.objectStore('docs');
        (added || local.docs).forEach(function (x) { ds.put(x); });
        tx.objectStore('kv').put({ v: local.v, seq: local.seq, meta: local.meta, piles: local.piles, master: local.master, mv: local.mv }, 'state');
        return done(tx);
      },
      clear: async function () {
        var d = await db(), tx = d.transaction(['docs', 'kv'], 'readwrite');
        tx.objectStore('docs').clear();
        tx.objectStore('kv').clear();
        return done(tx);
      },
    };
  }

  /* ── ตัวสมุด ──────────────────────────────────────────────────────────── */

  /**
   * opt = { store, auth, cache, now(), partBytes, onChange(meta) }
   * คืน fire: login, logout, sync, fifo, post, local, user, watch, usage
   */
  function open(opt) {
    var store = opt.store, auth = opt.auth || fakeAuth([]), cache = opt.cache || memCache();
    var now = opt.now || Date.now;
    var local = emptyLocal(), loaded = false, user = null, syncing = null;

    function reply(o) { if (o && typeof o === 'object' && !Array.isArray(o)) { o.v = C.API_V; if (!o.error) o.app = 'book'; } return o; }
    function fail(msg, extra) { var o = { error: msg }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return reply(o); }

    async function ensureLoaded() {
      if (loaded) return;
      loaded = true;
      try {
        var got = await cache.load();
        if (got && got.v === C.V) local = got;
      } catch (e) { local = emptyLocal(); }
    }

    /** ดึงเฉพาะของใหม่: เอกสารที่ seq ใหม่กว่า (เข้ายอดต่อกองในเครื่องตามลำดับ) master ที่ mv เปลี่ยน */
    async function syncNow() {
      await ensureLoaded();
      var meta = await store.get('meta/head');
      var added = [];
      if (!meta) {
        if (local.seq) { local = emptyLocal(); await cache.clear(); }
        local.meta = null;
        return { seq: 0, added: 0 };
      }
      if (meta.v !== C.V || local.v !== C.V || meta.seq < local.seq) { local = emptyLocal(); try { await cache.clear(); } catch (e) {} }
      var guard = 0;
      while (local.seq < meta.seq && guard++ < 10000) {
        var list = await store.docsAfter(local.seq, PAGE);
        if (!list.length) break;
        var mains = [], parts = {};
        list.forEach(function (x) {
          if (x.data.of) (parts[x.data.of] || (parts[x.data.of] = [])).push(x.data);
          else mains.push(x);
        });
        for (var i = 0; i < mains.length; i++) {
          var m = mains[i], have = parts[m.id] || [], need = (+m.data.part || 1) - 1;
          if (have.length < need) {
            var ids = [];
            for (var k = 2; k <= need + 1; k++) if (!have.some(function (p) { return p.i === k; })) ids.push('docs/' + m.id + '~' + k);
            (await store.getMany(ids)).forEach(function (p) { if (p) have.push(p); });
          }
          var d = C.docIn(m.id, m.data, have);
          local.docs.push(d);
          local.piles = C.applyDoc(local.piles || {}, d);
          added.push(d);
          local.seq = Math.max(local.seq, d.seq);
        }
        if (!mains.length) break;
      }
      if ((+meta.mv || 0) !== local.mv) {
        var ms = await store.getMany(MASTERS.map(function (n) { return 'master/' + n; }));
        local.master = {};
        MASTERS.forEach(function (n, j) { if (ms[j]) local.master[n] = ms[j]; });
        local.mv = +meta.mv || 0;
      }
      local.meta = meta;
      try { await cache.put(local, added); } catch (e) {}
      return { seq: local.seq, added: added.length };
    }

    function sync() {
      if (!syncing) syncing = syncNow().finally(function () { syncing = null; });
      return syncing;
    }

    async function login(email) {
      var u = typeof email === 'string' ? await auth.signIn(email) : await auth.signIn();
      store.setUser(u);
      var prof = await store.get('users/' + u.email);
      if (!prof || prof.active !== true) { user = null; store.setUser(null); return fail(NO_RIGHT); }
      user = { email: u.email, name: prof.name || u.name || u.email, role: prof.role === 'head' || prof.role === 'staff' ? prof.role : 'viewer' };
      return reply({ who: user.name, role: ROLE_TH[user.role], mode: 'book', email: user.email });
    }

    function logout() { user = null; store.setUser(null); return auth.signOut(); }

    function docByNo(no) { return local.docs.filter(function (d) { return d.no === no; })[0] || null; }

    /** บันทึกหนึ่งชุด = transaction เดียว: อ่าน meta + docs/{รหัสชุด} เช็คกับสำเนาในเครื่อง (seq ตรงแล้ว) แล้วเขียนเอกสาร + meta */
    async function save(op, body) {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      var spec = C.OPS[op];
      if (user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      if (spec.head && user.role !== 'head') return fail(op === 'bk-void' ? 'ยกเลิกชุดได้เฉพาะหัวหน้ากับรองหัวหน้า' : 'คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
      var P = C.prep(op, body, now());
      if (P.error) return reply(P);
      await sync();
      for (var tries = 0; tries < STALE_TRIES; tries++) {
        var res;
        try {
          res = await store.tx(async function (t) {
            var meta = await t.get('meta/head');
            var had = await t.get('docs/' + P.batch);
            if (had) return { again: had };
            if ((meta ? +meta.seq || 0 : 0) !== local.seq) return { stale: true };
            var pl = C.plan(P, { meta: meta, local: local, user: user, now: now(), partBytes: opt.partBytes });
            if (pl.error) return { fail: pl };
            pl.writes.forEach(function (w) { t.set(w[0], w[1]); });
            return { plan: pl };
          });
        } catch (e) {
          return fail(String(e && e.message || e));
        }
        if (res.stale) { await sync(); continue; }
        if (res.again) {
          if (op === 'bk-void') return fail(P.voidNo + ' ถูกยกเลิกไปแล้ว');
          await sync();
          var vd = C.voids(local)[res.again.no];
          return reply({ doc: res.again.no, again: true, at: res.again.stamp, status: vd ? vd.status : '', book: 1 });
        }
        if (res.fail) return reply(res.fail);
        var pl = res.plan;
        local.docs.push(pl.doc);
        local.seq = pl.meta.seq;
        local.meta = clone(pl.meta);
        local.meta.at = now();
        local.piles = C.applyDoc(local.piles || {}, pl.doc);
        try { await cache.put(local, [pl.doc]); } catch (e) {}
        return reply(pl.reply);
      }
      return fail('มีคนบันทึกพร้อมกันหลายครั้ง ลองกดส่งใหม่');
    }

    /** op แบบ bookPost ของหน้า book */
    async function post(op, body) {
      body = body || {};
      try {
        if (op === 'bk-login') return user ? reply({ who: user.name, role: ROLE_TH[user.role], mode: 'book', email: user.email }) : fail('ยังไม่ได้ล็อกอิน');
        if (C.OPS[op]) return await save(op, body);
        if (!user) return fail('ยังไม่ได้ล็อกอิน');
        await sync();
        var t = now();
        if (op === 'bk-state') return reply(C.state(local, t));
        if (op === 'bk-stock') return reply(C.stock(local));
        if (op === 'bk-recent') return reply(C.recent(local, body, t));
        if (op === 'bk-seen') return reply(C.seen(local, body, t));
        if (op === 'bk-find') return reply(C.find(local, body, t));
        if (op === 'bk-rebuild') return user.role === 'head' ? reply(C.rebuild(local)) : fail('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
        if (op === 'bk-mode') return body.mode === 'book' ? reply({ mode: 'book', same: true }) : fail('ระบบใหม่ลงสมุดตรงเสมอ ไม่มีโหมดคัดลอก');
        if (op === 'bk-backup') return fail('ระบบใหม่สำรองทุกคืนด้วย fire-backup.gs');
        return fail('ไม่รู้จักคำสั่งนี้');
      } catch (e) {
        return fail(String(e && e.message || e));
      }
    }

    return {
      store: store, auth: auth,
      login: login, logout: logout, sync: sync, post: post,
      user: function () { return user; },
      local: function () { return local; },
      fifo: function () { return C.fifo(local, now()); },
      /** มีคนบันทึกจากเครื่องอื่น (meta เปลี่ยน) → cb(meta) */
      watch: function (cb) {
        return store.onMeta(function (meta) { if (meta && +meta.seq !== local.seq) cb(meta); });
      },
      usage: function () { return store.stats(); },
    };
  }

  window.WmsFire = {
    SDK_V: SDK_V,
    memStore: memStore, firestoreStore: firestoreStore, rulesError: rulesError,
    fakeAuth: fakeAuth, googleAuth: googleAuth, memCache: memCache, idbCache: idbCache,
    open: open,
  };
})();
