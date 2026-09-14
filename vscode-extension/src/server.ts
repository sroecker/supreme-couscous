import { spawn, ChildProcess } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { checkServer, childEnvironment, profile } from './core';

export async function serverStatus(model: string) {
  const connection = profile(model);
  try { await checkServer(connection); } catch (error) { return { ready: false, description: error instanceof Error ? error.message : String(error) }; }
  try {
    const response = await fetch(new URL('/v1/models', connection.endpoint), { signal: AbortSignal.timeout(3000), redirect: 'error' });
    const body = await response.json() as { data?: { id?: string }[] };
    const names = body.data?.map(item => item.id).filter(Boolean) ?? [];
    return { ready: true, description: names.length ? `Ready · server advertises ${names.join(', ')} (weights not independently verified)` : 'Ready · model identity unverified' };
  } catch { return { ready: true, description: 'Ready · model identity unverified' }; }
}
async function selectDevice(root: string, model: string): Promise<'metal' | 'cpu'> {
  const name = profile(model).model;
  for (const [precision, device] of [['bf16', 'metal'], ['f16', 'cpu']] as const) {
    try { if ((await stat(path.join(root, `models/${name}-${precision}.gguf`))).isFile()) return device; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new Error(`Missing models/${name}-bf16.gguf (or models/${name}-f16.gguf for CPU inference)`);
}
export async function validatePocRoot(input: string, model: string) {
  if (!path.isAbsolute(input)) throw new Error('Enter the absolute path to the Antares POC.');
  const root = await realpath(input);
  for (const relative of ['scripts/serve.sh', 'scripts/model_profile.sh']) {
    if (!(await stat(path.join(root, relative))).isFile()) throw new Error(`Missing ${relative}`);
  }
  await selectDevice(root, model);
  await access(path.join(root, 'build/llama.cpp/bin/llama-server'), constants.X_OK);
  await access(path.join(root, '.venv/bin/python'), constants.X_OK);
  return root;
}
export class LocalServers {
  private owned = new Map<string, ChildProcess>();
  private starting = new Set<string>();
  private disposed = false;
  async start(root: string, model: string, history: string, log: (message: string) => void, signal?: AbortSignal) {
    if (this.owned.has(model) || this.starting.has(model)) throw new Error('This extension already started that model. Check server status.');
    this.starting.add(model);
    try { return await this.launch(root, model, history, log, signal); } finally { this.starting.delete(model); }
  }
  private async launch(root: string, model: string, history: string, log: (message: string) => void, signal?: AbortSignal) {
    root = await validatePocRoot(root, model);
    if ((await serverStatus(model)).ready) return 'A server is already running; it remains independently managed.';
    if (this.disposed || signal?.aborted) throw new Error('Server startup cancelled.');
    const device = await selectDevice(root, model);
    const child = spawn('/bin/bash', [path.join(root, 'scripts/serve.sh')], { cwd: root, env: { ...childEnvironment(history), ANTARES_MODEL: model, ANTARES_DEVICE: device }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.owned.set(model, child);
    let error: string | undefined;
    child.on('error', e => { error = e.message; if (this.owned.get(model) === child) this.owned.delete(model); });
    child.on('exit', code => { error ??= `Server exited ${code}. See Antares Server output.`; if (this.owned.get(model) === child) this.owned.delete(model); });
    for (const stream of [child.stdout!, child.stderr!]) {
      stream.setEncoding('utf8'); stream.on('data', (data: string) => log(data.slice(-8000)));
    }
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (error) throw new Error(error);
      if (signal?.aborted) { this.stop(model); throw new Error('Server startup cancelled.'); }
      if ((await serverStatus(model)).ready) return 'Local server ready. This editor owns the server and stops it on extension shutdown.';
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this.stop(model);
    throw new Error('Server did not become ready within 60 seconds. See Antares Server output.');
  }
  private stop(model: string) {
    const child = this.owned.get(model);
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* exited */ } } }, 1500);
    timer.unref();
    this.owned.delete(model);
  }
  dispose() { this.disposed = true; for (const model of this.owned.keys()) this.stop(model); }
}
