import { fileURLToPath } from 'node:url';

export default {
  test: {
    root: fileURLToPath(new URL('../../', import.meta.url)),
    include: ['src/data/fire*.test.js'],
    setupFiles: [fileURLToPath(new URL('./record.mjs', import.meta.url))],
    pool: 'forks',
    testTimeout: 120000,
  },
};
