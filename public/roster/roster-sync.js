/**
 * @file roster-sync.js — ตารางกะชุดเดียวกันทุกเครื่อง ผ่าน Google Sheet (apps-script/roster-api.gs)
 *
 * แต่ละเครื่องยังเก็บตารางกะไว้ในเบราว์เซอร์ของตัวเอง และบันทึกลงเครื่องทันทีที่แก้เหมือนเดิม
 * ตรงนี้แค่ส่งขึ้นชีตตามหลัง และดึงฉบับใหม่ลงมาเมื่อเครื่องอื่นแก้ — เน็ตหลุดก็ยังใช้งานได้
 * แค่ส่งขึ้นชีตทีหลัง
 *
 * ชีตนับฉบับ (rev) ทุกครั้งที่บันทึก เครื่องที่ส่งต้องบอกว่าแก้ต่อจากฉบับไหน ถ้าระหว่างนั้น
 * มีเครื่องอื่นบันทึกไปก่อน ชีตจะไม่รับและส่งฉบับล่าสุดกลับมา เครื่องนี้จึงรวมสองฝั่งแล้วส่งใหม่
 * — ไม่มีใครทับงานของใครเงียบ ๆ
 *
 * โหลดเป็น classic script เปิดเป็น window.RosterSync
 */
(function () {
  'use strict';

  // ส่วนที่เป็นรายการทั้งก้อน — สองเครื่องแก้ส่วนเดียวกันต้องถามคนว่าเอาของใคร
  var LISTS = ['employees', 'outsource', 'periods', 'holidays', 'extraPro'];
  // ส่วนที่เป็นช่อง ๆ แยกกัน (วัน|ชื่อ, วัน|กะ, ชื่อคน) — รวมทีละช่องได้
  var MAPS = ['overrides', 'kpiData', 'minStaff', 'osExtra'];
  var LABEL = {
    employees: 'รายชื่อพนักงาน', outsource: 'รายชื่อ OS ประจำ', periods: 'คาบเปลี่ยนกะ',
    holidays: 'วันหยุดพิเศษ', extraPro: 'วันโปรฯ ที่เพิ่มเอง',
  };

  function same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }
  function asObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  /** เฉพาะส่วนที่เป็นข้อมูล — savedAt เปลี่ยนทุกครั้งที่บันทึก เทียบแล้วจะต่างกันเสมอ */
  function strip(d) {
    var o = {};
    LISTS.concat(MAPS).forEach(function (k) { if (d && d[k] !== undefined) o[k] = d[k]; });
    return o;
  }

  /** ค่าเดียว สามฝั่ง: ฝั่งไหนไม่ได้แก้จากฉบับตั้งต้น เอาของอีกฝั่ง — null = แก้ทั้งคู่และไม่เหมือนกัน */
  function pick(base, mine, theirs) {
    if (same(mine, base)) return { v: theirs };
    if (same(theirs, base) || same(mine, theirs)) return { v: mine };
    return null;
  }

  /**
   * รวมสิ่งที่เครื่องนี้แก้ (mine) กับที่เครื่องอื่นแก้ (theirs) จากฉบับที่ทั้งคู่เริ่ม (base)
   *
   * ช่องที่แก้ทั้งสองฝั่งในส่วนที่เป็นช่อง ๆ เอาของเครื่องนี้ — คนที่เพิ่งกดคือคนที่เห็นค่าล่าสุด
   * ส่วนที่เป็นรายการรวมทีละคนไม่ได้ (ลำดับ การเปลี่ยนชื่อ) จึงบอกกลับไปใน clash ให้คนเลือก
   * ระหว่างนั้นใช้ของเครื่องนี้ไว้ก่อน
   * @returns {{data:object, clash:string[]}}
   */
  function merge3(base, mine, theirs) {
    var b = asObj(base), m = asObj(mine), t = asObj(theirs), out = {}, clash = [];
    LISTS.forEach(function (k) {
      var r = pick(b[k], m[k], t[k]);
      if (r) out[k] = r.v; else { out[k] = m[k]; clash.push(k); }
      if (out[k] === undefined) delete out[k];
    });
    MAPS.forEach(function (k) {
      var bb = asObj(b[k]), mm = asObj(m[k]), tt = asObj(t[k]), o = {}, keys = {};
      [bb, mm, tt].forEach(function (x) { for (var ik in x) keys[ik] = 1; });
      for (var ik in keys) {
        var r = pick(bb[ik], mm[ik], tt[ik]), v = r ? r.v : mm[ik];
        if (v !== undefined) o[ik] = v;
      }
      out[k] = o;
    });
    return { data: out, clash: clash };
  }

  function fail(msg) { var e = new Error(msg); e.server = true; return e; }

  /**
   * @param {object} o
   *   url() token() me()          ค่าจากหน้าตั้งค่า
   *   identify(url) → Promise<boolean>  URL นี้เป็นสคริปต์ตารางกะจริงไหม (GET ไม่ต้องมีรหัส)
   *   post(url, body) → Promise<object>
   *   store, key                  ที่เก็บสถานะการซิงก์ของเครื่องนี้
   *   get()                       ข้อมูลตอนนี้
   *   put(data) → {migrated}      ใช้ข้อมูลชุดนี้แทนของในเครื่อง (เก็บลงเครื่องด้วย)
   *   hasLocal()                  เครื่องนี้มีตารางกะที่เคยบันทึกไว้ไหม
   *   describe(data) ask(msg)     สรุปข้อมูลให้คนอ่าน / ถามคน (true = ตกลง)
   *   canApply()                  แทนข้อมูลบนจอตอนนี้ได้ไหม — มีหน้าต่างแก้ไขเปิดค้าง = ยัง
   *   status(state, info)         local pending saving saved synced pulled declined offline error
   *   later(fn, ms)               ตั้งเวลา (เทสส่งตัวปลอมมา)
   */
  function create(o) {
    var later = o.later || function (fn, ms) { return setTimeout(fn, ms); };
    var st = load(), busy = false, again = false, edits = 0, declined = false, checked = '', timer = null;

    function blank() { return { url: o.url(), rev: 0, base: null, dirty: false }; }
    function load() {
      try {
        var s = JSON.parse(o.store.getItem(o.key) || 'null');
        if (s && typeof s === 'object') {
          return { url: s.url || '', rev: Number(s.rev) || 0, base: typeof s.base === 'string' ? s.base : null, dirty: !!s.dirty };
        }
      } catch (e) {}
      return blank();
    }
    function keep() { try { o.store.setItem(o.key, JSON.stringify(st)); } catch (e) {} }
    function say(state, info) { if (o.status) o.status(state, info || {}); }
    function base() { try { return JSON.parse(st.base); } catch (e) { return {}; } }
    function synced(L, dirty) { st = { url: o.url(), rev: L.rev, base: JSON.stringify(strip(L.data)), dirty: dirty }; keep(); }

    async function call(op, extra) {
      var body = { op: op, token: o.token() };
      for (var k in extra) body[k] = extra[k];
      var r = await o.post(o.url(), body);
      if (!r || r.error) throw fail((r && r.error) || 'Apps Script ไม่ตอบ');
      if (r.app !== 'roster') throw fail('URL นี้ไม่ใช่สคริปต์ตารางกะ — ตรวจในหน้าตั้งค่า');
      return r;
    }

    function decline() { declined = true; say('declined'); return false; }
    function apply(L) {
      var r = o.put(L.data) || {};
      synced(L, !!r.migrated);
      say('pulled', L);
    }

    /** ฉบับในชีตไม่ใช่ฉบับที่เครื่องนี้รู้จัก — ตัดสินว่าจะเอาของใคร @returns {boolean} ไปต่อได้ไหม */
    function settle(L) {
      var mine = o.get();
      if (!L.data) {
        // ชีตยังว่าง (เพิ่งติดตั้ง หรือมีคนล้างชีต) — ถามก่อน เครื่องใหม่ที่มีแต่รายชื่อตั้งต้น
        // จะได้ไม่ส่งขึ้นไปเป็นชุดหลักโดยไม่มีใครตั้งใจ
        if (!o.ask('ตารางกะในชีตส่วนกลางยังว่าง\n\nส่งตารางกะในเครื่องนี้ขึ้นไปเป็นชุดตั้งต้นไหม?\n' +
          'ในเครื่องนี้: ' + o.describe(mine))) return decline();
        st = { url: o.url(), rev: L.rev, base: '{}', dirty: true }; keep();
        return true;
      }
      if (!Array.isArray(L.data.employees)) throw fail('ข้อมูลในชีตไม่ใช่ตารางกะ');
      var who = (L.by ? ' โดย ' + L.by : '');
      if (st.base === null) {
        // เครื่องนี้ยังไม่เคยซิงก์กับชีตนี้ — ในเครื่องยังไม่มีอะไรก็ใช้ของชีตเลย ไม่งั้นให้คนเลือก
        if (!o.hasLocal() || o.ask('ในชีตส่วนกลางมีตารางกะอยู่แล้ว' + who + '\n\n' +
          'ในชีต: ' + o.describe(L.data) + '\nในเครื่องนี้: ' + o.describe(mine) + '\n\n' +
          'กด OK = ใช้ตารางกะจากชีต (ของในเครื่องนี้จะถูกแทนที่)')) { apply(L); return true; }
        if (o.ask('ส่งตารางกะในเครื่องนี้ขึ้นไปแทนที่ของในชีตไหม?\n\nทุกเครื่องที่ใช้ชีตนี้จะเห็นข้อมูลของเครื่องนี้แทน')) {
          synced(L, true);
          return true;
        }
        return decline();
      }
      if (!st.dirty) { apply(L); return true; }
      var m = merge3(base(), mine, L.data);
      m.clash.forEach(function (k) {
        if (!o.ask(LABEL[k] + ' ถูกแก้ทั้งในเครื่องนี้และเครื่องอื่น' + who + '\n\n' +
          'กด OK = ใช้ของเครื่องนี้\nกด ยกเลิก = ใช้ของเครื่องอื่น')) m.data[k] = L.data[k];
      });
      o.put(m.data);
      synced(L, true);
      return true;
    }

    async function run() {
      if (st.url !== o.url()) { st = blank(); keep(); }      // เปลี่ยนไปใช้อีกชีต = เริ่มนับใหม่
      if (checked !== o.url()) {
        // ส่ง POST ไปผิดสคริปต์ เช่นของไฟล์รถบริษัท อาจไปบันทึกขยะไว้ในชีตนั้น จึงเช็คด้วย GET ก่อน
        if (!(await o.identify(o.url()))) throw fail('URL นี้ไม่ใช่สคริปต์ตารางกะ — ตรวจในหน้าตั้งค่า');
        checked = o.url();
      }
      for (var round = 0; round < 4; round++) {
        if (st.dirty && st.base !== null) {
          var sent = o.get(), n = edits;
          say('saving');
          var r = await call('save', { baseRev: st.rev, data: sent, by: o.me() });
          if (r.conflict) {
            if (!o.canApply()) return;                         // ลองใหม่รอบหน้า ตอนนี้ยังมีของแก้ค้างบนจอ
            if (!settle(r)) return;
            continue;
          }
          synced({ rev: r.rev, data: sent }, edits !== n);      // แก้เพิ่มระหว่างส่ง = ต้องส่งอีกรอบ
          if (!st.dirty) { say('saved', r); return; }
          continue;
        }
        var h = await call('rev');
        if (h.rev === st.rev && st.base !== null) { say('synced', h); return; }
        if (!o.canApply()) return;
        if (!settle(await call('load'))) return;
        if (!st.dirty) return;
      }
      // วนครบแล้วยังค้าง = มีเครื่องอื่นบันทึกแทรกทุกรอบ ไม่ต้องวนต่อ รอบหน้าค่อยส่งใหม่
      if (st.dirty) say('error', { error: 'เครื่องอื่นกำลังบันทึกถี่มาก ยังส่งไม่สำเร็จ จะลองใหม่' });
    }

    async function sync() {
      if (!o.url() || declined) return;
      if (busy) { again = true; return; }
      busy = true;
      try { await run(); }
      catch (err) { say(err.server ? 'error' : 'offline', { error: err.message }); }
      finally {
        busy = false;
        if (again) { again = false; kick(300); }
      }
    }

    function kick(ms) {
      if (timer) return;
      timer = later(function () { timer = null; sync(); }, ms);
    }

    return {
      on: function () { return !!o.url(); },
      start: function () { if (o.url()) kick(0); else say('local'); },
      /** เรียกทุกครั้งที่แก้ — หลังบันทึกลงเครื่องแล้ว */
      changed: function () {
        if (!o.url()) return;
        edits++; st.dirty = true; keep();
        if (declined) { say('declined'); return; }
        say('pending');
        kick(1500);
      },
      /** เช็คว่ามีเครื่องอื่นแก้ไหม และส่งที่ค้างอยู่ — เรียกเป็นระยะ */
      poll: function () { if (o.url() && !declined) kick(0); },
      /** คนกดให้ลองใหม่ — รวมถึงที่เคยตอบว่าไม่ส่งขึ้นชีต */
      retry: function () { declined = false; kick(0); },
      sync: sync,
      state: function () { return { rev: st.rev, dirty: st.dirty, synced: st.base !== null, declined: declined }; },
    };
  }

  window.RosterSync = { create: create, merge3: merge3, strip: strip, LABEL: LABEL };
})();
