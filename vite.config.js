import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

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

// base: './' produces relative asset URLs so the built site works whether it is
// served from a user page (user.github.io) or a project page (user.github.io/repo/).
export default defineConfig({
  plugins: [folderIndex()],
  base: './',
  test: {
    // dist/ holds a verbatim copy of public/, so without this a test placed
    // there would run twice — and a stale built copy could pass while the
    // source it was built from is broken.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
