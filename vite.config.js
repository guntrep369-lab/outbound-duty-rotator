import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' produces relative asset URLs so the built site works whether it is
// served from a user page (user.github.io) or a project page (user.github.io/repo/).
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    // dist/ holds a verbatim copy of public/, so without this a test placed
    // there would run twice — and a stale built copy could pass while the
    // source it was built from is broken.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
