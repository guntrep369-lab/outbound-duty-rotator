/**
 * @file wms-putaway.js — ตัวช่วยจัดที่เก็บ: แพลนรับเข้าของวันนั้น → ควรเอาไปเก็บโลเคชั่นไหน
 *
 * หน้า public/putaway/ ใช้ไฟล์นี้ ข้อมูลสต๊อกมาจาก tx-fifo (ข้อมูลกลาง ชุดเดียวกับหน้า FIFO สต๊อก)
 * ความจุต่อพาเลทมาจากแท็บ "ความจุต่อพาเลท" (tx-fifo ส่ง cap มาด้วย) หรือไฟล์ที่ลากใส่หน้าเว็บ
 *
 * กติกาจากหัวหน้าคลัง (9 พ.ย. 2026)
 *   - แร็ค R ช่องละ 1 พาเลท ไม่ปน SKU ในช่องเดียว ไม่ต้องเติมช่องที่มี SKU เดิมเหลืออยู่
 *   - R ชั้น 1 (เลขชุดท้าย 01) ใส่ได้แค่ที่นอน 5 ฟุตกับ 6 ฟุต สินค้าอื่นเริ่มชั้น 2
 *   - เศษไม่เต็มพาเลทของที่นอน 3.5 ฟุตกับท็อปเปอร์ไป RIB รอตู้รอบหน้า มี SKU เดียวกันเข้ามาก็รวมให้เต็มพาเลทแล้วขึ้นแร็ค
 *   - เศษของที่นอน 5/6 ฟุตต้องหาที่เก็บเองโดยไม่ผิด FIFO: ลงช่องว่างชั้น 1 ช่องของตัวเอง ไม่มีก็ลงพื้นใกล้แบรนด์เดียวกัน
 *   - พื้น A–D ไม่ปน LOT/PO ในโลเดียว แต่วางติดกัน ของแถมไปโซน D
 *   - ของหมด หรือโลเปิดเหลือน้อย (เหลือขายไม่ถึงกี่วัน ตั้งได้ เริ่มที่ 3 วัน) เอาเข้าโลเปิดเลย ติ๊ก OPEN
 *
 * โลเปิดประจำของแต่ละ SKU เรียนจากสมุด: โลที่ถูกเติมบ่อยสุด (แถวเบิกหรือ GR ที่ลงโลเปิดในพื้น A–D หรือชั้นวาง S)
 * ข้อมูลจริงเดือน ต.ค. 2026 79% ของ SKU ที่ถูกเติมหลายครั้งเติมเข้าโลเดิมทุกครั้ง
 *
 * ทุกอย่างที่ไฟล์นี้เสนอเป็นแค่ข้อเสนอ หน้าเว็บให้แก้ได้ทุกแถว check() บอกว่าที่แก้แล้วผิดกติกาข้อไหน
 */
(function () {
  'use strict';

  var SALE_DAYS = 14;           // ยอดขายเฉลี่ยคิดจากกี่วันล่าสุด เท่ากับหน้าสต๊อกราย Location
  var DEFAULTS = { coverDays: 3 };
  var RACK = /^R(\d+)-(\d+)-(\d+)$/;
  var FLOOR = /^([A-D])-(\d+)-(\d+)$/;
  var SHELF = /^S-(\d+)-(\d+)$/;
  /* จุดที่ทีมตั้ง Status เปิดไว้ขายออกแต่ไม่ใช่ที่เก็บ ไม่นับเป็นโลเปิดประจำ */
  var SPECIAL = ['DOCKLOAD', 'ORDER OB', 'OFFICE', 'MKT', 'จอง'];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  /** PO ในแพลนมีเลขท้าย -09 แต่สมุดอาจลงแค่เลขหลัก เทียบด้วยเลขหลัก แบบเดียวกับหน้า FIFO สต๊อก */
  function basePo(v) { var s = up(v); var m = /^(\d{6,})-\d{1,2}$/.exec(s); return m ? m[1] : s; }
  function num(v) {
    if (typeof v === 'number') return v;
    var n = Number(String(v == null ? '' : v).replace(/,/g, '').trim());
    return String(v == null ? '' : v).trim() === '' || isNaN(n) ? NaN : n;
  }
  function round(n) { return Math.round(n * 1000) / 1000; }

  function zoneOf(loc) {
    var u = up(loc), m;
    if (!u) return '';
    if (RACK.test(u)) return 'R';
    if ((m = FLOOR.exec(u))) return m[1];
    if (SHELF.test(u)) return 'S';
    if (u === 'RIB' || u === 'QA' || u === 'IQA') return u;
    if (SPECIAL.indexOf(u) !== -1) return 'special';
    return 'other';
  }
  function rackOf(loc) { var m = RACK.exec(up(loc)); return m ? { rack: +m[1], bay: +m[2], level: +m[3] } : null; }
  function floorOf(loc) { var m = FLOOR.exec(up(loc)); return m ? { zone: m[1], row: +m[2], pos: +m[3] } : null; }
  function isFloor(loc) { return !!floorOf(loc); }
  function brandOf(sku) { var m = /^[A-Z]+/.exec(up(sku)); return m ? m[0] : ''; }

  /**
   * ประเภทสินค้าจากชื่อ: ของแถม / ที่นอน / ท็อปเปอร์ / อื่นๆ กับขนาดเป็นฟุต
   * ชื่อที่ขึ้นต้นด้วยผ้า ชุด ปลอก คือของที่ใช้กับที่นอน ไม่ใช่ตัวที่นอน
   */
  function kindOf(name, sku) {
    var n = String(name || '').trim(), u = n.toUpperCase();
    var m = /(\d+(?:\.\d+)?)\s*FT/.exec(u);
    var size = m ? m[1] + 'FT' : '';
    var k;
    if (/^แถม/.test(n) || /^FRE/.test(up(sku))) k = 'free';
    else if (/ท็อปเปอร์|ท๊อปเปอร์|TOPPER/.test(u)) k = 'topper';
    else if (/ที่นอน/.test(n) && !/^(ผ้า|ชุด|ปลอก)/.test(n)) k = 'mattress';
    else k = 'other';
    var label = k === 'free' ? 'ของแถม' : k === 'topper' ? 'ท็อปเปอร์' : k === 'mattress' ? 'ที่นอน' : 'อื่นๆ';
    return {
      kind: k, size: size, label: size && k !== 'free' && k !== 'other' ? label + ' ' + size.replace('FT', ' ฟุต') : label,
      level1: k === 'mattress' && (size === '5FT' || size === '6FT'),      // ลง R ชั้น 1 ได้ และต้องลงชั้น 1
      rib: (k === 'mattress' && size === '3.5FT') || k === 'topper',        // เศษไป RIB
    };
  }

  /* ── ความจุต่อพาเลท ──────────────────────────────────────────────────── */

  /**
   * ตารางความจุจากไฟล์หรือแท็บ (แถวแรกเป็นหัวตาราง) หาคอลัมน์จากหัวตาราง: SKU, Product ID, STD / pallet
   * @returns {{rows:Array, blank:number, missing:string}} rows = [[SKU, Product ID, จำนวนต่อพาเลท]]
   *   ช่องความจุว่างหรือไม่ใช่ตัวเลขนับไว้ใน blank ความจุ 0 เก็บไว้ หน้าเว็บจะได้บอกว่าในไฟล์เป็น 0
   */
  function capFromRows(grid) {
    var out = { rows: [], blank: 0, missing: '' };
    if (!grid || !grid.length) { out.missing = 'ไฟล์ว่าง'; return out; }
    var hi = -1, cols = null;
    for (var i = 0; i < Math.min(grid.length, 10) && hi < 0; i++) {
      var head = grid[i].map(function (v) { return String(v == null ? '' : v).trim(); });
      var c = { sku: -1, pid: -1, cap: -1 };
      head.forEach(function (h, j) {
        if (c.cap < 0 && /std|pallet|พาเลท|ความจุ/i.test(h)) c.cap = j;
        else if (c.pid < 0 && /product\s*id|รหัสยาว/i.test(h)) c.pid = j;
        else if (c.sku < 0 && /^sku$|^รหัสสินค้า$/i.test(h)) c.sku = j;
      });
      if (c.cap >= 0 && (c.sku >= 0 || c.pid >= 0)) { hi = i; cols = c; }
    }
    if (hi < 0) { out.missing = 'หาหัวตาราง SKU กับ STD / pallet ไม่เจอ'; return out; }
    for (var r = hi + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      var sku = cols.sku >= 0 ? up(row[cols.sku]) : '', pid = cols.pid >= 0 ? up(row[cols.pid]) : '';
      if (!sku && !pid) continue;
      var n = num(row[cols.cap]);
      if (isNaN(n) || n < 0) { out.blank++; continue; }
      out.rows.push([sku, pid, n]);
    }
    return out;
  }

  /** [[SKU, Product ID, n]] → { รหัส: n } ใช้ได้ทั้งรหัสสั้นและรหัสยาว รหัสซ้ำเอาแถวแรก */
  function capMap(rows) {
    var m = {};
    (rows || []).forEach(function (r) {
      [r[0], r[1]].forEach(function (k) { k = up(k); if (k && !(k in m)) m[k] = +r[2]; });
    });
    return m;
  }

  /* ── สต๊อกตอนนี้จาก tx-fifo ───────────────────────────────────────────── */

  function dayNo(ymd) {
    var p = String(ymd).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }

  /**
   * คำตอบ tx-fifo → ของที่ใช้จัดที่เก็บ
   *   info[i]   ต่อ SKU: กองที่มีของ ยอดในโลเปิด RIB รวมทั้งคลัง ขายต่อวัน โลเปิดประจำ
   *   occ[LOC]  ของที่อยู่ในโลนั้นตอนนี้ { qty, skus: {i: ชิ้น}, pos: {'i|PO': ชิ้น} } เฉพาะกองที่มากกว่า 0
   *   emptyR    ช่อง R ที่เคยใช้ในสมุดแต่ตอนนี้ว่าง (ช่องที่ไม่เคยลงสมุดเลยระบบไม่รู้จัก)
   *   emptyFloor[A..D] โลพื้นที่ว่าง
   * กติกายอดเดียวกับ balances_ ใน tx-api.gs: เข้าที่ Location รับทุกประเภท ออกที่ Location เบิกเฉพาะเบิกกับขาย
   */
  function stock(res) {
    var skus = res.skus || [], locs = res.locs || [], pos = res.pos || [], days = res.days || [];
    var byCode = {};
    skus.forEach(function (t, i) {
      [t[0], t[1]].forEach(function (k) { k = up(k); if (k && byCode[k] === undefined) byCode[k] = i; });
    });
    var bal = {}, isOpen = {}, fills = {}, sold = {}, lastOpen = {}, prev = '';
    var first = '', last = '';
    (res.rows || []).forEach(function (x) {
      var t = x[7], d = x[8] >= 0 ? days[x[8]] : '';
      if (t === 2 && (x[9] & 8) && d) { if (!first || d < first) first = d; if (d > last) last = d; }
    });
    var end = last ? dayNo(last) : 0;
    var span = last ? Math.min(SALE_DAYS, end - dayNo(first) + 1) : 0;

    (res.rows || []).forEach(function (x, n) {
      var s = x[1], lot = up(x[2]), po = basePo(pos[x[3]]), from = x[4], to = x[5];
      var qty = typeof x[6] === 'number' ? x[6] : 0, t = x[7], flag = x[9];
      var base = s + '|' + lot + '|' + po + '|';
      if (to >= 0) {
        bal[base + to] = (bal[base + to] || 0) + qty;
        isOpen[base + to] = !!(flag & 1);
        if ((flag & 1) && /^[A-DS]$/.test(zoneOf(locs[to]))) lastOpen[s] = locs[to];
      }
      if (from >= 0 && t) bal[base + from] = (bal[base + from] || 0) - qty;
      /* เติมโลเปิด: ย้ายเข้าหรือ GR ลงโลเปิดในพื้นหรือชั้นวาง แถวติดกันของ SKU และโลเดียวกันนับเป็นครั้งเดียว */
      var key = s + '|' + to;
      if (to >= 0 && (flag & 1) && to !== from && (t === 1 || (flag & 2))) {
        var z = zoneOf(locs[to]);
        if (/^[A-DS]$/.test(z) && key !== prev) {
          var f = fills[s] || (fills[s] = {});
          var e = f[to] || (f[to] = { n: 0, at: 0 });
          e.n++; e.at = n;
        }
        prev = key;
      } else if (t !== 2) prev = '';
      if (t === 2 && (flag & 8) && span) {
        var d = days[x[8]];
        if (d && end - dayNo(d) < span) sold[s] = (sold[s] || 0) + qty;
      }
    });

    var info = {}, occ = {}, known = {}, brandFloor = {};
    locs.forEach(function (l) { known[up(l)] = 1; });
    function inf(s) {
      return info[s] || (info[s] = {
        piles: [], openQty: 0, openPo: {}, rib: 0, total: 0, rLocs: [], floorLocs: [],
        perDay: span && sold[s] ? sold[s] / span : 0, regular: '', fills: 0,
      });
    }
    Object.keys(bal).forEach(function (k) {
      var q = round(bal[k]);
      if (!(q > 0)) return;
      var p = k.split('|'), s = +p[0], loc = locs[+p[3]], L = up(loc), z = zoneOf(loc);
      var x = inf(s), open = !!isOpen[k];
      x.piles.push({ loc: loc, lot: p[1], po: p[2], qty: q, open: open });
      x.total += q;
      if (open && z !== 'special' && z !== 'R') {
        x.openQty += q;
        var op = x.openPo[L] || (x.openPo[L] = {});
        op[p[2]] = (op[p[2]] || 0) + q;
      }
      if (L === 'RIB') x.rib += q;
      if (z === 'R' && x.rLocs.indexOf(loc) === -1) x.rLocs.push(loc);
      if (/^[A-D]$/.test(z) && x.floorLocs.indexOf(loc) === -1) x.floorLocs.push(loc);
      var o = occ[L] || (occ[L] = { qty: 0, skus: {}, pos: {} });
      o.qty += q;
      o.skus[s] = (o.skus[s] || 0) + q;
      o.pos[s + '|' + p[2]] = (o.pos[s + '|' + p[2]] || 0) + q;
      if (/^[A-D]$/.test(z)) {
        var b = brandOf(skus[s] && skus[s][0]);
        var bl = brandFloor[b] || (brandFloor[b] = []);
        if (bl.indexOf(loc) === -1) bl.push(loc);
      }
    });
    Object.keys(sold).forEach(function (s) { inf(+s); });
    /* โลเปิดประจำ: เติมบ่อยสุด เท่ากันเอาที่เติมล่าสุด ไม่เคยเติมเลยใช้โลเปิดที่มีของมากสุดตอนนี้
       ของหมดแล้วไม่มีกองเหลือ ใช้โลเปิดล่าสุดที่เคยรับของเข้า */
    Object.keys(lastOpen).forEach(function (s) { if (sold[s] || fills[s]) inf(+s); });
    Object.keys(fills).forEach(function (s) {
      var best = null;
      Object.keys(fills[s]).forEach(function (l) {
        var e = fills[s][l];
        if (!best || e.n > best.n || (e.n === best.n && e.at > best.at)) best = { loc: locs[+l], n: e.n, at: e.at };
      });
      var x = inf(+s);
      x.regular = best.loc;
      x.fills = best.n;
    });
    Object.keys(info).forEach(function (s) {
      var x = info[s];
      if (x.regular) return;
      var top = null;
      x.piles.forEach(function (p) {
        var z = zoneOf(p.loc);
        if (p.open && /^[A-DS]$/.test(z) && (!top || p.qty > top.qty)) top = p;
      });
      if (top) x.regular = top.loc;
      else if (lastOpen[s]) x.regular = lastOpen[s];
    });

    var emptyR = [], emptyFloor = { A: [], B: [], C: [], D: [] };
    locs.forEach(function (l) {
      if (occ[up(l)]) return;
      if (rackOf(l)) emptyR.push(l);
      var f = floorOf(l);
      if (f) emptyFloor[f.zone].push(l);
    });
    var cmp = function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); };
    emptyR.sort(cmp);
    Object.keys(emptyFloor).forEach(function (z) { emptyFloor[z].sort(cmp); });

    return {
      skus: skus, info: info, occ: occ, known: known, emptyR: emptyR, emptyFloor: emptyFloor, brandFloor: brandFloor,
      last: last, saleDays: span,
      code: function (ln) {
        var a = up(ln.pid), b = up(ln.sku);
        if (a && byCode[a] !== undefined) return byCode[a];
        if (b && byCode[b] !== undefined) return byCode[b];
        return -1;
      },
    };
  }

  /* ── แพลนรับเข้าที่คัดลอกจากชีต ───────────────────────────────────────── */

  var HEAD = {
    no: /^no\.?$|^ลำดับ$/i, pid: /product\s*id|รหัสยาว/i, lot: /^lot$/i, po: /^po\.?$/i, sku: /^sku$/i,
    name: /product\s*name|ชื่อสินค้า|description/i, qty: /^qty$|^จำนวน/i, truck: /truck|^รถ/i, remark: /remark|หมายเหตุ/i,
  };
  /* หน้าตาแท็บ INPUT ของทีม ใช้เมื่อคัดลอกมาไม่ติดหัวตาราง */
  var LAYOUT = ['no', 'pid', 'lot', 'po', 'sku', 'name', 'qty', 'truck', 'remark'];

  /**
   * ข้อความที่คัดลอกจาก Google Sheets (คั่นด้วย Tab) → บรรทัดแพลน
   * มีหัวตารางก็หาคอลัมน์จากหัว ไม่มีก็ใช้ลำดับแบบแท็บ INPUT (มีหรือไม่มีช่อง NO. ก็ได้)
   * แถวว่าง หรือไม่มีรหัส หรือจำนวนไม่ใช่ตัวเลขที่มากกว่า 0 ข้ามแล้วบอกไว้ใน skipped
   */
  function parsePlan(text) {
    var grid = String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.split('\t'); });
    var col = null, start = 0;
    for (var i = 0; i < Math.min(grid.length, 8) && !col; i++) {
      var c = {};
      grid[i].forEach(function (h, j) {
        var v = String(h).trim();
        Object.keys(HEAD).forEach(function (k) { if (c[k] === undefined && HEAD[k].test(v)) c[k] = j; });
      });
      if ((c.sku !== undefined || c.pid !== undefined) && c.qty !== undefined) { col = c; start = i + 1; }
    }
    if (!col) {
      var firstRow = grid.find(function (r) { return r.some(function (v) { return String(v).trim(); }); }) || [];
      var withNo = /^\d+$/.test(String(firstRow[0] || '').trim()) && /[A-Z]/i.test(String(firstRow[1] || ''));
      col = {};
      LAYOUT.slice(withNo ? 0 : 1).forEach(function (k, j) { col[k] = j; });
    }
    var lines = [], skipped = [];
    for (var r = start; r < grid.length; r++) {
      var row = grid[r];
      var get = function (k) { return col[k] === undefined ? '' : String(row[col[k]] == null ? '' : row[col[k]]).trim(); };
      if (!row.some(function (v) { return String(v).trim(); })) continue;
      var no = get('no');
      var ln = {
        n: r + 1, no: no, label: no ? 'NO. ' + no : 'แถว ' + (r + 1),
        pid: up(get('pid')), sku: up(get('sku')), lot: get('lot'), po: get('po'), name: get('name'),
        qty: num(get('qty')), truck: get('truck'), remark: get('remark'),
      };
      if (!ln.pid && !ln.sku) { skipped.push({ n: ln.n, label: ln.label, why: 'ไม่มีรหัสสินค้า' }); continue; }
      if (!(ln.qty > 0)) { skipped.push({ n: ln.n, label: ln.label, why: 'จำนวนไม่ใช่ตัวเลขที่มากกว่า 0', code: ln.sku || ln.pid }); continue; }
      lines.push(ln);
    }
    return { lines: lines, skipped: skipped };
  }

  /* ── จัดที่เก็บ ───────────────────────────────────────────────────────── */

  function capOf(cap, ln) {
    var a = up(ln.pid), b = up(ln.sku);
    if (a && cap[a] !== undefined) return cap[a];
    if (b && cap[b] !== undefined) return cap[b];
    return null;
  }

  /** คีย์ของ SKU ในแผน ใช้ดูว่าสองบรรทัดเป็น SKU เดียวกันไหม */
  function keyOf(snap, ln) {
    var s = snap.code(ln);
    return s >= 0 ? 's' + s : 'x' + (up(ln.pid) || up(ln.sku));
  }

  /**
   * เสนอโลเคชั่นให้ทุกบรรทัด ตามลำดับที่วางมา
   * @param manual { ลำดับบรรทัด: แถวที่คนแก้เอง } บรรทัดพวกนี้ไม่คิดใหม่ แต่จองโลไว้ก่อนให้บรรทัดอื่นไม่ไปทับ
   * @returns [{ rows, manual, s, kind, cap, info }] ต่อบรรทัด
   *   แถว = { loc, qty, open, tag, why, move?, from? }
   *   tag: open (เข้าโลเปิด) rack (แร็ค R) rib (เศษเข้า RIB) floor (พื้น A–D) manual (ระบบไม่มีที่เสนอ) move (ย้ายเศษออกจาก RIB)
   */
  function plan(lines, snap, cap, opt, manual) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    manual = manual || {};
    cap = cap || {};
    var used = {}, ribAdd = {}, openAdd = {};

    function reserve(loc, key, qty) {
      var L = up(loc);
      if (!L) return;
      var u = used[L] || (used[L] = {});
      u[key] = (u[key] || 0) + qty;
    }
    lines.forEach(function (ln, i) {
      if (!manual[i]) return;
      var key = keyOf(snap, ln);
      manual[i].forEach(function (r) {
        if (r.move) { if (up(r.from) === 'RIB') ribAdd[key] = (ribAdd[key] || 0) - r.qty; return; }
        reserve(r.loc, key, r.qty);
        if (up(r.loc) === 'RIB') ribAdd[key] = (ribAdd[key] || 0) + r.qty;
        if (r.open) openAdd[key] = (openAdd[key] || 0) + r.qty;
      });
    });

    function near(list, target) {
      /* ใกล้แค่ไหนในแร็ค: แร็คเดียวกันก่อน แล้วช่องใกล้กัน */
      var t = rackOf(target);
      var best = Infinity;
      list.forEach(function (l) {
        var a = rackOf(l);
        if (a) best = Math.min(best, Math.abs(a.rack - t.rack) * 1000 + Math.abs(a.bay - t.bay));
      });
      return best;
    }
    function pickR(level1, inf) {
      var mine = inf ? inf.rLocs : [];
      var list = snap.emptyR.filter(function (l) {
        if (used[up(l)]) return false;
        var r = rackOf(l);
        return level1 ? r.level === 1 : r.level >= 2;
      });
      if (!list.length) return '';
      if (!mine.length) return list[0];
      var best = '', score = Infinity;
      list.forEach(function (l) {
        var sc = near(mine, l);
        if (sc < score) { score = sc; best = l; }
      });
      return best;
    }
    function floorDist(a, b) {
      var x = floorOf(a), y = floorOf(b);
      if (!x || !y) return Infinity;
      if (x.zone !== y.zone) return 100000;
      return Math.abs(x.row - y.row) * 1000 + Math.abs(x.pos - y.pos);
    }
    /** โลพื้นว่างที่ใกล้โลที่อ้างถึงที่สุด ไม่มีที่อ้างถึงเอาโลแรกของโซน */
    function pickFloor(zones, ref) {
      var list = [];
      zones.forEach(function (z) { (snap.emptyFloor[z] || []).forEach(function (l) { if (!used[up(l)]) list.push(l); }); });
      if (!list.length) return { loc: '', ref: '' };
      if (!ref.length) return { loc: list[0], ref: '' };
      var best = { loc: '', ref: '', d: Infinity };
      list.forEach(function (l) {
        ref.forEach(function (r) {
          var d = floorDist(l, r);
          if (d < best.d) best = { loc: l, ref: r, d: d };
        });
      });
      return best.d < 100000 ? best : { loc: list[0], ref: '' };
    }

    return lines.map(function (ln, i) {
      var s = snap.code(ln);
      var x = s >= 0 ? snap.info[s] || null : null;
      var name = ln.name || (s >= 0 && snap.skus[s] ? snap.skus[s][2] : '');
      var k = kindOf(name, ln.sku || (s >= 0 && snap.skus[s] ? snap.skus[s][0] : ''));
      var c = capOf(cap, ln);
      var out = { s: s, name: name, kind: k, cap: c, info: x, manual: !!manual[i], rows: [] };
      if (manual[i]) { out.rows = manual[i]; return out; }

      var key = keyOf(snap, ln), po = basePo(ln.po), left = ln.qty;
      var brand = brandOf(ln.sku || (s >= 0 && snap.skus[s] ? snap.skus[s][0] : ''));
      function add(loc, qty, tag, why, extra) {
        var r = { loc: loc, qty: round(qty), open: tag === 'open', tag: tag, why: why };
        if (extra) Object.keys(extra).forEach(function (e) { r[e] = extra[e]; });
        out.rows.push(r);
        if (!r.move) reserve(loc, key, qty);
        return r;
      }
      /* โลที่ใช้อ้างตอนหาโลพื้นว่าง: ของ SKU นี้ก่อน ไม่มีก็ของแบรนด์เดียวกัน */
      var refOf = function (list) { return list.length ? list : (snap.brandFloor[brand] || []); };

      /* ของแถม: โซน D โลที่มี PO เดียวกันเติมได้เลย ไม่มีก็ช่องว่างใกล้ของ SKU นี้หรือแบรนด์เดียวกัน */
      if (k.kind === 'free') {
        var same = x ? x.piles.filter(function (p) { return zoneOf(p.loc) === 'D' && p.po === po; }) : [];
        if (same.length) add(same[0].loc, left, 'floor', 'โซน D เติมโลที่มี PO เดียวกันอยู่แล้ว');
        else {
          var dl = x ? x.floorLocs.filter(function (l) { return zoneOf(l) === 'D'; }) : [];
          var d = pickFloor(['D'], refOf(dl));
          if (d.loc) add(d.loc, left, 'floor', d.ref ? 'โซน D ช่องว่างใกล้ ' + d.ref : 'โซน D ช่องว่าง');
          else add('', left, 'manual', 'โซน D ไม่มีช่องว่างที่ระบบรู้จัก เลือกเอง');
        }
        return out;
      }

      if (!(c > 0)) {
        add('', left, 'manual', c === 0 ? 'ความจุต่อพาเลทในไฟล์เป็น 0 เลือกที่เก็บเอง' : 'ไม่มีความจุต่อพาเลทของ SKU นี้ เลือกที่เก็บเอง');
        return out;
      }

      /* ของหมด หรือโลเปิดเหลือขายไม่ถึงเกณฑ์ ส่งเข้าโลเปิดประจำ 1 พาเลท */
      var reg = x && x.regular;
      if (reg) {
        var openNow = x.openQty + (openAdd[key] || 0);
        var cover = x.perDay > 0 ? openNow / x.perDay : Infinity;
        var why = '';
        if (x.total + (openAdd[key] || 0) <= 0) why = 'ของหมดทั้งคลัง เข้าโลเปิดเลย';
        else if (cover < opt.coverDays) why = openNow > 0 ? 'โลเปิดเหลือขายอีก ' + cover.toFixed(1) + ' วัน (เกณฑ์ ' + opt.coverDays + ' วัน)' : 'โลเปิดไม่มีของแล้ว';
        if (why) {
          var q = Math.min(left, c);
          add(reg, q, 'open', why);
          openAdd[key] = (openAdd[key] || 0) + q;
          left -= q;
        }
      }

      /* เต็มพาเลทลงแร็ค 5/6 ฟุตชั้น 1 นอกนั้นชั้น 2 ขึ้นไป */
      var short = 0;
      while (left >= c) {
        var loc = pickR(k.level1, x);
        if (loc) add(loc, c, 'rack', 'เต็มพาเลท ' + c + ' ชิ้น');
        else short += c;
        left -= c;
      }
      if (short) add('', short, 'manual', 'ช่อง R ' + (k.level1 ? 'ชั้น 1' : 'ชั้น 2 ขึ้นไป') + ' ว่างไม่พอ เลือกที่เก็บเอง');
      left = round(left);
      if (!(left > 0)) return out;

      /* เศษ: PO เดียวกับที่อยู่ในโลเปิดประจำ เติมเข้าไปได้เลย */
      if (reg && x.openPo[up(reg)] && x.openPo[up(reg)][po] > 0) {
        add(reg, left, 'open', 'เศษ ' + left + ' ชิ้น PO เดียวกับที่อยู่ในโลเปิด เติมเข้าโลเปิด');
        openAdd[key] = (openAdd[key] || 0) + left;
        return out;
      }

      /* เศษ 3.5 ฟุตกับท็อปเปอร์: รวมกับเศษใน RIB ถ้าครบพาเลทขึ้นแร็ค ที่เหลือรอใน RIB */
      if (k.rib) {
        var inRib = round((x ? x.rib : 0) + (ribAdd[key] || 0));
        if (inRib > 0 && inRib + left >= c) {
          var to = pickR(false, x);
          if (to) {
            var need = round(c - inRib);
            add(to, need, 'rack', 'รวมกับเศษใน RIB ' + inRib + ' ชิ้น ให้เต็มพาเลท');
            add(to, inRib, 'move', 'ย้ายเศษ ' + inRib + ' ชิ้นจาก RIB มารวม', { move: true, from: 'RIB' });
            ribAdd[key] = (ribAdd[key] || 0) - inRib;
            left = round(left - need);
          }
        }
        if (left > 0) {
          add('RIB', left, 'rib', 'เศษ ' + left + '/' + c + ' ชิ้น รอตู้รอบหน้ามาเติมให้เต็มพาเลท');
          ribAdd[key] = (ribAdd[key] || 0) + left;
        }
        return out;
      }

      /* เศษ 5/6 ฟุต: ช่องว่างชั้น 1 เป็นของตัวเอง ไม่มีก็ลงพื้นใกล้ของเดิมหรือแบรนด์เดียวกัน */
      if (k.level1) {
        var l1 = pickR(true, x);
        if (l1) { add(l1, left, 'rack', 'เศษ ' + left + '/' + c + ' ชิ้น ลงช่องว่างชั้น 1 ช่องของตัวเอง'); return out; }
        var fl = pickFloor(['A', 'B', 'C'], refOf(x ? x.floorLocs : []));
        if (fl.loc) add(fl.loc, left, 'floor', 'ชั้น 1 เต็ม ลงโลพื้นว่าง' + (fl.ref ? ' ใกล้ ' + fl.ref : ''));
        else add('', left, 'manual', 'ชั้น 1 เต็มและไม่มีโลพื้นว่างที่ระบบรู้จัก เลือกเอง');
        return out;
      }

      var r2 = pickR(false, x);
      if (r2) add(r2, left, 'rack', 'เศษ ' + left + '/' + c + ' ชิ้น ลงช่องของตัวเอง ไม่ปนกับ SKU อื่น');
      else add('', left, 'manual', 'ช่อง R ชั้น 2 ขึ้นไปว่างไม่พอ เลือกที่เก็บเอง');
      return out;
    });
  }

  /* ── ตรวจสิ่งที่แก้ ──────────────────────────────────────────────────── */

  /**
   * ตรวจทั้งแผนหลังคนแก้ (หรือที่ระบบเสนอเอง) ตามกติกา
   * @returns {{lines: Array<{sum:number, issues:string[], rows:Array<Array<{level:string,text:string}>>}>, red:number, warn:number}}
   *   level: red = ปน SKU (ห้าม) | warn = ผิดกติกาหรือควรดู | info = แค่บอก
   */
  function check(lines, out, snap, cap) {
    cap = cap || {};
    var at = {};
    out.forEach(function (o, i) {
      o.rows.forEach(function (r) {
        var L = up(r.loc);
        if (!L) return;
        (at[L] = at[L] || []).push({ i: i, key: keyOf(snap, lines[i]), qty: +r.qty || 0, move: !!r.move });
      });
    });
    var red = 0, warn = 0;
    var res = out.map(function (o, i) {
      var ln = lines[i], key = keyOf(snap, ln), s = snap.code(ln);
      var sum = round(o.rows.reduce(function (a, r) { return a + (r.move ? 0 : +r.qty || 0); }, 0));
      var issues = [];
      if (sum !== round(ln.qty)) { issues.push(sum < ln.qty ? 'ลงไว้ ' + sum + ' จาก ' + ln.qty + ' ชิ้น ยังขาด ' + round(ln.qty - sum) : 'ลงไว้ ' + sum + ' เกินแพลน ' + round(sum - ln.qty) + ' ชิ้น'); warn++; }
      var c = capOf(cap, ln), k = o.kind || kindOf(o.name || ln.name, ln.sku);
      var rows = o.rows.map(function (r) {
        var list = [];
        function say(level, text) { list.push({ level: level, text: text }); if (level === 'red') red++; else if (level === 'warn') warn++; }
        var L = up(r.loc), z = zoneOf(r.loc);
        if (!L) { if (!r.move) say('warn', 'ยังไม่ได้เลือกโลเคชั่น'); return list; }
        if (!(+r.qty > 0)) say('warn', 'จำนวนต้องมากกว่า 0');
        if (!snap.known[L] && z !== 'RIB' && z !== 'special') say('info', 'ไม่เคยมีโลนี้ในสมุด ตรวจว่าพิมพ์ถูก');
        var o2 = snap.occ[L];
        var others = (at[L] || []).filter(function (e) { return e.key !== key; });
        if (z === 'R' || /^[A-D]$/.test(z)) {
          var otherSku = o2 ? Object.keys(o2.skus).filter(function (x) { return +x !== s; }) : [];
          if (otherSku.length) say('red', 'ในโลนี้มี SKU อื่นอยู่แล้ว ' + otherSku.length + ' ตัว (ปน SKU)');
          if (others.length) say('red', 'ซ้ำกับ ' + others.map(function (e) { return lines[e.i].label || ('แถว ' + lines[e.i].n); }).filter(function (v, j, a) { return a.indexOf(v) === j; }).join(', ') + ' คนละ SKU (ปน SKU)');
        }
        if (z === 'R') {
          var rk = rackOf(r.loc);
          if (rk.level === 1 && !k.level1) say('warn', 'R ชั้น 1 ใส่ได้แค่ที่นอน 5 ฟุตกับ 6 ฟุต');
          if (rk.level !== 1 && k.level1) say('info', 'ที่นอน 5/6 ฟุตปกติลงชั้น 1');
          var mine = o2 && s >= 0 ? o2.skus[s] || 0 : 0;
          if (mine > 0) say('info', 'ช่องนี้มี SKU เดียวกันอยู่ ' + round(mine) + ' ชิ้น');
          var inLoc = (at[L] || []).filter(function (e) { return e.key === key; }).reduce(function (a, e) { return a + e.qty; }, 0) + mine;
          if (c > 0 && inLoc > c) say('warn', 'รวมแล้ว ' + round(inLoc) + ' ชิ้น เกินความจุพาเลท ' + c);
        }
        if (/^[A-D]$/.test(z) && !r.open && o2 && s >= 0) {
          var po = basePo(ln.po);
          var otherPo = Object.keys(o2.pos).filter(function (p) { var q = p.split('|'); return +q[0] === s && q[1] !== po; });
          if (otherPo.length) say('warn', 'โลพื้นนี้มี PO อื่นของ SKU นี้อยู่ ไม่ควรปน LOT/PO');
        }
        if (L === 'RIB' && !k.rib) say('info', 'RIB ปกติใช้กับที่นอน 3.5 ฟุตและท็อปเปอร์');
        return list;
      });
      return { sum: sum, issues: issues, rows: rows };
    });
    return { lines: res, red: red, warn: warn };
  }

  /* ── ส่งออก ─────────────────────────────────────────────────────────── */

  var TAG_TEXT = { open: 'เข้าโลเปิด', rack: 'แร็ค', rib: 'เศษเข้า RIB', floor: 'พื้น', manual: 'เลือกเอง', move: 'ย้ายจาก RIB' };

  /**
   * แถวแบบแท็บ OUTPUT ของทีม: REMARK, Location, OPEN, LOT, PO., SKU, Product Name, QTY, สถานะ
   * forSheet = คัดลอกไปวางใน Google Sheets ช่อง OPEN เป็น TRUE/FALSE ให้ช่องติ๊กในชีตติ๊กตาม
   */
  function exportRows(lines, out, forSheet) {
    var head = ['REMARK', 'Location', 'OPEN', 'LOT', 'PO.', 'SKU', 'Product Name', 'QTY', 'สถานะ'];
    var body = [];
    out.forEach(function (o, i) {
      var ln = lines[i];
      o.rows.forEach(function (r) {
        var remark = r.remark != null && r.remark !== '' ? r.remark : (r.move ? 'ย้ายจาก ' + (r.from || 'RIB') : '');
        body.push([
          remark, r.loc || '', forSheet ? (r.open ? 'TRUE' : 'FALSE') : (r.open ? '✓' : ''),
          ln.lot || '?', ln.po || '', ln.sku || ln.pid, o.name || ln.name || '', +r.qty || 0, TAG_TEXT[r.tag] || '',
        ]);
      });
    });
    return [head].concat(body);
  }

  window.WmsPutaway = {
    DEFAULTS: DEFAULTS, TAG_TEXT: TAG_TEXT,
    up: up, basePo: basePo, zoneOf: zoneOf, rackOf: rackOf, floorOf: floorOf, isFloor: isFloor, kindOf: kindOf,
    capFromRows: capFromRows, capMap: capMap, stock: stock, parsePlan: parsePlan, plan: plan, check: check,
    exportRows: exportRows, keyOf: keyOf, capOf: capOf,
  };
})();
