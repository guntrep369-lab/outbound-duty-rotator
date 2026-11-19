/**
 * @file wms-fire.js — ระบบใหม่บน Firebase: store (จริง/จำลอง) ล็อกอิน สำเนาในเครื่อง op แบบ book-api รายชื่อคนใช้ ตัวนับโควตา
 *
 *   store   interface เดียว: get, getMany, docsAfter, list, tx, commit, patch, onMeta, setUser, stats, mine (ของเครื่องนี้)
 *           memStore()        ในหน่วยความจำ ทำตัวแบบ Firestore: transaction ลองใหม่เมื่อชน, สร้างได้อย่างเดียว, เช็คสิทธิ์แบบ firestore.rules
 *           firestoreStore()  Firestore จริง โหลด SDK จาก www.gstatic.com (ใช้เฉพาะเว็บที่ deploy ห้ามเรียกจากเทสต์และ dev)
 *   auth    fakeAuth() เลือกบัญชีทดลอง · googleAuth() ป๊อปอัป Google ของบริษัท (signInWithPopup + hd)
 *   cache   memCache() · idbCache() สำเนาใน IndexedDB ต่อท้ายเฉพาะเอกสารใหม่
 *   open()  ตัวสมุด: login / restore, sync (ดึงเฉพาะเอกสารใหม่ ยอดต่อกองคิดในเครื่อง), fifo() รูป tx-fifo, post('bk-…') คำตอบรูปเดิม
 *           users / saveUser (หัวหน้า), quota() อ่าน/เขียนวันนี้ (เครื่องนี้ + ทุกเครื่องที่ส่งยอดมาที่ use/{วัน}), reload() ล้างสำเนาแล้วดึงใหม่
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
  var ROLES = ['head', 'staff', 'viewer'];
  var LIMITS = { reads: 50000, writes: 20000 };   // โควตาฟรีต่อวันของ Firestore (Spark)
  var LAST_EVERY = 3600000;     // บันทึกเวลาเข้าล่าสุดไม่ถี่กว่าชั่วโมงละครั้ง
  var REPORT_EVERY = 3600000;   // ส่งยอดอ่าน/เขียนของเครื่องนี้ไปรวมที่ use/{วัน} ชั่วโมงละครั้ง

  function clone(o) { return o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)); }
  function diffKeys(a, b) {
    a = a || {}; b = b || {};
    var ks = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ks[k] = 1; });
    return Object.keys(ks);
  }
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
      if (col === 'users') {
        if (head) continue;
        /* ทุกคนแก้ได้แค่เวลาเข้าล่าสุดของตัวเอง เป็นเวลาเซิร์ฟเวอร์ */
        var ch = path === 'users/' + email && old && old.active === true ? diffKeys(d, old) : [];
        if (ch.length === 1 && ch[0] === 'last' && d.last === C.TIME) continue;
        return 'เขียน users ได้เฉพาะหัวหน้า';
      }
      if (col === 'use') {
        /* ยอดอ่าน/เขียนรายวัน ทุกเครื่องเติมช่องของตัวเอง ครั้งละช่องเดียว */
        if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return 'use ต้องเป็นวันที่';
        if (diffKeys(d, old).length !== 1) return 'use แก้ได้ครั้งละเครื่อง';
        continue;
      }
      if (col === 'master' || col === 'trc') { if (!head) return 'เขียน ' + col + ' ได้เฉพาะหัวหน้า'; continue; }
      if (!staff) return 'บัญชีนี้ดูได้อย่างเดียว';
      if (col === 'xfer') {
        /* บันทึกว่าวางแถวลงชีตเดิมแล้ว ครั้งละวันเดียว */
        if (id !== 'log' || diffKeys(d, old).length !== 1) return 'xfer แก้ได้ครั้งละวัน';
        continue;
      }
      if (col === 'docs') {
        if (old) {
          var changed = Object.keys(d).concat(Object.keys(old)).filter(function (k) { return JSON.stringify(d[k]) !== JSON.stringify(old[k]); });
          if (changed.some(function (k) { return TR_KEYS.indexOf(k) < 0; }) || d.trBy !== email) return 'เอกสารแก้ได้เฉพาะเลข TRcloud';
          if (C.TR_STATES.indexOf(d.trState) < 0 || d.trAt !== C.TIME || typeof d.tr !== 'string' || d.tr.length > 100) return 'สถานะ TRcloud ไม่ถูก';
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
          if ((+d.mv || 0) !== (mb ? +mb.mv || 0 : 0) || (+d.tv || 0) !== (mb ? +mb.tv || 0 : 0) || (d.trc || '') !== (mb ? mb.trc || '' : '')) {
            return 'บันทึกเอกสารต้องคง mv tv trc ของ meta เดิม';
          }
          continue;
        }
        var diff = diffKeys(d, mb);
        /* ใส่เลข TRcloud: tv +1 ให้เครื่องอื่นรู้ว่าต้องดึงเลขใหม่ (ทุกคนที่ลงรายการได้) */
        if (diff.length === 1 && diff[0] === 'tv') {
          if (d.tv !== (+mb.tv || 0) + 1) return 'tv ต้องเพิ่มทีละ 1';
          continue;
        }
        if (!head) return 'meta เขียนได้เฉพาะตอนบันทึกเอกสาร';
        if (diff.some(function (k) { return k !== 'mv' && k !== 'trc'; })) return 'หัวหน้าแก้ meta ได้แค่ mv กับ trc';
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
    /* counts = ทั้งฐาน · own = ของเครื่องนั้น (ตัวนับโควตาของเครื่อง) */
    function read(p, own) { counts.reads++; own.reads++; return docs[p] ? clone(docs[p].d) : null; }
    function apply(writes, own) {
      var t = now(), metaHit = false;
      writes.forEach(function (w) {
        var d = clone(w[1]);
        Object.keys(d).forEach(function (k) { if (d[k] === C.TIME) d[k] = t; });
        docs[w[0]] = { ver: (docs[w[0]] ? docs[w[0]].ver : 0) + 1, d: d };
        if (w[0] === 'meta/head') metaHit = true;
      });
      counts.writes += writes.length;
      own.writes += writes.length;
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
      var own = { reads: 0, writes: 0 };
      /** อ่านทั้งคอลเลกชันได้ไหม (แบบ allow list ใน firestore.rules) */
      function listError(col) {
        if (opt.rules === false) return '';
        if (!user) return 'ยังไม่ได้ล็อกอิน';
        var me = docs['users/' + user.email];
        if (!me || me.d.active !== true) return NO_RIGHT;
        if (col === 'users' && me.d.role !== 'head') return 'รายชื่อดูได้เฉพาะหัวหน้า';
        return '';
      }
      return {
        kind: 'mem',
        setUser: function (u) { user = u ? { email: String(u.email || '').toLowerCase(), verified: u.verified !== false } : null; },
        user: function () { return user; },
        get: function (p) { return Promise.resolve(read(p, own)); },
        getMany: function (ps) { return Promise.resolve(ps.map(function (p) { return read(p, own); })); },
        docsAfter: function (seq, limit) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && +docs[p].d.seq > seq; })
            .sort(function (a, b) { return docs[a].d.seq - docs[b].d.seq || (a < b ? -1 : 1); }).slice(0, limit || PAGE);
          counts.reads += Math.max(1, list.length);
          own.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        /** เอกสารที่แก้เลข TRcloud ตั้งแต่เวลา ms (trAt >= ms) [{id, data}] */
        trAfter: function (ms) {
          var list = Object.keys(docs).filter(function (p) { return p.indexOf('docs/') === 0 && typeof docs[p].d.trAt === 'number' && docs[p].d.trAt >= ms; });
          counts.reads += Math.max(1, list.length);
          own.reads += Math.max(1, list.length);
          return Promise.resolve(list.map(function (p) { return { id: p.slice(5), data: clone(docs[p].d) }; }));
        },
        /** ทุกเอกสารในคอลเลกชัน [{id, data}] */
        list: function (col) {
          var why = listError(col);
          if (why) return Promise.reject(denied(why));
          var ps = Object.keys(docs).filter(function (p) { return p.indexOf(col + '/') === 0 && p.split('/').length === 2; }).sort();
          counts.reads += Math.max(1, ps.length);
          own.reads += Math.max(1, ps.length);
          return Promise.resolve(ps.map(function (p) { return { id: p.slice(col.length + 1), data: clone(docs[p].d) }; }));
        },
        tx: async function (fn) {
          counts.tx++;
          for (var a = 0; a < TX_TRIES; a++) {
            var seen = {}, writes = [];
            var t = {
              get: function (p) { counts.reads++; own.reads++; seen[p] = docs[p] ? docs[p].ver : 0; return Promise.resolve(docs[p] ? clone(docs[p].d) : null); },
              set: function (p, d) { writes.push([p, clone(d)]); },
              /** แก้บางช่องของเอกสารที่มีอยู่ (update) ไม่มีเอกสาร = ผิดแบบ Firestore */
              patch: function (p, fields) {
                if (!docs[p]) throw new Error('ไม่พบเอกสาร ' + p);
                var d = clone(docs[p].d);
                Object.keys(fields).forEach(function (k) { d[k] = clone(fields[k]); });
                writes.push([p, d]);
              },
            };
            var out = await fn(t);
            if (hook) { var h = hook; hook = null; await h(); }
            var clash = Object.keys(seen).some(function (p) { return (docs[p] ? docs[p].ver : 0) !== seen[p]; });
            if (clash) { counts.retries++; continue; }
            if (writes.length) {
              var why = check(user, writes);
              if (why) throw denied(why);
              apply(writes, own);
            }
            return out;
          }
          throw new Error('บันทึกชนกับเครื่องอื่นเกิน ' + TX_TRIES + ' ครั้ง ลองกดส่งใหม่');
        },
        commit: function (writes) {
          var why = check(user, writes);
          if (why) return Promise.reject(denied(why));
          apply(writes, own);
          return Promise.resolve();
        },
        /** เขียนเฉพาะบางช่อง ช่องอื่นคงเดิม (setDoc merge) */
        patch: function (p, fields) {
          var d = docs[p] ? clone(docs[p].d) : {};
          Object.keys(fields).forEach(function (k) { d[k] = clone(fields[k]); });
          return this.commit([[p, d]]);
        },
        onMeta: function (cb) {
          listeners.push(cb);
          return function () { listeners = listeners.filter(function (x) { return x !== cb; }); };
        },
        hook: function (fn) { hook = fn; },
        stats: function () { return clone(counts); },
        mine: function () { return clone(own); },
        dump: snapshot,
        connect: client,
        /** เขียนตรงไม่ผ่านกฎ ใช้ตั้งข้อมูลทดลองเท่านั้น */
        seed: function (data) { Object.keys(data).forEach(function (p) { docs[p] = { ver: (docs[p] ? docs[p].ver : 0) + 1, d: clone(data[p]) }; }); },
        /** ล้างฐานแล้วใส่ data แทนทั้งหมด (กู้คืนจากไฟล์สำรองในฐานทดลอง เหมือนสคริปต์กู้คืนที่ใช้สิทธิ์เจ้าของโปรเจกต์) */
        replace: function (data) {
          Object.keys(docs).forEach(function (p) { delete docs[p]; });
          Object.keys(data || {}).forEach(function (p) { docs[p] = { ver: 1, d: clone(data[p]) }; });
          if (opt.onCommit) opt.onCommit(snapshot());
        },
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
      trAfter: function (ms) {
        var q = F.query(F.collection(db, 'docs'), F.where('trAt', '>=', F.Timestamp.fromMillis(ms)));
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
            patch: function (p, d) { counts.writes++; t.update(ref(p), inn(d)); },
          });
        });
      },
      list: function (col) {
        return F.getDocs(F.collection(db, col)).then(function (s) {
          if (!s.size) counts.reads++;
          return s.docs.map(function (x) { return { id: x.id, data: out(x) }; });
        });
      },
      commit: function (writes) {
        var b = F.writeBatch(db);
        writes.forEach(function (w) { b.set(ref(w[0]), inn(w[1])); });
        counts.writes += writes.length;
        return b.commit();
      },
      patch: function (p, fields) {
        counts.writes++;
        return F.setDoc(ref(p), inn(fields), { merge: true });
      },
      onMeta: function (cb) {
        return F.onSnapshot(ref('meta/head'), function (snap) { var d = out(snap); if (d) cb(d); });
      },
      stats: function () { return clone(counts); },
      mine: function () { return clone(counts); },
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

  /* tv = รุ่นเลข TRcloud ที่เครื่องนี้ดึงแล้ว (null = ยังไม่เคย) · trAt = เวลาแก้เลข TRcloud ล่าสุดที่เห็น · trc = ยอด TRcloud ล่าสุด {key, id, data} */
  function emptyLocal() { return { v: C.V, seq: 0, meta: null, docs: [], piles: {}, master: {}, mv: -1, tv: null, trAt: 0, trc: null }; }

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
        tx.objectStore('kv').put({ v: local.v, seq: local.seq, meta: local.meta, piles: local.piles, master: local.master, mv: local.mv,
          tv: local.tv === undefined ? null : local.tv, trAt: local.trAt || 0, trc: local.trc || null }, 'state');
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

  /** ที่เก็บตัวนับโควตาของเครื่อง (ค่าเริ่มต้นในหน่วยความจำ หน้าเว็บใช้ storeMeter ใน localStorage) */
  function memMeter() {
    var v = null;
    return { load: function () { return clone(v); }, save: function (o) { v = clone(o); } };
  }
  function storeMeter(key) {
    return {
      load: function () { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
      save: function (o) { try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {} },
    };
  }

  /* ── ตัวสมุด ──────────────────────────────────────────────────────────── */

  /**
   * opt = { store, auth, cache, now(), partBytes, domain โดเมนอีเมลบริษัท, meter ที่เก็บตัวนับโควตา }
   * คืน fire: login, logout, sync, fifo, post, local, user, watch, usage, users, saveUser, quota, reload
   */
  function open(opt) {
    var store = opt.store, auth = opt.auth || fakeAuth([]), cache = opt.cache || memCache();
    var now = opt.now || Date.now;
    var domain = String(opt.domain || '').toLowerCase();
    var meter = opt.meter || memMeter();
    var local = emptyLocal(), loaded = false, user = null, syncing = null;
    var mark = (function () { var s = store.mine ? store.mine() : store.stats(); return { reads: s.reads, writes: s.writes }; })();

    /* ── ตัวนับโควตาของเครื่องนี้ (วันตามเวลาแปซิฟิกแบบ Firebase) ── */
    function used() { return store.mine ? store.mine() : store.stats(); }
    function tally() {
      var s = used(), day = C.pacificDay(now());
      var m = meter.load() || {};
      if (!m.dev) m.dev = 'd' + Math.random().toString(36).slice(2, 10);
      if (m.day !== day) { m.day = day; m.reads = 0; m.writes = 0; m.sent = 0; m.sentAt = 0; }
      if (mark) { m.reads += Math.max(0, s.reads - mark.reads); m.writes += Math.max(0, s.writes - mark.writes); }
      mark = { reads: s.reads, writes: s.writes };
      meter.save(m);
      return m;
    }
    /** ส่งยอดของเครื่องนี้ไปรวมที่ use/{วัน} (ชั่วโมงละครั้ง หรือทันทีตอนเปิดหน้าโควตา) เขียนพลาดไม่เป็นไร */
    async function report(force) {
      if (!user) return;
      var m = tally();
      if (!force && now() - (m.sentAt || 0) < REPORT_EVERY) return;
      if (m.reads + m.writes === m.sent) return;
      var entry = {};
      entry[m.dev] = { r: m.reads, w: m.writes + 1, by: user.name };
      try {
        await store.patch('use/' + m.day, entry);
        m = tally();
        m.sent = m.reads + m.writes;
        m.sentAt = now();
        meter.save(m);
      } catch (e) {}
    }

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
      var fresh = !local.seq;
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
          if (d.trAt > (local.trAt || 0)) local.trAt = d.trAt;
        }
        if (!mains.length) break;
      }
      /* เลข TRcloud ที่มีคนใส่ทีหลัง (แก้เอกสารเก่า seq ไม่เปลี่ยน): tv ใน meta เปลี่ยน = ดึงเอกสารที่ trAt ใหม่กว่าที่เคยเห็น */
      var tv = +meta.tv || 0;
      if (local.tv === null || local.tv === undefined) local.tv = fresh ? tv : -1;
      if (local.tv !== tv) {
        var byId = {};
        local.docs.forEach(function (x) { byId[x.id] = x; });
        (await store.trAfter(local.trAt || 0)).forEach(function (x) {
          var d = byId[x.id];
          if (!d || x.data.of) return;
          d.tr = x.data.tr || '';
          d.trState = x.data.trState || '';
          d.trBy = x.data.trBy || '';
          d.trAt = typeof x.data.trAt === 'number' ? x.data.trAt : 0;
          if (d.trAt > (local.trAt || 0)) local.trAt = d.trAt;
          if (added.indexOf(d) < 0) added.push(d);
        });
        local.tv = tv;
      }
      /* ยอด TRcloud ล่าสุดที่หัวหน้านำเข้า (meta.trc = 'วันที่#รุ่น') ดึงเมื่อเปลี่ยน */
      if (meta.trc && (!local.trc || local.trc.key !== meta.trc)) {
        var id = String(meta.trc).split('#')[0];
        var td = await store.get('trc/' + id);
        local.trc = td ? { key: meta.trc, id: id, data: td } : null;
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
      if (!syncing) {
        syncing = syncNow().finally(function () { syncing = null; tally(); report(false); });
      }
      return syncing;
    }

    function inDomain(e) { return !domain || e.slice(-(domain.length + 1)) === '@' + domain; }

    /** เข้าด้วยบัญชีที่ auth ให้มา (Google ป๊อปอัป / บัญชีทดลอง) แล้วเช็ครายชื่อใน users/{อีเมล} */
    async function enter(u) {
      if (!u || !u.email) return fail('ยังไม่ได้เลือกบัญชี');
      if (!inDomain(u.email)) {
        try { await auth.signOut(); } catch (e) {}
        return fail(u.email + ' ไม่ใช่อีเมลบริษัท ใช้บัญชี @' + domain + ' เท่านั้น', { noRight: 1 });
      }
      if (u.verified === false) { try { await auth.signOut(); } catch (e) {} return fail('อีเมลนี้ยังไม่ยืนยันกับ Google'); }
      store.setUser(u);
      var prof = null;
      try { prof = await store.get('users/' + u.email); } catch (e) { prof = null; }
      if (!prof || prof.active !== true) {
        user = null; store.setUser(null);
        try { await auth.signOut(); } catch (e) {}
        return fail(u.email + ' ' + NO_RIGHT.replace('บัญชีนี้', ''), { noRight: 1 });
      }
      user = { email: u.email, name: prof.name || u.name || u.email, role: ROLES.indexOf(prof.role) >= 0 ? prof.role : 'viewer' };
      /* เวลาเข้าล่าสุด หัวหน้าเห็นในหน้าตั้งค่า เขียนไม่เกินชั่วโมงละครั้ง พลาดไม่เป็นไร */
      if (!(+prof.last > 0) || now() - prof.last > LAST_EVERY) { try { await store.patch('users/' + u.email, { last: C.TIME }); } catch (e) {} }
      tally();
      return reply({ who: user.name, role: ROLE_TH[user.role], mode: 'book', email: user.email });
    }

    async function login(email) {
      var u;
      try { u = typeof email === 'string' ? await auth.signIn(email) : await auth.signIn(); }
      catch (e) { return fail(/popup|cancel/i.test(String(e && (e.code || e.message))) ? 'ปิดหน้าต่างเลือกบัญชีก่อนเลือก ลองกดอีกครั้ง' : String(e && e.message || e)); }
      return enter(u);
    }
    /** เปิดหน้าใหม่: บัญชีที่ค้างไว้ในเบราว์เซอร์ (Google จำให้) เข้าให้เองโดยไม่เด้งหน้าต่าง · ไม่มี = null */
    async function restore() {
      var u = auth.ready ? await auth.ready() : auth.current();
      return u ? enter(u) : null;
    }

    function logout() { user = null; store.setUser(null); return auth.signOut(); }

    /* ── รายชื่อคนใช้ (หัวหน้า) ── */

    function userRow(id, d) {
      d = d || {};
      return { email: id, name: d.name || '', role: ROLES.indexOf(d.role) >= 0 ? d.role : 'viewer', active: d.active === true, last: +d.last || 0, by: d.by || '', at: +d.at || 0 };
    }
    async function users() {
      if (!user || user.role !== 'head') return fail('รายชื่อดูได้เฉพาะหัวหน้า');
      var list;
      try { list = await store.list('users'); } catch (e) { return fail(String(e && e.message || e)); }
      tally();
      var order = { head: 0, staff: 1, viewer: 2 };
      var out = list.map(function (x) { return userRow(x.id, x.data); }).sort(function (a, b) {
        return (+b.active - +a.active) || (order[a.role] - order[b.role]) || a.name.localeCompare(b.name, 'th') || (a.email < b.email ? -1 : 1);
      });
      return reply({ users: out, domain: domain });
    }
    /** เพิ่มหรือแก้คน (ชื่อ สิทธิ์ เปิด/ปิด) ไม่ลบ: คนที่ออกให้ปิดไว้ ชื่อในเอกสารเก่ายังอ่านได้ */
    async function saveUser(email, data) {
      if (!user || user.role !== 'head') return fail('แก้รายชื่อได้เฉพาะหัวหน้า');
      data = data || {};
      var e = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fail('อีเมลไม่ถูกรูปแบบ');
      if (!inDomain(e)) return fail('ต้องเป็นอีเมล @' + domain + ' เท่านั้น');
      var name = C.plain(data.name, 60);
      if (!name) return fail('ต้องใส่ชื่อ');
      if (ROLES.indexOf(data.role) < 0) return fail('สิทธิ์ต้องเป็น หัวหน้า ลงรายการ หรือ ดูอย่างเดียว');
      var active = data.active !== false;
      if (e === user.email && (data.role !== 'head' || !active)) return fail('ลดสิทธิ์หรือปิดบัญชีตัวเองไม่ได้ ให้หัวหน้าอีกคนทำ');
      var list;
      try { list = await store.list('users'); } catch (err) { return fail(String(err && err.message || err)); }
      var old = null, heads = 0;
      list.forEach(function (x) {
        if (x.id === e) old = x.data;
        else if (x.data && x.data.active === true && x.data.role === 'head') heads++;
      });
      if (!(data.role === 'head' && active) && !heads) return fail('ต้องมีหัวหน้าที่ใช้งานได้อย่างน้อย 1 คน');
      if (old && data.add) return fail(e + ' มีในรายชื่อแล้ว (' + (old.name || '') + ')');
      try {
        await store.patch('users/' + e, { name: name, role: data.role, active: active, by: user.email, at: C.TIME });
      } catch (err) { return fail(String(err && err.message || err)); }
      tally();
      return reply({ user: userRow(e, { name: name, role: data.role, active: active, last: old && old.last, by: user.email, at: now() }), added: !old });
    }

    /* ── โควตา ── */

    /** วันนี้ (เวลาแปซิฟิก): เครื่องนี้ · ทุกเครื่องที่ส่งยอดมา (use/{วัน}) · เอกสารที่บันทึกวันนี้ทั้งระบบ */
    async function quota() {
      if (user) { try { await sync(); } catch (e) {} }   // เอกสารวันนี้นับจากสำเนา ดึงของใหม่ก่อน
      await report(true);
      var m = tally(), day = m.day;
      var docs = 0, dw = 0;
      (local.docs || []).forEach(function (d) { if (d.at && C.pacificDay(d.at) === day) { docs++; dw += (d.part || 1) + 1; } });
      var all = null;
      if (user) {
        try {
          var u = await store.get('use/' + day);
          m = tally();   // ช่องของเครื่องนี้ใช้ยอดล่าสุด (รวมการอ่านครั้งนี้)
          if (u) {
            all = { reads: 0, writes: 0, list: [] };
            Object.keys(u).forEach(function (k) {
              var x = u[k] || {};
              if (k === m.dev) x = { r: m.reads, w: m.writes, by: x.by };
              all.reads += +x.r || 0;
              all.writes += +x.w || 0;
              all.list.push({ dev: k, me: k === m.dev, by: x.by || '', r: +x.r || 0, w: +x.w || 0 });
            });
            all.list.sort(function (a, b) { return (b.r + b.w) - (a.r + a.w); });
          }
        } catch (e) { all = null; }
      }
      m = tally();
      return { day: day, reads: m.reads, writes: m.writes, limits: clone(LIMITS), docs: docs, docWrites: dw, all: all, resetAt: C.pacificReset(now()) };
    }

    /** ล้างสำเนาในเครื่องแล้วดึงใหม่ทั้งหมด (อ่านเท่าจำนวนเอกสาร) */
    async function reload() {
      if (syncing) { try { await syncing; } catch (e) {} }
      local = emptyLocal();
      loaded = true;
      try { await cache.clear(); } catch (e) {}
      return sync();
    }

    /* ── ขั้น 3: รอลง TRcloud กระทบยอด ตารางหลัก ชีตเดิม สำรอง (ตรรกะอยู่ใน wms-fire-trc.js) ── */

    function T() { if (!window.WmsFireTrc) throw new Error('ยังไม่ได้โหลด wms-fire-trc.js'); return window.WmsFireTrc; }
    function errOf(e) { return String(e && e.message || e); }

    /** รายการหน้ารอลง TRcloud (ดึงของใหม่ก่อน) */
    async function trList() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      return reply({ list: T().trList(local, now()), today: C.today(now()) });
    }

    /**
     * ใส่เลข TRcloud / เปลี่ยนสถานะ items = [{no, tr, state}] ไม่เกิน TR_MAX ต่อครั้ง
     * transaction เดียว: แก้ช่อง tr ของเอกสาร + meta.tv +1 (เครื่องอื่นเห็นภายในรอบดึงถัดไป)
     */
    async function trSave(items) {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      if (user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      await sync();
      var chk = T().trSet(local, items, user);
      if (chk.error) return reply(chk);
      try {
        await store.tx(async function (t) {
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ยังไม่มีสมุด');
          chk.writes.forEach(function (w) { t.patch(w[0], w[1]); });
          t.patch('meta/head', { tv: (+meta.tv || 0) + 1 });
        });
      } catch (e) { return fail(errOf(e)); }
      var at = now(), changed = [];
      chk.writes.forEach(function (w) {
        var d = local.docs.filter(function (x) { return 'docs/' + x.id === w[0]; })[0];
        if (!d) return;
        d.tr = w[1].tr; d.trState = w[1].trState; d.trBy = user.email; d.trAt = at;
        changed.push(d);
      });
      try { await cache.put(local, changed); } catch (e) {}
      tally();
      return reply({ saved: changed.length, states: T().trStates(local) });
    }

    /** ไฟล์ปรับยอดลง TRcloud ของเอกสารที่เลือก */
    function trFile(nos) { return T().trFile(local, nos); }

    /** ยอด TRcloud ล่าสุดที่นำเข้า (จากสำเนาในเครื่อง ดึงเมื่อหัวหน้านำเข้าใหม่) + ผลเทียบกับยอดในระบบ */
    async function trc() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      var x = local.trc && T().trcIn(local.trc.data);
      if (!x) return reply({ trc: null });
      return reply({ trc: x, cmp: T().trcCompare(local, x, now()) });
    }

    /** หัวหน้านำเข้ายอด TRcloud: trc/{วันที่} + meta.trc = 'วันที่#รุ่น' ใน transaction เดียว */
    async function trcSave(parsed, day, files) {
      if (!user || user.role !== 'head') return fail('นำเข้ายอด TRcloud ได้เฉพาะหัวหน้า');
      var made = T().trcDoc(parsed, { day: day, by: user.email, name: user.name, files: files });
      if (made.error) return reply(made);
      try {
        await store.tx(async function (t) {
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ลงยอดยกมาก่อน แล้วค่อยนำเข้ายอด TRcloud');
          var old = String(meta.trc || '').split('#');
          t.set('trc/' + day, made.data);
          t.patch('meta/head', { trc: day + '#' + ((old[0] === day ? +old[1] || 0 : 0) + 1) });
        });
      } catch (e) { return fail(errOf(e)); }
      local.trc = null;   // ดึงตัวที่เก็บแล้ว (เวลาเซิร์ฟเวอร์) ในรอบนี้
      var r = await trc();
      return r.error ? r : reply({ saved: day, n: made.data.n, trc: r.trc, cmp: r.cmp });
    }

    /** หัวหน้านำเข้าตารางหลัก kind = sup (PO → Supplier) | conv (MASTER แปลงสินค้า) + meta.mv +1 ให้ทุกเครื่องดึงใหม่ */
    async function masterSave(kind, part) {
      if (!user || user.role !== 'head') return fail('แก้ตารางหลักได้เฉพาะหัวหน้า');
      if (MASTERS.indexOf(kind) < 0) return fail('ไม่รู้จักตาราง ' + kind);
      var made = T().masterDoc(kind, part, { by: user.email, name: user.name });
      if (made.error) return reply(made);
      try {
        await store.tx(async function (t) {
          var meta = await t.get('meta/head');
          if (!meta) throw new Error('ลงยอดยกมาก่อน แล้วค่อยนำเข้าตารางหลัก');
          t.set('master/' + kind, made.data);
          t.patch('meta/head', { mv: (+meta.mv || 0) + 1 });
        });
      } catch (e) { return fail(errOf(e)); }
      await sync();
      return reply({ saved: kind, n: made.data.n });
    }

    /** ตารางหลักที่มีอยู่ { sup: {n, tab, at, name}, conv: {…} } */
    function masters() {
      var out = {};
      MASTERS.forEach(function (n) {
        var m = local.master && local.master[n];
        if (m) out[n] = { n: +m.n || C.dec(m.rows).length, tab: m.tab || '', at: +m.at || 0, name: m.name || '', dup: (m.dup || []).length, blank: +m.blank || 0 };
      });
      return out;
    }

    /** วันที่ต้องวางแถวลงชีตเดิม + ใครวางแล้ว (xfer/log อ่าน 1 ครั้ง) */
    async function xferDays() {
      if (!user) return fail('ยังไม่ได้ล็อกอิน');
      await sync();
      var log = null;
      try { log = await store.get('xfer/log'); } catch (e) { log = null; }
      tally();
      return reply({ days: T().xferDays(local, log || {}) });
    }
    function xferText(day, after) { return T().xferText(local, day, after); }
    /** วางลงชีตเดิมแล้ว: เติมวันนั้นใน xfer/log (ครั้งละวัน) */
    async function xferMark(day, info) {
      if (!user || user.role === 'viewer') return fail('บัญชีนี้ดูได้อย่างเดียว');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return fail('วันที่ต้องเป็น yyyy-mm-dd');
      var entry = {};
      entry[day] = { by: user.name, at: now(), n: +(info && info.rows) || 0, last: String(info && info.last || '') };
      try { await store.patch('xfer/log', entry); } catch (e) { return fail(errOf(e)); }
      tally();
      return reply({ day: day, done: entry[day] });
    }

    /** ไฟล์สำรองจากสำเนาในเครื่อง + รายชื่อ + ยอด TRcloud ล่าสุด + บันทึกชีตเดิม (หัวหน้า) */
    async function backup() {
      if (!user || user.role !== 'head') return fail('ดาวน์โหลดสำรองได้เฉพาะหัวหน้า');
      await sync();
      var us = await users();
      if (us.error) return us;
      var xf = null;
      try { xf = await store.get('xfer/log'); } catch (e) { xf = null; }
      tally();
      return reply({ backup: T().backupOf(local, { users: us.users, trc: local.trc, xfer: xf }, now()) });
    }

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
        /* เวลาเซิร์ฟเวอร์ยังไม่รู้ ใช้เวลาเครื่องไปก่อน (ตัวนับเอกสารวันนี้) · ส่วนแยก = เอกสารที่เขียนลบ meta */
        pl.doc.at = now();
        pl.doc.part = pl.writes.length - 1;
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
        if (C.OPS[op]) { var sv = await save(op, body); tally(); return sv; }
        if (!user) return fail('ยังไม่ได้ล็อกอิน');
        await sync();
        var t = now();
        if (op === 'bk-state') return reply(C.state(local, t));
        if (op === 'bk-stock') return reply(C.stock(local));
        if (op === 'bk-recent') return reply(C.recent(local, body, t));
        if (op === 'bk-seen') return reply(C.seen(local, body, t));
        if (op === 'bk-find') return reply(C.find(local, body, t));
        if (op === 'bk-rebuild') {
          if (user.role !== 'head') return fail('คำสั่งนี้ใช้ได้เฉพาะหัวหน้ากับรองหัวหน้า');
          /* ยอดในเครื่องไม่ตรงกับที่คิดจากเอกสาร (สำเนาเสียหรือถูกแก้) = ใช้ยอดที่คิดใหม่ แล้วบอกว่าซ่อมแล้ว */
          var rb = C.rebuild(local);
          if (!rb.same) {
            local.piles = C.pilesFromDocs(local).map;
            try { await cache.put(local, []); } catch (e) {}
            rb.fixed = 1;
          }
          return reply(rb);
        }
        if (op === 'bk-mode') return body.mode === 'book' ? reply({ mode: 'book', same: true }) : fail('ระบบใหม่ลงสมุดตรงเสมอ ไม่มีโหมดคัดลอก');
        if (op === 'bk-backup') return fail('ระบบใหม่สำรองทุกคืนด้วย fire-backup.gs');
        return fail('ไม่รู้จักคำสั่งนี้');
      } catch (e) {
        return fail(String(e && e.message || e));
      }
    }

    return {
      store: store, auth: auth, domain: domain,
      login: login, restore: restore, logout: logout, sync: sync, post: post,
      users: users, saveUser: saveUser, quota: quota, reload: reload,
      trList: trList, trSave: trSave, trFile: trFile, trc: trc, trcSave: trcSave, masterSave: masterSave, masters: masters,
      xferDays: xferDays, xferText: xferText, xferMark: xferMark, backup: backup,
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
    SDK_V: SDK_V, LIMITS: LIMITS, ROLES: ROLES, ROLE_TH: ROLE_TH,
    memStore: memStore, firestoreStore: firestoreStore, rulesError: rulesError,
    fakeAuth: fakeAuth, googleAuth: googleAuth, memCache: memCache, idbCache: idbCache, memMeter: memMeter, storeMeter: storeMeter,
    open: open,
  };
})();
