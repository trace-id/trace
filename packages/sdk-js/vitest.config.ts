import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    pool: 'forks',
    poolOptions: {
      // Node's own Web Storage globals would shadow happy-dom's.
      forks: { execArgv: ['--no-experimental-webstorage'] },
    },
  },
});
