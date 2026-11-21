import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { loadStocktake, fakeFifo, stocktakeMtime, loadStockApi, stockMtime, loadBook, bookMtime, fifoFromBook, fakeFireGcp, fireBackupMtime } from './src/dev/fake-gas.js';

/**
 * GitHub Pages serves public/summary/index.html at /summary/, but Vite's dev
 * server answers any folder URL with the root index.html instead. The root
 * redirects to roster/, so in dev every sidebar link landed on the shift
 * schedule — and roster/ itself redirected to roster/roster/… forever.
 * Serve the folder's own index.html, the way Pages does.
 */
function folderIndex() {
  return {
    name: 'folder-index',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, query = ''] = req.url.split('?');
        if (pathname !== '/' && pathname.endsWith('/')) {
          const file = path.join(server.config.publicDir, decodeURIComponent(pathname), 'index.html');
          if (fs.existsSync(file)) req.url = pathname + 'index.html' + (query ? '?' + query : '');
        }
        next();
      });
    },
  };
}

/**
 * Apps Script ปลอมสำหรับลองหน้านับสต๊อกใหญ่ใน dev server เท่านั้น (ไม่อยู่ในไฟล์ที่ build)
 *   /__fake/tx         ตอบ tx-fifo จากสมุดสมมติ ?api=fake-move เพิ่มแถวขายหลังตัดยอดไว้ลองคำเตือน (&from=0 = ขายจากโลแร็ค)
 *                      ?api=fake-old เพิ่มของบีบสูญญากาศ LOT เก่าไว้ลองหน้าเช็คความเสี่ยง MFG (mfg/)
 *                      ?api=fake-empty อ่านสดได้สมุดว่าง แต่ชุดกลาง (&shared=1) ยังมีของ แบบที่เจอจริง 16 พ.ย. 69 (&on=0 = เลิก)
 *                      ?api=fake-book ให้ tx-fifo อ่านแท็บ Transaction ของสมุดใหม่สมมติ (/__fake/book) ด้วย tx-api.gs ตัวจริง
 *                      เหมือนตอนตัดรอบที่เปลี่ยน IMPORTRANGE ไปสมุดใหม่ (&on=0 = กลับไปอ่านสมุดเก่าสมมติ)
 *   /__fake/stocktake  รัน apps-script/stocktake-api.gs ตัวจริงกับชีตในหน่วยความจำ
 *                      รหัสหัวหน้า demo-head รหัสคนนับ demo-count ข้อมูลหายเมื่อปิด dev server
 *   /__fake/stock      รัน apps-script/stock-api.gs ตัวจริงกับชีตสต๊อก TRcloud สมมติ (Stock, WH Loss, ราคาทุน) ที่เข้ากับสมุดสมมติ
 *                      ตั้ง URL สต๊อกในหน้าตั้งค่า = http://localhost:5173/__fake/stock
 *   /__fake/book       รัน apps-script/book-api.gs ตัวจริงกับชีตในหน่วยความจำ (สมุดสต๊อก ตัดขาย)
 *                      คนสมมติ: ทดลอง รหัส 1111 (ลงรายการ) · หัวหน้าทดลอง รหัส 9999 (หัวหน้า) ข้อมูลหายเมื่อปิด dev server
 *                      ตั้งในหน้าสมุดสต๊อก ⚙️ = http://localhost:5173/__fake/book
 *   /__fake/fire-share รัน apps-script/fire-backup.gs ตัวจริงกับ Firestore REST จำลอง (ลิงก์ Supply chain ของระบบใหม่)
 *                      GET ?api=shared-at | tx-fifo = doGet ของเว็บแอป
 *                      POST {op: 'dump', dump} = ใส่ฐานทดลอง (localStorage wms:fire:dev ของ ?fire=dev) แล้ว shareRefresh
 *                      ตั้งที่ ⚙ ข้างปุ่ม 🔗 ในหน้า FIFO (?fire=dev) = http://localhost:5173/__fake/fire-share
 * ตั้งในหน้านับสต๊อกใหญ่: URL = http://localhost:5173/__fake/stocktake รหัส = demo-head
 * และ URL Transaction ในหน้าตั้งค่า = http://localhost:5173/__fake/tx
 */
function fakeGas() {
  let st = null;
  let stAt = 0;
  let sk = null;
  let skAt = 0;
  const moves = [];
  let emptyLive = false;
  let bk = null;
  let bkAt = 0;
  let bookLive = false;
  let fsh = null;
  let fshAt = 0;
  return {
    name: 'fake-gas',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query = ''] = req.url.split('?');
        if (!pathname.startsWith('/__fake/')) return next();
        const params = Object.fromEntries(new URLSearchParams(query));
        const send = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
        if (pathname === '/__fake/tx') {
          /* คำตอบ tx-fifo: สมุดเก่าสมมติ หรือแท็บ Transaction ของสมุดใหม่สมมติ (fake-book) */
          const fifoNow = () => {
            if (bookLive) return bk ? fifoFromBook(bk.ss) : { error: 'ยังไม่ได้เปิดสมุดใหม่สมมติ (/__fake/book)' };
            const d = fakeFifo({ extraRows: moves });
            return emptyLive ? { ...d, last: '', skus: [], pos: [], locs: [], days: [], rows: [] } : d;
          };
          if (req.method === 'POST') {
            /* ปุ่มดึงสต๊อกใหม่ (WmsShared.press) ส่ง {op: 'shared-fresh', api: 'tx-fifo'} */
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
              let b = {};
              try { b = JSON.parse(body || '{}'); } catch (e) { b = {}; }
              if (b.op !== 'shared-fresh' || b.api !== 'tx-fifo') return send({ error: 'ไม่รู้จักคำสั่งนี้' });
              const d = fifoNow();
              send(d.error ? d : { ...d, shared: { at: d.at, by: b.by || '', auto: false } });
            });
            return;
          }
          if (params.api === 'fake-move') {
            /* from = ลำดับโลในสมุดสมมติ (0 = R1-01-01 โลแร็ค, ไม่ใส่ = 66 โลเปิดฝั่ง B) ไว้ลองนับ 2 วัน: ขายจากโลเปิดไม่เตือน เบิกจากแร็คเตือน */
            moves.push([0, 9, 0, +params.from >= 0 ? +params.from : 66, -1, 1, 2, -1, 0]);
            return send({ ok: 1, moves: moves.length });
          }
          if (params.api === 'fake-old') {
            /* ของบีบสูญญากาศ LOT เก่า (4, 5, 6, 0.12) กับ LOT 0 ไว้ลองหน้าเช็คความเสี่ยง MFG — สมุดสมมติมีแค่ LOT 8–10 */
            [[0, 4, 0, -1, 0, 12, 0, 0, 10], [1, 5, 1, -1, 1, 6, 0, 0, 10], [10, 6, 2, -1, 2, 9, 0, 0, 10],
              [18, 0, 3, -1, 3, 5, 0, 0, 10], [2, 0.12, 4, -1, 4, 3, 0, 0, 10]].forEach((m) => moves.push(m));
            return send({ ok: 1, moves: moves.length });
          }
          if (params.api === 'fake-empty') { emptyLive = params.on !== '0'; return send({ ok: 1, emptyLive }); }
          if (params.api === 'fake-book') { bookLive = params.on !== '0'; return send({ ok: 1, bookLive }); }
          if (params.api === 'tx-fifo' && bookLive) {
            const d = fifoNow();
            if (params.shared && !d.error) return send({ ...d, shared: { at: d.at, by: '', auto: true } });
            return send(d);
          }
          if (params.api === 'tx-fifo') {
            const d = fakeFifo({ extraRows: moves });
            /* ชุดกลางมีป้ายเวลาเหมือนสคริปต์จริง ตั้งไว้ว่าเก็บตั้งแต่ 4 ชั่วโมงก่อน */
            const at = Date.now() - 4 * 3600e3;
            if (params.shared) return send({ ...d, at, shared: { at, by: '', auto: true } });
            /* สคริปต์เห็นแท็บสมุดแค่หัวตาราง (สูตรดึงข้อมูลในไฟล์สำเนา error) */
            if (emptyLive) return send({ ...d, last: '', skus: [], pos: [], locs: [], days: [], rows: [] });
            return send(d);
          }
          return send({ app: 'transaction' });
        }
        if (pathname === '/__fake/stock') {
          const mt = stockMtime();
          if (!sk || mt !== skAt) { sk = loadStockApi(); skAt = mt; }
          return send(sk.get(params));
        }
        if (pathname === '/__fake/book') {
          /* แก้ .gs ระหว่างเปิด dev server = โหลดสคริปต์ใหม่กับไฟล์ชีตเดิม */
          const mt = bookMtime();
          if (!bk || mt !== bkAt) {
            const old = bk;
            bk = loadBook(old ? { ss: old.ss, files: old.files, props: old.props } : {});
            if (!old) bk.users([['ทดลอง', '1111', 'ลงรายการ'], ['หัวหน้าทดลอง', '9999', 'หัวหน้า']]);
            bkAt = mt;
          }
          if (req.method !== 'POST') return send(bk.get(params));
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => send(bk.post(JSON.parse(body || '{}'))));
          return;
        }
        if (pathname === '/__fake/fire-share') {
          /* แก้ .gs ระหว่างเปิด dev server = โหลดสคริปต์ใหม่ ข้อมูลกับไฟล์ชุดแชร์เดิมอยู่ครบ */
          const mt = fireBackupMtime();
          if (!fsh) { fsh = fakeFireGcp(); fshAt = mt; } else if (mt !== fshAt) { fsh.reload(); fshAt = mt; }
          if (req.method !== 'POST') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(fsh.text(params)); }
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            let b = {};
            try { b = JSON.parse(body || '{}'); } catch (e) { b = {}; }
            if (b.op !== 'dump' || !b.dump) return send({ error: 'ไม่รู้จักคำสั่งนี้' });
            fsh.mirror(b.dump);
            send(fsh.gs.shareRefresh());
          });
          return;
        }
        if (pathname === '/__fake/stocktake') {
          /* แก้ .gs ระหว่างเปิด dev server = โหลดสคริปต์ใหม่กับชีตเดิม ไม่ต้องตั้งรอบใหม่ทุกครั้ง */
          const mt = stocktakeMtime();
          if (!st || mt !== stAt) { st = loadStocktake({ head: 'demo-head', count: 'demo-count', ss: st ? st.ss : undefined }); stAt = mt; }
          if (req.method !== 'POST') return send(st.get(params));
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => send(st.post(JSON.parse(body || '{}'))));
          return;
        }
        next();
      });
    },
  };
}

// base: './' produces relative asset URLs so the built site works whether it is
// served from a user page (user.github.io) or a project page (user.github.io/repo/).
export default defineConfig({
  plugins: [folderIndex(), fakeGas()],
  base: './',
  test: {
    // dist/ holds a verbatim copy of public/, so without this a test placed
    // there would run twice — and a stale built copy could pass while the
    // source it was built from is broken.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
