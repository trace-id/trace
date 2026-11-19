// Development server: compile with tsc (which emits the decorator metadata Nest's dependency injection needs; tsx/esbuild does not),
// keep tsc watching, and restart node whenever the compiled output changes.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
const project = ['-p', 'tsconfig.build.json'];

const first = spawnSync(process.execPath, [tsc, ...project], { stdio: 'inherit' });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, ...project, '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch-path=dist', '--enable-source-maps', 'dist/main.js'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { if (code && code !== 0) stop(); });
