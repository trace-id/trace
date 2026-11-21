import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SDK_NAME, SDK_VERSION } from './version.js';

// Each framework package tells the server which package an event came from. The name and version are written into its
// source, so this checks they match what is published.
const packages = resolve(import.meta.dirname, '../..');
const SOURCES: Record<string, string> = {
  'sdk-react': 'src/via.ts',
  'sdk-vue': 'src/via.ts',
  'sdk-svelte': 'src/via.ts',
  'sdk-angular': 'src/via.ts',
  'sdk-solid': 'src/via.ts',
  'sdk-next': 'src/via.ts',
  'sdk-nuxt': 'src/runtime/plugin.client.ts',
};

const read = (...parts: string[]): string => readFileSync(resolve(packages, ...parts), 'utf8');

describe('client package names and versions', () => {
  it('sdk-js reports its own package.json version', () => {
    const pkg = JSON.parse(read('sdk-js', 'package.json')) as { name: string; version: string };
    expect({ name: SDK_NAME, version: SDK_VERSION }).toEqual({ name: pkg.name, version: pkg.version });
  });

  it.each(Object.entries(SOURCES))('%s reports its own name and version', (dir, file) => {
    const pkg = JSON.parse(read(dir, 'package.json')) as { name: string; version: string };
    const m = /name: '([^']+)',\s*version: '([^']+)'/.exec(read(dir, file));
    expect(m, `${dir}/${file} must declare name and version`).not.toBeNull();
    expect({ name: m?.[1], version: m?.[2] }).toEqual({ name: pkg.name, version: pkg.version });
  });
});
