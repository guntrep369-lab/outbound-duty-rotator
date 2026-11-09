import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { loadStocktake, fakeFifo } from './src/dev/fake-gas.js';

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
 *   /__fake/tx         ตอบ tx-fifo จากสมุดสมมติ ?api=fake-move เพิ่มแถวขายหลังตัดยอดไว้ลองคำเตือน
 *   /__fake/stocktake  รัน apps-script/stocktake-api.gs ตัวจริงกับชีตในหน่วยความจำ
 *                      รหัสหัวหน้า demo-head รหัสคนนับ demo-count ข้อมูลหายเมื่อปิด dev server
 * ตั้งในหน้านับสต๊อกใหญ่: URL = http://localhost:5173/__fake/stocktake รหัส = demo-head
 * และ URL Transaction ในหน้าตั้งค่า = http://localhost:5173/__fake/tx
 */
function fakeGas() {
  let st = null;
  const moves = [];
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
          if (params.api === 'fake-move') {
            moves.push([0, 9, 0, 66, -1, 1, 2, -1, 0]);
            return send({ ok: 1, moves: moves.length });
          }
          if (params.api === 'tx-fifo') return send(fakeFifo({ extraRows: moves }));
          return send({ app: 'transaction' });
        }
        if (pathname === '/__fake/stocktake') {
          st = st || loadStocktake({ head: 'demo-head', count: 'demo-count' });
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
