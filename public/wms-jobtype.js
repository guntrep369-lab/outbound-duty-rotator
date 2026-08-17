/**
 * @file wms-jobtype.js — อ่านหมายเหตุของเซล แล้วบอกว่างานนั้นเป็นงานประเภทไหน
 *
 * ── ทำไมต้องมี ─────────────────────────────────────────────────────────
 * ชีตออเดอร์ไม่มีคอลัมน์ "ประเภทงาน" สิ่งเดียวที่บอกได้คือหมายเหตุที่เซลพิมพ์
 * เป็นภาษาคน และประเภทงานเปลี่ยนสิ่งที่ทีมต้องเตรียมจริง ๆ:
 *   • งานเปลี่ยนสินค้า ต้องเว้นที่บนรถขากลับ และเอาถุงคลุมไปด้วย
 *   • งานส่งเจ้าหน้าที่ ต้องมีคนไป ไม่ใช่แค่คนขับ
 *   • งานติดตั้ง/ประกอบ กินเวลาต่อจุดคนละเรื่องกับวางของแล้วไป
 * ทุกวันนี้ข้อมูลนี้ไหลผ่านระบบไปเป็นข้อความดิบ ไม่มีใครนับได้ว่าวันนี้มีอย่างละกี่งาน
 *
 * ── ข้อจำกัดที่ต้องพูดให้ชัด ────────────────────────────────────────────
 * ตัวนี้ทำงานในเบราว์เซอร์ จึงเป็นการจับคำตามกฎ ไม่ใช่การอ่านเข้าใจภาษาจริง
 * เอกสารกฎต้นทาง (skill: delivery-note-classifier) เตือนไว้ตรง ๆ ว่าโน๊ตจริง
 * กำกวมเกินกว่าที่การจับคำจะรับไหว
 *
 * ที่นี่จึงออกแบบให้ "ไม่รู้" ได้ แทนที่จะเดาให้ครบ: เคสที่สัญญาณขัดกันหรืออ่อน
 * จะถูกตีเป็น needs_review พร้อมเหตุผล ไม่ใช่ยัดเข้าประเภทใดประเภทหนึ่งอย่าง
 * มั่นใจ — เพราะการจัดผิดประเภททำให้ทีมไม่เตรียมที่รับของกลับ ซึ่งแย่กว่าการ
 * บอกว่า "อันนี้ต้องอ่านเอง"
 *
 * ลำดับการตัดสินและคีย์เวิร์ดมาจาก references/classification-rules.md ของ skill
 * ไม่ได้คิดขึ้นเอง — ลำดับสำคัญเพราะคำว่า "รับกลับ" อยู่ได้ทั้งประเภท 2, 3 และ 4
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsJobType
 */
(function () {
  'use strict';

  var TYPES = {
    1: { code: 'DELIVERY',     label: 'จัดส่งทั่วไป',        icon: '📦' },
    2: { code: 'SWAP',         label: 'ส่งเปลี่ยน/เคลม',     icon: '🔄' },
    3: { code: 'SERVICE',      label: 'ส่งเจ้าหน้าที่',      icon: '🧰' },
    4: { code: 'EVENT_PICKUP', label: 'รับกลับจากงาน',       icon: '🎪' },
  };

  var has = function (t, words) {
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) !== -1) return true;
    return false;
  };

  /* บริบทงานอีเว้นท์/สตูดิโอ — ของถูกยืมไปแสดงแล้วต้องไปเก็บกลับ */
  var EVENT = ['event', 'อีเว้น', 'อีเวนต์', 'อีเว้นท์', 'งานถ่าย', 'ถ่ายโฆษณา', 'ถ่ายแบบ',
               'studio', 'สตูดิโอ', 'บูธ', 'งานแฟร์', 'จัดแสดง'];
  var PICKUP = ['รับกลับ', 'เก็บกลับ', 'ไปรับ', 'เก็บของ', 'รื้อบูธ', 'กลับมา', 'เดิมกลับ', 'ชิ้นเดิมกลับ'];

  /* ภาษาไทยคั่น "รับ" กับ "กลับ" ด้วยตัวสินค้าเสมอ — "รับที่นอน 4 หลังกลับจากงานถ่าย"
     หรือ "รับ Lunio Quantum Max 2 Mattress ขนาด 5ฟุต หลังเดิมกลับ" การจับคำติดกัน
     จึงไม่มีทางเจอ ต้องยอมให้มีอะไรคั่นอยู่ตรงกลางได้ */
  var PICKUP_SPLIT = /รับ[\s\S]{0,45}กลับ/;

  function isPickup(t) { return has(t, PICKUP) || PICKUP_SPLIT.test(t); }

  /* ต้องเป็นสำนวน "ส่งคนไป" ไม่ใช่แค่มีคำว่าเจ้าหน้าที่ลอย ๆ
     หมายเหตุจริงเขียนว่า "รบกวนเจ้าหน้าที่ประกอบสินค้าให้ลูกค้า" ซึ่งเป็นงานส่งของ
     ที่ขอให้ช่วยประกอบ ไม่ใช่การส่งช่างไปตรวจหน้างาน */
  var SERVICE = ['ส่งช่าง', 'ส่งเจ้าหน้าที่', 'ส่งจนท', 'ส่ง จนท', 'ทีมช่าง', 'เข้าตรวจสอบ',
                 'ตรวจเช็ค', 'เช็คหน้างาน', 'แก้ไขหน้างาน', 'เข้าหน้างาน', 'ซ่อม',
                 'เข้าไปดู', 'ประเมินหน้างาน', 'ตรวจสอบหน้างาน'];

  var SWAP_CHANGE = ['เปลี่ยน', 'เคลม', 'ตัวใหม่', 'หลังใหม่', 'ตัวเดิม', 'หลังเดิม', 'ชิ้นเดิม'];
  var SWAP_CAUSE  = ['ชำรุด', 'ตำหนิ', 'รอยขาด', 'ผ้าหุ้มขาด', 'ยุบ', 'พัง', 'มีปัญหา', 'ให้เคลม'];
  var SEND        = ['จัดส่ง', 'ส่งของ', 'นำส่ง', 'ส่งที่นอน', 'ส่งสินค้า', 'ส่ง'];
  var CONDITION   = ['ถ้า', 'หาก', 'กรณี', 'เผื่อ'];

  /* งานที่ต้องเตรียมของหรือคนเพิ่ม — ไม่ใช่ประเภทงาน แต่เปลี่ยนการจัดรถ */
  var FLAGS = [
    { id: 'install', label: 'ติดตั้ง/ประกอบ', words: ['ติดตั้ง', 'ประกอบ', 'แกะ', 'ยกเข้า'] },
    { id: 'call',    label: 'โทรก่อนถึง',     words: ['โทรก่อน', 'โทรแจ้ง', 'โทรหา'] },
    { id: 'cover',   label: 'เอาถุงคลุมไป',   words: ['ถุงคลุม', 'คลุมที่นอน'] },
    { id: 'staff',   label: 'ต้องมีเจ้าหน้าที่', words: ['เจ้าหน้าที่', 'จนท', 'ช่าง'] },
    { id: 'map',     label: 'มีลิงก์แผนที่',   words: ['maps.app.goo', 'google.com/maps', 'goo.gl/maps'] },
  ];

  var DONE   = ['ส่งแล้ว', 'ส่งเรียบร้อย', 'จัดส่งสำเร็จ', 'รับแล้ว', 'เก็บกลับแล้ว', 'เซ็นรับ', 'done'];
  var PENDING = ['รอจัดส่ง', 'ยังไม่ส่ง', 'เลื่อน', 'ไม่รับสาย', 'ส่งไม่สำเร็จ', 'นัดใหม่', 'รอนัด', 'รอสินค้า'];

  /**
   * @param {string} note หมายเหตุดิบจากชีต
   * @returns {{type:number, code:string, label:string, icon:string,
   *            hasReturn:string, status:string, flags:Array, confidence:string,
   *            needsReview:boolean, why:string}}
   */
  function classify(note) {
    var raw = String(note == null ? '' : note).trim();
    var t = raw.toLowerCase();

    var out = function (type, conf, why, review) {
      var f = FLAGS.filter(function (x) { return has(t, x.words); });
      // "ต้องมีเจ้าหน้าที่" ซ้ำกับตัวประเภทงานเอง ไม่ต้องขึ้นซ้ำ
      if (type === 3) f = f.filter(function (x) { return x.id !== 'staff'; });
      return {
        type: type, code: TYPES[type].code, label: TYPES[type].label, icon: TYPES[type].icon,
        hasReturn: returnOf(t, type),
        status: has(t, DONE) ? 'เสร็จสิ้น' : has(t, PENDING) ? 'ค้าง' : 'ไม่ระบุ',
        flags: f.map(function (x) { return { id: x.id, label: x.label }; }),
        confidence: conf, needsReview: !!review, why: why, note: raw,
      };
    };

    if (!raw) {
      return out(1, 'ต่ำ', 'ไม่มีหมายเหตุ — เดาไม่ได้ว่าเป็นงานแบบไหน', true);
    }

    var evt      = has(t, EVENT);
    var pickup   = isPickup(t);
    var service  = has(t, SERVICE);
    var change   = has(t, SWAP_CHANGE) || has(t, SWAP_CAUSE);
    var send     = has(t, SEND);

    // 4) รับกลับจากงาน — ต้องมีบริบทงาน + เป็นการรับกลับ + ไม่ใช่ขาส่งไปงาน
    if (evt && pickup && !send) {
      return out(4, 'สูง', 'มีบริบทงานอีเว้นท์/สตูดิโอ และเป็นการไปรับกลับ');
    }

    // 3) ส่งคนไป — เช็คก่อน SWAP ตามลำดับในกฎ
    if (service) {
      if (send && pickup && change) {
        return out(2, 'ปานกลาง',
          'มีทั้งส่งของใหม่และรับของเดิมกลับ เจ้าหน้าที่ไปช่วยติดตั้ง — งานหลักคือการเปลี่ยนสินค้า');
      }
      return out(3, 'สูง', 'สิ่งที่ส่งไปคือคน (ช่าง/เจ้าหน้าที่) ไม่ใช่สินค้า');
    }

    // 2) ส่งเปลี่ยน — ต้องมีทั้งขาส่งและขารับ
    if (send && pickup && change) {
      return out(2, 'สูง', 'ส่งของใหม่และรับของเดิมกลับในงานเดียวกัน');
    }

    /* รับของกลับอย่างเดียวโดยไม่ส่งอะไรไป และไม่ใช่งานอีเว้นท์ — กฎระบุว่าเป็น
       เคสกำกวม ให้ตีเป็นประเภท 3 แล้วตั้งธงให้คนอ่านเอง ไม่ใช่เดาให้จบ */
    if (pickup && !send) {
      return out(3, 'ต่ำ',
        'เป็นการรับของกลับแต่ไม่มีการส่งของใหม่ และไม่ได้บอกว่ารับจากงานอีเว้นท์ — อาจเป็นเคลมหรือรับกลับเฉย ๆ', true);
    }

    // มีสัญญาณเปลี่ยนสินค้าแต่ไม่มีขารับกลับชัดเจน
    if (change && send) {
      return out(1, 'ปานกลาง', 'พูดถึงการเปลี่ยน/เคลม แต่ไม่ได้บอกว่ารับของเดิมกลับ', true);
    }

    return out(1, 'สูง', 'ส่งสินค้าอย่างเดียว ไม่มีสัญญาณของประเภทอื่น');
  }

  function returnOf(t, type) {
    if (type === 4) return 'มี';
    if (!isPickup(t)) return 'ไม่มี';
    return has(t, CONDITION) ? 'ไม่แน่ใจ' : 'มี';
  }

  /** นับผลรวมของทั้งวัน ใช้บนหน้าสรุป */
  function summarise(list) {
    var by = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var ret = 0, review = 0, flags = {};
    (list || []).forEach(function (r) {
      by[r.type]++;
      if (r.hasReturn === 'มี') ret++;
      if (r.needsReview) review++;
      r.flags.forEach(function (f) { flags[f.id] = (flags[f.id] || 0) + 1; });
    });
    return { total: (list || []).length, byType: by, withReturn: ret, needsReview: review, flags: flags };
  }

  /**
   * แปลงงานทั้งวันเป็นแถวสำหรับไฟล์ Excel
   *
   * คอลัมน์เดิมจากชีตมาก่อน แล้วค่อยต่อด้วยคอลัมน์ที่ระบบเติมให้ ตามที่กฎต้นทาง
   * กำหนดไว้ — คนที่เปิดไฟล์จะได้เทียบกับชีตของตัวเองได้ทีละบรรทัดโดยไม่ต้อง
   * ไล่หาว่าคอลัมน์ไหนคือของเดิม
   *
   * "เหตุผล" ติดไปด้วยเสมอ เพราะไฟล์นี้จะถูกส่งต่อให้คนที่ไม่ได้นั่งดูหน้าจอ
   * ตอนจัดประเภท ตัวเลขที่อธิบายที่มาไม่ได้จะไม่มีใครกล้าเอาไปใช้จัดรถ
   *
   * @param {Array} jobs [{id, carrier, customer, phone, address, apptTime, date, note, job}]
   * @returns {Array<object>} แถวพร้อมเขียนลงไฟล์ หัวคอลัมน์เป็นภาษาไทย
   */
  function exportRows(jobs) {
    return (jobs || []).map(function (j) {
      var g = j.job || classify(j.note);
      return {
        'เลขออเดอร์': j.id || '',
        'ขนส่ง': j.carrier || '',
        'ชื่อลูกค้า': j.customer || '',
        'เบอร์โทร': j.phone || '',
        'ที่อยู่': j.address || '',
        'เวลานัด': j.apptTime || '',
        'วันที่': j.date || '',
        'หมายเหตุ': g.note || '',
        'ประเภทงาน': g.type,
        'ชื่อประเภท': g.label,
        'มีรับของกลับ': g.hasReturn,
        'สถานะ': g.status,
        'ต้องเตรียม': g.flags.map(function (f) { return f.label; }).join(', '),
        'ความมั่นใจ': g.confidence,
        'ต้องอ่านเอง': g.needsReview ? 'ใช่' : '',
        'เหตุผลที่จัดประเภทนี้': g.why,
      };
    });
  }

  /**
   * ชื่อชีตที่ Excel ยอมรับ
   *
   * Excel ห้าม \ / ? * [ ] : ในชื่อชีต และจำกัด 31 ตัวอักษร — ชื่อประเภทงานของเรา
   * มี "ส่งเปลี่ยน/เคลม" ซึ่งมีสแลชอยู่ ถ้าส่งดิบ ๆ ไฟล์จะเปิดไม่ขึ้นทั้งไฟล์
   */
  function sheetName(s) {
    return String(s == null ? '' : s).replace(/[\\/\?\*\[\]:]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 31) || 'ชีต';
  }

  /**
   * ทุกกลุ่มในไฟล์เดียว — ชีตละกลุ่ม
   *
   * ก่อนหน้านี้ไฟล์ได้เฉพาะที่กรองอยู่บนหน้าจอ ใครอยากได้ครบทุกสถานะต้องกดออก
   * หกรอบแล้วเอามารวมเอง ซึ่งเป็นงานที่ไฟล์ควรทำให้ตั้งแต่แรก
   *
   * กลุ่มที่ไม่มีงานเลยจะไม่สร้างชีต — ชีตเปล่าทำให้คนเปิดต้องไล่กดดูทีละแท็บ
   * เพื่อพบว่าไม่มีอะไร
   *
   * @param {Array} jobs งานที่จะใส่ในไฟล์ (กรองขนส่งมาแล้วถ้าต้องการ)
   * @returns {Array<{name:string, rows:Array, headers:Array}>}
   */
  function exportBook(jobs) {
    var list = jobs || [];
    var g = function (j) { return j.job || classify(j.note); };
    var out = [{ name: 'ทั้งหมด', rows: exportRows(list), headers: EXPORT_HEADERS }];

    [1, 2, 3, 4].forEach(function (n) {
      var part = list.filter(function (j) { return g(j).type === n; });
      if (part.length) out.push({ name: sheetName(TYPES[n].label), rows: exportRows(part), headers: EXPORT_HEADERS });
    });

    var ret = list.filter(function (j) { return g(j).hasReturn !== 'ไม่มี'; });
    if (ret.length) out.push({ name: 'ต้องรับของกลับ', rows: exportRows(ret), headers: EXPORT_HEADERS });

    var rev = list.filter(function (j) { return g(j).needsReview; });
    if (rev.length) out.push({ name: 'ต้องอ่านเอง', rows: exportRows(rev), headers: EXPORT_HEADERS });

    out.push({ name: 'สรุป', rows: exportSummary(list), headers: ['รายการ', 'จำนวน'] });
    return out;
  }

  /** ลำดับคอลัมน์ในไฟล์ ใช้บังคับให้แถวที่มีค่าว่างยังอยู่คอลัมน์เดิม */
  var EXPORT_HEADERS = ['เลขออเดอร์', 'ขนส่ง', 'ชื่อลูกค้า', 'เบอร์โทร', 'ที่อยู่', 'เวลานัด',
    'วันที่', 'หมายเหตุ', 'ประเภทงาน', 'ชื่อประเภท', 'มีรับของกลับ', 'สถานะ', 'ต้องเตรียม',
    'ความมั่นใจ', 'ต้องอ่านเอง', 'เหตุผลที่จัดประเภทนี้'];

  /** แถวสรุปยอด ใส่เป็นชีตที่สองในไฟล์ */
  function exportSummary(jobs) {
    var s = summarise((jobs || []).map(function (j) { return j.job || classify(j.note); }));
    var rows = [];
    [1, 2, 3, 4].forEach(function (n) {
      rows.push({ 'รายการ': TYPES[n].label, 'จำนวน': s.byType[n] });
    });
    rows.push({ 'รายการ': 'รวมทั้งหมด', 'จำนวน': s.total });
    rows.push({ 'รายการ': 'ต้องรับของกลับ', 'จำนวน': s.withReturn });
    rows.push({ 'รายการ': 'ต้องอ่านเอง', 'จำนวน': s.needsReview });
    FLAGS.forEach(function (f) {
      if (s.flags[f.id]) rows.push({ 'รายการ': f.label, 'จำนวน': s.flags[f.id] });
    });
    return rows;
  }

  window.WmsJobType = {
    TYPES: TYPES,
    FLAGS: FLAGS,
    EXPORT_HEADERS: EXPORT_HEADERS,
    classify: classify,
    summarise: summarise,
    exportRows: exportRows,
    exportSummary: exportSummary,
    exportBook: exportBook,
    sheetName: sheetName,
  };
})();
