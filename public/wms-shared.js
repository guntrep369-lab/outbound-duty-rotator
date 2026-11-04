/**
 * @file wms-shared.js — ข้อมูลกลาง ให้ทุกเครื่องเห็นตัวเลขชุดเดียวกัน
 *
 * เดิมแต่ละเครื่องกดดึงเอง ได้ตัวเลขคนละเวลา คนหนึ่งเห็นยอดตอนเช้า อีกคนเห็นตอนบ่าย
 * แล้วคุยกันไม่ตรง ตอนนี้สคริปต์เก็บผลล่าสุดไว้ชุดเดียว (ส่วน "ข้อมูลกลาง" ใน tx-api.gs
 * และ cut-api.gs) หน้าเว็บใช้ชุดนั้น
 *
 *   read    เปิดหน้า อ่านชุดที่เก็บไว้ เร็วกว่าให้สคริปต์คิดใหม่มาก
 *   press   กดดึงใหม่ สคริปต์คิดใหม่แล้วเก็บแทนชุดเดิม ทุกเครื่องจะได้ชุดนี้
 *   status  ถามว่าชุดที่เก็บไว้เป็นของเวลาไหน คำตอบไม่กี่ร้อยตัวอักษร ถามทุกนาทีได้สบาย
 *   watch   ถามทุกนาทีเฉพาะตอนเปิดหน้าดูอยู่ สลับไปแท็บอื่นแล้วกลับมา ถามทันที
 *
 * สคริปต์รุ่นก่อนไม่รู้จักของพวกนี้ อ่านได้คำตอบแบบเดิม กดดึงใหม่ได้ "ไม่รู้จักคำสั่งนี้"
 * หน้าเว็บจึงต้องถอยไปใช้วิธีเดิมเอง (ดู OLD) จนกว่าจะวางสคริปต์ใหม่
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsShared (ต้องโหลด wms-gas.js ก่อน)
 */
(function () {
  'use strict';

  var EVERY = 60000;   // ถามทุกนาที
  var SOON = 15000;    // มีคนกำลังดึงอยู่ ถามถี่ขึ้น ชุดใหม่จะได้ขึ้นเร็ว

  /** คำตอบของสคริปต์รุ่นก่อนเมื่อส่ง op ที่ไม่รู้จัก */
  var OLD = 'ไม่รู้จักคำสั่งนี้';

  /** ชื่อที่ลงชื่อเข้าระบบไว้บนเครื่องนี้ ไปขึ้นเป็น "โดย …" บนทุกเครื่อง */
  function me() {
    try { return JSON.parse(localStorage.getItem('wms:session') || '{}').name || ''; }
    catch (e) { return ''; }
  }

  /** api อาจมีพารามิเตอร์ต่อท้ายอยู่แล้ว เช่น tx-daily&from=…&to=… */
  function read(url, api, opts) {
    return window.WmsGas.json(url, api + '&shared=1', opts);
  }

  /**
   * ส่งเป็น POST เพราะเป็นการสั่งให้เก็บชุดใหม่ และชื่อคนกดไม่ควรไปอยู่ใน URL
   * คำตอบมีสามแบบ: ข้อมูลชุดใหม่ / { busy } มีคนกำลังดึงอยู่ / { error: OLD } สคริปต์รุ่นก่อน
   */
  function press(url, api, extra, opts) {
    var body = { op: 'shared-fresh', api: api, by: me() };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return window.WmsGas.post(url, body, opts);
  }

  /** ถามเงียบ ๆ ไม่ขึ้นสายพานรอโหลด ล้มก็แค่รอถามรอบหน้า */
  function status(url) {
    return window.WmsGas.json(url, 'shared-at', { retries: 0, timeoutMs: 30000 }).catch(function () { return null; });
  }

  /** คำตอบนี้มาจากสคริปต์ที่มีข้อมูลกลางไหม */
  function knows(st, app) { return !!(st && st.app === app && st.shared); }

  function samePeriod(a, b) {
    a = a || {}; b = b || {};
    return String(a.from || '') === String(b.from || '') && String(a.to || '') === String(b.to || '');
  }

  /** เวลาของชุดที่หน้านี้ถืออยู่ ชุดจากสคริปต์รุ่นก่อนไม่มีป้าย ใช้เวลาที่คิดแทน */
  function stamp(data) {
    if (!data) return 0;
    return (data.shared && data.shared.at) || data.at || 0;
  }

  /**
   * ในสคริปต์มีชุดที่ใหม่กว่าที่ถืออยู่ไหม
   * ต้องใหม่กว่าเท่านั้น ชุดที่เพิ่งกดเองเครื่องนี้อาจใหม่กว่าที่ป้ายบอก ห้ามถอยกลับไปชุดเก่า
   * period ใส่เมื่อชุดนั้นผูกกับช่วงวันที่ (ยอดขายรายวัน) ช่วงไม่ตรงไม่นับว่าใหม่
   */
  function newer(st, name, data, period) {
    var i = st && st.shared && st.shared[name];
    if (!i) return false;
    if (period && !samePeriod(i.params, period)) return false;
    return i.at > stamp(data);
  }

  function running(st, name) { return (st && st.run && st.run[name]) || null; }

  /** ใครเป็นคนทำให้ได้ชุดนี้ ว่าง = สคริปต์รุ่นก่อนหรือคิดในเครื่องนี้เอง */
  function who(data) {
    var s = data && data.shared;
    if (!s) return '';
    return s.auto ? 'อัตโนมัติ' : (s.by || 'ไม่ทราบชื่อ');
  }

  /** ป้ายคนที่กำลังดึง "สมชาย" หรือ "รอบอัตโนมัติ" */
  function runner(run) {
    if (!run) return '';
    return run.auto ? 'รอบอัตโนมัติ' : (run.by || 'มีคน');
  }

  /** กำลังพิมพ์หรือเลือกอะไรอยู่ วาดหน้าใหม่ตอนนี้เคอร์เซอร์จะหลุด รอรอบหน้าดีกว่า */
  function typing() {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    var tag = String(a.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return tag === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(a.type || '');
  }

  /**
   * เรียก check ทุกนาทีขณะเปิดหน้าดูอยู่ หน้าที่ซ่อนอยู่ไม่ถาม กลับมาดูแล้วถามทันที
   * check คืน true = มีคนกำลังดึงหรือมีชุดใหม่ที่ยังโหลดไม่ได้ ถามถี่ขึ้น
   * check ที่ยังทำไม่เสร็จจะไม่ถูกเรียกซ้อน
   */
  function watch(check) {
    var timer = 0, busy = false, stopped = false;
    function next(ms) {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    }
    async function tick() {
      if (stopped || document.hidden) return;
      if (busy) { next(EVERY); return; }
      busy = true;
      var soon = false;
      try { soon = !!(await check()); }
      catch (e) { console.warn('เช็คข้อมูลกลางไม่สำเร็จ —', e.message); }
      busy = false;
      next(soon ? SOON : EVERY);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearTimeout(timer);
      else next(0);
    });
    next(EVERY);
    return {
      now: function () { next(0); },
      soon: function () { next(SOON); },
      stop: function () { stopped = true; clearTimeout(timer); },
    };
  }

  window.WmsShared = {
    EVERY: EVERY,
    SOON: SOON,
    OLD: OLD,
    me: me,
    read: read,
    press: press,
    status: status,
    knows: knows,
    samePeriod: samePeriod,
    stamp: stamp,
    newer: newer,
    running: running,
    who: who,
    runner: runner,
    typing: typing,
    watch: watch,
  };
})();
