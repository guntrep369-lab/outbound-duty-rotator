/**
 * @file wms-gas.js — ยิง Apps Script ให้ทุกโมดูลด้วยกติกาเดียวกัน
 *
 * เดิมตัวยิงอยู่ใน wms-order-index.js พอโมดูลสต๊อกต้องดึงข้อมูลเองบ้าง ทางเลือก
 * มีสองทางที่แย่ทั้งคู่: ให้หน้าสต๊อกโหลดโมดูลออเดอร์มาเพื่อใช้ฟังก์ชัน fetch
 * (ผิดที่ผิดทาง คนอ่านทีหลังจะงงว่าสต๊อกไปเกี่ยวอะไรกับออเดอร์) หรือก๊อปตัวยิง
 * ไปอีกชุด แล้ววันหนึ่งสองชุดจะมี timeout คนละค่าโดยไม่มีใครรู้ตัว
 *
 * โหลดเป็น classic script เปิดเป็น window.WmsGas
 */
(function () {
  'use strict';

  /** ใส่ ?api=… ให้ URL เดียวตอบได้หลายชุดข้อมูล โดยไม่ทับของที่ใส่มาเองแล้ว */
  function withApi(url, api) {
    var u = String(url || '').trim();
    if (!u) return u;
    if (/[?&]api=/.test(u)) return u;
    return u + (u.indexOf('?') === -1 ? '?' : '&') + 'api=' + api;
  }

  /**
   * Fetch an Apps Script endpoint, which is slow and occasionally flaky.
   *
   * TIMEOUT: 90s, not 30s. A GAS web app reading a grown sheet routinely needs
   * 30–60s, and the old 30s cap turned "slow but working" into "aborted, retried
   * twice, failed after 94 seconds". Waiting 40s and succeeding beats that.
   *
   * RETRY: only for errors that a retry can fix — a dropped connection, a 5xx,
   * a GAS cold start. A timeout is NOT retried: the caller has already waited the
   * full 90s, and spending another 90 to hear the same thing is worse than
   * handing back control. `onProgress` ticks each second so the wait shows.
   */
  async function fetchWithRetry(url, opts) {
    var o = opts || {};
    var retries = o.retries == null ? 1 : o.retries;
    var timeoutMs = o.timeoutMs == null ? 90000 : o.timeoutMs;
    var lastErr;
    for (var attempt = 0; attempt <= retries; attempt++) {
      var ctrl = new AbortController();
      var started = Date.now();
      var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
      var ticker = o.onProgress
        ? setInterval((function (a) {
            return function () { o.onProgress(Math.round((Date.now() - started) / 1000), a); };
          })(attempt), 1000)
        : null;
      try {
        var resp = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer); if (ticker) clearInterval(ticker);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp;
      } catch (err) {
        clearTimeout(timer); if (ticker) clearInterval(ticker);
        var timedOut = err.name === 'AbortError';
        lastErr = timedOut
          ? new Error('หมดเวลา ' + (timeoutMs / 1000) + ' วินาที — Apps Script ตอบช้าเกินไป')
          : err;
        if (timedOut) break;                       // see RETRY above
        if (attempt < retries) {
          if (o.onRetry) o.onRetry(attempt + 1, retries, lastErr);
          await new Promise(function (r) { setTimeout(r, 1200 * (attempt + 1)); });
        }
      }
    }
    throw lastErr;
  }

  /** ดึงแล้วแปลงเป็น JSON — ข้อความที่ไม่ใช่ JSON มักเป็นหน้า error ของ Google
      ซึ่งบอกสาเหตุจริงไว้ในนั้น จึงแปะต้นข้อความกลับไปให้เห็น ไม่ใช่แค่ "พังนะ" */
  async function json(url, api, opts) {
    var resp = await fetchWithRetry(withApi(url, api), opts);
    var text = await resp.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error('ข้อมูลที่ได้ไม่ใช่ JSON: "' + text.slice(0, 120) + '..."'); }
  }

  /**
   * ส่งข้อมูลขึ้น Apps Script
   *
   * Content-Type เป็น text/plain โดยตั้งใจ ไม่ใช่ application/json — เบราว์เซอร์จะยิง
   * OPTIONS ถามสิทธิ์ก่อน (preflight) เมื่อ Content-Type ไม่ใช่สามชนิดที่ถือว่า
   * "ง่าย" และ Apps Script ตอบ OPTIONS ไม่ได้ คำขอจึงตายตั้งแต่ยังไม่ถึงสคริปต์
   * ฝั่งสคริปต์อ่าน e.postData.contents เป็นข้อความอยู่แล้ว ชนิดที่ประกาศจึงไม่สำคัญ
   *
   * ไม่ retry: การส่งซ้ำอาจกลายเป็นบันทึกไฟล์เดียวกันสองรอบ ซึ่งแย่กว่าการบอกว่า
   * ไม่สำเร็จแล้วให้คนกดเอง
   */
  async function post(url, payload, opts) {
    var o = opts || {};
    var ctrl = new AbortController();
    var started = Date.now();
    var timer = setTimeout(function () { ctrl.abort(); }, o.timeoutMs == null ? 90000 : o.timeoutMs);
    var ticker = o.onProgress
      ? setInterval(function () { o.onProgress(Math.round((Date.now() - started) / 1000)); }, 1000)
      : null;
    try {
      var resp = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var text = await resp.text();
      try { return JSON.parse(text); }
      catch (e) { throw new Error('คำตอบไม่ใช่ JSON: "' + text.slice(0, 120) + '..."'); }
    } catch (err) {
      throw err.name === 'AbortError' ? new Error('หมดเวลา — Apps Script ตอบช้าเกินไป') : err;
    } finally {
      clearTimeout(timer); if (ticker) clearInterval(ticker);
    }
  }

  window.WmsGas = {
    withApi: withApi,
    fetchWithRetry: fetchWithRetry,
    json: json,
    post: post,
  };
})();
