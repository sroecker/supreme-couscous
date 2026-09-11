import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface Finding { file_path: string; cwe_ids: string[]; title: string; submission_rank?: number }
export interface Report {
  findings: Finding[];
  summary: { generation_errors: number; failed_workers: number; incomplete_reason?: string | null; [key: string]: unknown };
  metadata: { model: string; [key: string]: unknown };
  warnings?: string[];
}
export function parseReport(text: string): Report {
  const r = JSON.parse(text);
  if (!r || !Array.isArray(r.findings) || !r.summary || typeof r.metadata?.model !== 'string' ||
      !['generation_errors', 'failed_workers'].every(k => Number.isInteger(r.summary[k]) && r.summary[k] >= 0) ||
      (r.warnings !== undefined && (!Array.isArray(r.warnings) || !r.warnings.every((w: unknown) => typeof w === 'string'))) ||
      !r.findings.every((f: Finding) => typeof f?.file_path === 'string' && typeof f.title === 'string' &&
        Array.isArray(f.cwe_ids) && f.cwe_ids.every(c => typeof c === 'string'))) {
    throw new Error('Unsupported Antares result schema.');
  }
  return r;
}
export function isComplete(r: Report, exitCode: number | null): boolean {
  return exitCode === 0 && !r.warnings?.length && !r.summary.incomplete_reason &&
    r.summary.generation_errors === 0 && r.summary.failed_workers === 0;
}
export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
export async function candidatePath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.includes('\\') || !inside(root, path.resolve(root, relative))) {
    throw new Error('Finding path is outside the scan target.');
  }
  const resolved = await realpath(path.resolve(root, relative));
  if (!inside(await realpath(root), resolved) || !(await stat(resolved)).isFile()) throw new Error('Invalid candidate file.');
  return resolved;
}
export function profile(model: string) {
  if (model !== 'antares-1b' && model !== 'antares-350m') throw new Error('Unsupported local model.');
  return { model, endpoint: `http://127.0.0.1:${model === 'antares-1b' ? 8082 : 8086}/v1/completions` };
}
export function childEnvironment(dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ANTARES_DATA_DIR: dataDir, NO_PROXY: '127.0.0.1,localhost', PYTHONUNBUFFERED: '1' };
}
export interface ProcessResult { stdout: string; exitCode: number | null; stopped?: 'cancelled' | 'timeout' | 'output limit' }
export function runCli(executable: string, args: string[], request: unknown, cwd: string,
  env: NodeJS.ProcessEnv, timeoutMs: number, signal: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve({ stdout: '', exitCode: null, stopped: 'cancelled' });
    const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32' });
    let stdout = '', bytes = 0, stopped: ProcessResult['stopped'], force: NodeJS.Timeout | undefined;
    const kill = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill(sig) : process.kill(-child.pid, sig); } catch { /* already exited */ }
    };
    const stop = (reason: ProcessResult['stopped']) => {
      if (stopped) return;
      stopped = reason;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), 1500);
    };
    const cancel = () => stop('cancelled');
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const cleanup = () => { clearTimeout(timer); if (force) clearTimeout(force); signal.removeEventListener('abort', cancel); };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 16 * 1024 * 1024) stop('output limit'); else stdout += chunk;
    });
    // Drain stderr without retaining source excerpts or credentials in extension logs.
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) stop('output limit'); });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { if (stopped) kill('SIGKILL'); cleanup(); resolve({ stdout, exitCode: code, stopped }); });
    child.stdin.on('error', () => { /* exit handler reports early child termination */ });
    child.stdin.end(JSON.stringify(request));
  });
}
