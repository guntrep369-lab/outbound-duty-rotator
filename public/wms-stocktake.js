/**
 * @file wms-stocktake.js — นับสต๊อกใหญ่ (นับทั้งคลังเป็นรอบ ๆ)
 *
 * ใช้ร่วมกันสองหน้า: หน้าหัวหน้า (public/stocktake/index.html) กับหน้ากรอกบนมือถือ
 * (public/stocktake/count.html) ไฟล์นี้ไม่ยิงเน็ตและไม่แตะ localStorage เอง มีแต่การคิด
 * หน้าเว็บเป็นคนเก็บและส่ง เทสต์จึงเรียกทุกฟังก์ชันได้ตรง ๆ
 *
 * ข้อมูลเก็บในชีตของ apps-script/stocktake-api.gs ยอดตั้งต้นคิดจากสมุดด้วยกติกาเดียวกับ
 * tx-api.gs (balances_) จากคำตอบ tx-fifo ตัวเลขจึงตรงกับหน้าสต๊อกราย Location ทุกกอง
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsStocktake
 */
(function () {
  'use strict';

  /* ลำดับโซนตอนแสดง: แร็คก่อน แล้วพื้น A–D ชั้นวาง S จุดพิเศษ ที่เหลืออยู่ท้าย */
  var ZONES = ['R', 'A', 'B', 'C', 'D', 'S', 'QA', 'IQA', 'RIB'];
  var OTHER = 'อื่นๆ';
  var SKIP = '-';            // ค่าทีมของแถวที่ไม่นับรอบนี้
  /* R1-03-02 = แร็ค 1 ช่อง 03 ชั้น 02 · A-01-05 = พื้นโซน A แถว 01 ตำแหน่ง 05 · S-02-01 = ชั้นวาง */
  var LOC_RE = /^([A-Z]+)(\d*)-(\d+)-(\d+)(?:-(\d+))?$/;
  var SPECIAL = ['QA', 'IQA', 'RIB'];
  var AUDIT_MIN = 20;        // Audit ต้องสุ่มอย่างน้อยกี่ % ของโลในแต่ละแถว (ผู้ใช้เลือก 20%)

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /**
   * ค่าที่ใช้เทียบ LOT / PO / SKU ที่คนพิมพ์: ช่องว่างซ้อนเหลือช่องเดียว เลขล้วนตัด 0 นำหน้า
   * LOT 08 กับ 8 คือ LOT เดียวกัน ถ้าไม่ตัด ของที่นับถูกจะกลายเป็น LOT ผิด
   */
  function norm(v) { return up(v).replace(/\s+/g, ' ').replace(/^0+(?=\d)/, ''); }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  /* ── Location ─────────────────────────────────────────────────────────── */

  /**
   * แยก Location เป็นโซน แถว และชั้น
   *   zone  = โซนใหญ่ (R, A, B, …) ใช้จัดกลุ่มตอนแบ่งทีม
   *   group = แถว หน่วยที่แบ่งให้ทีม (R1, A-01, S-02) — เดินนับจบแถวเดียวได้ในรอบเดียว
   *   level = ชั้นของแร็ค (เลขชุดท้าย) ใช้บอกจุดที่มีปัญหาบ่อยในขั้นวิเคราะห์
   */
  function parseLoc(loc) {
    var u = up(loc), m = LOC_RE.exec(u);
    if (m) {
      var letters = m[1], n = m[2];
      if (letters === 'R' && n) return { zone: 'R', group: 'R' + (+n), level: +m[4] };
      if (!n) return { zone: letters, group: letters + '-' + m[3], level: m[5] ? +m[5] : 0 };
      return { zone: letters + n, group: letters + n + '-' + m[3], level: m[5] ? +m[5] : 0 };
    }
    if (SPECIAL.indexOf(u) !== -1) return { zone: u, group: u, level: 0 };
    return { zone: OTHER, group: OTHER, level: 0 };
  }

  /** ชื่อ Location ที่เป็นที่เก็บจริง (ไม่ใช่ชื่อพิมพ์ผิดที่ใช้ครั้งสองครั้งในสมุด) */
  function isRealLoc(loc) {
    var u = up(loc);
    return LOC_RE.test(u) || SPECIAL.indexOf(u) !== -1;
  }

  function zoneRank(z) {
    var i = ZONES.indexOf(z);
    if (i !== -1) return i;
    return z === OTHER ? 99 : 50;
  }

  /** เทียบแบบเลขในชื่อเป็นตัวเลข: R2 มาก่อน R10, A-02 มาก่อน A-10 */
  function natCmp(a, b) {
    var x = up(a).match(/\d+|\D+/g) || [], y = up(b).match(/\d+|\D+/g) || [];
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      var nx = /^\d/.test(x[i]), ny = /^\d/.test(y[i]);
      if (nx && ny) return (+x[i] - +y[i]) || (x[i].length - y[i].length);
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }

  function locCmp(a, b) {
    var pa = parseLoc(a), pb = parseLoc(b);
    return (zoneRank(pa.zone) - zoneRank(pb.zone)) || natCmp(pa.zone, pb.zone) || natCmp(a, b);
  }

  function groupCmp(a, b) {
    var za = zoneOfGroup(a), zb = zoneOfGroup(b);
    return (zoneRank(za) - zoneRank(zb)) || natCmp(za, zb) || natCmp(a, b);
  }

  /** โซนของแถว (R1 → R, A-01 → A) */
  function zoneOfGroup(g) {
    var u = up(g);
    if (u === OTHER || SPECIAL.indexOf(u) !== -1) return u;
    var m = /^R(\d+)$/.exec(u);
    if (m) return 'R';
    m = /^([A-Z]+\d*)-\d+$/.exec(u);
    return m ? m[1] : OTHER;
  }

  /* ── ยอดตั้งต้นจากสมุด ───────────────────────────────────────────────── */

  /**
   * คิดยอดในสมุดราย Location × SKU × LOT × PO จากคำตอบ tx-fifo ด้วยกติกาเดียวกับ tx-api.gs balances_
   *   เข้า = แถวที่มี Location รับ (ทุกประเภท)
   *   ออก  = แถวเบิก / ขายที่มี Location เบิก (tx-fifo ใส่ Location เบิกให้เฉพาะแถวพวกนี้อยู่แล้ว)
   *   เปิดขาย = Status ของแถวเข้าล่าสุดของกองนั้น
   * กองที่ยอดเป็น 0 ไม่ส่ง (เหมือนหน้าสต๊อกราย Location) กองติดลบส่ง เพราะเป็นตัวเลขที่ต้องเทียบเหมือนกัน
   *
   * supOf(po) → ชื่อ Supplier (ส่ง WmsSup เข้ามา) ไม่ส่ง = ไม่รู้ชื่อ
   * @returns {{piles: Array, skus: Array, pos: Array, locs: Array, lastRow: number, lastDate: string}}
   *   piles = [[Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, ยอด, เปิดขาย 0/1]]
   *   pos   = [[PO, Supplier, [SKU เต็มที่เคยรับ], [LOT ที่เคยรับ]]] ไม่มียอด ส่งไปหน้ากรอกได้
   *   locs  = [{loc, piles, rows}] ทุก Location ที่เคยมีในสมุด
   */
  function baseline(fifo, supOf) {
    var f = fifo || {};
    var skus = f.skus || [], pos = f.pos || [], locs = f.locs || [];
    var piles = {}, order = [], lastRow = 0, used = {};
    /* PO ไหนเคยรับ SKU / LOT อะไร (ทุกแถวที่มี PO นั้น ไม่สนยอด) ให้หน้ากรอกเตือนตอนไม่เข้ากัน */
    var poSku = {}, poLot = {};
    (f.rows || []).forEach(function (r) {
      var row = r[0], s = r[1], lot = r[2], po = r[3], from = r[4], to = r[5], qty = +r[6] || 0, flag = r[9] || 0;
      if (row > lastRow) lastRow = row;
      if (po !== null && po !== undefined && po >= 0) {
        (poSku[po] = poSku[po] || {})[s] = 1;
        var lt = lot === null || lot === undefined ? '' : String(lot).trim();
        if (lt) (poLot[po] = poLot[po] || {})[up(lt)] = lt;
      }
      function at(loc) {
        var k = s + '|' + up(lot) + '|' + po + '|' + loc;
        if (!piles[k]) { piles[k] = { s: s, lot: lot, po: po, loc: loc, qty: 0, open: 0 }; order.push(k); }
        used[loc] = (used[loc] || 0) + 1;
        return piles[k];
      }
      if (to >= 0) { var a = at(to); a.qty += qty; a.open = flag & 1 ? 1 : 0; }
      if (from >= 0) at(from).qty -= qty;
    });
    var count = {};
    var out = [];
    order.forEach(function (k) {
      var p = piles[k], q = round3(p.qty);
      if (!q) return;
      var sk = skus[p.s] || ['', '', ''];
      var loc = locs[p.loc];
      count[p.loc] = (count[p.loc] || 0) + 1;
      out.push([up(loc), sk[0], sk[1], sk[2], p.lot === null || p.lot === undefined ? '' : String(p.lot), pos[p.po] || '', q, p.open]);
    });
    out.sort(function (a, b) { return locCmp(a[0], b[0]) || natCmp(a[2], b[2]) || natCmp(a[4], b[4]) || natCmp(a[5], b[5]); });
    return {
      piles: out,
      skus: skus.filter(function (s) { return s && s[1]; }).map(function (s) { return [s[0] || '', s[1], s[2] || '']; }),
      pos: pos.map(function (p, i) {
        if (!p) return null;
        var sk = Object.keys(poSku[i] || {}).map(function (s) { return (skus[s] || [])[1] || (skus[s] || [])[0] || ''; })
          .filter(function (x) { return x; }).sort(natCmp);
        var lt = Object.keys(poLot[i] || {}).map(function (k) { return poLot[i][k]; }).sort(natCmp);
        return [p, supOf ? supOf(p) || '' : '', sk, lt];
      }).filter(function (p) { return p; }),
      locs: locs.map(function (l, i) { return { loc: up(l), piles: count[i] || 0, rows: used[i] || 0 }; }),
      lastRow: lastRow,
      lastDate: f.last || '',
    };
  }

  /**
   * รายการ Location ที่ต้องนับ
   *   - ทุกโลที่สมุดบอกว่ามีของ
   *   - โลที่เคยใช้ในสมุดแต่ตอนนี้ว่าง ถ้าชื่อเป็นที่เก็บจริง (ไปดูว่าว่างจริงไหม)
   *   - โลที่หัวหน้าวางเพิ่มเอง (extra) เช่น ช่องแร็คที่ไม่เคยลงสมุดเลย
   * ชื่อแปลกที่ว่างอยู่ (พิมพ์ผิดในสมุด) ไม่เอา ไม่งั้นคนนับต้องเดินหาโลที่ไม่มีจริง
   * @returns {Array<{loc, zone, group, piles, src}>} เรียงตามทางเดิน
   */
  function locations(base, extra) {
    var seen = {}, out = [];
    function add(loc, piles, src) {
      var u = up(loc);
      if (!u || seen[u]) return;
      seen[u] = 1;
      var p = parseLoc(u);
      out.push({ loc: u, zone: p.zone, group: p.group, piles: piles, src: src });
    }
    ((base && base.locs) || []).forEach(function (l) {
      if (l.piles > 0) add(l.loc, l.piles, 'สมุด');
      else if (isRealLoc(l.loc)) add(l.loc, 0, 'สมุด (ว่าง)');
    });
    (extra || []).forEach(function (l) { add(l, 0, 'เพิ่มเอง'); });
    return out.sort(function (a, b) { return locCmp(a.loc, b.loc); });
  }

  /** Location ที่วางมา (หนึ่งบรรทัดหนึ่งโล หรือคั่นด้วยจุลภาค / แท็บ) */
  function parseLocList(text) {
    return String(text || '').split(/[\n\r\t,;]+/).map(up).filter(function (s) { return s && s.length <= 40 && !/\s{2,}/.test(s); });
  }

  /** จัดโลเป็นแถว → [{group, zone, locs:[...], n, piles}] เรียงตามทางเดิน */
  function groups(locList) {
    var by = {}, out = [];
    (locList || []).forEach(function (l) {
      var g = by[l.group];
      if (!g) { g = by[l.group] = { group: l.group, zone: l.zone, locs: [], n: 0, piles: 0 }; out.push(g); }
      g.locs.push(l.loc);
      g.n++;
      g.piles += l.piles || 0;
    });
    return out.sort(function (a, b) { return groupCmp(a.group, b.group); });
  }

  /**
   * แบ่งแถวให้ทีมแบบติดกันตามทางเดิน ให้แต่ละทีมได้จำนวนโลใกล้กัน
   * แถวติดกันอยู่ทีมเดียวกัน คนนับไม่ต้องเดินข้ามโซนไปมา
   * @returns {{[group]: teamId}}
   */
  function autoSplit(groupList, teamIds) {
    var out = {};
    var list = groupList || [], ids = teamIds || [];
    if (!ids.length) return out;
    var total = list.reduce(function (a, g) { return a + g.n; }, 0);
    var done = 0, t = 0;
    list.forEach(function (g) {
      /* ข้ามไปทีมถัดไปเมื่อใส่แถวนี้แล้วเกินเป้ามากกว่าหยุดก่อนเป้า ทีมสุดท้ายรับที่เหลือทั้งหมด */
      var target = total * (t + 1) / ids.length;
      if (t < ids.length - 1 && done > 0 && done + g.n - target > target - done) t++;
      out[g.group] = ids[t];
      done += g.n;
    });
    return out;
  }

  /* ── บันทึกนับ ────────────────────────────────────────────────────────── */

  /** แถวจากสคริปต์ (st-log / st-mine) → object ดูลำดับคอลัมน์ที่ logView_ ใน stocktake-api.gs */
  function fromRow(r) {
    return {
      row: r[0], at: r[1], pass: r[2], team: r[3], kind: r[4], who: r[5], loc: r[6], sku: r[7], long: r[8],
      lot: r[9], po: r[10], qty: r[11], type: r[12], ref: r[13], uid: r[14], clientAt: r[15],
    };
  }

  /**
   * แถวที่ยังมีผลอยู่ แก้กอง = แถวใหม่ชี้แถวเดิม (ref) ลบกอง = แถวยกเลิกชี้แถวเดิม
   * แถวไหนถูกแถวอื่นชี้ถึง แปลว่าถูกแทนแล้ว ที่เหลือคือของจริงตอนนี้ แถวในชีตไม่มีวันถูกลบ
   */
  function effective(entries) {
    var gone = {};
    (entries || []).forEach(function (e) { if (e.ref) gone[e.ref] = 1; });
    return (entries || []).filter(function (e) { return !gone[e.uid] && (e.type === 'นับ' || e.type === 'ว่าง'); });
  }

  /** แถวของ Location หนึ่งของทีมหนึ่ง ที่ยังมีผลอยู่ */
  function atLoc(entries, loc, team, pass) {
    var u = up(loc);
    return effective(entries).filter(function (e) { return up(e.loc) === u && (!team || e.team === team) && (!pass || e.pass === pass); });
  }

  var seq = 0;
  /** รหัสแถวที่ไม่ซ้ำข้ามเครื่อง: เครื่อง + เวลา + ลำดับในเครื่อง สคริปต์ใช้กันส่งซ้ำ */
  function uid(device, now) {
    seq = (seq + 1) % 1296;
    return String(device || 'x') + '-' + (now || Date.now()).toString(36) + '-' + seq.toString(36);
  }

  /** รหัสเครื่องสั้น ๆ ตั้งครั้งเดียวต่อเบราว์เซอร์ (หน้าเว็บเก็บไว้เอง) */
  function deviceId(rand) {
    var r = rand || Math.random;
    var s = '';
    for (var i = 0; i < 6; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(Math.floor(r() * 31));
    return s;
  }

  /**
   * ชุดที่จะส่งรอบนี้ ไม่เกิน max แถว เรียงตามที่กรอก
   * แถวยกเลิก / แก้ ต้องไปหลังแถวที่มันชี้เสมอ จึงตัดตามลำดับเดิมเท่านั้น ไม่เลือกข้าม
   */
  function batch(outbox, max) { return (outbox || []).slice(0, max || 40); }

  /**
   * เอาแถวที่ส่งแล้วออกจากคิว แถวที่สคริปต์ไม่รับย้ายไปกองแยก (ไม่หาย ให้คนเห็นและแก้เอง)
   * @returns {{outbox: Array, rejected: Array}}
   */
  function ack(outbox, sent, res) {
    var gone = {}, bad = {};
    (sent || []).forEach(function (e) { gone[e.uid] = 1; });
    ((res && res.rejected) || []).forEach(function (r) { bad[r.uid] = r.why; });
    var rejected = (sent || []).filter(function (e) { return bad[e.uid] !== undefined; })
      .map(function (e) { var c = {}; for (var k in e) c[k] = e[k]; c.why = bad[e.uid]; return c; });
    return { outbox: (outbox || []).filter(function (e) { return !gone[e.uid]; }), rejected: rejected };
  }

  /** รวมแถวจากสคริปต์เข้ากับที่มีอยู่ ตัดซ้ำด้วยรหัสแถว */
  function merge(have, rows) {
    var seen = {}, out = [];
    (have || []).concat(rows || []).forEach(function (e) {
      if (!e || !e.uid || seen[e.uid]) return;
      seen[e.uid] = 1;
      out.push(e);
    });
    return out;
  }

  /* ── ทีมและความคืบหน้า ───────────────────────────────────────────────── */

  /** ทีมของรอบนับ pass แยก Inventory กับ Audit */
  function teamsOf(teams, pass) {
    return (teams || []).filter(function (t) { return (t.pass || 1) === (pass || 1); });
  }

  /**
   * Location ของทีม เรียงตามทางเดิน locList = [[loc, group]] หรือ [{loc, group}]
   * รอบ 1 ทีมได้เป็นแถว (R1, A-01) รอบ 2 ได้เป็นรายโล (R1-03-02) เทียบได้ทั้งสองแบบ
   */
  function teamLocs(team, locList) {
    var zones = {};
    ((team && team.zones) || []).forEach(function (z) { zones[up(z)] = 1; });
    return (locList || []).map(function (l) { return Array.isArray(l) ? { loc: l[0], group: l[1] } : l; })
      .filter(function (l) { return zones[up(l.group)] || zones[up(l.loc)]; })
      .sort(function (a, b) { return locCmp(a.loc, b.loc); });
  }

  /**
   * ความคืบหน้าของรอบนับ ให้หน้าหัวหน้า
   *   นับแล้ว (Inventory) = มีแถวนับหรือว่างที่ยังมีผลจากทีม Inventory ทีมไหนก็ได้ในรอบนับนี้
   *   Audit สุ่มแล้ว = มีแถวจาก Audit คนไหนก็ได้ที่โลนั้น
   * locList = [{loc, group, zone}] teams = ทีมของรอบนับนี้ entries = แถวทั้งหมด (ยังไม่ตัดแถวที่ถูกแทน)
   */
  function progress(locList, teams, entries, opts) {
    var o = opts || {};
    var pass = o.pass || 1;
    var min = o.auditMin == null ? AUDIT_MIN : o.auditMin;
    var eff = effective(entries).filter(function (e) { return (e.pass || 1) === pass; });
    var inv = {}, aud = {}, whoInv = {};
    eff.forEach(function (e) {
      var u = up(e.loc);
      if (e.kind === 'Audit') aud[u] = 1;
      else { inv[u] = 1; (whoInv[u] = whoInv[u] || {})[e.who || '?'] = 1; }
    });
    var invTeam = {}, audTeam = {};
    teamsOf(teams, pass).forEach(function (t) {
      (t.zones || []).forEach(function (z) {
        if (t.kind === 'Audit') (audTeam[up(z)] = audTeam[up(z)] || []).push(t.id);
        else invTeam[up(z)] = t.id;
      });
    });
    var known = {};
    var gl = groups(locList).map(function (g) {
      var left = [], invDone = 0, audDone = 0;
      g.locs.forEach(function (l) {
        known[l] = 1;
        if (inv[l]) invDone++; else left.push(l);
        if (aud[l]) audDone++;
      });
      var a = audTeam[up(g.group)] || [];
      var pct = g.n ? Math.round(audDone * 100 / g.n) : 0;
      return {
        group: g.group, zone: g.zone, n: g.n, team: invTeam[up(g.group)] || '', audit: a,
        done: invDone, left: left, auditDone: audDone, auditPct: pct,
        auditLow: a.length > 0 && min > 0 && pct < min,
      };
    });
    var total = gl.reduce(function (s, g) { return s + g.n; }, 0);
    var done = gl.reduce(function (s, g) { return s + g.done; }, 0);
    var teamOut = teamsOf(teams, pass).map(function (t) {
      var mine = gl.filter(function (g) { return t.kind === 'Audit' ? g.audit.indexOf(t.id) !== -1 : g.team === t.id; });
      var n = mine.reduce(function (s, g) { return s + g.n; }, 0);
      var d = mine.reduce(function (s, g) { return s + (t.kind === 'Audit' ? g.auditDone : g.done); }, 0);
      return { id: t.id, name: t.name, kind: t.kind, n: n, done: d, pct: n ? Math.round(d * 100 / n) : 0 };
    });
    var audGroups = gl.filter(function (g) { return g.audit.length; });
    var audN = audGroups.reduce(function (s, g) { return s + g.n; }, 0);
    var audD = audGroups.reduce(function (s, g) { return s + g.auditDone; }, 0);
    /* โลที่คนนับเพิ่มเองนอกรายการ หัวหน้าต้องรู้ว่ามีของอยู่ที่ที่ไม่ได้วางแผนไว้ */
    var extra = {};
    eff.forEach(function (e) { var u = up(e.loc); if (!known[u]) extra[u] = (extra[u] || 0) + 1; });
    return {
      total: total, done: done, pct: total ? Math.round(done * 100 / total) : 0,
      groups: gl, teams: teamOut,
      audit: { n: audN, done: audD, pct: audN ? Math.round(audD * 100 / audN) : 0, min: min },
      extra: Object.keys(extra).sort(locCmp).map(function (l) { return { loc: l, n: extra[l] }; }),
      unassigned: gl.filter(function (g) { return !g.team; }).reduce(function (s, g) { return s + g.n; }, 0),
      people: whoInv,
    };
  }

  /* ── ค้นหาให้ช่องพิมพ์ ───────────────────────────────────────────────── */

  /**
   * SKU ที่ตรงกับที่พิมพ์ จาก SKU ทั้งคลัง (ไม่บอกว่าโลนี้ควรมีอะไร)
   * ขึ้นต้นตรงมาก่อน แล้วมีอยู่ในรหัส แล้วมีในชื่อ skus = [[SKU, SKU เต็ม, ชื่อ]]
   */
  function skuSearch(skus, q, limit) {
    var n = norm(q);
    if (!n) return [];
    var hits = [];
    (skus || []).forEach(function (s) {
      var a = norm(s[0]), b = norm(s[1]), nm = up(s[2]);
      var rank = a.indexOf(n) === 0 || b.indexOf(n) === 0 ? 0
        : a.indexOf(n) !== -1 || b.indexOf(n) !== -1 ? 1
        : nm.indexOf(n) !== -1 ? 2 : -1;
      if (rank !== -1) hits.push({ s: s, rank: rank });
    });
    hits.sort(function (x, y) { return x.rank - y.rank || natCmp(x.s[0] || x.s[1], y.s[0] || y.s[1]); });
    return hits.slice(0, limit || 8).map(function (h) { return h.s; });
  }

  /**
   * ช่องกรอกมีของที่ยังไม่ได้บันทึกไหม (กด "เสร็จ" หรือ "‹ โล" จะได้บันทึกให้ก่อน ไม่ทิ้ง)
   * pile = กองที่กำลังแก้ ถ้าเป็นกองใหม่ให้ส่ง null
   */
  function formDirty(form, pile) {
    var f = form || {};
    var s = function (v) { return String(v == null ? '' : v).trim(); };
    var q = s(f.qty).replace(/,/g, '');
    if (!pile) return !!(s(f.sku) || s(f.lot) || s(f.po) || q);
    var k = norm(f.sku);
    return (k !== norm(pile.sku) && k !== norm(pile.long)) || norm(f.lot) !== norm(pile.lot) ||
      norm(f.po) !== norm(pile.po) || qtyOf(q) !== Number(pile.qty);
  }

  /**
   * จำนวนที่พิมพ์ คูณและบวกได้ เช่น "4×6×3" = 72 (แถว × ชั้น), "4×6×3+5" = 77 (บวกเศษ) คูณก่อนบวก
   * รับ x X * แทน × ได้ ตัดจุลภาค · ผิดรูป (ว่าง, เครื่องหมายไม่มีตัวเลขข้าง ๆ, ตัวอักษรอื่น) คืน NaN
   */
  function qtyOf(v) {
    var t = String(v == null ? '' : v).replace(/[,\s]/g, '');
    if (!t) return NaN;
    var terms = t.split('+'), sum = 0;
    for (var i = 0; i < terms.length; i++) {
      var parts = terms[i].split(/[×xX*]/), prod = 1;
      for (var j = 0; j < parts.length; j++) {
        if (!/^(\d+\.?\d*|\.\d+)$/.test(parts[j])) return NaN;
        prod *= Number(parts[j]);
      }
      sum += prod;
    }
    return round3(sum);
  }

  /** PO ที่เคยรับ SKU นี้ตามยอดตั้งต้น (pos แบบเก่าที่ไม่มีรายการ SKU = ไม่มี) */
  function posOfSku(pos, skus, sku) {
    var ex = skuExact(skus, sku);
    var key = (ex ? [norm(ex[0]), norm(ex[1])] : [norm(sku)]).filter(function (k) { return k; });
    if (!key.length) return [];
    return (pos || []).filter(function (p) {
      return Array.isArray(p[2]) && p[2].some(function (h) { return key.indexOf(norm(h)) !== -1; });
    });
  }

  var newest = function (a, b) { return String(b).localeCompare(String(a), 'en', { numeric: true }); };

  /**
   * ปุ่มเลือก PO บนแป้นตัวเลข: PO ที่เคยรับ SKU นี้ ใหม่สุดก่อน → [[PO, Supplier]]
   * ใส่ LOT แล้วเหลือเฉพาะ PO ที่มี LOT นั้น (ถ้าไม่มีสักใบ ขึ้นทั้งหมด ให้คำเตือนเป็นตัวบอก)
   */
  function poChoices(pos, skus, sku, lot) {
    var list = posOfSku(pos, skus, sku), l = norm(lot);
    if (l && l !== '0') {
      var hit = list.filter(function (p) { return (p[3] || []).some(function (x) { return norm(x) === l; }); });
      if (hit.length) list = hit;
    }
    return list.map(function (p) { return [String(p[0]), p[1] || '']; }).sort(function (a, b) { return newest(a[0], b[0]); });
  }

  /** ปุ่มเลือก LOT: ใส่ PO ที่มีในสมุดแล้ว = LOT ของ PO นั้น · ยังไม่ใส่ = LOT ทุกใบที่เคยรับ SKU นี้ ใหม่สุดก่อน */
  function lotChoices(pos, skus, sku, po) {
    var n = norm(po), rows = [];
    if (n && n !== '0') rows = (pos || []).filter(function (p) { return norm(p[0]) === n && Array.isArray(p[3]); });
    if (!rows.length) rows = posOfSku(pos, skus, sku);
    var seen = {}, out = [];
    rows.forEach(function (p) {
      (p[3] || []).forEach(function (l) { var k = norm(l); if (k && k !== '0' && !seen[k]) { seen[k] = 1; out.push(String(l)); } });
    });
    return out.sort(newest);
  }

  /**
   * กองที่กรอกเข้ากับสมุดไหม (ไม่มียอด คนนับยังนับแบบไม่รู้ยอด)
   * v = {sku, long, lot, po}  pos = [[PO, Supplier, [SKU เต็มที่เคยรับ], [LOT ที่เคยรับ]]]  skus = [[SKU, SKU เต็ม, ชื่อ]]
   * typing = เช็คระหว่างพิมพ์ ไม่เตือนเรื่องช่องว่าง (ยังพิมพ์ไม่เสร็จ)
   * LOT / PO = 0 คือไม่มีป้าย ไม่เช็คต่อ · รอบที่ดึงยอดก่อนมีข้อมูลนี้ (ไม่มีสองช่องหลัง) เช็คแค่ว่ามี PO นี้
   * @returns {string[]} คำเตือน ว่าง = ผ่าน
   */
  function pileWarn(v, pos, skus, typing) {
    var x = v || {}, out = [];
    var s = function (a) { return String(a == null ? '' : a).trim(); };
    var lot = s(x.lot), po = s(x.po);
    if (!typing) {
      if (!lot && !po) out.push('ไม่ได้ใส่ LOT และ PO (ไม่มีป้าย ให้ใส่ 0)');
      else if (!lot) out.push('ไม่ได้ใส่ LOT (ไม่มีป้าย ให้ใส่ 0)');
      else if (!po) out.push('ไม่ได้ใส่ PO (ไม่มีป้าย ให้ใส่ 0)');
    }
    if (!po || norm(po) === '0' || !(pos || []).length) return out;
    var n = norm(po), hit = null;
    for (var i = 0; i < pos.length && !hit; i++) if (norm(pos[i][0]) === n) hit = pos[i];
    if (!hit) { if (!typing || po.length >= 4) out.push('ไม่พบ PO ' + po + ' ในสมุด'); return out; }
    var have = hit[2] || [], lots = hit[3] || [];
    var short = {};
    (skus || []).forEach(function (k) { if (k[1]) short[norm(k[1])] = k[0] || k[1]; });
    var key = [norm(x.long), norm(x.sku)].filter(function (k) { return k; });
    if (have.length && key.length && !have.some(function (h) { var a = norm(h); return key.indexOf(a) !== -1 || key.indexOf(norm(short[a])) !== -1; })) {
      var names = have.map(function (h) { return short[norm(h)] || h; });
      out.push('PO ' + hit[0] + ' ไม่เคยรับ ' + (x.sku || x.long) +
        (names.length <= 4 ? ' (เคยรับ ' + names.join(', ') + ')' : ' (เคยรับ ' + names.length + ' SKU อื่น)'));
    }
    if (lots.length && lot && norm(lot) !== '0' && !lots.some(function (l) { return norm(l) === norm(lot); })) {
      out.push('LOT ' + lot + ' ไม่ตรงกับ PO ' + hit[0] + ' (PO นี้มี LOT ' + lots.slice(0, 4).join(', ') + (lots.length > 4 ? ' …' : '') + ')');
    }
    return out;
  }

  /* รุ่นสคริปต์ที่หน้าเว็บนี้ต้องใช้ (ต้องตรงกับ VERSION ใน apps-script/stocktake-api.gs) */
  var API_V = 4;
  /** คำตอบจากสคริปต์รุ่นเก่ากว่าที่หน้าเว็บต้องใช้ไหม (ลืม Deploy เวอร์ชันใหม่) → {have, need} หรือ null */
  function oldScript(res) {
    if (!res || typeof res !== 'object') return null;
    var have = +res.v || 0;
    return have >= API_V ? null : { have: have, need: API_V };
  }

  /** SKU ที่พิมพ์ตรงตัวกับในรายการไหม (ตรง SKU หรือ SKU เต็ม) */
  function skuExact(skus, q) {
    var n = norm(q);
    if (!n) return null;
    for (var i = 0; i < (skus || []).length; i++) {
      if (norm(skus[i][0]) === n || norm(skus[i][1]) === n) return skus[i];
    }
    return null;
  }

  /** PO ที่ขึ้นต้นด้วยที่พิมพ์ พร้อมชื่อ Supplier pos = [[PO, Supplier]] */
  function poSearch(pos, q, limit) {
    var n = norm(q);
    if (n.length < 2) return [];
    return (pos || []).filter(function (p) { return norm(p[0]).indexOf(n) === 0; }).slice(0, limit || 6);
  }

  /* ── สมุดขยับระหว่างนับ ──────────────────────────────────────────────── */

  /**
   * แถวในสมุดที่ลงหลังดึงยอดตั้งต้น (เลขแถวเกิน lastRow) จากคำตอบ tx-fifo
   * หยุดรับ-จ่ายระหว่างนับ จึงไม่ควรมีเลย ถ้ามีแปลว่ายอดตั้งต้นอาจไม่ใช่ตัวเทียบที่ถูกแล้ว
   *   ก่อนตัดยอด = ของที่ขาย / รับก่อนตัดยอดแต่เพิ่งลง → ดึงยอดตั้งต้นใหม่
   *   ระหว่างนับ = มีของเข้า-ออกจริงระหว่างนับ → โลนั้นต้องนับใหม่หรือหักตาม
   * cutoff = 'yyyy-mm-dd HH:mm' วันที่ของแถวมีแค่วัน แถวที่ลงวันเดียวกับวันตัดยอดบอกว่าไม่แน่ใจ
   */
  function movesAfter(fifo, lastRow, cutoff) {
    var f = fifo || {};
    var day = String(cutoff || '').slice(0, 10);
    var out = [];
    (f.rows || []).forEach(function (r) {
      if (!(r[0] > lastRow)) return;
      var date = r[8] >= 0 && (r[9] & 8) ? (f.days || [])[r[8]] : '';
      var when = !date ? 'ไม่มีวันที่' : !day ? '' : date < day ? 'ก่อนตัดยอด' : date > day ? 'ระหว่างนับ' : 'วันตัดยอด';
      var sk = (f.skus || [])[r[1]] || [];
      out.push({
        row: r[0], date: date, when: when, sku: sk[0] || sk[1] || '', name: sk[2] || '',
        type: r[7] === 2 ? 'ขาย' : r[7] === 1 ? 'เบิก' : 'รับ/ย้าย',
        qty: r[6], from: r[4] >= 0 ? (f.locs || [])[r[4]] : '', to: r[5] >= 0 ? (f.locs || [])[r[5]] : '',
      });
    });
    return out;
  }

  /* ── ลิงก์ ─────────────────────────────────────────────────────────────── */

  /**
   * ลิงก์หน้ากรอกที่หัวหน้าส่งให้คนนับ URL สคริปต์กับรหัสอยู่หลัง # ไม่ถูกส่งไปที่ GitHub
   * หน้ากรอกเก็บไว้ในเครื่องแล้วลบออกจากช่องที่อยู่ทันที
   */
  function countLink(pageUrl, scriptUrl, key, roundId) {
    return String(pageUrl).split('#')[0] + '#u=' + encodeURIComponent(scriptUrl || '') +
      (key ? '&k=' + encodeURIComponent(key) : '') + '&r=' + encodeURIComponent(roundId || '');
  }

  function parseLink(hash) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    var u = p.get('u');
    return u ? { url: u, key: p.get('k') || '', round: p.get('r') || '' } : null;
  }

  /* ── วิเคราะห์ผลนับ (ขั้นที่ 2) ───────────────────────────────────────── */

  var G = {
    SHORT: 'ขาด', OVER: 'เกิน', MOVED: 'วางผิดโล', LOTPO: 'LOT/PO ผิด', TYPO: 'น่าจะพิมพ์ผิด',
    LEFT: 'ยังไม่นับ', AUDIT: 'Inv≠Audit', OK: 'ตรง',
  };
  /* ลำดับชิปบนหน้า เรื่องที่ต้องลงมือก่อนอยู่หน้า */
  var GROUPS = [G.SHORT, G.OVER, G.MOVED, G.LOTPO, G.TYPO, G.LEFT, G.AUDIT];

  /** ระยะแก้ไขระหว่างสองรหัส (เพิ่ม ลบ เปลี่ยนตัวอักษร) หยุดนับเมื่อเกิน max */
  function editDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      var low = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < low) low = cur[j];
      }
      if (low > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /** รหัสสองตัวที่ต่างกันแค่พิมพ์พลาดนิดเดียว (ตกหล่น สลับ กดผิดหนึ่งสองตัว) */
  function similarCode(a, b) {
    if (!a || !b || a === b) return false;
    var max = Math.min(a.length, b.length) >= 8 ? 2 : 1;
    return editDist(a, b, max) <= max;
  }

  /**
   * จำนวนที่น่าจะพิมพ์ผิดจากจำนวนจริง: สลับเลขติดกัน (12 ↔ 21), ศูนย์เกิน/ขาด (5 ↔ 50),
   * กดผิดหลักหน้าหนึ่งหลัก (25 ↔ 85) — หลักสุดท้ายต่างกันไม่นับ (15 ↔ 12 มักขาดจริง ไม่ใช่พิมพ์ผิด)
   * เลขหลักเดียวไม่นับ เพราะต่างกันจริงบ่อยกว่า
   */
  function qtyTypo(a, b) {
    if (!(a > 0) || !(b > 0) || a === b) return false;
    if (a === b * 10 || b === a * 10) return true;
    var x = String(a), y = String(b);
    if (x.length !== y.length || x.length < 2) return false;
    var diff = [];
    for (var i = 0; i < x.length; i++) if (x.charAt(i) !== y.charAt(i)) diff.push(i);
    if (diff.length === 1) return diff[0] < x.length - 1;
    return diff.length === 2 && diff[1] === diff[0] + 1 && x.charAt(diff[0]) === y.charAt(diff[1]) && x.charAt(diff[1]) === y.charAt(diff[0]);
  }

  /**
   * เทียบยอดนับกับยอดในสมุด แล้วแยกเป็นกลุ่มปัญหาให้หัวหน้าลงมือได้ทีละกลุ่ม
   *
   * in = {
   *   piles   ยอดตั้งต้น [[Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, ยอด, เปิดขาย]]
   *   entries แถวบันทึกนับทั้งหมด (fromRow) ยังไม่ตัดแถวที่ถูกแทน
   *   teams   ทีมของรอบ  locs = Location ที่ต้องนับ [{loc, group, zone}] (ไม่รวมแถวที่ตั้งไม่นับ)
   *   skus    [[SKU, SKU เต็ม, ชื่อ]]  skip = แถวที่ไม่นับ (โลในแถวพวกนี้ไม่เอามาคิด)  pass = รอบนับ
   *   only    (รอบ 2) คิดเฉพาะโลในรายการนี้ โลอื่นไม่ได้นับซ้ำ ไม่ต้องขึ้นว่ายังไม่นับ
   * }
   *
   * ยอด Inventory ของโลหนึ่ง = แถวของทีมที่ได้แถวนั้น ถ้าทีมนั้นไม่ได้นับ ใช้ทีม Inventory อื่นที่นับ
   * (ไม่รวมสองทีม ไม่งั้นโลที่ถูกนับซ้ำจะกลายเป็นเกินสองเท่า)
   *
   * จับคู่ตามลำดับ ส่วนที่อธิบายได้แล้วไม่ถูกนับซ้ำในขั้นถัดไป
   *   1. LOT/PO ผิด   — โลเดียวกัน SKU เดียวกัน ขาดใน LOT/PO หนึ่ง เกินในอีก LOT/PO
   *   2. พิมพ์ผิด     — จำนวนหน้าตาเหมือนพิมพ์พลาด (12 ↔ 21) หรือ SKU เกือบเหมือน SKU ที่ขาดในโลเดียวกัน
   *                     หรือ SKU ที่ไม่มีในคลังเลย
   *   3. วางผิดโล     — SKU เดียวกันขาดที่โลหนึ่ง เกินอีกโล (แถวเดียวกันก่อน แล้วโซนเดียวกัน แล้วที่ไหนก็ได้)
   *   4. ที่เหลือ      — ขาด / เกิน
   * Inv≠Audit แยกอีกรายการ: โลที่ Audit สุ่ม แล้วตัวเลขไม่ตรงกับ Inventory (ไม่สนยอดในสมุด)
   *
   * @returns {{lines, audit, counts, totals, hot, people, done, auditRows, multi}}
   *   multi = [{loc, kind, who}] โลที่มีหลายคนนับในงานเดียวกัน (Inventory ทีมที่ได้โลนั้น / Audit)
   *   done = โลที่ Inventory นับแล้ว  auditRows = {แถว: {checked, bad}} Audit ตรวจกี่โล ไม่ตรงกี่โล
   */
  function analyze(input) {
    var o = input || {};
    var pass = o.pass || 1;
    var skip = {};
    (o.skip || []).forEach(function (g) { skip[up(g)] = 1; });
    var only = null;
    if (o.only) { only = {}; o.only.forEach(function (l) { only[up(l)] = 1; }); }
    var info = {}, canon = {};
    (o.skus || []).forEach(function (s) {
      var long = norm(s[1] || s[0]);
      if (!long) return;
      info[long] = { sku: s[0] || s[1], long: s[1] || s[0], name: s[2] || '' };
      canon[long] = long;
      if (s[0]) canon[norm(s[0])] = long;
    });
    function keyOf(sku, long) {
      var a = norm(long), b = norm(sku);
      return canon[a] || canon[b] || a || b;
    }
    function infoOf(k, sku, long) { return info[k] || { sku: sku || long || k, long: long || sku || k, name: '' }; }

    /* ทีม Inventory ที่ได้แต่ละแถว ใช้เลือกว่ายอดของโลมาจากทีมไหน */
    var owner = {}, teamName = {};
    teamsOf(o.teams, pass).forEach(function (t) {
      teamName[t.id] = t.name || t.id;
      if (t.kind !== 'Audit') (t.zones || []).forEach(function (z) { owner[up(z)] = t.id; });
    });

    var listed = {}, universe = {}, meta = {};
    function touch(loc) {
      var u = up(loc);
      if (!u) return null;
      var p = parseLoc(u);
      if (skip[up(p.group)] || (only && !only[u])) return null;
      if (!universe[u]) { universe[u] = 1; meta[u] = p; }
      return u;
    }
    (o.locs || []).forEach(function (l) { var u = touch(l.loc); if (u) listed[u] = 1; });

    /* ยอดในสมุด */
    var book = {};
    (o.piles || []).forEach(function (p) {
      var u = touch(p[0]);
      if (!u) return;
      var k = keyOf(p[1], p[2]), lot = norm(p[4]), po = norm(p[5]);
      var id = k + '|' + lot + '|' + po;
      var b = (book[u] = book[u] || {});
      if (!b[id]) b[id] = { k: k, sku: p[1], long: p[2], name: p[3], lot: String(p[4] || ''), po: String(p[5] || ''), qty: 0 };
      b[id].qty = round3(b[id].qty + (+p[6] || 0));
      if (p[3] && !info[k]) info[k] = { sku: p[1] || p[2], long: p[2] || p[1], name: p[3] };
    });

    /* ยอดนับ แยก Inventory กับ Audit */
    var eff = effective(o.entries).filter(function (e) { return (e.pass || 1) === pass; });
    var byLoc = {};
    eff.forEach(function (e) {
      var u = touch(e.loc);
      if (!u) return;
      (byLoc[u] = byLoc[u] || []).push(e);
    });
    var inv = {}, aud = {}, invDone = {}, audDone = {}, invTeam = {}, invWho = {}, audWho = {};
    function add(map, u, e) {
      if (e.type !== 'นับ') return;
      var k = keyOf(e.sku, e.long), lot = norm(e.lot), po = norm(e.po);
      var id = k + '|' + lot + '|' + po;
      var m = (map[u] = map[u] || {});
      if (!m[id]) m[id] = { k: k, sku: e.sku, long: e.long, lot: String(e.lot || ''), po: String(e.po || ''), qty: 0, who: {} };
      m[id].qty = round3(m[id].qty + (+e.qty || 0));
      m[id].who[e.who || '?'] = 1;
    }
    Object.keys(byLoc).forEach(function (u) {
      var list = byLoc[u];
      var invRows = list.filter(function (e) { return e.kind !== 'Audit'; });
      var mine = owner[u] || owner[up(meta[u].group)];
      var pick = invRows.filter(function (e) { return e.team === mine; });
      if (!pick.length && invRows.length) {
        var first = invRows[0].team;
        pick = invRows.filter(function (e) { return e.team === first; });
      }
      if (pick.length) {
        invDone[u] = 1;
        invTeam[u] = pick[0].team;
        invWho[u] = {};
        pick.forEach(function (e) { invWho[u][e.who || '?'] = 1; add(inv, u, e); });
      }
      var a = list.filter(function (e) { return e.kind === 'Audit'; });
      if (a.length) {
        audDone[u] = 1;
        audWho[u] = {};
        a.forEach(function (e) { audWho[u][e.who || '?'] = 1; add(aud, u, e); });
      }
    });

    /* โลที่มีหลายคนนับในงานเดียวกัน ยอดรวมทุกคน ถ้านับกองเดียวกันซ้ำ ยอดจะเกินเป็นสองเท่า
       โลพื้นใหญ่ที่แบ่งกันนับคนละกองก็ขึ้นด้วย จึงเป็นแค่ธงให้ดู ไม่ใช่ผิดแน่ ๆ */
    var multi = [];
    [[invWho, 'Inventory'], [audWho, 'Audit']].forEach(function (x) {
      Object.keys(x[0]).forEach(function (u) {
        var w = Object.keys(x[0][u]).filter(function (n) { return n && n !== '?'; }).sort(natCmp);
        if (w.length > 1) multi.push({ loc: u, kind: x[1], who: w });
      });
    });
    multi.sort(function (p, q) { return locCmp(p.loc, q.loc) || natCmp(p.kind, q.kind); });

    var lines = [];
    function line(u, id, b, c, a) {
      var src = b || c || a;
      var k = src.k;
      var nfo = infoOf(k, src.sku, src.long);
      var p = meta[u];
      var L = {
        id: u + '|' + id, loc: u, zone: p.zone, row: p.group, level: p.level,
        k: k, sku: nfo.sku, long: nfo.long, name: nfo.name, lot: src.lot, po: src.po,
        book: b ? b.qty : 0, inv: c ? c.qty : (invDone[u] ? 0 : null), aud: audDone[u] ? (a ? a.qty : 0) : null,
        team: invTeam[u] || owner[u] || owner[up(p.group)] || '', who: c ? Object.keys(c.who) : Object.keys(invWho[u] || {}),
        known: !!info[k], pairs: [], left: 0, group: '', note: '',
      };
      L.diff = L.inv === null ? null : round3(L.inv - L.book);
      L.left = L.diff === null ? 0 : Math.abs(L.diff);
      lines.push(L);
      return L;
    }

    Object.keys(universe).sort(locCmp).forEach(function (u) {
      var b = book[u] || {}, c = inv[u] || {}, a = aud[u] || {};
      var ids = Object.keys(b).concat(Object.keys(c).filter(function (id) { return !b[id]; }));
      if (!invDone[u]) {
        if (!listed[u] && !ids.length) return;
        if (!ids.length) { var e = line(u, '', { k: '', sku: '', long: '', lot: '', po: '', qty: 0 }); e.group = G.LEFT; e.sku = ''; e.long = ''; return; }
        ids.forEach(function (id) { line(u, id, b[id], null, a[id]).group = G.LEFT; });
        return;
      }
      ids.forEach(function (id) { line(u, id, b[id], c[id], a[id]); });
    });

    var open = lines.filter(function (L) { return L.diff !== null && L.diff !== 0; });
    function shorts() { return open.filter(function (L) { return L.diff < 0 && L.left > 0; }); }
    function overs() { return open.filter(function (L) { return L.diff > 0 && L.left > 0; }); }
    function pair(s, x, group, qty) {
      var m = round3(Math.min(qty === undefined ? Math.min(s.left, x.left) : qty, s.left, x.left));
      if (!(m > 0)) return;
      s.left = round3(s.left - m); x.left = round3(x.left - m);
      s.pairs.push({ group: group, qty: m, loc: x.loc, sku: x.sku, lot: x.lot, po: x.po, id: x.id });
      x.pairs.push({ group: group, qty: m, loc: s.loc, sku: s.sku, lot: s.lot, po: s.po, id: s.id });
    }

    /* 1. LOT/PO ผิด: โลเดียวกัน SKU เดียวกัน */
    shorts().forEach(function (s) {
      overs().forEach(function (x) { if (s.left > 0 && x.loc === s.loc && x.k === s.k) pair(s, x, G.LOTPO); });
    });

    /* 2. พิมพ์ผิด: จำนวนที่หน้าตาเหมือนพิมพ์พลาดของกองเดียวกัน */
    open.forEach(function (L) {
      if (L.left > 0 && L.book > 0 && L.inv > 0 && L.left === Math.abs(L.diff) && qtyTypo(L.book, L.inv)) {
        L.typo = 'จำนวน'; L.typoHint = f3(L.book); L.left = 0;
      }
    });
    /* SKU เกือบเหมือน SKU ที่ขาดในโลเดียวกัน จำนวนเท่ากัน */
    overs().forEach(function (x) {
      shorts().forEach(function (s) {
        if (x.left > 0 && s.loc === x.loc && s.left === x.left &&
          (similarCode(norm(x.long), norm(s.long)) || similarCode(norm(x.sku), norm(s.sku)))) {
          pair(s, x, G.TYPO);
          x.typoHint = s.sku;
        }
      });
    });

    /* 3. วางผิดโล: แถวเดียวกันก่อน แล้วโซนเดียวกัน แล้วที่ไหนก็ได้ LOT/PO ตรงกันมาก่อน */
    [function (s, x) { return x.row === s.row && x.lot === s.lot && x.po === s.po; },
      function (s, x) { return x.row === s.row; },
      function (s, x) { return x.zone === s.zone && x.lot === s.lot && x.po === s.po; },
      function (s, x) { return x.zone === s.zone; },
      function (s, x) { return x.lot === s.lot && x.po === s.po; },
      function () { return true; }].forEach(function (near) {
      shorts().forEach(function (s) {
        overs().forEach(function (x) { if (s.left > 0 && x.loc !== s.loc && x.k === s.k && near(s, x)) pair(s, x, G.MOVED); });
      });
    });

    /* SKU ที่ไม่มีในคลังเลย ไม่มีทางมาจากโลอื่น = พิมพ์ผิดแน่ ๆ */
    overs().forEach(function (x) { if (!x.known && x.left > 0) { x.typo = 'SKU'; } });

    /* 4. ตั้งกลุ่ม: ส่วนที่อธิบายได้มากที่สุดชนะ ส่วนที่เหลือบอกไว้ในหมายเหตุ */
    open.forEach(function (L) {
      var by = {};
      L.pairs.forEach(function (p) { by[p.group] = round3((by[p.group] || 0) + p.qty); });
      if (L.typo === 'จำนวน') by[G.TYPO] = Math.abs(L.diff);
      if (L.typo === 'SKU') by[G.TYPO] = round3((by[G.TYPO] || 0) + L.left);
      var rest = L.typo === 'SKU' ? 0 : L.left;
      var best = '', bestQ = 0;
      Object.keys(by).forEach(function (g) { if (by[g] > bestQ) { best = g; bestQ = by[g]; } });
      L.group = best && bestQ >= rest ? best : (L.diff < 0 ? G.SHORT : G.OVER);
      L.note = noteOf(L, by, rest);
    });
    lines.forEach(function (L) {
      if (!L.group) L.group = G.OK;
      if (L.group === G.LEFT) L.note = L.sku ? 'ยังไม่มีใครนับโลนี้' : 'โลนี้ยังไม่ถูกนับ (ในสมุดว่าง)';
      L.fix = fixOf(L, teamName);
    });

    /* Inv≠Audit: เทียบตัวเลขสองฝั่งในโลที่ Audit สุ่ม ไม่ดูยอดในสมุด */
    var audit = [];
    var stat = {}, auditRows = {};
    Object.keys(audDone).sort(locCmp).forEach(function (u) {
      if (!invDone[u]) return;
      var c = inv[u] || {}, a = aud[u] || {}, b = book[u] || {};
      var ids = Object.keys(c).concat(Object.keys(a).filter(function (id) { return !c[id]; }));
      var bad = false;
      ids.forEach(function (id) {
        var ci = c[id] ? c[id].qty : 0, ai = a[id] ? a[id].qty : 0;
        if (ci === ai) return;
        bad = true;
        var src = c[id] || a[id], nfo = infoOf(src.k, src.sku, src.long), p = meta[u];
        audit.push({
          id: 'A|' + u + '|' + id, group: G.AUDIT, loc: u, zone: p.zone, row: p.group, level: p.level,
          k: src.k, sku: nfo.sku, long: nfo.long, name: nfo.name, lot: src.lot, po: src.po,
          book: b[id] ? b[id].qty : 0, inv: ci, aud: ai, diff: round3(ci - ai),
          team: invTeam[u], who: Object.keys(invWho[u] || {}), auditor: Object.keys(audWho[u] || {}),
          note: 'Inventory ' + f3(ci) + ' · Audit ' + f3(ai), fix: 'นับรอบ 2 โดยทีมอื่น', pairs: [],
        });
      });
      var ar = auditRows[meta[u].group] = auditRows[meta[u].group] || { checked: 0, bad: 0 };
      ar.checked++;
      if (bad) ar.bad++;
      /* นับต่อคน: คนที่นับโลนี้ (Inventory) ถูก Audit ตรวจกี่โล ไม่ตรงกี่โล */
      Object.keys(invWho[u] || {}).forEach(function (w) {
        var key = invTeam[u] + '|' + w;
        var s = stat[key] = stat[key] || { team: invTeam[u], teamName: teamName[invTeam[u]] || invTeam[u], who: w, checked: 0, bad: 0 };
        s.checked++;
        if (bad) s.bad++;
      });
    });
    var people = Object.keys(stat).map(function (k) {
      var s = stat[k]; s.pct = Math.round(s.bad * 100 / s.checked); return s;
    }).sort(function (a, b) { return b.pct - a.pct || b.bad - a.bad || natCmp(a.who, b.who); });

    /* จุดที่ผิดบ่อย: แถวและชั้น */
    var hotMap = {};
    lines.concat(audit).forEach(function (L) {
      if (L.group === G.OK || L.group === G.LEFT) return;
      var key = L.row + '|' + (L.zone === 'R' ? L.level : 0);
      var h = hotMap[key] = hotMap[key] || { row: L.row, level: L.zone === 'R' ? L.level : 0, n: 0, locs: {} };
      h.n++; h.locs[L.loc] = 1;
    });
    var hot = Object.keys(hotMap).map(function (k) { var h = hotMap[k]; h.locs = Object.keys(h.locs).length; return h; })
      .sort(function (a, b) { return b.n - a.n || groupCmp(a.row, b.row) || a.level - b.level; });

    var counts = {};
    GROUPS.concat([G.OK]).forEach(function (g) { counts[g] = { n: 0, qty: 0, locs: 0 }; });
    var locSeen = {};
    lines.concat(audit).forEach(function (L) {
      var c = counts[L.group];
      c.n++;
      c.qty = round3(c.qty + Math.abs(L.diff || (L.group === G.LEFT ? L.book : 0)));
      if (!locSeen[L.group + L.loc]) { locSeen[L.group + L.loc] = 1; c.locs++; }
    });
    var totals = { book: 0, inv: 0, diff: 0, locs: Object.keys(listed).length, counted: 0 };
    lines.forEach(function (L) {
      if (L.inv === null) return;
      totals.book = round3(totals.book + L.book);
      totals.inv = round3(totals.inv + L.inv);
    });
    totals.diff = round3(totals.inv - totals.book);
    totals.counted = Object.keys(invDone).filter(function (u) { return listed[u]; }).length;

    return {
      lines: lines, audit: audit, counts: counts, totals: totals, hot: hot, people: people, teamName: teamName,
      done: Object.keys(invDone).sort(locCmp), auditRows: auditRows, multi: multi,
    };
  }

  function f3(n) { return String(round3(+n || 0)); }

  function noteOf(L, by, rest) {
    var parts = [];
    var dir = L.diff < 0 ? 'ขาด' : 'เกิน';
    parts.push(dir + ' ' + f3(Math.abs(L.diff)));
    L.pairs.forEach(function (p) {
      if (p.group === G.LOTPO) parts.push('LOT/PO ' + (p.lot || '-') + ' / ' + (p.po || '-') + (L.diff < 0 ? ' เกิน ' : ' ขาด ') + f3(p.qty));
      else if (p.group === G.MOVED) parts.push((L.diff < 0 ? 'เจอที่ ' : 'น่าจะมาจาก ') + p.loc + ' ' + f3(p.qty));
      else if (p.group === G.TYPO) parts.push(L.diff < 0 ? 'อาจกรอกเป็น ' + p.sku : 'น่าจะเป็น ' + p.sku);
    });
    if (L.typo === 'จำนวน') parts.push('นับได้ ' + f3(L.inv) + ' หน้าตาเหมือนพิมพ์ ' + f3(L.book) + ' ผิด');
    if (L.typo === 'SKU') parts.push('SKU นี้ไม่มีในคลัง');
    if (rest > 0 && L.pairs.length) parts.push(dir + 'อีก ' + f3(rest));
    return parts.join(' · ');
  }

  function fixOf(L, teamName) {
    var moved = L.pairs.filter(function (p) { return p.group === G.MOVED; })[0];
    switch (L.group) {
      case G.SHORT: return 'นับซ้ำรอบ 2 · ถ้ายังขาด เช็คขาย/เบิกที่ยังไม่ลงสมุด';
      case G.OVER: return 'นับซ้ำรอบ 2 · ถ้ายังเกิน เช็ครับเข้า/ย้ายที่ยังไม่ลงสมุด';
      case G.MOVED: return L.diff < 0
        ? 'ย้ายของจาก ' + moved.loc + ' กลับมา ' + L.loc + ' หรือลงสมุดย้าย ' + L.loc + ' → ' + moved.loc + ' × ' + f3(moved.qty)
        : 'ย้ายของกลับ ' + moved.loc + ' หรือลงสมุดย้าย ' + moved.loc + ' → ' + L.loc + ' × ' + f3(moved.qty);
      case G.LOTPO: return 'ดูป้าย LOT/PO ที่กองอีกครั้ง ถ้าป้ายถูก แก้ LOT/PO ในสมุดให้ตรง';
      case G.TYPO: {
        var t = L.pairs.filter(function (p) { return p.group === G.TYPO; })[0];
        if (L.typo === 'จำนวน' || (L.typoHint && L.diff > 0)) return 'ให้คนนับดูอีกครั้ง น่าจะเป็น ' + L.typoHint;
        if (t && L.diff < 0) return 'ให้คนนับดูอีกครั้ง อาจกรอกเป็น ' + t.sku;
        return 'ให้คนนับดูรหัสที่ป้ายอีกครั้ง';
      }
      case G.LEFT: return L.team ? 'ส่ง ' + (teamName[L.team] || L.team) + ' ไปนับ' : 'ยังไม่มีทีม แบ่งทีมให้แถว ' + L.row;
      default: return '';
    }
  }

  /**
   * แถวในสมุดที่น่าจะเป็นต้นเหตุ: แถวล่าสุดของ SKU นี้ที่เข้า-ออกโลนี้ (และโลคู่ถ้ามี)
   * fifo = คำตอบ tx-fifo  ไม่เกิน limit แถว ใหม่สุดก่อน
   */
  function suspects(fifo, L, limit) {
    var f = fifo || {};
    var want = norm(L.long), short = norm(L.sku);
    var si = {};
    (f.skus || []).forEach(function (s, i) { if (norm(s[1]) === want || (short && norm(s[0]) === short)) si[i] = 1; });
    var locs = {};
    [L.loc].concat((L.pairs || []).map(function (p) { return p.loc; })).forEach(function (l) { locs[up(l)] = 1; });
    var out = [];
    (f.rows || []).forEach(function (r) {
      if (!si[r[1]]) return;
      var from = r[4] >= 0 ? up((f.locs || [])[r[4]]) : '', to = r[5] >= 0 ? up((f.locs || [])[r[5]]) : '';
      if (!locs[from] && !locs[to]) return;
      out.push({
        row: r[0], date: r[8] >= 0 && (r[9] & 8) ? (f.days || [])[r[8]] : '',
        type: r[7] === 2 ? 'ขาย' : r[7] === 1 ? 'เบิก' : from ? 'ย้าย' : 'รับ',
        qty: r[6], from: from, to: to, lot: r[2] === null || r[2] === undefined ? '' : String(r[2]), po: (f.pos || [])[r[3]] || '',
      });
    });
    return out.sort(function (a, b) { return b.row - a.row; }).slice(0, limit || 5);
  }

  /**
   * แถวสำหรับแท็บผลสรุปในชีต (หัวตาราง TABS[T_SUM] ใน stocktake-api.gs ไม่รวมรหัสรอบ)
   * [Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, สมุด, Inventory, Audit, รอบ 2, ยอดสุดท้าย, ต่าง, กลุ่ม, เหตุผล, ทีม, คนนับ]
   * ยอดสุดท้ายตอนนี้ = ที่ Inventory นับ (รอบ 2 จะมาแทนในขั้นถัดไป) โลที่ยังไม่นับใช้ยอดในสมุดไปก่อน
   */
  function summaryRows(res) {
    var r = res || {};
    var audit = {};
    (r.audit || []).forEach(function (a) { audit[a.loc + '|' + a.k + '|' + norm(a.lot) + '|' + norm(a.po)] = a; });
    return (r.lines || []).filter(function (L) { return L.sku || L.long; }).map(function (L) {
      var a = audit[L.loc + '|' + L.k + '|' + norm(L.lot) + '|' + norm(L.po)];
      var final = L.inv === null ? L.book : L.inv;
      var group = L.group === G.OK && a ? G.AUDIT : L.group;
      var note = a ? (L.note ? L.note + ' · ' : '') + a.note : L.note;
      return [L.loc, L.sku, L.long, L.name, L.lot, L.po, L.book, L.inv === null ? '' : L.inv, L.aud === null ? '' : L.aud,
        '', final, round3(final - L.book), group, note, (r.teamName && r.teamName[L.team]) || L.team, (L.who || []).join(', ')];
    });
  }

  /* ── นับรอบ 2 และปิดรอบ (ขั้นที่ 3) ───────────────────────────────────── */

  /*
   * ค่าตั้งของแผนรอบ 2 (หัวหน้าปรับได้ เก็บในค่าตั้งของรอบ)
   *   groups = กลุ่มปัญหาที่ต้องนับซ้ำ  minQty = ต่างกันกี่ชิ้นขึ้นไปถึงนับซ้ำ (ยังไม่นับ / Audit ไม่สนข้อนี้)
   *   hotPct / hotMin = แถวที่ Audit ตรวจอย่างน้อย hotMin โล แล้วไม่ตรง hotPct% ขึ้นไป → นับซ้ำทั้งแถว
   *   multi = นับซ้ำโลที่มีหลายคนนับในรอบ 1 (ยอดอาจซ้ำ)
   *   add = โลที่หัวหน้าเพิ่มเอง  drop = โลที่หัวหน้าตัดออก  set = {โล: ทีม} หัวหน้าเลือกทีมเอง
   */
  var R2 = { groups: GROUPS.slice(), minQty: 1, hotPct: 30, hotMin: 2, multi: true };
  var R2_ADD = 'หัวหน้าเพิ่ม', R2_PAIR = 'คู่วางผิดโล', R2_ROW = 'ทั้งแถว', R2_MULTI = 'หลายคนนับ';

  function numOr(v, d, lo, hi) {
    var n = typeof v === 'number' ? v : (v === '' || v === null || v === undefined ? NaN : Number(v));
    if (!isFinite(n)) return d;
    return Math.max(lo, Math.min(hi, n));
  }

  function r2Opts(x) {
    var o = x || {};
    var set = {};
    if (o.set && typeof o.set === 'object') Object.keys(o.set).forEach(function (l) { if (o.set[l]) set[up(l)] = up(o.set[l]); });
    return {
      groups: Array.isArray(o.groups) ? o.groups.filter(function (g) { return GROUPS.indexOf(g) !== -1; }) : R2.groups.slice(),
      minQty: numOr(o.minQty, R2.minQty, 0, 1e9),
      hotPct: numOr(o.hotPct, R2.hotPct, 0, 100),
      hotMin: numOr(o.hotMin, R2.hotMin, 1, 1e6),
      multi: o.multi !== false,
      add: (o.add || []).map(up).filter(function (l) { return l; }),
      drop: (o.drop || []).map(up).filter(function (l) { return l; }),
      set: set,
    };
  }

  /**
   * แผนนับรอบ 2 จากผลวิเคราะห์รอบ 1
   * res = analyze() ของรอบ 1  in = { teams (ทุกรอบ), locs = โลที่นับรอบนี้ [{loc, group}], opts }
   *
   * เลือกโล: กองที่อยู่ในกลุ่มที่เลือกและต่าง ≥ minQty · โลคู่ของวางผิดโล · Inv≠Audit
   *          · แถวที่ Audit เจอผิดบ่อย (นับทั้งแถว) · โลที่หัวหน้าเพิ่ม
   * แบ่งทีม: ทีละแถวตามทางเดิน ให้ทีม Inventory ที่ไม่ใช่ทีมที่นับรอบ 1 และงานน้อยสุดตอนนั้น
   *          มีทีมเดียว = ทีมเดิม แต่คนที่นับโลนั้นในรอบ 1 ห้ามนับซ้ำ (forbid ใช้ทุกกรณีอยู่แล้ว)
   * @returns {{opts, locs, teams, hot, warn, counts}}
   *   locs = [{loc, row, zone, why, tags, r1team, forbid, team, auto, drop}] ทุกโลที่เข้าเกณฑ์ (รวมที่ตัดออก)
   *   teams = ทีมของรอบ 2 (pass 2) zones = รายการโล
   */
  function plan2(res, input) {
    var o = input || {};
    var opt = r2Opts(o.opts);
    var r = res || {};
    var want = {}, drop = {};
    opt.groups.forEach(function (g) { want[g] = 1; });
    opt.drop.forEach(function (l) { drop[l] = 1; });

    var inv = teamsOf(o.teams, 1).filter(function (t) { return t.kind !== 'Audit'; });
    var owner = {}, invById = {};
    inv.forEach(function (t) { invById[t.id] = t; (t.zones || []).forEach(function (z) { owner[up(z)] = t.id; }); });

    /* ทีมกับคนที่นับแต่ละโลในรอบ 1 */
    var r1 = {};
    (r.lines || []).concat(r.audit || []).forEach(function (L) {
      var x = r1[L.loc] = r1[L.loc] || { team: '', who: {} };
      if (L.team && (!x.team || L.inv !== null)) x.team = L.team;
      if (L.inv !== null && L.inv !== undefined) (L.who || []).forEach(function (w) { if (w && w !== '?') x.who[w] = 1; });
    });

    var meta = {}, order = [];
    function at(loc) {
      var u = up(loc);
      if (!meta[u]) {
        var p = parseLoc(u);
        meta[u] = { loc: u, row: p.group, zone: p.zone, by: {}, tags: [] };
        order.push(u);
      }
      return meta[u];
    }
    /* กลุ่มปัญหาเก็บขาดกับเกินแยกกัน แล้วแสดงข้างที่มากกว่า: LOT/PO ผิด 6 ชิ้น ไม่ใช่ 12 (ขาด 6 + เกิน 6) */
    function add(loc, tag, val) {
      var m = at(loc);
      if (!(tag in m.by)) { m.tags.push(tag); m.by[tag] = tag === R2_PAIR ? [] : typeof val === 'number' ? { neg: 0, pos: 0 } : ''; }
      if (tag === R2_PAIR) { if (m.by[tag].indexOf(val) === -1) m.by[tag].push(val); }
      else if (typeof val === 'number') { var b = m.by[tag]; if (val < 0) b.neg = round3(b.neg - val); else b.pos = round3(b.pos + val); }
      else if (val) m.by[tag] = val;
    }

    (r.lines || []).forEach(function (L) {
      if (!want[L.group]) return;
      if (L.group === G.LEFT) { add(L.loc, G.LEFT, ''); return; }
      if (!L.diff || !(Math.abs(L.diff) >= opt.minQty)) return;
      add(L.loc, L.group, L.diff);
      if (L.group === G.MOVED) {
        L.pairs.forEach(function (p) { if (p.group === G.MOVED) add(p.loc, R2_PAIR, L.loc); });
      }
    });
    if (want[G.AUDIT]) {
      (r.audit || []).forEach(function (A) { if (A.diff && Math.abs(A.diff) >= opt.minQty) add(A.loc, G.AUDIT, Math.abs(A.diff)); });
    }
    var hot = [];
    var ar = r.auditRows || {};
    Object.keys(ar).forEach(function (row) {
      var s = ar[row];
      var pct = s.checked ? Math.round(s.bad * 100 / s.checked) : 0;
      var on = opt.hotPct > 0 && s.checked >= opt.hotMin && s.bad > 0 && pct >= opt.hotPct;
      hot.push({ row: row, checked: s.checked, bad: s.bad, pct: pct, on: on });
      if (!on) return;
      (o.locs || []).forEach(function (l) {
        if (up(l.group || parseLoc(l.loc).group) === up(row)) add(l.loc, R2_ROW, 'Audit ไม่ตรง ' + s.bad + '/' + s.checked + ' โล');
      });
    });
    hot.sort(function (a, b) { return b.pct - a.pct || b.bad - a.bad || groupCmp(a.row, b.row); });
    /* Inventory หลายคนนับโลเดียวกัน (Audit ไม่ได้มีผลกับยอดสุดท้าย ไม่ต้องนับซ้ำ) */
    if (opt.multi) {
      (r.multi || []).forEach(function (m) { if (m.kind !== 'Audit') add(m.loc, R2_MULTI, m.who.join(', ')); });
    }
    opt.add.forEach(function (l) { add(l, R2_ADD, ''); });

    /* แบ่งทีม ทีละแถวตามทางเดิน */
    var load = {};
    inv.forEach(function (t) { load[t.id] = 0; });
    function lightest(not) {
      var best = null;
      inv.forEach(function (t) { if (t.id !== not && (!best || load[t.id] < load[best.id])) best = t; });
      return best;
    }
    order.sort(locCmp);
    order.forEach(function (u) {
      var m = meta[u];
      m.r1team = (r1[u] && r1[u].team) || owner[up(m.row)] || owner[u] || '';
      m.forbid = Object.keys((r1[u] && r1[u].who) || {}).sort(natCmp);
      m.drop = !!drop[u];
    });
    var rows = [], byRow = {};
    order.forEach(function (u) {
      var m = meta[u];
      if (m.drop) return;
      if (!byRow[m.row]) { byRow[m.row] = []; rows.push(m.row); }
      byRow[m.row].push(m);
    });
    rows.forEach(function (row) {
      var list = byRow[row];
      var cnt = {}, top = '', topN = 0;
      list.forEach(function (m) {
        cnt[m.r1team] = (cnt[m.r1team] || 0) + 1;
        if (cnt[m.r1team] > topN) { top = m.r1team; topN = cnt[m.r1team]; }
      });
      var pick = lightest(top) || lightest('');
      list.forEach(function (m) {
        var t = pick && pick.id !== m.r1team ? pick : (lightest(m.r1team) || pick);
        m.auto = t ? t.id : '';
        m.team = opt.set[m.loc] && invById[opt.set[m.loc]] ? opt.set[m.loc] : m.auto;
        if (m.team) load[m.team]++;
      });
    });

    var warn = [];
    if (!inv.length) warn.push('ยังไม่มีทีม Inventory ของรอบ 1');
    else if (inv.length === 1) warn.push('มีทีม Inventory ทีมเดียว ใช้ทีมเดิมนับซ้ำ แต่คนที่นับโลนั้นในรอบ 1 นับซ้ำไม่ได้');
    var locs = order.map(function (u) {
      var m = meta[u];
      var t = invById[m.team];
      if (!m.drop && t && t.members && t.members.length && t.members.every(function (w) { return m.forbid.indexOf(w) !== -1; })) {
        warn.push(u + ': ทุกคนใน ' + (t.name || t.id) + ' นับโลนี้ในรอบ 1 แล้ว เลือกทีมอื่น');
      }
      return {
        loc: u, row: m.row, zone: m.zone, why: whyText(m), tags: m.tags.slice(), r1team: m.r1team, forbid: m.forbid,
        team: m.drop ? '' : m.team || '', auto: m.drop ? '' : m.auto || '', drop: m.drop,
      };
    });
    var teams = inv.map(function (t) {
      var z = locs.filter(function (l) { return !l.drop && l.team === t.id; }).map(function (l) { return l.loc; });
      return { pass: 2, id: t.id, kind: 'Inventory', name: t.name, members: (t.members || []).slice(), zones: z, locs: z.length };
    });
    var counts = { all: locs.length, picked: 0, dropped: 0, tags: {} };
    locs.forEach(function (l) {
      if (l.drop) { counts.dropped++; return; }
      counts.picked++;
      l.tags.forEach(function (g) { counts.tags[g] = (counts.tags[g] || 0) + 1; });
    });
    return { opts: opt, locs: locs, teams: teams, hot: hot, warn: warn, counts: counts };
  }

  /* วางผิดโลที่มีโลคู่ด้วยรวมเป็นข้อความเดียว: "วางผิดโล 5 คู่ A-01-01" */
  function whyText(m) {
    var pair = m.by[R2_PAIR], moved = G.MOVED in m.by;
    return m.tags.filter(function (g) { return !(g === R2_PAIR && moved); }).map(function (g) {
      var v = m.by[g];
      if (g === G.MOVED && pair) return G.MOVED + ' ' + f3(Math.max(v.neg, v.pos)) + ' คู่ ' + pair.join(', ');
      if (g === R2_PAIR) return R2_PAIR + ' ' + v.join(', ');
      if (g === R2_ROW) return R2_ROW + ' ' + m.row + ' (' + v + ')';
      if (g === R2_MULTI) return R2_MULTI + ' (' + v + ')';
      if (g === R2_ADD || g === G.LEFT || !v || typeof v !== 'object') return g;
      return g + ' ' + f3(Math.max(v.neg, v.pos));
    }).join(' · ');
  }

  /** แถวสำหรับ st-plan: [Location, แถว, เหตุผล, ทีม, [ห้ามคนนับ], ทีมรอบ 1, โซน] เฉพาะโลที่ไม่ได้ตัดออก */
  function planRows(plan) {
    return ((plan && plan.locs) || []).filter(function (l) { return !l.drop && l.team; })
      .map(function (l) { return [l.loc, l.row, l.why, l.team, l.forbid, l.r1team, l.zone]; });
  }

  /**
   * ความคืบหน้ารอบ 2 จากแผนที่บันทึกแล้ว planLocs = [{loc, team}]
   * นับแล้ว = มีแถวนับ/ว่างของ Inventory ในรอบนับ 2 ที่โลนั้น
   */
  function progress2(planLocs, entries) {
    var eff = effective(entries).filter(function (e) { return e.pass === 2 && e.kind !== 'Audit'; });
    var done = {}, who = {};
    eff.forEach(function (e) { var u = up(e.loc); done[u] = 1; (who[u] = who[u] || {})[e.who || '?'] = 1; });
    var teams = {}, tlist = [], left = [], known = {}, n = 0;
    (planLocs || []).forEach(function (p) {
      var u = up(p.loc);
      known[u] = 1;
      var t = teams[p.team];
      if (!t) { t = teams[p.team] = { id: p.team, n: 0, done: 0 }; tlist.push(t); }
      t.n++;
      if (done[u]) { t.done++; n++; } else left.push(u);
    });
    tlist.forEach(function (t) { t.pct = t.n ? Math.round(t.done * 100 / t.n) : 0; });
    var total = (planLocs || []).length;
    return {
      total: total, done: n, pct: total ? Math.round(n * 100 / total) : 0, teams: tlist, left: left, isDone: done,
      who: who, extra: Object.keys(done).filter(function (u) { return !known[u]; }).sort(locCmp),
    };
  }

  var SRC = { R2: 'รอบ 2', R1: 'รอบ 1', BOOK: 'สมุด', EDIT: 'หัวหน้าแก้' };
  var FLAG = { NONE: 'ไม่ได้นับ', WAIT: 'ค้างรอบ 2', ODD: 'สามค่าไม่ตรง' };

  /**
   * ยอดสุดท้ายราย Location × SKU × LOT × PO
   *   โลที่นับรอบ 2 แล้ว → ใช้รอบ 2 ทั้งโล (กองที่รอบ 2 ไม่เจอ = 0)
   *   ไม่ได้นับรอบ 2 → ใช้รอบ 1 (ถ้าอยู่ในแผนรอบ 2 ขึ้นว่าค้างรอบ 2)
   *   ไม่มีใครนับเลย → ใช้ยอดในสมุด ขึ้นว่าไม่ได้นับ
   *   หัวหน้าแก้ตัวเลข (edits = {id: จำนวน}) ทับทุกอย่าง
   * res1 = analyze รอบ 1  res2 = analyze รอบ 2 (only = โลในแผน)  planLocs = [{loc}] หรือ ['loc']
   */
  function finalLines(res1, res2, planLocs, edits) {
    var plan = {};
    (planLocs || []).forEach(function (l) { plan[up(typeof l === 'string' ? l : l.loc)] = 1; });
    var ed = edits || {};
    var done1 = {}, done2 = {};
    ((res1 && res1.done) || []).forEach(function (u) { done1[u] = 1; });
    ((res2 && res2.done) || []).forEach(function (u) { if (plan[u]) done2[u] = 1; });
    var by = {}, order = [];
    function slot(L) {
      if (!by[L.id]) { by[L.id] = { L1: null, L2: null }; order.push(L.id); }
      return by[L.id];
    }
    ((res1 && res1.lines) || []).forEach(function (L) { if (L.sku || L.long) slot(L).L1 = L; });
    ((res2 && res2.lines) || []).forEach(function (L) { if ((L.sku || L.long) && done2[L.loc]) slot(L).L2 = L; });

    var out = order.map(function (id) {
      var s = by[id], L = s.L2 || s.L1, loc = L.loc;
      var book = (s.L1 || s.L2).book;
      var r1 = s.L1 && s.L1.inv !== null ? s.L1.inv : (done1[loc] ? 0 : null);
      var r2 = done2[loc] ? (s.L2 ? s.L2.inv : 0) : null;
      var src, auto, flag = '';
      if (r2 !== null) { auto = r2; src = SRC.R2; if (r1 !== null && r2 !== r1 && r2 !== book) flag = FLAG.ODD; }
      else if (r1 !== null) { auto = r1; src = SRC.R1; if (plan[loc]) flag = FLAG.WAIT; }
      else { auto = book; src = SRC.BOOK; flag = FLAG.NONE; }
      var final = auto;
      var e = ed[id];
      if (typeof e === 'number' && isFinite(e) && e >= 0 && e !== auto) { final = e; src = SRC.EDIT; }
      final = round3(final);
      var adj = round3(final - book);
      var g1 = s.L1 ? s.L1.group : '', g2 = s.L2 ? s.L2.group : '';
      var group = !adj ? (src === SRC.BOOK ? G.LEFT : G.OK)
        : src === SRC.EDIT ? SRC.EDIT
        : src === SRC.R2 && g2 && g2 !== G.OK && g2 !== G.LEFT ? g2
        : src === SRC.R1 && g1 && g1 !== G.OK && g1 !== G.LEFT ? g1
        : adj < 0 ? G.SHORT : G.OVER;
      return {
        id: id, loc: loc, row: L.row, zone: L.zone, k: L.k, sku: L.sku, long: L.long,
        name: L.name || (s.L1 && s.L1.name) || '', lot: L.lot, po: L.po,
        book: book, r1: r1, aud: s.L1 ? s.L1.aud : null, r2: r2, auto: round3(auto), final: final, adj: adj,
        src: src, flag: flag, plan: !!plan[loc], group: group, g1: g1, g2: g2,
        note: (s.L2 && s.L2.note) || (s.L1 && s.L1.note) || '',
        team: s.L1 ? s.L1.team : '', who: s.L1 ? s.L1.who : [], team2: s.L2 ? s.L2.team : '', who2: s.L2 ? s.L2.who : [],
      };
    });
    return out.sort(function (a, b) { return locCmp(a.loc, b.loc) || natCmp(a.sku, b.sku) || natCmp(a.lot, b.lot) || natCmp(a.po, b.po); });
  }

  /** ยอดรวมของยอดสุดท้าย ให้แถบบนหน้าปิดรอบและช่องสรุปในไฟล์ Excel */
  function finalTotals(fin) {
    var t = { lines: 0, adjLines: 0, book: 0, final: 0, plus: 0, minus: 0, net: 0, src: {}, flag: {} };
    (fin || []).forEach(function (l) {
      t.lines++;
      t.book = round3(t.book + l.book);
      t.final = round3(t.final + l.final);
      if (l.adj > 0) t.plus = round3(t.plus + l.adj);
      if (l.adj < 0) t.minus = round3(t.minus - l.adj);
      if (l.adj) t.adjLines++;
      t.src[l.src] = (t.src[l.src] || 0) + 1;
      if (l.flag) t.flag[l.flag] = (t.flag[l.flag] || 0) + 1;
    });
    t.net = round3(t.final - t.book);
    return t;
  }

  /**
   * แถวผลสรุปตอนปิดรอบ (16 ช่อง แบบเดียวกับ summaryRows ส่ง st-close)
   * [Location, SKU, SKU เต็ม, ชื่อ, LOT, PO, สมุด, Inventory, Audit, รอบ 2, ยอดสุดท้าย, ต่าง, กลุ่ม, เหตุผล, ทีม, คนนับ]
   */
  function closeRows(fin, teamName) {
    var T = teamName || {};
    return (fin || []).map(function (l) {
      var note = 'ยอดจาก' + l.src + (l.flag ? ' · ' + l.flag : '') + (l.src === SRC.EDIT ? ' · ระบบคิดได้ ' + f3(l.auto) : '') + (l.note ? ' · ' + l.note : '');
      var who = (l.who2 && l.who2.length ? 'รอบ 2: ' + l.who2.join(', ') + ' · ' : '') + (l.who && l.who.length ? 'รอบ 1: ' + l.who.join(', ') : '');
      var team = l.team2 ? T[l.team2] || l.team2 : T[l.team] || l.team || '';
      return [l.loc, l.sku, l.long, l.name, l.lot, l.po, l.book, l.r1 === null ? '' : l.r1, l.aud === null || l.aud === undefined ? '' : l.aud,
        l.r2 === null ? '' : l.r2, l.final, l.adj, l.group, note, team, who];
    });
  }

  function numCell(v) { return typeof v === 'number' && isFinite(v) ? v : (v === '' || v === null || v === undefined ? 0 : Number(v) || 0); }

  /**
   * จับคู่ปรับเพิ่ม-ปรับลดที่ลงสมุดเป็นรายการเดียวได้ แทนการปรับยอดสองบรรทัด
   *   แก้ LOT/PO = โลเดียวกัน SKU เดียวกัน ลดใน LOT/PO หนึ่ง เพิ่มในอีก LOT/PO
   *   ย้ายโล    = SKU LOT PO เดียวกัน ลดที่โลหนึ่ง เพิ่มอีกโล (แถวเดียวกันก่อน แล้วโซนเดียวกัน แล้วที่ไหนก็ได้)
   * rows = แถว 16 ช่องที่ปรับ (ช่องที่ 12 ≠ 0)
   */
  function pairAdjust(rows) {
    var items = (rows || []).map(function (r) {
      var p = parseLoc(r[0]);
      return { loc: up(r[0]), sku: r[1], long: r[2], name: r[3], k: norm(r[2] || r[1]), lot: String(r[4] == null ? '' : r[4]), po: String(r[5] == null ? '' : r[5]),
        left: Math.abs(numCell(r[11])), neg: numCell(r[11]) < 0, row: p.group, zone: p.zone };
    }).filter(function (i) { return i.left > 0; });
    var negs = items.filter(function (i) { return i.neg; }), poss = items.filter(function (i) { return !i.neg; });
    var out = [];
    function take(n, x, type) {
      var q = round3(Math.min(n.left, x.left));
      if (!(q > 0)) return;
      n.left = round3(n.left - q); x.left = round3(x.left - q);
      out.push([type, n.loc, x.loc, n.sku, n.long, n.name, n.lot, n.po, x.lot, x.po, q]);
    }
    negs.forEach(function (n) {
      poss.forEach(function (x) {
        if (n.left > 0 && x.loc === n.loc && x.k === n.k && (norm(x.lot) !== norm(n.lot) || norm(x.po) !== norm(n.po))) take(n, x, 'แก้ LOT/PO');
      });
    });
    [function (n, x) { return x.row === n.row; }, function (n, x) { return x.zone === n.zone; }, function () { return true; }].forEach(function (near) {
      negs.forEach(function (n) {
        poss.forEach(function (x) {
          if (n.left > 0 && x.loc !== n.loc && x.k === n.k && norm(x.lot) === norm(n.lot) && norm(x.po) === norm(n.po) && near(n, x)) take(n, x, 'ย้ายโล');
        });
      });
    });
    return out;
  }

  /**
   * ไฟล์ Excel ปรับยอด สามชีต: ปรับยอด · จับคู่ย้ายโล/แก้ LOT · สรุป
   * rows = แถว 16 ช่อง (closeRows ก่อนปิด หรือแท็บผลสรุปที่เก็บตอนปิด) meta = ข้อมูลรอบ
   * @returns {Array<{name, aoa, cols}>} หน้าเว็บแปลงเป็นไฟล์ด้วยตัวสร้าง Excel อีกที
   * แอปไม่แก้สมุด คนลงสมุดใช้ไฟล์นี้ลงปรับยอดเอง
   */
  function adjustBook(rows, meta) {
    var m = meta || {};
    var all = rows || [];
    var adj = all.filter(function (r) { return numCell(r[11]) !== 0; });
    var cell = function (v) { return v === null || v === undefined ? '' : v; };
    var a1 = [['Location', 'SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'LOT', 'PO', 'ยอดในสมุด', 'ยอดนับสุดท้าย', 'ปรับ', 'ปรับเพิ่ม/ลด', 'รอบ 1', 'Audit', 'รอบ 2', 'กลุ่ม', 'หมายเหตุ']];
    adj.forEach(function (r) {
      var d = numCell(r[11]);
      a1.push([r[0], r[1], r[2], r[3], cell(r[4]), cell(r[5]), numCell(r[6]), numCell(r[10]), d, d > 0 ? 'ปรับเพิ่ม' : 'ปรับลด', cell(r[7]), cell(r[8]), cell(r[9]), cell(r[12]), cell(r[13])]);
    });
    var pairs = pairAdjust(adj);
    var a2 = [['ลงสมุดเป็น', 'จาก Location', 'ไป Location', 'SKU', 'SKU เต็ม', 'ชื่อสินค้า', 'LOT เดิม', 'PO เดิม', 'LOT ใหม่', 'PO ใหม่', 'จำนวน']].concat(pairs);
    var sum = function (f) { return round3(all.reduce(function (s, r) { return s + f(r); }, 0)); };
    var plus = sum(function (r) { return Math.max(0, numCell(r[11])); });
    var minus = sum(function (r) { return Math.max(0, -numCell(r[11])); });
    var a3 = [['หัวข้อ', 'ค่า'],
      ['รหัสรอบ', cell(m.id)], ['ชื่อรอบ', cell(m.name)], ['วันที่นับ', cell(m.date)], ['เวลาตัดยอด', cell(m.cutoff)],
      ['อนุมัติโดย', m.approvedBy || 'ยังไม่อนุมัติ (ร่าง)'], ['อนุมัติเมื่อ', cell(m.approvedAt)],
      ['รายการทั้งหมด', all.length], ['รายการที่ต้องปรับ', adj.length],
      ['ยอดในสมุดรวม', sum(function (r) { return numCell(r[6]); })], ['ยอดนับสุดท้ายรวม', sum(function (r) { return numCell(r[10]); })],
      ['ปรับเพิ่มรวม', plus], ['ปรับลดรวม', minus], ['สุทธิ', round3(plus - minus)],
      ['จับคู่ย้ายโล', pairs.filter(function (p) { return p[0] === 'ย้ายโล'; }).length],
      ['จับคู่แก้ LOT/PO', pairs.filter(function (p) { return p[0] === 'แก้ LOT/PO'; }).length],
      ['หมายเหตุ', 'แอปไม่ได้แก้สมุด Transaction — ลงปรับยอดในสมุดตามชีตปรับยอด (คู่ที่ลงเป็นย้ายโล/แก้ LOT ได้อยู่ในชีตจับคู่)']];
    return [
      { name: 'ปรับยอด', aoa: a1, cols: [12, 14, 20, 32, 8, 13, 10, 12, 8, 11, 8, 8, 8, 12, 50] },
      { name: 'จับคู่ย้ายโล-แก้ LOT', aoa: a2, cols: [11, 12, 12, 14, 20, 32, 8, 13, 8, 13, 8] },
      { name: 'สรุป', aoa: a3, cols: [20, 60] },
    ];
  }

  window.WmsStocktake = {
    ZONES: ZONES, OTHER: OTHER, SKIP: SKIP, AUDIT_MIN: AUDIT_MIN, G: G, GROUPS: GROUPS,
    analyze: analyze, suspects: suspects, summaryRows: summaryRows, qtyTypo: qtyTypo, similarCode: similarCode,
    R2: R2, R2_MULTI: R2_MULTI, SRC: SRC, FLAG: FLAG, r2Opts: r2Opts,
    API_V: API_V, oldScript: oldScript, pileWarn: pileWarn, plan2: plan2, planRows: planRows, progress2: progress2,
    finalLines: finalLines, finalTotals: finalTotals, closeRows: closeRows, pairAdjust: pairAdjust, adjustBook: adjustBook,
    up: up, norm: norm,
    parseLoc: parseLoc, isRealLoc: isRealLoc, natCmp: natCmp, locCmp: locCmp, groupCmp: groupCmp, zoneOfGroup: zoneOfGroup,
    baseline: baseline, locations: locations, parseLocList: parseLocList, groups: groups, autoSplit: autoSplit,
    fromRow: fromRow, effective: effective, atLoc: atLoc, uid: uid, deviceId: deviceId,
    batch: batch, ack: ack, merge: merge,
    teamsOf: teamsOf, teamLocs: teamLocs, progress: progress,
    skuSearch: skuSearch, skuExact: skuExact, poSearch: poSearch, formDirty: formDirty,
    qtyOf: qtyOf, poChoices: poChoices, lotChoices: lotChoices,
    movesAfter: movesAfter, countLink: countLink, parseLink: parseLink,
  };
})();
