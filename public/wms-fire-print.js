/**
 * @file wms-fire-print.js — ระบบใหม่: ใบพิมพ์ของเอกสารย้าย / แปลง แบบเอกสารคลังสินค้าเดิม (A5 แนวนอน)
 *
 *   html(v, opt)   หน้า HTML ทั้งหน้า พร้อมพิมพ์ (v = WmsFireDocs.view) · หน้าแอปใส่ใน iframe ซ่อนแล้วสั่งพิมพ์
 *   pages(v)       แถวต่อแผ่น (ย้าย 10 แถว · แปลง 9 คู่ ตามใบเดิม) แถวเกินขึ้นแผ่นใหม่ หัวใบ + ช่องเซ็นซ้ำทุกแผ่น
 *   can(v)         เอกสารนี้มีใบพิมพ์ไหม (ย้าย กับ แปลง ที่ไม่ใช่ใบกลับรายการ)
 *
 * หัวใบ ตาราง ช่องเซ็น ใช้หน้าตาเดียวกับ public/warehouse-forms (ใบโอนสินค้า ใบขอแปลงรหัสสินค้า)
 * ช่องเซ็น 3 ช่องตามขั้นในระบบ: ผู้จัดทำ · ผู้ตรวจสอบ · ผู้อนุมัติ ชื่อ + เวลาขึ้นเองเมื่อทำในระบบแล้ว ยังมีเส้นให้เซ็นมือ
 * ไม่ใช้ไฟล์ภายนอก (สไตล์อยู่ในหน้า) โลโก้ส่งมาเป็น data URL จากหน้าตั้งค่า
 * เปิดเป็น window.WmsFirePrint
 */
(function () {
  'use strict';

  var ROWS = { 'ย้าย': 10, 'แปลง': 9 };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    var x = Math.round((+n || 0) * 1000) / 1000;
    return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }
  /** 'yyyy-mm-dd' → 'dd/mm/yyyy' (พ.ศ.) */
  function dmy(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? m[3] + '/' + m[2] + '/' + (+m[1] + 543) : '';
  }
  /** 'yyyy-mm-dd HH:MM:SS' → 'dd/mm/yy HH:MM' */
  function when(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? m[3] + '/' + m[2] + '/' + String(+m[1] + 543).slice(2) + ' ' + m[4] + ':' + m[5] : '';
  }
  function hm(s) { var m = /[ T](\d{2}):(\d{2})/.exec(String(s || '')); return m ? m[1] + ':' + m[2] : ''; }

  function C() { return window.WmsFireCore; }
  function nameOf(v, r) { return (v.names && (v.names[r[0]] || v.names[r[1]])) || ''; }

  function can(v) { return !!v && !v.rev && !!ROWS[v.type]; }

  /** แถวของใบ: ย้าย = แถวละการย้าย · แปลง = คู่ เบิก SKU เดิม → รับ SKU ใหม่ (โลเดียวกัน LOT PO เดิม) */
  function items(v) {
    if (v.type !== 'แปลง') {
      return v.rows.map(function (r) {
        return { sku: r[0], name: nameOf(v, r), lot: r[2], po: r[3], from: r[4], to: r[5], qty: +r[6] || 0 };
      });
    }
    var out = [], rows = v.rows;
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i], b = rows[i + 1];
      if (a[7] === 'เบิก' && b && b[7] === 'รับ') {
        out.push({ sku: a[0], name: nameOf(v, a), sku2: b[0], name2: nameOf(v, b), lot: a[2], po: a[3], loc: a[4] || b[5], qty: +a[6] || 0 });
        i++;
      } else if (a[7] === 'รับ') {
        out.push({ sku: '', name: '', sku2: a[0], name2: nameOf(v, a), lot: a[2], po: a[3], loc: a[5], qty: +a[6] || 0 });
      } else {
        out.push({ sku: a[0], name: nameOf(v, a), sku2: '', name2: '', lot: a[2], po: a[3], loc: a[4], qty: +a[6] || 0 });
      }
    }
    return out;
  }

  /** แบ่งแผ่น → [[item]] อย่างน้อย 1 แผ่น */
  function pages(v) {
    var per = ROWS[v.type] || 10, all = items(v), out = [];
    for (var i = 0; i < all.length; i += per) out.push(all.slice(i, i + per));
    return out.length ? out : [[]];
  }

  /** คลังของโล (WH-02 / WH-QA) ไม่ซ้ำ */
  function whs(list) {
    var seen = {}, out = [];
    list.forEach(function (l) { if (!l) return; var w = C() ? C().whOf(l) : ''; if (w && !seen[w]) { seen[w] = 1; out.push(w); } });
    return out.join(', ');
  }

  function purpose(v) {
    if (v.type === 'แปลง') return 'แปลงรหัสสินค้า';
    var qa = v.rows.some(function (r) { return /QA/i.test(String(r[8] || '')); });
    var w = v.rows.some(function (r) { return C() && r[4] && r[5] && C().whOf(r[4]) !== C().whOf(r[5]); });
    return qa || w ? 'ตรวจสอบสินค้า (QA)' : 'โอนข้าม Location';
  }

  function meta(v) {
    var cells = v.type === 'แปลง'
      ? [['วันที่', dmy(v.date)], ['เวลาบันทึก', hm(v.stamp)], ['เลขที่การแปลง', v.no], ['เลข TRcloud (MR / GR)', v.tr || '']]
      : [['วันที่', dmy(v.date)], ['เวลาบันทึก', hm(v.stamp)], ['เลขที่ใบโอน', v.no], ['เลข TRcloud', v.tr || ''],
        ['จุดประสงค์การโอน', purpose(v)], ['จากคลังสินค้า', whs(v.rows.map(function (r) { return r[4]; }))],
        ['ไปคลังสินค้า', whs(v.rows.map(function (r) { return r[5]; }))], ['หมายเหตุ', v.why || v.ref || '']];
    return '<div class="meta">' + cells.map(function (c) {
      return '<div class="mc"><span class="k">' + esc(c[0]) + '</span><span class="v">' + esc(c[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  function table(v, list, last, total, startNo) {
    var per = ROWS[v.type] || 10, conv = v.type === 'แปลง';
    var cols = conv
      ? [[4, 'NO'], [12, 'SKU ต้นทาง'], [21, 'ชื่อสินค้าต้นทาง'], [12, 'SKU ปลายทาง'], [21, 'ชื่อสินค้าปลายทาง'], [7, 'LOT.'], [8, 'PO.'], [8, 'Location'], [7, 'จำนวน<br>(ชิ้น)']]
      : [[4, 'No.'], [14, 'SKU'], [33, 'ชื่อสินค้า'], [7, 'LOT.'], [9, 'PO.'], [11, 'Location<br>ก่อนย้าย'], [11, 'Location<br>หลังย้าย'], [11, 'จำนวน<br>(ชิ้น)']];
    var head = '<colgroup>' + cols.map(function (c) { return '<col style="width:' + c[0] + '%">'; }).join('') + '</colgroup>' +
      '<thead><tr>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead>';
    var body = '';
    for (var i = 0; i < per; i++) {
      var it = list[i];
      if (!it) { body += '<tr>' + cols.map(function (c, j) { return j === 0 ? '<td class="no"></td>' : '<td></td>'; }).join('') + '</tr>'; continue; }
      body += '<tr><td class="no">' + (startNo + i) + '</td>' + (conv
        ? '<td class="sku">' + esc(it.sku) + '</td><td class="nm"><div>' + esc(it.name) + '</div></td><td class="sku">' + esc(it.sku2) + '</td><td class="nm"><div>' + esc(it.name2) + '</div></td>' +
          '<td class="c">' + esc(it.lot) + '</td><td class="c">' + esc(it.po) + '</td><td class="c">' + esc(it.loc) + '</td>'
        : '<td class="sku">' + esc(it.sku) + '</td><td class="nm"><div>' + esc(it.name) + '</div></td><td class="c">' + esc(it.lot) + '</td><td class="c">' + esc(it.po) + '</td>' +
          '<td class="c">' + esc(it.from) + '</td><td class="c">' + esc(it.to) + '</td>') +
        '<td class="n">' + num(it.qty) + '</td></tr>';
    }
    var foot = '<tfoot><tr><td colspan="' + (cols.length - 1) + '">' + (last ? 'รวม' : 'ยกไปแผ่นถัดไป') + '</td><td class="n">' + (last ? num(total) : '') + '</td></tr></tfoot>';
    return '<table class="tbl">' + head + '<tbody>' + body + '</tbody>' + foot + '</table>';
  }

  function sign(v) {
    var boxes = [
      ['ผู้จัดทำ', { name: v.name, at: v.stamp }],
      ['ผู้ตรวจสอบ', v.ck ? { name: v.ck.name, at: v.ck.at } : null],
      ['ผู้อนุมัติ', v.ap ? { name: v.ap.name, at: v.ap.at } : null],
    ];
    return '<div class="sign">' + boxes.map(function (b) {
      var s = b[1];
      return '<div><div class="line"></div><div class="cap">' + esc(b[0]) + '</div>' +
        '<div class="who">' + (s ? esc(s.name) + (s.at ? ' · ' + esc(when(s.at)) : '') : '( .............................. ) &nbsp;วันที่ ........') + '</div></div>';
    }).join('') + '</div>';
  }

  /**
   * หน้า HTML พร้อมพิมพ์ opt = { logo: data URL หรือ '', printed: 'ข้อความเวลาพิมพ์' }
   * ใบยกเลิกแล้วมีตราประทับ ยกเลิก · ใบที่ยังไม่อนุมัติบอกท้ายแผ่น
   */
  function html(v, opt) {
    opt = opt || {};
    if (!can(v)) return '';
    var conv = v.type === 'แปลง';
    var title = conv ? '<div class="en">Code Conversion</div><div class="th">( ใบขอแปลงรหัสสินค้า )</div>'
      : '<div class="en">Transfer Request Form</div><div class="th">( ใบโอนย้ายสินค้า )</div>';
    var ps = pages(v), total = items(v).reduce(function (a, it) { return a + it.qty; }, 0), start = 1;
    var state = v.voided ? 'ยกเลิกแล้ว' : v.ok === 'done' ? 'อนุมัติแล้ว' : v.ok === 'approve' ? 'ตรวจแล้ว รออนุมัติ' : v.ok === 'check' ? 'รอตรวจ' : '';
    var body = ps.map(function (list, i) {
      var out = '<section class="pg">' +
        (v.voided ? '<div class="stamp">ยกเลิก</div>' : '') +
        '<div class="head">' + (opt.logo ? '<img class="logo" src="' + esc(opt.logo) + '" alt="">' : '<div class="logo"></div>') +
        '<div class="title">' + title + '</div><div class="logo r"><b>' + esc(v.no) + '</b></div></div>' +
        meta(v) + table(v, list, i === ps.length - 1, total, start) + sign(v) +
        '<div class="ft"><span>สมุดสต๊อก · ' + esc(v.no) + (state ? ' · ' + esc(state) : '') + (v.voided && v.voided.link ? ' (ลงกลับเป็น ' + esc(v.voided.link) + ')' : '') + '</span>' +
        '<span>' + (opt.printed ? 'พิมพ์ ' + esc(opt.printed) + ' · ' : '') + 'แผ่น ' + (i + 1) + '/' + ps.length + '</span></div></section>';
      start += list.length;
      return out;
    }).join('');
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>' + esc(v.no) + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>';
  }

  /* หน้าตาเดียวกับ public/warehouse-forms/wh-forms.css (ใบโอน ใบแปลง) ย่อมาไว้ในหน้า */
  var CSS = [
    '@page{size:210mm 148mm;margin:5mm}',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'html,body{background:#fff;color:#000}',
    'body{font-family:Sarabun,Tahoma,"Leelawadee UI",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.pg{position:relative;width:200mm;height:137mm;display:flex;flex-direction:column;page-break-after:always;break-after:page;overflow:hidden}',
    '.pg:last-child{page-break-after:auto;break-after:auto}',
    '.head{display:flex;align-items:center;gap:3mm}',
    '.logo{width:30mm;flex-shrink:0;max-height:12mm;object-fit:contain;object-position:left center}',
    '.logo.r{text-align:right;font-size:9pt}',
    '.title{flex:1;text-align:center;line-height:1.25}',
    '.title .en{font-size:12pt;font-weight:700;letter-spacing:.3px}',
    '.title .th{font-size:10.5pt;font-weight:600}',
    '.meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #000;border-bottom:0;margin-top:2mm}',
    '.mc{border-bottom:1px solid #000;border-right:1px solid #000;padding:.7mm 1.4mm;min-width:0}',
    '.mc:nth-child(4n){border-right:0}',
    '.mc .k{display:block;font-size:6.4pt;color:#334155;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mc .v{display:block;font-size:8.5pt;min-height:4.4mm;line-height:4.4mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tbl{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:1.5mm}',
    '.tbl th,.tbl td{border:1px solid #000;padding:0 .8mm}',
    '.tbl th{font-size:6.6pt;font-weight:700;line-height:1.15;text-align:center;padding:.6mm .4mm}',
    '.tbl td{height:6.6mm;font-size:7.6pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tbl td.no,.tbl td.c{text-align:center}',
    '.tbl td.n{text-align:right;font-weight:600}',
    '.tbl td.sku{font-size:7pt;font-family:ui-monospace,Menlo,Consolas,monospace}',
    '.tbl td.nm{white-space:normal}',
    '.tbl td.nm div{font-size:6.5pt;line-height:1.12;max-height:6.4mm;overflow:hidden;word-break:break-word;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
    '.tbl tfoot td{font-size:7.5pt;font-weight:700;text-align:right;padding-right:1.5mm}',
    '.sign{display:flex;gap:4mm;margin-top:auto;padding-top:2mm;font-size:7.5pt}',
    '.sign>div{flex:1}',
    '.sign .line{border-bottom:1px dotted #000;height:6mm}',
    '.sign .cap{margin-top:.8mm;text-align:center;font-weight:600}',
    '.sign .who{text-align:center;font-size:6.8pt;color:#334155;margin-top:.3mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ft{display:flex;justify-content:space-between;margin-top:1.2mm;font-size:6pt;color:#64748B}',
    '.stamp{position:absolute;top:40mm;left:50%;transform:translateX(-50%) rotate(-12deg);border:1.2mm solid #B91C1C;color:#B91C1C;' +
      'font-size:30pt;font-weight:800;padding:1mm 8mm;border-radius:3mm;opacity:.55;pointer-events:none}',
    '@media screen{body{background:#E5E7EB;padding:8mm}.pg{background:#fff;margin:0 auto 6mm;padding:5mm;width:210mm;height:148mm;box-shadow:0 2px 10px rgba(15,23,42,.18)}}',
  ].join('\n');

  window.WmsFirePrint = { ROWS: ROWS, can: can, items: items, pages: pages, html: html };
})();
