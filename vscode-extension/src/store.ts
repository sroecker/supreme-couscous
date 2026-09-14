import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Run } from './review-model';
import { inside, parseReport } from './core';

export class ConflictError extends Error {
  constructor() { super('This run changed in another window. Your draft is retained. Open Run History to reload the saved version before retrying.'); }
}
export function workspaceKey(roots: string[]) {
  return createHash('sha256').update(JSON.stringify([...new Set(roots)].sort())).digest('hex');
}
export function validateRun(value: any): Run {
  if (!value || !['target', 'model', 'cwe', 'started', 'finished'].every(k => typeof value[k] === 'string') ||
      !['completed', 'incomplete'].includes(value.status)) throw new Error('Invalid saved run.');
  value.report = parseReport(JSON.stringify(value.report));
  if (value.id !== undefined && !/^[a-zA-Z0-9-]+$/.test(value.id)) throw new Error('Invalid run ID.');
  if (value.revision !== undefined && (!Number.isInteger(value.revision) || value.revision < 0)) throw new Error('Invalid revision.');
  for (const [key, d] of Object.entries(value.reviews ?? {}) as [string, any][]) {
    if (!/^(0|[1-9]\d*)$/.test(key) || !value.report.findings[Number(key)] ||
        !['unreviewed', 'confirmed', 'dismissed'].includes(d?.status) || typeof d.note !== 'string' || d.note.length > 4000 ||
        typeof d.updated !== 'string' || (d.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(d.sourceHash))) throw new Error('Invalid saved decision.');
  }
  for (const [key, d] of Object.entries(value.drafts ?? {}) as [string, any][]) {
    if (!/^(0|[1-9]\d*)$/.test(key) || !value.report.findings[Number(key)] || typeof d?.note !== 'string' || d.note.length > 4000 || typeof d.updated !== 'string') throw new Error('Invalid saved draft.');
  }
  return value;
}

// Runs are immutable in identity; review updates use optimistic revisions under a process lock.
export class RunStore {
  readonly directory: string;
  private locations = new Map<string, string>();
  setRoots(roots: string[]) { this.roots = roots; }
  constructor(private base: string, private roots: string[]) {
    this.directory = path.join(base, 'runs');
  }
  async list(): Promise<Run[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const runs: Run[] = [];
    // Read older workspace-scoped records in place, preserving their revision locks.
    const directories = [this.directory];
    try { for (const entry of await readdir(path.join(this.base, 'workspaces'), { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(this.base, 'workspaces', entry.name, 'runs'));
    } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const directory of directories) {
      let files: string[];
      try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const location = path.join(directory, file);
          const r = validateRun(JSON.parse(await readFile(location, 'utf8')));
          if (r.id && file === `${r.id}.json` && this.roots.some(root => inside(root, r.target))) {
            this.locations.set(r.id, location); runs.push(r);
          }
        } catch { /* Retain corrupt records for recovery. */ }
      }
    }
    return runs.sort((a, b) => b.started.localeCompare(a.started));
  }
  async save(run: Run): Promise<void> {
    run.id ??= randomUUID();
    validateRun(run);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (run.revision && !this.locations.has(run.id)) await this.list();
    const file = this.locations.get(run.id) ?? path.join(this.directory, `${run.id}.json`), lock = `${file}.lock`;
    let owned = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const handle = await open(lock, 'wx', 0o600);
        try { await handle.writeFile(String(process.pid)); } catch (error) { await unlink(lock).catch(() => {}); throw error; } finally { await handle.close(); }
        owned = true; break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Reclaim only a lock whose owner is known to have exited. Never expire a live writer.
        try {
          // Serialize reclamation too: a second reclaimer must not delete a new live owner's lock.
          const recovery = await open(`${lock}.reclaim`, 'wx', 0o600);
          try {
            const pid = Number(await readFile(lock, 'utf8'));
            if (Number.isInteger(pid) && pid > 0) {
              try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lock); }
            }
          } finally { await recovery.close(); await unlink(`${lock}.reclaim`); }
        } catch { /* Another writer may already have released it. */ }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!owned) throw new Error('Run is being saved in another window. Draft retained; retry shortly.');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      let revision = 0;
      try { revision = validateRun(JSON.parse(await readFile(file, 'utf8'))).revision ?? 0; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if ((run.revision ?? 0) !== revision) throw new ConflictError();
      const next = { ...run, schemaVersion: 2, revision: revision + 1 };
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(next, null, 2)); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      run.revision = next.revision; run.schemaVersion = 2;
    } finally { await unlink(temporary).catch(() => {}); await unlink(lock).catch(() => {}); }
  }
  async migrate() {
    let legacy: Run;
    try { legacy = validateRun(JSON.parse(await readFile(path.join(this.base, 'last-result.json'), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    if (!this.roots.some(root => inside(root, legacy.target))) return;
    legacy.id = `legacy-${createHash('sha256').update(`${legacy.started}:${legacy.target}`).digest('hex')}`;
    if ((await this.list()).some(r => r.id === legacy.id)) return;
    legacy.revision = 0;
    try { await this.save(legacy); } catch (e) { if (!(e instanceof ConflictError)) throw e; }
  }
}
