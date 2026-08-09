/**
 * @file wh-form.js — ตารางรายการสินค้าที่ฟอร์มคลังสินค้าทั้งสามใบใช้ร่วมกัน
 *
 * ทั้งสามใบมีตารางหน้าตาไม่เหมือนกัน แต่พฤติกรรมเดียวกัน: พิมพ์รหัส → ชื่อสินค้าขึ้น
 * → คูณจำนวน → รวมยอด ถ้าเขียนแยกสามชุดจะเป็นสามชุดที่ค่อย ๆ คิดเลขไม่เหมือนกัน
 *
 * ผูกด้วย data-attribute ไม่ใช่ตำแหน่งคอลัมน์ แต่ละฟอร์มจึงจัดคอลัมน์ยังไงก็ได้
 *   [data-sku]   ช่องกรอกรหัส
 *   [data-name]  ช่องชื่อสินค้า (อ่านอย่างเดียว เติมให้จากรหัส)
 *   [data-a]     จำนวนชิ้น/กล่อง
 *   [data-b]     จำนวนกล่อง
 *   [data-total] ผลคูณ A×B ของแถวนั้น
 *   [data-grand] ยอดรวมทั้งใบ
 *
 * โหลดเป็น classic script เปิดเป็น window.WhForm
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var num = function (el) {
    var v = parseFloat(String((el && el.value) || '').replace(/,/g, ''));
    return isNaN(v) ? 0 : v;
  };

  /** กล่องรายการที่ลอยใต้ช่องกรอก — ใช้ตัวเดียวทั้งหน้า */
  var box = null;
  function hideBox() { if (box) { box.style.display = 'none'; box.__input = null; } }

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'wh-sug no-print';
    document.body.appendChild(box);
    document.addEventListener('click', function (e) {
      if (box && !box.contains(e.target) && e.target !== box.__input) hideBox();
    });
    return box;
  }

  function showBox(input, hits, onPick) {
    var b = ensureBox();
    if (!hits.length) { hideBox(); return; }
    b.__input = input;
    b.innerHTML = hits.map(function (it, i) {
      return '<button type="button" class="wh-sug-row" data-i="' + i + '">' +
        '<b>' + esc(it.sku) + '</b><span>' + esc(it.name) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(b.querySelectorAll('.wh-sug-row'), function (el) {
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        onPick(hits[+el.dataset.i]);
        hideBox();
      });
    });
    var r = input.getBoundingClientRect();
    b.style.display = 'block';
    b.style.left = (r.left + window.scrollX) + 'px';
    b.style.top = (r.bottom + window.scrollY + 2) + 'px';
    b.style.minWidth = Math.max(r.width, 260) + 'px';
  }

  window.WhForm = {
    /**
     * @param {HTMLElement} root ตัวครอบตาราง
     * @param {object} [opts]
     * @param {boolean} [opts.usePair] true = ใบแปลงรหัส ให้เติมรหัสคู่ให้อีกฝั่ง
     */
    wire: function (root, opts) {
      var o = opts || {};

      function rowOf(el) { return el.closest('tr'); }

      function fillName(input) {
        var tr = rowOf(input);
        if (!tr) return;
        var name = tr.querySelector('[data-name]');
        var hit = window.WhSku ? WhSku.find(input.value) : null;
        if (name) {
          name.value = hit ? hit.name : '';
          name.classList.toggle('wh-miss', !!input.value.trim() && !hit);
          name.title = (!hit && input.value.trim())
            ? 'ไม่พบรหัสนี้ในรายชื่อสินค้า — ตรวจรหัส หรืออัปไฟล์รายชื่อใหม่'
            : '';
        }
        // ใบแปลงรหัส: กรอกด้านหนึ่งแล้วอีกด้านมาเอง ตามคู่ที่บันทึกไว้
        if (o.usePair && window.WhSku) {
          var other = tr.querySelector('[data-sku-to]');
          if (other && !other.value.trim()) {
            var p = WhSku.pair(input.value);
            if (p) {
              other.value = p.to;
              var n2 = tr.querySelector('[data-name-to]');
              if (n2) n2.value = p.name || '';
            }
          }
        }
      }

      function recalc() {
        var grand = 0;
        Array.prototype.forEach.call(root.querySelectorAll('tr'), function (tr) {
          var a = tr.querySelector('[data-a]'), b = tr.querySelector('[data-b]'),
              t = tr.querySelector('[data-total]');
          if (!t) return;
          var v = num(a) * num(b);
          t.value = v ? String(v) : '';
          grand += v;
        });
        var g = document.querySelector('[data-grand]');
        if (g) g.value = grand ? String(grand) : '';
      }

      root.addEventListener('input', function (e) {
        var el = e.target;
        if (el.matches('[data-sku],[data-sku-to]')) {
          fillName(el.matches('[data-sku]') ? el : el);
          if (el.matches('[data-sku-to]')) {
            var tr = rowOf(el), n2 = tr && tr.querySelector('[data-name-to]');
            var hit = window.WhSku ? WhSku.find(el.value) : null;
            if (n2) n2.value = hit ? hit.name : '';
          }
          var hits = window.WhSku ? WhSku.search(el.value, 8) : [];
          showBox(el, hits, function (it) {
            el.value = it.sku;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
        }
        if (el.matches('[data-a],[data-b]')) recalc();
      });

      root.addEventListener('focusout', function (e) {
        if (e.target.matches('[data-sku],[data-sku-to]')) setTimeout(hideBox, 120);
      });

      recalc();
      return { recalc: recalc };
    },
  };
})();
