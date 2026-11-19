// Runs the test suite of every server SDK whose toolchain is installed; reports the ones skipped.
// On GitHub Actions, a failing SDK is also reported as an annotation with the end of its output, so the failing
// toolchain is visible on the run page without opening the log.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = import.meta.dirname;
const onActions = process.env.GITHUB_ACTIONS === 'true';
const has = (cmd, arg = '--version') => spawnSync(cmd, [arg], { shell: true, stdio: 'ignore' }).status === 0;

const failures = [];
function run(name, cmd, cwd, env = {}) {
  console.log(`\n=== ${name}: ${cmd}`);
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  const ok = r.status === 0;
  if (!ok) failures.push({ name, cmd, output, status: r.status });
  return ok;
}

const results = [];
const python = has('python3') ? 'python3' : has('python') ? 'python' : null;
if (python) results.push(['python', run('python', `${python} -m unittest discover -s tests`, join(here, 'python'), { PYTHONPATH: 'src' })]);
else results.push(['python', null]);
if (has('php')) {
  results.push(['php', run('php', 'php tests/run.php', join(here, 'php'))]);
  results.push(['wordpress', run('wordpress', 'php tests/run.php', join(here, '../integrations/wordpress'))]);
} else results.push(['php', null]);
if (has('javac')) {
  const out = mkdtempSync(join(tmpdir(), 'trace-java-'));
  results.push(['java', run('java', `javac -d "${out}" src/main/java/dev/trace/*.java src/test/java/dev/trace/*.java && java -cp "${out}" dev.trace.TraceTest`, join(here, 'java'))]);
} else results.push(['java', null]);

if (has('go', 'version')) results.push(['go', run('go', 'go test ./...', join(here, 'go'))]);
else results.push(['go', null]);

if (has('ruby')) results.push(['ruby', run('ruby', 'ruby test/trace_test.rb', join(here, 'ruby'))]);
else results.push(['ruby', null]);
if (has('dotnet')) results.push(['dotnet', run('dotnet', 'dotnet run --project TraceDevice.Tests', join(here, 'dotnet'))]);
else results.push(['dotnet', null]);

if (has('dart')) results.push(['flutter', run('flutter', 'dart run test/native_test.dart', join(here, 'flutter'))]);
else results.push(['flutter', null]);

if (has('swift', '--version')) results.push(['swift', run('swift', 'swift test', join(here, 'swift'))]);
else results.push(['swift', null]);
if (has('gradle')) results.push(['kotlin', run('kotlin', 'gradle -q :core:run', join(here, 'kotlin'))]);
else results.push(['kotlin', null]);

console.log('\n--- summary');
for (const [name, ok] of results) console.log(`${name.padEnd(9)} ${ok === null ? 'skipped (toolchain not installed)' : ok ? 'passed' : 'FAILED'}`);

if (onActions) {
  const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const f of failures) {
    const tail = f.output.trim().split('\n').slice(-18).join('\n');
    console.log(`::error title=${f.name} SDK tests failed (exit ${f.status})::${esc(`${f.cmd}\n${tail}`)}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = results.map(([n, ok]) => `| ${n} | ${ok === null ? 'skipped' : ok ? 'passed' : '**FAILED**'} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### SDK tests\n\n| SDK | Result |\n| --- | --- |\n${lines.join('\n')}\n`);
  }
}

process.exit(results.some(([, ok]) => ok === false) ? 1 : 0);
