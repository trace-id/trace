// Single-file browser builds for pages without a bundler:
//   dist/browser/sdk.esm.js    <script type="module"> import { createClient } from '.../sdk.esm.js'
//   dist/browser/sdk.global.js <script src>  then window.Tbdname.createClient(...)
// Fails the build if the gzipped size exceeds the budget.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const BUDGET_GZIP_BYTES = 12 * 1024;
const common = {
  entryPoints: ['src/client.ts'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2020'],
  legalComments: 'eof',
  logLevel: 'warning',
};

await build({ ...common, format: 'esm', outfile: 'dist/browser/sdk.esm.js' });
await build({ ...common, format: 'iife', globalName: 'Tbdname', outfile: 'dist/browser/sdk.global.js' });

for (const file of ['dist/browser/sdk.esm.js', 'dist/browser/sdk.global.js']) {
  const gz = gzipSync(readFileSync(file)).length;
  console.log(`${file}: ${(gz / 1024).toFixed(1)} KB gzip`);
  if (gz > BUDGET_GZIP_BYTES) {
    console.error(`size budget exceeded (${BUDGET_GZIP_BYTES} bytes gzip)`);
    process.exit(1);
  }
}
