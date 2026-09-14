const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { runCli, childEnvironment, pythonCliInvocation } = require('../dist/core');
const python = process.env.ANTARES_TEST_PYTHON ?? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
const runtime = path.resolve(__dirname, '../runtime/antares_runtime.py');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'antares-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.join(root, 'antares'), pidFile = path.join(root, 'tool.pid');
  await fs.writeFile(cli, `#!${python}\nimport subprocess, sys, time\np = subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)'], start_new_session=True)\nopen(sys.argv[1], 'w').write(str(p.pid))\ntime.sleep(60)\n`, { mode: 0o755 });
  return { root, cli, pidFile };
}
async function waitForPid(file) {
  for (let i = 0; i < 100; i++) {
    try { return Number(await fs.readFile(file, 'utf8')); } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Tool did not start');
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
for (const reason of ['cancelled', 'timeout']) {
  test(`Python CLI ${reason} cleans a tool in a separate session without killing unrelated processes`, async t => {
    const { root, cli, pidFile } = await fixture(t);
    const independent = spawn(python, ['-c', 'import time; time.sleep(60)']);
    t.after(() => independent.kill('SIGKILL'));
    const abort = new AbortController();
    const running = runCli(cli, [pidFile], {}, root, childEnvironment(root), reason === 'timeout' ? 700 : 10000, abort.signal, runtime);
    const pid = await waitForPid(pidFile);
    t.after(() => { if (alive(pid)) process.kill(pid, 'SIGKILL'); });
    if (reason === 'cancelled') abort.abort();
    const result = await running;
    assert.equal(result.stopped, reason);
    assert.equal(alive(pid), false, 'Detached tool must be reaped');
    assert.equal(alive(independent.pid), true, 'Unrelated processes remain running');
  });
}
test('runtime invocation rejects unsupported launchers and preserves argument boundaries', async t => {
  const { cli } = await fixture(t);
  const invocation = await pythonCliInvocation(cli, ['space in arg', '$(not a shell)'], runtime);
  assert.equal(invocation.executable, python);
  assert.deepEqual(invocation.args, [runtime, cli, 'space in arg', '$(not a shell)']);
  await fs.writeFile(cli, '#!/usr/bin/env python3\n');
  await assert.rejects(pythonCliInvocation(cli, [], runtime), /absolute Python shebang/);
});
