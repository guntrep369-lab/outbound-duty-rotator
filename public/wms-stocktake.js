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
   *   locs  = [{loc, piles, rows}] ทุก Location ที่เคยมีในสมุด
   */
  function baseline(fifo, supOf) {
    var f = fifo || {};
    var skus = f.skus || [], pos = f.pos || [], locs = f.locs || [];
    var piles = {}, order = [], lastRow = 0, used = {};
    (f.rows || []).forEach(function (r) {
      var row = r[0], s = r[1], lot = r[2], po = r[3], from = r[4], to = r[5], qty = +r[6] || 0, flag = r[9] || 0;
      if (row > lastRow) lastRow = row;
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
      pos: pos.filter(function (p) { return p; }).map(function (p) { return [p, supOf ? supOf(p) || '' : '']; }),
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

  /** Location ของทีม เรียงตามทางเดิน locList = [[loc, group]] หรือ [{loc, group}] */
  function teamLocs(team, locList) {
    var zones = {};
    ((team && team.zones) || []).forEach(function (z) { zones[up(z)] = 1; });
    return (locList || []).map(function (l) { return Array.isArray(l) ? { loc: l[0], group: l[1] } : l; })
      .filter(function (l) { return zones[up(l.group)]; })
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

  window.WmsStocktake = {
    ZONES: ZONES, OTHER: OTHER, SKIP: SKIP, AUDIT_MIN: AUDIT_MIN,
    up: up, norm: norm,
    parseLoc: parseLoc, isRealLoc: isRealLoc, natCmp: natCmp, locCmp: locCmp, groupCmp: groupCmp, zoneOfGroup: zoneOfGroup,
    baseline: baseline, locations: locations, parseLocList: parseLocList, groups: groups, autoSplit: autoSplit,
    fromRow: fromRow, effective: effective, atLoc: atLoc, uid: uid, deviceId: deviceId,
    batch: batch, ack: ack, merge: merge,
    teamsOf: teamsOf, teamLocs: teamLocs, progress: progress,
    skuSearch: skuSearch, skuExact: skuExact, poSearch: poSearch,
    movesAfter: movesAfter, countLink: countLink, parseLink: parseLink,
  };
})();
