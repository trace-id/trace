// Runs the test suite of every server SDK whose toolchain is installed; reports the ones skipped.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const has = (cmd, arg = '--version') => spawnSync(cmd, [arg], { shell: true, stdio: 'ignore' }).status === 0;
const run = (cmd, cwd, env = {}) => spawnSync(cmd, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...env } }).status === 0;

const results = [];
const python = has('python3') ? 'python3' : has('python') ? 'python' : null;
if (python) results.push(['python', run(`${python} -m unittest discover -s tests`, join(here, 'python'), { PYTHONPATH: 'src' })]);
else results.push(['python', null]);
if (has('php')) {
  results.push(['php', run('php tests/run.php', join(here, 'php'))]);
  results.push(['wordpress', run('php tests/run.php', join(here, '../integrations/wordpress'))]);
}
else results.push(['php', null]);
if (has('javac')) {
  const out = mkdtempSync(join(tmpdir(), 'trace-java-'));
  results.push(['java', run(`javac -d "${out}" src/main/java/dev/trace/*.java src/test/java/dev/trace/*.java && java -cp "${out}" dev.trace.TraceTest`, join(here, 'java'))]);
} else results.push(['java', null]);

if (has('go', 'version')) results.push(['go', run('go test ./...', join(here, 'go'))]);
else results.push(['go', null]);

if (has('ruby')) results.push(['ruby', run('ruby test/trace_test.rb', join(here, 'ruby'))]);
else results.push(['ruby', null]);
if (has('dotnet')) results.push(['dotnet', run('dotnet run --project TraceDevice.Tests', join(here, 'dotnet'))]);
else results.push(['dotnet', null]);

if (has('dart')) results.push(['flutter', run('dart run test/native_test.dart', join(here, 'flutter'))]);
else results.push(['flutter', null]);

if (has('swift', '--version')) results.push(['swift', run('swift test', join(here, 'swift'))]);
else results.push(['swift', null]);
if (has('gradle')) results.push(['kotlin', run('gradle -q :core:run', join(here, 'kotlin'))]);
else results.push(['kotlin', null]);

for (const [name, ok] of results) console.log(`${name.padEnd(8)} ${ok === null ? 'skipped (toolchain not installed)' : ok ? 'passed' : 'FAILED'}`);
process.exit(results.some(([, ok]) => ok === false) ? 1 : 0);
