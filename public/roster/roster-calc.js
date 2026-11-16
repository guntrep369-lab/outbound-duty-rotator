/**
 * @file roster-calc.js — ค่าช่องในตารางกะ (ก่อนแก้เอง) คิดที่เดียว
 *
 * หน้าตารางกะกับหน้า HR (roster/hr.html) ต้องเห็นช่องเดียวกันทุกช่อง
 * กฎวันหยุด วันโปรฯ และเวลาพิเศษวันสุดท้ายคาบจึงอยู่ไฟล์นี้ไฟล์เดียว
 * ฟังก์ชันรับข้อมูลที่ต้องใช้เป็นพารามิเตอร์ (holidays / extraPro / periods) ไม่อ่านตัวแปรของหน้า
 *
 * ต้องโหลด wms-shifts.js ก่อน · โหลดเป็น classic script เปิดเป็น window.RosterCalc
 */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;

  function pd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fd(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd); }
  function addD(s, n) { var d = pd(s); d.setDate(d.getDate() + n); return fd(d); }

  /** วันเลขเบิ้ล 2/2 ถึง 12/12 (1/1 เป็นวันหยุดปีใหม่อยู่แล้ว) กับวันที่ 15 · 25 · 28 ทุกเดือน */
  function isPro(s) {
    var d = pd(s), day = d.getDate(), m = d.getMonth() + 1;
    return (day === m && m >= 2) || day === 15 || day === 25 || day === 28;
  }
  function isHol(hols, s) { return (hols || []).some(function (h) { return h.date === s; }); }
  function holName(hols, s) { var h = (hols || []).find(function (x) { return x.date === s; }); return h ? h.name : ''; }
  function isXP(xp, s) { return (xp || []).some(function (p) { return p.date === s; }); }

  function sorted(periods) { return (periods || []).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; }); }
  /** คาบที่กำหนดวันสุดท้ายไว้จบตามนั้น ไม่งั้นจบวันก่อนคาบถัดไป หรือครบ 28 วันถ้าเป็นคาบสุดท้าย · sp = คาบที่เรียงแล้ว */
  function perEnd(p, sp) {
    if (p.end) return p.end;
    var i = sp.findIndex(function (x) { return x.id === p.id; });
    return i + 1 < sp.length ? addD(sp[i + 1].start, -1) : addD(p.start, 27);
  }
  function datesOf(p, sp) { var out = [], e = perEnd(p, sp); for (var c = p.start; c <= e; c = addD(c, 1)) out.push(c); return out; }
  /** คาบล่าสุดที่เริ่มแล้ว ณ วัน today (ลำดับใน sp) */
  function currentIdx(sp, today) { var best = 0; for (var i = 0; i < sp.length; i++) if (sp[i].start <= today) best = i; return best; }

  /** กลุ่ม A/B อยู่กะไหนในคาบ per — groupA = กะของกลุ่ม A */
  function shiftOf(per, group) { return (group === 'A') === (per.groupA === 'morning') ? 'morning' : 'evening'; }
  function groupOf(per, shift) { return (shift === 'morning') === (per.groupA === 'morning') ? 'A' : 'B'; }

  /* กติกาวันสุดท้ายของคาบ: กะที่มี last เข้าเวลาพิเศษวันนั้น (ค่าเริ่มต้น: กะบ่าย 10-19 ยกเว้นคนหยุดเสาร์
     เพราะวันรุ่งขึ้นสลับไปเข้ากะเช้า) กะที่ตั้งใหม่ในแท็บ "กะ" ไม่มีกติกานี้
     lastOf = ค่าช่องของคาบนั้น เช่น "10-19" ('' = ไม่มี) · lastHrs = ช่องของคนนี้วันนี้ใช้เวลาพิเศษไหม */
  function lastOf(def) {
    var SH = G.WmsShifts;
    for (var i = 0; i < SH.IDS.length; i++) { var l = def.shifts[SH.IDS[i]].last; if (l) return SH.hoursLabel(l); }
    return '';
  }
  function lastHrs(v, d, shift, endS, def) {
    var l = def.shifts[shift].last;
    return l && d === endS && v.dayOff !== l.skipOff ? G.WmsShifts.hoursLabel(l) : '';
  }
  /** ค่าช่องตามตาราง — วันหยุดพิเศษ / วันหยุดประจำ = H · วันสุดท้ายคาบของกะที่มีกติกาเวลาพิเศษ = เวลานั้น · นอกนั้น W
   *  v = กลุ่มกับวันหยุด ณ วันนั้น (RosterPeople.at) · endS = วันสุดท้ายของคาบ · def = ค่าตั้งกะของคาบ */
  function avOf(hols, v, d, shift, endS, def) {
    if (isHol(hols, d) || (v.dayOff >= 0 && pd(d).getDay() === v.dayOff)) return 'H';
    return lastHrs(v, d, shift, endS, def) || 'W';
  }

  G.RosterCalc = {
    pd: pd, fd: fd, addD: addD, isPro: isPro, isHol: isHol, holName: holName, isXP: isXP,
    sorted: sorted, perEnd: perEnd, datesOf: datesOf, currentIdx: currentIdx,
    shiftOf: shiftOf, groupOf: groupOf, lastOf: lastOf, lastHrs: lastHrs, avOf: avOf,
  };
})();
