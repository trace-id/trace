import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    pool: 'forks',
    // Node's own Web Storage globals would shadow happy-dom's.
    execArgv: ['--no-experimental-webstorage'],
  },
});
