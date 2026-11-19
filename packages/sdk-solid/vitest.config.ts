import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Solid ships a server build and a browser build; the tests need the browser one (real reactivity).
  resolve: { conditions: ['browser', 'development'] },
  test: {
    environment: 'happy-dom',
    pool: 'forks',
    // Node's own Web Storage globals would shadow happy-dom's.
    execArgv: ['--no-experimental-webstorage'],
    server: { deps: { inline: [/solid-js/] } },
  },
});
