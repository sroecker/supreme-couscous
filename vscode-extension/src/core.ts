import modelProfiles from './model-profiles.json';
import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface Finding { file_path: string; cwe_ids: string[]; title: string; submission_rank?: number }
export interface Report {
  findings: Finding[];
  summary: { generation_errors: number; failed_workers: number; incomplete_reason?: string | null; [key: string]: unknown };
  metadata: { model: string; [key: string]: unknown };
  warnings?: string[];
  per_cwe_results?: { cwe_id: string; finding_count: number; error_message?: string | null }[];
}
export function parseReport(text: string): Report {
  const r = JSON.parse(text);
  if (!r || !Array.isArray(r.findings) || !r.summary || typeof r.metadata?.model !== 'string' ||
      !['generation_errors', 'failed_workers'].every(k => Number.isInteger(r.summary[k]) && r.summary[k] >= 0) ||
      (r.warnings !== undefined && (!Array.isArray(r.warnings) || !r.warnings.every((w: unknown) => typeof w === 'string'))) ||
      (r.per_cwe_results !== undefined && (!Array.isArray(r.per_cwe_results) || !r.per_cwe_results.every((v: any) => typeof v?.cwe_id === 'string' && Number.isInteger(v.finding_count) && v.finding_count >= 0 && (v.error_message == null || typeof v.error_message === 'string')))) ||
      !r.findings.every((f: Finding) => typeof f?.file_path === 'string' && typeof f.title === 'string' &&
        Array.isArray(f.cwe_ids) && f.cwe_ids.every(c => typeof c === 'string'))) {
    throw new Error('Unsupported Antares result schema.');
  }
  return r;
}
export function isComplete(r: Report, exitCode: number | null): boolean {
  return exitCode === 0 && !r.warnings?.length && !r.summary.incomplete_reason &&
    r.summary.generation_errors === 0 && r.summary.failed_workers === 0 && !r.per_cwe_results?.some(result => result.error_message);
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
  return { model, endpoint: `http://127.0.0.1:${modelProfiles[model].port}/v1/completions` };
}
export function childEnvironment(dataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ANTARES_DATA_DIR: dataDir, NO_PROXY: '127.0.0.1,localhost', PYTHONUNBUFFERED: '1' };
}
export interface ProcessResult { stdout: string; stderr: string; exitCode: number | null; stopped?: 'cancelled' | 'timeout' | 'output limit' }
export function cliReport(result: ProcessResult): Report {
  try {
    if (!result.stdout.trim()) throw new Error('No JSON report was returned.');
    return parseReport(result.stdout);
  } catch (error) {
    const detail = result.stderr
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
      .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
      .trim().slice(-2000);
    throw new Error(`Antares CLI exited ${result.exitCode ?? 'without an exit code'}: ${detail || (result.stdout.trim() ? 'The CLI returned an invalid or truncated JSON report. Check that the configured executable is the installed Antares CLI.' : 'No report or error details were returned. Check the CLI path and model server.')}`);
  }
}
export class LocalServerError extends Error {
  constructor(message: string, public readonly startCommand: string) { super(message); }
}
export async function checkServer(connection: { model: string; endpoint: string }) {
  const command = connection.model === 'antares-350m' ? 'ANTARES_MODEL=antares-350m ANTARES_PORT=8086 ./scripts/serve.sh' : './scripts/serve.sh';
  const url = new URL('/health', connection.endpoint);
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  } catch {
    throw new LocalServerError(`The local ${connection.model} server is not reachable at ${url.origin}. Start it in a terminal from the Antares project folder, then retry.`, command);
  }
  if (!response.ok) throw new LocalServerError(`The local ${connection.model} server is not ready (HTTP ${response.status}). Wait for it to finish loading, then retry.`, command);
}
export function runCli(executable: string, args: string[], request: unknown, cwd: string,
  env: NodeJS.ProcessEnv, timeoutMs: number, signal: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve({ stdout: '', stderr: '', exitCode: null, stopped: 'cancelled' });
    const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', bytes = 0, stopped: ProcessResult['stopped'], force: NodeJS.Timeout | undefined;
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
    // Keep a bounded diagnostic tail in memory only, never in saved reports.
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      stderr = (stderr + chunk).slice(-65536);
      if (bytes > 16 * 1024 * 1024) stop('output limit');
    });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { if (stopped) kill('SIGKILL'); cleanup(); resolve({ stdout, stderr, exitCode: code, stopped }); });
    child.stdin.on('error', () => { /* exit handler reports early child termination */ });
    child.stdin.end(JSON.stringify(request));
  });
}

export function scanRequest(target: string, connection: { model: string; endpoint: string }, budget: number, cwe?: string, maxCwes = 3) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 50) throw new Error('Tool budget must be between 1 and 50.');
  const base = { target, ...connection, backend: 'remote', tool_budget: budget };
  if (cwe !== undefined) {
    if (!/^CWE-[1-9]\d*$/.test(cwe)) throw new Error('Enter a CWE ID such as CWE-287.');
    return { mode: 'query', payload: { ...base, cwe_ids: [cwe] } };
  }
  if (!Number.isInteger(maxCwes) || maxCwes < 1 || maxCwes > 10) throw new Error('Sweep size must be between 1 and 10 categories.');
  return { mode: 'sweep', payload: { ...base, workers: 1, selection: { scope: 'auto', max_cwes: maxCwes } } };
}

export const scanProfiles = {
  auto: { name: 'Automatic selection', categories: undefined as string[] | undefined },
  web: { name: 'Web application', categories: ['CWE-89', 'CWE-79', 'CWE-78', 'CWE-22'] },
  oauth: { name: 'MCP/OAuth', categories: ['CWE-287', 'CWE-862', 'CWE-441'] }
};
export function explicitSweepRequest(target: string, connection: {model: string; endpoint: string}, budget: number, categories: string[]) {
  if (!categories.length || categories.length > 10 || new Set(categories).size !== categories.length) throw new Error('Select 1–10 distinct categories.');
  categories.forEach(c => scanRequest(target, connection, budget, c));
  return { mode: 'sweep', payload: { target, ...connection, backend: 'remote', tool_budget: budget, workers: 1, cwe_ids: categories } };
}
export function failedCategories(report: Report, requested: string[] = []) {
  const results = report.per_cwe_results ?? [];
  return [...new Set([...results.filter(r => r.error_message).map(r => r.cwe_id), ...requested.filter(id => !results.some(r => r.cwe_id === id))])];
}
export function categoryLabel(id: string) {
  const names: Record<string, string> = { 'CWE-89': 'SQL injection', 'CWE-79': 'Cross-site scripting', 'CWE-78': 'OS command injection', 'CWE-22': 'Path traversal', 'CWE-287': 'Improper authentication', 'CWE-862': 'Missing authorization', 'CWE-441': 'Confused deputy / token forwarding' };
  return names[id] ? `${names[id]} (${id})` : id;
}
export function categoryCoverage(report: Report, requested?: string[]) {
  const results = report.per_cwe_results ?? [];
  return [...new Set([...(requested ?? []), ...results.map(r => r.cwe_id)])].map(id => {
    const result = results.find(r => r.cwe_id === id);
    return { id, label: categoryLabel(id), status: !result ? 'not run' : result.error_message ? `incomplete: ${result.error_message}` : `completed · ${result.finding_count} candidate(s)` };
  });
}
