/**
 * @file roster-people.js — กลุ่มกับวันหยุดที่เปลี่ยนตามช่วงเวลา และวันลา ของคนในตารางกะ
 *
 * เดิมคนหนึ่งมีกลุ่มกับวันหยุดได้ค่าเดียว ย้ายกลุ่มเมื่อไหร่ คาบที่ผ่านไปแล้วก็ย้ายตาม
 * ตารางย้อนหลังจึงไม่ตรงกับที่เกิดขึ้นจริง ตอนนี้ group / dayOff ของคนคือค่าตั้งต้น
 * และ changes[{from, group?, dayOff?}] เก็บว่าตั้งแต่วันไหนเปลี่ยนอะไร
 * แต่ละรายการเก็บเฉพาะค่าที่เปลี่ยนวันนั้น — ย้ายกลุ่มตั้งแต่คาบ 5 แล้วมีเปลี่ยนวันหยุด
 * ไว้ที่คาบ 8 อยู่ก่อน คาบ 8 ต้องยังอยู่กลุ่มใหม่ ไม่เด้งกลับกลุ่มเดิม
 *
 * วันลาเก็บในช่องแก้ไขเหมือน W / H (overrides['วันที่|ชื่อ']) ด้วยรหัส SL / PL / VL
 * จึงรวมข้ามเครื่องทีละช่องได้เหมือนเดิม และเปลี่ยนชื่อคนแล้ววันลาย้ายตามไปด้วย
 * ขาดงาน (AB) เก็บแบบเดียวกัน ส่วนมาสายกับ OT เป็นของวันที่มาทำงาน จึงเก็บแยก
 * late['วันที่|ชื่อ'] = นาที · ot['วันที่|ชื่อ'] = ชั่วโมง
 *
 * โหลดเป็น classic script เปิดเป็น window.RosterPeople
 */
(function () {
  'use strict';

  /* ขาดงานไม่ใช่วันลา แต่ใช้แบบเดียวกันทุกอย่าง: ไม่นับเป็นคนมาทำงาน ปุ่มล้างแก้ไขไม่ล้าง
     และนับไว้ทั้งปี — หน้าการลานับแยกคอลัมน์ ไม่รวมกับยอดลา */
  var LEAVE = {
    SL: { short: 'ลป', label: 'ลาป่วย' },
    PL: { short: 'ลก', label: 'ลากิจ' },
    VL: { short: 'ลพ', label: 'พักร้อน' },
    AB: { short: 'ขาด', label: 'ขาดงาน' },
  };
  // ชั่วโมงทำงานปกติต่อวัน — ตัวหารของ OT Rate
  var HOURS = 8;
  var FIELDS = ['group', 'dayOff'];

  function has(c, f) { return Object.prototype.hasOwnProperty.call(c, f); }
  function byFrom(a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; }

  /** ช่องนี้นับเป็นคนมาทำงานไหม — หยุดกับลาไม่นับ */
  function isWork(v) { return v === 'W' || v === '10-19'; }
  function isLeave(v) { return has(LEAVE, v); }

  /**
   * ค่าที่ใช้ ณ วันที่ s — before=true ไม่นับการเปลี่ยนที่เริ่มวัน s เอง (ค่าก่อนวันนั้น)
   * ไม่มีวันหยุดประจำ = -1 · OS ในข้อมูลรุ่นเก่าไม่มีช่อง dayOff เลย
   */
  function upto(p, s, before) {
    var v = { group: p.group, dayOff: p.dayOff == null ? -1 : p.dayOff };
    (p.changes || []).slice().sort(byFrom).forEach(function (c) {
      if (before ? c.from >= s : c.from > s) return;
      FIELDS.forEach(function (f) { if (has(c, f)) v[f] = c[f]; });
    });
    return v;
  }

  /** กลุ่มกับวันหยุดของ p ณ วันที่ s (YYYY-MM-DD) */
  function at(p, s) { return upto(p, s, false); }

  /** ทิ้งรายการที่ไม่เหลือค่าที่เปลี่ยน แล้วเรียงตามวัน */
  function keep(p, ch) {
    ch = ch.filter(function (c) { return FIELDS.some(function (f) { return has(c, f); }); }).sort(byFrom);
    if (ch.length) p.changes = ch; else delete p.changes;
  }

  /**
   * ตั้งค่าใน vals ({group?, dayOff?}) ให้ p ตั้งแต่วันที่ from จนถึงการเปลี่ยนค่านั้นครั้งถัดไปที่บันทึกไว้
   * ค่าที่เท่ากับก่อนวันนั้นอยู่แล้วไม่เก็บ — แตะช่องแล้วเลือกค่าเดิมจะได้ไม่มีประวัติงอกขึ้นมา
   * from ว่าง = แก้ค่าตั้งต้นและลบค่านั้นออกจากประวัติ ใช้แก้ข้อมูลที่ใส่ผิดมาตั้งแต่แรก
   */
  function setFrom(p, from, vals) {
    var ch = p.changes || [];
    if (!from) {
      FIELDS.forEach(function (f) {
        if (!has(vals, f)) return;
        p[f] = vals[f];
        ch.forEach(function (c) { delete c[f]; });
      });
    } else {
      var prev = upto(p, from, true), e = null;
      ch.forEach(function (c) { if (c.from === from) e = c; });
      if (!e) { e = { from: from }; ch.push(e); }
      FIELDS.forEach(function (f) {
        if (!has(vals, f)) return;
        if (vals[f] === prev[f]) delete e[f]; else e[f] = vals[f];
      });
    }
    keep(p, ch);
  }

  /** ลบการเปลี่ยนที่เริ่มวันที่ from — ช่วงนั้นกลับไปใช้ค่าก่อนหน้า */
  function unset(p, from) {
    keep(p, (p.changes || []).filter(function (c) { return c.from !== from; }));
  }

  /**
   * นับวันลาและวันขาดงานในช่วง from..to (รวมหัวท้าย) แยกตามชื่อ
   * @returns {Object<string,{SL:number,PL:number,VL:number,AB:number,days:Array<[string,string]>}>}
   */
  function tally(overrides, from, to) {
    var out = {};
    for (var k in overrides) {
      var v = overrides[k];
      if (!isLeave(v)) continue;
      var b = k.indexOf('|'), d = k.slice(0, b), n = k.slice(b + 1);
      if (d < from || d > to) continue;
      var t = out[n] || (out[n] = { SL: 0, PL: 0, VL: 0, AB: 0, days: [] });
      t[v]++;
      t.days.push([d, v]);
    }
    for (var nm in out) out[nm].days.sort(function (a, c) { return a[0] < c[0] ? -1 : 1; });
    return out;
  }

  /**
   * มาทำงาน / ขาด / สาย / OT ของคนหนึ่ง — ใช้คิด KPI Attendance กับ OT Rate
   * days = [[วันที่, ค่าช่อง]] ค่าที่เห็นในตาราง (ตามตารางหรือที่แก้ไว้) เฉพาะวันที่ผ่านมาแล้ว
   * วันที่ต้องมา = วันมาทำงาน + วันขาด · วันลากับวันหยุดไม่นับ
   * สายนับเฉพาะวันที่มาทำงาน · OT นับทุกวัน รวมวันหยุดที่มาทำ OT
   * @returns {{due, worked, absent, lateDays, lateMins, otHours, attend:number|null, otRate:number|null}}
   */
  function attend(name, days, late, ot) {
    var r = { due: 0, worked: 0, absent: 0, lateDays: 0, lateMins: 0, otHours: 0 };
    late = late || {}; ot = ot || {};
    days.forEach(function (x) {
      var k = x[0] + '|' + name, m = Number(late[k]) || 0;
      if (isWork(x[1])) {
        r.worked++;
        if (m > 0) { r.lateDays++; r.lateMins += m; }
      } else if (x[1] === 'AB') r.absent++;
      r.otHours += Number(ot[k]) || 0;
    });
    r.due = r.worked + r.absent;
    // Attendance = (1 − (ขาด + สาย) ÷ วันที่ต้องมา) × 100 · OT Rate = OT ÷ ชั่วโมงปกติของวันที่มา × 100
    r.attend = r.due ? (1 - (r.absent + r.lateDays) / r.due) * 100 : null;
    r.otRate = r.worked ? r.otHours / (r.worked * HOURS) * 100 : null;
    return r;
  }

  /**
   * รวม late หรือ ot ในช่วง from..to แยกตามชื่อ — กี่วัน และรวมกี่นาที / ชั่วโมง
   * @returns {Object<string,{days:number,total:number}>}
   */
  function sum(map, from, to) {
    var out = {};
    for (var k in map || {}) {
      var v = Number(map[k]) || 0, b = k.indexOf('|'), d = k.slice(0, b), n = k.slice(b + 1);
      if (v <= 0 || d < from || d > to) continue;
      var t = out[n] || (out[n] = { days: 0, total: 0 });
      t.days++;
      t.total += v;
    }
    return out;
  }

  /**
   * วันแรกที่บันทึกขาด / สาย และวันแรกที่บันทึก OT ('' = ยังไม่เคย)
   * เดือนก่อนหน้านั้นยังไม่มีใครบันทึก — ถ้าคิด KPI ให้ ทุกคนจะได้ 100% / OT 0% ซึ่งไม่จริง
   */
  function firstMark(overrides, late, ot) {
    var r = { attend: '', ot: '' };
    function seen(f, k) { var d = k.slice(0, k.indexOf('|')); if (!r[f] || d < r[f]) r[f] = d; }
    var k;
    for (k in overrides || {}) if (overrides[k] === 'AB') seen('attend', k);
    for (k in late || {}) if (Number(late[k]) > 0) seen('attend', k);
    for (k in ot || {}) if (Number(ot[k]) > 0) seen('ot', k);
    return r;
  }

  window.RosterPeople = {
    LEAVE: LEAVE, HOURS: HOURS, isWork: isWork, isLeave: isLeave, at: at, setFrom: setFrom, unset: unset,
    tally: tally, sum: sum, attend: attend, firstMark: firstMark,
  };
})();
