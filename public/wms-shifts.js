/**
 * @file wms-shifts.js — ค่าตั้งกะ: แต่ละกะชื่ออะไร เข้า-ออกกี่โมง และใช้ตั้งแต่คาบไหน
 *
 * เดิมชื่อกะกับเวลา (กะเช้า 07:00-16:00 · กะบ่าย 16:00-24:00) ฝังอยู่ในตารางกะ สมุดกะ และเลขบนเมนู
 * แยกกันสามที่ กะเปลี่ยนทีต้องแก้โค้ดทุกที่ ตอนนี้ทุกหน้าถามจากไฟล์นี้ และหัวหน้าแก้เองได้ในแท็บ
 * "กะ" ของหน้าตารางกะ
 *
 * มีสองกะเสมอ เพราะมีสองกลุ่ม (A/B) สลับกันทุกคาบ รหัสกะ morning / evening คือ "กะที่ 1 / กะที่ 2"
 * ไม่ได้แปลว่าเช้ากับบ่ายอีกแล้ว — ยังใช้รหัสเดิมเพราะข้อมูลที่เก็บไว้ทั้งหมดผูกกับรหัสนี้
 * (คาบ.groupA, minStaff, osExtra['วัน|กะ'], รายการสมุดกะ, รหัสรับทราบงานต่อ)
 *
 * ค่าตั้งเก็บใน shiftDefs ของข้อมูลตารางกะ (localStorage wms:roster) จึงไปกับชีตส่วนกลางชุดเดียวกัน:
 *   [{ from: 'YYYY-MM-DD', shifts: { morning: {name, start, end, ack?}, evening: {...} } }]
 * from = วันแรกของคาบที่เริ่มใช้ ใช้ไปจนถึงรายการถัดไป วันก่อนรายการแรกใช้ค่าเริ่มต้น (BASE)
 * คาบที่ผ่านมาแล้วจึงยังเป็นชื่อและเวลาเดิม ไม่เปลี่ยนย้อนหลัง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsShifts · wms-badges.js (module) import ไฟล์นี้ตรง ๆ ได้ด้วย
 */
(function (root) {
  'use strict';

  var IDS = ['morning', 'evening'];
  /* ค่าที่ใช้มาตั้งแต่แรก แก้ไม่ได้ — ตารางย้อนหลังต้องตรงกับที่เกิดขึ้นจริง
     last: วันสุดท้ายของคาบ กะบ่ายเข้า 10:00-19:00 แทน เพราะวันรุ่งขึ้นสลับไปเข้ากะเช้า 07:00
     (ยกเว้นคนหยุดวันเสาร์) กติกานี้มีเฉพาะค่าเริ่มต้น ค่าที่ตั้งใหม่ไม่มี */
  var BASE = {
    from: '',
    shifts: {
      morning: { name: 'กะเช้า', start: '07:00', end: '16:00' },
      evening: { name: 'กะบ่าย', start: '16:00', end: '24:00', last: { start: '10:00', end: '19:00', skipOff: 6 } },
    },
  };
  var STORE_KEY = 'wms:roster';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /** 'HH:MM' → นาทีจากเที่ยงคืน (24:00 = 1440) */
  function mins(t) { var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }

  /**
   * เวลาที่คนพิมพ์ → 'HH:MM' หรือ '' ถ้าอ่านไม่ออก — รับ 10 · 10.00 · 10:00 · 1000 · 19.00น.
   * เวลาออกเป็น 24:00 ได้ (เที่ยงคืน) เวลาเข้าไม่ได้
   */
  function parseTime(s, isEnd) {
    var t = String(s == null ? '' : s).replace(/น\.?$/, '').replace(/\s+/g, '');
    var m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(t) || /^(\d{2})(\d{2})$/.exec(t);
    if (!m) return '';
    var h = +m[1], mm = +(m[2] || 0);
    if (mm > 59 || h > 24 || (h === 24 && (mm > 0 || !isEnd))) return '';
    return pad(h) + ':' + pad(mm);
  }

  function validTime(t, isEnd) { return typeof t === 'string' && parseTime(t, isEnd) === t; }

  /** ค่าของสองกะใช้ได้ไหม — คืนข้อความบอกคน หรือ '' ถ้าใช้ได้ */
  function check(shifts) {
    var names = {};
    for (var i = 0; i < IDS.length; i++) {
      var s = shifts && shifts[IDS[i]], n = i + 1;
      if (!s || typeof s.name !== 'string' || !s.name.trim()) return 'กะที่ ' + n + ' ยังไม่มีชื่อ';
      if (!validTime(s.start, false)) return 'เวลาเข้าของกะที่ ' + n + ' ไม่ถูก — ใส่เป็น ชั่วโมง:นาที เช่น 10:00';
      if (!validTime(s.end, true)) return 'เวลาออกของกะที่ ' + n + ' ไม่ถูก — ใส่เป็น ชั่วโมง:นาที เช่น 19:00';
      if (mins(s.start) === mins(s.end) % 1440) return 'กะที่ ' + n + ' เข้ากับออกเป็นเวลาเดียวกัน';
      if (names[s.name.trim()]) return 'สองกะชื่อซ้ำกัน';
      names[s.name.trim()] = 1;
    }
    return '';
  }

  /** "กะสาย" → "สาย" ไว้ใส่ป้ายเล็กในตาราง */
  function shortName(name) { return String(name).replace(/^กะ\s*/, '') || String(name); }

  /** กะ o มีคนทำงานอยู่ไหม ณ นาทีที่ t — กะข้ามเที่ยงคืน (ออกก่อนเวลาเข้า) ก็คิดได้ */
  function onDuty(o, t) {
    var s = mins(o.start), e = mins(o.end);
    return e > s ? t >= s && t < e : t >= s || t < e;
  }

  /** ค่าตั้งหนึ่งรายการ พร้อมของที่คิดจากเวลา: ลำดับกะตามเวลาเข้า และกะไหนต้องรับทราบงานต่อ */
  function build(def) {
    var out = { from: def.from, shifts: {}, order: [] }, anySet = false;
    IDS.forEach(function (id) {
      var s = def.shifts[id];
      out.shifts[id] = {
        id: id, name: s.name.trim(), short: shortName(s.name.trim()), start: s.start, end: s.end,
        last: s.last || null, ackSet: typeof s.ack === 'boolean' ? s.ack : null, ack: false,
      };
      if (out.shifts[id].ackSet !== null) anySet = true;
    });
    out.order = IDS.slice().sort(function (a, b) {
      return mins(out.shifts[a].start) - mins(out.shifts[b].start) || IDS.indexOf(a) - IDS.indexOf(b);
    });
    /* รับทราบงานต่อ: กะที่เข้างานตอนอีกกะยังทำงานอยู่ ไม่มีใครต้องฝากงานไว้ จึงไม่ต้องกดรับทราบ
       (กะเช้า 07-16 กับกะสาย 10-19: กะสายเข้ามาเจอกะเช้าอยู่ · กะเช้าเข้ามาไม่เจอใคร ต้องรับงานที่กะสายฝากไว้)
       คนติ๊กเองในหน้าตั้งค่าได้ ติ๊กแล้วใช้ตามที่ติ๊ก */
    IDS.forEach(function (id) {
      var s = out.shifts[id];
      s.ack = s.ackSet !== null ? s.ackSet : !IDS.some(function (o) {
        return o !== id && onDuty(out.shifts[o], mins(s.start));
      });
    });
    // สองกะเข้าพร้อมกันเป๊ะ ต่างคนต่างเห็นอีกกะอยู่ — ให้กะแรกเป็นคนรับ ไม่งั้นไม่มีใครรับเลยโดยไม่มีใครตั้งใจ
    if (!anySet && !IDS.some(function (id) { return out.shifts[id].ack; })) out.shifts[out.order[0]].ack = true;
    return out;
  }

  var BASE_BUILT = build(BASE);

  /**
   * ค่าตั้งทั้งหมดเรียงตามวันเริ่ม ตัวแรกคือค่าเริ่มต้นเสมอ — รายการที่ข้อมูลเพี้ยนข้ามไป
   * (ชีตเป็นของกลาง เครื่องอื่นอาจส่งอะไรมาก็ได้ หน้าที่อ่านต้องไม่พัง)
   */
  function list(defs) {
    var by = {};
    (Array.isArray(defs) ? defs : []).forEach(function (d) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.from) || check(d.shifts)) return;
      by[d.from] = build(d);
    });
    return [BASE_BUILT].concat(Object.keys(by).sort().map(function (k) { return by[k]; }));
  }

  function atL(L, date) {
    var cur = L[0];
    for (var i = 1; i < L.length; i++) if (L[i].from <= date) cur = L[i];
    return cur;
  }
  /** ค่าตั้งที่ใช้ ณ วันที่ date ('YYYY-MM-DD') */
  function at(defs, date) { return atL(list(defs), String(date || '')); }

  /** กะ id ของวันนั้น — รหัสที่ไม่รู้จักนับเป็นกะที่ 2 เหมือนที่สมุดกะทำมาตลอด */
  function shift(defs, date, id) {
    var d = at(defs, date);
    return d.shifts[id] || d.shifts.evening;
  }
  function name(defs, date, id) { return shift(defs, date, id).name; }

  function hm(t) { var p = String(t).split(':'); return +p[1] ? t : p[0]; }
  /** "07:00-16:00" */
  function timeText(s) { return s.start + '-' + s.end; }
  /** "07–16" ไว้ใส่ที่แคบ ๆ — มีนาทีก็คงไว้ */
  function timeShort(s) { return hm(s.start) + '–' + hm(s.end); }
  /** ค่าช่องของวันที่ใช้เวลาพิเศษ: {start:'10:00', end:'19:00'} → "10-19" */
  function hoursLabel(s) { var a = hm(s.start), b = hm(s.end); return String(+a === +a ? +a : a) + '-' + String(+b === +b ? +b : b); }

  /** กะที่เข้างานล่าสุด ณ นาทีที่ m ของวัน (onlyAck = เฉพาะกะที่ต้องรับทราบงานต่อ) */
  function started(def, m, onlyAck) {
    var best = null;
    def.order.forEach(function (id) {
      var s = def.shifts[id];
      if ((!onlyAck || s.ack) && mins(s.start) <= m) best = id;
    });
    return best;
  }
  function when(defs, t, onlyAck) {
    var L = list(defs), d = ymd(t), id = started(atL(L, d), t.getHours() * 60 + t.getMinutes(), onlyAck);
    if (id) return { date: d, shift: id };
    // ยังไม่ถึงเวลาเข้าของกะแรก = คนกะสุดท้ายของเมื่อวานยังปิดงานอยู่
    var y = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
    id = started(atL(L, y), 1440, onlyAck);
    return id ? { date: y, shift: id } : null;
  }

  /**
   * กะของเวลานี้ — กะที่เข้างานล่าสุด ก่อนกะแรกเข้ายังเป็นกะสุดท้ายของเมื่อวาน
   * (ค่าเริ่มต้น: 07:00–15:59 กะเช้า · 16:00 เป็นต้นไปกะบ่าย · ก่อน 07:00 กะบ่ายของเมื่อวาน)
   * @returns {{date:string, shift:string}}
   */
  function now(defs, t) { return when(defs, t, false); }

  /**
   * กะที่ต้องกดรับทราบงานต่อ ณ เวลานี้ — กะล่าสุดที่เข้างานมาแล้วไม่เจอใคร
   * null = ช่วงนี้ไม่มีกะไหนต้องรับ (ตั้งไว้ว่าไม่ต้องรับทั้งสองกะ)
   */
  function receiver(defs, t) { return when(defs, t, true); }

  function pos(L, date, id) {
    var i = atL(L, date).order.indexOf(id);
    return i < 0 ? IDS.length : i;
  }
  /** (a.date, a.shift) มาก่อน (b.date, b.shift) ไหม — วันเดียวกันดูจากเวลาเข้างาน */
  function before(defs, a, b) {
    if (a.date !== b.date) return a.date < b.date;
    var L = list(defs);
    return pos(L, a.date, a.shift) < pos(L, b.date, b.shift);
  }
  /** ตัวเรียง: ตามวัน แล้วกะที่เข้าก่อนขึ้นก่อน (0 = วันและกะเดียวกัน) */
  function sorter(defs) {
    var L = list(defs);
    return function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.shift === b.shift ? 0 : pos(L, a.date, a.shift) - pos(L, b.date, b.shift);
    };
  }
  /** รหัสกะของวันนั้น เรียงตามเวลาเข้า */
  function order(defs, date) { return at(defs, date).order.slice(); }

  /** ชื่อกะที่ใช้ในช่วง from..to ไม่ซ้ำ เรียงตามที่ใช้ — เดือนที่คร่อมวันเปลี่ยนกะมีมากกว่าสองชื่อ */
  function names(defs, from, to) {
    var L = list(defs), out = [];
    L.forEach(function (d, i) {
      var end = i + 1 < L.length ? L[i + 1].from : '9999-99-99';   // วันแรกที่เลิกใช้
      if (d.from > to || end <= from) return;
      d.order.forEach(function (id) { if (out.indexOf(d.shifts[id].name) < 0) out.push(d.shifts[id].name); });
    });
    return out;
  }

  /** ค่าตั้งต้นของรายการใหม่ — ชื่อกับเวลาของค่าที่ใช้อยู่ ไม่พากติกาวันสุดท้ายคาบกับช่องที่ติ๊กเองมาด้วย */
  function blank(def) {
    var o = {};
    IDS.forEach(function (id) { var s = def.shifts[id]; o[id] = { name: s.name, start: s.start, end: s.end }; });
    return o;
  }

  /** ค่าตั้งกะที่เครื่องนี้มี (จากข้อมูลตารางกะในเบราว์เซอร์) */
  function local(store) {
    try {
      var d = JSON.parse((store || root.localStorage).getItem(STORE_KEY) || 'null');
      return (d && Array.isArray(d.shiftDefs) && d.shiftDefs) || [];
    } catch (e) { return []; }
  }

  root.WmsShifts = {
    IDS: IDS, BASE: BASE,
    parseTime: parseTime, check: check, shortName: shortName,
    list: list, at: at, shift: shift, name: name, order: order, names: names, blank: blank,
    timeText: timeText, timeShort: timeShort, hoursLabel: hoursLabel,
    now: now, receiver: receiver, before: before, sorter: sorter, local: local,
  };
})(typeof window !== 'undefined' ? window : globalThis);
